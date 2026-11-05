# DB 자동 백업 · 복구 런북

운영 서버(사내 71번) Postgres의 자동 백업 정책과 복구 절차. 백업 주체는 compose의 `db-backup` 사이드카(`scripts/db-backup.sh`, `postgres:16-alpine` — db와 동일 이미지). 서버 명령은 모두 bash 기준이다.

> 최초 셋업(`BACKUP_DIR`·`BACKUP_RETENTION_DAYS` 결정, `.env` 사본 별도 보관)은 [`setup-once.md`](setup-once.md) A4·A11. 이 문서는 정책과 **복구 절차**를 다룬다.

## 1. 백업 정책

| 항목 | 값 |
|------|-----|
| 대상 | Postgres 전체(`pg_dump -Fc`, 압축 custom 포맷). 앱의 영속 상태는 전부 DB에 있고 backend 컨테이너에는 디스크 영속이 없으므로 DB 덤프 하나로 앱 상태 전부가 커버된다 |
| 주기 | 매일 **04:00 KST** 이후 하루 1회 + 컨테이너 기동 직후 오늘자 덤프가 없으면 즉시 1회. 온디맨드(버튼) 백업은 없다 — 수동 덤프는 §3의 안전망 명령 |
| 저장 위치 | 호스트 `${BACKUP_DIR}`(기본 `./backups`, 저장소 루트 기준) — git 추적 제외(`.gitignore`) |
| 파일명 | `sop-archivist_YYYYMMDD-HHMMSS.dump`(KST 기준) |
| 보존 | `${BACKUP_RETENTION_DAYS}`(기본 14)일 초과분은 백업 성공 시마다 자동 삭제. `pre-restore-*.dump`처럼 접두가 다른 파일은 지우지 않는다 |
| 무결성 | 덤프 직후 `pg_restore --list` 검증을 통과해야만 `.dump`로 확정한다. 실패하면 `.tmp`를 지우고 FAIL 로그를 남긴 뒤 60초 뒤 재시도한다(성공할 때까지) |
| 권한 | 덤프에는 직원 디렉터리를 포함한 **모든 행**이 들어 있고, **SOP 원문 글자와 업로드한 원본 파일(DB에 바이트로 저장)도 들어 있어 덤프 자체가 대외비 자료다**. 사이드카가 `umask 077`로 디렉터리를 `0700`, 덤프를 `0600`으로 만든다. 사이드카는 root로 돌아 **호스트의 `backups/`는 root 소유 `0700`이다. 목록을 보거나 덤프를 복사·복원할 때 읽으려면 `sudo`가 필요하다** |
| 시간대 | alpine(musl)엔 zoneinfo가 없어 `TZ=KST-9`(POSIX 오프셋)를 쓴다. KST는 DST가 없어 안전하다 |

**한계(현재 단계)**: 백업이 같은 서버 디스크에만 있다. 서버 디스크 장애·서버 유실 시 백업도 함께 잃는다. 오프서버 사본은 §5.

**`.env`는 별도 수동 백업**: 시크릿 포함이라 git 밖 자산이다. 서버 재구축에 필수이므로 안전한 별도 위치(접근이 제한된 곳)에 사본을 유지한다.

## 2. 동작 확인 (배포 후 체크)

```bash
docker compose ps db-backup              # Up
docker compose logs --tail 5 db-backup   # "[db-backup] ... KST ok sop-archivist_....dump (크기)"
sudo ls -lh backups/                     # 일자별 덤프 누적 (root 전용 디렉터리라 sudo)
```

FAIL 로그가 반복되면 db 상태(`docker compose ps db`)와 `.env`의 `POSTGRES_*` 값을 확인한다.

앱에서도 확인한다 — **관리 > Batch jobs 탭**(`system.view` 권한): 작업별 최근 결과(`db_backup`의 성공·실패 시각과 파일 이름)가 보인다. 사이드카가 psql로 `batch_job_runs`에 기록하고 스키마는 `backend/app/models.py` `BatchJobRun`과 계약이다. 사이드카는 이 테이블을 직접 만들지 않고 backend 마이그레이션이 만들 때까지 최대 1분 기다린다(먼저 만들면 Alembic 0002가 깨진다).

**첫 기동의 첫 덤프는 비어 있을 수 있다.** db가 healthy가 되면 사이드카가 바로 덤프를 뜨는데, 그 시각에 backend 마이그레이션이 아직 끝나지 않았을 수 있다(스키마가 없거나 일부뿐인 덤프). 오늘자 덤프가 있으면 사이드카는 다시 뜨지 않으므로 **의미 있는 첫 덤프는 다음 04:00 KST 이후다.** 서버를 쓰기 시작하기 전에 보험이 필요하면 §3 1)의 수동 덤프를 한 번 뜬다.

## 3. 복구 — 기존 스택에 덮어쓰기 복원

운영 DB를 특정 시점 덤프로 되돌린다. **파괴적 작업** — 현재 DB 내용이 덤프 시점으로 교체된다.

**빈 스키마에 한 트랜잭션으로 복원한다.** `pg_restore --clean --if-exists`(덮어쓰기)는 덤프 뒤 배포에서 생긴 테이블의 FK가 핵심 테이블 드랍을 막아, 오류를 무시한 채 끝나고 일부 테이블은 현재 값·일부는 덤프 값인 **섞인 DB**를 남긴다(bpm 리뷰 2026-10-19). 아래 절차는 `exit 0`·덤프와 동일한 DB를 만들고, 덤프가 깨졌으면 아무것도 쓰지 않고 `exit 1`로 끝난다. 읽기전용 계정(`dbviewer_ro`)의 권한은 덤프에 함께 들어 있고 롤은 클러스터에 남아 있으므로 복원 뒤에도 유지된다.

```bash
cd <배포 디렉터리>
DUMP=backups/sop-archivist_YYYYMMDD-HHMMSS.dump   # sudo ls backups/ 에서 고른다
docker compose stop backend frontend              # 쓰기 중단 (db는 유지, 그동안 앱은 502)

# 1) 안전망 — 지금 DB를 먼저 덤프한다. 복원이 실패하면 이 파일로 되돌린다
SAFETY=backups/pre-restore-$(date +%Y%m%d-%H%M%S).dump
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  | sudo sh -c 'umask 077; cat > "$0"' "$SAFETY" && sudo ls -lh "$SAFETY"

# 2) 빈 스키마로 비운다
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'

# 3) 한 트랜잭션으로 복원 — 오류가 하나라도 나면 전부 취소하고 exit 1
sudo cat "$DUMP" | docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error --single-transaction'
echo "exit=$?"                                    # 0이 아니면 4)로 가지 말고 아래 "실패하면"을 따른다

# 4) 기동 — backend가 덤프 뒤에 생긴 마이그레이션을 Alembic으로 head까지 올린다
docker compose start backend frontend
docker compose restart proxy                      # backend IP가 바뀌었을 수 있어 nginx가 upstream을 다시 푼다
curl -s http://localhost:7777/api/health          # {"status":"ok"}
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM employees"'
```

**실패하면(3의 exit가 0이 아님)**: 스키마는 빈 상태로 남는다(부분 복원 없음). 앱을 띄우지 말고 2)·3)을 `DUMP=$SAFETY`로 다시 실행해 복원 직전 상태로 되돌린 뒤 4)로 기동하고, 덤프 파일을 다른 날짜로 골라 다시 시도한다.

- `pre-restore-*.dump`는 사이드카의 보존 정리 대상(`sop-archivist_*.dump`)이 아니라 자동으로 지워지지 않는다. 복구가 끝나면 `sudo rm`으로 정리한다. 직원 디렉터리가 든 파일이니 다른 곳에 복사하지 않는다.
- **덤프보다 코드가 낡으면 기동하지 못한다.** 덤프는 그 시점의 `alembic_version`을 담고 있어, 더 새 스키마의 덤프를 옛 코드로 복원하면 backend가 `Can't locate revision`으로 뜨지 않는다. 복원할 덤프의 시점에 맞는 코드(태그)로 먼저 `git checkout` 한다.

## 4. 복구 — 신규 서버 / 볼륨 유실 시

저장소 + `.env` 사본 + 백업 덤프를 새 서버로 옮긴다. 덤프는 `backups/`에 두고 디렉터리를 소유자 전용(`sudo chmod 700 backups`)으로 유지한다. 새 서버에도 `dbv-shared`가 있어야 한다([`setup-once.md`](setup-once.md) A2). 그런 다음:

```bash
docker compose up -d db                                           # db만 먼저 기동(빈 DB 생성)
docker compose exec db sh -c 'pg_isready -U "$POSTGRES_USER"'     # accepting connections 가 될 때까지 반복
sudo cat backups/sop-archivist_YYYYMMDD-HHMMSS.dump | docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error --single-transaction'
echo "exit=$?"                                                    # 0이 아니면 다른 덤프로 다시 — 빈 DB라 반복해도 안전
docker compose up -d --build                                      # 나머지 기동 — backend가 필요한 마이그레이션을 이어서 적용
```

- **`--no-acl`이 필요한 이유.** 덤프에는 `dbviewer_ro`에게 준 `GRANT`가 들어 있다. 새 볼륨에는 그 롤이 없어서 `--no-acl` 없이 복원하면 `role "dbviewer_ro" does not exist`로 전체가 취소된다(실측). db-viewer를 이미 연결했었다면 복원 뒤 [`db-viewer-readonly.md`](db-viewer-readonly.md) §5의 SQL(롤 생성 포함)을 다시 실행한다.
- 새 서버의 compose 내부 대역이 다르면 `FORWARDED_ALLOW_IPS`를 다시 맞춘다([`setup-once.md`](setup-once.md) A6).
- Keycloak 클라이언트는 서버가 아니라 Keycloak에 있으므로 서버 주소(origin)가 바뀐 경우에만 URI를 추가한다([`setup-once.md`](setup-once.md) A5).

## 5. 오프서버 사본

현재 결정(2026-11-04): 1단계는 서버 디스크만. 오프서버 사본이 필요하면:

- **수동 사본**: `backups/`가 root 전용이라 `sudo`로 읽어 다른 호스트에 넘긴다. 임시로 읽기 가능한 사본을 만들지 않는다:

  ```bash
  sudo cat backups/sop-archivist_YYYYMMDD-HHMMSS.dump | ssh <계정>@<다른 호스트> 'umask 077; cat > <보관 경로>/sop-archivist_YYYYMMDD-HHMMSS.dump'
  ```

- **사본도 사적으로 다룬다.** 덤프에는 직원 이름·loginId·부서와 접속 기록, SOP 원문 글자와 원본 파일(대외비)이 들어 있다. 소유자 전용 권한이나 접근이 통제된 저장소에만 두고, 공용 공유 폴더·메신저·메일 첨부로 옮기지 않으며, 필요 없어지면 지운다.
- **NAS 마운트가 생기면**: `.env`의 `BACKUP_DIR`만 그 경로로 바꾸면 된다(코드 무변경, 스크립트가 `chmod 700`을 다시 건다).
- **타 서버 전송을 자동화하려면**: `scripts/db-backup.sh`의 백업 성공 지점에 scp/rsync 단계를 추가한다(SSH 키 준비 필요). 스크립트를 바꾼 배포는 사이드카를 다시 만든다 — `docker compose up -d --force-recreate db-backup`([`deploy.md`](deploy.md) §2).
