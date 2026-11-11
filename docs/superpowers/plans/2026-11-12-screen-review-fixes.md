# Screen Review Fixes Implementation Plan — 화면 검토 반영

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-11-12 전 화면 검토(보통·극단 자료, 201장면)의 발견 45건을 프런트에 반영하고, 극단 자료와 그 측정을 저장소 안의 다시 돌릴 수 있는 감사 스크립트로 남긴다.

**Architecture:** 먼저 극단 자료 시드(`backend/scripts/seed_sop_worst.py`)와 배치 감사(`frontend/scripts/pw-layout-audit.mjs`)를 저장소에 넣는다. 그 뒤 화면군별 작업마다 "감사 항목 추가 → 실패 확인 → 고침 → 통과" 순서로 간다. 고침은 대부분 CSS·열 설정이고, B군만 부품을 새로 놓거나 바꿔 끼운다. backend 동작은 바꾸지 않는다.

**Tech Stack:** Next.js 16 · React 19 · Tailwind 4(`frontend/src/styles/*.css`) · vitest · Playwright-core + 시스템 Chrome · FastAPI TestClient(시드만).

**Spec:** 검토 보고서는 저장소 밖(비공개 Artifact "SOP Archivist 화면 검토")에 있다. 이 계획이 발견 ID·증상·처방·시험 결과를 모두 옮겨 담았으므로 이 문서만으로 실행한다. 발견 ID(A1…D4, R1…R9)는 보고서와 같다.

## Global Constraints

- 작업 위치: 새 워크트리 + 브랜치 `fix/screen-review`(`dev`에서 분기). 원본 체크아웃과 `backend/dev.db`는 건드리지 않는다.
- 검증 DB는 별도 sqlite 파일(`DATABASE_URL`)이고 포트는 backend 8787 · frontend 3787(원본 체크아웃의 8777 · 3777과 겹치지 않게).
- 시드 스크립트는 로컬 전용이다. `AUTH_MODE=dev`가 아니면 거절한다(`seed_sop_demo.py`와 같은 가드). 내용은 전부 합성이고 파일 이름은 `SYNTHETIC_`로 시작한다. 절대 경로·사내 호스트명을 넣지 않는다.
- 화면에 보이는 새 문구는 `src/lib/i18n-messages.ts`에 en·ko 둘 다. 새 조작 요소에는 `data-testid`(`surface-role`).
- 한쪽 막대 강조는 막대 쪽 모서리가 직각. 아이콘만 있는 표시는 툴팁이 기본. 펼친 라벨이 옆 글을 덮으면 그 작업에서 배치까지 고친다.
- 2줄 제한(`line-clamp`)으로 글을 자르는 곳은 전체 글을 볼 길(툴팁·상세 창·펼치기) 하나를 반드시 같이 둔다.
- 화면·라벨이 바뀌면 `frontend/public/manual/user-manual.md`의 해당 조각을 같은 커밋에서 고친다.
- 커밋 메시지 `type(scope): English — 한국어`, 커밋마다 `PROGRESS.md` 1~3줄. 푸시는 GitHub `origin`에만.
- 작업마다 끝 게이트: `npm run lint` · `npx tsc --noEmit -p tsconfig.json` · `npx vitest run` 모두 통과, 마지막 작업에서 `npm run build` 경고 0.
- 줄 끝 동작 단추는 호버 때만 보이게 하지 않는다. 늘 제자리에 흐리게 두고 줄 호버·포커스 때 진하게 한다(사용자 결정 2026-11-12, Task 13).

## 정해 둔 기본값 (검토에서 "결정 필요"였던 것)

실행 전에 바꾸고 싶으면 이 표만 고치면 된다.

| 항목 | 기본값 | 이유 |
|---|---|---|
| C7 목록 화면 폭 | Bundle 목록 · Documents · To-Be · History · 관리 목록은 `data-width="wide"`(1600). 개요 · 계정 · 설명서는 1280 그대로 | 표는 넓을수록 줄 수가 늘고, 읽는 글은 1280이 맞다. Documents 제목 열이 눌리던 원인(P13)도 같이 풀린다 |
| C7 상단 바 | 그대로 끝에서 끝까지 | 본문 상한에 맞추면 Assign(더 넓음)과 다시 어긋난다 |
| C1 Assign 폭 상한 | 새 토큰 `--page-max-desk: 1920px`, Assign만 | 2560에서 문장 칸 610 → 약 750px. Split은 1600 그대로 |
| C1 오른쪽 패널 | `clamp(280px, 24vw, 420px)`. "고른 것이 없으면 좁은 띠로 접기"는 하지 않는다 | 고를 때마다 문장 칸 폭이 바뀌어 줄바꿈이 다시 일어난다 |
| B3 검토 화면 | 되돌림 쪽지만 옮긴다. 제안 그림의 "N회차 · 되돌림 M번"은 넣지 않는다 | 회차 집계 API가 없다 |
| R8 Split 1120 글 폭 | 넣는다(이미 보류된 D-19를 이번에 푼다) | "전부 수용" |

## Review Focus

어느 작업의 감사 항목도 직접 밟지 않지만 사용자에게 가장 먼저 걸릴 것들. 각 줄의 확인은 해당 작업 표의 마지막 줄에 넣었다.

1. **AI를 켠 화면** — 검토는 AI를 끈 채 했다. Assign AI 메뉴와 Split AI 줄이 C11의 한 덩어리 도구 줄에서 넘치지 않아야 한다 → Task 6.
2. **2줄 제한이 지운 글** — A7 · A9 · A11 · A13에서 잘린 전체 글을 키보드만으로도(포커스) 볼 수 있어야 한다 → Task 2, 11.
3. **보통 자료에서의 되돌림** — 극단 처방(고정 배치 표, 열 최소 폭)이 보통 자료 1440에서 빈 열·불필요한 가로 스크롤을 만들면 안 된다 → 모든 작업이 `DS=mid`도 돌린다.
4. **영어 · 다크** — 새 문구가 영어에서 더 길다(B1 · B5 · A12). 1120 영어에서 단추가 두 줄이 되면 안 된다 → Task 7, 8.
5. **1920 넘는 Assign의 연결선** — 폭 상한을 올리면 연결선 길(`link-route-model`)이 넓은 홈을 지난다. `pw-overlap-audit.mjs`를 `WIDTHS=2560`으로 한 번 더 → Task 6.

---

### Task 1: 극단 자료 시드와 배치 감사

**Files:**
- Create: `backend/scripts/seed_sop_worst.py`
- Create: `frontend/scripts/pw-layout-audit.mjs`
- Modify: `CLAUDE.md`(Commands 두 블록), `docs/lessons/browser-verification.md`(한 단락)

**Interfaces:**
- Produces: 시드가 만드는 Bundle 제목 접두(감사가 Bundle 목록 API로 ID를 찾는 열쇠). `SYNTHETIC W1 worst` · `SYNTHETIC W2 in-review` · `SYNTHETIC W3 returned` · `SYNTHETIC W4 done` · `SYNTHETIC W5 reopened` · `SYNTHETIC W6 ready` · `SYNTHETIC W7 empty` · `SYNTHETIC light NN`.
- Produces: 감사 항목 등록 형식 `{ id: "A1", ds: "worst" | "mid", user: "qa.member", path: (ids) => string, views: [1120, 1920], open?: async (page) => void, measure: (page) => Promise<number | boolean>, expect: (value) => boolean, note: string }`. 뒤 작업은 이 배열에 항목을 더하기만 한다.
- Produces: 실행 `DS=worst|mid ONLY=A1,A2 WIDTHS=1120,1920 LANGS=ko,en THEMES=light,dark BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs` — 실패가 있으면 종료 코드 1, 실패 화면은 `../.shots/layout-<id>-<width>.png`.

- [ ] **Step 1: `seed_sop_worst.py` 작성.** 검토 때 쓴 생성기(원본 체크아웃의 `.shots/review-2026-11-12/build_worst.py`, 533줄. gitignore된 폴더라 워크트리에는 없으니 원본 체크아웃 경로에서 읽는다. 자료 명세는 같은 폴더의 `DATA.md`, 촬영·주입 스크립트는 `capture.mjs`·`proto/`. 없으면 아래 명세로 다시 쓴다)를 옮긴다. 절대 경로(`BACKEND = …`)는 빼고 `seed_sop_demo.py`의 import 방식을 따른다. `seed_sop_demo.py`처럼 앱을 프로세스 안에서 돌려 API로만 만들고, 같은 제목이 있으면 건너뛴다. `reset_db → seed_sop_demo` 위에 돈다. 만드는 것:
  - W1(극단 Bundle): 제목 146자 · 설명 900자 · dev 사용자 5명 전원. 문서 = 372 Unit 문서(절 번호 6단, 1,800자 한 문장 문단, 공백 없는 330자 토큰) · 14열×6행 표와 120행×3열 표 문서 · 파일 이름 246자/255자 문서 · 6쪽 PDF · 작은 문서 6개 · 거절되는 파일 4개(무작위 바이트 docx, 0바이트 docx, 깨진 pdf, txt). To-Be 58개(코드 100자까지, 제목 480자/공백 없는 435자/빈 것, WI 단계 0·1·3·12·40개, N/A 사유 1,990자, 넷마다 장비 SOP). 3,000자 New 문장 10개 · 세 곳으로 보낸 Unit 10개 · 보류 사유 1,200자와 공백 없는 690자. 검토 흐름 요청 → 되돌림(1,990자) → 요청 → 완료 → 다시 열기 → 요청 → 거둠 → 요청 → 되돌림.
  - W2~W6: 표의 상태 그대로(W2 제목 200자). W7: 문서 없는 Bundle. light 36개: 제목이 공백 없는 195자 · URL꼴 200자 · 한 글자 · 빈 것 · HTML/따옴표 · 이모지 · 탭 섞인 것, 넷마다 설명 900자.
  - 관리: 역할 10개(이름 100자/공백 없는 91자/1자, 설명 480자는 하나 걸러), 부여 41건(디렉터리에 없는 대상 2건 포함), 지침 키 3개에 버전 3개씩(메모 200자).
  - Unit 1,000개를 넘는 Bundle에서 합성 답안 몰이가 assert로 죽는다. 합성 답안을 큰 문서 업로드보다 먼저 넣는다.
- [ ] **Step 2: 시드를 빈 DB에 돌려 확인.**

  Run(`backend/`): `export DATABASE_URL=sqlite+aiosqlite:///$PWD/../.shots/worst.db AUTH_MODE=dev; .venv/bin/python -m scripts.reset_db && .venv/bin/python -m scripts.seed_sop_demo && .venv/bin/python -m scripts.seed_sop_worst`
  Expected: 마지막 줄 `worst seed done: 46 bundles` 그리고 실패 0. 한 번 더 돌리면 `skipped`만 나온다.
- [ ] **Step 3: `pw-layout-audit.mjs` 작성.** 뼈대(Chrome 경로, `sopa.devUser` · `sopa.lang` · `sopa.theme` 주입, `.shots` 저장)는 `pw-overlap-audit.mjs`를 따른다. 공통 측정 도우미 넷: `maxRowHeight(page, tableTestId)` · `overflowsX(page, selector)`(`scrollWidth > clientWidth + 1`) · `widthOf(page, selector)` · `isInViewport(page, selector)`. 첫 항목으로 "모든 장면에서 `document.documentElement`가 가로로 넘치지 않는다"(ID `X0`, 두 자료 모두)만 넣는다.
- [ ] **Step 4: 두 자료에서 돌린다.** `DS=worst`와 `DS=mid` 각각 `X0` PASS.
- [ ] **Step 5: `CLAUDE.md` Commands에 시드 한 줄(bash·PowerShell)과 감사 한 줄을 더하고 커밋.** `chore(qa): worst-case seed and layout audit — 극단 자료 시드와 배치 감사`

---

### Task 2: 표 열 — 관리 목록과 History

**Files:**
- Modify: `frontend/src/components/admin/bundles-panel.tsx:60-111` · `access-grants.tsx:269-305` · `guidelines-panel.tsx:89-105` · `access-audit.tsx:29` · `access-roles.tsx:211,215`
- Modify: `frontend/src/app/bundles/[id]/history/page.tsx:121`
- Modify: `frontend/src/styles/components.css:307`
- Test: `frontend/scripts/pw-layout-audit.mjs`

| ID | 고침 | 감사 항목(극단 1120, 따로 적지 않으면) |
|---|---|---|
| A5 | 멤버 열을 1280 미만에서 숨기고(구성원 창에서 본다) 제목은 2줄 제한 + 툴팁. 시험에서 "멤버 146px 상한" 처방은 멤버가 잘리고 줄이 73px가 되어 버렸다 | `admin-bundles-list`가 틀을 넘지 않는다. 첫 줄을 호버하면 구성원 단추가 화면 안 |
| A6 | 대상 칸을 `grid-template-columns: max-content max-content; justify-content: start` 두 열(아이콘 \| 이름, 아래 ID)로, 대상·부여자 열 `nowrap`, 역할 열 `overflow-wrap: anywhere` | `grants-table` 줄 높이의 중앙값 ≤ 56px |
| A7 | 메모를 2줄 제한 + 툴팁, 만든 사람 칸은 ID 위 · 시각 아래 | `guideline-versions` 가장 큰 줄 ≤ 80px(지금 333) |
| A8 | 변경자 열 `nowrap: true` | `audit-table` 가장 큰 줄 ≤ 56px(지금 73) |
| A9 | 사유 칸 내용을 `div`로 감싸 2줄 제한(`td`를 직접 제한하면 줄 테두리가 깨진다). 줄을 누르면 열리는 상세 창이 전체 글의 길이다 | `history-list` 가장 큰 줄 ≤ 60px(지금 673) |
| A11 | 역할 설명 2줄 제한(전체는 편집 창), 이름 줄 세로 간격 `gap-y-1` | `role-row-*` 가장 큰 것 ≤ 140px(지금 253) |
| C6 | 제목 아닌 칸 `vertical-align: middle` | 보통 1440: `bundles-row-*` 첫 줄에서 상태 알약의 세로 중심이 줄 중심 ±2px |
| Focus 2 | — | A7 메모 칸에 포커스하면 `role="tooltip"`에 200자 전체가 있다 |

- [ ] **Step 1:** 위 감사 항목 8개를 등록한다.
- [ ] **Step 2:** `DS=worst ONLY=A5,A6,A7,A8,A9,A11 node scripts/pw-layout-audit.mjs` → 6개 FAIL. `DS=mid ONLY=C6` → FAIL.
- [ ] **Step 3:** 표대로 고친다. 2줄 제한은 `components.css`에 유틸 하나(`.clamp-2`)를 두고 같이 쓴다.
- [ ] **Step 4:** 같은 명령 → 전부 PASS. `DS=mid`(전체)도 PASS. 끝 게이트.
- [ ] **Step 5:** 커밋 `fix(lists): keep admin and history rows compact under long text — 긴 글에서도 표 줄 높이 유지`

---

### Task 3: To-Be

**Files:**
- Modify: `frontend/src/app/bundles/[id]/tobe/page.tsx:182-188, 324-336, 397-410`

| ID | 고침 | 감사 항목 |
|---|---|---|
| A1 | 상위 SOP `Select` 160px 고정 + 값 말줄임 + 전체 값 툴팁. 열 최소 폭: 문서 번호 160 · 제목 220 · 상위 SOP 180 | 극단 1120·1920: `tobe-list`가 틀을 넘지 않는다. 문서 번호 칸 폭 ≥ 160 |
| C3 | N/A 칸 묶음을 `grid-template-columns: repeat(auto-fill, minmax(360px, 1fr))`로 흘리고 사유 입력은 체크한 줄 바로 아래(같은 격자 칸 안) | 보통 1920: SOP 하나를 펼친 `tobe-*-slots` 높이 ≤ 280px(지금 520) |

- [ ] **Step 1:** 감사 항목 등록. C3의 `open`은 첫 SOP 줄의 펼침 단추를 누른다.
- [ ] **Step 2:** 돌려서 FAIL 확인.
- [ ] **Step 3:** 고친다. C3에서 하위 칸(`slotKey`에 `.`이 든 것)이 상위 칸과 다른 단으로 갈라지지 않게 상위 칸과 그 하위 칸을 한 묶음 요소로 감싼다.
- [ ] **Step 4:** PASS 확인, `pw-smoke-sop.mjs`의 To-Be 단계 PASS, 끝 게이트.
- [ ] **Step 5:** 커밋 `fix(tobe): bound the parent picker and flow N/A slots in columns — 상위 SOP 칸 폭 고정·N/A 칸 여러 단`

---

### Task 4: Split

**Files:**
- Modify: `frontend/src/styles/components.css:556-566, 593-594, 1038`
- Modify: `frontend/src/app/bundles/[id]/split/page.tsx:471, 625, 667`
- Modify: `frontend/src/lib/strip-pill-model.ts:18` (+ `strip-pill-model.test.ts`가 있으면 그 기대값)

| ID | 고침 | 감사 항목 |
|---|---|---|
| A2 | `.ptbl { width: auto; min-width: 100% }` · `.ptbl td { min-width: 16ch }` · `.cell-piece { padding-right: 38px }`. `width: max-content`는 쓰지 않는다(시험에서 3,384px). 표를 감싼 조각만 가로로 스크롤하고 책상 자체의 가로 스크롤과 두 겹이 되지 않게 책상 쪽 `overflow-x`를 `clip`으로 | 극단(14열 표 문서) 1120: 표 칸 폭의 최솟값 ≥ 100px. 칸 표시 아이콘 상자가 칸 글 상자와 겹치지 않는다 |
| A3 | `.pg { grid-template-columns: minmax(0, 1fr) }` · `.pg p, .pg .su { overflow-wrap: anywhere }` | 극단(372 Unit 문서) 1920: 모든 `.pg`의 오른쪽 끝 ≤ `split-inspector`의 왼쪽 끝 |
| C2 | 고른 Unit이 없으면 ID 자리의 "–"와 꺼진 단추 묶음을 그리지 않고 안내 + 진행 요약(확인 n / 전체)만. 도움말 패널은 처음에 접힌 상태 | 보통·극단 1120: 처음 열었을 때 `split-inspector` 안에 `:disabled` 단추 0개. `split-docs`에 보이는 문서 단추 ≥ 12개(지금 8.5) |
| R8 | 1280 미만에서 오른쪽 열 하한 280px, 절 번호 3단 이상의 탭 폭 46px | 극단 1120: 1,800자 문단의 글 상자 폭 ≥ 340px(지금 280) |

- [ ] **Step 1:** 감사 항목 등록(문서는 파일 이름 접두로 찾아 `?doc=`으로 연다). R8에 순수 모델 기대값이 있으면 `strip-pill-model.test.ts`에 "depth ≥ 3 → 46"을 먼저 쓴다.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 고친다.
- [ ] **Step 4:** PASS 확인, `pw-smoke-sop.mjs` Split 단계와 `pw-overlap-audit.mjs` PASS, 끝 게이트. 도움말 기본값이 바뀌므로 `user-manual.md`의 Split 조각을 고친다.
- [ ] **Step 5:** 커밋 `fix(split): wide tables, unbreakable tokens and a quiet idle inspector — 넓은 표·긴 토큰·빈 패널`

---

### Task 5: 결과물 A · B · C

**Files:**
- Modify: `frontend/src/app/bundles/[id]/outputs/page.tsx:230, 268, 278`
- Modify: `frontend/src/components/outputs/output-c.tsx:229` 와 줄 끝 단추를 그리는 부분

| ID | 고침 | 감사 항목 |
|---|---|---|
| A4 | 보낸 곳 칸의 `whitespace-nowrap` 제거, 표 `table-layout: fixed`(128px / 27% / 20% / 나머지 / 128px), 글 칸 `overflow-wrap: anywhere`. 원문·New 문장 칸은 6줄 제한 + 줄마다 "펼치기"(`output-a-<id>-expand`, 3,000자 문장 줄이 4,929px였다) | 극단 1120·1920: `output-a`가 틀을 넘지 않는다. 가장 큰 줄 ≤ 220px. 펼치기를 누르면 그 줄만 커진다 |
| C8 | 줄 끝 단추 묶음을 글 오른쪽의 고정 여백(184/104px)에서 **줄 아래 한 줄**로 옮긴다(호버·포커스 때만 높이가 생기지 않게 자리는 늘 0, 줄 사이 홈에 겹쳐 그린다). 여백만 빼면 단추가 첫 줄 끝을 덮는다(시험 P17) | 극단 1120: `output-c-item-*` 폭 ≥ 줄 폭 − 24px. 호버했을 때 단추 묶음 상자가 그 줄과 다음 줄의 글 상자와 겹치지 않는다 |
| C9 | 이름표 칸 `minmax(140px, 40%)`, 코드는 가운데 말줄임(앞 12자 … 뒤 10자) + 툴팁, 대상이 8개를 넘으면 8개 뒤 "N개 더"(`output-b-<id>-more`) | 극단 1120: 한 카드 안에서 보이는 이름표 글이 모두 다르다. 가장 큰 카드 높이 ≤ 320px |

- [ ] **Step 1:** 감사 항목 등록. C9의 가운데 말줄임은 순수 함수 `truncateMiddle(text: string, head: number, tail: number): string`을 `src/lib/truncate-middle.ts`에 두고 `truncate-middle.test.ts`를 먼저 쓴다(짧으면 그대로, 길면 `head + "…" + tail`, 길이 `head + tail + 1`).
- [ ] **Step 2:** vitest FAIL, 감사 FAIL 확인.
- [ ] **Step 3:** 고친다. C8은 `pw-overlap-audit.mjs`의 "C 줄 끝 단추" 장면이 새 자리에서도 재도록 선택자를 맞춘다.
- [ ] **Step 4:** PASS 확인(`pw-overlap-audit.mjs`는 `LONG=1`로도), 끝 게이트. `user-manual.md` 결과물 조각.
- [ ] **Step 5:** 커밋 `fix(outputs): fixed A columns, C actions under the line, readable B labels — A 표 고정 배치·C 단추 자리·B 이름표`

---

### Task 6: Assign

**Files:**
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx:1099-1126, 1318-1375, 1436`
- Modify: `frontend/src/components/assign/link-menu.tsx:52-56`
- Modify: `frontend/src/components/paper/paper.tsx:568`
- Modify: `frontend/src/styles/components.css:1182, 1323-1328` · `tokens.css:21` · `components/app-shell.tsx:17`

| ID | 고침 | 감사 항목 |
|---|---|---|
| A10 | `.tree-chev, .tree-sub { flex: none }`, 코드 한 줄 말줄임 + 툴팁, `.dest-tree, .tree-kids { grid-template-columns: minmax(0, 1fr) }`, `.tree-node { min-width: 0 }` | 극단 1120: `.tree-node` 가장 큰 높이 ≤ 32px. 개수 칸이 패널 안 |
| B4 | 메뉴의 세로 기준을 누른 좌표가 아니라 줄 상자로: `y = rect.bottom`, 위로 뒤집을 때는 `rect.top`. 가로는 누른 x 그대로 | 보통 1120·1920: 메뉴 상자가 잇고 있는 두 줄(`anchor`와 짝 줄)의 글 상자와 겹치지 않는다 — `pw-overlap-audit.mjs`의 그 자리 메뉴 장면은 지금 화면 밖 넘침(`findSpill`)만 잰다. 두 줄의 글을 덮는지(`findCovered`)를 더한다 |
| C1 | 격자 `grid-cols-[minmax(0,1fr)_clamp(280px,24vw,420px)]`. `--page-max-desk: 1920px`를 더하고 Assign만 `data-width="desk"` | 보통 1120: 문서 칸 폭 ≥ 350px(지금 320). 2560: 작업면 폭 = 1920 |
| C11 | 도구 줄 오른쪽 묶음(개수 · 초기화 · 보기 아이콘)을 한 요소로 감싸 `margin-left: auto; flex: none`. 여기의 "Synthetic data" 칩은 뺀다(상단 바에 이미 있다) | 보통 1440: 도구 줄 높이 ≤ 44px. 1120: ≤ 80px(지금 92) |
| R1 | 표 칸에 줄 끝 아이콘 자리만큼 `padding-right`, 표는 칸 전체 폭 | 보통 1120: 표 칸 안 마지막 낱말 상자와 아이콘 상자가 겹치지 않는다 |
| R2 | 패널 사유 칸을 두 열에 걸친 자동 높이 `textarea`(최대 6줄), 단추 셋은 3열 격자 | 극단: 1,200자 사유가 든 Unit을 고르면 사유 칸 높이 ≥ 3줄 |
| Focus 1 | — | 가짜 AI를 켠 backend(`AI_ENABLED=true …`)에서 1120: 도구 줄 높이 ≤ 80px |
| Focus 5 | — | `WIDTHS=2560 node scripts/pw-overlap-audit.mjs` PASS |

- [ ] **Step 1:** 감사 항목 등록, overlap 감사의 메뉴 장면 수정.
- [ ] **Step 2:** FAIL 확인(B4는 overlap 감사가 새로 FAIL이어야 한다. 지금 ALL PASS인 것은 그 장면이 넘침만 재기 때문이다).
- [ ] **Step 3:** 고친다. `link-menu.tsx`의 자리 계산은 순수 함수 `placeLinkMenu(row: DOMRect, clickX: number | null, menu: { width: number; height: number }, viewport: { width: number; height: number }): { top: number; left: number }`로 빼서 `src/lib/link-menu-place.ts`에 두고 `link-menu-place.test.ts`(아래로 / 아래가 모자라면 위로 / 좌우 끝 맞춤 세 경우)를 먼저 쓴다.
- [ ] **Step 4:** PASS 확인, `pw-smoke-sop.mjs` Assign 단계 PASS, 끝 게이트. `user-manual.md` Assign 조각(그 자리 메뉴 위치, 도구 줄).
- [ ] **Step 5:** 커밋 `fix(assign): menu clear of the linked lines, fluid inspector, one-row toolbar — 메뉴 자리·패널 폭·도구 줄`

---

### Task 7: 개요

**Files:**
- Modify: `frontend/src/app/bundles/[id]/page.tsx:110-140, 317-404`
- Modify: `frontend/src/components/review-return-note.tsx:37`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Produces: i18n 키 `notice.equipmentSlotsGroup`(`{n}` — en "{n} SOPs have empty equipment SOP slots" / ko "장비 SOP 칸이 빈 문서 {n}개") · `overview.noticesMore`(`{n}`) · `overview.notStarted`(en "Not started — add documents first" / ko "아직 시작 전 — 문서부터 올리세요") · `common.showMore` · `common.showLess`.

| ID | 고침 | 감사 항목 |
|---|---|---|
| A12 | `equipment_sop_empty_slots` 안내가 2개 이상이면 한 줄로 묶고 누르면 문서 코드 목록이 펼쳐진다(`overview-notice-group`). 검토 요청 단추를 안내 위로 | 극단 1120: `overview-request-review`가 첫 화면(y ≤ 800) 안(지금 1,045) |
| B5 | 문서가 0개면 검토 조건 목록 대신 중립 한 줄(`overview-gate-idle`, 빨강·파랑 없음), 진행 묶음은 흐린 한 줄 | 보통: 새 Bundle(W7) 개요에 `.gate-group.fail` 0개. 본문 높이 ≤ 520px |
| R4 | 되돌림 사유를 8줄에서 자르는 대신 아래쪽 흐림 + "더 보기"(`overview-return-more`)로 펼친다. 안쪽 스크롤은 없앤다 | 극단(W3): 접힌 상태에서 단추가 보이고 누르면 사유 요소가 `scrollHeight`만큼 커진다 |
| Focus 4 | — | 영어 1120: 검토 요청 단추가 한 줄(높이 ≤ 36px) |

- [ ] **Step 1:** 감사 항목 등록. 묶기는 순수 함수 `groupNotices(notices: Notice[]): Array<Notice | { code: "equipment_sop_empty_slots"; docs: string[] }>`로 `src/lib/review-gates.ts`에 더하고 `review-gates.test.ts`에 세 경우(0개, 1개는 그대로, 3개는 한 묶음에 코드 3개)를 먼저 쓴다.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 고친다.
- [ ] **Step 4:** PASS 확인, 끝 게이트, `user-manual.md` 개요 조각.
- [ ] **Step 5:** 커밋 `fix(overview): group repeated notices and calm the empty bundle — 안내 묶기·빈 Bundle 중립 표시`

---

### Task 8: 없는 주소와 열 수 없는 Bundle

**Files:**
- Create: `frontend/src/app/not-found.tsx`
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx:1309` · `documents/page.tsx:282` · `split/page.tsx:602` · `outputs/page.tsx:204` · `history/page.tsx:94`
- Modify: `frontend/src/components/top-bar.tsx:44-45` · `stage-nav.tsx:31-35`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `BundleLoadError({ error, onRetry, testId })`(`components/bundle-load-error.tsx`).
- Produces: i18n 키 `notFound.title`(en "There is no page at this address" / ko "이 주소에는 화면이 없습니다") · `notFound.body`(en "The address changed or the link was wrong." / ko "주소가 바뀌었거나 잘못 들어온 길입니다."). 단추는 기존 `bundle.backToList`.

| ID | 고침 | 감사 항목 |
|---|---|---|
| B1 | `not-found.tsx`는 앱 틀 안에서 `EmptyState`(아이콘 `FileQuestion`, `testId="not-found"`, 단추 `not-found-back`)를 그린다 | `/no-such-page` 다크: `body` 배경이 `--bg`와 같다. `not-found-back`이 보인다. 한국어에서 영어 문구 "This page could not be found"가 없다 |
| B2 | 다섯 화면의 `LoadError` → `BundleLoadError`(같은 `testId`) | `prod.member`(비멤버)로 다섯 주소: 각각 `<testId>-missing`과 `<testId>-back`이 보이고 `<testId>-retry`는 없다 |
| R6 | Bundle을 못 불러왔으면 상단 바의 뒤로 · 구분선 묶음과 단계 레일을 그리지 않는다 | 같은 다섯 주소: 단계 레일의 링크 0개 |
| Focus 4 | — | 영어 다크 1120에서 B1 통과 |

- [ ] **Step 1:** 감사 항목 등록(`user: "prod.member"`).
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 고친다.
- [ ] **Step 4:** PASS 확인, `i18n-messages.test.ts` 포함 끝 게이트.
- [ ] **Step 5:** 커밋 `fix(shell): real not-found page and a way out of bundles you cannot open — 없는 주소 화면·못 여는 Bundle에서 나가는 길`

---

### Task 9: 검토 화면의 되돌림 쪽지

**Files:**
- Modify: `frontend/src/components/review-return-note.tsx:20-29`
- Modify: `frontend/src/app/bundles/[id]/review/page.tsx:103-111`

**Interfaces:**
- Produces: `ReviewReturnNote({ bundle, testId = "overview-return-note" }: { bundle: Bundle; testId?: string })` — 안쪽 요소의 testid도 접두를 따른다(`<testId>`의 `-note`를 뗀 접두 + `-reason` · `-outputs` · `-more`). 개요는 기본값이라 기존 스모크가 그대로 돈다.

| ID | 고침 | 감사 항목 |
|---|---|---|
| B3 | 검토 화면 본문을 1280 이상에서 `grid-cols-[minmax(0,760px)_minmax(280px,1fr)]`로 하고 오른쪽 열 위에 `ReviewReturnNote`(`testId="review-return-note"`). 그보다 좁으면 용지 위에 쌓는다 | 극단(W3, `qa.member`와 `qa.lead` 둘 다) 1920 영어 다크·1120: `review-return-note`가 보이고 사유 첫 20자가 화면에 있다. W2(검토 중)에는 없다 |

- [ ] **Step 1:** 감사 항목 등록.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 고친다.
- [ ] **Step 4:** PASS 확인, `pw-smoke-sop.mjs` 검토 단계 PASS, 끝 게이트, `user-manual.md` 검토 조각.
- [ ] **Step 5:** 커밋 `fix(review): show why a bundle came back on the review screen — 검토 화면에 되돌림 사유`

---

### Task 10: Bundle 목록과 목록 화면 폭

**Files:**
- Modify: `frontend/src/app/page.tsx:76-96`
- Modify: `frontend/src/styles/components.css:350, 630`
- Modify: `frontend/src/components/app-shell.tsx:17`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Produces: i18n 키 `bundles.untitled`(en "Untitled" / ko "이름 없음").

| ID | 고침 | 감사 항목 |
|---|---|---|
| B7 | 제목이 비면 흐린 `bundles.untitled`를 제목 자리에 그린다(`bundles-untitled-<id>`) | 보통·극단: 제목 없는 줄의 높이 = 제목 있는 줄의 높이 |
| C5 | 카드에서 `.dl-title-row`를 세로로(칩은 늘 제목 아래 줄), `.dcard`는 세로 flex, `.dcard-meta { margin-top: auto }` | 보통 1440·극단 1920: 같은 줄의 카드에서 `.dcard-meta`의 아래 끝이 같다(±1px). 합성 칩의 왼쪽 끝이 카드마다 같다 |
| C7 | 위 "정해 둔 기본값" 표대로 목록 화면에 `data-width="wide"` | 극단 2560: Bundle 목록 본문 폭 = 1600. 개요 · 계정은 1280. 극단 1920 Documents: 제목 열 폭 ≥ 420px |

- [ ] **Step 1~2:** 감사 항목 등록, FAIL 확인.
- [ ] **Step 3:** 고친다. `app-shell.tsx`의 경로 → 폭 판정이 순수 함수가 아니면 `getPageWidth(pathname: string): "default" | "wide" | "desk"`로 빼고(`src/lib/page-width.ts`) `page-width.test.ts`를 먼저 쓴다(`/` wide, `/bundles/1` default, `/bundles/1/documents` wide, `/bundles/1/split` wide, `/bundles/1/assign` desk, `/account` default, `/manual` default, `/admin` wide). Task 6의 `desk`도 이 함수로 모은다.
- [ ] **Step 4:** PASS 확인, `pw-contrast-audit.mjs` PASS(흐린 자리 글 4.5:1), 끝 게이트.
- [ ] **Step 5:** 커밋 `fix(bundles): steady card skeleton, untitled placeholder, wider lists — 카드 뼈대·이름 없음·목록 폭`

---

### Task 11: 관리 화면 나머지와 창

**Files:**
- Modify: `frontend/src/components/admin/hr-sync-panel.tsx:185-211` · `bundles-panel.tsx:148`
- Modify: `frontend/src/components/manage/members-modal.tsx:94` · `components/modal.tsx:115`
- Modify: `frontend/src/styles/components.css:357-358, 390-391`

| ID | 고침 | 감사 항목 |
|---|---|---|
| B6 | 목록 응답이 503이면 "설정되어 있지 않습니다" 안내를 단추 줄 위에 `InlineNotice`로, 두 단추 `disabled`, 표·카드 토글 숨김 | 보통(로컬은 HR 미설정): `hr-sync-run`이 꺼져 있고 안내의 y < 단추의 y |
| C12 | `cardActions="row"`를 빼고 구성원 단추를 메타 줄 오른쪽 끝으로. 펼친 라벨이 메타 글을 덮지 않게 그 줄 오른쪽에 라벨 폭만큼 자리를 둔다 | 보통 1440: 관리 Bundle 카드 높이 ≤ 116px(지금 158). overlap 감사에 이 단추 장면 추가, PASS |
| D1 | `.side-nav-item[aria-selected="true"]:not(.sub):has(~ .sub)`로 좁힌다(두 줄 모두) | 보통: 역할 · 부여 · 변경 기록 각각에서 고른 하위 항목의 배경이 `--sel-bg`, 부모 "권한"의 배경은 투명 |
| R5 | 역할 선택 칸 고정 폭 140px, 삭제 자리 32px | 극단 멤버 창: 모든 줄의 선택 칸 왼쪽 끝과 폭이 같다 |
| A13 | 창 머리 `h2` 2줄 제한 + `overflow-wrap: anywhere` + 전체 제목 툴팁, 멤버 창 문구 순서를 "멤버 — 코드 제목"으로 | 극단 1120 멤버 창: 창 머리 높이 ≤ 72px(지금 170). 머리 글이 "멤버"로 시작 |
| Focus 2 | — | A13 머리에 포커스하면 툴팁에 146자 전체 |

- [ ] **Step 1~2:** 감사 항목 등록, FAIL 확인.
- [ ] **Step 3:** 고친다.
- [ ] **Step 4:** PASS 확인, `pw-smoke-baseline.mjs` PASS, 끝 게이트.
- [ ] **Step 5:** 커밋 `fix(admin): honest HR sync state, visible sub-tab selection, compact cards and dialogs — 동기화 미설정 표시·하위 탭 선택·카드와 창`

---

### Task 12: 공통 부품

**Files:**
- Modify: `frontend/src/components/ai-jobs-popover.tsx:188-226`
- Modify: `frontend/src/styles/tokens.css:152` · `components.css:500-507, 1143-1144`
- Modify: `frontend/src/app/account/page.tsx:20-22, 38-`
- Modify: `frontend/src/components/dev-user-switcher.tsx`

| ID | 고침 | 감사 항목 |
|---|---|---|
| C4 | 끝난 작업(진행 중 아님, 실패 0)은 상태 · 시각 · 열기 화살표를 첫 줄로 올려 한 줄. 둘째 줄은 진행 중이거나 실패가 있을 때만. 실패가 있으면 진행 수를 "12 / 14"(성공 / 전체)로 적어 "14 / 14 · 2 failed" 모순을 없앤다 | 극단 1120: `data-outcome="done"` 줄 높이 ≤ 36px(지금 63). 목록의 마지막 줄이 잘리지 않는다 |
| D2 | 다크 토큰 두 블록에 `--scrim: color-mix(in oklab, black 62%, transparent)` | 다크에서 창을 열었을 때 `.modal-scrim` 계산 배경의 알파 ≥ 0.6 |
| D4 | `h1`에 `w-fit`, 권한은 상자 여럿 대신 구분선 목록 하나 | 보통: 제목 밑줄 폭 ≤ 제목 글 폭 + 8px. `account-permissions` 높이 ≤ 권한 수 × 44px |
| R3 | 도움말 패널 본문의 옆 여백을 패널과 같은 값으로, 잘리는 쪽에 위쪽 그림자 | 1120×800: 도움말 글 왼쪽 끝 = 패널 내용 왼쪽 끝 |
| R7 | 개발 전환 칸에서 사람 아이콘을 빼고 로그인 ID + `DEV` 표시만 | 보통 1120: 전환 칸 폭 ≤ 160px(지금 240) |
| R9 | 공통 선택 칸의 화살표를 평소에도 흐리게 보인다(호버·포커스 때 진하게) | 화살표 `opacity` > 0 |

- [ ] **Step 1~2:** 감사 항목 등록, FAIL 확인. C4의 진행 수 표기는 `ai-jobs-model.ts`에 `formatProgress(jobs): { done: number; total: number }`가 이미 있으면 그 시험에 "failed 2, done 12, total 14 → 12 / 14"를 먼저 더한다.
- [ ] **Step 3:** 고친다.
- [ ] **Step 4:** PASS 확인, `pw-overlap-audit.mjs`(AI 작업 목록 장면) · `pw-contrast-audit.mjs` `THEMES=light,dark` PASS, 끝 게이트.
- [ ] **Step 5:** 커밋 `fix(ui): one-line finished AI jobs, darker dark scrim, account and picker polish — AI 작업 줄·다크 창 가림막·계정 화면`

---

### Task 13: Documents — 알약 압축과 늘 보이는 흐린 단추 (C10)

방향은 사용자 결정(2026-11-12)이다. 정상 상태는 아이콘만, 예외만 글자 알약. 단추는 호버 전용이 아니라 늘 제자리에 흐리게.

**Files:**
- Modify: `frontend/src/components/documents/doc-status.tsx:11-37`
- Modify: `frontend/src/app/bundles/[id]/documents/page.tsx:120-150, 230-235`
- Modify: `frontend/src/styles/motion.css`(`.row-actions` 옆)
- Modify: `frontend/scripts/pw-smoke-sop.mjs`(상태 알약의 글자를 읽는 곳이 있으면)

**Interfaces:**
- Produces: `DocStatusPill` · `AuxPill`은 정상 상태(`status === "ready"`, `aux_status === "ok"`)에서 글자 없이 아이콘(14px)만 그린다. `Tooltip`과 `aria-label`에 지금의 라벨("Ready" · "Checked")을 두고 `tabIndex={0}`. 그 밖의 상태(거절 · 실패 · 처리 중 · 보조 검사 불가)는 지금의 글자 알약 그대로. `data-testid`는 그대로, `data-state="ok" | "exception"`을 더한다. 넓은 표(열이 따로)와 좁은 표(한 칸) 둘 다 같은 모양이다.
- Produces: CSS `.row-actions-quiet { opacity: .45; transition: opacity var(--dur-fast) }`, 줄 `:hover` · `:focus-within`에서 1, `@media (hover: none)`에서 늘 1.

| 고침 | 감사 항목(극단 1120, 따로 적지 않으면) |
|---|---|
| 좁을 때의 `trailColumn`을 한 줄로: 왼쪽에 상태 · 보조 검사 · 경고 개수 칩, 오른쪽 끝에 단추(`justify-between`). 둘째 줄과 음수 여백을 없앤다. `minWidth` 220 → 200 | 모든 줄에서 그 칸 높이 ≤ 40px. 단추 묶음의 오른쪽 끝 x가 줄마다 같다(±1px) |
| 경고 개수 칩은 그대로(숫자가 정보다) | 경고가 있는 줄에 칩의 숫자가 보인다 |
| 단추 묶음(넓은 표의 `actionsColumn` 포함)에 `.row-actions-quiet` | 평소 `opacity` 0.45, 줄 호버 때 1, Tab으로 단추에 들어가도 1 |
| 펼친 단추 라벨이 왼쪽 알약을 덮지 않게 라벨은 왼쪽으로 펼치지 말고 툴팁으로 바꾼다(이 칸에서만 `MorphButton` 대신 아이콘 단추 + `Tooltip`) | `pw-overlap-audit.mjs`의 Documents 단추 장면 PASS(`LONG=1` 포함) |
| 읽기 전용 제목(거절된 줄)에도 편집되는 제목과 같은 7px 안쪽 여백과 굵기 | 거절된 줄 제목 글의 왼쪽 x = 정상 줄 제목 글의 왼쪽 x. `font-weight`가 같다 |
| Focus 2 | 정상 상태 아이콘에 포커스하면 툴팁에 "Ready". `aria-label`이 비어 있지 않다 |
| Focus 3 | 보통 1440: 상태 · 보조 검사 열 폭의 합이 지금보다 줄고 제목 열이 그만큼 넓다 |

- [ ] **Step 1:** 감사 항목 등록.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 고친다.
- [ ] **Step 4:** PASS 확인, `pw-smoke-sop.mjs` Documents 단계 · `pw-contrast-audit.mjs` PASS, 끝 게이트. `user-manual.md` Documents 조각(상태를 아이콘으로 읽는 법)을 고친다. 그림은 Task 14에서 다시 뽑는다.
- [ ] **Step 5:** 커밋 `fix(documents): icon-only normal states and quiet always-visible row actions — 정상 상태 아이콘·늘 보이는 흐린 단추`

---

### Task 14: 설명서 그림, 버전, 마무리

**Files:**
- Modify: `frontend/public/manual/img/*`(다시 뽑기) · `frontend/src/styles/manual.css`
- Modify: `frontend/package.json` · `package-lock.json` · `CHANGELOG.md` · `PROGRESS.md`

- [ ] **Step 1 (D3):** `manual.css`에 다크 전용 `.manual img { filter: brightness(.85) }`(다크 블록 둘 다)를 더하고, `reset_db → seed_sop_demo` 직후 DB에서 `MANUAL=app BASE_URL=http://localhost:3787 node scripts/pw-manual-shots.mjs`로 17장을 다시 뽑는다. 확인: 그림 속 상단 바 버전이 새 버전과 같다.
- [ ] **Step 2:** `npm version patch --no-git-tag-version`(0.15.1). `CHANGELOG.md`의 `## Unreleased (dev)` 아래에 `v0.15.1 — 2026-11-12` 한 줄과 바뀐 것(작업 2~13을 화면군별 한 줄씩). `manual-content.test.ts`는 PATCH라 그대로 통과해야 한다.
- [ ] **Step 3: 전체 확인.** `DS=worst`와 `DS=mid`로 `pw-layout-audit.mjs` 전체(`WIDTHS=1120,1440,1920,2560 LANGS=ko,en THEMES=light,dark`) · `pw-smoke-baseline.mjs` · `pw-smoke-sop.mjs` · `pw-overlap-audit.mjs`(`LONG=1`) · `pw-contrast-audit.mjs` 모두 PASS. `npm run build` 경고 0. backend는 `ruff check scripts/seed_sop_worst.py`와 `pytest tests/ -q -n auto`.
- [ ] **Step 4:** 커밋 `chore(release): v0.15.1 — screen review fixes, manual images — 화면 검토 반영·설명서 그림`. `dev`에 합칠 때 `PROGRESS.md`의 이 브랜치 항목을 한 항목으로 줄인다.

## 이 계획에 없는 것

- 검토에서 찍지 못한 것: Assign의 372 Unit 문서와 14열 표 문서, 역할 편집 창. Task 6·11의 감사 항목이 이 장면을 처음 연다. 거기서 새 문제가 나오면 고치지 말고 적어 둔다.
- 운영 상단 바(Keycloak 로그인 상태)는 로컬에서 볼 수 없다.
