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

### 2.3 SSRF-Schutz & Statusprüfungen (`src/utils/networkHelper.js`)
*   Die Kachel-Erreichbarkeitsprüfung (`GET /api/tiles/check-status?id=...`) führt vor jedem HTTP-Request eine DNS-Auflösung durch.
*   IP-Adressen werden gegen RFC1918 / Private, Loopback (`127.0.0.0/8`), Link-Local (`169.254.0.0/16`) und Multicast-Ranges geprüft.
*   Interne Adressen werden strikt blockiert.
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
    *   Erstellt vor jeder Migration ein SQLite-Backup unter `data/backups/backup_pre_update_<timestamp>.sqlite`.
