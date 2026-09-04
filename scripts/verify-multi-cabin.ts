// Verifierar att en bokning med två sjöbodar sparar båda rummen och
// skickar ett kombinerat meddelande. Enkla bokningar och cyklar orörda.
//
//   npx tsx scripts/verify-multi-cabin.ts
//
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "hono-multi-cabin-"));
process.env.DATABASE_PATH = join(dir, "test.sqlite");
process.env.DRY_RUN = "true";
process.env.AUTO_SEND = "false";

const { db } = await import("../src/db.js");
const { applyAssignments, getAssignments } = await import("../src/uploads.js");
const { getCabinsForBooking } = await import("../src/matching.js");
const { prepareArrivals, sendForArrival } = await import("../src/job.js");
const { renderArrivalMessage, joinCabinNames } = await import("../src/templates.js");
const { unconfirmedForDate } = await import("../src/notify.js");

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`  FAIL  ${msg}`);
  } else {
    console.log(`  ok    ${msg}`);
  }
}

const date = "2026-09-04";
db.prepare(
  `INSERT INTO cabins (name, bookvisit_room_id, room_type_label, door_code, sort_order)
   VALUES
     ('Sjöbod 1', 'room-djur', 'Sjöbod djurvänlig', '1111', 1),
     ('Sjöbod 2', 'room-sjobod', 'Sjöbod', '2222', 2),
     ('Sjöbod 3', 'room-sjobod', 'Sjöbod', '3333', 3),
     ('Villan', 'room-villa', 'Villa', '7777', 7)`,
).run();

const cabins = db.prepare("SELECT id, name FROM cabins ORDER BY sort_order").all() as Array<{
  id: number;
  name: string;
}>;
const byName = Object.fromEntries(cabins.map((c) => [c.name, c.id]));

console.log("1) Två Frontdesk-rader med samma bokningskod");
applyAssignments([
  { bookingCode: "AT-1", room: "Sjöbod 1", date, guest: "Törnqvist, Anna" },
  { bookingCode: "AT-1", room: "Sjöbod 2", date, guest: "Törnqvist, Anna" },
  { bookingCode: "SINGLE", room: "Sjöbod 3", date, guest: "Ek, Eva" },
]);
const multi = getAssignments("AT-1", date);
assert(multi.length === 2, `två assignments sparade (fick ${multi.length})`);
assert(
  multi.map((r) => r.cabin_id).sort().join(",") === [byName["Sjöbod 1"], byName["Sjöbod 2"]].sort().join(","),
  "Sjöbod 1 och 2 finns båda",
);
assert(getAssignments("SINGLE", date).length === 1, "enkel bokning har en assignment");

console.log("2) Ny skrapa ersätter set (inte ackumulerar)");
applyAssignments([{ bookingCode: "AT-1", room: "Sjöbod 1", date, guest: "Törnqvist, Anna" }]);
assert(getAssignments("AT-1", date).length === 1, "omskrapa med ett rum lämnar ett rum");
applyAssignments([
  { bookingCode: "AT-1", room: "Sjöbod 1", date, guest: "Törnqvist, Anna" },
  { bookingCode: "AT-1", room: "Sjöbod 2", date, guest: "Törnqvist, Anna" },
]);
assert(getAssignments("AT-1", date).length === 2, "båda rummen tillbaka efter ny skrapa");

console.log("3) En arrival per bokning, båda stugorna matchade");
db.prepare(
  `INSERT INTO bv_bookings
     (booking_code, arrival_date, status, guest_name, phone, email, room_id, room_type_label, has_package)
   VALUES
     ('AT-1', ?, 'New', 'Anna Törnqvist', '+46701234567', 'anna@example.com', 'room-sjobod', 'Sjöbod', 1),
     ('SINGLE', ?, 'New', 'Eva Ek', '+46707654321', 'eva@example.com', 'room-sjobod', 'Sjöbod', 0)`,
).run(date, date);

const arrivals = prepareArrivals(date);
const anna = arrivals.find((a) => a.booking_code === "AT-1");
const eva = arrivals.find((a) => a.booking_code === "SINGLE");
assert(!!anna && !!eva, "båda ankomsterna skapades");
assert(arrivals.filter((a) => a.booking_code === "AT-1").length === 1, "en arrival-rad för Anna");
assert(anna?.needs_review === 0, "Anna behöver inte granskas");
assert(eva?.needs_review === 0, "Eva behöver inte granskas");

const annaCabins = getCabinsForBooking("AT-1", date, anna?.cabin_id);
assert(annaCabins.length === 2, `Anna har 2 stugor (fick ${annaCabins.length})`);
assert(
  annaCabins.map((c) => c.name).join(" + ") === "Sjöbod 1 + Sjöbod 2",
  "stugorna är Sjöbod 1 och 2",
);
assert(getCabinsForBooking("SINGLE", date, eva?.cabin_id).length === 1, "Eva har 1 stuga");
assert(unconfirmedForDate(date).length === 0, "inga oklarheter i review-listan");

console.log("4) Kombinerat utskick (paket, båda koderna, middag en gång)");
const msg = renderArrivalMessage({
  type: "package",
  lang: "sv",
  guestName: "Anna Törnqvist",
  cabins: annaCabins,
  hasSeafood: false,
});
assert(msg.body.includes("Sjöbod 1: 1111"), "meddelandet innehåller kod 1111");
assert(msg.body.includes("Sjöbod 2: 2222"), "meddelandet innehåller kod 2222");
assert(msg.body.includes("Sjöbod 1 och Sjöbod 2"), "stugnamn sammanslagna");
assert(
  (msg.body.match(/middag bokat på Tullhuset/g) ?? []).length === 1,
  "middagspaketet nämns en gång",
);

const out = await sendForArrival(anna!.id);
assert(out.status === "dry-run", `utskick status dry-run (fick ${out.status})`);
const logs = db
  .prepare("SELECT channel, body FROM message_log WHERE arrival_id = ?")
  .all(anna!.id) as Array<{ channel: string; body: string }>;
assert(logs.length === 2, `SMS + e-post loggade (fick ${logs.length})`);
assert(
  logs.every((l) => l.body.includes("1111") && l.body.includes("2222")),
  "båda kanalerna har båda koderna",
);

console.log("5) Enkel bokning använder vanlig mall");
const evaCabins = getCabinsForBooking("SINGLE", date, eva?.cabin_id);
const single = renderArrivalMessage({
  type: "sjobod",
  lang: "sv",
  guestName: "Eva Ek",
  cabins: evaCabins,
  hasSeafood: false,
});
assert(single.body.includes("Ni ska bo i Sjöbod 3"), "enkel mall med en stuga");
assert(!single.body.includes("koder ni använder"), "inte flerbods-formuleringen");
const evaOut = await sendForArrival(eva!.id);
assert(evaOut.status === "dry-run", "enkel bokning skickas");

console.log("6) Cykel-idempotens oförändrad");
const bikeIdx = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_bike_sends_booking'")
  .get() as { name: string } | undefined;
assert(!!bikeIdx, "unikt cykel-index finns kvar");
db.prepare(
  `INSERT INTO bike_sends (notify_date, booking_code, guest_name, status)
   VALUES (?, 'AT-1', 'Anna Törnqvist', 'pending')`,
).run(date);
let bikeDup = false;
try {
  db.prepare(
    `INSERT INTO bike_sends (notify_date, booking_code, guest_name, status)
     VALUES (?, 'AT-1', 'Anna Törnqvist', 'pending')`,
  ).run("2026-09-05");
} catch {
  bikeDup = true;
}
assert(bikeDup, "andra cykelrad för samma bokning stoppas");
assert(
  (db.prepare("SELECT COUNT(*) AS n FROM bike_sends WHERE booking_code = 'AT-1'").get() as { n: number }).n === 1,
  "fortfarande en cykelrad",
);

console.log("7) Villa + sjöbod flaggas för granskning");
applyAssignments([
  { bookingCode: "MIX", room: "Sjöbod 1", date, guest: "Blandad, Bo" },
  { bookingCode: "MIX", room: "Villan", date, guest: "Blandad, Bo" },
]);
db.prepare(
  `INSERT INTO bv_bookings
     (booking_code, arrival_date, status, guest_name, phone, email, room_id, room_type_label)
   VALUES ('MIX', ?, 'New', 'Bo Blandad', '+46701111111', 'bo@example.com', 'room-sjobod', 'Sjöbod')`,
).run(date);
prepareArrivals(date);
const mix = db
  .prepare("SELECT needs_review FROM arrivals WHERE booking_code = 'MIX' AND arrival_date = ?")
  .get(date) as { needs_review: number } | undefined;
assert(mix?.needs_review === 1, "blandad villa+sjöbod kräver granskning");
assert(getCabinsForBooking("MIX", date).length === 2, "båda stugorna finns ändå");
assert(joinCabinNames(["Sjöbod 1", "Villan"], "sv") === "Sjöbod 1 och Villan", "namnsammanslagning");

rmSync(dir, { recursive: true, force: true });

if (failed) {
  console.error(`\n${failed} test misslyckades.`);
  process.exit(1);
}
console.log("\nAlla multi-cabin-tester gick igenom.");
