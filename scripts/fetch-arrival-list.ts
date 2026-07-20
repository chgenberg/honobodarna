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
import { chromium, type BrowserContext, type Page } from "playwright";

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
  bookingHref?: string;
  guestHref?: string;
  phone?: string;
  email?: string;
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
  await page
    .locator('a:has-text("Fortsätt"), button:has-text("Fortsätt"), button[type="submit"], input[type="submit"]')
    .first()
    .click();
  // Verifiera att vi är inloggade (URL:en lämnar login-sidan).
  await page.waitForURL((u) => !u.pathname.toLowerCase().includes("/account/login"), { timeout: 60_000 });
  console.log("✓ Inloggad.");
}

// OBS: vänta ALDRIG på "networkidle" – BookVisits chatt-widget/analytics håller
// anslutningar öppna så sidan aldrig blir idle (orsakade dagliga timeouts).
async function openArrivals(page: Page) {
  // Frontdesk-modulen, sedan sidomenyns accordion "Operations" → "Ankomster".
  await page.goto("https://admin.bookvisit.com/frontdesk/index", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const operations = page.locator('button.section:has-text("Operations")').first();
  await operations.waitFor({ timeout: 60_000 });
  await operations.click();
  await page.locator('.nav-sidebar a:has-text("Ankomster")').first().click();
  // Vänta in tabellen med kolumnen "Tilldelat rum".
  await page.getByText("Tilldelat rum", { exact: false }).first().waitFor({ timeout: 60_000 });
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
  // Låt tabellen ladda om (undvik networkidle – blir aldrig idle pga widgets).
  await page.waitForTimeout(2500);
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
        const cellEls = Array.from(tr.querySelectorAll("td"));
        const cells = cellEls.map((td) => (td.textContent || "").trim());
        if (cells.length < headers.length - 1) continue; // summeringsrad ("Totalt:")
        const bookingCode = cells[idx.code] || "";
        if (!/^[A-Z0-9]{6,}$/.test(bookingCode)) continue;
        out.push({
          bookingCode,
          room: idx.room >= 0 ? (cells[idx.room] || "") : "",
          date: idx.date >= 0 ? (cells[idx.date] || "") : "",
          guest: idx.guest >= 0 ? (cells[idx.guest] || "") : "",
          bookingHref: idx.code >= 0 ? (cellEls[idx.code].querySelector("a")?.href || "") : "",
          guestHref: idx.guest >= 0 ? (cellEls[idx.guest].querySelector("a")?.href || "") : "",
        });
      }
      return out;
    }
    return [];
  })()`)) as ScrapedRow[];
  console.log(`✓ Läste ${rows.length} rader ur tabellen.`);
  for (const r of rows) {
    console.log(`   ${r.bookingCode}  ${r.date}  ${r.room}  (${r.guest})`);
  }
  return rows;
}

interface UploadResponse {
  ok?: boolean;
  rows?: number;
  assigned?: number;
  unresolved?: string[];
  missingFromApi?: string[];
  error?: string;
}

async function uploadToApp(rows: ScrapedRow[]): Promise<UploadResponse> {
  const url = `${need("APP_UPLOAD_URL")}?token=${encodeURIComponent(need("CRON_SECRET"))}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assignments: rows }),
  });
  const json = (await res.json().catch(() => ({}))) as UploadResponse;
  console.log(`Upload → ${res.status}:`, JSON.stringify(json));
  if (!res.ok || !json.ok) throw new Error(`Uppladdning misslyckades: ${json.error ?? res.status}`);
  if (json.unresolved?.length) {
    console.warn(`⚠️ Okända rum (matchade ingen sjöbod): ${json.unresolved.join(", ")}`);
  }
  console.log(`✓ Klart: ${json.assigned}/${json.rows} rader tilldelade sjöbod.`);
  return json;
}

async function scrapeContact(
  ctx: BrowserContext,
  row: ScrapedRow,
): Promise<{ phone: string; email: string }> {
  if (!row.bookingHref) return { phone: "", email: "" };
  const detail = await ctx.newPage();
  try {
    await detail.goto(row.bookingHref, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await detail.waitForTimeout(2500);

    // Gästinformationen på bokningsdetaljen visas som ren text ("Telefon | …",
    // "Email | …"), inte som formulärfält. Läs etiketterna direkt; falla tillbaka
    // på tel:/mailto:-länkar. OBS: sträng-evaluate pga tsx __name-injektion.
    const contact = (await detail.evaluate(`(() => {
      const text = document.body.innerText || "";
      const telMatch = text.match(/Telefon\\s*[|:]?\\s*(\\+?\\d[\\d ()\\-]{6,}\\d)/i);
      const telLink = document.querySelector('a[href^="tel:"]');
      const phone = (telMatch ? telMatch[1] : (telLink?.getAttribute("href") || "").replace(/^tel:/i, "")).trim();
      const mailLink = document.querySelector('a[href^="mailto:"]');
      const emMatch = text.match(/(?:Email|E-?post)\\s*[|:]?\\s*([^\\s|]+@[^\\s|]+)/i);
      const email = ((mailLink?.getAttribute("href") || "").replace(/^mailto:/i, "") || (emMatch ? emMatch[1] : "")).trim();
      return { email, phone };
    })()`)) as { email: string; phone: string };

    console.log(
      `   Kontakt ${row.bookingCode}: telefon=${contact.phone ? "ja" : "nej"}, e-post=${contact.email ? "ja" : "nej"}`,
    );
    if (!contact.phone && !contact.email) {
      console.warn(`   Inga kontaktuppgifter hittades på detaljsidan för ${row.bookingCode}.`);
      await shot(detail, `contact-missing-${row.bookingCode}`);
    }
    return { phone: contact.phone, email: contact.email };
  } finally {
    await detail.close();
  }
}

async function attempt(attemptNo: number): Promise<void> {
  const browser = await chromium.launch({ headless: !process.env.HEADFUL });
  const ctx = await browser.newContext({ locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  try {
    await login(page);
    await openArrivals(page);
    await setDate(page, targetDate);
    const rows = await scrapeTable(page);
    // Skydd: skicka bara rader för det valda datumet (om datumkolumnen finns).
    const filtered = rows.filter((r) => !r.date || r.date === targetDate);
    if (filtered.length === 0) {
      // Inga ankomster idag är helt normalt – men logga för säkerhets skull.
      await shot(page, `empty-table-${attemptNo}`);
      console.log("Inga ankomstrader hittades (kan vara en dag utan incheckningar).");
      return;
    }
    const firstUpload = await uploadToApp(filtered);

    // Frontdesk/PMS-bokningar kan saknas helt i REST-API:t (404). Öppna bara
    // dessa bokningsdetaljer, hämta telefon/e-post och komplettera reservankomsten.
    const missing = new Set(firstUpload.missingFromApi ?? []);
    if (missing.size > 0) {
      console.log(`Kompletterar ${missing.size} bokning(ar) som saknas i REST-API:t…`);
      const enriched: ScrapedRow[] = [];
      for (const row of filtered.filter((r) => missing.has(r.bookingCode))) {
        const contact = await scrapeContact(ctx, row);
        enriched.push({ ...row, ...contact });
      }
      await uploadToApp(enriched);
    }
  } catch (err) {
    await shot(page, `failure-${attemptNo}`);
    throw err;
  } finally {
    await browser.close();
  }
}

(async () => {
  console.log(`Hämtar ankomstlista för ${targetDate} från BookVisit Frontdesk…`);
  const MAX_ATTEMPTS = 3;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    try {
      await attempt(i);
      return;
    } catch (err) {
      console.error(`Försök ${i}/${MAX_ATTEMPTS} misslyckades:`, err instanceof Error ? err.message : err);
      if (i === MAX_ATTEMPTS) {
        process.exitCode = 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
})();
