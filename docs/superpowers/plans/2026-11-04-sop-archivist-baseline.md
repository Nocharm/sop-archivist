# SOP Archivist 기반 세팅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제품 기능 없이, 사내 서버 71번(:7777)에 바로 올라가고 Keycloak·HR 디렉터리·사내 GLM·백업·db-viewer에 붙으며 표 기반 권한 체계를 가진 빈 앱 SOP Archivist `v0.1.0`을 만든다.

**Architecture:** 모노레포 `backend/`(FastAPI + SQLAlchemy async + Alembic) · `frontend/`(Next.js standalone) · `nginx/` · compose 5서비스. bpm의 사내 인프라 모듈을 도메인 결합을 끊어 이식하고, 권한 체계는 `backend/app/access/`에 새로 만든다. 로컬은 sqlite + dev 인증으로 네이티브 실행, 서버는 postgres + Keycloak compose.

**Tech Stack:** Python 3.11 · FastAPI 0.136.3 · uvicorn[standard] 0.49.0 · SQLAlchemy[asyncio] 2.0.50 · asyncpg 0.31.0 · aiosqlite 0.22.1 · pydantic-settings 2.14.1 · pyjwt[crypto] 2.13.0 · httpx2 2.3.0 · Alembic(최신 안정판 고정) · pytest 9.0.3 · ruff 0.15.16 / Next.js 16.4.3 · React 19.2.4 · Tailwind 4 · oidc-client-ts ^3.5.0 · react-oidc-context ^3.3.1 · lucide-react ^1.17.0 · vitest ^4.1.9 · jsdom ^29.1.1 / postgres:16-alpine · nginx:1.27-alpine

**Spec:** `docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`

**이식 출처:** `../bpm` @ `1bf6d1cf` — 읽기 전용, 절대 수정하지 않는다. "port X"는 X를 복사한 뒤 그 단계에 적힌 bpm 도메인 결합을 걷어 낸다는 뜻.

## Global Constraints

- 작업 위치 이 저장소 루트(브랜치 `feat/sop-archivist`, upstream `sop-archivist/main`). 각 태스크 커밋 뒤 `git push sop-archivist HEAD:main`(로컬 브랜치 이름이 원격 `main`과 달라 그냥 `git push`는 거부된다).
- 배포 런타임 Python 3.11: `backend/ruff.toml` `target-version = "py311"`, 로컬 venv도 `/opt/homebrew/bin/python3.11`로 만든다.
- 베이스 이미지 태그는 정확히 `python:3.11-slim`, `node:24.22.1-alpine`, `nginx:1.27-alpine`, `postgres:16-alpine`(서버에 이미 있음). Dockerfile에 `# syntax=` 금지.
- 포트: 서버 앱 `7777`, 로컬 backend `8777`, 로컬 frontend `3777`.
- 모든 backend env는 `backend/app/settings.py` · `.env.example` · `docker-compose.yml` backend `environment:`(`VAR: ${VAR:-}`) 세 곳에 함께 둔다(backend에 `env_file` 없음).
- 시각 컬럼은 전부 `DateTime(timezone=True)`, 현재 시각은 `app.clock.now()`(KST). 프런트 표시는 `lib/datetime.ts`(Asia/Seoul).
- 평문 HTTP 서버: `crypto.randomUUID`·`crypto.subtle`·`navigator.clipboard` 직접 사용 금지 → `genId()`·`copyText()`. Keycloak PKCE 끔.
- 추적 파일에 실서버 IP·사내 호스트명·시크릿 금지. 플레이스홀더 `<server-ip>`, `<keycloak-host>`, `<n8n-host>`, `<ai-host>`. 사설 대역(172.x, 10.x)은 허용.
- AI 페이로드에 직원 실명을 싣지 않는다.
- 브라우저 저장소 키 접두 `sopa.`. UI 기본 영어 + 한국어 전환, 아이콘 lucide 16px/strokeWidth 1.5, 이모지 금지, 인터랙티브 요소에 `data-testid`.
- 커밋: `type(scope): English summary — 한국어 요약`, 본문은 WHY, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01T4sqoWoGcxKzpMpvsupvDq`. 커밋마다 `PROGRESS.md`에 1–3줄. `git add <files>`로 명시 스테이징.
- 로컬 명령을 문서에 쓸 때는 bash와 PowerShell 병기.

## Review Focus

1. **부서 체인이 깨진 직원**(소속 `dept_code`가 미러에 없음, 부모 단절, 순환) → 개인 부여는 그대로 적용, 닿는 조상 부서의 부여만 적용, 예외 없음. 테스트: Task 4 `test_get_dept_chain_codes_*`, Task 5 `test_resolve_unknown_dept_keeps_user_grants`·`test_resolve_dept_cycle_terminates`.
2. **조직 개편으로 사라진 부서에 걸린 부여** → 지워지지 않고 목록에 `subject_missing=true`, 판정에서는 무시, 500 없음. 테스트: Task 5 `test_grants_list_marks_missing_department`.
3. **HR 동기화 전에 처음 로그인한 사람**(employees 행 없음) → `/api/me` 200(이름 빈 값, 권한 없음), 유효 권한 조회는 `known=false`. 테스트: Task 5 `test_me_unknown_employee`.
4. **퇴직자(`active=false`)에게 남은 부여** → 권한 없음, 조회에 `active=false`. 테스트: Task 5 `test_resolve_inactive_employee_has_nothing`.
5. **AI 꺼짐 또는 상류 장애** → ping이 503/502와 읽을 수 있는 문구(토큰·URL 미노출), 실패도 사용량 행 `ok=false`, 화면은 사람 말 문구. 테스트: Task 7 `test_ai_ping_disabled`·`test_ai_ping_upstream_error_records_failure`, Task 10 스모크.

## 공용 데이터 — dev 디렉터리·데모 권한

Task 4(backend `app/dev_users.py`)와 Task 8(frontend `lib/dev-auth.ts` `LOCAL_USERS`)이 같은 값을 쓴다.

| dept_code | parent | name | name_ko | level |
|---|---|---|---|---|
| `CORP` | — | Example Pharma | 예시제약 | 1 |
| `DIV-QA` | `CORP` | Quality Division | 품질본부 | 2 |
| `TEAM-QA1` | `DIV-QA` | QA Team 1 | 품질보증1팀 | 3 |
| `DIV-PROD` | `CORP` | Production Division | 생산본부 | 2 |
| `TEAM-PROD1` | `DIV-PROD` | Production Team 1 | 생산1팀 | 3 |
| `DIV-IT` | `CORP` | IT Division | IT본부 | 2 |
| `TEAM-IT1` | `DIV-IT` | IT Ops Team | IT운영팀 | 3 |

| login_id | name | korean_name | dept_code |
|---|---|---|---|
| `dev.admin` | Dev Admin | 개발관리자 | `TEAM-IT1` |
| `qa.lead` | QA Lead | 품질리드 | `DIV-QA` |
| `qa.member` | QA Member | 품질담당 | `TEAM-QA1` |
| `prod.member` | Production Member | 생산담당 | `TEAM-PROD1` |
| `ops.member` | Ops Member | 운영담당 | `TEAM-IT1` |

데모 권한(`scripts/reset_db.py`만 넣는다): 역할 `Permission Admin` = {`permission.manage`}, 역할 `Operations` = {`directory.sync`, `system.view`, `ai.admin`}. 부여: 부서 `DIV-QA` → `Permission Admin`(하위 `TEAM-QA1`의 `qa.member`까지), 개인 `ops.member` → `Operations`, 개인 `prod.member` → 권한 `system.view`(역할 없이 직접).

권한 라벨(i18n `permission.<key>`): `permission.manage` Manage permissions / 권한 관리 · `directory.sync` Run directory sync / 직원 동기화 실행 · `ai.admin` Manage AI / AI 관리 · `system.view` View system status / 시스템 상태 보기.

---

### Task 1: 저장소 규칙·문서 골격

**Files:**
- Create: `.gitattributes`(bpm 그대로), `CHANGELOG.md`, `docs/README.md`, `docs/lessons/README.md`, `docs/lessons/react-ts-patterns.md`, `docs/lessons/browser-verification.md`
- Modify: `.gitignore`, `CLAUDE.md`, `README.md`, `PROGRESS.md`, `rules/guidelines.md`, `rules/common/git.md`, `rules/common/documentation.md`, `rules/backend/config.md`, `rules/backend/docker.md`, `rules/languages/python.md`, `rules/languages/typescript.md`
- Delete: `docs/template/README.md`, `docs/template/USAGE.md`
- Keep as-is: `rules/frontend/identifiers.md`(템플릿판, `data-testid`), `rules/common/{comments,naming,security,error-handling,dependencies,testing}.md`, `rules/backend/sync-checklist.md`, `.claude/`

**Interfaces:**
- Produces: CLAUDE.md의 rule import 블록(이후 태스크는 Commands·Architecture·Ops 섹션만 채운다), `docs/lessons/react-ts-patterns.md` §7(`useEffectEvent`)·§8(`<Activity>`) — `rules/languages/typescript.md`가 이 번호로 참조한다.

- [ ] **Step 1: rules 교체** — 위 Modify 목록의 rules 파일을 bpm `rules/` 같은 경로 파일로 덮어쓴 뒤 일반화: bpm 고유 낱말(맵·노드·캔버스·`page.tsx` 12,500줄 등) 예시는 지우거나 일반 예시로, `git.md` "On Main Merge"의 `env.BPM_APP_VERSION` → `env.APP_VERSION`, "main" = `Nocharm/sop-archivist`의 `main`.
- [ ] **Step 2: lessons 이식** — bpm `docs/lessons/react-ts-patterns.md`(§ 번호 유지, 캔버스 전용 예시만 일반화)와 `docs/lessons/browser-verification.md`(Playwright+시스템 Chrome·dev.db 오염 함정, 맵 시드 부분 삭제)를 복사. `docs/lessons/README.md`에 두 파일 한 줄씩.
- [ ] **Step 3: CLAUDE.md** — 템플릿 seed 주석 삭제. 섹션: Project(한 줄 설명 + 상태 "v0.1.0 기반 세팅 진행 중", spec 링크) · Working Style(`@rules/guidelines.md`) · Rules(common 8종, backend 3종, `@rules/frontend/identifiers.md`, languages 2종) · Operations/Deployment 제약 표(spec §3 표의 행 그대로). Commands·Architecture는 Task 12에서 채운다는 한 줄.
- [ ] **Step 4: 나머지 파일** — `README.md` 한 줄 소개 + spec 링크. `PROGRESS.md`는 템플릿 항목을 지우고 2026-11-04 항목만 남김. `CHANGELOG.md` 머리말 + `## Unreleased`. `docs/README.md` 인덱스(spec, plans, lessons). `.gitignore`에 `.env`, `*.env.local`, `.venv/`, `__pycache__/`, `*.db`, `node_modules/`, `.next/`, `backups/`, `.shots/`, `test_*.db` 추가.
- [ ] **Step 5: 검사**

Run: `git grep -nE "syntax=docker|BPM_APP_VERSION|bpm\.(devUser|lang)" -- rules CLAUDE.md docs/lessons; git grep -nE "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b" | grep -vE "\b(10|172|127|0)\."`
Expected: 두 명령 모두 출력 없음.

- [ ] **Step 6: Commit** — `chore(repo): set up SOP Archivist rules and docs skeleton — 저장소 규칙·문서 골격`, push.

---

### Task 2: backend 기반 — 설정·KST 시각·DB·Alembic·헬스

**Files:**
- Create: `backend/requirements.txt`, `backend/requirements-dev.txt`, `backend/ruff.toml`, `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/script.py.mako`, `backend/alembic/versions/0001_initial.py`, `backend/app/__init__.py`, `backend/app/settings.py`, `backend/app/clock.py`, `backend/app/db.py`, `backend/app/models.py`, `backend/app/main.py`
- Test: `backend/tests/conftest.py`, `backend/tests/test_settings.py`, `backend/tests/test_clock.py`, `backend/tests/test_db.py`, `backend/tests/test_migrations.py`, `backend/tests/test_health.py`

**Interfaces:**
- Produces:
  - `app.settings.settings: Settings` — 필드(기본값): `database_url="sqlite+aiosqlite:///./dev.db"`, `auth_mode="dev"`, `keycloak_issuer=""`, `keycloak_audience=""`, `keycloak_client_id=""`, `dev_user="dev.admin"`, `app_sysadmins=""`, `dev_enforce_permissions=False`, `ai_enabled=False`, `ai_base_url=""`, `ai_api_token=""`, `ai_model=""`, `ai_timeout_seconds=60`, `ai_max_tokens=8000`, `ai_endpoints=""`, `ai_max_concurrency=4`, `n8n_hr_url=""`, `n8n_hr_token=""`, `hr_sync_interval_hours=24`, `hr_sync_delete_cap_pct=20`, 비즈니스 상수 `org_trim_levels: int = 2`(env 없음). 메서드 `resolved_auth_mode() -> Literal["keycloak", "dev"]`, `sysadmin_login_ids() -> set[str]`, 프로퍼티 `hr_enabled -> bool`.
  - `app.clock.KST`, `app.clock.now() -> datetime`
  - `app.db.Base`, `app.db.engine`, `app.db.SessionLocal`, `async def get_session() -> AsyncGenerator[AsyncSession, None]`, `def run_migrations(database_url: str | None = None) -> None`
  - `app.models._now() -> datetime`(타임스탬프 컬럼 default)
  - `app.main.app`, `lifespan`에서 `await asyncio.to_thread(run_migrations)` — Alembic async env.py가 `asyncio.run`을 쓰므로 실행 중 루프 안에서 직접 부르면 실패한다.
  - `tests/conftest.py`: import 전에 env 고정(`DATABASE_URL`=임시 sqlite 파일 `test_sopa.db`, `AUTH_MODE=dev`, `DEV_ENFORCE_PERMISSIONS=false`, `APP_SYSADMINS=""`, `AI_ENABLED=false`, `N8N_HR_URL=""`), 픽스처 `client`(lifespan 포함 TestClient, session scope), `enforce`(테스트 동안 `settings.dev_enforce_permissions=True`).

- [ ] **Step 1: venv·의존성** — `requirements.txt`는 Tech Stack의 backend 런타임 패키지 + `alembic`(정확 버전 고정), dev는 `-r requirements.txt` + pytest·ruff. `cd backend && /opt/homebrew/bin/python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`
- [ ] **Step 2: 실패 테스트 작성**

```python
# test_settings.py
def test_auth_mode_defaults_to_dev(): assert Settings(auth_mode="").resolved_auth_mode() == "dev"
def test_auth_mode_case_insensitive(): assert Settings(auth_mode="KEYCLOAK").resolved_auth_mode() == "keycloak"
def test_auth_mode_rejects_ldap(): pytest.raises(ValueError, Settings(auth_mode="ldap").resolved_auth_mode)
def test_sysadmins_parsed(): assert Settings(app_sysadmins=" a , b,").sysadmin_login_ids() == {"a", "b"}
def test_hr_enabled_needs_url_and_token(): assert not Settings(n8n_hr_url="x").hr_enabled and Settings(n8n_hr_url="x", n8n_hr_token="t").hr_enabled
# test_clock.py
def test_now_is_kst(): assert now().utcoffset() == timedelta(hours=9)
# test_db.py
async def test_sqlite_foreign_keys_on(): assert (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar() == 1
# test_migrations.py
def test_upgrade_head_on_empty_sqlite(tmp_path): run_migrations(f"sqlite+aiosqlite:///{tmp_path}/m.db"); assert "alembic_version" in table_names
def test_models_match_migrations(tmp_path): ...; assert compare_metadata(migration_context, Base.metadata) == []
# test_health.py
def test_health(client): assert client.get("/api/health").json() == {"status": "ok"}
```

`test_models_match_migrations`는 이후 모든 태스크에서 "모델만 고치고 마이그레이션을 빠뜨림"을 잡는 가드다.

- [ ] **Step 3: 실패 확인** — `.venv/bin/python -m pytest tests/ -q` → ImportError/FAIL.
- [ ] **Step 4: 구현** — `settings.py`는 bpm `backend/app/settings.py`에서 위 필드만 남김(ldap·embed·interview·csv·manual·`bpm_sysadmins`·`system_admin_login_ids` 제거). `clock.py`는 bpm 그대로. `db.py`: 엔진·세션 + sqlite일 때 `engine.sync_engine` `connect` 이벤트로 `PRAGMA foreign_keys=ON`. Alembic은 `alembic init -t async alembic` 골격, `env.py`는 `config.get_main_option("sqlalchemy.url")`이 있으면 그것, 없으면 `settings.database_url`, `render_as_batch=True`, `target_metadata = Base.metadata`. 리비전 id는 `"0001"`, `"0002"`… 순번 문자열. `0001_initial.py`는 빈 업그레이드.
- [ ] **Step 5: 통과 확인** — `.venv/bin/python -m pytest tests/ -q` 전부 PASS, `.venv/bin/ruff check app/ tests/` 0건.
- [ ] **Step 6: Commit** — `feat(backend): add settings, KST clock, DB and Alembic migrations — 백엔드 기반(설정·KST 시각·DB·Alembic)`, push.

---

### Task 3: 인증 — Keycloak(발급처 검사)·dev

**Files:**
- Create: `backend/app/auth.py`, `backend/app/routers/__init__.py`, `backend/app/routers/auth.py`
- Modify: `backend/app/main.py`(라우터 등록)
- Test: `backend/tests/test_auth.py`, `backend/tests/test_auth_mode.py`

**Interfaces:**
- Consumes: `settings`(Task 2)
- Produces:
  - `get_current_user(authorization: str | None = Header(None), x_dev_user: str | None = Header(None)) -> str` — 모든 보호 라우트의 의존성. dev: `x_dev_user or settings.dev_user`. keycloak: Bearer 없으면 401 `"missing bearer token"`, `X-Dev-User` 무시.
  - `_decode_keycloak_token(token: str) -> str` — bpm 그대로(RS256, issuer, `audience` 비면 aud 검증 생략) + **`claims.get("azp") != settings.keycloak_client_id` → 401 `"token was issued to another client"`**. 반환은 `preferred_username` 없으면 `sub`.
  - `GET /api/auth/mode`(무인증) → `{"mode": ..., "keycloakIssuer": ..., "keycloakClientId": ...}`(키는 이식할 프런트 lib에 맞춰 camelCase)

- [ ] **Step 1: 실패 테스트 작성** — RSA 키는 `cryptography`로 만들고 `pyjwt`로 서명, `monkeypatch.setattr("app.auth._jwk_client", lambda: stub)`(stub의 `get_signing_key_from_jwt`가 `.key`를 가진 객체 반환), keycloak 케이스는 `settings`를 monkeypatch(`auth_mode="keycloak"`, issuer·client_id 설정).

```python
def test_dev_uses_header(): assert get_current_user(None, "qa.lead") == "qa.lead"
def test_dev_falls_back_to_dev_user(): assert get_current_user(None, None) == "dev.admin"
def test_keycloak_requires_bearer(): status 401, detail "missing bearer token"
def test_keycloak_ignores_dev_header(): get_current_user(None, "qa.lead") -> 401
def test_keycloak_valid_token(): token(azp=client_id, preferred_username="qa.lead") -> "qa.lead"
def test_keycloak_rejects_other_client(): token(azp="bpm-frontend") -> 401, detail "token was issued to another client"
def test_keycloak_rejects_wrong_issuer(): -> 401
def test_keycloak_rejects_expired(): -> 401
def test_keycloak_audience_checked_only_when_set(): audience="" & aud="x" -> ok; audience="api" & aud="x" -> 401
# test_auth_mode.py
def test_mode_dev_by_default(client): assert client.get("/api/auth/mode").json()["mode"] == "dev"
def test_mode_keycloak_exposes_issuer(client, monkeypatch): json == {"mode": "keycloak", "keycloakIssuer": ISS, "keycloakClientId": CID}
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_auth.py tests/test_auth_mode.py -q` → FAIL.
- [ ] **Step 3: 구현** — bpm `backend/app/auth.py`·`routers/auth.py`를 port: ldap 분기·`tokens`·`require_sysadmin`·`/login` 제거, azp 검사 추가.
- [ ] **Step 4: 통과 확인** — 전체 `pytest -q` PASS, ruff 0건.
- [ ] **Step 5: Commit** — `feat(auth): add Keycloak (client-checked) and dev authentication — 인증(keycloak 발급처 검사·dev)`, push.

---

### Task 4: 직원 디렉터리·HR 웹훅 동기화

**Files:**
- Modify: `backend/app/models.py`(Employee, Department, HrSyncRun, BatchJobRun), `backend/app/main.py`(lifespan: dev 시드·스케줄러, 라우터)
- Create: `backend/alembic/versions/0002_directory.py`, `backend/app/hr/__init__.py`, `backend/app/hr/client.py`, `backend/app/hr/service.py`, `backend/app/hr/history.py`, `backend/app/hr/scheduler.py`, `backend/app/batch_runs.py`, `backend/app/orgchart.py`, `backend/app/dev_users.py`, `backend/app/routers/directory.py`
- Test: `backend/tests/hr_sync_helpers.py`, `test_hr_client.py`, `test_hr_mapping.py`, `test_hr_sync.py`, `test_hr_active_filter.py`, `test_hr_sync_history.py`, `test_hr_scheduler.py`, `test_orgchart.py`, `test_dev_users.py`, `test_directory.py`

**Interfaces:**
- Consumes: `Base`, `_now`, `get_session`, `SessionLocal`, `settings`, `get_current_user`
- Produces:
  - 모델: `Employee`(bpm에서 `title`·`role`·`position` 제거, `source: String(10)` 기본 `"hr"`, 값 `"hr"|"dev"`) · `Department`(bpm 그대로) · `HrSyncRun`(bpm 그대로) · `BatchJobRun`(bpm 그대로, job 값 `"hr_sync"`·`"db_backup"`)
  - `app.hr.service`: `async def run_full_sync(session) -> HrSyncSummary`, `async def sync_one(session, login_id: str) -> Employee | None`, `async def build_sync_preview(session) -> HrSyncPreview`, `class SyncTooSoon(Exception)`
  - `app.hr.scheduler`: `HR_SYNC_STARTUP_GRACE_SECONDS = 300`, `get_first_hr_sync_delay(last_ran_at: datetime | None, now: datetime, interval_seconds: float) -> float`, `async def run_hr_sync_loop() -> None`
  - `app.batch_runs`: `JOB_HR_SYNC`, `JOB_DB_BACKUP`, `async def record_batch_run(session, job: str, outcome: str, detail: str | None) -> None`
  - `app.orgchart`: `DeptIndex`, `async def load_dept_index(session) -> DeptIndex`, `resolve_org_path(emp, index) -> str`, **`get_dept_chain_codes(index: DeptIndex, dept_code: str | None) -> list[str]`**(리프→루트, 모르는 코드면 `[]`, 부모 단절이면 닿은 데까지, 순환이면 반복 직전까지, 최대 15)
  - `app.dev_users`: `DEV_DEPARTMENTS`, `DEV_USERS`(공용 데이터 표), `async def seed_dev_directory(session) -> None`(없을 때만 넣음, `source="dev"`)
  - `GET /api/directory?q=&limit=20`(인증 필요, `limit` 최대 50, 재직자만, login_id·name·korean_name·department 대소문자 무시 부분 일치) → `list[{login_id, name, korean_name, department, dept_code, dept_path}]`
  - `GET /api/departments`(인증 필요) → `list[{dept_code, parent_dept_code, name, name_ko, level}]`

- [ ] **Step 1: 테스트 이식·작성** — bpm `backend/tests/`의 `hr_sync_helpers.py`, `test_hr_client.py`, `test_hr_mapping.py`, `test_hr_sync.py`, `test_hr_active_filter.py`, `test_hr_sync_history.py`, `test_hr_scheduler.py`, `test_orgchart.py`를 복사하고 제거 필드(title·role·position·local/ad source·로컬 sysadmin 회수·EDW 직책) 관련 케이스만 지운다. 가드 케이스(건수 불일치 중단·빈 피드 중단·삭제 상한 20% 중단 시 DB 무변경, 500건 청크, 퇴직자 `active=false`, 대량 퇴직 경고 5%·10명, 회차 200건 보존)는 반드시 남긴다. 새로 쓰는 것:

```python
def test_get_dept_chain_codes_normal(): assert get_dept_chain_codes(idx, "TEAM-QA1") == ["TEAM-QA1", "DIV-QA", "CORP"]
def test_get_dept_chain_codes_unknown(): assert get_dept_chain_codes(idx, "NOPE") == [] and get_dept_chain_codes(idx, None) == []
def test_get_dept_chain_codes_broken_parent(): # TEAM-X.parent = "GONE"
    assert get_dept_chain_codes(idx, "TEAM-X") == ["TEAM-X"]
def test_get_dept_chain_codes_cycle(): # A.parent=B, B.parent=A
    assert get_dept_chain_codes(idx, "A") == ["A", "B"]
def test_sync_never_deletes_dev_rows(): # dev 시드 후 빈 아닌 HR 피드로 전체 동기화 → source="dev" 행 그대로
async def test_seed_dev_directory_idempotent(): 두 번 호출 → employees 5행, departments 7행
def test_directory_matches_korean_name(client): q="품질" → login_id {"qa.lead", "qa.member"}
def test_directory_excludes_inactive(client): ...
def test_directory_limit_capped(client): limit=500 → 응답 길이 ≤ 50
def test_departments_list(client): dept_code 집합 == 공용 데이터 표 7개
```

- [ ] **Step 2: 실패 확인** — `pytest tests/ -q -k "hr or orgchart or dev_users or directory"` → FAIL.
- [ ] **Step 3: 구현** — bpm `backend/app/hr/{client,service,history}.py`·`batch_runs.py`·`orgchart.py`를 port: `RawHrPosition`·`fetch_positions`·`parse_position_row`·`_resolve_role`·`HrEmployeeFields.role`·`_revoke_local_sysadmin`·title 패스·ad/local 분기 제거, 삭제 대상은 `source="hr"` 행만. 스케줄러는 bpm `main.py:63-111`을 `hr/scheduler.py`로. lifespan: 마이그레이션 → (dev 모드면) `seed_dev_directory` → (`hr_enabled` 이고 주기 > 0이면) 스케줄러 태스크, 종료 시 cancel. Alembic `0002`는 autogenerate 후 검토.
- [ ] **Step 4: 통과 확인** — 전체 `pytest -q` PASS(Task 2의 `test_models_match_migrations` 포함), ruff 0건.
- [ ] **Step 5: Commit** — `feat(directory): port HR webhook directory sync and org chain — HR 웹훅 직원·부서 동기화 이식`, push.

---

### Task 5: 권한 체계(표 기반)·`/api/me`·로컬 리셋

**Files:**
- Modify: `backend/app/models.py`(Role, RolePermission, AccessGrant, AccessAuditEvent, LoginRecord), `backend/app/main.py`, `backend/app/dev_users.py`(`seed_demo_access`)
- Create: `backend/alembic/versions/0003_access.py`, `backend/app/access/__init__.py`, `catalog.py`, `resolve.py`, `deps.py`, `audit.py`, `backend/app/routers/access.py`, `backend/app/routers/me.py`, `backend/scripts/__init__.py`, `backend/scripts/reset_db.py`
- Test: `backend/tests/test_access_resolve.py`, `test_access_api.py`, `test_me.py`, `test_reset_db.py`

**Interfaces:**
- Consumes: `Employee`, `Department`, `load_dept_index`, `get_dept_chain_codes`, `resolve_org_path`, `sync_one`, `get_current_user`, `settings`, `now`
- Produces:
  - 모델: `Role`(id, `name` String(100) unique, `description` String(500) 기본 `""`, created_at, updated_at) · `RolePermission`(PK(`role_id` FK roles.id ON DELETE CASCADE, `permission` String(100))) · `AccessGrant`(id, `subject_type` String(10) `"user"|"dept"`, `subject_id` String(100), `role_id` FK roles.id ON DELETE RESTRICT nullable, `permission` String(100) nullable, `created_by` String(100), created_at, CheckConstraint "role_id·permission 중 정확히 하나") · `AccessAuditEvent`(id, `occurred_at` index, `actor` String(100), `action` String(30), `detail` JSON) · `LoginRecord`(bpm 그대로)
  - `app.access.catalog`: `PERMISSIONS: tuple[str, ...] = ("permission.manage", "directory.sync", "ai.admin", "system.view")`, `is_known_permission(key: str) -> bool`
  - `app.access.resolve`: `is_sysadmin(login_id: str) -> bool`, `AccessSource(kind: Literal["user", "dept"], subject_id: str, role: str | None)`, `EffectiveAccess(login_id: str, known: bool, active: bool, is_sysadmin: bool, permissions: frozenset[str], sources: dict[str, tuple[AccessSource, ...]])`, `async def get_effective_access(session, login_id: str) -> EffectiveAccess`
  - `app.access.deps`: `require_permission(permission: str) -> Callable[..., Awaitable[str]]`(FastAPI 의존성, login_id 반환, 없으면 403 `"missing permission: <key>"`)
  - `app.access.audit`: `ACTIONS = ("role.create", "role.update", "role.delete", "grant.add", "grant.remove")`, `add_audit_event(session, actor: str, action: str, detail: dict) -> None`(세션에 추가만, 커밋은 호출부와 같은 트랜잭션)
  - `subject_name`은 API가 채운다: 개인은 `Employee.name`, 부서는 `Department.name`, 없으면 `""`이고 `subject_missing=True`.
  - API `/api/access/*`(전부 `permission.manage`): `GET catalog` → `list[str]` · `GET roles` → `list[RoleOut{id, name, description, permissions: list[str], grant_count: int}]` · `POST roles` 201 · `PUT roles/{id}` · `DELETE roles/{id}` 204 · `GET grants` → `list[GrantOut{id, subject_type, subject_id, subject_name, subject_missing: bool, role_id, role_name, permission, created_by, created_at}]` · `POST grants` 201 · `DELETE grants/{id}` 204 · `GET audit?limit=100`(최대 500, 최신순) · `GET effective/{login_id}` → `EffectiveOut{login_id, known, active, is_sysadmin, permissions: list[str] 정렬, sources: dict[str, list[{kind, subject_id, subject_name, role}]]}`
  - 오류 문구: 역할 이름 중복 409 `"role name already exists"`, 모르는 권한 422 `"unknown permission: <key>"`, 대상 없음 422 `"unknown subject"`, role·permission 둘 다/둘 다 없음 422, 중복 부여 409 `"grant already exists"`(NULL 컬럼이 섞여 DB unique로는 못 막으므로 API에서 검사), 부여 남은 역할 삭제 409 `"role is still granted"`
  - `GET /api/me` → `MeOut{login_id, name, korean_name, department, dept_path, is_sysadmin, permissions: list[str], auth_mode, ai_enabled}`. login_records는 KST 하루 1인 1행(bpm `get_me`의 `day_start`), `auth_mode != "dev"` 이고 `hr_enabled`면 먼저 `sync_one`.
  - `app.dev_users.seed_demo_access(session) -> None` — 공용 데이터의 데모 역할 2개·부여 3건을 없을 때만 넣는다(테스트 픽스처와 `reset_db`가 공유, lifespan은 부르지 않음).
  - `python -m scripts.reset_db`(backend/에서) — Alembic base로 내렸다 head로 올림 → `seed_dev_directory` → `seed_demo_access`. postgres이고 `source="hr"` 직원이 있으면 `"refusing to reset"`으로 종료 코드 1.

판정 규칙(`get_effective_access`): ① `is_sysadmin` → `permissions = PERMISSIONS 전부`, ② dev 모드이고 `dev_enforce_permissions` 꺼짐 → ①과 같음, ③ 직원 없음 → `known=False`, 권한 없음, ④ `active=False` → 권한 없음, ⑤ 그 외 → (`user`, login_id) 부여 ∪ (`dept`, `get_dept_chain_codes(직원.dept_code)`의 각 코드) 부여, 역할은 `RolePermission`으로 펼치고 카탈로그에 없는 키는 버린다.

- [ ] **Step 1: 실패 테스트 작성**

```python
# test_access_resolve.py (enforce 픽스처, dev 시드 + 공용 데모 권한)
def test_resolve_dept_grant_inherits_to_subteam(): qa.member → {"permission.manage"}, source kind "dept", subject_id "DIV-QA", role "Permission Admin"
def test_resolve_user_role_grant(): ops.member → {"directory.sync", "system.view", "ai.admin"}
def test_resolve_direct_permission_grant(): prod.member → {"system.view"}, source role None
def test_resolve_union_dedupes(): 같은 권한을 개인·부서로 둘 다 → permissions에 1번, sources에 2개
def test_resolve_inactive_employee_has_nothing(): active=False → permissions == frozenset(), active False
def test_resolve_unknown_employee(): "ghost" → known False, permissions 빈 집합, 예외 없음
def test_resolve_unknown_dept_keeps_user_grants(): dept_code="GONE" + 개인 부여 → 개인 부여만
def test_resolve_dept_cycle_terminates(): 부서 순환 → 반환됨(무한루프 없음)
def test_resolve_sysadmin_env(): APP_SYSADMINS=prod.member → is_sysadmin True, 4권한 전부
def test_resolve_dev_unenforced_is_sysadmin(): enforce 끔 → is_sysadmin True
# test_access_api.py (enforce)
def test_access_requires_permission_manage(client): X-Dev-User=prod.member → GET /api/access/roles 403 "missing permission: permission.manage"
def test_create_role_writes_audit(client): qa.lead POST roles → 201, audit 최신 action "role.create"
def test_create_role_unknown_permission(client): → 422
def test_duplicate_role_name(client): → 409
def test_add_dept_grant_and_duplicate(client): 201 → 같은 요청 409, audit "grant.add"
def test_add_grant_unknown_subject(client): → 422 "unknown subject"
def test_delete_role_still_granted(client): → 409; 부여 삭제 후 → 204, audit "grant.remove"·"role.delete"
def test_grants_list_marks_missing_department(client): 부여된 부서 행을 departments에서 지움 → 그 부여 subject_missing True, effective에서 무시
def test_manager_can_grant_manage_to_self(client): qa.lead가 자기에게 permission.manage 개인 부여 → 201, audit actor "qa.lead"
def test_effective_endpoint_sources(client): GET effective/qa.member → sources["permission.manage"][0] == {"kind": "dept", "subject_id": "DIV-QA", "subject_name": "Quality Division", "role": "Permission Admin"}
# test_me.py
def test_me_records_login_once_per_day(client): 두 번 호출 → login_records 1행
def test_me_unknown_employee(client, enforce): X-Dev-User=ghost → 200, name "", permissions []
def test_me_permissions_match_effective(client, enforce): qa.lead → ["permission.manage"]
# test_reset_db.py
def test_reset_refuses_postgres_with_hr_rows(): 판정 함수 should_refuse_reset(is_postgres=True, hr_rows=3) is True; (False, 3)·(True, 0) is False
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_access_resolve.py tests/test_access_api.py tests/test_me.py tests/test_reset_db.py -q` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces대로. 모든 변경 API는 변경과 `add_audit_event`를 한 트랜잭션에. `reset_db.py`의 거부 판정은 `should_refuse_reset(is_postgres: bool, hr_rows: int) -> bool`로 분리. Alembic `0003` autogenerate 후 검토(postgres에서 CheckConstraint·FK ondelete 확인).
- [ ] **Step 4: 통과 확인** — 전체 `pytest -q` PASS, ruff 0건, `cd backend && .venv/bin/python -m scripts.reset_db` 후 sqlite에 roles 2행·access_grants 3행.
- [ ] **Step 5: Commit** — `feat(access): add role/permission grants with department inheritance — 표 기반 권한(역할·개인/부서 부여·하위 상속)`, push.

---

### Task 6: 관리 운영 API — HR 동기화·배치 상태

**Files:**
- Create: `backend/app/routers/admin.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_admin_ops.py`

**Interfaces:**
- Consumes: `require_permission`, `run_full_sync`, `build_sync_preview`, `SyncTooSoon`, `HrSyncRun`, `BatchJobRun`
- Produces: `POST /api/admin/hr-sync`(`directory.sync`) → 동기화 요약 JSON · `GET /api/admin/hr-sync/preview`(`directory.sync`) · `GET /api/admin/hr-sync/runs?limit=20`(`directory.sync`, 최대 200, 최신순) · `GET /api/admin/batch-runs`(`system.view`) → `list[{job, outcome, ran_at, detail}]`(job·outcome 순). HR 미설정이면 hr-sync 계열 503 `"HR sync is not configured"`, 너무 잦으면 409 `"sync ran too recently"`. `app/routers/admin.py`의 `router`는 Task 7이 AI 엔드포인트를 덧붙인다.

- [ ] **Step 1: 실패 테스트 작성**

```python
def test_hr_sync_requires_directory_sync(client, enforce): prod.member → 403
def test_hr_sync_unconfigured(client, enforce): ops.member, N8N 미설정 → 503 "HR sync is not configured"
def test_hr_sync_runs_and_records(client, enforce, monkeypatch): hr 설정 + client.fetch_all_employees/fetch_departments 모의 → 200, batch_job_runs ("hr_sync","success") 존재, hr_sync_runs 1행 증가
def test_hr_sync_too_soon(client, enforce, monkeypatch): 연속 2회 → 두 번째 409
def test_batch_runs_requires_system_view(client, enforce): qa.lead → 403, prod.member → 200
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_admin_ops.py -q` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces대로.
- [ ] **Step 4: 통과 확인** — 전체 `pytest -q` PASS, ruff 0건.
- [ ] **Step 5: Commit** — `feat(admin): expose HR sync and batch status to permitted users — 관리 운영 API(HR 동기화·배치 상태)`, push.

---

### Task 7: 사내 AI 연결·사용량·ping

**Files:**
- Create: `backend/app/ai_client.py`, `backend/app/ai_usage.py`, `backend/alembic/versions/0004_ai_usage.py`, `frontend/scripts/fake-ai-server.mjs`
- Modify: `backend/app/models.py`(AiUsageEvent), `backend/app/routers/admin.py`
- Test: `backend/tests/test_ai_client.py`, `backend/tests/test_ai_admin.py`

**Interfaces:**
- Consumes: `settings`, `require_permission`, `get_session`, `now`
- Produces:
  - `app.ai_client`: bpm 그대로 — `AiReasoning = Literal["high", "low"]`, `AiReply(content: str, prompt_tokens: int | None, completion_tokens: int | None)`, `get_ai_endpoints() -> list[AiEndpoint]`(`AI_ENDPOINTS` JSON 배열, 비면 `AI_BASE_URL` 단일), `async def call_ai(messages: list[dict], model: str | None = None, *, reasoning: AiReasoning | None = None, max_tokens: int | None = None) -> AiReply`, `async def list_models() -> list[str]`
  - 모델 `AiUsageEvent`(id, `occurred_at` index, `login_id` String(100) index, `feature` String(50), `model` String(200) 기본 `""`, `prompt_tokens`·`completion_tokens` int nullable, `ok` bool)
  - `app.ai_usage`: `async def call_ai_recorded(session, *, login_id: str, feature: str, messages: list[dict], model: str | None = None, reasoning: AiReasoning | None = None, max_tokens: int | None = None) -> AiReply` — 성공·실패 모두 `AiUsageEvent` 1행을 남기고 커밋, 실패는 예외 재전파
  - `POST /api/admin/ai/ping`(`ai.admin`) → `{ok: true, model: str, latency_ms: int, reply_ok: bool}`. AI 꺼짐 503 `"AI is disabled"`, 상류 오류 502 `"AI endpoint error: <HTTP 상태 또는 예외 클래스명>"`(URL·토큰 미포함). 호출은 `feature="ping"`, `reasoning="low"`, `max_tokens=256`, 시스템 메시지 "Reply with the JSON object {\"ok\": true}.", 사용자 메시지 "ping" — 직원 정보 없음. `reply_ok`는 응답을 JSON으로 읽어 `ok is True`인지.
  - `GET /api/admin/ai/usage?days=30`(`ai.admin`, 1..365) → KST 날짜별 `list[{date, calls, failed, prompt_tokens, completion_tokens}]`
  - `fake-ai-server.mjs`(:9999): `/v1/chat/completions`는 `{"ok": true}` content와 usage를, `/v1/models`는 모델 1개를 돌려주는 OpenAI 호환 가짜 서버. 로컬에서 `AI_BASE_URL=http://localhost:9999/v1`.

- [ ] **Step 1: 실패 테스트 작성** — bpm에 `call_ai` 테스트가 있으면 이식(`grep -l call_ai ../bpm/backend/tests/*.py`), httpx2 전송은 모의.

```python
def test_payload_low_reasoning(): payload["chat_template_kwargs"] == {"reasoning_effort": "low", "clear_thinking": True}
def test_payload_max_reasoning_omits_kwargs(): "chat_template_kwargs" not in payload
def test_null_content_becomes_empty(): message.content None → reply.content == ""
def test_endpoints_json_and_selector(): AI_ENDPOINTS 2개 → call_ai(model="b::m2")가 b의 base_url로 model "m2" 전송
def test_concurrency_limit(): ai_max_concurrency=1에서 동시 2호출 → 동시 진입 최대 1
# test_ai_admin.py (enforce)
def test_ai_ping_requires_ai_admin(client): qa.lead → 403
def test_ai_ping_disabled(client): ops.member, AI_ENABLED false → 503 "AI is disabled"
def test_ai_ping_success_records_usage(client, monkeypatch): → 200, reply_ok True, ai_usage_events 최신 행 ok True·feature "ping"·tokens 기록
def test_ai_ping_upstream_error_records_failure(client, monkeypatch): call_ai가 HTTP 500 → 502, detail에 base_url·토큰 문자열 없음, 사용량 행 ok False
def test_ai_usage_daily(client): 이벤트 3건(하루 2·다른 날 1, 실패 1) → 날짜별 calls/failed 일치
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_ai_client.py tests/test_ai_admin.py -q` → FAIL.
- [ ] **Step 3: 구현** — bpm `backend/app/ai_client.py` 복사(도메인 결합 없음), 나머지는 위 Interfaces대로. 가짜 서버는 bpm `frontend/scripts/fake-ai-server.mjs`에서 bpm 프롬프트별 응답을 걷어 낸 최소판.
- [ ] **Step 4: 통과 확인** — 전체 `pytest -q` PASS, ruff 0건.
- [ ] **Step 5: Commit** — `feat(ai): connect in-house GLM with usage metering and admin ping — 사내 GLM 연결·사용량 기록·관리 ping`, push.

---

### Task 8: frontend 기반 — Next 골격·사내 공용 lib

**Files:**
- Create: `frontend/package.json`, `frontend/package-lock.json`, `frontend/next.config.ts`, `frontend/tsconfig.json`, `frontend/eslint.config.mjs`, `frontend/postcss.config.mjs`, `frontend/vitest.config.ts`, `frontend/AGENTS.md`, `frontend/src/app/globals.css`, `frontend/src/lib/{id,clipboard,auth-mode,auth-return,dev-auth,api,api-errors,datetime,download-name}.ts`, `frontend/src/lib/i18n.tsx`, `frontend/src/lib/i18n-messages.ts`
- Test: `frontend/src/lib/{api,api-errors,auth-mode,auth-return,download-name,i18n-messages}.test.ts`

**Interfaces:**
- Produces:
  - `package.json`: `"name": "sop-archivist-frontend"`, `"version": "0.1.0"`, scripts `dev: next dev -p 3777`, `build`, `start`, `lint`, 의존성은 Tech Stack의 frontend 항목만(bpm `frontend/package.json`과 같은 범위 지정자).
  - `next.config.ts`: `output: "standalone"`, `env: { APP_VERSION: version }`, `/api/:path*` → `${process.env.BACKEND_URL ?? "http://localhost:8777"}/api/:path*` rewrite, `turbopack.root` = frontend 디렉터리(이 맥의 `~/package.json` 때문에 루트를 홈으로 오인하던 bpm 문제를 `--webpack` 없이 해소).
  - `genId(): string` · `copyText(text: string): Promise<boolean>`(bpm 그대로)
  - `auth-mode.ts`: `AuthMode = "keycloak" | "dev"`, `AuthModeInfo {mode, keycloakIssuer, keycloakClientId}`, `fetchAuthMode()`, `getCachedAuthMode()`(실패 시 keycloak으로 fail-closed, 실패는 캐시 안 함)
  - `auth-return.ts`: bpm 그대로, 키 접두 `sopa.`
  - `dev-auth.ts`: `LocalUser {loginId, name, koreanName, department}`, `LOCAL_USERS`(공용 데이터 표, department는 name 열), `getStoredDevUser()`, `storeDevUser(loginId: string | null)`(키 `sopa.devUser`)
  - `api.ts`: `class ApiError extends Error { status: number; detail: string }`, `setAuthToken(token: string | null): void`, `async function apiFetch<T>(path: string, init?: RequestInit): Promise<T>` — 토큰 있으면 `Authorization: Bearer`, 없고 dev 사용자가 저장돼 있으면 `X-Dev-User`. 오류 응답의 `detail`이 배열(422)이면 각 `msg`를 `"; "`로 합침. 204는 `undefined`.
  - `api-errors.ts`: `humanizeApiError(err: unknown, t: TFunc): string` — 401·403·409·422·502·503·네트워크 오류를 `error.*` 키로, 그 외 `error.unknown`. bpm 도메인 접두 상수 제거.
  - `i18n.tsx`: `LangProvider`, `useI18n(): { lang: "en" | "ko"; setLang(lang): void; t(key: string, vars?: Record<string, string | number>): string }`, 키 `sopa.lang`, 기본 `"en"`. `i18n-messages.ts`: `MESSAGES: { en: Record<string, string>; ko: Record<string, string> }`(권한 라벨 4종 포함).
  - `datetime.ts`: `formatKst`, `formatKstShort`, `relativeAgo`(bpm 그대로) · `download-name.ts`: bpm 그대로, 파일 이름 접두 `sop-archivist`.
  - `AGENTS.md`: bpm `frontend/AGENTS.md`에서 "This is NOT the Next.js you know" 블록 + 일반 함정(React Compiler 메모이제이션, set-state-in-effect, Tailwind display 이중 지정, KST, genId, zsh `--include` 따옴표)만. 에디터·ParamInput·exceljs·COMPONENTS.md 항목 제외.
  - `globals.css`: Tailwind 4 `@theme`에 `--color-accent` 1색 + 중립 회색 단계, 흰 바탕. raw hex는 이 토큰 정의 안에서만.

- [ ] **Step 1: 실패 테스트 작성** — bpm `frontend/src/lib/{api-errors,auth-mode,auth-return,download-name}.test.ts` 이식(ldap·도메인 케이스 제거), 새로:

```ts
test("apiFetch sends bearer when token set", ...)              // headers.Authorization === "Bearer t"; X-Dev-User 없음
test("apiFetch sends X-Dev-User without token", ...)          // localStorage sopa.devUser="qa.lead" → headers["X-Dev-User"] === "qa.lead"
test("apiFetch throws ApiError with status and detail", ...)  // 403 {"detail":"missing permission: ai.admin"} → status 403, detail 그대로
test("apiFetch joins validation detail", ...)                 // 422 detail [{msg:"a"},{msg:"b"}] → detail "a; b"
test("en and ko message keys match", ...)                     // Object.keys(MESSAGES.en).sort() 와 ko 동일
```

- [ ] **Step 2: 실패 확인** — `cd frontend && npm install && npx vitest run` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces대로(bpm 파일 port).
- [ ] **Step 4: 게이트** — `npx vitest run` PASS · `npx tsc --noEmit -p tsconfig.json` 0 · `npm run lint` 0 · `npm run build` 경고 0 · `npm run dev`가 3777에서 뜨고 로그에 workspace root 추론 경고 없음(확인 후 종료).
- [ ] **Step 5: Commit** — `feat(frontend): scaffold Next.js app with ported in-house libs — 프런트 기반·사내 공용 lib 이식`(next dev가 만든 `AGENTS.md` 변경 포함), push.

---

### Task 9: 로그인·상단 바·홈 + 스모크 하네스

**Files:**
- Create: `frontend/src/components/providers.tsx`, `frontend/src/lib/keycloak-login.ts`, `frontend/src/lib/access.ts`, `frontend/src/app/layout.tsx`, `frontend/src/app/page.tsx`, `frontend/src/app/login/page.tsx`, `frontend/src/components/top-bar.tsx`, `frontend/src/components/dev-user-switcher.tsx`, `frontend/scripts/pw-smoke-baseline.mjs`
- Modify: `frontend/src/lib/api.ts`(`getMe`), `frontend/src/lib/i18n-messages.ts`
- Test: `frontend/src/lib/access.test.ts`

**Interfaces:**
- Consumes: Task 8 lib 전부, `GET /api/me`, `GET /api/auth/mode`
- Produces:
  - `api.ts`: `interface Me { login_id: string; name: string; korean_name: string; department: string; dept_path: string; is_sysadmin: boolean; permissions: string[]; auth_mode: "keycloak" | "dev"; ai_enabled: boolean }`, `getMe(): Promise<Me>`
  - `access.ts`: `PERMISSIONS`(backend 카탈로그와 같은 4개, 같은 순서), `hasPermission(me: Me, key: string): boolean`(sysadmin이면 true), `canSeeAdmin(me: Me): boolean`(4개 중 하나라도)
  - `keycloak-login.ts`: bpm 그대로(`disablePKCE: true`, silent SSO `prompt=none`, `signoutAllSessions`), ldap 분기 제거
  - `providers.tsx`: bpm에서 `LangProvider` + keycloak 모드일 때 OIDC `AuthProvider`(authority=`keycloakIssuer`, client_id=`keycloakClientId`, redirect_uri=`${origin}/login`) + 토큰을 `setAuthToken`으로 연결 + 미로그인 시 `/login`(returnTo 저장)만 남긴다.
  - 화면 `data-testid`: `top-bar-service`("SOP Archivist") · `top-bar-version`(`v${process.env.APP_VERSION}`) · `top-bar-user`(이름 + 부서) · `top-bar-lang` · `top-bar-admin-link`(`canSeeAdmin`일 때만) · `top-bar-signout` · `dev-user-switcher`(dev 모드만, `LOCAL_USERS`) · `login-keycloak` · `login-dev-user-<loginId>` · `home-identity` · `home-permissions`(권한 라벨 목록, 없으면 `home-permissions-empty`) · `home-ai-status`
  - `pw-smoke-baseline.mjs`: `playwright-core`(`npm i --no-save playwright-core`), 시스템 Chrome(`CHROME_PATH` 환경 변수, 기본 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`), `BASE_URL` 기본 `http://localhost:3777`, 산출물 `../.shots/baseline-*.png`, 실패 시 종료 코드 1. Task 10이 시나리오를 덧붙인다.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test("sysadmin has every permission", ...)      // hasPermission({...me, is_sysadmin: true, permissions: []}, "ai.admin") === true
test("admin visible with any permission", ...)  // canSeeAdmin({...me, permissions: ["system.view"]}) === true
test("admin hidden without permissions", ...)   // canSeeAdmin({...me, permissions: []}) === false
test("PERMISSIONS matches backend order", ...)  // toEqual(["permission.manage","directory.sync","ai.admin","system.view"])
```

스모크 1차 시나리오: 로컬 스택(아래 Step 4)에서 `sopa.devUser=qa.lead` → `/` → `top-bar-version` == `v0.1.0`, `top-bar-user`에 "QA Lead", `home-permissions`에 "Manage permissions", 스크린샷 `baseline-home.png`.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/access.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces대로.
- [ ] **Step 4: 통과 확인** — vitest·tsc·lint·build 통과. 로컬 스택: `cd backend && .venv/bin/python -m scripts.reset_db && DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin .venv/bin/uvicorn app.main:app --port 8777` + `cd frontend && npm run dev` → `cd frontend && node scripts/pw-smoke-baseline.mjs` PASS, 스크린샷 확인.
- [ ] **Step 5: Commit** — `feat(frontend): add login, top bar and home with my permissions — 로그인·상단 바·홈(내 권한)`, push.

---

### Task 10: 관리 화면 — 권한 관리·운영 패널

**Files:**
- Create: `frontend/src/app/admin/page.tsx`, `frontend/src/components/admin/{access-roles,access-grants,access-audit,access-effective,hr-sync-panel,batch-runs-panel,ai-panel}.tsx`, `frontend/src/components/subject-picker.tsx`, `frontend/src/components/modal.tsx`, `frontend/src/lib/dept-tree.ts`
- Modify: `frontend/src/lib/api.ts`(관리 API 헬퍼), `frontend/src/lib/i18n-messages.ts`, `frontend/scripts/pw-smoke-baseline.mjs`
- Test: `frontend/src/lib/dept-tree.test.ts`

**Interfaces:**
- Consumes: Task 5·6·7의 API 계약(이름·필드 그대로), `Me`·`hasPermission`, `humanizeApiError`, `formatKst`
- Produces:
  - `api.ts` 헬퍼: `listRoles`, `createRole({name, description, permissions})`, `updateRole(id, ...)`, `deleteRole(id)`, `listGrants`, `addGrant({subject_type, subject_id, role_id?, permission?})`, `removeGrant(id)`, `listAudit(limit?)`, `getEffective(loginId)`, `searchDirectory(q)`, `listDepartments`, `runHrSync`, `getHrSyncPreview`, `listHrSyncRuns`, `listBatchRuns`, `pingAi`, `getAiUsage(days?)` — 반환 타입은 backend 응답 필드 그대로의 interface.
  - `dept-tree.ts`: `interface DeptNode { code: string; name: string; nameKo: string; children: DeptNode[] }`, `buildDeptTree(rows: Department[]): DeptNode[]` — 부모가 목록에 없으면 루트로, 순환은 끊어서 루트로, 형제는 이름순.
  - `modal.tsx`: 백드롭 mousedown으로 닫힘 + Esc 닫힘, `data-testid` prop.
  - 관리 페이지 탭(권한 없는 탭은 렌더 안 함, 탭이 하나도 없으면 홈으로): Access(`permission.manage`, 하위 Roles·Grants·Audit·Lookup) · Directory sync(`directory.sync`) · Batch jobs(`system.view`) · AI(`ai.admin`). `data-testid`: `admin-tab-<access|directory|batch|ai>`, `role-row-<id>`, `role-create`, `role-form-name`, `role-form-perm-<key>`, `role-form-save`, `grant-row-<id>`, `grant-missing-<id>`(부서 없음 배지), `grant-create`, `grant-subject-type-<user|dept>`, `grant-save`, `audit-row-<id>`, `effective-picker`, `effective-result`, `hr-sync-run`, `hr-sync-preview`, `batch-row-<job>-<outcome>`, `ai-ping`, `ai-ping-result`.
  - 오류는 전부 `humanizeApiError`로 사람 말 문구(예: 역할 삭제 409 → "This role is still granted. Remove its grants first.").

- [ ] **Step 1: 실패 테스트 작성**

```ts
test("nests children under parents", ...)        // 공용 데이터 7개 → 루트 1개(CORP), CORP 자식 3개
test("orphan becomes root", ...)                 // parent "GONE" → 루트 목록에 포함
test("cycle does not hang", ...)                  // A↔B → 반환되고 두 노드 모두 존재
```

스모크 2차 시나리오(Task 9 스크립트에 추가): qa.lead → `/admin` → `admin-tab-access` 보임, `role-row-*` 중 "Permission Admin" 존재 → "Smoke Role"(`system.view`) 생성 → 목록에 나타남 → `prod.member` 개인 부여 추가 → `audit-row-*` 상위 2행이 role.create·grant.add → `baseline-admin-access.png`. 이어서 `sopa.devUser=prod.member` → `/admin`에 `admin-tab-batch`만 보이고 `admin-tab-access` 없음 → `baseline-admin-prod.png`. `ops.member` → `ai-ping`(AI 꺼짐) → `ai-ping-result`에 "AI is turned off" 류 문구, 원문 `503` 미노출.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/dept-tree.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces대로.
- [ ] **Step 4: 통과 확인** — vitest·tsc·lint·build 통과, `reset_db` 후 로컬 스택에서 `node scripts/pw-smoke-baseline.mjs` 전 시나리오 PASS, 스크린샷 3장 확인.
- [ ] **Step 5: Commit** — `feat(admin-ui): add permission management and ops panels — 권한 관리·운영 관리 화면`, push.

---

### Task 11: 컨테이너·compose·nginx·DB 백업

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `frontend/Dockerfile`, `frontend/.dockerignore`, `nginx/default.conf`, `docker-compose.yml`, `scripts/db-backup.sh`, `.env.example`

**Interfaces:**
- Consumes: 모든 Settings 필드(Task 2), `BatchJobRun` 테이블 계약(`batch_job_runs(job, outcome, ran_at, detail)`, PK(job, outcome))
- Produces:
  - `backend/Dockerfile`: bpm 그대로(`python:3.11-slim`, pip 캐시 마운트, `COPY app/ alembic/ alembic.ini scripts/`, 비루트 `appuser`, `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000` 단일 워커). 마이그레이션은 lifespan이 적용.
  - `frontend/Dockerfile`: bpm 그대로 3단계 `node:24.22.1-alpine`, `npm ci` 캐시 마운트, standalone, `USER node`, 3000 노출.
  - `.dockerignore`: backend `tests/`, `.env`, `.venv/`, `*.db` · frontend `node_modules/`, `.next/`, `.env*`.
  - `nginx/default.conf`: bpm 그대로 + `client_max_body_size 50m`.
  - `docker-compose.yml`: proxy(`nginx:1.27-alpine`, `"${APP_PORT:-7777}:80"`, 96M/32M) · frontend(768M/256M, `NODE_OPTIONS: --max-old-space-size=512`) · backend(1G/256M, `MALLOC_ARENA_MAX: "2"`, `FORWARDED_ALLOW_IPS: ${FORWARDED_ALLOW_IPS:-}`, Settings 전 필드 `VAR: ${VAR:-}` 매핑 + `DATABASE_URL: postgresql+asyncpg://${POSTGRES_USER:-sop_archivist}:${POSTGRES_PASSWORD:?set in .env}@db:5432/${POSTGRES_DB:-sop_archivist}`, `depends_on: db: condition: service_healthy`) · db(`postgres:16-alpine`, 1G/256M, `pg_isready` 5s/3s/10, 볼륨 `pgdata`, networks `default` + `dbv-shared`(aliases `${DBV_DB_ALIAS:-sop-archivist-db}`)) · db-backup(`postgres:16-alpine`, 64M/16M, `entrypoint: ["sh", "/db-backup.sh"]`, `${BACKUP_DIR:-./backups}:/backups`, `BACKUP_RETENTION_DAYS: ${BACKUP_RETENTION_DAYS:-14}`). 전 서비스 `restart: unless-stopped`. `networks`: `default`(driver bridge, **ipam 없음** — spec §4 미정 항목), `dbv-shared`(`external: true`, `name: ${DBV_NETWORK:-dbv-shared}`).
  - `scripts/db-backup.sh`: bpm 그대로(`pg_dump -Fc` → `pg_restore --list` 검증 후 `.dump` 확정, 매일 04:00 KST + 기동 직후 오늘자 없으면 1회, `find -mtime +${BACKUP_RETENTION_DAYS}` 정리, `TZ=KST-9`), 파일 이름 접두 `sop-archivist_`. **바꿀 점**: `CREATE TABLE IF NOT EXISTS batch_job_runs`를 지운다 — 테이블은 Alembic이 만들며, 사이드카가 먼저 만들면 마이그레이션 `0002`가 "already exists"로 깨진다. 대신 기록 직전 `SELECT to_regclass('public.batch_job_runs')`를 5초 간격 최대 12회 확인하고(첫 기동 때 backend 마이그레이션을 기다림), 끝내 NULL이면 기록만 건너뛰고 로그 한 줄. 사이드카를 backend 상태에 묶지 않는다(backend가 죽어도 백업은 돈다).
  - `.env.example`: spec §5.4 묶음 순서·주석, 모든 값은 플레이스홀더 또는 기본값. 로컬 예시 줄 `APP_SYSADMINS=dev.admin`, `AI_BASE_URL=http://localhost:9999/v1`(가짜 AI).

- [ ] **Step 1: 설정 검사** — `docker compose config` 오류 없음, 출력에 서비스 5개·각 `limits.memory` 값·`7777:80`·`dbv-shared` external 확인. `grep -n "syntax=" backend/Dockerfile frontend/Dockerfile` → 출력 없음. backend `environment:` 키 집합 ⊇ `Settings` 필드 env 이름(작은 Python 스니펫으로 대조, 누락 0).
- [ ] **Step 2: 로컬 기동** — `docker network inspect dbv-shared >/dev/null 2>&1 || docker network create dbv-shared`, 저장소 루트에 `.env`(gitignore) 작성: `AUTH_MODE=dev`, `POSTGRES_PASSWORD=localtest`, `BACKUP_DIR=./backups`. `docker compose up -d --build`.
- [ ] **Step 3: 동작 확인** — `node -e` fetch로 `http://localhost:7777/api/health` 200 `{"status":"ok"}`, `/` 200, `/api/auth/mode`의 mode `"dev"`. `docker compose exec db psql -U sop_archivist -d sop_archivist -tc "select version_num from alembic_version"` → `0004`. `ls backups/sop-archivist_*.dump` 1개 이상. `... -tc "select job, outcome from batch_job_runs"`에 `db_backup | success`. `docker compose logs backend | grep -i error` 없음. 확인 후 `docker compose down`.
- [ ] **Step 4: Commit** — `feat(deploy): add Dockerfiles, compose stack, nginx and DB backup sidecar — 컨테이너·compose·nginx·DB 백업`, push.

---

### Task 12: 운영 문서·CLAUDE.md 마무리·v0.1.0

**Files:**
- Create: `docs/deploy/deploy.md`, `docs/deploy/setup-once.md`, `docs/deploy/backup.md`, `docs/deploy/db-viewer-readonly.md`
- Modify: `CLAUDE.md`, `README.md`, `docs/README.md`, `CHANGELOG.md`, `PROGRESS.md`

**Interfaces:**
- Consumes: 앞 태스크의 명령·포트·env·엔드포인트 이름

- [ ] **Step 1: deploy 문서** — bpm `docs/deploy/` 같은 이름 문서에서 이 프로젝트에 맞게 줄여 작성. 필수 내용:
  - `deploy.md`: 파이프라인(GitHub `Nocharm/sop-archivist` → Windows PC `git pull`·네이티브 확인 → 서버 71번 clone/pull → `docker compose up -d --build`), §0 베이스 이미지(4개 태그가 bpm과 같아 이미 서버에 있음, 없을 때 연결된 PC에서 `docker pull --platform linux/amd64` → `docker save` → scp → `docker load`), 배포 후 상단 바 버전 확인, 트러블슈팅 표(bpm 표에서 해당 행: `# syntax` 빌드 실패, env 미전달, 3.11 문법, secure context, dbv-shared 없음).
  - `setup-once.md`: ① `dbv-shared` 존재 확인 ② `.env` 작성(실값은 서버에만) ③ Keycloak 클라이언트 `sop-archivist-frontend`(public, standard flow, PKCE 끔, Redirect URIs `http://<server-ip>:7777/*`, Web origins `http://<server-ip>:7777`) ④ 첫 `up` 뒤 `docker network inspect`로 내부 대역 확인 → `FORWARDED_ALLOW_IPS` 기입(고정 대역을 쓰기로 하면 compose에 ipam 추가) ⑤ `APP_SYSADMINS` 지정 ⑥ 관리 화면 Directory sync에서 미리보기 → 실행 ⑦ 권한 관리 부서에 `permission.manage` 역할 부여 ⑧ db-viewer 연결.
  - `backup.md`: bpm 그대로 줄여서(복구는 빈 스키마에 단일 트랜잭션, 같은 디스크 한계, `.env` 별도 백업).
  - `db-viewer-readonly.md`: bpm §5 `dbviewer_ro` 절차, 별칭 `sop-archivist-db`.
  - 실 IP·호스트명은 플레이스홀더.
- [ ] **Step 2: CLAUDE.md·README** — CLAUDE.md에 Commands(backend venv·pytest·ruff·`scripts.reset_db`·uvicorn 8777 / frontend npm·vitest·tsc·lint·build·스모크 / 가짜 AI / docker compose — 로컬 명령 bash+PowerShell 병기, 서버 명령 bash만), Architecture(4컨테이너+백업 사이드카 표, 경계, `app/access/` 권한 판정 단일 소스), "AI 페이로드에 직원 실명 금지", 권한 추가 체크리스트(backend `catalog.PERMISSIONS` ↔ frontend `access.PERMISSIONS` ↔ i18n `permission.<key>` 3곳), 새 env 체크리스트(Settings·`.env.example`·compose 3곳), 모델 변경은 Alembic 리비전 필수(`test_models_match_migrations`가 잡음). README는 한 줄 소개·대상·로컬 실행·배포 문서 링크·디렉터리 구조.
- [ ] **Step 3: 최종 게이트** — backend `pytest -q` 전부 PASS·ruff 0 · frontend vitest·tsc·lint·build 통과 · `reset_db` 후 로컬 스택 스모크 전 시나리오 PASS · `git grep -nE "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b" | grep -vE "\b(10|172|127|0)\."` 출력 없음 · `git status`에 `.env`·`backups/`·`*.db` 없음.
- [ ] **Step 4: v0.1.0** — `CHANGELOG.md`에 `## v0.1.0 — 2026-11-04`(범위: 기반 세팅, 주요 변경, 배포 메모 "서버 미배포 — setup-once 대기"). `PROGRESS.md` 갱신.
- [ ] **Step 5: Commit·태그** — `docs(deploy): add deployment runbooks and release v0.1.0 — 배포 문서·v0.1.0`, `git tag -a v0.1.0 -m "v0.1.0 — baseline"`, `git push && git push sop-archivist v0.1.0`.
