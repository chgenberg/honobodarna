# Hönö Sjöbodar – automatiska dörrkoder

Liten webbapp som varje morgon hämtar dagens incheckande gäster från **BookVisit**,
matchar varje gäst mot rätt sjöbod och dess dörrkod, och skickar koden via **SMS**
(46elks) – eller **e-post** om telefonnummer saknas. Allt sköts från en enkel,
lösenordsskyddad admin-dashboard.

Byggd med [Hono](https://hono.dev/) + TypeScript och SQLite. Driftsätts enkelt via
GitHub → Railway.

---

## Vad den gör

- **Hämtar bokningar** från BookVisits REST-API och speglar dem lokalt (snabbt + skonsamt mot API:t).
- **Matchar** varje ankomst mot en fysisk sjöbod utifrån BookVisit-rumstyp.
  - Unik rumstyp → automatisk matchning.
  - Rumstyp med flera stugor (t.ex. flera standard-sjöbodar) → matchas till en ledig stuga och **flaggas för granskning** så Anna kan bekräfta/ändra.
- **Skickar dörrkod**: SMS i första hand, e-post som fallback när nummer saknas.
- **Hanterar koder**: byt dörrkod per sjöbod direkt i gränssnittet (med historik).
- **Loggar** varje utskick och varje morgonkörning.
- **Testläge (DRY_RUN)** och **canary-läge** så inget riktigt skickas förrän ni vill.

## Viktigt om matchningen (läs detta)

BookVisits API anger bara **rumstyp** på en bokning (Sjöbod, Sjöbod djurvänlig,
Sjöbod tillgänglighetsanpassad, Villa) – **inte** vilken specifik fysisk stuga av flera.
Därför äger den här appen själv stug-registret under **"Sjöbodar & koder"**. När en
rumstyp har flera fysiska stugor väljer appen en ledig och markerar raden
**"Granska matchning"** så att en människa bekräftar innan koden går ut.

---

## Kom igång lokalt

```bash
npm install
cp .env.example .env      # fyll i värden (se nedan)
npm run dev               # startar på http://localhost:3000
```

Logga in med `ADMIN_USERNAME` / `ADMIN_PASSWORD` från din `.env`.

### Testa hela flödet utan att skicka något

```bash
# Se till att DRY_RUN=true i .env
npm run seed              # lägger in 6 exempel-sjöbodar + 5 test-gäster för idag
```

Gå till dashboarden → tryck **"Synka & uppdatera"** → **"Skicka alla koder (test)"**.
Allt loggas under **Logg** utan att något riktigt SMS/mejl skickas.

---

## Miljövariabler

Alla finns dokumenterade i [`.env.example`](./.env.example). De viktigaste:

| Variabel | Beskrivning |
| --- | --- |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Inloggning till dashboarden |
| `SESSION_SECRET` | Lång slumpsträng som signerar inloggnings-cookien |
| `BOOKVISIT_API_KEY` / `BOOKVISIT_CHANNEL_ID` | BookVisit-uppgifter |
| `ELKS_API_USERNAME` / `ELKS_API_PASSWORD` | SMS via 46elks |
| `SMS_SENDER` | Avsändarnamn i SMS (max 11 tecken) |
| `SMTP_*` / `EMAIL_FROM` | E-post-fallback |
| `DRY_RUN` | `true` = inget skickas (loggas bara). Sätt `false` för skarpt läge |
| `CANARY_PHONE` / `CANARY_EMAIL` | Om satt: alla meddelanden går hit istället (test) |
| `CRON_SCHEDULE` | När morgonjobbet körs, t.ex. `0 7 * * *` (07:00) |
| `AUTO_SEND` | `true` = skicka automatiskt på morgonen. `false` = förbered, Anna trycker skicka |
| `DATABASE_PATH` | Sökväg till SQLite-filen (på Railway: en monterad volym) |

> **Hemligheter checkas aldrig in.** `.env` är gitignorerad. På Railway sätts
> variablerna i projektets *Variables*.

---

## Driftsätt på Railway

1. Pusha repot till GitHub.
2. I [Railway](https://railway.app): **New Project → Deploy from GitHub repo**.
3. Lägg till en **Volume** och montera den på t.ex. `/data`. Sätt `DATABASE_PATH=/data/app.sqlite`.
4. Lägg in alla miljövariabler under **Variables** (samma som `.env.example`).
   - Börja med `DRY_RUN=true` tills allt verifierats.
5. Railway bygger automatiskt (Nixpacks) och startar med `npm start`.
6. När allt ser bra ut: sätt `ELKS_*` + `SMTP_*`, och slutligen `DRY_RUN=false`.

Morgonjobbet körs av en inbyggd cron i appen (`CRON_SCHEDULE`, tidszon `TZ`).

### Första körningen
Tryck **"Tvinga full synk"** i Inställningar en gång för att fylla den lokala
speglingen. Därefter sker synk inkrementellt och snabbt.

---

## Att göra innan skarp drift

- [ ] Lägg upp de riktiga sjöbodarna under **Sjöbodar & koder** och koppla dem till rätt BookVisit-rumstyp.
- [ ] Lägg in nuvarande dörrkoder.
- [ ] Anpassa SMS-/mejltexter under **Inställningar**.
- [ ] Skicka ett testmeddelande till dig själv (Inställningar → Skicka test).
- [ ] Sätt `CANARY_PHONE` till ditt eget nummer och kör en skarp test mot dig själv.
- [ ] Bestäm `AUTO_SEND` (helautomatiskt) eller manuellt morgon-godkännande.
- [ ] Sätt `DRY_RUN=false`.

## Skript

| Kommando | Gör |
| --- | --- |
| `npm run dev` | Startar i utvecklingsläge (auto-reload) |
| `npm start` | Startar servern |
| `npm run seed` | Seedar exempel-stugor + test-gäster |
| `npm run send:today` | Kör morgonjobbet manuellt (`-- --send` för att tvinga utskick) |
| `npm run typecheck` | TypeScript-kontroll |
