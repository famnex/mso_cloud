const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Führt einen Shell-Befehl asynchron aus und gibt das Ergebnis als Promise zurück.
 */
function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`Führe Befehl aus: ${command} in ${cwd}`);
    exec(command, { cwd }, (error, stdout, stderr) => {
      console.log(`[STDOUT]: ${stdout}`);
      if (stderr) {
        console.warn(`[STDERR]: ${stderr}`);
      }
      if (error) {
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

/**
 * Kernfunktion zum Ausführen des Updates.
 * Pullt Code von GitHub, installiert Abhängigkeiten, wendet DB-Migrationen an und startet PM2 neu.
 */
async function performUpdate() {
  const projectRoot = path.join(__dirname, '..');
  const results = {
    gitPull: '',
    npmInstall: '',
    dbMigrations: '',
    pm2Reload: '',
    success: false,
    error: null
  };

  try {
    // 1. GitHub Pull
    console.log('--- Schritt 1: Git Pull ---');
    results.gitPull = await runCommand('git pull', projectRoot);

    // 2. NPM Install
    console.log('--- Schritt 2: NPM Dependencies installieren ---');
    results.npmInstall = await runCommand('npm install', projectRoot);

    // 3. Datenbank-Migrationen manuell anstoßen
    console.log('--- Schritt 3: Datenbank-Migrationen ausführen ---');
    // Wir rufen db.js direkt auf, damit die Migrationen ausgeführt werden.
    // Das db-Modul führt runMigrations() beim Laden automatisch aus.
    results.dbMigrations = await runCommand('node -e "require(\'./src/db\')" ', projectRoot);

    // 4. PM2 Reload
    console.log('--- Schritt 4: PM2 Prozess neu laden ---');
    try {
      results.pm2Reload = await runCommand('pm2 reload mso-cloud', projectRoot);
    } catch (pm2Error) {
      console.warn('PM2 konnte nicht automatisch neu geladen werden. Möglicherweise läuft die Anwendung nicht unter PM2 oder pm2 ist nicht global installiert. Manueller Neustart erforderlich.', pm2Error.message);
      results.pm2Reload = `Warnung: PM2 Reload fehlgeschlagen (${pm2Error.message}). Manueller Neustart erforderlich.`;
    }

    results.success = true;
    console.log('Update-Vorgang erfolgreich abgeschlossen!');
  } catch (error) {
    console.error('Fehler während des Updates:', error);
    results.success = false;
    results.error = error.message;
  }

  return results;
}

// Ermöglicht es, das Skript direkt über die CLI auszuführen (z.B. npm run update)
if (require.main === module) {
  performUpdate().then(results => {
    if (results.success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  });
}

module.exports = {
  performUpdate
};
