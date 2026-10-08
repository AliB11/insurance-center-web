const LOCAL_CANDIDATES = ['data/centers.xlsx', 'centers.xlsx', 'data.xlsx', 'hr.xlsx', 'data/data.xlsx', 'data/centers.xls', 'centers.xls'];
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

async function fetchSpreadsheet(url: string, timeout: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const bytes = await request(url, timeout, MAX_BYTES, signal);
  if (!bytes || bytes.length < 200) return null;
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  return zip || ole ? bytes.buffer as ArrayBuffer : null;
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
export async function tryRemote(pageUrl = SOURCE_PAGE, onStatus?: (s: string) => void): Promise<Loaded | null> {
  const url = remoteUrl(pageUrl);
  onStatus?.('دریافت مستقیم از آدرس…');
  if (/\.xls[xm]?$/i.test(url.pathname)) {
    const buf = await fetchSpreadsheet(url.href, 15000);
    return buf ? { buf, name: fileName(url), source: 'remote' } : null;
  }
  const bytes = await request(url.href, 10000, 2 * 1024 * 1024);
  if (!bytes) return null;
  const html = new TextDecoder().decode(bytes);
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+\.xls[xm]?(?:[?#][^"']*)?)["']/gi)].slice(0, 5);
  for (const [, link] of links) {
    let target: URL;
    try { target = remoteUrl(new URL(link.replace(/&amp;/g, '&'), url).href); } catch { continue; }
    onStatus?.('در حال دریافت فایل اکسل…');
    const buf = await fetchSpreadsheet(target.href, 10000);
    if (buf) return { buf, name: fileName(target), source: 'remote' };
  }
  return null;
}
