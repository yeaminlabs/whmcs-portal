<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * The incoming HTTP request, decoupled from PHP globals so it can be built in tests.
 */
final class Request
{
    /** @var array<string,string> */
    private array $headers = [];

    /**
     * @param array<string,string> $headers any case; stored lower-cased
     */
    public function __construct(
        private string $method,
        array $headers,
        private string $body,
        private string $remoteAddr,
        private bool $bodyTooLarge = false
    ) {
        foreach ($headers as $name => $value) {
            $this->headers[strtolower((string) $name)] = trim((string) $value);
        }
    }

    /** Build from the PHP SAPI globals, reading at most MAX_BODY + 1 bytes of the body. */
    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($key) && strncmp($key, 'HTTP_', 5) === 0 && is_scalar($value)) {
                $headers[str_replace('_', '-', strtolower(substr($key, 5)))] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_LENGTH'])) {
            $headers['content-length'] = (string) $_SERVER['CONTENT_LENGTH'];
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }

        $declared = (int) ($headers['content-length'] ?? 0);
        $tooLarge = $declared > Auth::MAX_BODY;
        $body = '';
        if (!$tooLarge) {
            $read = file_get_contents('php://input', false, null, 0, Auth::MAX_BODY + 1);
            $body = is_string($read) ? $read : '';
            $tooLarge = strlen($body) > Auth::MAX_BODY;
        }

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $headers,
            $tooLarge ? '' : $body,
            (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
            $tooLarge
        );
    }

    public function method(): string
    {
        return $this->method;
    }

    public function header(string $name): string
    {
        return $this->headers[strtolower($name)] ?? '';
    }

    public function body(): string
    {
        return $this->body;
    }

    public function bodyTooLarge(): bool
    {
        return $this->bodyTooLarge || strlen($this->body) > Auth::MAX_BODY;
    }

    /** CF-Connecting-IP when present (requests arrive through Cloudflare), otherwise REMOTE_ADDR. */
    public function clientIp(): string
    {
        $cf = $this->header('cf-connecting-ip');
        if ($cf !== '' && @inet_pton($cf) !== false) {
            return $cf;
        }
        return $this->remoteAddr;
    }
}
