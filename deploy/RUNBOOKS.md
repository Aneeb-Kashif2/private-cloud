# Runbooks

One runbook per alert. Every alert rule in `monitoring/prometheus/alerts.yml` and
`monitoring/prometheus/slo-rules.yml` links here through its `runbook` annotation, so an alert
that arrives at 3 a.m. comes with instructions rather than a mystery.

**How to use this file.** Find the alert name, read *What it means*, run the commands under
*First checks*, then follow *Diagnosis*. Each runbook ends with the specific signal that clears
the alert, so you know when to stop.

**Never do these while diagnosing:** do not delete files under `/srv/secure-cloud-storage`, do
not run `prisma migrate reset`, do not edit a historical migration, and do not restart the
database container to "see if it helps" while uploads are in flight.

## Index

| Alert | Severity | Meaning |
|---|---|---|
| [`ScrapeTargetDown`](#scrapetargetdown) | warning | A monitored component stopped answering |
| [`HostFilesystemLow`](#hostfilesystemlow) | warning | Less than 10% disk free |
| [`BackendErrors`](#backenderrors) | warning | More than 5% of API responses are 5xx |
| [`StorageMetricsStale`](#storagemetricsstale) | warning | Storage gauges are not being collected |
| [`SecureCloudBackupUnhealthy`](#securecloudbackupunhealthy) | warning | Backup failed, or none succeeded in 36 hours |
| [`SecureCloudAvailabilityFastBurn`](#availability-fast-burn) | critical | Burning the availability budget 14.4x too fast |
| [`SecureCloudAvailabilitySlowBurn`](#availability-slow-burn) | warning | Burning the availability budget 6x too fast |
| [`SecureCloudUploadReliabilityFastBurn`](#upload-failures) | warning | Uploads failing far above budget |
| [`SecureCloudMetadataLatencyHigh`](#latency) | warning | p95 metadata latency above 1s for 10 minutes |
| [`SiteUnreachable`](#site-unreachable) | critical | *Planned.* The public entry point is unreachable |
| [`RestoreDrillOverdue`](#restore-drill-overdue) | warning | *Planned.* No verified restore drill in 14 days |

---

## ScrapeTargetDown

**What it means.** Prometheus cannot scrape a target, so its `up` metric has been `0` for three
minutes. The component may be down, or it may be up but unreachable.

**Impact.** Observability is degraded, not necessarily the application. If the target is
`backend` (`127.0.0.1:4001`) you have lost request metrics on the API, so confirm whether the API
is still serving before you assume it is only a monitoring problem.

**First checks.**

```bash
make ps                                    # which containers are running or restarting?
make health                                # is the application actually serving?
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4001/metrics
```

To find the failing target precisely:

```bash
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=up==0' | jq -r '.data.result[].metric.job'
```

**Diagnosis.**

| Observation | Likely cause |
|---|---|
| One target down, containers healthy | The exporter container stopped, or its port changed |
| `frontend`/`nginx` down but the site works | A failing healthcheck while the process still serves |
| All targets down together | Prometheus restarted, or Docker networking is broken |
| Target down right after a deploy | A service did not come back; look for a restart loop |

**Remediation.** Restart only the affected service (`docker compose restart <service>`). If it is
in a restart loop, read `docker compose logs --tail=200 <service>` before restarting again. If the
target is `backend` and the API is serving fine, treat it as metrics-only and continue.

**Escalation.** Silence the alert in Alertmanager (`http://127.0.0.1:9093`) only after writing
down why.

**Resolved.** `up{job="<target>"} == 1` sustained for one scrape interval; the alert clears itself
after `for: 3m`.

---

## HostFilesystemLow

**What it means.** A real filesystem (excluding `tmpfs`, `overlay`, `squashfs`) has been below 10%
free for ten minutes.

**Impact.** This is the outage you get to prevent. When `/srv` fills, uploads fail with `502`, the
PostgreSQL WAL cannot grow, and Docker stops being able to write container logs. Once PostgreSQL
cannot write, recovery means a restore rather than a cleanup.

**First checks.**

```bash
df -h / /srv /var/lib/docker
make ps
sudo du -sh /srv/secure-cloud-storage /var/lib/docker/containers /srv/secure-cloud-backups 2>/dev/null
```

**Diagnosis.**

| Observation | Likely cause |
|---|---|
| `/srv/secure-cloud-storage` growing | Normal user data. Compare with the quota trend before assuming a fault |
| `/var/lib/docker` large | Images and build cache; `docker system df` shows the split |
| `/srv/secure-cloud-backups` large | Backups are not being pruned |
| Space gone but files are not | A deleted file still held open by a process (`lsof +L1`) |

**Remediation, in order of safety.**

1. `docker image prune -af` — safe; images are reproducible from the pipeline.
2. Prune old backups per your retention policy, **after** verifying the newest one:
   `make verify-backup DIR=/srv/secure-cloud-backups/<newest>`.
3. Move the backup directory to another filesystem or an external drive.
4. Only if the storage filesystem itself is the problem: grow the volume, or move bytes out via the
   storage adapter. Do **not** hand-delete files from `/srv/secure-cloud-storage` — metadata would
   still reference them and downloads would return `404` for files the UI still lists.

**Escalation.** If a prune does not recover at least 20% free space, stop and plan a capacity
change rather than repeatedly freeing crumbs.

**Resolved.** `node_filesystem_avail_bytes / node_filesystem_size_bytes >= 0.1` for the affected
mount, sustained for 10 minutes.

---

## BackendErrors

**What it means.** More than 5% of API responses have been 5xx over a 5-minute window, sustained
for at least five minutes.

**Impact.** Users are seeing failures. Upload and download failures hurt most, because they also
waste bandwidth and time.

**First checks.**

```bash
make logs
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=sum(rate(secure_cloud_http_requests_total{status_code=~"5.."}[5m]))by(route)' | jq -r '.data.result[] | "\(.metric.route) \(.value[1])"'
curl -sS http://127.0.0.1:4001/metrics | grep -E 'secure_cloud_(http_errors|upload_failures|storage_collection)'
```

**Diagnosis.**

| Pattern | Likely cause |
|---|---|
| 5xx concentrated on `/api/files/upload` | Database down, quota SQL failing, or a full or read-only storage filesystem |
| 5xx on every route at once | PostgreSQL unreachable, or the backend is out of memory |
| 5xx only on `/api/files/:id/download` | Storage bytes missing (metadata says they exist) or permissions changed |
| 5xx with a storage-delete failure event | The disk delete failed; metadata is deliberately preserved, so fix the filesystem |
| Errors began exactly at a deploy | Bad image or incompatible migration — see *Remediation* |

**Remediation.**

- **Database outage:** `docker compose ps postgres`, then
  `docker compose logs --tail=200 postgres`. The API returns `500` but does not corrupt state.
- **Disk full:** go to [`HostFilesystemLow`](#hostfilesystemlow) immediately.
- **Bad deploy:** switch the Nginx upstream back to the previous colour and reload (see
  `DEVOPS_UPGRADE_PLAN.md` §5.3). If a migration is implicated, do **not** revert the schema —
  deploy a fix forward, because reverting a schema is riskier than shipping a correction.

**Resolved.** The 5xx ratio is at or below 5% for five minutes.

---

## StorageMetricsStale

**What it means.** The aggregate storage collection either failed
(`secure_cloud_storage_collection_success == 0`) or has not run for more than 180 seconds, for
three minutes.

**Impact.** You are blind to disk growth and quota consumption, which are the two numbers that
prevent the next outage. The application itself is unaffected: collection runs on a 60-second timer
inside the backend and a failure never fails a request.

**First checks.**

```bash
make health
curl -sS http://127.0.0.1:4001/metrics | grep -E 'secure_cloud_storage_collection|secure_cloud_storage_(used|reserved|quota)_bytes|secure_cloud_storage_filesystem_available_bytes'
docker compose logs --tail=100 backend | grep -i 'storage_metrics_collection_failed'
```

**Diagnosis.**

| Observation | Likely cause |
|---|---|
| `collection_success 0` plus a database error in logs | PostgreSQL unreachable, so the aggregate query fails |
| `collection_success 1` but an old timestamp | The collector timer stopped: the backend restarted repeatedly, or the process is wedged |
| `filesystem_available_bytes` very low | Not a collection fault — go to [`HostFilesystemLow`](#hostfilesystemlow) |
| Only `reserved_bytes` climbing | Aborted uploads are leaking reservations; see *Remediation* |

**Remediation.**

- A collection failure caused by the database: fix the database first; collection resumes by itself.
- A wedged collector: `docker compose restart backend`. The endpoint is designed so a slow query
  cannot pile up (a `collecting` flag skips overlapping runs), so restarting is safe.
- **Reservations climbing while usage stays flat.** This is the exact failure mode that
  reserve-then-write exists to make harmless, and it is the one case where changing a counter by
  hand is correct:

  ```bash
  make down
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c 'UPDATE "User" SET "storageReserved" = 0;'
  make db-recalculate
  make up
  ```

  Before doing this, list orphan UUID files in the storage directory and reconcile them against the
  `File` table: a leaked reservation usually arrives with a leaked partial file.

**Escalation.** If reservations leak repeatedly, find the trigger — usually a proxy or tunnel
timeout cutting uploads mid-stream — rather than resetting counters every time.

**Resolved.** `secure_cloud_storage_collection_success == 1` and the timestamp is under 180 seconds
old.

---

## SecureCloudBackupUnhealthy

**What it means.** Either the last backup attempt failed
(`secure_cloud_backup_last_attempt_success == 0`) or no backup has succeeded in more than 36 hours
(129600 seconds). The metrics come from the Node Exporter textfile collector, written by the
backup scripts.

**Impact.** This is the highest-consequence warning in the system. Everything else here degrades
service; this one decides whether you can recover at all. It is routed to the `data-safety`
receiver with a 10-second group wait for exactly that reason.

**First checks.**

```bash
curl -sS http://127.0.0.1:9100/metrics | grep secure_cloud_backup
ls -1dt /srv/secure-cloud-backups/* 2>/dev/null | head -3
sudo journalctl -u secure-cloud-backup --no-pager -n 50
```

**Diagnosis.**

| Observation | Likely cause |
|---|---|
| No backup directories at all | The timer was never installed or enabled (it is deliberately not enabled by the installer) |
| A directory exists but `postgres.dump` is missing | The database dump failed, often because the database was down |
| A directory exists but `storage.tar.gz` is missing | The filesystem half failed; usually permissions on `/srv/secure-cloud-storage` |
| Failure log mentioning a lock | Another backup is still running, or a stale lock was left behind |
| Failure log mentioning permissions | Backups must run as root into a root-owned `0700` directory |

**Remediation.**

```bash
# Run one manually and read the JSON log output.
sudo bash scripts/backup.sh

# Then prove it is usable — never assume.
sudo bash scripts/verify-backup.sh /srv/secure-cloud-backups/<newest>

# Enable the daily timer if it is not installed.
sudo cp deploy/systemd/secure-cloud-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now secure-cloud-backup.timer
systemctl list-timers secure-cloud-backup.timer
```

**Escalation.** Treat two consecutive failures as an incident. Run the
[restore drill from the upgrade plan](../DEVOPS_UPGRADE_PLAN.md#58-a-scheduled-disaster-recovery-drill)
before doing anything else, because at that point you do not know whether your only copy is good.

**Resolved.** A successful attempt plus a successful verification, and
`secure_cloud_backup_last_success_timestamp_seconds` is recent.

---

## Availability fast burn

**Alert:** `SecureCloudAvailabilityFastBurn` (critical, SLO `availability-99.5-30d`).

**What it means.** Both the 5-minute and 1-hour availability ratios are burning the 30-day error
budget at more than 14.4x. At this rate the whole monthly budget is gone in about two days.

**Impact.** Users are failing requests right now. This is the alert that should wake someone up.

**First checks.**

```bash
make health
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=secure_cloud:sli_availability:ratio_rate5m' | jq -r '.data.result[0].value[1]'
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=sum(rate(secure_cloud_http_requests_total{status_code=~"5.."}[5m]))by(route)' | jq -r '.data.result[] | "\(.metric.route) \(.value[1])"'
```

**Diagnosis.** Both windows must be over the threshold for this to fire, so one bad scrape cannot
cause it — the error rate is genuinely sustained. The route breakdown tells you whether the failure
is concentrated (one broken endpoint) or broad (a shared dependency such as PostgreSQL or the disk).

| Shape of the failure | Go to |
|---|---|
| Broad 5xx across routes | [`BackendErrors`](#backenderrors) |
| Only upload routes failing | [`Upload failures`](#upload-failures) |
| Only the latency objective also breaching | [`Latency`](#latency) |
| A target missing from the metrics entirely | [`ScrapeTargetDown`](#scrapetargetdown) |

**Remediation.** Work [`BackendErrors`](#backenderrors) first. If the application is fundamentally
broken and a previous colour is available, switching the upstream back and reloading is faster than
diagnosing under pressure — but keep the failing colour running so the evidence survives.

**Escalation.** Wake someone. A fast burn is an active incident by definition, not a trend.

**Resolved.** Both windows are below the threshold and the alert clears after `for: 2m`. Only then
write down the window and check the burn on the SLO dashboard.

---

## Availability slow burn

**Alert:** `SecureCloudAvailabilitySlowBurn` (warning, SLO `availability-99.5-30d`).

**What it means.** The 30-minute and 6-hour availability ratios are burning the budget at more than
6x. Slower than the fast burn, but a real trend: this rate exhausts the monthly budget in about
five days.

**Impact.** Users see intermittent failures. Nothing is on fire, which is exactly why this alert
exists — it catches a problem during working hours instead of at 3 a.m.

**First checks.**

```bash
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=secure_cloud:sli_availability:ratio_rate30m' | jq -r '.data.result[0].value[1]'
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=secure_cloud:sli_availability:ratio_rate6h' | jq -r '.data.result[0].value[1]'
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=sum(increase(secure_cloud_http_requests_total{status_code=~"5.."}[6h]))by(route,status_code)' | jq -r '.data.result[] | "\(.metric.route) \(.metric.status_code) \(.value[1])"'
```

**Diagnosis.** A slow burn usually has one of four shapes:

1. **A rare but recurring error** — one route, one status code, spread thinly across six hours. Look
   for a common request shape, file size or query parameter.
2. **A resource slowly filling** — disk, memory or connection pool. Cross-check
   `secure_cloud_storage_filesystem_available_bytes` and the cAdvisor memory panels.
3. **An upstream dependency flapping** — Cloudflare or the tunnel dropping connections. The browser
   sees a failure that never reaches the API, so the 5xx count understates user impact.
4. **A leak** — if the error rate rises with uptime and a restart resets it, you have found the
   shape of the bug.

**Remediation.** Fix the specific cause. Do **not** "fix" it by editing the SLO: if the target is
wrong, change it in a separate reviewed change with the reason recorded in the commit message.

**Escalation.** This alert does not require waking anyone. It requires an owner and a diagnosis
before the budget is gone.

**Resolved.** Both windows are below the threshold, sustained for `for: 15m`.

---

## Upload failures

**Alert:** `SecureCloudUploadReliabilityFastBurn` (warning, SLO `upload-success-99-30d`).

**What it means.** The upload success ratio is burning its budget at more than 14.4x over both the
5-minute and 1-hour windows. Uploads are weighted separately from availability because a failed
multi-gigabyte transfer costs the user far more than a failed metadata read.

**Impact.** Users are losing time and bandwidth. Because uploads reserve quota before writing, this
is also the alert that most often points at reservation hygiene.

**First checks.**

```bash
curl -sS http://127.0.0.1:4001/metrics | grep -E 'secure_cloud_(uploads|upload_failures)'
make logs | grep -Ei 'quota|reserved|UPLOAD_MISMATCH|FILE_TOO_LARGE|STORAGE'
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=secure_cloud_storage_reserved_bytes' | jq -r '.data.result[0].value[1]'
```

**Diagnosis.** Distinguish these carefully, because the right response for each is different:

| Outcome in the metrics | Meaning | Is it a bug? |
|---|---|---|
| `413 QUOTA_EXCEEDED` | Correct enforcement: the user is over quota | **No.** A spike means someone reached the limit |
| `413 FILE_TOO_LARGE` | Correct enforcement: above the per-file cap | **No** |
| `415 INVALID_FILE_TYPE` / `INVALID_CONTENT_TYPE` | Client sent the wrong content type | No, but check the frontend has not regressed |
| `409 UPLOAD_MISMATCH` | Declared size did not match the bytes received | Often an interrupted connection |
| `502 STORAGE_ERROR`, or disk full | The storage filesystem is failing | **Yes** |
| Aborted uploads climbing | Clients disconnect mid-transfer | Yes, if constant |

> **Important nuance:** the SLO measures *success ratio*, so legitimate `413` rejections lower it.
> Before treating this as an incident, check whether the "failures" are enforcement working as
> designed. If they are, the correct action is to document it — not to loosen the quota.

**Remediation.** For a storage or disk cause, go to [`HostFilesystemLow`](#hostfilesystemlow). For
leaked reservations, use the reset procedure in [`StorageMetricsStale`](#storagemetricstale). For
client aborts, check proxy and tunnel timeouts: an `nginx` or `cloudflared` timeout below the time a
large upload needs will abort transfers the application would otherwise have accepted.

**Escalation.** If aborts stay above roughly 10% of attempts, the upload path is effectively broken
for large files. Treat it as an incident.

**Resolved.** The ratio is back within budget across both windows, sustained for `for: 5m`.

---

## Latency

**Alert:** `SecureCloudMetadataLatencyHigh` (warning, SLO `latency-1s-p95`).

**What it means.** The p95 duration of non-streaming API requests has been above one second for ten
minutes. Streaming routes (`upload`, `download`, `backup`) are deliberately excluded, because their
duration tracks file size and client bandwidth rather than API performance.

**Impact.** The application works but feels slow. Slow metadata reads are the classic early symptom
of a database problem, so treat this as an early warning rather than an annoyance.

**First checks.**

```bash
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=secure_cloud:sli_latency_seconds:p95_rate5m' | jq -r '.data.result[0].value[1]'
curl -sS 'http://127.0.0.1:9090/api/v1/query?query=histogram_quantile(0.95, sum by (le, route) (rate(secure_cloud_http_request_duration_seconds_bucket[5m])))' | jq -r '.data.result[] | "\(.metric.route) \(.value[1])"'
docker compose stats --no-stream postgres redis backend
```

**Diagnosis.**

| Observation | Likely cause |
|---|---|
| One route slow, others fine | A missing index, or an unindexed search over a large table |
| All routes slow together | PostgreSQL under pressure: connection saturation, autovacuum, or a cold page cache |
| Slow only after a restart | Cold cache: the Redis metadata cache is repopulating |
| `postgres` CPU pinned | An expensive query, often a `contains` search on a large table |
| Redis timing out but everything still works | Expected: cache failures are swallowed by design and fall back to PostgreSQL, which is slower but correct |

**Remediation.**

- Confirm PostgreSQL has headroom: `docker compose stats --no-stream postgres`.
- Look for long-running queries:

  ```bash
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "SELECT pid, now() - query_start AS duration, left(query, 80) FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 5;"
  ```

- If an index is needed, add it in a migration — but check first whether the provider already covers
  it: `File` is indexed on `(userId, folderId)`, `(userId, originalName)`, `(userId, createdAt)` and
  `(userId, mimeType)`.
- If Redis looks like the cause, do **not** disable it. It also carries rate-limit state.

**Escalation.** If p95 stays above one second for an hour, stop treating it as noise and profile the
slowest route properly.

**Resolved.** `secure_cloud:sli_latency_seconds:p95_rate5m <= 1`, sustained for ten minutes.

---

## Site unreachable

**Alert:** `SiteUnreachable` — **planned**, arriving with the blackbox exporter
(see [`DEVOPS_UPGRADE_PLAN.md`](../DEVOPS_UPGRADE_PLAN.md) §5.11).

**What it means.** A synthetic probe of the public entry point has been failing for two minutes, so a
real user could not load the site. The probe asserts on the health payload rather than merely a 200,
so an application answering with an error is caught too.

**Impact.** Total outage for everyone outside the host. Highest possible severity.

**First checks.**

```bash
make ps
make health
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health        # local Nginx
curl -sS -o /dev/null -w '%{http_code}\n' https://<public-hostname>/health    # through the tunnel
sudo systemctl status cloudflared 2>/dev/null || docker compose logs --tail=50 cloudflared
```

**Diagnosis.** Work outwards from the host. If the local Nginx check succeeds and the public one
fails, the fault is the tunnel, DNS or Cloudflare rather than the application.

| Local Nginx | Public URL | Likely cause |
|---|---|---|
| OK | Fails | Tunnel down, expired credentials, or DNS |
| Fails | Fails | Nginx or the application is down |
| OK | OK now | Transient network blip, or a probe-only failure |

**Remediation.** Restart the tunnel first: it is the most common single point of failure and the
cheapest to fix. Only then investigate the application. If the tunnel credentials are expired or
revoked, re-issue them before restarting.

**Escalation.** A total outage needs immediate attention. If the tunnel cannot be restored quickly,
serve from the local network and say clearly what is and is not available.

**Resolved.** `probe_success == 1` for the public target, sustained for two minutes.

---

## Restore drill overdue

**Alert:** `RestoreDrillOverdue` — **planned**, arriving with the drill script
(see [`DEVOPS_UPGRADE_PLAN.md`](../DEVOPS_UPGRADE_PLAN.md) §5.8).

**What it means.** No restore drill has succeeded in 14 days, so your backups are an untested
assumption rather than a verified capability.

**Impact.** None yet. This alert exists so you find out *before* you need a restore, rather than
during one.

**First checks.**

```bash
curl -sS http://127.0.0.1:9100/metrics | grep secure_cloud_drill
ls -1dt /srv/secure-cloud-backups/* | head -3
systemctl status secure-cloud-drill.timer 2>/dev/null || echo 'timer not installed'
```

**Diagnosis.** Either the timer is not installed, the drill is failing, or the metric is not being
written. Run the drill by hand and read its output. The usual causes are: the newest backup fails
verification, the isolated Compose project cannot start because a port is already held by
production, or the metric file is not writable by the Node Exporter container.

**Remediation.** Run the drill manually, fix the underlying cause, then re-enable the timer. If the
newest backup fails verification, go to
[`SecureCloudBackupUnhealthy`](#securecloudbackupunhealthy) immediately — that is a real data-safety
problem, not a missing test.

**Escalation.** Two consecutive failed drills means backup integrity is in question. Treat it as an
incident.

**Resolved.** `secure_cloud_drill_last_success_timestamp_seconds` is under 14 days old.

---

## General procedures

### Silencing an alert without hiding a problem

Open `http://127.0.0.1:9093`, create a silence with a **matcher on the alertname and instance**, set
an expiry, and put the reason and your name in the comment. A silence with no comment is
indistinguishable from a forgotten problem. Silences expire automatically; never delete a rule to
stop an alert.

Only Nginx port `8080` is public, and Alertmanager listens on loopback, so silencing requires host
access. That is intentional: nobody should be able to mute an alert over the internet.

### Silencing everything at once, safely

For planned maintenance, prefer a silence scoped to the maintenance window over stopping Prometheus:
you keep the metrics for the incident review afterwards.

### Testing an alert change before you merge it

An alert expression is code, so test it. `monitoring/prometheus/alerts.test.yml` and
`monitoring/prometheus/slo-rules.test.yml` are driven by `promtool`, and `make validate` runs both
plus `amtool check-config` and `nginx -t`.

```bash
make validate
```

Add a case for every new rule. Include a **negative** case — traffic that should not alert — for the
same reason the SLO tests do: an alert that always fires passes any positive-only test.

### Adding a new alert

1. Add the rule to `alerts.yml` (symptom-based) or `slo-rules.yml` (budget-based).
2. Give it `severity`, a `summary`, and a `runbook` annotation pointing at a section in this file.
3. Add a unit test with both a firing and a non-firing case.
4. Add the section here, following the seven-part structure.
5. Confirm in Alertmanager that it routes where you expect, and that no `inhibit_rule` swallows it.
6. Run `make validate`.

An alert without a runbook, a test and a destination is not finished. It is a future 3 a.m.
argument with nobody to have it with.

### Escalation policy for a single-operator deployment

| Severity | Response |
|---|---|
| critical | Act immediately. If you cannot act within 15 minutes, take the site into a safe state (stop accepting uploads) rather than leaving it degraded |
| warning | Act within the working day. Write down the window and the cause even if the fix is trivial |
| informational | Review weekly on the Grafana dashboards |

Because there is exactly one operator, "escalate" means *stop, write down what you know, and get the
system into a safe state* — not *find someone else*. That is why the backup and restore runbooks
come first in this file.