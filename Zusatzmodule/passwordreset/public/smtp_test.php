<?php
require_once __DIR__ . '/../inc/bootstrap.php';
$config = require __DIR__ . '/../inc/config.php';
$debug = ($config['APP']['ENV'] === 'dev') || (!empty($_GET[$config['APP']['DEBUG_QUERY']]));
if (!$debug) { http_response_code(403); echo 'Forbidden'; exit; }
require_once __DIR__ . '/../vendor/autoload.php';

$to = $_GET['to'] ?? '';
header('Content-Type: text/plain; charset=utf-8');

try {
    if (!$to) throw new RuntimeException('to param missing');
    $m = new PHPMailer\PHPMailer\PHPMailer(true);
    $m->isSMTP(); $m->Host=$config['SMTP']['HOST']; $m->Port=$config['SMTP']['PORT'];
    $m->SMTPAuth=true; $m->SMTPSecure=$config['SMTP']['ENCRYPTION'];
    $m->Username=$config['SMTP']['USER']; $m->Password=$config['SMTP']['PASS'];
    $m->setFrom($config['SMTP']['FROM_ADDR'], $config['SMTP']['FROM_NAME']);
    $m->addAddress($to);
    $m->Subject='SMTP Test'; $m->Body='It works.';
    $m->Timeout=$config['APP']['REQUEST_TIMEOUT_SEC'];
    $m->send();
    echo "OK";
} catch (Throwable $e) { http_response_code(500); echo $e; }
?>
