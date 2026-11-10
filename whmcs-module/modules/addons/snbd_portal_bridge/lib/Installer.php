<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

use WHMCS\Database\Capsule;

/**
 * Activates the addon the way Setup > Addon Modules > Activate does: settings rows in
 * tbladdonmodules, the module in ActiveAddonModules, admin-role access in AddonModulesPerms,
 * then snbd_portal_bridge_activate(). Safe to run repeatedly.
 */
final class Installer
{
    public const MODULE = 'snbd_portal_bridge';

    /** @return array{status: string, roles: list<int>, allowed_ips: string, secret_length: int} */
    public function run(string $secret, ?string $allowedIps): array
    {
        if (!Settings::looksLikeSecret($secret)) {
            throw new \InvalidArgumentException('BRIDGE_SECRET must be at least ' . Auth::MIN_SECRET . ' printable characters without spaces.');
        }
        if ($allowedIps !== null) {
            foreach (preg_split('/[\s,]+/', trim($allowedIps)) ?: [] as $entry) {
                if ($entry !== '' && !Auth::validIpEntry($entry)) {
                    throw new \InvalidArgumentException('BRIDGE_ALLOWED_IPS contains an invalid entry.');
                }
            }
        }

        $existed = Capsule::table('tbladdonmodules')
            ->where('module', self::MODULE)->where('setting', 'version')->exists();

        $roles = Capsule::table('tbladminroles')->orderBy('id')->pluck('id')
            ->map(static fn ($id): int => (int) $id)->values()->all();

        $store = new CapsuleStore();
        $store->saveSetting('version', Ops::VERSION);
        $store->saveSetting('access', implode(',', $roles));
        $store->saveSetting('shared_secret', Settings::storedSecret($secret));
        if ($allowedIps !== null) {
            $store->saveSetting('allowed_ips', implode(',', array_filter(preg_split('/[\s,]+/', trim($allowedIps)) ?: [])));
        } elseif (!array_key_exists('allowed_ips', $store->settings())) {
            $store->saveSetting('allowed_ips', '');
        }

        $this->markActive();
        $this->grantRoles($roles);

        $activate = \call_user_func('snbd_portal_bridge_activate');
        if (!is_array($activate) || ($activate['status'] ?? '') !== 'success') {
            throw new \RuntimeException((string) ($activate['description'] ?? 'Activation failed.'));
        }

        return [
            'status' => $existed ? 'updated' : 'installed',
            'roles' => $roles,
            'allowed_ips' => Settings::allowedIps($store->settings()),
            'secret_length' => strlen($secret),
        ];
    }

    private function markActive(): void
    {
        $current = (string) Capsule::table('tblconfiguration')->where('setting', 'ActiveAddonModules')->value('value');
        $list = array_values(array_filter(array_map('trim', explode(',', $current))));
        if (!in_array(self::MODULE, $list, true)) {
            $list[] = self::MODULE;
        }
        $this->setConfig('ActiveAddonModules', implode(',', $list));
    }

    /** @param list<int> $roles */
    private function grantRoles(array $roles): void
    {
        $raw = (string) Capsule::table('tblconfiguration')->where('setting', 'AddonModulesPerms')->value('value');
        $perms = $raw !== '' ? @unserialize($raw, ['allowed_classes' => false]) : [];
        if (!is_array($perms)) {
            $perms = [];
        }
        $name = (string) (\call_user_func('snbd_portal_bridge_config')['name'] ?? self::MODULE);
        foreach ($roles as $roleId) {
            $current = is_array($perms[$roleId] ?? null) ? $perms[$roleId] : [];
            $current[self::MODULE] = $name;
            $perms[$roleId] = $current;
        }
        $this->setConfig('AddonModulesPerms', serialize($perms));
    }

    private function setConfig(string $setting, string $value): void
    {
        $exists = Capsule::table('tblconfiguration')->where('setting', $setting)->exists();
        if ($exists) {
            Capsule::table('tblconfiguration')->where('setting', $setting)->update(['value' => $value]);
        } else {
            Capsule::table('tblconfiguration')->insert(['setting' => $setting, 'value' => $value]);
        }
    }
}
