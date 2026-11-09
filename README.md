# SOP Archivist

SOP Restructuring T/F가 쓰는 사내 AI 에이전트 웹 서비스 (FastAPI + Next.js, 사내 서버에 docker compose로 배포). 사용자는 전 부서의 SOP 담당자다.

현재(v0.8.0, 2026-11-09 운영 배포)는 기반 세팅(**사내 로그인(Keycloak)·직원 디렉터리(HR 웹훅 동기화)·사내 AI 연결·표 기반 권한 체계·관리 화면·DB 자동 백업**) 위에 **SOP 재구성의 결정적 코어**와 그 위의 **AI 제안 층**을 얹은 단계다. 옛 SOP·WI를 묶음으로 올리면(DOCX 기본, 텍스트 PDF 보조) 별도 프로세스에서 원문을 빠짐없이 추출하고 규칙으로 문장 단위로 쪼갠다. 작성자는 단위마다 새 SOP·WI의 칸에 배정·확정하거나(입구 1), 이미 쓴 새 문서와 문장 짝을 맞춘다(입구 2). 확정 결과로 문장 비교표(A)·맵핑 흐름도(B)·새 문서 기준 묶음(C)을 코드가 계산해 한글판·영어판 Excel로 내보내고, 검토자에게 검토를 요청한다. AI는 작성자가 요청할 때 제안만 한다: 단위를 보낼 칸과 한·영 고쳐 쓴 문장(입구 1), 번역, 옛·새 문장 짝과 변경 종류(입구 2), 한/영 따로 문서의 한글·영어 짝, 복합 문장 나누기 위치. 사람이 줄마다 확정하고, AI가 꺼지거나 실패해도 사람 경로는 그대로 돈다. 화면은 1차 모양으로 모든 단계가 열려 있다(묶음 목록·개요, 문서, 쪼개기, To-Be, 분류, 짝 맞추기, 결과물, 검토 — 라이트·다크 테마). v0.5.0에서 v0.4.0 전체 검토의 치명·중요 문제를 고쳤다(짝 맞추기의 입구 2 표·그림은 다음 버전). AI 층은 합성 SOP와 가짜 AI로만 검증했고 실제 사내 모델로는 시험하지 않았다. 설계: [`docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`](docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md).

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

데모 데이터는 합성 SOP 묶음 4개(쪼개기 직후·분류 절반·검토 대기·AI 제안)를 앱 API 경로 그대로 만든다. AI 제안 묶음은 프로세스 안의 가짜 AI가 합성 정답으로 답한 제안이고 실제 모델을 부르지 않는다. 작성자는 `qa.member`, 검토자는 `qa.lead`(dev 사용자)다. 같은 제목의 묶음이 이미 있으면 건너뛰므로 다시 돌려도 된다. `AUTH_MODE=dev`가 아니거나 HR 직원이 든 postgres면 아무것도 만들지 않고 멈춘다. backend 의존성은 `requirements-dev.txt`(합성 DOCX 생성용 `python-docx` 포함)로 설치해야 한다.

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

### AI·임베딩 서버 (선택)

AI 제안은 사내 채팅 모델(`AI_*`)과 별개의 사내 임베딩 모델(`EMBED_*`, OpenAI 호환 `/embeddings`)을 쓴다. 둘 다 기본은 꺼짐이고, 꺼져 있어도 사람이 끝까지 가는 경로(업로드부터 검토 완료까지)는 그대로 돈다. SOP 원문은 이 두 주소로만 나간다. 값과 설명은 [`.env.example`](.env.example)이 전체 목록이고, 시크릿(`*_API_TOKEN`)은 커밋하지 않는다.

| 키 | 뜻 |
|---|---|
| `AI_ENABLED` / `AI_BASE_URL` / `AI_API_TOKEN` / `AI_MODEL` | 채팅 모델. 분류·고쳐 쓰기·번역·입구 2 변경 종류·나누기 제안이 쓴다 |
| `EMBED_ENABLED` / `EMBED_BASE_URL` / `EMBED_API_TOKEN` / `EMBED_MODEL` | 임베딩 모델. 후보 칸 추리기·입구 2 짝·한/영 따로 짝 제안이 쓴다. 꺼져 있으면 후보는 전체 칸이나 글자 유사도로 줄이고, 한/영 따로 짝 요청은 409 `embedding_disabled`다 |

로컬에서 배선만 확인할 때는 가짜 AI 서버(`frontend/scripts/fake-ai-server.mjs`)를 쓴다. 명령은 [`CLAUDE.md`](CLAUDE.md) Commands에 있고, 응답이 고정이라 정확도의 근거가 아니다.

## 서버 배포

서버(사내 71번)에는 **사내 GitLab 파이프라인으로만 배포한다**(접속 `http://<server-ip>:7777`). 서버에서 `git pull`·`docker compose up`을 손으로 치지 않는다. GitHub `main`을 PC에서 받아 사내 GitLab에 `git push gitlab main`(+ 태그) 하면 테스트가 자동으로 돌고, `deploy-production`의 ▶가 서버의 배포 러너로 docker compose 스택을 올린다(`.gitlab-ci.yml`, `ci/deploy.sh`). 처음 세울 때는 [`setup-once.md`](docs/deploy/setup-once.md)를 순서대로, 이후 배포는 [`deploy.md`](docs/deploy/deploy.md)를 따른다.

| 문서 | 내용 |
|---|---|
| [`docs/deploy/gitlab-runner.md`](docs/deploy/gitlab-runner.md) | GitLab 프로젝트 설정, 러너 두 개(테스트·배포) 등록, 배포 폴더, 평소 흐름, 되돌리기, 비상 수동 경로 |
| [`docs/deploy/setup-once.md`](docs/deploy/setup-once.md) | 최초 1회 셋업 — `.env`, Keycloak 클라이언트, 첫 기동, 첫 HR 동기화, 권한 위임 |
| [`docs/deploy/deploy.md`](docs/deploy/deploy.md) | 매 배포 절차(파이프라인 ▶), 헬스체크, 트러블슈팅, 롤백 |
| [`docs/deploy/backup.md`](docs/deploy/backup.md) | 일간 DB 백업 정책과 복구 |
| [`docs/deploy/db-viewer-readonly.md`](docs/deploy/db-viewer-readonly.md) | db-viewer 읽기 전용 연결 |

## 디렉터리 구조

```
backend/    # FastAPI 앱(app/, SOP 재구성 코어는 app/sop/), Alembic 마이그레이션(alembic/), 로컬 시드·합성 SOP 생성기(scripts/), tests/
frontend/   # Next.js 앱(src/app 라우트, src/components, src/lib), scripts/ = 브라우저 스모크·가짜 AI
nginx/      # 앱 리버스 프록시 설정
scripts/    # db-backup.sh (백업 사이드카)
ci/         # deploy.sh(GitLab 배포 Job 본체) · test-deploy.sh(가짜 docker로 배포 스크립트 검증)
docs/       # 문서 인덱스 docs/README.md — deploy/(배포 런북), lessons/(시행착오), superpowers/(설계 명세·계획)
docker-compose.yml   # proxy · frontend · backend · db · db-backup
.gitlab-ci.yml       # 사내 GitLab: test 3개 자동, deploy-production 수동(main)
```

## 문서

- 문서 인덱스: [`docs/README.md`](docs/README.md)
- 설계 명세: [`SOP 재구성 End-to-End 설계`](docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md)(제품), [`기반 세팅 설계`](docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md)
- 파싱 의존성·메모리 실측: [`docs/qa/2026-11-sop-parse-dependencies.md`](docs/qa/2026-11-sop-parse-dependencies.md), 프런트 디자인 기초: [`frontend/docs/design/2026-11-07-frontend-design-foundations.md`](frontend/docs/design/2026-11-07-frontend-design-foundations.md)
- 구현 계획 2(AI 제안 층, 프런트 병행용 API 계약 포함): [`docs/superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md`](docs/superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md)
- 작업 가이드(명령·구조·체크리스트): [`CLAUDE.md`](CLAUDE.md), 변경 기록: [`CHANGELOG.md`](CHANGELOG.md), 진행 현황: [`PROGRESS.md`](PROGRESS.md)
