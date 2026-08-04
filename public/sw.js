const CACHE_NAME = 'mso-student-card-v4';
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

// Network First strategy with 1200ms Timeout Fallback to Cache for bad cell reception
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || (!e.request.url.startsWith('http://') && !e.request.url.startsWith('https://'))) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    new Promise((resolve) => {
      let isResolved = false;

      // 1200ms Timeout: Bei lahmem Empfang sofort auf den PWA-Cache zurückgreifen
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          caches.match(e.request).then((cachedRes) => {
            if (cachedRes && !isResolved) {
              isResolved = true;
              log('Netzwerk zu langsam (>1.2s). Antworte sofort aus PWA-Cache:', e.request.url);
              resolve(cachedRes);
            }
          });
        }
      }, 1200);

      fetch(e.request)
        .then((res) => {
          clearTimeout(timeoutId);
          if (!isResolved) {
            isResolved = true;
            if (res.status === 200) {
              const resClone = res.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(e.request, resClone);
              });
            }
            resolve(res);
          }
        })
        .catch(() => {
          clearTimeout(timeoutId);
          if (!isResolved) {
            isResolved = true;
            caches.match(e.request).then((cachedRes) => {
              if (cachedRes) {
                resolve(cachedRes);
              } else {
                resolve(new Response('Offline', { status: 503 }));
              }
            });
          }
        });
    })
  );
});
