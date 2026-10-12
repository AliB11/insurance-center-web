import { searchIndex, type Center, type SheetReport } from './parser';
import type { StoredData } from './storage';
import { DATA_SCOPE, canonicalCity, detectScopeCity, type DataScope } from './scope';
import { fmtNum, norm, parsePhones, phonesFromText, toFa } from './text';

/**
 * نسخهٔ قالب دادهٔ ذخیره‌شده.
 *  ۱ (بدون فیلد): استان از ابتدای آدرس حدس زده می‌شد ← «بزرگراه کردستان» = استان کردستان.
 *  ۲: همهٔ مراکز در استان دامنه (تهران)، شهر پیش‌فرض، تلفن ثابت با پیش‌شمارهٔ ۰۲۱.
 */
export const DATA_SCHEMA = 2;

export interface MigrationSummary {
  /** تعداد مراکزی که دست‌کم یک فیلدشان اصلاح شد */
  centers: number;
  provinces: number;
  cities: number;
  phones: number;
}

export interface MigrationResult {
  data: StoredData;
  /** باید دوباره ذخیره شود (حتی اگر فقط نسخه بالا رفته باشد) */
  changed: boolean;
  summary: MigrationSummary;
}

interface CenterFix { center: Center; province: boolean; city: boolean; phones: boolean }

function migrateCenter(c: Center, scope: DataScope): CenterFix {
  const province = scope.province;
  const city = c.city ? canonicalCity(c.city, scope) : detectScopeCity(c.address, scope) || scope.defaultCity;
  // همان قواعد ورود فایل: شمارهٔ ۸ رقمی + ۰۲۱، حذف «داخلی/الی»، و شمارهٔ برچسب‌دار داخل آدرس
  const reparsed = c.phones.length
    ? parsePhones(c.phones.map((p) => p.label).join(' / '), scope.areaCode)
    : phonesFromText(c.address, scope.areaCode);
  const phonesChanged = reparsed.length > 0 &&
    (reparsed.length !== c.phones.length || reparsed.some((p, i) => p.tel !== c.phones[i].tel));
  const fix = { province: c.province !== province, city: c.city !== city, phones: phonesChanged };
  if (!fix.province && !fix.city && !fix.phones) return { center: c, ...fix };

  const phones = phonesChanged ? reparsed : c.phones;
  const updated: Center = { ...c, province, city, phones, locN: norm(`${province} ${city}`) };
  // رشتهٔ جستجو = فیلدها + متن سطر عنوانِ بخش (ذخیره نشده). اگر قالب قدیمی شناخته شود، همان
  // متن عنوان بازیابی و رشته دقیق بازسازی می‌شود؛ وگرنه نشانه‌های تازه فقط افزوده می‌شوند.
  const oldKnown = searchIndex(c);
  const ctx = c.search === oldKnown ? '' : c.search.startsWith(`${oldKnown} `) ? c.search.slice(oldKnown.length + 1) : null;
  updated.search = ctx !== null
    ? searchIndex(updated, ctx)
    : norm([c.search, province, city, phones.map((p) => p.tel).join(' ')].join(' '));
  return { center: updated, ...fix };
}

/**
 * دادهٔ ذخیره‌شده در IndexedDB توسط نسخه‌های قبلی را با قواعد فعلی هم‌خوان می‌کند.
 * بدون این مرحله، کاربری که قبلاً فایل را بارگذاری کرده بود همچنان مراکز تهران را در
 * «کردستان»، «قزوین»، «فارس»، … می‌دید، چون دادهٔ ذخیره‌شده بر فایل همراه برنامه مقدم است.
 * ایدمپوتنت است: اجرای دوباره هیچ تغییری نمی‌دهد.
 */
export function migrateStored(data: StoredData, scope: DataScope | null = DATA_SCOPE): MigrationResult {
  const summary: MigrationSummary = { centers: 0, provinces: 0, cities: 0, phones: 0 };
  if ((data.meta.schema ?? 1) >= DATA_SCHEMA) return { data, changed: false, summary };

  const perSheet = new Map<string, MigrationSummary>();
  const centers = !scope ? data.centers : data.centers.map((c) => {
    const fix = migrateCenter(c, scope);
    if (fix.center === c) return c;
    const s = perSheet.get(c.sheet) ?? { centers: 0, provinces: 0, cities: 0, phones: 0 };
    for (const target of [s, summary]) {
      target.centers++;
      if (fix.province) target.provinces++;
      if (fix.city) target.cities++;
      if (fix.phones) target.phones++;
    }
    perSheet.set(c.sheet, s);
    return fix.center;
  });

  const report: SheetReport[] = data.report.map((r) => {
    const s = perSheet.get(r.sheet);
    if (!s || !scope) return r;
    const parts: string[] = [];
    if (s.provinces) parts.push(`استان ${fmtNum(s.provinces)} مرکز به «${scope.province}» اصلاح شد (نسخهٔ قبلی استان را از نام خیابان/بزرگراه حدس می‌زد)`);
    if (s.cities) parts.push(`شهر ${fmtNum(s.cities)} مرکز تکمیل یا یکسان‌سازی شد`);
    if (s.phones) parts.push(`تلفن ${fmtNum(s.phones)} مرکز با پیش‌شمارهٔ ${toFa(scope.areaCode)} قابل‌شماره‌گیری شد`);
    return { ...r, notes: [`به‌روزرسانی خودکار دادهٔ ذخیره‌شده: ${parts.join('؛ ')}.`, ...r.notes] };
  });

  return {
    data: { centers, report, meta: { ...data.meta, schema: DATA_SCHEMA } },
    changed: true,
    summary,
  };
}

/** متن کوتاه برای اعلان پس از مهاجرت */
export function migrationMessage(s: MigrationSummary, scope: DataScope | null = DATA_SCOPE): string {
  if (!s.centers) return '';
  const parts: string[] = [];
  if (s.provinces) parts.push(`استان ${fmtNum(s.provinces)} مرکز به «${scope?.province ?? ''}» اصلاح شد`);
  if (s.cities) parts.push(`شهر ${fmtNum(s.cities)} مرکز تکمیل شد`);
  if (s.phones) parts.push(`${fmtNum(s.phones)} تلفن قابل‌شماره‌گیری شد`);
  return `دادهٔ ذخیره‌شده به‌روز شد: ${parts.join('، ')}`;
}
