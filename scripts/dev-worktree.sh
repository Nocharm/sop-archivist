#!/usr/bin/env bash
# 개발 워크트리를 명령 하나로 준비 · 띄우기 · DB 되돌리기 (macOS 로컬 전용 - 서버 · 운영 DB에서 돌리지 않는다).
# 왜: 워크트리마다 node_modules · backend venv · 시드 DB · 서버를 손으로 갖추다 거짓 스모크 실패가 되풀이됐다(2026-11-20 B1 · B4).
#
#   scripts/dev-worktree.sh new <branch> [dir]   origin/dev에서 브랜치 워크트리(기본 ../sop-wt-<브랜치 끝 이름>) + node_modules + 시드 스냅숏
#   scripts/dev-worktree.sh up [frontend-port]   (워크트리 안에서) DB를 시드로 되돌리고 backend(포트+5000) · frontend를 뒤에서 띄운다. 기본 3777 · 8777
#   scripts/dev-worktree.sh reset                backend만 내려 DB를 시드로 되돌리고 다시 띄운다 - 스모크를 다시 돌리기 전에(frontend는 그대로)
#   scripts/dev-worktree.sh seed                 시드 스냅숏을 다시 만든다 - Alembic 리비전 · 시드 스크립트를 바꾼 브랜치에서
#   scripts/dev-worktree.sh down                 두 서버를 내린다
#
# 상태는 그 워크트리의 .dev/(git 밖): seed.db(시드 스냅숏) · work.db(서버가 쓰는 사본) · ports · *.log · seed-fingerprint.json.
# 스모크(frontend/scripts/pw-smoke-sop.mjs)는 지문과 지금 묶음을 견줘, 시드 뒤 바뀐 DB면 처음에 멈춘다(DIRTY_DB_OK=1이면 그대로 돈다).
# backend는 원본 체크아웃의 backend/.venv로 돈다(워크트리에는 venv가 없다). requirements가 원본과 다르면 경고한다.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
VENV="$MAIN/backend/.venv/bin"
DEV="$ROOT/.dev"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")" # new는 이 파일로 새 워크트리의 seed를 부른다(새 워크트리의 dev에 이 파일이 아직 없어도)
WAIT_SECONDS=180 # 첫 next dev 컴파일 · Alembic 적용을 기다리는 상한

die() {
  echo "dev-worktree: $*" >&2
  exit 1
}

need_venv() {
  [ -x "$VENV/python" ] || die "no backend venv at $VENV. Fix: cd $MAIN/backend && python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt"
}

db_url() {
  echo "sqlite+aiosqlite:///$1" # 절대 경로라 슬래시 넷
}

wait_http() {
  local url=$1 name=$2 log=$3 waited=0
  until curl -sf -o /dev/null -H "X-Dev-User: qa.member" "$url"; do
    waited=$((waited + 1))
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then
      tail -20 "$log" >&2
      die "$name did not answer at $url within ${WAIT_SECONDS}s (log above: $log)"
    fi
    sleep 1
  done
}

# 그 포트에서 듣는 프로세스만 - -sTCP:LISTEN을 빼면 그 포트에 붙은 next dev 프록시까지 죽는다
stop_port() {
  local port=$1 pids
  if pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t); then
    echo "$pids" | xargs kill
    while lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null; do sleep 0.2; done
  fi
}

read_ports() {
  [ -f "$DEV/ports" ] || die "no $DEV/ports - start the servers first: scripts/dev-worktree.sh up"
  read -r FE BE <"$DEV/ports"
}

cmd_seed() {
  need_venv
  mkdir -p "$DEV"
  rm -f "$DEV/seed.db"
  echo "seeding $DEV/seed.db (reset_db → seed_sop_demo, about a minute)…"
  if ! (cd "$ROOT/backend" && DATABASE_URL=$(db_url "$DEV/seed.db") AUTH_MODE=dev "$VENV/python" -m scripts.reset_db && DATABASE_URL=$(db_url "$DEV/seed.db") AUTH_MODE=dev "$VENV/python" -m scripts.seed_sop_demo) >"$DEV/seed.log" 2>&1; then
    tail -20 "$DEV/seed.log" >&2
    die "seeding failed (log above: $DEV/seed.log)"
  fi
}

start_backend() {
  local port=$1
  # 지난 실행의 저널 · WAL이 남으면 새 사본과 섞인다
  rm -f "$DEV/work.db" "$DEV/work.db-wal" "$DEV/work.db-shm" "$DEV/work.db-journal"
  cp "$DEV/seed.db" "$DEV/work.db"
  # exec + 바깥 리디렉션 - 남은 셸이 부른 쪽의 출력 파이프를 붙들면 `… | tail`이 끝나지 않는다
  (cd "$ROOT/backend" && DATABASE_URL=$(db_url "$DEV/work.db") AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin exec nohup "$VENV/uvicorn" app.main:app --port "$port") </dev/null >"$DEV/backend.log" 2>&1 &
  wait_http "http://localhost:$port/api/health" backend "$DEV/backend.log"
}

# next dev는 뜬 뒤 업그레이드 안내를 찍고 한 번 멈출 때가 있다("Retry the same command") - 응답한 뒤에도 듣고 있는지 보고 한 번 다시 띄운다
start_frontend() {
  local fe=$1 be=$2 attempt
  for attempt in 1 2; do
    (cd "$ROOT/frontend" && BACKEND_URL="http://localhost:$be" exec nohup npx next dev -p "$fe") </dev/null >>"$DEV/frontend.log" 2>&1 &
    wait_http "http://localhost:$fe/api/bundles" frontend "$DEV/frontend.log"
    sleep 3
    if lsof -nP -iTCP:"$fe" -sTCP:LISTEN -t >/dev/null; then return 0; fi
    echo "next dev stopped after starting (attempt $attempt) - starting it again…"
  done
  tail -20 "$DEV/frontend.log" >&2
  die "next dev keeps stopping (log above: $DEV/frontend.log)"
}

# 스모크와 같은 길(frontend 프록시)로 묶음별 "updated_at#마지막 사건 id"를 적는다 - 스모크의 checkSeedFingerprint가 같은 식으로 견준다.
# 판단 · 편집은 묶음 updated_at을 바꾸지 않아 History 사건(/events)이 필요하다
write_fingerprint() {
  local base="http://localhost:$1"
  "$VENV/python" -I - "$base" "$DEV/seed-fingerprint.json" <<'PY'
import json, sys, urllib.request
base, out = sys.argv[1], sys.argv[2]
def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(f"{base}/api{path}", headers={"X-Dev-User": "qa.member"})))
marks = {}
for bundle in get("/bundles"):
    events = get(f"/bundles/{bundle['id']}/events?limit=1")
    marks[bundle["code"]] = f"{bundle['updated_at']}#{events[0]['id'] if events else 0}"
with open(out, "w", encoding="utf-8") as handle:
    json.dump({"base": base, "bundles": marks}, handle, ensure_ascii=False, indent=1)
PY
}

cmd_new() {
  local branch=${1:-} dir
  [ -n "$branch" ] || die "usage: scripts/dev-worktree.sh new <branch> [dir]"
  dir=${2:-$(dirname "$MAIN")/sop-wt-${branch##*/}}
  [ -e "$dir" ] && die "$dir already exists"
  git -C "$MAIN" fetch -q origin
  if git -C "$MAIN" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$MAIN" worktree add "$dir" "$branch"
  else
    # --no-track: origin/dev를 upstream으로 두면 git push가 dev로 갈 수 있다
    git -C "$MAIN" worktree add --no-track -b "$branch" "$dir" origin/dev
  fi
  if [ -d "$MAIN/frontend/node_modules" ] && cmp -s "$MAIN/frontend/package-lock.json" "$dir/frontend/package-lock.json"; then
    echo "cloning node_modules from $MAIN (APFS clone - a symlink is rejected by turbopack)…"
    cp -Rc "$MAIN/frontend/node_modules" "$dir/frontend/node_modules"
  else
    echo "package-lock.json differs from $MAIN - npm ci…"
    (cd "$dir/frontend" && npm ci --no-audit --no-fund)
  fi
  [ -d "$dir/frontend/node_modules/playwright-core" ] || (cd "$dir/frontend" && npm i --no-save --no-audit --no-fund playwright-core)
  for file in requirements.txt requirements-dev.txt; do
    cmp -s "$MAIN/backend/$file" "$dir/backend/$file" || echo "warning: backend/$file differs from $MAIN - the shared venv may miss a package" >&2
  done
  (cd "$dir" && "$SELF" seed)
  echo
  echo "ready: $dir"
  echo "  cd $dir && scripts/dev-worktree.sh up        # servers on 3777 · 8777 (another free port: up 3787)"
}

cmd_up() {
  FE=${1:-3777}
  BE=$((FE + 5000))
  need_venv
  [ -d "$ROOT/frontend/node_modules" ] || die "no frontend/node_modules - make the worktree with scripts/dev-worktree.sh new, or run npm ci in frontend/"
  [ -f "$DEV/seed.db" ] || cmd_seed
  for port in "$FE" "$BE"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null; then
      die "port $port is in use - stop that server (another worktree: its scripts/dev-worktree.sh down) or pick another port: up $((FE + 10))"
    fi
  done
  mkdir -p "$DEV"
  echo "$FE $BE" >"$DEV/ports"
  start_backend "$BE"
  : >"$DEV/frontend.log"
  start_frontend "$FE" "$BE"
  write_fingerprint "$FE"
  echo "up: frontend http://localhost:$FE · backend :$BE · DB $DEV/work.db (fresh seed)"
  echo "  smoke: cd frontend && BASE_URL=http://localhost:$FE QUIET=1 ONLY=\"assign:\" node scripts/pw-smoke-sop.mjs"
  echo "  logs: $DEV/backend.log · $DEV/frontend.log"
}

cmd_reset() {
  read_ports
  stop_port "$BE"
  start_backend "$BE"
  write_fingerprint "$FE"
  echo "reset: $DEV/work.db is the fresh seed again (backend :$BE restarted)"
}

cmd_down() {
  read_ports
  stop_port "$FE"
  stop_port "$BE"
  rm -f "$DEV/ports"
  echo "down: :$FE and :$BE stopped"
}

case ${1:-} in
  new) shift; cmd_new "$@" ;;
  up) shift; cmd_up "$@" ;;
  reset) cmd_reset ;;
  seed) cmd_seed ;;
  down) cmd_down ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
