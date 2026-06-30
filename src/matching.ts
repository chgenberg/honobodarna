import { db } from "./db.js";

export interface Cabin {
  id: number;
  name: string;
  bookvisit_room_id: string | null;
  room_type_label: string | null;
  door_code: string;
  image_url: string | null;
  capacity: string | null;
  sort_order: number;
  active: number;
}

export function listCabins(includeInactive = false): Cabin[] {
  const sql = includeInactive
    ? "SELECT * FROM cabins ORDER BY sort_order, name"
    : "SELECT * FROM cabins WHERE active = 1 ORDER BY sort_order, name";
  return db.prepare(sql).all() as Cabin[];
}

export function getCabin(id: number): Cabin | undefined {
  return db.prepare("SELECT * FROM cabins WHERE id = ?").get(id) as Cabin | undefined;
}

// Tilldelar fysiska stugor till alla ej-tilldelade ankomster för ett datum.
// Logik:
//  - matcha på BookVisit-rumstyp (room_id)
//  - en ledig stuga av rätt typ väljs (occupancy-medveten inom datumet)
//  - om typen har > 1 stuga flaggas raden för granskning (needs_review = 1)
//  - om ingen stuga matchar flaggas den också för granskning
export function assignCabinsForDate(date: string): void {
  const cabins = listCabins();
  const arrivals = db
    .prepare(
      `SELECT id, booking_code, room_id, cabin_id, status FROM arrivals
       WHERE arrival_date = ? ORDER BY id`,
    )
    .all(date) as Array<{
    id: number;
    booking_code: string;
    room_id: string | null;
    cabin_id: number | null;
    status: string;
  }>;

  const update = db.prepare(
    "UPDATE arrivals SET cabin_id = ?, needs_review = ?, updated_at = datetime('now') WHERE id = ?",
  );
  const getUpload = db.prepare(
    "SELECT cabin_id FROM room_assignments WHERE booking_code = ? AND (arrival_date = ? OR arrival_date IS NULL) ORDER BY arrival_date DESC LIMIT 1",
  );

  const taken = new Set<number>();

  // Pass 1: uppladdad ankomstlista är auktoritativ (överstyr gissning och manuellt val).
  for (const a of arrivals) {
    if (a.status === "sent") {
      if (a.cabin_id != null) taken.add(a.cabin_id);
      continue;
    }
    const up = getUpload.get(a.booking_code, date) as { cabin_id: number | null } | undefined;
    if (up && up.cabin_id != null) {
      update.run(up.cabin_id, 0, a.id);
      a.cabin_id = up.cabin_id;
      taken.add(up.cabin_id);
    } else if (a.cabin_id != null) {
      taken.add(a.cabin_id); // behåll manuellt val
    }
  }

  // Pass 2: auto-tilldela resten (varken uppladdat eller manuellt val).
  for (const a of arrivals) {
    if (a.status === "sent" || a.cabin_id != null) continue;

    const sameType = cabins.filter((c) => c.bookvisit_room_id && c.bookvisit_room_id === a.room_id);
    const free = sameType.filter((c) => !taken.has(c.id));

    if (sameType.length === 0) {
      update.run(null, 1, a.id);
      continue;
    }
    const chosen = free[0] ?? sameType[0];
    taken.add(chosen.id);
    update.run(chosen.id, sameType.length > 1 ? 1 : 0, a.id);
  }
}
