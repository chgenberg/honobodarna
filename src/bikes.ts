import { db, getSetting } from "./db.js";
import { getBikeArrivalsForDate } from "./bookvisit.js";
import { sendSms } from "./sms.js";
import { sendEmail } from "./email.js";
import { config } from "./config.js";
import { getTemplate, langForPhone, render } from "./templates.js";

export interface BikeRow {
  id: number;
  notify_date: string;
  booking_code: string;
  guest_name: string | null;
  phone: string | null;
  email: string | null;
  bike_label: string | null;
  status: string;
  channel: string | null;
  note: string | null;
}

const upsertBike = db.prepare(`
  INSERT INTO bike_sends (notify_date, booking_code, guest_name, phone, email, bike_label, status)
  VALUES (@notify_date, @booking_code, @guest_name, @phone, @email, @bike_label, 'pending')
  ON CONFLICT(booking_code, notify_date) DO UPDATE SET
    guest_name=excluded.guest_name, phone=excluded.phone, email=excluded.email,
    bike_label=excluded.bike_label, updated_at=datetime('now')
`);

// Importerar dagens cykelbokningar till bike_sends.
export function prepareBikeSends(date: string): BikeRow[] {
  const bikes = getBikeArrivalsForDate(date);
  const tx = db.transaction(() => {
    for (const b of bikes) {
      upsertBike.run({
        notify_date: date,
        booking_code: b.booking_code,
        guest_name: b.guest_name,
        phone: b.phone,
        email: b.email,
        bike_label: b.bike_label,
      });
    }
  });
  tx();
  return getBikeSends(date);
}

export function getBikeSends(date: string): BikeRow[] {
  return db
    .prepare("SELECT * FROM bike_sends WHERE notify_date = ? ORDER BY guest_name")
    .all(date) as BikeRow[];
}

export function getBikeSend(id: number): BikeRow | undefined {
  return db.prepare("SELECT * FROM bike_sends WHERE id = ?").get(id) as BikeRow | undefined;
}

const logMessage = db.prepare(`
  INSERT INTO message_log (arrival_date, channel, recipient, body, status, provider_id, error, dry_run)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

export interface BikeOutcome {
  id: number;
  guest: string;
  channel: string; // "sms", "email", "sms+email" eller "none"
  status: string;
  error?: string;
}

export async function sendBikeFor(id: number, opts: { force?: boolean } = {}): Promise<BikeOutcome> {
  const b = getBikeSend(id);
  if (!b) return { id, guest: "?", channel: "none", status: "missing" };
  if (b.status === "sent" && !opts.force) {
    return { id, guest: b.guest_name ?? "?", channel: (b.channel as any) ?? "none", status: "already-sent" };
  }

  const tmpl = getTemplate("bike", langForPhone(b.phone));
  const vars = {
    namn: (b.guest_name ?? "gäst").split(" ")[0],
    fulltnamn: b.guest_name ?? "gäst",
    kod: getSetting("bike_lock_code") ?? "031969952",
  };
  const body = render(tmpl.text, vars);

  // Skicka via BÅDA kanalerna när gästen har både telefon och e-post.
  const attempts: Array<{ channel: "sms" | "email"; r: Awaited<ReturnType<typeof sendSms>> }> = [];
  if (b.phone) attempts.push({ channel: "sms", r: await sendSms(b.phone, body) });
  if (b.email) attempts.push({ channel: "email", r: await sendEmail(b.email, render(tmpl.subject, vars), body) });

  if (attempts.length === 0) {
    db.prepare("UPDATE bike_sends SET status='skipped', note=?, updated_at=datetime('now') WHERE id=?").run(
      "Varken telefon eller e-post finns",
      id,
    );
    return { id, guest: b.guest_name ?? "?", channel: "none", status: "skipped" };
  }

  for (const att of attempts) {
    logMessage.run(
      b.notify_date,
      att.channel,
      att.r.recipient,
      body,
      att.r.status,
      att.r.providerId ?? null,
      att.r.error ?? null,
      config.dryRun ? 1 : 0,
    );
  }

  const okAttempts = attempts.filter((x) => x.r.ok);
  const anyOk = okAttempts.length > 0;
  const channel = (okAttempts.length ? okAttempts : attempts).map((x) => x.channel).join("+");
  const errors = attempts.filter((x) => x.r.error).map((x) => `${x.channel}: ${x.r.error}`).join(" · ") || null;

  db.prepare("UPDATE bike_sends SET status=?, channel=?, note=?, updated_at=datetime('now') WHERE id=?").run(
    anyOk ? "sent" : "failed",
    channel,
    errors,
    id,
  );

  return { id, guest: b.guest_name ?? "?", channel, status: anyOk ? okAttempts[0].r.status : "failed", error: errors ?? undefined };
}

export interface BikeJobResult {
  found: number;
  sent: number;
  failed: number;
  skipped: number;
  outcomes: BikeOutcome[];
}

// Förbereder och (ev.) skickar cykel-notiser för datumet.
export async function runBikeNotifications(opts: { date: string; send: boolean }): Promise<BikeJobResult> {
  const rows = prepareBikeSends(opts.date);
  const outcomes: BikeOutcome[] = [];
  if (opts.send) {
    for (const r of rows) {
      if (r.status === "sent") continue;
      outcomes.push(await sendBikeFor(r.id));
    }
  }
  const sent = outcomes.filter((o) => ["sent", "dry-run", "canary"].includes(o.status)).length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;
  return { found: rows.length, sent, failed, skipped, outcomes };
}
