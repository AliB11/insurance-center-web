import { toLatinDigits } from './text';

export interface Coordinates { lat: number; lng: number }
export interface Destination {
  name: string;
  province: string;
  city: string;
  address: string;
  coordinates?: Coordinates;
}

export function validCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== 'object') return false;
  const { lat, lng } = value as Coordinates;
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function parseCoordinates(lat: string, lng: string): Coordinates | undefined {
  const number = (s: string) => {
    const text = toLatinDigits(s).trim().replace(/٫/g, '.');
    return /^[+-]?\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  };
  const point = { lat: number(lat), lng: number(lng) };
  return validCoordinates(point) ? point : undefined;
}

export function destinationText(c: Destination): string {
  return [...new Set([c.province, c.city, c.address, c.name].filter(Boolean))].join('، ');
}

const pair = (p: Coordinates) => `${p.lat},${p.lng}`;

/** Documented Neshan links use latitude,longitude (not GeoJSON order). */
export function neshanUrl(destination: Coordinates, origin?: Coordinates, ios = false): string {
  if (!validCoordinates(destination) || (origin && !validCoordinates(origin))) throw new Error('مختصات نامعتبر است');
  if (origin) return `${ios ? 'neshan://' : 'https://nshn.ir/'}?origin=${pair(origin)}&destination=${pair(destination)}&vehicle=d`;
  return ios ? `neshan://?ll=${pair(destination)}` : `https://nshn.ir/?lat=${destination.lat}&lng=${destination.lng}`;
}

export function googleUrl(c: Destination, point = c.coordinates): string {
  const params = new URLSearchParams({ api: '1', query: validCoordinates(point) ? pair(point) : destinationText(c) });
  return `https://www.google.com/maps/search/?${params}`;
}

export function wazeUrl(point: Coordinates): string {
  if (!validCoordinates(point)) throw new Error('مختصات نامعتبر است');
  return `https://www.waze.com/ul?ll=${pair(point)}&navigate=yes`;
}
