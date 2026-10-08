import type { Center, SheetReport } from './parser';
import { validCoordinates } from './routing';

export interface Meta {
  fileName: string;
  source: 'local' | 'upload' | 'remote' | 'demo';
  loadedAt: number;
  size: number;
}
export interface StoredData { centers: Center[]; report: SheetReport[]; meta: Meta }

const DB_NAME = 'sepah-insurance-centers';
const STORE = 'kv';
const KEY = 'dataset';
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof v[k] === 'string');

/** IndexedDB can contain old or manually edited data: validate before rendering it. */
export function validStoredData(v: unknown): v is StoredData {
  if (!isObject(v) || !isObject(v.meta) || !Array.isArray(v.centers) || !Array.isArray(v.report)) return false;
  const m = v.meta;
  if (!strings(m, ['fileName', 'source']) || !['local', 'upload', 'remote', 'demo'].includes(String(m.source)) ||
      !Number.isFinite(m.loadedAt) || !Number.isFinite(m.size)) return false;
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

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    let finished = false;
    const timer = setTimeout(() => { finished = true; reject(new Error('Storage timeout')); }, 3000);
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
      const timer = setTimeout(() => { tx.abort(); }, 5000);
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
export async function loadStored(): Promise<StoredData | null> {
  try { const data = await transact('readonly', (store) => store.get(KEY)); return validStoredData(data) ? data : null; }
  catch { return null; }
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
