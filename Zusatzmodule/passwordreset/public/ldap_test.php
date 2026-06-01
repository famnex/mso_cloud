<?php
require_once __DIR__ . '/../inc/bootstrap.php';
$config = require __DIR__ . '/../inc/config.php';
$debug = ($config['APP']['ENV'] === 'dev') || (!empty($_GET[$config['APP']['DEBUG_QUERY']]));
if (!$debug) { http_response_code(403); echo 'Forbidden'; exit; }
require_once __DIR__ . '/../inc/ldap_client.php';

$email = $_GET['email'] ?? '';
header('Content-Type: text/plain; charset=utf-8');

try {
    if (!$email) throw new RuntimeException('email param missing');
    $ldap = new LdapClient($config['LDAP']);
    $e = $ldap->findByEmail($email);
    var_dump($e ? ['dn'=>$e['dn']] : null);
} catch (Throwable $e) { http_response_code(500); echo $e; }
?>
