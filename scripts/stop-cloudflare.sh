#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/cloudflare-common.sh"
if [[ ! -f "$pid_file" ]]; then
  rm -f "$identity_file" "$url_file"
  printf '%s\n' 'No managed Quick Tunnel is running.'
  exit 0
fi
pid=$(cat "$pid_file")
if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]] || ! kill -0 "$pid" 2>/dev/null; then
  clear_state
  printf '%s\n' 'Removed stale Quick Tunnel state.'
  exit 0
fi
managed_process || die 'PID ownership does not match; refusing to signal an unrelated or legacy process'
kill "$pid" 2>/dev/null || true
for _ in {1..10}; do
  managed_process || break
  sleep 1
done
if managed_process; then kill -KILL "$pid" 2>/dev/null || true; fi
clear_state
printf '%s\n' 'Quick Tunnel stopped.'
