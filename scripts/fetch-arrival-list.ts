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
//   HEADFUL=1                        synlig webbläsare vid lokal felsökning
import { chromium, type Page } from "playwright";

// Körs i webbläsaren via page.evaluate – projektet saknar DOM-typer.
interface MiniEl {
  textContent: string | null;
  querySelectorAll(sel: string): Iterable<MiniEl>;
}
declare const document: MiniEl;

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Saknar miljövariabel: ${name}`);
    process.exit(2);
  }
  return v;
}

const LOGIN_URL = process.env.BOOKVISIT_LOGIN_URL || "https://admin.bookvisit.com/Account/Login";

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
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.getByRole("button", { name: /fortsätt|logga in|log in|continue/i }).first().click(),
  ]);
  // Verifiera att vi är inloggade (fliken Frontdesk syns i toppmenyn).
  await page.getByText("Frontdesk", { exact: false }).first().waitFor({ timeout: 30_000 });
  console.log("✓ Inloggad.");
}

async function openArrivals(page: Page) {
  // Fliken "Frontdesk" i toppmenyn.
  await page.getByText("Frontdesk", { exact: false }).first().click();
  await page.waitForLoadState("networkidle");

  // Sidomenyn: "Operations"-ikonen (tooltip/text), sedan "Ankomster".
  const operations = page.locator('[title="Operations"], a:has-text("Operations"), [aria-label="Operations"]').first();
  await operations.click();
  await page.getByText("Ankomster", { exact: false }).first().click();
  await page.waitForLoadState("networkidle");
  // Vänta in tabellen med kolumnen "Tilldelat rum".
  await page.getByText("Tilldelat rum", { exact: false }).first().waitFor({ timeout: 30_000 });
  console.log(`✓ Ankomster-sidan laddad: ${page.url()}`);
}

async function scrapeTable(page: Page): Promise<ScrapedRow[]> {
  // Läser tabellen generiskt: hittar kolumnindex via rubrikerna, plockar sedan raderna.
  const rows = await page.evaluate(() => {
    const norm = (s: string) => s.trim().toLowerCase();
    const tables = Array.from(document.querySelectorAll("table"));
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th")).map((th) =>
        norm(th.textContent ?? ""),
      );
      const idx = {
        guest: headers.findIndex((h) => h.includes("gästnamn") || h.includes("guest")),
        date: headers.findIndex((h) => h.includes("ankomst") || h.includes("arrival")),
        room: headers.findIndex((h) => h.includes("tilldelat rum") || h.includes("room")),
        code: headers.findIndex((h) => h.includes("boknings") || h.includes("booking")),
      };
      if (idx.room < 0 || idx.code < 0) continue; // fel tabell

      const out: Array<{ bookingCode: string; room: string; date: string; guest: string }> = [];
      for (const tr of Array.from(table.querySelectorAll("tbody tr"))) {
        const cells = Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim());
        if (cells.length < headers.length - 1) continue; // summeringsrad ("Totalt:")
        const bookingCode = cells[idx.code] ?? "";
        if (!/^[A-Z0-9]{6,}$/.test(bookingCode)) continue;
        out.push({
          bookingCode,
          room: idx.room >= 0 ? (cells[idx.room] ?? "") : "",
          date: idx.date >= 0 ? (cells[idx.date] ?? "") : "",
          guest: idx.guest >= 0 ? (cells[idx.guest] ?? "") : "",
        });
      }
      return out;
    }
    return [];
  });
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
  console.log("Hämtar ankomstlista från BookVisit Frontdesk…");
  const browser = await chromium.launch({ headless: !process.env.HEADFUL });
  const ctx = await browser.newContext({ locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await login(page);
    await openArrivals(page);
    const rows = await scrapeTable(page);
    if (rows.length === 0) {
      // Inga ankomster idag är helt normalt – men logga för säkerhets skull.
      await shot(page, "empty-table");
      console.log("Inga ankomstrader hittades (kan vara en dag utan incheckningar).");
      return;
    }
    await uploadToApp(rows);
  } catch (err) {
    await shot(page, "failure");
    console.error("Fel:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
