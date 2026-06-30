import * as XLSX from "xlsx";
import { db } from "./db.js";
import { listCabins } from "./matching.js";

export interface UploadSummary {
  rows: number;
  assigned: number; // rader vars rum kunde kopplas till en sjöbod
  unresolved: string[]; // rumsnamn i Excelen som inte matchar någon sjöbod
  dates: string[];
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

// Parsar en uppladdad ankomstlista (Excel) och sparar rumstilldelningarna.
export function parseAndApplyArrivalList(buffer: Buffer): UploadSummary {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  let assigned = 0;
  const unresolved = new Set<string>();
  const dates = new Set<string>();

  const tx = db.transaction(() => {
    for (const row of rows) {
      const bookingCode = pick(row, ["bokning", "booking", "reservation"]);
      const room = pick(row, ["tilldelat rum", "rum", "room", "cabin", "stuga"]);
      const date = toDate(pick(row, ["ankomst", "arrival"]));
      const guest = pick(row, ["gästnamn", "namn", "name", "guest"]);
      if (!bookingCode) continue;
      const cabinId = resolveCabinId(room);
      if (room && cabinId == null) unresolved.add(room);
      if (cabinId != null) assigned++;
      if (date) dates.add(date);
      upsertAssignment.run({
        booking_code: bookingCode,
        arrival_date: date || null,
        room_name: room || null,
        cabin_id: cabinId,
        guest_name: guest || null,
      });
    }
  });
  tx();

  return {
    rows: rows.length,
    assigned,
    unresolved: [...unresolved],
    dates: [...dates],
  };
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
