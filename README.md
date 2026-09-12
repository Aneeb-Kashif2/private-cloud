# Secure-Cloud

Current monitoring and infrastructure: [monitoring/README.md](monitoring/README.md). Compose now includes Prometheus, Grafana, Loki, Alloy, host/container/service exporters and the existing databases (preserving their volumes). Grafana is served at `/grafana/`; monitoring and database ports bind only to localhost. Complete the documented one-time setup before starting this version.

Next.js frontend, Fastify API, PostgreSQL/Prisma metadata and Redis sessions/cache. The Ubuntu laptop running the API is the storage server. File bytes stream to and from `/srv/secure-cloud-storage`; PostgreSQL stores only metadata, authentication and quota counters.

For container deployment and the CI/CD pipeline, see [Docker and GitHub Actions setup](deploy/README.md). Docker runs the application on this same Ubuntu server and bind-mounts the existing storage directory.

For the full configured infrastructure, ports, persistence and request flows (updated 12 September 2026), see [Current architecture and flow](CURRENT_ARCHITECTURE_AND_FLOW.md).

For mobile access through Cloudflare, see [Nginx and Quick Tunnel setup](deploy/NGINX_CLOUDFLARE.md). The browser now uses same-origin `/api`; Nginx listens on port 8080.

## Current runtime and access

The configured topology below includes the application and databases; monitoring and WhatsApp are covered in the [full architecture](CURRENT_ARCHITECTURE_AND_FLOW.md). Current container health and public tunnel availability were not rechecked during the 12 September documentation update. There is no `install.sh` yet; complete the existing deployment/monitoring setup before starting Compose.

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
docker compose up -d --build --wait --wait-timeout 120

# Keep this command running for phone/public access.
cloudflared tunnel --url http://localhost:8080
```

Open the generated HTTPS URL on your phone and sign in. The browser uses `/api`, so it never tries to reach `localhost:4000` on the phone. `FRONTEND_ORIGIN=*` accepts valid HTTP(S) origins using credential-compatible origin reflection. Nginx routes `/api/*` to Fastify and other requests to Next.js. The native tunnel command is outside Compose; the optional `tunnel` profile provides a managed equivalent with centralized logs. Its temporary hostname changes across runs.

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
