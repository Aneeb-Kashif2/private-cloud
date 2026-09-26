#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/cloudflare-common.sh"
env_file=${ENV_FILE:-"$root_dir/.env"}
tunnel_pid=""
keep_tunnel=false
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$tunnel_pid" && "$keep_tunnel" != true ]]; then
    # Only this invocation's child, checked against its recorded process identity.
    if managed_process; then kill "$tunnel_pid" 2>/dev/null || true; fi
    clear_state
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for dependency in cloudflared curl node nohup; do
  command -v "$dependency" >/dev/null || die "$dependency is not installed"
done
# WhatsApp notification is optional. If any notification setting is present,
# validate the complete configuration before creating a tunnel.
whatsapp_config=$(node --input-type=module - "$env_file" <<'NODE'
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';

const file = process.argv[2];
const values = { ...parse(await readFile(file)), ...process.env };
const names = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_RECIPIENT'];
const present = names.filter((name) => values[name]?.trim() && !values[name].trim().startsWith('replace-'));
console.log(present.length === 0 ? 'disabled' : present.length === names.length ? 'enabled' : 'incomplete');
NODE
)
case "$whatsapp_config" in
  enabled) node "$root_dir/scripts/notify-whatsapp.mjs" check "$env_file" ;;
  incomplete) die 'WhatsApp notification settings are incomplete; set all required values or remove them to run without notifications' ;;
  disabled) : ;;
  *) die 'could not determine WhatsApp notification configuration' ;;
esac
if managed_process; then
  die 'the managed tunnel is already running; use notify-whatsapp.mjs to retry its notification'
fi
if [[ -f "$pid_file" ]]; then
  old_pid=$(cat "$pid_file")
  if [[ "$old_pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    die 'a live PID exists without matching ownership metadata; inspect it before restarting'
  fi
fi
if pgrep -x cloudflared >/dev/null 2>&1; then
  die 'another cloudflared process is already running; do not run native and Compose tunnels together'
fi
curl -fsS --max-time 5 -o /dev/null http://localhost:8080/health || die 'Nginx/application health is unavailable on port 8080'
clear_state
: > "$log_file"
# Detach from terminal stdin/HUP and do not let the child inherit the operation lock.
nohup cloudflared tunnel --url http://localhost:8080 </dev/null >"$log_file" 2>&1 9>&- &
tunnel_pid=$!
printf '%s\n' "$tunnel_pid" > "$pid_file"
process_identity "$tunnel_pid" > "$identity_file" || die 'cloudflared exited during startup'
# nohup execs cloudflared with the same PID/start time.
tunnel_url=""
for _ in {1..60}; do
  tunnel_url=$(grep -Eo 'https://[[:alnum:]-]+\.trycloudflare\.com' "$log_file" | head -n 1 || true)
  [[ -n "$tunnel_url" ]] && break
  kill -0 "$tunnel_pid" 2>/dev/null || break
  sleep 1
done
[[ -n "$tunnel_url" ]] || die 'cloudflared did not produce a Quick Tunnel URL'
health_code=""
for _ in {1..60}; do
  health_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$tunnel_url/health" 2>/dev/null || true)
  [[ "$health_code" == 200 ]] && break
  managed_process || break
  sleep 1
done
[[ "$health_code" == 200 ]] && managed_process || die 'public tunnel health check failed'
printf '%s\n' "$tunnel_url" > "$url_file"
keep_tunnel=true
if [[ "$whatsapp_config" == enabled ]]; then
  # Notification failure must not destroy a healthy tunnel.
  if ! node "$root_dir/scripts/notify-whatsapp.mjs" send "$env_file" "$url_file"; then
    printf 'Tunnel remains running. URL: %s\n' "$tunnel_url" >&2
    exit 1
  fi
fi
printf 'Quick Tunnel is running. URL: %s (health: HTTP 200)\n' "$tunnel_url"
