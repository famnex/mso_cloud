<?php
return [
    'APP' => [
        // <-- UNBEDINGT auf deine echte, per HTTPS erreichbare Domain setzen!
        'BASE_URL' => 'https://cloud.mso-hef.de/launcher/passwordreset/public',
        // 'dev' zeigt detaillierte Fehler/Debug, 'prod' zeigt nur Fehler-ID
        'ENV' => 'prod',
        'SESSION_NAME' => 'ldap_reset_sess',
        'TOKEN_TTL_MIN' => 15,
        'RATE_LIMIT_PER_EMAIL_PER_HOUR' => 5,
        'RATE_LIMIT_PER_IP_PER_HOUR' => 20,
        'PASSWORD_MIN_LENGTH' => 8,
'PASSWORD_REGEX' => '/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/',

        // ?debug=1 in der URL aktiviert Debug-Ausgabe zusätzlich
        'DEBUG_QUERY' => 'debug',
        // Timeouts für externe Verbindungen (LDAP/SMTP/DB), Sekunden
        'REQUEST_TIMEOUT_SEC' => 10,
    ],

    // HINWEIS: Das ist die DB des Reset-Tools (NICHT die Moodle-DB).
    // Erzeuge eine kleine eigene DB (z.B. "ldap_reset") und User mit Minimalrechten.
    'DB' => [
        'DSN'  => 'mysql:host=127.0.0.1;port=3306;dbname=ldap_reset;charset=utf8mb4',
        'USER' => 'root',
        'PASS' => 'neptun',
        'OPTIONS' => [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
        ],
    ],

    // Aus deinem Moodle LDAP-Setup (Active Directory)
    'LDAP' => [
        'PROVIDER' => 'ad',
        'HOST'     => 'ldaps://10.37.128.41',
        'BASE_DN'  => 'ou=mso,dc=mso,dc=local',
        'BIND_DN'  => 'CN=Administrator,CN=Users,DC=mso,DC=local',
        'BIND_PASS'=> 'W2e=b1e8r',
        // E-Mail-Attribut im Verzeichnis:
        'MAIL_ATTR'=> 'mail',
		
        // Optional – falls du UPNs brauchst (nicht zwingend):
        'AD' => [
            'UPN_SUFFIX' => 'mso.local',
        ],
        // Wird bei AD nicht genutzt, bleibt drin falls du mal OpenLDAP nutzt
        'OPENLDAP' => [
            'SCHEME' => 'bcrypt',
            'BCRYPT_COST' => 12,
        ],
    ],

    // Aus deiner Moodle SMTP-Konfiguration (Office 365)
    'SMTP' => [
        'HOST'       => 'smtp.office365.com',
        'PORT'       => 587,
        'ENCRYPTION' => 'tls',
        'USER'       => 'moodle@mso-hef.de',
        'PASS'       => 'm2i0t0z9e.0709',
        'FROM_ADDR'  => 'moodle@mso-hef.de',
        'FROM_NAME'  => 'Passwortdienst',
        'REPLY_TO'   => null,
        // DKIM optional – wenn du es später nutzen willst
        'DKIM_DOMAIN'      => null,
        'DKIM_SELECTOR'    => null,
        'DKIM_PRIVATE_KEY' => null,
    ],

    // Robustes Logging: strukturierte JSON-Logs in logs/app.log
    'LOG' => [
        'FILE'  => __DIR__ . '/../logs/app.log',
        // 'debug' für ausführlichere Logs beim Testen; 'info' für normal
        'LEVEL' => 'info',
        'MAX_LEN' => 2000, // Logzeilen werden notfalls abgeschnitten
    ],
];
?>
