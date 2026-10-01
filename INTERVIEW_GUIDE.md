# Secure Cloud — End-to-End Interview Guide (plain and simple)

> Everything in this file was written by reading the actual code in this repository,
> not from memory. Line references are given so you can jump to the source live during
> an interview.

**Companion documents**

| Document | Use it for |
|---|---|
| `DEVOPS_UPGRADE_PLAN.md` | A DevOps maturity audit with scores, plus a prioritised roadmap of what to add next and the interview question each addition unlocks |
| `deploy/RUNBOOKS.md` | One runbook per alert — meaning, impact, first commands, diagnosis, remediation, and the signal that clears it |
| `CURRENT_ARCHITECTURE_AND_FLOW.md` | The exhaustive technical reference: ports, volumes, environment map, monitoring data flow |
| `SECURITY.md` | Vulnerability disclosure policy and a single-table inventory of every security control |

---

## Table of contents

1. [The 60-second pitch (say this first)](#1-the-60-second-pitch-say-this-first)
2. [Resume / CV bullets you can copy](#2-resume--cv-bullets-you-can-copy)
3. [What the project actually is](#3-what-the-project-actually-is)
4. [Tech stack and why each piece is there](#4-tech-stack-and-why-each-piece-is-there)
5. [The big picture (architecture in one diagram)](#5-the-big-picture-architecture-in-one-diagram)
6. [Repository map — what lives where](#6-repository-map--what-lives-where)
7. [End-to-end flows, step by step](#7-end-to-end-flows-step-by-step)
8. [Database design (5 tables)](#8-database-design-5-tables)
9. [Caching with Redis](#9-caching-with-redis)
10. [The star feature: quota that cannot be cheated](#10-the-star-feature-quota-that-cannot-be-cheated)
11. [Security: the full list of protections](#11-security-the-full-list-of-protections)
12. [Observability and monitoring](#12-observability-and-monitoring)
13. [Deployment: three ways it can run](#13-deployment-three-ways-it-can-run)
14. [CI/CD pipeline](#14-cicd-pipeline)
15. [Backup and restore](#15-backup-and-restore)
16. [Testing](#16-testing)
17. [Environment variables cheat sheet](#17-environment-variables-cheat-sheet)
18. [How to run it yourself (copy-paste)](#18-how-to-run-it-yourself-copy-paste)
19. [Known limitations — say these before they ask](#19-known-limitations--say-these-before-they-ask)
20. [Interview questions and model answers](#20-interview-questions-and-model-answers)
21. [Numbers cheat sheet (memorise these)](#21-numbers-cheat-sheet-memorise-these)
22. [Live code-walkthrough script](#22-live-code-walkthrough-script)

---

## 1. The 60-second pitch (say this first)

> "Secure Cloud is my self-hosted private file storage system — basically my own small
> Google Drive. A user signs up, gets 5 GiB of space, and can create folders, upload
> files, search, download, delete, and create expiring public share links.
>
> The frontend is **Next.js 15 (App Router)** with React 19 and Tailwind 4. The backend
> is **Fastify 5 in TypeScript**, with **Prisma + PostgreSQL** for all metadata —
> users, sessions, folders, files and share links. The actual file bytes never go into
> the database; they are streamed straight to disk under `/srv/secure-cloud-storage`
> using a random UUID name. **Redis** handles session and metadata caching plus rate
> limiting.
>
> The part I am proudest of is quota accounting. Uploads reserve space with a single
> atomic SQL `UPDATE ... WHERE` condition, so two simultaneous uploads can never both
> spend the same free space. Then the bytes are streamed to an exclusive file, the exact
> size is verified, and only then is metadata committed in a transaction. If anything
> fails, the partial file is removed and the reservation is released.
>
> Around the app I built the operations story: Nginx in front, Docker Compose, a
> one-command Ubuntu installer, a GitHub Actions pipeline that builds, tests, smoke
> tests real containers and publishes images, a Prometheus/Grafana/Loki monitoring
> stack that is privacy-filtered, Terraform for an AWS EC2 edge in a split deployment,
> and coordinated database + filesystem backup and restore scripts."

**If they only have 15 seconds:** "It's a self-hosted private cloud storage app:
Next.js + Fastify + PostgreSQL + Redis + local disk, with atomic quota reservation so
concurrent uploads can't overspend storage."

---

## 2. Resume / CV bullets you can copy

- Built a full-stack self-hosted cloud storage platform (**Next.js 15, React 19,
  Fastify 5, TypeScript, Prisma, PostgreSQL, Redis, Docker, Nginx**).
- Designed **leak-proof quota accounting**: atomic SQL reservation
  (`storageUsed + storageReserved + size <= limit`) plus transactional commit/rollback,
  proven by concurrency tests where two parallel 5 GiB uploads yield exactly one `201`
  and one `413`.
- Implemented secure storage I/O: UUID-only paths, `O_EXCL` + `O_NOFOLLOW`, mode `0600`,
  streamed byte counting with exact-size verification and automatic cleanup.
- Built **Argon2id auth with opaque HttpOnly session cookies**, SHA-256-hashed session
  tokens in PostgreSQL, a Redis session cache and per-route rate limits.
- Implemented **expiring public share links** that store only a SHA-256 token hash,
  with atomic download-limit claiming and owner revocation.
- Streamed ZIP64 exports with a per-file SHA-256 manifest for user backups.
- Built a privacy-first observability stack (**Prometheus, Grafana, Loki, Alloy,
  cAdvisor, exporters**) where no user ID, filename, URL or token ever becomes a metric
  label or log field.
- Automated delivery with **GitHub Actions** (typecheck → lint → 37 tests → build →
  container smoke test → immutable GHCR image digests → gated self-hosted deploy)
  and **Terraform** for an AWS EC2 edge in a split EC2 + Ubuntu topology.
- Wrote a one-command, idempotent **Ubuntu installer** with `--status/--update/--uninstall`
  that generates secrets locally, preserves existing data and health-checks startup.

### 2.1 DevOps standards this project actually implements

Paste this table into a CV or a portfolio README. Every row is verifiable in the repository —
none of it is aspirational.

| Capability | Implementation |
|---|---|
| CI | GitHub Actions: typecheck, lint, 37 tests, production build, monitoring-config validation |
| Security scanning | Gitleaks over full git history, Trivy filesystem scan, `npm audit`, and a **gating** Trivy image scan on CRITICAL CVEs |
| Supply chain | Images built once, smoke-tested in real containers, published and deployed by **immutable digest**, plus a CycloneDX SBOM per image |
| Infrastructure as code | Terraform (VPC, EC2 edge, IAM/SSM, security group) with `fmt`, `validate`, `tflint`, `checkov`, an OIDC plan and weekly **drift detection** |
| Containers | Multi-stage builds, non-root user, `cap_drop: [ALL]`, `no-new-privileges`, healthchecks, 5 MB × 2 log rotation |
| CD | Build → container smoke test → environment-gated deploy of the tested digest; writers stopped and migrations run before the API restarts |
| Observability | Prometheus, Grafana, Loki, Alloy, cAdvisor, four exporters — privacy-filtered, retention-bounded, loopback-only |
| Alerting | Alertmanager with routing, grouping and inhibition; rule files **unit tested with promtool** |
| Reliability | SLOs (99.5% availability, 99% upload success) with error budgets and multi-window burn-rate alerts |
| Incident response | A 7-part runbook per alert in `deploy/RUNBOOKS.md`, with an escalation policy |
| Data protection | Coordinated PostgreSQL + filesystem backup, root-owned `0700` directories, manifest and checksum verification, traversal-rejecting archive validation |
| DevEx | One-command idempotent installer, a `make` interface with 32 targets, `.nvmrc`, `.editorconfig` |
| Governance | `CODEOWNERS` area ownership, a PR template that encodes the project's invariants, issue templates, and a vulnerability disclosure policy |

**One line to say about it:** *"The pipeline is the part I care about most: I deploy the exact
image digest that passed a container smoke test, the schema migration runs before the API comes
back up, and every alert has a runbook — so the delivery path is as tested as the code."*

---

## 3. What the project actually is

**One line:** a private, self-hosted "Drive" that one person (or a small team) runs on
their own machine or cloud VM and reaches from a phone or laptop.

**Who uses it:** someone who does not want their files sitting in someone else's cloud.
Access is over HTTPS through a Cloudflare tunnel, or over the local network.

**What a user can do:**

| Feature | Detail |
|---|---|
| Register / login / logout | Argon2id passwords, opaque session cookie |
| Storage quota | 5 GiB (`5368709120` bytes) per user, enforced atomically |
| Folders | Logical tree in PostgreSQL (no real directories on disk), root folder "My Files" |
| Upload | Drag-and-drop or file picker, multi-file, live progress bar |
| Browse | Search, filter by type (image/video/audio/document/archive), sort, paginate, list/grid view |
| Download | Streamed from disk with the original filename |
| Move | Move a file into another folder |
| Delete | Permanent delete (frees quota, removes bytes) |
| Share links | Public link with optional expiry (1h/1d/7d/never) and download limit; revocable |
| Backup | Select up to 100 files → download a ZIP with a SHA-256 manifest |
| Dark / light theme, mobile layout | Tailwind CSS variables + `localStorage` |

**Deliberately out of scope** (be honest — interviewers respect this): no external
object storage (no S3), no Kubernetes, no real "trash can" (the Trash page is a
placeholder), no email sending, no password reset, no file versioning.

---

## 4. Tech stack and why each piece is there

### Backend (from `backend/package.json`)

| Technology | Version | Why it is used |
|---|---|---|
| **Fastify** | `^5.5.0` | Fast HTTP framework, plugin system, and it handles **streams** well — essential for 5 GiB uploads/downloads |
| **TypeScript** | `^5.9.2`, `strict: true` | Type safety across routes, Prisma models and config |
| **Prisma** | `^6.14.0` | Typed database access, versioned migrations, `$transaction` for atomicity |
| **PostgreSQL** | `postgres:17-alpine` | Relational data **plus row-level `FOR UPDATE` locking** — this is what makes quota safe |
| **Redis** | `redis:7.4-alpine` | Session cache, metadata cache, and the store for `@fastify/rate-limit` |
| **argon2** | `^0.44.0` | `argon2id` password hashing (current best practice) |
| **zod** | `^4.1.5` | Runtime validation of every query/body/param + structured errors |
| **archiver** | `^7.0.1` | Streaming ZIP64 export for the user backup feature |
| **ioredis** | `^5.7.0` | Redis client with lazy connect and non-crashing error handling |
| **@prometheus-io/client** | `^0.16.1` | In-process Prometheus metrics registry |
| **@fastify/** cookie, cors, helmet, rate-limit | 11 / 11 / 13 / 10 | Sessions, CORS, security headers, throttling |

### Frontend (from `frontend/package.json`)

| Technology | Version | Why |
|---|---|---|
| **Next.js** | `^15.5.2` (App Router) | Route groups `(protected)`, server + client components, `output: "standalone"` for a small Docker image |
| **React** | `^19.1.1` | UI |
| **Tailwind CSS** | `^4.1.12` | Styling with CSS custom properties for light/dark themes |
| **lucide-react** | `^0.542.0` | Icons |
| **sonner** | `^2.0.7` | Toast notifications |
| **XMLHttpRequest** (no library) | — | Upload progress needs `xhr.upload.onprogress`, which `fetch` cannot provide |
| **Next.js rewrites** | `next.config.ts` | In dev, `/api/:path*` is proxied to `127.0.0.1:4000` so the browser stays same-origin |

### Infrastructure

Docker + Docker Compose, Nginx, Cloudflare Tunnel, Tailscale (split deployment),
Prometheus, Grafana, Loki, Alloy, cAdvisor, Node/Postgres/Redis/Nginx exporters,
Terraform (AWS), GitHub Actions, systemd.

---

## 5. The big picture (architecture in one diagram)

This is the **split production** topology (the most impressive one to describe):

```text
                    Phone / Laptop browser
                             |
                             v  HTTPS
                 +-------------------------+
                 |  Cloudflare named Tunnel |   (no open inbound ports needed)
                 +------------+------------+
                              |  http://127.0.0.1:8080
                              v
  ================== AWS EC2 EDGE (public) ==================
  |   Nginx :8080                                            |
  |     |  /                -> Next.js :3000  (pages)        |
  |     |  /api/*  ---------------------------------------\  |
  |     |  /health                                         | |
  ====================================================== | ==
                                                          |
                        private Tailscale network         |
                                                          v
  ================= UBUNTU DATA PLANE (private) ==============
  |   Nginx :8080                                            |
  |     |  /api/*, /health  -> Fastify :4000                 |
  |                              |          |                |
  |              PostgreSQL :5432      Redis :6379           |
  |              (127.0.0.1 only)   (127.0.0.1 only)         |
  |                              |                           |
  |                    /srv/secure-cloud-storage  (bytes)    |
  ===========================================================
```

Key idea to say out loud: **the browser only ever calls `/api` on the same origin**,
so session cookies just work — no cross-domain cookie headaches. And
**PostgreSQL, Redis and Fastify are never exposed publicly**; only the EC2 edge is.

Single-host mode (the repo default) is the same thing with only the Ubuntu box:

```text
Browser/LAN --> Nginx :8080 --+--> Next.js  :3000
                              +--> Fastify  :4000 --> PostgreSQL :5432
                              |                   --> Redis      :6379
                              |                   --> /srv/secure-cloud-storage
                              +--> Grafana  :3002  (served at /grafana/)
Prometheus / Loki / Alloy / exporters feed Grafana (all bound to 127.0.0.1)
```

Everything uses **Linux host networking** in Compose, which is why the app can still
reach `127.0.0.1:5432` exactly like a non-containerised install.

---

## 6. Repository map — what lives where

```text
self-cloud-prj/
├── backend/                       Fastify API (TypeScript)
│   ├── src/
│   │   ├── server.ts              Entry point: build app, start metrics server, listen, handle SIGTERM
│   │   ├── app.ts                 Composition root: plugins, CORS, error handler, all routes
│   │   ├── config.ts              Zod-validated environment config (fails fast on bad values)
│   │   ├── types.d.ts             Fastify type extensions (app.prisma, request.user, ...)
│   │   ├── plugins/auth.ts        Session create + authenticate decorator (cookie -> user)
│   │   ├── modules/
│   │   │   ├── auth/routes.ts     register, login, logout, me
│   │   │   ├── files/routes.ts    upload, list/search, detail, download, move, delete, backup ZIP
│   │   │   ├── folders/routes.ts  list, create, detail, rename, delete-if-empty
│   │   │   ├── shares/routes.ts   create/list/revoke share links + public metadata/download
│   │   │   └── storage/routes.ts  quota summary + recalculate
│   │   ├── lib/
│   │   │   ├── storage.ts         Safe local disk adapter (UUID paths, O_EXCL, O_NOFOLLOW, 0600)
│   │   │   ├── redis.ts           Redis service wrapper with JSON helpers + prefix selfcloud:
│   │   │   ├── cache.ts           Cache key names + one-call invalidation
│   │   │   ├── file-backup.ts     Streaming ZIP64 export + SHA-256 manifest
│   │   │   ├── observability.ts   Prometheus metrics + private /metrics server + safe logs
│   │   │   ├── errors.ts          AppError (statusCode + machine-readable code)
│   │   │   └── serialize.ts       jsonSafe(): BigInt -> string for JSON responses
│   │   └── scripts/recalculate-storage.ts   Offline counter repair for all users
│   ├── prisma/schema.prisma       5 models: User, Session, Folder, File, FileShare
│   ├── prisma/migrations/         4 versioned SQL migrations
│   ├── test/                      4 test files (37 tests)
│   └── Dockerfile                 Multi-stage, non-root, healthcheck on /health
│
├── frontend/                      Next.js 15 App Router
│   ├── app/
│   │   ├── layout.tsx             Global layout + Sonner <Toaster>
│   │   ├── page.tsx               "/" -> redirect to /dashboard
│   │   ├── login/page.tsx         <AuthForm mode="login">
│   │   ├── register/page.tsx      <AuthForm mode="register">
│   │   ├── share/[token]/page.tsx PUBLIC share page (no login)
│   │   └── (protected)/           Route group wrapped by AppShell
│   │       ├── layout.tsx         AppShell wrapper
│   │       ├── dashboard/page.tsx Storage summary + recent 6 files
│   │       ├── files/page.tsx     Full FileManager
│   │       ├── files/[id]/page.tsx One file's metadata + download
│   │       ├── settings/page.tsx  Storage summary + privacy copy
│   │       └── trash/page.tsx     Honest placeholder (no recoverable trash)
│   ├── components/
│   │   ├── app-shell.tsx          Sidebar, header, theme toggle, logout, mobile drawer
│   │   ├── auth-form.tsx          Shared login/register form
│   │   ├── file-manager.tsx       The big one: upload, search, sort, paginate, share, delete
│   │   ├── backup-button.tsx      File picker modal -> ZIP export
│   │   └── storage-summary.tsx    Quota bar + counts
│   ├── lib/api.ts                 api() fetch wrapper, uploadFile() XHR, formatBytes()
│   └── next.config.ts             standalone output, /api rewrite, .next vs .next-dev
│
├── compose.yaml                   Single-host stack (4 app services + include monitoring)
├── monitoring/compose.yaml        Postgres, Redis + 9 monitoring services
├── deploy/
│   ├── nginx/default.conf         Single-host Nginx (routes, safe JSON access logs)
│   ├── ubuntu/                    Ubuntu data-plane compose + private Nginx
│   ├── ec2/                       EC2 edge compose + template Nginx + cloudflared
│   ├── SPLIT_DEPLOYMENT.md        Two-machine production guide
│   ├── BACKUP_RESTORE.md          Admin backup/restore runbook
│   ├── NGINX_CLOUDFLARE.md        Routing + tunnel notes
│   └── WHATSAPP.md                Tunnel-URL WhatsApp notification setup
├── infra/                         Terraform: VPC, subnet, EC2 edge, IAM/SSM, security group
├── install.sh                     One-command Ubuntu installer (idempotent)
├── scripts/                       backup/restore/verify (Python), smoke tests, cloudflare helpers
├── .github/workflows/             pipeline.yml (CI/CD) + deploy-split.yml (two hosts)
└── *.md                           README, PROJECT_OVERVIEW, CURRENT_ARCHITECTURE_AND_FLOW
```

**One-line memory hook per layer:**

- `server.ts` = start/stop the process
- `app.ts` = wire everything together
- `plugins/auth.ts` = "who is this request?"
- `lib/storage.ts` = "touch the disk safely"
- `modules/*` = "what the API can do"
- `lib/observability.ts` = "what we can see"
- `frontend/components/file-manager.tsx` = "the whole UI in one component"

---

## 7. End-to-end flows, step by step

### 7.1 Request path in general (memorise this shape)

```text
Browser -> Nginx :8080 -> Fastify :4000 -> (PostgreSQL | Redis | local disk) -> back
```

Nginx routing (`deploy/nginx/default.conf`):

| Path | Goes to | Notes |
|---|---|---|
| `/` (pages) | `127.0.0.1:3000` (Next.js) | WebSocket upgrade headers set |
| `/api/` | `127.0.0.1:4000` (Fastify) | **prefix kept**, buffering off, `Cache-Control: private, no-store` |
| `/health` | `127.0.0.1:4000/health` | Used by Compose healthcheck and the installer |
| `/grafana/` | `127.0.0.1:3002` (Grafana) | Only entry point to Grafana |
| `= /metrics` | `404` | Metrics are never exposed through Nginx |

The `/api/` block sets `proxy_request_buffering off` and `proxy_buffering off` — that
is what lets a 5 GiB upload stream through without Nginx spooling it to a temp file.

### 7.2 Sign up (register)

**Frontend:** `AuthForm` posts JSON to `/api/auth/register` via `api()` in
`frontend/lib/api.ts` (which always sets `credentials: "include"`).

**Backend** (`modules/auth/routes.ts`):

1. Zod validates `name` (2–80 chars), `email` (lowercased), and `password`
   — **12–128 characters with lowercase, uppercase, a digit and a symbol**.
2. `confirmPassword` must match, otherwise `400 VALIDATION_ERROR`.
3. If the email already exists → `409 EMAIL_EXISTS`.
4. Hash the password with **Argon2id**.
5. One transaction creates the **User** and their root **Folder** named `My Files`
   with `isRoot: true`.
6. `createSession()` makes a random 32-byte token, stores only its **SHA-256 hash** in
   PostgreSQL, and caches the session snapshot in Redis.
7. Reply `201` with the cookie `selfcloud_session`
   (`HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, 30-day expiry)
   and `jsonSafe({ user })` so `storageLimit` BigInt becomes a string.

**Rate limit:** 5 registrations per 15 minutes per IP.

### 7.3 Log in / log out / "who am I"

- **Login:** same validation, `argon2.verify`, identical session creation.
  10 attempts / 15 minutes.
- **Logout:** deletes the Session row, deletes the Redis cache entry, clears the cookie
  → `204`.
- **`GET /api/auth/me`:** returns the current user snapshot (cookie → user).
- Every request that needs a session runs the `authenticate` preHandler:
  1. No cookie → `401 UNAUTHENTICATED`.
  2. Hash the cookie value, look for `session:<hash>` in Redis.
  3. Cache hit and not expired → attach user, done (no database hit).
  4. Cache miss → look up the Session row by `tokenHash`.
  5. Missing or expired → delete the row, clear cache, `401 UNAUTHENTICATED`.
  6. Valid → attach user, cache it with a TTL equal to the remaining session life.

**Important detail to mention:** sessions are **opaque tokens, not JWTs**. That means
logout and revocation are instant, because the server owns the session state.

### 7.4 Upload a file (the most important flow)

Frontend: `uploadFile()` in `frontend/lib/api.ts` uses `XMLHttpRequest` so it can show a
progress bar, sets `withCredentials = true`, and sends the **raw file body** as
`Content-Type: application/octet-stream`. Filename, size, MIME type and folder ID go in
the **query string**.

Backend (`modules/files/routes.ts`), in order:

1. **Auth first** (`onRequest: app.authenticate`) → unauthenticated uploads are `401`.
2. Content type must be exactly `application/octet-stream`.
3. Zod parses the query: `filename` (≤255), `size`, `mimeType`, `folderId` (CUID).
4. MIME allowlist regex: only `image/`, `video/`, `audio/`, `text/`, and a set of
   `application/` types (pdf, zip, gzip, json, xml, msword, `vnd.*`, octet-stream).
5. Size > `MAX_FILE_SIZE_BYTES` (5 GiB default) → `413 FILE_TOO_LARGE`.
6. Folder must exist **and belong to this user** → otherwise `404`.
7. Generate a **UUID v4** = both the database row ID and the `storageKey`/filename.
8. **Atomic quota reservation** (one SQL statement):
   ```sql
   UPDATE "User"
      SET "storageReserved" = "storageReserved" + <size>
    WHERE id = <userId>
      AND "storageUsed" + "storageReserved" + <size> <= 5368709120
   ```
   If 0 rows changed → `413 QUOTA_EXCEEDED`.
9. **Stream the body to disk**, counting bytes as they arrive. The transform aborts with
   `413` if the stream sends *more* than declared. When the stream ends the counted
   bytes must equal the declared size, else `409 UPLOAD_MISMATCH` and the file is unlinked.
10. **Commit transaction:**
    ```sql
    SELECT id FROM "User" WHERE id = <userId> FOR UPDATE;   -- lock the row
    INSERT INTO "File" (...);
    UPDATE "User" SET "storageReserved" = "storageReserved" - <size>,
                      "storageUsed"     = "storageUsed"     + <size>;
    ```
11. Invalidate the folder's cached listing, return `201` with `jsonSafe({ file })`.
12. **`finally` block (the safety net):** if the commit never happened, delete the
    written bytes (when they exist) and release the reservation.

**State table to draw on a whiteboard for a 100-byte upload:**

| Stage | `storageUsed` | `storageReserved` |
|---|---:|---:|
| Before | 0 | 0 |
| Reservation accepted | 0 | 100 |
| Metadata committed | 100 | 0 |
| Failure path | 0 | 0 |

Multi-file uploads are sent **one at a time** from the UI, so progress is clear and one
failure does not cancel the rest.

### 7.5 List, search, filter, sort and paginate

`GET /api/files` takes `search`, `folderId`, `type`, `sort`, `order`, `page`, `limit`.

- **Ownership is always part of the query:** `where.userId = request.user.id`, so a user
  can never see someone else's rows even if they guess an ID.
- `search` → case-insensitive `contains` on `originalName` (max 100 chars).
- `type` maps to MIME groups:
  `image` → `startsWith "image/"`, `video`, `audio`,
  `document` → `application/pdf | application/msword | text/plain`,
  `archive` → `application/zip | application/gzip`.
- `sort` → `name` (uses `originalName`), `size`, or `createdAt` (default, desc).
- `limit` capped at 100 (UI uses 30, dashboard uses 6).
- Files and `count` are fetched in one `$transaction([...])`, so the pagination total is
  consistent with the page you got.

### 7.6 Folders and moving files

Folders are **purely logical** — rows in PostgreSQL, not directories on disk.

- `GET /api/folders` → all folders for the user (root first, then name).
- `POST /api/folders` → create. If `parentId` is omitted it attaches to the root
  `My Files`, so the tree always has exactly one root.
- `GET /api/folders/:id` → folder + children + files.
- `PATCH /api/folders/:id` → rename (root folder is protected).
- `DELETE /api/folders/:id` → **only if empty** (`409 FOLDER_NOT_EMPTY` otherwise).
  That is why the UI order is: delete files → then delete the folder.
- `PATCH /api/files/:id` with `{ folderId }` → move a file. It verifies the destination
  folder belongs to the user, then uses `updateMany` with `userId` in the `WHERE`, so a
  move can never steal another user's file.
- A unique constraint `(userId, parentId, name)` prevents duplicate names in one parent.

### 7.7 Download

`GET /api/files/:id/download`:

1. Authenticate.
2. `findFirst({ where: { id, userId } })` — because ownership is in the `WHERE` clause,
   another user's file returns `404`, not `403`. (Never leak whether a foreign ID exists.)
3. `app.storage.read(storageKey)` opens the file read-only with `O_NOFOLLOW`.
4. Stream it with `Content-Length`, the original filename (RFC 5987 `filename*` encoding
   for non-ASCII names), `Content-Type: application/octet-stream`, and
   `Cache-Control: private, no-store`.

The frontend triggers it with `window.location.assign(\`${API_URL}/files/${id}/download\`)`
so the browser handles it as a native download with cookies attached.

### 7.8 Delete (permanent, quota-aware)

`DELETE /api/files/:id` is deliberately ordered **"disk first, database second"**:

1. Authenticate and find the file (owner-scoped).
2. **Delete the bytes first.** If the disk delete fails → `502 STORAGE_ERROR`, and
   **nothing** in the database changes. This is the safe order: you never end up with a
   database row pointing at missing bytes.
3. Transaction: lock the `User` row with `FOR UPDATE`, then `deleteMany` the file row,
   and **only if `count > 0`** decrement `storageUsed` by the file size.
   That `count` check is what makes a double delete safe — concurrent duplicates cannot
   decrement twice.
4. Invalidate the file and folder caches; return `204`.

Deleting a file also cascades its `FileShare` rows (`onDelete: Cascade`).

### 7.9 Public share links

**Create** `POST /api/files/:id/shares` (authenticated):
- Body: `{ expiration: "1h" | "1d" | "7d" | "never", maxDownloads: number | null }`.
- Verifies the file belongs to the caller.
- Generates a 32-byte random `base64url` token = **43 characters**.
- Stores **only the SHA-256 hash** (`tokenHash`, unique) plus optional expiry and
  download limit. The raw token is returned to the creator exactly once.

**View** `GET /api/shares/:token` (public, 60 req/min) returns filename, MIME type, size,
expiry and remaining downloads. Rate-limited so tokens cannot be brute-forced quickly.

**Download** `GET /api/shares/:token/download` (public, 20 req/min) claims the download
counter **atomically and before** sending bytes:

```sql
UPDATE "FileShare"
   SET "downloadCount" = "downloadCount" + 1
 WHERE "tokenHash" = <hash>
   AND "revokedAt" IS NULL
   AND ("expiresAt" IS NULL OR "expiresAt" > now)
   AND ("maxDownloads" IS NULL OR "downloadCount" < "maxDownloads")
```

If 0 rows changed → the generic `404 SHARE_UNAVAILABLE`. So a download limit cannot be
beaten by firing parallel requests.

**Revoke** `DELETE /api/shares/:shareId` (authenticated, owner-only) → sets `revokedAt`.

**Design points to highlight:**
- Every failure returns the *same* generic error, so a stranger cannot distinguish
  "expired" from "revoked" from "never existed".
- Share links intentionally survive logout — they are separate credentials and the owner
  can revoke them at any time.
- A share link is scoped to **one file**, not a folder.

### 7.10 Personal ZIP backup export

`GET /api/files/backup?ids=<up to 100 UUIDs>` (`lib/file-backup.ts`):

1. Max 100 IDs (deduplicated). Rate limit: 5 per minute.
2. A process-local `activeBackups` set allows one backup per user and two concurrently on
   the whole server → `429 BACKUP_BUSY`.
3. All selected files must belong to the caller, else `404` ("refresh your selection").
4. All file descriptors are opened **before** headers are sent, so an error can still
   become a clean JSON error instead of a half-written ZIP.
5. The ZIP (uncompressed, ZIP64) streams entries named
   `files/<file-id>/<sanitized-name>` — the UUID directory means two files with the same
   name can never collide, and the user's original filename never becomes a real
   filesystem path.
6. While streaming, each file is hashed with SHA-256 and its byte count is verified.
7. Finally `manifest.json` is appended with the export format version, timestamp, file
   count, total bytes and, per file: original name, archive path, folder, MIME type,
   created time, size and SHA-256.
8. Aborting the browser download aborts the archive (`AbortController`) and destroys all
   streams, so no orphan stream keeps running.

Nothing is stored on the server; this is a user-facing copy, never usable for admin
restore.

### 7.11 Quota summary and recalculation

- `GET /api/storage` returns `storageLimit`, `storageUsed`, `availableStorage`, `fileCount`
  and `folderCount` (root folder excluded). Cached in Redis for `CACHE_TTL_SECONDS`.
- `POST /api/storage/recalculate` locks the user row, sums `File.size`, and resets
  `storageUsed` from the metadata — a repair tool after an abnormal shutdown.
- `npm run prisma:recalculate --workspace backend` does the same for **all** users, but
  it is an offline maintenance command (see §19).

---

## 8. Database design (5 tables)

From `backend/prisma/schema.prisma`. **No file bytes live in PostgreSQL.**

### `User`
`id` (CUID), `name`, `email` (unique), `passwordHash` (Argon2id),
`storageLimit` (BigInt, default `5368709120`), `storageUsed` (BigInt, 0),
`storageReserved` (BigInt, 0), timestamps. Relations to files, folders, sessions, shares.
Index on `email`.

### `Session`
`id` (CUID), `tokenHash` (**unique** — the SHA-256 of the cookie value),
`userId`, `expiresAt`, `createdAt`, `lastUsedAt`. Cascades on user delete.
Indexes on `userId` and `expiresAt`.

### `Folder`
`id` (CUID), `userId`, `parentId` (nullable → root), `name`, `isRoot`, timestamps.
Self-relation `FolderTree` with `onDelete: Cascade`, so deleting a parent folder removes
its children. `@@unique([userId, parentId, name])` prevents duplicate sibling names.

### `File`
`id` (**UUID v4**, generated in application code — also used as the on-disk name),
`userId`, `folderId`, `originalName`, `storageKey` (**unique**, = the UUID),
`mimeType`, `size` (BigInt), timestamps. `folder` uses `onDelete: Restrict`, which is why
a folder cannot be deleted while it still holds files.
Indexes: `(userId, folderId)`, `(userId, originalName)`, `(userId, createdAt)`,
`(userId, mimeType)` — each one matches a real query pattern from the list/search route.

### `FileShare`
`id` (CUID), `fileId`, `userId`, `tokenHash` (**unique**), `expiresAt?`, `maxDownloads?`,
`downloadCount` (default 0), `revokedAt?`, timestamps. Cascades when the file or user is
deleted. Indexes on `(fileId, createdAt)`, `(userId, createdAt)`, `(expiresAt)`.

### Why BigInt for sizes

Bytes can exceed JavaScript's safe integer range once you talk about large quotas, and
BigInt avoids floating-point drift. The catch: `JSON.stringify` cannot serialise BigInt.
The solution is `jsonSafe()` in `lib/serialize.ts`, which walks the object and converts
every BigInt to a string. The frontend calls `Number(...)` when it needs a number
(e.g. `formatBytes`, the quota progress bar).

### Migrations (4, in order)

1. `20260901000000_init` — core schema.
2. `20260901222542_test` — foreign-key adjustments.
3. `20260905000000_local_storage` — renamed the storage column, dropped `UploadIntent`,
   set all users to the 5 GiB quota, cleared stale reservations.
4. `20260912000000_file_shares` — the `FileShare` table for public links.

Historical migrations are never edited, because Prisma stores a checksum per migration
and would refuse to run `migrate deploy` if a past file changed.

---

## 9. Caching with Redis

Redis is used for **four** things. Make sure you mention all four — the caching is only
part of it.

1. **Session cache** — avoids a PostgreSQL lookup on every authenticated request.
2. **Metadata cache** — storage summary, folder list, single folder, single file.
3. **Rate limiting** — `@fastify/rate-limit` is registered with `app.redis.client`.
4. **Graceful degradation** — every cache call is wrapped in `.catch(() => undefined)`, so a
   Redis outage slows the app down but never breaks it.

### Key naming (`lib/redis.ts` + `lib/cache.ts`)

All keys are prefixed with `selfcloud:`.

| Key | Contents | TTL |
|---|---|---|
| `selfcloud:session:<sha256(token)>` | session id, expiry, user snapshot | remaining session life |
| `selfcloud:cache:storage:<userId>` | quota summary | `CACHE_TTL_SECONDS` (default 60) |
| `selfcloud:cache:folders:<userId>` | all folders | 60 |
| `selfcloud:cache:folder:<userId>:<folderId>` | one folder + children + files | 60 |
| `selfcloud:cache:file:<userId>:<fileId>` | one file's metadata | 60 |

Keys always include the `userId`, which makes cross-user cache poisoning structurally
impossible.

### Invalidation

`invalidateUserMetadata(app, userId, ...extraKeys)` deletes the storage summary, the folder
list, and any extra keys you pass in one `DEL`. Every mutation route calls it, passing the
specific file/folder keys that changed. Writes to the cache are best-effort, so a failed
invalidation never fails the user's request.

### Honest limitation to volunteer

There is no cache stampede protection, and invalidation is targeted rather than
relationship-aware. For example, after moving a file, the **destination** folder cache is
invalidated but the **old** folder's cached listing can still show the file until the
60-second TTL expires. The fix would be tag-based invalidation or a shorter TTL; it is
documented rather than hidden.

---

## 10. The star feature: quota that cannot be cheated

This is the part that separates the project from a tutorial CRUD app. Be ready to explain
**three** failure modes it solves.

### Problem 1 — the "check then act" race

A naive implementation does:

```text
if (used + size <= limit) { save file; used += size; }   // WRONG
```

Two requests can both read `used = 0` at the same time, both pass the check, and both
write. The user ends up over quota.

**Solution — atomic reservation in a single statement.** PostgreSQL evaluates the
condition and the increment together against the locked current row, so one request wins
and the other gets 0 rows updated (`413 QUOTA_EXCEEDED`):

```sql
UPDATE "User"
   SET "storageReserved" = "storageReserved" + 100
 WHERE id = $1
   AND "storageUsed" + "storageReserved" + 100 <= 5368709120
```

This is demonstrated in `backend/test/security.integration.test.ts`:
two parallel uploads of 5 GiB each → responses are exactly `[201, 413]`, and `storageUsed`
is exactly `5368709120`.

### Problem 2 — the client lies about the size

The browser sends `size` as a query parameter, which the client could fake.

**Solution — count what actually arrives.** A `Transform` stream counts incoming bytes:
- more bytes than declared → abort with `413 FILE_TOO_LARGE`;
- fewer bytes at the end → `409 UPLOAD_MISMATCH` and the file is unlinked.

So the declared size is a *reservation estimate*; the verified byte count is the truth.

### Problem 3 — partial writes and crashes

Filesystem writes and database transactions cannot be committed together, so any ordering
can leave rubbish behind.

**Solution — reserve → write → verify → commit, with a `finally` cleanup.**
- If the write fails, or the size mismatches, or the commit fails → delete the partial
  bytes **and** release the reservation.
- Because the reservation exists from step one, a crash mid-upload only leaks a
  *reservation*, never usable quota. The reserved value is visible in metrics
  (`secure_cloud_storage_reserved_bytes`) and can be reset by a recalculation.

### Reliability bonus: deletion

Deleting uses `deleteMany` + `if (count > 0)` before decrementing, and PostgreSQL row
locking (`FOR UPDATE`), so two simultaneous deletes of the same file cannot subtract the
size twice. That case is also covered by a test.

### The soundbite for this section

> "Quota is enforced where the data lives, not where the browser is. One atomic SQL
> condition reserves, the stream verifies, the transaction commits, and a `finally` block
> guarantees cleanup. That makes over-quota states unreachable by concurrency, not just
> unlikely."

---

## 11. Security: the full list of protections

Interviewers love this section. Group them so it sounds organised, not like a checklist.

### 11.1 Authentication and sessions

| Protection | Where |
|---|---|
| Argon2id password hashing (never plaintext or unsalted hashes) | `modules/auth/routes.ts` |
| Password policy: 12–128 chars + upper + lower + digit + symbol | same |
| Opaque 32-byte session token, only its **SHA-256 hash** stored | `plugins/auth.ts` |
| `HttpOnly` + `SameSite=Lax` + `Secure` (production) cookie | same |
| Server-side session revocation (logout really kills the session) | same |
| Expired sessions are deleted on discovery, not just ignored | same |
| Login/register rate limits (10 and 5 per 15 minutes) | `modules/auth/routes.ts` |
| Password never appears in logs (logger `redact` + serializers) | `app.ts` |

### 11.2 Filesystem safety (`lib/storage.ts`)

This is the strongest part of the code:

| Protection | Effect |
|---|---|
| Storage key must match a strict UUID v4 regex | `../../etc/passwd`, `a/b`, `..\secret` all rejected with `400 INVALID_STORAGE_KEY` |
| `path.join(root, key)` after validation | Path traversal is impossible |
| Root directory is resolved with `realpath` and compared | A symlinked storage root is refused at startup |
| `O_NOFOLLOW` on open | A symlink planted in the storage dir cannot be followed (test expects `ELOOP`) |
| `O_EXCL` on create | Never overwrite an existing file (test expects `EEXIST`) |
| Mode `0600` files / `0700` directory | Only the app user can read them |
| Byte-counting transform + exact size check | Over- and under-sized uploads fail |

### 11.3 Query-level ownership (IDOR prevention)

**Every** file, folder and share query includes `userId: request.user.id` in the `WHERE`
clause. It is never "fetch by ID, then compare owner" — a foreign ID simply returns `404`.
This is verified by integration tests.

### 11.4 Input validation and error handling

- Zod validates every body, query string and route param → structured
  `400 VALIDATION_ERROR` with a field path, never a stack trace.
- `AppError` carries a stable machine-readable `code` (`QUOTA_EXCEEDED`,
  `SHARE_UNAVAILABLE`, …) so the UI can react without parsing English.
- Unexpected errors log full detail server-side but return a generic
  `500 INTERNAL_ERROR` to the client.
- Prisma `P2002` (unique violation) is mapped to `409 CONFLICT`.

### 11.5 Transport / browser protections

- `@fastify/helmet` sets baseline security headers on every response.
- CORS is **credentialed** and never returns a literal `*` with credentials:
  - explicit list mode (`FRONTEND_ORIGIN=https://app.example.com`) → only those origins;
  - wildcard mode (`FRONTEND_ORIGIN=*`) → any **valid HTTP(S) origin** is echoed back, but
    `null`, `javascript:bad` and `https://example.com/path` are rejected.
- An `onRequest` hook rejects state-changing methods (`POST`, `PATCH`, `DELETE`) from a
  disallowed `Origin` with `403 INVALID_ORIGIN` — this is CSRF defence on top of
  `SameSite=Lax`.
- Downloads and API responses use `Cache-Control: private, no-store`.
- Public share responses use `public, max-age=0, no-store`.

### 11.6 Container and network hardening

- `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `init: true` on app services.
- Containers run as a non-root `node` user with an explicit `app_uid:app_gid`.
- PostgreSQL and Redis publish **only** to `127.0.0.1`.
- Metrics listen **only** on `127.0.0.1:4001`, with Nginx explicitly 404-ing `/metrics`.
- Grafana: anonymous access off, self-signup off, password from a file secret
  (`GF_SECURITY_ADMIN_PASSWORD__FILE`), root URL behind `/grafana/`.
- Cloudflare terminates TLS; Nginx honours `X-Forwarded-Proto` so generated links and
  cookies stay HTTPS.

### 11.7 Secret hygiene

- `.env` files are mode `0600`, git-ignored, and never printed by the installer.
- The installer **refuses** a git URL containing embedded credentials.
- Secrets are generated locally with the OS CSPRNG, never committed.
- No secret is ever exposed through a `NEXT_PUBLIC_*` variable (those are shipped to the
  browser) — the API is always called same-origin instead.

### 11.8 Privacy in observability (unusual and impressive)

- Metric labels are limited to `method`, `route` (the Fastify route *pattern*, e.g.
  `/api/files/:id/download`), `status_code` and a small enum for outcome.
- Nginx access logs use a `log_route` map so a concrete URI is never written — only
  categories like `download`, `upload`, `auth`, `api`, `grafana`, `health`.
- Loki receives logs only after an Alloy privacy projection.
- The observability test asserts that a planted secret string
  (`SECRET_MUST_NOT_APPEAR`) appears in **neither metrics nor logs**.

---

## 12. Observability and monitoring

### 12.1 Application metrics (`lib/observability.ts`)

Metrics are collected **in-process** by `@prometheus-io/client` and served by a
**separate tiny HTTP server** bound to `127.0.0.1:4001`. That design choice matters: even
if Nginx or the API is misconfigured, `/metrics` cannot be published, and Nginx explicitly
returns `404` for `/metrics`.

| Metric | Type | Meaning |
|---|---|---|
| `secure_cloud_http_requests_total` | Counter | requests by method, route, status |
| `secure_cloud_http_request_duration_seconds` | Histogram | latency through response completion |
| `secure_cloud_http_errors_total` | Counter | 4xx vs 5xx |
| `secure_cloud_uploads_total{outcome}` | Counter | upload responses |
| `secure_cloud_upload_failures_total` | Counter | rejected/failed/aborted uploads |
| `secure_cloud_downloads_total{outcome}` | Counter | download responses |
| `secure_cloud_authentication_failures_total` | Counter | 401s and failed logins |
| `secure_cloud_storage_used_bytes` | Gauge | total metadata usage |
| `secure_cloud_storage_reserved_bytes` | Gauge | bytes currently reserved by uploads |
| `secure_cloud_storage_quota_bytes` | Gauge | summed quotas |
| `secure_cloud_users` / `secure_cloud_files` | Gauge | counts |
| `secure_cloud_storage_filesystem_available_bytes` | Gauge | `statfs` free bytes on the storage disk |
| `secure_cloud_storage_collection_success` | Gauge | 1 = last aggregate collection worked |
| `secure_cloud_storage_collection_timestamp_seconds` | Gauge | staleness detector |
| `secure_cloud_process_*` | default metrics | Node process internals |

Two subtleties worth mentioning:
- `onRequestAbort` exists so a client that disconnects mid-upload is counted as an
  **aborted** upload, not a success.
- The storage gauges are collected every 60 s behind a `collecting` flag so slow database
  queries cannot pile up, and a failure sets `storage_collection_success = 0` instead of
  throwing.

### 12.2 The monitoring stack (`monitoring/compose.yaml`)

16 default services come up in single-host mode: `migrate`, `backend`, `frontend`,
`nginx`, `postgres`, `redis`, plus `prometheus`, `loki`, `alertmanager`, `grafana`,
`alloy`, `node-exporter`, `cadvisor`, `nginx-exporter`, `postgres-exporter`,
`redis-exporter`. (`cloudflared` sits behind the `tunnel` profile.)

| Component | Port (all loopback) | Role |
|---|---|---|
| Prometheus | `127.0.0.1:9090` | scrape + store metrics, evaluate alert and SLO rules |
| Alertmanager | `127.0.0.1:9093` | route, group and inhibit firing alerts |
| Loki | `127.0.0.1:3100` | store privacy-filtered logs |
| Grafana | `127.0.0.1:3002` | dashboards, reached via Nginx `/grafana/` |
| Alloy | `127.0.0.1:12345` | discover containers, tail logs, filter, ship to Loki |
| Node Exporter | `127.0.0.1:9100` | host CPU/mem/disk/network |
| cAdvisor | `127.0.0.1:8083` | per-container resource usage |
| Nginx Exporter | `127.0.0.1:9113` | reads Nginx `stub_status` on `8082` |
| Postgres Exporter | `127.0.0.1:9187` | DB availability, connections, size |
| Redis Exporter | `127.0.0.1:9121` | memory, clients, hit rate |
| Fastify | `127.0.0.1:4001/metrics` | app metrics |

**Resource discipline** (great detail for a "constrained hardware" question):
- Prometheus: 256 MB / 0.5 CPU, 7-day and 1 GB retention.
- Loki: 256 MB, **72-hour** retention, 1 MB/s ingestion limit.
- Grafana: 256 MB, plugin auto-install disabled, analytics off, signup off.
- cAdvisor: 128 MB with a trimmed metric set; exporters 32–48 MB each.
- Total monitoring budget ≈ 1,248 MiB, so it fits beside the app on one machine.

Pre-provisioned dashboards: `backend`, `containers`, `host`, `nginx`, `postgres`, `redis`,
`storage`. Prometheus has alert rules (`alerts.yml`), including one that flags a backup
success older than 36 hours using the Node Exporter textfile collector.

### 12.3 Logs, end to end

```text
App logs (JSON, redacted) / Nginx access logs (categorical) / cloudflared logs
        |
        v
   Alloy (Docker discovery + privacy projection)
        |
        v
   Loki (72 h retention)
        |
        v
   Grafana (Explore + dashboards);  Prometheus deletes nothing, Loki deletes at 72 h
```

Docker itself rotates logs at 5 MB × 2 files per container, so unbounded disk growth is
prevented twice over. The native `cloudflared` log (not a container) needs host
`logrotate`; `prepare.mjs` generates that config.

### 12.4 What is *not* automatic (say this honestly)

Alert rules and SLO burn-rate rules both exist, and both are routed to **Alertmanager**, which
groups and inhibits them; every alert links to a runbook in `deploy/RUNBOOKS.md`. The one
remaining piece is a real notification **destination**: the shipped receiver points at a
loopback webhook placeholder, so plugging in Slack, email or the existing WhatsApp notifier is
a configuration change rather than new code. cAdvisor ingestion has not been re-verified in the
latest session, and `monitoring/IMPLEMENTATION_STATUS.md` deliberately separates "implemented"
from "observed running".

---

## 13. Deployment: three ways it can run

### 13.1 Single-host (repo default) — `compose.yaml`

Services are ordered by health dependencies:

```text
postgres + redis (healthy)
        |
        v
   migrate  (prisma migrate deploy, runs once, exits 0)
        |
        v
    backend  (Fastify :4000, healthcheck /health)
        |
        v
   frontend  (Next.js :3000, healthcheck /login)
        |
        v
    nginx    (:8080, healthcheck /health)
```

Notes to quote: the migration runs as a **separate one-shot container** so the API never
boots against an old schema; the backend has `stop_grace_period: 5m` so in-flight uploads
can finish during a deploy; the frontend is built with `NEXT_PUBLIC_API_URL=/api` so every
browser call is same-origin.

### 13.2 One-command Ubuntu installer — `install.sh`

`bash install.sh` (or the `curl | bash` bootstrap) does this, idempotently:

1. Bootstrap mode: installs `git` if missing, clones into `/opt/secure-cloud`, then
   re-executes the real installer.
2. Validates the OS is Ubuntu and installs any missing `curl`, `git`, `python3`.
3. Installs Docker Engine + Compose plugin from Docker's official repository when absent.
4. Requires Compose **≥ 2.24.0** (needed for `include:` and `depends_on: condition`).
5. Generates only the *missing* `.env` files, mode `0600`, with CSPRNG secrets.
6. Creates `/srv/secure-cloud-storage` as `0700` owned by the app UID/GID, and refuses a
   symlinked or non-writable path.
7. **Refuses to regenerate credentials** when a database volume or existing storage content
   is detected — this is the data-safety gate.
8. Creates the external Postgres/Redis volumes if absent (never deletes them).
9. `compose build` → start `postgres redis` → run `migrate` → start everything with
   `--wait` → `curl /health` → print status.

Modes: `--status` (container state including exited jobs), `--update` (rebuild + migrate;
it does **not** `git pull`), `--uninstall` (requires typing `UNINSTALL`; removes containers
only, all data and volumes survive).

### 13.3 Split production — `deploy/ec2` + `deploy/ubuntu`

- **EC2 (public edge):** `frontend`, `nginx`, optional `cloudflared` (named tunnel with a
  token from a Docker secret). Nginx is a *template* that the official Nginx image renders
  using `UBUNTU_TAILSCALE_HOST`, and it proxies `/api/*` across Tailscale to Ubuntu.
- **Ubuntu (private data plane):** `postgres`, `redis`, `migrate`, `backend`, `nginx`
  (handling only `/api/*` and `/health`). Owns the secrets and all file bytes.
- End-to-end path:
  `Browser → Cloudflare → EC2 Nginx → /api/* → Tailscale → Ubuntu Nginx → Fastify → PostgreSQL/Redis/disk`.
- Monitoring is **not** included in either production compose file; it is opt-in.
- A Tailscale ACL ensures only the EC2 node can reach Ubuntu TCP 8080, and PostgreSQL,
  Redis, Fastify and storage ports are never opened publicly.
- Because the browser still uses relative `/api` URLs, cookies and same-origin behaviour
  are unchanged between the single-host and split topologies — that was a deliberate
  design constraint.

### 13.4 Terraform infrastructure — `infra/`

Provisions **only the public EC2 edge** (deliberately *not* the database).

| File | Resources |
|---|---|
| `versions.tf` | Terraform ≥ 1.6, AWS provider `~> 5.0`, default tags |
| `data.tf` | available AZs, latest Amazon Linux 2023 x86_64 AMI |
| `network.tf` | VPC (DNS on), internet gateway, public subnet + route table, optional private subnet |
| `security.tf` | Security group: 80/443 open, **22 only from `ssh_allowed_cidrs`**, no DB/Redis/API ports |
| `ec2.tf` | EC2 instance: gp3 **encrypted** root, **IMDSv2 required**, public IP, `user_data` bootstrap |
| `iam.tf` | Instance role + `AmazonSSMManagedInstanceCore`, optional CloudWatch policy, instance profile |
| `ssm.tf` | SSM association that installs the given **public** SSH key into `ec2-user` **without replacing** the instance |
| `cloudwatch.tf` | Optional log group, 14-day retention |
| `user-data.sh.tftpl` | dnf update; install Docker/Git/curl/jq; enable Docker; install `cloudflared` and Tailscale; create `/etc/secure-cloud/ec2`; optional `tailscale up` |
| `outputs.tf` | VPC id, subnet ids, security group id, instance id/public IP, IAM role name |

**Security-conscious design choices to highlight:**
- The SSH key is installed through **SSM**, not by attaching `key_name`, because that
  attribute is replacement-sensitive in AWS and would recreate the production edge host.
- SSH ingress defaults to a single `/32`; an empty list disables SSH entirely.
- `tailscale_auth_key` is marked `sensitive`, and the README warns it lands in Terraform
  state — so the recommended path is to leave it empty and enrol Tailscale manually.
- Workflow: `terraform init / fmt -check / validate / plan -out / apply`, then
  `terraform destroy` removes AWS resources only — the Ubuntu data plane and its data are
  untouched.

---

## 14. CI/CD pipeline

Two workflows. `pipeline.yml` is the main one; `deploy-split.yml` is for the two-host
topology.

### 14.1 `pipeline.yml` — three jobs

```text
  pull_request / push to main / manual dispatch
                    |
                    v
  [1] checks  (ubuntu-latest, 15 min)
      - services: postgres:17-alpine with a healthcheck
      - npm ci
      - prisma generate  ->  prisma deploy  (against the disposable test DB)
      - npm run typecheck          (both workspaces)
      - npm run lint --workspace backend   (eslint, --max-warnings=0)
      - npm test                   (37 tests, integration hits the test DB)
      - npm run build              (both workspaces)
      - bash monitoring/scripts/validate.sh   (Compose + Prom/Alloy/Loki/Nginx config)
                    |
                    v
  [2] images  (needs checks, 30 min)
      - docker buildx build backend  -> secure-cloud-backend:ci
      - docker buildx build frontend -> secure-cloud-frontend:ci   (GHA layer cache)
      - bash scripts/smoke-containers.sh
        (starts real disposable containers and tests auth, CORS,
         upload/list/download/delete, quota and frontend routes)
      - on main only: log in to ghcr.io, tag by commit SHA, push,
        then capture the **immutable digest** for each image
                    |
                    v
  [3] deploy  (needs images, MANUAL, main only, self-hosted runner)
      - requires /etc/secure-cloud/backend.env + monitoring runtime files
      - docker compose config --quiet
      - docker compose pull
      - stop nginx/frontend/backend   (stop writers first!)
      - run the migrate container     (schema first!)
      - docker compose up -d --no-build --wait --wait-timeout 180
```

**Details worth saying out loud:**
- The deployment deploys **the exact digests that passed the smoke test**, not "latest".
  That is the supply-chain guarantee: what you tested is what you ran.
- `permissions: contents: read` / `persist-credentials: false` on checkout — least privilege.
- Concurrency groups prevent two deploys to the same environment (`cancel-in-progress: false`
  for production).
- Deploy is gated behind a GitHub **environment** (`production`) and a manual dispatch input,
  so a green `main` build never silently ships itself.
- Migrations run **after** stopping the writers, which is the safe order for a schema change.

### 14.2 `deploy-split.yml`

Manual dispatch with two independent booleans and two self-hosted runners:
`secure-cloud-ubuntu` (data plane: pull backend image, run migrate, up backend+nginx) and
`secure-cloud-ec2` (edge: pull frontend image, up frontend+nginx). Neither job copies
secrets to the other machine — each host already holds exactly what it needs.

### 14.3 Two more workflows guard the pipeline itself

| Workflow | What it does |
|---|---|
| `.github/workflows/security.yml` | Four scanners: Gitleaks over full git history, `npm audit`, Trivy filesystem scan, and a **gating** Trivy image scan on CRITICAL CVEs. Also publishes a CycloneDX SBOM and runs weekly so a newly published CVE is caught without a code change |
| `.github/workflows/terraform.yml` | `terraform fmt -check`, `init -backend=false`, `validate`, `tflint`, `checkov`, an **opt-in** OIDC plan that publishes the diff into the job summary, and a weekly scheduled drift check that fails loudly when the live infrastructure no longer matches the repository |

Both are additive: they wrap the existing pipeline rather than changing it, so a red security scan
never blocks the application build from producing a diagnosable artefact.

---

## 15. Backup and restore

There are **three separate things** people confuse. Keep them distinct.

### 15.1 User download (in-app)

`BackupButton` → select ≤100 files → `GET /api/files/backup?ids=...` → streaming ZIP64
with `manifest.json` (SHA-256 per file). For the user, from the browser. Cannot be used to
restore a server.

### 15.2 Admin backup (`scripts/backup_tool.py`, 439 lines of Python)

The wrappers are `scripts/backup.sh`, `scripts/verify-backup.sh`, `scripts/restore.sh`:

```bash
sudo bash scripts/backup.sh
sudo bash scripts/verify-backup.sh /srv/secure-cloud-backups/<backup-dir>
sudo bash scripts/restore.sh /srv/secure-cloud-backups/<backup-dir>
```

Design points from the code:
- Produces two artifacts: `postgres.dump` and `storage.tar.gz`, in a directory named
  `backup-YYYYMMDDTHHMMSSZ-<8 hex>` (a strict name regex is enforced on restore).
- Requires a **root-owned `0700`** backup directory that must be absolute and free of
  symlinks; rejects anything else.
- Uses an `fcntl` lock so two backups cannot run at once.
- Writes JSON logs that never echo commands, SQL, environment values or provider stderr.
- Writes files atomically (temp file → `fsync` → `os.replace`).
- Verifies the tar inventory: reads through the gzip trailer, and rejects path traversal,
  duplicate entries, and link/device entries.
- `restore.sh` demands **interactive confirmation** and keeps recovery copies.
- A systemd service + timer are supplied to run it daily — but the installer does **not**
  enable them, so scheduling is a deliberate manual step.

### 15.3 Recovery of metadata counters

`npm run prisma:recalculate --workspace backend` rebuilds `storageUsed` for every user from
`File` metadata. The documented procedure after a crash is: stop all API processes, remove
orphan UUID files from storage, reset `storageReserved` to 0, then recalculate. Filesystem
and database writes cannot be atomic together, which is exactly why this runbook exists.

### 15.4 The sentence to say about backups

> "Backups are **coordinated**: PostgreSQL and the storage directory are captured
> together with a short maintenance window, because the database holds metadata that must
> match the bytes on disk. The scripts are written and idempotent, but scheduling is a
> deliberate manual step, and I say that openly rather than pretending it is automatic."

---

## 16. Testing

**37 tests across 4 files** (`backend/vitest.config.ts`, run with `vitest run`).

| File | Tests | Needs a database? | What it proves |
|---|---|---|---|
| `test/storage.test.ts` | 12 | no | Exact bytes written/read, `0600` permissions, idempotent remove, 404 on missing |
| `test/cors.test.ts` | 4 | no | Wildcard origin reflection with credentials + `Vary`, allowlist still enforced, opaque origins rejected |
| `test/observability.test.ts` | 3 | no | Metric names/labels, no secret leakage into metrics or logs, registries isolated per app instance, metrics bound to loopback only |
| `test/security.integration.test.ts` | 18 | **yes** (`TEST_DATABASE_URL`) | Real end-to-end security behaviour |

**The 18 integration tests include:**

1. Register creates the user + root folder; the response never contains `passwordHash`.
2. Login sets an `HttpOnly` cookie.
3. Unauthenticated `/api/storage` → `401`.
4. Unauthenticated upload → `401`.
5. Quota enforced (`413`).
6. Two concurrent 5 GiB uploads → exactly `[201, 413]`, `storageUsed == 5368709120`.
7. Size mismatch → `409`, reservation released, usage back to 0, bytes removed.
8. Search / type filter / name sort / folder move all behave.
9. Folder delete blocked while non-empty (`409`), allowed once empty (`204`).
10. Disk delete failure → `502` **and** metadata + usage retained.
11. Two concurrent deletes of the same file → usage decremented only once, bytes gone.
12. Plus ownership, upload/download bytes, share tokens with expiry, download limit and
    revocation, and permanent-delete accounting.

**Three important testing details:**

- The `it.each([...])` data-driven tests expand into many cases, which is how 6 test blocks
  in `storage.test.ts` become 12 named tests (traversal keys, size mismatches).
- Integration tests are **skipped** unless `TEST_DATABASE_URL` is explicitly set, and they
  never fall back to the application database. They wipe only the test database's tables.
- `vi.spyOn(app.storage, "remove").mockRejectedValueOnce(...)` simulates a disk failure
  deterministically — much better than trying to break a real disk.

**Commands:**

```bash
npm run typecheck        # tsc --noEmit in both workspaces
npm test                 # vitest run (backend)
npm run lint             # eslint (backend, --max-warnings=0) + next lint (frontend)
npm run build            # production builds for both workspaces

# integration suite (use a DISPOSABLE database!)
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:deploy --workspace backend
TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/secure_cloud_test" npm test
```

---

## 17. Environment variables cheat sheet

From `backend/src/config.ts` (a Zod schema — the app **refuses to start** on a bad value).

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string |
| `AUTH_SECRET` | **yes** | — | Minimum 32 characters |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `REDIS_URL` | no | `redis://localhost:6379` | Must be a valid URL |
| `CACHE_TTL_SECONDS` | no | `60` | Integer 10–3600 |
| `FRONTEND_ORIGIN` | no | `http://localhost:3000` | `*` or comma-separated valid URLs |
| `PORT` | no | `4000` | API port |
| `STORAGE_PATH` | no | `/srv/secure-cloud-storage` | Must start with `/` |
| `STORAGE_LIMIT_BYTES` | no | `5368709120` | **Must equal 5 GiB** — anything else is rejected |
| `MAX_FILE_SIZE_BYTES` | no | `5368709120` | Single-file cap |
| `SESSION_TTL_DAYS` | no | `30` | Integer 1–90 |
| `METRICS_PORT` | no | `4001` | Metrics listener (always `127.0.0.1`) |

Compose / installer variables: `APP_ENV_FILE`, `APP_UID`, `APP_GID`, `BACKEND_IMAGE`,
`FRONTEND_IMAGE`, `NEXT_PUBLIC_API_URL`, `MONITORING_RUNTIME_DIR`, `POSTGRES_ENV_FILE`,
`UBUNTU_TAILSCALE_HOST`, `CLOUDFLARE_TUNNEL_TOKEN_FILE`, `GRAFANA_ROOT_URL`,
`GRAFANA_COOKIE_SECURE`, `CLOUDFLARED_RUNTIME_DIR`, `SECURE_CLOUD_DIR`,
`SECURE_CLOUD_REF`, `SECURE_CLOUD_REPO`, `TEST_DATABASE_URL`.

Optional WhatsApp tunnel notifications: `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_RECIPIENT`, `WHATSAPP_API_VERSION`,
`WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE`.

**Favourite config detail to mention:** `STORAGE_LIMIT_BYTES` has
`.refine(value => value === 5368709120n, "Quota must be 5 GiB")`. The product decision
(5 GiB per user) is encoded as a *validation rule*, so a misconfigured deployment fails at
boot rather than silently handing out the wrong quota.

---

## 18. How to run it yourself (copy-paste)

### 18.1 Docker, single host (recommended for a demo)

```bash
# On Ubuntu, from a checkout:
bash install.sh

# Or on a brand-new server:
curl -fsSL https://raw.githubusercontent.com/Aneeb-Kashif2/private-cloud/main/install.sh | bash

# Then open http://localhost:8080
bash install.sh --status      # check containers (including exited jobs)
bash install.sh --update      # rebuild + migrate after you pull new code
bash install.sh --uninstall   # remove containers (data survives)
```

### 18.2 Local development (two processes)

```bash
npm install                     # installs both workspaces
cp .env.example backend/.env    # then edit DATABASE_URL and AUTH_SECRET (>=32 chars)
docker compose up -d postgres redis
npm run prisma:deploy --workspace backend
npm run dev                     # backend :4000 (tsx watch) + frontend :3000 (next dev)
```

In development, `next.config.ts` rewrites `/api/:path*` to `http://127.0.0.1:4000`, so you
can browse `http://localhost:3000` from a phone on the same LAN without CORS pain. Dev
output goes to `.next-dev` so it never clobbers a production `.next` build.

### 18.3 Manual stack control

```bash
docker compose config --quiet          # validate the compose file
docker compose config --images         # see which images would run
docker compose up -d --wait            # start everything, gated on healthchecks
docker compose ps -a                   # including the exited migrate job
docker compose logs -f backend         # follow API logs
curl -s localhost:8080/health          # smoke check through Nginx
curl -s 127.0.0.1:4001/metrics | head  # app metrics (loopback only)
```

### 18.4 A 3-minute live demo order (if they ask you to show it)

1. `curl -s localhost:8080/health` → `{"status":"ok","redis":"ready"}`.
2. Register a user, show the dashboard quota bar (0 B of 5 GiB).
3. Drag in a file, show the progress bar, then the file appearing in the list.
4. Show search + type filter + grid/list toggle.
5. Create a folder, move the file into it, try deleting the non-empty folder → show the
   `409` toast (proof the guard is real).
6. Create a share link, open it in a private window (no login), download it.
7. Revoke the share link and reload the public URL → "This link is unavailable".
8. `curl -s 127.0.0.1:4001/metrics | grep secure_cloud_uploads_total` → show your upload
   counted, while `curl -s localhost:8080/metrics` returns `404` (metrics are private).
9. Delete the file and show the quota bar drop back.

---

## 19. Known limitations — say these before they ask

Volunteering weaknesses is the single strongest signal of seniority. All of these are real
and visible in the repo.

| # | Limitation | Honest framing | What I would do next |
|---|---|---|---|
| 1 | **Single point of failure** | Everything runs on one machine; there is no HA or failover. | Replicate PostgreSQL, move bytes to S3-compatible storage, run two app nodes |
| 2 | **Backup timer not enabled** | The scripts and systemd timer exist and work, but the installer deliberately does not enable the schedule. | Enable it behind an explicit installer flag |
| 3 | **No alert *destination*** | Alert rules exist and now route through Alertmanager, but the receiver is a loopback placeholder: no Slack, email or WhatsApp destination is configured. | Point the receiver at a real channel (or wrap the existing WhatsApp notifier as a webhook target) |
| 4 | **No recoverable trash** | Delete is permanent by design; the Trash page is a placeholder. | Soft delete with `deletedAt` plus a purge job |
| 5 | **No resumable uploads** | A dropped 5 GiB upload restarts from zero. | Multipart / tus-style resumable uploads |
| 6 | **Cache invalidation is targeted** | After moving a file, the old folder's cached list can be stale for up to 60 s. | Tag-based invalidation or event-driven keys |
| 7 | **`availableStorage` excludes in-flight reservations** | The UI shows `limit - used`, while enforcement also counts `reserved`. | Subtract `storageReserved` in the summary endpoint |
| 8 | **`/auth/me` can be up to 60 s stale** | Served from the cached session snapshot, so a just-changed counter may lag. Quota *enforcement* never uses that snapshot. | Invalidate the session cache on quota change |
| 9 | **Recalculation trusts metadata** | It does not verify bytes on disk, remove orphans, or clear reservations. | Add a reconciliation command that diffs disk against metadata |
| 10 | **Share links survive logout** | Intentional (they are separate credentials), but worth stating clearly. | Optional "revoke all my shares on logout" |
| 11 | **UI says "10 GB" on the register screen** | The code, schema and config all enforce **5 GiB**; the marketing copy in `auth-form.tsx` is simply wrong. | Fix the copy to "5 GiB" |
| 12 | **Local disk, not object storage** | Bytes live on one filesystem; scaling out means replacing the storage adapter. | Put `LocalStorage` behind an interface and add S3 |
| 13 | **No content/virus scanning** | MIME type is allowlisted but file *contents* are not inspected. | Add ClamAV or a scanning sidecar |
| 14 | **Rate limiting is per-process** | Correct for one container; multiple API replicas need shared limits. | It is already Redis-backed via `@fastify/rate-limit`, so it scales once Redis is shared |

**The two to mention even if they do not ask:** **(2) backups are manual** and
**(1) single point of failure** — because those are the ones that would actually page you at
3 a.m.

---

## 20. Interview questions and model answers

### Q1. "Walk me through what happens when I upload a file."

Answer in five beats:

1. The browser sends the raw file body as `application/octet-stream` via `XMLHttpRequest`
   (for progress), with filename/size/MIME/folder as query parameters plus the session
   cookie.
2. Fastify authenticates, validates with Zod, checks the MIME allowlist, and verifies the
   folder belongs to the user.
3. One atomic `UPDATE ... WHERE used + reserved + size <= limit` reserves quota. Zero rows
   changed means `413 QUOTA_EXCEEDED`.
4. The stream is written to `/srv/secure-cloud-storage/<uuid>`, opened with `O_EXCL` and
   `O_NOFOLLOW` at mode `0600`, while a transform counts bytes and enforces the exact size.
5. A transaction creates the `File` row and moves those bytes from `reserved` to `used`.
   Any failure deletes the bytes and releases the reservation in a `finally` block.

### Q2. "How do you stop two users from over-spending quota?"

"First, quota is per user, so different users cannot compete for the same space. For
concurrent uploads by **one** user, the reservation is a single SQL statement whose `WHERE`
clause contains the affordability test. PostgreSQL evaluates the condition against the
locked current row, so two statements cannot both see the same free space. One reserves, the
other updates zero rows and gets a `413`. A test fires two 5 GiB uploads in parallel and
asserts exactly `[201, 413]`."

### Q3. "Why not just use S3?"

"I kept the storage layer behind a small adapter (`createLocalStorage`) with just `write`,
`read`, `remove`, so swapping to S3 means writing one new adapter, not touching a single
route. I chose local disk because the whole premise is *self-hosting* on your own hardware,
and because the interesting engineering — atomic quota, streamed verification, safe paths —
is independent of where the bytes finally land. I also documented scaling out as future
work."

### Q4. "Why keep bytes on disk instead of in the database?"

"Bytes in PostgreSQL mean large WAL traffic, bloated backups, expensive memory pressure on
reads, and no help from the OS page cache. Keeping metadata in PostgreSQL and bytes on disk
lets each system do what it is good at. The cost is that they cannot commit atomically —
which is exactly why I use reserve → write → verify → commit, plus a cleanup `finally` and a
documented reconciliation runbook."

### Q5. "How are sessions secured?"

"Opaque 32-byte random tokens — not JWTs. The browser gets the token in an `HttpOnly`,
`SameSite=Lax`, `Secure` cookie; PostgreSQL stores only its SHA-256 hash, so a database leak
does not hand over usable sessions. Logout deletes the row, so revocation is instant. Redis
caches the session snapshot to avoid a database read on every request, and every cache call
fails soft, so Redis going down degrades performance, not correctness."

### Q6. "How do you prevent path traversal?"

"Three layers. The storage key must match a strict UUID v4 regex, so `../`, absolute paths
and separators are rejected before any filesystem call. Files are created with `O_EXCL` so an
existing file can never be overwritten, and opened with `O_NOFOLLOW` so a symlink planted in
the storage directory cannot redirect the write. The storage root itself is checked with
`realpath` at startup, so a symlinked root is refused. There are tests for each case."

### Q7. "Why BigInt, and how does that survive JSON?"

"Byte counts and quotas can exceed `Number.MAX_SAFE_INTEGER`, and floating-point drift in
storage accounting would be indefensible, so sizes are `BigInt` end to end. `JSON.stringify`
throws on BigInt, so `jsonSafe()` walks the response and converts every BigInt to a string,
and the frontend converts back to numbers only for display."

### Q8. "What happens if the disk delete succeeds but the database commit fails?"

"Nothing is corrupted: usage is not decremented, so the quota stays conservative, and the
API already returned an error. Retrying the delete is safe because `remove` treats `ENOENT`
as success, so the retry walks straight through to the database delete and decrements once.
That is exactly why I delete bytes *first* — in the opposite order you would have a metadata
row pointing at missing bytes and every download would fail."

### Q9. "How do you know the deployment you tested is the one running in production?"

"The pipeline builds the images, smoke tests them in real containers, then pushes them to
GHCR and records the **immutable digest** of exactly those images. The deploy job consumes
that digest output, not a floating tag, so what was tested is literally what runs."

### Q10. "How is this monitored, and what would you check first if uploads started failing?"

"Metrics live on a private loopback-only port and are scraped by Prometheus, with Grafana for
dashboards. First three things: `secure_cloud_uploads_total{outcome="failure"}`,
`secure_cloud_upload_failures_total` and `secure_cloud_storage_reserved_bytes`. A rising
`reserved` value with flat `used` points at aborted uploads leaking reservations. A spike in
5xx together with `secure_cloud_storage_collection_success = 0` points at the database or the
storage disk, and `secure_cloud_storage_filesystem_available_bytes` catches the classic
'disk is full' case."

### Q11. "What is the most interesting bug you dealt with?"

"The reservation lifecycle. A crashed upload used to leave a reservation behind, so the user
appeared to have less space than they really did — the `finally` cleanup and the
`storage_reserved_bytes` metric came out of that. Separately, deleting a file the naive way
(metadata first, then bytes) can leave rows pointing at missing content, so I flipped the
order to disk-first with a `502` and made the disk delete idempotent so retries are safe.
Both are regression-tested now."

### Q12. "How would you scale this to 10,000 users?"

"Concretely: (1) run multiple API replicas — the app is stateless apart from the in-memory
backup semaphore; (2) move bytes to S3-compatible object storage behind a new storage
adapter, with presigned URLs so downloads do not pass through Node; (3) use managed
PostgreSQL with a connection pooler; (4) share Redis; (5) keep the same atomic SQL quota
pattern, which already behaves correctly under concurrency; (6) move the backup semaphore
into Redis; and (7) keep the same metric and log contract so dashboards keep working."

### Q13. "Why write your own installer instead of just documenting Docker?"

"Because 'clone and run Compose' still leaves a dozen ways to fail: missing Docker, a Compose
version without `include:` support, missing secrets, a storage directory owned by the wrong
UID, credentials regenerated over an existing database. The installer turns all of that into
one idempotent command that refuses to destroy data and health-checks the result. It is the
difference between 'it worked on my machine' and 'it works on your machine'."

### Q14. "What would you improve with another week?"

"Fix the three honesty items first because they are small: the '10 GB' copy on the register
page should say 5 GiB, `availableStorage` should subtract `storageReserved`, and the backup
timer should be enableable with a flag. Then the two features that would matter most in real
use: recoverable delete (soft delete plus a purge job) and resumable uploads, because
restarting a multi-gigabyte upload from zero is the worst user experience in the app."

### Q15. "Is this project production-ready?"

"It is production-*shaped*: hardened containers, private databases, atomic accounting,
migrations gated in the pipeline, digest-pinned deploys, monitoring, and backup scripts. It
is not production-*operated*: backups are not scheduled, no alert notifier is configured, and
it is a single point of failure. I would not hand it to a paying customer without enabling
those three first — and I would rather say that than pretend it is finished."

---

## 21. Numbers cheat sheet (memorise these)

| Thing | Value |
|---|---|
| User quota | **5 GiB = 5,368,709,120 bytes** |
| Max single file | 5 GiB (same default) |
| Session TTL | 30 days (1–90 allowed) |
| Session token | 32 random bytes |
| Share token | 32 random bytes → 43-char `base64url` |
| Password | 12–128 chars, upper + lower + digit + symbol |
| Metadata cache TTL | 60 seconds |
| Register rate limit | 5 / 15 min |
| Login rate limit | 10 / 15 min |
| Share view / download limit | 60 / min · 20 / min |
| Backup export rate limit | 5 / min, ≤100 files, max 2 concurrent |
| Tests | **37** (12 storage + 4 CORS + 3 observability + 18 integration) |
| Database models | 5 |
| Migrations | 4 |
| Compose services (single host) | 16 default + 1 optional (`cloudflared` profile) |
| Monitoring memory budget | ≈ 1,248 MiB |
| Prometheus retention | 7 days / 1 GB |
| Loki retention | 72 hours (ingest 1 MB/s) |
| Docker log rotation | 5 MB × 2 files |
| Ports | Nginx 8080 · Next 3000 · Fastify 4000 · metrics 4001 · Grafana 3002 · Nginx stub 8082 · Postgres 5432 · Redis 6379 · Prometheus 9090 · Loki 3100 |
| Backend container base | `node:26-bookworm-slim` |
| Frontend container base | `node:22-bookworm-slim` |
| Minimum Compose | 2.24.0 |
| Minimum Node (engines) | >= 22 |

---

## 22. Live code-walkthrough script

If they say **"show me the code"**, follow this order — it tells a story instead of jumping
around.

### Step 1 — Who is this request? (`backend/src/plugins/auth.ts`)

Show the `authenticate` decorator: cookie → SHA-256 hash → Redis session cache → PostgreSQL
fallback → expire handling. Say: *"Notice the cache is checked first, but the database is the
source of truth, and expired sessions are deleted, not just ignored."*

### Step 2 — The composition root (`backend/src/app.ts`)

Show, in order: logging with redaction, `trustProxy`, the four decorators
(`config`, `prisma`, `storage`, `redis`, `metrics`), the origin allowlist function, Helmet →
cookie → CORS → rate limit, the `onRequest` origin guard for state-changing methods, the
central error handler, then route registration. Say: *"Everything a request can touch is
wired in one place, which makes the security posture auditable in a single file."*

### Step 3 — Storage safety (`backend/src/lib/storage.ts`)

Show the UUID regex, the `realpath` root check, and the `open(... O_EXCL | O_NOFOLLOW, 0o600)`
line. Then the counting `Transform`. Say: *"This file is 47 lines and it is where a
file-upload vulnerability would live if I had written it carelessly."*

### Step 4 — The upload route (`backend/src/modules/files/routes.ts`, lines ~46–77)

Show the raw SQL reservation, then the write, then the transaction, then the `finally`.
This is the centrepiece — slow down here. Say: *"The declared size reserves, the actual bytes
verify, the transaction commits, the `finally` cleans up."*

### Step 5 — Ownership everywhere (`modules/files/routes.ts` + `folders` + `shares`)

Point at three `where: { ..., userId: request.user.id }` clauses in different files and say:
*"This is the whole IDOR story: ownership is part of the query, so a foreign ID is
indistinguishable from a missing one — both are 404."*

### Step 6 — Share tokens (`backend/src/modules/shares/routes.ts`)

Show the 43-char token validation, the SHA-256-only storage, the atomic `UPDATE` claim, and
the single generic `publicFailure()`. Say: *"One error for every failure mode, so the endpoint
leaks nothing."*

### Step 7 — Observability (`backend/src/lib/observability.ts`)

Show `requestDimensions()` (route *pattern*, not URL), the abort hook, and
`startMetrics()` listening on `127.0.0.1`. Say: *"Privacy and safety were designed into the
metrics, not bolted on."*

### Step 8 — Frontend seam (`frontend/lib/api.ts` + `components/file-manager.tsx`)

Show `api()` with `credentials: "include"`, `uploadFile()` with XHR progress, then the
`loadFiles()` query builder. Say: *"The frontend never knows the storage layout; it only
speaks to `/api`."*

### Step 9 — Proof (`backend/test/security.integration.test.ts`)

Show the two tests that matter most:
- concurrent 5 GiB uploads → `[201, 413]`
- concurrent deletes → decrement once
Say: *"These two tests are why I trust the accounting."*

### Step 10 — Delivery (`compose.yaml` → `pipeline.yml` → `infra/`)

Finish with the health-gated startup order, the digest-pinned deploy, and the Terraform edge.
Say: *"The code is only half the project; the other half is being able to ship and operate it
safely on someone else's machine."*

---

## Final "one paragraph" summary to have ready

> "Secure Cloud is a self-hosted private cloud storage platform. It is a Next.js 15 frontend
> talking to a Fastify 5 TypeScript API, with PostgreSQL storing users, sessions, folders,
> file metadata and share links through Prisma, Redis accelerating sessions and metadata
> lookups, and the actual bytes streamed to local disk under UUID names behind a hardened
> storage adapter. The engineering centrepiece is quota correctness: an atomic SQL
> reservation, streamed size verification, a transactional commit and a guaranteed cleanup
> step, proven by concurrency tests. Around it I built the full operational story — Nginx
> and Docker Compose, a one-command idempotent Ubuntu installer, a GitHub Actions pipeline
> that builds, tests, smoke-tests and publishes digest-pinned images, a privacy-first
> Prometheus/Grafana/Loki stack, Terraform-provisioned AWS edge infrastructure for a split
> deployment, and coordinated database-plus-filesystem backup and restore tooling. I also
> documented honestly what it does not do yet: backups are not scheduled, there is no alert
> notifier, uploads are not resumable, delete is permanent, and it is still a single point of
> failure."

---

*Prepared by inspecting every source file listed in `git ls-files` for this repository.
Where numbers are quoted (37 tests, 15 services, 5 GiB, retentions, limits) they were
verified against the actual files. Where something is not implemented, it is labelled as a
limitation rather than described as working.*

