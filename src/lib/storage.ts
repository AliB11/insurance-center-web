import type { Center, SheetReport } from './parser';

export interface Meta {
  fileName: string;
  source: 'local' | 'upload' | 'remote' | 'demo';
  loadedAt: number;
  size: number;
}

export interface StoredData {
  centers: Center[];
  report: SheetReport[];
  meta: Meta;
}

const DB_NAME = 'sepah-insurance-centers';
const STORE = 'kv';
const KEY = 'dataset';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveData(d: StoredData): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(d, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* storage unavailable – ignore */
  }
}

export async function loadStored(): Promise<StoredData | null> {
  try {
    const db = await open();
    return await new Promise<StoredData | null>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as StoredData) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearStored(): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

export function loadList<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    const parsed: unknown = JSON.parse(v);
    // مقادیر دست‌کاری‌شده یا قدیمی نباید برنامه را بشکنند
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    if (parsed === null || typeof parsed !== typeof fallback) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function saveList(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
