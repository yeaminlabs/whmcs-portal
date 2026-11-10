<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * One bridge request: size limit, authentication, JSON decoding, dispatch, logging.
 */
final class Endpoint
{
    private Auth $auth;
    private Ops $ops;
    private float $started;
    private string $op = '-';
    private ?array $body = null;

    /** @param callable(): int|null $clock */
    public function __construct(
        private Store $store,
        Api $api,
        Modules $modules,
        Handoff $handoff,
        ?callable $clock = null
    ) {
        $this->auth = new Auth($store, $clock);
        $this->ops = new Ops($store, $api, $modules, $handoff);
        $this->started = microtime(true);
    }

    public function handle(Request $request): Response
    {
        $this->started = microtime(true);
        try {
            $response = Response::ok($this->process($request));
        } catch (BridgeError $e) {
            $response = Response::error($e);
        } catch (\Throwable $e) {
            $response = new Response(500, Response::errorPayload('internal', 'Internal error.'));
        }
        $this->log($request, $response);
        return $response;
    }

    /** Called from the shutdown handler when a module ended the request. */
    public function logAborted(Request $request, int $status, array $payload): void
    {
        $this->log($request, new Response($status, $payload));
    }

    private function process(Request $request): mixed
    {
        if ($request->method() !== 'POST') {
            throw BridgeError::badRequest('POST required.', 405);
        }
        if ($request->bodyTooLarge()) {
            throw BridgeError::badRequest('Request body exceeds 64 KB.', 413);
        }

        $settings = $this->store->settings();
        // No `version` row means the addon is not activated in WHMCS.
        $secret = isset($settings['version']) ? Settings::secret($settings) : '';
        $this->auth->verify($request, $secret, Settings::allowedIps($settings));

        try {
            $body = json_decode($request->body(), true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw BridgeError::badRequest('Malformed JSON.', 400);
        }
        if (!is_array($body) || ($body !== [] && array_is_list($body))) {
            throw BridgeError::badRequest('Body must be a JSON object.', 400);
        }
        $this->body = $body;
        $this->op = is_string($body['op'] ?? null) ? substr($body['op'], 0, 40) : '-';

        return $this->ops->dispatch($body);
    }

    private function log(Request $request, Response $response): void
    {
        $body = $this->body ?? [];
        $summary = $body;
        if (isset($summary['calls']) && is_array($summary['calls'])) {
            $summary['calls'] = array_map(
                static fn ($c) => is_array($c) ? ((string) ($c['key'] ?? '?') . ' => ' . (string) ($c['action'] ?? '?')) : '?',
                $summary['calls']
            );
        }
        $requestLog = ['ip' => $request->clientIp(), 'body' => Sanitize::forLog($summary)];

        $payload = $response->payload;
        $resultLog = $response->isOk()
            ? ['ok' => true, 'data' => Sanitize::forLog(self::logData($this->op, $payload['data'] ?? null))]
            : $payload;

        if (function_exists('logModuleCall')) {
            try {
                \call_user_func(
                    'logModuleCall',
                    'snbd_portal_bridge',
                    $this->op,
                    Response::encode($requestLog),
                    Response::encode($resultLog)
                );
            } catch (\Throwable $e) {
                // never fail a request over logging
            }
        }

        $this->store->logCall([
            'op' => $this->op,
            'client_id' => is_int($body['clientId'] ?? null) ? $body['clientId'] : 0,
            'service_id' => is_int($body['serviceId'] ?? null) ? $body['serviceId'] : 0,
            'ip' => $request->clientIp(),
            'result' => $response->resultLabel(),
            'http_status' => $response->status,
            'duration_ms' => (int) round((microtime(true) - $this->started) * 1000),
        ]);
    }

    /** Large read results are summarised in the log; the portal still gets everything. */
    private static function logData(string $op, mixed $data): mixed
    {
        if (!is_array($data)) {
            return is_object($data) ? [] : $data;
        }
        return match ($op) {
            'batch' => array_map(static fn ($r) => is_array($r) ? ($r['result'] ?? '?') : '?', $data),
            'dashboard' => array_map(static fn ($v) => is_array($v) ? count($v) . ' item(s)' : $v, $data),
            'service.view' => ['module' => $data['module'] ?? null, 'kind' => $data['kind'] ?? null, 'rawError' => $data['raw']['error'] ?? null],
            default => $data,
        };
    }
}
