import { norm } from './text';

export interface CatTheme {
  /** رنگ اصلی دسته برای نوار کنار کارت و آواتار */
  bar: string;
  tile: string;
  chip: string;
  dot: string;
}

const RULES: [RegExp, CatTheme][] = [
  [
    /بیمارستان/,
    { bar: 'bg-rose-500', tile: 'from-rose-50 to-rose-100 text-rose-600', chip: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500' },
  ],
  [
    /داروخانه/,
    { bar: 'bg-emerald-500', tile: 'from-emerald-50 to-emerald-100 text-emerald-600', chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  ],
  [
    /ازمایشگاه|آزمایشگاه|پاتوبیولوژی/,
    { bar: 'bg-violet-500', tile: 'from-violet-50 to-violet-100 text-violet-600', chip: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
  ],
  [
    /رادیولوژی|سونوگرافی|تصویربرداری|ام ار ای|mri|سی تی|ماموگرافی/,
    { bar: 'bg-cyan-500', tile: 'from-cyan-50 to-cyan-100 text-cyan-600', chip: 'bg-cyan-50 text-cyan-700', dot: 'bg-cyan-500' },
  ],
  [
    /دندان|ارتودنسی/,
    { bar: 'bg-sky-500', tile: 'from-sky-50 to-sky-100 text-sky-600', chip: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  ],
  [
    /عینک|اپتیک|اپتومتری|بینایی|چشم/,
    { bar: 'bg-indigo-500', tile: 'from-indigo-50 to-indigo-100 text-indigo-600', chip: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
  ],
  [
    /فیزیوتراپی|توانبخشی|کاردرمانی/,
    { bar: 'bg-teal-500', tile: 'from-teal-50 to-teal-100 text-teal-600', chip: 'bg-teal-50 text-teal-700', dot: 'bg-teal-500' },
  ],
  [
    /دیالیز/,
    { bar: 'bg-blue-500', tile: 'from-blue-50 to-blue-100 text-blue-600', chip: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  ],
  [
    /شنوایی|سمعک|گفتار/,
    { bar: 'bg-amber-500', tile: 'from-amber-50 to-amber-100 text-amber-600', chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  ],
  [
    /روان|مشاوره/,
    { bar: 'bg-fuchsia-500', tile: 'from-fuchsia-50 to-fuchsia-100 text-fuchsia-600', chip: 'bg-fuchsia-50 text-fuchsia-700', dot: 'bg-fuchsia-500' },
  ],
  [
    /زنان|زایمان|ماما/,
    { bar: 'bg-pink-500', tile: 'from-pink-50 to-pink-100 text-pink-600', chip: 'bg-pink-50 text-pink-700', dot: 'bg-pink-500' },
  ],
  [
    /قلب/,
    { bar: 'bg-red-500', tile: 'from-red-50 to-red-100 text-red-600', chip: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  ],
];

const FALLBACK: CatTheme = {
  bar: 'bg-gold-400',
  tile: 'from-gold-50 to-gold-100 text-gold-600',
  chip: 'bg-gold-50 text-gold-700',
  dot: 'bg-gold-400',
};

const memo = new Map<string, CatTheme>();

export function catTheme(...parts: string[]): CatTheme {
  const raw = parts.join(' ');
  const cached = memo.get(raw);
  if (cached) return cached;
  const n = norm(raw);
  for (const [re, t] of RULES) {
    if (re.test(n)) {
      memo.set(raw, t);
      return t;
    }
  }
  memo.set(raw, FALLBACK);
  return FALLBACK;
}
