<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Single-use, short-lived tokens for things the portal must open in the customer's browser
 * (a backup download, a VNC console) without inlining them in the JSON response.
 *
 * Entries live outside the web root (system temp dir, mode 0700) and are consumed by
 * handoff.php?t=<token>. A token is 128 random bits, expires after its TTL and works once.
 */
final class Handoff
{
    public const FILE_TTL = 600;
    public const CONSOLE_TTL = 120;

    private string $dir;

    public function __construct(?string $dir = null)
    {
        $this->dir = rtrim($dir ?? (sys_get_temp_dir() . '/snbd_bridge_handoff'), '/');
    }

    public static function validToken(string $token): bool
    {
        return (bool) preg_match('/^[0-9a-f]{32}$/', $token);
    }

    /**
     * @param string $kind 'file' or 'vnc'
     * @param array $meta file: name, type; vnc: wss, password, title
     * @param string|null $contents file body for kind 'file'
     */
    public function put(string $kind, array $meta, ?string $contents, int $ttl): string
    {
        $this->ensureDir();
        $this->purgeExpired();
        $token = bin2hex(random_bytes(16));
        $entry = ['kind' => $kind, 'expires' => time() + $ttl, 'meta' => $meta];
        if ($contents !== null) {
            $this->write($this->path($token, 'bin'), $contents);
        }
        $this->write($this->path($token, 'json'), (string) json_encode($entry, JSON_UNESCAPED_SLASHES));
        return $token;
    }

    /**
     * Consumes a token. Returns ['kind', 'meta', 'file' => path|null] or null when unknown/expired.
     * The caller must unlink 'file' after streaming it.
     */
    public function take(string $token): ?array
    {
        if (!self::validToken($token)) {
            return null;
        }
        $json = $this->path($token, 'json');
        $bin = $this->path($token, 'bin');
        // rename() is atomic: only one request can claim the entry.
        $claimed = $json . '.taken.' . bin2hex(random_bytes(4));
        if (!@rename($json, $claimed)) {
            return null;
        }
        $entry = json_decode((string) @file_get_contents($claimed), true);
        @unlink($claimed);
        if (!is_array($entry) || (int) ($entry['expires'] ?? 0) < time()) {
            @unlink($bin);
            return null;
        }
        return [
            'kind' => (string) ($entry['kind'] ?? ''),
            'meta' => is_array($entry['meta'] ?? null) ? $entry['meta'] : [],
            'file' => is_file($bin) ? $bin : null,
        ];
    }

    public static function url(string $systemUrl, string $token): string
    {
        return rtrim($systemUrl, '/') . '/modules/addons/snbd_portal_bridge/handoff.php?t=' . $token;
    }

    public function purgeExpired(): void
    {
        foreach (glob($this->dir . '/*.json') ?: [] as $file) {
            $entry = json_decode((string) @file_get_contents($file), true);
            if (!is_array($entry) || (int) ($entry['expires'] ?? 0) < time()) {
                @unlink($file);
                @unlink(substr($file, 0, -5) . '.bin');
            }
        }
        foreach (glob($this->dir . '/*.bin') ?: [] as $file) {
            if (!is_file(substr($file, 0, -4) . '.json') && @filemtime($file) < time() - 3600) {
                @unlink($file);
            }
        }
    }

    private function path(string $token, string $ext): string
    {
        return $this->dir . '/' . $token . '.' . $ext;
    }

    private function ensureDir(): void
    {
        if (!is_dir($this->dir) && !@mkdir($this->dir, 0700, true) && !is_dir($this->dir)) {
            throw new BridgeError('internal', 'Could not create the handoff directory.');
        }
    }

    private function write(string $path, string $contents): void
    {
        $tmp = $path . '.tmp';
        if (@file_put_contents($tmp, $contents) === false || !@chmod($tmp, 0600) || !@rename($tmp, $path)) {
            @unlink($tmp);
            throw new BridgeError('internal', 'Could not store the handoff entry.');
        }
    }
}
