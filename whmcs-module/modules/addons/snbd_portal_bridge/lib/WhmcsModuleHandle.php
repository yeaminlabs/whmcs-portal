<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

final class WhmcsModuleHandle implements ModuleHandle
{
    public function __construct(
        private \WHMCS\Module\Server $server,
        private string $module,
        private array $params
    ) {
    }

    public function module(): string
    {
        return $this->module;
    }

    public function params(): array
    {
        return $this->params;
    }

    public function has(string $fn): bool
    {
        return (bool) $this->server->functionExists($fn);
    }

    public function call(string $fn, array $extra = [], ?array $fallbackData = null): mixed
    {
        $params = array_merge($this->params, $extra);
        return Guard::run(fn () => $this->server->call($fn, $params), $this->module . '_' . $fn, $fallbackData);
    }

    public function run(callable $fn, string $where = 'module'): mixed
    {
        return Guard::run($fn, $this->module . ' ' . $where);
    }
}
