<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Builds the normalised `panel` object of service.view from a module's ClientArea vars.
 * Every documented key is present; unknown values are null.
 */
final class Panels
{
    public function __construct(private Store $store)
    {
    }

    /**
     * @param array $service Store::service() row
     * @param array $vars    the module's ClientArea template variables (unsanitised)
     */
    public function build(string $kind, ?ModuleHandle $m, array $service, array $vars, string $template): array
    {
        $module = $m?->module() ?? (string) ($service['servertype'] ?? '');
        $params = $m?->params() ?? [];

        return match ($kind) {
            'hosting' => $this->hosting($service),
            'n8n' => $module === 'snbd_n8n'
                ? $this->snbdN8n($service, $vars, $params)
                : $this->openclaw($service, $vars),
            'hermes' => $this->hermes($service, $vars, $template),
            'vps' => match ($module) {
                'ArkHostHetznerVPS' => $this->hetzner($m, $service, $vars),
                'pvewhmcs' => $this->pve($service, $vars),
                'snbdpanel' => $this->snbdpanel($service, $vars, $params),
                default => $this->vpsFromService($service, $m),
            },
            default => [],
        };
    }

    // ---------------------------------------------------------------- hosting

    private function hosting(array $service): array
    {
        $host = self::str($service['server_hostname'] ?? null) ?? self::str($service['server_ip'] ?? null);
        return [
            'cpanelUrl' => $host !== null ? 'https://' . $host . ':2083' : null,
            'webmailUrl' => $host !== null ? 'https://' . $host . ':2096' : null,
        ];
    }

    // ---------------------------------------------------------------- n8n

    private function snbdN8n(array $service, array $vars, array $params): array
    {
        $row = $this->store->moduleRow('mod_snbd_n8n_services', 'hosting_id', (int) $service['id']) ?? [];
        $template = (string) ($row['template'] ?? ($params['configoption1'] ?? ''));
        $queue = $template === 'n8n-queue';
        $database = match ($template) {
            'n8n-sqlite' => 'SQLite',
            'n8n-pgsql', 'n8n-queue' => 'PostgreSQL',
            default => null,
        };
        $workers = null;
        if ($queue) {
            $workers = (int) ($row['workers'] ?? 0) ?: ((int) ($params['configoption6'] ?? 0) ?: null);
        }

        $state = self::n8nState((string) ($vars['status'] ?? ''));
        if (!empty($vars['is_suspended']) || ($service['status'] ?? '') === 'Suspended') {
            $state = 'suspended';
        }

        return [
            'url' => self::httpsUrl(self::str($vars['domain'] ?? null) ?? self::str($service['domain'] ?? null)),
            'state' => $state,
            'version' => self::str($row['n8n_version'] ?? null),
            'resources' => [
                'cpu' => self::str($vars['resource_cpu'] ?? null),
                'ram' => self::mb($vars['resource_ram'] ?? null),
                'disk' => self::gb($vars['resource_storage'] ?? null),
            ],
            'database' => $database,
            'mode' => $template === '' ? null : ($queue ? 'Queue' : 'Standard'),
            'workers' => $workers,
        ];
    }

    private function openclaw(array $service, array $vars): array
    {
        $state = self::n8nState((string) ($vars['status'] ?? ''));
        if (($service['status'] ?? '') === 'Suspended') {
            $state = 'suspended';
        }
        return [
            'url' => self::str($vars['dashboard_url'] ?? null) ?? self::httpsUrl(self::str($vars['service_domain'] ?? null)),
            'state' => $state,
            'version' => self::str($vars['installed_version'] ?? null),
            'resources' => [
                'cpu' => self::str($vars['resource_cpu'] ?? null),
                'ram' => self::mb($vars['resource_ram'] ?? null),
                'disk' => self::gb($vars['resource_storage'] ?? null),
            ],
            'database' => null,
            'mode' => 'Standard',
            'workers' => null,
        ];
    }

    public static function n8nState(string $status): string
    {
        $s = strtolower(trim($status));
        return match (true) {
            $s === 'running' => 'running',
            $s === 'stopped', $s === 'exited', $s === 'terminated' => 'stopped',
            $s === 'suspended' => 'suspended',
            $s === 'error', $s === 'failed', str_contains($s, 'unhealthy') => 'error',
            $s === 'provisioning', str_contains($s, 'start'), str_contains($s, 'install'),
            str_contains($s, 'deploy'), str_contains($s, 'upgrad'), str_contains($s, 'creat') => 'deploying',
            default => 'unknown',
        };
    }

    // ---------------------------------------------------------------- hermes

    private function hermes(array $service, array $vars, string $template): array
    {
        $status = strtolower(trim((string) ($vars['deployment_status'] ?? '')));
        $state = match (true) {
            str_contains($template, 'onboarding'), str_starts_with($status, 'pending') => 'deploying',
            $status === 'active' => 'running',
            $status === 'suspended', $status === 'terminated' => 'stopped',
            $status === 'error' => 'error',
            default => 'unknown',
        };

        $row = $this->store->moduleRow('mod_hermesagent_instances', 'serviceid', (int) $service['id']) ?? [];
        $brain = self::str($row['current_model'] ?? null);
        if ($brain === null && function_exists('hermesagent_get_active_brain')) {
            try {
                $active = \call_user_func('hermesagent_get_active_brain');
                $brain = is_array($active) ? self::str($active['model_name'] ?? null) : null;
            } catch (\Throwable $e) {
                $brain = null;
            }
        }

        $hasUsage = array_key_exists('total_used', $vars);
        return [
            'state' => $state,
            'endpoint' => !empty($vars['api_enabled']) ? self::str($vars['api_url'] ?? null) : null,
            'dashboardUrl' => self::str($vars['dashboard_url'] ?? null),
            'llm' => [
                'used' => $hasUsage ? (int) $vars['total_used'] : null,
                'limit' => isset($vars['token_limit']) ? (int) $vars['token_limit'] : null,
                'unit' => 'tokens',
            ],
            'brain' => $brain,
        ];
    }

    // ---------------------------------------------------------------- vps

    private static function vpsShape(): array
    {
        return [
            'state' => 'unknown',
            'ipv4' => [],
            'ipv6' => [],
            'os' => null,
            'location' => null,
            'specs' => ['cpu' => null, 'ramMb' => null, 'diskGb' => null],
            'hostname' => null,
            'consoleAvailable' => false,
            'graphs' => [],
        ];
    }

    private function hetzner(?ModuleHandle $m, array $service, array $vars): array
    {
        $panel = self::vpsShape();
        $info = is_array($vars['serverInfo'] ?? null) ? $vars['serverInfo'] : [];

        $panel['state'] = match ((string) ($info['status'] ?? '')) {
            'running' => 'running',
            'off' => 'stopped',
            'starting' => 'starting',
            'stopping' => 'stopping',
            'initializing', 'rebuilding', 'migrating' => 'deploying',
            default => 'unknown',
        };
        $v4 = self::str($info['public_net']['ipv4']['ip'] ?? null);
        $v6 = self::str($info['public_net']['ipv6']['ip'] ?? null);
        [$extra4, $extra6] = self::serviceIps($service);
        $panel['ipv4'] = array_values(array_unique(array_merge($v4 !== null ? [$v4] : [], $extra4)));
        $panel['ipv6'] = array_values(array_unique(array_merge($v6 !== null ? [$v6] : [], $extra6)));

        $os = self::str($info['operatingSystem']['name'] ?? null);
        $panel['os'] = ($os === 'Unknown OS') ? null : $os;
        $location = self::str($info['location_display'] ?? null);
        $panel['location'] = $location === 'N/A' ? null : $location;
        $type = is_array($info['server_type'] ?? null) ? $info['server_type'] : [];
        $panel['specs'] = [
            'cpu' => isset($type['cores']) ? (int) $type['cores'] : null,
            'ramMb' => isset($type['memory']) ? (int) round((float) $type['memory'] * 1024) : null,
            'diskGb' => isset($type['disk']) ? (int) $type['disk'] : null,
        ];
        $panel['hostname'] = self::str($info['name'] ?? null) ?? self::str($service['domain'] ?? null);
        $panel['consoleAvailable'] = $m !== null && $m->has('API') && $info !== [];

        if ($m !== null && $info !== [] && $m->has('API')) {
            $panel['graphs'] = $this->hetznerGraphs($m);
        }
        return $this->suspendedOverride($panel, $service);
    }

    private function hetznerGraphs(ModuleHandle $m): array
    {
        $params = $m->params();
        $params['action'] = 'Graphs';
        $params['time'] = 'day';
        try {
            $metrics = $m->run(static fn () => \call_user_func('ArkHostHetznerVPS_API', $params), 'Graphs');
        } catch (\Throwable $e) {
            return [];
        }
        $series = is_array($metrics) ? ($metrics['metrics']['time_series'] ?? []) : [];
        if (!is_array($series)) {
            return [];
        }
        $graphs = [];
        foreach (['cpu' => 'CPU %'] as $key => $name) {
            $values = $series[$key]['values'] ?? null;
            if (is_array($values) && $values !== []) {
                $graphs[] = ['name' => $name, 'points' => self::points($values)];
            }
        }
        return $graphs;
    }

    private function pve(array $service, array $vars): array
    {
        $panel = self::vpsShape();
        $status = is_array($vars['vm_status'] ?? null) ? $vars['vm_status'] : [];
        $config = is_array($vars['vm_config'] ?? null) ? $vars['vm_config'] : [];

        $panel['state'] = match ((string) ($status['status'] ?? '')) {
            'running' => 'running',
            'stopped' => 'stopped',
            default => 'unknown',
        };
        [$extra4, $extra6] = self::serviceIps($service);
        $v4 = self::str($config['ipv4'] ?? null);
        $v6 = self::str($config['v6prefix'] ?? null);
        $panel['ipv4'] = array_values(array_unique(array_merge($v4 !== null ? [$v4] : [], $extra4)));
        $panel['ipv6'] = array_values(array_unique(array_merge($v6 !== null ? [$v6] : [], $extra6)));

        $ostype = self::str($config['ostype'] ?? null);
        $panel['os'] = $ostype === null ? null : (match (true) {
            $ostype === 'l26', $ostype === 'l24' => 'Linux',
            str_starts_with($ostype, 'win'), $ostype === 'wxp', $ostype === 'w2k' => 'Windows',
            default => $ostype,
        });

        $cores = (int) ($config['cores'] ?? 0) * max(1, (int) ($config['sockets'] ?? 1));
        $panel['specs'] = [
            'cpu' => isset($status['maxcpu']) ? (int) $status['maxcpu'] : ($cores ?: null),
            'ramMb' => isset($config['memory']) ? (int) $config['memory']
                : (isset($status['maxmem']) ? (int) round($status['maxmem'] / 1048576) : null),
            'diskGb' => isset($status['maxdisk']) ? (int) round($status['maxdisk'] / 1073741824) : null,
        ];
        $panel['hostname'] = self::str($config['hostname'] ?? null)
            ?? self::str($config['name'] ?? null)
            ?? self::str($service['domain'] ?? null);
        $panel['consoleAvailable'] = $status !== [];
        return $this->suspendedOverride($panel, $service);
    }

    private function snbdpanel(array $service, array $vars, array $params): array
    {
        $panel = self::vpsShape();
        $label = strtolower((string) ($vars['status_label'] ?? ''));
        $panel['state'] = match ($label) {
            'online' => 'running',
            'booting' => 'starting',
            'provisioning' => 'deploying',
            'stopped' => 'stopped',
            'suspended' => 'suspended',
            default => 'unknown',
        };
        [$extra4, $extra6] = self::serviceIps($service);
        $ip = self::str($vars['ip'] ?? null);
        $ips = array_merge($ip !== null ? [$ip] : [], $extra4, $extra6);
        $panel['ipv4'] = array_values(array_unique(array_filter($ips, static fn ($a) => !str_contains($a, ':'))));
        $panel['ipv6'] = array_values(array_unique(array_filter($ips, static fn ($a) => str_contains($a, ':'))));

        $os = self::str($vars['os_label'] ?? null);
        $panel['os'] = $os === '—' ? null : $os;
        $region = self::str($vars['region_label'] ?? null);
        $panel['location'] = ($region === null || $region === 'Provider default')
            ? self::str($vars['provider_label'] ?? null)
            : $region;

        $plan = [];
        if (function_exists('snbdpanel_plan')) {
            try {
                $plan = (array) \call_user_func('snbdpanel_plan', $params);
            } catch (\Throwable $e) {
                $plan = [];
            }
        }
        $panel['specs'] = [
            'cpu' => isset($plan['vcpu']) ? (int) $plan['vcpu'] : null,
            'ramMb' => isset($plan['ramGb']) ? (int) round((float) $plan['ramGb'] * 1024) : null,
            'diskGb' => isset($plan['diskGb']) ? (int) $plan['diskGb'] : null,
        ];
        $panel['hostname'] = self::str($vars['server_name'] ?? null) ?? self::str($service['domain'] ?? null);
        $panel['consoleAvailable'] = false;
        return $this->suspendedOverride($panel, $service);
    }

    /** puqProxmoxKVM is ionCube-encoded and loads its data over its own AJAX; use the service record. */
    private function vpsFromService(array $service, ?ModuleHandle $m): array
    {
        $panel = self::vpsShape();
        [$v4, $v6] = self::serviceIps($service);
        $panel['ipv4'] = $v4;
        $panel['ipv6'] = $v6;
        $panel['hostname'] = self::str($service['domain'] ?? null);
        $panel['consoleAvailable'] = false;
        return $this->suspendedOverride($panel, $service);
    }

    private function suspendedOverride(array $panel, array $service): array
    {
        if (($service['status'] ?? '') === 'Suspended') {
            $panel['state'] = 'suspended';
        }
        return $panel;
    }

    // ---------------------------------------------------------------- helpers

    /** @return array{0: list<string>, 1: list<string>} dedicated + assigned IPs split by family */
    public static function serviceIps(array $service): array
    {
        $all = array_merge(
            [(string) ($service['dedicatedip'] ?? '')],
            preg_split('/[\s,]+/', (string) ($service['assignedips'] ?? '')) ?: []
        );
        $v4 = [];
        $v6 = [];
        foreach ($all as $ip) {
            $ip = trim($ip);
            if ($ip === '') {
                continue;
            }
            $bare = explode('/', $ip, 2)[0];
            if (filter_var($bare, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                $v4[] = $ip;
            } elseif (filter_var($bare, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
                $v6[] = $ip;
            }
        }
        return [array_values(array_unique($v4)), array_values(array_unique($v6))];
    }

    /** [[ts, value], ...] → [[int, float], ...], at most 300 points. */
    public static function points(array $values): array
    {
        $out = [];
        foreach ($values as $pair) {
            if (is_array($pair) && isset($pair[0], $pair[1]) && is_numeric($pair[0]) && is_numeric($pair[1])) {
                $out[] = [(int) $pair[0], round((float) $pair[1], 2)];
            }
        }
        return array_slice($out, -300);
    }

    public static function str(mixed $v): ?string
    {
        if (!is_scalar($v)) {
            return null;
        }
        $s = trim((string) $v);
        return $s === '' ? null : $s;
    }

    private static function httpsUrl(?string $domain): ?string
    {
        if ($domain === null) {
            return null;
        }
        return preg_match('#^https?://#i', $domain) ? $domain : 'https://' . $domain;
    }

    /** "1024" (MB) → "1 GB", "512" → "512 MB". */
    public static function mb(mixed $v): ?string
    {
        $s = self::str($v);
        if ($s === null || !is_numeric($s)) {
            return $s;
        }
        $mb = (float) $s;
        if ($mb >= 1024) {
            $gb = $mb / 1024;
            return (floor($gb) == $gb ? (string) (int) $gb : (string) round($gb, 1)) . ' GB';
        }
        return ((string) (int) $mb) . ' MB';
    }

    /** "10" (GB) → "10 GB". */
    public static function gb(mixed $v): ?string
    {
        $s = self::str($v);
        if ($s === null || !is_numeric($s)) {
            return $s;
        }
        $gb = (float) $s;
        return (floor($gb) == $gb ? (string) (int) $gb : (string) round($gb, 1)) . ' GB';
    }
}
