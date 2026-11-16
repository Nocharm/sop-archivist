# AI 미리 돌리기와 대기 줄 순서 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파일 읽기가 끝나면 옛↔새 문장 묶기 제안이 LLM 없이 와 있고, 남은 줄의 분류는 배정 화면 첫 진입 때 저절로 돌며, 사람이 누른 요청은 늘 그보다 먼저 처리된다.

**Architecture:** `ai_jobs`에 순위(`priority`)와 바뀌지 않는 표시(`background`)를 더해 실행기가 `(priority, id)` 순으로 꺼낸다. 짝 맞추기 계획(`match_plan`)이 문장 묶음 제안을 잠정 변경 종류로 바로 쓰고, LLM 작업(`match`)은 그것을 다듬기만 한다. 저절로 쌓는 자리는 둘(업로드 라우터, 새 `POST …/ai/prepare`)이고 설정 `AI_AUTO_PREPARE` 하나로 끈다.

**Tech Stack:** Python 3.11 · FastAPI · SQLAlchemy(async) · Alembic · pytest / Next.js 16 · React 19 · TypeScript · vitest.

**Spec:** [`docs/superpowers/specs/2026-11-15-ai-prepare-queue-design.md`](../specs/2026-11-15-ai-prepare-queue-design.md) — 실행하는 사람은 이 계획과 함께 읽는다. 아래 "§N"은 그 문서의 절이다.

## Global Constraints

- **AI는 제안만 한다**: `confirmed_text`를 쓰지 않고, 확정·보류 행을 덮지 않고, 같은 종류의 이전 제안 위에만 쓴다. 분류 제안을 짝 맞추기가 덮지 않고 그 반대도 없다.
- **`load / compute / apply` 계약**: `compute`는 세션을 받지 않는다. AI·임베딩 호출 동안 열린 DB 세션이 없어야 한다. 쓰기는 묶음을 잠근 `apply`와, 묶음을 잠근 요청 핸들러에서만.
- 로그에는 ID·건수·상태 코드·예외 클래스 이름만(`logger.exception` 금지). 업무 규칙 거절은 `errors.raise_rule`만 쓴다.
- 모델 변경은 Alembic 리비전 필수 — 이 계획은 `0018` 하나(`--rev-id 0018`). 병렬 세션도 `0018`을 쓸 수 있다: dev에 늦게 들어가는 쪽이 번호와 `down_revision`을 다시 매긴다.
- 새 env는 세 곳을 한 커밋에서: `backend/app/settings.py` · `.env.example` · `docker-compose.yml` backend `environment:`(bool은 Settings 기본값과 같은 폴백).
- 배포 런타임은 Python 3.11(`ruff` `target-version = "py311"`). 모든 함수에 타입 힌트, 함수 이름은 동사로 시작.
- 화면·동작·라벨을 바꾸는 커밋은 `frontend/public/manual/user-manual.md`의 글도 같은 커밋에서 고친다(그림은 뽑지 않는다). 문구는 `en` · `ko` 함께.
- 프런트를 고치기 전에 `frontend/CLAUDE.md`, `docs/lessons/react-ts-patterns.md`, `docs/lessons/browser-verification.md`를 읽는다.
- `frontend/src/app/bundles/[id]/assign/page.tsx`는 병렬 세션이 고치는 파일이다. 이 계획이 거기에 넣는 것은 Task 8의 훅 호출 한 줄뿐이다.
- 시험은 AAA, 내부 로직은 mock하지 않는다(AI 전송만 가짜 — `tests/fake_ai.py`). 합성 자료·가짜 AI의 배선 검증이지 실제 모델의 속도·정확도 근거가 아니다.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. 커밋마다 `PROGRESS.md`를 같은 커밋에서 갱신한다. 푸시는 사용자가 말할 때 GitHub `origin`에만.
- 서비스 버전(PATCH)과 `CHANGELOG.md`는 dev에 올릴 때 그때의 다음 번호로 올린다(병렬 세션이 번호를 쓰고 있다). 이 계획의 커밋에서는 건드리지 않는다.
- 커밋에는 그 Task의 Files와 그 Task가 고친 문서만 `git add <파일>`로 골라 담는다(`git add .` 금지). Task 1에만 전체 명령을 적었고 나머지는 메시지만 적었다.
- 시험 틀의 `claim()` · `finish()` · `post_prepare()` 같은 짧은 이름은 그 시험 파일 안에 만드는 작은 도우미다. 있는 도우미(`tests/ai_fixtures.py` · `tests/sop_helpers.py`)가 같은 일을 하면 그것을 쓴다. 틀에 몸이 `...`뿐인 시험은 이름과 옆 주석이 단언이다.

**시작 전에(워크트리에 한 번)** — 이 워크트리에는 가상 환경과 `node_modules`가 없다:

```bash
cd backend && python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cd ../frontend && npm install
cd ../backend && .venv/bin/python -m pytest tests/test_sop_ai_jobs.py tests/test_sop_ai_match_plan.py -q   # 손대기 전 초록 확인
```

## Review Focus

명세가 뜻하지만 조각 시험만으로는 빠지기 쉬운 것들. 줄마다 시험을 맡은 Task를 적었다.

1. **새 문서 목록을 채우기 전에 파일부터 올린 묶음** — 짝 없는 줄이 삭제 후보로 깔리지 않고 미배정으로 남으며, 배정 화면 진입 뒤 분류가 그 줄을 받는다. → Task 7 `test_uploaded_before_the_new_list_then_prepare_classifies_lone_units`
2. **파일 여러 개를 연달아 올림** — 계획이 겹쳐 돌지 않고, 마지막 파일의 짝까지 제안되며, 먼저 다듬어진 묶음의 제안 id가 바뀌지 않는다. → Task 5 `test_uploading_files_in_a_row_ends_with_every_pair_suggested`
3. **미리 돌리기가 도는 사이 사람이 그 줄을 먼저 확정하거나 지움** — AI 결과가 사람 것을 덮지 않고, 지운 묶음을 다듬기가 되살리지 않는다. → Task 4 `test_refine_is_stale_when_the_group_was_cleared`
4. **사람이 취소한 미리 돌리기** — 다음 업로드, 다음 진입에 되살아나지 않는다. → Task 4 `test_auto_plan_does_not_requeue_cancelled_refine`, Task 7 `test_prepare_skips_documents_whose_background_jobs_were_cancelled`
5. **AI가 꺼진 서버, 설정을 끈 서버, 검토자, 검토 대기 묶음에서 배정 화면을 연다** — 오류 알림 없이 사람 경로가 그대로다. → Task 8 `use-ai-prepare.test.ts`의 403·409·503 시험

---

### Task 1: 순위 열과 꺼내는 순서

**Files:**
- Modify: `backend/app/sop/constants.py` (AI 작업 상수 옆), `backend/app/sop/models.py` (`AiJob`), `backend/app/sop/ai/jobs.py` (`enqueue_jobs`), `backend/app/sop/ai/runner.py` (`claim_next_job`), `backend/app/routers/sop_ai.py` (`_queue_request`, `request_match`)
- Create: `backend/alembic/versions/0018_ai_job_priority.py`
- Test: `backend/tests/test_sop_ai_jobs.py`, `backend/tests/test_migrations.py`

**Interfaces:**
- Produces: `app.sop.constants` — `AI_PRIORITY_PLAN = 0`, `AI_PRIORITY_USER = 1`, `AI_PRIORITY_PRE_CLASSIFY = 2`, `AI_PRIORITY_PRE_REFINE = 3`.
- Produces: `AiJob.priority: Mapped[int]`(SmallInteger, NOT NULL, 기본 `AI_PRIORITY_USER`), `AiJob.background: Mapped[bool]`(NOT NULL, 기본 `False`). 인덱스 `ix_ai_jobs_status_id` → `ix_ai_jobs_status_priority_id`(`status, priority, id`).
- Produces: `enqueue_jobs(session, *, bundle_id, kind, requested_by, items, request_id=None, priority: int = AI_PRIORITY_USER, background: bool = False) -> list[AiJob]`.
- Produces: `_queue_request(session, ctx, kind, items, skipped, *, priority: int = AI_PRIORITY_USER, promoted: int = 0) -> AiRequestOut` — `promoted`는 Task 2가 쓴다(응답 `queued` = 새로 쌓은 수 + `promoted`).

- [ ] **Step 1: 실패하는 시험 쓰기** — `test_sop_ai_jobs.py`에 넷. 작업은 `enqueue_jobs`와 `run_in_session`으로 직접 쌓는다(이 파일의 기존 시험과 같은 방식).

```python
def test_claim_takes_the_lower_priority_number_first(client):   # 사람(1) 먼저 쌓고 계획(0) 나중에 쌓는다
    assert [claim(), claim()] == [plan_job_id, user_job_id]

def test_claim_keeps_id_order_within_a_priority(client):
    assert [claim(), claim()] == [first_id, second_id]            # 둘 다 AI_PRIORITY_PRE_CLASSIFY

def test_classify_waits_for_an_active_plan_in_the_same_bundle(client):
    # 묶음 A: match_plan(줄 섬) + classify, 묶음 B: classify
    assert claim() == plan_a                                       # 계획이 맨 앞
    assert claim() == classify_b                                   # A의 분류는 건너뛴다
    assert claim() is None                                         # A의 계획이 도는 동안
    finish(plan_a, "done"); assert claim() == classify_a

def test_second_plan_waits_while_one_runs_in_the_bundle(client):
    assert claim() == plan_1; assert claim() is None
    finish(plan_1, "done"); assert claim() == plan_2
```

`test_migrations.py`: `test_0018_gives_existing_jobs_user_priority` — `0017`까지 올린 DB에 `ai_jobs` 행을 SQL로 넣고 `0018`로 올리면 그 행이 `priority == 1`, `background == False`(이 파일에 있는 `0012` `request_id` 시험의 틀을 따른다).

- [ ] **Step 2: 실패 확인** — `cd backend && .venv/bin/python -m pytest tests/test_sop_ai_jobs.py -q -k "claim or waits"`와 `.venv/bin/python -m pytest tests/test_migrations.py -q -k 0018` → 열이 없어 FAIL.
- [ ] **Step 3: 상수 · 모델 · 리비전** — `alembic revision --autogenerate --rev-id 0018 -m "ai job priority"`로 만든 뒤 손으로 고친다: 있는 행 때문에 `0012`가 `request_id`를 더한 방식(nullable로 더하고 → 채우고 → NOT NULL)을 따르고, 인덱스를 바꾼다. 모델에는 `server_default`를 남기지 않는다(`test_models_match_migrations`가 초록이어야 한다).
- [ ] **Step 4: `enqueue_jobs`에 두 인자, `claim_next_job` 고치기** — `queued` 가운데 `(priority, id)` 첫 행. 건너뛰는 조건 둘을 `NOT EXISTS`로: ① `kind == "classify"`인데 같은 묶음에 `match_plan`이 `queued`·`running`, ② `kind == "match_plan"`인데 같은 묶음에 `match_plan`이 `running`. 단일 워커 전제는 그대로다(꺼낸 뒤 `UPDATE … WHERE status = 'queued'`).
- [ ] **Step 5: `request_match`가 계획을 `AI_PRIORITY_PLAN`으로 쌓게** — `_queue_request(…, priority=AI_PRIORITY_PLAN)`. 계획이 쌓는 `match` 작업은 아직 기본값(사람)이다.
- [ ] **Step 6: 통과 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_jobs.py tests/test_migrations.py tests/test_sop_ai_match_plan.py -q` → PASS. `.venv/bin/ruff check app/ tests/` → 통과.
- [ ] **Step 7: 문서와 커밋** — 제품 명세 §6.11(작업에 순위·미리 돌리기 표시) · §8.2(꺼내는 순서), `backend/CLAUDE.md` AI 불변식에 "순위와 `background`, 묶기 먼저, 계획은 묶음마다 하나". `PROGRESS.md`.

```bash
git add backend/app/sop/constants.py backend/app/sop/models.py backend/app/sop/ai/jobs.py backend/app/sop/ai/runner.py backend/app/routers/sop_ai.py backend/alembic/versions/0018_ai_job_priority.py backend/tests/test_sop_ai_jobs.py backend/tests/test_migrations.py backend/CLAUDE.md docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md PROGRESS.md
git commit -m "feat(ai): claim jobs by priority and run the match plan first — AI 작업을 순위 순으로 꺼내고 계획을 맨 앞에"
```

---

### Task 2: 순위 올리기

**Files:**
- Modify: `backend/app/sop/ai/jobs.py`, `backend/app/sop/ai/match_jobs.py`, `backend/app/routers/sop_ai.py` (`request_classify`, `request_match`)
- Test: `backend/tests/test_sop_ai_classify.py`, `backend/tests/test_sop_ai_match_plan.py`

**Interfaces:**
- Consumes: Task 1의 상수 · `_queue_request(…, promoted=)`.
- Produces: `jobs.promote_queued_jobs(session, bundle_id: int, kind: str, *, unit_ids: Collection[int] | None = None, document_id: int | None = None) -> tuple[int, set[int]]` — `queued`이고 `priority > AI_PRIORITY_USER`인 그 종류 작업의 순위를 `AI_PRIORITY_USER`로 올리고 **(올린 작업 수, 그 작업들이 잡고 있던 단위 id)**를 돌려준다. `unit_ids`는 작업의 단위와 하나라도 겹치는 것, `document_id`는 그 문서의 것, 둘 다 `None`이면 그 종류 전부. `background`와 `request_id`는 건드리지 않는다. 겹침은 JSON 열이라 SQL이 아니라 읽은 뒤 파이썬에서 가린다.
- Produces: `match_jobs.promote_match_jobs(session, bundle_id: int) -> int` — 계획이 줄 서 있거나 돌고 있으면 0, 아니면 줄 선 `match` 작업을 올린 수.

- [ ] **Step 1: 실패하는 시험** — 미리 돌리기 작업은 `enqueue_jobs(…, priority=AI_PRIORITY_PRE_CLASSIFY, background=True)`로 직접 쌓는다.

```python
def test_document_request_promotes_queued_background_jobs(client, fake_ai):
    out = request_classify(client, bundle.id, document_id=doc_id).json()
    assert out["queued"] == promoted_jobs + newly_queued
    assert "already_queued" not in out["skipped_by_reason"]
    assert {job.priority for job in jobs} == {AI_PRIORITY_USER} and all(job.background for job in promoted)

def test_unit_request_promotes_only_the_jobs_holding_those_units(client, fake_ai): ...
def test_running_background_job_is_still_skipped_as_already_queued(client, fake_ai): ...
def test_match_request_promotes_queued_refine_jobs(client, fake_ai):      # 응답 queued == 올린 수, 새 계획은 안 쌓인다
def test_match_request_is_skipped_while_a_plan_is_active(client, fake_ai): # 지금 동작 그대로(already_queued)
```

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_classify.py tests/test_sop_ai_match_plan.py -q -k "promote or skipped_while"` → FAIL.
- [ ] **Step 3: 구현** — `request_classify`: 범위 고르기 **앞에** `promote_queued_jobs`를 부르고(고른 줄이면 `unit_ids`, 문서 전체면 `document_id`), 돌려받은 단위는 `skipped`의 `already_queued`에서 뺀 뒤 `_queue_request(…, promoted=돌려받은 작업 수)`. `request_match`: `promote_match_jobs`가 0보다 크면 새 계획 없이 그 수로 답하고, 0이면 지금 길. `ai.request` 작업 기록은 새로 쌓은 작업이 있을 때만(지금 그대로).
- [ ] **Step 4: 통과 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_classify.py tests/test_sop_ai_match_plan.py tests/test_sop_ai_jobs.py -q` → PASS, `ruff` 통과.
- [ ] **Step 5: 문서와 커밋** — 계획 2 문서 "API 계약" 블록(`AiRequestOut.queued`의 뜻), 사용 설명서 AI 조각("문서 전체 분류를 누르면 그 문서가 앞으로 온다"), `PROGRESS.md`.

```bash
git commit -m "feat(ai): promote queued background jobs when a person asks for them — 사람이 누르면 줄 선 미리 돌리기 작업의 순위를 올린다"
```

---

### Task 3: 계획이 문장 묶음 제안을 바로 쓴다

**Files:**
- Modify: `backend/app/sop/ai/matching.py` (`is_spacing_change`), `backend/app/sop/ai/match_jobs.py` (`select_match_items`, `_build_content`, `MatchPlanHandler.apply`)
- Test: `backend/tests/test_sop_ai_matching.py`, `backend/tests/test_sop_ai_match_plan.py`, `backend/tests/test_sop_ai_match_pair.py`(계약 시험 갱신)

**Interfaces:**
- Produces: 계획 작업 `payload["origin"]` — `"user"` | `"prepare"` | `"upload"`. 키가 없는 옛 행은 `"user"`로 읽는다. `select_match_items`는 `JobItem(payload={"origin": "user"})`를 낸다.
- Produces: `matching.is_spacing_change(old_text: str, new_text: str) -> bool` — 두 글이 다르고, 빈 글자(`segment.is_blank_char`)를 모두 걷으면 같고, `check_sentence([old_text], new_text)`가 빈 목록일 때 참. 유사도 기준값은 두지 않는다(§4 — "한두 글자·어미"까지 넓힌 규칙은 기각했다).
- Produces: 짝 맞추기 제안 내용에 `provisional: bool`(늘 있는 칸). 계획이 쓴 문장 묶음 가운데 다듬기를 기다리는 것만 참.
- Produces: 계획이 쌓는 `match` 작업의 순위·표시 — `origin == "user"`면 `(AI_PRIORITY_USER, False)`, 아니면 `(AI_PRIORITY_PRE_REFINE, True)`.

§4의 표가 정답이다. 이 Task는 그 가운데 "바로 쓰기 · 잠정 · 띄어쓰기만 다른 짝 · 삭제 후보 · 다듬기 작업의 순위"를 한다. "그대로인 묶음 두기 · 옛 작업 취소 · 다시 쌓기"는 Task 4다.

- [ ] **Step 1: 실패하는 시험** — 임베딩은 `use_vectors`로 같은 축에 놓아 묶이게 한다.

```python
# test_sop_ai_matching.py
@pytest.mark.parametrize(("old", "new", "expected"), [
    ("사용 전에 밸브상태를 확인한다.", "사용 전에 밸브 상태를 확인한다.", True),       # 띄어쓰기만
    ("사용 전에 밸브 상태를 확인한다.", "사용 전에 밸브 상태를 확인한다.", False),      # 같은 글은 여기서 다루지 않는다
    ("사용 전에 밸브 상태를 확인한다.", "사용 후에 밸브 상태를 확인한다.", False),      # 한 글자가 뜻을 뒤집는다
    ("온도는 30℃ 이상으로 둔다.", "온도는 30℃ 이하로 둔다.", False),
    ("사용 전에 밸브 상태를 확인한다.", "사용 전에 밸브 상태를 확인하여야 한다.", False),  # 어미 — LLM에 묻는다
    ("시료 1 0개를 꺼낸다.", "시료 10개를 꺼낸다.", False),                           # 빈 글자를 걷으면 같지만 숫자 검사가 다르다
])
def test_is_spacing_change(old, new, expected): assert is_spacing_change(old, new) is expected

# test_sop_ai_match_plan.py — run_plan()은 계획 작업만 돌린다
def test_plan_writes_sentence_groups_before_any_llm_call(client, fake_ai):
    assert (decision.status, decision.disposition) == ("ai_suggested", "assigned")
    assert (target.status, target.change_type) == ("ai_suggested", "rewritten")
    assert read_links() == {(target.id, unit_id)}
    assert suggestion.content["provisional"] is True and suggestion.content["shape"] == "one_to_one"
    assert fake_ai.requests == [] and len(read_jobs("match")) == 1      # 채팅 호출 없이 쓰였다

def test_spacing_only_pair_is_tone_without_a_refine_job(client, fake_ai):
    assert target.change_type == "tone" and suggestion.content["provisional"] is False
    assert read_jobs("match") == []

def test_refine_jobs_follow_the_plan_origin(client, fake_ai):       # user → (1, False), upload → (3, True)
def test_upload_origin_plan_writes_no_delete_candidates(client, fake_ai):   # 배정 New 문서 없는 묶음: 짝 없는 옛 단위가 미배정
def test_prepare_origin_plan_writes_delete_candidates(client, fake_ai):      # 같은 묶음: 지금 규칙대로 삭제 후보
```

마지막 줄("시료 1 0개")이 `check_sentence`에서 걸리지 않으면 규칙을 넓히지 말고 그 사실을 보고한다 — 숫자 사이 빈 글자를 따로 막아야 한다는 뜻이다.

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_matching.py tests/test_sop_ai_match_plan.py -q -k "spacing or before_any_llm or origin"` → FAIL.
- [ ] **Step 3: 구현** — `MatchPlanHandler.apply`가 문장 묶음도 `_Write`로 만든다. 변경 종류는 새 문장마다 `decide_ai_change_type(sources, text, requested, sentence_count=같은 새 문서 안의 새 문장 수)`이고, `requested`는 1:1이고 `is_spacing_change`이면 `"tone"`, 아니면 `"rewritten"`이다(`sources`는 `.text`만 읽히니 계획이 가진 `MatchItem`을 넘긴다). 다듬기 작업은 "1:1이고 띄어쓰기만 다른" 묶음을 뺀 문장 묶음마다 하나. 삭제 후보는 `origin != "upload"`일 때만 지금 규칙으로. `compute`의 `ensure_llm_enabled()`는 그대로 둔다.
- [ ] **Step 4: 기존 시험 옮기기** — 계획 뒤 문장 묶음이 미배정이라고 단언하던 시험, 내용 모양을 견주는 `test_suggestion_follows_the_api_contract`를 새 동작에 맞춘다. 지우지 않고 단언을 옮긴다.
- [ ] **Step 5: 통과 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_matching.py tests/test_sop_ai_match_plan.py tests/test_sop_ai_match_pair.py tests/test_sop_ai_adoption.py -q` → PASS, `ruff` 통과. (`test_sop_e2e.py`는 Task 4 끝에서 맞춘다.)
- [ ] **Step 6: 커밋** — Task 4와 한 조각이라 문서는 Task 4에서 고친다.

```bash
git commit -m "feat(ai): let the match plan write sentence-group suggestions at once — 계획이 문장 묶음 제안을 잠정 변경 종류로 바로 쓴다"
```

---

### Task 4: 다듬기와 다시 세운 계획

**Files:**
- Modify: `backend/app/sop/ai/match_jobs.py` (`MatchHandler.load` · `apply`, `MatchPlanHandler.apply`), `backend/scripts/sop_demo_driver.py`, 필요하면 `backend/tests/fake_ai.py`의 `SyntheticAnswers`
- Test: `backend/tests/test_sop_ai_match_pair.py`, `backend/tests/test_sop_ai_match_plan.py`, `backend/tests/test_sop_e2e.py`

**Interfaces:**
- Consumes: Task 3의 `origin` · `provisional`.
- Produces(동작): 다듬기는 자기 단위·새 문장이 모두 **한 개의 살아 있는**(`result == "applied"`, 판단·새 문장이 `ai_suggested`로 가리키는) 짝 맞추기 제안에 묶여 있고 그 제안의 `unit_ids` · `target_ids`가 작업의 것과 같을 때만 쓴다. 아니면 `load`가 `None`(LLM을 부르지 않는다), `apply`가 `"stale"`.
- Produces(동작): 계획이 쓰려는 것의 `(shape, unit_ids, target_ids)`가 살아 있는 짝 맞추기 제안과 같으면 걷지도 쓰지도 쌓지도 않는다. 달라진 것만 걷고 쓰며, 그것에 닿는 줄 선·도는 `match` 작업을 `cancelled`로 끝낸다.

- [ ] **Step 1: 실패하는 시험**

```python
# test_sop_ai_match_pair.py
def test_refine_replaces_the_provisional_suggestion(client, fake_ai):       # LLM: tone
    assert target.change_type == "tone" and new.content["provisional"] is False and new.content["reason"]
    assert old_suggestion.result == "stale"
def test_invalid_reply_keeps_the_plan_suggestion(client, fake_ai):          # test_invalid_reply_holds_the_old_units_only를 대신한다
    assert decision.status == "ai_suggested" and target.change_type == "rewritten"
    assert [s.result for s in read_suggestions()] == ["applied", "invalid"] and read_jobs()[0].status == "done"
def test_failed_refine_keeps_the_plan_suggestion(client, fake_ai): ...
def test_refine_is_stale_when_the_group_was_cleared(client, fake_ai):       # 사람이 Clear → 작업 stale, chat 호출 0, 줄은 미배정 그대로
def test_refine_is_stale_when_a_person_confirmed_first(client, fake_ai): ...

# test_sop_ai_match_plan.py
def test_replan_keeps_unchanged_groups(client, fake_ai):
    # 계획 → 다듬기(tone) → New 문서 하나 더 → 계획
    assert read_decision(unit_id).suggestion_id == refined_id and read_target(NEW).change_type == "tone"
    assert len(read_jobs("match")) == jobs_before + 1                        # 새 묶음 것만 늘었다
def test_replan_cancels_refine_jobs_of_changed_groups(client, fake_ai): ...
def test_refine_is_stale_when_a_newer_plan_regrouped_it(client, fake_ai): ...
def test_user_plan_requeues_refine_for_provisional_groups_without_a_job(client, fake_ai): ...
def test_auto_plan_does_not_requeue_cancelled_refine(client, fake_ai):      # origin upload·prepare 둘 다
```

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_match_pair.py tests/test_sop_ai_match_plan.py -q -k "refine or replan or requeue or invalid_reply"` → FAIL.
- [ ] **Step 3: `MatchHandler` 고치기** — `load`·`apply`에 위 "자기 묶음이 그대로" 검사. 무효 답은 `hold_invalid`를 부르지 않고 `invalid` 제안 행만 남긴 뒤 `"done"`. 답이 오면 지금 길(이전 제안 걷기 → 새 제안 → `_apply_write` → `_insert_links`)이다.
- [ ] **Step 4: `MatchPlanHandler.apply` 고치기** — 쓰기 전에 "그대로"를 가린다. `clear_previous_suggestion`은 달라진 것에만 부른다. 다시 쌓기: `origin == "user"`이고, 그대로 둔 문장 묶음의 살아 있는 제안이 `provisional`이고, 그 묶음을 잡은 `match` 작업이 줄에도 없고 돌지도 않을 때만.
- [ ] **Step 5: 통과 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_match_pair.py tests/test_sop_ai_match_plan.py tests/test_sop_ai_adoption.py tests/test_sop_match.py -q` → PASS.
- [ ] **Step 6: 합성 E2E 맞추기** — `.venv/bin/python -m pytest tests/test_sop_e2e.py -q`. 깨지면 까닭은 둘이다: 계획이 분류보다 먼저 돈다(Task 1), 무효 답이 보류로 돌리지 않는다(이 Task). 고치는 순서: ① 몰이 `request_classification`의 설명과 순서를 새 규칙으로, ② `confirm_suggestions`가 "그대로 받는" 제안을 LLM이 다듬은 것(`provisional`이 거짓이고 `reason`이 빈 글이 아님)으로 좁히고 나머지는 지금의 사람 저장 길로 보낸다, ③ 그래도 정답(`SYNTHETIC_expected.json`)이 달라져야 하면 생성기 `scripts/synthetic_sop.py`에서 고친다. 통과 기준: `test_sop_e2e.py` 전체 PASS.
- [ ] **Step 7: 문서와 커밋** — 제품 명세 §7.10(계획이 문장 묶음을 바로 쓴다 · 띄어쓰기만 다른 짝 · 무효 답 · 그대로인 묶음), 계획 2 "API 계약"(`provisional`), `backend/CLAUDE.md`("계획이 쓰고 `match`가 다듬는다", `origin` 표), 사용 설명서 AI 조각(묶기 제안이 먼저 오고 변경 종류는 처음에 잠정), `PROGRESS.md`. 전체 backend: `.venv/bin/python -m pytest tests/ -q -n auto` → PASS, `ruff` 통과.

```bash
git commit -m "feat(ai): refine plan suggestions instead of creating them, and keep unchanged groups on re-plan — match 작업은 계획의 제안을 다듬고, 다시 세운 계획은 그대로인 묶음을 두다"
```

---

### Task 5: 설정과 업로드 자리

**Files:**
- Modify: `backend/app/settings.py`, `.env.example`, `docker-compose.yml`, `backend/app/sop/ai/match_jobs.py`, `backend/app/routers/sop_documents.py`(업로드 핸들러, `enqueue_doc_meta` 다음 줄), `backend/tests/fake_ai.py`, `docs/qa/verification-commands.md`
- Test: `backend/tests/test_sop_ai_match_plan.py`

**Interfaces:**
- Produces: `settings.ai_auto_prepare: bool = True` / `AI_AUTO_PREPARE`(compose: `${AI_AUTO_PREPARE:-true}`).
- Produces: `match_jobs.enqueue_auto_plan(session: AsyncSession, bundle_id: int, actor: str, *, origin: str) -> AiJob | None` — 조건(설정 켬 · AI 켬 · `ready`인 Old 문서와 이미 쓴 New 문서(`entrance == "match"`)가 각각 하나 이상 · 그 묶음에 `queued`인 `match_plan` 없음)이 맞으면 `match_plan` 하나(`AI_PRIORITY_PLAN`, `background=False`, `payload={"origin": origin}`)를 쌓아 돌려준다. `running`인 계획이나 `match` 작업은 막지 않는다. 작업 기록은 남기지 않는다.
- Produces: `install_fake_ai(monkeypatch, *, chat, embed=None, doc_meta=False, auto_prepare=False)` — `settings.ai_auto_prepare`를 그 값으로 둔다. 기본이 끔이라 기존 시험의 작업·제안 수가 그대로다.
- Produces: `tests/conftest.py` 픽스처 `auto_prepare(fake_ai: FakeAi, monkeypatch) -> FakeAi` — `fake_ai` 뒤에 `settings.ai_auto_prepare`를 참으로 돌려놓고 같은 `FakeAi`를 돌려준다. Task 7의 시험도 이것을 쓴다.

- [ ] **Step 1: 실패하는 시험** — `auto_prepare` 픽스처를 쓰는 시험들(아래 틀의 `fake_ai` 자리에 `auto_prepare`).

```python
def test_upload_queues_a_plan_when_old_and_written_new_are_ready(client, fake_ai):
    # Old만 올렸을 때 0건 → 이미 쓴 New를 올리면 1건
    assert (job.kind, job.priority, job.background, job.payload) == ("match_plan", AI_PRIORITY_PLAN, False, {"origin": "upload"})
    assert job.requested_by == "qa.member" and "ai.request" not in event_actions(bundle.id)
def test_upload_does_not_stack_plans_while_one_is_queued(client, fake_ai): ...
def test_upload_queues_one_more_while_a_plan_runs(client, fake_ai): ...
def test_upload_queues_nothing_when_the_setting_or_ai_is_off(client, fake_ai): ...
def test_uploading_files_in_a_row_ends_with_every_pair_suggested(client, fake_ai):     # Review Focus 2
    # Old 1 + New 2를 차례로 올리며 사이사이 run_jobs() — 끝에 모든 짝이 ai_suggested, 첫 묶음의 제안 id는 처음 그대로
```

- [ ] **Step 2: 실패 확인** → FAIL(`enqueue_auto_plan` 없음).
- [ ] **Step 3: 구현** — 세 곳 env, `enqueue_auto_plan`, 업로드 핸들러에서 `document.status == "ready"`일 때 부르고 쌓였으면 커밋. `.env.example` 주석: "저절로 도는 AI(읽기 뒤 묶기 계획, 배정 화면 첫 진입 분류)를 끈다 — AI 서버를 나눠 쓰는 낮 부하가 문제일 때, 그리고 스모크·데모 시드를 돌릴 때".
- [ ] **Step 4: 통과 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_match_plan.py tests/test_sop_upload.py tests/test_sop_ai_doc_meta.py -q` → PASS. `.venv/bin/python -m pytest tests/ -q -n auto` → PASS(기존 시험 수가 그대로인지 본다), `ruff` 통과.
- [ ] **Step 5: 문서와 커밋** — `docs/qa/verification-commands.md`(AI를 켠 스모크·감사·시드는 `AI_AUTO_PREPARE=false`, bash·PowerShell 둘 다), 루트 `CLAUDE.md` Commands의 dev 서버 줄은 건드리지 않는다(로컬 기본은 AI 끔), 제품 명세 §7.10(저절로 서는 계획), `backend/CLAUDE.md`(저절로 쌓는 자리), 사용 설명서, `PROGRESS.md`.

```bash
git commit -m "feat(ai): plan matches automatically once a file is read — 파일 읽기가 끝나면 묶기 계획이 저절로 선다 (AI_AUTO_PREPARE)"
```

---

### Task 6: 일괄 삭제·이동이 AI 제안 줄을 받는다

**Files:**
- Modify: `backend/app/sop/decisions.py` (`dispose_units`), `backend/scripts/sop_demo_driver.py`(`request_classification` 설명의 409 문장), `frontend/src/lib/i18n-messages.ts`(`rule.ai_suggested_units` en·ko 삭제), `frontend/public/manual/user-manual.md`(`#assign-bulk`)
- Test: `backend/tests/test_sop_ai_adoption.py`, `backend/tests/test_sop_decision_undo.py`

**Interfaces:**
- Produces(동작, §6): `dispose_units`가 `ai_suggested` 줄을 받는다. 차례는 ① 거절 검사(중복 · revision · **사람의** 새 문장이 달린 줄만 `unit_has_targets`), ② `record_unit_adoption`(제안을 아직 가리킬 때), ③ `clear_previous_suggestion`으로 그 줄들의 제안 걷기, ④ 처분 쓰기, ⑤ `settle_pairs`. 채택을 먼저 남기므로 걷힌 제안은 `applied`에 채택이 남는다.

- [ ] **Step 1: 실패하는 시험** — `test_bulk_delete_refuses_ai_suggested_units`를 아래로 바꾼다.

```python
def test_bulk_delete_takes_ai_suggested_units(client, fake_ai):                 # 분류 제안(배정)이 붙은 줄
    assert response.status_code == 200
    assert (decision.status, decision.disposition) == ("confirmed", "delete")
    assert (suggestion.adoption, suggestion.result) == ("rejected", "applied") and ai_targets_of(unit_id) == []
def test_bulk_delete_on_a_delete_suggestion_is_as_is(client, fake_ai): ...      # adoption == "as_is"
def test_bulk_over_one_side_of_a_pair_releases_the_other(client, fake_ai): ...  # 고르지 않은 쪽은 미배정
def test_bulk_over_a_match_suggestion_detaches_the_written_sentence(client, fake_ai): ...  # 새 문서 문장은 남고 출처만 떨어진다
def test_bulk_still_refuses_units_with_confirmed_targets(client, fake_ai): ...  # 409 unit_has_targets
# test_sop_decision_undo.py
def test_bulk_over_ai_suggested_units_can_be_undone(client, fake_ai): ...       # 같은 파일 test_undo_brings_back_ai_suggested_and_adoption과 같은 단언(AI 제안 상태·새 문장·빈 채택이 돌아온다)
```

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_adoption.py tests/test_sop_decision_undo.py -q -k bulk` → FAIL(409).
- [ ] **Step 3: 구현** — `raise_rule(409, "ai_suggested_units", …)`를 없애고 위 차례로. 프런트는 문구 두 줄을 지우고, 문구 키를 세는 시험이 있으면 맞춘다(`npx vitest run`). 일괄 막대가 AI 제안 줄을 미리 잠그는 코드가 있으면 푼다 — 없으면 화면은 건드리지 않는다.
- [ ] **Step 4: 통과 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_adoption.py tests/test_sop_decision_undo.py tests/test_sop_decisions.py tests/test_sop_e2e.py -q` → PASS. `cd ../frontend && npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run` → 통과.
- [ ] **Step 5: 문서와 커밋** — 제품 명세 §7.7("여러 개 한 번에"의 서버 거절을 뒤집는다 — 사용자 결정 2026-11-15), 사용 설명서 `#assign-bulk`와 AI 조각의 "한 번에 확정하지 않는다" 문장(확정은 여전히 줄마다, 삭제·이동은 덮을 수 있다), `PROGRESS.md`.

```bash
git commit -m "feat(assign): let bulk delete and move override AI-suggested rows — 일괄 삭제·이동이 AI 제안 줄을 받고 채택을 남긴다"
```

---

### Task 7: `prepare` API

**Files:**
- Create: `backend/app/sop/ai/prepare.py`, `backend/tests/test_sop_ai_prepare.py`
- Modify: `backend/app/sop/ai/schemas.py` (`PrepareIn`), `backend/app/routers/sop_ai.py`

**Interfaces:**
- Consumes: `enqueue_auto_plan`(Task 5), `select_classify_items`, `match.list_identical_candidates`, `match_jobs.has_assign_documents`, `enqueue_jobs(…, priority=, background=)`.
- Produces: `PrepareIn(document_id: RequestId | None = None)`.
- Produces: `prepare.queue_prepare(session: AsyncSession, bundle_id: int, actor: str, *, document_id: int | None) -> list[AiJob]` — 쌓은 **분류** 작업만 돌려준다(계획 작업은 세지 않는다). §5.2의 1~4를 그 차례로 한다.
- Produces: `POST /api/bundles/{bundle_id}/ai/prepare` → `AiRequestOut`(`queued` = 분류 작업 수, `skipped` 빈 목록). 의존성은 다른 AI 요청과 같다: `require_ai_enabled`, `_require_author`, 핸들러 안에서 `lock_bundle` · `ensure_editable`.

판정 둘(§5.2): "미리 돌린 분류가 있던 문서" = 그 `document_id`에 `kind == "classify"` · `background` 참인 `ai_jobs` 행이 상태와 상관없이 있음. "계획이 한 번도 없었음" = 그 묶음의 `match_plan` 행 가운데 `origin`이 `prepare`나 `user`(키 없음 포함)인 것이 없음.

- [ ] **Step 1: 실패하는 시험** — Task 5의 `auto_prepare` 픽스처를 쓴다(아래 틀의 `fake_ai` 자리).

```python
def test_prepare_queues_background_classify_per_old_document(client, fake_ai):
    out = post_prepare(client, bundle.id, document_id=second_doc).json()
    assert out["queued"] == len(jobs) and out["skipped_total"] == 0
    assert {(j.priority, j.background) for j in jobs} == {(AI_PRIORITY_PRE_CLASSIFY, True)}
    assert len({j.request_id for j in jobs}) == 1
def test_prepare_puts_the_open_document_first(client, fake_ai):
    assert [j.document_id for j in sorted(jobs, key=lambda j: j.id)][0] == second_doc
def test_prepare_twice_queues_nothing_more(client, fake_ai): ...
def test_prepare_skips_documents_whose_background_jobs_were_cancelled(client, fake_ai): ...   # Review Focus 4
def test_prepare_picks_up_an_old_document_uploaded_later(client, fake_ai): ...
def test_prepare_leaves_identical_text_candidates_out(client, fake_ai): ...                  # 짝이면 줄 전체
def test_prepare_without_assign_documents_queues_no_classify(client, fake_ai): ...
def test_prepare_queues_a_plan_when_none_ran_for_the_bundle(client, fake_ai):                # origin == "prepare", upload 계획만 있었어도 쌓는다
def test_prepare_queues_no_plan_after_a_user_plan(client, fake_ai): ...
def test_prepare_returns_zero_when_the_setting_is_off(client, fake_ai): ...
def test_prepare_is_for_authors_of_an_in_progress_bundle(client, fake_ai): ...                # 검토자 403, 검토 대기 409
def test_uploaded_before_the_new_list_then_prepare_classifies_lone_units(client, fake_ai):   # Review Focus 1
    # Old·이미 쓴 New를 올린다(배정 New 문서 없음) → run_jobs → 짝 없는 줄이 미배정 → 배정 New 문서를 더한다 → prepare → run_jobs
    assert read_decision(lone_unit).status == "ai_suggested" and suggestion_kind(lone_unit) == "classify"
```

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_prepare.py -q` → FAIL(404).
- [ ] **Step 3: 구현** — `prepare.py`(모듈 docstring 한 줄), 라우터. Old 문서 순서는 문서 목록 API가 내는 순서를 따른다. 작업 기록은 남기지 않는다.
- [ ] **Step 4: 통과 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_prepare.py tests/test_sop_ai_classify.py -q` → PASS, `ruff` 통과.
- [ ] **Step 5: 문서와 커밋** — 계획 2 "API 계약"(`prepare`), 제품 명세 §7.8(저절로 시작 · 같은 글 후보 제외), `backend/CLAUDE.md`, `PROGRESS.md`.

```bash
git commit -m "feat(ai): add the prepare request that classifies leftover rows in the background — 남은 줄을 미리 분류하는 prepare 요청"
```

---

### Task 8: 배정 화면 첫 진입과 목록의 표시

**Files:**
- Modify: `backend/app/sop/ai/schemas.py` (`RecentRequestOut.background`), `backend/app/sop/ai/recent.py`, `frontend/src/lib/api-manage.ts`, `frontend/src/lib/api-sop.ts`(`RecentAiRequest.background`), `frontend/src/components/ai-jobs-popover.tsx`, `frontend/src/lib/i18n-messages.ts`, `frontend/src/app/bundles/[id]/assign/page.tsx`(한 줄), `frontend/public/manual/user-manual.md`, `frontend/scripts/pw-smoke-sop.mjs`
- Create: `frontend/src/lib/use-ai-prepare.ts`, `frontend/src/lib/use-ai-prepare.test.ts`
- Test: `backend/tests/test_sop_ai_recent.py`, `frontend/src/lib/use-ai-prepare.test.ts`

**Interfaces:**
- Produces: `RecentRequestOut.background: bool` — 그 요청에 `background` 작업이 하나라도 있으면 참.
- Produces: `prepareAi(bundleId: number, documentId?: number): Promise<AiRequestOut>` (`api-manage.ts`).
- Produces: `useAiPrepare(bundleId: number, options: { enabled: boolean; documentId: number | null; onQueued: (queued: number) => void }): void` — `enabled`이고 `documentId`가 정해졌을 때 묶음마다 한 번 부른다(화면이 살아 있는 동안). `queued > 0`일 때만 `onQueued`. 모든 실패는 말없이 넘긴다.
- 문구: `ai.prepareQueued` = "AI is suggesting the remaining {n} rows in the background." / "AI가 남은 {n}줄을 미리 분류합니다." · `aiJobs.background` = "Background" / "미리 돌리기" · `aiJobs.backgroundTip` = "Started automatically. Requests you make yourself go first." / "저절로 시작한 작업입니다. 직접 누른 요청이 먼저 처리됩니다."

- [ ] **Step 1: 실패하는 시험**

```python
# test_sop_ai_recent.py
def test_recent_marks_requests_with_background_jobs(client, fake_ai):
    assert [r["background"] for r in recent] == [True, False]        # 미리 분류 요청, 사람 요청
def test_recent_keeps_the_mark_after_promotion(client, fake_ai): ...
```

```ts
// use-ai-prepare.test.ts — use-ai-jobs.test.ts의 틀을 따른다
it("calls prepare once per bundle when enabled and a document is open", …)   // 다시 그려도 1번, documentId가 바뀌어도 1번
it("does not call while disabled or before a document is known", …)
it("reports only when something was queued", …)                              // queued 0 → onQueued 안 부름
it.each([403, 409, 503])("stays silent on %i", …)                            // Review Focus 5: 던지지 않고 onQueued도 없다
```

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_ai_recent.py -q -k background` / `npx vitest run src/lib/use-ai-prepare.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 서버 칸, `prepareAi`, 훅. 배정 화면에는 한 줄(`canEdit` · `aiOn` · `oldDocId` · `aiJobs`가 모두 선언된 뒤에 둔다): `useAiPrepare(bundleId, { enabled: canEdit && aiOn, documentId: oldDocId, onQueued: (n) => { showToast(t("ai.prepareQueued", { n })); aiJobs.watch(); } });`. 목록의 요청 줄에 종류 이름 옆 작은 표시(`aiJobs.background`, 툴팁 `aiJobs.backgroundTip`).
- [ ] **Step 4: 스모크 시나리오** — `pw-smoke-sop.mjs`에 `PREPARE=1`일 때만 도는 시나리오 하나: 배정 화면에 들어가면 알림이 뜨고, 상단 바 목록에 "Background" 줄이 생기고, 작업이 끝나면 **AI suggested** 탭 수가 0보다 크다. 전제(가짜 AI + `AI_AUTO_PREPARE=true` backend, 끝에 DB가 바뀐다)를 스크립트 머리말과 `docs/qa/verification-commands.md`에 적는다.
- [ ] **Step 5: 통과 확인** — backend `pytest tests/test_sop_ai_recent.py -q` PASS. frontend `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run` 통과. 브라우저: 가짜 AI와 `AI_AUTO_PREPARE=true`로 띄워 `PREPARE=1 BASE_URL=http://localhost:3777 node scripts/pw-smoke-sop.mjs` → ALL PASS, `LONG=1 BASE_URL=… node scripts/pw-overlap-audit.mjs` → 목록의 새 표시가 옆 글을 덮지 않는다(1280·1920, EN·KO). 덮으면 이 Task에서 배치를 고친다.
- [ ] **Step 6: 문서와 커밋** — 사용 설명서 AI 조각(배정 화면에 들어오면 남은 줄이 저절로 분류된다 · 목록의 "미리 돌리기" 표시 · 취소하면 다시 저절로 시작하지 않는다), 계획 2 "API 계약"(`RecentRequestOut.background`), `PROGRESS.md`.

```bash
git commit -m "feat(assign): classify leftover rows in the background on first entry — 배정 화면 첫 진입 때 남은 줄을 미리 분류하고 목록에 표시한다"
```

---

### Task 9: 다시 받기 줄이기

**Files:**
- Modify: `backend/app/sop/ai/jobs.py` (`JobBreakdown`, `load_job_breakdown`), `backend/app/sop/ai/schemas.py` (`AiStatusOut.user_active`), `backend/app/routers/sop_ai.py` (`get_ai_status`), `frontend/src/lib/api-sop.ts` (`AiStatus.user_active`), `frontend/src/lib/ai-jobs-model.ts`, `frontend/src/lib/use-ai-jobs.ts`
- Test: `backend/tests/test_sop_ai_jobs.py`, `frontend/src/lib/ai-jobs-model.test.ts`, `frontend/src/lib/use-ai-jobs.test.ts`

**Interfaces:**
- Produces: `AiStatusOut.user_active: int` — 그 묶음의 `queued`·`running` 작업 가운데 `priority <= AI_PRIORITY_USER`인 수.
- Produces (`ai-jobs-model.ts`):

```ts
export const AI_BACKGROUND_RELOAD_MS = 15_000;
export interface FinishSnapshot { finished: number; active: number; userActive: number | null }
/** 끝난 작업이 늘었을 때 화면이 다시 받기까지 기다릴 ms. 늘지 않았으면 null */
export function getReloadDelay(previous: FinishSnapshot | null, next: FinishSnapshot, msSinceLastReload: number): number | null;
```

규칙(§7): 앞 값이 없거나 `finished`가 늘지 않았으면 `null`. `next.active === 0`, `next.userActive === null`, 앞이나 뒤의 `userActive > 0` 가운데 하나면 `0`. 그 밖은 `Math.max(0, AI_BACKGROUND_RELOAD_MS - msSinceLastReload)`.

- [ ] **Step 1: 실패하는 시험**

```python
def test_status_counts_active_jobs_at_user_priority(client):       # 사람 2(줄 섬 1·도는 중 1) + 미리 3 + 끝난 사람 1 → 2
    assert status["user_active"] == 2
def test_promoted_jobs_count_as_user_active(client): ...
```

```ts
// ai-jobs-model.test.ts
expect(getReloadDelay(null, snap(3, 5, 0), 99_999)).toBeNull();
expect(getReloadDelay(snap(3, 5, 0), snap(3, 5, 0), 99_999)).toBeNull();          // 늘지 않았다
expect(getReloadDelay(snap(3, 5, 0), snap(4, 4, 0), 99_999)).toBe(0);             // 조용하다가 처음
expect(getReloadDelay(snap(4, 4, 0), snap(5, 3, 0), 3_000)).toBe(12_000);         // 미리 돌리기만
expect(getReloadDelay(snap(4, 4, 1), snap(5, 3, 0), 3_000)).toBe(0);              // 사람 작업이 끝났다
expect(getReloadDelay(snap(4, 1, 0), snap(5, 0, 0), 3_000)).toBe(0);              // 다 끝났다
expect(getReloadDelay(snap(4, 4, 0), snap(5, 3, null), 3_000)).toBe(0);           // 값을 못 읽었다
// use-ai-jobs.test.ts (가짜 타이머)
it("reloads once after the gap when only background jobs finish", …)   // 0초 1번 → 3·6·9초에 끝나도 15초에 1번
it("flushes a waiting reload when the bundle goes idle", …)
it("clears the waiting reload on unmount and on bundle change", …)
```

- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — 서버 칸. 훅은 `getReloadDelay`가 0이면 바로 `onFinished`, 양수면 타이머 하나(이미 기다리는 것이 있으면 다시 걸지 않는다), 뒤에 0이 오면 타이머를 없애고 바로 부른다. 이펙트 안 `setState`·타이머 규칙은 `docs/lessons/react-ts-patterns.md`를 따른다.
- [ ] **Step 4: 통과 확인** — backend `pytest tests/test_sop_ai_jobs.py -q` PASS. frontend `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run` 통과.
- [ ] **Step 5: 문서와 커밋** — 계획 2 "API 계약"(`user_active`), 사용 설명서(미리 돌리기가 도는 동안 제안은 15초 안에 화면에 나온다), `PROGRESS.md`.

```bash
git commit -m "perf(assign): reload less often while only background AI jobs finish — 미리 돌리기만 끝날 때는 화면을 15초에 한 번만 다시 받는다"
```

---

### Task 10: 마감 검증

**Files:**
- Modify: `docs/README.md`(설계 줄의 "미구현"을 구현한 버전으로), `PROGRESS.md`

- [ ] **Step 1: 명세와 대조** — 설계 §2의 목표 다섯과 "실패로 치는 것" 다섯을 줄마다 읽고, 그것을 지키는 시험 이름을 `PROGRESS.md` 항목에 적는다. 빠진 것이 있으면 그 Task로 돌아가 시험을 더한다.
- [ ] **Step 2: 전체 관문** — 모두 초록이어야 한다.

```bash
cd backend && .venv/bin/python -m pytest tests/ -q -n auto && .venv/bin/ruff check app/ tests/
cd ../frontend && npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run build   # 경고 0, next dev를 먼저 내린다
```

- [ ] **Step 3: 브라우저** — `reset_db` → `seed_sop_demo` 뒤, AI 끔으로 `pw-smoke-sop.mjs` ALL PASS. 가짜 AI(`FAKE_AI_SPLIT=1`) + `AI_AUTO_PREPARE=false`로 `pw-smoke-sop.mjs` ALL PASS(건수가 이 작업 전과 같다). 극단 자료로 `DS=worst … pw-layout-audit.mjs` ALL PASS.
- [ ] **Step 4: 남은 것 알리기** — 사용자에게: 설계 §12(회사에서 확인할 것)의 다섯 가지와, 개발 서버 `.env`에 `AI_AUTO_PREPARE`를 어떻게 둘지. dev에 올릴 때 PATCH와 `CHANGELOG.md`, 병렬 세션과의 Alembic 번호를 맞춘다.
- [ ] **Step 5: 커밋**

```bash
git add docs/README.md PROGRESS.md
git commit -m "docs: mark the AI prepare design as built — AI 미리 돌리기 설계를 구현 완료로 적다"
```
