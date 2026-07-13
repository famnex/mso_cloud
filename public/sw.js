const CACHE_NAME = 'mso-student-card-v3';
const ASSETS = [
  'student_card.html',
  'style.css',
  'favicon.ico',
  'assets/qrcode.min.js'
];

let loggingEnabled = false;

// Custom Logging Helper
function log(...args) {
  if (loggingEnabled) {
    console.log('[MSO PWA]', ...args);
  }
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SET_LOGGING') {
    loggingEnabled = e.data.enabled;
    log('PWA Logging via Admin-Konfiguration aktiviert.');
  }
});

self.addEventListener('install', (e) => {
  self.skipWaiting();
  log('Service Worker wird installiert...');
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      log('Caching statische Assets...');
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (e) => {
  log('Service Worker aktiviert.');
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            log('Lösche alten Cache:', key);
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
            log('Aktualisiere Cache für:', e.request.url);
            cache.put(e.request, resClone);
          });
        }
        return res;
      })
      .catch((err) => {
        log('Netzwerk-Abruf fehlgeschlagen. Lade aus Cache:', e.request.url);
        // Offline-Fallback aus dem Cache
        return caches.match(e.request);
      })
  );
});
