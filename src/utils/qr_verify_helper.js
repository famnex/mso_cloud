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
  const bibNumber = student.mediothek_number || student.bib || student.b || '';

  const cleanBase = baseUrl ? baseUrl.replace(/\/$/, '') : '';
  let path = cleanBase;
  if (path.endsWith('/verify')) {
    path = path.substring(0, path.length - 7) + '/v';
  } else if (!path.endsWith('/v')) {
    path = `${path}/v`;
  }

  // WICHTIG: b= muss immer als letzter Parameter angehängt werden (Prefix/Suffix-Parsing für Hardware-Scanner)
  // Ultrakurz-Schema: /v?n=...&b=... für minimale Punktdichte
  const queryParams = [
    `n=${encodeURIComponent(rawName)}`,
    `b=${encodeURIComponent(bibNumber)}`
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
    name = urlParams.get('n') || urlParams.get('name') || '';
    id = urlParams.get('id') || '';
    bib = urlParams.get('b') || urlParams.get('bib') || '';
  } else if (params && typeof params.get === 'function') {
    name = params.get('n') || params.get('name') || '';
    id = params.get('id') || '';
    bib = params.get('b') || params.get('bib') || '';
  } else if (params && typeof params === 'object') {
    name = params.n || params.name || '';
    id = params.id || '';
    bib = params.b || params.bib || '';
  }

  // Parameter trimmen und säubern
  name = name.trim();
  id = id.trim();
  bib = bib.trim();

  // Gültigkeits-Prüfung: Mindestens Name sowie Bibliotheksnummer/ID müssen vorhanden sein
  const isValid = !!(name && (bib || id));

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
