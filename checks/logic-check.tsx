/**
 * بررسی رندر سمت سرور: واقعاً App را با دادهٔ نمونه رندر می‌کند تا
 * مطمئن شویم درخت JSX، فیلترها و کارت‌ها بدون خطای زمان اجرا ساخته
 * می‌شوند. (افکت‌ها در SSR اجرا نمی‌شوند، پس مرورگر لازم نیست.)
 */
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import App from '../src/App';
import { demoCenters } from '../src/lib/demo';
import { applyFilters, EMPTY_FILTERS, tokensOf, countBy } from '../src/lib/search';
import { parseWorkbook } from '../src/lib/parser';
import * as XLSX from 'xlsx';

// --- حداقل محیط مرورگر برای state initializer ها ---
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).indexedDB = undefined;

const html = renderToString(createElement(App));

const must = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
};

console.log('--- رندر App ---');
console.log('طول HTML تولیدشده:', html.length);
must('عنوان برنامه در هدر هست', html.includes('مراکز طرف قرارداد بیمه بانک سپه'));
must('کادر جستجو رندر شده', html.includes('role="search"'));
must('حالت اولیه = در حال بارگذاری', html.includes('animate-spin'));

console.log('\n--- دادهٔ نمونه ---');
const list = demoCenters();
must('تعداد مراکز نمونه > 100: ' + list.length, list.length > 100);
must('همه id یکتا هستند', new Set(list.map((c) => c.id)).size === list.length);
must('همه مراکز تلفن دارند', list.every((c) => c.phones.length > 0));
must('همه مراکز استان و شهر دارند', list.every((c) => !!c.province && !!c.city));

console.log('\n--- جستجو و فیلتر ---');
const q = 'بیمارستان رشت';
const toks = tokensOf(q);
const res = applyFilters(list, { ...EMPTY_FILTERS, q }, new Set());
must(`جستجوی «${q}» نتیجه داد: ${res.length}`, res.length > 0);
must('همهٔ نتایج شامل توکن‌ها هستند', res.every((c) => toks.every((t) => c.search.includes(t))));

const prov = applyFilters(list, { ...EMPTY_FILTERS, province: 'فارس' }, new Set());
must('فیلتر استان فارس: ' + prov.length, prov.length > 0 && prov.every((c) => c.province === 'فارس'));

const cat = applyFilters(list, { ...EMPTY_FILTERS, category: 'داروخانه' }, new Set());
must('فیلتر دستهٔ داروخانه: ' + cat.length, cat.length > 0 && cat.every((c) => c.category === 'داروخانه'));

const facets = countBy(list, (c) => c.province);
must('فست استان‌ها ساخته شد: ' + facets.length, facets.length >= 25);

console.log('\n--- پارسر اکسل (مسیر بارگذاری فایل) ---');

const ws = XLSX.utils.aoa_to_sheet([
  ['ردیف', 'نام مرکز', 'استان', 'شهر', 'آدرس', 'تلفن'],
  [1, 'بیمارستان آزمایشی الف', 'تهران', 'تهران', 'خیابان آزادی پلاک ۱', '021-12345678'],
  [2, 'داروخانه آزمایشی ب', 'فارس', 'شیراز', 'خیابان زند', '071-87654321 / 071-87654322'],
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'مراکز');
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
const parsed = parseWorkbook(buf);
must('پارسر ۲ مرکز استخراج کرد: ' + parsed.centers.length, parsed.centers.length === 2);
must('استان نرمال‌سازی شد', parsed.centers[0].province === 'تهران');
must('تلفن دوم پارس شد: ' + JSON.stringify(parsed.centers[1].phones.map((p) => p.tel)), parsed.centers[1].phones.length === 2);
