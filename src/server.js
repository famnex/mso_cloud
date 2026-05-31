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

// Session-Konfiguration
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'mso-cloud-secure-session-key-3849',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Auf true setzen, falls HTTPS genutzt wird
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 24 Stunden Gültigkeit
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
        console.log(`Redirecting unauthorized path ${req.path} to /setup.html`);
        return res.redirect('setup.html');
      }
    } else {
      // Wenn Setup abgeschlossen ist, blockiere den erneuten Aufruf der Setup-Seite
      if (req.path === '/setup.html') {
        return res.redirect('index.html');
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
app.use('/api/admin', require('./routes/admin'));

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
