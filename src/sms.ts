import { config } from "./config.js";

export interface SendResult {
  ok: boolean;
  status: "sent" | "failed" | "dry-run" | "canary";
  providerId?: string;
  error?: string;
  recipient: string;
}

// Skickar SMS via 46elks. Respekterar DRY_RUN och CANARY_PHONE.
export async function sendSms(toRaw: string, body: string): Promise<SendResult> {
  let to = toRaw;
  let canary = false;
  if (config.canaryPhone) {
    to = config.canaryPhone;
    canary = true;
  }

  if (config.dryRun) {
    return { ok: true, status: "dry-run", recipient: to };
  }

  if (!config.elks.username || !config.elks.password) {
    return {
      ok: false,
      status: "failed",
      recipient: to,
      error: "46elks-uppgifter saknas (ELKS_API_USERNAME/ELKS_API_PASSWORD).",
    };
  }

  try {
    const auth = Buffer.from(`${config.elks.username}:${config.elks.password}`).toString("base64");
    const res = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        from: config.elks.sender,
        to,
        message: body,
      }).toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: "failed", recipient: to, error: `${res.status}: ${text}` };
    }
    let providerId: string | undefined;
    try {
      providerId = (JSON.parse(text) as { id?: string }).id;
    } catch {
      /* ignorera parsning */
    }
    return {
      ok: true,
      status: canary ? "canary" : "sent",
      recipient: to,
      providerId,
    };
  } catch (err) {
    return {
      ok: false,
      status: "failed",
      recipient: to,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
