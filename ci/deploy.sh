#!/bin/sh
# Deploy SOP Archivist from the GitLab deploy job onto the server's Docker daemon.
# Runs inside docker:27-cli (busybox sh) on the sop-archivist-deploy runner, which mounts the
# host Docker socket and the deploy folder at the SAME path on both sides. Setup and the
# meaning of every guard message: docs/deploy/gitlab-runner.md.
#
# Never add `set -x`, print .env or `docker compose config` output, or run down/prune/
# --remove-orphans here: values are secrets, and prune deletes build-only base images
# that cannot be pulled again (the server has no Docker Hub).
set -eu

# Two stacks on the same server, chosen by the CI job (never by a project CI/CD variable):
#   production  :7777  folder SOP_DEPLOY_DIR      compose project sop-archivist      (main, manual)
#   dev         :4444  folder SOP_DEV_DEPLOY_DIR  compose project sop-archivist-dev  (dev, automatic)
# Each stack has its own folder variable so a project-level SOP_DEPLOY_DIR can never point the
# dev job at the production folder; the .env checks below also refuse the other stack's .env.
DEPLOY_ENV="${SOP_DEPLOY_ENV:-production}"
PROD_PORT="7777"
PROD_DB_ALIAS="sop-archivist-db"
case "$DEPLOY_ENV" in
  production)
    DEPLOY_DIR="${SOP_DEPLOY_DIR:-/data/deployments/sop-archivist}"
    DEPLOY_DIR_VAR="SOP_DEPLOY_DIR"   # named in guard messages so they point at this stack's CI variable
    COMPOSE_PROJECT="sop-archivist"
    ;;
  dev)
    DEPLOY_DIR="${SOP_DEV_DEPLOY_DIR:-/data/deployments/sop-archivist-dev}"
    DEPLOY_DIR_VAR="SOP_DEV_DEPLOY_DIR"
    COMPOSE_PROJECT="sop-archivist-dev"
    ;;
  *)
    printf '[deploy] FAILED: SOP_DEPLOY_ENV must be production or dev.\n' >&2
    exit 1
    ;;
esac
SRC_DIR="${CI_PROJECT_DIR:-$(pwd)}"
# Health wait: first boot runs Alembic migrations, which can take minutes. Defaults = 5 min.
HEALTH_TRIES="${SOP_HEALTH_TRIES:-60}"
HEALTH_INTERVAL="${SOP_HEALTH_INTERVAL:-5}"
# Probe container for the host-path check. Same image as the job, already on the server.
PROBE_IMAGE="docker:27-cli"
DOCKER_SOCKET="unix:///var/run/docker.sock"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] FAILED: %s\n' "$*" >&2
  exit 1
}

# Every docker call runs with an empty environment. Compose prefers process env over .env
# when filling ${VAR}, and GitLab exports all CI variables into the job; COMPOSE_* and a
# group-level DOCKER_HOST would also redirect compose itself. Compose reads .env on its own.
run_docker() {
  env -i PATH="$PATH" HOME="${HOME:-/root}" DOCKER_HOST="$DOCKER_SOCKET" docker "$@"
}

# Compose always names the stack's project explicitly: the file's own `name:` is production's.
run_compose() {
  run_docker compose -p "$COMPOSE_PROJECT" "$@"
}

# Read KEY's value from the deploy folder's .env the way a plain dotenv line is written:
# last assignment wins, surrounding spaces, quotes, CR and a trailing " # comment" are dropped.
# The value is only compared by callers, never printed.
read_env_value() {
  sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}$1[[:space:]]*=//p" "$DEPLOY_DIR/.env" \
    | tail -n 1 \
    | tr -d '\r' \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/"
}

# Resolve an existing directory to its physical path (symlinks and .. removed).
resolve_dir() {
  (cd -P "$1" && pwd)
}

is_same_or_inside() {
  case "$1" in
    "$2" | "$2"/*) return 0 ;;
  esac
  return 1
}

check_deploy_dir() {
  # Strip trailing slashes so "/data/x/" and "/data/x" compare the same.
  while [ "${DEPLOY_DIR%/}" != "$DEPLOY_DIR" ] && [ "$DEPLOY_DIR" != "/" ]; do
    DEPLOY_DIR="${DEPLOY_DIR%/}"
  done
  case "$DEPLOY_DIR" in
    /) fail "deploy folder is '/'. Set $DEPLOY_DIR_VAR to a dedicated folder such as /data/home_<account>/deployments/$COMPOSE_PROJECT." ;;
    /*) ;;
    *) fail "deploy folder must be an absolute path ($DEPLOY_DIR_VAR is relative)." ;;
  esac
  case "$DEPLOY_DIR" in
    *//* | */./* | */../* | */. | */..) fail "deploy folder path must not contain '//', '.' or '..' parts." ;;
  esac
  case "${DEPLOY_DIR#/}" in
    */*) ;;
    *) fail "deploy folder must be at least two levels deep (for example /data/home_<account>/deployments/$COMPOSE_PROJECT)." ;;
  esac
  [ -d "$DEPLOY_DIR" ] || fail "deploy folder does not exist inside the job. Check the $DEPLOY_DIR_VAR CI variable and the runner's --docker-volumes mount (gitlab-runner.md 1, 2)."

  deploy_real="$(resolve_dir "$DEPLOY_DIR")"
  src_real="$(resolve_dir "$SRC_DIR")"
  if is_same_or_inside "$deploy_real" "$src_real"; then
    fail "deploy folder is the job checkout or inside it. Point $DEPLOY_DIR_VAR at the mounted deploy folder."
  fi
  if is_same_or_inside "$src_real" "$deploy_real"; then
    fail "job checkout is inside the deploy folder. Syncing would delete it."
  fi
}

check_env_file() {
  [ -f "$DEPLOY_DIR/.env" ] || fail "no .env in the deploy folder. Copy it there once by hand (gitlab-runner.md 3)."

  auth_mode="$(read_env_value AUTH_MODE)"
  app_port="$(read_env_value APP_PORT)"
  db_alias="$(read_env_value DBV_DB_ALIAS)"
  if [ "$DEPLOY_ENV" = "production" ]; then
    [ "$auth_mode" = "keycloak" ] \
      || fail ".env AUTH_MODE is not 'keycloak'. dev mode trusts a header and seeds fake staff (setup-once.md C)."
    case "$app_port" in
      "" | "$PROD_PORT") ;;
      *) fail ".env APP_PORT is not $PROD_PORT. Is this the dev stack's .env?" ;;
    esac
    case "$db_alias" in
      "" | "$PROD_DB_ALIAS") ;;
      *) fail ".env DBV_DB_ALIAS is not $PROD_DB_ALIAS. Is this the dev stack's .env?" ;;
    esac
  else
    case "$auth_mode" in
      keycloak) ;;
      dev)
        # Without enforcement every dev login is a sysadmin; the dev stack keeps permissions per user.
        [ "$(read_env_value DEV_ENFORCE_PERMISSIONS)" = "true" ] \
          || fail ".env AUTH_MODE=dev needs DEV_ENFORCE_PERMISSIONS=true on the dev stack."
        ;;
      *) fail ".env AUTH_MODE must be 'dev' or 'keycloak' on the dev stack." ;;
    esac
    case "$app_port" in
      "" | "$PROD_PORT") fail ".env APP_PORT must be the dev stack's own port (4444), not empty or $PROD_PORT." ;;
    esac
    case "$db_alias" in
      "" | "$PROD_DB_ALIAS") fail ".env DBV_DB_ALIAS must be the dev stack's own alias (sop-archivist-dev-db), not empty or $PROD_DB_ALIAS." ;;
    esac
  fi
  log ".env AUTH_MODE: $auth_mode"

  backup_dir="$(read_env_value BACKUP_DIR)"
  case "$backup_dir" in
    "" | "./backups" | "./backups/" | "backups" | "backups/") log ".env BACKUP_DIR: default (./backups)" ;;
    /*)
      backup_trimmed="${backup_dir%/}"
      if [ -z "$backup_trimmed" ] || is_same_or_inside "$backup_trimmed" "$DEPLOY_DIR"; then
        fail ".env BACKUP_DIR points inside the deploy folder; the sync would delete it. Use ./backups or a path outside."
      fi
      log ".env BACKUP_DIR: absolute path outside the deploy folder"
      ;;
    *) fail ".env BACKUP_DIR is a relative path other than ./backups; the sync would delete it. Use ./backups or an absolute path outside." ;;
  esac
}

# "The folder exists in the job" does not prove the host has the same folder at the same path.
# Compose hands absolute bind paths to the host daemon, which silently creates missing ones as
# empty root dirs. A fresh container with --mount (fails on a missing path, never creates it)
# looks for a marker file written from inside the job.
check_host_path() {
  probe_name=".deploy-probe.${CI_JOB_ID:-$$}"
  : > "$DEPLOY_DIR/$probe_name"
  if run_docker run --rm --pull never --network none \
      --mount "type=bind,src=$DEPLOY_DIR,dst=/probe,readonly" \
      --entrypoint test "$PROBE_IMAGE" -f "/probe/$probe_name"; then
    probe_ok=1
  else
    probe_ok=0
  fi
  rm -f "$DEPLOY_DIR/$probe_name"
  [ "$probe_ok" = 1 ] \
    || fail "the host does not see the deploy folder at the same path. Mount it as <path>:<path> in the runner (gitlab-runner.md 2)."
  log "host path check: same folder on host and job"
}

# Base images named by Dockerfile FROM lines (minus build-stage aliases) and compose image: lines.
list_base_images() {
  for dockerfile in "$SRC_DIR"/*/Dockerfile; do
    [ -f "$dockerfile" ] || continue
    awk '
      toupper($1) == "FROM" {
        i = 2
        while (i <= NF && $i ~ /^--/) i++
        ref = $i
        if (!(ref in stage)) print ref
        for (j = i + 1; j < NF; j++) if (toupper($j) == "AS") stage[$(j + 1)] = 1
      }
    ' "$dockerfile"
  done
  sed -n 's/^[[:space:]]*image:[[:space:]]*//p' "$SRC_DIR/docker-compose.yml" \
    | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/"
}

check_docker_daemon() {
  server_version="$(run_docker version --format '{{.Server.Version}}')" \
    || fail "cannot reach the Docker daemon through $DOCKER_SOCKET. Check the runner's docker.sock mount."
  log "docker daemon: $server_version"
  log "compose (job image): $(run_docker compose version --short)"
}

check_prerequisites() {

  network="$(read_env_value DBV_NETWORK)"
  [ -n "$network" ] || network="dbv-shared"
  run_docker network inspect "$network" > /dev/null 2>&1 \
    || fail "shared network '$network' (DBV_NETWORK) does not exist. Create it as in setup-once.md A2; this job never creates networks."
  log "shared network: $network"

  missing=""
  for image in $(list_base_images | sort -u); do
    if run_docker image inspect "$image" > /dev/null 2>&1; then
      log "base image present: $image"
    else
      missing="$missing $image"
    fi
  done
  [ -z "$missing" ] \
    || fail "base image(s) missing on the server:$missing. Bring them in as amd64 tars (deploy.md 0)."
}

checksum_of() {
  if [ -f "$1" ]; then cksum < "$1"; else echo "absent"; fi
}

# Replace everything in the deploy folder except .env and backups/ with the checkout (no .git).
sync_deploy_dir() {
  for entry in "$DEPLOY_DIR"/* "$DEPLOY_DIR"/.[!.]* "$DEPLOY_DIR"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    case "${entry##*/}" in
      .env | backups) continue ;;
    esac
    rm -rf "$entry"
  done

  set --
  for entry in "$SRC_DIR"/* "$SRC_DIR"/.[!.]* "$SRC_DIR"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    case "${entry##*/}" in
      .git | .env | backups) continue ;;
    esac
    set -- "$@" "${entry##*/}"
  done
  [ "$#" -gt 0 ] || fail "job checkout is empty."
  (cd "$SRC_DIR" && tar -cf - "$@") | (cd "$DEPLOY_DIR" && tar -xf -)
}

read_app_version() {
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC_DIR/frontend/package.json" | head -n 1
}

write_deploy_marker() {
  {
    echo "commit=${CI_COMMIT_SHA:-unknown}"
    echo "pipeline=${CI_PIPELINE_ID:-unknown}"
    echo "job=${CI_JOB_ID:-unknown}"
    echo "version=$(read_app_version)"
    echo "deployed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } > "$DEPLOY_DIR/.deployed"
}

show_failure_and_exit() {
  printf '[deploy] FAILED: %s\n' "$1" >&2
  # Best-effort diagnostics: a failing ps must not hide the logs, and the job fails anyway.
  run_compose ps || true
  run_compose logs --tail 80 backend proxy || true
  exit 1
}

# One HTTP GET through the proxy container (the job's localhost is not the server).
# While backend/proxy restart, exec itself fails; callers treat that as "not ready yet".
fetch_via_proxy() {
  run_compose exec -T proxy wget -q -T 10 -O - "http://127.0.0.1$1" 2> /dev/null
}

wait_until_healthy() {
  attempt=1
  while [ "$attempt" -le "$HEALTH_TRIES" ]; do
    health="$(fetch_via_proxy /api/health || true)"
    if printf '%s' "$health" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      # The body also carries the Keycloak issuer and client ID from .env: judge, never print.
      mode_body="$(fetch_via_proxy /api/auth/mode || true)"
      if printf '%s' "$mode_body" | grep -q "\"mode\"[[:space:]]*:[[:space:]]*\"$auth_mode\""; then
        mode_ok=1
      elif printf '%s' "$mode_body" | grep -q '"mode"'; then
        show_failure_and_exit "/api/auth/mode reports a mode other than $auth_mode."
      else
        mode_ok=0
      fi
      if [ "$mode_ok" = 1 ] && fetch_via_proxy / > /dev/null; then
        log "health: /api/health ok, auth mode $auth_mode, / 200"
        return 0
      fi
    fi
    log "not ready yet ($attempt/$HEALTH_TRIES)"
    attempt=$((attempt + 1))
    sleep "$HEALTH_INTERVAL"
  done
  show_failure_and_exit "the app did not become healthy in time."
}

main() {
  log "stack: $DEPLOY_ENV (compose project $COMPOSE_PROJECT)"
  log "deploy folder: $DEPLOY_DIR"
  check_deploy_dir
  check_env_file
  check_docker_daemon
  check_host_path
  check_prerequisites

  if [ -f "$DEPLOY_DIR/.deployed" ]; then is_first_deploy=0; else is_first_deploy=1; fi
  backup_script_before="$(checksum_of "$DEPLOY_DIR/scripts/db-backup.sh")"

  sync_deploy_dir
  write_deploy_marker
  log "synced commit ${CI_COMMIT_SHA:-unknown} (version $(read_app_version))"

  cd "$DEPLOY_DIR"
  run_compose config --quiet || fail "docker compose config rejected the deploy folder (output hidden: it expands secrets)."
  if [ "$DEPLOY_ENV" = "production" ]; then
    run_compose up -d --build || show_failure_and_exit "docker compose up failed."
  else
    # The dev stack holds throwaway data: no backup sidecar.
    run_compose up -d --build proxy frontend backend db || show_failure_and_exit "docker compose up failed."
  fi

  # nginx resolves the backend name only at start; a recreated backend gets a new address.
  run_compose restart proxy || show_failure_and_exit "proxy restart failed."
  if [ "$DEPLOY_ENV" = "production" ] \
      && { [ "$is_first_deploy" = 1 ] || [ "$backup_script_before" != "$(checksum_of scripts/db-backup.sh)" ]; }; then
    # The script is a bind mount, so `up` keeps the old loop running unless recreated.
    log "db-backup.sh changed or first deploy: recreating db-backup"
    run_compose up -d --force-recreate db-backup || show_failure_and_exit "db-backup recreate failed."
  fi

  wait_until_healthy
  run_compose ps
  log "done"
}

main "$@"
