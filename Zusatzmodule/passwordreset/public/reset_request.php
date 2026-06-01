<?php
require_once __DIR__ . '/../inc/bootstrap.php';
require_once __DIR__ . '/../inc/db.php';
require_once __DIR__ . '/../inc/csrf.php';
require_once __DIR__ . '/../inc/util.php';
require_once __DIR__ . '/../inc/logger.php';
require_once __DIR__ . '/../inc/ldap_client.php';

$config = require __DIR__ . '/../inc/config.php';
$debug = ($config['APP']['ENV'] === 'dev') || (!empty($_GET[$config['APP']['DEBUG_QUERY']]));

$msg = null;
$done = false;

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $email = trim($_POST['email'] ?? '');
        $tokenCsrf = $_POST['csrf'] ?? '';
        if (!csrf_check($tokenCsrf)) throw new RuntimeException('CSRF failed');

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $done = true; $msg = 'Wenn ein Konto existiert, haben wir dir eine E-Mail gesendet.';
        } else {
            $emailHash = email_hash_bin($email);
            $ipBin = client_ip_binary();

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM password_reset_tokens WHERE email_hash = :eh AND created_at >= (NOW() - INTERVAL 1 HOUR)");
            $stmt->execute([':eh' => $emailHash]);
            $cntEmail = (int)$stmt->fetchColumn();

            $stmt = $pdo->prepare("SELECT COUNT(*) FROM password_reset_tokens WHERE request_ip = :ip AND created_at >= (NOW() - INTERVAL 1 HOUR)");
            $stmt->bindValue(':ip', $ipBin, PDO::PARAM_LOB);
            $stmt->execute();
            $cntIp = (int)$stmt->fetchColumn();
            $pdo->commit();

            if ($cntEmail >= $config['APP']['RATE_LIMIT_PER_EMAIL_PER_HOUR'] || $cntIp >= $config['APP']['RATE_LIMIT_PER_IP_PER_HOUR']) {
                log_json('warn', 'rate_limited', ['email'=>$email, 'cntEmail'=>$cntEmail, 'cntIp'=>$cntIp]);
                $done = true; $msg = 'Wenn ein Konto existiert, haben wir dir eine E-Mail gesendet.';
            } else {
                $entry = null;
                try {
                    $ldap = new LdapClient($config['LDAP']);
                    $entry = $ldap->findByEmail($email);
                } catch (Throwable $e) {
                    log_json('error', 'ldap_lookup_failed', ['err'=>$e->getMessage()]);
                }

                if ($entry && !empty($entry['dn'])) {
                    [$token, $hash] = new_token_pair();
                    $stmt = $pdo->prepare("INSERT INTO password_reset_tokens (user_dn, token_hash, email_hash, expires_at, created_at, request_ip, user_agent) VALUES (:dn, :th, :eh, (NOW() + INTERVAL :ttl MINUTE), NOW(), :ip, :ua)");
                    $stmt->bindValue(':dn', $entry['dn']);
                    $stmt->bindValue(':th', $hash, PDO::PARAM_LOB);
                    $stmt->bindValue(':eh', $emailHash, PDO::PARAM_LOB);
                    $stmt->bindValue(':ttl', (int)$config['APP']['TOKEN_TTL_MIN'], PDO::PARAM_INT);
                    $stmt->bindValue(':ip', $ipBin, PDO::PARAM_LOB);
                    $stmt->bindValue(':ua', substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255));
                    $stmt->execute();

                    $link = rtrim($config['APP']['BASE_URL'], '/') . '/reset_confirm.php?token=' . urlencode($token);

                    // E-Mail hübsch (UTF-8, HTML+Text)
                    try {
                        require_once __DIR__ . '/../vendor/autoload.php';
                        $m = new PHPMailer\PHPMailer\PHPMailer(true);
                        $m->isSMTP();
                        $m->Host       = $config['SMTP']['HOST'];
                        $m->Port       = $config['SMTP']['PORT'];
                        $m->SMTPAuth   = true;
                        $m->SMTPSecure = $config['SMTP']['ENCRYPTION'];
                        $m->Username   = $config['SMTP']['USER'];
                        $m->Password   = $config['SMTP']['PASS'];
                        $m->CharSet    = 'UTF-8';
                        $m->Encoding   = 'base64';
                        $m->setFrom($config['SMTP']['FROM_ADDR'], $config['SMTP']['FROM_NAME']);
                        if (!empty($config['SMTP']['REPLY_TO'])) $m->addReplyTo($config['SMTP']['REPLY_TO']);
                        $m->addAddress($email);
                        $m->Subject = 'Passwort zurücksetzen';
                        $safeLink = htmlspecialchars($link, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                        $ttl = (int)$config['APP']['TOKEN_TTL_MIN'];
                        $m->isHTML(true);
                        $m->Body = <<<HTML
<!doctype html><html lang="de"><meta charset="utf-8">
<body style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height:1.6">
  <p>Hallo,</p>
  <p>du (oder jemand anderes) hat eine Zurücksetzung deines Passworts angefordert.</p>
  <p><a href="$safeLink" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none" target="_blank" rel="noopener">Passwort jetzt zurücksetzen</a></p>
  <p>Alternativ: <a href="$safeLink" target="_blank" rel="noopener">$safeLink</a></p>
  <p style="color:#666;font-size:12px">Der Link ist $ttl Minuten gültig.</p>
</body></html>
HTML;
                        $m->AltBody = "Passwort jetzt zurücksetzen:\n$link\n\nDer Link ist $ttl Minuten gültig.";
                        $m->Timeout = $config['APP']['REQUEST_TIMEOUT_SEC'];
                        $m->send();
                        log_json('info', 'mail_sent', ['to'=>$email]);
                    } catch (Throwable $e) {
                        log_json('error', 'mail_send_failed', ['to'=>$email, 'err'=>$e->getMessage()]);
                    }
                } else {
                    log_json('info', 'email_not_found_or_noentry', ['email'=>$email]);
                }
                $done = true; $msg = 'Wenn ein Konto existiert, haben wir dir eine E-Mail gesendet.';
            }
        }
    }
} catch (Throwable $e) {
    $id = log_json('error', 'request_failed', ['err'=>$e->getMessage()]);
    $done = true; $msg = "Unerwarteter Fehler. Fehler-ID: {$id}";
}
?>
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Passwort zurücksetzen</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0b0e14;
      --fg: #e6eaf2;
      --muted: #8a93a5;
      --card: #111523;
      --border: #1f2435;
      --accent: #2563eb;
      --ok: #22c55e;
      --err: #ef4444;
      --shadow: 0 10px 30px rgba(0,0,0,.35);
    }
    @media (prefers-color-scheme: light) {
      :root { --bg:#f7f9fc; --fg:#0b0e14; --muted:#4b5563; --card:#ffffff; --border:#e5e7eb; --shadow:0 10px 30px rgba(2,6,23,.08); }
    }
    html,body { height:100%; }
    body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; display:grid; place-items:center; padding:24px; }
    .wrap { width:100%; max-width:480px; }
    .card {
      background:var(--card); border:1px solid var(--border); border-radius:18px; padding:24px 22px; box-shadow:var(--shadow);
    }
    h1 { font-size:22px; margin:0 0 12px; letter-spacing:.2px; }
    p.lead { margin:0 0 16px; color:var(--muted); }
    label { display:block; font-weight:600; margin-top:10px; font-size:14px; }
    .input { margin-top:6px; width:90%; padding:12px 14px; border-radius:12px; border:1px solid var(--border); background:transparent; color:var(--fg); outline:none; }
    .input:focus { border-color: var(--accent); box-shadow:0 0 0 3px color-mix(in oklab, var(--accent) 30%, transparent); }
    .btn { margin-top:14px; width:100%; padding:12px 16px; border:0; border-radius:12px; background:var(--accent); color:white; font-weight:700; cursor:pointer; }
    .box { margin-top:12px; padding:12px 14px; border:1px solid var(--border); border-radius:12px; background:color-mix(in oklab, var(--card) 90%, var(--accent) 10%); }
    .muted { color:var(--muted); font-size:12px; }
    .center { text-align:center; }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="card">
      <h1>Passwort zurücksetzen</h1>
      <p class="lead">Gib deine E-Mail ein. Wenn ein Konto existiert, senden wir dir einen Link.</p>

      <?php if ($done): ?>
        <div class="box"><?=h($msg)?></div>
        <?php if ($debug): ?>
          <p class="muted">Debug ist aktiv. Details findest du in <code>logs/app.log</code>.</p>
        <?php endif; ?>
      <?php else: ?>
        <form method="post" autocomplete="off" novalidate>
          <label for="email">E-Mail-Adresse</label>
          <input class="input" id="email" type="email" name="email" required autocomplete="email" placeholder="name@domain.tld">
          <input type="hidden" name="csrf" value="<?=h(csrf_token())?>">
          <button class="btn" type="submit">Link anfordern</button>
          <p class="muted center">Dauer: i. d. R. wenige Sekunden. Prüfe auch den Spam-Ordner.</p>
        </form>
      <?php endif; ?>
    </div>
  </main>
</body>
</html>
