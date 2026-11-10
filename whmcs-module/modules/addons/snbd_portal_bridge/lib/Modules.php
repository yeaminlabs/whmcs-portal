<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Loads server modules through WHMCS\Module\Server. Tests replace it with a fake.
 */
class Modules
{
    public function load(int $serviceId, string $module): ?ModuleHandle
    {
        if ($module === '' || !preg_match('/^[A-Za-z0-9_]+$/', $module)) {
            return null;
        }
        $server = new \WHMCS\Module\Server();
        $loaded = Guard::run(static fn () => $server->loadByServiceID($serviceId), 'load ' . $module);
        if (!$loaded) {
            return null;
        }
        $params = Guard::run(static fn () => $server->buildParams(), 'buildParams ' . $module);
        return new WhmcsModuleHandle($server, $module, is_array($params) ? $params : []);
    }
}
