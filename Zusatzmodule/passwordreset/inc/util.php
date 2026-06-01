<?php
function base64url_encode(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function new_token_pair(): array {
    $raw = random_bytes(32); $token = base64url_encode($raw); $hash = hash('sha256', $token, true); return [$token,$hash];
}
function client_ip_binary(): string { $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; $bin = @inet_pton($ip); return $bin !== false ? $bin : inet_pton('0.0.0.0'); }
function email_hash_bin(string $email): string { return hash('sha256', strtolower(trim($email)), true); }
function password_policy_ok(string $pw, array $cfg): bool {
    if (strlen($pw) < ($cfg['PASSWORD_MIN_LENGTH'] ?? 12)) return false;
    if (!empty($cfg['PASSWORD_REGEX']) && !preg_match($cfg['PASSWORD_REGEX'], $pw)) return false;
    return true;
}
if (!function_exists('ldap_escape')) {
    function ldap_escape($subject, $ignore = '', $flags = 0) {
        $search = ['\\','*','(',')',"\x00"]; $replace = ['\\5c','\\2a','\\28','\\29','\\00']; return str_replace($search,$replace,$subject);
    }
}
?>
