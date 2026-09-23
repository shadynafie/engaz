#!/usr/bin/env bash

set -Eeuo pipefail

DOWNLOAD_BASE="${ENGAZ_DOWNLOAD_BASE:-https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose}"
while [[ "$DOWNLOAD_BASE" == */ ]]; do
  DOWNLOAD_BASE="${DOWNLOAD_BASE%/}"
done
case "$DOWNLOAD_BASE" in
  https://*) ;;
  *)
    echo "Engaz setup failed: ENGAZ_DOWNLOAD_BASE must use https." >&2
    exit 1
    ;;
esac
readonly DOWNLOAD_BASE

readonly COMPOSE_FILE="docker-compose.images.yml"
readonly ENV_EXAMPLE=".env.images.example"
readonly ENV_FILE=".env"
readonly DATA_DIR_COMPOSE_FILE="docker-compose.data-dir.yml"
readonly MIN_DATA_DIR_FREE_GB=10

prepare_only=false
skip_existing=false
pull_never=false
data_dir=""
if [[ "${ENGAZ_DOWNLOAD_SKIP_EXISTING:-}" == "1" ]]; then
  skip_existing=true
fi
if [[ "${ENGAZ_PULL_NEVER:-}" == "1" ]]; then
  pull_never=true
fi

for arg in "$@"; do
  case "$arg" in
    --prepare-only)
      prepare_only=true
      ;;
    --local)
      skip_existing=true
      ;;
    --pull-never)
      pull_never=true
      ;;
    --offline)
      # Air-gap bootstrap: keep local Compose/env files and do not pull images.
      skip_existing=true
      pull_never=true
      ;;
    --data-dir=*)
      data_dir="${arg#--data-dir=}"
      ;;
    *)
      echo "Usage: bash install-images.sh [--prepare-only] [--local] [--pull-never] [--offline] [--data-dir=/absolute/path]" >&2
      exit 2
      ;;
  esac
done

temporary_file=""
cleanup() {
  if [[ -n "$temporary_file" ]]; then
    rm -f -- "$temporary_file"
  fi
}
trap cleanup EXIT

fail() {
  echo "Engaz setup failed: $*" >&2
  exit 1
}

for command_name in curl openssl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "'$command_name' is required."
done

# Questions read the keyboard even when this script arrives through `curl ... | bash`.
# ENGAZ_TTY lets the installer smokes answer them from a file.
readonly TTY="${ENGAZ_TTY:-/dev/tty}"
interactive=false
if [[ "${ENGAZ_NONINTERACTIVE:-}" != 1 ]] && (: <"$TTY") 2>/dev/null; then
  interactive=true
fi

ask() {
  local answer=""
  printf '%s ' "$1" >&2
  IFS= read -r answer <"$TTY" || answer=""
  printf '%s' "$answer"
}

install_docker() {
  local answer
  case "$(uname -s)" in
    Linux)
      echo "Docker is not installed. Engaz can install it with Docker's official script:"
      echo "  curl -fsSL https://get.docker.com | sudo sh"
      [[ "$interactive" == true ]] || fail "Docker is required. Run the command above, then run this installer again."
      answer=$(ask "Install Docker now? [y/N]")
      [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]] \
        || fail "Docker is required. Run the command above, then run this installer again."
      temporary_file=$(mktemp)
      curl -fsSL --proto '=https' https://get.docker.com -o "$temporary_file" \
        || fail "could not download Docker's install script."
      sudo sh "$temporary_file" || fail "Docker installation failed."
      rm -f -- "$temporary_file"
      temporary_file=""
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl enable --now docker >/dev/null 2>&1 || true
      fi
      ;;
    Darwin)
      fail "Docker is not installed. Install Docker Desktop from https://docs.docker.com/desktop/setup/install/mac-install/, open it once, then run this command again."
      ;;
    *)
      fail "Docker is not installed. Install Docker Desktop (on Windows, run this command inside WSL) or Docker Engine, then run this command again."
      ;;
  esac
}

# A new Linux Docker user is usually not in the docker group yet. Docker access is
# root-equivalent, so use sudo for this run rather than changing group membership.
use_docker() {
  local sudo_args=(-n)
  docker info >/dev/null 2>&1 && return 0
  if [[ "$(uname -s)" == Linux ]] && command -v sudo >/dev/null 2>&1; then
    [[ "$interactive" == true ]] && sudo_args=()
    if sudo ${sudo_args[@]+"${sudo_args[@]}"} docker info >/dev/null 2>&1; then
      echo "Using sudo for Docker. To use Docker without sudo later: sudo usermod -aG docker $(id -un)"
      docker() { sudo docker "$@"; }
      return 0
    fi
    fail "cannot reach the Docker daemon. Start it with: sudo systemctl start docker"
  fi
  fail "cannot reach the Docker daemon. Start Docker, then run this command again."
}

if ! command -v docker >/dev/null 2>&1; then
  [[ "$prepare_only" != true ]] || fail "'docker' is required."
  install_docker
fi
if [[ "$prepare_only" != true ]]; then
  use_docker
fi
docker compose version >/dev/null 2>&1 \
  || fail "the Docker Compose plugin is required. Install Docker Desktop, or the docker-compose-plugin package from Docker's repository."

# The data-dir Compose file uses !override and !reset, added in Compose 2.24.
compose_supports_data_dir() {
  local version major minor
  version=$(docker compose version --short 2>/dev/null || true)
  version="${version#v}"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  ((major > 2 || (major == 2 && minor >= 24)))
}

# Compose labels every container with the folder it was started from.
existing_install_dir() {
  [[ "$prepare_only" != true ]] || return 0
  docker ps -a --filter label=com.docker.compose.project=engaz \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | awk 'NF' | head -n 1
}

# Everything that must survive (Postgres data, app/agent data, and .env secrets)
# lives under one host folder. New installations only: existing data is never
# moved or shadowed here.
prepare_data_dir() {
  local entry name available_kb
  [[ "$data_dir" == /* ]] || fail "--data-dir must be an absolute path."
  case "$data_dir" in
    *:* | *,* | *$'\n'*) fail "--data-dir cannot contain ':', ',' or a newline." ;;
  esac
  while [[ "$data_dir" == */ && "$data_dir" != / ]]; do
    data_dir="${data_dir%/}"
  done
  [[ "$data_dir" != / ]] || fail "--data-dir cannot be /."
  compose_supports_data_dir || fail "--data-dir needs Docker Compose 2.24 or newer."
  if [[ -e "$data_dir" && ! -d "$data_dir" ]]; then
    fail "$data_dir exists and is not a folder."
  fi
  if [[ ! -e "$data_dir" ]]; then
    mkdir -p -- "$data_dir" || fail "could not create $data_dir."
    chmod 700 "$data_dir"
  fi
  data_dir=$(cd -- "$data_dir" && pwd -P)
  [[ -w "$data_dir" && -x "$data_dir" ]] || fail "$data_dir is not writable by $(id -un)."

  if [[ -e "$data_dir/$ENV_FILE" ]]; then
    grep -qxF "ENGAZ_DATA_DIR=$data_dir" "$data_dir/$ENV_FILE" \
      || fail "$data_dir/.env does not belong to an Engaz installation in this folder."
  else
    for entry in "$data_dir"/* "$data_dir"/.[!.]* "$data_dir"/..?*; do
      [[ -e "$entry" || -L "$entry" ]] || continue
      name="${entry##*/}"
      case "$name" in
        install-images.sh | "$COMPOSE_FILE" | "$DATA_DIR_COMPOSE_FILE" | "$ENV_EXAMPLE") ;;
        *) fail "$data_dir is not empty. Choose an empty folder for a new installation." ;;
      esac
    done
  fi

  available_kb=$(df -Pk "$data_dir" | awk 'NR == 2 { print $4 }')
  [[ "$available_kb" =~ ^[0-9]+$ ]] || fail "could not read free space for $data_dir."
  if ((available_kb < MIN_DATA_DIR_FREE_GB * 1024 * 1024)); then
    fail "$data_dir has $((available_kb / 1024 / 1024)) GB free; Engaz needs at least ${MIN_DATA_DIR_FREE_GB} GB."
  fi

  mkdir -p -- "$data_dir/postgres" "$data_dir/appdata" || fail "could not create folders in $data_dir."
  cd -- "$data_dir"
  echo "Keeping Engaz data in $data_dir"
}

ask_data_dir() {
  local answer
  echo "Where should Engaz keep its data?" >&2
  answer=$(ask "Press Enter to use Docker's own storage, or type a folder path:")
  answer="${answer#"${answer%%[![:space:]]*}"}"
  answer="${answer%"${answer##*[![:space:]]}"}"
  [[ -n "$answer" ]] || return 0
  case "$answer" in
    "~") answer="$HOME" ;;
    "~/"*) answer="$HOME/${answer#"~/"}" ;;
    /*) ;;
    *) answer="$PWD/$answer" ;;
  esac
  data_dir="$answer"
}

# Rerunning the one-line command updates the installation it finds. A second
# installation would get new secrets that cannot read the existing data.
if [[ ! -f "$ENV_FILE" ]]; then
  existing_dir=$(existing_install_dir)
  if [[ -n "$existing_dir" && "$existing_dir" != "$PWD" ]]; then
    [[ -z "$data_dir" ]] || fail "Engaz is already installed in $existing_dir. Run this command without --data-dir to update it."
    [[ -f "$existing_dir/$ENV_FILE" ]] || fail "Engaz is already installed in $existing_dir, but its .env is missing."
    cd -- "$existing_dir"
    echo "Updating the Engaz installation in $existing_dir"
  elif [[ -z "$data_dir" ]]; then
    [[ "$interactive" != true ]] || ask_data_dir
    # `curl ... | bash` has no script folder; keep the files in one predictable place.
    if [[ -z "$data_dir" && ! -f "${BASH_SOURCE[0]:-}" ]]; then
      mkdir -p -- "$HOME/engaz"
      cd -- "$HOME/engaz"
    fi
  fi
fi

# A rerun from inside a data folder keeps using it even without --data-dir; starting
# without the data-dir Compose file would switch to empty named volumes.
if [[ -z "$data_dir" && -f "$ENV_FILE" ]]; then
  data_dir=$(sed -n 's/^ENGAZ_DATA_DIR=//p' "$ENV_FILE" | tail -n 1)
fi
if [[ -n "$data_dir" ]]; then
  prepare_data_dir
fi

compose_args=(--env-file "$ENV_FILE" -f "$COMPOSE_FILE")
if [[ -n "$data_dir" ]]; then
  compose_args+=(-f "$DATA_DIR_COMPOSE_FILE")
fi

# Optional proxy knobs from an existing .env (operators often set them there for
# containers). Do not override values already present in the shell. Treat each
# HTTP/HTTPS/NO_PROXY pair as one family so either case in the shell wins.
# Within .env, later assignments for a family win (shell presence is snapshotted
# before the file is read). Comment stripping is quote-aware so `#` inside
# matching quotes is kept; this is not a full dotenv parser.
load_proxy_vars_from_env_file() {
  local file="$1"
  local line key value
  local i c quote out
  local shell_http=0 shell_https=0 shell_no=0
  [[ -f "$file" ]] || return 0
  [[ -n "${HTTP_PROXY+x}" || -n "${http_proxy+x}" ]] && shell_http=1
  [[ -n "${HTTPS_PROXY+x}" || -n "${https_proxy+x}" ]] && shell_https=1
  [[ -n "${NO_PROXY+x}" || -n "${no_proxy+x}" ]] && shell_no=1
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Windows/.editorconfig CRLF: drop trailing CR so quoted values still match.
    line="${line%$'\r'}"
    out=""
    quote=""
    for ((i = 0; i < ${#line}; i++)); do
      c="${line:i:1}"
      if [[ -n "$quote" ]]; then
        # Inside double quotes, treat \" and \\ as escaped so \# stays in-value.
        if [[ "$quote" == '"' && "$c" == '\' ]] && ((i + 1 < ${#line})); then
          out+="$c"
          i=$((i + 1))
          out+="${line:i:1}"
          continue
        fi
        out+="$c"
        [[ "$c" == "$quote" ]] && quote=""
      elif [[ "$c" == "'" || "$c" == '"' ]]; then
        quote="$c"
        out+="$c"
      elif [[ "$c" == "#" ]]; then
        break
      else
        out+="$c"
      fi
    done
    line="$out"
    [[ "$line" =~ ^[[:space:]]*(HTTP_PROXY|HTTPS_PROXY|NO_PROXY|http_proxy|https_proxy|no_proxy)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
      value="${value//\\\"/\"}"
      value="${value//\\\\/\\}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
    case "$key" in
      HTTP_PROXY|http_proxy)
        if ((shell_http)); then
          continue
        fi
        unset -v HTTP_PROXY http_proxy
        ;;
      HTTPS_PROXY|https_proxy)
        if ((shell_https)); then
          continue
        fi
        unset -v HTTPS_PROXY https_proxy
        ;;
      NO_PROXY|no_proxy)
        if ((shell_no)); then
          continue
        fi
        unset -v NO_PROXY no_proxy
        ;;
    esac
    export "${key}=${value}"
  done <"$file"
}

# curl uses lowercase http_proxy for http:// URLs; many Mainland hosts only export HTTP_PROXY.
sync_curl_proxy_env() {
  if [[ -n "${HTTP_PROXY+x}" && -z "${http_proxy+x}" ]]; then
    export http_proxy="$HTTP_PROXY"
  fi
  if [[ -n "${HTTPS_PROXY+x}" && -z "${https_proxy+x}" ]]; then
    export https_proxy="$HTTPS_PROXY"
  fi
  if [[ -n "${NO_PROXY+x}" && -z "${no_proxy+x}" ]]; then
    export no_proxy="$NO_PROXY"
  fi
}

prepare_proxy_env() {
  load_proxy_vars_from_env_file "$ENV_FILE"
  sync_curl_proxy_env
}
prepare_proxy_env

curl_download() {
  local url="$1"
  local out="$2"
  local attempt
  local max_attempts=3

  if curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'; then
    curl -fsSL --proto-redir =https --retry 3 --retry-delay 2 --retry-all-errors "$url" -o "$out"
    return $?
  fi

  attempt=1
  while [[ "$attempt" -le "$max_attempts" ]]; do
    if curl -fsSL --proto-redir =https "$url" -o "$out"; then
      return 0
    fi
    if [[ "$attempt" -eq "$max_attempts" ]]; then
      return 1
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  return 1
}

download() {
  local filename="$1"
  local url="${DOWNLOAD_BASE}/${filename}"

  if [[ "$skip_existing" == true && -e "$filename" ]]; then
    echo "Using local ${filename}"
    return 0
  fi

  temporary_file=$(mktemp "./${filename}.tmp.XXXXXX")
  if ! curl_download "$url" "$temporary_file"; then
    fail "could not download ${filename} from ${url}. Set HTTP_PROXY/HTTPS_PROXY in the shell or .env (NO_PROXY for localhost), or pre-place the file and use --local / --offline."
  fi
  mv -- "$temporary_file" "$filename"
  temporary_file=""
}

create_env() {
  umask 077
  temporary_file=$(mktemp "./${ENV_FILE}.tmp.XXXXXX")

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "POSTGRES_PASSWORD=")
        printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 16)"
        ;;
      "BETTER_AUTH_SECRET=")
        printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)"
        ;;
      "ENCRYPTION_KEY=")
        printf 'ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)"
        ;;
      "SCREEN_PROXY_SECRET=")
        printf 'SCREEN_PROXY_SECRET=%s\n' "$(openssl rand -hex 32)"
        ;;
      "SANDBOX_SUPERVISOR_TOKEN=")
        printf 'SANDBOX_SUPERVISOR_TOKEN=%s\n' "$(openssl rand -hex 32)"
        ;;
      *)
        printf '%s\n' "$line"
        ;;
    esac
  done < "$ENV_EXAMPLE" > "$temporary_file"
  if [[ -n "$data_dir" ]]; then
    printf '\nENGAZ_DATA_DIR=%s\nCOMPOSE_FILE=%s:%s\n' \
      "$data_dir" "$COMPOSE_FILE" "$DATA_DIR_COMPOSE_FILE" >> "$temporary_file"
  fi

  chmod 600 "$temporary_file"
  mv -- "$temporary_file" "$ENV_FILE"
  temporary_file=""
  echo "Created .env with random secrets."
}

validate_required_secrets() {
  if ! docker compose "${compose_args[@]}" -f - config --environment <<'YAML' | awk '
    BEGIN {
      required["POSTGRES_PASSWORD"] = 1
      required["BETTER_AUTH_SECRET"] = 1
      required["ENCRYPTION_KEY"] = 1
      required["SCREEN_PROXY_SECRET"] = 1
      required["SANDBOX_SUPERVISOR_TOKEN"] = 1
    }
    {
      name = $0
      sub(/=.*/, "", name)
      if (!(name in required)) next
      seen[name]++

      value = $0
      sub(/^[^=]*=/, "", value)
      gsub(/[[:space:]]/, "", value)
      if (value != "") nonempty[name]++
    }
    END {
      for (name in required) {
        if (seen[name] != 1 || nonempty[name] != 1) exit 1
      }
    }
  '
services:
  api:
    environment:
      _ENGAZ_VALIDATE_POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      _ENGAZ_VALIDATE_BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET in .env}
      _ENGAZ_VALIDATE_ENCRYPTION_KEY: ${ENCRYPTION_KEY:?Set ENCRYPTION_KEY in .env}
      _ENGAZ_VALIDATE_SCREEN_PROXY_SECRET: ${SCREEN_PROXY_SECRET:?Set SCREEN_PROXY_SECRET in .env}
      _ENGAZ_VALIDATE_SANDBOX_SUPERVISOR_TOKEN: ${SANDBOX_SUPERVISOR_TOKEN:?Set SANDBOX_SUPERVISOR_TOKEN in .env}
YAML
  then
    fail "set every required secret in .env to a non-empty value."
  fi
}

download "$COMPOSE_FILE"
download "$ENV_EXAMPLE"
if [[ -n "$data_dir" ]]; then
  download "$DATA_DIR_COMPOSE_FILE"
fi

if [[ -e "$ENV_FILE" ]]; then
  echo "Keeping existing .env."
else
  if [[ "$prepare_only" != true && -n "$(docker volume ls -q --filter name=^engaz_pgdata$ 2>/dev/null)" ]]; then
    fail "this Docker host already has an Engaz database (volume engaz_pgdata) from an earlier installation. Run this command from that installation's folder, which holds its .env secrets."
  fi
  create_env
fi

validate_required_secrets

# Port settings may live in .env; later assignments win, as in Compose.
env_value() {
  local value
  value=$(sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n 1 | tr -d "\"' \r")
  printf '%s' "${value:-$2}"
}

check_ports() {
  local port
  # A rerun upgrades a running stack, whose containers already hold these ports.
  if [[ -n "$(docker ps -q --filter label=com.docker.compose.project=engaz 2>/dev/null)" ]]; then
    return 0
  fi
  for port in "$(env_value ENGAZ_WEB_PORT 7791)" "$(env_value ENGAZ_API_PORT 7792)"; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      fail "port $port on 127.0.0.1 is already in use. Stop the program using it, or set ENGAZ_WEB_PORT / ENGAZ_API_PORT in .env."
    fi
  done
}

if [[ "$prepare_only" == true ]]; then
  echo "Engaz files are ready. Edit .env, then run: bash install-images.sh${data_dir:+ --data-dir=$data_dir}"
  exit 0
fi

check_ports
prepare_proxy_env
if [[ "$pull_never" == true ]]; then
  echo "Skipping image pull (--pull-never / --offline); images must already be on this Docker host."
else
  if ! docker compose "${compose_args[@]}" pull; then
    fail "could not pull images. Shell HTTP_PROXY often does not reach the Docker daemon. Configure daemon proxy/registry-mirrors, set image env vars to a reachable registry, or preload images then compose up with --pull never."
  fi
fi
# `--wait` without `--wait-timeout` can hang on one-shot services (Compose < 2.7)
# or never return if a healthcheck stays red (Compose < 2.17). Prefer both flags.
compose_up_help=$(docker compose up --help 2>/dev/null || true)
up_pull_args=()
if [[ "$pull_never" == true ]]; then
  if grep -q -- '--pull' <<<"$compose_up_help"; then
    up_pull_args=(--pull never)
  else
    echo "cannot enforce pull-never on this Compose version; startup fails if an image is missing locally" >&2
  fi
fi
# bash 3.2 + set -u: "${arr[@]}" aborts when arr is empty.
url="http://127.0.0.1:$(env_value ENGAZ_WEB_PORT 7791)"
if grep -q -- '--wait-timeout' <<<"$compose_up_help"; then
  echo "Waiting for healthy services."
  docker compose "${compose_args[@]}" up -d ${up_pull_args[@]+"${up_pull_args[@]}"} --wait --wait-timeout 300
  echo "Engaz is ready. Open $url in your browser to set it up."
else
  docker compose "${compose_args[@]}" up -d ${up_pull_args[@]+"${up_pull_args[@]}"}
  echo "Engaz is starting. In a minute, open $url in your browser to set it up."
fi
echo "Engaz files are in $PWD. Run this command again to update."
if [[ -n "$data_dir" ]]; then
  echo "Data and secrets are in $data_dir. Back up that whole folder."
fi
