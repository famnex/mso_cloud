# MSO Cloud Launcher - Deployment-Guide (Linux Server)

Dieser Guide beschreibt Schritt für Schritt, wie Sie den neu entwickelten MSO Cloud Launcher auf einem Linux-Server mit **PM2** und **Nginx** in Betrieb nehmen und unter der Subdomain **`novus.mso-hef.de`** erreichbar machen.

---

## 1. System-Voraussetzungen auf dem Linux-Server

Stellen Sie sicher, dass Git, Node.js (Version 18 oder höher), npm und Nginx auf dem Server installiert sind.

```bash
# System-Pakete aktualisieren
sudo apt update && sudo apt upgrade -y

# Git & Curl installieren (falls nicht vorhanden)
sudo apt install git curl -y

# Node.js (LTS Version) über NodeSource einrichten
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs -y

# Installationen prüfen
node -v  # Sollte >= 18.x sein
npm -v

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
```
*Hinweis: Der `pm2 startup` Befehl gibt am Ende einen Befehl aus, den Sie kopieren und mit `sudo` ausführen müssen (z.B. `sudo env PATH=... pm2 startup systemd ...`).*

```bash
# PM2-Prozess-Liste speichern, damit sie nach Neustarts geladen wird
pm2 save
```

### Nützliche PM2-Befehle:
* **Status prüfen**: `pm2 status`
* **Logs live verfolgen**: `pm2 logs mso-cloud`
* **Neustarten**: `pm2 restart mso-cloud`
* **Stoppen**: `pm2 stop mso-cloud`

---

## 4. Nginx Reverse Proxy für `novus.mso-hef.de` einrichten

Nginx leitet den Traffic von Port 80 (und später 443 für HTTPS) an den Node.js-Dienst weiter, der intern auf Port `8080` lauscht.

### A. Nginx-Konfigurationsdatei erstellen
```bash
sudo nano /etc/nginx/sites-available/novus
```

### B. Folgende Konfiguration einfügen
*(Ersetzen Sie `novus.mso-hef.de` durch Ihre tatsächliche Subdomain)*:
```nginx
server {
    listen 80;
    server_name novus.mso-hef.de;

    # Erhöhtes Upload-Limit für Schülerausweis-Fotos
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        
        # Wichtig für WebSockets / langlebige Verbindungen
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        
        # Header für IP- und Protokollweitergabe
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### C. Konfiguration aktivieren & Nginx testen
```bash
# Symbolischen Link setzen, um die Seite freizuschalten
sudo ln -s /etc/nginx/sites-available/novus /etc/nginx/sites-enabled/

# Nginx Syntax prüfen
sudo nginx -t

# Nginx neu starten
sudo systemctl restart nginx
```

---

## 5. SSL-Zertifikat (HTTPS) via Let's Encrypt einrichten

Um Passwörter und LDAP-Verbindungen abzusichern, ist HTTPS zwingend erforderlich.

```bash
# Certbot installieren
sudo apt install certbot python3-certbot-nginx -y

# SSL-Zertifikat beantragen und automatisch in Nginx einbinden lassen
sudo certbot --nginx -d novus.mso-hef.de
```
*Folgen Sie den Anweisungen im Terminal. Certbot richtet automatisch eine Weiterleitung von HTTP auf HTTPS ein und kümmert sich um die automatische Verlängerung des Zertifikats.*

---

## 6. Erstinstallation durchführen
Sobald DNS-Einträge auf die IP des Linux-Servers zeigen und HTTPS eingerichtet ist:
1. Rufen Sie **`https://novus.mso-hef.de`** im Browser auf.
2. Der Server erkennt, dass noch keine Datenbank vorhanden ist, und leitet Sie auf den Setup-Assistenten um.
3. Richten Sie Ihr Admin-Konto ein – fertig!
