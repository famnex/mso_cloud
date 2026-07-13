const CACHE_NAME = 'mso-student-card-v3';
const ASSETS = [
  'student_card.html',
  'style.css',
  'favicon.ico'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network First strategy for all requests to ensure updates are instant while online
self.addEventListener('fetch', (e) => {
  // Nur GET-Anfragen cachen (APIs und statische Assets)
  if (e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Nur erfolgreiche Anfragen in den Cache schreiben
        if (res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, resClone);
          });
        }
        return res;
      })
      .catch(() => {
        // Offline-Fallback aus dem Cache
        return caches.match(e.request);
      })
  );
});
