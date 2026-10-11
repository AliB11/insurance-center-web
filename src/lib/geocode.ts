/**
 * Address → coordinate lookup used by the routing modal.
 *
 * Policy (see README «اگر فقط آدرس متنی داریم»):
 *  • nothing is fetched without an explicit click;
 *  • a hit is only offered as a *candidate*: it must sit inside Iran, and its
 *    city/province must agree with the center's own fields, plus (when the
 *    dataset has other located centers in the same city) it must be near them.
 *    A same-named street in another city (the classic «خیابان کمیل» trap) is
 *    rejected outright; ambiguous answers stay human-confirmed.
 *  • the Neshan web key is optional, supplied by the user, stored in this
 *    browser only, and sent to api.neshan.org and nowhere else.
 */
import { clean, norm } from './text';
import { coordinateSanity, distanceKm, validCoordinates, type Coordinates } from './routing';

export type GeoSource = 'neshan' | 'nominatim';

export interface GeoTarget {
  name: string;
  province: string;
  city: string;
  address: string;
}

export interface GeoCandidate {
  point: Coordinates;
  label: string;
  source: GeoSource;
  /** Answered city/province fields, when the provider returns them. */
  city?: string;
  province?: string;
  /** Part of the input the Neshan plus/normal service could not match. */
  unmatched?: string;
  cityMatch: boolean;
  provinceMatch: boolean;
  /** km to the nearest located center of the same city, when the dataset has one. */
  nearPeerKm?: number;
  /** Candidate may be offered for confirmation. */
  accepted: boolean;
  /** Human-readable reason when rejected. */
  reason?: string;
}

interface RawHit {
  lat: number;
  lng: number;
  label: string;
  city?: string;
  province?: string;
  unmatched?: string;
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BODY_CHARS = 400_000;
/** Peer-distance thresholds in km: beyond `reject` the answer belongs to another settlement. */
const PEER_REJECT_KM = 80;
const PEER_WARN_KM = 40;

export function neshanAddressQuery(t: GeoTarget): string {
  return clean([t.province, t.city, t.address].filter(Boolean).join(' '));
}
export function nominatimQuery(t: GeoTarget): string {
  return clean([t.name, t.city, t.address].filter(Boolean).join(' '));
}

async function getJson(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, FETCH_TIMEOUT_MS);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await fetch(url, { signal: controller.signal, headers, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP:${response.status}`);
    const text = await response.text();
    if (!text || text.length > MAX_BODY_CHARS) throw new Error('HTTP:0');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/**
 * Neshan geocoding v1: `https://api.neshan.org/geocoding/v1?json={address,province,city}`
 * with header `Api-Key`. Response: `{items:[{location:{latitude,longitude},city,province,neighbourhood,unMatchedTerm}]}`.
 * Also tolerates the legacy v4 shape `{status, location:{x:lng, y:lat}}` in case the key is scoped to it.
 */
export function parseNeshanGeocode(raw: unknown): RawHit[] {
  const body = asRecord(raw);
  const items = Array.isArray(body.items) ? body.items : [];
  const hits: RawHit[] = [];
  for (const item of items) {
    const it = asRecord(item);
    const loc = asRecord(it.location);
    const lat = num(loc.latitude ?? loc.lat);
    const lng = num(loc.longitude ?? loc.lng);
    if (lat === undefined || lng === undefined) continue;
    const city = str(it.city);
    const neighbourhood = str(it.neighbourhood);
    const label = [str(it.province), city, neighbourhood].filter(Boolean).join('، ') || 'نتیجهٔ بدون برچسب';
    hits.push({ lat, lng, label, city, province: str(it.province), unmatched: str(it.unMatchedTerm) });
  }
  if (hits.length === 0 && str(body.status) === 'OK') {
    const loc = asRecord(body.location);
    const lat = num(loc.y);
    const lng = num(loc.x);
    if (lat !== undefined && lng !== undefined) hits.push({ lat, lng, label: 'پاسخ قدیمی v4 (بدون جزئیات)' });
  }
  return hits;
}

/** Nominatim jsonv2 array: [{lat, lon, display_name, address:{city,state,county,...}}]. */
export function parseNominatimHits(raw: unknown): RawHit[] {
  if (!Array.isArray(raw)) return [];
  const hits: RawHit[] = [];
  for (const item of raw) {
    const it = asRecord(item);
    const lat = num(it.lat);
    const lng = num(it.lon);
    if (lat === undefined || lng === undefined) continue;
    const addr = asRecord(it.address);
    const city = str(addr.city ?? addr.town ?? addr.village ?? addr.county);
    const province = str(addr.state ?? addr.province);
    hits.push({ lat, lng, label: str(it.display_name) ?? 'بی‌نام', city, province });
  }
  return hits;
}

export function neshanErrorMessage(statusText: string): string {
  const map: Record<string, string> = {
    '400': 'آدرس قابل پردازش نبود؛ آن را کوتاه‌تر و با ترتیب «استان، شهر، خیابان…» امتحان کنید.',
    '422': 'آدرس قابل پردازش نبود؛ اجزای اضافی (پلاک، طبقه، نام ساختمان) را حذف کنید.',
    '470': 'مختصات بازگشتی از سرویس معتبر نبود.',
    '480': 'کلید نشان معتبر نیست یا در هدر ارسال نشده است.',
    '481': 'سقف تعداد درخواست‌های کلید نشان پر شده است.',
    '482': 'تعداد درخواست با این کلید در دقیقه بیش از حد مجاز است؛ کمی صبر کنید.',
    '483': 'نوع کلید با این سرویس هم‌خوان نیست (کلید وب‌سرویس لازم است).',
    '484': 'کلید شما اجازهٔ استفاده از این سرویس را ندارد (اسکوپ/دامنهٔ بسته).',
    '485': 'سرویس ژئوکدینگ برای این کلید فعال نشده است.',
    '401': 'کلید نشان پذیرفته نشد.',
    '403': 'دسترسی کلید نشان رد شد.',
    '500': 'سرویس نشان موقتاً خطا دارد؛ بعداً دوباره امتحان کنید.',
    '0': 'اتصال به سرویس برقرار نشد (شبکه، CORS یا آدرس‌دهی). اتصال اینترنت را بررسی کنید.',
  };
  return map[statusText] ?? `سرویس با خطای ${statusText} پاسخ داد.`;
}

export async function searchWithNeshan(t: GeoTarget, key: string, signal?: AbortSignal): Promise<RawHit[]> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('KEY:missing');
  const payload: Record<string, string> = { address: neshanAddressQuery(t) };
  if (t.province) payload.province = t.province.replace(/^استان\s*/, '');
  if (t.city) payload.city = t.city;
  const url = `https://api.neshan.org/geocoding/v1?json=${encodeURIComponent(JSON.stringify(payload))}`;
  try {
    const json = await getJson(url, { 'Api-Key': trimmed }, signal);
    return parseNeshanGeocode(json);
  } catch (error) {
    const message = String((error as Error)?.message ?? '');
    const status = /^HTTP:(\d+)$/.exec(message)?.[1] ?? '0';
    throw new Error(status === '0' && message.includes('abort') ? 'ABORT' : neshanErrorMessage(status));
  }
}

export async function searchWithNominatim(t: GeoTarget, signal?: AbortSignal): Promise<RawHit[]> {
  const params = new URLSearchParams({
    format: 'jsonv2', limit: '3', countrycodes: 'ir', 'accept-language': 'fa', q: nominatimQuery(t),
  });
  try {
    const json = await getJson(`https://nominatim.openstreetmap.org/search?${params}`, { 'Accept': 'application/json' }, signal);
    return parseNominatimHits(json);
  } catch (error) {
    const message = String((error as Error)?.message ?? '');
    if (message.includes('abort')) throw new Error('ABORT');
    throw new Error('اتصال به نقشهٔ آزاد (OSM) برقرار نشد؛ اتصال شبکه را بررسی کنید.');
  }
}

/** Coordinates of already-located centers of the same city — the dataset anchors the check. */
export function peerAnchors(centers: { city: string; coordinates?: Coordinates }[], city: string): Coordinates[] {
  if (!city) return [];
  const want = norm(city);
  const out: Coordinates[] = [];
  for (const c of centers) {
    if (!c.coordinates || norm(c.city) !== want) continue;
    if (validCoordinates(c.coordinates) && coordinateSanity(c.coordinates).state === 'ok') out.push(c.coordinates);
  }
  return out;
}

/**
 * Pure vetting step: every provider answer passes here before reaching the UI.
 * Rejection reasons are surfaced to the user; accepted points still need one human click.
 */
export function vetHits(hits: RawHit[], t: GeoTarget, peers: Coordinates[], source: GeoSource): GeoCandidate[] {
  const wantCity = t.city ? norm(t.city) : '';
  const wantProvince = t.province ? norm(t.province.replace(/^استان\s*/, '')) : '';
  return hits.map((hit) => {
    const point: Coordinates = { lat: hit.lat, lng: hit.lng };
    const base: Omit<GeoCandidate, 'accepted' | 'reason' | 'cityMatch' | 'provinceMatch' | 'nearPeerKm'> = {
      point, label: hit.label, source, city: hit.city, province: hit.province, unmatched: hit.unmatched,
    };
    if (!validCoordinates(point)) return { ...base, cityMatch: false, provinceMatch: false, accepted: false, reason: 'مختصات پاسخ نامعتبر بود' };
    const sanity = coordinateSanity(point);
    if (sanity.state !== 'ok') return { ...base, cityMatch: false, provinceMatch: false, accepted: false, reason: `پاسخ خارج از ایران بود (${sanity.hint || sanity.state})` };
    const haystackCity = norm([hit.city, hit.label].filter(Boolean).join(' '));
    const haystackProvince = norm([hit.province, hit.label].filter(Boolean).join(' '));
    const cityMatch = !wantCity || haystackCity.includes(wantCity);
    const provinceMatch = !wantProvince || haystackProvince.includes(wantProvince);
    let nearPeerKm: number | undefined;
    let reason: string | undefined;
    if (peers.length) {
      nearPeerKm = Math.min(...peers.map((p) => distanceKm(point, p)));
      if (nearPeerKm > PEER_REJECT_KM) {
        reason = `حدوداً ${Math.round(nearPeerKm)} کیلومتر از مراکز هم‌شهر این نقطه فاصله دارد؛ احتمالاً پاسخ برای شهر دیگری با نام مشابه است`;
      }
    }
    if (!reason && !cityMatch) reason = 'نام شهرِ پاسخ با شهر مرکز یکسان نبود؛ حتماً دستی بررسی کنید';
    if (!reason && !provinceMatch) reason = 'نام استانِ پاسخ با استان مرکز یکسان نبود؛ حتماً دستی بررسی کنید';
    const accepted = cityMatch && provinceMatch && (!nearPeerKm || nearPeerKm <= PEER_REJECT_KM);
    if (accepted && nearPeerKm !== undefined && nearPeerKm > PEER_WARN_KM) {
      reason = `نسبتاً دور از دیگر مراکز این شهر (حدوداً ${Math.round(nearPeerKm)} کیلومتر)؛ پیش از تأیید نگاهی به نقشه بیندازید`;
    }
    return { ...base, cityMatch, provinceMatch, nearPeerKm, accepted, reason };
  });
}

export async function lookupCandidates(t: GeoTarget, centers: { city: string; coordinates?: Coordinates }[], opts: { source: GeoSource; key?: string; signal?: AbortSignal }): Promise<GeoCandidate[]> {
  const peers = peerAnchors(centers, t.city);
  const hits = opts.source === 'neshan'
    ? await searchWithNeshan(t, opts.key ?? '', opts.signal)
    : await searchWithNominatim(t, opts.signal);
  return vetHits(hits, t, peers, opts.source);
}

const KEY_STORAGE = 'sepah-neshan-key';

export function loadNeshanKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
export function saveNeshanKey(key: string): boolean {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
    return true;
  } catch { return false; }
}
