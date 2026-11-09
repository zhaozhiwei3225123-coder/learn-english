/**
 * 极简 IndexedDB key-value 封装。
 *
 * 学习状态（词库 + 学习记录）用 IndexedDB 存，容量远比 localStorage（约 5MB）大，
 * 单词量涨到几万条也不容易写入失败。
 */
const DB_NAME = 'vocab-app';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('IndexedDB 打开失败'));
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB 被其他页面占用'));
    };
  });
  return dbPromise;
}

export async function idbGet(key: string): Promise<unknown | null> {
  const db = await openDb();
  return new Promise<unknown | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 读取失败'));
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入被中止'));
  });
}
