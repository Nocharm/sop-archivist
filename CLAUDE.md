# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**SOP Archivist — SOP Restructuring T/F가 쓰는 사내 AI 에이전트 웹 서비스** (FastAPI + Next.js, 사내 서버에 docker compose로 배포). 옛 SOP 묶음을 새 SOP·WI 구조로 다시 짜는 일(문서 쪼개기 → 배정·고쳐 쓰기 → 결과물 A·B·C·Excel → 검토)을 돕는다. **제품 명세: [`docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`](docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md)**(판단 기준 `docs/domain/`), 기반 명세 `docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`, 프런트와 맞춘 API 계약은 `docs/superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md`의 "API 계약" 블록, 프런트 디자인 기초 `frontend/docs/design/2026-11-07-frontend-design-foundations.md`.

> 상태: **v1.0.0 — 운영 배포 2026-11-14**(운영 :7777, 개발 스택 :4444). 기능 이력은 `CHANGELOG.md`, 지금 진행은 `PROGRESS.md`. **실제 SOP·실제 모델 미검증** — AI 층은 합성 SOP·가짜 AI로만 검증했고 유사도 임계값은 합성 자료로 잡은 값이다(실제 시험 뒤 다시 정한다).
> **서비스 버전**: 단일 소스 `frontend/package.json` `version`(상단 바에 표시). `dev`에 올릴 때마다 PATCH, `dev`→`main` 정식 업데이트마다 MINOR + `vX.Y.Z` 태그(`rules/common/git.md`). 커밋·푸시는 GitHub에만, 사내 GitLab push·배포는 사용자. 운영 배포일은 CHANGELOG에 적는다.
> **DB**: 로컬은 sqlite 파일(연결마다 `PRAGMA foreign_keys=ON`), 서버는 postgres. 스키마는 **Alembic**(backend 기동 때 head까지 자동 적용).
> **원칙**: AI는 제안만 하고 사람이 줄마다 확정한다 — AI가 꺼지거나 실패해도 사람 경로는 돈다. AI 페이로드에 직원 실명을 싣지 않는다(역할·부서만). 공개 저장소라 실서버 IP·사내 호스트명·시크릿은 추적 파일에 넣지 않는다(`<server-ip>` 등).

## Commands

자주 쓰는 것만 bash로. PowerShell 병기·스크립트마다의 전제(DB·포트·env)·감사 옵션·배포 스크립트 검증은 [`docs/qa/verification-commands.md`](docs/qa/verification-commands.md).

```bash
# backend/ — 배포 런타임과 같은 Python 3.11 venv
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m scripts.reset_db        # 로컬 데모 DB(backend/dev.db). 서버 실행 금지
.venv/bin/python -m scripts.seed_sop_demo   # 합성 SOP 묶음 4개(로컬 전용, AUTH_MODE=dev). 극단 자료는 seed_sop_worst
AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin .venv/bin/uvicorn app.main:app --reload --port 8777
.venv/bin/python -m pytest tests/ -q -n auto   # 작업자마다 DB 파일이 따로. 한 파일만 볼 때는 -n 없이
.venv/bin/ruff check app/ tests/
.venv/bin/alembic revision --autogenerate --rev-id "<다음 번호>" -m "<설명>"   # 생성물을 직접 검토
# frontend/
npm install && npm run dev                  # :3777, /api는 BACKEND_URL(기본 :8777)로 프록시
npm run build                               # 경고 0이어야 한다. next dev를 먼저 내린다
npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run   # 커밋 전 필수
# 브라우저 검증(npm i --no-save playwright-core, 시스템 Chrome): scripts/pw-smoke-sop.mjs · pw-layout-audit.mjs(DS=worst) · pw-overlap-audit.mjs · pw-contrast-audit.mjs · pw-manual-shots.mjs
node frontend/scripts/fake-ai-server.mjs    # 가짜 AI :9999(저장소 루트에서, FAKE_AI_SPLIT=1이면 나눔). 배선 확인용, 정확도 근거 아님
# dev 인증 = localStorage `sopa.devUser` / 헤더 `X-Dev-User`. 권한 차등은 DEV_ENFORCE_PERMISSIONS=true(dev.admin이 sysadmin)
```

## Architecture

모노레포, 서비스 5개(앱 4 + 백업 사이드카)를 docker compose 프로젝트 `sop-archivist`로 묶어 nginx 뒤에 둔다.

| 레이어 | 스택 | 역할 |
|--------|------|------|
| **proxy** | nginx 1.27 | `/api` → backend, 나머지 → frontend. 노출 포트 `APP_PORT`(운영 7777). X-Frame-Options·frame-ancestors를 붙이지 않는다(Keycloak silent 갱신이 `/login`을 iframe으로 부른다) |
| **frontend** | Next.js 16 · React 19 · TS · Tailwind 4 · `oidc-client-ts` | 로그인 게이트, 묶음 목록, SOP 단계 화면(문서·쪼개기·To-Be·Assign·결과물·검토), 계정·관리 화면, 사용 설명서 `/manual`. UI 영어 기본 + 한국어, 라이트·다크 |
| **backend** | Python 3.11 · FastAPI · SQLAlchemy(async) · Alembic · Pydantic | 인증(Keycloak RS256·dev), 직원 디렉터리(HR 웹훅), 권한, 관리 API, 사내 AI 연결, SOP 재구성 코어(`app/sop/`, `routers/sop_*`), AI 제안 층(`app/sop/ai/`) |
| **db** | PostgreSQL 16 | `dbv-shared` 네트워크 별칭 `sop-archivist-db`(db-viewer 읽기 전용) |
| **db-backup** | `postgres:16-alpine` | 일간 04:00 KST `pg_dump -Fc`, 14일 보존, `batch_job_runs`에 기록(`docs/deploy/backup.md`) |

**경계:** 브라우저 → `:7777` nginx → (Next.js | FastAPI) → PostgreSQL. 로컬은 Next rewrites가 `/api`를 `BACKEND_URL`로 넘긴다. 입력 검증은 backend API 경계(`rules/common/security.md`). 인증은 Keycloak realm `ai-portal`의 public 클라이언트 `sop-archivist-frontend`, 주소는 `.env`(`docs/deploy/setup-once.md` A5).

**디렉터리:** `backend/`(앱·Alembic·시드 `scripts/`·tests) · `frontend/`(src/app·components·lib, `scripts/` 스모크·가짜 AI) · `nginx/` · `scripts/db-backup.sh` · `ci/`(`deploy.sh`·`test-deploy.sh`, `.gitlab-ci.yml`이 부름) · `docs/`(인덱스 `docs/README.md`).

**세부 구조는 폴더별 CLAUDE.md에** — 그 폴더의 파일을 읽을 때 함께 실리고, 실리지 않은 채 그 폴더를 고치게 되면 먼저 직접 읽는다. [`backend/CLAUDE.md`](backend/CLAUDE.md)(핵심 모듈·AI 제안 층 불변식·SOP 규칙 이중 사용 지점, Python·설정 규칙을 불러옴) · [`frontend/CLAUDE.md`](frontend/CLAUDE.md)(핵심 구조·공통 부품·사용 설명서, TypeScript·식별자 규칙을 불러옴).

## 체크리스트 — 같이 움직여야 하는 곳

양쪽에 걸친 것만. 한쪽에만 걸리는 항목은 폴더 CLAUDE.md의 같은 이름 절.

- **새 권한(permission) — 3곳을 한 커밋에서:** backend `app/access/catalog.py` `PERMISSIONS` ↔ frontend `src/lib/access.ts` `PERMISSIONS`(같은 값·순서) ↔ i18n `permission.<key>`(en·ko). 키가 `permission.`으로 시작하면 메시지 키는 `permission.permission.manage`. 라우트는 `Depends(require_permission("<key>"))`(모르는 키는 import 때 `ValueError`). 카탈로그에서 뺀 키는 저장된 역할·부여에서 조용히 버려진다.
- **새 env — 3곳:** `app/settings.py` · `.env.example` · `docker-compose.yml` backend `environment:`(`VAR: ${VAR:-}`). backend에 `env_file`이 없어 compose에 빠지면 서버에서만 조용히 기본값이다. 빈 문자열이 기동을 죽이는 int/bool은 Settings 기본값과 같은 폴백. 시크릿 값은 어디에도 쓰지 않는다.
- **새 업무 규칙 거절 코드(`raise_rule`) = 프런트 문구:** 화면에서 닿는 코드면 `rule.<code>` en·ko(세부 사유는 `rule.<code>.<reason>`). 없으면 상태 코드 문구로 떨어진다.
- **화면·동작·라벨을 바꾸면 사용 설명서도 같은 커밋에서:** `frontend/public/manual/user-manual.md` 해당 조각. backend만 고쳐 동작이 달라질 때도 같다(세부는 `frontend/CLAUDE.md`).

## Operations / Deployment

로컬(네이티브)과 서버(docker compose)가 달라, 아래를 어기면 로컬은 초록인데 서버에서 깨진다.

| 제약 | 반영 |
|---|---|
| **배포는 사내 GitLab 파이프라인만**(사용자 결정 2026-11-09) | 서버에서 직접 compose 하지 않는다. `.gitlab-ci.yml`(test 자동, `deploy-dev` dev push마다 자동·테스트를 기다리지 않음, `deploy-production` main 수동 ▶) → 배포 러너가 `ci/deploy.sh`로 `compose up -d --build`. `.env`는 서버 배포 폴더에만(가드 `AUTH_MODE=keycloak`·`BACKUP_DIR`, 스택마다 포트·별칭 대조). docker 호출은 빈 환경(`env -i`). `set -x`·`.env`/`compose config` 출력·`down`·`prune`·`--remove-orphans` 금지. 절차·복구 `docs/deploy/gitlab-runner.md` |
| 서버 71번, bpm 옆 | 별도 compose 스택·postgres. 포트 운영 **7777**·개발 **4444**(9900·9901·9910은 bpm). 개발 스택은 프로젝트 `sop-archivist-dev`, DB·배포 폴더·별칭이 따로, 백업 사이드카 없음 |
| 서버는 Docker Hub 차단 | 베이스 이미지는 bpm과 **같은 태그만**(`python:3.11-slim`·`node:24.22.1-alpine`·`nginx:1.27-alpine`·`postgres:16-alpine`), 바꾸면 amd64 tar 반입. Dockerfile에 `# syntax=` 금지. Docker 규칙 `rules/backend/docker.md`(Dockerfile·compose를 고치기 전에 읽는다) |
| 서버 빌드 때 외부 다운로드 금지(PyPI·npm만) | 글꼴은 저장소에(backend `app/sop/assets/fonts/`, frontend `src/app/fonts/` `next/font/local`). 새 backend 의존성은 Python 3.11 linux x86_64 휠 확인 후. `numpy`는 `onnxruntime`이 들여오는 버전에 고정 |
| 배포 런타임 Python 3.11 | `backend/ruff.toml` `target-version = "py311"`(로컬 3.12 문법 사고, bpm) |
| backend에 `env_file` 없음 | 모든 backend env를 compose `environment:`에 매핑(위 체크리스트) |
| 서버는 평문 HTTP 원격 IP | `crypto.randomUUID`·`crypto.subtle`·Clipboard 불가 → `genId`·`copyText` 폴백. Keycloak PKCE는 선택(앱이 `crypto.subtle`이 있을 때만 켠다). 검증은 localhost가 아닌 LAN IP로 |
| 로그인 콜백 `<origin>/login` | Keycloak Valid redirect·post logout URIs `http://<server-ip>:7777/*`, Web origins `http://<server-ip>:7777` — 포트·도메인마다 등록 |
| 운영 DB에 dev 모드 금지(헤더를 믿고 가짜 직원·부서를 DB에 넣어 keycloak으로 바꿔도 남는다) | 운영 `.env` `AUTH_MODE=keycloak`(배포 스크립트가 거절). 개발 스택만 dev + `DEV_ENFORCE_PERMISSIONS=true`(실제 SOP 원문을 올리지 않는다). `scripts.reset_db`도 서버 금지(`docs/deploy/setup-once.md` C절) |
| Alembic, 단일 워커 | 기동 때 `upgrade head` — Dockerfile에 `--workers` 금지. 모델을 바꾸면 리비전 필수 |
| backend 메모리 2G | 업로드 파싱 자식이 최악 문서에서 ~660MiB를 더 쓴다. `memory: 2G`·`MALLOC_ARENA_MAX`·`SOP_PARSE_MEMORY_MB`(2048)를 낮추지 않는다(자식 `RLIMIT_AS`는 `MALLOC_ARENA_MAX=2`와 함께일 때만 충분). 동시 파싱 최대 2(`docs/qa/2026-11-sop-parse-dependencies.md`) |
| 백업은 root 전용 `0700` | 덤프에 직원 전 행·SOP 원문(대외비). 목록·복사·복원은 `sudo`. 오프서버 사본도 사적으로. db-viewer는 `dbviewer_ro`로만 — SOP 원문 표까지 조회 공개(사용자 결정), `login_records` 제외·`document_files` 미리보기 금지(`docs/deploy/db-viewer-readonly.md`) |
| 줄바꿈 | `.gitattributes` `* text=auto eol=lf`(ps1/bat/cmd만 CRLF) |
| 로컬 검증 PC는 Windows·Docker 없음, 맥은 3000/8000을 db-viewer가 점유 | 로컬 명령은 bash·PowerShell 병기(문서), 로컬 DB는 sqlite, dev 포트 frontend **3777**·backend **8777** |
| 공개 저장소 `Nocharm/sop-archivist` | 실서버 IP·사내 호스트명은 플레이스홀더(회사명·사설 대역은 유지, bpm과 같음), 시크릿·`.env`·실제 SOP 원문은 추적 금지(테스트·데모 문서는 합성, 파일 이름 `SYNTHETIC_`) |

## Lessons — 시행착오 방지

`docs/lessons/`(인덱스 [`docs/lessons/README.md`](docs/lessons/README.md)). **프런트 화면이나 검증 스크립트를 건드리기 전에 해당 문서를 먼저 읽는다.**

- [`react-ts-patterns.md`](docs/lessons/react-ts-patterns.md) — useCallback deps TDZ, `useEffectEvent`(§7)·`<Activity>`(§8), 이펙트 안 setState, Tailwind display 이중 지정.
- [`browser-verification.md`](docs/lessons/browser-verification.md) — Playwright + 시스템 Chrome, **dev DB 오염 함정**, 폴더마다 `next dev` 하나, 평문 HTTP는 localhost에서 재현 안 됨, 글자 대비 감사.
- [`ui-review.md`](docs/lessons/ui-review.md) — **극단 자료에서만 무너지는 표**, 처방은 화면에 주입해 잰 뒤, grid `minmax(0, 1fr)`, 줄 끝 단추는 흐리게.
- [`git-operations.md`](docs/lessons/git-operations.md) — 강제 푸시 전에 **같은 폴더의 다른 세션부터 확인, lease에 예상 해시**, zsh는 변수를 단어로 나누지 않는다.
- [`remote-sessions.md`](docs/lessons/remote-sessions.md) — 클라우드 세션 파일 전송은 비동기(체크섬), 다른 경로로 마운트된 워크트리를 prune하지 않는다.

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

## Rules — 필요할 때 읽는 것

세션마다 싣지 않는다(2026-11-14 문맥 정리). 언어·폴더 규칙은 폴더 CLAUDE.md가 불러온다 — `rules/languages/python.md`·`rules/backend/config.md`는 `backend/CLAUDE.md`, `rules/languages/typescript.md`·`rules/frontend/identifiers.md`는 `frontend/CLAUDE.md`. Docker는 `rules/backend/docker.md`(Dockerfile·compose를 고치기 전에), 동기화 점검은 `rules/backend/sync-checklist.md`(`/sync`·`/sync-all` 때).
