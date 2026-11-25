# 로컬 실행·검증 명령

루트 `CLAUDE.md`에서 옮긴 명령 전체(2026-11-14, 1.0.0 문서 정리). 세션마다 실리는 `CLAUDE.md`에는 자주 쓰는 bash 명령만 남겼고, PowerShell 병기·스크립트마다의 전제(DB·포트·env)·감사 옵션은 여기를 본다.

> 워크트리에서 돌릴 때(맥): `scripts/dev-worktree.sh`가 준비 · 서버 · DB 되돌리기를 한다 — `new <브랜치>`(origin/dev에서 워크트리 + node_modules APFS 복제 + 시드 스냅숏 `.dev/seed.db`, 약 1분 반), 워크트리 안에서 `up [frontend 포트]`(시드 사본으로 backend 포트+5000 · frontend를 뒤에서, 약 10초), 스모크를 다시 돌리기 전 `reset`(backend만 다시, DB를 시드로), `seed`(Alembic · 시드를 바꾼 브랜치), `down`. backend는 원본 체크아웃의 `backend/.venv`로 돈다(워크트리에는 venv가 없다 — 스모크도 `findBackendPython`이 저절로 찾아 `BACKEND_PYTHON`이 필요 없다). `up` · `reset`이 적는 시드 지문(`.dev/seed-fingerprint.json`)과 지금 묶음(updated_at · 마지막 History 사건)이 다르면 스모크가 첫 초에 종료 코드 2로 멈춘다 — 쓰는 중인 단계 하나를 거듭 돌릴 때만 `DIRTY_DB_OK=1`. Next 16은 폴더마다 `next dev` 하나만 뜨고, 여러 워크트리를 함께 띄우면 포트를 달리한다(`up 3787`).

실행 명령은 **bash(macOS/Linux)와 PowerShell(Windows)을 병기**한다 — 로컬 검증이 Windows PC에서 이뤄지기 때문 (`rules/common/documentation.md`). 서버(리눅스) 명령은 bash만.

```bash
# === bash (macOS/Linux) ===
# backend (backend/ 에서, 로컬 네이티브) — 배포 런타임과 같은 Python 3.11로 venv를 만든다
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m scripts.reset_db      # 로컬 데모 DB 초기화(backend/dev.db): Alembic base→head + 지침·dev 디렉터리·데모 권한. 서버 실행 금지
.venv/bin/python -m scripts.seed_sop_worst # 로컬 전용(운영 DB 금지): seed_sop_demo 위에 극단 자료(W1 극단 묶음·W2~W7 단계별·가벼운 36개·참조 지도용 M1~M8(Old 문서 104개)·역할·부여·지침 버전)를 앱 API로 얹는다. 화면 배치 감사용 — 별도 sqlite 파일(DATABASE_URL)에 reset_db → seed_sop_demo → 이것 순서로, 같은 자료는 건너뛰어 다시 돌려도 된다(약 5분). 끝 줄 `worst seed done: 51 bundles`(W1~W7+light 36+M1~M8). qa.member의 목록에는 데모 5개 + 43 + M1~M5 = 53개(데모 6번·M6~M8은 prod.member 혼자). DEV_ENFORCE_PERMISSIONS 없이 돌린다
.venv/bin/python -m scripts.seed_sop_demo # 로컬 전용(운영 DB 금지): 합성 SOP 묶음 4개(쪼개기 직후·분류 절반·검토 대기·AI 제안)를 앱 API로 만든다(작성자 qa.member, 검토자 qa.lead). 그 뒤에 참조 지도용 5 UV 분광광도계(qa.member·qa.lead)·6 문서 관리(prod.member 혼자)를 더한다. 묶음 2~4는 경계를 미리 모두 확인하고 "쪼개기 직후"만 미확인으로 남긴다(v1.0.3부터 경계 확인은 검토 요청 조건이 아니지만 시드는 그대로다). AI 제안 단계는 프로세스 안의 가짜 전송으로 돌아 AI 설정이 필요 없고 실제 모델을 부르지 않는다. 같은 제목이 있으면 건너뛰어 다시 돌려도 된다. AUTH_MODE=dev에서만 돈다(dev 의존성 python-docx 필요, DEV_ENFORCE_PERMISSIONS=true면 bundle.create가 없어 403)
.venv/bin/python -m scripts.measure_extraction <파일…> [--no-aux]  # DOCX·PDF를 지금 추출기로 읽어 구조 숫자만 낸다(파싱 규칙 전후 비교용, DB·서버 없이). 줄마다 `#n {JSON}` — 경로·파일 이름·원문 글자는 출력하지 않아 실제 문서로 돌린 결과를 그대로 전해도 된다. `--no-aux`는 MarkItDown 보조 대조(느림)를 건너뛴다
AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin .venv/bin/uvicorn app.main:app --reload --port 8777   # 개발 서버
.venv/bin/python -m pytest tests/ -q -n auto   # 테스트(병렬, 작업자마다 DB 파일이 따로) — conftest가 AUTH_MODE·AI·HR 등을 baseline으로 고정해 backend/.env가 있어도 안전. 한 파일만 볼 때는 -n 없이
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
QUIET=1 ONLY="assign:" BASE_URL=http://localhost:3777 node scripts/pw-smoke-sop.mjs   # 고친 화면만(assign: · documents: · new documents: · order · outputs · map). 전부는 FULL=1(정식 업데이트 전 · 공용 부품을 고쳤을 때) — ONLY도 FULL도 없으면 멈춘다. AI 나눔 확정 단계는 backend가 가짜 AI(FAKE_AI_SPLIT=1)를 볼 때만 돈다
QUIET=1 ONLY_FAILED=1 BASE_URL=http://localhost:3777 node scripts/pw-smoke-sop.mjs   # 지난 실행에서 실패한 단계만(이름은 저장소 루트 .dev/smoke-failed.txt). DB를 시드로 되돌린 뒤(scripts/dev-worktree.sh reset)
PREPARE=1 BASE_URL=http://localhost:3777 node scripts/pw-smoke-sop.mjs   # 배정 화면 첫 진입 미리 분류(알림 → AI jobs의 Background 줄 → AI suggested 수) 하나만 돈다. 전제: reset_db → seed_sop_demo(AI_AUTO_PREPARE=false) 직후,
#   backend를 아래 가짜 AI로 AI_ENABLED=true AI_AUTO_PREPARE=true로 띄운다(다른 단계는 이 backend에서 전제가 깨져 건너뛴다). 끝에 DB가 바뀐다 — 다시 돌리려면 reset_db부터
BASE_URL=http://localhost:3777 node scripts/pw-contrast-audit.mjs   # 14화면 × 라이트·다크, 4.5:1
DS=worst BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs   # 배치 감사(DB 불변): seed_sop_demo(DS=mid)·seed_sop_worst(DS=worst)를 얹은 DB의 backend 8787/frontend 3787에서. ONLY=항목 id·WIDTHS·LANGS·THEMES, 실패는 종료 코드 1과 ../.shots/layout-<id>-<width>.png (docs/lessons/browser-verification.md)
BASE_URL=http://localhost:3806 BUNDLE=<묶음 id> DOCS=<Old 문서 id,…> node scripts/pw-perf-assign.mjs   # Assign 긴 문서 프레임 비용(가만히·호버·스크롤·고르기, CPU 4배 느리게). 운영 빌드(next build → next start)에 대고, 처방은 INJECT=<css>로 주입해 전·후를 같이 잰다. TRACE·PROFILE=scroll|hover|click (설계 2026-11-17-assign-long-doc — 구현 끝나 지웠다, git 이력)
SCENARIO=keys|burst|filter|number|idle|commits BASE_URL=http://<lan-ip>:<포트> BUNDLE=<묶음 id> DOCS=<Old 문서 id> CPU=1|4 REPEAT=6 LAT=0 node scripts/pw-perf-assign.mjs   # Assign 반응 시간(결과 docs/qa/2026-11-assign-perf.md). keys=j·Delete 글쇠→다음 박스 ms·요청 · burst=Delete 연타에 몇 개 지워지나 · filter=필터 Unassigned 뒤 keys · number=번호 칸 5글자 입력 지연 · idle=60초 무조작(가짜 AI 켠 묶음) · commits=글쇠 한 번의 커밋 수와 PaperChunk 그리기 수(개발 서버, 운영 빌드는 이름이 줄어 못 센다).
#   전제: `seed_sop_worst`로 만든 is_synthetic 묶음(keys·burst·filter·commits는 판단을 쓰니 아니면 멈춘다 — 시나리오 사이마다 reset_db → seed로 되돌린다), 운영 빌드(`npm run build` → `npx next start -p <포트>`)와 backend가 같은 DB를 보고, localhost가 아닌 LAN 주소로 연다. 결과는 문서마다 마지막 줄 `RESULT {json}` 한 줄. 서버 저장 시간은 backend 표준 출력의 JSON 한 줄 `{"msg": "group save timed", "bundle_id":…, "total_ms":…, "dump_ms":…, "run_ms":…, "unit_count":…, "target_count":…}`(로거 `app.timing`만 INFO, 허용한 숫자 키뿐 — 원문·이름 없음)
BASE_URL=http://localhost:3777 node scripts/pw-overlap-audit.mjs    # 겹침 감사(seed 직후, DB 불변): 모핑 단추·C 줄 끝 단추·그 자리 메뉴·AI 작업 목록과 알림이 옆 글자를 덮는지, 1280·1920 × EN·KO. 긴 글은 LONG=1, 다크는 THEMES=light,dark
BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs     # 시스템 설명서(docs/manual/) 화면 그림·번호 위치 다시 뽑기 — reset_db → seed_sop_demo 직후, 끝에 묶음 3을 검토 완료로 바꾼다
MANUAL=app BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs   # 사용 설명서(/manual) 그림 17장을 frontend/public/manual/img/에 — 1120x720, 번호 표시 없음, DB를 바꾸지 않는다. 위 줄보다 먼저 돌린다(위 줄이 묶음 3을 바꾼다)

# 가짜 AI — 고정 응답, 배선 확인용 (저장소 루트에서, 포트 9999). 합성 응답이라 프롬프트 품질·정확도의 근거가 아니다
node frontend/scripts/fake-ai-server.mjs   # FAKE_AI_SPLIT=1이면 분류 답과 나누기 제안 답이 문장을 둘로 나눈다(AI 나눔 확정·AI 나누기 제안 경로 스모크용)
#   backend를 AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="" 로 띄운다.
#   AI를 켜고 스모크·감사·시드를 돌릴 때는 AI_AUTO_PREPARE=false를 더한다 — 업로드 뒤 묶기 계획·배정 화면 첫 진입 분류가 저절로 쌓여 작업·제안 수가 달라지지 않게(꺼도 사람이 누른 요청은 그대로 돈다).
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
.venv\Scripts\python -m scripts.seed_sop_worst  # 극단 자료 시드(로컬 전용) — 설명은 bash 쪽과 같다
.venv\Scripts\python -m scripts.measure_extraction <파일…> [--no-aux]  # 추출 측정(숫자만) — 설명은 bash 쪽과 같다
$env:AUTH_MODE="dev"; $env:DEV_ENFORCE_PERMISSIONS="true"; $env:APP_SYSADMINS="dev.admin"; .venv\Scripts\uvicorn app.main:app --reload --port 8777
.venv\Scripts\python -m pytest tests\ -q -n auto
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
$env:QUIET="1"; $env:ONLY="assign:"; node scripts\pw-smoke-sop.mjs   # seed_sop_demo 직후. 전부는 $env:FULL="1", 실패한 단계만은 $env:ONLY_FAILED="1" — 설명은 bash 쪽과 같다
$env:PREPARE="1"; node scripts\pw-smoke-sop.mjs; Remove-Item Env:PREPARE   # 배정 화면 첫 진입 미리 분류만. 전제(가짜 AI + $env:AI_AUTO_PREPARE="true" backend, 끝에 DB가 바뀜)는 bash 쪽과 같다
node scripts\pw-contrast-audit.mjs
node scripts\pw-overlap-audit.mjs   # 겹침 감사. 설명은 bash 쪽과 같다
$env:BASE_URL="http://localhost:3787"; $env:DS="worst"; node scripts\pw-layout-audit.mjs; Remove-Item Env:DS   # 배치 감사. 설명은 bash 쪽과 같다(변수를 지우지 않으면 다음 실행도 그 자료다)
node scripts\pw-manual-shots.mjs     # 설명서 그림 다시 뽑기. 설명은 bash 쪽과 같다
$env:MANUAL="app"; node scripts\pw-manual-shots.mjs; Remove-Item Env:MANUAL   # 사용 설명서(/manual) 그림. 설명은 bash 쪽과 같다(변수를 지우지 않으면 다음 실행도 app 모드다)

# 가짜 AI (저장소 루트에서)
node frontend\scripts\fake-ai-server.mjs   # 나눔 모드: $env:FAKE_AI_SPLIT="1"

# 배포 스크립트 검증은 POSIX sh가 필요하다 — Git Bash에서 sh ci/test-deploy.sh, 아니면 GitLab의 deploy-script-test Job 결과를 본다
# backend: $env:AI_ENABLED="true"; $env:AI_BASE_URL="http://localhost:9999/v1"; $env:AI_MODEL="fake"; $env:AI_API_TOKEN="fake"; $env:AI_ENDPOINTS=""
# 스모크·감사·시드에는 저절로 도는 AI를 끈다: $env:AI_AUTO_PREPARE="false"
# 임베딩까지: $env:EMBED_ENABLED="true"; $env:EMBED_BASE_URL="http://localhost:9999/v1"; $env:EMBED_API_TOKEN="fake"; $env:EMBED_MODEL="fake"
```

```bash
# 서버 배포 = 사내 GitLab 파이프라인 (서버에서 직접 compose 하지 않는다) — 절차 전체: docs/deploy/gitlab-runner.md
# 개발(작업은 dev 브랜치에서): git push gitlab dev → deploy-dev가 테스트를 기다리지 않고 바로 배포(테스트는 옆에서). 접속: http://<server-ip>:4444
# 운영(dev를 main에 합친 뒤): git push gitlab main && git push gitlab vX.Y.Z → GitLab main 파이프라인 test 통과 → deploy-production ▶
# 배포 Job(ci/deploy.sh)이 스택의 배포 폴더(운영 /data/home_<계정>/deployments/sop-archivist, 개발 …-dev, .env는 거기에만)로 checkout을 맞추고 docker compose -p <프로젝트> up -d --build. 운영 접속: http://<server-ip>:7777
sh ci/test-deploy.sh            # 배포 스크립트 검증(가짜 docker, 저장소 루트에서) — busybox·GNU 둘 다에서 돌아야 한다
# 로컬 Docker로 컨테이너 검증할 때도 공유 브리지를 먼저 만든다: docker network create dbv-shared
```
