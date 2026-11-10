# db-viewer 읽기전용 조회 연결 (서버 수작업분)

같은 71번 서버의 **db-viewer**(스키마 탐색·ERD·행 미리보기, `:6678`)가 이 앱의 PostgreSQL을 **읽기 전용**으로 조회하기 위한 절차. 앱 코드는 바뀌지 않는다. 저장소에 이미 반영된 것은 `docker-compose.yml`의 네트워크 항목 한 덩어리뿐이고, **나머지는 사람이 서버에서 한 번 실행해야 하는 작업**이라 이 문서에 모았다. 서버 명령은 모두 bash 기준이고, `docker compose` 명령은 배포 폴더(기본 `/data/deployments/sop-archivist`, [`gitlab-runner.md`](gitlab-runner.md) 3절)에서 실행한다.

db-viewer 쪽 원본 런북(연결 방식·네트워크 정책·트러블슈팅 총괄)은 그 저장소의 `docs/connect-sources.md`다. 여기는 **이 스택에서 밟는 부분**만 적는다.

> **운영 서버 연결 완료(2026-11-10).** `dbviewer_ro`를 발급하고 db-viewer에 소스를 등록했다. 조회 범위는 **SOP 원문 표까지 공개, `login_records`만 제외**로 정했다(사용자 결정 — §3).

> **보안 원칙 — db-viewer는 읽기 전용 `dbviewer_ro` 계정으로만 붙는다.** 앱 계정(`POSTGRES_USER`)이나 DB 소유자 계정으로 등록하지 않는다. db-viewer에 저장되는 자격증명이 곧 DB 전체 쓰기 권한이 되고, 앱의 `POSTGRES_PASSWORD`가 다른 서비스로 새어 나간다. `POSTGRES_PASSWORD`는 강한 임의값으로 서버 `.env`에만 둔다([`setup-once.md`](setup-once.md) A4).

---

## 0. 저장소가 한 것 / 사람이 할 것

| | 무엇 | 어디서 |
|---|---|---|
| 반영됨 | db 컨테이너의 `dbv-shared` 합류 + 별칭(`DBV_DB_ALIAS`, 기본 `sop-archivist-db`) | `docker-compose.yml` · `.env.example` |
| 수작업 | 공유 네트워크 `dbv-shared` 존재 확인(없으면 생성) | 서버 — §2 ([`setup-once.md`](setup-once.md) A2와 같다) |
| 수작업 | 읽기전용 계정 `dbviewer_ro` 발급(민감 테이블 REVOKE 포함) | 서버 psql — §3 |
| 수작업 | db-viewer `/admin`에 소스 등록 → 연결 테스트 → 수집 → 미리보기 허용 | db-viewer 화면 — §4 |

이 앱은 첫 `up`부터 compose가 db를 `dbv-shared`에 합류시키므로, bpm 때와 달리 db를 따로 다시 만들 필요가 없다. 앱을 재배포해도 이 절차를 반복하지 않는다.

## 1. 이 스택의 값

| 항목 | 값 |
|---|---|
| 공유 브리지 | `dbv-shared` (`10.203.0.0/24`) |
| db 별칭(= db-viewer가 host로 입력) | `sop-archivist-db` |
| compose 프로젝트 / db 컨테이너 | `sop-archivist` / `sop-archivist-db-1` |
| 볼륨 | `sop-archivist_pgdata` |
| DB 이름 / 앱 계정 | `.env`의 `POSTGRES_DB` / `POSTGRES_USER` (기본 둘 다 `sop_archivist`) |
| 읽기전용 계정 | `dbviewer_ro` |
| `.env` 키 | `DBV_DB_ALIAS=sop-archivist-db`(기본값이라 적지 않아도 된다) |

**왜 별칭을 쓰나 — 서비스 이름 `db`로 붙지 않는다.** 공유 네트워크에는 여러 스택(bpm 등)의 DB가 함께 있고, 각 스택의 서비스 이름은 모두 `db`라서 `dbv-shared` 안에서 `db`는 여러 DB를 가리킨다. 별칭이 겹치거나 서비스 이름으로 붙으면 db-viewer가 **엉뚱한 DB에 붙고도 연결 테스트는 초록으로 뜬다.** 이 방식의 유일한 함정이라 §4-2에서 DB 이름을 눈으로 대조한다. 이 스택은 별칭 `sop-archivist-db`만 쓰고, bpm의 `bpm-db`와 겹치지 않는다.

기존 `default` 네트워크는 바뀌지 않는다. db는 두 네트워크에 동시에 속하고 backend·db-backup은 `default`로 db를 찾는다. 호스트 포트를 새로 여는 것이 아니다(`5432` 미노출) — 같은 브리지 안에서만 닿는다.

## 2. 공유 네트워크와 별칭 확인

⚠️ **external 네트워크는 `up` 전에 존재해야 한다.** 없으면 `docker compose up`이 `network dbv-shared declared as external, but could not be found`로 **실패한다**(데이터는 무관 — 만들고 다시 `up` 하면 된다).

```bash
docker network inspect dbv-shared -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # 10.203.0.0/24
# 없으면 (db-viewer 운영자 = 본인, 서버 전체에서 1회):
docker network create --subnet 10.203.0.0/24 dbv-shared
```

스택을 올린 뒤 db가 그 네트워크에 별칭으로 합류했는지 본다:

```bash
docker compose config | grep -n -A2 aliases        # sop-archivist-db 로 보간됐는지
docker inspect -f '{{json .NetworkSettings.Networks}}' sop-archivist-db-1 | python3 -m json.tool | grep -E '"(sop-archivist_default|dbv-shared)"|Aliases' -A3
```

✅ 통과 기준: `dbv-shared` 항목의 `Aliases`에 `sop-archivist-db`가 있고, `sop-archivist_default`에도 연결돼 있다.

## 3. 읽기전용 계정 `dbviewer_ro`

SQL은 **히어독으로 psql 표준 입력에 넣는다.** `psql -c "..."`는 `:'ro_pw'`·`:"DBNAME"` 같은 psql 변수를 바꾸지 않고 글자 그대로 서버에 보내 `syntax error at or near ":"`로 끝난다(실측 2026-11-10). 변수는 표준 입력이나 `-f`로 읽는 SQL에서만 바뀐다.

```bash
# 컨테이너를 직접 지정한다 — compose exec는 -p·--env-file 조합이 어긋나면 자주 실패한다(bpm 실측).
DB=sop-archivist-db-1
# 비밀번호는 직접 생성(openssl rand -base64 24)해 붙여 넣고 Enter — 화면·히스토리에 남지 않는다. 저장소에는 두지 않는다(공개 저장소다)
read -rs RO_PW
docker exec -i -e RO_PW="$RO_PW" $DB sh -c 'psql -v ON_ERROR_STOP=1 -v ro_pw="$RO_PW" -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
CREATE ROLE dbviewer_ro LOGIN PASSWORD :'ro_pw';

-- :"DBNAME" = 지금 접속한 DB(.env의 POSTGRES_DB) — 이름을 손으로 바꿔 적지 않는다
GRANT CONNECT ON DATABASE :"DBNAME" TO dbviewer_ro;
GRANT USAGE ON SCHEMA public TO dbviewer_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbviewer_ro;

-- 앞으로 Alembic 마이그레이션이 만드는 새 테이블에도 자동 적용 — 없으면 릴리스마다 새 테이블이 안 보인다
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dbviewer_ro;

-- 제외는 이 표 하나: 사용자별 접속 기록
REVOKE SELECT ON login_records FROM dbviewer_ro;
SQL
unset RO_PW
```

이 앱의 테이블(36개와 `alembic_version`)은 전부 `public` 스키마라 다른 스키마 GRANT는 필요 없다. db-viewer의 허용 목록은 **스키마 단위**(`public` 통째)라 테이블 단위 차단은 이 REVOKE로만 걸린다.

- **조회 범위 — SOP 원문 표까지 공개하고 `login_records`만 뺀다(사용자 결정, 2026-11-10).** 원문과 고쳐 쓴 문장이 담긴 표(`source_blocks`·`units`·`target_sentences`·`target_text_history`·`ai_suggestions`·`embedding_cache`), 원본 파일(`document_files`), 직원 디렉터리(`employees`·`departments`), 권한 변경 기록(`access_audit_events`), AI 사용량(`ai_usage_events`)이 모두 열린다. db-viewer에서 이 소스의 미리보기를 여는 사람은 SOP 원문(대외비)을 본다는 뜻이다. 범위를 좁히려면 같은 방식으로 `REVOKE SELECT ON <테이블> FROM dbviewer_ro`를 더한다.
- **새 테이블을 만드는 마이그레이션을 배포할 때마다 민감 여부를 본다.** `ALTER DEFAULT PRIVILEGES`가 새 테이블에 SELECT를 자동으로 주므로, 막아야 할 테이블이면 배포 직후 REVOKE를 더한다.
- 비밀번호를 바꿀 때는 같은 히어독 방식으로 `ALTER ROLE dbviewer_ro PASSWORD :'ro_pw';`를 실행한 뒤 db-viewer의 소스 비밀번호를 갱신한다.

✅ 통과 기준 — 별도 세션에서(컨테이너 안 소켓 접속이라 비밀번호는 묻지 않는다. 비밀번호 검증은 §4의 연결 테스트가 한다):

```bash
docker exec -i $DB sh -c 'psql -U dbviewer_ro -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM employees"'      # 숫자
docker exec -i $DB sh -c 'psql -U dbviewer_ro -d "$POSTGRES_DB" -tAc "CREATE TABLE zzz_probe (id int)"'     # permission denied
docker exec -i $DB sh -c 'psql -U dbviewer_ro -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM login_records"'  # permission denied
```

## 4. db-viewer `/admin` 등록

**먼저 화면 위쪽의 잠금 바를 연다** — db-viewer 관리 비밀번호(`PREVIEW_ADMIN_PASSWORD`)를 넣고 [잠금 해제]. 잠겨 있으면 폼을 다 채워도 **등록 단추가 꺼져 있다**(실측 2026-11-10). 아래 4번의 허용 스키마 편집도 같은 잠금 바를 쓴다.

1. **등록** — 이름 `SOP Archivist`, 엔진 `postgres`, host **`sop-archivist-db`**, port `5432`, database `sop_archivist`(= `POSTGRES_DB`), username **`dbviewer_ro`**, password(§3). 저장 후 목록에 `has_password: true`. 폼이 아예 안 뜨면 db-viewer의 `SOURCE_SECRET_KEY` 미설정이다.
2. **[연결 테스트]** — 응답의 `database`가 **`sop_archivist`**, `version`이 PostgreSQL 16인지 **눈으로 대조**한다. 초록인데 DB 이름이 다르면 별칭이 다른 서비스와 겹친 것이다 — host를 고친다.
3. **[카탈로그 수집]** — 진행 패널에서 스냅샷이 `ready`로 끝나는지.
4. **미리보기 허용 스키마**에 이 소스의 `public` 등록(잠금 바가 열려 있어야 한다). 등록 전에는 값이 전혀 안 열린다(기본 전부 차단).

> 비밀번호를 넣는 곳이 두 군데다. 잠금 바는 db-viewer의 `PREVIEW_ADMIN_PASSWORD`, 등록 폼 안쪽은 `dbviewer_ro`의 비밀번호다(§3).

✅ 통과 기준: 소스를 고른 뒤 `employees` 미리보기에 행이 보이고, `login_records`는 권한 오류로 안 열린다(REVOKE 반영).

⚠️ **`document_files`는 미리보기를 열지 않는다.** `content` 칸(bytea)에 업로드한 원본 파일이 통째로 들어 있어, 미리보기가 파일 전체를 내려받는다(실측 2026-11-10). 권한으로 막은 것이 아니라 운영 규칙이다. 파일 이름·크기·해시는 `documents`(`file_name`·`size_bytes`·`sha256`)에서 본다.

## 5. 되돌리기 · 트러블슈팅

**연결 해제**: db-viewer `/admin`에서 소스 비활성화(또는 스냅샷·정책 정리 후 삭제) → 이 스택에서:

```bash
docker exec -i $DB sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP OWNED BY dbviewer_ro" -c "DROP ROLE dbviewer_ro"'
```

`DROP ROLE`만 실행하면 권한이 남아 있어 `cannot be dropped because some objects depend on it`로 실패한다. `DROP OWNED BY`가 그 롤에 준 권한을 먼저 걷는다(실측). compose 합류까지 빼려면 `docker-compose.yml`의 db `networks`에서 `dbv-shared`를 되돌리는 커밋을 GitLab 파이프라인으로 배포한다(배포 폴더의 compose 파일을 손으로 고치면 다음 배포가 덮어쓴다). 배포 뒤 backend가 DB 연결 오류를 내면 배포 폴더에서 `docker compose restart backend proxy`.

**`docker compose down -v` 이후** — `dbv-shared`는 `external`이라 남지만 `pgdata`가 지워지면 **`dbviewer_ro` 롤과 권한도 함께 사라진다.** 덤프를 복원해도 돌아오지 않는다(`pg_dump`는 롤을 담지 않는다). §3 SQL을 롤 생성부터 다시 실행한다. db-viewer 쪽 소스 등록은 그대로 유효하다([`backup.md`](backup.md) §4).

| 증상 | 확인 |
|---|---|
| `network dbv-shared declared as external, but could not be found` | §2 — 네트워크가 없거나 `docker network prune`으로 지워졌다. 만들고 다시 `up` |
| db 재생성 후 backend가 db를 못 찾음 / 502 | compose `db.networks`에서 `default:`가 빠졌다(명시하는 순간 자동 연결이 사라진다) |
| 연결 테스트 초록인데 `database`가 다른 이름 | 별칭 충돌·오타·서비스 이름 `db`로 등록 — host를 `sop-archivist-db`로(§1) |
| 연결 테스트 502 | 별칭 해석 실패·비밀번호 오류. db-viewer 쪽에서 `docker exec -i <db-viewer backend 컨테이너> python -c "import socket; print(socket.gethostbyname('sop-archivist-db'))"`(컨테이너 이름은 `docker ps`로 확인) → `10.203.0.x`가 나와야 한다 |
| 연결 테스트 503 | db-viewer `SOURCE_SECRET_KEY` 미설정·불일치 — db-viewer 런북 |
| 미리보기가 비어 있음 | 허용 스키마 미등록(§4-4) 또는 REVOKE 한 테이블 |
| 새 릴리스 후 신규 테이블이 안 보임 | `ALTER DEFAULT PRIVILEGES` 누락(§3) — 실행 후 카탈로그 재수집 |
