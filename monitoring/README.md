# Secure Cloud monitoring

See [implementation status](IMPLEMENTATION_STATUS.md) for confirmed deployment results and remaining runtime work.

Secure Cloud still runs on one Ubuntu laptop. Uploaded bytes remain at
`/srv/secure-cloud-storage`; Prisma/PostgreSQL still stores metadata, accounts and
sessions. Instrumentation observes requests and reads aggregate metadata; it does
not change authentication, quota accounting, file paths or API responses.

## Architecture

```mermaid
flowchart LR
    Browser -->|HTTPS, optional Quick Tunnel| Cloudflare
    Cloudflare -->|cloudflared to localhost:8080| Nginx
    Browser -->|LAN or localhost:8080| Nginx
    Nginx -->|/| Next[Next.js :3000]
    Nginx -->|/api and /health| API[Fastify :4000]
    Nginx -->|/grafana/| Grafana[Grafana localhost:3002]
    API --> PG[(PostgreSQL localhost:5432)]
    API --> Redis[(Redis localhost:6379)]
    API --> Files[/srv/secure-cloud-storage]
    Host[Ubuntu] --> Node[Node Exporter]
    Docker --> cAdvisor
    Nginx --> NE[Nginx exporter]
    PG --> PE[PostgreSQL exporter]
    Redis --> RE[Redis exporter]
    API --> Metrics[Private metrics :4001]
    Node & cAdvisor & NE & PE & RE & Metrics --> Prometheus
    Docker -->|stdout/stderr| Alloy
    Alloy -->|privacy projection| Loki
    Prometheus & Loki --> Grafana
```

Root `compose.yaml` includes `monitoring/compose.yaml`. The application and
monitoring processes use Linux host networking to preserve the existing localhost
connections. All monitoring listeners explicitly bind `127.0.0.1`. PostgreSQL and
Redis use a bridge network with **localhost-only** published ports. Their existing
external named volumes are reused, not reformatted or replaced. The one-time
adoption script retains the original containers stopped for recovery.

| Component | Purpose | Local endpoint |
|---|---|---|
| Grafana | Provisioned dashboards, Explore and data source proxy | `http://localhost:8080/grafana/` through Nginx |
| Prometheus | Scrapes and stores metrics, evaluates local alerts | `127.0.0.1:9090` |
| Loki | Stores privacy-filtered logs | `127.0.0.1:3100`; internal gRPC `9096` |
| Alloy | Discovers project Docker containers, tails logs, filters and ships them | `127.0.0.1:12345` |
| Node Exporter | Host CPU, memory, disk, filesystem and network metrics | `127.0.0.1:9100` |
| cAdvisor | Container CPU/memory/network, start time and filesystem metrics | `127.0.0.1:8083` |
| Nginx exporter | Reads private Nginx stub status | `127.0.0.1:9113`; stub status `8082` |
| PostgreSQL exporter | Database availability, connections, transactions, size | `127.0.0.1:9187` |
| Redis exporter | Availability, memory, clients, commands, cache hits | `127.0.0.1:9121` |
| Fastify metrics | Request and storage/process metrics | `127.0.0.1:4001/metrics` |
| PostgreSQL / Redis | Existing application dependencies | `127.0.0.1:5432` / `127.0.0.1:6379` |
| cloudflared (optional) | Quick Tunnel to Nginx, container logs collected by Alloy | metrics `127.0.0.1:20241` |

Only Nginx publishes Grafana. Grafana has its own administrator login; application
sessions do not authenticate Grafana. Anonymous access and self-registration are
disabled. The previous application listeners on ports 3000/4000 are unchanged.
Do not forward monitoring/DB ports through the router. Host networking and local
unauthenticated monitoring endpoints assume trusted users/processes on the laptop.

## First-time setup on this existing server

Run from the repository root with Node 22+ and Docker Compose supporting `include`.
Keep a coordinated database/files backup before deployment as usual.

```bash
npm ci
npm run prisma:generate --workspace backend
node monitoring/scripts/prepare.mjs
# One-time brief application outage: reuse existing DB volumes and restrict ports.
bash monitoring/scripts/adopt-databases.sh
docker compose config --quiet
docker compose build
docker compose up -d --wait --wait-timeout 180
```

`prepare.mjs` reads `APP_ENV_FILE` (default `backend/.env`), creates private local
credentials in ignored `monitoring/runtime/`, and creates a dedicated
`secure_cloud_monitor` PostgreSQL role with `pg_monitor`. The exporter does not
use the application's database password. The setup role needs permission to create
roles/grant `pg_monitor`. The script deliberately requires the original database
volumes and a reachable database: it is an **existing-server integration**, not a
fresh database bootstrap. It does not delete application data.

Grafana username is `admin`. Read the generated password locally:

```bash
cat monitoring/runtime/grafana_admin_password
```

Do not paste this file into issues or logs. The runtime directory is mode 0700;
the Grafana password file is readable inside its read-only mount by Grafana's UID.
Grafana persists its login in its database after first boot. Changing the secret
file alone does not reset an already initialized admin password.

For a stable public HTTPS address, set `GRAFANA_ROOT_URL=https://your-host/grafana/`
and `GRAFANA_COOKIE_SECURE=true` in root `.env`, then recreate Grafana. Dynamic Quick Tunnel hosts can change;
update this value after getting a new hostname for correct absolute links. The
Nginx route and same-origin API remain the same. To collect tunnel logs, use the
managed optional container instead of an untracked terminal process:

```bash
docker compose --profile tunnel up -d cloudflared
docker compose logs --tail=50 cloudflared  # obtain the temporary public URL locally
# Stop public exposure:
docker compose --profile tunnel stop cloudflared
```

This is equivalent to `cloudflared tunnel --url http://localhost:8080`. The tunnel
must point to Nginx port **8080**, not Next.js 3000. The existing `scripts/start-cloudflare.sh` and `scripts/stop-cloudflare.sh` remain
the preferred tunnel controls when using WhatsApp notifications. Alloy also tails
their `.runtime/cloudflared.log` through a read-only mount. An arbitrary terminal
cloudflared process is collected only if it writes to that same file. Do not start
the optional Compose tunnel alongside your native tunnel.
Quick Tunnels are optional temporary access, not a durable production hostname.

## Start, stop and restart

Normal complete-stack startup: `docker compose up -d --wait --wait-timeout 180`.
The migration job exits successfully; other enabled services stay running.

```bash
# Only monitoring (does not stop application/database services):
services="prometheus grafana loki alloy node-exporter cadvisor nginx-exporter postgres-exporter redis-exporter"
docker compose up -d $services
docker compose stop $services
docker compose restart $services

# All services; persisted monitoring and database data survive:
docker compose stop
docker compose up -d --wait --wait-timeout 180
```

Do not use `down -v` unless intentionally discarding monitoring history. Database
volumes are external and uploaded bytes are a host bind mount, but an ordinary
`down` now also stops the database containers. Never start the old
`*-before-monitoring` containers while the new ones use the same volumes. After
successful validation, those stopped backup containers can be removed without
`-v`; keep the existing database volumes.

## Metrics and dashboards

Prometheus scrapes all ten configured targets every 30 seconds. Fastify exposes a
separate loopback socket; `/health` is unchanged and `/metrics` through Nginx is
404. Request counters include method, **matched route template**, and response
status. Histograms measure through response completion, including streamed
responses. Upload counters distinguish success/failure/aborted; downloads count
completed HTTP responses, not proof that a client saved the entire file.
Authentication failures count 401 responses and rejected login attempts.

Every 60 seconds the metrics module reads aggregate user/file counts, used bytes,
reserved bytes, total quotas and actual available storage filesystem bytes.
Collection failures set a health gauge and preserve the last known measurements;
request handlers and quota enforcement do not depend on monitoring. Disk free
space and metadata usage differ because other laptop files share the filesystem.
No per-user, per-file, email or token metric labels are emitted.

Grafana provisions two immutable data sources (`prometheus`, `loki`) and seven
versioned dashboards in the **Secure Cloud** folder: Host, Containers, Nginx,
Backend, PostgreSQL, Redis and Storage. Dashboard JSON lives in
`monitoring/grafana/dashboards/`; edit it in Git rather than relying on UI edits.
Each dashboard includes related logs. Nginx traffic/connection metrics come from
stub status; HTTP errors come from its structured access logs in Loki because
open-source stub status does not expose response status counts. Rate/latency
panels need a few scrapes and traffic before showing useful values.

Prometheus includes target-down, low-disk, API-error and stale-storage alert rules.
These appear in Prometheus; no Alertmanager/email/paging destination is configured.

## Logs and privacy

Alloy discovers containers labeled with Compose project `secure-cloud`. Logs from
Nginx, backend, frontend, PostgreSQL, Redis, monitoring services and the optional
cloudflared service flow through a privacy filter into Loki. Positions persist in
`alloy_data`. Container/service discovery refreshes every 15 seconds.

Fastify disables automatic raw URL request logs and emits JSON containing only
method, matched route, status and duration. Its error serializer omits exception
messages/stacks that may contain SQL or credentials. Nginx access logs are JSON
with categorical routes; they omit query strings, headers, IPs and filenames.
Nginx raw error logging is limited to critical failures; access status still
records every HTTP error. PostgreSQL statement logging is disabled.

For backend/Nginx HTTP events, Alloy forwards only the approved JSON fields. Other
messages are classified into info or warning/error events with raw details
omitted. This conservative policy preserves timing, service and error occurrence
without storing potentially sensitive Next.js exceptions, SQL, tunnel URLs or
arbitrary third-party messages in Loki. Full stack traces/free-form diagnostic
messages are deliberately unavailable in Grafana. Docker's local rotated logs may
still contain third-party messages; treat Docker access as privileged and inspect
those logs locally only when necessary. No request bodies or file bytes are added
by this implementation.

Example Explore queries:

```logql
{service="backend"} | json
{service="nginx"} | json | status >= 500
{service=~"frontend|postgres|redis|cloudflared"} | json
```

Alloy has read-only mounts of the Docker socket, but filesystem read-only mode
**does not restrict Docker API privileges**. cAdvisor requires privileged host
visibility on this Linux setup. These are trusted local collectors, not isolated
untrusted workloads; do not expose their interfaces or give untrusted users Docker
access. cAdvisor's export of arbitrary container labels is disabled.

## Retention and laptop resource limits

- Prometheus: seven days and 1 GB TSDB retention (whichever removes older blocks
  sooner); WAL/head chunks need extra space beyond the block retention size.
- Loki: 72 hours, daily index periods, compactor deletion after two hours. Retention
  is time-based, not a hard disk quota; monitor host free space.
- Docker logs: 5 MB × two files per managed container.
- Grafana, Prometheus, Loki and Alloy positions use named persistent volumes.
- Monitoring containers have CPU limits and memory caps totaling about 1.3 GiB
  (plus optional 128 MiB for cloudflared). Actual usage varies; watch the container
  dashboard. PostgreSQL/application resource behavior is unchanged.
- Loki caches are limited to 48 MB combined; query concurrency and ingestion are
  constrained. No Kubernetes, external object storage, S3 or new disk partitions.

## Verification and troubleshooting

```bash
docker compose config --quiet
docker compose ps --all
docker compose exec prometheus promtool check config /etc/prometheus/prometheus.yml
docker compose exec alloy alloy validate /etc/alloy/config.alloy
docker compose exec nginx nginx -t
node monitoring/scripts/verify.mjs
curl -fsS http://localhost:8080/health
curl -fsS http://127.0.0.1:9090/api/v1/targets
curl -fsS http://127.0.0.1:3100/ready
curl -fsS http://127.0.0.1:12345/-/ready
docker stats --no-stream
ss -lnt
```

Wait about 60–90 seconds after startup before the verification script. It checks
all Prometheus targets, exporter-to-service health, the seven dashboards, Grafana
queries against both data sources, and Nginx/backend/frontend/PostgreSQL/Redis
logs. It also checks frontend login, `/health`, unauthenticated API rejection,
and that metrics are not publicly routed. A successful scrape of an exporter alone
is not sufficient: `pg_up`, `redis_up`, and `nginx_up` must also equal 1.

Images with an HTTP client have Docker healthchecks; minimal Loki/NGINX exporter/Alloy images
are checked through their real scrape/readiness endpoints by Prometheus and the
verification script rather than misleading process-only Docker healthchecks.
Docker restarts failed processes; an unhealthy healthcheck alone does not restart
a still-running process.

If a target is down, inspect its local `/metrics` and the service's local logs.
For PostgreSQL permissions rerun `prepare.mjs`, then recreate postgres-exporter.
For missing container metrics check `/sys`, Docker's data root and `/dev/kmsg`
mount availability. For missing logs check Alloy configuration, container project
labels, socket access, and Loki `/ready`; after restarting a service allow discovery
and batching time. Loki rejects logs older than retention. For Grafana 502 check
its health and port 3002; for bad redirects update `GRAFANA_ROOT_URL` and recreate
Grafana. For OOM restarts inspect `docker inspect` State.OOMKilled and actual RAM
before raising limits. Stop monitoring services if the laptop needs resources;
application routes remain functional except Grafana itself.

Run automated regression checks against a **disposable database**, never the live
one: existing security tests delete test tables. `bash scripts/smoke-containers.sh
secure-cloud-backend:local secure-cloud-frontend:local` creates disposable containers
and tests auth, CORS, upload/list/download/delete, quota and frontend routes.

For the existing GitHub Actions production job, prepare credentials once in a
persistent directory outside its checkout using
`MONITORING_RUNTIME_DIR=/etc/secure-cloud/monitoring APP_ENV_FILE=/etc/secure-cloud/backend.env node monitoring/scripts/prepare.mjs`
with an account allowed to write that directory and administer the database.
The deployment job checks for these files before changing containers. Local
commands use `monitoring/runtime` by default; set the same variable when operating
a deployment that uses the persistent directory. CI validates Compose with dummy
credentials and validates Prometheus, Alloy, Loki and Nginx configuration without
using production secrets.

To exercise the **running** application after deployment, run
`npm run build --workspace backend && node monitoring/scripts/smoke-live.mjs`.
This explicitly creates a randomly named temporary account, uploads/downloads a
small test file through Nginx, verifies usage and deletion, logs out, then removes
only that test account and any remaining owned test bytes. It uses the configured
application database to clean up its own test records, so run it deliberately
rather than using the destructive integration-test suite against production.

Configuration references: [Alloy log processing](https://grafana.com/docs/alloy/latest/tutorials/processing-logs/),
[Loki retention](https://grafana.com/docs/loki/latest/operations/storage/retention/),
[Grafana settings](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/),
and [Node Exporter host mounts](https://github.com/prometheus/node_exporter).
Grafana plugin auto-installation is disabled to avoid unnecessary downloads and
background components on the laptop. Only built-in Prometheus/Loki data sources
and built-in dashboard panels are used.

## Existing WhatsApp integration

The WhatsApp scripts and `WHATSAPP_*` environment variables are preserved.
Monitoring does not send messages or read their API token. Native cloudflared logs
use the same privacy filter as container logs, with `service="cloudflared"`.
The `.runtime` directory is excluded from Git and Docker build contexts. If the
scripts use a custom `RUNTIME_DIR`, set `CLOUDFLARED_RUNTIME_DIR` to the same absolute
path for Compose and `prepare.mjs`. Create the directory as your application user
before starting Alloy; Compose deliberately refuses to create it as root.

`prepare.mjs` generates a local logrotate configuration for the native tunnel log
(5 MB, two compressed rotations, copytruncate to preserve the running writer).
Schedule this command with your user's cron if the native tunnel runs continuously:

```bash
logrotate --state monitoring/runtime/logrotate.status monitoring/runtime/cloudflared-logrotate.conf
```

Unlike Docker log rotation, native rotation requires the host `logrotate` command
and a schedule. Neither WhatsApp script is invoked by monitoring. See
[WhatsApp operations](../deploy/WHATSAPP.md) for lifecycle fixes, approved templates,
and notification retry commands.
