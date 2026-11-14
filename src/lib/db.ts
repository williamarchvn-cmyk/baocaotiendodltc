import { AppData } from '../types';

const DB_NAME = 'HSH_PremiumDesk_DB';
const STORE_NAME = 'AppDataStore';
const DB_KEY = 'hsh_dltc_cache_v2'; // bộ nhớ đệm hiển thị nhanh; dữ liệu thật nằm trên Supabase

export function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (e: any) => {
      const dbInstance = e.target.result;
      if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
        dbInstance.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (e: any) => {
      resolve(e.target.result);
    };

    request.onerror = (e: any) => {
      reject(e.target.error);
    };
  });
}

export function loadData(db: IDBDatabase): Promise<AppData | null> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(DB_KEY);

      request.onsuccess = (e: any) => {
        resolve(e.target.result || null);
      };

      request.onerror = (e: any) => {
        reject(e.target.error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

export function saveData(db: IDBDatabase, data: AppData): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data, DB_KEY);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (e: any) => {
        reject(e.target.error);
      };
    } catch (err) {
      reject(err);
    }
  });
}
