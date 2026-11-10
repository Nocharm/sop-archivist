# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**SOP Archivist — SOP Restructuring T/F가 쓰는 사내 AI 에이전트 웹 서비스** (FastAPI + Next.js, 사내 서버에 docker compose로 배포). 제품은 옛 SOP 묶음을 새 SOP·WI 구조로 다시 짜는 일(문서 쪼개기 → 배정·고쳐 쓰기 → 결과물 A·B·C·Excel → 검토)을 돕는다. **제품 명세: [`docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`](docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md)**(판단 기준은 `docs/domain/`), 기반 명세: [`docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`](docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md), 구현 계획: `docs/superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md`(계획 2 AI 층, 완료 — 살아 있는 것은 "API 계약" 블록. 계획 1·기반 계획은 끝나 지웠다), 프런트 디자인 기초: `frontend/docs/design/2026-11-07-frontend-design-foundations.md`, 진행 현황: `PROGRESS.md`.

> 상태: **v0.12.1 결정적 코어 + AI 제안 층 + 프런트 화면(백엔드 기능 전부 연결, 이동·움직임 공통 층, 표·카드 목록·공통 드롭다운, 첫 실사용 피드백 개편 — 사용자 메뉴·바로 생성·History·문서 정보 탐지·Split 종이 조각·피커 순위, 3단계 Assign 통합 화면, 서비스 마크, 전체 검토 반영·사용 설명서 `/manual`·검토 요청 거두기·경계 확인 필수, 두 번째 실사용 피드백 — Split 조각 종이·부분 탭·합치기 한 길·자동 번호·줄 단위 쪼개기) + GitLab Runner 배포 파이프라인 완료, 운영 서버 배포됨(첫 배포 2026-11-09 v0.8.0 — Keycloak 연결·HR 동기화 24시간 주기, 최근 2026-11-10 v0.10.1 — v0.11.0~v0.12.1은 아직 운영에 올리지 않았다), 실제 SOP·실제 모델 미검증** — v0.1.0 기반(사내 로그인 Keycloak·직원 디렉터리 HR 웹훅·사내 AI·표 기반 권한 체계) 위에 SOP 재구성의 결정적 코어(v0.2.0: 묶음·멤버십, 업로드·격리 추출(DOCX 메인, PDF·MarkItDown 보조), 규칙 쪼개기·편집·되돌리기, To-Be 목록, 배정·확정(두 입구), 결과물 A·B·C, Excel 내보내기, 검토 흐름)와 그 위의 AI 제안 층(v0.3.0: 분류·고쳐 쓰기·번역·입구 2 짝 맞추기·한/영 따로 짝·복합 문장 나누기 제안, 지침·프롬프트 버전, 채택률)을 얹었다. AI는 제안만 하고 사람이 줄마다 확정하며, AI가 꺼지거나 실패해도 사람 경로는 그대로 돈다. 프런트는 1차 화면(v0.4.0: 모든 단계 화면, G Graphite 라이트·다크, 설계 기초 `frontend/docs/design/2026-11-07-frontend-design-foundations.md`)이 붙었다. AI 층은 가짜 AI와 합성 SOP로만 검증했고 **유사도 임계값은 합성 자료로만 잡은 값**이다(실제 모델·SOP 시험 뒤 다시 정한다). 배포·운영 절차는 `docs/deploy/`(인덱스 `docs/README.md`), 배포는 사내 GitLab 파이프라인으로만 한다(`docs/deploy/gitlab-runner.md`).
> **서비스 버전**: `frontend/package.json` `version`이 단일 소스(빌드 때 상단 바 서비스 이름 옆 표시), 기록은 루트 `CHANGELOG.md`, `Nocharm/sop-archivist` `main` 머지마다 올리고 `vX.Y.Z` 태그(`rules/common/git.md` "On Main Merge — 서비스 버전"). 운영 배포 여부도 CHANGELOG에 적는다.
> DB: 로컬 네이티브는 sqlite 파일(무설정, 연결마다 `PRAGMA foreign_keys=ON`이라 FK·cascade가 서버와 같다), 서버 compose는 postgres. 스키마는 **Alembic**(backend 기동 때 head까지 자동 적용). 로컬 데모 시드: `backend/scripts/reset_db.py`(서버 실행 금지), SOP 데모 묶음은 그 위에 `backend/scripts/seed_sop_demo.py`(아래 Commands).
> **원칙**: AI 페이로드에 직원 실명을 싣지 않는다(역할·부서 등 비식별 정보만). 공개 저장소이므로 실서버 IP·사내 호스트명·시크릿은 추적 파일에 넣지 않는다(플레이스홀더 `<server-ip>` 등).

## Commands

실행 명령은 **bash(macOS/Linux)와 PowerShell(Windows)을 병기**한다 — 로컬 검증이 Windows PC에서 이뤄지기 때문 (`rules/common/documentation.md`). 서버(리눅스) 명령은 bash만.

```bash
# === bash (macOS/Linux) ===
# backend (backend/ 에서, 로컬 네이티브) — 배포 런타임과 같은 Python 3.11로 venv를 만든다
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m scripts.reset_db      # 로컬 데모 DB 초기화(backend/dev.db): Alembic base→head + 지침·dev 디렉터리·데모 권한. 서버 실행 금지
.venv/bin/python -m scripts.seed_sop_demo # 로컬 전용(운영 DB 금지): 합성 SOP 묶음 4개(쪼개기 직후·분류 절반·검토 대기·AI 제안)를 앱 API로 만든다(작성자 qa.member, 검토자 qa.lead). 묶음 2~4는 경계를 미리 모두 확인하고 "쪼개기 직후"만 미확인으로 남긴다(경계 확인이 검토 요청 조건이라서). AI 제안 단계는 프로세스 안의 가짜 전송으로 돌아 AI 설정이 필요 없고 실제 모델을 부르지 않는다. 같은 제목이 있으면 건너뛰어 다시 돌려도 된다. AUTH_MODE=dev에서만 돈다(dev 의존성 python-docx 필요, DEV_ENFORCE_PERMISSIONS=true면 bundle.create가 없어 403)
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
#   SOP 화면 스모크·글자 대비 감사는 reset_db → seed_sop_demo 직후 DB에서(dev.db 대신 DATABASE_URL로 별도 sqlite 파일을 쓰면 다시 돌리기 쉽다)
BASE_URL=http://localhost:3777 node scripts/pw-smoke-sop.mjs        # AI 나눔 확정 단계는 backend가 가짜 AI(FAKE_AI_SPLIT=1)를 볼 때만 돈다
BASE_URL=http://localhost:3777 node scripts/pw-contrast-audit.mjs   # 14화면 × 라이트·다크, 4.5:1
BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs     # 시스템 설명서(docs/manual/) 화면 그림·번호 위치 다시 뽑기 — reset_db → seed_sop_demo 직후, 끝에 묶음 3을 검토 완료로 바꾼다
MANUAL=app BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs   # 사용 설명서(/manual) 그림 17장을 frontend/public/manual/img/에 — 1120x720, 번호 표시 없음, DB를 바꾸지 않는다. 위 줄보다 먼저 돌린다(위 줄이 묶음 3을 바꾼다)

# 가짜 AI — 고정 응답, 배선 확인용 (저장소 루트에서, 포트 9999). 합성 응답이라 프롬프트 품질·정확도의 근거가 아니다
node frontend/scripts/fake-ai-server.mjs   # FAKE_AI_SPLIT=1이면 분류 답과 나누기 제안 답이 문장을 둘로 나눈다(AI 나눔 확정·AI 나누기 제안 경로 스모크용)
#   backend를 AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="" 로 띄운다.
#   임베딩까지 쓰면 EMBED_ENABLED=true EMBED_BASE_URL=http://localhost:9999/v1 EMBED_API_TOKEN=fake EMBED_MODEL=fake 를 더한다(벡터가 글자 해시라 입구 2 짝은 안 생겨 신규로 간다).
#   토큰이 비면 ai_client가 "Bearer " 헤더를 보내 호출이 실패하므로 가짜 서버에도 아무 값이나 넣는다.
# dev 인증 = localStorage `sopa.devUser` / 헤더 `X-Dev-User`. 권한 차등은 DEV_ENFORCE_PERMISSIONS=true로 본다(dev.admin이 sysadmin).
```

```powershell
# === PowerShell (Windows) ===
# backend (backend\ 에서, 로컬 네이티브)
py -3.11 -m venv .venv; .venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\python -m scripts.reset_db
.venv\Scripts\python -m scripts.seed_sop_demo   # 로컬 전용(운영 DB 금지) — 설명은 bash 쪽과 같다
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
node scripts\pw-smoke-sop.mjs        # seed_sop_demo 직후. 설명은 bash 쪽과 같다
node scripts\pw-contrast-audit.mjs
node scripts\pw-manual-shots.mjs     # 설명서 그림 다시 뽑기. 설명은 bash 쪽과 같다
$env:MANUAL="app"; node scripts\pw-manual-shots.mjs; Remove-Item Env:MANUAL   # 사용 설명서(/manual) 그림. 설명은 bash 쪽과 같다(변수를 지우지 않으면 다음 실행도 app 모드다)

# 가짜 AI (저장소 루트에서)
node frontend\scripts\fake-ai-server.mjs   # 나눔 모드: $env:FAKE_AI_SPLIT="1"

# 배포 스크립트 검증은 POSIX sh가 필요하다 — Git Bash에서 sh ci/test-deploy.sh, 아니면 GitLab의 deploy-script-test Job 결과를 본다
# backend: $env:AI_ENABLED="true"; $env:AI_BASE_URL="http://localhost:9999/v1"; $env:AI_MODEL="fake"; $env:AI_API_TOKEN="fake"; $env:AI_ENDPOINTS=""
# 임베딩까지: $env:EMBED_ENABLED="true"; $env:EMBED_BASE_URL="http://localhost:9999/v1"; $env:EMBED_API_TOKEN="fake"; $env:EMBED_MODEL="fake"
```

```bash
# 서버 배포 = 사내 GitLab 파이프라인 (서버에서 직접 compose 하지 않는다) — 절차 전체: docs/deploy/gitlab-runner.md
# PC(GitHub main을 받은 뒤): git push gitlab main && git push gitlab vX.Y.Z → GitLab main 파이프라인 test 통과 → deploy-production ▶
# 배포 Job(ci/deploy.sh)이 서버 배포 폴더(기본 /data/deployments/sop-archivist, .env는 거기에만)로 checkout을 맞추고 docker compose up -d --build. 접속: http://<server-ip>:7777
sh ci/test-deploy.sh            # 배포 스크립트 검증(가짜 docker, 저장소 루트에서) — busybox·GNU 둘 다에서 돌아야 한다
# 로컬 Docker로 컨테이너 검증할 때도 공유 브리지를 먼저 만든다: docker network create dbv-shared
```

## Architecture

모노레포. 5개 서비스(앱 4 + 백업 사이드카)를 docker compose로 묶어 nginx 리버스 프록시 뒤에 둔다. compose 프로젝트 이름은 `sop-archivist`.

| 레이어 | 스택 | 역할 |
|--------|------|------|
| **proxy** | nginx 1.27 | `/api` → backend, 나머지 → frontend. **서버 노출 포트 7777**(`APP_PORT`). X-Frame-Options·frame-ancestors를 붙이지 않는다(Keycloak silent 갱신이 `/login`을 iframe으로 불러온다) |
| **frontend** | Next.js 16 (TypeScript, React 19, Tailwind 4) + `oidc-client-ts` | 로그인 게이트·앱 틀(상단 막대 + 단계 레일/탭)·묶음 목록(`/`)·SOP 단계 화면(문서·쪼개기·To-Be·Assign(분류+짝 맞추기)·결과물·검토)·내 신원·권한(`/account`)·관리 화면(권한 관리·직원 동기화·배치 작업·AI). UI 영어 기본 + 한국어 전환, 라이트·다크 |
| **backend** | Python 3.11 — FastAPI + SQLAlchemy(async) + Alembic + Pydantic | 인증(Keycloak RS256·dev)·`/api/me`·직원/부서 디렉터리(HR 웹훅 동기화)·권한 체계·관리 운영 API·사내 AI 연결·사용량 기록, **SOP 재구성 코어 API**(`app/sop/` + `routers/sop_*` — 묶음·문서 업로드/추출·쪼개기·배정·결과물·Excel·검토)와 그 위의 **AI 제안 층**(`app/sop/ai/` — 작업 실행기·임베딩·분류/번역/짝/나누기 제안) |
| **db** | PostgreSQL 16 | 영속 저장. `dbv-shared` 네트워크에 별칭 `sop-archivist-db`로 합류(db-viewer 읽기 전용 조회) |
| **db-backup** | `postgres:16-alpine` 사이드카 | 일간 04:00 KST `pg_dump -Fc`, 14일 보존, `batch_job_runs`에 결과 기록 (`docs/deploy/backup.md`) |

**경계:** 브라우저 → `:7777`(앱 nginx) → (Next.js | FastAPI) → PostgreSQL. frontend↔backend는 nginx 경유 HTTP, 로컬에서는 Next rewrites가 `/api`를 `BACKEND_URL`로 넘긴다. 입력 검증은 backend API 경계에서 한다(`rules/common/security.md`). 인증은 같은 서버의 Keycloak realm `ai-portal`(공유)의 public 클라이언트 `sop-archivist-frontend`이고, 주소는 `.env` 경유다(`docs/deploy/setup-once.md` A5).

**디렉터리 구조:**
```
backend/    # FastAPI 앱(app/, SOP 기능은 app/sop/), Alembic(alembic/), 로컬 시드(scripts/reset_db.py·seed_sop_demo.py), 합성 SOP 생성기(scripts/synthetic_sop.py), tests/
frontend/   # Next.js 앱(src/app 라우트, src/components, src/lib), scripts/ = 스모크·가짜 AI
nginx/      # 리버스 프록시 설정
scripts/    # db-backup.sh (사이드카가 마운트)
ci/         # deploy.sh(GitLab 배포 Job 본체, POSIX sh) · test-deploy.sh(가짜 docker로 검증) — .gitlab-ci.yml이 부른다
docs/       # 인덱스 docs/README.md — deploy/(런북·gitlab-runner.md) · manual/(시스템 설명서·화면 그림) · lessons/(시행착오) · superpowers/(명세·계획)
docker-compose.yml
.gitlab-ci.yml  # 사내 GitLab: test 3개(MR·main 자동) · deploy-production(main 수동 ▶)
```

**세부 구조는 폴더별 CLAUDE.md에 있다**(세션마다 깔리는 양을 줄이려고 2026-11-10에 나눴다 — 내용은 그대로 옮겼다). 그 폴더의 파일을 읽을 때 함께 실리고, 실리지 않은 채 그 폴더를 고치게 되면 먼저 직접 읽는다.
- [`backend/CLAUDE.md`](backend/CLAUDE.md) — backend 핵심 모듈(`app/main.py`·`app/auth.py`·`app/access/`·`app/hr/`·`app/sop/`·`app/sop/ai/`·떼어 내기·AI 호출)과 backend 체크리스트(admin 엔드포인트·Alembic 리비전·AI 호출·AI 제안 층 불변식·SOP 규칙 이중 사용 지점·데모/E2E 몰이).
- [`frontend/CLAUDE.md`](frontend/CLAUDE.md) — frontend 핵심(API 호출·순수 모델·Assign 화면·이동/움직임 공통 층·공통 부품·사용 설명서 `/manual`·포커스 테두리)과 frontend 체크리스트(프런트 텍스트·사용 설명서 동기화).

언어 규칙은 backend → `rules/languages/python.md`, frontend → `rules/languages/typescript.md`. 컨테이너/설정 규칙은 `rules/backend/` 참고.

## 체크리스트 — 같이 움직여야 하는 곳

양쪽에 걸친 것만 여기에 둔다. backend에만 걸리는 항목은 `backend/CLAUDE.md`, frontend에만 걸리는 항목은 `frontend/CLAUDE.md`의 같은 이름 절에 있다.

- **새 권한(permission) 추가 — 3곳을 한 커밋에서:** backend `app/access/catalog.py` `PERMISSIONS` ↔ frontend `src/lib/access.ts` `PERMISSIONS`(같은 값·같은 순서, 표시 순서의 기준) ↔ i18n `permission.<key>`(en·ko, `src/lib/i18n-messages.ts`). 권한 키 자체가 `permission.`으로 시작하면(`permission.manage`) 메시지 키가 `permission.permission.manage`가 된다. 라우트는 `Depends(require_permission("<key>"))`로 막고 — 모르는 키는 import 때 `ValueError`다. 카탈로그에서 키를 빼면 저장된 역할·부여의 그 키는 판정에서 조용히 버려진다(행은 남음).
- **새 env:** backend `app/settings.py` · `.env.example` · `docker-compose.yml` backend `environment:`(`VAR: ${VAR:-}`) **3곳**. backend에 `env_file`이 없어 compose에 빠지면 서버에서만 조용히 기본값이다. 빈 문자열이 기동을 죽이는 int/bool 필드는 Settings 기본값과 같은 값을 폴백으로 둔다. 시크릿 값은 어디에도 쓰지 않는다(이름만).
- **새 업무 규칙 거절 코드(`raise_rule`) = 프런트 문구:** 화면에서 닿을 수 있는 코드면 `rule.<code>` en·ko 문구를 같이 더한다(없으면 `humanizeApiError`가 상태 코드 문구로 떨어져 사용자가 이유를 못 본다). 세부 사유가 있는 거절은 `rule.<code>.<reason>`.
- **화면·동작·라벨을 바꾸면 사용 설명서도 같은 커밋에서:** `frontend/public/manual/user-manual.md`의 해당 조각을 고친다. backend만 고쳐 동작이 달라질 때도 같다 — 세부(굵은 라벨 대조·그림 다시 뽑기·`version`)는 `frontend/CLAUDE.md`.

## Operations / Deployment

로컬 개발(네이티브)과 서버 배포(docker compose)가 다른 환경이라, 아래 제약을 어기면 로컬은 초록인데 서버에서 깨진다.

| 제약 | 이유 | 반영 |
|---|---|---|
| **배포는 GitLab Runner — 서버에서 직접 compose 하지 않는다** | 사내 정책(사용자 결정, 2026-11-09). GitHub가 개발 원본, 사용자가 PC에서 사내 GitLab(CE, 미러 없음)으로 push | `.gitlab-ci.yml`(test 자동·deploy 수동 ▶, `main`만) → 배포 러너(Protected, 도커 소켓 + 배포 폴더를 **양쪽 같은 경로로** 마운트)가 `ci/deploy.sh`로 서버 데몬에서 `compose up -d --build`. 레지스트리·DinD 없음, 러너는 `pull_policy = never`. `.env`는 서버 배포 폴더에만(가드: `AUTH_MODE=keycloak`·`BACKUP_DIR`). 배포 스크립트의 docker 호출은 빈 환경(`env -i`) — CI 변수가 `.env`를 덮지 못하게. `set -x`·`.env`/`compose config` 출력·`down`·`prune`·`--remove-orphans` 금지. 운영·진단·복구는 배포 폴더에서 손으로(`docs/deploy/gitlab-runner.md`) |
| 서버 71번, bpm 옆 | 사용자 결정 | 별도 compose 스택·별도 postgres(내 판단). 앱 nginx 노출 포트 **7777**(사용자 결정, 9900·9910은 bpm 사용 중) |
| 서버는 Docker Hub 차단 | 베이스 이미지는 연결된 PC에서 amd64 tar로 반입 | bpm과 **같은 태그만** 쓴다: `python:3.11-slim`, `node:24.22.1-alpine`, `nginx:1.27-alpine`, `postgres:16-alpine`(이미 서버에 있음 → 새 tar 반입 불필요). Dockerfile에 `# syntax=` 금지 |
| 배포 런타임 Python 3.11 | 로컬 3.12 문법으로 서버 기동 불능 사고(bpm 2026-08-31) | `backend/ruff.toml` `target-version = "py311"` |
| backend 서비스에 `env_file` 없음 | `.env`에만 넣은 값이 컨테이너에 안 들어간 사고(bpm `CSV_MANUAL_URL`) | 모든 backend env를 compose `environment:`에 `VAR: ${VAR:-}`로 매핑. `.env.example`·Settings·compose 3곳 동시 갱신 |
| 서버는 평문 HTTP 원격 IP | secure context 아님 → `crypto.randomUUID`·`crypto.subtle`·Clipboard API 불가 | `genId`, `copyText` 폴백. Keycloak 클라이언트는 PKCE를 **필수로 걸지 않는다**(선택) — 앱이 `crypto.subtle`이 있으면(HTTPS·localhost) PKCE를 켜고 평문 HTTP에서는 자동으로 끈다(`lib/keycloak-login.ts`). 검증은 localhost가 아닌 LAN IP로 |
| 로그인 콜백은 `<origin>/login` | 앱이 `redirect_uri`를 `window.location.origin`으로 만든다 | Keycloak 클라이언트 Valid redirect URIs·post logout URIs에 `http://<server-ip>:7777/*`, Web origins에 `http://<server-ip>:7777` (`docs/deploy/setup-once.md` A5). 포트·도메인마다 따로 등록 |
| 서버 DB에 dev 모드 금지 | dev 모드는 헤더를 신뢰하고 가짜 직원 5명·부서 7개를 DB에 넣는다(keycloak으로 바꿔도 남음) | 서버 `.env`에 `AUTH_MODE=keycloak` 명시(compose 기본값도 keycloak). `scripts.reset_db`도 서버 실행 금지 — 가드는 HR 직원이 있을 때뿐 (`docs/deploy/setup-once.md` C절) |
| 스키마는 Alembic, 단일 워커 | 기동 때 lifespan이 `upgrade head`를 돌려 워커가 둘이면 경합 | Dockerfile에 `--workers` 추가 금지. 모델을 바꾸면 리비전 필수(위 체크리스트) |
| backend 메모리 상한 2G | 업로드 파싱 자식 프로세스(메인 추출 + MarkItDown)가 최악 문서(칸 10만 표)에서 ~660MiB를 더 쓴다(`docs/qa/2026-11-sop-parse-dependencies.md`). 자식 `RLIMIT_AS`는 `MALLOC_ARENA_MAX=2`와 함께일 때만 충분하다 | compose backend `memory: 2G`·`MALLOC_ARENA_MAX`·`SOP_PARSE_MEMORY_MB`(2048)를 낮추지 않는다. 동시 파싱은 업로드당 한 자리, 최대 2개(`MAX_PARALLEL_PARSES`) |
| 서버 빌드 때 외부 다운로드 금지 | 서버는 Docker Hub가 막혀 있고 PyPI·npm만 닿는다 | 흐름도 글꼴 NanumGothic(OFL)은 저장소 `backend/app/sop/assets/fonts/`에, 프런트 글꼴(Pretendard·Archivist Accent·JetBrains Mono, OFL)은 `frontend/src/app/fonts/`에 넣어 `next/font/local`로 읽는다(`.gitattributes` `*.ttf`·`*.woff2 binary`). 새 backend 의존성은 PyPI 패키지만, Python 3.11 linux x86_64 휠이 있는지 먼저 확인한다(`pip download --platform manylinux2014_x86_64 …`, QA 문서 참고). `numpy`(임베딩 코사인)는 MarkItDown의 `onnxruntime`이 이미 들여오는 버전으로 고정(`requirements.txt`)해 새 휠을 더하지 않았다 — 올리려면 `onnxruntime` 호환부터 본다 |
| 백업 디렉터리는 root 전용 `0700` | 덤프에 직원 디렉터리 전 행과 SOP 원문·원본 파일(대외비)이 들어 있다 | 목록·복사·복원은 `sudo`, 오프서버 사본도 사적으로 (`docs/deploy/backup.md`). db-viewer는 `dbviewer_ro` 계정으로만 붙는다 — 운영 연결 2026-11-10, SOP 원문 표까지 조회 공개·`login_records`만 제외(사용자 결정), `document_files`는 미리보기 금지 (`docs/deploy/db-viewer-readonly.md`) |
| 줄바꿈 | Windows PC 경유 CRLF 오염 | `.gitattributes` `* text=auto eol=lf`(ps1/bat/cmd만 CRLF) |
| 로컬 검증 PC는 Windows, Docker 없음 | 운영 파이프라인 | 로컬 명령은 bash·PowerShell 병기. 로컬 DB는 sqlite 파일 |
| 로컬 포트 3000/8000은 db-viewer가 점유 | 맥 개발 환경 | 로컬 dev 포트 frontend **3777**, backend **8777**(내 판단) |
| 공개 저장소 | `Nocharm/sop-archivist`는 public(사용자 결정) | 실서버 IP·사내 호스트명은 플레이스홀더(`<server-ip>` 등). 회사명·사설 대역은 유지(bpm 정책과 동일). 시크릿·`.env`·실제 SOP 원문은 절대 추적하지 않는다(저장소의 테스트·데모 문서는 합성이고 파일 이름이 `SYNTHETIC_`로 시작한다) |

## Lessons — 시행착오 방지

형제 프로젝트 bpm을 6개월 운영하며 실측으로 얻은 교훈 중 이 프로젝트에도 유효한 것과 이 프로젝트에서 직접 겪은 것을 `docs/lessons/`에 둔다(인덱스 [`docs/lessons/README.md`](docs/lessons/README.md)). **프런트 화면이나 검증 스크립트를 건드리기 전에 해당 문서를 먼저 읽을 것.**

- [`docs/lessons/react-ts-patterns.md`](docs/lessons/react-ts-patterns.md) — useCallback deps TDZ → ref 미러, `useEffectEvent`(§7)·`<Activity>`(§8), 이펙트 안 setState 린트, Tailwind display 클래스 이중 지정 금지.
- [`docs/lessons/browser-verification.md`](docs/lessons/browser-verification.md) — Playwright + 시스템 Chrome 검증, **dev DB 오염 함정**("0 events"·"목록이 비어 있음"은 코드가 아니라 오염일 수 있다), node 스크립트 cwd, 워크트리 세션 Bash 제약, 평문 HTTP는 localhost에서 재현되지 않는다, 헤드리스 blob 내려받기 이름, 그려진 글자 대비 감사.
- [`docs/lessons/git-operations.md`](docs/lessons/git-operations.md) — 히스토리 재작성·강제 푸시 전에: **같은 폴더의 다른 세션부터 확인하고 lease에 예상 해시를 명시한다**, zsh는 변수를 단어로 나누지 않으니 여러 인자는 배열로.
- [`docs/lessons/remote-sessions.md`](docs/lessons/remote-sessions.md) — 클라우드 세션이 연결된 PC 폴더를 다룰 때: **파일 전송은 비동기라 체크섬을 확인하고 쓴다**, 다른 경로로 마운트된 워크트리를 prune하지 않는다, git 쓰기에는 삭제 권한, VM에서는 맥 `node_modules`가 돌지 않는다.

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
