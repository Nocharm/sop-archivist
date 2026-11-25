# 쪼개기 먼저 5 — 표 · 숫자 · Excel (스텝 6 · 7)

> **For agentic workers:** 차례 · 공용 이름 · 게이트 · 세우는 조건은 [색인](2026-11-25-split-first.md)이 먼저다. 이 파일은 스텝 6 · 7의 아홉 브랜치만 적는다.

**Goal:** 표를 접어 보고 벗긴 표의 번호가 이어지고 한글 표에서 한 일이 영어 표에 제안되며, 진행 숫자 · AI 수 · Excel이 정한 일을 그대로 말한다.

**Architecture:** 번호 · 짝 표 · 행 짝 · 세기는 DB를 모르는 순수 함수(`numbering.py` · 새 `table_follow.py` · `progress-model.ts`)에 두고 화면 사본은 `rule-cases.json`이 대조한다. 새 쓰기는 모두 `editing._write_change`의 `_Change`와 명령 큐를 지난다. 규칙 제안은 저장하지 않고, AI 제안은 `ai_suggestions`에만 쓴다.

**Spec:** [`2026-11-25-split-first-design.md`](../specs/2026-11-25-split-first-design.md) §5 H4 · §7 R3 · §9 · §11-1 · §14 · [`2026-11-23-assign-feedback-2.md`](../specs/2026-11-23-assign-feedback-2.md) E2 · D1 · D2 · F3 · E3 · F1 · S10 · S11 · S15–S18.

**Global Constraints:** 색인 파일.

| 브랜치 | 구현 | 검토 | 까닭 |
|---|---|---|---|
| `feat/assign-tables-tab` | O | S | 용지 덩어리 · J/K · 접기가 한 부품에서 만난다 |
| `feat/unwrap-continue-numbers` | O | O | 번호 규칙 사본 셋, 되돌리기 두 칸 |
| `feat/table-follow-1-counterpart` | O | O | 점수 · 저장 표 · 호출 동안 세션 |
| `feat/table-follow-2-rule` | O | O | 편집 + 판단을 한 칸으로 |
| `feat/table-follow-3-ai` | S | O | `unwrap_order` 한 벌을 본뜬다, AI 불변식 확인 |
| `fix/progress-by-disposition` | O | O | 진행 숫자의 사본 셋을 함께 |
| `fix/ai-suggestions-retire` | S | O | 편집 · 되돌리기 · 채택률의 경계 |
| `feat/space-preview-trim` | S | S | 매개변수 넷과 창 하나 |
| `fix/excel-a-strike` | S | S | 칸 표시 하나 |

**시작할 때 다시 볼 것** — `dev` `e704ddf8`을 읽고 썼다. 줄 번호는 이 커밋 기준이고 앞 계획이 바꾼 것은 **그때 코드**를 이름으로 찾는다: `enqueue` · `AssignCommand`, `ASSIGN_KEYS`(⇧O · ⇧T 줄) · `lib/part-history.ts`(탭 목록), `NewPaper` · `PartTabs testIdPrefix="assign-new-tab"` · `readTableLinks`, `buildDocTools`, `PaperChunk` · 거르기 덩어리, `usePaneMeasure`, `MergeRowsOp` · `SetLayoutTablesOp` · `read_merged_pieces`, `noise_reason` · `NOISE_FRONT` · `NOISE_HISTORY` · `SheetRow.noise`, `HIDDEN_AI_KINDS` · `isDraftingOn()` · `AUTO_CLASSIFY` · `PLAN_DELETES` · `SHOW_C_SHEET`, 스텝 0의 되돌리기 고침. `move`(다른 Bundle) 단추는 이미 없다. Alembic 번호는 만들 때 `alembic heads`.

**명령** — 프런트 `cd frontend && npx vitest run <파일>`, 백엔드 `cd backend && .venv/bin/python -m pytest <파일> -q`. 작업 끝마다 `npm run lint && npx tsc --noEmit -p tsconfig.json` 또는 `.venv/bin/ruff check app/ tests/`. `(F)` = 돌려서 적은 까닭으로 실패, `(P)` = 같은 명령 통과. 명령을 안 적은 `(F)` · `(P)`는 **그 작업의 시험 단계가 이름을 댄 파일**을 위 명령으로 돌린다(실패 까닭은 모듈 · 열 · 경로가 없음). 시험 조각의 `unit()` · `row()` · `html()` 같은 만들개는 그 파일 머리에 둔다. **새 `useEffect` · 타이머 0.**

---

## feat/assign-tables-tab
- **한 문장:** 표만 모은 탭과 본문 표 접기를 Old · New 용지에 더하고 접힘을 문서마다 기억한다 (E2-R1~R5, S15, 설계 §9).
- **Files** — Create: `frontend/src/lib/table-tab-model.ts` · `.test.ts`, `lib/table-fold-prefs.ts` · `.test.ts`, `components/paper/paper-table-fold.test.ts` **·** Modify: `lib/paper-model.ts:221`(`FigureRowMode` 옆) · `:592`(`PaperTabKey`) · `:600-660`(`buildPaperTabs` · `listPartSheets`), `lib/figure-spot-model.ts:32`(`buildStripRows`), `components/paper/paper.tsx:255 · 382-388 · 1054(renderBundleHead) · 1435(renderUnwrapHead)`, `components/paper/bundle-head.tsx:13`, `components/paper/part-tabs.tsx:16`, `components/assign/old-pane.tsx:164-232`, `components/assign/new-paper.tsx`, `use-assign-page.tsx:662-664 · 708-730 · 1131-1160`, `lib/i18n-messages.ts:1266 · 3293`, `styles/components.css`(새 선택자), `docs/qa/feature-map.md:22`, `docs/architecture/frontend.md` §2 · §3 **·** Test: `lib/paper-model.test.ts`, 위 `.test.ts`
- **Interfaces** — Consumes: `PaperTabs` · `getTableNumber` · `findUnwrapHeads` · `PartTabs` · `readTableLinks`. Produces: `PaperTabKey`에 `"tables"`, 아래 타입.
### T1 — 탭과 접기의 모델
```ts
export interface TableBlock { tableId: number; section: string; rows: number; cols: number; caption: string; isUnwrapped: boolean; unitIds: number[] }
export function listTableBlocks(view: DocumentView, model: PaperModel): TableBlock[]                 // 본문의 바깥 표, 문서 차례. 띠 표(제목 줄)와 칸 안 표는 바깥 것에 든다
export function listTableTabUnitIds(blocks: readonly TableBlock[]): number[]
export function resolveFolded(folded: ReadonlySet<number>, blocks: readonly TableBlock[], openUnitIds: ReadonlySet<number>): ReadonlySet<number>   // 고른 단위가 든 표는 펼친다
export function toggleFold(folded: ReadonlySet<number>, tableId: number): ReadonlySet<number>
export function toggleFoldAll(folded: ReadonlySet<number>, blocks: readonly TableBlock[]): ReadonlySet<number>   // 하나라도 펼쳐 있으면 모두 접고, 모두 접혀 있으면 모두 펼친다
```
- [ ] 시험 `table-tab-model.test.ts`:
  ```ts
  it("lists outer body tables in document order with their section", () => expect(listTableBlocks(view, model).map((b) => [b.tableId, b.section, b.rows, b.cols, b.isUnwrapped])).toEqual([[2, "5", 4, 2, false], [5, "6", 3, 3, true]]));
  it("leaves band tables and inner tables out", () => expect(listTableBlocks(nested, nestedModel).map((b) => b.tableId)).toEqual([1]));
  it("walks an unwrapped table line by line and a whole table as one", () => expect(listTableTabUnitIds(blocks)).toEqual([20, 31, 32, 33]));
  it("keeps the table of the picked unit open", () => expect(resolveFolded(new Set([2, 5]), blocks, new Set([32]))).toEqual(new Set([2])));
  it("folds all, then opens all", () => { expect(toggleFoldAll(new Set(), blocks)).toEqual(new Set([2, 5])); expect(toggleFoldAll(new Set([2, 5]), blocks)).toEqual(new Set()); });
  ```
- [ ] (F) `npx vitest run src/lib/table-tab-model.test.ts` → 모듈 없음 → 구현: 서명대로. `section` = 표 첫 블록의 `section_label`
- [ ] (P) → 커밋 `feat(paper): list the tables of a document for a tab and folding — 문서의 표를 탭 · 접기용으로 모음`
### T2 — 문서마다 기억
```ts
export function readFoldedTables(docId: number): ReadonlySet<number>;   // 키 sopa.assign.tablesFolded.<docId>, JSON 숫자 배열
export function writeFoldedTables(docId: number, ids: ReadonlySet<number>): void;
```
- [ ] 시험 `table-fold-prefs.test.ts`: `it("remembers per document", () => { writeFoldedTables(3, new Set([2])); expect(readFoldedTables(3)).toEqual(new Set([2])); expect(readFoldedTables(4)).toEqual(new Set()); })` · `it("is empty for junk and for a blocked store", …)` (`assign-view-prefs.test.ts:64`의 꼴, `getItem`이 던지면 빈 집합)
- [ ] (F) → 구현(try/catch) → (P) `npx vitest run src/lib/table-fold-prefs.test.ts` → 커밋 `feat(assign): remember folded tables per document — 접은 표를 문서마다 기억`
### T3 — 탭과 자리
`partKeys` 끝에 `tables`(B2 글쇠표의 탭 차례 `body · header · footer · figures · tables` 중 있는 것 — S15의 그림은 예시). `tabOf`는 표 단위를 **본문**으로 둔다(고른 표가 탭을 옮기지 않는다 — 그림과 다르다). 표 탭에 있으면 J/K는 `listTableTabUnitIds`만 돈다(그림 탭의 `isFigureWalk` 자리). 표 탭의 그리기는 `Paper`에 `tableRows?: "all" | "only"`를 더해 `buildStripRows` 뒤에서 거르고, 표마다 앞에 위치 머리 `assign-table-place-<tableId>` en `Under §{section}` / ko `§{section} 아래`(절이 없으면 줄 없음).
- [ ] 시험 `paper-model.test.ts`: `it("offers a tables tab only when there is a table", () => { expect(keys(withTable)).toEqual(["body", "figures", "tables"]); expect(keys(noTable)).not.toContain("tables"); })` · `it("a picked table stays in the body tab", () => expect(buildPaperTabs(view, model).tabOf.get(20)).toBe("body"))`; `paper-table-fold.test.ts`: `it("draws tables only, each under its place", () => { const h = html({ tableRows: "only" }); expect(h).toContain("§5"); expect(h).not.toContain("본문 문장"); })`
- [ ] (F) `npx vitest run src/lib/paper-model.test.ts src/components/paper/paper-table-fold.test.ts` → 기대 어긋남 → 구현: 서명대로. 문구 `split.tab.tables` en `Tables` / ko `표`, `counts.tables`
- [ ] (P) + `npx vitest run src/lib/assign-keymap.test.ts src/lib/part-history.test.ts` → 커밋 `feat(assign): a Tables tab with the place of each table — 표마다 자리를 적은 표 탭`
### T4 — 접기와 모두 접기
머리 두 곳(`BundleHead` 표 · `renderUnwrapHead`)에 `assign-table-fold-<tableId>`(펼침 = `Collapse`/`접기`). 접힘 = 한 줄 단추 `▸ Table {n} · {caption} · {rows} x {cols}` / `▸ 표 {n} · {caption} · {rows}행 {cols}열`(캡션이 없으면 그 마디 빠짐, `n` = `getTableNumber`, 크기는 원문 표), New에서 아직 표면 뒤에 `assign.newTable.links` 글(계획 3의 `{n}` 가운데 `{m}` 이음). 본문 탭 위 `assign-tables-fold-all`(표가 있을 때). 접힌 표의 줄은 J/K · Shift+클릭 · 연결선 대상에서 빠진다(접힘 = DOM에 없음). 표 탭에서는 접기를 걸지 않는다.
- [ ] 시험 `paper-table-fold.test.ts`: `it("folds a table into one line and opens on press", () => { const h = html({ folded: new Set([2]) }); expect(h).toContain("▸ Table 2 · 배양 조건 · 4 x 2"); expect(h).not.toContain("assign-paper-piece-21"); })` · `it("a folded New table tells its linked cells", () => expect(html({ folded: new Set([2]), links: { linked: 1, total: 4 } })).toContain("1 of 4"))` · `it("draws the same markup when nothing is folded", () => expect(html({ folded: new Set() })).toBe(html({})))`
- [ ] (F) → 구현: 용지 손잡이 `strips.tables?: { folded: ReadonlySet<number>; onToggle: (tableId: number) => void; links?: ReadonlyMap<number, { linked: number; total: number }> }`, 훅은 문서마다 `useState` 하나(문서가 바뀌면 렌더 중 `readFoldedTables`로 다시 읽음) → (P) + 전체 `npx vitest run` → 커밋 `feat(assign): fold tables in the paper and all at once — 본문 표 접기 · 모두 접기`
### 브랜치 끝
- **스모크**: 새 단계 하나 `assign: tables tab and folding — fold survives a reload, J stays in the tab`(S15, Old · New 양 단을 같은 함수로). 있는 단계 중 바뀌는 것 없음(`Figures` 탭 단계 1117은 탭 글을 이름으로 찾는다). 본문 위에 단추가 늘어 줄 높이가 바뀌면 `pw-layout-audit.mjs`는 정식 업데이트 때.
- **설명서**: `#assign` 430 · 431행(탭), 같은 절에 표 접기 한 항목. **기능 맵** Assign 행의 탭 · J/K. **CHANGELOG**: `표만 모은 Tables 탭이 생기고, 본문의 표를 한 줄로 접어 둘 수 있습니다(문서마다 기억).`
- **세워 둘 조건**: ① 접힌 표 때문에 저장 뒤 고름이 사라진다(`resolveFolded`로 안 풀리면). ② 긴 문서 스크롤 · 고르기가 앞 커밋보다 20% 넘게 느리다(`pw-perf-assign.mjs`). ③ 탭 키를 더하며 `part-history`의 뒤로 가기가 깨진다.

## feat/unwrap-continue-numbers
- **한 문장:** Old 표를 벗기면 숫자 칸이 위 번호 아래로 이어지고(되돌리기는 번호 → 벗기기 두 칸), 합치면 같은 목록의 뒤 번호가 당겨진다 (D1-R1~R7, S17, 설계 §9 · §11-1).
- **Files** — Create: `backend/tests/test_sop_continue_numbers.py`, `frontend/src/lib/continue-number-model.ts` · `.test.ts` **·** Modify: `backend/app/sop/numbering.py:399` 뒤, `app/sop/editing.py`(643 `_plan_merge`, 계획 4의 `_plan_merge_rows`, 681 `_plan_unmerge`, 2265 `apply_edit` 뒤 새 함수), `app/routers/sop_documents.py:896-914`(`edit_units`), `app/sop/paragraph_excel.py:39-43 · 339 · 343`, `scripts/dump_rule_cases.py:40`, `frontend/src/lib/rule-cases.json`(뽑음) · `rule-cases.test.ts`, `lib/number-kind-model.ts:71-80`, `lib/decision-step-model.ts:48-52`, `lib/i18n-messages.ts`, `backend/CLAUDE.md` 10.3 · 12.11 줄, `docs/architecture/backend.md` §12.11, `docs/architecture/api-contract.md`(편집 응답) **·** Test: `tests/test_sop_paragraph_excel.py:73 · 84 · 332 · 358`(명세가 이름을 댄 것), `tests/test_sop_numbers.py`, `tests/test_sop_decision_undo.py`, 프런트 `number-model.test.ts:33 · 42`, `number-kind-model.test.ts:61 · 73 · 101`
- **Interfaces** — Consumes: `SetLayoutTableOp` · `SetLayoutTablesOp` · `MergeRowsOp`, `plan_follow`, `get_section_level`, `record_unit_edit_step`. Produces: `plan_continue` · `plan_pull` · `continue_numbers` · 편집 기록 종류 `continue_numbers`(`unit_edits.op`은 `String(24)`, CHECK 없음 — **Alembic 없음**).
### T1 — 순수 규칙 `plan_continue`
```python
@dataclass(frozen=True)
class FlowLine:
    """번호 흐름의 줄 하나(원문 차례) — table_id는 벗긴 표 덩이 안이면 그 표, 표 밖(띠 표 제목 포함)이면 None.
    is_cell은 사람이 고치지 않은 숫자 칸 번호이고 그 칸이 행의 첫 칸인가."""
    number: str | None; lang: str; kind: str; table_id: int | None = None; is_cell: bool = False
def find_parent_number(lines: Sequence[FlowLine], index: int) -> str | None
def plan_continue(lines: Sequence[FlowLine], table_id: int) -> dict[int, str]    # 자리 → 새 번호, 바뀌는 줄만
```
위 번호 찾기(의사 코드, 정답 표를 **적힌 입력 그대로** 만족하는 읽기 — 물을 것 1):
```
outside = index 앞 · 같은 lang · table_id None · get_section_level(number) > 0 인 줄      # "1)" · 점 기호 · 직접은 level 0이라 건너뜀
없으면 None
last = outside의 마지막, head = last 번호의 마지막 마디를 뗀 것("" 가능)
last.kind == "heading" 이거나 head == "" 이면 last 번호                                     # 제목 5 → 5, 본문 5.2(5가 없는 문서) → 5.2
outside에 번호가 head인 줄이 있으면 head                                                    # 제목 5 · 본문 5.1 다음 표 → 5
아니면 last 번호
```
`plan_continue`: 번호는 `normalize_number`로 견주고("5." = "5") 위 번호마다 이어 셀 순번 = 표 앞의 같은 lang 줄(표 안팎 모두) 가운데 `위 번호.k` 꼴의 가장 큰 k. 표의 줄을 원문 차례로 보며 `is_cell`이고 숫자 번호인 줄만 — 한 마디면 순번을 올려 `위.k`(끝 점은 칸이 읽은 번호를 따름), 여러 마디면 직전 한 마디 줄의 새 번호로 앞머리만 바꿈, 이미 `위.`로 시작하면 그대로. 나머지 줄은 건드리지 않는다.
- [ ] 시험 `test_sop_continue_numbers.py` — D1 정답 표를 글자 그대로(`H` 제목, `B` 본문, `C` 표 9의 숫자 칸, `T(표, 번호)` 이미 매긴 앞 표 줄, `L` 표 9의 그 밖 줄):
  ```python
  ANSWERS = [
      ([H("5"), C("1"), C("2"), C("3")], {1: "5.1", 2: "5.2", 3: "5.3"}),
      ([H("5"), T(8, "5.1"), T(8, "5.2"), T(8, "5.3"), C("1"), C("2")], {4: "5.4", 5: "5.5"}),
      ([H("5"), B("5.1"), C("1"), C("2")], {2: "5.2", 3: "5.3"}),
      ([B("5.2"), C("1"), C("2")], {1: "5.2.1", 2: "5.2.2"}),
      ([H("5"), B("1)"), C("1"), C("2")], {2: "5.1", 3: "5.2"}),
      ([H("5"), B("•"), C("1"), C("2")], {2: "5.1", 3: "5.2"}),
      ([C("1"), C("2"), C("3")], {}),
      ([H("5"), B("5.1"), H("5", lang="en"), C("1", lang="en"), C("2", lang="en")], {3: "5.1", 4: "5.2"}),
  ]
  @pytest.mark.parametrize(("lines", "expected"), ANSWERS)
  def test_answer_table(lines, expected): assert plan_continue(lines, 9) == expected
  def test_only_number_cells_change(): assert plan_continue([H("5"), C("1"), L("•"), L("A-1"), L(None), C("2")], 9) == {1: "5.1", 5: "5.2"}
  def test_heading_above_is_always_the_parent(): assert plan_continue([H("5"), H("5.1"), C("1")], 9) == {2: "5.1.1"}
  def test_two_languages_share_the_numbers(): assert plan_continue([H("5"), H("5", lang="en"), C("1"), C("1", lang="en"), C("2"), C("2", lang="en")], 9) == {2: "5.1", 3: "5.1", 4: "5.2", 5: "5.2"}
  def test_numbers_a_person_fixed_stay(): assert plan_continue([H("5"), C("7", is_cell=False), C("1")], 9) == {2: "5.1"}
  ```
- [ ] (F) `.venv/bin/python -m pytest tests/test_sop_continue_numbers.py -q` → import 오류 → 구현: 서명대로 → (P) → 커밋 `feat(numbering): continue table cell numbers under the number above — 표 숫자 칸을 위 번호 아래로 이어 셈`
### T2 — 벗기기 뒤 한 칸으로 기록
```python
async def continue_numbers(session: AsyncSession, document: Document, table_ids: Sequence[int], *, actor: str) -> EditResult | None
    """벗긴 표의 숫자 칸 번호 잇기 — 편집 기록 하나(op "continue_numbers"). Old가 아니거나 바뀌는 줄이 없으면 아무것도 쓰지 않고 None."""
```
`edit_units`: `SetLayoutTableOp(is_layout=True)` · `SetLayoutTablesOp`가 실제로 바뀌었으면(`document_revision != revision`) 단계를 남긴 **뒤** `dump_bundle_state` → `continue_numbers` → `record_unit_edit_step`(같은 `undo`) → `commit` 한 번. 응답의 `document_revision`은 마지막 것. 흐름 줄은 묶이지 않은 활성 · 잡음 없는 `NUMBERED_KINDS` 단위를 `pos_seq` 차례로, `table_id`는 `find_line_table`, `is_cell` = `number_source == NUMBER_CELL and number_set is None` 이고 번호 칸의 `col_index`가 그 행에서 글이 있는 첫 칸. 바깥 · 안쪽 표를 함께 벗기면 문서 차례로 표마다.
- [ ] 시험(문서는 `p("5. 조작 순서", "Heading1")` + 표(1 전원을 켠다 · 2 압력이 0.2 MPa가 되면 · 3 밸브를 연다 · 4 10분 동안 순환한다) + `p("6. 기록", "Heading1")` — 번호로 읽히려면 타자 번호에 점이 있어야 한다):
  ```python
  def test_unwrapping_numbers_the_cells_and_undoes_in_two_steps(client):
      assert numbers() == ["5.1", "5.2", "5.3", "5.4"]
      undo(); assert (numbers(), is_layout()) == (["1", "2", "3", "4"], True)
      undo(); assert is_layout() is False
      redo(); redo(); assert numbers() == ["5.1", "5.2", "5.3", "5.4"]
  def test_second_table_under_the_same_heading_goes_on(client): assert numbers(second) == ["5.4", "5.5"]
  def test_a_new_document_is_never_numbered(client): assert numbers() == ["1", "2"] and edit_ops() == ["set_layout_table"]
  def test_back_to_table_and_unwrap_again_keeps_the_numbers(client): assert numbers() == ["5.1", "5.2", "5.3", "5.4"]
  ```
  그 밖(같은 단계에서 씀): `test_document_undo_also_takes_two_presses`(edits/undo 두 번, 다시 하기 두 번) · `test_several_tables_at_once_are_two_undo_steps`(set_layout_tables → 번호 → 벗기기) · `test_a_value_cell_in_the_middle_of_a_row_is_left_alone`(농도 | 5 | %) · `test_decided_lines_keep_their_decisions`(번호 편집은 판단을 묻지 않고 확정이 그대로)
- [ ] (F) `pytest tests/test_sop_continue_numbers.py -q` → `["1", "2", "3", "4"]` → 구현 + 프런트 `UNIT_EDIT_STEP_OPS` · `isUnitEditStep`에 `continue_numbers`, `assign.step.continue_numbers` en `Continue numbers` / ko `번호 이어 매기기`
- [ ] (P) + `pytest tests/test_sop_unwrap.py tests/test_sop_unwrap_nested.py tests/test_sop_pair_tables.py tests/test_sop_numbers.py tests/test_sop_decision_undo.py -q`(있는 되돌리기 시험 가운데 숫자 칸이 든 표를 벗기는 것만 한 번 더 누르게 고친다 — 목록을 커밋에) → 커밋 `feat(editing): number an unwrapped Old table in its own undo step — 벗긴 Old 표 번호를 따로 한 칸으로`
### T3 — 합치면 뒤 번호 당기기
```python
def plan_pull(numbers: Sequence[str | None], kept: int, absorbed: Sequence[str]) -> dict[int, str]
    """합쳐 사라진 번호 뒤를 당긴다 — numbers는 같은 목록 후보(사라진 줄은 뺌), kept는 남은 줄. 사라진 번호 가운데 남은 줄과 같은 수준 · 같은 부모인
    것이 없으면 빈 결과. 사라진 줄의 아래 줄(5.3.1)은 남은 줄 아래로(5.2.1), 나머지는 plan_follow(numbers, kept, numbers[kept])."""
```
`_plan_merge` · `_plan_merge_rows`(언어 무리마다)가 Old에서 `change.numbers` · `sections`를 함께 채운다(후보 범위 = `_plan_set_number`와 같은 질의 — 함수 하나로 뺀다). `_plan_unmerge`는 되살린 마지막 줄부터 `plan_follow`로 다시 세어 겹치지 않게(명세에 없는 구석 — 물을 것 6). New는 당기지 않는다.
- [ ] 시험:
  ```python
  def test_pull(): assert plan_pull(["5.1", "5.2", "5.4"], 1, ["5.3"]) == {2: "5.3"}
  def test_pull_takes_children_along(): assert plan_pull(["5.2", "5.3.1", "5.4", "5.4.1"], 0, ["5.3"]) == {1: "5.2.1", 2: "5.3", 3: "5.3.1"}
  def test_no_number_absorbed_pulls_nothing(): assert plan_pull(["5.1", "5.2"], 0, []) == {} and plan_pull(["5.1", "5.2", "6"], 1, ["7"]) == {}
  def test_s17_merge_and_undo(client):            # T2 문서에서 이어서
      merge("5.2", "5.3"); assert numbers() == ["5.1", "5.2", "5.3"]
      undo(); assert numbers() == ["5.1", "5.2", "5.3", "5.4"]
      undo(); assert numbers() == ["1", "2", "3", "4"] and is_layout()
      undo(); assert not is_layout()
  def test_unmerge_does_not_leave_twin_numbers(client): assert numbers() == ["5.1", "5.2", "5.3", "5.4"]
  ```
  그 밖(같은 단계에서 씀): `test_body_lines_pull_too`(표 밖 6.1 · 6.2 · 6.3, 6.1+6.2 → 6.1 · 6.2) · `test_other_language_and_other_table_do_not_move` · `test_merge_rows_pulls_each_language`(짝 줄 둘 합치기 — 한글 · 영어 목록 각자) · `test_new_merge_keeps_written_numbers`
- [ ] (F) `pytest tests/test_sop_continue_numbers.py -q -k "pull or s17 or merge"` → import 오류 · `["5.1", "5.2", "5.4"]` → 구현 → (P) + `pytest tests/test_sop_editing.py tests/test_sop_merge_rows.py tests/test_sop_lang_shape.py tests/test_sop_numbers.py -q` → 커밋 `feat(editing): pull the numbers after a merge — 합치면 뒤 번호를 당김`
### T4 — 문단 Excel
`ORIGINAL_NOTE = "Original {read}"`. `def is_continued_number(unit: NumberedUnit) -> bool` = `number_source == NUMBER_CELL and number_set` 이고 `get_section_level(number_set) > get_section_level(number_read)`. 그 줄의 Number note는 `Original 1`(사람이 고친 나머지는 지금 `Source 3. → 4.` 그대로), `is_cell_number`는 `number_set is None or is_continued_number(unit)`이면 참 — "칸 번호는 그 표 안에서만"이 그대로다.
- [ ] 시험: `test_sop_paragraph_excel.py:332` `test_unwrapped_number_cells_do_not_leak_past_the_table`의 기대를 `["5.1", …], ["5.1 •", …], ["5.2", …], ["5.3", …], ["5.", "조제가 끝나면 기록을 남긴다."]`로, `:358`도 같은 뜻으로(`5.1` · `5.1` · `5.2` · 바깥 뒤 `5.`), `:73` · `:84`(순수 함수)는 **기대를 바꾸지 않는다**. 새 `test_continued_numbers_say_the_original`: Number note `["Original 1", "Original 2", "Original 3"]`, 사람이 `A`를 `B`로 고친 칸은 `Source A → B`.
- [ ] (F) `pytest tests/test_sop_paragraph_excel.py -q` → 구현 → (P) → 커밋 `feat(paragraphs): note the original cell number and keep it inside the table — 원래 칸 번호를 적고 표 안에 둠`
### T5 — 화면 사본과 정답 표
```ts
export interface FlowLine { number: string | null; lang: UnitLang; kind: string; tableId: number | null; isCell: boolean }
export function findParentNumber(lines: readonly FlowLine[], index: number): string | null
export function planContinue(lines: readonly FlowLine[], tableId: number): Map<number, string>
```
`dump_rule_cases`에 `plan_continue`(T1 `ANSWERS` 여덟 + 언어 둘 + 사람이 고침)와 `plan_follow` 줄 `(["5.1", "5.2", "5.4"], 1, "5.2")`(정답 표의 합치기 줄)를 더해 다시 뽑는다. `suggestUnitContinuous`는 벗긴 표의 줄이면 `findParentNumber` 아래 다음 순번(앞 줄의 자식 수 + 1), 위 번호가 없으면 지금 규칙.
- [ ] 시험: `rule-cases.test.ts`에 `it.each(cases.plan_continue)`. `number-kind-model.test.ts:73`을 `it("gives an unwrapped table line under heading 5 the number 5.1 (D1)", () => expect(suggestUnitContinuous([unit(1, "5", { kind: "heading" }), unit(2, "1", { table_id: 40 })], 2)).toBe("5.1"))`로. `:61` · `:101` · `number-model.test.ts:33 · 42`는 돌려 보고 그대로면 손대지 않는다(바뀌면 세움).
- [ ] (F) `.venv/bin/python -m scripts.dump_rule_cases` 뒤 `npx vitest run src/lib/rule-cases.test.ts src/lib/number-kind-model.test.ts` → 모듈 없음 · `"6"` → 구현 → (P) + `pytest tests/test_rule_cases.py -q` · 전체 `npx vitest run` → 커밋 `feat(numbers): mirror the continue rule and its answer table — 이어 매기기 사본과 정답 표`
### 브랜치 끝
- **스모크**: 새 단계 `assign: unwrapping an Old table continues the numbers, Undo steps numbers then table, ⇧J ⇧J pulls`(S17, 합성 `SYNTHETIC_OLD-5_Steps.docx`를 그 단계가 올린다). 있는 벗기기 단계(`assign.mjs` 2699 · 2740 · 4633 · 4778 · 4929 · 5005 · 5070 · 5183)의 Undo 횟수는 **그 표에 첫 칸 숫자가 있을 때만** 한 번 는다 — D1-R5가 정한 동작이라 따라 바뀌는 것(§14의 11-23 명세 항목), 커밋에 목록.
- **설명서**: `#assign-number` 605행, `#assign` 432행(Number note), `#assign-unwrap` · `#assign-undo`(두 칸), `#split-edit`(합치면 당김). **CHANGELOG**: `Old 표를 벗기면 숫자 칸이 위 번호 아래로 이어집니다(5.1 · 5.2 …, 첫 되돌리기는 번호만). 번호가 있는 줄을 합치면 뒤 번호가 당겨집니다.`
- **세워 둘 조건**: ① 되돌리기 두 칸이 다시 하기에서 어긋난다. ② 정답 표 한 줄이라도 규칙을 바꿔야 맞는다(물을 것 1의 답이 다르면 여기서 세움). ③ 번호 편집이 판단 · 짝을 하나라도 바꾼다. ④ 벗긴 칸 값(농도 5 같은 값)이 번호로 바뀌는 꼴이 첫 칸 검사 뒤에도 나온다.

## 모음 feat/table-follow
스텝 브랜치 셋을 차례로 이 모음에 합치고(스텝마다 그 diff만 검토), 모음 → `dev`는 시험 · 스모크만. 모음을 만들 때 `dev` 최신에서 딴다.

## feat/table-follow-1-counterpart
- **한 문장:** 영어 표의 짝 한글 표를 꼴 + 토큰 + 뜻으로 고르고, 애매하면 사람이 지정해 저장한다 (D2-R1~R3, AC1, 설계 §9 "Old만").
- **Files** — Create: `backend/app/sop/table_follow.py`, `backend/alembic/versions/<다음>_table_counterparts.py`, `backend/tests/test_sop_table_follow.py` **·** Modify: `app/sop/models.py:284` 뒤, `app/sop/constants.py`(상수), `app/routers/sop_documents.py`, `app/sop/counterparts.py:127`(`_list_candidates`를 공개 `list_candidates`로), `frontend/src/lib/api-sop.ts`, `components/paper/paper.tsx:1435`, `old-pane.tsx`, `use-assign-page.tsx`, `lib/i18n-messages.ts`, `docs/architecture/backend.md` §12.16 · `api-contract.md` **·** Test: 위 시험, `tests/test_migrations.py`
- **Alembic**(더하기만, 새 표 하나):
```python
"table_counterparts":
  id             Integer, primary key, autoincrement
  extraction_id  Integer, FK extractions.id ON DELETE CASCADE, index, NOT NULL
  table_id       Integer, FK source_tables.id ON DELETE CASCADE, unique, NOT NULL      # 영어 표
  source_table_id Integer, FK source_tables.id ON DELETE CASCADE, NULL                 # 한글 표, NULL = 사람이 "짝 없음"으로 정함
  decided_by     String(100), NOT NULL
  decided_at     DateTime(timezone=True), NOT NULL
```
- **Interfaces** — Produces: `TableCounterpart`, `read_tokens` · `score_tables` · `pick_counterpart`, `GET · PUT /bundles/{b}/documents/{d}/tables/{t}/counterpart`.
### T1 — 점수
```python
TABLE_FOLLOW_THRESHOLD = 0.6      # 합성 자료 기준, 실제 문서로 재설정
TABLE_FOLLOW_MARGIN = 0.1         # 위 두 후보가 이보다 가까우면 사람이 고른다 — 합성 자료 기준, 실제 문서로 재설정
def read_tokens(texts: Iterable[str]) -> Counter[str]          # 숫자+단위("10 ml", "4 °c", "ph 7.0"), 문서 번호, 영문 약어(대문자 2자 이상), 날짜 — 소문자 · 사이 빈칸 하나로. 번호 칸 값은 뺀다
def score_tables(source: FollowTable, table: FollowTable, vectors: Mapping[str, np.ndarray] | None) -> float
def pick_counterpart(scores: Mapping[int, float], chosen: int | None, *, has_choice: bool) -> Counterpart   # 영어 표 하나의 한글 후보들, status matched | ambiguous | none, 사람이 정했으면 그대로 matched | none
```
점수(의사 코드): `열 수가 다르면 0` · `shape = 1(행 수 같음) 또는 0.5` · `token = 겹친 토큰 수 / 두 쪽 토큰 수의 작은 쪽(둘 다 없으면 0)` · `embed = 짧은 쪽 행마다 가장 가까운 상대 행의 코사인 평균(없으면 쓰지 않음)` · `token == 0 이고 (embed가 없거나 embed < 0.5) → min(score, TABLE_FOLLOW_THRESHOLD - 0.01)`(**꼴만으로 연결 금지**) · `embed 있음: 0.2·shape + 0.4·token + 0.4·embed` · `없음: 0.3·shape + 0.7·token`. 후보: 번갈아 = 그 영어 표 바로 위의 같은 꼴(`is_same_form`) 한글 표 하나, 한/영 따로 = `list_candidates`(다른 절반 · 같은 겹, 벗김 상태는 보지 않음).
- [ ] 시험 `test_sop_table_follow.py`:
  ```python
  def test_same_shape_with_other_content_is_not_a_pair(): assert pick(EN6, {3: KO3}) == ("none", None)                 # AC1
  def test_shared_tokens_make_the_pair(): assert pick(EN5, {3: KO3}) == ("matched", 3)                                  # S18: 10 mL · 4 °C
  def test_tokens_ignore_number_cells_and_case(): assert read_tokens(["1", "Take 10 mL of sample.", "Keep at 4 °C after."]) == {"10 ml": 1, "4 °c": 1}
  def test_close_scores_ask_a_person(): assert pick(EN5, {3: KO3, 4: KO3_COPY})[0] == "ambiguous"
  def test_embeddings_lift_a_tokenless_pair(): assert score_tables(KO_PLAIN, EN_PLAIN, vectors(0.9)) >= TABLE_FOLLOW_THRESHOLD and score_tables(KO_PLAIN, EN_PLAIN, None) < TABLE_FOLLOW_THRESHOLD
  def test_a_persons_choice_wins_both_ways(): assert pick_counterpart({3: 0.1}, 3, has_choice=True).status == "matched" and pick_counterpart({3: 0.9}, None, has_choice=True).status == "none"
  ```
- [ ] (F) `pytest tests/test_sop_table_follow.py -q` → 모듈 없음 → 구현 → (P) → 커밋 `feat(tables): score counterpart tables by shape, tokens and meaning — 꼴 · 토큰 · 뜻으로 짝 표를 셈`
### T2 — 저장과 API
- [ ] 시험: `test_migrations`에 `test_table_counterparts_start_empty_and_hold_one_row_per_table`(두 번째 같은 `table_id`는 IntegrityError) · `test_counterpart_get_returns_status_and_candidates`(`{"status", "source_table_id", "candidates": [{"table_id", "table_no", "score"}], "table_no"}`) · `test_choosing_a_counterpart_is_stored_and_wins` · `test_choosing_none_is_stored` · `test_new_document_is_refused`(422 `invalid_side`) · `test_other_documents_table_is_404` · `test_reader_cannot_choose`(403) · `test_embed_call_holds_no_session`(`embed_texts`를 가로채 그때 세션이 닫혔는지 — `ping_ai`의 꼴) · `test_embedding_failure_falls_back_to_tokens`
- [ ] (F) → 구현: 핸들러는 읽기 → `await session.close()` → `embed_texts`(`EmbeddingUnavailable`이면 토큰만) → 응답. `PUT` 본문 `{ "source_table_id": int | null }`, 묶음 잠금 · 작업 중 검사 · `record_event(action="table.counterpart")`. 새 거절 코드 없음
- [ ] (P) + `pytest tests/test_migrations.py tests/test_invariants.py -q` → 커밋 `feat(tables): let a person pick the counterpart table — 짝 표를 사람이 지정`
### T3 — 표 머리 "짝 표 고르기"
- [ ] 시험 `lib/table-follow-model.test.ts`: `it("asks only for an unwrapped English Old table with an ambiguous answer", () => { expect(describeCounterpart({ lang: "en", side: "old", isUnwrapped: true, status: "ambiguous" })).toBe("ask"); expect(describeCounterpart({ lang: "ko", … })).toBe("none"); expect(describeCounterpart({ side: "new", … })).toBe("none"); expect(describeCounterpart({ status: "matched", … })).toBe("matched"); })`
- [ ] (F) `npx vitest run src/lib/table-follow-model.test.ts` → 구현: 벗긴 표 머리에 `assign-follow-pick-<tableId>`(`Select`, 보기 = 후보 `표 {n}` + `짝 없음`), 짝이 정해지면 흐린 글 `표 {n}과 짝`. 읽기는 `useLoaded` 하나(보는 Old 문서의 벗긴 영어 표마다 — 표 탭 · 본문 공통), 쓰기는 `enqueue`가 아니라 문서를 바꾸지 않으므로 바로 `PUT` 뒤 다시 읽기
- [ ] (P) + `i18n-messages.test.ts` → 커밋 `feat(assign): pick the counterpart of an English table — 영어 표의 짝 표 고르기`
### 브랜치 끝
- **스모크**: 새 단계 하나 `assign: an English table asks for its Korean table when two look alike`. **설명서** `#assign-unwrap-pair`. **CHANGELOG** 줄은 모음을 합칠 때 `-3`의 한 줄로.
- **세워 둘 조건**: ① 저장 표를 열 더하기로 바꿔야 한다. ② 임베딩 호출 동안 세션이 살아 있다. ③ 점수가 합성 표에서 엉뚱한 표를 0.6 위로 올린다(임계값을 낮추지 않고 보고).

## feat/table-follow-2-rule
- **한 문장:** 짝이 정해지고 맞춘 꼴이 같으면 한글 표에서 한 일(순서 · 삭제 · 합치기 · 들여쓰기 · 번호)을 AI 없이 제안하고 편집 하나로 적용한다 (D2-R4~R8, AC2 · AC3, S18).
- **Files** — Modify `app/sop/table_follow.py`, `app/sop/editing.py`(`FollowTableOp` + 계획 + `EditOp` · `_plan`), `app/routers/sop_documents.py`(편집 뒤 삭제), `frontend/src/lib/table-follow-model.ts` · `.test.ts`, Create `frontend/src/lib/use-table-follow.ts`, Modify `paper.tsx:1435 · 768`, `use-assign-page.tsx:668-680`(`useUnwrapAi` 자리), `lib/assign-keymap.ts`(⇧O의 말), `lib/decision-step-model.ts`, `i18n-messages.ts`. Test `tests/test_sop_table_follow.py`, 위 프런트 시험
- **Interfaces** — Consumes: T1의 짝 표 답, `read_merged_pieces`, `dispose_units`, `unwrapAi`. Produces: `FollowTableOp`(`follow_table`), `GET …/tables/{t}/follow`.
### T1 — 행 짝과 계획
```python
ROW_MATCH_THRESHOLD = 0.5         # 합성 자료 기준, 실제 문서로 재설정
def match_rows(source: Sequence[FollowLine], lines: Sequence[FollowLine], vectors: Mapping[str, np.ndarray] | None) -> list[tuple[int, int]]   # (한글 줄, 영어 줄) 자리 — 한글 쪽은 합친 줄이면 조각마다
def build_follow_plan(source: Sequence[FollowLine], lines: Sequence[FollowLine], matches: Sequence[tuple[int, int]]) -> list[FollowItem] | None   # None = 맞춘 꼴이 다름(AI 길)
```
행 짝(의사 코드): 모든 (한글 줄 · 조각, 영어 줄) 쌍의 점수 = `토큰이 겹치면 0.6 + 0.4·겹친 비율`, 아니면 `코사인`(임베딩이 있을 때), 빈 칸 표시(`(빈 칸)` · `(blank)` · 빈 글)끼리는 1 → 점수 큰 차례로, 둘 다 아직 짝이 없고 `ROW_MATCH_THRESHOLD` 이상이면 맺는다(**자리는 보지 않는다**). `len(matches) == 두 쪽 줄 수`가 아니면 꼴이 다르다(`None`). 계획: 순서 = 한글 줄의 지금 차례를 짝으로 옮긴 것, 번호 = 한글 줄의 번호(다르면), 들여쓰기 = 한글 줄의 `indent_shift`가 다르거나 표 안 상대 깊이(줄 깊이 − 그 표의 가장 얕은 깊이)가 다르면, 삭제 = 한글 줄이 확정 삭제, 합치기 = 한 한글 줄의 조각 둘 이상에 짝지은 영어 줄들.
- [ ] 시험(S18 그대로, 임베딩은 `install_embed_transport`로 1↔시료 · 2↔장비가 가깝게):
  ```python
  KO = [("5.1", "장비를 준비한다."), ("5.2", "시료 10 mL를 채취한다."), ("5.2.1", "채취 뒤 4 °C에 둔다."), (None, "(빈 칸)")]   # 마지막은 확정 삭제
  EN = [("1", "Take 10 mL of sample."), ("2", "Prepare the equipment."), ("3", "Keep at 4 °C after."), ("4", "(blank)")]
  def test_s18_row_pairs(): assert match_rows(KO, EN, VECTORS) == [(0, 1), (1, 0), (2, 2), (3, 3)]
  def test_s18_plan(): assert [(i.unit_ids, i.order, i.number, i.indent, i.delete) for i in plan] == [((1,), 2, "5.2", False, False), ((2,), 1, "5.1", False, False), ((3,), None, "5.2.1", True, False), ((4,), None, None, False, True)]
  def test_rows_are_matched_by_content_not_place(): ...   # AC2 — 같은 글을 거꾸로 놓은 표
  def test_other_row_count_has_no_rule_plan(): assert build_follow_plan(KO, EN[:3], match_rows(KO, EN[:3], VECTORS)) is None
  def test_without_embeddings_an_untied_row_means_no_rule_plan(): assert build_follow_plan(KO, EN, match_rows(KO, EN, None)) is None
  def test_merged_korean_lines_suggest_a_merge(): assert plan[0].unit_ids == (11, 12)
  ```
- [ ] (F) `pytest tests/test_sop_table_follow.py -q -k "s18 or rows or plan or merge"` → 구현 → (P) → 커밋 `feat(tables): match rows by content and plan what the Korean table did — 행을 내용으로 맞추고 한글 표의 일을 계획`
### T2 — 읽기 API와 편집 하나
```python
class FollowItemIn(BaseModel):
    unit_ids: list[DbId] = Field(min_length=1, max_length=MAX_EDIT_UNITS)   # 둘 이상이면 합친다
    delete: bool = False; number: NumberStr | None = None; indent_shift: IndentShift | None = None
class FollowTableOp(BaseModel):
    """한글 표처럼 하기 — 순서 · 합치기 · 번호 · 들여쓰기를 한 편집으로, 삭제는 같은 요청에서 판단으로(되돌리기 한 번)."""
    type: Literal["follow_table"]
    table_id: DbId
    items: list[FollowItemIn] = Field(min_length=1, max_length=MAX_EDIT_UNITS)
    order: list[DbId] | None = None      # 덩이 줄 전부(합칠 줄은 그 첫 줄) — null이면 순서를 바꾸지 않는다
```
`GET …/tables/{t}/follow` → `{ source_table_id, mode: "rule" | "ai" | "none", items: [...], count }`(저장하지 않는다 — D2-R7). 짝 표가 벗긴 것이고 손댄 것(`unwrap_seq` · 확정 삭제 · 합치기 · 들여쓰기 · 사람이 고친 번호)이 있을 때만 `rule`/`ai`. `edit_units`는 `FollowTableOp`면 `apply_edit` 뒤 `delete` 줄에 `dispose_units`(사유 빈칸, 지금 판단 revision을 서버가 읽어 넣음 — 스스로 커밋하지 않고, 새 문장이 달린 줄은 지금처럼 409 `unit_has_targets`로 편집까지 물린다)를 부르고 단계는 **맨 처음 `before_state`로 하나** — 편집이 비었으면(삭제만) `record_snapshot_step`.
- [ ] 시험:
  ```python
  def test_s18_apply_and_one_undo(client):
      before = _dump(bundle_id); _ok(_edit(..., follow_op, undo=META))
      assert paper_lines(table5) == [("5.1", "Prepare the equipment."), ("5.2", "Take 10 mL of sample."), ("5.2.1", "Keep at 4 °C after."), (None, "(blank)")] and is_deleted(blank)
      assert suggestions() == [] and ai_calls() == []
      _ok(_undo(client, bundle_id)); assert_same_state(_dump(bundle_id), before)
      _ok(_redo(client, bundle_id)); assert is_deleted(blank)
  def test_a_decided_line_asks_once(client): assert _code(response) == (409, "confirm_required")
  def test_follow_is_none_until_the_korean_table_was_worked_on(client): assert get_follow()["mode"] == "none"
  ```
  그 밖(같은 단계에서 씀): `test_one_item_alone_is_one_step`([하나씩 보기]) · `test_items_outside_the_table_are_refused`(422 unwrap_lines_mismatch) · `test_delete_with_merge_in_one_item_is_refused`(422 invalid_follow_item (새 코드 → rule.invalid_follow_item))
- [ ] (F) → 구현(`_plan_follow_table`은 `_plan_merge`의 초안 + `unwrap_seqs` + `numbers` + `indents`를 `_merge_changes`로 — D1의 `plan_pull`은 부르지 않는다, 번호를 다 적으므로) → (P) + `pytest tests/test_sop_decision_undo.py tests/test_sop_editing.py tests/test_invariants.py -q` → 커밋 `feat(editing): follow the Korean table in one edit and one undo — 한글 표처럼 하기를 편집 하나로`
### T3 — 화면
- [ ] 시험 `table-follow-model.test.ts`: `it("turns a plan into an op, whole or one row", () => { expect(buildFollowOp(5, plan)).toMatchObject({ type: "follow_table", order: [2, 1, 3, 4] }); expect(buildFollowOp(5, plan, [4])).toEqual({ type: "follow_table", table_id: 5, items: [{ unit_ids: [4], delete: true }], order: null }); })` · `it("writes a chip per kind", () => expect(describeFollowItem(plan[0])).toEqual([{ key: "assign.follow.order", values: { n: 2 } }, { key: "assign.follow.number", values: { n: "5.2" } }]))` · `it("⇧O asks to follow when there is a plan, else asks for the order", () => { expect(pickOrderAction({ follow: "rule", count: 4 })).toBe("follow"); expect(pickOrderAction({ follow: "none", count: 0 })).toBe("order"); })`
- [ ] (F) → 구현: 벗긴 영어 표 머리 `assign-follow-<tableId>` en `Do as the Korean table · {n}` / ko `한글 표처럼 하기 · {n}건` → **적용** · **하나씩 보기**(줄마다 칩 + 적용) · **그대로 두기**(이 화면에서만 감춤, 저장하지 않음). ✦ AI order 단추는 남고 ⇧O는 `pickOrderAction`. 큐에는 장벽 명령으로
- [ ] (P) + `assign-keymap.test.ts` · 전체 `npx vitest run` → 커밋 `feat(assign): show what the Korean table did as chips — 한글 표에서 한 일을 칩으로 보임`
### 브랜치 끝
- **스모크**: 새 단계 하나 `assign: follow the Korean table — four chips, Apply, one Undo brings everything back`(S18). 벗긴 표 머리 단추를 글자로 세는 단계 `assign.mjs:4670`("✦ AI order | ↺ Back to table")은 짝 제안이 없는 표라 그대로 — 새 단추는 제안이 있을 때만 뜬다.
- **설명서**: `#assign-unwrap` · `#assign-unwrap-pair`(한글 표처럼 하기), `#assign-keys` ⇧O.
- **세워 둘 조건**: ① 편집과 판단이 되돌리기 한 번으로 묶이지 않는다. ② 규칙 제안이 `ai_suggestions`에 남거나 알약 수에 든다. ③ 확정된 줄을 묻지 않고 바꾼다.

## feat/table-follow-3-ai
- **한 문장:** 짝은 맞지만 꼴이 다른 표는 새 AI 작업이 같은 종류의 제안을 내고 사람이 받는다 (D2-R9 · R10, AC4 · AC5).
- **Files** — Create `backend/app/sop/ai/table_follow_job.py`, `app/sop/ai/seeds/prompt.table_follow.md`, `alembic/versions/<다음>_ai_table_follow.py`, `tests/test_sop_ai_table_follow.py`. Modify `app/sop/constants.py:51 · 60-62`, `app/sop/ai/handlers.py:13`, `app/sop/ai/adoption.py:32`, `app/routers/sop_ai.py:182` 뒤, `app/routers/sop_documents.py`(채택은 지금 `POST /suggestions/{id}/adoption`), `frontend/src/lib/api-sop.ts:151`, `lib/ai-jobs-model.ts:38`, `lib/api-manage.ts:76-99`, `lib/use-table-follow.ts`, `lib/i18n-messages.ts:1698 · 3725`, `frontend/scripts/fake-ai-server.mjs:9 · 54`, `docs/architecture/backend.md` §6 · §11
- **Alembic**(CHECK 값 하나 더하기, `0037`의 꼴 그대로): `ai_jobs.kind` CHECK에 `'table_follow'`(열은 `String(12)` — 12자라 맞는다). `ai_suggestions.kind`는 CHECK가 없다. downgrade는 그 종류 작업을 지우고 옛 CHECK.
- **Interfaces** — Consumes: `-1` · `-2`의 `FollowLine` · `FollowItem` · `FollowTableOp`. Produces: `TABLE_FOLLOW_KIND = "table_follow"`, 지침 키 `prompt.table_follow`.
### T1 — 작업 종류와 검사
```python
class FollowAction(BaseModel):   # 응답 한 줄 — 모르는 칸은 버린다
    id: int; order: int; delete: bool = False; merge_with: int | None = None; indent_shift: int | None = None; number: AiStr | None = None
class TableFollowReply(BaseModel): actions: list[FollowAction]; reason: AiStr
```
페이로드 `{task: "table_follow", source: [{text, disposition, order, indent_shift, number, merged_texts}], lines: [{id, text, indent_shift, number}]}` — 이름 없음. 검사: `id`가 영어 줄 집합과 같고 한 번씩, `order`가 순열, `merge_with`는 그 집합 안 · 자기 아님 · 고리 없음, `number`는 40자 이하 줄바꿈 없음, `indent_shift`는 `IndentShift` 범위, `delete`와 `merge_with`를 함께 쓰지 않음. 낡음 = 두 표의 줄 집합 · 글 해시 · 한글 표 손본 결과의 해시(`_is_stale`의 꼴). 제안 내용 `{table_id, source_table_id, items, order, reason}`.
- [ ] 시험(`test_sop_ai_unwrap_order.py`를 본보기로): `test_migrated_jobs_table_accepts_the_new_kind`(`"'table_follow'" in definition`) · `test_payload_has_no_names` · `test_happy_path_writes_an_applied_suggestion` · `test_bad_replies_are_invalid_and_keep_no_text`(줄 빠짐 · 순열 아님 · 고리 합치기 · 모르는 id · 41자 번호) · `test_lines_changed_during_the_call_make_it_stale` · `test_korean_table_changed_during_the_call_makes_it_stale` · `test_a_rule_plan_queues_no_job`(422 `follow_not_needed` → `rule.follow_not_needed`) · `test_a_new_document_is_refused` · `test_suggestion_is_applied_by_the_follow_edit_and_adopted_by_hand`(`as_is` → 409 두 번째) · `test_adoption_stats_count_it_as_manual`
- [ ] (F) `pytest tests/test_sop_ai_table_follow.py -q` → 구현 → (P) + `pytest tests/test_invariants.py tests/test_migrations.py tests/test_sop_guidelines.py -q` → 커밋 `feat(ai): suggest following the Korean table when shapes differ — 꼴이 다른 표는 AI가 따라 하기를 제안`
### T2 — 화면과 가짜 AI
- [ ] 시험 `table-follow-model.test.ts`: `it("reads an AI suggestion into the same items", () => expect(readFollowSuggestion(suggestion)).toEqual(items))` · `it("drops an AI suggestion whose lines changed", () => expect(readFollowSuggestion(staleLines)).toBeNull())`; `ai-suggestion-model.test.ts`: `table_follow`는 `HIDDEN_AI_KINDS`에 없다
- [ ] (F) → 구현: `mode: "ai"`면 머리 단추가 `✦ Ask AI to follow the Korean table`(꺼져 있으면 흐린 단추 — `unwrap-ai-ask`의 꼴), 끝나면 `-2`와 같은 칩 · 적용, 적용 · 그대로 두기는 채택을 남긴다(`as_is` · `rejected`). 가짜 AI: 받은 줄 차례 그대로 + 첫 줄 번호 한 칸
- [ ] (P) + 전체 `npx vitest run` → 커밋 `feat(assign): take an AI follow suggestion like a rule one — AI 따라 하기 제안을 규칙 제안과 같은 손짓으로`
### 브랜치 끝(모음 합치기)
- **스모크**: 새 단계 하나 `assign: follow the Korean table with AI when the rows differ`(가짜 AI가 켜졌을 때만, 꺼져 있으면 지금 단계들처럼 건너뜀 줄). 모음 → `dev`: 전체 시험 + `ONLY="assign:"`.
- **설명서**: `#ai-kinds`, `#assign-unwrap-pair`. **CHANGELOG**: `벗긴 영어 표 머리의 "한글 표처럼 하기"가 한글 표에서 한 순서 · 삭제 · 합치기 · 들여쓰기 · 번호를 제안합니다. 꼴이 다르면 AI에 물어볼 수 있습니다. 짝 표를 가리는 값은 합성 자료로 잡았고 실제 SOP · 실제 모델로는 시험하지 않았습니다.`
- **세워 둘 조건**: ① `test_invariants.py`가 깨지거나 AI가 판단 · New 문장을 쓴다. ② CHECK 변경이 기존 행을 지운다. ③ 알약 · 수락 창 · "AI 제안 대기"에 이 종류가 든다.

## fix/progress-by-disposition
- **한 문장:** 진행 숫자를 "정함"과 처분별 막대로 바꾸고 그림을 따로 세며, 개요에 남은 손질 · AI 제안 대기를 보인다 (F3-R1~R7, S10, §11-1).
- **Files** — Create: `backend/app/sop/tidy.py`(남은 손질 · AI 제안 대기), `backend/tests/test_sop_tidy.py` **·** Modify: `app/sop/snapshot.py:553 · 599-645`, `app/sop/outputs.py:1882-1896`(`ReviewFacts`), `app/sop/review.py:109`, `app/routers/sop_bundles.py:148 · 211`, `frontend/src/lib/api-sop.ts:14 · 83`, `lib/progress-model.ts`, `lib/doc-dashboard-model.ts`, `lib/ai-suggestion-model.ts`, `lib/review-gates.ts`, `app/bundles/[id]/page.tsx:59-63 · 108 · 148-227`, `app/page.tsx:29-36`, `use-assign-page.tsx:242 · 1322 · 3563`, `assign-bar.tsx:42`, `components/assign/doc-dashboard.tsx:18-25 · 191-215`, `components/assign/assign-help.tsx:50`, `lib/i18n-messages.ts`, `docs/architecture/api-contract.md` · `backend.md` §12.6 **·** Test: `tests/test_sop_progress.py:17 · 61 · 129-170`, `test_sop_outputs.py:340 · 770-879 · 1248 · 1357-1361`, `test_sop_review.py`, `test_sop_bundles.py:131 · 476`, 프런트 `progress-model.test.ts` · `doc-dashboard-model.test.ts:22 · 41`
- **Interfaces** — Produces: `RowProgress`의 새 칸, `TidyCounts`, `countWaitingSuggestions`(E3가 다시 쓴다). 관리 화면(`bundles-panel.tsx`)은 손대지 않고 숫자만 바뀐다.
### T1 — 세 사본의 줄 규칙
`RowProgress` = 지금 다섯 + `assigned` · `deleted` · `moved`(셋의 합 = `confirmed`) + `figures_total` · `figures_decided`. 단위 종류가 `figure`인 줄은 앞의 모든 숫자에서 빠지고 뒤의 둘에만 든다(`single_language`는 글 단위라 그대로). 줄의 처분 = 확정 줄 구성원 중 `("assigned", "delete", "move_external")` 앞선 것. `build_review_facts.row_status_counts`(그림 포함)는 **그대로**, `figure_pending: int`를 더하고 막는 이유 `units_*`에 그림이 있으면 `figures: n`을 더한다(`figures`가 0이면 키를 넣지 않아 있는 시험 그대로).
- [ ] 시험:
  ```python
  def test_confirmed_splits_by_disposition(client): assert (p["confirmed"], p["assigned"], p["deleted"], p["moved"]) == (3, 1, 2, 0)
  def test_all_rows_deleted_is_all_decided(client): assert p["confirmed"] == p["total"] == p["deleted"]                       # AC1
  def test_figures_are_counted_apart(client): assert (p["total"], p["figures_total"], p["figures_decided"]) == (rows_without_figures, 2, 1)
  def test_review_still_waits_for_figures(client): assert blockers == [{"code": "units_unassigned", "count": 1, "figures": 1}]   # AC3
  def test_meaning_rows_match_progress(client): assert len(rows) == progress["total"] + progress["figures_total"]              # 있는 시험을 따라 바꿈
  ```
  그 밖(같은 단계에서 씀): `test_a_held_row_with_a_place_is_on_hold`(R5) · `test_progress_is_the_same_in_list_overview_and_admin`(새 칸까지 같다)
- [ ] (F) `pytest tests/test_sop_progress.py tests/test_sop_review.py -q` → `KeyError` · 기대 어긋남 → 구현: `load_bundle_progress`는 질의 두 번 그대로(묶음 식에 `kind == 'figure'`와 처분 순번을 더해 그룹) → (P) + `pytest tests/test_sop_outputs.py tests/test_sop_bundles.py tests/test_sop_slot_heading.py tests/test_sop_toc.py tests/test_sop_e2e.py -q` → 커밋 `feat(progress): split decided rows by disposition and count figures apart — 정함을 처분별로, 그림은 따로`
### T2 — 남은 손질 · AI 제안 대기
```python
class TidyCounts(BaseModel): refs: int; captions: int; ai_waiting: int
async def load_tidy_counts(session: AsyncSession, bundle_id: int) -> TidyCounts
WAITING_KINDS = ("match",)      # ai/constants.py — OFFERED_KINDS에서 숨긴 종류(프런트 HIDDEN_AI_KINDS)를 뺀 것, H4
```
`refs` = 옛 문서 활성 · 최신 단위 중 참조 판정이 `proposed`인 것(`read_ref_state`), `captions` = 화면의 `listCaptionPendingRowKeys`와 같은 규칙의 줄 수, `ai_waiting` = live(`applied` · 채택 없음) `WAITING_KINDS` 제안 중 덮는 단위가 모두 활성이고 그 줄이 안 정함인 것(줄 식은 `load_bundle_progress`와 같은 `row_key` · 순번). 나누기(`split`)는 숨긴 종류라 세지 않는다(§11-1). `BundleOut.tidy`(개요 응답만 — 목록 · 관리 목록 질의 수 그대로).
- [ ] 시험 `test_sop_tidy.py`: `test_refs_and_captions_match_the_assign_marks`(문서 보기에서 같은 규칙으로 센 수와 같음) · `test_waiting_counts_only_open_active_rows`(정한 단위 · 은퇴한 단위 · 낡은 제안 · 채택한 제안 · `classify`는 0) · `test_a_pair_row_is_open_when_one_side_is_open` · `test_list_and_admin_responses_have_no_tidy`
- [ ] (F) → 구현 → (P) → 커밋 `feat(overview): count what is left to tidy and the AI suggestions waiting — 남은 손질과 AI 제안 대기를 셈`
### T3 — 화면
```ts
export interface ProgressPart { key: "assigned" | "deleted" | "moved" | "on_hold" | "unassigned"; count: number }
export function listProgressParts(progress: RowProgress): ProgressPart[]          // moved는 0이면 뺀다
export function getDecidedPercent(progress: RowProgress): number | null           // getConfirmedPercent를 이 이름으로
export function buildAssignProgress(rows: readonly ClassifyRow[], unitMap: ReadonlyMap<number, UnitRow>): { done: number; total: number; figuresDone: number; figuresTotal: number }
export function countWaitingSuggestions(items: readonly AiSuggestion[], statusOfUnit: ReadonlyMap<number, CoverStatus>, documentId: number | null): number   // ai-suggestion-model.ts, HIDDEN_AI_KINDS 제외, documentId가 null이면 묶음 전체
```
`DocDashboard` = `{ total, parts: ProgressPart[], figures: { done; total }, where, targets, aiWaiting }` — `where` · `targets`는 **정한 줄만**(R5), `ai_suggested` 칸은 사라지고 `aiWaiting`. testid: `assign-dash-status-<part>`(합 = 줄 수) · `assign-dash-ai-waiting` · `overview-tidy` · `overview-ai-waiting` · `overview-figures`. 막대 색은 토큰(배정 `--st-ok-fill` · 삭제 `--st-del-fill`(새 토큰, 라이트 · 다크) · 이동 · 보류 `--st-hold-fill` · 안 정함 `--st-none-fill` — 이동도 없으면 `tokens.css`에 더한다).
- [ ] 시험: `progress-model.test.ts` S10 그대로
  ```ts
  const s10 = { total: 503, unassigned: 70, on_hold: 21, confirmed: 412, assigned: 282, deleted: 106, moved: 24, figures_total: 9, figures_decided: 7, single_language: 0 };
  it("S10: 82% decided", () => expect(getDecidedPercent(s10)).toBe(82));
  it("S10: the parts in order", () => expect(listProgressParts(s10).map((p) => [p.key, p.count])).toEqual([["assigned", 282], ["deleted", 106], ["moved", 24], ["on_hold", 21], ["unassigned", 70]]));
  it("leaves moved out when nothing moved", () => expect(listProgressParts({ ...s10, moved: 0 }).some((p) => p.key === "moved")).toBe(false));
  it("the top of Assign counts rows without figures", () => expect(buildAssignProgress(rows, unitMap)).toEqual({ done: 2, total: 3, figuresDone: 1, figuresTotal: 2 }));
  ```
  `doc-dashboard-model.test.ts:22 · 41`: `status` 기대를 `parts`로(문서 1의 줄 넷 → assigned 1 · on_hold 1 · unassigned 2), `where`는 확정 줄만(`{ assigned: 1, delete: 0, move_external: 0, unassigned: 3 }`) · `it("aiWaiting skips decided, retired and hidden kinds", …)`. `ai-suggestion-model.test.ts`: `countWaitingSuggestions` 네 줄
- [ ] (F) `npx vitest run src/lib/progress-model.test.ts src/lib/doc-dashboard-model.test.ts` → 구현: 문구 `overview.decided` en `Decided` / ko `정함`, `progress.part.*` en `Assigned · Deleted · Moved · On hold · Unassigned` / ko `배정 · 삭제 · 이동 · 보류 · 안 정함`, `overview.tidy` en `Left to tidy: references {r} · captions {c}` / ko `남은 손질: 참조 {r} · 캡션 {c}`, `progress.aiWaiting` en `AI suggestions waiting` / ko `AI 제안 대기`, `progress.figures` en `Figures: {m} of {n} decided` / ko `그림 {n}개 중 {m}개 정함`, `gate.unitsFigures` en `{n} rows still open, {f} of them figures` / ko `아직 정하지 않은 줄 {n}개(그림 {f}개)`, `bundles.colConfirmed`(관리 화면 파일은 그대로, 문구만) → `Decided` / `정함`. 도움말 칩(`assign-help.tsx:50`)의 `ai_suggested` 막대 설명을 처분으로
- [ ] (P) + `i18n-messages.test.ts` · 전체 `npx vitest run` → 커밋 `feat(overview): show decided by disposition, tidy and AI counts — 처분별 정함과 손질 · AI 수를 보임`
### 브랜치 끝
- **스모크**(§14가 이름을 댄 F3 `:86 · 477 · 3169`): `assign-progress`의 `{done}/{total}` 꼴을 지키므로 세 곳은 글을 바꾸지 않고 돌려 본다(484 · 2817 · 3175도 같다). `assign.mjs:641-647`(대시보드, F1의 이름으로 승인된 줄)은 새 합(`parts`)으로 같은 수. `shell.mjs:24`는 그대로. 새 단계 하나 `overview: decided bar, tidy and figures line`(S10의 축소판).
- **설명서**: `#bundle` 103행(Coverage), `#assign` 432행(대시보드), `#status`, `#home`. **CHANGELOG**: `개요와 문서 대시보드가 "정함"을 처분(배정 · 삭제 · 보류 · 안 정함)으로 나눠 보이고, 그림은 따로 셉니다. 남은 손질과 AI 제안 대기 수가 보입니다.`
- **세워 둘 조건**: ① 개요 · 목록 · Assign 위쪽 %가 하나라도 다르다(AC2). ② 검토 요청 조건이 그림을 빼고 통과한다. ③ `bundles-panel.tsx`를 고쳐야 한다(문구만으로 안 되면 — `feat/admin-polish`와 겹친다).

## fix/ai-suggestions-retire
- **한 문장:** 편집이 은퇴시킨 Unit의 제안을 거두고, 알약 · 수락 창 · 필터 · 개요가 안 정한 줄의 제안만 센다 (E3-R1~R5, S16, §11-1).
- **Files** — Modify `backend/app/sop/editing.py:2107`(`_write_change`), `app/sop/decision_steps.py:413`(`record_unit_edit_step`), `frontend/src/lib/ai-accept-model.ts:44`, `lib/ai-suggestion-model.ts`, `use-assign-page.tsx:389-393 · 635`, `components/ai-jobs-indicator.tsx:76-80`. Test `tests/test_sop_ai_adoption.py` · `test_sop_ai_accept.py`, `ai-accept-model.test.ts`
- **Interfaces** — Consumes: `countWaitingSuggestions`, `WAITING_KINDS`, `close_unused_suggestions`. Produces: `countLiveOffer`의 새 인자.
### T1 — 편집이 거둔다 (backend)
`_write_change` 끝에서 `change.retire`가 있으면 `close_unused_suggestions(session, bundle_id, unit_ids=change.retire)`를 부른다(종류는 지금 `OFFERED_KINDS` — `split` · `unwrap_order` · `table_follow`는 받는 길이 채택을 나중에 적으므로 **거두지 않는다**). `record_unit_edit_step`은 `before` · `after`에서 `ai_suggestions`를 뺀다 — 되돌려도 되살리지 않는다(R2).
- [ ] 시험:
  ```python
  def test_merging_retires_the_suggestions_of_both(client): assert results() == {"a": "stale", "b": "stale", "c": "applied"}   # E3-T1 · AC2
  def test_undo_does_not_bring_them_back(client): undo(); assert results() == {"a": "stale", "b": "stale", "c": "applied"}    # R2, Assign 되돌리기와 edits/undo 둘 다
  def test_redo_still_works(client): redo(); assert results()["a"] == "stale"
  def test_accept_all_never_touches_a_decided_row(client): assert preview()["items"] == [] and accept()["accepted"] == 0      # R4 · AC3
  ```
  그 밖(같은 단계에서 씀): `test_split_and_order_suggestions_are_left_for_their_own_adoption` · `test_adoption_stats_do_not_count_stale`(applied에서 빠지고 as_is · edited · rejected는 그대로) · `test_unwrapping_retires_the_table_suggestion`
- [ ] (F) `pytest tests/test_sop_ai_adoption.py tests/test_sop_ai_accept.py -q -k "retire or undo or decided"` → `applied` → 구현(import 고리가 생기면 `editing`이 함수 안에서 들여온다 — `decision_steps._move_unit_edit`의 꼴) → (P) + `pytest tests/test_invariants.py tests/test_sop_editing.py tests/test_sop_decision_undo.py -q` → 커밋 `fix(ai): retire suggestions of units an edit replaced — 편집이 바꾼 Unit의 제안을 거둠`
### T2 — 세는 쪽
- [ ] 시험 `ai-accept-model.test.ts`: `it("counts only live suggestions whose rows are open", () => expect(countLiveOffer(items, 1, openUnits)).toEqual({ classify: 0, match: 3 }))`(S16 — 정한 줄 · 은퇴 Unit에 걸린 11개와 `classify`는 빠짐) · `it("drops to zero when every row is decided", () => expect(countLiveOffer(items, 1, new Map())).toEqual({ classify: 0, match: 0 }))`(AC1). 있는 시험(51)은 셋째 인자를 더한다
- [ ] (F) → 구현: `countLiveOffer(items, documentId, statusOfUnit)` = `countWaitingSuggestions`와 같은 거르기(종류별), 필터 칩 AI 수도 같은 목록(`findRowSuggestion`이 이미 안 정한 줄만), 알약은 0이면 지금처럼 숨김 → (P) + 전체 `npx vitest run` → 커밋 `fix(assign): count only suggestions a person can still take — 아직 받을 수 있는 제안만 셈`
### 브랜치 끝
- **스모크**: 새 단계 하나 `assign: merging two suggested boxes drops the AI count and Ctrl+Z does not bring it back`(S16). `#ai-accept` 단계들은 세는 값이 줄 수 있어 돌려 보고, 기대 수를 낮춰야 하면 **세움**.
- **설명서**: `#ai-accept` · `#ai-kinds`. **CHANGELOG**: `AI 제안은 아직 정하지 않은 줄에만 남습니다 — 합치거나 나눈 줄의 제안은 거둬지고(되돌려도 되살아나지 않음), 수락할 제안 수도 그만큼 줄어듭니다.`
- **세워 둘 조건**: ① 운영 DB 행을 바꾸는 이행이 필요하다고 판단된다(R5: 세는 쪽만). ② 채택률 숫자의 뜻이 바뀐다. ③ `test_invariants.py`가 막는다.

## feat/space-preview-trim
- **한 문장:** Space 미리보기는 목차를 접고 그림 자리 · "문단" 글자 · 삭제 줄을 숨기며, 문단 Excel을 받을 때 넣을 것을 묻는다 (F1-R1~R5, S11, 설계 §7 R3 · §11-1).
- **Files** — Create: `frontend/src/components/assign/paragraph-download-dialog.tsx` · `.test.ts` **·** Modify: `backend/app/sop/paragraph_excel.py:111 · 212 · 240`, `app/routers/sop_documents.py:1028-1082`, `app/sop/sheet_model.py:257 · 310`, `app/routers/sop_outputs.py:241`(`/export/preview/a`), `frontend/src/lib/api-sop.ts:1577-1592`, `components/assign/space-preview.tsx:159-175`, `components/assign/doc-dashboard.tsx:104-152`, `lib/sheet-view-model.ts:152`, `lib/i18n-messages.ts:1590-1594 · 3617-3621`, `docs/architecture/api-contract.md:53` **·** Test: `tests/test_sop_paragraph_excel.py:220 · 253 · 269`(명세), `test_sop_excel.py:674 · 696`, `lib/output-location.test.ts:8`(**그대로**), `sheet-view-model.test.ts`
- **Interfaces** — Produces: `ParagraphInclude`(서버 · 화면), 창 testid `space-download-dialog`.
### T1 — 서버 매개변수 넷
```python
@dataclass(frozen=True)
class ParagraphInclude:
    tables: bool = True; deleted: bool = True; figures: bool = True; toc: bool = False
def build_paragraph_sheet(lines: Sequence[UnitLine], include: ParagraphInclude = ParagraphInclude(), name: str = "Sheet", *, preview: bool = False) -> Sheet
```
`deleted=False`면 확정 삭제 줄과 앞부분 · 개정 이력 줄이 빠지고, `toc=False`면 목차 줄이 빠진다. `preview=True`는 그림 줄을 빼고 목차 줄에 `SheetRow.toc`과 `noise = "toc"`을 달아 화면이 한 줄로 접게 하고(`listSheetItems`의 `canFold`를 문단 시트에도), 앞부분 · 개정 이력은 `deleted=True`로(화면이 숨김) 둔다. 경로 셋에 `tables` · `deleted` · `figures` · `toc` 질의(기본값은 위).
- [ ] 시험: `test_default_download_is_today_minus_the_contents`(목차 있는 합성 문서 — 지금 줄 − 목차 줄과 글자까지 같음, AC2) · `test_each_check_changes_the_file`(넷 각각, AC3) · `test_front_matter_follows_the_deleted_check` · `test_old_contents_follow_their_own_check_even_when_deleted_is_off` · `test_preview_hides_figures_and_marks_contents`(`:220` · `test_remark_column_shows_the_decision_reason_and_the_preview_matches_the_file`(269)의 뜻을 새 약속으로) · `test_new_document_paragraphs_take_the_same_checks`
- [ ] (F) `pytest tests/test_sop_paragraph_excel.py -q` → 구현 → (P) + `pytest tests/test_sop_toc.py tests/test_sop_front_matter.py -q` → 커밋 `feat(paragraphs): choose tables, deleted lines, figures and contents — 문단 Excel에 넣을 것 넷을 고름`
### T2 — Excel A 미리보기
`_format_location(location: LocationOut, *, hide: Collection[str] = ())`, `_build_a_sheet(..., preview: bool = False)` — 미리보기면 `labels.paragraph` · `labels.figure` 조각을 뺀다(줄은 남긴다 — 물을 것 3). 파일과 Outputs의 내보내기 미리보기는 지금 그대로(R4).
- [ ] 시험 `test_sop_excel.py`: `test_assign_preview_drops_paragraph_and_figure_places`(`"§1 · Paragraph · p. 2"` → `"§1 · p. 2"`, `"§5 · Figure · p. 3"` → `"§5 · p. 3"`, 표 · 띠 표 자리는 그대로) · `test_export_file_and_outputs_preview_keep_the_place`(`test_sop_outputs.py:783`의 `place == "Paragraph"`는 그대로 통과)
- [ ] (F) → 구현 → (P) → 커밋 `feat(assign): drop the paragraph and figure words in the preview — 미리보기 위치에서 문단 · 그림 글자를 뺌`
### T3 — 창과 접기
```ts
export interface ParagraphInclude { tables: boolean; deleted: boolean; figures: boolean; toc: boolean }
export const DEFAULT_INCLUDE: ParagraphInclude = { tables: true, deleted: true, figures: true, toc: false };
export function downloadParagraphs(bundleId: number, docId: number | null, include: ParagraphInclude): Promise<{ blob: Blob; fileName: string | null }>
export function buildFoldedCells(rows, columnKeys, texts)                    // 문단 Excel(column_keys 없음)은 Text 칸에 한 줄
```
창 `ParagraphDownloadDialog`(`Modal size="sm"`, `Checkbox` 넷 `space-download-<key>`, 확인 `space-download-confirm`). 문구: 제목 en `Download Excel` / ko `Excel 받기`, en `Include tables still as tables` · `Include deleted lines` · `Include figure places` · `Include the old table of contents` / ko `아직 표인 표 포함` · `삭제한 줄 포함` · `그림 자리 포함` · `옛 문서 목차 포함`, 접힌 목차 en `▸ Table of contents · {n} lines` / ko `▸ 목차 {n}줄`, 안내(`sameFile*` 자리) en `The preview folds the table of contents and hides figure places and deleted lines. Choose what to include when you download.` / ko `미리보기는 목차를 접고 그림 자리 · 삭제 줄을 숨깁니다. 받을 때 넣을지 고릅니다.` Space 미리보기(한 단)와 대시보드 둘 다 이 창을 연다 — 대시보드의 "표 포함 · 표 빼고" 두 단추는 창이 대신한다. Excel A 받기(양 단)는 지금 그대로.
- [ ] 시험: `paragraph-download-dialog.test.ts` `it("starts with the contents off and the rest on", () => { const h = html(); expect(h).toContain('data-testid="space-download-tables"'); expect(checked(h)).toEqual(["tables", "deleted", "figures"]); })` · `sheet-view-model.test.ts` `it("folds contents rows of a paragraph sheet into one line", () => expect(listSheetItems(rows).map((i) => i.type)).toEqual(["row", "fold", "row"]))`
- [ ] (F) → 구현(대시보드가 바깥 누름으로 닫힐 때 창이 열려 있으면 닫지 않는다 — `isTopEscLayer`의 지금 규칙) → (P) + 전체 `npx vitest run` → 커밋 `feat(assign): ask what to put in the paragraph Excel — 문단 Excel에 넣을 것을 물음`
### 브랜치 끝
- **스모크**(§14가 이름을 댄 F1 `:641-659 · 2993-3006`): 대시보드 · Space 한 단의 받기를 "누름 → `space-download-dialog` → 확인 → 받기"로 같은 수의 단계로 바꾸고, 문단 미리보기 안내 글 기대(3004)를 새 문구로. 새 단계 하나 `assign: the Excel preview folds contents and hides figures`(S11).
- **설명서**: `#assign` 432행, `#assign-view` 770행, `#outputs-excel`은 그대로. **CHANGELOG**: `Excel 미리보기가 옛 문서 목차를 한 줄로 접고 그림 자리 · 삭제 줄 · "문단" 글자를 뺍니다. 문단 Excel을 받을 때 표 · 삭제 줄 · 그림 자리 · 목차를 넣을지 고릅니다(목차는 처음에 꺼짐).`
- **세워 둘 조건**: ① 기본값으로 받은 파일이 지금 파일에서 목차 줄 말고 다른 것이 바뀐다. ② Outputs 내보내기(xlsx · 미리보기)가 바뀐다.

## fix/excel-a-strike
- **한 문장:** Excel A의 삭제 줄 Old 글에 취소선을 그린다 (설계 §9 · §11의 6번 [회의]).
- **Files** — Modify `backend/app/sop/sheet_model.py:310`(`_build_a_sheet`). Test `tests/test_sop_excel.py`, `frontend/src/lib/sheet-view-model.test.ts`(접힌 줄의 취소선)
- **Interfaces** — Consumes: `SheetCell.strike`(`excel_export.py:124`의 글꼴과 `sheet-view.tsx:46`이 이미 그린다), `A_COLUMN_KEYS`.
- [ ] 시험:
  ```python
  def test_deleted_rows_strike_the_old_text(client):      # 확정 삭제 줄 · 이어진 줄 둘 다, 배정 · 보류 · 삭제를 보류한 줄은 아님
      col = A_COLUMN_KEYS.index("old_text")
      assert [row["cells"][col]["strike"] for row in a_rows] == [False, True, True, False, False]
      assert _load(client, fx.bundle_id)["A Comparison"].cell(4, col + 1).font.strike is True
  def test_front_matter_and_contents_rows_are_struck(client): assert {r["cells"][col]["strike"] for r in noise_rows} == {True}
  def test_other_columns_and_sheets_are_not_struck(client): ...
  ```
  `sheet-view-model.test.ts`: `it("keeps the strike on a folded row", () => expect(buildFoldedCells(rows, keys, texts)[oldTextAt].strike).toBe(true))`
- [ ] (F) `pytest tests/test_sop_excel.py -q -k strike` · `npx vitest run src/lib/sheet-view-model.test.ts` → `False` → 구현: `dest_kind == "delete"`이고 `status in ("confirmed", STATUS_DELETED)`인 줄의 `old_text` 칸만 `strike=True`(흐림은 바꾸지 않는다)
- [ ] (P) + `pytest tests/test_sop_outputs.py tests/test_sop_toc.py tests/test_sop_excel.py -q` → 커밋 `feat(excel): strike the Old text of deleted rows in A — Excel A 삭제 줄의 Old 글에 취소선`
### 브랜치 끝
- **스모크**: 바꿀 것 없음(있는 `outputs: export preview …` 단계를 그대로 돌린다). **설명서** `#outputs-excel` 한 줄. **CHANGELOG**: `Excel A에서 삭제한 줄의 Old 글에 취소선이 그어집니다.`
- **세워 둘 조건**: `openpyxl` 글꼴 조합 때문에 다른 칸의 흐림 · 기울임이 바뀐다.

## 정한 것 (계획을 쓰며 나온 물음의 답)
1. D1 정답 표는 적힌 입력 그대로 만족하는 읽기를 쓴다(본문 번호 위에 그 부모 번호가 있으면 부모 아래). 제목 5 · 본문 5.1 · 5.2 · 표 → 5.3. **장부 "아침에 볼 것"에 적는다.** 표 뒤에 이미 5.1이 있어 번호가 겹치는 것은 이번에 막지 않고 같이 적는다.
2. 합친 글 가운데의 번호 글자는 그대로 둔다(원문 글자는 모두 덮여야 한다). 번호만 당긴다. S17의 합친 글 기대는 그 글자를 포함해 본다 — 장부에 적는다.
3. F1 Excel A 미리보기는 위치의 "Figure" 글자만 뺀다(R > S).
4. F3 "남은 손질"에서 나누기는 세지 않는다(설계 11-1).
5. 숫자 칸은 그 행의 첫 칸만. 칸 안 Word 자동 번호는 매기지 않는다.
6. `unmerge`는 번호를 다시 센다.
7. 임베딩은 켜지 않는다(새 env · 운영 설정 없음). 토큰이 없는 행은 AI 길로 간다.

## Self-review
- 덮기: E2-R1~R5 = 첫 브랜치 T1–T4(R5는 앞 계획의 `part-history`), D1-R1~R7 = 둘째 T1–T5(정답 표 = T1 `ANSWERS` + 되돌리기 두 줄 = T2 · 합치기 줄 = T3, FE · BE 양쪽 = T5), D2-R1~R3 = -1, R4~R8 = -2, R9~R10 = -3, AC1 · AC2 · AC3 · AC4 · AC5 모두 시험 이름이 있다. F3-R1~R7 = 다섯째 T1–T3, E3-R1~R5 = 여섯째, F1-R1~R5 + 앞부분 · 개정 이력 = 일곱째, 취소선 = 여덟째.
- 자료: 더하기만 둘 — `table_counterparts` 새 표(-1), `ai_jobs.kind` CHECK 값(-3). D1 · E2 · F3 · E3 · F1 · 취소선은 스키마 없음. 옛 편집 기록은 `_replay`가 지금대로 읽는다(`continue_numbers` · `follow_table`은 새 `op` 글자일 뿐).
- 초록 유지: 브랜치마다 있는 시험의 따라 바뀌는 줄을 이름으로 적었다(D1 문단 Excel 둘 · 번호 하나, F3 진행 · 대시보드, F1 문단 Excel 셋). 그 밖에 깨지면 세운다.
- 이름: `enqueue` · `ASSIGN_KEYS` · `NewPaper` · `MergeRowsOp` · `SetLayoutTablesOp` · `HIDDEN_AI_KINDS` · `NOISE_FRONT` · `NOISE_HISTORY`는 색인 표 그대로. `WAITING_KINDS` · `FollowTableOp` · `ParagraphInclude` · `continue_numbers`는 이 파일에서 처음 나온다.
