#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
validation_runtime=$(mktemp -d)
trap 'rm -rf "$validation_runtime"' EXIT
printf 'POSTGRES_USER=validation\nPOSTGRES_PASSWORD=validation\nPOSTGRES_DB=validation\n' > "$validation_runtime/postgres.env"
printf 'DATA_SOURCE_NAME=postgresql://validation:validation@localhost/validation\n' > "$validation_runtime/postgres-exporter.env"
printf 'validation-only\n' > "$validation_runtime/grafana_admin_password"
APP_ENV_FILE=.env.example MONITORING_RUNTIME_DIR="$validation_runtime" docker compose config --quiet
docker run --rm --entrypoint promtool -v "$PWD/monitoring/prometheus:/etc/prometheus:ro" prom/prometheus:v3.14.0 check config /etc/prometheus/prometheus.yml
docker run --rm --entrypoint promtool -v "$PWD/monitoring/prometheus:/etc/prometheus:ro" -w /etc/prometheus prom/prometheus:v3.14.0 test rules alerts.test.yml
docker run --rm -v "$PWD/monitoring/alloy/config.alloy:/etc/alloy/config.alloy:ro" grafana/alloy:v1.19.2 validate /etc/alloy/config.alloy
docker run --rm -v "$PWD/monitoring/loki/loki.yml:/etc/loki/config.yml:ro" grafana/loki:3.7.7 -config.file=/etc/loki/config.yml -verify-config=true
docker run --rm -v "$PWD/deploy/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro" nginx:stable-alpine nginx -t
