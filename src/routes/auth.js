const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, getConfig } = require('../db');
const ldap = require('../ldap');
const mail = require('../mail');
const studentDb = require('../student_db');

/**
 * Holt den aktuellen Benutzer aus der Session.
 */
router.get('/me', (req, res) => {
  if (req.session.user) {
    res.json({ logged_in: true, user: req.session.user });
  } else {
    res.json({ logged_in: false });
  }
});

/**
 * Login-API (Lokale Daten & LDAP)
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });
  }

  try {
    // 1. Lokalen Login-Versuch durchführen
    const localUser = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    
    if (localUser && localUser.password_hash) {
      const match = bcrypt.compareSync(password, localUser.password_hash);
      if (match) {
        // Lokaler Login erfolgreich!
        const groups = JSON.parse(localUser.groups || '[]');
        req.session.user = {
          id: localUser.id,
          username: localUser.username,
          email: localUser.email,
          role: localUser.role,
          groups: groups,
          isLdap: false
        };
        req.session.plain_password = password; // Passwort für Autologin-Verfahren zwischenspeichern
        const isOauth = !!req.session.oauthQuery;
        return res.json({ success: true, user: req.session.user, oauth_redirect: isOauth });
      }
    }

    // 2. LDAP Login-Versuch (wenn lokaler Login scheiterte oder User nicht existiert)
    const ldapEnabled = getConfig('ldap_enabled') === '1';
    if (ldapEnabled) {
      console.log(`Versuche LDAP-Login für Benutzer: ${username}`);
      const ldapUser = await ldap.authenticate(username, password);
      
      if (ldapUser) {
        // LDAP-Login erfolgreich! Synchronisiere mit lokaler Cache-Datenbank
        let localCache = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        let userId;

        const groupsJson = JSON.stringify(ldapUser.rawGroups);
        
        // Bestimme Rolle: Wenn eine der LDAP-Gruppen dem Admin-Mapping entspricht
        let role = 'user';
        if (ldapUser.roles.includes('Admin')) {
          role = 'admin';
        } else if (localCache) {
          role = localCache.role; // Bestehende Rolle beibehalten
        }

        if (localCache) {
          // Cache aktualisieren
          db.prepare(`
            UPDATE users 
            SET email = ?, role = ?, groups = ?, is_ldap = 1 
            WHERE id = ?
          `).run(ldapUser.email, role, groupsJson, localCache.id);
          userId = localCache.id;
        } else {
          // Neu anlegen
          const info = db.prepare(`
            INSERT INTO users (username, email, password_hash, role, groups, is_ldap)
            VALUES (?, ?, NULL, ?, ?, 1)
          `).run(username, ldapUser.email, role, groupsJson);
          userId = info.lastInsertRowId;
        }

        req.session.user = {
          id: userId,
          username: ldapUser.username,
          email: ldapUser.email,
          role: role,
          groups: ldapUser.rawGroups,
          isLdap: true
        };
        req.session.plain_password = password; // Passwort für Autologin-Verfahren zwischenspeichern

        const isOauth = !!req.session.oauthQuery;
        return res.json({ success: true, user: req.session.user, oauth_redirect: isOauth });
      }
    }

    // Wenn beide fehlschlagen
    res.status(401).json({ error: 'Ungültiger Benutzername oder Passwort.' });
  } catch (error) {
    console.error('Fehler beim Login:', error);
    res.status(500).json({ error: 'Serverfehler während der Authentifizierung: ' + error.message });
  }
});

/**
 * Logout-API
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Fehler beim Abmelden.' });
    }
    res.clearCookie('sid');
    res.json({ success: true });
  });
});

/**
 * E-Mail-Anfrage zur Passwortrücksetzung senden (Passwort vergessen)
 */
router.post('/reset-request', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'E-Mail-Adresse ist erforderlich.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    
    // Sicherheitshinweis: Immer Erfolg vortäuschen, um E-Mail-Enumeration zu verhindern!
    const genericSuccessMsg = 'Falls ein lokales Konto mit dieser E-Mail-Adresse existiert, wurde ein Link zum Zurücksetzen versendet.';

    if (!user) {
      return res.json({ success: true, message: genericSuccessMsg });
    }

    // Wenn es ein LDAP-Nutzer ist, kann sein Passwort nicht lokal zurückgesetzt werden
    if (user.is_ldap === 1) {
      return res.status(400).json({ 
        error: 'Dieses Konto wird über LDAP verwaltet. Bitte ändere dein Passwort im Schulnetzwerk oder wende dich an den Administrator.' 
      });
    }

    // Token erzeugen
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 Stunde gültig

    // In DB eintragen
    db.prepare(`
      INSERT INTO password_resets (user_id, token, expires_at)
      VALUES (?, ?, ?)
    `).run(user.id, token, expiresAt);

    // Reset-URL zusammenbauen
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const host = req.get('host');
    const resetUrl = `${protocol}://${host}/index.html?action=reset&token=${token}`;

    // Mail senden
    await mail.sendResetMail(user.email, user.username, resetUrl);

    res.json({ success: true, message: genericSuccessMsg });
  } catch (error) {
    console.error('Fehler bei der Passwort-Reset-Anfrage:', error);
    res.status(500).json({ error: 'Fehler beim Senden der Reset-Mail: ' + error.message });
  }
});

/**
 * Passwort mit Token tatsächlich zurücksetzen
 */
router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token und neues Passwort sind erforderlich.' });
  }

  try {
    // Aktiven, ungenutzten Reset-Token holen
    const reset = db.prepare(`
      SELECT * FROM password_resets 
      WHERE token = ? AND used = 0 AND expires_at > datetime('now')
    `).get(token);

    if (!reset) {
      return res.status(400).json({ error: 'Der Link ist ungültig oder abgelaufen.' });
    }

    // Neues Passwort hashen und updaten
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, reset.user_id);

    // Token als verbraucht markieren
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);

    res.json({ success: true, message: 'Passwort erfolgreich geändert. Du kannst dich jetzt anmelden.' });
  } catch (error) {
    console.error('Fehler beim Zurücksetzen des Passworts:', error);
    res.status(500).json({ error: 'Fehler beim Passwort-Reset: ' + error.message });
  }
});

/**
 * Hilfsfunktionen zur symmetrischen Ver- und Entschlüsselung der SPH-Passwörter.
 */
const ENCRYPTION_KEY = crypto.scryptSync(process.env.SESSION_SECRET || 'mso_cloud_default_secret_key_123!', 'salt', 32);
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error('Fehler bei der Entschlüsselung:', err);
    return null;
  }
}

/**
 * Gibt den Status der hinterlegten Schulportal-Zugangsdaten für den aktuellen Benutzer aus.
 */
router.get('/sph-credentials', (req, res) => {
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    const row = db.prepare('SELECT sph_username FROM user_sph_credentials WHERE user_id = ?').get(user.id);
    if (row) {
      res.json({ exists: true, username: row.sph_username });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Speichert oder überschreibt die Schulportal-Zugangsdaten für den angemeldeten Benutzer.
 */
router.post('/sph-credentials', (req, res) => {
  const user = req.session.user;
  const { sph_username, sph_password } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  if (!sph_username || !sph_password) {
    return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });
  }

  try {
    const encryptedPassword = encrypt(sph_password);
    db.prepare(`
      INSERT OR REPLACE INTO user_sph_credentials (user_id, sph_username, sph_password)
      VALUES (?, ?, ?)
    `).run(user.id, sph_username, encryptedPassword);

    res.json({ success: true, message: 'Zugangsdaten erfolgreich gespeichert.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Löscht die hinterlegten Schulportal-Zugangsdaten des angemeldeten Benutzers.
 */
router.delete('/sph-credentials', (req, res) => {
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    db.prepare('DELETE FROM user_sph_credentials WHERE user_id = ?').run(user.id);
    res.json({ success: true, message: 'Zugangsdaten erfolgreich gelöscht.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ==========================================================================
 * Schülerportal Integration Routes
 * ==========================================================================
 */

/**
 * Validiert die studentische E-Mail-Adresse und sendet einen temporären Anmeldelink per SMTP.
 */
router.post('/student-link', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-Mail-Adresse ist erforderlich.' });
  }

  try {
    // Überprüfen, ob der Schüler existiert und seinen Freigabestatus holen (MySQL / SQLite)
    const userStatus = await studentDb.getStudentByEmail(email);

    if (!userStatus) {
      return res.status(404).json({ 
        error: 'Diese E-Mail-Adresse ist bei der Registrierung nicht hinterlegt oder Ihr Zugang ist noch nicht freigeschaltet. Bitte warten Sie die Begrüßungsmail ab!' 
      });
    }

    if (userStatus.account_status === 'false') {
      // Schüler existiert, ist aber noch nicht freigeschaltet -> "Noch in Bearbeitung" E-Mail senden (analog PHP)
      const mailHtml = `
        <h2>Guten Tag,</h2>
        Sie haben versucht, sich mit dieser E-Mail-Adresse beim Schülerportal der Modellschule Obersberg in Bad Hersfeld anzumelden.<br><br>
        Leider wurde Ihre Anmeldung noch nicht final bearbeitet, sodass wir Sie noch um etwas Geduld bitten.<br>
        Wir senden Ihnen eine Begrüßungsmail, sobald Ihr Zugang freigeschaltet ist.<br><br>
        Mit freundlichen Grüßen<br>
        Modellschule Obersberg<br><br>
        <i>Diese E-Mail wurde automatisch erstellt.</i>
      `;
      
      await mail.sendMail(email.trim(), '[MSO] Schülerportal Anmeldung', mailHtml);
      return res.json({ 
        success: true, 
        pending: true, 
        message: 'Ihre Anmeldung ist noch in Bearbeitung. Sie erhalten eine E-Mail mit weiteren Informationen.' 
      });
    }

    // Token erzeugen (24 Bytes -> 48 Hex-Zeichen) und 20 Minuten Gültigkeit
    const token = crypto.randomBytes(24).toString('hex');
    
    // Token in DB speichern (MySQL / SQLite)
    await studentDb.createStudentToken(email, token, req.ip);

    // Anmeldelink generieren (auf Basis der anfragenden Hostadresse)
    const host = req.get('host');
    const protocol = req.protocol;
    const loginLink = `${protocol}://${host}/?student_token=${token}`;

    const mailHtml = `
      <h2>Guten Tag,</h2>
      vielen Dank, dass Sie sich mit dieser E-Mail-Adresse beim Schülerportal der Modellschule Obersberg in Bad Hersfeld angemeldet haben.<br><br>
      Um sich im System anzumelden, können Sie folgenden Link nutzen:<br>
      <a href="${loginLink}"><b>Schülerportal MSO Cloud</b></a><br><br>
      Dieser Link ist für 20 Minuten gültig. Sollte er abgelaufen sein, dann können Sie sich erneut über die Anmeldeseite der MSO Cloud anmelden.<br><br>
      Mit freundlichen Grüßen<br>
      Modellschule Obersberg<br><br>
      <i>Diese E-Mail wurde automatisch erstellt.</i>
    `;

    // E-Mail senden
    try {
      await mail.sendMail(email.trim(), '[MSO] Schülerportal Anmeldelink', mailHtml);
    } catch (mailError) {
      console.warn('WARNUNG: E-Mail-Versand fehlgeschlagen (SMTP nicht konfiguriert?). Der Link wird dennoch generiert:', mailError.message);
    }
    
    // Konsolenprotokollierung zur einfachen lokalen Verifikation/Entwicklung
    console.log(`=================================================`);
    console.log(` Schülerportal-Link generiert für: ${email.trim()}`);
    console.log(` Link: ${loginLink}`);
    console.log(`=================================================`);

    res.json({ 
      success: true, 
      message: 'Ein Anmeldelink wurde an Ihre E-Mail-Adresse versendet. Bitte prüfen Sie auch Ihren Spam-Ordner.' 
    });
  } catch (error) {
    console.error('Fehler beim Generieren des Schüler-Links:', error);
    res.status(500).json({ error: 'Fehler beim Generieren des Links: ' + error.message });
  }
});

/**
 * Führt den automatischen Login durch, wenn ein gültiges E-Mail-Token übergeben wird.
 */
router.post('/student-token-login', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token ist erforderlich.' });
  }

  try {
    const result = await studentDb.verifyStudentToken(token, req.ip);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Express-Sitzung erstellen
    req.session.user = result.user;

    res.json({ 
      success: true, 
      message: 'Erfolgreich über E-Mail-Link angemeldet.', 
      user: req.session.user 
    });
  } catch (error) {
    console.error('Fehler beim E-Mail Token-Login:', error);
    res.status(500).json({ error: 'Fehler beim Login: ' + error.message });
  }
});

/**
 * Ruft die detaillierten Schülerportal-Stammdaten des angemeldeten Benutzers ab.
 */
router.get('/student-profile', async (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  try {
    const profile = await studentDb.getStudentProfile(user);
    if (!profile) {
      return res.status(404).json({ error: 'Kein Schülerportal-Profil für diesen Account hinterlegt.' });
    }
    res.json(profile);
  } catch (error) {
    console.error('Fehler beim Abrufen des Schülerprofils:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Profils: ' + error.message });
  }
});

/**
 * Speichert das über Pico.js face-cropped Base64-Passbild ab und aktualisiert den Ausweisstatus.
 */
router.post('/student-photo', async (req, res) => {
  const user = req.session.user;
  const { image } = req.body;

  if (!user) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }

  if (!image) {
    return res.status(400).json({ error: 'Keine Bilddatei übergeben.' });
  }

  if (!image.startsWith('data:image/png') && !image.startsWith('data:image/jpeg')) {
    return res.status(400).json({ error: 'Ungültiges Bildformat. Nur PNG und JPEG erlaubt.' });
  }

  try {
    await studentDb.updateStudentPhoto(user.id, user.email, image);
    res.json({ success: true, message: 'Passbild erfolgreich hochgeladen und zur Prüfung eingereicht.' });
  } catch (error) {
    console.error('Fehler beim Speichern des Passbilds:', error);
    res.status(500).json({ error: 'Fehler beim Speichern: ' + error.message });
  }
});

router.encrypt = encrypt;
router.decrypt = decrypt;

module.exports = router;
