const session = require('express-session');
const { db } = require('./db');

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    // Sessions-Tabelle erstellen falls nicht existent
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      )
    `).run();
    
    // Index auf expire setzen für schnelle Bereinigungen
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire)`).run();
    
    // Periodische Bereinigung abgelaufener Sessions (alle 1 Stunde)
    setInterval(() => {
      try {
        db.prepare('DELETE FROM sessions WHERE expire < ?').run(Math.floor(Date.now() / 1000));
      } catch (err) {
        console.error('Fehler beim Bereinigen abgelaufener Sessions:', err);
      }
    }, 1000 * 60 * 60);
  }

  get(sid, callback) {
    const cb = typeof callback === 'function' ? callback : () => {};
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, Math.floor(Date.now() / 1000));
      if (!row) {
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.sess));
    } catch (err) {
      console.error('[SessionStore Error] Fehler in get:', err);
      return cb(err);
    }
  }

  set(sid, sess, callback) {
    const cb = typeof callback === 'function' ? callback : () => {};
    try {
      const maxAge = (sess && sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : 1000 * 60 * 60 * 24 * 365;
      const expire = Math.floor((Date.now() + maxAge) / 1000);
      const sessStr = JSON.stringify(sess);
      db.prepare(`
        INSERT INTO sessions (sid, sess, expire)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = ?, expire = ?
      `).run(sid, sessStr, expire, sessStr, expire);
      return cb(null);
    } catch (err) {
      console.error('[SessionStore Error] Fehler in set:', err);
      return cb(err);
    }
  }

  touch(sid, sess, callback) {
    const cb = typeof callback === 'function' ? callback : () => {};
    try {
      const maxAge = (sess && sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : 1000 * 60 * 60 * 24 * 365;
      const expire = Math.floor((Date.now() + maxAge) / 1000);
      db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(expire, sid);
      return cb(null);
    } catch (err) {
      console.error('[SessionStore Error] Fehler in touch:', err);
      return cb(err);
    }
  }

  destroy(sid, callback) {
    const cb = typeof callback === 'function' ? callback : () => {};
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return cb(null);
    } catch (err) {
      console.error('[SessionStore Error] Fehler in destroy:', err);
      return cb(err);
    }
  }
}

module.exports = SqliteSessionStore;
