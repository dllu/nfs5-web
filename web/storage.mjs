// Browser-local save overlay. A checkpoint is one atomic IndexedDB transaction;
// revisions are acknowledged only after it commits so concurrent writes survive.
export const fileKey = path => Array.from(path, c => c.toUpperCase().length === 1 ? c.toUpperCase() : c).join('');

export class SaveReplacedError extends Error {
  constructor() { super('A backup was restored in another tab. Reload to use the restored saves.'); }
}

function committed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('Save transaction was aborted'));
  });
}

export async function openStorage(executable, { factory = globalThis.indexedDB } = {}) {
  if (!factory) return null;
  const request = factory.open('nfs5-web-files-' + executable, 2);
  request.onupgradeneeded = ({ oldVersion }) => {
    if (oldVersion === 0) request.result.createObjectStore('files', { keyPath: 'key' });
    request.result.createObjectStore('metadata');
  };
  const database = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      request.onsuccess = () => request.result.close();
      reject(new Error('Save database upgrade is blocked by another tab'));
    };
  });
  database.onversionchange = () => database.close();
  let generation;
  return {
    async load() {
      const transaction = database.transaction(['files', 'metadata'], 'readonly');
      const files = transaction.objectStore('files').getAll();
      const current = transaction.objectStore('metadata').get('generation');
      await committed(transaction);
      generation = current.result;
      return files.result;
    },
    async save(records) {
      if (!records.length) return;
      const entries = records.map(record => ({ ...record, key: fileKey(record.path) }));
      const expected = generation;
      const transaction = database.transaction(['files', 'metadata'], 'readwrite');
      const store = transaction.objectStore('files');
      const current = transaction.objectStore('metadata').get('generation');
      let superseded = false;
      current.onsuccess = () => {
        // The game loaded its overlay before a restore in this or another tab.
        superseded = current.result !== expected;
        if (superseded) transaction.abort();
        else for (const entry of entries) store.put(entry);
      };
      try { await committed(transaction); }
      catch (error) { throw superseded ? new SaveReplacedError() : error; }
    },
    async replace(records) {
      const entries = records.map(record => ({ ...record, key: fileKey(record.path) }));
      const next = crypto.randomUUID();
      const transaction = database.transaction(['files', 'metadata'], 'readwrite');
      const store = transaction.objectStore('files');
      try {
        store.clear();
        for (const entry of entries) store.put(entry);
        transaction.objectStore('metadata').put(next, 'generation');
      } catch (error) {
        transaction.abort();
        throw error;
      }
      await committed(transaction);
      generation = next;
    },
    close: () => database.close(),
  };
}
