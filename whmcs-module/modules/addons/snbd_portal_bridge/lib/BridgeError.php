<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * An error that maps directly onto a contract response:
 * `{ "ok": false, "error": { "code": ..., "message": ... } }` with the given HTTP status.
 */
final class BridgeError extends \RuntimeException
{
    public const CODES = [
        'auth', 'bad_request', 'not_found', 'not_active', 'not_allowed',
        'confirm_required', 'module_error', 'internal',
    ];

    private string $errorCode;
    private int $httpStatus;

    public function __construct(string $code, string $message, int $httpStatus = 200)
    {
        parent::__construct($message);
        $this->errorCode = in_array($code, self::CODES, true) ? $code : 'internal';
        $this->httpStatus = $httpStatus;
    }

    public function errorCode(): string
    {
        return $this->errorCode;
    }

    public function httpStatus(): int
    {
        return $this->httpStatus;
    }

    public static function auth(string $message): self
    {
        return new self('auth', $message, 401);
    }

    public static function badRequest(string $message, int $httpStatus = 200): self
    {
        return new self('bad_request', $message, $httpStatus);
    }

    public static function notFound(string $message = 'Not found'): self
    {
        return new self('not_found', $message);
    }

    public static function module(string $message): self
    {
        return new self('module_error', $message);
    }
}
