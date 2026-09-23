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
g '--pull never'
g 'cannot enforce pull-never on this Compose version'
g '${up_pull_args[@]+"${up_pull_args[@]}"}'
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
  printf '\n'
} >> "$log"

case "${1:-}" in
  compose) shift ;;
  info) exit 0 ;;
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
  volume) printf '%s\n' "${STUB_DOCKER_VOLUMES-}"; exit 0 ;;
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

echo "VERB=${verb:-none}" >> "$log"

if [[ "$verb" == config ]]; then
  cat >/dev/null || true
fi

if [[ "$help" == true ]]; then
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
    cat <<'EOF'
POSTGRES_PASSWORD=test-postgres
BETTER_AUTH_SECRET=test-auth-secret
ENCRYPTION_KEY=test-encryption-key
SCREEN_PROXY_SECRET=test-screen-secret
SANDBOX_SUPERVISOR_TOKEN=test-supervisor-token
EOF
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
  printf 'stub-download\n' > "$out"
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
  : > "$work/cwd/docker-compose.images.yml"
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
    export STUB_CURL_LOG="$work/curl.log"
    export PATH="$work/bin:$PATH"
    export ENGAZ_NONINTERACTIVE="${ENGAZ_NONINTERACTIVE-1}"
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
[[ ! -s "$tmp/offline/curl.log" ]] || fail "--offline should not curl when files are local: $(cat "$tmp/offline/curl.log")"
has_compose_pull "$tmp/offline" && fail "--offline should not run compose pull"
has_up_pull_never "$tmp/offline" || fail "--offline should pass --pull never to compose up: $(cat "$tmp/offline/docker.log")"

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

# Old Compose without up --pull: warn and continue instead of hard-fail.
setup_work "$tmp/old"
export STUB_COMPOSE_UP_HELP='Usage: docker compose up
  --wait
  --wait-timeout int
'
export STUB_COMPOSE_SHORT='2.10.1'
set +e
old_out="$(run_install "$tmp/old" --offline 2>&1)"
old_code=$?
set -e
unset STUB_COMPOSE_UP_HELP STUB_COMPOSE_SHORT
[[ "$old_code" -eq 0 ]] || fail "old Compose --offline exited $old_code: $old_out"
[[ "$old_out" == *"cannot enforce pull-never on this Compose version; startup fails if an image is missing locally"* ]] \
  || fail "old Compose --offline missing soft warning: $old_out"
[[ "$old_out" != *"Engaz setup failed:"* ]] || fail "old Compose --offline should not hard-fail: $old_out"
[[ "$old_out" == *"Open http://127.0.0.1:7791 in your browser to set it up."* ]] || fail "old Compose --offline should continue: $old_out"
has_compose_pull "$tmp/old" && fail "old Compose --offline should not run compose pull"
if grep -F -e ' --pull never' "$tmp/old/docker.log" >/dev/null; then
  fail "old Compose up should not receive --pull never: $(cat "$tmp/old/docker.log")"
fi
grep -q 'VERB=up' "$tmp/old/docker.log" || fail "old Compose --offline should still run compose up"

# Empty up arrays under set -u must not abort a normal install (bash 3.2).
setup_work "$tmp/default"
set +e
default_out="$(run_install "$tmp/default" 2>&1)"
default_code=$?
set -e
[[ "$default_code" -eq 0 ]] || fail "default install exited $default_code: $default_out"
[[ "$default_out" != *"unbound variable"* ]] || fail "empty array expansion aborted: $default_out"
has_compose_pull "$tmp/default" || fail "default install should run compose pull"
grep -q 'VERB=up' "$tmp/default/docker.log" || fail "default install should run compose up"

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
data_install "$tmp/data" "--data-dir=$tmp/data/store/"
[[ "$data_code" -eq 0 ]] || fail "--data-dir exited $data_code: $data_out"
store="$(cd "$tmp/data/store" && pwd -P)"
[[ -d "$store/postgres" && -d "$store/appdata" ]] || fail "--data-dir did not create data folders"
grep -qxF "ENGAZ_DATA_DIR=$store" "$store/.env" || fail "--data-dir did not record ENGAZ_DATA_DIR: $(cat "$store/.env")"
grep -qxF "COMPOSE_FILE=docker-compose.images.yml:docker-compose.data-dir.yml" "$store/.env" \
  || fail "--data-dir did not record COMPOSE_FILE"
[[ "$(ls -ld "$store/.env" | cut -c1-10)" == "-rw-------" ]] || fail ".env should be private"
grep -F -e 'up -d' "$tmp/data/docker.log" | grep -F -e '-f docker-compose.data-dir.yml' >/dev/null \
  || fail "--data-dir should start with the data-dir Compose file: $(cat "$tmp/data/docker.log")"
[[ "$data_out" == *"Data and secrets are in $store"* ]] || fail "--data-dir should name the folder to back up"

data_install "$tmp/data" "--data-dir=$store"
[[ "$data_code" -eq 0 ]] || fail "--data-dir rerun exited $data_code: $data_out"
[[ "$data_out" == *"Keeping existing .env."* ]] || fail "--data-dir rerun should keep .env"

# Rerunning from inside the folder without the flag must not fall back to named volumes.
: > "$tmp/data/docker.log"
set +e
data_out="$(
  export STUB_DOCKER_LOG="$tmp/data/docker.log" STUB_CURL_LOG="$tmp/data/curl.log"
  export PATH="$tmp/data/bin:$PATH"
  export ENGAZ_NONINTERACTIVE=1
  cd "$store" && bash "$src" 2>&1
)"
data_code=$?
set -e
[[ "$data_code" -eq 0 ]] || fail "rerun inside the data folder exited $data_code: $data_out"
[[ "$data_out" == *"Keeping Engaz data in $store"* ]] || fail "rerun inside the folder lost the data dir: $data_out"
grep -F -e 'up -d' "$tmp/data/docker.log" | grep -F -e '-f docker-compose.data-dir.yml' >/dev/null \
  || fail "rerun inside the folder should keep the data-dir Compose file"

setup_work "$tmp/relative"
data_install "$tmp/relative" --data-dir=engaz-data
expect_data_failure "--data-dir must be an absolute path."

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
rm "$tmp/update/cwd/.env"
export STUB_DOCKER_PROJECT_DIR="$tmp/update/installed"
data_install "$tmp/update"
[[ "$data_code" -eq 0 ]] || fail "update from another folder exited $data_code: $data_out"
[[ "$data_out" == *"Updating the Engaz installation in $tmp/update/installed"* ]] || fail "update did not find the installation: $data_out"
[[ ! -e "$tmp/update/cwd/.env" ]] || fail "update must not create a second .env"
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
  cd "$tmp/piped/cwd" && bash < "$src" 2>&1
)"
piped_code=$?
set -e
[[ "$piped_code" -eq 0 ]] || fail "piped install exited $piped_code: $piped_out"
[[ -f "$tmp/piped/home/engaz/.env" ]] || fail "piped install should use ~/engaz: $piped_out"
[[ ! -e "$tmp/piped/cwd/.env" ]] || fail "piped install should not write into the current folder"
[[ "$piped_out" == *"Engaz files are in $(cd "$tmp/piped/home/engaz" && pwd)."* ]] \
  || fail "piped install should name its folder: $piped_out"

echo "ok"
