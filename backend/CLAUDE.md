# backend/CLAUDE.md

backend(FastAPI) 세부 구조와 backend에만 걸리는 체크리스트. 루트 [`CLAUDE.md`](../CLAUDE.md)에서 그대로 옮겨 왔고 이 폴더의 파일을 읽을 때 실린다. 프로젝트 개요·명령·배포 제약·규칙(`rules/`)·양쪽에 걸친 체크리스트(권한·env·거절 코드 문구)는 루트에 있다.
경로 표기는 루트에 있을 때 그대로다 — `app/…`·`tests/…`·`alembic/…`은 `backend/` 아래, `scripts/db-backup.sh`·`docs/…`·`rules/…`는 저장소 루트.

**상세는 [`docs/architecture/backend.md`](../docs/architecture/backend.md)에 있다**(흐름·파일 목록·이력, 아래 "→ N"은 그 문서의 절 번호). 이 파일은 고치기 전에 알아야 할 자리와 금지 규칙만 싣는다. 모듈을 고치기 전에 그 절을 읽고, 모듈의 구조를 바꾸면 두 파일을 같은 커밋에서 고친다.

## 핵심 구조

- `app/main.py` lifespan: Alembic `upgrade head` → (dev만) dev 디렉터리 시드 → 끊긴 AI 작업 회수 → HR 스케줄러·AI 워커(`app/sop/ai/runner.py`, AI나 임베딩이 켜져 있을 때만). 라우터는 `app/routers/`. → 1
- `app/auth.py`: Keycloak은 `azp == KEYCLOAK_CLIENT_ID`까지 검사(빈 값이면 전부 거부). dev는 `X-Dev-User` 헤더 신뢰(서버에서 쓰면 안 됨). → 2
- **`app/access/` = 권한 판정 단일 소스.** `require_permission`·`/api/me`·관리 화면의 유효 권한 조회가 모두 `resolve.get_effective_access` 하나를 부른다 — 판정을 다른 곳에 새로 쓰지 않는다. 부여는 더하기만, 대상은 FK 없이(`subject_missing`). → 3
- `app/hr/`: 동기화 가드 3종, `source="hr"` 행만 지운다. `app/orgchart.py`: 부서 체인. → 4
- **`app/sop/` = SOP 재구성 코어**(AI 없이 사람이 끝까지 가는 결정적 경로). 라우터는 `routers/sop_*.py`. **원문 글자는 앱 로그에 남기지 않는다.** → 5
  - 흐름: 업로드 `ingest.py` → 추출(spawn 자식 `extract/worker.py`, 동시 파싱 `ingest.MAX_PARALLEL_PARSES=2`) → 쪼개기 `segment.py`·`units.py`(규칙 번호 `extractions.split_rule` — 1 문장마다 · 2 문단 안 언어마다, 편집도 그 추출의 규칙을 따른다) → 편집 `editing.py` → 배정·확정 `decisions.py`·`match.py` → 결과물(스냅숏 위 순수 함수) → 검토 `review.py`.
  - 참조 지도 `ref_map.py`(읽기 전용): 구성원 아닌 Bundle은 번호·제목·상태·후속 문서·줄 수만, Bundle 제목과 문장은 싣지 않고 그 Bundle의 확인 안 된 제안 줄은 쓰지 않는다. 응답 필드는 `MAP_KEYS`·`LINES_KEYS`·`LINE_KEYS`·`WITHHELD_KEYS`가 박아 둔 것만, 글을 싣는 질의는 `load_line_texts` 하나. → 5.4
- **`app/sop/ai/` = AI 제안 층.** 요청은 `ai_jobs` 행만 쌓고 곧바로 응답한다. 단일 실행기 `runner.py`가 `load → compute → apply`로 돌리고, 새 종류는 `JobHandler`를 `handlers.py` `HANDLERS`에 등록한다. 문서 정보 제안(`doc_meta_job.py`)도 값은 제안 행으로만 남고 사람이 눌러야 저장된다. 불변식은 아래 체크리스트. → 6
- **떼어 내기는 한 함수군** `detach.py` `detach_units`/`detach_targets` — 새 경로가 판단·출처 연결을 직접 지우지 않는다. → 7
- `app/ai_client.py`·`app/ai_usage.py`: 호출 1건당 `ai_usage_events` 한 행(원문 없음), `record_ai_usage`가 자기 짧은 세션으로 남긴다. → 8
- 시각은 전부 `DateTime(timezone=True)`와 `app.clock.now()`(KST, 맨 `datetime.now()` 등은 ruff `TID251`이 막는다). 프런트 표시는 `lib/datetime.ts`(Asia/Seoul).

## 체크리스트 — 같이 움직여야 하는 곳

- **새 `/api/admin/*` 엔드포인트:** 라우터 단 게이트가 없으니 엔드포인트마다 권한 의존성이 필수다(`test_every_admin_route_rejects_a_user_without_permissions`가 잡는다). `/api/access/*`는 라우터 단에 `permission.manage`. → 10.1
- **모델 변경 = Alembic 리비전 필수.** `--rev-id 000N`, `create_all`은 쓰지 않는다(`test_invariants.py`). → 10.2
  - `test_models_match_migrations`는 **CHECK 제약 차이를 못 잡는다** — 제약을 건드리면 마이그레이션된 DB에 부딪쳐 보는 테스트를 둔다(`test_migrations.py`).
  - `batch_job_runs`는 백업 사이드카 계약이라 컬럼을 바꾸면 `scripts/db-backup.sh`의 INSERT도 함께 바꾼다.
- **프런트가 사본을 둔 규칙(`number_lines`·`get_bullet_depths`·`plan_follow`·`plan_continue`·`build_block_places`·빈 글자 판정·상수)을 바꾸면:** → 10.3
  - `.venv/bin/python -m scripts.dump_rule_cases`로 `frontend/src/lib/rule-cases.json`을 다시 뽑고 프런트 사본이 `npx vitest run src/lib/rule-cases.test.ts`를 통과하게 고친다(안 뽑으면 `tests/test_rule_cases.py`가 실패). 새 사본을 만들면 사례도 더한다.
- **연습 자료** `frontend/src/lib/practice/practice-fixture.json`: 연습 화면(`/practice`) 가짜 서버의 처음 상태 — `scripts/dump_practice_fixture.py`가 합성 Old · New 문서를 임시 sqlite에 올려 화면이 처음 읽는 응답과 표 벗긴 모습을 쓴다. Assign이 읽는 응답 꼴이나 쪼개기 규칙을 바꾸면 `.venv/bin/python -m scripts.dump_practice_fixture`로 다시 뽑고 `npx vitest run src/lib/practice`(안 뽑으면 `tests/test_practice_fixture.py`가 실패하고, 과제 자리가 무너지면 같은 파일의 자리 검사가 알린다).
- **AI 호출:** → 10.4
  - 사내 모델로만 부른다(외부 모델 금지). 직원 실명(`name`·`korean_name`)·로그인 ID는 그 기능에 필요할 때만 싣는다(사용자 결정 2026-11-26, 전에는 실명 금지) — 사내 AI로 부여 읽기(`access/grant_ai.py`)가 관리자의 글을 그대로 보낸다.
  - 호출은 `call_ai_recorded`를 거쳐(검사: `test_invariants.py`) 사용량 행을 남기고(실패도 `ok=false`), 사용자에게 보이는 오류는 AI 주소·토큰을 뺀 문구다.
  - **AI 호출 동안 DB 연결을 잡지 않는다** — `call_ai_recorded`는 세션을 받지 않고, 요청 세션을 쓴 핸들러는 호출 직전 `await session.close()`(`ping_ai`).
- **AI 제안 층 불변식 (`app/sop/ai/`) — 새 AI 종류·쓰기 경로를 더할 때 지킨다.** → 11
  - **`load/compute/apply`**: `compute`는 세션을 받지 않는다(`test_invariants.py`). 쓰기는 묶음을 잠근 `apply`에서만, 커밋은 실행기가 상태 전이와 한 트랜잭션으로. `revision`·해시가 달라졌으면 `stale`, 묶음이 작업 중이 아니면 `cancelled`. LLM까지 가는 작업의 `compute`는 임베딩보다 먼저 `llm.ensure_llm_enabled()`(`pair` 제외). → 11.1
  - **AI는 제안 기록에만 쓴다(사용자 결정 2026-11-19):** `app/sop/ai`는 `confirmed_text`에 빈 글자 밖의 값을 쓰지 않고, `translate.py`·`pairing.py` 밖 핸들러는 `UnitDecision`·`TargetSentence`·`TargetSource`를 쓰거나 그것을 쓰는 길을 부르지 않는다(`test_invariants.py`). 분류·묶기 `apply`는 `ai_suggestions` 행만 쓴다. → 11.2
    - 채택은 사람의 저장이 `suggestion_id`를 실어 남긴다(`decisions._link_suggestion`). 받지 않고 확정한 줄의 살아 있는 제안은 그 저장이 정리한다(`adoption.judge_unused_suggestions`·`apply.close_unused_suggestions`).
    - 종류별 일괄 수락 `app/sop/accept_suggestions.py`는 사람의 저장 경로라 `ai/` 밖이다.
    - 응답은 정해진 JSON 필드로만 읽고, 모든 글자는 `replace_unstorable_chars`를 거치며, 무효 제안에는 응답 원문을 남기지 않는다.
    - 로그에는 ID·건수·상태 코드·예외 클래스 이름만(`logger.exception` 금지, 트레이스백에 값이 실린다).
  - **임계값은 합성 자료로만 잡은 값이다**(`MATCH_EMBED_THRESHOLD`·`MATCH_TEXT_THRESHOLD`·`PAIR_THRESHOLD` 등) — 실제 모델·SOP로 시험하기 전에는 정확도·채택률을 근거로 주장하지 않는다. 숫자를 바꾸면 합성 시험을 같이 옮긴다. → 11.3
  - **번역은 출처 새 문장을 따른다:** 새 문장의 글이나 자리를 바꾸는 새 경로는 `detach.sweep_translations`를 부른다. AI 번역 줄의 칸·단계·깊이는 잠겨 있고(422 `translation_locked`), 번호 표시와 칸 안 순서는 그 줄 자신의 것이다. 확정하지 않은 번역은 검토 요청을 막고 출처가 은퇴하면 어느 줄에도 없어 `open_translations.py`(묶음 목록)로만 찾는다. → 11.4
  - **`request_id`**: 사람의 요청 한 번 = `enqueue_jobs` 한 번(또는 같은 값을 넘긴 여러 번), 작업이 뒤따라 쌓는 작업은 부모의 `request_id`를 넘긴다 — 빠뜨리면 상단 바에서 한 요청이 여러 줄로 갈라진다. → 11.5
  - **순위**: 꺼내는 순서는 `priority`만 정한다(`background`는 표시뿐). `match_plan`은 묶음마다 하나, 대기·실행 중이면 `classify`는 건너뛴다. 사람 요청이 아닌 작업은 `priority`를 넘긴다. → 11.6
  - **계획이 쓴다**: `match_plan`이 LLM 없이 제안을 쓴다. 작업 종류 `match`는 CHECK에만 남고 다시 시도하지 않으며(`AI_RETIRED_JOB_KINDS`), 옛 `provisional`은 읽지 않는다. `upload` 계획은 삭제 후보를 새로 쓰지 않고, 저절로 선 계획(`upload`·`prepare`)은 사람이 버린 묶음을 쓰지도 걷지도 않는다 — **Match**(`user`)만 다시 쓴다(`origin` 표). 숨긴 동안(`constants.PLAN_DELETES`)은 어느 계획도 삭제 후보를 새로 쓰지 않고 있는 것은 그대로 둔다. → 11.7
  - **저절로 쌓기(`AI_AUTO_PREPARE`)**: 업로드 호출부가 `lock_bundle`로 잠근 채 `enqueue_auto_plan`을 부르고 커밋한다. `ai.request` 기록은 남기지 않는다. 시험의 공용 가짜 AI는 이것을 끄고(`install_fake_ai(auto_prepare=False)`) 켜는 시험만 `auto_prepare` 픽스처. → 11.8
  - **배정 화면 첫 진입(`prepare.queue_prepare`)**: 묶음 잠금 안에서 계획과 미리 분류를 쌓고, 응답 `queued`는 분류 작업만 세며 `ai.request` 기록은 남기지 않는다. 숨긴 동안(`constants.AUTO_CLASSIFY`)은 분류를 쌓지 않고 계획이 살아 있는 분류 제안을 보지 않는다(켜는 시험은 `hidden_ai_on` 픽스처). → 11.9
  - **기록**: 채택은 사람의 저장 트랜잭션 안에서 `adoption.py`가 남긴다. `bundle_events`에는 `ai.request`·`ai.cancel`·`ai.retry`만 쓴다(조회 상한 500). → 11.10
- **SOP 규칙 이중 사용 지점 — 아래는 각각 한 곳에만 쓴다.** 두 번째 구현을 만들면 커버리지·상태가 조용히 어긋난다. → 12
  - **변경 종류** `decisions._decide_change_type`·`_settle_table_types`: 사람이 고르지 않고 저장 입력도 받지 않는다(`TargetIn`에 `change_type` 없음). AI 쪽 사본 `apply.decide_ai_change_type`·`match_jobs._plan_table`·`classify._derive_change_type`을 함께 고친다. → 12.1
  - **SOP 칸 = 문서 골격 사본** `outline.py`(`DocOutline`): 코드에 고정 칸 목록은 없다. SOP `TargetDoc`을 만드는 길은 모두 `copy_standard_to_doc`을 부른다. **사본을 고치는 길은 `outline_edit.py` 하나다**(뺀 항목은 `is_removed`로 남기고, 이름·순서를 바꾸면 `_sync_slot_heading_texts`). → 12.2
  - **빈 글자 판정** `segment.py` `is_blank_char`·`has_visible_char`·`INVISIBLE_CHARS`: `isspace()`를 새로 쓰지 않는다(검사 `test_invariants.py`). 빠른 사본 `aux_compare.normalize_for_compare`, 프런트 사본 `rule-cases.json`. → 12.3
  - **관계 묶음 그래프** `groups.collect_component`: 연결 종류를 더하면 `_find_neighbors` 하나만 고친다. 칸 제목 상태는 `detach.apply_slot_heading_status` 하나로 정한다. → 12.4
  - **커버 상태** `status.get_cover_status`: SQL 사본 둘(`decisions` 단위 목록 거르기·`match`)을 함께 고친다. 줄 상태 순서 `status.pick_row_status` `ROW_STATUS_ORDER` = 프런트 `STATUS_RANK` = `snapshot.load_bundle_progress` SQL 순번 — 셋을 함께. → 12.5
  - **줄 기준 숫자** `snapshot.load_bundle_progress` ↔ `outputs.build_review_facts` ↔ 프런트 `classify-model.ts` `buildRows`: 같은 줄 규칙이라 줄의 뜻을 바꾸면 셋을 함께 고친다. 결과물도 `output_rows.build_meaning_rows`로 같은 줄. 정한 줄의 처분 순서는 `status.ROW_DISPOSITION_ORDER` = 프런트 `progress-model.ts` `DECIDED_PARTS`. 그림 줄은 진행 숫자에서만 빠진다(`figures_*`) — 검토 조건 · 결과물은 센다. 개요의 남은 손질 · AI 제안 대기는 `tidy.py`(같은 줄, 개요에만). → 12.6
  - **짝의 운명** `pair_settle.settle_pairs`: **판단이나 짝을 쓰는 새 길을 만들면 그 끝에서 `settle_pairs`를 부른다**(시스템이 떼어 내는 길은 부르지 않는다). 짝 확정은 `pairs.mark_pair_confirmed` 한 곳. → 12.7
  - **경계 확인은 없다(v1.0.18)**: `units.boundary_confirmed` 열과 `editing._step_edit`의 `BOUNDARY_OPS` 가지는 지우지 않는다 — 운영 DB의 옛 되돌리기 기록이 막힌다. → 12.8
  - **새 문서 새 문장 맞추기** `match.sync_new_doc_targets`: 단위를 바꾸는 새 경로는 새 문장을 직접 고치지 않고 이것을 부른다. 새 문장을 스냅숏으로 되쓸 길은 그 단위를 `restoring_unit_ids`로 넘긴다(안 넘기면 단위 하나에 새 문장이 둘). → 12.9
  - **편집 쓰기 길** `editing._write_change`: 새 편집 종류는 `_Change`로 이 길에 얹는다. → 12.10
  - **문단 번호** `numbering.py`: 번호는 단위 글(`text`)에서 빼지 않는다. 번호 열은 `build_number_columns` 하나가 쓰고 사람은 `number_set`만 고친다. 번호 칸은 `get_number`·`get_hidden_len`·`strip_number`만 읽는다. 타자 번호 정규식은 `segment.TYPED_NUMBER_RE` 하나. 프런트 사본 `planFollow` · `planContinue`를 함께 고친다. 벗긴 Old 표 번호 잇기는 벗기기 뒤 따로 한 칸(`continue_numbers`), 합치면 뒤 번호 당기기는 합치기와 같은 칸(Old만). → 12.11
  - **NUL·서로게이트** `schemas.NO_NUL`/`NoNulStr`: DB까지 가는 새 글자 입력 칸은 이 타입을 쓴다(`StringConstraints` 뒤에 `NO_NUL`, 선택 칸은 `Annotated[str, StringConstraints(max_length=…), NO_NUL] | None`). 판정은 `segment.has_unstorable_char` 하나. → 12.12
  - **제목 ↔ 문장** `segment.is_heading_like`: 쪼개기와 추출기 절 이름이 함께 쓴다 — 규칙을 바꾸면 두 곳이 같이 움직인다. → 12.13
  - **띠 표 → 제목 줄** `segment.is_certain_band`·`is_band_heading`: "`table_id`가 있는 `heading`" 판정은 `outputs._format_place`와 프런트 `paper-model.isBandHeading`이 함께 쓴다. → 12.14
  - **캡션 자리** `caption_slot.build_block_places`: 프런트 사본 `lib/caption-slot-model.ts`를 함께 고친다. `editing.CAPTIONABLE_KINDS` = 프런트 `getCaptionRefusal`, `decisions._find_shared_captioned` = 프런트 `isSharedCaptioned`. → 12.15
  - **대응 표** `counterparts.py`: 표는 한 표씩 또는 여럿을 골라 한 번에 벗긴다(`set_layout_tables`, 대응 표를 저절로 함께 벗기지는 않는다 — 사용자 결정 2026-11-19, 옛 `payload.counterpart_table_id`는 읽지 않는다). 영어 표의 짝 한글 표 점수 · 사람이 정한 짝(`table_counterparts`) · 행 짝과 한글 표처럼 하기 계획(저장하지 않는다)은 `table_follow.py` 하나, 적용은 편집 `follow_table` 하나 + 같은 요청의 삭제 판단(되돌리기 한 번). → 12.16
  - **원본 자리** `original_places.load_original_places`: 원본 보기용 Unit → 원본 블록 `xml_path` · 쪽(글자 없음, 블록은 한 번의 select). `GET …/original-places`(`sop_documents.py`)와 `/file`의 ETag(`document.sha256`) · 304 → 12.16
  - **참조 판정** `refs.read_ref_state`·`is_document_number`: 지도에 둘째 판정을 쓰지 않는다. 임시 번호는 `tobe.is_temp_match_code` 한 곳. Bundle을 건너 번호를 맞출 때는 양쪽 모두 번호 꼴(`ref_map._is_matchable`). → 12.17
  - **업무 규칙 거절** `errors.raise_rule(status, code, **context)`: `app/sop`·`routers/sop_*`에서 `HTTPException`을 직접 던지지 않는다(검사 `test_invariants.py`). revision 충돌은 `check_revision`(409 `revision_conflict`). → 12.18
  - **결과물** `outputs.py`: 스냅숏만 받는 순수 함수다. 검토 조건은 `outputs.build_review_facts`를 쓰고 다시 계산하지 않는다. 칸 글·모양 판정은 `sheet_model.py`에만(미리보기와 xlsx가 같은 모델). Excel C 시트는 `SHOW_C_SHEET`로 숨겨 두었다(시트 이름은 `get_sheet_names()`, 켜는 시험은 `c_sheet_on`).
    - 프런트 사본 `section-number.numberLines`(← `outputs.number_lines`)를 함께 고친다. 새 줄 배치는 `target_placement.arrange_new_targets` 하나. Excel의 모든 글 칸은 `write_text_cell` 하나(수식 방지). → 12.19
- **SOP 데모·E2E는 한 벌의 몰이를 쓴다**: `scripts/sop_demo_driver.py`를 `tests/test_sop_e2e.py`와 `scripts/seed_sop_demo.py`가 함께 쓰고 정답은 `scripts/synthetic_sop.py`의 `SYNTHETIC_expected.json`이다. SOP API 모양이나 규칙을 바꾸면 드라이버·정답과 두 소비자를 함께 확인한다. 시드는 로컬 전용(운영 DB 금지). → 13

## 규칙 — backend에서 불러오는 것

아래 규칙은 루트에서 세션마다 싣지 않고 이 폴더를 다룰 때만 실린다(2026-11-14 문맥 정리).

@../rules/languages/python.md
@../rules/backend/config.md
