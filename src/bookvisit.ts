import { config } from "./config.js";
import { db, getSetting, setSetting } from "./db.js";
import { rebuildCustomers } from "./customers.js";

// ─── Token-hantering (cache + auto-renew) ────────────────────────────────────
let cachedToken: { token: string; fetchedAt: number } | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000; // BookVisit-token lever ~1h; vi förnyar efter 50 min.

async function fetchToken(): Promise<string> {
  if (!config.bookvisit.apiKey) {
    throw new Error("BOOKVISIT_API_KEY saknas i miljön.");
  }
  const url = `${config.bookvisit.baseUrl}/api/authentication/token-v1?apiKey=${encodeURIComponent(
    config.bookvisit.apiKey,
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`BookVisit-auth misslyckades: ${res.status} ${await safeText(res)}`);
  }
  const text = (await res.text()).trim().replace(/^"|"$/g, "");
  return text;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_TTL_MS) {
    return cachedToken.token;
  }
  const token = await fetchToken();
  cachedToken = { token, fetchedAt: Date.now() };
  return token;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Generiskt GET-anrop med retry/backoff vid 401/429/5xx.
async function apiGet(path: string, params: Record<string, string>, tries = 5): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    const token = await getToken();
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${config.bookvisit.baseUrl}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return res;
    if (res.status === 401) {
      cachedToken = null; // tvinga ny token
    }
    if ([401, 429, 500, 502, 503].includes(res.status)) {
      lastErr = new Error(`${res.status} på ${path}`);
      await sleep(800 * (i + 1));
      continue;
    }
    throw new Error(`BookVisit ${res.status} på ${path}: ${await safeText(res)}`);
  }
  throw lastErr instanceof Error ? lastErr : new Error(`BookVisit-anrop misslyckades: ${path}`);
}

// ─── Endpoints ───────────────────────────────────────────────────────────────
export async function listBookingCodes(updatedSinceIso?: string): Promise<string[]> {
  const params: Record<string, string> = { ChannelId: config.bookvisit.channelId };
  if (updatedSinceIso) params.UpdatedSinceFilter = updatedSinceIso;
  const res = await apiGet("/bookings/booking-codes-v1", params);
  const data = (await res.json()) as { bookingCodes?: string[] };
  return data.bookingCodes ?? [];
}

export interface RawBooking {
  bookingCustomer?: {
    firstName?: string | null;
    lastName?: string | null;
    phoneNumber?: string | null;
    phoneCountryCode?: string | null;
    email?: string | null;
  };
  bookingData?: {
    bookingGuidId?: string;
    startDate?: string;
    endDate?: string;
    bookingStatus?: string;
    rooms?: Array<{ roomId?: string }>;
    roomDescriptions?: Array<{ id?: string; name?: string }>;
  };
}

export async function getBooking(code: string): Promise<RawBooking | null> {
  try {
    const res = await apiGet("/bookings/booking-v1", {
      BookingCode: code,
      ChannelId: config.bookvisit.channelId,
    });
    return (await res.json()) as RawBooking;
  } catch (err) {
    // 404 = bokning saknas/historik – hoppa över tyst.
    if (err instanceof Error && /404/.test(err.message)) return null;
    throw err;
  }
}

// ─── Normalisering ───────────────────────────────────────────────────────────
export function normalizePhone(
  phone?: string | null,
  countryCode?: string | null,
): string | null {
  if (!phone) return null;
  let p = phone.replace(/[\s\-()]/g, "").trim();
  if (!p) return null;
  // Uppenbara testnummer ("00000000") räknas som ogiltiga.
  if (/^0+$/.test(p)) return null;
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);
  const cc = (countryCode ?? "").replace(/[^\d]/g, "");
  if (p.startsWith("0")) {
    // Nationellt format: ersätt ledande 0 med landskod (default 46/Sverige).
    return "+" + (cc || "46") + p.slice(1);
  }
  if (cc) return "+" + cc + p;
  return "+46" + p;
}

function fullName(c?: RawBooking["bookingCustomer"]): string {
  const n = `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim();
  return n || "Gäst";
}

function primaryRoom(bd?: RawBooking["bookingData"]): { roomId: string | null; label: string | null } {
  const roomId = bd?.rooms?.[0]?.roomId ?? null;
  let label: string | null = null;
  if (roomId && bd?.roomDescriptions) {
    label = bd.roomDescriptions.find((d) => d.id === roomId)?.name?.trim() ?? null;
  }
  if (!label) label = bd?.roomDescriptions?.[0]?.name?.trim() ?? null;
  return { roomId, label };
}

// ─── Synk till lokal spegling ────────────────────────────────────────────────
const upsertBooking = db.prepare(`
  INSERT INTO bv_bookings
    (booking_code, booking_guid, arrival_date, departure_date, status,
     guest_name, phone, phone_country, email, room_id, room_type_label, updated_at)
  VALUES
    (@booking_code, @booking_guid, @arrival_date, @departure_date, @status,
     @guest_name, @phone, @phone_country, @email, @room_id, @room_type_label, datetime('now'))
  ON CONFLICT(booking_code) DO UPDATE SET
    booking_guid=excluded.booking_guid, arrival_date=excluded.arrival_date,
    departure_date=excluded.departure_date, status=excluded.status,
    guest_name=excluded.guest_name, phone=excluded.phone,
    phone_country=excluded.phone_country, email=excluded.email,
    room_id=excluded.room_id, room_type_label=excluded.room_type_label,
    updated_at=datetime('now')
`);

export interface SyncResult {
  codes: number;
  fetched: number;
  failed: number;
  fullSync: boolean;
}

// Synkar BookVisit-bokningar till bv_bookings. Inkrementellt om vi synkat förut.
export async function syncBookings(options: { full?: boolean } = {}): Promise<SyncResult> {
  const lastSync = options.full ? null : getSetting("bv_last_sync");
  const startedAt = new Date().toISOString();

  // VIKTIGT: booking-codes-v1 kapar vid 1000 koder och returnerar de ÄLDSTA.
  // En ofiltrerad hämtning missar därför alla nya/kommande bokningar. Vid
  // initial/full synk använder vi istället ett look-back-fönster (uppdaterade
  // sedan) som ger de aktuella bokningarna och håller sig under 1000-taket.
  let sinceIso = lastSync;
  if (!sinceIso) {
    const d = new Date();
    d.setDate(d.getDate() - config.bookvisit.lookbackDays);
    sinceIso = d.toISOString();
  }

  const codes = await listBookingCodes(sinceIso);
  if (codes.length >= 1000) {
    console.warn(
      "[bookvisit] booking-codes returnerade 1000 (API-tak nått) – risk att nyaste bokningar trunkeras. Minska BOOKVISIT_LOOKBACK_DAYS.",
    );
  }
  let fetched = 0;
  let failed = 0;

  // Begränsad samtidighet för att inte trigga rate-limit.
  const concurrency = 4;
  let idx = 0;
  async function worker() {
    while (idx < codes.length) {
      const code = codes[idx++];
      try {
        const b = await getBooking(code);
        if (!b) continue;
        const bd = b.bookingData;
        const { roomId, label } = primaryRoom(bd);
        upsertBooking.run({
          booking_code: code,
          booking_guid: bd?.bookingGuidId ?? null,
          arrival_date: bd?.startDate ?? null,
          departure_date: bd?.endDate ?? null,
          status: bd?.bookingStatus ?? null,
          guest_name: fullName(b.bookingCustomer),
          phone: normalizePhone(b.bookingCustomer?.phoneNumber, b.bookingCustomer?.phoneCountryCode),
          phone_country: b.bookingCustomer?.phoneCountryCode ?? null,
          email: b.bookingCustomer?.email ?? null,
          room_id: roomId,
          room_type_label: label,
        });
        fetched++;
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  setSetting("bv_last_sync", startedAt);
  setSetting("bv_last_sync_human", startedAt);

  // Håll kundregistret uppdaterat efter varje synk.
  try {
    rebuildCustomers();
  } catch (err) {
    console.error("[bookvisit] kunde inte uppdatera kundregistret:", err);
  }

  return { codes: codes.length, fetched, failed, fullSync: !lastSync };
}

export interface CachedArrival {
  booking_code: string;
  booking_guid: string | null;
  arrival_date: string;
  guest_name: string | null;
  phone: string | null;
  email: string | null;
  room_id: string | null;
  room_type_label: string | null;
  status: string | null;
}

// Läser dagens (eller valt datums) aktiva ankomster ur den lokala speglingen.
// Endast boendebokningar (med en sjöbod/rumstyp) – standalone-/tilläggsbokningar
// utan rum har ingen dörrkod att skicka och tas inte med.
export function getArrivalsForDate(date: string): CachedArrival[] {
  return db
    .prepare(
      `SELECT booking_code, booking_guid, arrival_date, guest_name, phone, email,
              room_id, room_type_label, status
       FROM bv_bookings
       WHERE arrival_date = ? AND status IS NOT 'Cancelled' AND room_id IS NOT NULL
       ORDER BY guest_name`,
    )
    .all(date) as CachedArrival[];
}

// Antal bokningar för datumet som saknar boende (standalone/tillval) – döljs i listan.
export function countRoomlessForDate(date: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM bv_bookings
         WHERE arrival_date = ? AND status IS NOT 'Cancelled' AND room_id IS NULL`,
      )
      .get(date) as { n: number }
  ).n;
}

export function bookingCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM bv_bookings").get() as { n: number };
  return row.n;
}

// Distinkta rumstyper sedda i bokningarna (för att koppla stugor till typ).
export function getRoomTypes(): { id: string; label: string }[] {
  return db
    .prepare(
      `SELECT room_id AS id, MAX(room_type_label) AS label
       FROM bv_bookings WHERE room_id IS NOT NULL
       GROUP BY room_id ORDER BY label`,
    )
    .all() as { id: string; label: string }[];
}
