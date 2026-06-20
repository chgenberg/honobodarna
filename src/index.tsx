import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import cron from "node-cron";
import { config } from "./config.js";
import { db, getMessageTemplate, getSetting, setSetting } from "./db.js";
import { requireAuth, verifyCredentials, issueSession, clearSession } from "./auth.js";
import { listCabins, getCabin } from "./matching.js";
import { bookingCount, getRoomTypes, syncBookings } from "./bookvisit.js";
import {
  rebuildCustomers,
  customerStats,
  listCustomers,
  getCustomer,
  customersWithPhone,
} from "./customers.js";
import {
  prepareArrivals,
  getArrivals,
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
  const rows = getArrivals(d);
  const arrivals = enrichArrivals(rows);
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
      cabins={listCabins()}
      dryRun={config.dryRun}
      autoSend={config.autoSend}
      lastSync={getSetting("bv_last_sync")}
      flash={flashFrom(c)}
      stats={stats}
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

app.post("/send-all", async (c) => {
  const body = await c.req.parseBody();
  const d = String(body.date ?? "") || todayInTz();
  const result = await runMorningJob({ date: d, trigger: "manual", send: true, sync: false });
  return c.redirect(
    redirectFlash(
      `/?date=${d}`,
      result.failed ? "warn" : "ok",
      `Skickade ${result.sent}, misslyckades ${result.failed}, hoppade ${result.skipped}.` +
        (config.dryRun ? " (testläge – inget riktigt skickades)" : ""),
    ),
  );
});

// ─── Sjöbodar & koder ────────────────────────────────────────────────────────
app.get("/cabins", (c) =>
  c.html(
    <CabinsPage
      cabins={listCabins(true)}
      roomTypes={getRoomTypes()}
      dryRun={config.dryRun}
      flash={flashFrom(c)}
    />,
  ),
);

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
      tmpl={getMessageTemplate()}
      elksConfigured={Boolean(config.elks.username && config.elks.password)}
      smtpConfigured={Boolean(config.smtp.host)}
      canaryPhone={config.canaryPhone}
      canaryEmail={config.canaryEmail}
      flash={flashFrom(c)}
    />,
  ),
);

app.post("/settings/templates", async (c) => {
  const body = await c.req.parseBody();
  setSetting("tmpl_sms", String(body.sms ?? ""));
  setSetting("tmpl_email_subject", String(body.email_subject ?? ""));
  setSetting("tmpl_email_body", String(body.email_body ?? ""));
  return c.redirect(redirectFlash("/settings", "ok", "Texter sparade."));
});

app.post("/settings/test", async (c) => {
  const body = await c.req.parseBody();
  const channel = String(body.channel ?? "sms");
  const recipient = String(body.recipient ?? "").trim();
  if (!recipient) return c.redirect(redirectFlash("/settings", "err", "Ange en mottagare."));
  const tmpl = getMessageTemplate();
  const demo = { namn: "Test", fulltnamn: "Test Testsson", stuga: "Sjöbod 1", kod: "1234" };
  const render = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => (demo as any)[k] ?? "");
  const result =
    channel === "email"
      ? await sendEmail(recipient, render(tmpl.email_subject), render(tmpl.email_body))
      : await sendSms(recipient, render(tmpl.sms));
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

app.get("/customers", (c) => {
  const q = c.req.query("q") ?? "";
  return c.html(
    <CustomersPage
      customers={listCustomers(q)}
      stats={customerStats()}
      query={q}
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
if (cron.validate(config.cronSchedule)) {
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
