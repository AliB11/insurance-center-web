import { norm, clean } from './text';

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
  'مرکزی': ['استان مرکزی'],
};

const entries: { canon: string; key: string }[] = [];
for (const p of PROVINCES) {
  entries.push({ canon: p, key: norm(p) });
  for (const a of ALIASES[p] || []) entries.push({ canon: p, key: norm(a) });
}
entries.sort((a, b) => b.key.length - a.key.length);

export function detectProvince(text: string): string {
  const n = ` ${norm(text).replace(/[-–—،,:()/]/g, ' ').replace(/\s+/g, ' ')} `;
  if (n.trim().length < 2) return '';
  for (const e of entries) {
    if (n.includes(` ${e.key} `)) return e.canon;
  }
  return '';
}

export function canonicalProvince(value: string): string {
  const v = clean(value).replace(/^استان\s*[:：]?\s*/, '');
  if (!v) return '';
  const d = detectProvince(v);
  return d || v;
}
