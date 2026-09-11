const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let currentJob = {
  id: null,
  status: 'idle', // 'idle' | 'running' | 'succeeded' | 'failed'
  progress: [],
  startedAt: null,
  finishedAt: null,
  error: null
};

function logProgress(msg) {
  const time = new Date().toISOString();
  const entry = `[${time}] ${msg}`;
  console.log(entry);
  if (currentJob) {
    currentJob.progress.push(entry);
    if (currentJob.progress.length > 200) {
      currentJob.progress.shift();
    }
  }
}

/**
 * Führt einen Shell-Befehl asynchron aus und gibt das Ergebnis als Promise zurück.
 */
function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    logProgress(`Führe Befehl aus: ${command}`);
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (stdout && stdout.trim()) {
        logProgress(`[STDOUT]: ${stdout.trim()}`);
      }
      if (stderr && stderr.trim()) {
        logProgress(`[STDERR]: ${stderr.trim()}`);
      }
      if (error) {
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

function getUpdateStatus() {
  return currentJob;
}

/**
 * Kernfunktion zum Ausführen des Updates.
 * Erstellt DB-Backup, pullt Code von GitHub, installiert Abhängigkeiten, wendet DB-Migrationen an und startet PM2 neu.
 */
async function performUpdate() {
  if (currentJob.status === 'running') {
    return {
      success: false,
      alreadyRunning: true,
      message: 'Ein Update läuft bereits im Hintergrund.',
      job: currentJob
    };
  }

  const projectRoot = path.join(__dirname, '..');
  const jobId = `update_${Date.now()}`;
  
  currentJob = {
    id: jobId,
    status: 'running',
    progress: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null
  };

  logProgress(`=== Starte MSO Cloud System-Update (${jobId}) ===`);

  const results = {
    backup: '',
    gitPull: '',
    npmInstall: '',
    dbMigrations: '',
    pm2Reload: '',
    success: false,
    error: null
  };

  try {
    // 0. Pre-Update SQLite Backup
    logProgress('--- Schritt 0: Erstelle Datenbank-Backup vor Migration ---');
    const dataDir = path.join(projectRoot, 'data');
    let dbPath = path.join(dataDir, 'mso_cloud.db');
    if (!fs.existsSync(dbPath) && fs.existsSync(path.join(dataDir, 'database.sqlite'))) {
      dbPath = path.join(dataDir, 'database.sqlite');
    }
    const backupDir = path.join(dataDir, 'backups');
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    if (fs.existsSync(dbPath)) {
      const backupFilename = `backup_pre_update_${Date.now()}.db`;
      const backupPath = path.join(backupDir, backupFilename);
      fs.copyFileSync(dbPath, backupPath);
      results.backup = `Backup erfolgreich erstellt: ${backupFilename}`;
      logProgress(results.backup);
    } else {
      results.backup = 'Keine bestehende Datenbankdatei gefunden (Initialzustand).';
      logProgress(results.backup);
    }

    // 1. GitHub Pull
    logProgress('--- Schritt 1: Git Pull ---');
    results.gitPull = await runCommand('git pull', projectRoot);

    // 2. NPM Dependencies
    logProgress('--- Schritt 2: NPM Dependencies installieren ---');
    results.npmInstall = await runCommand('npm install --no-audit --no-fund', projectRoot);

    // 3. Datenbank-Migrationen manuell ausführen
    logProgress('--- Schritt 3: Datenbank-Migrationen ausführen ---');
    results.dbMigrations = await runCommand('node -e "require(\'./src/db\')" ', projectRoot);

    // 4. PM2 Reload
    logProgress('--- Schritt 4: PM2 Prozess neu laden ---');
    try {
      results.pm2Reload = await runCommand('pm2 reload mso-cloud', projectRoot);
    } catch (pm2Error) {
      logProgress(`PM2 konnte nicht automatisch neu geladen werden: ${pm2Error.message}`);
      results.pm2Reload = `Warnung: PM2 Reload nicht möglich (${pm2Error.message}). Manueller Neustart erforderlich falls kein Watcher aktiv.`;
    }

    results.success = true;
    currentJob.status = 'succeeded';
    currentJob.finishedAt = new Date().toISOString();
    logProgress('=== Update-Vorgang erfolgreich abgeschlossen! ===');
  } catch (error) {
    console.error('Fehler während des Updates:', error);
    results.success = false;
    results.error = error.message;
    currentJob.status = 'failed';
    currentJob.error = error.message;
    currentJob.finishedAt = new Date().toISOString();
    logProgress(`=== FEHLER beim Update: ${error.message} ===`);
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
  performUpdate,
  getUpdateStatus
};
