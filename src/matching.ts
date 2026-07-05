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

// Tilldelar fysiska stugor till ankomster för ett datum. REGEL: gissa ALDRIG.
// En sjöbod sätts bara när den kan utläsas säkert:
//  1. uppladdad/skrapad ankomstlista (auktoritativ, överstyr gissning)
//  2. manuellt val i dashboarden (needs_review = 0)
//  3. deterministisk rumstyp – typen har exakt EN fysisk stuga
//     (djurvänlig = Sjöbod 1, anpassad = Sjöbod 6, Villa = Villan)
// Allt annat lämnas OTILLDELAT med needs_review = 1 (varning i UI + mejl,
// och massutskicket vägrar skicka).
export function assignCabinsForDate(date: string): void {
  const cabins = listCabins();
  const arrivals = db
    .prepare(
      `SELECT id, booking_code, room_id, cabin_id, status, needs_review FROM arrivals
       WHERE arrival_date = ? ORDER BY id`,
    )
    .all(date) as Array<{
    id: number;
    booking_code: string;
    room_id: string | null;
    cabin_id: number | null;
    status: string;
    needs_review: number;
  }>;

  const update = db.prepare(
    "UPDATE arrivals SET cabin_id = ?, needs_review = ?, updated_at = datetime('now') WHERE id = ?",
  );
  const getUpload = db.prepare(
    "SELECT cabin_id FROM room_assignments WHERE booking_code = ? AND (arrival_date = ? OR arrival_date IS NULL) ORDER BY arrival_date DESC LIMIT 1",
  );

  for (const a of arrivals) {
    if (a.status === "sent") continue;

    // 1) Uppladdad/skrapad ankomstlista är auktoritativ.
    const up = getUpload.get(a.booking_code, date) as { cabin_id: number | null } | undefined;
    if (up && up.cabin_id != null) {
      update.run(up.cabin_id, 0, a.id);
      continue;
    }

    // 2) Manuellt bekräftat val i dashboarden behålls.
    if (a.cabin_id != null && !a.needs_review) continue;

    // 3) Deterministisk typ: exakt en fysisk stuga av denna rumstyp.
    const sameType = cabins.filter((c) => c.bookvisit_room_id && c.bookvisit_room_id === a.room_id);
    if (sameType.length === 1) {
      update.run(sameType[0].id, 0, a.id);
      continue;
    }

    // Kan inte utläsas → lämna otilldelad (rensar ev. gammal gissning). Ingen gissning.
    update.run(null, 1, a.id);
  }
}
