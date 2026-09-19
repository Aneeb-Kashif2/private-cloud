#!/usr/bin/env bash
# Ubuntu single-host installer. Never removes persistent data or replaces .env files.
set -Eeuo pipefail
umask 077

# Supports: curl -fsSL https://raw.githubusercontent.com/Aneeb-Kashif2/private-cloud/main/install.sh | bash
# The bootstrap only obtains source code; the normal installer below performs all setup.
if [[ ! -f "${BASH_SOURCE[0]:-}" ]]; then
  repo_url=${SECURE_CLOUD_REPO:-https://github.com/Aneeb-Kashif2/private-cloud.git}
  repo_ref=${SECURE_CLOUD_REF:-main}
  install_dir=${SECURE_CLOUD_DIR:-/opt/secure-cloud}
  if [[ "$repo_url" =~ ^[a-zA-Z][a-zA-Z0-9+.-]*://[^/@:]+:[^/@]+@ ]]; then
    echo 'SECURE_CLOUD_REPO must not contain a username, password or access token. Configure Git authentication separately.' >&2
    exit 1
  fi
  bootstrap_sudo=()
  (( EUID == 0 )) || bootstrap_sudo=(sudo)
  if ! command -v git >/dev/null 2>&1; then
    "${bootstrap_sudo[@]}" apt-get update
    "${bootstrap_sudo[@]}" apt-get install -y git
  fi
  if [[ -e "$install_dir" && ! -d "$install_dir/.git" ]]; then
    echo "$install_dir exists and is not a Secure Cloud checkout; set SECURE_CLOUD_DIR to another path." >&2
    exit 1
  fi
  if [[ ! -d "$install_dir/.git" ]]; then
    "${bootstrap_sudo[@]}" git clone --branch "$repo_ref" --depth 1 "$repo_url" "$install_dir"
  fi
  exec "${bootstrap_sudo[@]}" bash "$install_dir/install.sh" "${@:-}"
fi
cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")"
mode=${1:-install}
case "$mode" in
  install|--update|--status|--uninstall) ;;
  --help|-h) echo 'Usage: bash install.sh [--update|--status|--uninstall]'; exit 0 ;;
  *) echo 'Unknown option; use --help.' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo 'Expected at most one option.' >&2; exit 2; }
trap 'echo "Installation stopped at line $LINENO. Existing data is retained; fix the reported error and rerun." >&2' ERR
sudo_cmd=()
if (( EUID != 0 )); then sudo_cmd=(sudo); fi
docker_cmd=(docker)
services=(postgres redis migrate backend frontend nginx)

if [[ "$mode" == install || "$mode" == --update ]]; then
  # This Compose deployment uses Linux host networking.
  source /etc/os-release
  [[ "$ID" == ubuntu ]] || { echo 'This installer supports Ubuntu only.' >&2; exit 1; }
  missing=()
  for tool in curl git python3; do
    command -v "$tool" >/dev/null || missing+=("$tool")
  done
  if ((${#missing[@]})); then
    "${sudo_cmd[@]}" apt-get update
    "${sudo_cmd[@]}" apt-get install -y ca-certificates "${missing[@]}"
  fi
  if ! command -v docker >/dev/null; then
    "${sudo_cmd[@]}" apt-get update
    "${sudo_cmd[@]}" apt-get install -y ca-certificates curl
    "${sudo_cmd[@]}" install -m 0755 -d /etc/apt/keyrings
    "${sudo_cmd[@]}" curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    "${sudo_cmd[@]}" chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$(dpkg --print-architecture)" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" | \
      "${sudo_cmd[@]}" tee /etc/apt/sources.list.d/secure-cloud-docker.list >/dev/null
    "${sudo_cmd[@]}" apt-get update
    "${sudo_cmd[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  if ! docker compose version >/dev/null 2>&1; then
    "${sudo_cmd[@]}" apt-get update
    if dpkg-query -W -f='${Status}' docker.io 2>/dev/null | grep -q 'install ok installed'; then
      "${sudo_cmd[@]}" apt-get install -y docker-compose-v2 docker-buildx
    else
      "${sudo_cmd[@]}" apt-get install -y docker-compose-plugin docker-buildx-plugin
    fi
  fi
  if ! docker info >/dev/null 2>&1; then
    "${sudo_cmd[@]}" systemctl start docker
  fi
fi
if ! docker info >/dev/null 2>&1; then docker_cmd=("${sudo_cmd[@]}" docker); fi
"${docker_cmd[@]}" info >/dev/null
version=$("${docker_cmd[@]}" compose version --short)
dpkg --compare-versions "${version#v}" ge 2.24.0 || {
  echo 'Docker Compose >= 2.24.0 is required. Upgrade your Compose plugin and rerun.' >&2; exit 1;
}
compose() { "${docker_cmd[@]}" compose -f compose.yaml "$@"; }
if [[ "$mode" == --status ]]; then compose ps -a; exit; fi
if [[ "$mode" == --uninstall ]]; then
  read -r -p 'Type UNINSTALL to remove application containers (all files, volumes and configuration stay): ' answer
  [[ "$answer" == UNINSTALL ]] || { echo 'Cancelled.'; exit 0; }
  compose stop "${services[@]}"
  compose rm -f "${services[@]}"
  echo 'Application containers removed. Monitoring, Docker, configuration and all data retained.'
  exit
fi

# Refuse to generate replacement credentials when a database already exists.
existing_database=0
if "${docker_cmd[@]}" volume inspect self-cloud-prj_postgres_data >/dev/null 2>&1; then existing_database=1; fi
if [[ -d /srv/secure-cloud-storage ]] && \
  "${sudo_cmd[@]}" find /srv/secure-cloud-storage -mindepth 1 -maxdepth 1 -printf x -quit | grep -q x; then
  existing_database=1
fi
read -r app_uid app_gid < <(python3 scripts/install-config.py "$existing_database")
[[ "$app_uid" =~ ^[0-9]+$ && "$app_gid" =~ ^[0-9]+$ ]] || exit 1
if [[ ! -e /srv/secure-cloud-storage ]]; then
  "${sudo_cmd[@]}" install -d -m 0700 -o "$app_uid" -g "$app_gid" /srv/secure-cloud-storage
fi
[[ -d /srv/secure-cloud-storage && ! -L /srv/secure-cloud-storage ]] || {
  echo '/srv/secure-cloud-storage must be a real directory.' >&2; exit 1;
}
if ! "${sudo_cmd[@]}" setpriv --reuid "$app_uid" --regid "$app_gid" --clear-groups test -w /srv/secure-cloud-storage; then
  echo "Storage is not writable by application UID $app_uid. Correct ownership before rerunning; existing permissions were preserved." >&2; exit 1
fi
compose config --quiet
for volume in self-cloud-prj_postgres_data self-cloud-prj_redis_data; do
  "${docker_cmd[@]}" volume inspect "$volume" >/dev/null 2>&1 || "${docker_cmd[@]}" volume create "$volume" >/dev/null
done
compose build backend frontend
compose up -d --wait --wait-timeout 180 postgres redis
# Explicitly run the existing migration command on every update, including when
# a previous one-shot migration container already exited successfully.
compose run --rm --no-deps migrate
compose up -d --wait --wait-timeout 180 "${services[@]}"
curl --fail --silent --show-error --max-time 15 http://localhost:8080/health >/dev/null
compose ps -a
echo 'Secure Cloud is ready: http://localhost:8080'
