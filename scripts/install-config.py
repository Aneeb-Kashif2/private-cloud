#!/usr/bin/env python3
"""Create missing single-host configuration without sourcing or overwriting it."""
import os
from pathlib import Path
import re
import secrets
import sys
from urllib.parse import unquote, urlsplit


def read_env(path):
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            match = re.match(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.strip())
            if match:
                value = match[2].strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                values[match[1]] = value
    return values


def create(path, text):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(text)


def main():
    root = Path(".env")
    root_values = read_env(root)
    settings = {**root_values, **os.environ}
    backend = Path(settings.get("APP_ENV_FILE", "backend/.env"))
    runtime = Path(settings.get("MONITORING_RUNTIME_DIR", "monitoring/runtime"))
    uid = settings.get("APP_UID", "1000")
    gid = settings.get("APP_GID", "1000")
    if not uid.isdecimal() or not gid.isdecimal() or int(uid) == 0:
        raise ValueError("APP_UID/APP_GID must be numeric and APP_UID must not be root")
    values = read_env(backend) if backend.exists() else root_values.copy()
    if not backend.exists():
        if sys.argv[1] == "1":
            raise ValueError("Existing database volume or stored files found but backend configuration is missing. Restore the original APP_ENV_FILE; credentials will not be replaced")
        # Preserve an existing root .env exactly, including its credentials.
        if not root.exists():
            values = read_env(Path(".env.example"))
            values.update(
                AUTH_SECRET=secrets.token_hex(32),
                DATABASE_URL=f"postgresql://selfcloud:{secrets.token_hex(32)}@localhost:5432/selfcloud?schema=public",
                FRONTEND_ORIGIN="http://localhost:8080,http://127.0.0.1:8080,http://localhost:3000",
                NODE_ENV="production",
            )
        if len(values.get("AUTH_SECRET", "")) < 32 or values.get("AUTH_SECRET", "").startswith("replace-"):
            raise ValueError("Existing .env has no valid AUTH_SECRET. Configure it explicitly; existing settings will not be overwritten")
    if values.get("STORAGE_PATH", "/srv/secure-cloud-storage") != "/srv/secure-cloud-storage":
        raise ValueError("Existing STORAGE_PATH differs from the Compose bind mount; reconcile it manually")
    if values.get("STORAGE_LIMIT_BYTES", "5368709120") != "5368709120":
        raise ValueError("Existing storage quota differs from the required 5 GiB")
    url = urlsplit(values.get("DATABASE_URL", ""))
    if url.scheme not in ("postgresql", "postgres") or url.hostname not in ("localhost", "127.0.0.1") or url.port not in (None, 5432):
        raise ValueError("Installer expects the existing local PostgreSQL service on localhost:5432")
    pg = dict(POSTGRES_USER=unquote(url.username or ""), POSTGRES_PASSWORD=unquote(url.password or ""), POSTGRES_DB=unquote(url.path.lstrip("/")))
    if any(not v or any(c in v for c in "\n\r\x00'$\\") for v in pg.values()):
        raise ValueError("Database credentials cannot be safely generated as a Compose env file; configure postgres.env manually")
    pg_path = runtime / "postgres.env"
    if pg_path.exists() and any(read_env(pg_path).get(k) != v for k, v in pg.items()):
        raise ValueError("Existing postgres.env and backend DATABASE_URL disagree. Reconcile the existing credentials; no files were changed")
    template = Path(".env.example").read_text()
    for key, value in values.items():
        # Callback prevents replacement-string escape interpretation.
        template = re.sub(rf"^{re.escape(key)}=.*$", lambda _: f"{key}={value}", template, flags=re.M)
    if not root.exists():
        create(root, template)
    if not backend.exists():
        create(backend, root.read_text())
    if not pg_path.exists():
        create(pg_path, "".join(f"{key}='{value}'\n" for key, value in pg.items()))
    print(uid, gid)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        # Do not print credential values or tracebacks.
        print(f"Configuration stopped: {error}", file=sys.stderr)
        sys.exit(1)
