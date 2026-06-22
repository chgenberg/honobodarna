// Djup-skrapning av ALLA kunder genom historien från BookVisit till kundregistret.
//   npm run scrape:customers
import { deepHistoricalScrape, bookingCount } from "../src/bookvisit.js";
import { customerStats } from "../src/customers.js";

const ts = () => new Date().toISOString().slice(11, 19);
console.log(`[${ts()}] FÖRE: ${bookingCount()} bokningar i spegeln,`, customerStats());

const r = await deepHistoricalScrape({
  sinceYear: 2017,
  stepMonths: 6,
  onProgress: (m) => console.log(`[${ts()}] ${m}`),
});

console.log(`[${ts()}] KLART:`, r);
console.log(`[${ts()}] EFTER: ${bookingCount()} bokningar,`, customerStats());
process.exit(0);
