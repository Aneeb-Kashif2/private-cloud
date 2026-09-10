#!/usr/bin/env bash
set -Eeuo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
env_file=${ENV_FILE:-"$root_dir/.env"}
runtime_dir=${RUNTIME_DIR:-"$root_dir/.runtime"}
pid_file="$runtime_dir/cloudflared.pid"
lock_dir="$runtime_dir/cloudflared.lock"
url_file="$runtime_dir/cloudflare-url"
log_file="$runtime_dir/cloudflared.log"
tunnel_pid=""

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

read_env_value() {
  local name=$1 value
  [[ -f "$env_file" ]] || die "environment file not found: $env_file"
  value=$(sed -n "s/^${name}=//p" "$env_file" | head -n 1)
  value=${value#\"}
  value=${value%\"}
  value=${value#\'}
  value=${value%\'}
  [[ -n "$value" ]] || die "$name is missing from $env_file"
  printf '%s' "$value"
}

cleanup_failed_tunnel() {
  if [[ -n "$tunnel_pid" ]] && kill -0 "$tunnel_pid" 2>/dev/null; then
    kill "$tunnel_pid" 2>/dev/null || true
    wait "$tunnel_pid" 2>/dev/null || true
  fi
  rm -f "$pid_file" "$url_file"
  rm -rf "$lock_dir"
}

mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"

if [[ -d "$lock_dir" ]]; then
  lock_pid=$(cat "$lock_dir/pid" 2>/dev/null || true)
  if [[ "$lock_pid" =~ ^[0-9]+$ ]] && kill -0 "$lock_pid" 2>/dev/null; then
    die "another tunnel operation is already running (PID $lock_pid)"
  fi
  rm -rf "$lock_dir"
fi
mkdir "$lock_dir" || die "could not acquire tunnel lock"
printf '%s\n' "$$" > "$lock_dir/pid"

if [[ -f "$pid_file" ]]; then
  existing_pid=$(cat "$pid_file" 2>/dev/null || true)
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    rm -rf "$lock_dir"
    die "cloudflared is already running (PID $existing_pid)"
  fi
  rm -f "$pid_file"
fi

if pgrep -af '[c]loudflared tunnel' >/dev/null 2>&1; then
  rm -rf "$lock_dir"
  die 'another cloudflared tunnel process is already running'
fi

command -v cloudflared >/dev/null 2>&1 || { rm -rf "$lock_dir"; die 'cloudflared is not installed'; }
command -v curl >/dev/null 2>&1 || { rm -rf "$lock_dir"; die 'curl is not installed'; }
command -v jq >/dev/null 2>&1 || { rm -rf "$lock_dir"; die 'jq is not installed'; }

access_token=$(read_env_value WHATSAPP_ACCESS_TOKEN)
phone_number_id=$(read_env_value WHATSAPP_PHONE_NUMBER_ID)
recipient=$(read_env_value WHATSAPP_RECIPIENT)

: > "$log_file"
chmod 600 "$log_file"
cloudflared tunnel --url http://localhost:8080 >"$log_file" 2>&1 &
tunnel_pid=$!
printf '%s\n' "$tunnel_pid" > "$pid_file"
chmod 600 "$pid_file"

trap cleanup_failed_tunnel ERR INT TERM

tunnel_url=""
for _ in {1..60}; do
  tunnel_url=$(grep -Eo 'https://[[:alnum:]-]+\.trycloudflare\.com' "$log_file" | head -n 1 || true)
  [[ -n "$tunnel_url" ]] && break
  kill -0 "$tunnel_pid" 2>/dev/null || break
  sleep 1
done
[[ -n "$tunnel_url" ]] || { cleanup_failed_tunnel; die 'cloudflared did not produce a Quick Tunnel URL'; }
printf '%s\n' "$tunnel_url" > "$url_file"
chmod 600 "$url_file"

health_code=""
for _ in {1..60}; do
  health_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$tunnel_url/health" 2>/dev/null || true)
  [[ "$health_code" == "200" ]] && break
  kill -0 "$tunnel_pid" 2>/dev/null || break
  sleep 1
done
[[ "$health_code" == "200" ]] || { cleanup_failed_tunnel; die "tunnel health check failed (last HTTP status: ${health_code:-unavailable})"; }

message=$(jq -cn --arg url "$tunnel_url" --arg health "HTTP 200 (OK)" --arg recipient "$recipient" '{messaging_product:"whatsapp",to:$recipient,type:"text",text:{preview_url:false,body:("Secure Cloud Quick Tunnel: " + $url + "\nHealth: " + $health)}}')
response_file=$(mktemp)
header_file=$(mktemp)
chmod 600 "$response_file" "$header_file"
trap 'rm -f "$response_file" "$header_file"' EXIT
printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$access_token" > "$header_file"
http_code=$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 20 --request POST "https://graph.facebook.com/v23.0/$phone_number_id/messages" --header "@$header_file" --data-raw "$message" || true)
if [[ ! "$http_code" =~ ^2[0-9][0-9]$ ]]; then
  printf 'Error: WhatsApp notification failed (HTTP %s). Tunnel remains running at %s\n' "${http_code:-unavailable}" "$tunnel_url" >&2
  rm -rf "$lock_dir"
  exit 1
fi

rm -rf "$lock_dir"
printf 'Quick Tunnel is running. URL: %s (health: HTTP 200)\n' "$tunnel_url"