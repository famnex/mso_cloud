<?php
header('Content-Type: text/plain; charset=utf-8');

function ok($k, $v='OK'){ echo "[OK] $k: $v\n"; }
function fail($k, $v){ http_response_code(500); echo "[FAIL] $k: $v\n"; exit(1); }

$base = dirname(__DIR__);
$inc  = $base . '/inc';
$logf = $base . '/logs/app.log';

// 1) PHP-Erweiterungen
foreach (['mbstring','openssl','pdo_mysql'] as $ext) {
  if (!extension_loaded($ext)) fail("PHP ext $ext", "nicht geladen");
}
ok('PHP extensions (mbstring, openssl, pdo_mysql)');

if (!extension_loaded('ldap')) fail('PHP ext ldap', 'nicht geladen');
ok('PHP ext ldap');

// 2) Composer / PHPMailer
$autoload = $base . '/vendor/autoload.php';
if (!file_exists($autoload)) fail('Composer', 'vendor/autoload.php fehlt – `composer install` ausführen');
require_once $autoload;
if (!class_exists('PHPMailer\\PHPMailer\\PHPMailer')) fail('PHPMailer', 'Klasse nicht gefunden');
ok('PHPMailer');

// 3) Logs beschreibbar?
if (!is_dir($base.'/logs')) fail('logs/', 'Verzeichnis fehlt');
$w = @file_put_contents($logf, "[".date('c')."] preflight\n", FILE_APPEND);
if ($w === false) fail('logs/app.log', 'nicht beschreibbar (Rechte?)');
ok('logs/app.log', 'beschreibbar');

// 4) Config laden
$cfg = require $inc.'/config.php';
ok('config.php geladen', $cfg['APP']['ENV'] ?? '-');

// 5) DB Verbindung
try {
  $pdo = new PDO($cfg['DB']['DSN'], $cfg['DB']['USER'], $cfg['DB']['PASS'], $cfg['DB']['OPTIONS']);
  $pdo->query('SELECT 1');
  ok('DB', 'Verbindung OK');
  // Tabelle vorhanden?
  $pdo->query('SELECT id FROM password_reset_tokens LIMIT 0');
  ok('DB Tabelle', 'password_reset_tokens vorhanden');
} catch (Throwable $e) {
  fail('DB', $e->getMessage());
}

// 6) LDAP Bind
try {
  $conn = @ldap_connect($cfg['LDAP']['HOST']);
  if (!$conn) fail('LDAP connect', 'false');
  ldap_set_option($conn, LDAP_OPT_PROTOCOL_VERSION, 3);
  ldap_set_option($conn, LDAP_OPT_REFERRALS, 0);
  if (stripos($cfg['LDAP']['HOST'],'ldap://')===0) {
    if (!@ldap_start_tls($conn)) fail('LDAP StartTLS', 'fehlgeschlagen');
  }
  if (!@ldap_bind($conn, $cfg['LDAP']['BIND_DN'], $cfg['LDAP']['BIND_PASS'])) {
    fail('LDAP bind', 'fehlgeschlagen (DN/Pass/Firewall/LDAPS?)');
  }
  ok('LDAP', 'Bind OK');
} catch (Throwable $e) { fail('LDAP', $e->getMessage()); }

// 7) SMTP nur „oberflächlich“ prüfen (kein Versand)
$host = $cfg['SMTP']['HOST']; $port = (int)$cfg['SMTP']['PORT'];
$fp = @fsockopen($host, $port, $errno, $errstr, 5);
if (!$fp) fail('SMTP connect', "[$host:$port] $errno $errstr");
fclose($fp);
ok('SMTP', "Port $port erreichbar");

echo "\nAlles gut. Jetzt /reset_request.php testen.\n";
?>
