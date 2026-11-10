<?php
/**
 * Test harness for snbd_portal_bridge. Runs on plain PHP 8.3+ without WHMCS:
 *   php tests/run.php
 */

declare(strict_types=1);

use SnbdPortalBridge\Auth;
use SnbdPortalBridge\Endpoint;
use SnbdPortalBridge\Guard;
use SnbdPortalBridge\Handoff;
use SnbdPortalBridge\Ops;
use SnbdPortalBridge\Panels;
use SnbdPortalBridge\Request;
use SnbdPortalBridge\Response;
use SnbdPortalBridge\Sanitize;
use SnbdPortalBridge\Settings;

error_reporting(E_ALL);
ini_set('display_errors', '1');

require __DIR__ . '/../modules/addons/snbd_portal_bridge/lib/autoload.php';
require __DIR__ . '/fakes.php';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000;

// ---------------------------------------------------------------- mini framework

$tests = [];
$failures = [];
$assertions = 0;

function test(string $name, callable $fn): void
{
    $GLOBALS['tests'][$name] = $fn;
}

function check(bool $cond, string $what): void
{
    $GLOBALS['assertions']++;
    if (!$cond) {
        throw new RuntimeException('Assertion failed: ' . $what);
    }
}

function same(mixed $expected, mixed $actual, string $what): void
{
    check($expected === $actual, $what . ' — expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
}

// ---------------------------------------------------------------- fixtures

final class World
{
    public FakeStore $store;
    public FakeApi $api;
    public FakeModules $modules;
    public Handoff $handoff;
    public Endpoint $endpoint;
    public string $handoffDir;

    public function __construct()
    {
        Guard::reset();
        $this->store = new FakeStore();
        $this->store->settings = ['version' => '1.0.0', 'shared_secret' => encrypt(SECRET), 'allowed_ips' => ''];
        $this->api = new FakeApi();
        $this->modules = new FakeModules();
        $this->handoffDir = sys_get_temp_dir() . '/snbd_bridge_test_' . bin2hex(random_bytes(4));
        $this->handoff = new Handoff($this->handoffDir);
        $this->endpoint = new Endpoint($this->store, $this->api, $this->modules, $this->handoff, static fn () => NOW);
    }

    /** @return array{0:int,1:array} [status, decoded payload] */
    public function send(array|string $body, array $opts = []): array
    {
        $raw = is_string($body) ? $body : json_encode($body);
        $ts = (string) ($opts['ts'] ?? NOW);
        $nonce = $opts['nonce'] ?? bin2hex(random_bytes(16));
        $sig = $opts['sig'] ?? Auth::sign($opts['secret'] ?? SECRET, $ts, $nonce, $raw);
        $headers = ['X-Bridge-Ts' => $ts, 'X-Bridge-Nonce' => $nonce, 'X-Bridge-Sig' => $sig, 'Content-Type' => 'application/json'];
        $headers += $opts['headers'] ?? [];
        $tooLarge = strlen($raw) > Auth::MAX_BODY;
        $req = new Request($opts['method'] ?? 'POST', $headers, $tooLarge ? '' : $raw, $opts['ip'] ?? '203.0.113.10', $tooLarge);
        $res = $this->endpoint->handle($req);
        $json = Response::encode($res->payload);
        return [$res->status, json_decode($json, true), $json];
    }

    public function addService(array $row, ?FakeHandle $handle = null): void
    {
        $row = FakeStore::service_row($row);
        $this->store->services[$row['id']] = $row;
        if ($handle !== null) {
            $this->modules->handles[$row['id']] = $handle;
        }
    }
}

function errorCode(array $payload): ?string
{
    return $payload['error']['code'] ?? null;
}

// ---------------------------------------------------------------- auth

test('valid signature is accepted (ping)', function () {
    $w = new World();
    [$status, $p] = $w->send(['op' => 'ping']);
    same(200, $status, 'status');
    same(true, $p['ok'], 'ok');
    same('1.0.0', $p['data']['version'], 'version');
    same(['cpanel', 'snbd_n8n'], $p['data']['modules'], 'modules');
});

test('plain-text stored secret is accepted too', function () {
    $w = new World();
    $w->store->settings['shared_secret'] = SECRET;
    [$status] = $w->send(['op' => 'ping']);
    same(200, $status, 'status');
});

test('wrong signature is rejected with 401 auth', function () {
    $w = new World();
    [$status, $p] = $w->send(['op' => 'ping'], ['secret' => str_repeat('x', 64)]);
    same(401, $status, 'status');
    same('auth', errorCode($p), 'code');
});

test('tampered body is rejected', function () {
    $w = new World();
    $nonce = bin2hex(random_bytes(16));
    $sig = Auth::sign(SECRET, (string) NOW, $nonce, '{"op":"ping"}');
    [$status, $p] = $w->send('{"op":"ping","x":1}', ['nonce' => $nonce, 'sig' => $sig]);
    same(401, $status, 'status');
    same('auth', errorCode($p), 'code');
});

test('stale and future timestamps are rejected', function () {
    $w = new World();
    [$status, $p] = $w->send(['op' => 'ping'], ['ts' => NOW - 121]);
    same(401, $status, 'stale status');
    same('auth', errorCode($p), 'stale code');
    [$status] = $w->send(['op' => 'ping'], ['ts' => NOW + 121]);
    same(401, $status, 'future status');
    [$status] = $w->send(['op' => 'ping'], ['ts' => NOW - 119]);
    same(200, $status, 'within window');
});

test('replayed nonce is rejected', function () {
    $w = new World();
    $nonce = bin2hex(random_bytes(16));
    [$first] = $w->send(['op' => 'ping'], ['nonce' => $nonce]);
    [$second, $p] = $w->send(['op' => 'ping'], ['nonce' => $nonce]);
    same(200, $first, 'first');
    same(401, $second, 'replay');
    same('auth', errorCode($p), 'code');
});

test('nonces older than 10 minutes are purged', function () {
    $w = new World();
    $w->store->nonces = ['a' => NOW - 601, 'b' => NOW - 10];
    $w->send(['op' => 'ping']);
    check(!isset($w->store->nonces['a']), 'old nonce purged');
    check(isset($w->store->nonces['b']), 'recent nonce kept');
});

test('bad signature does not consume the nonce', function () {
    $w = new World();
    $nonce = bin2hex(random_bytes(16));
    $w->send(['op' => 'ping'], ['nonce' => $nonce, 'secret' => str_repeat('y', 64)]);
    [$status] = $w->send(['op' => 'ping'], ['nonce' => $nonce]);
    same(200, $status, 'nonce still usable');
});

test('oversize body is rejected', function () {
    $w = new World();
    $big = json_encode(['op' => 'ping', 'pad' => str_repeat('a', Auth::MAX_BODY)]);
    [$status, $p] = $w->send($big);
    same(413, $status, 'status');
    same('bad_request', errorCode($p), 'code');
});

test('missing headers, non-POST, malformed JSON and unknown op', function () {
    $w = new World();
    $req = new Request('POST', [], '{"op":"ping"}', '203.0.113.10');
    $res = $w->endpoint->handle($req);
    same(401, $res->status, 'missing headers');

    [$status] = $w->send(['op' => 'ping'], ['method' => 'GET']);
    same(405, $status, 'GET');

    [$status, $p] = $w->send('{"op":');
    same(400, $status, 'malformed JSON');
    same('bad_request', errorCode($p), 'malformed code');

    [$status, $p] = $w->send(['op' => 'nope']);
    same(400, $status, 'unknown op');
    same('bad_request', errorCode($p), 'unknown op code');
});

test('unconfigured or inactive addon rejects everything', function () {
    $w = new World();
    $w->store->settings['shared_secret'] = '';
    [$status, $p] = $w->send(['op' => 'ping']);
    same(503, $status, 'no secret');
    same('internal', errorCode($p), 'code');

    $w = new World();
    unset($w->store->settings['version']);
    [$status] = $w->send(['op' => 'ping']);
    same(503, $status, 'not activated');
});

test('allowed_ips: CF-Connecting-IP preferred, CIDR supported', function () {
    $w = new World();
    $w->store->settings['allowed_ips'] = '198.51.100.0/24, 2001:db8::1';
    [$status, $p] = $w->send(['op' => 'ping'], ['ip' => '203.0.113.10']);
    same(403, $status, 'denied by REMOTE_ADDR');
    same('auth', errorCode($p), 'code');
    [$status] = $w->send(['op' => 'ping'], ['ip' => '10.0.0.1', 'headers' => ['CF-Connecting-IP' => '198.51.100.77']]);
    same(200, $status, 'allowed via CF header');
    [$status] = $w->send(['op' => 'ping'], ['ip' => '2001:db8::1']);
    same(200, $status, 'IPv6 exact');
    check(!Auth::ipAllowed('198.51.101.1', '198.51.100.0/24'), 'outside CIDR');
    check(Auth::ipAllowed('10.1.2.3', '10.0.0.0/8'), 'inside /8');
    check(!Auth::ipAllowed('not-an-ip', '10.0.0.0/8'), 'garbage IP');
});

test('every request is logged without the secret or passwords', function () {
    $w = new World();
    $w->addService(['id' => 345, 'servertype' => 'snbd_n8n'], new FakeHandle('snbd_n8n', []));
    $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'change_password',
        'confirm' => true, 'args' => ['password' => 'hunter2hunter2']]);
    $entry = end($GLOBALS['__module_log']);
    same('snbd_portal_bridge', $entry['module'], 'log module');
    same('service.action', $entry['action'], 'log op');
    check(!str_contains($entry['request'], 'hunter2'), 'password not logged');
    check(!str_contains(json_encode($GLOBALS['__module_log']), SECRET), 'secret never logged');
    same('service.action', end($w->store->calls)['op'], 'call table row');
});

// ---------------------------------------------------------------- batch

test('batch forces clientid/userid and strips identity params', function () {
    $w = new World();
    [$status, $p] = $w->send(['op' => 'batch', 'clientId' => 12, 'calls' => [
        ['key' => 'client', 'action' => 'GetClientsDetails', 'params' => ['clientid' => 99, 'email' => 'other@x.com', 'stats' => true]],
        ['key' => 'tickets', 'action' => 'getsupporttickets', 'params' => ['userid' => 99, 'limitnum' => 5]],
        ['key' => 'kb', 'action' => 'GetKBArticles'],
    ]]);
    same(200, $status, 'status');
    [$a1, $p1] = $w->api->log[0];
    same('GetClientsDetails', $a1, 'action 1');
    same(12, $p1['clientid'], 'clientid forced');
    same(12, $p1['userid'], 'userid forced');
    check(!isset($p1['email']), 'email stripped');
    same('GetSupportTickets', $w->api->log[1][0], 'canonical action name');
    same(12, $w->api->log[1][1]['userid'], 'userid forced on tickets');
    check(!isset($w->api->log[2][1]['clientid']), 'global call not scoped');
    check(isset($p['data']['client'], $p['data']['tickets'], $p['data']['kb']), 'results keyed');
});

test('batch rejects non-whitelisted actions without running anything', function () {
    $w = new World();
    [$status, $p] = $w->send(['op' => 'batch', 'clientId' => 12, 'calls' => [
        ['key' => 'ok', 'action' => 'GetInvoices'],
        ['key' => 'evil', 'action' => 'UpdateClient', 'params' => ['email' => 'x@y.z']],
    ]]);
    same(200, $status, 'status');
    same('not_allowed', errorCode($p), 'code');
    same([], $w->api->log, 'nothing executed');

    [, $p] = $w->send(['op' => 'batch', 'clientId' => 12, 'calls' => [['key' => 'a', 'action' => 'DecryptPassword']]]);
    same('not_allowed', errorCode($p), 'DecryptPassword');
});

test('batch limits and object ownership', function () {
    $w = new World();
    $calls = array_map(static fn ($i) => ['key' => "k$i", 'action' => 'GetCurrencies'], range(1, 13));
    [, $p] = $w->send(['op' => 'batch', 'clientId' => 12, 'calls' => $calls]);
    same('bad_request', errorCode($p), 'more than 12');

    $w->store->invoices = [500 => 12, 501 => 99];
    $w->store->tickets = [70 => 99];
    [, $p] = $w->send(['op' => 'batch', 'clientId' => 12, 'calls' => [
        ['key' => 'mine', 'action' => 'GetInvoice', 'params' => ['invoiceid' => 500]],
        ['key' => 'theirs', 'action' => 'GetInvoice', 'params' => ['invoiceid' => 501]],
        ['key' => 'ticket', 'action' => 'GetSupportTicket', 'params' => ['ticketid' => 70]],
        ['key' => 'notes', 'action' => 'GetTicketNotes', 'params' => ['ticketid' => 404]],
    ]]);
    same('success', $p['data']['mine']['result'], 'own invoice');
    same(['result' => 'error', 'message' => 'not_found'], $p['data']['theirs'], 'other invoice');
    same('error', $p['data']['ticket']['result'], 'other ticket');
    same('error', $p['data']['notes']['result'], 'missing ticket');
    same(1, count($w->api->log), 'only the owned lookup ran');
});

test('batch failure under one key does not stop others', function () {
    $w = new World();
    $w->api->responses['GetQuotes'] = static fn () => throw new RuntimeException('boom');
    [, $p] = $w->send(['op' => 'batch', 'clientId' => 12, 'calls' => [
        ['key' => 'q', 'action' => 'GetQuotes'],
        ['key' => 'c', 'action' => 'GetCredits'],
    ]]);
    same('error', $p['data']['q']['result'], 'failed call');
    same('success', $p['data']['c']['result'], 'other call');
});

test('client ops require a valid, existing clientId', function () {
    $w = new World();
    [, $p] = $w->send(['op' => 'dashboard']);
    same('bad_request', errorCode($p), 'missing');
    [, $p] = $w->send(['op' => 'dashboard', 'clientId' => 4242]);
    same('not_found', errorCode($p), 'unknown client');
});

// ---------------------------------------------------------------- dashboard

test('dashboard shapes client, stats and latest lists', function () {
    $w = new World();
    $w->api->responses = [
        'GetClientsDetails' => ['result' => 'success', 'client' => ['id' => 12, 'firstname' => 'A', 'lastname' => 'B',
            'fullname' => 'A B', 'email' => 'a@b.c', 'currency' => 1, 'currency_code' => 'BDT', 'credit' => '0', 'language' => '']],
        'GetClientsProducts' => ['result' => 'success', 'products' => ['product' => array_map(static fn ($i) => ['id' => $i], range(1, 7))]],
        'GetClientsDomains' => ['result' => 'success', 'domains' => ['domain' => [['id' => 3]]]],
        'GetInvoices' => ['result' => 'success', 'invoices' => ['invoice' => [['id' => 9], ['id' => 11]]]],
        'GetSupportTickets' => ['result' => 'success', 'tickets' => ['ticket' => [
            ['id' => 1, 'status' => 'Closed', 'lastreply' => '2026-11-01'],
            ['id' => 2, 'status' => 'Open', 'lastreply' => '2026-11-05'],
        ]]],
    ];
    [, $p] = $w->send(['op' => 'dashboard', 'clientId' => 12]);
    $d = $p['data'];
    same('0.00', $d['client']['credit'], 'credit formatted');
    same('1497.00', $d['stats']['dueinvoicesbalance'], 'stats');
    same([7, 6, 5, 4, 3], array_column($d['services'], 'id'), 'latest 5 services');
    same([11, 9], array_column($d['invoices'], 'id'), 'invoices desc');
    same('BDT', $d['invoices'][0]['currencycode'], 'currencycode filled');
    same([2], array_column($d['tickets'], 'id'), 'closed tickets excluded');
});

// ---------------------------------------------------------------- service.view

test('service.view denies services of other clients', function () {
    $w = new World();
    $w->addService(['id' => 345, 'userid' => 99], new FakeHandle('cpanel', []));
    [$status, $p] = $w->send(['op' => 'service.view', 'clientId' => 12, 'serviceId' => 345]);
    same(200, $status, 'status');
    same('not_found', errorCode($p), 'not your service');
    [, $p] = $w->send(['op' => 'service.view', 'clientId' => 12, 'serviceId' => 999]);
    same('not_found', errorCode($p), 'missing service');
});

test('service.view strips secrets from raw.vars at any depth', function () {
    $w = new World();
    $vars = [
        'domain' => 'x.n8n.snbdhost.com',
        'status' => 'running',
        'dashboard_pass' => 'p1',
        'gateway_token' => 't1',
        'api_key' => 'k1',
        'csrf_token' => 'c1',
        'service' => (object) ['password' => 'p2'],
        'nested' => ['ok' => 1, 'db' => ['password' => 'p3', 'host' => 'db1', 'jwtPublic' => 'j'], 'Private_Note' => 'x'],
        'install_root' => 'rootpw',
        'params' => ['serverpassword' => 'sp'],
        'image' => 'data:image/png;base64,AAAA',
        'closure' => static fn () => 1,
        'resource_cpu' => '1',
        'resource_ram' => '1024',
        'resource_storage' => '10',
    ];
    $w->addService(['id' => 345, 'servertype' => 'openclaw_n8n'], new FakeHandle('openclaw_n8n', [
        'ClientArea' => ['tabOverviewReplacementTemplate' => 'templates/client/dashboard', 'templateVariables' => $vars],
        'ClientStart' => 'success',
        'AdminStart' => 'success',
    ]));
    [, $p] = $w->send(['op' => 'service.view', 'clientId' => 12, 'serviceId' => 345]);
    $raw = $p['data']['raw'];
    same('templates/client/dashboard', $raw['templatefile'], 'templatefile');
    same(['domain', 'status', 'nested', 'resource_cpu', 'resource_ram', 'resource_storage'], array_keys($raw['vars']), 'kept keys');
    same(['ok' => 1, 'db' => ['host' => 'db1']], $raw['vars']['nested'], 'nested scrub');
    $json = json_encode($p);
    foreach (['p1', 't1', 'k1', 'p2', 'p3', 'rootpw', '"sp"'] as $secret) {
        check(!str_contains($json, $secret), "secret $secret absent");
    }
    same('n8n', $p['data']['kind'], 'kind');
    same([['fn' => 'ClientStart', 'label' => 'Start', 'confirm' => false, 'danger' => false]], $p['data']['actions'], 'only defined whitelisted actions');
    $panel = $p['data']['panel'];
    same('running', $panel['state'], 'panel state');
    same('1 GB', $panel['resources']['ram'], 'ram formatted');
    same(['url', 'state', 'version', 'resources', 'database', 'mode', 'workers'], array_keys($panel), 'n8n shape complete');
});

test('service.view hosting panel, sso list and service fields', function () {
    $w = new World();
    $w->addService(['id' => 345, 'servertype' => 'cpanel', 'assignedips' => "5.6.7.8\n2001:db8::5"],
        new FakeHandle('cpanel', ['ServiceSingleSignOn' => ['success' => true, 'redirectTo' => 'https://x']]));
    [, $p] = $w->send(['op' => 'service.view', 'clientId' => 12, 'serviceId' => 345]);
    $d = $p['data'];
    same('hosting', $d['kind'], 'kind');
    same(['cpanelUrl' => 'https://usa1.snbdhost.com:2083', 'webmailUrl' => 'https://usa1.snbdhost.com:2096'], $d['panel'], 'panel');
    same([], $d['actions'], 'cpanel has no actions');
    same(10, count($d['sso']), 'sso apps');
    same(['5.6.7.8', '2001:db8::5'], $d['service']['assignedips'], 'assigned ips');
    same('97.00', $d['service']['recurringamount'], 'amount');
    same(['name' => 'usa1', 'hostname' => 'usa1.snbdhost.com', 'ip' => '1.2.3.4'], $d['service']['server'], 'server');
});

test('service.view survives module errors (panel {} + raw.error) and discards stray output', function () {
    $w = new World();
    $w->addService(['id' => 345, 'servertype' => 'pvewhmcs'], new FakeHandle('pvewhmcs', [
        'ClientArea' => static function () {
            echo 'VM/CT not found in Cluster Resources.';
            throw new RuntimeException('PVEWHMCS Error: Unable to determine node');
        },
    ]));
    ob_start();
    [$status, $p, $json] = $w->send(['op' => 'service.view', 'clientId' => 12, 'serviceId' => 345]);
    $leaked = ob_get_clean();
    same('', $leaked, 'no stray output');
    same(200, $status, 'status');
    same(true, $p['ok'], 'op still ok');
    check(str_contains($json, '"panel":{}'), 'panel encodes as {}');
    check(str_contains($json, '"vars":{}'), 'raw.vars encodes as {}');
    check(str_contains($p['data']['raw']['error'], 'Unable to determine node'), 'raw.error');
});

test('generic module gets panel {}', function () {
    $w = new World();
    $w->addService(['id' => 345, 'servertype' => 'somethingelse'], new FakeHandle('somethingelse', ['ClientArea' => ['templatefile' => 'x', 'vars' => []]]));
    $ops = new Ops($w->store, $w->api, $w->modules, $w->handoff);
    $data = $ops->dispatch(['op' => 'service.view', 'clientId' => 12, 'serviceId' => 345]);
    same('generic', $data['kind'], 'kind');
    check($data['panel'] instanceof stdClass, 'panel is an object');
    same('{"x":{}}', Response::encode(['x' => $data['panel']]), 'encodes {}');
});

test('vps panel (Hetzner) has the full shape', function () {
    $w = new World();
    $info = ['status' => 'running', 'name' => 'srv1', 'public_net' => ['ipv4' => ['ip' => '9.9.9.9'], 'ipv6' => ['ip' => '2a01::/64']],
        'operatingSystem' => ['name' => 'Ubuntu 24.04'], 'location_display' => 'Falkenstein, DE',
        'server_type' => ['cores' => 2, 'memory' => 4.0, 'disk' => 40]];
    $w->addService(['id' => 345, 'servertype' => 'ArkHostHetznerVPS'], new FakeHandle('ArkHostHetznerVPS', [
        'ClientArea' => ['templatefile' => 'template/clientarea_direct', 'templateVariables' => ['serverInfo' => $info]],
        'Start' => 'success', 'Stop' => 'success', 'Reboot' => 'success', 'VNC' => '', 'API' => null,
    ]));
    [, $p] = $w->send(['op' => 'service.view', 'clientId' => 12, 'serviceId' => 345]);
    $panel = $p['data']['panel'];
    same(['state', 'ipv4', 'ipv6', 'os', 'location', 'specs', 'hostname', 'consoleAvailable', 'graphs'], array_keys($panel), 'vps keys');
    same('running', $panel['state'], 'state');
    same(['9.9.9.9'], $panel['ipv4'], 'ipv4');
    same(['cpu' => 2, 'ramMb' => 4096, 'diskGb' => 40], $panel['specs'], 'specs');
    same(['Start', 'Stop', 'Reboot', 'VNC'], array_column($p['data']['actions'], 'fn'), 'actions');
    same(true, $p['data']['actions'][1]['confirm'], 'Stop needs confirm');
});

// ---------------------------------------------------------------- service.action

test('service.action whitelist, Admin*, confirm and status rules', function () {
    $w = new World();
    $handle = new FakeHandle('ArkHostHetznerVPS', [
        'Start' => 'success', 'Stop' => 'success', 'Reboot' => 'Received the error: API down',
        'AdminCustomButtonArray' => [], 'TerminateAccount' => 'success', 'API' => null,
    ]);
    $w->addService(['id' => 345, 'servertype' => 'ArkHostHetznerVPS'], $handle);
    $act = fn (string $fn, bool $confirm = false) => $w->send(['op' => 'service.action', 'clientId' => 12,
        'serviceId' => 345, 'fn' => $fn, 'confirm' => $confirm, 'args' => []])[1];

    same('not_allowed', errorCode($act('AdminCustomButtonArray')), 'Admin* rejected');
    same('not_allowed', errorCode($act('adminStart')), 'admin* any case');
    same('not_allowed', errorCode($act('TerminateAccount')), 'defined but not whitelisted');
    same('confirm_required', errorCode($act('Stop')), 'Stop without confirm');
    $ok = $act('Stop', true);
    same(true, $ok['ok'], 'Stop with confirm');
    same('Stopped', $ok['data']['message'], 'message');
    same('Started', $act('Start')['data']['message'], 'Start');
    $err = $act('Reboot');
    same('module_error', errorCode($err), 'module error string');
    check(str_contains($err['error']['message'], 'API down'), 'module message passed');
    same(['Stop', 'Start', 'Reboot'], array_column($handle->calls, 0), 'only allowed functions reached the module');

    $w->store->services[345]['status'] = 'Suspended';
    same('not_active', errorCode($act('Start')), 'suspended service');

    $w->store->services[345]['userid'] = 99;
    same('not_found', errorCode($act('Start')), 'not your service');

    [, $p] = $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'bad-name!']);
    same('bad_request', errorCode($p), 'invalid fn name');
});

test('cpanel has no actions; puqProxmoxKVM whitelist comes from its button arrays', function () {
    $w = new World();
    $w->addService(['id' => 345, 'servertype' => 'cpanel'], new FakeHandle('cpanel', ['ClientRestart' => 'success']));
    [, $p] = $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'ClientRestart']);
    same('not_allowed', errorCode($p), 'cpanel actions disabled');

    $w->addService(['id' => 346, 'servertype' => 'puqProxmoxKVM'], new FakeHandle('puqProxmoxKVM', [
        'ClientAreaCustomButtonArray' => ['<i class="fa"></i> Reboot' => 'reboot', 'Stop VM' => 'stopVm', 'Admin' => 'AdminKill'],
        'ClientAreaAllowedFunctions' => ['reinstallVm'],
        'reboot' => 'success', 'stopVm' => 'success', 'reinstallVm' => 'success', 'AdminKill' => 'success', 'secret' => 'success',
    ]));
    [, $p] = $w->send(['op' => 'service.view', 'clientId' => 12, 'serviceId' => 346]);
    same(['reboot', 'stopVm', 'reinstallVm'], array_column($p['data']['actions'], 'fn'), 'runtime whitelist');
    same('Reboot', $p['data']['actions'][0]['label'], 'label stripped of HTML');
    $act = fn (string $fn, bool $c = false) => $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 346, 'fn' => $fn, 'confirm' => $c])[1];
    same(true, $act('reboot')['ok'], 'reboot ok');
    same('confirm_required', errorCode($act('stopVm')), 'stop needs confirm');
    same('confirm_required', errorCode($act('reinstallVm')), 'reinstall needs confirm');
    same('not_allowed', errorCode($act('AdminKill', true)), 'Admin from button array rejected');
    same('not_allowed', errorCode($act('secret')), 'unlisted function rejected');
});

test('pvewhmcs noVNC returns the router link as data.url', function () {
    $w = new World();
    $html = '<center><a href="https://portal.snbdhost.com/modules/servers/pvewhmcs/novnc_router.php?host=1.1.1.1&amp;port=8006" target="_blanK">x</a></center>';
    $w->addService(['id' => 345, 'servertype' => 'pvewhmcs'], new FakeHandle('pvewhmcs', ['noVNC' => $html, 'vmStop' => 'success']));
    [, $p] = $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'noVNC']);
    same('https://portal.snbdhost.com/modules/servers/pvewhmcs/novnc_router.php?host=1.1.1.1&port=8006', $p['data']['data']['url'], 'url');
    [, $p] = $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'vmStop']);
    same('confirm_required', errorCode($p), 'hard stop needs confirm');
});

test('hermes viewlogs returns plain-text logs capped at 200 lines', function () {
    $w = new World();
    $lines = implode("\n", array_map(static fn ($i) => "line $i &amp; more", range(1, 250)));
    $w->addService(['id' => 345, 'servertype' => 'hermesagent'], new FakeHandle('hermesagent', [
        'viewlogs' => "<pre style='x'>" . $lines . '</pre>', 'killswitch' => 'success',
    ]));
    [, $p] = $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'viewlogs']);
    $logs = $p['data']['data']['logs'];
    same(200, count(explode("\n", $logs)), '200 lines');
    check(str_starts_with($logs, 'line 51 & more'), 'tail kept, entities decoded');
    [, $p] = $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'killswitch']);
    same('confirm_required', errorCode($p), 'killswitch needs confirm');
});

// ---------------------------------------------------------------- SSO

test('service.sso: cPanel apps allowlist and other modules rejected', function () {
    $w = new World();
    $handle = new FakeHandle('cpanel', ['ServiceSingleSignOn' => static fn (array $p) => ['success' => true, 'redirectTo' => 'https://usa1:2083/cpsess1/?goto_app=' . $p['app']]]);
    $w->addService(['id' => 345, 'servertype' => 'cpanel'], $handle);
    [, $p] = $w->send(['op' => 'service.sso', 'clientId' => 12, 'serviceId' => 345, 'app' => 'Email_Accounts']);
    same('https://usa1:2083/cpsess1/?goto_app=Email_Accounts', $p['data']['url'], 'sso url');
    [, $p] = $w->send(['op' => 'service.sso', 'clientId' => 12, 'serviceId' => 345, 'app' => 'Terminal']);
    same('not_allowed', errorCode($p), 'app not allowed');

    $w->addService(['id' => 346, 'servertype' => 'pvewhmcs'], new FakeHandle('pvewhmcs', []));
    [, $p] = $w->send(['op' => 'service.sso', 'clientId' => 12, 'serviceId' => 346, 'app' => '']);
    same('not_allowed', errorCode($p), 'other module');
    $log = json_encode($GLOBALS['__module_log']);
    check(!str_contains($log, 'cpsess1'), 'sso url not logged');
});

test('whmcs.sso validates the path and uses CreateSsoToken', function () {
    $w = new World();
    $w->api->responses['CreateSsoToken'] = ['result' => 'success', 'redirect_url' => 'https://portal.snbdhost.com/oauth/singlesignon.php?access_token=x'];
    [, $p] = $w->send(['op' => 'whmcs.sso', 'clientId' => 12, 'path' => 'clientarea.php?action=productdetails&id=345']);
    same('https://portal.snbdhost.com/oauth/singlesignon.php?access_token=x', $p['data']['url'], 'url');
    same(['client_id' => 12, 'destination' => 'sso:custom_redirect', 'sso_redirect_path' => 'clientarea.php?action=productdetails&id=345'], $w->api->log[0][1], 'params');
    foreach (['admin/index.php', 'https://evil.com/clientarea.php', '../clientarea.php', "clientarea.php\r\nX: y", 'clientarea.php?x=<script>'] as $bad) {
        [, $p] = $w->send(['op' => 'whmcs.sso', 'clientId' => 12, 'path' => $bad]);
        same('bad_request', errorCode($p), "rejects $bad");
    }
    check(Ops::validSsoPath('viewinvoice.php?id=12'), 'viewinvoice ok');
});

test('a module calling exit still yields JSON (view fallback, action module_error)', function () {
    $probe = escapeshellarg(__DIR__ . '/exit_probe.php');
    $php = escapeshellarg(PHP_BINARY);
    $view = (string) shell_exec("$php $probe view 2>&1");
    check(str_starts_with($view, '200 {"ok":true'), 'view answered ok: ' . $view);
    check(str_contains($view, '"kind":"vps"') && str_contains($view, '"panel":{}'), 'fallback view payload');
    check(str_contains($view, 'ended the request'), 'raw.error explains');
    check(!str_contains($view, 'Hypervisor'), 'module output discarded');

    $action = (string) shell_exec("$php $probe action 2>&1");
    check(str_starts_with($action, '200 {"ok":false,"error":{"code":"module_error"'), 'action module_error: ' . $action);
    check(!str_contains($action, 'partial html'), 'action output discarded');
});

test('n8n actions need a registered service', function () {
    $w = new World();
    $w->addService(['id' => 345, 'servertype' => 'snbd_n8n'], new FakeHandle('snbd_n8n', ['handleClientAjax' => null]));
    [, $p] = $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'start']);
    same('module_error', errorCode($p), 'unregistered');
    [, $p] = $w->send(['op' => 'service.action', 'clientId' => 12, 'serviceId' => 345, 'fn' => 'reset_data']);
    same('confirm_required', errorCode($p), 'reset_data needs confirm');
    [, $p] = $w->send(['op' => 'service.view', 'clientId' => 12, 'serviceId' => 345]);
    same(11, count($p['data']['actions']), 'all handler actions listed');
});

// ---------------------------------------------------------------- units

test('Sanitize::rawVars and forLog', function () {
    same(['a' => 1, 'b' => ['c' => 'x']], Sanitize::rawVars(['a' => 1, 'TOKEN' => 2, 'b' => ['c' => 'x', 'Hash' => 1, 'n' => null]]), 'rawVars');
    $log = Sanitize::forLog(['args' => ['password' => 'pw', 'note' => 'ok'], 'data' => ['url' => 'https://x/cpsess']]);
    same('***', $log['args']['password'], 'password masked');
    same('ok', $log['args']['note'], 'note kept');
    same('***', $log['data']['url'], 'url masked');
});

test('Settings decodes encrypted and plain secrets', function () {
    same(SECRET, Settings::secret(['shared_secret' => encrypt(SECRET)]), 'encrypted');
    same(SECRET, Settings::secret(['shared_secret' => SECRET]), 'plain');
    same('', Settings::secret([]), 'missing');
});

test('Handoff tokens are single use and expire', function () {
    $w = new World();
    $token = $w->handoff->put('file', ['name' => 'b.tar.gz'], 'DATA', 60);
    check(Handoff::validToken($token), 'token format');
    $entry = $w->handoff->take($token);
    same('file', $entry['kind'], 'kind');
    same('DATA', file_get_contents($entry['file']), 'contents');
    @unlink($entry['file']);
    same(null, $w->handoff->take($token), 'second use fails');
    $expired = $w->handoff->put('vnc', ['wss' => 'wss://x'], null, -1);
    same(null, $w->handoff->take($expired), 'expired');
    same(null, $w->handoff->take('../../etc/passwd'), 'bad token');
    same('https://portal.snbdhost.com/modules/addons/snbd_portal_bridge/handoff.php?t=' . $token, Handoff::url('https://portal.snbdhost.com/', $token), 'url');
    @rmdir($w->handoffDir);
});

test('Guard discards module output and Panels helpers', function () {
    ob_start();
    $r = Guard::run(static function () {
        echo 'noise';
        ob_start();
        echo 'nested noise';
        return 42;
    });
    $out = ob_get_clean();
    same(42, $r, 'return value');
    same('', $out, 'no output');
    same('512 MB', Panels::mb('512'), 'mb');
    same('1.5 GB', Panels::mb('1536'), 'mb fractional');
    same('deploying', Panels::n8nState('provisioning'), 'n8n provisioning');
    same('error', Panels::n8nState('running (unhealthy)'), 'unhealthy');
    same([[1, 12.35]], Panels::points([[1, '12.345'], ['x', 1]]), 'points');
});

// ---------------------------------------------------------------- run

$passed = 0;
foreach ($tests as $name => $fn) {
    try {
        $fn();
        $passed++;
        echo "  ok   $name\n";
    } catch (Throwable $e) {
        $failures[] = $name;
        echo "  FAIL $name\n       " . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ")\n";
    }
}
echo "\n" . $passed . '/' . count($tests) . " tests passed, $assertions assertions\n";
exit($failures === [] ? 0 : 1);
