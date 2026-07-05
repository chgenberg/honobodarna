import nodemailer from "nodemailer";
import { config } from "./config.js";
import type { SendResult } from "./sms.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!config.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth:
        config.smtp.user || config.smtp.pass
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined,
    });
  }
  return transporter;
}

// Driftmejl (varningar/bekräftelser till receptionen). Går ALLTID till angiven
// adress – ingen canary-omdirigering. Respekterar DRY_RUN (loggar bara då).
export async function sendOpsEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (config.dryRun) {
    console.log(`[ops-mail dry-run] Till: ${to} | ${subject}\n${body}`);
    return true;
  }
  const tx = getTransporter();
  if (!tx) {
    console.error("[ops-mail] SMTP saknas – kan inte skicka driftmejl.");
    return false;
  }
  try {
    await tx.sendMail({ from: config.smtp.from, to, subject, text: body });
    return true;
  } catch (err) {
    console.error("[ops-mail] Misslyckades:", err instanceof Error ? err.message : err);
    return false;
  }
}

// Skickar e-post via SMTP. Respekterar DRY_RUN och CANARY_EMAIL.
export async function sendEmail(
  toRaw: string,
  subject: string,
  body: string,
): Promise<SendResult> {
  let to = toRaw;
  let canary = false;
  if (config.canaryEmail) {
    to = config.canaryEmail;
    canary = true;
  }

  if (config.dryRun) {
    return { ok: true, status: "dry-run", recipient: to };
  }

  const tx = getTransporter();
  if (!tx) {
    return {
      ok: false,
      status: "failed",
      recipient: to,
      error: "SMTP saknas (SMTP_HOST m.fl.).",
    };
  }

  try {
    const info = await tx.sendMail({
      from: config.smtp.from,
      to,
      subject,
      text: body,
    });
    return {
      ok: true,
      status: canary ? "canary" : "sent",
      recipient: to,
      providerId: info.messageId,
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
