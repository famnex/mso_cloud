const fs = require('fs');
const path = require('path');
const os = require('os');

// Set NODE_ENV to test
process.env.NODE_ENV = 'test';
process.env.MOCK_LDAP = '1';

// Disable any inherited real MySQL connection parameters to prevent external network calls
delete process.env.MYSQL_HOST;
delete process.env.MYSQL_USER;
delete process.env.MYSQL_PASSWORD;
delete process.env.MYSQL_DATABASE;

// ALWAYS allocate an isolated temporary SQLite database for tests, ignoring any outer MSO_DB_PATH / DB_PATH
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

const { db, runMigrations, getConfig, setConfig, logEvent } = require('../src/db');

// Ensure tables and migrations are initialized on the isolated DB
runMigrations();

module.exports = {
  db,
  runMigrations,
  getConfig,
  setConfig,
  logEvent,
  tempDbPath,
  cleanup
};

