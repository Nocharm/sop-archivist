# 끌기 층 + Order 끌기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order 화면에서 줄(같은 의미의 이웃 줄과 그 아래 더 깊은 줄까지)을 끌어 같은 칸 안의 순서와 깊이를 바꾸고, 줄 끝 단추 묶음은 호버·포커스 때만 글 밖에 뜨게 하며, 그 끌기를 뒤 걸음(Assign 잇기·보내기, Pair view)이 그대로 쓸 공통 끌기 층 위에 만든다.

**Architecture:** 세 층이다. (1) `lib/box-drag.ts` — React를 모르는 포인터 끌기 엔진. 문턱·가드·Alt 글자 긁기·표 한 장·자동 스크롤·Esc·클릭 삼키기·끌기 중 표시를 갖고, Order를 모른다(쓰는 쪽이 `pick`·`onMove`·`onDrop`을 준다). (2) 순수 모델 — `lib/c-drop-model.ts`(덩어리·놓을 자리·깊이)와 `lib/c-edit-model.ts`의 새 편집 `place`. (3) `components/outputs/output-c.tsx` — 프레임마다 DOM만 읽고 쓰고(선 하나, 속성 몇 개), 놓는 순간 `place` 편집 하나를 지금의 낙관적 초안과 저장 줄(`c-save-queue`)에 얹는다. 서버·새 의존성 변경 없음.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind 4 · vitest(jsdom) · Playwright(`playwright-core` + 시스템 Chrome).

**Spec:** [`docs/superpowers/specs/2026-11-16-drag-and-drop-design.md`](../specs/2026-11-16-drag-and-drop-design.md) — 이 계획은 §10의 **1걸음(끌기 층 + Order)** 만 다룬다(§4 G1~G13, §5, §9의 해당 줄). 2~4걸음(Assign 잇기·보내기, Pair view)은 범위 밖이다. 실행하는 사람은 명세와 함께 읽는다. 아래 "§N"은 그 문서의 절이다.

## Global Constraints

끌기 규칙(§4, 값은 명세 그대로):

- **G1** 왼쪽 단추로 누른 채 4px(`Math.hypot` ≥ 4 — 시안과 같다) 움직이면 끌기, 그 전에 떼면 지금의 클릭. Ctrl을 누른 누름(macOS 우클릭)과 Alt를 누른 누름은 끌기를 시작하지 않는다.
- **G2** `pointerdown`에서 `preventDefault`를 부르지 않는다. 글자 긁힘은 끌리는 상자의 `user-select: none`과 누르는 동안의 `selectstart`·`dragstart` 막기로 막는다.
- **G3** Alt를 누르는 동안 끌리는 상자가 `user-select: text`·글자 커서가 된다. 긁어 둔 글자가 있으면 Alt를 떼도 그대로, 선택이 비면 원래대로.
- **G4** 상자 안의 `button, a, input, select, textarea, [role='slider']`에서 누른 것은 끌기가 아니다. 이 계획은 여기에 `[data-no-drag]`(쓰는 쪽이 붙이는 예외 표시)를 더한다.
- **G5** 끌기가 끝나면(놓기·취소 둘 다) 뒤따르는 `click` 한 번을 capture로 삼킨다(`components/assign/new-pane.tsx:217-223`의 패턴).
- **G6** 끌려가는 것은 작은 표 한 장 — ID, 글 한 줄 말줄임, 여러 줄이면 개수, 놓으면 어디로 가는지. 원래 자리는 흐리게(불투명도 .45) 남는다.
- **G7** 놓을 수 있는 자리는 진한 테두리, 못 놓는 자리는 끊긴 테두리와 **이유**를 표에 적는다. 화면이 먼저 막고 서버 검사는 그대로 둔다.
- **G8** Esc로 취소. 놓을 자리 밖에 놓으면 아무 일도 없다. 스크롤 칸 위아래 가장자리(44px 안)에서는 스스로 스크롤한다(프레임마다 9px — 시안 값).
- **G9** 올리면 상자가 살짝 들린다(그림자와 테두리). 커서는 화살표 그대로.
- **G10** 끄는 동안 다른 호버 효과(툴팁, 줄 끝 단추, 줄 호버)를 모두 끈다. 표시 하나 — `<html data-box-drag>` — 를 CSS와 JS(`isBoxDragActive()`)가 같이 본다.
- **G11** 끄는 동안 React 상태를 프레임마다 바꾸지 않는다. 놓을 자리 표시는 DOM 속성·인라인 스타일로만 한다.
- **G12** 같은 일을 하는 단추와 글쇠가 남는다. Move·Indent 단추와 Tab·Shift+Tab은 뜻이 바뀌지 않고 한 줄씩 움직인다.
- **G13** 읽기 전용(검토자, `in_review`·`done`)에서는 끌기가 시작되지 않는다 — 지금 편집 단추가 꺼지는 조건(`outputs-workspace.tsx:174` `canEditC`)과 같다.

Order(§5): 깊이는 좌우 **24px마다 한 단**, 0부터 "앞 번호 줄 깊이 + 1"(상한 `MAX_INDENT_LEVEL` = 9)까지. AI 번역 줄(`origin === "translation"`)이나 이미 쓴 문서(`entrance === "match"`)의 줄이 하나라도 든 덩어리는 위아래로만 움직인다(`canChangeDepth`). 같은 칸(`location_key`) 안에서만 놓인다. 터치(`pointerType`이 `mouse`가 아님)는 끌지 않고, `(hover: none)`에서는 줄 끝 단추가 지금처럼 늘 보인다.

프로젝트 규칙:

- 새 npm 의존성 금지. 화면 규칙은 순수 모델(`lib/*.ts` + vitest)에 두고 부품은 얇게. 함수 이름은 동사로 시작, 파일 머리에 한 줄 설명, 주석은 "왜"만.
- raw hex 금지 — 토큰만(`--accent`, `--raised`, `--shadow-1`·`--shadow-2`, `--ink-4`, `--line-2`, `--hover`, `--dur-fast`, `--r-1`·`--r-2`). 새 CSS 클래스 이름이 Tailwind 유틸리티와 겹치지 않게(`docs/lessons/react-ts-patterns.md` §10). 한쪽 막대 강조는 막대 쪽 모서리를 직각으로.
- 문구는 `en`·`ko` 한 쌍(`i18n-messages.test.ts`), 조작 요소에는 `data-testid`(`surface-role`). 표에 넣는 글은 `textContent`로만(`innerHTML` 금지).
- 화면·동작·라벨을 바꾸는 커밋은 `frontend/public/manual/user-manual.md`의 글도 같은 커밋에서 고친다(그림은 뽑지 않는다). 설명서의 굵은 영어 글자는 en 문구와 같아야 한다(`manual-content.test.ts`).
- 프런트를 고치기 전에 `frontend/CLAUDE.md`, `docs/lessons/react-ts-patterns.md`(특히 §6·§7·§10), `docs/lessons/browser-verification.md`, `docs/lessons/ui-review.md`를 읽는다.
- 커밋 메시지 `type(scope): English summary — 한국어 요약`, 커밋마다 `PROGRESS.md` 한 항목을 같은 커밋에. `git add <파일>`로 골라 담는다(`git add .` 금지). Task 1에만 명령 전체를 적고 나머지는 메시지만 적었다. 푸시는 사용자가 말할 때 GitHub `origin`에만.
- 서비스 버전(PATCH)과 `CHANGELOG.md`는 이 브랜치를 `dev`에 올릴 때 한 번 올린다(Task 7에 문안). 그 전 커밋에서는 건드리지 않는다.
- 커밋 전 게이트(`frontend/`): `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`. `npm run build`는 경고 0(먼저 `next dev`를 내린다).

**시작 전에(워크트리에 한 번)** — 워크트리 `sop-archivist-dnd`(브랜치 `feat/drag-and-drop`)에는 `node_modules`와 `backend/.venv`가 없다. backend는 원본 체크아웃의 venv(`<원본>/backend/.venv/bin`, 아래 `$VENV`)로 돌린다. PowerShell 표기는 `docs/qa/verification-commands.md`의 같은 줄을 따른다.

```bash
cd frontend && npm ci && npm i --no-save playwright-core
npx vitest run src/lib/c-edit-model.test.ts src/lib/target-order.test.ts src/lib/section-number.test.ts   # 손대기 전 초록
```

- [ ] 명세·이 계획·인덱스를 먼저 커밋한다. `docs/README.md`에는 명세 줄(이미 작업 폴더에 있다) 아래 이 계획 줄을 더한다. `PROGRESS.md`에 한 항목.

```bash
git add docs/superpowers/specs/2026-11-16-drag-and-drop-design.md docs/superpowers/plans/2026-11-16-drag-layer-order-plan.md docs/README.md PROGRESS.md
git commit -m "docs(dnd): add the drag-and-drop design and the step 1 plan — 끌어다 놓기 설계와 1걸음 계획"
```

**브라우저 검증 스택(스모크를 돌리는 Task마다)** — 원본 체크아웃의 `dev.db`·3777/8777과 섞이지 않게 sqlite 파일과 포트를 따로 쓴다(dev DB 오염 함정, `browser-verification.md` 함정 1·2·9). Order 장면은 DB를 바꾼다 — "저장 안 됨" 같은 거짓 실패가 나면 backend를 **내린 뒤** `reset_db → seed_sop_demo`를 다시 하고 띄운다(실행 중인 DB 파일은 바꾸지 않는다).

```bash
# backend/ 에서 (시드는 DEV_ENFORCE_PERMISSIONS 없이)
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev $VENV/python -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev $VENV/python -m scripts.seed_sop_demo
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $VENV/uvicorn app.main:app --port 8787
# frontend/ 에서 (npm run dev는 3777을 박아 둔다)
BACKEND_URL=http://localhost:8787 npx next dev -p 3787
QUIET=1 ONLY="order:" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs   # 마지막 줄에 실패 0
```

## Review Focus

명세가 뜻하지만 조각 시험만으로는 빠지기 쉬운 것. 줄마다 시험을 맡은 Task를 적었다.

1. **단추 바로 옆(줄 끝 단추 묶음의 틈·여백)을 누르고 손이 조금 움직임** — 단추를 누르려던 것이므로 줄이 끌리면 안 된다. → Task 1 `does not start from a guarded child or inside [data-no-drag]`, Task 6 스모크 "a press on the action group padding does not drag"
2. **끄는 중에 Esc** — 끌기만 취소된다. 고른 줄의 포커스가 풀리거나(줄의 Esc = blur) 다른 Esc 동작이 같이 일어나지 않고, 뒤따르는 클릭이 아무것도 누르지 않는다. → Task 1 `Escape cancels the drag and reaches no other listener`, Task 6 스모크 "Esc cancels"
3. **Windows Chrome에서 Alt로 글자를 긁고 Alt를 뗌** — 브라우저 메뉴로 포커스가 넘어가 다음 글쇠를 먹으면 안 된다(검증 PC가 Windows다). → Task 1 `prevents the Alt keyup only after a press on a drag box`, Task 7의 Windows 수동 확인(자동화 불가 — 사용자 확인으로 남긴다)
4. **앞선 저장이 날아가는 동안 끌어 놓음** — 응답으로 받은 서버 문서 위에 그 놓기가 다시 얹히고, 그 사이 덩어리의 줄이 사라졌으면 조용히 깨지지 않고 버려진다. → Task 2 `re-applies a place made after sending and drops it when a block line is gone`
5. **긴 칸을 아직 다 그리지 않았을 때(이어 그리기) 끌기** — 덩어리는 그리지 않은 더 깊은 줄까지 함께 가고, 그려진 마지막 줄 아래에 놓으면 칸의 끝이 아니라 그 바로 다음 자리에 들어간다. → Task 3 `drops below the last rendered row before the first unrendered one`

---

## File Structure

| 파일 | 맡는 일 |
|---|---|
| `frontend/src/lib/box-drag.ts` (새) | 공통 끌기 엔진 — G1~G8·G10·G11. 순수 판단 함수와 `attachBoxDrag`. Order를 모른다 |
| `frontend/src/lib/box-drag.test.ts` (새) | 엔진 시험(jsdom 이벤트) |
| `frontend/src/lib/use-box-drag.ts` (새) | 엔진을 ref에 붙이는 얇은 훅(`config`가 null이면 붙이지 않는다) |
| `frontend/src/styles/motion.css` | 끌기 공통 표현 — 표 한 장, 끌기 중·Alt 표시, 놓을 자리 테두리 |
| `frontend/src/components/ui/tooltip.tsx` · `delegated-tip.tsx` | 끄는 동안 툴팁을 띄우지 않는다(G10) |
| `frontend/src/lib/c-edit-model.ts` (+test) | 새 편집 `place`(덩어리를 한 자리로, 깊이까지)와 `previewEdit` |
| `frontend/src/lib/c-drop-model.ts` (+test, 새) | Order 놓기 규칙 — 덩어리, 놓을 칸 판정, 넣을 자리·깊이 → `PlaceEdit` |
| `frontend/src/lib/section-number.ts` | `MAX_INDENT_LEVEL`을 내보낸다(값 그대로 9) |
| `frontend/src/lib/target-order.ts` (+test) | `readMoveKey`(Alt+↑·↓) |
| `frontend/src/components/outputs/output-c.tsx` | 줄 끝 단추 묶음 마크업, 모든 고칠 줄의 포커스·글쇠, 끌기 배선(선·속성·FLIP·포커스) |
| `frontend/src/components/outputs/outputs-workspace.tsx` | `onPlace` 한 줄, 머리의 끌기 도움말 (i) |
| `frontend/src/styles/components.css` (`.c-row` 블록, 1632-1649행) | 줄 끝 단추 묶음 배치, 줄 들림, 넣을 자리 선, 다른 칸 흐리게 |
| `frontend/src/lib/i18n-messages.ts` | 새 문구 en·ko |
| `frontend/public/manual/user-manual.md` (`{#order}` 567-579행, `{#keys}` 867-875행) | 설명서 글 |
| `frontend/scripts/pw-smoke-sop.mjs` | Order 장면 셋(단추 묶음, 글쇠, 끌기) |
| `frontend/scripts/pw-overlap-audit.mjs` (160-196·322-342행) · `pw-layout-audit.mjs` (C8 300-345행, C13 1255-1260행) | 옛 배치(늘 흐리게, 줄 안)를 재던 감사를 새 배치로 |
| `docs/lessons/ui-review.md` (13번, 30행) · `frontend/docs/design/2026-11-07-frontend-design-foundations.md` (11절, 229행) | "줄 끝 단추는 늘 흐리게"의 예외 기록 |
| `frontend/CLAUDE.md` · `docs/README.md` · `PROGRESS.md` | 구조 한 줄, 인덱스, 진행 기록 |

이름 정리(§11이 구현에 맡긴 것 — 이 계획이 정했다): 끌리는 상자 `data-drag-box`, 끌기 중 `<html data-box-drag>`, Alt 글자 긁기 `<html data-box-select>`, 끌리는 원래 자리 `data-drag-src`, 놓을 상자 `data-drop="over" | "refused"`, 표 한 장 `.drag-card`(`data-testid="drag-card"`), Order의 출발 칸 `data-drag-home`, 넣을 자리 선 `.c-dropline`(`data-testid="output-c-dropline"`), 줄 끝 단추 묶음 `.c-acts`(`data-testid="output-c-acts-<target_id>"`), Order 용지 바깥 틀 `.c-order`.

### Task 1: 공통 끌기 엔진

**Files:**
- Create: `frontend/src/lib/box-drag.ts`, `frontend/src/lib/box-drag.test.ts`, `frontend/src/lib/use-box-drag.ts`
- Modify: `frontend/src/styles/motion.css`(끝의 `.flip-lead` 규칙 아래에 "끌기 공통 표현" 블록), `frontend/src/components/ui/tooltip.tsx:42`(`show`), `frontend/src/components/ui/delegated-tip.tsx:66`(`show`)

**Interfaces:**
- Consumes: 없음.
- Produces (`box-drag.ts`):

```ts
export const DRAG_THRESHOLD_PX = 4;
export const DRAG_GUARD_SELECTOR = "button, a, input, select, textarea, [role='slider'], [data-no-drag]";
export const EDGE_SCROLL_ZONE_PX = 44; // 가장자리에서 이 안이면 스크롤
export const EDGE_SCROLL_STEP_PX = 9;  // 프레임마다
export interface DragPoint { x: number; y: number }          // clientX·clientY
export interface DragCard { id: string; text: string; count: string | null }   // count는 이미 번역한 글("3 lines")
/** state "ok" = 놓을 수 있음, "refused" = 못 놓음(note가 이유), "none" = 놓을 자리 밖. target은 테두리를 그릴 상자(없어도 된다) */
export interface DragHover { state: "ok" | "refused" | "none"; note?: string; target?: HTMLElement | null }
export interface BoxDragConfig<S> {
  pick: (event: PointerEvent) => S | null;                    // 끌 것이 없거나 읽기 전용이면 null
  getCard: (source: S) => DragCard;
  getScrollers: () => readonly HTMLElement[];                 // 출발 칸과 다른 스크롤 칸도 넣을 수 있다 - 포인터가 든 칸만 민다
  onStart?: (source: S, start: DragPoint) => void;            // 문턱을 넘은 뒤 한 번
  onMove: (source: S, point: DragPoint, start: DragPoint) => DragHover;   // pointermove마다, 자동 스크롤로 밀린 뒤에도
  onDrop: (source: S, point: DragPoint, start: DragPoint) => void;        // 놓았을 때만(취소는 부르지 않는다)
  onEnd?: (source: S, cancelled: boolean) => void;            // 놓기·취소 뒤 한 번 - 표시 치우기
}
export function canStartDrag(press: Pick<PointerEvent, "button" | "altKey" | "ctrlKey" | "pointerType">, isGuarded: boolean): boolean;
export function hasPassedThreshold(dx: number, dy: number): boolean;
export function getEdgeScrollDir(point: DragPoint, frame: { left: number; right: number; top: number; bottom: number }): -1 | 0 | 1;
export function isBoxDragActive(): boolean;                   // <html data-box-drag>가 있나
export function findUnderPoint(point: DragPoint, selector: string): HTMLElement | null;   // elementFromPoint + closest
export function attachBoxDrag<S>(root: HTMLElement, config: BoxDragConfig<S>): () => void; // 돌려준 함수가 뗀다
```

- Produces (`use-box-drag.ts`): `export function useBoxDrag<S>(rootRef: RefObject<HTMLElement | null>, config: BoxDragConfig<S> | null): void;`

- [ ] **Step 1: 실패하는 시험을 쓴다** — `box-drag.test.ts`. 이벤트는 `new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, pointerType: "mouse", … })`로 만들어 `pointerdown`은 상자에, `pointermove`·`pointerup`·`keydown`·`click`은 `window`·`document.body`에 보낸다. 틀은 `root > div[data-drag-box] > (p, button, span[data-no-drag])`.

```ts
describe("drag decisions", () => {
  const press = { button: 0, altKey: false, ctrlKey: false, pointerType: "mouse" };
  it("canStartDrag: only a plain left mouse press outside guarded children", () => {
    expect(canStartDrag(press, false)).toBe(true);
    for (const bad of [{ button: 2 }, { ctrlKey: true }, { altKey: true }, { pointerType: "touch" }]) expect(canStartDrag({ ...press, ...bad }, false)).toBe(false);
    expect(canStartDrag(press, true)).toBe(false);
  });
  it("hasPassedThreshold: a drag from 4px of travel", () => {
    expect([hasPassedThreshold(3.9, 0), hasPassedThreshold(4, 0), hasPassedThreshold(3, 3)]).toEqual([false, true, true]);
  });
  it("getEdgeScrollDir: within 44px of the top or bottom edge, up to 24px outside, only inside the frame's width", () => {
    const dir = (x: number, y: number) => getEdgeScrollDir({ x, y }, { left: 0, right: 800, top: 100, bottom: 500 });
    expect([dir(10, 143), dir(10, 144), dir(10, 457), dir(10, 76), dir(10, 75), dir(900, 120)]).toEqual([-1, 0, 1, -1, 0, 0]);
  });
});
```

`describe("attachBoxDrag")` — 시험 이름과 단언(각각 `onDrop`·`onEnd`는 `vi.fn()`):

| 시험 이름 | 단언 |
|---|---|
| `a press released within 4px stays a click` | `pointerdown.defaultPrevented === false`; 3px 움직이고 뗀 뒤 `onDrop` 0번, `isBoxDragActive() === false`, `[data-testid="drag-card"]` 없음, 뒤따르는 `click`이 body 리스너에 1번 닿음 |
| `starts at 4px: flag, card and cleared selection` | 4px 뒤 `document.documentElement.hasAttribute("data-box-drag")`, 표의 글이 `getCard` 값(`id`·`text`·`count`)이고 `text: "<b>x</b>"`면 표 안에 `b` 요소가 없다(`textContent`), `onStart` 1번 |
| `blocks selectstart only while pressed` | 누른 동안 보낸 cancelable `selectstart`는 `defaultPrevented === true`, 뗀 뒤 보낸 것은 `false` |
| `does not start from a guarded child or inside [data-no-drag]` | `button`과 `span[data-no-drag]`에서 누르고 20px 움직여도 `isBoxDragActive() === false`, `pick` 0번 |
| `does not start when pick returns null` | 표시·표 없음 |
| `Escape cancels the drag and reaches no other listener` | 끄는 중 `keydown Escape` → `onDrop` 0번, `onEnd` `(source, true)`, 표시·표 없음, 상자에 건 `keydown` 리스너 0번, 뒤따르는 `pointerup`도 `onDrop`을 부르지 않음 |
| `drops, then swallows exactly one click` | `pointerup` → `onDrop` 1번 뒤 `onEnd(source, false)`; 바로 보낸 `click`은 body 리스너 0번, 타이머가 돈 뒤(`await` 0ms) 보낸 `click`은 1번 |
| `shows a refusal on the card and the target` | `onMove`가 `{ state: "refused", note: "why", target }` → 표에 `data-refused`와 글 "why", `target.dataset.drop === "refused"`; 다음 move가 `{ state: "ok", target }` → `"over"`, 표의 `data-refused` 없음; 끝나면 `data-drop` 없음 |
| `marks Alt select mode and keeps it while text is selected` | `keydown Alt` → `<html data-box-select>`; `keyup Alt`(선택 없음) → 없음; `window blur` → 없음. 붙인 것을 모두 떼면(`detach()`) 리스너도 떨어져 `keydown Alt`에 표시가 붙지 않는다 |
| `prevents the Alt keyup only after a press on a drag box` | Alt를 누른 채 상자에 `pointerdown` → 그 `keyup Alt`는 `defaultPrevented === true`; 누름 없이 Alt만 눌렀다 떼면 `false` |

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/lib/box-drag.test.ts` · Expected: FAIL(`box-drag` 모듈 없음).
- [ ] **Step 3: `box-drag.ts`를 쓴다.** 시그니처와 시험이 정하지 않는 것만 적는다:
  - `pointerdown`은 `root`에, 그 뒤 `pointermove`·`pointerup`·`pointercancel`(= 취소)은 `window`에, `keydown`·`selectstart`·`dragstart`는 `window` capture에 건다. Esc는 `preventDefault` + `stopPropagation`. 한 번에 하나만 끈다.
  - 시작할 때 `getSelection()?.removeAllRanges()`. 표는 `document.body`에 붙이고 `translate(x + 14px, y + 12px)`로 옮긴다. 자동 스크롤은 끄는 동안만 도는 `requestAnimationFrame` 고리가 `getScrollers()` 가운데 포인터가 든 칸을 밀고, 실제로 밀렸으면 `onMove`를 다시 부른다.
  - Alt 모드 리스너(`keydown`·`keyup`·`window blur`·`selectionchange`)는 붙은 root가 하나라도 있을 때만 건다(개수 세기). 표시는 "Alt가 눌렸거나 선택이 비지 않았다"일 때 붙는다.
- [ ] **Step 4: `use-box-drag.ts`를 쓴다.** 이펙트는 `config !== null`에만 반응하고, 콜백은 `useEffectEvent`로 감싸 렌더마다의 최신 클로저를 부른다(`react-ts-patterns.md` §7 — 다시 붙이지 않는다).
- [ ] **Step 5: CSS와 툴팁 가드.** `motion.css`에 아래 규칙을 더하고(값은 토큰), 두 툴팁의 `show` 첫 줄에 `if (isBoxDragActive()) return;`.

| 규칙 | 내용 |
|---|---|
| `@media (hover: hover) { [data-drag-box] }` | `user-select: none`(+`-webkit-`). 터치 기기에서는 걸지 않는다 — 끌지 못하는데 글자만 안 긁히면 안 된다 |
| `html[data-box-select] [data-drag-box]` | `user-select: text; cursor: text` |
| `html[data-box-drag]` · `html[data-box-drag] *` | `user-select: none` · `cursor: grabbing !important` |
| `[data-drag-src]` | `opacity: .45` |
| `[data-drop="over"]` · `[data-drop="refused"]` | `outline: 2px solid var(--accent)` · `outline: 2px dashed var(--ink-4)`, 둘 다 `outline-offset: -1px` |
| `.drag-card` | `position: fixed; left: 0; top: 0; z-index: 80`(지금 가장 높은 값 70 위), `pointer-events: none`, 한 줄 flex, `max-width: 300px`, `border: 1px solid var(--accent)`, `--raised` 바탕, `--shadow-2`, `--r-2`, UI 글꼴 12px. 글 칸은 `min-width: 0` 말줄임, ID는 mono·`--accent`, 개수는 작은 알약(`--accent` 바탕), 이유·갈 곳 칸은 왼쪽 가는 선 |
| `.drag-card[data-refused]` | `border: 1px dashed var(--ink-4)`, 글 `--ink-3` |

- [ ] **Step 6: 통과 확인** — Run: `npx vitest run src/lib/box-drag.test.ts && npm run lint && npx tsc --noEmit -p tsconfig.json` · Expected: 시험 PASS, 린트·타입 오류 0.
- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/box-drag.ts frontend/src/lib/box-drag.test.ts frontend/src/lib/use-box-drag.ts frontend/src/styles/motion.css frontend/src/components/ui/tooltip.tsx frontend/src/components/ui/delegated-tip.tsx PROGRESS.md
git commit -m "feat(drag): add the shared whole-box drag layer — 손잡이 없이 상자 전체를 끄는 공통 끌기 층"
```

### Task 2: `place` 편집 — 덩어리를 한 자리로

**Files:**
- Modify: `frontend/src/lib/c-edit-model.ts:7-10`(`CEdit`), `:64-81`(`applyEdit`)
- Test: `frontend/src/lib/c-edit-model.test.ts`

**Interfaces:**
- Consumes: 없음(지금 있는 `addEdit`·`sendDraft`·`acceptSaved`는 그대로).
- Produces:

```ts
/** 칸 안의 줄 묶음(targetIds, 이 순서로)을 beforeId 줄 앞(null이면 칸 끝)으로 옮긴다. depths가 있으면 targetIds와 같은 순서의 새 indent_level */
export type PlaceEdit = { kind: "place"; locationKey: string; targetIds: readonly number[]; beforeId: number | null; depths: readonly number[] | null };
export type CEdit = /* 지금의 셋 */ | PlaceEdit;
/** 편집 하나를 얹고 번호를 다시 센 문서 - 미리 보기용. 못 얹으면 null(지금의 applyEdit를 내보낸 것) */
export function previewEdit(doc: OutputCDoc, edit: CEdit): OutputCDoc | null;
```

`place`가 null을 돌려주는 때: 칸이 없다, `targetIds` 가운데 그 칸에 없는 줄이 있다, `beforeId`가 그 칸에 없거나 `targetIds` 안에 있다, 옮긴 뒤의 순서·깊이가 지금과 같다(제자리 — 저장을 줄에 넣지 않게).

- [ ] **Step 1: 실패하는 시험을 쓴다**(파일의 `line`·`section`·`doc`·`numbersOf` 도우미를 쓴다)

```ts
describe("addEdit place", () => {
  const start = startDraft(doc([section("5", [line(1, "5.1"), line(2, "5.2"), line(3, "5.3"), line(4, "5.4")])]));
  const place = (targetIds: number[], beforeId: number | null, depths: number[] | null = null) => ({ kind: "place" as const, locationKey: "s5", targetIds, beforeId, depths });

  it("moves a block before another line and renumbers", () => {
    expect(numbersOf(addEdit(start, place([3, 4], 1))!.shown)).toEqual([[[3, "5.1"], [4, "5.2"], [1, "5.3"], [2, "5.4"]]]);
  });
  it("moves to the end of the section when beforeId is null and sets the given depths", () => {
    expect(numbersOf(addEdit(start, place([1], null, [1]))!.shown)).toEqual([[[2, "5.1"], [3, "5.2"], [4, "5.3"], [1, "5.3.1"]]]);
  });
  it("returns null for a no-op, a missing line, a beforeId inside the block and another section", () => {
    expect(addEdit(start, place([2], 3))).toBeNull();
    expect(addEdit(start, place([9], 1))).toBeNull();
    expect(addEdit(start, place([1, 2], 2))).toBeNull();
    expect(addEdit(start, { ...place([1], null), locationKey: "s9" })).toBeNull();
  });
  it("sends the whole new order and only the depths that changed", () => {
    const { items } = sendDraft(addEdit(start, place([1], null, [1]))!);
    expect(items).toEqual([{ target_id: 2 }, { target_id: 3 }, { target_id: 4 }, { target_id: 1, indent_level: 1 }]);
  });
  it("re-applies a place made after sending and drops it when a block line is gone", () => {
    const { draft: sent } = sendDraft(addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!);
    const later = addEdit(sent, place([4], 2))!;
    const server = doc([section("5", [line(2, "5.1"), line(1, "5.2"), line(3, "5.3"), line(4, "5.4")])]);
    expect(numbersOf(acceptSaved(later, server).shown)).toEqual([[[4, "5.1"], [2, "5.2"], [1, "5.3"], [3, "5.4"]]]);
    const gone = doc([section("5", [line(2, "5.1"), line(1, "5.2"), line(3, "5.3")])]);
    expect(acceptSaved(later, gone).edits).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/lib/c-edit-model.test.ts` · Expected: 새 다섯 시험 FAIL(타입 오류 또는 null).
- [ ] **Step 3: `PlaceEdit`·`place` 분기·`previewEdit`를 쓴다.** `sendDraft`·`acceptSaved`·`rebaseDraft`는 고치지 않는다(전체 순서와 `saved`와 다른 깊이만 싣는 지금 규칙이 그대로 맞는다).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/lib/c-edit-model.test.ts` · Expected: 파일 전체 PASS.
- [ ] **Step 5: Commit** — `feat(order): add a place edit that moves a block of lines at once — 줄 묶음을 한 번에 옮기는 place 편집`

### Task 3: Order 놓기 모델

**Files:**
- Create: `frontend/src/lib/c-drop-model.ts`, `frontend/src/lib/c-drop-model.test.ts`
- Modify: `frontend/src/lib/section-number.ts:60`(`const MAX_INDENT_LEVEL` → `export const`)

**Interfaces:**
- Consumes: `PlaceEdit`(Task 2), `canChangeDepth`·`isCounted`·`MAX_INDENT_LEVEL`(`section-number.ts`), `OutputCItem`.
- Produces:

```ts
export const DEPTH_STEP_PX = 24;
export const SECTION_SLACK_TOP_PX = 10;     // 칸 머리 위로 이만큼, 아래로 28px까지는 그 칸으로 친다(시안 값)
export const SECTION_SLACK_BOTTOM_PX = 28;
/** 함께 옮기는 덩어리 - 칸 items의 인덱스 닫힌 구간. baseDepth는 같은 의미 줄들의 가장 얕은 깊이 */
export interface DragBlock { start: number; end: number; baseDepth: number; isDepthLocked: boolean }
export function findDragBlock(items: readonly OutputCItem[], depths: readonly number[], index: number, entrance: string): DragBlock;
export type DropZone = "home" | "other" | "outside";
export function classifyDropZone(point: { x: number; y: number }, sheet: { left: number; right: number; top: number; bottom: number }, section: { top: number; bottom: number }): DropZone;
/** 그려진 줄 하나(덩어리 줄은 뺀다) - 화면 순서, y는 pointerY와 같은 좌표계 */
export interface RowBox { targetId: number; top: number; bottom: number }
export interface DropPlan { beforeId: number | null; depth: number; lineY: number; edit: PlaceEdit | null }   // edit null = 제자리
export function planDrop(input: {
  locationKey: string; items: readonly OutputCItem[]; depths: readonly number[]; block: DragBlock;
  rows: readonly RowBox[]; pointerY: number; dx: number; homeTop: number;   // homeTop = 칸에 다른 줄이 없을 때 선을 그을 y
}): DropPlan;
```

규칙(시험이 고정한다):
- **덩어리**: `meaning_key`가 null이 아니고 같은 **이웃** 줄 전부 + 그 뒤로 깊이가 `baseDepth`보다 깊은 줄이 이어지는 데까지. 떨어져 있는 같은 의미 줄은 따라오지 않는다. `isDepthLocked` = 덩어리에 `canChangeDepth(entrance, item)`이 false인 줄이 하나라도 있다.
- **넣을 자리**: `rows`의 중간선(`(top + bottom) / 2`) 가운데 `pointerY`보다 위인 것의 수 k. k가 한 의미 묶음(이웃한 같은 `meaning_key`)의 한가운데면 그 묶음 전체의 중간(`(첫 줄 top + 끝 줄 bottom) / 2`)보다 위면 묶음 앞, 아니면 뒤로 붙는다. `beforeId` = `rows[k]`의 줄, k가 `rows` 끝이면 **`items`에서 그려진 마지막 줄 다음의 (덩어리가 아닌) 줄**, 그것도 없으면 null.
- **깊이**: 잠긴 덩어리는 `baseDepth` 그대로이고 `edit.depths`는 null. 아니면 `clamp(baseDepth + Math.round(dx / 24), 0, max)`, `max` = 넣을 자리 앞의 가장 가까운 번호 줄(`isCounted`) 깊이 + 1(상한 9), 앞에 번호 줄이 없으면 0. 깊이가 `baseDepth`와 다르면 `edit.depths[i] = depths[덩어리 i번째] − baseDepth + depth`.
- `lineY` = `rows[k].top − 1`, k가 끝이면 `rows.at(-1).bottom + 1`, `rows`가 비면 `homeTop`.

- [ ] **Step 1: 실패하는 시험을 쓴다.** 도우미 `line(id, extra)`는 `c-edit-model.test.ts`의 것과 같은 모양(번호 null). `box(ids)`는 줄마다 20px(`top = 20 * i`).

```ts
describe("findDragBlock", () => {
  const items = [line(1, { meaning_key: "m1" }), line(2, { meaning_key: "m1" }), line(3, { meaning_key: "m2" }), line(4, { meaning_key: "m3" }), line(5, { meaning_key: null }), line(6, { meaning_key: "m1" })];
  const depths = [0, 0, 1, 0, 0, 0];
  it("takes same-meaning neighbours and the deeper lines under them", () => {
    expect(findDragBlock(items, depths, 1, "assign")).toEqual({ start: 0, end: 2, baseDepth: 0, isDepthLocked: false });
    expect(findDragBlock(items, depths, 2, "assign")).toEqual({ start: 2, end: 2, baseDepth: 1, isDepthLocked: false });
  });
  it("leaves a same-meaning line that sits apart, and a line without a meaning key moves alone", () => {
    expect(findDragBlock(items, depths, 5, "assign")).toMatchObject({ start: 5, end: 5 });
    expect(findDragBlock(items, depths, 4, "assign")).toMatchObject({ start: 4, end: 4 });
  });
  it("locks depth when any line is an AI translation or the document is already written", () => {
    const pair = [line(1, { meaning_key: "m" }), line(2, { meaning_key: "m", origin: "translation" })];
    expect(findDragBlock(pair, [0, 0], 0, "assign").isDepthLocked).toBe(true);
    expect(findDragBlock(items, depths, 3, "match").isDepthLocked).toBe(true);
  });
});
it("classifyDropZone: home inside the section band (10px above, 28px below), other elsewhere on the sheet, outside off the sheet", () => {
  const zone = (x: number, y: number) => classifyDropZone({ x, y }, { left: 100, right: 860, top: 0, bottom: 2000 }, { top: 300, bottom: 500 });
  expect([zone(200, 290), zone(200, 289), zone(200, 528), zone(200, 529), zone(99, 400), zone(200, 2001)]).toEqual(["home", "other", "home", "other", "outside", "outside"]);
});
describe("planDrop", () => {
  const items = [1, 2, 3, 4, 5].map((id) => line(id));
  const base = { locationKey: "s5", items, depths: [0, 0, 0, 0, 0], block: { start: 0, end: 0, baseDepth: 0, isDepthLocked: false }, rows: box([2, 3, 4, 5]), dx: 0, homeTop: 0 };
  it("inserts by row midlines, with no edit when the block lands where it was or is alone in its section", () => {
    expect(planDrop({ ...base, pointerY: 45 })).toMatchObject({ beforeId: 4, lineY: 39, edit: { targetIds: [1], beforeId: 4, depths: null } });
    expect(planDrop({ ...base, pointerY: 200 })).toMatchObject({ beforeId: null, lineY: 81 });
    expect(planDrop({ ...base, pointerY: 5 }).edit).toBeNull();
    expect(planDrop({ ...base, items: [line(1)], depths: [0], rows: [], pointerY: 50, homeTop: 77 })).toMatchObject({ lineY: 77, edit: null });
  });
  it("changes depth one level per 24px, up to the previous numbered line plus one", () => {
    expect(planDrop({ ...base, pointerY: 45, dx: 11 }).depth).toBe(0);
    expect(planDrop({ ...base, pointerY: 45, dx: 12 })).toMatchObject({ depth: 1, edit: { depths: [1] } });
    expect(planDrop({ ...base, pointerY: 45, dx: 100 }).depth).toBe(1);
    expect(planDrop({ ...base, pointerY: 45, dx: -30 }).depth).toBe(0);
    expect(planDrop({ ...base, pointerY: 5, dx: 100 }).depth).toBe(0);          // 앞에 번호 줄이 없다
  });
  it("skips unnumbered lines when finding the depth limit and never passes MAX_INDENT_LEVEL", () => {
    const noted = items.map((item) => (item.target_id === 3 ? { ...item, number_style: "note" as const } : item));
    expect(planDrop({ ...base, items: noted, depths: [0, 2, 9, 0, 0], pointerY: 45, dx: 240 }).depth).toBe(3);
    expect(planDrop({ ...base, depths: [0, 0, 9, 0, 0], pointerY: 45, dx: 480 }).depth).toBe(9);
  });
  it("keeps the depth of a locked block", () => {
    expect(planDrop({ ...base, block: { ...base.block, isDepthLocked: true }, pointerY: 45, dx: 100 })).toMatchObject({ depth: 0, edit: { depths: null } });
  });
  it("shifts every line of the block by the same amount", () => {
    const plan = planDrop({ ...base, depths: [0, 1, 0, 0, 0], block: { start: 0, end: 1, baseDepth: 0, isDepthLocked: false }, rows: box([3, 4, 5]), pointerY: 25, dx: 24 });
    expect(plan.edit).toMatchObject({ targetIds: [1, 2], beforeId: 4, depths: [1, 2] });
  });
  it("snaps to the edge of another meaning group instead of splitting it", () => {
    const grouped = items.map((item) => (item.target_id === 2 || item.target_id === 3 ? { ...item, meaning_key: "a" } : item));
    expect(planDrop({ ...base, items: grouped, pointerY: 25 }).beforeId).toBe(4);   // 묶음 중간(20) 아래 → 묶음 뒤
    expect(planDrop({ ...base, items: grouped, pointerY: 15 }).beforeId).toBe(2);   // 위 → 묶음 앞(제자리)
  });
  it("drops below the last rendered row before the first unrendered one", () => {
    const long = [1, 2, 3, 4, 5, 6, 7].map((id) => line(id));
    const plan = planDrop({ ...base, items: long, depths: [0, 0, 0, 0, 0, 0, 0], rows: box([2, 3]), pointerY: 500 });
    expect(plan.beforeId).toBe(4);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/lib/c-drop-model.test.ts` · Expected: FAIL(모듈 없음).
- [ ] **Step 3: `c-drop-model.ts`를 쓰고 `MAX_INDENT_LEVEL`을 내보낸다.**
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/lib/c-drop-model.test.ts src/lib/section-number.test.ts` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(order): add the pure drop model for dragging lines — Order 줄 끌기의 놓을 자리·깊이 모델`

### Task 4: 줄 끝 단추 묶음 — 호버·포커스 때만, 글 밖에

끌기와 무관하게 혼자 서는 화면 변경이다(§5 "줄 끝 단추"). 2026-11-12 규칙의 예외 기록 둘도 여기서 한다.

**Files:**
- Modify: `frontend/src/components/outputs/output-c.tsx:90-149`(`RowButtons`의 바깥 span), `:276`(root 클래스), `:341-350`(줄의 주석·클래스), `frontend/src/styles/components.css:1635-1643`, `frontend/public/manual/user-manual.md:576`, `docs/lessons/ui-review.md:30`, `frontend/docs/design/2026-11-07-frontend-design-foundations.md:229`, `frontend/scripts/pw-overlap-audit.mjs:160-196,322-342`, `frontend/scripts/pw-layout-audit.mjs:300-345,1255-1260`
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계)

**Interfaces:**
- Consumes: 없음.
- Produces: 묶음 `<span className="c-acts" data-no-drag data-testid={`output-c-acts-${item.target_id}`}>`(`row-actions-quiet` 클래스는 이 파일에서 뗀다 — 클래스 자체는 Documents·관리 표가 쓰므로 `motion.css`에 둔다). root는 `onMove`가 있을 때 `c-order` 클래스를 더 갖는다.

- [ ] **Step 1: 실패하는 스모크 단계를 쓴다** — `runStep("order: row-end buttons show only on hover or focus, one group at a time", …)`, 지금의 `"order: indent a line…"` 단계 앞에. `halfBundleId`의 Order에서 줄이 넷 이상인 칸을 `findOrderDocs`로 찾고 줄 A·B를 고른다. 불투명도는 `getComputedStyle(el).opacity`, 전환을 기다린 뒤(200ms) 읽는다.

| check 이름 | 조건 |
|---|---|
| `no group shows at rest` | 포인터 (0,0), 포커스 없음 → 보이는 묶음(불투명도 > 0) 0개 |
| `hovering a row shows its group` | A에 올림 → A 묶음 1, 그 상자가 A의 `output-c-item-<A>` 글 상자와 겹치지 않음 |
| `hover does not change the row height` | A의 높이가 올리기 전·후 같다 |
| `the narrow window floats the group above the row's right end` | 기본 뷰포트(1248): 묶음 `bottom ≤ A.top + 1`, `right ≤ A.right + 1` |
| `only one group shows` | B를 눌러 고른 뒤(`click({ position: { x: 4, y: 4 } })`) A에 올림 → B 묶음 0, A 묶음 1; 포인터를 (0,0)으로 → B 묶음 1(포커스) |
| `a keyboard-focused button keeps its group` | B의 `output-c-move-down-<B>`에 `focus()` 뒤 A에 올림 → B 묶음 1 |
| `a wide window floats the group outside the sheet` | `page.setViewportSize({ width: 1440, height: 720 })` 뒤 A에 올림 → 묶음 `left ≥ 용지(article.sheet).right`, 묶음 `right ≤ 스크롤 칸.right` |
| `no horizontal scroll` | 두 폭 모두 스크롤 칸 `scrollWidth ≤ clientWidth` |
| `touch devices keep the buttons visible` | 새 컨텍스트(`browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true })`, `runStep`과 같은 `sopa.devUser` init 스크립트)에서 같은 화면 → 쉬는 상태 묶음 불투명도 1, 묶음이 글 상자와 겹치지 않음 |

- [ ] **Step 2: 실패 확인** — Run(검증 스택): `QUIET=1 ONLY="order: row-end" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs` · Expected: FAIL(`output-c-acts-…` 없음).
- [ ] **Step 3: 마크업과 CSS를 고친다.** `.c-row` 블록의 결정:

| 규칙 | 내용 |
|---|---|
| `.c-order` | `container: c-order / inline-size` |
| `.c-row` | `position: relative` 더함. 지금의 flex 감김 규칙(1636-1638)은 그대로 두되 셋째 줄의 선택자를 `.c-row > .c-acts`로 — `(hover: none)`의 배치가 지금과 같다 |
| `.c-acts`(기본) | `display: flex; gap: 2px` |
| `@media (hover: hover) { .c-acts }` | `position: absolute; right: 0; bottom: 100%; z-index: 2; padding: 2px; border: 1px solid var(--line-2); border-radius: var(--r-2); background: var(--raised); box-shadow: var(--shadow-1); opacity: 0; pointer-events: none; transition: opacity var(--dur-fast)` — 줄 오른쪽 끝의 바로 위(자리를 차지하지 않는다) |
| 보이기 | `.c-row:hover > .c-acts, .c-row:focus > .c-acts, .c-row:focus-within > .c-acts { opacity: 1; pointer-events: auto }` |
| 한 번에 하나 | `.pg:has(.c-row:hover) .c-row:not(:hover):not(:has(:focus-visible)) > .c-acts { opacity: 0; pointer-events: none }` — 글쇠로 단추에 가 있는 묶음은 물러나지 않는다(보이지 않는 포커스 금지) |
| 끄는 동안 | `html[data-box-drag] .c-acts { opacity: 0; pointer-events: none }`(위 규칙들보다 뒤에) |
| 넓은 틀 | `@container c-order (min-width: 1000px) { .c-acts { right: auto; bottom: auto; top: 0; left: calc(100% + 38px) } }` + 호버 다리 `.c-acts::before { content: ""; position: absolute; right: 100%; top: -2px; bottom: -2px; width: 40px }`. 38px = `.pg` 오른쪽 여백 30px + 틈 8px |
| 지우는 것 | `.c-row:focus .row-actions-quiet` 규칙(1643)과 1635행·`output-c.tsx:346` 주석의 "늘 흐리게" 설명 |

- [ ] **Step 4: 문턱 1000px를 재서 확정한다**(`ui-review.md` 2번 — 처방은 재고 적는다). 표시 단추가 있는 줄의 묶음 폭 W를 `page.evaluate`로 재고, `16 + 760 + 8 + W + 16`을 10px 단위로 올린 값이 1000이 아니면 그 값으로 바꾸고 `PROGRESS.md`에 잰 값을 적는다. 뷰포트 1440에서 틀 폭이 문턱보다 큰지도 같이 본다.
- [ ] **Step 5: 두 감사 스크립트를 새 배치로 고친다.** 선택자 `.row-actions-quiet` → `[data-testid^="output-c-acts-"]`(C 줄을 재는 곳만 — Documents 항목은 그대로). `pw-overlap-audit.mjs` `outputsScene`과 옮긴 줄 장면: 쉬는 상태는 "불투명도 0", 올린 상태는 "묶음이 **그 줄의** 글을 덮지 않는다 + 스크롤 칸 오른쪽을 넘지 않는다"로 바꾸고 "줄의 가로 범위 밖이면 보고"는 좁은 틀(묶음이 용지 안)일 때만 본다. `pw-layout-audit.mjs` C8: `views: [1120, 2560]`, 쉬는 불투명도 기대값 0, 올린 불투명도 1, 올린 묶음과 그 줄 글의 겹침 0, "두 줄 이상 접히는 글의 오른쪽 남는 폭" 측정은 그대로(이제 자리를 비우지 않으니 값이 줄어야 한다 — 잰 값을 보고). C13은 선택자만.
- [ ] **Step 6: 문서 셋을 고친다.**
  - 설명서 `{#order}` "**줄 끝 단추**" 항목의 앞 두 문장을 바꾼다: 묶음은 줄에 마우스를 올리거나 줄을 눌러 고르거나 Tab으로 단추에 가면 나타난다 / 창이 넓으면 용지 오른쪽 바깥, 좁으면 그 줄 오른쪽 끝의 바로 위에 떠서 그 줄의 글을 가리지 않는다 / 한 번에 한 줄의 묶음만 보인다 / 터치 화면에서는 늘 보인다. 뒤 문장(Move up·Move down부터)은 그대로.
  - `ui-review.md` 13번 끝과 디자인 기초 11절 229행 끝에 같은 예외를 적는다: "예외(사용자 결정 2026-11-16, 끌어다 놓기 설계 §5): Order와 Documents의 줄 끝 단추는 호버·포커스 때만 보인다. Order는 묶음을 용지 바깥(좁은 창에서는 줄 오른쪽 끝의 한 줄 위)에 띄워 글을 덮지도 자리를 비우지도 않는다. Documents는 Documents 화면 설계에서 적용한다. 결과물 C와 관리 화면의 표는 그대로다."
- [ ] **Step 7: 통과 확인** — Run: `QUIET=1 ONLY="order:" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs`(있던 Order 단계도 함께 — 단추 클릭 앞의 `hover()`가 그대로 통하는지) 그리고 `BASE_URL=http://localhost:3787 node scripts/pw-overlap-audit.mjs` · Expected: 스모크 실패 0, 겹침 감사 ALL PASS. 이어서 `npx vitest run src/lib/manual-content.test.ts && npm run lint && npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 8: Commit** — `feat(order): show row-end buttons only on hover or focus, outside the text — 줄 끝 단추를 호버·포커스 때만 글 밖에`

### Task 5: 모든 줄 고르기와 Alt+↑·↓

**Files:**
- Modify: `frontend/src/lib/target-order.ts`, `frontend/src/components/outputs/output-c.tsx:133-146`(Move 툴팁), `:192-197`(`PendingMove`), `:229-235`(포커스 되돌리기), `:246-255`(`handleMove`), `:345-359`(`tabIndex`·`onKeyDown`), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(`{#order}`, `{#keys}`)
- Test: `frontend/src/lib/target-order.test.ts`, `frontend/scripts/pw-smoke-sop.mjs`(새 단계)

**Interfaces:**
- Consumes: `canMoveTarget`.
- Produces:

```ts
/** 고른 줄에서 누른 글쇠가 한 자리 옮기기(Alt+↑·↓)인가 - 그 방향으로 옮길 수 있을 때만. null이면 기본 동작을 막지 않는다 */
export function readMoveKey(event: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }, state: { canUp: boolean; canDown: boolean }): MoveDir | null;
```

`PendingMove.refocus`는 `"button" | "row" | null`이 된다(`handleMove`의 다섯째 인자도 같은 타입 — 단추는 지금처럼 포커스가 있었을 때 `"button"`, 글쇠는 `"row"`).

- [ ] **Step 1: 실패하는 시험을 쓴다**

```ts
describe("readMoveKey", () => {
  const key = (extra = {}) => ({ key: "ArrowUp", shiftKey: false, altKey: true, ctrlKey: false, metaKey: false, ...extra });
  it("reads Alt+ArrowUp and Alt+ArrowDown only when that move is possible", () => {
    expect(readMoveKey(key(), { canUp: true, canDown: true })).toBe(-1);
    expect(readMoveKey(key({ key: "ArrowDown" }), { canUp: true, canDown: true })).toBe(1);
    expect(readMoveKey(key(), { canUp: false, canDown: true })).toBeNull();
    expect(readMoveKey(key({ altKey: false }), { canUp: true, canDown: true })).toBeNull();
    expect(readMoveKey(key({ shiftKey: true }), { canUp: true, canDown: true })).toBeNull();
    expect(readMoveKey(key({ ctrlKey: true }), { canUp: true, canDown: true })).toBeNull();
  });
});
```

스모크 `runStep("order: Alt+ArrowDown moves the picked line and keeps it picked", …)`: 줄 넷 이상인 칸의 첫 줄을 눌러 고르고 `Alt+ArrowDown` → `check("the move saves", (await waitOrderSave(page)).ok())`, `check("the line moved one place", 순서에서 인덱스 +1)`, `check("the line stays picked", document.activeElement의 testid === output-c-row-<id>)`; `Escape` → `check("Esc lets go of the line", activeElement가 그 줄이 아님)`. 깊이를 바꿀 수 없는 줄(들여쓰기 단추가 없는 줄)이 있으면 그 줄도 눌러 포커스를 받는지 본다(`check("a depth-locked line can be picked", …)` — 없으면 건너뛴다고 찍는다).

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/lib/target-order.test.ts` · Expected: FAIL(`readMoveKey` 없음).
- [ ] **Step 3: 구현.** 고칠 수 있는 줄(`onMove`가 있는 줄) 전부에 `tabIndex={-1}`. `onKeyDown`은 Esc(blur)와 `readMoveKey`를 모든 줄에서, `readIndentKey`는 `indent`가 있는 줄에서만 본다. 옮긴 뒤 `"row"`면 그 줄에 `focus({ preventScroll: true })`. Move 단추 툴팁은 새 문구로(aria-label은 `outputs.moveUp`·`moveDown` 그대로).

| 키 | en | ko |
|---|---|---|
| `outputs.moveUpTip` | `Move up · Alt+↑ on a picked line` | `위로 · 줄을 고른 뒤 Alt+↑` |
| `outputs.moveDownTip` | `Move down · Alt+↓ on a picked line` | `아래로 · 줄을 고른 뒤 Alt+↓` |

- [ ] **Step 4: 설명서.** `{#order}` "줄 끝 단추" 항목에 "줄을 눌러 고른 뒤 <kbd>Alt</kbd>+<kbd>↑</kbd> · <kbd>↓</kbd>로도 한 자리씩 옮깁니다"를 더하고, `{#keys}` 표에 **Order** 줄을 더한다(줄을 고른 뒤 Alt+↑·↓ 옮기기, Tab·Shift+Tab 들이기·내어쓰기, Esc 고름 놓기).
- [ ] **Step 5: 통과 확인** — Run: `npx vitest run src/lib/target-order.test.ts src/lib/i18n-messages.test.ts src/lib/manual-content.test.ts` 그리고 `QUIET=1 ONLY="order:" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs` · Expected: PASS, 실패 0.
- [ ] **Step 6: Commit** — `feat(order): move the picked line with Alt+Arrow keys — 고른 줄을 Alt+↑·↓로 옮기기`

### Task 6: Order 끌기 배선

**Files:**
- Modify: `frontend/src/components/outputs/output-c.tsx`(props 199-210, 본문 212-255, root 276, 줄 341-350), `frontend/src/components/outputs/outputs-workspace.tsx:470`(도움말), `:572-574`(`onPlace`), `frontend/src/styles/components.css`(`.c-row` 블록), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(`{#order}`)
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 둘)

**Interfaces:**
- Consumes: `useBoxDrag`·`BoxDragConfig`·`DragHover`(Task 1), `PlaceEdit`·`previewEdit`(Task 2), `findDragBlock`·`classifyDropZone`·`planDrop`·`DEPTH_STEP_PX`(Task 3), `.c-order`·`.c-acts[data-no-drag]`(Task 4), `PendingMove.refocus: "row"`(Task 5), 지금의 `useFlip`·`getSectionDepths`.
- Produces: `export type PlaceTarget = (targetDocId: number, edit: PlaceEdit) => void;`와 `OutputCViewProps.onPlace?: PlaceTarget`. 화면은 `onPlace={canEditC ? (docId, edit) => editC(docId, edit) : undefined}` — 끌기는 `onPlace`가 있을 때만 붙는다(G13).

DOM 계약: 끌 수 있는 줄에 `data-drag-box`(`onPlace`가 있을 때만). root 안에 React가 한 번 그리는 `<div className="c-dropline" hidden data-testid="output-c-dropline"><span /></div>`. 끄는 동안 덩어리 줄에 `data-drag-src`, 출발 칸 `<section>`에 `data-drag-home`.

- [ ] **Step 1: 실패하는 스모크 단계를 쓴다.** `runStep("order: drag a line to reorder and indent", { allowConsoleErrors: false }, …)` — 끌기는 `page.mouse.move/down/move(…, { steps: 12 })/up`. React 커밋 수는 `page.goto` 앞에 `page.addInitScript`로 `window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, inject() {}, onCommitFiberUnmount() {}, onCommitFiberRoot() { window.__commits = (window.__commits ?? 0) + 1; } }`를 심어 센다. 줄 넷 이상인 칸에서, 마지막 의미 묶음의 첫 줄 L(앞줄에 `data-meaning-start`가 있거나 칸의 첫 줄)을 고른다.

| check 이름 | 조건 |
|---|---|
| `an open menu still closes on the press` | `top-bar-user` 메뉴를 연 채 L을 누르고 10px 움직임 → 메뉴 항목(`user-menu-manual`)이 사라짐(G2) |
| `the drag shows the flag, the card and the drop line` | `<html data-box-drag>`, `drag-card` 보임, L에 `data-drag-src`, `output-c-dropline`이 보이고 글이 `/^\d+(\.\d+)*/`에 맞음 |
| `hover effects are off while dragging` | 보이는 `.c-acts` 0개, `.tip` 0개(G10) |
| `no React commit while dragging` | 같은 칸 안에서 20번 더 움직이는 앞·뒤의 `window.__commits`가 같다(G11) |
| `dropping above the first line saves the new order` | 칸 첫 줄의 `top + 2`에서 뗌 → `waitOrderSave` ok, 칸 순서의 첫 id가 L, L의 번호가 그 칸의 첫 번호 |
| `the dropped line is picked and the drag is over` | activeElement가 L의 줄, 표시·표 없음, 선 `hidden` |
| `the click after the drop is swallowed` | 끌기 전 `document`에 건 click 수 세기가 놓은 뒤 0, 이어서 한 `page.mouse.click`은 1(G5) |
| `dragging sideways 30px indents one level` | 들여쓰기 단추가 켜진 줄을 제자리에서 오른쪽으로 30px → 선 글에 `indent`(en 화면), 놓으면 저장 ok, 번호 마디 +1 |
| `Esc cancels` | 끌다가 `Escape` → 400ms 안에 `PUT …/targets/order` 없음, 순서 그대로, 표시 없음, 누른 줄이 activeElement로 남음 |
| `another section refuses with a reason` | 다른 칸의 줄 위로 → 표에 `data-refused`와 글 `Another section`, 선 `hidden`, 다른 칸 `<section>`의 불투명도 < 1; 놓아도 PUT 없음 |
| `a press on the action group padding does not drag` | L에 올려 묶음을 띄우고 묶음 상자 왼쪽 위 +1px에서 누르고 20px → 표시 없음 |
| `Alt selects text instead of dragging` | `keyboard.down("Alt")` → `<html data-box-select>`; 줄 글 위에서 60px 긁음 → 표시(`data-box-drag`) 없음, `getSelection().toString().length > 0`; `keyboard.up("Alt")` 뒤에도 선택과 `data-box-select`가 남고, 빈 곳을 누르면 둘 다 사라짐(G3) |
| `reduced motion moves at once` | `page.emulateMedia({ reducedMotion: "reduce" })` 뒤 한 번 끌어 놓고 바로 → 옮긴 줄의 인라인 `transform`·`transition`이 빈 값, 줄의 `transition-duration`이 `0s` |

둘째 단계 `runStep("order: drag is off on a read-only bundle", { devUser: "qa.lead" }, …)`: 같은 묶음의 Order에서 `check("the reviewer has no edit buttons", output-c-move-* 0개)`(전제 확인), `check("rows are not drag boxes", [data-drag-box] 0개)`, 줄을 누르고 20px → `check("no drag starts", 표시 없음)`(G13).

- [ ] **Step 2: 실패 확인** — Run: `QUIET=1 ONLY="order: drag" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs` · Expected: 첫 단계 FAIL(`data-box-drag` 없음).
- [ ] **Step 3: `output-c.tsx`에 끌기를 붙인다.** 시그니처가 정하지 않는 흐름만:
  - `useBoxDrag(rootRef, onPlace ? config : null)`. `pick`: `event.target`에서 `closest("[data-drag-box]")` → 그 줄의 문서·칸·인덱스와 `findDragBlock(section.items, getSectionDepths(section), index, doc.entrance)`.
  - `getCard`: `id` = 덩어리 첫 줄의 번호(없으면 빈 글), `text` = 잡은 줄의 글(`text || ai_text`, 그림은 `[Figure]`), `count` = 덩어리가 두 줄 이상이면 `t("order.drag.lines", { count })`. `getScrollers`: 236행과 같은 `closest(".overflow-auto, .overflow-y-auto")`.
  - `onStart`: 덩어리 줄에 `data-drag-src`, 출발 `<section>`에 `data-drag-home`.
  - `onMove`: `classifyDropZone(point, 용지(article.sheet) 상자, 출발 section 상자)` → `"outside"`면 선을 숨기고 `{ state: "none" }`, `"other"`면 선을 숨기고 `{ state: "refused", note: t("order.drag.otherSection") }`, `"home"`이면 그 칸의 그려진 줄 가운데 `data-drag-src`가 아닌 줄을 재서(`getBoundingClientRect` — 읽기만) `planDrop(…, dx: point.x − start.x)`. `(beforeId, depth)`가 앞 프레임과 다를 때만 `previewEdit(doc, plan.edit)`로 덩어리 첫 줄의 새 번호를 읽어(`edit`가 null이면 지금 번호) 선의 글을 쓴다 — 깊이가 `baseDepth`보다 깊으면 ` · ${t("order.drag.indent")}`, 얕으면 `outdent`를 붙인다. 선의 자리는 인라인 스타일로: `top = lineY − root.top`, `left = 줄.left − root.left + depth × DEPTH_STEP_PX`, 오른쪽 끝은 줄의 오른쪽 끝. `{ state: "ok" }`.
  - `onDrop`: 마지막 계획에 `edit`가 있으면 `flip.capture([잡은 줄, …그 칸의 그려진 나머지 줄])` → `pendingMoveRef = { targetId: 잡은 줄, dir: 1, refocus: "row" }`(`dir`은 단추 포커스에만 쓰인다) → `setFollowId` → `onPlace(docId, edit)`. 없으면 아무 일도 없다.
  - `onEnd`: 속성 둘과 선, 마지막 계획을 치운다. 프레임마다의 값은 ref에 둔다 — `useState`를 쓰지 않는다(G11).
- [ ] **Step 4: CSS**(`.c-row` 블록):

| 규칙 | 내용 |
|---|---|
| `.c-row[data-drag-box]` | `border-radius: var(--r-1); transition: background-color var(--dur-fast), box-shadow var(--dur-fast)` |
| `html:not([data-box-drag]):not([data-box-select]) .c-row[data-drag-box]:hover` | `background: var(--hover); box-shadow: 0 0 0 1px var(--line-2), var(--shadow-1)`(G9 — 테두리 대신 고리라 높이가 변하지 않는다) |
| `.c-row:focus`(1642) | 지금 값에 `border-top-left-radius: 0; border-bottom-left-radius: 0`(막대 쪽 모서리 직각) |
| `html[data-box-drag] .c-order section:not([data-drag-home])` | `opacity: .35` |
| `.c-dropline` | `position: absolute; z-index: 3; height: 2px; border-radius: 1px; background: var(--accent); pointer-events: none`, 왼쪽 끝 동그라미(`::before`, 8px, `--accent` 테두리·`--surface` 바탕), `span`은 선 위 번호 알약(`--accent` 바탕·`--on-accent` 글, mono 10px, `white-space: nowrap`), 빈 `span`은 숨김. root(`[data-testid="output-c"]`)에 `position: relative` |
| `@media (prefers-reduced-motion: reduce)` | `.c-row[data-drag-box] { transition: none }` |

- [ ] **Step 5: 문구와 도움말.** `outputs-workspace.tsx`의 `order.lead` 옆(고칠 수 있을 때만)에 `<InfoTip text={t("order.dragHelp")} testId="order-drag-help" />`.

| 키 | en | ko |
|---|---|---|
| `order.drag.otherSection` | `Another section: change it in Assign` | `다른 칸 · 칸은 Assign에서 바꿉니다` |
| `order.drag.lines` | `{count} lines` | `{count}줄` |
| `order.drag.indent` | `indent` | `들여쓰기` |
| `order.drag.outdent` | `outdent` | `내어쓰기` |
| `order.dragHelp` | `Drag a line to move it within its section; drag sideways to indent. Lines from the same meaning move together. Hold Alt to select text.` | `줄을 끌어 칸 안에서 옮기고, 좌우로 끌어 들여 씁니다. 같은 의미의 줄은 함께 갑니다. 글자를 긁으려면 Alt를 누릅니다.` |

- [ ] **Step 6: 설명서 `{#order}`에 "**끌어서 옮기기**" 항목을 더한다**("줄 끝 단추" 항목 앞). 담을 내용: 줄 어디든(단추 제외) 잡고 끈다 / 같은 의미의 이웃 줄과 그 아래 더 깊은 줄이 함께 가고, 단추와 글쇠는 한 줄씩 옮긴다 / 같은 칸 안에서만 — 다른 칸 위에서는 표에 이유가 적히고 놓이지 않는다(칸은 **Assign** 에서) / 다른 의미 묶음의 한가운데에는 끼지 않고 앞뒤로 붙는다 / 좌우로 끌면 한 단씩, 앞 번호 줄보다 한 단 깊게까지 / AI 번역 줄이나 이미 쓴 New 문서의 줄이 든 덩어리는 위아래로만 / 선 위의 번호가 놓았을 때의 번호(저장 응답이 이긴다) / <kbd>Esc</kbd> 취소, 가장자리에서 스스로 스크롤 / 글자를 긁으려면 <kbd>Alt</kbd>를 누른 채 / 터치 화면과 읽기 전용에서는 끌리지 않는다.
- [ ] **Step 7: 통과 확인** — Run: `QUIET=1 ONLY="order:" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs` 그리고 `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run` · Expected: 스모크 실패 0, 나머지 오류 0.
- [ ] **Step 8: Commit** — `feat(order): drag lines to reorder and indent — Order에서 줄을 끌어 순서와 깊이 바꾸기`

### Task 7: 극단 자료 확인과 브랜치 마무리

**Files:**
- Modify: `frontend/CLAUDE.md`("이동·움직임 공통 층" 문단에 한 문장), `docs/README.md`(명세 줄의 "미구현" → "1걸음 구현, 2~4걸음 미구현"), `PROGRESS.md`
- 고치는 것이 나오면 그 Task의 파일.

- [ ] **Step 1: 극단 자료 스택을 띄운다**(검증 스택을 내리고 같은 포트로 — `next dev`는 폴더에 하나).

```bash
# backend/ 에서 (약 2분 반, 끝 줄 `worst seed done: 43 bundles`)
DATABASE_URL=sqlite+aiosqlite:///./dnd-worst.db AUTH_MODE=dev $VENV/python -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./dnd-worst.db AUTH_MODE=dev $VENV/python -m scripts.seed_sop_demo
DATABASE_URL=sqlite+aiosqlite:///./dnd-worst.db AUTH_MODE=dev $VENV/python -m scripts.seed_sop_worst
DATABASE_URL=sqlite+aiosqlite:///./dnd-worst.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $VENV/uvicorn app.main:app --port 8787
```

- [ ] **Step 2: 배치 감사** — Run(`frontend/`): `DS=worst ONLY=C8,C13 BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs` · Expected: 종료 코드 0. C8이 1120(좁은 틀)과 2560(용지 바깥) 둘 다에서 "올린 묶음이 그 줄의 글을 덮지 않음"을 통과하고, 잰 값(겹침, 접힌 글의 남는 폭)을 `PROGRESS.md`에 적는다. 실패하면 `../.shots/layout-C8-<width>.png`를 직접 보고 Task 4의 CSS를 고친다.
- [ ] **Step 3: 끌기 극단 확인**(§9) — 임시 스크립트 `frontend/_dnd-worst.mjs`(끝나면 지운다)로 `SYNTHETIC W1` 묶음의 Order를 1120과 2560에서 연다. 재는 것과 기대:
  - 1,800자 문단 줄을 끌 때 `drag-card`의 높이 ≤ 34px, 폭 ≤ 300px(한 줄 말줄임).
  - 줄이 가장 많은 문서에서 20번 움직이는 동안 React 커밋 0(Task 6과 같은 훅).
  - 포인터를 스크롤 칸 아래 가장자리 20px 안에 0.5초 두면 `scrollTop`이 늘고, 그 뒤에도 선이 포인터 아래 줄 사이에 있다.
  - 이어 그리기 끝(`output-c-more`)이 보이는 데까지 자동 스크롤로 내려가 놓아도 저장이 ok다.
  - 잰 값을 그대로 보고한다. 기준을 풀지 않는다.
- [ ] **Step 4: 전체 게이트.** 공용 부품(`ui/tooltip.tsx`·`delegated-tip.tsx`, `motion.css`)을 고쳤으므로 전체 스모크와 감사를 돈다(사용자 결정 2026-11-16). `dnd-smoke.db`를 새로 만들어(`reset_db → seed_sop_demo`) 검증 스택을 다시 띄운 뒤:

```bash
QUIET=1 BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs      # 실패 0
BASE_URL=http://localhost:3787 node scripts/pw-overlap-audit.mjs          # ALL PASS (DB 불변)
BASE_URL=http://localhost:3787 node scripts/pw-contrast-audit.mjs         # 4.5:1 통과
npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run       # 오류 0, 전부 PASS
npm run build                                                             # next dev를 내린 뒤. 경고 0
```

- [ ] **Step 5: Windows 수동 확인을 남긴다**(Review Focus 3 — 이 환경에서 자동화할 수 없다). `PROGRESS.md`에 "사용자 확인 필요"로 적는다: Windows Chrome에서 Order 줄의 글자를 Alt로 긁고 Alt를 뗀 뒤 브라우저 메뉴(⋮)에 포커스가 가지 않는지, 이어서 누른 글쇠가 화면에 닿는지.
- [ ] **Step 6: 문서.** `frontend/CLAUDE.md`에 한 문장 — 상자 전체 끌기는 `lib/box-drag.ts`·`use-box-drag.ts`(끌기 중 표시 `<html data-box-drag>`를 CSS와 `isBoxDragActive()`가 같이 본다, 화면마다의 놓기 규칙은 순수 모델 — Order는 `lib/c-drop-model.ts`)로 하고 포인터 끌기를 새로 짜지 않는다. `docs/README.md`의 명세 줄 상태를 고친다. `PROGRESS.md`에 이 브랜치의 결과·결정(이름, 문턱 값, 시안과 다르게 한 것)을 적는다.
- [ ] **Step 7: Commit** — `docs(dnd): record step 1 verification and the drag layer in the guides — 1걸음 검증 기록과 끌기 층 안내`
- [ ] **Step 8: `dev`에 올릴 때(사용자가 말하면) 한 번에 하는 것** — 이 계획의 커밋에는 넣지 않는다.
  - `frontend/`에서 `npm version patch --no-git-tag-version`(그때의 다음 번호 — 다른 세션이 먼저 썼으면 그 다음).
  - `CHANGELOG.md` `## Unreleased (dev)` 아래 `vX.Y.Z — 날짜` 줄: "**Order** 에서 줄을 끌어 칸 안의 순서와 깊이를 바꾼다(같은 의미의 줄과 더 깊은 줄이 함께, 다른 칸은 이유와 함께 거절, 글자 긁기는 Alt). 줄 끝 단추는 호버·포커스 때만 글 밖에 뜬다. <kbd>Alt</kbd>+<kbd>↑</kbd>·<kbd>↓</kbd>로 고른 줄을 옮긴다. 손잡이 없는 공통 끌기 층(`lib/box-drag.ts`)."
  - 머지 커밋에서 이 브랜치의 `PROGRESS.md` 항목들을 요약 하나로 합친다(`rules/common/git.md` "On Branch Merge"). 머지 뒤 작업 브랜치는 로컬·원격 모두 지운다. 푸시는 GitHub `origin`에만.

## Self-Review 결과

- **명세 대조**: G1~G8·G10·G11 → Task 1(G7의 `target` 테두리는 엔진과 CSS까지 — Order는 선으로 보이므로 뒤 걸음이 쓴다), G9·G12·G13 → Task 5·6. §5의 끄는 것·놓는 곳·깊이·미리 보기 → Task 2·3·6, 저장 → Task 2(지금 줄 그대로), 글쇠 → Task 5, 줄 끝 단추와 예외 기록 둘 → Task 4. §9의 순수 모델·브라우저 장면(Order)·극단 자료·움직임 줄이기 → Task 3·6·7.
- **G6의 "어디로 가는지"**: Order에서는 넣을 자리 선 위의 번호가 맡고, 표의 `note`는 거절 이유에만 쓴다(시안과 같다).
- **범위 밖으로 둔 것**: 출발 조각에서 포인터까지의 이음 선(§6), Assign·Pair view의 놓기, 서버(§8), 사용 설명서 그림(정식 업데이트 때).
- **시안과 다르게 한 것**(명세를 따랐다): 단추와 글쇠는 묶음이 아니라 한 줄씩 옮긴다(§5), 깊이 상한은 시안의 2가 아니라 `MAX_INDENT_LEVEL` 9, 시안 아래쪽의 안내 띠(hint bar)는 명세에 없어 넣지 않고 머리의 (i) 도움말로 Alt 글자 긁기를 알린다.
