#!/usr/bin/env bash
# One-time adoption of the project's original Docker databases, preserving volumes.
set -euo pipefail
cd "$(dirname "$0")/../.."
test -r "${MONITORING_RUNTIME_DIR:-monitoring/runtime}/postgres.env"
docker compose config --quiet
for service in postgres redis; do
  name="self-cloud-prj-$service-1"
  if ! docker inspect "$name" >/dev/null 2>&1; then continue; fi
  project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$name")
  if [ "$project" = secure-cloud ]; then continue; fi
  if [ "$project" != self-cloud-prj ]; then
    echo "Refusing to adopt an unexpected container: $name" >&2; exit 1
  fi
  if docker inspect "$name-before-monitoring" >/dev/null 2>&1; then
    echo "Backup container name already exists: $name-before-monitoring. Resolve it before adoption." >&2
    exit 1
  fi
  volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}' "$name")
  test "$volume" = "self-cloud-prj_${service}_data"
done
adopted=()
rollback() {
  for service in "${adopted[@]}"; do
    name="self-cloud-prj-$service-1"
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker rename "$name-before-monitoring" "$name"
    docker start "$name" >/dev/null
  done
  docker compose up -d --no-deps backend frontend nginx || true
  echo 'Database adoption failed; original containers restored. Review the error before retrying.' >&2
}
trap rollback ERR
docker compose stop nginx frontend backend
for service in postgres redis; do
  name="self-cloud-prj-$service-1"
  if ! docker inspect "$name" >/dev/null 2>&1; then continue; fi
  project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$name")
  if [ "$project" = secure-cloud ]; then continue; fi
  docker stop --time 60 "$name" >/dev/null
  docker rename "$name" "$name-before-monitoring"
  adopted+=("$service")
done
docker compose up -d --wait postgres redis
trap - ERR
echo 'Existing database volumes adopted; ports now bind only to localhost.'
echo 'Old containers are retained stopped with suffix -before-monitoring. Never run both copies.'
