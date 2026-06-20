import type { FC, PropsWithChildren } from "hono/jsx";

// Brandanpassad CSS – inspirerad av honosjobodar.se:
//  - Rubriker i Oswald (versaler, luftig spärrning), brödtext i Wix Madefor Text
//  - Kustpalett: djup havsblå, faluröd accent, varm sandvit bakgrund
//  - Mjuka övergångar, hover-lyft, custom rullgardiner, in-toningar
export const STYLES = `
:root {
  --sand: #f4f1ea;
  --sand-2: #efe9de;
  --paper: #ffffff;
  --ink: #1e2832;
  --ink-soft: #3b4651;
  --muted: #837d72;
  --line: #e7e1d4;
  --line-strong: #d8d1c2;
  --sea: #1c5066;
  --sea-deep: #123b4d;
  --sea-soft: #e8eef1;
  --sea-line: #cddde3;
  --red: #9c4232;
  --red-soft: #f4e7e3;
  --green: #3a7355;
  --green-soft: #e6efe8;
  --amber: #97651f;
  --amber-soft: #f4ecd7;
  --radius: 14px;
  --radius-lg: 20px;
  --shadow: 0 1px 2px rgba(30,40,50,.04), 0 10px 30px rgba(30,40,50,.06);
  --shadow-hover: 0 2px 4px rgba(30,40,50,.05), 0 18px 44px rgba(28,80,102,.13);
  --ease: cubic-bezier(.22,.61,.36,1);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { overflow-x: hidden; }
img, table, textarea { max-width: 100%; }
body {
  font-family: "Wix Madefor Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(1100px 520px at 82% -8%, #eef3f3 0%, rgba(238,243,243,0) 60%),
    var(--sand);
  color: var(--ink);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
/* Tunn brand-strip överst */
body::before {
  content: ""; position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 50;
  background: linear-gradient(90deg, var(--sea-deep), var(--sea) 55%, var(--red));
}
a { color: var(--sea); text-decoration: none; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 0 22px; }

h1, h2, h3, .oswald {
  font-family: "Oswald", "Wix Madefor Text", sans-serif;
  font-weight: 500; letter-spacing: .01em;
}

/* ── Topbar ─────────────────────────────────────────────── */
header.topbar {
  background: rgba(255,255,255,.82);
  backdrop-filter: saturate(160%) blur(12px);
  -webkit-backdrop-filter: saturate(160%) blur(12px);
  border-bottom: 1px solid var(--line);
  position: sticky; top: 0; z-index: 20;
}
.topbar-inner { display: flex; align-items: center; gap: 30px; height: 76px; }
.brand { display: flex; align-items: center; flex-shrink: 0; }
.brand-mark {
  display: block; height: 56px; width: 48px;
  background-color: var(--sea-deep);
  -webkit-mask: url('/public/sjobodarna.png') center / contain no-repeat;
  mask: url('/public/sjobodarna.png') center / contain no-repeat;
  transition: background-color .2s var(--ease), transform .2s var(--ease);
}
.brand:hover .brand-mark { background-color: var(--sea); transform: translateY(-1px); }
/* Brand-prick (login m.m.) */
.brand .dot {
  width: 9px; height: 9px; border-radius: 50%; background: var(--red);
  box-shadow: 0 0 0 4px var(--red-soft); display: inline-block;
}
nav.main { display: flex; gap: 2px; flex: 1; }
nav.main a {
  position: relative; color: var(--muted); font-weight: 500; font-size: 14.5px;
  padding: 9px 15px; border-radius: 10px; transition: color .18s var(--ease), background .18s var(--ease);
}
nav.main a::after {
  content: ""; position: absolute; left: 15px; right: 15px; bottom: 5px; height: 2px;
  background: var(--sea); border-radius: 2px; transform: scaleX(0); transform-origin: left;
  transition: transform .26s var(--ease);
}
nav.main a:hover { color: var(--ink); }
nav.main a:hover::after { transform: scaleX(1); }
nav.main a.active { color: var(--sea-deep); background: var(--sea-soft); }
nav.main a.active::after { transform: scaleX(1); }
.topbar-inner .right { display: flex; align-items: center; gap: 14px; }
.dry-badge {
  font-size: 11.5px; font-weight: 700; letter-spacing: .03em; padding: 5px 12px; border-radius: 999px;
  background: var(--amber-soft); color: var(--amber);
  display: inline-flex; align-items: center; gap: 7px;
}
.dry-badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .8;
  animation: blink 1.8s var(--ease) infinite; }
.live-badge { background: var(--green-soft); color: var(--green); }
@keyframes blink { 0%,100%{opacity:.85} 50%{opacity:.25} }

main { padding: 40px 0 80px; }
.eyebrow {
  font-family: "Oswald", sans-serif; text-transform: uppercase; letter-spacing: .22em;
  font-size: 12px; font-weight: 500; color: var(--sea); margin: 0 0 10px;
}
h1 { font-size: 33px; letter-spacing: .015em; text-transform: uppercase; margin: 0 0 6px; line-height: 1.08; }
.subtitle { color: var(--muted); margin: 0 0 28px; font-size: 15px; max-width: 70ch; }
h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .12em; margin: 0 0 16px; color: var(--ink-soft); }

/* ── Reveal-animation ───────────────────────────────────── */
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
main .card, main > .wrap > h1, main > .wrap > .eyebrow, main > .wrap > .subtitle, main .grid > .card {
  animation: rise .55s var(--ease) both;
}
main .grid.cols-3 > .card:nth-child(2) { animation-delay: .06s; }
main .grid.cols-3 > .card:nth-child(3) { animation-delay: .12s; }

.card {
  background: var(--paper); border: 1px solid var(--line);
  border-radius: var(--radius-lg); box-shadow: var(--shadow);
  padding: 24px; margin-bottom: 20px;
  transition: transform .25s var(--ease), box-shadow .25s var(--ease), border-color .25s var(--ease);
}
.card.hover:hover { transform: translateY(-3px); box-shadow: var(--shadow-hover); border-color: var(--sea-line); }
.grid { display: grid; gap: 20px; }
.grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
.grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
@media (max-width: 780px) { .grid.cols-3, .grid.cols-2 { grid-template-columns: 1fr; } }

.stat { position: relative; overflow: hidden; }
.stat .num { font-family: "Oswald", sans-serif; font-size: 40px; font-weight: 500; line-height: 1; letter-spacing: .01em; }
.stat .lbl { color: var(--muted); font-size: 13px; margin-top: 8px; text-transform: uppercase; letter-spacing: .08em; }
.stat::after {
  content: ""; position: absolute; right: -30px; top: -30px; width: 96px; height: 96px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--sea-soft), transparent 70%); opacity: .8;
}

table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
th { text-align: left; color: var(--muted); font-weight: 600; font-size: 11px;
     text-transform: uppercase; letter-spacing: .1em; padding: 0 14px 12px; }
td { padding: 15px 14px; border-top: 1px solid var(--line); vertical-align: middle; }
tbody tr { transition: background .16s var(--ease); }
tbody tr:hover { background: #faf8f3; }
tr:first-child td { border-top: none; }

.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
        font-weight: 600; padding: 4px 11px; border-radius: 999px; letter-spacing: .01em; white-space: nowrap; }
.nowrap { white-space: nowrap; }
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.pending { background: var(--sand-2); color: var(--muted); }
.pill.sent { background: var(--green-soft); color: var(--green); }
.pill.failed { background: var(--red-soft); color: var(--red); }
.pill.skipped { background: var(--amber-soft); color: var(--amber); }
.pill.review { background: var(--amber-soft); color: var(--amber); animation: pulse 2.4s var(--ease) infinite; }
.pill.tiny { font-size: 10.5px; padding: 3px 9px; white-space: nowrap; }
.guest-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 2px 0; }
.guest-cell strong { line-height: 1.25; }
.pill.sms, .pill.email { background: var(--sea-soft); color: var(--sea-deep); }
@keyframes pulse { 0%,100%{ box-shadow: 0 0 0 0 rgba(151,101,31,.28);} 50%{ box-shadow: 0 0 0 5px rgba(151,101,31,0);} }

.btn {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  font-family: inherit; font-size: 14px; font-weight: 600; letter-spacing: .01em;
  padding: 10px 17px; border-radius: 11px; border: 1px solid var(--line-strong);
  background: var(--paper); color: var(--ink);
  transition: transform .16s var(--ease), box-shadow .16s var(--ease), background .16s var(--ease), border-color .16s var(--ease);
}
.btn:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(30,40,50,.10); border-color: var(--sea-line); }
.btn:active { transform: translateY(0); box-shadow: none; }
.btn.primary {
  background: linear-gradient(180deg, var(--sea) 0%, var(--sea-deep) 100%);
  border-color: var(--sea-deep); color: #fff;
}
.btn.primary:hover { box-shadow: 0 8px 22px rgba(28,80,102,.32); }
.btn.ghost { background: transparent; border-color: transparent; color: var(--sea); }
.btn.ghost:hover { background: var(--sea-soft); box-shadow: none; }
.btn.small { padding: 7px 12px; font-size: 13px; border-radius: 9px; }
.btn.danger { color: var(--red); }
.btn.danger:hover { border-color: var(--red); background: var(--red-soft); }

input, textarea {
  font-family: inherit; font-size: 14.5px; color: var(--ink);
  border: 1px solid var(--line-strong); border-radius: 11px; padding: 10px 13px;
  background: #fff; width: 100%; transition: border-color .16s var(--ease), box-shadow .16s var(--ease);
}
input:focus, textarea:focus, select:focus {
  outline: none; border-color: var(--sea); box-shadow: 0 0 0 4px var(--sea-soft);
}

/* ── Custom rullgardin (snyggare select) ────────────────── */
select {
  font-family: inherit; font-size: 14px; font-weight: 500; color: var(--ink);
  appearance: none; -webkit-appearance: none; -moz-appearance: none;
  border: 1px solid var(--line-strong); border-radius: 11px;
  padding: 9px 38px 9px 13px; background-color: #fff; cursor: pointer; width: 100%;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%231c5066' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center; background-size: 15px;
  transition: border-color .16s var(--ease), box-shadow .16s var(--ease), background-color .16s var(--ease);
}
select:hover { border-color: var(--sea); background-color: #fcfdfd; }
.select-wrap { position: relative; display: inline-block; min-width: 150px; }

label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 7px; color: var(--ink); }
.field { margin-bottom: 18px; }
.muted { color: var(--muted); }
.row-actions { display: flex; gap: 9px; align-items: center; }
.code-chip {
  font-family: "Oswald", ui-monospace, monospace; font-weight: 500; font-size: 15px; letter-spacing: .12em;
  background: var(--sea-soft); color: var(--sea-deep); border: 1px solid var(--sea-line);
  border-radius: 9px; padding: 4px 11px; display: inline-block;
}
input.code-chip { letter-spacing: .1em; }
.flash {
  padding: 13px 17px; border-radius: 13px; margin-bottom: 20px; font-size: 14px; font-weight: 500;
  border: 1px solid transparent; animation: rise .4s var(--ease) both;
}
.flash.ok { background: var(--green-soft); color: var(--green); border-color: #cfe2d5; }
.flash.warn { background: var(--amber-soft); color: var(--amber); border-color: #ecdcb6; }
.flash.err { background: var(--red-soft); color: var(--red); border-color: #eccfc8; }
.inline-form { display: inline; }
.empty { text-align: center; color: var(--muted); padding: 48px 0; font-size: 15px; }
.toolbar { display: flex; gap: 11px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; }
.toolbar .spacer { flex: 1; }
.help { font-size: 13px; color: var(--muted); margin-top: 8px; }
strong { font-weight: 600; }

/* ── Sjöbod-kort med foto ───────────────────────────────── */
.cabin-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-bottom: 24px; }
@media (max-width: 900px) { .cabin-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .cabin-grid { grid-template-columns: 1fr; } }
.cabin-card {
  background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg);
  box-shadow: var(--shadow); overflow: hidden; display: flex; flex-direction: column;
  transition: transform .28s var(--ease), box-shadow .28s var(--ease), border-color .28s var(--ease);
  animation: rise .55s var(--ease) both;
}
.cabin-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-hover); border-color: var(--sea-line); }
.cabin-photo {
  position: relative; height: 168px; background-size: cover; background-position: center;
  background-color: var(--sea-deep);
  display: flex; align-items: center; justify-content: center;
}
.cabin-card:hover .cabin-photo { } /* foto-zoom via inner ej nödvändigt */
.cabin-photo::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(18,59,77,0) 45%, rgba(18,59,77,.42));
}
.cabin-photo-fallback {
  font-family: "Oswald", sans-serif; text-transform: uppercase; letter-spacing: .18em;
  color: rgba(244,241,234,.6); font-size: 13px;
}
.cabin-tag {
  position: absolute; top: 12px; left: 12px; z-index: 1;
  background: rgba(255,255,255,.92); color: var(--sea-deep);
  font-size: 11.5px; font-weight: 600; letter-spacing: .03em;
  padding: 4px 11px; border-radius: 999px; backdrop-filter: blur(4px);
}
.cabin-body { padding: 17px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
.cabin-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.cabin-name { font-family: "Oswald", sans-serif; font-size: 19px; font-weight: 500; letter-spacing: .02em; }
.cabin-cap { font-size: 12px; color: var(--muted); text-align: right; }
.cabin-code-form label { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); margin-bottom: 5px; }
.cabin-code-form .row-actions input { width: 110px; }
.cabin-body > .inline-form { margin-top: -4px; }
.cabin-body > .inline-form .btn { padding: 4px 0; border: none; background: none; color: var(--muted); font-size: 12px; font-weight: 500; }
.cabin-body > .inline-form .btn:hover { color: var(--red); transform: none; box-shadow: none; }

/* ── Login ──────────────────────────────────────────────── */
.login-wrap {
  min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 26px; padding: 24px;
  background:
    radial-gradient(900px 600px at 50% -10%, rgba(28,80,102,.22), transparent 60%),
    linear-gradient(160deg, #16384a 0%, #1c5066 48%, #2d6b7e 100%);
  position: relative; overflow: hidden;
}
.login-logo {
  width: 158px; height: auto; position: relative; z-index: 1;
  opacity: .95; animation: rise .6s var(--ease) both;
  filter: drop-shadow(0 8px 24px rgba(8,25,35,.4));
}
.login-wrap::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 38%;
  background: linear-gradient(180deg, transparent, rgba(11,28,38,.55));
  pointer-events: none;
}
.login-card { width: 392px; max-width: 92vw; position: relative; z-index: 1;
  box-shadow: 0 30px 80px rgba(8,25,35,.45); animation: rise .6s var(--ease) both; }
.login-card .brand { margin-bottom: 22px; }
.login-card h1 { font-size: 26px; }

/* ── Mobil (≤ 760px) ────────────────────────────────────── */
@media (max-width: 760px) {
  .wrap { padding: 0 15px; }
  main { padding: 22px 0 56px; }
  h1 { font-size: 25px; }
  .subtitle { font-size: 14px; margin-bottom: 20px; }
  .card { padding: 18px; border-radius: 16px; }

  /* Topbar: brand + badge/logout på rad 1, nav som scrollbar rad 2 */
  .topbar-inner { height: auto; flex-wrap: wrap; gap: 10px; padding: 11px 0; align-items: center; }
  .brand { margin-right: auto; }
  .brand-mark { height: 42px; width: 36px; }
  .topbar-inner .right { gap: 8px; }
  .dry-badge { font-size: 11px; padding: 4px 9px; }
  nav.main {
    order: 3; width: 100%; flex: 0 0 100%; flex-wrap: wrap; gap: 4px; padding-top: 8px;
    border-top: 1px solid var(--line);
  }
  nav.main a { white-space: nowrap; padding: 7px 12px; font-size: 14px; }
  nav.main a::after { display: none; }

  .stat .num { font-size: 32px; }

  /* Verktygsrader + formulär staplas och blir fullbredd */
  .toolbar { flex-direction: column; align-items: stretch; gap: 9px; }
  .toolbar form { flex-direction: column; align-items: stretch; width: 100%; }
  .toolbar .spacer { display: none; }
  .toolbar input, .toolbar .select-wrap, .toolbar select, .toolbar .btn { width: 100% !important; }
  .toolbar .select-wrap { min-width: 0 !important; }
  input[style], textarea[style] { width: 100% !important; }
  .grid.cols-2, .grid.cols-3 { grid-template-columns: 1fr; }

  /* Data-tabeller → staplade kort (de som har class="stack") */
  table.stack thead { display: none; }
  table.stack, table.stack tbody, table.stack tr, table.stack td { display: block; width: 100%; }
  table.stack tr { border-top: none; border-bottom: 1px solid var(--line); padding: 12px 0; }
  table.stack tr:last-child { border-bottom: none; }
  table.stack tbody tr:hover { background: transparent; }
  table.stack td { border: none; padding: 7px 0; display: flex; justify-content: space-between;
             align-items: center; gap: 14px; text-align: right; min-height: 30px; }
  table.stack td[data-label]::before {
    content: attr(data-label); font-weight: 600; font-size: 11px; text-transform: uppercase;
    letter-spacing: .07em; color: var(--muted); text-align: left; flex-shrink: 0;
  }
  table.stack td .select-wrap, table.stack td form { width: auto; min-width: 0; }
  table.stack td select { min-width: 150px; }
  table.stack td .row-actions { justify-content: flex-end; flex-wrap: wrap; }
  /* Enkla nyckel/värde-tabeller: håll ihop men tillåt radbrytning */
  table:not(.stack) td { word-break: break-word; }
}
@media (max-width: 760px) {
  /* Login-loggan lite mindre på mobil */
  .login-logo { width: 132px; }
  .login-card { width: 100%; }
}
`;

interface LayoutProps {
  title: string;
  active?: string;
  dryRun?: boolean;
}

export const HEAD_FONTS = (
  <>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
    <link
      href="https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600&family=Wix+Madefor+Text:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </>
);

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({ title, active, dryRun, children }) => {
  const nav = [
    { href: "/", label: "Idag", key: "today" },
    { href: "/cabins", label: "Sjöbodar & koder", key: "cabins" },
    { href: "/customers", label: "Kundregister", key: "customers" },
    { href: "/log", label: "Logg", key: "log" },
    { href: "/settings", label: "Inställningar", key: "settings" },
  ];
  return (
    <html lang="sv">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · Hönö Sjöbodar</title>
        {HEAD_FONTS}
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>
        <header class="topbar">
          <div class="wrap topbar-inner">
            <a href="/" class="brand" aria-label="Hönö Sjöbodar">
              <span class="brand-mark" />
            </a>
            <nav class="main">
              {nav.map((n) => (
                <a href={n.href} class={active === n.key ? "active" : ""}>
                  {n.label}
                </a>
              ))}
            </nav>
            <div class="right">
              <span class={`dry-badge ${dryRun ? "" : "live-badge"}`}>
                {dryRun ? "Testläge" : "Skarpt läge"}
              </span>
              <a href="/logout" class="btn small ghost">
                Logga ut
              </a>
            </div>
          </div>
        </header>
        <main>
          <div class="wrap">{children}</div>
        </main>
      </body>
    </html>
  );
};
