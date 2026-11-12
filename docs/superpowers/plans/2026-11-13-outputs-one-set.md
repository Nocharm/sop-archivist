# 결과물 한 벌 (언어 축 (4)) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결과물 A·B·C·요약·Excel을 판(ko/en) 없는 한 벌로 바꾸고, 번호를 문장마다 한 줄로 세며, 칸 제목 배정·옛 문서 버전 검토 조건·같은 시트 모델의 Excel 미리보기를 더한다.

**Architecture:** 줄(의미 묶음 = 짝 하나 또는 짝 없는 판단 단위 하나)을 스냅숏에서 한 함수(`output_rows.build_meaning_rows`)가 짓고 결과물 A·B·요약·검토 조건이 함께 쓴다. 결과물은 `outputs.py`의 순수 함수가 한 벌로 계산하고, Excel과 미리보기는 `sheet_model.py`가 만든 하나의 시트 모델을 각각 xlsx(`excel_export.py`)와 JSON(`GET …/export/preview`)으로 낸다. 번호 기본값·끼워 넣기는 순수 함수(`target_placement.arrange_new_targets`)가 정하고 저장(`decisions`)·AI 번역(`ai/translate`)이 쓴다.

**Tech Stack:** Python 3.11 · FastAPI · SQLAlchemy(async) · Alembic · openpyxl · Pillow · pytest / Next.js 16 · React 19 · TypeScript strict · vitest · Playwright 스크립트(`frontend/scripts/pw-*.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-13-outputs-one-set-design.md`(아래 §는 이 문서). 위 문서 `docs/superpowers/specs/2026-11-12-language-axis-design.md`("수정안"), 제품 명세 `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`("제품 명세") §6.4·§6.5·§7.13–§7.15·§12.

## Global Constraints

- 작업 브랜치 `feat/outputs-one-set`(워크트리 `.claude/worktrees/outputs-one-set`). 원본 체크아웃(`/Users/hyeonjin/Documents/sop-archivist`)은 건드리지 않는다. 태스크마다 커밋하고, **버전 올리기·푸시는 Task 13에서 한 번**(dev에 PATCH 하나, `main`은 사용자가 정한다 — §11 릴리스).
- backend 명령은 워크트리 `backend/`에서 원본 venv로 돈다(워크트리에 `.venv`가 없다): `PY=/Users/hyeonjin/Documents/sop-archivist/backend/.venv/bin/python`. 한 파일 `$PY -m pytest tests/<file> -q`, 전체 `$PY -m pytest tests/ -q -n auto`, 린트 `/Users/hyeonjin/Documents/sop-archivist/backend/.venv/bin/ruff check app/ tests/ scripts/`. Alembic `$PY -m alembic revision --autogenerate --rev-id 0014 -m "<설명>"`.
- frontend 명령은 워크트리 `frontend/`에서(`node_modules` 있음): `npx vitest run [file]`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run build`(경고 0, `next dev`를 먼저 내린다).
- 커밋 메시지 `type(scope): English summary — 한국어 요약` + 끝에
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01YNNLvBwBj2gS8W3Z7o5G64`. 커밋마다 `PROGRESS.md` 맨 위 날짜 아래에 1–3줄(맥락·결정 위주)을 같은 커밋에 넣는다.
- 결과물 이름·값(§3 O1·O2 — 그대로 쓴다):
  - 파일 이름 `BND-0004_<묶음 제목>_<KST yyyymmdd-HHmm>.xlsx`, 묶음당 파일 하나. 제목이 비면 `BND-0004_<KST yyyymmdd-HHmm>.xlsx`(내 판단). 제목 정리 규칙(NFC·`\/:*?"<>|`·제어 문자 → `_`·150자)은 지금 `build_export_file_name` 그대로.
  - 시트 이름·순서 `A Comparison` · `B Flow` · `C New documents` · `Info`.
  - Excel·미리보기 A 20열, 순서 그대로: `Row` · `Old doc` · `Ver.` · `Location` · `Unit ID` · `Old text` · `Destination` · `New doc` · `New doc title` · `Place` · `No.` · `New text` · `AI suggestion` · `Change` · `Remark` · `Status` · `Confirmed by` · `Confirmed at` · `Group ID` · `Checks`.
  - 화면 A 7열: `Row` · `Old unit` · `Source` · `Destination` · `New sentence` · `Remark` · `Status`.
  - 시스템 표시 값은 영어: 변경 종류(`As is`…, 새로 `Slot heading`, `Translated · Added`), 상태, 보낸 곳 종류, 위치 표기, 흐름도 글자. 원문·확정 문장·AI 문장·Remark·제목은 쓰인 그대로.
  - 확정률 글 `28%` 꼴(반올림은 `floor(rate*100 + 0.5)`, 줄이 0이면 `0%`).
  - 요약의 미배정 이름은 **`No destination`**(`no_destination`), 진행 숫자의 `Unassigned`와 다른 숫자다(§5.3).
- Graphite 테마(§9, O7): 머리 줄 바탕 `#2B2F36`·흰 굵은 글자, 머리 아래 `thick` `#202124`, 묶음 첫 줄 위 `medium` `#5F6368`, 묶음 안 줄 위 `thin` `#9AA0A6`, 흐린 글자 `#9AA0A6`. 그 밖의 바탕색·줄무늬 없음. 미리보기도 같은 색·선을 화면 테마와 무관하게("종이"). 프런트 색은 `src/styles/tokens.css` 토큰으로만(raw hex는 tokens.css 밖 금지, 다크에서 값을 바꾸지 않는다).
- 지금 Excel에서 그대로 두는 것: 열 폭 표, 줄 고정 `A3`(1행 상태 줄·2행 머리), A 자동 필터, 수식 방지 `write_text_cell`, 32,767자 나누기와 이어짐 표시, 주석 줄 기울임.
- 함께 쓰는 칸(O6): `Row`·`Destination`·`New doc`·`New doc title`·`Remark`는 Excel에서 줄마다 되풀이하고 **같은 묶음 안에서 바로 윗줄과 값이 같을 때만** 흐리게. `Status`·`Change`·위치·Unit ID·Old doc·Ver.는 줄마다 자기 값, 흐리지 않는다.
- API(§8): `?lang=`은 라벨 언어만(없으면 `en`), 요약 `GET …/summary`는 `Summary` 하나, `GET …/export.xlsx`는 `lang`·`theme` 없음, 새 `GET …/export/preview`, 422 `number_style_pair_mismatch` 삭제.
- 업무 규칙 거절 코드·사유를 더하면 같은 커밋에 `rule.<code>`(사유는 `rule.<code>.<reason>`) en·ko 문구. 화면 글자는 en·ko 한 쌍(`i18n-messages.test.ts`). 화면·동작·라벨을 바꾸는 커밋은 `frontend/public/manual/user-manual.md` 해당 조각도(굵은 영어 라벨 = en 문구, `manual-content.test.ts`). 새 인터랙티브 요소에 `data-testid`(`surface-role`).
- 모델·제약을 바꾸면 Alembic 리비전(다음 번호 `0014`), 새 의존성 없음, Python 3.11 문법. AI 페이로드에 실명 금지는 그대로(이 계획의 `Confirmed by` 실명은 Excel·화면만 — §4.5).
- 자료 옮기기(Alembic 데이터 변경)는 하지 않는다(§6 "지금 자료"). 개발 스택에 남은 묶음의 번호는 사람이 C에서 고친다 — CHANGELOG에 적는다.
- **지켜야 하는 테스트**(§11, 태스크마다 전체 스위트로 확인): `test_sop_decisions.py::test_every_old_cover_unit_has_exactly_one_status`, `::test_one_unit_to_both_languages_is_not_a_split`, `::test_two_targets_in_the_source_language_are_still_a_split`, `::test_target_remark_round_trips`; `test_sop_review.py::test_progress_and_readiness_count_the_same_rows`, `::test_readiness_does_not_read_document_text`, `::test_readiness_uses_bounded_queries`; `test_sop_progress.py::test_progress_counts_a_pair_as_one_row`, `::test_progress_counts_a_table_once_and_not_its_cells`, `::test_row_status_is_the_least_finished_member`; `test_sop_pair_settle.py::test_pair_dissolves_when_members_go_to_different_documents`, `::test_pair_stays_when_members_go_to_different_sections_of_one_doc`.

## Review Focus

1. **빈 묶음·문서만 있는 묶음** — 옛 줄이 0인데 확정률을 나누거나 미리보기가 빈 시트에서 죽는 것. 기대: 요약 0과 `0%`, 미리보기 네 시트가 머리 줄만. → Task 3 `test_summary_of_an_empty_bundle`, Task 9 `test_preview_of_an_empty_bundle`.
2. **32,767자를 넘는 칸이 묶음 안에 있을 때** — 이어짐 줄이 새 묶음 테두리를 긋거나 흐림 판정을 끊으면 Excel과 미리보기가 다르게 보인다. 기대: 이어짐 줄은 `in_group`, 미리보기 JSON과 xlsx의 줄 수·칸 글이 같다. → Task 9 `test_continued_rows_stay_in_their_group`.
3. **파일 이름에 못 쓰는 글자·NFD 한글·`=`로 시작하는 제목** — 받은 이름과 미리보기에 보인 이름이 다르면 사용자가 파일을 못 찾는다. 기대: 두 곳이 같은 정리 결과. → Task 9 `test_file_name_is_the_same_in_preview_and_download`.
4. **칸 제목에 이은 옛 제목 하나를 떼어 낼 때** — 두 옛 문서가 한 칸 제목을 함께 쓰는데 하나를 미배정으로 돌리면 칸 제목이 통째로 사라지거나 남은 출처가 보류가 되면 안 된다. 기대: 남은 출처로 그대로, 마지막 출처가 떠나면 칸 제목도 없어진다. → Task 6 `test_detaching_one_source_of_a_slot_heading_keeps_it`.
5. **극단 묶음(W1)의 미리보기 크기** — 수천 줄을 JSON으로 보내 창이 멈추는 것. 기대: 시트마다 상한까지만 싣고 `truncated`·`total_rows`로 "파일에는 전체"를 알린다. → Task 9 `test_preview_caps_rows_per_sheet`.

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| Create `backend/app/sop/output_rows.py` | 의미 묶음 줄 목록(`MeaningRow`)·한 언어 글 수 — 스냅숏만 받는 순수 함수, 결과물·요약·검토 조건·B가 함께 쓴다 | 1 |
| Modify `backend/app/sop/snapshot.py` | `DocumentInfo.language_layout`, `TargetInfo.remark`, 확정한 사람 이름 읽기 `load_people_names` | 1, 2 |
| Modify `backend/app/sop/outputs.py` | A·B·C·요약 한 벌, 번호 한 줄 세기·정렬 키, 칸 제목 표시 | 2, 3, 6 |
| Modify `backend/app/sop/output_labels.py` | 변경 종류 `heading`·`translated_added` 표시 | 2, 6 |
| Modify `backend/app/routers/sop_outputs.py` | `?lang=` 기본 `en`, 요약 하나, 미리보기, 번호 표시 짝 옮기기·번역 잠금 삭제, 칸 제목 순서 제외 | 2, 3, 4, 6, 9 |
| Modify `backend/app/sop/detach.py`, `backend/app/sop/ai/translate.py` | 번역 표시를 출처로 덮지 않음, 새 AI 번역은 생략·출처 뒤 | 4 |
| Create `backend/app/sop/target_placement.py` | 새 문장 기본 표시·순서(O10)와 출처 뒤 끼워 넣기 | 4, 5 |
| Modify `backend/app/sop/decisions.py` | O10 적용, 칸 제목 저장·출처 더하기 | 5, 6 |
| Modify `backend/app/sop/constants.py`, `models.py`, Create `backend/alembic/versions/0014_target_kind_slot_heading.py` | `slot_heading`·`heading`, `kind` 길이 | 6 |
| Modify `backend/app/sop/review.py` | 막는 이유 `missing_doc_versions`, 다음 행동 `fill_doc_versions` | 8 |
| Create `backend/app/sop/sheet_model.py` | 네 시트 모델(칸 글·줄 종류·흐림·기울임·이어짐), 미리보기 상한 | 9 |
| Modify `backend/app/sop/excel_export.py` | 시트 모델 → xlsx(Graphite), 파일 이름 | 2, 3(임시), 9 |
| Modify `backend/scripts/synthetic_sop.py`, `sop_demo_driver.py`, `seed_sop_worst.py`, `backend/tests/sop_helpers.py` | 한 벌 결과물·버전 채우기 | 2, 3, 8 |
| Create `frontend/src/lib/output-groups.ts` (+test) | 화면 A의 함께 쓰는 칸 보이기, C 의미 묶음 경계 | 10 |
| Modify `frontend/src/lib/api-sop.ts`, `api.ts`, `section-number.ts`, `target-order.ts`, `outputs-view-prefs.ts`, `classify-model.ts`, `stages.ts`, `i18n-messages.ts` | 타입·호출·규칙·문구 | 4, 6, 7, 8, 10, 11 |
| Modify `frontend/src/app/bundles/[id]/outputs/page.tsx`, `review/page.tsx`, `page.tsx`(개요), `components/outputs/*`, `components/assign/destination-tree.tsx`·`assign-help.tsx`, `components/modal.tsx`, `styles/tokens.css` | 화면 | 7, 8, 10, 11 |
| Delete `frontend/src/components/outputs/edition-toggle.tsx` | 판 전환 걷기 | 10 |
| Create `frontend/src/components/outputs/export-preview.tsx`, `sheet-view.tsx` | 미리보기 창 | 11 |
| Modify `frontend/public/manual/user-manual.md`, `frontend/scripts/pw-smoke-sop.mjs`, `pw-manual-shots.mjs` | 설명서·스모크 | 7, 8, 10, 11, 12 |
| Modify `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`, `backend/CLAUDE.md`, `docs/README.md`, Delete 두 설계 문서 | 흡수 | 13 |

---

### Task 1: 의미 묶음 줄 목록 한 곳 (backend)

**Files:**
- Create: `backend/app/sop/output_rows.py`
- Modify: `backend/app/sop/snapshot.py` (`DocumentInfo`, `TargetInfo`, `load_bundle_snapshot`, `_load_targets`)
- Modify: `backend/app/sop/outputs.py:841-856` (`build_review_facts`)
- Test: `backend/tests/test_sop_progress.py`, `backend/tests/test_sop_snapshot.py`

**Interfaces:**
- Consumes: `BundleSnapshot.pair_of`, `status.get_cover_status`·`pick_row_status`, `snapshot.SINGLE_LANGUAGE_KINDS`·`TWO_LANGUAGE_LAYOUTS`·`NEUTRAL`.
- Produces:
  - `DocumentInfo.language_layout: str`, `TargetInfo.remark: str` (include_text=False면 `""` — `remark`도 defer).
  - `@dataclass(frozen=True) class MeaningRow: key: int; unit_ids: tuple[int, ...]; status: str` — `key`는 짝 id, 짝이 없으면 `-unit_id`(진행 숫자 `row_key`와 같은 값), `unit_ids`는 판단 단위(옛 문서·활성·`group_unit_id is None`, 표·행 단위 포함, 묶인 칸 제외)를 `order_key` 순, `status`는 구성 단위 `get_cover_status`의 `pick_row_status`.
  - `build_meaning_rows(snap: BundleSnapshot) -> list[MeaningRow]` — 첫 단위 `order_key` 순.
  - `count_single_language(snap: BundleSnapshot) -> int` — `load_bundle_progress`의 `single_language`와 같은 규칙(짝 없음·종류 `sentence|heading`·문서 배치가 두 언어·번역 출처나 출처 연결로 다른 언어(중립 제외) 새 문장이 없음).
  - `get_new_meaning_key(snap: BundleSnapshot, target: TargetInfo) -> int` — 입구 2 새 문장의 묶음 키: `snap.pair_of.get(target.new_unit_id, -target.new_unit_id)`(§7.2).

- [ ] **Step 1: Write the failing tests**

`tests/test_sop_progress.py`에 더한다(같은 `_setup`·본문 상수 재사용):

```python
def test_meaning_rows_match_progress(client: TestClient) -> None:
    # 짝(1:1·1:2)·표·그림·짝 없는 문장이 섞인 본문 — 진행 숫자와 스냅숏 줄 목록이 같은 줄이다
    fx = _setup(client, PAIR_TABLE_BODY)
    progress = get_bundle(client, fx.bundle_id)["progress"]
    snap = _load_snapshot(fx.bundle_id)          # run_in_session(load_bundle_snapshot)
    rows = build_meaning_rows(snap)
    assert len(rows) == progress["total"]
    assert Counter(row.status for row in rows) == Counter({k: progress[k] for k in ("unassigned", "ai_suggested", "confirmed", "on_hold") if progress[k]})
    assert count_single_language(snap) == progress["single_language"]
    assert all(snap.units[a].order_key < snap.units[b].order_key for row in rows for a, b in itertools.pairwise(row.unit_ids))
```

`PAIR_TABLE_BODY`는 이 파일의 기존 짝 본문(`KO_ON`·`EN_ON`…)에 `tbl(...)` 하나를 붙인 본문으로 정의한다. `tests/test_sop_snapshot.py`에 `test_snapshot_reads_layout_and_remark`(문서 배치 `ko_en_separate`로 PATCH, 출처 없는 입구 2 새 문장에 remark 저장 → `DocumentInfo.language_layout == "ko_en_separate"`, `TargetInfo.remark == "Synthetic remark"`, `include_text=False`면 `remark == ""`).

- [ ] **Step 2: Run to verify they fail**

Run: `$PY -m pytest tests/test_sop_progress.py::test_meaning_rows_match_progress tests/test_sop_snapshot.py::test_snapshot_reads_layout_and_remark -q`
Expected: FAIL — `ImportError: cannot import name 'build_meaning_rows'` / `AttributeError: ... 'language_layout'`.

- [ ] **Step 3: Implement** `output_rows.py` 세 함수와 스냅숏 필드. `build_review_facts`의 `row_statuses` 계산을 `build_meaning_rows`의 `status` 세기로 바꾼다(`ReviewFacts` 모양은 그대로). 모듈 머리 docstring에 "진행 숫자(`load_bundle_progress`)·배정 화면(`buildRows`)과 같은 줄" 한 줄.

- [ ] **Step 4: Run to verify they pass + invariants**

Run: `$PY -m pytest tests/test_sop_progress.py tests/test_sop_snapshot.py tests/test_sop_review.py -q` → PASS (지켜야 하는 `test_progress_and_readiness_count_the_same_rows`·`test_readiness_uses_bounded_queries`·`test_readiness_does_not_read_document_text` 포함). 그다음 전체 `$PY -m pytest tests/ -q -n auto` → PASS, ruff 0.

- [ ] **Step 5: Commit**

```bash
git add backend/app/sop/output_rows.py backend/app/sop/snapshot.py backend/app/sop/outputs.py backend/tests/test_sop_progress.py backend/tests/test_sop_snapshot.py PROGRESS.md
git commit -m "refactor(outputs): one meaning-row list shared by outputs and readiness — 의미 묶음 줄 목록을 한 곳에"
```

---

### Task 2: 결과물 A 한 벌 (backend)

**Files:**
- Modify: `backend/app/sop/outputs.py` (`ARow`, `_group_dests`·`_describe_dest`·`_build_unit_rows`·`_build_translation_row`·`_build_old_rows`·`_build_orphan_rows`·`_build_new_row`·`build_output_a`)
- Modify: `backend/app/sop/output_labels.py` (`change_types`에 `translated_added`)
- Modify: `backend/app/sop/snapshot.py` (`load_people_names`)
- Modify: `backend/app/routers/sop_outputs.py:95-103` (`get_output_a`)
- Modify: `backend/app/sop/excel_export.py` (`_write_sheet_a`가 새 `ARow`를 쓰도록 최소 수정 — 시트 모양은 Task 9)
- Modify: `backend/scripts/sop_demo_driver.py` (`load_outputs`), `backend/tests/test_sop_e2e.py`
- Test: `backend/tests/test_sop_outputs.py`, `backend/tests/test_sop_numbering.py`(A 번호 단언), `backend/tests/test_sop_excel.py`(A 열 단언 최소)

**Interfaces:**
- Consumes: Task 1 `build_meaning_rows`, `get_new_meaning_key`, `TargetInfo.remark`.
- Produces:
  ```python
  class ARow(BaseModel):
      row_no: int                 # 묶음마다 1부터: 옛 문서 줄 → 고아 번역 → 신규
      is_group_start: bool
      row_kind: Literal["unit", "table", "cell", "translation", "new"]
      old_doc_code: str; old_doc_version: str; location: LocationOut; unit_id: int | None; display_id: str; source_text: str
      dest_kind: str; dest_doc_code: str; dest_doc_title: str; dest_location: str; dest_number: str; dest_is_note: bool
      confirmed_text: str; ai_text: str
      change_type: str            # 저장 코드, 그리고 표시 전용 "translated_added"
      remark: str                 # 묶음의 Remark — 묶음의 모든 줄에 같은 값
      status: str                 # 줄마다: 옛 단위 줄은 get_cover_status, 번역·신규 줄은 새 문장 상태
      confirmed_by: str | None    # format_confirmer 결과
      confirmed_at: KstDatetime | None
      group_id: str | None
      warnings: list[dict[str, str]]
  def build_output_a(snap: BundleSnapshot, lang: Lang, people: Mapping[str, str]) -> list[ARow]
  def format_confirmer(login_id: str | None, people: Mapping[str, str]) -> str | None   # "이름 (ID)", 없으면 "ID", None은 None
  async def load_people_names(session: AsyncSession, login_ids: Collection[str]) -> dict[str, str]  # snapshot.py — 활성 직원만, name 없으면 korean_name, 둘 다 비면 뺀다. 질의 한 번
  ```
  `lang`·`reason` 필드는 없어진다. `OutputLabels.change_types`에 `"translated_added": "Translated · Added"`(ko `"번역 · 추가"`).

**줄 짜기 규칙(§4.1·§4.4·§4.5 — 순수 계산, 시그니처로 정해지지 않아 적는다):**
1. 묶음 순서: `build_meaning_rows` 순 → 출처 단위가 스냅숏에 없는 번역(고아, 번역 출처 id 순, 한 줄짜리 묶음) → 입구 2 신규(새 문서 순·C 칸 순, `get_new_meaning_key`로 묶음). 각 묶음 `row_no` = 1부터 연속.
2. 의미 묶음 안: 구성 단위(`unit_ids` 순)마다 — 표·행 단위면 표 줄 하나(보낸 새 문서마다) 뒤에 그 칸 문장 줄(`row_kind="cell"`), 아니면 단위 줄(보낸 새 문서마다 한 줄, 없으면 삭제·이동·미배정 한 줄). 각 단위(칸 포함) 줄 **바로 뒤**에 그 단위의 번역 줄: 번역 기원(`translation_source_unit_id`)과 출처가 이 단위 하나인 `change_type == "translated"` 새 문장(사람이 쓴 다른 언어 문장), 그다음 `Translated · Added` 줄(아래 4).
3. 단위 줄의 보낸 곳은 그 단위의 새 문장 중 **`change_type != "translated"`인 것만**(자기 언어·중립·합침) — 나눔은 ①②. 한 문서에 번역 새 문장만 있으면 그 문서 줄은 보낸 곳(종류·문서·자리)만 있고 New text·No.·Change가 빈다(내 판단).
4. 입구 2 한쪽만 맞춘 짝(§4.5): 출처 없는 `new_doc` 새 문장의 새 문서 짝(`get_new_meaning_key`)에 출처 있는 새 문장이 있으면, 그 출처의 첫 옛 단위 줄 뒤에 `row_kind="new"`, `change_type="translated_added"`, 옛 칸 비움. 신규 묶음에는 넣지 않는다.
5. Remark: 옛 묶음은 구성 단위 판단의 `reason`(겹치지 않게, `"\n"`으로 이음) 뒤에 그 단위들의 출처 있는 새 문장 `remark`(비지 않은 것, 겹치지 않게). 신규 묶음은 새 문장들 `remark`. 고아 번역은 `""`.
6. `is_group_start`는 묶음 첫 줄만 True. 번호(`dest_number`)는 Task 3 전까지 지금 `_number_targets`의 새 문장 자기 언어 판 값(중립은 `ko` 판)을 쓴다 — Task 3이 한 줄 세기로 바꾼다.

- [ ] **Step 1: Write the failing tests** (`tests/test_sop_outputs.py`, 기존 `_setup` 픽스처와 새 `_setup_pair_edges` 픽스처 — 한/영 연달아 옛 문서 + SOP 하나, 아래 경우마다 저장)

```python
def test_output_a_old_groups_equal_old_rows_and_every_cover_unit_appears_once(client):
    fx = _setup(client)
    rows = _get_output(client, fx.bundle_id, "outputs/a")
    progress = get_bundle(client, fx.bundle_id)["progress"]
    old = [r for r in rows if r["row_kind"] in ("unit", "table", "cell") or (r["row_kind"] == "translation" and r["unit_id"])]
    assert max(r["row_no"] for r in old) == progress["total"]
    assert [r["row_no"] for r in rows if r["is_group_start"]] == list(range(1, len({r["row_no"] for r in rows}) + 1))
    cover = Counter(r["display_id"] for r in rows if r["row_kind"] in ("unit", "cell"))
    assert cover[_display(fx.old1, DUPLICATE)] == 2          # 중복 배정은 보낸 곳마다
    assert all(count == 1 for disp, count in cover.items() if disp != _display(fx.old1, DUPLICATE))
    assert Counter(r["row_kind"] for r in rows)["table"] == 1 and sum(r["source_text"] == "" and r["row_kind"] == "unit" for r in rows) == 0

def test_human_written_other_language_sentence_is_a_translation_line(client):
    # 영어 옛 문장 하나 → 같은 SOP 칸에 영어 + 한글 새 문장(한 저장)
    rows = ...
    unit_line, translation_line = _group_lines(rows, en_display)
    assert (unit_line["change_type"], unit_line["confirmed_text"]) == ("as_is", EN_TEXT)        # ①② 아님, split 아님
    assert (translation_line["row_kind"], translation_line["source_text"], translation_line["change_type"]) == ("translation", "", "translated")
    assert unit_line["row_no"] == translation_line["row_no"] and not translation_line["is_group_start"]
```
(번역 건수에 드는 것은 Task 3 `test_human_translation_counts_in_summary`가 본다.)

이어서 수정안 §7 모서리마다 하나씩(테스트 이름과 핵심 단언):
- `test_a_pair_split_across_documents_is_two_groups` — 짝이 다른 새 문서로 가 풀림 → `row_no` 둘.
- `test_ko_only_link_leaves_the_english_line` — 한글만 이음(`release_unit_ids`) → 영어 줄은 다른 묶음, 보낸 곳 빈 미배정.
- `test_delete_plus_new_are_two_groups` — 옛 단위 삭제 + 입구 2 신규 → 삭제 묶음 한 줄(`dest_kind == "delete"`, New text `""`) + 끝 신규 묶음.
- `test_one_to_two_pair_is_three_lines_in_one_group` — 1:2 짝 → 같은 `row_no` 세 줄.
- `test_unpaired_sentence_is_a_one_line_group`, `test_ai_translation_line_follows_its_source`(`tests/fake_ai.py` 경로 없이 번역 새 문장을 `run_in_session`으로 넣는다), `test_figure_and_data_table_once`(그림 한 줄, 표 줄 + 칸 줄 한 묶음), `test_layout_table_cells_are_sentences`, `test_suggested_pair_is_one_group`(제안 상태 짝), `test_mixed_language_unit_is_one_line`(한/영 합친 단위).
- `test_one_side_matched_new_pair_is_translated_added_line` — 입구 2 새 문서 한/영 짝 중 한쪽만 옛 단위와 맞춤 → 옛 묶음 안 `("new", "translated_added")` 줄, 끝 신규 묶음에는 없음.
- `test_remark_joins_reasons_and_target_remarks` — 짝 두 단위 판단 reason이 다름 + 새 문장 remark → `"reason A\nreason B\nremark"`, 묶음 모든 줄이 같은 값.
- `test_confirmed_by_shows_name_and_id` — dev 디렉터리 직원 → `"<name> (qa.member)"` 꼴(이름은 디렉터리 값을 읽어 비교), 디렉터리에 없는 로그인(`run_in_session`으로 `confirmed_by="ghost.user"`) → `"ghost.user"`, 퇴직(`active=False`) → ID만.
- `test_output_a_requires_lang_and_membership` → `test_output_a_defaults_to_english_labels_and_needs_membership`로 고친다: `lang` 없이 200이고 위치 표기가 영어(`"Paragraph"`), `lang=ko`면 `"문단"`, 비멤버 403.

`test_output_a_rows_follow_line_rules`·`test_output_a_table_lines_for_rows_empty_tables_and_dropped_cells`는 `lang` 루프와 `reason`을 걷어 한 벌로 고친다(단언 값은 그대로, `reason` → `remark`).

- [ ] **Step 2: Run to verify they fail**

Run: `$PY -m pytest tests/test_sop_outputs.py -q -k "output_a or translated_added or remark or confirmed_by or group"`
Expected: FAIL — `KeyError: 'row_no'` / `422`(lang 없음).

- [ ] **Step 3: Implement** 위 규칙으로 A를 다시 짠다. `get_output_a(lang: Literal["ko","en"] = Query("en"))`가 `load_people_names(session, {row 확정자})`를 스냅숏 읽기 **전**에 부르지 않고 스냅숏 뒤 같은 세션에서 부른 뒤 `asyncio.to_thread(build_output_a, snap, lang, people)`(트랜잭션은 `_load_snapshot_for_read`처럼 끝낸다). `excel_export._list_a_cells`는 `row.lang` 칸을 `str(row.row_no)`로, `row.reason`을 `row.remark`로만 바꿔 두 판 export가 계속 돈다(Task 9가 갈아엎는다). `sop_demo_driver.load_outputs`는 A를 한 번(`lang` 없이) 읽고, `test_sop_e2e.py`의 A 단언(`{row["status"]} == {"confirmed"}`, Excel 줄 수)을 한 벌로 고친다.

- [ ] **Step 4: Run to verify pass + invariants**

Run: `$PY -m pytest tests/test_sop_outputs.py tests/test_sop_numbering.py tests/test_sop_excel.py tests/test_sop_e2e.py -q` → PASS. 전체 스위트 PASS, ruff 0.

- [ ] **Step 5: Commit**

```bash
git add backend/app/sop/outputs.py backend/app/sop/output_labels.py backend/app/sop/snapshot.py backend/app/routers/sop_outputs.py backend/app/sop/excel_export.py backend/scripts/sop_demo_driver.py backend/tests/ PROGRESS.md
git commit -m "feat(outputs): output A as one set of meaning groups — 결과물 A를 의미 묶음 한 벌로"
```

---

### Task 3: 결과물 B·C·요약 한 벌과 번호 한 줄 세기 (backend)

**Files:**
- Modify: `backend/app/sop/outputs.py` (`_get_item_key`, `_number_targets`, `_Index`, `build_output_b`, `CItem`, `CDeleted`·`CMoved`, `build_output_c`, `Summary`, `build_summary`)
- Modify: `backend/app/routers/sop_outputs.py` (`SummaryOut` 삭제, `get_summary`, B·C `lang` 기본 `en`)
- Modify: `backend/app/sop/excel_export.py` (B·C 시트가 새 함수 모양으로 돌게 최소 수정, 요약 이름은 Task 9)
- Modify: `backend/scripts/synthetic_sop.py` (`_summarize` — 언어별 `summary`·`flow_edge_total` 삭제), `backend/scripts/sop_demo_driver.py`, `backend/tests/test_sop_e2e.py`
- Test: `backend/tests/test_sop_outputs.py`, `backend/tests/test_sop_numbering.py`

**Interfaces:**
- Consumes: Task 1 `build_meaning_rows`·`count_single_language`·`get_new_meaning_key`, Task 2 A 줄 짜기.
- Produces:
  ```python
  class CItem(BaseModel):  # 지금 필드 + 
      origin: str                 # units | translation | new_doc — 프런트가 번역 기원의 깊이 단추만 숨긴다
      meaning_key: str | None     # "old:<MeaningRow.key>" | "new:<get_new_meaning_key>" | None(고아 번역) — C 굵은 선
  class CDeleted / CMoved:         # 줄(의미 묶음)마다 하나 — display_id·source_text는 구성 단위 값을 "\n"으로, doc_code·section은 첫 단위, reason은 묶음 Remark
  def build_output_b(snap: BundleSnapshot, lang: Lang) -> FlowGraph
  def build_output_c(snap: BundleSnapshot, lang: Lang) -> COutput      # 칸마다 한 목록(언어 섞임), CItem.lang은 글꼴용으로 남김
  class Summary(BaseModel):
      old_rows: int; assigned: int; no_destination: int; duplicate: int; deleted: int; moved: int
      new: int; translated: int; confirmed_rate: float; single_language: int
  def build_summary(snap: BundleSnapshot) -> Summary
  def number_targets(index: _Index, labels: OutputLabels) -> dict[int, str]   # 이름은 지금 _number_targets에서 lang 인자만 뺀다
  ```
  `GET /{bundle_id}/summary` → `Summary`.

**정렬 키(§6 "순서를 어떻게 지키나", `manual_order=False`) — 본문을 정한다:**

```python
def _get_item_key(index: _Index, doc: TargetDocInfo, target: TargetInfo) -> tuple[object, ...]:
    if doc.manual_order:
        return (target.order_index, target.id)
    units = index.snap.units
    if target.origin == ORIGIN_NEW_DOC and target.new_unit_id in units:   # 입구 2: 새 문서 자리 그대로(지금처럼)
        return (units[target.new_unit_id].order_key, 0, (), 0, target.id)
    base_id = target.translation_source_unit_id if target.translation_source_unit_id in units else (
        target.source_unit_ids[0] if target.source_unit_ids else None)
    if base_id is None:
        return ((2, target.order_index), 0, (), 0, target.id)
    base = units[base_id]
    # 같은 의미(짝)끼리 붙이고 그 안에서 영어 출처 먼저, 번역(변경 종류 translated)은 출처 바로 뒤
    return (index.meaning_anchor[base_id], 0 if base.lang == "en" else 1, base.order_key,
            int(target.change_type == "translated"), target.id)
```
`_Index.meaning_anchor: dict[int, tuple[int, ...]]` — 옛 단위 id → 그 단위가 든 짝 구성원 중 가장 앞 `order_key`(짝 없으면 자기 `order_key`).

**요약 세기(§5.3):** 줄 = `build_meaning_rows`. 줄 처분 = 구성 판단 단위의 처분이 모두 같으면 그 값, 아니면 `unassigned`(→ `no_destination`). `duplicate` = 구성 단위 중 하나라도 보낸 새 문서가 둘 이상인 줄. `new` = 출처 없는 입구 2 새 문장(표 새 문장 제외)의 `get_new_meaning_key` 서로 다른 수(Translated · Added 줄 포함). `translated` = 번역 줄 또는 Translated · Added 줄이 하나라도 든 A 묶음 수(Task 2 묶음 짓기를 함께 쓴다). `confirmed_rate` = 상태 `confirmed`인 줄 / 옛 줄(소수 넷째 자리, 0줄이면 0.0). `single_language` = `count_single_language`.

**B(§5.1):** 옛 문서 노드 건수 = 그 문서의 줄 수, 줄의 문서는 첫 구성 단위의 문서. 간선은 줄마다 그 줄의 보낸 새 문서 집합(구성 단위 합집합), 없으면 처분 노드 하나. 그림은 한 번.

**번호(§6 세는 법):** `number_targets`는 판 거르기를 걷고 칸(WI는 같은 단계 번호의 Instruction·Why를 이어)의 칸 새 문장이 아닌 새 문장 전부를 C 순서로 `number_lines`에 넘긴다. 생략·주석은 세지 않고, 표 칸은 표의 번호.

- [ ] **Step 1: Write the failing tests**

`tests/test_sop_outputs.py`:
```python
def test_summary_numbers(client):          # 고친다 — 한 벌, 판 키 없음
    fx = _setup(client)
    summary = _get_output(client, fx.bundle_id, "summary")
    progress = get_bundle(client, fx.bundle_id)["progress"]
    assert set(summary) == {"old_rows", "assigned", "no_destination", "duplicate", "deleted", "moved", "new", "translated", "confirmed_rate", "single_language"}
    assert summary["old_rows"] == progress["total"]
    assert round(summary["confirmed_rate"] * summary["old_rows"]) == progress["confirmed"]
    assert summary["single_language"] == progress["single_language"]
    c, a = _get_output(client, fx.bundle_id, "outputs/c"), _get_output(client, fx.bundle_id, "outputs/a")
    assert (summary["duplicate"], summary["moved"], summary["new"]) == (1, 1, 1)
    assert summary["deleted"] == len(c["deleted"])                       # 줄마다 한 번
    assert summary["no_destination"] == sum(r["is_group_start"] and r["row_kind"] != "new" and r["dest_kind"] == "" for r in a)
    assert summary["no_destination"] >= progress["unassigned"]           # 처분 기준 ⊇ 상태 기준(§5.3)

def test_human_translation_counts_in_summary(client): ...   # Task 2의 영어 → 영어+한글 저장 뒤 summary["translated"] == 1

def test_summary_of_an_empty_bundle(client):   # Review Focus 1
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    assert _get_output(client, bundle_id, "summary") == {k: 0 for k in SUMMARY_KEYS} | {"confirmed_rate": 0.0}

def test_output_b_counts_rows(client):          # test_output_b_counts를 고친다 — 짝 하나가 한 건
def test_b_counts_a_cross_document_pair_under_its_first_unit(client):  # 짝 두 단위가 다른 옛 문서 → 첫 단위 문서 노드에 1
def test_output_c_one_list_per_slot(client):    # test_output_c_structure를 고친다 — 한 칸에 ko·en 섞임, meaning_key 이웃 같음, 삭제·이동은 줄마다 한 번(짝이면 "\n")
```
`tests/test_sop_numbering.py`:
```python
def test_one_slot_counts_both_languages_in_one_sequence(client):
    bundle_id, sop_id, targets = _setup_pairs(client)   # 짝 셋, 단위마다 따로 저장(기본 번호)
    items = _read_pair_slot_items(client, bundle_id)    # [(lang, number, number_style)]
    assert [lang for lang, _, _ in items] == ["en", "ko"] * 3                 # 같은 의미끼리, 영어 먼저
    assert [number for _, number, _ in items] == ["6.1.1", "6.1.2", "6.1.3", "6.1.4", "6.1.5", "6.1.6"]

def test_omitted_and_note_lines_are_skipped_across_languages(client):   # 생략·주석 건너뛰기, 언어 상관없이
```
`test_output_c_numbers_slots_steps_and_lines`·`test_indent_changes_numbers_in_outputs_a_and_c`·`test_omitted_and_note_lines_take_no_number_in_outputs_a_and_c`는 `lang` 루프를 걷어 한 벌 기대값으로 고친다. `test_a_pair_counts_as_one_and_a_mark_on_one_member_reaches_its_partner`·`test_a_pair_cannot_be_marked_two_ways_at_once`는 Task 4에서 바꾸므로 여기서는 `_read_pair_slot`만 한 벌로(첫 단언의 기대값은 위 한 줄 세기 값).

- [ ] **Step 2: Run to verify they fail**

Run: `$PY -m pytest tests/test_sop_outputs.py tests/test_sop_numbering.py -q`
Expected: FAIL — `KeyError: 'old_rows'` 등.

- [ ] **Step 3: Implement** 위 규칙. Task 2의 번역 건수 `xfail`을 지운다. `synthetic_sop._summarize`와 `expected["summary"]`·`["flow_edge_total"]`를 지우고(내 판단 — 줄 기준 기대값은 서버 짝에서 나와 생성기가 미리 셀 수 없다), `test_sop_e2e.py`는 대신 `summary["old_rows"] == bundle["progress"]["total"]`, `summary["no_destination"] == 0`, `summary["duplicate"] == 1`, A 옛 묶음 수 == `old_rows`, B 간선 합 == A 옛 묶음마다 `max(1, 보낸 새 문서 수)` 합, C 항목 목록 == 언어 거르기를 걷은 `_list_expected_c_items`(한 벌)를 단언한다. `sop_demo_driver.load_outputs`는 `{"a", "b", "c"}` 한 벌을 돌려준다.

- [ ] **Step 4: Run to verify pass + invariants**

Run: `$PY -m pytest tests/test_sop_outputs.py tests/test_sop_numbering.py tests/test_sop_e2e.py tests/test_seed_sop_demo.py -q` → PASS. 전체 스위트 PASS(지켜야 하는 테스트 포함), ruff 0.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(outputs): one-set B, C and summary with one number sequence per slot — B·C·요약 한 벌, 칸마다 번호 한 줄"
```

---

### Task 4: 번호 표시는 문장마다 — 짝 옮기기·번역 표시 잠금 걷기

**Files:**
- Create: `backend/app/sop/target_placement.py` (`insert_after`)
- Modify: `backend/app/routers/sop_outputs.py:206-293` (`_load_pair_partners` 삭제, `_check_number_styles`)
- Modify: `backend/app/sop/detach.py:119-123` (`_follow_source`)
- Modify: `backend/app/sop/ai/translate.py` (`_build_translation`과 그 apply)
- Modify: `frontend/src/lib/i18n-messages.ts` (`rule.number_style_pair_mismatch` en·ko 삭제)
- Test: `backend/tests/test_sop_numbering.py`, `backend/tests/test_sop_ai_translate.py`

**Interfaces:**
- Produces: `async def insert_after(session: AsyncSession, source: TargetSentence) -> int` — 출처와 같은 새 문서의 칸 새 문장이 아닌 새 문장 중 `order_index > source.order_index`를 한 칸씩 밀고(UPDATE 한 번) `source.order_index + 1`을 돌려준다. 문서가 `manual_order`일 때만 부른다.
- 거절 변화: `_check_number_styles`는 입구 2 문서의 422 `number_style_not_allowed`만 남는다(짝 상대 옮기기·`number_style_pair_mismatch`·번역 `translation_locked`·번역 따라 바꾸기 없음). 깊이는 그대로 출처를 따르고 잠긴다(`_check_indents` 그대로). 단계도 그대로.

- [ ] **Step 1: Write the failing tests**

`tests/test_sop_numbering.py`(두 짝 테스트를 바꾼다):
```python
def test_a_mark_stays_on_its_own_line(client):
    bundle_id, sop_id, targets = _setup_pairs(client)
    ids = [t for pair in targets for t in pair]
    (ko_second, en_second) = targets[1]
    styles = _put_styles(client, bundle_id, sop_id, ids, {ko_second: "omitted"})
    assert (styles[ko_second], styles[en_second]) == ("omitted", "numbered")

def test_pair_lines_can_take_different_marks(client):
    ...  # {ko_first: "note", en_first: "omitted"} → 200, 두 값 그대로
```
`tests/test_sop_ai_translate.py`(이 파일의 번역 픽스처·가짜 AI를 쓴다):
```python
def test_new_ai_translation_is_omitted(client): ...            # 번역 행 number_style == "omitted", 출처는 "numbered" 그대로
def test_translation_mark_can_differ_from_its_source(client): ...  # 순서 바꾸기로 번역만 "numbered" → 200, 출처 표시 그대로
def test_source_change_does_not_overwrite_translation_mark(client): ...  # 확정 번역 "note" 뒤 출처 글을 고쳐 sweep → 번역은 보류, 표시 "note" 그대로, 깊이는 출처 값
def test_ai_translation_lands_right_after_its_source_in_a_manual_order_doc(client): ...
    # 순서 바꾸기로 manual_order=True 문서 [A, S, B] → S의 번역 T → order_index 순 [A, S, T, B], A·S·B 서로 앞뒤 그대로
```

- [ ] **Step 2: Run to verify they fail**

Run: `$PY -m pytest tests/test_sop_numbering.py tests/test_sop_ai_translate.py -q`
Expected: FAIL — 짝 상대가 `"omitted"`로 따라옴, 번역 표시 `"numbered"`.

- [ ] **Step 3: Implement** — `_follow_source`에서 `number_style` 줄을 뺀다(깊이는 남김). `_build_translation`은 `number_style=NUMBER_OMITTED`, 문서가 `manual_order`이고 칸 새 문장이 아니면 `order_index=await insert_after(session, source)`(apply 단계 — 묶음 잠금 안). `_check_number_styles`·`_load_pair_partners`와 그 import(`UnitPairMember`, 쓰지 않게 된 것만)를 정리하고 docstring·`OrderItemIn.number_style` 주석을 "이 줄만 바꾼다"로. `backend/CLAUDE.md`의 "번역 줄의 자리는 출처를 따라 잠겨 있다" 문장은 Task 13에서 고친다.

- [ ] **Step 4: Run to verify pass + invariants**

Run: `$PY -m pytest tests/test_sop_numbering.py tests/test_sop_ai_translate.py tests/test_sop_outputs.py -q` → PASS; `cd ../frontend && npx vitest run src/lib/i18n-messages.test.ts` → PASS; 전체 backend 스위트 PASS, ruff 0.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(numbering): a number mark belongs to its own sentence — 번호 표시는 그 문장에만, 번역 표시 잠금 해제"
```

---

### Task 5: 새로 놓이는 한/영 짝과 번역의 기본 번호·순서 (O10)

**Files:**
- Modify: `backend/app/sop/target_placement.py` (`NewTarget`·`Arranged`·`arrange_new_targets`)
- Modify: `backend/app/sop/decisions.py` (`_State.pair_of`, `_load_state`, `_write_group`·`_apply_plan`·`_load_next_orders`)
- Test: Create `backend/tests/test_sop_target_placement.py`; Modify `backend/tests/test_sop_numbering.py`

**Interfaces:**
- Consumes: Task 4 `insert_after`.
- Produces:
  ```python
  @dataclass(frozen=True)
  class NewTarget:
      key: str                                   # 저장 요청의 TargetIn.key
      place: tuple[int, str | None, int | None, str | None]   # 새 문서·칸·단계·부분
      meaning: int                               # 첫 출처 단위의 짝 id, 짝 없으면 -단위 id
      lang: str
      source_unit_id: int                        # 첫 출처 단위
      is_translation: bool                       # 결정된 변경 종류가 translated
      source_placed: bool                        # 같은 자리에 같은 출처 단위의 번역 아닌 기존 새 문장이 있다
  @dataclass(frozen=True)
  class Arranged:
      key: str
      number_style: NumberStyle
      after_existing_source: bool                # manual_order 문서에서 기존 출처 바로 뒤에 끼운다
  def arrange_new_targets(items: Sequence[NewTarget]) -> list[Arranged]   # 돌려준 순서 = 끝에 붙일 순서
  ```
  `_State.pair_of: dict[int, int]` — 보낸 단위의 짝 id(질의 한 번 더, `_load_state`).

**`arrange_new_targets` 규칙(§6 기본값·나중 번역 — 시그니처로 정해지지 않아 적는다):**
1. 자리(`place`)별로, 의미(`meaning`)가 처음 나온 순서를 지킨다.
2. 한 의미 안: 번역 아닌 항목을 영어 먼저(그 밖은 원래 순서), 각 번역은 같은 `source_unit_id`의 번역 아닌 항목 바로 뒤(없으면 그 의미 끝).
3. 표시: 한 의미의 번역 아닌 항목에 영어와 다른 문장 언어가 함께 있으면(한/영 짝이 같은 칸에 함께 처음 놓임) **첫 영어만 `numbered`, 그 의미의 나머지 모두 `omitted`**(1:N이면 영어들 다음 한글들). 아니면 번역 아닌 항목은 `numbered`. 번역은 같은 출처의 번역 아닌 항목이 이 목록에 있거나 `source_placed`면 `omitted`, 아니면 `numbered`.
4. `after_existing_source` = 번역이고 `source_placed`이며 같은 출처의 번역 아닌 항목이 이 목록에 없음.

`_write_group` 적용: 새로 만드는 계획(`row is None`, 기원 `units`, 칸 새 문장 아님, 종류 `sentence|table|figure`)만 `NewTarget`으로 모아 결과 표시를 새 행에 쓴다. `manual_order` 문서는 돌려준 순서대로 끝에 붙이고(`next_orders`), `after_existing_source`면 기존 출처 행으로 `insert_after`. `manual_order=False` 문서는 지금처럼 0(정렬 키가 순서를 정한다). **기존 새 문장을 다른 칸으로 옮기는 저장은 표시를 건드리지 않는다**(지금처럼 깊이만 0).

- [ ] **Step 1: Write the failing tests**

`tests/test_sop_target_placement.py`(DB 없음):
```python
P = (1, "procedures.procedure", None, None)
def _t(key, meaning, lang, source, *, tr=False, placed=False, place=P): return NewTarget(key, place, meaning, lang, source, tr, placed)

def test_pair_placed_together_numbers_english_first():
    got = arrange_new_targets([_t("ko", 7, "ko", 1), _t("en", 7, "en", 2)])
    assert [(a.key, a.number_style) for a in got] == [("en", "numbered"), ("ko", "omitted")]

def test_one_to_two_pair_numbers_only_the_first_english():
    got = arrange_new_targets([_t("ko", 7, "ko", 1), _t("en1", 7, "en", 2), _t("en2", 7, "en", 3)])
    assert [(a.key, a.number_style) for a in got] == [("en1", "numbered"), ("en2", "omitted"), ("ko", "omitted")]

def test_unpaired_and_single_language_keep_numbered_in_given_order():
    got = arrange_new_targets([_t("a", -1, "ko", 1), _t("b", -2, "en", 2)])
    assert [(a.key, a.number_style) for a in got] == [("a", "numbered"), ("b", "numbered")]

def test_translation_follows_its_source_omitted():
    got = arrange_new_targets([_t("en", -5, "en", 5), _t("ko", -5, "ko", 5, tr=True)])
    assert [(a.key, a.number_style, a.after_existing_source) for a in got] == [("en", "numbered", False), ("ko", "omitted", False)]

def test_later_translation_goes_after_the_placed_source():
    (got,) = arrange_new_targets([_t("ko", -5, "ko", 5, tr=True, placed=True)])
    assert (got.number_style, got.after_existing_source) == ("omitted", True)

def test_pair_in_different_places_is_not_the_default():
    got = arrange_new_targets([_t("ko", 7, "ko", 1), _t("en", 7, "en", 2, place=(1, "scope", None, None))])
    assert {a.number_style for a in got} == {"numbered"}
```
`tests/test_sop_numbering.py`(API로):
```python
def test_saving_a_pair_into_one_slot_numbers_english_and_omits_korean(client): ...   # 한 저장에 짝 두 단위 → C: [("en","6.1.1","numbered"),("ko",None,"omitted")]
def test_manual_order_doc_appends_english_then_korean(client): ...                   # 순서 바꾸기 뒤(manual_order) 짝 저장 → order_index 끝 두 자리가 en, ko
def test_later_human_translation_lands_after_its_source_omitted(client): ...         # manual_order 문서 [A, S, B], 다음 저장으로 S 출처 단위의 다른 언어 문장 → [A, S, T, B], T omitted
def test_moving_an_existing_target_keeps_its_mark(client): ...                       # "note"인 새 문장을 다른 칸으로 옮기는 저장 → "note" 그대로
```

- [ ] **Step 2: Run to verify they fail**

Run: `$PY -m pytest tests/test_sop_target_placement.py tests/test_sop_numbering.py -q`
Expected: FAIL — `ImportError: cannot import name 'arrange_new_targets'`, 한글 줄 `"numbered"`.

- [ ] **Step 3: Implement** `arrange_new_targets`와 `_write_group` 적용(위 규칙). `_load_next_orders`는 그대로 쓰되 붙이는 순서를 `arrange_new_targets` 결과로.

- [ ] **Step 4: Run to verify pass + invariants**

Run: `$PY -m pytest tests/test_sop_target_placement.py tests/test_sop_numbering.py tests/test_sop_decisions.py tests/test_sop_pair_settle.py -q` → PASS(지켜야 하는 decisions·pair_settle 테스트 포함). 전체 스위트 PASS, ruff 0.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(numbering): default marks and order for newly placed pairs and translations — 새로 놓이는 짝·번역의 기본 번호와 순서"
```

---

### Task 6: 칸 제목(Slot heading) — 저장·결과물 (backend)

**Files:**
- Modify: `backend/app/sop/constants.py` (`TARGET_KINDS += ("slot_heading",)`, `CHANGE_TYPES += ("heading",)`)
- Modify: `backend/app/sop/models.py:416` (`kind: String(8)` → `String(12)`) — `target_sentences`에는 `kind`·`change_type` CHECK 제약이 없다(있는 것은 `status`·`number_style`). 대신 `kind`가 8자라 `slot_heading`(12자)이 Postgres에서 잘려 거절된다 — 리비전은 길이를 넓히고, 마이그레이션 테스트는 CHECK 대신 반영된 길이를 본다. `change_type`(20자)은 `heading`이 들어간다.
- Create: `backend/alembic/versions/0014_target_kind_slot_heading.py` (autogenerate 뒤 직접 검토 — `batch_alter_table`로 `kind` 길이만)
- Modify: `backend/app/sop/decisions.py` (`TargetIn.kind`, `_State.slot_headings`, `_load_state`, `_check_location`, `_check_source_kinds`, `_resolve_text`, `_resolve_lang`, `_decide_change_type`, `_write_group`)
- Modify: `backend/app/sop/outputs.py` (`_SectionPlan.headings`, `_plan_sections`, `number_targets`, `CSection.heading_note`, A 단위 줄), `backend/app/sop/output_labels.py` (`heading`)
- Modify: `backend/app/routers/sop_outputs.py` (`reorder_targets`의 `tops`에서 `slot_heading` 제외)
- Modify: `frontend/src/lib/i18n-messages.ts` (`rule.invalid_group.slot_heading_not_allowed`·`.slot_heading_text_locked`·`.slot_heading_mixed_langs` en·ko)
- Test: `backend/tests/test_migrations.py`, Create `backend/tests/test_sop_slot_heading.py`

**Interfaces:**
- Produces:
  - 저장: `TargetIn.kind: Literal["sentence", "table", "figure", "slot_heading"]`. `slot_heading`은 SOP 문서·N/A 아닌 칸(지금 `_check_location` 규칙)만, WI면 422 `invalid_group{reason: "slot_heading_not_allowed"}`. 출처는 `heading|sentence` 단위 하나 이상(아니면 `kind_mismatch`), 출처 언어가 하나여야(아니면 `slot_heading_mixed_langs`). 글은 시스템이 `SLOT_LABELS[slot_key]`로 채우고, 보낸 `text`가 그와 다르면 `slot_heading_text_locked`. 변경 종류는 `_decide_change_type`에서 번역 기원 검사 바로 다음, 신규·합침보다 먼저 `"heading"`.
  - **출처 더하기(내 판단 — 닫힘 검사 때문에)**: 같은 `(새 문서, slot_key, 언어)`에 `slot_heading`이 이미 있고 요청이 새 `slot_heading`(id 없음)을 보내면 새 행을 만들지 않고 기존 행에 `TargetSource`를 이어 붙인다(seq는 기존 최댓값 다음, 기존 행의 글·상태·표시는 바꾸지 않는다). 기존 행은 이 저장의 연결 요소 밖이라 닫힘 검사에 걸리지 않는다. 같은 요청에 같은 키가 둘이면 하나로. `_State.slot_headings: dict[tuple[int, str, str], TargetSentence]`(질의 한 번).
  - 결과물: 칸 제목은 번호를 세지 않는다(`number_targets`가 칸 제목에는 칸 번호를 준다 — A의 No.). A 단위 줄: Destination `sop`, Place 칸 이름, No. 칸 번호, New text 칸 이름, Change `heading`. C: `CSection.heading_note: str` — 그 칸 칸 제목들(두 언어)의 출처를 `_format_source_note`처럼 `"← OLD-1 §5, OLD-2 §5"`(접미 없음, 중복 제거), 칸 항목 목록에는 넣지 않는다. 순서 바꾸기의 전체 목록 검사에서 `slot_heading`은 뺀다.
  - `OutputLabels.change_types["heading"]`: en `"Slot heading"`, ko `"칸 제목"`.

- [ ] **Step 1: Write the failing tests**

`tests/test_migrations.py`:
```python
def test_target_kind_fits_slot_heading_in_migrated_db(tmp_path):
    engine = _upgrade_head(tmp_path)               # 이 파일의 기존 패턴(test_target_number_style_check_holds_in_migrated_db)을 따른다
    (kind,) = [c for c in inspect(engine).get_columns("target_sentences") if c["name"] == "kind"]
    assert kind["type"].length == 12
```
`tests/test_sop_slot_heading.py`(한/영 연달아 옛 문서 둘 — 각각 `5. 절차`/`5. Procedure` 제목 짝 + 문장, To-Be SOP 하나·WI 하나·N/A 칸 하나):
```python
def test_heading_pair_goes_to_ko_and_en_slot_headings(client): ...   # 제목 짝 → 두 slot_heading(ko, en), 글 "Procedures › Procedure", change_type "heading", 진행 숫자 confirmed +1줄
def test_same_heading_from_another_doc_adds_a_source(client): ...    # OLD-2의 같은 제목 → 새 행 없음, 기존 행 출처 2개, change_type "heading"(merged 아님)
def test_slot_heading_rejected_for_na_slot_and_wi(client): ...       # N/A 칸 → reason "na_slot", WI → "slot_heading_not_allowed"
def test_slot_heading_text_cannot_be_edited(client): ...             # text="Other" → "slot_heading_text_locked"
def test_slot_heading_is_not_numbered_and_shows_in_a_and_c(client): ...
    # 칸에 문장 하나 더 → C 항목 번호 "6.1.1"(칸 제목은 세지 않음), section.heading_note == "← OLD-1 §5, OLD-2 §5",
    # A 제목 줄 (dest_location, dest_number, confirmed_text, change_type) == ("Procedures › Procedure", "6.1", "Procedures › Procedure", "heading")
def test_reorder_ignores_slot_headings(client): ...                  # 칸 제목을 빼고 보낸 순서 바꾸기 → 200
def test_detaching_one_source_of_a_slot_heading_keeps_it(client): ... # Review Focus 4 — OLD-1 제목만 clear → 행 남고 출처 1개·상태 그대로, OLD-2도 clear → 행 없음
```

- [ ] **Step 2: Run to verify they fail**

Run: `$PY -m pytest tests/test_migrations.py tests/test_sop_slot_heading.py -q`
Expected: FAIL — 길이 8, 422 `literal_error`(kind).

- [ ] **Step 3: Implement** 위 계약. 리비전 생성 후 `test_models_match_migrations`가 통과하는지 본다(`compare_type`가 길이 차이를 잡는다). `app/sop/written.py`의 New 문장 목록·후보가 입구 2 문서만 읽어 칸 제목이 끼지 않는지 확인하고, 끼면 거른다. 사유 문구 예: en `"A slot heading goes to an SOP section that is not N/A."`, `"The slot heading text is the section name and cannot be edited."`, `"A slot heading takes old headings of one language."`(ko 같은 뜻).

- [ ] **Step 4: Run to verify pass + invariants**

Run: `$PY -m pytest tests/test_migrations.py tests/test_sop_slot_heading.py tests/test_sop_outputs.py tests/test_sop_decisions.py tests/test_sop_progress.py -q` → PASS; `cd ../frontend && npx vitest run src/lib/i18n-messages.test.ts` → PASS; 전체 backend 스위트 PASS, ruff 0.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assign): slot heading targets for old headings — 옛 제목을 새 SOP 칸 제목에 잇기"
```

---

### Task 7: 칸 제목을 Assign 화면에서 고르기 (frontend)

**Files:**
- Modify: `frontend/src/lib/api-sop.ts` (`GroupTarget.kind`, `TargetInput.kind`에 `"slot_heading"`, `ChangeType`에 `"heading"`)
- Modify: `frontend/src/lib/classify-model.ts` (`Destination`, `getDestinationId`, `buildDestinationOptions`, `readDestination`, `buildGroupSave`)
- Modify: `frontend/src/components/assign/destination-tree.tsx`, `assign-help.tsx`, `frontend/src/app/bundles/[id]/assign/page.tsx`(고른 줄에 글 단위가 아니면 칸 제목 항목을 숨기는 곳만)
- Modify: `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md` (`#assign-destination`)
- Test: `frontend/src/lib/classify-model.test.ts`

**Interfaces:**
- Consumes: Task 6 저장 계약(출처 더하기는 서버가 한다 — 화면은 새 `slot_heading`을 보내기만).
- Produces: `Destination`에 `| { kind: "slot_heading"; docId: number; slotKey: string }`; `getDestinationId` → `heading:<docId>:<slotKey>`; `buildDestinationOptions(tobe, slotLabels)`는 SOP의 N/A 아닌 칸마다 칸 줄 바로 앞에 칸 제목 항목(WI 없음); `readDestination`은 그룹 새 문장 중 `kind === "slot_heading"`이 있으면 그 목적지; `buildGroupSave`는 칸 제목 목적지에서 줄의 `heading|sentence` 단위마다 `{kind: "slot_heading", target_doc_id, slot_key, source_unit_ids: [unit.id]}`(글·언어·변경 종류 없음, 그룹에 같은 단위의 칸 제목 새 문장이 있으면 그 id·revision). 트리 항목 testid `assign-tree-place-heading:<docId>:<slotKey>`(기존 `assign-tree-place-${option.id}` 꼴). 새 문구 `assign.slotHeading`: en `"Slot heading"`, ko `"칸 제목"`.

- [ ] **Step 1: Write the failing tests** (`classify-model.test.ts`)

```ts
it("offers a slot heading place before each SOP section that is not N/A, none for WI", () => {
  const ids = buildDestinationOptions(TOBE_WITH_NA_AND_WI, LABELS).map((o) => o.id);
  expect(ids).toContain(`heading:${SOP}:procedures.procedure`);
  expect(ids.indexOf(`heading:${SOP}:procedures.procedure`)).toBe(ids.indexOf(`slot:${SOP}:procedures.procedure`) - 1);
  expect(ids.some((id) => id.startsWith(`heading:${SOP}:scope`))).toBe(false);   // N/A
  expect(ids.some((id) => id.startsWith(`heading:${WI}`))).toBe(false);
});
it("saves each heading unit of a pair row as its own slot heading", () => {
  const save = buildGroupSave(draftWith({ kind: "slot_heading", docId: SOP, slotKey: "procedures" }), PAIR_HEADING_CONTEXT, "confirm");
  expect(save.targets.map((t) => [t.kind, t.slot_key, t.source_unit_ids, t.text])).toEqual([
    ["slot_heading", "procedures", [KO_ID], undefined], ["slot_heading", "procedures", [EN_ID], undefined]]);
});
it("reads a group with slot heading targets back as the slot heading destination", () => { ... });
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/classify-model.test.ts` → FAIL.

- [ ] **Step 3: Implement** 위 계약, 트리 항목(칸 줄 안 첫 항목으로 보이기는 빌더 재량 — §12), 도움말 패널 한 줄, 설명서 `#assign-destination`에 **Slot heading** 문단(옛 제목을 그 칸 제목으로, 짝이면 한글·영어 각자, 다른 문서의 같은 제목은 출처만 더해짐, 번호 없음).

- [ ] **Step 4: Run to verify pass** — `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint` → 모두 통과(`manual-content.test.ts` 포함).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assign): pick a slot heading in the destination tree — 목적지 나무에 칸 제목 자리"
```

---

### Task 8: 검토 요청 조건 — 옛 문서 버전 (§5.5)

**Files:**
- Modify: `backend/app/sop/review.py` (`NextAction`, `evaluate_readiness`, `_pick_next_action`)
- Modify: `backend/tests/sop_helpers.py` (`set_doc_version`), `backend/scripts/sop_demo_driver.py` (`start`), `backend/scripts/seed_sop_worst.py` (`upload_extra`·`upload_w1_documents`)
- Modify: `frontend/src/lib/api-sop.ts` (`NextAction`), `frontend/src/lib/stages.ts` (`NEXT_ACTION_STAGE`), `frontend/src/app/bundles/[id]/page.tsx` (`NEXT_ICONS`, gate 줄), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md` (`#review-gates`)
- Test: `backend/tests/test_sop_review.py` (+ 요청이 통과해야 하는 픽스처: `test_sop_review._setup`, `test_sop_ai_jobs`, `test_sop_e2e` 경로)

**Interfaces:**
- Produces: 막는 이유 `{"code": "missing_doc_versions", "count": n, "document_ids": [...]}` — 옛 문서 중 상태 `ready`이고 `doc_version.strip() == ""`, id 순. 스냅숏 `DocumentInfo.doc_version`만 읽어 질의를 더하지 않는다. 다음 행동 `"fill_doc_versions"`(`resolve_documents` 바로 뒤, `check_boundaries` 앞), 프런트 `NEXT_ACTION_STAGE.fill_doc_versions = "documents"`. 테스트 도우미 `set_doc_version(client: TestClient, bundle_id: int, doc: dict, version: str = "1.0", headers: dict[str, str] = AUTHOR) -> dict`(PATCH `/documents/{id}`).
- 문구: `gate.docVersions` en `"{n} old documents have no version"` / ko `"버전이 빈 Old 문서 {n}개"`, `gate.docVersionsOk` `"All versions filled"` / `"버전 모두 채움"`, `next.fill_doc_versions.title` `"Fill in the document versions"` / `"문서 버전 채우기"`, `.body`(Documents에서 Old 문서마다 버전을 적는다, Excel에 그대로 나간다).

- [ ] **Step 1: Write the failing tests** (`tests/test_sop_review.py`)

```python
def test_old_document_without_version_blocks_review(client):
    fx = _make_ready(client, fill_versions=False)
    readiness = _get_readiness(client, fx.bundle_id)
    assert {"code": "missing_doc_versions", "count": 1, "document_ids": [fx.doc_id]} in readiness["blockers"]
    assert readiness["next_action"] == "fill_doc_versions"
    assert _request(client, fx.bundle_id).status_code == 422
    set_doc_version(client, fx.bundle_id, {"id": fx.doc_id, "revision": ...})
    assert _get_readiness(client, fx.bundle_id)["ready"] is True

def test_next_action_puts_versions_after_documents_and_before_boundaries(client): ...
```
`test_empty_bundle_blockers_are_listed_in_order`·`test_next_action_sequence`의 기대 목록에 새 코드를 넣는다. `_make_ready`·`_setup`은 기본으로 버전을 채운다(`fill_versions=True`).

- [ ] **Step 2: Run to verify they fail** — `$PY -m pytest tests/test_sop_review.py -q` → FAIL(막는 이유 없음).

- [ ] **Step 3: Implement** 백엔드 규칙과 도우미, `SyntheticDriver.start`는 올린 옛 문서의 `doc_version`이 비면 `"1.0"`으로 PATCH(데모 묶음 2~4가 지금처럼 검토 요청이 되게), `seed_sop_worst`도 같은 도우미로. 프런트 개요 gate 줄·아이콘(lucide `FileClock` 등)·문구, 설명서 `#review-gates`에 **버전** 조건 한 줄.

- [ ] **Step 4: Run to verify pass + invariants**

Run: `$PY -m pytest tests/test_sop_review.py tests/test_sop_ai_jobs.py tests/test_sop_e2e.py tests/test_seed_sop_demo.py -q` → PASS(`test_readiness_uses_bounded_queries`·`test_readiness_does_not_read_document_text` 포함). 전체 backend 스위트, `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint` 통과.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(review): old documents need a version before review — 검토 요청 전에 옛 문서 버전 채우기"
```

---

### Task 9: 시트 모델 → Graphite Excel과 미리보기 API

**Files:**
- Create: `backend/app/sop/sheet_model.py`
- Modify: `backend/app/sop/excel_export.py` (`ExcelLabels`·`EXCEL_LABELS`·`_write_sheet_*`·`_put_chunked_row` 삭제, `build_workbook`, `build_export_file_name`)
- Modify: `backend/app/routers/sop_outputs.py` (`get_export`, 새 `get_export_preview`)
- Test: `backend/tests/test_sop_excel.py`, `backend/tests/test_sop_numbering.py::test_excel_leaves_unnumbered_cells_empty_and_italicizes_notes`, `backend/tests/test_sop_e2e.py`(Excel 부분)

**Interfaces:**
- Consumes: Task 2·3 `build_output_a/b/c`·`build_summary`·`format_confirmer`, `snapshot.load_people_names`, `flow_image.draw_flow_png(graph, "en")`, `excel_export.write_text_cell`·`split_cell_text`·`CELL_TEXT_LIMIT`.
- Produces:
  ```python
  RowKind = Literal["status", "header", "group_start", "in_group", "doc", "section", "plain"]
  class SheetCell(BaseModel): text: str = ""; faint: bool = False; italic: bool = False; bold: bool = False
  class SheetRow(BaseModel): kind: RowKind; cells: list[SheetCell]
  class Sheet(BaseModel):
      name: str; widths: list[int]; rows: list[SheetRow]
      freeze: str | None                 # "A3" (A·C), None
      filter_columns: int                # A는 20, 나머지 0
      image_png: str | None              # B 흐름도 PNG base64(같은 draw_flow_png), 그 밖 None
      image_row: int | None              # 그림을 놓는 줄(1부터)
      total_rows: int; truncated: bool
  class WorkbookModel(BaseModel): file_name: str; sheets: list[Sheet]
  SHEET_NAMES = ("A Comparison", "B Flow", "C New documents", "Info")
  A_HEADERS = ("Row", "Old doc", "Ver.", "Location", "Unit ID", "Old text", "Destination", "New doc", "New doc title", "Place", "No.", "New text", "AI suggestion", "Change", "Remark", "Status", "Confirmed by", "Confirmed at", "Group ID", "Checks")
  A_COLUMN_WIDTHS = (8, 12, 8, 26, 14, 50, 14, 14, 26, 28, 12, 50, 40, 18, 28, 12, 24, 18, 14, 40)
  A_SHARED_COLUMNS = (1, 7, 8, 9, 15)     # Row·Destination·New doc·New doc title·Remark (1부터)
  MAX_PREVIEW_ROWS = 500                  # 시트마다 미리보기 줄 상한 — W1에서 응답 크기를 재 정한다(§7.3)
  def build_workbook_model(snap: BundleSnapshot, meta: ExportMeta, people: Mapping[str, str]) -> WorkbookModel
  def limit_preview(model: WorkbookModel, max_rows: int = MAX_PREVIEW_ROWS) -> WorkbookModel
  def format_rate(rate: float) -> str    # "28%"
  # excel_export.py
  def build_export_file_name(bundle_id: int, title: str, at: datetime) -> str
  def build_workbook(model: WorkbookModel) -> bytes
  ```
  Router: `GET /{bundle_id}/export.xlsx`(쿼리 없음) — `build_workbook_model` → `build_workbook`, `Content-Disposition`은 `model.file_name`, 작업 기록 `action="export"`, `reason=""`(지금은 lang — 내 판단). `GET /{bundle_id}/export/preview` → `WorkbookModel`(`limit_preview` 적용, 기록 없음, 멤버·모든 상태). 둘 다 `ExportMeta.exported_at = now()`로 이름을 짓는다.

**모델 규칙:** 1행 `status`(`Status: In progress` 꼴, 지금 en 값), 2행 `header`. A 줄은 `ARow` 하나가 한 줄 — `is_group_start`면 `group_start`, 아니면 `in_group`; 같은 묶음에서 `A_SHARED_COLUMNS` 칸 글이 바로 윗줄과 같으면 `faint`; 주석 줄의 New text·AI suggestion 칸 `italic`. 32,767자 나누기는 **모델에서** 한다(이어짐 줄은 `in_group`, Unit ID 칸 `"(continued)"`, 흐림 판정은 윗줄 기준 그대로) — 미리보기와 파일이 같은 줄이 되게(내 판단). B: 요약 표(이름 `Old rows`·`Assigned`·`No destination`·`Duplicate assignments`·`Deleted`·`Moved`·`New`·`Translated`·`Confirmed rate`·`Single language`, 확정률은 `format_rate` 글), 옛 문서 × 보낸 곳 표, 그림. C: 지금 13열 en 머리, 문서 줄 `doc`, 칸 줄 `section`(칸 제목 출처는 `Old units` 칸에 `heading_note`), 항목 줄은 `meaning_key`가 바뀌면 `group_start` 아니면 `in_group`(내 판단 — C에도 같은 선). Info: 지금 en 이름·값.
**xlsx 쓰기:** 머리 줄 `PatternFill("solid", fgColor="2B2F36")`·`Font(bold=True, color="FFFFFF")`·아래 `Side("thick", color="202124")`; `group_start` 위 `Side("medium", color="5F6368")`; `in_group` 위 `Side("thin", color="9AA0A6")`; `faint` `Font(color="9AA0A6")`; 그 밖 바탕 없음. 모든 글 칸은 `write_text_cell`.

- [ ] **Step 1: Write the failing tests** (`tests/test_sop_excel.py` — `_export`·`_load`에서 `lang` 인자를 걷는다)

```python
def test_workbook_sheets_and_headers(client):     # 고친다
    wb = _load(client, fx.bundle_id)
    assert wb.sheetnames == ["A Comparison", "B Flow", "C New documents", "Info"]
    assert [c.value for c in wb["A Comparison"][2]] == list(A_HEADERS)
    assert wb["A Comparison"].freeze_panes == "A3" and wb["A Comparison"].auto_filter.ref.startswith("A2:T")

def test_export_file_name(client):                 # 고친다
    name = build_export_file_name(4, 'a/b:c*?"<>| 제목', datetime(2026, 11, 13, 9, 5, tzinfo=KST))
    assert name == "BND-0004_a_b_c______ 제목_20261113-0905.xlsx"
    assert build_export_file_name(4, "", datetime(2026, 11, 13, 9, 5, tzinfo=KST)) == "BND-0004_20261113-0905.xlsx"

def test_file_name_is_the_same_in_preview_and_download(client):   # Review Focus 3 — NFD 한글·"=cmd" 제목
    preview = client.get(f"/api/bundles/{bid}/export/preview", headers=AUTHOR).json()
    disposition = _export(client, bid).headers["content-disposition"]
    assert unquote(disposition.split("filename*=UTF-8''")[1]) == preview["file_name"]   # 같은 분(minute) 안에서; 경계면 한 번 다시

def test_shared_cells_repeat_and_fade_from_the_second_line(client):
    # 1:1 짝 묶음 두 줄: Row·Destination·New doc·New doc title·Remark 같은 값, 둘째 줄 font.color.rgb == "FF9AA0A6"
    # 중복 배정 묶음: 둘째 줄 New doc이 달라 흐리지 않음; Status·Change는 흐리지 않음

def test_graphite_borders(client):
    # 머리 줄 fill "FF2B2F36"·흰 굵은 글자·bottom.style "thick", group_start 줄 top.style "medium" color "FF5F6368", in_group top "thin" "FF9AA0A6"

def test_confirmed_rate_is_percent_text(client):    # B 요약 "Confirmed rate" 값 == f"{floor(r*100+0.5)}%" 글(data_type "s")

def test_preview_matches_the_file(client):
    preview = client.get(...).json(); wb = _load(client, bid)
    for sheet in preview["sheets"]:
        ws = wb[sheet["name"]]
        assert [[c["text"] for c in row["cells"]] for row in sheet["rows"]] == [[(c.value or "") if isinstance(c.value, str) else str(c.value) ... ] for row in ws.iter_rows(max_col=len(sheet["widths"]))][:len(sheet["rows"])]

def test_continued_rows_stay_in_their_group(client):   # Review Focus 2 — 40,000자 확정 문장(이 파일 _inject_text 패턴)
    # 미리보기 A의 이어짐 줄 kind == "in_group", Unit ID "(continued)", xlsx 줄 수 == 미리보기 줄 수

def test_preview_caps_rows_per_sheet(client, monkeypatch):   # Review Focus 5
    monkeypatch.setattr(sheet_model, "MAX_PREVIEW_ROWS", 3)
    a = client.get(...).json()["sheets"][0]
    assert (len(a["rows"]), a["truncated"], a["total_rows"] > 3) == (3, True, True)

def test_preview_of_an_empty_bundle(client):            # Review Focus 1 — 시트 넷, A는 상태·머리 줄만, 확정률 "0%"
```
`test_export_records_event_and_works_in_review`는 `reason == ""`로, `test_export_survives_control_chars_and_formula_text`·`test_long_text_continues_on_next_row`·`test_write_text_cell_never_makes_formulas`는 한 벌로 고쳐 그대로 지킨다. 흐름도 테스트는 그대로.

- [ ] **Step 2: Run to verify they fail** — `$PY -m pytest tests/test_sop_excel.py -q` → FAIL(시트 이름 `A Comparison` 단언은 en판과 같지만 `Row` 머리·파일 이름·미리보기 404에서).

- [ ] **Step 3: Implement** `sheet_model.py`·xlsx 쓰기·라우터. `ExcelLabels`·`EXCEL_LABELS`(ko)는 지운다. `test_sop_numbering.py::test_excel_leaves_unnumbered_cells_empty_and_italicizes_notes`와 `test_sop_e2e.py`의 Excel 단언(`len(data_rows) == len(outputs["a"])` — 이어짐 없는 자료)을 한 벌로.

- [ ] **Step 4: Run to verify pass + invariants** — `$PY -m pytest tests/test_sop_excel.py tests/test_sop_numbering.py tests/test_sop_e2e.py tests/test_sop_outputs.py -q` → PASS(`test_outputs_use_bounded_queries` 포함 — 미리보기도 같은 상한 안인지 이 테스트에 미리보기 호출을 더한다). 전체 스위트 PASS, ruff 0.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(export): one Graphite workbook and a preview from the same sheet model — 시트 모델 하나로 Excel과 미리보기"
```

---

### Task 10: 결과물·검토 화면 한 벌 (frontend)

**Files:**
- Modify: `frontend/src/lib/api-sop.ts` (`OutputARow`, `OutputCItem`(`origin`·`meaning_key`), `OutputC` 칸 `heading_note`, `OutputSummary`, `getOutputA/B/C(bundleId, labelLang)`, `getSummary(bundleId): Promise<OutputSummary>`; `OutputLang`은 라벨 언어로 남김)
- Create: `frontend/src/lib/output-groups.ts` (+ `output-groups.test.ts`)
- Modify: `frontend/src/lib/section-number.ts` (+test) — `findPartnerTarget` 삭제, `isIndentable` → 두 함수
- Modify: `frontend/src/lib/target-order.ts` (+test), `frontend/src/lib/outputs-view-prefs.ts` (+test)
- Modify: `frontend/src/app/bundles/[id]/outputs/page.tsx`, `frontend/src/app/bundles/[id]/review/page.tsx`, `frontend/src/components/outputs/output-a-row.tsx`, `output-c.tsx`, `output-b-card.tsx`(라벨 언어만)
- Delete: `frontend/src/components/outputs/edition-toggle.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md` (`#outputs`·`#outputs-checks`·`#terms`, 검토 화면 문단)
- Test: 위 `*.test.ts`, `frontend/src/components/outputs/output-c.test.ts`

**Interfaces:**
- Consumes: Task 2·3·6 API 모양(라벨 언어는 화면 UI 언어 `useI18n().lang`).
- Produces:
  ```ts
  export interface AScreenLine { row: OutputARow; showShared: boolean; showDest: boolean }
  export function buildAScreenLines(rows: readonly OutputARow[]): AScreenLine[]   // showShared = is_group_start; showDest = is_group_start || dest_kind/dest_doc_code가 윗줄과 다름
  export function listMeaningStarts(items: readonly Pick<OutputCItem, "meaning_key">[]): boolean[]  // 첫 항목, 또는 meaning_key가 윗 항목과 다르거나 null
  export function canChangeDepth(entrance: string, item: Pick<OutputCItem, "origin">): boolean   // entrance !== "match" && origin !== "translation"
  export function canChangeStyle(entrance: string): boolean                                     // entrance !== "match"
  export function buildTargetOrder(output: OutputC, targetDocId: number, locationKey: string, targetId: number, dir: MoveDir): number[] | null
  export function buildPatchItems(output: OutputC, targetDocId: number, patches: ReadonlyMap<number, TargetPatch>): TargetOrderItem[] | null
  export interface OutputsView { tab: OutputsTab }   // lang 키와 "sopa.outputs.lang" 읽기·쓰기 삭제
  ```
- 화면 A(7열, §4.3): `Row`(묶음 첫 줄) · `Old unit`(Old doc · Location · Unit ID) · `Source` · `Destination`(종류 · New doc은 `showDest`일 때, Place · No.는 줄마다) · `New sentence`(확정 글, 없으면 AI 글을 점선 테두리로 — 클래스는 tokens 기반) · `Remark`(첫 줄) · `Status`(줄마다, 변경 종류 함께). 묶음 첫 줄 위 굵은 선. 확정한 사람·시각·관계 묶음·경고는 지금처럼 펼치기(`output-a-expand-*`). 긴 글 열은 `table-layout: fixed`·열 폭 지정·줄 수 제한은 감싼 `div`(`docs/lessons/ui-review.md` 8·10).
- 화면 C: 칸마다 한 목록, `listMeaningStarts`로 의미 경계 굵은 선, 칸 머리 옆 `heading_note`, 번호 표시 단추는 `canChangeStyle`, 깊이 단추는 `canChangeDepth`, 표시·깊이는 그 줄만 보낸다(다른 판 불러오기 삭제). 삭제·이동 목록은 줄마다 한 번(짝이면 줄바꿈).
- 요약(§5.3): `Summary` 상자(제목 `outputs.summary` en `"Summary"`, ko `"요약"` — `{lang}` 삭제), 항목 `outputs.sum.old_rows` `"Old rows"`/`"Old 줄"`, `assigned`, `outputs.sum.no_destination` `"No destination"`/`"갈 곳 없음"`, `duplicate`, `deleted`, `moved`, `new`, `translated`, `outputs.sum.single_language` `"One language only"`/`"한 언어만"`, 확정률 `{n}%`. `outputs.sum.old_units`·`outputs.sum.unassigned`·`outputs.edition` 삭제.
- Excel 상자: 단추 하나 `outputs-export-open`(`"Export Excel"`) — 미리보기 창은 Task 11, 이 태스크에서는 단추가 지금 `downloadExport`를 그대로 부른다(`lang` 없이, 이름은 Task 11).

- [ ] **Step 1: Write the failing tests**

`output-groups.test.ts`:
```ts
it("shows shared cells on the first line of a group only", () => {
  expect(buildAScreenLines([row(1, true, "sop", "SOP-1"), row(1, false, "sop", "SOP-1")]).map((l) => [l.showShared, l.showDest])).toEqual([[true, true], [false, false]]);
});
it("shows the destination again when a duplicate line goes to another document", () => {
  expect(buildAScreenLines([row(1, true, "sop", "SOP-1"), row(1, false, "wi", "WI-1")])[1].showDest).toBe(true);
});
it("starts a meaning border where the meaning key changes or is missing", () => {
  expect(listMeaningStarts([{ meaning_key: "old:3" }, { meaning_key: "old:3" }, { meaning_key: "old:-9" }, { meaning_key: null }])).toEqual([true, false, true, true]);
});
```
`section-number.test.ts`: `findPartnerTarget` describe 삭제, `canChangeDepth("assign", {origin: "translation"})` false·`{origin: "units"}` true(사람이 쓴 다른 언어 문장도 true), `canChangeStyle("match")` false. `target-order.test.ts`: 한 `OutputC`로 — "moves one sentence down inside its section across languages", "puts a number style on the one changed line only"(짝 상대 문구 삭제). `outputs-view-prefs.test.ts`: `sopa.outputs.lang`을 읽지도 쓰지도 않는다. `output-c.test.ts`: 기존 단언을 한 벌 자료로.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/output-groups.test.ts src/lib/section-number.test.ts src/lib/target-order.test.ts src/lib/outputs-view-prefs.test.ts` → FAIL.

- [ ] **Step 3: Implement** 모델·화면. 결과물·검토 화면에서 `EditionToggle`·`sopa.outputs.lang`·`findPartnerTarget`·`buildDownloadName` import를 걷고 `edition-toggle.tsx`를 지운다(`download-name.ts`는 To-Be가 계속 쓴다). 검토 화면은 `OutputCView`에 판 없이. 설명서 `#outputs`(A 7열·묶음 선·한 벌), `#outputs-checks`(요약 한 벌, No destination과 Unassigned의 차이 한 줄), `#terms`(의미 묶음·Translated · Added·Slot heading), 검토 화면 판 전환 문장 삭제. 화면 글자는 굵게 영어 라벨 그대로.

- [ ] **Step 4: Run to verify pass** — `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run build`(경고 0) 통과.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(outputs-ui): one-set outputs and review screens without the edition toggle — 판 전환 없는 결과물·검토 화면"
```

---

### Task 11: Excel 미리보기 창과 서버가 지은 파일 이름 (frontend)

**Files:**
- Create: `frontend/src/components/outputs/export-preview.tsx`, `frontend/src/components/outputs/sheet-view.tsx`
- Modify: `frontend/src/components/modal.tsx` (+`modal.test.ts`) — 크기 `sheet`
- Modify: `frontend/src/lib/api.ts` (+test) — `apiFetchBlobWithName`, `readDispositionFileName`
- Modify: `frontend/src/lib/api-sop.ts` (`WorkbookPreview` 타입, `getExportPreview`, `downloadExport`)
- Modify: `frontend/src/styles/tokens.css` (시트 토큰), `frontend/src/app/bundles/[id]/outputs/page.tsx`, `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md` (`#outputs-excel`)

**Interfaces:**
- Consumes: Task 9 `GET …/export/preview`(`WorkbookModel` JSON), `GET …/export.xlsx`.
- Produces:
  ```ts
  export function readDispositionFileName(header: string | null): string | null   // filename*=UTF-8''… 우선, 없으면 filename="…", 없으면 null
  export async function apiFetchBlobWithName(path: string): Promise<{ blob: Blob; fileName: string | null }>
  export function getExportPreview(bundleId: number): Promise<WorkbookPreview>
  export function downloadExport(bundleId: number): Promise<{ blob: Blob; fileName: string | null }>
  export function ExportPreviewModal({ bundleId, onClose }: { bundleId: number; onClose: () => void }): JSX.Element
  export function SheetView({ sheet }: { sheet: PreviewSheet }): JSX.Element
  ```
  `ModalSize`에 `sheet: "max-w-[min(1280px,calc(100vw-32px))]"`(§9 — 좁은 화면이면 화면 폭). 저장 이름 = 응답 `Content-Disposition` 이름, 없으면 미리보기 `file_name`(`buildDownloadName` 쓰지 않음). 토큰(`tokens.css`, 다크에서 바꾸지 않음): `--sheet-paper:#FFFFFF`, `--sheet-ink:#202124`, `--sheet-head-bg:#2B2F36`, `--sheet-head-ink:#FFFFFF`, `--sheet-line-thick:#202124`, `--sheet-line-medium:#5F6368`, `--sheet-line-thin:#9AA0A6`, `--sheet-faint:#9AA0A6`.
  testid: `export-preview`(창), `export-preview-file-name`, `export-preview-tab-<index>`(0~3, 이름은 시트 이름), `export-preview-sheet`, `export-preview-image`, `export-preview-truncated`, `export-preview-download`, `export-preview-error`. 문구: `outputs.export` en `"Export Excel"`/ko `"Excel 내보내기"`, `outputs.preview.title` `"Excel preview"`/`"Excel 미리보기"`, `outputs.preview.download` `"Download"`/`"받기"`, `outputs.preview.truncated` `"Showing the first {n} of {total} rows. The file has every row."`/`"전체 {total}줄 중 앞 {n}줄만 보입니다. 파일에는 모두 들어 있습니다."`.

- [ ] **Step 1: Write the failing tests**

`api.test.ts`:
```ts
it("reads the UTF-8 file name from Content-Disposition", () => {
  expect(readDispositionFileName(`attachment; filename="BND-0004____20261113-0905.xlsx"; filename*=UTF-8''BND-0004_%EC%A0%9C%EB%AA%A9_20261113-0905.xlsx`)).toBe("BND-0004_제목_20261113-0905.xlsx");
  expect(readDispositionFileName(`attachment; filename="a.xlsx"`)).toBe("a.xlsx");
  expect(readDispositionFileName(null)).toBeNull();
});
```
`modal.test.ts`: `sheet` 크기 클래스가 1280 상한과 화면 폭 맞춤을 담는다.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/api.test.ts src/components/modal.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `Export Excel`이 창을 열고(미리보기 로딩 쉬머·오류 `LoadError` 다시 시도), 시트 탭 네 개(파일과 같은 이름·순서), `SheetView`가 모델을 그리기만(칸 글을 다시 짓지 않는다 — `kind`로 선, `faint`·`italic`·`bold`로 글), B는 `image_png`를 `<img src="data:image/png;base64,…">`, 잘렸으면 안내. `Download`는 받기 → `saveBlob(blob, fileName ?? preview.file_name)` → 토스트(지금 `outputs.fileCreated`·`outputs.exportFailed`). Esc·포커스 복원·바깥 클릭은 `Modal`이 한다(§9). 설명서 `#outputs-excel`: **Export Excel** → 미리보기 → **Download**, 파일 이름 꼴, 시트 네 개, 되풀이·흐린 글자의 뜻.

- [ ] **Step 4: Run to verify pass** — `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run build`(경고 0).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(outputs-ui): Excel preview window with the server-built file name — Excel 미리보기 창과 서버가 지은 파일 이름"
```

---

### Task 12: 브라우저 확인 — 스모크·설명서 그림·극단 자료 감사

**Files:**
- Modify: `frontend/scripts/pw-smoke-sop.mjs` (결과물 단계), `frontend/scripts/pw-manual-shots.mjs` (`outputs-lang-en` 표시 → 새 testid, 미리보기 장면), 필요하면 `pw-layout-audit.mjs`·`pw-overlap-audit.mjs`·`pw-contrast-audit.mjs` 장면(미리보기 창·A 7열)
- Modify: `frontend/public/manual/img/*`, `docs/manual/` 그림(스크립트가 다시 뽑은 것만), 감사에서 고친 화면 파일

읽고 시작: `docs/lessons/browser-verification.md`, `docs/lessons/ui-review.md`.

- [ ] **Step 1: 스모크를 한 벌로 고친다** — `"outputs: A, B, C in both editions and Excel"` 단계를 `"outputs: A, B, C and the Excel preview"`로: `outputs-lang-en` 클릭 삭제, A에서 `[data-testid="output-a"] tbody tr` > 10과 첫 줄 `Row` 칸 `"1"`, `outputs-export-open` → `export-preview` 보임 → 탭 네 개 이름 `["A Comparison","B Flow","C New documents","Info"]` → `export-preview-download` 클릭 → `download` 이벤트. 칸 제목 한 번(묶음의 옛 제목 하나를 트리 `assign-tree-place-heading:*`로 확정 → C 칸 머리에 `←`)과 검토 화면에 `review-lang`이 없음을 단언.
- [ ] **Step 2: 로컬 자료를 만들고 스모크를 돈다** (`docs/lessons/browser-verification.md` — 별도 sqlite)

```bash
cd backend && export DATABASE_URL=sqlite+aiosqlite:///./outputs-one-set.db AUTH_MODE=dev
$PY -m scripts.reset_db && $PY -m scripts.seed_sop_demo
DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $PY -m uvicorn app.main:app --port 8777 &   # frontend: npm run dev (3777)
cd ../frontend && npm i --no-save playwright-core && BASE_URL=http://localhost:3777 node scripts/pw-smoke-sop.mjs
```
Expected: 모든 단계 PASS. 데모 묶음 4(AI 제안)의 `GET /api/bundles/4/summary`(헤더 `X-Dev-User: qa.member`)가 `old_rows == 61`이고 개요 진행 숫자 `total == 61`, `confirmed == 16`, 확정률 글 `26%`(§11 "데모 묶음 4: 줄 61·확정 16" — 다르면 원인을 적고 멈춘다).
- [ ] **Step 3: 설명서 그림** — `MANUAL=app BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs` 먼저, 그다음 `BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs`(reset_db → seed_sop_demo 직후). 바뀐 그림만 남기고 `npx vitest run src/lib/manual-content.test.ts` 통과.
- [ ] **Step 4: 극단 자료 감사** — 별도 sqlite에 `reset_db → seed_sop_demo → seed_sop_worst`, backend 8787·frontend 3787:

```bash
DS=worst BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs
BASE_URL=http://localhost:3787 LONG=1 THEMES=light,dark node scripts/pw-overlap-audit.mjs
BASE_URL=http://localhost:3787 node scripts/pw-contrast-audit.mjs
```
결과물 A 7열의 긴 글(W1)·미리보기 창 1120·1920 폭(창이 화면 안, 표 가로 스크롤은 창 안에서만)·Assign 트리 칸 제목 항목을 장면에 넣는다. 실패는 고치고(처방은 실행 중 화면에 주입해 잰 뒤 — `ui-review.md` 2), 각 장면이 무엇을 찍었는지 Bundle 코드로 확인한다. W1 미리보기 응답 크기를 재 `MAX_PREVIEW_ROWS`를 정하고 그 값을 `sheet_model.py` 주석에 적는다.
- [ ] **Step 5: Run gates** — backend 전체 스위트, `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run build` 통과.
- [ ] **Step 6: Commit**

```bash
git commit -m "test(smoke): one-set outputs, Excel preview and slot heading in browser checks — 스모크·설명서 그림·감사를 한 벌 결과물로"
```

---

### Task 13: 명세 흡수·설계 문서 삭제·버전

**Files:**
- Modify: `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md` (§6.4·§6.5 남은 결과물 문장, §7.13, §7.14, §12 화면 2·4·8 — 설계 §10 표 그대로)
- Delete: `docs/superpowers/specs/2026-11-12-language-axis-design.md`, `docs/superpowers/specs/2026-11-13-outputs-one-set-design.md`
- Modify: `docs/README.md`, `docs/superpowers/plans/2026-11-13-language-axis.md`·`PROGRESS.md`·`CHANGELOG.md`의 링크(라벨 글로 강등), `backend/CLAUDE.md`(줄 기준 숫자의 "결과물 요약은 (4)까지 언어별" 문장 → `build_summary`가 같은 줄 목록, 번역 줄 잠금 문장 → 깊이·단계만 잠김·표시는 그 줄, 결과물 `output_rows`·`sheet_model` 한 줄), 필요하면 `frontend/CLAUDE.md`
- Modify: `frontend/package.json`·`package-lock.json`(PATCH), `CHANGELOG.md`, `PROGRESS.md`

- [ ] **Step 1: 흡수** — §7.13: "한글판과 영어판을 따로 만든다 [결정]" → 한 벌(사용자 결정 2026-11-12), A 칸 표(`언어` 삭제·`Row` 추가·`이유` → Remark, 20열 순서), 줄 규칙(설계 §4.1·§4.4·§4.5), 칸 제목(§4.6), 섹션 번호(설계 §6 — 문장마다 한 줄, O10, 짝 옮기기 없음, 번역 표시 풀림), 요약 한 벌(§5.3, No destination), 예시 표 갱신. §7.14: 파일 하나·이름·영어 시트·미리보기·Graphite·되풀이+흐림(설계 §9, O6), 시트 모델. §7.15: 검토 조건 버전(§5.5). §12 화면 2·4·8. 구현 중 정한 것은 "(내 판단 2026-11-13, 결과물 한 벌)"로 적는다(이 계획 Global Constraints의 내 판단 항목, Task 2 규칙 3, Task 6 출처 더하기·순서 바꾸기 제외, Task 9 이어짐 줄·C 선·기록 reason).
- [ ] **Step 2: 지우고 참조 고치기**

```bash
git rm docs/superpowers/specs/2026-11-12-language-axis-design.md docs/superpowers/specs/2026-11-13-outputs-one-set-design.md
git grep -n "2026-11-12-language-axis-design\|2026-11-13-outputs-one-set-design"
```
Expected: 남은 줄을 모두 라벨 글로 바꾼 뒤 출력 없음(코드 주석이 있으면 파일 이름만 남긴다 — `rules/common/documentation.md`).
- [ ] **Step 3: 버전·기록** — `cd frontend && npm version patch --no-git-tag-version`(0.16.6 → 0.16.7), `CHANGELOG.md` `## Unreleased (dev)` 맨 위에 `- **v0.16.7 — <날짜>** — …`(결과물 한 벌·미리보기·Graphite·파일 이름·번호 문장마다·칸 제목·버전 검토 조건·Alembic 0014, **개발 스택에 남은 묶음은 번호가 한 줄로 다시 세어져 C에서 사람이 고친다**, 이제 `main`에 올릴 수 있다 — 사용자가 정한다). `PROGRESS.md`의 이 브랜치 항목을 하나로 압축(목적·결과·주요 결정).
- [ ] **Step 4: Run all gates** — backend 전체 스위트·ruff, `sh ci/test-deploy.sh`(저장소 루트, 배포 스크립트는 안 바뀌었어도 한 번), `npx vitest run`(설명서 `version`은 MINOR만 보므로 그대로 통과), `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run build`.
- [ ] **Step 5: Commit**

```bash
git commit -m "docs(spec): absorb the one-set outputs design and bump v0.16.7 — 결과물 한 벌 명세 흡수, v0.16.7"
```
푸시·`dev` 머지는 사용자 확인 뒤(GitHub `origin`에만).
