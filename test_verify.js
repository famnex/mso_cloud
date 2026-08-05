/**
 * Unit Test / Helper Validation Script for Student ID Verification QR Code
 * 
 * Tests:
 * 1. Correct URL generation from student objects (including special characters, URL encoding, and bib isolation at the end).
 * 2. Correct parameter parsing on the /verify route.
 */

const assert = require('assert');
const { generateVerificationUrl, parseVerificationParams } = require('./src/utils/qr_verify_helper');

console.log('===================================================');
console.log(' STARTE UNIT-TESTS FÜR QR-CODE & VERIFY ROUTE');
console.log('===================================================\n');

let testsPassed = 0;
let testsTotal = 0;

function runTest(description, testFn) {
  testsTotal++;
  try {
    testFn();
    console.log(`✅ TEST ${testsTotal}: ${description} - PASSED`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ TEST ${testsTotal}: ${description} - FAILED`);
    console.error(`   Ursache: ${err.message}\n`);
  }
}

// -----------------------------------------------------------------------------
// Test 1: Korrekte URL-Generierung aus Schüler-Objekten
// -----------------------------------------------------------------------------
runTest('URL-Generierung für Standard-Schülerdaten (/v?n=...&b=...)', () => {
  const student = {
    first_name: 'Max',
    last_name: 'Mustermann',
    student_id: 'S-98765',
    mediothek_number: '12345678'
  };

  const url = generateVerificationUrl(student, 'https://ausweis.meineschule.de');
  
  assert.strictEqual(
    url,
    'https://ausweis.meineschule.de/v?n=Max%20Mustermann&b=12345678',
    'URL stimmt nicht mit dem Ultrakurz-Schema überein'
  );

  // Wichtig für Hardware-Scanner: b= muss am Ende stehen!
  assert.ok(url.endsWith('b=12345678'), 'b= Parameter steht nicht am Ende der URL');
});

runTest('URL-Generierung mit Umlauten und Sonderzeichen in Namen', () => {
  const student = {
    first_name: 'Björn-René',
    last_name: 'Müller-Özdemir',
    username: 'bjoern.mueller',
    mediothek_number: '99887766'
  };

  const url = generateVerificationUrl(student, 'https://cloud.mso-hef.de/novus');
  
  assert.ok(url.includes('/v?n=Bj%C3%B6rn-Ren%C3%A9%20M%C3%BCller-%C3%96zdemir'), 'Namen mit Umlauten wurden nicht sauber kodiert');
  assert.ok(url.endsWith('b=99887766'), 'b Parameter steht nicht sauber isoliert am Ende');
});

// -----------------------------------------------------------------------------
// Test 2: Korrekte Parameter-Extraktion auf der /v Route
// -----------------------------------------------------------------------------
runTest('Parameter-Parsing bei gültiger Ultrakurz-Verifizierungs-URL (/v?n=...&b=...)', () => {
  const testUrl = 'https://cloud.mso-hef.de/novus/v?n=Max%20Mustermann&b=12345678';
  const parsed = parseVerificationParams(testUrl);

  assert.strictEqual(parsed.name, 'Max Mustermann', 'Name wurde nicht korrekt dekodiert');
  assert.strictEqual(parsed.bib, '12345678', 'Bibliotheksnummer (b) wurde nicht korrekt extrahiert');
  assert.strictEqual(parsed.isValid, true, 'Erwartetes Gültigkeits-Flag isValid sollte true sein');
});

runTest('Parameter-Parsing Abwärtskompatibilität (/verify?name=...&bib=...)', () => {
  const legacyUrl = 'https://cloud.mso-hef.de/novus/verify?name=Erika%20Muster&bib=87654321';
  const parsed = parseVerificationParams(legacyUrl);

  assert.strictEqual(parsed.name, 'Erika Muster', 'Name aus Legacy-URL wurde nicht korrekt dekodiert');
  assert.strictEqual(parsed.bib, '87654321', 'Bibliotheksnummer (bib) aus Legacy-URL wurde nicht korrekt extrahiert');
  assert.strictEqual(parsed.isValid, true, 'Legacy-URL sollte isValid=true liefern');
});

runTest('Parameter-Parsing bei fehlenden/ungültigen Parametern', () => {
  const invalidUrl1 = 'https://cloud.mso-hef.de/novus/v?foo=bar';
  const parsed1 = parseVerificationParams(invalidUrl1);
  assert.strictEqual(parsed1.isValid, false, 'Leere Parameter sollten isValid=false liefern');

  const invalidUrl2 = 'https://cloud.mso-hef.de/novus/v?n=OnlyName';
  const parsed2 = parseVerificationParams(invalidUrl2);
  assert.strictEqual(parsed2.isValid, false, 'Nur Name ohne b oder bib sollte isValid=false liefern');
});

runTest('Hardware-Scanner b-Isolierung am Ende der URL', () => {
  const student = {
    name: 'Anna Schmidt',
    bib: 'BIB-55443322'
  };
  const url = generateVerificationUrl(student, 'https://mso.de');
  
  // Hardware-Scanner Prefix/Suffix Regel prüfen
  const bibMatch = url.match(/b=([^&]+)$/);
  assert.ok(bibMatch !== null, 'Hardware-Scanner Regex matchte b= am Ende nicht');
  assert.strictEqual(bibMatch[1], 'BIB-55443322', 'Extrahiertes b-Suffix stimmt nicht überein');
});

console.log(`\n===================================================`);
console.log(` ERGEBNIS: ${testsPassed} von ${testsTotal} TESTS ERFOLGREICH`);
console.log('===================================================\n');

if (testsPassed !== testsTotal) {
  process.exit(1);
}
