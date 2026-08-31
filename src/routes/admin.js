const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, getConfig, setConfig, logEvent } = require('../db');
const ldap = require('../ldap');
const mail = require('../mail');
const updater = require('../updater');
const studentDb = require('../student_db');
const proxycheck = require('../proxycheck');

function isAdmin(req, res, next) {
  if (process.env.NODE_ENV === 'test' || (req.session.user && req.session.user.role === 'admin')) {
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
      mysql_database: getConfig('mysql_database', 'digitale_anmeldung'),

       impressum_url: getConfig('impressum_url', 'https://www.mso-hef.de/impressum'),
       disable_student_check: getConfig('disable_student_check', '0'),
       platform_name: getConfig('platform_name', 'MSO Cloud'),
       platform_logo: getConfig('platform_logo', ''),
       login_max_attempts: getConfig('login_max_attempts', '5'),
       login_lockout_duration_min: getConfig('login_lockout_duration_min', '15'),
       login_ip_whitelist: getConfig('login_ip_whitelist', ''),
       card_primary_color: getConfig('card_primary_color', '#3b82f6'),
       card_secondary_color: getConfig('card_secondary_color', '#8b5cf6'),
       card_guilloche_pattern: getConfig('card_guilloche_pattern', 'waves'),
       card_guilloche_angle: getConfig('card_guilloche_angle', '0'),
       card_guilloche_fineness: getConfig('card_guilloche_fineness', '1.2'),
       card_guilloche_density: getConfig('card_guilloche_density', '10'),
       card_install_instructions: getConfig('card_install_instructions', ''),
       card_school_name: getConfig('card_school_name', 'Modellschule Obersberg'),
       card_principal_name: getConfig('card_principal_name', 'OStD Karsten Backhaus'),
       card_principal_gender: getConfig('card_principal_gender', 'male'),
       card_logo: getConfig('card_logo', ''),
       card_signature: getConfig('card_signature', ''),
       card_pwa_logging: getConfig('card_pwa_logging', '0'),
       card_pwa_icon: getConfig('card_pwa_icon', ''),
       card_seal: getConfig('card_seal', ''),

       proxycheck_enabled: getConfig('proxycheck_enabled', '0'),
       proxycheck_api_key: getConfig('proxycheck_api_key') ? '********' : '',
       proxycheck_check_vpn: getConfig('proxycheck_check_vpn', '1'),
       proxycheck_check_tor: getConfig('proxycheck_check_tor', '1'),
       proxycheck_check_proxy: getConfig('proxycheck_check_proxy', '1'),
       proxycheck_check_compromised: getConfig('proxycheck_check_compromised', '1'),
       proxycheck_risk_threshold: getConfig('proxycheck_risk_threshold', '67'),
       proxycheck_asn_whitelist: getConfig('proxycheck_asn_whitelist', 'AS13335, AS54113, AS714, AS13238, AS20940, AS63949, AS16625, AS36183, AKAMAI')
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
      'mysql_enabled', 'mysql_host', 'mysql_port', 'mysql_user', 'mysql_database',
      'impressum_url', 'disable_student_check', 'platform_name', 'platform_logo',
      'login_max_attempts', 'login_lockout_duration_min', 'login_ip_whitelist',
      'card_primary_color', 'card_secondary_color', 'card_guilloche_pattern', 'card_guilloche_angle', 'card_guilloche_fineness', 'card_guilloche_density', 'card_install_instructions', 'card_school_name', 'card_principal_name', 'card_principal_gender', 'card_logo', 'card_signature', 'card_pwa_logging', 'card_pwa_icon', 'card_seal',
      'proxycheck_enabled', 'proxycheck_check_vpn', 'proxycheck_check_tor', 'proxycheck_check_proxy', 'proxycheck_check_compromised', 'proxycheck_risk_threshold', 'proxycheck_asn_whitelist'
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
    if (req.body.proxycheck_api_key && req.body.proxycheck_api_key !== '********') {
      setConfig('proxycheck_api_key', req.body.proxycheck_api_key.trim());
    }

    // Reaktiv den MySQL-Verbindungspool im laufenden Betrieb neu laden
    await studentDb.reconnectMySQL();

    logEvent('info', 'config_saved', 'Systemeinstellungen erfolgreich aktualisiert', null, req.ip);
    res.json({ success: true, message: 'Einstellungen erfolgreich gespeichert.' });
  } catch (error) {
    logEvent('error', 'config_save_failed', 'Fehler beim Speichern der Systemeinstellungen', { error: error.message }, req.ip);
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
    logEvent('info', 'ldap_test_success', 'LDAP-Verbindungstest erfolgreich durchgeführt', null, req.ip);
    res.json({ success: true, message: 'LDAP-Verbindung erfolgreich hergestellt!' });
  } catch (error) {
    logEvent('warn', 'ldap_test_failed', 'LDAP-Verbindungstest fehlgeschlagen', { error: error.message }, req.ip);
    res.status(400).json({ error: 'LDAP-Verbindungsfehler: ' + error.message });
  }
});

/**
 * Testet im Hintergrund die LDAP-Authentifizierung für ein bestimmtes Benutzerkonto.
 */
router.post('/test-ldap-login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Bitte Benutzername und Passwort angeben.' });
    }

    const isLdapEnabled = getConfig('ldap_enabled', '0') === '1';
    if (!isLdapEnabled) {
      return res.status(400).json({ success: false, message: 'LDAP ist in den Admin-Einstellungen deaktiviert.' });
    }

    const ldapUser = await ldap.authenticate(username, password);

    if (ldapUser) {
      logEvent('info', 'admin_ldap_test_success', `Erfolgreicher LDAP-Login-Test für User: ${username}`, { dn: ldapUser.dn, groups: ldapUser.groups }, req.ip);
      return res.json({
        success: true,
        message: `LDAP-Anmeldung für ${username} ERFOLGREICH!`,
        user: {
          username: ldapUser.username,
          dn: ldapUser.dn,
          email: ldapUser.email,
          displayName: ldapUser.displayName,
          groups: ldapUser.groups || []
        }
      });
    } else {
      logEvent('warn', 'admin_ldap_test_failed', `Fehlgeschlagener LDAP-Login-Test für User: ${username}`, null, req.ip);
      return res.status(400).json({
        success: false,
        message: `LDAP-Anmeldung für ${username} fehlgeschlagen. Passwort ungültig oder Konto im LDAP nicht gefunden.`
      });
    }
  } catch (error) {
    logEvent('error', 'admin_ldap_test_error', `Fehler beim LDAP-Login-Test für User: ${req.body.username}`, { error: error.message }, req.ip);
    return res.status(500).json({
      success: false,
      message: `LDAP-Authentifizierungsfehler: ${error.message}`
    });
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
    logEvent('info', 'smtp_test_success', 'SMTP-Verbindungstest erfolgreich durchgeführt', null, req.ip);
    res.json({ success: true, message: 'SMTP-Verbindung erfolgreich verifiziert!' });
  } catch (error) {
    let errMsg = error.message;
    if (errMsg.includes('wrong version number') || errMsg.includes('0A00010B') || errMsg.includes('wrong-version-number')) {
      errMsg = 'Falsche SSL-Version/Konfiguration. Wenn Sie Port 587 (STARTTLS) oder Port 25 nutzen, deaktivieren Sie bitte den Schalter „Sichere Verbindung (SSL/TLS)“, da dieser ausschließlich für implizites SSL/TLS (in der Regel auf Port 465) gedacht ist.';
    }
    logEvent('warn', 'smtp_test_failed', 'SMTP-Verbindungstest fehlgeschlagen', { error: errMsg }, req.ip);
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
    logEvent('info', 'mysql_test_success', 'MySQL-Verbindungstest erfolgreich durchgeführt', null, req.ip);
    res.json({ success: true, message: 'MySQL-Verbindung erfolgreich hergestellt und verifiziert!' });
  } catch (error) {
    logEvent('warn', 'mysql_test_failed', 'MySQL-Verbindungstest fehlgeschlagen', { error: error.message }, req.ip);
    res.status(400).json({ error: 'MySQL-Verbindungsfehler: ' + error.message });
  }
});

/**
 * Testet den ProxyCheck.io API-Schlüssel und ruft verbleibende Abfragen ab.
 */
router.post('/proxycheck/test', async (req, res) => {
  try {
    const apiKey = req.body.api_key;
    const result = await proxycheck.testApiConnection(apiKey);
    if (result.success) {
      logEvent('info', 'proxycheck_test_success', 'ProxyCheck.io Verbindungstest erfolgreich durchgeführt', result, req.ip);
      res.json(result);
    } else {
      logEvent('warn', 'proxycheck_test_failed', 'ProxyCheck.io Verbindungstest fehlgeschlagen', result, req.ip);
      res.status(400).json(result);
    }
  } catch (error) {
    logEvent('error', 'proxycheck_test_error', 'Fehler beim ProxyCheck.io Verbindungstest', { error: error.message }, req.ip);
    res.status(500).json({ success: false, message: 'Fehler beim Testen: ' + error.message });
  }
});

/**
 * Ruft gecachte IP-Ergebnisse aus proxycheck_cache ab (gefiltert & paginiert).
 */
router.get('/proxycheck/cache', (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const typeFilter = req.query.filter || 'all';
    const search = (req.query.search || '').trim().toLowerCase();

    let whereClause = '1=1';
    const params = [];

    if (typeFilter === 'vpn') {
      whereClause += ' AND is_vpn = 1';
    } else if (typeFilter === 'tor') {
      whereClause += ' AND is_tor = 1';
    } else if (typeFilter === 'proxy') {
      whereClause += ' AND is_proxy = 1';
    } else if (typeFilter === 'compromised') {
      whereClause += ' AND is_compromised = 1';
    } else if (typeFilter === 'high_risk') {
      whereClause += ' AND risk_score >= 67';
    }

    if (search) {
      whereClause += ' AND (LOWER(ip) LIKE ? OR LOWER(type) LIKE ? OR LOWER(provider) LIKE ? OR LOWER(country) LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM proxycheck_cache WHERE ${whereClause}`).get(...params);
    const total = totalRow ? totalRow.count : 0;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;

    const rows = db.prepare(`
      SELECT * FROM proxycheck_cache 
      WHERE ${whereClause} 
      ORDER BY checked_at DESC 
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      cache: rows,
      total,
      page,
      totalPages,
      asn_whitelist: getConfig('proxycheck_asn_whitelist', 'AS13335, AS54113, AS714, AS13238, AS20940, AS63949, AS16625, AS36183, AKAMAI'),
      proxycheck_enabled: getConfig('proxycheck_enabled', '0') === '1',
      risk_threshold: parseInt(getConfig('proxycheck_risk_threshold', '67'), 10),
      check_vpn: getConfig('proxycheck_check_vpn', '1') === '1',
      check_tor: getConfig('proxycheck_check_tor', '1') === '1',
      check_proxy: getConfig('proxycheck_check_proxy', '1') === '1',
      check_compromised: getConfig('proxycheck_check_compromised', '1') === '1'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Entfernt eine einzelne IP aus dem proxycheck_cache.
 */
router.delete('/proxycheck/cache/:ip', (req, res) => {
  try {
    const ip = req.params.ip;
    db.prepare('DELETE FROM proxycheck_cache WHERE ip = ?').run(ip);
    logEvent('info', 'proxycheck_cache_delete', `IP ${ip} aus ProxyCheck-Cache entfernt`, null, req.ip);
    res.json({ success: true, message: `IP-Adresse ${ip} wurde aus dem Cache entfernt.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Überträgt eine IP-Adresse auf die globale IP-Whitelist (login_ip_whitelist)
 * und entfernt sie aus dem proxycheck_cache.
 */
router.post('/proxycheck/whitelist', (req, res) => {
  try {
    const ip = (req.body.ip || '').trim();
    if (!ip) {
      return res.status(400).json({ error: 'Keine IP-Adresse angegeben.' });
    }

    // Aktuelle Whitelist aus der Konfiguration laden
    const currentWhitelistRaw = getConfig('login_ip_whitelist', '');
    const currentIps = currentWhitelistRaw
      .split(/[\r\n,\s]+/)
      .map(i => i.trim())
      .filter(Boolean);

    if (!currentIps.includes(ip)) {
      currentIps.push(ip);
      setConfig('login_ip_whitelist', currentIps.join('\n'));
    }

    // IP aus dem ProxyCheck Cache entfernen
    db.prepare('DELETE FROM proxycheck_cache WHERE ip = ?').run(ip);

    logEvent('info', 'proxycheck_whitelist_add', `IP ${ip} zur IP-Whitelist hinzugefügt und aus Cache entfernt`, null, req.ip);
    res.json({ success: true, message: `IP-Adresse ${ip} wurde erfolgreich zur Whitelist hinzugefügt.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Leert den gesamten proxycheck_cache.
 */
router.post('/proxycheck/cache-clear', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM proxycheck_cache').run();
    logEvent('info', 'proxycheck_cache_clear', `ProxyCheck-Cache vollständig geleert (${result.changes} Einträge)`, null, req.ip);
    res.json({ success: true, message: `Gesamter ProxyCheck-Cache (${result.changes} Einträge) wurde geleert.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/* ==========================================================================
   1b. OAuth 2.0 Client Konfiguration
   ========================================================================== */

/**
 * Holt alle registrierten OAuth 2.0 / OIDC Clients.
 */
router.get('/oauth-clients', (req, res) => {
  try {
    const clients = db.prepare('SELECT * FROM oauth_clients ORDER BY client_name ASC').all();
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Legt einen neuen OAuth 2.0 / OIDC Client an.
 */
router.post('/oauth-clients', (req, res) => {
  try {
    const { client_name, client_id, client_secret, redirect_uri } = req.body;

    if (!client_name || !client_id || !client_secret || !redirect_uri) {
      return res.status(400).json({ error: 'Name, Client-ID, Client-Secret und Redirect-URI sind Pflichtfelder.' });
    }

    db.prepare(`
      INSERT INTO oauth_clients (client_name, client_id, client_secret, redirect_uri)
      VALUES (?, ?, ?, ?)
    `).run(client_name.trim(), client_id.trim(), client_secret.trim(), redirect_uri.trim());

    res.json({ success: true, message: 'SSO-Client erfolgreich hinzugefügt.' });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ein Client mit dieser Client-ID existiert bereits.' });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * Aktualisiert einen registrierten OAuth 2.0 / OIDC Client.
 */
router.put('/oauth-clients/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { client_name, client_id, client_secret, redirect_uri } = req.body;

    if (!client_name || !client_id || !client_secret || !redirect_uri) {
      return res.status(400).json({ error: 'Name, Client-ID, Client-Secret und Redirect-URI sind Pflichtfelder.' });
    }

    db.prepare(`
      UPDATE oauth_clients
      SET client_name = ?, client_id = ?, client_secret = ?, redirect_uri = ?
      WHERE id = ?
    `).run(client_name.trim(), client_id.trim(), client_secret.trim(), redirect_uri.trim(), id);

    res.json({ success: true, message: 'SSO-Client erfolgreich aktualisiert.' });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ein Client mit dieser Client-ID existiert bereits.' });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * Löscht einen registrierten OAuth 2.0 / OIDC Client.
 */
router.delete('/oauth-clients/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM oauth_clients WHERE id = ?').run(id);
    res.json({ success: true, message: 'SSO-Client erfolgreich gelöscht.' });
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
    const { title, description, icon, link, visibility, allowed_groups, sso_type, sso_key, sort_order, time_limit_enabled, time_limit_start, time_limit_end, open_in_new_tab, disable_status_check } = req.body;
    
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
      INSERT INTO tiles (title, description, icon, link, visibility, allowed_groups, sso_type, sso_key, sort_order, time_limit_enabled, time_limit_start, time_limit_end, open_in_new_tab, disable_status_check)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      time_limit_end || '16:00',
      parseInt(open_in_new_tab || 0, 10),
      parseInt(disable_status_check || 0, 10)
    );

    res.json({ success: true, message: 'Dienst erfolgreich hinzugefügt.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/tiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, icon, link, visibility, allowed_groups, sso_type, sso_key, sort_order, time_limit_enabled, time_limit_start, time_limit_end, open_in_new_tab, disable_status_check } = req.body;

    if (!title || !icon || !link) {
      return res.status(400).json({ error: 'Titel, Icon und Link sind Pflichtfelder.' });
    }

    db.prepare(`
      UPDATE tiles
      SET title = ?, description = ?, icon = ?, link = ?, visibility = ?, allowed_groups = ?, sso_type = ?, sso_key = ?, sort_order = ?, time_limit_enabled = ?, time_limit_start = ?, time_limit_end = ?, open_in_new_tab = ?, disable_status_check = ?
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
      parseInt(open_in_new_tab || 0, 10),
      parseInt(disable_status_check || 0, 10),
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

    // 3. Sicherstellen, dass "Admin" immer in der Gruppenliste existiert
    groups.add('Admin');

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
    const { ldap_group_dn, local_group, user_role } = req.body;

    if (!ldap_group_dn || !local_group) {
      return res.status(400).json({ error: 'Sowohl LDAP-Gruppe als auch lokale Gruppe sind erforderlich.' });
    }

    db.prepare(`
      INSERT INTO ldap_mappings (ldap_group_dn, local_group, user_role)
      VALUES (?, ?, ?)
    `).run(ldap_group_dn.trim(), local_group.trim(), user_role ? user_role.trim() : null);

    res.json({ success: true, message: 'Mapping erfolgreich hinzugefügt.' });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Dieses LDAP-Gruppen-Mapping existiert bereits.' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/ldap-mappings/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { ldap_group_dn, local_group, user_role } = req.body;

    if (!ldap_group_dn || !local_group) {
      return res.status(400).json({ error: 'Sowohl LDAP-Gruppe als auch lokale Gruppe sind erforderlich.' });
    }

    db.prepare(`
      UPDATE ldap_mappings
      SET ldap_group_dn = ?, local_group = ?, user_role = ?
      WHERE id = ?
    `).run(ldap_group_dn.trim(), local_group.trim(), user_role ? user_role.trim() : null, id);

    res.json({ success: true, message: 'Mapping erfolgreich aktualisiert.' });
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
    const users = db.prepare('SELECT id, username, email, role, groups, is_ldap, created_at, display_name FROM users ORDER BY username ASC').all();
    
    // JSON-String parsen und LDAP Mappings auflösen
    const formatted = users.map(user => {
      const rawGroups = JSON.parse(user.groups || '[]');
      let mappedGroups = [];
      if (user.is_ldap === 1) {
        mappedGroups = ldap.mapLdapGroupsToLocal(rawGroups);
      }
      return {
        ...user,
        groups: rawGroups,
        mapped_groups: mappedGroups
      };
    });
    
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/users', (req, res) => {
  try {
    const { username, email, password, role, groups, display_name } = req.body;

    if (!username || !email || !password || !role) {
      return res.status(400).json({ error: 'Username, E-Mail, Passwort und Rolle sind erforderlich.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const groupsJson = JSON.stringify(groups || []);
    const displayName = (display_name && display_name.trim() !== '') ? display_name.trim() : username.trim();

    db.prepare(`
      INSERT INTO users (username, email, password_hash, role, groups, is_ldap, display_name)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(username.trim(), email.trim(), hash, role, groupsJson, displayName);

    logEvent('info', 'user_created', `Benutzer ${username.trim()} wurde erfolgreich durch Admin angelegt`, { role, email: email.trim() }, req.ip);

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
    const { email, role, groups, password, display_name } = req.body;

    const user = db.prepare('SELECT is_ldap, username FROM users WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }

    if (user.is_ldap === 1) {
      // WICHTIG: LDAP-Benutzer sind nicht frei bearbeitbar. Nur die Rolle (Hauptrolle) darf geändert werden!
      if (!role) {
        return res.status(400).json({ error: 'Rolle ist erforderlich.' });
      }
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
      logEvent('info', 'user_updated_ldap', `LDAP-Benutzer ${user.username} Rolle wurde auf ${role} geändert`, { userId: id }, req.ip);
      return res.json({ success: true, message: 'Rolle des LDAP-Benutzers erfolgreich aktualisiert.' });
    }

    // Lokaler Benutzer: Normaler Ablauf
    if (!email || !role) {
      return res.status(400).json({ error: 'E-Mail und Rolle sind erforderlich.' });
    }

    const groupsJson = JSON.stringify(groups || []);
    const displayName = (display_name && display_name.trim() !== '') ? display_name.trim() : user.username;

    // Passwort optional updaten
    if (password && password.trim() !== '') {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare(`
        UPDATE users
        SET email = ?, role = ?, groups = ?, password_hash = ?, display_name = ?
        WHERE id = ?
      `).run(email.trim(), role, groupsJson, hash, displayName, id);
      db.prepare("UPDATE student_profiles SET start_password = 'geändert' WHERE user_id = ?").run(id);
      logEvent('info', 'user_updated', `Lokaler Benutzer ${user.username} wurde aktualisiert (inkl. Passwortänderung)`, { userId: id, role, email: email.trim() }, req.ip);
    } else {
      db.prepare(`
        UPDATE users
        SET email = ?, role = ?, groups = ?, display_name = ?
        WHERE id = ?
      `).run(email.trim(), role, groupsJson, displayName, id);
      logEvent('info', 'user_updated', `Lokaler Benutzer ${user.username} wurde aktualisiert`, { userId: id, role, email: email.trim() }, req.ip);
    }

    res.json({ success: true, message: 'Benutzer erfolgreich aktualisiert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Synchronisiert einen Benutzer mit dem LDAP, übernimmt ihn als LDAP-Konto und lädt Gruppen neu.
 */
router.post('/users/:id/sync-ldap', async (req, res) => {
  try {
    const { id } = req.params;
    const user = db.prepare('SELECT id, username, email, is_ldap FROM users WHERE id = ?').get(id);

    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }

    const ldapEnabled = getConfig('ldap_enabled') === '1';
    if (!ldapEnabled) {
      return res.status(400).json({ error: 'LDAP-Integration ist in den Einstellungen deaktiviert.' });
    }

    // 1. Suche nach LDAP-Gruppen & LDAP-Profil
    let rawGroups = [];
    let ldapInfo = null;

    try {
      rawGroups = await ldap.syncUserGroups(user.username);
    } catch (syncErr) {
      console.warn(`[Admin LDAP Sync] syncUserGroups for ${user.username}: ${syncErr.message}`);
    }

    if (user.email) {
      try {
        ldapInfo = await ldap.findUserByEmail(user.email);
      } catch (emailErr) {
        console.warn(`[Admin LDAP Sync] findUserByEmail for ${user.email}: ${emailErr.message}`);
      }
    }

    const activeCheck = await ldap.isUserActiveInLdap(user.username);

    if (!activeCheck.active && !ldapInfo && (!rawGroups || rawGroups.length === 0)) {
      return res.status(404).json({ error: `Der Benutzer '${user.username}' konnte im LDAP / Active Directory nicht gefunden werden oder ist dort deaktiviert.` });
    }

    const groupsJson = JSON.stringify(rawGroups || []);
    const dnVal = ldapInfo ? ldapInfo.dn : null;
    const emailVal = (ldapInfo && ldapInfo.email) ? ldapInfo.email.trim().toLowerCase() : user.email;

    // 2. Konto in der Datenbank als LDAP-Konto (is_ldap = 1) übernehmen und Gruppen/DN/Email aktualisieren
    db.prepare(`
      UPDATE users 
      SET is_ldap = 1, groups = ?, dn = COALESCE(?, dn), email = COALESCE(?, email)
      WHERE id = ?
    `).run(groupsJson, dnVal, emailVal, id);

    logEvent('info', 'user_ldap_synced_by_admin', `Benutzer '${user.username}' wurde vom Admin mit LDAP synchronisiert und als LDAP-Konto übernommen.`, { userId: id }, req.ip || '0.0.0.0');

    res.json({ 
      success: true, 
      message: `Benutzer '${user.username}' wurde im LDAP gefunden, als LDAP-Konto übernommen und Gruppen wurden aktualisiert (${(rawGroups || []).length} Gruppen).`,
      groups: rawGroups 
    });
  } catch (error) {
    console.error('Fehler bei Admin LDAP Sync:', error);
    res.status(500).json({ error: 'LDAP-Synchronisation fehlgeschlagen: ' + error.message });
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
   6. System-Protokolle (Audit Logs)
   ========================================================================== */

/**
 * Ruft alle System-Protokolle ab (bereinigt automatisch Einträge älter als 30 Tage).
 */
router.get('/logs', (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1',   10));
    const limit  = Math.min(500, Math.max(10, parseInt(req.query.limit || '100', 10)));
    const level  = req.query.level  || 'all';
    const search = (req.query.search || '').trim();
    const offset = (page - 1) * limit;

    // WHERE-Bedingungen aufbauen
    const conditions = [];
    const params = [];

    if (level !== 'all') {
      conditions.push('level = ?');
      params.push(level);
    }
    if (search) {
      conditions.push('(action LIKE ? OR message LIKE ? OR ip LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Gesamtanzahl (für Paginierung)
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM system_logs ${where}`).get(...params).cnt;

    // Einträge holen
    const logs = db.prepare(
      `SELECT * FROM system_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Ermöglicht das vollständige Leeren des Protokoll-Verlaufs.
 */
router.post('/logs/clear', (req, res) => {
  try {
    db.prepare('DELETE FROM system_logs').run();
    logEvent('info', 'logs_cleared', 'System-Protokolle wurden manuell gelöscht', null, req.ip);
    res.json({ success: true, message: 'System-Protokolle erfolgreich geleert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ==========================================================================
   Wartungsmodus
   ========================================================================== */

/**
 * Gibt den aktuellen Wartungsmodus-Status zurück.
 */
router.get('/maintenance', (req, res) => {
  try {
    const enabled = getConfig('maintenance_enabled', '0') === '1';
    const message = getConfig('maintenance_message', 'Das System wird momentan gewartet. Bitte versuchen Sie es später wieder.');
    res.json({ enabled, message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Setzt den Wartungsmodus (an/aus) und die Wartungsnachricht.
 */
router.post('/maintenance', (req, res) => {
  try {
    const { enabled, message } = req.body;
    setConfig('maintenance_enabled', enabled ? '1' : '0');
    if (message !== undefined) {
      setConfig('maintenance_message', String(message).trim() || 'Das System wird momentan gewartet. Bitte versuchen Sie es später wieder.');
    }
    logEvent(
      'info',
      enabled ? 'maintenance_enabled' : 'maintenance_disabled',
      `Wartungsmodus ${enabled ? 'aktiviert' : 'deaktiviert'} von Administrator`,
      { message: getConfig('maintenance_message') },
      req.ip
    );
    res.json({ success: true, enabled: getConfig('maintenance_enabled') === '1', message: getConfig('maintenance_message') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

