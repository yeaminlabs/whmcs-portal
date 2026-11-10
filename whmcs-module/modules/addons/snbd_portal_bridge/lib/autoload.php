<?php
/**
 * PSR-4 style autoloader for the SnbdPortalBridge\ namespace (lib/<Class>.php).
 * Library files only declare classes, so they are safe to load outside WHMCS (tests).
 */

declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $prefix = 'SnbdPortalBridge\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    if (!preg_match('/^[A-Za-z][A-Za-z0-9]*$/', $relative)) {
        return;
    }
    $file = __DIR__ . '/' . $relative . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});
