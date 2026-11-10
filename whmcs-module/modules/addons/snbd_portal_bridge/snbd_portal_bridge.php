<?php
/**
 * SNBD Portal Bridge — WHMCS addon module.
 *
 * Lets the SNBD client portal (portal.bysnbdhost.top) run whitelisted server-module functions
 * and read client data over a signed JSON endpoint (bridge.php).
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/lib/autoload.php';

use SnbdPortalBridge\AdminPage;
use SnbdPortalBridge\CapsuleStore;

function snbd_portal_bridge_config(): array
{
    return [
        'name' => 'SNBD Portal Bridge',
        'description' => 'Signed JSON bridge for the SNBD client portal: client data, service panels, '
            . 'whitelisted module actions and single sign-on, without sending customers to WHMCS.',
        'version' => '1.0.0',
        'author' => 'SNBD HOST',
        'language' => 'english',
        'fields' => [
            'shared_secret' => [
                'FriendlyName' => 'Shared secret',
                'Type' => 'password',
                'Size' => '70',
                'Description' => 'HMAC secret shared with the portal (BRIDGE_SECRET), at least 32 characters. '
                    . 'Use "Rotate secret" on the addon page to generate one.',
            ],
            'allowed_ips' => [
                'FriendlyName' => 'Allowed IPs',
                'Type' => 'text',
                'Size' => '70',
                'Description' => 'Optional. Comma separated IPs or CIDR ranges of the portal server. '
                    . 'Matched against CF-Connecting-IP when present, otherwise REMOTE_ADDR. Empty = any IP.',
            ],
        ],
    ];
}

function snbd_portal_bridge_activate(): array
{
    try {
        CapsuleStore::createTables();
        return ['status' => 'success', 'description' => 'SNBD Portal Bridge activated.'];
    } catch (\Throwable $e) {
        return ['status' => 'error', 'description' => 'Could not create the bridge tables: ' . $e->getMessage()];
    }
}

function snbd_portal_bridge_deactivate(): array
{
    try {
        CapsuleStore::dropTables();
        return ['status' => 'success', 'description' => 'SNBD Portal Bridge deactivated. The bridge endpoint now rejects every request.'];
    } catch (\Throwable $e) {
        return ['status' => 'error', 'description' => 'Could not drop the bridge tables: ' . $e->getMessage()];
    }
}

function snbd_portal_bridge_output(array $vars): void
{
    (new AdminPage(new CapsuleStore()))->render($vars);
}
