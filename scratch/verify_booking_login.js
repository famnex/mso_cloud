const { db, runMigrations } = require('C:/Users/fleis/.gemini/antigravity/scratch/mso_cloud/src/db');
const authRouter = require('C:/Users/fleis/.gemini/antigravity/scratch/mso_cloud/src/routes/auth');
const assert = require('assert');

async function testBookingAutologin() {
  console.log('Starte Test für classroombookings Autologin...');

  // 1. Sicherstellen, dass die Migrationen (inklusive 009) ausgeführt wurden
  console.log('Führe Datenbank-Migrationen aus...');
  runMigrations();

  // 2. Tabellen-Definition verifizieren
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_booking_credentials'").get();
  assert.ok(tableCheck, 'Tabelle user_booking_credentials sollte existieren.');
  console.log('✓ Tabelle user_booking_credentials erfolgreich verifiziert.');

  // 3. Bestehende Credentials und Testuser leeren
  db.prepare('DELETE FROM user_booking_credentials WHERE user_id = 9999').run();
  db.prepare('DELETE FROM users WHERE id = 9999').run();

  // Testuser einfügen, um Fremdschlüssel-Constraint zu erfüllen
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, groups, is_ldap)
    VALUES (9999, 'test.teacher', 'test.teacher@mso-hef.de', 'hash', 'user', '[]', 0)
  `).run();

  // 4. Verschlüsselte Test-Credentials einfügen
  const testUser = { id: 9999, username: 'test.teacher', email: 'test.teacher@mso-hef.de' };
  const rawPassword = 'SecureBookingPassword123!';
  const encryptedPassword = authRouter.encrypt(rawPassword);

  console.log('Füge verschlüsselte Test-Zugangsdaten in die Datenbank ein...');
  db.prepare(`
    INSERT INTO user_booking_credentials (user_id, booking_username, booking_password)
    VALUES (?, ?, ?)
  `).run(testUser.id, testUser.username, encryptedPassword);

  // 5. Credentials abfragen und entschlüsseln
  console.log('Lese Zugangsdaten aus der Datenbank...');
  const row = db.prepare('SELECT * FROM user_booking_credentials WHERE user_id = ?').get(testUser.id);
  assert.ok(row, 'Zugangsdaten sollten ausgelesen werden können.');
  assert.strictEqual(row.booking_username, testUser.username, 'Benutzername sollte übereinstimmen.');

  console.log('Entschlüssele Passwort...');
  const decrypted = authRouter.decrypt(row.booking_password);
  assert.strictEqual(decrypted, rawPassword, 'Das entschlüsselte Passwort sollte mit dem Original übereinstimmen.');
  console.log('✓ Verschlüsselung und Entschlüsselung (AES-256-CBC) erfolgreich verifiziert.');

  // 6. Aufräumen
  db.prepare('DELETE FROM user_booking_credentials WHERE user_id = 9999').run();
  db.prepare('DELETE FROM users WHERE id = 9999').run();
  console.log('Aufräumarbeiten abgeschlossen.');

  console.log('✓ E2E classroombookings Autologin-Test erfolgreich abgeschlossen!');
}

testBookingAutologin().catch(err => {
  console.error('Test fehlgeschlagen:', err);
  process.exit(1);
});
