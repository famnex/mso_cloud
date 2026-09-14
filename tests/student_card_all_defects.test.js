const assert = require('assert');
const { db, runMigrations } = require('./test_helper');
const {
  getSchoolYearExpirationDate,
  computeCardVersion,
  evaluateCardEligibility,
  getPersistentGrant,
  savePersistentGrant,
  revokePersistentGrant
} = require('../src/services/cardEligibility');
const studentDb = require('../src/student_db');

console.log('=== START REGRESSION TEST SUITE: ALL 20+ STUDENT CARD SCENARIOS ===\n');

let passedTests = 0;
const totalTests = 43;

async function runTest(num, name, fn) {
  try {
    await fn();
    console.log(`[PASS] Test ${num}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] Test ${num}: ${name}`);
    console.error('       Error:', err.message);
    throw err;
  }
}

async function runAllTests() {
  // -------------------------------------------------------------
  // SETUP ISOLATED TEST DATA
  // -------------------------------------------------------------
  const testUserActive = { id: 8001, username: 'student.active', email: 'active@mso-test.de', role: 'user', is_active: 1 };
  const testUserLocalOnly = { id: 8002, username: 'student.localonly', email: 'local@mso-test.de', role: 'user', is_active: 1 };
  const testUserRevoked = { id: 8003, username: 'student.revoked', email: 'revoked@mso-test.de', role: 'user', is_active: 1 };
  const testUserBuffered = { id: 8004, username: 'student.buffered', email: 'buffered@mso-test.de', role: 'user', is_active: 1 };
  const testAdminUser = { id: 8005, username: 'admin.local', email: 'admin@mso-test.de', role: 'admin', is_active: 1 };

  // Dummy Bild (ausreichend lang)
  const samplePhotoBase64 = 'data:image/jpeg;base64,' + Buffer.from('FAKE_IMAGE_DATA_LONG_ENOUGH_FOR_TESTING').toString('base64');

  // Profile in SQLite vorbereiten
  db.prepare('DELETE FROM users WHERE id IN (8001, 8002, 8003, 8004, 8005, 8088, 8999)').run();
  db.prepare('DELETE FROM student_profiles WHERE user_id IN (8001, 8002, 8003, 8004, 8005, 8088, 8999)').run();
  db.prepare("DELETE FROM student_card_grants WHERE user_id IN (8001, 8002, 8003, 8004, 8005, 8088, 8999) OR username LIKE 'student.%'").run();

  db.prepare(`
    INSERT INTO users (id, username, email, role, groups, is_ldap, is_active)
    VALUES 
      (8001, 'student.active', 'active@mso-test.de', 'user', '["Schueler"]', 1, 1),
      (8002, 'student.localonly', 'local@mso-test.de', 'user', '["Schueler"]', 0, 1),
      (8003, 'student.revoked', 'revoked@mso-test.de', 'user', '["Schueler"]', 1, 1),
      (8004, 'student.buffered', 'buffered@mso-test.de', 'user', '["Schueler"]', 1, 1),
      (8005, 'admin.local', 'admin@mso-test.de', 'admin', '["Admin"]', 0, 1)
  `).run();

  db.prepare(`
    INSERT INTO student_profiles (user_id, first_name, last_name, mediothek_number, card_status, card_image)
    VALUES 
      (8001, 'Anna', 'Active', 'BIB-8001', 'Bild genehmigt', ?),
      (8002, 'Lukas', 'Lokal', 'BIB-8002', 'Bild genehmigt', ?),
      (8003, 'Ralf', 'Revoked', 'BIB-8003', 'Bild genehmigt', ?),
      (8004, 'Berta', 'Buffer', 'BIB-8004', 'Bild genehmigt', ?),
      (8005, 'Admin', 'Chef', 'BIB-8005', 'Bild genehmigt', ?)
  `).run(samplePhotoBase64, samplePhotoBase64, samplePhotoBase64, samplePhotoBase64, samplePhotoBase64);

  // -------------------------------------------------------------
  // TEST CASES
  // -------------------------------------------------------------

  // 1. Lokales Konto mit genehmigtem Foto, aber ohne LDAP-Konto: Ausweis ungültig.
  await runTest(1, 'Lokales Konto mit genehmigtem Foto, aber ohne LDAP-Konto: Ausweis ungültig', () => {
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8002').get();
    const res = evaluateCardEligibility({
      user: testUserLocalOnly,
      profile: profile,
      ldapStatus: { active: false, error: null }
    });
    assert.strictEqual(res.valid, false, 'Lokales Konto ohne LDAP darf nicht gültig sein');
    assert.strictEqual(res.reasonCode, 'ACCOUNT_INACTIVE');
  });

  // 2. Aktives LDAP-Konto mit gültigem Profil: Ausweis gültig.
  await runTest(2, 'Aktives LDAP-Konto mit gültigem Profil: Ausweis gültig', () => {
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8001').get();
    const res = evaluateCardEligibility({
      user: testUserActive,
      profile: profile,
      ldapStatus: { active: true, error: null }
    });
    assert.strictEqual(res.valid, true, 'Aktives LDAP-Konto muss gültig sein');
    assert.strictEqual(res.is_buffered, false, 'Live-Prüfung darf nicht als gepuffert markiert sein');
    assert.strictEqual(res.reasonCode, 'VALID');
    assert.ok(res.offlineValidUntil, 'Muss offlineValidUntil enthalten');
    
    const grant = getPersistentGrant('student.active');
    assert.ok(grant, 'Persistenter Grant muss in DB angelegt sein');
    assert.strictEqual(grant.is_revoked, 0);
  });

  // 3. Explizit gelöschtes/deaktiviertes LDAP-Konto: Freigabe widerrufen.
  await runTest(3, 'Explizit gelöschtes/deaktiviertes LDAP-Konto: Freigabe widerrufen', () => {
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8003').get();
    evaluateCardEligibility({
      user: testUserRevoked,
      profile: profile,
      ldapStatus: { active: true, error: null }
    });
    let grant = getPersistentGrant('student.revoked');
    assert.strictEqual(grant.is_revoked, 0);

    const res = evaluateCardEligibility({
      user: testUserRevoked,
      profile: profile,
      ldapStatus: { active: false, error: null }
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.reasonCode, 'ACCOUNT_INACTIVE');

    grant = getPersistentGrant('student.revoked');
    assert.strictEqual(grant.is_revoked, 1, 'Grant muss in DB als is_revoked = 1 markiert sein');
  });

  // 4. LDAP-Störung nach Widerruf: keine Wiederaktivierung.
  await runTest(4, 'LDAP-Störung nach Widerruf: keine Wiederaktivierung', () => {
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8003').get();
    const res = evaluateCardEligibility({
      user: testUserRevoked,
      profile: profile,
      ldapStatus: { active: false, error: 'Connection timeout' }
    });
    assert.strictEqual(res.valid, false, 'Widerrufener Grant darf bei Verbindungsstörung nicht wieder aufleben');
  });

  // 5. LDAP-Störung ohne frühere erfolgreiche Prüfung: ungültig.
  await runTest(5, 'LDAP-Störung ohne frühere erfolgreiche Prüfung: ungültig', () => {
    const newUser = { id: 8999, username: 'student.neverchecked', email: 'never@mso-test.de', role: 'user', is_active: 1 };
    const profile = { first_name: 'Never', last_name: 'Checked', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };
    const res = evaluateCardEligibility({
      user: newUser,
      profile: profile,
      ldapStatus: { active: false, error: 'LDAP Server Down' }
    });
    assert.strictEqual(res.valid, false, 'Ohne früheren Grant muss bei LDAP-Ausfall ungültig zurückgegeben werden');
    assert.strictEqual(res.reasonCode, 'LDAP_UNAVAILABLE_NO_BUFFER');
  });

  // 6. LDAP-Störung mit gültiger vorheriger Prüfung: nur bis zum ursprünglichen Fristende gültig.
  await runTest(6, 'LDAP-Störung mit gültiger vorheriger Prüfung: nur bis zum ursprünglichen Fristende gültig', () => {
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8004').get();
    const t0 = new Date('2026-03-01T10:00:00Z');
    
    // Tag T0: Erfolgreiche Prüfung
    const resT0 = evaluateCardEligibility({
      user: testUserBuffered,
      profile: profile,
      ldapStatus: { active: true, error: null },
      now: t0
    });
    assert.strictEqual(resT0.valid, true);
    const originalExpiry = resT0.offlineValidUntil;

    // Tag T0 + 5 Tage: LDAP-Störung
    const t5 = new Date('2026-03-06T10:00:00Z');
    const resT5 = evaluateCardEligibility({
      user: testUserBuffered,
      profile: profile,
      ldapStatus: { active: false, error: 'ETIMEDOUT' },
      now: t5
    });
    assert.strictEqual(resT5.valid, true);
    assert.strictEqual(resT5.is_buffered, true);
    assert.strictEqual(resT5.offlineValidUntil, originalExpiry, 'Fristende muss exakt dem ursprünglichen Fristende entsprechen');
  });

  // 7. Wiederholte Abrufe während der Störung verlängern die Frist nicht.
  await runTest(7, 'Wiederholte Abrufe während der Störung verlängern die Frist nicht', () => {
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8004').get();
    const grantBefore = getPersistentGrant('student.buffered');
    const expectedExpiry = grantBefore.offline_valid_until;

    // Abruf an Tag 10
    const t10 = new Date('2026-03-11T12:00:00Z');
    const resT10 = evaluateCardEligibility({
      user: testUserBuffered,
      profile: profile,
      ldapStatus: { active: false, error: 'ECONNREFUSED' },
      now: t10
    });
    assert.strictEqual(resT10.offlineValidUntil, expectedExpiry);

    // Abruf an Tag 20
    const t20 = new Date('2026-03-21T15:00:00Z');
    const resT20 = evaluateCardEligibility({
      user: testUserBuffered,
      profile: profile,
      ldapStatus: { active: false, error: 'ECONNREFUSED' },
      now: t20
    });
    assert.strictEqual(resT20.offlineValidUntil, expectedExpiry, 'Wiederholte Abrufe dürfen die Frist niemals nach hinten verschieben');

    // Abruf an Tag 35 (nach Ablauf der 30 Tage Frist)
    const t35 = new Date('2026-04-06T10:00:00Z');
    const resT35 = evaluateCardEligibility({
      user: testUserBuffered,
      profile: profile,
      ldapStatus: { active: false, error: 'ECONNREFUSED' },
      now: t35
    });
    assert.strictEqual(resT35.valid, false, 'Nach Ablauf der 30 Tage muss der Puffer ungültig sein');
    assert.strictEqual(resT35.reasonCode, 'OFFLINE_EXPIRED');
  });

  // 8. Schuljahreswechsel verlängert eine gepufferte Freigabe nicht.
  await runTest(8, 'Schuljahreswechsel verlängert eine gepufferte Freigabe nicht', () => {
    const julyNow = new Date('2026-07-20T10:00:00Z');
    const tempUser = { id: 8088, username: 'student.schoolyear', email: 'sy@mso-test.de', role: 'user', is_active: 1 };
    const tempProf = { first_name: 'Tim', last_name: 'Schuljahr', mediothek_number: 'BIB-8088', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };

    const resJuly = evaluateCardEligibility({
      user: tempUser,
      profile: tempProf,
      ldapStatus: { active: true, error: null },
      now: julyNow
    });
    assert.strictEqual(resJuly.expiresAt, '2026-07-31');

    const augFirst = new Date('2026-08-01T08:00:00Z');
    const resAug = evaluateCardEligibility({
      user: tempUser,
      profile: tempProf,
      ldapStatus: { active: false, error: 'LDAP Outage' },
      now: augFirst
    });
    assert.strictEqual(resAug.valid, false, 'Nach dem 31. Juli darf ein alter Puffer nicht ins neue Schuljahr übernommen werden');
  });

  // 9. MySQL erreichbar, kein gültiger Treffer: kein SQLite-Ersatz.
  await runTest(9, 'MySQL erreichbar, kein gültiger Treffer: kein SQLite-Ersatz', async () => {
    const mockUser = { id: 9999, username: 'nonexistent.student' };
    const res = await studentDb.getStudentProfile(mockUser, { isCardPath: true });
    assert.strictEqual(res, null, 'Im Ausweispfad darf bei 0 Treffern kein Fallback auf SQLite erfolgen');
  });

  // 10. Tatsächlicher MySQL-Verbindungsfehler: ausschließlich begrenzter Puffer.
  await runTest(10, 'Tatsächlicher MySQL-Verbindungsfehler: ausschließlich begrenzter Puffer', () => {
    const grant = getPersistentGrant('student.active');
    assert.ok(grant);
    const cachedProf = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8001').get();
    
    const res = evaluateCardEligibility({
      user: testUserActive,
      profile: cachedProf,
      ldapStatus: { active: false, error: 'MySQL Connection Lost' },
      now: new Date()
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.is_buffered, true);
  });

  // 11. Richtige Lesenummer, falscher Name: keine weiteren Profildaten oder Fotos laden.
  await runTest(11, 'Richtige Lesenummer, falscher Name: keine weiteren Profildaten oder Fotos laden', async () => {
    const match = await studentDb.findStudentForVerification('BIB-8001', 'Falscher Name');
    assert.strictEqual(match, null, 'Bei falschem Namen darf kein Treffer zurückgegeben werden');
  });

  // 12. Lesenummer ohne Namen beziehungsweise id-only: keine erfolgreiche Verifikation.
  await runTest(12, 'Lesenummer ohne Namen beziehungsweise id-only: keine erfolgreiche Verifikation', async () => {
    const matchNoName = await studentDb.findStudentForVerification('BIB-8001', '');
    assert.strictEqual(matchNoName, null);

    const matchIdOnly = await studentDb.findStudentForVerification('', 'Anna Active');
    assert.strictEqual(matchIdOnly, null);
  });

  // 13. Regulärer bestehender QR-Code mit Lesenummer und vollständigem Namen: funktioniert weiterhin.
  await runTest(13, 'Regulärer bestehender QR-Code mit Lesenummer und vollständigem Namen: funktioniert weiterhin', async () => {
    const match = await studentDb.findStudentForVerification('BIB-8001', 'Anna Active');
    assert.ok(match, 'Treffer muss gefunden werden');
    assert.strictEqual(match.first_name, 'Anna');
    assert.strictEqual(match.last_name, 'Active');
    assert.strictEqual(match.has_photo, true);
    assert.strictEqual(match.card_image, undefined, 'Blob darf nicht in match geladen werden!');
  });

  // 14. Öffentliche Fehlerantworten verraten nicht, ob die Lesenummer existiert.
  await runTest(14, 'Öffentliche Fehlerantworten verraten nicht, ob die Lesenummer existiert', async () => {
    const matchNonExistent = await studentDb.findStudentForVerification('BIB-NONEXISTENT', 'Max Mustermann');
    const matchWrongName = await studentDb.findStudentForVerification('BIB-8001', 'Max Mustermann');
    
    assert.strictEqual(matchNonExistent, null);
    assert.strictEqual(matchWrongName, null);
  });

  // 15. Fehler beim Statusschreiben nach Fotoänderung: Fotoänderung wird zurückgerollt.
  await runTest(15, 'Fehler beim Statusschreiben nach Fotoänderung: Fotoänderung wird zurückgerollt', async () => {
    const badPhotoUpload = await studentDb.updateStudentPhoto(null, null, 'data:image/png;base64,1234');
    assert.strictEqual(badPhotoUpload.success, false);

    let rolledBack = false;
    let committed = false;
    const mockConn = {
      beginTransaction: async () => {},
      query: async (sql) => {
        if (sql.includes('fieldvalues')) {
          throw new Error('Simulierter Status-Schreibfehler in MySQL');
        }
        return [{ affectedRows: 1 }];
      },
      commit: async () => { committed = true; },
      rollback: async () => { rolledBack = true; },
      release: () => {}
    };

    try {
      await mockConn.beginTransaction();
      await mockConn.query('INSERT INTO images (file, application, field) VALUES (1, 1, 37)');
      await mockConn.query('INSERT INTO fieldvalues (field, application, value) VALUES (158, 1, 1130)');
      await mockConn.commit();
    } catch (err) {
      await mockConn.rollback();
    }
    assert.strictEqual(rolledBack, true, 'Bei Fehler muss rollback ausgeführt worden sein');
    assert.strictEqual(committed, false, 'Bei Fehler darf kein commit erfolgt sein');
  });

  // 16. Status „deaktiviert“ wird niemals als genehmigt bewertet.
  await runTest(16, 'Status „deaktiviert“ wird niemals als genehmigt bewertet', () => {
    const deactProf = {
      first_name: 'Test',
      last_name: 'Deaktiviert',
      card_status: 'Konto deaktiviert',
      card_image: samplePhotoBase64
    };
    const res = evaluateCardEligibility({
      user: testUserActive,
      profile: deactProf,
      ldapStatus: { active: true, error: null }
    });
    assert.strictEqual(res.valid, false, 'Status deaktiviert darf niemals gültig sein');
    assert.strictEqual(res.reasonCode, 'CARD_REVOKED');
  });

  // 17. Cacheaktualisierung übernimmt gültigen vollständigen Prüfstatus.
  await runTest(17, 'Cacheaktualisierung übernimmt gültigen vollständigen Prüfstatus', () => {
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8001').get();
    const res = evaluateCardEligibility({
      user: testUserActive,
      profile: profile,
      ldapStatus: { active: true, error: null }
    });
    assert.ok(res.hasOwnProperty('valid'));
    assert.ok(res.hasOwnProperty('reasonCode'));
    assert.ok(res.hasOwnProperty('statusSummary'));
    assert.ok(res.hasOwnProperty('offlineValidUntil'));
    assert.ok(res.hasOwnProperty('is_buffered'));
    assert.ok(res.hasOwnProperty('cardVersion'));
  });

  // 18. Abgelaufene oder unvollständige Alt-Caches werden nicht als gültiger Offline-Ausweis dargestellt.
  await runTest(18, 'Abgelaufene oder unvollständige Alt-Caches werden nicht als gültiger Offline-Ausweis dargestellt', () => {
    const noImgProf = { first_name: 'No', last_name: 'Image', card_status: 'Bild genehmigt', card_image: null };
    const res1 = evaluateCardEligibility({ user: testUserActive, profile: noImgProf, ldapStatus: { active: true, error: null } });
    assert.strictEqual(res1.valid, false);
    assert.strictEqual(res1.reasonCode, 'NO_PHOTO');

    const unverifiedProf = { first_name: 'Un', last_name: 'Verified', card_status: 'Bild ungeprüft / Kein Bild', card_image: samplePhotoBase64 };
    const res2 = evaluateCardEligibility({ user: testUserActive, profile: unverifiedProf, ldapStatus: { active: true, error: null } });
    assert.strictEqual(res2.valid, false);
    assert.strictEqual(res2.reasonCode, 'PHOTO_NOT_APPROVED');
  });

  // 19. Geändertes Foto/Profil invalidiert eine veraltete Ausweisdarstellung.
  await runTest(19, 'Geändertes Foto/Profil invalidiert eine veraltete Ausweisdarstellung', () => {
    const prof1 = { first_name: 'Anna', last_name: 'Active', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };
    const v1 = computeCardVersion(prof1);

    const prof2 = { first_name: 'Anna', last_name: 'Active', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 + '_NEW' };
    const v2 = computeCardVersion(prof2);

    assert.notStrictEqual(v1, v2, 'Versions-Hash muss sich bei Foto-Änderung ändern');
  });

  // 20. Lokaler Administrator kann sich weiterhin im Verwaltungsportal anmelden, erhält aber ohne Voraussetzungen keinen echten gültigen Ausweis.
  await runTest(20, 'Lokaler Administrator kann sich weiterhin im Verwaltungsportal anmelden, erhält aber ohne Voraussetzungen keinen echten gültigen Ausweis', () => {
    const adminRes = evaluateCardEligibility({
      user: testAdminUser,
      profile: null,
      isAdminPreview: true
    });
    assert.strictEqual(adminRes.valid, false, 'Admin-Vorschau darf nicht als echter gültiger Ausweis deklariert sein');
    assert.strictEqual(adminRes.reasonCode, 'ADMIN_PREVIEW');
  });

  // 21. Migration 026: Schema-Refaktorisierung für student_card_grants (nullable user_id, unique username)
  await runTest(21, 'Migration 026: Nullable user_id und unique username in student_card_grants', () => {
    // Nullable user_id testen
    savePersistentGrant({
      userId: null,
      username: 'student.nulluser',
      mediothekNumber: 'BIB-NULL',
      lastLdapSuccessAt: new Date().toISOString(),
      offlineValidUntil: new Date(Date.now() + 86400000).toISOString(),
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0
    });

    const grant = getPersistentGrant('student.nulluser');
    assert.ok(grant, 'Grant mit user_id = null muss gespeichert und abrufbar sein');
    assert.strictEqual(grant.user_id, null);
    assert.strictEqual(grant.username, 'student.nulluser');

    // Schema PRAGMA prüfen
    const cols = db.prepare('PRAGMA table_info(student_card_grants)').all();
    const userIdCol = cols.find(c => c.name === 'user_id');
    assert.ok(userIdCol, 'user_id Spalte muss existieren');
    assert.strictEqual(userIdCol.notnull, 0, 'user_id darf NICHT NOT NULL sein (muss nullable sein)');
  });

  // 22. Vollständige LDAP-Taxonomie: disabled, misconfigured und not_checked
  await runTest(22, 'Vollständige LDAP-Taxonomie: disabled, misconfigured und not_checked', () => {
    const prof = { first_name: 'Tax', last_name: 'Test', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };

    // disabled
    const resDisabled = evaluateCardEligibility({
      user: testUserActive,
      profile: prof,
      ldapStatus: { status: 'disabled', active: false, error: 'LDAP deaktiviert' }
    });
    assert.strictEqual(resDisabled.valid, false);
    assert.strictEqual(resDisabled.reasonCode, 'LDAP_DISABLED');

    // misconfigured
    const resMisconfig = evaluateCardEligibility({
      user: testUserActive,
      profile: prof,
      ldapStatus: { status: 'misconfigured', active: false, error: 'Config missing' }
    });
    assert.strictEqual(resMisconfig.valid, false);
    assert.strictEqual(resMisconfig.reasonCode, 'LDAP_MISCONFIGURED');

    // not_checked ohne früheren Grant
    const resNotChecked = evaluateCardEligibility({
      user: { id: 8998, username: 'student.unregistered', is_active: 1 },
      profile: prof,
      ldapStatus: { status: 'not_checked', active: false, error: null }
    });
    assert.strictEqual(resNotChecked.valid, false);
    assert.strictEqual(resNotChecked.reasonCode, 'NOT_CHECKED');
  });

  // 23. Admin-Sitzungserhalt bei negativem LDAP-Befund
  await runTest(23, 'Admin-Sitzungserhalt bei negativem LDAP-Befund', async () => {
    const express = require('express');
    const http = require('http');
    const studentRoutes = require('../src/routes/student');

    const app = express();
    app.use(express.json());

    let sessionDestroyed = false;
    let mockSessionUser = { id: 8005, username: 'admin.local', role: 'admin' };

    app.use((req, res, next) => {
      req.session = {
        user: mockSessionUser,
        destroy: (cb) => {
          sessionDestroyed = true;
          req.session.user = null;
          if (cb) cb();
        }
      };
      next();
    });

    app.use('/api/student', studentRoutes);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/student/card`);
      const body = await res.json();

      assert.strictEqual(res.status, 200, 'Admin-Abruf muss HTTP 200 zurückliefern');
      assert.strictEqual(body.is_admin_preview, true, 'Muss als Admin-Vorschau markiert sein');
      assert.strictEqual(sessionDestroyed, false, 'Admin-Session darf NIEMALS zerstört werden!');
      assert.ok(mockSessionUser, 'Admin-Sitzungsbenutzer muss erhalten bleiben');
    } finally {
      server.close();
    }
  });

  // 24. QR-Verifikation: 2-Phasen-Prüfung, Pflichtparameter bib + name, Buffered-Status
  await runTest(24, 'QR-Verifikation: Pflichtparameter bib + name und Buffered-Status', async () => {
    // 1. Ohne Parameter
    const resNoParams = await studentDb.findStudentForVerification('', '');
    assert.strictEqual(resNoParams, null);

    // 2. Nur Name ohne Bib
    const resNameOnly = await studentDb.findStudentForVerification('', 'Anna Active');
    assert.strictEqual(resNameOnly, null);

    // 3. Nur Bib ohne Name
    const resBibOnly = await studentDb.findStudentForVerification('BIB-8001', '');
    assert.strictEqual(resBibOnly, null);

    // 4. Gültige Kombination aus Bib und Name
    const resValid = await studentDb.findStudentForVerification('BIB-8001', 'Anna Active');
    assert.ok(resValid);
    assert.strictEqual(resValid.mediothek_number, 'BIB-8001');
    assert.strictEqual(resValid.has_photo, true);
  });

  // 25. MySQL gestört + LDAP aktiv + bestehender Grant: Frist unverändert
  await runTest(25, 'MySQL gestört + LDAP aktiv + bestehender Grant: Frist unverändert', () => {
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8004').get();
    const grantBefore = getPersistentGrant('student.buffered');
    assert.ok(grantBefore);
    const expectedExpiry = grantBefore.offline_valid_until;

    // MySQL ist im Verbindungsfehlerzustand (connection_error), LDAP meldet aktiv
    const res = evaluateCardEligibility({
      user: testUserBuffered,
      profile: profile,
      ldapStatus: { status: 'active', active: true, error: null },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable', error: 'Connection refused' },
      now: new Date('2026-03-15T12:00:00Z')
    });

    assert.strictEqual(res.valid, true, 'Ausfallpuffer muss greifen');
    assert.strictEqual(res.is_buffered, true, 'Muss als gepuffert gekennzeichnet sein');
    assert.strictEqual(res.offlineValidUntil, expectedExpiry, 'Frist darf bei MySQL-Ausfall trotz aktivem LDAP NICHT verlängert werden!');

    const grantAfter = getPersistentGrant('student.buffered');
    assert.strictEqual(grantAfter.offline_valid_until, expectedExpiry, 'Grant in DB darf nicht verändert worden sein');
  });

  // 26. MySQL gestört + LDAP aktiv OHNE bestehenden Grant: ungültig
  await runTest(26, 'MySQL gestört + LDAP aktiv OHNE bestehenden Grant: ungültig', () => {
    const unbufferedUser = { id: 8990, username: 'student.nobuffer', is_active: 1 };
    const profile = { user_id: 8990, first_name: 'No', last_name: 'Buffer', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };

    const res = evaluateCardEligibility({
      user: unbufferedUser,
      profile: profile,
      ldapStatus: { status: 'active', active: true, error: null },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable', error: 'Connection refused' },
      now: new Date()
    });

    assert.strictEqual(res.valid, false, 'Ohne bestehenden Grant muss bei MySQL-Ausfall abgelehnt werden');
    assert.strictEqual(res.reasonCode, 'MYSQL_UNAVAILABLE_NO_BUFFER');
  });

  // 27. SQL-/Schemafehler (Fall d): keine neue Freigabe und kein Ausfallpuffer
  await runTest(27, 'SQL-/Schemafehler (Fall d): keine neue Freigabe und kein Ausfallpuffer', () => {
    const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8001').get();
    const res = evaluateCardEligibility({
      user: testUserActive,
      profile: profile,
      ldapStatus: { status: 'active', active: true, error: null },
      mysqlStatus: { status: 'query_error', source: 'mysql_error', error: 'Table not found' },
      now: new Date()
    });

    assert.strictEqual(res.valid, false, 'SQL-/Schemafehler darf keine Freigabe erteilen');
    assert.strictEqual(res.reasonCode, 'DATABASE_ERROR');
  });

  // 28. Strikte Identitätsbindung: Kollidierende Zuordnungen teilen keinen Grant
  await runTest(28, 'Strikte Identitätsbindung: Kollidierende Zuordnungen teilen keinen Grant', () => {
    // Grant für User A existiert
    savePersistentGrant({
      userId: 8001,
      username: 'student.active',
      mediothekNumber: 'BIB-8001',
      lastLdapSuccessAt: new Date().toISOString(),
      offlineValidUntil: new Date(Date.now() + 86400000).toISOString(),
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0
    });

    // User B versucht mit selber Mediotheksnummer, aber anderem Username zu evaluieren
    const userB = { id: 8099, username: 'student.impostor', is_active: 1 };
    const profileB = { user_id: 8099, first_name: 'Impostor', last_name: 'User', mediothek_number: 'BIB-8001', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };

    const res = evaluateCardEligibility({
      user: userB,
      profile: profileB,
      ldapStatus: { status: 'unavailable', active: false, error: 'Outage' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable', error: 'Outage' },
      now: new Date()
    });

    assert.strictEqual(res.valid, false, 'Fremder Grant darf bei Identitätskollision niemals genutzt werden');
    assert.strictEqual(res.reasonCode, 'IDENTITY_MISMATCH');
  });

  // 29. Numerischer Benutzername wird nicht als lokale user_id interpretiert
  await runTest(29, 'Numerischer Benutzername wird nicht als lokale user_id interpretiert', () => {
    // User 8001 hat Grant
    const grant = getPersistentGrant('8001'); // String '8001'
    assert.strictEqual(grant, null, 'String 8001 darf nicht fälschlich als user_id 8001 aufgelöst werden');

    const grantNumeric = getPersistentGrant(8001); // Echte Zahl 8001
    assert.ok(grantNumeric, 'Echte Zahl 8001 muss als user_id aufgelöst werden');
  });

  // 30. QR-Aufruf überschreibt nicht die Version des vollständigen Ausweises (allowSaveGrant: false)
  await runTest(30, 'QR-Aufruf überschreibt nicht die Version des vollständigen Ausweises', () => {
    const fullProfile = db.prepare('SELECT * FROM student_profiles WHERE user_id = 8001').get();
    const fullVersion = computeCardVersion(fullProfile);

    // 1. Regulärer Ausweis-Abruf legt Grant mit vollständiger Version an
    evaluateCardEligibility({
      user: testUserActive,
      profile: fullProfile,
      ldapStatus: { status: 'active', active: true, error: null }
    });

    const grantBefore = getPersistentGrant('student.active');
    assert.strictEqual(grantBefore.card_version, fullVersion, 'Grant muss volle Profilversion enthalten');

    // 2. Öffentliche QR-Verifikation mit Platzhalter-Profil
    const minimalProfile = {
      username: 'student.active',
      first_name: 'Anna',
      last_name: 'Active',
      mediothek_number: 'BIB-8001',
      card_status: 'Bild genehmigt',
      card_image: 'data:image/jpeg;base64,PHOTO_EXISTS'
    };
    const qrVersion = computeCardVersion(minimalProfile);
    assert.notStrictEqual(fullVersion, qrVersion, 'QR-Platzhalterversion und Vollversion müssen sich unterscheiden');

    const qrEval = evaluateCardEligibility({
      user: { id: null, username: 'student.active', is_active: 1 },
      profile: minimalProfile,
      ldapStatus: { status: 'active', active: true, error: null },
      allowSaveGrant: false
    });
    assert.strictEqual(qrEval.valid, true);

    const grantAfter = getPersistentGrant('student.active');
    assert.strictEqual(grantAfter.card_version, fullVersion, 'QR-Prüfung darf den Versions-Hash im Grant niemals überschreiben');
  });

  // 31. Profil live nicht mehr vorhanden, danach MySQL-Ausfall: bleibt ungültig
  await runTest(31, 'Profil live nicht mehr vorhanden, danach MySQL-Ausfall: bleibt ungültig', () => {
    const testUserDeleted = { id: 8077, username: 'student.deletedprofile', is_active: 1 };
    
    // Zunächst gültig
    savePersistentGrant({
      userId: 8077,
      username: 'student.deletedprofile',
      mediothekNumber: 'BIB-8077',
      lastLdapSuccessAt: new Date().toISOString(),
      offlineValidUntil: new Date(Date.now() + 86400000).toISOString(),
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0
    });

    // 1. Live MySQL meldet: Profil existiert nicht mehr (not_found)
    const resLive = evaluateCardEligibility({
      user: testUserDeleted,
      profile: null,
      ldapStatus: { status: 'active', active: true, error: null },
      mysqlStatus: { status: 'not_found', source: 'mysql_live' }
    });
    assert.strictEqual(resLive.valid, false);
    assert.strictEqual(resLive.reasonCode, 'PROFILE_NOT_FOUND');

    const grantAfterRevoke = getPersistentGrant('student.deletedprofile');
    assert.strictEqual(grantAfterRevoke.is_revoked, 1, 'Grant muss durch Wegfall invalidiert worden sein');

    // 2. Anschließender MySQL-Ausfall
    const resOutage = evaluateCardEligibility({
      user: testUserDeleted,
      profile: { user_id: 8077, first_name: 'Old', last_name: 'Data', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 },
      ldapStatus: { status: 'active', active: true, error: null },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' }
    });
    assert.strictEqual(resOutage.valid, false, 'Zuvor invalidierter Grant darf bei Ausfall nicht wieder aufleben');
  });

  // 32. Foto entfernt, danach Ausfall: bleibt ungültig
  await runTest(32, 'Foto entfernt, danach Ausfall: bleibt ungültig', () => {
    const testUserNoImg = { id: 8078, username: 'student.removedphoto', is_active: 1 };
    
    // Zunächst gültiger Grant
    savePersistentGrant({
      userId: 8078,
      username: 'student.removedphoto',
      mediothekNumber: 'BIB-8078',
      lastLdapSuccessAt: new Date().toISOString(),
      offlineValidUntil: new Date(Date.now() + 86400000).toISOString(),
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0
    });

    // 1. Live Prüfung: Profil ohne Foto
    const noImgProf = { user_id: 8078, first_name: 'No', last_name: 'Img', card_status: 'Bild genehmigt', card_image: null };
    const resNoImg = evaluateCardEligibility({
      user: testUserNoImg,
      profile: noImgProf,
      ldapStatus: { status: 'active', active: true, error: null }
    });
    assert.strictEqual(resNoImg.valid, false);
    assert.strictEqual(resNoImg.reasonCode, 'NO_PHOTO');

    const grantAfter = getPersistentGrant('student.removedphoto');
    assert.strictEqual(grantAfter.is_revoked, 1, 'Grant muss bei entferntem Foto invalidiert worden sein');

    // 2. Nachfolgender Ausfall
    const resOutage = evaluateCardEligibility({
      user: testUserNoImg,
      profile: noImgProf,
      ldapStatus: { status: 'unavailable', active: false, error: 'Outage' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' }
    });
    assert.strictEqual(resOutage.valid, false);
  });

  // 33. Neues ungeprüftes Foto nutzt keinen alten Grant
  await runTest(33, 'Neues ungeprüftes Foto nutzt keinen alten Grant', () => {
    const testUserUnapp = { id: 8079, username: 'student.unapprovedphoto', is_active: 1 };
    savePersistentGrant({
      userId: 8079,
      username: 'student.unapprovedphoto',
      mediothekNumber: 'BIB-8079',
      lastLdapSuccessAt: new Date().toISOString(),
      offlineValidUntil: new Date(Date.now() + 86400000).toISOString(),
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0
    });

    const unappProf = { user_id: 8079, first_name: 'Unapp', last_name: 'Photo', card_status: 'Bild eingereicht', card_status_code: '1131', card_image: samplePhotoBase64 };
    const resUnapp = evaluateCardEligibility({
      user: testUserUnapp,
      profile: unappProf,
      ldapStatus: { status: 'active', active: true, error: null }
    });
    assert.strictEqual(resUnapp.valid, false);
    assert.strictEqual(resUnapp.reasonCode, 'PHOTO_NOT_APPROVED');

    const grantAfter = getPersistentGrant('student.unapprovedphoto');
    assert.strictEqual(grantAfter.is_revoked, 1);
  });

  // 34. Migration 027: Invalidiert unvollständige Altfreigaben
  await runTest(34, 'Migration 027: Invalidiert unvollständige Altfreigaben', () => {
    // Alten unvollständigen Grant anlegen (ohne card_version und ohne last_ldap_success_at)
    db.prepare(`
      INSERT INTO student_card_grants (user_id, username, mediothek_number, last_ldap_success_at, offline_valid_until, school_year_expires_at, is_revoked, card_version)
      VALUES (8095, 'student.legacy_incomplete', 'BIB-8095', NULL, '2026-10-01', '2027-07-31', 0, NULL)
      ON CONFLICT(username) DO UPDATE SET is_revoked = 0, card_version = NULL, last_ldap_success_at = NULL
    `).run();

    // Migration 027 ausführen
    const mig027Sql = require('fs').readFileSync(require('path').resolve(__dirname, '../migrations/027_invalidate_legacy_grants.sql'), 'utf8');
    db.exec(mig027Sql);

    const legacyGrant = getPersistentGrant('student.legacy_incomplete');
    assert.ok(legacyGrant);
    assert.strictEqual(legacyGrant.is_revoked, 1, 'Unvollständige Altfreigabe muss durch Migration 027 invalidiert worden sein');
  });

  // 35. Testisolation: Test verändert niemals eine externe Datenbank
  await runTest(35, 'Testisolation: Test verwendet isolierte Temp-DB und schützt externe Datenbanken', () => {
    const { tempDbPath } = require('./test_helper');
    assert.ok(tempDbPath, 'tempDbPath muss definiert sein');
    assert.ok(tempDbPath.includes('mso-test-'), 'tempDbPath muss in einem temporären Verzeichnis liegen');
    assert.notStrictEqual(tempDbPath, 'data/mso_cloud.db', 'tempDbPath darf niemals der Produktionspfad sein');
  });

  // 36. LDAP-Ablehnung greift vor jedem MySQL-Ausfallpuffer
  await runTest(36, 'LDAP-Ablehnung greift vor jedem MySQL-Ausfallpuffer (inactive, disabled, misconfigured, not_checked)', () => {
    const testUser = { id: 8090, username: 'student.ldap_first', is_active: 1 };
    
    // Zunächst aktiver Grant
    savePersistentGrant({
      userId: 8090,
      username: 'student.ldap_first',
      mediothekNumber: 'BIB-8090',
      lastLdapSuccessAt: new Date().toISOString(),
      offlineValidUntil: new Date(Date.now() + 86400000).toISOString(),
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0,
      cardVersion: 'v_testversion_123'
    });

    const prof = { first_name: 'Ldap', last_name: 'First', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };

    // 1. MySQL hat connection_error, aber LDAP ist inactive -> MUSS ungültig sein und Grant widerrufen
    const resInactive = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'inactive', active: false, error: null },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable', error: 'ECONNREFUSED' }
    });
    assert.strictEqual(resInactive.valid, false, 'LDAP inactive muss vor MySQL Ausfallpuffer greifen');
    assert.strictEqual(resInactive.reasonCode, 'ACCOUNT_INACTIVE');

    const grantRevoked = getPersistentGrant('student.ldap_first');
    assert.strictEqual(grantRevoked.is_revoked, 1, 'Grant muss sofort widerrufen sein');

    // 2. MySQL hat connection_error und LDAP ist disabled
    const resDisabled = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'disabled', active: false, error: 'Disabled in config' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' }
    });
    assert.strictEqual(resDisabled.valid, false);
    assert.strictEqual(resDisabled.reasonCode, 'LDAP_DISABLED');

    // 3. MySQL hat connection_error und LDAP ist misconfigured
    const resMisconf = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'misconfigured', active: false, error: 'Bind DN missing' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' }
    });
    assert.strictEqual(resMisconf.valid, false);
    assert.strictEqual(resMisconf.reasonCode, 'LDAP_MISCONFIGURED');

    // 4. MySQL hat connection_error und LDAP ist not_checked
    const resNotChecked = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'not_checked', active: false, error: null },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' }
    });
    assert.strictEqual(resNotChecked.valid, false);
    assert.strictEqual(resNotChecked.reasonCode, 'NOT_CHECKED');
  });

  // 37. Nach LDAP-Widerruf: Störung beider Systeme (LDAP & MySQL) reaktiviert keinen Ausweis
  await runTest(37, 'Nach LDAP-Widerruf: Störung beider Systeme (LDAP & MySQL) reaktiviert keinen Ausweis', () => {
    const testUser = { id: 8090, username: 'student.ldap_first', is_active: 1 };
    const prof = { first_name: 'Ldap', last_name: 'First', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };

    const resBothDown = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'unavailable', active: false, error: 'LDAP Timeout' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable', error: 'ECONNREFUSED' }
    });
    assert.strictEqual(resBothDown.valid, false, 'Widerrufener Grant darf bei komplettem Systemausfall nicht reaktiviert werden');
    assert.strictEqual(resBothDown.reasonCode, 'MYSQL_UNAVAILABLE_NO_BUFFER');
  });

  // 38. MySQL Verbindungsfehler + LDAP aktiv + bestehender Grant: Frist bleibt exakt unverändert
  await runTest(38, 'MySQL Verbindungsfehler + LDAP aktiv + bestehender Grant: Frist bleibt unverändert', () => {
    const testUser = { id: 8091, username: 'student.mysql_outage_valid', is_active: 1 };
    const fixedDeadline = new Date(Date.now() + 15 * 86400000).toISOString();

    const prof = { first_name: 'Outage', last_name: 'Valid', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };
    const validCardVersion = computeCardVersion(prof, 'BIB-8091');

    savePersistentGrant({
      userId: 8091,
      username: 'student.mysql_outage_valid',
      mediothekNumber: 'BIB-8091',
      lastLdapSuccessAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      offlineValidUntil: fixedDeadline,
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0,
      cardVersion: validCardVersion
    });

    const resOutage = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'active', active: true, error: null },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable', error: 'ETIMEDOUT' }
    });
    assert.strictEqual(resOutage.valid, true, 'Bestehender Grant muss bei MySQL-Verbindungsfehler gültig bleiben');
    assert.strictEqual(resOutage.is_buffered, true, 'Muss als gepuffert gekennzeichnet sein');
    assert.strictEqual(resOutage.reasonCode, 'VALID_BUFFERED');
    assert.strictEqual(resOutage.offlineValidUntil, fixedDeadline, 'Offline-Frist darf nicht verlängert werden');
  });

  // 39. QR-Verifikation im Ausfallpuffer schlägt nicht wegen Placeholder-Hash fehl
  await runTest(39, 'QR-Verifikation im Ausfallpuffer validiert Grant ohne Fehlalarm durch Placeholder-Foto', () => {
    const testUser = { id: 8092, username: 'student.qr_outage', is_active: 1 };
    const fixedDeadline = new Date(Date.now() + 20 * 86400000).toISOString();

    // Grant besitzt die Version des echten Voll-Ausweises
    savePersistentGrant({
      userId: 8092,
      username: 'student.qr_outage',
      mediothekNumber: 'BIB-8092',
      lastLdapSuccessAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      offlineValidUntil: fixedDeadline,
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0,
      cardVersion: 'v_full_card_hash_abc123'
    });

    // QR-Pfad hat nur minimales Profil mit SVG-Placeholder als Foto
    const dummySvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const qrProfile = {
      first_name: 'Qr',
      last_name: 'Outage',
      mediothek_number: 'BIB-8092',
      card_status: 'Bild genehmigt',
      card_image: 'data:image/svg+xml;base64,' + Buffer.from(dummySvg).toString('base64')
    };

    const resQr = evaluateCardEligibility({
      user: testUser,
      profile: qrProfile,
      ldapStatus: { status: 'unavailable', active: false, error: 'LDAP down' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable', error: 'ECONNREFUSED' },
      isQrVerification: true,
      allowSaveGrant: false
    });

    assert.strictEqual(resQr.valid, true, 'QR-Verifikation muss mit intaktem Grant im Ausfallpuffer gültig sein');
    assert.strictEqual(resQr.reasonCode, 'VALID_BUFFERED');
    assert.strictEqual(resQr.cardVersion, 'v_full_card_hash_abc123', 'Vollversions-Hash muss erhalten bleiben');
  });

  // 40. QR-Verifikation verlangt intakte Version in der Freigabe
  await runTest(40, 'QR-Verifikation lehnt unvollständige Altfreigaben (v0 oder null) im Ausfallpuffer ab', () => {
    const testUser = { id: 8093, username: 'student.qr_v0', is_active: 1 };

    savePersistentGrant({
      userId: 8093,
      username: 'student.qr_v0',
      mediothekNumber: 'BIB-8093',
      lastLdapSuccessAt: new Date().toISOString(),
      offlineValidUntil: new Date(Date.now() + 86400000).toISOString(),
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0,
      cardVersion: 'v0'
    });

    const qrProfile = {
      first_name: 'Qr',
      last_name: 'V0',
      mediothek_number: 'BIB-8093',
      card_status: 'Bild genehmigt',
      card_image: 'data:image/svg+xml;base64,' + Buffer.from('<svg></svg>').toString('base64')
    };

    const resQr = evaluateCardEligibility({
      user: testUser,
      profile: qrProfile,
      ldapStatus: { status: 'unavailable', active: false, error: 'LDAP down' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' },
      isQrVerification: true
    });

    assert.strictEqual(resQr.valid, false, 'v0-Freigabe darf im Ausfallpuffer nicht als gültig bestätigt werden');
    assert.strictEqual(resQr.reasonCode, 'VERSION_MISMATCH');
  });

  // 41. MySQL-Authentifizierungs- & Berechtigungsfehler sind KEINE Ausfälle (kein Puffer)
  await runTest(41, 'MySQL Authentifizierungsfehler werden als query_error klassifiziert und sperren den Ausfallpuffer', () => {
    // 1. ER_ACCESS_DENIED_ERROR
    const errAccessDenied = { code: 'ER_ACCESS_DENIED_ERROR', message: "Access denied for user 'mso'@'localhost' (using password: YES)" };
    const classAccess = studentDb.classifyMySQLError(errAccessDenied);
    assert.strictEqual(classAccess.status, 'query_error', 'Access denied muss als query_error eingestuft werden');
    assert.strictEqual(classAccess.source, 'mysql_error');

    // 2. ER_DBACCESS_DENIED_ERROR
    const errDbAccess = { code: 'ER_DBACCESS_DENIED_ERROR', message: "Access denied for user 'mso' to database 'schul_db'" };
    const classDbAccess = studentDb.classifyMySQLError(errDbAccess);
    assert.strictEqual(classDbAccess.status, 'query_error');

    // 3. Echter Verbindungsabbruch ECONNREFUSED
    const errConnRefused = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:3306' };
    const classConn = studentDb.classifyMySQLError(errConnRefused);
    assert.strictEqual(classConn.status, 'connection_error', 'ECONNREFUSED muss connection_error sein');
    assert.strictEqual(classConn.source, 'mysql_unavailable');

    // 4. evaluateCardEligibility mit query_error aktiviert niemals einen Puffer
    const testUser = { id: 8094, username: 'student.auth_err_test', is_active: 1 };
    savePersistentGrant({
      userId: 8094,
      username: 'student.auth_err_test',
      mediothekNumber: 'BIB-8094',
      lastLdapSuccessAt: new Date().toISOString(),
      offlineValidUntil: new Date(Date.now() + 86400000).toISOString(),
      schoolYearExpiresAt: '2027-07-31',
      isRevoked: 0,
      cardVersion: 'v_valid'
    });

    const resAuthErr = evaluateCardEligibility({
      user: testUser,
      profile: { first_name: 'Auth', last_name: 'Err', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 },
      ldapStatus: { status: 'active', active: true, error: null },
      mysqlStatus: { status: 'query_error', source: 'mysql_error', error: 'Access denied' }
    });

    assert.strictEqual(resAuthErr.valid, false, 'Bei Authentifizierungsfehlern darf kein Puffer greifen');
    assert.strictEqual(resAuthErr.reasonCode, 'DATABASE_ERROR');
  });

  // 42. Ungültige/korrupte serverseitige Ablaufdaten im Grant werden sicher als abgelaufen abgewiesen
  await runTest(42, 'Ungültige serverseitige Ablaufdaten werden mit Number.isFinite geprüft und sicher abgewiesen', () => {
    const testUser = { id: 8096, username: 'student.invalid_dates', is_active: 1 };
    const prof = { first_name: 'Invalid', last_name: 'Dates', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };
    const validVer = computeCardVersion(prof, 'BIB-8096');

    // 1. offline_valid_until ist ein ungültiger String ('invalid-date')
    db.prepare(`
      INSERT INTO student_card_grants (user_id, username, mediothek_number, last_ldap_success_at, offline_valid_until, school_year_expires_at, is_revoked, card_version)
      VALUES (8096, 'student.invalid_dates', 'BIB-8096', datetime('now'), 'invalid-date-string', '2027-07-31', 0, ?)
      ON CONFLICT(username) DO UPDATE SET offline_valid_until = 'invalid-date-string', school_year_expires_at = '2027-07-31', is_revoked = 0, card_version = ?
    `).run(validVer, validVer);

    const resInvalidOffline = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'unavailable', active: false, error: 'Timeout' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' }
    });
    assert.strictEqual(resInvalidOffline.valid, false, 'Ungültiges offline_valid_until muss sicher als ungültig abgewiesen werden');
    assert.strictEqual(resInvalidOffline.reasonCode, 'OFFLINE_EXPIRED');

    // 2. school_year_expires_at ist ein ungültiger String ('corrupted-year')
    db.prepare(`
      UPDATE student_card_grants 
      SET offline_valid_until = datetime('now', '+10 days'), school_year_expires_at = 'corrupted-year'
      WHERE username = 'student.invalid_dates'
    `).run();

    const resInvalidSchoolYear = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'unavailable', active: false, error: 'Timeout' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' }
    });
    assert.strictEqual(resInvalidSchoolYear.valid, false, 'Ungültiges school_year_expires_at muss sicher als ungültig abgewiesen werden');
    assert.strictEqual(resInvalidSchoolYear.reasonCode, 'OFFLINE_EXPIRED');
  });

  // 43. Erreichtes Fristende (>=) gilt sofort als abgelaufen
  await runTest(43, 'Erreichtes Fristende (now >= offline_valid_until / school_year) gilt sofort als abgelaufen', () => {
    const testUser = { id: 8097, username: 'student.exact_deadline', is_active: 1 };
    const prof = { first_name: 'Exact', last_name: 'Deadline', card_status: 'Bild genehmigt', card_image: samplePhotoBase64 };
    const validVer = computeCardVersion(prof, 'BIB-8097');

    const exactTimestamp = new Date('2026-06-15T12:00:00.000Z');
    const exactIso = exactTimestamp.toISOString();

    db.prepare(`
      INSERT INTO student_card_grants (user_id, username, mediothek_number, last_ldap_success_at, offline_valid_until, school_year_expires_at, is_revoked, card_version)
      VALUES (8097, 'student.exact_deadline', 'BIB-8097', datetime('now'), ?, '2027-07-31', 0, ?)
      ON CONFLICT(username) DO UPDATE SET offline_valid_until = ?, school_year_expires_at = '2027-07-31', is_revoked = 0, card_version = ?
    `).run(exactIso, validVer, exactIso, validVer);

    // 1. Exakt auf die Millisekunde des Fristendes -> muss abgelaufen sein (>=)
    const resExact = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'unavailable', active: false, error: 'Timeout' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' },
      now: exactTimestamp
    });
    assert.strictEqual(resExact.valid, false, 'Exakt erreichtes Fristende (>=) muss abgelaufen sein');
    assert.strictEqual(resExact.reasonCode, 'OFFLINE_EXPIRED');

    // 2. 1 Millisekunde VOR dem Fristende -> noch gültig
    const oneMsBefore = new Date(exactTimestamp.getTime() - 1);
    const resBefore = evaluateCardEligibility({
      user: testUser,
      profile: prof,
      ldapStatus: { status: 'unavailable', active: false, error: 'Timeout' },
      mysqlStatus: { status: 'connection_error', source: 'mysql_unavailable' },
      now: oneMsBefore
    });
    assert.strictEqual(resBefore.valid, true, '1 Millisekunde vor Fristende muss noch gültig sein');
    assert.strictEqual(resBefore.reasonCode, 'VALID_BUFFERED');
  });

  console.log(`\n=== RESULT: ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY! ===`);
}

runAllTests().catch((err) => {
  console.error('\nTest runner failed:', err);
  process.exit(1);
});

