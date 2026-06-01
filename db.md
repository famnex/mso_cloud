# MSO Cloud - Datenbank-Dokumentation

Dieses Dokument dient der lückenlosen Dokumentation des Datenbankschemas und der Verwaltung von Schemaänderungen (Migrationen) für den MSO Cloud Launcher.

---

## 1. Migrations- und Update-System
Alle Änderungen an der Datenbankstruktur werden ausschließlich über `.sql`-Migrationsdateien im Ordner `/migrations/` durchgeführt. 
Das System führt diese Migrationen beim Starten der Node.js-Anwendung oder beim Ausführen des GitHub-Updaters automatisch und transaktionsgesichert aus.

Angewandte Migrationen werden in der Tabelle `applied_migrations` erfasst.

---

## 2. Tabellenstrukturen (Version 1.0.0)

### Tabelle: `config`
Speichert alle globalen Konfigurationswerte der Anwendung (LDAP, SMTP, Setup-Status).

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `key` (PK) | TEXT | Eindeutiger Konfigurationsschlüssel |
| `value` | TEXT | Der Wert des Schlüssels (als String oder JSON) |

**Initial gesetzte Werte:**
* `setup_completed`: `'1'` (nach Abschluss des Assistenten)
* `ldap_enabled`: `'0'` (standardmäßig deaktiviert)
* `smtp_from`: `'no-reply@mso-hef.de'`

---

### Tabelle: `users`
Verwaltet lokale Accounts und dient als Cache für angemeldete LDAP-Nutzer.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `username` | TEXT (UNIQUE) | Eindeutiger Benutzername |
| `email` | TEXT (UNIQUE) | E-Mail-Adresse für Passwort-Resets |
| `password_hash` | TEXT | Bcrypt-Passworthash (NULL bei LDAP-only) |
| `role` | TEXT | Hauptrolle im System (`admin`, `user`) |
| `groups` | TEXT | JSON-Array zugeordneter Gruppen (z.B. `["Lehrer", "Admin"]`) |
| `is_ldap` | INTEGER | Flag für LDAP-Benutzer (`0` = lokal, `1` = LDAP) |
| `created_at` | DATETIME | Erstellungszeitpunkt |

---

### Tabelle: `tiles`
Enthält alle Dienste-Kacheln, die auf dem Dashboard angezeigt werden.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `title` | TEXT | Titel des Dienstes |
| `description` | TEXT | Kurzer Beschreibungstext |
| `icon` | TEXT | FontAwesome 6 Icon-Klasse (z.B. `fa-graduation-cap`) |
| `link` | TEXT | Ziel-URL des Dienstes |
| `visibility` | TEXT | Sichtbarkeit (`public`, `logged_in`, `groups`) |
| `allowed_groups` | TEXT | JSON-Array zugelassener Gruppen bei Sichtbarkeit `groups` |
| `sso_type` | TEXT | SSO-Verfahren (`none`, `query`, `jwt`) |
| `sso_key` | TEXT | Symmetrischer Schlüssel für SSO-Signierung |
| `sort_order` | INTEGER | Priorität für die Anzeigereihenfolge |
| `time_limit_enabled` | INTEGER | Flag für Zeitsperre (`0` = Inaktiv, `1` = Aktiv) |
| `time_limit_start` | TEXT | Startzeitpunkt der Kachel-Aktivität (`HH:MM`) |
| `time_limit_end` | TEXT | Endzeitpunkt der Kachel-Aktivität (`HH:MM`) |

---

### Tabelle: `ldap_mappings`
Verknüpft Active-Directory/LDAP Gruppen-DNs mit lokalen MSO Cloud Sicherheitsgruppen.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `ldap_group_dn` | TEXT (UNIQUE) | Voller Distinguished Name der LDAP-Gruppe |
| `local_group` | TEXT | Name der zugewiesenen lokalen Sicherheitsgruppe |

---

### Tabelle: `password_resets`
Speichert zeitlich begrenzte Sicherheits-Tokens für lokale Passwort-Resets.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `user_id` | INTEGER (FK) | Verweis auf den Benutzer (`users.id`) |
| `token` | TEXT (UNIQUE) | Sicheres Zufalls-Token |
| `expires_at` | DATETIME | Ablaufzeitpunkt (1 Stunde ab Erstellung) |
| `used` | INTEGER | Flag, ob Token verbraucht wurde (`0` = nein, `1` = ja) |

---

### Tabelle: `oauth_clients`
Speichert alle registrierten OAuth 2.0 Clients (z. B. Moodle).

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `client_name` | TEXT | Anzeigename des Clients (z. B. 'Moodle') |
| `client_id` | TEXT (UNIQUE) | Eindeutige Client-ID für das SSO |
| `client_secret` | TEXT | Geheimer Registrierungsschlüssel für den Token-Austausch |
| `redirect_uri` | TEXT | Die erlaubte Redirect-URI (Callback-URL) des Clients |
| `created_at` | DATETIME | Registrierungszeitpunkt |

---

### Tabelle: `oauth_codes`
Verwaltet temporäre, einweg-verwendbare Authorization Codes.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `code` | TEXT (UNIQUE) | 32-stelliger Authorization Code |
| `user_id` | INTEGER (FK) | Verweis auf den autorisierten Benutzer (`users.id`) |
| `client_id` | TEXT | Verweis auf den anfordernden Client |
| `redirect_uri` | TEXT | Callback-URL (muss mit der Client-URI übereinstimmen) |
| `expires_at` | DATETIME | Ablaufzeitpunkt (10 Minuten ab Generierung) |
| `used` | INTEGER | Flag zur einmaligen Verwendung (`0` = aktiv, `1` = verbraucht) |

---

### Tabelle: `oauth_tokens`
Speichert generierte Access Tokens (Bearer) für API-Zugriffe (z. B. /userinfo).

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `access_token` | TEXT (UNIQUE) | 64-stelliges zufälliges Bearer Access Token |
| `user_id` | INTEGER (FK) | Verweis auf den Benutzer (`users.id`) |
| `client_id` | TEXT | Verweis auf den Client |
| `expires_at` | DATETIME | Ablaufzeitpunkt (1 Stunde ab Generierung) |

---

### Tabelle: `user_sph_credentials`
Speichert die optionalen Schulportal Hessen Zugangsdaten der Benutzer für das automatisierte Login-Script.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `user_id` (PK, FK) | INTEGER | ID des zugehörigen Benutzers (`users.id`) |
| `sph_username` | TEXT | Benutzername für das Schulportal Hessen |
| `sph_password` | TEXT | Passwort für das Schulportal Hessen (gesichert hinterlegt) |

---

### Tabelle: `news_messages`
Verwaltet globale Ankündigungen und News-Nachrichten für das Portal-Dashboard.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `title` | TEXT | Titel der Nachricht |
| `content` | TEXT | Der Nachrichtentext (HTML / Text) |
| `type` | TEXT | Der Anzeigetyp (`temporary` = zeitgesteuert, `until_confirmation` = bis zur Bestätigung) |
| `start_date` | TEXT | Startdatum und Uhrzeit der Sichtbarkeit (ISO-Format) |
| `end_date` | TEXT | Enddatum und Uhrzeit der Sichtbarkeit (ISO-Format) |
| `created_at` | DATETIME | Erstellungszeitpunkt |

---

### Tabelle: `user_message_confirmations`
Speichert die Lesebestätigungen eingeloggter Benutzer für Nachrichten des Typs `until_confirmation`.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `user_id` (PK, FK) | INTEGER | Verweis auf den Benutzer (`users.id`) |
| `message_id` (PK, FK) | INTEGER | Verweis auf die gelesene Nachricht (`news_messages.id`) |
| `confirmed_at` | DATETIME | Zeitpunkt der Bestätigung |

---


### Tabelle: `student_profiles`
Speichert detaillierte Stammdaten, Zustimmungen und Ausweisbilder der Schüler.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `user_id` (PK, FK) | INTEGER | Verweis auf den Benutzer (`users.id`) |
| `first_name` | TEXT | Vorname des Schülers |
| `last_name` | TEXT | Nachname des Schülers |
| `birth_date` | TEXT | Geburtsdatum des Schülers |
| `birth_place` | TEXT | Geburtsort des Schülers |
| `mediothek_number` | TEXT | Lesenummer der Mediothek |
| `start_password` | TEXT | Klartext-Passwort zur Erstanzeige |
| `account_status` | TEXT | Status des Benutzerkontos (`true`/`false`) |
| `card_status` | TEXT | Ausweisbild-Prüfstatus (`Bild ungeprüft / Kein Bild`, `Bild eingereicht` etc.) |
| `card_image` | TEXT | Base64-kodiertes Passbild für den Schülerausweis |
| `dsgvo_consent` | TEXT | Zustimmung zur DSGVO |
| `publish_consent` | TEXT | Zustimmung zur Veröffentlichung personenbezogener Daten |
| `usage_consent` | TEXT | Zustimmung zur Verwendung von Daten |
| `videoconference_consent` | TEXT | Zustimmung für Videokonferenzen |
| `card_processing_consent` | TEXT | Zustimmung zur Ausweisbildverarbeitung |
| `paednetz_terms` | TEXT | Nutzungsbedingungen Pädnetz zugestimmt |
| `wlan_terms` | TEXT | Nutzungsbedingungen W-Lan zugestimmt |
| `ms365_terms` | TEXT | Nutzungsbedingungen MS365 zugestimmt |
| `paednetz_logging` | TEXT | Protokollierung Pädnetz zugestimmt |
| `wlan_logging` | TEXT | Protokollierung W-Lan zugestimmt |
| `ms365_logging` | TEXT | Protokollierung MS365 zugestimmt |
| `onlinedienste_logging` | TEXT | Protokollierung Onlinedienste zugestimmt |

---

### Tabelle: `student_tokens`
Verwaltet temporäre E-Mail-Anmeldelinks (Tokens) für den Schüler-Erstlogin.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `user_id` (FK) | INTEGER | Verweis auf den Benutzer (`users.id`) |
| `token` | TEXT (UNIQUE) | Sicheres 48-stelliges Zufalls-Token |
| `expires_at` | DATETIME | Ablaufzeitpunkt (20 Minuten ab Generierung) |
| `used` | INTEGER | Verbrauchsstatus (`0` = aktiv, `1` = verwendet) |
| `created_at` | DATETIME | Erstellungszeitpunkt |

---

### Tabelle: `applied_migrations`
Erfasst alle erfolgreich importierten Datenbank-Migrationsdateien.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `name` | TEXT (UNIQUE) | Name der SQL-Migrationsdatei |
| `applied_at` | DATETIME | Ausführungszeitpunkt |

---

### Tabelle: `system_logs`
Speichert persistente System- und Sicherheits-Protokolle (Audit Log).

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `level` | TEXT | Log-Level ('info', 'warn', 'error') |
| `action` | TEXT | Log-Aktion (z. B. 'login_failed', 'password_reset_requested') |
| `message` | TEXT | Protokoll-Nachricht |
| `details` | TEXT | JSON-kodierte Zusatzdetails (LDAP-Meldungen, exceptions etc.) |
| `ip` | TEXT | IP-Adresse des anfragenden Clients |
| `created_at` | DATETIME | Zeitstempel des Ereignisses |

---

## 3. Datenbank-Update-Skripte für GitHub
Bei zukünftigen Updates über GitHub vergleicht der Updater den Ordner `/migrations` und führt neue `.sql`-Dateien automatisch aus.
Jede neue Migration muss als separate Datei (z.B. `002_add_new_fields.sql`) hinterlegt werden.

---

## 4. Zentrale MySQL-Datenbank-Integration (Produktionsbetrieb)

Im Produktionsbetrieb (wenn MySQL-Verbindungsdaten in den Umgebungsvariablen wie `MYSQL_HOST` gesetzt sind) werden die Daten des Schülerportals (Stammdaten & Zugänge), des digitalen Schülerausweises sowie des Erstlogins (E-Mail-Tokens) aus einer zentralen MySQL-Datenbank bezogen und dort aktualisiert. Alle anderen Funktionen der MSO Cloud verweilen autark auf der lokalen SQLite-Datenbank.

### MySQL-Tabellenübersicht

#### Tabelle: `fieldvalues`
Speichert die dynamischen Anmeldedaten und Profileigenschaften der Schüler basierend auf ihrer Antrags-ID (`application`).
*   `application` (INTEGER) - ID des Schülerantrags.
*   `field` (INTEGER) - Feld-ID der Eigenschaft (z. B. `18` für E-Mail, `1` für Vorname, `2` für Nachname, `3` für Geburtsdatum, `147` für MSO Startpasswort, `158` für Ausweisstatus, `164` für SPH-Startpasswort).
*   `value` (TEXT) - Der eingetragene Wert des Feldes (oder Subfield-ID bei Select-Typen).

#### Tabelle: `applications`
Verwaltet den allgemeinen Status eines Schülerantrags.
*   `ID` (INTEGER, PK) - ID des Antrags (entspricht `fieldvalues.application`).
*   `status` (INTEGER) - Bearbeitungsstatus (`10` = Freigeschaltet/Aktiv, `< 10` = In Bearbeitung/Ausstehend).

#### Tabelle: `schueleremailtokens`
Verwaltet die temporären Token-Anmeldelinks für den E-Mail-Erstlogin.
*   `token` (VARCHAR, UNIQUE) - 48-stelliges zufälliges Hex-Token.
*   `IDapplication` (INTEGER) - Verweis auf die Antrags-ID in `applications`.
*   `state` (INTEGER) - Status des Tokens (`0` = neu, `1` = verwendet).
*   `datetime` (DATETIME) - Erstellungszeitpunkt des Tokens (20 Minuten Gültigkeit).

#### Tabelle: `images`
Speichert das per Gesichtserkennung (Pico.js) zugeschnittene Passbild der Schüler.
*   `application` (INTEGER) - Die Antrags-ID.
*   `field` (INTEGER) - Das Bildfeld (immer `37` für Schülerausweise).
*   `file` (MEDIUMTEXT / LONGTEXT) - Das Base64-kodierte Passbild des Schülers.

#### Tabelle: `documentation`
Protokolliert alle Erhebungs-, Änderungs- und Abfrageprozesse zu Prüf- und Revisionszwecken.
*   `user` (INTEGER, NULLABLE) - Ausführender Backend-Nutzer.
*   `application` (INTEGER, NULLABLE) - Betroffene Antrags-ID.
*   `category` (VARCHAR) - Log-Kategorie (`Information`, `Warnung`, `Fehler`, `Kritisch`).
*   `task` (VARCHAR) - Art des Vorgangs (`Erhebung/Veränderung`, `Abfrage`, `Übermittlung`, `Löschung`).
*   `page` (VARCHAR) - Modul/Name des Scripts (z. B. `sendmaillogin`, `lobby`, `uploadfiletodatabase`).
*   `element` (VARCHAR, NULLABLE) - Betroffenes Feld oder Datenbanktabelle.
*   `comment` (TEXT) - Beschreibung des Ereignisses.
*   `value` (TEXT, NULLABLE) - Genutzter Wert (z. B. E-Mail-Adresse oder geändertes Feld).
*   `ip` (VARCHAR) - IP-Adresse des ausführenden Clients.

