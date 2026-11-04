# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**SOP Archivist — SOP Restructuring T/F가 쓰는 사내 AI 에이전트 웹 서비스** (FastAPI + Next.js, 사내 서버에 docker compose로 배포). 제품 기능(SOP 구조 검토·이전/이후 비교·초안 작성)은 기반 세팅 다음 단계에서 설계한다. **명세: [`docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`](docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md)**, 구현 계획: `docs/superpowers/plans/2026-11-04-sop-archivist-baseline.md`, 진행 현황: `PROGRESS.md`.

> 상태: **v0.1.0 기반 세팅 완료, 서버 미배포(`docs/deploy/setup-once.md` 대기)** — 사내 로그인(Keycloak)·직원 디렉터리(HR 웹훅)·사내 AI·표 기반 권한 체계를 얹은 빈 앱. 형제 프로젝트 bpm의 사내 인프라를 도메인 결합 없이 이식했다. 다음 단계는 SOP 제품 설계다. 배포·운영 절차는 `docs/deploy/`(인덱스 `docs/README.md`).
> **서비스 버전**: `frontend/package.json` `version`이 단일 소스(빌드 때 상단 바 서비스 이름 옆 표시), 기록은 루트 `CHANGELOG.md`, `Nocharm/sop-archivist` `main` 머지마다 올리고 `vX.Y.Z` 태그(`rules/common/git.md` "On Main Merge — 서비스 버전"). 운영 배포 여부도 CHANGELOG에 적는다.
> DB: 로컬 네이티브는 sqlite 파일(무설정, 연결마다 `PRAGMA foreign_keys=ON`이라 FK·cascade가 서버와 같다), 서버 compose는 postgres. 스키마는 **Alembic**(backend 기동 때 head까지 자동 적용). 로컬 데모 시드: `backend/scripts/reset_db.py`(서버 실행 금지).
> **원칙**: AI 페이로드에 직원 실명을 싣지 않는다(역할·부서 등 비식별 정보만). 공개 저장소이므로 실서버 IP·사내 호스트명·시크릿은 추적 파일에 넣지 않는다(플레이스홀더 `<server-ip>` 등).

## Commands

실행 명령은 **bash(macOS/Linux)와 PowerShell(Windows)을 병기**한다 — 로컬 검증이 Windows PC에서 이뤄지기 때문 (`rules/common/documentation.md`). 서버(리눅스) 명령은 bash만.

```bash
# === bash (macOS/Linux) ===
# backend (backend/ 에서, 로컬 네이티브) — 배포 런타임과 같은 Python 3.11로 venv를 만든다
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m scripts.reset_db      # 로컬 데모 DB 초기화(backend/dev.db): Alembic base→head + dev 디렉터리·데모 권한. 서버 실행 금지
AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin .venv/bin/uvicorn app.main:app --reload --port 8777   # 개발 서버
.venv/bin/python -m pytest tests/ -q      # 테스트 — conftest가 AUTH_MODE·AI·HR 등을 baseline으로 고정해 backend/.env가 있어도 안전
.venv/bin/ruff check app/ tests/          # 린트(target py311)
.venv/bin/alembic revision --autogenerate --rev-id "<다음 번호>" -m "<설명>"   # 모델을 바꾼 뒤 리비전 생성 → 생성물을 직접 검토

# frontend (frontend/ 에서)
npm install
npm run dev                               # 개발 서버 :3777 — /api는 BACKEND_URL(기본 localhost:8777)로 프록시
npm run build                             # 프로덕션 빌드(standalone) — 경고 0이어야 한다. next dev를 먼저 내린다
npm run lint
npx tsc --noEmit -p tsconfig.json         # 타입 게이트
npx vitest run                            # 단위 테스트 — 커밋 전 필수
# 브라우저 스모크(Playwright + 시스템 Chrome): reset_db 직후 + 위 uvicorn(DEV_ENFORCE_PERMISSIONS=true) + npm run dev 상태에서
npm i --no-save playwright-core           # package.json 불변
BASE_URL=http://localhost:3777 node scripts/pw-smoke-baseline.mjs   # 산출물은 저장소 루트 .shots/(gitignore). Chrome 경로는 CHROME_PATH

# 가짜 AI — 고정 응답, 배선 확인용 (저장소 루트에서, 포트 9999)
node frontend/scripts/fake-ai-server.mjs
#   backend를 AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake 로 띄운다.
#   토큰이 비면 ai_client가 "Bearer " 헤더를 보내 호출이 실패하므로 가짜 서버에도 아무 값이나 넣는다.
# dev 인증 = localStorage `sopa.devUser` / 헤더 `X-Dev-User`. 권한 차등은 DEV_ENFORCE_PERMISSIONS=true로 본다(dev.admin이 sysadmin).
```

```powershell
# === PowerShell (Windows) ===
# backend (backend\ 에서, 로컬 네이티브)
py -3.11 -m venv .venv; .venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\python -m scripts.reset_db
$env:AUTH_MODE="dev"; $env:DEV_ENFORCE_PERMISSIONS="true"; $env:APP_SYSADMINS="dev.admin"; .venv\Scripts\uvicorn app.main:app --reload --port 8777
.venv\Scripts\python -m pytest tests\ -q
.venv\Scripts\ruff check app\ tests\
.venv\Scripts\alembic revision --autogenerate --rev-id "<다음 번호>" -m "<설명>"

# frontend (frontend\ 에서) — npm/npx 명령은 bash와 동일
npm install
npm run dev
npm run build
npm run lint
npx tsc --noEmit -p tsconfig.json
npx vitest run
npm i --no-save playwright-core
$env:BASE_URL="http://localhost:3777"; $env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"; node scripts\pw-smoke-baseline.mjs

# 가짜 AI (저장소 루트에서)
node frontend\scripts\fake-ai-server.mjs
# backend: $env:AI_ENABLED="true"; $env:AI_BASE_URL="http://localhost:9999/v1"; $env:AI_MODEL="fake"; $env:AI_API_TOKEN="fake"
```

```bash
# 서버 배포 (리눅스 서버, 저장소 루트, .env 필요 — .env.example 참고) — 절차 전체: docs/deploy/
docker compose up -d --build   # 접속: http://<server-ip>:7777
# 로컬 Docker로 컨테이너 검증할 때도 공유 브리지를 먼저 만든다: docker network create dbv-shared
```

## Architecture

모노레포. 5개 서비스(앱 4 + 백업 사이드카)를 docker compose로 묶어 nginx 리버스 프록시 뒤에 둔다. compose 프로젝트 이름은 `sop-archivist`.

| 레이어 | 스택 | 역할 |
|--------|------|------|
| **proxy** | nginx 1.27 | `/api` → backend, 나머지 → frontend. **서버 노출 포트 7777**(`APP_PORT`). X-Frame-Options·frame-ancestors를 붙이지 않는다(Keycloak silent 갱신이 `/login`을 iframe으로 불러온다) |
| **frontend** | Next.js 16 (TypeScript, React 19, Tailwind 4) + `oidc-client-ts` | 로그인 게이트·상단 바(서비스 이름+버전)·홈(내 신원·권한)·관리 화면(권한 관리·직원 동기화·배치 작업·AI). UI 영어 기본 + 한국어 전환 |
| **backend** | Python 3.11 — FastAPI + SQLAlchemy(async) + Alembic + Pydantic | 인증(Keycloak RS256·dev)·`/api/me`·직원/부서 디렉터리(HR 웹훅 동기화)·권한 체계·관리 운영 API·사내 AI 연결·사용량 기록 |
| **db** | PostgreSQL 16 | 영속 저장. `dbv-shared` 네트워크에 별칭 `sop-archivist-db`로 합류(db-viewer 읽기 전용 조회) |
| **db-backup** | `postgres:16-alpine` 사이드카 | 일간 04:00 KST `pg_dump -Fc`, 14일 보존, `batch_job_runs`에 결과 기록 (`docs/deploy/backup.md`) |

**경계:** 브라우저 → `:7777`(앱 nginx) → (Next.js | FastAPI) → PostgreSQL. frontend↔backend는 nginx 경유 HTTP, 로컬에서는 Next rewrites가 `/api`를 `BACKEND_URL`로 넘긴다. 입력 검증은 backend API 경계에서 한다(`rules/common/security.md`). 인증은 같은 서버의 Keycloak realm `ai-portal`(공유)의 public 클라이언트 `sop-archivist-frontend`이고, 주소는 `.env` 경유다(`docs/deploy/setup-once.md` A5).

**디렉터리 구조:**
```
backend/    # FastAPI 앱(app/), Alembic(alembic/), 로컬 시드(scripts/reset_db.py), tests/
frontend/   # Next.js 앱(src/app 라우트, src/components, src/lib), scripts/ = 스모크·가짜 AI
nginx/      # 리버스 프록시 설정
scripts/    # db-backup.sh (사이드카가 마운트)
docs/       # 인덱스 docs/README.md — deploy/(런북) · lessons/(시행착오) · superpowers/(명세·계획)
docker-compose.yml
```

**backend 핵심 모듈:**
- `app/main.py` lifespan: Alembic `upgrade head` → (dev 모드만) dev 디렉터리 시드 → HR 동기화 스케줄러. 라우터는 `app/routers/`(`auth`·`me`·`directory`·`access`·`admin`).
- `app/auth.py`: Keycloak은 서명·issuer에 더해 `azp == KEYCLOAK_CLIENT_ID`까지 검사(같은 realm의 다른 앱 토큰 거부, 빈 값이면 전부 거부). dev는 `X-Dev-User` 헤더 신뢰(서버에서 쓰면 안 됨).
- **`app/access/` = 권한 판정 단일 소스.** `catalog.py` `PERMISSIONS`(권한 키는 코드가 정의) · `resolve.py` `get_effective_access`(개인 부여 ∪ 소속 부서 체인 부여, 역할은 권한으로 펼침, 퇴직자 무권한, `APP_SYSADMINS`는 전권) · `deps.py` `require_permission("<key>")`(라우터 의존성). `sources.py`(권한 출처 응답 `SourceOut`·대상 이름 조회 — `/api/me`의 `sources`와 유효 권한 조회가 공유). `require_permission`·`/api/me`·관리 화면의 유효 권한 조회가 모두 `get_effective_access` 하나를 부른다 — 판정을 다른 곳에 새로 쓰지 않는다. 부여는 더하기만 있고 부서 부여는 하위 부서까지 내려간다. 대상은 FK 없이 두어 개편으로 사라진 부서·사람의 부여도 지우지 않고 `subject_missing`으로 보인다.
- `app/hr/`: HR 웹훅(`client`)·동기화 가드 3종(건수 정합·빈 피드·삭제 상한)·`source="hr"` 행만 지움(`service`)·내장 스케줄러(`scheduler`)·회차 기록(`history`). `app/orgchart.py`: 부서 체인 해석.
- `app/ai_client.py`·`app/ai_usage.py`: OpenAI 호환 사내 GLM 호출 + 호출 1건당 `ai_usage_events` 한 행(원문 없음).
- 시각은 전부 `DateTime(timezone=True)`와 `app.clock.now()`(KST). 프런트 표시는 `lib/datetime.ts`(Asia/Seoul).

**frontend 핵심:** `src/lib/api.ts` `apiFetch`(인증 헤더, dev 사용자는 요청마다 localStorage에서 읽음) · `api-errors.ts` `humanizeApiError`(상태 코드별 사람 말 문구, 서버 원문은 422 검증 사유에만) · `access.ts` 권한 카탈로그 미러 · `i18n-messages.ts` en/ko 메시지 · `keycloak-login.ts` OIDC 설정 단일 소스(PKCE는 `crypto.subtle`이 있을 때만) · `genId()`·`copyText()`(secure context 우회). localStorage 키 접두는 `sopa.`.

언어 규칙은 backend → `rules/languages/python.md`, frontend → `rules/languages/typescript.md`. 컨테이너/설정 규칙은 `rules/backend/` 참고.

## 체크리스트 — 같이 움직여야 하는 곳

- **새 권한(permission) 추가 — 3곳을 한 커밋에서:** backend `app/access/catalog.py` `PERMISSIONS` ↔ frontend `src/lib/access.ts` `PERMISSIONS`(같은 값·같은 순서, 표시 순서의 기준) ↔ i18n `permission.<key>`(en·ko, `src/lib/i18n-messages.ts`). 권한 키 자체가 `permission.`으로 시작하면(`permission.manage`) 메시지 키가 `permission.permission.manage`가 된다. 라우트는 `Depends(require_permission("<key>"))`로 막고 — 모르는 키는 import 때 `ValueError`다. 카탈로그에서 키를 빼면 저장된 역할·부여의 그 키는 판정에서 조용히 버려진다(행은 남음).
- **새 `/api/admin/*` 엔드포인트:** 라우터 단 게이트가 없으니 엔드포인트마다 권한 의존성이 필수다. `test_every_admin_route_rejects_a_user_without_permissions`가 권한 없는 사용자로 전 라우트를 순회해 누락을 잡는다. `/api/access/*`는 라우터 단에 `permission.manage`가 걸려 있다.
- **새 env:** backend `app/settings.py` · `.env.example` · `docker-compose.yml` backend `environment:`(`VAR: ${VAR:-}`) **3곳**. backend에 `env_file`이 없어 compose에 빠지면 서버에서만 조용히 기본값이다. 빈 문자열이 기동을 죽이는 int/bool 필드는 Settings 기본값과 같은 값을 폴백으로 둔다. 시크릿 값은 어디에도 쓰지 않는다(이름만).
- **모델 변경 = Alembic 리비전 필수.** `backend/alembic/versions/`에 `--rev-id 000N`으로 만든다(`create_all`은 쓰지 않는다). 모델과 마이그레이션이 어긋나면 `test_models_match_migrations`(`compare_metadata`)가 잡지만 **CHECK 제약 차이는 못 잡는다** — 제약을 건드리면 마이그레이션된 DB에 직접 부딪쳐 보는 테스트를 둔다(`test_migrations.py`). 시각 컬럼은 `DateTime(timezone=True)`. `batch_job_runs`는 백업 사이드카가 psql로 쓰는 계약이라 컬럼을 바꾸면 `scripts/db-backup.sh`의 INSERT도 함께 바꾼다.
- **AI 호출:** 페이로드에 직원 실명(`name`·`korean_name`)을 싣지 않는다 — 역할·부서 등 비식별 정보만. 호출은 `call_ai_recorded`를 거쳐 사용량 행을 남기고(실패도 `ok=false`), 사용자에게 보이는 오류는 AI 주소·토큰을 뺀 문구다.
- **프런트 텍스트:** en·ko 메시지를 한 쌍으로 추가한다(`i18n-messages.test.ts`가 키 집합을 가드). 인터랙티브 요소에는 `data-testid`(`rules/frontend/identifiers.md`).

## Operations / Deployment

로컬 개발(네이티브)과 서버 배포(docker compose)가 다른 환경이라, 아래 제약을 어기면 로컬은 초록인데 서버에서 깨진다.

| 제약 | 이유 | 반영 |
|---|---|---|
| 서버 71번, bpm 옆 | 사용자 결정 | 별도 compose 스택·별도 postgres(내 판단). 앱 nginx 노출 포트 **7777**(사용자 결정, 9900·9910은 bpm 사용 중) |
| 서버는 Docker Hub 차단 | 베이스 이미지는 연결된 PC에서 amd64 tar로 반입 | bpm과 **같은 태그만** 쓴다: `python:3.11-slim`, `node:24.22.1-alpine`, `nginx:1.27-alpine`, `postgres:16-alpine`(이미 서버에 있음 → 새 tar 반입 불필요). Dockerfile에 `# syntax=` 금지 |
| 배포 런타임 Python 3.11 | 로컬 3.12 문법으로 서버 기동 불능 사고(bpm 2026-08-31) | `backend/ruff.toml` `target-version = "py311"` |
| backend 서비스에 `env_file` 없음 | `.env`에만 넣은 값이 컨테이너에 안 들어간 사고(bpm `CSV_MANUAL_URL`) | 모든 backend env를 compose `environment:`에 `VAR: ${VAR:-}`로 매핑. `.env.example`·Settings·compose 3곳 동시 갱신 |
| 서버는 평문 HTTP 원격 IP | secure context 아님 → `crypto.randomUUID`·`crypto.subtle`·Clipboard API 불가 | `genId`, `copyText` 폴백. Keycloak 클라이언트는 PKCE를 **필수로 걸지 않는다**(선택) — 앱이 `crypto.subtle`이 있으면(HTTPS·localhost) PKCE를 켜고 평문 HTTP에서는 자동으로 끈다(`lib/keycloak-login.ts`). 검증은 localhost가 아닌 LAN IP로 |
| 로그인 콜백은 `<origin>/login` | 앱이 `redirect_uri`를 `window.location.origin`으로 만든다 | Keycloak 클라이언트 Valid redirect URIs·post logout URIs에 `http://<server-ip>:7777/*`, Web origins에 `http://<server-ip>:7777` (`docs/deploy/setup-once.md` A5). 포트·도메인마다 따로 등록 |
| 서버 DB에 dev 모드 금지 | dev 모드는 헤더를 신뢰하고 가짜 직원 5명·부서 7개를 DB에 넣는다(keycloak으로 바꿔도 남음) | 서버 `.env`에 `AUTH_MODE=keycloak` 명시(compose 기본값도 keycloak). `scripts.reset_db`도 서버 실행 금지 — 가드는 HR 직원이 있을 때뿐 (`docs/deploy/setup-once.md` C절) |
| 스키마는 Alembic, 단일 워커 | 기동 때 lifespan이 `upgrade head`를 돌려 워커가 둘이면 경합 | Dockerfile에 `--workers` 추가 금지. 모델을 바꾸면 리비전 필수(위 체크리스트) |
| 백업 디렉터리는 root 전용 `0700` | 덤프에 직원 디렉터리 전 행이 들어 있다 | 목록·복사·복원은 `sudo`, 오프서버 사본도 사적으로 (`docs/deploy/backup.md`). db-viewer는 `dbviewer_ro` 계정으로만 붙는다 (`docs/deploy/db-viewer-readonly.md`) |
| 줄바꿈 | Windows PC 경유 CRLF 오염 | `.gitattributes` `* text=auto eol=lf`(ps1/bat/cmd만 CRLF) |
| 로컬 검증 PC는 Windows, Docker 없음 | 운영 파이프라인 | 로컬 명령은 bash·PowerShell 병기. 로컬 DB는 sqlite 파일 |
| 로컬 포트 3000/8000은 db-viewer가 점유 | 맥 개발 환경 | 로컬 dev 포트 frontend **3777**, backend **8777**(내 판단) |
| 공개 저장소 | `Nocharm/sop-archivist`는 public(사용자 결정) | 실서버 IP·사내 호스트명은 플레이스홀더(`<server-ip>` 등). 회사명·사설 대역은 유지(bpm 정책과 동일). 시크릿·`.env`는 절대 추적하지 않는다 |

## Lessons — 시행착오 방지

형제 프로젝트 bpm을 6개월 운영하며 실측으로 얻은 교훈 중 이 프로젝트에도 유효한 것만 `docs/lessons/`에 옮겼다(인덱스 [`docs/lessons/README.md`](docs/lessons/README.md)). **프런트 화면이나 검증 스크립트를 건드리기 전에 해당 문서를 먼저 읽을 것.**

- [`docs/lessons/react-ts-patterns.md`](docs/lessons/react-ts-patterns.md) — useCallback deps TDZ → ref 미러, `useEffectEvent`(§7)·`<Activity>`(§8), 이펙트 안 setState 린트, Tailwind display 클래스 이중 지정 금지.
- [`docs/lessons/browser-verification.md`](docs/lessons/browser-verification.md) — Playwright + 시스템 Chrome 검증, **dev DB 오염 함정**("0 events"·"목록이 비어 있음"은 코드가 아니라 오염일 수 있다), node 스크립트 cwd, 워크트리 세션 Bash 제약, 평문 HTTP는 localhost에서 재현되지 않는다.

---

## Working Style — 최우선 (모든 룰보다 먼저)

**모든 작업의 행동 기반.** 아래 도메인 룰과 충돌해도 이 가이드의 원칙이 우선한다.

@rules/guidelines.md

---

## Rules — 범용

@rules/common/comments.md
@rules/common/naming.md
@rules/common/git.md
@rules/common/security.md
@rules/common/error-handling.md
@rules/common/dependencies.md
@rules/common/documentation.md
@rules/common/testing.md

## Rules — 백엔드/Docker

@rules/backend/config.md
@rules/backend/docker.md
@rules/backend/sync-checklist.md

## Rules — 프론트엔드

@rules/frontend/identifiers.md

## Language-Specific Rules

@rules/languages/python.md
@rules/languages/typescript.md
