// Fyller telefon/e-post på ankomster som kommit in via ankomstlista men
// saknar kontakt (Excel har sällan de kolumnerna; OTA-bokningar saknas i API:t).
import { db } from "./db.js";
import { fetchBookingsByCodes, normalizePhone } from "./bookvisit.js";
import { findCustomerByName } from "./customers.js";

export interface EnrichResult {
  fromApi: number;
  fromCustomers: number;
}

const updateArrivalContact = db.prepare(`
  UPDATE arrivals
  SET phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      updated_at = datetime('now')
  WHERE id = ?
`);

export async function enrichMissingContacts(date: string): Promise<EnrichResult> {
  const rows = db
    .prepare(
      `SELECT id, booking_code, guest_name, phone, email
       FROM arrivals
       WHERE arrival_date = ? AND room_id IS NOT NULL
         AND (phone IS NULL OR phone = '' OR email IS NULL OR email = '')`,
    )
    .all(date) as Array<{
    id: number;
    booking_code: string;
    guest_name: string | null;
    phone: string | null;
    email: string | null;
  }>;

  const assignmentCodes = db
    .prepare(
      `SELECT DISTINCT booking_code FROM room_assignments
       WHERE arrival_date = ? AND booking_code IS NOT NULL AND booking_code <> ''`,
    )
    .all(date) as Array<{ booking_code: string }>;

  const needApi = new Set<string>();
  for (const r of rows) needApi.add(r.booking_code);
  for (const a of assignmentCodes) needApi.add(a.booking_code);

  let fromApi = 0;
  if (needApi.size) {
    fromApi = await fetchBookingsByCodes([...needApi]);
  }

  const cached = db.prepare("SELECT phone, email FROM bv_bookings WHERE booking_code = ?");
  let fromCustomers = 0;

  const latest = db
    .prepare(
      `SELECT id, booking_code, guest_name, phone, email
       FROM arrivals
       WHERE arrival_date = ? AND room_id IS NOT NULL
         AND (phone IS NULL OR phone = '' OR email IS NULL OR email = '')`,
    )
    .all(date) as typeof rows;

  for (const r of latest) {
    const bv = cached.get(r.booking_code) as { phone: string | null; email: string | null } | undefined;
    let phone = r.phone || bv?.phone || null;
    let email = r.email || bv?.email || null;

    if ((!phone || !email) && r.guest_name) {
      const cust = findCustomerByName(r.guest_name);
      if (cust) {
        if (!phone && cust.phone) {
          phone = cust.phone;
          fromCustomers++;
        }
        if (!email && cust.email) email = cust.email;
      }
    }

    phone = normalizePhone(phone);
    email = email?.trim() || null;
    if ((phone && phone !== r.phone) || (email && email !== r.email)) {
      updateArrivalContact.run(phone, email, r.id);
    }
  }

  return { fromApi, fromCustomers };
}
