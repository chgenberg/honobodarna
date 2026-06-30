// Idempotent migrering: ser till att sjöbodarna heter exakt som BookVisits
// ankomstlista (Excel): "Sjöbod 1".."Sjöbod 6" + "Villan", med rätt rumstyp-koppling.
//
//   Sjöbod 1 = djurvänlig · Sjöbod 2-5 = vanlig Sjöbod · Sjöbod 6 = anpassad · Villan
//
// SÄKERT: raderar ALDRIG en sjöbod och rör ALDRIG dörrkoder. Befintliga rader döps
// om/uppdateras (koden behålls), saknade enheter skapas med platshållarkod "0000".
// Rader som inte kunde matchas listas så att en människa kan granska dem.
//
// Kör:  npx tsx scripts/migrate-cabins.ts
import { db } from "../src/db.js";

const known = {
  sjobod: "3c51a106-92b3-4e48-a801-dd199347c1c9",
  djur: "45341c8c-cd60-422a-aa6a-d80ccfc79c88",
  anpassad: "0b6165d3-569d-49af-ad50-31ff304d6b95",
  villa: "564891fe-8378-471b-9029-b14e3966b7eb",
};

interface CabinRow {
  id: number;
  name: string;
  door_code: string;
  bookvisit_room_id: string | null;
}

// Önskat sluttillstånd. aliases = möjliga gamla namn (skiftlägesokänsligt, "innehåller").
const desired: Array<{ name: string; type: string; label: string; img: string; aliases: string[] }> = [
  { name: "Sjöbod 1", type: known.djur, label: "Sjöbod djurvänlig", img: "/public/sjobod_djurvanlig1.png", aliases: ["sjöbod 1", "djurvänlig"] },
  { name: "Sjöbod 2", type: known.sjobod, label: "Sjöbod", img: "/public/Sjobod.png", aliases: ["sjöbod 2"] },
  { name: "Sjöbod 3", type: known.sjobod, label: "Sjöbod", img: "/public/Sjobod2.png", aliases: ["sjöbod 3"] },
  { name: "Sjöbod 4", type: known.sjobod, label: "Sjöbod", img: "/public/Sjobod.png", aliases: ["sjöbod 4"] },
  { name: "Sjöbod 5", type: known.sjobod, label: "Sjöbod", img: "/public/Sjobod2.png", aliases: ["sjöbod 5"] },
  { name: "Sjöbod 6", type: known.anpassad, label: "Sjöbod tillgänglighetsanpassad", img: "/public/Sjobod.png", aliases: ["sjöbod 6", "anpassad", "tillgäng"] },
  { name: "Villan", type: known.villa, label: "Villa", img: "/public/Villa.png", aliases: ["villan", "villa"] },
];

const existing = db.prepare("SELECT id, name, door_code, bookvisit_room_id FROM cabins ORDER BY id").all() as CabinRow[];
const used = new Set<number>();

function findMatch(d: (typeof desired)[number]): CabinRow | undefined {
  const exact = existing.find((c) => !used.has(c.id) && c.name.trim().toLowerCase() === d.name.toLowerCase());
  if (exact) return exact;
  for (const a of d.aliases) {
    const m = existing.find((c) => !used.has(c.id) && c.name.trim().toLowerCase().includes(a));
    if (m) return m;
  }
  return undefined;
}

const update = db.prepare(
  "UPDATE cabins SET name = ?, bookvisit_room_id = ?, room_type_label = ?, image_url = COALESCE(NULLIF(image_url, ''), ?), sort_order = ? WHERE id = ?",
);
const insert = db.prepare(
  "INSERT INTO cabins (name, bookvisit_room_id, room_type_label, door_code, image_url, capacity, sort_order) VALUES (?, ?, ?, '0000', ?, 'Max 6 personer · 50 m²', ?)",
);

const placeholders: string[] = [];

const tx = db.transaction(() => {
  desired.forEach((d, i) => {
    const match = findMatch(d);
    if (match) {
      used.add(match.id);
      update.run(d.name, d.type, d.label, d.img, i + 1, match.id);
      if (match.door_code === "0000" || !match.door_code) placeholders.push(d.name);
      console.log(`  ✓ ${match.name} → ${d.name}  (kod behålls: ${match.door_code || "saknas"})`);
    } else {
      insert.run(d.name, d.type, d.label, d.img, i + 1);
      placeholders.push(d.name);
      console.log(`  + ${d.name}  (NY rad – platshållarkod 0000)`);
    }
  });
});

console.log("Migrerar sjöbodar till numrerade namn…\n");
tx();

const leftover = existing.filter((c) => !used.has(c.id));
console.log("\nSlutligt tillstånd:");
console.table(
  db.prepare("SELECT id, name, room_type_label, door_code FROM cabins ORDER BY sort_order").all(),
);

if (leftover.length) {
  console.log("\n⚠️  Rader som INTE matchades (granska manuellt, ev. dubbletter):");
  console.table(leftover.map((c) => ({ id: c.id, name: c.name, door_code: c.door_code })));
}
if (placeholders.length) {
  console.log(`\n⚠️  Sätt riktig dörrkod på Sjöbodar-sidan för: ${placeholders.join(", ")}`);
}
console.log("\nKlart. Verifiera att varje sjöbods kod stämmer med rätt fysisk dörr innan skarp drift.");
process.exit(0);
