<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * A JSON response. send() clears every output buffer first, so nothing printed by WHMCS or a
 * module can precede the JSON.
 */
final class Response
{
    private static bool $sent = false;

    public function __construct(public readonly int $status, public readonly array $payload)
    {
    }

    public static function ok(mixed $data): self
    {
        return new self(200, ['ok' => true, 'data' => $data]);
    }

    public static function error(BridgeError $e): self
    {
        return new self($e->httpStatus(), self::errorPayload($e->errorCode(), $e->getMessage()));
    }

    public static function errorPayload(string $code, string $message): array
    {
        return ['ok' => false, 'error' => ['code' => $code, 'message' => $message]];
    }

    public function isOk(): bool
    {
        return ($this->payload['ok'] ?? false) === true;
    }

    /** 'ok' or the error code. */
    public function resultLabel(): string
    {
        return $this->isOk() ? 'ok' : (string) ($this->payload['error']['code'] ?? 'internal');
    }

    public static function encode(array $payload): string
    {
        $json = json_encode(
            $payload,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR
        );
        return is_string($json) ? $json : '{"ok":false,"error":{"code":"internal","message":"Could not encode the response."}}';
    }

    public function send(): void
    {
        self::emit($this->status, $this->payload);
    }

    public static function emit(int $status, array $payload): void
    {
        self::$sent = true;
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        if (!headers_sent()) {
            header_remove('Location');
            header_remove('Content-Disposition');
            header_remove('Set-Cookie');
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
        }
        echo self::encode($payload);
    }

    public static function sent(): bool
    {
        return self::$sent;
    }
}
