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
 * Normalisiert einen String für sicheren Namensvergleich (Umlaute, NFC, Whitespace, Lowercase).
 */
function normalizeName(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ');
}

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
    email: '',
    username: '',
    start_password: '',
    mediothek_number: '',
    sph_username: '',
    sph_password: '',
    untis_username: '',
    account_status: 'false',
    card_status: 'Bild ungeprüft / Kein Bild',
    card_status_code: '1130',
    card_image: photoFile,
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
    const val = String(row.value || '').trim();
    const rawVal = String(row.raw_value || '').trim();
    const subVal = String(row.subfield_value || '').trim();

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
      case 167: profile.untis_username = val; break;
      case 150: profile.account_status = val; break;
      case 158: {
        const lowerVal = val.toLowerCase();
        const lowerRaw = rawVal.toLowerCase();
        const lowerSub = subVal.toLowerCase();

        // 1. ZUERST explizite Sperr-/Ablehnungsstatus prüfen (1134 / deaktiviert / abgelehnt)
        const isRejected = lowerRaw === '1134' || lowerVal === '1134' || lowerRaw.includes('1134') ||
                           lowerSub.includes('abgelehnt') || lowerVal.includes('abgelehnt') ||
                           lowerSub.includes('deaktiviert') || lowerVal.includes('deaktiviert') ||
                           lowerSub.includes('gesperrt') || lowerVal.includes('gesperrt');

        // 2. 1133: Ausweis gedruckt / Plastikkarte produziert (Gültig & Aktiv)
        const isPrinted = lowerRaw === '1133' || lowerVal === '1133' || lowerRaw.includes('1133') ||
                          lowerSub.includes('ausgegeben') || lowerVal.includes('ausgegeben') ||
                          lowerSub.includes('gedruckt') || lowerVal.includes('gedruckt');

        // 3. 1131: Bild in Stufe 1 akzeptiert / eingereicht -> WEITERHIN IN PRÜFUNG (Ausweis gesperrt)
        const isPendingStage1 = lowerRaw === '1131' || lowerVal === '1131' || lowerRaw.includes('1131') ||
                                lowerSub.includes('akzeptiert') || lowerVal.includes('akzeptiert') ||
                                lowerSub.includes('eingereicht') || lowerVal.includes('eingereicht');

        // 4. 1132: Bild final genehmigt & verifiziert (Gültig & Aktiv) - Nur wenn NICHT deaktiviert/abgelehnt!
        const isApproved = !isRejected && (
          lowerRaw === '1132' || lowerVal === '1132' || lowerRaw.includes('1132') ||
          lowerSub.includes('genehmigt') || lowerVal.includes('genehmigt') ||
          lowerSub.includes('verifiziert') || lowerVal.includes('verifiziert') ||
          lowerSub.includes('freigegeben') || lowerVal.includes('freigegeben') ||
          lowerSub === 'aktiviert' || lowerVal === 'aktiviert'
        );

        if (isRejected) {
          profile.card_status = 'Bild abgelehnt';
          profile.card_status_code = '1134';
        } else if (isPrinted) {
          profile.card_status = 'Ausweis gedruckt';
          profile.card_status_code = '1133';
        } else if (isPendingStage1) {
          profile.card_status = 'Bild eingereicht';
          profile.card_status_code = '1131';
        } else if (isApproved) {
          profile.card_status = 'Bild genehmigt';
          profile.card_status_code = '1132';
        } else {
          // 1130: Wenn Foto hochgeladen -> in Prüfung (1131). Wenn kein Foto -> kein Bild (1130).
          if (photoFile) {
            profile.card_status = 'Bild eingereicht';
            profile.card_status_code = '1131';
          } else {
            profile.card_status = 'Bild ungeprüft / Kein Bild';
            profile.card_status_code = '1130';
          }
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
  const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(userId);
  if (profile) {
    const s = String(profile.card_status || '').toLowerCase();
    
    // Zuerst Sperr-/Ablehnungsstatus prüfen
    if (s.includes('abgelehnt') || s.includes('deaktiviert') || s.includes('gesperrt') || s === '1134') {
      profile.card_status = 'Bild abgelehnt';
      profile.card_status_code = '1134';
    } else if (s.includes('ausgegeben') || s.includes('gedruckt') || s === '1133') {
      profile.card_status = 'Ausweis gedruckt';
      profile.card_status_code = '1133';
    } else if (s.includes('eingereicht') || s.includes('akzeptiert') || s === '1131') {
      profile.card_status = 'Bild eingereicht';
      profile.card_status_code = '1131';
    } else if (s.includes('genehmigt') || s.includes('verifiziert') || s === 'aktiviert' || s === '1132') {
      profile.card_status = 'Bild genehmigt';
      profile.card_status_code = '1132';
    } else {
      if (profile.card_image) {
        profile.card_status = 'Bild eingereicht';
        profile.card_status_code = '1131';
      } else {
        profile.card_status = 'Bild ungeprüft / Kein Bild';
        profile.card_status_code = '1130';
      }
    }
    return profile;
  }
  return null;
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
 * 
 * @param {Object|number} user 
 * @param {Object} options
 * @param {boolean} options.isCardPath - Wenn true, wird bei erreichbarer MySQL-DB mit 0 Treffern kein SQLite-Fallback verwendet.
 */
async function getStudentProfile(user, { isCardPath = false } = {}) {
  let userObj = (typeof user === 'object' && user !== null) ? { ...user } : { id: user };
  
  if (!userObj.username && userObj.id) {
    try {
      const uRow = db.prepare('SELECT username, email FROM users WHERE id = ?').get(userObj.id);
      if (uRow) {
        userObj.username = uRow.username;
        userObj.email = uRow.email;
      }
    } catch (e) {}
  }

  const config = getMySQLConfig();

  if (config.enabled && pool) {
    try {
      let applicationId = null;
      
      // 1. Primär nach Benutzernamen (Feld 146) suchen
      if (userObj.username) {
        const [userRows] = await pool.query(
          'SELECT application FROM fieldvalues WHERE field = 146 AND value = ?',
          [userObj.username.trim()]
        );
        if (userRows.length > 0) {
          applicationId = userRows[0].application;
        }
      }
      
      // 2. Sekundär nach E-Mail (Feld 18) suchen (aktive Anträge mit Status >= 10 bevorzugen)
      if (!applicationId && userObj.email) {
        const email = userObj.email.trim();
        if (email && email.includes('@')) {
          const [emailRows] = await pool.query(`
            SELECT fv.application, app.status 
            FROM fieldvalues fv
            JOIN applications app ON fv.application = app.ID
            WHERE fv.field = 18 AND LOWER(fv.value) = LOWER(?)
            ORDER BY app.status DESC
          `, [email]);
          if (emailRows.length > 0) {
            const activeApp = emailRows.find(r => r.status === 10 || r.status >= 10) || emailRows[0];
            applicationId = activeApp.application;
          }
        }
      }

      // 3. Tertiär nach Mediotheksnummer (Feld 145) suchen
      if (!applicationId && userObj.mediothek_number) {
        const [medRows] = await pool.query(
          'SELECT application FROM fieldvalues WHERE field = 145 AND value = ?',
          [String(userObj.mediothek_number).trim()]
        );
        if (medRows.length > 0) {
          applicationId = medRows[0].application;
        }
      }
      
      // Wenn MySQL erreichbar ist, aber kein Antrag existiert:
      if (!applicationId) {
        if (isCardPath) {
          // FEHLER 3: Bei erreichbarem MySQL und keinem Treffer im Ausweispfad KEIN SQLite-Fallback
          return null;
        }
        return getLocalProfile(userObj.id);
      }

      // Prüfen, ob der Antrag den Status >= 10 hat (im Ausweispfad zwingend)
      const [appRows] = await pool.query('SELECT status FROM applications WHERE ID = ?', [applicationId]);
      if (appRows.length === 0 || (isCardPath && appRows[0].status < 10)) {
        if (isCardPath) {
          return null;
        }
      }

      const [fieldRows] = await pool.query(`
        SELECT fv.field, f.type, 
               CASE WHEN f.type IN ('select', 'radio', 'checkboxes') THEN sf.value ELSE fv.value END AS value,
               fv.value AS raw_value,
               sf.value AS subfield_value
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
        photoFile = convertBlobToDataUrl(photoRows[0].file);
      }

      const mysqlProf = buildProfileFromMySQL(userObj.id, applicationId, fieldRows, photoFile);
      const localProf = getLocalProfile(userObj.id);
      if (localProf) {
        if (localProf.mediothek_number && !mysqlProf.mediothek_number) {
          mysqlProf.mediothek_number = localProf.mediothek_number;
        }
        if (localProf.start_password === 'geändert' || (localProf.start_password && !mysqlProf.start_password)) {
          mysqlProf.start_password = localProf.start_password;
        }
      }
      return mysqlProf;
    } catch (err) {
      console.error('[StudentDB] MySQL Verbindungsfehler in getStudentProfile:', err.message);
      // Nur bei echtem MySQL-Verbindungsfehler im Ausweispfad lokalen Cache für den Pufferpfad liefern
      return getLocalProfile(userObj.id) || null;
    }
  } else {
    return getLocalProfile(userObj.id) || null;
  }
}

function convertBlobToDataUrl(rawFile) {
  if (!rawFile) return null;
  const str = Buffer.isBuffer(rawFile) ? rawFile.toString('utf-8') : rawFile;
  return str;
}

/**
 * Hilfsfunktion zur Ermittlung der Antrags-ID aus der E-Mail oder einer virtuellen User-ID (>= 1000).
 */
async function getApplicationId(userId, email, conn = null) {
  const queryExecutor = conn || pool;
  if (queryExecutor) {
    // 1. Primär über den Benutzernamen suchen
    if (userId) {
      const localUser = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
      if (localUser && localUser.username) {
        const [rows] = await queryExecutor.query(
          'SELECT application FROM fieldvalues WHERE field = 146 AND value = ?',
          [localUser.username.trim()]
        );
        if (rows.length > 0) {
          return rows[0].application;
        }
      }
    }

    // 2. Sekundär über die E-Mail suchen
    const trimmedEmail = (email || '').trim();
    if (trimmedEmail && trimmedEmail.includes('@')) {
      const [rows] = await queryExecutor.query(`
        SELECT fv.application, app.status 
        FROM fieldvalues fv
        JOIN applications app ON fv.application = app.ID
        WHERE fv.field = 18 AND LOWER(fv.value) = LOWER(?)
        ORDER BY app.status DESC
      `, [trimmedEmail]);
      if (rows.length > 0) {
        const activeApp = rows.find(r => r.status === 10 || r.status >= 10) || rows[0];
        return activeApp.application;
      }
    }
  }
  if (userId && parseInt(userId, 10) >= 1000) {
    return parseInt(userId, 10) - 1000;
  }
  return null;
}

/**
 * Speichert ein Passbild transaktional in MySQL und synchronisiert SQLite.
 */
async function updateStudentPhoto(userId, email, base64Image) {
  const debugLog = [];
  debugLog.push(`Start updateStudentPhoto für userId=${userId}, email=${email}`);
  
  if (!userId) {
    return {
      success: false,
      mysqlSuccess: false,
      sqliteSuccess: false,
      error: 'Keine gültige Benutzer-ID angegeben.',
      debugLog
    };
  }
  
  let mysqlSuccess = false;
  let sqliteSuccess = false;

  if (pool) {
    debugLog.push("MySQL-Pool ist aktiv. Beziehe dedizierte Verbindung für Transaktion...");
    let conn;
    try {
      conn = (pool.getConnection && typeof pool.getConnection === 'function') ? await pool.getConnection() : pool;
      if (conn.beginTransaction && typeof conn.beginTransaction === 'function') {
        await conn.beginTransaction();
      }

      const applicationId = await getApplicationId(userId, email, conn);
      if (!applicationId) {
        if (conn.rollback && typeof conn.rollback === 'function') await conn.rollback();
        if (conn.release && typeof conn.release === 'function') conn.release();
        debugLog.push("FEHLER: Keine Application-ID für diesen Benutzer in MySQL gefunden.");
        return {
          success: false,
          mysqlSuccess: false,
          sqliteSuccess: false,
          error: 'Keine zugehörige Antrags-ID in der Schul-Datenbank (MySQL) gefunden.',
          debugLog
        };
      }

      debugLog.push(`Application-ID in MySQL ermittelt: ${applicationId}`);
      
      // Foto in images speichern
      await conn.query(`
        INSERT INTO images (file, application, field)
        VALUES (?, ?, 37)
        ON DUPLICATE KEY UPDATE file = ?
      `, [base64Image, applicationId, base64Image]);
      debugLog.push("MySQL: INSERT INTO images erfolgreich.");

      // Status in fieldvalues auf 1130 zurücksetzen
      const [resStatus] = await conn.query(`
        INSERT INTO fieldvalues (field, application, value, subset)
        VALUES (158, ?, '1130', 0)
        ON DUPLICATE KEY UPDATE value = '1130'
      `, [applicationId]);
      debugLog.push(`MySQL: Status auf 1130 zurückgesetzt. Affected: ${resStatus ? resStatus.affectedRows : 1}`);

      if (conn.commit && typeof conn.commit === 'function') {
        await conn.commit();
      }
      if (conn.release && typeof conn.release === 'function') {
        conn.release();
      }
      mysqlSuccess = true;
      debugLog.push("MySQL: Transaktion erfolgreich committet.");
    } catch (err) {
      if (conn) {
        if (conn.rollback && typeof conn.rollback === 'function') {
          try { await conn.rollback(); } catch (rbErr) {}
        }
        if (conn.release && typeof conn.release === 'function') {
          try { conn.release(); } catch (relErr) {}
        }
      }
      debugLog.push(`FEHLER bei MySQL-Transaktion: ${err.message}`);
      console.error('MySQL Transaction Error in updateStudentPhoto:', err);
      return {
        success: false,
        mysqlSuccess: false,
        sqliteSuccess: false,
        error: `Fehler bei der Übertragung an die Schul-Datenbank: ${err.message}`,
        debugLog
      };
    }
  } else {
    debugLog.push("MySQL ist nicht aktiv (pool ist null).");
  }
  
  try {
    debugLog.push(`Führe SQLite aus: UPDATE student_profiles SET card_status = 'Bild ungeprüft / Kein Bild' WHERE user_id = ${userId}...`);
    db.prepare(`
      UPDATE student_profiles
      SET card_image = ?, card_status = 'Bild ungeprüft / Kein Bild'
      WHERE user_id = ?
    `).run(base64Image, userId);
    debugLog.push("SQLite: UPDATE student_profiles erfolgreich.");
    sqliteSuccess = true;
  } catch (err) {
    debugLog.push(`FEHLER bei SQLite-Operation: ${err.message}`);
    console.error('SQLite Error in updateStudentPhoto:', err);
    return {
      success: false,
      mysqlSuccess,
      sqliteSuccess: false,
      error: `Fehler beim lokalen Speichern: ${err.message}`,
      debugLog
    };
  }
  
  return {
    success: true,
    mysqlSuccess,
    sqliteSuccess,
    debugLog
  };
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
                 CASE WHEN f.type IN ('select', 'radio', 'checkboxes') THEN sf.value ELSE fv.value END AS value,
                 fv.value AS raw_value,
                 sf.value AS subfield_value
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
          photoFile = convertBlobToDataUrl(photoRows[0].file);
        }

        const emailRow = fieldRows.find(r => Number(r.field) === 18);
        const email = emailRow ? emailRow.value : '';

        if (!email) continue;

        let localUser = db.prepare('SELECT id, username, email FROM users WHERE LOWER(email) = LOWER(?)').get(email);
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
 * Genehmigt das Foto transaktional.
 */
async function approvePhoto(userId, email) {
  if (pool) {
    let conn;
    try {
      conn = (pool.getConnection && typeof pool.getConnection === 'function') ? await pool.getConnection() : pool;
      if (conn.beginTransaction && typeof conn.beginTransaction === 'function') {
        await conn.beginTransaction();
      }

      const applicationId = await getApplicationId(userId, email, conn);
      if (!applicationId) {
        if (conn.rollback && typeof conn.rollback === 'function') await conn.rollback();
        if (conn.release && typeof conn.release === 'function') conn.release();
        return { success: false, error: 'Keine zugehörige Antrags-ID in der Schul-Datenbank (MySQL) gefunden.' };
      }
      await conn.query(`
        INSERT INTO fieldvalues (field, application, value, subset)
        VALUES (158, ?, '1132', 0)
        ON DUPLICATE KEY UPDATE value = '1132'
      `, [applicationId]);

      if (conn.commit && typeof conn.commit === 'function') {
        await conn.commit();
      }
      if (conn.release && typeof conn.release === 'function') {
        conn.release();
      }
    } catch (err) {
      if (conn) {
        if (conn.rollback && typeof conn.rollback === 'function') {
          try { await conn.rollback(); } catch (rb) {}
        }
        if (conn.release && typeof conn.release === 'function') {
          try { conn.release(); } catch (rel) {}
        }
      }
      console.error('MySQL Error in approvePhoto:', err);
      return { success: false, error: `MySQL-Fehler: ${err.message}` };
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
 * Lehnt das Foto transaktional ab.
 */
async function rejectPhoto(userId, email) {
  if (pool) {
    let conn;
    try {
      conn = (pool.getConnection && typeof pool.getConnection === 'function') ? await pool.getConnection() : pool;
      if (conn.beginTransaction && typeof conn.beginTransaction === 'function') {
        await conn.beginTransaction();
      }

      const applicationId = await getApplicationId(userId, email, conn);
      if (!applicationId) {
        if (conn.rollback && typeof conn.rollback === 'function') await conn.rollback();
        if (conn.release && typeof conn.release === 'function') conn.release();
        return { success: false, error: 'Keine zugehörige Antrags-ID in der Schul-Datenbank (MySQL) gefunden.' };
      }
      await conn.query(`
        INSERT INTO fieldvalues (field, application, value, subset)
        VALUES (158, ?, '1134', 0)
        ON DUPLICATE KEY UPDATE value = '1134'
      `, [applicationId]);

      if (conn.commit && typeof conn.commit === 'function') {
        await conn.commit();
      }
      if (conn.release && typeof conn.release === 'function') {
        conn.release();
      }
    } catch (err) {
      if (conn) {
        if (conn.rollback && typeof conn.rollback === 'function') {
          try { await conn.rollback(); } catch (rb) {}
        }
        if (conn.release && typeof conn.release === 'function') {
          try { conn.release(); } catch (rel) {}
        }
      }
      console.error('MySQL Error in rejectPhoto:', err);
      return { success: false, error: `MySQL-Fehler: ${err.message}` };
    }
  }
  
  db.prepare(`
    UPDATE student_profiles
    SET card_status = 'Bild abgelehnt'
    WHERE user_id = ?
  `).run(userId);

  try {
    const localUser = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (localUser && localUser.username) {
      const { revokePersistentGrant } = require('./services/cardEligibility');
      revokePersistentGrant(localUser.username);
    }
  } catch (e) {}

  return { success: true };
}

/**
 * Löscht das Foto transaktional.
 */
async function deletePhoto(userId, email) {
  if (pool) {
    let conn;
    try {
      conn = (pool.getConnection && typeof pool.getConnection === 'function') ? await pool.getConnection() : pool;
      if (conn.beginTransaction && typeof conn.beginTransaction === 'function') {
        await conn.beginTransaction();
      }

      const applicationId = await getApplicationId(userId, email, conn);
      if (!applicationId) {
        if (conn.rollback && typeof conn.rollback === 'function') await conn.rollback();
        if (conn.release && typeof conn.release === 'function') conn.release();
        return { success: false, error: 'Keine zugehörige Antrags-ID in der Schul-Datenbank (MySQL) gefunden.' };
      }
      await conn.query(
        'UPDATE images SET file = NULL WHERE application = ? AND field = 37',
        [applicationId]
      );

      await conn.query(`
        INSERT INTO fieldvalues (field, application, value, subset)
        VALUES (158, ?, '1130', 0)
        ON DUPLICATE KEY UPDATE value = '1130'
      `, [applicationId]);

      if (conn.commit && typeof conn.commit === 'function') {
        await conn.commit();
      }
      if (conn.release && typeof conn.release === 'function') {
        conn.release();
      }
    } catch (err) {
      if (conn) {
        if (conn.rollback && typeof conn.rollback === 'function') {
          try { await conn.rollback(); } catch (rb) {}
        }
        if (conn.release && typeof conn.release === 'function') {
          try { conn.release(); } catch (rel) {}
        }
      }
      console.error('MySQL Error in deletePhoto:', err);
      return { success: false, error: `MySQL-Fehler: ${err.message}` };
    }
  }
  
  db.prepare(`
    UPDATE student_profiles
    SET card_image = NULL, card_status = 'Bild ungeprüft / Kein Bild'
    WHERE user_id = ?
  `).run(userId);

  try {
    const localUser = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (localUser && localUser.username) {
      const { revokePersistentGrant } = require('./services/cardEligibility');
      revokePersistentGrant(localUser.username);
    }
  } catch (e) {}

  return { success: true };
}

/**
 * Aktualisiert ein Profil transaktional.
 */
async function updateStudentProfile(userId, email, data) {
  if (pool) {
    let conn;
    try {
      conn = (pool.getConnection && typeof pool.getConnection === 'function') ? await pool.getConnection() : pool;
      if (conn.beginTransaction && typeof conn.beginTransaction === 'function') {
        await conn.beginTransaction();
      }

      const applicationId = await getApplicationId(userId, email, conn);
      if (!applicationId) {
        if (conn.rollback && typeof conn.rollback === 'function') await conn.rollback();
        if (conn.release && typeof conn.release === 'function') conn.release();
        return { success: false, error: 'Keine zugehörige Antrags-ID in der Schul-Datenbank (MySQL) gefunden.' };
      }
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
          await conn.query(`
            INSERT INTO fieldvalues (application, field, value)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE value = ?
          `, [applicationId, update.field, update.value, update.value]);
        }
      }

      if (conn.commit && typeof conn.commit === 'function') {
        await conn.commit();
      }
      if (conn.release && typeof conn.release === 'function') {
        conn.release();
      }
    } catch (err) {
      if (conn) {
        if (conn.rollback && typeof conn.rollback === 'function') {
          try { await conn.rollback(); } catch (rb) {}
        }
        if (conn.release && typeof conn.release === 'function') {
          try { conn.release(); } catch (rel) {}
        }
      }
      console.error('MySQL Error in updateStudentProfile:', err);
      return { success: false, error: `MySQL-Fehler: ${err.message}` };
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
        WHERE fv.field = 18 AND LOWER(fv.value) = LOWER(?)
        ORDER BY app.status DESC
      `, [trimmedEmail]);
      
      if (rows.length > 0) {
        const activeApp = rows.find(r => r.status === 10 || r.status >= 10);
        const selectedApp = activeApp || rows[0];

        return {
          exists: true,
          application_id: selectedApp.application_id,
          account_status: (selectedApp.status === 10 || selectedApp.status >= 10) ? 'true' : 'false'
        };
      }
    } catch (err) {
      console.error('MySQL Error in getStudentByEmail:', err);
    }
  }

  // SQLite Fallback
  const rows = db.prepare(`
    SELECT u.id, sp.account_status 
    FROM users u 
    JOIN student_profiles sp ON u.id = sp.user_id 
    WHERE LOWER(u.email) = LOWER(?)
  `).all(email.trim());

  if (rows.length > 0) {
    const activeRow = rows.find(r => r.account_status === 'true') || rows[0];
    return {
      exists: true,
      id: activeRow.id,
      account_status: activeRow.account_status
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
      const [rows] = await pool.query(`
        SELECT fv.application, app.status 
        FROM fieldvalues fv
        JOIN applications app ON fv.application = app.ID
        WHERE fv.field = 18 AND LOWER(fv.value) = LOWER(?)
        ORDER BY app.status DESC
      `, [trimmedEmail]);

      if (rows.length > 0) {
        const activeApp = rows.find(r => r.status === 10 || r.status >= 10) || rows[0];
        const applicationId = activeApp.application;
        
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

        let localUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
        if (!localUser) {
          let firstName = '';
          let lastName = '';
          let username = email.trim().split('@')[0];

          try {
            const [fieldRows] = await pool.query(
              'SELECT field, value FROM fieldvalues WHERE application = ? AND field IN (1, 2, 146)',
              [applicationId]
            );
            const firstNameRow = fieldRows.find(r => Number(r.field) === 1);
            const lastNameRow = fieldRows.find(r => Number(r.field) === 2);
            const usernameRow = fieldRows.find(r => Number(r.field) === 146);

            firstName = firstNameRow ? firstNameRow.value.trim() : '';
            lastName = lastNameRow ? lastNameRow.value.trim() : '';
            username = usernameRow ? usernameRow.value.trim() : username;
          } catch (mysqlFetchErr) {
            console.warn('MySQL-Datenabfrage für Profile-Seeding fehlgeschlagen:', mysqlFetchErr.message);
          }

          try {
            let userByUsername = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);

            if (userByUsername) {
              db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.trim(), userByUsername.id);
              userId = userByUsername.id;
            } else {
              const isLdapVal = getConfig('ldap_enabled') === '1' ? 1 : 0;
              const info = db.prepare(`
                INSERT INTO users (username, email, role, groups, is_ldap)
                VALUES (?, ?, 'user', '["Schueler"]', ?)
              `).run(username, email.trim(), isLdapVal);
              userId = info.lastInsertRowid;
            }

            db.prepare(`
              INSERT OR IGNORE INTO student_profiles (user_id, first_name, last_name, card_status)
              VALUES (?, ?, ?, 'Bild ungeprüft / Kein Bild')
            `).run(userId, firstName, lastName);
          } catch (sqliteInsertErr) {
            console.error('SQLite-Fehler beim Anlegen oder Aktualisieren des Benutzers:', sqliteInsertErr);
            return { success: false, error: `Fehler beim lokalen Anlegen des Benutzers: ${sqliteInsertErr.message}` };
          }
        } else {
          userId = localUser.id;
        }
      }
    } catch (err) {
      console.error('MySQL Error in createStudentToken:', err);
      return { success: false, error: `MySQL-Synchronisationsfehler: ${err.message}` };
    }
  }

  if (!userId) {
    const user = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
    if (user) {
      userId = user.id;
    }
  }

  if (userId) {
    try {
      db.prepare('DELETE FROM student_tokens WHERE user_id = ?').run(userId);
      const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO student_tokens (user_id, token, expires_at, used)
        VALUES (?, ?, ?, 0)
      `).run(userId, token, expiresAt);
      return { success: true };
    } catch (sqliteTokenErr) {
      console.error('SQLite-Fehler beim Speichern des Tokens:', sqliteTokenErr);
      return { success: false, error: `Datenbankfehler beim Erstellen des Tokens: ${sqliteTokenErr.message}` };
    }
  }

  return { success: false, error: 'Der Benutzer konnte im lokalen Cache nicht gefunden oder synchronisiert werden.' };
}

/**
 * Verifiziert das E-Mail-Token und gibt das zugehörige Benutzer-Objekt zurück.
 */
async function verifyStudentToken(token, ip) {
  const nowStr = new Date().toISOString();
  const row = db.prepare(`
    SELECT * FROM student_tokens 
    WHERE token = ? AND expires_at > ? AND used = 0
  `).get(token, nowStr);

  if (row) {
    db.prepare('UPDATE student_tokens SET used = 1 WHERE id = ?').run(row.id);

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

  // Fallback: Token aus MySQL lesen
  if (pool) {
    try {
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
          let localUser = db.prepare('SELECT id, username, email, role, groups FROM users WHERE LOWER(email) = LOWER(?)').get(email);
          let userId;
          let username;
          let role = 'user';
          let groupsJson = '["Schueler"]';

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
            username = usernameRow ? usernameRow.value.trim() : email.split('@')[0];

            const isLdapVal = getConfig('ldap_enabled') === '1' ? 1 : 0;
            const info = db.prepare(`
              INSERT INTO users (username, email, role, groups, is_ldap)
              VALUES (?, ?, 'user', ?, ?)
            `).run(username, email, isLdapVal);
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

  return { success: false, error: 'Der Anmeldelink ist ungültig, bereits verwendet oder abgelaufen (Anmeldelinks sind nur 1x verwendbar und max. 20 Minuten gültig).' };
}

/**
 * Gezielte, datensparsame 2-Phasen-Abfrage für die QR-Code Verifikation (FEHLER 4, 5 & 6).
 * 
 * DATENSCHUTZREGELN:
 * - Phase 1: Sucht AUSSCHLIESSLICH über Mediotheksnummer (Feld 145) + Vorname (Feld 1) + Nachname (Feld 2) bei aktiven Anträgen (status >= 10).
 * - Namensabgleich: Vor- und Nachname müssen beide nicht-leer sein und matchen.
 * - Phase 2: Nur bei Treffer werden Username (146), Status (158) und Foto-Existenz (LENGTH > 20) abgefragt.
 * - Lädt KEIN Foto-Blob, kein Geburtsdatum, keine Zugangsdaten.
 * 
 * @param {string} bib - Mediotheksnummer (Feld 145)
 * @param {string} name - Vollständiger Name
 * @returns {Object|null} Minimales Prüfobjekt
 */
async function findStudentForVerification(bib, name) {
  const cleanBib = String(bib || '').trim();
  const cleanName = String(name || '').trim();

  if (!cleanBib || !cleanName) {
    return null;
  }

  const normQueryName = normalizeName(cleanName);
  const config = getMySQLConfig();

  // 1. Wenn MySQL aktiv ist: Gezielte 2-Phasen-Live-Abfrage
  if (config.enabled && pool) {
    try {
      // Phase 1: Minimalabfrage der Kandidaten über Mediotheksnummer (Feld 145) mit Vor-/Nachname (Felder 1, 2) und Status >= 10
      const [candidateRows] = await pool.query(`
        SELECT fv.application, fv.field, fv.value
        FROM fieldvalues fv
        JOIN applications a ON fv.application = a.ID
        WHERE a.status >= 10 
          AND fv.field IN (1, 2)
          AND fv.application IN (
            SELECT application FROM fieldvalues WHERE field = 145 AND value = ?
          )
      `, [cleanBib]);

      if (!candidateRows || candidateRows.length === 0) {
        return null;
      }

      // Kandidaten nach Antrags-ID gruppieren
      const appMap = new Map();
      for (const row of candidateRows) {
        if (!appMap.has(row.application)) {
          appMap.set(row.application, { first_name: '', last_name: '' });
        }
        const obj = appMap.get(row.application);
        if (Number(row.field) === 1) obj.first_name = String(row.value || '').trim();
        if (Number(row.field) === 2) obj.last_name = String(row.value || '').trim();
      }

      const matchingAppIds = [];
      for (const [appId, names] of appMap.entries()) {
        if (!names.first_name || !names.last_name) continue;
        const normFirst = normalizeName(names.first_name);
        const normLast = normalizeName(names.last_name);
        const normFullName1 = `${normFirst} ${normLast}`.trim();
        const normFullName2 = `${normLast} ${normFirst}`.trim();

        if (normQueryName === normFullName1 || normQueryName === normFullName2) {
          matchingAppIds.push({ appId, first_name: names.first_name, last_name: names.last_name });
        }
      }

      if (matchingAppIds.length !== 1) {
        if (matchingAppIds.length > 1) {
          console.warn(`[StudentDB] Mehrdeutiger Treffer bei QR-Verifizierung für Bib ${cleanBib}`);
        }
        return null;
      }

      const matchedCandidate = matchingAppIds[0];
      const matchedAppId = matchedCandidate.appId;

      // Phase 2: Detailfelder (146, 158) und Foto-Existenz gezielt für den gematchten Kandidaten abfragen
      const [detailRows] = await pool.query(`
        SELECT field, value FROM fieldvalues WHERE application = ? AND field IN (146, 158)
      `, [matchedAppId]);

      let username = '';
      let rawStatus = 'Bild ungeprüft / Kein Bild';
      let statusCode = '1130';

      for (const dr of detailRows || []) {
        const val = String(dr.value || '').trim();
        if (Number(dr.field) === 146) {
          username = val;
        } else if (Number(dr.field) === 158) {
          const lowerVal = val.toLowerCase();
          const isRejected = lowerVal === '1134' || lowerVal.includes('1134') || lowerVal.includes('abgelehnt') || lowerVal.includes('deaktiviert') || lowerVal.includes('gesperrt');
          const isPrinted = lowerVal === '1133' || lowerVal.includes('1133') || lowerVal.includes('ausgegeben') || lowerVal.includes('gedruckt');
          const isPendingStage1 = lowerVal === '1131' || lowerVal.includes('1131') || lowerVal.includes('akzeptiert') || lowerVal.includes('eingereicht');
          const isApproved = !isRejected && (lowerVal === '1132' || lowerVal.includes('1132') || lowerVal.includes('genehmigt') || lowerVal.includes('verifiziert') || lowerVal.includes('freigegeben') || lowerVal === 'aktiviert');

          if (isRejected) {
            rawStatus = 'Bild abgelehnt';
            statusCode = '1134';
          } else if (isPrinted) {
            rawStatus = 'Ausweis gedruckt';
            statusCode = '1133';
          } else if (isPendingStage1) {
            rawStatus = 'Bild eingereicht';
            statusCode = '1131';
          } else if (isApproved) {
            rawStatus = 'Bild genehmigt';
            statusCode = '1132';
          }
        }
      }

      // Foto-Existenz prüfen (nur LENGTH > 20, kein Blob-Transfer!)
      const [imgCheck] = await pool.query(
        'SELECT 1 FROM images WHERE application = ? AND field = 37 AND file IS NOT NULL AND LENGTH(file) > 20 LIMIT 1',
        [matchedAppId]
      );
      const hasPhoto = Array.isArray(imgCheck) && imgCheck.length > 0;

      return {
        applicationId: matchedAppId,
        username: username,
        mediothek_number: cleanBib,
        first_name: matchedCandidate.first_name,
        last_name: matchedCandidate.last_name,
        card_status: rawStatus,
        card_status_code: statusCode,
        has_photo: hasPhoto
      };
    } catch (err) {
      console.error('[StudentDB] MySQL Fehler in findStudentForVerification:', err.message);
      // Bei Verbindungsfehler Fallback auf lokalen Cache
    }
  }

  // 2. SQLite Fallback (nur bei Offline-Betrieb oder Verbindungsstörung)
  const localProf = db.prepare(`
    SELECT sp.user_id, sp.first_name, sp.last_name, sp.mediothek_number, sp.card_status,
           u.username, u.is_active,
           CASE WHEN sp.card_image IS NOT NULL AND LENGTH(sp.card_image) > 20 THEN 1 ELSE 0 END as has_photo
    FROM student_profiles sp
    JOIN users u ON sp.user_id = u.id
    WHERE sp.mediothek_number = ? AND u.is_active = 1
  `).all(cleanBib);

  const matched = localProf.filter(p => {
    if (!p.first_name || !p.last_name) return false;
    const normFirst = normalizeName(p.first_name);
    const normLast = normalizeName(p.last_name);
    return normQueryName === `${normFirst} ${normLast}`.trim() || normQueryName === `${normLast} ${normFirst}`.trim();
  });

  if (matched.length === 1) {
    const p = matched[0];
    const s = String(p.card_status || '').toLowerCase();
    let rawStatus = 'Bild ungeprüft / Kein Bild';
    let statusCode = '1130';

    if (s.includes('abgelehnt') || s.includes('deaktiviert') || s.includes('gesperrt') || s === '1134') {
      rawStatus = 'Bild abgelehnt';
      statusCode = '1134';
    } else if (s.includes('ausgegeben') || s.includes('gedruckt') || s === '1133') {
      rawStatus = 'Ausweis gedruckt';
      statusCode = '1133';
    } else if (s.includes('eingereicht') || s.includes('akzeptiert') || s === '1131') {
      rawStatus = 'Bild eingereicht';
      statusCode = '1131';
    } else if (s.includes('genehmigt') || s.includes('verifiziert') || s === 'aktiviert' || s === '1132') {
      rawStatus = 'Bild genehmigt';
      statusCode = '1132';
    }

    return {
      userId: p.user_id,
      username: p.username,
      mediothek_number: p.mediothek_number,
      first_name: p.first_name,
      last_name: p.last_name,
      card_status: rawStatus,
      card_status_code: statusCode,
      has_photo: p.has_photo === 1
    };
  }

  return null;
}


async function findStudentByVerificationReference(bib, id, name) {
  const match = await findStudentForVerification(bib, name);
  if (match) {
    return {
      user: { id: match.userId || null, username: match.username, is_active: 1 },
      profile: {
        first_name: match.first_name,
        last_name: match.last_name,
        mediothek_number: match.mediothek_number,
        card_status: match.card_status,
        card_status_code: match.card_status_code,
        card_image: match.has_photo ? 'data:image/jpeg;base64,mock' : null
      }
    };
  }
  return null;
}

module.exports = {
  getStudentProfile,
  findStudentForVerification,
  findStudentByVerificationReference,
  normalizeName,
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
