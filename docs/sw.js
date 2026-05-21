const CACHE = 'recession-tracker-v1';
const PRECACHE = ['/', './index.html', './manifest.json'];
const DATA_URLS = ['./data/current.json', './data/history.json', './data/narrative.json', './data/alert-log.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Data files: network first, fall back to cache
  if (DATA_URLS.some(u => url.includes(u.replace('./', '')))) {
    e.respondWith(
      fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Other files: cache first
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
