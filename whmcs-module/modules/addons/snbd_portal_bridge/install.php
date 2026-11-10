<?php
/**
 * CLI installer. Run from the WHMCS root as the site user:
 *
 *   BRIDGE_SECRET='<64 hex>' [BRIDGE_ALLOWED_IPS='1.2.3.4'] php8.3 modules/addons/snbd_portal_bridge/install.php
 *
 * Activates the addon (settings, admin-role access, tables) and stores the secret without
 * printing it. Idempotent: prints "installed" the first time, "updated" afterwards.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$secret = getenv('BRIDGE_SECRET');
if (!is_string($secret) || strlen($secret) < 32) {
    fwrite(STDERR, "Refusing to install: set BRIDGE_SECRET to at least 32 characters (e.g. openssl rand -hex 32).\n");
    exit(1);
}
$allowedIps = getenv('BRIDGE_ALLOWED_IPS');
$allowedIps = is_string($allowedIps) ? $allowedIps : null;

// WHMCS expects a web request; without these it throws "Invalid filename for redirect" in CLI.
$_SERVER['HTTP_HOST'] = 'portal.snbdhost.com';
$_SERVER['SERVER_NAME'] = 'portal.snbdhost.com';
$_SERVER['HTTPS'] = 'on';
$_SERVER['SERVER_PORT'] = 443;
$_SERVER['REQUEST_URI'] = '/index.php';
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REMOTE_ADDR'] = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

$root = realpath(__DIR__ . '/../../..');
if ($root === false || !is_file($root . '/init.php')) {
    fwrite(STDERR, "Could not find the WHMCS root (init.php) above " . __DIR__ . "\n");
    exit(1);
}
chdir($root);

ob_start();
require_once $root . '/init.php';
if (!defined('WHMCS')) {
    define('WHMCS', true);
}
require_once __DIR__ . '/snbd_portal_bridge.php';
ob_end_clean();

try {
    $result = (new \SnbdPortalBridge\Installer())->run($secret, $allowedIps);
} catch (\Throwable $e) {
    fwrite(STDERR, 'Install failed: ' . $e->getMessage() . "\n");
    exit(1);
}

echo $result['status'] . "\n";
echo 'version: ' . \SnbdPortalBridge\Ops::VERSION . "\n";
echo 'admin roles with access: ' . implode(',', $result['roles']) . "\n";
echo 'allowed_ips: ' . ($result['allowed_ips'] !== '' ? $result['allowed_ips'] : '(any)') . "\n";
echo 'secret: stored (' . $result['secret_length'] . " characters)\n";
