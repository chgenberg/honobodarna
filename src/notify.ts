// Driftnotiser till receptionen (info@honosjobodar.se):
//  - varningsmejl när sjöbodar inte kunde utläsas (systemet gissar aldrig)
//  - dagligt bekräftelsemejl efter att koderna skickats ut
import { db } from "./db.js";
import { config } from "./config.js";
import { sendOpsEmail } from "./email.js";

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
