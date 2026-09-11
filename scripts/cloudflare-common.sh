#!/usr/bin/env bash
# Shared lifecycle helpers; source from start/stop, do not execute directly.
umask 077
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
runtime_dir=${RUNTIME_DIR:-"$root_dir/.runtime"}
pid_file="$runtime_dir/cloudflared.pid"
identity_file="$runtime_dir/cloudflared.identity"
url_file="$runtime_dir/cloudflare-url"
log_file="$runtime_dir/cloudflared.log"
die() { printf 'Error: %s\n' "$1" >&2; exit 1; }
command -v flock >/dev/null || die 'flock is required (Ubuntu util-linux)'
mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"
# Both scripts hold the same kernel lock; no stale lock-directory deletion races.
exec 9>"$runtime_dir/cloudflared.operation.lock"
flock -n 9 || die 'another tunnel operation is already running'
process_identity() {
  local pid=$1 process_stat boot
  [[ "$pid" =~ ^[1-9][0-9]*$ && -r "/proc/$pid/stat" ]] || return 1
  IFS= read -r process_stat < "/proc/$pid/stat" || return 1
  process_stat=${process_stat##*) }
  local -a fields
  read -ra fields <<< "$process_stat"
  [[ ${fields[0]:-} != Z && ${#fields[@]} -ge 20 ]] || return 1
  IFS= read -r boot < /proc/sys/kernel/random/boot_id || return 1
  printf '%s %s %s\n' "$pid" "${fields[19]}" "$boot"
}
managed_process() {
  local actual expected
  [[ -f "$identity_file" && -f "$pid_file" ]] || return 1
  IFS= read -r pid < "$pid_file" || return 1
  actual=$(process_identity "$pid") || return 1
  IFS= read -r expected < "$identity_file" || return 1
  [[ "$actual" == "$expected" ]] || return 1
  [[ $(cat "/proc/$pid/comm" 2>/dev/null) == cloudflared ]] || return 1
  [[ $(stat -c %u "/proc/$pid" 2>/dev/null) == "$(id -u)" ]]
}
clear_state() { rm -f "$pid_file" "$identity_file" "$url_file"; }
