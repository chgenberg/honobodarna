// TILLFÄLLIG diagnostik: loggar in på BookVisit, öppnar en boknings detaljsida
// och dumpar alla kontaktrelaterade fält (maskerade) för att förstå var/om ett
// telefonnummer finns. Tas bort efter felsökning.
//   BOOKING_CODE=OJ02KR42MA npx tsx scripts/_debug-contact.ts
import { chromium } from "playwright";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Saknar ${name}`);
    process.exit(2);
  }
  return v;
}

const code = process.env.BOOKING_CODE || "OJ02KR42MA";
const url = `https://admin.bookvisit.com/reservation/managereservationv2/viewreservationwithbookingcode?bookingCode=${code}`;

function mask(v: string): string {
  const digits = (v.match(/\d/g) || []).length;
  const t = v.trim();
  if (!t) return "(tomt)";
  return `${t.slice(0, 3)}…${t.slice(-2)} [${digits} siffror, ${t.length} tecken]`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto("https://admin.bookvisit.com/Account/Login", { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"], input[type="text"]').first().fill(need("BOOKVISIT_USER"));
    await page.locator('input[type="password"]').first().fill(need("BOOKVISIT_PASS"));
    await page.locator('a:has-text("Fortsätt"), button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.toLowerCase().includes("/account/login"), { timeout: 60_000 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(4000);

    const dump = (await page.evaluate(`(() => {
      const label = (el) => [el.type, el.name, el.id, el.placeholder,
        el.getAttribute("aria-label"), el.getAttribute("data-testid")].filter(Boolean).join(" ");
      const fields = Array.from(document.querySelectorAll("input, textarea")).map((el) => ({
        label: label(el), value: (el.value || "").trim(), type: el.type || ""
      })).filter((f) => f.value || /phone|tel|mobil|mail|post|contact|kontakt|namn|name/i.test(f.label));
      const tel = Array.from(document.querySelectorAll('a[href^="tel:"]')).map((a) => a.getAttribute("href"));
      const mailto = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => a.getAttribute("href"));
      // Text som ser ut som telefonnummer var som helst på sidan
      const bodyText = document.body.innerText;
      const phoneLike = (bodyText.match(/(\\+?\\d[\\d ()\\-]{6,}\\d)/g) || []).slice(0, 20);
      return { fields, tel, mailto, phoneLike };
    })()`)) as {
      fields: Array<{ label: string; value: string; type: string }>;
      tel: string[];
      mailto: string[];
      phoneLike: string[];
    };

    console.log(`\n=== Bokning ${code} ===`);
    console.log("Fält (maskerade):");
    for (const f of dump.fields) console.log(`  [${f.type}] ${f.label || "(ingen label)"} = ${mask(f.value)}`);
    console.log("tel:-länkar:", dump.tel.map(mask));
    console.log("mailto:-länkar:", dump.mailto);
    console.log("Telefonliknande text på sidan (maskerad):", dump.phoneLike.map(mask));
    await page.screenshot({ path: `debug-detail-${code}.png`, fullPage: true }).catch(() => {});
  } catch (err) {
    console.error("Fel:", err instanceof Error ? err.message : err);
    await page.screenshot({ path: `debug-detail-fail.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
