<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Request authentication per BRIDGE_CONTRACT.md:
 * HMAC-SHA256(secret, ts + "." + nonce + "." + rawBody), ts within ±120 s,
 * nonce unique for 10 minutes, optional client IP allowlist.
 */
final class Auth
{
    public const MAX_BODY = 65536;
    public const MAX_SKEW = 120;
    public const NONCE_TTL = 600;
    public const MIN_SECRET = 32;

    /** @var callable(): int */
    private $clock;

    public function __construct(private Store $store, ?callable $clock = null)
    {
        $this->clock = $clock ?? static fn (): int => time();
    }

    public static function sign(string $secret, string $ts, string $nonce, string $body): string
    {
        return hash_hmac('sha256', $ts . '.' . $nonce . '.' . $body, $secret);
    }

    /** @throws BridgeError */
    public function verify(Request $request, string $secret, string $allowedIps): void
    {
        if (strlen($secret) < self::MIN_SECRET) {
            throw new BridgeError('internal', 'The bridge is not configured.', 503);
        }

        if (trim($allowedIps) !== '' && !self::ipAllowed($request->clientIp(), $allowedIps)) {
            throw new BridgeError('auth', 'Client IP is not allowed.', 403);
        }

        $ts = $request->header('x-bridge-ts');
        $nonce = strtolower($request->header('x-bridge-nonce'));
        $sig = strtolower($request->header('x-bridge-sig'));

        if (!preg_match('/^\d{1,12}$/', $ts) || !preg_match('/^[0-9a-f]{32}$/', $nonce) || !preg_match('/^[0-9a-f]{64}$/', $sig)) {
            throw BridgeError::auth('Missing or malformed authentication headers.');
        }

        $now = ($this->clock)();
        if (abs($now - (int) $ts) > self::MAX_SKEW) {
            throw BridgeError::auth('Request timestamp is outside the allowed window.');
        }

        $expected = self::sign($secret, $ts, $nonce, $request->body());
        if (!hash_equals($expected, $sig)) {
            throw BridgeError::auth('Signature mismatch.');
        }

        // Only signed requests reach the nonce table, so it cannot be flooded by strangers.
        $this->store->purgeNonces($now - self::NONCE_TTL);
        if (!$this->store->addNonce($nonce, $now)) {
            throw BridgeError::auth('Nonce already used.');
        }
    }

    /** $list: comma/space separated IPs or CIDR ranges (IPv4 or IPv6). */
    public static function ipAllowed(string $ip, string $list): bool
    {
        $ipBin = @inet_pton(trim($ip));
        if ($ipBin === false) {
            return false;
        }
        foreach (preg_split('/[\s,]+/', trim($list)) ?: [] as $entry) {
            if ($entry === '') {
                continue;
            }
            if (self::matches($ipBin, $entry)) {
                return true;
            }
        }
        return false;
    }

    public static function validIpEntry(string $entry): bool
    {
        $parts = explode('/', $entry, 2);
        $bin = @inet_pton($parts[0]);
        if ($bin === false) {
            return false;
        }
        if (!isset($parts[1])) {
            return true;
        }
        return ctype_digit($parts[1]) && (int) $parts[1] <= strlen($bin) * 8;
    }

    private static function matches(string $ipBin, string $entry): bool
    {
        if (!self::validIpEntry($entry)) {
            return false;
        }
        $parts = explode('/', $entry, 2);
        $netBin = (string) inet_pton($parts[0]);
        if (strlen($netBin) !== strlen($ipBin)) {
            return false;
        }
        $bits = isset($parts[1]) ? (int) $parts[1] : strlen($netBin) * 8;
        $fullBytes = intdiv($bits, 8);
        if (strncmp($ipBin, $netBin, $fullBytes) !== 0) {
            return false;
        }
        $rest = $bits % 8;
        if ($rest === 0) {
            return true;
        }
        $mask = (0xFF << (8 - $rest)) & 0xFF;
        return (ord($ipBin[$fullBytes]) & $mask) === (ord($netBin[$fullBytes]) & $mask);
    }
}
