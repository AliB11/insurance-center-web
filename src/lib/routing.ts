import { toLatinDigits } from './text';

export interface Coordinates { lat: number; lng: number }
export interface Destination {
  name: string;
  province: string;
  city: string;
  address: string;
  coordinates?: Coordinates;
}

export type NeshanVehicle = 'd' | 'm';
/** iOS deep links additionally document bicycle, public transit and walking. */
export type NeshanRouteVehicle = NeshanVehicle | 'b' | 'p' | 'w';

export function validCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== 'object') return false;
  const { lat, lng } = value as Coordinates;
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Rough WGS84 bounding box of Iran with ~1° margin; only a plausibility check, not a border. */
export const IRAN_BOX = { minLat: 23.5, maxLat: 40.5, minLng: 43.0, maxLng: 64.3 };

export function isInIran(p: Coordinates): boolean {
  return p.lat >= IRAN_BOX.minLat && p.lat <= IRAN_BOX.maxLat && p.lng >= IRAN_BOX.minLng && p.lng <= IRAN_BOX.maxLng;
}

export type SanityState = 'ok' | 'outside-iran' | 'probable-swap' | 'null-island';
export interface SanityResult {
  state: SanityState;
  hint: string;
  /** When state is 'probable-swap', the corrected point (never applied silently). */
  swapped?: Coordinates;
}

/**
 * Plausibility of a coordinate pair for Iranian centers.
 * Catches the classic Excel mistakes: lat/lng swapped, zero placeholders,
 * and points from a geocoder that answered a same-named street in another country.
 */
export function coordinateSanity(p: Coordinates): SanityResult {
  if (!validCoordinates(p)) return { state: 'outside-iran', hint: 'مختصات نامعتبر است' };
  if (Math.abs(p.lat) < 0.5 && Math.abs(p.lng) < 0.5) {
    return { state: 'null-island', hint: 'مختصات صفر است و جای واقعی مرکز را نشان نمی‌دهد' };
  }
  if (isInIran(p)) return { state: 'ok', hint: '' };
  const swapped = { lat: p.lng, lng: p.lat };
  if (isInIran(swapped)) {
    return { state: 'probable-swap', hint: 'به نظر عرض و طول جغرافیایی جابه‌جا وارد شده‌اند', swapped };
  }
  return { state: 'outside-iran', hint: 'این نقطه در محدودهٔ جغرافیایی ایران نیست' };
}

const DMS_RE = /^([+-]?)\s*(\d{1,3}(?:\.\d+)?)\s*(?:[°د]\s*(\d{1,2}(?:\.\d+)?)?\s*(?:['′]\s*(\d{1,2}(?:\.\d+)?)?\s*(?:["″])?)?)?\s*([NSEWnsew])?$/;

/** Parses decimals, Persian/Arabic digits, Persian decimal comma, DMS and hemisphere letters. */
function parseAngle(value: string, axis: 'lat' | 'lng'): number {
  let text = toLatinDigits(String(value ?? '').trim())
    .replace(/٫/g, '.')
    .replace(/[٬،]/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/[′’`]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/\s+/g, ' ');
  // Persian hemisphere words
  text = text
    .replace(/شمالی|شمال/g, 'N').replace(/جنوبی|جنوب/g, 'S')
    .replace(/شرقی|شرق/g, 'E').replace(/غربی|غرب/g, 'W')
    .replace(/\s+/g, ' ').trim();
  const m = DMS_RE.exec(text);
  if (!m) return NaN;
  const deg = Number(m[2]);
  const min = m[3] ? Number(m[3]) : 0;
  const sec = m[4] ? Number(m[4]) : 0;
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return NaN;
  if (min >= 60 || sec >= 60) return NaN;
  let out = deg + min / 60 + sec / 3600;
  const hemi = (m[5] || '').toUpperCase();
  if (m[1] === '-') out = -out;
  if (hemi === 'S' || hemi === 'W') out = -Math.abs(out);
  const limit = axis === 'lat' ? 90 : 180;
  if (!Number.isFinite(out) || Math.abs(out) > limit) return NaN;
  return out;
}

export function parseCoordinates(lat: string, lng: string): Coordinates | undefined {
  const la = parseAngle(lat, 'lat');
  const ln = parseAngle(lng, 'lng');
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return undefined;
  const point = { lat: la, lng: ln };
  return validCoordinates(point) ? point : undefined;
}

export function destinationText(c: Destination): string {
  return [...new Set([c.province, c.city, c.address, c.name].filter(Boolean))].join('، ');
}

/** Short canonical decimal text for URLs (7 digits ≈ 1 cm; strips float noise like 51.400000000000006). */
export function formatCoord(n: number): string {
  const fixed = n.toFixed(7);
  const trimmed = fixed.replace(/\.?0+$/, '');
  if (trimmed === '' || trimmed === '-0') return '0';
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : fixed;
}

const pair = (p: Coordinates) => `${formatCoord(p.lat)},${formatCoord(p.lng)}`;

export interface NeshanLinkOptions {
  origin?: Coordinates;
  vehicle?: NeshanRouteVehicle;
  /** iOS application deep link (neshan://) instead of the nshn.ir web link. */
  ios?: boolean;
}

/**
 * Neshan links exactly as documented in platform.neshan.org FAQ:
 *   web/android point : https://nshn.ir/?lat=LAT&lng=LNG
 *   web/android route : https://nshn.ir/?origin=lat,lng&destination=lat,lng&vehicle=d|m
 *   iOS point         : neshan://?ll=lat,lng
 *   iOS route         : neshan://?origin=lat,lng&destination=lat,lng&vehicle=…
 * Order is always latitude,longitude (not GeoJSON order).
 */
export function neshanUrl(destination: Coordinates, opts: NeshanLinkOptions = {}): string {
  if (!validCoordinates(destination)) throw new Error('مختصات نامعتبر است');
  const { origin, vehicle = 'd', ios = false } = opts;
  if (origin && !validCoordinates(origin)) throw new Error('مختصات مبدأ نامعتبر است');
  if (origin) {
    return `${ios ? 'neshan://' : 'https://nshn.ir/'}?origin=${pair(origin)}&destination=${pair(destination)}&vehicle=${vehicle}`;
  }
  return ios
    ? `neshan://?ll=${pair(destination)}`
    : `https://nshn.ir/?lat=${formatCoord(destination.lat)}&lng=${formatCoord(destination.lng)}`;
}

/**
 * Google Maps URLs (api=1): search pin when coordinates are known,
 * documented directions URL when an origin is available, plain text query otherwise.
 */
export function googleUrl(c: Destination, point = c.coordinates, origin?: Coordinates): string {
  if (origin && validCoordinates(origin) && validCoordinates(point)) {
    const params = new URLSearchParams({
      api: '1', origin: pair(origin), destination: pair(point), travelmode: 'driving',
    });
    return `https://www.google.com/maps/dir/?${params}`;
  }
  const params = new URLSearchParams({ api: '1', query: validCoordinates(point) ? pair(point) : destinationText(c) });
  return `https://www.google.com/maps/search/?${params}`;
}

export function wazeUrl(point: Coordinates): string {
  if (!validCoordinates(point)) throw new Error('مختصات نامعتبر است');
  return `https://www.waze.com/ul?ll=${pair(point)}&navigate=yes`;
}

/** Haversine great-circle distance in kilometers. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
