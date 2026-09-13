const CACHE_NAME = 'mso-student-card-v8';
const ASSETS = [
  'student_card.html',
  'style.css',
  'favicon.ico',
  'assets/qrcode.min.js',
  'assets/fontawesome/css/all.min.css',
  'assets/fontawesome/webfonts/fa-solid-900.woff2',
  'assets/fontawesome/webfonts/fa-regular-400.woff2',
  'assets/fontawesome/webfonts/fa-brands-400.woff2',
  'media/user.png'
];

let loggingEnabled = false;

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
          if (key !== CACHE_NAME && (key.startsWith('mso-student-card-') || key.startsWith('mso-'))) {
            log('Lösche alten MSO Cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // 1. Alle Nicht-GET Anfragen (POST, PUT, DELETE) sowie Nicht-HTTP(S) URLs NICHT abfangen.
  if (event.request.method !== 'GET' || (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://'))) {
    return;
  }

  // 2. Auth-, Admin- & Status-/Verifizierungs-APIs NIEMALS cachen (Network Only)
  if (
    event.request.url.includes('/api/auth/') ||
    event.request.url.includes('/api/admin/') ||
    event.request.url.includes('/api/tiles') ||
    event.request.url.includes('/api/student/status-check') ||
    event.request.url.includes('/api/student/verify-check') ||
    event.request.url.includes('/v?') ||
    event.request.url.includes('/verify')
  ) {
    return;
  }

  // 3. Bei Schülerausweis-Stammdaten: Versuche Netzwerk mit 1500ms Timeout, sonst Fallback aus Cache
  if (event.request.url.includes('/api/student/card')) {
    event.respondWith(
      Promise.race([
        fetch(event.request).then((res) => {
          if (res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          }
          return res;
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Network timeout')), 1500)
        )
      ]).catch(() => {
        return caches.match(event.request).then((cachedRes) => {
          if (cachedRes) {
            const headers = new Headers(cachedRes.headers);
            headers.set('X-From-Cache', 'true');
            return cachedRes.blob().then((blob) => {
              return new Response(blob, {
                status: cachedRes.status,
                statusText: cachedRes.statusText,
                headers: headers
              });
            });
          }
          return new Response(JSON.stringify({ error: 'Offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        });
      })
    );
    return;
  }

  // 4. Für App-Shell / Schriften / CSS / Assets (Cache First mit Revalidierung im Hintergrund)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request).then((networkRes) => {
          if (networkRes.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkRes));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
