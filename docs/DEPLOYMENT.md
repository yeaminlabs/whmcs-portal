# Production deployment

The repository is now the only release source. Coding agents are responsible
for committing and pushing completed work to GitHub `main`. The deployer does
not copy local files and does not push code; it only runs
`scripts/deploy-from-github.sh`, which clones the latest GitHub commit and
updates production.

This is the ownership rule for every change: the agent that codes a feature or
fix must commit and push it to `main`. The deployer is an operator only; it
must never upload an uncommitted local checkout or push on another agent's
behalf.

On the production server, one command deploys the latest `main`:

```bash
curl -fsSL https://raw.githubusercontent.com/yeaminlabs/whmcs-portal/main/scripts/deploy-from-github.sh | sudo bash
```

That bootstrap needs no local checkout, so it works even when production has no
copy of the script yet. When a checkout is already present, this is equivalent:

```bash
cd /opt/whmcs-portal-new
sudo bash scripts/deploy-from-github.sh
```

The command updates the Node portal and the WHMCS bridge addon, installs the
locked dependencies, builds the optional client bundle, restarts
`whmcs-portal.service`, and checks the login endpoint. It preserves production
`.env`, `data/`, `node_modules/`, and writes the deployed commit to
`REVISION`. It also creates a code-only rollback archive under
`/var/backups/whmcs-portal` when run as root.

Before changing production, it resolves the current `origin/main` commit with
GitHub, clones that exact branch tip, verifies the cloned SHA matches, and
serializes concurrent runs with a lock file. No local source files are used.

Use `bash scripts/deploy-from-github.sh --dry-run` to inspect the operations.
The paths and health URL can be overridden with `APP_DIR`, `MODULE_DIR`,
`SERVICE_NAME`, and `HEALTH_URL` when a server uses a different layout.
