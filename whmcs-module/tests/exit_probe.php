<?php
/**
 * Subprocess for run.php: a module that prints and calls exit inside ClientArea / an action.
 * argv[1] = "view" or "action". Prints exactly what the bridge would send.
 */

declare(strict_types=1);

use SnbdPortalBridge\Auth;
use SnbdPortalBridge\Endpoint;
use SnbdPortalBridge\Guard;
use SnbdPortalBridge\Handoff;
use SnbdPortalBridge\Request;
use SnbdPortalBridge\Response;

require __DIR__ . '/../modules/addons/snbd_portal_bridge/lib/autoload.php';
require __DIR__ . '/fakes.php';

$secret = str_repeat('ab', 32);
$store = new FakeStore();
$store->settings = ['version' => '1.0.0', 'shared_secret' => $secret];
$store->services[345] = FakeStore::service_row(['servertype' => 'pvewhmcs']);
$modules = new FakeModules();
$modules->handles[345] = new FakeHandle('pvewhmcs', [
    'ClientArea' => static function () {
        echo '<center><strong>Error: Unable to gather data from Hypervisor.</strong></center>';
        exit;
    },
    'vmStart' => static function () {
        echo 'partial html';
        exit;
    },
]);

$body = $argv[1] === 'view'
    ? ['op' => 'service.view', 'clientId' => 12, 'serviceId' => 345]
    : ['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'vmStart'];
$raw = (string) json_encode($body);
$ts = (string) time();
$nonce = bin2hex(random_bytes(16));
$request = new Request('POST', [
    'X-Bridge-Ts' => $ts, 'X-Bridge-Nonce' => $nonce, 'X-Bridge-Sig' => Auth::sign($secret, $ts, $nonce, $raw),
], $raw, '127.0.0.1');

ob_start();
$endpoint = new Endpoint($store, new FakeApi(), $modules, new Handoff(sys_get_temp_dir() . '/snbd_probe'));
Guard::register(static function (int $status, array $payload) use ($endpoint, $request): void {
    $endpoint->logAborted($request, $status, $payload);
    echo $status . ' ' . Response::encode($payload);
});
$endpoint->handle($request)->send();
