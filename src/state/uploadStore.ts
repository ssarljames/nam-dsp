/**
 * User-uploaded NAM models and cab IRs, kept in IndexedDB so they survive a
 * refresh and stay in their panel's dropdown. The raw file bytes are stored, not
 * anything derived from them, so a later change to how IRs are prepared applies
 * to files saved earlier.
 *
 * Every call opens and closes its own connection. That costs a little per call
 * and buys a module with no shared state — nothing to hold open, nothing that
 * can block a database upgrade or a test resetting the database.
 *
 * Every function rejects when storage is unavailable or fails. Callers treat
 * that as "this session only": the upload itself still works, it just is not
 * remembered.
 */

export type UploadKind = 'nam' | 'ir';

const UPLOAD_PREFIX = 'upload:';

/**
 * How a saved upload is named where a preset URL would otherwise go — a
 * dropdown value, or a stored selection. The prefix is what tells the two apart.
 */
export const uploadId = (name: string): string => `${UPLOAD_PREFIX}${name}`;
export const isUploadId = (id: string): boolean => id.startsWith(UPLOAD_PREFIX);
export const uploadName = (id: string): string => id.slice(UPLOAD_PREFIX.length);

const DB_NAME = 'nam-pwa';
const STORE = 'uploads';
const VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: ['kind', 'name'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('could not open IndexedDB'));
  });
}

/** Resolves when the transaction has committed, not merely when the request succeeded. */
async function inStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

/** Saved names of one kind, alphabetical. */
export async function listUploads(kind: UploadKind): Promise<string[]> {
  const keys = await inStore('readonly', (store) =>
    store.getAllKeys(IDBKeyRange.bound([kind, ''], [kind, '￿'])),
  );
  return keys.map((key) => (key as [UploadKind, string])[1]).sort((a, b) => a.localeCompare(b));
}

/** Saving a name that already exists replaces it. The bytes are copied in. */
export async function saveUpload(kind: UploadKind, name: string, bytes: ArrayBuffer): Promise<void> {
  await inStore('readwrite', (store) => store.put({ kind, name, bytes }));
}

export async function readUpload(kind: UploadKind, name: string): Promise<ArrayBuffer | null> {
  const record = await inStore<{ bytes: ArrayBuffer } | undefined>('readonly', (store) => store.get([kind, name]));
  return record?.bytes ?? null;
}

/** Deleting something that is not there is not an error. */
export async function deleteUpload(kind: UploadKind, name: string): Promise<void> {
  await inStore('readwrite', (store) => store.delete([kind, name]));
}
