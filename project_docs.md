# MSO Cloud - System- & Entwicklerdokumentation

## 1. Übersicht & Architektur
**MSO Cloud** ist ein zentrales Schulportal und Dashboard für Schulen (z.B. Modellschule Obersberg). Es bündelt externe und interne Schul-Dienste (Untis, Schulportal Hessen / Lanis, Nextcloud, Mediothek etc.), bietet Single-Sign-On (SSO / OIDC), eine integrierte Benutzerverwaltung (Lokal & LDAP/AD) sowie einen PWA-fähigen digitalen Schülerausweis mit fälschungssicherer Online- und Offline-Prüfung.

### Technologie-Stack:
*   **Backend**: Node.js mit Express.js
*   **Datenbank**: SQLite via `better-sqlite3` (transaktionsgesichert, synchrone SQLite-Engine)
*   **Session-Management**: `express-session` mit SQLite-Session-Store (`better-sqlite3-session-store`)
*   **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3 Glassmorphism UI, Responsive PWA mit Service Worker
*   **Kryptografie**: `node:crypto` (AES-256-GCM, PBKDF2, RSA-2048 für OIDC RS256, Bcrypt für Passwörter)

---

## 2. Sicherheitsarchitektur

### 2.1 Authentifizierung & Sitzungsverwaltung (`auth_version`)
*   Jeder Benutzer besitzt in der `users`-Tabelle eine ganzzahlige Spalte `auth_version` (Default `1`).
*   Bei jeder Benutzer-Session wird die `auth_version` im Session-Objekt mitgeführt.
*   Die Middleware `requireAuth` / `requireAdmin` (`src/middleware/authMiddleware.js`) prüft bei jedem autorisierten Request live gegen die Datenbank:
    1. Existiert der Benutzer?
    2. Ist `is_active === 1`?
    3. Stimmt `session.auth_version === user.auth_version`?
*   Wird das Passwort geändert, die Rolle entzogen, das Konto deaktiviert oder gelöscht, wird `auth_version` inkrementiert. Dadurch werden alle aktiven Browser-Sessions des Nutzers sofort und serverweit ungültig.

### 2.2 Schutz vor SSO-Schlüssel-Offenlegung (DTO Whitelisting)
*   Die Tabelle `tiles` enthält vertrauliche symmetrische `sso_key`-Geheimnisse.
*   Der öffentliche Endpoint `GET /api/tiles` verwendet die Whitelist-Funktion `toPublicTileDTO()` in `src/routes/tiles.js`.
*   Felder wie `sso_key` werden niemals an nicht-autorisierte Clients ausgeliefert. Die SSO-Token-Generierung erfolgt ausschließlich serverseitig über das Gateway `GET /api/tiles/sso/:id`.

### 2.3 Statusprüfungen & Schutz vor Metadaten-Exfiltration (`src/utils/networkHelper.js`)
*   Die Kachel-Erreichbarkeitsprüfung (`GET /api/tiles/check-status?id=...`) führt vor jedem HTTP-Request eine DNS-Auflösung und URL-Validierung durch.
*   Es dürfen ausschließlich Kacheln geprüft werden, die in der Datenbank hinterlegt und für den Benutzer sichtbar sind.
*   **Schulnetz-Unterstützung:** Interne Schulnetz-Dienste (`10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12` und `127.0.0.1` / Localhost) sind standardmäßig für Statusprüfungen freigegeben, damit interne Schulanwendungen (Moodle, WebUntis, Mediothek, Nextcloud) zuverlässig als online/offline angezeigt werden.
*   **Cloud-Metadaten-Schutz:** Gefährliche Link-Local- und Cloud-Metadaten-Endpunkte (`169.254.0.0/16` wie `169.254.169.254`), Multicast (`224.0.0.0/4`) und Broadcast (`0.0.0.0/8`) sind dauerhaft gesperrt.
*   **Optionaler Strict-Modus:** Über `STATUS_CHECK_ALLOW_PRIVATE=false` in `.env` kann die Prüfung privater Netze auf eine explizite Positivliste (`STATUS_CHECK_PRIVATE_ORIGINS`) beschränkt werden.
*   Ergebnisse werden 60 Sekunden lang im Arbeitsspeicher gecacht.

### 2.4 Brute-Force & Rate-Limiting
*   Fehlgeschlagene Login-Versuche werden IP-basiert getrackt (`login_max_attempts`, `login_lockout_duration_min`).
*   Gesperrte Anfragen erhalten HTTP 429 Too Many Requests inklusive standardisiertem `Retry-After`-Header.

---

## 3. Schülerausweis & Verifizierung

### 3.1 Regelwerk für Gültigkeit (`src/services/cardEligibility.js`)
Die Gültigkeit eines Schülerausweises wird zentral berechnet:
1. **Benutzerstatus**: `is_active === 1` und Benutzer existiert.
2. **Passbild**: Bild vorhanden und Status = `Bild genehmigt` / `genehmigt` / `1132` / `1133`.
3. **Schuljahres-Stichtag**: Ausweise sind bis zum 31. Juli des aktuellen/kommenden Schuljahres gültig (`getSchoolYearExpirationDate()`).
4. **Offline-Zeitraum**: Im PWA-Modus ist ein gecachter Ausweis maximal 30 Tage ohne erneuten Serverkontakt gültig.

### 3.2 Verifizierungs-Endpoints
*   `GET /v?n=<name>&b=<bib>` (Ultrakurz-Schema für QR-Codes)
*   `GET /verify?name=<name>&bib=<bib>`
*   `GET /api/student/verify-check` (JSON-API)
*   Die Suche nutzt den Index `idx_student_profiles_mediothek` auf `student_profiles (mediothek_number)` und `users (last_name, first_name)` für $O(1)$-Abfragen.

### 3.3 Status-Zustände im Frontend
*   **Online geprüft**: Frische Server-Antwort im Online-Betrieb.
*   **Offline gespeichert**: Innerhalb des 30-Tage-Fensters aus dem lokalen Speicher geladen (mit Resttage-Countdown).
*   **Erneute Onlineprüfung erforderlich**: Offline-Cache älter als 30 Tage.
*   **Ausweis gesperrt**: Server hat Ausweis gesperrt oder Konto deaktiviert/gelöscht.

---

## 4. Single-Sign-On & OIDC Provider
*   MSO Cloud agiert als vollständiger OpenID Connect (OIDC) Identity Provider (IdP) für verbundene Schulplattformen.
*   Discovery: `GET /.well-known/openid-configuration`
*   JWKS: `GET /jwks` mit dynamisch generiertem/persistiertem RSA-2048 Schlüsselpaar (`RS256`).
*   Basis-URLs und Pfade sind über `PUBLIC_BASE_URL` und `BASE_PATH` konfigurierbar und unterstützen Reverse-Proxy-Setups (`X-Forwarded-Proto`, `X-Forwarded-Host`).

---

## 5. System-Updater & Deployment
*   Asynchroner Update-Mechanismus (`src/updater.js` & `src/routes/admin.js`):
    *   `POST /api/admin/system/update` -> Startet Job im Hintergrund, antwortet mit HTTP 202 Accepted.
    *   `GET /api/admin/system/update/status` -> Liefert aktuellen Status (`running`, `succeeded`, `failed`) und Log-Puffer.
    *   `GET /api/admin/system/info` -> Liefert aktuelle System-Informationen inkl. Git-Commit-Hash (`commit_hash`, `commit_hash_short`, `commit_date`, `branch`), Node.js Version und Plattform.
    *   Erstellt vor jeder Migration ein SQLite-Backup unter `data/backups/backup_pre_update_<timestamp>.sqlite`.

## Betriebsanleitung: Anmeldung und Dienststatus (Korrektur September 2026)

Die Anwendung lädt `.env` aus dem Projektverzeichnis. Bereits gesetzte Prozessvariablen
(z. B. aus PM2) haben Vorrang. Änderungen an Prozessvariablen mit
`pm2 restart mso-cloud --update-env` übernehmen.

### HTTPS und Sitzungscookies

- `COOKIE_SECURE=auto` ist der Standard: Direktes HTTP funktioniert auch mit
  `NODE_ENV=production`; bei erkanntem HTTPS erhält das Sitzungscookie das Secure-Flag.
- Für das öffentlich per HTTPS erreichbare Schulportal ausdrücklich
  `COOKIE_SECURE=true` verwenden. Ist HTTPS für Express nicht erkennbar, gibt die
  Anmeldung jetzt einen verständlichen Fehler mit `SESSION_HTTPS_REQUIRED` zurück.
- `COOKIE_SECURE=false` wird ausdrücklich berücksichtigt, auch in Produktion;
  diese Einstellung ist für bewusst per HTTP betriebene Installationen vorgesehen.
- `TRUST_PROXY` ist standardmäßig `loopback`. Bei einem getrennten Proxy/Container
  dessen tatsächliche Adresse oder ein eng begrenztes Subnetz eintragen, beispielsweise
  `TRUST_PROXY=172.20.0.5/32`. Kommagetrennte Netze und numerische Hop-Zahlen werden
  unterstützt. Hop-Zahlen nur bei einer festen, bekannten Proxykette verwenden.
- Der Reverse-Proxy muss `X-Forwarded-Proto` selbst korrekt setzen/überschreiben und
  der Backend-Port darf nicht ungeschützt öffentlich erreichbar sein. Keine fremden
  Forwarded-Header ungeprüft übernehmen. Ohne vertrauenswürdigen Proxy kann `auto`
  externes HTTPS nicht erkennen und setzt dann kein Secure-Flag.

Nach dem Neustart im Browser prüfen: `POST /api/auth/login` liefert 200 und ein
`sid`-Cookie; anschließend liefert `GET /api/auth/me` `logged_in: true`.
Lokale Konten werden unabhängig von LDAP angemeldet und nicht im LDAP auf Existenz
geprüft. LDAP-Konten verwenden niemals ihren eventuell vorhandenen lokalen Hash als
Ersatz für eine fehlgeschlagene LDAP-Anmeldung.

### Interne Dienste und Statusanzeigen

Die Statusprüfung akzeptiert Kachel-IDs. Alte URL-Aufrufe funktionieren nur bei einer
exakten Übereinstimmung mit einer gespeicherten Kachel. Dieselben Gruppen und
LDAP-Gruppenzuordnungen gelten für Sichtbarkeit und Statusprüfung.

Private Ziele bleiben standardmäßig von Serveranfragen ausgeschlossen. Einzelne
bekannte Schuldienste können mit exakten Origins (Protokoll, Host und ggf. Port,
keine Pfade, Wildcards oder abschließenden Schrägstriche) freigegeben werden:

```dotenv
STATUS_CHECK_PRIVATE_ORIGINS=https://intranet.schule.example,http://192.168.10.20:8080
```

Nur ausdrücklich vertrauenswürdige Ziele eintragen. Die Prüfung fixiert die zuvor
geprüften DNS-Adressen für die Verbindung und folgt keinen HTTP-Weiterleitungen.
TLS-Zertifikate werden weiterhin geprüft.

Eine blockierte Prüfung, fehlende Berechtigung, DNS-/Verbindungsfehler oder ein
Timeout ergeben **Status unbekannt**. HTTP-Serverfehler ergeben **Offline**.
Die Statusanzeige ist ein Hinweis: Dienstlinks und Zugangsdaten-Schaltflächen bleiben
benutzbar; bestehende Berechtigungs- und Zeitsperren gelten unverändert.
Kachel-API-Antworten werden nicht vom Service Worker aus einem alten Cache bedient.

`npm test` führt alle Testsuiten (QR-Tests, Login-/Proxy-Regression und Ausweis-Synchronisation) aus:
- `tests/test_all_enhancements.js`
- `tests/login_tile_regression.test.js`
- `tests/student_card_sync.test.js`

Die Regressionstests verwenden isolierte Datenbank-/LDAP-Adapter und kontaktieren keine produktiven Dienste.

---

## Schülerausweis, QR-Verifizierung und Datenbank-Synchronisation

### 1. Ausweis-Gültigkeit & 30-Tage-Offlinefrist
- **Single Source of Truth:** Das Backend (`evaluateCardEligibility` in `src/services/cardEligibility.js`) bewertet die Gültigkeit deterministisch und liefert `{ valid: boolean, reason_code: string, offline_valid_until: string, expires_at: string }`.
- **Frontend-Vertrag:** `public/student_card.html` richtet sich primär nach `data.valid` und `data.reason_code`. Wenn `data.valid === false`, werden persönliche Daten ausgeblendet (`shouldBlockContent = true`) und das entsprechende Overlay eingeblendet.
- **Offline-Gültigkeit:** Gespeicherte Ausweise sind maximal 30 Tage ab dem letzten Online-Abruf gültig (bzw. bis zum Schuljahresende 31. Juli). Bei Überschreitung wird der Ausweis im Browser und der PWA gesperrt (`Offline-Zeitraum abgelaufen`) und eine erneute Online-Prüfung gefordert.

### 2. QR-Verifizierung & Mediotheksnummer
- Die QR-Online-Prüfung (`/api/student/verify-check`) nutzt `findStudentByVerificationReference` in `src/student_db.js`.
- **Mediotheksnummer:** Die Suche nach der Bibliotheks-/Mediotheksnummer in MySQL erfolgt einheitlich über `field = 145` in der Tabelle `fieldvalues`.
- **Live-Prüfung:** Bei aktiver MySQL-Verbindung (`mysql_enabled = 1`) wird vorrangig live in MySQL nach aktiven Anträgen (`status >= 10`) gesucht, damit Sperrungen sofort wirksam sind.

### 3. MySQL / SQLite Synchronisation & Transaktionssicherheit
- Methoden in `src/student_db.js` (`approvePhoto`, `rejectPhoto`, `deletePhoto`, `updateStudentPhoto`, `updateStudentProfile`):
  - Wenn MySQL aktiv ist, muss der Schreibvorgang in MySQL erfolgreich sein.
  - Schlägt MySQL fehl (oder wird keine zugehörige Antrags-ID gefunden), wird ein Fehler `{ success: false, error: '...' }` zurückgemeldet und SQLite nicht fälschlicherweise verändert.
  - Dadurch laufen MySQL und SQLite nicht auseinander.

### 4. Sitzungswiderruf (`auth_version`)
- `/api/student/card` prüft die `auth_version` der Benutzersitzung gegen die Datenbank `users.auth_version`.
- Wird das Passwort geändert, die Berechtigung angepasst oder der Benutzer deaktiviert (`auth_version++`), wird die Sitzung sofort terminiert und mit HTTP 401 (`session_revoked: true`) abgewiesen.

