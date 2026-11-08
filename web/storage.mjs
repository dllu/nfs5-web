// Browser-local save overlay. A checkpoint is one atomic IndexedDB transaction;
// revisions are acknowledged only after it commits so concurrent writes survive.
export async function openStorage(executable, { factory = globalThis.indexedDB } = {}) {
  if (!factory) return null;
  const request = factory.open('nfs5-web-files-' + executable, 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'key' });
  const database = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Save database upgrade is blocked by another tab'));
  });
  database.onversionchange = () => database.close();
  return {
    async load() {
      const transaction = database.transaction('files', 'readonly'), request = transaction.objectStore('files').getAll();
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Save read was aborted'));
      });
    },
    async save(records) {
      if (!records.length) return;
      const transaction = database.transaction('files', 'readwrite'), store = transaction.objectStore('files');
      for (const record of records) {
        const key = Array.from(record.path, c => c.toUpperCase().length === 1 ? c.toUpperCase() : c).join('');
        store.put({ ...record, key });
      }
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Save write was aborted'));
      });
    },
    close: () => database.close(),
  };
}
