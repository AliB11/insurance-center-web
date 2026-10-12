const AR_MAP: Record<string, string> = {
  'ي': 'ی', 'ك': 'ک', 'ۀ': 'ه', 'ة': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ی',
};

export function toLatinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function toFa(n: number | string): string {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
}

export function fmtNum(n: number): string {
  return toFa(n.toLocaleString('en-US'));
}

/** Character-by-character normalisation (keeps indexes mappable). */
export function normChars(s: string): string {
  let t = toLatinDigits(String(s ?? ''));
  t = t.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  t = t.replace(/[يكۀةأإآؤئ]/g, (c) => AR_MAP[c] || c);
  t = t.replace(/[\u200c\u200f\u200e\u00a0_]/g, ' ');
  return t.toLowerCase();
}

export function norm(s: string): string {
  return normChars(s).replace(/\s+/g, ' ').trim();
}

/** Display cleaning: unify Arabic letters, collapse whitespace. */
export function clean(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200f\u200e]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]*[\r\n]+[ \t]*/g, ' ، ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Phone {
  label: string;
  tel: string;
}

/** شمارهٔ داخلی انتهای متن («۵۵۰۰۱۱۲۲ داخلی ۱۲»)؛ جزو شمارهٔ قابل‌شماره‌گیری نیست. */
const EXTENSION_RE = /\s*(?:داخلی|داخلي|داخل|ext\.?|extension|x)\s*[:.]?\s*\d{1,6}\s*$/i;

/** شماره‌ای که خودش کامل است: ثابت ۸ رقمی بدون کد، یا ۱۱ رقمی با صفر ابتدایی. */
const isCompleteNumber = (d: string) => (d.length === 8 && /^[2-9]/.test(d)) || (d.length === 11 && d.startsWith('0'));

function finishNumber(digits: string, plus: boolean, areaCode: string): string | null {
  let d = digits;
  if (plus) d = `+${d}`;
  else if (d.startsWith('0098')) d = `+98${d.slice(4)}`;
  else if (d.length === 10 && d[0] !== '0') d = `0${d}`; // ۲۱۸۸۷۷۶۶۵۵ / ۹۱۲۱۲۳۴۵۶۷
  else if (areaCode && d.length === 8 && /^[2-9]/.test(d)) d = `${areaCode}${d}`; // ۸۸۷۷۶۶۵۵ → ۰۲۱۸۸۷۷۶۶۵۵
  const len = d.replace('+', '').length;
  return len >= 5 && len <= 15 ? d : null;
}

/**
 * یک بخش از متن تلفن → شماره‌های قابل‌شماره‌گیری.
 *   «021-66927008-10»     → 02166927008     (پسوند بازه، جزو شماره نیست)
 *   «55001122 داخلی 12»   → 02155001122     (داخلی حذف می‌شود)
 *   «66927008 66927009»   → دو شماره        (نسخهٔ قبلی ۱۶ رقم را یکی می‌کرد و دور می‌انداخت)
 *   «0912 123 4567»       → 09121234567
 */
function numbersInPart(part: string, areaCode: string): Phone[] {
  const text = part.replace(EXTENSION_RE, '');
  const groups = Array.from(text.matchAll(/\d+/g), (m) => ({ d: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  if (!groups.length) return [];
  const plus = text.trim().startsWith('+');
  if (plus || groups[0].d.startsWith('0098')) {
    const tel = finishNumber(groups.map((g) => g.d).join(''), plus, areaCode);
    return tel ? [{ label: part, tel }] : [];
  }
  const found: { digits: string; start: number; end: number }[] = [];
  let cur: { digits: string; start: number; end: number } | null = null;
  for (const g of groups) {
    if (cur && isCompleteNumber(cur.digits)) {
      if (g.d.length <= 4) {
        cur.end = g.end; // پسوند بازه: «-10» یعنی تا ...10
        continue;
      }
      found.push(cur);
      cur = null;
    }
    if (!cur) cur = { digits: g.d, start: g.start, end: g.end };
    else {
      cur.digits += g.d;
      cur.end = g.end;
    }
  }
  if (cur) found.push(cur);
  const out: Phone[] = [];
  for (const f of found) {
    const tel = finishNumber(f.digits, false, areaCode);
    if (tel) out.push({ label: found.length === 1 ? part : text.slice(f.start, f.end).trim(), tel });
  }
  return out;
}

/**
 * @param areaCode پیش‌شمارهٔ دامنه (مثلاً «021»)؛ به شماره‌های ثابت ۸ رقمی افزوده می‌شود تا
 *                 دکمهٔ «تماس» از تلفن همراه هم کار کند. برچسب نمایشی همان متن فایل می‌ماند.
 */
export function parsePhones(raw: string, areaCode = ''): Phone[] {
  if (!raw) return [];
  const t = toLatinDigits(raw);
  const parts = t
    .split(/[\/،,;؛\n\r]+|\s+و\s+|\s+-\s+|\s{2,}|\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Phone[] = [];
  for (const p of parts) {
    for (const phone of numbersInPart(p, areaCode)) {
      if (!out.some((x) => x.tel === phone.tel)) out.push(phone);
    }
  }
  return out;
}

/**
 * شماره‌های داخل متن آزاد (مثلاً آدرس). فقط شماره‌های کامل (با ۰ آغازین) یا — وقتی پیش‌شماره
 * معلوم است — شمارهٔ ۸ رقمیِ دارای برچسب صریح («تلفن: ۸۸۷۷۶۶۵۵»)؛ عدد بی‌برچسب ممکن است
 * پلاک یا کد پستی باشد.
 */
export function phonesFromText(text: string, areaCode = ''): Phone[] {
  const t = toLatinDigits(text);
  const out: Phone[] = [];
  const add = (label: string, tel: string) => { if (!out.some((p) => p.tel === tel)) out.push({ label: label.trim(), tel }); };
  for (const x of t.match(/0\d{2,3}[\s-]?\d{7,8}/g) || []) add(x, x.replace(/\D/g, ''));
  if (areaCode) {
    for (const m of t.matchAll(/(?:تلفن|تلفکس|تلفاکس|شماره تماس|تماس|tel)\s*[:：.]?\s*([2-9]\d{7})(?!\d)/gi)) add(m[1], `${areaCode}${m[1]}`);
  }
  return out;
}

export function highlightRanges(text: string, tokens: string[]): [number, number][] {
  if (!tokens.length) return [];
  let nt = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = normChars(text[i]);
    for (const ch of c) {
      nt += ch;
      map.push(i);
    }
  }
  const ranges: [number, number][] = [];
  for (const tok of tokens) {
    if (!tok) continue;
    let idx = nt.indexOf(tok);
    while (idx !== -1) {
      ranges.push([map[idx], map[idx + tok.length - 1] + 1]);
      idx = nt.indexOf(tok, idx + tok.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}
