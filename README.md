# Secure-Cloud

Current monitoring and infrastructure: [monitoring/README.md](monitoring/README.md). Compose includes Prometheus, Grafana, Loki, Alloy, host/container/service exporters and the existing databases. The installer starts only the application and databases. To enable monitoring and Grafana at `/grafana/`, complete the separate monitoring setup.

## One-command installation on Ubuntu

Download or clone this repository, open its directory, and run:

```bash
bash install.sh
```

For a new Ubuntu server with no checkout, run the same installer directly from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/Aneeb-Kashif2/private-cloud/main/install.sh | bash
```

This bootstrap installs Git if needed, clones the selected revision into `/opt/secure-cloud`, and runs the installer there. Set `SECURE_CLOUD_DIR` to choose another directory or `SECURE_CLOUD_REF` to select a tag/branch. The repository URL can be overridden with `SECURE_CLOUD_REPO` for a private mirror; private repositories must already be accessible to Git on the server.

The command contains no application credentials. The repository URL must never include a password or token; the installer rejects URLs containing embedded credentials. Fresh-install secrets are generated locally with the operating system's secure random source and written only to mode-`0600` files on the server. Existing `.env` files are read locally and never printed. For a private repository, authenticate Git on the server first (for example with a deploy key or credential helper), then set `SECURE_CLOUD_REPO` to a URL without credentials.

Open **http://localhost:8080** after the installer reports success. It asks for your Ubuntu sudo password when needed, installs missing Docker/Compose, Git, curl and Python 3, prepares local storage, generates random authentication/database secrets for a fresh installation, builds the application, runs Prisma migrations, and waits for container health checks. Node.js is built inside Docker; you do not need to install it on the host. Internet access and available ports 3000, 4000, 4001, 5432, 6379, 8080 and 8082 are required. Missing Docker is installed using [Docker's official Ubuntu repository](https://docs.docker.com/engine/install/ubuntu/).

This command installs the **single Ubuntu host** deployment. The separate [EC2/Ubuntu production deployment](deploy/SPLIT_DEPLOYMENT.md) still requires its documented Tailscale, named Cloudflare Tunnel and HTTPS setup. The installer does not provision AWS or a public domain. Fresh installations allow explicit localhost browser origins; configure your HTTPS `FRONTEND_ORIGIN` for remote access.

Existing `.env`, `backend/.env`, database/Redis volumes, storage files and permissions are preserved. Missing configuration files are created with mode `0600`; a new `/srv/secure-cloud-storage` directory uses `0700` and the Compose application's UID/GID (1000 by default). Existing installations with missing credentials or conflicting configuration stop with an error instead of resetting anything. `APP_ENV_FILE`, `MONITORING_RUNTIME_DIR`, `APP_UID` and `APP_GID` can be configured in the root `.env`. Back up existing data before upgrades: applying database migrations may change its schema.

```bash
bash install.sh --status       # Container status, including stopped migration jobs
bash install.sh --update       # Rebuild the checked-out source, migrate, and restart
bash install.sh --uninstall    # Explicit confirmation; removes app/database containers only
```

`--update` does not fetch or overwrite source code: pull your desired revision first. Uninstall retains uploaded files, all persistent volumes, configuration, Docker and any monitoring services. Running the installer again reuses those volumes. It never runs `down -v` or deletes user data.

If startup fails, inspect `docker compose ps -a` and `docker compose logs --tail=100 migrate backend frontend nginx`. Prefix Docker commands with `sudo` if your account cannot access Docker. Fix the reported configuration, port or permission issue and rerun `bash install.sh`. Legacy database containers managed by a different Compose project must be adopted using the existing [monitoring setup](monitoring/README.md); the installer does not remove conflicting containers.

Next.js frontend, Fastify API, PostgreSQL/Prisma metadata and Redis sessions/cache. The Ubuntu laptop running the API is the storage server. File bytes stream to and from `/srv/secure-cloud-storage`; PostgreSQL stores only metadata, authentication and quota counters.

For container deployment and the CI/CD pipeline, see [Docker and GitHub Actions setup](deploy/README.md). Docker runs the application on this same Ubuntu server and bind-mounts the existing storage directory.

For the full configured infrastructure, ports, persistence and request flows (updated 12 September 2026), see [Current architecture and flow](CURRENT_ARCHITECTURE_AND_FLOW.md).

For the production two-machine topology, see [split EC2/Ubuntu deployment](deploy/SPLIT_DEPLOYMENT.md). The browser uses same-origin `/api`; EC2 Nginx sends private API traffic over Tailscale to Ubuntu. The older [Quick Tunnel setup](deploy/NGINX_CLOUDFLARE.md) is for development/legacy operation only.

The optional AWS edge VPC/EC2/IAM/CloudWatch Terraform is documented in [infra/README.md](infra/README.md). It provisions only the EC2 frontend edge; PostgreSQL, Redis, Fastify and `/srv/secure-cloud-storage` remain on Ubuntu.

## Current runtime and access

The configured topology below includes the application and databases; monitoring and WhatsApp are covered in the [full architecture](CURRENT_ARCHITECTURE_AND_FLOW.md). Use the installer above for a single-host installation, or the split deployment guide for the production two-machine topology.

| Service | Current runtime | Port / storage |
| --- | --- | --- |
| Nginx | `secure-cloud-nginx-1` | 8080: routes pages and `/api` |
| Next.js | `secure-cloud-frontend-1` | 3000: production standalone frontend |
| Fastify | `secure-cloud-backend-1` | 4000: production API |
| Migrations | `secure-cloud-migrate-1` | One-shot Prisma job, exit 0 |
| PostgreSQL | `self-cloud-prj-postgres-1` | Localhost-only port 5432; existing named database volume |
| Redis | `self-cloud-prj-redis-1` | Localhost-only port 6379; existing named cache volume |
| Uploaded files | Ubuntu filesystem bind-mounted into backend | `/srv/secure-cloud-storage` |

The current Compose project manages the app, proxy, databases and monitoring. Complete the one-time [monitoring setup](monitoring/README.md) to adopt the original database containers and preserve their volumes.

```bash
# From the repository root; uses backend/.env by default.
docker compose ps -a
bash install.sh --update

# Production uses the split EC2/Ubuntu deployment documented below.
# The legacy single-host stack can still be checked locally at http://localhost:8080.
```

For production, follow [split EC2/Ubuntu deployment](deploy/SPLIT_DEPLOYMENT.md): a named Cloudflare Tunnel terminates at EC2 Nginx, while `/api/*` travels over Tailscale to Ubuntu Nginx and Fastify. The browser remains same-origin and the backend uses an explicit `FRONTEND_ORIGIN`. Quick Tunnel commands are retained only for development/legacy use.

Do not also start `npm run dev` while the app containers own ports 3000/4000. To use development mode instead, stop the application containers with `docker compose stop nginx frontend backend`, keep the Compose PostgreSQL/Redis services running, install workspace dependencies, and run:

```bash
npm ci
npm run dev
```

Development uses Next.js on port 3000 with an `/api` rewrite to Fastify. Backend development startup runs migrations and generates Prisma before starting its watcher. For a fresh Ubuntu installation or GitHub-based deployment, follow [deployment setup](deploy/README.md) and configure the database/cache connections rather than creating a second empty database for existing files.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL |
| `REDIS_URL` | Redis connection URL |
| `AUTH_SECRET` | At least 32 random characters |
| `FRONTEND_ORIGIN` | `*` for any HTTP(S) origin, or comma-separated allowed origins |
| `NEXT_PUBLIC_API_URL` | `/api` for Nginx and mobile/tunnel access |
| `PORT` | API port, default 4000 |
| `STORAGE_PATH` | Absolute directory, default `/srv/secure-cloud-storage` |
| `STORAGE_LIMIT_BYTES` | Required per-user quota: `5368709120` (5 GiB) |
| `MAX_FILE_SIZE_BYTES` | Maximum single upload, default 5 GiB |
| `CACHE_TTL_SECONDS` | Metadata cache lifetime |
| `SESSION_TTL_DAYS` | Session lifetime |

All deployed accounts receive the 5 GiB limit during migration, including existing users. Accounts already over quota retain their metadata but cannot upload until usage is reduced. The upload quota check always uses current PostgreSQL counters, never cached session data.

Docker startup uses a separate migration service before the API starts. Host-based backend commands also apply pending Prisma migrations before `npm run dev` and `npm start`. Development also regenerates the Prisma client. Startup stops if migration fails, preventing the API from serving requests against an outdated schema.

## File workflow

- `POST /api/files/upload?filename=...&size=...&mimeType=...&folderId=...`: authenticated binary body with `Content-Type: application/octet-stream`. The API reserves quota atomically, streams bytes to a private UUID filename, verifies the exact byte count, then commits file metadata and moves reserved bytes to `storageUsed` in one transaction. Empty files are supported. Failed or disconnected uploads remove partial files and release reservations.
- `GET /api/files/:id/download`: authenticated attachment stream. Ownership is checked before opening content.
- `GET /api/files`: owner-scoped listing, search, MIME filter, sorting and pagination.
- Folder routes and file moves use PostgreSQL metadata; folder names never become disk paths.
- `DELETE /api/files/:id`: removes file content permanently, then transactionally deletes metadata and decrements usage once. Missing content allows deletion to be retried; other filesystem failures retain metadata and quota.

New files have mode `0600`. The adapter requests `0700` when creating its root directory, but the current existing directory is `0755`; it does not automatically tighten existing permissions. Only generated UUID keys are accepted, file creation is exclusive, and symlinks are not followed. User filenames appear only in metadata and encoded download headers.

## Existing installations and recovery

Back up PostgreSQL and existing file content before deploying. Historical SQL migrations remain unchanged so Prisma migration checksums stay valid; the new migration renames the storage-key column, removes obsolete upload intents, clears old reservations and sets the quota. It does not fetch or move historical content. Before resuming service, place each existing file's bytes at `/srv/secure-cloud-storage/<file UUID>` and update its `storageKey` to that UUID. Confirm bytes and sizes from your existing export/backup. Do not deploy against existing remote-only files without completing that transfer.

Filesystem operations and database transactions cannot commit together. After a forced process termination or database outage, stop every API process before maintenance: reconcile disk files with metadata, remove orphan UUID files, and reset `storageReserved` to zero. Run `npm run prisma:recalculate --workspace backend` while the API is stopped to rebuild usage from metadata. A delete whose database commit failed can be retried. Back up the storage directory and PostgreSQL together. Do not manually alter content while the API runs.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

The suite contains 35 tests, including filesystem/config, CORS, observability and database integration coverage. Filesystem and CORS tests run without a live database. Integration tests require an explicit **disposable** `TEST_DATABASE_URL`; they clear that test database's application tables. They never fall back to your application database.

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:deploy --workspace backend
npm test
```

Integration coverage includes authentication, ownership, upload/download bytes, quota concurrency, failed-upload cleanup and permanent-delete accounting.

Development uses `frontend/.next-dev`; production builds use `frontend/.next`. Keeping these separate prevents missing vendor chunks when building while the dev server runs.

Monitoring implementation and deployment status: [monitoring/IMPLEMENTATION_STATUS.md](monitoring/IMPLEMENTATION_STATUS.md). This records what is implemented, what was observed running, and the remaining runtime work.

WhatsApp tunnel notifications: [setup, template requirements and retry commands](deploy/WHATSAPP.md).

## Backups and recovery

Back up PostgreSQL and local file bytes together with a brief backend maintenance
window. Existing volumes, `.env` files and user data are preserved. Restore requires
interactive confirmation and retains recovery copies.

```bash
sudo bash scripts/backup.sh
sudo bash scripts/verify-backup.sh /srv/secure-cloud-backups/<backup-directory>
sudo bash scripts/restore.sh /srv/secure-cloud-backups/<backup-directory>
```

See [backup and restore operations](deploy/BACKUP_RESTORE.md) for retention,
permissions, manifest/checksum verification, failure recovery, daily systemd
scheduling and backup metrics. Scheduling is supplied but not enabled automatically.

### Download a personal file backup

On the home dashboard or Files page, click **Back up files**, select the files you
want (up to 100 per archive), then click **Download backup**. Your browser downloads
a ZIP containing those files and a SHA-256 manifest. Selections can span folders
and pages. See [backup operations](deploy/BACKUP_RESTORE.md#download-selected-files-from-the-home-screen)
for extraction, limits, and the separate administrator restore workflow.
