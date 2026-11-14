// sw.js — offline cache for the app's own files. It never sees your data
// (that lives in IndexedDB) and never fetches anything from other sites.
// Bump VERSION whenever you change any file, so phones pick up the update.
const VERSION = 'turtle-log-v1';
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'db.js', 'zip.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-600-normal.woff2',
  'fonts/ibm-plex-serif-latin-400-normal.woff2', 'fonts/ibm-plex-serif-latin-600-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache first, then network (only ever for this app's own files).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
