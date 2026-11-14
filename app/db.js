// db.js — IndexedDB storage. Object stores:
//   entries: { id, kind, day, occurred_at, logged_at, updated_at, fields, photos[] }
//   photos:  { id, blob, type, created_at }
//   drafts:  { key, kind, id, day, vals, when, photoIds, pending[{id, blob}], removed[], saved_at }
// Nothing here touches the network.

const DB_NAME = 'turtle-log';
const DB_VERSION = 2;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        if (ev.oldVersion < 1) {
          db.createObjectStore('entries', { keyPath: 'id' }).createIndex('day', 'day');
          db.createObjectStore('photos', { keyPath: 'id' });
        }
        if (ev.oldVersion < 2) db.createObjectStore('drafts', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const wait = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

async function read(name, fn) {
  const db = await open();
  return wait(fn(db.transaction(name).objectStore(name)));
}

async function write(names, fn) {
  const db = await open();
  const tx = db.transaction(names, 'readwrite');
  fn(tx);
  return done(tx);
}

// ---- entries ----
export const entriesForDay = (day) => read('entries', (s) => s.index('day').getAll(day));
export const allEntries = () => read('entries', (s) => s.getAll());
export const getEntry = (id) => read('entries', (s) => s.get(id));

// Saves an entry together with its new photos and deletes photos it no longer
// uses, all in one transaction: either everything is written or nothing is.
export const saveEntry = (entry, { newPhotos = [], removedPhotoIds = [] } = {}) =>
  write(['entries', 'photos'], (tx) => {
    for (const p of newPhotos) tx.objectStore('photos').put(p);
    tx.objectStore('entries').put(entry);
    for (const id of removedPhotoIds) tx.objectStore('photos').delete(id);
  });

export const deleteEntry = (entry) =>
  write(['entries', 'photos'], (tx) => {
    tx.objectStore('entries').delete(entry.id);
    for (const pid of entry.photos || []) tx.objectStore('photos').delete(pid);
  });

// ---- photos ----
export const getPhoto = (id) => read('photos', (s) => s.get(id));
export const allPhotos = () => read('photos', (s) => s.getAll());

// ---- drafts (unsaved form state) ----
export const getDraft = (key) => read('drafts', (s) => s.get(key));
export const allDrafts = () => read('drafts', (s) => s.getAll());
export const putDraft = (draft) => write(['drafts'], (tx) => tx.objectStore('drafts').put(draft));
export const deleteDraft = (key) => write(['drafts'], (tx) => tx.objectStore('drafts').delete(key));

// ---- bulk ----
export async function counts() {
  const db = await open();
  const tx = db.transaction(['entries', 'photos']);
  const [entries, photos] = await Promise.all([
    wait(tx.objectStore('entries').count()),
    wait(tx.objectStore('photos').count()),
  ]);
  return { entries, photos };
}

// Atomic import: photos and entries land together or not at all.
export const importAll = (entries, photos) =>
  write(['entries', 'photos'], (tx) => {
    for (const p of photos) tx.objectStore('photos').put(p);
    for (const e of entries) tx.objectStore('entries').put(e);
  });

export const clearAll = () =>
  write(['entries', 'photos', 'drafts'], (tx) => {
    for (const s of ['entries', 'photos', 'drafts']) tx.objectStore(s).clear();
  });
