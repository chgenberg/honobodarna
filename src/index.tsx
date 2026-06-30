import { Hono } from "hono";
import type { Context } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { timingSafeEqual } from "node:crypto";
import cron from "node-cron";
import { config } from "./config.js";
import { db, getSetting, setSetting } from "./db.js";
import { getBikeSends, sendBikeFor } from "./bikes.js";
import { parseAndApplyArrivalList, countAssignmentsForDate } from "./uploads.js";
import {
  getAllTemplates,
  getTemplate,
  setTemplate,
  langForPhone,
  render as renderTmpl,
  type TemplateType,
  type Lang,
} from "./templates.js";
import { requireAuth, verifyCredentials, issueSession, clearSession } from "./auth.js";
import { listCabins, getCabin } from "./matching.js";
import { bookingCount, getRoomTypes, syncBookings, countRoomlessForDate } from "./bookvisit.js";
import {
  rebuildCustomers,
  customerStats,
  listCustomers,
  countCustomers,
  getCustomer,
  customersWithPhone,
  type CustomerFilter,
  type CustomerSort,
} from "./customers.js";
import {
  prepareArrivals,
  getRegularArrivals,
  getPackageArrivals,
  sendForArrival,
  runMorningJob,
  type ArrivalRow,
} from "./job.js";
import { sendSms } from "./sms.js";
import { sendEmail } from "./email.js";
import { todayInTz, isValidDate, humanDate } from "./dates.js";
import {
  LoginPage,
  TodayPage,
  CabinsPage,
  LogPage,
  SettingsPage,
  CustomersPage,
  CustomerComposePage,
  type ArrivalView,
} from "./views/pages.js";

const app = new Hono();

// Statiska filer (logo + bilder) – före auth så inloggningssidan kan visa loggan.
app.use("/public/*", serveStatic({ root: "./" }));

// Extern cron-trigger (t.ex. cron-job.org). Skyddad med CRON_SECRET, ligger
// före inloggningskravet. Kör morgonjobbet asynkront och svarar direkt så att
// cron-tjänsten inte timeoutar medan synken pågår.
function cronAuthorized(c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }): boolean {
  if (!config.cronSecret) return false;
  const provided = c.req.query("token") || c.req.header("x-cron-secret") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(config.cronSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleCron(c: Context) {
  if (!config.cronSecret) {
    return c.json({ ok: false, error: "CRON_SECRET är inte satt" }, 503);
  }
  if (!cronAuthorized(c)) {
    return c.json({ ok: false, error: "Ogiltig token" }, 401);
  }
  // Kör i bakgrunden – svara direkt.
  runMorningJob({ trigger: "cron", send: config.autoSend, sync: true })
    .then((r) => console.log(`[cron-http] Klart: ${r.arrivalsFound} ankomster, ${r.sent} skickade, ${r.failed} fel.`))
    .catch((e) => console.error("[cron-http] Fel:", e));
  return c.json({ ok: true, started: true, date: todayInTz(), autoSend: config.autoSend });
}

app.get("/api/cron/run", handleCron);
app.post("/api/cron/run", handleCron);

// ─── Hjälpare ────────────────────────────────────────────────────────────────
function flashFrom(c: { req: { query: (k: string) => string | undefined } }) {
  const msg = c.req.query("flash");
  if (!msg) return undefined;
  return { type: c.req.query("ft") || "ok", msg };
}

function redirectFlash(path: string, type: string, msg: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}flash=${encodeURIComponent(msg)}&ft=${type}`;
}

function enrichArrivals(rows: ArrivalRow[]): ArrivalView[] {
  return rows.map((a) => {
    const cabin = a.cabin_id ? getCabin(a.cabin_id) : undefined;
    return {
      id: a.id,
      guest_name: a.guest_name,
      phone: a.phone,
      email: a.email,
      room_type_label: a.room_type_label,
      cabin_id: a.cabin_id,
      cabin_name: cabin?.name ?? null,
      door_code: cabin?.door_code ?? null,
      status: a.status,
      channel: a.channel,
      needs_review: a.needs_review,
      note: a.note,
    };
  });
}

// ─── Auth-rutter ─────────────────────────────────────────────────────────────
app.get("/login", (c) => c.html(<LoginPage error={c.req.query("error")} />));

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");
  if (verifyCredentials(username, password)) {
    issueSession(c, username);
    return c.redirect("/");
  }
  return c.redirect("/login?error=" + encodeURIComponent("Fel användarnamn eller lösenord."));
});

app.get("/logout", (c) => {
  clearSession(c);
  return c.redirect("/login");
});

// Allt nedan kräver inloggning.
app.use("*", requireAuth);

// ─── Idag ────────────────────────────────────────────────────────────────────
app.get("/", (c) => {
  const date = c.req.query("date");
  const d = date && isValidDate(date) ? date : todayInTz();
  const arrivals = enrichArrivals(getRegularArrivals(d));
  const packages = enrichArrivals(getPackageArrivals(d));
  const stats = {
    total: arrivals.length,
    sent: arrivals.filter((a) => a.status === "sent").length,
    pending: arrivals.filter((a) => a.status === "pending").length,
    review: arrivals.filter((a) => a.needs_review).length,
  };
  return c.html(
    <TodayPage
      date={d}
      humanDate={humanDate(d)}
      arrivals={arrivals}
      packages={packages}
      cabins={listCabins()}
      dryRun={config.dryRun}
      autoSend={config.autoSend}
      lastSync={getSetting("bv_last_sync")}
      flash={flashFrom(c)}
      stats={stats}
      hiddenCount={countRoomlessForDate(d)}
      bikes={getBikeSends(d)}
      uploadedCount={countAssignmentsForDate(d)}
    />,
  );
});

app.post("/run", async (c) => {
  const body = await c.req.parseBody();
  const d = String(body.date ?? "") || todayInTz();
  try {
    const result = await runMorningJob({ date: d, trigger: "manual", send: false, sync: true });
    return c.redirect(
      redirectFlash(`/?date=${d}`, "ok", `Synkat. ${result.arrivalsFound} incheckningar för dagen.`),
    );
  } catch (err) {
    return c.redirect(redirectFlash(`/?date=${d}`, "err", "Synk misslyckades: " + msg(err)));
  }
});

// Uppladdning av Annas ankomstlista (Excel) → kopplar bokning → fysisk sjöbod.
app.post("/upload-arrivals", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"] as { arrayBuffer?: () => Promise<ArrayBuffer> } | undefined;
  if (!file || typeof file.arrayBuffer !== "function") {
    return c.json({ ok: false, error: "Ingen fil mottagen." }, 400);
  }
  let summary;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    summary = parseAndApplyArrivalList(buf);
  } catch (err) {
    return c.json({ ok: false, error: "Kunde inte läsa filen: " + msg(err) }, 400);
  }
  // Applicera tilldelningarna: förbered om dagens + uppladdade datum (kör om matchningen).
  const date = c.req.query("date") || todayInTz();
  const dates = new Set<string>([date, ...summary.dates]);
  for (const d of dates) {
    try {
      prepareArrivals(d);
    } catch {
      /* hoppa över datum utan ankomster */
    }
  }
  return c.json({ ok: true, ...summary });
});

app.post("/assign", async (c) => {
  const body = await c.req.parseBody();
  const arrivalId = Number(body.arrival_id);
  const d = String(body.date ?? "");
  const cabinId = body.cabin_id ? Number(body.cabin_id) : null;
  db.prepare(
    "UPDATE arrivals SET cabin_id=?, needs_review=0, updated_at=datetime('now') WHERE id=?",
  ).run(cabinId, arrivalId);
  return c.redirect(`/?date=${d}`);
});

app.post("/send-one", async (c) => {
  const body = await c.req.parseBody();
  const arrivalId = Number(body.arrival_id);
  const d = String(body.date ?? "");
  const out = await sendForArrival(arrivalId, { force: true });
  const type = out.status === "failed" ? "err" : "ok";
  return c.redirect(redirectFlash(`/?date=${d}`, type, `${out.guest}: ${out.status}` + (out.error ? ` (${out.error})` : "")));
});

// Skickar en lista ankomster och returnerar enkel summering.
async function sendArrivalList(rows: ArrivalRow[]): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const a of rows) {
    if (a.status === "sent") continue;
    const out = await sendForArrival(a.id);
    if (out.status === "failed") failed++;
    else if (out.status === "skipped") skipped++;
    else sent++;
  }
  return { sent, failed, skipped };
}

app.post("/send-all", async (c) => {
  const body = await c.req.parseBody();
  const d = String(body.date ?? "") || todayInTz();
  prepareArrivals(d);
  // Endast vanliga sjöbods-/villakoder här (paket & cyklar har egna knappar).
  const r = await sendArrivalList(getRegularArrivals(d));
  return c.redirect(
    redirectFlash(
      `/?date=${d}`,
      r.failed ? "warn" : "ok",
      `Skickade ${r.sent} koder, misslyckades ${r.failed}, hoppade ${r.skipped}.` +
        (config.dryRun ? " (testläge – inget riktigt skickades)" : ""),
    ),
  );
});

app.post("/packages/send-all", async (c) => {
  const body = await c.req.parseBody();
  const d = String(body.date ?? "") || todayInTz();
  prepareArrivals(d);
  const r = await sendArrivalList(getPackageArrivals(d));
  return c.redirect(
    redirectFlash(
      `/?date=${d}`,
      r.failed ? "warn" : "ok",
      `Paket-SMS: skickade ${r.sent}, fel ${r.failed}, hoppade ${r.skipped}.` +
        (config.dryRun ? " (testläge – inget riktigt skickades)" : ""),
    ),
  );
});

// ─── Cyklar ──────────────────────────────────────────────────────────────────
app.post("/bikes/send-one", async (c) => {
  const body = await c.req.parseBody();
  const id = Number(body.id);
  const d = String(body.date ?? "");
  const out = await sendBikeFor(id, { force: true });
  const type = out.status === "failed" ? "err" : "ok";
  return c.redirect(
    redirectFlash(`/?date=${d}`, type, `Cykel-SMS ${out.guest}: ${out.status}` + (out.error ? ` (${out.error})` : "")),
  );
});

app.post("/bikes/send-all", async (c) => {
  const body = await c.req.parseBody();
  const d = String(body.date ?? "") || todayInTz();
  const rows = getBikeSends(d);
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.status === "sent") continue;
    const out = await sendBikeFor(r.id);
    if (out.status === "failed") failed++;
    else if (out.status !== "skipped") sent++;
  }
  return c.redirect(
    redirectFlash(
      `/?date=${d}`,
      failed ? "warn" : "ok",
      `Cykel-SMS: skickade ${sent}, fel ${failed}.` + (config.dryRun ? " (testläge – inget riktigt skickades)" : ""),
    ),
  );
});

// ─── Sjöbodar & koder ────────────────────────────────────────────────────────
app.get("/cabins", (c) => {
  const t = c.req.query("tab");
  const tab = t === "cyklar" ? "cyklar" : t === "matpaket" ? "matpaket" : "sjobodar";
  return c.html(
    <CabinsPage
      cabins={listCabins(true)}
      roomTypes={getRoomTypes()}
      tab={tab}
      bikeLockCode={getSetting("bike_lock_code") ?? "031969952"}
      dryRun={config.dryRun}
      flash={flashFrom(c)}
    />,
  );
});

app.post("/cabins/bike-code", async (c) => {
  const body = await c.req.parseBody();
  setSetting("bike_lock_code", String(body.bike_lock_code ?? "").trim());
  return c.redirect(redirectFlash("/cabins?tab=cyklar", "ok", "Cykelns låskod sparad."));
});

app.post("/cabins/add", async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim();
  if (!name) return c.redirect(redirectFlash("/cabins", "err", "Namn krävs."));
  const roomId = String(body.bookvisit_room_id ?? "") || null;
  const label = roomId ? getRoomTypes().find((r) => r.id === roomId)?.label ?? null : null;
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM cabins").get() as { m: number }).m;
  db.prepare(
    `INSERT INTO cabins (name, bookvisit_room_id, room_type_label, door_code, image_url, capacity, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    name,
    roomId,
    label,
    String(body.door_code ?? "").trim(),
    String(body.image_url ?? "").trim() || null,
    String(body.capacity ?? "").trim() || null,
    maxOrder + 1,
  );
  return c.redirect(redirectFlash("/cabins", "ok", `Sjöbod "${name}" tillagd.`));
});

app.post("/cabins/code", async (c) => {
  const body = await c.req.parseBody();
  const id = Number(body.id);
  const newCode = String(body.door_code ?? "").trim();
  const cabin = getCabin(id);
  if (!cabin) return c.redirect(redirectFlash("/cabins", "err", "Sjöbod saknas."));
  db.prepare("UPDATE cabins SET door_code=?, updated_at=datetime('now') WHERE id=?").run(newCode, id);
  db.prepare(
    "INSERT INTO code_history (cabin_id, old_code, new_code, changed_by) VALUES (?, ?, ?, ?)",
  ).run(id, cabin.door_code, newCode, config.admin.username);
  return c.redirect(redirectFlash("/cabins", "ok", `Kod uppdaterad för ${cabin.name}.`));
});

app.post("/cabins/delete", async (c) => {
  const body = await c.req.parseBody();
  db.prepare("DELETE FROM cabins WHERE id=?").run(Number(body.id));
  return c.redirect(redirectFlash("/cabins", "ok", "Sjöbod borttagen."));
});

// ─── Logg ────────────────────────────────────────────────────────────────────
app.get("/log", (c) => {
  const logs = db
    .prepare("SELECT * FROM message_log ORDER BY id DESC LIMIT 200")
    .all() as any[];
  return c.html(<LogPage logs={logs} dryRun={config.dryRun} />);
});

// ─── Inställningar ───────────────────────────────────────────────────────────
app.get("/settings", (c) =>
  c.html(
    <SettingsPage
      dryRun={config.dryRun}
      autoSend={config.autoSend}
      cronSchedule={config.cronSchedule}
      timezone={config.timezone}
      bookingCount={bookingCount()}
      lastSync={getSetting("bv_last_sync")}
      templates={getAllTemplates()}
      elksConfigured={Boolean(config.elks.username && config.elks.password)}
      smtpConfigured={Boolean(config.smtp.host)}
      canaryPhone={config.canaryPhone}
      canaryEmail={config.canaryEmail}
      flash={flashFrom(c)}
    />,
  ),
);

// Sparar en av de tre texterna (sjobod/villa/bike) på båda språken.
app.post("/settings/templates/:type", async (c) => {
  const type = c.req.param("type") as TemplateType;
  if (!["sjobod", "villa", "bike", "package"].includes(type)) {
    return c.redirect(redirectFlash("/settings", "err", "Okänd texttyp."));
  }
  const body = await c.req.parseBody();
  for (const lang of ["sv", "en"] as Lang[]) {
    setTemplate(type, lang, String(body[`text_${lang}`] ?? ""), String(body[`subject_${lang}`] ?? ""));
  }
  return c.redirect(redirectFlash("/settings", "ok", "Texter sparade."));
});

app.post("/settings/test", async (c) => {
  const body = await c.req.parseBody();
  const channel = String(body.channel ?? "sms");
  const recipient = String(body.recipient ?? "").trim();
  if (!recipient) return c.redirect(redirectFlash("/settings", "err", "Ange en mottagare."));
  const lang = channel === "sms" ? langForPhone(recipient) : langForPhone(null);
  const tmpl = getTemplate("sjobod", lang);
  const demo = { namn: "Test", fulltnamn: "Test Testsson", stuga: "Sjöbod 1", kod: "1234" };
  const result =
    channel === "email"
      ? await sendEmail(recipient, renderTmpl(tmpl.subject, demo), renderTmpl(tmpl.text, demo))
      : await sendSms(recipient, renderTmpl(tmpl.text, demo));
  const type = result.ok ? "ok" : "err";
  return c.redirect(redirectFlash("/settings", type, `Test (${channel}): ${result.status}` + (result.error ? ` – ${result.error}` : "")));
});

app.post("/sync", async (c) => {
  try {
    const r = await syncBookings({ full: true });
    return c.redirect(redirectFlash("/settings", "ok", `Full synk klar: ${r.fetched} bokningar (${r.failed} fel).`));
  } catch (err) {
    return c.redirect(redirectFlash("/settings", "err", "Synk misslyckades: " + msg(err)));
  }
});

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Kundregister ────────────────────────────────────────────────────────────
const logCustomerSms = db.prepare(`
  INSERT INTO message_log (arrival_date, channel, recipient, body, status, provider_id, error, dry_run)
  VALUES (?, 'sms', ?, ?, ?, ?, ?, ?)
`);

const VALID_FILTERS = ["all", "upcoming", "past", "repeat", "phone", "email", "nophone"];
const VALID_SORTS = ["next", "name", "stays", "last"];

app.get("/customers", (c) => {
  const q = c.req.query("q") ?? "";
  const filterParam = c.req.query("filter") ?? "all";
  const sortParam = c.req.query("sort") ?? "next";
  const filter = (VALID_FILTERS.includes(filterParam) ? filterParam : "all") as CustomerFilter;
  const sort = (VALID_SORTS.includes(sortParam) ? sortParam : "next") as CustomerSort;
  const opts = { query: q, filter, sort };
  return c.html(
    <CustomersPage
      customers={listCustomers(opts)}
      resultCount={countCustomers(opts)}
      stats={customerStats()}
      query={q}
      filter={filter}
      sort={sort}
      dryRun={config.dryRun}
      flash={flashFrom(c)}
    />,
  );
});

app.get("/customers/:id", (c) => {
  const id = Number(c.req.param("id"));
  const customer = getCustomer(id);
  if (!customer) return c.redirect(redirectFlash("/customers", "err", "Kunden hittades inte."));
  const history = customer.phone
    ? (db
        .prepare(
          "SELECT created_at, channel, recipient, body, status FROM message_log WHERE recipient = ? ORDER BY id DESC LIMIT 50",
        )
        .all(customer.phone) as any[])
    : [];
  return c.html(
    <CustomerComposePage customer={customer} history={history} dryRun={config.dryRun} flash={flashFrom(c)} />,
  );
});

app.post("/customers/refresh", (c) => {
  const n = rebuildCustomers();
  return c.redirect(redirectFlash("/customers", "ok", `Kundregistret uppdaterat: ${n} kunder.`));
});

app.post("/customers/sms", async (c) => {
  const body = await c.req.parseBody();
  const id = Number(body.customer_id);
  const message = String(body.message ?? "").trim();
  const customer = getCustomer(id);
  if (!customer || !customer.phone) {
    return c.redirect(redirectFlash(`/customers/${id}`, "err", "Saknar telefonnummer."));
  }
  if (!message) return c.redirect(redirectFlash(`/customers/${id}`, "err", "Skriv ett meddelande."));
  const r = await sendSms(customer.phone, message);
  logCustomerSms.run(
    todayInTz(),
    r.recipient,
    message,
    r.status,
    r.providerId ?? null,
    r.error ?? null,
    config.dryRun ? 1 : 0,
  );
  const type = r.ok ? "ok" : "err";
  return c.redirect(redirectFlash(`/customers/${id}`, type, `SMS: ${r.status}` + (r.error ? ` – ${r.error}` : "")));
});

app.post("/customers/broadcast", async (c) => {
  const body = await c.req.parseBody();
  const message = String(body.message ?? "").trim();
  if (!message) return c.redirect(redirectFlash("/customers", "err", "Skriv ett meddelande."));
  const recipients = customersWithPhone();
  let sent = 0;
  let failed = 0;
  for (const cust of recipients) {
    if (!cust.phone) continue;
    const r = await sendSms(cust.phone, message);
    logCustomerSms.run(
      todayInTz(),
      r.recipient,
      message,
      r.status,
      r.providerId ?? null,
      r.error ?? null,
      config.dryRun ? 1 : 0,
    );
    if (r.ok) sent++;
    else failed++;
  }
  return c.redirect(
    redirectFlash(
      "/customers",
      failed ? "warn" : "ok",
      `Massutskick klart: ${sent} skickade, ${failed} fel.` + (config.dryRun ? " (testläge – inget riktigt skickades)" : ""),
    ),
  );
});

// ─── Cron: morgonjobb ────────────────────────────────────────────────────────
if (!config.enableInternalCron) {
  console.log("[cron] Intern cron avstängd (ENABLE_INTERNAL_CRON=false) – använder extern trigger (cron-job.org).");
} else if (cron.validate(config.cronSchedule)) {
  cron.schedule(
    config.cronSchedule,
    () => {
      console.log("[cron] Startar morgonjobb…");
      runMorningJob({ trigger: "cron", send: config.autoSend, sync: true })
        .then((r) =>
          console.log(
            `[cron] Klart: ${r.arrivalsFound} ankomster, ${r.sent} skickade, ${r.failed} fel.`,
          ),
        )
        .catch((e) => console.error("[cron] Fel:", e));
    },
    { timezone: config.timezone },
  );
  console.log(`[cron] Morgonjobb schemalagt: "${config.cronSchedule}" (${config.timezone}).`);
} else {
  console.warn(`[cron] Ogiltigt CRON_SCHEDULE: "${config.cronSchedule}" – hoppar över schemaläggning.`);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Hönö Sjöbodar kör på http://localhost:${info.port}`);
  console.log(`Läge: ${config.dryRun ? "TESTLÄGE (inget skickas)" : "SKARPT"}`);
});

export { app, prepareArrivals };
