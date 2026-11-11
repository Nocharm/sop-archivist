# 브라우저 검증 (Playwright + 시스템 Chrome)

로컬(macOS·Windows)에서 **헤드리스 브라우저로 화면을 실제 구동·검증할 수 있다** — compile-only가 아니다. 컴파일만으론 못 잡는 진짜 버그(`visibility:hidden`, 이벤트 미발화 등)는 실제로 띄워야 잡힌다. 서버 배포 전 스모크의 기본 수단이다.

## 셋업
- 백엔드(`backend/`에서, dev 인증 + sqlite 파일 DB):

```bash
# bash (macOS/Linux)
cd backend && AUTH_MODE=dev .venv/bin/uvicorn app.main:app --port 8777
```

```powershell
# PowerShell (Windows)
cd backend; $env:AUTH_MODE="dev"; .venv\Scripts\uvicorn app.main:app --port 8777
```

- 프론트(`frontend/`에서, 포트 3777 고정):

```bash
# bash
cd frontend && BACKEND_URL=http://localhost:8777 npm run dev
```

```powershell
# PowerShell
cd frontend; $env:BACKEND_URL="http://localhost:8777"; npm run dev
```

- 브라우저: `npm i --no-save playwright-core`(브라우저 다운로드 X) → `chromium.launch({ executablePath })`. macOS는 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, Windows는 `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- 로그인: dev 모드에선 로컬 계정 목록에서 고르거나 localStorage `sopa.devUser`(API는 `X-Dev-User` 헤더)로 사용자를 정한다. 권한 차등을 보려면 backend를 `DEV_ENFORCE_PERMISSIONS=true`로 띄운다.
- API 직접 조회가 도구에서 막히면 python `urllib`을 쓴다.
- 스모크·스크린샷 산출물은 저장소 루트 `.shots/`(gitignore)에 둔다.

## ⚠️ 함정
1. **dev DB 오염**: 테스트가 데이터를 영구 변경한다. 다음 검증이 오염된 상태로 돌아 **거짓 실패**를 낸다. **"0 events"·"목록이 비어 있음"·"저장 안 됨"은 코드 버그가 아니라 DB 오염일 수 있다** — 깨끗한 DB에서 다시 확인할 것. `*.db`는 추적하지 않으니 `git checkout`으로 못 되돌린다: 검증 사이클마다 `backend/`에서 `.venv/bin/python -m scripts.reset_db`(PowerShell은 `.venv\Scripts\python`, 로컬 전용) 후 **백엔드 재시작**. 스크립트가 만든 데이터는 가능하면 스크립트가 API로 정리한다.
2. **실행 중 DB 교체 = readonly**: 백엔드가 떠 있는 동안 sqlite 파일을 지우거나 바꾸면 DB 핸들이 깨져 저장이 전부 실패한다. 파일을 바꾼 뒤엔 반드시 백엔드 재시작.
3. **node 스크립트 cwd**: 스크립트는 `frontend/`에서 실행해야 `playwright-core`를 찾는다. `cd backend` 상태로 `node ./x.mjs` 하면 "Cannot find module". 매 실행 전 `cd frontend`를 확인한다.
4. **워크트리 세션(`.claude/worktrees/<name>`)의 Bash 제약**: 세션이 워크트리에 격리되면 harness가 "워크트리 밖을 건드릴 수 있다"고 판단하는 명령을 통째로 거부한다 — `cat >> file <<'EOF'` 히어독 append, `cd <루트 체크아웃>`이 섞인 체인, `sed -i`+`git add`처럼 파일 수정과 git을 한 줄에 묶은 것, `&&`가 길게 이어진 복합 명령. 빈 출력이 아니라 **명령 자체가 안 돈다**. 대처: 파일 추가·수정은 Write/Edit 도구로, git·테스트·서버 기동은 **한 줄에 하나씩** 워크트리 안 절대경로로. 워크트리엔 `node_modules`·`backend/.venv`가 없으므로 `cp -Rc`(APFS 클론, 심링크 금지 — turbopack이 거부)로 복제해 둔다.
5. **CSS transform이 걸린 SVG `<g>`는 `locator.click()`이 못 맞춘다**: Playwright가 잡는 클릭점이 실제 그려진 자리와 어긋나 "svg subtree intercepts pointer events"로 30초 타임아웃. `boundingBox()` 중심을 `page.mouse.click(x, y, { button })`으로 찍으면 된다.
6. **평문 HTTP는 localhost에서 재현되지 않는다**: localhost는 secure context라 `crypto.randomUUID`·`crypto.subtle`·Clipboard API가 돌아간다. 서버(원격 IP, 평문 HTTP)에서만 깨지는 코드는 LAN IP로 접속해 다시 확인한다.
7. **헤드리스 Chrome은 blob 내려받기 이름을 `download`로 알린다**: 인증 헤더가 필요한 파일(Excel 등)은 `apiFetchBlob`으로 받아 `<a download="…">`로 저장하는데, 헤드리스에서 `download.suggestedFilename()`은 `download`가 나온다(앵커의 `download` 속성은 정확했다). 스모크는 내려받기가 시작됐는지만 보고, 파일 이름 규칙은 `lib/download-name.test.ts` 단위 테스트가 본다.
8. **대비는 토큰 쌍이 아니라 그려진 글자로 잰다**: 토큰 표가 전부 통과해도 다른 값이 새어 들어오면 화면 글자가 안 보일 수 있다. `scripts/pw-contrast-audit.mjs`는 글자마다 배경을 아래에서부터 쌓아 실제 대비를 재고(oklch·color-mix는 1×1 캔버스로 sRGB 변환), 시작 전에 일부러 넣은 흐린 글자를 잡는지 확인한다. 감사가 아무것도 못 잡는 상태로 "전부 통과"하는 것을 막기 위해서다.

9. **보통 자료만으로는 극단 자료에서만 무너지는 화면을 못 본다 — 극단 자료 시드와 배치 감사로 잰다**: 별도 sqlite 파일에 `reset_db → seed_sop_demo → seed_sop_worst`(`backend/`에서, `DATABASE_URL=sqlite+aiosqlite:///<경로>/worst.db AUTH_MODE=dev`, `DEV_ENFORCE_PERMISSIONS`는 켜지 않는다 — 켜면 bundle.create가 403)를 차례로 돌리고(시드는 약 2분 반, 같은 자료는 건너뛰어 다시 돌려도 된다), 그 파일로 backend를 `DEV_ENFORCE_PERMISSIONS=true`로 8787, frontend를 3787에 띄운다(`dev.db`·3777/8777과 섞이지 않게 — 실행 중인 DB 파일은 바꾸지 않는다, 함정 2). `frontend/`에서 `DS=worst|mid ONLY=<항목 id> BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs`. `mid`는 데모 묶음 1~4, `worst`는 `SYNTHETIC W1…W7`·`light NN` 묶음이다. 항목은 `AUDIT_ENTRIES`에 `{id, ds, user, path(ids), views, measure, expect}`로 더하고, 숫자 기준은 풀어 주지 않고 잰 값을 보고한다. 목록·ID는 묶음 목록 API에서 제목 접두로 찾으니 시드의 제목 접두를 바꾸면 감사도 함께 고친다.

## 기타
- 스크린샷은 Read로 직접 볼 수 있다.
- `element.offsetParent !== null`은 페인트/가시성이 아니다 → `getComputedStyle().visibility` / `document.elementFromPoint`로 실가시성 확인.
- `addInitScript`의 localStorage 접근은 `about:blank`·`setContent`에서 SecurityError를 낸다 → `location.protocol === "about:"`이면 건너뛴다.
- 검증 후 정리: 임시 `_*.mjs` 삭제, 내가 띄운 백엔드·프론트만 kill(사용자의 기존 서버 보존), `backend/`에서 `reset_db`로 테스트 오염 복원(그 뒤 백엔드 재시작).
