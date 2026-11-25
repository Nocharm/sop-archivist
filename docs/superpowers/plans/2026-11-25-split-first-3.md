# 쪼개기 먼저 3 — 같은 용지 (`feat/new-paper`)

> **For agentic workers:** 차례 · 공용 이름 · 게이트 · 세우는 조건은 [색인](2026-11-25-split-first.md)이 먼저다. 이 파일은 스텝 4의 작업만 적는다.

**Goal:** 이미 쓴 New 문서를 양 단에서도 Old와 같은 `Paper`로 그리고, Old · New를 따로 골라 박스 아래 단추 줄 하나로 잇거나 다듬는다.

**Architecture:** New 문장의 사실(`new_unit_id` → 새 문장)은 순수 모델 `new-overlay-model`이 Unit마다 한 덩이로 만들고 `Paper`는 그 덩이를 그리기만 한다(얹기 층). 고름은 `assign-focus-model`에서 쪽마다 하나로 나뉘고, 무엇을 할 수 있는지는 `buildPickBar` 한 곳이 정해 화면 · 글쇠 · 확정 단추가 함께 읽는다. 쓰기는 모두 앞 계획의 명령 큐(`enqueue`)로 간다.

**Spec:** [`2026-11-25-split-first-design.md`](../specs/2026-11-25-split-first-design.md) §7 R4 · §8 전부 · §11-1 · §14. 배경 [`2026-11-23-assign-feedback-2.md`](../specs/2026-11-23-assign-feedback-2.md) A2 원인 3 · C1(나중 브랜치) · G1.

**Global Constraints:** 색인 파일.

**모음 브랜치:** `feat/new-paper`를 새 `dev`에서 딴다. 스텝 브랜치는 `feat/new-paper`에서 따고, 스텝마다 그 diff만 검토해 모음에 합친다. `dev`에는 모음이 끝난 뒤 한 번(전체를 다시 검토하지 않는다). 버전 · `PROGRESS.md`는 그때 한 번, CHANGELOG 줄은 스텝마다 `Unreleased (dev)`에 모아 둔다.

**시작할 때 다시 볼 것** — `dev` `e704ddf8`을 읽고 썼다. 앞 계획이 바꾼 것은 **그때의 코드를 따른다**(줄 번호는 이 커밋 기준, 이름으로 찾는다): `use-command-queue.ts`의 `AssignCommand` 꼴, 큐가 `assign-focus-model.ts`에 더한 사건, `ASSIGN_KEYS`, Enter 판정(`fix/assign-enter`), `PaperChunk` deps(`perf/assign-filter-chunks`), `strips.toc` → `NoiseBlock`, `isDraftingOn()`.

**명령과 시험 꼴** — 프런트는 `frontend/`, 백엔드는 `backend/`에서. 작업마다 커밋 전에 `npm run lint && npx tsc --noEmit -p tsconfig.json`(백엔드 `.venv/bin/ruff check app/ tests/`). 화면 부품 시험은 `.test.ts` + `createElement` + `renderToStaticMarkup`(본보기 `src/components/ui/morph-button.test.ts`, 글말이 필요하면 `LangProvider`로 감싼다 — `output-a-row.test.ts`). 시험 조각의 `box()` · `input()` · `run()` 같은 짧은 만들개는 그 파일 머리에 둔다. **새 `useEffect` · 타이머 0** — `new-paper.tsx` · `pick-bar.tsx`는 기준선에 없어 하나라도 쓰면 `source-rules.test.ts`가 깨진다. 필요해 보이면 멈춘다.

---

## feat/new-paper-1-render

**한 문장:** 양 단의 이미 쓴 New 문서를 `Paper` + 얹기 층으로 그리되, 누르기 · 메뉴 · 잇기의 동작은 지금 그대로다.

**Files**
- Create: `frontend/src/lib/new-overlay-model.ts` · `.test.ts`, `components/assign/new-paper.tsx` · `new-paper.test.ts`, `components/assign/new-sources.tsx`(`NewPane`의 `renderChips` · `renderSources`를 떼어 냄), `components/paper/paper-overlay.test.ts`
- Modify: `backend/app/sop/outputs.py:1681`(`BundleCellOut`), `backend/app/sop/written.py:198-236`, `frontend/src/lib/api-sop.ts:1166`(`BundleCell`), `components/paper/paper.tsx`(`strips` 215, `PaperChunk` 118, `renderCell` 975, `renderRow` 1184, `renderCard` 1533, `renderRows` 1556, 뿌리 `.pg` 1777), `components/assign/new-pane.tsx`, `new-bundle.tsx`, `link-lines.tsx:75-124, 197-215`, `lib/link-direction-model.ts`, `app/bundles/[id]/assign/use-assign-page.tsx`(`soloLoad` 471, `newEditModel` 692, `newFileId` 755, `openNewCtxMenu` 1093, `readDropAt` 2903, `listDestinationEls` 3571), `page.tsx:697-800`, `lib/assign-drop-model.ts:39-51`, `styles/components.css` 1923-2034 · 2382-2397(새 선택자만), `docs/architecture/frontend.md` · `backend.md` · `api-contract.md` · `frontend/CLAUDE.md`
- Test: `backend/tests/test_sop_written.py` · `test_sop_outputs.py`, 위 `.test.ts`, `lib/assign-drop-model.test.ts`, `lib/link-direction-model.test.ts`

**Interfaces** — Consumes: `getDocumentView` · `buildPaperModel` · `buildPaperTabs` · `listPartSheets` · `FigureTab` · `NewAiFilter` · 앞 계획의 `NoiseBlock`. Produces: T2 · T3 · T4의 타입, `NewPaper`(색인 이름), `BundleCellOut.new_unit_id` · `change_type`.

### T1 — 칸 새 문장이 자기 Unit을 안다 (backend)
§8은 "New 문장은 `new_unit_id`로 잇는다"지만 표 칸(`BundleCell`)에는 그 값도, 신규 표시를 가릴 `change_type`도 없다. 응답 칸 둘을 더하기만 한다(DB 변경 없음).
- [ ] 시험 `test_written_table_cells_carry_their_unit_and_change_type`(`test_sop_written.py:73` 옆). 엮은 문서 칸은 둘 다 `None`임을 `test_sop_outputs.py` composed 표 시험에 한 줄:
  ```python
  units = {u["id"]: u for u in get_view(client, bundle_id, new_doc["id"])["units"]}
  cells = next(row for row in written if row["kind"] == "table")["table"]["cells"]
  assert [units[c["new_unit_id"]]["text"] for c in cells] == [c["text"] for c in cells]
  assert {units[c["new_unit_id"]]["kind"] for c in cells} == {"cell_sentence"}
  assert {c["change_type"] for c in cells} == {None}
  ```
- [ ] 실패 확인 `.venv/bin/python -m pytest tests/test_sop_written.py -q -k carry_their_unit` → `KeyError`
- [ ] 구현: `BundleCellOut`에 `new_unit_id: int | None = None` · `change_type: str | None = None`, `_load_bundle_children`의 select에 열 둘(질의 수 그대로), `BundleCell`에 `new_unit_id?: number | null` · `change_type?: ChangeType | null`, `api-contract.md` 한 줄
- [ ] 같은 명령 + `pytest tests/test_sop_written.py tests/test_sop_outputs.py -q` 통과
- [ ] 커밋 `feat(written): carry the unit id and change type of table cells — 칸 새 문장에 Unit id와 변경 종류를 실음`

### T2 — 얹기 모델 `new-overlay-model.ts`
```ts
export type NewBoxState = "focus" | "shape" | "picked" | "candidate" | "unsourced";
export interface NewBox {
  unitId: number; targetId: number; kind: "sentence" | "cell" | "bundle"; lang: UnitLang; sourceIds: readonly number[]; isAi: boolean; isMarkedNew: boolean;
  refRow: WrittenSentence | null; state: NewBoxState | undefined; ai: NewAiMark | undefined; isAiFolded: boolean; band: NewAiBand | null;
  isLinkable: boolean;   // sentence · cell만
  key: string;           // 이 박스를 그리는 값 전부를 이은 글
}
export interface NewOverlay { boxes: ReadonlyMap<number, NewBox>; unitOfTarget: ReadonlyMap<number, number> }
export interface NewOverlayInput {
  rows: readonly WrittenSentence[]; units: ReadonlyMap<number, ViewUnit>; candidateIds: ReadonlySet<number>; pickedIds: ReadonlySet<number>;
  focusId: number | null; shapeUnitId: number | null; aiFilter: NewAiFilter | null; openAiSections: ReadonlySet<string>;
}
export function buildNewOverlay(input: NewOverlayInput): NewOverlay
export function readOverlayKey(boxes: ReadonlyMap<number, NewBox>, unitIds: ReadonlySet<number>): string
export function readUnlinkableKey(unit: ViewUnit, box: NewBox | undefined, part: string): string | null   // assign.newPaper.why.<heading|noise|repeated|caption|bundle|noTarget>
```
값: 상태 순서는 지금 `readState`(`new-pane.tsx:177`)와 같다. 칸의 `unsourced`는 `sourceIds`가 비고 `change_type !== "new"`. **같은 `new_unit_id`에 새 문장이 둘 이상이면**(스텝 0 전의 중복) 출처가 있는 것, 그다음 작은 `target_id` 하나만. `key`는 `sourceIds · isAi · isMarkedNew · 참조 표시 · state · ai · isAiFolded · band.count`. `candidateIds` 등이 매 렌더 새 Set이어도 `key`가 글이라 괜찮다(렌더마다 다시 짓는다).
- [ ] 시험 `new-overlay-model.test.ts`:
  ```ts
  it("maps sentences and table cells by new_unit_id", () => { const o = build([sentence(5, 50), table([cell(7, 70)])]);
    expect(o.boxes.get(50)).toMatchObject({ targetId: 5, kind: "sentence", isLinkable: true }); expect(o.boxes.get(70)?.kind).toBe("cell"); expect(o.unitOfTarget.get(7)).toBe(70); });
  it("keeps one sentence per unit, the sourced one first", () => expect(build([sentence(5, 50), sentence(6, 50, { source_unit_ids: [9] })]).boxes.get(50)?.targetId).toBe(6));
  it("orders the states", () => { expect(state({ focusId: 5, pickedIds: new Set([5]) })).toBe("focus"); expect(state({ pickedIds: new Set([5]), candidateIds: new Set([5]) })).toBe("picked"); expect(state({})).toBe("unsourced"); });
  it("does not mark a cell unsourced when it is marked new", () => expect(build([table([cell(7, 70, { change_type: "new" })])]).boxes.get(70)?.state).toBeUndefined());
  it("drops a sentence without a unit", () => expect(build([sentence(5, null)]).boxes.size).toBe(0));
  it("keeps the key while only the revision changes", () => expect(key({ revision: 2 })).toBe(key({ revision: 1 })));
  it("changes the key with a source, a state and a fold", () => expect(new Set([key({}), key({ source_unit_ids: [9] }), key({}, { pickedIds: new Set([5]) })]).size).toBe(3));
  it("reads a chunk key from its own units only", () => expect(readOverlayKey(boxes({ 50: "a", 60: "x" }), new Set([50]))).toBe(readOverlayKey(boxes({ 50: "a", 60: "y" }), new Set([50]))));
  it("tells why a heading cannot be linked", () => expect(readUnlinkableKey(heading, undefined, "body")).toBe("assign.newPaper.why.heading"));
  ```
- [ ] 실패 확인 `npx vitest run src/lib/new-overlay-model.test.ts` → 모듈 없음 → 구현(en · ko 문구 6쌍) → 같은 명령 통과
- [ ] 커밋 `feat(assign): model what sits on each New box — New 박스 위에 얹을 것을 모델로`

### T3 — `Paper`의 얹기 손잡이와 `PaperChunk`
```ts
// PaperProps.strips에 더한다
overlay?: {
  isFolded: (unitId: number) => boolean;                      // AI 거르기로 접힘
  keyOf: (unitIds: ReadonlySet<number>) => string;            // readOverlayKey
  boxProps: (unitId: number) => { className?: string; attrs?: StripAttrs; testId?: string } | null;   // 문장 박스 · 칸 조각 공용
  rowAttrs?: (unitId: number) => StripAttrs | undefined;      // data-ai-view
  renderTop: (unitId: number) => ReactNode;                   // 글 위 칩 줄(StripBox chips, 칸은 글 앞)
  renderFoot?: (unitId: number) => ReactNode;                 // 글 아래 - 이 브랜치에서는 그 자리 메뉴
  renderFolded?: (unitIds: readonly number[]) => ReactNode;   // 접힌 카드 자리(띠 하나 또는 null)
  textProps?: (unitId: number) => StripAttrs | undefined;     // 글 감싸개(.new-text)
  readWhy?: (unitId: number) => string | null;                // 이을 수 없는 까닭(data-tip)
};
pageClassName?: string;                                       // PaperProps - 뿌리 .pg에 더할 class
export function isChunkFrozen(prev: PaperChunkProps, next: PaperChunkProps): boolean   // 지금 memo 비교를 이름으로(시험용)
```
규칙: ① 얹기는 **Unit마다의 값만** — `Paper`는 New를 모른다. ② 덩어리 deps 끝에 `overlay ? overlay.keyOf(group.unitIds) : ""` **하나만**(맵 · 함수를 넣으면 매 렌더 전부 다시 그려진다). ③ 화면 밖 덩어리도 칩 · `data-target`이 맞아야 연결선이 맞으므로 상태까지 키에 든다 — 바뀐 박스가 든 덩어리만 다시 그려진다. ④ `overlay`가 없으면 마크업이 지금과 같다. ⑤ 글 감싸개는 얹기가 있을 때만, `.new-hit::after` 같은 덮개를 쓰지 않는다(두 번 눌러 나누기의 글자 자리가 죽는다). ⑥ `renderFolded`는 카드의 모든 Unit이 접혔을 때만. ⑦ 짝 안내 줄의 `data-target`(paper.tsx:813, Unit id)은 `data-hint-target`으로 — `[data-target]`이 새 문장 id 하나만 뜻하게(`grep -rn "pair-hint" frontend/scripts`로 쓰임 확인).
- [ ] 시험 `paper-overlay.test.ts`:
  ```ts
  it("draws the same markup with no overlay", () => expect(html({ overlay: undefined })).toBe(html({})));
  it("puts the target, the state and the class on the strip box", () => expect(html({ overlay })).toMatch(/class="strip new-line"[^>]*data-target="5"[^>]*data-state="unsourced"/));
  it("puts the cell target on the cell piece with its chips first", () => expect(html({ overlay: cells })).toMatch(/class="cell-piece new-cell"[^>]*data-cell-target="7"[^>]*>\s*<span class="new-srcs"/));
  it("draws one band for folded cards and nothing for the next one", () => expect(html({ overlay: folded }).match(/new-ai-band/g)).toHaveLength(1));
  it("keeps a far chunk whose own key did not change", () => expect(isChunkFrozen(chunk({ deps: ["m", "a"] }), chunk({ deps: ["m", "a"] }))).toBe(true));
  it("redraws a far chunk whose own box changed", () => expect(isChunkFrozen(chunk({ deps: ["m", "a"] }), chunk({ deps: ["m", "b"] }))).toBe(false));
  ```
- [ ] 실패 확인 `npx vitest run src/components/paper/paper-overlay.test.ts` → 구현 → 같은 명령 + `npx vitest run src/lib/paper` 통과
- [ ] 커밋 `feat(paper): let a screen lay marks over its boxes — 용지 박스 위에 화면이 표시를 얹게 함`

### T4 — `NewPaper` 부품과 New 보기 하나
지금 New의 `DocumentView`는 New를 고른 때만 받는다(`soloLoad`). 양 단에서 늘 받게 **읽기 하나**(`newDocFile: number | null` = 한 단이면 연 New 문서, 양 단이면 `newFileId`, 엮은 문서면 null → `newView` · `newModel` · `newTabs`)로 모은다. 다시 받기 열쇠는 지금 `soloKey`.
```ts
export interface NewPaperProps {
  bundleId: number; docOptions: SelectOption<string>[]; docId: string; fileId: number; onDocChange: (docId: string) => void; tag: string; headExtra?: ReactNode; banner?: ReactNode;
  linesOn: boolean; onToggleLines: () => void; onWide?: () => void; zoom: number; onZoom: (dir: "+" | "-") => void; view: DocumentView | null; model: PaperModel | null; tabs: PaperTabs | null;
  overlay: NewOverlay; aiFilterKey: string; cellPickable: boolean; cellDroppable: boolean; onUnlink?: (targetId: number, unitId: number) => void;
  sourceLabel: (unitId: number) => string; onJumpSource: (unitId: number, targetId: number) => void; selectedUnitId: number | null; pickedUnitIds: ReadonlySet<number>; pending?: PaperPending;
  onPick: (unitId: number, keys: { shiftKey: boolean; additive: boolean }, anchor: HTMLElement, event: MouseEvent) => void;
  onContextMenu?: (unitId: number, at: { x: number; y: number }, caret: { blockId: number; offset: number } | null) => void;
  cut?: PaperCut | null; onCutDrag?: (pos: CutDragPos) => void; renderAtCut?: () => ReactNode; renderFoot?: (unitId: number) => ReactNode;
}
```
값: 뿌리 `section.assign-pane[data-pane="new"][data-doc][data-testid="assign-new"]`와 머리의 testid는 `NewPane` 그대로. 용지 `testId="assign-new-paper"` · `pageClassName="new-sheet"` · `pickWholeBundle={false}` · `figureRows="hide"`, 탭 `PartTabs testIdPrefix="assign-new-tab"`(본문 · 머리말 · 꼬리말 · 그림). 박스 `assign-new-<targetId>`(대상 없는 박스는 `assign-new-paper-piece-<unitId>`), 글 `assign-new-pick-<targetId>.new-text`, 칸 `assign-new-cell-<targetId>` · `assign-new-cell-pick-<targetId>`, 속성 `data-target` · `data-lang` · `data-state` · `data-pair-group` · `data-linkable`, 칸은 `cell-piece new-cell` + `data-cell-target` · `data-drop="cell"` · `data-pickable`. AI 띠 펼침은 컴포넌트 상태(`aiFilterKey`가 바뀌면 렌더 중 접음).
- [ ] 시험 `new-paper.test.ts`:
  ```ts
  it("keeps the marks the link lines look for", () => { const h = html(); expect(h).toContain('data-pane="new"'); expect(h).toMatch(/new-line"[^>]*data-target="5"/); expect(h).toContain('data-src-unit="9"'); });
  it("shows header and footer tabs like the Old paper", () => expect(html({ header: true })).toContain('data-testid="assign-new-tab-header"'));
  it("draws a heading with no target and tells why", () => { const h = html({ heading: true }); expect(h).toMatch(/assign-new-paper-piece-51"(?![^>]*data-target)/); expect(h).toContain("data-tip="); });
  it("offers nothing to unlink without a handler", () => expect(html({ onUnlink: undefined })).not.toContain("new-src-x"));
  ```
- [ ] 실패 확인 `npx vitest run src/components/assign/new-paper.test.ts` → 구현 → 같은 명령 통과
- [ ] 커밋 `feat(assign): draw a written New document on the same paper — 이미 쓴 New 문서를 같은 용지로 그림`

### T5 — 화면 연결: 같은 손짓이 같은 일
| 지금 | 바꿈 |
|---|---|
| `NewPane onPick={handleNewPick}`(이미 쓴 문서) | `NewPaper onPick` → 얹기에서 `targetId`를 찾아 `handleNewPick`. 이을 수 없는 박스는 Old를 골라 두었으면 까닭 알림, 아니면 그 Unit을 다듬기로 고름(제목도) |
| `lineActions`(그 자리 메뉴) | `renderFoot`으로 같은 `LinkMenu inline`(다음 브랜치에서 지운다) |
| `live`/`onReveal` 이펙트 | 이미 쓴 문서는 `setJump({ side: "new", quiet: true })` — 있는 `jump` 이펙트가 들인다(새 이펙트 0) |
| `readDropAt`의 `button.new-hit` | `data-linkable`. `NewHit.hasPickButton` → `isLinkable`(`findAssignDrop`) |
| `listDestinationEls` · 연결선 · 번쩍임 | testid · `[data-target]`이 같아 그대로. 칸 추천은 `assign-new-cell-<id>`도 찾는다 |
- [ ] 시험 `assign-drop-model.test.ts`(있는 `findAssignDrop` 셋을 새 이름으로): `it("links onto a linkable box of a written paper only", () => { expect(findAssignDrop(hit({ isLinkable: true }))).toEqual({ kind: "link", targetId: 5 }); expect(findAssignDrop(hit({ isLinkable: false }))).toEqual({ kind: "none" }); })`
- [ ] 실패 확인 `npx vitest run src/lib/assign-drop-model.test.ts` → 구현 → 같은 명령 + 전체 `npx vitest run` 통과
- [ ] 커밋 `feat(assign): put the New paper in the two-document view — 양 단 New 자리에 같은 용지를 둠`

### T6 — `NewPane`에서 이미 쓴 문서 가지를 걷는다
남는 것(숨긴 엮은 문서): 기본 보기 · 템플릿 전환 · 클릭 배치 · 손잡이 · 점선 초안 · `joinableIds`/`JoinMenu`(`lineActions`) · `composed.ops`의 나눌 선 · AI 거르기 · `live` 이펙트(엮은 문서는 다시 받아야 줄이 생긴다) · `NewPaneEmpty`. 걷는 것: `candidateIds` · `focusId` · `shapeId` · `onPick` · `onShape` · `cut`/`cutPop`/`onCutDrag` · `onEditOriginal` · `cellLink` · `readState` · `renderCellSources` · 이미 쓴 문서의 절 번호 앞머리와 `renderSectionHead`, `NewBundle`의 `CellBox` 누르기. `pickedIds`는 join이 쓰므로 남긴다.
**안전하게 지우는 법**: `NewPaneProps.rows`를 `Array<ComposedRow | EmptySlotRow>`(composed-model.ts:25)로 좁혀 tsc가 죽은 가지를 짚게 하고, 짚인 곳만 지운다. CSS는 지우지 않는다(엮은 문서가 `.new-line` · `.new-hit`를 쓴다).
- [ ] 지키는 시험을 먼저 초록으로 — `new-paper.test.ts`: `it("NewPane still draws an unwritten document", () => { const h = paneHtml([composedRow, emptySlot]); expect(h).toContain("data-read-only"); expect(h).toContain('data-testid="assign-new-slot-purpose"'); expect(h).toContain("assign-new-join-5"); })`
- [ ] 확인 `npx vitest run src/components/assign/new-paper.test.ts`(통과) → props를 좁혀 `npx tsc --noEmit -p tsconfig.json`이 실패하는 자리를 모음 → 지움 → tsc 오류 0 · 같은 시험 통과 · `effect-baseline.json`은 줄어든 수만 낮춤
- [ ] 커밋 `refactor(assign): leave only the unwritten document in NewPane — NewPane에는 엮은 문서만 남김`

### T7 — 연결선이 먼 덩어리를 억지로 배치하지 않는다
`updateBadgeDirections`(99) · `updateChipDirections` · `measure`(197)가 화면 밖 박스마다 상자를 재어 건너뛴 덩어리를 배치시킨다(A2 원인 3). `export function readFarSide(chunk: { top: number; bottom: number } | null, frame: { top: number; bottom: number }): "above" | "below" | null`로 덩어리(`.strip-chunk`) 상자를 먼저 보고 `null`일 때만 박스를 잰다.
- [ ] 시험 `link-direction-model.test.ts`: `it("answers from a chunk off screen", () => { expect(readFarSide({ top: -900, bottom: -100 }, { top: 0, bottom: 600 })).toBe("above"); expect(readFarSide({ top: 700, bottom: 900 }, { top: 0, bottom: 600 })).toBe("below"); })` · `it("measures the box when the chunk touches the frame or is missing", () => { expect(readFarSide({ top: -900, bottom: 10 }, { top: 0, bottom: 600 })).toBeNull(); expect(readFarSide(null, { top: 0, bottom: 600 })).toBeNull(); })`
- [ ] 실패 확인 `npx vitest run src/lib/link-direction-model.test.ts` → 구현 → 같은 명령 통과
- [ ] 커밋 `perf(assign): ask the chunk before measuring far link ends — 먼 이음 끝은 덩어리로 먼저 가늠`

### 브랜치 끝
- **스모크**: §14는 이 브랜치의 줄을 이름 대지 않는다. 마크업이 바뀌어 따라 바뀌는 **선택자 교체**뿐이고 단계 수 · 기대는 그대로 — `.new-hit` → `.new-text`(`assign.mjs:1443, 1452, 1462, 1532, 1888, 7696`, `pw-contrast-audit.mjs:134`, `pw-overlap-audit.mjs:287`, `pw-manual-shots.mjs:128`), `aria-pressed` → 박스 `data-state="picked"`(`:1548, 1696, 2037`), `.new-item[data-ai-view]` · `.new-item` 수 → `.strip-row[data-ai-view]` · `.new-line` 수(`:2855-2882`), `assign-new-cut-` → `assign-new-paper-cut-handle`(`:3377-3389`). 새 단계 하나: `assign: the New paper has header, footer and figure tabs and tells why a heading cannot be linked`.
- **설명서**: `#assign` 423행(오른쪽 칸) · 431행(그림 탭), `#assign-links` 518행. 그림은 정식 업데이트 때.
- **CHANGELOG**: `이미 쓴 New 문서가 양 단에서도 Old와 같은 용지로 보입니다 — 머리말 · 꼬리말 · 그림 탭과 제목 줄도 보입니다.`
- **세워 둘 조건**: ① `pw-perf-assign.mjs`(New 문서를 함께 연 시나리오를 더함)로 긴 문서 둘에서 고르기 · 호버가 앞 커밋보다 20% 넘게 느리다. ② "얹기 없으면 같은 마크업" 시험이 깨진다. ③ `sopa.drafting=1`로 켠 엮은 문서 스모크가 깨진다. ④ New 보기를 늘 받느라 첫 요청이 2개 넘게 는다.

---

## feat/new-paper-2-pick

**한 문장:** Old와 New를 쪽마다 따로 고르고, 마지막에 누른 박스 아래 단추 줄 하나가 손질과 잇기를 맡는다.

**Files**
- Create: `frontend/src/lib/pick-bar-model.ts` · `.test.ts`, `components/assign/pick-bar.tsx` · `.test.ts`, `lib/blank-click-model.ts` · `.test.ts`, `lib/link-save-model.ts` · `.test.ts`, `lib/doc-shape-model.ts` · `.test.ts`, `lib/side-panel-model.ts` · `.test.ts`, `app/bundles/[id]/assign/link-command.ts`
- Modify: `lib/assign-focus-model.ts:7-160`(+ `.test.ts`), `lib/use-assign-focus.ts`, `use-assign-page.tsx`, `page.tsx:127-190`, `assign-side-panel.tsx:835-885`, `assign-bar.tsx:76-87`, `use-command-queue.ts`, `lib/assign-keymap.ts`, `link-lines.tsx:141-148`(`findDrawnLinkEnd` 삭제), `lib/assign-model.ts:159-171`(`listLinkMenuItems` 삭제), `assign-drop-model.ts:53-61`(`resolveDropLink` 삭제), `link-menu-place.ts`(`placeLinkMenuAtLineEnd`만 삭제 — `placeLinkMenu`는 `join-menu` · 우클릭 메뉴가 쓴다), `components.css`(새 선택자)
- Delete: `components/assign/link-menu.tsx`

**Interfaces** — Consumes: `NewOverlay`, `enqueue`/`AssignCommand`, `ASSIGN_KEYS`, `buildUnitMenu`, `addPartnerTargets`, `listUnlinkRemainder`, `loadRowGroup` · `getGroupByTarget`(`linkAsSource` 2268 · `unlinkCell` 2302가 쓰는 길). Produces: 아래 `FocusState`, `buildPickBar(state): PickBar`(색인 이름), 명령 `{ kind: "link" }`.

### T1 — 편집이 다듬는 문서를 인자로 받는다 (동작 변화 없음)
`shapeView` · `shapeModel` · `shapeTabs` 한 벌이 "다듬는 문서"라 고름이 둘이면 틈 단추 · 우클릭이 다른 문서를 고친다.
```ts
export type PickSide = "old" | "new";
export interface DocShape { side: PickSide; view: DocumentView; model: PaperModel; tabs: PaperTabs }
export function findShapeOfDoc(shapes: readonly DocShape[], docId: number): DocShape | null     // doc-shape-model.ts
// 화면 훅: shapes: DocShape[] · shapeOf(side): DocShape | null · runUnitEdit(shape, op, okText, …)(첫 인자만 더함)
```
바뀌는 부름: `runPairChange` · `runCaptionRefChange` · `switchToPair` · `applySplitSuggestion` · `attachCaption` · `buildUnitMenu` · `findNeighbors` · `planOldJoin`/`joinOld`(→ `planJoinIn(shape, …)`/`joinIn`) · `splitAtCut`. `pairSource`(1022) · `captionPickBundle`(1025)은 **시작한 문서**에서, `cutUnit`(700)은 두 모델에서 찾는다 — 지금처럼 `shapeView`로 찾으면 다른 쪽을 누르는 순간 짝 고르기가 소리 없이 사라진다.
- [ ] 시험 `doc-shape-model.test.ts`: `it("finds the document a pair pick started in, whichever side is picked", () => { expect(findShapeOfDoc([old1, new7], 7)?.side).toBe("new"); expect(findShapeOfDoc([old1, new7], 3)).toBeNull(); })`
- [ ] 실패 확인 `npx vitest run src/lib/doc-shape-model.test.ts` → 구현 → 전체 `npx vitest run` · tsc 통과
- [ ] 커밋 `refactor(assign): pass the document every edit works on — 편집이 다듬는 문서를 인자로 받음`

### T2 — 고름 모델을 쪽마다 하나로
```ts
export type TocPick = { kind: "toc"; docId: number; key: number; unitId: number | null };   // 이름은 그때의 잡음 블록 이름을 따른다
export type OldPick = { kind: "none" } | { kind: "unit"; docId: number; unitId: number } | TocPick;
export type NewPick = { kind: "none" } | { kind: "unit"; docId: number; unitIds: readonly number[]; additive: boolean } | TocPick;   // 끝이 마지막에 누른 것
export type SidePick = { side: "old"; pick: OldPick } | { side: "new"; pick: NewPick };
export interface FocusState { old: OldPick; new: NewPick; last: PickSide | null; act: "pick" | "destination" | null; pending: readonly PendingEntry[]; follows: readonly Follow[] }   // from: SidePick | null
export type FocusEvent = ({ type: "pick" } & SidePick) | { type: "choose_destination" } | { type: "clear"; what: "all" | "new" } | …;   // 앞 계획의 사건은 그대로
export function toggleNewPick(pick: NewPick, docId: number, unitId: number, additive: boolean): NewPick
export function readLegacyFocus(state: FocusState): Focus                                     // T3 끝에 지운다
```
한 단으로 연 New 문서(`inPlace`)는 **고름이 아니라 보기**라 모델에서 뺀다. 따라가기 · 사라진 Unit 놓기는 같은 쪽 고름하고만 견준다.
- [ ] 시험 — 있는 시험은 새 꼴로 옮겨 **수를 줄이지 않고**, 뜻이 바뀌는 것은 규칙 1("holds one focus at a time") 하나(커밋에 까닭). 더하는 것:
  ```ts
  it("keeps one pick per side", () => { const s = run(pickOld(3), pickNew(70)); expect(s.old).toEqual(oldUnit(3)); expect(s.new).toMatchObject({ unitIds: [70] }); expect(s.last).toBe("new"); });
  it("Ctrl adds and removes, a plain press replaces", () => { const two = toggleNewPick(newUnit(70), 7, 71, true); expect(two).toMatchObject({ unitIds: [70, 71], additive: true });
    expect(toggleNewPick(two, 7, 70, true)).toMatchObject({ unitIds: [71] }); expect(toggleNewPick(two, 7, 72, false)).toMatchObject({ unitIds: [72], additive: false }); });
  it("picking New keeps a follow started from Old", () => expect(run(pickOld(3), start(job("a")), succeed("a", 4), pickNew(70)).follows).toHaveLength(1));
  it("clear new keeps the Old pick and clear all empties both", () => { expect(run(pickOld(3), pickNew(70), clear("new"))).toMatchObject({ old: oldUnit(3), new: { kind: "none" }, last: "old" }); expect(run(pickOld(3), clear("all")).last).toBeNull(); });
  it("choosing a destination turns the act and a press turns it back", () => { expect(run(pickOld(3), choose()).act).toBe("destination"); expect(run(pickOld(3), choose(), pickNew(70)).act).toBe("pick"); });
  it("drops only the vanished New unit", () => expect(run(pickOld(3), pickNew(70), addNew(71), loaded([doc(7, 2, [71])]))).toMatchObject({ old: oldUnit(3), new: { unitIds: [71] } }));
  it("a toc block on one side leaves the other side", () => expect(run(pickNew(70), pickOldToc(9)).new).toMatchObject({ unitIds: [70] }));
  ```
- [ ] 실패 확인 `npx vitest run src/lib/assign-focus-model.test.ts` → 구현(화면은 `readLegacyFocus`로 지금 동작) → 같은 명령 + 전체 `npx vitest run` 통과
- [ ] 커밋 `feat(assign): keep an Old pick and a New pick apart — Old와 New의 고름을 따로 둠`

### T3 — 화면이 두 고름을 쓴다
| 자리 | 규칙 |
|---|---|
| `isSolo` · `isNewEdit` · `hasSolo`(458) | 보기 `soloDocId: number \| null`(한 단 New) + 다듬는 쪽 `last`. `row === null` 조건을 없앤다 |
| 한 단 New 닫기 | Old 문서 고르기 · 양 단으로 펴기 · Old 줄로 가는 길(`selectRow` · `goToUnit` · 출처 칩 · 간 곳)만. 어느 것도 New 고름을 지우지 않는다 |
| `row` · `activeKey` · `pickedId` · `drafts` | `state.old`에서만. New를 눌러도 Old 초안 그대로 |
| `setChecked` · 우클릭 · `selectNewSentence` · `openNewCtxMenu` | 그 쪽 고름만 바꾼다(Old를 놓지 않는다) |
| 다듬기 칸 · `busy` · 우클릭 메뉴 rowKey · 나눌 선 | `last` 쪽(`shapeOf(last)`) |
| 오른쪽 칸(846) | `last` 쪽. New를 눌렀고 Old도 골라 두었으면 위에 `assign-old-kept` en `Old {id} picked · Show decision` / ko `Old {id} 고름 · 결정 보기` |
| `mode === "unsourced"` | 들어갈 때 첫 문장을 New 고름으로. `selectRow`가 모드를 나가지 않는다 |
| 용지 표시 | `last` 쪽은 `data-sel`(진한 칠과 테), 먼저 고른 쪽은 뿌리 `.pg[data-held]`로 점선 테(덩어리를 다시 그리지 않는다). `data-state`의 `shape`는 없어지고 이음 표시(`picked` = 간 곳)만 남는다 |
| 한 단 · Pair view | 안 보이는 쪽 고름은 남되 단추 줄 · Enter는 보이는 쪽만(묻기 3) |
- [ ] 시험 `side-panel-model.test.ts`(`readPanelSide(state: FocusState, shown: { old: boolean; new: boolean }): { side: PickSide | null; keptOldId: number | null }`):
  ```ts
  it("shows the side pressed last and offers the kept Old row", () => expect(readPanelSide(both("new"), all)).toEqual({ side: "new", keptOldId: 3 }));
  it("offers nothing when Old was pressed last", () => expect(readPanelSide(both("old"), all)).toEqual({ side: "old", keptOldId: null }));
  it("ignores a hidden side", () => expect(readPanelSide(both("old"), { old: false, new: true })).toEqual({ side: "new", keptOldId: null }));
  ```
- [ ] 실패 확인 `npx vitest run src/lib/side-panel-model.test.ts` → 구현(`readLegacyFocus` 삭제) → 같은 명령 + 전체 `npx vitest run` · tsc 통과
- [ ] 커밋 `feat(assign): use both picks across the screen — 화면 전체가 두 고름을 씀`

### T4 — `buildPickBar`와 결정표
```ts
export type PickToolId = "split" | "merge_prev" | "merge_next" | "pair";
export interface PickTool { id: PickToolId; reasonKey: string | null }
export type PickMoreId = "show_linked" | "unlink" | "tools";
export interface PickLink { kind: "link" | "replace" | "add" | "unlink"; rowKey: string; unitId: number; targetIds: readonly number[]; result: readonly number[]; reasonKey: string | null; isEnter: boolean }
export type PickEnter = { kind: "link" } | { kind: "confirm" } | { kind: "noop"; noticeKey: string } | { kind: "none" };
export interface PickBar { at: { side: PickSide; unitId: number } | null; link: PickLink | null; startLink: PickSide | null; tools: readonly PickTool[]; more: readonly PickMoreId[]; enter: PickEnter }
export interface PickBarState {
  canEdit: boolean; mode: "old" | "unsourced"; isPicking: boolean; isMultiPick: boolean; isCell: boolean; last: PickSide | null; act: "pick" | "destination" | null;
  old: { rowKey: string; unitId: number; isConfirmed: boolean; savedTargetIds: readonly number[]; blockKey: string | null } | null;
  new: { unitIds: readonly number[]; targetIds: readonly number[]; additive: boolean; whyKey: string | null } | null;
  tools: readonly PickTool[];   // 마지막 박스의 buildUnitMenu(edit)에서
}
export function buildPickBar(state: PickBarState): PickBar
```
`savedTargetIds`는 묶음 API가 아니라 `written`(칸 `source_unit_ids` 포함)에서 — 줄을 고른 즉시 안다. `targetIds`는 부르는 쪽이 `addPartnerTargets`로 편다. `result`는 저장 뒤의 이음(빈 목록 = 배정 취소). `more`는 `savedTargetIds`(New면 출처)가 있을 때만 `show_linked` · `unlink`.
- [ ] 시험 `pick-bar-model.test.ts` — 결정표 하나를 `it.each(CASES)("%s", (_, state, want) => expect(summary(buildPickBar(state))).toEqual(want))`로(`summary`가 at.side · link.kind · result · isEnter · reasonKey · startLink · tools 수 · enter를 뽑는다):
  | # | Old | New | 그 밖 | at | link → result | startLink | tools | enter |
  |---|---|---|---|---|---|---|---|---|
  | 1 | – | – | – | – | – | – | 0 | none |
  | 2 | 안 정함 | – | last old | old | – | new | 4 | confirm |
  | 3 | – | 문장 t | last new | new | – | old | 4 | none |
  | 4 | 안 정함 | t | last new | new | link → [t] | – | 4 | link |
  | 5 | 안 정함 | t | last old | old | link → [t] | – | 4 | link |
  | 6 | 이음 [s] | t | last new | new | replace → [t] | – | 4 | link |
  | 7 | 이음 [s] | t, additive | last new | new | add → [s, t] | – | 4 | link |
  | 8 | 이음 [t] | t | last new | new | unlink → [] | – | 4 | noop `assign.pick.alreadyLinked` |
  | 9 | 이음 [s, t] | t, additive | last new | new | unlink → [s] | – | 4 | noop `assign.pick.alreadyLinked` |
  | 10 | 삭제로 확정 | t | last new | new | replace → [t] | – | 4 | link |
  | 11 | 안 정함 | t | act destination, last old | old | link → [t](isEnter 거짓) | – | 4 | confirm |
  | 12 | 안 정함, blockKey | t | last new | new | link(reasonKey = blockKey) | – | 4 | noop blockKey |
  | 13 | 안 정함 | 제목(whyKey) | last new | new | link(reasonKey = whyKey) | – | 4 | noop whyKey |
  | 14 | 안 정함 | 칸 t | isCell, last new | new | link → [t] | – | 0(`more`에 tools) | link |
  | 15 | 안 정함 | t | isPicking | – | – | – | 0 | none |
  | 16 | 안 정함 | t | isMultiPick | – | – | – | 0 | none |
  | 17 | 안 정함 | t | canEdit 거짓 | – | – | – | 0 | none |
  | 18 | 안 정함 | t | unsourced, last old | old | link → [t] | – | 4 | link |
  | 19 | 안 정함 | – | unsourced, last old | old | – | new | 4 | none |
  더해 `it("marks Enter on exactly one of the bar and the primary", () => { for (const [, state] of CASES) { const b = buildPickBar(state); expect(b.link?.isEnter ?? false).toBe(b.enter.kind === "link"); } })`
- [ ] 실패 확인 `npx vitest run src/lib/pick-bar-model.test.ts` → 구현 → 같은 명령 통과
- [ ] 커밋 `feat(assign): decide the pick bar and Enter in one place — 단추 줄과 Enter의 뜻을 한 곳에서 정함`

### T5 — `PickBar` 부품과 한 줄 CSS
```ts
export interface PickBarProps { bar: PickBar; toolLabel: (id: PickToolId) => string; keyOf: (id: PickToolId | "link") => string | null; busy: boolean; testId: string;
  onLink: () => void; onStartLink: (to: PickSide) => void; onTool: (id: PickToolId) => void; onMore: (id: PickMoreId) => void }
```
값: 자리는 **마지막 쪽 용지의** `renderUnitActions`(문장 · 칸 모두 지나는 길, 합친 문장 풀기 단추와 같은 칸). 차례 `[잇기 글자 .btn.pri h-7] | [손질 .pick-tools.mbtn-set] [이을 상대] [⋯]`, 손질 앞 세로 선 1px `--line-2`. 손질 단추는 공용 `class="mbtn"` 그대로, 못 하는 것은 `aria-disabled`(누름 무시)이고 라벨 자리에 까닭. `.pick-tools`는 폭 고정(`calc(아이콘 수 * 32px + 132px)`, 펼친 라벨 최대 160px 안)이라 펼쳐도 줄이 늘지 않는다. `.pick-bar { display: flex; flex-wrap: nowrap; container-type: inline-size; min-height: 30px }`, 칸 안(`.cell-piece .pick-bar`)은 `container-type: normal`(표 열 폭이 눌린다). 좁으면 `@container (max-width: 420px · 340px · 260px)`에서 손질이 뒤에서부터 하나씩 `display: none` — JS로 재지 않고, `⋯`를 누르는 순간 `offsetParent === null`인 손질을 메뉴에 넣는다. `⋯` 메뉴는 있는 떠 있는 메뉴 부품. 줄 안 포커스면 `Tab`은 브라우저 기본, 마우스로 누른 뒤에는 포커스를 용지로(B1). 움직임 줄이기면 전환 없음.
- [ ] 시험 `pick-bar.test.ts`:
  ```ts
  it("shows link, then a divider, then tools", () => expect(order(html(row(4)))).toEqual(["link", "sep", "split", "merge_prev", "merge_next", "pair", "more"]));
  it("keeps an unavailable tool with its reason", () => { const h = html(row(2), { split: "split.menu.why.notText" }); expect(h).toMatch(/pick-tool-split"[^>]*aria-disabled="true"/); expect(h).not.toContain(' disabled=""'); });
  it("draws the Enter mark only on the link", () => { expect(html(row(4)).match(/<kbd>↵<\/kbd>/g)).toHaveLength(1); expect(html(row(11))).not.toContain("<kbd>↵</kbd>"); });
  it("draws only link and more in a cell", () => expect(order(html(row(14)))).toEqual(["link", "more"]));
  ```
- [ ] 실패 확인 `npx vitest run src/components/assign/pick-bar.test.ts` → 구현 → 같은 명령 + `npx vitest run src/source-rules.test.ts` 통과
- [ ] 커밋 `feat(assign): draw the pick bar in one line — 단추 줄을 한 줄로 그림`

### T6 — 잇기는 명령 하나, 그 자리 메뉴는 없앤다
```ts
export interface LinkRequest { row: ClassifyRow; units: readonly UnitRow[]; groups: readonly Group[]; result: readonly number[]; reason: string }
export type LinkSave = { kind: "save"; body: GroupSaveInput; released: number[] } | { kind: "clear"; units: { unit_id: number; revision: number }[] };
export function buildLinkSave(request: LinkRequest): LinkSave                  // linkAsSource · unlinkCell · runMenu의 끊기를 하나로
// AssignCommand에 더함: { kind: "link"; rowKey: string; unitIds: readonly number[]; boxId: number; targetIds: readonly number[]; result: readonly number[]; link: PickLink["kind"]; remark: string | null }
```
규칙: 누른 순간 값을 잡고 즉시 다음 박스로(앞 계획의 판단 명령과 같은 규칙), 보낼 때 `loadRowGroup` + `getGroupByTarget`으로 묶음을 새로 읽는다 — 그래서 줄 묶음을 기다리던 `dropLink`(2684) · `queuedSaveRef` 길이 없어진다. 잇고 나면 **New 고름을 비운다**. 저장 안 한 초안은 버리고 알림에 적는다(`assign.pick.linkedDropDraft`). 다른 New 문서 둘에 걸치면 지금처럼 Remark 창 → `enqueue`. 끌어 놓기(`onDrop`)는 지금처럼 놓는 즉시 잇고 확정한다 — 같은 명령을 바로 `enqueue`하고, 막힌 까닭은 메뉴 대신 알림(정한 것 1). 간 곳 · 출처 칩 이동(`jump`)은 그 박스를 골라 단추 줄이 뜬다(지금의 끊기 메뉴 자리). 칩 ×(`onUnlink`)도 같은 명령(`unlink`). 엮은 문서의 막힌 초안(`draftMenu` 2700 · `settleDrop`)은 메뉴 대신 까닭 알림. 연결선은 양쪽을 고른 동안 점선 하나(`buildLinkPairs`의 `draft`에 New 고름을 넘긴다).
- [ ] 시험 `link-save-model.test.ts`와 `command-queue.test.ts`:
  ```ts
  it("links one sentence and its pair partner", () => expect(saved([71, 72]).body.targets.map((t) => t.id)).toEqual([71, 72]));
  it("replaces the row's other links", () => expect(saved([72], { linked: [71] }).body.targets.find((t) => t.id === 71)?.source_unit_ids).toEqual([]));
  it("unlinking the last one clears the decision", () => expect(buildLinkSave(request([], { linked: [71] }))).toEqual({ kind: "clear", units: [{ unit_id: 3, revision: 2 }] }));
  it("carries the remark", () => expect(saved([71, 91], { reason: "두 문서" }).body.units[0].reason).toBe("두 문서"));
  it("a link command keeps the row and the targets it was pressed with", () => { q.push(link({ boxId: 3, targetIds: [71] })); pickAnotherRow(); expect(q.next()).toMatchObject({ boxId: 3, targetIds: [71] }); });
  ```
- [ ] 실패 확인 `npx vitest run src/lib/link-save-model.test.ts src/lib/command-queue.test.ts` → 구현 · `link-menu.tsx`와 위 이름들 삭제 → 같은 명령 통과 + `grep -rnE "LinkMenu\b|openMenu|listLinkMenuItems|resolveDropLink" frontend/src` 0줄
- [ ] 커밋 `feat(assign): link and unlink from the pick bar as one queued command — 잇기와 끊기를 단추 줄의 명령 하나로`

### T7 — Enter · 확정 단추 · 글쇠 · 출처 없음
`resolveEnter(bar: PickBar, primary: <계획 2의 확정 판정>): PickEnter`가 계획 2의 판정을 감싼다(잇기가 먼저, 아니면 그대로). 확정 단추 이름은 잇기면 en `Link → New {n}` / ko `잇기 → New {n}`. `moveRow`는 `last`가 new면 New 용지 순서(잡음 블록은 한 자리, 제목 포함), 아무것도 고르지 않았으면 보이는 첫 줄. 판단 글쇠(Del · ⇧H · U)는 늘 Old 줄(삭제된 줄을 누른 때는 R3). "출처 없음"에서 Old를 눌러도 저장하지 않는다(`linkAsSource` 삭제).
- [ ] 시험 `assign-keymap.test.ts`(`routeKey(key, { last, focusIn }): { side: PickSide | null; id: string | null }`):
  ```ts
  it("Enter links while both are picked, else asks the primary", () => { expect(resolveEnter(bar(4), confirm)).toEqual({ kind: "link" }); expect(resolveEnter(bar(11), confirm)).toEqual({ kind: "confirm" }); });
  it("judgement keys stay on Old, shape keys and J follow the last side", () => { expect(routeKey("Delete", on("new")).side).toBe("old"); expect(routeKey("s", on("new")).side).toBe("new"); expect(routeKey("j", on("new")).side).toBe("new"); });
  it("Tab indents on the paper and not inside the bar", () => { expect(routeKey("Tab", on("new")).id).toBe("indent"); expect(routeKey("Tab", { last: "new", focusIn: "pick-bar" }).id).toBeNull(); });
  ```
- [ ] 실패 확인 `npx vitest run src/lib/assign-keymap.test.ts` → 구현 → 같은 명령 통과
- [ ] 커밋 `feat(assign): give Enter one meaning across both documents — 두 문서에서 Enter의 뜻을 하나로`

### T8 — 빈 곳 · 이을 상대 · 이은 줄 보기 · New 여럿
```ts
export function resolveBlankClick(state: { isSheetArea: boolean; isOnBox: boolean; hasTextSelection: boolean; isDragging: boolean; hasCut: boolean; isPicking: boolean }): "none" | "clear_cut" | "end_mode" | "clear_all"
export const BLANK_STOPS = ".strip, .cell-piece, .strip-lead, .toc-block, .deleted-line, .fold-line, .fold-run, .fold-head, .strip-merge, .unwrap-head, .shift-head, .pick-bar, .pane-head, button, a, input, textarea, [role='slider']";
```
듣는 자리는 `.assign-panes`의 `onClick`(React 이벤트 — 이펙트 0). 스크롤 막대(누른 x가 `clientWidth` 밖) · 떠 있는 판 · 오른쪽 칸은 아니다. 초안 · 사유는 그 줄에 남는다. `startLink`는 화면 상태 `linkWait: PickSide | null`과 띠 `assign-link-wait`(en `Click the New sentence to link` / ko `이을 New 문장을 누르세요`, Esc · 반대쪽을 누르면 끝). `show_linked`는 `showInNew`(2579) · `jumpToOld` 길로 옮기기만 한다(고름 그대로). New의 Shift+클릭은 `checkedNew: ReadonlySet<number>`, 위쪽 바는 "n줄 고름"만(묻기 2). 짝 · 캡션 고르는 중 반대쪽을 누르면 그 쪽 고름만 바뀐다.
- [ ] 시험 `blank-click-model.test.ts`:
  ```ts
  it("clears everything on blank paper", () => expect(resolveBlankClick(blank({}))).toBe("clear_all"));
  it("takes the cut first, then the pick mode", () => { expect(resolveBlankClick(blank({ hasCut: true, isPicking: true }))).toBe("clear_cut"); expect(resolveBlankClick(blank({ isPicking: true }))).toBe("end_mode"); });
  it.each([{ isOnBox: true }, { hasTextSelection: true }, { isDragging: true }, { isSheetArea: false }])("does nothing for %o", (over) => expect(resolveBlankClick(blank(over))).toBe("none"));
  it("stops on a lead, a fold row and the bar", () => { for (const c of ["strip-lead", "fold-run", "pick-bar"]) expect(el(c).closest(BLANK_STOPS)).not.toBeNull(); });
  ```
- [ ] 실패 확인 `npx vitest run src/lib/blank-click-model.test.ts` → 구현 → 같은 명령 통과
- [ ] 커밋 `feat(assign): let a click on blank paper drop the picks — 빈 곳을 누르면 고름이 풀림`

### 브랜치 끝
- **스모크 — §14가 승인**: `assign-link-menu` 18줄(`assign.mjs:1549, 2065, 2070, 2074, 2077, 2088, 2096, 2097, 2100, 2108, 2275, 2464, 3147, 3149, 3409, 5476, 5866, 6156`). 끌어 잇기 단계(`:1503`)는 즉시 확정 그대로 — 막힌 놓기의 메뉴만 알림으로. "메뉴가 없다"만 보던 곳(2464 · 5491 · 5562 · 5678 · 5928 · 6195 · 6208)은 `[role="menu"]` 수 0으로 — testid가 사라지면 늘 참인 검사가 된다.
- **승인받을 목록**(§14에 이름이 없다, 묻기 4): `pw-overlap-audit.mjs:250-301` · `pw-contrast-audit.mjs:136` · `pw-manual-shots.mjs:130`(그 자리 메뉴 장면 → 단추 줄), `assign.mjs:1443-1475`(New를 누르면 초안이 아니라 고름, `data-state="picked"` → `data-sel`), `:1936-1962`, `:2237-2291`(칸은 늘 누를 수 있다, 누르면 고름), `:3365-3411`(`data-state="shape"` → `data-sel`), `:7693-7733`(출처 없음에서 Old를 누르는 단계는 지금 없어 새 단계로 더한다).
- **새 단계**: `assign: pick Old and New in either order, the bar links under the box pressed last` · `assign: link replaces, adds with Ctrl and unlinks from the bar` · `assign: Enter links while both are picked, confirms after choosing a destination` · `assign: a click on blank paper drops both picks, Esc keeps the Old pick` · `assign: without a source - Old then Enter links`.
- **설명서**: `#assign` 429행, `#assign-destination` 472 · 476 · 495행, `#assign-links` 518-520행, `#assign-confirm`, `#assign-bulk` 727행(Ctrl), `#assign-new` 751행, `#assign-view`, `#assign-keys` 793-794행.
- **CHANGELOG**: `Old와 New를 각각 고르고, 누른 박스 아래 단추 줄에서 잇거나 다듬습니다 — 양쪽을 고르면 Enter가 잇기입니다.`
- **세워 둘 조건**: ① 저장 안 한 초안이 잇기(알림 있음) 말고 다른 길로 사라진다. ② 명령 큐가 잇기를 한 길로 못 받는다. ③ 결정표와 화면이 어긋나 화면에 예외를 두고 싶어진다. ④ 빈 To-Be 문서에 배정된 줄의 배정 취소 길이 막힌다(§5 H3).

---

## feat/new-paper-3-tools

**한 문장:** New 한 단 · 양 단에서 Old와 같은 손질을 쓰고, 이은 칸이 든 표를 바꿀 때는 n · m을 먼저 묻는다.

**Files**
- Create: `frontend/src/lib/doc-tools-model.ts` · `.test.ts`, `lib/edit-ask-model.ts` · `.test.ts`
- Modify: `backend/app/sop/editing.py:2143-2147`, `backend/app/sop/detach.py`(읽기 함수 하나), `backend/app/sop/ai/classify.py:99`, `backend/app/sop/ai/unwrap_order_job.py`, `use-assign-page.tsx`(1307 · 1365 · 1483-1505 · 1752-1766 · 1787 · 3131-3215, `unwrapMotion` 478 · 1449), `page.tsx:590-685`, `components/assign/new-paper.tsx` · `old-pane.tsx`, `components/paper/bundle-head.tsx`, `lib/use-unwrap-ai.ts`, `lib/new-overlay-model.ts`, `lib/assign-model.ts:103`(`buildLinkPairs`), `link-lines.tsx:79`(`readHover`), `lib/i18n-messages.ts`, `components.css`(새 선택자), `docs/architecture/api-contract.md` · `decisions.md`
- Test: `backend/tests/test_sop_tables.py` · `test_sop_ai_unwrap_order.py` · `test_sop_decision_undo.py`, 위 프런트 시험

**Interfaces** — Consumes: `NewPaper` · `NewOverlay` · `DocShape` · `enqueue`, 계획 2의 `split-new-parity`(서버가 New에서 `SwitchLanguageOp`를 받고 이은 문장이면 묻는다), 스텝 0의 되돌리기 고침. Produces: `buildDocTools`, `confirm_required`의 `linked_cells` · `held_rows`.

### T1 — New 표 편집의 확인에 n · m을 싣는다 (backend)
응답 꼴을 글자 그대로 보는 시험이 여럿이라(`test_sop_editing.py:415` · `test_sop_unwrap.py:153` · `test_sop_decisions.py:1221` …) **`document.side == "new"`이고 `change.layouts`가 있을 때만** 두 값을 더한다. 있는 시험 가운데 따라 바뀌는 것은 New 다시 표로 하나(`test_sop_tables.py:389`)다.
```python
async def count_new_table_links(session: AsyncSession, unit_ids: Collection[int]) -> tuple[int, int]:
    """(이음이 풀릴 새 문장 수, 보류로 갈 Old 줄 수) — 아무것도 쓰지 않는다. 묻는 창이 쓴다."""
```
값: n = 그 단위들의 새 문장 중 출처가 있는 `kind="sentence"` 수. m = `detach_targets`와 **같은 묶음**(`collect_component(target_ids=…)`)에서 판단이 미배정이 아닌 Old Unit을 짝 · 묶음으로 접은 줄 수 — 표의 칸 연결은 표 전체가 한 묶음이라 바꾸지 않은 형제 칸의 줄도 든다(서버가 실제로 그렇게 보류한다).
- [ ] 시험 `test_new_table_confirm_tells_links_and_held_rows`(`test_sop_tables.py:366` 옆, 벗긴 칸 둘을 Old 둘에 이은 뒤) · `test_new_table_confirm_counts_a_pair_as_one_row`(한/영 짝 → `held_rows == 1`) · `test_new_table_confirm_is_zero_for_a_cell_marked_new`(`linked_cells == 0`) · `test_old_table_confirm_keeps_its_shape`(`detail.keys() == {"code", "unit_ids"}`) · `test_undo_restores_the_links_of_a_confirmed_new_unwrap`(`test_sop_decision_undo.py`: Assign 되돌리기 뒤 칸 `source_unit_ids`와 Old `status`가 처음과 같다):
  ```python
  detail = _edit(client, bundle_id, new_doc["id"], _set_layout(table["table_id"], False)).json()["detail"]
  assert detail == {"code": "confirm_required", "unit_ids": sorted([a["id"], b["id"]]), "linked_cells": 2, "held_rows": 2}
  done = _ok(_edit(client, bundle_id, new_doc["id"], _set_layout(table["table_id"], False), confirm=True))
  assert len(done["detach"]["held_unit_ids"]) == detail["held_rows"]
  ```
- [ ] 실패 확인 `.venv/bin/python -m pytest tests/test_sop_tables.py -q -k confirm` → 구현 → `pytest tests/test_sop_tables.py tests/test_sop_editing.py tests/test_sop_unwrap.py tests/test_sop_decisions.py tests/test_sop_decision_undo.py -q` 통과
- [ ] 커밋 `feat(editing): tell how many links a New table change lets go — New 표를 바꾸면 풀릴 이음과 줄 수를 알림`

### T2 — AI 순서 제안을 New에 연다 (backend)
§8은 화면의 `isSolo`만 풀면 된다고 적었지만 **서버도 막는다**: `select_unwrap_order_items` → `load_latest_extractions`(`classify.py:99`)가 Old만 받아 404다. `load_latest_extractions(session, bundle_id, document_id, *, sides: Sequence[str] = ("old",))`로 넓히고 순서 작업만 `("old", "new")`. classify · split · translate는 그대로.
- [ ] 시험 `test_order_request_accepts_a_new_document_table`(`response.json()["queued"] == 1`, 끝까지 돌려 제안 `applied`) · `test_new_table_order_payload_has_no_names`(Old의 같은 시험과 같은 단언) · `test_classify_still_refuses_a_new_document`(`_code(response) == (404, "document_not_found")`)
- [ ] 실패 확인 `.venv/bin/python -m pytest tests/test_sop_ai_unwrap_order.py -q -k new` → 구현 → 같은 파일 + `tests/test_invariants.py` `tests/test_sop_ai_classify.py` 통과
- [ ] 커밋 `feat(ai): accept order requests for unwrapped New tables — 벗긴 New 표에도 순서 제안을 받음`

### T3 — 확인 창 글
```ts
export interface EditAsk { count: number; linkedCells: number | null; heldRows: number | null }
export function readEditAsk(err: unknown): EditAsk | null                                            // readConfirmCount(1365) 자리
export function describeNewTableAsk(ask: EditAsk): { bodyKey: string; values: { n: number; m: number } } | null   // n이 0이거나 없으면 null → 지금 글
```
문구 `assign.newTable.confirmTitle.unwrap` en `Unwrap table {n}?` / ko `표 {n}{p} 벗길까요?`, `.rewrap`은 지금 다시 표로 제목, `assign.newTable.confirmBody` en `{n} linked cells lose their links, and {m} Old rows they were linked to go on hold.` / ko `이은 칸 {n}개의 이음이 풀리고, 이어져 있던 Old 줄 {m}개는 보류로 갑니다.` Old 표의 글(`describeEditConfirm` 1493 · `countDecidedLines`)은 그대로.
- [ ] 시험 `edit-ask-model.test.ts`: `it("reads the New numbers from a 409", () => expect(readEditAsk(rule({ code: "confirm_required", unit_ids: [1], linked_cells: 2, held_rows: 1 }))).toEqual({ count: 1, linkedCells: 2, heldRows: 1 }))` · `it("leaves an Old ask without numbers", () => expect(readEditAsk(rule({ code: "confirm_required", unit_ids: [1, 2] }))).toEqual({ count: 2, linkedCells: null, heldRows: null }))` · `it("is null for another rule", () => expect(readEditAsk(rule({ code: "unit_has_decision" }))).toBeNull())` · `it("uses the plain text when nothing was linked", () => expect(describeNewTableAsk({ count: 1, linkedCells: 0, heldRows: 0 })).toBeNull())`
- [ ] 실패 확인 `npx vitest run src/lib/edit-ask-model.test.ts` → 구현 → 같은 명령 + `src/lib/i18n-messages.test.ts` 통과
- [ ] 커밋 `feat(assign): ask with the New numbers before a New table changes — New 표를 바꾸기 전에 칸 수로 묻기`

### T4 — 손질 손잡이를 쪽과 상관없이 짓는다
```ts
export type PaperPlace = "old" | "new-wide" | "new-pair";
export interface DocTools { noise: boolean; headingShift: boolean; unwrap: boolean; unwrapAi: boolean; numberCell: boolean; join: boolean; carve: boolean; split: boolean; lineGrip: boolean; deleted: boolean; fold: boolean; figureDelete: boolean; wholeBundle: boolean }
export function buildDocTools(input: { place: PaperPlace; canEdit: boolean; mode: "old" | "unsourced"; hasNumberRanges: boolean; isAiOn: boolean }): DocTools
```
값: `page.tsx:590-685`와 훅의 `isSolo` · `isNewEdit` 조건을 이것 하나로. New 두 자리는 `noise` · `headingShift` · `unwrap` · `unwrapAi` · `numberCell` · `join` · `carve` · `split` · `lineGrip`이 Old와 같고 `deleted` · `fold` · `figureDelete` · `wholeBundle`만 거짓. `use-unwrap-ai`는 문서마다 한 벌(보이는 Old, 보이는 New). `changeLanguage`(1752)의 Old 조건을 지우고 New는 `confirm: false`로 보내 서버가 묻게 한다(R4) — Old의 "묻지 않고"는 그대로.
- [ ] 시험 `doc-tools-model.test.ts`: `it("gives both New places the same tools", () => expect(buildDocTools(at("new-wide"))).toEqual(buildDocTools(at("new-pair"))))` · `it("differs from Old only in the decision-bound tools", () => expect(diff(buildDocTools(at("old")), buildDocTools(at("new-pair")))).toEqual(["deleted", "figureDelete", "fold", "wholeBundle"]))` · `it("turns everything editable off for a reader", () => expect(buildDocTools({ ...at("new-pair"), canEdit: false })).toMatchObject({ join: false, numberCell: false, unwrap: false, noise: true }))`
- [ ] 실패 확인 `npx vitest run src/lib/doc-tools-model.test.ts` → 구현 → 같은 명령 + 전체 `npx vitest run` 통과
- [ ] 커밋 `feat(assign): give New documents the same tools — New 문서에도 같은 손질을 줌`

### T5 — New 표: 이은 수 · 벗기기 · 칸 표시
표 머리 `assign-new-table-links-<unitId>` en `{m} of {n} cells linked` / ko `칸 문장 {n} 가운데 {m} 이음` + 막대 + **표 벗기기**. 칸 표시는 §8 4-3 문구 그대로(막대는 모서리 각지게), 꼬리표 `{r}행 {c}열 · {k}/{n}`. `useUnwrapMotion(newPaneRef)`를 하나 더 걸어 New 칸에서도 풀기 전환(움직임 줄이기면 번쩍임만). `export function readTableLinks(model: PaperModel, boxes: ReadonlyMap<number, NewBox>): ReadonlyMap<number, { linked: number; total: number }>`, `export function listLinkableRows(rows: readonly WrittenSentence[]): LinkableRow[]`(문장 + 칸, `buildLinkPairs`가 받는다 — 지금은 칸이 빠져 선이 없다), `readHover`가 `.new-cell[data-cell-target]`도 잡는다.
- [ ] 시험: `new-overlay-model.test.ts` `it("counts linked cells of each table", () => expect(readTableLinks(model, boxes).get(60)).toEqual({ linked: 1, total: 4 }))` · `assign-model.test.ts` `it("draws a link to a cell, not to its table", () => expect(buildLinkPairs(listLinkableRows([tableRow]), new Set([9]), null)).toEqual([{ unitId: 9, targetId: 7, draft: false, ai: false }]))` · `new-paper.test.ts` `it("shows the linked count and an unwrap button", () => expect(html({ table: true })).toMatch(/assign-new-table-links-60"[\s\S]*assign-new-unwrap-60/))`
- [ ] 실패 확인 `npx vitest run src/lib/new-overlay-model.test.ts src/lib/assign-model.test.ts src/components/assign/new-paper.test.ts` → 구현 → 같은 명령 통과
- [ ] 커밋 `feat(assign): count linked cells on a New table and unwrap it in place — New 표의 이은 칸 수와 벗기기`

### T6 — New를 그 자리에서 다듬는다
두 번 눌러 나누기 · ← → · `S`, 틈 합치기, 번호 칸 · 들여쓰기(`set_number` · `set_indents`), 글자 골라 새 박스(New 문서 id로), "제목으로", 다시 표로, 덩이 줄 순서 — 모두 `DocShape`(side new)로 간다. 양 단의 표 칸을 나누려고 한 단으로 보내던 갈래(1787)를 지운다. 가위 단추 → en `Wide view` / ko `넓게 보기`(`Maximize2`, testid `assign-new-edit-original` 그대로). `assign.solo.note` · `assign.solo.noteInPlace`(지금 "먼저 Old를 고르고 누르라")를 새 동작으로.
- [ ] 시험 `lib/doc-shape-model.test.ts`: `it("sends every edit to the document of the pressed box", () => { expect(pickEditTarget([old1, new7], { side: "new", unitId: 70 })).toEqual({ docId: 7, side: "new" }); expect(pickEditTarget([old1, new7], { side: "old", unitId: 3 })).toEqual({ docId: 1, side: "old" }); })` · `it("splits a table cell in place", () => expect(canSplitInPlace(cellUnit, new7)).toBe(true))`
- [ ] 실패 확인 `npx vitest run src/lib/doc-shape-model.test.ts` → 구현 → 같은 명령 + 전체 `npx vitest run` 통과
- [ ] 커밋 `feat(assign): shape New sentences where they stand — New 문장을 그 자리에서 다듬음`

### T7 — 같은 스모크 함수를 세 자리에서
- [ ] `smoke/assign.mjs`에 `runShapeTools({ page, place, docId, prefix, sideTestId })`(`place` = `old` · `new-wide` · `new-pair`) — 두 번 눌러 나누기 · 틈 합치기 · 번호 고치기 · 표 벗기기 / 다시 표로 · 제목 되돌리기 · 앞부분 블록 펼치기 · `Ctrl+Z`를 **한 벌의 `check` 이름**으로. 3275 · 3343 단계가 이 함수를 부르되 있던 검사 수를 줄이지 않는다
- [ ] 새 단계 `assign: unwrapping a New table with linked cells asks with both numbers, Ctrl+Z brings the links back`(합성 문서는 그 단계가 만든다 — 파일 이름 `SYNTHETIC_NEW-UNWRAP_steps.docx`, 본문이 2열 표 하나: 1열 `2.1` · `2.2` · `2.3`, 2열은 칸마다 한글 문단 하나와 영어 문단 하나. 스모크가 문서를 올리는 지금 방법을 따른다. 2.1 · 2.2 한글 칸에 Old 줄 하나씩 이어 n 2 · m 2)
- [ ] 확인은 메인 세션이 브랜치 끝에: `QUIET=1 ONLY="assign:" node scripts/pw-smoke-sop.mjs`
- [ ] 커밋 `test(smoke): run the shaping checks on Old, New alone and New beside Old — 손질 검사를 세 자리에서 같은 함수로`

### 브랜치 끝
- **스모크**: T7의 둘. 3275 · 3343을 함수로 옮기는 것은 §14에 이름이 없다(묻기 4).
- **설명서**: `#split` 347행 · `#split-edit` 365행, `#assign` 428-429행, `#assign-number` 588행 머리, `#assign-toc` 664행, `#assign-heading-shift` 670행, `#assign-unwrap`(New 표 · 이은 수 · 확인 글), `#assign-destination` 476행(칸), `#assign-undo`.
- **CHANGELOG**: `New 문서에서도 표 벗기기 · 다시 표로 · 번호 · 나누기 · 제목 되돌리기를 Old와 같이 합니다. 이은 칸이 든 표를 바꾸기 전에 풀릴 이음과 보류로 갈 줄 수를 묻습니다.`
- **세워 둘 조건**: ① `Ctrl+Z`가 이음이나 확정을 하나라도 못 되살린다(스텝 0의 고침이 이 길까지 왔는지 먼저 본다). ② 창에 보인 m과 `detach.held_unit_ids`를 접은 수가 다르다. ③ New 손질이 Old 판단을 묻지 않고 바꾼다. ④ AI 순서 제안이 New에서 순서 말고 다른 것을 쓴다(`test_invariants.py`).

---

## 정한 것 (계획을 쓰며 나온 물음의 답)
1. **끌어 놓기는 지금처럼 놓는 즉시 잇고 확정**한다(설계 §8). -2 T6의 `onDrop`은 `enqueue`로 바로 보낸다. 막힌 놓기만 알림.
2. New 여럿 고르기의 위쪽 바는 `feat/assign-multi-merge` 전까지 "n줄 고름"만.
3. 안 보이는 쪽의 고름은 세지 않는다.
4. 스모크: 선택자만 바뀌는 곳과 공통 함수로 옮기는 곳은 "동작이 바뀌어 따라 바뀌는 것"이다. 같은 수의 단계로 고치고 커밋에 목록을 적는다. 그 밖은 세운다.
5. 표째 이은 New 표(n = 0, m > 0)는 "이어져 있던 Old 줄 m개는 보류로 갑니다"만 보인다.

## Self-review
- 덮기: 4-1(그리기 · 탭 · 까닭 · EQUIS · AI 거르기 · 칸 칩/끊기) = -1 T2-T6, 4-2(두 고름 · 단추 줄 · Enter · 빈 곳 · 오른쪽 칸 · 출처 없음 · 상대 고르기 · 이은 줄 · New 여럿 · LinkMenu 삭제) = -2 T2-T8, 4-3(나누기 · 틈 · 번호 · 다시 표로 · 제목 · 접기 · 글자 골라 새 박스 · 표 벗기기 확인 · 칸 표시 · 넓게 보기 · 세 자리 스모크) = -3 T3-T7, R4의 화면 몫 = -3 T4 · T6.
- 초록 유지: -1 T6은 타입을 좁혀 지우고, -2 T2는 `readLegacyFocus`로 화면을 지킨 채 모델을 바꾼다. -2 T4-T5는 화면에 걸지 않은 채 초록, T6에서 건다.
- 이름: `NewPaper` · `buildPickBar` · `PickBar` · `enqueue` · `ASSIGN_KEYS` · `NoiseBlock`은 색인 표 그대로. 나머지는 이 파일 안에서만 쓴다.
