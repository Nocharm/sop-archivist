# Order 다른 칸으로 끌기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order 화면에서 줄 덩어리를 같은 New 문서의 다른 칸(SOP 칸·하위 칸, WI step)으로, 줄이 없는 칸까지 끌어 옮기면 그 줄의 자리(`slot_key`·`wi_step`)가 정말 바뀌고 그 칸의 번호(5.x.x)로 다시 세지게 한다.

**Architecture:** 서버는 지금 순서 저장(`PUT /api/bundles/{id}/targets/order`)에 줄마다 선택 필드 `slot_key`를 더해, 이미 있는 `wi_step` 옮기기와 같은 검사·쓰기를 거친다. 화면은 `c-edit-model`의 `place` 편집에 도착 칸(`toLocationKey`)을 더해 낙관적 초안과 저장 줄을 그대로 쓰고, `c-drop-model`이 포인터 아래 칸·거절 사유·도착 칸의 넣을 자리와 깊이를 정한다. `output-c.tsx`는 프레임마다 DOM만 읽고 쓰며(G11), 놓은 줄을 잠깐 강조한다.

**Tech Stack:** FastAPI · SQLAlchemy(async) · pytest / Next.js 16 · React 19 · TypeScript · vitest(jsdom) · Playwright(`playwright-core` + 시스템 Chrome).

**Spec:** [`docs/superpowers/specs/2026-11-16-drag-and-drop-design.md`](../specs/2026-11-16-drag-and-drop-design.md) — §10의 **1b걸음**만(§5 Order, §8 "Order — `slot_key`", §9의 1b 줄, §4 G1~G13). 실행하는 사람은 명세와 함께 읽는다. 아래 "§N"은 그 문서의 절이다.

## Global Constraints

- **범위**: 같은 New 문서 안의 다른 칸만. 다른 문서는 Assign(표에 `order.drag.otherDoc` 이유, 놓이지 않음). WI는 같은 부분(Instruction↔Instruction, Why↔Why)끼리만, 단계 없는 칸(`unstepped:<part>`)은 `wi_step: null`.
- **단추·글쇠는 그대로**: Move up·down과 `Alt`+`↑`·`↓`는 칸 끝에서 멈춘다(`canMoveTarget` 바꾸지 않는다). 칸을 넘는 것은 끌기만.
- **G1~G13 그대로**: 마지막 move가 유효한 자리를 만들었을 때만 저장, 그린 선과 저장한 편집은 같은 자리, 끄는 프레임마다 React 상태 금지, 저장 길은 `c-edit-model` + `c-save-queue` 하나, 날아가는 저장 중에 놓은 것은 응답 위에 다시 얹고 못 얹으면 조용히 버린다.
- **깊이**: 시작 깊이 + `Math.round(dx / 24)`, 0 ~ "넣을 자리 위의 가장 가까운 번호 줄 깊이 + 1"로 자르고(덩어리의 가장 깊은 줄이 `MAX_INDENT_LEVEL` = 9 안), 덩어리 아래 줄은 단 차이를 지킨다. 줄이 없는 칸은 0. 깊이가 잠긴 덩어리(`isDepthLocked`)는 `baseDepth` 그대로.
- **다른 칸으로 옮긴 줄은 요청에 새 자리와 `indent_level`을 늘 싣는다**(같은 값이어도) — 빼면 서버가 0으로 돌린다. `wi_step: null`은 키를 빼지 않고 null로 보낸다(빼면 "바꾸지 않음").
- **서버 거절 코드**: `slot_not_allowed`(새, 422) · `unknown_slot`(있는 코드) · `na_slot`(새 최상위, 422) · `translation_locked`(있는 코드). 상세 모양은 `{"code": …, "target_ids": [정렬한 id]}`. 검사는 모두 쓰기 전. Alembic 변경 없음.
- **문구(en 그대로 — 설명서 굵은 글자와 같아야 한다)**: `order.drag.otherDoc` "Another document: change it in Assign" · `order.drag.otherPart` "Instruction or Why: change it in Assign" · `order.drag.keepTranslation` "An AI translation moves only with its source: put them side by side first" · `rule.slot_not_allowed` "Only sentences written here for an SOP can change section." · `rule.na_slot` "That section is N/A in the To-Be list." · `order.dragHelp` "Drag a line to move it, also into another section of the same document; drag sideways to indent. Lines from the same meaning move together. Hold Alt to select text." ko: "다른 문서 · 문서는 Assign에서 바꿉니다" · "Instruction·Why · Assign에서 바꿉니다" · "AI 번역 줄은 원문과 함께만 옮깁니다 · 먼저 나란히 두세요" · "여기서 쓴 SOP 문장만 칸을 옮길 수 있습니다." · "To-Be 목록에서 N/A인 칸입니다." · "줄을 끌어 옮기고, 같은 문서의 다른 칸으로도 옮깁니다. 좌우로 끌어 들여 씁니다. 같은 의미의 줄은 함께 갑니다. 글자를 긁으려면 Alt를 누릅니다." `order.drag.otherSection`은 쓰는 곳이 없어지므로 en·ko 둘 다 지운다.
- **프로젝트 규칙**: 화면 규칙은 순수 모델(`lib/*.ts` + vitest), 부품은 얇게. 함수 이름은 동사로, 파일 머리 한 줄 설명, 주석은 "왜"만. raw hex 금지(토큰만). 문구는 en·ko 한 쌍(`i18n-messages.test.ts`). 화면을 바꾸는 커밋은 `frontend/public/manual/user-manual.md` Order 절의 글을 같은 커밋에서(그림은 뽑지 않는다, `manual-content.test.ts`). Python 3.11 문법(`ruff.toml` py311).
- **읽고 시작**: `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `docs/lessons/react-ts-patterns.md`(§6·§7·§10), `docs/lessons/browser-verification.md`, `docs/lessons/ui-review.md`, `docs/qa/verification-commands.md`.
- **커밋**: `type(scope): English summary — 한국어 요약`, 커밋마다 `PROGRESS.md` 한 항목을 같은 커밋에, `git add <파일>`로만. 서비스 버전(PATCH)·`CHANGELOG.md`는 이 계획에서 건드리지 않는다 — 머지 때 컨트롤러가 한다. 푸시는 사용자가 말할 때 GitHub `origin`에만.
- **커밋 전 게이트(`frontend/`)**: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`. `npm run build`는 경고 0(먼저 `next dev`를 내린다). backend: `$PY -m pytest tests/ -q -n auto` · `$VENV/ruff check app/ tests/`.

**시작 전에(워크트리 `sop-archivist-dnd`, 브랜치 `feat/order-cross-section`에 한 번)** — 워크트리에는 `node_modules`와 `backend/.venv`가 없다. backend는 원본 체크아웃의 venv를 절대 경로로 쓴다(링크를 만들지 않는다). PowerShell 표기는 `docs/qa/verification-commands.md`의 같은 줄을 따른다.

```bash
VENV=<original-checkout>/backend/.venv/bin
PY=$VENV/python
cd frontend && npm ci && npm i --no-save playwright-core
npx vitest run src/lib/c-edit-model.test.ts src/lib/c-drop-model.test.ts   # 손대기 전 초록
cd ../backend && $PY -m pytest tests/test_sop_outputs.py -q -k reorder        # 손대기 전 초록
```

- [ ] 명세 고침·이 계획을 먼저 커밋한다. `docs/README.md`의 명세 줄 아래에 이 계획 한 줄을 더하고 `PROGRESS.md`에 한 항목.

```bash
git add docs/superpowers/specs/2026-11-16-drag-and-drop-design.md docs/superpowers/plans/2026-11-16-order-cross-section-plan.md docs/README.md PROGRESS.md
git commit -m "docs(dnd): plan step 1b, dragging Order lines into another section — Order 다른 칸으로 끌기 1b걸음 계획"
```

**브라우저 검증 스택(스모크를 돌리는 Task마다)** — 원본의 `dev.db`·3777/8777과 섞이지 않게 sqlite 파일과 포트를 따로(`browser-verification.md` 함정 1·2·9). Order 장면은 DB를 바꾼다 — 거짓 실패가 나면 backend를 **내린 뒤** `reset_db → seed_sop_demo`를 다시 하고 띄운다. 업로드 장면은 `BACKEND_PYTHON`으로 원본 venv python을 쓴다.

```bash
# backend/ 에서 (시드는 DEV_ENFORCE_PERMISSIONS 없이)
DATABASE_URL=sqlite+aiosqlite:///./xsec-smoke.db AUTH_MODE=dev $PY -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./xsec-smoke.db AUTH_MODE=dev $PY -m scripts.seed_sop_demo
DATABASE_URL=sqlite+aiosqlite:///./xsec-smoke.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $VENV/uvicorn app.main:app --port 8787
# frontend/ 에서
BACKEND_URL=http://localhost:8787 npx next dev -p 3787
BACKEND_PYTHON=$PY QUIET=1 ONLY="order:" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs   # 마지막 줄에 실패 0
```

## Review Focus

명세가 뜻하지만 쓰는 사람이 가장 먼저 밟을 다섯. 줄마다 시험을 맡은 Task.

1. **도착 칸의 깊이가 원래 저장값과 우연히 같은 줄** — 화면이 "바뀐 깊이만 보낸다"를 그대로 따르면 서버가 자리 바뀐 줄을 0으로 돌려 놓은 깊이가 저장 뒤 사라진다. → Task 2 `sends the new place and the depth of every line that changed section, even an unchanged depth`, Task 1 `test_reorder_slot_move_takes_the_table_cells_and_resets_an_unsent_depth`.
2. **표를 다른 칸으로** — 칸 새 문장이 옛 칸에 남으면 C가 표를 둘로 찢는다. → Task 1 같은 시험(칸 새 문장의 `slot_key`·revision).
3. **상위 칸이 N/A인 하위 칸**(예: 7 N/A일 때 7.1) — 칸 머리는 그려지고 N/A 사유가 보이지만 서버가 같은 규칙으로 막아야 한다. → Task 1 `test_reorder_slot_move_rejects`의 `na_parent`, Task 3 `refuses an N/A section`.
4. **WI 단계 없는 칸으로** — `wi_step`을 빼면 "바꾸지 않음"이라 줄이 제자리로 돌아온다. → Task 2 `sends wi_step null, not a missing key, for the unstepped section`.
5. **원문만 끌어 다른 칸으로** — 칸 안에 떨어져 있던 AI 번역 제안이 서버에서 조용히 지워진다. → Task 3 `refuses a block that leaves an AI translation of its meaning behind`(서버 쓸기 동작은 Task 1의 번역 시험이 고정).

---

### Task 1: 서버 — 순서 저장의 `slot_key`

**Files:**
- Modify: `backend/app/routers/sop_outputs.py:60-83` (`OrderItemIn`, `OrderItemOut`), `:236-276` (`_check_indents` docstring), `:296-383` (`reorder_targets`)
- Test: `backend/tests/test_sop_outputs.py` (C 순서 바꾸기 절), `backend/tests/test_sop_ai_translate.py` (step 옮기기 시험 옆)

**Interfaces:**
- Consumes: `SLOT_KEYS` (`app/sop/constants.py`), `is_within_slot(slot_key, slot) -> bool` (`app/sop/tobe.py`), `TargetDocNaSlot`, `load_source_target_ids`, `sweep_translations`, `ORIGIN_NEW_DOC`·`ORIGIN_TRANSLATION`.
- Produces (요청·응답 계약 — Task 2가 쓴다):
  - `OrderItemIn.slot_key: str | None = Field(default=None, max_length=100)` — `model_fields_set`에 있고 지금 값과 다를 때만 바꾼다.
  - `OrderItemOut.slot_key: str | None`
  - `async def _check_translation_moves(session: AsyncSession, tops: dict[int, TargetSentence], moves: Mapping[int, object]) -> list[int]` — moves 안의 번역 id(쓸기 `exempt`용)를 돌려주고, 원문이 같은 값으로 함께 옮기지 않는 번역이 있으면 422 `translation_locked`. 지금 `wi_step` 갈래의 검사를 옮겨 두 갈래가 쓴다.
  - `async def _check_slot_moves(session: AsyncSession, doc: TargetDoc, tops: dict[int, TargetSentence], items: list[OrderItemIn]) -> dict[int, str]` — 검사 순서 (1) `doc.doc_type != "sop" or doc.entrance == "match" or origin == ORIGIN_NEW_DOC` → `slot_not_allowed` (2) `SLOT_KEYS`에 없음(null 포함) → `unknown_slot` (3) 그 문서 N/A 칸 `is_within_slot` → `na_slot`. N/A 질의는 옮길 줄이 있을 때만.
  - `_check_indents(..., moved_ids)`에 `moves.keys() | slot_moves.keys()`를 넘긴다. 쓰기: 옮긴 줄마다(step·칸 어느 쪽이든 한 번) 줄과 `cells`의 `wi_step`/`slot_key`를 바꾸고 `revision += 1`, `sweep_translations(..., exempt=두 갈래의 번역 id 합)`.

- [ ] **Step 1: 실패하는 시험** — `test_sop_outputs.py`에 도우미 `_load_places(target_doc_id: int) -> dict[int, tuple[str | None, int, int]]`(id → `(slot_key, indent_level, revision)`, 칸 새 문장 포함)와 `_items_in(doc: dict, key: str) -> list[dict]`(C 문서의 그 `location_key` 칸 items)를 더하고:

```python
def test_reorder_moves_a_line_to_another_slot(client: TestClient) -> None:
    fx = _setup(client)
    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]
    (duplicate,) = _items_in(sop, "responsibilities")
    items = [{"target_id": t} for t in _list_top_target_ids(client, fx.bundle_id, 0)]
    moved = [{**i, "slot_key": "procedures.procedure", "indent_level": 0} if i["target_id"] == duplicate["target_id"] else i for i in items]
    before = _load_places(fx.sop_id)[duplicate["target_id"]]
    response = _put_order(client, fx.bundle_id, {"revision": get_bundle(client, fx.bundle_id)["revision"], "target_doc_id": fx.sop_id, "items": moved})
    assert response.status_code == 200, response.text
    out = next(i for i in response.json()["items"] if i["target_id"] == duplicate["target_id"])
    assert out["slot_key"] == "procedures.procedure"
    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]
    assert _items_in(sop, "responsibilities") == []
    # 칸 번호는 SLOT_KEYS 고정 자리 — procedures = 6, procedures.procedure = 6.1
    assert [(i["target_id"], i["number"]) for i in _items_in(sop, "procedures.procedure")] == [(duplicate["target_id"], "6.1.1")]
    assert _load_places(fx.sop_id)[duplicate["target_id"]] == ("procedures.procedure", 0, before[2] + 1)
    assert response.json()["doc"] == sop

def test_reorder_slot_move_takes_the_table_cells_and_resets_an_unsent_depth(client: TestClient) -> None:
    # 1) operation 칸 마지막 줄에 indent_level 1을 먼저 저장 2) 한 요청에서 그 줄을 "purpose"로(깊이 없이), 표를 "definitions"로(indent_level 2)
    ...
    assert places[line_id][:2] == ("purpose", 0)          # 보내지 않은 깊이는 0
    assert places[table_id][:2] == ("definitions", 2)     # 보낸 깊이는 그 값
    assert {places[c][0] for c in cell_ids} == {"definitions"}
    assert all(places[c][2] == cells_before[c][2] + 1 for c in cell_ids)

def test_reorder_slot_move_rejects(client: TestClient) -> None:
    # 거절마다 detail == {"code": code, "target_ids": [첫 줄 id]}, 그 뒤 묶음 revision·_load_places 그대로
    cases = {
        "unknown": (sop_body, "nope", "unknown_slot"), "null": (sop_body, None, "unknown_slot"),
        "na": (sop_body, "scope", "na_slot"), "na_parent": (sop_body, "document_relationships.appendices", "na_slot"),
        "wi": (wi_body, "purpose", "slot_not_allowed"), "written": (match_body, "purpose", "slot_not_allowed"),
    }

def test_reorder_same_slot_keeps_depth_and_revision(client: TestClient) -> None:
    # 지금 칸을 그대로 slot_key로 보내면 옮김이 아니다 — indent_level(먼저 1로 저장)·줄 revision이 그대로
    assert _load_places(fx.sop_id)[line_id] == (slot, 1, revision_before)
```

`test_sop_ai_translate.py`에 `make_sop_translation(client, ai) -> tuple[AiBundle, dict, dict, TargetSentence]`(`make_assigned_unit` + `get_target` + `translate`, 칸 `SLOT` = "purpose")와 `NEW_SLOT = "definitions"`를 더하고, 이미 있는 step 시험 넷을 칸으로 옮긴 넷:

```python
def test_order_moves_a_translation_with_its_source_to_another_slot(...):   # 둘 다 NEW_SLOT → 200, kept.status == "ai_suggested", kept.slot_key == NEW_SLOT
def test_order_refuses_moving_a_translation_to_another_slot_alone(...):    # 번역만 → 422 translation_locked, target_ids == [target.id], 번역 slot_key == SLOT
def test_moving_the_source_to_another_slot_removes_an_ai_translation(...): # 원문만 → 200, assert_swept(...)
def test_moving_the_source_to_another_slot_holds_a_confirmed_translation(...):  # save_translation 뒤 원문만 → assert_held(...), load_translation(...).slot_key == NEW_SLOT
```

- [ ] **Step 2: 실패 확인** — Run(`backend/`): `$PY -m pytest tests/test_sop_outputs.py tests/test_sop_ai_translate.py -q -k "slot"` · Expected: FAIL(`slot_key`가 무시되어 칸이 그대로, 거절이 200).
- [ ] **Step 3: 구현** — Interfaces대로. `_check_slot_moves`는 `wi_step` 검사들 다음, `_check_indents` 전에 부른다(모든 검사가 쓰기 전). `_check_indents` docstring의 "다른 단계로 옮기는 줄"을 "다른 단계·칸으로"로. `reorder_targets` docstring에 칸을 더한다.
- [ ] **Step 4: 통과 확인** — Run: `$PY -m pytest tests/test_sop_outputs.py tests/test_sop_ai_translate.py -q` 그리고 `$PY -m pytest tests/ -q -n auto` · `$VENV/ruff check app/ tests/` · Expected: 모두 PASS, ruff 0.
- [ ] **Step 5: 커밋** — `PROGRESS.md` 한 항목(새 코드 둘, 쓰기는 step 옮기기와 같음).

```bash
git add backend/app/routers/sop_outputs.py backend/tests/test_sop_outputs.py backend/tests/test_sop_ai_translate.py PROGRESS.md
git commit -m "feat(order): move a line to another SOP slot in the order save — 순서 저장에서 SOP 줄을 다른 칸으로"
```

---

### Task 2: 화면 모델 — API 타입과 칸을 넘는 `place`

**Files:**
- Modify: `frontend/src/lib/api-sop.ts:1223-1240` (`TargetOrderItem`, `TargetOrderItemOut`), `frontend/src/lib/c-edit-model.ts` (`PlaceEdit`, `previewEdit`, `sendDraft`, 새 `readLocationPlace`)
- Test: `frontend/src/lib/c-edit-model.test.ts`

**Interfaces:**
- Consumes: Task 1의 요청 필드 `slot_key`(WI는 이미 있는 `wi_step`), 응답 `slot_key`.
- Produces:
  - `TargetOrderItem` += `slot_key?: string`; `TargetOrderItemOut` += `slot_key: string | null`.
  - `export type PlaceEdit = { kind: "place"; locationKey: string; toLocationKey?: string; targetIds: readonly number[]; beforeId: number | null; depths: readonly number[] | null }` — `locationKey`는 덩어리가 지금 있는 칸, `toLocationKey`(없거나 같으면 칸 안)는 도착 칸, `beforeId`는 도착 칸의 줄. 칸 안 편집은 지금과 바이트까지 같은 결과.
  - `export type LocationPlace = { slot_key: string } | { wi_step: number | null; wi_part: string }`
  - `export function readLocationPlace(locationKey: string): LocationPlace | null` — `step:<n>:<part>` → `{wi_step: n, wi_part}`, `unstepped:<part>` → `{wi_step: null, wi_part}`, `path:…` → null, 그 밖은 `{slot_key: locationKey}`.
  - `previewEdit`의 칸을 넘는 `place`는 null일 때: 도착 칸 없음, 도착 칸 `na_reason !== null`, 어느 쪽 `readLocationPlace`가 null, 둘의 종류가 다름, WI `wi_part`가 다름, `beforeId`가 도착 칸에 없음, 덩어리 줄이 출발 칸에 다 있지 않음(겹침·빈 묶음·depths 길이 검사는 칸 안과 같다).
  - `sendDraft`: 저장 문서(saved)와 칸이 다른 줄에는 `slot_key` 또는 `wi_step`(null도 키로)과 `indent_level`을 늘 싣는다.

- [ ] **Step 1: 실패하는 시험** — `describe("addEdit place across sections")`. 문서 `sop`: `procedures`[1(6.1), 2(6.2)] · `procedures.procedure`[3(6.1.1)] · `procedures.electronic_record_control`[] · `procedures.troubleshooting`[] (`na_reason: "N/A"`), 칸 번호는 6 · 6.1 · 6.2 · 6.3(서버 `SLOT_NUMBERS`와 같은 값). `cross(ids, to, beforeId, depths = null)`는 `locationKey: "procedures"`인 `place`.

```ts
it("moves a block into another section before a line and renumbers both", () => {
  expect(numbersOf(addEdit(sop, cross([2], "procedures.procedure", 3))!.shown)).toEqual([[[1, "6.1"]], [[2, "6.1.1"], [3, "6.1.2"]], [], []]);
});
it("makes the block the first lines of an empty section", () => {
  expect(numbersOf(addEdit(sop, cross([1, 2], "procedures.electronic_record_control", null))!.shown)).toEqual([[], [[3, "6.1.1"]], [[1, "6.2.1"], [2, "6.2.2"]], []]);
});
it("refuses an N/A section, a missing section, a beforeId outside the destination and a WI part change", () => {
  expect(addEdit(sop, cross([1], "procedures.troubleshooting", null))).toBeNull();
  expect(addEdit(sop, cross([1], "nowhere", null))).toBeNull();
  expect(addEdit(sop, cross([1], "procedures.procedure", 2))).toBeNull();
  expect(addEdit(wi, { kind: "place", locationKey: "step:1:instruction", toLocationKey: "step:2:why", targetIds: [1], beforeId: null, depths: null })).toBeNull();
});
it("keeps an in-section place the same with or without toLocationKey", () => {
  expect(addEdit(start, { ...place([3, 4], 1), toLocationKey: "s5" })!.shown).toEqual(addEdit(start, place([3, 4], 1))!.shown);
  expect(sendDraft(addEdit(start, { ...place([3, 4], 1), toLocationKey: "s5" })!).items).toEqual(sendDraft(addEdit(start, place([3, 4], 1))!).items);
});
it("sends the new place and the depth of every line that changed section, even an unchanged depth", () => {
  expect(sendDraft(addEdit(sop, cross([2], "procedures.procedure", null))!).items).toEqual([
    { target_id: 1 }, { target_id: 3 }, { target_id: 2, slot_key: "procedures.procedure", indent_level: 0 },
  ]);
});
it("sends wi_step null, not a missing key, for the unstepped section", () => {
  const item = sendDraft(addEdit(wi, toUnstepped)!).items.find((i) => i.target_id === 1)!;
  expect(item).toHaveProperty("wi_step", null);
  expect(sendDraft(addEdit(wi, toStep2)!).items.find((i) => i.target_id === 1)).toEqual({ target_id: 1, wi_step: 2, indent_level: 0 });
});
it("re-applies a cross-section place over the server answer and drops it quietly when the destination became N/A", () => {
  // 앞 편집을 보낸 뒤 cross를 얹고 acceptSaved(서버 문서) → shown에 cross가 남는다. 서버 문서에서 도착 칸이 N/A면 edits == []
});
it("reads the place of a section key", () => {
  expect(readLocationPlace("purpose")).toEqual({ slot_key: "purpose" });
  expect(readLocationPlace("step:3:why")).toEqual({ wi_step: 3, wi_part: "why" });
  expect(readLocationPlace("unstepped:instruction")).toEqual({ wi_step: null, wi_part: "instruction" });
  expect(readLocationPlace("path:1. A")).toBeNull();
});
```

(`wi`는 `doc_type: "wi"` 문서 `step:1:instruction`[1] · `step:2:instruction`[] · `step:2:why`[] · `unstepped:instruction`[2], 칸 번호 1 · 2 · 2 · null. `toStep2`·`toUnstepped`는 줄 1을 `step:1:instruction`에서 `step:2:instruction`·`unstepped:instruction` 끝(`beforeId: null`)으로 옮기는 `place`.)

- [ ] **Step 2: 실패 확인** — Run(`frontend/`): `npx vitest run src/lib/c-edit-model.test.ts` · Expected: FAIL(`readLocationPlace` 없음, 칸을 넘는 place가 null).
- [ ] **Step 3: 구현** — Interfaces대로. 칸 안 갈래는 손대지 않고 `toLocationKey`가 있고 다를 때만 새 갈래로. 결과는 `numberDoc`으로 센다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/lib/c-edit-model.test.ts && npx tsc --noEmit -p tsconfig.json` · Expected: PASS, 오류 0(있던 시험도 그대로 초록 — 칸 안 호환).
- [ ] **Step 5: 커밋** — `feat(order): let a place edit carry lines into another section — place 편집이 줄을 다른 칸으로 나르게` (`PROGRESS.md` 포함)

---

### Task 3: 놓기 모델 — 포인터 아래 칸, 거절 사유, 도착 칸의 자리와 깊이

**Files:**
- Modify: `frontend/src/lib/c-drop-model.ts` (`classifyDropZone`·`DropZone`을 지우고 아래로 바꾼다, `listDropRows`, 새 `planCrossDrop`·`findLeaveRefusal`·`findEnterRefusal`)
- Test: `frontend/src/lib/c-drop-model.test.ts` (`describe("classifyDropZone")`를 `findDropSection`으로 옮겨 쓴다)

**Interfaces:**
- Consumes: Task 2의 `PlaceEdit`(`toLocationKey`), `readLocationPlace`, `previewEdit`.
- Produces:
  - `export type Band = { top: number; bottom: number }`
  - `export function findDropSection(point: { x: number; y: number }, sheet: { left: number; right: number; top: number; bottom: number }, bands: readonly Band[], homeIndex: number): number | null` — 용지 밖·첫 띠 위·마지막 띠 아래는 null. 출발 칸 띠(위 `SECTION_SLACK_TOP_PX` 10·아래 `SECTION_SLACK_BOTTOM_PX` 28 여유)가 먼저, 그 밖에서 여유 띠가 겹치면 뒤(아래) 칸.
  - `export function listDropRows(items: readonly OutputCItem[], block: DragBlock | null, measured: readonly RowBox[]): RowBox[]` — null = 도착 칸(덩어리 줄 없음).
  - `export type CrossRefusal = "na" | "otherPart" | "written" | "translation"`
  - `export function findEnterRefusal(fromKey: string, to: { location_key: string; na_reason: string | null }): "na" | "otherPart" | null` — `na_reason !== null` → na, `readLocationPlace` 종류 다름·WI 부분 다름·null → otherPart.
  - `export function findLeaveRefusal(entrance: string, items: readonly OutputCItem[], block: DragBlock): "written" | "translation" | null` — `entrance === "match"` → written. translation: 덩어리 줄 가운데 `origin === "translation"`이고 `meaning_key === null`인 줄이 있거나, 칸에 번역 줄이 있는 의미 키 K가 덩어리에 있을 때 칸의 K 줄이 모두 덩어리 안에 있지 않거나 덩어리에 K의 번역 아닌 줄이 없으면.
  - `export function planCrossDrop(input: { fromKey: string; toKey: string; source: { items: readonly OutputCItem[]; depths: readonly number[]; block: DragBlock }; dest: { items: readonly OutputCItem[]; depths: readonly number[] }; rows: readonly RowBox[]; pointerY: number; dx: number; emptyTop: number }): DropPlan` — `edit`은 늘 있다(`{ kind: "place", locationKey: fromKey, toLocationKey: toKey, targetIds, beforeId, depths }`, 깊이가 그대로면 `depths: null`). 넣을 자리는 `findInsertIndex`(의미 묶음 가장자리로 붙이기)를 같이 쓰고, 깊이 자르기는 `planDrop`과 한 도우미를 같이 쓴다(위 줄에서 덩어리를 건너뛸 일만 없다). `rows`가 비면 `lineY = emptyTop`.

- [ ] **Step 1: 실패하는 시험**

```ts
describe("findDropSection", () => {
  const sheet = { left: 0, right: 800, top: 0, bottom: 2000 };
  const bands = [{ top: 100, bottom: 200 }, { top: 260, bottom: 300 }, { top: 320, bottom: 500 }];
  it("keeps the home band first and gives an overlap of two other bands to the lower one", () => {
    expect(findDropSection({ x: 50, y: 220 }, sheet, bands, 0)).toBe(0);
    expect(findDropSection({ x: 50, y: 305 }, sheet, bands, 0)).toBe(1);
    expect(findDropSection({ x: 50, y: 315 }, sheet, bands, 0)).toBe(2);
    expect(findDropSection({ x: 50, y: 325 }, sheet, bands, 1)).toBe(1);
  });
  it("is outside off the sheet, above the first band and below the last one", () => {
    expect(findDropSection({ x: 900, y: 150 }, sheet, bands, 0)).toBeNull();
    expect(findDropSection({ x: 50, y: 80 }, sheet, bands, 0)).toBeNull();
    expect(findDropSection({ x: 50, y: 530 }, sheet, bands, 0)).toBeNull();
  });
});
describe("cross-section refusals", () => {
  it("refuses an N/A section and another WI part, and lets the same part of another step in", () => {
    expect(findEnterRefusal("purpose", { location_key: "document_relationships.attachments", na_reason: "x" })).toBe("na");
    expect(findEnterRefusal("step:1:instruction", { location_key: "step:2:why", na_reason: null })).toBe("otherPart");
    expect(findEnterRefusal("step:1:instruction", { location_key: "unstepped:instruction", na_reason: null })).toBeNull();
  });
  it("refuses a written document's block", () => {
    expect(findLeaveRefusal("match", [line(1)], { start: 0, end: 0, baseDepth: 0, isDepthLocked: true })).toBe("written");
  });
  it("refuses a block that leaves an AI translation of its meaning behind", () => {
    const items = [line(1, { meaning_key: "old:a" }), line(2, { meaning_key: "old:a", origin: "translation" })];
    expect(findLeaveRefusal("assign", items, { start: 0, end: 0, baseDepth: 0, isDepthLocked: false })).toBe("translation");
    expect(findLeaveRefusal("assign", items, { start: 1, end: 1, baseDepth: 0, isDepthLocked: true })).toBe("translation");
    expect(findLeaveRefusal("assign", items, { start: 0, end: 1, baseDepth: 0, isDepthLocked: true })).toBeNull();
    const apart = [...items, line(3), line(4, { meaning_key: "old:a" })];
    expect(findLeaveRefusal("assign", apart, { start: 0, end: 1, baseDepth: 0, isDepthLocked: true })).toBe("translation");
    expect(findLeaveRefusal("assign", [line(5, { origin: "translation" })], { start: 0, end: 0, baseDepth: 0, isDepthLocked: true })).toBe("translation");
  });
});
describe("planCrossDrop", () => {
  const empty = { fromKey: "s5", toKey: "s6", source: { items: [line(1)], depths: [0], block: { start: 0, end: 0, baseDepth: 0, isDepthLocked: false } }, dest: { items: [], depths: [] }, rows: [], pointerY: 50, dx: 0, emptyTop: 40 };
  it("makes the block the first lines of an empty section at depth 0 whatever the sideways move", () => {
    const plan = planCrossDrop({ ...empty, dx: 96 });
    expect(plan).toMatchObject({ beforeId: null, depth: 0, lineY: empty.emptyTop });
    expect(plan.edit).toEqual({ kind: "place", locationKey: "s5", toLocationKey: "s6", targetIds: [1], beforeId: null, depths: null });
  });
  it("limits depth to the numbered line above plus one and keeps the block's offsets", () => {
    // dest [x d0, y d1], 덩어리 깊이 [1, 2](base 1): y 아래 dx +48 → depth 2, depths [2, 3]. x 위(앞줄 없음) dx +48 → depth 0, depths [0, 1]
  });
  it("keeps a locked block's depth and always returns an edit", () => {
    // isDepthLocked, baseDepth 2 → depth 2, edit.depths null, edit !== null
  });
  it("snaps to the edge of a meaning group in the destination", () => {
    // dest [p old:k, q old:k]: q의 위쪽 절반 → 묶음 중간선 아래면 beforeId null, 위면 p
  });
  it("agrees with previewEdit on the number the first line gets", () => {
    // SOP 문서 procedures 6[1,2] · procedures.procedure 6.1[3]: 2를 3 앞으로 → previewEdit(doc, plan.edit!)에서 2의 번호 "6.1.1"
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/lib/c-drop-model.test.ts` · Expected: FAIL(새 함수 없음).
- [ ] **Step 3: 구현** — Interfaces대로. `planDrop`의 결과는 바꾸지 않는다(있던 `planDrop` 시험 그대로 초록).
- [ ] **Step 4: 초록 지키기** — `output-c.tsx`의 `classifyDropZone` 쓰임을 `findDropSection`으로 바꾼다(띠는 그려진 `section`마다, 결과가 출발 칸이 아니면 지금처럼 `order.drag.otherSection` 거절 — 동작은 그대로, Task 4가 바꾼다). Run: `npx vitest run src/lib/c-drop-model.test.ts src/lib/c-edit-model.test.ts && npx tsc --noEmit -p tsconfig.json && npm run lint` · Expected: PASS, 오류 0.
- [ ] **Step 5: 커밋** — `feat(order): find the section under the pointer and plan a drop into it — 포인터 아래 칸과 그 칸의 놓을 자리 정하기` (`c-drop-model.ts`, 그 시험, `output-c.tsx`, `PROGRESS.md`)

---

### Task 4: Order 화면 — 다른 칸에 놓기, 빈 칸, 표 문구, 놓은 줄 강조, 설명서, 스모크

**Files:**
- Modify: `frontend/src/components/outputs/output-c.tsx` (`DragSource`, `DragFrame`, `PendingMove`, `planAt`, `drawDropLine`, `readSectionShape`, `dragConfig`, 칸·빈 칸·용지 마크업)
- Modify: `frontend/src/components/ui/motion.tsx` (+ `flashElement`), `frontend/src/app/bundles/[id]/assign/page.tsx:262-267` (지역 `flashElement`를 지우고 가져온다 — 두 번째 쓰임이라 옮긴다)
- Modify: `frontend/src/styles/components.css:1702-1703` (흐리게 규칙), `[data-flash]` 근처(움직임 줄이기)
- Modify: `frontend/src/lib/i18n-messages.ts` (en·ko), `frontend/public/manual/user-manual.md:576-577`
- Test: `frontend/scripts/pw-smoke-sop.mjs` (`order:` 장면)

**Interfaces:**
- Consumes: Task 2 `PlaceEdit`·`previewEdit`·`readLocationPlace`, Task 3 `findDropSection`·`listDropRows`·`planCrossDrop`·`findEnterRefusal`·`findLeaveRefusal`·`CrossRefusal`.
- Produces(DOM 계약 — 스모크와 CSS가 읽는다):
  - `<article data-doc-id={doc.target_doc_id}>` · `<section data-location-key={key} data-na={na ? "" : undefined}>` · 빈 칸 `<p data-testid="output-c-empty-<docId>-<key>">–</p>`.
  - 끄는 동안 출발 용지 `data-drag-sheet`, 덩어리가 떠날 수 없으면 그 용지에 `data-drag-locked`(onStart에 붙이고 onEnd에 뗀다). 올린 다른 칸은 `DragHover.target`으로 넘겨 `data-drop="over" | "refused"`.
  - CSS: `html[data-box-drag] .c-order section:not([data-drag-home])` 규칙을 셋으로 — `section[data-na]`, `article:not([data-drag-sheet])`, `[data-drag-locked] section:not([data-drag-home])`만 `opacity: .35`.
  - `export function flashElement(el: HTMLElement): void` (`motion.tsx`, 지금 assign 화면의 것 그대로: `data-flash`를 다시 붙이고 1300ms 뒤 뗀다). `@media (prefers-reduced-motion: reduce) { [data-flash] { animation: none; outline: 2px solid var(--accent); outline-offset: 2px; } }`.
  - `PendingMove` += `flashIds: readonly number[] | null` — 칸을 넘는 놓기에서만 `edit.targetIds`, 커밋 뒤 그 줄마다 `flashElement`.
  - `DragFrame` += `toKey: string | null`; 칸 모양은 `readDropShape(live: LiveDrag, dest: Section | null): string`(출발 칸 + 도착 칸)으로 바꿔 놓을 때 다르면 그 자리에서 다시 센다(지금 규칙).
  - 거절 → 표 문구: na `rule.na_slot` · written `doc_type === "wi" ? rule.wi_step_not_allowed : rule.slot_not_allowed` · translation `order.drag.keepTranslation` · otherPart `order.drag.otherPart` · 다른 용지 위 `order.drag.otherDoc`.
  - 칸을 넘는 표 note: 도착 칸의 미리 센 번호 `→ 5.1.3`(깊이 낱말 없음), 번호가 null이면 `→ <section.label>`. 빈 칸·아직 그리지 않은 칸의 `emptyTop`은 빈 칸 `<p>`의 top, 없으면 칸 머리 `h3` bottom + 1.

- [ ] **Step 1: 실패하는 스모크** — 있던 장면 "order: drag a line to reorder and indent"의 12번(다른 칸 거절)을 **N/A 칸 거절**로 바꾼다: 같은 문서의 `section[data-na]` 위로 → `data-refused`, 표 글에 "That section is N/A in the To-Be list.", 선 숨김, 그 칸 opacity < 1, 떼면 PUT 0·순서 그대로. 새 장면(`findOrderDocs`·`waitOrderSave`·`pointIn` 도우미를 같이 쓴다):
  - `"order: drag a block into another section, a sub-slot and an empty section"` — (1) SOP 문서에서 줄이 있는 칸 A의 덩어리를 키에 "."가 든 하위 칸 B의 첫 줄 아래로: 표 note가 `→ <B 번호>.`로 시작하고, B 위를 20번 움직이는 동안 `window.__commits` 그대로(G11), 떼면 PUT 하나 200, 그 줄의 `closest("section").dataset.locationKey === B`, 번호가 표 note와 같고, 놓은 직후 그 줄에 `data-flash`. (2) N/A가 아닌 빈 칸 E(`[data-testid^="output-c-empty-"]`) 위로: 표 note `→ <E 번호>.1`, 떼고 PUT 200, `page.reload()` 뒤 그 줄이 E에 있고 번호 `<E 번호>.1`. (3) 다른 칸 위에서 `Esc` → PUT 0, 끌기 표시 0, 줄 그대로. (4) B 첫 줄의 Move up이 꺼져 있고, 그 줄을 고르고 `Alt+ArrowUp` → PUT 0(칸 끝에서 멈춤).
  - `"order: drag a WI line to another step"` — 입구 1 WI에서 `step:N:instruction`의 줄을 다른 선언 step `step:M:instruction`으로: PUT 본문의 그 줄이 `wi_step: M`과 `indent_level`을 지니고, 다시 읽어도 M 칸에 있다. 지나는 길의 `step:M:why` 위에서는 `data-refused`와 "Instruction or Why: change it in Assign".
  - `"order: a written document's block cannot leave its section"` — 칸이 둘 이상인 이미 쓴 문서에서 다른 칸 위로 → `data-refused`, 표 글이 `rule.slot_not_allowed`(SOP)·`rule.wi_step_not_allowed`(WI) 문구, 그 용지의 다른 칸 opacity < 1, 떼면 PUT 0.
  - `"order: a drop into another section while a save is in flight is re-applied after it"` (`allowConsoleErrors` 아님) — PUT을 1.5초 늦추는 `page.route`, 어떤 줄의 Move down을 누른 뒤(첫 저장 날아가는 중) 다른 줄을 다른 칸에 놓는다 → 두 PUT이 차례로(둘째 요청은 첫 응답 뒤에 시작), 둘 다 200, `page.reload()` 뒤 두 바뀜이 모두 남는다.
- [ ] **Step 2: 실패 확인** — Run(검증 스택): `BACKEND_PYTHON=$PY QUIET=1 ONLY="order:" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs` · Expected: 새 장면과 바꾼 12번 FAIL(다른 칸이 아직 거절, `data-location-key` 없음).
- [ ] **Step 3: 마크업·CSS·flash** — Interfaces의 DOM 계약, 흐리게 규칙 셋, `flashElement` 옮기기와 움직임 줄이기 규칙. `order.drag.otherSection`을 쓰던 자리는 이 Task에서 사라진다.
- [ ] **Step 4: 끌기 배선** — `planAt`: 용지 밖이면 다른 `article[data-doc-id]` 위인지 보고 거기면 `{ state: "refused", note: otherDoc }`, 아니면 none. 용지 안이면 `section[data-location-key]` 띠로 `findDropSection`, 출발 칸이면 지금 `planDrop` 그대로. 다른 칸이면 `findEnterRefusal(...) ?? findLeaveRefusal(...)`(지금 데이터 `live`에서) → 거절이면 `{ hover: { state: "refused", note, target: section } }`, 아니면 그 칸의 잰 줄(`listDropRows(dest.items, null, measured)`)로 `planCrossDrop`, 결과 `{ state: "ok", note, target: section }`. `onDrop`은 지금 흐름 그대로(모양이 다르면 다시 세고, `edit`이 null이면 놓지 않음), FLIP은 덩어리 + 출발·도착 칸의 그려진 줄을 잡는다. `pick`에서 떠날 수 없는 덩어리면 onStart가 `data-drag-locked`를 붙인다.
- [ ] **Step 5: 문구·설명서** — Global Constraints의 en·ko 문구. 설명서 576행: "같은 칸 안에서만 놓입니다 — …(**Another section: change it in Assign**)…" 문장을 다른 칸(하위 칸·빈 칸, WI는 같은 부분의 다른 step)으로도 놓인다는 설명으로 바꾸고, 표에 도착 칸 번호("→ 5.1.3")가 적히는 것, 거절 넷과 다른 문서의 굵은 en 문구(**That section is N/A in the To-Be list.**, **Only sentences written here for an SOP can change section.**, **An AI translation moves only with its source: put them side by side first**, **Instruction or Why: change it in Assign**, **Another document: change it in Assign**), 놓은 줄이 잠깐 테두리로 강조되는 것(움직임 줄이기면 멈춘 테두리)을 적는다. 577행 **Move up** · **Move down** 설명에 "칸 끝에서 멈추고, 다른 칸으로는 끌어서 옮긴다"를 더한다.
- [ ] **Step 6: 통과 확인** — Run: `BACKEND_PYTHON=$PY QUIET=1 ONLY="order:" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs` (실패 0) 그리고 `QUIET=1 ONLY="assign:" BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs`(옮긴 `flashElement`) 그리고 `npx vitest run src/lib/i18n-messages.test.ts src/lib/manual-content.test.ts && npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run` · Expected: 스모크 실패 0, 나머지 오류 0.
- [ ] **Step 7: 커밋** — `feat(order): drag lines into another section of the same document — Order 줄을 같은 문서의 다른 칸으로 끌기` (`output-c.tsx`, `motion.tsx`, assign `page.tsx`, `components.css`, `i18n-messages.ts`, `user-manual.md`, `pw-smoke-sop.mjs`, `PROGRESS.md`)

---

### Task 5: 극단 자료와 전체 게이트

**Files:**
- Modify: `PROGRESS.md`(잰 값), 고칠 것이 나오면 Task 4의 파일

**Interfaces:**
- Consumes: Task 1~4 전부. Produces: 없음(검증 기록).

- [ ] **Step 1: 극단 자료 스택** — 스모크 스택을 내리고 다른 파일로:

```bash
DATABASE_URL=sqlite+aiosqlite:///./xsec-worst.db AUTH_MODE=dev $PY -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./xsec-worst.db AUTH_MODE=dev $PY -m scripts.seed_sop_demo
DATABASE_URL=sqlite+aiosqlite:///./xsec-worst.db AUTH_MODE=dev $PY -m scripts.seed_sop_worst
DATABASE_URL=sqlite+aiosqlite:///./xsec-worst.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $VENV/uvicorn app.main:app --port 8787
```

- [ ] **Step 2: 극단 자료에서 끌기** — 1120·2560 폭 둘에서 worst 묶음 Order: (a) 1,800자 문단 덩어리를 첫 칸에서 마지막 쪽 빈 칸까지 끌 때 자동 스크롤이 닿고 표가 한 줄로 줄어든다 (b) 아직 그리지 않은 구간을 지나도 선이 칸 머리 아래에 그어진다 (c) 긴 번호("→ 5.4.10.3") 표 note가 잘리지 않거나 말줄임 (d) 놓은 줄 강조가 보인다. Run: `DS=worst ONLY=C8,C13 BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs` · Expected: 종료 코드 0. 잰 값과 (a)~(d) 결과를 `PROGRESS.md`에.
- [ ] **Step 3: 전체 스모크와 감사 넷**(공용 부품 `motion.tsx`·`components.css`를 고쳤다 — 스모크 스택을 다시 깨끗이 시드한 뒤)

```bash
BACKEND_PYTHON=$PY QUIET=1 BASE_URL=http://localhost:3787 node scripts/pw-smoke-sop.mjs   # 실패 0
BASE_URL=http://localhost:3787 node scripts/pw-overlap-audit.mjs                         # ALL PASS
BASE_URL=http://localhost:3787 node scripts/pw-contrast-audit.mjs                        # 4.5:1 통과
```

- [ ] **Step 4: 빌드와 backend 전체** — `next dev`를 내리고 `npm run build`(경고 0), `cd ../backend && $PY -m pytest tests/ -q -n auto && $VENV/ruff check app/ tests/` · Expected: 경고 0, 모두 PASS.
- [ ] **Step 5: 커밋** — `test(order): verify cross-section drag on worst-case data — 극단 자료에서 다른 칸 끌기 확인` (`PROGRESS.md`, 고친 파일). 버전·CHANGELOG는 컨트롤러가 머지 때.
