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

### Tabelle: `applied_migrations`
Erfasst alle erfolgreich importierten Datenbank-Migrationsdateien.

| Spalte | Datentyp | Beschreibung |
| :--- | :--- | :--- |
| `id` (PK) | INTEGER | Eindeutige ID (Auto-Increment) |
| `name` | TEXT (UNIQUE) | Name der SQL-Migrationsdatei |
| `applied_at` | DATETIME | Ausführungszeitpunkt |

---

## 3. Datenbank-Update-Skripte für GitHub
Bei zukünftigen Updates über GitHub vergleicht der Updater den Ordner `/migrations` und führt neue `.sql`-Dateien automatisch aus.
Jede neue Migration muss als separate Datei (z.B. `002_add_new_fields.sql`) hinterlegt werden.
