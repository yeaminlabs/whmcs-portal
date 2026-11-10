<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Addon settings. `shared_secret` is a WHMCS password field: depending on how it was saved it
 * may be stored encrypted (WHMCS encrypt()) or as plain text, so both are accepted.
 */
final class Settings
{
    public static function secret(array $settings): string
    {
        $raw = trim((string) ($settings['shared_secret'] ?? ''));
        if ($raw === '') {
            return '';
        }
        if (function_exists('decrypt')) {
            try {
                $plain = (string) \call_user_func('decrypt', $raw);
            } catch (\Throwable $e) {
                $plain = '';
            }
            if (self::looksLikeSecret($plain)) {
                return $plain;
            }
        }
        return $raw;
    }

    /** Value to store for a new secret (encrypted the way WHMCS stores password fields). */
    public static function storedSecret(string $secret): string
    {
        return function_exists('encrypt') ? (string) \call_user_func('encrypt', $secret) : $secret;
    }

    public static function allowedIps(array $settings): string
    {
        return trim((string) ($settings['allowed_ips'] ?? ''));
    }

    public static function looksLikeSecret(string $value): bool
    {
        return strlen($value) >= Auth::MIN_SECRET && (bool) preg_match('/^[\x21-\x7e]+$/', $value);
    }
}
