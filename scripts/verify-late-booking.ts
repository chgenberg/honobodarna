// Sena samma-dags-bokningar: Excel/Frontdesk utan telefon → komplettera
// från kundregistret. API-anrop testas inte här (ingen nyckel i CI).
//
//   npx tsx scripts/verify-late-booking.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "hono-late-"));
process.env.DATABASE_PATH = join(dir, "test.sqlite");
process.env.DRY_RUN = "true";
process.env.AUTO_SEND = "false";

const { db } = await import("../src/db.js");
const { applyAssignments } = await import("../src/uploads.js");
const { findCustomerByName } = await import("../src/customers.js");
const { enrichMissingContacts } = await import("../src/enrich.js");
const { getArrivals, prepareArrivals } = await import("../src/job.js");

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`  FAIL  ${msg}`);
  } else {
    console.log(`  ok    ${msg}`);
  }
}

const date = "2026-11-03";
db.prepare(
  `INSERT INTO cabins (name, bookvisit_room_id, room_type_label, door_code, sort_order)
   VALUES ('Sjöbod 4', 'room-sjobod', 'Sjöbod', '4444', 4)`,
).run();

db.prepare(
  `INSERT INTO customers (dedupe_key, name, email, phone, stays_count)
   VALUES ('anna@example.com', 'Anna Törnqvist', 'anna@example.com', '+46701234567', 2)`,
).run();

console.log("1) Kunduppslag på exakt namn");
assert(findCustomerByName("Anna Törnqvist")?.phone === "+46701234567", "hittar återkommande gäst");
assert(findCustomerByName("Törnqvist, Anna") === undefined, "gissar inte på omvänt namn");
assert(findCustomerByName("Okänd Gäst") === undefined, "okänt namn ger inget");

console.log("2) Excel-rad utan kontakt skapar ankomst");
applyAssignments([
  { bookingCode: "LATE01", room: "Sjöbod 4", date, guest: "Törnqvist, Anna" },
]);
prepareArrivals(date);
const before = getArrivals(date).find((a) => a.booking_code === "LATE01");
assert(!!before, "fallback-ankomst skapad från ankomstlistan");
assert(!before?.phone && !before?.email, "Excel utan kolumner ger ingen kontakt");
assert(before?.guest_name === "Anna Törnqvist", "namn vänds till förnamn efternamn");

console.log("3) Komplettering från kundregistret");
const result = await enrichMissingContacts(date);
assert(result.fromCustomers === 1, `en kontakt från kundregistret (fick ${result.fromCustomers})`);
const after = getArrivals(date).find((a) => a.booking_code === "LATE01");
assert(after?.phone === "+46701234567", "telefon ifylld");
assert(after?.email === "anna@example.com", "e-post ifylld");

rmSync(dir, { recursive: true, force: true });
if (failed) {
  console.error(`\n${failed} test misslyckades.`);
  process.exit(1);
}
console.log("\nAlla late-booking-tester gick igenom.");
