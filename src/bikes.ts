import { db, getBikeTemplate } from "./db.js";
import { getBikeArrivalsForDate } from "./bookvisit.js";
import { sendSms } from "./sms.js";
import { sendEmail } from "./email.js";
import { config } from "./config.js";

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

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

const logMessage = db.prepare(`
  INSERT INTO message_log (arrival_date, channel, recipient, body, status, provider_id, error, dry_run)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

export interface BikeOutcome {
  id: number;
  guest: string;
  channel: "sms" | "email" | "none";
  status: string;
  error?: string;
}

export async function sendBikeFor(id: number, opts: { force?: boolean } = {}): Promise<BikeOutcome> {
  const b = getBikeSend(id);
  if (!b) return { id, guest: "?", channel: "none", status: "missing" };
  if (b.status === "sent" && !opts.force) {
    return { id, guest: b.guest_name ?? "?", channel: (b.channel as any) ?? "none", status: "already-sent" };
  }

  const tmpl = getBikeTemplate();
  const vars = {
    namn: (b.guest_name ?? "gäst").split(" ")[0],
    fulltnamn: b.guest_name ?? "gäst",
  };

  let channel: "sms" | "email" | "none" = "none";
  let result;
  if (b.phone) {
    channel = "sms";
    result = await sendSms(b.phone, render(tmpl.sms, vars));
  } else if (b.email) {
    channel = "email";
    result = await sendEmail(b.email, render(tmpl.email_subject, vars), render(tmpl.email_body, vars));
  } else {
    db.prepare("UPDATE bike_sends SET status='skipped', note=?, updated_at=datetime('now') WHERE id=?").run(
      "Varken telefon eller e-post finns",
      id,
    );
    return { id, guest: b.guest_name ?? "?", channel: "none", status: "skipped" };
  }

  logMessage.run(
    b.notify_date,
    channel,
    result.recipient,
    channel === "sms" ? render(tmpl.sms, vars) : render(tmpl.email_body, vars),
    result.status,
    result.providerId ?? null,
    result.error ?? null,
    config.dryRun ? 1 : 0,
  );

  db.prepare("UPDATE bike_sends SET status=?, channel=?, note=?, updated_at=datetime('now') WHERE id=?").run(
    result.ok ? "sent" : "failed",
    channel,
    result.error ?? null,
    id,
  );

  return { id, guest: b.guest_name ?? "?", channel, status: result.status, error: result.error };
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
