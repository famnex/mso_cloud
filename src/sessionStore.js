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
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, Math.floor(Date.now() / 1000));
      if (!row) {
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie.maxAge || 1000 * 60 * 60 * 24 * 365;
      const expire = Math.floor((Date.now() + maxAge) / 1000);
      const sessStr = JSON.stringify(sess);
      db.prepare(`
        INSERT INTO sessions (sid, sess, expire)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = ?, expire = ?
      `).run(sid, sessStr, expire, sessStr, expire);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }
}

module.exports = SqliteSessionStore;
