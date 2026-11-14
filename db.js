// db.js — IndexedDB storage. Two object stores:
//   entries: { id, kind, day, occurred_at, logged_at, updated_at, fields, photos[] }
//   photos:  { id, blob, type, created_at }
// Nothing here touches the network.

const DB_NAME = 'turtle-log';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('day', 'day');
        db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// Wrap an IDBRequest in a Promise.
const wait = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// Resolve when a write transaction has committed.
const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

async function store(name, mode = 'readonly') {
  const db = await open();
  const tx = db.transaction(name, mode);
  return { tx, s: tx.objectStore(name) };
}

export async function entriesForDay(day) {
  const { s } = await store('entries');
  return wait(s.index('day').getAll(day));
}

export async function allEntries() {
  const { s } = await store('entries');
  return wait(s.getAll());
}

export async function getEntry(id) {
  const { s } = await store('entries');
  return wait(s.get(id));
}

export async function putEntry(entry) {
  const { tx, s } = await store('entries', 'readwrite');
  s.put(entry);
  return done(tx);
}

// Deletes the entry and every photo it references, atomically.
export async function deleteEntry(entry) {
  const db = await open();
  const tx = db.transaction(['entries', 'photos'], 'readwrite');
  tx.objectStore('entries').delete(entry.id);
  for (const pid of entry.photos || []) tx.objectStore('photos').delete(pid);
  return done(tx);
}

export async function putPhoto(photo) {
  const { tx, s } = await store('photos', 'readwrite');
  s.put(photo);
  return done(tx);
}

export async function getPhoto(id) {
  const { s } = await store('photos');
  return wait(s.get(id));
}

export async function deletePhoto(id) {
  const { tx, s } = await store('photos', 'readwrite');
  s.delete(id);
  return done(tx);
}

export async function allPhotos() {
  const { s } = await store('photos');
  return wait(s.getAll());
}

export async function counts() {
  const db = await open();
  const tx = db.transaction(['entries', 'photos']);
  const [entries, photos] = await Promise.all([
    wait(tx.objectStore('entries').count()),
    wait(tx.objectStore('photos').count()),
  ]);
  return { entries, photos };
}

export async function clearAll() {
  const db = await open();
  const tx = db.transaction(['entries', 'photos'], 'readwrite');
  tx.objectStore('entries').clear();
  tx.objectStore('photos').clear();
  return done(tx);
}
