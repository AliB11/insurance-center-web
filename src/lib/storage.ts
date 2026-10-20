import { searchIndex, type Center, type SheetReport } from './parser';
import { validCoordinates } from './routing';
import { norm } from './text';

export interface Meta {
  fileName: string;
  source: 'local' | 'upload' | 'remote' | 'demo';
  loadedAt: number;
  size: number;
  /** نسخهٔ قالب داده؛ دادهٔ بدون آن (نسخه‌های قبل) هنگام بارگذاری مهاجرت داده می‌شود (migrate.ts) */
  schema?: number;
}
export interface StoredData { centers: Center[]; report: SheetReport[]; meta: Meta }

const DB_NAME = 'sepah-insurance-centers';
const STORE = 'kv';
const KEY = 'dataset';

/**
 * مهلت‌های ثابت قبلی (۳ و ۵ ثانیه) روی دستگاه کند یا IndexedDB مشغول، «داده‌ای نیست»
 * را از «خواندن ناموفق» جدا نمی‌کرد و برنامه بی‌صدا به دادهٔ نمونه می‌رفت.
 */
export const STORAGE_TIMEOUTS = { open: 8000, transaction: 12000 };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof v[k] === 'string');

const CENTER_TEXT_FIELDS = ['name', 'category', 'sheet', 'province', 'city', 'address', 'kind', 'service', 'discount', 'desc'] as const;

/** IndexedDB can contain old or manually edited data: validate before rendering it. */
export function validStoredData(v: unknown): v is StoredData {
  if (!isObject(v) || !isObject(v.meta) || !Array.isArray(v.centers) || !Array.isArray(v.report)) return false;
  const m = v.meta;
  if (!strings(m, ['fileName', 'source']) || !['local', 'upload', 'remote', 'demo'].includes(String(m.source)) ||
      !Number.isFinite(m.loadedAt) || !Number.isFinite(m.size) ||
      (m.schema !== undefined && !Number.isInteger(m.schema))) return false;
  const ids = new Set<number>();
  for (const c of v.centers) {
    if (!isObject(c) || typeof c.id !== 'number' || !Number.isSafeInteger(c.id) || ids.has(c.id) ||
        !strings(c, ['name', 'category', 'sheet', 'province', 'city', 'address', 'kind', 'service', 'discount', 'desc', 'search', 'nameN', 'locN', 'catN']) ||
        !isObject(c.extra) || !Object.values(c.extra).every((x) => typeof x === 'string') ||
        !Array.isArray(c.phones) || !c.phones.every((p) => isObject(p) && strings(p, ['label', 'tel']) && /^\+?\d+$/.test(String(p.tel))) ||
        (c.coordinates !== undefined && !validCoordinates(c.coordinates))) return false;
    ids.add(c.id);
  }
  return v.report.every((r) => isObject(r) && strings(r, ['sheet', 'category']) &&
    Number.isFinite(r.rows) && Number.isFinite(r.imported) && (r.headerRow === null || Number.isInteger(r.headerRow)) &&
    Array.isArray(r.notes) && r.notes.every((n) => typeof n === 'string') &&
    Array.isArray(r.mapping) && r.mapping.every((m) => isObject(m) && strings(m, ['header', 'field'])) &&
    Array.isArray(r.skipped) && r.skipped.every((s) => isObject(s) && Number.isInteger(s.row) && strings(s, ['reason', 'text'])));
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * داده‌ای که «کامل» نیست ولی قابل بازیابی است را بازسازی می‌کند: فیلدهای متنی جاافتاده
 * خالی می‌شوند و رشتهٔ جستجو/فیلدهای نرمال‌شده از نو ساخته می‌شوند. بنابراین افزودن یک
 * فیلد تازه به `Center` در آینده، دادهٔ ذخیره‌شدهٔ کاربر را دور نمی‌اندازد.
 */
export function normalizeStoredData(v: unknown): StoredData | null {
  if (!isObject(v) || !Array.isArray(v.centers)) return null;
  const rawMeta = isObject(v.meta) ? v.meta : {};
  const centers: Center[] = [];
  const ids = new Set<number>();
  for (const raw of v.centers) {
    if (!isObject(raw) || ids.has(raw.id as number)) continue;
    const text = {} as Record<(typeof CENTER_TEXT_FIELDS)[number], string>;
    for (const field of CENTER_TEXT_FIELDS) text[field] = str(raw[field]);
    const name = text.name.trim();
    if (!name) continue;
    const id = typeof raw.id === 'number' && Number.isSafeInteger(raw.id) ? raw.id : centers.length;
    if (ids.has(id)) continue;
    ids.add(id);
    const extra: Record<string, string> = {};
    if (isObject(raw.extra)) {
      for (const [k, value] of Object.entries(raw.extra)) if (typeof value === 'string') extra[k] = value;
    }
    const phones = Array.isArray(raw.phones)
      ? raw.phones
        .filter((p): p is Record<string, unknown> => isObject(p) && /^\+?\d+$/.test(str(p.tel)))
        .map((p) => ({ label: str(p.label, str(p.tel)), tel: str(p.tel) }))
      : [];
    const coordinates = validCoordinates(raw.coordinates) ? raw.coordinates : undefined;
    const category = text.category || 'سایر';
    const previousSearch = str(raw.search);
    const fields = {
      name,
      category,
      kind: text.kind,
      service: text.service,
      province: text.province,
      city: text.city,
      address: text.address,
      phones,
      discount: text.discount,
      desc: text.desc,
      extra,
    };
    centers.push({
      id,
      coordinates,
      ...fields,
      sheet: text.sheet || 'دادهٔ ذخیره‌شده',
      // رشتهٔ جستجوی قدیمی ممکن است شامل متن سطر عنوان باشد؛ نگه داشته و تکمیل می‌شود
      search: previousSearch || searchIndex(fields),
      nameN: norm(name),
      locN: norm(`${fields.province} ${fields.city}`),
      catN: norm(`${category} ${fields.kind} ${fields.service}`),
    });
  }
  if (!centers.length) return null;
  const report: SheetReport[] = (Array.isArray(v.report) ? v.report : [])
    .filter(isObject)
    .map((r) => ({
      sheet: str(r.sheet, 'دادهٔ ذخیره‌شده'),
      category: str(r.category, str(r.sheet, 'دادهٔ ذخیره‌شده')),
      rows: Number.isFinite(r.rows) ? Number(r.rows) : centers.length,
      imported: Number.isFinite(r.imported) ? Number(r.imported) : centers.length,
      headerRow: r.headerRow === null || Number.isInteger(r.headerRow) ? (r.headerRow as number | null) : null,
      mapping: (Array.isArray(r.mapping) ? r.mapping : [])
        .filter(isObject)
        .map((m) => ({ header: str(m.header), field: str(m.field) })),
      notes: strList(r.notes),
      skipped: (Array.isArray(r.skipped) ? r.skipped : [])
        .filter(isObject)
        .filter((s) => Number.isInteger(s.row))
        .map((s) => ({ row: Number(s.row), reason: str(s.reason), text: str(s.text) })),
    }));
  const source = ['local', 'upload', 'remote', 'demo'].includes(String(rawMeta.source)) ? (rawMeta.source as Meta['source']) : 'upload';
  const meta: Meta = {
    fileName: str(rawMeta.fileName, 'دادهٔ ذخیره‌شده'),
    source,
    loadedAt: Number.isFinite(rawMeta.loadedAt) ? Number(rawMeta.loadedAt) : Date.now(),
    size: Number.isFinite(rawMeta.size) ? Number(rawMeta.size) : 0,
    schema: Number.isInteger(rawMeta.schema) ? Number(rawMeta.schema) : undefined,
  };
  return { centers, report, meta };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    let finished = false;
    const timer = setTimeout(() => { finished = true; reject(new Error('Storage timeout')); }, STORAGE_TIMEOUTS.open);
    const fail = () => { finished = true; clearTimeout(timer); reject(req.error || new Error('Storage unavailable')); };
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => {
      clearTimeout(timer);
      if (finished) { req.result.close(); return; }
      finished = true;
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = fail;
    req.onblocked = () => { finished = true; clearTimeout(timer); reject(new Error('Storage blocked')); };
  });
}

async function transact(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const timer = setTimeout(() => { tx.abort(); }, STORAGE_TIMEOUTS.transaction);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => { clearTimeout(timer); resolve(request.result); };
      tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(tx.error || new Error('Storage transaction aborted')); };
    });
  } finally { db.close(); }
}

export async function saveData(data: StoredData): Promise<boolean> {
  try { await transact('readwrite', (store) => store.put(data, KEY)); return true; }
  catch { return false; }
}

/** وضعیت خواندن دادهٔ ذخیره‌شده؛ «خالی» و «خواندن ناموفق» دیگر یکی نیستند. */
export type StoredState =
  | { state: 'empty' }
  | { state: 'ok'; data: StoredData; repaired: boolean }
  | { state: 'invalid'; raw: unknown }
  | { state: 'error'; message: string };

export async function loadStoredState(): Promise<StoredState> {
  let raw: unknown;
  try {
    raw = await transact('readonly', (store) => store.get(KEY));
  } catch (error) {
    return { state: 'error', message: (error as Error)?.message || 'Storage unavailable' };
  }
  if (raw === undefined || raw === null) return { state: 'empty' };
  if (validStoredData(raw)) return { state: 'ok', data: raw, repaired: false };
  const repaired = normalizeStoredData(raw);
  if (repaired) return { state: 'ok', data: repaired, repaired: true };
  return { state: 'invalid', raw };
}

/** سازگاری با فراخوان‌های قبلی: تنها دادهٔ سالم/بازسازی‌شده را برمی‌گرداند. */
export async function loadStored(): Promise<StoredData | null> {
  const result = await loadStoredState();
  return result.state === 'ok' ? result.data : null;
}

export async function clearStored(): Promise<boolean> {
  try { await transact('readwrite', (store) => store.delete(KEY)); return true; }
  catch { return false; }
}

export function loadList(key: string, fallback: string[]): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : fallback;
  } catch { return fallback; }
}
export function saveList(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional preferences. */ }
}

/* ------------------------------------------------------------------ *
 *  علاقه‌مندی‌ها
 *  کلید قبلی سراسری بود و با «حذف داده» پاک نمی‌شد؛ علاقه‌مندی‌های یک فایل روی
 *  فایل بعدی می‌نشست. اکنون هر مجموعه (منبع+نام فایل) سهم خودش را دارد.
 * ------------------------------------------------------------------ */
const FAV_KEY = 'sepah-favs-v2';
const LEGACY_FAV_KEY = 'sepah-favs';

export type FavMap = Record<string, string[]>;

const isFavMap = (v: unknown): v is FavMap =>
  isObject(v) && Object.values(v).every((list) => Array.isArray(list) && list.every((x) => typeof x === 'string'));

export function loadFavs(): { map: FavMap; legacy: string[] } {
  const legacy = loadList(LEGACY_FAV_KEY, []);
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAV_KEY) || 'null');
    return { map: isFavMap(value) ? value : {}, legacy };
  } catch { return { map: {}, legacy }; }
}

export function saveFavs(map: FavMap) {
  saveList(FAV_KEY, map);
}

/** کلید قدیمی پس از انتقال به کلید نسخه‌دار پاک می‌شود. */
export function clearLegacyFavs() {
  try { localStorage.removeItem(LEGACY_FAV_KEY); } catch { /* Optional preferences. */ }
}
