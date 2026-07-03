// Hämtar dagens ankomstlista från BookVisit Frontdesk via browser-automation och
// skickar rumstilldelningarna till appens token-skyddade /api/upload-arrivals.
// Körs av GitHub Actions varje morgon (se .github/workflows/fetch-arrival-list.yml).
//
// Flödet (från Annas dokument "Steg för att få ut ankomstlista"):
//   1. Logga in på admin.bookvisit.com
//   2. Fliken "Frontdesk"
//   3. Sidomenyn "Operations" → "Ankomster"
//   4. (Datumet är förvalt = nuvarande arbetsdag)
//   5. Läs tabellen direkt (Gästnamn, Ankomst, Tilldelat rum, Boknings #)
//      – ingen "Epost lista" behövs.
//
// Miljövariabler (GitHub Secrets):
//   BOOKVISIT_USER, BOOKVISIT_PASS   inloggning
//   APP_UPLOAD_URL                   https://.../api/upload-arrivals
//   CRON_SECRET                      samma token som i appen
// Valfria:
//   BOOKVISIT_LOGIN_URL              default https://admin.bookvisit.com/Account/Login
//   ARRIVAL_DATE                     YYYY-MM-DD (default = idag i Europe/Stockholm)
//   HEADFUL=1                        synlig webbläsare vid lokal felsökning
import { chromium, type Page } from "playwright";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Saknar miljövariabel: ${name}`);
    process.exit(2);
  }
  return v;
}

const LOGIN_URL = process.env.BOOKVISIT_LOGIN_URL || "https://admin.bookvisit.com/Account/Login";

function todayStockholm(): string {
  // sv-SE ger YYYY-MM-DD
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const targetDate = process.env.ARRIVAL_DATE || todayStockholm();

interface ScrapedRow {
  bookingCode: string;
  room: string;
  date: string;
  guest: string;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `debug-${name}.png`, fullPage: true }).catch(() => {});
}

async function login(page: Page) {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  // Två fält: e-post + lösenord, knappen heter "Fortsätt".
  const userField = page.locator('input[type="email"], input[name*="mail" i], input[name*="user" i], input[type="text"]').first();
  await userField.fill(need("BOOKVISIT_USER"));
  await page.locator('input[type="password"]').first().fill(need("BOOKVISIT_PASS"));
  // "Fortsätt" är en <a>-länk på BookVisits inloggningssida, inte en <button>.
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page
      .locator('a:has-text("Fortsätt"), button:has-text("Fortsätt"), button[type="submit"], input[type="submit"]')
      .first()
      .click(),
  ]);
  // Verifiera att vi är inloggade (URL:en lämnar login-sidan).
  await page.waitForURL((u) => !u.pathname.toLowerCase().includes("/account/login"), { timeout: 30_000 });
  console.log("✓ Inloggad.");
}

async function openArrivals(page: Page) {
  // Frontdesk-modulen, sedan sidomenyns accordion "Operations" → "Ankomster".
  await page.goto("https://admin.bookvisit.com/frontdesk/index", { waitUntil: "networkidle" });
  await page.locator('button.section:has-text("Operations")').first().click();
  await page.locator('.nav-sidebar a:has-text("Ankomster")').first().click();
  await page.waitForLoadState("networkidle");
  // Vänta in tabellen med kolumnen "Tilldelat rum".
  await page.getByText("Tilldelat rum", { exact: false }).first().waitFor({ timeout: 30_000 });
  console.log(`✓ Ankomster-sidan laddad: ${page.url()}`);
}

const SV_MONTHS = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

// Väljer dagens datum i react-date-range-kalendern. Viktigt: sidan öppnar med
// anläggningens "nuvarande arbetsdag" (nattrevision körs ej) – inte dagens datum.
async function setDate(page: Page, target: string) {
  const [y, m, d] = target.split("-").map(Number);

  // Öppna datumväljaren (knappen uppe till höger, t.ex. "Lör 13 Sep.").
  await page
    .locator("button")
    .filter({ hasText: /jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec/i })
    .filter({ hasText: /\d/ })
    .first()
    .click();
  const header = page.locator(".rdrMonthAndYearPickers").first();
  await header.waitFor({ timeout: 15_000 });

  // Bläddra till rätt månad (max 36 klick som skydd mot evighetsloop).
  for (let i = 0; i < 36; i++) {
    const txt = ((await header.textContent()) ?? "").trim().toLowerCase();
    const match = txt.match(/^(\S+)\s+(\d{4})$/);
    if (!match) throw new Error(`Oväntad kalenderrubrik: "${txt}"`);
    const cur = new Date(Number(match[2]), SV_MONTHS.indexOf(match[1]), 1);
    const want = new Date(y, m - 1, 1);
    if (cur.getTime() === want.getTime()) break;
    await page.locator(cur < want ? ".rdrNextButton" : ".rdrPprevButton").first().click();
    await page.waitForTimeout(250);
  }

  // Klicka på dagen (hoppa över dagar från intilliggande månader).
  await page
    .locator(`.rdrDay:not(.rdrDayPassive):has(.rdrDayNumber span:text-is("${d}"))`)
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  console.log(`✓ Datum valt: ${target}`);
}

async function scrapeTable(page: Page): Promise<ScrapedRow[]> {
  // Läser tabellen generiskt: hittar kolumnindex via rubrikerna, plockar sedan raderna.
  // OBS: skickas som sträng – tsx/esbuild injicerar annars en __name-hjälpare
  // som inte finns i webbläsarkontexten (ReferenceError: __name is not defined).
  const rows = (await page.evaluate(`(() => {
    const norm = (s) => s.trim().toLowerCase();
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th"))
        .map((th) => norm(th.textContent || ""));
      const idx = {
        guest: headers.findIndex((h) => h.includes("gästnamn") || h.includes("guest")),
        date: headers.findIndex((h) => h.includes("ankomst") || h.includes("arrival")),
        room: headers.findIndex((h) => h.includes("tilldelat rum") || h.includes("room")),
        code: headers.findIndex((h) => h.includes("boknings") || h.includes("booking")),
      };
      if (idx.room < 0 || idx.code < 0) continue; // fel tabell
      const out = [];
      for (const tr of Array.from(table.querySelectorAll("tbody tr"))) {
        const cells = Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent || "").trim());
        if (cells.length < headers.length - 1) continue; // summeringsrad ("Totalt:")
        const bookingCode = cells[idx.code] || "";
        if (!/^[A-Z0-9]{6,}$/.test(bookingCode)) continue;
        out.push({
          bookingCode,
          room: idx.room >= 0 ? (cells[idx.room] || "") : "",
          date: idx.date >= 0 ? (cells[idx.date] || "") : "",
          guest: idx.guest >= 0 ? (cells[idx.guest] || "") : "",
        });
      }
      return out;
    }
    return [];
  })()`)) as ScrapedRow[];
  console.log(`✓ Läste ${rows.length} rader ur tabellen.`);
  for (const r of rows) console.log(`   ${r.bookingCode}  ${r.date}  ${r.room}  (${r.guest})`);
  return rows;
}

async function uploadToApp(rows: ScrapedRow[]) {
  const url = `${need("APP_UPLOAD_URL")}?token=${encodeURIComponent(need("CRON_SECRET"))}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assignments: rows }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    rows?: number;
    assigned?: number;
    unresolved?: string[];
    error?: string;
  };
  console.log(`Upload → ${res.status}:`, JSON.stringify(json));
  if (!res.ok || !json.ok) throw new Error(`Uppladdning misslyckades: ${json.error ?? res.status}`);
  if (json.unresolved?.length) {
    console.warn(`⚠️ Okända rum (matchade ingen sjöbod): ${json.unresolved.join(", ")}`);
  }
  console.log(`✓ Klart: ${json.assigned}/${json.rows} rader tilldelade sjöbod.`);
}

(async () => {
  console.log(`Hämtar ankomstlista för ${targetDate} från BookVisit Frontdesk…`);
  const browser = await chromium.launch({ headless: !process.env.HEADFUL });
  const ctx = await browser.newContext({ locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await login(page);
    await openArrivals(page);
    await setDate(page, targetDate);
    const rows = await scrapeTable(page);
    // Skydd: skicka bara rader för det valda datumet (om datumkolumnen finns).
    const filtered = rows.filter((r) => !r.date || r.date === targetDate);
    if (filtered.length === 0) {
      // Inga ankomster idag är helt normalt – men logga för säkerhets skull.
      await shot(page, "empty-table");
      console.log("Inga ankomstrader hittades (kan vara en dag utan incheckningar).");
      return;
    }
    await uploadToApp(filtered);
  } catch (err) {
    await shot(page, "failure");
    console.error("Fel:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
