# Assign 잇기(끌어다 놓기 2걸음) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign의 Old 조각을 끌어 이미 쓴 New 문서의 문장에 놓으면, 지금 "Old 줄 고르고 New 문장 클릭"과 똑같은 상태(고른 줄 + 고른 문장 + 그 자리 메뉴)가 된다.

**Architecture:** 1걸음의 공통 끌기 층(`lib/box-drag.ts`·`use-box-drag.ts`)을 `.assign-panes`에 붙인다. 끌 수 있는지·표 한 장·놓을 곳의 종류는 순수 모델 `lib/assign-drop-model.ts`가 정하고, 놓기는 새 저장 길 없이 지금 클릭 경로(`selectRow` → `pickNewSentence` → `jump` 이펙트의 `openMenu`)를 다시 탄다. 끄는 동안의 표시는 모두 DOM 속성과 명령형 SVG다(React 상태 없음).

**Tech Stack:** Next.js 16 · React 19 · TypeScript · vitest · Playwright(시스템 Chrome) 스모크. 새 의존성 없음. 서버 변경 없음.

**Spec:** `docs/superpowers/specs/2026-11-16-drag-and-drop-design.md` — §4(G1~G13), §6(놓는 곳 표의 첫 줄만), §9, §10의 2걸음. 구현 전에 `frontend/CLAUDE.md`, `docs/lessons/react-ts-patterns.md`, `docs/lessons/browser-verification.md`, `docs/lessons/ui-review.md`를 읽는다.

## Global Constraints

- 작업 폴더는 워크트리 `/Users/hyeonjin/Documents/sop-archivist-dnd`, 브랜치 `feat/assign-drag-link`. 원본 체크아웃 `/Users/hyeonjin/Documents/sop-archivist`는 읽기와 venv 실행만 한다. 워크트리에 venv 링크를 만들지 않는다.
- **화면만 바꾼다.** backend·API·Alembic에 손대지 않는다.
- **놓는 것은 고르는 것까지다**(반목표): 놓았다고 저장·확정되면 실패다. 저장은 지금처럼 메뉴의 Link/Confirm이나 Enter가 한다.
- **지금의 클릭·단축키 경로는 하나도 바뀌지 않는다**(G12). `handleNewPick`·`handleOldClick`의 동작을 바꾸지 않는다.
- `pointerdown`에서 `preventDefault`를 부르지 않는다(G2 — 끌기 층이 이미 지킨다. 새 리스너를 더할 때도 같다).
- 끄는 동안 React 상태를 바꾸지 않는다(G11). 놓을 때 한 번만 바꾼다.
- 이번 걸음에서 놓이는 곳은 **이미 쓴 문서(`readOnly`가 아닌 New 칸)의 문장 줄 하나뿐**이다. 아직 쓰지 않은 문서(New · from Assign)의 문장 사이·빈 칸, 옆 패널의 칸은 3걸음이다 — 그 위에서는 `state: "none"`(이유 없음, 놓아도 아무 일 없음).
- 기존 시험의 기대값을 고치지 않는다. **예외 하나**: 스모크 `assign: make a unit from a dragged selection, then undo`는 글자 긁기가 Alt를 누른 동안만 되도록 바뀌므로(사용자 결정 2026-11-16, G3) 긁는 동안 `Alt`를 누르게 **입력만** 고친다. 기대값은 그대로 둔다.
- 새 문구는 `frontend/src/lib/i18n-messages.ts`에 en·ko 둘 다. 사용 설명서 글(`frontend/public/manual/user-manual.md`)은 화면을 바꾸는 커밋에서 함께 고친다. 그림은 뽑지 않는다.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. 커밋 전 `PROGRESS.md` 갱신. 푸시는 하지 않는다(조율하는 세션이 한다).
- 검증 스택(이 워크트리 전용 포트): backend 8787, frontend 3787. 원본 venv의 python은 `/Users/hyeonjin/Documents/sop-archivist/backend/.venv/bin/python`. 내 것이 아닌 프로세스(다른 워크트리 `sop-archivist-tf`의 서버 등)는 죽이지 않는다.

```bash
# 워크트리 backend/ 에서
PY=/Users/hyeonjin/Documents/sop-archivist/backend/.venv/bin/python
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev $PY -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev $PY -m scripts.seed_sop_demo   # 극단 자료는 seed_sop_worst
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $PY -m uvicorn app.main:app --port 8787
# 워크트리 frontend/ 에서
BACKEND_URL=http://localhost:8787 npx next dev -p 3787
QUIET=1 BASE_URL=http://localhost:3787 BACKEND_PYTHON=$PY node scripts/pw-smoke-sop.mjs   # Assign은 ONLY로 거르지 않는다(걸러 돌리면 assign-bar 단계가 실패한다 - 스크립트 한계)
```

## 이 계획이 정한 것(내 판단 — 설계에 없는 빈칸)

1. **다른 줄을 끌어도 된다.** 지금 고른 줄이 아닌 Old 조각을 끌어 놓으면 그 줄이 골라지고(클릭과 같은 `selectRow`), 그 줄의 관계 묶음(`group`)이 온 뒤 잇기가 적용된다. 그 사이 다른 줄을 고르면 버린다.
2. **놓은 뒤는 `jump` 이펙트를 탄다** — 놓인 문장이 번쩍이고(`flashElement`) 그 자리 메뉴가 뜬다. "→ 간 곳"을 눌렀을 때와 같은 길이라 메뉴 자리 규칙(v1.1.1의 이음 선 끝)이 그대로다.
3. **이미 그 문장에 확정해 이은 줄을 그 문장에 놓으면** 클릭과 같이 고름을 바꾸지 않고 끊기 메뉴가 뜬다.
4. **한 단 보기(`view.single`)에서도 끌기는 시작된다.** 놓을 곳이 없어 표만 따라오고 아무 일도 없다(3걸음에서 옆 패널의 칸이 놓을 곳이 된다). 글자 긁기 규칙(Alt)을 두 보기에서 같게 두려는 판단이다.
5. **끌기가 꺼지는 때**(조각에 `data-drag-box`도 없다 → 글자는 지금처럼 그냥 긁힌다): 읽기 전용(`!canEdit`), `mode === "unsourced"`, 짝 고르는 중(`pairSource && pairFrom`), 한 단의 New 문서 원문 보기(`isSolo`).
6. **표 한 장**: ID는 줄 첫 Unit의 `display_id`, 글은 그 Unit의 `text`(CSS가 한 줄로 줄인다), Unit이 둘 이상이면 개수. 놓을 수 있는 문장 위에서는 메모 "이 문장에 잇기".

## Review Focus

1. 끌기를 넣은 뒤에도 Old 조각의 클릭·Shift 클릭·두 번 누르기(나눌 자리)·우클릭이 그대로다 — 4px 안 움직인 누름은 지금의 클릭이다.
2. 놓은 직후 뒤따르는 `click`이 New 문장 단추(`button.new-hit`)에 닿아 고름이 뒤집히지(두 번 적용) 않는다.
3. Old 줄을 끌어 놓고 묶음(`group`)이 오기 전에 다른 줄을 고르면, 늦게 온 응답이 엉뚱한 줄에 잇기를 적용하지 않는다.
4. 끄는 동안 Old 칸이 자동 스크롤되어 출발 조각이 화면 밖으로 나가도 따라오는 점선이 문서 머리나 화면 밖으로 뻗지 않는다.
5. Unit 수천 개 문서(`seed_sop_worst`)에서 끄는 동안 React 커밋이 0이고, 1,800자 문단을 끌 때 표가 한 줄이다.

---

### Task 1: 순수 모델 `assign-drop-model`

**Files:**
- Create: `frontend/src/lib/assign-drop-model.ts`
- Test: `frontend/src/lib/assign-drop-model.test.ts`

**Interfaces:**
- Consumes: `DragCard` (`@/lib/box-drag`), `Destination` (`@/lib/classify-model` — `readDestination`의 반환형. 다른 이름이면 그 이름을 쓴다).
- Produces:

```ts
export interface OldDragGate { canEdit: boolean; mode: "old" | "unsourced"; isPairPicking: boolean; isSolo: boolean }
/** Old 조각을 끌 수 있나 - 꺼지면 조각에 data-drag-box도 달지 않는다 */
export function canDragOld(gate: OldDragGate): boolean;

export interface DragUnit { display_id: string; text: string }
/** 표 한 장 - 줄 첫 Unit의 ID와 글, Unit이 둘 이상이면 countLabel(개수) */
export function buildOldDragCard(units: readonly DragUnit[], countLabel: (count: number) => string): DragCard;

/** 포인터 밑에서 읽은 것 - pane은 그 줄이 든 칸, isReadOnly는 New 칸의 data-read-only, hasPickButton은 줄 안에 button.new-hit이 있나 */
export interface NewHit { targetId: number; isReadOnly: boolean; hasPickButton: boolean }
export type AssignDrop = { kind: "link"; targetId: number } | { kind: "none" };
/** 이번 걸음에서 놓이는 곳은 이미 쓴 문서의 고를 수 있는 문장 줄뿐 */
export function findAssignDrop(hit: NewHit | null): AssignDrop;

/** 놓았을 때 할 일 - 클릭(handleNewPick의 Old 줄 갈래)과 같은 판단 */
export type DropLinkAction = "pick" | "menu_only";
export function resolveDropLink(input: { draftDestination: Destination | null; savedDestination: Destination | null; targetId: number }): DropLinkAction;
```

- [ ] **Step 1: 실패하는 시험을 쓴다** — `assign-drop-model.test.ts`

```ts
describe("canDragOld", () => {
  const open = { canEdit: true, mode: "old" as const, isPairPicking: false, isSolo: false };
  it("allows a drag only for an editor in the old mode", () => {
    expect(canDragOld(open)).toBe(true);
    expect(canDragOld({ ...open, canEdit: false })).toBe(false);
    expect(canDragOld({ ...open, mode: "unsourced" })).toBe(false);
    expect(canDragOld({ ...open, isPairPicking: true })).toBe(false);
    expect(canDragOld({ ...open, isSolo: true })).toBe(false);
  });
});

describe("buildOldDragCard", () => {
  const label = (count: number) => `${count} units`;
  it("uses the first unit and no count for a single unit", () => {
    expect(buildOldDragCard([{ display_id: "OLD-3", text: "Wear gloves." }], label)).toEqual({ id: "OLD-3", text: "Wear gloves.", count: null });
  });
  it("counts the units of a KO/EN pair row", () => {
    expect(buildOldDragCard([{ display_id: "OLD-3", text: "장갑을 낀다." }, { display_id: "OLD-4", text: "Wear gloves." }], label)).toEqual({ id: "OLD-3", text: "장갑을 낀다.", count: "2 units" });
  });
  it("collapses whitespace so a long paragraph stays one line", () => {
    expect(buildOldDragCard([{ display_id: "OLD-9", text: "a\n  b\tc" }], label).text).toBe("a b c");
  });
  it("returns an empty card for a row whose units are gone", () => {
    expect(buildOldDragCard([], label)).toEqual({ id: "", text: "", count: null });
  });
});

describe("findAssignDrop", () => {
  it("links onto a pickable sentence of a written document", () => {
    expect(findAssignDrop({ targetId: 7, isReadOnly: false, hasPickButton: true })).toEqual({ kind: "link", targetId: 7 });
  });
  it("is nowhere over a composed (read-only) document, a non-sentence block, or outside any line", () => {
    expect(findAssignDrop({ targetId: 7, isReadOnly: true, hasPickButton: false })).toEqual({ kind: "none" });
    expect(findAssignDrop({ targetId: 7, isReadOnly: false, hasPickButton: false })).toEqual({ kind: "none" });
    expect(findAssignDrop(null)).toEqual({ kind: "none" });
  });
});

describe("resolveDropLink", () => {
  const link = (ids: number[]) => ({ kind: "link" as const, targetIds: ids });
  it("picks the sentence when nothing is saved there", () => {
    expect(resolveDropLink({ draftDestination: null, savedDestination: null, targetId: 7 })).toBe("pick");
    expect(resolveDropLink({ draftDestination: null, savedDestination: link([8]), targetId: 7 })).toBe("pick");
  });
  it("only opens the menu on the sentence the row is already saved to", () => {
    expect(resolveDropLink({ draftDestination: null, savedDestination: link([7, 8]), targetId: 7 })).toBe("menu_only");
  });
  it("picks again when a draft is in progress, like a click", () => {
    expect(resolveDropLink({ draftDestination: link([9]), savedDestination: link([7]), targetId: 7 })).toBe("pick");
  });
});
```

- [ ] **Step 2: 실패를 본다** — `cd frontend && npx vitest run src/lib/assign-drop-model.test.ts` → FAIL(모듈 없음). 주의: vitest는 없는 이름을 import만 하고 부르지 않으면 통과할 수 있다 — 위 시험은 모두 함수를 부르므로 실패가 보여야 한다.
- [ ] **Step 3: `assign-drop-model.ts`를 쓴다.** 파일 머리에 한 줄 요약과 `// 설계: docs/superpowers/specs/2026-11-16-drag-and-drop-design.md §6`. `resolveDropLink`의 조건은 `page.tsx` `handleNewPick`의 "`draft.destination === null && savedDestination?.kind === "link" && savedDestination.targetIds.includes(targetId)`"와 같다(그때 `menu_only`).
- [ ] **Step 4: 통과를 본다** — 같은 명령 → PASS. `npx tsc --noEmit -p tsconfig.json`과 `npm run lint`도 초록.
- [ ] **Step 5: 커밋** — `feat(assign): add the drop model for dragging an Old piece onto a New sentence — Old 조각을 New 문장에 끄는 놓기 모델` (`PROGRESS.md` 한 줄 포함)

---

### Task 2: 화면 — 끌어서 잇기

**Files:**
- Modify: `frontend/src/components/paper/paper.tsx`(조각에 `data-drag-box`), `frontend/src/components/assign/old-pane.tsx`(prop 넘기기)
- Modify: `frontend/src/components/assign/link-lines.tsx`(끄는 동안 호버 강조 끄기, 선 끝 계산 내보내기)
- Create: `frontend/src/components/assign/drag-link-line.ts`(끄는 동안 따라오는 점선 — React 없는 명령형 SVG)
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx`(끌기 붙이기, 놓기 적용)
- Modify: `frontend/src/styles/components.css`(들림, 끄는 동안 호버 효과 끄기, 놓을 문장 테두리)
- Modify: `frontend/src/lib/i18n-messages.ts`, `frontend/src/components/assign/assign-help.tsx`(도움말 한 줄 — 그 부품의 지금 짜임에 맞춘다), `frontend/public/manual/user-manual.md`
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 하나 + 기존 단계 하나의 입력)

**Interfaces:**
- Consumes: Task 1의 `canDragOld`·`buildOldDragCard`·`findAssignDrop`·`resolveDropLink`. `useBoxDrag`(`@/lib/use-box-drag`), `BoxDragConfig`·`findUnderPoint`·`isBoxDragActive`(`@/lib/box-drag`), `buildLinkPath`(`@/lib/link-route-model`), `findOldStrip`·`findNewLine`(`link-lines.tsx`).
- Produces:
  - `Paper`·`OldPane` prop `dragBoxes?: boolean` — 참이면 Unit이 있는 `.strip`(`data-strip-unit`이 있는 것)에 `data-drag-box=""`.
  - `drag-link-line.ts`: `export function createDragLinkLine(root: HTMLElement): { update(start: { x: number; y: number } | null, end: { x: number; y: number }): void; remove(): void }` — `root`(`.assign-panes`) 안에 `<svg class="link-lines" data-drag-line aria-hidden>`를 하나 만들고 `<g data-draft><path/></g>`로 지금 초안 이음 선의 CSS를 그대로 받는다. 좌표는 client 좌표로 받아 `root` 기준으로 옮긴다(`link-lines.tsx`의 `shift`와 같다). `start`가 null이면(출발 조각이 Old 칸 화면 밖) 선을 감춘다.
  - 새 문구 키(en / ko):
    - `assign.drag.link`: "Link to this sentence" / "이 문장에 잇기"
    - `assign.drag.units`: "{count} units" / "Unit {count}개"
    - `assign.dragHelp`: "Drag an Old piece onto a sentence of a written New document to link it. Hold Alt to select text." / "Old 조각을 이미 쓴 New 문서의 문장에 끌어다 놓으면 잇습니다. 글자를 긁으려면 Alt를 누릅니다."
  - 새 `data-testid`: 없음(끌려가는 표는 끌기 층의 `drag-card`, 놓을 줄은 `assign-new-<id>`의 `data-drop`).

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** `pw-smoke-sop.mjs`의 `assign: written New document - identical, link by clicking, …` 단계 **뒤**에 새 단계 `assign: drag an Old piece onto a written New sentence, it links like a click`을 더한다. 자료는 그 단계와 같은 묶음(`halfBundleId`)을 쓰고, 끌 것과 놓을 곳은 API로 고른다(미배정 Old Unit 하나와, 열린 written New 문서에서 `data-state`가 `picked`가 아닌 문장 줄 하나). 끌기는 기존 `dragThrough` 도우미로 한다. 확인할 것:
  1. 끌기 전 다른 Old 줄을 골라 둔다(끄는 줄이 지금 고른 줄이 아닌 경우를 본다).
  2. 끄는 동안: `[data-testid="drag-card"]`가 보이고 글에 그 Unit의 `display_id`가 있다. 놓을 문장 위에서 `.new-line`에 `data-drop="over"`가 붙고 표의 메모가 "Link to this sentence"다. `svg[data-drag-line] path`의 `d`가 비어 있지 않다. 출발 조각에 `data-drag-src`가 있다.
  3. 문장 위를 여러 걸음 지나는 동안 `window.__commits`가 늘지 않는다(이 스크립트의 Order 끌기 단계가 쓰는 재기와 같다 — 1990~2015줄 근처).
  4. 놓은 뒤: 끈 Unit의 조각에 `data-sel`, 놓은 문장의 `assign-new-pick-<id>`가 `aria-pressed="true"`, `assign-link-menu`가 보이고 `assign-link-menu-unsaved`가 하나다. `drag-card`·`svg[data-drag-line]`·`[data-drop]`·`[data-drag-src]`가 모두 사라졌다.
  5. **저장되지 않았다**: `GET /api/bundles/{id}/units`(이 스크립트가 쓰는 Unit 목록 읽기)에서 그 Unit의 `status`가 그대로 `unassigned`다.
  6. 메뉴의 Cancel(`assign-link-menu-cancel`)을 누르면 고름이 사라진다(`aria-pressed="false"`).
  7. Esc: 다시 끌다가 문장 위에서 `Escape` → 표가 사라지고 고름·메뉴가 생기지 않는다.
  8. 아직 쓰지 않은 문서: New 칸을 composed 문서로 바꾸고(문서 고르기) 끌어 그 문장 위에 두면 `[data-drop]`이 생기지 않고, 놓아도 메뉴가 뜨지 않는다.
  9. 클릭은 그대로: Old 조각을 움직이지 않고 누르면(`mouse.down`·`up`) 표 없이 그 줄이 골라진다.
- [ ] **Step 2: 실패를 본다.** 갓 시드한 DB에서 전체 스모크를 돌려 새 단계만 실패하는 것을 본다(다른 단계의 지금 실패 기준선도 이때 적어 둔다 — 뒤에 내 변경과 가를 근거다).
- [ ] **Step 3: `paper.tsx`·`old-pane.tsx`에 `dragBoxes`를 넣는다.** `data-strip-unit`이 있는 `.strip`에만 `data-drag-box`. 표 조각은 그 `.strip`이 감싸므로 칸 조각에 따로 달지 않는다(글자 막기는 상속된다). `paper.tsx`의 기존 클릭 가드·`handleMouseDown`·`handleMouseUp`은 건드리지 않는다.
- [ ] **Step 4: `drag-link-line.ts`를 쓴다.** `link-lines.tsx`에서 Old 쪽 시작점 계산(조각 오른쪽 끝, 배지가 있으면 배지 높이, 없으면 `readAnchorY`)과 New 쪽 끝점 계산(`readNewLineEnd`)을 함수로 내보내 함께 쓴다(값을 다시 적지 않는다). 시작점이 Old 칸 `.pane-body`의 위아래 밖이면 `update(null, …)`.
- [ ] **Step 5: `page.tsx`에 끌기를 붙인다.**
  - `useBoxDrag(panesRef, canDragOld({ canEdit, mode, isPairPicking: pairSource !== null && pairFrom !== null, isSolo }) ? dragConfig : null)`. `OldPane`에는 같은 값으로 `dragBoxes`.
  - `pick`: 누른 곳이 `[data-pane="old"] [data-drag-box]` 안일 때만. 누른 곳의 가장 안쪽 `[data-unit]`(없으면 그 조각의 `data-strip-unit`)으로 `rowOfUnit` → 줄. 줄이 없으면 null. source는 `{ rowKey, unitIds }`.
  - `getCard`: `buildOldDragCard(줄의 Unit들(unitMap), (count) => t("assign.drag.units", { count }))`.
  - `getScrollers`: `.assign-panes` 안의 두 `.pane-body`.
  - `onStart`: 줄의 조각마다(`findOldStrip`) `data-drag-src`, 따라오는 점선 만들기. `link-lines`가 달아 둔 `data-link-hover`·`data-mate-hover`는 여기서 지운다.
  - `onMove`: `findUnderPoint(point, '[data-pane="new"] .new-line[data-target]')` → `NewHit`(`isReadOnly`는 `.pg[data-read-only]` 안인가, `hasPickButton`은 `button.new-hit`이 있나) → `findAssignDrop`. `link`면 `{ state: "ok", note: t("assign.drag.link"), target: 그 줄 }`이고 점선 끝은 그 줄의 실제 이음 끝점, 아니면 `{ state: "none" }`이고 점선 끝은 포인터.
  - `onDrop`: 놓은 자리에서 다시 `findAssignDrop`. `link`가 아니면 아무 일도 없다. `link`면 `setChecked(new Set())` → `setCtxMenu(null)` → `selectRow(rowKey, false)` → `setDropLink({ rowKey, targetId })`.
  - `onEnd`: `data-drag-src`와 점선을 지운다(취소 때도).
  - 새 상태 `dropLink: { rowKey: string; targetId: number } | null`. 이 파일이 이미 쓰는 "렌더 중 상태 맞추기"(예: `follow`, `menu`)로 푼다: `dropLink`가 있고 `activeKey !== dropLink.rowKey`면 버린다. 같고 `groupPending`이 아니면 `setDropLink(null)` 뒤 `resolveDropLink({ draftDestination: draft.destination, savedDestination, targetId })`가 `"pick"`일 때 `pickNewSentence(targetId, false)`를 부르고, 어느 쪽이든 `setJump({ side: "new", id: targetId, targetId, rowKey })`로 메뉴를 띄운다(DOM은 `jump` 이펙트가 찾는다 — 렌더 중에 DOM을 읽지 않는다).
  - `handleNewPick`은 고치지 않는다.
- [ ] **Step 6: `link-lines.tsx`의 `pointerover` 처리 맨 앞에 `if (isBoxDragActive()) return;`**(G10 — `ui/tooltip.tsx`와 같은 방식).
- [ ] **Step 7: CSS**(`components.css`, Order 끌기 규칙 옆이 아니라 Assign 원문 조각 규칙 옆에). 값은 토큰만 쓴다.
  - 들림(G9): `html:not([data-box-drag]):not([data-box-select]) .assign-panes .strip[data-drag-box]:hover`에 Order 줄과 같은 그림자(`0 0 0 1px var(--line-2), var(--shadow-1)`). 고른 조각(`data-sel`)·짝 카드의 테두리(`.strip::after`)와 겹쳐 두 겹으로 보이지 않는지 화면에서 잰다 — 겹치면 그 상태에서는 들림을 뺀다. `prefers-reduced-motion`에서는 transition 없음.
  - 끄는 동안(G10) `html[data-box-drag] .assign-panes` 아래에서 끄는 것: 조각 사이 틈의 벌어짐과 Join(`.strip-gap` — `pointer-events: none`), 조각의 Shape 단추·줄 끝 단추, New 줄의 호버 칩. 이 화면에서 `:hover`로 뜨는 것을 `grep`으로 전부 찾아 넣는다(목록을 커밋 메시지나 보고에 적는다).
  - 놓을 문장: 공통 `[data-drop="over"]` 테두리(2px `--accent`)가 `.new-line`에서 출처 칩·짝 카드 테두리를 덮지 않는지 잰다. 덮으면 `.new-line[data-drop]`에서 `outline-offset`만 고친다.
- [ ] **Step 8: 문구·도움말·사용 설명서.** 위 세 키를 en·ko에 넣는다. `assign-help.tsx`에 `assign.dragHelp`를 지금 짜임에 맞춰 한 줄 넣는다. 설명서는 `#assign-destination`(또는 쓴 문서의 문장에 잇는 대목)에 끌어서 잇기 한 문단 — 무엇을 어디에 놓는지, 놓아도 저장이 아니라는 것, Esc, 아직 쓰지 않은 문서와 옆 패널에는 아직 놓이지 않는다는 것 — 과, 선택으로 새 Unit을 만드는 대목("New unit from selection")에 "Assign의 Old 칸에서는 Alt를 누른 채 긁는다"를 넣는다. `#assign-keys`에 Alt 긁기와 Esc 취소를 더한다. `manual-content.test.ts`가 통과해야 한다(머리의 `version`은 PATCH라 그대로).
- [ ] **Step 9: 기존 스모크 단계 `assign: make a unit from a dragged selection, then undo`의 입력을 고친다** — 긁기 앞뒤로 `page.keyboard.down("Alt")`·`up("Alt")`. 기대값은 그대로.
- [ ] **Step 10: 초록을 본다.** `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, 갓 시드한 DB에서 전체 스모크(새 단계 PASS, Step 2의 기준선보다 실패가 늘지 않음), `next dev`를 내리고 `npm run build` 경고 0.
- [ ] **Step 11: 커밋** — `feat(assign): drag an Old piece onto a written New sentence to link it — Old 조각을 이미 쓴 New 문장에 끌어 잇기` (`PROGRESS.md` 포함)

---

### Task 3: 극단 자료·좁은 창 검토와 올리기 준비

**Files:**
- Modify(필요할 때만): Task 2의 CSS·`drag-link-line.ts`·`page.tsx`
- Modify: `frontend/package.json`·`package-lock.json`(1.1.6), `CHANGELOG.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-11-16-drag-and-drop-design.md`(§10의 2걸음에 "(v1.1.6으로 dev에 올렸다.)", 위 "이 계획이 정한 것" 여섯 가지를 §6에 "(내 판단)"으로 한 줄씩), `docs/README.md`(계획 문서 한 줄)

**Interfaces:**
- Consumes: Task 2의 화면.
- Produces: dev에 합칠 수 있는 브랜치(푸시·합치기는 조율하는 세션이 한다).

- [ ] **Step 1: 극단 자료로 다시 시드한다**(`seed_sop_worst`) — 창 폭 1120과 2560에서 Assign을 연다. 스크립트(`playwright-core` + 시스템 Chrome)로 재서 본다. 눈으로만 보지 않는다.
  - 1,800자 문단을 끌 때 `drag-card`의 높이가 한 줄(`getBoundingClientRect().height` ≤ 34px)이고 폭이 300px 이하다.
  - Unit 수천 개 문서에서 Old 조각을 끌어 New 칸 위를 40걸음 지나는 동안 `window.__commits` 증가 0.
  - Old 칸 아래 가장자리에 포인터를 두면 Old 칸이, New 칸 아래 가장자리에 두면 New 칸이 스스로 스크롤된다. Old 칸이 밀려 출발 조각이 화면 밖이면 점선이 사라진다(Review Focus 4).
  - 놓은 뒤 뜬 그 자리 메뉴가 창 폭 1120에서 화면 안에 있고 놓인 문장의 글을 덮지 않는다(지금 클릭으로 띄운 메뉴와 같은 자리인지 두 길을 재서 비교).
  - 들림 그림자·놓을 문장 테두리가 이웃 조각의 글·배지·출처 칩을 덮지 않는다(겹치는 px를 재고, 겹치면 고친다 — 보고만 하지 않는다).
- [ ] **Step 2: Review Focus 1~3을 스모크로 박는다**(Task 2의 새 단계에 덧붙인다): 끌기 뒤 Old 조각 두 번 누르기로 나눌 선이 선다. 놓은 직후 `aria-pressed`가 `true`로 남는다(뒤따르는 클릭이 뒤집지 않는다). 놓자마자 `j`로 다른 줄로 가면 잇기가 그 줄에 적용되지 않는다(`assign-link-menu` 없음, 옮겨 간 줄에 고른 New 문장 없음).
- [ ] **Step 3: 전체 검증.** 갓 시드한 DB(`seed_sop_demo`)에서 전체 스모크 → 다시 시드 → `pw-overlap-audit.mjs`, `DS=worst pw-layout-audit.mjs`, `pw-contrast-audit.mjs`(공용 부품 `paper.tsx`를 고쳤다). `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, `npm run build` 경고 0. backend는 손대지 않았으므로 `ruff`·pytest는 돌리지 않는다(바꾼 파일이 없음을 `git diff --stat origin/dev -- backend`로 확인).
- [ ] **Step 4: 버전과 기록.** `frontend/`에서 `npm version patch --no-git-tag-version` → 1.1.6. `CHANGELOG.md` `## Unreleased (dev)` 아래 `v1.1.6 — 2026-11-16` 항목(무엇이 되고 무엇이 아직 안 되는지, 알려진 한계). `PROGRESS.md`는 이 브랜치의 항목을 요약 하나로 줄인다. 설계 문서 §6·§10 갱신.
- [ ] **Step 5: 커밋** — `chore(release): v1.1.6, drag an Old piece onto a written New sentence — Old 조각을 끌어 잇기 (v1.1.6)`

---

## Self-Review 기록

- **설계 대비**: §6 표의 첫 줄(written 문서의 문장)만 이번 걸음이다 — 나머지 세 줄과 "자리 보내기"·거절 셋(N/A 칸, 문장 사이, 묶음 한가운데)은 놓을 자리가 3걸음에 생기므로 3걸음. "끄는 동안 초안 이음 선"·"놓은 뒤 Not saved yet"·"끌기가 꺼지는 때"는 Task 2. G1~G5·G8은 끌기 층이 이미 한다. G6·G7·G9·G10·G11·G13은 Task 2, G12는 Global Constraints와 Review Focus 1.
- **이번 걸음에 거절(끊긴 테두리 + 이유)은 없다.** 놓을 수 있거나(`ok`) 놓을 자리 밖(`none`)뿐이다 — 클릭으로 잇기를 막는 화면 규칙이 지금 없기 때문이다(`pickNewSentence`는 거절하지 않는다).
