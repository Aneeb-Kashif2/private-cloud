#!/usr/bin/env bash
set -euo pipefail
backend_image=${1:-secure-cloud-backend:ci}
frontend_image=${2:-secure-cloud-frontend:ci}
prefix="secure-cloud-smoke-${RANDOM}-$$"
storage_dir=$(mktemp -d)
cleanup() {
  docker rm -f "$prefix-backend" "$prefix-frontend" "$prefix-postgres" "$prefix-redis" >/dev/null 2>&1 || true
  docker network rm "$prefix" >/dev/null 2>&1 || true
  rm -rf "$storage_dir"
}
trap cleanup EXIT
trap 'docker logs "$prefix-backend" 2>/dev/null || true; docker logs "$prefix-frontend" 2>/dev/null || true' ERR
docker network create "$prefix" >/dev/null
docker run -d --name "$prefix-postgres" --network "$prefix" -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test postgres:17-alpine >/dev/null
docker run -d --name "$prefix-redis" --network "$prefix" redis:7-alpine >/dev/null
for attempt in {1..60}; do
  if docker exec "$prefix-postgres" pg_isready -U test -d test >/dev/null 2>&1; then break; fi
  sleep 1
done
db_url="postgresql://test:test@$prefix-postgres:5432/test"
docker run --rm --network "$prefix" -e DATABASE_URL="$db_url" "$backend_image" ../node_modules/.bin/prisma migrate deploy
docker run -d --name "$prefix-backend" --network "$prefix" \
  --user "$(id -u):$(id -g)" -p 127.0.0.1::4000 \
  --mount "type=bind,source=$storage_dir,target=/srv/secure-cloud-storage" \
  -e DATABASE_URL="$db_url" -e REDIS_URL="redis://$prefix-redis:6379" \
  -e AUTH_SECRET=smoke-test-secret-with-at-least-32-characters \
  -e FRONTEND_ORIGIN=http://localhost:3000 "$backend_image" >/dev/null
docker run -d --name "$prefix-frontend" --network "$prefix" -p 127.0.0.1::3000 "$frontend_image" >/dev/null
backend_port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "4000/tcp") 0).HostPort}}' "$prefix-backend")
frontend_port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$prefix-frontend")
SMOKE_API="http://127.0.0.1:$backend_port" SMOKE_WEB="http://127.0.0.1:$frontend_port" node scripts/smoke-http.mjs
docker stop --time 10 "$prefix-backend" >/dev/null
test "$(docker inspect --format '{{.State.ExitCode}}' "$prefix-backend")" = 0
printf '%s\n' 'Graceful backend shutdown passed.'
