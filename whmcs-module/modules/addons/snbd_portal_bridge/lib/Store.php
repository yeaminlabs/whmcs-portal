<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Every database read/write the bridge performs. The live implementation is CapsuleStore;
 * the test harness provides an in-memory one.
 */
interface Store
{
    /** Addon settings from tbladdonmodules (module = snbd_portal_bridge), raw values. */
    public function settings(): array;

    public function saveSetting(string $name, string $value): void;

    public function purgeNonces(int $olderThan): void;

    /** False when the nonce already exists. */
    public function addNonce(string $nonce, int $ts): bool;

    public function logCall(array $row): void;

    /** @return list<array<string,mixed>> newest first */
    public function recentCalls(int $limit): array;

    public function clientExists(int $clientId): bool;

    /**
     * The service joined with product, group and server, or null unless it belongs to $clientId.
     * Keys: id, userid, pid, name, groupname, domain, status, billingcycle, recurringamount,
     * nextduedate, regdate, username, dedicatedip, assignedips, servertype, serverid,
     * server_name, server_hostname, server_ip, nameservers (list), diskusage, disklimit,
     * bwusage, bwlimit, lastupdate.
     */
    public function service(int $serviceId, int $clientId): ?array;

    public function invoiceOwner(int $invoiceId): ?int;

    /** Ticket owner by tbltickets.id or by the public ticket number (tid). */
    public function ticketOwner(?int $ticketId, ?string $ticketNumber): ?int;

    /** @return list<string> server modules with at least one Active service */
    public function activeModules(): array;

    public function whmcsVersion(): string;

    public function systemUrl(): string;

    /** First row of a module-owned table (mod_*), as an array. */
    public function moduleRow(string $table, string $column, int|string $value): ?array;

    /**
     * numdueinvoices, dueinvoicesbalance, numoverdueservices, numactiveservices,
     * numactivedomains, numactivetickets.
     */
    public function clientStats(int $clientId): array;

    /** ['code' => 'BDT', 'prefix' => '৳'] for the client's currency, or null. */
    public function clientCurrency(int $clientId): ?array;
}
