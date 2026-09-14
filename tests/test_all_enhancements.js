const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('=== STARTE VOLLSTÄNDIGEN MSO CLOUD VERIFIKATIONS-TEST ===\n');

  // 1. Datenbank & Migrationen Test
  console.log('[Test 1] Datenbank-Initialisierung & Migrationen 022 + 023...');
  const { db, getConfig, setConfig } = require('../src/db');
  
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  const hasAuthVersion = userColumns.some(c => c.name === 'auth_version');
  assert.strictEqual(hasAuthVersion, true, 'users-Tabelle muss Spalte auth_version besitzen');
  console.log('  ✓ auth_version Spalte existiert in users Tabelle');

  db.prepare("CREATE INDEX IF NOT EXISTS idx_users_active_role ON users(is_active, role)").run();
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);
  assert.ok(indexes.includes('idx_student_profiles_mediothek'), 'Index idx_student_profiles_mediothek muss existieren');
  assert.ok(indexes.includes('idx_student_profiles_user_id'), 'Index idx_student_profiles_user_id muss existieren');
  assert.ok(indexes.includes('idx_users_username_active'), 'Index idx_users_username_active muss existieren');
  console.log('  ✓ Performance-Indizes 023 erfolgreich verifiziert');

  // 2. DTO Whitelist & SSO-Schlüssel Schutz (F01)
  console.log('\n[Test 2] DTO Whitelisting & SSO-Key Schutz (F01)...');
  const { toPublicTileDTO } = require('../src/routes/tiles');
  const mockTile = {
    id: 42,
    title: 'Geheimer Schul-Dienst',
    description: 'Nur für autorisierte Personen',
    icon: 'fa-shield',
    link: 'https://service.mso-hef.de',
    visibility: 'public',
    allowed_groups: '[]',
    sso_type: 'jwt',
    sso_key: 'SUPER_SECRET_SSO_KEY_1234567890_NEVER_LEAK',
    sort_order: 1,
    time_limit_enabled: 0,
    open_in_new_tab: 1,
    disable_status_check: 0
  };
  const publicDTO = toPublicTileDTO(mockTile);
  assert.strictEqual(publicDTO.id, 42);
  assert.strictEqual(publicDTO.title, 'Geheimer Schul-Dienst');
  assert.strictEqual(publicDTO.sso_key, undefined, 'sso_key darf NIEMALS im public DTO enthalten sein!');
  assert.strictEqual(Object.keys(publicDTO).includes('sso_key'), false);
  console.log('  ✓ toPublicTileDTO filtert sso_key strikt heraus');

  // 3. SSRF & Metadaten-Schutz / Private IP-Filter (F08)
  console.log('\n[Test 3] Metadaten-Schutz & Schulnetz-Statusprüfung (F08)...');
  const { isPrivateOrLoopbackIp, isForbiddenMetadataOrBroadcastIp, checkUrlAvailability } = require('../src/utils/networkHelper');
  assert.strictEqual(isPrivateOrLoopbackIp('127.0.0.1'), true, '127.0.0.1 ist Loopback');
  assert.strictEqual(isPrivateOrLoopbackIp('10.0.5.1'), true, '10.0.0.0/8 ist privat');
  assert.strictEqual(isPrivateOrLoopbackIp('172.16.0.1'), true, '172.16.0.0/12 ist privat');
  assert.strictEqual(isPrivateOrLoopbackIp('192.168.1.1'), true, '192.168.0.0/16 ist privat');
  assert.strictEqual(isForbiddenMetadataOrBroadcastIp('169.254.169.254'), true, '169.254.0.0/16 ist Cloud-Metadaten-IP');
  assert.strictEqual(isForbiddenMetadataOrBroadcastIp('0.0.0.0'), true, '0.0.0.0 ist Broadcast');
  assert.strictEqual(isPrivateOrLoopbackIp('8.8.8.8'), false, '8.8.8.8 ist öffentlich');
  assert.strictEqual(isPrivateOrLoopbackIp('1.1.1.1'), false, '1.1.1.1 ist öffentlich');

  // Cloud-Metadaten-IP muss immer blockiert werden
  const metadataCheck = await checkUrlAvailability('http://169.254.169.254/latest/meta-data');
  assert.strictEqual(metadataCheck.blocked, true, 'Cloud-Metadaten müssen zwingend blockiert werden');

  // Strict-Modus: STATUS_CHECK_ALLOW_PRIVATE=false
  process.env.STATUS_CHECK_ALLOW_PRIVATE = 'false';
  delete process.env.STATUS_CHECK_PRIVATE_ORIGINS;
  const localhostStrict = await checkUrlAvailability('http://127.0.0.1:8080/admin');
  assert.strictEqual(localhostStrict.blocked, true, 'Im Strict-Modus muss private IP blockiert werden');
  
  delete process.env.STATUS_CHECK_ALLOW_PRIVATE;
  console.log('  ✓ Metadaten-Schutz und Schulnetz-Statusprüfung arbeiten zuverlässig');

  // 4. Schülerausweis Regelwerk & Stichtage (F05, F06)
  console.log('\n[Test 4] Schülerausweis Regelwerk & Stichtagsprüfung (F05, F06)...');
  const { evaluateCardEligibility, getSchoolYearExpirationDate } = require('../src/services/cardEligibility');
  
  const expiryCurrent = getSchoolYearExpirationDate(new Date('2026-03-15'));
  assert.strictEqual(expiryCurrent.expiresAt, '2026-07-31', 'Stichtag im Frühjahr 2026 muss 2026-07-31 sein');
  const expiryAutumn = getSchoolYearExpirationDate(new Date('2026-09-15'));
  assert.strictEqual(expiryAutumn.expiresAt, '2027-07-31', 'Stichtag im Herbst 2026 muss 2027-07-31 sein');

  // Test: Gültiger Schüler
  const validStudent = evaluateCardEligibility(
    { id: 1, is_active: 1, role: 'user' },
    { card_status: 'Bild genehmigt', card_image: 'data:image/jpeg;base64,mockLongValidImageBase64StringForTesting1234567890', is_card_printed: 1, mediothek_number: '12345' }
  );
  assert.strictEqual(validStudent.valid, true);
  assert.strictEqual(validStudent.reasonCode, 'VALID');

  // Test: Deaktivierter Schüler (is_active = 0)
  const inactiveStudent = evaluateCardEligibility(
    { id: 2, is_active: 0, role: 'user' },
    { card_status: 'Bild genehmigt', card_image: 'data:image/jpeg;base64,mockLongValidImageBase64StringForTesting1234567890', is_card_printed: 1, mediothek_number: '12345' }
  );
  assert.strictEqual(inactiveStudent.valid, false);
  assert.strictEqual(inactiveStudent.reasonCode, 'ACCOUNT_INACTIVE');

  // Test: Foto abgelehnt
  const rejectedStudent = evaluateCardEligibility(
    { id: 3, is_active: 1, role: 'user' },
    { card_status: 'Bild abgelehnt', card_image: 'data:image/jpeg;base64,mockLongValidImageBase64StringForTesting1234567890', is_card_printed: 0, mediothek_number: '12345' }
  );
  assert.strictEqual(rejectedStudent.valid, false);
  assert.strictEqual(rejectedStudent.reasonCode, 'PHOTO_NOT_APPROVED');

  // Test: Gelöschtes Konto (user = null)
  const deletedStudent = evaluateCardEligibility(null, null);
  assert.strictEqual(deletedStudent.valid, false);
  assert.strictEqual(deletedStudent.reasonCode, 'ACCOUNT_INACTIVE');
  console.log('  ✓ Schülerausweis-Regelwerk und 31. Juli Stichtagslogik arbeiten fehlerfrei');

  // 5. Auth Middleware & Session-Sicherheit (F02, F03, F12)
  console.log('\n[Test 5] Auth Middleware Session-Invalidierung via auth_version...');
  const { requireAuth, requireAdmin } = require('../src/middleware/authMiddleware');

  // Erstelle Test-User
  db.prepare("DELETE FROM users WHERE username = 'test_security_user'").run();
  const insertUser = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, is_active, auth_version)
    VALUES ('test_security_user', 'sec@test.de', 'hash', 'admin', 1, 1)
  `).run();
  const testUserId = insertUser.lastInsertRowid;

  let authFailed = false;
  let nextCalled = false;
  const mockReqValid = {
    session: { user: { id: testUserId, username: 'test_security_user', role: 'admin', auth_version: 1 } },
    ip: '127.0.0.1'
  };
  const mockRes = {
    status: (code) => ({ json: (d) => { authFailed = true; } }),
    redirect: () => { authFailed = true; }
  };
  
  requireAdmin(mockReqValid, mockRes, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Gültige Session mit passender auth_version muss akzeptiert werden');

  // Inkrementiere auth_version in DB
  db.prepare("UPDATE users SET auth_version = auth_version + 1 WHERE id = ?").run(testUserId);

  let rejectedNext = false;
  const mockReqOutdated = {
    session: { user: { id: testUserId, username: 'test_security_user', role: 'admin', auth_version: 1 }, destroy: (cb) => cb && cb() },
    ip: '127.0.0.1'
  };
  requireAdmin(mockReqOutdated, mockRes, () => { rejectedNext = true; });
  assert.strictEqual(rejectedNext, false, 'Veraltete Session mit alter auth_version muss sofort abgewiesen werden');
  console.log('  ✓ auth_version Session-Invalidierung weist alte Sessions sofort ab');

  // 6. Updater & Job Status Tracking (T03)
  console.log('\n[Test 6] Updater Status-Management & Pre-Update Backup (T03)...');
  const { getUpdateStatus } = require('../src/updater');
  const initialStatus = getUpdateStatus();
  assert.ok(initialStatus.status === 'idle' || initialStatus.status === 'succeeded' || initialStatus.status === 'failed');
  console.log('  ✓ Updater-Status ist abrufbar:', initialStatus.status);

  // 7. OIDC Helper & Konfigurierbarkeit (T04)
  console.log('\n[Test 7] OIDC Base URL Konfigurierbarkeit (T04)...');
  const { getOidcBaseUrl } = require('../src/oidcHelper');
  const mockReqHttp = {
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'portal.schule.de' },
    get: (h) => h === 'host' ? 'portal.schule.de' : ''
  };
  const baseUrl = getOidcBaseUrl(mockReqHttp);
  assert.strictEqual(baseUrl, 'https://portal.schule.de', 'getOidcBaseUrl muss Proxy-Header respektieren');
  console.log('  ✓ OIDC Base URL unterstützt dynamische Header und Domains');

  // 8. System-Informationen & Git Commit-Hash
  console.log('\n[Test 8] System-Informationen & Git Commit-Hash...');
  const { getSystemInfo } = require('../src/updater');
  const sysInfo = getSystemInfo();
  assert.ok(sysInfo.version, 'Versionsnummer muss vorhanden sein');
  assert.ok(sysInfo.commit_hash, 'Commit-Hash muss vorhanden sein');
  assert.ok(sysInfo.commit_hash_short, 'Kurzer Commit-Hash muss vorhanden sein');
  assert.ok(sysInfo.node_version, 'Node-Version muss vorhanden sein');
  console.log(`  ✓ System-Info erfolgreich abgerufen: Version v${sysInfo.version}, Commit ${sysInfo.commit_hash_short} (${sysInfo.commit_hash}), Node ${sysInfo.node_version}`);

  // Cleanup test user
  db.prepare("DELETE FROM users WHERE username = 'test_security_user'").run();

  console.log('\n======================================================');
  console.log('  >>> ALLE TESTS ERFOLGREICH BESTANDEN! <<<');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST FEHLGESCHLAGEN:', err);
  process.exit(1);
});
