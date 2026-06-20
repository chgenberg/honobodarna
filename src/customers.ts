import { db } from "./db.js";
import { todayInTz } from "./dates.js";

export interface Customer {
  id: number;
  dedupe_key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  stays_count: number;
  first_visit: string | null;
  last_visit: string | null;
  next_visit: string | null;
}

interface BookingRow {
  guest_name: string | null;
  email: string | null;
  phone: string | null;
  arrival_date: string | null;
}

// Bygger om kundregistret från bokningsspeglingen.
// Deduplicerar på e-post (annars telefon). Permanent tabell – ackumulerar
// alla kunder vi sett, även om gamla bokningar senare rensas bort.
export function rebuildCustomers(): number {
  const rows = db
    .prepare(
      `SELECT guest_name, email, phone, arrival_date
       FROM bv_bookings
       WHERE status IS NOT 'Cancelled' AND (email IS NOT NULL OR phone IS NOT NULL)`,
    )
    .all() as BookingRow[];

  const today = todayInTz();
  const map = new Map<
    string,
    {
      key: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      stays: number;
      first: string | null;
      last: string | null;
      next: string | null;
      latestArr: string;
    }
  >();

  for (const r of rows) {
    const email = r.email?.trim() || null;
    const phone = r.phone?.trim() || null;
    const key = (email ? email.toLowerCase() : phone) ?? "";
    if (!key) continue;
    let c = map.get(key);
    if (!c) {
      c = { key, name: r.guest_name, email, phone, stays: 0, first: null, last: null, next: null, latestArr: "" };
      map.set(key, c);
    }
    c.stays++;
    const d = r.arrival_date;
    if (d) {
      if (!c.first || d < c.first) c.first = d;
      if (!c.last || d > c.last) c.last = d;
      if (d >= today && (!c.next || d < c.next)) c.next = d;
      // Använd kontaktuppgifter/namn från den senaste bokningen.
      if (d > c.latestArr) {
        c.latestArr = d;
        if (r.guest_name) c.name = r.guest_name;
        if (email) c.email = email;
        if (phone) c.phone = phone;
      }
    }
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM customers").run();
    const ins = db.prepare(
      `INSERT INTO customers (dedupe_key, name, email, phone, stays_count, first_visit, last_visit, next_visit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of map.values()) {
      ins.run(c.key, c.name, c.email, c.phone, c.stays, c.first, c.last, c.next);
    }
  });
  tx();
  return map.size;
}

export interface CustomerStats {
  total: number;
  withPhone: number;
  withEmail: number;
  upcoming: number;
}

export function customerStats(): CustomerStats {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN phone IS NOT NULL AND phone <> '' THEN 1 ELSE 0 END) AS withPhone,
        SUM(CASE WHEN email IS NOT NULL AND email <> '' THEN 1 ELSE 0 END) AS withEmail,
        SUM(CASE WHEN next_visit IS NOT NULL THEN 1 ELSE 0 END) AS upcoming
      FROM customers`,
    )
    .get() as { total: number; withPhone: number; withEmail: number; upcoming: number };
  return {
    total: row.total ?? 0,
    withPhone: row.withPhone ?? 0,
    withEmail: row.withEmail ?? 0,
    upcoming: row.upcoming ?? 0,
  };
}

export function listCustomers(query?: string, limit = 500): Customer[] {
  if (query && query.trim()) {
    const q = `%${query.trim().toLowerCase()}%`;
    return db
      .prepare(
        `SELECT * FROM customers
         WHERE lower(name) LIKE ? OR lower(email) LIKE ? OR phone LIKE ?
         ORDER BY (next_visit IS NULL), next_visit, name LIMIT ?`,
      )
      .all(q, q, q, limit) as Customer[];
  }
  return db
    .prepare(
      `SELECT * FROM customers ORDER BY (next_visit IS NULL), next_visit, name LIMIT ?`,
    )
    .all(limit) as Customer[];
}

export function getCustomer(id: number): Customer | undefined {
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as Customer | undefined;
}

export function customersWithPhone(): Customer[] {
  return db
    .prepare("SELECT * FROM customers WHERE phone IS NOT NULL AND phone <> '' ORDER BY name")
    .all() as Customer[];
}
