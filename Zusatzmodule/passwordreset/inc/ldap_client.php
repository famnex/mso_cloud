<?php
class LdapClient {
    private $conn; private $cfg;
    public function __construct(array $cfg) {
        $this->cfg = $cfg;
        $this->conn = @ldap_connect($cfg['HOST']);
        if (!$this->conn) throw new RuntimeException('LDAP connect failed');
        ldap_set_option($this->conn, LDAP_OPT_PROTOCOL_VERSION, 3);
        ldap_set_option($this->conn, LDAP_OPT_REFERRALS, 0);

        // StartTLS wenn ldap://
        if (stripos($cfg['HOST'], 'ldap://') === 0) {
            if (!@ldap_start_tls($this->conn)) throw new RuntimeException('LDAP StartTLS failed');
        }
        if (!@ldap_bind($this->conn, $cfg['BIND_DN'], $cfg['BIND_PASS'])) {
            throw new RuntimeException('LDAP bind failed');
        }
    }
    public function findByEmail(string $email): ?array {
        $attr = $this->cfg['MAIL_ATTR'] ?? 'mail';
        $filter = sprintf('(%s=%s)', $attr, ldap_escape($email, '', LDAP_ESCAPE_FILTER));
        $sr = @ldap_search($this->conn, $this->cfg['BASE_DN'], $filter, ['dn',$attr,'uid','sAMAccountName','userPrincipalName']);
        if (!$sr) return null;
        $entries = ldap_get_entries($this->conn, $sr);
        if (($entries['count'] ?? 0) < 1) return null;
        return $entries[0];
    }
    public function setPassword(string $userDn, string $newPlain): bool {
        $provider = strtolower($this->cfg['PROVIDER'] ?? 'openldap');
        return $provider === 'ad' ? $this->setPasswordAD($userDn,$newPlain) : $this->setPasswordOpenLdap($userDn,$newPlain);
    }
    private function setPasswordOpenLdap(string $userDn, string $newPlain): bool {
        $scheme = strtolower($this->cfg['OPENLDAP']['SCHEME'] ?? 'bcrypt');
        if ($scheme === 'bcrypt') {
            $cost = (int)($this->cfg['OPENLDAP']['BCRYPT_COST'] ?? 12);
            $hash = password_hash($newPlain, PASSWORD_BCRYPT, ['cost'=>$cost]);
            $entry = ['userPassword' => '{CRYPT}' . $hash];
        } else {
            $salt = random_bytes(8);
            $entry = ['userPassword' => '{SSHA}' . base64_encode(sha1($newPlain . $salt, true) . $salt)];
        }
        return @ldap_modify($this->conn, $userDn, $entry);
    }
    private function setPasswordAD(string $userDn, string $newPlain): bool {
    // AD verlangt LDAPS und ein gequotetes Passwort als UTF-16LE
    $quoted  = '"' . $newPlain . '"';
    $encoded = mb_convert_encoding($quoted, 'UTF-16LE');

    // Sicherstellen, dass LDAPS aktiv ist (StartTLS oder ldaps://)
    $host = $this->cfg['HOST'] ?? '';
    $isLdaps = (stripos($host, 'ldaps://') === 0);
    $isStartTls = (stripos($host, 'ldap://') === 0); // StartTLS wurde im Konstruktor versucht
    if (!$isLdaps && !$isStartTls) {
        throw new RuntimeException('AD-Passwort setzen erfordert LDAPS/StartTLS');
    }

    // Einfach und kompatibel: ldap_mod_replace statt ldap_modify_batch
    $ok = @ldap_mod_replace($this->conn, $userDn, ['unicodePwd' => $encoded]);
    if (!$ok) {
        // Detail-Fehler für Logs
        $eno = @ldap_errno($this->conn);
        $estr = @ldap_error($this->conn);
        throw new RuntimeException("AD password set failed (errno=$eno, error=$estr)");
    }
    return true;
}

}
?>
