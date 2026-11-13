# 언어 축 걷어 내기 (1)~(3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 숫자·검토 조건을 줄 기준 한 벌로 바꾸고, 쪼개기의 묶기를 `Join` 하나로 합치고, 용지의 언어 표시를 걷고, 배정이 언어로 막지 않고 이은 대로 적게 한다.

**Architecture:** "줄 = 짝 하나 또는 짝 없는 판단 단위 하나"를 서버가 센다(SQL 집계 + 스냅숏의 같은 규칙). 짝의 운명(확정·풀기)은 판단을 쓰는 길 끝에서 한 함수(`settle_pairs`)가 정한다. 화면의 판단은 순수 모델(`split-menu-model.ts`·`strip-pill-model.ts`·`assign-model.ts`·`classify-model.ts`)에 두고 화면은 그 결과를 그린다.

**Tech Stack:** Python 3.11 · FastAPI · SQLAlchemy(async) · Alembic · pytest / Next.js 16 · React 19 · TypeScript strict · vitest · Playwright 스크립트(`frontend/scripts/pw-*.mjs`).

**Spec:** 명세 수정안 "언어 축 걷어 내기"(2026-11-12 — v0.16.12에서 제품 명세에 흡수하고 지웠다, git history) (절 번호 §는 이 문서 기준. "제품 명세"는 `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`)

## Global Constraints

- 범위는 수정안 §11의 (1)~(3)이다. 결과물 API(`/outputs/*?lang=`, `/summary`, `export.xlsx?lang=`), `outputs.py`의 판별 계산·번호, 결과물·검토 화면의 판 전환은 **건드리지 않는다**((4), 다음 작업).
- 작업 브랜치는 `feat/lang-axis`(워크트리 `.claude/worktrees/lang-axis`). 태스크마다 커밋하고, **푸시·`dev` 머지·버전 올리기는 Task 9에서 한 번만** 한다(사용자 결정 2026-11-13).
- backend 명령은 워크트리의 `backend/`에서 원본 체크아웃의 venv로 돌린다(요구 패키지가 같다): `PY=/Users/hyeonjin/Documents/sop-archivist/backend/.venv/bin/python`. 한 파일은 `$PY -m pytest tests/<file> -q`, 전체는 `$PY -m pytest tests/ -q -n auto`, 린트는 `/Users/hyeonjin/Documents/sop-archivist/backend/.venv/bin/ruff check app/ tests/`.
- frontend 명령은 워크트리의 `frontend/`에서: `npx vitest run <file>`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`.
- 커밋 메시지는 `type(scope): English summary — 한국어 요약`, 끝에 저장소 규칙의 Co-Authored-By 줄. 커밋 전에 `PROGRESS.md`에 1–3줄을 더한다(`rules/common/git.md`).
- 화면 글자는 en·ko 한 쌍으로 넣는다(`i18n-messages.test.ts`가 키 집합을 본다). 화면·라벨을 바꾼 태스크는 `frontend/public/manual/user-manual.md`의 해당 조각을 같은 커밋에서 고친다 — 굵은 영어 글자는 en 문구와 같아야 한다(`manual-content.test.ts`).
- 새 인터랙티브 요소에는 `data-testid`(`surface-role`, 소문자 케밥)를 단다.
- Python 3.11 문법만(`ruff` target py311). 모델을 바꾸면 Alembic 리비전(`--rev-id 0013`)을 같이 만든다.
- 줄 상태 순서는 프런트 `STATUS_RANK`(`classify-model.ts:35`)와 같다: `unassigned` < `ai_suggested` < `on_hold` < `confirmed`. 줄의 상태는 구성 단위 중 가장 앞선 것.
- AI 페이로드·작업 기록에 직원 실명을 싣지 않는다(기존 원칙, 이 계획은 새 페이로드를 만들지 않는다).

## Review Focus

1. **짝이 조용히 풀려 줄 수가 바뀜** — 한/영 따로인 새 문서에서 한글·영어가 같은 문서의 다른 절로 가는 것은 정상이다. 기대: 같은 새 문서 안이면 짝이 유지된다. → Task 7 `test_pair_stays_when_members_go_to_different_sections_of_one_doc`.
2. **데이터 표와 칸 문장** — 표는 한 줄이고 묶인 칸은 세지 않는다. 기대: 표가 든 문서의 `total`이 배정 화면 줄 수와 같다. → Task 1 `test_progress_counts_a_table_once_and_not_its_cells`.
3. **1:2·2:3 짝** — 줄 하나로 세고 용지에서 한 카드로 붙는다. 기대: 세 줄이 top·middle·bottom. → Task 1 `test_progress_counts_a_pair_as_one_row`(1:2 포함), Task 6 `getPairBrackets` 테스트.
4. **영어 옛 문장 하나 → 새 문서의 한/영 두 문장** — 둘 다 "나눔"이 되면 안 된다. 기대: 영어는 글자 비교 종류, 한글은 `translated`. → Task 7 `test_one_unit_to_both_languages_is_not_a_split`.
5. **한/영을 한 단위로 합친 뒤 다시 푸는 길** — 합친 뒤 풀면 두 단위가 모두 한 언어가 되면 짝으로 못 돌아간다. 기대: 섞어 합친 단위를 풀면 각자 제 언어로 돌아온다. → Task 4 `test_unmerge_of_a_mixed_merge_restores_each_language`.

---

### Task 1: 진행 숫자를 줄 기준 한 벌로 (backend)

**Files:**
- Modify: `backend/app/sop/snapshot.py:366-408` (`LangProgress`·`BundleProgress`·`load_bundle_progress`)
- Modify: `backend/app/sop/status.py` (줄 상태 순서)
- Modify: `backend/app/routers/sop_bundles.py:44,154,170`, `backend/app/routers/sop_admin.py:18,39,42`
- Modify: `backend/scripts/seed_sop_demo.py:37,116`
- Create: `backend/tests/test_sop_progress.py`
- Modify: `backend/tests/test_sop_outputs.py:505-543` (`test_progress_in_list_and_overview`)

**Interfaces:**
- Produces:
  - `status.py`: `ROW_STATUS_ORDER: tuple[str, ...] = ("unassigned", "ai_suggested", "on_hold", "confirmed")`, `def pick_row_status(statuses: Iterable[str]) -> str`(가장 앞선 것, 빈 입력은 `"confirmed"`).
  - `snapshot.py`: `class RowProgress(BaseModel)` 필드 `total, unassigned, ai_suggested, confirmed, on_hold, single_language`(모두 `int = 0`). `async def load_bundle_progress(session: AsyncSession, bundle_ids: Collection[int]) -> dict[int, RowProgress]`. `LangProgress`·`BundleProgress`는 지운다.
  - 응답: `GET /api/bundles`, `GET /api/bundles/{id}`, `GET /api/admin/bundles`의 `progress`가 `RowProgress` 모양.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `backend/tests/test_sop_progress.py`. 문장 상수는 `tests/test_sop_pairs.py`의 `KO_ON`·`EN_ON`·`KO_LOAD`·`KO_KEEP`·`EN_BOTH`를 가져다 쓴다(그 파일이 `p(KO_ON)+p(EN_ON)+p(f"{KO_LOAD} {KO_KEEP}")+p(EN_BOTH)`에서 짝 `[ko_on,en_on]`·`[ko_load,ko_keep,en_both]`가 생김을 이미 보인다). 설정은 `create_bundle` → `put_tobe`(SOP 하나) → `upload`.

```python
def _expected_rows(view: dict) -> int:
    """배정 화면의 줄과 같은 규칙 — 묶이지 않은 단위를 짝으로 묶어 센다."""
    return len({unit["pair_id"] or -unit["id"] for unit in view["units"] if unit["group_unit_id"] is None})

def _expected_single(view: dict) -> int:
    """두 언어 문서에서 짝이 없는 글 단위(문장·제목) 수 — 픽스처에 번역·다른 언어 새 문장이 없을 때."""
    return sum(
        1 for unit in view["units"]
        if unit["group_unit_id"] is None and unit["pair_id"] is None and unit["kind"] in ("sentence", "heading")
    )

def test_progress_counts_a_pair_as_one_row(client):
    fx = _setup(client, p(KO_ON) + p(EN_ON) + p(f"{KO_LOAD} {KO_KEEP}") + p(EN_BOTH))
    assert get_bundle(client, fx.bundle_id)["progress"] == {
        "total": 2, "unassigned": 2, "ai_suggested": 0, "confirmed": 0, "on_hold": 0, "single_language": 0,
    }

def test_row_status_is_the_least_finished_member(client):
    fx = _setup(client, p(KO_ON) + p(EN_ON))
    assign_as_is(client, fx.bundle_id, find_unit(fx.view, KO_ON), fx.sop_id, slot_key="purpose")
    progress = get_bundle(client, fx.bundle_id)["progress"]
    assert (progress["confirmed"], progress["unassigned"]) == (0, 1)
    assign_as_is(client, fx.bundle_id, find_unit(fx.view, EN_ON), fx.sop_id, slot_key="purpose")
    assert get_bundle(client, fx.bundle_id)["progress"]["confirmed"] == 1

def test_progress_counts_a_table_once_and_not_its_cells(client):
    fx = _setup(client, p(KO_ON) + p(EN_ON) + tbl([["가", "나"], ["다", "라"]]))
    progress = get_bundle(client, fx.bundle_id)["progress"]
    cells = [unit for unit in fx.view["units"] if unit["group_unit_id"] is not None]
    assert cells  # 표에 묶인 칸 문장이 있는 픽스처여야 한다
    assert progress["total"] == _expected_rows(fx.view)  # 표는 한 줄, 묶인 칸은 세지 않는다

def test_single_language_counts_unpaired_text_in_two_language_documents(client):
    fx = _setup(client, p(KO_ON) + p(EN_ON) + p(KO_KEEP))
    assert _expected_single(fx.view) >= 1  # 짝이 안 된 문장이 적어도 하나인 픽스처여야 한다
    assert get_bundle(client, fx.bundle_id)["progress"]["single_language"] == _expected_single(fx.view)

def test_single_language_ignores_one_language_documents(client):
    fx = _setup(client, p(EN_ON) + p(EN_BOTH))  # 올릴 때 en_only로 판정된다
    assert fx.view["document"]["language_layout"] == "en_only"
    progress = get_bundle(client, fx.bundle_id)["progress"]
    assert (progress["total"], progress["single_language"]) == (_expected_rows(fx.view), 0)

def test_progress_is_the_same_in_list_overview_and_admin(client): ...  # 세 응답의 progress가 서로 같다

def test_empty_bundle_progress_is_all_zero(client): ...
```
`test_sop_outputs.py::test_progress_in_list_and_overview`는 상수 `PROGRESS`·`EMPTY_PROGRESS`를 새 모양으로 바꾼다: 키 집합이 위 여섯 개, `total == unassigned + ai_suggested + confirmed + on_hold`, 목록·개요·관리 응답이 서로 같다. 끝의 "요약의 옛 단위 수와 같다" 단언은 지운다(요약은 (4)까지 언어별이다).

- [ ] **Step 2: 실패를 확인한다** — `$PY -m pytest tests/test_sop_progress.py -q` → `progress`가 `{"ko":…,"en":…}`라서 FAIL.

- [ ] **Step 3: `pick_row_status`와 `load_bundle_progress`를 고친다**

질의는 묶음 수와 무관하게 두 번이다.
1. 줄 상태: 옛 문서·활성·최신 추출·`Unit.group_unit_id IS NULL`인 단위에 `UnitDecision`을 잇고 `UnitPairMember`를 바깥 조인한다. 줄 키는 `func.coalesce(UnitPairMember.pair_id, -Unit.id)`. 안쪽 질의가 `(bundle_id, 줄 키)`마다 상태 순번의 `min`을 내고(순번은 `ROW_STATUS_ORDER` 자리의 `case`), 바깥 질의가 `(bundle_id, 순번)`마다 센다.
2. `single_language`: 같은 단위 집합에서 `Unit.kind IN ("sentence","heading")`, 짝 없음, `Document.language_layout IN ("ko_en_interleaved","ko_en_separate")`이고, 그 단위를 출처(출처 연결)나 번역 출처(`TargetSentence.translation_source_unit_id`)로 갖는 새 문장 중 언어가 단위의 언어·`neutral`이 아닌 것이 **없는** 단위 수.

판단 행이 없는 단위는 지금처럼 빠진다(안쪽 조인 그대로).

- [ ] **Step 4: 라우터·시드 출력을 새 형에 맞춘다** — `sop_bundles.py`·`sop_admin.py`의 `BundleProgress` → `RowProgress`. `seed_sop_demo.py`의 출력 줄은 `rows total=… confirmed=… ai_suggested=… on_hold=… unassigned=… single_language=…` 한 벌.

- [ ] **Step 5: 통과를 확인한다** — `$PY -m pytest tests/test_sop_progress.py tests/test_sop_outputs.py tests/test_sop_bundles.py tests/test_seed_sop_demo.py -q` → PASS. `ruff check app/ tests/` → 깨끗.

- [ ] **Step 6: 커밋** — `feat(progress): count bundle progress in rows, one set — 진행 숫자를 줄 기준 한 벌로`

---

### Task 2: 검토 요청 조건을 줄 기준으로 (backend)

**Files:**
- Modify: `backend/app/sop/snapshot.py` (`BundleSnapshot`에 짝 정보)
- Modify: `backend/app/sop/outputs.py:842-856` (`ReviewFacts`·`build_review_facts`)
- Modify: `backend/app/sop/review.py:57-73,149-151`
- Test: `backend/tests/test_sop_review.py`, `backend/tests/test_sop_decisions.py:650`, `backend/tests/test_sop_e2e.py:166`, `backend/tests/test_sop_snapshot.py`

**Interfaces:**
- Consumes: `pick_row_status` (Task 1).
- Produces:
  - `BundleSnapshot.pair_of: dict[int, int]` — 옛 문서 활성 단위 id → 짝 id(짝이 없으면 키 없음). 스냅숏을 읽는 곳에서 질의 한 번으로 채운다.
  - `ReviewFacts.row_status_counts: Counter[str]`(상태 → 줄 수). `cover_status_counts`는 지운다.
  - `review._list_pending_blockers(subject: str, counts: Mapping[str, int]) -> list[Issue]` → `{"code": f"{subject}_{status}", "count": n}`. `lang` 키가 없다.
  - `review._count_target_statuses(snap) -> Counter[str]` — 새 문장마다 한 번.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `test_sop_review.py`의 기존 단언에서 `"lang"`을 뺀다.

```python
# test_blockers_come_from_stored_state
assert blockers == [
    {"code": "units_ai_suggested", "count": 1},
    {"code": "targets_unassigned", "count": 1},
    {"code": "targets_on_hold", "count": 1},
]

def test_unit_blockers_count_rows_not_units(client):
    """짝의 두 문장이 모두 미배정이면 막는 줄은 하나다."""
    fx = _setup(client)  # KO_1·EN_1이 짝인지 fx.view["pairs"]로 확인하고, 아니면 _create로 맺는다
    blockers = _get_readiness(client, fx.bundle_id)["blockers"]
    units = next(item for item in blockers if item["code"] == "units_unassigned")
    assert units["count"] == _expected_rows(fx.view)  # Task 1의 규칙과 같다

def test_progress_and_readiness_count_the_same_rows(client):
    """SQL 집계(진행 숫자)와 스냅숏 집계(검토 조건)가 같은 줄을 센다."""
    ...  # 한 줄 보류, 한 줄 확정으로 만든 뒤 progress의 unassigned·on_hold와 blockers의 count가 같다
```
`"lang"`을 단언하던 나머지(`test_request_review_blocked_by_one_unassigned_unit`, `test_blockers_cover_each_condition[on_hold]`, `test_readiness_uses_bounded_queries`, `test_readiness_does_not_read_document_text`, `test_sop_decisions.py::test_held_unit_blocks_review_and_shows_in_output_a`, `test_sop_e2e.py::test_end_to_end_both_entrances`)는 `"lang"`을 빼고, 단위 건수는 그 픽스처의 줄 수(`_expected_rows`)로 다시 적는다.

- [ ] **Step 2: 실패를 확인한다** — `$PY -m pytest tests/test_sop_review.py -q` → FAIL(`lang` 키가 남아 있다).

- [ ] **Step 3: 구현** — `build_review_facts`는 `index.old_units` 중 `group_unit_id is None`인 단위를 `snap.pair_of`로 묶어 줄마다 `pick_row_status`를 낸다(상태는 `get_cover_status`). `duplicate_unit_ids`는 그대로. `review.py`는 위 두 함수를 새 시그니처로 고치고 `PROGRESS_LANGS`·`NEUTRAL` 가져오기를 뺀다. `PROGRESS_LANGS`가 더 쓰이지 않으면 `snapshot.py`에서 지운다(`outputs.py`의 `Lang`은 (4)까지 남는다).

- [ ] **Step 4: 통과를 확인한다** — `$PY -m pytest tests/test_sop_review.py tests/test_sop_snapshot.py tests/test_sop_decisions.py tests/test_sop_e2e.py -q` → PASS. `test_readiness_uses_bounded_queries`의 질의 수 상한이 짝 질의 하나만큼 늘었으면 그 상한을 올리고 이유를 주석에 적는다.

- [ ] **Step 5: 커밋** — `feat(review): readiness blockers count rows, no language split — 검토 요청 조건을 줄 기준으로`

---

### Task 3: 묶음 목록·개요·관리 화면의 숫자 (frontend)

**Files:**
- Create: `frontend/src/lib/progress-model.ts`, `frontend/src/lib/progress-model.test.ts`
- Modify: `frontend/src/lib/api-sop.ts:11-22,90` 
- Modify: `frontend/src/app/page.tsx:24-43,107-132`
- Modify: `frontend/src/app/bundles/[id]/page.tsx:56,68,144-244,295`
- Modify: `frontend/src/components/admin/bundles-panel.tsx:19-40,95-96`
- Modify: `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(`#home`·`#bundle`의 Coverage 설명, 104행 부근)
- Modify: `frontend/scripts/pw-smoke-sop.mjs:77,89`, `frontend/scripts/pw-manual-shots.mjs:51`

**Interfaces:**
- Consumes: 서버 `progress: RowProgress` (Task 1), `blockers[]`에 `lang` 없음 (Task 2).
- Produces:
  - `api-sop.ts`: `export interface RowProgress { total: number; unassigned: number; ai_suggested: number; confirmed: number; on_hold: number; single_language: number }`. `LangProgress`·`BundleProgress` 삭제, `Bundle.progress`·`BundleListItem.progress`는 `RowProgress`. `ReadinessIssue.lang` 삭제.
  - `progress-model.ts`: `countPending(progress: RowProgress): number`, `getConfirmedPercent(progress: RowProgress): number | null`(total 0이면 null, 아니면 반올림 정수).
  - testid: `bundles-confirmed-<id>`(목록 칸), `overview-rate`, `overview-bar`, `overview-single-language`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `progress-model.test.ts`

```ts
const base = { total: 61, unassigned: 5, ai_suggested: 33, on_hold: 7, confirmed: 16, single_language: 17 };
it("counts rows that are not confirmed", () => expect(countPending(base)).toBe(45));
it("rounds the confirmed rate", () => expect(getConfirmedPercent(base)).toBe(26));
it("has no rate for an empty bundle", () => expect(getConfirmedPercent({ ...base, total: 0, confirmed: 0 })).toBeNull());
```

- [ ] **Step 2: 실패를 확인한다** — `npx vitest run src/lib/progress-model.test.ts` → 모듈이 없어 FAIL.

- [ ] **Step 3: 모델과 타입을 만든다** — 위 Interfaces대로.

- [ ] **Step 4: 화면을 고친다**
  - `page.tsx`: KO·EN 두 열을 `key: "confirmed"` 한 열로. 머리글은 `t("bundles.colConfirmed")`만(`LangMark` 없음), `cellTestId`는 `bundles-confirmed-${bundle.id}`, 칸은 `<ProgressValue progress={bundle.progress} />`.
  - 개요 `Coverage`: 비율 한 덩어리(`overview-rate`), 막대 하나(`overview-bar`, 앞의 `LangMark` 칸 없이 폭 전체), 표는 한 줄이고 첫 칸은 `t("overview.rows")`. 표 아래에 `progress.single_language > 0`일 때만 `<p className="text-xs text-ink-3" data-testid="overview-single-language">{t("overview.singleLanguage", { n })}</p>`. `countPending`은 모델 것을 쓴다. `PROGRESS_LANGS`·`CoverageBar`의 `lang`을 지운다.
  - `bundles-panel.tsx`: 두 열을 `key: "confirmed"` 한 열로(머리글·카드 라벨 `t("bundles.colConfirmed")`).
  - 이 세 파일의 `LangMark` 가져오기를 지운다(부품 자체는 Task 6에서 지운다).

- [ ] **Step 5: 글자를 넣는다** (`i18n-messages.ts`, en / ko)

| 키 | EN | KO |
|---|---|---|
| `bundles.colConfirmed` | Confirmed | 확정 |
| `overview.rows` (새 키) | Rows | 줄 |
| `overview.singleLanguage` (새 키) | One language only: {n} rows · not a review condition | 한 언어만 있는 줄 {n}개 · 검토 요청 조건이 아닙니다 |
| `next.decide_units.title` | Decide {n} open rows | 남은 줄 {n}개 정하기 |
| `gate.units` | {n} rows still open | 아직 정하지 않은 줄 {n}개 |
| `gate.unitsOk` | All rows decided | 줄을 모두 정했습니다 |

사용 설명서의 Coverage 설명("언어별")을 "한/영 짝을 한 줄로 센 숫자 한 벌"로 고치고, 보조 표시 한 문장을 더한다.

- [ ] **Step 6: 스크립트의 선택자를 고친다** — `pw-smoke-sop.mjs:77`은 `bundles-confirmed-<id>`의 글이 `/ ` 뒤 전체 줄 수를 담는지, `:89`는 `overview-rate`가 `%`를 담는지 본다(숫자는 시드에 따라 달라지니 API 응답 `progress`에서 읽어 견준다). `pw-manual-shots.mjs:51`의 `bundles-ko-2` → `bundles-confirmed-2`.

- [ ] **Step 7: 통과를 확인한다** — `npx vitest run` 전체 PASS, `npx tsc --noEmit -p tsconfig.json` 오류 0, `npm run lint` 깨끗.

- [ ] **Step 8: 커밋** — `feat(ui): one row-based progress on list, overview and admin — 목록·개요·관리 숫자를 줄 기준 한 벌로`

---

### Task 4: 다른 언어끼리 합치기 허용, 풀면 제 언어로 (backend)

**Files:**
- Modify: `backend/app/sop/editing.py:346-365` (`_plan_merge`), `:378-403` (`_plan_unmerge`)
- Test: `backend/tests/test_sop_editing.py:303,355,804`, `backend/tests/test_sop_tables.py:597`

**Interfaces:**
- Produces: `merge` 편집이 언어가 섞인 단위도 받는다(422 `mixed_language` 없음). 합친 단위의 언어는 기존 판정 그대로(한글이 있으면 `ko`).

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `test_merge_rejects_mixed_language`를 아래로 바꾸고 둘을 더한다.

```python
def test_merge_accepts_mixed_language(client):
    fx = _setup(client)  # 한글 문장 ko와 영어 문장 en이 이웃한 픽스처
    result = _ok(_merge(client, fx, ko, en))
    merged = _unit_by_id(client, fx, result["created_unit_ids"][0])
    assert (merged["lang"], ko["text"] in merged["text"], en["text"] in merged["text"]) == ("ko", True, True)

def test_merging_the_members_of_a_pair_removes_the_pair(client):
    ...  # ko·en이 짝(pair_id 같음) → merge → 문서 보기의 pairs에 그 짝이 없다

def test_unmerge_of_a_mixed_merge_restores_each_language(client):
    ...  # merge(ko, en) → unmerge → 되살아난 두 단위의 lang이 ("ko", "en")
```
`test_unmerge_follows_a_later_language_change`는 그대로 통과해야 한다(같은 언어끼리 합친 경우의 규칙은 유지). `EXPECTED_REFUSALS`(editing :804, tables :597)에서 `(422, "mixed_language")`를 뺀다.

- [ ] **Step 2: 실패를 확인한다** — `$PY -m pytest tests/test_sop_editing.py -q -k "mixed or pair or unmerge"` → 422로 FAIL.

- [ ] **Step 3: 구현**
  - `_plan_merge`: `mixed_language` 거절을 지우고 `_build_draft(..., lang=langs[0] if len(langs) == 1 else None)`.
  - `_plan_unmerge`: 되살릴 단위들의 저장된 언어가 **모두 같을 때만** 지금처럼 합친 단위의 언어를 따르게 한다(`langs=…`). 서로 다르면 `langs={}`로 두어 각자 제 언어로 돌아온다.

- [ ] **Step 4: 통과를 확인한다** — `$PY -m pytest tests/test_sop_editing.py tests/test_sop_tables.py tests/test_sop_pairs.py -q` → PASS.

- [ ] **Step 5: 커밋** — `feat(split): allow merging across languages, unmerge restores each language — 다른 언어끼리 합치기 허용`

---

### Task 5: 쪼개기의 묶기를 `Join` 하나로 (frontend)

**Files:**
- Modify: `frontend/src/lib/split-menu-model.ts`, `frontend/src/lib/split-menu-model.test.ts`
- Modify: `frontend/src/lib/paper-model.ts:226-237,316` (`MERGE_BLOCKER_KEYS`·`getMergeBlocker`·`getGapMerge`), `paper-model.test.ts`
- Delete: `frontend/src/lib/lang-mismatch-model.ts`, `frontend/src/lib/lang-mismatch-model.test.ts`
- Modify: `frontend/src/components/paper/paper.tsx:81,544-591` (props·틈 단추)
- Modify: `frontend/src/app/bundles/[id]/split/page.tsx:56,121-122,322-332,408-430,479,577-581,597-598,660-661,758-896`
- Modify: `frontend/src/components/split/split-context-menu.tsx:26-37`, `split-unit-actions.tsx:125`
- Modify: `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(237–258행 부근 `#split-edit`·`#split-pair`)
- Modify: `frontend/scripts/pw-smoke-sop.mjs:210,267,603-620`, `frontend/scripts/pw-manual-shots.mjs:85`

**Interfaces:**
- Consumes: 서버가 섞인 언어 합치기를 받는다 (Task 4).
- Produces (`split-menu-model.ts`):
  - `export type JoinKind = "merge" | "pair"`
  - `export interface JoinPlan { kind: JoinKind | null; reasonKey?: string }`
  - `export function planJoin(units: ViewUnit[], adjacent: boolean): JoinPlan`
  - `export function hasBothScripts(text: string): boolean` — 한글 음절과 라틴 글자가 모두 있으면 참.
  - `export function pickEnglishSide(units: Pick<ViewUnit, "id" | "text">[]): number | null` — 라틴 글자 비율이 가장 높은 단위 id, 라틴 글자가 하나도 없으면 null.
  - `SplitMenuAction`에서 `"pair"`·`"merge"`를 `"join"`으로 바꾼다. 메뉴 항목 testid는 `split-menu-join`.
- Produces (`paper.tsx` `PaperProps.strips`): `merge`·`pair`를 지우고 `join?: { busy: boolean; plan: (firstId: number, secondId: number) => JoinPlan; onJoin: (firstId: number, secondId: number, kind: JoinKind) => void }`. 틈 단추 testid는 `${testId}-join-${firstId}-${secondId}`.

`planJoin` 규칙(위에서부터):
1. 글 단위(문장·제목·칸 문장)가 아닌 것이 있으면 `kind: null`, `split.menu.why.notText`.
2. 언어가 모두 같으면 합치기: `adjacent`가 아니면 `split.menu.why.notAdjacent`, `getMergeBlocker`가 걸리면 그 이유 키, 아니면 `kind: "merge"`.
3. 한글과 영어가 섞였으면 짝: 이미 짝에 든 단위가 하나라도 있으면 `split.menu.why.alreadyPaired`, 아니면 `kind: "pair"`.
4. 그 밖(언어가 `neutral`)은 `split.menu.why.noLanguage`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `split-menu-model.test.ts`(기존 `makeUnit` 도우미를 쓴다)

```ts
describe("planJoin", () => {
  it("merges adjacent units of one language", () =>
    expect(planJoin([makeUnit(1), makeUnit(2)], true)).toEqual({ kind: "merge" }));
  it("pairs units of different languages, adjacent or not", () => {
    expect(planJoin([makeUnit(1), makeUnit(2, { lang: "en" })], true)).toEqual({ kind: "pair" });
    expect(planJoin([makeUnit(1), makeUnit(9, { lang: "en" })], false)).toEqual({ kind: "pair" });
  });
  it("does not merge far-apart units of one language", () =>
    expect(planJoin([makeUnit(1), makeUnit(9)], false)).toEqual({ kind: null, reasonKey: "split.menu.why.notAdjacent" }));
  it("does not join a unit that is already in another pair", () =>
    expect(planJoin([makeUnit(1, { pair_id: 7 }), makeUnit(2, { lang: "en" })], true)).toEqual({ kind: null, reasonKey: "split.menu.why.alreadyPaired" }));
  it("pairs one KO with two EN", () =>
    expect(planJoin([makeUnit(1), makeUnit(2, { lang: "en" }), makeUnit(3, { lang: "en" })], true)).toEqual({ kind: "pair" }));
});
describe("pickEnglishSide", () => {
  it("picks the unit with the most Latin letters", () =>
    expect(pickEnglishSide([{ id: 1, text: "로터를 닦는다" }, { id: 2, text: "Wipe the rotor 로터" }])).toBe(2));
  it("returns null when no unit has Latin letters", () =>
    expect(pickEnglishSide([{ id: 1, text: "가" }, { id: 2, text: "나" }])).toBeNull());
});
it("hasBothScripts", () => {
  expect(hasBothScripts("로터 rotor")).toBe(true);
  expect(hasBothScripts("rotor 70%")).toBe(false);
});
```
`buildSplitMenu`의 기존 테스트는 `pair`·`merge` 항목 대신 `join` 하나를 보도록 고친다(`find(items, "join")`).

- [ ] **Step 2: 실패를 확인한다** — `npx vitest run src/lib/split-menu-model.test.ts` → FAIL.

- [ ] **Step 3: 모델을 고친다** — `paper-model.ts`의 `getMergeBlocker`에서 `"mixed_language"`를 빼고 `MERGE_BLOCKER_KEYS`에서 `split.noMergeLanguage`를 뺀다. `getGapMerge`는 이름과 반환을 그대로 두되 언어를 보지 않는다. `lang-mismatch-model.*`을 지운다.

- [ ] **Step 4: 용지의 틈 단추** — `renderMerge`를 단추 하나로: `strips.join.plan(firstId, secondId)`의 `kind`가 있으면 켜진 단추(누르면 `onJoin(firstId, secondId, kind)`), 없으면 지금의 꺼진 합치기 단추와 같은 모양에 `data-tip`으로 이유. 라벨은 `t("split.joinAdjacent")`, 아이콘은 `kind === "pair"`일 때 `Link2`, 아니면 `FoldVertical`. 짝 단추만 쓰던 `.strip-pair` 색 구분은 지운다.

- [ ] **Step 5: 쪼개기 화면**
  - `strips.join`을 넘긴다: `plan`은 `planJoin([first, second], true)`, `onJoin`은 `kind`가 `"merge"`면 `runEdit({ type: "merge", unit_ids })`, `"pair"`면 `createPair(...)`. 성공 알림은 둘 다 `t("split.didJoin")`.
  - 옆 칸에서 지우는 것: `split-language` 섹션 전체, `split-lang-mismatch` 경고와 `findLangMismatch` 호출, `split-unit-state`의 `LangMark`, `split-pair-status` 알약, `split-pair-confirm` 단추.
  - `split-pair` 섹션: 제목 `t("split.joined")`. 짝이 있으면 상대 목록(`split-pair-unit-<id>`, `LangMark` 없이) + 전환 `split-join-mode`(단추 둘 `split-join-mode-one`·`split-join-mode-pair`, `aria-pressed`) + `split-pair-remove`.
    - 짝인 단위에서 `One sentence`를 누르면 `runEdit({ type: "merge", unit_ids: pair.unit_ids })`(합치면 서버가 짝을 지운다).
    - 합쳐 만든 단위(`selected.can_unmerge`)이고 `hasBothScripts(selected.text)`면 같은 전환을 `One sentence`가 눌린 채로 보인다. `KO/EN pair`를 누르면: ① `unmerge` 편집 → ② 보기를 다시 읽어 전에 없던 활성 단위 id를 되살아난 단위로 본다 → ③ `planJoin`이 `pair`면 `createPair`, 언어가 같으면 `pickEnglishSide`가 고른 단위를 `set_language: "en"`으로 바꾼 뒤 `createPair`. 중간에 실패하면 어디까지 됐는지 알린다(`split.join.partly`).
    - `hasBothScripts`가 거짓이면 `KO/EN pair` 단추를 끄고 `data-tip`에 `t("split.menu.why.oneLanguage")`.
  - 떨어진 조각 고르기(`split-pair-pick`·`split-pair-create`)는 그대로 두고 글자만 바꾼다. `split-pair-create`는 `planJoin([selected, ...picked], false).kind === "pair"`일 때만 켠다.
  - 그 자리 메뉴: `pair`·`merge` 대신 `join` 하나. `lang_ko`·`lang_en`은 남긴다(언어를 직접 고치는 유일한 길).

- [ ] **Step 6: 글자** (en / ko)

| 키 | EN | KO |
|---|---|---|
| `split.joinAdjacent` (새 키, `split.mergeAdjacent`·`split.pairAdjacent` 대신) | Join | 묶기 |
| `split.menu.join` (새 키, `split.menu.merge`·`split.menu.pair` 대신) | Join | 묶기 |
| `split.didJoin` (새 키) | Joined | 묶었습니다 |
| `split.joined` (새 키, 섹션 제목) | Joined with | 함께 묶인 문장 |
| `split.join.one` (새 키) | One sentence | 한 문장으로 |
| `split.join.pair` (새 키) | KO/EN pair | 한/영 짝 |
| `split.join.partly` (새 키) | Separated, but could not pair them again. Join them by hand. | 풀었지만 다시 짝으로 묶지 못했습니다. 직접 묶어 주세요. |
| `split.menu.why.oneLanguage` (새 키) | This sentence is in one language. | 한 언어로만 된 문장입니다. |
| `split.removePair` | Separate | 따로 떼기 |
| `split.pairRemoved` | Separated | 따로 뗐습니다 |
| `split.pairWith` | Join with... | 묶을 문장 고르기 |
| `split.pickingPair` | Picking | 고르는 중 |
| `split.pairPickHint` | Click the sentences that say the same thing, then join. | 같은 내용의 문장을 누른 뒤 묶으세요. |
| `split.makePair` | Join | 묶기 |
| `split.noPair` | Not joined | 묶인 문장 없음 |

지우는 키: `split.language`, `split.lang.mismatch.singleLangOther`·`.interleavedRun`·`.fix`, `split.confirmPair`, `split.pairConfirmed`, `split.noMergeLanguage`, `split.mergeAdjacent`, `split.pairAdjacent`, `split.menu.merge`, `split.menu.pair`, `split.menu.why.sameLanguage`, `rule.mixed_language`, 그리고 다른 곳에서 안 쓰이면 `status.pair.suggested`·`status.pair.confirmed`·`split.pair`·`split.pairInfo`. 지우기 전에 `git grep`으로 남은 사용처가 없는지 본다.

사용 설명서 `#split-edit`·`#split-pair`를 새 라벨(**Join**, **Separate**, **Join with...**, **One sentence**, **KO/EN pair**)로 다시 쓰고, **Language**·**Confirm pair** 설명을 지운다. 언어를 직접 고치는 길은 오른쪽 단추 메뉴라고 한 줄 남긴다.

- [ ] **Step 7: 스모크 스크립트** — `pw-smoke-sop.mjs`의 `split-paper-merge-` → `split-paper-join-`, `:603-620`의 짝 흐름은 `split-menu-join`으로 묶고 `split-join-mode-pair`가 눌린 것(`aria-pressed="true"`)을 본다(`split-pair-status` 단언은 지운다). `pw-manual-shots.mjs:85`의 `split-language` 표시 자리를 뺀다.

- [ ] **Step 8: 통과를 확인한다** — `npx vitest run` 전체 PASS, `npx tsc --noEmit -p tsconfig.json` 오류 0, `npm run lint` 깨끗.

- [ ] **Step 9: 커밋** — `feat(split): one Join action, pair or merge chosen by the system — 묶기를 Join 하나로`

---

### Task 6: 용지의 언어 표시를 걷고 1:N 짝을 한 카드로 (frontend)

**Files:**
- Modify: `frontend/src/lib/strip-pill-model.ts`, `strip-pill-model.test.ts`
- Modify: `frontend/src/components/paper/strip-lead.tsx`, `paper.tsx:3,232-312,594-618,715-804,869`
- Modify: `frontend/src/components/assign/new-pane.tsx:87,182-191`
- Delete: `frontend/src/components/lang-mark.tsx`, `lang-mark.test.ts`
- Modify(LangMark 걷기): `frontend/src/app/bundles/[id]/assign/page.tsx:120,900,970,1019`, `src/components/assign/destination-tree.tsx:12,72`, `link-choice.tsx:6,31`, `src/components/split/split-help.tsx:6,30-39`, `src/components/assign/assign-help.tsx:7,44-52`
- Modify: `frontend/src/styles/components.css:974-980,1047,1075-1079,1149-1167,1191-1194,1480`, `frontend/src/styles/tokens.css:116-118,185`, `frontend/docs/design/tokens.css`(같은 토큰의 사본)
- Modify: `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(210·237·238·338행 부근)

**Interfaces:**
- Produces (`strip-pill-model.ts`):
  - `export type PairBracket = "top" | "middle" | "bottom"`
  - `export function getPairBrackets(strips: readonly { unitId: number; groupId: number | null }[]): Map<number, PairBracket>` — 같은 `groupId`(null 아님)가 **이어진** 줄이 둘 이상이면 첫 줄 `top`, 끝 줄 `bottom`, 사이 `middle`. 떨어진 구성원은 맵에 없다.
- Produces (`strip-lead.tsx`): `StripLeadProps`에서 `lang`을 지운다. `STRIP_LEAD_EXTRA = 5`(막대 3px이 빠지고 조각까지 틈 5px만).

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `strip-pill-model.test.ts`

```ts
describe("getPairBrackets", () => {
  it("joins two adjacent members", () =>
    expect([...getPairBrackets([{ unitId: 1, groupId: 9 }, { unitId: 2, groupId: 9 }])]).toEqual([[1, "top"], [2, "bottom"]]));
  it("joins three adjacent members with a middle", () =>
    expect([...getPairBrackets([{ unitId: 1, groupId: 9 }, { unitId: 2, groupId: 9 }, { unitId: 3, groupId: 9 }])]).toEqual([[1, "top"], [2, "middle"], [3, "bottom"]]));
  it("leaves a far-apart member alone", () =>
    expect([...getPairBrackets([{ unitId: 1, groupId: 9 }, { unitId: 2, groupId: null }, { unitId: 3, groupId: 9 }])]).toEqual([]));
  it("keeps two neighbouring pairs apart", () =>
    expect([...getPairBrackets([{ unitId: 1, groupId: 9 }, { unitId: 2, groupId: 9 }, { unitId: 3, groupId: 8 }, { unitId: 4, groupId: 8 }])].map(([, bracket]) => bracket)).toEqual(["top", "bottom", "top", "bottom"]));
});
```

- [ ] **Step 2: 실패를 확인한다** — `npx vitest run src/lib/strip-pill-model.test.ts` → FAIL.

- [ ] **Step 3: 모델과 부품** — `getPairBrackets`를 새 시그니처로. `StripLead`에서 `.strip-lead-bar` 요소와 `lang`을 지운다(보류 설명 `tip`과 sr-only 글, 번호 칸 툴팁은 그대로).

- [ ] **Step 4: 용지** — `paper.tsx`의 `partnerOf`(둘짜리 짝만)를 `matesOf: Map<number, ViewUnit[]>`(자기를 뺀 같은 짝의 단위, 원문 순서)로 바꾸고, `getPairBrackets`에는 `{ unitId, groupId: unit.pair_id }`를 준다. `partnerOf`를 쓰던 곳(고른 단위의 짝 강조·접기에서 한 묶음으로 보기·절 머리 판정·번호 칸 폭 맞춤)은 "같은 카드의 첫 줄"을 기준으로 다시 맞춘다 — 카드의 둘째 줄부터는 첫 줄의 번호 칸 폭과 절 머리를 따른다. `describeTab`은 보류 설명만 낸다. `new-pane.tsx`는 `groupId`를 `row.partner_target_id === null ? null : Math.min(row.target_id, row.partner_target_id)`로 준다.

- [ ] **Step 5: CSS**
  - 지운다: `.strip-lead-bar`와 그 `[data-lang]`·`[data-bracket]` 규칙, `.fold-line > .strip-lead > .strip-lead-bar`, `.legend-pairbar`, `.lmark`·`.tree-leaf .lmark`, `.strip-pair` 색 규칙, 토큰 `--lang-ko`·`--lang-en`(라이트·다크, `frontend/docs/design/tokens.css` 사본도).
  - 더한다: `.pg[data-strips] .strip[data-bracket="middle"]`(위 `1px dashed var(--line-2)`, 아래 테두리 없음, 모서리 0)과 그 강조 테두리 변수(`--ring-inset: 0 -2px`, `--ring-bw: 0 2px`, `--ring-r: 0`). 강조 테두리 선택자(`:1165-1167`)는 카드의 모든 줄에 두르되 맞닿는 쪽을 여는 지금 방식 그대로, 줄 수와 무관하게 동작해야 한다.
  - 바꾼다: `.layout-picto i.ko { background: var(--ink-2); }`, `.layout-picto i.en { background: var(--ink-4); }`.
  - 1280 미만 Split의 앞머리 상한(`max-width: 46px`)과 `--gap-tab-cap`은 그대로 둔다.

- [ ] **Step 6: `LangMark` 걷기** — Files의 모든 사용처에서 지운다. 배정 문장 칸(`assign/page.tsx:1018` 부근)은 `grid-cols-[22px_minmax(0,1fr)]`을 한 칸으로 바꾼다. 도움말 범례(`split-help.tsx`·`assign-help.tsx`)는 언어 막대·짝 막대 줄을 지우고 짝 줄을 "붙은 카드 + 고리 아이콘"으로 설명한다. 그 뒤 `lang-mark.tsx`·`lang-mark.test.ts`를 지운다.

- [ ] **Step 7: 글자** — 지우는 키: `split.tabKo`, `split.tabEn`, `split.legendLang`, `split.legendPairBar`, `assign.legend.lang`, `assign.legend.pairBar`(지우기 전 `git grep`으로 확인). `split.legendPair`·`assign.legend.pair`의 글은 en "KO/EN pair — joined card" / ko "한/영 짝 — 붙은 카드". 사용 설명서에서 "색 막대 = 언어" 설명을 지우고 짝 카드 설명을 맞춘다.

- [ ] **Step 8: 통과를 확인한다** — `npx vitest run` 전체 PASS, `npx tsc --noEmit -p tsconfig.json` 오류 0, `npm run lint` 깨끗, `git grep -n "lmark\|strip-lead-bar\|--lang-ko\|--lang-en\|LangMark" frontend/src` 결과 없음.

- [ ] **Step 9: 화면 감사** — `reset_db → seed_sop_demo → seed_sop_worst`를 얹은 별도 sqlite 파일로 backend 8787·frontend 3787을 띄우고(`docs/lessons/browser-verification.md`) `DS=worst BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs`, `node scripts/pw-overlap-audit.mjs`, `node scripts/pw-contrast-audit.mjs`를 돌린다. 모두 종료 코드 0. 실패하면 그 자리에서 배치를 고친다(보고만 하고 넘기지 않는다).

- [ ] **Step 10: 커밋** — `feat(paper): drop language marks, join pairs of any size as one card — 용지 언어 표시 삭제·1:N 짝 한 카드`

---

### Task 7: 배정 저장 — 언어로 막지 않고, 짝의 운명을 서버가 정한다 (backend)

**Files:**
- Create: `backend/app/sop/pair_settle.py`, `backend/tests/test_sop_pair_settle.py`
- Create: `backend/alembic/versions/0013_target_remark.py`
- Modify: `backend/app/sop/models.py`(`TargetSentence.remark`), `backend/app/sop/pairs.py:112-139`
- Modify: `backend/app/sop/decisions.py:109,583-595,656,699-739,987-1071`, `backend/app/sop/groups.py:145-172`, `backend/app/sop/written.py:26`, `backend/app/sop/match.py:503-526`
- Test: `backend/tests/test_sop_decisions.py:207,325`, `backend/tests/test_sop_ai_translate.py:762`, `backend/tests/test_sop_pairs.py`

**Interfaces:**
- Produces (`pairs.py`): `async def mark_pair_confirmed(session, document: Document, pair: UnitPair, actor: str) -> None`, `async def dissolve_pair(session, document: Document, pair: UnitPair, actor: str) -> None` — 지금 `confirm_pair`·`delete_pair`의 몸통을 옮긴 것(채택 기록·`pair.confirm`/`pair.delete` 이벤트·문서 `revision` 올리기 포함). 두 공개 함수는 이것을 부른다.
- Produces (`pair_settle.py`):
  ```python
  @dataclass(frozen=True)
  class PairSettleReport:
      confirmed_pair_ids: list[int]
      dissolved_pair_ids: list[int]

  async def settle_pairs(
      session: AsyncSession, bundle_id: int, unit_ids: Collection[int], actor: str, *, release: Collection[int] = ()
  ) -> PairSettleReport
  ```
- Produces (요청·응답):
  - `GroupSaveIn.release_unit_ids: list[DbId] = Field(default_factory=list, max_length=500)` — "남는 쪽을 따로 줄로".
  - `GroupOut.pairs_confirmed: list[int] = []`, `GroupOut.pairs_dissolved: list[int] = []`(저장 응답에서만 채운다).
  - `TargetIn.remark: Annotated[str, StringConstraints(max_length=2000), NO_NUL] | None = None`, `GroupTargetOut.remark: str`, `WrittenSentenceOut.remark: str`.
- 없어지는 거절: `invalid_group`의 `lang_mismatch`.

`settle_pairs` 규칙 — `unit_ids`·`release`의 단위가 든 짝마다, 위에서부터 하나만 적용한다:
1. **풀기(요청)**: 구성 단위가 `release`에 있으면 푼다.
2. **풀기(갈림)**: 처분이 `unassigned`가 아닌 구성 단위들의 "운명"이 둘 이상이면 푼다. 운명 = `(disposition, move_target_code if disposition == "move_external" else "", frozenset(그 단위를 출처로 갖는 새 문장의 target_doc_id))`. 같은 새 문서 안에서 칸·단계·절이 다른 것은 같은 운명이다.
3. **확정**: 짝이 `suggested`이고 모든 구성 단위의 판단 상태가 `confirmed`면 확정한다.

부르는 곳: `save_group`(`_write_group` 뒤, `release=payload.release_unit_ids`), `dispose_units`(판단을 쓴 뒤), `match.confirm_in_bulk`(`_write_bulk` 뒤). `clear_unit`·`reset_assignments`는 부르지 않는다(미배정으로 돌아가는 길).

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 짝** (`test_sop_pair_settle.py`. 설정은 `test_sop_decisions.py`의 `_setup`·`_unit_in`·`_target`·`_body`와 `sop_helpers.save_group`을 쓴다. `ko`·`en`은 그 픽스처의 `"1. 목적"`·`"1. Purpose"`이고 올릴 때 제안 짝이 된다 — `fx.view["pairs"]`로 확인하고 아니면 `POST …/pairs`로 맺는다.)

```python
def _pair_of(client, fx, unit) -> dict | None:
    """문서 보기에서 그 단위가 든 짝."""

def test_confirming_the_whole_row_confirms_a_suggested_pair(client):
    fx, ko, en = ...
    targets = [_target("ko", fx.sop_id, [ko], slot_key="purpose"), _target("en", fx.sop_id, [en], slot_key="purpose")]
    group = save_group(client, fx.bundle_id, _body([_unit_in(ko), _unit_in(en)], targets)).json()
    assert _pair_of(client, fx, ko)["status"] == "confirmed"
    assert group["pairs_confirmed"] == [_pair_of(client, fx, ko)["id"]]

def test_pair_stays_suggested_while_one_member_is_undecided(client):
    ...  # ko만 저장 → 짝 status "suggested", pairs_dissolved == []

def test_pair_stays_when_members_go_to_different_sections_of_one_doc(client):
    ...  # ko → slot "purpose", en → slot "scope", 같은 fx.sop_id → 짝 유지·확정

def test_pair_dissolves_when_members_go_to_different_documents(client):
    ...  # ko → fx.sop_id, en → fx.wi_id (wi_step·wi_part) → _pair_of(...) is None, group["pairs_dissolved"] == [pair_id]
    # 작업 기록에 pair.delete 가 하나 남는다

def test_pair_dissolves_when_one_member_is_deleted_and_the_other_assigned(client):
    ...  # ko 배정 저장 뒤 en을 POST /decisions/bulk 로 delete → 짝 없음

def test_bulk_delete_of_both_members_keeps_and_confirms_the_pair(client):
    ...  # 두 단위를 한 번에 delete(같은 reason) → 짝 status "confirmed"

def test_release_unit_ids_dissolves_the_pair_in_the_same_save(client):
    body = _body([_unit_in(ko)], [_target("ko", fx.sop_id, [ko], slot_key="purpose")], release_unit_ids=[en["id"]])
    group = save_group(client, fx.bundle_id, body).json()
    assert group["pairs_dissolved"] == [pair_id]
    assert _list_units(client, fx.bundle_id)[en["id"]]["status"] == "unassigned"
```

- [ ] **Step 2: 실패하는 테스트를 쓴다 — 언어와 변경 종류** (`test_sop_decisions.py`. `test_language_must_match_source`를 아래 첫 테스트로 바꾼다.)

```python
def test_a_target_in_another_language_is_translated(client):
    fx, ko = ...
    target = _target("x", fx.sop_id, [ko], slot_key="purpose", lang="en", text="Purpose")
    group = save_group(client, fx.bundle_id, _body([_unit_in(ko)], [target])).json()
    assert [(t["lang"], t["change_type"]) for t in group["targets"]] == [("en", "translated")]

def test_one_unit_to_both_languages_is_not_a_split(client):
    """영어 옛 문장 하나 → 영어 새 문장(그대로) + 한글 새 문장(번역). 둘 다 나눔이 되면 안 된다."""
    targets = [
        _target("en", fx.sop_id, [en], slot_key="purpose"),
        _target("ko", fx.sop_id, [en], slot_key="purpose", lang="ko", text="목적"),
    ]
    group = save_group(client, fx.bundle_id, _body([_unit_in(en)], targets)).json()
    assert sorted((t["lang"], t["change_type"]) for t in group["targets"]) == [("en", "as_is"), ("ko", "translated")]

def test_two_targets_in_the_source_language_are_still_a_split(client): ...  # 기존 나눔 동작 유지

def test_target_language_defaults_to_the_source_language(client): ...  # lang을 안 보내면 출처 언어, change_type은 글자 비교 종류

def test_entrance_two_target_keeps_its_own_language(client):
    ...  # test_new_doc_target_links_and_detaches의 설정으로 한글 새 문장(new_doc)에 영어 옛 단위를 잇는다
    # → 200, target lang "ko", change_type "translated" (전에는 lang_mismatch)

def test_target_remark_round_trips(client):
    ...  # TargetIn.remark="신규 로그북" → group["targets"][0]["remark"] == "신규 로그북", written-sentences 응답에도 같다
```
`test_sop_ai_translate.py:762`의 `({"lang": "ko"}, "lang_mismatch")` 경우는 지운다(번역 줄의 언어는 행의 언어로 잠겨 있어 보낸 값을 따르지 않는다 — 그 대신 저장 뒤 `lang`이 그대로임을 보는 단언 하나를 더한다).

- [ ] **Step 3: 실패를 확인한다** — `$PY -m pytest tests/test_sop_pair_settle.py tests/test_sop_decisions.py -q` → FAIL.

- [ ] **Step 4: 언어와 변경 종류를 고친다** (`decisions.py`)
  - `_resolve_lang(item, row, state, text: str) -> str`: 표·그림은 `NEUTRAL`. 행의 기원이 `new_doc`이나 `translation`이면 `row.lang`(보낸 `lang`은 따르지 않는다). 그 밖의 문장은 `item.lang`이 있으면 그 값, 없으면 출처 언어가 하나일 때 그 언어, 섞였거나 없으면 `detect_language(text)` → `row.lang` → 첫 출처의 언어 순. 거절하지 않는다.
  - `spread`: `state.units[unit_id].lang == plan.lang`인 (단위, 새 문서)만 센다.
  - `_decide_change_type`: `len(plan.sources) >= 2 → "merged"` 다음, 나눔 검사 앞에 "새 문장 언어가 출처 단위 언어와 다르고 둘 다 `NEUTRAL`이 아니면 `"translated"`"를 넣는다.

- [ ] **Step 5: 짝 정하기를 넣는다** — `pairs.py`에서 두 몸통을 떼고, `pair_settle.py`를 위 규칙으로 쓴다(짝·구성 단위·판단·출처 연결을 묶음 질의로 읽는다, 단위마다 질의하지 않는다). 세 부르는 곳에 잇고, `save_group`은 보고를 `GroupOut.pairs_confirmed`·`pairs_dissolved`에 싣는다.

- [ ] **Step 6: Remark 칸** — `TargetSentence.remark: Mapped[str] = mapped_column(Text, default="")`, 리비전 `0013_target_remark.py`(`down_revision = "0012"`, 기존 행은 빈 글 — `0011_target_number_style.py`의 서버 기본값 방식을 따른다). `TargetIn.remark`가 `None`이 아니면 `strip()`해 쓴다. `GroupTargetOut`·`WrittenSentenceOut`에 싣는다.

- [ ] **Step 7: 짝을 맺을 때 이미 있던 번역을 쓸어 낸다** — `create_pair` 끝에서, 묶인 단위를 번역 출처로 갖는 새 문장이 있으면 그 단위를 출처로 갖는 새 문장들의 id로 `sweep_translations`를 부른다(AI 번역은 지워지고 확정 번역은 보류). 테스트는 `test_sop_ai_translate.py`의 번역 픽스처로 `test_pairing_a_translated_unit_sweeps_the_translation`을 더한다.

- [ ] **Step 8: 통과를 확인한다** — `$PY -m pytest tests/ -q -n auto` 전체 PASS(모델과 마이그레이션 일치 테스트 포함), `ruff check app/ tests/` 깨끗.

- [ ] **Step 9: 커밋** — `feat(assign): links are not blocked by language, the server settles pairs — 언어로 막지 않는 배정·짝은 서버가 정한다`

---

### Task 8: 배정 화면 — 잠금 해제·함께 잇기·Remark·손으로 쓰는 다른 언어 (frontend)

**Files:**
- Modify: `frontend/src/lib/api-sop.ts:603-622,719` (`TargetInput.remark`, `GroupSaveInput.release_unit_ids`, `Group.pairs_confirmed`·`pairs_dissolved`, `WrittenSentence.remark`, `GroupTarget.remark`)
- Modify: `frontend/src/lib/assign-model.ts:36-41,97-133`, `assign-model.test.ts:73-87,246+`
- Modify: `frontend/src/lib/classify-model.ts:228-289,335-465`, `classify-model.test.ts`
- Modify: `frontend/src/components/assign/new-pane.tsx:18-39,174-198`
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx:333-334,381,555-604,675-718,864,1005-1063,1120-1140,1175-1191,1256-1281,1562`
- Modify: `frontend/src/styles/components.css:1407-1408`
- Modify: `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(315·386·392·407–411·428–430행 부근)
- Modify: `frontend/scripts/pw-smoke-sop.mjs:744-750,796-839`

**Interfaces:**
- Consumes: 저장 요청 `release_unit_ids`, 응답 `pairs_dissolved`, `TargetIn.remark`, 언어가 다른 연결 = `translated` (Task 7).
- Produces:
  - `assign-model.ts`: `addPartnerTargets(picked: number[], written: Map<number, WrittenSentence>): number[]`(`rowLangs` 인자 삭제 — 짝 상대를 늘 더한다). `isRecommendationPicked`도 같은 식으로 `rowLangs`를 뺀다.
  - `classify-model.ts`: `SentenceSlot`에 `isTranslated: boolean`(슬롯 언어가 출처 단위들의 언어와 모두 다름). `buildSentenceSlots(group, units, extra?: { lang: "ko" | "en"; unitId: number } | null)` — `extra`가 있으면 끝에 빈 슬롯 `{ key: "x<unitId>", target: null, lang, sourceIds: [unitId], text: "", sourceText: null, isAiPending: false, isTranslated: true }`를 더한다. `buildGroupSave`는 잇기에서 남는 단위를 `release_unit_ids`에 싣는다.
  - testid: `assign-write-other`(다른 언어 직접 쓰기), `assign-new-remark`(출처 없는 New 문장의 Remark).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// assign-model.test.ts — 기존 written 픽스처(71 KO ↔ 72 EN 짝)를 쓴다
it("always picks the New partner too", () => expect(addPartnerTargets([72], written)).toEqual([72, 71]));
it("draws a line to a New sentence the row has no language for", () => {
  // 영어 단위 하나, 한글 새 문장 하나 → 선 하나
  expect(buildLinkPairs(newRows, new Set(), { units: [{ id: 5, lang: "en" }], targetIds: [71] })).toHaveLength(1);
});

// classify-model.test.ts
it("sources a linked sentence from the same-language unit when the row has one", ...);  // 기존 동작
it("sources a linked sentence from every unit when the row lacks its language", () => {
  // 영어 단위만 있는 줄을 한글·영어 새 문장 둘에 잇는다 → 한글 새 문장의 source_unit_ids가 그 영어 단위, change_type은 보내지 않는다
});
it("releases the leftover unit in the same save", () => {
  // 한/영 짝 줄을 영어 새 문장 하나에만 잇는다 → body.release_unit_ids == [한글 단위 id]
});
it("adds an empty slot for a hand-written other language", () => {
  const slots = buildSentenceSlots(group, [enUnit], { lang: "ko", unitId: enUnit.id });
  expect(slots.at(-1)).toMatchObject({ key: `x${enUnit.id}`, lang: "ko", sourceIds: [enUnit.id], isTranslated: true });
});
it("does not call a translated slot a split", ...);  // 같은 단위에서 나온 영어 슬롯 + 한글 슬롯 → 어느 쪽도 나눔 표시가 아니다
```

- [ ] **Step 2: 실패를 확인한다** — `npx vitest run src/lib/assign-model.test.ts src/lib/classify-model.test.ts` → FAIL.

- [ ] **Step 3: 모델을 고친다**
  - `addPartnerTargets`·`isRecommendationPicked`에서 `rowLangs`를 뺀다.
  - `buildLinkPairs`: 초안 선은 같은 언어 단위에 잇고, 같은 언어 단위가 없으면 줄의 모든 단위에 잇는다.
  - `buildGroupSave`(잇기): 이은 새 문장마다 출처는 같은 언어의 줄 단위, 없으면 줄의 모든 단위. 언어가 다른 연결은 `change_type`을 보내지 않는다. `listLinkLeftovers`가 낸 단위는 판단에서 빼고 `release_unit_ids`에 싣는다(확정 저장일 때만).
  - `buildSentenceSlots`의 `extra`와 `isTranslated`.

- [ ] **Step 4: 화면을 고친다**
  - New 칸: `allowedLangs` prop, `isBlocked`, `data-blocked`, `.new-line[data-blocked]` CSS를 지운다. `pickNewSentence`의 `assign.langMismatch` 알림을 지운다.
  - 저장: `splitPairRow`와 그 부르는 곳(`runSave`·`linkAsSource`), `deletePair` 가져오기를 지운다. 저장 응답의 `pairs_dissolved`에 그 줄의 `pairId`가 있으면 지금 `splitPairRow`가 하던 화면 갱신(`listUnpairedKeys`로 줄 키를 나누고 `views.reload()`)을 하고 알림을 띄운다 — 남는 쪽을 실어 보냈으면 `assign.leftover.split`, 아니면 `assign.pairDissolved`.
  - 문장 칸: `structural` 판정을 같은 언어 슬롯끼리만 보게 하고, `slot.isTranslated`면 변경 종류 줄에 `t("classify.changeType")` · `t("change.translated")`를 글로 보인다(고르는 칸 없음). 잇기 화면의 종류 고르기(`As is | Tone | Rewritten`)도 언어가 다른 연결에서는 같은 글로 바꾼다.
  - 다른 언어 직접 쓰기: `canMakeOtherLanguage(...)`가 값을 내면 `aiOn`과 무관하게 `assign-write-other` 단추를 보인다(AI 단추 `assign-make-other` 옆). 누르면 편집 상태로 들어가 `buildSentenceSlots`에 `extra`를 넘긴다. 저장은 그 슬롯을 같은 보낸 곳의 새 문장(`lang` 지정, 출처는 그 단위)으로 보낸다. 글이 비어 있으면 그 슬롯은 보내지 않는다.
  - Remark: 라벨·안내 글자만 바꾼다(아래 표). 출처 없는 New 문장 화면(`mode === "unsourced"`, 1256행 부근)에 `assign-new-remark` 입력(`maxLength={2000}`)을 더하고, 신규 확정 저장에 `TargetInput.remark`로 싣는다. 저장된 값은 `WrittenSentence.remark`에서 읽는다.

- [ ] **Step 5: 글자** (en / ko)

| 키 | EN | KO |
|---|---|---|
| `classify.reason` | Remark | Remark |
| `classify.reasonOptional` | Optional, or the hold reason | 선택, 보류할 때는 보류 사유 |
| `assign.writeKo` (새 키) | Write Korean | 한국어 직접 쓰기 |
| `assign.writeEn` (새 키) | Write English | 영어 직접 쓰기 |
| `assign.pairDissolved` (새 키) | The pair was separated because its sentences went to different places. | 문장이 서로 다른 곳으로 가서 짝을 풀었습니다. |
| `assign.newRemark` (새 키, 입력 안내) | Remark (optional) | Remark(선택) |

지우는 키: `assign.langMismatch`, `assign.leftover.unpairFailed`, `rule.invalid_group.lang_mismatch`. `classify.reason`을 다른 화면(결과물 등)이 쓰면 그 화면의 글자도 Remark가 된다 — `git grep "classify.reason"`으로 쓰는 곳을 보고, 결과물 A의 열 머리는 건드리지 않는다((4)).

사용 설명서: **Reason** → **Remark**(315·407행 부근), `#assign-links`의 "다른 언어는 잠긴다" 설명을 "다른 언어 줄도 이을 수 있고 **Translated**로 적힌다"로, `#assign-confirm`의 남는 문장 설명을 "확정하면 짝이 풀린다(서버가 함께 처리)"로, `#assign-translate`에 **Write Korean** / **Write English**를 더한다.

- [ ] **Step 6: 스모크 스크립트** — `pw-smoke-sop.mjs:744-750`의 "같은 언어 둘째 고르기"를 언어와 무관하게 둘째 줄을 고르도록, `:796-839`의 한 언어만 잇는 흐름은 확정 뒤 줄이 둘로 나뉘는 것(`assign-link-leftover` 글과 나뉜 줄)을 그대로 보되 `deletePair` 요청이 따로 나가지 않는 것을 더해 본다.

- [ ] **Step 7: 통과를 확인한다** — `npx vitest run` 전체 PASS, `npx tsc --noEmit -p tsconfig.json` 오류 0, `npm run lint` 깨끗.

- [ ] **Step 8: 브라우저로 확인한다** — `reset_db → seed_sop_demo` 직후 DB로 backend(가짜 AI 없이)·frontend를 띄우고 `BASE_URL=… node scripts/pw-smoke-sop.mjs` → 실패 0. 손으로 한 번: 묶음 2에서 OLD-5(영어만)의 줄을 고르고 New 문서 WI-05의 영어 줄을 누르면 한글 줄이 함께 골라지고, 확정하면 한글 줄의 변경 종류가 Translated다.

- [ ] **Step 9: 커밋** — `feat(assign): no language lock, partner linked together, Remark — 배정 잠금 해제·함께 잇기·Remark`

---

### Task 9: 문서 맞추기, 전체 검증, `dev`에 한 번 합치기

**Files:**
- Modify: `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md` (§6.4·§6.5·§6.7·§7.4·§7.5·§7.7·§7.9·§7.15 — 수정안 §10 표에서 (1)~(3)에 해당하는 줄)
- Modify: 명세 수정안 "언어 축 걷어 내기"(지금은 지움) (상태 줄: (1)~(3) 구현 끝, (4) 남음)
- Modify: `backend/CLAUDE.md`, `frontend/CLAUDE.md`, 루트 `CLAUDE.md`(상태 줄의 버전), `docs/README.md`(이 계획 한 줄)
- Modify: `frontend/public/manual/img/*.png`, `docs/manual/img/*`(다시 뽑기)
- Modify: `frontend/package.json`·`package-lock.json`(버전), `CHANGELOG.md`, `PROGRESS.md`

- [ ] **Step 1: 제품 명세에 흡수한다** — 수정안 §10 표대로 본문을 고친다. §7.13·§7.14·§12와 섹션 번호는 (4)에서 고치므로 손대지 않는다. 고친 문장 끝에 "(사용자 결정 2026-11-12, 언어 축)"을 단다.

- [ ] **Step 2: 폴더별 CLAUDE.md** — `backend/CLAUDE.md`에 `pair_settle.py`(짝의 확정·풀기는 판단을 쓰는 길 끝에서 이 함수 하나가 한다 — 새 쓰기 길을 만들면 여기를 부른다)와 줄 기준 숫자(`load_bundle_progress`와 `build_review_facts`가 같은 규칙)를 적는다. `frontend/CLAUDE.md`의 `classify-model`·`assign-model` 설명에서 "확정 뒤 짝을 푼다"를 "남는 단위를 `release_unit_ids`로 보낸다"로 고친다.

- [ ] **Step 3: 전체 검증**
  - backend: `$PY -m pytest tests/ -q -n auto` 전체 PASS, `ruff check app/ tests/` 깨끗.
  - frontend: `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npm run build`(경고 0, dev 서버를 먼저 내린다).
  - 브라우저(`reset_db → seed_sop_demo` 직후 DB, backend는 `FAKE_AI_SPLIT=1` 가짜 AI를 본다): `pw-smoke-baseline.mjs`, `pw-smoke-sop.mjs`, `pw-contrast-audit.mjs`, `pw-overlap-audit.mjs` 모두 실패 0. 극단 자료 DB에서 `DS=worst … pw-layout-audit.mjs` 종료 코드 0.

- [ ] **Step 4: 설명서 그림을 다시 뽑는다** — `MANUAL=app BASE_URL=… node scripts/pw-manual-shots.mjs`를 먼저, 그다음 `BASE_URL=… node scripts/pw-manual-shots.mjs`(뒤의 것이 묶음 3을 바꾼다). `npx vitest run src/lib/manual-content.test.ts` PASS.

- [ ] **Step 5: 버전과 기록** — `frontend/`에서 `npm version patch --no-git-tag-version`(0.16.5 → 0.16.6). `CHANGELOG.md`의 `## Unreleased (dev)` 아래에 `v0.16.6 — <날짜>`와 바뀐 것(EQUIS 표기, 줄 기준 숫자, Join, 용지 언어 표시 삭제, 배정 잠금 해제·Remark, "결과물·검토 화면은 다음 작업까지 판 전환이 남는다")을 적는다. `PROGRESS.md`는 이 브랜치의 항목들을 한 요약 항목으로 합친다(`rules/common/git.md` "On Branch Merge"). 루트 `CLAUDE.md` 상태 줄에 v0.16.6 한 구절을 더한다.

- [ ] **Step 6: 커밋** — `chore(release): v0.16.6 — language axis (1)–(3) on dev — 언어 축 (1)~(3)을 dev에`

- [ ] **Step 7: `dev`에 한 번 합쳐 GitHub에 올린다** — 원본 체크아웃(`/Users/hyeonjin/Documents/sop-archivist`, 브랜치 `dev`)은 `origin/dev`보다 뒤에 있고 추적하지 않는 파일(`.agents/`, `skills-lock.json`)이 있다. 그 체크아웃에서 `git pull --ff-only origin dev`로 맞춘 뒤 `git merge --no-ff feat/lang-axis -m "Merge branch 'feat/lang-axis' into dev — v0.16.6 언어 축 (1)~(3)"`, `git push origin dev`. 같은 폴더에서 다른 세션이 작업 중이면 멈추고 사용자에게 알린다(`docs/lessons/git-operations.md`). 사내 GitLab push와 배포는 사용자가 한다.

- [ ] **Step 8: 정리** — 머지가 올라간 것을 `git log origin/dev -1`로 확인한 뒤 워크트리와 브랜치를 지운다(`git worktree remove .claude/worktrees/lang-axis`, `git branch -d feat/lang-axis`). 시안·감사에 쓴 임시 서버를 내린다.
