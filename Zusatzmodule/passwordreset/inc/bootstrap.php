<?php
mb_internal_encoding('UTF-8'); // stellt sicher, dass Strings als UTF-8 behandelt werden

$config = require __DIR__ . '/config.php';

// ===== Composer (PHPMailer etc.) sicher einbinden =====
$autoload = dirname(__DIR__) . '/vendor/autoload.php';
if (!file_exists($autoload)) {
    http_response_code(500);
    echo "<h1>Setup unvollständig</h1><p>Composer-Abhängigkeiten fehlen. Bitte im Projektordner <code>composer install</code> ausführen.</p>";
    exit;
}
require_once $autoload;

// ===== Fehler- & Shutdown-Handling =====
$debug = ($config['APP']['ENV'] === 'dev') || (!empty($_GET[$config['APP']['DEBUG_QUERY']]));
$cid = bin2hex(random_bytes(8));

function _safe_log($msg) {
    $logf = __DIR__ . '/../logs/app.log';
    @file_put_contents($logf, date('c')." ".$msg.PHP_EOL, FILE_APPEND);
}

set_error_handler(function($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) return;
    throw new ErrorException($message, 0, $severity, $file, $line);
});
set_exception_handler(function($ex) use ($debug, $cid){
    _safe_log("[EX] {$cid} ".get_class($ex).": ".$ex->getMessage()." @ ".$ex->getFile().":".$ex->getLine());
    http_response_code(500);
    if ($debug) echo "<pre>Fehler-ID: {$cid}\n".$ex."</pre>";
    else echo "<h1>Unerwarteter Fehler</h1><p>Fehler-ID: <code>{$cid}</code></p>";
    exit;
});
register_shutdown_function(function() use ($debug, $cid){
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR,E_PARSE,E_CORE_ERROR,E_COMPILE_ERROR])) {
        _safe_log("[SHUTDOWN] {$cid} {$e['message']} @ {$e['file']}:{$e['line']}");
        http_response_code(500);
        if ($debug) echo "<pre>Fehler-ID: {$cid}\n".print_r($e,true)."</pre>";
        else echo "<h1>Unerwarteter Fehler</h1><p>Fehler-ID: <code>{$cid}</code></p>";
    }
});

// ===== HTTPS + Security Headers =====
if ((!isset($_SERVER['HTTPS']) || $_SERVER['HTTPS'] !== 'on') && $config['APP']['ENV'] !== 'dev') {
    header('Location: https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'], true, 301);
    exit;
}

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
// erlauben Inline-CSS/JS für unsere Seiten (keine externen Domains)
header("Content-Security-Policy: default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';");
header('Referrer-Policy: no-referrer');


// ===== Session =====
session_name($config['APP']['SESSION_NAME']);
session_set_cookie_params([
  'lifetime'=>0,'path'=>'/','domain'=>'',
  'secure'=>$config['APP']['ENV']!=='dev','httponly'=>true,'samesite'=>'Strict',
]);
session_start();

// ===== PHP Error Visibility =====
ini_set('display_errors', $debug ? '1' : '0');
error_reporting($debug ? E_ALL : (E_ALL & ~E_NOTICE));

function h($s){ return htmlspecialchars($s, ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'); }
?>
