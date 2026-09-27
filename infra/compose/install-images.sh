#!/usr/bin/env bash

set -Eeuo pipefail

readonly RELEASE_VERSION=""
readonly DEFAULT_DOWNLOAD_BASE="https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose"
DOWNLOAD_BASE="${ENGAZ_DOWNLOAD_BASE:-$DEFAULT_DOWNLOAD_BASE}"
[[ -z "$RELEASE_VERSION" ]] || DOWNLOAD_BASE="$DEFAULT_DOWNLOAD_BASE"
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

# Emoji make each step easy to spot; terminals without UTF-8 get plain text.
emoji=false
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*) emoji=true ;;
esac
if [[ "${ENGAZ_PLAIN:-}" == 1 || "${TERM:-}" == dumb ]]; then
  emoji=false
fi

say() {
  if [[ "$emoji" == true ]]; then
    printf '%s %s\n' "$1" "$2"
  else
    printf '%s\n' "$2"
  fi
}

step() {
  echo
  say "$1" "$2"
}

fail() {
  say "❌" "Engaz setup failed: $*" >&2
  exit 1
}

platform=linux
case "$(uname -s)" in
  Darwin) platform=macos ;;
  Linux)
    if [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
      platform=wsl
    fi
    ;;
  *) platform=other ;;
esac
readonly platform
readonly WINDOWS_INSTALL_COMMAND="irm ${DOWNLOAD_BASE}/install.ps1 | iex"
readonly WINDOWS_DOCKER_DESKTOP="${ENGAZ_WINDOWS_DOCKER_DESKTOP:-/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe}"

# Questions read the keyboard even when this script arrives through `curl ... | bash`.
# ENGAZ_TTY lets the installer smokes answer them from a file.
readonly TTY="${ENGAZ_TTY:-/dev/tty}"
interactive=false
if [[ "${ENGAZ_NONINTERACTIVE:-}" != 1 ]] && (: <"$TTY") 2>/dev/null; then
  exec 3<"$TTY"
  interactive=true
fi

# Answers come from one open descriptor so each question reads the next line.
ask() {
  local answer=""
  printf '%s ' "$1" >&2
  IFS= read -r answer <&3 || answer=""
  printf '%s' "$answer"
}

# Enter accepts; only an explicit no declines.
confirm() {
  local answer
  answer=$(ask "$1 [Y/n]")
  [[ ! "$answer" =~ ^[[:space:]]*[nN] ]]
}

step "👋" "Welcome to Engaz! Let's get your AI team workspace running."

for command_name in curl openssl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "'$command_name' is required. Install it with your system's package manager, then run this command again."
done

python_ready() {
  python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1
}

# A new Mac has only a python3 placeholder until Apple's Command Line Tools are installed.
if ! python_ready; then
  if [[ "$platform" == macos ]] && ! xcode-select -p >/dev/null 2>&1; then
    step "🧰" "Engaz needs Apple's Command Line Tools, which include Python."
    xcode-select --install >/dev/null 2>&1 || true
    [[ "$interactive" == true ]] || fail "install Apple's Command Line Tools with xcode-select --install, then run this command again."
    say "⏳" "Click Install in the window that opened. Setup continues when it finishes."
    waited=0
    until xcode-select -p >/dev/null 2>&1 && python_ready; do
      ((waited < 3600)) || fail "Apple's Command Line Tools were not installed. Run this command again to retry."
      sleep 5
      waited=$((waited + 5))
    done
  else
    fail "Python 3.9 or newer is required. Install your operating system's python3 package, then run this command again."
  fi
fi

# Docker Desktop and its Mac alternatives provide Docker only while their app runs.
docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

# Docker Desktop for Mac puts its command-line tools on PATH only for new terminals.
add_mac_docker_path() {
  local directory
  [[ "$platform" == macos ]] || return 0
  for directory in "$HOME/.docker/bin" /usr/local/bin /Applications/Docker.app/Contents/Resources/bin; do
    if [[ -x "$directory/docker" && ":$PATH:" != *":$directory:"* ]]; then
      PATH="$PATH:$directory"
    fi
  done
  export PATH
}
add_mac_docker_path

wait_for_docker() {
  local waited=0
  say "⏳" "Waiting for $1 to start. The first start can take a few minutes."
  until docker_ready; do
    ((waited < 300)) || return 1
    sleep 3
    waited=$((waited + 3))
    add_mac_docker_path
  done
  say "✅" "$1 is running."
}

start_docker_app() {
  local app
  case "$platform" in
    macos)
      if [[ -d /Applications/Docker.app ]]; then
        app="Docker Desktop"
        open -g -a Docker || return 1
      elif [[ -d /Applications/OrbStack.app ]]; then
        app=OrbStack
        open -g -a OrbStack || return 1
      elif command -v colima >/dev/null 2>&1; then
        app=Colima
        say "🐳" "Starting Colima."
        colima start >&2 || return 1
      else
        return 1
      fi
      ;;
    wsl)
      [[ -f "$WINDOWS_DOCKER_DESKTOP" ]] || return 1
      app="Docker Desktop"
      cmd.exe /c start "" "$(wslpath -w "$WINDOWS_DOCKER_DESKTOP")" >/dev/null 2>&1 || return 1
      ;;
    *) return 1 ;;
  esac
  wait_for_docker "$app"
}

install_docker_desktop_mac() {
  local architecture url mount_point
  case "$(uname -m)" in
    arm64) architecture=arm64 ;;
    *) architecture=amd64 ;;
  esac
  url="https://desktop.docker.com/mac/main/$architecture/Docker.dmg"
  step "🐳" "Engaz runs on Docker, which is not installed yet."
  echo "   Engaz can install Docker Desktop for you (about 600 MB)."
  echo "   It is free for personal use and small businesses. Installing it accepts the Docker"
  echo "   Subscription Service Agreement: https://www.docker.com/legal/docker-subscription-service-agreement/"
  [[ "$interactive" == true ]] \
    || fail "Docker is required. Install Docker Desktop from https://docs.docker.com/desktop/setup/install/mac-install/, open it once, then run this command again."
  confirm "Install Docker Desktop now?" \
    || fail "Docker is required. Install Docker Desktop from https://docs.docker.com/desktop/setup/install/mac-install/, open it once, then run this command again."
  say "⬇️ " "Downloading Docker Desktop."
  temporary_file=$(mktemp "${TMPDIR:-/tmp}/engaz-docker.XXXXXX")
  curl -fL --proto '=https' --progress-bar "$url" -o "$temporary_file" \
    || fail "could not download Docker Desktop."
  mount_point=$(mktemp -d "${TMPDIR:-/tmp}/engaz-docker-mount.XXXXXX")
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$mount_point" "$temporary_file" \
    || fail "could not open the Docker Desktop download."
  say "🔑" "Enter your Mac password to install Docker Desktop."
  if ! sudo "$mount_point/Docker.app/Contents/MacOS/install" --accept-license --user="$(id -un)" <&3; then
    hdiutil detach -quiet "$mount_point" || true
    fail "Docker Desktop installation failed."
  fi
  hdiutil detach -quiet "$mount_point" || true
  rmdir "$mount_point" 2>/dev/null || true
  rm -f -- "$temporary_file"
  temporary_file=""
  start_docker_app || fail "Docker Desktop did not start. Open Docker Desktop from Applications, then run this command again."
}

install_docker() {
  local os_ids="" install_command
  case "$platform" in
    linux)
      if [[ -r /etc/os-release ]]; then
        os_ids=$(. /etc/os-release && printf '%s %s' "${ID:-}" "${ID_LIKE:-}")
      fi
      # Docker's script does not support Arch-based systems; they package Docker themselves.
      case " $os_ids " in
        *" arch "* | *" archarm "*) install_command="sudo pacman -Syu --needed docker docker-compose" ;;
        *) install_command="curl -fsSL https://get.docker.com | sudo sh" ;;
      esac
      step "🐳" "Engaz runs on Docker, which is not installed yet. Engaz can install it with:"
      echo "   $install_command"
      [[ "$interactive" == true ]] || fail "Docker is required. Run the command above, then run this installer again."
      confirm "Install Docker now?" \
        || fail "Docker is required. Run the command above, then run this installer again."
      if [[ "$install_command" == "sudo pacman "* ]]; then
        # pacman asks its own questions; answer them from the terminal, not the piped script.
        sudo pacman -Syu --needed docker docker-compose <&3 || fail "Docker installation failed."
      else
        temporary_file=$(mktemp)
        curl -fsSL --proto '=https' https://get.docker.com -o "$temporary_file" \
          || fail "could not download Docker's install script."
        sudo sh "$temporary_file" || fail "Docker installation failed."
        rm -f -- "$temporary_file"
        temporary_file=""
      fi
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl enable --now docker >/dev/null 2>&1 || true
      fi
      ;;
    macos)
      install_docker_desktop_mac
      ;;
    wsl)
      if [[ -f "$WINDOWS_DOCKER_DESKTOP" ]]; then
        fail "Docker Desktop is not connected to this Linux distribution. In Docker Desktop, open Settings > Resources > WSL integration, turn on ${WSL_DISTRO_NAME:-this distribution}, then run this command again."
      fi
      fail "Docker Desktop is required. In Windows PowerShell, run: $WINDOWS_INSTALL_COMMAND"
      ;;
    *)
      fail "Docker is not installed. Install Docker Desktop or Docker Engine, then run this command again."
      ;;
  esac
}

# A new Linux Docker user is usually not in the docker group yet. Docker access is
# root-equivalent, so use sudo for this run rather than changing group membership.
use_docker() {
  local sudo_args=(-n)
  docker info >/dev/null 2>&1 && return 0
  if [[ "$platform" == macos || "$platform" == wsl ]]; then
    start_docker_app && return 0
    if [[ "$platform" == wsl && -f "$WINDOWS_DOCKER_DESKTOP" ]]; then
      fail "Docker Desktop is not connected to this Linux distribution. In Docker Desktop, open Settings > Resources > WSL integration, turn on ${WSL_DISTRO_NAME:-this distribution}, then run this command again."
    fi
    fail "cannot reach Docker. Start Docker Desktop, then run this command again."
  fi
  if [[ "$platform" == linux ]] && command -v sudo >/dev/null 2>&1; then
    [[ "$interactive" == true ]] && sudo_args=()
    if sudo ${sudo_args[@]+"${sudo_args[@]}"} docker info >/dev/null 2>&1; then
      echo "Using sudo for Docker. To use Docker without sudo later: sudo usermod -aG docker $(id -un)"
      docker() { sudo docker "$@"; }
      export ENGAZ_DOCKER_SUDO=1
      return 0
    fi
    fail "cannot reach the Docker daemon. Start it with: sudo systemctl start docker"
  fi
  fail "cannot reach the Docker daemon. Start Docker, then run this command again."
}

step "🐳" "Checking Docker."
if ! command -v docker >/dev/null 2>&1; then
  [[ "$prepare_only" != true ]] || fail "'docker' is required."
  # An installed Docker Desktop may simply not be running yet.
  start_docker_app || install_docker
fi
if [[ "$prepare_only" != true ]]; then
  use_docker
fi
docker compose version >/dev/null 2>&1 \
  || fail "the Docker Compose plugin is required. Install Docker Desktop, or the docker-compose-plugin package from Docker's repository."

# Some vendor Compose builds advertise JSON but emit YAML. Check the capabilities
# used by both setup and the lifecycle CLI before creating files or secrets.
compose_config_help=$(docker compose config --help </dev/null 2>/dev/null || true)
if ! grep -q -- '--environment' <<<"$compose_config_help" \
  || ! grep -q -- '--format' <<<"$compose_config_help"; then
  fail "Docker Compose must support config --environment and JSON output. Upgrade the Docker Compose plugin, then run setup again."
fi
if ! docker compose --project-name engaz-preflight --env-file /dev/null -f - config --format json <<'YAML' | python3 -c 'import json,sys; value=json.load(sys.stdin); sys.exit(not isinstance(value.get("services"),dict))' >/dev/null 2>&1
services:
  probe:
    image: busybox:1
YAML
then
  fail "Docker Compose must support config --environment and JSON output. Upgrade the Docker Compose plugin, then run setup again."
fi

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
  local directory
  directory=$(docker ps -a --filter "label=com.docker.compose.project.working_dir=$PWD" \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | awk 'NF' | head -n 1) || true
  if [[ -n "$directory" ]]; then
    printf '%s\n' "$directory"
    return 0
  fi
  docker ps -a --filter label=com.docker.compose.project=engaz \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | awk 'NF' | head -n 1 || true
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
  if [[ "$platform" == wsl && "$data_dir" == /mnt/* ]]; then
    fail "Windows drives cannot hold the Engaz database. Use a Linux folder such as ~/engaz-data, or leave out --data-dir to use Docker's storage."
  fi
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
  case "$data_dir" in
    *:* | *,* | *'$'* | *'#'* | *$'\n'* | *$'\r'* | *[[:space:]])
      fail "--data-dir cannot contain dotenv interpolation characters or trailing whitespace." ;;
  esac
  [[ -w "$data_dir" && -x "$data_dir" ]] || fail "$data_dir is not writable by $(id -un)."

  if [[ -e "$data_dir/$ENV_FILE" ]]; then
    grep -qxF "ENGAZ_DATA_DIR=$data_dir" "$data_dir/$ENV_FILE" \
      || fail "$data_dir/.env does not belong to an Engaz installation in this folder."
  else
    for entry in "$data_dir"/* "$data_dir"/.[!.]* "$data_dir"/..?*; do
      [[ -e "$entry" || -L "$entry" ]] || continue
      name="${entry##*/}"
      case "$name" in
        install-images.sh | engaz | "$COMPOSE_FILE" | "$DATA_DIR_COMPOSE_FILE" | "$ENV_EXAMPLE") ;;
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
  say "📁" "Keeping Engaz data in $data_dir"
}

ask_data_dir() {
  local answer
  # Windows drives cannot hold the database; Docker Desktop's own storage can.
  [[ "$platform" != wsl ]] || return 0
  step "📁" "Where should Engaz keep its data?" >&2
  answer=$(ask "   Press Enter to use Docker's own storage, or type a folder path:")
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
    say "🔄" "Updating the Engaz installation in $existing_dir"
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

# Containers may have been removed while their data survives. Inspect the old
# Compose definition before downloading replacements; never execute dotenv text.
existing_storage() {
  local code
  [[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] || return 1
  if python3 -c '
import json, os, pathlib, re, subprocess, sys
try:
    env = os.environ.copy()
    for line in pathlib.Path(".env").read_text().splitlines():
        match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if match:
            env.pop(match[1], None)
    for name in ("COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_PROFILES", "COMPOSE_PATH_SEPARATOR", "ENGAZ_DATA_DIR"):
        env.pop(name, None)
    docker = ["sudo", "docker"] if os.environ.get("ENGAZ_DOCKER_SUDO") == "1" else ["docker"]
    config = json.loads(subprocess.run([*docker, "compose", *sys.argv[1:], "config", "--format", "json"], env=env,
                                      stdout=subprocess.PIPE, check=True, text=True).stdout)
    volumes = subprocess.run([*docker, "volume", "ls", "--format", "{{.Name}}"], stdout=subprocess.PIPE,
                             check=True, text=True).stdout.splitlines()
    for service, target in (("api", "/data"), ("postgres", "/var/lib/postgresql/data")):
        mount = next(m for m in config["services"][service]["volumes"] if m["target"] == target)
        if mount["type"] == "volume":
            name = config["volumes"][mount["source"]]["name"]
            if name in volumes:
                sys.exit(0)
        elif mount["type"] == "bind":
            path = pathlib.Path(mount["source"])
            if path.exists() and next(path.iterdir(), None) is not None:
                sys.exit(0)
    sys.exit(1)
except (ValueError, KeyError, StopIteration, OSError, subprocess.CalledProcessError):
    sys.exit(2)
' "${compose_args[@]}"; then
    return 0
  else
    code=$?
    [[ "$code" == 1 ]] || fail "could not inspect existing storage. Keep the original files and enroll with engaz status before updating."
    return 1
  fi
}

# Existing deployments update through the recovery-aware command. Do this before
# downloading anything, so a bootstrap rerun cannot replace their Compose files.
if [[ "$prepare_only" == true ]] \
  && { [[ -f .engaz-install.json ]] || [[ -n "$(existing_install_dir)" ]] || existing_storage; }; then
  fail "this installation is already enrolled or has existing data or containers. Use engaz update to update it."
fi
if [[ "$prepare_only" != true && -f "$ENV_FILE" ]] \
  && { [[ -f .engaz-install.json ]] || [[ -n "$(existing_install_dir)" ]] || existing_storage; }; then
  [[ -f engaz ]] || fail "this is an existing installation without the engaz command. Keep its .env and data; follow the lifecycle enrollment instructions before updating."
  [[ "$pull_never" != true ]] || fail "use engaz start to start an existing installation with local images; updates require a published release."
  step "🔄" "Engaz is already installed in $PWD. Updating it to the latest release; a backup is made first."
  if [[ -n "$RELEASE_VERSION" ]]; then
    exec python3 "$PWD/engaz" --dir "$PWD" update "$RELEASE_VERSION"
  fi
  exec python3 "$PWD/engaz" --dir "$PWD" update
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

detect_lan_ip() {
  python3 -c '
import ipaddress, os, socket, sys
nets = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]
override = os.environ.get("ENGAZ_LAN_IP")
candidates = []
if override is not None:
    candidates = [override]
else:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 80))
            candidates.append(sock.getsockname()[0])
    except OSError:
        pass
    try:
        candidates.extend(info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
for value in candidates:
    try:
        address = ipaddress.ip_address(value)
        if address.version == 4 and any(address in network for network in nets):
            print(address)
            sys.exit(0)
    except ValueError:
        pass
sys.exit(2 if override is not None else 1)
'
}

# WSL has its own internal address; Docker Desktop publishes ports on Windows' addresses.
windows_lan_ips() {
  command -v powershell.exe >/dev/null 2>&1 || return 0
  powershell.exe -NoProfile -NonInteractive -Command \
    'Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | ForEach-Object { $_.IPv4Address.IPAddress }' \
    2>/dev/null | tr -d '\r' || true
}

network_ip() {
  local candidate
  if [[ "$platform" != wsl || -n "${ENGAZ_LAN_IP+x}" ]]; then
    detect_lan_ip
    return
  fi
  for candidate in $(windows_lan_ips); do
    ENGAZ_LAN_IP="$candidate" detect_lan_ip && return 0
  done
  return 1
}

create_env() {
  local lan_ip web_port web_bind=0.0.0.0 release_commit=""
  if [[ "$DOWNLOAD_BASE" =~ /([0-9a-f]{40})/infra/compose$ ]]; then
    release_commit="${BASH_REMATCH[1]}"
  fi
  if ! lan_ip=$(network_ip); then
    [[ -z "${ENGAZ_LAN_IP+x}" ]] || fail "ENGAZ_LAN_IP must be this computer's private network IPv4 address."
    lan_ip=127.0.0.1
    web_bind=127.0.0.1
  fi
  web_port="${ENGAZ_WEB_PORT:-$(sed -n 's/^ENGAZ_WEB_PORT=//p' "$ENV_EXAMPLE" | tail -n 1 | tr -d "\"' \r")}"
  web_port="${web_port:-7791}"
  [[ "$web_port" =~ ^[0-9]{1,5}$ ]] && ((10#$web_port >= 1 && 10#$web_port <= 65535)) \
    || fail "ENGAZ_WEB_PORT must be between 1 and 65535."
  web_port=$((10#$web_port))
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
      OWNER_SETUP_KEY=* | ENGAZ_WEB_BIND=* | ENGAZ_WEB_PORT=* | ENGAZ_HOST=* | BETTER_AUTH_URL=* | WEB_ORIGIN=* | API_URL=* | AUTH_TRUSTED_ORIGINS=*)
        ;;
      ENGAZ_IMAGE_TAG=* | ENGAZ_COMPUTER_IMAGE_TAG=*)
        [[ -n "$release_commit" ]] || printf '%s\n' "$line"
        ;;
      *)
        printf '%s\n' "$line"
        ;;
    esac
  done < "$ENV_EXAMPLE" > "$temporary_file"
  if [[ -n "$release_commit" ]]; then
    printf '\nENGAZ_IMAGE_TAG=sha-%s\nENGAZ_COMPUTER_IMAGE_TAG=sha-%s\n' "$release_commit" "$release_commit" >> "$temporary_file"
    if [[ -n "$RELEASE_VERSION" ]]; then
      printf 'ENGAZ_RELEASE=%s\n' "$RELEASE_VERSION" >> "$temporary_file"
    fi
  fi
  printf '\nOWNER_SETUP_KEY=%s\nENGAZ_WEB_BIND=%s\nENGAZ_WEB_PORT=%s\nENGAZ_HOST=%s\nBETTER_AUTH_URL=http://%s:%s\nWEB_ORIGIN=http://%s:%s\nAPI_URL=http://%s:%s\nAUTH_TRUSTED_ORIGINS=http://%s:%s,http://localhost:%s,http://127.0.0.1:%s\n' \
    "$(openssl rand -hex 32)" "$web_bind" "$web_port" "$lan_ip" "$lan_ip" "$web_port" "$lan_ip" "$web_port" "$lan_ip" "$web_port" \
    "$lan_ip" "$web_port" "$web_port" "$web_port" >> "$temporary_file"
  if [[ -n "$data_dir" ]]; then
    printf '\nENGAZ_DATA_DIR=%s\nCOMPOSE_FILE=%s:%s\n' \
      "$data_dir" "$COMPOSE_FILE" "$DATA_DIR_COMPOSE_FILE" >> "$temporary_file"
  fi

  chmod 600 "$temporary_file"
  mv -- "$temporary_file" "$ENV_FILE"
  temporary_file=""
  say "🔐" "Created .env with random secrets."
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
      if (name == "ENGAZ_WEB_BIND") { bind = $0; sub(/^[^=]*=/, "", bind) }
      if (name == "OWNER_SETUP_KEY") { setup = $0; sub(/^[^=]*=/, "", setup); gsub(/[[:space:]]/, "", setup) }
      if (!(name in required)) next
      seen[name]++

      value = $0
      sub(/^[^=]*=/, "", value)
      gsub(/[[:space:]]/, "", value)
      if (value != "") nonempty[name]++
    }
    END {
      if (bind != "" && bind != "127.0.0.1" && bind != "localhost" && bind != "::1" && setup == "") exit 1
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
    fail "set every required secret in .env to a non-empty value; network access also requires OWNER_SETUP_KEY."
  fi
}

step "📦" "Preparing Engaz in $PWD"
download "$COMPOSE_FILE"
download "$ENV_EXAMPLE"
download engaz
chmod +x engaz
download "$DATA_DIR_COMPOSE_FILE"

if [[ -e "$ENV_FILE" ]]; then
  say "🔐" "Keeping existing .env."
else
  if [[ "$prepare_only" != true && -n "$(docker volume ls -q --filter name=^engaz_pgdata$ 2>/dev/null)" ]]; then
    fail "this Docker host already has an Engaz database (volume engaz_pgdata) from an earlier installation. Run this command from that installation's folder, which holds its .env secrets."
  fi
  create_env
fi

if [[ -n "$RELEASE_VERSION" ]]; then
  # Compose and the lifecycle CLI must pull the same images from this installation's .env.
  unset ENGAZ_IMAGE ENGAZ_IMAGE_TAG ENGAZ_COMPUTER_IMAGE ENGAZ_COMPUTER_IMAGE_TAG
fi
validate_required_secrets

install_command() {
  local bin_dir="${ENGAZ_BIN_DIR:-$HOME/.local/bin}"
  [[ "$bin_dir" == /* ]] || fail "ENGAZ_BIN_DIR must be an absolute path."
  mkdir -p -- "$bin_dir" || fail "could not create $bin_dir."
  if [[ -e "$bin_dir/engaz" || -L "$bin_dir/engaz" ]]; then
    [[ -L "$bin_dir/engaz" && "$(readlink "$bin_dir/engaz")" == "$PWD/engaz" ]] \
      || fail "$bin_dir/engaz already exists. Choose another ENGAZ_BIN_DIR or use $PWD/engaz directly."
  else
    ln -s "$PWD/engaz" "$bin_dir/engaz" || fail "could not install the engaz command."
  fi
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) add_to_shell_path "$bin_dir" || printf 'Add Engaz to your PATH: export PATH="%s:$PATH"\n' "$bin_dir" ;;
  esac
}

# A person at the keyboard gets the default command folder added to their shell.
add_to_shell_path() {
  local profile line='export PATH="$HOME/.local/bin:$PATH"'
  [[ "$interactive" == true && -z "${ENGAZ_BIN_DIR:-}" && "$1" == "$HOME/.local/bin" ]] || return 1
  case "${SHELL##*/}" in
    zsh) profile="$HOME/.zshrc" ;;
    bash) if [[ "$platform" == macos ]]; then profile="$HOME/.bash_profile"; else profile="$HOME/.bashrc"; fi ;;
    *) return 1 ;;
  esac
  if ! grep -qsF "$line" "$profile"; then
    printf '\n# Added by the Engaz installer\n%s\n' "$line" >> "$profile" || return 1
  fi
  say "🔧" "Added the engaz command to $profile. It works in new terminal windows."
}
install_command

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

# A first pull needs room for the images; an update already has most of them.
readonly MIN_IMAGE_FREE_GB=8
check_image_space() {
  local root available_kb
  [[ "$pull_never" != true ]] || return 0
  [[ -z "$(docker image ls -q 'ghcr.io/shadynafie/engaz/app' 2>/dev/null)" ]] || return 0
  root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null) || return 0
  # Docker Desktop keeps its storage inside its own VM, which it sizes itself.
  [[ -n "$root" && -d "$root" ]] || return 0
  available_kb=$(df -Pk "$root" 2>/dev/null | awk 'NR == 2 { print $4 }')
  [[ "$available_kb" =~ ^[0-9]+$ ]] || return 0
  if ((available_kb < MIN_IMAGE_FREE_GB * 1024 * 1024)); then
    fail "Docker's storage ($root) has $((available_kb / 1024 / 1024)) GB free; Engaz needs at least ${MIN_IMAGE_FREE_GB} GB for its images and first data. Free some space, then run this command again."
  fi
}

# Limits are not reservations, but a small Docker Desktop VM stops agents mid-task.
check_docker_memory() {
  local bytes
  bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null) || return 0
  [[ "$bytes" =~ ^[0-9]+$ ]] || return 0
  if ((bytes < 3500 * 1024 * 1024)); then
    say "⚠️ " "Docker has less than 4 GB of memory, so agents may run slowly or stop. In Docker Desktop, raise it under Settings > Resources."
  fi
}

check_ports
check_image_space
check_docker_memory
prepare_proxy_env
if [[ "$pull_never" == true ]]; then
  echo "Skipping image pull (--pull-never / --offline); images must already be on this Docker host."
else
  step "⬇️ " "Downloading Engaz. The first download takes a few minutes."
  if ! docker compose "${compose_args[@]}" pull; then
    fail "could not pull images. Shell HTTP_PROXY often does not reach the Docker daemon. Configure daemon proxy/registry-mirrors, set image env vars to a reachable registry, or preload images then compose up with --pull never."
  fi
fi
url="http://127.0.0.1:$(env_value ENGAZ_WEB_PORT 7791)"

# Healthy containers are not enough: the port must answer from the host, as the browser sees it.
url_answers() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    curl -fsS --noproxy '*' --max-time 5 -o /dev/null "$url/" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

open_browser() {
  [[ "$interactive" == true && "${ENGAZ_NO_BROWSER:-}" != 1 ]] || return 0
  case "$platform" in
    macos) open "$1" ;;
    wsl) cmd.exe /c start "" "$1" ;;
    linux) [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && xdg-open "$1" ;;
  esac >/dev/null 2>&1 || true
}

step "🚀" "Starting Engaz. This can take a couple of minutes."
python3 "$PWD/engaz" --dir "$PWD" start
canonical_url=$(env_value WEB_ORIGIN "$url")
local_url="http://localhost:$(env_value ENGAZ_WEB_PORT 7791)"
ready=false
url_answers && ready=true
python3 "$PWD/engaz" --dir "$PWD" status

# The link comes last so it is what the reader sees.
echo
if [[ "$ready" == true ]]; then
  say "🎉" "Engaz is ready. Open $canonical_url in your browser to set it up."
else
  say "⏳" "Engaz is starting. In a minute, open $canonical_url in your browser to set it up."
fi
setup_key=$(env_value OWNER_SETUP_KEY "")
setup_url="$canonical_url"
if [[ -n "$setup_key" ]]; then
  setup_url="$canonical_url/sign-up#setup=$setup_key"
  echo
  say "👉" "Create your account: $setup_url"
  say "🔑" "Keep this link private. It makes whoever opens it first the owner."
  say "💻" "On this computer: $local_url"
  if [[ "$canonical_url" != "$url" ]]; then
    say "📱" "On your other devices on this network: $canonical_url"
  fi
fi
echo
say "📂" "Engaz files are in $PWD. Use engaz update to update."
if [[ -n "$data_dir" ]]; then
  say "💾" "Data and secrets are in $data_dir. Use engaz backup to back up data and secrets."
fi
say "🛠️ " "Manage Engaz with: engaz status, engaz stop, engaz start, engaz backup"
if [[ "$(docker info --format '{{.OperatingSystem}}' 2>/dev/null)" == "Docker Desktop" ]]; then
  say "💡" "Keep Docker Desktop's \"Start when you sign in\" setting on so Engaz comes back after a restart."
fi
open_browser "$setup_url"
