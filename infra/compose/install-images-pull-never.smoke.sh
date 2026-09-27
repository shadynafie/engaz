#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
src="$root/install-images.sh"
fail() { echo "FAIL: $*" >&2; exit 1; }
# BSD grep needs -e so patterns starting with -- are not flags.
g() { grep -F -e "$1" "$src" >/dev/null || fail "missing $1"; }
g '--pull-never)'
g '--offline)'
g 'ENGAZ_PULL_NEVER'
g 'Skipping image pull'
g 'HTTP_PROXY/HTTPS_PROXY'
g '[--prepare-only] [--local] [--pull-never] [--offline]'
set +e
out="$(bash "$src" --not-a-flag 2>&1)"
code=$?
set -e
[[ "$code" -eq 2 ]] || fail "expected exit 2 for unknown flag, got $code"
[[ "$out" == *"Usage: bash install-images.sh"* ]] || fail "usage missing from stderr"
bash -n "$src" || fail "bash -n failed"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/install-images-smoke.XXXXXX")"
cleanup_tmp() { rm -rf "$tmp"; }
trap cleanup_tmp EXIT

write_stubs() {
  local bin="$1"
  mkdir -p "$bin"
  cat > "$bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
log="${STUB_DOCKER_LOG:?}"
{
  printf 'docker'
  for a in "$@"; do
    printf ' %s' "$a"
  done
  [[ -z "${ENGAZ_IMAGE_TAG+x}${ENGAZ_COMPUTER_IMAGE_TAG+x}" ]] || printf ' IMAGE_OVERRIDE_PRESENT'
  printf '\n'
} >> "$log"

case "${1:-}" in
  compose) shift ;;
  info)
    # A desktop Docker app that has not started yet answers once the stub marks it running.
    [[ -z "${STUB_DOCKER_RUNNING_FLAG-}" || -e "$STUB_DOCKER_RUNNING_FLAG" ]] || exit 1
    if [[ " $* " == *" --format "* ]]; then
      printf '%s\n' "${STUB_DOCKER_ROOT-}"
    fi
    exit 0
    ;;
  image) printf '%s\n' "${STUB_DOCKER_IMAGES-}"; exit 0 ;;
  ps)
    # Folder lookups ask for the Compose working directory; other lookups ask whether a
    # stack is running, which is nonempty by default so the host port check is skipped.
    if [[ " $* " == *" --format "* ]]; then
      printf '%s\n' "${STUB_DOCKER_PROJECT_DIR-}"
    else
      printf '%s\n' "${STUB_DOCKER_PS-running}"
    fi
    exit 0
    ;;
  volume)
    if [[ "${2:-}" == inspect ]]; then
      [[ "${STUB_EXISTING_VOLUME-}" == "${3:-}" ]]
      exit $?
    fi
    printf '%s\n' "${STUB_EXISTING_VOLUME-${STUB_DOCKER_VOLUMES-}}"; exit 0 ;;
  *) echo "STUB: unexpected docker $*" >&2; exit 1 ;;
esac

help=false
short=false
verb=""
for a in "$@"; do
  case "$a" in
    --help|-h) help=true ;;
    --short) short=true ;;
    version|up|pull|config)
      if [[ -z "$verb" ]]; then
        verb="$a"
      fi
      ;;
  esac
done

if [[ "${STUB_CONSUME_STDIN:-}" == 1 && ( "$verb" == version || "$verb" == pull ) ]]; then
  cat >/dev/null
fi
echo "VERB=${verb:-none}" >> "$log"

if [[ "$verb" == config ]]; then
  cat >/dev/null || true
fi

if [[ "$help" == true ]]; then
  if [[ "$verb" == config ]]; then
    printf '%s\n' "${STUB_COMPOSE_CONFIG_HELP:---environment --format string}"
    exit 0
  fi
  printf '%s\n' "${STUB_COMPOSE_UP_HELP:-Usage: docker compose up

Options:
  --pull string     Pull image before running
  --wait
  --wait-timeout int
}"
  exit 0
fi

case "$verb" in
  version)
    if [[ "$short" == true ]]; then
      printf '%s\n' "${STUB_COMPOSE_SHORT:-2.24.0}"
    else
      echo "Docker Compose version v${STUB_COMPOSE_SHORT:-2.24.0}"
    fi
    ;;
  config)
    if [[ " $* " == *" --format json "* ]]; then
      if [[ "${STUB_COMPOSE_JSON_IS_YAML-}" == 1 ]]; then
        printf 'services:\n  probe:\n    image: busybox:1\n'
        exit 0
      fi
      if [[ "${STUB_EXPECT_ENV_CLEAN-}" == 1 && " $* " != *" --project-name engaz-preflight "* ]]; then
        [[ -z "${ENGAZ_DATA_DIR+x}" && -z "${COMPOSE_PROJECT_NAME+x}" && -z "${POSTGRES_PASSWORD+x}" ]] \
          || { echo 'STUB: ambient Compose override survived' >&2; exit 1; }
      fi
      if [[ -n "${STUB_COMPOSE_JSON-}" ]]; then
        printf '%s\n' "$STUB_COMPOSE_JSON"
      else
        cat <<'JSON'
{"services":{"api":{"volumes":[{"type":"volume","source":"appdata","target":"/data"}]},"postgres":{"volumes":[{"type":"volume","source":"pgdata","target":"/var/lib/postgresql/data"}]}},"volumes":{"appdata":{"name":"engaz_appdata"},"pgdata":{"name":"engaz_pgdata"}}}
JSON
      fi
      exit 0
    fi
    cat <<'EOF'
POSTGRES_PASSWORD=test-postgres
BETTER_AUTH_SECRET=test-auth-secret
ENCRYPTION_KEY=test-encryption-key
SCREEN_PROXY_SECRET=test-screen-secret
SANDBOX_SUPERVISOR_TOKEN=test-supervisor-token
EOF
    previous=""
    for argument in "$@"; do
      if [[ "$previous" == --env-file && -f "$argument" ]]; then
        sed -n '/^ENGAZ_WEB_BIND=/p; /^OWNER_SETUP_KEY=/p' "$argument"
      fi
      previous="$argument"
    done
    ;;
  pull|up)
    ;;
  *)
    echo "STUB: unexpected compose verb ${verb:-none} $*" >&2
    exit 1
    ;;
esac
STUB
  cat > "$bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
log="${STUB_CURL_LOG:?}"
{
  printf 'curl'
  for a in "$@"; do
    printf ' %s' "$a"
  done
  printf '\n'
} >> "$log"
if [[ " $* " == *" --help "* ]]; then
  echo "--retry-all-errors"
  exit 0
fi
out=""
prev=""
for a in "$@"; do
  if [[ "$prev" == "-o" ]]; then
    out="$a"
  fi
  prev="$a"
done
if [[ -n "$out" ]]; then
  if [[ "$*" == *"/engaz "* ]]; then
    cp "${STUB_ENGAZ_SOURCE:?}" "$out"
  else
    printf 'stub-download\n' > "$out"
  fi
  exit 0
fi
exit 1
STUB
  cat > "$bin/df" <<'STUB'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'stub 99999999 1 %s 1%% /\n' "${STUB_DF_AVAILABLE_KB:-52428800}"
STUB
  chmod +x "$bin/docker" "$bin/curl" "$bin/df"
}

setup_work() {
  local work="$1"
  mkdir -p "$work/cwd"
  write_stubs "$work/bin"
  cat > "$work/engaz-stub" <<'STUB'
#!/usr/bin/env python3
import os, pathlib, subprocess, sys
if os.environ.get("STUB_CONSUME_STDIN") == "1":
    print("ENGAZ_STDIN_BYTES=" + str(len(sys.stdin.read())))
root = pathlib.Path(sys.argv[sys.argv.index("--dir") + 1])
command = sys.argv[-1]
if command == "start":
    args = ["docker", "compose", "--env-file", str(root / ".env"), "-f", str(root / "docker-compose.images.yml")]
    if "ENGAZ_DATA_DIR=" in (root / ".env").read_text():
        args += ["-f", str(root / "docker-compose.data-dir.yml")]
    subprocess.run([*args, "up", "-d", "--pull", "never", "--wait", "--wait-timeout", "300"], check=True)
(root / ".engaz-install.json").write_text('{"test": true}\n')
print("ENGAZ_COMMAND=" + command)
print("ENGAZ_ARGS=" + " ".join(sys.argv[1:]))
STUB
  cp "$work/engaz-stub" "$work/cwd/engaz"
  : > "$work/cwd/docker-compose.images.yml"
  : > "$work/cwd/docker-compose.data-dir.yml"
  : > "$work/cwd/.env.images.example"
  cat > "$work/cwd/.env" <<'EOF'
POSTGRES_PASSWORD=test-postgres
BETTER_AUTH_SECRET=test-auth-secret
ENCRYPTION_KEY=test-encryption-key
SCREEN_PROXY_SECRET=test-screen-secret
SANDBOX_SUPERVISOR_TOKEN=test-supervisor-token
EOF
  : > "$work/docker.log"
  : > "$work/curl.log"
}

run_install() {
  local work="$1"
  shift
  (
    export STUB_DOCKER_LOG="$work/docker.log"
    export STUB_CURL_LOG="$work/curl.log" STUB_ENGAZ_SOURCE="$work/engaz-stub"
    export ENGAZ_BIN_DIR="$work/commands"
    export PATH="$work/bin:$PATH"
    export ENGAZ_NONINTERACTIVE="${ENGAZ_NONINTERACTIVE-1}" ENGAZ_NO_BROWSER=1
    export ENGAZ_LAN_IP="${ENGAZ_LAN_IP-192.168.50.2}"
    cd "$work/cwd"
    bash "$src" "$@"
  )
}

has_compose_pull() {
  grep -q 'VERB=pull' "$1/docker.log"
}

has_up_pull_never() {
  grep -F -e 'VERB=up' "$1/docker.log" >/dev/null \
    && grep -F -e ' --pull never' "$1/docker.log" >/dev/null
}

# Flags accepted: --offline takes the local/pull-never path (no curl, no compose pull).
setup_work "$tmp/offline"
set +e
offline_out="$(run_install "$tmp/offline" --offline 2>&1)"
offline_code=$?
set -e
[[ "$offline_code" -eq 0 ]] || fail "--offline exited $offline_code: $offline_out"
[[ "$offline_out" != *"Usage: bash install-images.sh"* ]] || fail "--offline was rejected as unknown"
[[ "$offline_out" == *"Using local docker-compose.images.yml"* ]] || fail "--offline did not keep local compose file"
[[ "$offline_out" == *"Using local .env.images.example"* ]] || fail "--offline did not keep local env example"
[[ "$offline_out" == *"Skipping image pull"* ]] || fail "--offline did not skip image pull"
[[ "$offline_out" == *"Open http://127.0.0.1:7791 in your browser to set it up."* ]] || fail "--offline did not start"
# Only the local readiness probe may use curl; nothing is downloaded.
if grep -v -F -e 'http://127.0.0.1:' "$tmp/offline/curl.log" | grep -q .; then
  fail "--offline should not download when files are local: $(cat "$tmp/offline/curl.log")"
fi
has_compose_pull "$tmp/offline" && fail "--offline should not run compose pull"
has_up_pull_never "$tmp/offline" || fail "--offline should pass --pull never to compose up: $(cat "$tmp/offline/docker.log")"
[[ -x "$tmp/offline/cwd/engaz" ]] || fail "installer must make engaz executable"
[[ "$(readlink "$tmp/offline/commands/engaz")" == "$(cd "$tmp/offline/cwd" && pwd)/engaz" ]] \
  || fail "installer must link the installed command"
[[ "$offline_out" == *'Add Engaz to your PATH:'* ]] || fail "installer must explain PATH setup"
set +e
prepare_out="$(run_install "$tmp/offline" --prepare-only --offline 2>&1)"
prepare_code=$?
set -e
[[ "$prepare_code" -ne 0 && "$prepare_out" == *'already enrolled'* ]] \
  || fail "prepare-only must not rewrite an enrolled installation"

# Command placement is explicit and must not replace another program.
setup_work "$tmp/command-conflict"
mkdir -p "$tmp/command-conflict/commands"
printf 'foreign-command\n' > "$tmp/command-conflict/commands/engaz"
set +e
conflict_out="$(run_install "$tmp/command-conflict" --offline 2>&1)"
conflict_code=$?
set -e
[[ "$conflict_code" -ne 0 && "$conflict_out" == *'already exists'* ]] || fail "existing command must be refused"
[[ "$(cat "$tmp/command-conflict/commands/engaz")" == foreign-command ]] || fail "installer replaced another command"

setup_work "$tmp/python-version"
printf '#!/usr/bin/env bash\nexit 1\n' > "$tmp/python-version/bin/python3"
chmod +x "$tmp/python-version/bin/python3"
set +e
python_out="$(run_install "$tmp/python-version" --offline 2>&1)"
python_code=$?
set -e
[[ "$python_code" -ne 0 && "$python_out" == *'Python 3.9 or newer is required'* ]] \
  || fail "unsupported Python needs an actionable error"

# Reject vendor Compose builds before downloads or secrets are created.
for capability in missing-environment fake-json; do
  setup_work "$tmp/$capability"
  rm "$tmp/$capability/cwd/.env"
  if [[ "$capability" == missing-environment ]]; then
    export STUB_COMPOSE_CONFIG_HELP='--format string'
  else
    export STUB_COMPOSE_JSON_IS_YAML=1
  fi
  set +e
  capability_out="$(run_install "$tmp/$capability" --offline 2>&1)"
  capability_code=$?
  set -e
  unset STUB_COMPOSE_CONFIG_HELP STUB_COMPOSE_JSON_IS_YAML
  [[ "$capability_code" -ne 0 && "$capability_out" == *'Upgrade the Docker Compose plugin'* ]] \
    || fail "unsupported Compose needs a capability error"
  [[ ! -e "$tmp/$capability/cwd/.env" && ! -s "$tmp/$capability/curl.log" ]] \
    || fail "Compose capability failure must precede files and downloads"
done

setup_work "$tmp/public-without-key"
printf 'ENGAZ_WEB_BIND=0.0.0.0\n' >> "$tmp/public-without-key/cwd/.env"
set +e
key_out="$(run_install "$tmp/public-without-key" --offline 2>&1)"
key_code=$?
set -e
[[ "$key_code" -ne 0 && "$key_out" == *'network access also requires OWNER_SETUP_KEY'* ]] \
  || fail "network startup must require an owner key"
grep -q 'VERB=up' "$tmp/public-without-key/docker.log" && fail "blank owner key must prevent startup"

setup_work "$tmp/invalid-network-ip"
rm "$tmp/invalid-network-ip/cwd/.env"
set +e
ip_out="$(ENGAZ_LAN_IP=203.0.113.2 run_install "$tmp/invalid-network-ip" --offline 2>&1)"
ip_code=$?
set -e
[[ "$ip_code" -ne 0 && "$ip_out" == *'ENGAZ_LAN_IP must be'* && ! -e "$tmp/invalid-network-ip/cwd/.env" ]] \
  || fail "explicit network IP must be private and validated before secrets"

setup_work "$tmp/custom-web-port"
rm "$tmp/custom-web-port/cwd/.env"
custom_out="$(ENGAZ_WEB_PORT=8787 run_install "$tmp/custom-web-port" --prepare-only --offline 2>&1)" \
  || fail "custom web port preparation failed"
grep -qxF 'WEB_ORIGIN=http://192.168.50.2:8787' "$tmp/custom-web-port/cwd/.env" \
  || fail "canonical origins must use the configured web port"

# --pull-never is accepted and skips pull (may still download Compose files).
setup_work "$tmp/pull-never"
set +e
pull_never_out="$(run_install "$tmp/pull-never" --pull-never 2>&1)"
pull_never_code=$?
set -e
[[ "$pull_never_code" -eq 0 ]] || fail "--pull-never exited $pull_never_code: $pull_never_out"
[[ "$pull_never_out" != *"Usage: bash install-images.sh"* ]] || fail "--pull-never was rejected as unknown"
[[ "$pull_never_out" == *"Skipping image pull"* ]] || fail "--pull-never did not skip image pull"
has_compose_pull "$tmp/pull-never" && fail "--pull-never should not run compose pull"
has_up_pull_never "$tmp/pull-never" || fail "--pull-never should pass --pull never to compose up"

# Default install uses the shared lifecycle startup after pulling.
setup_work "$tmp/default"
set +e
default_out="$(run_install "$tmp/default" 2>&1)"
default_code=$?
set -e
[[ "$default_code" -eq 0 ]] || fail "default install exited $default_code: $default_out"
[[ "$default_out" != *"unbound variable"* ]] || fail "empty array expansion aborted: $default_out"
has_compose_pull "$tmp/default" || fail "default install should run compose pull"
grep -q 'VERB=up' "$tmp/default/docker.log" || fail "default install should run compose up"

# A released installer uses its exact source image tags when creating secrets.
setup_work "$tmp/stable"
rm "$tmp/stable/cwd/.env"
cp "$root/.env.images.example" "$tmp/stable/cwd/.env.images.example"
stable_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
stable_out="$(ENGAZ_DOWNLOAD_BASE="https://raw.githubusercontent.com/shadynafie/engaz/$stable_commit/infra/compose" run_install "$tmp/stable" --local --prepare-only 2>&1)" \
  || fail "stable preparation failed: $stable_out"
grep -Fx "ENGAZ_IMAGE_TAG=sha-$stable_commit" "$tmp/stable/cwd/.env" >/dev/null || fail "app is not release-source pinned"
grep -Fx "ENGAZ_COMPUTER_IMAGE_TAG=sha-$stable_commit" "$tmp/stable/cwd/.env" >/dev/null || fail "computer is not release-source pinned"
! grep -q '=edge$' "$tmp/stable/cwd/.env" || fail "released setup retained a moving edge tag"

# The generated asset freezes an existing installation's update even with an older CLI.
setup_work "$tmp/released-update"
printf '{}\n' > "$tmp/released-update/cwd/.engaz-install.json"
python3 - "$root" "$tmp/released-installer.sh" <<'PY'
import importlib.util
from pathlib import Path
import sys
root = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("release_assets", root / "release-assets.py")
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)
Path(sys.argv[2]).write_text(assets.render("install-images.sh", (root / "install-images.sh").read_text(), "v0.1.9", "a" * 40))
PY
source_installer="$src"
src="$tmp/released-installer.sh"
released_out="$(run_install "$tmp/released-update" 2>&1)" || fail "released handoff failed: $released_out"
[[ "$released_out" == *" update v0.1.9"* ]] || fail "released handoff did not freeze its version"

# Ambient development image variables cannot change a released installation's pull.
setup_work "$tmp/released-fresh"
rm "$tmp/released-fresh/cwd/.env"
cp "$root/.env.images.example" "$tmp/released-fresh/cwd/.env.images.example"
released_out="$(ENGAZ_IMAGE_TAG=edge ENGAZ_COMPUTER_IMAGE_TAG=edge run_install "$tmp/released-fresh" --local 2>&1)" \
  || fail "released fresh preparation failed: $released_out"
grep -Fx "ENGAZ_RELEASE=v0.1.9" "$tmp/released-fresh/cwd/.env" >/dev/null || fail "released setup did not record its version"
grep -Fx "ENGAZ_IMAGE_TAG=sha-$stable_commit" "$tmp/released-fresh/cwd/.env" >/dev/null || fail "released image source changed"
grep ' pull' "$tmp/released-fresh/docker.log" | grep -qv IMAGE_OVERRIDE_PRESENT || fail "released pull used ambient image overrides"
src="$source_installer"

# --data-dir keeps .env, Postgres, and app data together in a new host folder.
data_install() {
  local work="$1"
  shift
  set +e
  data_out="$(run_install "$work" "$@" 2>&1)"
  data_code=$?
  set -e
}
expect_data_failure() {
  local message="$1"
  [[ "$data_code" -ne 0 ]] || fail "expected failure containing '$message': $data_out"
  [[ "$data_out" == *"$message"* ]] || fail "expected '$message', got: $data_out"
}

setup_work "$tmp/data"
mkdir -p "$tmp/data/store"
cp "$tmp/data/engaz-stub" "$tmp/data/store/engaz"
data_install "$tmp/data" "--data-dir=$tmp/data/store/"
[[ "$data_code" -eq 0 ]] || fail "--data-dir exited $data_code: $data_out"
store="$(cd "$tmp/data/store" && pwd -P)"
[[ -d "$store/postgres" && -d "$store/appdata" ]] || fail "--data-dir did not create data folders"
grep -qxF "ENGAZ_DATA_DIR=$store" "$store/.env" || fail "--data-dir did not record ENGAZ_DATA_DIR: $(cat "$store/.env")"
grep -qxF 'ENGAZ_WEB_BIND=0.0.0.0' "$store/.env" || fail "new installation must enable network web access"
grep -qxF 'WEB_ORIGIN=http://192.168.50.2:7791' "$store/.env" || fail "network address must be the canonical origin"
grep -qxF 'AUTH_TRUSTED_ORIGINS=http://192.168.50.2:7791,http://localhost:7791,http://127.0.0.1:7791' "$store/.env" \
  || fail "trusted origins must be exact local addresses"
grep -Eq '^OWNER_SETUP_KEY=[0-9a-f]{64}$' "$store/.env" || fail "new installation needs a random owner key"
[[ "$data_out" == *'http://192.168.50.2:7791/sign-up#setup='* ]] || fail "installer must print the owner signup link"
[[ "$(grep -c '^OWNER_SETUP_KEY=' "$store/.env")" == 1 ]] || fail "owner setup key needs one assignment"
grep -qxF "COMPOSE_FILE=docker-compose.images.yml:docker-compose.data-dir.yml" "$store/.env" \
  || fail "--data-dir did not record COMPOSE_FILE"
[[ "$(ls -ld "$store/.env" | cut -c1-10)" == "-rw-------" ]] || fail ".env should be private"
grep -F -e 'up -d' "$tmp/data/docker.log" | grep -F -e 'docker-compose.data-dir.yml' >/dev/null \
  || fail "--data-dir should start with the data-dir Compose file: $(cat "$tmp/data/docker.log")"
[[ "$data_out" == *"Data and secrets are in $store"* ]] || fail "--data-dir should name the folder to back up"

original_setup_key=$(sed -n 's/^OWNER_SETUP_KEY=//p' "$store/.env")
data_install "$tmp/data" "--data-dir=$store"
[[ "$data_code" -eq 0 ]] || fail "--data-dir rerun exited $data_code: $data_out"
[[ "$data_out" == *"ENGAZ_COMMAND=update"* ]] || fail "--data-dir rerun should use engaz update"
[[ "$(sed -n 's/^OWNER_SETUP_KEY=//p' "$store/.env")" == "$original_setup_key" ]] || fail "rerun must preserve the owner key"

# Rerunning from inside the folder without the flag must not fall back to named volumes.
: > "$tmp/data/docker.log"
set +e
data_out="$(
  export STUB_DOCKER_LOG="$tmp/data/docker.log" STUB_CURL_LOG="$tmp/data/curl.log"
  export PATH="$tmp/data/bin:$PATH" ENGAZ_BIN_DIR="$tmp/data/commands" STUB_ENGAZ_SOURCE="$tmp/data/engaz-stub"
  export ENGAZ_NONINTERACTIVE=1
  cd "$store" && bash "$src" 2>&1
)"
data_code=$?
set -e
[[ "$data_code" -eq 0 ]] || fail "rerun inside the data folder exited $data_code: $data_out"
[[ "$data_out" == *"Keeping Engaz data in $store"* ]] || fail "rerun inside the folder lost the data dir: $data_out"
[[ "$data_out" == *"ENGAZ_COMMAND=update"* ]] || fail "rerun inside the folder should use engaz update"
grep -q 'VERB=up' "$tmp/data/docker.log" && fail "rerun must not directly start Compose"
[[ "$(cat "$store/docker-compose.images.yml")" == stub-download ]] || fail "update handoff changed Compose files"

setup_work "$tmp/relative"
data_install "$tmp/relative" --data-dir=engaz-data
expect_data_failure "--data-dir must be an absolute path."

setup_work "$tmp/dotenv-path"
for bad_path in "$tmp/store-\$HOME" "$tmp/store-#comment" "$tmp/store-trailing "; do
  data_install "$tmp/dotenv-path" "--data-dir=$bad_path"
  expect_data_failure "dotenv interpolation characters or trailing whitespace"
  [[ ! -e "$bad_path/.env" ]] || fail "unsafe data path received secrets"
done

# Removed containers do not make retained named or bind storage a fresh install.
setup_work "$tmp/retained-volume"
rm "$tmp/retained-volume/cwd/engaz"
export STUB_EXISTING_VOLUME=custom_pgdata
export STUB_COMPOSE_JSON='{"services":{"api":{"volumes":[{"type":"volume","source":"appdata","target":"/data"}]},"postgres":{"volumes":[{"type":"volume","source":"pgdata","target":"/var/lib/postgresql/data"}]}},"volumes":{"appdata":{"name":"custom_appdata"},"pgdata":{"name":"custom_pgdata"}}}'
export STUB_EXPECT_ENV_CLEAN=1 ENGAZ_DATA_DIR=/wrong/path COMPOSE_PROJECT_NAME=wrong POSTGRES_PASSWORD=ambient
data_install "$tmp/retained-volume" --offline
expect_data_failure "existing installation without the engaz command"
[[ ! -s "$tmp/retained-volume/curl.log" ]] || fail "retained volume refusal must precede downloads"
unset STUB_EXISTING_VOLUME STUB_COMPOSE_JSON STUB_EXPECT_ENV_CLEAN ENGAZ_DATA_DIR COMPOSE_PROJECT_NAME POSTGRES_PASSWORD

setup_work "$tmp/retained-bind"
rm "$tmp/retained-bind/cwd/engaz"
mkdir -p "$tmp/retained-bind/home" "$tmp/retained-bind/database"
printf 'agent-file\n' > "$tmp/retained-bind/home/retained"
export STUB_COMPOSE_JSON="$(python3 -c 'import json,sys; print(json.dumps({"services":{"api":{"volumes":[{"type":"bind","source":sys.argv[1],"target":"/data"}]},"postgres":{"volumes":[{"type":"bind","source":sys.argv[2],"target":"/var/lib/postgresql/data"}]}}}))' "$tmp/retained-bind/home" "$tmp/retained-bind/database")"
data_install "$tmp/retained-bind" --prepare-only --offline
expect_data_failure "has existing data or containers"
[[ ! -s "$tmp/retained-bind/curl.log" ]] || fail "retained bind refusal must precede downloads"
unset STUB_COMPOSE_JSON

setup_work "$tmp/foreign"
mkdir -p "$tmp/foreign/store" && : > "$tmp/foreign/store/notes.txt"
data_install "$tmp/foreign" "--data-dir=$tmp/foreign/store"
expect_data_failure "is not empty"

setup_work "$tmp/foreign-env"
mkdir -p "$tmp/foreign-env/store" && printf 'OTHER=1\n' > "$tmp/foreign-env/store/.env"
data_install "$tmp/foreign-env" "--data-dir=$tmp/foreign-env/store"
expect_data_failure "does not belong to an Engaz installation"

setup_work "$tmp/volumes"
export STUB_DOCKER_VOLUMES=engaz_pgdata
data_install "$tmp/volumes" "--data-dir=$tmp/volumes/store"
unset STUB_DOCKER_VOLUMES
expect_data_failure "already has an Engaz database (volume engaz_pgdata)"
[[ ! -e "$tmp/volumes/store/.env" ]] || fail "volume refusal should not write .env"

setup_work "$tmp/old-data"
export STUB_COMPOSE_SHORT='2.23.3'
data_install "$tmp/old-data" "--data-dir=$tmp/old-data/store"
unset STUB_COMPOSE_SHORT
expect_data_failure "needs Docker Compose 2.24 or newer"

setup_work "$tmp/small"
export STUB_DF_AVAILABLE_KB=1048576
data_install "$tmp/small" "--data-dir=$tmp/small/store"
unset STUB_DF_AVAILABLE_KB
expect_data_failure "Engaz needs at least 10 GB"

# A fresh install refuses a web port that another program already holds.
if command -v python3 >/dev/null 2>&1; then
  setup_work "$tmp/port"
  port_file="$tmp/port/port"
  python3 -c '
import socket, sys, time
s = socket.socket()
s.bind(("127.0.0.1", 0))
s.listen(1)
open(sys.argv[1], "w").write(str(s.getsockname()[1]))
time.sleep(30)
' "$port_file" &
  listener=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ -s "$port_file" ]] && break
    sleep 0.2
  done
  printf 'ENGAZ_WEB_PORT=%s\n' "$(cat "$port_file")" >> "$tmp/port/cwd/.env"
  export STUB_DOCKER_PS=""
  data_install "$tmp/port" --offline
  unset STUB_DOCKER_PS
  kill "$listener" 2>/dev/null || true
  wait "$listener" 2>/dev/null || true
  expect_data_failure "port $(cat "$port_file") on 127.0.0.1 is already in use"
fi

# Interactive questions: Enter keeps Docker storage; a ~/ path becomes a data folder.
setup_work "$tmp/ask-enter"
rm "$tmp/ask-enter/cwd/.env"
printf '\n' > "$tmp/ask-enter/answers"
set +e
ask_out="$(ENGAZ_NONINTERACTIVE=0 ENGAZ_TTY="$tmp/ask-enter/answers" run_install "$tmp/ask-enter" 2>&1)"
ask_code=$?
set -e
[[ "$ask_code" -eq 0 ]] || fail "Enter at the data question exited $ask_code: $ask_out"
[[ "$ask_out" == *"Where should Engaz keep its data?"* ]] || fail "data question was not asked: $ask_out"
[[ -f "$tmp/ask-enter/cwd/.env" ]] || fail "Enter should install in the current folder"
grep -q '^ENGAZ_DATA_DIR=' "$tmp/ask-enter/cwd/.env" && fail "Enter should keep Docker storage"

setup_work "$tmp/ask-path"
rm "$tmp/ask-path/cwd/.env"
mkdir -p "$tmp/ask-path/home"
printf '~/engaz-data\n' > "$tmp/ask-path/answers"
set +e
ask_out="$(HOME="$tmp/ask-path/home" ENGAZ_NONINTERACTIVE=0 ENGAZ_TTY="$tmp/ask-path/answers" \
  run_install "$tmp/ask-path" 2>&1)"
ask_code=$?
set -e
[[ "$ask_code" -eq 0 ]] || fail "a typed data folder exited $ask_code: $ask_out"
ask_store="$(cd "$tmp/ask-path/home/engaz-data" && pwd -P)"
grep -qxF "ENGAZ_DATA_DIR=$ask_store" "$ask_store/.env" || fail "typed ~/ folder was not used: $ask_out"

# Rerunning from anywhere updates the installation Compose already knows about.
setup_work "$tmp/update"
mkdir -p "$tmp/update/installed"
cp "$tmp/update/cwd/.env" "$tmp/update/installed/.env"
cp "$tmp/update/engaz-stub" "$tmp/update/installed/engaz"
rm "$tmp/update/cwd/.env"
export STUB_DOCKER_PROJECT_DIR="$tmp/update/installed"
data_install "$tmp/update"
[[ "$data_code" -eq 0 ]] || fail "update from another folder exited $data_code: $data_out"
[[ "$data_out" == *"Updating the Engaz installation in $tmp/update/installed"* ]] || fail "update did not find the installation: $data_out"
[[ ! -e "$tmp/update/cwd/.env" ]] || fail "update must not create a second .env"
[[ "$data_out" == *"ENGAZ_COMMAND=update"* ]] || fail "existing installation must use engaz update"
[[ ! -e "$tmp/update/installed/docker-compose.images.yml" ]] || fail "handoff must not download Compose"
rm "$tmp/update/installed/engaz"
data_install "$tmp/update"
expect_data_failure "existing installation without the engaz command"
[[ ! -e "$tmp/update/installed/docker-compose.images.yml" ]] || fail "legacy refusal must preserve Compose"
data_install "$tmp/update" --prepare-only
expect_data_failure "has existing data or containers"
[[ ! -e "$tmp/update/installed/docker-compose.images.yml" ]] || fail "legacy prepare refusal must preserve Compose"
data_install "$tmp/update" "--data-dir=$tmp/update/other"
expect_data_failure "Engaz is already installed in $tmp/update/installed"
rm "$tmp/update/installed/.env"
data_install "$tmp/update"
expect_data_failure "but its .env is missing"
unset STUB_DOCKER_PROJECT_DIR

# `curl ... | bash` has no script folder, so a new installation goes to ~/engaz.
setup_work "$tmp/piped"
rm "$tmp/piped/cwd/.env"
mkdir -p "$tmp/piped/home"
set +e
piped_out="$(
  export STUB_DOCKER_LOG="$tmp/piped/docker.log" STUB_CURL_LOG="$tmp/piped/curl.log"
  export PATH="$tmp/piped/bin:$PATH" HOME="$tmp/piped/home" ENGAZ_NONINTERACTIVE=1
  export ENGAZ_BIN_DIR="$tmp/piped/commands" STUB_ENGAZ_SOURCE="$tmp/piped/engaz-stub" STUB_CONSUME_STDIN=1
  cd "$tmp/piped/cwd" && cat "$src" | bash 2>&1
)"
piped_code=$?
set -e
[[ "$piped_code" -eq 0 ]] || fail "piped install exited $piped_code: $piped_out"
[[ "$piped_out" == *"Docker is installed and running."* ]] || fail "Docker check did not report success: $piped_out"
[[ "$(printf '%s\n' "$piped_out" | grep -c '^ENGAZ_STDIN_BYTES=0$')" == 2 ]] || fail "lifecycle commands inherited installer input: $piped_out"
[[ "$piped_out" == *"Engaz is ready."* ]] || fail "piped install lost its ready message: $piped_out"
[[ "$piped_out" == *"/sign-up#setup="* && "$piped_out" == *"Create your account:"* ]] || fail "piped install lost its owner setup link: $piped_out"

[[ -f "$tmp/piped/home/engaz/.env" ]] || fail "piped install should use ~/engaz: $piped_out"
[[ ! -e "$tmp/piped/cwd/.env" ]] || fail "piped install should not write into the current folder"
[[ "$piped_out" == *"Engaz files are in $(cd "$tmp/piped/home/engaz" && pwd)."* ]] \
  || fail "piped install should name its folder: $piped_out"

# A first install needs room in Docker's storage for the images; an update does not.
setup_work "$tmp/space"
mkdir -p "$tmp/space/docker-root"
export STUB_DOCKER_ROOT="$tmp/space/docker-root" STUB_DF_AVAILABLE_KB=5242880
data_install "$tmp/space"
expect_data_failure "Engaz needs at least 8 GB for its images and first data."
export STUB_DOCKER_IMAGES=present
data_install "$tmp/space"
[[ "$data_code" -eq 0 ]] || fail "an update with local images should skip the space check: $data_out"
unset STUB_DOCKER_ROOT STUB_DF_AVAILABLE_KB STUB_DOCKER_IMAGES

# Platform paths: stubs stand in for uname and each platform's own tools.
platform_work() {
  local work="$1" kernel="$2"
  setup_work "$work"
  rm "$work/cwd/.env"
  printf '#!/usr/bin/env bash\ncase "${1:-}" in -m) echo arm64 ;; *) echo %s ;; esac\n' "$kernel" > "$work/bin/uname"
  chmod +x "$work/bin/uname"
}

# Only the tools the early Docker checks need, so no real Docker is found.
without_docker() {
  local work="$1" tool
  rm "$work/bin/docker"
  mkdir -p "$work/system"
  for tool in bash env python3 openssl grep sed awk tr head tail cat mkdir rm mktemp chmod id sleep; do
    ln -s "$(command -v "$tool")" "$work/system/$tool"
  done
}

desktop_docker_app_present=false
for app in /Applications/Docker.app /Applications/OrbStack.app; do
  [[ ! -d "$app" ]] || desktop_docker_app_present=true
done

if [[ "$desktop_docker_app_present" == false ]]; then
  # macOS without Docker explains Docker Desktop instead of offering a Linux package.
  platform_work "$tmp/mac-no-docker" Darwin
  without_docker "$tmp/mac-no-docker"
  set +e
  mac_out="$(PATH="$tmp/mac-no-docker/system" run_install "$tmp/mac-no-docker" 2>&1)"
  mac_code=$?
  set -e
  [[ "$mac_code" -ne 0 && "$mac_out" == *"Install Docker Desktop from https://docs.docker.com/desktop/setup/install/mac-install/"* ]] \
    || fail "macOS without Docker needs Docker Desktop guidance: $mac_out"
  [[ "$mac_out" != *"get.docker.com"* ]] || fail "macOS must not offer the Linux Docker script"

  # A stopped Colima is started, then setup continues.
  platform_work "$tmp/mac-colima" Darwin
  printf '#!/usr/bin/env bash\n[[ "$1" == start ]] && touch "%s"\n' "$tmp/mac-colima/running" > "$tmp/mac-colima/bin/colima"
  chmod +x "$tmp/mac-colima/bin/colima"
  set +e
  colima_out="$(STUB_DOCKER_RUNNING_FLAG="$tmp/mac-colima/running" run_install "$tmp/mac-colima" --offline 2>&1)"
  colima_code=$?
  set -e
  [[ "$colima_code" -eq 0 && "$colima_out" == *"Colima is running."* && -e "$tmp/mac-colima/running" ]] \
    || fail "a stopped Colima should be started: $colima_out"
fi

# WSL without Docker points to the Windows installer.
platform_work "$tmp/wsl-no-docker" Linux
without_docker "$tmp/wsl-no-docker"
set +e
wsl_out="$(WSL_DISTRO_NAME=Ubuntu PATH="$tmp/wsl-no-docker/system" run_install "$tmp/wsl-no-docker" 2>&1)"
wsl_code=$?
set -e
[[ "$wsl_code" -ne 0 && "$wsl_out" == *"install.ps1 | iex"* ]] || fail "WSL without Docker needs the Windows command: $wsl_out"
[[ "$wsl_out" != *"get.docker.com"* ]] || fail "WSL must not install Docker Engine beside Docker Desktop"

# WSL records Windows' network address, where Docker Desktop publishes the web port.
platform_work "$tmp/wsl-ip" Linux
printf '#!/usr/bin/env bash\nprintf "203.0.113.9\\r\\n192.168.1.40\\r\\n"\n' > "$tmp/wsl-ip/bin/powershell.exe"
chmod +x "$tmp/wsl-ip/bin/powershell.exe"
(
  unset ENGAZ_LAN_IP
  export WSL_DISTRO_NAME=Ubuntu STUB_DOCKER_LOG="$tmp/wsl-ip/docker.log" STUB_CURL_LOG="$tmp/wsl-ip/curl.log"
  export PATH="$tmp/wsl-ip/bin:$PATH" ENGAZ_NONINTERACTIVE=1 ENGAZ_BIN_DIR="$tmp/wsl-ip/commands"
  cd "$tmp/wsl-ip/cwd" && bash "$src" --prepare-only --offline >/dev/null 2>&1
) || fail "WSL preparation failed"
grep -qxF 'WEB_ORIGIN=http://192.168.1.40:7791' "$tmp/wsl-ip/cwd/.env" || fail "WSL must use the Windows LAN address: $(cat "$tmp/wsl-ip/cwd/.env")"

# Without a Windows address, WSL stays on loopback rather than its unreachable internal address.
rm "$tmp/wsl-ip/bin/powershell.exe" "$tmp/wsl-ip/cwd/.env"
(
  unset ENGAZ_LAN_IP
  export WSL_DISTRO_NAME=Ubuntu STUB_DOCKER_LOG="$tmp/wsl-ip/docker.log" STUB_CURL_LOG="$tmp/wsl-ip/curl.log"
  export PATH="$tmp/wsl-ip/bin:$PATH" ENGAZ_NONINTERACTIVE=1 ENGAZ_BIN_DIR="$tmp/wsl-ip/commands"
  cd "$tmp/wsl-ip/cwd" && bash "$src" --prepare-only --offline >/dev/null 2>&1
) || fail "WSL loopback preparation failed"
grep -qxF 'ENGAZ_WEB_BIND=127.0.0.1' "$tmp/wsl-ip/cwd/.env" || fail "WSL without a Windows address must bind loopback"

# WSL keeps data in Docker Desktop: no folder question, and Windows drives are refused.
platform_work "$tmp/wsl-ask" Linux
printf '/mnt/c/engaz\n' > "$tmp/wsl-ask/answers"
set +e
wsl_ask_out="$(WSL_DISTRO_NAME=Ubuntu ENGAZ_NONINTERACTIVE=0 ENGAZ_TTY="$tmp/wsl-ask/answers" run_install "$tmp/wsl-ask" --offline 2>&1)"
wsl_ask_code=$?
set -e
[[ "$wsl_ask_code" -eq 0 && "$wsl_ask_out" != *"Where should Engaz keep its data?"* ]] \
  || fail "WSL should not ask for a data folder: $wsl_ask_out"
platform_work "$tmp/wsl-mnt" Linux
data_out="$(WSL_DISTRO_NAME=Ubuntu run_install "$tmp/wsl-mnt" --offline --data-dir=/mnt/c/engaz 2>&1)" && data_code=0 || data_code=$?
expect_data_failure "Windows drives cannot hold the Engaz database"

# IP discovery stays offline, rejects public overrides, and safely reports no LAN IP.
python3 - "$src" <<'PYTEST'
import contextlib, io, os, re, socket, sys
from pathlib import Path
from unittest.mock import patch
text = Path(sys.argv[1]).read_text()
code = re.search(r"detect_lan_ip\(\) \{\n  python3 -c '\n(.*?)\n'\n\}", text, re.S).group(1)
for override, expected in (("192.168.50.2", 0), ("203.0.113.2", 2), ("127.0.0.1", 2), ("192.168.50.2 ", 2), (None, 1)):
    env = {} if override is None else {"ENGAZ_LAN_IP": override}
    output = io.StringIO()
    with patch.dict(os.environ, env, clear=True), patch("socket.socket", side_effect=OSError), patch("socket.getaddrinfo", side_effect=OSError), contextlib.redirect_stdout(output):
        try:
            exec(code, {})
        except SystemExit as error:
            assert error.code == expected
    assert output.getvalue() == ("192.168.50.2\n" if expected == 0 else "")
PYTEST

echo "ok"
