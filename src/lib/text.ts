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

export function parsePhones(raw: string): Phone[] {
  if (!raw) return [];
  const t = toLatinDigits(raw);
  const parts = t
    .split(/[\/،,;؛\n\r]+|\s+و\s+|\s+-\s+|\s{2,}|\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Phone[] = [];
  for (const p of parts) {
    let digits = p.replace(/\D/g, '');
    if (digits.length < 5 || digits.length > 15) continue;
    if (p.trim().startsWith('+')) digits = '+' + digits;
    else if (digits.startsWith('0098')) digits = '+98' + digits.slice(4);
    if (digits.length === 10 && digits[0] !== '0') digits = '0' + digits;
    if (!out.some((phone) => phone.tel === digits)) out.push({ label: p, tel: digits });
  }
  return out;
}

export function phonesFromText(text: string): Phone[] {
  const t = toLatinDigits(text);
  const m = t.match(/0\d{2,3}[\s-]?\d{7,8}/g) || [];
  return m.map((x) => ({ label: x.trim(), tel: x.replace(/\D/g, '') }));
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
