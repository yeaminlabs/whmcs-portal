<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

use WHMCS\Database\Capsule;

/**
 * Store backed by the WHMCS database (Illuminate Capsule).
 */
final class CapsuleStore implements Store
{
    public const MODULE = 'snbd_portal_bridge';
    public const NONCE_TABLE = 'mod_snbd_bridge_nonce';
    public const LOG_TABLE = 'mod_snbd_bridge_log';

    public static function createTables(): void
    {
        $schema = Capsule::schema();
        if (!$schema->hasTable(self::NONCE_TABLE)) {
            $schema->create(self::NONCE_TABLE, static function ($table): void {
                $table->char('nonce', 32)->primary();
                $table->integer('ts')->index();
            });
        }
        if (!$schema->hasTable(self::LOG_TABLE)) {
            $schema->create(self::LOG_TABLE, static function ($table): void {
                $table->increments('id');
                $table->dateTime('created_at')->index();
                $table->string('op', 40);
                $table->unsignedInteger('client_id')->default(0);
                $table->unsignedInteger('service_id')->default(0);
                $table->string('ip', 64)->default('');
                $table->string('result', 32);
                $table->unsignedSmallInteger('http_status')->default(200);
                $table->unsignedInteger('duration_ms')->default(0);
            });
        }
    }

    public static function dropTables(): void
    {
        Capsule::schema()->dropIfExists(self::NONCE_TABLE);
        Capsule::schema()->dropIfExists(self::LOG_TABLE);
    }

    public function settings(): array
    {
        $out = [];
        foreach (Capsule::table('tbladdonmodules')->where('module', self::MODULE)->get(['setting', 'value']) as $row) {
            $out[(string) $row->setting] = (string) $row->value;
        }
        return $out;
    }

    public function saveSetting(string $name, string $value): void
    {
        $exists = Capsule::table('tbladdonmodules')
            ->where('module', self::MODULE)->where('setting', $name)->exists();
        if ($exists) {
            Capsule::table('tbladdonmodules')
                ->where('module', self::MODULE)->where('setting', $name)
                ->update(['value' => $value]);
        } else {
            Capsule::table('tbladdonmodules')
                ->insert(['module' => self::MODULE, 'setting' => $name, 'value' => $value]);
        }
    }

    public function purgeNonces(int $olderThan): void
    {
        try {
            Capsule::table(self::NONCE_TABLE)->where('ts', '<', $olderThan)->delete();
        } catch (\Throwable $e) {
            self::createTables();
        }
    }

    public function addNonce(string $nonce, int $ts): bool
    {
        for ($attempt = 0; $attempt < 2; $attempt++) {
            try {
                if (Capsule::table(self::NONCE_TABLE)->where('nonce', $nonce)->exists()) {
                    return false;
                }
                Capsule::table(self::NONCE_TABLE)->insert(['nonce' => $nonce, 'ts' => $ts]);
                return true;
            } catch (\Throwable $e) {
                // 23000 = duplicate key from a concurrent request with the same nonce.
                if ((string) $e->getCode() === '23000') {
                    return false;
                }
                if ($attempt === 0 && !Capsule::schema()->hasTable(self::NONCE_TABLE)) {
                    self::createTables();
                    continue;
                }
                throw $e;
            }
        }
        return false;
    }

    public function logCall(array $row): void
    {
        try {
            Capsule::table(self::LOG_TABLE)->insert([
                'created_at' => date('Y-m-d H:i:s'),
                'op' => substr((string) ($row['op'] ?? ''), 0, 40),
                'client_id' => max(0, (int) ($row['client_id'] ?? 0)),
                'service_id' => max(0, (int) ($row['service_id'] ?? 0)),
                'ip' => substr((string) ($row['ip'] ?? ''), 0, 64),
                'result' => substr((string) ($row['result'] ?? ''), 0, 32),
                'http_status' => (int) ($row['http_status'] ?? 200),
                'duration_ms' => max(0, (int) ($row['duration_ms'] ?? 0)),
            ]);
            if (random_int(1, 100) === 1) {
                Capsule::table(self::LOG_TABLE)
                    ->where('created_at', '<', date('Y-m-d H:i:s', time() - 30 * 86400))
                    ->delete();
            }
        } catch (\Throwable $e) {
            // The call log is a convenience; never fail a request over it.
        }
    }

    public function recentCalls(int $limit): array
    {
        try {
            return array_map(
                static fn ($row): array => (array) $row,
                Capsule::table(self::LOG_TABLE)->orderBy('id', 'desc')->limit($limit)->get()->all()
            );
        } catch (\Throwable $e) {
            return [];
        }
    }

    public function clientExists(int $clientId): bool
    {
        return $clientId > 0 && Capsule::table('tblclients')->where('id', $clientId)->exists();
    }

    public function service(int $serviceId, int $clientId): ?array
    {
        if ($serviceId <= 0 || $clientId <= 0) {
            return null;
        }
        $row = Capsule::table('tblhosting as h')
            ->leftJoin('tblproducts as p', 'p.id', '=', 'h.packageid')
            ->leftJoin('tblproductgroups as g', 'g.id', '=', 'p.gid')
            ->leftJoin('tblservers as s', 's.id', '=', 'h.server')
            ->where('h.id', $serviceId)
            ->where('h.userid', $clientId)
            ->select([
                'h.id', 'h.userid', 'h.packageid', 'h.domain', 'h.domainstatus', 'h.billingcycle',
                'h.amount', 'h.nextduedate', 'h.regdate', 'h.username', 'h.dedicatedip',
                'h.assignedips', 'h.server', 'h.diskusage', 'h.disklimit', 'h.bwusage', 'h.bwlimit',
                'h.lastupdate', 'p.name as product_name', 'p.servertype', 'g.name as group_name',
                's.name as server_name', 's.hostname as server_hostname', 's.ipaddress as server_ip',
                's.nameserver1', 's.nameserver2', 's.nameserver3', 's.nameserver4', 's.nameserver5',
            ])
            ->first();
        if (!$row) {
            return null;
        }
        $r = (array) $row;
        $nameservers = [];
        for ($i = 1; $i <= 5; $i++) {
            $ns = trim((string) ($r['nameserver' . $i] ?? ''));
            if ($ns !== '') {
                $nameservers[] = $ns;
            }
        }
        return [
            'id' => (int) $r['id'],
            'userid' => (int) $r['userid'],
            'pid' => (int) $r['packageid'],
            'name' => (string) ($r['product_name'] ?? ''),
            'groupname' => (string) ($r['group_name'] ?? ''),
            'domain' => (string) ($r['domain'] ?? ''),
            'status' => (string) ($r['domainstatus'] ?? ''),
            'billingcycle' => (string) ($r['billingcycle'] ?? ''),
            'recurringamount' => (string) ($r['amount'] ?? '0.00'),
            'nextduedate' => (string) ($r['nextduedate'] ?? ''),
            'regdate' => (string) ($r['regdate'] ?? ''),
            'username' => (string) ($r['username'] ?? ''),
            'dedicatedip' => (string) ($r['dedicatedip'] ?? ''),
            'assignedips' => (string) ($r['assignedips'] ?? ''),
            'servertype' => (string) ($r['servertype'] ?? ''),
            'serverid' => (int) ($r['server'] ?? 0),
            'server_name' => $r['server_name'] ?? null,
            'server_hostname' => $r['server_hostname'] ?? null,
            'server_ip' => $r['server_ip'] ?? null,
            'nameservers' => $nameservers,
            'diskusage' => (int) ($r['diskusage'] ?? 0),
            'disklimit' => (int) ($r['disklimit'] ?? 0),
            'bwusage' => (int) ($r['bwusage'] ?? 0),
            'bwlimit' => (int) ($r['bwlimit'] ?? 0),
            'lastupdate' => (string) ($r['lastupdate'] ?? ''),
        ];
    }

    public function invoiceOwner(int $invoiceId): ?int
    {
        $owner = Capsule::table('tblinvoices')->where('id', $invoiceId)->value('userid');
        return $owner === null ? null : (int) $owner;
    }

    public function ticketOwner(?int $ticketId, ?string $ticketNumber): ?int
    {
        $query = Capsule::table('tbltickets');
        if ($ticketId !== null && $ticketId > 0) {
            $query->where('id', $ticketId);
        } elseif ($ticketNumber !== null && $ticketNumber !== '') {
            $query->where('tid', $ticketNumber);
        } else {
            return null;
        }
        $owner = $query->value('userid');
        return $owner === null ? null : (int) $owner;
    }

    public function activeModules(): array
    {
        return Capsule::table('tblhosting as h')
            ->join('tblproducts as p', 'p.id', '=', 'h.packageid')
            ->where('h.domainstatus', 'Active')
            ->where('p.servertype', '!=', '')
            ->distinct()
            ->orderBy('p.servertype')
            ->pluck('p.servertype')
            ->map(static fn ($m): string => (string) $m)
            ->values()
            ->all();
    }

    public function whmcsVersion(): string
    {
        return (string) Capsule::table('tblconfiguration')->where('setting', 'Version')->value('value');
    }

    public function systemUrl(): string
    {
        $url = (string) Capsule::table('tblconfiguration')->where('setting', 'SystemURL')->value('value');
        return $url === '' ? '' : rtrim($url, '/') . '/';
    }

    public function moduleRow(string $table, string $column, int|string $value): ?array
    {
        if (!preg_match('/^mod_[a-z0-9_]+$/', $table) || !preg_match('/^[a-z0-9_]+$/', $column)) {
            return null;
        }
        try {
            $row = Capsule::table($table)->where($column, $value)->first();
        } catch (\Throwable $e) {
            return null;
        }
        return $row ? (array) $row : null;
    }

    public function clientStats(int $clientId): array
    {
        $today = date('Y-m-d');
        $unpaid = Capsule::table('tblinvoices')->where('userid', $clientId)->where('status', 'Unpaid');
        $unpaidTotal = (float) (clone $unpaid)->sum('total');
        $paidAgainst = (float) Capsule::table('tblaccounts')
            ->whereIn('invoiceid', (clone $unpaid)->select('id'))
            ->sum(Capsule::raw('amountin - amountout'));

        return [
            'numdueinvoices' => (int) (clone $unpaid)->count(),
            'dueinvoicesbalance' => number_format(max(0.0, $unpaidTotal - $paidAgainst), 2, '.', ''),
            'numoverdueservices' => (int) Capsule::table('tblhosting')
                ->where('userid', $clientId)
                ->whereIn('domainstatus', ['Active', 'Suspended'])
                ->whereNotIn('billingcycle', ['Free Account', 'Free', 'One Time'])
                ->where('nextduedate', '>', '0000-00-00')
                ->where('nextduedate', '<', $today)
                ->count(),
            'numactiveservices' => (int) Capsule::table('tblhosting')
                ->where('userid', $clientId)->where('domainstatus', 'Active')->count(),
            'numactivedomains' => (int) Capsule::table('tbldomains')
                ->where('userid', $clientId)->where('status', 'Active')->count(),
            'numactivetickets' => (int) Capsule::table('tbltickets')
                ->where('userid', $clientId)->where('status', '!=', 'Closed')->count(),
        ];
    }

    public function clientCurrency(int $clientId): ?array
    {
        $row = Capsule::table('tblclients as c')
            ->join('tblcurrencies as cur', 'cur.id', '=', 'c.currency')
            ->where('c.id', $clientId)
            ->first(['cur.code', 'cur.prefix']);
        return $row ? ['code' => (string) $row->code, 'prefix' => (string) $row->prefix] : null;
    }
}
