# 쪼개기 먼저 4 — 고름 · 손질 다듬기 (스텝 5)

> **For agentic workers:** 차례 · 공용 이름 · 게이트 · 세우는 조건은 [색인](2026-11-25-split-first.md)이 먼저다. 이 파일은 스텝 5의 일곱 브랜치만 적는다.

**Goal:** 무엇을 골랐고 무엇이 바뀌는지 보이게 하고(두 겹 고름 · 표 우클릭 구역 · 여럿 고른 표시 · 떨어진 짝 선), 여럿을 한 편집으로 합치고 벗기고 나눈다.

**Architecture:** 판정은 순수 모델(`pick-scope-model` · `menu-section-model` · `multi-pick-model` · `multi-mark-model` · `pair-bracket-model`)에 두고 화면은 그 답을 그린다. 서버의 새 편집 셋은 모두 `editing._write_change` 길의 `_Change` 하나라 되돌리기 한 번이다. 쓰기는 앞 계획의 명령 큐를 지난다. **Alembic 없음**(`unit_edits.op`은 `String(24)`, CHECK 없음).

**Spec:** [`2026-11-25-split-first-design.md`](../specs/2026-11-25-split-first-design.md) §8 · §9 · §11-1 · §14 · [`2026-11-23-assign-feedback-2.md`](../specs/2026-11-23-assign-feedback-2.md) C1 · C2 · G1 · E1 · S6 · S8 · S9 · S14.

**Global Constraints:** 색인 파일.

| 브랜치 | 구현 | 검토 | 까닭 |
|---|---|---|---|
| `feat/assign-two-level-pick` | O | O | 고른 Unit과 배정 박스를 가르는 값이 화면 전체에 쓰인다 |
| `feat/assign-table-menu` | S | O | 순수 모델이 대부분, 벗긴 줄 · New의 구역 뜻만 확인 |
| `feat/assign-multi-mark` | S | S | 표시만 |
| `feat/assign-multi-merge` | O | O | 새 편집 둘 + 짝 · 합치기 풀기 · 되돌리기 |
| `feat/assign-multi-pick` | S | O | 큐 · 되돌리기 한 칸 |
| `feat/split-by-sentence` | S | O | 편집 하나, New 새 문장 맞추기까지 |
| `feat/assign-pair-bracket` | O | S | 이펙트를 공용 훅으로 옮긴다(기준선 줄임) |

**시작할 때 다시 볼 것** — `dev` `e704ddf8`을 읽고 썼다. 줄 번호는 이 커밋 기준이고 앞 계획이 바꾼 것은 **그때 코드**를 이름으로 찾는다: `AssignCommand`, `FocusState`(쪽마다 고름) · `shapeOf(side)` · `runUnitEdit(shape, op, okText, …)`, `PickBar` · `buildPickBar`(`isCell` · `isMultiPick`), `NewPaper` · `NewOverlay`, `checkedNew`, `buildDocTools`, `ASSIGN_KEYS`(`when` 값) · `resolveAssignKey` · `formatAssignKey`, `split_block_text` · `RULE_LEGACY`, `readFarSide`, `PaperChunk` deps. `move` 항목(다른 Bundle)은 이미 없다.

**명령과 시험 꼴** — 프런트는 `frontend/`, 백엔드는 `backend/`에서. 작업마다 커밋 전에 `npm run lint && npx tsc --noEmit -p tsconfig.json`(백엔드 `.venv/bin/ruff check app/ tests/`). 화면 부품 시험은 `.test.ts` + `createElement` + `renderToStaticMarkup`(본보기 `components/ui/morph-button.test.ts`). 시험 조각의 `u()` · `row()` · `html()` 같은 짧은 만들개는 그 파일 머리에 둔다. **새 `useEffect` · 타이머 0**(마지막 브랜치는 있는 이펙트를 `src/lib/use-*.ts`로 옮기기만 한다).

## feat/assign-two-level-pick
- **한 문장:** 누른 조각은 진하게, 그것이 든 묶음(짝 카드 · 표)은 얇은 테와 꼬리표로 보이고, 표 칸을 누르면 칸이 골라지되 배정은 표째다 (C1-R1~R5).
- **Files** — **Create**: `frontend/src/lib/pick-scope-model.ts` · `.test.ts`, `components/paper/paper-pick.test.ts` · **Modify**: `lib/paper-model.ts:417`(`resolvePickUnit`), `components/paper/paper.tsx`(`PaperProps` 162-180, `isMate` 728, `renderCell` 996-998, `renderBundleHead` 1067-1075, `renderRow` 1221-1223, `isDeletedLineOpen` 1392 · 1545, `renderCard` 1533, `handleClick` 1695-1718), `components/paper/bundle-head.tsx:13-31`, `styles/components.css` 1302 · 1313 · 1322 · 1546-1550(용지 규칙 — 관리 화면과 겹치지 않는다), `use-assign-page.tsx`(412 · 444-455 · 541 · 788 · 954 · 1155 · 1166 · 1173 · 1296-1300 · 1351-1361 · 2008 · 2946 · 3347), `page.tsx:308 · 579-588`, `components/assign/new-paper.tsx`, `lib/i18n-messages.ts`, `docs/architecture/frontend.md` §2·§3, `docs/qa/feature-map.md:22` · **Test**: `lib/paper-model.test.ts:209`, 위 `.test.ts`
- **Interfaces** — Consumes: `FocusState`(Old 고름의 `unitId`가 이제 칸일 수 있다), `PickBarState.isCell`. Produces: `buildPickScope` · `resolveBoxUnit` · `readRowKeyOf`, `Paper`의 `scope?: PickScope | null`.
### T1 — 누른 조각과 배정 박스를 가르는 모델
```ts
export interface PickScope { unitId: number; boxId: number; group: { kind: "pair" | "table"; unitIds: readonly number[]; table: number | null } | null }
export function resolveBoxUnit(unitId: number, units: ReadonlyMap<number, ViewUnit>): number   // 칸 문장 · 캡션 → 묶음(지금 resolvePickUnit의 답) — 끌기 · 줄 찾기
export function readRowKeyOf(unitId: number, rowOfUnit: ReadonlyMap<number, string>, groupOf: ReadonlyMap<number, number>): string | null
export function buildPickScope(unitId: number, rowUnitIds: readonly number[], units: ReadonlyMap<number, ViewUnit>, tables: ReadonlyMap<number, ViewTable>): PickScope
```
`resolvePickUnit`은 **칸 문장이면 자기**, 캡션이면 묶음. 묶음 순서: 묶인 칸 문장 → 표, 같은 짝이 둘 이상인 줄 → 짝, 그 밖(표 머리를 누른 표 · 벗긴 줄 하나 · 그림) → null.
- [ ] 시험 `pick-scope-model.test.ts`와 `paper-model.test.ts:209`(있는 시험의 기대를 새 뜻으로 — 커밋에 까닭 C1-R3):
  ```ts
  it("a table cell is the picked unit and its table is the box", () => expect(buildPickScope(2, [1], units, tables)).toEqual({ unitId: 2, boxId: 1, group: { kind: "table", unitIds: [1], table: 2 } }));
  it("a pair half keeps itself as the box and names the pair", () => expect(buildPickScope(5, [5, 6], units, tables)).toEqual({ unitId: 5, boxId: 5, group: { kind: "pair", unitIds: [5, 6], table: null } }));
  it("a whole table, a figure and a lone line have no group", () => { for (const id of [1, 7, 8]) expect(buildPickScope(id, [id], units, tables).group).toBeNull(); }); it("an unwrapped cell line is its own box", () => expect(buildPickScope(9, [9], units, tables)).toMatchObject({ boxId: 9, group: null }));
  it("finds the table row of a cell", () => { expect(readRowKeyOf(2, new Map([[1, "t1"]]), new Map([[2, 1]]))).toBe("t1"); expect(readRowKeyOf(99, new Map(), new Map())).toBeNull(); });
  it("picks the cell itself and lifts a caption", () => { expect(resolvePickUnit(2, units)).toBe(2); expect(resolvePickUnit(4, units)).toBe(1); expect(resolveBoxUnit(2, units)).toBe(1); });
  ```
- [ ] 실패 확인 `npx vitest run src/lib/pick-scope-model.test.ts src/lib/paper-model.test.ts` → 모듈 없음
- [ ] 구현: 위 서명. `buildPaperModel`은 그대로, `use-assign-page.tsx:2946`(끄는 박스)은 `resolveBoxUnit`으로
- [ ] 같은 명령 통과 → **커밋** `feat(assign): tell the pressed piece from the box it belongs to — 누른 조각과 배정 박스를 가름`
### T2 — 화면이 두 값을 쓴다 (`pickedId`는 누른 조각, `boxId`는 줄의 박스)
| 자리 | 값 |
|---|---|
| `activeKey`(412) · `findRowKey`(1166) | `readRowKeyOf(focus.unitId, rowOfUnit, groupOf)`. `groupOf`는 모든 보기의 묶인 칸에서 `useMemo` 한 번 |
| `pickRowKey`(450) · `findBoxId`(1173) | 그 줄의 칸이면 칸을 그대로 고른다, 줄만 주면(J/K · 확정 뒤) 줄의 박스(C1-R4) |
| 우클릭 메뉴 닫기(541) · `spaceAnchor`(788) · `closePairView`(954) · `moveRow`의 지금 자리(1155) · 저장 뒤 다음 박스(2008) · 명령이 잡는 값 | `boxId` |
| `selectedId`(page 579) · 단추 줄 자리 · 나눌 선 · `openCtxMenu`(3409) | `pickedId` |
| 이음 · 삭제 · 배정 취소 | 줄(`row.unitIds`) 그대로 — 표째 |
- [ ] 시험 `pick-scope-model.test.ts`에 더함(`export function readNavUnit(scope: PickScope): number` = J/K가 서 있는 박스):
  ```ts
  it("J and K walk from the box, not from the cell", () => expect(readNavUnit(buildPickScope(2, [1], units, tables))).toBe(1)); it("keeps the cell when its table is unwrapped", () => expect(buildPickScope(2, [2], unwrappedUnits, tables)).toMatchObject({ unitId: 2, boxId: 2 }));
  ```
- [ ] 실패 확인 `npx vitest run src/lib/pick-scope-model.test.ts` → `readNavUnit` 없음
- [ ] 구현: 표대로. `pickedId`를 줄의 박스로 여기던 `row.unitIds.includes(pickedId)`는 모두 `boxId`로(`grep -n pickedId` 22곳을 하나씩)
- [ ] 같은 명령 + 전체 `npx vitest run` · tsc 통과 → **커밋** `feat(assign): pick the pressed cell while the table stays the row — 칸을 골라도 줄은 표`
### T3 — 두 겹 그리기
`Paper`가 `scope`를 받아 진한 쪽은 지금 `data-sel`, 묶음은 새 `data-group="pair" | "table"`로 그린다. 값: 얇은 테 1px `--accent-line` 실선(카드는 지금 `--ring-*` 변수로 맞닿는 쪽을 연 채), 진한 쪽 2px `--accent` + 글 `--sel-bg`, 꼬리표 `.group-tag`는 카드 첫 줄(표는 표 조각)의 위 테두리 선 **왼쪽** `left: var(--pg-pad-l)` · `top: -9px` · 높이 16px · 바탕 `--paper` · 글자 `--fs-micro`(오른쪽은 `.strip-lang` 자리). testid `assign-paper-group-<boxId>`(New `assign-new-group-<boxId>`). 문구 C1 표 그대로, New 표는 배정이 칸마다라 en `Group · Table {n}` / ko `묶음 · 표 {n}`(묻기 3). 규칙: ① `.strip-card:has(… [data-sel], [data-partner])::after` 2px 규칙을 `[data-group]` 1px로 바꾼다. ② 1313행(표 전체 호버)을 지운다 — 호버는 칸 조각 규칙(1311)이 맡는다(C1-R5). ③ `.strip-chunk:has(…)`(1302)에 `.cell-piece[data-sel]`을 더한다(칸 안 팝업). ④ `isDeletedLineOpen`에는 `scope.boxId`를 준다 — 칸 id를 주면 펼친 삭제 표가 누르는 순간 접힌다. ⑤ 칸을 고른 표는 `isMate`가 아니다(점선 테 없음). `BundleHead`는 칸을 골라도 캡션을 펼친다. ⑥ 꼬리표 글은 고른 덩어리에만 있으므로 `PaperChunk` deps에 넣지 않는다(고른 덩어리는 늘 `live`).
- [ ] 시험 `paper-pick.test.ts`:
  ```ts
  it("marks the pressed cell and only thinly rings its table", () => { const h = html(cellPick); expect(h).toMatch(/class="cell-piece"[^>]*data-strip-unit="2"[^>]*data-sel=""/); expect(h).toMatch(/data-group="table"[^>]*data-testid="assign-paper-piece-1"/); expect(h).not.toMatch(/data-sel=""[^>]*data-testid="assign-paper-piece-1"/); expect(h).toContain("Table 2 (assigned as a whole)"); });
  it("marks one half of a pair card and tags the card once", () => { const h = html(pairPick); expect(h.match(/data-group="pair"/g)).toHaveLength(2); expect(h.match(/group-tag/g)).toHaveLength(1); expect(h).not.toMatch(/data-testid="assign-paper-piece-6"[^>]*data-sel=""/); });
  it("rings a lone line with no tag", () => expect(html(lonePick)).not.toContain("group-tag")); it("keeps a deleted table open while its cell is picked", () => expect(html(deletedCellPick)).toContain('data-testid="assign-paper-piece-1"'));
  it("draws the same markup without a scope", () => expect(html({ scope: null })).toBe(html({ scope: undefined })));
  ```
- [ ] 실패 확인 `npx vitest run src/components/paper/paper-pick.test.ts` → `data-group` 없음
- [ ] 구현: 규칙대로. CSS에 raw hex 없음 → 같은 명령 + `npx vitest run src/source-rules.test.ts src/lib/i18n-messages.test.ts` 통과 → **커밋** `feat(paper): ring the group thinly and fill the pressed piece — 묶음은 얇은 테, 누른 조각은 진하게`
### T4 — 오른쪽 칸 다듬기 대상 = 누른 칸
`export function buildShapeTargets(scope: PickScope, rowUnits: readonly ViewUnit[], cell: ViewUnit | null): { unit: ViewUnit; hidden: ReadonlySet<AssignMenuAction> }[]` — 칸이면 칸이 맨 앞(표 항목 `table_layout`은 숨김, 표 줄에 있다), 다음이 줄의 Unit(지금 차례).
- [ ] 시험 `pick-scope-model.test.ts`:
  ```ts
  it("puts the pressed cell first and keeps Unwrap on the table line only", () => { const t = buildShapeTargets(cellScope, [table], cell); expect(t.map((x) => x.unit.id)).toEqual([2, 1]); expect(t[0].hidden.has("table_layout")).toBe(true); expect(t[1].hidden.size).toBe(0); });
  it("puts the pressed half of a pair first", () => expect(buildShapeTargets(pairScope(6), [five, six], null).map((x) => x.unit.id)).toEqual([6, 5]));
  ```
- [ ] 실패 확인 `npx vitest run src/lib/pick-scope-model.test.ts` → 함수 없음
- [ ] 구현: `shapeLineUnits` · `shapeLines`(1296-1300)를 이것으로. 캡션 자리 · 다시 표로 · 짝 모양 전환은 줄 기준 그대로
- [ ] 같은 명령 + 전체 `npx vitest run` 통과 → **커밋** `feat(assign): shape the pressed cell in the side panel — 오른쪽 칸이 누른 칸을 다듬음`
### 브랜치 끝
- **스모크**: `assign.mjs:721`(고리 2px, **§14 승인**) — 누른 조각 2px는 그대로 두고 짝의 다른 조각 1px · 꼬리표 검사를 더한다. `:773-817` 단계(이름과 803 · 804행이 "칸을 눌러도 표 전체가 고름")는 C1-R3과 정반대라 **따라 바뀌는 것**: 같은 검사 수로 803 = 표 줄 다듬기에 **Unwrap table**이 있다, 804 = 칸 조각 `data-sel` · 표 조각 `data-group="table"`(§14에 줄 번호가 없다 — 묻기 5). 새 단계 `assign: two-level pick - a pair half, a table cell and Del deletes the whole table`(S8, Old와 New 양 단 한 번씩). 그대로여야 하는 것: 표 머리를 눌러 벗기는 단계(2712 · 4654 · 4705 · 4798 · 5026 · 5114 · 5206).
- **설명서**: `#split-pair` 375행(카드 전체 테두리 → 누른 조각 진하게 + 카드 얇은 테), `#assign` 421행, `#assign-destination` 495행, `#assign-unwrap`(칸을 누르면 칸이 골라지고 배정은 표째). `feature-map.md:22` "줄 전체를 `[data-sel]`로 찾으면" 문장에 칸을 더함. **CHANGELOG**: `고른 조각은 진하게, 그것이 든 짝 · 표는 얇은 테와 꼬리표로 보입니다 — 표 칸을 누르면 그 칸이 골라지고 배정 · 삭제는 표 전체입니다.`
- **세워 둘 조건**: ① Del · U · 잇기가 칸 하나에만 작용한다(줄 = 표가 깨짐). ② `paper.tsx`를 거치지 않는 자리(`pair-column` · `spot-panel` · 그림 탭)가 `scope` 없이 깨진다. ③ 꼬리표가 글 · `.strip-lang` · 보류 칩과 겹친다(자리를 다시 잡아도 남으면).

## feat/assign-table-menu
- **한 문장:** 표 칸(과 벗긴 표의 줄)의 우클릭 메뉴가 "이 칸" 위 · "이 표" 아래 두 구역이고, 항목에 올리면 닿는 칸이 칠해진다 (C2-R1~R4, ⇧D 제외).
- **Files** — **Create**: `frontend/src/lib/menu-section-model.ts` · `.test.ts`, `lib/menu-reach-model.ts` · `.test.ts`, `components/assign/reach-paint.tsx` · `.test.ts` · **Modify**: `lib/assign-context-menu-model.ts:10-16`(`AssignMenuAction`) · 152(`buildTableItems`), `components/assign/assign-context-menu.tsx:21-66 · 83-199`, `components/ui/menu-lang-row.tsx`(`onReach` 하나), `use-assign-page.tsx`(1251 `buildUnitMenu`, 1777 `runUnitAction`), `page.tsx`(메뉴 자리), `styles/components.css`(새 선택자), `lib/i18n-messages.ts` · **Test**: `lib/assign-context-menu-model.test.ts`
- **Interfaces** — Consumes: `buildAssignMenu`(모양 그대로 — 단추 줄 · 다듬기 줄이 같은 `edit`을 쓴다), `formatAssignKey`, `unwrapTable` · `rewrapTable`, `use-unwrap-ai`의 요청. Produces: `buildMenuSections`, `readMenuReach`, `buildReachCss`.
### T1 — 구역 모델
```ts
export type MenuPlace = { kind: "text" } | { kind: "table" | "cell" | "unwrapped"; table: number; row: number | null; col: number | null };
export interface MenuSection { id: "assign" | "edit" | "cell" | "table"; headKey: string; headVars: Record<string, number>; items: AssignMenuItem[] }
export function readMenuPlace(target: ViewUnit, table: ViewUnit | null, unwrappedTable: ViewTable | null, blocks: ReadonlyMap<number, ViewBlock>): MenuPlace   // 행 · 열은 칸 블록의 값 + 1
export function buildMenuSections(groups: AssignMenuGroups, place: MenuPlace, tableItems: readonly AssignMenuItem[]): MenuSection[]
```
값: `text` → 지금 두 묶음(배정 · 문장 고치기). `cell` → 이 칸 = `edit`(표 항목 빼고), 이 표 = 배정 취소 · 표 벗기기 · **표 전체 삭제**(맨 끝, 구분선 · 경고색). `unwrapped` → 이 칸 = 배정 묶음 + `edit`, 이 표 = 다시 표로 · AI 순서. `table`(표 머리 우클릭) → 이 표 하나. New는 배정 항목이 없다(`assign: []` 그대로). 캡션 · 그림은 `text`와 같은 지금 모양. 문구는 C2 표 + `assign.ctx.table.clear` en `Unassign table` / ko `표 배정 취소`, `assign.ctx.table.undoDelete` en `Undo delete of the table` / ko `표 삭제 취소`, `.table.delete` en `Delete whole table` / ko `표 전체 삭제`, 구역 머리 en `This cell · row {r}, col {c}` · `This table · Table {n}` / ko `이 칸 · {r}행 {c}열` · `이 표 · 표 {n}`(행 · 열을 모르면 `This cell` / `이 칸`). testid `assign-ctx-<action>` 그대로, 구역 `assign-ctx-section-<id>`.
- [ ] 시험 `menu-section-model.test.ts`:
  ```ts
  it("splits a table cell into this cell and this table", () => { const s = buildMenuSections(menu(cell), at("cell"), []); expect(s.map((x) => x.id)).toEqual(["cell", "table"]); expect(actions(s[0])).not.toContain("table_layout"); expect(actions(s[1])).toEqual(["clear", "table_layout", "delete"]); expect(s[1].items.at(-1)?.labelKey).toBe("assign.ctx.table.delete"); });
  it("keeps the row's own decisions with an unwrapped line and puts back-to-table below", () => { const s = buildMenuSections(menu(line), at("unwrapped"), [item("table_rewrap"), item("table_ai_order")]); expect(actions(s[0]).slice(0, 2)).toEqual(["clear", "split"]); expect(actions(s[0])).toContain("delete"); expect(actions(s[1])).toEqual(["table_rewrap", "table_ai_order"]); });
  it("leaves a plain sentence as it was", () => expect(buildMenuSections(menu(sentence), { kind: "text" }, []).map((x) => [x.id, actions(x)])).toEqual([["assign", ["clear", "delete"]], ["edit", editActions]]));
  it("has only shape sections on a New document", () => expect(buildMenuSections({ ...menu(cell), assign: [] }, at("cell"), []).map(actions)[1]).toEqual(["table_layout"])); it("reads row and column from the cell block", () => expect(readMenuPlace(cell, table, null, blocks)).toEqual({ kind: "cell", table: 2, row: 2, col: 2 }));
  it("names undo delete for a deleted table", () => expect(buildMenuSections(menu(cell, { isDeleted: true }), at("cell"), [])[1].items[0].labelKey).toBe("assign.ctx.table.undoDelete"));
  ```
- [ ] 실패 확인 `npx vitest run src/lib/menu-section-model.test.ts` → 모듈 없음
- [ ] 구현: `AssignMenuAction`에 `table_rewrap` · `table_ai_order`(아이콘 · 이름은 있는 `assign.unwrap.rewrap` · AI 순서 문구). `export function buildUnwrappedTableItems(ctx: { readOnly: boolean; hasDraft: boolean; isAiOn: boolean; isAiBusy: boolean }): AssignMenuItem[]`(꺼진 까닭은 있는 `assign.ctx.why.*` · 머리 단추와 같은 문구)
- [ ] 같은 명령 + `npx vitest run src/lib/assign-context-menu-model.test.ts` 통과(`buildAssignMenu`의 있는 시험은 바꾸지 않는다) → **커밋** `feat(assign): split the table menu into this cell and this table — 표 우클릭을 이 칸 · 이 표로 나눔`
### T2 — 닿는 칸 모델
```ts
export interface MenuReach { change: readonly number[]; touch: readonly number[]; around: readonly number[] }   // 진한 칠 · 점선 · 표 둘레(아직 표면 표 Unit, 벗긴 표면 그 줄 모두)
export function readMenuReach(item: Pick<AssignMenuItem, "action" | "holder">, ctx: { target: ViewUnit; prev: ViewUnit | null; next: ViewUnit | null; rowUnitIds: readonly number[]; pairIds: readonly number[]; place: MenuPlace; tableUnitIds: readonly number[] }): MenuReach
export function buildReachCss(side: "old" | "new", reach: MenuReach): string   // [data-strip-unit="n"] 선택자만, 값은 토큰
```
- [ ] 시험 `menu-reach-model.test.ts`:
  ```ts
  it("merging marks the target and the neighbour", () => expect(readMenuReach({ action: "merge_prev" }, ctx)).toEqual({ change: [2], touch: [1], around: [] })); it("pairing with the next marks the next", () => expect(readMenuReach({ action: "pair_next" }, ctx)).toEqual({ change: [2], touch: [3], around: [] }));
  it("unpair marks every member, caption of marks its holder", () => { expect(readMenuReach({ action: "unpair" }, ctx).change).toEqual([2, 9]); expect(readMenuReach({ action: "caption_of", holder }, ctx).touch).toEqual([40]); });
  it.each(["table_layout", "table_rewrap", "table_ai_order"] as const)("%s goes around the table", (action) => expect(readMenuReach({ action }, ctx)).toEqual({ change: [], touch: [], around: [10] }));
  it("clear and delete go around the table in a cell, and mark the row elsewhere", () => { expect(readMenuReach({ action: "delete" }, inCell).around).toEqual([10]); expect(readMenuReach({ action: "delete" }, inText).change).toEqual([2]); });
  it("writes selectors for one pane only", () => { const css = buildReachCss("old", { change: [2], touch: [1], around: [] }); expect(css).toContain('[data-pane="old"] [data-strip-unit="2"]'); expect(css).not.toMatch(/#[0-9a-f]{3}/i); });
  it("writes nothing when nothing is reached", () => expect(buildReachCss("old", { change: [], touch: [], around: [] })).toBe(""));
  ```
- [ ] 실패 확인 `npx vitest run src/lib/menu-reach-model.test.ts` → 모듈 없음
- [ ] 구현 → 같은 명령 통과 → **커밋** `feat(assign): model what each menu item touches — 메뉴 항목이 닿는 칸을 모델로`
### T3 — 메뉴와 칠하기를 건다
`ReachPaint({ side, reach }: { side: "old" | "new"; reach: MenuReach | null })`는 `<style data-testid="assign-ctx-reach">{buildReachCss(...)}</style>` 하나 — 메뉴가 닫히면 React가 함께 떼므로 정리 이펙트가 없고 `Paper`를 다시 그리지 않는다. `AssignContextMenu` props: `groups` → `sections: MenuSection[]`, `onReach: (item: AssignMenuItem | null) => void`(항목의 `onPointerEnter` · `onFocus` / `onPointerLeave` · `onBlur`, 꺼진 항목도). 글쇠 표시는 `formatAssignKey`(표 벗기기 · 다시 표로 ⇧T, AI 순서 ⇧O, 언어 ⇧L, 삭제 Del, 배정 취소 U).
- [ ] 시험 `reach-paint.test.ts`:
  ```ts
  it("draws a style with the reached units", () => expect(html({ side: "new", reach: { change: [70], touch: [], around: [] } })).toMatch(/<style[^>]*assign-ctx-reach[^>]*>[^<]*data-pane=.*70/)); it("draws nothing without a reach", () => expect(html({ side: "old", reach: null })).toBe(""));
  it("the menu lists sections in order with the pinned testids", () => expect(ids(menuHtml(cellSections))).toEqual(["assign-ctx-section-cell", "assign-ctx-split", "assign-ctx-section-table", "assign-ctx-clear", "assign-ctx-table_layout", "assign-ctx-delete"]));
  ```
- [ ] 실패 확인 `npx vitest run src/components/assign/reach-paint.test.ts` → 모듈 없음
- [ ] 구현: `runUnitAction`에 `table_rewrap` → `rewrapTable` · `table_ai_order` → 머리 단추와 같은 요청. 자리 잡기(`placeLinkMenu`) · 닫기 규칙은 그대로
- [ ] 같은 명령 + 전체 `npx vitest run` · `source-rules.test.ts` 통과 → **커밋** `feat(assign): paint the cells a menu item reaches — 항목에 올리면 닿는 칸을 칠함`
### 브랜치 끝
- **스모크**: `assign.mjs:708` · `:845-846` · `:902`는 testid가 그대로라 바뀌지 않는다. §14가 적은 `:885-888`은 문장의 "캡션으로 쓰기" 단계라 고칠 것이 없다(확인만). `:4914-4915`("Undo delete" · Delete 없음)도 그대로. 새 단계 `assign: the cell menu has this cell and this table, hovering paints the reached cells`(S9 — Old 표 칸, 벗긴 줄, New 표 칸). `pw-overlap-audit.mjs`에 표 칸 메뉴 장면 하나(감사는 정식 업데이트 때).
- **설명서**: `#assign-context` 표(562-576행) — 묶음 열을 구역으로, `#assign-unwrap` 688행(우클릭에도 다시 표로 · AI 순서). **CHANGELOG**: `표를 우클릭하면 "이 칸"과 "이 표"로 나뉘어 나오고, 항목에 올리면 바뀌는 칸이 칠해집니다.`
- **세워 둘 조건**: ① 칠하려면 `Paper`를 다시 그려야 한다(긴 문서에서 호버가 느려진다). ② 이어지는 포커스 이동(↑↓)에서 칠이 남는다. ③ `menu.tsx` 공용 부품의 규칙을 바꿔야 한다.

## feat/assign-multi-mark
- **한 문장:** 여럿 고른 줄이 이어진 덩어리마다 테 하나와 "n줄 고름" 꼬리표, 줄마다 칠 · 왼쪽 막대 · 오른쪽 체크로 보인다 (§9 [U 시안 1차]).
- **Files** — **Create**: `frontend/src/lib/multi-mark-model.ts` · `.test.ts`, `src/styles/contrast.test.ts` · **Modify**: `components/paper/paper.tsx`(`PaperProps`, `renderRow` 1184, `renderGap` 1281, `renderDeletedLine` 1409, `PaperChunk` deps 1577), `components/assign/old-pane.tsx:148-169`, `components/assign/new-paper.tsx`, `page.tsx:371`(`pickedOld`에서 여럿 고름을 떼어 냄 — 짝 고르기의 `data-pick`은 그대로), `styles/components.css`(새 선택자, 1404 `.deleted-line[data-pick]`), `lib/i18n-messages.ts` · **Test**: `components/paper/paper-pick.test.ts`
- **Interfaces** — Consumes: `checked`(Old 줄 키) · `checkedNew`(New Unit id). Produces: `CheckMark` · `buildCheckMarks`, `Paper`의 `checks?: ReadonlyMap<string, CheckMark>`(카드 첫 줄 key).
### T1 — 덩어리 모델
```ts
export interface CheckMark { edge: "only" | "top" | "middle" | "bottom"; count: number | null }   // count는 덩어리 첫 카드에만 — 그 덩어리의 줄(판단 줄) 수
export function buildCheckMarks(cards: readonly { key: string; unitIds: readonly number[] }[], checkedUnitIds: ReadonlySet<number>, rowKeyOf: (unitId: number) => string): ReadonlyMap<string, CheckMark>
export function readCheckKey(marks: ReadonlyMap<string, CheckMark>, cardKeys: readonly string[]): string   // PaperChunk deps에 넣는 글 하나
```
- [ ] 시험 `multi-mark-model.test.ts`:
  ```ts
  it("rings a run once and counts its rows", () => expect(marks([1, 2, 3])).toEqual({ a: { edge: "top", count: 3 }, b: { edge: "middle", count: null }, c: { edge: "bottom", count: null } }));
  it("makes two runs of rows apart", () => { const m = marks([1, 4]); expect(m.a).toEqual({ edge: "only", count: 1 }); expect(m.d).toEqual({ edge: "only", count: 1 }); });
  it("counts a pair card as one row", () => expect(buildCheckMarks([{ key: "a", unitIds: [1, 2] }], new Set([1, 2]), () => "r1").get("a")).toEqual({ edge: "only", count: 1 })); it("a folded noise block between rows breaks the run", () => expect(marks([1, 3], { toc: 2 }).c.edge).toBe("only"));
  it("the chunk key changes only with its own cards", () => { expect(readCheckKey(all([1]), ["a"])).not.toBe(readCheckKey(all([]), ["a"])); expect(readCheckKey(all([4]), ["a"])).toBe(readCheckKey(all([]), ["a"])); });
  ```
- [ ] 실패 확인 `npx vitest run src/lib/multi-mark-model.test.ts` → 모듈 없음
- [ ] 구현 → 같은 명령 통과 → **커밋** `feat(assign): model runs of rows picked together — 여럿 고른 줄의 덩어리를 모델로`
### T2 — 그리기와 대비
값: 테 3px `--accent`, 칠 `--accent-tint`, 왼쪽 막대 4px(**막대 쪽 모서리 직각**), 체크는 `.strip-marks`의 첫 아이콘(따로 띄우지 않는다 — 끝 아이콘 · 이음 배지와 겹치지 않게), 꼬리표 `.check-tag`는 덩어리 첫 카드 위 테두리 선 왼쪽(`.group-tag`와 같은 자리 — 여럿 고른 동안은 `.group-tag`를 그리지 않는다), testid `assign-check-run-<첫 unitId>`, 글 en `{n} rows picked` / ko `{n}줄 고름`(`classify.pickedCount` 그대로). 덩어리 안 틈(`.strip-gap`)에 `data-check="gap"`으로 좌우 선을 이어 테가 하나로 보인다. 접힌 삭제 줄도 같은 표시.
- [ ] 시험 `paper-pick.test.ts`와 `contrast.test.ts`(토큰 파일을 읽어 oklch를 직접 sRGB로 — 새 의존성 없음):
  ```ts
  it("draws one tag per run and a check on every row", () => { const h = html({ checks: run3 }); expect(h.match(/check-tag/g)).toHaveLength(1); expect(h.match(/data-check="(top|middle|bottom)"/g)).toHaveLength(3); expect(h.match(/strip-check/g)).toHaveLength(3); expect(h.match(/data-check="gap"/g)).toHaveLength(2); });
  it("draws no mark without checks", () => expect(html({ checks: new Map() })).not.toContain("data-check"));
  it.each(["light", "dark"] as const)("%s ring reads at 3:1 on the paper and on its own fill", (theme) => { expect(contrast(token(theme, "--accent"), token(theme, "--paper"))).toBeGreaterThanOrEqual(3); expect(contrast(token(theme, "--accent"), mixTint(theme))).toBeGreaterThanOrEqual(3); });
  ```
- [ ] 실패 확인 `npx vitest run src/components/paper/paper-pick.test.ts src/styles/contrast.test.ts` → `check-tag` 없음
- [ ] 구현: `PaperChunk` deps 끝에 `readCheckKey` 글 **하나만**. `strip-check` 표시는 `data-tip`(아이콘만 있는 표시는 툴팁)
- [ ] 같은 명령 + `npx vitest run src/source-rules.test.ts` 통과 → **커밋** `feat(assign): show rows picked together as runs — 여럿 고른 줄을 덩어리로 보임`
### 브랜치 끝
- **스모크**: `assign.mjs:517-527`(일괄)에 덩어리 꼬리표 2개(nth 4 · 6은 떨어져 있다) 검사를 더한다(있는 검사는 그대로). `:1848-1859` 그대로. 새 단계 없음.
- **설명서**: `#assign-bulk` 725행 앞에 고른 줄이 어떻게 보이는지 한 문장, `#assign` 421행. **CHANGELOG**: `여럿 고른 줄이 덩어리마다 굵은 테와 "n줄 고름" 꼬리표로 눈에 띕니다.`
- **세워 둘 조건**: ① 화면 밖 덩어리까지 늘 다시 그려야 표시가 맞는다(`readCheckKey`로 안 되면). ② 감사(`pw-contrast-audit`)가 글자 대비를 새로 잡는다.

## feat/assign-multi-merge
- **한 문장:** 여럿 고른 줄을 위쪽 바에서 한 편집으로 합치거나(짝 줄이면 언어끼리 합쳐 다시 짝), 표 여럿을 한 번에 벗긴다 (§9, `MergeRowsOp` · `SetLayoutTablesOp`).
- **Files** — **Create**: `backend/tests/test_sop_merge_rows.py`, `frontend/src/lib/multi-pick-model.ts` · `.test.ts` · **Modify**: `backend/app/sop/editing.py`(141 옆 op 둘, 328 `EditOp`, 422-457 `_Change.merged`, 643 옆 계획 둘, 659-712 합치기 풀기, 834 `_plan_piece_language`, 1315, 1787 `_plan`, 2265 `apply_edit`의 `payload`), `app/routers/sop_documents.py:43 · 549-563`, `frontend/src/lib/api-sop.ts:509-547`, `lib/assign-focus-model.ts:222-309`, `lib/decision-step-model.ts:48-52`, `use-assign-page.tsx`(1399 · 1443 · 1494), `assign-bar.tsx:76-87`, `page.tsx`, `lib/i18n-messages.ts` · **Docs(같은 커밋, "표는 하나씩")**: `backend/CLAUDE.md:65`, `docs/architecture/backend.md:324`, `docs/architecture/api-contract.md`(57 · 61 옆), `user-manual.md:700 · 705`, `app/sop/editing.py:176`의 docstring, `tests/test_sop_pair_tables.py:1`의 docstring · **Test**: `tests/test_sop_unwrap.py` · `test_sop_pair_tables.py` · `test_sop_editing.py:1181`(있는 필드 시험이 `merged`도 본다), 프런트 위 `.test.ts` · `assign-focus-model.test.ts` · `decision-step-model.test.ts`
- **Interfaces** — Consumes: `_plan_merge`의 규칙(`_ensure_mergeable` · `_build_draft` · `join_close_spans`), `_create_human_pair`, `_merge_changes`, `confirm_required`(New 표는 계획 3의 `linked_cells` · `held_rows`), `listUnwrapScopes`. Produces: 색인 이름 `MergeRowsOp`(`merge_rows`, `unit_ids`) · `SetLayoutTablesOp`(`set_layout_tables`, `table_ids`), `read_merged_pieces`, `planMultiMerge` · `planMultiUnwrap`.
### T1 — `merge_rows` (backend)
```python
class MergeRowsOp(BaseModel):
    """고른 줄(짝이면 구성원 모두)을 언어마다 하나로 합치고, 한글 · 영어가 다 있으면 합친 둘을 사람이 맺은 짝으로 — 편집 하나, 되돌리기 한 번."""
    type: Literal["merge_rows"]
    unit_ids: list[DbId] = Field(min_length=2, max_length=MAX_EDIT_UNITS)

async def _plan_merge_rows(session: AsyncSession, extraction_id: ExtractionId, op: MergeRowsOp) -> _Change
```
규칙: ① 글 종류 · 잡음 · 칸 묶음 검사는 `_plan_merge`와 같다(언어 무리마다 `_ensure_mergeable`). ② 고른 Unit이 든 짝의 구성원이 빠졌으면 422 `cannot_merge`(`reason: "pair_part"`). ③ 언어가 한 가지면 하나로. 한글 · 영어가 섞였는데 짝이 하나도 없으면 422 `cannot_merge`(`reason: "mixed"`), 그 밖의 섞임도 같다. ④ 무리에 Unit이 하나면 은퇴시키지 않고 그대로 짝의 한쪽이 된다. ⑤ 짝은 `pair_drafts` · `pair_units`로(편집 하나). ⑥ 이웃 검사는 화면이 한다(지금 `MergeOp`과 같다). `_Change.merged: list[list[int]]` = 초안마다 은퇴시킨 단위 id(초안 순서), `apply_edit`은 값이 있을 때만 `payload["merged"]`로 남긴다.
- [ ] 시험 `test_sop_merge_rows.py`(`_edit` · `_ok` · `_pair_of` · `_undo` · `_redo` · `_dump` · `assert_same_state`는 `test_sop_lang_shape` · `test_sop_decision_undo`에서 들여온다, 문서는 `p(KO1) + p(EN1) + p(KO2) + p(EN2)`):
  ```python
  def test_pair_rows_merge_by_language_and_pair_again(client):
      before = _dump(bundle_id); result = _ok(_edit(client, bundle_id, doc_id, {"type": "merge_rows", "unit_ids": ids}))
      ko, en = (_active(view)[unit_id] for unit_id in result["created_unit_ids"])
      assert (ko["lang"], en["lang"], ko["text"], en["text"]) == ("ko", "en", f"{KO1} {KO2}", f"{EN1} {EN2}")
      assert _pair_of(view, ko["id"])["unit_ids"] == sorted([ko["id"], en["id"]]) and _pair_of(view, ko["id"])["status"] == "confirmed"
      _ok(_undo(client, bundle_id)); assert_same_state(_dump(bundle_id), before)
      _ok(_redo(client, bundle_id)); assert _pair_of(get_view(client, bundle_id, doc_id), ko["id"]) is not None
  def test_one_language_rows_merge_to_one_without_a_pair(client): assert len(result["created_unit_ids"]) == 1 and view["pairs"] == []
  def test_a_lone_korean_row_joins_a_pair_row(client): assert _pair_of(view, merged["id"])["unit_ids"] == sorted([merged["id"], en["id"]]) and en["id"] not in result["retired_unit_ids"]
  def test_unpaired_mixed_rows_and_a_half_of_a_pair_are_refused(client): assert (_rule(a)["code"], _rule(a)["reason"]) == ("cannot_merge", "mixed") and _rule(b)["reason"] == "pair_part"
  def test_decided_rows_ask_once_and_undo_brings_the_decisions_back(client): assert _code(first) == (409, "confirm_required")   # confirm 뒤 Ctrl+Z로 판단 · 이음이 처음과 같다
  def test_new_document_rows_merge_and_their_targets_follow(client): assert len([t for t in _targets(bundle_id) if t["new_unit_id"] in result["created_unit_ids"]]) == 2
  def test_a_toc_line_is_refused(client): assert _code(response)[0] == 422
  ```
- [ ] 실패 확인 `.venv/bin/python -m pytest tests/test_sop_merge_rows.py -q` → 422 `union_tag_invalid`(모르는 op)
- [ ] 구현: 서명대로. `rule.cannot_merge.pair_part` · `.mixed` 문구 en · ko
- [ ] 같은 명령 + `pytest tests/test_sop_editing.py tests/test_sop_lang_shape.py tests/test_sop_decision_undo.py tests/test_sop_pair_settle.py tests/test_invariants.py -q` 통과 → **커밋** `feat(editing): merge several rows and pair them again in one edit — 여러 줄을 한 편집으로 합쳐 다시 짝`
### T2 — 합친 박스의 조각과 풀기 (backend)
`is_merge_edit`은 만든 단위가 하나일 때만 알아, 짝 줄을 합친 두 박스는 "합친 문장 풀기 · 조각 언어 · 한 문장 ↔ 짝"이 죽는다. `def read_merged_pieces(op: str, payload: Mapping[str, object], created: Sequence[int], retired: Sequence[int]) -> dict[int, list[int]]`(만든 단위 → 그것이 된 단위, `merge_rows`는 `payload["merged"]`, 옛 `merge` · `switch_language`는 지금 규칙)로 `is_merge_edit`의 쓰임(`find_merge_edit` · `_plan_unmerge` · `_plan_piece_language` · `sop_documents.py:562`)을 모두 바꾼다.
- [ ] 시험 `test_sop_merge_rows.py`:
  ```python
  def test_one_half_unmerges_and_the_other_half_stays(client):
      _ok(_edit(client, bundle_id, doc_id, {"type": "unmerge", "unit_id": ko["id"]}))
      view = get_view(client, bundle_id, doc_id); assert {KO1, KO2} <= {u["text"] for u in view["units"]} and _pair_of(view, en["id"]) is None and _active(view)[en["id"]]["can_unmerge"]
  def test_view_lists_the_pieces_of_both_halves(client): assert (unit(ko)["merge_pieces"], unit(en)["merge_pieces"], unit(ko)["can_unmerge"]) == ([KO1, KO2], [EN1, EN2], True)
  def test_a_row_merged_from_one_half_lists_its_own_pieces(client): assert unit(en)["merge_pieces"] == [] and unit(ko)["merge_pieces"] == [KO1, KO2]
  ```
- [ ] 실패 확인 `.venv/bin/python -m pytest tests/test_sop_merge_rows.py -q -k "unmerge or pieces"` → `can_unmerge` False
- [ ] 구현: 서명대로(옛 기록의 답은 그대로) → 같은 명령 + `pytest tests/test_sop_editing.py tests/test_sop_lang_shape.py tests/test_sop_pair_reorder.py -q` 통과 → **커밋** `feat(editing): read the pieces of rows merged together — 함께 합친 줄의 조각을 읽음`
### T3 — `set_layout_tables` (backend)
```python
class SetLayoutTablesOp(BaseModel):
    """표 여럿 벗기기 — 편집 하나(되돌리기 한 번), 짝 제안은 끝에 한 번. 하나라도 안 되면 아무것도 쓰지 않는다."""
    type: Literal["set_layout_tables"]
    table_ids: list[DbId] = Field(min_length=1, max_length=MAX_EDIT_UNITS)

async def _plan_set_layout_tables(session: AsyncSession, document_id: int, extraction_id: ExtractionId, op: SetLayoutTablesOp) -> _Change
```
규칙: 표마다 `_plan_set_layout_table`의 변경을 `_merge_changes`로 잇는다. 바깥 표가 함께 고른 안쪽 띠 표를 데려가므로 **바깥 표가 목록에 있는 띠 표는 건너뛴다**(같은 단위를 두 번 은퇴시키지 않게). 이미 벗긴 표는 지금처럼 바뀌는 것이 없다. 겹치는 `table_id`는 422 `duplicate_units`와 같은 꼴(`reason: "tables"`). 옛 `set_layout_table`은 그대로 둔다(D1 · 화면의 한 표 벗기기가 쓴다).
- [ ] 시험 `test_sop_pair_tables.py`와 `test_sop_unwrap.py`:
  ```python
  def test_unwrapping_two_tables_at_once_pairs_their_lines_and_is_one_undo(client):   # 한글 · 영어 작업 표
      result = _ok(_edit(..., {"type": "set_layout_tables", "table_ids": [ko_table, en_table]}))
      assert _pairs(view) == WORK_PAIRS and {t["id"] for t in view["tables"] if t["is_layout"]} == {ko_table, en_table}
      _step(client, bundle_id, doc_id, "undo"); assert not any(t["is_layout"] for t in get_view(client, bundle_id, doc_id)["tables"])
  def test_an_inner_band_picked_with_its_outer_table_changes_once(client): assert len(set(result["retired_unit_ids"])) == len(result["retired_unit_ids"])
  def test_one_bad_table_changes_nothing(client): assert response.status_code == 404 and get_view(...)["document"]["revision"] == 1
  def test_decided_lines_of_several_tables_ask_once(client): assert _code(response) == (409, "confirm_required")
  def test_new_document_tables_unwrap_together(client): assert len(_targets(new_doc)) == len(lines)
  ```
- [ ] 실패 확인 `.venv/bin/python -m pytest tests/test_sop_pair_tables.py tests/test_sop_unwrap.py -q -k "at_once or picked_with or bad_table or several"` → 422
- [ ] 구현: 서명대로 → 같은 명령 + `pytest tests/test_sop_tables.py tests/test_sop_unwrap_nested.py tests/test_sop_ai_unwrap_order.py -q` 통과 → **커밋** `feat(editing): unwrap several tables in one edit — 표 여럿을 한 편집으로 벗김`
### T4 — 고른 줄의 계획 (프런트)
```ts
export interface MultiRow { key: string; docId: number; units: readonly ViewUnit[] }
export type MultiPlan<T> = { ok: true; value: T } | { ok: false; reasonKey: string };
export function planMultiMerge(rows: readonly MultiRow[], order: readonly number[], hasDraft: (unit: ViewUnit) => boolean): MultiPlan<readonly number[]>   // unit_ids(용지 순)
export function planMultiUnwrap(rows: readonly MultiRow[], tables: ReadonlyMap<number, ViewTable>): MultiPlan<readonly number[]> | null   // null = 표만 고른 것이 아니다(단추 없음)
export function listNewRows(unitIds: readonly number[], units: ReadonlyMap<number, ViewUnit>, docId: number): MultiRow[]   // checkedNew → 짝까지 한 줄
```
규칙: 언어 무리마다 용지 순서로 이웃이어야 한다 — 둘 사이에 있는 Unit이 **모두 고른 것이면** 이웃이다(번갈아 놓인 한/영 짝). 막는 까닭은 `getMergeBlocker` · `split.menu.why.*` · `assign.ctx.why.unsaved`, 새 것 `assign.bulk.why.two`(둘 이상) · `.otherDoc`(다른 문서) · `.notAdjacent` · `.mixed`.
- [ ] 시험 `multi-pick-model.test.ts`:
  ```ts
  it("merges alternating pair rows", () => expect(planMultiMerge([row(1, 2), row(3, 4)], [1, 2, 3, 4], none)).toEqual({ ok: true, value: [1, 2, 3, 4] }));
  it("merges separate-language pair rows when each language is a run", () => expect(planMultiMerge([row(1, 5), row(2, 6)], [1, 2, 5, 6], none)).toEqual({ ok: true, value: [1, 2, 5, 6] }));
  it("refuses a gap, another document, one row and an unsaved row", () => { expect(reason([row(1), row(3)], [1, 2, 3])).toBe("assign.bulk.why.notAdjacent"); expect(reason([row(1), rowOf(9, 2)])).toBe("assign.bulk.why.otherDoc"); expect(reason([row(1)])).toBe("assign.bulk.why.two"); expect(planMultiMerge([row(1), row(2)], [1, 2], () => true)).toMatchObject({ reasonKey: "assign.ctx.why.unsaved" }); });
  it("refuses unpaired rows in two languages", () => expect(reason([koOnly, enOnly], [1, 2])).toBe("assign.bulk.why.mixed"));
  it("unwraps only tables of one document", () => { expect(planMultiUnwrap([tableRow(10), tableRow(11)], tables)).toEqual({ ok: true, value: [4, 5] }); expect(planMultiUnwrap([tableRow(10), row(1)], tables)).toBeNull(); expect(planMultiUnwrap([tableRow(10), tableRowOf(9)], tables)).toMatchObject({ reasonKey: "assign.bulk.why.otherDoc" }); });
  it("reads New rows with their pair", () => expect(listNewRows([70], units, 7)[0].units.map((unit) => unit.id)).toEqual([70, 71]));
  ```
- [ ] 실패 확인 `npx vitest run src/lib/multi-pick-model.test.ts` → 모듈 없음
- [ ] 구현 → 같은 명령 통과 → **커밋** `feat(assign): plan merging and unwrapping rows picked together — 여럿 고른 줄의 합치기 · 벗기기 계획`
### T5 — 위쪽 바에 건다
`EditOp`에 `{ type: "merge_rows"; unit_ids: number[] }` · `{ type: "set_layout_tables"; table_ids: number[] }`, `readEditKind` join · unwrap, `listEditUnitIds` unit_ids · `[]`(잠글 Unit은 `listTableUnitIds`를 표마다 모음), `readEditPlace` 첫 박스 · 첫 표, 풀기 전환은 표마다의 `listUnwrapScopes`를 이은 것, `UNIT_EDIT_STEP_OPS` · `assign.step.merge_rows` · `.set_layout_tables`. 바: `assign-bulk-merge`(늘 보이고 못 하면 `aria-disabled` + 까닭 툴팁) · `assign-bulk-unwrap`(표만 골랐을 때). 누르면 고름을 비우고 `runUnitEdit(shapeOf(side), op, …)` — 장벽 명령(앞 계획 규칙 그대로), `confirm_required`는 지금 확인창(표는 계획 3의 글).
- [ ] 시험 `assign-focus-model.test.ts`와 `decision-step-model.test.ts`:
  ```ts
  it.each([[{ type: "merge_rows", unit_ids: [1, 2] }, "join", [1, 2]], [{ type: "set_layout_tables", table_ids: [4] }, "unwrap", []]])("locks and names %o", (op, kind, ids) => { expect(readEditKind(op as EditOp)).toBe(kind); expect(listEditUnitIds(op as EditOp)).toEqual(ids); });
  it("places a multi unwrap on its first table", () => expect(readEditPlace({ type: "set_layout_tables", table_ids: [4, 5] })).toEqual({ at: "table", tableId: 4 }));
  it("merge rows and several tables are edit steps", () => { expect(isUnitEditStep("merge_rows")).toBe(true); expect(shouldDropSelectionOnStep({ op: "set_layout_tables", unit_ids: [1] })).toBe(true); });
  ```
- [ ] 실패 확인 `npx vitest run src/lib/assign-focus-model.test.ts src/lib/decision-step-model.test.ts` → tsc · 기대 어긋남
- [ ] 구현: 서명대로, 위 Docs 여섯 곳의 "하나씩"을 "한 표씩 또는 여럿을 골라 한 번에"로
- [ ] 같은 명령 + 전체 `npx vitest run` · tsc 통과 → **커밋** `feat(assign): merge and unwrap rows picked together from the bar — 여럿 고른 줄을 바에서 합치고 벗김`
### 브랜치 끝
- **스모크**: 새 단계 둘 — `assign: rows picked together merge by language and pair again, one Ctrl+Z`(Old · New 양 단) · `assign: two tables unwrap together from the bar`(대응 표 단계 5183과 같은 합성 묶음). 있는 단계는 바꾸지 않는다(대응 표 단계 5183은 한 표씩 그대로 — 여전히 되는 길).
- **설명서**: `#assign-bulk` 725 · 727행(합치기 · 표 벗기기), `#assign-unwrap` 700행 · `#assign-unwrap-pair` 705행("하나씩" 고침), `#assign-undo` 743행. **CHANGELOG**: `여럿 고른 줄을 한 번에 합치거나(짝 줄이면 한글끼리 · 영어끼리 합쳐 다시 짝) 표 여럿을 한 번에 벗깁니다 — 되돌리기 한 번.`
- **세워 둘 조건**: ① 다시 하기가 짝을 되살리지 못한다(Assign 단계의 짝 되쓰기가 `merge_rows`에서 어긋남). ② `merged`를 `payload`에 남기는 것으로 옛 기록의 풀기 답이 달라진다. ③ 번호 당기기를 여기서 넣고 싶어진다 — D1의 몫이라 넣지 않는다.

## feat/assign-multi-pick
- **한 문장:** ⇧G로 고른 줄을 넣고 빼고, 위쪽 바에서 삭제 · 배정 취소 · 언어를 한 번에 한다 (G1-R1~R4, To-Be · 다른 Bundle 이동 없음).
- **Files** — **Modify**: `backend/app/sop/decisions.py:174`(`BulkDecisionIn`) · 1670 옆(`clear_units`), `app/routers/sop_decisions.py:111-121`, `frontend/src/lib/multi-pick-model.ts` · `.test.ts`, `lib/api-sop.ts`(`bulkDecide` 본문 타입), `lib/assign-keymap.ts`, `use-assign-page.tsx`(3331-3342, `bulkDecide` 자리), `assign-bar.tsx:76-87`, `lib/i18n-messages.ts`, `docs/architecture/api-contract.md` · **Test**: `backend/tests/test_sop_decisions.py:1064` 옆, `test_sop_decision_undo.py`, `assign-keymap.test.ts`
- **Interfaces** — Consumes: 앞 브랜치 `MultiRow`, `ASSIGN_KEYS`(줄만 더한다), 큐의 일괄 명령. Produces: `toggleChecked` · `planBulkClear` · `planBulkLang`.
### T1 — 일괄 배정 취소는 요청 하나 (backend)
지금 길(`clearDecisions`)은 Unit마다 요청이라 N번 덤프하고 가운데서 실패하면 반만 취소된다. `BulkDecisionIn.action: Literal["delete", "move_external", "clear"]`, `async def clear_units(session: AsyncSession, bundle: Bundle, payload: BulkDecisionIn, actor: str) -> list[UnitDecisionRowOut]`(`clear_unit`과 같은 검사 · 기록 `decision.clear`, `detach_units` 한 번, 되돌리기 단계 이름 `clear`). `reason` · `move_target_code`는 읽지 않는다.
- [ ] 시험:
  ```python
  def test_bulk_clear_unassigns_every_row_in_one_step(client):
      assert {row["decision"]["disposition"] for row in _ok(_bulk_clear(client, fx, [a, b]))} == {"unassigned"}
      (step,) = _load_steps(fx.bundle_id)[-1:]; assert step.op == "clear"; _ok(_undo(client, fx.bundle_id)); assert_same_state(_dump(fx.bundle_id), before)
  def test_bulk_clear_refuses_a_stale_revision_and_changes_nothing(client): assert _code(response) == (409, "revision_conflict")
  def test_bulk_clear_holds_the_rest_of_a_linked_group(client): assert _status(other) == "on_hold"
  def test_bulk_clear_needs_an_author(client): assert response.status_code == 403
  ```
- [ ] 실패 확인 `.venv/bin/python -m pytest tests/test_sop_decisions.py tests/test_sop_decision_undo.py -q -k bulk_clear` → 422
- [ ] 구현: 서명대로, `api-contract.md` 한 줄 → 같은 명령 + `pytest tests/test_sop_ai_adoption.py tests/test_sop_reset.py tests/test_invariants.py -q` 통과 → **커밋** `feat(decisions): unassign several rows in one request — 여러 줄 배정 취소를 요청 하나로`
### T2 — ⇧G와 일괄 계획 (프런트)
```ts
export function toggleChecked(checked: ReadonlySet<string>, key: string, active: string | null, via: "click" | "key"): ReadonlySet<string>   // click은 첫 고름에 고르고 있던 줄도 넣는다(지금 규칙), key는 그 줄만
export function planBulkClear(rows: readonly MultiRow[], unitMap: ReadonlyMap<number, UnitRow>): MultiPlan<readonly { unit_id: number; revision: number }[]>
export interface BulkLang { unitIds: readonly number[]; skipped: number }
export function planBulkLang(rows: readonly MultiRow[], lang: "ko" | "en", isDecided: (unit: ViewUnit) => boolean): MultiPlan<BulkLang>
```
규칙: 배정 취소는 이미 미배정인 줄을 빼고 남은 것이 없으면 `assign.bulk.why.notAssigned`. 언어는 한 문서여야 한다(`.otherDoc`), 이미 그 언어 · 짝 · 합친 박스 · 글이 아님 · 참조 줄 · **배정된 줄**은 건너뛰고 수를 센다(묻기 2), 남은 것이 없으면 `.noneToChange`. 보내는 편집은 `set_language` 하나(`unit_ids` 여럿) = 되돌리기 한 칸.
- [ ] 시험 `multi-pick-model.test.ts`와 `assign-keymap.test.ts`:
  ```ts
  it("the key adds only the picked row, the click adds the active row too", () => { expect([...toggleChecked(new Set(), "b", "a", "key")]).toEqual(["b"]); expect([...toggleChecked(new Set(), "b", "a", "click")]).toEqual(["b", "a"]); expect([...toggleChecked(new Set(["b"]), "b", null, "key")]).toEqual([]); });
  it("clears only decided rows", () => { expect(planBulkClear([decided(1), open(2)], map)).toEqual({ ok: true, value: [{ unit_id: 1, revision: 3 }] }); expect(planBulkClear([open(2)], map)).toMatchObject({ reasonKey: "assign.bulk.why.notAssigned" }); });
  it("skips same-language, paired, merged, decided and non-text rows", () => { expect(planBulkLang([ko(1), en(2), pair(3, 4), merged(5), tableRow(10)], "en", (u) => u.id === 6)).toEqual({ ok: true, value: { unitIds: [1], skipped: 4 } }); expect(planBulkLang([pair(3, 4)], "en", none)).toMatchObject({ reasonKey: "assign.bulk.why.noneToChange" }); });
  it("lists Shift+G", () => expect(findAssignKey(key("g", true))).toMatchObject({ kind: "run", entry: { id: "multi_pick", when: "box" } }));
  ```
- [ ] 실패 확인 `npx vitest run src/lib/multi-pick-model.test.ts src/lib/assign-keymap.test.ts` → 함수 · 글쇠 없음
- [ ] 구현: `ASSIGN_KEYS`에 `{ id: "multi_pick", key: "g", shift: true, when: "box", labelKey: "assign.key.multiPick" }`
- [ ] 같은 명령 통과 → **커밋** `feat(assign): add rows to the picked set with Shift+G — ⇧G로 여럿 고름에 넣고 뺌`
### T3 — 위쪽 바
Old 바 차례: `n줄 고름` · 삭제(`assign-bulk-delete`) · 배정 취소(`assign-bulk-unassign`) · `→ KO`(`assign-bulk-lang-ko`) · `→ EN`(`assign-bulk-lang-en`) · 합치기 · 표 벗기기. New 바는 합치기 · 표 벗기기 · 언어 둘. 못 하는 것은 `aria-disabled` + 까닭 툴팁. 모두 `enqueue` 한 번(배정 취소는 일괄 명령과 같은 판단 명령 — 누르는 순간 대상을 잡고 고름을 다음 박스로, 언어는 장벽). 끝나면 고름을 비우고 언어는 en `{n} lines changed · {m} skipped` / ko `{n}줄 바꿈 · {m}줄 건너뜀`. 넓이가 모자라면 바가 줄을 넘긴다(있는 `flex-wrap`). Old · New 여럿 고름은 함께 있지 않는다 — 한쪽에서 처음 넣을 때 다른 쪽을 비운다(묻기 1).
- [ ] 시험 `multi-pick-model.test.ts`: `it("offers a bar per side", () => { expect(listBulkActions("old", rows)).toEqual(["delete", "unassign", "lang_ko", "lang_en", "merge"]); expect(listBulkActions("new", rows)).toEqual(["merge", "lang_ko", "lang_en"]); expect(listBulkActions("old", tableRows)).toContain("unwrap"); })`
- [ ] 실패 확인 `npx vitest run src/lib/multi-pick-model.test.ts` → `listBulkActions` 없음
- [ ] 구현: 바 부품과 문구 en · ko → 같은 명령 + 전체 `npx vitest run` 통과 → **커밋** `feat(assign): unassign and change the language of rows picked together — 여럿을 한 번에 배정 취소 · 언어`
### 브랜치 끝
- **스모크**: 새 단계 `assign: Shift+G picks rows, Unassign clears them in one step and Ctrl+Z brings both back, Esc drops the picks`(S6). 있는 `:517-527`(Shift+클릭 → 삭제)은 그대로. `assign-bulk-move`가 없는지 검사는 계획 1의 F2 단계가 이미 본다.
- **설명서**: `#assign-bulk` 725행(여럿을 한 번에 할 수 있는 것), `#assign-keys`(`ASSIGN_KEYS`에서), `#assign-undo` 743행. **CHANGELOG**: `⇧G로 여럿을 고르고 배정 취소와 언어 바꾸기를 한 번에 합니다.`
- **세워 둘 조건**: ① 일괄이 큐의 판단 명령과 다른 길을 새로 만든다. ② 한 번의 되돌리기가 일괄 전체를 못 되살린다.

## feat/split-by-sentence
- **한 문장:** 고른 박스 하나를 문장마다 나눈다 — 우클릭 · Shape 줄 · ⇧S, 되돌리기 한 번 (§9).
- **Files** — **Modify**: `backend/app/sop/editing.py`(op · `EditOp` · 계획 · `_plan`), `frontend/src/lib/api-sop.ts:509`, `lib/assign-focus-model.ts`(세 함수), `lib/decision-step-model.ts`, `lib/assign-context-menu-model.ts:10 · 325`(`SHAPE_LINE_ACTIONS`), `components/assign/assign-context-menu.tsx:21 · 44`(아이콘 · 이름), `lib/assign-keymap.ts`, `use-assign-page.tsx`(`runUnitAction`), `lib/i18n-messages.ts` · **Test**: `backend/tests/test_sop_editing.py`, `test_sop_decision_undo.py`, `assign-context-menu-model.test.ts`, `assign-keymap.test.ts`
- **Interfaces** — Consumes: `split_block_text(..., rule=RULE_LEGACY, split_lines=block.splits_lines)`, `_build_draft`. Produces: `SplitSentencesOp`(`split_sentences`, `unit_id`).
### T1 — 편집 하나 (backend)
`class SplitSentencesOp(BaseModel): type: Literal["split_sentences"]; unit_id: DbId`, `async def _plan_split_sentences(session: AsyncSession, extraction_id: ExtractionId, op: SplitSentencesOp) -> _Change`. 규칙: 범위마다 **규칙 1의 문장 경계**로 잘라 조각마다 초안 하나(범위 경계에서도 나뉜다 — 합친 박스는 합치기 전 자리로 나뉜다). 종류는 `sentence` · `cell_sentence` · `heading`만(캡션은 422 `invalid_unit_kind` — 언어마다 하나 규칙), 잡음 422, 조각이 하나뿐이면 422 `empty_part`(`reason: "one_sentence"`). 번호 · 들여쓰기 · 벗긴 표 순서 · `from_heading`은 `_build_draft`가 물려준다. 짝은 지금 나누기처럼 풀린다.
- [ ] 시험 `test_sop_editing.py`:
  ```python
  def test_split_sentences_cuts_at_every_sentence_in_one_edit(client):   # 번호 문단 하나에 한글 문장 셋(규칙 2에서 박스 1)
      result = _ok(_edit(client, bundle_id, doc_id, {"type": "split_sentences", "unit_id": box["id"]}))
      assert [_active(view)[i]["text"] for i in result["created_unit_ids"]] == [S1, S2, S3] and _find_coverage(view) == []
  def test_a_merged_box_splits_back_into_its_places(client): assert [u["text"] for u in pieces] == [KO1, KO2]
  def test_split_sentences_is_one_undo_step(client): assert find_unit(get_view(...), BOX)["id"] == box["id"]
  def test_one_sentence_and_a_caption_are_refused(client): assert (_rule(one)["code"], _rule(one)["reason"]) == ("empty_part", "one_sentence") and _code(caption)[0] == 422
  def test_the_first_piece_keeps_the_number(client): assert (first["number"]["value"], second["number"]["value"]) == ("5.1", None)
  def test_a_new_document_box_splits_and_its_targets_follow(client): assert len(_targets_of(new_doc)) == 3 and _count_links(new_doc) == 0
  def test_a_decided_box_asks_first(client): assert _code(response) == (409, "confirm_required")
  ```
- [ ] 실패 확인 `.venv/bin/python -m pytest tests/test_sop_editing.py -q -k split_sentences` → 422
- [ ] 구현: 서명대로, `rule.empty_part.one_sentence` en `There is only one sentence.` / ko `문장이 하나뿐입니다.`
- [ ] 같은 명령 + `pytest tests/test_sop_editing.py tests/test_sop_unwrap.py tests/test_sop_lang_shape.py -q` 통과 → **커밋** `feat(editing): split a box into its sentences — 박스를 문장마다 나눔`
### T2 — 메뉴 · Shape 줄 · ⇧S (프런트)
`AssignMenuAction`에 `split_sentences`(우클릭은 `split` 바로 아래, Shape 줄에도), 까닭은 `getRetireBlocker` 다음 `canSplit`이 거짓이면 `nothingToSplit`. 문장 수는 화면이 세지 않는다(서버 규칙의 사본을 만들지 않는다) — 한 문장이면 서버가 거절하고 그 문구를 알린다. `ASSIGN_KEYS` `{ id: "split_sentences", key: "s", shift: true, when: "text", labelKey: "assign.ctx.splitSentences" }`, 문구 en `Split by sentence` / ko `문장마다 나누기`, `assign.step.split_sentences`. 단추 줄(`PickBar`)의 손질 넷은 그대로(계획 3의 결정표) — `⋯`의 "그 밖의 손질"에 든다.
- [ ] 시험:
  ```ts
  it("offers Split by sentence under Split here", () => expect(actions(menu(sentence))).toEqual(expect.arrayContaining(["split", "split_sentences"])));
  it("keeps it off captions, toc lines and unsaved rows", () => { expect(has(menu(caption), "split_sentences")).toBe(false); expect(reasonOf(menu(tocLine))).toBe("assign.ctx.why.tocLine"); expect(reasonOf(menu(draft))).toBe("assign.ctx.why.unsaved"); });
  it("Shift+S splits by sentence and S still cuts at the line", () => { expect(findAssignKey(key("s", true))).toMatchObject({ entry: { id: "split_sentences" } }); expect(findAssignKey(key("s"))).toMatchObject({ entry: { id: "split" } }); });
  ```
- [ ] 실패 확인 `npx vitest run src/lib/assign-context-menu-model.test.ts src/lib/assign-keymap.test.ts` → 항목 없음
- [ ] 구현: `runUnitAction`에서 `runUnitEdit(shape, { type: "split_sentences", unit_id }, t("split.didSplit"), null)` — 마지막으로 누른 쪽(Old · New), 장벽 명령
- [ ] 같은 명령 + 전체 `npx vitest run` 통과 → **커밋** `feat(assign): split a box by sentence from the menu and Shift+S — 메뉴와 ⇧S로 문장마다 나누기`
### 브랜치 끝
- **스모크**: 새 단계 `assign: Split by sentence makes one box per sentence, one Ctrl+Z, a single sentence tells why`(Old · New 양 단). 있는 나누기 단계는 그대로.
- **설명서**: `#split-edit` 356행 아래 한 줄, `#assign-context` 표에 항목, `#assign-keys`(`ASSIGN_KEYS`에서), `#split-keys` 404행. **CHANGELOG**: `고른 박스를 문장마다 나눕니다(우클릭 · Shape 줄 · ⇧S). 되돌리기 한 번.`
- **세워 둘 조건**: ① 규칙 1 경계를 부르는 자리가 추출의 `split_rule`을 따라가야 할 것 같아진다(§9는 규칙 1로 못박았다 — 아니면 세운다). ② 문장 수를 화면에서 세고 싶어진다(서버 규칙 사본 금지).

## feat/assign-pair-bracket
- **한 문장:** 고른 박스의 떨어진 짝이 화면에 다 보이면 왼쪽에 괄호선 하나를 긋고 안내 줄을 숨긴다 (E1-R1~R4, Old · New 같음).
- **Files** — **Create**: `frontend/src/lib/use-pane-measure.ts`, `lib/pair-bracket-model.ts` · `.test.ts`, `components/assign/pair-bracket.tsx` · `.test.ts` · **Modify**: `components/assign/pair-lines.tsx:31-93`(이펙트를 훅으로), `frontend/effect-baseline.json`(pair-lines 줄만 낮춤), `components/assign/old-pane.tsx:57 · 127-133`, `components/assign/new-paper.tsx`, `components/paper/paper.tsx:801-823`(`renderPairHint`), `page.tsx`, `styles/components.css`(새 선택자), `docs/architecture/frontend.md` · **Test**: 위 `.test.ts`, `source-rules.test.ts`
- **Interfaces** — Consumes: `readFarSide`(계획 3 -1 T7), `data-strip-unit` · `.strip-card` · `.strip-chunk`, 떨어진 짝 안내 줄. Produces: `usePaneMeasure`, `resolvePairBracket`.
### T1 — 재는 훅을 공용으로 (동작 변화 없음)
`export function usePaneMeasure(options: { rootRef: RefObject<HTMLElement | SVGElement | null>; observe: string; measure: () => void; key: string }): void` — `pair-lines.tsx`의 이펙트 둘(스크롤 캡처 · 창 크기 · ResizeObserver · 렌더마다 한 번, 모두 rAF 1회로 묶음)을 그대로 옮긴다. 듣기 · 정리 차례를 바꾸지 않는다.
- [ ] 시험 `use-pane-measure`는 DOM 훅이라 시험을 새로 두지 않는다. 지키는 검사는 있는 `source-rules.test.ts`(기준선)와 Pair view 스모크다: `it("keeps every file at or under its baseline, and the baseline tight")`가 낮춘 값으로 통과
- [ ] 확인 `npx vitest run src/source-rules.test.ts` → `pair-lines.tsx: effects dropped to 0 (baseline 2) — lower the baseline`로 실패
- [ ] 구현: 옮기고 `effect-baseline.json`의 `pair-lines.tsx`만 낮춤(`UPDATE_EFFECT_BASELINE=1 npx vitest run src/source-rules.test.ts`로, 다른 줄은 바뀌지 않아야 한다)
- [ ] 같은 명령 + 전체 `npx vitest run` 통과 → **커밋** `refactor(assign): share the pane measuring hook — 칸을 재는 훅을 함께 씀`
### T2 — 괄호선 모델
```ts
export interface BracketEnd { unitId: number; top: number; left: number; height: number }   // .strip-lead 상자(client), 첫 글줄 y는 top + min(height / 2, 13) — pair-lines와 같은 값
export function resolvePairBracket(picked: BracketEnd | null, mates: readonly (BracketEnd | null)[], frame: { top: number; bottom: number; left: number }, base: { left: number; top: number }): { d: string; unitIds: number[] } | null
```
규칙: 떨어진 구성원이 **모두** 화면 안일 때만(하나라도 null이면 null — E1-R2). x = `max(min(left) - 10, frame.left + 2)`, 끝마다 6px 가로 눈금. 짝이 여럿(1:2)이면 한 선에 눈금 셋.
- [ ] 시험 `pair-bracket-model.test.ts`:
  ```ts
  it("draws from the picked box to its mate, left of both leads", () => { const b = resolvePairBracket(end(4, 100), [end(8, 300)], frame, zero); expect(b?.unitIds).toEqual([4, 8]); expect(b?.d).toMatch(/^M/); });
  it("draws nothing when one end is off screen", () => { expect(resolvePairBracket(end(4, 100), [null], frame, zero)).toBeNull(); expect(resolvePairBracket(null, [end(8, 300)], frame, zero)).toBeNull(); });
  it("draws a three-way pair with three ticks", () => expect(resolvePairBracket(end(4, 100), [end(8, 300), end(9, 400)], frame, zero)?.unitIds).toEqual([4, 8, 9]));
  it("stays inside the pane", () => expect(xOf(resolvePairBracket(end(4, 100, { left: 5 }), [end(8, 300, { left: 5 })], frame, zero))).toBeGreaterThanOrEqual(frame.left + 2)); it("draws nothing without mates", () => expect(resolvePairBracket(end(4, 100), [], frame, zero)).toBeNull());
  ```
- [ ] 실패 확인 `npx vitest run src/lib/pair-bracket-model.test.ts` → 모듈 없음
- [ ] 구현 → 같은 명령 통과 → **커밋** `feat(assign): model the bracket of a far pair — 떨어진 짝의 괄호선을 모델로`
### T3 — 그리기와 안내 줄 숨기기
`PairBracket({ side, pickedId, mateIds, onShown }: { side: "old" | "new"; pickedId: number | null; mateIds: readonly number[]; onShown: (shown: boolean) => void })` — `.assign-panes` 안 SVG, testid `assign-pair-bracket`, 누르는 동작 없음(`pointer-events: none`). 짝 구성원 중 **고른 박스와 같은 `.strip-card`에 든 것은 빼고**, 나머지를 `[data-strip-unit]`으로 찾아 **덩어리(`.strip-chunk`) 상자를 먼저 본 뒤**(E1-R3) 잰다. 접힌 줄 · 다른 탭이라 요소가 없으면 화면 밖과 같다. `onShown`이 참이면 안내 줄을 그리지 않는다(`Paper`의 `strips.pairHint.isHidden`) — 값이 바뀔 때만 알린다. New는 `NewPaper`에도 같은 `pairHint`를 주고(지금은 없다) 같은 규칙. Pair view · 그림 탭에는 없다. 숨긴 뒤 다시 재도 깜빡이지 않는다: 안내 줄은 고른 박스 **아래**라 위 짝의 자리를 밀지 않고, 아래 짝은 더 멀어질 뿐이라 다시 보이지 않는다.
- [ ] 시험 `pair-bracket.test.ts`:
  ```ts
  it("draws a path with the pinned testid and takes no pointer", () => { const h = html({ bracket: { d: "M0 0", unitIds: [4, 8] } }); expect(h).toContain('data-testid="assign-pair-bracket"'); expect(h).toContain("aria-hidden"); });
  it("draws nothing without a bracket", () => expect(html({ bracket: null })).not.toContain("<path"));
  it("the paper drops the hint while the bracket shows", () => { expect(paperHtml({ pairHint: { onGo, isHidden: true } })).not.toContain("pair-hint"); expect(paperHtml({ pairHint: { onGo, isHidden: false } })).toContain("pair-hint"); });
  ```
- [ ] 실패 확인 `npx vitest run src/components/assign/pair-bracket.test.ts` → 모듈 없음
- [ ] 구현: 새 선택자 `.pair-bracket`(선 1.5px `--accent-line`, 다크는 토큰). 새 이펙트 0(재기는 T1의 훅)
- [ ] 같은 명령 + `npx vitest run src/source-rules.test.ts` 통과 → **커밋** `feat(assign): draw a bracket between a far pair on screen — 화면 안 떨어진 짝에 괄호선`
### 브랜치 끝
- **스모크**: `assign.mjs:5247-5268`(떨어진 짝 안내 줄, **§14 승인**) — 짝이 화면 밖이 되도록 창을 낮추거나 스크롤한 뒤 안내 줄 · `data-dir` 검사를 하고(있는 검사 수 그대로), 스크롤로 둘이 다 보이면 `assign-pair-bracket` 하나 · 안내 줄 없음 검사를 더한다. 같은 단계 5281-5325(한 단 엿보기 판 · 두 번 누름)는 짝이 화면 밖인 상태에서 연다. 새 단계 하나 `assign: a far pair on screen gets a bracket in Old and New, the hint hides`(S14).
- **설명서**: `#split-pair` 375행(떨어진 짝 · 안내 줄), `#assign-unwrap-pair` 707행. **CHANGELOG**: `떨어진 짝이 한 화면에 있으면 왼쪽에 괄호선으로 이어 보입니다.`
- **세워 둘 조건**: ① `effect-baseline.json`의 다른 줄이 늘거나 훅으로 옮겨지지 않는다. ② 스크롤 한 프레임이 앞 커밋보다 20% 넘게 느리다(`pw-perf-assign.mjs`). ③ 안내 줄과 괄호선이 번갈아 깜빡인다.

## 정한 것 (계획을 쓰며 나온 물음의 답)
1. 한쪽에서 여럿 고르면 다른 쪽 여럿 고름은 비운다(바가 하나).
2. 일괄 언어 바꾸기는 배정된 줄을 건너뛰고 건너뛴 수에 넣는다.
3. New의 묶음 꼬리표는 괄호 "(배정은 표째)"를 뺀다.
4. 짝 줄과 한 언어 줄을 섞어 골라도 같은 언어끼리 합치고 짝을 다시 맺는다.
5. `assign.mjs:773-817`(C1-R3이 반대를 정함) · `:5281-5325`(E1-R2)는 동작이 바뀌어 따라 바뀌는 시험이다 — 같은 수의 단계로 고치고 커밋에 까닭.
6. 짝이 둘 다 보이면 안내 줄이 숨어 옆 판을 열 길이 없는 것은 E1-R2대로다.

## Self-review
- 덮기: C1-R1~R5 = 첫 브랜치 T1~T4, C2-R1~R4 = 둘째 T1~T3(⇧D 제외), §9 여럿 고른 표시 = 셋째, §9 합치기 · 표 벗기기 · "하나씩" 문서 = 넷째 T1~T5, G1-R1~R4 = 다섯째(To-Be 이동 · 다른 Bundle 이동 없음), §9 문장마다 나누기 = 여섯째, E1-R1~R4 = 일곱째. 번호 당기기(D1-R6) · 괄호 밖 번호 규칙은 계획 5.
- 서버 판정을 화면에 베끼지 않는다: 이웃 검사만 화면(지금 합치기와 같다), 문장 수 · 짝 다시 맺기 · 되돌리기는 서버. 자료: 새 열 · 표 없음. `unit_edits.payload`에 `merged`를 더할 뿐이고 옛 기록은 지금 규칙으로 읽는다. 이름: `MergeRowsOp` · `SetLayoutTablesOp` · `NewPaper` · `buildPickBar` · `ASSIGN_KEYS` · `enqueue`는 색인 표 그대로. `SplitSentencesOp` · `read_merged_pieces` · `usePaneMeasure`는 이 파일에서 처음 나온다.
