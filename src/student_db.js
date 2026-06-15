const mysql = require('mysql2/promise');
const { db, getConfig } = require('./db'); // Fallback SQLite und Config

let pool = null;

/**
 * Gibt die MySQL-Konfigurationsparameter aus SQLite und Umgebungsvariablen zurück.
 */
function getMySQLConfig() {
  const host = getConfig('mysql_host') || process.env.MYSQL_HOST || '';
  const port = getConfig('mysql_port') || process.env.MYSQL_PORT || '3306';
  const user = getConfig('mysql_user') || process.env.MYSQL_USER || 'root';
  const password = getConfig('mysql_password') || process.env.MYSQL_PASSWORD || '';
  const database = getConfig('mysql_database') || process.env.MYSQL_DATABASE || 'digitale_anmeldung';
  const enabled = getConfig('mysql_enabled') || (process.env.MYSQL_HOST ? '1' : '0');

  return {
    host,
    port: parseInt(port, 10) || 3306,
    user,
    password,
    database,
    enabled: enabled === '1'
  };
}

/**
 * Baut die Verbindung zum MySQL-Server auf. Kann dynamisch im Betrieb aufgerufen werden.
 */
async function reconnectMySQL() {
  if (pool) {
    console.log('Schließe bestehenden MySQL-Verbindungspool...');
    try {
      await pool.end();
    } catch (err) {
      console.error('Fehler beim Schließen des MySQL-Pools:', err);
    }
    pool = null;
  }

  const config = getMySQLConfig();
  if (config.enabled && config.host) {
    console.log(`Verbinde mit MySQL-Datenbank auf ${config.host}:${config.port}...`);
    try {
      pool = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
    } catch (err) {
      console.error('Fehler beim Erstellen des MySQL-Pools:', err);
    }
  }
}

/**
 * Testet eine MySQL-Verbindung mit den angegebenen Verbindungsparametern.
 */
async function testMySQLConnection(config) {
  const connection = await mysql.createConnection({
    host: config.host,
    port: parseInt(config.port || '3306', 10),
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: 5000
  });
  await connection.ping();
  await connection.end();
  return true;
}

// Initialer Verbindungsaufbau beim Laden des Moduls
reconnectMySQL();

/**
 * Hilfsfunktion zum Mappen der MySQL dynamic fieldvalues Zeilen in ein flaches Profil-Objekt.
 */
function buildProfileFromMySQL(userId, applicationId, rows, photoFile) {
  const profile = {
    user_id: userId,
    application_id: applicationId,
    first_name: '',
    last_name: '',
    birth_date: null,
    birth_place: '',
    mediothek_number: '',
    start_password: '',
    account_status: 'false',
    card_status: 'Bild ungeprüft / Kein Bild',
    card_image: photoFile || null,
    dsgvo_consent: 'Nein',
    publish_consent: 'Nein',
    usage_consent: 'Nein',
    videoconference_consent: 'Nein',
    card_processing_consent: 'Nein',
    paednetz_terms: 'Nein',
    wlan_terms: 'Nein',
    ms365_terms: 'Nein',
    paednetz_logging: 'Nein',
    wlan_logging: 'Nein',
    ms365_logging: 'Nein',
    onlinedienste_logging: 'Nein'
  };

  rows.forEach(row => {
    const val = (row.value || '').trim();
    switch (Number(row.field)) {
      case 1: profile.first_name = val; break;
      case 2: profile.last_name = val; break;
      case 3: profile.birth_date = val; break;
      case 11: profile.birth_place = val; break;
      case 18: profile.email = val; break;
      case 146: profile.username = val; break;
      case 147: profile.start_password = val; break;
      case 145: profile.mediothek_number = val; break;
      case 165: profile.sph_username = val; break;
      case 164: profile.sph_password = val; break;
      case 150: profile.account_status = val; break;
      case 158: {
        const lowerVal = val.toLowerCase();
        // ID 1131 (akzeptiert), 1132 (gedruckt), 1133 (ausgegeben)
        if (lowerVal.includes('akzeptiert') || lowerVal.includes('gedruckt') || lowerVal.includes('ausgegeben') || ['1131', '1132', '1133'].includes(lowerVal)) {
          profile.card_status = 'Bild genehmigt';
        }
        // ID 1134 (abgelehnt)
        else if (lowerVal.includes('abgelehnt') || lowerVal === '1134') {
          profile.card_status = 'Bild abgelehnt';
        }
        // ID 1130 (ungeprüft / kein bild)
        else if (lowerVal.includes('ungeprüft') || lowerVal.includes('kein bild') || lowerVal === '1130') {
          if (photoFile) {
            profile.card_status = 'Bild eingereicht';
          } else {
            profile.card_status = 'Bild ungeprüft / Kein Bild';
          }
        }
        else {
          profile.card_status = 'Bild ungeprüft / Kein Bild';
        }
        break;
      }
      case 39: profile.dsgvo_consent = val; break;
      case 87: profile.publish_consent = val; break;
      case 88: profile.usage_consent = val; break;
      case 90: profile.videoconference_consent = val; break;
      case 91: profile.card_processing_consent = val; break;
      case 93: profile.paednetz_terms = val; break;
      case 94: profile.wlan_terms = val; break;
      case 95: profile.ms365_terms = val; break;
      case 99: profile.paednetz_logging = val; break;
      case 96: profile.wlan_logging = val; break;
      case 97: profile.ms365_logging = val; break;
      case 98: profile.onlinedienste_logging = val; break;
    }
  });

  return profile;
}

function getLocalProfile(userId) {
  return db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(userId);
}

function getLocalAllStudents() {
  return db.prepare(`
    SELECT sp.*, u.username, u.email
    FROM student_profiles sp
    JOIN users u ON sp.user_id = u.id
    ORDER BY sp.last_name ASC, sp.first_name ASC
  `).all();
}

/**
 * Holt das Schülerprofil wahlweise aus MySQL oder SQLite.
 */
async function getStudentProfile(user) {
  if (pool) {
    try {
      let applicationId = null;
      
      // 1. Primär nach Benutzernamen (Feld 146) suchen
      if (user && user.username) {
        const [userRows] = await pool.query(
          'SELECT application FROM fieldvalues WHERE field = 146 AND value = ?',
          [user.username.trim()]
        );
        if (userRows.length > 0) {
          applicationId = userRows[0].application;
        }
      }
      
      // 2. Sekundär nach E-Mail (Feld 18) suchen
      if (!applicationId && user && user.email) {
        const email = user.email.trim();
        if (email && email.includes('@')) {
          const [emailRows] = await pool.query(
            'SELECT application FROM fieldvalues WHERE field = 18 AND value = ?',
            [email]
          );
          if (emailRows.length > 0) {
            applicationId = emailRows[0].application;
          }
        }
      }
      
      if (!applicationId) {
        return getLocalProfile(user.id);
      }

      const [fieldRows] = await pool.query(`
        SELECT fv.field, f.type, 
               CASE WHEN f.type IN ('select', 'radio', 'checkboxes') THEN sf.value ELSE fv.value END AS value
        FROM fieldvalues fv
        JOIN fields f ON fv.field = f.ID
        LEFT JOIN subfields sf ON sf.ID = fv.value
        WHERE fv.application = ?
      `, [applicationId]);

      const [photoRows] = await pool.query(
        'SELECT file FROM images WHERE application = ? AND field = 37',
        [applicationId]
      );
      let photoFile = null;
      if (photoRows.length > 0) {
        const rawFile = photoRows[0].file;
        photoFile = Buffer.isBuffer(rawFile) ? rawFile.toString('utf-8') : rawFile;
      }

      return buildProfileFromMySQL(user.id, applicationId, fieldRows, photoFile);
    } catch (err) {
      console.error('MySQL Error in getStudentProfile:', err);
      return getLocalProfile(user.id);
    }
  } else {
    return getLocalProfile(user.id);
  }
}

/**
 * Hilfsfunktion zur Ermittlung der Antrags-ID aus der E-Mail oder einer virtuellen User-ID (>= 1000).
 */
async function getApplicationId(userId, email) {
  if (pool) {
    // 1. Primär über den Benutzernamen (aus der SQLite-DB anhand der userId geladen) suchen
    if (userId) {
      const localUser = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
      if (localUser && localUser.username) {
        const [rows] = await pool.query(
          'SELECT application FROM fieldvalues WHERE field = 146 AND value = ?',
          [localUser.username.trim()]
        );
        if (rows.length > 0) {
          return rows[0].application;
        }
      }
    }

    // 2. Sekundär über die E-Mail suchen (nur wenn valide)
    const trimmedEmail = (email || '').trim();
    if (trimmedEmail && trimmedEmail.includes('@')) {
      const [rows] = await pool.query(
        'SELECT application FROM fieldvalues WHERE field = 18 AND value = ?',
        [trimmedEmail]
      );
      if (rows.length > 0) {
        return rows[0].application;
      }
    }
  }
  if (userId && parseInt(userId, 10) >= 1000) {
    return parseInt(userId, 10) - 1000;
  }
  return null;
}

/**
 * Speichert ein Passbild ab.
 */
async function updateStudentPhoto(userId, email, base64Image) {
  if (pool) {
    try {
      const applicationId = await getApplicationId(userId, email);
      if (applicationId) {
        await pool.query(
          'REPLACE INTO images (file, application, field) VALUES (?, ?, 37)',
          [base64Image, applicationId]
        );

        await pool.query(
          "UPDATE fieldvalues SET value = '1130' WHERE application = ? AND field = 158",
          [applicationId]
        );
        return { success: true };
      }
    } catch (err) {
      console.error('MySQL Error in updateStudentPhoto:', err);
    }
  }
  
  db.prepare(`
    UPDATE student_profiles
    SET card_image = ?, card_status = 'Bild eingereicht'
    WHERE user_id = ?
  `).run(base64Image, userId);
  return { success: true };
}

/**
 * Gibt alle Profile für den Admin-Bereich zurück.
 */
async function getAllStudents() {
  if (pool) {
    try {
      const [appRows] = await pool.query(
        'SELECT DISTINCT application FROM fieldvalues'
      );
      
      const studentsList = [];

      for (const appRow of appRows) {
        const appId = appRow.application;

        const [fieldRows] = await pool.query(`
          SELECT fv.field, f.type, 
                 CASE WHEN f.type IN ('select', 'radio', 'checkboxes') THEN sf.value ELSE fv.value END AS value
          FROM fieldvalues fv
          JOIN fields f ON fv.field = f.ID
          LEFT JOIN subfields sf ON sf.ID = fv.value
          WHERE fv.application = ?
        `, [appId]);

        const [photoRows] = await pool.query(
          'SELECT file FROM images WHERE application = ? AND field = 37',
          [appId]
        );
        let photoFile = null;
        if (photoRows.length > 0) {
          const rawFile = photoRows[0].file;
          photoFile = Buffer.isBuffer(rawFile) ? rawFile.toString('utf-8') : rawFile;
        }

        const emailRow = fieldRows.find(r => Number(r.field) === 18);
        const email = emailRow ? emailRow.value : '';

        if (!email) continue;

        let localUser = db.prepare('SELECT id, username, email FROM users WHERE email = ?').get(email);
        let userId = localUser ? localUser.id : 1000 + appId;

        const profile = buildProfileFromMySQL(userId, appId, fieldRows, photoFile);
        profile.username = localUser ? localUser.username : email.split('@')[0];
        profile.email = email;
        
        studentsList.push(profile);
      }

      return studentsList;
    } catch (err) {
      console.error('MySQL Error in getAllStudents:', err);
      return getLocalAllStudents();
    }
  } else {
    return getLocalAllStudents();
  }
}

/**
 * Genehmigt das Foto.
 */
async function approvePhoto(userId, email) {
  if (pool) {
    try {
      const applicationId = await getApplicationId(userId, email);
      if (applicationId) {
        await pool.query(
          "UPDATE fieldvalues SET value = '1131' WHERE application = ? AND field = 158",
          [applicationId]
        );
        return { success: true };
      }
    } catch (err) {
      console.error('MySQL Error in approvePhoto:', err);
    }
  }
  
  db.prepare(`
    UPDATE student_profiles
    SET card_status = 'Bild genehmigt'
    WHERE user_id = ?
  `).run(userId);
  return { success: true };
}

/**
 * Lehnt das Foto ab.
 */
async function rejectPhoto(userId, email) {
  if (pool) {
    try {
      const applicationId = await getApplicationId(userId, email);
      if (applicationId) {
        await pool.query(
          "UPDATE fieldvalues SET value = '1132' WHERE application = ? AND field = 158",
          [applicationId]
        );
        return { success: true };
      }
    } catch (err) {
      console.error('MySQL Error in rejectPhoto:', err);
    }
  }
  
  db.prepare(`
    UPDATE student_profiles
    SET card_status = 'Bild abgelehnt'
    WHERE user_id = ?
  `).run(userId);
  return { success: true };
}

/**
 * Löscht das Foto.
 */
async function deletePhoto(userId, email) {
  if (pool) {
    try {
      const applicationId = await getApplicationId(userId, email);
      if (applicationId) {
        await pool.query(
          'DELETE FROM images WHERE application = ? AND field = 37',
          [applicationId]
        );

        await pool.query(
          "UPDATE fieldvalues SET value = '1129' WHERE application = ? AND field = 158",
          [applicationId]
        );
        return { success: true };
      }
    } catch (err) {
      console.error('MySQL Error in deletePhoto:', err);
    }
  }
  
  db.prepare(`
    UPDATE student_profiles
    SET card_image = NULL, card_status = 'Bild ungeprüft / Kein Bild'
    WHERE user_id = ?
  `).run(userId);
  return { success: true };
}

/**
 * Aktualisiert ein Profil.
 */
async function updateStudentProfile(userId, email, data) {
  if (pool) {
    try {
      const applicationId = await getApplicationId(userId, email);
      if (applicationId) {
        const updates = [
          { field: 1, value: data.first_name },
          { field: 2, value: data.last_name },
          { field: 3, value: data.birth_date },
          { field: 11, value: data.birth_place },
          { field: 145, value: data.mediothek_number },
          { field: 150, value: data.account_status }
        ];

        for (const update of updates) {
          if (update.value !== undefined) {
            await pool.query(`
              INSERT INTO fieldvalues (application, field, value)
              VALUES (?, ?, ?)
              ON DUPLICATE KEY UPDATE value = ?
            `, [applicationId, update.field, update.value, update.value]);
          }
        }
        return { success: true };
      }
    } catch (err) {
      console.error('MySQL Error in updateStudentProfile:', err);
    }
  }

  db.prepare(`
    UPDATE student_profiles
    SET first_name = ?, last_name = ?, birth_date = ?, birth_place = ?, mediothek_number = ?, account_status = ?
    WHERE user_id = ?
  `).run(
    data.first_name || '', 
    data.last_name || '', 
    data.birth_date || null, 
    data.birth_place || '', 
    data.mediothek_number || '', 
    data.account_status || 'false', 
    userId
  );
  return { success: true };
}

/**
 * Sucht nach einem Schüler anhand der registrierten E-Mail-Adresse.
 */
async function getStudentByEmail(email) {
  const trimmedEmail = (email || '').trim();
  if (pool && trimmedEmail && trimmedEmail.includes('@')) {
    try {
      const [rows] = await pool.query(`
        SELECT fv.application AS application_id, app.status AS status
        FROM fieldvalues fv
        JOIN applications app ON fv.application = app.ID
        WHERE fv.field = 18 AND fv.value = ?
      `, [trimmedEmail]);
      
      if (rows.length > 0) {
        const app = rows[0];
        return {
          exists: true,
          application_id: app.application_id,
          account_status: app.status === 10 ? 'true' : 'false'
        };
      }
    } catch (err) {
      console.error('MySQL Error in getStudentByEmail:', err);
    }
  }

  // SQLite Fallback
  const row = db.prepare(`
    SELECT u.id, sp.account_status 
    FROM users u 
    JOIN student_profiles sp ON u.id = sp.user_id 
    WHERE u.email = ?
  `).get(email.trim());

  if (row) {
    return {
      exists: true,
      id: row.id,
      account_status: row.account_status
    };
  }
  return null;
}

/**
 * Erzeugt ein neues E-Mail-Token für den Schüler-Erstlogin.
 */
async function createStudentToken(email, token, ip) {
  let userId;
  const trimmedEmail = (email || '').trim();
  
  if (pool && trimmedEmail && trimmedEmail.includes('@')) {
    try {
      const [rows] = await pool.query(
        'SELECT application FROM fieldvalues WHERE field = 18 AND value = ?',
        [trimmedEmail]
      );
      if (rows.length > 0) {
        const applicationId = rows[0].application;
        
        // Versuchen, das Token auch in MySQL zu loggen, damit andere Altsysteme synchron sind.
        try {
          await pool.query(
            'INSERT INTO schueleremailtokens (token, IDapplication, state, datetime) VALUES (?, ?, 0, NOW())',
            [token, applicationId]
          );
          await pool.query(`
            INSERT INTO documentation (user, application, category, task, page, element, comment, value, ip)
            VALUES (NULL, ?, 'Information', 'Erhebung/Veränderung', 'sendmaillogin', NULL, ?, ?, ?)
          `, [applicationId, `Neuer Token erstellt: ${token}`, email.trim(), ip || '127.0.0.1']);
        } catch (mysqlErr) {
          console.warn('MySQL-Token-Logging fehlgeschlagen:', mysqlErr.message);
        }

        // Lokalen SQLite-Nutzer prüfen/anlegen
        let localUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
        if (!localUser) {
          const [fieldRows] = await pool.query(
            'SELECT field, value FROM fieldvalues WHERE application = ? AND field IN (1, 2, 146)',
            [applicationId]
          );
          const firstNameRow = fieldRows.find(r => Number(r.field) === 1);
          const lastNameRow = fieldRows.find(r => Number(r.field) === 2);
          const usernameRow = fieldRows.find(r => Number(r.field) === 146);

          const firstName = firstNameRow ? firstNameRow.value.trim() : '';
          const lastName = lastNameRow ? lastNameRow.value.trim() : '';
          const username = usernameRow ? usernameRow.value.trim() : email.trim().split('@')[0];

          const info = db.prepare(`
            INSERT INTO users (username, email, role, groups, is_ldap)
            VALUES (?, ?, 'user', '["Schueler"]', 0)
          `).run(username, email.trim());
          userId = info.lastInsertRowid;

          db.prepare(`
            INSERT OR IGNORE INTO student_profiles (user_id, first_name, last_name, card_status)
            VALUES (?, ?, ?, 'Bild ungeprüft / Kein Bild')
          `).run(userId, firstName, lastName);
        } else {
          userId = localUser.id;
        }
      }
    } catch (err) {
      console.error('MySQL Error in createStudentToken:', err);
    }
  }

  if (!userId) {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
    if (user) {
      userId = user.id;
    }
  }

  if (userId) {
    db.prepare('DELETE FROM student_tokens WHERE user_id = ?').run(userId);
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO student_tokens (user_id, token, expires_at, used)
      VALUES (?, ?, ?, 0)
    `).run(userId, token, expiresAt);
    return { success: true };
  }

  return { success: false, error: 'Der Benutzer konnte im lokalen Cache nicht gefunden oder synchronisiert werden.' };
}

/**
 * Verifiziert das E-Mail-Token und gibt das zugehörige Benutzer-Objekt zurück.
 */
async function verifyStudentToken(token, ip) {
  // SQLite Prüfung (immer primär)
  const nowStr = new Date().toISOString();
  const row = db.prepare(`
    SELECT * FROM student_tokens 
    WHERE token = ? AND expires_at > ? AND used = 0
  `).get(token, nowStr);

  if (row) {
    db.prepare('UPDATE student_tokens SET used = 1 WHERE id = ?').run(row.id);

    // Synchronisation mit MySQL (falls aktiv)
    if (pool) {
      try {
        await pool.query(
          'UPDATE schueleremailtokens SET state = 1 WHERE token = ?',
          [token]
        );
        const [tokenRows] = await pool.query(
          'SELECT IDapplication FROM schueleremailtokens WHERE token = ?',
          [token]
        );
        if (tokenRows.length > 0) {
          const applicationId = tokenRows[0].IDapplication;
          await pool.query(`
            INSERT INTO documentation (user, application, category, task, page, element, comment, value, ip)
            VALUES (NULL, ?, 'Information', 'Abfrage', 'lobby', 'schueleremailtokens', 'Token gefunden und entwertet via MSO-Cloud.', ?, ?)
          `, [applicationId, token, ip || '127.0.0.1']);
        }
      } catch (err) {
        console.error('MySQL-Synchronisation bei Token-Verifizierung fehlgeschlagen:', err.message);
      }
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    if (user) {
      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          groups: JSON.parse(user.groups || '[]'),
          isLdap: false,
          display_name: user.display_name || ''
        }
      };
    }
  }

  // Fallback: Versuche, das Token direkt aus MySQL zu lesen (falls es von externen Systemen wie PHP erstellt wurde)
  if (pool) {
    try {
      // Veraltete Tokens löschen (> 20 Min)
      await pool.query(
        'DELETE FROM schueleremailtokens WHERE datetime < NOW() - INTERVAL 20 MINUTE'
      );

      const [tokenRows] = await pool.query(
        'SELECT IDapplication, state FROM schueleremailtokens WHERE token = ? AND state = 0',
        [token]
      );

      if (tokenRows.length > 0) {
        const applicationId = tokenRows[0].IDapplication;

        await pool.query(
          'UPDATE schueleremailtokens SET state = 1 WHERE token = ?',
          [token]
        );

        await pool.query(`
          INSERT INTO documentation (user, application, category, task, page, element, comment, value, ip)
          VALUES (NULL, ?, 'Information', 'Abfrage', 'lobby', 'schueleremailtokens', 'Token in MySQL gefunden und entwertet.', ?, ?)
        `, [applicationId, token, ip || '127.0.0.1']);

        const [emailRows] = await pool.query(
          'SELECT value FROM fieldvalues WHERE application = ? AND field = 18',
          [applicationId]
        );

        const email = emailRows.length > 0 ? emailRows[0].value.trim() : '';
        if (email) {
          let localUser = db.prepare('SELECT id, username, email, role, groups FROM users WHERE email = ?').get(email);
          let userId;
          let username;
          let role = 'user';
          let groupsJson = '["Schueler"]';

          if (!localUser) {
            // Seede den Benutzer temporär in der lokalen SQLite
            const [fieldRows] = await pool.query(
              'SELECT field, value FROM fieldvalues WHERE application = ? AND field IN (1, 2, 146)',
              [applicationId]
            );
            const firstNameRow = fieldRows.find(r => Number(r.field) === 1);
            const lastNameRow = fieldRows.find(r => Number(r.field) === 2);
            const usernameRow = fieldRows.find(r => Number(r.field) === 146);

            const firstName = firstNameRow ? firstNameRow.value.trim() : '';
            const lastName = lastNameRow ? lastNameRow.value.trim() : '';
            username = usernameRow ? usernameRow.value.trim() : email.split('@')[0];

            const info = db.prepare(`
              INSERT INTO users (username, email, role, groups, is_ldap)
              VALUES (?, ?, 'user', ?, 0)
            `).run(username, email);
            userId = info.lastInsertRowid;

            db.prepare(`
              INSERT OR IGNORE INTO student_profiles (user_id, first_name, last_name, card_status)
              VALUES (?, ?, ?, 'Bild ungeprüft / Kein Bild')
            `).run(userId, firstName, lastName);
          } else {
            userId = localUser.id;
            username = localUser.username;
            role = localUser.role;
            groupsJson = localUser.groups || '[]';
          }

          return {
            success: true,
            user: {
              id: userId,
              username: username,
              email: email,
              role: role,
              groups: JSON.parse(groupsJson),
              isLdap: false
            }
          };
        }
      }
    } catch (err) {
      console.error('MySQL Error in verifyStudentToken (direct query):', err);
    }
  }

  return { success: false, error: 'Der Anmeldelink ist ungültig oder abgelaufen (20 Minuten Gültigkeit).' };
}

module.exports = {
  getStudentProfile,
  updateStudentPhoto,
  getAllStudents,
  approvePhoto,
  rejectPhoto,
  deletePhoto,
  updateStudentProfile,
  getStudentByEmail,
  createStudentToken,
  verifyStudentToken,
  reconnectMySQL,
  testMySQLConnection
};

