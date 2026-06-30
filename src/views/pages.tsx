import type { FC } from "hono/jsx";
import { Layout, STYLES, HEAD_FONTS } from "./layout.js";
import type { Cabin } from "../matching.js";
import type { Customer } from "../customers.js";
import type { BikeRow } from "../bikes.js";
import type { Template, TemplateType, Lang } from "../templates.js";

function statusPill(status: string) {
  const map: Record<string, string> = {
    pending: "pending",
    sent: "sent",
    failed: "failed",
    skipped: "skipped",
  };
  const label: Record<string, string> = {
    pending: "Väntar",
    sent: "Skickat",
    failed: "Misslyckades",
    skipped: "Hoppad",
  };
  const cls = map[status] ?? "pending";
  return <span class={`pill ${cls}`}>{label[status] ?? status}</span>;
}

export const LoginPage: FC<{ error?: string }> = ({ error }) => (
  <html lang="sv">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Logga in · Hönö Sjöbodar</title>
      {HEAD_FONTS}
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
    </head>
    <body>
      <div class="login-wrap">
        <img class="login-logo" src="/public/sjobodarna.png" alt="Hönö Sjöbodar" />
        <div class="card login-card">
          <p class="eyebrow">Dörrkoder</p>
          <h1>Logga in</h1>
          <p class="subtitle">Administration av incheckningar</p>
          {error ? <div class="flash err">{error}</div> : null}
          <form method="post" action="/login">
            <div class="field">
              <label>Användarnamn</label>
              <input name="username" autocomplete="username" autofocus />
            </div>
            <div class="field">
              <label>Lösenord</label>
              <input name="password" type="password" autocomplete="current-password" />
            </div>
            <button class="btn primary" type="submit" style="width:100%; justify-content:center;">
              Logga in
            </button>
          </form>
        </div>
      </div>
    </body>
  </html>
);

export interface ArrivalView {
  id: number;
  guest_name: string | null;
  phone: string | null;
  email: string | null;
  room_type_label: string | null;
  cabin_id: number | null;
  cabin_name: string | null;
  door_code: string | null;
  status: string;
  channel: string | null;
  needs_review: number;
  note: string | null;
}

const ArrivalTable: FC<{ arrivals: ArrivalView[]; cabins: Cabin[]; date: string; emptyText: string }> = ({
  arrivals,
  cabins,
  date,
  emptyText,
}) =>
  arrivals.length === 0 ? (
    <div class="empty">{emptyText}</div>
  ) : (
    <table class="stack">
      <thead>
        <tr>
          <th>Gäst</th>
          <th>Kontakt</th>
          <th>Rumstyp</th>
          <th>Sjöbod</th>
          <th>Kod</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {arrivals.map((a) => (
          <tr>
            <td data-label="Gäst">
              <div class="guest-cell">
                <strong>{a.guest_name}</strong>
                {a.needs_review ? <span class="pill review tiny">Granska matchning</span> : null}
              </div>
            </td>
            <td data-label="Kontakt">
              {a.phone ? (
                <div><span class="pill sms">SMS</span> {a.phone}</div>
              ) : a.email ? (
                <div><span class="pill email">E-post</span> {a.email}</div>
              ) : (
                <span class="pill failed">Saknar kontakt</span>
              )}
            </td>
            <td class="muted" data-label="Rumstyp">{a.room_type_label ?? "–"}</td>
            <td data-label="Sjöbod">
              <form method="post" action="/assign" class="inline-form">
                <input type="hidden" name="arrival_id" value={String(a.id)} />
                <input type="hidden" name="date" value={date} />
                <span class="select-wrap" style="min-width:150px;">
                  <select name="cabin_id" onchange="this.form.submit()">
                    <option value="">– välj sjöbod –</option>
                    {cabins.map((c) => (
                      <option value={String(c.id)} selected={a.cabin_id === c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </span>
              </form>
            </td>
            <td data-label="Kod">{a.door_code ? <span class="code-chip">{a.door_code}</span> : <span class="muted">–</span>}</td>
            <td data-label="Status">{statusPill(a.status)}</td>
            <td>
              <form method="post" action="/send-one" class="inline-form">
                <input type="hidden" name="arrival_id" value={String(a.id)} />
                <input type="hidden" name="date" value={date} />
                <button class="btn small primary" type="submit">
                  {a.status === "sent" ? "Skicka igen" : "Skicka"}
                </button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

interface TodayProps {
  date: string;
  humanDate: string;
  arrivals: ArrivalView[];
  packages: ArrivalView[];
  cabins: Cabin[];
  dryRun: boolean;
  autoSend: boolean;
  lastSync: string | null;
  flash?: { type: string; msg: string };
  stats: { total: number; sent: number; pending: number; review: number };
  hiddenCount?: number;
  bikes: BikeRow[];
  uploadedCount?: number;
}

export const TodayPage: FC<TodayProps> = (p) => {
  return (
    <Layout title="Idag" active="today" dryRun={p.dryRun}>
      {p.flash ? <div class={`flash ${p.flash.type}`}>{p.flash.msg}</div> : null}

      <p class="eyebrow">Incheckning</p>
      <h1>Dagens gäster</h1>
      <p class="subtitle">
        {p.humanDate}
        {p.lastSync ? ` · senast synkad mot BookVisit ${new Date(p.lastSync).toLocaleString("sv-SE")}` : ""}
      </p>

      <div class="grid cols-3" style="margin-bottom:8px;">
        <div class="card stat hover">
          <div class="num">{p.stats.total}</div>
          <div class="lbl">Incheckningar idag</div>
        </div>
        <div class="card stat hover">
          <div class="num" style="color:var(--green);">{p.stats.sent}</div>
          <div class="lbl">Koder skickade</div>
        </div>
        <div class="card stat hover">
          <div class="num" style={p.stats.review ? "color:var(--amber);" : ""}>{p.stats.review}</div>
          <div class="lbl">Behöver granskas</div>
        </div>
      </div>

      <div class="toolbar">
        <form method="post" action="/run" class="inline-form">
          <input type="hidden" name="date" value={p.date} />
          <input type="hidden" name="sync" value="1" />
          <button class="btn" type="submit">↻ Synka & uppdatera</button>
        </form>
        <form method="post" action="/send-all" class="inline-form">
          <input type="hidden" name="date" value={p.date} />
          <button class="btn primary" type="submit">
            Skicka alla koder nu{p.dryRun ? " (test)" : ""}
          </button>
        </form>
        <span class="inline-form">
          <button type="button" class="btn" id="alUploadBtn">⤓ Ladda upp ankomstlista</button>
        </span>
        <div class="spacer" />
        <form method="get" action="/" class="inline-form toolbar">
          <input type="date" name="date" value={p.date} />
          <button class="btn small" type="submit">Visa datum</button>
        </form>
      </div>

      <p class="help" style="margin-top:-6px;">
        {p.uploadedCount
          ? `✓ Ankomstlista uppladdad – ${p.uploadedCount} stuga${p.uploadedCount > 1 ? "/stugor" : ""} tilldelad${p.uploadedCount > 1 ? "e" : ""} från Excel för det här datumet.`
          : "Tips: ladda upp dagens Ankomstlista (Excel) från BookVisit så fylls rätt sjöbod i automatiskt. Dra filen var som helst på sidan."}
      </p>

      <div class="card">
        <ArrivalTable arrivals={p.arrivals} cabins={p.cabins} date={p.date} emptyText="Inga incheckningar för det här datumet." />
      </div>
      {p.hiddenCount ? (
        <p class="help">
          {p.hiddenCount} bokning{p.hiddenCount > 1 ? "ar" : ""} utan sjöbod (t.ex. tillvals-/standalone-bokningar) visas inte här – de har ingen dörrkod att skicka.
        </p>
      ) : null}

      {p.packages.length > 0 ? (
        <div style="margin-top:34px;">
          <p class="eyebrow">Paket</p>
          <h2 style="font-size:18px; text-transform:none; letter-spacing:0;">Paket – sjöbod & middag</h2>
          <p class="help" style="margin-top:0; margin-bottom:14px;">
            Gäster med paket (sjöbod + middag) får en egen text med dörrkod + middagsinfo. Ändra texten under Inställningar → Paket.
          </p>
          <form method="post" action="/packages/send-all" class="inline-form" style="display:block; margin-bottom:20px;">
            <input type="hidden" name="date" value={p.date} />
            <button class="btn primary" type="submit">Skicka paket-SMS till alla ({p.packages.length}){p.dryRun ? " (test)" : ""}</button>
          </form>
          <div class="card">
            <ArrivalTable arrivals={p.packages} cabins={p.cabins} date={p.date} emptyText="Inga paketbokningar." />
          </div>
        </div>
      ) : null}

      <div style="margin-top:34px;">
        <p class="eyebrow">Cyklar</p>
        <h2 style="font-size:18px; text-transform:none; letter-spacing:0;">Cykelbokningar idag</h2>
        <p class="help" style="margin-top:0; margin-bottom:14px;">
          Gäster som bokat cykel får ett eget SMS (egen text – ändra under Inställningar).
        </p>
        {p.bikes.length > 0 ? (
          <form method="post" action="/bikes/send-all" class="inline-form" style="display:block; margin-bottom:20px;">
            <input type="hidden" name="date" value={p.date} />
            <button class="btn primary" type="submit">Skicka cykel-SMS till alla ({p.bikes.length}){p.dryRun ? " (test)" : ""}</button>
          </form>
        ) : null}
        <div class="card">
          {p.bikes.length === 0 ? (
            <div class="empty">Inga cykelbokningar för det här datumet.</div>
          ) : (
            <table class="stack">
              <thead>
                <tr>
                  <th>Gäst</th>
                  <th>Kontakt</th>
                  <th>Cykel</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {p.bikes.map((b) => (
                  <tr>
                    <td data-label="Gäst"><strong>{b.guest_name}</strong></td>
                    <td data-label="Kontakt">
                      {b.phone ? (
                        <div><span class="pill sms">SMS</span> {b.phone}</div>
                      ) : b.email ? (
                        <div><span class="pill email">E-post</span> {b.email}</div>
                      ) : (
                        <span class="pill failed">Saknar kontakt</span>
                      )}
                    </td>
                    <td data-label="Cykel" class="muted">{b.bike_label ?? "Cykel"}</td>
                    <td data-label="Status">{statusPill(b.status)}</td>
                    <td>
                      <form method="post" action="/bikes/send-one" class="inline-form">
                        <input type="hidden" name="id" value={String(b.id)} />
                        <input type="hidden" name="date" value={p.date} />
                        <button class="btn small primary" type="submit">
                          {b.status === "sent" ? "Skicka igen" : "Skicka"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {p.autoSend ? (
        <p class="help">Automatiskt morgonutskick är PÅ. Koder skickas automatiskt enligt schemat.</p>
      ) : (
        <p class="help">
          Automatiskt morgonutskick är AV – koderna förbereds på morgonen men du trycker själv på "Skicka". Slå på i Inställningar.
        </p>
      )}

      <input type="file" id="alFile" accept=".xlsx,.xls" style="display:none" />
      <div id="alOverlay" class="upload-overlay">
        <div class="upload-box">
          <div class="upload-icon">⤓</div>
          <h2 id="alTitle">Släpp ankomstlistan här</h2>
          <p>Excel-fil (.xlsx) från BookVisit · datum {p.date}</p>
        </div>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){
  var date=${JSON.stringify(p.date)};
  var input=document.getElementById('alFile');
  var overlay=document.getElementById('alOverlay');
  var title=document.getElementById('alTitle');
  var btn=document.getElementById('alUploadBtn');
  var depth=0;
  function show(){overlay.classList.add('show');}
  function hide(){overlay.classList.remove('show');}
  if(btn)btn.addEventListener('click',function(){input.click();});
  window.addEventListener('dragenter',function(e){e.preventDefault();depth++;show();});
  window.addEventListener('dragover',function(e){e.preventDefault();});
  window.addEventListener('dragleave',function(e){depth--;if(depth<=0){depth=0;hide();}});
  window.addEventListener('drop',function(e){e.preventDefault();depth=0;var f=e.dataTransfer&&e.dataTransfer.files[0];if(f){upload(f);}else{hide();}});
  input.addEventListener('change',function(){if(input.files[0])upload(input.files[0]);});
  function go(msg,ok){location.href='/?date='+encodeURIComponent(date)+'&flash='+encodeURIComponent(msg)+'&ft='+(ok?'ok':'err');}
  function upload(file){
    show();title.textContent='Laddar upp & matchar…';
    var fd=new FormData();fd.append('file',file);
    fetch('/upload-arrivals?date='+encodeURIComponent(date),{method:'POST',body:fd})
      .then(function(r){return r.json();})
      .then(function(j){
        if(j&&j.ok){var m=j.assigned+' av '+j.rows+' rader kopplade till rätt sjöbod'+(j.unresolved&&j.unresolved.length?(' · okända rum: '+j.unresolved.join(', ')):'');go(m,true);}
        else{go((j&&j.error)||'Kunde inte läsa filen',false);}
      })
      .catch(function(){go('Uppladdningen misslyckades',false);});
  }
})();`,
        }}
      />
    </Layout>
  );
};

interface CabinsProps {
  cabins: Cabin[];
  roomTypes: { id: string; label: string }[];
  tab: string;
  bikeLockCode: string;
  dryRun: boolean;
  flash?: { type: string; msg: string };
}

export const CabinsPage: FC<CabinsProps> = (p) => (
  <Layout title="Sjöbodar & koder" active="cabins" dryRun={p.dryRun}>
    {p.flash ? <div class={`flash ${p.flash.type}`}>{p.flash.msg}</div> : null}
    <p class="eyebrow">Lås & koder</p>
    <h1>Sjöbodar & cyklar</h1>
    <p class="subtitle">Hantera dörrkoder och cykelns låskod – byt här när ni byter koden på låset.</p>

    <div class="toolbar" style="gap:8px; margin-bottom:22px;">
      <a class={`btn small ${p.tab === "sjobodar" ? "primary" : ""}`} href="/cabins">Sjöbodar</a>
      <a class={`btn small ${p.tab === "cyklar" ? "primary" : ""}`} href="/cabins?tab=cyklar">Cyklar</a>
      <a class={`btn small ${p.tab === "matpaket" ? "primary" : ""}`} href="/cabins?tab=matpaket">Matpaket</a>
    </div>

    {p.tab === "cyklar" ? (
      <div class="card" style="max-width:560px;">
        <h2>Cykelns låskod</h2>
        <p class="help" style="margin-top:0;">
          Cyklarna står i en kedja med ett gemensamt kodlås. Den här koden skickas ut i cykel-SMS:et/mejlet (variabeln {"{kod}"}). Byt här när ni byter koden på låset.
        </p>
        <form method="post" action="/cabins/bike-code" class="row-actions">
          <input name="bike_lock_code" value={p.bikeLockCode} class="code-chip" placeholder="t.ex. 031969952" style="width:160px;" />
          <button class="btn small primary" type="submit">Spara kod</button>
        </form>
        <p class="help">Själva cykeltexten ändrar du under Inställningar → Cyklar.</p>
      </div>
    ) : p.tab === "matpaket" ? (
      <div class="card" style="max-width:620px;">
        <h2>Matpaket – sjöbod & middag</h2>
        <p class="help" style="margin-top:0;">
          Matpaket är en egen artikel från BookVisit: gästen bor i en sjöbod och har middag bokad på Tullhuset. De får ett eget meddelande med sjöbodens dörrkod plus middagsinfo.
        </p>
        <table>
          <tbody>
            <tr><td>Dörrkod</td><td class="muted">Tas automatiskt från den tilldelade sjöboden – ingen egen kod att hantera här.</td></tr>
            <tr><td>Dagens paketgäster</td><td><a href="/">Idag</a> → sektionen "Paket – sjöbod & middag"</td></tr>
            <tr><td>Meddelandetext (sv/en)</td><td><a href="/settings">Inställningar</a> → "Paket (sjöbod + middag)"</td></tr>
          </tbody>
        </table>
      </div>
    ) : (
      <>
        <div class="card" style="max-width:680px; margin-bottom:18px;">
          <h2 style="margin-top:0;">Anpassa namn till ankomstlistan</h2>
          <p class="help" style="margin-top:0;">
            För att rätt sjöbod ska fyllas i automatiskt när du laddar upp ankomstlistan måste sjöbodarna heta exakt som i BookVisit: <strong>Sjöbod 1–6</strong> + <strong>Villan</strong> (7 enheter, där Sjöbod 1 = djurvänlig och Sjöbod 6 = anpassad). Knappen döper om och skapar enheter vid behov – <strong>dörrkoderna rörs inte</strong>.
          </p>
          <form
            method="post"
            action="/cabins/align-names"
            onsubmit="return confirm('Anpassa sjöbodsnamnen till ankomstlistan (Sjöbod 1–6 + Villan)? Dörrkoder behålls. Verifiera koderna efteråt.');"
          >
            <button class="btn small primary" type="submit">Anpassa namn (Sjöbod 1–6 + Villan)</button>
          </form>
          <p class="help">Efteråt: kontrollera att varje sjöbods kod stämmer med rätt fysisk dörr.</p>
        </div>
        {p.cabins.length === 0 ? (
          <div class="card">
            <div class="empty">Inga sjöbodar tillagda ännu. Lägg till dem nedan.</div>
          </div>
        ) : (
          <div class="cabin-grid">
            {p.cabins.map((c) => (
              <div class="cabin-card">
                <div class="cabin-photo" style={c.image_url ? `background-image:url('${c.image_url}')` : ""}>
                  {c.image_url ? null : <span class="cabin-photo-fallback">Hönö Sjöbodar</span>}
                  <span class="cabin-tag">{c.room_type_label ?? "Sjöbod"}</span>
                </div>
                <div class="cabin-body">
                  <div class="cabin-head">
                    <strong class="cabin-name">{c.name}</strong>
                    {c.capacity ? <span class="cabin-cap">{c.capacity}</span> : null}
                  </div>
                  <form method="post" action="/cabins/code" class="cabin-code-form">
                    <input type="hidden" name="id" value={String(c.id)} />
                    <label>Dörrkod</label>
                    <div class="row-actions">
                      <input name="door_code" value={c.door_code} class="code-chip" placeholder="– ingen –" />
                      <button class="btn small primary" type="submit">Spara</button>
                    </div>
                  </form>
                  <form method="post" action="/cabins/delete" class="inline-form" onsubmit="return confirm('Ta bort sjöboden?')">
                    <input type="hidden" name="id" value={String(c.id)} />
                    <button class="btn small danger" type="submit">Ta bort</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}

        <div class="card">
          <h2>Lägg till sjöbod</h2>
          <form method="post" action="/cabins/add">
            <div class="grid cols-2">
              <div class="field">
                <label>Namn</label>
                <input name="name" placeholder="t.ex. Sjöbod 1" required />
              </div>
              <div class="field">
                <label>BookVisit-rumstyp</label>
                <span class="select-wrap" style="display:block;">
                  <select name="bookvisit_room_id">
                    <option value="">– koppla senare –</option>
                    {p.roomTypes.map((rt) => (
                      <option value={rt.id}>{rt.label}</option>
                    ))}
                  </select>
                </span>
                <div class="help">Avgör vilka bokningar som matchas till stugan.</div>
              </div>
              <div class="field">
                <label>Dörrkod</label>
                <input name="door_code" placeholder="t.ex. 1234" />
              </div>
              <div class="field">
                <label>Bild-URL (valfritt)</label>
                <input name="image_url" placeholder="/public/Sjobod.png" />
              </div>
              <div class="field">
                <label>Kapacitet (valfritt)</label>
                <input name="capacity" placeholder="Max 6 personer · 50 m²" />
              </div>
            </div>
            <button class="btn primary" type="submit">Lägg till</button>
          </form>
        </div>
      </>
    )}
  </Layout>
);

interface LogRow {
  id: number;
  created_at: string;
  arrival_date: string | null;
  channel: string;
  recipient: string | null;
  status: string;
  error: string | null;
  dry_run: number;
}

export const LogPage: FC<{ logs: LogRow[]; dryRun: boolean }> = ({ logs, dryRun }) => (
  <Layout title="Logg" active="log" dryRun={dryRun}>
    <p class="eyebrow">Historik</p>
    <h1>Utskickslogg</h1>
    <p class="subtitle">Varje SMS och mejl som skickats (eller försökts) loggas här.</p>
    <div class="card">
      {logs.length === 0 ? (
        <div class="empty">Inga utskick ännu.</div>
      ) : (
        <table class="stack">
          <thead>
            <tr>
              <th>Tid</th>
              <th>Datum</th>
              <th>Kanal</th>
              <th>Mottagare</th>
              <th>Status</th>
              <th>Fel</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr>
                <td class="muted nowrap" data-label="Tid">{new Date(l.created_at + "Z").toLocaleString("sv-SE")}</td>
                <td class="nowrap" data-label="Datum">{l.arrival_date}</td>
                <td data-label="Kanal"><span class={`pill ${l.channel}`}>{l.channel.toUpperCase()}</span></td>
                <td data-label="Mottagare">{l.recipient}</td>
                <td data-label="Status">
                  <span class={`pill ${l.status === "sent" || l.status === "dry-run" || l.status === "canary" ? "sent" : "failed"}`}>
                    {l.status}
                  </span>
                </td>
                <td class="muted" data-label="Fel">{l.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </Layout>
);

interface SettingsProps {
  dryRun: boolean;
  autoSend: boolean;
  cronSchedule: string;
  timezone: string;
  bookingCount: number;
  lastSync: string | null;
  templates: Record<TemplateType, Record<Lang, Template>>;
  elksConfigured: boolean;
  smtpConfigured: boolean;
  canaryPhone: string;
  canaryEmail: string;
  flash?: { type: string; msg: string };
}

const TemplateCard: FC<{ label: string; type: TemplateType; t: Record<Lang, Template>; hint: string }> = ({
  label,
  type,
  t,
  hint,
}) => (
  <div class="card hover">
    <h2>{label}</h2>
    <p class="help" style="margin-top:0;">{hint}</p>
    <form method="post" action={`/settings/templates/${type}`}>
      <div class="grid cols-2">
        <div>
          <div class="field">
            <label>Svenska – e-postämne</label>
            <input name="subject_sv" value={t.sv.subject} />
          </div>
          <div class="field">
            <label>Svenska – text (SMS & e-post)</label>
            <textarea name="text_sv" rows={12}>{t.sv.text}</textarea>
          </div>
        </div>
        <div>
          <div class="field">
            <label>Engelska – e-postämne (skickas om numret inte börjar på +46)</label>
            <input name="subject_en" value={t.en.subject} />
          </div>
          <div class="field">
            <label>Engelska – text (SMS & e-post)</label>
            <textarea name="text_en" rows={12}>{t.en.text}</textarea>
          </div>
        </div>
      </div>
      <button class="btn primary" type="submit">Spara {label}</button>
    </form>
  </div>
);

export const SettingsPage: FC<SettingsProps> = (p) => (
  <Layout title="Inställningar" active="settings" dryRun={p.dryRun}>
    {p.flash ? <div class={`flash ${p.flash.type}`}>{p.flash.msg}</div> : null}
    <p class="eyebrow">Konfiguration</p>
    <h1>Inställningar</h1>
    <p class="subtitle">Meddelandetexter, status och test.</p>

    <div class="card hover">
      <h2>Status</h2>
      <table>
        <tbody>
          <tr><td>Läge</td><td>{p.dryRun ? <span class="pill skipped">Testläge (DRY_RUN)</span> : <span class="pill sent">Skarpt</span>}</td></tr>
          <tr><td>Automatiskt morgonutskick</td><td>{p.autoSend ? "På" : "Av"}</td></tr>
          <tr><td>Schema</td><td><span class="code-chip">{p.cronSchedule}</span> ({p.timezone})</td></tr>
          <tr><td>SMS (46elks)</td><td>{p.elksConfigured ? <span class="pill sent">Konfigurerat</span> : <span class="pill skipped">Saknas</span>}</td></tr>
          <tr><td>E-post (SMTP)</td><td>{p.smtpConfigured ? <span class="pill sent">Konfigurerat</span> : <span class="pill skipped">Saknas</span>}</td></tr>
          <tr><td>Bokningar i lokal spegel</td><td>{p.bookingCount}</td></tr>
          <tr><td>Senaste synk</td><td class="muted">{p.lastSync ? new Date(p.lastSync).toLocaleString("sv-SE") : "aldrig"}</td></tr>
          {p.canaryPhone || p.canaryEmail ? (
            <tr><td>Canary</td><td><span class="pill review">Allt går till {p.canaryPhone || p.canaryEmail}</span></td></tr>
          ) : null}
        </tbody>
      </table>
      <form method="post" action="/sync" style="margin-top:14px;">
        <button class="btn" type="submit">↻ Tvinga full synk från BookVisit</button>
      </form>
    </div>

    <p class="eyebrow" style="margin-top:30px;">Meddelandetexter</p>
    <p class="help" style="margin-top:0; margin-bottom:14px;">
      Tre separata texter. Engelska versionen skickas automatiskt om gästens nummer inte börjar på +46. Texten används för både SMS och e-post.
    </p>
    <TemplateCard label="Sjöbodar" type="sjobod" t={p.templates.sjobod} hint="Variabler: {namn}, {fulltnamn}, {stuga}, {kod}" />
    <TemplateCard label="Villan" type="villa" t={p.templates.villa} hint="Variabler: {namn}, {kod}" />
    <TemplateCard label="Paket (sjöbod + middag)" type="package" t={p.templates.package} hint="Variabler: {namn}, {fulltnamn}, {stuga}, {kod}" />
    <TemplateCard label="Cyklar" type="bike" t={p.templates.bike} hint="Variabler: {namn}, {fulltnamn}, {kod} (cykelns låskod – ändras under Sjöbodar & koder → Cyklar)" />

    <div class="card">
      <h2>Skicka testmeddelande</h2>
      <p class="help">Skickar ett exempelmeddelande med en av dina mallar. I testläge loggas det bara.</p>
      <form method="post" action="/settings/test" class="toolbar">
        <span class="select-wrap" style="min-width:120px;">
          <select name="channel">
            <option value="sms">SMS</option>
            <option value="email">E-post</option>
          </select>
        </span>
        <input name="recipient" placeholder="+46… eller mejladress" style="width:280px;" />
        <button class="btn primary" type="submit">Skicka test</button>
      </form>
    </div>
  </Layout>
);

function visit(d: string | null): string {
  return d ?? "–";
}

interface CustomersProps {
  customers: Customer[];
  resultCount: number;
  stats: { total: number; withPhone: number; withEmail: number; upcoming: number };
  query: string;
  filter: string;
  sort: string;
  dryRun: boolean;
  flash?: { type: string; msg: string };
}

const FILTER_OPTIONS = [
  { v: "all", label: "Alla kunder" },
  { v: "upcoming", label: "Kommande besök" },
  { v: "repeat", label: "Återkommande (>1 vistelse)" },
  { v: "phone", label: "Med telefon" },
  { v: "email", label: "Med e-post" },
  { v: "nophone", label: "Saknar telefon" },
  { v: "past", label: "Inga kommande besök" },
];
const SORT_OPTIONS = [
  { v: "next", label: "Nästa besök" },
  { v: "name", label: "Namn (A–Ö)" },
  { v: "stays", label: "Flest vistelser" },
  { v: "last", label: "Senaste besök" },
];

export const CustomersPage: FC<CustomersProps> = (p) => (
  <Layout title="Kundregister" active="customers" dryRun={p.dryRun}>
    {p.flash ? <div class={`flash ${p.flash.type}`}>{p.flash.msg}</div> : null}
    <p class="eyebrow">Gäster</p>
    <h1>Kundregister</h1>
    <p class="subtitle">Alla gäster vi sett via BookVisit. Registret fylls på automatiskt vid varje synk.</p>

    <div class="grid cols-3" style="margin-bottom:8px;">
      <div class="card stat hover"><div class="num">{p.stats.total}</div><div class="lbl">Kunder totalt</div></div>
      <div class="card stat hover"><div class="num">{p.stats.withPhone}</div><div class="lbl">Med telefon</div></div>
      <div class="card stat hover"><div class="num" style="color:var(--green);">{p.stats.upcoming}</div><div class="lbl">Kommande besök</div></div>
    </div>

    <div class="toolbar">
      <form method="get" action="/customers" class="toolbar" style="margin:0; flex-wrap:wrap;">
        <input name="q" value={p.query} placeholder="Sök namn, mejl eller nummer…" style="width:260px;" />
        <span class="select-wrap" style="min-width:180px;">
          <select name="filter" onchange="this.form.submit()">
            {FILTER_OPTIONS.map((o) => (
              <option value={o.v} selected={p.filter === o.v}>{o.label}</option>
            ))}
          </select>
        </span>
        <span class="select-wrap" style="min-width:160px;">
          <select name="sort" onchange="this.form.submit()">
            {SORT_OPTIONS.map((o) => (
              <option value={o.v} selected={p.sort === o.v}>Sortera: {o.label}</option>
            ))}
          </select>
        </span>
        <button class="btn small" type="submit">Sök</button>
        {p.query || p.filter !== "all" || p.sort !== "next" ? (
          <a class="btn small ghost" href="/customers">Rensa</a>
        ) : null}
      </form>
      <div class="spacer" />
      <form method="post" action="/customers/refresh" class="inline-form">
        <button class="btn small" type="submit">↻ Uppdatera register</button>
      </form>
    </div>
    <p class="help" style="margin:-8px 0 16px;">Visar {p.resultCount} kunder.</p>

    <div class="card" style="background:var(--sea-soft); border-color:var(--sea-line);">
      <h2>Massutskick · SMS</h2>
      <p class="help" style="margin-top:0;">Skicka samma SMS till <strong>alla {p.stats.withPhone} kunder med telefonnummer</strong>{p.query ? " (sökfiltret påverkar inte massutskick)" : ""}.</p>
      <form method="post" action="/customers/broadcast" onsubmit={`return confirm('Skicka SMS till ${p.stats.withPhone} kunder?')`}>
        <div class="field">
          <textarea name="message" rows={3} placeholder="Skriv ditt meddelande till alla kunder…" required></textarea>
        </div>
        <button class="btn primary" type="submit">Skicka till alla ({p.stats.withPhone})</button>
      </form>
    </div>

    <div class="card">
      {p.customers.length === 0 ? (
        <div class="empty">Inga kunder ännu. Tryck "Uppdatera register" efter en synk.</div>
      ) : (
        <table class="stack">
          <thead>
            <tr>
              <th>Gäst</th>
              <th>Kontakt</th>
              <th>Vistelser</th>
              <th>Senaste</th>
              <th>Nästa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {p.customers.map((c) => (
              <tr>
                <td data-label="Gäst"><strong>{c.name}</strong></td>
                <td data-label="Kontakt">
                  {c.phone ? <div><span class="pill sms">SMS</span> {c.phone}</div> : null}
                  {c.email ? <div class="muted" style="font-size:13px;">{c.email}</div> : null}
                  {!c.phone && !c.email ? <span class="muted">–</span> : null}
                </td>
                <td data-label="Vistelser">{c.stays_count}</td>
                <td class="muted nowrap" data-label="Senaste">{visit(c.last_visit)}</td>
                <td data-label="Nästa">{c.next_visit ? <span class="pill sent">{c.next_visit}</span> : <span class="muted">–</span>}</td>
                <td>
                  <a class="btn small primary" href={`/customers/${c.id}`}>
                    {c.phone ? "Skicka SMS" : "Visa"}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </Layout>
);

interface MsgRow {
  created_at: string;
  channel: string;
  recipient: string | null;
  body: string | null;
  status: string;
}

interface ComposeProps {
  customer: Customer;
  history: MsgRow[];
  dryRun: boolean;
  flash?: { type: string; msg: string };
}

export const CustomerComposePage: FC<ComposeProps> = (p) => (
  <Layout title="Kund" active="customers" dryRun={p.dryRun}>
    {p.flash ? <div class={`flash ${p.flash.type}`}>{p.flash.msg}</div> : null}
    <p class="eyebrow"><a href="/customers" style="color:var(--sea);">← Kundregister</a></p>
    <h1>{p.customer.name}</h1>
    <p class="subtitle">
      {p.customer.phone ? p.customer.phone : "(inget telefonnummer)"}
      {p.customer.email ? ` · ${p.customer.email}` : ""}
      {` · ${p.customer.stays_count} vistelser`}
      {p.customer.next_visit ? ` · nästa besök ${p.customer.next_visit}` : ""}
    </p>

    <div class="grid cols-2">
      <div class="card hover">
        <h2>Skicka SMS</h2>
        {p.customer.phone ? (
          <form method="post" action="/customers/sms">
            <input type="hidden" name="customer_id" value={String(p.customer.id)} />
            <div class="field">
              <label>Till</label>
              <input value={p.customer.phone} disabled />
            </div>
            <div class="field">
              <label>Meddelande</label>
              <textarea name="message" rows={5} placeholder="Skriv ditt meddelande…" required></textarea>
            </div>
            <button class="btn primary" type="submit">Skicka SMS{p.dryRun ? " (test)" : ""}</button>
          </form>
        ) : (
          <p class="muted">Den här kunden saknar telefonnummer{p.customer.email ? " – men har e-post." : "."}</p>
        )}
      </div>

      <div class="card hover">
        <h2>Meddelandehistorik</h2>
        {p.history.length === 0 ? (
          <div class="empty" style="padding:24px 0;">Inga meddelanden ännu.</div>
        ) : (
          <table class="stack">
            <tbody>
              {p.history.map((m) => (
                <tr>
                  <td class="muted nowrap" data-label="Tid">{new Date(m.created_at + "Z").toLocaleString("sv-SE")}</td>
                  <td data-label="Meddelande">{m.body}</td>
                  <td data-label="Status"><span class={`pill ${m.status === "sent" || m.status === "dry-run" || m.status === "canary" ? "sent" : "failed"}`}>{m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  </Layout>
);
