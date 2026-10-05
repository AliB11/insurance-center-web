const LOCAL_CANDIDATES = [
  'data/centers.xlsx', 'centers.xlsx', 'data.xlsx', 'hr.xlsx', 'data/data.xlsx',
  'data/centers.xls', 'centers.xls',
];

const SOURCE_PAGE = 'https://sphbank.ir/hr';

const PROXIES: ((u: string) => string)[] = [
  (u) => u,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

function isSpreadsheet(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf.slice(0, 4));
  return (b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0xd0 && b[1] === 0xcf);
}

async function fetchBuf(url: string, ms = 15000): Promise<ArrayBuffer | null> {
  const t = withTimeout(ms);
  try {
    const res = await fetch(url, { signal: t.signal, cache: 'no-cache' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return isSpreadsheet(buf) && buf.byteLength > 200 ? buf : null;
  } catch {
    return null;
  } finally {
    t.done();
  }
}

async function fetchText(url: string, ms = 10000): Promise<string | null> {
  const t = withTimeout(ms);
  try {
    const res = await fetch(url, { signal: t.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    t.done();
  }
}

export interface Loaded {
  buf: ArrayBuffer;
  name: string;
  source: 'local' | 'remote';
}

/** A spreadsheet that ships next to the app (public/data/centers.xlsx …). */
export async function tryLocal(): Promise<Loaded | null> {
  for (const c of LOCAL_CANDIDATES) {
    const buf = await fetchBuf(`./${c}`, 8000);
    if (buf) return { buf, name: c.split('/').pop() || c, source: 'local' };
  }
  return null;
}

/** Download from a direct spreadsheet URL or from a web page that links to one. */
export async function tryRemote(
  pageUrl: string = SOURCE_PAGE,
  onStatus?: (s: string) => void,
): Promise<Loaded | null> {
  for (const [pi, wrap] of PROXIES.entries()) {
    onStatus?.(pi === 0 ? 'دریافت مستقیم از آدرس...' : `تلاش از طریق واسط شماره ${pi}...`);
    // direct spreadsheet?
    if (/\.xlsx?($|\?)/i.test(pageUrl)) {
      const buf = await fetchBuf(wrap(pageUrl));
      if (buf) return { buf, name: decodeURIComponent(pageUrl.split('/').pop() || 'remote.xlsx'), source: 'remote' };
      continue;
    }
    const html = await fetchText(wrap(pageUrl));
    if (!html) continue;
    const links = Array.from(html.matchAll(/href=["']([^"']+\.xlsx?(?:\?[^"']*)?)["']/gi)).map((m) => m[1]);
    for (const l of links) {
      let abs: string;
      try {
        abs = new URL(l, pageUrl).toString();
      } catch {
        continue;
      }
      onStatus?.('در حال دریافت فایل اکسل...');
      const buf = await fetchBuf(wrap(abs), 30000);
      if (buf) return { buf, name: decodeURIComponent(abs.split('/').pop()?.split('?')[0] || 'remote.xlsx'), source: 'remote' };
    }
  }
  return null;
}
