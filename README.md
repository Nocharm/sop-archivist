# SOP Archivist

SOP Restructuring T/F가 쓰는 사내 AI 에이전트 웹 서비스 (FastAPI + Next.js, 사내 서버에 docker compose로 배포). 사용자는 전 부서의 SOP 담당자다.

현재(v0.2.0)는 기반 세팅(**사내 로그인(Keycloak)·직원 디렉터리(HR 웹훅 동기화)·사내 AI 연결·표 기반 권한 체계·관리 화면·DB 자동 백업**) 위에 **SOP 재구성의 결정적 코어**를 얹은 단계다. 옛 SOP·WI를 묶음으로 올리면(DOCX 기본, 텍스트 PDF 보조) 별도 프로세스에서 원문을 빠짐없이 추출하고 규칙으로 문장 단위로 쪼갠다. 작성자는 단위마다 새 SOP·WI의 칸에 배정·확정하거나(입구 1), 이미 쓴 새 문서와 문장 짝을 맞춘다(입구 2). 확정 결과로 문장 비교표(A)·맵핑 흐름도(B)·새 문서 기준 묶음(C)을 코드가 계산해 한글판·영어판 Excel로 내보내고, 검토자에게 검토를 요청한다. 지금은 **API만 있고 화면은 아직 없다**(프런트는 Claude Design 단계에서 붙인다). AI 분류·번역·짝 제안은 다음 단계(계획 2)다. 설계: [`docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`](docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md).

## 로컬 실행 (Docker 없이)

로컬 DB는 sqlite 파일(`backend/dev.db`)이라 설정 없이 뜬다. 백엔드는 배포 런타임과 같은 Python 3.11, 프런트는 Node 24를 쓴다. 포트는 backend **8777**, frontend **3777**이다.

```bash
# === bash (macOS/Linux) ===
# 1) backend (backend/ 에서)
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m scripts.reset_db                     # 데모 DB(dev 직원·부서·데모 권한) 만들기
AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin .venv/bin/uvicorn app.main:app --reload --port 8777

# 2) frontend (frontend/ 에서, 다른 터미널)
npm install
npm run dev                                              # http://localhost:3777
```

```powershell
# === PowerShell (Windows) ===
# 1) backend (backend\ 에서)
py -3.11 -m venv .venv; .venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\python -m scripts.reset_db
$env:AUTH_MODE="dev"; $env:DEV_ENFORCE_PERMISSIONS="true"; $env:APP_SYSADMINS="dev.admin"; .venv\Scripts\uvicorn app.main:app --reload --port 8777

# 2) frontend (frontend\ 에서, 다른 터미널)
npm install
npm run dev
```

브라우저에서 `http://localhost:3777`을 열면 dev 모드 로그인 화면에서 데모 사용자를 고를 수 있다(`dev.admin`은 시스템 관리자). 권한 차등은 사용자를 바꿔 가며 본다. 검증 명령(테스트·린트·빌드·브라우저 스모크)과 가짜 AI 서버는 [`CLAUDE.md`](CLAUDE.md) Commands에 있다.

> `reset_db`는 모든 테이블을 지우고 다시 만드는 **로컬 전용** 스크립트다. 서버에서 실행하지 않는다.

### SOP 데모 묶음 (로컬 전용, 운영 DB 금지)

화면이 아직 없으므로 데모 데이터는 API로 본다. 합성 SOP 묶음 3개(쪼개기 직후·분류 절반·검토 대기)를 앱 API 경로 그대로 만든다. 작성자는 `qa.member`, 검토자는 `qa.lead`(dev 사용자)다. 같은 제목의 묶음이 이미 있으면 건너뛰므로 다시 돌려도 된다. `AUTH_MODE=dev`가 아니거나 HR 직원이 든 postgres면 아무것도 만들지 않고 멈춘다. backend 의존성은 `requirements-dev.txt`(합성 DOCX 생성용 `python-docx` 포함)로 설치해야 한다.

```bash
# === bash (macOS/Linux) === (backend/ 에서)
.venv/bin/python -m scripts.seed_sop_demo
# API 문서(OpenAPI): backend를 띄운 뒤 http://localhost:8777/docs. 호출은 dev 헤더로 — curl -H "X-Dev-User: qa.member" http://localhost:8777/api/bundles
```

```powershell
# === PowerShell (Windows) === (backend\ 에서)
.venv\Scripts\python -m scripts.seed_sop_demo
# API 문서(OpenAPI): backend를 띄운 뒤 http://localhost:8777/docs. 호출은 dev 헤더로 — Invoke-RestMethod -Headers @{"X-Dev-User"="qa.member"} http://localhost:8777/api/bundles
```

## 서버 배포

서버(사내 71번)는 docker compose로 올린다(접속 `http://<server-ip>:7777`). 처음 세울 때는 [`setup-once.md`](docs/deploy/setup-once.md)를 순서대로, 이후 배포는 [`deploy.md`](docs/deploy/deploy.md)를 따른다.

| 문서 | 내용 |
|---|---|
| [`docs/deploy/setup-once.md`](docs/deploy/setup-once.md) | 최초 1회 셋업 — `.env`, Keycloak 클라이언트, 첫 기동, 첫 HR 동기화, 권한 위임 |
| [`docs/deploy/deploy.md`](docs/deploy/deploy.md) | 매 배포 절차, 헬스체크, 트러블슈팅, 롤백 |
| [`docs/deploy/backup.md`](docs/deploy/backup.md) | 일간 DB 백업 정책과 복구 |
| [`docs/deploy/db-viewer-readonly.md`](docs/deploy/db-viewer-readonly.md) | db-viewer 읽기 전용 연결 |

## 디렉터리 구조

```
backend/    # FastAPI 앱(app/, SOP 재구성 코어는 app/sop/), Alembic 마이그레이션(alembic/), 로컬 시드·합성 SOP 생성기(scripts/), tests/
frontend/   # Next.js 앱(src/app 라우트, src/components, src/lib), scripts/ = 브라우저 스모크·가짜 AI
nginx/      # 앱 리버스 프록시 설정
scripts/    # db-backup.sh (백업 사이드카)
docs/       # 문서 인덱스 docs/README.md — deploy/(배포 런북), lessons/(시행착오), superpowers/(설계 명세·계획)
docker-compose.yml   # proxy · frontend · backend · db · db-backup
```

## 문서

- 문서 인덱스: [`docs/README.md`](docs/README.md)
- 설계 명세: [`SOP 재구성 End-to-End 설계`](docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md)(제품), [`기반 세팅 설계`](docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md)
- 구현 계획 1(결정적 코어): [`docs/superpowers/plans/2026-11-05-sop-restructuring-plan1-core.md`](docs/superpowers/plans/2026-11-05-sop-restructuring-plan1-core.md), 파싱 의존성·메모리 실측: [`docs/qa/2026-11-sop-parse-dependencies.md`](docs/qa/2026-11-sop-parse-dependencies.md)
- 작업 가이드(명령·구조·체크리스트): [`CLAUDE.md`](CLAUDE.md), 변경 기록: [`CHANGELOG.md`](CHANGELOG.md), 진행 현황: [`PROGRESS.md`](PROGRESS.md)
