<?php
/**
 * SNBD Portal Bridge endpoint — POST JSON, HMAC signed (see README.md / BRIDGE_CONTRACT.md).
 * Always answers JSON; nothing printed by WHMCS or a server module reaches the client.
 */

declare(strict_types=1);

use SnbdPortalBridge\Api;
use SnbdPortalBridge\CapsuleStore;
use SnbdPortalBridge\Endpoint;
use SnbdPortalBridge\Guard;
use SnbdPortalBridge\Handoff;
use SnbdPortalBridge\Modules;
use SnbdPortalBridge\Request;
use SnbdPortalBridge\Response;

ini_set('display_errors', '0');
ob_start();
ignore_user_abort(true);
if (function_exists('set_time_limit')) {
    @set_time_limit(120);
}

require_once __DIR__ . '/lib/autoload.php';

$request = Request::fromGlobals();
$endpoint = null;

Guard::register(static function (int $status, array $payload) use (&$endpoint, $request): void {
    if ($endpoint instanceof Endpoint) {
        $endpoint->logAborted($request, $status, $payload);
    }
    Response::emit($status, $payload);
});

try {
    require_once __DIR__ . '/../../../init.php';
} catch (\Throwable $e) {
    Response::emit(500, Response::errorPayload('internal', 'Internal error.'));
    exit;
}

// Server modules branch on these (e.g. openclaw_action, snbd_action, ajax=...); the bridge only
// speaks JSON bodies, so none of them may leak into module calls.
$_GET = [];
$_POST = [];
$_REQUEST = [];

$endpoint = new Endpoint(new CapsuleStore(), new Api(), new Modules(), new Handoff());
$endpoint->handle($request)->send();
