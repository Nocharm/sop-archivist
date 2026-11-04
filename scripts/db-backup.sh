#!/bin/sh
# 일간 pg_dump 백업 루프 (compose db-backup 사이드카 전용) — 정책·복구 절차: docs/deploy/backup.md
# 매일 BACKUP_TIME(KST) 이후 하루 1회 덤프. 기동 직후에도 오늘자 덤프가 없으면 즉시 1회(배포 베이스라인).
# 검증(pg_restore --list) 통과 시에만 .dump로 확정 — 깨진 덤프가 정상 파일로 남지 않게.
# 접속 정보는 표준 PG* 환경변수(PGHOST/PGUSER/PGPASSWORD/PGDATABASE) — compose가 주입.

# 덤프에는 직원 디렉터리를 포함한 모든 행이 들어 있다. 호스트 바인드 마운트에서 다른 계정이 읽지 못하도록
# 이 스크립트가 만드는 모든 파일(.tmp·.dump)을 소유자 전용(0600)으로 만든다 — mkdir/pg_dump보다 먼저 건다.
umask 077

BACKUP_DIR=/backups
BACKUP_TIME="${BACKUP_TIME:-04:00}"            # KST HH:MM — 이 시각 이후 하루 1회
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"  # 보존 일수 — 초과분은 백업 성공 시마다 삭제
PREFIX="sop-archivist_"                        # 파일 이름 접두 — 같은 서버의 다른 스택 덤프와 구별
# alpine(musl)엔 zoneinfo가 없어 TZ=Asia/Seoul이 조용히 UTC로 폴백 → POSIX 오프셋 표기 사용(KST는 DST 없음)
KST="KST-9"

log() { echo "[db-backup] $(TZ=$KST date '+%Y-%m-%d %H:%M:%S KST') $*"; }

has_dump_today() {
  today=$(TZ=$KST date +%Y%m%d)
  ls "$BACKUP_DIR/${PREFIX}$today-"*.dump >/dev/null 2>&1
}

# batch_job_runs는 backend 기동 때 Alembic 0002가 만든다. 사이드카가 먼저 만들면 0002가
# "already exists"로 깨지므로 만들지 않고 생길 때까지 기다린다(첫 기동 때 backend 마이그레이션 대기).
# 5초 간격 최대 12회 — 끝내 없으면 실패(1)를 돌려 기록만 건너뛴다.
wait_for_status_table() {
  tries=0
  while [ "$tries" -lt 12 ]; do
    tries=$((tries + 1))
    reg=$(psql -tA -c "SELECT to_regclass('public.batch_job_runs')")
    [ -n "$reg" ] && return 0
    [ "$tries" -eq 1 ] && log "batch_job_runs not found yet - waiting for backend migrations"
    [ "$tries" -lt 12 ] && sleep 5
  done
  return 1
}

# 실행 기록(batch_job_runs) — 설정 Batch jobs 탭 소스. 스키마는 Alembic이 소유한다(backend 모델
# models.BatchJobRun과 계약): 컬럼을 바꾸면 이 INSERT도 함께 갱신. 기록 실패(테이블 없음, db 재기동 중)는
# 백업 흐름을 막지 않는다 — 로그만 남긴다.
record_status() {
  if ! wait_for_status_table; then
    log "batch_job_runs still missing after 12 checks - status not recorded ($1)"
    return 0
  fi
  psql -q \
    -c "INSERT INTO batch_job_runs (job, outcome, ran_at, detail) VALUES ('db_backup', '$1', now(), '$2') ON CONFLICT (job, outcome) DO UPDATE SET ran_at = EXCLUDED.ran_at, detail = EXCLUDED.detail" \
    >/dev/null || log "status write failed ($1)"
}

run_backup() {
  ts=$(TZ=$KST date +%Y%m%d-%H%M%S)
  name="${PREFIX}$ts.dump"
  tmp="$BACKUP_DIR/$name.tmp"
  if pg_dump -Fc -f "$tmp" && pg_restore --list "$tmp" >/dev/null; then
    mv "$tmp" "$BACKUP_DIR/$name"
    size=$(du -h "$BACKUP_DIR/$name" | cut -f1)
    log "ok $name ($size)"
    record_status success "$name ($size)"
    find "$BACKUP_DIR" -name "${PREFIX}*.dump" -mtime +"$RETENTION_DAYS" -delete
  else
    rm -f "$tmp"
    log "FAIL - dump or verify failed, retry in 60s"
    record_status failure "pg_dump or verify failed"
    return 1
  fi
}

mkdir -p "$BACKUP_DIR"
# 디렉터리가 이미 있으면(마운트·이전 배포) mkdir의 umask가 적용되지 않으므로 권한을 직접 좁힌다.
chmod 700 "$BACKUP_DIR"
log "started (daily at $BACKUP_TIME KST, retention ${RETENTION_DAYS}d)"
has_dump_today || run_backup

while :; do
  sleep 60
  # HH:MM → HHMM 숫자 비교(문자열 > 는 POSIX test 미보장). 실패 시 오늘자 덤프가 없어 다음 턴에 재시도.
  now=$(TZ=$KST date +%H%M)
  if ! has_dump_today && [ "$now" -ge "$(echo "$BACKUP_TIME" | tr -d ':')" ]; then
    run_backup
  fi
done
