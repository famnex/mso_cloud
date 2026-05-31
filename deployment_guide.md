# MSO Cloud Launcher - Deployment-Guide (Linux Server)

Dieser Guide beschreibt Schritt für Schritt, wie Sie den neu entwickelten MSO Cloud Launcher auf einem Linux-Server mit **PM2** und **Apache** in Betrieb nehmen.

Es werden zwei Bereitstellungsoptionen unterstützt:
1. **Option A (Empfohlen bei bestehendem Server)**: Bereitstellung als Unterverzeichnis unter **`https://cloud.mso-hef.de/novus/`** (Erfordert **keine** DNS-Änderungen und **keine** neuen SSL-Zertifikate!).
2. **Option B**: Bereitstellung als eigenständige Subdomain unter **`https://novus.mso-hef.de`**.

---

## 1. System-Voraussetzungen auf dem Linux-Server

Stellen Sie sicher, dass Git, Node.js (Version 18 oder höher), npm und Apache auf dem Server installiert sind.

```bash
# System-Pakete aktualisieren
sudo apt update && sudo apt upgrade -y

# Git & Curl installieren (falls nicht vorhanden)
sudo apt install git curl -y

# Node.js (LTS Version) über NodeSource einrichten
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs -y

# PM2 global installieren
sudo npm install -g pm2
```

---

## 2. Projekt klonen & einrichten

Es empfiehlt sich, Webanwendungen unter `/var/www` zu platzieren.

```bash
# Verzeichnis wechseln und klonen
cd /var/www
sudo git clone https://github.com/famnex/mso_cloud.git novus

# Rechte anpassen (Nutzername durch Ihren SSH-User ersetzen, z.B. ubuntu oder debian)
sudo chown -R $USER:$USER /var/www/novus

# In den Ordner wechseln
cd /var/www/novus

# Nur Produktions-Abhängigkeiten installieren
npm install --omit=dev
```

---

## 3. PM2-Dienst starten & absichern

Da wir bereits eine `ecosystem.config.js` im Repository haben, reicht ein einziger PM2-Befehl aus.

```bash
# Anwendung im Hintergrund starten
pm2 start ecosystem.config.js

# Autostart bei System-Neustarts konfigurieren
pm2 startup
# Kopieren Sie den ausgegebenen Befehl in das Terminal und führen Sie ihn aus.

# PM2-Prozess-Liste speichern
pm2 save
```

---

## 4. Option A: Bereitstellung unter `https://cloud.mso-hef.de/novus/` (Keine DNS-Änderung!)

Da das System vollständig mit **relativen Pfaden** aufgebaut ist, kann es nahtlos als Unterordner hinter dem bereits existierenden Apache-Webserver betrieben werden.

### A. Apache Proxy-Module aktivieren
```bash
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod rewrite
sudo systemctl restart apache2
```

### B. Konfiguration in den bestehenden SSL-VirtualHost einbinden
Öffnen Sie die existierende SSL-Konfigurationsdatei für `cloud.mso-hef.de` (häufig unter `/etc/apache2/sites-available/` zu finden, z.B. `000-default-le-ssl.conf` oder `cloud-le-ssl.conf`):
```bash
sudo nano /etc/apache2/sites-available/cloud-le-ssl.conf
```

Fügen Sie innerhalb des `<VirtualHost *:443>`-Blocks (für HTTPS) folgende Zeilen hinzu:
```apache
    # Automatisch einen abschließenden Slash erzwingen, falls er fehlt (wichtig für relative Pfade)
    Redirect temp /novus /novus/

    # Proxy-Weiterleitung für den MSO-Cloud Launcher (Port 8080)
    ProxyPreserveHost On
    ProxyPass /novus/ http://127.0.0.1:8080/
    ProxyPassReverse /novus/ http://127.0.0.1:8080/
```

### C. Apache testen und neu laden
```bash
sudo apache2ctl configtest
# Wenn "Syntax OK" erscheint:
sudo systemctl reload apache2
```
*Sie können das Portal nun sofort unter **`https://cloud.mso-hef.de/novus/`** aufrufen. Es ist direkt per SSL gesichert und benötigt keine weiteren Einstellungen.*

---

## 5. Option B: Bereitstellung unter einer neuen Subdomain `https://novus.mso-hef.de`

Wenn Sie stattdessen eine eigene Subdomain nutzen möchten (erfordert DNS-Eintrag):

### A. VirtualHost-Datei erstellen
```bash
sudo nano /etc/apache2/sites-available/novus.conf
```

Inhalt einfügen:
```apache
<VirtualHost *:80>
    ServerName novus.mso-hef.de
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8080/
    ProxyPassReverse / http://127.0.0.1:8080/
    ErrorLog ${APACHE_LOG_DIR}/novus_error.log
    CustomLog ${APACHE_LOG_DIR}/novus_access.log combined
</VirtualHost>
```

### B. Aktivieren und SSL generieren
```bash
sudo a2ensite novus.conf
sudo systemctl reload apache2

# SSL-Zertifikat über Certbot beantragen
sudo apt install python3-certbot-apache -y
sudo certbot --apache -d novus.mso-hef.de
```
