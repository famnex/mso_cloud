const assert = require('assert');

// Wir simulieren die Routing-Logik direkt im Test
function resolveRedirectUrl(user, redirectUrl) {
  if (user && redirectUrl) {
    const isOutlook = redirectUrl.toLowerCase().includes('outlook.office') || 
                      redirectUrl.toLowerCase().includes('outlook.com') ||
                      redirectUrl.toLowerCase().includes('outlook.office365.com');
                      
    const isM365 = !isOutlook && (
                     redirectUrl.toLowerCase().includes('portal.office.com') || 
                     redirectUrl.toLowerCase().includes('login.microsoftonline.com') ||
                     redirectUrl.toLowerCase().includes('office.com')
                   );

    if (isOutlook) {
      // Outlook: Only append hint if the user's email ends with @mso-hef.de
      if (user.email && user.email.toLowerCase().endsWith('@mso-hef.de')) {
        const separator = redirectUrl.includes('?') ? '&' : '?';
        redirectUrl = `${redirectUrl}${separator}login_hint=${encodeURIComponent(user.email)}`;
      }
    } else if (isM365) {
      // Microsoft 365:
      // 1. Teachers (email ends with @mso-hef.de): Use their email address
      // 2. Students (all others): Use [Email-Präfix vor @]@msohef.onmicrosoft.com (falls E-Mail vorhanden), sonst Benutzername
      let hint = '';
      if (user.email && user.email.toLowerCase().endsWith('@mso-hef.de')) {
        hint = user.email;
      } else {
        const usernamePart = (user.email && user.email.includes('@')) ? user.email.split('@')[0] : user.username;
        hint = `${usernamePart}@msohef.onmicrosoft.com`;
      }
      
      if (hint) {
        const separator = redirectUrl.includes('?') ? '&' : '?';
        redirectUrl = `${redirectUrl}${separator}login_hint=${encodeURIComponent(hint)}`;
      }
    }
  }
  return redirectUrl;
}

async function runTests() {
  console.log('Starte Test für Microsoft 365 / Outlook login_hint-Auflösung (mit E-Mail-Präfix)...');

  const teacher = {
    username: 's.fleischer',
    email: 's.fleischer@mso-hef.de',
    role: 'user'
  };

  const studentWithEmail = {
    username: 'max.mustermann',
    email: 'm.mustermann123@gmail.com',
    role: 'user'
  };

  const studentWithoutEmail = {
    username: 'mona.muster',
    email: null,
    role: 'user'
  };

  const outlookUrl = 'https://outlook.office.com/mail/';
  const m365Url = 'https://portal.office.com/';

  // 1. Teacher - Outlook
  const res1 = resolveRedirectUrl(teacher, outlookUrl);
  console.log('Teacher -> Outlook:', res1);
  assert.ok(res1.includes('login_hint=s.fleischer%40mso-hef.de'), 'Lehrer sollte bei Outlook ein login_hint haben.');

  // 2. Student - Outlook
  const res2 = resolveRedirectUrl(studentWithEmail, outlookUrl);
  console.log('Student -> Outlook:', res2);
  assert.strictEqual(res2, outlookUrl, 'Schüler sollte bei Outlook KEIN login_hint haben (nur Lehrer).');

  // 3. Teacher - M365
  const res3 = resolveRedirectUrl(teacher, m365Url);
  console.log('Teacher -> M365:', res3);
  assert.ok(res3.includes('login_hint=s.fleischer%40mso-hef.de'), 'Lehrer sollte bei M365 seine MSO-E-Mail erhalten.');

  // 4. Student (mit privater E-Mail) - M365
  const res4 = resolveRedirectUrl(studentWithEmail, m365Url);
  console.log('Student with Email -> M365:', res4);
  assert.ok(res4.includes('login_hint=m.mustermann123%40msohef.onmicrosoft.com'), 'Schüler mit E-Mail sollte m.mustermann123@msohef.onmicrosoft.com als UPN erhalten.');

  // 5. Student (ohne E-Mail) - M365
  const res5 = resolveRedirectUrl(studentWithoutEmail, m365Url);
  console.log('Student without Email -> M365:', res5);
  assert.ok(res5.includes('login_hint=mona.muster%40msohef.onmicrosoft.com'), 'Schüler ohne E-Mail sollte username@msohef.onmicrosoft.com als UPN erhalten.');

  console.log('✓ Alle M365/Outlook login_hint Tests erfolgreich bestanden!');
}

runTests().catch(err => {
  console.error('Test fehlgeschlagen:', err);
  process.exit(1);
});
