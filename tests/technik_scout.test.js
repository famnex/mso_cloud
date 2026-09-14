const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { db, runMigrations } = require('../src/db');
const adminRoutes = require('../src/routes/admin');
const studentRoutes = require('../src/routes/student');

console.log('=== START TEST SUITE: TECHNIK SCOUT FEATURE ===\n');

// 1. Run migrations
runMigrations();

let passedTests = 0;

async function runTest(num, name, fn) {
  try {
    await fn();
    console.log('[PASS] Test ' + num + ': ' + name);
    passedTests++;
  } catch (err) {
    console.error('[FAIL] Test ' + num + ': ' + name);
    console.error('       Error:', err.message);
    throw err;
  }
}

// Prepare Express app for route testing
const app = express();
app.use(express.json());

// Mock session middleware for testing
let mockUser = null;
app.use((req, res, next) => {
  if (mockUser && mockUser.id) {
    const currentDbUser = db.prepare('SELECT auth_version FROM users WHERE id = ?').get(mockUser.id);
    if (currentDbUser) {
      mockUser.auth_version = currentDbUser.auth_version;
    }
  }
  req.session = {
    user: mockUser,
    destroy: (cb) => {
      req.session.user = null;
      if (cb) cb();
    }
  };
  next();
});

app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);

async function runAllTests() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = 'http://127.0.0.1:' + port;

  async function apiRequest(path, options = {}) {
    const url = baseUrl + path;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    let body = null;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = text;
    }
    return { status: res.status, body, headers: res.headers };
  }

  const samplePhotoBase64 = 'data:image/jpeg;base64,' + Buffer.from('TEST_PHOTO_SAMPLE_LONG_ENOUGH').toString('base64');

  // Clean up test data
  db.prepare('DELETE FROM users WHERE id IN (9101, 9102, 9103, 9104, 9105, 9106) OR username = ?').run('scout.newuser');
  db.prepare('DELETE FROM student_profiles WHERE user_id IN (9101, 9102, 9103, 9104, 9105, 9106)').run();
  db.prepare("DELETE FROM student_card_grants WHERE user_id IN (9101, 9102, 9103, 9104, 9105, 9106) OR username LIKE 'scout.%'").run();

  // Insert initial test users
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, groups, is_ldap, is_active, is_technik_scout)
    VALUES 
      (9101, 'scout.admin', 'admin@test.de', 'hash', 'admin', '["Admin"]', 0, 1, 0),
      (9102, 'scout.student1', 'student1@test.de', 'hash', 'user', '["Schueler"]', 1, 1, 0),
      (9103, 'scout.student2', 'student2@test.de', 'hash', 'user', '["Schueler"]', 1, 1, 1),
      (9104, 'scout.revoked', 'revoked@test.de', 'hash', 'user', '["Schueler"]', 1, 1, 1),
      (9105, 'scout.localonly', 'local@test.de', 'hash', 'user', '["Schueler"]', 0, 1, 1),
      (9106, 'scout.inactive', 'inactive@test.de', 'hash', 'user', '["Schueler"]', 1, 0, 1)
  `).run();

  db.prepare(`
    INSERT INTO student_profiles (user_id, first_name, last_name, mediothek_number, card_status, card_image)
    VALUES 
      (9102, 'Max', 'Mustermann', 'BIB-9102', 'Bild genehmigt', ?),
      (9103, 'Lisa', 'Scout', 'BIB-9103', 'Bild genehmigt', ?),
      (9104, 'Tom', 'Revoked', 'BIB-9104', 'Ausweis gesperrt', ?),
      (9105, 'Local', 'Only', 'BIB-9105', 'Bild genehmigt', ?),
      (9106, 'Ina', 'Inactive', 'BIB-9106', 'Bild genehmigt', ?)
  `).run(samplePhotoBase64, samplePhotoBase64, samplePhotoBase64, samplePhotoBase64, samplePhotoBase64);

  // Grant for student2 (valid active card)
  db.prepare(`
    INSERT INTO student_card_grants (user_id, username, is_revoked, offline_valid_until, school_year_expires_at)
    VALUES (9103, 'scout.student2', 0, datetime('now', '+30 days'), datetime('now', '+1 year'))
  `).run();

  // Grant for revoked student (is_revoked = 1)
  db.prepare(`
    INSERT INTO student_card_grants (user_id, username, is_revoked, offline_valid_until, school_year_expires_at)
    VALUES (9104, 'scout.revoked', 1, datetime('now', '-1 day'), datetime('now', '+1 year'))
  `).run();

  try {
    // =========================================================================
    // TEST 1: Default State in DB and User Creation
    // =========================================================================
    await runTest(1, 'Default State: New user has is_technik_scout = 0', async () => {
      const user1 = db.prepare('SELECT is_technik_scout FROM users WHERE id = 9102').get();
      assert.strictEqual(user1.is_technik_scout, 0, 'Default is_technik_scout should be 0');

      mockUser = { id: 9101, username: 'scout.admin', role: 'admin' };
      const res = await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: 'scout.newuser',
          email: 'new@test.de',
          password: 'SecretPassword123!',
          role: 'user',
          groups: ['Schueler']
        })
      });
      
      assert.strictEqual(res.status, 200);
      const createdUser = db.prepare("SELECT is_technik_scout FROM users WHERE username = 'scout.newuser'").get();
      assert.strictEqual(createdUser.is_technik_scout, 0, 'Newly created user without field defaults to 0');
    });

    // =========================================================================
    // TEST 2: Admin can toggle is_technik_scout via PUT /api/admin/users/:id
    // =========================================================================
    await runTest(2, 'Admin can toggle is_technik_scout to 1 and back to 0', async () => {
      mockUser = { id: 9101, username: 'scout.admin', role: 'admin' };

      // Set to 1
      const res1 = await apiRequest('/api/admin/users/9102', {
        method: 'PUT',
        body: JSON.stringify({ is_technik_scout: 1 })
      });
      assert.strictEqual(res1.status, 200);

      const userAfterSet = db.prepare('SELECT is_technik_scout FROM users WHERE id = 9102').get();
      assert.strictEqual(userAfterSet.is_technik_scout, 1, 'is_technik_scout should be updated to 1');

      // Check GET /api/admin/users returns is_technik_scout: true
      const listRes = await apiRequest('/api/admin/users');
      assert.strictEqual(listRes.status, 200);
      assert.ok(Array.isArray(listRes.body), 'Users endpoint returns array');
      const foundUser = listRes.body.find(u => u.id === 9102);
      assert.strictEqual(foundUser.is_technik_scout, true, 'Admin list should return is_technik_scout: true');

      // Set back to 0
      const res2 = await apiRequest('/api/admin/users/9102', {
        method: 'PUT',
        body: JSON.stringify({ is_technik_scout: 0 })
      });
      assert.strictEqual(res2.status, 200);

      const userAfterReset = db.prepare('SELECT is_technik_scout FROM users WHERE id = 9102').get();
      assert.strictEqual(userAfterReset.is_technik_scout, 0, 'is_technik_scout should be reset to 0');
    });

    // =========================================================================
    // TEST 3: Strict String and Boolean Parsing
    // =========================================================================
    await runTest(3, 'Strict string and boolean parsing ("false", "0", "true", "1")', async () => {
      mockUser = { id: 9101, username: 'scout.admin', role: 'admin' };

      // String "true"
      await apiRequest('/api/admin/users/9102', { method: 'PUT', body: JSON.stringify({ is_technik_scout: 'true' }) });
      let u = db.prepare('SELECT is_technik_scout FROM users WHERE id = 9102').get();
      assert.strictEqual(u.is_technik_scout, 1, '"true" must parse to 1');

      // String "false"
      await apiRequest('/api/admin/users/9102', { method: 'PUT', body: JSON.stringify({ is_technik_scout: 'false' }) });
      u = db.prepare('SELECT is_technik_scout FROM users WHERE id = 9102').get();
      assert.strictEqual(u.is_technik_scout, 0, '"false" must parse to 0');

      // String "1"
      await apiRequest('/api/admin/users/9102', { method: 'PUT', body: JSON.stringify({ is_technik_scout: '1' }) });
      u = db.prepare('SELECT is_technik_scout FROM users WHERE id = 9102').get();
      assert.strictEqual(u.is_technik_scout, 1, '"1" must parse to 1');

      // String "0"
      await apiRequest('/api/admin/users/9102', { method: 'PUT', body: JSON.stringify({ is_technik_scout: '0' }) });
      u = db.prepare('SELECT is_technik_scout FROM users WHERE id = 9102').get();
      assert.strictEqual(u.is_technik_scout, 0, '"0" must parse to 0');
    });

    // =========================================================================
    // TEST 4: Partial Updates preserve is_technik_scout
    // =========================================================================
    await runTest(4, 'Partial PUT /api/admin/users/:id preserves existing is_technik_scout', async () => {
      mockUser = { id: 9101, username: 'scout.admin', role: 'admin' };

      // 1. Test on LDAP user (9102): set is_technik_scout = 1, then partial update of role only
      await apiRequest('/api/admin/users/9102', { method: 'PUT', body: JSON.stringify({ is_technik_scout: 1 }) });
      await apiRequest('/api/admin/users/9102', { method: 'PUT', body: JSON.stringify({ role: 'user' }) });
      const uLdap = db.prepare('SELECT is_technik_scout FROM users WHERE id = 9102').get();
      assert.strictEqual(uLdap.is_technik_scout, 1, 'is_technik_scout must remain 1 for LDAP user on partial update');

      // 2. Test on Local user (9105): is_technik_scout is 1, update email only
      const res = await apiRequest('/api/admin/users/9105', { method: 'PUT', body: JSON.stringify({ email: 'newlocal@test.de' }) });
      assert.strictEqual(res.status, 200);

      const uLocal = db.prepare('SELECT email, is_technik_scout FROM users WHERE id = 9105').get();
      assert.strictEqual(uLocal.email, 'newlocal@test.de');
      assert.strictEqual(uLocal.is_technik_scout, 1, 'is_technik_scout must remain 1 for local user on partial update');
    });

    // =========================================================================
    // TEST 5: Non-admin cannot modify is_technik_scout
    // =========================================================================
    await runTest(5, 'Non-admin receives 403 when trying to access admin endpoints', async () => {
      mockUser = { id: 9102, username: 'scout.student1', role: 'user' };

      const res = await apiRequest('/api/admin/users/9102', {
        method: 'PUT',
        body: JSON.stringify({ is_technik_scout: 1 })
      });
      assert.strictEqual(res.status, 403, 'Non-admin must be rejected with 403');
    });

    // =========================================================================
    // TEST 6: GET /api/student/card returns is_technik_scout: true when valid
    // =========================================================================
    await runTest(6, 'GET /api/student/card returns is_technik_scout: true for active Technik Scout', async () => {
      mockUser = { id: 9103, username: 'scout.student2', role: 'user' };

      const res = await apiRequest('/api/student/card');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.valid, true, 'Card should be valid');
      assert.strictEqual(res.body.is_technik_scout, true, 'is_technik_scout should be true for user 9103');
    });

    // =========================================================================
    // TEST 7: Invalidation / Revocation Safeguard (is_technik_scout is false on revoked/expired cards)
    // =========================================================================
    await runTest(7, 'Revoked or invalid card always returns is_technik_scout: false', async () => {
      // Revoked card: user 9104 has is_technik_scout = 1 in DB, but card_status is 'Ausweis gesperrt'
      mockUser = { id: 9104, username: 'scout.revoked', role: 'user' };

      const resRevoked = await apiRequest('/api/student/card');
      assert.strictEqual(resRevoked.status, 200);
      assert.strictEqual(resRevoked.body.valid, false, 'Card must be invalid');
      assert.strictEqual(resRevoked.body.is_technik_scout, false, 'is_technik_scout MUST be false when card is revoked');

      // Status check for revoked user
      const resStatusRevoked = await apiRequest('/api/student/status-check?username=scout.revoked');
      assert.strictEqual(resStatusRevoked.status, 200);
      assert.strictEqual(resStatusRevoked.body.valid, false);
      assert.strictEqual(resStatusRevoked.body.is_technik_scout, false, 'status-check must return is_technik_scout: false when revoked');
    });

    // =========================================================================
    // TEST 8: Data minimization in /api/student/verify-check
    // =========================================================================
    await runTest(8, '/api/student/verify-check does NOT leak is_technik_scout', async () => {
      const res = await apiRequest('/api/student/verify-check?name=Lisa%20Scout&bib=BIB-9103');
      
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.is_technik_scout, undefined, 'verify-check must not expose is_technik_scout');
    });

    // =========================================================================
    // TEST 9: Status Check Endpoint /api/student/status-check
    // =========================================================================
    await runTest(9, '/api/student/status-check returns is_technik_scout: true for valid card', async () => {
      const resValid = await apiRequest('/api/student/status-check?username=scout.student2');
      
      assert.strictEqual(resValid.status, 200);
      assert.strictEqual(resValid.body.valid, true);
      assert.strictEqual(resValid.body.is_technik_scout, true, 'status-check should return is_technik_scout: true');

      const resRevoked = await apiRequest('/api/student/status-check?username=scout.revoked');
      
      assert.strictEqual(resRevoked.status, 200);
      assert.strictEqual(resRevoked.body.valid, false);
      assert.strictEqual(resRevoked.body.is_technik_scout, false, 'status-check should return is_technik_scout: false for revoked card');
    });

    // =========================================================================
    // TEST 10: HTML / CSS / A11y Verification in public/student_card.html
    // =========================================================================
    await runTest(10, 'public/student_card.html contains correct CSS, SVG, touch target and verbatim modal text', () => {
      const html = fs.readFileSync(path.join(__dirname, '../public/student_card.html'), 'utf8');

      // 1. Check touch target >= 44x44px via ::before
      assert.ok(html.includes('.technik-scout-badge::before'), 'CSS should have .technik-scout-badge::before');
      assert.ok(html.includes('width: 44px') && html.includes('height: 44px'), 'Touch target size should be at least 44x44px');

      // 2. Check accessible button attribute
      assert.ok(html.includes('aria-label="Technik Scout – Berechtigung anzeigen"'), 'Button should have accessible aria-label');

      // 3. Check exact verbatim text in modal
      const exactWording = 'Dieser Schüler / diese Schülerin ist Technik Scout. Bitte ermöglichen Sie ihr/ihm die Arbeit an der Technik der MSO – auch durch Aufschließen verschlossener Kursräume. Dies gilt nicht für Fachräume. Informatikräume dürfen jedoch ohne Aufsicht betreten werden.';
      assert.ok(html.includes(exactWording), 'Modal must contain exact German wording verbatim');

      // 4. Check modal close button and accessible title
      assert.ok(html.includes('id="technik-scout-modal"'), 'Modal should have id="technik-scout-modal"');
      assert.ok(html.includes('id="technik-scout-modal-close-btn"'), 'Modal should have close button with ID');
      assert.ok(html.includes('openTechnikScoutModal'), 'Should have openTechnikScoutModal function');
      assert.ok(html.includes('closeTechnikScoutModal'), 'Should have closeTechnikScoutModal function');

      // 5. Check order inside .special-card-badges: birthday -> technik-scout -> under18 -> printed
      const badgeDivMatch = html.match(/<div class="special-card-badges"[\s\S]*?<\/div>/);
      assert.ok(badgeDivMatch, '.special-card-badges must exist');
      const badgeContent = badgeDivMatch[0];
      const cakeIdx = badgeContent.indexOf('birthday-cake-icon');
      const scoutIdx = badgeContent.indexOf('technik-scout-badge');
      const under18Idx = badgeContent.indexOf('under18-badge');
      const printedIdx = badgeContent.indexOf('printed-badge');

      assert.ok(cakeIdx !== -1 && scoutIdx !== -1 && under18Idx !== -1 && printedIdx !== -1, 'All badges must be in container');
      assert.ok(cakeIdx < scoutIdx, 'Cake icon must be before scout badge');
      assert.ok(scoutIdx < under18Idx, 'Scout badge must be directly before under18 badge');
      assert.ok(under18Idx < printedIdx, 'Under18 badge must be before printed badge');
    });

    // =========================================================================
    // TEST 11: Service Worker cache version bumped
    // =========================================================================
    await runTest(11, 'public/sw.js cache name is bumped to v10', () => {
      const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
      assert.ok(sw.includes("CACHE_NAME = 'mso-student-card-v10'"), 'Cache name should be mso-student-card-v10');
    });
  } finally {
    // Clean up test data
    db.prepare('DELETE FROM users WHERE id IN (9101, 9102, 9103, 9104, 9105, 9106) OR username = ?').run('scout.newuser');
    db.prepare('DELETE FROM student_profiles WHERE user_id IN (9101, 9102, 9103, 9104, 9105, 9106)').run();
    db.prepare("DELETE FROM student_card_grants WHERE user_id IN (9101, 9102, 9103, 9104, 9105, 9106) OR username LIKE 'scout.%'").run();
    server.close();
  }

  console.log('\n========================================');
  console.log('ALL ' + passedTests + ' TECHNIK SCOUT TESTS PASSED!');
  console.log('========================================\n');
}

runAllTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
