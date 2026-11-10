<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Addons > SNBD Portal Bridge admin page: status, recent calls, secret rotation.
 */
final class AdminPage
{
    public function __construct(private Store $store)
    {
    }

    public function render(array $vars): void
    {
        $link = (string) ($vars['modulelink'] ?? 'addonmodules.php?module=snbd_portal_bridge');
        $newSecret = null;
        $error = null;

        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['snbd_bridge_action'] ?? '') === 'rotate') {
            if (!$this->csrfValid()) {
                $error = 'Your session token expired. Reload the page and try again.';
            } elseif (($_POST['confirm_rotate'] ?? '') !== 'yes') {
                $error = 'Tick the confirmation box to rotate the secret.';
            } else {
                $newSecret = bin2hex(random_bytes(32));
                $this->store->saveSetting('shared_secret', Settings::storedSecret($newSecret));
            }
        }

        $settings = $this->store->settings();
        $secret = Settings::secret($settings);
        $allowed = Settings::allowedIps($settings);
        $calls = $this->store->recentCalls(20);
        $endpoint = $this->store->systemUrl() . 'modules/addons/snbd_portal_bridge/bridge.php';

        $h = static fn ($v): string => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');

        echo '<div class="snbd-bridge">';
        if ($error !== null) {
            echo '<div class="alert alert-danger">' . $h($error) . '</div>';
        }
        if ($newSecret !== null) {
            echo '<div class="alert alert-warning"><strong>New shared secret — shown once.</strong> '
                . 'Copy it into the portal as <code>BRIDGE_SECRET</code> and restart the portal. '
                . 'Requests signed with the old secret are rejected from now on.'
                . '<input type="text" readonly class="form-control" style="margin-top:8px;font-family:monospace" '
                . 'onclick="this.select()" value="' . $h($newSecret) . '"></div>';
        }

        echo '<h2>Status</h2><table class="table table-condensed" style="max-width:760px">';
        $rows = [
            'Bridge version' => Ops::VERSION,
            'WHMCS version' => $this->store->whmcsVersion(),
            'Endpoint' => $endpoint,
            'Shared secret' => strlen($secret) >= Auth::MIN_SECRET
                ? 'Configured (' . strlen($secret) . ' characters)'
                : 'NOT CONFIGURED — the bridge rejects every request',
            'Allowed IPs' => $allowed !== '' ? $allowed : 'Any (signature only)',
            'Last call' => isset($calls[0]['created_at'])
                ? $calls[0]['created_at'] . ' (' . $calls[0]['op'] . ', ' . $calls[0]['result'] . ')'
                : 'None yet',
        ];
        foreach ($rows as $label => $value) {
            echo '<tr><th style="width:180px">' . $h($label) . '</th><td>' . $h($value) . '</td></tr>';
        }
        echo '</table>';

        echo '<h2>Last 20 bridge calls</h2>';
        if ($calls === []) {
            echo '<p class="text-muted">No calls recorded.</p>';
        } else {
            echo '<table class="table table-striped table-condensed"><thead><tr>'
                . '<th>Time</th><th>Op</th><th>Client</th><th>Service</th><th>IP</th><th>Result</th><th>HTTP</th><th>ms</th>'
                . '</tr></thead><tbody>';
            foreach ($calls as $c) {
                echo '<tr><td>' . $h($c['created_at'] ?? '') . '</td><td>' . $h($c['op'] ?? '') . '</td><td>'
                    . $h(($c['client_id'] ?? 0) ?: '') . '</td><td>' . $h(($c['service_id'] ?? 0) ?: '') . '</td><td>'
                    . $h($c['ip'] ?? '') . '</td><td>' . $h($c['result'] ?? '') . '</td><td>'
                    . $h($c['http_status'] ?? '') . '</td><td>' . $h($c['duration_ms'] ?? '') . '</td></tr>';
            }
            echo '</tbody></table>';
        }

        echo '<h2>Rotate secret</h2>'
            . '<p>Generates a new random 64-character secret, saves it, and shows it once on this page. '
            . 'The portal stops working until its <code>BRIDGE_SECRET</code> is updated.</p>'
            . '<form method="post" action="' . $h($link) . '">'
            . '<input type="hidden" name="token" value="' . $h($this->csrfToken()) . '">'
            . '<input type="hidden" name="snbd_bridge_action" value="rotate">'
            . '<label style="font-weight:normal"><input type="checkbox" name="confirm_rotate" value="yes"> '
            . 'I understand the current secret stops working immediately.</label><br>'
            . '<button type="submit" class="btn btn-danger" style="margin-top:8px">Rotate secret</button>'
            . '</form>';
        echo '</div>';
    }

    private function csrfToken(): string
    {
        return function_exists('generate_token') ? (string) \call_user_func('generate_token', 'plain') : '';
    }

    private function csrfValid(): bool
    {
        if (!function_exists('check_token')) {
            return false;
        }
        try {
            \call_user_func('check_token', 'WHMCS.admin.default');
            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }
}
