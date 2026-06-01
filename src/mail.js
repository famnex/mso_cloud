const nodemailer = require('nodemailer');
const { getConfig } = require('./db');

/**
 * Erstellt einen Nodemailer Transporter auf Basis der aktuellen Einstellungen in der Datenbank.
 */
function createTransporter() {
  const host = getConfig('smtp_host');
  const port = parseInt(getConfig('smtp_port', '587'), 10);
  const secure = getConfig('smtp_secure') === '1'; // true für Port 465 (SSL/TLS), false für andere
  const user = getConfig('smtp_user');
  const pass = getConfig('smtp_password');

  if (!host) {
    throw new Error('SMTP-Server ist nicht konfiguriert.');
  }

  const config = {
    host: host,
    port: port,
    secure: secure,
    connectionTimeout: 5000,
    greetingTimeout: 5000
  };

  // Authentifizierung nur hinzufügen, wenn ein Benutzername hinterlegt ist (wichtig für schulinterne Open-Relays!)
  if (user) {
    config.auth = {
      user: user,
      pass: pass
    };
  }

  return nodemailer.createTransport(config);
}

/**
 * Versendet eine E-Mail zur Passwortrücksetzung.
 * @param {string} toEmail E-Mail-Empfänger
 * @param {string} username Benutzername des Empfängers
 * @param {string} resetUrl Link zum Zurücksetzen (inklusive Token)
 * @returns {Promise<boolean>}
 */
async function sendResetMail(toEmail, username, resetUrl) {
  const transporter = createTransporter();
  const from = getConfig('smtp_from', 'no-reply@mso-hef.de');

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 600px; background: #ffffff; border: 1px solid #e1e4e6; border-radius: 8px; padding: 40px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .logo { font-size: 24px; font-weight: bold; color: #024086; margin-bottom: 20px; text-align: center; }
        h2 { color: #024086; border-bottom: 2px solid #eaeaea; padding-bottom: 10px; }
        .button { display: inline-block; background-color: #024086; color: #ffffff !important; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 25px 0; font-size: 16px; text-align: center; }
        .button:hover { background-color: #1b5392; }
        .footer { margin-top: 30px; font-size: 12px; color: #777; border-top: 1px dashed #eaeaea; padding-top: 15px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">MSO Cloud</div>
        <h2>Passwort zurücksetzen</h2>
        <p>Hallo <strong>${username}</strong>,</p>
        <p>wir haben eine Anfrage zum Zurücksetzen deines Passworts für deinen MSO Cloud-Zugang erhalten.</p>
        <p>Klicke einfach auf den folgenden Button, um ein neues Passwort festzulegen. Dieser Link ist für <strong>1 Stunde</strong> gültig:</p>
        
        <div style="text-align: center;">
          <a href="${resetUrl}" class="button">Passwort zurücksetzen</a>
        </div>
        
        <p>Falls der Button nicht funktioniert, kannst du auch den folgenden Link kopieren und in die Adresszeile deines Browsers einfügen:</p>
        <p style="word-break: break-all; background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 13px;">
          ${resetUrl}
        </p>
        
        <p>Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail einfach ignorieren. Dein Passwort bleibt unverändert.</p>
        
        <div class="footer">
          Dies ist eine automatisch generierte E-Mail. Bitte antworte nicht direkt darauf.<br>
          &copy; ${new Date().getFullYear()} Modellschule Obersberg
        </div>
      </div>
    </body>
    </html>
  `;

  const info = await transporter.sendMail({
    from: `"MSO Cloud" <${from}>`,
    to: toEmail,
    subject: 'MSO Cloud - Passwort zurücksetzen',
    html: htmlContent
  });

  console.log('Passwort-Reset E-Mail erfolgreich gesendet an:', toEmail, 'MessageID:', info.messageId);
  return true;
}

/**
 * Testet die SMTP-Verbindung mit benutzerdefinierten Einstellungen.
 * Hilfreich für das Admin-Backend!
 */
async function testSmtpConnection(config) {
  const transportConfig = {
    host: config.smtp_host,
    port: parseInt(config.smtp_port, 10),
    secure: config.smtp_secure === '1',
    connectionTimeout: 5000,
    greetingTimeout: 5000
  };

  if (config.smtp_user) {
    transportConfig.auth = {
      user: config.smtp_user,
      pass: config.smtp_password
    };
  }

  const transporter = nodemailer.createTransport(transportConfig);
  await transporter.verify();
  return true;
}

/**
 * Versendet eine allgemeine HTML-E-Mail über den konfigurierten SMTP-Server.
 */
async function sendMail(toEmail, subject, htmlContent) {
  const transporter = createTransporter();
  const from = getConfig('smtp_from', 'no-reply@mso-hef.de');

  const info = await transporter.sendMail({
    from: `"MSO Cloud" <${from}>`,
    to: toEmail,
    subject: subject,
    html: htmlContent
  });

  console.log('E-Mail erfolgreich gesendet an:', toEmail, 'Betreff:', subject, 'MessageID:', info.messageId);
  return info;
}

module.exports = {
  sendResetMail,
  testSmtpConnection,
  sendMail
};
