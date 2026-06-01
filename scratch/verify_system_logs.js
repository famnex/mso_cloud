const { db, logEvent } = require('C:\\Users\\fleis\\.gemini\\antigravity\\scratch\\mso_cloud\\src\\db');
const assert = require('assert');

async function testSystemLogs() {
  console.log('Starte Test für System-Protokolle...');

  // 1. Alle vorhandenen Testeinträge löschen
  db.prepare('DELETE FROM system_logs').run();

  // 2. Ein paar Testlogs erstellen
  console.log('Erstelle Test-Protokolle...');
  logEvent('info', 'test_action_info', 'Dies ist eine Info-Testnachricht', { context: 'test_info' }, '127.0.0.1');
  logEvent('warn', 'test_action_warn', 'Dies ist eine Warn-Testnachricht', { code: 404 }, '192.168.1.1');
  logEvent('error', 'test_action_error', 'Dies ist eine Fehler-Testnachricht', { stack: 'Error: Connection lost' }, '10.0.0.1');

  // 3. Aus Datenbank auslesen und prüfen mit stabilem Chronological-Ordering
  console.log('Lese Protokolle aus der Datenbank...');
  const logs = db.prepare('SELECT * FROM system_logs ORDER BY created_at DESC, id DESC').all();

  console.log(`Es wurden ${logs.length} Logs gefunden.`);
  assert.strictEqual(logs.length, 3, 'Es sollten genau 3 Logs existieren.');

  // Prüfung der einzelnen Werte
  const errorLog = logs[0];
  assert.strictEqual(errorLog.level, 'error');
  assert.strictEqual(errorLog.action, 'test_action_error');
  assert.strictEqual(errorLog.message, 'Dies ist eine Fehler-Testnachricht');
  assert.strictEqual(errorLog.ip, '10.0.0.1');
  
  const parsedDetails = JSON.parse(errorLog.details);
  assert.strictEqual(parsedDetails.stack, 'Error: Connection lost');

  const warnLog = logs[1];
  assert.strictEqual(warnLog.level, 'warn');
  assert.strictEqual(warnLog.action, 'test_action_warn');
  assert.strictEqual(JSON.parse(warnLog.details).code, 404);

  const infoLog = logs[2];
  assert.strictEqual(infoLog.level, 'info');
  assert.strictEqual(infoLog.action, 'test_action_info');

  console.log('✓ E2E DB-Protokollierungstest erfolgreich abgeschlossen!');
}

testSystemLogs().catch(err => {
  console.error('Test fehlgeschlagen:', err);
  process.exit(1);
});
