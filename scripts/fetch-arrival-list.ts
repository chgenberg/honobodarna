// Hämtar dagens Ankomstlista (Excel) från BookVisit via browser-automation och
// laddar upp den till appens token-skyddade /api/upload-arrivals. Körs av GitHub
// Actions varje morgon (se .github/workflows/fetch-arrival-list.yml).
//
// Miljövariabler (sätts som GitHub Secrets):
//   BOOKVISIT_LOGIN_URL   inloggningssidans URL
//   BOOKVISIT_USER        användarnamn
//   BOOKVISIT_PASS        lösenord
//   APP_UPLOAD_URL        t.ex. https://honobodarna-production.up.railway.app/api/upload-arrivals
//   CRON_SECRET           samma token som i appen
// Valfria (override av selektorer/flöde – fylls i från Annas skärmbilder):
//   REPORT_URL            direktlänk till ankomstlist-rapporten (hoppar över menynavigering)
//   ARRIVAL_DATE          YYYY-MM-DD (default = idag i Europe/Stockholm)
//   SEL_USER, SEL_PASS, SEL_LOGIN, SEL_EXPORT   CSS/text-selektorer
//   HEADFUL=1             kör med synlig webbläsare (felsökning lokalt)
import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Saknar miljövariabel: ${name}`);
    process.exit(2);
  }
  return v;
}

function todayStockholm(): string {
  // sv-SE ger YYYY-MM-DD
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const date = process.env.ARRIVAL_DATE || todayStockholm();

async function login(page: Page) {
  await page.goto(need("BOOKVISIT_LOGIN_URL"), { waitUntil: "domcontentloaded" });
  await page.fill(process.env.SEL_USER || 'input[name="username"], input[type="email"]', need("BOOKVISIT_USER"));
  await page.fill(process.env.SEL_PASS || 'input[type="password"]', need("BOOKVISIT_PASS"));
  await page.click(process.env.SEL_LOGIN || 'button[type="submit"]');
  await page.waitForLoadState("networkidle");
}

async function openArrivalReport(page: Page) {
  if (process.env.REPORT_URL) {
    await page.goto(process.env.REPORT_URL, { waitUntil: "networkidle" });
    return;
  }
  // TODO (från Annas skärmbilder): navigera till Ankomstlistan via menyn här.
  // Ex: await page.click('text=Rapporter'); await page.click('text=Ankomstlista');
  throw new Error("REPORT_URL saknas och menynavigering är inte konfigurerad ännu (väntar på Annas steg).");
}

async function setDate(page: Page) {
  // TODO (från Annas skärmbilder): välj datum = `date` i rapportens datumväljare.
  // Många rapporter har redan rätt datum (idag) som default – då behövs inget här.
  void page;
}

async function downloadExcel(page: Page): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.click(process.env.SEL_EXPORT || 'text=/export|excel|ladda ner|xlsx/i'),
  ]);
  const path = await download.path();
  if (!path) throw new Error("Nedladdningen gav ingen fil.");
  return readFileSync(path);
}

async function uploadToApp(buf: Buffer) {
  const form = new FormData();
  form.append("file", new Blob([buf]), `ArrivalList-${date}.xlsx`);
  const url = `${need("APP_UPLOAD_URL")}?date=${encodeURIComponent(date)}&token=${encodeURIComponent(need("CRON_SECRET"))}`;
  const res = await fetch(url, { method: "POST", body: form });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; rows?: number; assigned?: number; error?: string };
  console.log(`Upload → ${res.status}:`, JSON.stringify(json));
  if (!res.ok || !json.ok) throw new Error(`Uppladdning misslyckades: ${json.error ?? res.status}`);
  console.log(`✓ Klart för ${date}: ${json.assigned}/${json.rows} rader tilldelade sjöbod.`);
}

(async () => {
  console.log(`Hämtar ankomstlista för ${date}…`);
  const browser = await chromium.launch({ headless: !process.env.HEADFUL });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    await login(page);
    await openArrivalReport(page);
    await setDate(page);
    const buf = await downloadExcel(page);
    await uploadToApp(buf);
  } catch (err) {
    await page.screenshot({ path: "failure.png", fullPage: true }).catch(() => {});
    console.error("Fel:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
