<?php
/**
 * In-memory stand-ins for WHMCS: global function stubs, Store, localAPI and server modules.
 */

declare(strict_types=1);

use SnbdPortalBridge\Api;
use SnbdPortalBridge\ModuleHandle;
use SnbdPortalBridge\Modules;
use SnbdPortalBridge\Store;

$GLOBALS['__module_log'] = [];

function logModuleCall($module, $action, $request, $response, $processed = '', $replace = [])
{
    $GLOBALS['__module_log'][] = compact('module', 'action', 'request', 'response');
}

function encrypt($value)
{
    return 'enc:' . base64_encode((string) $value);
}

function decrypt($value)
{
    $value = (string) $value;
    return strncmp($value, 'enc:', 4) === 0 ? (string) base64_decode(substr($value, 4)) : '';
}

final class FakeStore implements Store
{
    public array $settings = [];
    public array $nonces = [];
    public array $calls = [];
    public array $clients = [12 => true, 99 => true];
    /** @var array<int, array> */
    public array $services = [];
    public array $invoices = [];   // id => userid
    public array $tickets = [];    // id => userid
    public array $moduleRows = []; // "table|col|value" => row

    public function settings(): array { return $this->settings; }
    public function saveSetting(string $name, string $value): void { $this->settings[$name] = $value; }
    public function purgeNonces(int $olderThan): void
    {
        $this->nonces = array_filter($this->nonces, static fn ($ts) => $ts >= $olderThan);
    }
    public function addNonce(string $nonce, int $ts): bool
    {
        if (isset($this->nonces[$nonce])) {
            return false;
        }
        $this->nonces[$nonce] = $ts;
        return true;
    }
    public function logCall(array $row): void { $this->calls[] = $row; }
    public function recentCalls(int $limit): array { return array_slice(array_reverse($this->calls), 0, $limit); }
    public function clientExists(int $clientId): bool { return isset($this->clients[$clientId]); }
    public function service(int $serviceId, int $clientId): ?array
    {
        $s = $this->services[$serviceId] ?? null;
        return ($s !== null && $s['userid'] === $clientId) ? $s : null;
    }
    public function invoiceOwner(int $invoiceId): ?int { return $this->invoices[$invoiceId] ?? null; }
    public function ticketOwner(?int $ticketId, ?string $ticketNumber): ?int { return $this->tickets[$ticketId ?? 0] ?? null; }
    public function activeModules(): array { return ['cpanel', 'snbd_n8n']; }
    public function whmcsVersion(): string { return '8.13.1-release.1'; }
    public function systemUrl(): string { return 'https://portal.snbdhost.com/'; }
    public function moduleRow(string $table, string $column, int|string $value): ?array
    {
        return $this->moduleRows[$table . '|' . $column . '|' . $value] ?? null;
    }
    public function clientStats(int $clientId): array
    {
        return ['numdueinvoices' => 1, 'dueinvoicesbalance' => '1497.00', 'numoverdueservices' => 0,
            'numactiveservices' => 2, 'numactivedomains' => 1, 'numactivetickets' => 1];
    }
    public function clientCurrency(int $clientId): ?array { return ['code' => 'BDT', 'prefix' => '৳']; }

    public static function service_row(array $over = []): array
    {
        return $over + [
            'id' => 345, 'userid' => 12, 'pid' => 42, 'name' => 'USA-01 Starter', 'groupname' => 'USA Shared Hosting',
            'domain' => 'example.com', 'status' => 'Active', 'billingcycle' => 'Monthly', 'recurringamount' => '97.00',
            'nextduedate' => '2026-12-01', 'regdate' => '2026-01-01', 'username' => 'exampl', 'dedicatedip' => '',
            'assignedips' => '', 'servertype' => 'cpanel', 'serverid' => 1, 'server_name' => 'usa1',
            'server_hostname' => 'usa1.snbdhost.com', 'server_ip' => '1.2.3.4',
            'nameservers' => ['ns1.snbdhost.com', 'ns2.snbdhost.com'], 'diskusage' => 120, 'disklimit' => 1024,
            'bwusage' => 3000, 'bwlimit' => 51200, 'lastupdate' => '2026-11-09 03:00:00',
        ];
    }
}

final class FakeApi extends Api
{
    /** @var list<array{0:string,1:array}> */
    public array $log = [];
    /** @var array<string, callable|array> */
    public array $responses = [];

    public function call(string $action, array $params = []): array
    {
        $this->log[] = [$action, $params];
        $r = $this->responses[$action] ?? ['result' => 'success', 'action' => $action, 'echo' => $params];
        return is_callable($r) ? $r($params) : $r;
    }
}

final class FakeHandle implements ModuleHandle
{
    public array $calls = [];

    /**
     * @param array<string, mixed> $functions fn => return value or callable(array $params): mixed
     */
    public function __construct(
        private string $module,
        private array $functions,
        private array $params = []
    ) {
    }

    public function module(): string { return $this->module; }
    public function params(): array { return $this->params + ['serviceid' => 345, 'status' => 'Active']; }
    public function has(string $fn): bool { return array_key_exists($fn, $this->functions); }

    public function call(string $fn, array $extra = [], ?array $fallbackData = null): mixed
    {
        $this->calls[] = [$fn, $extra];
        $f = $this->functions[$fn] ?? null;
        return \SnbdPortalBridge\Guard::run(
            fn () => is_callable($f) ? $f(array_merge($this->params(), $extra)) : $f,
            $this->module . '_' . $fn,
            $fallbackData
        );
    }

    public function run(callable $fn, string $where = 'module'): mixed
    {
        return \SnbdPortalBridge\Guard::run($fn, $where);
    }
}

final class FakeModules extends Modules
{
    /** @var array<int, FakeHandle> */
    public array $handles = [];

    public function load(int $serviceId, string $module): ?ModuleHandle
    {
        return $this->handles[$serviceId] ?? null;
    }
}
