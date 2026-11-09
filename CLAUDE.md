# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**SOP Archivist — SOP Restructuring T/F가 쓰는 사내 AI 에이전트 웹 서비스** (FastAPI + Next.js, 사내 서버에 docker compose로 배포). 제품은 옛 SOP 묶음을 새 SOP·WI 구조로 다시 짜는 일(문서 쪼개기 → 배정·고쳐 쓰기 → 결과물 A·B·C·Excel → 검토)을 돕는다. **제품 명세: [`docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`](docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md)**(판단 기준은 `docs/domain/`), 기반 명세: [`docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`](docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md), 구현 계획: `docs/superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md`(계획 2 AI 층, 완료 — 살아 있는 것은 "API 계약" 블록. 계획 1·기반 계획은 끝나 지웠다), 프런트 디자인 기초: `frontend/docs/design/2026-11-07-frontend-design-foundations.md`, 진행 현황: `PROGRESS.md`.

> 상태: **v0.9.0 결정적 코어 + AI 제안 층 + 프런트 화면(백엔드 기능 전부 연결, 이동·움직임 공통 층, 표·카드 목록·공통 드롭다운, 첫 실사용 피드백 개편 — 사용자 메뉴·바로 생성·History·문서 정보 탐지·Split 종이 조각·피커 순위) + GitLab Runner 배포 파이프라인 완료, 운영 서버 배포됨(2026-11-09, v0.8.0 — Keycloak 연결·HR 동기화 24시간 주기), 실제 SOP·실제 모델 미검증** — v0.1.0 기반(사내 로그인 Keycloak·직원 디렉터리 HR 웹훅·사내 AI·표 기반 권한 체계) 위에 SOP 재구성의 결정적 코어(v0.2.0: 묶음·멤버십, 업로드·격리 추출(DOCX 메인, PDF·MarkItDown 보조), 규칙 쪼개기·편집·되돌리기, To-Be 목록, 배정·확정(두 입구), 결과물 A·B·C, Excel 내보내기, 검토 흐름)와 그 위의 AI 제안 층(v0.3.0: 분류·고쳐 쓰기·번역·입구 2 짝 맞추기·한/영 따로 짝·복합 문장 나누기 제안, 지침·프롬프트 버전, 채택률)을 얹었다. AI는 제안만 하고 사람이 줄마다 확정하며, AI가 꺼지거나 실패해도 사람 경로는 그대로 돈다. 프런트는 1차 화면(v0.4.0: 모든 단계 화면, G Graphite 라이트·다크, 설계 기초 `frontend/docs/design/2026-11-07-frontend-design-foundations.md`)이 붙었다. AI 층은 가짜 AI와 합성 SOP로만 검증했고 **유사도 임계값은 합성 자료로만 잡은 값**이다(실제 모델·SOP 시험 뒤 다시 정한다). 배포·운영 절차는 `docs/deploy/`(인덱스 `docs/README.md`), 배포는 사내 GitLab 파이프라인으로만 한다(`docs/deploy/gitlab-runner.md`).
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
.venv/bin/python -m scripts.seed_sop_demo # 로컬 전용(운영 DB 금지): 합성 SOP 묶음 4개(쪼개기 직후·분류 절반·검토 대기·AI 제안)를 앱 API로 만든다(작성자 qa.member, 검토자 qa.lead). AI 제안 단계는 프로세스 안의 가짜 전송으로 돌아 AI 설정이 필요 없고 실제 모델을 부르지 않는다. 같은 제목이 있으면 건너뛰어 다시 돌려도 된다. AUTH_MODE=dev에서만 돈다(dev 의존성 python-docx 필요, DEV_ENFORCE_PERMISSIONS=true면 bundle.create가 없어 403)
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
BASE_URL=http://localhost:3777 node scripts/pw-contrast-audit.mjs   # 11화면 × 라이트·다크, 4.5:1
BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs     # 시스템 설명서(docs/manual/) 화면 그림·번호 위치 다시 뽑기 — reset_db → seed_sop_demo 직후, 끝에 묶음 3을 검토 완료로 바꾼다

# 가짜 AI — 고정 응답, 배선 확인용 (저장소 루트에서, 포트 9999). 합성 응답이라 프롬프트 품질·정확도의 근거가 아니다
node frontend/scripts/fake-ai-server.mjs   # FAKE_AI_SPLIT=1이면 분류 답이 문장을 둘로 나눈다(AI 나눔 확정 경로 스모크용)
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
| **frontend** | Next.js 16 (TypeScript, React 19, Tailwind 4) + `oidc-client-ts` | 로그인 게이트·앱 틀(상단 막대 + 단계 레일/탭)·묶음 목록(`/`)·SOP 단계 화면(문서·쪼개기·To-Be·분류·짝 맞추기·결과물·검토)·내 신원·권한(`/account`)·관리 화면(권한 관리·직원 동기화·배치 작업·AI). UI 영어 기본 + 한국어 전환, 라이트·다크 |
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

**backend 핵심 모듈:**
- `app/main.py` lifespan: Alembic `upgrade head` → (dev 모드만) dev 디렉터리 시드 → 끊긴 AI 작업 회수(늘) → HR 동기화 스케줄러, AI 작업 워커(`app/sop/ai/runner.py`, AI나 임베딩이 켜져 있을 때만). 라우터는 `app/routers/`(`auth`·`me`·`directory`·`access`·`admin`과 SOP용 `sop_bundles`·`sop_tobe`·`sop_documents`·`sop_decisions`·`sop_outputs`·`sop_admin`·`sop_ai`).
- `app/auth.py`: Keycloak은 서명·issuer에 더해 `azp == KEYCLOAK_CLIENT_ID`까지 검사(같은 realm의 다른 앱 토큰 거부, 빈 값이면 전부 거부). dev는 `X-Dev-User` 헤더 신뢰(서버에서 쓰면 안 됨).
- **`app/access/` = 권한 판정 단일 소스.** `catalog.py` `PERMISSIONS`(권한 키는 코드가 정의) · `resolve.py` `get_effective_access`(개인 부여 ∪ 소속 부서 체인 부여, 역할은 권한으로 펼침, 퇴직자 무권한, `APP_SYSADMINS`는 전권) · `deps.py` `require_permission("<key>")`(라우터 의존성). `sources.py`(권한 출처 응답 `SourceOut`·대상 이름 조회 — `/api/me`의 `sources`와 유효 권한 조회가 공유). `require_permission`·`/api/me`·관리 화면의 유효 권한 조회가 모두 `get_effective_access` 하나를 부른다 — 판정을 다른 곳에 새로 쓰지 않는다. 부여는 더하기만 있고 부서 부여는 하위 부서까지 내려간다. 대상은 FK 없이 두어 개편으로 사라진 부서·사람의 부여도 지우지 않고 `subject_missing`으로 보인다.
- `app/hr/`: HR 웹훅(`client`)·동기화 가드 3종(건수 정합·빈 피드·삭제 상한)·`source="hr"` 행만 지움(`service`)·내장 스케줄러(`scheduler`)·회차 기록(`history`). `app/orgchart.py`: 부서 체인 해석.
- **`app/sop/` = SOP 재구성 코어(AI 없이 사람이 끝까지 가는 결정적 경로, 계획 1. AI 층은 아래 `app/sop/ai/`).** 코드 값은 `constants.py`, 표 26개는 `models.py`(Alembic `0005_sop_core`·`0006_warning_kind_length`, AI 작업·제안·지침·임베딩 표 4개는 `0007_sop_ai`). 흐름: 업로드 `ingest.py` → **추출은 spawn 자식 프로세스**(`extract/worker.py` — 메인 `docx_reader`/`pdf_reader`와 보조 `aux_compare`(MarkItDown)를 시간·메모리 한도를 따로 걸고 차례로, 결과 타입은 `extract/types.py`의 피클 가능한 불변 값, 업로드 동시 파싱은 `ingest.MAX_PARALLEL_PARSES=2` 세마포어) → 쪼개기 `segment.py`·`coverage.py`·`spans.py`(순수)와 단위 생성 `units.py` → 편집 `editing.py`(서버 되돌리기/다시 하기)·한/영 짝 `pairs.py` → 배정·확정 `decisions.py`(관계 묶음 단위 저장)·입구 2 짝 맞추기 `match.py` → 결과물 `snapshot.py`(묶음을 DB 표마다 질의 한 번으로 읽은 불변 값) 위의 **순수 함수** `outputs.py`(A·B·C·요약)와 `excel_export.py`·`flow_image.py`(Pillow, 저장소에 넣은 NanumGothic OFL 글꼴 `assets/fonts/`)·`output_labels.py`(언어별 문구) → 검토 `review.py`. 업로드 때 문서 번호·버전·언어 배치 규칙 탐지는 `doc_meta.py`(파일 이름 값이 먼저, New 문서의 번호는 파일 이름에서만), Bundle 순차 코드는 `bundle_code.py`(`BND-{id:04d}`). 그 밖에 `tobe.py`·`tobe_excel.py`(To-Be 목록·Excel 가져오기), `checks.py`(숫자·단위·부정 문장 검사), `filename.py`(파일 이름 파싱), `membership.py`(묶음 접근 — 권한과 별개), `events.py`(작업 기록), `schemas.py`(입력 글자 공통 규칙). 라우터는 `routers/sop_*.py`. 원문 글자는 앱 로그에 남기지 않는다.
- **`app/sop/ai/` = AI 제안 층(계획 2, v0.3.0).** 요청(`routers/sop_ai.py`)은 `ai_jobs` 행을 쌓고(`jobs.py`) 곧바로 응답한다. 백엔드 안의 단일 실행기(`runner.py`, lifespan 워커 — AI나 임베딩이 켜져 있을 때만)가 작업을 id 순으로 꺼내 **`load`(짧은 세션: 스냅샷 읽기·`revision` 적기) → `compute`(세션 없이 임베딩·LLM 호출) → `apply`(새 세션, 묶음을 `FOR UPDATE`로 잠근 뒤 상태를 다시 보고 쓴다)** 세 단계로 돌린다. 종류별 핸들러는 `JobHandler`(`load`/`compute`/`apply`)를 구현해 `handlers.py` `HANDLERS` 표에 등록한다: `classify.py`(칸 고르기+한·영 고쳐 쓰기)·`translate.py`·`match_jobs.py`(입구 2 `match_plan`이 코드로 묶고 `match`가 LLM에 변경 종류만 묻는다)·`pairing.py`(한/영 따로 짝, 임베딩만)·`split.py`. 순수 부분은 `matching.py`·`similarity.py`(코사인·글자 2-gram)·`candidates.py`(칸 후보)·`context.py`(앞뒤 단위·절·Markdown 표), 호출은 `llm.py`(원문을 구분자 데이터로 감싸기·재시도·응답 JSON 파싱)·`embeddings.py`(캐시 `embed_texts`), 공용 쓰기는 `apply.py`(낡음 판정·밀린 제안 걷기·제안 행·무효 보류)·`adoption.py`(채택 판정과 채택률), 수치는 `constants.py`, 지침·프롬프트 버전은 `guidelines.py`와 `seeds/`, 요청·응답 모양은 `schemas.py`다. 문서 정보 제안(`doc_meta_job.py`, v0.9.0)은 사람이 요청하지 않고 업로드 때 규칙이 비운 번호·버전만 묻는다(AI가 켜져 있을 때) — 값은 제안 행으로만 남고 문서 목록에서 사람이 눌러야 저장된다(시험의 공용 가짜 AI는 이 자동 작업을 끄고, `test_sop_ai_doc_meta`만 켠다). 지침 관리는 `routers/sop_guidelines.py`(`guideline.manage`). 프런트와 맞춘 API 계약은 계획 2 문서의 "API 계약" 블록이다.
- **떼어 내기는 한 함수군**: 배정 지우기·문서 삭제·쪼개기 편집·새 문장 다시 맞추기가 모두 `detach.py` `detach_units`/`detach_targets`로 판단을 미배정·보류로 돌린다 — 새 경로가 판단·출처 연결을 직접 지우지 않는다.
- `app/ai_client.py`·`app/ai_usage.py`: OpenAI 호환 사내 GLM 호출(`call_ai`)과 임베딩 호출(`call_embeddings`, `EMBED_*`, 같은 동시성 세마포어) + 호출 1건당 `ai_usage_events` 한 행(원문 없음). 사용량은 `record_ai_usage`가 자기 짧은 세션으로 남긴다.
- 시각은 전부 `DateTime(timezone=True)`와 `app.clock.now()`(KST). 프런트 표시는 `lib/datetime.ts`(Asia/Seoul).

**frontend 핵심:** `src/lib/api.ts` `apiFetch`(인증 헤더, dev 사용자는 요청마다 localStorage에서 읽음) · `api-errors.ts` `humanizeApiError`(상태 코드별 사람 말 문구, 서버 원문은 422 검증 사유에만) · `access.ts` 권한 카탈로그 미러 · `i18n-messages.ts` en/ko 메시지 · `keycloak-login.ts` OIDC 설정 단일 소스(PKCE는 `crypto.subtle`이 있을 때만) · `genId()`·`copyText()`(secure context 우회). localStorage 키 접두는 `sopa.`. SOP 화면: `api-sop.ts`(SOP API 호출·응답 타입), 화면 규칙은 순수 모델에 두고 시험한다 — `paper-model`(원문 용지)·`tobe-draft`(To-Be 초안, 하위 항목은 줄 키에 묶고 단계 번호는 다시 매기지 않는다)·`classify-model`(분류 줄·보낼 곳·저장 요청 — 새 문장 칸 단위로 AI 나눔·합침 보존)·`match-model`. 공용 훅·저장소: `bundle-store`(묶음 캐시 — 화면 진입마다 다시 부르고 로그아웃·사용자 전환 때 비운다)·`use-ai-jobs`(AI 작업 폴링)·`leave-guard`(미저장 이탈 가드)·`use-loaded`. `ui-prefs`(화면 설정 값 목록)와 `layout.tsx`의 첫 페인트 전 boot 스크립트가 같은 값을 쓴다. **UI 규칙(디자인 기초 문서)**: raw hex는 `src/styles/tokens.css` 밖에서 쓰지 않고, 다크는 토큰만 바꾸며 화면 코드가 테마로 분기하지 않고, 상태 표기는 화면 언어와 상관없이 영어다. **이동·움직임 공통 층**: 앱 안 이동은 `lib/nav-buffer.ts` `navigate()`(0.6초 버퍼, 같은 곳 재클릭·Esc 취소)로 하고 링크 클릭은 `components/nav-host.tsx`가 창 캡처 단계에서 같은 길로 돌린다 — 사람이 고른 이동에 `router.push`를 새로 쓰지 않는다(저장 안 한 변경 가드 `useLeaveGuard`도 이 길에 걸려 있다). 접기·쉬머·폭 모핑·말줄임 툴팁은 `components/ui/motion.tsx`, 긴 목록은 `lib/use-progressive-list.ts`, 호버로 드러나는 보조 단추는 `.row-actions`(`styles/motion.css`). 백엔드에만 있던 묶음 관리·AI 요청·관리 묶음·AI 지침 API는 `lib/api-manage.ts`. Markdown 글(AI 지침)의 읽기 보기는 `components/ui/markdown-view.tsx` 하나를 쓴다(escape 뒤 서식만 태그로 — 원문 HTML을 그대로 넣는 길을 새로 만들지 않는다). **목록·값 고르기 공통 부품**: 읽기 위주 목록은 `components/ui/data-list.tsx` `DataList`(열 정의 하나로 표·밀도 높은 카드, 보기는 `ListViewToggle`·`lib/use-list-view.ts`가 목록마다 `sopa.listView.<key>`에 기억, 남은 폭을 채우는 열은 `grow`)를 쓰고, 값 하나 고르기는 `components/ui/select.tsx` `Select`(떠 있는 목록은 `Menu` listbox, 항목 testid `<testId>-option-<value>`, 스모크는 트리거→항목 클릭)를 쓴다 — 기본 `<select>`를 새로 쓰지 않는다. 본문 폭 상한은 `tokens.css` `--page-max`(1280)·`--page-max-wide`(1600, 쪼개기·분류·짝 맞추기)이고 `AppShell`의 `.page-wrap`이 건다(좁은 창에서도 좌우 최소 여백). **화면 공통 부품(v0.9.0)**: 브라우저 기본 모양(체크박스·라디오·`title` 툴팁)을 쓰지 않는다 — `components/ui/checkbox.tsx` `Checkbox`(숨긴 네이티브 입력 위에 토큰으로 그림)·`tooltip.tsx` `Tooltip`·`info-tip.tsx` `InfoTip`(개념 설명은 본문 대신 (i) 툴팁). 삭제류 아이콘 단추는 `morph-button.tsx` `MorphButton`(평소 아이콘, 호버 때 라벨이 펼쳐짐, `tone="danger"`), 빈 화면은 `empty-state.tsx` `EmptyState`(가운데 박스), 알림은 `toast.tsx`(오른쪽 위, 새 것이 위, 빠질 때 높이 접기). 상단 막대는 `user-menu.tsx`(계정·관리·레이아웃 하위 메뉴 — 자리가 없으면 `lib/flyout.ts`로 왼쪽·로그아웃·마지막 로그인)와 `lang-toggle.tsx`(EN|KO). 사람 고르기(`subject-picker.tsx`)는 `lib/directory-cache.ts`가 직원 전체(`/api/directory/all`)를 한 번 받아 `lib/people-order.ts`(bpm `lib/search.ts`·`hangul.ts`를 옮긴 순위 — 이름 > 한글 이름 > 아이디, 부서명으로는 찾지 않음, 비었으면 내 부서 코드 체인 먼저)로 정렬하고 25명씩 이어 그린다. 라벨은 짧은 명사형, 도메인 용어 Bundle·Old·New·Unit은 화면 언어와 상관없이 영어(산출물 문구는 제외).

언어 규칙은 backend → `rules/languages/python.md`, frontend → `rules/languages/typescript.md`. 컨테이너/설정 규칙은 `rules/backend/` 참고.

## 체크리스트 — 같이 움직여야 하는 곳

- **새 권한(permission) 추가 — 3곳을 한 커밋에서:** backend `app/access/catalog.py` `PERMISSIONS` ↔ frontend `src/lib/access.ts` `PERMISSIONS`(같은 값·같은 순서, 표시 순서의 기준) ↔ i18n `permission.<key>`(en·ko, `src/lib/i18n-messages.ts`). 권한 키 자체가 `permission.`으로 시작하면(`permission.manage`) 메시지 키가 `permission.permission.manage`가 된다. 라우트는 `Depends(require_permission("<key>"))`로 막고 — 모르는 키는 import 때 `ValueError`다. 카탈로그에서 키를 빼면 저장된 역할·부여의 그 키는 판정에서 조용히 버려진다(행은 남음).
- **새 `/api/admin/*` 엔드포인트:** 라우터 단 게이트가 없으니 엔드포인트마다 권한 의존성이 필수다. `test_every_admin_route_rejects_a_user_without_permissions`가 권한 없는 사용자로 전 라우트를 순회해 누락을 잡는다. `/api/access/*`는 라우터 단에 `permission.manage`가 걸려 있다.
- **새 env:** backend `app/settings.py` · `.env.example` · `docker-compose.yml` backend `environment:`(`VAR: ${VAR:-}`) **3곳**. backend에 `env_file`이 없어 compose에 빠지면 서버에서만 조용히 기본값이다. 빈 문자열이 기동을 죽이는 int/bool 필드는 Settings 기본값과 같은 값을 폴백으로 둔다. 시크릿 값은 어디에도 쓰지 않는다(이름만).
- **모델 변경 = Alembic 리비전 필수.** `backend/alembic/versions/`에 `--rev-id 000N`으로 만든다(`create_all`은 쓰지 않는다). 모델과 마이그레이션이 어긋나면 `test_models_match_migrations`(`compare_metadata`)가 잡지만 **CHECK 제약 차이는 못 잡는다** — 제약을 건드리면 마이그레이션된 DB에 직접 부딪쳐 보는 테스트를 둔다(`test_migrations.py`). 시각 컬럼은 `DateTime(timezone=True)`. `batch_job_runs`는 백업 사이드카가 psql로 쓰는 계약이라 컬럼을 바꾸면 `scripts/db-backup.sh`의 INSERT도 함께 바꾼다.
- **AI 호출:** 페이로드에 직원 실명(`name`·`korean_name`)을 싣지 않는다 — 역할·부서 등 비식별 정보만. 호출은 `call_ai_recorded`를 거쳐 사용량 행을 남기고(실패도 `ok=false`), 사용자에게 보이는 오류는 AI 주소·토큰을 뺀 문구다. **AI 호출 동안 DB 연결을 잡지 않는다** — `call_ai_recorded`는 세션을 받지 않고, 요청 세션을 쓴 핸들러는 호출 직전 `await session.close()`로 돌려준다(`ping_ai`). AI 작업은 이 규칙을 구조로 지킨다 — 아래 "AI 제안 층 불변식".
- **AI 제안 층 불변식 (`app/sop/ai/`) — 새 AI 종류·쓰기 경로를 더할 때 지킨다.**
  - **`load/compute/apply` 계약**: 핸들러의 `compute`는 세션을 받지 않는다. `load`가 필요한 값을 불변 값으로 꺼내 세션을 닫고, 임베딩·LLM 호출은 그 뒤에 하며, 쓰기는 묶음을 잠근 `apply`에서만 한다(그 사이 사람이 쪼개거나 지워서 `load`가 적은 `revision`·해시가 달라졌으면 `stale`로, 검토를 요청해 묶음이 작업 중이 아니면 실행기가 `apply`를 하지 않고 `cancelled`로 끝낸다). 커밋은 실행기가 해서 상태 전이와 한 트랜잭션이다. 사용량 기록도 호출 뒤 자기 짧은 세션이다(`record_ai_usage`). AI 호출 동안 열린 세션이 있는 핸들러는 없어야 한다. LLM까지 가야 끝나는 작업의 `compute`는 임베딩보다 먼저 `llm.ensure_llm_enabled()`를 부른다(AI가 꺼지면 아무것도 보내지 않고 `config`다. 임베딩만 쓰는 `pair`는 제외).
  - **AI는 제안만 한다**: `confirmed_text`를 쓰지 않고, `confirmed`·`on_hold` 행을 덮지 않으며, 같은 종류의 이전 제안 위에만 쓴다(밀린 제안은 `result=stale`, 채택이 이미 남은 제안은 `applied` 그대로 둔다). 응답은 정해진 JSON 필드로만 읽고 후보 밖이면 그 단위만 보류한다. 응답의 모든 글자는 `replace_unstorable_chars`를 거치고, 무효 제안에는 응답 원문을 남기지 않는다. 로그에는 ID·건수·상태 코드·예외 클래스 이름만 쓴다(`logger.exception` 금지, 트레이스백에 값이 실린다).
  - **임계값은 합성 자료로만 잡은 값이다**(`constants.py`의 `MATCH_EMBED_THRESHOLD`·`MATCH_TEXT_THRESHOLD`·`PAIR_THRESHOLD` 등). 합성 시험(`tests/fake_ai.py` `SyntheticAnswers`, `tests/ai_fixtures.py`)은 배선과 규칙의 검증이지 실제 모델 연결이 아니라서, 실제 모델·SOP로 시험하기 전에는 정확도·채택률을 근거로 주장하지 않는다. 숫자를 바꾸면 합성 시험을 같이 옮기고, 실제 시험 뒤 다시 정한다.
  - **번역은 출처 새 문장을 따른다**: 출처의 글·자리(칸 좌표·부모·출처 단위 집합 포함)가 바뀌거나 출처가 사라지면 `detach.sweep_translations`가 AI 번역은 지우고(제안 `stale`) 확정 번역은 보류(`system:related_unit_changed`)로 돌린다. 저장(`decisions`)·순서 바꾸기(`routers/sop_outputs`)·떼어 내기(`detach`)·입구 2 새 문장 맞추기(`match.sync_new_doc_targets`)가 이것을 부르니, 새 문장의 글이나 자리를 바꾸는 새 경로도 부른다. 출처가 그대로인 AI 번역은 표에 딸려 와도 일반 보류에서 뺀다(`detach._should_hold`, 보류하면 확정 글이 빈 보류가 된다). 번역 줄의 자리는 출처를 따라 잠겨 있다(저장 경로는 422 `invalid_group`의 사유 `translation_locked`, 순서 바꾸기 엔드포인트는 422 `translation_locked`).
  - **기록**: 채택은 사람의 저장 트랜잭션 안에서 `adoption.py`가 남기고 처음 정한 판정이 남는다. 작업 기록(`bundle_events`)에는 `ai.request`·`ai.cancel`·`ai.retry`만 쓰고 적용·채택은 쓰지 않는다(조회 상한 500을 큰 분류가 채우지 않게).
- **프런트 텍스트:** en·ko 메시지를 한 쌍으로 추가한다(`i18n-messages.test.ts`가 키 집합을 가드). 인터랙티브 요소에는 `data-testid`(`rules/frontend/identifiers.md`).
- **새 업무 규칙 거절 코드(`raise_rule`) = 프런트 문구:** 화면에서 닿을 수 있는 코드면 `rule.<code>` en·ko 문구를 같이 더한다(없으면 `humanizeApiError`가 상태 코드 문구로 떨어져 사용자가 이유를 못 본다). 세부 사유가 있는 거절은 `rule.<code>.<reason>`.
- **SOP 규칙 이중 사용 지점 — 아래는 각각 한 곳에만 쓴다.** 두 번째 구현을 만들면 커버리지·상태가 조용히 어긋난다.
  - **빈 글자 판정 `segment.py`의 `is_blank_char`·`has_visible_char`·`INVISIBLE_CHARS`**: 추출기·쪼개기·커버리지(`coverage.py`)가 모두 이것을 쓰고, 누락 대조의 `aux_compare.normalize_for_compare`는 같은 판정의 빠른 사본이다. `isspace()`를 새로 쓰지 않는다 — 불변식(공백 아닌 글자를 빠짐없이·겹침 없이 덮는다)이 이 판정 위에 서 있다.
  - **관계 묶음 그래프 `groups.collect_component`**(출처 연결 + 표↔칸 새 문장 연결): 묶음 읽기(`build_group_out`)·저장의 닫힘 검사(`decisions`)·떼어 내기(`detach`)가 같은 그래프를 본다. 묶음 ID와 표 접기도 `groups.py` 하나(결과물 A도 쓴다). 연결 종류를 더하면 `_find_neighbors` 하나만 고친다.
  - **커버 상태 `status.get_cover_status`**: 칸 문장은 묶인 표·행 단위의 판단을 따른다. view·단위 목록·결과물·검토 조건이 이 함수를 부르고, SQL로 다시 쓴 사본 셋(`coalesce(group_decision.status, UnitDecision.status)` — `decisions` 단위 목록 거르기·`snapshot.load_bundle_progress`·`match`)은 규칙을 바꾸면 함께 고친다.
  - **새 문서 새 문장 맞추기 `match.sync_new_doc_targets`**: 쪼개기 편집·되돌리기·다시 하기 뒤 새 문서 하나의 절 경로·언어·칸 부모·좌표·순서를 통째로 다시 맞춘다. 단위를 바꾸는 새 경로가 새 문장을 직접 고치지 않고 이것을 부른다.
  - **편집 쓰기 길 `editing._write_change`**: 편집·되돌리기·다시 하기가 하나로 합쳐 검사(판단 있는 단위·확인 플래그) → 단위 은퇴·생성 → 떼어 내기·맞추기 → 커버리지 가드 → 문서 revision +1을 돈다. 새 편집 종류는 `_Change`로 이 길에 얹는다.
  - **입력 글자의 NUL·서로게이트 `schemas.NO_NUL`/`NoNulStr`**: Postgres text는 NUL을 담지 못하고 sqlite는 받아 줘 테스트에 안 보인다. DB까지 가는 새 글자 입력 칸은 이 타입을 쓴다(`StringConstraints`가 있으면 그 뒤에 `NO_NUL`, 앞에 두면 길이를 공백을 걷기 전에 잰다). 선택 칸은 `Field(max_length)`가 아니라 `Annotated[str, StringConstraints(max_length=…), NO_NUL] | None`으로 쓴다(`| None`에 `Field` 상한을 걸면 오류 종류가 `string_too_long`이 아니라 `too_long`이다). 저장 못 하는 글자(NUL·U+D800–DFFF)의 판정은 `segment.has_unstorable_char` 하나이고, 파일 이름은 `ingest_upload`가 422 `invalid_file_name`으로 막으며, 추출·AI 응답 글자는 `segment.replace_unstorable_chars`가 같은 길이의 대체 문자로 바꾼다.
  - **업무 규칙 거절 `errors.raise_rule(status, code, **context)`**: `detail={"code", ...문맥}` 모양 하나(입력 형식 오류만 422 `{"detail": [{type, loc, msg}]}` — `main.handle_validation_error`가 `input`·`ctx`를 빼 요청 원문이 응답·로그로 되돌아가지 않게 한다). revision 충돌은 `check_revision`이 409 `revision_conflict`와 `conflicts[].current_revision`으로 낸다. `app/sop`·`routers/sop_*`에서 `HTTPException`을 직접 던지지 않는다.
  - **결과물 `outputs.py`**: A·B·C·요약 숫자는 스냅숏(`snapshot.py`)만 받는 순수 함수이고 보낸 곳·칸 순서·신규 판정은 한 벌이다. Excel(`excel_export.py`)은 이 결과를 옮겨 쓰기만 하고, 검토 조건(`review.py`)은 `outputs.build_review_facts`의 단위 재료를 쓴다 — 같은 규칙을 다시 계산하지 않는다. Excel의 모든 글 칸은 `write_text_cell` 하나로 쓴다(수식 방지).
- **SOP 데모·E2E는 한 벌의 몰이를 쓴다**: `backend/scripts/sop_demo_driver.py`(API로 업로드→편집→배정→검토까지 모는 쪽)를 E2E 테스트(`tests/test_sop_e2e.py`)와 데모 시드(`scripts/seed_sop_demo.py`)가 함께 쓰고, 정답은 합성 생성기 `scripts/synthetic_sop.py`가 만드는 `SYNTHETIC_expected.json`(모든 합성 파일 이름은 `SYNTHETIC_`로 시작)이다. SOP API 모양이나 규칙을 바꾸면 드라이버·생성기 정답과 두 소비자를 함께 확인한다. AI 경로는 `tests/fake_ai.py`의 `SyntheticAnswers`가 같은 정답으로 답한다(단순한 답은 정답, 합침·중복 배정·표·외부 이동은 무효 응답으로 사람 경로) — 합성 검증이고 실제 모델 연결이 아니다. 시드 명령은 위 Commands(로컬 전용, 운영 DB 금지).

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
| 백업 디렉터리는 root 전용 `0700` | 덤프에 직원 디렉터리 전 행과 SOP 원문·원본 파일(대외비)이 들어 있다 | 목록·복사·복원은 `sudo`, 오프서버 사본도 사적으로 (`docs/deploy/backup.md`). db-viewer는 `dbviewer_ro` 계정으로만 붙는다 (`docs/deploy/db-viewer-readonly.md`) |
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
