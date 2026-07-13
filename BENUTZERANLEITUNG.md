# MSO Cloud Portal – Benutzeranleitung

Willkommen im **MSO Cloud Portal** der Modellschule Obersberg (MSO). Diese Anleitung erklärt Ihnen als Schüler oder Lehrkraft, wie Sie die zentralen Funktionen des Portals nutzen können.

---

## 1. MSO Cloud Login & Passwort-Verwaltung

### Erstmalige Anmeldung (Erst-Login für Schüler)
Bei Schuleintritt erhalten Sie einen persönlichen Aktivierungslink per E-Mail oder ein temporäres Erstpasswort von der Schule.
1. Rufen Sie den Aktivierungslink auf oder geben Sie Ihr temporäres Passwort auf der Startseite ein.
2. Sie werden aufgefordert, Ihr **persönliches Kennwort** zu setzen.

### Passwort zurücksetzen
* **Für Schüler**:
  * Falls Sie Ihr Passwort vergessen haben, klicken Sie auf der Anmeldeseite auf **„Passwort vergessen?“**.
  * Geben Sie Ihre registrierte E-Mail-Adresse an. Sie erhalten einen sicheren Link per E-Mail, der 20 Minuten lang gültig ist und mit dem Sie ein neues Passwort festlegen können.
* **Für Lehrkräfte (Active-Directory/Schulnetzwerk)**:
  * Da Ihr Login direkt mit dem Schulnetzwerk (LDAP/Active Directory) verknüpft ist, entspricht Ihr MSO-Cloud-Passwort Ihrem normalen PC-Passwort in der Schule.
  * Wenn Sie dieses ändern oder zurücksetzen möchten, wenden Sie sich bitte an die IT-Administration der Schule oder nutzen Sie das schulinterne Passwort-Portal.

---

## 2. Zugangsdaten verknüpfen & abrufen (SSO)

Das Portal bietet einen automatischen Login (Single Sign-On, SSO) für verschiedene Schulplattformen an. 

### Schulportal Hessen (SPH) verknüpfen
1. Klicken Sie auf der entsprechenden Kachel (z. B. *Schulportal*) auf das kleine **Schlüssel-Symbol** (Link verknüpfen).
2. Tragen Sie einmalig Ihren Benutzernamen und Ihr Passwort für das Schulportal Hessen ein.
3. Wenn Sie die Kachel das nächste Mal anklicken, loggt das Portal Sie vollautomatisch im Schulportal ein.

### Automatische Weiterleitung
Sie können Ihre Zugangsdaten jederzeit über das Schlüssel-Symbol anpassen oder löschen. Ihre Passwörter werden im Portal verschlüsselt und sicher verwaltet.

---

## 3. Der digitale Schülerausweis (PWA)

Ihr Schülerausweis ist digital, fälschungssicher und direkt auf Ihrem Smartphone abrufbar.

### Schülerausweis aufrufen & auf dem Homescreen speichern (PWA)
1. Melden Sie sich auf Ihrem Smartphone im MSO Cloud Portal an.
2. Klicken Sie im Menü auf **„Schülerausweis“**. Der Ausweis öffnet sich als eigenständige, mobile-optimierte Seite.
3. **Auf dem Homescreen speichern**:
   * **iOS (Safari)**: Tippen Sie unten auf das Teilen-Symbol (Viereck mit Pfeil) und wählen Sie **„Zum Home-Bildschirm hinzufügen“**.
   * **Android (Chrome)**: Tippen Sie oben rechts auf die drei Punkte und wählen Sie **„Zum Startbildschirm hinzufügen“** oder **„App installieren“**.
4. Der Schülerausweis verhält sich nun wie eine **native App**: Er kann direkt vom Homescreen gestartet werden und funktioniert dank Offline-Speicher auch dann, wenn Sie in der Schule kein Internet haben.

### Fälschungssichere Merkmale
Um Missbrauch zu verhindern, verfügt der digitale Schülerausweis über modernste Sicherheitsmerkmale:
* **Dynamisches Hologramm**: Bei Bewegung oder Berührung des Displays rotiert ein fälschungssicheres, schimmerndes MSO-Siegel.
* **Live-Uhrzeit**: Eine auf die Sekunde genaue Uhrzeit läuft permanent mit. Screenshots oder statische Bildkopien fallen dadurch sofort auf.
* **Ablaufdatum**: Der Ausweis speichert sich verschlüsselt lokal ab und hat ein definiertes Ablaufdatum (jeweils bis zum Ende des laufenden Schuljahres). Nach Ablauf muss sich Ihr Smartphone einmal online mit der Cloud verbinden, um die Gültigkeit zu erneuern.
* **Serverseitige Sperrung (Revoke)**: Bei Schulabgang oder Verlust des Status kann die Schule den Ausweis im Admin-Bereich sofort sperren. Sobald Ihr Ausweis das nächste Mal online geht, wird er auf Ihrem Smartphone ungültig geschaltet.
