import * as XLSX from "xlsx";
import { db } from "./db.js";
import { listCabins } from "./matching.js";
import { normalizePhone } from "./bookvisit.js";

export interface UploadSummary {
  rows: number;
  assigned: number; // rader vars rum kunde kopplas till en sjöbod
  unresolved: string[]; // rumsnamn i Excelen som inte matchar någon sjöbod
  dates: string[];
  missingFromApi: string[]; // Frontdesk-bokningar som REST-API:t inte exponerar
}

// Hittar värdet i en rad utifrån ett eller flera möjliga kolumnnamn (skiftlägesokänsligt, "innehåller").
function pick(row: Record<string, unknown>, patterns: string[]): string {
  const keys = Object.keys(row);
  for (const p of patterns) {
    const key = keys.find((k) => k.trim().toLowerCase().includes(p.toLowerCase()));
    if (key != null) {
      const v = row[key];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

function toDate(v: string): string {
  const m = v.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : v;
}

// Kopplar ett rumsnamn från Excelen ("Sjöbod 2", "Villa") till en sjöbod i systemet.
function resolveCabinId(roomName: string): number | null {
  const cabins = listCabins(true);
  const n = roomName.trim().toLowerCase();
  if (!n) return null;

  // 1) Exakt namnmatchning ("Sjöbod 4" → sjöbod med samma namn).
  let c = cabins.find((x) => x.name.trim().toLowerCase() === n);
  if (c) return c.id;

  // 2) Villa ("Villa"/"Villan").
  if (/villa/i.test(roomName)) {
    c = cabins.find((x) => /villa/i.test(x.name) || /villa/i.test(x.room_type_label ?? ""));
    if (c) return c.id;
  }

  // 3) Numrerad sjöbod – tål små variationer ("Sjöbod nr 4", dubbla mellanslag).
  const num = roomName.match(/(\d+)/)?.[1];
  if (num && /sj[öo]bod/i.test(roomName)) {
    c = cabins.find((x) => /sj[öo]bod/i.test(x.name) && new RegExp(`(^|\\D)${num}($|\\D)`).test(x.name));
    if (c) return c.id;
  }
  return null;
}

const upsertAssignment = db.prepare(`
  INSERT INTO room_assignments (booking_code, arrival_date, room_name, cabin_id, guest_name, source)
  VALUES (@booking_code, @arrival_date, @room_name, @cabin_id, @guest_name, 'upload')
  ON CONFLICT(booking_code, arrival_date) DO UPDATE SET
    room_name=excluded.room_name, cabin_id=excluded.cabin_id,
    guest_name=excluded.guest_name, created_at=datetime('now')
`);

export interface AssignmentInput {
  bookingCode: string;
  room: string;
  date: string;
  guest: string;
  phone?: string;
  email?: string;
}

function normalizeGuestName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  const [last, first] = clean.split(",").map((s) => s.trim());
  return first ? `${first} ${last}`.trim() : clean;
}

const hasApiBooking = db.prepare(
  "SELECT 1 FROM bv_bookings WHERE booking_code = ? AND room_id IS NOT NULL LIMIT 1",
);
const cabinInfo = db.prepare(
  "SELECT bookvisit_room_id, room_type_label FROM cabins WHERE id = ?",
);
const upsertFallbackArrival = db.prepare(`
  INSERT INTO arrivals
    (arrival_date, booking_code, guest_name, phone, email, room_id,
     room_type_label, cabin_id, status, needs_review, note)
  VALUES
    (@arrival_date, @booking_code, @guest_name, @phone, @email, @room_id,
     @room_type_label, @cabin_id, 'pending', 0, @note)
  ON CONFLICT(booking_code, arrival_date) DO UPDATE SET
    guest_name=excluded.guest_name,
    phone=COALESCE(excluded.phone, arrivals.phone),
    email=COALESCE(excluded.email, arrivals.email),
    room_id=excluded.room_id,
    room_type_label=excluded.room_type_label,
    cabin_id=excluded.cabin_id,
    needs_review=0,
    note=excluded.note,
    updated_at=datetime('now')
`);

// Sparar en lista rumstilldelningar (från Excel eller skrapad tabell).
export function applyAssignments(items: AssignmentInput[]): UploadSummary {
  let assigned = 0;
  const unresolved = new Set<string>();
  const dates = new Set<string>();
  const missingFromApi = new Set<string>();

  const tx = db.transaction(() => {
    for (const it of items) {
      const bookingCode = it.bookingCode.trim();
      if (!bookingCode) continue;
      const room = it.room.trim();
      const date = toDate(it.date.trim());
      const cabinId = resolveCabinId(room);
      if (room && cabinId == null) unresolved.add(room);
      if (cabinId != null) assigned++;
      if (date) dates.add(date);
      upsertAssignment.run({
        booking_code: bookingCode,
        arrival_date: date || null,
        room_name: room || null,
        cabin_id: cabinId,
        guest_name: it.guest.trim() || null,
      });

      // Frontdesk kan innehålla PMS-bokningar som REST-API:t svarar 404 för.
      // Skapa då en reservankomst direkt från Frontdesk. Första POST:en gör
      // raden synlig; robotens andra POST fyller telefon/e-post från detaljsidan.
      if (!hasApiBooking.get(bookingCode) && date && cabinId != null) {
        missingFromApi.add(bookingCode);
        const cabin = cabinInfo.get(cabinId) as
          | { bookvisit_room_id: string | null; room_type_label: string | null }
          | undefined;
        upsertFallbackArrival.run({
          arrival_date: date,
          booking_code: bookingCode,
          guest_name: normalizeGuestName(it.guest) || "Okänd gäst",
          phone: normalizePhone(it.phone || null),
          email: it.email?.trim() || null,
          room_id: cabin?.bookvisit_room_id ?? `frontdesk:${cabinId}`,
          room_type_label: cabin?.room_type_label ?? room,
          cabin_id: cabinId,
          note:
            it.phone || it.email
              ? "Hämtad från Frontdesk (saknas i BookVisit REST-API)"
              : "Saknas i REST-API – väntar på kontaktuppgifter från Frontdesk",
        });
      }
    }
  });
  tx();

  return {
    rows: items.length,
    assigned,
    unresolved: [...unresolved],
    dates: [...dates],
    missingFromApi: [...missingFromApi],
  };
}

// Parsar en uppladdad ankomstlista (Excel) och sparar rumstilldelningarna.
export function parseAndApplyArrivalList(buffer: Buffer): UploadSummary {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  return applyAssignments(
    rows.map((row) => ({
      bookingCode: pick(row, ["bokning", "booking", "reservation"]),
      room: pick(row, ["tilldelat rum", "rum", "room", "cabin", "stuga"]),
      date: pick(row, ["ankomst", "arrival"]),
      guest: pick(row, ["gästnamn", "namn", "name", "guest"]),
      phone: pick(row, ["telefon", "phone", "mobile", "mobil"]),
      email: pick(row, ["e-post", "email", "mail"]),
    })),
  );
}

export function getAssignment(bookingCode: string, date: string): { cabin_id: number | null; room_name: string | null } | undefined {
  return db
    .prepare(
      "SELECT cabin_id, room_name FROM room_assignments WHERE booking_code = ? AND (arrival_date = ? OR arrival_date IS NULL) ORDER BY arrival_date DESC LIMIT 1",
    )
    .get(bookingCode, date) as { cabin_id: number | null; room_name: string | null } | undefined;
}

export function countAssignmentsForDate(date: string): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM room_assignments WHERE arrival_date = ?").get(date) as { n: number }
  ).n;
}
