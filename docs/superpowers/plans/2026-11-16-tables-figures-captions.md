# 표·그림 묶음과 캡션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign에서 표·그림을 캡션과 한 묶음으로 문장과 같은 로직(Shape → Where it goes → Decide)으로 다루고, 결과물에서 새 문서마다 표·그림 번호와 참조를 규칙으로 다시 매긴다.

**Architecture:** 캡션은 칸 문장과 같은 길을 탄다 — 캡션 단위(`Unit.kind="caption"`)는 `group_unit_id`로 표·행·그림 단위에 묶여 그 처분·상태를 따르고(`status.get_cover_status`·`groups.collect_component`가 이미 일반형), 캡션 새 문장은 묶음 새 문장 아래 `parent_target_id`를 가진 `kind="sentence"` 새 문장(칸 좌표 없음)이다. 참조는 원문 블록 좌표로 저장해(`caption_refs`) 단위 편집이 지나가도 옮길 일이 없고, 번호 다시 매기기는 결과물을 만들 때만 하는 순수 계산이라 확정 글은 원문 번호 그대로 남는다. 네 단계(Phase 0–3)로 나누고 단계마다 dev에 올릴 수 있다.

**Tech Stack:** FastAPI · SQLAlchemy async · Alembic · Pydantic(Python 3.11) / Next.js 16 · React 19 · TypeScript · Tailwind 4 · vitest · Playwright(시스템 Chrome)

**Spec:** `docs/superpowers/specs/2026-11-16-tables-figures-captions-design.md` (판단 기준은 제품 명세 `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`)

## Spec deltas found in code

코드를 읽고 명세의 전제와 다른 것을 적는다. 계획은 아래 판단대로 간다.

1. **표 도구는 이미 Shape에 있다.** `frontend/src/lib/assign-context-menu-model.ts` `buildTableItems`가 `table_rows`·`table_layout`·`table_merge`를 `edit` 묶음에 넣고 `SHAPE_LINE_ACTIONS`에도 있다. 막힌 것은 고르기다: Assign `handleOldClick`(`app/bundles/[id]/assign/page.tsx:1692`)이 `rowOfUnit.get(unitId)`만 보는데 줄 맵에는 묶음 단위만 있어 칸 문장을 누르면 아무 일도 없고(같은 파일의 `findRowKey`는 그룹으로 넘긴다), `paper.tsx` `handleClick`은 표 안 칸 틈 누름을 일부러 버린다. Phase 1은 고르기만 고치고 도구는 라벨만 바꾼다.
2. **"문장 사이 넣기"는 문장도 아직 못 한다.** 저장(`decisions._place_new_targets`·`target_placement`)은 새 문장을 칸 끝에(또는 `manual_order`가 아니면 결과물 정렬 순서로) 놓고, 문장 사이 자리는 Order 화면(`PUT /targets/order`, `routers/sop_outputs.reorder_targets` — 맨 위 새 문장 전부, 표·그림 포함)에서만 바꾼다. 저장 때 자리를 받는 것은 끌기 설계(`2026-11-16-drag-and-drop-design.md` §8, 3걸음)의 몫이고 그 설계는 새 문장 종류를 가리지 않는다. 그래서 묶음은 지금도 문장과 같은 자리 규칙이다 — 이 계획은 동등함을 시험으로 못 박고(Task 10), 저장 때 끼워 넣기는 끌기 3걸음에 맡긴다(아래 "사용자 결정 필요").
3. **Assign에는 아직 끌기가 없다.** v1.1.4의 공통 끌기 층(`lib/box-drag.ts`)은 Order에서만 쓴다. Order 줄에는 표·그림 줄이 이미 있어 그곳 끌기는 따로 할 일이 없다. Assign 끌기(끌기 설계 2·3걸음)가 오면 Phase 1의 고르기 규칙(`resolvePickUnit`)을 그대로 쓰면 된다.
4. **칸 문장은 "한 언어만 있는 줄" 숫자에 안 든다.** `snapshot.SINGLE_LANGUAGE_KINDS = ("sentence", "heading")`이고 `output_rows.count_single_language`는 묶이지 않은 단위만 센다. 명세 §3.2는 캡션이 칸 문장 규칙을 따르면서도 한 언어면 그 숫자에 잡힌다고 한다 — 계획은 캡션만 따로 세어 더한다(Task 12).
5. **결과물 A의 `[표 n, r×c]`는 옛 쪽 원문 칸이다**(`outputs._format_source_text`). 옛 쪽은 원문이라 번호를 다시 매길 대상이 아니다 — 원문 칸은 원문 캡션 글(없으면 지금 꼴), 다시 매긴 캡션은 새 문장(확정 글) 칸에 쓴다(Task 13·20).
6. **지금 그림 캡션은 그림 블록 글자 안에 있다**(`docx_reader._attach_captions`가 캡션 문단을 먹는다). 새 추출부터는 캡션 문단을 제 문단 블록으로 두고 표시(flag)로 잇는다(`EXTRACTOR_VERSION` "3"). 옛 추출의 캡션은 그림 블록에 남으므로 캡션 단위로 갈라만 내고(Alembic 0020) 떼기는 막는다(`caption_in_figure_block`).
7. **묶음 그래프·상태·묶음 읽기는 이미 일반형이다.** `group_unit_id`로 이웃을 찾는 `groups._find_neighbors`, `status.get_cover_status`, `build_group_out`의 `cell_unit_ids`는 단위 종류를 가리지 않는다. 고칠 곳은 종류로 거르는 자리(`TABLE_UNIT_KINDS`·`"cell_sentence"`를 쓰는 곳)뿐이다.

## 사용자 결정 필요

- **저장 때 문장 사이 끼워 넣기(명세 목표 3)**: 위 delta 2. 권장은 끌기 설계 3걸음(서버 자리 받기 §8)을 이 계획의 Phase 2 뒤에 두고, 이 계획은 동등 시험만 하는 것이다. 이 기능 안에서 꼭 되어야 하면 §8의 서버 필드를 Task 10에 넣어야 하고 끌기 작업과 겹친다.

## 빌더 재량으로 정한 것 (명세 §9)

- 캡션 저장: 캡션 단위 `kind="caption"` + `group_unit_id`. 캡션 새 문장 = `kind="sentence"`, `parent_target_id` 있음, `cell_row`·`cell_col` NULL(판정은 `app/sop/captions.is_caption_target` 하나). 새 표 없음(Phase 2), 참조는 새 표 `caption_refs`(Phase 3, 리비전 0021).
- 이행: 0020이 옛 그림 단위의 범위를 새 캡션 단위로 옮기고 확정·제안 새 문장에 캡션 새 문장을 붙인다(그림 단위 id·판단·새 문장은 그대로).
- 정규식: 그림 `^(?:그림|Figure|Fig)\s*\.?\s*\d+(?=$|[\s.:)\-–—])`, 표 `^(?:표|Table)\s*\.?\s*\d+(?=$|[\s.:)\-–—])`. 숫자 바로 뒤 조사("표 1에")는 캡션이 아니다.
- 좌우 스크롤 시작값: `td { min-width: 6ch; max-width: 36ch }`, 표 `width: max-content; min-width: 100%`. Task 5의 감사로 확정한다.
- 행으로 나눈 표: 캡션 단위는 행 번호가 가장 작은 행 단위로 간다. 레이아웃 표로 바꾸면 그 표의 캡션 단위는 문장 단위로 돌아가고, 데이터 표로 되돌려도 캡션은 저절로 붙지 않는다(Shape의 캡션 붙이기로).
- 캡션 글 고치기는 변경 종류를 묻지 않고 `rewritten`으로, 써 넣은 캡션은 `new`(출처 없음)로 보낸다.
- 번호 없는 캡션(써 넣은 "운전 조건")은 결과물에서 `표 n. `/`Table n. `(그림은 `그림 n. `/`Figure n. `)을 앞에 붙인다 — 캡션 언어(중립이면 ko)로 고른다. New 칸에 `+ 표 3`으로 보인다.
- 표·그림 라벨: Shape·메뉴의 "Treat as layout table"은 en **Unwrap table** / ko **표 벗기기**로 바꾼다. 머리 줄 종류 표시 `TABLE`·`FIGURE`는 REF처럼 화면 언어와 상관없이 영어.

## Global Constraints

- Word(docx)만 캡션·참조를 인식한다. PDF는 지금처럼 문단으로만 읽는다(명세 비목표).
- 레이아웃 표 자동 판별은 하지 않는다. Excel에는 이미지를 넣지 않고 캡션 글만 낸다.
- 배포 런타임 Python 3.11(`backend/ruff.toml` `target-version = "py311"`). backend 명령은 `backend/`에서 `.venv/bin/python -m pytest tests/<file> -q`, 커밋 전 `.venv/bin/python -m pytest tests/ -q -n auto`와 `.venv/bin/ruff check app/ tests/`.
- frontend 커밋 전 `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`(경고 0). 화면을 고친 커밋은 그 화면 스모크 `QUIET=1 ONLY="<화면>:" node scripts/pw-smoke-sop.mjs`. 공용 부품(`paper.tsx`)·API 층을 고친 Task는 전체 스모크와 감사 넷(`pw-layout-audit` DS=worst·`pw-overlap-audit`·`pw-contrast-audit`)을 돈다(루트 CLAUDE.md, 사용자 결정 2026-11-16).
- 모델을 바꾸면 Alembic 리비전(`--rev-id 0020`, `0021`)과 생성물 직접 검토. 마이그레이션은 `app.sop`를 가져오지 않는다(필요한 규칙은 파일 안에 얼려 둔다).
- 새 `raise_rule` 코드는 `frontend/src/lib/i18n-messages.ts`에 `rule.<code>` en·ko 한 쌍. 새 화면 글은 en·ko 한 쌍(`i18n-messages.test.ts`), 인터랙티브 요소는 `data-testid`.
- 화면·동작·라벨을 바꾼 커밋은 `frontend/public/manual/user-manual.md`의 글을 같은 커밋에서 고친다(그림은 MINOR 때). 설명서의 굵은 영어 라벨은 en 문구와 같아야 한다(`manual-content.test.ts`).
- 커밋 메시지 `type(scope): English summary — 한국어 요약`, 커밋마다 `PROGRESS.md` 1–3줄. 커밋·푸시는 GitHub `origin`에만. 단계(Phase)를 dev에 올리는 커밋에서 `frontend/`의 `npm version patch --no-git-tag-version`과 `CHANGELOG.md` `## Unreleased (dev)` 한 줄.
- 번호 다시 매기기는 규칙 계산이고 AI가 아니다. `confirmed_text`는 원문 번호 그대로 저장하고, 바뀐 번호는 화면(New 칸·결과물 미리보기)과 결과물에서만 보인다. 표와 그림은 따로, 새 문서(SOP·WI)마다, 결과물 순서대로 1부터, 모든 표·그림을 센다. 한/영 두 판이 같은 번호를 쓴다.
- 묶음 처리는 문장과 같은 단추·순서·단축키다. 묶음만의 동작은 캡션 붙이기/떼기·써 넣기와 Confirm 막기뿐이다.
- raw hex는 `src/styles/tokens.css` 밖에 쓰지 않는다. 포인터 끌기를 새로 짜지 않는다(`lib/box-drag.ts`). 화면 규칙은 순수 모델(`src/lib/*-model.ts`)에 두고 vitest로 시험한다.
- 합성 자료만 쓴다(파일 이름 `SYNTHETIC_`). 시드는 로컬 전용.

## Review Focus

1. **표 옆 참조 문장이 캡션으로 먹히는 것** — "표 1에 따라 운전한다."는 캡션이 아니고(숫자 뒤 조사), "표 1 참조."가 표 바로 앞에 있으면 캡션으로 잡혀도 Shape에서 뗄 수 있어야 한다. 시험: Task 7 `test_docx_table_caption_ignores_particle_after_number`.
2. **한/영 한 줄 캡션을 KO/EN로 나누기** — 나눈 두 조각이 모두 같은 묶음의 캡션으로 남고 언어가 각자 정해진다. 시험: Task 11 `test_split_caption_keeps_both_pieces_on_the_bundle`.
3. **올리기 전에 확정한 그림이 있는 묶음** — 이행 뒤에도 그림 새 문장 상태·판단이 그대로고, 결과물 C·Excel에 캡션 글이 나오며 검토 조건이 바뀌지 않는다. 시험: Task 9 `test_0020_moves_figure_caption_to_its_own_unit_and_target`.
4. **같은 원문 번호가 두 묶음을 가리키는 것**(한 문서에 "표 1"이 둘) — 바꾸지 않고 경고한다. 시험: Task 20 `test_ambiguous_reference_is_left_and_warned`.
5. **사람이 고쳐 참조 꼴이 사라진 글** — 바꾸지 않고 경고한다. 시험: Task 20 `test_edited_text_without_token_is_left_and_warned`.

---

## Phase 0 — 극단 자료부터 (모델 변경 없음)

### Task 0: 워크트리 준비 (커밋 없음)

**Files:** 없음(로컬 설치만)

- [ ] **Step 1: backend venv** — `backend/.venv`가 없다(확인함). `backend/`에서 `python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`.
- [ ] **Step 2: frontend 의존성** — `frontend/node_modules`가 없다. `frontend/`에서 `cp -Rc /Users/hyeonjin/Documents/sop-archivist/frontend/node_modules ./node_modules`(APFS 복제, 심링크 금지 — `docs/lessons/browser-verification.md` 함정 4) 뒤 `npm install`로 맞춘다.
- [ ] **Step 3: 기준선** — `backend/`에서 `.venv/bin/python -m pytest tests/ -q -n auto`, `frontend/`에서 `npx vitest run`. Expected: 모두 PASS. 실패가 있으면 기능 작업 전에 보고한다.
- [ ] **Step 4: 읽기** — `docs/lessons/ui-review.md`, `browser-verification.md`, `react-ts-patterns.md` §11(표 칸 nowrap).

### Task 1: 합성 묶음에 표·그림·캡션 문서(OLD-7)

**Files:**
- Modify: `backend/scripts/synthetic_sop.py` (`build_synthetic_bundle` files 끝에 OLD-7, 새 `_build_old_7`)
- Test: `backend/tests/test_synthetic_captions.py` (새로), `backend/tests/test_sop_e2e.py`(그대로 통과)

**Interfaces:**
- Produces: `_build_old_7(sheet: _AnswerSheet) -> tuple[bytes, list[dict]]` (바이트, 레이아웃 표 편집 `{doc:"OLD-7", op:"set_layout_table", table_index, is_layout:True}`). 파일 `SYNTHETIC_OLD-7_Tables_Figures_Captions.docx`, 배치 `interleaved`, files 튜플 **맨 끝**(앞 문서의 group 번호 보존 — 기존 주석 규칙).
- 문서 내용(순서 그대로, 글은 정확히):
  1. 절 제목 `1. 표와 그림 Tables and figures`
  2. `표 3. 운전 조건 (Table 3. Operating conditions)` Caption 스타일, 바로 뒤 3×3 데이터 표(원문 번호가 1이 아님)
  3. 2×2 데이터 표, 바로 뒤 `Table 4: Rotor limits`(스타일 없음, 글 꼴)
  4. `회전 속도는 아래 표를 따른다.` 바로 뒤 캡션 없는 2×3 데이터 표
  5. 그림, 바로 뒤 `그림 5. 로터 장착 (Figure 5. Rotor mounting)`(스타일 없음)
  6. `Fig.6 Lid lock` 바로 뒤 그림(앞 캡션, 띄어쓰기 없는 변형)
  7. 참조 문장 `운전 조건은 표 3을 따른다.` · `See Figure 5 for the mounting position.` · `Table 4 lists the rotor limits.` · `표 9 참조.`(없는 번호)
  8. `표 7. 기록 양식` 바로 뒤 2×2 표(칸마다 문장 두 개 — 템플릿) — 편집으로 레이아웃 표
- 답: 문장·제목·표·그림 모두 `SOP_CODE` `procedures.procedure`로 `as_is`(표는 `grid`·칸 targets, 그림은 `kind:"figure"`), `표 9 참조.`는 삭제 + 사유 상수 `MISSING_TABLE_REASON = "합성: 가리키는 표 9가 문서에 없다."`. 이 단계에서 캡션 문단은 일반 문장 답이다(Phase 2 Task 8이 바꾼다).

- [ ] **Step 1: 실패하는 시험** — `tests/test_synthetic_captions.py`:

```python
def test_old_7_has_every_caption_shape(tmp_path):
    bundle = build_synthetic_bundle(tmp_path)
    doc = next(d for d in bundle.documents if "OLD-7" in d.path.name)
    blocks = read_docx(doc.path.read_bytes(), LIMITS).blocks
    texts = [b.text for b in blocks if b.kind == "paragraph"]
    assert "표 3. 운전 조건 (Table 3. Operating conditions)" in texts
    assert "Table 4: Rotor limits" in texts
    assert "회전 속도는 아래 표를 따른다." in texts
    assert sum(b.kind == "figure" for b in blocks) == 2
    assert {b.table_index for b in blocks if b.kind == "table_cell"} == {0, 1, 2, 3}

def test_old_7_answers_cover_every_judged_unit(tmp_path):
    expected = build_synthetic_bundle(tmp_path).expected
    old7 = [a for a in expected["answers"] if a["doc"] == "OLD-7"]
    assert any(a.get("disposition") == "delete" and a["text"] == "표 9 참조." for a in old7)
    assert {"doc": "OLD-7", "op": "set_layout_table", "table_index": 3, "is_layout": True} in expected["edits"]
```
(`LIMITS`는 `test_sop_docx_reader.py`와 같은 값.)

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_synthetic_captions.py -q` → FAIL(OLD-7 없음).
- [ ] **Step 3: `_build_old_7` 구현** — 기존 `_add_table`·`_draw_figure`·`document.add_paragraph(..., style="Caption")` 사용, 답은 `_AnswerSheet` `add`로.
- [ ] **Step 4: 통과 확인** — 위 시험과 `.venv/bin/python -m pytest tests/test_sop_e2e.py tests/test_seed_sop_demo.py -q` → PASS(드라이버가 OLD-7 답까지 저장한다).
- [ ] **Step 5: 커밋** — `test(synthetic): add an OLD-7 document with table and figure captions — 표·그림 캡션 합성 문서 OLD-7`

### Task 2: 극단 자료에 캡션 문서(OLD-93)

**Files:**
- Modify: `backend/scripts/seed_sop_worst.py` (새 `build_captions_extreme`, W1의 `add(...)` 목록에 한 줄, 맨 위 docstring의 W1 설명)
- Test: `backend/tests/test_synthetic_captions.py`

**Interfaces:**
- Produces: `build_captions_extreme(code: str) -> bytes`, 파일 `SYNTHETIC_OLD-93_captions_extreme_캡션_극단.docx`, `add("captions", …)`.
- 내용: 18열×5행 표 + 앞 캡션 `표 1. ` + `long_text(420, "ko")`; 표 16개(3×3)·그림 16개를 번갈아, 각 캡션 `표 n. 합성 표 n` / `그림 n. 합성 그림 n`(n은 종류마다 2부터), 각 뒤에 `표 n을 참조한다. See Figure n.` 참조 문단; 칸마다 600자 글이 든 3열×2행 표(접힘 폭 시험); 캡션 없는 2×2 레이아웃 표(칸에 템플릿 문장 두 개).

- [ ] **Step 1: 실패하는 시험**

```python
def test_captions_extreme_shapes():
    blocks = read_docx(build_captions_extreme("OLD-93"), LIMITS).blocks
    widest = max(b.col_index for b in blocks if b.kind == "table_cell" and b.table_index == 0)
    assert widest == 17
    assert len({b.table_index for b in blocks if b.kind == "table_cell"}) >= 19
    assert sum(b.kind == "figure" for b in blocks) == 16
    assert max(len(b.text) for b in blocks if b.kind == "paragraph") > 420
```
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_synthetic_captions.py::test_captions_extreme_shapes -q` → FAIL(ImportError).
- [ ] **Step 3: 구현** — `build_tables` 옆, 그림은 `scripts.synthetic_sop._draw_figure` 재사용.
- [ ] **Step 4: 통과 확인 + 시드 한 번** — 시험 PASS. 별도 sqlite(`DATABASE_URL=sqlite+aiosqlite:///<scratch>/worst.db AUTH_MODE=dev`)에 `reset_db → seed_sop_demo → seed_sop_worst`. Expected: 끝 줄 `worst seed done: 43 bundles`, 종료 코드 0.
- [ ] **Step 5: 커밋** — `test(seed): add an extreme captions document to the worst-case seed — 극단 자료에 캡션 문서`

---

## Phase 1 — Assign 빠른 고침 (모델 변경 없음)

### Task 3: 표·그림 어디를 눌러도 묶음 전체가 골라진다

**Files:**
- Modify: `frontend/src/lib/paper-model.ts` (새 `resolvePickUnit`)
- Modify: `frontend/src/components/paper/paper.tsx` (prop `pickWholeBundle`, `handleClick`)
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx` (`handleOldClick`이 `findRowKey`로, Old `Paper`에 `pickWholeBundle`)
- Modify: `frontend/scripts/pw-smoke-sop.mjs` (새 단계), `frontend/public/manual/user-manual.md` (Assign 표·그림 줄, 317·477 근처)
- Test: `frontend/src/lib/paper-model.test.ts`

**Interfaces:**
- Produces: `resolvePickUnit(unitId: number, units: ReadonlyMap<number, ViewUnit>): number` — `group_unit_id`가 있으면 그 단위, 없으면 자기. `PaperProps.pickWholeBundle?: boolean`(기본 false — Split 화면은 칸 문장을 그대로 고른다).

- [ ] **Step 1: 실패하는 시험**

```ts
it("picks the table for a bound cell sentence and itself otherwise", () => {
  const units = new Map([[1, unit({ id: 1, kind: "table" })], [2, unit({ id: 2, kind: "cell_sentence", group_unit_id: 1 })], [3, unit({ id: 3, kind: "sentence" })]]);
  expect(resolvePickUnit(2, units)).toBe(1);
  expect(resolvePickUnit(3, units)).toBe(3);
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/paper-model.test.ts` → FAIL(not exported).
- [ ] **Step 3: 구현** — `pickWholeBundle`이면: `.su` 누름은 `onUnitClick(resolvePickUnit(id))`, 표 안 칸 틈 누름(`holder.dataset.kind === "table"`)도 표 단위를 고른다. Alt를 누른 누름·글자를 끌어 고른 상태는 지금처럼 그대로 둔다(`event.altKey`면 고르지 않는다). 우클릭은 바꾸지 않는다(칸 문장 메뉴에 이미 표 항목이 있다). Assign `handleOldClick`은 `rowOfUnit.get(unitId)` 대신 `findRowKey(unitId)`.
- [ ] **Step 4: 통과 확인** — vitest PASS. 스모크 새 단계 `"assign: a click anywhere on a table picks the whole table, Alt still selects text"`: 칸 글자를 누르면 오른쪽 Shape에 `Split into rows`(testid는 지금 Shape 단추의 것)가 보이고, Alt+끌기 뒤 `window.getSelection().toString()`이 비지 않는다. `QUIET=1 ONLY="assign:" node scripts/pw-smoke-sop.mjs` PASS. `paper.tsx`는 공용이라 전체 스모크도 돈다.
- [ ] **Step 5: 커밋** — `fix(assign): pick the whole table or figure from anywhere on it — 표·그림 어디를 눌러도 묶음 전체를 고른다`

### Task 4: 머리 줄 TABLE/FIGURE가 보이지 않는 손잡이를 대신한다

**Files:**
- Create: `frontend/src/components/paper/bundle-head.tsx` (`BundleHead`)
- Modify: `frontend/src/lib/paper-model.ts` (새 `getBundleHeader`), `frontend/src/components/paper/paper.tsx` (`renderTable`의 `ptbl-cap` 단추 → `BundleHead`, `renderFigure` 위에도), `frontend/src/styles/components.css` (`.ptbl-cap` 지우고 `.bundle-head`), `frontend/src/lib/i18n-messages.ts` (`split.layoutTable` en "Unwrap table"·ko "표 벗기기", `paper.bundleTable`·`paper.bundleFigure`·`paper.bundleFirstRow`), `frontend/scripts/pw-smoke-sop.mjs` (`"assign: table rows from the right-click menu, then undo"`의 `assign-paper-unit-<id>` 찾기 → 머리 줄 testid), `frontend/public/manual/user-manual.md`
- Test: `frontend/src/lib/paper-model.test.ts`

**Interfaces:**
- Produces: `getBundleHeader(row: Extract<PaperRow, { type: "table" | "figure" }>, model: PaperModel): { kind: "table" | "figure"; unitId: number | null; displayId: string; preview: string }` — 표는 첫 행 칸 글을 ` · `로 이은 것, 그림은 그림 블록 글(옛 추출 캡션). `BundleHead` props `{ head; selected: boolean; testId: string; caption?: ReactNode; captionMissing?: boolean }`(뒤 둘은 Task 14가 쓴다). testid `${testId}-head-${unitId}`, 머리 줄은 `data-unit` 대신 줄 상자의 `data-strip-unit`로 고른다(Task 3의 클릭 경로).
- 모습: 종류 표시는 REF 표시와 같은 자리·꼴(`ref-mark.tsx` 참고), 미리보기는 한 줄 말줄임(`Truncate`), 표시 ID는 오른쪽 흐리게. 골라진 테두리는 문장 조각과 같은 `.strip[data-sel]` 규칙(다르면 components.css에서 맞춘다).

- [ ] **Step 1: 실패하는 시험**

```ts
it("previews the first row of a table and the block text of a figure", () => {
  expect(getBundleHeader(tableRow([["열1", "열2"], ["a", "b"]]), model).preview).toBe("열1 · 열2");
  expect(getBundleHeader(figureRow("그림 1 로터"), model)).toMatchObject({ kind: "figure", preview: "그림 1 로터" });
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/paper-model.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces대로. 그림 블록 글은 머리 줄로 옮기고 그림 아래 `<p data-block>`는 Alt 긁기·나누기를 위해 남긴다.
- [ ] **Step 4: 통과 확인** — vitest·lint·tsc PASS, 전체 스모크 PASS(고친 표 단계 포함), `manual-content.test.ts` PASS(굵은 **Unwrap table**).
- [ ] **Step 5: 커밋** — `feat(assign): a TABLE/FIGURE head row replaces the invisible table handle — 보이지 않던 표 손잡이 대신 TABLE/FIGURE 머리 줄`

### Task 5: 표는 좌우로 스크롤한다 (Old·New·결과물)

**Files:**
- Modify: `frontend/src/styles/components.css` (`.ptbl` 둘레 `.ptbl-scroll`, `[data-single]` 예외 정리), `frontend/src/components/paper/paper.tsx` (`<table className="ptbl">`를 `<div className="ptbl-scroll" data-no-drag>`로 감싼다), `frontend/src/components/outputs/output-c.tsx` (표를 같은 스크롤 상자로), `frontend/scripts/pw-layout-audit.mjs` (항목 둘)
- Test: `pw-layout-audit.mjs`(DS=worst), `pw-overlap-audit.mjs`

**Interfaces:**
- Produces: CSS 클래스 `.ptbl-scroll`(`overflow-x: auto; max-width: 100%`) — Task 6의 New 칸 표도 쓴다. 감사 항목 `{ id: "T1", ds: "worst", path: OLD-93을 연 Assign }`, `{ id: "T2", ds: "worst", path: OLD-93 표가 든 결과물 C }`.
- 감사 기준(`expect`): 문서 가로 스크롤 없음(`scrollWidth <= clientWidth`), 18열 표의 행 높이 ≤ 3줄(66px), 600자 칸 폭 ≤ 36ch, 1120·1920 폭 둘 다.

- [ ] **Step 1: 감사 항목을 먼저 넣고 실패 확인** — 극단 스택(3787/8787, `browser-verification.md` 9)에서 `DS=worst ONLY=T1,T2 BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs` → FAIL(행 높이·폭 초과 값 보고).
- [ ] **Step 2: CSS 구현** — 시작값 `td { min-width: 6ch; max-width: 36ch; overflow-wrap: break-word }`, 표 `width: max-content; min-width: 100%`. 숫자는 감사 값으로 조정하고 PROGRESS에 잰 값을 적는다.
- [ ] **Step 3: 통과 확인** — 같은 감사 PASS, `pw-overlap-audit.mjs` PASS, 전체 스모크 PASS(Split 화면 표 포함).
- [ ] **Step 4: 커밋** — `fix(paper): scroll wide tables sideways instead of stretching them down — 넓은 표는 세로로 늘이지 않고 좌우 스크롤`

### Task 6: New 칸이 실제 표·그림을 보인다

**Files:**
- Modify: `backend/app/sop/outputs.py` (`ComposedItem`에 `table`·`figure`, `build_composed_doc`의 `build_item`), `backend/app/sop/written.py` (`WrittenSentenceOut`에 같은 두 칸)
- Modify: `frontend/src/lib/api-sop.ts` (`ComposedItem`·`WrittenSentence` 타입), `frontend/src/lib/composed-model.ts` (`buildComposedRows`가 두 칸을 옮긴다), `frontend/src/components/assign/new-pane.tsx` (379–383 자리표시 → `NewBundle`), Create `frontend/src/components/assign/new-bundle.tsx`, `frontend/public/manual/user-manual.md`
- Test: `backend/tests/test_sop_outputs.py`, `backend/tests/test_sop_written.py`, `frontend/src/lib/composed-model.test.ts`

**Interfaces:**
- Produces (backend, 두 모델 같은 모양):
  - `class BundleTableOut(BaseModel): rows: int; cols: int; cells: list[BundleCellOut]` / `class BundleCellOut(BaseModel): row: int; col: int; lang: str; text: str; status: str` — 칸 새 문장(확정 글, 없으면 AI 글).
  - `class BundleFigureOut(BaseModel): document_id: int; block_id: int` — 그림 출처 단위의 블록(옛 문서는 TargetSource, 입구 2는 `new_unit_id`), 이미지가 없으면 `None`.
  - `ComposedItem.table: BundleTableOut | None = None`, `ComposedItem.figure: BundleFigureOut | None = None`; `WrittenSentenceOut`도 같다.
- Produces (frontend): `NewBundle` props `{ kind; table?: BundleTable; figure?: BundleFigure; bundleId: number; testId: string }` — 표는 `.ptbl-scroll` 안 `.ptbl`, 그림은 `FigureImage(bundleId, figure.document_id, figure.block_id)`.

- [ ] **Step 1: 실패하는 시험** (backend)

```python
async def test_composed_doc_carries_table_cells_and_figure_block(...):
    doc = build_composed_doc(snap, sop.id, "en")
    table = next(i for s in doc.sections for i in s.items if i.kind == "table")
    assert (table.table.rows, table.table.cols) == (1, 2)  # 도우미로 만든 [["a", "b"]] 표
    assert [(c.row, c.col, c.text) for c in table.table.cells] == [(0, 0, "a"), (0, 1, "b")]
    figure = next(i for s in doc.sections for i in s.items if i.kind == "figure")
    assert figure.figure.block_id == figure_block_id
```
(시험 묶음은 `tests/sop_helpers.py`의 기존 표·그림 만들기 도우미로 세운다.) frontend: `buildComposedRows`가 `table`·`figure`를 줄에 싣는지.
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_outputs.py tests/test_sop_written.py -q -k "table_cells or figure_block"` → FAIL.
- [ ] **Step 3: 구현** — 스냅숏(`index.snap`)의 칸 새 문장(`parent_target_id`, `cell_row` 있음)과 출처 단위의 `block_id`로 채운다. 결과물 C 규칙을 새로 쓰지 않는다.
- [ ] **Step 4: 통과 확인** — pytest·vitest PASS, 스모크 새 단계 `"assign: the New pane shows a real table and figure"`(`assign-new-<target_id>` 안에 `table.ptbl`·`img`). `ONLY="assign:"` PASS.
- [ ] **Step 5: 단계 마감 + 커밋** — `npm version patch --no-git-tag-version`, CHANGELOG 한 줄. `feat(assign): show the real table and figure in the New pane — New 칸에 실제 표·그림`

---

## Phase 2 — 캡션 모델

### Task 7: docx에서 표 캡션을 찾고 캡션 문단을 제 블록으로 둔다

**Files:**
- Modify: `backend/app/sop/extract/docx_reader.py` (`_CAPTION_TEXT_RE` → 둘, `_ParaRecord`, `_Collector.read_container`·`_read_table`, `_attach_captions`, `_BlockWriter`, `_build_blocks`), `backend/app/sop/extract/types.py` (`EXTRACTOR_VERSION = "3"` + 주석)
- Test: `backend/tests/test_sop_docx_reader.py` (기존 `test_docx_figure_with_caption`·`test_docx_figure_takes_caption_from_previous_paragraph` 기대 바꿈)

**Interfaces:**
- Produces: 블록 표시 `FLAG_CAPTION_OF = "caption_of"`, 값 `f"caption_of:{seq}"` — 그림이면 그 그림 블록의 seq, 표면 그 표 첫 칸 블록의 seq. 캡션 문단은 `kind="paragraph"` 블록으로 남고 그림 블록 글은 `""`. 칸 안 그림·칸 안 표에는 캡션을 잇지 않는다(지금 규칙).
- 규칙: 그림은 바로 뒤 → 바로 앞, 표는 바로 앞 → 바로 뒤(같은 컨테이너의 이웃 순번). 캡션 스타일이거나 그 종류의 정규식(위 "빌더 재량")이면 캡션; 다른 종류 정규식에 맞으면 아니다. 한 문단은 한 묶음의 캡션만.
- 구현 모양: `read_container`가 표에도 `(container, position)`을 넘겨 `_Collector.table_slots: dict[int, tuple[int, int]]`에 바깥 표만 적는다. `_ParaRecord.caption_for: tuple[Literal["figure", "table"], int] | None`(그림은 레코드 목록 위치, 표는 `table_index`)이 `caption`·`is_consumed`를 대신한다. `_BlockWriter`가 그림 레코드 → 그림 블록 seq, 표 → 첫 칸 seq를 적어 두고, 끝에 `link_captions() -> None`이 캡션 블록을 `dataclasses.replace`로 표시를 더해 바꾼다.

- [ ] **Step 1: 실패하는 시험**

```python
def test_docx_table_caption_before_table_is_linked() -> None:
    blocks = _read(p("표 3. 운전 조건", "Caption") + tbl([["a", "b"]]) + p("뒤"))
    first_cell = next(b for b in blocks if b.kind == "table_cell")
    assert (blocks[0].kind, blocks[0].text) == ("paragraph", "표 3. 운전 조건")
    assert f"caption_of:{first_cell.seq}" in blocks[0].flags

def test_docx_table_caption_after_table_by_text() -> None:
    blocks = _read(tbl([["a"]]) + p("Table 4: Rotor limits"))
    assert any(f.startswith("caption_of:") for f in blocks[-1].flags)

def test_docx_table_caption_ignores_particle_after_number() -> None:
    blocks = _read(p("표 1에 따라 운전한다.") + tbl([["a"]]))
    assert not any(f.startswith("caption_of:") for f in blocks[0].flags)

def test_docx_fig_variants_are_figure_captions() -> None:
    for text in ("Fig.6 Lid lock", "Fig 6 Lid lock", "그림6 뚜껑"):
        blocks = _read(p(text) + f"<w:p>{make_drawing_run('image1.png')}</w:p>", media={"image1.png": TINY_PNG})
        figure = next(b for b in blocks if b.kind == "figure")
        assert figure.text == "" and f"caption_of:{figure.seq}" in blocks[0].flags

def test_docx_figure_caption_text_is_not_a_table_caption() -> None:
    blocks = _read(p("그림 2 펌프") + tbl([["a"]]))
    assert not any(f.startswith("caption_of:") for f in blocks[0].flags)
```
기존 두 시험은 `("paragraph", "그림 1 로터")` 블록이 그림 블록 뒤에(앞 캡션이면 앞에) 남고 그림 블록 글이 `""`가 되게 바꾼다.
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_docx_reader.py -q` → 새 시험 FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces. `test_sop_units`·`test_sop_segment`가 이 단계에서 깨지면(그림 단위 범위가 비어 캡션 문단이 문장 단위가 됨) Task 8에서 고친다 — 이 Task는 `test_sop_docx_reader.py`만 초록이면 되지만, 전체 시험을 깨뜨린 채 커밋하지 않도록 Task 7·8은 같은 브랜치에서 연달아 하고 **Task 8 끝에 함께 커밋**한다.
- [ ] **Step 4: 통과 확인** — `tests/test_sop_docx_reader.py` PASS.

### Task 8: 캡션 단위 — 쪼개기·묶기·합성 정답

**Files:**
- Modify: `backend/app/sop/constants.py` (`UNIT_KINDS`·`COVER_KINDS`에 `"caption"`), `backend/app/sop/groups.py` (`BUNDLE_UNIT_KINDS`), `backend/app/sop/segment.py` (`build_unit_drafts`), `backend/app/sop/decisions.py` (`_load_state`의 묶인 단위 읽기만), Create `backend/app/sop/captions.py`
- Modify: `backend/scripts/synthetic_sop.py` (OLD-1 그림 답, OLD-7 캡션 답), `backend/scripts/sop_demo_driver.py` (`_build_target` 캡션 새 문장), `backend/tests/fake_ai.py`(정답 소비 확인)
- Test: `backend/tests/test_sop_segment.py`, `backend/tests/test_sop_units.py`, `backend/tests/test_sop_e2e.py`

**Interfaces:**
- Produces:
  - `groups.BUNDLE_UNIT_KINDS = (*TABLE_UNIT_KINDS, "figure")` — 묶인 단위(칸 문장·캡션)를 갖는 단위.
  - `captions.CAPTION_KIND = "caption"`; `captions.is_caption_target(target) -> bool`(`kind == "sentence" and parent_target_id is not None and cell_row is None and cell_col is None`, ORM 행과 `snapshot.TargetInfo` 둘 다 받는 Protocol).
  - 쪼개기: `caption_of:<seq>` 표시가 있는 블록은 블록 전체(앞뒤 빈 글자 뺀) 범위 하나의 `UnitDraft("caption", …, lang=detect_language(…) 또는 이웃 채움, group_index=<그 seq의 그림 초안 또는 표 초안 위치>)`. 이을 초안이 없으면(레이아웃 표·칸 안) 표시를 무시하고 보통 문장으로 쪼갠다. 그림 초안은 범위 `[]`(새 추출은 그림 블록 글이 비었다).
  - `decisions._load_state`: 묶인 단위를 `TABLE_UNIT_KINDS`가 아니라 `BUNDLE_UNIT_KINDS`로 읽어 `member_unit_ids`·`group_of`에 넣는다. `state.cells`에는 `cell_sentence`만 남기고 새 `state.captions: dict[int, list[int]]`에 캡션을 둔다(닫힘 검사가 캡션 때문에 `not_closed`를 내지 않게 — 캡션 새 문장은 Task 10).
  - 드라이버: 답 `targets`의 항목이 `parent_key`가 있고 `cell_row`가 없으면 캡션 새 문장 — `source_text`로 같은 문서의 캡션 단위를 찾고(없으면 출처 없음), `kind:"sentence"`, `lang`, `text`, `parent_key`만 보낸다.
  - 정답: OLD-1 그림 답은 `text: ""`(그림 단위) + 그 답의 targets에 캡션 새 문장 `{parent_key, source_text: "그림 1. 로터 장착 위치 (Figure 1. Rotor mounting position)", lang: "ko", text: 같은 글, change_type: "as_is"}`. OLD-7의 캡션 문단 답은 지우고 표·그림 답의 캡션 새 문장으로 옮긴다(`표 7. 기록 양식`은 레이아웃 편집 뒤 문장으로 남으니 문장 답 그대로). 그림 답을 찾을 때 `kind:"figure"`·`text:""`가 두 개 이상이면 `occurrence`로 가린다.

- [ ] **Step 1: 실패하는 시험**

```python
def test_caption_block_becomes_a_caption_draft_bound_to_its_table():
    drafts = build_unit_drafts([para(1, 0, "표 3. 운전 조건", flags=["caption_of:1"]), cell(2, 1, table_id=9)], [TableView(9, False)], "ko_only")
    caption = next(d for d in drafts if d.kind == "caption")
    assert drafts[caption.group_index].kind == "table"
    assert caption.spans == [(1, 0, len("표 3. 운전 조건"))]

def test_caption_of_a_layout_table_is_a_sentence():
    drafts = build_unit_drafts([para(1, 0, "표 7. 양식", flags=["caption_of:1"]), cell(2, 1, table_id=9)], [TableView(9, True)], "ko_only")
    assert [d.kind for d in drafts][:1] == ["sentence"]
```
`test_sop_units.py`: 업로드 뒤 캡션 단위의 `group_unit_id`가 표 단위이고 `verify_document_coverage`가 통과(`test_caption_units_keep_coverage`).
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_segment.py tests/test_sop_units.py -q` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces. `units.create_initial_units`의 `group_index` 쓰기는 이미 일반형이라 그대로 둔다.
- [ ] **Step 4: 통과 확인** — `.venv/bin/python -m pytest tests/ -q -n auto` PASS(E2E 포함 — 정답·드라이버를 이 Task에서 맞춘다). 깨지는 시험이 표·그림 단위 수를 세는 기존 시험이면 캡션 단위만큼 기대를 고친다(규칙을 바꾸지 않는다).
- [ ] **Step 5: 커밋(Task 7+8)** — `feat(sop): read table captions from docx and keep captions as units bound to their table or figure — docx 표 캡션 읽기와 묶음에 딸린 캡션 단위`

### Task 9: 옛 그림 캡션 이행 (Alembic 0020)

**Files:**
- Create: `backend/alembic/versions/0020_caption_units.py`
- Test: `backend/tests/test_migrations.py`

**Interfaces:**
- Consumes: 캡션 단위 모양(Task 8), `captions.is_caption_target` 규칙.
- Produces: 스키마 변경 없음, 데이터만. 각 최신이 아닌 추출까지 포함한 **활성** 그림 단위 중 범위가 빈 것이 아닌 것마다:
  1. 같은 추출에 캡션 단위 INSERT(`local_no` = 그 추출 최대 + 1부터, `kind="caption"`, 범위·글 = 그림 단위 것, `lang` = 한글 음절이 있으면 ko, 없고 라틴 글자면 en, 둘 다 없으면 ko — 파일 안에 얼린 규칙, `group_unit_id` = 그림 단위, `pos_seq`·`pos_start` = 그림 단위 것, `status="active"`).
  2. 그림 단위 `spans=[]`, `text=""`.
  3. 옛 문서면 캡션 단위의 `unit_decisions` 행(그림 판단과 같은 `bundle_id`, 미배정 기본값 — 상태는 그룹을 따른다).
  4. 그 그림 단위를 출처로 가진 새 문장(옛: `target_sources`, 입구 2: `new_unit_id`)마다 캡션 새 문장 INSERT: `kind="sentence"`, `parent_target_id`=그림 새 문장, 같은 `bundle_id`·`target_doc_id`·자리 칸, `lang`=캡션 단위 언어, `confirmed_text`=그림 새 문장이 `confirmed`면 캡션 글 아니면 `""`, `ai_text`=캡션 글, `status`=그림 새 문장 상태, `change_type="as_is"`, `origin`=그림 새 문장 것, `new_unit_id`=입구 2면 캡션 단위, `revision=1`. 옛 쪽이면 `target_sources(target_id, unit_id=캡션 단위, seq=0)`.
- downgrade: 캡션 단위의 범위·글을 그림 단위로 되돌리고 캡션 단위·새 문장을 지운다(이 이행이 만든 것만 — `kind="caption"`이면서 그 그림 단위 범위가 빈 것).

- [ ] **Step 1: 실패하는 시험** — `test_0019_…` 꼴로 0019까지 올린 DB에 그림 단위(범위 있음)·확정 판단·확정 그림 새 문장을 넣고 0020으로:

```python
def test_0020_moves_figure_caption_to_its_own_unit_and_target(tmp_path):
    ...
    assert figure_row.spans == "[]" and figure_row.text == ""
    assert caption_row.kind == "caption" and caption_row.group_unit_id == figure_id and caption_row.text == "그림 1 로터"
    assert child.parent_target_id == figure_target_id and child.confirmed_text == "그림 1 로터" and child.status == "confirmed"
    assert decision_of_figure.status == "confirmed"  # 그림 판단은 그대로
```
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_migrations.py -q -k 0020` → FAIL.
- [ ] **Step 3: 구현** — `op.get_bind()`로 읽고 쓰기, sqlite·postgres 둘 다 되는 SQL(JSON 칸은 문자열 `"[]"` 바인딩). `app.sop`를 가져오지 않는다.
- [ ] **Step 4: 통과 확인** — `tests/test_migrations.py` 전체 PASS(`test_downgrade_to_base_and_back`·`test_models_match_migrations` 포함).
- [ ] **Step 5: 커밋** — `feat(db): move existing figure captions into caption units and targets — 기존 그림 캡션을 캡션 단위·새 문장으로 이행 (0020)`

### Task 10: 저장 — 캡션 새 문장, 캡션 써 넣기, Confirm은 캡션이 있어야

**Files:**
- Modify: `backend/app/sop/decisions.py` (`_plan_target`, `_check_source_kinds`, `_link_cell_target`, 새 `_check_captions`, `_write_group` 호출 순서), `backend/app/sop/groups.py`(필요하면 `GroupUnitOut`에 손대지 않는다 — `cell_unit_ids`가 캡션도 싣는다)
- Modify: `frontend/src/lib/i18n-messages.ts` (`rule.caption_required`, `rule.invalid_caption_target`)
- Test: `backend/tests/test_sop_decisions.py`, `backend/tests/test_sop_outputs.py`(자리 동등)

**Interfaces:**
- Consumes: `captions.is_caption_target`, `state.captions`·`state.group_of`(Task 8).
- Produces:
  - 캡션 계획: `parent_key`가 있고 `cell_row`·`cell_col`이 모두 `None`인 문장 항목. 부모 계획 종류는 `table` 또는 `figure`, 같은 새 문서·자리. 출처는 비었거나(써 넣기 — `sources_required` 예외, 변경 종류 `new`) 부모의 출처 단위에 묶인(`state.group_of`) `caption` 단위 하나. 아니면 422 `invalid_caption_target`. 캡션 계획은 `plan.parent`를 갖고 `plan.is_cell = True`(순서·번호에 들지 않는다).
  - `caption` 단위는 캡션 계획의 출처로만 된다(그 밖의 새 문장이 출처로 쓰면 `invalid_caption_target`).
  - `_check_captions(payload: GroupSaveIn, plans: list[_Plan], state: _State) -> None` — `action == "confirm"`일 때, 판단이 `assigned`인 단위를 출처로 하는 표·그림 계획마다 캡션 계획이 하나 이상 없으면 422 `caption_required`(`keys`). 보류(`hold`)·삭제·이동은 막지 않는다.
  - 자리 동등(명세 §4.3): 표·그림 새 문장은 문장과 같은 `_place_new_targets` 길로 놓이고, `PUT /targets/order`로 문장 사이로 옮겨지며 캡션·칸 새 문장은 부모를 따라간다(순서에 들지 않는다).

- [ ] **Step 1: 실패하는 시험**

```python
async def test_figure_confirm_needs_a_caption(...):
    resp = await save(figure_target(), confirm=True)
    assert resp.status_code == 422 and resp.json()["detail"]["code"] == "caption_required"

async def test_figure_confirms_with_its_caption_unit(...):
    resp = await save(figure_target(key="f"), caption(parent_key="f", source=caption_unit_id), confirm=True)
    assert resp.status_code == 200
    child = target_of(caption_unit_id)
    assert child.parent_target_id == figure_target_id and child.cell_row is None and child.lang == "ko"

async def test_written_caption_has_no_source_and_is_new(...):
    resp = await save(table_target(key="t"), caption(parent_key="t", text="운전 조건", lang="ko"), confirm=True)
    assert resp.status_code == 200 and target_by_text("운전 조건").change_type == "new"

async def test_caption_unit_cannot_be_a_plain_sentence_source(...):
    resp = await save(sentence(source=caption_unit_id))
    assert resp.json()["detail"]["code"] == "invalid_caption_target"

async def test_caption_of_another_bundle_is_rejected(...): ...
async def test_hold_without_caption_is_allowed(...): ...

async def test_figure_target_reorders_between_sentences_like_a_sentence(...):
    # PUT /targets/order로 그림을 두 문장 사이에 — 결과물 C 순서가 [문장, 그림, 문장], 캡션은 그림 children
```
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_decisions.py -q -k caption` → FAIL.
- [ ] **Step 3: 구현** — `_link_cell_target`의 `parent.item.kind != "table"` 검사를 캡션 계획일 때 `("table", "figure")`로 푼다. `_check_captions`는 `_check_dispositions` 뒤, 계획이 모두 선 뒤에 부른다.
- [ ] **Step 4: 통과 확인** — `tests/test_sop_decisions.py tests/test_sop_outputs.py tests/test_sop_e2e.py -q` PASS(E2E 정답의 캡션 새 문장이 Task 8에서 들어가 있다), `npx vitest run src/lib/i18n-messages.test.ts` PASS.
- [ ] **Step 5: 커밋** — `feat(sop): save captions under their table or figure and require one to confirm — 캡션 새 문장 저장과 캡션 없는 묶음 확정 막기`

### Task 11: 편집 — 캡션 붙이기·떼기, 행 나누기·표 벗기기와 캡션

**Files:**
- Modify: `backend/app/sop/editing.py` (`TEXT_KINDS`, `_plan_merge`, `_decide_merged_kind`, `_Change`(`retired_spans` → `retired_shapes`), `_plan_split_table_rows`, `_plan_set_layout_table`, 새 `AttachCaptionOp`·`DetachCaptionOp`·`_plan_attach_caption`·`_plan_detach_caption`, `EditOp`, `_plan`)
- Modify: `frontend/src/lib/i18n-messages.ts` (`rule.caption_not_adjacent`, `rule.caption_exists`, `rule.caption_in_figure_block`)
- Test: `backend/tests/test_sop_editing.py`

**Interfaces:**
- Produces:
  - `class AttachCaptionOp(BaseModel): type: Literal["attach_caption"]; unit_id: DbId; bundle_unit_id: DbId` — 글 단위(`sentence`·`heading`, 묶이지 않음, REF 아님)를 은퇴시키고 같은 범위·언어의 `caption` 단위(`group_unit_id=bundle_unit_id`)를 만든다. 묶음은 `BUNDLE_UNIT_KINDS`, 같은 추출. 그 글 단위가 묶음 바로 앞이나 뒤(정렬 키로 묶음과 그 묶인 단위를 건너뛴 이웃)가 아니면 422 `caption_not_adjacent`, 묶음에 같은 언어 캡션 단위가 이미 있으면 422 `caption_exists`.
  - `class DetachCaptionOp(BaseModel): type: Literal["detach_caption"]; unit_id: DbId` — `caption` 단위를 같은 범위의 `sentence` 단위(묶음 없음)로. 범위의 블록이 `figure`(옛 추출)면 422 `caption_in_figure_block`.
  - `TEXT_KINDS = ("sentence", "heading", "cell_sentence", "caption")`. 합치기: 캡션은 같은 묶음의 캡션끼리만(아니면 `cannot_merge`), 결과 종류 `caption`. 나누기·경계 옮기기·골라 만들기는 `_build_draft`가 종류·묶음을 물려받아 두 조각 모두 캡션.
  - `_Change.retired_shapes: list[tuple[tuple[Span, ...], str, int | None]]`, `is_unchanged`는 `(spans, kind, group_unit_id)` 모음으로 견준다(붙이기·떼기는 범위가 같아도 바뀐 것).
  - 행 나누기: 묶인 단위 중 캡션은 행 번호가 가장 작은 행 초안의 `cells`로(`by_row`에 넣지 않는다 — `row_index`가 없다). 표 벗기기(레이아웃으로): 캡션은 `regroup`이 아니라 은퇴 + 같은 범위 `sentence` 초안.

- [ ] **Step 1: 실패하는 시험**

```python
async def test_attach_a_neighbor_sentence_as_caption_and_undo(...):
    result = await edit({"type": "attach_caption", "unit_id": sentence_id, "bundle_unit_id": table_id})
    caption = only_created(result)
    assert (caption.kind, caption.group_unit_id, caption.spans) == ("caption", table_id, sentence_spans)
    await undo(); assert active(sentence_id)

async def test_attach_rejects_a_far_sentence(...): code == "caption_not_adjacent"
async def test_detach_turns_caption_back_into_a_sentence(...): ...
async def test_detach_legacy_figure_block_caption_is_rejected(...): code == "caption_in_figure_block"
async def test_split_caption_keeps_both_pieces_on_the_bundle(...):
    result = await edit({"type": "split", "unit_id": caption_id, "at": index_of("(Figure")})
    assert [(u.kind, u.group_unit_id) for u in created(result)] == [("caption", figure_id), ("caption", figure_id)]
    assert {u.lang for u in created(result)} == {"ko", "en"}
async def test_split_table_rows_moves_caption_to_first_row(...): ...
async def test_unwrap_table_turns_its_caption_into_a_sentence(...): ...
async def test_merge_caption_with_plain_sentence_is_rejected(...): code == "cannot_merge"
```
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_editing.py -q -k caption` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces. 새 편집도 `_write_change`·`_Change` 길에만 얹는다(되돌리기·떼어 내기·맞추기가 따라온다).
- [ ] **Step 4: 통과 확인** — `tests/test_sop_editing.py tests/test_sop_decision_undo.py -q` PASS.
- [ ] **Step 5: 커밋** — `feat(sop): attach and detach captions, and keep them right through row splits and unwrapping — 캡션 붙이기·떼기, 행 나누기·표 벗기기 때 캡션 처리`

### Task 12: AI·입구 2·한 언어 숫자가 캡션을 안다

**Files:**
- Modify: `backend/app/sop/ai/classify.py` (`_add_cell_targets` → 묶인 단위마다: 칸은 지금처럼, 캡션은 칸 좌표 없는 캡션 새 문장; 그림에도 부른다), `backend/app/sop/match.py` (`_Want`: `group_unit_id`의 단위가 그림이거나 묶인 단위가 `caption`이면 칸 좌표 없음), `backend/app/sop/output_rows.py` (`count_single_language`)
- Test: `backend/tests/test_sop_ai_classify.py`, `backend/tests/test_sop_match.py`, `backend/tests/test_sop_outputs.py`

**Interfaces:**
- Produces: `classify._add_member_targets(session, job, candidate, suggestion_id, bundle_unit: Unit, bundle_target: TargetSentence) -> list[tuple[TargetSentence, list[Unit]]]`(이름 바꿈 — 부르는 곳 하나). 캡션 새 문장 `ai_text=캡션 글`, `change_type="as_is"`, `lang=캡션 단위 언어`. `count_single_language`는 지금 수에, 판단이 배정인 묶음에 딸린 활성 캡션 단위 중 짝이 없고 다른 언어 새 문장(번역·출처)이 없는 것(두 언어 배치 문서, REF 아님)을 더한다.

- [ ] **Step 1: 실패하는 시험** — `test_classify_figure_suggests_its_caption_under_the_figure`(제안된 그림 새 문장의 children에 캡션 새 문장, `cell_row is None`), `test_written_new_doc_caption_is_a_child_of_its_figure`(입구 2 새 문서 업로드 뒤 캡션 단위의 새 문장 `parent_target_id`=그림 새 문장), `test_single_language_counts_a_one_language_caption`.
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_classify.py tests/test_sop_match.py tests/test_sop_outputs.py -q -k caption` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인** — 세 파일 PASS, 전체 `-n auto` PASS.
- [ ] **Step 5: 커밋** — `feat(ai): suggest captions with their table or figure, and count one-language captions — AI 제안·입구 2·한 언어 숫자에 캡션`

### Task 13: 결과물에 캡션 글 (번호는 아직 원문)

**Files:**
- Modify: `backend/app/sop/outputs.py` (`_build_item`: 그림 `text` = 캡션 글; 표 children 앞에 캡션; `ARow.row_kind`에 `"caption"`; `_format_source_text`: 표·그림 단위에 캡션 단위가 있으면 그 글 + 표는 ` [r×c]`), `backend/app/sop/sheet_model.py` (`_MARKERS`는 캡션이 없을 때만), `backend/app/sop/outputs.py` `build_composed_doc`(`ComposedItem.caption: str | None`), `backend/app/sop/written.py` (`WrittenSentenceOut.caption: str | None`)
- Modify: `frontend/src/lib/api-sop.ts` (`ARow.row_kind`·`ComposedItem.caption`·`WrittenSentence.caption`), `frontend/src/components/outputs/output-c.tsx` (73: `[Figure]` 대신 `item.text`, 표 위 캡션 줄), `frontend/src/components/assign/new-bundle.tsx` (표·그림 위 캡션 줄, 없으면 **Caption needed**), 결과물 A 화면의 `row_kind` 분기
- Test: `backend/tests/test_sop_outputs.py`, `backend/tests/test_sop_excel.py`

**Interfaces:**
- Consumes: `captions.is_caption_target`.
- Produces: 캡션 글 고르기 `outputs._pick_caption_text(index: _Index, bundle_target: TargetInfo) -> str | None` — 캡션 새 문장의 확정 글, 없으면 AI 글, 여러 언어면 ko·en 순으로 줄바꿈 이음. C의 그림 `CItem.text`가 이 값, 표는 `children` 첫 항목들이 캡션 새 문장(그다음 칸, 행·열 순). Excel C는 같은 모델을 옮겨 쓴다(이미지 없음).

- [ ] **Step 1: 실패하는 시험** — `test_output_c_figure_text_is_its_caption`(`[Figure]` 아님), `test_output_c_table_caption_comes_before_cells`, `test_output_a_table_source_shows_original_caption`(`"표 3. 운전 조건 [3×3]"`), `test_excel_c_writes_caption_text_not_marker`, `test_composed_and_written_items_carry_caption`(`tests/test_sop_written.py`에도 한 줄).
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_outputs.py tests/test_sop_excel.py -q -k caption` → FAIL.
- [ ] **Step 3: 구현** — 칸 글·모양 판정은 `sheet_model.py`에만(백엔드 CLAUDE.md 결과물 규칙).
- [ ] **Step 4: 통과 확인** — 두 파일 PASS, `ONLY="outputs"` 스모크 PASS.
- [ ] **Step 5: 커밋** — `feat(outputs): write caption text for tables and figures — 결과물에 표·그림 캡션 글`

### Task 14: Old 칸 — 캡션이 머리 줄에, 없으면 "Caption needed"

**Files:**
- Modify: `frontend/src/lib/paper-model.ts` (새 `foldCaptionRows`), `frontend/src/components/paper/paper.tsx` (`renderRows` 앞에 접기, `BundleHead`에 캡션 조각), `frontend/src/components/paper/bundle-head.tsx` (`caption`·`captionMissing`), `frontend/src/lib/api-sop.ts` (`UnitKind`에 `"caption"`), `frontend/src/lib/i18n-messages.ts` (`paper.captionNeeded`), `frontend/public/manual/user-manual.md`
- Test: `frontend/src/lib/paper-model.test.ts`

**Interfaces:**
- Produces: `foldCaptionRows(rows: PaperRow[], units: ReadonlyMap<number, ViewUnit>): PaperRow[]` — `caption` 단위의 조각 줄을 빼서 그 `group_unit_id` 묶음 줄의 `captions`에 담는다. `PaperRow`의 `table`·`figure`에 `captions?: Extract<PaperRow, { type: "piece" }>[]`. 머리 줄은 캡션 조각을 `renderSegment`로 그려(`.su` 그대로 — Alt 긁기·나누기·우클릭이 캡션 단위에 간다) 미리보기 대신 보인다. 캡션이 없으면 경고색(`--warn` 토큰) **Caption needed** + 미리보기. 옛 추출(캡션이 그림 블록 안)도 같은 머리 줄에 캡션으로.

- [ ] **Step 1: 실패하는 시험**

```ts
it("folds a caption piece before the table into the table row", () => {
  const rows = foldCaptionRows([pieceRow(5), tableRow(9)], units({ 5: { kind: "caption", group_unit_id: 9 }, 9: { kind: "table" } }));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ type: "table", captions: [expect.objectContaining({ unitId: 5 })] });
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/paper-model.test.ts` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인** — vitest·lint·tsc PASS, 전체 스모크 PASS(공용 부품), `DS=worst ONLY=T1` 감사 PASS(420자 캡션이 머리 줄을 무너뜨리지 않는다 — 머리 줄 캡션은 두 줄 말줄임, 고르면 펼침).
- [ ] **Step 5: 커밋** — `feat(assign): show the caption in the bundle head and flag a missing one — 머리 줄에 캡션, 없으면 Caption needed`

### Task 15: 저장 요청·캡션 써 넣기·Confirm 막기·남은 수

**Files:**
- Create: `frontend/src/lib/caption-model.ts`, `frontend/src/lib/caption-model.test.ts`
- Modify: `frontend/src/lib/classify-model.ts` (`SaveContext.captions`, `RowDraft.captionTexts`, `buildGroupSave`), `frontend/src/app/bundles/[id]/assign/page.tsx` (`buildTables` 옆 `buildCaptions`, Confirm 단추 `disabled`·툴팁 2247–2248, 위쪽 줄 남은 수 2767 옆, `runSave`의 막기 1256 옆, Edit and confirm 안 캡션 칸), `frontend/src/lib/i18n-messages.ts` (`assign.caption.needed`, `assign.caption.pendingCount`, `assign.caption.write`), `frontend/public/manual/user-manual.md`, `frontend/scripts/pw-smoke-sop.mjs`
- Test: `frontend/src/lib/caption-model.test.ts`, `frontend/src/lib/classify-model.test.ts`

**Interfaces:**
- Consumes: 서버 캡션 계획 규칙(Task 10).
- Produces:
  - `interface CaptionSource { unitId: number | null; lang: UnitLang; text: string }`
  - `listCaptionSources(bundle: ViewUnit, units: readonly ViewUnit[], draft: RowDraft | undefined): CaptionSource[]` — 묶인 `caption` 단위(+ `draft.captionTexts`로 고친 글), 단위가 없고 써 넣은 글이 있으면 `unitId: null`.
  - `isCaptionGate(row: ClassifyRow, destination: Destination | null, units: ReadonlyMap<number, ViewUnit>, draft: RowDraft | undefined): boolean` — 보낼 곳이 새 문서 자리(넣기·잇기)이고 줄에 표·행·그림 단위가 있는데 그 단위의 캡션 출처가 하나도 없으면 true. 삭제·이동·보류는 false.
  - `listCaptionPendingRowKeys(rows: ClassifyRow[], units, groupStatus): string[]` — 배정된(또는 AI 제안된) 묶음 중 캡션 새 문장도 캡션 단위도 없는 줄. 위쪽 줄에 **{n} captions needed**(누르면 다음 줄, REF 남은 수와 같은 꼴·자리).
  - `RowDraft.captionTexts: Record<string, string>`(언어 → 글). `buildGroupSave`는 표·그림 항목마다 캡션 출처를 `{ key: `${key}-cap-${lang}`, kind: "sentence", lang, text, parent_key: key, source_unit_ids: unitId ? [unitId] : [], change_type }`로 싣는다 — 글이 출처와 같으면 `as_is`, 다르면 `rewritten`, 출처 없으면 생략(서버가 `new`).
  - Confirm: `isCaptionGate`면 흐리게 끄고 툴팁 **Add a caption first**(`assign.caption.needed`). ↵·메뉴 확정도 `runSave`에서 같은 문구 토스트. Edit and confirm을 열면 캡션 언어마다 글 칸, 캡션이 없으면 **Write a caption** 칸(언어는 표·그림 앞 문장 언어, 없으면 ko).

- [ ] **Step 1: 실패하는 시험**

```ts
it("gates confirm for an assigned figure without any caption", () => {
  expect(isCaptionGate(figureRow, placeDest, units({ 9: { kind: "figure" } }), undefined)).toBe(true);
  expect(isCaptionGate(figureRow, deleteDest, units({ 9: { kind: "figure" } }), undefined)).toBe(false);
  expect(isCaptionGate(figureRow, placeDest, units({ 9: { kind: "figure" } }), draftWith({ captionTexts: { ko: "로터" } }))).toBe(false);
});
it("sends caption targets under the figure target", () => {
  const save = buildGroupSave(draft, ctxWithCaption(7, "ko", "그림 1 로터"), "confirm");
  expect(save.targets).toContainEqual(expect.objectContaining({ parent_key: "f", source_unit_ids: [7], cell_row: undefined, lang: "ko" }));
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/caption-model.test.ts src/lib/classify-model.test.ts` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인** — vitest·lint·tsc PASS. 스모크 새 단계 `"assign: a bundle without a caption cannot be confirmed until one is written"`(OLD-7 캡션 없는 표: `assign-primary` disabled → 캡션 써 넣기 → 확정 → 결과물 C에 그 글). `ONLY="assign:"` PASS.
- [ ] **Step 5: 커밋** — `feat(assign): write a caption and require one before confirming a table or figure — 캡션 써 넣기와 캡션 없는 묶음 확정 막기`

### Task 16: Shape·우클릭 — 캡션 줄과 붙이기·떼기

**Files:**
- Modify: `frontend/src/lib/assign-context-menu-model.ts` (액션 `caption_attach_prev`·`caption_attach_next`·`caption_detach`, `AssignMenuContext.prevBundle`·`nextBundle`, `EDITABLE_KINDS`에 `caption`, `SHAPE_LINE_ACTIONS`), `frontend/src/components/assign/assign-context-menu.tsx` (아이콘·라벨), `frontend/src/app/bundles/[id]/assign/page.tsx` (`rowViewUnits`에 묶음의 캡션 단위, `runUnitAction`의 세 액션 → `attach_caption`/`detach_caption`), `frontend/src/lib/api-sop.ts`(편집 op 타입), `frontend/src/lib/i18n-messages.ts` (`assign.ctx.captionAttachPrev`·`captionAttachNext`·`captionDetach`, 까닭 `assign.ctx.why.captionExists`·`notAdjacent`), `frontend/public/manual/user-manual.md`, `frontend/scripts/pw-smoke-sop.mjs`
- Test: `frontend/src/lib/assign-context-menu-model.test.ts`

**Interfaces:**
- Consumes: `AttachCaptionOp`·`DetachCaptionOp`(Task 11).
- Produces: 글 단위 대상 — 바로 앞(뒤)이 표·행·그림이면 **Use as caption of the table above / below**(`caption_attach_prev`/`next`). 묶음 대상 — 바로 앞(뒤) 단위가 글 단위면 **Attach the sentence above / below as caption**(같은 두 액션, 대상과 이웃을 바꿔 보낸다). 캡션 대상 — **Detach caption**과 문장 도구(나누기·언어·KO/EN 짝 나누기). 막는 까닭은 지금 규칙(`readOnly` → `unsaved`, 같은 언어 캡션이 있으면 `captionExists`). 할 수 없는 도구는 Shape에서 숨기고(`SHAPE_HIDDEN_REASONS`), 지금 못 하는 것은 흐리게 + 툴팁.

- [ ] **Step 1: 실패하는 시험**

```ts
it("offers to attach the sentence above as caption of a table", () => {
  const menu = buildAssignMenu(ctx({ target: table, table, prev: sentence }));
  expect(menu.edit.map((item) => item.action)).toEqual(["table_rows", "table_layout", "caption_attach_prev"]);
});
it("offers detach on a caption and blocks it while a draft is open", () => {
  expect(find(ctx({ target: caption }), "caption_detach").enabled).toBe(true);
  expect(find(ctx({ target: caption, hasDraft: () => true }), "caption_detach").reasonKey).toBe("assign.ctx.why.unsaved");
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/assign-context-menu-model.test.ts` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인** — vitest PASS, 스모크 새 단계 `"assign: attach and detach a caption from Shape"`(OLD-7 캡션 없는 표 앞 문장을 붙이고 → 머리 줄에 그 글 → 떼기 → Caption needed), `ONLY="assign:"` PASS.
- [ ] **Step 5: 단계 마감 + 커밋** — 전체 스모크·감사 넷, `npm version patch`, CHANGELOG, 제품 명세 §6.4·§7.2·§7.13의 표·그림 문장을 이 설계에 맞게 고친다. `feat(assign): attach and detach captions from Shape and the right-click menu — Shape·우클릭에서 캡션 붙이기·떼기`

---

## Phase 3 — 참조와 번호 다시 매기기

### Task 17: 번호·참조 읽기 (순수)

**Files:**
- Create: `backend/app/sop/renumber.py`
- Test: `backend/tests/test_sop_renumber.py`

**Interfaces:**
- Produces:

```python
CaptionKind = Literal["table", "figure"]

@dataclass(frozen=True)
class NumberToken:
    kind: CaptionKind
    number: int
    start: int  # 숫자 글자의 시작 — 바꿀 때 숫자만 바꾼다("Fig." 꼴은 그대로)
    end: int

@dataclass(frozen=True)
class PlaceToken:
    kind: CaptionKind
    direction: Literal["next", "previous"]  # 아래 표·the following table → next, 위 그림·the figure above → previous
    start: int
    end: int

def read_caption_number(text: str) -> NumberToken | None  # 캡션 머리(Task 7 정규식과 같은 꼴, 같은 상수를 docx_reader가 가져다 쓴다)
def find_number_tokens(text: str) -> list[NumberToken]  # 글 안 어디든: 표 n·Table n·그림 n·Figure n·Fig. n·Fig n, "표 1~3"은 1과 3 둘
def find_place_tokens(text: str) -> list[PlaceToken]  # 아래/위/다음 표·그림, the following/above/below table/figure
def replace_numbers(text: str, changes: Mapping[tuple[int, int], int]) -> str  # (start, end) → 새 번호, 뒤에서부터 바꾼다
def format_caption_prefix(kind: CaptionKind, number: int, lang: str) -> str  # "표 3. " | "Table 3. " | "그림 3. " | "Figure 3. "
```
- 정규식 상수는 이 모듈에 두고 `docx_reader`가 가져다 쓴다(두 벌 금지). `표 1에`처럼 조사가 붙은 참조는 참조로 잡는다(캡션 머리만 조사를 거른다).

- [ ] **Step 1: 실패하는 시험**

```python
def test_reads_caption_head_numbers():
    assert read_caption_number("Fig.6 Lid lock") == NumberToken("figure", 6, 4, 5)
    assert read_caption_number("표 1에 따라") is None

def test_finds_numbered_references_in_both_languages():
    tokens = find_number_tokens("운전 조건은 표 3을 따르고 See Figure 5 and Fig. 6.")
    assert [(t.kind, t.number) for t in tokens] == [("table", 3), ("figure", 5), ("figure", 6)]

def test_finds_place_references():
    assert [(t.kind, t.direction) for t in find_place_tokens("회전 속도는 아래 표를 따른다. See the figure above.")] == [("table", "next"), ("figure", "previous")]

def test_replace_numbers_changes_only_digits():
    assert replace_numbers("See Fig. 6 and 표 3", {(8, 9): 2, (16, 17): 1}) == "See Fig. 2 and 표 1"
```
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_renumber.py -q` → FAIL.
- [ ] **Step 3: 구현** — `docx_reader`의 두 캡션 정규식을 이 모듈 것으로 바꾼다(`tests/test_sop_docx_reader.py` 그대로 PASS).
- [ ] **Step 4: 통과 확인** — `tests/test_sop_renumber.py tests/test_sop_docx_reader.py -q` PASS.
- [ ] **Step 5: 커밋** — `feat(sop): read caption numbers and table/figure references — 캡션 번호와 표·그림 참조 읽기`

### Task 18: 참조 연결 저장·잡기·고치기 (Alembic 0021)

**Files:**
- Modify: `backend/app/sop/models.py` (새 `CaptionRef`), Create `backend/alembic/versions/0021_caption_refs.py`, Create `backend/app/sop/caption_refs.py`, Modify `backend/app/sop/units.py` (`create_initial_units` 끝, 옛 문서만), `backend/app/routers/sop_documents.py` (`ViewUnitOut.caption_refs`, 새 `PATCH …/caption-refs/{ref_id}`), `frontend/src/lib/i18n-messages.ts` (`rule.caption_ref_not_found`, `rule.invalid_caption_ref_target`)
- Test: `backend/tests/test_sop_caption_refs.py`(새로), `backend/tests/test_migrations.py`

**Interfaces:**
- Produces:

```python
class CaptionRef(Base):
    """원문 글 안의 표·그림 참조 하나 — 자리는 블록 좌표라 단위 편집이 지나가도 옮길 일이 없다(그 자리를 덮는 활성 단위가 참조 문장)."""
    __tablename__ = "caption_refs"
    id: int  # PK
    extraction_id: int  # FK extractions CASCADE, index
    block_id: int  # FK source_blocks CASCADE
    start: int; end: int  # 블록 안 토큰 범위(번호 참조는 숫자 글자, 자리 참조는 구 전체)
    kind: str  # String(6): table | figure
    number: int | None  # 원문 번호 — 자리 참조는 None
    target_table_id: int | None  # FK source_tables CASCADE — 표 참조의 대상
    target_block_id: int | None  # FK source_blocks CASCADE — 그림 참조의 대상(그림 블록)
    state: str  # String(8): linked | detached
    origin: str  # String(5): auto | human
```
  - `caption_refs.detect_caption_refs(session: AsyncSession, extraction_id: int) -> int` — 활성 글 단위(`sentence`·`heading`·`cell_sentence`)의 범위 글자에서 토큰을 찾아 쓴다. 번호 참조는 같은 추출의 캡션 단위 중 `read_caption_number`가 같은 (종류, 번호)인 묶음이 정확히 하나면 그 표(`table_id`)·그림 블록, 없거나 둘 이상이면 대상 없이 `linked`(경고는 Task 19). 자리 참조는 정렬 키로 바로 뒤(앞)의 같은 종류 묶음. 캡션 단위 자기 머리 번호는 참조가 아니다.
  - `caption_refs.update_caption_ref(session, bundle: Bundle, document: Document, ref_id: int, payload: CaptionRefIn, actor: str) -> CaptionRefOut` — `CaptionRefIn { state: Literal["linked","detached"] | None; target_unit_id: DbId | None }`; 대상 단위는 같은 추출의 `BUNDLE_UNIT_KINDS`이고 종류가 맞아야(422 `invalid_caption_ref_target`), 없는 ref는 404 `caption_ref_not_found`. 고치면 `origin="human"`. 라우트는 `ensure_editable`·`lock_bundle`(되돌리기 줄에는 서지 않는다 — 짝 라우트와 같다).
  - `ViewUnitOut.caption_refs: list[ViewCaptionRefOut] = []` — `{id, kind, number, target_unit_id: int | None, state, origin}`, 참조 자리를 덮는 단위에 싣는다(대상 단위는 표 id → 활성 `table`(행으로 나눴으면 가장 작은 행), 그림 블록 → 그림 단위).
  - 0021: 표 만들기 + 옛 문서 최신 추출 백필(토큰 정규식을 파일 안에 얼려 둔다, `app.sop` 가져오기 금지).

- [ ] **Step 1: 실패하는 시험**

```python
async def test_upload_links_numbered_and_place_references(...):
    view = await read_view(old7)
    ref = only(unit_by_text(view, "운전 조건은 표 3을 따른다.").caption_refs)
    assert (ref.kind, ref.number, ref.target_unit_id) == ("table", 3, table_unit_with_caption("표 3."))
    place = only(unit_by_text(view, "회전 속도는 아래 표를 따른다.").caption_refs)
    assert place.number is None and place.target_unit_id == captionless_table_unit
    assert only(unit_by_text(view, "표 9 참조.").caption_refs).target_unit_id is None

async def test_ref_follows_the_sentence_through_a_split(...): # 나누기 뒤 토큰이 든 쪽 단위에 실린다
async def test_human_relink_and_detach(...): # origin human, state detached
async def test_relink_to_wrong_kind_is_rejected(...): code == "invalid_caption_ref_target"
```
`test_migrations.py`: `test_0021_backfills_references_for_old_documents`.
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_caption_refs.py tests/test_migrations.py -q -k "caption_ref or 0021"` → FAIL.
- [ ] **Step 3: 구현** — `alembic revision --autogenerate --rev-id 0021 -m "caption refs"` 뒤 백필을 손으로 더하고 생성물을 검토한다.
- [ ] **Step 4: 통과 확인** — 두 파일 PASS, `test_models_match_migrations` PASS, 전체 `-n auto` PASS.
- [ ] **Step 5: 커밋** — `feat(sop): link table and figure references on upload and let people fix them — 표·그림 참조 연결 잡기와 고치기 (0021)`

### Task 19: 결과물에서 번호 다시 매기기 + 검토 경고

**Files:**
- Modify: `backend/app/sop/snapshot.py` (`UnitInfo.spans`, `BundleSnapshot.caption_refs: tuple[CaptionRefInfo, ...]`, 질의 하나), `backend/app/sop/outputs.py` (새 `build_renumbering`, `_build_item`·A 새 문장 칸·`build_composed_doc`·`ReviewFacts.caption_ref_warnings`), `backend/app/sop/review.py` (`evaluate_readiness` notices), `backend/app/sop/sheet_model.py`(옮겨 쓰기만 — 바뀐 글은 CItem·ARow에서 온다)
- Test: `backend/tests/test_sop_outputs.py`, `backend/tests/test_sop_review.py`, `backend/tests/test_sop_excel.py`, `backend/tests/test_sop_snapshot.py`

**Interfaces:**
- Consumes: `renumber.*`(Task 17), `CaptionRef`(Task 18).
- Produces:

```python
@dataclass(frozen=True)
class CaptionRefWarning:
    code: Literal["caption_ref_broken", "caption_ref_order", "caption_ref_unresolved", "caption_ref_ambiguous", "caption_ref_text_changed"]
    target_id: int | None  # 참조 새 문장(있으면)
    unit_id: int  # 참조 원문 단위

@dataclass(frozen=True)
class Renumbering:
    numbers: Mapping[int, int]  # 표·그림 새 문장 id → 새 번호(새 문서마다, 종류마다, C 순서로 1부터)
    texts: Mapping[int, str]  # 새 문장 id → 결과물에 쓸 글(바뀐 것만 — 캡션 새 문장과 참조 새 문장)
    changes: Mapping[int, tuple[str, str]]  # 표·그림 새 문장 id → ("표 1", "표 3"), 같으면 키 없음, 원문 번호가 없으면 ("", "표 3")
    warnings: tuple[CaptionRefWarning, ...]

def build_renumbering(index: _Index, labels: OutputLabels) -> Renumbering
```
  - 순서: `_plan_sections`의 새 문서별 칸·순서 그대로, 칸 새 문장 제외. 행으로 나눈 표는 표 새 문장 하나가 하나.
  - 캡션 새 문장: 글 머리 번호(`read_caption_number`)가 있으면 숫자만 새 번호로, 없으면 `format_caption_prefix`를 앞에 붙인다.
  - 참조 새 문장: 출처 단위 범위 안의 `linked` 참조마다, 대상 묶음 단위를 출처로 가진 표·그림 새 문장이 같은 새 문서에 정확히 하나면 그 번호로 — 확정 글(없으면 AI 글)에서 `find_number_tokens`로 (종류, 원문 번호)가 같은 토큰만 바꾼다. 경고: 대상 새 문장이 그 문서에 없음 → `caption_ref_broken`, 둘 이상이거나 같은 (종류, 번호) 참조가 서로 다른 대상을 가리킴 → `caption_ref_ambiguous`(바꾸지 않음), 대상 없음 → `caption_ref_unresolved`, 글에 그 토큰이 없음 → `caption_ref_text_changed`(바꾸지 않음), 자리 참조의 대상이 그 새 문장 바로 뒤(앞)가 아님 → `caption_ref_order`. `detached`는 보지 않는다.
  - C의 `CItem.text`·A의 `confirmed_text`(새 문장 칸)·`ComposedItem.text`가 `texts`를 쓰고, `ComposedItem.renumber: RenumberOut | None`(`{from_label, to_label}`)이 `changes`를 싣는다. 확정 글(DB)은 바꾸지 않는다.
  - `ReviewFacts.caption_ref_warnings: tuple[CaptionRefWarning, ...]` → `evaluate_readiness`가 코드마다 notice 하나 `{"code": <code>, "count": n, "unit_ids": [...]}`(막지 않는다).

- [ ] **Step 1: 실패하는 시험**

```python
def test_tables_and_figures_renumber_per_document_in_output_order(...):
    renum = build_renumbering(index, LABELS["ko"])
    assert renum.numbers == {table3_target: 1, table4_target: 2, figure5_target: 1, figure6_target: 2}
    assert renum.texts[table3_caption_target].startswith("표 1. 운전 조건")
    assert renum.changes[table3_target] == ("표 3", "표 1")

def test_reference_sentence_follows_the_new_number(...):
    assert renum.texts[ref_target("운전 조건은 표 3을 따른다.")] == "운전 조건은 표 1을 따른다."

def test_written_caption_without_number_gets_a_prefix(...): ("", "표 2"), text "표 2. 운전 조건"
def test_reference_to_a_deleted_table_is_broken(...): code caption_ref_broken, 글 그대로
def test_ambiguous_reference_is_left_and_warned(...): code caption_ref_ambiguous, 글 그대로
def test_edited_text_without_token_is_left_and_warned(...): code caption_ref_text_changed
def test_place_reference_out_of_order_warns(...): code caption_ref_order
def test_confirmed_text_is_never_rewritten(...): DB 행의 confirmed_text 그대로
def test_review_notices_carry_caption_ref_warnings(...): notices에 {"code": "caption_ref_broken", "count": 1}
def test_excel_c_uses_renumbered_caption(...): ...
```
- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_outputs.py tests/test_sop_review.py tests/test_sop_excel.py tests/test_sop_snapshot.py -q -k "renumber or caption_ref"` → FAIL.
- [ ] **Step 3: 구현** — 스냅숏 질의는 표마다 한 번(질의 수가 단위 수와 무관한 규칙).
- [ ] **Step 4: 통과 확인** — 네 파일 PASS, 전체 `-n auto` PASS.
- [ ] **Step 5: 커밋** — `feat(outputs): renumber tables and figures per new document and follow references — 새 문서마다 표·그림 번호와 참조 다시 매기기`

### Task 20: 화면 — 참조 연결 고치기, "표 1 → 표 3", 검토 경고

**Files:**
- Create: `frontend/src/components/assign/caption-ref-list.tsx`, `frontend/src/lib/caption-ref-model.ts`, `frontend/src/lib/caption-ref-model.test.ts`
- Modify: `frontend/src/lib/api-sop.ts` (`ViewUnit.caption_refs`, `updateCaptionRef`, `ComposedItem.renumber`), `frontend/src/app/bundles/[id]/assign/page.tsx` (Shape 아래 `CaptionRefList` — REF 카드 자리 꼴), `frontend/src/components/assign/new-bundle.tsx`·`new-pane.tsx` (캡션 앞 `표 1 → 표 3` 또는 `+ 표 3`), `frontend/src/components/outputs/output-c.tsx`(같은 표시), `frontend/src/app/bundles/[id]/page.tsx` (439 옆 notice 다섯), `frontend/src/lib/i18n-messages.ts` (`notice.captionRefBroken` 등 다섯, `assign.captionRef.*`), `frontend/public/manual/user-manual.md`, `frontend/scripts/pw-smoke-sop.mjs`
- Test: `frontend/src/lib/caption-ref-model.test.ts`

**Interfaces:**
- Consumes: `PATCH /api/bundles/{id}/documents/{doc_id}/caption-refs/{ref_id}`(Task 18), `ComposedItem.renumber`(Task 19).
- Produces:
  - `updateCaptionRef(bundleId: number, docId: number, refId: number, body: { state?: "linked" | "detached"; target_unit_id?: number }): Promise<ViewCaptionRef>`
  - `describeCaptionRef(ref: ViewCaptionRef, units: ReadonlyMap<number, ViewUnit>): { label: string; targetDisplayId: string | null; missing: boolean }` — 라벨 `표 3`/`Figure 5`/`아래 표`, 대상 없음이면 `missing`.
  - `formatRenumber(change: { from_label: string; to_label: string }): string` — `"표 1 → 표 3"`, 원문 번호가 없으면 `"+ 표 3"`.
  - `CaptionRefList` props `{ refs; units; candidates: ViewUnit[]; canEdit; busy; onDetach(refId); onRelink(refId, unitId) }` — 고른 줄의 글 단위에 참조가 있을 때만. 다시 잇기는 같은 문서의 같은 종류 묶음을 `Select`로.

- [ ] **Step 1: 실패하는 시험**

```ts
it("describes a numbered reference and a missing one", () => {
  expect(describeCaptionRef(ref({ kind: "table", number: 3, target_unit_id: 9 }), units({ 9: { display_id: "OLD-7-012" } }))).toEqual({ label: "표 3", targetDisplayId: "OLD-7-012", missing: false });
  expect(describeCaptionRef(ref({ kind: "table", number: 9, target_unit_id: null }), units({})).missing).toBe(true);
});
it("formats a renumber change", () => {
  expect(formatRenumber({ from_label: "표 1", to_label: "표 3" })).toBe("표 1 → 표 3");
  expect(formatRenumber({ from_label: "", to_label: "표 3" })).toBe("+ 표 3");
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/caption-ref-model.test.ts` → FAIL.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인** — vitest·lint·tsc PASS. 스모크 새 단계 `"outputs: renumbered table and figure captions with a reference"`(OLD-7을 SOP에 배정한 데모 묶음에서 New 칸에 `표 3 → 표 1`, 결과물 C에 `표 1. 운전 조건`과 `운전 조건은 표 1을 따른다.`, 묶음 개요에 `caption_ref_unresolved` 알림). 전체 스모크 + 감사 넷(`DS=worst` T1·T2 포함) PASS.
- [ ] **Step 5: 단계 마감 + 커밋** — `npm version patch`, CHANGELOG, 제품 명세 §7.13에 번호 다시 매기기 한 줄, `docs/README.md` 인덱스에 이 계획·설계가 있는지 확인. `feat(assign): fix reference links and show renumbered captions — 참조 연결 고치기와 다시 매긴 번호 보이기`
