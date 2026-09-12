#!/usr/bin/env python3
"""Coordinated backup operations for the existing single-host Docker deployment."""
import argparse
import datetime as dt
import fcntl
import hashlib
import gzip
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from urllib.parse import urlparse, unquote

STORAGE = Path('/srv/secure-cloud-storage')
FORMAT = 'secure-cloud-backup-v1'
ARTIFACTS = ('postgres.dump', 'storage.tar.gz')
NAME = re.compile(r'(backup|recovery)-\d{8}T\d{6}Z-[0-9a-f]{8}')

class Failure(Exception):
    pass

def require(condition, message):
    if not condition:
        raise Failure(message)

def log(event, **fields):
    print(json.dumps({'timestamp': dt.datetime.now(dt.timezone.utc).isoformat(),
                      'event': event, **fields}), flush=True)

def run(args, *, stdin=None, stdout=None, input=None):
    # Never echo commands, environment values, SQL or provider stderr into logs.
    result = subprocess.run(args, stdin=stdin, stdout=stdout or subprocess.PIPE,
                            stderr=subprocess.PIPE, input=input)
    require(result.returncode == 0, 'Command failed: ' + Path(args[0]).name)
    return result.stdout

def digest(stream):
    h = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        h.update(chunk)
    return h.hexdigest()

def checksum(path):
    with path.open('rb') as stream:
        return digest(stream)

def atomic_json(path, data, mode=0o600):
    tmp = path.with_name(path.name + '.tmp')
    with tmp.open('w') as stream:
        os.chmod(tmp, mode)
        json.dump(data, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)

def protected_directory(path):
    require(path.is_absolute() and path == path.resolve(), 'Directory must be absolute without symlinks')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o077,
            'Backup directories must be owned by root with mode 0700')

def inventory(archive):
    """Read every data byte; reject traversal, duplicate entries and links/devices."""
    # Read through gzip's trailer as tar EOF can precede the gzip CRC/footer.
    with gzip.open(archive, 'rb') as compressed:
        while compressed.read(1024 * 1024):
            pass
    entries = {}
    with tarfile.open(archive, 'r:gz') as stream:
        for member in stream:
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and '..' not in path.parts,
                    'Unsafe path in storage archive')
            name = str(path)
            require(name not in entries and (member.isdir() or member.isfile()),
                    'Duplicate entry or unsupported file type in archive')
            require(name != '.' or member.isdir(), 'Invalid archive root')
            for parent in path.parents:
                require(str(parent) not in entries or entries[str(parent)]['type'] == 'directory',
                        'Archive path conflicts with a file')
            entry = {'type': 'directory' if member.isdir() else 'file',
                     'size': member.size, 'uid': member.uid, 'gid': member.gid,
                     'mode': member.mode, 'mtime': member.mtime}
            if member.isfile():
                with stream.extractfile(member) as content:
                    entry['sha256'] = digest(content)
            entries[name] = entry
    for name in entries:
        for parent in PurePosixPath(name).parents:
            require(str(parent) not in entries or entries[str(parent)]['type'] == 'directory',
                    'Archive path conflicts with a file')
    require('.' in entries, 'Storage archive must include directory metadata')
    return entries

class Operations:
    def __init__(self):
        require(os.geteuid() == 0, 'Run with sudo/root to preserve ownership, ACLs and permissions')
        os.umask(0o077)
        self.root = Path(os.environ.get('BACKUP_DIR', '/srv/secure-cloud-backups'))
        require(self.root != Path('/') and self.root != STORAGE and STORAGE not in self.root.parents
                and self.root not in STORAGE.parents, 'Backup directory must be separate from storage')
        protected_directory(self.root)
        self.lock = open('/run/lock/secure-cloud-backup.lock', 'a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Failure('Another backup/restore/verification is running')
        for command in ('docker', 'tar'):
            require(shutil.which(command), 'Missing prerequisite: ' + command)
        self.pg = os.environ.get('BACKUP_POSTGRES_CONTAINER', 'self-cloud-prj-postgres-1')
        self.backend = os.environ.get('BACKUP_BACKEND_CONTAINER', 'secure-cloud-backend-1')
        self.redis = os.environ.get('BACKUP_REDIS_CONTAINER', 'self-cloud-prj-redis-1')
        self.project = os.environ.get('BACKUP_COMPOSE_PROJECT', 'secure-cloud')
        self.retention = int(os.environ.get('BACKUP_RETENTION_DAYS', '14'))
        require(self.retention >= 0, 'Retention must be nonnegative (0 disables cleanup)')
        self.was_running = False
        self.stopped = False
        self.unsafe_to_resume = False

    def inspect(self, name, service):
        info = json.loads(run(['docker', 'inspect', name]))[0]
        labels = info['Config'].get('Labels') or {}
        require(labels.get('com.docker.compose.project') == self.project and
                labels.get('com.docker.compose.service') == service,
                'Container is not the expected Compose service')
        return info

    def pg_command(self, command, *, stdin=None, stdout=None, input=None):
        # Credentials remain inside the existing container; never on host argv.
        return run(['docker', 'exec', '-i', self.pg, 'sh', '-ec',
                    'export PGPASSWORD="$POSTGRES_PASSWORD"; ' + command],
                   stdin=stdin, stdout=stdout, input=input)

    def sql(self, query):
        return self.pg_command('exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                               input=query.encode()).decode().strip()

    def preflight(self):
        require(STORAGE.is_dir() and STORAGE == STORAGE.resolve() and not os.path.ismount(STORAGE),
                'Expected storage directory without symlinks or a separate mount point')
        pg = self.inspect(self.pg, 'postgres')
        app = self.inspect(self.backend, 'backend')
        require(pg['State']['Running'], 'PostgreSQL must already be running')
        require(any(m['Type'] == 'volume' and m['Name'] == 'self-cloud-prj_postgres_data'
                    and m['Destination'] == '/var/lib/postgresql/data' for m in pg['Mounts']),
                'Unexpected PostgreSQL volume; refusing to operate')
        require(any(m['Type'] == 'bind' and m['Source'] == str(STORAGE)
                    and m['Destination'] == str(STORAGE) for m in app['Mounts']),
                'Backend does not use the expected local storage bind mount')
        pg_env = dict(x.split('=', 1) for x in pg['Config']['Env'] if '=' in x)
        app_env = dict(x.split('=', 1) for x in app['Config']['Env'] if '=' in x)
        url = urlparse(app_env.get('DATABASE_URL', ''))
        require(url.hostname in ('localhost', '127.0.0.1') and (url.port or 5432) == 5432
                and unquote(url.username or '') == pg_env.get('POSTGRES_USER')
                and unquote(url.path.lstrip('/')) == pg_env.get('POSTGRES_DB'),
                'Backend database differs from the configured PostgreSQL database')
        self.database = pg_env['POSTGRES_DB']
        self.image = app['Image']
        self.major = int(self.sql('SHOW server_version_num;')) // 10000
        self.was_running = app['State']['Running']
        require(not app['State'].get('Paused'), 'Backend is paused; resolve maintenance state first')

    def stop(self):
        if self.was_running:
            self.stopped = True
            run(['docker', 'stop', '--time', '300', self.backend])
            app = self.inspect(self.backend, 'backend')
            require(not app['State']['Running'] and app['State']['ExitCode'] == 0,
                    'Backend did not stop cleanly; no coordinated snapshot was taken')
        require(self.sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
                         "AND pid<>pg_backend_pid() AND backend_type='client backend' "
                         "AND usename<>'secure_cloud_monitor';") == '0',
                'Other database clients exist; stop native writers and deployment jobs first')

    def resume(self):
        if self.stopped and not self.unsafe_to_resume:
            run(['docker', 'start', self.backend])
            self.stopped = False
            for _ in range(90):
                state = self.inspect(self.backend, 'backend')['State']
                require(state['Running'], 'Backend failed to restart; inspect it before serving traffic')
                if state.get('Health', {}).get('Status') == 'healthy':
                    return
                time.sleep(1)
            raise Failure('Backend did not become healthy after restart')

    def verify(self, folder):
        require(folder.is_dir() and folder == folder.resolve(), 'Backup path must not contain symlinks')
        require(folder.stat().st_uid == 0 and not folder.stat().st_mode & 0o077,
                'Backup must be root-owned and private (0700)')
        expected = {'manifest.json', 'manifest.sha256', *ARTIFACTS}
        require({p.name for p in folder.iterdir()} == expected, 'Unexpected/missing backup artifacts')
        for item in expected:
            path = folder / item
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077,
                    'Backup artifacts must be private root-owned regular files')
        require((folder / 'manifest.sha256').read_text().strip() == checksum(folder / 'manifest.json'),
                'Manifest checksum mismatch')
        manifest = json.loads((folder / 'manifest.json').read_text())
        require(manifest.get('format') == FORMAT and manifest.get('storage_path') == str(STORAGE),
                'Unsupported backup format/storage path')
        require(set(manifest['checksums']) == set(ARTIFACTS), 'Invalid artifact checksums')
        for item in ARTIFACTS:
            require(checksum(folder / item) == manifest['checksums'][item], 'Artifact checksum mismatch')
        entries = inventory(folder / 'storage.tar.gz')
        require(entries == manifest['entries'], 'Storage inventory or per-file checksum mismatch')
        files = [entry for entry in entries.values() if entry['type'] == 'file']
        require(len(files) == manifest['file_count'] and sum(x['size'] for x in files) == manifest['storage_size_bytes'],
                'Storage totals mismatch')
        # Decode every custom-dump entry without executing its SQL.
        with (folder / 'postgres.dump').open('rb') as source:
            self.pg_command('exec pg_restore --exit-on-error --file=/dev/null', stdin=source)
        return manifest

    def snapshot(self, recovery=False):
        ident = ('recovery-' if recovery else 'backup-') + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:8]
        folder = Path(tempfile.mkdtemp(prefix='.partial-', dir=self.root))
        try:
            # Reject links/special files rather than following them outside storage.
            for base, dirs, files in os.walk(STORAGE, followlinks=False):
                for name in dirs + files:
                    mode = (Path(base) / name).lstat().st_mode
                    require(stat.S_ISDIR(mode) or stat.S_ISREG(mode), 'Unsupported storage link/special file')
            with (folder / 'postgres.dump').open('wb') as target:
                self.pg_command('exec pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"', stdout=target)
            run(['tar', '--create', '--gzip', '--file', str(folder / 'storage.tar.gz'),
                 '--format=pax', '--acls', '--xattrs', '--numeric-owner', '--hard-dereference',
                 '--atime-preserve=system', '--directory', str(STORAGE), '.'])
            entries = inventory(folder / 'storage.tar.gz')
            files = [x for x in entries.values() if x['type'] == 'file']
            manifest = {'format': FORMAT, 'id': ident, 'timestamp': dt.datetime.now(dt.timezone.utc).isoformat(),
                        'storage_path': str(STORAGE), 'database': self.database, 'postgres_major': self.major,
                        'backend_image_id': self.image, 'file_count': len(files),
                        'storage_size_bytes': sum(x['size'] for x in files), 'entries': entries,
                        'checksums': {item: checksum(folder / item) for item in ARTIFACTS}}
            atomic_json(folder / 'manifest.json', manifest)
            (folder / 'manifest.sha256').write_text(checksum(folder / 'manifest.json') + '\n')
            self.verify(folder)
            # Flush completed artifacts before publishing a backup eligible for retention.
            for path in folder.iterdir():
                with path.open('rb') as source:
                    os.fsync(source.fileno())
            final = self.root / ident
            self.sync_directory(folder)
            folder.rename(final)
            self.sync_directory(self.root)
            return final
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise

    @staticmethod
    def sync_directory(path):
        fd = os.open(path, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def retention_cleanup(self):
        if not self.retention:
            return
        backups = []
        for path in self.root.iterdir():
            if not (NAME.fullmatch(path.name) and path.name.startswith('backup-')
                    and not path.is_symlink() and path.is_dir()):
                continue
            try:
                manifest = json.loads((path / 'manifest.json').read_text())
                valid = (manifest.get('format') == FORMAT and manifest.get('id') == path.name
                         and checksum(path / 'manifest.json') == (path / 'manifest.sha256').read_text().strip())
                stamp = dt.datetime.fromisoformat(manifest['timestamp'])
                if valid and stamp.tzinfo:
                    backups.append((stamp, path))
            except (OSError, ValueError, KeyError):
                continue
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=self.retention)
        for stamp, path in sorted(backups, reverse=True)[2:]:
            if stamp < cutoff:
                shutil.rmtree(path)
                log('backup_retention_removed', backup=path.name)

    def metrics(self, success):
        # Existing node-exporter reads this host directory; no new service or ports.
        configured = os.environ.get('BACKUP_METRICS_DIR', '/var/lib/secure-cloud-monitoring')
        if not configured:
            return
        directory = Path(configured)
        require(directory.is_absolute() and directory == directory.resolve(), 'Invalid metrics directory')
        directory.mkdir(parents=True, exist_ok=True, mode=0o755)
        require(directory.stat().st_uid == 0 and not directory.stat().st_mode & 0o022,
                'Metrics directory must be root-owned and not writable by others')
        state = self.root / 'status.json'
        previous = json.loads(state.read_text()) if state.exists() else {}
        now = int(time.time())
        previous['last_attempt_success'] = int(success)
        previous['last_attempt_timestamp_seconds'] = now
        if success:
            previous['last_success_timestamp_seconds'] = now
        atomic_json(state, previous)
        text = ''.join(f'secure_cloud_backup_{key} {previous.get(key, 0)}\n' for key in
                       ('last_attempt_success', 'last_attempt_timestamp_seconds', 'last_success_timestamp_seconds'))
        tmp = directory / 'secure-cloud-backup.prom.tmp'
        tmp.write_text(text)
        tmp.chmod(0o644)
        os.replace(tmp, directory / 'secure-cloud-backup.prom')

    def restore(self, folder):
        manifest = self.verify(folder)
        require(manifest['database'] == self.database and manifest['postgres_major'] == self.major,
                'Restore requires the same database name and PostgreSQL major version')
        require(manifest['backend_image_id'] == self.image,
                'Deploy the backup-compatible backend image before restoring')
        redis = self.inspect(self.redis, 'redis')
        require(redis['State']['Running'], 'Redis must be running for cache invalidation')
        require(run(['docker', 'exec', self.redis, 'redis-cli', 'PING']).strip() == b'PONG',
                'Redis is not accessible for cache invalidation')
        require(sys.stdin.isatty(), 'Restore requires an interactive terminal')
        phrase = 'RESTORE ' + folder.name
        print('This replaces the application database and file tree. Configuration and Docker volumes stay intact.')
        print('A recovery snapshot and the previous file tree will be retained. Type: ' + phrase)
        require(input('> ') == phrase, 'Restore cancelled')
        self.stop()
        recovery = self.snapshot(recovery=True)
        log('restore_recovery_created', backup=recovery.name)
        require(shutil.disk_usage(STORAGE.parent).free > manifest['storage_size_bytes'] + 64 * 1024**2,
                'Insufficient disk space to stage restored files')
        staging = Path(tempfile.mkdtemp(prefix='.secure-cloud-restore-', dir=STORAGE.parent))
        payload = staging / 'files'
        payload.mkdir()
        try:
            run(['tar', '--extract', '--gzip', '--file', str(folder / 'storage.tar.gz'),
                 '--directory', str(payload), '--same-owner', '--same-permissions', '--numeric-owner',
                 '--acls', '--xattrs', '--xattrs-include=*', '--delay-directory-restore'])
            # Flush staged bytes/metadata before committing the PostgreSQL restore.
            for base, dirs, files in os.walk(payload, topdown=False):
                for name in files:
                    with (Path(base) / name).open('rb') as content:
                        os.fsync(content.fileno())
                self.sync_directory(Path(base))
            self.sync_directory(staging)
            atomic_json(self.root / 'restore-state.json', {
                'phase': 'database_restore_started', 'selected_backup': str(folder),
                'recovery_backup': str(recovery), 'staging_directory': str(staging),
                'backend_was_running': self.was_running,
            })
            self.sync_directory(self.root)
            # Once database replacement starts, failures require explicit operator recovery.
            self.unsafe_to_resume = True
            with (folder / 'postgres.dump').open('rb') as source:
                self.pg_command('exec pg_restore --clean --if-exists --single-transaction --exit-on-error '
                                '--no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"', stdin=source)
            previous = staging / 'previous-files'
            STORAGE.rename(previous)
            try:
                payload.rename(STORAGE)
            except BaseException:
                previous.rename(STORAGE)
                raise
            # Keep old files under the root-only staging parent for manual recovery.
            self.sync_directory(STORAGE.parent)
            records = json.loads(self.sql("""SELECT coalesce(json_agg(json_build_object('key', "storageKey", 'size', "size"::text)), '[]'::json) FROM "File";"""))
            for record in records:
                entry = manifest['entries'].get(record['key'], {})
                require(entry.get('type') == 'file' and entry['size'] == int(record['size']),
                        'Restored database references missing or mismatched file content')
            keys = run(['docker', 'exec', self.redis, 'redis-cli', '--scan', '--pattern', 'selfcloud:*']).splitlines()
            require(all(key.startswith(b'selfcloud:') for key in keys), 'Unexpected Redis scan response')
            for offset in range(0, len(keys), 1000):
                commands = b''.join(b'*2\r\n$6\r\nUNLINK\r\n$' + str(len(key)).encode() + b'\r\n' + key + b'\r\n'
                                    for key in keys[offset:offset + 1000])
                result = run(['docker', 'exec', '-i', self.redis, 'redis-cli', '--pipe'], input=commands)
                require(b'errors: 0' in result, 'Redis cache invalidation failed')
            atomic_json(self.root / 'restore-state.json', {
                'phase': 'completed', 'selected_backup': str(folder),
                'recovery_backup': str(recovery), 'previous_files': str(previous),
            })
            self.unsafe_to_resume = False
            log('restore_completed', backup=folder.name, recovery=recovery.name, previous_files=str(previous))
        finally:
            if not self.unsafe_to_resume and not (staging / 'previous-files').exists():
                shutil.rmtree(staging, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('backup', 'verify', 'restore'))
    parser.add_argument('directory', nargs='?', help='Absolute path to selected backup (verify/restore)')
    args = parser.parse_args()
    require((args.operation == 'backup') == (args.directory is None), 'Select exactly one backup for verify/restore')
    ops = Operations()
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(Failure('Operation interrupted')))
    success = False
    try:
        if args.operation == 'verify':
            ops.verify(Path(args.directory).absolute())
            log('backup_verified')
        else:
            ops.preflight()
            if args.operation == 'backup':
                log('backup_started')
                ops.stop()
                backup = ops.snapshot()
                ops.resume()
                ops.retention_cleanup()
                log('backup_success', backup=backup.name)
            else:
                ops.restore(Path(args.directory).absolute())
            success = True
    finally:
        ops.resume()
        if args.operation == 'backup':
            ops.metrics(success)
        if ops.unsafe_to_resume:
            log('restore_recovery_required', backend_left_stopped=True)

if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        log('backup_operation_failed', reason=str(error) if isinstance(error, Failure) else type(error).__name__)
        sys.exit(1)
