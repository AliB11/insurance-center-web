import * as XLSX from 'xlsx';
import { clean, norm, parsePhones, phonesFromText, toLatinDigits, type Phone } from './text';
import { canonicalProvince, detectProvince } from './geo';

export interface Center {
  id: number;
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

type Field =
  | 'rowno' | 'province' | 'city' | 'fax' | 'discount' | 'service' | 'kind'
  | 'phone' | 'address' | 'desc' | 'name' | 'extra';

export const FIELD_LABEL: Record<string, string> = {
  rowno: 'ردیف (نادیده)', province: 'استان', city: 'شهر', fax: 'فکس', discount: 'تخفیف/قرارداد',
  service: 'تخصص/خدمات', kind: 'نوع مرکز', phone: 'تلفن', address: 'آدرس', desc: 'توضیحات',
  name: 'نام مرکز', extra: 'اطلاعات تکمیلی',
};

const RULES: [Field, RegExp][] = [
  ['rowno', /ردیف|^(row|no\.?|#|ش\.?ر|شر)$/],
  ['province', /استان/],
  ['city', /شهر/],
  ['fax', /فکس|fax/],
  ['discount', /تخفیف|درصد|تعرفه|قرارداد|تعهد|فرانشیز|سقف/],
  ['service', /تخصص|خدمات|رشته|بخش|سرویس|specialty|خدمت/],
  ['kind', /نوع|دسته|گروه|رده|type|category|کاربری/],
  ['phone', /تلفن|تماس|موبایل|همراه|phone|tel|^شماره( ها)?$/],
  ['address', /ادرس|نشانی|address|موقعیت|محل/],
  ['desc', /توضیح|ملاحظات|شرایط|یادداشت|وضعیت|نکته|توصیه/],
  [
    'name',
    /^(نام|عنوان|name|title)|(^|\s)نام$|^(مرکز|مراکز|مطب|پزشک|دکتر|موسسه|بیمارستان|داروخانه|ازمایشگاه|کلینیک|درمانگاه|واحد|مرکز درمانی|مراکز درمانی|مرکز خدمات درمانی)$/,
  ],
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
    if (a.r > maxR) maxR = a.r;
    if (a.c > maxC) maxC = a.c;
  }
  if (maxR < 0) return false;
  const merges = (ws['!merges'] || []) as XLSX.Range[];
  for (const m of merges) {
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
    const hasData = rows.slice(start).some((r) => r[i]);
    if (!h && !hasData) f = 'rowno';
    fields.push(f);
    labels.push(h || `ستون ${XLSX.utils.encode_col(i)}`);
  });
  return { fields, labels };
}

function guessPlan(rows: string[][]): { plan: ColPlan; start: number } {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const sample = rows.filter((r) => r.filter(Boolean).length >= 2).slice(0, 40);
  const start = Math.max(0, rows.findIndex((r) => r.some(Boolean)));
  const fields: Field[] = new Array(width).fill('extra');
  const labels: string[] = [];
  const stats: { phone: number; num: number; prov: number; avg: number; has: boolean }[] = [];
  for (let c = 0; c < width; c++) {
    const vals = sample.map((r) => r[c]).filter(Boolean);
    const n = Math.max(vals.length, 1);
    const phone = vals.filter((v) => {
      const d = toLatinDigits(v).replace(/\D/g, '').length;
      return d >= 7 && v.replace(/[\d۰-۹\s\-/،,+]/g, '').length < 4;
    }).length / n;
    const num = vals.filter((v) => /^[\d۰-۹]{1,4}$/.test(v)).length / n;
    const prov = vals.filter((v) => v.length < 25 && detectProvince(v)).length / n;
    const avg = vals.reduce((a, v) => a + v.length, 0) / n;
    stats.push({ phone, num, prov, avg, has: vals.length > 0 });
    labels.push(`ستون ${XLSX.utils.encode_col(c)}`);
  }
  let addrCol = -1;
  let best = 25;
  stats.forEach((s, c) => {
    if (!s.has) fields[c] = 'rowno';
    else if (s.num > 0.8) fields[c] = 'rowno';
    else if (s.phone > 0.5) fields[c] = 'phone';
    else if (s.prov > 0.6) fields[c] = 'province';
    else if (s.avg > best) {
      best = s.avg;
      addrCol = c;
    }
  });
  if (addrCol >= 0) fields[addrCol] = 'address';
  const nameCol = fields.findIndex((f, c) => f === 'extra' && stats[c].has);
  if (nameCol >= 0) fields[nameCol] = 'name';
  return { plan: { fields, labels }, start };
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
      const headerish = ne.every((v) => mapHeader(v) !== 'extra' || v.length <= 15);
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
  const sheetProvince = detectProvince(sheetName);
  const sheetIsProvince = !!sheetProvince && norm(sheetProvince) === sheetN.replace(/^استان /, '');
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
  let repeated = 0;
  const seen = new Set<string>();
  let dups = 0;
  let noName = 0;

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
      if (looksHeader) {
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
      const provDetected = text.length < 30 ? detectProvince(text) : '';
      const treatAsSection =
        st.count >= 2 || // merged horizontally
        pm || cm || provDetected ||
        nextIsHeader ||
        (isSectionText(text) && median > 1.5);
      if (treatAsSection) {
        if (pm) ctxProv = canonicalProvince(pm[1]);
        else if (cm) ctxCity = clean(cm[1]);
        else if (provDetected && norm(provDetected) === n.replace(/^استان /, '')) ctxProv = provDetected;
        else ctxSection = text;
        if (!(provDetected || pm || cm)) {
          // a new section label resets ctx city (sub-grouping)
        }
        sectionRows++;
        if (rep.skipped.length < 40) rep.skipped.push({ row: excelRow, reason: 'سطر عنوان/گروه‌بندی', text });
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
    let phoneRaw = get('phone');
    let phones = parsePhones(phoneRaw);
    if (!phones.length && address) phones = phonesFromText(address);

    if (/^جمع( کل)?\b/.test(norm(name))) {
      if (rep.skipped.length < 40) rep.skipped.push({ row: excelRow, reason: 'سطر جمع', text: name });
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
      lastProv = province;
    } else if (ctxProv) province = ctxProv;
    else if (lastProv && nameIdx >= 0) {
      province = lastProv;
      fillDown++;
    }
    if (city) lastCity = city;
    else if (ctxCity) city = ctxCity;
    else if (lastCity && idxOf('city').length) {
      city = lastCity;
      fillDown++;
    }
    if (!province) province = detectProvince(ctxSection) || detectProvince(address.slice(0, 35));
    if (!province && sheetProvince) province = sheetProvince;

    const kind = get('kind');
    const service = get('service');
    let category: string;
    if (generic || sheetIsProvince) {
      category = kind || inferKind(name, ctxSection, service) || sheetKind || (ctxSection && ctxSection.length < 30 ? ctxSection : '') || 'سایر';
    } else category = clean(sheetName);
    if (category === norm(category) && category.length === 0) category = 'سایر';

    const discount = get('discount');
    const desc = get('desc');

    const dupKey = norm([name, address, phones.map((p) => p.tel).join(',')].join('|'));
    if (seen.has(dupKey)) dups++;
    else seen.add(dupKey);

    const extraVals = Object.values(extra).join(' ');
    const searchStr = norm(
      [name, category, kind, service, province, city, address, phones.map((p) => p.tel).join(' '), discount, desc, extraVals, ctxSection].join(' '),
    );
    centers.push({
      id: startId + centers.length,
      name, category, sheet: sheetName, province, city, address, phones,
      kind, service, discount, desc, extra,
      search: searchStr,
      nameN: norm(name),
      locN: norm(`${province} ${city}`),
      catN: norm(`${category} ${kind} ${service}`),
    });
  }

  rep.imported = centers.length;
  rep.category = generic || sheetIsProvince ? 'بر اساس نوع مرکز' : clean(sheetName);
  if (sectionRows) rep.notes.push(`${sectionRows} سطر عنوان/گروه‌بندی شناسایی و به‌عنوان زمینه (استان/دسته) استفاده شد.`);
  if (repeated) rep.notes.push(`${repeated} هدر تکراری در میانه‌ی شیت شناسایی شد.`);
  if (fillDown) rep.notes.push(`${fillDown} خانه‌ی خالی استان/شهر از ردیف‌های بالاتر تکمیل شد.`);
  if (noName) rep.notes.push(`${noName} ردیف بدون «نام» بود و از ستون‌های دیگر نام‌گذاری شد.`);
  if (dups) rep.notes.push(`${dups} ردیف تکراری (نام+آدرس+تلفن یکسان) وجود دارد (حذف نشد).`);
  if (sheetIsProvince) rep.notes.push(`نام شیت به‌عنوان استان «${sheetProvince}» شناخته شد.`);
  if (centers.length === 0) rep.notes.push('هیچ مرکزی از این شیت استخراج نشد.');
  return { centers, rep };
}

export function parseWorkbook(buf: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellText: true });
  const all: Center[] = [];
  const report: SheetReport[] = [];
  wb.SheetNames.forEach((name, i) => {
    const ws = wb.Sheets[name];
    const hidden = !!(wb.Workbook?.Sheets?.[i]?.Hidden);
    try {
      const { centers, rep } = parseSheet(name, ws, all.length, hidden);
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
