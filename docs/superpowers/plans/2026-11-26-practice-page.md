# 연습 페이지 — 구현 계획

> **For agentic workers:** 실행은 `superpowers:subagent-driven-development`이되 **검토는 스텝 브랜치 끝에 한 번**(`CLAUDE.md` "일 크기에 맞는 절차"가 먼저다). 하위 에이전트는 서버 · 브라우저를 띄우지 않는다 — 고친 파일의 단위 시험 · lint · tsc까지. 스모크는 메인 세션이 스텝 끝에 고친 화면만.

**Goal:** `/practice`에서 실제 Assign 부품으로 과제 12개를 따라 하고, 요청은 브라우저 안 가짜 서버가 받아 서버에는 아무것도 가지 않는다.

**Spec:** [`../specs/2026-11-26-practice-page-design.md`](../specs/2026-11-26-practice-page-design.md) — 사용자 결정 U1~U5, 설계 결정 D1~D24. 이 계획의 스텝 번호와 설계의 절 번호는 다르다.

**자리:** 쪼개기 먼저 장부의 남은 두 브랜치 다음, 정식 업데이트 준비 앞(장부 "9 연습 페이지").

## 브랜치 길 — 모음 브랜치(D23)

자료만(스텝 1) · 가짜 서버만(스텝 2) · 과제 없는 빈 화면(스텝 3)은 혼자 `dev`에 올라가면 반쪽이라 **모음 브랜치 `feat/practice-page`**에서 스텝 브랜치를 딴다.

- 모음 브랜치는 이 설계 커밋에서 시작한다(워크트리 `/Users/hyeonjin/Documents/sop-wt-practice-page`).
- 스텝 브랜치 `feat/practice-page-<n>-<이름>`은 모음 브랜치의 지금 끝에서 따고, 그 스텝의 diff만 검토해 모음 브랜치에 `--no-ff`로 합친다. 스텝마다 새 워크트리(`scripts/dev-worktree.sh new feat/practice-page-<n>-<이름>` — 기준이 `dev`가 아니라 모음 브랜치이므로 만든 뒤 `git reset --hard feat/practice-page` 또는 `git worktree add -b … feat/practice-page`로 뿌리를 맞춘다).
- 모음 브랜치를 `dev`에 합칠 때는 전체를 다시 검토하지 않고, `dev`를 합친 뒤의 시험과 스모크만(아래 "dev에 합치기").
- 차례: 1 → 2 → 3 → 4(앞 스텝이 모음 브랜치에 합쳐진 뒤 다음을 딴다). 1과 2의 프런트 순수 부분은 자료 꼴(`PracticeFixture` 타입)만 맞추면 나란히 할 수 있다 — 2가 1의 자료를 먼저 손으로 줄인 시험 자료로 시작하고, 1이 합쳐지면 진짜 자료로 시험을 돌린다.

## Global Constraints

- 서버 · DB에 쓰지 않는다. Alembic · 새 env · 새 권한 없음.
- 실제 Assign 변경은 `use-assign-page.tsx`의 `useParams` 한 줄(D12)뿐. 그 밖의 Assign 파일을 고쳐야 하면 세우고 보고한다.
- 새 `useEffect` · 타이머 없음 — `frontend/effect-baseline.json`을 늘리지 않는다(늘려야 하면 세우고 보고).
- 한 길 규칙: 이동은 `navigate()`, 툴팁은 `Tooltip`, raw hex 없음, 창은 `Modal` 크기. 과제 칸 · 띠는 기존 토큰만(파스텔 채움 금지, 한쪽 막대는 막대 쪽 모서리 직각).
- 새 문구는 en · ko 한 쌍(`i18n-messages.test.ts`), 인터랙티브 요소는 `data-testid`.
- 화면 · 동작 · 문구를 바꾸면 같은 커밋에서 `frontend/public/manual/user-manual.md`의 글(그림은 정식 업데이트 때), `docs/qa/feature-map.md`의 줄, 구조를 바꾸면 `docs/architecture/frontend.md` · `frontend/CLAUDE.md`를 함께.
- 공개 저장소: 연습 자료는 설명서 글로 지은 합성, 파일 이름 `SYNTHETIC_`. 실명 · 실서버 주소 없음.
- 스모크 기대값을 낮추거나 단계를 빼지 않는다.
- 커밋 · 푸시는 GitHub `origin`에만. 스텝 브랜치는 푸시하지 않아도 된다(모음 브랜치에 합친 뒤 지운다). `dev` 합치기 · 버전 · CHANGELOG · PROGRESS는 메인 세션이 "dev에 합치기"에서.
- 커밋 메시지 `type(scope): English — 한국어`, 끝에 그 세션의 attribution 줄.

## 공용 계약 — 스텝끼리 함께 쓰는 이름

| 이름 | 자리 | 뜻 | 만드는 스텝 |
|---|---|---|---|
| `practice-fixture.json` · `PracticeFixture` | `frontend/src/lib/practice/` | 백엔드가 뽑은 연습 자료와 그 타입(설계 §4.1-7) | 1(JSON) · 2(타입) |
| `render_practice_fixture()` · `OUT` | `backend/scripts/dump_practice_fixture.py` | 자료 짓기, 신선도 시험이 부른다 | 1 |
| `PRACTICE_PATH` · `PRACTICE_BUNDLE_ID = -1` · `REAL_ON_PRACTICE` · `isPracticeRequest(path, pathname)` | `frontend/src/lib/practice-route.ts` | 연습 요청 판정(D2 · D3) | 2 |
| `handlePracticeRequest(method, path, body): Promise<Response>` | `frontend/src/lib/practice/practice-server.ts` | `api.ts`가 동적 import로 부른다(D1) | 2 |
| `notePracticeAct(act)` · `subscribePractice` · `readPracticeSnapshot` · `PracticeLogEntry` | 같은 파일 | 손짓 적기(D9) · 과제 칸이 읽는 상태 | 2 |
| `BundleIdContext` · `useRouteBundleId()` | `frontend/src/lib/use-route-bundle-id.ts` | Assign의 Bundle id(D12) | 3 |
| `PRACTICE_TASKS` · `listAchieved(log)` · `pickOpenTask(log, picked)` | `frontend/src/lib/practice/practice-tasks.ts` | 과제 표 · 판정 · 펼칠 과제(설계 §7, D10) | 4 |
| testid `practice-band` · `practice-start-over` · `practice-tasks` · `practice-tasks-fold` · `practice-progress` · `practice-task-<id>`(`data-done` · `data-open`) · `practice-task-manual` · `user-menu-practice` · `manual-practice` | 화면 | 스모크 · 그림 장면 | 3 · 4 |
| 거절 코드 `practice_unsupported` → `rule.practice_unsupported` | 가짜 서버 · i18n | 연습에서 안 되는 것(D5) | 2 |

## 스텝

### 스텝 1 — `feat/practice-page-1-fixture`

- **한 문장 목표:** 백엔드가 설명서 글로 지은 합성 Old · New 문서를 올려 연습 자료 JSON을 뽑고, 자료가 낡으면 CI가 알린다.
- **모델:** 구현 **opus**(합성 문서가 규칙 2로 의도한 자리 — 두 문장 박스 · 끊긴 두 조각 · 이웃 짝 · 목차 블록 · 표 · 후보 첫째 — 를 내게 맞추는 판단), 검토 **sonnet**.
- **고칠 파일:**
  - 새 `backend/scripts/dump_practice_fixture.py` — 설계 §4.1의 1~7. 문서 글은 `frontend/public/manual/user-manual.md`에서 고른 합성 문장(§4.2 · §4.3 표). `seed_sop_demo` · 테스트 팩토리(`build_docx` · `p` · `make_style` · `upload`)를 다시 쓴다.
  - 새 `backend/tests/test_practice_fixture.py`.
  - 새 `frontend/src/lib/practice/practice-fixture.json`(생성물).
  - `backend/CLAUDE.md` — "연습 자료" 한 줄(무엇 · 다시 뽑는 명령 · 신선도 시험).
  - `docs/qa/verification-commands.md` — 다시 뽑는 명령 한 줄(bash · PowerShell 병기).
- **시험(실패 → 통과):**
  - `test_practice_fixture_is_current` — 파일이 없을 때 실패, 뽑은 뒤 통과. 다른 시험이 쓰는 DB와 섞이지 않게 제 임시 sqlite로 짓는다(`-n auto`에서도 같은 바이트).
  - `test_practice_fixture_spots` — §4.1 끝의 자리 검사(두 문장 박스 · 끊긴 두 조각 · 이웃 확정 짝 D · `noise_kind == "toc"` 줄 · 벗기기 전 표 Unit 하나 · `tableVariants` 두 모습 · 짝 B 후보 첫째가 B′ · 판단과 이음 0 · 문서 id ≥ 900001 · `bundle.id == -1` · 실명 없음).
- **게이트:** `.venv/bin/python -m pytest tests/test_practice_fixture.py -q` → 전체 `pytest tests/ -q -n auto` · `ruff check app/ tests/ scripts/`. 화면 변경 없음 — 스모크 없음.
- **크기:** 파이썬 약 300줄 + 시험 80줄 + 생성 JSON(40~80KB 예상, 100KB를 넘으면 문서를 줄인다).

### 스텝 2 — `feat/practice-page-2-fake-server`

- **한 문장 목표:** `apiFetch`가 연습 요청을 브라우저 안 가짜 서버로 보내고(실제 서버로는 하나도 안 감), 가짜 서버가 과제에 쓰는 25경로를 답한다.
- **모델:** 구현 **opus**(Assign이 읽는 응답 꼴을 상태에서 짓기 · 사진 되돌리기 · 새는 길 막기), 검토 **opus**(새는 요청 0이 이 스텝에서 정해진다).
- **고칠 파일:**
  - 새 `frontend/src/lib/practice-route.ts`(+ `.test.ts`) — D2 · D3.
  - `frontend/src/lib/api.ts` `sendRequest` — D1 한 갈래(+ `api.test.ts`에 시험).
  - 새 `frontend/src/lib/practice/practice-state.ts`(순수, + `.test.ts`) — 설계 §6.2 · §6.3, `PracticeFixture` 타입.
  - 새 `frontend/src/lib/practice/practice-server.ts`(+ `.test.ts`) — 길잡이 · 응답 · 구독 · `notePracticeAct`.
  - `frontend/src/lib/nav-buffer.ts` — D13 `/bundles/-1/…` 이동 막기(+ 시험).
  - `frontend/src/source-rules.test.ts` — 규칙 "raw fetch to the API"(설계 §6.4-2).
  - `frontend/src/lib/i18n-messages.ts` — `rule.practice_unsupported` · `practice.notHere` en · ko.
  - `docs/architecture/frontend.md` 새 절 17(가짜 서버 부분) · `frontend/CLAUDE.md` 핵심 구조 한 줄.
- **시험(실패 → 통과):**
  - `practice-route.test.ts`: `/bundles/-1/groups/save`는 어느 주소에서든 참, `/practice`에서 `/me` · `/ai/jobs/recent`는 거짓 · `/sop/remarks/recent`는 참, `/bundles/5/assign` 주소에서 `/bundles/5/units`는 거짓, `NODE_ENV=production`에서도 같다, 이 모듈과 `practice/`가 `lib/drafting`을 가져오지 않는다.
  - `practice-state.test.ts`: 처음 상태에서 지은 `units` · `written` · 각 `view`가 자료의 실제 응답과 같다. 쓰기 표(§6.3)의 줄마다 반영 · 응답 꼴. `merge` → `unmerge`가 옛 id를 되살린다. `set_layout_table`이 두 모습 사이를 오간다. 같은 `step_key` 두 요청이 되돌리기 한 칸. 되돌려도 `log`는 줄지 않는다.
  - `practice-server.test.ts`: 전역 `fetch` 스파이 + `api-sop.ts`의 실제 함수로 설계 §6.4-3의 과제 순서를 부르고 `fetch` 0번. 모르는 경로 · 편집 종류는 `ApiError` 422 · `rule.code === "practice_unsupported"`. 과제 판정에 쓰는 `log` 항목(`route` · `editType` · `undoOp` · `action`)이 남는다.
  - `api.test.ts`: `/practice`일 때 `/me`는 `fetch`로, 그 밖은 가짜로.
  - `source-rules.test.ts`: 새 규칙이 `fetch(`를 다른 파일에 넣은 견본에서 실패한다(규칙 견본 시험에 한 줄).
  - `nav-buffer` 시험: `/bundles/-1/documents`로의 `navigate`가 이동하지 않고 알림을 부른다.
- **게이트:** 고친 시험 파일 → `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run` → `npm run build` 경고 0. 화면은 아직 없음 — 스모크 없음(API 층을 고쳤으므로 모음 브랜치를 `dev`에 합칠 때 `FULL=1`).
- **크기:** 코드 약 700~900줄 + 시험 약 500줄. 1,000줄을 넘으면 `practice-state.ts`(읽기 짓기)와 쓰기 연산을 한 브랜치 안 커밋 둘로 나눈다(한 단위라 브랜치는 하나).

### 스텝 3 — `feat/practice-page-3-screen`

- **한 문장 목표:** `/practice`가 띠와 실제 Assign(연습 Bundle)을 그리고, 사용자 메뉴 · 설명서 머리 두 곳에서 들어간다.
- **모델:** 구현 **sonnet**(설계에 자리 · 이름이 다 적힌 화면 짜기), 검토 **opus**(Assign 한 줄 변경 · 진입 두 곳만 · 높이 배치).
- **고칠 파일:**
  - 새 `frontend/src/lib/use-route-bundle-id.ts`(+ 시험) · `app/bundles/[id]/assign/use-assign-page.tsx` 한 줄(D12).
  - 새 `frontend/src/app/practice/page.tsx` — 띠(`practice-band` · `practice-start-over`) + grid(Assign | 과제 칸 자리, 과제 칸은 이 스텝에서 머리 · 접기만 — 목록은 스텝 4).
  - 새 `frontend/src/components/practice/practice-band.tsx` · `practice-frame.tsx`(grid · 접기 `useState`).
  - `frontend/src/styles/components.css` 끝 — `.practice-*` 새 선택자만.
  - `frontend/src/components/user-menu.tsx` — `user-menu-practice`(D15 ①, `/practice`에서는 빠짐).
  - `frontend/src/components/manual/manual-view.tsx` — `manual-practice`(D15 ②).
  - `frontend/src/lib/manual.ts` — `MANUAL_PAGE_SECTION.practice`, `getManualHref("/practice")`.
  - `frontend/src/lib/i18n-messages.ts` — `nav.practice` · `manual.practice` · `practice.band` · `practice.bandHint` · `practice.startOver` · `practice.tasks` 머리 · 접기 en · ko.
  - `frontend/public/manual/user-manual.md` — `## 연습 화면 {#practice}`(설계 §9의 글, 과제 칸은 "오른쪽 과제 칸" 한 문단만 — 과제 목록 글은 스텝 4).
  - `docs/qa/feature-map.md` 줄 · `docs/architecture/frontend.md` 17절(화면 부분).
  - 새 `frontend/scripts/smoke/practice.mjs` · `pw-smoke-sop.mjs`에 `runPractice()`.
- **시험(실패 → 통과):**
  - `use-route-bundle-id.test.ts`: 맥락 값이 있으면 그것, 없으면 `useParams().id`의 숫자.
  - `manual-content.test.ts`(있는 시험이 새 조각 · 굵은 영어 · 도움말이 여는 조각을 본다)와 `manual.test.ts`의 `getManualHref("/practice") === "/manual#practice"`.
  - `i18n-messages.test.ts`(키 짝).
  - 연습 화면 파일이 `isDraftingOn` · `useDraftingOn`을 가져오지 않는다(스텝 2의 시험을 `app/practice/` · `components/practice/`로 넓힌다).
- **스모크 단계(메인 세션, `QUIET=1 ONLY="practice:" node scripts/pw-smoke-sop.mjs`):** `practice: entry and band`(과제 줄 검사는 스텝 4에서 더한다 — 이 스텝은 띠 · 진입 두 곳 · 도움말 주소 · 접기), `practice: nothing reaches the backend`(Assign을 띄우고 줄 하나를 눌러 고르기 · 새로 읽기 동안), `practice: reload starts over`(⇧H로 보류 → **Start over** → 미배정). Assign 한 줄을 고쳤으므로 `ONLY="assign:"`도 한 번.
- **게이트:** lint · tsc · vitest · `npm run build` 경고 0 + 빌드 라우트 목록에 `/practice`. 스모크 위 둘.
- **크기:** 약 400~500줄 + 시험 · 문서.

### 스텝 4 — `feat/practice-page-4-tasks`

- **한 문장 목표:** 오른쪽 과제 칸에 과제 12개가 늘 보이고, 손짓을 하면 화면이 알아채 ✓하고 다음 과제를 펼친다.
- **모델:** 구현 **opus**(D22 두 손짓의 실제 본문 고정 · D9 손짓 적기 · 설명서 `###` 자리 열기 확인), 검토 **sonnet**.
- **고칠 파일:**
  - 새 `frontend/src/lib/practice/practice-tasks.ts`(+ `.test.ts`) — 설계 §7 표, `listAchieved` · `pickOpenTask`.
  - 새 `frontend/src/components/practice/practice-tasks.tsx` — 과제 칸 목록(`useSyncExternalStore`), 펼친 줄의 글쇠(`formatAssignKey`) · `practice-task-manual`.
  - `frontend/src/components/practice/practice-frame.tsx` — 틀의 `onKeyDownCapture`(`findAssignKey` → `move_next` · `move_prev`) · `onClickCapture`(키보드 그림 여는 단추) → `notePracticeAct`.
  - `frontend/src/lib/i18n-messages.ts` — `practice.task.<id>.title` · `.body` 12쌍 · 진행 · 다 했을 때 한 줄 en · ko.
  - `frontend/public/manual/user-manual.md` — `## 연습 화면`에 과제 칸 글(자동 ✓ · 끝나면 다음 · 순서 자유 · 과제 열둘 이름).
  - `frontend/src/components/manual/manual-view.tsx` — `openTarget`이 `###` 자리 이름을 못 열 때만 넓힌다(이펙트 수 그대로).
  - `frontend/scripts/smoke/practice.mjs` — 단계 더하기.
  - `docs/qa/feature-map.md` 줄의 과제 부분 · `docs/architecture/frontend.md` 17절(과제 부분).
- **시험(실패 → 통과):**
  - `practice-tasks.test.ts`: 과제 12개 · id 겹침 없음. `keys`가 `ASSIGN_KEYS`에 있고 `formatAssignKey` 글쇠가 U3의 글쇠와 같다(D19). 앵커마다 `user-manual.md`에 `{#anchor}`. 기록 견본마다 `listAchieved`가 맞는 과제를 낸다(되돌린 뒤에도 남는다). `pickOpenTask`: 고른 과제가 미완료면 그것, 그 과제를 이루면 첫 미완료, 다 끝나면 null.
  - `practice-server.test.ts`에 더하기: 잇기 · 확정 손짓이 Assign의 실제 명령 길(`link-save-model` `buildLinkSave` · `primary-model` 카드 확정)로 지은 본문을 가짜 서버에 보냈을 때 `log`의 `undoOp`이 `"link"` · `"confirm"`로 갈린다(D22 — 다르면 판정을 실제 본문에 맞추고 설계 D22를 같은 커밋에서 고친다).
- **스모크 단계:** `practice: entry and band`에 과제 칸 검사(12줄 · `0/12` · 첫 과제 펼침 · 설명서 링크), `practice: follow tasks`(설계 §10), `practice: unsupported says so`, `practice: nothing reaches the backend`를 follow 단계까지 넓힌다.
- **게이트:** lint · tsc · vitest · `npm run build` 경고 0, `QUIET=1 ONLY="practice:"`.
- **크기:** 약 400~600줄 + 시험 · 문구.

### 정식 업데이트 준비 때 — 설명서 그림 장면(브랜치 아님)

- **누가 · 모델:** 메인 세션이 정식 업데이트 준비 커밋에서, 또는 **sonnet** 하위 에이전트(서버 · 브라우저를 띄우는 일이라 메인 세션 권장).
- 설계 §11의 장면을 `frontend/scripts/pw-manual-shots.mjs` `SCENES`에 더하고 `MANUAL=app ONLY=practice node scripts/pw-manual-shots.mjs` → `img/practice.png` + `## 연습 화면`의 그림 줄. `manual-content.test.ts` 통과.

## dev에 합치기(모음 브랜치 → `dev`, 메인 세션)

1. `git fetch` → 모음 브랜치에 `dev`를 합친다.
2. backend `pytest tests/ -q -n auto` · `ruff check app/ tests/ scripts/`, frontend `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run` · `npm run build` 경고 0.
3. 스모크: API 층(`api.ts`)과 Assign 한 줄을 고쳤으므로 **`FULL=1`**(CLAUDE.md "공용 부품 · API 층을 고쳤을 때"). 실패는 `reset` → `ONLY_FAILED=1`.
4. `dev`에 `--no-ff`. 앱 동작이 바뀌었으니 `npm version patch`(이미 1.6.x 줄), `CHANGELOG.md` `Unreleased (dev)` 한 줄, `PROGRESS.md`는 모음 브랜치 요약 하나, 쪼개기 먼저 장부의 "9 연습 페이지" 줄.
5. 푸시는 `origin`에만. 워크트리 · 스텝 브랜치 · 모음 브랜치를 로컬 · 원격에서 지운다.

## 스텝 표

| # | 브랜치 | 구현 | 검토 | 한 문장 |
|---|---|---|---|---|
| 1 | `feat/practice-page-1-fixture` | opus | sonnet | 백엔드가 합성 Old · New를 올려 연습 자료 JSON을 뽑고, 낡으면 CI가 알린다 |
| 2 | `feat/practice-page-2-fake-server` | opus | opus | `apiFetch`가 연습 요청을 브라우저 안 가짜 서버(25경로)로 보내고 실제 서버로는 하나도 안 간다 |
| 3 | `feat/practice-page-3-screen` | sonnet | opus | `/practice`가 띠와 실제 Assign을 그리고, 사용자 메뉴 · 설명서 머리 두 곳에서 들어간다 |
| 4 | `feat/practice-page-4-tasks` | opus | sonnet | 오른쪽 과제 칸 12개가 손짓을 알아채 ✓하고 다음을 펼친다 |
| – | (정식 업데이트 준비) | 메인 / sonnet | – | 설명서 그림 장면 `practice` |

## 멈추고 사람을 기다리는 때

- 실제 Assign을 `useParams` 한 줄보다 더 고쳐야 한다.
- `effect-baseline.json`을 늘려야 한다.
- 설계의 해석 셋(D15 진입 자리 · D20 "빈 New" · D21 "목차 삭제")이 화면에서 어색하다 — 바꾸지 말고 세운 뒤 묻는다.
- 연습 자료가 100KB를 넘거나, 규칙 2로 설계 §4.2의 자리가 나오지 않는다.
