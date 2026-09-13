const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { getSessionTransport } = require('../src/utils/sessionTransport');
const network = require('../src/utils/networkHelper');

// Execute actual routes with isolated database/LDAP adapters; no production data or LDAP calls.
function load(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, require: name => name in mocks ? mocks[name] : localRequire(name),
    console, process, Buffer, URL, setTimeout, clearTimeout
  }, { filename });
  return module.exports;
}
async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
function fixture() {
  const users = [
    { id: 1, username: 'admin', role: 'admin', is_ldap: 0, is_active: 1, groups: '[]', auth_version: 1, password_hash: bcrypt.hashSync('test-password', 4) },
    { id: 2, username: 'teacher', role: 'user', is_ldap: 1, is_active: 1, groups: '["CN=Staff,OU=School"]', auth_version: 1, password_hash: bcrypt.hashSync('test-password', 4) }
  ];
  const tile = { id: 7, visibility: 'groups', allowed_groups: '["Lehrer"]', link: 'https://school.example/' };
  const config = { ldap_enabled: '1' };
  const db = { prepare: sql => ({ get: value => {
    if (sql.includes('FROM users')) return users.find(u => u.id === value || u.username === value);
    if (sql.includes('FROM tiles')) return String(value) === '7' || value === tile.link ? tile : undefined;
    return undefined;
  } }) };
  const dbModule = { db, getConfig: (key, fallback) => config[key] ?? fallback, logEvent() {} };
  let ldapCalls = 0;
  const ldap = { authenticate: async () => { ldapCalls++; return { isLdapError: true, code: 'TIMEOUT' }; }, isUserActiveInLdap: async () => { ldapCalls++; throw new Error('Local users must not be checked in LDAP'); }, mapLdapGroupsToLocal: () => ['Lehrer'] };
  const middleware = load('src/middleware/authMiddleware.js', { '../db': dbModule });
  const mocks = { '../db': dbModule, '../ldap': ldap, '../mail': {}, '../student_db': {}, '../middleware/authMiddleware': middleware };
  return { users, config, mocks, get ldapCalls() { return ldapCalls; } };
}

test('local administrator login survives LDAP outage and session is readable on /me', async t => {
  const f = fixture();
  const app = express();
  app.use(express.json(), session({ secret: 'regression-test-only', resave: false, saveUninitialized: false, cookie: { secure: 'auto' } }));
  app.use('/api/auth', load('src/routes/auth.js', f.mocks));
  const base = await listen(t, app);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test-password' }) });
  assert.equal(login.status, 200);
  assert.equal(f.ldapCalls, 0);
  const sid = login.headers.getSetCookie().find(cookie => cookie.startsWith('connect.sid='));
  assert.ok(sid);
  const me = await fetch(base + '/api/auth/me', { headers: { Cookie: sid.split(';')[0] } });
  assert.equal((await me.json()).logged_in, true);
  assert.equal(f.ldapCalls, 0);
  f.users[0].is_active = 0;
  const inactive = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test-password' }) });
  assert.equal(inactive.status, 401);
  const ldapLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'teacher', password: 'test-password' }) });
  assert.equal(ldapLogin.status, 503);
  f.config.ldap_enabled = '0';
  const disabledLdap = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'teacher', password: 'test-password' }) });
  assert.equal(disabledLdap.status, 401, 'LDAP cached hash must never authenticate locally');
});

test('transport: production HTTP works, trusted HTTPS secures cookie, false override and numeric hops parse', async t => {
  assert.equal(getSessionTransport({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }).secureCookie, false);
  assert.equal(getSessionTransport({ TRUST_PROXY: '1' }).trustProxy, 1);
  for (const forwarded of [false, true]) {
    const transport = getSessionTransport({ NODE_ENV: 'production' });
    const app = express();
    app.set('trust proxy', transport.trustProxy);
    app.use(session({ secret: 'test-only', resave: false, saveUninitialized: false, cookie: { secure: transport.secureCookie } }));
    app.get('/', (req, res) => { req.session.user = 1; res.json({ ok: true }); });
    const base = await listen(t, app);
    const res = await fetch(base, { headers: forwarded ? { 'X-Forwarded-Proto': 'https' } : {} });
    const cookie = res.headers.get('set-cookie');
    assert.ok(cookie);
    assert.equal(cookie.includes('; Secure'), forwarded);
  }
});

test('status route normalizes LDAP groups, rejects arbitrary URLs and handles revoked sessions', async t => {
  const f = fixture();
  let checks = 0;
  f.mocks['../utils/networkHelper'] = { checkUrlAvailability: async () => { checks++; return { online: true }; } };
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { id: 2, auth_version: 1 }, destroy(callback) { delete req.session; callback(); } };
    next();
  });
  app.use('/api/tiles', load('src/routes/tiles.js', f.mocks));
  const base = await listen(t, app);
  assert.equal((await fetch(base + '/api/tiles/check-status?id=7')).status, 200);
  assert.equal(checks, 1);
  assert.equal((await fetch(base + '/api/tiles/check-status?link=http://127.0.0.1')).status, 404);
  assert.equal(checks, 1);
  f.users[1].auth_version++;
  assert.equal((await fetch(base + '/api/tiles/check-status?id=7')).status, 403);
  assert.equal(checks, 1);
});

test('private checks require exact origin, cache respects policy, redirects are not followed', async t => {
  const app = express();
  let reached = 0;
  app.head('/', (req, res) => { reached++; res.redirect('http://169.254.169.254/'); });
  const base = await listen(t, app);
  const previous = process.env.STATUS_CHECK_PRIVATE_ORIGINS;
  t.after(() => { if (previous === undefined) delete process.env.STATUS_CHECK_PRIVATE_ORIGINS; else process.env.STATUS_CHECK_PRIVATE_ORIGINS = previous; });
  delete process.env.STATUS_CHECK_PRIVATE_ORIGINS;
  assert.equal((await network.checkUrlAvailability(base)).blocked, true);
  assert.equal(reached, 0);
  process.env.STATUS_CHECK_PRIVATE_ORIGINS = base;
  assert.equal((await network.checkUrlAvailability(base)).online, true);
  assert.equal(reached, 1);
  delete process.env.STATUS_CHECK_PRIVATE_ORIGINS;
  assert.equal((await network.checkUrlAvailability(base)).blocked, true);
  assert.equal(network.isPrivateOrLoopbackIp('::ffff:7f00:1'), true);
});

test('frontend sends tile id and leaves links usable for denied, failed and offline checks', async () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const start = code.indexOf('function checkTileStatus(');
  const end = code.indexOf('\nfunction disableTileCard', start);
  for (const response of [{ ok: false, body: { online: false } }, { ok: true, body: { blocked: true, online: null } }, { ok: true, body: { online: false } }, { throws: true }]) {
    const elements = {};
    let calledUrl;
    const ctx = {
      document: { getElementById: id => elements[id] ||= { style: {}, href: 'original-link', onclick: 'original-handler', setAttribute() {} } },
      fetch: async url => { calledUrl = url; if (response.throws) throw new Error('network'); return { ok: response.ok, json: async () => response.body }; }
    };
    vm.createContext(ctx);
    vm.runInContext(code.slice(start, end), ctx);
    await ctx.checkTileStatus(7, 'https://school.example/', 'School');
    assert.equal(calledUrl, 'api/tiles/check-status?id=7');
    assert.equal(elements['tile-badge-7'].textContent, response.ok && response.body.online === false ? 'Offline' : 'Status unbekannt');
    assert.equal(elements['tile-card-7'].onclick, 'original-handler');
    assert.equal(elements['tile-card-7'].href, 'original-link');
    assert.equal(elements['tile-key-btn-7'].style.display, undefined);
  }
});

test('HTTP connection uses the validated DNS answer without resolving again', async t => {
  const app = express();
  app.head('/', (req, res) => res.sendStatus(200));
  const base = await listen(t, app);
  const target = base.replace('127.0.0.1', 'school.test');
  const dns = require('node:dns').promises;
  const lookup = dns.lookup;
  const previous = process.env.STATUS_CHECK_PRIVATE_ORIGINS;
  let calls = 0;
  t.after(() => {
    dns.lookup = lookup;
    if (previous === undefined) delete process.env.STATUS_CHECK_PRIVATE_ORIGINS;
    else process.env.STATUS_CHECK_PRIVATE_ORIGINS = previous;
  });
  process.env.STATUS_CHECK_PRIVATE_ORIGINS = target;
  dns.lookup = async hostname => {
    assert.equal(hostname, 'school.test');
    calls++;
    if (calls > 1) throw new Error('Unexpected second DNS resolution');
    return [{ address: '127.0.0.1', family: 4 }];
  };
  assert.equal((await network.checkUrlAvailability(target)).online, true);
  assert.equal(calls, 1);
});
