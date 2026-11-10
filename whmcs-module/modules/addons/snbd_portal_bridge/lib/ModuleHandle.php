<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * A server module loaded for one service.
 */
interface ModuleHandle
{
    public function module(): string;

    /** Module params as built by WHMCS for this service. */
    public function params(): array;

    /** Whether `<module>_<fn>` is defined. */
    public function has(string $fn): bool;

    /**
     * Calls `<module>_<fn>($params + $extra)` with output captured and discarded.
     * $fallbackData is answered (ok:true) if the module calls exit during the call.
     */
    public function call(string $fn, array $extra = [], ?array $fallbackData = null): mixed;

    /** Runs arbitrary code that uses the module's helpers/classes, output captured. */
    public function run(callable $fn, string $where = 'module'): mixed;
}
