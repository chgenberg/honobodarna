import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- En fysisk sjöbod/stuga med sin nuvarande dörrkod.
CREATE TABLE IF NOT EXISTS cabins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,                 -- t.ex. "Sjöbod 1"
  bookvisit_room_id TEXT,                        -- vilken BookVisit-rumstyp stugan tillhör
  room_type_label TEXT,                          -- läsbar etikett, t.ex. "Sjöbod"
  door_code       TEXT NOT NULL DEFAULT '',      -- nuvarande dörrkod
  image_url       TEXT,                          -- bild på sjöboden (t.ex. /public/Sjobod.png)
  capacity        TEXT,                          -- t.ex. "Max 6 personer · 50 m²"
  sort_order      INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historik över kodbyten (vem/när/vad).
CREATE TABLE IF NOT EXISTS code_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cabin_id   INTEGER NOT NULL REFERENCES cabins(id) ON DELETE CASCADE,
  old_code   TEXT,
  new_code   TEXT NOT NULL,
  changed_by TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- En incheckning för ett visst datum, hämtad från BookVisit.
-- Unik per (booking_code, arrival_date) så vi aldrig dubbel-skickar.
CREATE TABLE IF NOT EXISTS arrivals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  arrival_date  TEXT NOT NULL,                   -- YYYY-MM-DD
  booking_code  TEXT NOT NULL,
  booking_guid  TEXT,
  guest_name    TEXT,
  phone         TEXT,                            -- normaliserat E.164 om möjligt
  email         TEXT,
  room_id       TEXT,                            -- BookVisit-rumstyp
  room_type_label TEXT,
  cabin_id      INTEGER REFERENCES cabins(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|ready|sent|failed|skipped
  channel       TEXT,                            -- sms|email|none
  needs_review  INTEGER NOT NULL DEFAULT 0,      -- 1 om matchningen är osäker
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booking_code, arrival_date)
);

-- Logg över varje faktiskt utskick (eller försök).
CREATE TABLE IF NOT EXISTS message_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  arrival_id   INTEGER REFERENCES arrivals(id) ON DELETE SET NULL,
  arrival_date TEXT,
  channel      TEXT NOT NULL,                    -- sms|email
  recipient    TEXT,
  body         TEXT,
  status       TEXT NOT NULL,                    -- sent|failed|dry-run|canary
  provider_id  TEXT,
  error        TEXT,
  dry_run      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Logg över hela morgonkörningar.
CREATE TABLE IF NOT EXISTS job_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date     TEXT NOT NULL,
  trigger      TEXT NOT NULL,                    -- cron|manual
  arrivals_found INTEGER NOT NULL DEFAULT 0,
  sent         INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  skipped      INTEGER NOT NULL DEFAULT 0,
  dry_run      INTEGER NOT NULL DEFAULT 0,
  detail       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lokal spegling av BookVisit-bokningar (för snabba uppslag + minskad API-last).
CREATE TABLE IF NOT EXISTS bv_bookings (
  booking_code    TEXT PRIMARY KEY,
  booking_guid    TEXT,
  arrival_date    TEXT,                          -- startDate (YYYY-MM-DD)
  departure_date  TEXT,
  status          TEXT,                          -- New|Changed|Cancelled
  guest_name      TEXT,
  phone           TEXT,
  phone_country   TEXT,
  email           TEXT,
  room_id         TEXT,
  room_type_label TEXT,
  has_bike        INTEGER NOT NULL DEFAULT 0,     -- bokningen innehåller cykel-tillägg
  bike_label      TEXT,                           -- "Cykel"/"Bikes"
  has_package     INTEGER NOT NULL DEFAULT 0,     -- paket (sjöbod + middag)
  package_label   TEXT,                           -- t.ex. "3-rätters Vinga-meny på Tullhuset"
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Utskick av cykel-notiser (egen idempotens, speglar arrivals men för cyklar).
CREATE TABLE IF NOT EXISTS bike_sends (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  notify_date  TEXT NOT NULL,
  booking_code TEXT NOT NULL,
  guest_name   TEXT,
  phone        TEXT,
  email        TEXT,
  bike_label   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending|sent|failed|skipped
  channel      TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booking_code, notify_date)
);

-- Rumstilldelningar uppladdade från Annas ankomstlista (Excel). Auktoritativ källa
-- för vilken fysisk sjöbod en gäst fått (det API:t inte exponerar).
CREATE TABLE IF NOT EXISTS room_assignments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_code TEXT NOT NULL,
  arrival_date TEXT,
  room_name    TEXT,                              -- "Sjöbod 2" från Excelen
  cabin_id     INTEGER REFERENCES cabins(id) ON DELETE SET NULL,
  guest_name   TEXT,
  source       TEXT NOT NULL DEFAULT 'upload',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booking_code, arrival_date)
);

-- Permanent kundregister (aggregeras från bokningarna, överlever rensning av gamla bokningar).
CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key   TEXT UNIQUE,                      -- lower(email) eller telefon
  name         TEXT,
  email        TEXT,
  phone        TEXT,
  stays_count  INTEGER NOT NULL DEFAULT 0,
  first_visit  TEXT,
  last_visit   TEXT,
  next_visit   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_next ON customers(next_visit);
CREATE INDEX IF NOT EXISTS idx_bikesends_date ON bike_sends(notify_date);
CREATE INDEX IF NOT EXISTS idx_arrivals_date ON arrivals(arrival_date);
CREATE INDEX IF NOT EXISTS idx_msglog_date ON message_log(arrival_date);
CREATE INDEX IF NOT EXISTS idx_bv_arrival ON bv_bookings(arrival_date);
CREATE INDEX IF NOT EXISTS idx_bv_status ON bv_bookings(status);
`);

// Enkel migration: lägg till kolumner som saknas i äldre databaser.
function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn("cabins", "image_url", "TEXT");
ensureColumn("cabins", "capacity", "TEXT");
ensureColumn("bv_bookings", "has_bike", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("bv_bookings", "bike_label", "TEXT");
ensureColumn("bv_bookings", "has_package", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("bv_bookings", "package_label", "TEXT");
ensureColumn("arrivals", "is_package", "INTEGER NOT NULL DEFAULT 0");
// Leveransstatus från 46elks DLR-webhook (skickat ≠ levererat).
ensureColumn("message_log", "delivery_status", "TEXT");
ensureColumn("message_log", "delivered_at", "TEXT");
// Index som beror på kolumner ovan (skapas efter migrationen).
db.exec("CREATE INDEX IF NOT EXISTS idx_bv_bike ON bv_bookings(has_bike)");

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

// Meddelandemallar finns i src/templates.ts (tre typer × två språk).
