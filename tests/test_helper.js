const fs = require('fs');
const path = require('path');
const os = require('os');

// Set NODE_ENV to test
process.env.NODE_ENV = 'test';
process.env.MOCK_LDAP = '1';

// If no custom DB path is set yet, allocate an isolated temporary SQLite database
if (!process.env.MSO_DB_PATH && !process.env.DB_PATH) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mso-test-'));
  const tempDbPath = path.join(tempDir, 'test_mso_cloud.db');
  process.env.MSO_DB_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;

  const cleanup = () => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

const { db, runMigrations, getConfig, setConfig, logEvent } = require('../src/db');

// Ensure tables and migrations are initialized on the isolated DB
runMigrations();

module.exports = {
  db,
  runMigrations,
  getConfig,
  setConfig,
  logEvent
};
