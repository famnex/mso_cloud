/**
 * Zentraler Auswertungs-Service für die Gültigkeit von Schülerausweisen.
 * 
 * Verwendet von:
 * - GET /api/student/card
 * - GET /api/student/status-check
 * - GET /api/student/verify-check
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
  'deaktiviert'
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
 * Normalisiert einen Status-String oder Status-Code.
 */
function normalizeStatus(status, statusCode) {
  const s = String(status || '').trim().toLowerCase();
  const c = String(statusCode || '').trim().toLowerCase();
  return { statusStr: s, codeStr: c };
}

/**
 * Bewertet deterministisch die Gültigkeit eines Schülerausweises.
 * 
 * @param {Object} user - Benutzerobjekt aus DB (users)
 * @param {Object} profile - Schülerprofil (student_profiles oder MySQL)
 * @param {Date} now - Auswertungszeitpunkt (Standard: jetzt)
 * @returns {Object} Einheitlicher Ergebnisvertrag
 */
function evaluateCardEligibility(user, profile, now = new Date()) {
  const { expiresAt, expiryDate } = getSchoolYearExpirationDate(now);
  const isExpired = now > expiryDate;

  // 1. Konto-Existenz und Aktivität prüfen
  if (!user || user.is_active === 0) {
    return {
      valid: false,
      reasonCode: 'ACCOUNT_INACTIVE',
      statusSummary: 'Benutzerkonto inaktiv oder gelöscht',
      rawStatus: profile ? profile.card_status : '',
      expiresAt: expiresAt,
      offlineValidUntil: null
    };
  }

  // 2. Profil-Existenz prüfen
  if (!profile) {
    return {
      valid: false,
      reasonCode: 'PROFILE_NOT_FOUND',
      statusSummary: 'Kein Schülerprofil vorhanden',
      rawStatus: '',
      expiresAt: expiresAt,
      offlineValidUntil: null
    };
  }

  const rawStatus = profile.card_status || 'Bild ungeprüft / Kein Bild';
  const { statusStr, codeStr } = normalizeStatus(rawStatus, profile.card_status_code);
  const hasImage = Boolean(profile.card_image && String(profile.card_image).trim().length > 20);

  // 3. Ausweis gesperrt?
  const isRevoked = REVOKED_STATUSES.has(statusStr) || REVOKED_STATUSES.has(codeStr);
  if (isRevoked) {
    return {
      valid: false,
      reasonCode: 'CARD_REVOKED',
      statusSummary: 'Ausweis gesperrt',
      rawStatus: rawStatus,
      expiresAt: expiresAt,
      offlineValidUntil: null
    };
  }

  // 4. Ausweis abgelaufen?
  if (isExpired) {
    return {
      valid: false,
      reasonCode: 'EXPIRED',
      statusSummary: `Abgelaufen (Gültig war bis ${expiresAt})`,
      rawStatus: rawStatus,
      expiresAt: expiresAt,
      offlineValidUntil: null
    };
  }

  // 5. Passbild vorhanden?
  if (!hasImage) {
    return {
      valid: false,
      reasonCode: 'NO_PHOTO',
      statusSummary: 'Kein Foto hinterlegt',
      rawStatus: rawStatus,
      expiresAt: expiresAt,
      offlineValidUntil: null
    };
  }

  // 6. Passbild verifiziert/genehmigt?
  const isVerified = VERIFIED_STATUSES.has(statusStr) || VERIFIED_STATUSES.has(codeStr);
  if (!isVerified) {
    return {
      valid: false,
      reasonCode: 'PHOTO_NOT_APPROVED',
      statusSummary: `Foto ungeprüft (${rawStatus})`,
      rawStatus: rawStatus,
      expiresAt: expiresAt,
      offlineValidUntil: null
    };
  }

  // 7. Ausweis ist vollständig gültig!
  // Offline-Gültigkeit: Maximal 30 Tage ab jetzt, aber niemals über das Schuljahresende hinaus
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const thirtyDaysFromNow = new Date(now.getTime() + thirtyDaysMs);
  const offlineExpiryDate = thirtyDaysFromNow < expiryDate ? thirtyDaysFromNow : expiryDate;
  const offlineValidUntil = offlineExpiryDate.toISOString();

  return {
    valid: true,
    reasonCode: 'VALID',
    statusSummary: 'Gültig',
    rawStatus: rawStatus,
    expiresAt: expiresAt,
    offlineValidUntil: offlineValidUntil
  };
}

module.exports = {
  getSchoolYearExpirationDate,
  evaluateCardEligibility,
  VERIFIED_STATUSES,
  REVOKED_STATUSES
};
