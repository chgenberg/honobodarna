import { db } from "./db.js";
import { getArrivalsForDate, syncBookings } from "./bookvisit.js";
import { assignCabinsForDate, getCabin } from "./matching.js";
import { sendSms } from "./sms.js";
import { sendEmail } from "./email.js";
import { config } from "./config.js";
import { todayInTz } from "./dates.js";
import { runBikeNotifications, type BikeJobResult } from "./bikes.js";
import { getTemplate, langForPhone, render } from "./templates.js";

export interface ArrivalRow {
  id: number;
  arrival_date: string;
  booking_code: string;
  guest_name: string | null;
  phone: string | null;
  email: string | null;
  room_id: string | null;
  room_type_label: string | null;
  cabin_id: number | null;
  status: string;
  channel: string | null;
  needs_review: number;
  note: string | null;
  is_package: number;
}

const upsertArrival = db.prepare(`
  INSERT INTO arrivals
    (arrival_date, booking_code, booking_guid, guest_name, phone, email,
     room_id, room_type_label, is_package, status)
  VALUES
    (@arrival_date, @booking_code, @booking_guid, @guest_name, @phone, @email,
     @room_id, @room_type_label, @is_package, 'pending')
  ON CONFLICT(booking_code, arrival_date) DO UPDATE SET
    guest_name=excluded.guest_name, phone=excluded.phone, email=excluded.email,
    room_id=excluded.room_id, room_type_label=excluded.room_type_label,
    is_package=excluded.is_package, updated_at=datetime('now')
`);

// Importerar dagens ankomster från speglingen till arrivals-tabellen och matchar stugor.
export function prepareArrivals(date: string): ArrivalRow[] {
  const cached = getArrivalsForDate(date);
  const tx = db.transaction(() => {
    for (const c of cached) {
      upsertArrival.run({
        arrival_date: date,
        booking_code: c.booking_code,
        booking_guid: c.booking_guid,
        guest_name: c.guest_name,
        phone: c.phone,
        email: c.email,
        room_id: c.room_id,
        room_type_label: c.room_type_label,
        is_package: c.has_package ? 1 : 0,
      });
    }
  });
  tx();
  assignCabinsForDate(date);
  return getArrivals(date);
}

// Alla boendeankomster (med rum). is_package skiljer paket från vanliga.
export function getArrivals(date: string): ArrivalRow[] {
  return db
    .prepare(
      "SELECT * FROM arrivals WHERE arrival_date = ? AND room_id IS NOT NULL ORDER BY guest_name",
    )
    .all(date) as ArrivalRow[];
}

export function getRegularArrivals(date: string): ArrivalRow[] {
  return getArrivals(date).filter((a) => !a.is_package);
}

export function getPackageArrivals(date: string): ArrivalRow[] {
  return getArrivals(date).filter((a) => a.is_package);
}

export function getArrival(id: number): ArrivalRow | undefined {
  return db.prepare("SELECT * FROM arrivals WHERE id = ?").get(id) as ArrivalRow | undefined;
}
const logMessage = db.prepare(`
  INSERT INTO message_log
    (arrival_id, arrival_date, channel, recipient, body, status, provider_id, error, dry_run)
  VALUES
    (@arrival_id, @arrival_date, @channel, @recipient, @body, @status, @provider_id, @error, @dry_run)
`);

export interface SendOutcome {
  arrivalId: number;
  guest: string;
  channel: "sms" | "email" | "none";
  status: string;
  error?: string;
}

// Skickar dörrkod för en enskild ankomst. Idempotent: hoppar om redan skickat.
export async function sendForArrival(id: number, opts: { force?: boolean } = {}): Promise<SendOutcome> {
  const a = getArrival(id);
  if (!a) return { arrivalId: id, guest: "?", channel: "none", status: "missing" };
  if (a.status === "sent" && !opts.force) {
    return { arrivalId: id, guest: a.guest_name ?? "?", channel: (a.channel as any) ?? "none", status: "already-sent" };
  }

  const cabin = a.cabin_id ? getCabin(a.cabin_id) : undefined;

  if (!cabin || !cabin.door_code) {
    db.prepare("UPDATE arrivals SET status='skipped', note=?, updated_at=datetime('now') WHERE id=?").run(
      "Ingen stuga/kod tilldelad",
      id,
    );
    return { arrivalId: id, guest: a.guest_name ?? "?", channel: "none", status: "skipped" };
  }

  // Paket (sjöbod + middag) → pakettext; villa → villatext; annars sjöbod-text.
  // Språk styrs av numret (+46 = svenska, annars engelska).
  const isVilla = /villa/i.test(`${cabin.room_type_label ?? ""} ${cabin.name ?? ""}`);
  const type = a.is_package ? "package" : isVilla ? "villa" : "sjobod";
  const lang = langForPhone(a.phone);
  const tmpl = getTemplate(type, lang);

  const vars = {
    namn: (a.guest_name ?? "gäst").split(" ")[0],
    fulltnamn: a.guest_name ?? "gäst",
    stuga: cabin.name,
    kod: cabin.door_code,
  };
  const body = render(tmpl.text, vars);

  let channel: "sms" | "email" | "none" = "none";
  let result;
  if (a.phone) {
    channel = "sms";
    result = await sendSms(a.phone, body);
  } else if (a.email) {
    channel = "email";
    result = await sendEmail(a.email, render(tmpl.subject, vars), body);
  } else {
    db.prepare("UPDATE arrivals SET status='skipped', note=?, updated_at=datetime('now') WHERE id=?").run(
      "Varken telefon eller e-post finns",
      id,
    );
    return { arrivalId: id, guest: a.guest_name ?? "?", channel: "none", status: "skipped" };
  }

  logMessage.run({
    arrival_id: id,
    arrival_date: a.arrival_date,
    channel,
    recipient: result.recipient,
    body,
    status: result.status,
    provider_id: result.providerId ?? null,
    error: result.error ?? null,
    dry_run: config.dryRun ? 1 : 0,
  });

  const newStatus = result.ok ? "sent" : "failed";
  db.prepare(
    "UPDATE arrivals SET status=?, channel=?, note=?, updated_at=datetime('now') WHERE id=?",
  ).run(newStatus, channel, result.error ?? null, id);

  return {
    arrivalId: id,
    guest: a.guest_name ?? "?",
    channel,
    status: result.status,
    error: result.error,
  };
}

export interface JobResult {
  date: string;
  arrivalsFound: number;
  sent: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  outcomes: SendOutcome[];
  bikes: BikeJobResult;
}

// Hela morgonkörningen: synka -> förbered -> (ev.) skicka.
export async function runMorningJob(opts: {
  date?: string;
  trigger?: "cron" | "manual";
  send?: boolean;
  sync?: boolean;
  bikes?: boolean;
}): Promise<JobResult> {
  const date = opts.date ?? todayInTz();
  const trigger = opts.trigger ?? "manual";
  const shouldSend = opts.send ?? config.autoSend;

  if (opts.sync !== false) {
    try {
      await syncBookings();
    } catch (err) {
      console.error("[job] BookVisit-synk misslyckades:", err);
    }
  }

  const arrivals = prepareArrivals(date);
  const outcomes: SendOutcome[] = [];

  if (shouldSend) {
    for (const a of arrivals) {
      if (a.status === "sent") continue;
      const out = await sendForArrival(a.id);
      outcomes.push(out);
    }
  }

  // Cykel-notiser (samma körning, egen text). Förbereds alltid; skickas om
  // shouldSend och inte uttryckligen avstängt (t.ex. "Skicka koder"-knappen).
  const bikes = await runBikeNotifications({ date, send: shouldSend && opts.bikes !== false });

  const sent = outcomes.filter((o) => ["sent", "dry-run", "canary"].includes(o.status)).length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;

  db.prepare(
    `INSERT INTO job_runs (run_date, trigger, arrivals_found, sent, failed, skipped, dry_run, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    date,
    trigger,
    arrivals.length,
    sent,
    failed,
    skipped,
    config.dryRun ? 1 : 0,
    JSON.stringify(outcomes).slice(0, 4000),
  );

  return { date, arrivalsFound: arrivals.length, sent, failed, skipped, dryRun: config.dryRun, outcomes, bikes };
}
