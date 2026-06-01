<?php
$config = require __DIR__ . '/config.php';
$pdo = new PDO($config['DB']['DSN'], $config['DB']['USER'], $config['DB']['PASS'], $config['DB']['OPTIONS']);
$pdo->exec("SET time_zone = '+00:00'");
?>
