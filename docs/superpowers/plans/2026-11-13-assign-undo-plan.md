# Assign Undo/Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign 화면의 판단 저장을 서버 스냅숏으로 기록해 단계별 되돌리기·다시 하기(버튼 + Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, 무엇을 되돌렸는지 말하는 알림, 그 줄로 고름 복귀)를 만든다.

**Architecture:** 판단 저장 라우트가 서비스 호출 앞뒤로 묶음의 판단 행(추적 표 6개)을 덤프해 바뀐 행만 전/후 모습으로 `decision_steps`에 남긴다. undo/redo 엔드포인트는 after(또는 before)가 지금 DB와 값으로 같을 때만 반대 모습을 같은 id로 되쓴다. Assign 안의 자르기는 Split `UnitEdit`를 가리키는 단계로 들어가 Split undo/redo를 부른다. 화면은 세션 id·단계 이름·초점을 저장 요청에 싣고 알림 문구는 순수 모델로 만든다.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + Pydantic(backend, Python 3.11), Next.js 16 / React 19 / TypeScript, vitest, Playwright(시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-11-13-assign-undo-design.md`

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/assign-undo`, 브랜치 `feat/assign-undo`(origin/dev v0.16.11에서). 로컬 서버 backend **8807**, frontend **3807**(다른 세션과 겹치지 않음), DB는 scratchpad의 `undo.db`(reset_db → seed_sop_demo → seed_sop_worst 완료). backend 명령은 `/Users/hyeonjin/Documents/sop-archivist/backend/.venv/bin/python`(요구 파일 같음 확인)으로, backend/에서.
- 되돌리기 범위: 확정·보류·Clear·잇기·끊기·같은 글자 일괄 확정·New 표시·출처로 잇기·일괄 삭제·일괄 이동·Reset(문서/묶음)·Assign 자르기. 자기 저장만, 화면 세션마다, 세션당 **100단계**, **24시간** 지난 단계는 기록 때 지운다. 선형(새 저장이 그 세션의 undone 단계를 지운다).
- 비교는 행의 있고 없음 + **revision·updated_at을 뺀** 열 값. 되쓴 행의 revision은 **지금 값 + 1**(다시 넣는 행은 before 값 + 1).
- 거절 코드: `undo_conflict`(409, 어긋난 `unit_ids`), `nothing_to_undo` / `nothing_to_redo`(409, Split과 같은 코드). 자르기 되돌리기의 `confirm_required`는 묻지 않고 그대로 409로 돌려보낸다(undo/redo 본문에 `confirm` 없음).
- 알림 틀: en `"Undone: {action}{target}"` / `"Redone: {action}{target}"`, ko `"되돌렸습니다: {action}{target}"` / `"다시 했습니다: {action}{target}"`, target은 `" · OLD-1-009"` 또는 `" · {n} lines"`. 도메인 용어 Unit·Old·New는 영어.
- 새 거절 코드는 `rule.<code>` en·ko 문구를 같이 더한다. en·ko 메시지는 한 쌍(`i18n-messages.test.ts`).
- 인터랙티브 요소 `data-testid`: `assign-undo`, `assign-redo`.
- AI 페이로드·시크릿과 무관. 새 env 없음. 새 의존성 없음.
- 커밋 메시지 `type(scope): English — 한국어`, 끝에 Co-Authored-By/Claude-Session 줄. 커밋마다 `PROGRESS.md` 한 줄 갱신.
- 화면·동작을 바꾸는 커밋은 `frontend/public/manual/user-manual.md`의 Assign 조각을 같은 커밋에서 고친다.

## Review Focus

1. **같은 글자 일괄 확정 1000개 넘김** — 요청이 여러 번 나뉘어도 Ctrl+Z 한 번에 전부 되돌아가야 한다(Task 2 `test_bulk_confirm_batches_merge_into_one_step`).
2. **비우기가 묶음의 다른 줄을 보류로 번지게 한 경우** — 되돌리면 번진 줄의 상태·revision도 원래 값으로(Task 3 덤프 비교 `clear_cascade`).
3. **확정 → 비우기 → 자르기 → Ctrl+Z → Ctrl+Z** — 자르기를 되돌린 뒤 앞 단계 비우기도 되돌아가야 한다(Task 3 `test_undo_clear_after_cut_undone`).
4. **탭 두 개/새로 고침** — 새 세션이 첫 저장을 하면 옛 세션 기록은 사라지고 옛 세션 undo는 `nothing_to_undo`(Task 2 `test_new_session_prunes_old_session`).
5. **텍스트 입력 중 Ctrl+Z** — 고치는 칸에서는 브라우저 기본 되돌리기, 화면 단축키가 가로채지 않는다(Task 4 `getAssignUndoKey` 테스트).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `backend/app/sop/models.py` (수정) | `DecisionStep` 모델 |
| `backend/alembic/versions/0014_decision_steps.py` (생성) | 표 만들기 |
| `backend/app/sop/decision_steps.py` (생성) | 추적 표 정의·덤프·차이·되쓰기, 단계 기록(합치기·정리·상한), undo/redo, `UndoMetaIn`·`DecisionStepResult` |
| `backend/app/sop/decisions.py`, `match.py` (수정) | 입력 모델 4개 + `BulkMatchIn`에 `undo: UndoMetaIn \| None = None` |
| `backend/app/sop/editing.py` (수정) | `EditIn`에 `undo` |
| `backend/app/routers/sop_decisions.py`, `sop_documents.py` (수정) | 저장 라우트를 기록으로 감싸기, undo/redo 라우트 |
| `backend/tests/test_sop_decision_undo.py` (생성) | 기록·되돌리기·거절 시험 |
| `frontend/src/lib/api-sop.ts` (수정) | `UndoMeta` 실어 보내기, `undoDecision`·`redoDecision`, `DecisionStepResult` 타입 |
| `frontend/src/lib/decision-step-model.ts` (+ `.test.ts`, 생성) | 단계 이름 고르기, 알림 문구, 단축키 판정 |
| `frontend/src/lib/i18n-messages.ts` (수정) | `assign.undo`·`assign.redo`·`assign.undone*`·`assign.step.*`·`rule.undo_conflict` |
| `frontend/src/app/bundles/[id]/assign/page.tsx` (수정) | 세션 ref, 저장마다 undo 메타, 단추·단축키·알림·고름 복귀 |
| `frontend/public/manual/user-manual.md` (수정) | Assign 되돌리기 설명 |
| `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md` (수정) | Assign 되돌리기 결정 한 줄 |

---

### Task 1: 단계 표와 스냅숏 엔진

**Files:**
- Modify: `backend/app/sop/models.py` (UnitEdit 옆)
- Create: `backend/alembic/versions/0014_decision_steps.py`
- Create: `backend/app/sop/decision_steps.py`
- Test: `backend/tests/test_sop_decision_undo.py`

**Interfaces:**
- Produces:
  - `class DecisionStep(Base)`, `__tablename__ = "decision_steps"`: `id` PK, `bundle_id` FK bundles CASCADE, `actor: str(100)`, `session_key: str(64)`, `seq: int`, `op: str(24)`, `kind: str(10)` (`"snapshot"|"unit_edit"`), `state: str(8)` (`"applied"|"undone"`), `step_key: str(64)|None`, `focus: dict` JSON(`{"unit_id": int|None, "target_id": int|None}`), `unit_ids: list` JSON, `scope_label: str(200)|None`, `before: dict` JSON, `after: dict` JSON, `document_id: int|None` FK documents CASCADE, `unit_edit_id: int|None` FK unit_edits SET NULL, `created_at`. 인덱스 `(bundle_id, actor, session_key, seq)`.
  - `Snapshot = dict[str, dict[str, dict]]` — 표 이름 → 행 키 문자열 → 열 값(JSON 직렬화된).
  - `async def dump_bundle_state(session, bundle_id: int) -> Snapshot`
  - `def diff_states(before: Snapshot, after: Snapshot) -> tuple[Snapshot, Snapshot]` — 바뀐 행만 남긴 (before, after). 바뀌지 않았으면 두 쪽 다 빈 dict의 표들.
  - `def find_mismatches(expected: Snapshot, current: Snapshot) -> list[int]` — 기대와 다른 행의 unit_id들(행에 unit_id가 없으면 TargetSource/새 문장 출처로 찾지 말고 빈 목록에 넣지 않고 `-1`을 하나 넣어 "어긋남 있음"만 표시). 비교에서 `revision`·`updated_at` 열은 뺀다.
  - `async def write_state(session, bundle_id: int, target: Snapshot, current: Snapshot) -> None` — `target`에 맞춰 지우기(자식 먼저)·다시 넣기(부모 먼저, 같은 id)·고치기, revision 규칙은 Global Constraints.

- [ ] **Step 1: 추적 표 확인.** `decisions.py`·`detach.py`·`match.py`·`pair_settle.py`·`pairs.py`·`ai/adoption.py`와 `sweep_translations`가 쓰는 표를 grep해 아래 목록 밖의 판단 상태 표가 있으면 목록에 더한다(활동 기록 `bundle_events`, `target_text_history`, `unit_decision_history`, 문서 revision은 추적하지 않는다).

  | 표 | 묶음 거르기 | 키 | 열 |
  |---|---|---|---|
  | `unit_decisions` | `bundle_id` | `unit_id` | 전부 |
  | `target_sentences` | `bundle_id` | `id` | 전부 |
  | `target_sources` | target → `bundle_id` | `target_id,unit_id` | 전부 |
  | `unit_pairs` | document → `bundle_id` | `id` | 전부 |
  | `unit_pair_members` | pair → document → `bundle_id` | `pair_id,unit_id` | 전부 |
  | `ai_suggestions` | `bundle_id` | `id` | `id, result, adoption, adopted_by, adopted_at` 만(고치기만, 넣기·지우기 없음) |

  덤프는 Core `select(table.c[...])`로 읽고 datetime은 ISO 문자열로 바꾼다. 되쓸 때 열 타입을 보고 되돌린다.

- [ ] **Step 2: 실패하는 시험 쓰기** (`tests/test_sop_decision_undo.py`, `pytestmark = usefixtures("clean_sop")`, `tests.sop_helpers`의 `create_bundle`·`upload`·`put_tobe`·`save_group`·`find_unit`과 `tests.access_helpers.run_in_session` 사용)

```python
def test_diff_keeps_only_changed_rows(client): ...
    # 묶음 하나에 단위 a 확정 저장 전/후 덤프 → diff
    assert set(after_d["unit_decisions"]) == {str(a_id)}
    assert after_d["unit_decisions"][str(a_id)]["status"] == "confirmed"
    assert before_d["unit_decisions"][str(a_id)]["status"] == "unassigned"
    assert after_d["target_sentences"] and not before_d["target_sentences"]  # 새 문장은 after에만

def test_write_state_restores_deleted_target_with_same_id(client): ...
    # 확정(새 문장 T 생김) → 덤프 S1 → Clear(T 지워짐) → write_state(S1의 바뀐 부분) 
    # → T가 같은 id·같은 confirmed_text로 있고, revision == 지운 때 값 + 1
    # → dump 후 find_mismatches(S1 diff after, now) == []

def test_find_mismatches_ignores_revision_only_changes(client): ...
    # 같은 행에서 revision만 바꾼 덤프 → []
    # status를 바꾼 덤프 → [unit_id]
```

- [ ] **Step 3: 실행해 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_decision_undo.py -q` → ImportError(`app.sop.decision_steps`).

- [ ] **Step 4: 모델·리비전·엔진 구현.** 리비전은 `alembic revision --autogenerate --rev-id 0014 -m "decision steps"`로 만들고 생성물을 직접 검토한다(sqlite·postgres 둘 다 도는 타입만). `write_state` 순서: 지우기 `target_sources` → `unit_pair_members` → `target_sentences`(자식 `parent_target_id` 있는 것 먼저) → `unit_pairs`; 넣기 역순(부모 문장 먼저); 고치기는 나머지. `unit_decisions`는 단위마다 늘 있어 고치기만 생긴다.

- [ ] **Step 5: 통과 확인** — 같은 명령 → 3 passed. `ruff check app/ tests/` 깨끗.

- [ ] **Step 6: 커밋** — `feat(assign): decision step snapshots — 판단 단계 스냅숏 표와 엔진`

---

### Task 2: 저장마다 단계 기록

**Files:**
- Modify: `backend/app/sop/decision_steps.py`, `decisions.py`(`GroupSaveIn`·`BulkDecisionIn`·`ClearIn`·`ResetIn`), `match.py`(`BulkMatchIn`), `editing.py`(`EditIn`), `backend/app/routers/sop_decisions.py`, `backend/app/routers/sop_documents.py`
- Test: `backend/tests/test_sop_decision_undo.py`

**Interfaces:**
- Consumes: Task 1 `dump_bundle_state`, `diff_states`, `DecisionStep`.
- Produces:
  - `SaveOp = Literal["confirm","hold","link","unlink","mark_new","link_source"]`
  - `class UndoMetaIn(BaseModel)`: `session: str` (1–64자, `[A-Za-z0-9_-]`), `op: SaveOp | None = None`, `focus_unit_id: DbId | None = None`, `focus_target_id: DbId | None = None`, `step_key: str | None = None`(1–64자, 같은 문자 집합), `scope_label: str | None = None`(≤200자).
  - 입력 모델마다 `undo: UndoMetaIn | None = None`.
  - `async def record_snapshot_step(session, bundle: Bundle, actor: str, meta: UndoMetaIn | None, op: str, run: Callable[[], Awaitable[T]]) -> T` — meta가 없으면 `run()`만. 있으면 덤프 → run → flush → 덤프 → diff; 바뀐 것이 없으면 기록하지 않는다. 같은 세션의 마지막 단계가 applied이고 `step_key`가 같으면 그 단계에 합친다(before는 기존 것과 새 것의 합집합에서 **처음 값**, after는 **나중 값**). 아니면 새 단계(seq = 세션 최대 + 1). 기록 때: 그 세션 undone 단계 삭제, 같은 actor·bundle의 다른 세션 단계 삭제, 24시간 지난 단계 삭제, 세션 단계가 100을 넘으면 오래된 것부터 삭제. `unit_ids`는 meta.focus_unit_id가 있으면 `[그것]`, 없으면 after `unit_decisions` 키들.
  - `async def record_unit_edit_step(session, bundle: Bundle, actor: str, meta: UndoMetaIn, document_id: int) -> None` — 방금 만든 그 문서의 최신 applied `UnitEdit`을 가리키는 `kind="unit_edit"`, `op="cut"` 단계(정리 규칙 같음).
- 라우트 op: groups/save는 `meta.op`(없으면 payload.action), clear `"clear"`, bulk `"delete"`/`"move_out"`(action이 `move_external`), reset `"reset"`(dry_run이면 기록하지 않음, scope_label은 meta 값), bulk-confirm `"confirm_identical"`, edits(문서) → `record_unit_edit_step`(meta 있을 때만).

- [ ] **Step 1: 실패하는 시험 쓰기**

```python
UNDO = {"session": "s1"}

def test_each_save_route_records_one_step(client): ...
    # groups/save(op "confirm"), clear, bulk delete, reset(document), match/bulk-confirm 를 차례로 undo 메타와 함께
    # → decision_steps 행의 op 목록 == ["confirm","clear","delete","reset","confirm_identical"], 모두 applied

def test_save_without_undo_meta_records_nothing(client): ...

def test_reset_dry_run_records_nothing(client): ...

def test_bulk_confirm_batches_merge_into_one_step(client): ...
    # 같은 step_key로 bulk-confirm 두 번(서로 다른 짝) → 단계 1개, after에 두 단위 모두

def test_clear_requests_with_same_step_key_merge(client): ...

def test_new_session_prunes_old_session(client): ...
    # s1으로 저장 → s2로 저장 → s1 단계 0개, s2 단계 1개

def test_step_cap_drops_oldest(client, monkeypatch): ...
    # 상한 상수를 3으로 monkeypatch, 저장 4번 → seq가 가장 작은 단계가 지워져 3개

def test_assign_cut_records_unit_edit_step(client): ...
    # 단위 하나를 edits(op split)+undo 메타 → kind "unit_edit", unit_edit_id == 그 문서 최신 UnitEdit id
```

- [ ] **Step 2: 실패 확인** — pytest 그 파일 → 새 시험 실패(422 extra 또는 행 0개).
- [ ] **Step 3: 구현.** 상한은 모듈 상수 `MAX_STEPS_PER_SESSION = 100`, `STEP_TTL = timedelta(hours=24)`. 라우트는 `record_snapshot_step(session, ctx.bundle, ctx.login_id, body.undo, op, lambda: save_group(...))` 꼴로 감싸고 commit은 지금처럼 라우트가 한다.
- [ ] **Step 4: 통과 확인** — 그 파일 + `tests/test_sop_decisions.py tests/test_sop_reset.py tests/test_sop_match.py tests/test_sop_editing.py` 통과(기존 동작 그대로).
- [ ] **Step 5: 커밋** — `feat(assign): record a step per decision save — 판단 저장마다 단계 기록`

---

### Task 3: undo/redo 엔드포인트

**Files:**
- Modify: `backend/app/sop/decision_steps.py`, `backend/app/routers/sop_decisions.py`
- Test: `backend/tests/test_sop_decision_undo.py`

**Interfaces:**
- Consumes: Task 1 `dump_bundle_state`·`find_mismatches`·`write_state`, Task 2 단계 행, `editing.undo_edit`/`redo_edit`(`confirm=False`).
- Produces:
  - `class DecisionStepIn(BaseModel)`: `session: str`(UndoMetaIn과 같은 검증)
  - `class DecisionStepResult(BaseModel)`: `op: str`, `unit_ids: list[int]`, `focus_unit_id: int | None`, `focus_target_id: int | None`, `scope_label: str | None`, `can_undo: bool`, `can_redo: bool`
  - `async def undo_step(session, bundle: Bundle, actor: str, session_key: str) -> DecisionStepResult`, `async def redo_step(...)` 같은 꼴
  - 라우트 `POST /api/bundles/{bundle_id}/decisions/undo`, `.../decisions/redo` — `_require_author`, `lock_bundle` + `ensure_editable`, commit.
- 동작: snapshot 단계 undo는 `find_mismatches(step.after, now)`가 비어야 하고(아니면 409 `undo_conflict`, context `unit_ids`), before에 있는 unit_id의 Unit이 은퇴했으면 역시 `undo_conflict`. `write_state(step.before)` 뒤 다시 덤프해 `step.after`를 실제 모습으로 바꿔 둔다(다음 redo 비교용 — redo도 대칭). 짝 행이 바뀐 문서는 `Document.revision += 1`. `record_event(action="decision.undo"|"decision.redo", reason=op, target_ids=unit_ids)`. unit_edit 단계: 가리키는 UnitEdit이 그 문서의 최신 applied(undo) / 최저 seq undone(redo)이 아니면 `undo_conflict`, 맞으면 `undo_edit`/`redo_edit(confirm=False)` — `confirm_required`는 그대로 올라간다.

- [ ] **Step 1: 실패하는 시험 쓰기** — 덤프 비교 도우미 `assert_same_state(a, b)`(revision·updated_at 뺀 비교)를 두고:

```python
@pytest.mark.parametrize("case", ["confirm", "hold", "link", "mark_new", "link_source", "clear_cascade",
                                  "bulk_delete", "bulk_move", "reset_document", "reset_bundle", "confirm_identical_batched"])
def test_undo_restores_and_redo_reapplies(client, case): ...
    # S0 = dump → 저장(case) → S1 = dump → undo → assert_same_state(dump, S0) → redo → assert_same_state(dump, S1)

def test_undo_brings_back_ai_suggested_and_adoption(client, fake_ai): ...
    # AI 분류 적용으로 ai_suggested인 단위를 확정(adoption 기록) → undo → status ai_suggested, adoption None

def test_undo_brings_back_deleted_new_sentence_same_id(client): ...
def test_undo_restores_dissolved_pair(client): ...   # release_unit_ids로 풀린 짝이 같은 id로

def test_undo_refused_when_someone_changed_the_line(client): ...
    # s1 확정 a → 다른 작성자(헤더 다름, undo 메타 없음)가 a 보류 → s1 undo → 409 undo_conflict, unit_ids == [a], DB 그대로
def test_undo_refused_after_split_detach(client): ...
def test_undo_clear_after_cut_undone(client): ...   # 확정 → 비우기 → 자르기 → undo → undo → a 확정 상태
def test_cut_undo_with_assigned_piece_returns_confirm_required(client): ...
def test_nothing_to_undo_and_redo(client): ...
def test_other_users_session_is_invisible(client): ...  # 다른 사람이 같은 session 문자열로 undo → nothing_to_undo
def test_new_save_after_undo_drops_redo(client): ...
def test_undo_refused_while_in_review(client): ...
def test_every_decision_route_is_recorded(client): ...
    # app.routes에서 /decisions|/groups/save|/match/bulk-confirm 아래 POST 라우트 경로 집합 ==
    # 이 시험이 아는 목록(save, clear, bulk, reset, bulk-confirm, undo, redo) — 새 라우트가 생기면 여기서 걸린다
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 그 파일 전부 + 전체 `pytest tests/ -q -n auto` + ruff.
- [ ] **Step 5: 커밋** — `feat(assign): undo/redo decision steps with conflict checks — 판단 되돌리기·다시 하기와 어긋남 거절`

---

### Task 4: 프런트 API·알림 모델·문구

**Files:**
- Modify: `frontend/src/lib/api-sop.ts`, `frontend/src/lib/i18n-messages.ts`
- Create: `frontend/src/lib/decision-step-model.ts`, `frontend/src/lib/decision-step-model.test.ts`

**Interfaces:**
- Produces:
  - `interface UndoMeta { session: string; op?: SaveOp; focus_unit_id?: number; focus_target_id?: number; step_key?: string; scope_label?: string }`, `type SaveOp = "confirm" | "hold" | "link" | "unlink" | "mark_new" | "link_source"`
  - `saveGroup`·`clearDecisions`(모든 단위 요청에 같은 `step_key`)·일괄 처분·reset·`confirmMatchesInBulk`(배치마다 같은 `step_key`)·`editUnits`에 마지막 인자 `undo?: UndoMeta` — 본문의 `undo`로 싣는다.
  - `interface DecisionStepResult { op: string; unit_ids: number[]; focus_unit_id: number | null; focus_target_id: number | null; scope_label: string | null; can_undo: boolean; can_redo: boolean }`, `undoDecision(bundleId, session): Promise<DecisionStepResult>`, `redoDecision(...)`.
  - `decision-step-model.ts`:
    - `pickSaveOp(input: { action: "confirm" | "hold"; destinationKind: string | null; savedLinkIds: number[]; nextLinkIds: number[] }): SaveOp` — hold → `"hold"`; destination `link`이고 saved에 있던 id가 next에서 빠졌으면 `"unlink"`, 아니면 `"link"`; 그 밖 `"confirm"`.
    - `describeDecisionStep(result, kind: "undo" | "redo", findDisplayId: (unitId: number) => string | null, findTargetLabel: (targetId: number) => string | null): StepMessage` — Split `describeEditStep`와 같은 `StepMessage` 모양(`edit-step-model.ts`에서 import), 키 `assign.undone.what`/`assign.redone.what`, `vars.action = "assign.step.<op>"`, target: unit_ids 하나면 그 표시 번호, 여럿이면 수, 없고 focus_target_id면 그 New 라벨, reset이면 scope_label 또는 `"assign.step.wholeBundle"` 키.
    - `getAssignUndoKey(event: KeyLike, ctx: { typing: boolean; layerOpen: boolean; canEdit: boolean }): "undo" | "redo" | null` — Split `getSplitKeyAction`의 z 분기와 같은 규칙.
  - i18n(en/ko 쌍): `assign.undo` "Undo (Ctrl+Z)"/"되돌리기 (Ctrl+Z)", `assign.redo` "Redo (Ctrl+Shift+Z)"/"다시 하기 (Ctrl+Shift+Z)", `assign.undone`·`assign.redone`·`.what`(Global Constraints 문구), `assign.step.{confirm,hold,clear,link,unlink,confirm_identical,mark_new,link_source,delete,move_out,reset,cut,lines,wholeBundle}` en "Confirm, Hold, Clear, Link, Unlink, Confirm identical, Mark as New, Link as source, Delete, Move out, Reset, Cut, {n} lines, whole bundle" / ko "확정, 보류, 비우기, 잇기, 끊기, 같은 글자 일괄 확정, New로 표시, 출처로 잇기, 삭제, 밖으로 이동, 초기화, 자르기, {n}줄, 묶음 전체", `rule.undo_conflict` en "Can't undo: someone changed these lines since." / ko "되돌릴 수 없습니다: 그 뒤에 이 줄이 바뀌었습니다.", `rule.nothing_to_undo`·`rule.nothing_to_redo`는 Split에 이미 있으면 그대로 쓴다(없으면 더한다).

- [ ] **Step 1: 실패하는 vitest 쓰기**

```ts
it("names one unit by its display id", () => {
  expect(describeDecisionStep({ op: "confirm", unit_ids: [9], focus_unit_id: 9, focus_target_id: null, scope_label: null, can_undo: false, can_redo: true }, "undo", () => "OLD-1-009", () => null))
    .toEqual({ key: "assign.undone.what", vars: { action: "assign.step.confirm", target: "OLD-1-009" } });
});
it("counts several units", ...)            // target: 12
it("names a New sentence when no unit", ...) // mark_new, focus_target_id → 그 라벨
it("names reset scope or whole bundle", ...)
it("picks unlink when a saved link target is dropped", ...)
it("leaves Ctrl+Z to the text field while typing", () => {
  expect(getAssignUndoKey({ key: "z", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, { typing: true, layerOpen: false, canEdit: true })).toBeNull();
});
it("maps Ctrl+Shift+Z and ⌘+Shift+Z to redo", ...)
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/decision-step-model.test.ts`.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: 커밋** — `feat(assign): undo API client and toast model — 되돌리기 API와 알림 문구 모델`

---

### Task 5: Assign 화면 연결·설명서·화면 확인

**Files:**
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx`, `frontend/public/manual/user-manual.md`, `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`, `PROGRESS.md`

**Interfaces:**
- Consumes: Task 4 전부.

- [ ] **Step 1: 세션과 메타.** 페이지 첫 렌더에 한 번 `const undoSession = useRef(genId())`. 저장 길마다 `undo` 메타를 싣는다 — `runSave`(op = `pickSaveOp`, focus = 고른 줄의 첫 Unit), `runClear`(op 서버, `step_key = genId()` 한 번, focus = 그 줄), `confirmIdenticalAll`(배치 전체에 같은 `step_key`), `markNew`(focus_target_id), `linkAsSource`(focus = 그 Unit), 일괄 삭제·이동(BulkModal, focus 없음), Reset(scope_label = 문서 번호, 묶음 전체면 생략), `runUnitEdit`(자르기). 기록된 저장이 성공하면 `canUndo = true, canRedo = false`(로컬 상태).
- [ ] **Step 2: 단추.** `assign-bar-end` 맨 앞에 `canEdit`일 때 Undo2·Redo2 아이콘 단추(`btn icon h-7`, `Tooltip` 라벨 `assign.undo`/`assign.redo`, `aria-label` 같음, testid `assign-undo`/`assign-redo`, `disabled={busy || !canUndo}` 등). Split `split/page.tsx:680` 모양과 같게.
- [ ] **Step 3: 단축키.** `handleKey`의 `if (event.metaKey || event.ctrlKey || event.altKey) return;` 앞에서 `getAssignUndoKey`(typing = `isTypingTarget`, layerOpen = 그 위 줄의 dialog/menu/listbox 검사와 같은 조건)로 분기해 `preventDefault` 후 `runUndoStep(kind)`. 첫 `if` 블록(입력 중) 안에서는 분기하지 않는다.
- [ ] **Step 4: `runUndoStep(kind)`.** `busy`면 무시. 성공: `canUndo/canRedo`를 응답 값으로, 데이터 다시 받기(저장 뒤와 같은 새로 고침 경로), focus Unit이 있으면 `setFollow({ unitId, ... })`로 그 줄 고르기, 없고 focus_target_id면 그 New 문장 줄을 고르는 기존 길, 알림 `formatDecisionStep`(Split `formatStep`과 같은 꼴, 수는 `assign.step.lines`). 실패: `nothing_to_undo`/`nothing_to_redo`면 그 방향 단추를 끄고 알림, `confirm_required`면 `assign.ctx.why.assigned` 오류 알림, 나머지는 `humanizeApiError`.
- [ ] **Step 5: 설명서·명세.** `user-manual.md` Assign 조각에 **Undo**·**Redo** 단락: 무엇이 되돌아가는지(목록), 화면을 떠나면 기록이 사라짐, 그 사이 바뀐 줄은 거절, 텍스트 입력 중에는 글자 되돌리기. 굵은 영어 라벨은 en 문구와 같게. E2E 명세의 Assign 절에 한 줄(2026-11-13, 설계 문서 경로). `PROGRESS.md` 항목.
- [ ] **Step 6: 게이트** — `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run build`(next dev를 먼저 내리고 경고 0) 모두 통과.
- [ ] **Step 7: 화면 확인(Playwright, 8807/3807, undo.db 사본).** 묶음 2와 W1(id 5)에서: 확정 → Ctrl+Z → 알림 "Undone: Confirm · <그 Unit>"·그 줄 고름·상태 unassigned → Ctrl+Shift+Z → 다시 확정; Clear 되돌리기; 같은 글자 일괄 확정 되돌리기(진행 숫자 원래대로); Reset(문서) 되돌리기; 고치는 칸 안 Ctrl+Z가 글자만 되돌림. 1280·1920 × EN·KO에서 `pw-overlap-audit.mjs`·배치 감사(`DS=worst pw-layout-audit.mjs`, 해당 포트로)로 상단 바 겹침 없음. 스크린샷을 사용자에게 보낸다.
- [ ] **Step 8: 커밋** — `feat(assign): undo/redo buttons, shortcuts and toasts — Assign 되돌리기 단추·단축키·알림`
