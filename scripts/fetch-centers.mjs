#!/usr/bin/env node
/**
 * دریافت هفتگی فایل مراکز طرف قرارداد از منبع اصلی (sphbank.ir/hr).
 *
 * صفحهٔ منبع اسکن می‌شود (نام فایل تاریخ‌دار است و با هر به‌روزرسانی تغییر
 * می‌کند)، اولین فایل اکسل معتبر دانلود و با نسخهٔ موجود در public/data/
 * مقایسه می‌شود. فقط وقتی محتوا عوض شده باشد، فایل و manifest کنار آن
 * نوشته می‌شود تا گردش‌کار کامیت/پوش کند؛ در غیر این صورت بدون تغییر خارج
 * می‌شود. این اسکریپت سمت سرور (CI) اجرا می‌شود و محدودیت CORS مرورگر ندارد.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const PAGE_URL = 'https://sphbank.ir/hr';
const OUT_DIR = 'public/data';
const MAX_BYTES = 20 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const die = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

/** ۱) صفحهٔ منبع */
const page = await fetch(PAGE_URL, { headers: { 'user-agent': UA }, redirect: 'follow' }).catch((e) => die(`page fetch failed: ${e.message}`));
if (!page.ok) die(`page returned HTTP ${page.status}`);
const html = await page.text();

/** ۲) لینک‌های اکسل/CSV (همان ابتکار src/lib/loader.ts) */
const links = [...html.matchAll(/href\s*=\s*["']([^"']+\.(?:xls[xm]?|csv)(?:[?#][^"']*)?)["']/gi)]
  .slice(0, 5)
  .map(([, link]) => {
    try { return new URL(link.replace(/&amp;/g, '&'), page.url); } catch { return null; }
  })
  .filter(Boolean);
if (!links.length) die('no spreadsheet link found on the page');

/** ۳) اولین فایلی که واقعاً xlsx/xls باشد (امضای ZIP/OLE)، با سقف حجم */
let bytes = null;
let sourceUrl = null;
let lastModified = null;
for (const url of links) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' }).catch(() => null);
  if (!res || !res.ok) continue;
  if (Number(res.headers.get('content-length')) > MAX_BYTES) continue;
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_BYTES || data.byteLength < 200) continue;
  const zip = data[0] === 0x50 && data[1] === 0x4b && data[2] === 3 && data[3] === 4;
  const ole = data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0;
  if (!zip && !ole) continue;
  bytes = data;
  sourceUrl = url;
  lastModified = res.headers.get('last-modified');
  break;
}
if (!bytes) die('no downloadable workbook found among the page links');

/** ۴) مقایسه با نسخهٔ فعلی */
const sha256 = createHash('sha256').update(bytes).digest('hex');
const existing = await readFile(`${OUT_DIR}/centers.xlsx`).catch(() => null);
const existingSha = existing ? createHash('sha256').update(existing).digest('hex') : '';
if (existingSha === sha256) {
  console.log(`UNCHANGED sha256=${sha256}`);
  process.exit(0);
}

/** ۵) نوشتن فایل و manifest */
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/centers.xlsx`, bytes);
const manifest = {
  updatedAt: new Date().toISOString(),
  publishedAt: lastModified ? new Date(lastModified).toISOString() : null,
  sha256,
  source: sourceUrl.href,
  fileName: decodeURIComponent(sourceUrl.pathname.split('/').pop() || 'centers.xlsx'),
};
await writeFile(`${OUT_DIR}/centers.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`UPDATED sha256=${sha256}`);
console.log(`fileName=${manifest.fileName}`);
console.log(`publishedAt=${manifest.publishedAt ?? 'unknown'}`);
