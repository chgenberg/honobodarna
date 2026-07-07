// Driftnotiser till receptionen (info@honosjobodar.se):
//  - varningsmejl när sjöbodar inte kunde utläsas (systemet gissar aldrig)
//  - dagligt bekräftelsemejl efter att koderna skickats ut
import { db } from "./db.js";
import { config } from "./config.js";
import { sendOpsEmail, sendEmail } from "./email.js";
import { langForPhone } from "./templates.js";

// Tar emot leveranskvitto från 46elks. Om ett SMS inte kom fram (t.ex. USA-nummer
// som blockerar textavsändare) skickas dörrkoden automatiskt via e-post istället,
// och receptionen får ett driftmejl.
export async function recordSmsDelivery(providerId: string, status: string, deliveredAt?: string): Promise<void> {
  const log = db
    .prepare("SELECT id, arrival_id, arrival_date, recipient, body, delivery_status FROM message_log WHERE provider_id = ?")
    .get(providerId) as
    | { id: number; arrival_id: number | null; arrival_date: string | null; recipient: string; body: string; delivery_status: string | null }
    | undefined;
  if (!log) return;

  const alreadyFailed = log.delivery_status === "failed";
  db.prepare("UPDATE message_log SET delivery_status = ?, delivered_at = ? WHERE id = ?").run(
    status,
    deliveredAt ?? null,
    log.id,
  );
  if (status !== "failed" || alreadyFailed) return; // fallback endast en gång

  const arrival = log.arrival_id
    ? (db.prepare("SELECT id, guest_name, phone, email FROM arrivals WHERE id = ?").get(log.arrival_id) as
        | { id: number; guest_name: string | null; phone: string | null; email: string | null }
        | undefined)
    : undefined;
  const guest = arrival?.guest_name ?? log.recipient;

  if (arrival?.email) {
    const lang = langForPhone(arrival.phone);
    const subject =
      lang === "sv" ? "Välkommen till Hönö Sjöbodar – din dörrkod" : "Welcome to Hönö Sjöbodar – your door code";
    const r = await sendEmail(arrival.email, subject, log.body);
    db.prepare(
      `INSERT INTO message_log (arrival_id, arrival_date, channel, recipient, body, status, provider_id, error, dry_run)
       VALUES (?, ?, 'email', ?, ?, ?, ?, ?, ?)`,
    ).run(
      arrival.id,
      log.arrival_date,
      r.recipient,
      log.body,
      r.status,
      r.providerId ?? null,
      r.error ?? null,
      config.dryRun ? 1 : 0,
    );
    db.prepare("UPDATE arrivals SET channel = 'email', note = ?, updated_at = datetime('now') WHERE id = ?").run(
      "SMS levererades inte – koden skickad via e-post",
      arrival.id,
    );
    await sendOpsEmail(
      config.alertEmail,
      `ℹ️ SMS till ${guest} kom inte fram – koden skickad via e-post`,
      `SMS:et till ${guest} (${log.recipient}) kunde inte levereras enligt operatören.\n\nKoden har automatiskt skickats via e-post till ${arrival.email} istället (${r.ok ? "levererat till e-postservern" : "OBS: e-postskicket misslyckades också!"}).\n\nVanlig orsak: utländska operatörer (särskilt USA/+1) tillåter inte SMS med textavsändare.\n\n/ Hönö Sjöbodar-systemet`,
    );
  } else {
    db.prepare("UPDATE arrivals SET note = ?, updated_at = datetime('now') WHERE id = ?").run(
      "SMS levererades inte – ingen e-post finns, kontakta gästen",
      arrival?.id ?? -1,
    );
    await sendOpsEmail(
      config.alertEmail,
      `⚠️ SMS till ${guest} kom inte fram – åtgärd krävs`,
      `SMS:et till ${guest} (${log.recipient}) kunde inte levereras enligt operatören, och gästen saknar e-postadress.\n\nKontakta gästen på annat sätt och ge dörrkoden manuellt.\n\n/ Hönö Sjöbodar-systemet`,
    );
  }
}

interface SummaryRow {
  guest_name: string | null;
  cabin_name: string | null;
  status: string;
  channel: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  needs_review: number;
  is_package: number;
}

function rowsForDate(date: string): SummaryRow[] {
  return db
    .prepare(
      `SELECT a.guest_name, c.name AS cabin_name, a.status, a.channel, a.phone, a.email,
              a.note, a.needs_review, a.is_package
       FROM arrivals a LEFT JOIN cabins c ON c.id = a.cabin_id
       WHERE a.arrival_date = ? AND a.room_id IS NOT NULL
       ORDER BY a.guest_name`,
    )
    .all(date) as SummaryRow[];
}

// Ankomster som saknar bekräftad sjöbod (systemet vägrar gissa → kräver åtgärd).
export function unconfirmedForDate(date: string): SummaryRow[] {
  return rowsForDate(date).filter((r) => r.status !== "sent" && (r.needs_review || !r.cabin_name));
}

// Varningsmejl: skickas när sjöbodar inte kunde utläsas automatiskt.
export async function sendReviewAlert(date: string): Promise<void> {
  const rows = unconfirmedForDate(date);
  if (rows.length === 0) return;

  const list = rows
    .map((r) => `  • ${r.guest_name ?? "Okänd gäst"} (${r.is_package ? "paket" : "boende"})`)
    .join("\n");

  const body = `Hej!

${rows.length} incheckning${rows.length > 1 ? "ar" : ""} för ${date} saknar bekräftad sjöbod:

${list}

Systemet gissar aldrig – dessa får INGEN dörrkod förrän sjöboden är bekräftad.

Gör så här:
  1. Logga in på dashboarden och öppna Idag-sidan.
  2. Välj rätt sjöbod i listan för varje gäst (eller ladda upp ankomstlistan från BookVisit).
  3. Tryck "Skicka alla koder nu".

Detta mejl skickas automatiskt när den automatiska hämtningen från BookVisit inte kunnat tilldela alla sjöbodar.

/ Hönö Sjöbodar-systemet`;

  await sendOpsEmail(
    config.alertEmail,
    `⚠️ ${rows.length} gäst${rows.length > 1 ? "er" : ""} saknar sjöbod – åtgärd krävs (${date})`,
    body,
  );
}

function contact(r: SummaryRow): string {
  if (r.channel === "sms" && r.phone) return `SMS till ${r.phone}`;
  if (r.channel === "email" && r.email) return `e-post till ${r.email}`;
  return r.phone ? `SMS till ${r.phone}` : r.email ? `e-post till ${r.email}` : "kontakt saknas";
}

// Bekräftelsemejl efter utskick: vad som skickats, vad som väntar och oklarheter.
export async function sendDailySummary(date: string): Promise<void> {
  const rows = rowsForDate(date);
  if (rows.length === 0) return;

  const sent = rows.filter((r) => r.status === "sent");
  const failed = rows.filter((r) => r.status === "failed");
  const waiting = rows.filter((r) => r.status !== "sent" && r.status !== "failed");
  const unclear = waiting.filter((r) => r.needs_review || !r.cabin_name);

  const bikes = db
    .prepare(
      "SELECT guest_name, status FROM bike_sends WHERE notify_date = ? ORDER BY guest_name",
    )
    .all(date) as Array<{ guest_name: string | null; status: string }>;
  const bikesSent = bikes.filter((b) => b.status === "sent").length;

  const lines: string[] = [];
  lines.push(`Utskicksrapport för ${date}`);
  lines.push("");
  lines.push(`Skickade dörrkoder: ${sent.length} av ${rows.length}`);
  for (const r of sent) {
    lines.push(`  ✓ ${r.guest_name ?? "Okänd"} → ${r.cabin_name ?? "?"}${r.is_package ? " (paket)" : ""} – ${contact(r)}`);
  }
  if (failed.length) {
    lines.push("");
    lines.push(`MISSLYCKADE (${failed.length}) – behöver åtgärd:`);
    for (const r of failed) {
      lines.push(`  ✗ ${r.guest_name ?? "Okänd"} → ${r.cabin_name ?? "?"} – ${contact(r)}${r.note ? ` (${r.note})` : ""}`);
    }
  }
  if (unclear.length) {
    lines.push("");
    lines.push(`OKLARA (${unclear.length}) – sjöbod ej bekräftad, ingen kod skickad:`);
    for (const r of unclear) {
      lines.push(`  ? ${r.guest_name ?? "Okänd"}${r.is_package ? " (paket)" : ""} – välj sjöbod i dashboarden och skicka`);
    }
  } else if (waiting.length) {
    lines.push("");
    lines.push(`Väntar (${waiting.length}):`);
    for (const r of waiting) {
      lines.push(`  • ${r.guest_name ?? "Okänd"} → ${r.cabin_name ?? "?"} – ${r.note ?? "ej skickad ännu"}`);
    }
  }
  if (bikes.length) {
    lines.push("");
    lines.push(`Cykel-SMS: ${bikesSent} av ${bikes.length} skickade.`);
  }
  lines.push("");
  lines.push(unclear.length || failed.length ? "⚠️ Det finns punkter ovan som behöver ses över." : "Allt klart – inga oklarheter. ✓");
  lines.push("");
  lines.push("/ Hönö Sjöbodar-systemet");

  const okAll = failed.length === 0 && unclear.length === 0;
  await sendOpsEmail(
    config.alertEmail,
    `${okAll ? "✓" : "⚠️"} Dörrkoder ${date}: ${sent.length}/${rows.length} skickade${okAll ? "" : " – oklarheter finns"}`,
    lines.join("\n"),
  );
}
