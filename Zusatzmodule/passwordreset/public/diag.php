<?php
require_once __DIR__ . '/../inc/bootstrap.php';
require_once __DIR__ . '/../inc/logger.php';
$config = require __DIR__ . '/../inc/config.php';
$debug = ($config['APP']['ENV'] === 'dev') || (!empty($_GET[$config['APP']['DEBUG_QUERY']]));
if (!$debug) { http_response_code(403); echo 'Forbidden'; exit; }

$checks = [
  'php_version' => PHP_VERSION,
  'extensions' => [
    'ldap'=>extension_loaded('ldap'),
    'mbstring'=>extension_loaded('mbstring'),
    'openssl'=>extension_loaded('openssl'),
    'pdo_mysql'=>extension_loaded('pdo_mysql'),
  ],
  'paths' => [
    'log' => is_writable($config['LOG']['FILE']) ? 'writable' : 'not_writable',
  ],
  'env' => $config['APP']['ENV'],
];

header('Content-Type: application/json');
echo json_encode($checks, JSON_PRETTY_PRINT);
?>
