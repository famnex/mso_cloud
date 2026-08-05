/**
 * Helper Utility for Student ID QR Code Generation & Verification Parsing
 */

/**
 * Erzeugt die vollständige Verifizierungs-URL für den QR-Code eines Schülerausweises.
 * 
 * @param {Object} student - Schülerdaten-Objekt
 * @param {string} [baseUrl=''] - Basis-URL (z.B. "https://cloud.mso-hef.de/novus")
 * @returns {string} Vollständige QR-Code Payload-URL
 */
function generateVerificationUrl(student, baseUrl = '') {
  if (!student) student = {};
  
  const firstName = student.first_name || '';
  const lastName = student.last_name || '';
  const rawName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : (student.name || 'Schüler');
  const studentId = student.student_id || student.id || (student.username ? `S-${student.username}` : 'S-00000');
  const bibNumber = student.mediothek_number || student.bib || '';

  const cleanBase = baseUrl ? baseUrl.replace(/\/$/, '') : '';
  const path = cleanBase.endsWith('/verify') ? cleanBase : `${cleanBase}/verify`;

  // WICHTIG: bib= muss immer als letzter Parameter angehängt werden (Prefix/Suffix-Parsing für Hardware-Scanner)
  const queryParams = [
    `name=${encodeURIComponent(rawName)}`,
    `id=${encodeURIComponent(studentId)}`,
    `bib=${encodeURIComponent(bibNumber)}`
  ].join('&');

  return `${path}?${queryParams}`;
}

/**
 * Parsed und validiert die URL-Parameter der Verifizierungsseite.
 * 
 * @param {Object|URLSearchParams|string} params - Query-Parameter Objekt oder Query-String
 * @returns {Object} Extrahierte Schülerdaten und Gültigkeits-Flag
 */
function parseVerificationParams(params) {
  let name = '';
  let id = '';
  let bib = '';

  if (typeof params === 'string') {
    const search = params.includes('?') ? params.split('?')[1] : params;
    const urlParams = new URLSearchParams(search);
    name = urlParams.get('name') || '';
    id = urlParams.get('id') || '';
    bib = urlParams.get('bib') || '';
  } else if (params && typeof params.get === 'function') {
    name = params.get('name') || '';
    id = params.get('id') || '';
    bib = params.get('bib') || '';
  } else if (params && typeof params === 'object') {
    name = params.name || '';
    id = params.id || '';
    bib = params.bib || '';
  }

  // Parameter trimmen und säubern
  name = name.trim();
  id = id.trim();
  bib = bib.trim();

  // Gültigkeits-Prüfung: Mindestens Name sowie ID oder Bibliotheksnummer müssen vorhanden sein
  const isValid = !!(name && (id || bib));

  return {
    name,
    id,
    bib,
    isValid
  };
}

module.exports = {
  generateVerificationUrl,
  parseVerificationParams
};
