const ldap = require('ldapjs');
const { db, getConfig } = require('./db');

/**
 * Erstellt einen LDAP-Client basierend auf den detaillierten Datenbank-Konfigurationen.
 */
function createLdapClient(overrideConfig = null) {
  // Erlaubt das Testen mit ungespeicherten Werten
  const host = overrideConfig ? overrideConfig.ldap_url : getConfig('ldap_url', '127.0.0.1');
  const port = overrideConfig ? overrideConfig.ldap_port : getConfig('ldap_port', '389');
  const secure = overrideConfig ? (overrideConfig.ldap_secure === '1') : (getConfig('ldap_secure') === '1');
  const tlsVerify = overrideConfig ? (overrideConfig.ldap_tls_verify === '1') : (getConfig('ldap_tls_verify') === '1');

  if (!host) {
    throw new Error('LDAP-Server Host/URL ist nicht konfiguriert.');
  }

  const proto = secure ? 'ldaps://' : 'ldap://';
  const fullUrl = `${proto}${host}:${port}`;

  console.log(`Verbinde mit LDAP unter: ${fullUrl} (Secure: ${secure}, Verify Cert: ${tlsVerify})`);

  return ldap.createClient({
    url: fullUrl,
    timeout: 5000,
    connectTimeout: 5000,
    tlsOptions: {
      rejectUnauthorized: tlsVerify // Verifiziert das SSL-Zertifikat nur, wenn gewünscht (wichtig bei selbstsignierten DCs!)
    }
  });
}

/**
 * Führt eine LDAP-Authentifizierung durch und gibt das Benutzerprofil sowie Gruppen zurück.
 */
async function authenticate(username, password) {
  const enabled = getConfig('ldap_enabled') === '1';
  if (!enabled) {
    console.log('LDAP ist in den Einstellungen deaktiviert.');
    return null;
  }

  const bindDn = getConfig('ldap_bind_dn');
  const bindPassword = getConfig('ldap_bind_password');
  const baseDn = getConfig('ldap_base_dn');
  const userAttr = getConfig('ldap_user_attribute', 'sAMAccountName');
  const mailAttr = getConfig('ldap_mail_attribute', 'mail');
  const nameAttr = getConfig('ldap_name_attribute', 'displayName');
  const upnSuffix = getConfig('ldap_upn_suffix', '');

  // Loginname anpassen, falls UPN-Suffix konfiguriert ist
  let loginUser = username;
  if (upnSuffix && !username.includes('@')) {
    loginUser = username + upnSuffix;
  }

  // Suchfilter zusammensetzen
  const userFilter = `(&(objectClass=user)(${userAttr}=${username}))`;

  return new Promise((resolve, reject) => {
    let client;
    try {
      client = createLdapClient();
    } catch (err) {
      return reject(err);
    }

    client.on('error', (err) => {
      console.error('LDAP Client-Fehler:', err);
    });

    // 1. Mit Service-Account (Reader) binden, um den User zu suchen
    client.bind(bindDn, bindPassword, (err) => {
      if (err) {
        client.destroy();
        return reject(new Error('LDAP-Admin-Bind fehlgeschlagen: ' + err.message));
      }

      const opts = {
        filter: userFilter,
        scope: 'sub',
        attributes: ['dn', mailAttr, nameAttr, 'memberOf', 'cn']
      };

      let userEntry = null;

      // 2. Suche nach dem Benutzer
      client.search(baseDn, opts, (err, res) => {
        if (err) {
          client.destroy();
          return reject(new Error('LDAP-Suche fehlgeschlagen: ' + err.message));
        }

        res.on('searchEntry', (entry) => {
          userEntry = entry.object;
        });

        res.on('error', (err) => {
          client.destroy();
          return reject(new Error('LDAP-Suchstrom-Fehler: ' + err.message));
        });

        res.on('end', (result) => {
          if (!userEntry) {
            client.destroy();
            return resolve(null); // Benutzer nicht gefunden im LDAP
          }

          // 3. User-Bind ausführen (das vom User eingegebene Passwort verifizieren)
          const userDn = userEntry.dn || userEntry.objectName;
          
          client.bind(userDn, password, (err) => {
            if (err) {
              client.destroy();
              return resolve(null); // Passwort falsch oder Bind fehlgeschlagen
            }

            // Bind war erfolgreich! LDAP-Benutzerdaten sammeln
            const email = userEntry[mailAttr] || '';
            const displayName = userEntry[nameAttr] || userEntry.cn || username;
            
            // Gruppen verarbeiten (LDAP gibt Gruppen als String oder Array zurück)
            let memberOf = userEntry.memberOf || [];
            if (typeof memberOf === 'string') {
              memberOf = [memberOf];
            }

            // Lokale Gruppen-Mappings abgleichen
            const localRoles = mapLdapGroupsToLocal(memberOf);

            client.destroy();
            resolve({
              username: username,
              email: email,
              name: displayName,
              roles: localRoles,
              isLdap: true
            });
          });
        });
      });
    });
  });
}

/**
 * Gleicht die LDAP-Gruppen-DNs mit den in der SQLite-Datenbank konfigurierten Mappings ab.
 */
function mapLdapGroupsToLocal(ldapGroups) {
  if (!ldapGroups || ldapGroups.length === 0) return [];

  try {
    const mappings = db.prepare('SELECT ldap_group_dn, local_group FROM ldap_mappings').all();
    const assignedLocalGroups = new Set();

    for (const mapping of mappings) {
      const match = ldapGroups.some(group => 
        group.toLowerCase() === mapping.ldap_group_dn.toLowerCase() ||
        group.toLowerCase().includes(mapping.ldap_group_dn.toLowerCase())
      );

      if (match) {
        assignedLocalGroups.add(mapping.local_group);
      }
    }

    return Array.from(assignedLocalGroups);
  } catch (err) {
    console.error('Fehler beim Abgleich der LDAP-Gruppen-Mappings:', err);
    return [];
  }
}

/**
 * Testet die LDAP-Verbindung live mit den angegebenen Verbindungsparametern.
 */
async function testConnection(config) {
  return new Promise((resolve, reject) => {
    let client;
    try {
      client = createLdapClient(config);
    } catch (err) {
      return reject(new Error('Client-Erstellung fehlgeschlagen: ' + err.message));
    }

    client.on('error', (err) => {
      console.error('LDAP Test-Verbindung Client-Fehler:', err);
    });

    client.bind(config.ldap_bind_dn, config.ldap_bind_password, (err) => {
      client.destroy();
      if (err) {
        return reject(new Error('Authentifizierung fehlgeschlagen: ' + err.message));
      }
      resolve(true);
    });
  });
}

module.exports = {
  authenticate,
  testConnection
};
