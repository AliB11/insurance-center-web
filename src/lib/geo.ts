import { norm, clean } from './text';
import { STREET_WORDS } from './scope';

export const PROVINCES: string[] = [
  'آذربایجان شرقی', 'آذربایجان غربی', 'اردبیل', 'اصفهان', 'البرز', 'ایلام', 'بوشهر', 'تهران',
  'چهارمحال و بختیاری', 'خراسان جنوبی', 'خراسان رضوی', 'خراسان شمالی', 'خوزستان', 'زنجان', 'سمنان',
  'سیستان و بلوچستان', 'فارس', 'قزوین', 'قم', 'کردستان', 'کرمان', 'کرمانشاه', 'کهگیلویه و بویراحمد',
  'گلستان', 'گیلان', 'لرستان', 'مازندران', 'مرکزی', 'هرمزگان', 'همدان', 'یزد',
];

const ALIASES: Record<string, string[]> = {
  'کهگیلویه و بویراحمد': ['کهگیلویه', 'کهکیلویه و بویراحمد', 'کهگیلویه و بویر احمد'],
  'سیستان و بلوچستان': ['سیستان', 'سیستان بلوچستان'],
  'چهارمحال و بختیاری': ['چهارمحال', 'چهار محال و بختیاری', 'چهار محال بختیاری', 'چهارمحال بختیاری'],
  'آذربایجان شرقی': ['اذربایجان شرقی', 'آذربایجان‌شرقی'],
  'آذربایجان غربی': ['اذربایجان غربی', 'آذربایجان‌غربی'],
  'خراسان رضوی': ['خراسان‌رضوی'],
  'خراسان شمالی': ['خراسان‌شمالی'],
  'خراسان جنوبی': ['خراسان‌جنوبی'],
};

const entries: { canon: string; key: string }[] = [];
for (const p of PROVINCES) {
  entries.push({ canon: p, key: norm(p) });
  for (const a of ALIASES[p] || []) entries.push({ canon: p, key: norm(a) });
}
entries.sort((a, b) => b.key.length - a.key.length);

/**
 * نام‌هایی که در متن آزاد تقریباً همیشه صفت یا نام مکان‌اند («دفتر مرکزی»، «بیمارستان
 * گلستان»، «ساختمان البرز»)؛ فقط به‌صورت کامل یا با واژهٔ «استان» استان حساب می‌شوند.
 */
const EXPLICIT_ONLY = new Set(['مرکزی', 'گلستان', 'البرز'].map(norm));

/** واژه‌هایی که اگر درست پیش از نام استان بیایند، آن نام بخشی از نام معبر/مکان است. */
const GUARD_WORDS = new Set([...STREET_WORDS, 'بست', 'راه', 'هتل', 'دانشگاه', 'ترمینال', 'فرودگاه', 'سینما'].map(norm));

const prepare = (text: string) => ` ${norm(text).replace(/[-–—،,:：()/.]/g, ' ').replace(/\s+/g, ' ')} `;

/** متن دقیقاً نام یک استان است: «تهران»، «استان تهران»، «استان: تهران». */
export function exactProvince(text: string): string {
  const n = prepare(text).trim().replace(/^استان\s+/, '');
  if (!n) return '';
  for (const e of entries) if (n === e.key) return e.canon;
  return '';
}

/**
 * نام کامل یا عبارت صریح «استان X» در هر جای متن (عنوان بخش، نام شیت).
 * «خیابان قزوین» یا «بزرگراه کردستان» هرگز استان حساب نمی‌شوند.
 */
export function explicitProvince(text: string): string {
  const exact = exactProvince(text);
  if (exact) return exact;
  const n = prepare(text);
  let best: { canon: string; index: number } | null = null;
  for (const e of entries) {
    const i = n.indexOf(` استان ${e.key} `);
    if (i >= 0 && (!best || i < best.index)) best = { canon: e.canon, index: i };
  }
  return best?.canon ?? '';
}

/**
 * برای مقدار ستون صریح «استان»: زودترین نام استانی که بخشی از نام معبر/مکان نیست.
 *   «تهران - بزرگراه کردستان» → تهران  (نسخهٔ قبلی طولانی‌ترین نام را برمی‌داشت: کردستان)
 *   «بزرگراه کردستان»        → ''
 * ⚠️ این تابع روی آدرس فراخوانی نمی‌شود؛ آدرس هیچ‌وقت تعیین‌کنندهٔ استان نیست.
 */
export function detectProvince(text: string): string {
  const explicit = explicitProvince(text);
  if (explicit) return explicit;
  const n = prepare(text);
  if (n.trim().length < 2) return '';
  let best: { canon: string; index: number; len: number } | null = null;
  for (const e of entries) {
    if (EXPLICIT_ONLY.has(e.key)) continue;
    let from = 0;
    for (;;) {
      const i = n.indexOf(` ${e.key} `, from);
      if (i < 0) break;
      const before = n.slice(0, i).trim().split(' ').pop() ?? '';
      if (!GUARD_WORDS.has(before)) {
        if (!best || i < best.index || (i === best.index && e.key.length > best.len)) {
          best = { canon: e.canon, index: i, len: e.key.length };
        }
        break;
      }
      from = i + 1;
    }
  }
  return best?.canon ?? '';
}

export function canonicalProvince(value: string): string {
  const v = clean(value).replace(/^استان\s*[:：]?\s*/, '');
  if (!v) return '';
  return detectProvince(v) || v;
}
