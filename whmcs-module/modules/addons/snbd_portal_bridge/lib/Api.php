<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * WHMCS internal API (localAPI). Tests replace it with a fake.
 */
class Api
{
    public function call(string $action, array $params = []): array
    {
        $result = Guard::run(static fn () => localAPI($action, $params), 'localAPI ' . $action);
        if (!is_array($result)) {
            return ['result' => 'error', 'message' => 'Unexpected localAPI response.'];
        }
        return $result;
    }
}
