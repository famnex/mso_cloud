<?php
function redact($key, $val) {
    $sensitive = ['pass','pwd','token','smtp','bind_pw','bind_pass','cookie','authorization'];
    foreach ($sensitive as $s) {
        if (stripos($key, $s) !== false) return '***redacted***';
    }
    if (is_string($val)) {
        // primitive E-Mail/Token Redaction
        if (filter_var($val, FILTER_VALIDATE_EMAIL)) return preg_replace('/^(.).+(@.+)$/', '$1***$2', $val);
        if (strlen($val) > 64) return substr($val, 0, 6).'…'.substr($val, -6);
    }
    return $val;
}

function log_json($level, $msg, array $ctx = []) {
    static $cfg = null; if ($cfg === null) $cfg = require __DIR__ . '/config.php';
    $file = $cfg['LOG']['FILE'];
    $max = (int)$cfg['LOG']['MAX_LEN'];
    $cid = $_SERVER['HTTP_X_REQUEST_ID'] ?? ($_SERVER['REQUEST_ID'] ?? bin2hex(random_bytes(8)));
    if (!isset($ctx['cid'])) $ctx['cid'] = $cid;

    // Redact obvious secrets
    foreach ($ctx as $k => $v) $ctx[$k] = redact($k, $v);
    $row = json_encode([
        'ts' => date('c'),
        'lvl' => $level,
        'msg' => $msg,
        'path' => $_SERVER['REQUEST_URI'] ?? '',
        'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
        'ua' => $_SERVER['HTTP_USER_AGENT'] ?? '',
        'ctx' => $ctx
    ], JSON_UNESCAPED_SLASHES);

    if ($row === false) $row = '{"ts":"'.date('c').'","lvl":"error","msg":"log_encode_failed"}';
    if (strlen($row) > $max) $row = substr($row, 0, $max) . '…';
    error_log($row . PHP_EOL, 3, $file);

    return $cid; // Korrelations-ID an Aufrufer
}
?>
