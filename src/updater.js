const { exec, execSync } = require('child_process');
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

    // 1. GitHub Fetch & Hard Reset to origin/main
    logProgress('--- Schritt 1: Git Fetch & Reset auf origin/main ---');
    try {
      await runCommand('git fetch origin main', projectRoot);
      results.gitPull = await runCommand('git reset --hard origin/main', projectRoot);
    } catch (fetchErr) {
      logProgress(`Warnung bei Fetch/Reset (${fetchErr.message}), führe Fallback 'git pull' aus...`);
      results.gitPull = await runCommand('git pull', projectRoot);
    }

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

/**
 * Ermittelt aktuelle System- und Versionsinformationen inkl. Git Commit-Hash.
 */
function getSystemInfo() {
  const projectRoot = path.join(__dirname, '..');
  let pkgVersion = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    pkgVersion = pkg.version || '1.0.0';
  } catch (e) {
    // Fallback
  }

  let commitHash = '';
  let commitHashShort = '';
  let commitDate = '';
  let commitMessage = '';
  let branch = '';

  try {
    commitHash = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    commitHashShort = execSync('git rev-parse --short HEAD', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    commitDate = execSync('git log -1 --format=%ci', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    commitMessage = execSync('git log -1 --format=%s', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    try {
      const gitHeadPath = path.join(projectRoot, '.git', 'HEAD');
      if (fs.existsSync(gitHeadPath)) {
        const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
        if (headContent.startsWith('ref: ')) {
          const refRelative = headContent.replace('ref: ', '').trim();
          branch = refRelative.split('/').pop() || '';
          const refPath = path.join(projectRoot, '.git', refRelative);
          if (fs.existsSync(refPath)) {
            commitHash = fs.readFileSync(refPath, 'utf8').trim();
            commitHashShort = commitHash.substring(0, 7);
          } else {
            const packedRefsPath = path.join(projectRoot, '.git', 'packed-refs');
            if (fs.existsSync(packedRefsPath)) {
              const packed = fs.readFileSync(packedRefsPath, 'utf8');
              const match = packed.split('\n').find(line => line.endsWith(refRelative));
              if (match) {
                commitHash = match.split(' ')[0].trim();
                commitHashShort = commitHash.substring(0, 7);
              }
            }
          }
        } else {
          commitHash = headContent;
          commitHashShort = headContent.substring(0, 7);
        }
      }
    } catch (fsErr) {
      // ignore
    }
  }

  return {
    version: pkgVersion,
    commit_hash: commitHash || 'Unbekannt',
    commit_hash_short: commitHashShort || (commitHash ? commitHash.substring(0, 7) : 'Unbekannt'),
    commit_date: commitDate || '',
    commit_message: commitMessage || '',
    branch: branch || 'main',
    node_version: process.version,
    platform: process.platform,
    arch: process.arch
  };
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
  getUpdateStatus,
  getSystemInfo
};
