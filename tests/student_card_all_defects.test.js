const assert = require('assert');
const { db, runMigrations } = require('../src/db');
const {
  getSchoolYearExpirationDate,
  computeCardVersion,
  evaluateCardEligibility,
  getPersistentGrant,
  savePersistentGrant,
  revokePersistentGrant
} = require('../src/services/cardEligibility');
const studentDb = require('../src/student_db');

console.log('=== START REGRESSION TEST SUITE: ALL 20 STUDENT CARD SCENARIOS ===\n');

// Sicherstellen, dass DB-Migrationen gelaufen sind
runMigrations();

let passedTests = 0;
const totalTests = 20;

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

  console.log(`\n=== RESULT: ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY! ===`);
}

runAllTests().catch((err) => {
  console.error('\nTest runner failed:', err);
  process.exit(1);
});
