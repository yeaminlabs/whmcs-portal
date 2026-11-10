<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * The contract operations. Every method returns the response `data` or throws BridgeError.
 */
final class Ops
{
    public const VERSION = '1.0.0';
    public const MAX_BATCH = 12;

    public const OPS = ['ping', 'batch', 'dashboard', 'service.view', 'service.action', 'service.sso', 'whmcs.sso'];

    private Actions $actions;
    private Panels $panels;

    public function __construct(
        private Store $store,
        private Api $api,
        private Modules $modules,
        Handoff $handoff
    ) {
        $this->actions = new Actions($store, $handoff);
        $this->panels = new Panels($store);
    }

    public function dispatch(array $body): array
    {
        $op = $body['op'] ?? null;
        if (!is_string($op) || !in_array($op, self::OPS, true)) {
            throw BridgeError::badRequest('Unknown op.', 400);
        }
        if ($op === 'ping') {
            return $this->ping();
        }

        $clientId = self::clientId($body);
        if (!$this->store->clientExists($clientId)) {
            throw BridgeError::notFound('Client not found.');
        }

        return match ($op) {
            'batch' => $this->batch($clientId, $body['calls'] ?? null),
            'dashboard' => $this->dashboard($clientId),
            'service.view' => $this->serviceView($clientId, self::serviceId($body)),
            'service.action' => $this->serviceAction($clientId, self::serviceId($body), $body),
            'service.sso' => $this->serviceSso($clientId, self::serviceId($body), $body['app'] ?? ''),
            'whmcs.sso' => $this->whmcsSso($clientId, $body['path'] ?? null),
        };
    }

    public static function clientId(array $body): int
    {
        $id = $body['clientId'] ?? null;
        if (!is_int($id) && !(is_string($id) && ctype_digit($id))) {
            throw BridgeError::badRequest('clientId must be an integer.');
        }
        $id = (int) $id;
        if ($id <= 0) {
            throw BridgeError::badRequest('clientId must be positive.');
        }
        return $id;
    }

    public static function serviceId(array $body): int
    {
        $id = $body['serviceId'] ?? null;
        if (!is_int($id) && !(is_string($id) && ctype_digit($id))) {
            throw BridgeError::badRequest('serviceId must be an integer.');
        }
        return (int) $id;
    }

    // ---------------------------------------------------------------- ping

    private function ping(): array
    {
        return [
            'version' => self::VERSION,
            'whmcs' => $this->store->whmcsVersion(),
            'modules' => $this->store->activeModules(),
        ];
    }

    // ---------------------------------------------------------------- batch

    private function batch(int $clientId, mixed $calls): array
    {
        if (!is_array($calls) || !array_is_list($calls) || $calls === []) {
            throw BridgeError::badRequest('calls must be a non-empty array.');
        }
        if (count($calls) > self::MAX_BATCH) {
            throw BridgeError::badRequest('At most ' . self::MAX_BATCH . ' calls per batch.');
        }

        // Validate everything first: one non-whitelisted action rejects the whole batch.
        $plan = [];
        foreach ($calls as $i => $call) {
            if (!is_array($call)) {
                throw BridgeError::badRequest("calls[$i] must be an object.");
            }
            $key = $call['key'] ?? null;
            if (!is_string($key) || $key === '' || strlen($key) > 64) {
                throw BridgeError::badRequest("calls[$i].key must be a non-empty string (max 64).");
            }
            if (isset($plan[$key])) {
                throw BridgeError::badRequest("Duplicate key \"$key\".");
            }
            $action = is_string($call['action'] ?? null) ? Catalog::batchAction($call['action']) : null;
            if ($action === null) {
                throw new BridgeError('not_allowed', 'Action not allowed: ' . Sanitize::message((string) ($call['action'] ?? ''), '?'));
            }
            $params = $call['params'] ?? [];
            if (!is_array($params) || ($params !== [] && array_is_list($params))) {
                throw BridgeError::badRequest("calls[$i].params must be an object.");
            }
            $plan[$key] = [$action, $params];
        }

        $out = [];
        foreach ($plan as $key => [$action, $params]) {
            $out[$key] = $this->batchCall($clientId, $action, $params);
        }
        return $out;
    }

    /** One batch entry; failures are reported under its key. */
    private function batchCall(int $clientId, string $action, array $params): array
    {
        try {
            if (!in_array($action, Catalog::BATCH_GLOBAL, true)) {
                foreach (Catalog::BATCH_STRIP as $strip) {
                    unset($params[$strip]);
                }
                $params['clientid'] = $clientId;
                $params['userid'] = $clientId;
            }
            $object = Catalog::BATCH_OBJECT[$action] ?? null;
            if ($object !== null && !$this->ownsObject($clientId, $object, $params)) {
                return ['result' => 'error', 'message' => 'not_found'];
            }
            return $this->api->call($action, $params);
        } catch (\Throwable $e) {
            return ['result' => 'error', 'message' => Sanitize::message($e->getMessage(), 'Call failed.')];
        }
    }

    private function ownsObject(int $clientId, string $object, array $params): bool
    {
        if ($object === 'invoice') {
            $id = (int) ($params['invoiceid'] ?? 0);
            return $id > 0 && $this->store->invoiceOwner($id) === $clientId;
        }
        $ticketId = isset($params['ticketid']) ? (int) $params['ticketid'] : null;
        $ticketNum = isset($params['ticketnum']) && is_scalar($params['ticketnum']) ? (string) $params['ticketnum'] : null;
        if (($ticketId === null || $ticketId <= 0) && ($ticketNum === null || $ticketNum === '')) {
            return false;
        }
        return $this->store->ticketOwner($ticketId, $ticketNum) === $clientId;
    }

    // ---------------------------------------------------------------- dashboard

    private function dashboard(int $clientId): array
    {
        $details = $this->api->call('GetClientsDetails', ['clientid' => $clientId, 'stats' => true]);
        if (($details['result'] ?? '') !== 'success') {
            throw BridgeError::module(Sanitize::message($details['message'] ?? null, 'Could not load the client.'));
        }
        $c = is_array($details['client'] ?? null) ? $details['client'] + $details : $details;

        $currency = $this->store->clientCurrency($clientId);
        $client = [
            'id' => (int) ($c['id'] ?? $c['userid'] ?? $c['client_id'] ?? $clientId),
            'firstname' => (string) ($c['firstname'] ?? ''),
            'lastname' => (string) ($c['lastname'] ?? ''),
            'fullname' => (string) ($c['fullname'] ?? trim(($c['firstname'] ?? '') . ' ' . ($c['lastname'] ?? ''))),
            'email' => (string) ($c['email'] ?? ''),
            'currency' => (int) ($c['currency'] ?? 0),
            'currency_code' => (string) ($c['currency_code'] ?? ($currency['code'] ?? '')),
            'credit' => number_format((float) ($c['credit'] ?? 0), 2, '.', ''),
            'language' => (string) ($c['language'] ?? ''),
        ];

        $services = $this->listOf($this->api->call('GetClientsProducts', ['clientid' => $clientId, 'limitnum' => 500]), 'products', 'product');
        $domains = $this->listOf($this->api->call('GetClientsDomains', ['clientid' => $clientId, 'limitnum' => 500]), 'domains', 'domain');
        $invoices = $this->listOf($this->api->call('GetInvoices', [
            'userid' => $clientId, 'limitnum' => 25, 'orderby' => 'id', 'order' => 'desc',
        ]), 'invoices', 'invoice');
        $tickets = $this->listOf($this->api->call('GetSupportTickets', ['clientid' => $clientId, 'limitnum' => 100]), 'tickets', 'ticket');

        $invoices = array_map(static function (array $inv) use ($currency): array {
            if ($currency !== null) {
                $inv['currencycode'] ??= $currency['code'];
                $inv['currencyprefix'] ??= $currency['prefix'];
            }
            return $inv;
        }, self::latest($invoices, 5));

        $open = array_values(array_filter($tickets, static fn (array $t): bool => strcasecmp((string) ($t['status'] ?? ''), 'Closed') !== 0));
        usort($open, static fn (array $a, array $b): int => strcmp((string) ($b['lastreply'] ?? ''), (string) ($a['lastreply'] ?? '')));

        return [
            'client' => $client,
            'stats' => $this->store->clientStats($clientId),
            'services' => self::latest($services, 5),
            'domains' => self::latest($domains, 5),
            'invoices' => $invoices,
            'tickets' => array_slice($open, 0, 5),
        ];
    }

    /** localAPI list result → list of row arrays. */
    private function listOf(array $result, string $outer, string $inner): array
    {
        if (($result['result'] ?? '') !== 'success') {
            return [];
        }
        $rows = $result[$outer][$inner] ?? [];
        return is_array($rows) ? array_values(array_filter($rows, 'is_array')) : [];
    }

    /** Highest ids first. */
    private static function latest(array $rows, int $n): array
    {
        usort($rows, static fn (array $a, array $b): int => (int) ($b['id'] ?? 0) <=> (int) ($a['id'] ?? 0));
        return array_slice($rows, 0, $n);
    }

    // ---------------------------------------------------------------- service.view

    private function ownedService(int $clientId, int $serviceId): array
    {
        $service = $this->store->service($serviceId, $clientId);
        if ($service === null) {
            throw BridgeError::notFound('Service not found.');
        }
        return $service;
    }

    private function serviceView(int $clientId, int $serviceId): array
    {
        return self::jsonShape($this->buildView($this->ownedService($clientId, $serviceId), $serviceId));
    }

    /** Empty `panel` and `raw.vars` must encode as {} rather than []. */
    private static function jsonShape(array $view): array
    {
        if ($view['panel'] === []) {
            $view['panel'] = new \stdClass();
        }
        if ($view['raw']['vars'] === []) {
            $view['raw']['vars'] = new \stdClass();
        }
        return $view;
    }

    private function buildView(array $service, int $serviceId): array
    {
        $module = (string) $service['servertype'];
        $kind = Catalog::kind($module);

        $view = [
            'service' => self::publicService($service),
            'module' => $module,
            'kind' => $kind,
            'actions' => [],
            'sso' => [],
            'panel' => [],
            'raw' => ['templatefile' => null, 'vars' => []],
        ];

        $m = null;
        try {
            $m = $this->modules->load($serviceId, $module);
            $view['actions'] = $this->actions->describe($m);
            $view['sso'] = $this->ssoList($m);
        } catch (\Throwable $e) {
            $view['raw']['error'] = Sanitize::message($e->getMessage(), 'The module could not be loaded.');
            return $view;
        }
        if ($m === null || !$m->has('ClientArea')) {
            if ($m !== null) {
                $view['panel'] = $this->safePanel($kind, $m, $service, [], '');
            }
            return $view;
        }

        $fallback = $view;
        $fallback['raw']['error'] = 'The module ended the request while rendering its client area.';
        $fallback = self::jsonShape($fallback);
        try {
            $result = $m->call('ClientArea', [], $fallback);
        } catch (\Throwable $e) {
            $view['raw']['error'] = Sanitize::message($e->getMessage(), 'The module failed to render its client area.');
            return $view;
        }

        [$template, $vars] = self::clientAreaParts($result);
        $view['raw'] = ['templatefile' => $template, 'vars' => Sanitize::rawVars($vars)];
        if ($template !== null && preg_match('#(^|/)error$#', $template) && isset($vars['error'])) {
            $view['raw']['error'] = Sanitize::message((string) $vars['error']);
            return $view;
        }
        $view['panel'] = $this->safePanel($kind, $m, $service, $vars, (string) $template);
        if ($view['panel'] === [] && $kind !== 'generic') {
            $view['raw']['error'] ??= 'Could not build the panel.';
        }
        return $view;
    }

    private function safePanel(string $kind, ModuleHandle $m, array $service, array $vars, string $template): array
    {
        try {
            return $this->panels->build($kind, $m, $service, $vars, $template);
        } catch (\Throwable $e) {
            return [];
        }
    }

    /** @return array{0: ?string, 1: array} */
    public static function clientAreaParts(mixed $result): array
    {
        if (!is_array($result)) {
            return [null, []];
        }
        $template = $result['templatefile']
            ?? $result['tabOverviewReplacementTemplate']
            ?? $result['tabOverviewModuleOutputTemplate']
            ?? null;
        $vars = $result['vars'] ?? $result['templateVariables'] ?? [];
        return [is_string($template) ? $template : null, is_array($vars) ? $vars : []];
    }

    public static function publicService(array $s): array
    {
        [$v4, $v6] = Panels::serviceIps(['assignedips' => $s['assignedips'] ?? '']);
        return [
            'id' => (int) $s['id'],
            'pid' => (int) $s['pid'],
            'name' => (string) $s['name'],
            'groupname' => (string) $s['groupname'],
            'domain' => (string) $s['domain'],
            'status' => (string) $s['status'],
            'billingcycle' => (string) $s['billingcycle'],
            'recurringamount' => number_format((float) $s['recurringamount'], 2, '.', ''),
            'nextduedate' => (string) $s['nextduedate'],
            'regdate' => (string) $s['regdate'],
            'username' => (string) $s['username'],
            'dedicatedip' => (string) $s['dedicatedip'],
            'assignedips' => array_merge($v4, $v6),
            'server' => [
                'name' => Panels::str($s['server_name'] ?? null),
                'hostname' => Panels::str($s['server_hostname'] ?? null),
                'ip' => Panels::str($s['server_ip'] ?? null),
            ],
            'nameservers' => array_values($s['nameservers'] ?? []),
            'diskusage' => (int) $s['diskusage'],
            'disklimit' => (int) $s['disklimit'],
            'bwusage' => (int) $s['bwusage'],
            'bwlimit' => (int) $s['bwlimit'],
            'lastupdate' => (string) $s['lastupdate'],
        ];
    }

    private function ssoList(?ModuleHandle $m): array
    {
        if ($m === null) {
            return [];
        }
        if ($m->module() === 'cpanel' && $m->has('ServiceSingleSignOn')) {
            $list = [];
            foreach (Catalog::CPANEL_SSO_APPS as $app => $label) {
                $list[] = ['app' => (string) $app, 'label' => $label];
            }
            return $list;
        }
        if ($m->module() === 'snbdpanel' && $m->has('sso')) {
            return [['app' => '', 'label' => 'SNBD Panel']];
        }
        return [];
    }

    // ---------------------------------------------------------------- service.action

    private function serviceAction(int $clientId, int $serviceId, array $body): array
    {
        $fn = $body['fn'] ?? null;
        if (!is_string($fn) || !preg_match('/^[A-Za-z][A-Za-z0-9_]{0,63}$/', $fn)) {
            throw BridgeError::badRequest('fn must be a function name.');
        }
        $args = $body['args'] ?? [];
        if (!is_array($args)) {
            throw BridgeError::badRequest('args must be an object.');
        }
        $service = $this->ownedService($clientId, $serviceId);
        if (stripos($fn, 'admin') === 0) {
            throw new BridgeError('not_allowed', 'Admin functions cannot be called from the portal.');
        }
        try {
            $m = $this->modules->load($serviceId, (string) $service['servertype']);
        } catch (\Throwable $e) {
            throw BridgeError::module(Sanitize::message($e->getMessage(), 'The module could not be loaded.'));
        }
        $result = $this->actions->run($m, $service, $fn, ($body['confirm'] ?? false) === true, $args, $clientId);
        if ($result['data'] === []) {
            $result['data'] = new \stdClass();
        }
        return $result;
    }

    // ---------------------------------------------------------------- SSO

    private function serviceSso(int $clientId, int $serviceId, mixed $app): array
    {
        if (!is_string($app)) {
            throw BridgeError::badRequest('app must be a string.');
        }
        $service = $this->ownedService($clientId, $serviceId);
        $module = (string) $service['servertype'];
        if (!in_array($module, ['cpanel', 'snbdpanel'], true)) {
            throw new BridgeError('not_allowed', 'Single sign-on is not available for this service.');
        }
        if ($module === 'cpanel' && !array_key_exists($app, Catalog::CPANEL_SSO_APPS)) {
            throw new BridgeError('not_allowed', 'This cPanel app is not allowed.');
        }
        if ($service['status'] !== 'Active') {
            throw new BridgeError('not_active', 'This service is not active.');
        }
        $m = $this->modules->load($serviceId, $module);
        if ($m === null) {
            throw BridgeError::module('The module could not be loaded.');
        }

        if ($module === 'cpanel') {
            if (!$m->has('ServiceSingleSignOn')) {
                throw new BridgeError('not_allowed', 'Single sign-on is not available for this service.');
            }
            try {
                $r = $m->call('ServiceSingleSignOn', ['app' => $app]);
            } catch (\Throwable $e) {
                throw BridgeError::module(Sanitize::message($e->getMessage(), 'Single sign-on failed.'));
            }
            if (is_array($r) && !empty($r['success']) && is_string($r['redirectTo'] ?? null) && $r['redirectTo'] !== '') {
                return ['url' => $r['redirectTo']];
            }
            throw BridgeError::module(Sanitize::message(is_array($r) ? ($r['errorMsg'] ?? null) : $r, 'Single sign-on failed.'));
        }

        if (!$m->has('sso') || !function_exists('snbdpanel_call')) {
            throw new BridgeError('not_allowed', 'Single sign-on is not available for this service.');
        }
        $params = $m->params();
        try {
            [$status, $data, $err] = $m->run(
                static fn () => \call_user_func('snbdpanel_call', $params, 'sso', [], bin2hex(random_bytes(6)), 8),
                'sso'
            );
        } catch (\Throwable $e) {
            throw BridgeError::module(Sanitize::message($e->getMessage(), 'Could not open the panel.'));
        }
        if ((int) $status === 200 && is_array($data) && is_string($data['url'] ?? null) && $data['url'] !== '') {
            return ['url' => $data['url']];
        }
        throw BridgeError::module('Could not open the panel' . ($err !== null ? ': ' . Sanitize::message($err) : '. Please try again.'));
    }

    private function whmcsSso(int $clientId, mixed $path): array
    {
        if (!is_string($path) || !self::validSsoPath($path)) {
            throw BridgeError::badRequest('path must start with clientarea.php or viewinvoice.php.');
        }
        $r = $this->api->call('CreateSsoToken', [
            'client_id' => $clientId,
            'destination' => 'sso:custom_redirect',
            'sso_redirect_path' => $path,
        ]);
        if (($r['result'] ?? '') !== 'success' || !is_string($r['redirect_url'] ?? null)) {
            throw BridgeError::module(Sanitize::message($r['message'] ?? null, 'Could not create the sign-in link.'));
        }
        return ['url' => $r['redirect_url']];
    }

    public static function validSsoPath(string $path): bool
    {
        if (strlen($path) > 512 || preg_match('/[\x00-\x1f\x7f\s\\\\]/', $path)) {
            return false;
        }
        return (bool) preg_match('#^(clientarea|viewinvoice)\.php(\?[A-Za-z0-9_\-.=&%\[\]+]*)?$#', $path);
    }
}
