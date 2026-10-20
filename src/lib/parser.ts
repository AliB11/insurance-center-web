import * as XLSX from 'xlsx';
import { coordinateSanity, parseCoordinates, type Coordinates } from './routing';
import { clean, fmtNum, norm, parsePhones, phonesFromText, toFa, toLatinDigits, type Phone } from './text';
import { canonicalProvince, exactProvince, explicitProvince } from './geo';
import { DATA_SCOPE, canonicalCity, detectScopeCity, isScopeCity, type DataScope } from './scope';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SHEET_CELLS = 1_000_000;
/** سقف مجموع خانه‌های همهٔ شیت‌ها؛ سقف تک‌شیت جلوی فایل چندشیتی/فشردهٔ حجیم را نمی‌گرفت */
const MAX_TOTAL_CELLS = 2_000_000;
const MAX_SHEETS = 60;
/** سقف ردیف‌های گزارش؛ بیشتر از این فقط شمرده می‌شود تا گزارش بی‌صدا کوتاه نشود */
const REPORT_ROW_LIMIT = 40;
const REPORT_NOTE_LIMIT = 50;

export interface Center {
  id: number;
  coordinates?: Coordinates;
  name: string;
  category: string;
  sheet: string;
  province: string;
  city: string;
  address: string;
  phones: Phone[];
  kind: string;
  service: string;
  discount: string;
  desc: string;
  extra: Record<string, string>;
  search: string;
  nameN: string;
  locN: string;
  catN: string;
}

export interface SheetReport {
  sheet: string;
  category: string;
  rows: number;
  imported: number;
  headerRow: number | null;
  mapping: { header: string; field: string }[];
  notes: string[];
  skipped: { row: number; reason: string; text: string }[];
}

export interface ParseResult {
  centers: Center[];
  report: SheetReport[];
}

export interface ParseOptions {
  /**
   * دامنهٔ جغرافیایی داده؛ پیش‌فرض DATA_SCOPE (استان تهران).
   * null یعنی فهرست سراسری: استان فقط از ستون/عنوان/نام شیت صریح خوانده می‌شود.
   */
  scope?: DataScope | null;
}

/**
 * رشتهٔ جستجوی یک مرکز. قالب ثابت است تا بتوان دادهٔ ذخیره‌شدهٔ نسخه‌های قبل را
 * بدون فایل اصلی بازسازی کرد (ctx = متن سطر عنوانِ بخش در فایل).
 */
export function searchIndex(
  c: Pick<Center, 'name' | 'category' | 'kind' | 'service' | 'province' | 'city' | 'address' | 'phones' | 'discount' | 'desc' | 'extra'>,
  ctx = '',
): string {
  return norm(
    [c.name, c.category, c.kind, c.service, c.province, c.city, c.address, c.phones.map((p) => p.tel).join(' '), c.discount, c.desc, Object.values(c.extra).join(' '), ctx].join(' '),
  );
}

type Field =
  | 'rowno' | 'province' | 'city' | 'fax' | 'discount' | 'service' | 'kind'
  | 'phone' | 'address' | 'desc' | 'name' | 'extra' | 'latitude' | 'longitude' | 'category';

export const FIELD_LABEL: Record<string, string> = {
  rowno: 'ردیف (نادیده)', province: 'استان', city: 'شهر', fax: 'فکس', discount: 'تخفیف/قرارداد',
  service: 'تخصص/خدمات', kind: 'نوع مرکز', phone: 'تلفن', address: 'آدرس', desc: 'توضیحات',
  name: 'نام مرکز', extra: 'اطلاعات تکمیلی', latitude: 'عرض جغرافیایی', longitude: 'طول جغرافیایی', category: 'دسته',
};

const RULES: [Field, RegExp][] = [
  ['latitude', /^(latitude|lat|عرض جغرافیایی)$/],
  ['longitude', /^(longitude|lng|lon|طول جغرافیایی)$/],
  ['rowno', /^(ردیف|شماره ردیف|row|no\.?|#|ش\.?ر|شر)$/],
  ['province', /^(نام )?استان$/],
  ['city', /^(نام )?(شهر|شهرستان)$/],
  ['fax', /^(شماره )?(فکس|fax)$/],
  ['discount', /^(تخفیف|درصد تخفیف|تعرفه|قرارداد|شرایط قرارداد|تخفیف\/قرارداد|تخفیف \/ شرایط قرارداد|تعهد|فرانشیز|سقف تعهدات)$/],
  ['service', /^(تخصص|خدمات|رشته|بخش|سرویس|specialty|خدمت|تخصص\/خدمات|تخصص \/ خدمات)$/],
  ['category', /^(دسته( بندی)?|category)$/],
  ['kind', /^(نوع( مرکز)?|گروه|رده|type|کاربری)$/],
  ['phone', /^(?:(شماره( های?)? )?(تلفن( تماس| همراه| مرکز| ثابت| \/ همراه|\d+| \d+)?|تماس|موبایل|همراه|phone|tel)|شماره( ها)?)$/],
  ['address', /^(ادرس|نشانی|address|موقعیت|محل)( مرکز| مطب| موسسه)?$/],
  ['desc', /^(توضیحات?|ملاحظات|شرایط|یادداشت|وضعیت|نکته|توصیه)$/],
  ['name', /^(نام( و نام خانوادگی| مرکز( درمانی)?| مراکز| پزشک| موسسه| بیمارستان| داروخانه| ازمایشگاه)?|عنوان( مرکز)?|name|title|مرکز|مراکز|مطب|پزشک|دکتر|موسسه|بیمارستان|داروخانه|ازمایشگاه|کلینیک|درمانگاه|واحد|مرکز درمانی|مراکز درمانی|مرکز خدمات درمانی|مراکز خدمات درمانی)$/],
];

const MULTI: Field[] = ['phone', 'address', 'discount', 'service', 'desc', 'kind'];

function mapHeader(h: string): Field {
  const n = norm(h);
  if (!n || n.length > 45 || /^\d+$/.test(n)) return 'extra';
  if (/(^|\s)کد(\s|$)/.test(n)) return 'extra';
  for (const [f, re] of RULES) if (re.test(n)) return f;
  return 'extra';
}

function fieldSet(row: string[]): Set<Field> {
  const s = new Set<Field>();
  for (const c of row) {
    if (!c) continue;
    const f = mapHeader(c);
    if (f !== 'extra' && f !== 'rowno') s.add(f);
  }
  return s;
}

const KIND_INFER: [RegExp, string][] = [
  [/بیمارستان/, 'بیمارستان'],
  [/داروخانه/, 'داروخانه'],
  [/ازمایشگاه|ازمایشگاه|پاتوبیولوژی|پاتو بیولوژی/, 'آزمایشگاه'],
  [/رادیولوژی|سونوگرافی|تصویربرداری|ام ار ای|mri|سی تی|ct scan|ماموگرافی|bmd|سنجش تراکم/, 'تصویربرداری'],
  [/دندان|ارتودنسی/, 'دندانپزشکی'],
  [/فیزیوتراپی|توانبخشی|کاردرمانی/, 'فیزیوتراپی و توانبخشی'],
  [/عینک|اپتیک|اپتومتری|بینایی/, 'عینک و اپتیک'],
  [/دیالیز/, 'دیالیز'],
  [/گفتار|شنوایی|سمعک/, 'شنوایی و گفتار'],
  [/روانشناسی|مشاوره|روان/, 'روان‌شناسی و مشاوره'],
  [/کلینیک|درمانگاه|مطب|پلی کلینیک|مرکز جراحی|مرکز درمانی/, 'کلینیک و درمانگاه'],
];

function inferKind(...texts: string[]): string {
  const n = norm(texts.join(' '));
  for (const [re, label] of KIND_INFER) if (re.test(n)) return label;
  return '';
}

const GENERIC_SHEET = /^(sheet ?\d*|برگه ?\d*|لیست.*|فهرست.*|همه.*|کل.*|مراکز|مراکز درمانی|مراکز طرف قرارداد.*|data|list|centers?)$/;

function rowStats(row: string[]) {
  const vals = row.filter(Boolean);
  return { count: vals.length, distinct: new Set(vals.map(norm)).size };
}

/** Repair a worksheet: real dimension, vertical merges expanded. */
function fixSheet(ws: XLSX.WorkSheet): boolean {
  let maxR = -1;
  let maxC = -1;
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const a = XLSX.utils.decode_cell(k);
    if ((a.r + 1) * (a.c + 1) > MAX_SHEET_CELLS) throw new Error('ابعاد شیت بیش از حد مجاز است');
    if (a.r > maxR) maxR = a.r;
    if (a.c > maxC) maxC = a.c;
  }
  if (maxR < 0) return false;
  const merges = (ws['!merges'] || []) as XLSX.Range[];
  for (const m of merges) {
    if ((m.e.r + 1) * (m.e.c + 1) > MAX_SHEET_CELLS) throw new Error('ابعاد ادغام بیش از حد مجاز است');
    const tl = ws[XLSX.utils.encode_cell(m.s)];
    if (!tl) continue;
    if (m.e.r > m.s.r) {
      const size = (m.e.r - m.s.r + 1) * (m.e.c - m.s.c + 1);
      if (size > 4000) continue;
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          const addr = XLSX.utils.encode_cell({ r, c });
          if (!ws[addr]) ws[addr] = { ...tl };
        }
      }
    }
    if (m.e.r > maxR) maxR = m.e.r;
    if (m.e.c > maxC) maxC = m.e.c;
  }
  if ((maxR + 1) * (maxC + 1) > MAX_SHEET_CELLS) throw new Error('شیت بیش از یک میلیون خانه دارد');
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return true;
}

interface ColPlan {
  fields: Field[];
  labels: string[];
}

function buildPlan(headers: string[], rows: string[][], start: number): ColPlan {
  const fields: Field[] = [];
  const used = new Set<Field>();
  const labels: string[] = [];
  headers.forEach((h, i) => {
    let f = mapHeader(h);
    if (f === 'fax') f = 'extra';
    if (f !== 'extra' && f !== 'rowno' && !MULTI.includes(f) && used.has(f)) f = 'extra';
    if (f !== 'extra' && f !== 'rowno') used.add(f);
    const hasData = !!h || rows.slice(start).some((r) => r[i]);
    if (!h && !hasData) f = 'rowno';
    fields.push(f);
    labels.push(h || `ستون ${XLSX.utils.encode_col(i)}`);
  });
  return { fields, labels };
}

/** واژه‌هایی که نشان می‌دهند یک سلول متن، آدرس است (نه نام مرکز یا توضیح). */
const ADDRESS_HINT = /(خیابان|بلوار|کوچه|بزرگراه|اتوبان|آزادراه|میدان|جاده|کوی|بن بست|پلاک|طبقه|واحد|جنب|روبرو|نرسیده|نبش|شهرک|فاز|منطقه|فلکه|چهارراه|سه راه|پاساژ|مجتمع|ساختمان|برج|خیابان)/;

function guessPlan(rows: string[][]): { plan: ColPlan; start: number } {
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const sample = rows.filter((r) => r.filter(Boolean).length >= 2).slice(0, 40);
  const start = Math.max(0, rows.findIndex((r) => r.some(Boolean)));
  const fields: Field[] = new Array(width).fill('extra');
  const labels: string[] = [];
  const stats: { phone: number; num: number; prov: number; avg: number; addr: number; text: number; has: boolean }[] = [];
  for (let c = 0; c < width; c++) {
    const vals = sample.map((r) => r[c]).filter(Boolean);
    const n = Math.max(vals.length, 1);
    const phone = vals.filter((v) => {
      const d = toLatinDigits(v).replace(/\D/g, '').length;
      return d >= 7 && v.replace(/[\d۰-۹\s\-/،,+]/g, '').length < 4;
    }).length / n;
    const num = vals.filter((v) => /^[\d۰-۹]{1,4}$/.test(v)).length / n;
    // فقط مقدارهای «دقیقاً نام استان»؛ ستونی پر از «بزرگراه کردستان»/«خیابان قزوین» ستون استان نیست
    const prov = vals.filter((v) => v.length < 25 && exactProvince(v)).length / n;
    const avg = vals.reduce((a, v) => a + v.length, 0) / n;
    // آدرس را از «نشانه‌های معبر» بشناس، نه فقط از طول متن: «خیابان آزادی، پلاک ۲» کوتاه است
    const addr = vals.filter((v) => ADDRESS_HINT.test(v)).length / n;
    const text = vals.filter((v) => v.length >= 3 && v.length <= 60 && !/^[\d۰-۹\s\-/.,]+$/.test(v)).length / n;
    stats.push({ phone, num, prov, avg, addr, text, has: vals.length > 0 });
    labels.push(`ستون ${XLSX.utils.encode_col(c)}`);
  }
  stats.forEach((s, c) => {
    if (!s.has) fields[c] = 'rowno';
    else if (s.num > 0.8) fields[c] = 'rowno';
    else if (s.phone > 0.5) fields[c] = 'phone';
    else if (s.prov > 0.6) fields[c] = 'province';
  });
  // آدرس: ستونی که بیشتر مقدارهایش نشانهٔ معبر دارند. اگر هیچ ستونی نشانه نداشت،
  // به همان معیار قدیمی (بلندترین متن) برمی‌گردیم تا فایل‌های بدون نشانه هم از دست نروند.
  let addrCol = -1;
  let addrScore = 0.5;
  stats.forEach((s, c) => {
    if (fields[c] !== 'extra' || !s.has) return;
    const score = s.addr * 2 + Math.min(s.avg, 80) / 160;
    if (s.addr >= 0.5 && score > addrScore) {
      addrScore = score;
      addrCol = c;
    }
  });
  if (addrCol < 0) {
    let longest = 25;
    stats.forEach((s, c) => {
      if (fields[c] === 'extra' && s.has && s.avg > longest) {
        longest = s.avg;
        addrCol = c;
      }
    });
  }
  if (addrCol >= 0) fields[addrCol] = 'address';
  // نام: ستون متنی که آدرس/تلفن/ردیف نیست؛ ترجیح با متنی است که عدد ندارد و طول معقول دارد
  let nameCol = -1;
  let nameScore = -1;
  stats.forEach((s, c) => {
    if (fields[c] !== 'extra' || !s.has) return;
    const score = s.text * 2 + (s.avg >= 3 && s.avg <= 60 ? 1 : 0) - (s.addr >= 0.5 ? 1 : 0);
    if (score > nameScore) {
      nameScore = score;
      nameCol = c;
    }
  });
  if (nameCol >= 0) fields[nameCol] = 'name';
  return { plan: { fields, labels }, start };
}

/**
 * عناوین گروه‌بندیِ تک‌سلولی در فایل‌های فارسی («بیمارستان‌ها»، «آزمایشگاه ها»،
 * «مراکز تصویربرداری»، «لیست داروخانه‌ها»). این سطرها مرکز نیستند: نسخهٔ قبلی
 * آن‌ها را با دستهٔ استنباط‌شده به داده اضافه می‌کرد و شمارش/خروجی/جستجو را
 * آلوده می‌ساخت. نام واقعی مرکز معمولاً «داروخانه البرز» است، نه «داروخانه‌ها»
 * (همان موردی که آزمون رگرسیون جداگانه قفل کرده است).
 */
const CATEGORY_WORDS = new Set([
  'بیمارستان', 'داروخانه', 'ازمایشگاه', 'آزمایشگاه', 'کلینیک', 'درمانگاه', 'مطب', 'پلی کلینیک',
  'تصویربرداری', 'رادیولوژی', 'سونوگرافی', 'دندانپزشکی', 'فیزیوتراپی', 'توانبخشی', 'دیالیز',
  'اپتیک', 'عینک', 'بینایی سنجی', 'مشاوره', 'روان شناسی', 'زنان', 'زایمان', 'مامایی',
  'شنوایی', 'گفتار درمانی', 'سمعک', 'جراحی', 'قلب', 'پوست', 'مو', 'چشم پزشکی', 'ارتوپدی',
  'داخلی', 'اطفال', 'مغز', 'اعصاب', 'تخصصی', 'پزشکان', 'مراکز',
].map(norm));

function isGroupHeading(text: string): boolean {
  const n = norm(text);
  if (!n || n.length > 40 || /\d/.test(n)) return false;
  if (CATEGORY_WORDS.has(n)) return true;
  // جمع فارسی فقط روی واژهٔ دسته پذیرفته می‌شود: «بیمارستان‌ها» ✓، «داروخانه رها» ✗
  const singular = n.replace(/(?:های|ها|هاي)$/, '').trim();
  if (singular !== n && (CATEGORY_WORDS.has(singular) || CATEGORY_WORDS.has(n.replace(/ی$/, '')))) return true;
  if (singular !== n && isSectionText(singular)) return true;
  return /^(?:لیست|فهرست|جدول|بخش|گروه)\b/.test(n);
}

function isSectionText(t: string): boolean {
  const n = norm(t);
  return /^(استان|شهر|شهرستان|بخش|گروه|لیست|فهرست|جمع|توضیحات|نکته|تبصره|توجه|مراکز)/.test(n) ||
    /مراکز طرف قرارداد|لیست مراکز|فهرست مراکز/.test(n);
}

function parseSheet(
  sheetName: string,
  ws: XLSX.WorkSheet,
  startId: number,
  hidden: boolean,
  scope: DataScope | null,
): { centers: Center[]; rep: SheetReport } {
  const rep: SheetReport = {
    sheet: sheetName, category: '', rows: 0, imported: 0, headerRow: null,
    mapping: [], notes: [], skipped: [],
  };
  const centers: Center[] = [];
  if (hidden) rep.notes.push('این شیت مخفی بود ولی بارگذاری شد.');

  if (!fixSheet(ws)) {
    rep.notes.push('شیت خالی است.');
    return { centers, rep };
  }
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true });
  const rows: string[][] = raw.map((r) => r.map((c) => clean(c)));
  rep.rows = rows.filter((r) => r.some(Boolean)).length;

  // ---- find header ----
  let h = -1;
  let hScore = 0;
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const s = fieldSet(rows[i]).size;
    if (s > hScore) {
      hScore = s;
      h = i;
    }
  }
  if (hScore < 2) {
    // accept a single strong field if row has several cells
    const i = rows.findIndex((r) => {
      const fs = fieldSet(r);
      return fs.size === 1 && r.filter(Boolean).length >= 2 && (fs.has('name') || fs.has('address'));
    });
    h = i;
    hScore = i >= 0 ? 1 : 0;
  }

  let plan: ColPlan;
  let dataStart: number;
  if (h >= 0 && hScore >= 1) {
    let headers = rows[h].slice();
    if (h > 0) {
      const prev = rows[h - 1];
      if (rowStats(prev).distinct > 1) {
        headers = headers.map((x, i) => x || (prev[i] && (prev[i].length <= 20 || mapHeader(prev[i]) !== 'extra') ? prev[i] : ''));
      }
    }
    dataStart = h + 1;
    const next = rows[h + 1];
    if (next) {
      const ne = next.filter(Boolean);
      const fsNext = fieldSet(next).size;
      const noDigits = !ne.some((v) => toLatinDigits(v).replace(/\D/g, '').length >= 5);
      const headerish = ne.every((v) => mapHeader(v) !== 'extra');
      if (ne.length > 0 && ne.length <= rows[h].filter(Boolean).length && fsNext >= 1 && noDigits && headerish) {
        headers = headers.map((x, i) => {
          const y = next[i] || '';
          if (!y) return x;
          if (!x || norm(x) === norm(y)) return y;
          return `${x} ${y}`;
        });
        dataStart = h + 2;
        rep.notes.push('هدر دو‌ردیفه شناسایی و ترکیب شد.');
      }
    }
    plan = buildPlan(headers, rows, dataStart);
    rep.headerRow = h + 1;
  } else {
    const g = guessPlan(rows);
    plan = g.plan;
    dataStart = g.start;
    rep.notes.push('هدر مشخصی پیدا نشد؛ ستون‌ها بر اساس محتوا حدس زده شدند. لطفاً نتیجه را بررسی کنید.');
  }
  rep.mapping = plan.fields
    .map((f, i) => ({ header: plan.labels[i], field: f }))
    .filter((m) => m.field !== 'rowno');

  // ---- sheet-level context ----
  const sheetN = norm(sheetName);
  // فقط نام صریح («تهران»، «استان تهران»، «مراکز استان تهران»)؛ «داروخانه‌های البرز» استان نیست
  const sheetProvince = explicitProvince(sheetName);
  const sheetIsProvince = !!exactProvince(sheetName);
  const generic = GENERIC_SHEET.test(sheetN);
  const sheetKind = inferKind(sheetName);

  const idxOf = (f: Field) => plan.fields.map((x, i) => (x === f ? i : -1)).filter((i) => i >= 0);
  const nameIdx = idxOf('name')[0] ?? -1;
  const contentIdx = plan.fields.map((f, i) => (f !== 'rowno' ? i : -1)).filter((i) => i >= 0);

  // median count of filled content cells
  const counts = rows
    .slice(dataStart)
    .map((r) => contentIdx.filter((i) => r[i]).length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;

  let ctxProv = sheetIsProvince ? sheetProvince : '';
  let ctxCity = '';
  let ctxSection = '';
  let lastProv = '';
  let lastCity = '';
  let currentFields = plan.fields;
  let currentLabels = plan.labels;
  let fillDown = 0;
  let sectionRows = 0;
  let groupHeadings = 0;
  const groupSamples = new Set<string>();
  let repeated = 0;
  const seen = new Set<string>();
  let dups = 0;
  let noName = 0;
  let skippedOverflow = 0;
  let notesOverflow = 0;
  let suspiciousCoords = 0;
  const suspiciousRows: number[] = [];
  // دامنهٔ داده (استان تهران)
  let provinceConflicts = 0;
  const conflictSamples = new Set<string>();
  let cityFromAddress = 0;
  const citySamples = new Set<string>();
  let cityDefaulted = 0;
  let unknownCities = 0;
  const unknownCitySamples = new Set<string>();
  let areaCodeAdded = 0;

  const nextNonEmpty = (from: number) => {
    for (let j = from; j < rows.length; j++) if (rows[j].some(Boolean)) return rows[j];
    return null;
  };

  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some(Boolean)) continue;
    const excelRow = r + 1;

    // repeated header
    const fs = fieldSet(row);
    if (fs.size >= 2 && fs.size >= Math.max(2, hScore - 1)) {
      const looksHeader = row.filter(Boolean).every((v) => v.length <= 45) &&
        !row.some((v) => toLatinDigits(v).replace(/\D/g, '').length >= 7);
      if (looksHeader && row.filter(Boolean).every((v) => mapHeader(v) !== 'extra')) {
        const p2 = buildPlan(row, rows, r + 1);
        currentFields = p2.fields;
        currentLabels = p2.labels;
        repeated++;
        continue;
      }
    }

    const content = row.filter((v, i) => v && currentFields[i] !== 'rowno');
    if (content.length === 0) continue;
    const st = {
      count: content.length,
      distinct: new Set(content.map(norm)).size,
    };

    // section / title rows
    if (st.distinct === 1) {
      const text = content[0];
      const n = norm(text);
      if (/^[\d\s.\-/]+$/.test(n)) continue;
      const nx = nextNonEmpty(r + 1);
      const nextIsHeader = nx ? fieldSet(nx).size >= 2 : false;
      const pm = text.match(/^استان\s*[:：]?\s*(.+)$/);
      const cm = text.match(/^(?:شهر|شهرستان)\s*[:：]?\s*(.+)$/);
      // فقط عنوان صریح («تهران»، «استان تهران»، «مراکز استان تهران»)؛ «داروخانه البرز» یک مرکز است، نه عنوان استان
      const provDetected = text.length < 40 ? explicitProvince(text) : '';
      // «بیمارستان‌ها» / «داروخانه های تخصصی»: سطر گروه‌بندی، نه مرکز. بدون این شرط،
      // هر عنوان یک مرکز جعلی با دستهٔ استنباط‌شده می‌شد (شمارش، خروجی و جستجو آلوده می‌شد).
      const groupHeading = st.count === 1 && isGroupHeading(text) && !pm && !provDetected;
      const treatAsSection =
        st.count >= 2 || // merged horizontally
        pm || cm || provDetected ||
        nextIsHeader ||
        groupHeading ||
        (isSectionText(text) && median > 1.5);
      if (treatAsSection) {
        if (pm || (provDetected && !cm)) { ctxCity = ''; lastCity = ''; lastProv = ''; }
        if (pm) ctxProv = canonicalProvince(pm[1]);
        else if (cm) ctxCity = clean(cm[1]);
        else if (provDetected) {
          ctxProv = provDetected;
          if (!exactProvince(text)) ctxSection = text; // «مراکز طرف قرارداد استان تهران» زمینهٔ دسته هم هست
        } else ctxSection = text;
        sectionRows++;
        if (groupHeading && !pm && !cm && !provDetected) {
          groupHeadings++;
          if (groupSamples.size < 6) groupSamples.add(text);
        }
        if (rep.skipped.length < REPORT_ROW_LIMIT) rep.skipped.push({ row: excelRow, reason: 'سطر عنوان/گروه‌بندی', text });
        else skippedOverflow++;
        continue;
      }
    }

    const get = (f: Field): string => {
      const parts: string[] = [];
      currentFields.forEach((x, i) => {
        if (x === f && row[i] && !parts.some((p) => norm(p) === norm(row[i]))) parts.push(row[i]);
      });
      return parts.join(f === 'phone' ? ' / ' : f === 'address' ? ' ' : ' - ');
    };

    let name = get('name');
    const extra: Record<string, string> = {};
    currentFields.forEach((f, i) => {
      if (f === 'extra' && row[i]) {
        const key = currentLabels[i];
        extra[key] = extra[key] ? `${extra[key]} - ${row[i]}` : row[i];
      }
    });
    // additional name columns -> extra
    currentFields.forEach((f, i) => {
      if (f === 'name' && row[i] && i !== currentFields.indexOf('name')) extra[currentLabels[i]] = row[i];
    });

    const address = get('address');
    const phoneRaw = get('phone');
    const areaCode = scope?.areaCode ?? '';
    let phones = parsePhones(phoneRaw, areaCode);
    if (areaCode && phones.length) {
      const plain = parsePhones(phoneRaw);
      areaCodeAdded += phones.filter((p, i) => plain[i] && plain[i].tel !== p.tel && p.tel.startsWith(areaCode)).length;
    }
    if (!phones.length && address) phones = phonesFromText(address, areaCode);

    if (/^جمع(?: کل)?(?:\s|$)/.test(norm(name))) {
      if (rep.skipped.length < REPORT_ROW_LIMIT) rep.skipped.push({ row: excelRow, reason: 'سطر جمع', text: name });
      else skippedOverflow++;
      continue;
    }

    if (!name) {
      const fallback = Object.values(extra)[0] || address;
      if (!fallback) continue;
      name = fallback.length > 60 ? fallback.slice(0, 57) + '…' : fallback;
      noName++;
    }

    let province = get('province');
    let city = get('city');
    if (province) {
      province = canonicalProvince(province);
      if (province !== lastProv) { lastCity = ''; ctxCity = ''; }
      lastProv = province;
    } else if (ctxProv) province = ctxProv;
    else if (lastProv && nameIdx >= 0) {
      province = lastProv;
      fillDown++;
    }
    let cityFilled = false;
    if (city) lastCity = city;
    else if (ctxCity) city = ctxCity;
    else if (lastCity && currentFields.includes('city')) {
      city = lastCity;
      cityFilled = true;
      fillDown++;
    }
    if (!province) province = explicitProvince(ctxSection);
    if (!province && sheetProvince) province = sheetProvince;
    // ⚠️ آدرس هرگز استان را تعیین نمی‌کند: «بزرگراه کردستان»، «خیابان قزوین»، «خلیج فارس»،
    // «شهرک گلستان»، «جادهٔ قدیم قم» همه در تهران‌اند. (باگ نسخهٔ قبل: detectProvince(address))
    if (scope) {
      if (province && norm(province) !== norm(scope.province)) {
        provinceConflicts++;
        if (conflictSamples.size < 3) conflictSamples.add(province);
      }
      province = scope.province;
      // شهر صریحِ ابتدای آدرس («شهریار، …») از حدسِ پرکردن رو به پایین معتبرتر است، نه از ستون صریح
      const detected = !city || cityFilled ? detectScopeCity(address, scope) : '';
      if (detected && (!city || canonicalCity(city, scope) !== detected)) {
        if (cityFilled) fillDown--;
        city = detected;
        cityFromAddress++;
        if (citySamples.size < 4) citySamples.add(detected);
      } else if (city) {
        city = canonicalCity(city, scope);
        if (!isScopeCity(city, scope)) {
          unknownCities++;
          if (unknownCitySamples.size < 3) unknownCitySamples.add(city);
        }
      } else {
        city = scope.defaultCity;
        cityDefaulted++;
      }
    }

    const kind = get('kind');
    const service = get('service');
    let category: string;
    if (get('category')) category = get('category');
    else if (generic || sheetIsProvince) {
      category = kind || inferKind(name, ctxSection, service) || sheetKind || (ctxSection && ctxSection.length < 30 ? ctxSection : '') || 'سایر';
    } else category = clean(sheetName);
    if (category === norm(category) && category.length === 0) category = 'سایر';

    const coordinates = parseCoordinates(get('latitude'), get('longitude'));
    if (!coordinates && (get('latitude') || get('longitude'))) {
      if (rep.notes.length < REPORT_NOTE_LIMIT) rep.notes.push(`مختصات ردیف ${excelRow} نامعتبر بود و برای مسیریابی استفاده نشد.`);
      else notesOverflow++;
    }
    if (coordinates && coordinateSanity(coordinates).state !== 'ok') {
      suspiciousCoords++;
      if (suspiciousRows.length < 3) suspiciousRows.push(excelRow);
    }
    const discount = get('discount');
    const desc = get('desc');

    const dupKey = norm([name, address, phones.map((p) => p.tel).join(',')].join('|'));
    if (seen.has(dupKey)) dups++;
    else seen.add(dupKey);

    const fields = { name, category, kind, service, province, city, address, phones, discount, desc, extra };
    centers.push({
      id: startId + centers.length,
      coordinates, ...fields, sheet: sheetName,
      search: searchIndex(fields, ctxSection),
      nameN: norm(name),
      locN: norm(`${province} ${city}`),
      catN: norm(`${category} ${kind} ${service}`),
    });
  }

  rep.imported = centers.length;
  rep.category = generic || sheetIsProvince ? 'بر اساس نوع مرکز' : clean(sheetName);
  const fa = (v: number) => fmtNum(v);
  const samples = (s: Set<string>) => [...s].map((x) => `«${x}»`).join('، ');
  if (scope && centers.length) {
    rep.notes.push(`استان همهٔ ${fa(centers.length)} مرکز «${scope.province}» ثبت شد (دامنهٔ داده). نام استان از آدرس حدس زده نمی‌شود؛ «بزرگراه کردستان» یا «خیابان قزوین» نام خیابان‌اند، نه استان.`);
    if (provinceConflicts) rep.notes.push(`در ${fa(provinceConflicts)} ردیف، ستون/عنوانِ استان مقدار دیگری داشت (${samples(conflictSamples)})؛ طبق دامنهٔ داده «${scope.province}» ثبت شد. اگر این فایل واقعاً سراسری است، DATA_SCOPE را در src/lib/scope.ts بردارید.`);
    if (cityFromAddress) rep.notes.push(`شهر ${fa(cityFromAddress)} مرکز از ابتدای آدرس تشخیص داده شد (${samples(citySamples)}).`);
    if (cityDefaulted) rep.notes.push(`${fa(cityDefaulted)} مرکز ستون شهر نداشت و آدرسشان با نام شهر دیگری از استان شروع نمی‌شد؛ شهر «${scope.defaultCity}» در نظر گرفته شد.`);
    if (unknownCities) rep.notes.push(`شهرِ ${fa(unknownCities)} مرکز در فهرست شهرهای استان ${scope.province} نیست (${samples(unknownCitySamples)})؛ اگر نام محله یا منطقه است مشکلی نیست، وگرنه ستون «شهر» فایل را بررسی کنید.`);
    if (areaCodeAdded) rep.notes.push(`پیش‌شمارهٔ ${toFa(scope.areaCode)} به ${fa(areaCodeAdded)} شمارهٔ ثابت بدون کد افزوده شد تا دکمهٔ «تماس» از تلفن همراه هم کار کند.`);
  }
  if (sectionRows) rep.notes.push(`${fa(sectionRows)} سطر عنوان/گروه‌بندی شناسایی و به‌عنوان زمینه (استان/دسته) استفاده شد.`);
  if (groupHeadings) rep.notes.push(`${fa(groupHeadings)} سطر عنوانِ دسته (مثل ${samples(groupSamples)}) به‌عنوان مرکز ثبت نشد و فقط زمینهٔ دسته است.`);
  if (repeated) rep.notes.push(`${fa(repeated)} هدر تکراری در میانه‌ی شیت شناسایی شد.`);
  if (fillDown) rep.notes.push(`${fa(fillDown)} خانه‌ی خالی استان/شهر از ردیف‌های بالاتر تکمیل شد.`);
  if (noName) rep.notes.push(`${fa(noName)} ردیف بدون «نام» بود و از ستون‌های دیگر نام‌گذاری شد.`);
  if (dups) rep.notes.push(`${fa(dups)} ردیف تکراری (نام+آدرس+تلفن یکسان) وجود دارد (حذف نشد).`);
  if (suspiciousCoords) rep.notes.push(`مختصات ${fa(suspiciousCoords)} ردیف با نقشهٔ ایران هم‌خوان نیست (بیرون ایران، صفر، یا جابه‌جایی احتمالی عرض/طول — نمونه سطر: ${suspiciousRows.join('، ')}${suspiciousCoords > suspiciousRows.length ? '، …' : ''})؛ داده نگه داشته شد و در پنجرهٔ مسیریابی هشدار داده می‌شود.`);
  if (sheetIsProvince && !scope) rep.notes.push(`نام شیت به‌عنوان استان «${sheetProvince}» شناخته شد.`);
  if (skippedOverflow) rep.notes.push(`${fa(skippedOverflow)} سطر کنارگذاشته‌شدهٔ دیگر در فهرست بالا نیامد (سقف نمایش ${fa(REPORT_ROW_LIMIT)} سطر).`);
  if (notesOverflow) rep.notes.push(`${fa(notesOverflow)} یادداشت دیگر دربارهٔ مختصات نامعتبر نمایش داده نشد (سقف نمایش ${fa(REPORT_NOTE_LIMIT)}).`);
  if (centers.length === 0) rep.notes.push('هیچ مرکزی از این شیت استخراج نشد.');
  return { centers, rep };
}

export function parseWorkbook(buf: ArrayBuffer, options: ParseOptions = {}): ParseResult {
  const scope = options.scope === undefined ? DATA_SCOPE : options.scope;
  if (!buf.byteLength || buf.byteLength > MAX_FILE_BYTES) throw new Error('فایل باید غیرخالی و حداکثر ۲۰ مگابایت باشد');
  const signature = new Uint8Array(buf, 0, Math.min(buf.byteLength, 2));
  const binary = (signature[0] === 0x50 && signature[1] === 0x4b) || (signature[0] === 0xd0 && signature[1] === 0xcf);
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellText: true, ...(binary ? {} : { codepage: 65001 }) });
  // سقف تک‌شیت جلوی فایل چندشیتی را نمی‌گرفت: پیش از sheet_to_json (که حافظه‌بر است)
  // مجموع خانه‌ها و تعداد شیت‌ها را می‌سنجیم.
  if (wb.SheetNames.length > MAX_SHEETS) throw new Error(`تعداد شیت‌ها بیش از حد مجاز است (حداکثر ${MAX_SHEETS} شیت)`);
  let totalCells = 0;
  for (const name of wb.SheetNames) {
    const ref = wb.Sheets[name]?.['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    totalCells += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
    if (totalCells > MAX_TOTAL_CELLS) throw new Error('حجم کل شیت‌های فایل بیش از حد مجاز است');
  }
  const all: Center[] = [];
  const report: SheetReport[] = [];
  wb.SheetNames.forEach((name, i) => {
    const ws = wb.Sheets[name];
    const hidden = !!(wb.Workbook?.Sheets?.[i]?.Hidden);
    try {
      const { centers, rep } = parseSheet(name, ws, all.length, hidden, scope);
      all.push(...centers);
      report.push(rep);
    } catch (e) {
      report.push({
        sheet: name, category: name, rows: 0, imported: 0, headerRow: null, mapping: [],
        notes: [`خطا در خواندن شیت: ${(e as Error).message}`], skipped: [],
      });
    }
  });
  // re-number ids
  all.forEach((c, i) => (c.id = i));
  return { centers: all, report };
}
