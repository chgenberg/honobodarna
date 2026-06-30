// Idempotent migrering: ser till att sjöbodarna heter exakt som BookVisits
// ankomstlista (Excel): "Sjöbod 1".."Sjöbod 6" + "Villan", med rätt rumstyp-koppling.
// SÄKERT: raderar aldrig en sjöbod och rör aldrig dörrkoder.
//
//   npx tsx scripts/migrate-cabins.ts
import { alignCabinNames } from "../src/cabin-align.js";
import { db } from "../src/db.js";

console.log("Migrerar sjöbodar till numrerade namn…\n");
const r = alignCabinNames();

for (const x of r.renamed) console.log(`  ✓ ${x.from} → ${x.to}  (kod behålls: ${x.code || "saknas"})`);
for (const x of r.created) console.log(`  + ${x}  (NY rad – platshållarkod 0000)`);

console.log("\nSlutligt tillstånd:");
console.table(db.prepare("SELECT id, name, room_type_label, door_code FROM cabins ORDER BY sort_order").all());

if (r.leftover.length) {
  console.log("\n⚠️  Rader som INTE matchades (granska manuellt, ev. dubbletter):");
  console.table(r.leftover);
}
if (r.placeholders.length) {
  console.log(`\n⚠️  Sätt riktig dörrkod på Sjöbodar-sidan för: ${r.placeholders.join(", ")}`);
}
console.log("\nKlart. Verifiera att varje sjöbods kod stämmer med rätt fysisk dörr innan skarp drift.");
process.exit(0);
