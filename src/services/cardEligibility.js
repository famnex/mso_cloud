const crypto = require('crypto');
const { db, getConfig } = require('../db');

/**
 * Status-Codes und Bezeichnungen:
 * 1130: Kein Bild / Ungeprüft
 * 1131: Bild eingereicht (Stufe 1 akzeptiert, weiterhin in Prüfung)
 * 1132: Bild final genehmigt & verifiziert
 * 1133: Ausweis gedruckt / Plastikkarte produziert
 * 1134: Bild abgelehnt / Deaktiviert
 */

const VERIFIED_STATUSES = new Set([
  'bild genehmigt',
  'genehmigt',
  'bild verifiziert',
  'ausweis gedruckt',
  'ausweis ausgegeben',
  '1132',
  '1133'
]);

const REVOKED_STATUSES = new Set([
  'ausweis gesperrt',
  'gesperrt',
  'ungültig',
  'ungueltig',
  'deaktiviert',
  '1134'
]);

/**
 * Berechnet das Stichtags-Ablaufdatum des laufenden Schuljahres (stets der 31. Juli).
 */
function getSchoolYearExpirationDate(now = new Date()) {
  const currentYear = now.getFullYear();
  const augustFirst = new Date(currentYear, 7, 1); // Monat 7 = August (0-basiert)
  
  let expirationYear = currentYear;
  if (now >= augustFirst) {
    expirationYear = currentYear + 1;
  }

  const expiresAt = `${expirationYear}-07-31`;
  const expiryDate = new Date(expirationYear, 6, 31, 23, 59, 59, 999);
  return { expiresAt, expiryDate };
}

/**
 * Berechnet eine konsistente Versionskennung für das Profil / Foto.
 */
function computeCardVersion(profile) {
  if (!profile) return 'v0';
  const raw = [
    profile.first_name || '',
    profile.last_name || '',
    profile.birth_date || '',
    profile.birth_place || '',
    profile.mediothek_number || '',
    profile.card_status || '',
    profile.card_status_code || '',
    profile.card_image ? crypto.createHash('sha256').update(String(profile.card_image)).digest('hex').substring(0, 16) : 'no_img'
  ].join('|');
  return 'v_' + crypto.createHash('md5').update(raw).digest('hex').substring(0, 12);
}

/**
 * Normalisiert einen Status-String oder Status-Code.
 */
function normalizeStatus(status, statusCode) {
  const s = String(status || '').trim().toLowerCase();
  const c = String(statusCode || '').trim().toLowerCase();
  return { statusStr: s, codeStr: c };
}

/**
 * Liest den persistenten Ausweis-Grant nach Username aus der Datenbank.
 */
function getGrantByUsername(username) {
  if (!username) return null;
  try {
    return db.prepare('SELECT * FROM student_card_grants WHERE username = ?').get(String(username).trim()) || null;
  } catch (err) {
    console.error('[CardEligibility] Fehler beim Lesen von student_card_grants nach Username:', err.message);
    return null;
  }
}

/**
 * Liest den persistenten Ausweis-Grant nach Mediotheksnummer aus der Datenbank.
 */
function getGrantByMediothekNumber(mediothekNumber) {
  if (!mediothekNumber) return null;
  try {
    return db.prepare('SELECT * FROM student_card_grants WHERE mediothek_number = ?').get(String(mediothekNumber).trim()) || null;
  } catch (err) {
    console.error('[CardEligibility] Fehler beim Lesen von student_card_grants nach Mediotheksnummer:', err.message);
    return null;
  }
}

/**
 * Liest den persistenten Ausweis-Grant nach user_id aus der Datenbank.
 */
function getGrantByUserId(userId) {
  if (!userId) return null;
  try {
    return db.prepare('SELECT * FROM student_card_grants WHERE user_id = ?').get(userId) || null;
  } catch (err) {
    console.error('[CardEligibility] Fehler beim Lesen von student_card_grants nach user_id:', err.message);
    return null;
  }
}

/**
 * Liest den persistenten Ausweis-Grant aus der Datenbank (nach Username, Mediotheksnummer oder expliziter numerischer user_id).
 * WICHTIG: Numerische Strings werden als Username oder Mediotheksnummer behandelt, NICHT als user_id!
 */
function getPersistentGrant(identifier) {
  if (!identifier) return null;
  try {
    if (typeof identifier === 'number') {
      return getGrantByUserId(identifier);
    }
    const strId = String(identifier).trim();
    const byUserStr = getGrantByUsername(strId);
    if (byUserStr) return byUserStr;
    return getGrantByMediothekNumber(strId);
  } catch (err) {
    console.error('[CardEligibility] Fehler beim Lesen von student_card_grants:', err.message);
    return null;
  }
}

/**
 * Speichert oder aktualisiert einen Ausweis-Grant persistent in SQLite.
 */
function savePersistentGrant({ userId, username, mediothekNumber, lastLdapSuccessAt, offlineValidUntil, schoolYearExpiresAt, isRevoked = 0, cardVersion = null }) {
  if (!username) {
    throw new Error('[CardEligibility] savePersistentGrant erfordert einen gültigen username.');
  }
  try {
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO student_card_grants (
        user_id, username, mediothek_number, last_ldap_success_at,
        offline_valid_until, school_year_expires_at, is_revoked, card_version, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        user_id = COALESCE(excluded.user_id, student_card_grants.user_id),
        mediothek_number = COALESCE(excluded.mediothek_number, student_card_grants.mediothek_number),
        last_ldap_success_at = COALESCE(excluded.last_ldap_success_at, student_card_grants.last_ldap_success_at),
        offline_valid_until = excluded.offline_valid_until,
        school_year_expires_at = excluded.school_year_expires_at,
        is_revoked = excluded.is_revoked,
        card_version = COALESCE(excluded.card_version, student_card_grants.card_version),
        updated_at = excluded.updated_at
    `).run(
      userId || null,
      String(username).trim(),
      mediothekNumber ? String(mediothekNumber).trim() : null,
      lastLdapSuccessAt || nowIso,
      offlineValidUntil,
      schoolYearExpiresAt,
      isRevoked ? 1 : 0,
      cardVersion || null,
      nowIso
    );
  } catch (err) {
    console.error('[CardEligibility] Fehler beim Speichern von student_card_grants:', err);
    throw err;
  }
}

/**
 * Widerruft einen Grant explizit (z.B. bei negativem LDAP-Befund, Entzug oder Sperre).
 */
function revokePersistentGrant(identifier) {
  if (!identifier) return;
  try {
    const nowIso = new Date().toISOString();
    if (typeof identifier === 'number') {
      db.prepare(`
        UPDATE student_card_grants 
        SET is_revoked = 1, offline_valid_until = ?, updated_at = ?
        WHERE user_id = ?
      `).run(nowIso, nowIso, identifier);
    } else {
      const cleanId = String(identifier).trim();
      db.prepare(`
        UPDATE student_card_grants 
        SET is_revoked = 1, offline_valid_until = ?, updated_at = ?
        WHERE username = ? OR mediothek_number = ?
      `).run(nowIso, nowIso, cleanId, cleanId);
    }
  } catch (err) {
    console.error('[CardEligibility] Fehler beim Widerrufen von student_card_grants:', err);
  }
}

/**
 * Bewertet deterministisch die Gültigkeit eines Schülerausweises unter Einbeziehung von
 * LDAP-Status, MySQL-Statusklassifikation, Schuljahresende und persistenten Ausfallpuffern.
 * 
 * @param {Object} options
 * @param {Object} options.user - Benutzerobjekt (users)
 * @param {Object} options.profile - Schülerprofil (student_profiles oder MySQL)
 * @param {Object} options.ldapStatus - Ergebnis von ldap.isUserActiveInLdap: { status: string, active: boolean, error: string|null }
 * @param {Object} options.mysqlStatus - Ergebnis/Klassifikation der MySQL-Abfrage: { status: 'found'|'not_found'|'connection_error'|'query_error'|'disabled', source: string }
 * @param {Date} options.now - Auswertungszeitpunkt (Standard: new Date())
 * @param {boolean} options.isAdminPreview - Flag, ob es sich um eine Admin-Vorschau handelt
 * @param {boolean} options.allowSaveGrant - Ob ein Live-Grant in SQLite gespeichert werden darf (Standard: true, false bei QR-Verifikation)
 * @returns {Object} Einheitlicher Ergebnisvertrag
 */
function evaluateCardEligibility(userOrOptions, profileArg, nowArg) {
  let user, profile, ldapStatus, mysqlStatus, now, isAdminPreview, allowSaveGrant, isQrVerification;
  if (userOrOptions && typeof userOrOptions === 'object' && ('user' in userOrOptions || 'ldapStatus' in userOrOptions || 'mysqlStatus' in userOrOptions || 'isAdminPreview' in userOrOptions || 'now' in userOrOptions || 'profile' in userOrOptions)) {
    user = userOrOptions.user;
    profile = userOrOptions.profile;
    ldapStatus = userOrOptions.ldapStatus !== undefined ? userOrOptions.ldapStatus : null;
    mysqlStatus = userOrOptions.mysqlStatus !== undefined ? userOrOptions.mysqlStatus : null;
    now = userOrOptions.now || new Date();
    isAdminPreview = userOrOptions.isAdminPreview || false;
    allowSaveGrant = userOrOptions.allowSaveGrant !== undefined ? userOrOptions.allowSaveGrant : true;
    isQrVerification = userOrOptions.isQrVerification || false;
  } else {
    user = userOrOptions;
    profile = profileArg;
    now = nowArg || new Date();
    ldapStatus = null;
    mysqlStatus = null;
    isAdminPreview = false;
    allowSaveGrant = true;
    isQrVerification = false;
  }

  const { expiresAt, expiryDate } = getSchoolYearExpirationDate(now);
  const isExpired = now > expiryDate;
  
  // Identitätsattribute strikt auflösen
  const targetUsername = (user && user.username) ? String(user.username).trim() : ((profile && profile.username) ? String(profile.username).trim() : '');
  const targetUserId = (user && typeof user.id === 'number') ? user.id : ((profile && typeof profile.user_id === 'number') ? profile.user_id : null);
  const targetMediothek = (profile && profile.mediothek_number) ? String(profile.mediothek_number).trim() : '';
  const cardVersion = computeCardVersion(profile);

  // 1. Normalisiere ldapStatus Status-Taxonomie zu Beginn
  let effectiveLdapStatus = 'not_checked';
  if (ldapStatus && typeof ldapStatus === 'object') {
    if (ldapStatus.status) {
      effectiveLdapStatus = ldapStatus.status;
    } else if (ldapStatus.error) {
      effectiveLdapStatus = 'unavailable';
    } else if (ldapStatus.active === true) {
      effectiveLdapStatus = 'active';
    } else if (ldapStatus.active === false) {
      effectiveLdapStatus = 'inactive';
    }
  }

  // 2. Normalisiere MySQL-Status
  let effectiveMysqlStatus = 'found';
  if (mysqlStatus && typeof mysqlStatus === 'object') {
    effectiveMysqlStatus = mysqlStatus.status || 'found';
  } else if (profile && profile._queryStatus) {
    effectiveMysqlStatus = profile._queryStatus;
  } else if (!profile) {
    effectiveMysqlStatus = 'not_found';
  }

  // 3. Admin-Vorschau: Kein echter Schülerausweis (Muster)
  if (isAdminPreview || (user && user.role === 'admin')) {
    return {
      valid: false,
      reasonCode: 'ADMIN_PREVIEW',
      statusSummary: 'Admin-Vorschau (Kein gültiger Schülerausweis)',
      rawStatus: 'Vorschau',
      expiresAt: expiresAt,
      offlineValidUntil: null,
      is_buffered: false,
      cardVersion: cardVersion
    };
  }

  // 4. Lokale Konto-Existenz und Aktivität prüfen
  if (!user || user.is_active === 0) {
    if (targetUsername) revokePersistentGrant(targetUsername);
    return {
      valid: false,
      reasonCode: 'ACCOUNT_INACTIVE',
      statusSummary: 'Benutzerkonto inaktiv oder gelöscht',
      rawStatus: profile ? profile.card_status : '',
      expiresAt: expiresAt,
      offlineValidUntil: null,
      is_buffered: false,
      cardVersion: cardVersion
    };
  }

  // 5. ZWINGENDE LDAP-PRÜFUNG: Negative oder unzureichende LDAP-Zustände MÜSSEN VOR jedem Ausfallpuffer ablehnen
  if (effectiveLdapStatus === 'inactive') {
    if (targetUsername) revokePersistentGrant(targetUsername);
    return {
      valid: false,
      reasonCode: 'ACCOUNT_INACTIVE',
      statusSummary: 'Benutzerkonto im LDAP nicht vorhanden oder deaktiviert',
      rawStatus: profile ? profile.card_status : '',
      expiresAt: expiresAt,
      offlineValidUntil: null,
      is_buffered: false,
      cardVersion: cardVersion
    };
  }

  if (effectiveLdapStatus === 'disabled') {
    return {
      valid: false,
      reasonCode: 'LDAP_DISABLED',
      statusSummary: 'LDAP ist in den Einstellungen deaktiviert',
      rawStatus: profile ? profile.card_status : '',
      expiresAt: expiresAt,
      offlineValidUntil: null,
      is_buffered: false,
      cardVersion: cardVersion
    };
  }

  if (effectiveLdapStatus === 'misconfigured') {
    return {
      valid: false,
      reasonCode: 'LDAP_MISCONFIGURED',
      statusSummary: 'LDAP-Zugangsdaten unvollständig konfiguriert',
      rawStatus: profile ? profile.card_status : '',
      expiresAt: expiresAt,
      offlineValidUntil: null,
      is_buffered: false,
      cardVersion: cardVersion
    };
  }

  if (effectiveLdapStatus === 'not_checked') {
    return {
      valid: false,
      reasonCode: 'NOT_CHECKED',
      statusSummary: 'LDAP-Prüfung nicht durchgeführt',
      rawStatus: profile ? profile.card_status : '',
      expiresAt: expiresAt,
      offlineValidUntil: null,
      is_buffered: false,
      cardVersion: cardVersion
    };
  }

  // (Ab hier ist effectiveLdapStatus garantiert entweder 'active' ODER 'unavailable')

  // 6. MySQL-Fehlerklassifikation: Fall b (not_found) & Fall d (query_error)
  if (effectiveMysqlStatus === 'not_found') {
    if (targetUsername) revokePersistentGrant(targetUsername);
    return {
      valid: false,
      reasonCode: 'PROFILE_NOT_FOUND',
      statusSummary: 'Kein Schülerprofil vorhanden',
      rawStatus: '',
      expiresAt: expiresAt,
      offlineValidUntil: null,
      is_buffered: false,
      cardVersion: 'v0'
    };
  }

  if (effectiveMysqlStatus === 'query_error') {
    return {
      valid: false,
      reasonCode: 'DATABASE_ERROR',
      statusSummary: 'Datenbankfehler bei Profilprüfung',
      rawStatus: '',
      expiresAt: expiresAt,
      offlineValidUntil: null,
      is_buffered: false,
      cardVersion: cardVersion
    };
  }

  // 7. Profil-Existenz prüfen (außer bei connection_error, wo Puffer geprüft wird)
  if (!profile && effectiveMysqlStatus !== 'connection_error') {
    if (targetUsername) revokePersistentGrant(targetUsername);
    return {
      valid: false,
      reasonCode: 'PROFILE_NOT_FOUND',
      statusSummary: 'Kein Schülerprofil vorhanden',
      rawStatus: '',
      expiresAt: expiresAt,
      offlineValidUntil: null,
      is_buffered: false,
      cardVersion: 'v0'
    };
  }

  const rawStatus = profile ? (profile.card_status || 'Bild ungeprüft / Kein Bild') : '';
  const { statusStr, codeStr } = normalizeStatus(rawStatus, profile ? profile.card_status_code : '');
  const hasImage = Boolean(profile && profile.card_image && String(profile.card_image).trim().length > 20);

  // 8. Wenn Profil vorhanden: Statusprüfungen (Sperrung, Ablauf, Foto)
  if (profile) {
    const isRevoked = REVOKED_STATUSES.has(statusStr) ||
                      REVOKED_STATUSES.has(codeStr) ||
                      codeStr === '1134' ||
                      statusStr.includes('deaktiviert') ||
                      statusStr.includes('gesperrt') ||
                      statusStr.includes('ungültig') ||
                      statusStr.includes('ungueltig');
    if (isRevoked) {
      if (targetUsername) revokePersistentGrant(targetUsername);
      return {
        valid: false,
        reasonCode: 'CARD_REVOKED',
        statusSummary: 'Ausweis gesperrt',
        rawStatus: rawStatus,
        expiresAt: expiresAt,
        offlineValidUntil: null,
        is_buffered: false,
        cardVersion: cardVersion
      };
    }

    if (isExpired) {
      return {
        valid: false,
        reasonCode: 'EXPIRED',
        statusSummary: `Abgelaufen (Gültig war bis ${expiresAt})`,
        rawStatus: rawStatus,
        expiresAt: expiresAt,
        offlineValidUntil: null,
        is_buffered: false,
        cardVersion: cardVersion
      };
    }

    if (!hasImage) {
      if (targetUsername && effectiveMysqlStatus !== 'connection_error') {
        revokePersistentGrant(targetUsername);
      }
      return {
        valid: false,
        reasonCode: 'NO_PHOTO',
        statusSummary: 'Kein Foto hinterlegt',
        rawStatus: rawStatus,
        expiresAt: expiresAt,
        offlineValidUntil: null,
        is_buffered: false,
        cardVersion: cardVersion
      };
    }

    const isVerified = VERIFIED_STATUSES.has(statusStr) || VERIFIED_STATUSES.has(codeStr);
    if (!isVerified) {
      if (targetUsername && effectiveMysqlStatus !== 'connection_error') {
        revokePersistentGrant(targetUsername);
      }
      return {
        valid: false,
        reasonCode: 'PHOTO_NOT_APPROVED',
        statusSummary: `Foto ungeprüft (${rawStatus})`,
        rawStatus: rawStatus,
        expiresAt: expiresAt,
        offlineValidUntil: null,
        is_buffered: false,
        cardVersion: cardVersion
      };
    }
  }

  // 9. Strikte Identitätsbindung & Grant-Lookup
  let existingGrant = targetUsername ? getGrantByUsername(targetUsername) : null;
  let identityConflict = false;
  
  if (!existingGrant && targetMediothek) {
    const grantByMed = getGrantByMediothekNumber(targetMediothek);
    if (grantByMed) {
      if (grantByMed.username && targetUsername && grantByMed.username !== targetUsername) {
        identityConflict = true;
      } else {
        existingGrant = grantByMed;
      }
    }
  }

  if (!existingGrant && typeof targetUserId === 'number') {
    const grantById = getGrantByUserId(targetUserId);
    if (grantById) {
      if (grantById.username && targetUsername && grantById.username !== targetUsername) {
        identityConflict = true;
      } else {
        existingGrant = grantById;
      }
    }
  }

  if (existingGrant && existingGrant.mediothek_number && targetMediothek && existingGrant.mediothek_number !== targetMediothek) {
    existingGrant = null;
  }

  // 10. Live-Prüfung erfolgreich (MySQL live & LDAP live active)
  if (effectiveMysqlStatus === 'found' && effectiveLdapStatus === 'active') {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const thirtyDaysFromNow = new Date(now.getTime() + thirtyDaysMs);
    const offlineExpiryDate = thirtyDaysFromNow < expiryDate ? thirtyDaysFromNow : expiryDate;
    const offlineValidUntil = offlineExpiryDate.toISOString();

    if (allowSaveGrant && targetUsername && !isQrVerification) {
      savePersistentGrant({
        userId: targetUserId || null,
        username: targetUsername,
        mediothekNumber: targetMediothek || null,
        lastLdapSuccessAt: now.toISOString(),
        offlineValidUntil: offlineValidUntil,
        schoolYearExpiresAt: expiresAt,
        isRevoked: 0,
        cardVersion: cardVersion
      });
    }

    return {
      valid: true,
      reasonCode: 'VALID',
      statusSummary: 'Gültig',
      rawStatus: rawStatus,
      expiresAt: expiresAt,
      offlineValidUntil: offlineValidUntil,
      is_buffered: false,
      cardVersion: isQrVerification && existingGrant ? (existingGrant.card_version || cardVersion) : cardVersion
    };
  }

  // 11. Ausfallpuffer-Prüfung (MySQL connection_error/disabled/unavailable ODER LDAP unavailable)
  if (
    effectiveMysqlStatus === 'connection_error' ||
    effectiveMysqlStatus === 'disabled' ||
    effectiveMysqlStatus === 'unavailable' ||
    effectiveLdapStatus === 'unavailable'
  ) {
    if (identityConflict) {
      return {
        valid: false,
        reasonCode: 'IDENTITY_MISMATCH',
        statusSummary: 'Widersprüchliche Identitätszuordnung (Grant gehört anderem Benutzer)',
        rawStatus: rawStatus,
        expiresAt: expiresAt,
        offlineValidUntil: null,
        is_buffered: false,
        cardVersion: cardVersion
      };
    }

    if (!existingGrant || existingGrant.is_revoked === 1) {
      const code = effectiveMysqlStatus === 'connection_error' ? 'MYSQL_UNAVAILABLE_NO_BUFFER' : 'LDAP_UNAVAILABLE_NO_BUFFER';
      const msg = effectiveMysqlStatus === 'connection_error' 
        ? 'Schul-Datenbank nicht erreichbar (keine vorherige Freigabe vorhanden)' 
        : 'LDAP-Verbindung gestört (keine vorherige Freigabe vorhanden)';
      return {
        valid: false,
        reasonCode: code,
        statusSummary: msg,
        rawStatus: rawStatus,
        expiresAt: expiresAt,
        offlineValidUntil: null,
        is_buffered: false,
        cardVersion: cardVersion
      };
    }

    const grantOfflineExpiry = new Date(existingGrant.offline_valid_until);
    const grantSchoolYearExpiry = new Date(existingGrant.school_year_expires_at + 'T23:59:59.999Z');

    if (now > grantOfflineExpiry || now > grantSchoolYearExpiry) {
      return {
        valid: false,
        reasonCode: 'OFFLINE_EXPIRED',
        statusSummary: 'Ausfallpuffer abgelaufen (erneute Online-Prüfung erforderlich)',
        rawStatus: rawStatus,
        expiresAt: existingGrant.school_year_expires_at,
        offlineValidUntil: existingGrant.offline_valid_until,
        is_buffered: true,
        cardVersion: existingGrant.card_version || cardVersion
      };
    }

    // Versionsprüfung: Im normalen Pfad gegen den berechneten Vollversions-Hash; im QR-Pfad wird die Integrität der bestehenden Freigabe validiert
    if (!isQrVerification) {
      if (existingGrant.card_version && cardVersion && cardVersion !== 'v0' && existingGrant.card_version !== cardVersion) {
        return {
          valid: false,
          reasonCode: 'VERSION_MISMATCH',
          statusSummary: 'Ausweis-Version nicht synchron (erneute Online-Prüfung erforderlich)',
          rawStatus: rawStatus,
          expiresAt: existingGrant.school_year_expires_at,
          offlineValidUntil: existingGrant.offline_valid_until,
          is_buffered: true,
          cardVersion: existingGrant.card_version
        };
      }
    } else {
      if (!existingGrant.card_version || existingGrant.card_version === 'v0') {
        return {
          valid: false,
          reasonCode: 'VERSION_MISMATCH',
          statusSummary: 'Ausweis-Freigabe unvollständig (erneute Online-Prüfung erforderlich)',
          rawStatus: rawStatus,
          expiresAt: existingGrant.school_year_expires_at,
          offlineValidUntil: existingGrant.offline_valid_until,
          is_buffered: true,
          cardVersion: 'v0'
        };
      }
    }

    return {
      valid: true,
      reasonCode: 'VALID_BUFFERED',
      statusSummary: 'Gültig (Ausfallpuffer aktiv)',
      rawStatus: rawStatus,
      expiresAt: existingGrant.school_year_expires_at,
      offlineValidUntil: existingGrant.offline_valid_until,
      is_buffered: true,
      cardVersion: existingGrant.card_version || cardVersion
    };
  }

  // Fallback (z.B. unbekannter Zustand)
  return {
    valid: false,
    reasonCode: 'UNKNOWN_ERROR',
    statusSummary: 'Gültigkeitsprüfung konnte nicht abgeschlossen werden',
    rawStatus: rawStatus,
    expiresAt: expiresAt,
    offlineValidUntil: null,
    is_buffered: false,
    cardVersion: cardVersion
  };
}

module.exports = {
  getSchoolYearExpirationDate,
  computeCardVersion,
  evaluateCardEligibility,
  getPersistentGrant,
  getGrantByUsername,
  getGrantByMediothekNumber,
  getGrantByUserId,
  savePersistentGrant,
  revokePersistentGrant,
  VERIFIED_STATUSES,
  REVOKED_STATUSES
};


