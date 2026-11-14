# 로컬 실행·검증 명령

루트 `CLAUDE.md`에서 옮긴 명령 전체(2026-11-14, 1.0.0 문서 정리). 세션마다 실리는 `CLAUDE.md`에는 자주 쓰는 bash 명령만 남겼고, PowerShell 병기·스크립트마다의 전제(DB·포트·env)·감사 옵션은 여기를 본다.

> 워크트리에서 돌릴 때: 워크트리에는 `backend/.venv`가 없으니 원본 체크아웃의 venv(`<원본>/backend/.venv/bin/python`)로 `backend/`에서 돌리고, `frontend/`는 `npm ci`를 한 번 한다. Next 16은 폴더마다 `next dev` 하나만 뜨고, 브라우저 감사는 서로 다른 sqlite 파일(`DATABASE_URL`)에서 돌린다(`docs/lessons/browser-verification.md`).

실행 명령은 **bash(macOS/Linux)와 PowerShell(Windows)을 병기**한다 — 로컬 검증이 Windows PC에서 이뤄지기 때문 (`rules/common/documentation.md`). 서버(리눅스) 명령은 bash만.

```bash
# === bash (macOS/Linux) ===
# backend (backend/ 에서, 로컬 네이티브) — 배포 런타임과 같은 Python 3.11로 venv를 만든다
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m scripts.reset_db      # 로컬 데모 DB 초기화(backend/dev.db): Alembic base→head + 지침·dev 디렉터리·데모 권한. 서버 실행 금지
.venv/bin/python -m scripts.seed_sop_worst # 로컬 전용(운영 DB 금지): seed_sop_demo 위에 극단 자료(W1 극단 묶음·W2~W7 단계별·가벼운 36개·역할·부여·지침 버전)를 앱 API로 얹는다. 화면 배치 감사용 — 별도 sqlite 파일(DATABASE_URL)에 reset_db → seed_sop_demo → 이것 순서로, 같은 자료는 건너뛰어 다시 돌려도 된다(약 2분 반). 끝 줄 `worst seed done: 43 bundles`(W1~W7+light 36, 데모 4개 더하면 화면에 47개). DEV_ENFORCE_PERMISSIONS 없이 돌린다
.venv/bin/python -m scripts.seed_sop_demo # 로컬 전용(운영 DB 금지): 합성 SOP 묶음 4개(쪼개기 직후·분류 절반·검토 대기·AI 제안)를 앱 API로 만든다(작성자 qa.member, 검토자 qa.lead). 묶음 2~4는 경계를 미리 모두 확인하고 "쪼개기 직후"만 미확인으로 남긴다(경계 확인이 검토 요청 조건이라서). AI 제안 단계는 프로세스 안의 가짜 전송으로 돌아 AI 설정이 필요 없고 실제 모델을 부르지 않는다. 같은 제목이 있으면 건너뛰어 다시 돌려도 된다. AUTH_MODE=dev에서만 돈다(dev 의존성 python-docx 필요, DEV_ENFORCE_PERMISSIONS=true면 bundle.create가 없어 403)
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
BASE_URL=http://localhost:3777 node scripts/pw-smoke-sop.mjs        # AI 나눔 확정 단계는 backend가 가짜 AI(FAKE_AI_SPLIT=1)를 볼 때만 돈다
BASE_URL=http://localhost:3777 node scripts/pw-contrast-audit.mjs   # 14화면 × 라이트·다크, 4.5:1
DS=worst BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs   # 배치 감사(DB 불변): seed_sop_demo(DS=mid)·seed_sop_worst(DS=worst)를 얹은 DB의 backend 8787/frontend 3787에서. ONLY=항목 id·WIDTHS·LANGS·THEMES, 실패는 종료 코드 1과 ../.shots/layout-<id>-<width>.png (docs/lessons/browser-verification.md)
BASE_URL=http://localhost:3777 node scripts/pw-overlap-audit.mjs    # 겹침 감사(seed 직후, DB 불변): 모핑 단추·C 줄 끝 단추·그 자리 메뉴·AI 작업 목록과 알림이 옆 글자를 덮는지, 1280·1920 × EN·KO. 긴 글은 LONG=1, 다크는 THEMES=light,dark
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
.venv\Scripts\python -m scripts.seed_sop_worst  # 극단 자료 시드(로컬 전용) — 설명은 bash 쪽과 같다
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
node scripts\pw-smoke-sop.mjs        # seed_sop_demo 직후. 설명은 bash 쪽과 같다
node scripts\pw-contrast-audit.mjs
node scripts\pw-overlap-audit.mjs   # 겹침 감사. 설명은 bash 쪽과 같다
$env:BASE_URL="http://localhost:3787"; $env:DS="worst"; node scripts\pw-layout-audit.mjs; Remove-Item Env:DS   # 배치 감사. 설명은 bash 쪽과 같다(변수를 지우지 않으면 다음 실행도 그 자료다)
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
# 개발(작업은 dev 브랜치에서): git push gitlab dev → deploy-dev가 테스트를 기다리지 않고 바로 배포(테스트는 옆에서). 접속: http://<server-ip>:4444
# 운영(dev를 main에 합친 뒤): git push gitlab main && git push gitlab vX.Y.Z → GitLab main 파이프라인 test 통과 → deploy-production ▶
# 배포 Job(ci/deploy.sh)이 스택의 배포 폴더(운영 /data/home_<계정>/deployments/sop-archivist, 개발 …-dev, .env는 거기에만)로 checkout을 맞추고 docker compose -p <프로젝트> up -d --build. 운영 접속: http://<server-ip>:7777
sh ci/test-deploy.sh            # 배포 스크립트 검증(가짜 docker, 저장소 루트에서) — busybox·GNU 둘 다에서 돌아야 한다
# 로컬 Docker로 컨테이너 검증할 때도 공유 브리지를 먼저 만든다: docker network create dbv-shared
```
