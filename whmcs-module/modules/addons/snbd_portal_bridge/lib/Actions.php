<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * service.action: whitelist resolution and execution per module.
 */
final class Actions
{
    public function __construct(
        private Store $store,
        private Handoff $handoff
    ) {
    }

    /**
     * Whitelisted actions the loaded module actually defines.
     *
     * @return array<string, array{label:string, via:string, confirm:bool, danger:bool, done:string, requires:string}>
     */
    public function available(?ModuleHandle $m): array
    {
        if ($m === null) {
            return [];
        }
        $module = $m->module();
        $defs = $module === Catalog::RUNTIME_WHITELIST
            ? $this->runtimeDefs($m)
            : (Catalog::ACTIONS[$module] ?? []);

        $out = [];
        foreach ($defs as $fn => $def) {
            if (stripos((string) $fn, 'admin') === 0) {
                continue;
            }
            $requires = (string) ($def['requires'] ?? $fn);
            if (!$m->has($requires)) {
                continue;
            }
            $out[(string) $fn] = [
                'label' => (string) ($def['label'] ?? $fn),
                'via' => (string) ($def['via'] ?? 'call'),
                'confirm' => (bool) ($def['confirm'] ?? false),
                'danger' => (bool) ($def['danger'] ?? false),
                'done' => (string) ($def['done'] ?? 'Done'),
                'requires' => $requires,
            ];
        }
        return $out;
    }

    /** The `actions` list for service.view. */
    public function describe(?ModuleHandle $m): array
    {
        $list = [];
        foreach ($this->available($m) as $fn => $def) {
            $list[] = ['fn' => $fn, 'label' => $def['label'], 'confirm' => $def['confirm'], 'danger' => $def['danger']];
        }
        return $list;
    }

    /**
     * Runs a whitelisted action. Ownership is checked by the caller; this enforces
     * Admin* rejection, the whitelist, Active status and confirm.
     *
     * @return array{message:string, data:array}
     */
    public function run(?ModuleHandle $m, array $service, string $fn, bool $confirm, array $args, int $clientId): array
    {
        if (stripos($fn, 'admin') === 0) {
            throw new BridgeError('not_allowed', 'Admin functions cannot be called from the portal.');
        }
        $available = $this->available($m);
        if ($m === null || !isset($available[$fn])) {
            throw new BridgeError('not_allowed', 'This action is not available for this service.');
        }
        if (($service['status'] ?? '') !== 'Active') {
            throw new BridgeError('not_active', 'This service is not active.');
        }
        $def = $available[$fn];
        if ($def['confirm'] && !$confirm) {
            throw new BridgeError('confirm_required', 'Please confirm this action.');
        }

        try {
            return match ($def['via']) {
                'call' => $this->viaCall($m, $fn, $def),
                'n8n' => $this->snbdN8n($m, $fn, $def, $args, (int) $service['id'], $clientId),
                'hermes_logs' => $this->hermesText($m, 'viewlogs', $def, ['Failed to fetch logs']),
                'hermes_health' => $this->hermesText($m, 'healthcheck', $def, ['SSH Connection failed', 'No instance mapping']),
                'hermes_password' => $this->hermesPassword($m, $def),
                'hermes_backup' => $this->hermesBackup($m, $def, (int) $service['id']),
                'hetzner_vnc' => $this->hetznerVnc($m, $def, (string) ($service['domain'] ?? '')),
                'pve_novnc' => $this->pveNoVnc($m, $def),
                'snbdpanel_password' => $this->snbdpanelPassword($m, $def),
                default => throw new BridgeError('not_allowed', 'This action is not available.'),
            };
        } catch (BridgeError $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw BridgeError::module(Sanitize::message($e->getMessage(), 'The module failed to run this action.'));
        }
    }

    /** Whether a module return value means success. */
    public static function succeeded(mixed $result): bool
    {
        if ($result === true) {
            return true;
        }
        if (is_string($result)) {
            return strcasecmp(trim($result), 'success') === 0;
        }
        if (is_array($result)) {
            return ($result['success'] ?? false) === true || ($result['result'] ?? '') === 'success';
        }
        return false;
    }

    // ---------------------------------------------------------------- generic

    private function viaCall(ModuleHandle $m, string $fn, array $def): array
    {
        $result = $m->call($fn);
        if (!self::succeeded($result)) {
            throw BridgeError::module(Sanitize::message($result));
        }
        return ['message' => $def['done'], 'data' => []];
    }

    /** puqProxmoxKVM: whitelist = its ClientAreaCustomButtonArray + ClientAreaAllowedFunctions. */
    private function runtimeDefs(ModuleHandle $m): array
    {
        $defs = [];
        if ($m->has('ClientAreaCustomButtonArray')) {
            $buttons = $m->call('ClientAreaCustomButtonArray');
            if (is_array($buttons)) {
                foreach ($buttons as $label => $fn) {
                    if (is_string($fn) && preg_match('/^[A-Za-z][A-Za-z0-9_]{0,63}$/', $fn)) {
                        $defs[$fn] = ['label' => Sanitize::message((string) $label, $fn)];
                    }
                }
            }
        }
        if ($m->has('ClientAreaAllowedFunctions')) {
            $allowed = $m->call('ClientAreaAllowedFunctions');
            if (is_array($allowed)) {
                foreach ($allowed as $fn) {
                    if (is_string($fn) && preg_match('/^[A-Za-z][A-Za-z0-9_]{0,63}$/', $fn) && !isset($defs[$fn])) {
                        $defs[$fn] = ['label' => $fn];
                    }
                }
            }
        }
        foreach ($defs as $fn => &$def) {
            $def['via'] = 'call';
            $def['confirm'] = (bool) preg_match(Catalog::RUNTIME_CONFIRM, $fn);
            $def['danger'] = (bool) preg_match(Catalog::RUNTIME_DANGER, $fn);
            $def['done'] = 'Done';
        }
        unset($def);
        return $defs;
    }

    // ---------------------------------------------------------------- snbd_n8n

    /**
     * Mirrors snbd_n8n_handleClientAjax(). That handler requires a browser session CSRF token,
     * so the bridge calls the same ContainerManager / EnvEditor / WsTokenManager methods directly.
     */
    private function snbdN8n(ModuleHandle $m, string $fn, array $def, array $args, int $serviceId, int $clientId): array
    {
        $manager = '\\SnbdN8n\\Lib\\ContainerManager';
        $row = $this->store->moduleRow('mod_snbd_n8n_services', 'hosting_id', $serviceId);
        if ($row === null) {
            throw BridgeError::module('This service is not registered yet.');
        }
        $params = $m->params();

        return $m->run(function () use ($manager, $row, $params, $fn, $def, $args, $serviceId, $clientId): array {
            if (!class_exists($manager)) {
                throw BridgeError::module('The n8n module library is not available.');
            }
            $mgr = new $manager($params);
            $audit = static function (string $what) use ($manager, $serviceId, $clientId): void {
                if (method_exists($manager, 'writeAudit')) {
                    $manager::writeAudit($serviceId, $what, 'portal', 'client', $clientId);
                }
            };
            $done = static function (mixed $r) use ($def): array {
                if (!is_array($r) || empty($r['success'])) {
                    throw BridgeError::module(Sanitize::message(is_array($r) ? ($r['message'] ?? null) : $r));
                }
                return ['message' => Sanitize::message($r['message'] ?? null, $def['done']), 'data' => []];
            };

            switch ($fn) {
                case 'start':
                case 'restart':
                    $out = $done($fn === 'start' ? $mgr->start() : $mgr->restart());
                    $audit('client_' . $fn);
                    return $out;

                case 'stop':
                    $out = $done($mgr->stop());
                    $audit('client_stop');
                    return $out;

                case 'upgrade':
                    if ((string) ($row['provenance'] ?? 'native') !== 'native') {
                        throw BridgeError::module('Upgrade is only available for stacks created by this module.');
                    }
                    return $done($mgr->upgrade('client', $clientId));

                case 'reset_users':
                    return $done($mgr->resetUsers('client', $clientId));

                case 'reset_data':
                    return $done($mgr->resetData('client', $clientId));

                case 'save_env':
                    $env = $args['env'] ?? null;
                    if (!is_array($env) || $env === []) {
                        throw BridgeError::badRequest('args.env must be a non-empty object.');
                    }
                    foreach ($env as $k => $v) {
                        if (!is_string($k) || !(is_scalar($v) || $v === null)) {
                            throw BridgeError::badRequest('args.env values must be strings.');
                        }
                    }
                    return $done($mgr->saveEnv($env, 'client', 'client', $clientId));

                case 'change_password':
                    $password = (string) ($args['password'] ?? '');
                    if (strlen($password) < 10) {
                        throw BridgeError::badRequest('Password must be at least 10 characters.');
                    }
                    $email = '';
                    if (function_exists('snbd_n8n_resolveOwnerEmail')) {
                        $email = (string) \call_user_func(
                            'snbd_n8n_resolveOwnerEmail',
                            ['email' => (string) ($args['email'] ?? '')],
                            (object) $row,
                            $params
                        );
                    }
                    if ($email === '') {
                        throw BridgeError::badRequest('A valid owner email is required.');
                    }
                    return $done($mgr->changePassword($email, $password, 'client', $clientId));

                case 'get_disk':
                    $r = $mgr->getStats(true);
                    if (!is_array($r) || empty($r['success'])) {
                        throw BridgeError::module(Sanitize::message($r['message'] ?? null, "Couldn't measure usage."));
                    }
                    $data = is_array($r['data'] ?? null) ? $r['data'] : [];
                    $disk = is_array($data['disk'] ?? null) ? $data['disk'] : [];
                    return ['message' => $def['done'], 'data' => [
                        'disk' => [
                            'usedBytes' => $disk['used_bytes'] ?? null,
                            'sizeBytes' => $disk['size_bytes'] ?? null,
                            'error' => $disk['error'] ?? null,
                        ],
                        'planStorageGb' => (string) ($data['plan_storage_gb'] ?? ''),
                    ]];

                case 'get_env':
                    return ['message' => $def['done'], 'data' => $this->n8nEnv($mgr, $row)];

                case 'get_ws_token':
                    $wsUrl = rtrim((string) ($params['configoption11'] ?? ''), '/');
                    if ($wsUrl === '') {
                        throw BridgeError::module('Live sessions are not configured for this product.');
                    }
                    $endpoint = (string) ($args['endpoint'] ?? '');
                    if (!in_array($endpoint, ['stats', 'logs', 'terminal'], true)) {
                        throw BridgeError::badRequest('args.endpoint must be stats, logs or terminal.');
                    }
                    $issuer = '\\SnbdN8n\\Lib\\WsTokenManager';
                    if (!class_exists($issuer)) {
                        throw BridgeError::module('The n8n module library is not available.');
                    }
                    $t = $issuer::issue($serviceId, $clientId, (string) ($row['container_name'] ?? ''), $endpoint);
                    if (!is_array($t) || empty($t['success'])) {
                        throw BridgeError::module(Sanitize::message($t['message'] ?? null));
                    }
                    if ($endpoint === 'terminal') {
                        $audit('terminal_open');
                    }
                    return ['message' => $def['done'], 'data' => [
                        'token' => $t['token'] ?? null,
                        'ttl' => $t['ttl'] ?? null,
                        'endpoint' => $endpoint,
                        'wsUrl' => $wsUrl,
                    ]];
            }
            throw new BridgeError('not_allowed', 'This action is not available.');
        }, 'action ' . $fn);
    }

    private function n8nEnv(object $mgr, array $row): array
    {
        $editor = '\\SnbdN8n\\Lib\\EnvEditor';
        $compose = $mgr->getCompose();
        if (!is_array($compose) || empty($compose['success'])) {
            throw BridgeError::module(Sanitize::message($compose['message'] ?? null));
        }
        if (!class_exists($editor)) {
            throw BridgeError::module('The n8n module library is not available.');
        }
        $env = $editor::parseEnv((string) ($compose['data']['compose'] ?? ''), (string) ($row['container_name'] ?? ''));
        foreach ($editor::parseDotEnv((string) ($compose['data']['dotenv'] ?? '')) as $k => $v) {
            $env[$k] = $v;
        }
        $assistant = !in_array((string) ($row['assistant_status'] ?? 'none'), ['none', 'stripped'], true);
        $split = $editor::splitClientEnv($env, $assistant, (string) ($row['domain'] ?? ''));
        return [
            'readonly' => $split['readonly'] ?? [],
            'fields' => $split['fields'] ?? [],
            'assistant' => $split['assistant'] ?? [],
            'custom' => $split['custom'] ?? [],
            'writable' => (string) ($row['provenance'] ?? 'native') === 'native',
        ];
    }

    // ---------------------------------------------------------------- hermesagent

    /** viewlogs / healthcheck return HTML; the portal gets plain text in data.logs. */
    private function hermesText(ModuleHandle $m, string $fn, array $def, array $failurePrefixes): array
    {
        $result = $m->call($fn);
        $text = is_string($result) ? Sanitize::htmlToText($result) : '';
        foreach ($failurePrefixes as $prefix) {
            if ($text === '' || stripos($text, $prefix) === 0) {
                throw BridgeError::module(Sanitize::message($text, 'The module returned no output.'));
            }
        }
        return ['message' => $def['done'], 'data' => ['logs' => Sanitize::lastLines($text, 200)]];
    }

    /** hermesagent_regenpassword() embeds the password in its message; generate it here instead. */
    private function hermesPassword(ModuleHandle $m, array $def): array
    {
        $password = $this->randomPassword(16);
        $params = $m->params();
        $params['password'] = $password;
        $result = $m->run(static fn () => \call_user_func('hermesagent_ChangePassword', $params), 'ChangePassword');
        if (!self::succeeded($result)) {
            throw BridgeError::module(Sanitize::message($result));
        }
        return ['message' => $def['done'], 'data' => ['password' => $password]];
    }

    /**
     * hermesagent_downloadbackup() streams the archive with header()+echo+exit. The bridge builds
     * the same archive over the module's SSH client and hands it out through a one-time link.
     */
    private function hermesBackup(ModuleHandle $m, array $def, int $serviceId): array
    {
        $params = $m->params();
        $binary = $m->run(static function () use ($params, $serviceId): string {
            if (function_exists('set_time_limit')) {
                @set_time_limit(300);
            }
            $ssh = \call_user_func('hermesagent_get_ssh_client', $params, 60);
            $base = '/srv/hermes/' . $serviceId;
            $check = trim((string) $ssh->exec('test -d ' . escapeshellarg($base . '/data') . ' && echo EXISTS || echo NOT_FOUND'));
            if ($check !== 'EXISTS') {
                throw BridgeError::module('Agent data directory not found on host.');
            }
            $b64 = (string) $ssh->exec('tar -czf - -C ' . escapeshellarg($base) . ' data 2>/dev/null | base64 -w 0');
            $bin = base64_decode(trim($b64), true);
            if (!is_string($bin) || $bin === '') {
                throw BridgeError::module('Failed to build the backup archive.');
            }
            return $bin;
        }, 'downloadbackup');

        $name = 'hermes_brain_' . $serviceId . '_' . date('Ymd') . '.tar.gz';
        $token = $this->handoff->put('file', ['name' => $name, 'type' => 'application/gzip'], $binary, Handoff::FILE_TTL);
        return ['message' => $def['done'], 'data' => [
            'file' => ['name' => $name, 'url' => Handoff::url($this->store->systemUrl(), $token)],
        ]];
    }

    // ---------------------------------------------------------------- VPS consoles

    /** ArkHostHetznerVPS_VNC() prints an HTML page and dies; get the console ticket from its API helper. */
    private function hetznerVnc(ModuleHandle $m, array $def, string $domain): array
    {
        $params = $m->params();
        $params['action'] = 'VNC Console';
        $vnc = $m->run(static fn () => \call_user_func('ArkHostHetznerVPS_API', $params), 'VNC');
        if (!is_array($vnc) || empty($vnc['wss_url']) || !isset($vnc['password'])) {
            throw BridgeError::module('The console could not be opened. Please try again.');
        }
        $token = $this->handoff->put('vnc', [
            'wss' => (string) $vnc['wss_url'],
            'password' => (string) $vnc['password'],
            'title' => $domain,
        ], null, Handoff::CONSOLE_TTL);
        return ['message' => $def['done'], 'data' => [
            'url' => Handoff::url($this->store->systemUrl(), $token),
            'password' => (string) $vnc['password'],
        ]];
    }

    /** pvewhmcs_noVNC() returns an HTML snippet with the router link; extract the link. */
    private function pveNoVnc(ModuleHandle $m, array $def): array
    {
        $html = $m->call('noVNC');
        if (is_string($html) && preg_match('/href="([^"]+novnc_router\.php[^"]*)"/i', $html, $match)) {
            return ['message' => $def['done'], 'data' => [
                'url' => html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'),
            ]];
        }
        throw BridgeError::module(Sanitize::message($html, 'Failed to prepare the console.'));
    }

    // ---------------------------------------------------------------- snbdpanel

    /** snbdpanel_resetpassword() redirects and exits; replicate it and return the password. */
    private function snbdpanelPassword(ModuleHandle $m, array $def): array
    {
        $params = $m->params();
        $res = $m->run(static function () use ($params): array {
            if (!function_exists('snbdpanel_call')) {
                throw BridgeError::module('The panel module is not available.');
            }
            [$status, $data, $err] = \call_user_func('snbdpanel_call', $params, 'resetpassword', [], bin2hex(random_bytes(6)), 15);
            if ((int) $status === 200 && is_array($data) && !empty($data['password'])) {
                if (function_exists('snbdpanel_store_credentials')) {
                    \call_user_func('snbdpanel_store_credentials', $params, [
                        'email' => (string) ($data['email'] ?? ''),
                        'password' => (string) $data['password'],
                    ]);
                }
                return ['password' => (string) $data['password']];
            }
            throw BridgeError::module('The panel password could not be reset' . ($err !== null ? ': ' . Sanitize::message($err) : '.'));
        }, 'resetpassword');
        return ['message' => $def['done'], 'data' => $res];
    }

    private function randomPassword(int $length): string
    {
        $alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $out = '';
        for ($i = 0; $i < $length; $i++) {
            $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return $out;
    }
}
