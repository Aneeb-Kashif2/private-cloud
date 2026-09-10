#!/usr/bin/env bash
set -Eeuo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
runtime_dir=${RUNTIME_DIR:-"$root_dir/.runtime"}
pid_file="$runtime_dir/cloudflared.pid"
lock_dir="$runtime_dir/cloudflared.lock"
url_file="$runtime_dir/cloudflare-url"

if [[ ! -f "$pid_file" ]]; then
  rm -rf "$lock_dir"
  rm -f "$url_file"
  printf '%s\n' 'No managed Quick Tunnel is running.'
  exit 0
fi

pid=$(cat "$pid_file" 2>/dev/null || true)
if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
  rm -f "$pid_file" "$url_file"
  rm -rf "$lock_dir"
  printf '%s\n' 'Removed an invalid Quick Tunnel PID file.'
  exit 0
fi

if kill -0 "$pid" 2>/dev/null; then
  kill "$pid" 2>/dev/null || true
  for _ in {1..10}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
fi

rm -f "$pid_file" "$url_file"
rm -rf "$lock_dir"
printf '%s\n' 'Quick Tunnel stopped.'