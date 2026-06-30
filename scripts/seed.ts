// Seedar exempel-sjöbodar och test-"personas" (fejkade bokningar) för dagens datum.
// Kör i testläge (DRY_RUN=true) för att verifiera hela flödet utan att skicka något.
//
//   npm run seed
//
import { db } from "../src/db.js";
import { todayInTz } from "../src/dates.js";
import { getRoomTypes } from "../src/bookvisit.js";

const today = todayInTz();

// Försök hitta riktiga rumstyp-id:n om en synk redan körts, annars använd de kända.
const known = {
  sjobod: "3c51a106-92b3-4e48-a801-dd199347c1c9", // Sea lodge / Sjöbod
  djur: "45341c8c-cd60-422a-aa6a-d80ccfc79c88", // Sea lodge pets friendly
  anpassad: "0b6165d3-569d-49af-ad50-31ff304d6b95", // Accessibility adapted
  villa: "564891fe-8378-471b-9029-b14e3966b7eb", // Villa
};
const types = Object.fromEntries(getRoomTypes().map((t) => [t.id, t.label]));

console.log("Seedar sjöbodar…");
db.prepare("DELETE FROM cabins").run();
const SJOBOD_CAP = "Max 6 personer · 50 m²";
const VILLA_CAP = "Max 8 personer · 120 m²";
// Fysisk verklighet (7 enheter). Namnen MÅSTE matcha "Tilldelat rum" i BookVisits
// ankomstlista (Excel): "Sjöbod 1".."Sjöbod 6" + "Villan".
//   Sjöbod 1 = djurvänlig · Sjöbod 2-5 = vanlig Sjöbod · Sjöbod 6 = anpassad · Villan
// [namn, rumstyp-id, etikett, kod, bild, kapacitet]
const cabins: Array<[string, string, string, string, string, string]> = [
  ["Sjöbod 1", known.djur, types[known.djur] ?? "Sjöbod djurvänlig", "1111", "/public/sjobod_djurvanlig1.png", SJOBOD_CAP],
  ["Sjöbod 2", known.sjobod, types[known.sjobod] ?? "Sjöbod", "2222", "/public/Sjobod.png", SJOBOD_CAP],
  ["Sjöbod 3", known.sjobod, types[known.sjobod] ?? "Sjöbod", "3333", "/public/Sjobod2.png", SJOBOD_CAP],
  ["Sjöbod 4", known.sjobod, types[known.sjobod] ?? "Sjöbod", "4444", "/public/Sjobod.png", SJOBOD_CAP],
  ["Sjöbod 5", known.sjobod, types[known.sjobod] ?? "Sjöbod", "5555", "/public/Sjobod2.png", SJOBOD_CAP],
  ["Sjöbod 6", known.anpassad, types[known.anpassad] ?? "Sjöbod tillgänglighetsanpassad", "6666", "/public/Sjobod.png", SJOBOD_CAP],
  ["Villan", known.villa, types[known.villa] ?? "Villa", "7777", "/public/Villa.png", VILLA_CAP],
];
const insCabin = db.prepare(
  `INSERT INTO cabins (name, bookvisit_room_id, room_type_label, door_code, image_url, capacity, sort_order)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
cabins.forEach((c, i) => insCabin.run(c[0], c[1], c[2], c[3], c[4], c[5], i + 1));

console.log(`Seedar test-personas för ${today}…`);
db.prepare("DELETE FROM bv_bookings WHERE booking_code LIKE 'TEST-%'").run();
const insBv = db.prepare(`
  INSERT INTO bv_bookings
    (booking_code, booking_guid, arrival_date, departure_date, status,
     guest_name, phone, phone_country, email, room_id, room_type_label)
  VALUES (@code, @guid, @arr, @dep, 'New', @name, @phone, '46', @email, @room, @label)
  ON CONFLICT(booking_code) DO UPDATE SET arrival_date=excluded.arrival_date
`);

const personas = [
  { code: "TEST-1", name: "Anna Andersson", phone: "+46701234567", email: "anna@example.com", room: known.sjobod, label: "Sjöbod" },
  { code: "TEST-2", name: "Björn Berg", phone: "+46707654321", email: "bjorn@example.com", room: known.sjobod, label: "Sjöbod" },
  { code: "TEST-3", name: "Cecilia Carlsson", phone: null, email: "cecilia@example.com", room: known.djur, label: "Sjöbod djurvänlig" },
  { code: "TEST-4", name: "David Dahl", phone: null, email: null, room: known.anpassad, label: "Anpassad" },
  { code: "TEST-5", name: "Eva Ek", phone: "+46760000000", email: "eva@example.com", room: known.villa, label: "Villa" },
];
for (const p of personas) {
  insBv.run({ ...p, guid: null, arr: today, dep: today });
}

console.log("Klart. Personas:");
for (const p of personas) {
  const contact = p.phone ? `SMS ${p.phone}` : p.email ? `mejl ${p.email}` : "saknar kontakt";
  console.log(`  - ${p.name}: ${p.label}, ${contact}`);
}
console.log(`\nGå till dashboarden, tryck "Synka & uppdatera" för ${today}, och testa "Skicka alla koder".`);
process.exit(0);
