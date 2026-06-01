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

  // Suchfilter zusammensetzen (sucht sowohl nach sAMAccountName als auch nach dem UPN / E-Mail!)
  const userFilter = `(&(objectClass=user)(|(${userAttr}=${username})(userPrincipalName=${loginUser})))`;

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
          // Da ldapjs v3 kein entry.object mehr bereitstellt, extrahieren wir die Attribute manuell
          const obj = {};
          const attributes = entry.attributes || [];
          for (const attr of attributes) {
            const type = attr.type;
            const values = attr.values || [];
            let val = '';
            if (values.length === 1) {
              val = values[0];
            } else if (values.length > 1) {
              val = values;
            }
            
            // Sowohl unter dem Original-Schlüssel als auch in Kleinschreibung ablegen (für Case-Insensitivity)
            obj[type] = val;
            obj[type.toLowerCase()] = val;
          }
          userEntry = obj;
          userEntry.dn = entry.dn.toString();
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
          const userDn = userEntry.dn;
          
          client.bind(userDn, password, (err) => {
            if (err) {
              client.destroy();
              return resolve(null); // Passwort falsch oder Bind fehlgeschlagen
            }

            // Bind war erfolgreich! LDAP-Benutzerdaten sammeln (unterstützt original- und kleingeschriebene Key-Varianten)
            const email = userEntry[mailAttr] || userEntry[mailAttr.toLowerCase()] || '';
            const displayName = userEntry[nameAttr] || userEntry[nameAttr.toLowerCase()] || userEntry.cn || userEntry.CN || username;
            
            // Gruppen verarbeiten (LDAP gibt Gruppen als String oder Array zurück)
            let memberOf = userEntry.memberOf || userEntry.memberof || [];
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
              rawGroups: memberOf,
              isLdap: true
            });
          });
        });
      });
    });
  });
}

/**
 * Hilfsfunktion zur Extraktion des Common Name (CN) aus einem Distinguished Name (DN).
 * Z.B. "CN=Lehrer,OU=Groups,DC=mso,DC=local" -> "Lehrer"
 */
function getCNfromDN(dn) {
  const match = dn.match(/cn=([^,]+)/i);
  return match ? match[1].trim() : dn;
}

/**
 * Gleicht die LDAP-Gruppen-DNs mit den in der SQLite-Datenbank konfigurierten Mappings ab.
 * Unterstützt sowohl die Eingabe vollständiger DNs als auch einfacher Gruppennamen (CN)!
 */
function mapLdapGroupsToLocal(ldapGroups) {
  if (!ldapGroups || ldapGroups.length === 0) return [];

  try {
    const mappings = db.prepare('SELECT ldap_group_dn, local_group FROM ldap_mappings').all();
    const assignedLocalGroups = new Set();

    for (const mapping of mappings) {
      const match = ldapGroups.some(group => {
        const groupDN = group.toLowerCase();
        const mappingDN = mapping.ldap_group_dn.toLowerCase();
        
        // 1. Exakter Treffer (falls der Nutzer den vollen DN hinterlegt hat)
        if (groupDN === mappingDN) return true;
        
        // 2. CN extrahieren und vergleichen (erlaubt einfache Namen wie "Lehrer" statt vollem DN)
        const cn = getCNfromDN(group).toLowerCase();
        return cn === mappingDN;
      });

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

/**
 * Holt die aktuellen LDAP-Gruppen eines Benutzers und map-t diese auf lokale Gruppen.
 * Verwendet den Reader-Account (kein User-Passwort erforderlich).
 */
async function syncUserGroups(username) {
  const enabled = getConfig('ldap_enabled') === '1';
  if (!enabled) {
    throw new Error('LDAP ist in den Einstellungen deaktiviert.');
  }

  const bindDn = getConfig('ldap_bind_dn');
  const bindPassword = getConfig('ldap_bind_password');
  const baseDn = getConfig('ldap_base_dn');
  const userAttr = getConfig('ldap_user_attribute', 'sAMAccountName');
  const upnSuffix = getConfig('ldap_upn_suffix', '');

  let loginUser = username;
  if (upnSuffix && !username.includes('@')) {
    loginUser = username + upnSuffix;
  }

  const userFilter = `(&(objectClass=user)(|(${userAttr}=${username})(userPrincipalName=${loginUser})))`;

  return new Promise((resolve, reject) => {
    let client;
    try {
      client = createLdapClient();
    } catch (err) {
      return reject(err);
    }

    client.on('error', (err) => {
      console.error('LDAP Sync-Client-Fehler:', err);
    });

    client.bind(bindDn, bindPassword, (err) => {
      if (err) {
        client.destroy();
        return reject(new Error('LDAP-Admin-Bind fehlgeschlagen: ' + err.message));
      }

      const opts = {
        filter: userFilter,
        scope: 'sub',
        attributes: ['memberOf', 'memberof']
      };

      let memberOfRaw = null;

      client.search(baseDn, opts, (err, res) => {
        if (err) {
          client.destroy();
          return reject(new Error('LDAP-Suche fehlgeschlagen: ' + err.message));
        }

        res.on('searchEntry', (entry) => {
          const attributes = entry.attributes || [];
          for (const attr of attributes) {
            const type = attr.type.toLowerCase();
            if (type === 'memberof') {
              memberOfRaw = attr.values || [];
            }
          }
        });

        res.on('error', (err) => {
          client.destroy();
          return reject(new Error('LDAP-Suchstrom-Fehler: ' + err.message));
        });

        res.on('end', (result) => {
          client.destroy();

          if (!memberOfRaw) {
            return resolve([]); // Keine Gruppen gefunden oder Benutzer nicht gefunden
          }

          let memberOf = memberOfRaw;
          if (typeof memberOf === 'string') {
            memberOf = [memberOf];
          }

          // Return raw LDAP groups directly
          resolve(memberOf);
        });
      });
    });
  });
}

module.exports = {
  authenticate,
  testConnection,
  syncUserGroups
};
