# Secure-Cloud

Next.js frontend, Fastify API, PostgreSQL/Prisma metadata and Redis sessions/cache. The Ubuntu laptop running the API is the storage server. File bytes stream to and from `/srv/secure-cloud-storage`; PostgreSQL stores only metadata, authentication and quota counters.

## Ubuntu setup

Use Node.js 22+, npm, PostgreSQL and Redis installed directly on Ubuntu. No container or separate disk setup is needed.

```bash
sudo apt update
sudo apt install postgresql redis-server
sudo systemctl enable --now postgresql redis-server
# Run the application as this ordinary user; substitute your service account if needed.
sudo install -d -m 0700 -o "$(id -un)" -g "$(id -gn)" /srv/secure-cloud-storage
sudo -u postgres createuser --pwprompt selfcloud
sudo -u postgres createdb --owner=selfcloud selfcloud
cp .env.example .env
# Set DATABASE_URL, AUTH_SECRET and your browser-facing origins/URLs.
cp .env backend/.env
npm ci
npm run prisma:generate --workspace backend
npm run prisma:deploy --workspace backend
npm run dev
```

Set `frontend/.env.local` to `NEXT_PUBLIC_API_URL=http://localhost:4000/api` for local development, or the API URL reachable from your client devices. Open port 3000 in the browser. In production, build with that URL configured, then run `npm start --workspace backend` and `npm start --workspace frontend` under your service manager. Use HTTPS with a reverse proxy; keep PostgreSQL and Redis private. The proxy must allow 5 GiB request bodies and sufficiently long streaming requests, with upload buffering disabled. Do not serve the storage directory as a static directory.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL |
| `REDIS_URL` | Redis connection URL |
| `AUTH_SECRET` | At least 32 random characters |
| `FRONTEND_ORIGIN` | Comma-separated allowed browser origins |
| `NEXT_PUBLIC_API_URL` | Browser-accessible API URL ending in `/api` |
| `PORT` | API port, default 4000 |
| `STORAGE_PATH` | Absolute directory, default `/srv/secure-cloud-storage` |
| `STORAGE_LIMIT_BYTES` | Required per-user quota: `5368709120` (5 GiB) |
| `MAX_FILE_SIZE_BYTES` | Maximum single upload, default 5 GiB |
| `CACHE_TTL_SECONDS` | Metadata cache lifetime |
| `SESSION_TTL_DAYS` | Session lifetime |

All deployed accounts receive the 5 GiB limit during migration, including existing users. Accounts already over quota retain their metadata but cannot upload until usage is reduced. The upload quota check always uses current PostgreSQL counters, never cached session data.

The backend automatically applies pending Prisma migrations before `npm run dev` and `npm start`. Development also regenerates the Prisma client. Startup stops if migration fails, preventing the API from serving requests against an outdated schema.

## File workflow

- `POST /api/files/upload?filename=...&size=...&mimeType=...&folderId=...`: authenticated binary body with `Content-Type: application/octet-stream`. The API reserves quota atomically, streams bytes to a private UUID filename, verifies the exact byte count, then commits file metadata and moves reserved bytes to `storageUsed` in one transaction. Empty files are supported. Failed or disconnected uploads remove partial files and release reservations.
- `GET /api/files/:id/download`: authenticated attachment stream. Ownership is checked before opening content.
- `GET /api/files`: owner-scoped listing, search, MIME filter, sorting and pagination.
- Folder routes and file moves use PostgreSQL metadata; folder names never become disk paths.
- `DELETE /api/files/:id`: removes file content permanently, then transactionally deletes metadata and decrements usage once. Missing content allows deletion to be retried; other filesystem failures retain metadata and quota.

Files have mode `0600` inside a private directory. Only generated UUID keys are accepted, file creation is exclusive, and symlinks are not followed. User filenames appear only in metadata and encoded download headers.

## Existing installations and recovery

Back up PostgreSQL and existing file content before deploying. Historical SQL migrations remain unchanged so Prisma migration checksums stay valid; the new migration renames the storage-key column, removes obsolete upload intents, clears old reservations and sets the quota. It does not fetch or move historical content. Before resuming service, place each existing file's bytes at `/srv/secure-cloud-storage/<file UUID>` and update its `storageKey` to that UUID. Confirm bytes and sizes from your existing export/backup. Do not deploy against existing remote-only files without completing that transfer.

Filesystem operations and database transactions cannot commit together. After a forced process termination or database outage, stop every API process before maintenance: reconcile disk files with metadata, remove orphan UUID files, and reset `storageReserved` to zero. Run `npm run prisma:recalculate --workspace backend` while the API is stopped to rebuild usage from metadata. A delete whose database commit failed can be retried. Back up the storage directory and PostgreSQL together. Do not manually alter content while the API runs.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

Filesystem tests run without services. Integration tests require an explicit **disposable** `TEST_DATABASE_URL`; they clear that test database's application tables. They never fall back to your application database.

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:deploy --workspace backend
npm test
```

Integration coverage includes authentication, ownership, upload/download bytes, quota concurrency, failed-upload cleanup and permanent-delete accounting.

Development uses `frontend/.next-dev`; production builds use `frontend/.next`. Keeping these separate prevents missing vendor chunks when building while the dev server runs.
