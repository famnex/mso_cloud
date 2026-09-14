require('./test_helper');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const session = require('express-session');
const { evaluateCardEligibility, getSchoolYearExpirationDate } = require('../src/services/cardEligibility');

function loadModule(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: name => (name in mocks ? mocks[name] : localRequire(name)),
    console,
    process,
    Buffer,
    URL,
    setTimeout,
    clearTimeout
  }, { filename });
  return module.exports;
}

async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('1. Mediotheksnummer search in MySQL uses field = 145 (not 168) in findStudentByVerificationReference', async () => {
  const executedQueries = [];
  const fakePool = {
    end: async () => {},
    query: async (sql, params) => {
      executedQueries.push({ sql, params });
      if (sql.includes('WHERE field = 145') || sql.includes('fv.field IN (1, 2)')) {
        return [[
          { application: 42, field: 1, value: 'Max' },
          { application: 42, field: 2, value: 'Mustermann' }
        ]];
      }
      if (sql.includes('field IN (146, 158)')) {
        return [[
          { field: 146, value: 'max' },
          { field: 158, value: '1132' }
        ]];
      }
      if (sql.includes('FROM images WHERE application = ?')) {
        return [[{ 1: 1 }]];
      }
      return [[]];
    }
  };

  const dummyDb = {
    prepare: () => ({ get: () => null, all: () => [], run: () => ({ changes: 0 }) })
  };

  const studentDbModule = loadModule('src/student_db.js', {
    './db': {
      db: dummyDb,
      getConfig: (key, fallback) => {
        if (key === 'mysql_enabled') return '1';
        if (key === 'mysql_host') return '127.0.0.1';
        return fallback;
      }
    },
    'mysql2/promise': {
      createPool: () => fakePool
    }
  });

  await studentDbModule.reconnectMySQL();

  const match = await studentDbModule.findStudentByVerificationReference('BIB-9988', null, 'Max Mustermann');
  assert.ok(match, 'Profile should be found via field 145');
  assert.equal(match.profile.first_name, 'Max');
  assert.equal(match.profile.last_name, 'Mustermann');
  assert.equal(match.profile.mediothek_number, 'BIB-9988');

  const field145Query = executedQueries.find(q => q.sql.includes('field = 145'));
  assert.ok(field145Query, 'Expected query with field = 145');
  assert.equal(field145Query.params[0], 'BIB-9988');

  const field168Query = executedQueries.find(q => q.sql.includes('field = 168'));
  assert.equal(field168Query, undefined, 'No queries should use field 168');
});

test('2. Photo and profile actions return error on MySQL failure and do not fake SQLite success', async () => {
  let sqliteUpdated = false;
  const dummyDb = {
    prepare: () => ({
      get: () => ({ username: 'max.mustermann' }),
      all: () => [],
      run: () => {
        sqliteUpdated = true;
        return { changes: 1 };
      }
    })
  };

  const failingPool = {
    end: async () => {},
    query: async (sql) => {
      if (sql.includes('FROM fieldvalues WHERE field = 146')) {
        return [[]];
      }
      throw new Error('MySQL connection dropped');
    }
  };

  const studentDbModule = loadModule('src/student_db.js', {
    './db': {
      db: dummyDb,
      getConfig: (key, fallback) => {
        if (key === 'mysql_enabled') return '1';
        if (key === 'mysql_host') return '127.0.0.1';
        return fallback;
      }
    },
    'mysql2/promise': {
      createPool: () => failingPool
    }
  });

  await studentDbModule.reconnectMySQL();

  // Test approvePhoto
  sqliteUpdated = false;
  const approveRes = await studentDbModule.approvePhoto(1, 'max@schule.local');
  assert.equal(approveRes.success, false, 'approvePhoto must fail when MySQL cannot resolve application ID');
  assert.equal(sqliteUpdated, false, 'SQLite must not be updated if MySQL fails');

  // Test rejectPhoto
  sqliteUpdated = false;
  const rejectRes = await studentDbModule.rejectPhoto(1, 'max@schule.local');
  assert.equal(rejectRes.success, false, 'rejectPhoto must fail when MySQL cannot resolve application ID');
  assert.equal(sqliteUpdated, false, 'SQLite must not be updated if MySQL fails');

  // Test deletePhoto
  sqliteUpdated = false;
  const deleteRes = await studentDbModule.deletePhoto(1, 'max@schule.local');
  assert.equal(deleteRes.success, false, 'deletePhoto must fail when MySQL cannot resolve application ID');
  assert.equal(sqliteUpdated, false, 'SQLite must not be updated if MySQL fails');

  // Test updateStudentPhoto
  sqliteUpdated = false;
  const photoRes = await studentDbModule.updateStudentPhoto(1, 'max@schule.local', 'data:image/png;base64,abc');
  assert.equal(photoRes.success, false, 'updateStudentPhoto must fail when MySQL fails');
  assert.equal(sqliteUpdated, false, 'SQLite must not be updated if MySQL fails');
});

test('3. Session revocation via auth_version is enforced on /api/student/card', async (t) => {
  const users = [
    { id: 1, username: 'student1', role: 'user', is_ldap: 1, is_active: 1, auth_version: 1 }
  ];

  const db = {
    prepare: sql => ({
      get: (id) => users.find(u => u.id === id),
      run: () => ({ changes: 1 })
    })
  };

  const dummyStudentDb = {
    getStudentProfile: async () => ({
      first_name: 'Erika',
      last_name: 'Muster',
      mediothek_number: '12345',
      card_image: 'data:image/png;base64,validimg',
      card_status: 'Bild genehmigt'
    })
  };

  const app = express();
  app.use(express.json(), session({ secret: 'test-secret', resave: false, saveUninitialized: false }));

  app.post('/test-login', (req, res) => {
    req.session.user = { id: 1, username: 'student1', role: 'user', is_ldap: 1, auth_version: req.body.auth_version || 1 };
    res.json({ ok: true });
  });

  const studentRoutes = loadModule('src/routes/student.js', {
    '../db': { db, getConfig: () => '0', logEvent: () => {} },
    '../student_db': dummyStudentDb,
    '../ldap': { isUserActiveInLdap: async () => ({ active: true }) },
    '../services/cardEligibility': { evaluateCardEligibility }
  });

  app.use('/api/student', studentRoutes);

  const base = await listen(t, app);

  const loginRes = await fetch(base + '/test-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_version: 1 })
  });
  const sid = loginRes.headers.getSetCookie().find(c => c.startsWith('connect.sid='));
  assert.ok(sid);

  const cardRes1 = await fetch(base + '/api/student/card', {
    headers: { Cookie: sid.split(';')[0] }
  });
  assert.equal(cardRes1.status, 200);
  const cardData1 = await cardRes1.json();
  assert.equal(cardData1.valid, true);

  // Invalidate session
  users[0].auth_version = 2;

  const cardRes2 = await fetch(base + '/api/student/card', {
    headers: { Cookie: sid.split(';')[0] }
  });
  assert.equal(cardRes2.status, 401);
  const cardData2 = await cardRes2.json();
  assert.equal(cardData2.session_revoked, true);
});

test('4. 30-day offline validity contract and card evaluation', () => {
  const fixedDate = new Date('2026-10-15T12:00:00Z');
  const user = { id: 1, is_active: 1, username: 'student.sync4' };
  const validProfile = {
    first_name: 'Max',
    last_name: 'Mustermann',
    card_status: 'Bild genehmigt',
    card_image: 'data:image/png;base64,somethingvalid'
  };

  const eligibility = evaluateCardEligibility({
    user,
    profile: validProfile,
    ldapStatus: { status: 'active', active: true, error: null },
    now: fixedDate
  });
  assert.equal(eligibility.valid, true);
  assert.equal(eligibility.reasonCode, 'VALID');
  assert.ok(eligibility.offlineValidUntil);

  const offlineDate = new Date(eligibility.offlineValidUntil);
  const expectedThirtyDaysLater = new Date(fixedDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(offlineDate.toISOString(), expectedThirtyDaysLater.toISOString());

  const revokedProfile = { ...validProfile, card_status: 'Ausweis gesperrt' };
  const revokedEval = evaluateCardEligibility({
    user,
    profile: revokedProfile,
    ldapStatus: { status: 'active', active: true, error: null },
    now: fixedDate
  });
  assert.equal(revokedEval.valid, false);
  assert.equal(revokedEval.reasonCode, 'CARD_REVOKED');
  assert.equal(revokedEval.offlineValidUntil, null);
});

test('5. Frontend student_card.html evaluates data.valid as single source of truth and enforces offline expiration', () => {
  const htmlContent = fs.readFileSync(path.resolve(__dirname, '../public/student_card.html'), 'utf8');

  assert.ok(htmlContent.includes('tempParsed.offline_valid_until'), 'student_card.html must check offline_valid_until on cached card');
  assert.ok(htmlContent.includes("typeof data.valid === 'boolean'"), 'renderCard must evaluate data.valid as single source of truth');
  assert.ok(htmlContent.includes('isOfflineExpired'), 'renderCard must handle isOfflineExpired');
  assert.ok(htmlContent.includes('Offline-Zeitraum abgelaufen'), 'Overlay must contain offline expired text');
});
