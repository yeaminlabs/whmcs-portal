# Production deployment

The repository is now the only release source. Coding agents are responsible
for committing and pushing completed work to GitHub `main`. The deployer does
not copy local files and does not push code; it only runs
`scripts/deploy-from-github.sh`, which clones the latest GitHub commit and
updates production.

On the production server, run:

```bash
cd /opt/whmcs-portal-new
bash scripts/deploy-from-github.sh
```

The command updates the Node portal and the WHMCS bridge addon, installs the
locked dependencies, builds the optional client bundle, restarts
`whmcs-portal.service`, and checks the login endpoint. It preserves production
`.env`, `data/`, and `node_modules/`, and creates a code-only rollback archive
under `/var/backups/whmcs-portal` when run as root.

Use `bash scripts/deploy-from-github.sh --dry-run` to inspect the operations.
The paths and health URL can be overridden with `APP_DIR`, `MODULE_DIR`,
`SERVICE_NAME`, and `HEALTH_URL` when a server uses a different layout.
