import type { Center } from './parser';
import { norm } from './text';

export interface Filters {
  q: string;
  category: string;
  province: string;
  city: string;
  kind: string;
  hasPhone: boolean;
  favOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  q: '', category: '', province: '', city: '', kind: '', hasPhone: false, favOnly: false,
};

/**
 * نوع معبر در جستجو اختیاری است: «اتوبان کردستان» باید «بزرگراه کردستان» را پیدا کند و
 * «خیابان ولیعصر» مرکزی را که آدرسش فقط «ولیعصر، …» است. (به‌صورت نرمال‌شده)
 */
const STREET_TYPE_TOKENS = new Set(['خیابان', 'بلوار', 'میدان', 'بزرگراه', 'اتوبان', 'ازادراه', 'کوچه', 'جاده', 'کوی', 'چهارراه', 'فلکه']);

export function tokensOf(q: string): string[] {
  const toks = norm(q).split(' ').filter(Boolean);
  const meaningful = toks.filter((t) => !STREET_TYPE_TOKENS.has(t));
  // «کوچه ۱۲» را به «۱۲» تقلیل نده: عدد تنها تقریباً با همه‌چیز جور است
  return meaningful.some((t) => !/^\d+$/.test(t)) ? meaningful : toks;
}

/** محل مرکز بدون تکرار: «تهران» (نه «تهران، تهران») یا «تهران، شهریار». */
export function placeLabel(c: Pick<Center, 'province' | 'city'>): string {
  return [...new Set([c.province, c.city].map((x) => x.trim()).filter(Boolean))].join('، ');
}

export function applyFilters(
  all: Center[],
  f: Filters,
  favs: Set<number>,
  exclude?: keyof Filters,
): Center[] {
  const toks = exclude === 'q' ? [] : tokensOf(f.q);
  return all.filter((c) => {
    if (exclude !== 'category' && f.category && c.category !== f.category) return false;
    if (exclude !== 'province' && f.province && c.province !== f.province) return false;
    if (exclude !== 'city' && f.city && c.city !== f.city) return false;
    if (exclude !== 'kind' && f.kind && c.kind !== f.kind) return false;
    if (exclude !== 'hasPhone' && f.hasPhone && c.phones.length === 0) return false;
    if (exclude !== 'favOnly' && f.favOnly && !favs.has(c.id)) return false;
    for (const t of toks) if (!c.search.includes(t)) return false;
    return true;
  });
}

export function relevance(c: Center, toks: string[]): number {
  let s = 0;
  for (const t of toks) {
    if (c.nameN.startsWith(t)) s += 8;
    else if (c.nameN.includes(t)) s += 5;
    if (c.locN.includes(t)) s += 3;
    if (c.catN.includes(t)) s += 2;
    s += 1;
  }
  return s;
}

export function countBy(list: Center[], key: (c: Center) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const c of list) {
    const k = key(c);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fa'));
}

export function categoryEmoji(name: string): string {
  const n = norm(name);
  const rules: [RegExp, string][] = [
    [/بیمارستان/, '🏥'], [/داروخانه/, '💊'], [/ازمایشگاه/, '🧪'],
    [/رادیولوژی|سونوگرافی|تصویربرداری|ام ار ای|mri|سی تی|ماموگرافی/, '🩻'],
    [/دندان/, '🦷'], [/عینک|اپتیک|اپتومتری|چشم/, '👓'], [/فیزیوتراپی|توانبخشی/, '🦴'],
    [/دیالیز/, '💧'], [/شنوایی|سمعک|گفتار/, '👂'], [/روان|مشاوره/, '🧠'],
    [/زنان|زایمان|ماما/, '🤱'], [/کلینیک|درمانگاه|مطب|پلی/, '🩺'],
    [/پزشک|متخصص|دکتر/, '👨‍⚕️'], [/جراحی/, '🔬'], [/قلب/, '❤️'],
  ];
  for (const [re, e] of rules) if (re.test(n)) return e;
  return '📋';
}
