# SOP Archivist — 기반 세팅(사내 인프라 이식) 설계

- 날짜: 2026-11-04
- 저장소: 템플릿 `Nocharm/claude_Template` `main`(`bd31555`)에서 분기한 워크트리(이 저장소 루트, 브랜치 `feat/sop-archivist`, 템플릿 클론은 `../claude-code-template`)에서 시작하고, 첫 커밋부터 **별도 공개 저장소 `Nocharm/sop-archivist`** 로 올린다(사용자 결정 2026-11-04). 템플릿 클론에 remote `sop-archivist`를 두고 이 브랜치를 그 저장소 `main`으로 push한다. 배포 기준은 그 저장소의 `main`, 버전 태그도 그 저장소에만 단다. Windows PC·서버는 새 저장소를 clone한다. 템플릿 규칙 갱신은 필요할 때 템플릿 `main`을 이 브랜치로 수동 머지한다(이 브랜치는 템플릿 메타를 지우므로 템플릿 `main`으로 되돌려 합치지 않는다). **2026-11-08 분리**: 히스토리에서 템플릿 커밋을 걷어 내고(첫 커밋이 이 설계 문서, 트리·작성 정보는 그대로라 해시와 태그 v0.1.0–v0.4.0만 다시 만들어졌다) 이 폴더를 독립 clone(`origin` = `Nocharm/sop-archivist`, 브랜치 `main`)으로 바꿨다. 템플릿과는 git으로 이어져 있지 않으니 템플릿 규칙 갱신은 파일을 옮겨 적는다(사용자 결정)
- 이식 출처: `../bpm` @ `1bf6d1cf`(v1.4.0, 운영 배포본)
- 표기: **(사용자 결정)** = 대화에서 사용자가 정한 것, **(내 판단)** = 설계자가 정한 기본값(사용자 검토 대상)

## 1. 의도

SOP Restructuring T/F가 쓸 전용 AI 에이전트 **SOP Archivist**(사용자 결정)를 만든다. 제품 기능(SOP 구조 검토·이전/이후 비교·초안 작성)은 이 문서 다음 단계에서 사용자의 워크플로 설명을 듣고 설계한다(사용자 결정: 순서는 기반 세팅 → 워크플로 설명 → 제품 설계).

이 문서의 범위는 **제품 기능이 하나도 없는 상태에서, 사내 서버 71번에 바로 올라가고 사내 로그인·직원 디렉터리·사내 AI 모델에 붙는 빈 앱**을 만드는 것이다. bpm이 6개월간 운영하며 사고로 배운 사내 환경 제약을 처음부터 물려받아, 제품 단계에서 인프라 문제로 시간을 쓰지 않게 하는 것이 목적이다.

## 2. 목표 · 비목표 · 반목표

**목표**
1. 로컬(macOS·Windows, Docker 없이 네이티브)과 서버(docker compose) 양쪽에서 같은 코드가 뜬다.
2. Keycloak 로그인(서버)과 dev 사용자 전환(로컬)이 동작하고, 상단 바에 `SOP Archivist v0.1.0`과 로그인한 사람의 이름·부서가 보인다.
3. HR 웹훅으로 전 부서 직원·부서가 동기화된다(사용자 결정: 전 부서 SOP 담당자가 사용자).
4. 사내 AI 모델(bpm과 같은 SGLang 위 GLM, 사용자 결정)에 호출이 닿고 사용량이 기록된다.
5. DB 자동 백업과 db-viewer 읽기 연결이 bpm과 같은 방식으로 동작한다.
6. 표 기반 권한 체계(§5.5)가 동작한다: 권한 관리 권한을 가진 사람이 화면에서 역할을 만들고, 역할·권한을 개인 또는 부서에 주고 뺄 수 있으며, 그 기록이 남는다.
7. 사내 서버 제약(아래 §3)이 rules·CLAUDE.md·deploy 문서에 박혀, 이후 작업자가 같은 사고를 반복하지 않는다.

**비목표(제품 단계로 미룸)**
- SOP 업로드·파싱·쪼개기·비교·초안 등 제품 기능 전부
- SOP 기능 권한(초안 작성·검토 등)과 "자기 부서 SOP만" 같은 범위 규칙 — 권한 체계 틀(§5.5)은 이번에 만들고, SOP 권한 항목과 범위 규칙은 SOP 기능 설계 때 추가
- 승인 흐름·부서장(EDW 직책) 연동, 알림·결재함
- 디자인 컨셉·디자인 토큰(`rules/frontend/design.md`), 컴포넌트 카탈로그 규칙
- AI 프롬프트 레지스트리·관리 화면, 임베딩(`EMBED_*`)
- LDAP 직결 로그인·외부인용 로컬 계정(내 판단: 사용자가 전원 사내 직원)

**반목표(기술적으로 돌아가도 실패로 본다)**
- bpm 도메인 코드(프로세스맵·노드·엣지·맵 권한·프레임워크 등)가 섞여 들어옴
- 실서버 IP·사내 호스트명·시크릿이 추적 파일에 들어감(공개 저장소)
- 서버가 인터넷(Docker Hub 등)에 닿아야만 빌드되는 구성
- 로컬 게이트는 전부 초록인데 컨테이너가 깨지는 구성(3.12 문법, compose 매핑 누락 env 등)

## 3. 제약 (bpm에서 실측으로 확인된 사내 환경)

| 제약 | 이유 | 반영 |
|---|---|---|
| 서버 71번, bpm 옆 | 사용자 결정 | 별도 compose 스택·별도 postgres(내 판단). 앱 nginx 노출 포트 **7777**(사용자 결정, 9900·9910은 bpm 사용 중) |
| 서버는 Docker Hub 차단 | 베이스 이미지는 연결된 PC에서 amd64 tar로 반입 | bpm과 **같은 태그만** 쓴다: `python:3.11-slim`, `node:24.22.1-alpine`, `nginx:1.27-alpine`, `postgres:16-alpine`(이미 서버에 있음 → 새 tar 반입 불필요). Dockerfile에 `# syntax=` 금지 |
| 배포 런타임 Python 3.11 | 로컬 3.12 문법으로 서버 기동 불능 사고(bpm 2026-08-31) | `backend/ruff.toml` `target-version = "py311"` |
| backend 서비스에 `env_file` 없음 | `.env`에만 넣은 값이 컨테이너에 안 들어간 사고(bpm `CSV_MANUAL_URL`) | 모든 backend env를 compose `environment:`에 `VAR: ${VAR:-}`로 매핑. `.env.example`·Settings·compose 3곳 동시 갱신 |
| 서버는 평문 HTTP 원격 IP | secure context 아님 → `crypto.randomUUID`·`crypto.subtle`·Clipboard API 불가 | `genId`, `copyText` 폴백, Keycloak `disablePKCE`. 검증은 localhost가 아닌 LAN IP로 |
| 줄바꿈 | Windows PC 경유 CRLF 오염 | `.gitattributes` `* text=auto eol=lf`(ps1/bat/cmd만 CRLF) |
| 로컬 검증 PC는 Windows, Docker 없음 | 운영 파이프라인 | 로컬 명령은 bash·PowerShell 병기. 로컬 DB는 sqlite 파일 |
| 로컬 포트 3000/8000은 db-viewer가 점유 | 맥 개발 환경 | 로컬 dev 포트 frontend **3777**, backend **8777**(내 판단) |
| 공개 저장소 | `Nocharm/sop-archivist`는 public(사용자 결정) | 실서버 IP·사내 호스트명은 플레이스홀더(`<server-ip>` 등). 회사명·사설 대역은 유지(bpm 정책과 동일). 시크릿·`.env`는 절대 추적하지 않는다 |

## 4. 결정 사항

**사용자 결정**: 이름 `SOP Archivist`/식별자 `sop-archivist` · 포트 7777 · 서버 71번·같은 AI 모델 · 사용자=전 부서 SOP 담당자, 로그인 제한 없음 · 권한은 표 기반(역할에 권한을 묶고, 역할 또는 권한을 개인·부서에 부여, 부서 부여는 하위 부서·팀까지 내려감, 권한을 조절하는 권한을 특정 부서가 가질 수 있음) · 템플릿 워크트리에서 시작해 별도 공개 저장소로.

**내 판단(검토 대상)**
- **스택**: bpm과 동일 계열 — frontend Next.js 16.4.3·React 19.2.4·Tailwind 4·`oidc-client-ts`+`react-oidc-context`·`lucide-react`·vitest+jsdom / backend FastAPI·SQLAlchemy async·Pydantic Settings·asyncpg·aiosqlite·`pyjwt[crypto]`. 버전은 bpm `1bf6d1cf`의 고정값을 그대로 쓴다. 도메인 전용 의존성(`@xyflow/react`, dagre, exceljs, jszip, html-to-image, ldap3, pypdf, python-docx, python-pptx, openpyxl, numpy)은 가져오지 않는다 — 문서 파싱 라이브러리는 제품 단계에서 결정.
- **스키마 관리**: bpm의 `create_all`+`_ADDED_COLUMNS` 수동 등록 대신 **Alembic을 처음부터** 쓴다(bpm에서 수동 등록 누락으로 운영 500이 반복됨). 마이그레이션은 backend 기동 시 자동 적용(bpm처럼 `docker compose up -d --build`만으로 배포가 끝나야 함, uvicorn 단일 워커라 경합 없음). sqlite는 `render_as_batch=True`.
- **인증 모드**: `AUTH_MODE=keycloak|dev` 두 가지만. Keycloak은 같은 realm `ai-portal`에 public client `sop-archivist-frontend` 신설(관리자 수작업, setup-once 문서에 절차).
- **토큰 발급처 검사**: bpm은 `KEYCLOAK_AUDIENCE`가 비면 `verify_aud=False`라 같은 realm의 다른 앱(bpm 등)이 받은 토큰도 통과한다. 이 프로젝트는 `azp == KEYCLOAK_CLIENT_ID`를 검사해 자기 클라이언트가 받은 토큰만 받는다(다른 앱에서 새어 나온 토큰을 막는 안전장치, 사용자 영향 없음. 운영 중에 켜면 기존 토큰이 일괄 401이라 처음부터 켠다). `test_auth`에 다른 `azp` 거부 케이스 포함.
- **관리자 env 이름**: `APP_SYSADMINS`(bpm `BPM_SYSADMINS`의 일반화). 비우면 서버에 관리자 0명 — 문서에 경고.
- **compose 내부 대역 — 미정(배포 전 사용자 확인)**: bpm 저장소는 아직 `172.36.0.0/16` 고정이지만, 사용자 기억으로는 서버가 자동 할당으로 바뀌었다. 사용자가 배포 전에 확인한다(2026-11-04). 그때까지 compose는 `ipam` 블록 없이(자동 할당) 두고, `FORWARDED_ALLOW_IPS`는 env로 받아 setup-once에 "첫 기동 뒤 `docker network inspect`로 실제 대역을 확인해 기입(고정 대역을 쓰기로 하면 `ipam` 블록 추가)" 단계를 넣는다.
- **메모리 상한**: bpm 운영값에서 출발 — proxy 96M/32M, frontend 768M/256M(`NODE_OPTIONS=--max-old-space-size=512`), backend 1G/256M(`MALLOC_ARENA_MAX=2`), db 1G/256M, db-backup 64M/16M(limit/reservation). 문서 파싱이 들어오는 제품 단계에서 재검토.
- **nginx 업로드 상한**: `client_max_body_size 50m`(bpm 25m, SOP 원문 첨부 여유). 타임아웃 600s는 bpm 그대로(AI 호출 504 사고).
- **db-viewer 별칭**: `${DBV_DB_ALIAS:-sop-archivist-db}`(bpm 별칭과 겹치면 연결 테스트는 초록인데 엉뚱한 DB에 붙음).
- **UI 식별자**: 템플릿 기본 `data-testid` 유지(bpm의 `data-id`는 레거시 관례라 새 프로젝트엔 이유 없음).
- **UI 모양**: 디자인 컨셉 전이라 중립 최소 스타일(흰 바탕·시스템 폰트 or Pretendard·단일 악센트 1색). 토큰 체계는 제품 단계 디자인 결정 후.
- **서비스 버전**: `frontend/package.json` `version` `0.1.0`에서 시작, 상단 바 표시, 루트 `CHANGELOG.md`, 태그는 bpm 규칙(`rules/common/git.md` "On Main Merge")을 `Nocharm/sop-archivist` `main` 머지 기준으로 적용. 기반 세팅이 `main`에 들어가는 시점이 `v0.1.0`.
- **템플릿 메타 정리**: 이 브랜치에서 `docs/template/` 삭제, 템플릿 seed 주석 제거(템플릿의 setup-from-template 커맨드가 하는 정리와 동일, 커맨드 파일은 2026-11-08 삭제).

## 5. 이식 목록

각 항목: bpm 출처 → 새 위치, 방식(**복사** = 이름·접두만 바꿈 / **맞춤** = 범위 축소·재구성). 출처 경로는 모두 `../bpm/` 기준.

### 5.1 저장소 위생·규칙·문서
- `.gitattributes` → 복사.
- `rules/`: 템플릿 원본 대신 bpm 개정본으로 교체 — `common/git.md`(같은 커밋 갱신·트래커·서비스 버전·머지 시 PROGRESS 압축), `common/documentation.md`(bash/PowerShell 병기·docs 카테고리·설계 스냅샷 폐기), `backend/config.md`(compose `environment:` 매핑 필수), `backend/docker.md`(`# syntax=` 금지·amd64 tar), `languages/typescript.md`(`useEffectEvent`·`<Activity>` 함정), `languages/python.md`, `guidelines.md`. bpm 고유 문구(맵·노드 등)는 일반화. `frontend/identifiers.md`는 템플릿판 유지. `frontend/design.md`·`frontend/components.md`는 가져오지 않음.
- `docs/lessons/react-ts-patterns.md`(typescript.md가 §7·§8을 참조) → 복사, bpm 도메인 예시는 일반화. `docs/lessons/browser-verification.md` → 맞춤(Playwright+시스템 Chrome, dev.db 오염 함정).
- `CLAUDE.md` → 새로 작성: Project(한 줄 설명·상태), Commands(bash+PowerShell), Architecture, **Operations/Deployment 제약 표**(bpm 표에서 이 프로젝트에 해당하는 행), 원칙 "AI 페이로드에 직원 실명을 싣지 않는다", rules import. 템플릿 seed 주석 삭제.
- `README.md`, `PROGRESS.md`(새로 시작), `CHANGELOG.md`(0.1.0), `.gitignore`(bpm 기준: `.env`, `.venv/`, `node_modules/`, `.next/`, `*.db`, `.shots/` 등).
- `docs/README.md` 인덱스 + 카테고리 폴더(`deploy/`, `lessons/`, `design/`, `qa/`).

### 5.2 backend (`backend/`)
- `settings.py` → 맞춤: 아래 env만. `resolved_auth_mode` 로직 유지(keycloak|dev).
- `clock.py`(KST tz-aware `now()`), 모든 시각 컬럼 `TIMESTAMPTZ` → 복사.
- `db.py` → 맞춤: 엔진·세션, sqlite 연결마다 `PRAGMA foreign_keys=ON`. `create_all`/`_ADDED_COLUMNS`/`_reconcile_column_types` 대신 Alembic(`backend/alembic/`).
- `auth.py`, `routers/auth.py`(`GET /api/auth/mode` 무인증) → 맞춤: Keycloak RS256 JWKS 검증(`audience or None`+`verify_aud`로 빈 env 대응), dev 모드 `X-Dev-User`. ldap·HS256 토큰·로컬 계정·로그인 스로틀은 제외.
- `/api/me` + `login_records`(KST 하루 1인 1행 — bpm `main.py` `get_me`의 `day_start` 중복 제거 그대로. `/api/me`는 새로고침·새 탭마다 불리므로 호출 단위로 쌓지 않는다) + 하루 1회 단건 HR sync → 복사.
- dev 사용자 시드: bpm `backend/app/ad/service.py` `LOCAL_USERS` 개념을 `backend/app/dev_users.py`로 옮김(AD 모듈은 가져오지 않음). 시드에 부서가 다른 사용자 여럿 + sysadmin 1명.
- HR 디렉터리: `backend/app/hr/`(`client.py` 전수 180s/단건 10s·`X-API-Key`, `service.py` 가드 3종(건수 정합·빈 피드·삭제 20% 캡, 중단 시 DB 무변경)·500건 청크·퇴직자 `active=false`, `history.py` `hr_sync_runs` 200회차·대량 퇴직 경고) → 복사. lifespan 스케줄러(24h, 마지막 회차 기준으로 주기 잇기, bpm `main.py:68-133`)·`sync-preview` 드라이런·sysadmin 수동 실행/이력 API → 복사.
- 직원·부서 모델(`employees`, `departments` 미러, `dept_code`), `orgchart.py` 부서 체인 해석(`org_trim_levels=2`) → 맞춤(제품 단계 부서 위임 권한의 토대). EDW 직책(`N8N_POSITION_URL`)·AD `org.py` OU 토큰은 제외.
- `GET /api/directory`(직원 검색, 읽기 전용) + 부서 트리 조회 → 맞춤(권한 부여 화면의 개인·부서 선택에 쓴다).
- `ai_client.py`(OpenAI 호환, `response_format json_object`, temperature 0.2, 빈 토큰도 Bearer, `AI_ENDPOINTS` "이름::모델", 동시성 세마포어, GLM-5.3 `chat_template_kwargs` `reasoning_effort`·`clear_thinking`, `content` null → `""`) + `AI_ENABLED` 게이트 → 복사. `ai_usage_events` 계측 → 복사. sysadmin 전용 `POST /api/admin/ai/ping`(짧은 호출로 연결·지연 확인) 신설.
- `batch_runs.py` + `BatchJobRun` 모델(백업 사이드카의 psql upsert 계약) + sysadmin 조회 API → 복사(화면은 §5.3 관리 페이지에 목록만).
- `scripts/reset_db.py` → 맞춤: 로컬 데모 시드(dev 사용자·부서), postgres에 직원 데이터가 있으면 거부하는 가드 유지.
- `ruff.toml`(py311), `requirements.txt`/`requirements-dev.txt`(§4 목록, bpm 고정 버전), `.dockerignore`.

### 5.3 frontend (`frontend/`)
- `src/lib/`: `id.ts`(genId), `clipboard.ts`(copyText), `keycloak-login.ts`(disablePKCE·silent SSO `prompt=none`), `auth-return.ts`(returnTo), `auth-mode.ts`(fail-closed), `dev-auth.ts`, `api-errors.ts`(humanizeApiError), `datetime.ts`(Asia/Seoul), `download-name.ts`, `i18n.tsx`(ko/en, 메시지는 새로 최소) + API fetch 래퍼(인증 헤더) → 복사·맞춤. localStorage 키 접두는 `bpm.` → `sopa.`.
- 화면: 로그인 게이트 → 상단 바(서비스 이름+버전, 사용자 메뉴, 언어 전환, dev 모드면 사용자 전환) → 홈 자리표시(로그인한 사람의 이름·부서, 내가 가진 역할·권한, AI 사용 가능 여부). 관리 페이지(메뉴는 권한이 있을 때만 보임): 권한 관리(§5.5), HR 동기화 실행·이력, 배치 작업 목록, AI ping.
- `next.config.ts`: `env.APP_VERSION`(package.json), `/api` rewrites(`BACKEND_URL`), standalone 출력, **`turbopack.root` 지정**(bpm은 `~/package.json` 때문에 루트를 홈으로 오인해 `--webpack`으로 우회 중 — 새 프로젝트는 지정으로 해소하고 검증).
- 검증 하네스: `scripts/pw-smoke-baseline.mjs` 1개(playwright-core `--no-save`+시스템 Chrome, 산출물 `../.shots/`).

### 5.4 컨테이너·배포
- `docker-compose.yml`: proxy·frontend·backend·db·db-backup 5서비스, `restart: unless-stopped`, §4 메모리 값, db healthcheck(`pg_isready` 5s/3s/10) + backend `depends_on: service_healthy`, 기본 브리지(대역은 §4 미정 항목), db는 external `dbv-shared`(+`default` 명시)에 별칭 합류, `"${APP_PORT:-7777}:80"`.
- `backend/Dockerfile`(python:3.11-slim, pip 캐시 마운트, 비루트 `appuser`, uvicorn 단일 워커, 기동 시 마이그레이션), `frontend/Dockerfile`(node:24.22.1-alpine 3단계, `npm ci` 캐시 마운트, standalone, `USER node`) → 복사·맞춤.
- `nginx/default.conf`(`/api/`→backend, Host·X-Real-IP·XFF·X-Forwarded-Proto, 600s, 50m / `/`→frontend, Upgrade) → 복사·맞춤.
- `scripts/db-backup.sh`(`pg_dump -Fc` → `pg_restore --list` 검증 후 확정, 매일 04:00 KST + 기동 직후 오늘자 없으면 1회, 14일 보존, `TZ=KST-9`, `batch_job_runs` upsert) → 복사. 온디맨드 트리거 파일은 제외.
- `.env.example`: 서버 compose(`APP_PORT`, `FORWARDED_ALLOW_IPS`, `POSTGRES_*`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `DBV_NETWORK`, `DBV_DB_ALIAS`) · 로컬(`DATABASE_URL`, `BACKEND_URL`) · 인증(`AUTH_MODE`, `KEYCLOAK_ISSUER/AUDIENCE/CLIENT_ID`, `APP_SYSADMINS`, `DEV_ENFORCE_PERMISSIONS`) · AI(`AI_ENABLED`, `AI_BASE_URL`, `AI_API_TOKEN`, `AI_MODEL`, `AI_TIMEOUT_SECONDS`, `AI_MAX_TOKENS`, `AI_ENDPOINTS`, `AI_MAX_CONCURRENCY`) · HR(`N8N_HR_URL`, `N8N_HR_TOKEN`, `HR_SYNC_INTERVAL_HOURS`, `HR_SYNC_DELETE_CAP_PCT`). 모든 값은 플레이스홀더.
- `docs/deploy/`: `deploy.md`(파이프라인 GitHub → Windows PC 네이티브 확인 → 서버 71번 → compose, §0 베이스 이미지 tar 반입, 트러블슈팅 표), `setup-once.md`(Keycloak 클라이언트 생성·Web origins, `dbv-shared` 존재 확인, 내부 대역 미점유 확인, `.env` 작성, HR 토큰), `backup.md`(복구는 빈 스키마에 단일 트랜잭션), `db-viewer-readonly.md`(`dbviewer_ro` 역할 수작업 절차). bpm 문서에서 이 프로젝트에 맞게 줄인다.

### 5.5 권한 체계 (신규 — bpm에 없는 구조)

bpm의 권한은 맵 단위(오너·협업자·가시성)라 가져오지 않는다. 이 프로젝트는 사용자가 정한 표 기반 모델을 새로 만든다.

**개념**
- **권한(permission)**: 할 수 있는 일 하나. 목록은 코드가 정의한다(키 + ko/en 라벨). 이번 범위의 권한은 관리용 4개뿐: `permission.manage`(역할 편집·부여·회수), `directory.sync`(HR 동기화 실행·이력), `ai.admin`(AI ping·사용량), `system.view`(배치 작업·백업 상태). SOP 권한은 제품 단계에서 추가.
- **역할(role)**: 권한 묶음. 관리 화면에서 만들고 고치고 지운다.
- **부여(grant)**: (대상, 역할 또는 권한). 대상은 개인(`login_id`) 또는 부서(`dept_code`). 사용자 결정: **부서 부여는 하위 부서·팀까지 내려간다** — 사람의 소속 부서와 그 모든 상위 부서에 걸린 부여가 그 사람에게 적용된다(부서 체인은 §5.2 `orgchart` 해석).
- **유효 권한** = 개인 부여 ∪ 소속 부서 체인 부여, 각 부여가 역할이면 그 역할의 권한으로 펼친다. HR 동기화로 소속이 바뀌면 유효 권한이 자동으로 따라간다. 퇴직자(`active=false`)는 권한 없음.
- **권한 관리 위임**: `permission.manage`도 권한 하나다. 이 권한이 든 역할을 특정 부서에 주면 그 부서(와 하위) 사람들이 권한을 조절한다(사용자 결정).
- **시스템 관리자**: `APP_SYSADMINS`(env)는 표와 무관하게 모든 권한을 가진 비상 열쇠. 표로 부여할 수 없다.

**내 판단(검토 대상)**
- 부여는 **더하기만**. 금지·빼기 규칙 없음(결과 예측이 쉽고 검증이 단순).
- 권한은 **전사 단위**. "자기 부서 SOP만" 같은 범위는 SOP 기능 쪽 규칙으로 설계한다.
- **변경 기록**: 역할 생성·수정·삭제와 부여·회수를 모두 기록(누가·언제·무엇을·누구에게, KST). 관리 화면에서 조회. SOP 업무의 감사 추적 요구를 예상한 것(추측).
- `permission.manage` 보유자는 `permission.manage` 자체도 부여할 수 있다(그래야 sysadmin 없이 관리 부서를 넓힐 수 있음). 자기 자신에게 부여하는 것도 막지 않되 기록에 남는다.
- 조직 개편으로 `dept_code`가 사라진 부서에 걸린 부여는 지우지 않고 관리 화면에 "부서 없음"으로 표시해 사람이 정리한다.
- dev 모드: bpm과 같이 기본은 전원 sysadmin, `DEV_ENFORCE_PERMISSIONS=true`면 표대로 판정. 데모 시드에 역할 2개(예: 권한 관리자·운영 담당)와 부서·개인 부여 몇 건을 넣어 차등을 바로 볼 수 있게 한다.

**표면**
- backend: 권한 판정 함수 하나(라우터 의존성으로 사용), 역할·부여·기록 CRUD API(`permission.manage` 필요), `/api/me`가 유효 권한 목록과 각 권한의 출처(개인/어느 부서/어느 역할)를 돌려준다. §5.2의 관리 API는 sysadmin 전용이 아니라 위 권한으로 보호한다.
- frontend 관리 화면: 역할 목록·편집(권한 체크), 부여 목록(대상 = 직원 검색 또는 부서 트리 선택, 내용 = 역할 또는 권한), 변경 기록, 사람을 고르면 유효 권한과 출처를 보여 주는 조회.

## 6. 완료 판정

1. backend: `pytest` 전부 통과 — bpm에서 가져온 모듈의 테스트를 함께 옮긴다(`test_auth_mode`, `test_auth`(keycloak·dev 부분), `test_hr_client`, `test_hr_sync`, `test_hr_sync_history`, `test_hr_scheduler`, `test_hr_active_filter`, `test_hr_mapping`, `test_orgchart`, `test_directory`, `test_batch_runs` 중 해당분) + 새로 쓰는 것(clock, ai_client 모의 HTTP, `/api/me` login_records, 빈 sqlite에 Alembic upgrade, 권한 판정 — 개인 부여·상위 부서 부여의 하위 상속·역할 펼침·퇴직자 무권한·sysadmin 우회·`permission.manage` 없는 사용자의 관리 API 403·변경 기록 생성). `ruff check` 0건. 가능하면 3.11 인터프리터로 `import app.main`(없으면 Docker 빌드가 대신 확인).
2. frontend: `tsc --noEmit`, `npm run lint`, `vitest`, `npm run build` 경고 0.
3. 로컬 네이티브: backend 8777(sqlite, `AUTH_MODE=dev`) + frontend 3777(`next dev`, `--webpack` 우회 없이) → dev 사용자로 로그인, 상단 바 `SOP Archivist v0.1.0`·이름·부서 표시, 관리 페이지에서 HR 동기화가 가짜 피드 또는 미설정 상태를 사람이 읽을 수 있는 문구로 보여 줌. `pw-smoke-baseline.mjs` 통과 + 스크린샷.
4. 컨테이너: 로컬에서 `docker network create dbv-shared` 후 `docker compose up -d --build` → 5서비스 기동, `/`·`/api/auth/mode` 200, 첫 백업 덤프 생성과 `batch_job_runs` 기록 확인.
5. `git grep`으로 추적 파일에 실 IP·사내 호스트명이 없음을 확인.

서버 7777 배포는 사용자가 `setup-once.md`·`deploy.md`대로 진행한다(Keycloak 클라이언트 생성, `.env` 실값 기입 포함).

## 7. 빌더 재량

파일 내부 구조·함수 이름·테스트 구성, 최소 UI의 배치와 문구, bpm 코드를 가져올 때 도메인 결합부를 끊는 방법, Alembic 초기 리비전 구성, 커밋 쪼개기(한 논리 변경 = 한 커밋, `type(scope): English — 한국어`).

## 8. 후속(이 문서 범위 밖)

- 제품 설계: SOP 쪼개기 워크플로·디자인 컨셉·작성 방식(사용자 설명 후 브레인스토밍 재개).
- SOP 권한 항목과 범위 규칙(§5.5 틀 위에 추가).
- 템플릿 `main`의 `rules/backend/docker.md`가 `# syntax=` 지시어를 권장 — 사내 서버 빌드를 깨뜨리므로 템플릿 본선 교정(별도 작업).
