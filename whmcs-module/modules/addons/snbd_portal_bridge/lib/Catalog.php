<?php

declare(strict_types=1);

namespace SnbdPortalBridge;

/**
 * Static contract data: module kinds, action whitelists, SSO apps, batch whitelist.
 */
final class Catalog
{
    public const KINDS = [
        'cpanel' => 'hosting',
        'snbd_n8n' => 'n8n',
        'openclaw_n8n' => 'n8n',
        'hermesagent' => 'hermes',
        'ArkHostHetznerVPS' => 'vps',
        'pvewhmcs' => 'vps',
        'puqProxmoxKVM' => 'vps',
        'snbdpanel' => 'vps',
    ];

    /**
     * Per-module whitelist. via:
     *   call      — WHMCS\Module\Server::call(fn); the module returns 'success' or an error string
     *   <handler> — a bridge handler in Actions that uses the module's helpers instead, because
     *               the module function echoes/redirects and exits, or needs a browser session
     * requires: module function (without prefix) that must exist for the action to be listed.
     */
    public const ACTIONS = [
        'openclaw_n8n' => [
            'ClientStart' => ['label' => 'Start', 'via' => 'call', 'done' => 'Started'],
            'ClientStop' => ['label' => 'Stop', 'via' => 'call', 'confirm' => true, 'done' => 'Stopped'],
            'ClientRestart' => ['label' => 'Restart', 'via' => 'call', 'done' => 'Restarted'],
            'ClientReinstall' => ['label' => 'Reinstall', 'via' => 'call', 'confirm' => true, 'danger' => true, 'done' => 'Reinstall started'],
        ],
        'snbd_n8n' => [
            'start' => ['label' => 'Start', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'done' => 'Started'],
            'restart' => ['label' => 'Restart', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'done' => 'Restarted'],
            'stop' => ['label' => 'Stop', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'confirm' => true, 'done' => 'Stopped'],
            'upgrade' => ['label' => 'Upgrade n8n', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'confirm' => true, 'done' => 'Upgrade started'],
            'get_disk' => ['label' => 'Disk usage', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'done' => 'Disk usage measured'],
            'get_env' => ['label' => 'View environment', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'done' => 'Environment loaded'],
            'save_env' => ['label' => 'Save environment', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'confirm' => true, 'done' => 'Environment saved'],
            'change_password' => ['label' => 'Change owner password', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'confirm' => true, 'done' => 'Password changed'],
            'reset_users' => ['label' => 'Reset users', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'confirm' => true, 'danger' => true, 'done' => 'Users reset'],
            'reset_data' => ['label' => 'Reset all data', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'confirm' => true, 'danger' => true, 'done' => 'Data reset'],
            'get_ws_token' => ['label' => 'Live session token', 'via' => 'n8n', 'requires' => 'handleClientAjax', 'done' => 'Token issued'],
        ],
        'hermesagent' => [
            'restart' => ['label' => 'Restart Agent', 'via' => 'call', 'done' => 'Restarted'],
            'viewlogs' => ['label' => 'View Logs', 'via' => 'hermes_logs', 'requires' => 'viewlogs', 'done' => 'Logs loaded'],
            'regenpassword' => ['label' => 'Regenerate Password', 'via' => 'hermes_password', 'requires' => 'ChangePassword', 'done' => 'Password regenerated'],
            'downloadbackup' => ['label' => 'Download Agent Brain', 'via' => 'hermes_backup', 'requires' => 'get_ssh_client', 'done' => 'Backup ready'],
            'healthcheck' => ['label' => 'Health Check', 'via' => 'hermes_health', 'requires' => 'healthcheck', 'done' => 'Health check complete'],
            'redeploy' => ['label' => 'Redeploy', 'via' => 'call', 'confirm' => true, 'danger' => true, 'done' => 'Redeploy started'],
            'killswitch' => ['label' => 'Kill Switch', 'via' => 'call', 'confirm' => true, 'danger' => true, 'done' => 'Agent wiped'],
        ],
        'ArkHostHetznerVPS' => [
            'Start' => ['label' => 'Start', 'via' => 'call', 'done' => 'Started'],
            'Stop' => ['label' => 'Stop', 'via' => 'call', 'confirm' => true, 'done' => 'Stopped'],
            'Reboot' => ['label' => 'Restart', 'via' => 'call', 'done' => 'Restarted'],
            'VNC' => ['label' => 'VNC Console', 'via' => 'hetzner_vnc', 'requires' => 'API', 'done' => 'Console ready'],
        ],
        'pvewhmcs' => [
            'vmStart' => ['label' => 'Start', 'via' => 'call', 'done' => 'Started'],
            'vmReboot' => ['label' => 'Reboot', 'via' => 'call', 'done' => 'Restarted'],
            'vmShutdown' => ['label' => 'Power Off', 'via' => 'call', 'confirm' => true, 'done' => 'Shutting down'],
            'vmStop' => ['label' => 'Hard Stop', 'via' => 'call', 'confirm' => true, 'danger' => true, 'done' => 'Stopped'],
            'noVNC' => ['label' => 'noVNC Console', 'via' => 'pve_novnc', 'requires' => 'noVNC', 'done' => 'Console ready'],
        ],
        'snbdpanel' => [
            'resetpassword' => ['label' => 'Reset panel password', 'via' => 'snbdpanel_password', 'requires' => 'resetpassword', 'confirm' => false, 'done' => 'Password reset'],
        ],
        'cpanel' => [],
    ];

    /** Module whose whitelist is read at runtime from its own button arrays. */
    public const RUNTIME_WHITELIST = 'puqProxmoxKVM';

    /** Runtime-whitelisted function names that need confirm. */
    public const RUNTIME_CONFIRM = '/stop|shutdown|off|reinstall|rebuild|reset|restore|delete|remove|destroy|terminate|wipe|format|kill/i';
    public const RUNTIME_DANGER = '/reinstall|rebuild|restore|delete|remove|destroy|terminate|wipe|format|kill/i';

    public const CPANEL_SSO_APPS = [
        '' => 'cPanel',
        'Email_Webmail' => 'Webmail',
        'Email_Accounts' => 'Email Accounts',
        'FileManager_Home' => 'File Manager',
        'Database_MySQL' => 'MySQL Databases',
        'Database_phpMyAdmin' => 'phpMyAdmin',
        'Backups_Home' => 'Backups',
        'SSL_TLS_Status' => 'SSL/TLS Status',
        'Domains_Home' => 'Domains',
        'WordPress_Manager' => 'WordPress Manager',
    ];

    /** Batch actions scoped to the caller: clientid and userid are forced to clientId. */
    public const BATCH_CLIENT = [
        'GetClientsDetails', 'GetClientsProducts', 'GetClientsDomains', 'GetClientsAddons',
        'GetInvoices', 'GetSupportTickets', 'GetQuotes', 'GetEmails', 'GetContacts',
        'GetTransactions', 'GetOrders', 'GetCredits',
    ];

    /** Object lookups: the record must belong to clientId. */
    public const BATCH_OBJECT = [
        'GetInvoice' => 'invoice',
        'GetSupportTicket' => 'ticket',
        'GetTicketNotes' => 'ticket',
    ];

    public const BATCH_GLOBAL = [
        'GetAnnouncements', 'GetKBArticles', 'GetSupportDepartments', 'GetPaymentMethods',
        'GetCurrencies', 'GetProducts', 'GetTLDPricing', 'GetServers',
    ];

    /** Params that would let a client-scoped call select another client. */
    public const BATCH_STRIP = ['email', 'client_id', 'user_id', 'clientemail'];

    public static function kind(string $module): string
    {
        return self::KINDS[$module] ?? 'generic';
    }

    /** Canonical batch action name (case-insensitive match), or null when not whitelisted. */
    public static function batchAction(string $action): ?string
    {
        foreach (array_merge(self::BATCH_CLIENT, array_keys(self::BATCH_OBJECT), self::BATCH_GLOBAL) as $name) {
            if (strcasecmp($name, $action) === 0) {
                return $name;
            }
        }
        return null;
    }
}
