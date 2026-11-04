# SOP Archivist

SOP Restructuring T/F가 쓰는 사내 AI 에이전트 웹 서비스 (FastAPI + Next.js, 사내 서버에 docker compose로 배포). 사용자는 전 부서의 SOP 담당자다. 현재(v0.1.0)는 제품 기능 없이 **사내 로그인(Keycloak)·직원 디렉터리(HR 웹훅 동기화)·사내 AI 연결·표 기반 권한 체계·관리 화면·DB 자동 백업**만 갖춘 기반 세팅 단계다. SOP 구조 검토·이전/이후 비교·초안 작성은 다음 단계에서 설계한다.

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
backend/    # FastAPI 앱(app/), Alembic 마이그레이션(alembic/), 로컬 시드(scripts/reset_db.py), tests/
frontend/   # Next.js 앱(src/app 라우트, src/components, src/lib), scripts/ = 브라우저 스모크·가짜 AI
nginx/      # 앱 리버스 프록시 설정
scripts/    # db-backup.sh (백업 사이드카)
docs/       # 문서 인덱스 docs/README.md — deploy/(배포 런북), lessons/(시행착오), superpowers/(설계 명세·계획)
docker-compose.yml   # proxy · frontend · backend · db · db-backup
```

## 문서

- 문서 인덱스: [`docs/README.md`](docs/README.md)
- 설계 명세: [`docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`](docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md)
- 작업 가이드(명령·구조·체크리스트): [`CLAUDE.md`](CLAUDE.md), 변경 기록: [`CHANGELOG.md`](CHANGELOG.md), 진행 현황: [`PROGRESS.md`](PROGRESS.md)
