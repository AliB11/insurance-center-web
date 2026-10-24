const LOCAL_CANDIDATES = ['data/centers.xlsx', 'centers.xlsx', 'data.xlsx', 'hr.xlsx', 'data/data.xlsx', 'data/centers.xls', 'centers.xls', 'data/centers.csv', 'centers.csv'];
const SOURCE_PAGE = 'https://sphbank.ir/hr';
const MAX_BYTES = 20 * 1024 * 1024;

export function remoteUrl(input: string): URL {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('فقط آدرس HTTP یا HTTPS بدون اطلاعات ورود پذیرفته می‌شود.');
  }
  return url;
}

async function request(url: string, timeout: number, maxBytes = MAX_BYTES, signal?: AbortSignal): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeout);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    if (Number(response.headers.get('content-length')) > maxBytes) { controller.abort(); return null; }
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch { return null; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

/**
 * متن جدولی (CSV) قابل قبول است؟ ZIP/OLE نیست و صفحهٔ HTML/JSON هم نیست؛
 * خط اول باید جداکنندهٔ ستون داشته باشد. این تشخیص ابتکاری است و در گزارش
 * واردسازی با ساختار واقعی فایل تطبیق داده می‌شود.
 */
function looksLikeTabularText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127) || b >= 0x80) printable++;
  }
  if (printable / n < 0.99) return false;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, n));
  const trimmed = head.replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
  return /[,;\t|]/.test(firstLine);
}

async function fetchSpreadsheet(url: string, timeout: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const bytes = await request(url, timeout, MAX_BYTES, signal);
  if (!bytes) return null;
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (zip || ole) return bytes.length >= 200 ? (bytes.buffer as ArrayBuffer) : null;
  if (bytes.length >= 8 && looksLikeTabularText(bytes)) return bytes.buffer as ArrayBuffer;
  return null;
}

export interface Loaded { buf: ArrayBuffer; name: string; source: 'local' | 'remote' }

/** Bounded parallel probes avoid seven consecutive network timeouts at boot. */
export async function tryLocal(signal?: AbortSignal): Promise<Loaded | null> {
  const results = await Promise.all(LOCAL_CANDIDATES.map(async (candidate): Promise<Loaded | null> => {
    const buf = await fetchSpreadsheet(`./${candidate}`, 4000, signal);
    return buf ? { buf, name: candidate.split('/').pop()!, source: 'local' } : null;
  }));
  return results.find(Boolean) ?? null;
}

function fileName(url: URL): string {
  const name = url.pathname.split('/').pop() || 'remote.xlsx';
  try { return decodeURIComponent(name); } catch { return name; }
}

/** No public CORS relays: never send source URLs through untrusted third parties. */
export async function tryRemote(
  pageUrl = SOURCE_PAGE,
  onStatus?: (s: string) => void,
  signal?: AbortSignal,
): Promise<Loaded | null> {
  const url = remoteUrl(pageUrl);
  onStatus?.('دریافت مستقیم از آدرس…');
  if (/\.(xls[xm]?|csv)$/i.test(url.pathname)) {
    const buf = await fetchSpreadsheet(url.href, 15000, signal);
    return buf ? { buf, name: fileName(url), source: 'remote' } : null;
  }
  const bytes = await request(url.href, 10000, 2 * 1024 * 1024, signal);
  if (!bytes) return null;
  const html = new TextDecoder().decode(bytes);
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+\.(?:xls[xm]?|csv)(?:[?#][^"']*)?)["']/gi)].slice(0, 5);
  for (const [, link] of links) {
    let target: URL;
    try { target = remoteUrl(new URL(link.replace(/&amp;/g, '&'), url).href); } catch { continue; }
    onStatus?.('در حال دریافت فایل اکسل…');
    if (signal?.aborted) return null;
    const buf = await fetchSpreadsheet(target.href, 10000, signal);
    if (buf) return { buf, name: fileName(target), source: 'remote' };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  به‌روزرسانی خودکار از فایل همراه برنامه
 *  گردش‌کار هفتگی GitHub Actions فایل مراکز را از منبع اصلی (sphbank.ir/hr)
 *  می‌گیرد و همراه یک manifest کوچک در public/data/ کامیت می‌کند. برنامه در
 *  هر بوت manifest را می‌خواند و اگر از دادهٔ ذخیره‌شدهٔ کاربر تازه‌تر باشد،
 *  فایل را دریافت و بی‌سروصدا جایگزین می‌کند. (sphbank.ir هدر CORS ندارد،
 *  پس گرفتن مستقیم از مرورگر همیشه ممکن نیست؛ مسیر مطمئن همان فایل همراه است.)
 * ------------------------------------------------------------------ */

/** مسیر فایل همراه و manifest آن؛ گردش‌کار weekly این دو را می‌نویسد */
export const BUNDLED_DATA_FILE = './data/centers.xlsx';
export const BUNDLED_MANIFEST_FILE = './data/centers.json';

export interface DataManifest {
  /** زمان نوشتن manifest توسط گردش‌کار (ISO) */
  updatedAt: string;
  /** تاریخ انتشار فایل روی منبع (هدر Last-Modified؛ ISO) یا null */
  publishedAt: string | null;
  /** اثر SHA-256 محتوای فایل */
  sha256: string;
  /** آدرس اصلی فایل روی منبع */
  source: string;
  /** نام اصلی فایل روی منبع */
  fileName: string;
}

const ISO_RE_DATE = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** اعتبارسنجی سخت manifest؛ هر پاسخ مشکوک (HTML خطا، JSON ناقص) دور انداخته می‌شود */
export function parseManifest(value: unknown): DataManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  if (!ISO_RE_DATE(m.updatedAt)) return null;
  if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(m.sha256)) return null;
  if (m.publishedAt !== null && m.publishedAt !== undefined && !ISO_RE_DATE(m.publishedAt)) return null;
  return {
    updatedAt: m.updatedAt,
    publishedAt: typeof m.publishedAt === 'string' ? m.publishedAt : null,
    sha256: m.sha256.toLowerCase(),
    source: typeof m.source === 'string' ? m.source : '',
    fileName: typeof m.fileName === 'string' && m.fileName.trim() ? m.fileName : 'centers.xlsx',
  };
}

/**
 * تصمیم به‌روزرسانی: زمان انتشار manifest باید از زمان بارگذاری دادهٔ فعلی کاربر
 * تازه‌تر باشد. دادهٔ نمونه اصلاً به این تابع نمی‌رسد (در App تفکیک شده).
 */
export function isManifestNewer(manifest: DataManifest, current?: { loadedAt: number } | null): boolean {
  const published = Date.parse(manifest.publishedAt || manifest.updatedAt);
  if (!Number.isFinite(published)) return false;
  return !(current && Number.isFinite(current.loadedAt) && current.loadedAt >= published);
}

/** خواندن manifest فایل همراه؛ هر خطا/نبود = null (به‌روزرسانی خودکار اختیاری است) */
export async function fetchManifest(signal?: AbortSignal): Promise<DataManifest | null> {
  try {
    const controller = new AbortController();
    let finished = false;
    const timer = setTimeout(() => { if (!finished) controller.abort(); }, 4000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const response = await fetch(BUNDLED_MANIFEST_FILE, { signal: controller.signal, cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer' });
      finished = true;
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > 4096) return null;
      return parseManifest(JSON.parse(text));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  } catch { return null; }
}

/** دریافت فایل همراهِ به‌روز (همان مسیری که tryLocal هم می‌پژورد) */
export async function fetchBundledUpdate(signal?: AbortSignal): Promise<Loaded | null> {
  const buf = await fetchSpreadsheet(BUNDLED_DATA_FILE, 15000, signal);
  return buf ? { buf, name: 'centers.xlsx', source: 'local' } : null;
}
