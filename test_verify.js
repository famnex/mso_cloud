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
runTest('URL-Generierung für Standard-Schülerdaten', () => {
  const student = {
    first_name: 'Max',
    last_name: 'Mustermann',
    student_id: 'S-98765',
    mediothek_number: '12345678'
  };

  const url = generateVerificationUrl(student, 'https://ausweis.meineschule.de');
  
  assert.strictEqual(
    url,
    'https://ausweis.meineschule.de/verify?name=Max%20Mustermann&id=S-98765&bib=12345678',
    'URL stimmt nicht mit dem erwarteten Schema überein'
  );

  // Wichtig für Hardware-Scanner: bib= muss am Ende stehen!
  assert.ok(url.endsWith('bib=12345678'), 'bib= Parameter steht nicht am Ende der URL');
});

runTest('URL-Generierung mit Umlauten und Sonderzeichen in Namen', () => {
  const student = {
    first_name: 'Björn-René',
    last_name: 'Müller-Özdemir',
    username: 'bjoern.mueller',
    mediothek_number: '99887766'
  };

  const url = generateVerificationUrl(student, 'https://cloud.mso-hef.de/novus');
  
  assert.ok(url.includes('name=Bj%C3%B6rn-Ren%C3%A9%20M%C3%BCller-%C3%96zdemir'), 'Namen mit Umlauten wurden nicht sauber kodiert');
  assert.ok(url.includes('id=S-bjoern.mueller'), 'Student ID Fallback aus username schlug fehl');
  assert.ok(url.endsWith('&bib=99887766'), 'bib Parameter steht nicht sauber isoliert am Ende');
});

// -----------------------------------------------------------------------------
// Test 2: Korrekte Parameter-Extraktion auf der /verify Route
// -----------------------------------------------------------------------------
runTest('Parameter-Parsing bei gültiger Verifizierungs-URL', () => {
  const testUrl = 'https://cloud.mso-hef.de/novus/verify?name=Max%20Mustermann&id=S-98765&bib=12345678';
  const parsed = parseVerificationParams(testUrl);

  assert.strictEqual(parsed.name, 'Max Mustermann', 'Name wurde nicht korrekt dekodiert');
  assert.strictEqual(parsed.id, 'S-98765', 'ID wurde nicht korrekt extrahiert');
  assert.strictEqual(parsed.bib, '12345678', 'Bibliotheksnummer (bib) wurde nicht korrekt extrahiert');
  assert.strictEqual(parsed.isValid, true, 'Erwartetes Gültigkeits-Flag isValid sollte true sein');
});

runTest('Parameter-Parsing bei fehlenden/ungültigen Parametern', () => {
  const invalidUrl1 = 'https://cloud.mso-hef.de/novus/verify?foo=bar';
  const parsed1 = parseVerificationParams(invalidUrl1);
  assert.strictEqual(parsed1.isValid, false, 'Leere Parameter sollten isValid=false liefern');

  const invalidUrl2 = 'https://cloud.mso-hef.de/novus/verify?name=OnlyName';
  const parsed2 = parseVerificationParams(invalidUrl2);
  assert.strictEqual(parsed2.isValid, false, 'Nur Name ohne id oder bib sollte isValid=false liefern');
});

runTest('Hardware-Scanner bib-Isolierung am Ende der URL', () => {
  const student = {
    name: 'Anna Schmidt',
    id: 'S-11223',
    bib: 'BIB-55443322'
  };
  const url = generateVerificationUrl(student, 'https://mso.de');
  
  // Hardware-Scanner Prefix/Suffix Regel prüfen
  const bibMatch = url.match(/bib=([^&]+)$/);
  assert.ok(bibMatch !== null, 'Hardware-Scanner Regex matchte bib= am Ende nicht');
  assert.strictEqual(bibMatch[1], 'BIB-55443322', 'Extrahiertes bib-Suffix stimmt nicht überein');
});

console.log(`\n===================================================`);
console.log(` ERGEBNIS: ${testsPassed} von ${testsTotal} TESTS ERFOLGREICH`);
console.log('===================================================\n');

if (testsPassed !== testsTotal) {
  process.exit(1);
}
