const ldap = require('ldapjs');
const { db, getConfig } = require('./db');

/**
 * Erstellt einen LDAP-Client basierend auf den aktuellen Datenbank-Konfigurationen.
 */
function createLdapClient() {
  const url = getConfig('ldap_url');
  if (!url) {
    throw new Error('LDAP-URL ist nicht konfiguriert.');
  }

  // Wichtig bei Active Directory: Option, Verbindungs-Timeouts zu handhaben
  return ldap.createClient({
    url: url,
    timeout: 5000,
    connectTimeout: 5000
  });
}

/**
 * Führt eine LDAP-Authentifizierung durch und gibt das Benutzerprofil sowie Gruppen zurück.
 * @param {string} username Benutzername
 * @param {string} password Passwort
 * @returns {Promise<{username: string, email: string, roles: string[], name: string}|null>}
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
  const userFilterTpl = getConfig('ldap_user_filter', '(&(objectClass=user)(sAMAccountName={{username}}))');

  const userFilter = userFilterTpl.replace('{{username}}', username);

  return new Promise((resolve, reject) => {
    let client;
    try {
      client = createLdapClient();
    } catch (err) {
      return reject(err);
    }

    client.on('error', (err) => {
      console.error('LDAP Client-Fehler:', err);
      // Nicht direkt rejecten, falls wir uns im Suchprozess befinden
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
        attributes: ['dn', 'mail', 'cn', 'memberOf', 'displayName']
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
            const email = userEntry.mail || '';
            const displayName = userEntry.displayName || userEntry.cn || username;
            
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
 * @param {string[]} ldapGroups Array von Gruppen-DNs
 * @returns {string[]} Liste lokaler Gruppen
 */
function mapLdapGroupsToLocal(ldapGroups) {
  if (!ldapGroups || ldapGroups.length === 0) return [];

  try {
    const mappings = db.prepare('SELECT ldap_group_dn, local_group FROM ldap_mappings').all();
    const assignedLocalGroups = new Set();

    for (const mapping of mappings) {
      // Prüfen, ob die LDAP-Gruppe des Nutzers mit dem Mapping übereinstimmt
      // Case-Insensitive Vergleich
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
 * Testet die LDAP-Verbindung mit den angegebenen Verbindungsparametern.
 * Hilfreich für das Admin-Backend!
 */
async function testConnection(config) {
  return new Promise((resolve, reject) => {
    let client;
    try {
      client = ldap.createClient({
        url: config.ldap_url,
        timeout: 5000,
        connectTimeout: 5000
      });
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
