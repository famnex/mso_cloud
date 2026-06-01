<?php
require_once __DIR__ . '/../inc/bootstrap.php';
require_once __DIR__ . '/../inc/db.php';
require_once __DIR__ . '/../inc/csrf.php';
require_once __DIR__ . '/../inc/util.php';
require_once __DIR__ . '/../inc/logger.php';
require_once __DIR__ . '/../inc/ldap_client.php';

$config = require __DIR__ . '/../inc/config.php';
$debug = ($config['APP']['ENV'] === 'dev') || (!empty($_GET[$config['APP']['DEBUG_QUERY']]));

$stage = 'verify'; $error = null;

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['token'])) {
        $token = $_GET['token'];
        $hash = hash('sha256', $token, true);
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("SELECT id, user_dn, expires_at, used_at FROM password_reset_tokens WHERE token_hash = :h FOR UPDATE");
        $stmt->bindValue(':h', $hash, PDO::PARAM_LOB);
        $stmt->execute();
        $row = $stmt->fetch();

        if (!$row || !empty($row['used_at']) || strtotime($row['expires_at']) < time()) {
            $pdo->commit();
            $error = 'Der Link ist ungültig oder abgelaufen.';
            $stage = 'verify_error';
            log_json('warn', 'token_invalid_or_expired');
        } else {
            $stmt = $pdo->prepare("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = :id");
            $stmt->execute([':id' => $row['id']]);
            $pdo->commit();

            $_SESSION['reset_user_dn'] = $row['user_dn'];
            $_SESSION['reset_ok'] = true;
            $stage = 'form';
        }
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['new_password'])) {
        if (!csrf_check($_POST['csrf'] ?? '')) throw new RuntimeException('CSRF failed');
        if (empty($_SESSION['reset_ok']) || empty($_SESSION['reset_user_dn'])) {
            $error = 'Sitzung abgelaufen. Bitte fordere einen neuen Link an.'; $stage = 'verify_error';
        } else {
            $pw = (string)($_POST['new_password'] ?? '');
            $pw2 = (string)($_POST['new_password2'] ?? '');
            if ($pw !== $pw2) { $error = 'Die Passwörter stimmen nicht überein.'; $stage = 'form'; }
            elseif (!password_policy_ok($pw, $config['APP'])) { $error = 'Passwort erfüllt die Richtlinie nicht.'; $stage = 'form'; }
            else {
                try {
                    $ldap = new LdapClient($config['LDAP']);
                    $ok = $ldap->setPassword($_SESSION['reset_user_dn'], $pw);
                    if ($ok) {
                        $stage = 'done'; unset($_SESSION['reset_ok'], $_SESSION['reset_user_dn']);
                        log_json('info', 'password_set_success');
                    } else {
                        $error = 'Passwort konnte nicht gesetzt werden (LDAP).'; $stage = 'form';
                        log_json('error', 'password_set_failed');
                    }
                } catch (Throwable $e) {
    log_json('error','ldap_set_exception',[
        'err' => $e->getMessage(),
        'file'=> $e->getFile(),
        'line'=> $e->getLine()
    ]);
    $error = 'Technischer Fehler beim Setzen des Passworts.';
    $stage = 'form';
}


            }
        }
    }
} catch (Throwable $e) {
    $id = log_json('error', 'confirm_request_failed', ['err'=>$e->getMessage()]);
    $stage = 'verify_error'; $error = "Unerwarteter Fehler. Fehler-ID: {$id}";
}
?>
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Neues Passwort setzen</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0b0e14; --fg: #e6eaf2; --muted:#8a93a5; --card:#111523; --border:#1f2435; --accent:#2563eb;
      --ok:#22c55e; --err:#ef4444; --warn:#f59e0b; --shadow:0 10px 30px rgba(0,0,0,.35);
    }
    @media (prefers-color-scheme: light) {
      :root { --bg:#f7f9fc; --fg:#0b0e14; --muted:#4b5563; --card:#ffffff; --border:#e5e7eb; --shadow:0 10px 30px rgba(2,6,23,.08); }
    }
    html,body{height:100%}
    body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;display:grid;place-items:center;padding:24px}
    .wrap{width:100%;max-width:560px}
    .card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:24px 22px;box-shadow:var(--shadow)}
    h1{font-size:22px;margin:0 0 12px}
    p.lead{margin:0 0 16px;color:var(--muted)}
    label{display:block;font-weight:600;margin-top:10px;font-size:14px}
    .row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}
    .input{margin-top:6px;width:90%;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--fg);outline:none}
    .input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in oklab, var(--accent) 30%, transparent)}
    .toggle{border:1px solid var(--border);background:transparent;border-radius:10px;padding:8px 10px;cursor:pointer}
    .btn{margin-top:14px;width:100%;padding:12px 16px;border:0;border-radius:12px;background:var(--accent);color:#fff;font-weight:700;cursor:pointer}
    .btn[disabled]{opacity:.5;cursor:not-allowed}
    .box{margin-top:12px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:color-mix(in oklab, var(--card) 92%, var(--accent) 8%)}
    .err{color:var(--err)}
    .muted{color:var(--muted);font-size:12px}
    ul.req{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}
    ul.req li{display:flex;align-items:center;gap:8px;font-size:14px}
    .dot{width:10px;height:10px;border-radius:50%;background:var(--err);display:inline-block;flex:0 0 10px}
    .ok .dot{background:var(--ok)}
    .meter{height:8px;border-radius:999px;background:color-mix(in oklab, var(--card) 70%, black 30%);overflow:hidden;margin-top:10px;border:1px solid var(--border)}
    .meter > b{display:block;height:100%;width:0;background:var(--ok);transition:width .25s ease}
    .match{margin-top:8px;font-weight:600}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="card">
      <h1>Neues Passwort setzen</h1>
      <p class="lead">Bitte wähle ein sicheres Passwort. Die Anforderungen werden live geprüft.</p>

      <?php if ($stage === 'verify_error'): ?>
        <div class="box err"><?=h($error ?? 'Der Link ist ungültig oder abgelaufen.')?></div>
      <?php elseif ($stage === 'form'): ?>
        <?php if (!empty($error)): ?><div class="box err"><?=h($error)?></div><?php endif; ?>

        <form method="post" autocomplete="off" novalidate>
          <div class="row">
            <label for="pw">Neues Passwort</label>
            <button class="toggle" type="button" id="toggle1" aria-label="Passwort anzeigen">👁</button>
          </div>
          <input class="input" id="pw" type="password" name="new_password"
                 required minlength="<?=h((string)$config['APP']['PASSWORD_MIN_LENGTH'])?>"
                 autocomplete="new-password" placeholder="••••••••">

          <div class="row">
            <label for="pw2">Wiederholen</label>
            <button class="toggle" type="button" id="toggle2" aria-label="Passwort anzeigen">👁</button>
          </div>
          <input class="input" id="pw2" type="password" name="new_password2"
                 required autocomplete="new-password" placeholder="••••••••">

          <div class="meter" aria-hidden="true"><b id="strengthBar"></b></div>

          <ul class="req" aria-live="polite" aria-atomic="true">
  <?php
  $min = isset($config['APP']['PASSWORD_MIN_LENGTH']) ? (int)$config['APP']['PASSWORD_MIN_LENGTH'] : 8;
  // Anzeige-Texte ohne Variable-Interpolation
  $reqs = [
    'Mindestens ' . $min . ' Zeichen'         => 'len',
    'Mindestens 1 Großbuchstabe (A–Z)'        => 'upper',
    'Mindestens 1 Kleinbuchstabe (a–z)'       => 'lower',
    'Mindestens 1 Zahl (0–9)'                 => 'digit',
    'Mindestens 1 Sonderzeichen (!@#\$…)'     => 'special',
  ];
  foreach ($reqs as $label => $key):
?>

              <li data-k="<?=h($key)?>"><span class="dot" aria-hidden="true"></span><span><?=h($label)?></span></li>
            <?php endforeach; ?>
          </ul>

          <div id="match" class="match err" role="status" aria-live="polite"></div>

          <input type="hidden" name="csrf" value="<?=h(csrf_token())?>">
          <button id="submitBtn" class="btn" type="submit" disabled>Passwort setzen</button>
          <p class="muted">Tipp: Ein langes, einzigartiges Passwort ist am sichersten.</p>
        </form>

        <?php if ($debug): ?>
          <p class="muted">Debug aktiv – Details stehen in <code>logs/app.log</code>.</p>
        <?php endif; ?>

      <?php elseif ($stage === 'done'): ?>
        <div class="box">Dein Passwort wurde aktualisiert.</div>
      <?php else: ?>
        <div class="box">Link wird überprüft …</div>
      <?php endif; ?>
    </div>
  </main>

  <script>
    (function(){
      const minLen = <?= (int)$config['APP']['PASSWORD_MIN_LENGTH'] ?>;
      const regex = <?= json_encode($config['APP']['PASSWORD_REGEX']) ?>; // Serverseitiger Master
      const re = new RegExp(regex.slice(1, regex.lastIndexOf('/')), regex.slice(regex.lastIndexOf('/')+1));

      const $pw = document.getElementById('pw');
      const $pw2 = document.getElementById('pw2');
      const $match = document.getElementById('match');
      const $btn = document.getElementById('submitBtn');
      const $bar = document.getElementById('strengthBar');
      const reqItems = Array.from(document.querySelectorAll('ul.req li'));

      function tests(v){
        return {
          len: v.length >= minLen,
          upper: /[A-Z]/.test(v),
          lower: /[a-z]/.test(v),
          digit: /\d/.test(v),
          special: /[^\w\s]/.test(v),
          policy: re.test(v) // Master-Regel aus Server
        };
      }
      function score(t){
        // 0..5 je erfüllter Kernregel (keine Doppelwertung)
        let s = 0;
        if (t.len) s++;
        if (t.upper) s++;
        if (t.lower) s++;
        if (t.digit) s++;
        if (t.special) s++;
        return s;
      }
      function render(){
        const v1 = $pw.value, v2 = $pw2.value;
        const t = tests(v1);
        const s = score(t);
        // Checkliste
        reqItems.forEach(li=>{
          const key = li.getAttribute('data-k');
          li.classList.toggle('ok', !!t[key]);
        });
        // Stärke-Balken
        $bar.style.width = (s/5*100) + '%';

        // Match-Status
        if (v2.length === 0) {
          $match.textContent = '';
          $match.classList.remove('ok'); $match.classList.add('err');
        } else if (v1 === v2) {
          $match.textContent = 'Passwörter stimmen überein.';
          $match.classList.remove('err'); $match.classList.add('ok');
        } else {
          $match.textContent = 'Passwörter stimmen nicht überein.';
          $match.classList.remove('ok'); $match.classList.add('err');
        }

        // Button-Enable: alle Kernregeln + Policy + Match
        const canSubmit = t.policy && v1 === v2;
        $btn.disabled = !canSubmit;
      }
      $pw.addEventListener('input', render);
      $pw2.addEventListener('input', render);
      render();

      // Sichtbarkeit toggeln
      function toggle(input, btn){
        const t = input.getAttribute('type') === 'password' ? 'text' : 'password';
        input.setAttribute('type', t);
        btn.setAttribute('aria-label', t === 'password' ? 'Passwort anzeigen' : 'Passwort verbergen');
      }
      document.getElementById('toggle1').addEventListener('click', ()=>toggle($pw, document.getElementById('toggle1')));
      document.getElementById('toggle2').addEventListener('click', ()=>toggle($pw2, document.getElementById('toggle2')));
    })();
  </script>
</body>
</html>
