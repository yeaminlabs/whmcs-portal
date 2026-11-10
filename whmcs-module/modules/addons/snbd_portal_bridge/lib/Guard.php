<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Runs third-party module code with its output captured and discarded.
 *
 * Some modules echo and call exit (or die) from inside functions. exit still runs shutdown
 * functions, so bridge.php registers Guard::shutdown(): it discards whatever the module printed
 * and answers with JSON instead — the fallback payload when one was set for the call in
 * progress, otherwise a module_error.
 */
final class Guard
{
    private static int $depth = 0;
    private static ?array $fallback = null;
    private static string $where = '';

    /** @var null|callable(int, array): void */
    private static $onShutdown = null;

    /**
     * @template T
     * @param callable(): T $fn
     * @param array|null $fallbackData `data` to answer with if the module exits during $fn
     * @return T
     */
    public static function run(callable $fn, string $where = 'module', ?array $fallbackData = null): mixed
    {
        $level = ob_get_level();
        ob_start();
        $prevFallback = self::$fallback;
        $prevWhere = self::$where;
        self::$depth++;
        self::$where = $where;
        if ($fallbackData !== null) {
            self::$fallback = $fallbackData;
        }
        try {
            return $fn();
        } finally {
            while (ob_get_level() > $level) {
                ob_end_clean();
            }
            self::$depth--;
            self::$fallback = $prevFallback;
            self::$where = $prevWhere;
        }
    }

    public static function inModule(): bool
    {
        return self::$depth > 0;
    }

    /** @param callable(int $status, array $payload): void $emit */
    public static function register(callable $emit): void
    {
        self::$onShutdown = $emit;
        register_shutdown_function([self::class, 'shutdown']);
    }

    public static function shutdown(): void
    {
        if (Response::sent() || self::$onShutdown === null) {
            return;
        }
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        $fatal = error_get_last();
        $isFatal = $fatal !== null && in_array($fatal['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true);

        if (self::$fallback !== null) {
            $payload = ['ok' => true, 'data' => self::$fallback];
            $status = 200;
        } elseif (self::$depth > 0) {
            $payload = Response::errorPayload('module_error', 'The module ended the request unexpectedly (' . self::$where . ').');
            $status = 200;
        } else {
            $payload = Response::errorPayload('internal', $isFatal ? 'Internal error.' : 'The request ended unexpectedly.');
            $status = 500;
        }
        (self::$onShutdown)($status, $payload);
    }

    /** Test helper. */
    public static function reset(): void
    {
        self::$depth = 0;
        self::$fallback = null;
        self::$where = '';
    }
}
