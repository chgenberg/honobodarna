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
      `SELECT id, room_id, cabin_id, status FROM arrivals
       WHERE arrival_date = ? ORDER BY id`,
    )
    .all(date) as Array<{ id: number; room_id: string | null; cabin_id: number | null; status: string }>;

  // Stugor redan upptagna denna dag (manuellt valda eller redan skickade).
  const taken = new Set<number>(
    arrivals.filter((a) => a.cabin_id != null).map((a) => a.cabin_id as number),
  );

  const update = db.prepare(
    "UPDATE arrivals SET cabin_id = ?, needs_review = ?, updated_at = datetime('now') WHERE id = ?",
  );

  for (const a of arrivals) {
    if (a.cabin_id != null) continue; // redan tilldelad/överstyrd – rör inte
    if (a.status === "sent") continue;

    const sameType = cabins.filter((c) => c.bookvisit_room_id && c.bookvisit_room_id === a.room_id);
    const free = sameType.filter((c) => !taken.has(c.id));

    if (sameType.length === 0) {
      // Ingen stuga mappad mot denna rumstyp – kräver granskning.
      update.run(null, 1, a.id);
      continue;
    }

    const chosen = free[0] ?? sameType[0];
    taken.add(chosen.id);
    // Granskning behövs om typen har flera fysiska stugor (tvetydig matchning).
    const needsReview = sameType.length > 1 ? 1 : 0;
    update.run(chosen.id, needsReview, a.id);
  }
}
