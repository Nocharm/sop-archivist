# 쪼개기 먼저 1 — 되돌리기 결함 · 숨기기 · 화면 문제 · 반응속도 (스텝 0 · 1 · 2 · 2-1)

> **For agentic workers:** 차례 · 공용 이름 · 게이트 · 세우는 조건은 [색인](2026-11-25-split-first.md)이 먼저다. 이 파일은 열 브랜치의 작업만 적는다.

**Goal:** New 손질의 되돌리기가 새 문장을 중복시키지 않고, 새 문서를 만드는 기능이 화면에 없으며, 누른 글쇠가 사라지지 않고 누르는 즉시 다음 박스로 간다.

**Architecture:** 되돌리기는 `sync_new_doc_targets`가 "곧 되쓸 단위"를 건너뛰게 한다(새 쓰기 길 없음). 숨김은 화면 상수 `isDraftingOn()` 하나와 서버 상수 셋이고 코드는 지우지 않는다. Assign의 쓰기는 React 없는 `command-queue.ts`(한 줄 · 장벽 · 실패 멈춤)와 그것을 돌리는 `use-command-queue.ts`로 모은다.

**Spec:** [`2026-11-25-split-first-design.md`](../specs/2026-11-25-split-first-design.md) §4-1 · §5 · §6(S2 · S3) · §6-1 · §11-1 · §14, [`2026-11-23-assign-feedback-2.md`](../specs/2026-11-23-assign-feedback-2.md) A1 · A2 · F2-R6~R8 · S1 · S2. §6 S1(Enter)은 계획 2.

**Global Constraints:** 색인 파일. **명령 줄임** — `PY <파일>` = `cd backend && .venv/bin/python -m pytest tests/<파일> -q`(워크트리에 venv가 없으면 원본 체크아웃의 것), `VT <파일…>` = `cd frontend && npx vitest run src/lib/<파일…>`. 화면 쪽 구현 단계는 `npm run lint && npx tsc --noEmit -p tsconfig.json`까지 본다. 줄 번호는 `e704ddf8` 기준이고 밀렸으면 이름으로 찾는다(앞 브랜치가 바꾼 것은 그때 코드를 따른다). `UAP` = `frontend/src/app/bundles/[id]/assign/use-assign-page.tsx`, `PG` = 같은 폴더 `page.tsx`, `SP` = `assign-side-panel.tsx`. 하위 에이전트는 서버 · 브라우저를 띄우지 않고, 스모크 실행은 메인 세션이 한다.

## fix/new-edit-undo
- **목표** — 단계 되돌리기 · 다시 하기를 몇 번 오가도 `new_unit_id`마다 새 문장이 하나다(§4-1). 아래 T1의 시험과 고침은 임시 사본에서 돌려 봤다: 고치기 전 8가지 모두 실패, 고친 뒤 모두 통과, `test_sop_decision_undo` · `test_sop_editing` · `test_sop_match` 147개 그대로.
- **Files** — Create `backend/tests/test_sop_new_edit_undo.py`. Modify `backend/app/sop/match.py:292-325`, `editing.py:2113-2447`(`_write_change` · `_step_edit` · `undo_edit` · `redo_edit`), `decision_steps.py:592-631`(`_move_unit_edit`), `outputs.py:1710-1715`(`build_bundle_table`), `written.py:198-239`(`_load_bundle_children`), `backend/CLAUDE.md` "새 문서 새 문장 맞추기" 줄과 `docs/architecture/backend.md` 12.9.
- **Interfaces** — Consumes: 없음. Produces: `sync_new_doc_targets(…, restoring_unit_ids: Collection[int] = ())`와 `_write_change` · `_step_edit` · `undo_edit` · `redo_edit`의 같은 이름 인자.
### T1 되돌리기 · 다시 하기가 중복을 만들지 않는다
- [ ] 시험 — 다른 New 문서를 올려 id를 민다(sqlite가 id를 다시 쓰면 결함이 가려진다. 올리는 글이 매번 달라야 409 중복 파일이 안 난다).
```python
"""New 문서 편집의 단계 되돌리기 · 다시 하기 — new_unit_id마다 새 문장 하나(쪼개기 먼저 설계 §4-1)."""
pytestmark = pytest.mark.usefixtures("clean_sop")  # _undo · _redo · assert_same_state · _dump는 tests.test_sop_decision_undo의 것
K1, K2, K3, UNDO = "새 필터를 끼우고 기록지에 적는다.", "장치를 멈추고 압력을 확인한다.", "보호 장갑과 보안경을 착용한다.", {"session": "s1"}
def _setup(client) -> tuple[int, dict, dict]:  # 묶음 id, Old 문서, New 문서
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    old = upload(client, bundle_id, build_docx(p("절", "Heading1") + p(K1) + p(K2)), "SYNTHETIC_OLD-1_A.docx").json()
    table = make_grid_table(2, make_row(["항목", "내용"], header=True) + make_row(["교체", p(K1) + p(K2)]) + make_row(["준비", K3]))
    body = p("새 절", "Heading1") + p("앞 문장이다. 이어진 문장이다.") + table + p("뒤 문장이다.") + p("끝 문장이다.")
    return bundle_id, old, upload(client, bundle_id, build_docx(body), "SYNTHETIC_NEW-1_B.docx", side="new", doc_type="sop").json()
def _push_ids(client, bundle_id, n):
    data = build_docx(p("다른 절", "Heading1") + p(f"다른 문서의 문장 {n}이다."))
    assert upload(client, bundle_id, data, f"SYNTHETIC_NEW-{n}_C.docx", side="new", doc_type="sop").status_code == 201
def _edit(client, bundle_id, doc, op):  # 409 confirm_required면 confirm을 켜고 한 번 더
    for confirm in (False, True):
        revision = get_view(client, bundle_id, doc["id"])["document"]["revision"]
        r = client.post(f"/api/bundles/{bundle_id}/documents/{doc['id']}/edits", json={"revision": revision, "confirm": confirm, "op": op, "undo": UNDO}, headers=AUTHOR)
        if r.status_code != 409:
            break
    assert r.status_code == 200, r.text
def _link_cell(client, bundle_id, old, new):  # Old K1을 New K1 문장에 잇고 확정 — 칸이면 같은 표의 줄을 parent_key와 함께 되보낸다
    unit = find_unit(get_view(client, bundle_id, old["id"]), K1)
    cell_id, state = find_unit(get_view(client, bundle_id, new["id"]), K1)["id"], _dump(bundle_id)["target_sentences"]
    tid, parent = next((int(k), r["parent_target_id"]) for k, r in state.items() if r["new_unit_id"] == cell_id)
    rows = {k: r for k, r in state.items() if int(k) == tid or (parent is not None and parent in (int(k), r["parent_target_id"]))}
    targets = [{"key": k, "id": int(k), "revision": r["revision"], "kind": r["kind"], "cell_row": r["cell_row"], "cell_col": r["cell_col"],
                "source_unit_ids": [unit["id"]] if int(k) == tid else [], "parent_key": str(r["parent_target_id"]) if r["parent_target_id"] else None} for k, r in rows.items()]
    body = {"action": "confirm", "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}], "targets": targets, "undo": UNDO}
    assert save_group(client, bundle_id, body).status_code == 200
def _build_op(view, case):
    sentences = [u for u in view["units"] if u["kind"] == "sentence"]
    if case == "split":
        return {"type": "split", "unit_id": sentences[0]["id"], "at": 3}
    if case == "merge":
        at = next(i for i, u in enumerate(sentences) if u["text"] == "뒤 문장이다.")
        return {"type": "merge", "unit_ids": [sentences[at]["id"], sentences[at + 1]["id"]]}
    return {"type": "set_layout_table", "table_id": view["tables"][0]["id"], "is_layout": case == "unwrap"}
def _assert_one_each(state):
    counts = Counter(r["new_unit_id"] for r in state["target_sentences"].values() if r["new_unit_id"] is not None)
    assert [unit_id for unit_id, n in counts.items() if n != 1] == []
def _strip(rows):
    return {k: {c: v for c, v in row.items() if c not in ("revision", "updated_at")} for k, row in rows.items()}
@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("case", ["split", "merge", "unwrap", "rewrap"])
def test_undo_and_redo_keep_one_new_sentence_per_unit(client: TestClient, case: str, linked: bool) -> None:
    bundle_id, old, new = _setup(client)
    _push_ids(client, bundle_id, 2)
    if case == "rewrap":
        _edit(client, bundle_id, new, _build_op(get_view(client, bundle_id, new["id"]), "unwrap"))
    if linked:
        _link_cell(client, bundle_id, old, new)
    before = _dump(bundle_id)
    _edit(client, bundle_id, new, _build_op(get_view(client, bundle_id, new["id"]), case))
    _push_ids(client, bundle_id, 3)
    after = _dump(bundle_id)
    for _ in range(2):  # 여러 번 오간다
        assert _undo(client, bundle_id).status_code == 200
        undone = _dump(bundle_id)
        _assert_one_each(undone)
        for name in ("target_sentences", "target_sources", "unit_decisions"):  # 이음과 확정까지 되살아난다
            assert _strip({k: undone[name].get(k, {}) for k in before[name]}) == _strip(before[name])
        assert _redo(client, bundle_id).status_code == 200  # 이은 칸이 있어도 409 confirm_required가 아니다
        _assert_one_each(_dump(bundle_id))
        assert_same_state(_dump(bundle_id), after)
```
- [ ] 실패 확인 `PY test_sop_new_edit_undo.py` — 8개 모두 중복 목록이 비지 않는다.
- [ ] 구현: `_move_unit_edit`에서 `settled`에 `expected["target_sentences"]`의 `new_unit_id`(None 아닌 것)를 더하고, `restore["target_sentences"]`의 `new_unit_id`를 `restoring_unit_ids`로 넘긴다. `sync_new_doc_targets`는 그 단위를 `missing`에서 빼고 `_refresh_targets`에도 넘기지 않는다(부모 표 새 문장을 아직 되쓰지 않은 칸이 `ids_by_unit`에서 터지지 않게). 은퇴 정리(`detach_units`)는 그대로, `edits/undo`는 인자를 주지 않아 지금과 같다.
- [ ] 통과 확인 `PY test_sop_new_edit_undo.py` · `PY test_sop_decision_undo.py` · `PY test_sop_editing.py` · `PY test_sop_match.py` → 커밋 `fix(undo): restore New sentences once when an edit step moves — New 편집 되돌리기가 새 문장을 중복시키지 않음`
### T2 표 칸 안 문장 순서는 Unit 순서다
- [ ] 시험(지금은 칸 문장을 나누기만 해도 새 문장 id 순으로 뒤섞인다 — 임시 사본에서 확인):
```python
def test_cell_sentences_follow_unit_order_after_split_and_edit_undo(client: TestClient) -> None:
    bundle_id, _, new = _setup(client)
    _push_ids(client, bundle_id, 2)
    def read_cell() -> list[str]:
        rows = client.get(f"/api/bundles/{bundle_id}/written-sentences", headers=AUTHOR).json()
        table = next(row for row in rows if row["kind"] == "table")
        return [c["text"] for c in table["table"]["cells"] if (c["row"], c["col"]) == (1, 1)]
    assert read_cell() == [K1, K2]
    unit = find_unit(get_view(client, bundle_id, new["id"]), K1)
    _edit(client, bundle_id, new, {"type": "split", "unit_id": unit["id"], "at": 4})
    assert read_cell() == ["새 필터", "를 끼우고 기록지에 적는다.", K2]
    revision = get_view(client, bundle_id, new["id"])["document"]["revision"]
    undo = client.post(f"/api/bundles/{bundle_id}/documents/{new['id']}/edits/undo", json={"revision": revision}, headers=AUTHOR)
    assert undo.status_code == 200 and read_cell() == [K1, K2]
```
- [ ] 실패 확인 `PY test_sop_new_edit_undo.py -k unit_order` — 나눈 뒤 `[K2, "새 필터", …]` → 구현: `_load_bundle_children` 질의가 `new_unit_id`의 `Unit`을 outer join해 `(Unit.pos_seq, Unit.pos_start, Unit.id)`, 없으면 새 문장 id 순으로 읽는다(질의 수 그대로, 캡션도 같은 질의). `build_bundle_table`은 `(row, col)`만으로 안정 정렬한다 — 결과물 쪽 `build_item`은 이미 id 순으로 넘겨 그대로다.
- [ ] 통과 확인 `PY test_sop_new_edit_undo.py` · `PY test_sop_written.py` · `PY test_sop_outputs.py` → 커밋 `fix(written): order cell sentences by their unit — 칸 문장 순서를 Unit 순서로`
### T3 운영 중복을 세는 읽기 전용 질의(문서만, 시험 없음)
- [ ] `docs/deploy/db-viewer-readonly.md`에 `select new_unit_id, count(*) from target_sentences where new_unit_id is not null group by 1 having count(*) > 1;`(글 열을 고르지 않는다) → 커밋 `docs(deploy): read-only query for duplicated New sentences — New 문장 중복을 세는 조회`
- **스모크** 새 단계 없음, `ONLY="assign: shape a written New sentence in place"`가 그대로 통과. **설명서** 없음. **CHANGELOG** `New 문서를 손질한 뒤 Ctrl+Z · 다시 하기를 해도 New 문장이 두 벌이 되지 않음. 표 칸 안 문장은 원문 순서.`
- **세워 둘 조건** ① 고침이 기존 `TargetSentence` 행을 지우거나 합쳐야 풀린다(운영 정리는 따로 승인). ② 지금 통과하던 되돌리기 시험에서 `undo_conflict`가 새로 난다.

## feat/hide-drafting
- **목표** — 새 문서를 만드는 길과 그 곁 기능이 화면에 없고, 서버는 자동 칸 추천과 삭제 후보를 내지 않으며, 숨긴 자료가 있는 묶음도 배정 취소 · 검토 요청까지 간다(§5 H1–H5).
- **Files** — Create `frontend/src/lib/drafting.ts` · `.test.ts`, `lib/translation-decision.ts` · `.test.ts`, `backend/tests/test_sop_hidden_drafting.py`. Modify backend `app/sop/ai/constants.py`, `ai/prepare.py:59-85`, `ai/match_jobs.py:174-192,701-704`, `app/sop/sheet_model.py:39,568-576`, `tests/conftest.py`(픽스처 둘), `backend/CLAUDE.md` · `docs/architecture/backend.md`의 11.7 · 11.9 줄. Modify frontend `lib/stages.ts`, `components/stage-nav.tsx:67`, `components/manual/manual-unit.tsx:28`, `app/bundles/[id]/page.tsx:234`, `order/page.tsx`, `lib/ai-suggestion-model.ts` · `ai-accept-model.ts` · `classify-model.ts:139` · `assign-model.ts:76` · `tobe-add-model.ts` · `outputs-view-prefs.ts`(각 `.test.ts`), UAP `316-319,372,591-605,669,739,827-841,3383,3448`, PG `404-480,704,787`, SP `165-206,420-510,590-620`, `components/assign/{destination-tree,new-pane,assign-help,accept-suggestions-modal}.tsx`, `components/tobe/{tobe-section:572-710,tobe-panel:251-290,tobe-row:125-180}.tsx`, `components/outputs/outputs-workspace.tsx:133,499-520`, `i18n-messages.ts:941,2968`, `scripts/smoke/*.mjs`, `scripts/pw-overlap-audit.mjs:420`, `docs/qa/feature-map.md`.
- **Interfaces** — Consumes: 없음. Produces: `isDraftingOn(): boolean`, `useDraftingOn(): boolean | null`(서버 렌더 · 하이드레이션 중 null), `listStages(drafting: boolean): readonly Stage[]`, `HIDDEN_AI_KINDS: ReadonlySet<string>`, `dropHiddenSuggestions<T extends { kind: string }>(items: readonly T[], drafting: boolean): readonly T[]`, `AUTO_CLASSIFY = False` · `PLAN_DELETES = False`, `SHOW_C_SHEET = False` · `get_sheet_names() -> tuple[str, ...]`, 픽스처 `hidden_ai_on` · `c_sheet_on`, 스모크 `runStep(name, { drafting: true }, …)`.
### T1 숨김 상수와 단계 이동
- [ ] 시험 `drafting.test.ts` · `stages.test.ts`:
```ts
it("is off by default and on only with sopa.drafting = 1 outside production", () => {
  expect(isDraftingOn()).toBe(false); localStorage.setItem("sopa.drafting", "1"); expect(isDraftingOn()).toBe(true);
  localStorage.setItem("sopa.drafting", "true"); expect(isDraftingOn()).toBe(false); });
it("a production build never turns it on", () => { vi.stubEnv("NODE_ENV", "production"); localStorage.setItem("sopa.drafting", "1"); expect(isDraftingOn()).toBe(false); });
it("drops Order and renumbers Outputs while drafting is hidden", () => {
  expect(listStages(false).map((s) => [s.key, s.step])).toEqual([["overview", undefined], ["documents", 1], ["assign", 2], ["outputs", 3], ["map", undefined], ["history", undefined]]);
  expect(listStages(true)).toEqual(STAGES); expect(parseBundlePath("/bundles/12/order")).toEqual({ bundleId: 12, stage: "order" }); }); // 주소 읽기는 그대로
```
- [ ] 실패 확인 `VT drafting.test.ts stages.test.ts` → 구현: 저장소가 막히면 false. `useDraftingOn`은 `useSyncExternalStore(storage 구독, isDraftingOn, () => null)`(이펙트 없음). 쓰는 곳은 `=== true`로 읽고, `/order`의 page만 null이면 아무것도 그리지 않고 false면 `redirect(getStageHref(id, "assign"))` — 서버 렌더에서 먼저 넘기면 켠 개발 화면도 못 연다. → 통과 확인 같은 명령 → 커밋 `feat(drafting): one switch hides the drafting stages — 새 문서 생성 단계를 상수 하나로 숨김`
### T2 서버: 자동 칸 추천과 삭제 후보
- [ ] 시험 `test_sop_hidden_drafting.py`(도우미는 `test_sop_ai_prepare.py` · `test_sop_ai_match_plan.py`의 것을 들여온다. 괄호 안이 단언):
```python
def test_prepare_queues_no_classify_but_still_a_plan(client, auto_prepare): ...      # post_prepare(...).json()["queued"] == 0; read_jobs("classify") == []; len(read_jobs("match_plan")) == 1
def test_requested_classify_still_queues(client, fake_ai): ...                       # POST /ai/classify {"unit_ids": [u]} 성공, len(read_jobs("classify")) == 1
def test_plan_ignores_a_live_classify_suggestion(client, fake_ai): ...               # 계획 뒤 find_live(unit_id=u).kind == "match"; 그 classify 행의 (result, adoption) == ("applied", None)
@pytest.mark.parametrize("has_assign_doc", [False, True])
def test_plan_writes_no_delete_candidate(client, fake_ai, has_assign_doc): ...       # [s for s in read_rows(AiSuggestion) if s.content["shape"] == "delete_candidate"] == []
def test_replan_leaves_an_existing_delete_candidate(client, fake_ai, monkeypatch): ...  # PLAN_DELETES를 켜고 계획 → 끄고 다시 계획: 같은 id, result == "applied", 새 delete_candidate 0
```
- [ ] 실패 확인 `PY test_sop_hidden_drafting.py` → 구현: 상수는 `constants.AUTO_CLASSIFY`처럼 모듈로 읽어 시험이 `monkeypatch`로 켤 수 있게 한다. `queue_prepare`는 계획을 쌓은 뒤 `AUTO_CLASSIFY`가 거짓이면 `[]`. `_load_old_entries`의 `classified`는 거짓이면 빈 집합. 삭제 후보는 **있는 거르기를 넓힌다** — `changed`에서 새 `delete_candidate`를 빼는 조건이 `origin == PLAN_ORIGIN_UPLOAD or not PLAN_DELETES`(있는 행은 `kept`로 남아 stale이 되지 않는다).
- [ ] 옛 시험은 기대를 바꾸지 않고 픽스처 `hidden_ai_on`(두 상수 True)만 붙인다: `test_sop_ai_prepare.py` 전체(`pytestmark`), `test_sop_ai_recent.py` `test_recent_marks_requests_with_background_jobs` · `test_recent_keeps_the_mark_after_promotion`, `test_sop_ai_match_plan.py` `test_units_with_a_classify_suggestion_are_excluded` · `test_prepare_origin_plan_writes_delete_candidates` · `test_same_vector_across_languages_never_pairs` · `test_unmatched_old_is_delete_candidate_only_without_assign_docs` · `test_embedding_threshold_differs_from_the_text_threshold` · `test_blank_units_stay_unassigned` · `test_table_without_text_stays_unassigned` · `test_scores_are_not_stored` · `test_suggestions_are_read_as_kind_match` · `test_rerun_keeps_unchanged_suggestions` · `test_rerun_that_finds_a_pair_clears_the_old_suggestions` · `test_replan_of_a_changed_table_marks_its_suggestion_stale` · `test_replan_keeps_unchanged_groups` · `test_upload_plan_keeps_existing_delete_candidates` · `test_upload_plan_clears_delete_candidates_once_assign_documents_exist` · `test_person_confirms_plan_suggestions_through_group_save` · `test_person_change_during_plan_is_left_alone`, `test_sop_ai_match_pair.py` `test_human_changing_sources_records_edited` · `test_giving_a_new_target_a_source_records_edited` · `test_confirming_delete_candidate_without_a_reason` · `test_confirming_delete_candidate_records_as_is` · `test_moving_a_delete_candidate_records_rejected`, `test_sop_ai_accept.py` `test_new_and_delete_candidates_ride_the_match_accept`. 임시 사본에서 상수를 끄고 전체를 돌려 깨진 목록이다 — 이 밖이 깨지면 세운다.
- [ ] 통과 확인 `PY test_sop_hidden_drafting.py` → `.venv/bin/python -m pytest tests/ -q -n auto` → 커밋 `feat(ai): stop automatic classify and plan delete candidates — 자동 칸 추천과 계획의 삭제 후보를 멈춤`
### T3 Excel C 시트
- [ ] 시험(§14 승인 자리만 고침): `test_sop_excel.py:246` · `test_sop_e2e.py:219` `== ["A Comparison", "B Flow", "Info", "Documents"]`, `test_sop_excel.py:519,588,594`는 `list(get_sheet_names())`. C 내용은 픽스처 `c_sheet_on`으로 그대로: `test_sop_excel.py`의 `test_sheet_c_*` 셋 · `test_excel_c_*` 둘 · `test_c_sheet_has_deviation_reason_column` · `test_preview_of_an_empty_bundle`(590) · `test_preview_a_carries_fit_widths_bands_and_column_keys`, `test_sop_numbering.py` `test_bullet_lines_take_no_number_and_show_their_section_number_in_a` · `test_excel_leaves_unnumbered_cells_empty_and_italicizes_notes`, `test_migrations.py` `test_0020_moves_figure_caption_to_its_own_unit_and_target`. 새 시험 `test_workbook_hides_the_c_sheet_by_default`: `"C New documents" not in _load(client, bundle_id).sheetnames` 그리고 미리 보기 시트 이름 == 파일 시트 이름.
- [ ] 실패 확인 `PY test_sop_excel.py` → 구현: `SHEET_NAMES`(5개, 자리 번호로 읽힘)는 그대로 두고 `get_sheet_names()`가 상수에 따라 넷 · 다섯, `build_workbook_model`이 C를 건너뛴다. → 통과 확인 `PY test_sop_excel.py` · `PY test_sop_numbering.py` · `PY test_migrations.py` · `PY test_sop_e2e.py` → 커밋 `feat(excel): leave the C sheet out while drafting is hidden — 숨긴 동안 Excel C 시트를 뺌(설계 §14 승인: 시트 수 5 → 4)`
### T4 숨긴 AI 종류
- [ ] 시험 `ai-suggestion-model.test.ts` · `ai-accept-model.test.ts`:
```ts
expect([...HIDDEN_AI_KINDS].sort()).toEqual(["classify", "split", "tobe_list", "translate"]);
expect(dropHiddenSuggestions([{ kind: "classify" }, { kind: "split" }, { kind: "match" }, { kind: "unwrap_order" }], false).map((i) => i.kind)).toEqual(["match", "unwrap_order"]);
expect(dropHiddenSuggestions(items, true)).toBe(items);
expect(countLiveOffer(dropHiddenSuggestions([liveClassify, liveMatch], false), 7)).toEqual({ classify: 0, match: 1 });
expect(listAcceptKinds(false)).toEqual(["match"]); expect(listAcceptKinds(true)).toEqual(["classify", "match"]);
expect(filterAiItems(["document", "match", "to-en", "to-ko", "split", "split-document", "pair-document"].map((key) => ({ key })), false).map((i) => i.key)).toEqual(["match", "pair-document"]);
```
- [ ] 실패 확인 `VT ai-suggestion-model.test.ts ai-accept-model.test.ts` → 구현: 숨긴 동안 `suggestions` · `invalidSuggestions` · `splitSuggestions`는 받지 않고 `[]`(요청이 셋 준다) — 박스 아래 표시 · 카드 · 위 알약 · "모두 받기" · 필터 칩 수가 함께 빈다. `assign-ai` 칸(칸 추천 요청)도 숨긴다. `useAiPrepare`는 계속 부른다(계획을 쌓는다). 관리 화면은 손대지 않는다. → 통과 확인 같은 명령 → 커밋 `feat(assign): hide classify, split, translate and list suggestions — 칸 추천 · 나누기 · 번역 · 목록 제안을 숨김`
### T5 보낼 곳 · New 칸 · 오른쪽 칸 (H2 · H3)
- [ ] 시험 `classify-model.test.ts` · `assign-model.test.ts`(문서 번호 · 칸 이름은 그 파일의 `TOBE` 값):
```ts
it("offers no place in an unwritten document while drafting is hidden", () => { expect(listPickOptions(TOBE, false)).toEqual([]); expect(listPickOptions(TOBE, true)).toEqual(buildDestinationOptions(TOBE)); });
it("still reads where a row sits in a hidden document", () => {
  expect(readHiddenPlace(slotOption.destination, buildDestinationOptions(TOBE))).toEqual({ docCode: slotOption.docCode, label: slotOption.label });
  expect(readHiddenPlace({ kind: "link", targetIds: [1] }, buildDestinationOptions(TOBE))).toBeNull(); });
it("drops recommendations into hidden documents, the band heading place too", () => {
  const recs = [rec({ kind: "link", targetIds: [1] }), rec({ kind: "slot", docId: 1, slotKey: "a" }), rec({ kind: "slot_heading", docId: 1, slotKey: "a" }), rec({ kind: "step", docId: 2, step: 1, part: "why" }), rec({ kind: "delete" })];
  expect(dropHiddenRecommendations(recs, false).map((r) => r.destination.kind)).toEqual(["link", "delete"]); });
```
- [ ] 실패 확인 `VT classify-model.test.ts assign-model.test.ts` → 구현: 고르는 목록 `options`(= `listPickOptions`)와 이름 읽기 `labelOptions`(늘 `buildDestinationOptions`)를 나눈다 — 하나로 비우면 이미 보낸 줄의 간 곳 이름이 빈 글이 된다(`renderPlaceLabel` · `placeOf` · `readAiPlace`). 숨긴 동안 `composedDocs = []`(New 문서 목록 · 클릭 배치 · 끌어 보내기 · 기본/템플릿 전환이 함께 빠지고 쓴 문서가 없으면 있는 `NewPaneEmpty`), `view.newTemplate`은 false로 읽음, All 나무의 칸 · 더하기(`placeManage`) · Nearby 칸 · `assign-edit*` · E · `assign-make-other` · `assign-write-other` 없음. 저장된 곳이 `slot | step | slot_heading | join`이면 결정 칸에 `assign.hidden.place`(en "Placed in a new document · {code} §{label} (hidden feature)" / ko "새 문서 칸에 배정됨 · {code} §{label}(숨긴 기능)", testid `assign-hidden-place`)를 읽기 전용으로, Confirm 끔. 배정 취소 · 이어 바꾸기는 지금 길. → 통과 확인 같은 명령 → 커밋 `feat(assign): hide unwritten documents and their places — 아직 쓰지 않은 문서와 그 칸을 숨김`
### T6 Documents · Outputs
- [ ] 시험 `tobe-add-model.test.ts` · `outputs-view-prefs.test.ts`:
```ts
expect(listTobeTools(false)).toEqual(["upload"]);
expect(listTobeTools(true)).toEqual(["upload", "add_row", "template", "import", "read_list", "declare", "sections", "add_step"]);
expect(resolveOutputsTab("c", false)).toBe("b"); expect(resolveOutputsTab("a", false)).toBe("a"); expect(resolveOutputsTab("c", true)).toBe("c");
```
- [ ] 실패 확인 `VT tobe-add-model.test.ts outputs-view-prefs.test.ts` → 구현: Documents의 New는 줄 · 번호 · 제목 · 상위 · 쓴 파일 붙이기 · 지우기만 남고 나머지(`tobe-add-row` · `tobe-more` 안 양식/가져오기 · `tobe-read-open` · `tobe-proposal` · `OutlineDeclare` · `SlotTable` · `SlotBar`와 채움/N/A/다름/쓰지 않음 꼬리표 · `-add-step`)는 이 목록으로 빠진다. 비면 `EmptyState` + 올리기. Outputs 탭은 A · B, `outputs-edit-order` 없음. `next.fill_tobe`: en "Upload New files" / "Upload the written New SOPs and WIs.", ko "New 파일을 올리세요" / "쓴 New SOP와 WI 파일을 올립니다." → 통과 확인 같은 명령 + `VT i18n-messages.test.ts manual-content.test.ts` → 커밋 `feat(documents): keep only written files and drop Output C — New 목록은 쓴 파일만, 결과물 C 탭 숨김`
### T7 막다른 길 없음 (H5)
- [ ] 시험:
```ts
// translation-decision.test.ts - group: 칸 새 문장 10(confirmed, 출처 1)과 그 번역 11(origin "translation", ai_suggested)
expect(buildTranslationDecision(group, [1], "confirm")).toMatchObject({ action: "confirm", removed_target_ids: [], targets: [{ id: 10 }, { id: 11 }] });
expect(buildTranslationDecision(group, [1], "remove")).toMatchObject({ action: "confirm", removed_target_ids: [11], targets: [{ id: 10 }] });
expect(buildTranslationDecision(groupWithoutTranslation, [1], "remove")).toBeNull();
// backend test_hidden_place_with_a_leftover_translation_reaches_review(client, fake_ai): 칸 확정 + 번역 제안이면 "targets_ai_suggested" in read_blocker_codes → removed_target_ids=[번역]으로 저장 200 → 그 코드 없음 → /decisions/clear 200, 줄 상태 "unassigned"
```
- [ ] 실패 확인 `VT translation-decision.test.ts` · `PY test_sop_hidden_drafting.py -k review` → 구현: `assign-hidden-place` 아래에 번역 줄(언어 · 글)과 `assign-translation-confirm` · `assign-translation-remove`, 저장은 지금 `saveGroup` 길(되돌리기 한 번). → 통과 확인 같은 명령 → 커밋 `feat(assign): settle leftover AI translations from the side panel — 남은 AI 번역 줄을 오른쪽 칸에서 확정 · 지우기`
### T8 스모크 · 설명서 · 기능 맵
- [ ] `smoke/common.mjs` `runStep`에 `drafting = false`(true면 `storage`에 `"sopa.drafting": "1"`), `order.mjs:470`의 따로 여는 컨텍스트도 같은 키.
- [ ] 메인 세션: `FULL=1`(실행기를 고쳤으므로)로 숨긴 채 한 번 → 깨진 단계 가운데 **숨긴 기능을 쓰는 것에만** `drafting: true`, 단계 · 기대값은 그대로. 글로 잡은 첫 목록: `order.mjs` 전부, `documents.mjs` `new documents:` 전부와 2445, `outputs.mjs` 33 · 96 · 211 · 238 · 351, `assign.mjs` 454 · 1257 · 2116 · 2181 · 2304 · 2345 · 2375 · 2396 · 2451 · 3188 · 3985 · 5352 · 5771 · 6054 · 6248 · 6362 · 6452 · 6488 · 6583 · 8136과 `pickFirstPlace`를 쓰는 단계. 숨긴 채 통과하면 숨긴 채 둔다(실사용 화면이 그쪽이다).
- [ ] 바꿈(§14 승인, 같은 수): `assign.mjs:8184` `PREPARE_STEP` → 응답 `queued === 0` · 알림 없음 · Background 줄 없음 · `classify` 제안 0 · `assign-filter-ai_suggested` 칩 없음 …(이름은 "first entry does not classify the remaining rows"), `outputs.mjs:121` · `pw-overlap-audit.mjs:420` → 넷. 더함: `drafting hidden: rail, documents, assign and outputs show no drafting` — 레일 `1:documents 2:assign 3:outputs`, `/order` → `/assign`, `tobe-add-row` · `assign-tree-place-*` · `assign-edit` · `outputs-tab-c` 0개, 빈 문서에 배정한 줄의 `assign-hidden-place`, 배정 취소 → Unassigned. 운영 빌드에서 `sopa.drafting=1`이 듣지 않는 것은 게이트의 build 뒤 `next start`로 한 번.
- [ ] 설명서: `#tobe-docs` · `#tobe-slots` · `#tobe-excel` · `#tobe-ai` · `#split-ai` · `#assign-places` · `#assign-translate` · `#order` 머리에 "지금은 숨긴 기능입니다", `#flow` · `#outputs` · `#outputs-excel` · `#ai-kinds` · `#keys`의 번호 · 시트 수 · 줄을 고친다(`{#id}` 그대로). 기능 맵 1–4단계 줄.
- [ ] 커밋 `test(smoke): run drafting steps with the switch on and check the hidden screens — 숨긴 기능 스모크는 켜고 돌리고 숨긴 화면을 봄(자동 칸 추천이 돌지 않게 바뀜)`
- **CHANGELOG** `새 문서를 만드는 기능(Order · 번호로 더하기 · 칸 배정 · 템플릿 보기 · 결과물 C · Excel C 시트)과 칸 추천 · 번역 · 나누기 · 목록 읽기 AI를 숨김. 이미 보낸 줄은 그대로 보이고 배정 취소하거나 이어 바꿀 수 있음.`
- **세워 둘 조건** ① 하이드레이션 경고를 `useDraftingOn`으로 못 막는다. ② T2 · T3 목록 밖의 backend 시험이 깨진다. ③ 숨긴 채 검토 요청이 막히는 길이 남는다(`blockers` 코드를 적는다). ④ 이펙트 기준선이 는다.

## fix/remove-bundle-move
- **목표** — 다른 Bundle로 이동을 새로 만드는 길이 화면에 없고 이미 이동한 줄은 읽기 전용이다(F2-R6 · R7 · R8).
- **Files** — Modify UAP `827,1763-1825,2040-2046,3456`, PG `949-962,998-1042,1044-1111`, SP `115-135,193-206,405-412,975-991`, `assign-bar.tsx:83-86`, `components/assign/assign-context-menu.tsx:44`, `lib/assign-context-menu-model.ts` · `.test.ts`, `lib/classify-model.ts:256`(읽기는 그대로) · `.test.ts`, `assign-help.tsx:28`, `i18n-messages.ts`, `effect-baseline.json`(17 · 65줄이 준다), `scripts/smoke/assign.mjs:665-687`, `docs/qa/feature-map.md`. Delete `components/assign/move-target-field.tsx`. 서버 API · 지도 · Excel A는 그대로.
- **Interfaces** — Consumes: `assign-hidden-place`의 읽기 전용 모양. Produces: `DecidePick.destination`은 `{ kind: "delete" }`만, `BulkModal`은 삭제만, `describeLegacyMove(units: readonly UnitRow[]): { code: string } | null`.
### T1 만드는 길을 없애고 이미 이동한 줄은 읽기 전용으로
- [ ] 시험 `assign-context-menu-model.test.ts:55,73` — `["clear", "delete"]` · `["clear"]`(지금 값에서 `"move"`만 빠짐). `classify-model.test.ts`:
```ts
expect(readDestination(movedGroup, [1])).toEqual({ kind: "move" });                         // 읽기는 그대로
expect(describeLegacyMove([unitRow({ disposition: "move_external", move_target_code: "SOP-QC-99999" })])).toEqual({ code: "SOP-QC-99999" });
expect(describeLegacyMove([unitRow({ disposition: "delete" })])).toBeNull();
```
- [ ] 실패 확인 `VT assign-context-menu-model.test.ts classify-model.test.ts` → 구현: M · 우클릭 · Moved 잎(`assign-pick-move`) · `MoveTargetField` · `MoveModal` · 일괄 이동 제거, `assign.acc.move`는 en "Delete" / ko "삭제"(testid는 그대로). 이동한 줄은 `assign.legacyMove`(en "Moved to another document · {code} (retired feature)" / ko "다른 문서로 이동 · {code} (이전 기능)", testid `assign-legacy-move`)와 배정 취소만, Confirm 끔. 문구 `assign.ctx.move` · `assign.moveModal.*` · `assign.move.*` · `classify.moved` · `classify.bulkMoveTitle` · `assign.help.keyMoveTo` · `remark.blankMove` · `remark.defaultMove` 제거, `outputs.dest.move_external` · `map.legend.moved`는 남김. `UPDATE_EFFECT_BASELINE=1 npx vitest run src/source-rules.test.ts`로 기준선을 낮춘다.
- [ ] 통과 확인 같은 명령 + `VT i18n-messages.test.ts manual-content.test.ts` → 커밋 `feat(assign): remove moving rows to another Bundle, keep old ones read-only — 다른 Bundle로 이동을 없애고 이미 이동한 줄은 읽기 전용으로`
- **스모크** `assign.mjs:665-687`(검사 4개, §14에 이름 없음 — 동작이 바뀌어 따라 바뀜, 물음 4)을 `assign: a row moved earlier is read-only and Unassign frees it`로: API `decisions/bulk` `move_external`로 한 줄을 만든 뒤 ① `assign-legacy-move` 글에 번호 ② Confirm 꺼짐 ③ `m`을 눌러도 창이 없고 우클릭 메뉴에 이동이 없음 ④ 배정 취소 → Unassigned. 474의 `assign-acc-move`는 testid가 그대로라 바뀌지 않는다.
- **설명서** `#assign-destination`(468) · `#assign-confirm`(543) · `#assign-context`(563) · `#assign-bulk`(725) · `#keys`. **CHANGELOG** `다른 Bundle로 이동(M · 우클릭 · Moved · 일괄)을 없앰. 이미 이동한 줄은 그대로 보이고 배정 취소할 수 있음.`
- **세워 둘 조건** 서버의 `move_external` 자료를 바꿔야 화면이 선다.

## fix/pair-spot-scroll
- **목표** — 한 단 보기에서 위치 판을 열고 닫아도 용지 폭이 그대로이고 고른 박스의 화면 위쪽 자리가 2px 안에서 같다(§6 S2).
- **Files** — Create `frontend/src/lib/spot-place-model.ts` · `.test.ts`. Modify `lib/use-pane-slide.ts:97-120`(`useSheetSlide`), `styles/components.css:2441-2447`, `components/assign/old-pane.tsx:106-115`, `scripts/smoke/assign.mjs:5270-5311`.
- **Interfaces** — Consumes: 없음. Produces: `planSpotPlace(input: { pane: number; sheet: number }): { kind: "aside" | "cover"; panel: number }`, `SPOT_MIN = 420` · `SPOT_MAX = 600` · `SPOT_GAP = 12`.
### T1 재현 검사를 먼저
- [ ] 스모크 단계 `assign: the pair panel never moves the picked box up or down` — 안내 줄 짝이 있는 문서(5183 단계의 준비)에서 창 1920 · 1440 · 1280 × 배율 100% · 160%마다, 판을 열기 전 · 연 뒤 · 닫은 뒤의 고른 박스 `top`과 용지 폭: `Math.abs(top 차이) <= 2`, 폭 차이 `<= 1`. 위쪽 줄이 다시 접히는 긴 줄을 고른 박스 위에 둔다.
- [ ] 실패 확인(메인 세션) `QUIET=1 ONLY="assign: the pair panel never moves" node scripts/pw-smoke-sop.mjs` — 1920 폭 860 → 752, 160% 1360 → 752.
### T2 폭은 그대로, 옆으로만
- [ ] 시험:
```ts
// [칸, 용지] → 모양, 판 폭(칸 − 용지 − 12, 상한 600). 1440/1360은 배율 160%, 500은 92%
for (const [pane, sheet, kind, panel] of [[1440, 860, "aside", 568], [1600, 860, "aside", 600], [1292, 860, "aside", 420], [1291, 860, "cover", 600], [1440, 1360, "cover", 600], [500, 480, "cover", 460]] as const)
  expect(planSpotPlace({ pane, sheet })).toEqual({ kind, panel });
```
- [ ] 실패 확인 `VT spot-place-model.test.ts` → 구현: 있는 `useSheetSlide`의 레이아웃 이펙트가 판이 열린 동안 칸 · 용지 폭을 재(`ResizeObserver` 하나) `.assign-panes`에 `data-spot`과 `--spot-w`를 단다. CSS는 `padding-right` 규칙(2446)을 없애고 `aside`면 용지를 왼쪽으로 붙인다(`margin-inline: 4px auto`, 폭 그대로) · 판 `width: var(--spot-w)`, `cover`는 용지 제자리 · 판 `min(600px, 92%)`. → 통과 확인 같은 명령, 메인 세션 T1 단계 → 커밋 `fix(assign): keep the sheet width when the pair panel opens — 짝 판이 열려도 용지 폭을 그대로`
- **스모크** 5295-5311의 `isAside`를 `layout.pane - 용지 폭 - 12 >= 420`으로, 창 폭 목록에 1920을 더함(1680에서는 겹침이 된다 — 동작이 바뀌어 따라 바뀜, 물음 6). **설명서** `#split-pair`의 짝 판 문장. **CHANGELOG** `짝 · 그림 위치 판을 열어도 용지 폭과 보던 자리가 그대로.`
- **세워 둘 조건** T1에서 폭과 무관한 까닭으로 자리가 튄다(까닭을 적고 세운다).

## feat/inspector-float
- **목표** — 화면 폭 1440px 미만에서 오른쪽 칸을 떼어 판으로 띄우고 자리 · 접힘을 기억한다(§6 S3).
- **Files** — Create `frontend/src/lib/side-float-model.ts` · `.test.ts`, `lib/use-window-size.ts`, `components/assign/side-float.tsx`. Modify PG `475,819`, SP(머리에 단추 자리), `lib/assign-view-prefs.ts` · `.test.ts`, `styles/components.css`(새 선택자만), `i18n-messages.ts`, `scripts/pw-overlap-audit.mjs`(뗀 장면), `docs/qa/feature-map.md`.
- **Interfaces** — Consumes: 없음. Produces: `SIDE_FLOAT_MAX_VIEW = 1440` · `SIDE_FLOAT_WIDTH = 320` · `SIDE_FLOAT_MAX_HEIGHT = 0.7`, `isSideFloating(viewWidth: number, wantsFloat: boolean): boolean`, `clampFloat(at, size, view): { x: number; y: number }`, `getFloatStart(view, size)`, `AssignView.sideFloat: boolean` · `sideX: number | null` · `sideY: number | null` · `sideFolded: boolean`, `useWindowSize(): { w: number; h: number }`.
### T1 자리 셈과 기억
- [ ] 시험 `side-float-model.test.ts` · `assign-view-prefs.test.ts`:
```ts
expect([isSideFloating(1439, true), isSideFloating(1440, true), isSideFloating(1200, false)]).toEqual([true, false, false]);
expect(clampFloat({ x: 5000, y: -40 }, { w: 320, h: 400 }, { w: 1280, h: 720 })).toEqual({ x: 960, y: 0 });
expect(clampFloat({ x: 900, y: 700 }, { w: 320, h: 36 }, { w: 1280, h: 720 })).toEqual({ x: 900, y: 684 });
expect(getFloatStart({ w: 1280, h: 720 }, { w: 320, h: 504 })).toEqual({ x: 944, y: 200 }); // 오른쪽 아래, 여백 16
expect(readAssignView()).toMatchObject({ sideFloat: false, sideX: null, sideY: null, sideFolded: false });
writeAssignView({ sideFloat: true, sideX: 12, sideY: 40 }); expect(readAssignView()).toMatchObject({ sideFloat: true, sideX: 12, sideY: 40 });
```
- [ ] 실패 확인 `VT side-float-model.test.ts assign-view-prefs.test.ts` → 구현: 키 `sopa.assign.sideFloat` · `sideX` · `sideY` · `sideFolded`(숫자 꼴, null이면 쓰지 않음). `useWindowSize`는 `useSyncExternalStore`(resize, 서버 값 `{ w: 1440, h: 900 }`). → 통과 확인 같은 명령 → 커밋 `feat(assign): place model for a floating side panel — 떼는 오른쪽 칸의 자리 셈`
### T2 판
- [ ] 시험: 더할 스모크 `assign: the side panel detaches below 1440px, drags inside the window, folds and comes back`을 먼저 적는다 — 창 1248: `assign-side-detach` → `.assign-panes` 폭이 는다, 머리를 (−400, −200) 끌고 새로 고침해도 같은 자리(±1), (+9999, +9999)로 끌면 창 안, `j` · `Delete`가 듣는다, 접기 → 높이가 머리 한 줄, 창 1440 → 붙고 단추 없음, 다시 1248 → 뗀 채, 붙이기.
- [ ] 실패 확인(메인 세션) `QUIET=1 ONLY="assign: the side panel detaches" node scripts/pw-smoke-sop.mjs` → 구현: 떼면 격자가 `grid-cols-[minmax(0,1fr)]`, 같은 `AssignSidePanel`을 `SideFloat`로 감싼다(폭 320, `max-height: 70vh`, `role` 없음 · `aria-label`, 포커스를 가두지 않음, z는 위치 판 20보다 위 · 창보다 아래). 머리를 `pane-divider.tsx:30`처럼 `setPointerCapture`로 끌고 놓을 때 저장, 그릴 때마다 `clampFloat`. 단추 `assign-side-detach`(1440 미만) · `assign-side-fold` · `assign-side-attach`는 `Tooltip`. 새 이펙트 · 타이머 없음.
- [ ] 통과 확인 `VT ../source-rules.test.ts i18n-messages.test.ts`, 메인 세션 새 단계 → 커밋 `feat(assign): detach the side panel below 1440px — 좁은 화면에서 오른쪽 칸 떼기`
- **스모크** 위 하나를 더하고 있는 단계는 그대로(창 1248이라 머리에 단추 하나가 는다 — 겹침 감사로 봄). **설명서** `#assign-view`. **CHANGELOG** `창이 1440px보다 좁으면 오른쪽 칸을 떼어 옮기고 접을 수 있음(자리를 기억).`
- **세워 둘 조건** 새 이펙트 없이 끌기 · 창 크기 따라가기가 안 된다.

## perf/assign-measure
- **목표** — §6-1 표의 값을 같은 스크립트로 다시 잴 수 있고 서버가 저장 시간을 남긴다(A2-R1~R4, A2-AC1).
- **Files** — Create `backend/tests/test_sop_save_timing.py`, `docs/qa/2026-11-assign-perf.md`. Modify `backend/app/routers/sop_decisions.py:96-110`, `app/sop/decision_steps.py:361-380`, `frontend/scripts/pw-perf-assign.mjs`, `docs/qa/verification-commands.md:39`, `docs/README.md`.
- **Interfaces** — Consumes: 없음. Produces: `record_snapshot_step(…, timings: dict[str, float] | None = None)`(키 `dump_ms` · `run_ms`), 로그 `"group save timed"`의 `extra` = `bundle_id` · `total_ms` · `dump_ms` · `run_ms` · `unit_count` · `target_count`.
### T1 서버 시간
- [ ] 시험:
```python
def test_save_logs_timing_without_text(client, caplog):
    fx = _setup_undo(client)  # test_sop_decision_undo._setup
    with caplog.at_level("INFO", logger="app.routers.sop_decisions"):
        _confirm_with_undo(client, fx)
    (record,) = [r for r in caplog.records if r.message == "group save timed"]
    assert 0 < record.dump_ms <= record.total_ms and (record.unit_count, record.target_count) == (1, 1)
    assert not any(secret in str(record.__dict__) for secret in (STORAGE, AUTHOR["X-Dev-User"]))
def test_save_without_undo_meta_takes_no_dump(client, caplog): ...  # record.dump_ms == 0
```
- [ ] 실패 확인 `PY test_sop_save_timing.py` → 구현: `time.perf_counter`, 커밋 뒤 `logger.info("group save timed", extra=…)`(밀리초 소수 1자리). → 통과 확인 `PY test_sop_save_timing.py` · `PY test_sop_decision_undo.py` → 커밋 `perf(decisions): log how long a save and its snapshots take — 저장과 스냅숏 시간을 구조화 로그로`
### T2 `pw-perf-assign.mjs`에 넣을 것(시험 없음 — 스크립트, `node --check`까지)
- [ ] 환경 변수 `SCENARIO=frames|keys|burst|filter|number|idle|commits`(기본 `frames` = 지금 동작) · `REPEAT=6` · `LAT=0`. 공통: 조각 `nth(4)`를 누르고 1.5초. `LAT`가 있으면 CDP `Network.enable` 뒤 `Network.emulateNetworkConditions { offline: false, latency, downloadThroughput: -1, uploadThroughput: -1 }`. 판단을 쓰는 시나리오는 시작에 묶음이 `is_synthetic`인지 보고 아니면 멈춘다.
- [ ] **글쇠 재기** `measureKey(page, key)`: 누르기 전에 페이지 안 약속을 건다 — `window.addEventListener("keydown", …, { once: true, capture: true })`에서 `t0 = performance.now()`, 그 뒤 `requestAnimationFrame`마다 `document.querySelector('[data-pane="old"] [data-sel] [data-unit], [data-pane="old"] [data-unit][data-sel]')?.getAttribute("data-unit")`이 처음 값과 달라질 때까지(20,000ms 넘으면 `-1`). 걸고 80ms 뒤 누르고 `networkidle` + 700ms. 값은 가운데 값 + 전체.
- [ ] **요청**: `requestfinished`에서 `/api/`만, `request.timing()`의 `responseStart`(TTFB) · 첫 비GET의 TTFB(`save`) · 개수 · `max(startTime + responseEnd) − min(startTime)` · `METHOD 경로`(숫자 → `N`, 쿼리 뗌)의 서로 다른 목록.
- [ ] `keys`: `j` 6번 · `Delete` 6번. `burst`: `GET /units?limit=1000` 응답의 `"disposition":"delete"` 수를 앞뒤로 세며 ① `Delete` 5번 150ms 간격 + 3.5초 ② `Delete` · `j` · `Delete` 60ms 간격 + 3.5초 → 누른 수 · 는 수. `filter`: `[data-testid="assign-filter-unassigned"]` → 2.5초 → `keys`. `number`: 첫 번호 칸을 열고 다섯 글자, 글자마다 `input` → rAF 두 번 ms. `idle`(가짜 AI를 켠 묶음): 60초 무조작의 long task 수 · 최댓값 · GET 수. `keys`에 long task 목록(`PerformanceObserver longtask`)도 함께.
- [ ] `commits`(개발 서버): `smoke/common.mjs` `installCommitCounter`와 같은 훅의 `onCommitFiberRoot(id, root)`에서 커밋을 세고, 커밋마다 파이버 나무를 훑어 이름이 `PaperChunk`이고 `flags & 1`(PerformedWork)인 수 — `j` 한 번 · `Delete` 한 번(A2-R3).
- [ ] 커밋 `perf(scripts): measure keys, bursts, filters and number typing on Assign — Assign 글쇠 · 연타 · 필터 · 번호 입력 측정`
### T3 결과 문서(메인 세션)
- [ ] 로컬 운영 빌드(`npm run build` → `npx next start -p <포트>`) + `seed_sop_worst`, **localhost가 아닌 LAN 주소**, CPU 1 · 4로 위 시나리오 → `docs/qa/2026-11-assign-perf.md`에 시나리오 × 지표 표(§6-1의 여섯 줄 + A2 (c)(d)), 원인별 몫, 목표 열. `docs/README.md` · `verification-commands.md` 한 줄(주소는 `<lan-ip>`).
- [ ] 커밋 `docs(qa): record Assign response times — Assign 반응 시간 측정 결과`
- **스모크 · 설명서** 없음. **CHANGELOG** 로그만이라 다음 앱 푸시 줄에 함께. **세워 둘 조건** 로그에 원문 · 이름 · 로그인 ID가 섞인다.

## fix/assign-command-queue
- **목표** — Assign의 쓰기가 모두 한 줄 큐로 나가고 판단 글쇠는 누른 즉시 다음 박스로 가며, 실패하면 멈추고 알린다(A1-R1~R8, §6-1).
- **Files** — Create `frontend/src/lib/command-queue.ts` · `.test.ts`, `lib/next-box-model.ts` · `.test.ts`, `app/bundles/[id]/assign/use-command-queue.ts`. Modify UAP `308-326,427,462,1375-1670,1917-2046,2068-2245,2248-2325,2440-2500,3246-3270,3350-3374,3391-3463`, PG `962-992`, `assign-bar.tsx:64-73`, `lib/use-assign-focus.ts:56-66`, `lib/assign-focus-model.ts:155-180` · `.test.ts:162-177`, `components/paper/paper.tsx:68-72,779-790`, `i18n-messages.ts`, `scripts/smoke/assign.mjs`, `docs/qa/feature-map.md:22`, `frontend/CLAUDE.md` · `docs/architecture/frontend.md` 3절.
- **Interfaces** — Consumes: `findNextAfterSave`(`classify-model.ts:719`, A1-R2가 말한 `findNextOpen`은 이 이름이 됐다), `planReload`, `loadRowGroup`, `pickDocRevision`. Produces(`createCommandQueue<T>()` · `QueuedCommand` · `isBarrier` · `enqueue`는 색인 이름):
```ts
// lib/command-queue.ts - React 없음
export type CommandKind = PendingKind | "key";
export interface QueuedCommand<T> { id: string; kind: CommandKind; isGlobal: boolean; payload: T; unitIds: readonly number[]; isDeferred: boolean } // isDeferred - 장벽 뒤에 눌려 대상을 나갈 때 푼다
export interface QueueState<T> { waiting: readonly QueuedCommand<T>[]; running: QueuedCommand<T> | null; halted: { command: QueuedCommand<T>; reason: string } | null; asking: QueuedCommand<T> | null }
export function isBarrier(command: Pick<QueuedCommand<unknown>, "kind" | "isGlobal">): boolean;
export function listWaitNumbers<T>(state: QueueState<T>): ReadonlyMap<number, number>; // 박스 → "대기 n"(첫째 대기 = 1)
export interface CommandQueue<T> {
  getState(): QueueState<T>; subscribe(listener: () => void): () => void;
  push(command: Omit<QueuedCommand<T>, "isDeferred">): { isDeferred: boolean }; // true면 부른 쪽은 고름을 옮기지 않는다
  pushNext(command: Omit<QueuedCommand<T>, "isDeferred">): void;               // 되살린 글쇠가 만든 명령 - 남은 글쇠 앞
  take(): QueuedCommand<T> | null; respond(id: string): void; settle(id: string): void;
  fail(id: string, reason: string): void; retry(): void; ask(id: string): void; resume(id: string, payload: T): void;
  drop(): readonly QueuedCommand<T>[]; }                                       // 버리기 - 멈춘(되묻던) 것과 대기 전부를 걷어 돌려준다
export function createCommandQueue<T>(): CommandQueue<T>;
// use-command-queue.ts - 이펙트 없음(useSyncExternalStore + ref)
export type AssignCommand =
  | { kind: "save"; action: "confirm" | "hold"; docId: number; rowKey: string; unitIds: readonly number[]; boxId: number; destination: Destination | null; draft: PageDraft; reason: string }
  | { kind: "clear"; docId: number; rowKey: string; unitIds: readonly number[]; boxId: number }
  | { kind: "bulk"; rows: ReadonlyArray<{ rowKey: string; unitIds: readonly number[] }>; reason: string }
  | { kind: "figure"; unitId: number; unitIds: readonly number[]; reason: string }
  | { kind: "edit"; docId: number; op: EditOp; okText: EditToast; followId: number | null; confirm: boolean; place: PendingPlace | null }
  | { kind: "pair"; docId: number; unitIds: readonly number[]; followId: number; write: (revision: number, undo: UndoMeta) => Promise<{ document_revision: number }> }
  | { kind: "step"; direction: "undo" | "redo" }
  | { kind: "global"; label: string; run: () => Promise<void> } // 같은 글자 · 모두 받기 · 신규 표시 · 출처 잇기 · 칸 떼기 · 표 참조 · 나누기 제안
  | { kind: "key"; key: string; shift: boolean; ctrl: boolean };
export function useCommandQueue(env: CommandEnv): { enqueue(command: AssignCommand): void; state: QueueState<AssignCommand>; retry(): void; discard(): void };
```
### T1 큐 모델
- [ ] 시험 `command-queue.test.ts`(`job(id, kind, unitIds)` · `key(id)` 도우미, `isGlobal` 기본 false):
```ts
it("names the barriers", () => {
  for (const kind of ["join", "split", "unmerge", "unwrap", "rewrap", "pair", "unpair", "lang", "heading", "caption", "figure", "toc", "undo"] as const) expect(isBarrier({ kind, isGlobal: false })).toBe(true);
  for (const kind of ["save", "bulk", "ref", "order", "reorder", "key"] as const) expect(isBarrier({ kind, isGlobal: false })).toBe(false);
  expect(isBarrier({ kind: "bulk", isGlobal: true })).toBe(true); }); // 모두 받기 · 초기화
it("sends one at a time in the order pressed and numbers the waiting boxes", () => {
  const q = createCommandQueue<string>(); q.push(job("a", "save", [3])); q.push(job("b", "save", [4])); q.push(job("c", "save", [5]));
  expect(q.take()?.id).toBe("a"); expect(q.take()).toBeNull(); expect(listWaitNumbers(q.getState())).toEqual(new Map([[4, 1], [5, 2]]));
  q.settle("a"); expect(q.take()?.id).toBe("b"); q.settle("b"); expect(q.take()?.id).toBe("c"); });
it("defers presses behind a barrier until its focus settles, not its response", () => {
  const q = createCommandQueue<string>(); expect(q.push(job("m", "join", [3, 4])).isDeferred).toBe(false);
  expect(q.push(key("k1")).isDeferred).toBe(true); expect(q.push(job("d", "save", [9])).isDeferred).toBe(true);
  q.take(); q.respond("m"); expect(q.take()).toBeNull(); q.settle("m"); expect(q.take()).toMatchObject({ id: "k1", isDeferred: true }); });
it("puts a command made by a replayed key before the keys still waiting", () => {
  const q = createCommandQueue<string>(); q.push(job("m", "join", [3, 4])); q.push(key("k1")); q.push(key("k2"));
  q.take(); q.settle("m"); q.take(); q.settle("k1"); q.pushNext(job("d", "save", [7]));
  expect(q.take()?.id).toBe("d"); q.settle("d"); expect(q.take()?.id).toBe("k2"); });
it("stops after a failure, retries in place, and drop gives back what was waiting", () => {
  const q = createCommandQueue<string>(); q.push(job("a", "save", [3])); q.push(job("b", "save", [4])); q.take(); q.fail("a", "conflict");
  expect(q.getState().halted).toMatchObject({ command: { id: "a" }, reason: "conflict" }); expect(q.take()).toBeNull();
  q.retry(); expect(q.take()?.id).toBe("a"); q.fail("a", "conflict");
  expect(q.drop().map((c) => c.id)).toEqual(["a", "b"]); expect(q.getState()).toEqual({ waiting: [], running: null, halted: null, asking: null }); });
it("waits while a dialog asks and resends the same command in place", () => {
  const q = createCommandQueue<string>(); q.push(job("e", "join", [3])); q.push(key("k")); q.take(); q.ask("e"); expect(q.take()).toBeNull();
  q.resume("e", "confirmed"); expect(q.take()).toMatchObject({ id: "e", payload: "confirmed" }); q.settle("e"); expect(q.take()?.id).toBe("k"); });
```
- [ ] 실패 확인 `VT command-queue.test.ts` → 구현 — 장벽 규칙의 본문만 못박는다:
```ts
// push: 앞에 장벽이 있거나(달리는 것 포함) 미룬 것이 있거나 되묻는 중이면 미룬다 - 대상은 나갈 때(take 뒤) 그때의 고름으로 푼다
const mustDefer = (s: QueueState<T>) => s.asking !== null || (s.running !== null && isBarrier(s.running)) || s.waiting.some((c) => c.isDeferred || isBarrier(c));
// take: running · halted · asking 중 하나라도 있으면 null. respond: 장벽이 아니면 settle과 같고, 장벽이면 running에 남긴다(새 보기의 고름이 선 뒤 settle)
```
- [ ] 통과 확인 같은 명령 → 커밋 `feat(assign): a pure command queue with barriers — 장벽 있는 명령 큐 모델`
### T2 다음 박스와 잠금
- [ ] 시험 `next-box-model.test.ts` · `assign-focus-model.test.ts:162-177`(A1-T2, §14 승인 — `canStart`를 새 규칙으로):
```ts
// rows: u1 u2 u3 모두 미확정 · 같은 문서 · 같은 탭, pending: 줄 키 → "deleted" | "confirmed" | "held"
expect(pickNextBox({ ...base, from: "u1", mode: "below", pending: new Map([["u2", "deleted"]]) })).toEqual({ key: "u3", unitId: 3 });
expect(pickNextBox({ ...base, from: "u1", mode: "open", pending: new Map([["u2", "confirmed"]]) })).toEqual({ key: "u3", unitId: 3 });
expect(pickNextBox({ ...base, from: "u3", mode: "open", pending: new Map() })).toBeNull(); // 되감기 없음
expect(isUnitLocked(run(start(job("a", { kind: "save", unitIds: [3] }))), 3)).toBe(false); // 판단 저장 중인 박스는 다시 고를 수 있다(A1-R4)
expect(isUnitLocked(run(start(job("a", { kind: "join", unitIds: [3] }))), 3)).toBe(true);
```
- [ ] 실패 확인 `VT next-box-model.test.ts assign-focus-model.test.ts` → 구현: `pickNextAfterSave`(UAP 1999)의 판정을 모델로 옮기고 `canStart`를 지운다(큐가 대신). → 통과 확인 같은 명령 + `VT classify-model.test.ts` → 커밋 `feat(assign): pick the next box with the saves still in flight — 저장 중인 것까지 세어 다음 박스를 고름(canStart 시험을 큐 규칙으로)`
### T3 화면의 쓰기를 큐로
- [ ] 시험: `grep -cE "focusCtl\.runPending|if \(!row \|\| busy|queuedSaveRef|canStart" <UAP>` — 지금 18(실패 확인) → 구현 뒤 `0`. 동작은 T1 · T2 시험과 T5 스모크가 본다.
- [ ] 구현 ① 보내는 자리 전부 → `enqueue`: `runSave` · `decideNow` · `runClear` · 일괄(PG 971) · `deleteFigure` · `runUnitEdit` · `runPairChange` · `switchToPair` · `applySplitSuggestion` · `dismissSplitSuggestion` · `runCaptionRefChange` · `runUndoStep` · `acceptAll` · `confirmIdenticalAll` · `markNew` · `linkAsSource` · `unlinkCell` · 끌어 짝(3246) · `splitComposedAtCut` · `joinComposed` · `ResetModal`. 전제(참조 · 캡션 · Remark)는 누를 때 보고, 줄 정보를 아직 못 받았으면 나갈 때 `loadRowGroup`으로 받아 본다(못 지키면 실패로 멈춤).
- [ ] 구현 ② 판단 명령은 누른 순간 줄 키 · Unit · 초안을 잡고 처리 중 표시와 함께 `pickNextBox`로 고름을 옮긴다. `isDeferred`면 옮기지 않는다. 나갈 때 revision은 앞 응답(`Group.units[].decision.revision`)이 이긴다. 장벽은 응답 → `planReload`의 **그 문서 보기** → `focusCtl.load`의 따라가기가 소비된 뒤 `settle`(문서 보기를 안 받는 일은 응답에서 곧바로).
- [ ] 구현 ③ 글쇠는 앞에 장벽이 있으면 `{ kind: "key" }`로 넣고 `preventDefault`만 — 나갈 때 그 렌더의 `handleKey`가 다시 처리해 만든 명령을 `pushNext`로. `reloadData` · AI 끝 알림의 다시 받기는 `requestReload`로 모아 큐가 빌 때 한 번(A1-R6, 장벽의 문서 보기만 예외). `Ctrl+Z`는 큐에 판단 명령이 있으면 `canUndo`가 아직 거짓이어도 줄에 선다. Undo · Redo · 더보기는 `isAnyPending`으로 끄지 않는다.
- [ ] 구현 ④ 돌리기는 **이미 있는 줄 없는 이펙트**(`undoStepRef` 2123)를 넓혀 커밋마다 `take`를 부르고, `queuedSaveRef`의 이펙트(2034)를 지운다 — 기준선을 하나 낮춘다(`UPDATE_EFFECT_BASELINE=1`).
- [ ] 통과 확인 위 grep = 0, `VT ../source-rules.test.ts command-queue.test.ts assign-focus-model.test.ts`(기준선이 낮아진 값과 같다) → 커밋 `refactor(assign): every write goes through one command queue — Assign의 쓰기를 한 줄 큐로`
### T4 표시 · 알림
- [ ] 시험 `i18n-messages.test.ts`가 en · ko 짝을 본다 + `assign-focus-model.test.ts`: `buildPaperWaits(state)`가 `listWaitNumbers`를 실은 `PaperPending.waits: ReadonlyMap<number, number>`.
- [ ] 실패 확인 `VT assign-focus-model.test.ts` → 구현: 칩 `assign.queue.chip`(en "Queued {n}" / ko "대기 {n}", testid `assign-queue-<unitId>`), 실패 상자 `assign-queue-failed`(en "{action} failed on box {no}: {reason}. {n} queued actions paused." / ko "{no}번 박스의 {action}이(가) 실패했습니다: {reason}. 대기 {n}개를 멈췄습니다.") + `assign.queue.retry` / `.discard`(en "Retry" · "Discard" / ko "다시 시도" · "버리기", testid `assign-queue-retry` · `assign-queue-discard`). 실패 · 버리기는 그 박스의 처리 중 · 접힘 표시를 되돌린다. 상자는 `role="alert"`(dialog가 아니라 글쇠를 막지 않음). → 통과 확인 같은 명령 + `VT i18n-messages.test.ts` → 커밋 `feat(assign): show queued actions and stop on failure — 대기 칩과 실패 멈춤 알림`
### T5 스모크(더함) `assign: keys pressed during a slow save are kept in order`
- [ ] `page.route("**/groups/save", 800ms 지연)`: ① `Delete` · `j` · `Delete`(S1) → 첫째 `data-pending`, 다른 박스에 `assign-queue-*`, 누를 때마다 고름이 300ms 안에 옮겨지고 끝에 둘 다 삭제(API로 셈), 그동안 `GET …/units` 한 번 ② `Delete` 다섯 번 150ms 간격 → 다섯 모두 삭제(§6-1) ③ 틈 Join을 누르고 응답 전에 `Delete` → 합친 박스가 삭제 ④ 둘째 저장을 500으로 → 셋째 요청이 나가지 않고 `assign-queue-failed`, 다시 시도로 끝까지, 다시 500 · 버리기로 빔 ⑤ `Delete` 직후 `Control+z` → 되살아남. 실패 확인은 T3 전 커밋에서 이 단계만 돌려 빨간 것을 본다.
- [ ] 있는 단계 `4778`(Del 뒤 바로 아래 박스) · `4831`(삭제 줄 접힘) · `3740`(Join 처리 중)은 기대 그대로(A1-AC4). 커밋 `test(smoke): keys pressed during a slow save — 느린 저장 중 글쇠`
- **설명서** `#assign-confirm` · `#assign-undo` · `#assign-bulk`: 누르는 즉시 다음 박스, 대기 표시, 실패하면 멈춤 · 다시 시도 · 버리기. **CHANGELOG** `저장이 느려도 누른 판단이 사라지지 않고 차례대로 저장됨. 누르는 즉시 다음 박스로 가고, 실패하면 멈추고 알림.`
- **세워 둘 조건** ① 새 이펙트가 필요하다. ② 같은 박스에 이어 누른 명령이 409를 낸다. ③ 4778 · 4831 · 3740의 기대를 바꿔야 한다. ④ 명령 하나가 되돌리기 한 단계가 아니게 된다.

## fix/assign-instant-motion
- **목표** — 삭제 줄 접기 · 벗기기 전환 · 번호 도착이 누르는 순간 시작하고 실패하면 거꾸로 돈다(A2-R6, S2).
- **Files** — Modify `lib/deleted-fold-model.ts`, `lib/unwrap-motion.ts`, `lib/number-arrival-model.ts`(각 `.test.ts`), `lib/use-number-arrival.ts`, `components/ui/motion.tsx:256-345`(`useUnwrapMotion`), `components/paper/paper.tsx:344,948`, PG `193-199`, UAP `1403-1473`, `styles/components.css`(`.is-pending` 줄무늬), `scripts/smoke/assign.mjs`.
- **Interfaces** — Consumes: `QueueState` · `isBarrier`. Produces: `buildDeletedFolds(rows, unitMap, { filter, pendingDeletes: ReadonlySet<string> })`, `useUnwrapMotion(ref).begin(options: UnwrapRunOptions): { commit(change: () => void): Promise<void>; revert(): void }`, `planUnwrapRevert(timings: UnwrapTimings, reverse: boolean): { duration: number; direction: PlaybackDirection }`, `readExpectedNumber(op: EditOp): { unitId: number; value: string | null } | null`.
### T1 모델 셋
- [ ] 시험:
```ts
// deleted-fold-model.test.ts - u2는 아직 저장 전
const folds = buildDeletedFolds(rows, unitMap, { filter: "all", pendingDeletes: new Set(["u2"]) });
expect(folds.get(2)).toMatchObject({ rowKey: "u2", remark: "" });
expect(buildDeletedFolds(rows, unitMap, { filter: "all", pendingDeletes: new Set() }).has(2)).toBe(false);      // 실패해 빠지면 펼쳐진다
expect(buildDeletedFolds(rows, unitMap, { filter: "confirmed", pendingDeletes: new Set(["u2"]) }).size).toBe(0);
// unwrap-motion.test.ts
expect(planUnwrapRevert(timings, false)).toEqual({ duration: planUnwrapPhases(timings, false).before.duration, direction: "reverse" });
// number-arrival-model.test.ts
expect(readExpectedNumber({ type: "set_number", unit_id: 7, number: "5.2", follow: true })).toEqual({ unitId: 7, value: "5.2" });
expect(readExpectedNumber({ type: "merge", unit_ids: [1, 2] })).toBeNull();
```
- [ ] 실패 확인 `VT deleted-fold-model.test.ts unwrap-motion.test.ts number-arrival-model.test.ts` → 구현(위 서명 셋과 `pendingDeletes`) → 통과 확인 같은 명령 → 커밋 `feat(assign): models for motion that starts on press — 누르는 순간 시작하는 움직임의 모델`
### T2 화면
- [ ] 시험(더할 스모크를 먼저) `assign: deletion folds and unwrap start before the response, a refused edit rolls back` — `groups/save` 1.5초 지연에서 `Delete` 뒤 300ms 안에 `assign-paper-deleted-u*`와 다음 박스 고름, `edits` 1.5초 지연에서 벗기기를 누른 뒤 100ms 안에 표에 움직임(`getAnimations().length > 0`)과 처리 중 표시, 같은 요청을 500으로 → 표가 그대로이고 `assign-queue-failed`, 번호 저장은 누른 뒤 100ms 안에 새 글.
- [ ] 실패 확인(메인 세션) `QUIET=1 ONLY="assign: deletion folds and unwrap start" node scripts/pw-smoke-sop.mjs` → 구현: 삭제는 큐의 `running` · `waiting` · 멈춘 명령의 줄 키를 `pendingDeletes`로(접기 부품 `Collapse` 그대로). 벗기기 · 다시 표로는 누르면 `begin`(걷기 + 처리 중), 응답에 `commit`, 거절 · 되묻기에 `revert`, 움직임 줄이기면 지금처럼 번쩍임만. 번호는 기대 글을 먼저 보이고 응답 값이 이긴다. `playUnwrapRun`의 앞 · 뒤 절반을 나눌 뿐 새 타이머 · 이펙트 없음.
- [ ] 통과 확인 위 단계 + `VT ../source-rules.test.ts` → 커밋 `fix(assign): start fold, unwrap and number motion on press — 접기 · 벗기기 · 번호 움직임을 누르는 순간 시작`
- **스모크** 위 하나를 더함(있는 벗기기 · 삭제 단계 그대로). **설명서** `#assign-confirm` 한 문장. **CHANGELOG** `삭제 접힘 · 표 벗기기 · 번호 반영이 누르는 순간 시작하고 거절되면 원래대로.`
- **세워 둘 조건** ① 전환 중 다음 명령이 새 보기를 두 번 놓는다. ② `assign.mjs:4929`(표 머리 높이)가 깨진다.

## perf/assign-filter-chunks
- **목표** — 필터가 켜져도 덩어리를 나누고 저장마다 모든 덩어리를 다시 그리지 않는다(§6-1, A2-R5). 목표: CPU 4배 · 1,050박스 · Unassigned에서 `Delete` 618 → 100ms 안, `j` 148 → 60ms 안.
- **Files** — Modify `components/paper/paper.tsx:430-445,1559-1690,1788`, `lib/paper-chunk-model.ts` · `.test.ts`, `lib/unwrap-ai-model.ts` · `.test.ts`, `lib/use-unwrap-ai.ts:43-58`, `docs/qa/2026-11-assign-perf.md`.
- **Interfaces** — Consumes: `PaperPending.waits`(3b가 먼저 합쳐졌으면). Produces: `sliceFoldEntries(entries: readonly FoldEntry[], size?: number): readonly CardSlice[]`, `readChunkPending(pending: PaperPending | undefined, unitIds: ReadonlySet<number>): string`, `readChunkDeleted(folds: ReadonlyMap<number, DeletedFold> | undefined, unitIds: ReadonlySet<number>): string`, `keepSamePreviews(prev: ReadonlyMap<number, readonly number[]>, next: ReadonlyMap<number, readonly number[]>): ReadonlyMap<number, readonly number[]>`.
### T1 접힌 목록도 덩어리로
- [ ] 시험 `paper-chunk-model.test.ts`:
```ts
const full = (n: number) => Array.from({ length: n }, (_, i): FoldEntry => ({ kind: "full", key: `u${i}` }));
expect(sliceFoldEntries(full(200)).map((s) => s.count)).toEqual([40, 40, 40, 40, 40]);
expect(sliceFoldEntries(full(100))).toEqual([{ start: 0, count: 100 }]);             // CHUNK_MIN_CARDS보다 적으면 나누지 않는다
const run: FoldEntry[] = [{ kind: "runHead", runKey: "r", memberKeys: [] }, ...Array.from({ length: 5 }, (_, i): FoldEntry => ({ kind: "line", key: `l${i}`, runKey: "r" }))];
expect(sliceFoldEntries([...full(39), ...run, ...full(120)])[0]).toEqual({ start: 0, count: 45 }); // 펼친 묶음 머리와 줄을 가르지 않는다
```
- [ ] 실패 확인 `VT paper-chunk-model.test.ts` → 구현: `renderFolded`가 이 조각마다 `PaperChunk`를 그린다(`.strip-chunk`라 있는 재기 · `content-visibility`가 그대로 듣는다, `chunkCount`에 접힌 조각 수를 더함). 앞 틈(`renderGap`)은 앞 조각의 마지막 줄을 넘겨받는다. → 통과 확인 같은 명령 + `VT paper-fold-model.test.ts` → 커밋 `perf(paper): chunk the folded list too — 필터를 켠 용지도 덩어리로`
### T2 저장마다 다시 그리는 값
- [ ] 시험:
```ts
const mine = new Set([1, 2]); const busy = pending({ lockedIds: [1], shimmerIds: [1], waits: [[2, 1]] });
expect(readChunkPending(undefined, mine)).toBe(""); expect(readChunkPending(busy, mine)).not.toBe("");
expect(readChunkPending(pending({ lockedIds: [1, 9], shimmerIds: [1], waits: [[2, 1], [8, 2]] }), mine)).toBe(readChunkPending(busy, mine)); // 남의 덩어리 일은 값이 같다
expect(readChunkDeleted(folds([[1, "u1", "사유"], [9, "u9", ""]]), mine)).toBe(readChunkDeleted(folds([[1, "u1", "사유"]]), mine));
// unwrap-ai-model.test.ts
const prev = new Map([[4, [1, 2]]]); expect(keepSamePreviews(prev, new Map([[4, [1, 2]]]))).toBe(prev); expect(keepSamePreviews(prev, new Map([[4, [2, 1]]]))).not.toBe(prev);
```
- [ ] 실패 확인 `VT paper-chunk-model.test.ts unwrap-ai-model.test.ts` → 구현: `deps`(1577)의 `strips?.pending` · `strips?.deleted?.folds`를 덩어리마다 위 글로, `previews`는 렌더 중 상태 맞추기(`useNumberArrival`과 같은 꼴, 이펙트 없음)로 같은 Map을 지킨다. 표 머리 알약(`place.at === "table"`)은 그 표 Unit이 든 덩어리의 글에 넣는다. → 통과 확인 같은 명령 → 커밋 `perf(paper): chunk deps follow only what is inside — 덩어리 다시 그리기를 그 안의 값으로 좁힘`
- **확인**(메인 세션) `SCENARIO=filter` · `keys` · `commits`의 앞뒤를 결과 문서에 두 열로(A2-R5 · AC2). **스모크** 바뀜 없음(`3021` 필터 접기 그대로). **설명서** 없음. **CHANGELOG** `필터를 켠 긴 문서에서 글쇠 반응이 빨라짐.`
- **세워 둘 조건** ① 필터를 켠 채 스크롤이 튄다. ② 목표에 못 미친다(다음 원인 `perf/assign-<원인>` 또는 진짜 가상화를 사용자에게).

## perf/assign-number-input (재서 100ms를 넘을 때만)
- **목표** — 번호 칸 글자마다 반응이 CPU 4배에서 100ms 안이다(§6-1). **들어가는 조건**: `SCENARIO=number`의 가운데 값이 100ms를 넘는다. 넘지 않으면 브랜치를 만들지 않고 값을 결과 문서에 적는다.
- **Files** — Modify `components/paper/paper.tsx:329-343,472-486`, `components/paper/number-cell.tsx:200-345`, `components/ui/delegated-tip.tsx:34-46`, `lib/number-model.ts` · `.test.ts`.
- **Interfaces** — Consumes: `listFollowPreview`(그대로, 서버 `plan_follow`의 사본). Produces: `createFollowPreview(order: readonly ViewUnit[]): (unitId: number, text: string) => FollowPreview`(같은 물음이면 같은 객체).
### T1 치는 글은 칸 안에서
- [ ] 시험 `number-model.test.ts`: `const preview = createFollowPreview(order); const first = preview(7, "5.1"); expect(preview(7, "5.1")).toBe(first); expect(first).toEqual(listFollowPreview(order, 7, "5.1")); expect(preview(7, "5.2")).not.toBe(first);`
- [ ] 실패 확인 `VT number-model.test.ts` → 구현: 치는 글은 `NumberCell` 안 상태로 두고 용지에는 `useDeferredValue`로 낮춘 값만 넘긴다(미리 보기 점선은 한 박자 뒤). `continuous`는 편집을 열 때 한 번. 툴팁 상태는 용지 밖으로. → 통과 확인 `VT number-model.test.ts rule-cases.test.ts number-kind-model.test.ts` → 커밋 `perf(number-cell): keep typing inside the cell — 번호 입력은 칸 안에서만 다시 그림`
- **스모크** 바뀜 없음(`4132-4510` 번호 칸 단계 그대로). **설명서** 없음. **CHANGELOG** `번호 칸에 치는 글자가 바로 보임.` **세워 둘 조건** `rule-cases` 대조가 깨진다.

## 정한 것 (계획을 쓰며 나온 물음의 답)

1. 실패 알림의 **버리기**와 되묻기 취소는 실패한 것과 대기 전부를 버리고 몇 개였는지 알린다.
2. 번역 줄의 지우기 단추를 확정 옆에 새로 만든다(H5).
3. 이미 있는 `match` 삭제 후보는 그대로 보이고 다시 계획해도 stale로 만들지 않는다.
4. 다른 Bundle 이동을 없애며 바뀌는 `smoke/assign.mjs:665-687` · `assign-context-menu-model.test.ts:55,73`은 동작이 바뀌어 따라 바뀌는 시험이다. 같은 수로.
5. 상수를 켜는 backend 시험(T2 · T3 목록)은 기대값 그대로 고정물만 더한다.
6. `assign.mjs:5295-5311`(짝 판 폭)도 따라 바뀌는 시험이다.
7. 떼는 폭 1440 · 판 320 × 70%는 시안 장면 m7에서 좋음을 받았다(2026-11-25).

## 자체 점검
- §4-1 = new-edit-undo T1(중복 · `settled`) · T2(칸 순서) · T3(세기). §5 H1 = T1 · T8, H2 = T1(단계) · T4(더보기) · T5(New 칸 · 오른쪽 칸) · T6(Documents · Outputs), H3 = T5, H4 = T2 · T4, H5 = T6(`fill_tobe`) · T7, "확인" = T7 · T8. §6 S2 = pair-spot-scroll, S3 = inspector-float. §14의 C 시트 = T3 · T8, 자동 칸 추천 = T8, `canStart` = queue T2.
- A1-R1 = queue T3 ①, R2 = ② · T2, R3 = T1 · ③, R4 = T2 · ②, R5 = T4, R6 = ③, R7 = T1 · T4, R8 = ① · ③, AC1–AC3 = T5 ①–④, AC4 = T5 둘째 줄, T1–T3(시험) = T1 · T2 · T5. A2-R1~R4 = measure, R5 = filter-chunks · number-input(나머지 원인은 결과 문서의 몫을 보고 `perf/assign-<원인>`으로), R6 = instant-motion. F2-R6~R8 = remove-bundle-move. S1 = queue T5 ①, S2 = instant-motion T2.
- 이름은 색인 표와 같다: `isDraftingOn` · `HIDDEN_AI_KINDS` · `AUTO_CLASSIFY` · `PLAN_DELETES` · `SHOW_C_SHEET` · `createCommandQueue` · `QueuedCommand` · `isBarrier` · `enqueue`. `AssignCommand`의 `save`는 `draft`(texts · suggestionId)를 싣고(계획 2), 계획 3이 `kind: "link"`를 더한다.
