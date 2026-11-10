<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Scrubbing helpers for data leaving WHMCS (raw.vars) and for the module log.
 */
final class Sanitize
{
    /** Contract rule for raw.vars keys. */
    public const SECRET_KEY = '/pass|secret|token|key|hash|jwt|private/i';

    /**
     * Keys this bridge also drops from raw.vars: ArkHost puts the root password in
     * `install_root`, pvewhmcs passes the whole module `params` (server credentials).
     */
    public const EXTRA_KEY = '/install_root|credential|cookie|session|^params$|^model$/i';

    /** Keys masked in the module log. Narrower than SECRET_KEY so batch `key` names stay readable. */
    public const LOG_KEY = '/pass|secret|token|hash|jwt|private|api_?key|access_?key|_key$|^env$|url$|redirect|cookie|session|^logs$/i';

    public const MAX_RAW_STRING = 4096;
    public const MAX_DEPTH = 8;

    /**
     * raw.vars: drop secret-looking keys at any depth, and anything that is not a scalar or array.
     * Inline data URIs (base64 images) and very long strings are dropped too.
     */
    public static function rawVars(array $vars, int $depth = 0): array
    {
        $out = [];
        foreach ($vars as $key => $value) {
            $name = (string) $key;
            if (preg_match(self::SECRET_KEY, $name) || preg_match(self::EXTRA_KEY, $name)) {
                continue;
            }
            if (is_array($value)) {
                if ($depth + 1 >= self::MAX_DEPTH) {
                    continue;
                }
                $out[$key] = self::rawVars($value, $depth + 1);
                continue;
            }
            if (!is_scalar($value)) {
                continue;
            }
            if (is_string($value) && (strncmp($value, 'data:', 5) === 0 || strlen($value) > self::MAX_RAW_STRING)) {
                continue;
            }
            $out[$key] = $value;
        }
        return $out;
    }

    /** Copy of $data safe for logModuleCall: secrets masked, long strings cut, depth bounded. */
    public static function forLog(mixed $data, int $depth = 0): mixed
    {
        if (is_array($data)) {
            if ($depth >= self::MAX_DEPTH) {
                return '[...]';
            }
            $out = [];
            $i = 0;
            foreach ($data as $key => $value) {
                if (++$i > 50) {
                    $out['...'] = (count($data) - 50) . ' more';
                    break;
                }
                $out[$key] = (is_string($key) && preg_match(self::LOG_KEY, $key) && $value !== '' && $value !== null)
                    ? '***'
                    : self::forLog($value, $depth + 1);
            }
            return $out;
        }
        if (is_object($data)) {
            return '[' . get_class($data) . ']';
        }
        if (is_string($data) && strlen($data) > 300) {
            return substr($data, 0, 300) . '...';
        }
        return $data;
    }

    /** Plain text from a module's HTML message (<br> and <p> become newlines). */
    public static function htmlToText(string $html): string
    {
        $text = preg_replace('#<\s*br\s*/?>|</\s*(p|div|li|tr|pre)\s*>#i', "\n", $html) ?? $html;
        $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        return trim($text);
    }

    /** Last $max lines of $text. */
    public static function lastLines(string $text, int $max = 200): string
    {
        $lines = explode("\n", str_replace(["\r\n", "\r"], "\n", $text));
        if (count($lines) > $max) {
            $lines = array_slice($lines, -$max);
        }
        return implode("\n", $lines);
    }

    /** A short, single-line human message from whatever a module returned. */
    public static function message(mixed $value, string $fallback = 'The module returned an error.'): string
    {
        if (!is_string($value)) {
            return $fallback;
        }
        $text = preg_replace('/\s+/', ' ', self::htmlToText($value)) ?? '';
        $text = trim($text);
        if ($text === '') {
            return $fallback;
        }
        if (strlen($text) <= 300) {
            return $text;
        }
        return (function_exists('mb_strcut') ? mb_strcut($text, 0, 300, 'UTF-8') : substr($text, 0, 300)) . '...';
    }
}
