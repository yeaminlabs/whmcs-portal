<?php
/**
 * One-time links minted by service.action: backup downloads (kind "file") and VNC consoles
 * (kind "vnc"). Does not bootstrap WHMCS; the 128-bit single-use token is the credential.
 */

declare(strict_types=1);

use SnbdPortalBridge\Handoff;

ini_set('display_errors', '0');
require_once __DIR__ . '/lib/autoload.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    exit;
}

$token = is_string($_GET['t'] ?? null) ? $_GET['t'] : '';
$entry = (new Handoff())->take($token);

if ($entry === null) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "This link has expired or was already used. Please start again from the portal.\n";
    exit;
}

if ($entry['kind'] === 'file' && $entry['file'] !== null) {
    $name = preg_replace('/[^A-Za-z0-9._-]/', '_', (string) ($entry['meta']['name'] ?? 'download.bin'));
    $type = (string) ($entry['meta']['type'] ?? 'application/octet-stream');
    header('Content-Type: ' . (preg_match('#^[a-z]+/[a-z0-9.+-]+$#', $type) ? $type : 'application/octet-stream'));
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Content-Length: ' . (string) filesize($entry['file']));
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    readfile($entry['file']);
    @unlink($entry['file']);
    exit;
}

if ($entry['kind'] === 'vnc') {
    $wss = (string) ($entry['meta']['wss'] ?? '');
    if (!preg_match('#^wss://#i', $wss)) {
        http_response_code(404);
        exit;
    }
    $nonce = base64_encode(random_bytes(16));
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'none'; script-src 'nonce-{$nonce}' https://cdn.jsdelivr.net; "
        . "connect-src wss: https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'");
    $config = json_encode([
        'url' => $wss,
        'password' => (string) ($entry['meta']['password'] ?? ''),
    ], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    $title = htmlspecialchars((string) ($entry['meta']['title'] ?? 'Server'), ENT_QUOTES, 'UTF-8');
    ?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Console — <?= $title ?></title>
<style>
  html, body { margin: 0; height: 100%; background: #0b0d10; color: #e6e6e6; font: 14px/1.4 system-ui, sans-serif; }
  body { display: flex; flex-direction: column; }
  header { display: flex; gap: 12px; align-items: center; padding: 8px 12px; background: #15191f; }
  header strong { flex: 1; }
  button { background: #2a313b; color: inherit; border: 1px solid #3a434f; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
  #status { font-size: 12px; opacity: .8; }
  #screen { flex: 1; min-height: 0; }
</style>
</head>
<body>
<header>
  <strong><?= $title ?></strong>
  <span id="status">Connecting…</span>
  <button type="button" id="cad">Ctrl+Alt+Del</button>
</header>
<div id="screen"></div>
<script type="module" nonce="<?= $nonce ?>">
  import RFB from "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js";
  const cfg = <?= $config ?>;
  const status = document.getElementById("status");
  const rfb = new RFB(document.getElementById("screen"), cfg.url, { credentials: { password: cfg.password } });
  rfb.scaleViewport = true;
  rfb.addEventListener("connect", () => { status.textContent = "Connected"; });
  rfb.addEventListener("disconnect", (e) => { status.textContent = e.detail.clean ? "Disconnected" : "Connection lost"; });
  rfb.addEventListener("credentialsrequired", () => rfb.sendCredentials({ password: cfg.password }));
  document.getElementById("cad").addEventListener("click", () => rfb.sendCtrlAltDel());
</script>
</body>
</html>
    <?php
    exit;
}

http_response_code(404);
