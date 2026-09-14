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

test('2. Photo and profile actions return error on MySQL failure, roll back transaction and do not fake SQLite success', async () => {
  let sqliteUpdated = false;
  let rolledBack = false;
  let committed = false;
  let connectionReleased = false;

  const dummyDb = {
    prepare: (sql) => ({
      get: () => ({ id: 1, username: 'max.mustermann' }),
      all: () => [],
      run: () => {
        sqliteUpdated = true;
        return { changes: 1 };
      }
    })
  };

  const mockTransactionConn = {
    beginTransaction: async () => {},
    query: async (sql, params) => {
      if (sql.includes('FROM fieldvalues WHERE field = 146')) {
        return [[{ application: 99 }]];
      }
      if (sql.includes('INSERT INTO images')) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO fieldvalues')) {
        throw new Error('Simulierter Status-Schreibfehler in MySQL während Transaktion');
      }
      return [[]];
    },
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; },
    release: () => { connectionReleased = true; }
  };

  const failingPool = {
    end: async () => {},
    getConnection: async () => mockTransactionConn,
    query: async (sql, params) => mockTransactionConn.query(sql, params)
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

  // Test updateStudentPhoto: führt die Transaktion tatsächlich durch den Rollback-Fehlerpfad
  sqliteUpdated = false;
  rolledBack = false;
  committed = false;
  connectionReleased = false;

  const photoRes = await studentDbModule.updateStudentPhoto(1, 'max@schule.local', 'data:image/png;base64,abc');
  assert.equal(photoRes.success, false, 'updateStudentPhoto must fail on MySQL error');
  assert.equal(rolledBack, true, 'updateStudentPhoto must execute conn.rollback() on transaction failure');
  assert.equal(committed, false, 'updateStudentPhoto must not commit failed transaction');
  assert.equal(connectionReleased, true, 'updateStudentPhoto must release connection');
  assert.equal(sqliteUpdated, false, 'SQLite must not be updated if MySQL transaction fails');
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
    getStudentProfile: async (user, opts) => {
      const prof = {
        first_name: 'Erika',
        last_name: 'Muster',
        mediothek_number: '12345',
        card_image: 'data:image/png;base64,validimg',
        card_status: 'Bild genehmigt'
      };
      if (opts && opts.returnMeta) {
        return { profile: prof, source: 'mysql_live', queryStatus: 'found', error: null };
      }
      return prof;
    }
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

test('5. Frontend student_card.html evaluates isSupportedValidCache and enforces offline expiration', () => {
  const htmlContent = fs.readFileSync(path.resolve(__dirname, '../public/student_card.html'), 'utf8');

  // Extract isSupportedValidCache function from HTML and execute in VM
  const fnMatch = htmlContent.match(/function isSupportedValidCache\(entry\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(fnMatch, 'isSupportedValidCache must be present in student_card.html');

  const vmContext = vm.createContext({ Date, isNaN, isFinite, String });
  vm.runInContext(`function isSupportedValidCache(entry) { ${fnMatch[1]} }`, vmContext);
  const isSupportedValidCache = vmContext.isSupportedValidCache;

  // 1. Valid entry within deadline
  const validEntry = {
    valid: true,
    card_version: 'v_123456789abc',
    offline_valid_until: new Date(Date.now() + 86400000).toISOString(),
    expires_at: '2027-07-31',
    card_status: 'Bild genehmigt'
  };
  assert.equal(isSupportedValidCache(validEntry), true, 'Valid cache entry within deadline must return true');

  // 2. Missing card_version
  const unversionedEntry = { ...validEntry, card_version: null };
  assert.equal(isSupportedValidCache(unversionedEntry), false, 'Cache without version must return false');

  // 3. Expired offline deadline
  const expiredOfflineEntry = { ...validEntry, offline_valid_until: new Date(Date.now() - 10000).toISOString() };
  assert.equal(isSupportedValidCache(expiredOfflineEntry), false, 'Expired offline deadline must return false');

  // 4. Expired school year
  const expiredYearEntry = { ...validEntry, expires_at: '2020-07-31' };
  assert.equal(isSupportedValidCache(expiredYearEntry), false, 'Expired school year must return false');

  // 5. Revoked / blocked status
  const blockedEntry = { ...validEntry, card_status: 'Ausweis gesperrt' };
  assert.equal(isSupportedValidCache(blockedEntry), false, 'Blocked card must return false');
});

