require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

// Datenbank initialisieren (damit Migrationen sofort laufen)
const { getConfig, cleanupOldLogs } = require('./db');
const proxyCheckMiddleware = require('./middleware/proxyCheckMiddleware');
const { cleanExpiredCache } = require('./proxycheck');

const app = express();

// Trust Proxy konfigurierbar halten (z. B. 'loopback', Anzahl Hops oder Subnetze statt pauschalem true)
const { getSessionTransport } = require('./utils/sessionTransport');
const { trustProxy, secureCookie } = getSessionTransport(process.env);
app.set('trust proxy', trustProxy);
const PORT = process.env.PORT || 8080;

// Middleware für JSON & Formular-Daten (erhöhtes Limit für Base64 Bilder)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const SqliteSessionStore = require('./sessionStore');

const sessionSecret = process.env.SESSION_SECRET || 'mso-cloud-secure-session-key-3849';
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARNUNG: SESSION_SECRET ist nicht gesetzt! Im Produktionsbetrieb sollte ein sicheres Secret über Umgebungsvariablen gesetzt werden.');
}



// Session-Konfiguration (Persistent in SQLite mit 30 Tagen rollender Laufzeit)
app.use(session({
  name: 'sid',
  store: new SqliteSessionStore(),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: secureCookie,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 Tage Gültigkeit
  }
}));

// Do not report a successful login when HTTPS-only cookies cannot be issued.
app.use((req, res, next) => {
  if (secureCookie === true && !req.secure && req.method === 'POST' &&
      /\/api\/auth\/(login|student-token-login)$/.test(req.path)) {
    return res.status(503).json({
      code: 'SESSION_HTTPS_REQUIRED',
      error: 'Die sichere Anmeldung ist nicht korrekt konfiguriert. Bitte HTTPS und die Proxy-Einstellungen prüfen lassen.'
    });
  }
  next();
});

/* ==========================================================================
   Installations-Redirect-Middleware
   ========================================================================== */
app.use((req, res, next) => {
  try {
    const setupCompleted = getConfig('setup_completed') === '1';

    // Wenn Setup NICHT abgeschlossen ist:
    if (!setupCompleted) {
      const isSetupPage = req.path === '/setup.html';
      const isSetupApi = req.path.startsWith('/api/setup');
      const isStaticAsset = req.path.includes('.') && !isSetupPage; // JS, CSS, etc. zulassen

      if (!isSetupPage && !isSetupApi && !isStaticAsset) {
        console.log(`Redirecting unauthorized path ${req.path} to setup.html`);
        res.writeHead(302, { 'Location': 'setup.html' });
        return res.end();
      }
    } else {
      // Wenn Setup abgeschlossen ist, blockiere den erneuten Aufruf der Setup-Seite
      if (req.path === '/setup.html') {
        res.writeHead(302, { 'Location': 'index.html' });
        return res.end();
      }
    }
  } catch (err) {
    console.error('Fehler in der Setup-Middleware:', err);
  }
  next();
});

// Dynamisch generiertes Manifest für konfigurierbare PWA-Icons
app.get(['/manifest.json', '/novus/manifest.json'], (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    name: "MSO Digitaler Schülerausweis",
    short_name: "MSO Ausweis",
    start_url: "student_card.html",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: getConfig('card_primary_color', '#3b82f6'),
    icons: [
      {
        src: "api/student/pwa-icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable"
      }
    ]
  });
});

// Öffentliche Verifizierungsseite für Schülerausweis-QR-Codes
// Reagiert sofort auf /v, /verify sowie alle Subpfad-Präfixe (z.B. /novus/v) vor Statik- und SPA-Fallbacks!
app.use((req, res, next) => {
  const p = req.path.toLowerCase().replace(/\/$/, '');
  if (p === '/v' || p === '/verify' || p === '/v.html' || p === '/verify.html' || 
      p.endsWith('/v') || p.endsWith('/verify') || p.endsWith('/v.html') || p.endsWith('/verify.html')) {
    return res.sendFile(path.join(__dirname, '../public/verify.html'));
  }
  next();
});

// Statische Dateien aus /public ausliefern
app.use(express.static(path.join(__dirname, '../public')));
app.use('/novus', express.static(path.join(__dirname, '../public')));

// ProxyCheck.io Schutz-Middleware für Anonymisierungs- und VPN-Filterung
app.use(proxyCheckMiddleware);

/* ==========================================================================
   Routen registrieren
   ========================================================================== */
app.use(['/api/setup', '/novus/api/setup'], require('./routes/setup'));
app.use(['/api/auth', '/novus/api/auth'], require('./routes/auth'));
app.use(['/api/tiles', '/novus/api/tiles'], require('./routes/tiles'));
app.use(['/api/messages', '/novus/api/messages'], require('./routes/messages'));
app.use(['/api/admin', '/novus/api/admin'], require('./routes/admin'));
app.use(['/api/student', '/novus/api/student'], require('./routes/student'));
app.use(['/api/oauth', '/novus/api/oauth'], require('./routes/oauth'));

// OIDC standardisierte Pfade auf Root-Ebene (Direkte JSON-Antworten ohne Redirect für Auto-Discovery)
const { openidConfigurationHandler, jwksHandler } = require('./oidcHelper');
app.get(['/.well-known/openid-configuration', '/novus/.well-known/openid-configuration'], openidConfigurationHandler);
app.get(['/jwks', '/novus/jwks'], jwksHandler);

// Fallback für SPA (sendet index.html nur für echte Seitennavigation)
app.get('*', (req, res) => {
  // Nicht gefundene API-Routen mit JSON 404 beantworten
  if (req.path.startsWith('/api/') || req.path.startsWith('/novus/api/')) {
    return res.status(404).json({ error: 'API-Endpunkt nicht gefunden' });
  }

  // Fehlende Bilder, Skripte, Stylesheets und Fonts mit 404 beantworten (nicht mit HTML überschreiben!)
  if (/\.(png|jpg|jpeg|gif|svg|ico|css|js|map|woff|woff2|ttf|eot)$/i.test(req.path)) {
    return res.status(404).send('Datei nicht gefunden');
  }

  const setupCompleted = getConfig('setup_completed') === '1';
  if (!setupCompleted) {
    res.sendFile(path.join(__dirname, '../public/setup.html'));
  } else {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(` MSO Cloud Launcher läuft auf Port: ${PORT}`);
  console.log(` Server-Modus: ${process.env.NODE_ENV || 'development'}`);
  console.log(`=================================================`);

  // Einmaligen Log- & ProxyCheck Cache-Cleanup beim Start durchführen
  cleanupOldLogs();
  cleanExpiredCache();

  // Täglicher Cleanup um 03:00 Uhr
  const scheduleDaily = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    setTimeout(() => {
      cleanupOldLogs();
      cleanExpiredCache();
      setInterval(() => {
        cleanupOldLogs();
        cleanExpiredCache();
      }, 24 * 60 * 60 * 1000);
    }, delay);
  };
  scheduleDaily();
});
