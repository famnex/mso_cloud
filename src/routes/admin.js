const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, getConfig, setConfig } = require('../db');
const ldap = require('../ldap');
const mail = require('../mail');
const updater = require('../updater');

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
      smtp_from: getConfig('smtp_from', 'no-reply@mso-hef.de')
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
router.post('/config', (req, res) => {
  try {
    const keys = [
      'ldap_enabled', 'ldap_url', 'ldap_port', 'ldap_secure', 'ldap_tls_verify',
      'ldap_base_dn', 'ldap_bind_dn', 'ldap_user_attribute', 'ldap_mail_attribute', 
      'ldap_name_attribute', 'ldap_upn_suffix',
      'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from'
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
    res.status(400).json({ error: 'SMTP-Verbindungsfehler: ' + error.message });
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

router.post('/tiles', (req, res) => {
  try {
    const { title, description, icon, link, visibility, allowed_groups, sso_type, sso_key, sort_order } = req.body;
    
    if (!title || !icon || !link) {
      return res.status(400).json({ error: 'Titel, Icon und Link sind Pflichtfelder.' });
    }

    db.prepare(`
      INSERT INTO tiles (title, description, icon, link, visibility, allowed_groups, sso_type, sso_key, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      description || '',
      icon,
      link,
      visibility || 'public',
      JSON.stringify(allowed_groups || []),
      sso_type || 'none',
      sso_key || '',
      parseInt(sort_order || 0, 10)
    );

    res.json({ success: true, message: 'Dienst erfolgreich hinzugefügt.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/tiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, icon, link, visibility, allowed_groups, sso_type, sso_key, sort_order } = req.body;

    if (!title || !icon || !link) {
      return res.status(400).json({ error: 'Titel, Icon und Link sind Pflichtfelder.' });
    }

    db.prepare(`
      UPDATE tiles
      SET title = ?, description = ?, icon = ?, link = ?, visibility = ?, allowed_groups = ?, sso_type = ?, sso_key = ?, sort_order = ?
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

    // 1. Aus den Benutzerdaten auslesen
    const users = db.prepare('SELECT groups FROM users').all();
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

    // 2. Aus den LDAP-Mappings auslesen
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

module.exports = router;
