const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

// Datenbank initialisieren (damit Migrationen sofort laufen)
const { getConfig } = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware für JSON & Formular-Daten
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SqliteSessionStore = require('./sessionStore');

// Session-Konfiguration (Persistent in SQLite mit 1 Jahr Laufzeit & Auto-Verlängerung)
app.use(session({
  name: 'sid',
  store: new SqliteSessionStore(),
  secret: process.env.SESSION_SECRET || 'mso-cloud-secure-session-key-3849',
  resave: false,
  saveUninitialized: false,
  rolling: true, // Verlängert die Session-Laufzeit bei jeder Aktivität des Nutzers automatisch!
  cookie: {
    secure: false, // Auf true setzen, falls HTTPS genutzt wird
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 365 // 1 Jahr Gültigkeit (wird durch rolling:true stetig erneuert)
  }
}));

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

// Statische Dateien aus /public ausliefern
app.use(express.static(path.join(__dirname, '../public')));

/* ==========================================================================
   Routen registrieren
   ========================================================================== */
app.use('/api/setup', require('./routes/setup'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tiles', require('./routes/tiles'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/oauth', require('./routes/oauth'));

// Fallback für SPA (sendet immer index.html, falls kein statischer Ordner matched)
app.get('*', (req, res) => {
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
});
