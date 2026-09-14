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

### 3.1 Regelwerk für Gültigkeit & MySQL-Statusmodell (`src/services/cardEligibility.js`, `src/student_db.js`)
Die Gültigkeit eines echten Schülerausweises wird strikt und zentral serverseitig ermittelt:
1. **LDAP-Verpflichtung & Zwingende Vorab-Prüfung**:
   - Ein echter Schülerausweis setzt zwingend ein aktives Konto im Schul-LDAP voraus (`status === 'active'`).
   - Die LDAP-Prüfung (`effectiveLdapStatus`) wird in `evaluateCardEligibility()` **vor jedem Ausfallpuffer** und vor jeder MySQL-Ausfallbehandlung evaluiert:
     - `inactive`: Live LDAP-Konto fehlt oder ist deaktiviert -> Sofortige Ablehnung (`valid = false`, `ACCOUNT_INACTIVE`) und sofortiger Widerruf des persistenten Grants (`is_revoked = 1`).
     - `disabled`: LDAP deaktiviert -> Sofortige Ablehnung (`valid = false`, `LDAP_DISABLED`).
     - `misconfigured`: LDAP unvollständig konfiguriert -> Sofortige Ablehnung (`valid = false`, `LDAP_MISCONFIGURED`).
     - `not_checked`: Prüfung nicht erfolgt -> Sofortige Ablehnung (`valid = false`, `NOT_CHECKED`).
     - `unavailable`: Echter Serverausfall/Timeout -> Bestehender, nicht widerrufener Grant bis zur Frist nutzbar.
   - Ein nachfolgender MySQL-Ausfall oder ein bestehender Grant kann einen LDAP-Negativbefund niemals überstimmen oder wiederaufleben lassen.
   - Lokale Administratoren können sich im Verwaltungsportal anmelden; ihre Ausweisansicht ist als Muster (`is_admin_preview = true`, `valid = false`) deklariert. Fehlgeschlagene LDAP-Prüfungen terminieren niemals die lokale Admin-Sitzung.
2. **MySQL-4-Status-Klassifikation (`src/student_db.js`)**:
   - `status: 'found'` (`mysql_live`): Autoritative Stammdaten in MySQL gefunden.
   - `status: 'not_found'` (`mysql_live`): Schülerkonto existiert definitiv nicht (mehr) in MySQL. Die Route `/card` führt `evaluateCardEligibility` vollständig aus; bestehender Grant wird sofort widerrufen (`is_revoked = 1`), lokales SQLite-Profil gelöscht, kein Ausfallpuffer möglich.
   - `status: 'connection_error'` (`mysql_unavailable`): Echter Verbindungs-/Netzwerkausfall (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `PROTOCOL_CONNECTION_LOST`, `EHOSTUNREACH`, `ECONNRESET`, etc.). Es darf **keine neue Freigabe** erstellt und **keine Frist verlängert** werden. Nur ein bereits bestehender, gültiger Grant darf als unveränderlicher Puffer weitergenutzt werden.
   - `status: 'query_error'` (`mysql_error`): Authentifizierungs-, Berechtigungs-, Schema- oder Syntaxfehler (`ER_ACCESS_DENIED_ERROR`, `ER_DBACCESS_DENIED_ERROR`, `ER_BAD_DB_ERROR`, `ER_NO_SUCH_TABLE`, etc.). Werden strikt als `query_error` eingestuft; aktivieren niemals einen Ausfallpuffer (`DATABASE_ERROR`).
3. **Strenge Identitätsbindung (`getPersistentGrant`)**:
   - Trennt `username`, `mediothek_number` und `user_id` strikt.
   - Numerische String-Benutzernamen (z. B. `"8001"`) werden **nicht** als Integer-IDs interpretiert.
   - Sekundäre Lookups (z. B. über Mediotheksnummer) verifizieren zwingend, dass der gefundene Grant zur Primäridentität (Username / User-ID) passt; bei Konflikten wird der Sekundärtreffer verworfen.
4. **Persistenter Ausfallpuffer, Datumsprüfung & QR-Freigabestand (`student_card_grants`)**:
   - Bei tatsächlicher Verbindungsstörung (LDAP oder MySQL) darf eine zuvor erfolgreich bestätigte Gültigkeit zeitlich begrenzt weiterverwendet werden.
   - Der Puffer gilt maximal 30 Tage seit der letzten erfolgreichen Vollprüfung (`offline_valid_until`) und niemals über das bestätigte Schuljahresende (31. Juli) hinaus.
   - **Robuste Datumsprüfung**: Beide Zeitwerte (`offline_valid_until` und `school_year_expires_at`) werden mit `Number.isFinite(date.getTime())` validiert. Sind Zeitstempel ungültig oder korrupt, wird der Puffer sofort als abgelaufen abgewiesen (`OFFLINE_EXPIRED`, `valid: false`).
   - **Exaktes Fristende (`>=`)**: Beim Erreichen des Fristendes gilt `now >= expiry` (sekunden- und millisekundengenau abgelaufen).
   - Wiederholte Abrufe während einer Störung verlängern die Frist **nicht**.
   - **QR-Freigabestand & Revisionsabsicherung (`isQrVerification: true`)**:
     - Der öffentliche QR-Prüfendpunkt (`/verify-check`) arbeitet nach dem Prinzip der Datensparsamkeit und lädt keine Passbild-Blobs.
     - Im regulären Live-Betrieb erfolgt die Prüfung stets live gegen MySQL und LDAP.
     - Bei einem Ausfall von MySQL/LDAP stützt sich die QR-Verifikation auf den zuvor kryptografisch abgesicherten Freigabestand in `student_card_grants`:
       1. Freigabe existiert und ist nicht widerrufen (`is_revoked === 0`).
       2. Beide Fristen sind valide, finiten Datums und liegen in der Zukunft (`now < offline_valid_until` und `now < school_year_expires_at`).
       3. Der hinterlegte Versionshash ist intakt und valide (`card_version` beginnt mit `v_`, Länge >= 10, nicht `v0` oder leer).
       4. Strikte Identitätsbindung: Mediotheksnummer und Benutzername stimmen exakt mit dem Grant überein.
     - **Sofortige Invalidierung bei Änderungen**: Jede Änderung an Schülerdaten (neues Foto, Fotoentfernung, Statusänderung auf ungenehmigt/gesperrt, Kontodeaktivierung im LDAP) invalidiert den Grant im Live-Betrieb sofort über `revokePersistentGrant()`. Dadurch ist sichergestellt, dass bei einem nachfolgenden Ausfall kein veralteter oder aberkannter Ausweis verifiziert werden kann.
5. **Widerruf bei Bedingungsverlust**:
   - Sobald im Live-Betrieb festgestellt wird, dass Profil, Foto, Genehmigung oder LDAP-Konto fehlen oder deaktiviert sind, wird der persistente Grant sofort widerrufen (`is_revoked = 1`).
   - Spätere Serverausfälle können widerrufene Freigaben nicht wieder aufleben lassen.

### 3.2 Datenschutzkonforme 2-Phasen-QR-Verifizierung (`/verify-check`, `/v`, `/verify`)
*   **Datensparsame 2-Phasen-Abfrage (`findStudentForVerification`)**:
    - **Phase 1**: Minimaler Query nur nach Mediotheksnummer (Feld 145), Vorname (1), Nachname (2) und `applications.status >= 10`.
    - Namensabgleich: Vor- und Nachname müssen beide nicht-leer sein und exakt/getrimmt matchen.
    - **Phase 2**: Nur für den gematchten Datensatz: Abfrage von Feld 146 (Username), Status (158) und Foto-Existenz (`LENGTH(file) > 20`).
*   **Kein Passbild-Payload**: Binäre Foto-Daten werden niemals an den QR-Prüfer übertragen.
*   **Schutz des Ausweis-Versions-Hashes**: Der öffentliche QR-Prüfendpunkt ruft `evaluateCardEligibility` mit `allowSaveGrant: false` und `isQrVerification: true` auf. Dadurch überschreiben QR-Verifizierungen niemals den in SQLite gespeicherten echten Foto- und Datenhash mit einem Placeholder-SVG-Hash.
*   **Kein ID-Fallback**: Der veraltete `id`/`cleanId`-Fallback in `public/verify.html` ist entfernt; es werden zwingend `b`/`bib` und `n`/`name` verlangt.
*   **Einheitliche Fehlerantwort**: Falsche Namen, nicht gefundene Nummern und ungültige Ausweise liefern nach außen die identische Antwort `{ verified: false, status: 'Ungültig', message: 'Schülerausweis konnte nicht verifiziert werden.' }`.

### 3.3 Frontend Offline-Cache-Vertrag & PWA (`public/student_card.html`)
*   **Strikte Cache-Prüfung (`isSupportedValidCache`)**:
    - Gültiger Offline-Cache erfordert zwingend: `valid === true`, nicht-leeren `card_version`-String, ein parsbare und in der Zukunft liegende Frist (`offline_valid_until` / `expires_at`), und keinen Sperrstatus.
    - Fehlende oder leere Versionsangaben erzwingen eine Onlineprüfung.
*   **Anonymer Status-Check Versionsabgleich**:
    - Wenn die Session abgelaufen ist (401), führt der Client eine anonyme Statusprüfung (`/api/student/status-check?username=...`) durch.
    - Der lokale Cache wird **nur dann** aktualisiert, wenn der Cache valide ist (`isSupportedValidCache`), die Serverantwort eine `card_version` liefert und `statusData.card_version === tempCached.card_version` exakt übereinstimmt.
    - Bei Versionsabweichungen (`VERSION_MISMATCH`) oder unvollständigen Altdaten wird der Cache gesperrt und eine vollständige Neuanmeldung verlangt (`REAUTH_REQUIRED`).
*   **Kein Zeitstempel-Refresh bei Puffer-Antworten**: Wenn das Backend eine gepufferte Antwort (`is_buffered: true`) liefert, aktualisiert das Frontend den lokalen Cache-Zeitstempel nicht, um künstliche Fristverlängerungen auf Clientseite auszuschließen.
*   **Status-Zustände**:
    - **Online geprüft**: Frische Server-Antwort im Online-Betrieb (`is_buffered: false`).
    - **Gültig (Puffer)**: Innerhalb des unveränderlichen 30-Tage-Fensters bei Server-/LDAP-Störung (`is_buffered: true`). In `verify.html` visuell unterscheidbar als Puffer deklariert.
    - **Erneute Onlineprüfung erforderlich**: Offline-Cache oder Puffer abgelaufen.
    - **Ausweis gesperrt**: Server hat Ausweis gesperrt oder LDAP-Konto deaktiviert.

### 3.4 „Technik Scout“-Kennzeichnung
*   **Merkmal & Verwaltung**: Opt-in Kennzeichnung (`users.is_technik_scout`), die ausschließlich durch autorisierte Administratoren in der Benutzerverwaltung aktiviert werden kann.
*   **Unveränderlichkeit**: Das Merkmal wird weder durch LDAP-Synchronisationen noch durch externe Schülerdaten-Imports überschrieben.
*   **Darstellung auf dem Schülerausweis**:
    *   Zeigt ein integriertes SVG-Symbol (Zahnrad mit integriertem Mikrochip).
    *   Bei Schülern unter 18 Jahren unmittelbar links neben dem „nicht 18“-Symbol; ab 18 Jahren an dessen Position.
    *   Antippen/Klicken öffnet einen barrierefreien Modal-Dialog mit Berechtigungshinweis zur Nutzung von Technik- und Informatikräumen.
    *   **Unterdrückung auf ungültigen Karten**: Auf gesperrten oder ungültigen Ausweisen (`valid: false`, `is_blocked`) ist das Technik-Scout-Symbol vollständig deaktiviert/ausgeblendet.
    *   Funktioniert offline zusammen mit dem Schülerausweis-Cache. Bei einem offline befindlichen Gerät wird ein nachträglicher Entzug wirksam, sobald wieder eine Netzwerkverbindung besteht oder der 30-Tage-Cache abläuft.

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

