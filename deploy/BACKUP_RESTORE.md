# PostgreSQL and local-file backup operations

The scripts operate on the existing Docker PostgreSQL service and Ubuntu directory
`/srv/secure-cloud-storage`. They do not create another storage architecture,
replace Docker volumes, change `.env`, run migrations, or send WhatsApp messages.
Run them from a trusted checkout with root privileges, Docker access, Python 3,
and GNU tar. PostgreSQL dump/restore binaries are reused inside the running
PostgreSQL container; no host PostgreSQL client or extra Python packages are needed.

## Backup

```bash
sudo bash scripts/backup.sh
```

The default destination is `/srv/secure-cloud-backups`, owned by root with mode
0700. Backup files use 0600. An existing destination with broader permissions is
rejected rather than silently changing its ownership. The destination must be
outside the storage directory. `.env` and secrets are not included in the backup.
Keep a separately protected copy of deployment configuration and compatible images.

Each invocation:

1. Acquires an exclusive lock shared by backup, restore and verification.
2. Checks the expected Compose service labels, PostgreSQL volume, backend storage
   mount and database name/user. PostgreSQL must already be running.
3. Stops the backend with its existing five-minute graceful shutdown allowance.
   A forced or unsuccessful shutdown causes backup to fail rather than claim a
   consistent snapshot. Other database clients must be stopped, except the
   dedicated read-only `secure_cloud_monitor` exporter.
4. Creates a PostgreSQL custom-format `pg_dump` and a compressed GNU tar archive.
   The backend remains stopped through archive creation and verification. Nginx
   may return 502/503 for API traffic during this maintenance window.
5. Checks every archive/file hash and reads the native dump with `pg_restore`
   without executing SQL. Completed artifacts are flushed and atomically published.
6. Starts the backend only if it was running before the operation, waits for health,
   then applies retention. Failure before publication removes this operation's
   partial output and attempts to resume the original backend state.

Do not run deployments, migrations, native backend processes, manual SQL writers
or manual file modifications concurrently. The scripts coordinate with each other,
not with arbitrary external processes. A snapshot preserves existing data; it does
not repair pre-existing quota, orphan-file or metadata inconsistencies.

A completed backup looks like:

```text
backup-20260912T220000Z-0123abcd/
  manifest.json
  manifest.sha256
  postgres.dump
  storage.tar.gz
```

The manifest includes a UTC timestamp, backup ID, format version, database name,
PostgreSQL major version, backend image ID, file count, logical storage size in
bytes, artifact SHA-256 checksums and a per-entry inventory. Each regular file has
its own SHA-256, size, mode, UID, GID and modification time. The tar archive also
preserves directory metadata, ACLs and extended attributes. Source links/devices
are rejected; archive traversal, duplicate entries and links/devices are rejected
before extraction. Hard-linked source files are archived as independent files.
Filesystem inode numbers, birth/change times and hard-link relationships are not
preserved. Numeric ownership is restored, so retain compatible host UID/GID mapping.

## Verify a selected backup

```bash
sudo bash scripts/verify-backup.sh /srv/secure-cloud-backups/backup-20260912T220000Z-0123abcd
```

Verification checks private ownership/permissions, expected artifact names,
manifest and artifact hashes, gzip integrity, safe tar structure, per-file hashes,
metadata inventory and totals. It fully decodes the PostgreSQL custom archive to
`/dev/null` inside the existing PostgreSQL container. It does not restore SQL,
modify user files or stop the backend. Verification therefore needs Docker and the
PostgreSQL container running even though it does not connect to the database.

Checksums detect corruption, not malicious replacement of both backup and manifest.
Only restore trusted backups: PostgreSQL dumps can contain executable SQL. This
verification is not a substitute for a controlled recovery drill on a separate
machine; it does not prove that every SQL statement can replay on another schema.

## Restore, with explicit confirmation

```bash
sudo bash scripts/restore.sh /srv/secure-cloud-backups/backup-20260912T220000Z-0123abcd
```

An interactive terminal is required. Type the exact `RESTORE <backup-directory>`
phrase printed by the script; there is no unattended confirmation bypass.
Restoring the same snapshot twice returns the same application data, while creating
new recovery copies each time. User changes made after the selected snapshot are
replaced in the active dataset, but are preserved in the recovery snapshot/tree.

The selected backup must match the database name, PostgreSQL major version and
**exact backend image ID** stored in its manifest. Deploy that compatible image
first; do not migrate the database to a newer schema as part of recovery. Docker
images are not bundled in backups, so retain the original image or its registry
reference. This is a restore into the existing deployment, not provisioning a new
host/database. The storage directory must be a real directory, not a symlink or
separate mount point, to support staging and directory renames safely.

Restore verifies the selected backup before changing anything, then:

1. Stops/drains the backend and creates a verified `recovery-*` snapshot of the
   current database and files. A failure here leaves the live dataset unchanged.
2. Extracts into a private sibling staging directory under `/srv`, preserving
   ownership, modes, modification times, ACLs and xattrs, and flushes staged data.
3. Writes `restore-state.json` with recovery and staging paths. Uses PostgreSQL
   `pg_restore --clean --if-exists --single-transaction --exit-on-error`, without
   changing roles, role passwords or grants from other environments.
4. Moves the previous storage tree under the private staging directory and moves
   the extracted tree to `/srv/secure-cloud-storage`. Docker mounts remain configured
   to that same path; the stopped backend resolves it when restarted.
5. Checks that restored file metadata references archived files with matching sizes.
   Invalidates only Redis keys beginning `selfcloud:` to prevent stale session/file
   caches from referring to the pre-restore state. Redis volumes and other keys are
   preserved; there is no `FLUSHDB` or `FLUSHALL`.
6. Marks restore complete and restarts the backend only if it was originally running.

Database and filesystem changes cannot share one transaction. If an error occurs
once database replacement starts, the backend stays stopped. Do not start it until
you have inspected `restore-state.json`, the `recovery-*` snapshot and the staging
paths. The database transaction rolls back SQL failures, but errors after its
commit may require restoring the recorded recovery snapshot. A failure after the
file swap retains the previous file tree as `previous-files` under a root-only
`.secure-cloud-restore-*` directory. These recovery artifacts are never removed
by retention; remove them manually only after validating successful recovery.

Allow space for the backup, a full staged storage tree, the retained old tree,
and PostgreSQL restore/WAL work. The script checks staging space but cannot predict
all database/WAL space needs. Power loss/SIGKILL can leave a `.partial-*` backup or
maintenance state; inspect before manually removing partial output or restarting
services. Partial backups are never eligible for retention or listed as successful.
The user/database data is not encrypted by these tools; root-only permissions do
not protect against loss/theft of the physical disk. A second independently
protected copy is necessary for recovery from failure of the laptop's disk.

## Configuration and retention

Settings are process environment variables. Optional systemd configuration belongs
in `/etc/secure-cloud/backup.env`, based on [backup.env.example](backup.env.example).
The scripts do not source that file automatically during interactive invocation;
pass overrides with `sudo env` as below. No database passwords belong in it.

```bash
sudo env BACKUP_DIR=/srv/secure-cloud-backups BACKUP_RETENTION_DAYS=30 bash scripts/backup.sh
```

| Variable | Default |
| --- | --- |
| `BACKUP_DIR` | `/srv/secure-cloud-backups` |
| `BACKUP_RETENTION_DAYS` | `14`; `0` disables pruning |
| `BACKUP_METRICS_DIR` | `/var/lib/secure-cloud-monitoring`; empty disables metrics |
| `BACKUP_POSTGRES_CONTAINER` | `self-cloud-prj-postgres-1` |
| `BACKUP_BACKEND_CONTAINER` | `secure-cloud-backend-1` |
| `BACKUP_REDIS_CONTAINER` | `self-cloud-prj-redis-1` |
| `BACKUP_COMPOSE_PROJECT` | `secure-cloud` |

The existing PostgreSQL volume must still be `self-cloud-prj_postgres_data` and
storage must remain `/srv/secure-cloud-storage`. Retention runs only after a
successful backup and backend restart. It keeps at least the two newest valid
completed regular backups and removes older ones past the configured age. It
ignores unrelated directories, incomplete backups and all `recovery-*` snapshots.
Always use the same `BACKUP_DIR` for scheduled and manual operations if they should
share retention/status. Repeated runs never overwrite an earlier snapshot.

## Enable the daily systemd timer

The supplied service defaults to `/opt/secure-cloud`. Install the units, then
adjust the two project paths to your actual trusted checkout before enabling:

```bash
sudo install -m 0644 deploy/systemd/secure-cloud-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/secure-cloud-backup.timer /etc/systemd/system/
sudo systemctl edit secure-cloud-backup.service
```

For this project's current checkout, the override is:

```ini
[Service]
WorkingDirectory=/home/aneeb-kashif/Desktop/self-cloud-prj
ExecStart=
ExecStart=/usr/bin/bash /home/aneeb-kashif/Desktop/self-cloud-prj/scripts/backup.sh
```

If desired, create `/etc/secure-cloud/backup.env` from the example with mode 0600;
do not overwrite an existing configuration. Then:

```bash
sudo systemctl daemon-reload
# Optional first real backup; this briefly stops the backend:
sudo systemctl start secure-cloud-backup.service
sudo systemctl enable --now secure-cloud-backup.timer
systemctl list-timers secure-cloud-backup.timer
journalctl -u secure-cloud-backup.service --since today
# Disable scheduling without deleting any backup or application data:
sudo systemctl disable --now secure-cloud-backup.timer
```

The timer runs daily at 03:00 in the host's timezone with up to 15 minutes of
random delay. `Persistent=true` catches a missed run after the laptop returns;
it may therefore cause a maintenance window after boot. Root execution is needed
for numeric ownership/ACL preservation. The service uses a restrictive umask,
lower CPU/I/O priority, and the journal for basic JSON success/failure events.
Never put an untrusted or world-writable checkout in a root service path.

## Existing monitoring integration

The backup helper atomically publishes a textfile for the existing Node Exporter:

```promql
secure_cloud_backup_last_attempt_success
secure_cloud_backup_last_attempt_timestamp_seconds
secure_cloud_backup_last_success_timestamp_seconds
```

The file contains only status/timestamps, not paths, credentials or file names.
The included Node Exporter configuration reads
`/host/var/lib/secure-cloud-monitoring` through its existing host mount. If
`BACKUP_METRICS_DIR` changes, align that collector path too. Apply the configuration
when ready (these commands do not run a backup):

```bash
docker compose up -d node-exporter
docker compose restart prometheus
```

The backup alert fires after a failed attempt or more than 36 hours without success,
held for 15 minutes. It starts providing status once a backup attempt publishes
metrics; before that, absence is not automatically alerted. A host/disk failure
that prevents metric publication must also be diagnosed from systemd/host health.
No new service, port, Grafana data source or WhatsApp alert path was added. The
journal remains the backup log source; existing Loki collection was not expanded
with privileged journal access. Use Grafana's Prometheus Explore view for metrics.

## Validation scope

Implementation validation uses syntax checks and isolated archive-verifier checks
only. No real application backup/restore, backend stop, cache invalidation,
systemd installation/activation or production database mutation is performed as
part of this code change. Plan a controlled backup and recovery drill before
relying on these artifacts for disaster recovery.

References: [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html),
[PostgreSQL pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html),
[GNU tar metadata options](https://www.gnu.org/software/tar/manual/tar.html).
