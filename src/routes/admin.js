const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, getConfig, setConfig } = require('../db');
const ldap = require('../ldap');
const mail = require('../mail');
const updater = require('../updater');
const studentDb = require('../student_db');

/**
 * Middleware zur Absicherung aller Admin-Routen.
 */
function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Zugriff verweigert. Nur Administratoren erlaubt.' });
  }
}

// Admin-Schutz auf alle Unterrouten anwenden
router.use(isAdmin);

/* ==========================================================================
   1. Konfiguration (LDAP, SMTP)
   ========================================================================== */

/**
 * Holt alle aktuellen Konfigurationseinstellungen.
 * Passwörter werden maskiert zurückgegeben!
 */
router.get('/config', (req, res) => {
  try {
    const config = {
      ldap_enabled: getConfig('ldap_enabled', '0'),
      ldap_url: getConfig('ldap_url', ''),
      ldap_port: getConfig('ldap_port', '389'),
      ldap_secure: getConfig('ldap_secure', '0'),
      ldap_tls_verify: getConfig('ldap_tls_verify', '0'),
      ldap_base_dn: getConfig('ldap_base_dn', ''),
      ldap_bind_dn: getConfig('ldap_bind_dn', ''),
      ldap_bind_password: getConfig('ldap_bind_password') ? '********' : '',
      ldap_user_attribute: getConfig('ldap_user_attribute', 'sAMAccountName'),
      ldap_mail_attribute: getConfig('ldap_mail_attribute', 'mail'),
      ldap_name_attribute: getConfig('ldap_name_attribute', 'displayName'),
      ldap_upn_suffix: getConfig('ldap_upn_suffix', ''),
      
      smtp_host: getConfig('smtp_host', ''),
      smtp_port: getConfig('smtp_port', '587'),
      smtp_secure: getConfig('smtp_secure', '0'),
      smtp_user: getConfig('smtp_user', ''),
      smtp_password: getConfig('smtp_password') ? '********' : '',
      smtp_from: getConfig('smtp_from', 'no-reply@mso-hef.de'),

      mysql_enabled: getConfig('mysql_enabled', '0'),
      mysql_host: getConfig('mysql_host', ''),
      mysql_port: getConfig('mysql_port', '3306'),
      mysql_user: getConfig('mysql_user', 'root'),
      mysql_password: getConfig('mysql_password') ? '********' : '',
      mysql_database: getConfig('mysql_database', 'digitale_anmeldung')
    };
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Speichert Konfigurationseinstellungen.
 * Maskierte Passwörter werden nicht überschrieben!
 */
router.post('/config', async (req, res) => {
  try {
    const keys = [
      'ldap_enabled', 'ldap_url', 'ldap_port', 'ldap_secure', 'ldap_tls_verify',
      'ldap_base_dn', 'ldap_bind_dn', 'ldap_user_attribute', 'ldap_mail_attribute', 
      'ldap_name_attribute', 'ldap_upn_suffix',
      'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from',
      'mysql_enabled', 'mysql_host', 'mysql_port', 'mysql_user', 'mysql_database'
    ];

    // Standard-Keys sichern
    for (const key of keys) {
      if (req.body[key] !== undefined) {
        setConfig(key, String(req.body[key]).trim());
      }
    }

    // Passwort-Keys speziell behandeln (nicht überschreiben, wenn nur Sternchen gesendet werden)
    if (req.body.ldap_bind_password && req.body.ldap_bind_password !== '********') {
      setConfig('ldap_bind_password', req.body.ldap_bind_password.trim());
    }
    if (req.body.smtp_password && req.body.smtp_password !== '********') {
      setConfig('smtp_password', req.body.smtp_password.trim());
    }
    if (req.body.mysql_password && req.body.mysql_password !== '********') {
      setConfig('mysql_password', req.body.mysql_password.trim());
    }

    // Reaktiv den MySQL-Verbindungspool im laufenden Betrieb neu laden
    await studentDb.reconnectMySQL();

    res.json({ success: true, message: 'Einstellungen erfolgreich gespeichert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Testet die LDAP-Verbindung live mit den gesendeten Einstellungen.
 */
router.post('/config/test-ldap', async (req, res) => {
  const config = { ...req.body };
  
  // Wenn Passwort maskiert ist, hole das Originalpasswort aus der DB
  if (config.ldap_bind_password === '********') {
    config.ldap_bind_password = getConfig('ldap_bind_password', '');
  }

  try {
    await ldap.testConnection(config);
    res.json({ success: true, message: 'LDAP-Verbindung erfolgreich hergestellt!' });
  } catch (error) {
    res.status(400).json({ error: 'LDAP-Verbindungsfehler: ' + error.message });
  }
});

/**
 * Testet die SMTP-E-Mail-Verbindung live.
 */
router.post('/config/test-smtp', async (req, res) => {
  const config = { ...req.body };

  if (config.smtp_password === '********') {
    config.smtp_password = getConfig('smtp_password', '');
  }

  try {
    await mail.testSmtpConnection(config);
    res.json({ success: true, message: 'SMTP-Verbindung erfolgreich verifiziert!' });
  } catch (error) {
    let errMsg = error.message;
    if (errMsg.includes('wrong version number') || errMsg.includes('0A00010B') || errMsg.includes('wrong-version-number')) {
      errMsg = 'Falsche SSL-Version/Konfiguration. Wenn Sie Port 587 (STARTTLS) oder Port 25 nutzen, deaktivieren Sie bitte den Schalter „Sichere Verbindung (SSL/TLS)“, da dieser ausschließlich für implizites SSL/TLS (in der Regel auf Port 465) gedacht ist.';
    }
    res.status(400).json({ error: 'SMTP-Verbindungsfehler: ' + errMsg });
  }
});

/**
 * Testet die MySQL-Schulanmeldungsdatenbank-Verbindung live.
 */
router.post('/config/test-mysql', async (req, res) => {
  const config = { ...req.body };

  if (config.mysql_password === '********') {
    config.mysql_password = getConfig('mysql_password', '');
  }

  try {
    await studentDb.testMySQLConnection({
      host: config.mysql_host,
      port: config.mysql_port,
      user: config.mysql_user,
      password: config.mysql_password,
      database: config.mysql_database
    });
    res.json({ success: true, message: 'MySQL-Verbindung erfolgreich hergestellt und verifiziert!' });
  } catch (error) {
    res.status(400).json({ error: 'MySQL-Verbindungsfehler: ' + error.message });
  }
});


/* ==========================================================================
   1b. OAuth 2.0 Client Konfiguration
   ========================================================================== */

/**
 * Holt die aktuellen Moodle OAuth-Client Zugangsdaten.
 */
router.get('/oauth-client', (req, res) => {
  try {
    const client = db.prepare("SELECT * FROM oauth_clients WHERE client_name = 'Moodle'").get();
    res.json(client || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Speichert die OAuth-Client Zugangsdaten.
 */
router.post('/oauth-client', (req, res) => {
  try {
    const { client_id, client_secret, redirect_uri } = req.body;

    if (!client_id || !client_secret || !redirect_uri) {
      return res.status(400).json({ error: 'Client-ID, Client-Secret und Redirect-URI sind Pflichtfelder.' });
    }

    db.prepare(`
      UPDATE oauth_clients
      SET client_id = ?, client_secret = ?, redirect_uri = ?
      WHERE client_name = 'Moodle'
    `).run(client_id.trim(), client_secret.trim(), redirect_uri.trim());

    res.json({ success: true, message: 'OAuth 2.0 SSO Konfiguration erfolgreich aktualisiert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/* ==========================================================================
   2. Kacheln (Tiles)
   ========================================================================== */

router.get('/tiles', (req, res) => {
  try {
    const tiles = db.prepare('SELECT * FROM tiles ORDER BY sort_order ASC, title ASC').all();
    res.json(tiles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Aktualisiert die Sortierreihenfolge mehrerer Kacheln per Drag & Drop.
 */
router.post('/tiles/reorder', (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'Ungültiges Format. order muss ein Array sein.' });
    }

    const stmt = db.prepare('UPDATE tiles SET sort_order = ? WHERE id = ?');
    
    // Transaktion für atomares und extrem schnelles Speichern
    const runTx = db.transaction((rows) => {
      for (const item of rows) {
        stmt.run(item.sort_order, item.id);
      }
    });

    runTx(order);
    res.json({ success: true, message: 'Reihenfolge erfolgreich aktualisiert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tiles', (req, res) => {
  try {
    const { title, description, icon, link, visibility, allowed_groups, sso_type, sso_key, sort_order, time_limit_enabled, time_limit_start, time_limit_end } = req.body;
    
    if (!title || !icon || !link) {
      return res.status(400).json({ error: 'Titel, Icon und Link sind Pflichtfelder.' });
    }

    // Höchste sort_order ermitteln, falls keine angegeben wurde, damit die Kachel ans Ende wandert
    let finalSortOrder = parseInt(sort_order, 10);
    if (isNaN(finalSortOrder) || finalSortOrder === 0) {
      const maxOrderRow = db.prepare('SELECT MAX(sort_order) as max_order FROM tiles').get();
      const maxOrder = maxOrderRow ? (maxOrderRow.max_order || 0) : 0;
      finalSortOrder = maxOrder + 1;
    }

    db.prepare(`
      INSERT INTO tiles (title, description, icon, link, visibility, allowed_groups, sso_type, sso_key, sort_order, time_limit_enabled, time_limit_start, time_limit_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      description || '',
      icon,
      link,
      visibility || 'public',
      JSON.stringify(allowed_groups || []),
      sso_type || 'none',
      sso_key || '',
      finalSortOrder,
      parseInt(time_limit_enabled || 0, 10),
      time_limit_start || '08:00',
      time_limit_end || '16:00'
    );

    res.json({ success: true, message: 'Dienst erfolgreich hinzugefügt.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/tiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, icon, link, visibility, allowed_groups, sso_type, sso_key, sort_order, time_limit_enabled, time_limit_start, time_limit_end } = req.body;

    if (!title || !icon || !link) {
      return res.status(400).json({ error: 'Titel, Icon und Link sind Pflichtfelder.' });
    }

    db.prepare(`
      UPDATE tiles
      SET title = ?, description = ?, icon = ?, link = ?, visibility = ?, allowed_groups = ?, sso_type = ?, sso_key = ?, sort_order = ?, time_limit_enabled = ?, time_limit_start = ?, time_limit_end = ?
      WHERE id = ?
    `).run(
      title,
      description || '',
      icon,
      link,
      visibility || 'public',
      JSON.stringify(allowed_groups || []),
      sso_type || 'none',
      sso_key || '',
      parseInt(sort_order || 0, 10),
      parseInt(time_limit_enabled || 0, 10),
      time_limit_start || '08:00',
      time_limit_end || '16:00',
      id
    );

    res.json({ success: true, message: 'Dienst erfolgreich aktualisiert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/tiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM tiles WHERE id = ?').run(id);
    res.json({ success: true, message: 'Dienst erfolgreich gelöscht.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Holt eine eindeutige Liste aller in der Datenbank existierenden Gruppen.
 */
router.get('/groups', (req, res) => {
  try {
    const groups = new Set();

    // 1. Nur von lokalen Benutzern auslesen (nicht von LDAP-Benutzern, da deren Gruppen rohe LDAP-DNs/CNs sind)
    const users = db.prepare('SELECT groups FROM users WHERE is_ldap = 0').all();
    for (const user of users) {
      try {
        const userGroups = JSON.parse(user.groups || '[]');
        if (Array.isArray(userGroups)) {
          userGroups.forEach(g => {
            if (g) groups.add(String(g).trim());
          });
        }
      } catch (e) {
        // Ignorieren bei Parsing-Fehlern
      }
    }

    // 2. Aus den LDAP-Mappings auslesen (das sind die tatsächlich gemappten Gruppen)
    const mappings = db.prepare('SELECT DISTINCT local_group FROM ldap_mappings').all();
    for (const mapping of mappings) {
      if (mapping.local_group) {
        groups.add(String(mapping.local_group).trim());
      }
    }

    res.json(Array.from(groups).sort());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/* ==========================================================================
   3. LDAP-Gruppen-Mappings
   ========================================================================== */

router.get('/ldap-mappings', (req, res) => {
  try {
    const mappings = db.prepare('SELECT * FROM ldap_mappings ORDER BY local_group ASC').all();
    res.json(mappings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/ldap-mappings', (req, res) => {
  try {
    const { ldap_group_dn, local_group } = req.body;

    if (!ldap_group_dn || !local_group) {
      return res.status(400).json({ error: 'Sowohl LDAP-Gruppe als auch lokale Gruppe sind erforderlich.' });
    }

    db.prepare(`
      INSERT INTO ldap_mappings (ldap_group_dn, local_group)
      VALUES (?, ?)
    `).run(ldap_group_dn.trim(), local_group.trim());

    res.json({ success: true, message: 'Mapping erfolgreich hinzugefügt.' });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Dieses LDAP-Gruppen-Mapping existiert bereits.' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/ldap-mappings/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM ldap_mappings WHERE id = ?').run(id);
    res.json({ success: true, message: 'Mapping erfolgreich gelöscht.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/* ==========================================================================
   4. Benutzerverwaltung (Users)
   ========================================================================== */

router.get('/users', (req, res) => {
  try {
    // Passwörter nicht auslesen!
    const users = db.prepare('SELECT id, username, email, role, groups, is_ldap, created_at FROM users ORDER BY username ASC').all();
    
    // JSON-String parsen
    const formatted = users.map(user => ({
      ...user,
      groups: JSON.parse(user.groups || '[]')
    }));
    
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/users', (req, res) => {
  try {
    const { username, email, password, role, groups } = req.body;

    if (!username || !email || !password || !role) {
      return res.status(400).json({ error: 'Username, E-Mail, Passwort und Rolle sind erforderlich.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const groupsJson = JSON.stringify(groups || []);

    db.prepare(`
      INSERT INTO users (username, email, password_hash, role, groups, is_ldap)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(username.trim(), email.trim(), hash, role, groupsJson);

    res.json({ success: true, message: 'Benutzer erfolgreich angelegt.' });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username oder E-Mail existiert bereits.' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/users/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { email, role, groups, password } = req.body;

    const user = db.prepare('SELECT is_ldap FROM users WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }

    if (user.is_ldap === 1) {
      // WICHTIG: LDAP-Benutzer sind nicht frei bearbeitbar. Nur die Rolle (Hauptrolle) darf geändert werden!
      if (!role) {
        return res.status(400).json({ error: 'Rolle ist erforderlich.' });
      }
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
      return res.json({ success: true, message: 'Rolle des LDAP-Benutzers erfolgreich aktualisiert.' });
    }

    // Lokaler Benutzer: Normaler Ablauf
    if (!email || !role) {
      return res.status(400).json({ error: 'E-Mail und Rolle sind erforderlich.' });
    }

    const groupsJson = JSON.stringify(groups || []);

    // Passwort optional updaten
    if (password && password.trim() !== '') {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare(`
        UPDATE users
        SET email = ?, role = ?, groups = ?, password_hash = ?
        WHERE id = ?
      `).run(email.trim(), role, groupsJson, hash, id);
    } else {
      db.prepare(`
        UPDATE users
        SET email = ?, role = ?, groups = ?
        WHERE id = ?
      `).run(email.trim(), role, groupsJson, id);
    }

    res.json({ success: true, message: 'Benutzer erfolgreich aktualisiert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Synchronisiert die Gruppen eines LDAP-Benutzers manuell aus dem LDAP.
 */
router.post('/users/:id/sync-ldap', async (req, res) => {
  try {
    const { id } = req.params;
    const user = db.prepare('SELECT username, is_ldap FROM users WHERE id = ?').get(id);

    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }

    if (user.is_ldap !== 1) {
      return res.status(400).json({ error: 'Nur LDAP-Benutzer können synchronisiert werden.' });
    }

    // Gruppen vom LDAP-Server abfragen und mappen
    const localGroups = await ldap.syncUserGroups(user.username);
    const groupsJson = JSON.stringify(localGroups);

    // In der lokalen DB speichern
    db.prepare('UPDATE users SET groups = ? WHERE id = ?').run(groupsJson, id);

    res.json({ success: true, message: 'LDAP-Gruppen erfolgreich synchronisiert.', groups: localGroups });
  } catch (error) {
    res.status(500).json({ error: 'LDAP-Gruppen-Sync fehlgeschlagen: ' + error.message });
  }
});

router.delete('/users/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    // Selbstlöschung verhindern!
    if (parseInt(id, 10) === req.session.user.id) {
      return res.status(400).json({ error: 'Sie können sich nicht selbst löschen!' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true, message: 'Benutzer erfolgreich gelöscht.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/* ==========================================================================
   5. System & Updater
   ========================================================================== */

/**
 * Triggert den asynchronen GitHub-Updater.
 */
router.post('/system/update', (req, res) => {
  // Asynchron im Hintergrund ausführen
  updater.performUpdate()
    .then(result => {
      console.log('Hintergrundupdate abgeschlossen:', result);
    })
    .catch(err => {
      console.error('Hintergrundupdate fehlgeschlagen:', err);
    });

  res.json({ 
    success: true, 
    message: 'System-Update im Hintergrund gestartet. Der Server zieht die neusten Änderungen von GitHub, führt Migrationen aus und lädt sich unter PM2 neu. Das kann bis zu einer Minute dauern.' 
  });
});

/* ==========================================================================
   7. News und Nachrichten (Messages)
   ========================================================================== */

/**
 * Holt alle erstellten Nachrichten (für die Admin-Tabelle).
 */
router.get('/messages', (req, res) => {
  try {
    const messages = db.prepare('SELECT * FROM news_messages ORDER BY created_at DESC').all();
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Legt eine neue Nachricht an.
 */
router.post('/messages', (req, res) => {
  try {
    const { title, content, type, start_date, end_date } = req.body;
    
    if (!title || !content || !type) {
      return res.status(400).json({ error: 'Titel, Inhalt und Typ sind Pflichtfelder.' });
    }

    db.prepare(`
      INSERT INTO news_messages (title, content, type, start_date, end_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      title,
      content,
      type,
      start_date || null,
      end_date || null
    );

    res.json({ success: true, message: 'Nachricht erfolgreich hinzugefügt.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Aktualisiert eine bestehende Nachricht.
 */
router.put('/messages/:id', (req, res) => {
  const messageId = req.params.id;
  try {
    const { title, content, type, start_date, end_date } = req.body;
    
    if (!title || !content || !type) {
      return res.status(400).json({ error: 'Titel, Inhalt und Typ sind Pflichtfelder.' });
    }

    db.prepare(`
      UPDATE news_messages 
      SET title = ?, content = ?, type = ?, start_date = ?, end_date = ?
      WHERE id = ?
    `).run(
      title,
      content,
      type,
      start_date || null,
      end_date || null,
      messageId
    );

    res.json({ success: true, message: 'Nachricht erfolgreich aktualisiert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Löscht eine Nachricht.
 */
router.delete('/messages/:id', (req, res) => {
  const messageId = req.params.id;
  try {
    db.prepare('DELETE FROM news_messages WHERE id = ?').run(messageId);
    res.json({ success: true, message: 'Nachricht erfolgreich gelöscht.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ==========================================================================
   8. Schüler-Datenbank & Ausweis-Verwaltung (Students)
   ========================================================================== */

/**
 * Ruft alle Schülerprofile inkl. Benutzername und E-Mail ab.
 */
router.get('/students', async (req, res) => {
  try {
    const students = await studentDb.getAllStudents();
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Genehmigt das Ausweisbild eines Schülers.
 */
router.post('/students/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    const email = user ? user.email : '';
    await studentDb.approvePhoto(id, email);
    res.json({ success: true, message: 'Passbild erfolgreich genehmigt.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Lehnt das Ausweisbild eines Schülers ab.
 */
router.post('/students/:id/reject', async (req, res) => {
  const { id } = req.params;
  try {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    const email = user ? user.email : '';
    await studentDb.rejectPhoto(id, email);
    res.json({ success: true, message: 'Passbild abgelehnt.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Löscht/resettet das Ausweisbild eines Schülers.
 */
router.delete('/students/:id/photo', async (req, res) => {
  const { id } = req.params;
  try {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    const email = user ? user.email : '';
    await studentDb.deletePhoto(id, email);
    res.json({ success: true, message: 'Passbild erfolgreich gelöscht.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Aktualisiert Stammdaten eines Schülerprofils.
 */
router.put('/students/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, birth_date, birth_place, mediothek_number, account_status } = req.body;
  try {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    const email = user ? user.email : '';
    await studentDb.updateStudentProfile(id, email, {
      first_name,
      last_name,
      birth_date,
      birth_place,
      mediothek_number,
      account_status
    });
    res.json({ success: true, message: 'Schülerprofil erfolgreich aktualisiert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
