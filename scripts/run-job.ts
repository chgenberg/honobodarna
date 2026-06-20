// Kör morgonjobbet manuellt från terminalen.
//   npm run send:today            -> förbered + (ev.) skicka enligt AUTO_SEND
//   npm run send:today -- --send  -> tvinga utskick
//   npm run send:today -- --date=2026-06-21
import { runMorningJob } from "../src/job.js";

const args = process.argv.slice(2);
const send = args.includes("--send");
const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];

const result = await runMorningJob({
  date: dateArg,
  trigger: "manual",
  send: send || undefined,
  sync: true,
});

console.log(JSON.stringify(result, null, 2));
process.exit(0);
