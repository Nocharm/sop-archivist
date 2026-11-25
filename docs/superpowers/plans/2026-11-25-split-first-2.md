# 쪼개기 먼저 2 — Enter · 글쇠 · 같은 규칙 (스텝 2-2 · 3)

> **For agentic workers:** 차례 · 공용 이름 · 게이트 · 세우는 조건은 [색인](2026-11-25-split-first.md)이 먼저다. 이 파일은 일곱 브랜치의 작업만 적는다.

**Goal:** Enter가 늘 확정 단추가 되고 글쇠 목록이 한 곳에 모이며, 새로 올리는 문서는 Old든 New든 문단 · 언어별 박스와 같은 제외 규칙으로 쪼개진다.

**Architecture:** 화면 쪽은 React 없는 모델(`primary-model` · `assign-keymap` · `merge-arm-model` · `toc-block-model`)이 답을 정하고 `use-assign-page.tsx`의 `handleKey`는 읽기만 한다. 쓰기는 모두 앞 계획의 `enqueue`. 쪼개기는 `segment.py`에 규칙 번호로 얹고, 잡음 판정은 `noise.py` 순수 함수다. 규칙 1의 코드 길은 그대로 남는다.

**Spec:** [`2026-11-25-split-first-design.md`](../specs/2026-11-25-split-first-design.md) §6 S1 · §7 전부(G1–G21) · §11-1 · §13 · §14, [`2026-11-23-assign-feedback-2.md`](../specs/2026-11-23-assign-feedback-2.md) B1 · B2 · J1 · B3 · S3 · S4 · S5 · S7.

**Global Constraints:** 색인 파일.

**시작할 때 다시 볼 것** — `dev` `e704ddf8`을 읽고 썼다. 앞 계획이 바꾼 것(`AssignCommand` 꼴, `busy` 조기 return이 없어진 자리, `isDraftingOn()`, M 제거, `renderFolded` 덩어리)은 **그때 코드**를 따르고 줄 번호는 이름으로 다시 찾는다. `feat/split-rule-2`의 나눔 · R3의 본문 시작은 임시 사본에서 시제품으로 돌려 아래 G1–G21 기대값이 나오는 것을 확인했다(저장소에는 남기지 않았다).

**명령** — 프런트 `cd frontend && npx vitest run <파일>`, 백엔드 `cd backend && .venv/bin/python -m pytest <파일> -q`. 작업 끝마다 `npm run lint && npx tsc --noEmit -p tsconfig.json` 또는 `ruff check app/ tests/`. `(F)`는 "돌려서 적은 까닭으로 실패", `(P)`는 "같은 명령 통과".

---

## fix/assign-enter

**한 문장:** Enter는 포커스와 상관없이 오른쪽 칸 확정 단추이고, 마우스로 누른 오른쪽 칸 단추 뒤의 Space는 미리보기다 (S1 · B1-R1~R7).

**Files**
- Create: `frontend/src/lib/primary-model.ts` · `.test.ts`, `frontend/src/lib/assign-key-target.ts` · `.test.ts`
- Modify: `app/bundles/[id]/assign/use-assign-page.tsx`(`handlePrimary` 3367, `handleKey` 3391-3463, `pickRecommendation` 3545, 2516 · 2521의 포커스, `runSave` 1912 · `DecidePick`), `assign-side-panel.tsx`(66 `primaryState`, 489-505 확정 단추, 790 목차 칸의 단추), `page.tsx`(오른쪽 칸 감싼 요소), `components/assign/doc-dashboard.tsx:183` · `spot-panel.tsx:100`, `components/assign/space-preview.tsx:36`(층 판정), `lib/i18n-messages.ts`
- Test: 위 두 `.test.ts`, `backend/tests/test_sop_ai_adoption.py`

**Interfaces**
- Consumes: `enqueue(command: AssignCommand)`(확정 명령은 누른 순간의 destination · texts · suggestionId를 싣는다), `HIDDEN_AI_KINDS`가 이미 걸러진 `recommendations`, `buildUseDraft(rowLive, slots)`.
- Produces: `planPrimary(input: PrimaryInput): PrimaryPlan`(계획 3의 `resolveEnter(bar, primary)`가 감싼다), `readKeyPlace(target: EventTarget | null): KeyPlace`.

### T1 — 확정 단추의 뜻 `primary-model.ts`

```ts
export type PrimaryPlan =
  | { kind: "confirm"; from: "draft" | "card"; destination: Destination; cardIndex: number | null; isAiAsIs: boolean; tone: "normal" | "danger" }
  | { kind: "apply_order"; tableId: number }
  | { kind: "blocked"; reasonKey: string };
export interface PrimaryInput {
  canEdit: boolean; hasRow: boolean; destination: Destination | null; recommendations: readonly Recommendation[];
  blockKey: string | null;                 // confirmBlockKey · isRefGate · isCaptionGateOn의 까닭
  orderPreviewTableId: number | null;      // 고른 줄이 든 벗긴 표에 AI 순서 미리보기가 떠 있을 때만 그 표
}
export function planPrimary(input: PrimaryInput): PrimaryPlan;
```
- [ ] 시험(`primary-model.test.ts`): `it("prefers the AI order preview over everything else")` → `{ kind: "apply_order", tableId: 7 }`; `it("confirms the picked destination when there is one")` → `from: "draft", cardIndex: null`; `it("confirms the first Suggested card when nothing is picked")` → `from: "card", cardIndex: 0, destination: recommendations[0].destination`; `it("marks an AI first card as used as is")` → `isAiAsIs: true`; `it("is danger when the destination is delete")` → `tone: "danger"`; `it("is blocked with a reason when Suggested is empty")` → `{ kind: "blocked", reasonKey: "assign.primary.pickFirst" }`; `it("keeps the gate reason before the card")` → `blockKey`가 있으면 `{ kind: "blocked", reasonKey: blockKey }`; `it("is blocked for a read-only viewer or without a row")`. Nearby는 입력에 없다(B1-R2).
- [ ] `npx vitest run src/lib/primary-model.test.ts` (F: 모듈 없음) → 구현 → (P)
- [ ] `feat(assign): decide what the confirm button does in one place — 확정 단추가 할 일을 한 곳에서 정함`

### T2 — 누른 자리 `assign-key-target.ts`

```ts
export type KeyPlace = "typing" | "layer" | "pop" | "paper" | "side" | "other";
export function readKeyPlace(target: EventTarget | null): KeyPlace;
export function takesPrimaryEnter(place: KeyPlace): boolean;   // "paper" · "side" · 포커스 없음(body → "other"이지만 버튼이 아님)
export function isMousePress(event: { detail: number }): boolean;   // detail > 0
```
`layer` = `[role="dialog"]` · `[role="menu"]:not([data-link-menu])` · `[role="listbox"]` 안, `pop` = `.num-edit` · `.doc-dash` · `.spot-panel` · 알림(toast) 안의 단추(제 Enter를 갖는다), `paper` = `.pane-body` 안, `side` = `[data-testid="assign-inspector"]` 안.
- [ ] 시험(jsdom): `it.each` 열 줄 — `assign-near-…` 단추 → `side`, 용지의 접힌 묶음 단추 → `paper`, `.num-edit` 안 종류 단추 → `pop`, 알림의 Undo → `pop`, `textarea` → `typing`, 모달 안 단추 → `layer`, 위쪽 줄 거르기 단추 → `other`. `takesPrimaryEnter`는 `paper` · `side`만 참, `other`에서는 대상이 `button, a, [role=button], [role=option]`이 아닐 때만.
- [ ] (F) → 구현 → (P) → `feat(assign): tell where a key was pressed — 글쇠를 누른 자리를 가림`

### T3 — 배선

- [ ] 시험 `primary-model.test.ts`에 더함: `describePrimary(plan, label): { labelKey, values, suffixKey, tone }` — `it("labels Confirm with the place, the AI suffix and Delete")`: `assign.primary.confirmTo` `{ place: "§4.2" }` + `assign.primary.aiAsIs`, 삭제 → `assign.primary.delete` + `danger`, 순서 → `assign.primary.applyOrder`, 막힘 → `classify.confirm`. 문구(en / ko): `Confirm → {place}` / `확정 → {place}`, `· ✦ AI as is` / `· ✦ AI 그대로`, `Delete` / `삭제`, `Apply AI order` / `AI 순서 적용`, `Pick a destination first` / `보낼 곳을 먼저 고르세요`.
- [ ] (F) → 구현: ① 확정 단추는 `describePrimary`의 이름 · 색(`btn danger` 톤은 있는 토큰), `data-state`는 `confirm | save | choose | order | blocked`(앞 셋 값은 그대로 둔다 — 스모크가 읽는다), 막힘이면 `aria-disabled` + 까닭 툴팁. ② `handlePrimary()`는 `planPrimary` 결과만 따른다: `confirm/card`는 AI면 `buildUseDraft`의 `texts` + `suggestionId`를 **명령에 실어** `enqueue`(초안을 거치지 않는다, B1-R3), `apply_order`는 `unwrapAi.onApply`, `blocked`는 알림 + 보낼 곳 목록에 `data-nudge`(기존 강조 클래스). "첫 카드로 포커스만"(3369-3371)은 지운다(B1-R7). ③ `handleKey`의 3431행을 `takesPrimaryEnter(readKeyPlace(event.target))`로 바꾸고 Enter는 3408행 짝 고르기 다음, Space는 지금처럼 단추가 받는다. Esc는 순서 미리보기 중이면 `unwrapAi.onKeep`을 먼저. ④ 오른쪽 칸 감싼 요소의 `onClick`(이펙트 없이)에서 `isMousePress`이고 글 칸 · 메뉴 단추가 아니면 `requestAnimationFrame`으로 Old `.pane-body`(`tabIndex={-1}` 더함)에 `focus({ preventScroll: true })`. `pickRecommendation` · 2516 · 2521의 "Confirm으로 포커스"는 **키보드로 불린 때만** 남긴다. ⑤ `doc-dashboard` · `spot-panel`의 `role="dialog"` → `role="group"`(B1-R6).
- [ ] (P) + `npx vitest run src/components src/lib/assign-focus-model.test.ts` → `fix(assign): Enter is always the confirm button and Space previews after a mouse press — Enter는 늘 확정, 마우스로 누른 뒤 Space는 미리보기`

### T4 — AI 첫 카드 Enter의 기록 (backend, B1-T2)

고친 글 · 그대로의 기록은 `test_sop_ai_adoption.py:380 · 394`가 이미 본다. 숨긴 뒤에도 남는 AI(잇기 제안 `match_plan`)만 더한다.
- [ ] 시험 `test_sop_ai_adoption.py::test_confirming_a_planned_link_with_its_suggestion_id_records_as_is`: 계획이 낸 잇기 제안이 있는 줄을 `save_group`(확정, 대상 = 제안의 New 문장, `suggestion_id`)으로 저장 → 그 제안 `adoption == "as_is"`; `suggestion_id` 없이 같은 자리로 저장 → `as_is`가 아님(`judge_unused_suggestions`). 준비는 `test_sop_ai_accept.py:267`의 것을 쓴다.
- [ ] `pytest tests/test_sop_ai_adoption.py -q -k planned_link` — 서버는 이미 이렇게 하므로 **처음부터 통과해야 한다**(실패하면 멈추고 보고, 화면 쪽 가정이 틀린 것) → `test(ai): pin adoption when Enter confirms a planned link — Enter로 확정한 잇기 제안의 채택 기록을 못박음`

**스모크** — 새 단계 `assign: enter`(S3): 나무 잎 누른 직후 Enter 확정(AC1), 대시보드를 올린 채 `j` → `Enter`(AC2), AI 첫 카드 Enter가 `suggestion_id`를 실음(AC3), 첫 카드 삭제의 `.danger` 이름(AC4), 빈 Suggested에서 Enter = 알림 · 요청 0(AC5), 순서 미리보기 중 이름 · Esc, 카드를 마우스로 누른 뒤 Space → 미리보기가 열림. 따라 바뀌는 줄(§14에 줄 번호 없음, "동작이 바뀌어 따라" — 같은 수): `smoke/assign.mjs:434` · `2039` · `6328` · `6390`(포커스 = Confirm → `[data-testid="assign-primary"][data-state="confirm"]`를 기다림), `3085`(용지의 묶음 단추는 Enter 대신 `Space` — B1-R1).
**설명서** `#assign-confirm` 534-544, `#assign-keys` 779(↵), `#assign-destination` 461 끝 문장("↵는 목록의 첫 후보로 갑니다") · `#keys` Assign 행. `docs/qa/feature-map.md:22`.
**CHANGELOG** `Enter는 어디에 포커스가 있어도 확정 단추입니다 — 고른 곳이 없으면 추천 첫 카드로 바로 확정하고, 단추에 갈 곳이 보입니다. 오른쪽 칸 단추를 마우스로 누른 뒤 Space는 미리보기입니다.`
**세워 둘 조건** ① 확정 명령이 초안을 거치지 않고는 `texts`를 못 싣는다(`AssignCommand`에 칸이 없고 더하면 큐의 시험이 깨진다). ② T4가 빨갛다. ③ 이펙트 기준선이 는다. ④ 캡션 · 참조 막음(`isCaptionGateOn` · `isRefGate`)을 카드 확정이 건너뛴다.

---

## feat/assign-keymap

**한 문장:** 글쇠 목록을 `ASSIGN_KEYS` 하나로 모아 키 처리 · 도움말 · 메뉴 글쇠 표시 · 설명서 대조가 함께 읽는다 (B2, §11-1의 ⇧D · E 제외).

**Files**
- Create: `frontend/src/lib/assign-keymap.ts` · `.test.ts`, `frontend/src/lib/part-history.ts` · `.test.ts`
- Modify: `use-assign-page.tsx`(`handleKey`, 3465 keydown 이펙트, 709 `manualPart`, 1116 `goToUnit`), `page.tsx:623-650`, `components/paper/paper.tsx`(`numberEdit` 333, `onIndent` 957), `components/assign/assign-help.tsx`, `assign-context-menu.tsx:66` `KEYS`, `assign-side-panel.tsx:511,516`, `lib/i18n-messages.ts`, `docs/qa/feature-map.md:22`
- Test: 위 `.test.ts`, `lib/manual-content.test.ts`(굵은 라벨)

**Interfaces**
- Consumes: `planPrimary` · `readKeyPlace`(앞 브랜치), `isDraftingOn()`, `switchShapeMode` 1560, `rewrap` · `runCtx("table_layout")`, `unwrapAi.onAsk`, `setRemarkEdit`.
- Produces: `ASSIGN_KEYS: readonly AssignKey[]`, `findAssignKey(event)`, `formatAssignKey(id): string`. 뒤 브랜치는 이 배열에 **줄만 더한다**.

| 나중에 더하는 글쇠 | 더하는 브랜치 |
|---|---|
| `⇧J` `⇧K` (`merge_next` · `merge_prev`) | `feat/assign-merge-keys` |
| `⇧U` · `⇧R`, 삭제된 줄에서의 `U` · `R` | `feat/split-front-matter` |
| `⇧G` · 표 탭의 `Ctrl+←→` | `feat/assign-multi-pick` · `feat/assign-tables-tab` |
| `⇧S` | `feat/split-by-sentence` |

### T1 — 목록과 찾기

```ts
export type AssignKeyWhen = "always" | "row" | "cut" | "pair" | "text" | "shape" | "number" | "ai" | "unwrapped" | "table" | "box";
export interface AssignKey { id: AssignKeyId; key: string; shift: boolean; when: AssignKeyWhen; labelKey: string }
export type KeyHit = { kind: "run"; entry: AssignKey } | { kind: "hint"; entry: AssignKey };
export function findAssignKey(event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">): KeyHit | null;
export function formatAssignKey(id: AssignKeyId): string;      // "⇧H" · "Del · ⌫" · "Ctrl+→"
```
`key`는 `event.key.toLowerCase()`, Ctrl 조합은 `"ctrl+arrowright"` 꼴(Ctrl 또는 ⌘), 같은 일의 글쇠는 같은 `id`로 줄을 나눈다. 줄: move_next `j` · `arrowdown`, move_prev `k` · `arrowup`, confirm `enter`, escape `escape`, delete `delete` · `backspace`, clear `u`, remark `r`(when `row`), split `s`, cut_left `arrowleft`, cut_right `arrowright`, view `v`, preview `" "`(Space, 처리는 `SpacePreview`), go_pair `g`, hold `⇧h`, lang `⇧l`, shape_mode `⇧p`, number `⇧n`, use_ai `⇧a`, ask_order `⇧o`, table `⇧t`, indent `tab`, outdent `⇧tab`, part_prev `ctrl+arrowleft`, part_next `ctrl+arrowright`, undo `ctrl+z`, redo `ctrl+⇧z`, help `⇧?`. E는 목록에 없고 `isDraftingOn()`일 때만 지금 `startEdit()`가 산다.
- [ ] 시험: `it("needs Shift for Shift keys and hints without it")` — `{key:"h"}` → `{kind:"hint", entry.id:"hold"}`, `{key:"H", shiftKey:true}` → `run`; `it("does not run a plain key with Shift held")` — Shift+V · Shift+Del → `null`; `it("has no M, E or Shift+D")`; `it("has no duplicate key and shift")`; `it("reads Ctrl and Cmd the same")`.
- [ ] (F) → 구현 → (P) → `feat(assign): list every Assign key in one table — Assign 글쇠를 표 하나로`

### T2 — 표대로 움직이기

- [ ] 시험 `it.each` — 순수 `resolveAssignKey(entry, ctx): { run: AssignKeyId } | { refuseKey: string }`, `ctx = { hasRow, canEdit, hasCut, hasPair, isText, shapeMode, hasNumberCell, hasAi, unwrappedTableId, tableId, isLocked }`: ⇧O가 벗긴 표 밖 → `assign.key.why.notUnwrapped`, ⇧T가 표 밖 → `assign.key.why.notTable`, G 짝 없음 → `assign.key.why.noPair`, ⇧N 번호 칸 없음 → `assign.key.why.noNumber`, ⇧A 제안 없음 → `assign.key.why.noAi`, ⇧P 전환 불가 → 그 까닭 키(`shapeMode.reasonKey`), 되는 때는 `run`.
- [ ] (F) → 구현: `handleKey`의 `else if (key === …)` 사슬(3436-3460)을 `findAssignKey` + `resolveAssignKey` + `switch(id)`로. `hint`는 짧은 알림 `t("assign.key.hint", { key, label })`(en `{key}: {label}`). H → ⇧H, A → ⇧A. ⇧A는 `recommendations` 가운데 AI(남는 잇기)만. ⇧L은 `changeLanguage`(1752)의 지금 길(짝이면 모양 전환). ⇧N은 `Paper`에 `numberOpenRequest: { unitId: number; seq: number } | null`을 주고 렌더 중 상태 맞추기로 연다(이펙트 없음). ⇧T는 표 안이면 `table_layout`, 벗긴 표 줄이면 `rewrap.onBack`. Tab · ⇧Tab은 `readKeyPlace`가 `paper`이고 고른 박스가 있을 때만 `preventDefault`하고 번호 칸 ◀▶와 같은 함수(연속 번호 = `stepNumber`로 `set_number`, 그 밖 = `planIndent` → `set_indents`)를 부른다 — `Paper`가 `requestIndent(unitId, delta)`를 `numberCell` 옆 콜백 하나로 내놓는다. `R`은 보통 Old 줄에서 `setRemarkEdit({ kind: "row", need: null, then: null })`.
- [ ] (P) → `feat(assign): run keys from the table, Shift for changes — 글쇠를 표에서 읽고 바꾸는 일은 Shift`

### T3 — 탭 순환과 뒤로 가기 (B2-R6 · R7)

```ts
export function stepPart(keys: readonly PaperTabKey[], active: PaperTabKey, delta: -1 | 1): PaperTabKey;   // 순환
export function readPartState(state: unknown): PaperTabKey | null;          // history.state.assignPart
export function withPartState(state: unknown, part: PaperTabKey): object;   // Next가 넣은 칸을 그대로 두고 한 칸만 더한다
```
- [ ] 시험: `it("cycles over the tabs that exist")`, `it("keeps Next's own history state")`(`{ __NA: true, x: 1 }` → 칸 보존), `it("ignores a state without a part")`.
- [ ] (F) → 구현: 탭을 누르거나 Ctrl+←→로 바꿀 때 지금 항목을 `replaceState(withPartState(history.state, 지금 탭))`로 적고 `pushState(withPartState(history.state, 새 탭), "")`(주소는 그대로). `popstate`는 **3465행 keydown 이펙트 안에서** 함께 달고 뗀다(기준선 그대로) — 상태에 탭이 있으면 그 탭, 없으면 아무것도 하지 않아 원래 뒤로 가기. 문서를 바꾸는 이동은 항목을 더하지 않는다.
- [ ] (P) → `feat(assign): cycle tabs with Ctrl arrows and go back through them — Ctrl 화살표로 탭을 돌고 뒤로 가기로 되돌아감`

### T4 — 도움말 · 메뉴 · 설명서가 같은 목록을 읽는다 (B2-R2)

- [ ] 시험 `it("the help panel, the manual and the list agree")`: 설명서 `#assign-keys` 표 첫 칸의 `<kbd>` 묶음을 글쇠로 바꾼 집합 == `ASSIGN_KEYS` ∪ `HELP_ONLY`(끌기 · 휠 · Shift/Ctrl+누르기 · Shift+F10 · 그 자리 메뉴 화살표). 어긋나면 메시지에 "설명서 `#assign-keys`에 <글쇠> 줄을 더하거나 `assign-keymap.ts`에서 빼세요". `it("every key id has an en and ko label")`.
- [ ] (F: H · A · M · G … 어긋남) → 구현: `assign-help.tsx`의 `keys`를 `ASSIGN_KEYS`(id마다 한 줄) + `HELP_ONLY`로, `KEYS`(66) · 확정 · 보류 · 배정 취소 단추의 `<kbd>`를 `formatAssignKey`로, `?`가 도움말 열기. 설명서 세 절(`#assign-keys` 772, `#split-keys` 404, `#keys` 1200)을 새 표로. → (P)
- [ ] `feat(assign): help panel and manual follow the key table — 도움말과 설명서를 글쇠 표에 맞춤`

**스모크** — 새 단계 `assign: keys`(S4): H → 보류 안 됨 + 힌트, ⇧H → Remark 창, Tab/⇧Tab → `set_indents`(번호 칸 ▶와 같은 값), Ctrl+→ 다음 탭 → 뒤로 가기 이전 탭 → 한 번 더 뒤로 가기는 이전 화면, G, `?`, M 아무 일 없음, `R`이 Remark 창. 따라 바뀌는 줄(§14 "이름이 없는 것" — 아래 목록을 승인 목록에 올림): `assign.mjs:541` `h` → `Shift+H`, `2811` · `8167` `a` → `Shift+A`. `459`(kbd 8개 이상)는 그대로. `500` · `762` `e`는 계획 1의 drafting 스모크로 이미 옮겨 있다.
**설명서** 위 세 절 + `#assign-confirm`의 보류 글쇠, `#split-edit`의 들여쓰기. **feature-map** Assign 행.
**CHANGELOG** `글쇠가 바뀌었습니다 — 보류 H → ⇧H, AI 추천 받기 A → ⇧A, 다른 문서로 이동 M은 없앰. 새 글쇠: G 짝으로 가기, ⇧L 언어, ⇧P 한 문장/짝, ⇧N 번호, ⇧O AI 순서, ⇧T 표 벗기기, R Remark, Tab 들여쓰기, Ctrl+←→ 탭, 뒤로 가기는 이전 탭.`
**세워 둘 조건** ① Next가 `popstate`에서 화면을 다시 불러오거나 `pushState` 뒤 주소 · 검색 값이 바뀐다(스모크로 확인, 우회를 새로 만들지 않는다). ② 이펙트 기준선이 는다. ③ `handleKey` 사슬을 옮기며 엮은 문서(숨김) 키 동작 시험이 깨진다.

---

## feat/assign-merge-keys

**한 문장:** ⇧J ⇧J · ⇧K ⇧K로 아래 · 위 박스와 합치거나 짝을 맺는다 (J1, Old · New 같음).

**Files**: Create `frontend/src/lib/merge-arm-model.ts` · `.test.ts`. Modify `lib/assign-keymap.ts`(줄 둘), `use-assign-page.tsx`(`planOldJoin` 1832 · `joinOld` 1836 · `handleKey` 머리 · 누르기 처리), `components/paper/paper.tsx`(점선 표시 · 안내 띠), `lib/i18n-messages.ts`. Test `merge-arm-model.test.ts`, `assign-keymap.test.ts`.
**Interfaces** — Consumes `planJoin`(`lib/split-menu-model.ts:28`), `getMergeBlocker`, `enqueue`(합치기 · 짝은 장벽). Produces `MergeArm`.

### T1 — 무장 모델

```ts
export interface MergeArm { fromId: number; toId: number; dir: 1 | -1; kind: JoinKind }
export type ArmEvent = { type: "key"; dir: 1 | -1; fromId: number; toId: number | null; plan: JoinPlan } | { type: "other" };
export type ArmResult = { arm: MergeArm | null; run: MergeArm | null; refuseKey: string | null };
export function stepMergeArm(arm: MergeArm | null, event: ArmEvent): ArmResult;
export function findJoinNeighbor(order: readonly number[], unitId: number, dir: 1 | -1): number | null;
```
- [ ] 시험: `it("arms on the first press and saves nothing")`, `it("runs on the same key again")`(`run.kind === "merge"` / 다른 언어면 `"pair"`), `it("refuses with the plan's reason and does not arm")`(`split.noMergeToc`), `it("re-arms the other way on the other key")`(⇧J 뒤 ⇧K = 해제하고 위로 무장), `it("disarms on any other key, click or Escape")`, `it("refuses at the edge with noNeighbor")`(`assign.ctx.why.noNeighbor`).
- [ ] (F) → 구현 → (P) → `feat(assign): model the two-press merge — 두 번 눌러 합치기 모델`

### T2 — 배선

- [ ] 시험 `assign-keymap.test.ts`: `it("has Shift+J and Shift+K for merging and they are not J/K")`.
- [ ] (F) → 구현: 글쇠 줄 `merge_next ⇧j` · `merge_prev ⇧k`(when `box`). 무장 중 `handleKey` 첫머리에서 Esc는 무장만 거두고(다른 Esc보다 먼저), 다른 글쇠 · 누르기는 해제한 뒤 제 일을 한다. 이웃은 그 쪽 용지 순서(Old 한 단 · New 한 단). 실행은 `joinOld`의 길(`merge` 또는 짝)을 `enqueue`로, `confirm_required`는 지금 확인창. 안내 띠 `assign-merge-armed`: en `Press ⇧J again to merge · Esc to cancel` / ko `한 번 더 ⇧J로 합치기 · Esc 취소`, 짝이면 `… to pair` / `… 짝 맺기`(⇧K도 같은 꼴), 두 박스에 `data-merge-arm`(새 CSS 선택자, 점선).
- [ ] (P) → `feat(assign): merge with Shift+J and Shift+K pressed twice — ⇧J ⇧J · ⇧K ⇧K 합치기`

**스모크** 새 단계 `assign: merge keys`(S5 네 변형 + AC2 뒤 Del은 합친 박스). 바꾸는 줄 없음.
**설명서** `#split-pair` 372(틈 **Join** 384행) · `#assign-keys` · `#split-keys`. **CHANGELOG** `⇧J를 두 번 누르면 아래 박스와, ⇧K를 두 번 누르면 위 박스와 합칩니다(다른 언어면 짝).`
**세워 둘 조건** 짝 카드 구성원의 이웃이 용지 순서와 다르게 보여(떨어진 짝) 어느 박스가 "아래"인지 화면과 모델이 갈린다.

---

## feat/number-cell-buttons

**한 문장:** 번호 칸 창에 취소 · 확인 단추를 둔다 (B3, Old · New 같음).

**Files**: Modify `frontend/src/components/paper/number-cell.tsx`(`save` 226, 창 357-395), `lib/number-model.ts`(판정 하나), `lib/i18n-messages.ts`, `styles/components.css`(새 선택자). Test `lib/number-model.test.ts`, Create `components/paper/number-cell.test.ts`.
**Interfaces** — Produces `getNumberSaveBlock(edit: { kind: NumberKind; text: string }): string | null`.

### T1
- [ ] 시험: `it("blocks saving an empty number with a reason")` → `assign.number.typeFirst`; 공백만도 같음; `bullet` · `none`은 `null`. 컴포넌트(`renderToStaticMarkup`): `it("shows Cancel and OK under an input kind")` — `number-cell-cancel` · `number-cell-ok`가 있고 빈 글이면 OK에 `aria-disabled="true"`, 점 기호 창에는 둘 다 없음(즉시 저장, B3-R4).
- [ ] `npx vitest run src/lib/number-model.test.ts src/components/paper/number-cell.test.ts` (F) → 구현: 확인 = `save()` 그대로(Enter와 한 길), 취소 = `onEditChange(null)`, 글자 크기 · 단추 꼴은 있는 `btn`, 빈 입력의 Enter도 같은 까닭을 알린다. 바깥 누르기는 지금대로 저장 없이 닫힘. 문구 en `OK` · `Cancel` · `Type a number` / ko `확인` · `취소` · `번호를 적으세요`.
- [ ] (P) → `feat(number): OK and Cancel in the number box — 번호 칸 창에 확인 · 취소`

**스모크** `assign.mjs:4187-4468`(§14 승인 — 11-23 명세 B3): `4194` Enter 길 뒤에 같은 값을 **확인 누르기**로 한 번 더(단계 하나 더함), 빈 입력 → 확인 꺼짐, 취소 = Escape(4201-4206 옆). 있는 단계는 그대로.
**설명서** `#assign-number` 589-596(확인 · 취소). **CHANGELOG** `번호 칸 창에 확인 · 취소 단추가 생겼습니다.`
**세워 둘 조건** 좁은 폭에서 창이 화면 밖으로 나간다(자리 셈을 새로 만들지 않고 보고).

---

## feat/split-rule-2

**한 문장:** 새로 올리는 문서는 문단 · 언어별 박스(규칙 2)로 쪼개고, 이미 올린 문서는 편집까지 규칙 1 그대로다 (R0 · R1 · R2).

**Files**
- Create: `backend/tests/split_golden/__init__.py` · `builder.py` · `G01.json` … `G21.json`, `backend/tests/test_sop_split_golden.py`, `backend/alembic/versions/<다음>_split_rule.py`
- Modify: `app/sop/segment.py`(상수, `detect_language` 208 뒤 새 함수, `build_unit_drafts` 350), `app/sop/units.py`(`create_initial_units` 83, `_build_unit_rows` 163), `app/sop/editing.py`(`_build_sentence_drafts` 983, `_build_band_drafts` 1483), `app/sop/doc_meta.py:89`, `app/sop/ingest.py:129 · 213`, `app/sop/refs.py:43-60`, `app/sop/models.py:253`, `scripts/measure_extraction.py`
- Test: `tests/test_sop_segment.py` · `test_sop_doc_meta.py` · `test_sop_heading_sentence.py` · `test_sop_band.py` · `test_migrations.py`

**Interfaces** — Produces `RULE_LEGACY = 1` · `RULE_PARAGRAPH = 2`, `split_paragraph`, `split_block_text`, `extractions.split_rule`.

**Alembic** (head에서 이어 더하기만): `extractions.split_rule` `sa.Integer(), nullable=False, server_default="1"`. 모델 `split_rule: Mapped[int] = mapped_column(Integer, default=RULE_LEGACY, server_default="1")`. 기존 행은 1, `_write_extraction`만 `ingest.NEW_SPLIT_RULE`(= `RULE_PARAGRAPH`)을 적는다.

### T1 — 정답 문서 먼저 (R1, 첫 커밋)

`builder.py`:
```python
STYLES: str                                   # heading 1–3(Heading1–3) · toc 1(TOC1)
def h(text: str, level: int = 1) -> str       # 제목 스타일 문단
def lines(*parts: str, style: str | None = None) -> str      # 한 문단 안 Shift+Enter(<w:br/>) 줄
def cell(*paragraphs: str) -> str             # 칸 안 문단 여럿(make_row에 XML로 넣는다)
@dataclass(frozen=True)
class Case: key: str; format: Literal["docx", "pdf"]; build: Callable[[], bytes]
CASES: dict[str, Case]                        # "G01" … "G21"
def read_boxes(view: dict) -> list[dict]      # 본문 활성 Unit을 용지 순으로 → 아래 스키마의 줄
```
기대 JSON: `{"shape": "한 줄 설명", "layout": "ko_en_interleaved" | null, "boxes": [{"text", "lang", "kind", "number", "excluded"}]}`. `kind`는 `sentence|heading|cell_sentence|table|caption|figure`, `number`는 번호 칸 값(`unit.number.value`)이나 `null`, `excluded`는 `null|"toc"|"front"|"history"`. 표 단위는 `text: ""`, `lang: "neutral"`. `layout`이 `null`이면 배치를 보지 않는다. 앞에 자동 문서가 없도록 파일마다 `SYNTHETIC_` 이름, New는 같은 본문에 쓰지 않는 스타일 하나를 더해 바이트를 다르게 한다(같은 묶음 `duplicate_file`).

- [ ] 시험 `test_sop_split_golden.py`(`@pytest.mark.usefixtures("clean_sop")`): `test_boxes_match_the_answer[G01-old]` … `[G21-new]`(42개) — `read_boxes(get_view(...)) == expected["boxes"]`, `layout`이 있으면 `view["document"]["language_layout"]`도; `test_old_and_new_give_the_same_boxes[G01]` …; `test_every_shape_has_an_answer`(CASES 열쇠 == JSON 파일 == G01–G21). 아직 못 맞는 것은 `PENDING: dict[str, frozenset[str]]`("R2" · "R3" · "R4"마다 `G01-old` 꼴 이름)로 `pytest.param(..., marks=pytest.mark.xfail(strict=True))` — **각 브랜치가 제 이름을 빼며 끝난다**. 첫 커밋의 R2 몫(지금 규칙으로 실패 확인): G01 · G02 · G03(배치) · G04 · G06 · G07 · G08 · G09 · G11-old · G18 · G19 · G21, R3 몫: G14 · G15 · G16, R4 몫: G11-new · G13-new. G05 · G10 · G12 · G13-old · G17 · G20은 처음부터 통과.
- [ ] `pytest tests/test_sop_split_golden.py -q` → xfail만 있고 xpass · fail 0 → 커밋 `test(split): golden documents for every paragraph shape — 문단 꼴별 정답 문서`

**입력과 기대** (`/`는 Shift+Enter, `¶`는 문단 사이, `H1` 제목. 기대는 `글(언어)` — 제목 `5. 절차`(ko · heading · 번호 `5.`)가 맨 앞에 있는 것은 † 표시로 줄임)

| # | 입력 | 기대 박스(번호는 있는 것만) |
|---|---|---|
| G1† | `5.1 탱크를 비운다. 밸브를 닫는다. 잔량을 기록한다.` | 그 글 전체(ko, `5.1`) 1 |
| G2† | `탱크를 비운다. 밸브를 닫는다. Drain the tank completely. Close the outlet valve.` | `탱크를 비운다. 밸브를 닫는다.`(ko) · `Drain the tank completely. Close the outlet valve.`(en) |
| G3† | `탱크를 비운다. Drain the tank completely. 밸브를 닫는다. Close the outlet valve.` | 넷(ko · en · ko · en), layout `ko_en_interleaved` |
| G4† | `탱크를 비우고 / 잔량을 확인한다. / 결과를 기록한다.` | `탱크를 비우고 잔량을 확인한다. 결과를 기록한다.`(ko) 1 |
| G5† | `다음 순서로 준비한다. / 1) 전원을 켠다. / 2) 압력을 확인한다. / • 장갑을 낀다. / 가. 기록지를 준비한다.` | 줄마다 5(번호 칸은 모두 `null`) |
| G6† | `5.1 탱크를 비운다. 밸브를 닫는다.` ¶ `작업이 끝나면 기록한다. 서명한다.` | 문단마다 2(첫째 `5.1`) |
| G7† | `Biosafety Cabinet(BSC-01)의 HEPA filter를 확인한다. SOP-QC-0012에 따라 pH meter를 교정한다.` | 1(ko) |
| G8† | `세척액을 준비한다. Buffer A. 탱크에 넣는다.` ¶ `희석액을 준비한다. Buffer A.` | 문단마다 1(ko) |
| G9† | 표 `항목`\|`내용` / `세척`\|칸 안 문단 셋 `탱크를 비운다. 물을 채운다.` `밸브를 닫는다.` `결과를 기록한다.` | 표 + 칸 문장 `항목` `내용` `세척` 그리고 문단마다 3 |
| G10† | 표 `항목`\|`내용` / `온도 / Temperature`\|`탱크를 비운다. / Drain it.` | 표 + `항목` `내용` `온도`(ko) `Temperature`(en) `탱크를 비운다.`(ko) `Drain it.`(en) — 줄이 갈리면 낱말 셋 예외를 쓰지 않는다 |
| G11† | H2 `5.1 배출 밸브를 모두 닫는다. 닫힌 것을 확인한다. Close all drain valves. Confirm that they are closed.` | sentence `5.1 배출 밸브를 모두 닫는다. 닫힌 것을 확인한다.`(ko, `5.1`) · `Close all drain valves. Confirm that they are closed.`(en) |
| G12† | H2 `5.2 Pre-cleaning` ¶ `탱크를 비운다.` | heading(en, `5.2`) · sentence |
| G13 | 띠 표 `5`\|``\|`절차` ¶ `탱크를 비운다.` ¶ 띠 표 `5.1`\|``\|`준비` ¶ `밸브를 닫는다.` | heading `5 절차`(`5`) · sentence · heading `5.1 준비`(`5.1`) · sentence |
| G14 | `합성 표준 절차서` ¶ 표(`문서 번호`\|`SOP-QC-0001` / `제목`\|`합성 세척 절차`) ¶ 표(`작성`\|`검토`\|`승인` / `2026-01-02`\|`2026-01-03`\|`2026-01-04`) ¶ H1 `Summary of Changes` ¶ 표(`개정`\|`내용` / `1`\|`1. 처음 만듦`) ¶ `목차` ¶ TOC1 `1. 목적 ........ 3` · `2. 범위 ........ 3` ¶ H1 `1. 목적` ¶ `탱크 세척 방법을 정한다.` ¶ H1 `2. 범위` ¶ `합성 공정에 적용한다.` | TOC1 둘은 `toc`, 그 밖 `1. 목적` 앞 본문 줄(표 · 칸 · 제목 포함)은 모두 `front`(번호 `null`), `1. 목적`부터 `null`(칸 글 `1. 처음 만듦`은 표 안이라 시작이 아니다) |
| G15 | 한글 반쪽(`합성 표준 절차서` ¶ 표 `승인`\|`홍보팀` ¶ TOC1 둘 ¶ H1 `1. 목적` ¶ 문장 ¶ H1 `2. 범위` ¶ 문장 ¶ `첨부 1 기록지` ¶ 표 `항목`\|`값` / `온도`\|`측정`) ¶ 영어 반쪽(`Synthetic Standard Procedure` ¶ 표 `Approved`\|`Synthetic team` ¶ TOC1 `1. Purpose ........ 3` `2. Scope ........ 3` ¶ H1 `1. Purpose` ¶ `This procedure defines how to clean the tank.` ¶ H1 `2. Scope` ¶ `It applies to the synthetic process.`) | 두 반쪽 앞만 `front`(TOC1은 `toc`), 한글 첨부 문단과 그 표는 `null`, layout `ko_en_separate` |
| G16 | H1 `1. 목적` ¶ `탱크 세척 방법을 정한다.` ¶ H1 `9. Document Change History` ¶ `개정 내용을 적는다.` ¶ 표 `Rev`\|`Change` / `01`\|`New document` ¶ H1 `10. 첨부` ¶ `기록지를 붙인다.` | 제목 9 · 그 문장 · 표와 칸 넷 `history`, 나머지 `null` |
| G17 | `합성 안내문` ¶ 표 `작성`\|`검토` ¶ H1 `2. 범위` ¶ `합성 공정에 적용한다.` ¶ H1 `개정 이력` ¶ `처음 만들었다.` | 모두 `null`(1장이 없으면 개정 이력도 잡지 않는다) |
| G18 | PDF 한 블록 `The operator drains the tank and then closes` / `the outlet valve of the cleaning line. Record` / `0.8 bar as the target pressure.` | 1(en) — `0.8`은 번호 줄이 아니다 |
| G19 | 문단 넷 `합성 절차 n를 시작한다. Start the synthetic step n now.`(n = 1..4) | 문단마다 ko · en, layout `ko_en_interleaved` |
| G20 | H1 `3. Reference` ¶ `SOP-QC-0012 시료 채취 절차 / SOP-QC-0013 세척 절차 / ISO 9001:2015` ¶ H1 `4. 책임` ¶ `담당자가 확인한다.` | 참조 줄 셋 `lang: "ref"`, 나머지 보통 |
| G21 | PDF 한 블록 `5.1 Drain the tank completely. Close the valve.` / `5.2 Rinse the tank with purified water and` / `wait for 10 minutes.` / `5.3 Record the result.` | 셋 — `5.2`는 접힌 줄까지 하나(번호 칸은 PDF라 `null`) |

### T2 — 규칙 번호 (R0)

- [ ] 시험: `test_migrations.py::test_split_rule_defaults_to_the_legacy_rule`(앞 리비전의 `extractions` 행 → 올린 뒤 1); `test_sop_split_golden.py::test_new_uploads_record_rule_2`(`run_in_session`으로 `Extraction.split_rule == 2`); `test_models_match_migrations` 통과.
- [ ] (F: 열 없음) → 구현: 모델 · 리비전 · `ingest.NEW_SPLIT_RULE: int = RULE_PARAGRAPH`를 `_write_extraction`이 적는다. 상수는 `segment.py`(모델이 import, 순환 없음). 아직 아무도 읽지 않는다.
- [ ] (P) → `feat(split): record which split rule an extraction used — 추출마다 쪼개기 규칙 번호를 남김`

### T3 — 나눔 함수 (R2-1~5)

```python
SHORT_ENGLISH_WORDS = 3     # 한글 사이 · 끝의 영어 덩어리가 이보다 적은 낱말이면 앞 한글에 잇는다(합성 자료 값 — 실제 SOP 뒤 다시 정한다)
def find_marker_lines(text: str, *, split_lines: bool) -> list[int]      # 번호 · 글머리 · 문서 번호로 시작하는 줄의 시작 자리(첫 줄 제외)
def split_paragraph(text: str, *, split_lines: bool = False, paras: Sequence[int] = (), kept: Collection[int] = ()) -> list[tuple[int, int]]
def split_block_text(text: str, *, rule: int, split_lines: bool, paras: Sequence[int] = (), kept: Collection[int] = ()) -> list[tuple[int, int]]   # 규칙 1이면 split_sentences 그대로
```
다시 잇기(이 함수만 몸통을 적는다):
```
cuts = sorted({0, len(text)} ∪ find_marker_lines(text) ∪ {p in paras, 0 < p < len})
for a, b in pairs(cuts):                          # 마디 = 바깥 경계 안
    pieces = split_sentences(text[a:b], split_lines=split_lines) + a
    runs = []                                     # [start, end, lang, kept]
    for s, e in pieces:
        lang = detect_language(text[s:e])
        if runs and not (s in kept) and not runs[-1].kept and (lang is None or runs[-1].lang in (None, lang)):
            runs[-1].end = e; runs[-1].lang = runs[-1].lang or lang      # 같은 언어 · 언어 모름은 앞을 따른다
        else: runs.append([s, e, lang, s in kept])
    out = []
    for r in runs:                                # 덩어리째 예외를 본다(조각 하나가 아니라)
        prev = out[-1] if out and not r.kept and not out[-1].kept else None
        short = prev and prev.lang == "ko" and r.lang == "en" and latin_words(r) < SHORT_ENGLISH_WORDS
                and not (split_lines and "\n" in text[prev.end:r.start])  # 줄이 갈린 "온도↵Temperature"는 짝이다
        if short or (prev and prev.lang == r.lang): prev.end = r.end      # 예외 뒤의 한글도 다시 이어진다
        else: out.append(r)
    emit (start, end) of out
```
`latin_words` = 띄어쓰기로 나눈 낱말 가운데 라틴 글자가 든 것. 번호 줄 글머리: `TYPED_NUMBER_RE` 꼴 · `(1)` `1)` · 한 글자 `a.` `a)` `가.` `ㄱ)` · 로마 숫자 둘 이상 · `①–⑳` · 글머리 `• · * ▪ ◦ ● ○ ■ □ ◆ ※ - – —` `o`(뒤에 빈칸) · 문서 번호(`refs._NUMBER`). `refs.py`의 번호 정규식 본문은 `segment.DOCUMENT_NUMBER_BODY`로 옮기고 `refs`가 import한다(추출 자식이 모델을 물지 않게). DOCX는 줄머리가 맞으면 늘, **PDF는 글머리 · 문서 번호면 늘, 번호면 블록에서 바로 앞 번호(첫 줄 포함)의 다음 번호 · 첫 하위 · 윗 단계 다음일 때만**(G18 `0.8`을 막는다).

- [ ] 시험(`test_sop_segment.py`, `[(글 조각…)]`로 비교): G1–G8 · G18 · G21 글을 그대로 `@pytest.mark.parametrize`, 더해 `test_short_english_is_judged_as_a_run`(`시약을 준비한다. Buffer A. Buffer B.` → 둘: 영어 덩어리 낱말 4), `test_kept_pieces_are_never_joined`, `test_paras_are_outer_boundaries`, `test_unknown_pieces_follow_the_previous_one`(`온도를 잰다. 25. 기록한다.` → 1), `test_leading_unknown_joins_the_next`, `test_pdf_number_lines_need_the_next_number`(`5.1 …` `0.8 bar …` → 1, `5.1` `5.2` → 2), `test_docx_number_lines_always_split`, `test_rule_1_is_untouched`(`split_block_text(rule=RULE_LEGACY)` == `split_sentences`), `test_split_paragraph_covers_every_visible_character`(G 전부 + 시드 글로 `find_coverage_problems` 0).
- [ ] `pytest tests/test_sop_segment.py -q` (F: 이름 없음) → 구현 → (P) → `feat(split): paragraph-then-language boxes as rule 2 — 문단 안 언어별 박스(규칙 2)`

### T4 — 단위 만들기에 잇기 (R2-1 · 2 · 6)

- [ ] 시험: T1의 G01–G21 R2 몫을 `PENDING`에서 뺀다. 더해 `test_sop_segment.py::test_number_cell_takes_the_first_paragraph_box`(레이아웃 표 `A`\|`비운다. 닫는다.` → 한 줄, 번호 범위 첫 조각), `test_captions_in_a_cell_stay_whole_under_rule_2`, `test_sop_ref_section.py` 시험들이 **글자 그대로** 통과(R2-6).
- [ ] (F) → 구현: `build_unit_drafts(..., rule: int = RULE_LEGACY, kept: Mapping[int, Collection[int]] = {})` — 표 칸(`paras` = 신호 `PARAS_SIGNAL`) · 문단 · 바꾼 제목 조항의 `split_sentences` 세 곳을 `split_block_text`로(조항은 `split_lines=False`, 지금과 같다). 제목 · 캡션 · 그림 · 목차 · 띠 표 줄은 그대로. `_build_unit_rows(..., rule)`: 규칙 2이고 `confirm_ref_sections`면 **규칙 1 초안을 한 번 만들어** `find_ref_section_lines`로 REF 줄을 찾고 그 범위 시작들을 `kept`로 넘겨 다시 만든 뒤, 첫째 · 둘째 범위가 `kept`인 줄에 `lang=REF_LANG`(Reference 제목이 없으면 한 번만 만든다 — 200만 자 문서의 시간). `create_initial_units`가 `extraction.split_rule`을 넘긴다.
- [ ] `pytest tests/test_sop_split_golden.py tests/test_sop_segment.py tests/test_sop_ref_section.py tests/test_sop_numbers.py -q` (P) → `feat(split): build units with the extraction's rule — 추출의 규칙으로 단위를 만듦`

### T5 — 편집은 그 추출의 규칙 (R0 뒷부분)

- [ ] 시험 `test_sop_heading_sentence.py::test_heading_to_sentence_keeps_the_documents_rule[1]` / `[2]`: 같은 문서를 올리고 `run_in_session`으로 `split_rule`을 1 / 2로 둔 뒤 `set_heading(heading=False)` — 1이면 문장 4, 2면 언어별 2; 되돌리면 제목 1. `test_sop_band.py::test_band_back_to_table_keeps_the_documents_rule[1|2]`: 여러 문장이 든 띠 표 칸 → 표로: 1이면 문장 수, 2면 칸 문장 1.
- [ ] (F) → 구현: `_load_split_rule(session, extraction_id) -> int` 하나를 `_plan_set_heading` · `_plan_band_layout`이 읽어 `_build_sentence_drafts(unit, blocks, rule)` · `_build_band_drafts(..., rule)`에 넘긴다(바깥 표를 벗길 때 따라 바뀌는 안쪽 띠 표도 같은 길).
- [ ] (P) → `fix(split): edits rebuild boxes with the document's own rule — 편집은 그 문서의 규칙으로 다시 만듦`

### T6 — 배치 판정 (R2-7)

- [ ] 시험 `test_sop_doc_meta.py::test_layout_reads_mixed_paragraphs_as_interleaved`(G19 문단 넷 → `ko_en_interleaved`), `test_layout_of_separate_halves_is_unchanged`, 있는 시험 전부 그대로.
- [ ] (F: `ko_only`) → 구현: `detect_language_layout(blocks, *, has_language_halves=False, rule=RULE_LEGACY, split_lines=False)` — 규칙 2면 본문 문단의 언어를 줄이 아니라 `split_paragraph` 조각으로 잰다(이어진 같은 언어는 하나). `ingest`가 `rule=NEW_SPLIT_RULE`을 넘긴다. 배치는 경계에 쓰지 않는다(R2-4).
- [ ] (P) → `fix(split): measure the language layout by rule-2 pieces — 배치를 규칙 2의 조각으로 잼`

### T7 — 따라 바뀌는 시험 · 도구 · 문서

- [ ] 전체 `pytest tests/ -q -n auto`. 시제품에서 규칙 2로 깨진 것은 아래 목록뿐이었다(실패 120 · 오류 7). 목록 밖이 빨가면 멈춘다.
- [ ] **쪼개기를 보지 않는 시험은 입력도 기대도 고치지 않는다.** `tests/conftest.py`에 픽스처 `legacy_split_rule`(`monkeypatch.setattr("app.sop.ingest.NEW_SPLIT_RULE", RULE_LEGACY)`)을 두고 목록의 파일 `pytestmark`에 더한다 — 운영에 있는 문서는 모두 규칙 1이라 그 시험들이 지키는 길이 그대로 필요하다. 규칙 2의 뜻을 보는 둘(`test_sop_heading_sentence.py`의 업로드 · 되돌리기)은 규칙 1 · 2로 `parametrize`(규칙 2 기대: 조항마다 언어별 문장 하나, 짝 1:1), `test_sop_units.py::test_upload_creates_units_with_full_coverage` · `test_docx_line_breaks_become_units_that_merge_back`도 같게.
- [ ] **E2E · 시드는 규칙 2로 돈다.** `scripts/synthetic_sop.py:718-725`의 배치용 표 칸 넷을 칸 안 문단 둘로 쓴다(글자 사이 빈칸 → `\n`, `_add_table`이 `\n`마다 문단을 더함, `split(". ")` → `split("\n")`) — 정답 `SYNTHETIC_expected.json`과 단계 수는 그대로다(시제품에서 `test_sop_e2e` · `test_seed_sop_demo` 19개 통과 확인).
- [ ] `scripts/measure_extraction.py`에 `rule` 선택(기본 2), `units_by_kind`를 두 규칙으로. `docs/architecture/backend.md` 5절 · `backend/CLAUDE.md`의 쪼개기 줄에 규칙 번호.
- [ ] `test(split): keep legacy-rule tests on rule 1 and drive the demo with rule 2 — 규칙 1 시험은 규칙 1로, 시연 자료는 규칙 2로`

**규칙 2로 깨지는 시험**(파일 · 수, 시제품): `test_sop_outputs` 41, `test_sop_editing` 15, `test_sop_decisions` 14, `test_sop_numbering` 10, `test_sop_excel` 6, `test_sop_units` 6, `test_sop_lang_shape` 5, `test_sop_ai_split` 3, `test_sop_match` 3, `test_sop_pairs` 3, `test_sop_target_position` 3, `test_sop_ai_match_plan` 2, `test_sop_decision_undo` 2, `test_sop_heading_sentence` 2, `test_sop_paragraph_excel` 1 — 같은 합성 문서(한 문단 여러 문장)를 올려 문장 하나를 글로 찾는 것이다. `test_sop_e2e` 4 · `test_seed_sop_demo` 7(오류)은 위 칸 넷 때문. 합성 묶음에서 박스가 줄어드는 블록은 그 칸 넷뿐이다(캡션 문단 둘은 캡션 규칙이라 그대로).

**스모크** 시드의 박스 수가 그대로라 있는 단계는 바뀌지 않을 것으로 본다. `seed_sop_worst`는 폴리싱 때 본다. 새 단계 `assign: paragraph boxes`(시드에 G2 꼴 문단 하나를 더해 박스 둘 · 짝 카드 하나). 바꿔야 하는 줄이 나오면 §14에 없으니 커밋 메시지에 까닭, 장부에 목록.
**설명서** `#split` 350행("한 문단 안에서 Shift+Enter로 줄을 바꾼 곳은 줄마다 Unit" → 규칙 2), `#split-edit` 365행(칸 안 문단마다), `#upload`에 "다시 올리면 새 규칙" 한 줄. **CHANGELOG** `새로 올리는 문서는 한 문단을 언어마다 박스 하나로 쪼갭니다(번호 · 글머리 줄에서는 나눔). 이미 올린 문서는 그대로입니다 — 새 규칙이 필요하면 다시 올립니다.` 배포 메모: Alembic 더하기 한 열.
**세워 둘 조건** ① T7 목록 밖의 시험이 깨진다. ② `test_sop_e2e`의 정답(`SYNTHETIC_expected.json`)이 바뀌어야 한다(칸 넷을 나눈 뒤에도 결과물 줄이 달라진다는 뜻). ③ 200만 자 문서의 쪼개기 시간이 지금의 1.3배를 넘는다. ④ 커버리지 검사 실패.

---

## feat/split-front-matter

**한 문장:** 1장 앞과 개정 이력을 저절로 삭제된 줄로 접어 보이고, 사유 쓰기 · 삭제 취소 · 여기부터 본문으로 사람이 고친다 (R3).

**Files**
- Create: `backend/alembic/versions/<다음>_noise_reason.py`, `backend/tests/test_sop_front_matter.py`, `frontend/src/lib/noise-keys.ts` · `.test.ts`
- Modify: `app/sop/noise.py` · `units.py:185-222` · `editing.py`(507 `_ensure_not_toc`, 899, `_Change` 425, 1315-1680 잠금, 1967, 2107, 2242, 2286, 2335 `_replay`) · `models.py:371 · 409` · `outputs.py:1317-1345 · 1851-1868` · `output_labels.py:35 · 71 · 107` · `sheet_model.py:99 · 136 · 330 · 378` · `paragraph_excel.py:80 · 145 · 212 · 339 · 346` · `routers/sop_documents.py:341 · 622`, 프런트 `lib/toc-block-model.ts` · `paper-model.ts:398-412` · `caption-slot-model.ts:148` · `assign-context-menu-model.ts:102 · 189` · `assign-focus-model.ts:269 · 283` · `decision-step-model.ts:51` · `sheet-view-model.ts:141` · `api-sop.ts:442 · 540 · 1333 · 1432`, `components/paper/paper.tsx:74 · 1303-1395`, `assign-side-panel.tsx:716-795`, `use-assign-page.tsx:469 · 1507`, `page.tsx:655`, `components/assign/remark-modal.tsx`, `outputs-workspace.tsx:81-82`, `output-a-row.tsx:172`, `lib/i18n-messages.ts:665-686`, `docs/architecture/api-contract.md`
- Test: `test_sop_toc.py` · `test_sop_paragraph_excel.py` · `test_migrations.py` · `toc-block-model.test.ts` · `assign-context-menu-model.test.ts` · `sheet-view.test.ts` · `decision-step-model.test.ts`

**Interfaces** — Produces `NOISE_FRONT = "front"` · `NOISE_HISTORY = "history"`, `NoiseLine`, `find_noise_lines`, `find_body_starts`, `SetNoiseReasonOp`(`set_noise_reason`), `StartBodyOp`(`start_body`), `NoiseBlock`(TS).

**Alembic**(더하기만): `units.noise_reason` `sa.Text(), nullable=False, server_default=""`; `unit_edits.noise_reason_changes` `sa.JSON(), nullable=False, server_default=sa.text("'{}'")`. 사유는 `noise_kind`와 따로 바뀌므로 `noise_changes`에 합치지 않는다.

### T1 — 판정 (순수 함수)

```python
NOISE_KINDS = (NOISE_TOC, NOISE_FRONT, NOISE_HISTORY)
@dataclass(frozen=True)
class NoiseLine:
    kind: str; text: str; langs: frozenset[str]   # {"ko"} · {"en"} · 빈 집합(중립). 묶음(표 · 그림)과 든 줄은 든 칸 · 캡션 언어의 합
    number: str | None; level: int | None         # 블록 heading_level, 띠 표 제목은 띠 표 신호 level
    is_body: bool; is_flow: bool                  # 표 밖 줄이거나 띠 표 제목
    noise: str | None                             # 이미 toc면 "toc"
def is_history_heading(text: str) -> bool         # refs.is_ref_section_heading과 같은 다듬기(번호 떼기 · ()/| 조각), 이름 다섯은 §7 R3
def find_body_starts(lines: Sequence[NoiseLine], *, separate: bool) -> list[int]
def find_noise_lines(lines: Sequence[NoiseLine], *, separate: bool) -> dict[int, str]
```
```
start(i): is_body and is_flow and noise is None and kind in (heading, sentence) and number.strip(".") == "1"
first = 처음 start;  없으면 {}                                             # G17
out[i] = front for i < first if is_body and noise is None                   # toc는 toc로 남는다
if separate:                                                                # ko_en_separate만
  second = first 뒤 처음 start 가운데 heading이고 langs가 first와 겹치지 않는 것
  run = second에서 거꾸로 is_body이고 langs ⊆ langs(second)인 동안(중립 · toc 포함)
  run 맨 앞의 중립 줄은 뺀다                                               # 첫 반쪽 끝 그림을 먹지 않게
  out[run] = front (noise is None인 줄만)
history: first 뒤에서 is_flow 제목이 is_history_heading이면 켜고, level(없으면 1)이 같거나 작은 제목에서 끈다 → 그 사이 noise is None인 본문 줄
```
- [ ] 시험 `test_sop_front_matter.py`: G14–G17 줄을 손으로 만든 `NoiseLine`으로(글 그대로), 더해 `test_a_korean_attachment_table_is_not_taken_by_the_second_half`, `test_a_leading_figure_of_the_second_run_is_left_alone`, `test_interleaved_documents_have_one_start`, `test_a_one_inside_a_table_is_not_a_start`, `test_history_before_chapter_one_is_front`, `test_history_ends_at_a_heading_of_the_same_or_higher_level`(9 → 9.1은 안, 10은 밖), `is_history_heading` 다섯 이름 + `9. Document Change History` + `변경 이력 (Revision History)` 참, `변경 관리` 거짓.
- [ ] (F) → 구현 → (P) → `feat(noise): find front matter and change history — 본문 앞부분과 개정 이력 찾기`

### T2 — 단위에 붙이기 · 잠그기

- [ ] 시험: 골든 G14–G16을 `PENDING`에서 뺀다. `test_front_lines_leave_the_rows_and_make_no_new_sentences`(Old: `progress.total`에 없음 · 배정 시도 422 `noise_unit`, New: 그 단위의 `TargetSentence` 없음), `test_header_and_footer_are_never_front`, `test_a_table_carries_its_mark_to_cells_and_captions`, `test_front_lines_never_pair`, `@pytest.mark.parametrize` 잠금 — `split · merge · carve · move_boundary · set_layout_table · attach_caption · detach_caption · set_first_row_caption · group_figures · ungroup_figures · set_heading · set_indents · set_number · reorder_unwrapped · switch_language`가 front 줄(또는 front 표 · 그림)에 422, 코드 `toc_line_locked`(묶음 · 캡션 · 그림 편집도 같은 코드, 이미 `heading_shift_kind` · `invalid_unit_kind`를 내는 것은 그 코드 그대로).
- [ ] (F) → 구현: `_build_unit_rows`가 번호 열을 만든 뒤 `find_noise_lines`로 `rows[i]["noise_kind"]`를 채운다(번호 열은 남겨 삭제 취소하면 번호 칸이 돌아온다, 화면 · Excel은 `noise`면 이미 번호 칸을 안 그린다). **규칙 2 추출에만**(`rule >= RULE_PARAGRAPH`, 이미 올린 문서는 그대로). `_ensure_not_toc` → `_ensure_not_noise`(판정 `noise_kind is not None`), 위 편집들의 plan 머리에서 대상 단위 · 표 단위 · 든 칸에 부른다. 표 벗기기는 안쪽 띠 표까지 본다.
- [ ] `pytest tests/test_sop_split_golden.py tests/test_sop_front_matter.py tests/test_sop_toc.py -q` (P) → `feat(noise): mark and lock front matter and history — 앞부분 · 개정 이력을 표시하고 잠금`

### T3 — 사유 (`set_noise_reason` · `clear_noise`)

```python
class SetNoiseReasonOp(BaseModel):
    type: Literal["set_noise_reason"]
    unit_ids: list[DbId] = Field(min_length=1, max_length=MAX_EDIT_UNITS)
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000), NO_NUL]      # 빈 글 = 정한 문구
# _Change에 더함
noise_reasons: dict[int, tuple[str, str]] = field(default_factory=dict)
```
- [ ] 시험: `test_reason_is_one_edit_and_undoes`(두 줄에 쓰기 → `noise_reason`, 되돌리기 → 빈 글, 다시 하기 → 글), `test_a_bundle_takes_its_members_along`(표에 쓰기 · 비우기가 칸 · 캡션까지), `test_reason_needs_a_noise_line`(보통 줄 422 `not_a_noise_line`), `test_clear_noise_empties_the_reason_and_undo_brings_it_back`, `test_noise_reasons_are_not_recent_remarks`(`/recent-remarks`에 없음), `test_migrations` 두 열 기본값. 새 코드 문구 `rule.not_a_noise_line` en · ko.
- [ ] (F) → 구현: `_set_noise_reasons`(앞 값이 맞을 때만, `_set_noises`와 같은 꼴), `is_unchanged` · `_record` · `apply_edit` 기록 · `_replay`에 한 줄씩, `clear_noise`는 묶음 구성원까지 넓히고 `noise_reasons[(id)] = (지금, "")`. 판단을 묻지 않는다. `ViewUnit.noise_reason: str = ""`(요청 · `api-contract.md`).
- [ ] (P) → `feat(noise): keep a reason on deleted lines — 삭제된 줄에 사유를 남김`

### T4 — 여기부터 본문 (`start_body`)

```python
class StartBodyOp(BaseModel):
    type: Literal["start_body"]
    unit_id: DbId
```
```
lines = 활성 본문 단위 순서(묶인 구성원은 묶음을 따른다), at = unit 자리 — 보통 본문 줄 아니면 422 invalid_body_start(noise · 묶인 칸 · 본문 밖)
starts = find_body_starts(lines, separate);  둘째 반쪽인가 = separate and starts and at > starts[0] and unit.lang in {ko,en} and lang != lines[starts[0]] 언어
marks  = 둘째 반쪽이면 at 앞으로 이어진 같은 언어 · 중립 덩어리(T1 run과 같은 함수), 아니면 본문 처음부터 at 앞까지 — noise is None인 줄만 front
clears = at부터 앞으로 끊김 없이 이어진 front 덩어리(toc · history는 끊지 않고 남긴다)를 비움 — 둘째 반쪽의 앞부분은 건드리지 않는다
_Change(noises = {mark: (None, front)} ∪ {clear: (front, None)}, noise_reasons = clears의 사유 비움), 묶음 구성원 포함
```
- [ ] 시험: `test_start_body_marks_everything_before_it`(G17 문서에서 `2. 범위` → 앞 세 줄 front), `test_start_body_clears_front_marks_after_it`(G14에서 `Summary of Changes` 앞 문단을 골라 앞은 front, 그 뒤 front는 비움, toc는 남음), `test_start_body_in_the_second_half_stays_in_it`(G15 영어 반쪽), `test_start_body_is_one_undo`, `test_start_body_refuses_a_decided_line`(Old 배정 하나 · New 이음 하나 → 409 `unit_has_decision`, 아무것도 안 바뀜), `test_start_body_on_a_noise_line_is_refused`.
- [ ] (F) → 구현: `_write_change`의 `marking` 검사 · `_leave_pairs`가 그대로 일한다(New는 `sync_new_doc_targets`가 새 문장을 지우고 만든다 — 만든 · 은퇴한 단위가 없어도 부르는 지금 길 확인). `EditOp` 합집합 · `_plan` · 프런트 `EditOp` 타입 · `assign-focus-model`의 두 switch(`"toc"` 줄 이름, 단위 목록) · `decision-step-model` 제자리 편집 목록 · `assign.step.start_body` · `assign.step.set_noise_reason` en · ko.
- [ ] `pytest tests/test_sop_front_matter.py -q` · `npx vitest run src/lib/decision-step-model.test.ts src/lib/assign-focus-model.test.ts` (P) → `feat(noise): set where the body starts — 여기부터 본문`

### T5 — 결과물

- [ ] 시험: `test_sop_toc.py`의 A · 요약 · 시트 시험을 종류별로 넓힘 — `test_output_a_writes_the_reason_or_the_set_phrase`(front en `Before chapter 1` · ko `1장 앞이라 삭제`, history `Change history` · `개정 이력이라 삭제`, toc는 지금 `toc_remark` 그대로, 적은 사유가 있으면 그 글), `test_a_table_row_says_its_size`(위치 글 `본문 앞부분 · 한글 · 3행`, Old 글 `표 1 (2×2)` · 그림 `[Figure]`, 1줄), `test_summary_counts_each_kind`(`toc_deleted` · `front_deleted` · `history_deleted`, `old_rows`에 모두, 0이면 화면 · xlsx에 없음, flow 삭제 노드 = `deleted` + 셋), `test_preview_folds_by_kind`(목차와 앞부분이 이어져도 무리 둘), `test_sop_paragraph_excel.py::test_front_lines_are_struck_with_their_reason`(Remark `Deleted — 1장 앞이라 삭제`, `deleted=True` · 취소선 · Lang 빈 칸, Space 미리보기는 숨김, New 문서도), `test_contents_lines_in_the_paragraph_excel_are_unchanged`(F1은 나중 브랜치).
- [ ] (F) → 구현: `OutputLabels`에 종류별 자리 꼴 · 사유(`noise_place_templates` · `noise_remarks`), `ARow.noise_kind` 그대로, `SheetRow.toc`(화면 접기)는 `noise_kind`가 있는 줄로 넓히고 `SheetRow.noise: str | None`을 더해 `listSheetItems`가 종류에서 끊는다, `Summary`(`outputs.py:251`)에 두 수, `outputs-workspace`의 `SUMMARY_ITEMS` · `OPTIONAL_SUMMARY_ITEMS`와 `outputs.sum.front_deleted` · `outputs.sum.history_deleted`, xlsx 요약 이름 `Front matter · auto-deleted` · `Change history · auto-deleted`. 문단 Excel의 정한 문구는 `output_labels`에서 읽는다(시트 언어는 지금처럼).
- [ ] (P) + `npx vitest run src/components/outputs/sheet-view.test.ts src/lib/sheet-view-model.test.ts` → `feat(outputs): front matter and history rows with reasons — 결과물에 앞부분 · 개정 이력 줄과 사유`

### T6 — 블록 모델과 용지

```ts
export type NoiseKind = "toc" | "front" | "history";
export interface NoiseBlock extends TocBlock { kind: NoiseKind; reason: { text: string; isWritten: boolean; isMixed: boolean } }   // counts.total은 묶음을 1줄로
export function buildNoiseBlock(units, labelOf: (unit) => string): NoiseBlock | null;      // 표 "표 n (r×c)", 그림 "[Figure]"
export function shouldJoinNoiseCard(previous: NoiseKind | null, next: NoiseKind | null): boolean;   // 같은 종류만
export function listNoiseBlocks(units): Array<{ key: number; kind: NoiseKind; unitIds: number[] }>;
```
- [ ] 시험(`toc-block-model.test.ts`): `it("breaks the block where the kind changes")`(toc 3 · front 2 · toc 1 → 블록 셋), `it("counts a table or figure as one line and hides its cells")`, `it("shows the written reason, or the set phrase")`, `it("says mixed when lines have different reasons")`, 있는 시험 그대로(이름만 바뀐 함수는 별칭을 남기지 않고 부르는 곳을 함께 고친다).
- [ ] (F) → 구현: `renderTocBlock` → `renderNoiseBlock` — 머리 `DELETED {이름} · {n}줄 · 사유 {글}`(꼬리표만 빨강, 삭제 줄과 같은 토큰), **접혀 있어도** 오른쪽에 글자 단추 둘(`assign-paper-noise-reason-<key>` · `assign-paper-noise-clear-<key>`), 펼치면 줄마다 끝에 아이콘 단추 둘(흐리게, `.mbtn` 모핑은 Assign 전용 선택자), 고른 줄은 `삭제 취소 U`가 펼친 채, 줄 글 취소선, 단추 면 높이 ≥ 26px. 이름 · 문구(en / ko): `Front matter` / `본문 앞부분`, `Change history` / `개정 이력`, `Contents` / `목차`; `Write a reason` / `사유 쓰기`, `Restore all` / `모두 삭제 취소`, `Restore` / `삭제 취소`; 정한 사유는 T5와 같은 글, 목차는 `The app builds the new contents` / `앱이 새 목차를 만듦`. `assign.toc.not*` · `allNot`은 이 문구로 바꾸고 안 쓰는 키는 지운다. **Split · New 한 단(`strips.toc`가 없는 화면)은 지금대로 보통 조각**(New 접기는 스텝 4-3).
- [ ] 화면에서 이 블록을 쓰는 곳(`getMergeBlocker` 문구 `split.noMergeToc`, 캡션 · 우클릭 까닭 `tocLine`, `rule.toc_line_locked`)의 글을 "삭제된 줄 … 먼저 삭제 취소"로. 우클릭 메뉴의 `tocLine`은 그대로 막고, 본문 줄에는 새 항목 `start_body`(`assign.ctx.startBody` en `Body starts here` / ko `여기부터 본문`, edit 묶음 끝, Old 문서의 표 밖 글 줄 · `noise_kind` 없음).
- [ ] 시험 `assign-context-menu-model.test.ts`: `it("offers Body starts here on a body line only")`, `it("locks table, caption, figure and heading items on a deleted line")` → (P) → `feat(paper): show deleted front matter and history as blocks — 앞부분 · 개정 이력 블록`

### T7 — 오른쪽 칸 · Remark 창 · 글쇠

```ts
export type NoiseKeyAction = { kind: "clear" | "reason"; unitIds: readonly number[] } | { kind: "none" } | null;   // null = 판단 글쇠로 넘긴다
export function readNoiseKey(id: AssignKeyId, pick: { unitId: number | null; block: NoiseBlock } | null): NoiseKeyAction;
```
- [ ] 시험(`noise-keys.test.ts`): 줄을 고름 — `U` 그 줄 삭제 취소 · `R` 그 줄 사유 · `⇧U` `⇧R` 블록 전체; 블록 머리를 고름(`unitId: null`) — `U` · `R`도 블록 전체; `Del` · `⇧H` · `Enter` → `{ kind: "none" }`(삭제된 줄이 마지막 누름일 때); `pick`이 `null`이면 모두 `null`(지금 일). `assign-keymap.test.ts`: `⇧U` · `⇧R` 줄(when `row`), 설명서 대조 통과.
- [ ] (F) → 구현: `focus.kind === "toc"`(목차 고름)을 잡음 고름으로 넓혀 쓰고 `handleKey`에서 판단 글쇠보다 먼저 `readNoiseKey`. 사유 창은 `RemarkModal`에 `kind: "noise"`(글 칸 하나, 최근 사유에서 고르기 있음, 저장은 `set_noise_reason`, 빈 글 = 정한 문구로), 오른쪽 칸 `renderTocPanel` → `renderNoisePanel`: 블록 · 줄 머리, 사유 줄(글 + 연필), 단추 둘(`assign-noise-reason` · `assign-noise-clear`), 3번 칸은 지금처럼 "따로 할 일 없음"이되 **확정 단추는 `planPrimary`의 막힘**(Enter는 아무것도 하지 않음). `enqueue`로 간다(`clear_noise` · `set_noise_reason` · `start_body`는 장벽 아님, 누른 순간의 단위).
- [ ] (P) → `feat(assign): reason and restore keys on deleted lines — 삭제된 줄의 사유 · 삭제 취소 글쇠`

**스모크** — §14 승인: `assign.mjs` 2574 · 2584-2585 · 2588 · 2590 · 2592 · 2596 · 2598-2599("고른 줄에만" → "늘 보임", 문구 DELETED, 같은 수). 같은 까닭으로 따라 바뀌는 줄(승인 목록에 없음 — 장부에 적고 사용자에게 올림): `2596`이 읽는 testid 이름(`assign-paper-toc-*` → `assign-paper-noise-*`), `outputs.mjs:144-155`(`output-a-toc-` · `export-preview-toc-` testid는 **그대로 두어** 안 고친다). 새 단계 `assign: front matter`(합성 시드에 G14 꼴 문서 하나): 접힌 블록 둘, 머리 단추가 접힌 채 보임, 줄 U · R, ⇧U · Ctrl+Z, 우클릭 여기부터 본문 → 되돌리기 한 번, Excel A의 Remark.
**설명서** `#assign-toc` 653-664(이름을 "저절로 삭제된 블록"으로, 앞부분 · 개정 이력 · 사유 · 여기부터 본문), `#assign-keys`, `#outputs` 837행, `#documents`(1장 앞은 저절로 빠짐, 다시 올린 문서부터). **CHANGELOG** `새로 올리는 문서의 1장 앞(표지 · 결재 · Summary of Changes)과 개정 이력은 저절로 삭제 블록으로 접힙니다 — 사유 쓰기(R) · 삭제 취소(U) · 우클릭 여기부터 본문.` 배포 메모: 더하기 두 열.
**세워 둘 조건** ① 잡음 줄이 하나라도 남은 수 · 검토 조건 · F1 숫자에 들어간다. ② `start_body` · `clear_noise` 되돌리기가 New 새 문장을 `new_unit_id`마다 하나로 못 되돌린다(스텝 0 뒤에도). ③ 실제 문서 꼴에서 본문이 통째로 front가 될 수 있는 입력이 시험에서 나온다(정답 문서에 더하고 보고). ④ 이미 올린 문서의 `noise_kind`가 바뀐다.

---

## feat/split-new-parity

**한 문장:** 띠 표 제목 · 제목답지 않은 제목 · 모양 전환을 New에도 열어 Old와 같은 박스를 만든다 (R4).

**Files**: Modify `backend/app/sop/units.py:108 · 119`, `match.py:108-168`, `editing.py:2274 · 2107-2200`, `frontend/src/lib/i18n-messages.ts:1299`(안 쓰게 되면 지우지 않고 남김), `docs/architecture/backend.md` 7절. Test `test_sop_split_golden.py` · `test_sop_match.py` · `test_sop_lang_shape.py`.
**Interfaces** — Consumes `find_units_needing_confirm` · `detach_targets` · 계획 1의 `sync_new_doc_targets` 고침. Produces New에서 `SwitchLanguageOp`(계획 3 4-3이 화면을 연다).

### T1 — 쪼개기를 같게
- [ ] 시험: 골든 `G11-new` · `G13-new`를 `PENDING`에서 빼 `PENDING`이 비고 `test_old_and_new_give_the_same_boxes` 21개 통과. `test_sop_match.py::test_band_headings_of_a_new_document_nest_in_the_section_path`(G13 New: `밸브를 닫는다.`의 `section_path == "5 절차 › 5.1 준비"`), `test_a_new_heading_clause_makes_linkable_sentences`(G11 New: 새 문장 둘, 이어 확정 200). 이미 올린 New(규칙 1)는 그대로임 `test_rule_1_new_documents_keep_their_headings`.
- [ ] (F) → 구현: `create_initial_units`의 두 `document.side == "old"`를 `document.side == "old" or extraction.split_rule >= RULE_PARAGRAPH`로(이미 올린 문서는 다시 만들지 않으니 새 추출에만 닿는다), `_plan_targets`의 제목 단계는 `heading_level`이 없고 띠 표 제목이면 `SourceTable.signals` 띠 표 `level`. `detect_caption_refs`는 Old만 그대로.
- [ ] (P) → `feat(split): split New documents by the same rules — New도 같은 규칙으로 쪼갬`

### T2 — New의 모양 전환
- [ ] 시험 `test_sop_lang_shape.py`: `test_switch_language_works_on_a_new_document`(짝 → 합침, 새 문장 수 1, Ctrl+Z(문서 편집 되돌리기)로 짝 · 새 문장 둘 복구), `test_switching_a_linked_new_pair_asks_first`(이은 문장이 있으면 409 `confirm_required`, `confirm=True`면 이음이 풀리고 Old 줄은 보류), `test_new_refusals_stay`(`no_shape_change` · `cannot_unmerge` · 잡음 줄 422).
- [ ] (F: 422 `invalid_side`) → 구현: 2274행 가드를 지우고 `_write_change`에서 **New는 `change.release`를 묻지 않는 단위(`settled`)에 넣지 않는다** — `find_units_needing_confirm`에 더해 확인을 받고, 받으면 `_find_new_doc_targets(release)`를 `detach_targets`로 먼저 푼다. Old의 "묻지 않고 푼다(3-c)"는 그대로.
- [ ] `pytest tests/test_sop_lang_shape.py tests/test_sop_match.py tests/test_sop_split_golden.py -q` (P) → `feat(edit): switch language on New documents — New에서도 모양 전환`

**있는 시험** — 시제품에서 R3 · R4를 함께 켜고 `test_sop_e2e` · `test_seed_sop_demo` 19개가 통과했다(시드에는 번호 1로 시작하는 New 띠 표 · 긴 제목 조항이 없다). 나머지는 규칙 1 픽스처로 돌아 닿지 않는다 — 전체를 돌려 확인한다.
**스모크** 화면은 스텝 4-3이 연다. New 문서를 올리는 있는 단계(띠 표 · 제목 조항이 든 합성 New 파일)가 새 박스 수로 통과하는지 `ONLY="assign:"`만. **설명서** `#assign-band` 711 · `#assign-heading-shift` 666의 "Old 문서만" 문장을 "Old · New"로(화면에서 되돌리는 단추는 스텝 4-3까지 Old만이라고 남긴다). **CHANGELOG** `새로 올리는 New 문서도 Old와 같은 규칙으로 쪼갭니다 — 띠 표는 제목 줄, 제목 스타일로 쓴 긴 조항은 이을 수 있는 문장이 됩니다.`
**세워 둘 조건** ① `_plan_targets`의 절 경로가 규칙 1 New 문서에서 바뀐다. ② 이은 New의 모양 전환 뒤 Ctrl+Z가 이음을 못 되살린다(스텝 0 확인).

---

## 정한 것 (계획을 쓰며 나온 물음의 답)

1. **따라 바뀌는 시험**: `assign.mjs:434 · 2039 · 6328 · 6390` · `3085` · `541` · `2811` · `8167`과 잡음 블록 testid는 같은 수의 단계로 고치고 커밋에 까닭을 적는다. 규칙 2로 깨지는 백엔드 시험 120개는 **입력과 기대값을 바꾸지 않는다** — 쪼개기를 보는 시험이 아닌 것은 `legacy_split_rule` 고정물로 규칙 1에서 그대로 돈다(이미 올린 문서의 길이라 남아 있어야 할 검증이다). E2E · 시드는 규칙 2. 합친 뒤 규칙 1로 돌린 시험 수를 장부에 적는다.
2. 짧은 영어 예외는 줄이 갈리면 쓰지 않고 영어 덩어리 단위로 낱말을 센다. 한 줄의 `탱크를 비운다. Drain it.`은 한 박스가 된다(합성 자료로 잡은 값, 설계 13절) — **장부의 "아침에 볼 것"에 적는다.**
3. PDF 번호 줄은 앞 번호의 다음이거나 아래 번호일 때만 나눈다.
4. New 칸 자리를 마우스로 눌러도 포커스를 용지로 돌린다.
5. `R`은 보통 줄이 keymap, 삭제된 줄이 front-matter에서 켜진다.
6. 목차의 사유는 화면 글과 Excel A의 글을 그대로 둘로 둔다.
7. 번호 1로 시작하는 장을 못 찾으면 아무것도 제외하지 않는다(G17).

## 스스로 본 것

- S1 · B1-R1~R7 = assign-enter T1–T4. B2-R1~R6 · R8~R11 = keymap T1–T4(R9 M은 `fix/remove-bundle-move`가 이미), R7 = T3. J1-R1~R5 = merge-keys T1 · T2(R6은 `feat/unwrap-continue-numbers`). B3-R1~R4 = number-cell T1.
- R0 = split-rule-2 T2 · T5, R1 = T1, R2-1~6 = T3 · T4, R2-7 = T6, R2-8(짝 규칙 안 바꿈) = 바꾸는 작업 없음(G3 · G19가 짝 카드 자료), 문단 Excel은 T4가 저절로.
- R3: 종류 · 한 줄에 하나 = T1 · T2, 표 · 그림 = T2 · T5 · T6, 본문 시작 · 둘째 반쪽 · 개정 이력 = T1, 화면 · 단추 = T6, `U` · `R` · `⇧U` · `⇧R` = T7, 사유 · 저장 · 되돌리기 = T3, 여기부터 본문 = T4, 결과물 · Excel · 미리보기 = T5, 잠금 · 못박은 곳 = T2 · T6. F1의 체크(삭제한 줄 · 옛 문서 목차)는 `feat/space-preview-trim`이 읽는다.
- R4 = new-parity T1 · T2, `isSolo` 화면 풀기는 계획 3 -3. 이름은 색인 표와 같다: `ASSIGN_KEYS` · `RULE_LEGACY` · `RULE_PARAGRAPH` · `split_golden` · `NOISE_FRONT` · `NOISE_HISTORY` · `noise_reason` · `SetNoiseReasonOp` · `StartBodyOp` · `NoiseBlock` · `enqueue`.
