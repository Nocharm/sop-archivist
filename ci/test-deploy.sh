#!/bin/sh
# Tests ci/deploy.sh with a fake `docker` first on PATH and temporary folders.
# POSIX sh: runs in docker:27-cli (busybox, the CI job) and in GNU/macOS shells.
# Usage: sh ci/test-deploy.sh   (TEST_SH=dash sh ci/test-deploy.sh runs deploy.sh under another shell)
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_SH="$ROOT/ci/deploy.sh"
TEST_SH="${TEST_SH:-sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

passed=0
failed=0
case_no=0

# The fake docker cannot see the test's environment (deploy.sh calls it through `env -i`),
# so its control folder path is written into the script itself.
write_fake_docker() {
  {
    echo '#!/bin/sh'
    echo "CTL='$CTL'"
    cat << 'FAKE'
printf '%s\n' "$*" >> "$CTL/calls.log"
{ printf '%s %s\n' '---' "$*"; env | sort; } >> "$CTL/env.log"
last=""
for arg in "$@"; do last="$arg"; done
case "$1" in
  version)
    if [ -f "$CTL/daemon-down" ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi
    echo "26.1.3-fake"; exit 0 ;;
  network)
    if [ -f "$CTL/net-$3" ]; then exit 0; fi
    echo "Error response from daemon: network $3 not found" >&2; exit 1 ;;
  image)
    if [ -f "$CTL/missing-images" ] && grep -qxF "$3" "$CTL/missing-images"; then
      echo "Error response from daemon: No such image: $3" >&2; exit 1
    fi
    exit 0 ;;
  run)
    if [ -f "$CTL/probe-fail" ]; then echo "invalid mount config: bind source path does not exist" >&2; exit 125; fi
    src=""
    for arg in "$@"; do
      case "$arg" in type=bind,src=*) src="${arg#type=bind,src=}"; src="${src%%,dst=*}" ;; esac
    done
    [ -f "$src/${last#/probe/}" ]; exit $? ;;
  compose)
    shift
    if [ "$1" = "-p" ]; then shift 2; fi
    case "$1" in
      version) echo "2.99.0-fake"; exit 0 ;;
      config | restart) exit 0 ;;
      up) if [ -f "$CTL/up-fail" ]; then echo "build failed" >&2; exit 1; fi; exit 0 ;;
      ps) echo "NAME STATUS (fake ps)"; exit 0 ;;
      logs) echo "fake backend logs"; exit 0 ;;
      exec)
        count=0
        if [ -f "$CTL/exec-count" ]; then count="$(cat "$CTL/exec-count")"; fi
        count=$((count + 1))
        echo "$count" > "$CTL/exec-count"
        limit=0
        if [ -f "$CTL/restarting-calls" ]; then limit="$(cat "$CTL/restarting-calls")"; fi
        if [ "$count" -le "$limit" ] || [ -f "$CTL/health-never" ]; then
          echo "Error response from daemon: Container 0123 is restarting, wait until the container is running" >&2
          exit 1
        fi
        mode=keycloak
        if [ -f "$CTL/mode" ]; then mode="$(cat "$CTL/mode")"; fi
        case "$last" in
          */api/health) echo '{"status":"ok"}' ;;
          */api/auth/mode) echo "{\"mode\":\"$mode\",\"keycloakIssuer\":\"http://SECRET-ISSUER-HOST:8080/realms/x\",\"keycloakClientId\":\"SECRET-CLIENT-ID\"}" ;;
          *) echo '<html>ok</html>' ;;
        esac
        exit 0 ;;
    esac ;;
esac
echo "fake docker: unexpected call: $*" >&2
exit 99
FAKE
  } > "$BIN/docker"
  chmod +x "$BIN/docker"
}

# A fresh fake server: checkout, deploy folder with .env/backups and an old deployment.
setup_case() {
  case_no=$((case_no + 1))
  CASE="$WORK/case$case_no"
  CTL="$CASE/ctl"
  BIN="$CASE/bin"
  SRC="$CASE/builds/group/sop-archivist"
  DEPLOY="$CASE/data/deployments/sop-archivist"
  OUT="$CASE/out.log"
  DEPLOY_ARG="$DEPLOY"
  mkdir -p "$CTL" "$BIN" "$SRC/.git" "$SRC/frontend" "$SRC/backend" "$SRC/scripts" "$DEPLOY/backups" "$DEPLOY/scripts"
  : > "$CTL/calls.log"
  : > "$CTL/env.log"
  touch "$CTL/net-dbv-test"
  write_fake_docker

  echo "ref: refs/heads/main" > "$SRC/.git/HEAD"
  printf '{\n  "name": "frontend",\n  "version": "9.8.7",\n  "private": true\n}\n' > "$SRC/frontend/package.json"
  cat > "$SRC/frontend/Dockerfile" << 'EOF'
# FROM comment:0 is not an image
FROM node:24.22.1-alpine AS deps
RUN echo from the deps stage
FROM deps AS builder
from node:24.22.1-alpine as runner
EOF
  echo "FROM --platform=linux/amd64 python:3.11-slim" > "$SRC/backend/Dockerfile"
  cat > "$SRC/docker-compose.yml" << 'EOF'
services:
  proxy:
    image: nginx:1.27-alpine
  db:
    image: "postgres:16-alpine"  # same image as the backup sidecar
  db-backup:
    image: postgres:16-alpine
EOF
  echo "echo backup v2" > "$SRC/scripts/db-backup.sh"
  echo "new" > "$SRC/new-file.txt"
  echo "stages: [test]" > "$SRC/.gitlab-ci.yml"

  write_env "AUTH_MODE=keycloak" "BACKUP_DIR=./backups" "DBV_NETWORK=dbv-test"
  echo "dump" > "$DEPLOY/backups/old.dump"
  echo "stale" > "$DEPLOY/stale-file.txt"
  echo "old hidden" > "$DEPLOY/.old-hidden"
  echo "echo backup v2" > "$DEPLOY/scripts/db-backup.sh"
  echo "commit=old" > "$DEPLOY/.deployed"
}

# .env with the given lines plus a secret that must never reach the output.
write_env() {
  {
    echo "# server .env (test)"
    echo "POSTGRES_PASSWORD=SECRET-PG-VALUE"
    for line in "$@"; do printf '%s\n' "$line"; done
  } > "$DEPLOY/.env"
}

# Extra VAR=value arguments become the job environment.
run_deploy() {
  if (cd "$CASE" && env CI_PROJECT_DIR="$SRC" SOP_DEPLOY_DIR="$DEPLOY_ARG" \
      SOP_HEALTH_TRIES=4 SOP_HEALTH_INTERVAL=0 \
      CI_COMMIT_SHA=abc123 CI_PIPELINE_ID=42 CI_JOB_ID=7 PATH="$BIN:$PATH" \
      "$@" "$TEST_SH" "$DEPLOY_SH") > "$OUT" 2>&1; then
    rc=0
  else
    rc=$?
  fi
}

snapshot_deploy() {
  (cd "$DEPLOY" && find . -type f -exec cksum {} \; | sort; find . | sort)
}

report() {
  if [ "$2" = 0 ]; then
    passed=$((passed + 1))
    printf 'ok    %s\n' "$1"
  else
    failed=$((failed + 1))
    printf 'FAIL  %s\n' "$1"
    sed 's/^/      | /' "$OUT"
  fi
}

# check "name" command...: the command's success is the assertion.
check() {
  name="$1"
  shift
  if "$@"; then report "$name" 0; else report "$name" 1; fi
}

has_call() { grep -qF -- "$1" "$CTL/calls.log"; }
has_output() { grep -qF -- "$1" "$OUT"; }
succeeded() { [ "$rc" = 0 ]; }
failed_run() { [ "$rc" != 0 ]; }
has_no_secrets() {
  ! grep -qF -e SECRET-PG-VALUE -e SECRET-ISSUER-HOST -e SECRET-CLIENT-ID "$OUT"
}
did_not_deploy() { ! grep -qE '^compose( -p [^ ]+)? up' "$CTL/calls.log"; }

# A guard must fail with its own message, delete nothing and never reach compose.
expect_guard_failure() {
  name="$1"
  message="$2"
  shift 2
  before="$(snapshot_deploy)"
  run_deploy "$@"
  after="$(snapshot_deploy)"
  if failed_run && has_output "$message" && did_not_deploy && [ "$before" = "$after" ] && has_no_secrets; then
    report "guard: $name" 0
  else
    report "guard: $name (rc=$rc)" 1
  fi
}

# --- happy path, with hostile job variables ---------------------------------
setup_case
env_before="$(cksum < "$DEPLOY/.env")"
run_deploy AUTH_MODE=dev COMPOSE_PROJECT_NAME=evil COMPOSE_FILE=evil.yml \
  DOCKER_HOST=tcp://docker:2375 POSTGRES_PASSWORD=evil BACKUP_DIR=/evil APP_PORT=1
check "happy path exits 0" succeeded
check "sync keeps .env unchanged" test "$env_before" = "$(cksum < "$DEPLOY/.env")"
check "sync keeps backups/" test -f "$DEPLOY/backups/old.dump"
check "sync removes stale files" test ! -e "$DEPLOY/stale-file.txt" -a ! -e "$DEPLOY/.old-hidden"
check "sync lays new files (dotfiles too)" test -f "$DEPLOY/new-file.txt" -a -f "$DEPLOY/.gitlab-ci.yml"
check "sync skips .git" test ! -e "$DEPLOY/.git"
check "marker records version" grep -qx "version=9.8.7" "$DEPLOY/.deployed"
check "marker records commit" grep -qx "commit=abc123" "$DEPLOY/.deployed"
check "probe file cleaned up" test -z "$(find "$DEPLOY" -name '.deploy-probe.*')"
check "compose up --build ran" has_call "compose -p sop-archivist up -d --build"
check "proxy restarted" has_call "compose -p sop-archivist restart proxy"
check "db-backup not recreated when unchanged" sh -c "! grep -qF -- '--force-recreate' '$CTL/calls.log'"
expected_images="$(printf '%s\n' "image inspect nginx:1.27-alpine" "image inspect node:24.22.1-alpine" \
  "image inspect postgres:16-alpine" "image inspect python:3.11-slim")"
check "base images read from Dockerfiles and compose" \
  test "$(grep '^image inspect' "$CTL/calls.log" | sort)" = "$expected_images"
check "job AUTH_MODE not passed to docker" sh -c "! grep -q '^AUTH_MODE=' '$CTL/env.log'"
check "job COMPOSE_* not passed to docker" sh -c "! grep -q '^COMPOSE_' '$CTL/env.log'"
check "job POSTGRES_PASSWORD/BACKUP_DIR/APP_PORT not passed" \
  sh -c "! grep -qE '^(POSTGRES_PASSWORD|BACKUP_DIR|APP_PORT)=' '$CTL/env.log'"
check "DOCKER_HOST forced to the socket" \
  test "$(grep '^DOCKER_HOST=' "$CTL/env.log" | sort -u)" = "DOCKER_HOST=unix:///var/run/docker.sock"
check "output has no secrets" has_no_secrets

# --- db-backup recreate only when the script changed or on first deploy -----
setup_case
echo "echo backup v1" > "$DEPLOY/scripts/db-backup.sh"
run_deploy
check "changed db-backup.sh is recreated" sh -c "[ $rc = 0 ] && grep -qF 'compose -p sop-archivist up -d --force-recreate db-backup' '$CTL/calls.log'"

setup_case
rm "$DEPLOY/.deployed"
run_deploy
check "first deploy recreates db-backup" sh -c "[ $rc = 0 ] && grep -qF 'compose -p sop-archivist up -d --force-recreate db-backup' '$CTL/calls.log'"
check "first deploy writes the marker" test -f "$DEPLOY/.deployed"

# --- accepted .env variants -------------------------------------------------
for backup_line in "BACKUP_DIR=" "BACKUP_DIR=backups" "BACKUP_DIR=OUTSIDE"; do
  setup_case
  outside="$CASE/elsewhere/backups"
  write_env "AUTH_MODE=keycloak" "DBV_NETWORK=dbv-test" "$(echo "$backup_line" | sed "s|OUTSIDE|$outside|")"
  run_deploy
  check "accepts $backup_line" succeeded
done

setup_case
write_env "AUTH_MODE=dev" "export AUTH_MODE = \"keycloak\"  # last one wins" "DBV_NETWORK='dbv-test'"
printf 'BACKUP_DIR=./backups\r\n' >> "$DEPLOY/.env"
run_deploy
check "accepts quoted/exported/commented/CRLF values" succeeded

setup_case
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=./backups"
touch "$CTL/net-dbv-shared"
run_deploy
check "DBV_NETWORK defaults to dbv-shared" sh -c "[ $rc = 0 ] && grep -qx 'network inspect dbv-shared' '$CTL/calls.log'"

# --- guards: fail, delete nothing, never reach compose ----------------------
setup_case
rm "$DEPLOY/.env"
expect_guard_failure "no .env" "no .env in the deploy folder"

setup_case
write_env "AUTH_MODE=dev" "BACKUP_DIR=./backups" "DBV_NETWORK=dbv-test"
expect_guard_failure "AUTH_MODE=dev" "AUTH_MODE is not 'keycloak'"

setup_case
write_env "BACKUP_DIR=./backups" "DBV_NETWORK=dbv-test"
expect_guard_failure "AUTH_MODE missing" "AUTH_MODE is not 'keycloak'"

setup_case
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=./data" "DBV_NETWORK=dbv-test"
expect_guard_failure "relative BACKUP_DIR other than ./backups" "BACKUP_DIR is a relative path"

setup_case
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=$DEPLOY/dumps" "DBV_NETWORK=dbv-test"
expect_guard_failure "absolute BACKUP_DIR inside the deploy folder" "BACKUP_DIR points inside"

setup_case
DEPLOY_ARG="data/deployments/sop-archivist"
expect_guard_failure "relative deploy folder" "must be an absolute path"

setup_case
DEPLOY_ARG="$CASE/data/deployments/missing"
expect_guard_failure "missing deploy folder" "deploy folder does not exist"

setup_case
DEPLOY_ARG="$CASE/data/deployments/../deployments/sop-archivist"
expect_guard_failure "deploy folder with .." "must not contain"

setup_case
touch "$CTL/daemon-down"
expect_guard_failure "Docker daemon unreachable" "cannot reach the Docker daemon"

setup_case
touch "$CTL/probe-fail"
expect_guard_failure "host does not see the same path" "does not see the deploy folder"

setup_case
echo "nginx:1.27-alpine" > "$CTL/missing-images"
expect_guard_failure "base image missing" "base image(s) missing"
check "missing image is named" has_output "nginx:1.27-alpine. Bring"

setup_case
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=./backups" "DBV_NETWORK=dbv-missing"
expect_guard_failure "shared network missing" "shared network 'dbv-missing'"

for bad_dir in "/" "/usr"; do
  setup_case
  DEPLOY_ARG="$bad_dir"
  run_deploy
  check "guard: deploy folder $bad_dir" sh -c "[ $rc != 0 ] && grep -qE \"is '/'|two levels\" '$OUT' && ! grep -qF ' up -d' '$CTL/calls.log'"
done

setup_case
cp "$DEPLOY/.env" "$SRC/.env"
DEPLOY_ARG="$SRC"
run_deploy
check "guard: deploy folder is the checkout" sh -c "[ $rc != 0 ] && grep -qF 'inside it' '$OUT' && [ -d '$SRC/.git' ] && ! grep -qF ' up -d' '$CTL/calls.log'"

setup_case
DEPLOY_ARG="$CASE/builds"
cp "$DEPLOY/.env" "$CASE/builds/.env"
run_deploy
check "guard: checkout inside the deploy folder" sh -c "[ $rc != 0 ] && grep -qF 'checkout is inside' '$OUT' && [ -d '$SRC/.git' ] && ! grep -qF ' up -d' '$CTL/calls.log'"

# --- health check ------------------------------------------------------------
setup_case
echo 3 > "$CTL/restarting-calls"
run_deploy
check "health waits through 'restarting' then passes" sh -c "[ $rc = 0 ] && grep -qF 'not ready yet (3/4)' '$OUT'"
check "health output has no secrets" has_no_secrets

setup_case
touch "$CTL/health-never"
run_deploy
check "health that never passes fails the job" failed_run
check "failed health shows logs" has_output "fake backend logs"
check "failed health output has no secrets" has_no_secrets

setup_case
echo dev > "$CTL/mode"
run_deploy
check "auth mode other than keycloak fails the job" sh -c "[ $rc != 0 ] && grep -qF 'mode other than keycloak' '$OUT'"
check "auth mode body is not printed" has_no_secrets

setup_case
touch "$CTL/up-fail"
run_deploy
check "compose up failure fails the job with logs" sh -c "[ $rc != 0 ] && grep -qF 'fake backend logs' '$OUT'"

# --- production refuses the dev stack's .env ----------------------------------
setup_case
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=./backups" "DBV_NETWORK=dbv-test" "APP_PORT=4444"
expect_guard_failure "production with the dev port" "APP_PORT is not 7777"

setup_case
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=./backups" "DBV_NETWORK=dbv-test" "DBV_DB_ALIAS=sop-archivist-dev-db"
expect_guard_failure "production with the dev db alias" "DBV_DB_ALIAS is not sop-archivist-db"

setup_case
expect_guard_failure "unknown stack" "SOP_DEPLOY_ENV must be production or dev" SOP_DEPLOY_ENV=staging

# --- dev stack ------------------------------------------------------------------
# The dev job reads only SOP_DEV_DEPLOY_DIR: a project-level SOP_DEPLOY_DIR (run_deploy always
# passes one) must not move it, so it points at a folder that does not exist.
write_dev_env() {
  write_env "BACKUP_DIR=./backups" "DBV_NETWORK=dbv-test" "APP_PORT=4444" "DBV_DB_ALIAS=sop-archivist-dev-db" "$@"
}

setup_case
DEPLOY_ARG="$CASE/data/deployments/production-folder"
write_dev_env "AUTH_MODE=dev" "DEV_ENFORCE_PERMISSIONS=true"
echo dev > "$CTL/mode"
rm "$DEPLOY/.deployed"
run_deploy SOP_DEPLOY_ENV=dev SOP_DEV_DEPLOY_DIR="$DEPLOY"
check "dev: deploy exits 0" succeeded
check "dev: uses SOP_DEV_DEPLOY_DIR, not SOP_DEPLOY_DIR" test -f "$DEPLOY/new-file.txt"
check "dev: own compose project without the backup sidecar" \
  has_call "compose -p sop-archivist-dev up -d --build proxy frontend backend db"
check "dev: first deploy does not recreate db-backup" sh -c "! grep -qF -- 'db-backup' '$CTL/calls.log'"
check "dev: health accepts auth mode dev" has_output "auth mode dev"
check "dev: output has no secrets" has_no_secrets

setup_case
write_dev_env "AUTH_MODE=keycloak"
run_deploy SOP_DEPLOY_ENV=dev SOP_DEV_DEPLOY_DIR="$DEPLOY"
check "dev: accepts keycloak" succeeded

setup_case
write_dev_env "AUTH_MODE=dev"
expect_guard_failure "dev without DEV_ENFORCE_PERMISSIONS" "needs DEV_ENFORCE_PERMISSIONS=true" \
  SOP_DEPLOY_ENV=dev SOP_DEV_DEPLOY_DIR="$DEPLOY"

setup_case
write_dev_env "AUTH_MODE=ldap"
expect_guard_failure "dev with an unknown auth mode" "must be 'dev' or 'keycloak'" \
  SOP_DEPLOY_ENV=dev SOP_DEV_DEPLOY_DIR="$DEPLOY"

setup_case
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=./backups" "DBV_NETWORK=dbv-test"
expect_guard_failure "dev with the production .env (port)" "APP_PORT must be the dev stack's own port" \
  SOP_DEPLOY_ENV=dev SOP_DEV_DEPLOY_DIR="$DEPLOY"

setup_case
write_env "AUTH_MODE=keycloak" "BACKUP_DIR=./backups" "DBV_NETWORK=dbv-test" "APP_PORT=4444"
expect_guard_failure "dev with the production db alias" "DBV_DB_ALIAS must be the dev stack's own alias" \
  SOP_DEPLOY_ENV=dev SOP_DEV_DEPLOY_DIR="$DEPLOY"

setup_case
write_dev_env "AUTH_MODE=dev" "DEV_ENFORCE_PERMISSIONS=true"
run_deploy SOP_DEPLOY_ENV=dev SOP_DEV_DEPLOY_DIR="$DEPLOY"
check "dev: health fails when the app runs another auth mode" sh -c "[ $rc != 0 ] && grep -qF 'mode other than dev' '$OUT'"

echo
echo "passed: $passed, failed: $failed"
[ "$failed" = 0 ]
