# backend 코드 구조 상세

> [`backend/CLAUDE.md`](../../backend/CLAUDE.md)가 줄여 싣는 내용의 원문이다(살아 있는 문서). 이 문서가 설명하는 구조(모듈·흐름·규칙이 사는 자리)가 바뀌면 `backend/CLAUDE.md`와 함께 같은 커밋에서 고친다. 경로 표기는 `backend/CLAUDE.md`와 같다 — `app/…`·`tests/…`·`alembic/…`은 `backend/` 아래, `scripts/db-backup.sh`·`docs/…`·`rules/…`는 저장소 루트.

## 1. 기동과 라우터 — `app/main.py`

- lifespan: Alembic `upgrade head` → (dev 모드만) dev 디렉터리 시드 → 끊긴 AI 작업 회수(늘) → HR 동기화 스케줄러, AI 작업 워커(`app/sop/ai/runner.py`, AI나 임베딩이 켜져 있을 때만).
- 라우터는 `app/routers/`: `auth`·`me`·`directory`·`access`·`admin`과 SOP용 `sop_bundles`·`sop_tobe`·`sop_documents`·`sop_decisions`·`sop_outputs`·`sop_admin`·`sop_ai`(묶음 경로 `router`와 묶음 밖 `jobs_router` — 상단 바 최근 AI 요청 `GET /api/ai/jobs/recent`).

## 2. 인증 — `app/auth.py`

- Keycloak은 서명·issuer에 더해 `azp == KEYCLOAK_CLIENT_ID`까지 검사한다(같은 realm의 다른 앱 토큰 거부, 빈 값이면 전부 거부).
- dev는 `X-Dev-User` 헤더 신뢰(서버에서 쓰면 안 됨).

## 3. 권한 — `app/access/`(권한 판정 단일 소스)

- `catalog.py` `PERMISSIONS`(권한 키는 코드가 정의).
- `resolve.py` `get_effective_access`(개인 부여 ∪ 소속 부서 체인 부여, 역할은 권한으로 펼침, 퇴직자 무권한, `APP_SYSADMINS`는 전권).
- `deps.py` `require_permission("<key>")`(라우터 의존성).
- `sources.py`(권한 출처 응답 `SourceOut`·대상 이름 조회 — `/api/me`의 `sources`와 유효 권한 조회가 공유).
- `require_permission`·`/api/me`·관리 화면의 유효 권한 조회가 모두 `get_effective_access` 하나를 부른다 — 판정을 다른 곳에 새로 쓰지 않는다.
- 부여는 더하기만 있고 부서 부여는 하위 부서까지 내려간다. 대상은 FK 없이 두어 개편으로 사라진 부서·사람의 부여도 지우지 않고 `subject_missing`으로 보인다.

## 4. HR — `app/hr/`·`app/orgchart.py`

- `app/hr/`: HR 웹훅(`client`)·동기화 가드 3종(건수 정합·빈 피드·삭제 상한)·`source="hr"` 행만 지움(`service`)·내장 스케줄러(`scheduler`)·회차 기록(`history`).
- `app/orgchart.py`: 부서 체인 해석.

## 5. SOP 재구성 코어 — `app/sop/`

AI 없이 사람이 끝까지 가는 결정적 경로(계획 1). AI 층은 아래 6절 `app/sop/ai/`. 라우터는 `routers/sop_*.py`. 원문 글자는 앱 로그에 남기지 않는다.

### 5.1 코드 값·표

- 코드 값은 `constants.py`, 표 26개는 `models.py`(Alembic `0005_sop_core`·`0006_warning_kind_length`, AI 작업·제안·지침·임베딩 표 4개는 `0007_sop_ai`).

### 5.2 흐름

1. 업로드 `ingest.py` → **추출은 spawn 자식 프로세스**(`extract/worker.py` — 메인 `docx_reader`/`pdf_reader`와 보조 `aux_compare`(MarkItDown)를 시간·메모리 한도를 따로 걸고 차례로).
   - 결과 타입은 `extract/types.py`의 피클 가능한 불변 값 — 블록·표의 구조 신호 `signals`(번호 범위·목차 까닭·띠 표·표 꼴·안쪽 표 자리, 추출기 5부터 · 문장 속 그림 자리 `inline`, 추출기 7부터 → 문서 보기 그림 블록 `anchor`, 뜻은 그 파일의 docstring)도 여기에 실려 `source_blocks`·`source_tables`의 `signals` 열(Alembic `0025`, 옛 추출은 NULL)로 간다.
   - 업로드 동시 파싱은 `ingest.MAX_PARALLEL_PARSES=2` 세마포어.
2. → 쪼개기 `segment.py`·`coverage.py`·`spans.py`(순수)와 단위 생성 `units.py`.
   - 목차 줄 잡음 표시 `units.noise_kind`의 판정은 `noise.py` — 표시 단위는 판단 줄·AI 범위·입구 2 새 문장에서 빠지고 결과물 A에 "삭제 · 목차" 줄로 남는다, 비우는 길은 편집 `clear_noise`, Alembic `0027`.
3. → 편집 `editing.py`(서버 되돌리기/다시 하기)·한/영 짝 `pairs.py`.
4. → 배정·확정 `decisions.py`(관계 묶음 단위 저장)·입구 2 짝 맞추기 `match.py`.
5. → 결과물 `snapshot.py`(묶음을 DB 표마다 질의 한 번으로 읽은 불변 값) 위의 **순수 함수** `outputs.py`(A·B·C·요약)와 `sheet_model.py`(Excel·미리보기가 같이 쓰는 시트 모델)·`excel_export.py`(모델 → Graphite xlsx)·`flow_image.py`(Pillow, 저장소에 넣은 NanumGothic OFL 글꼴 `assets/fonts/`)·`output_labels.py`(언어별 문구).
6. → 검토 `review.py`(요청 조건 판정 `evaluate_readiness`와 전이 — 요청·거두기(작성자가 검토 대기를 사유 없이 작업 중으로)·완료·되돌리기·다시 열기. 작업 중으로 돌아오는 전이는 모두 의미 검토 4항목을 지운다).

### 5.3 그 밖의 모듈

- 업로드 때 문서 번호·버전·언어 배치 규칙 탐지는 `doc_meta.py`(파일 이름 값이 먼저, New 문서의 번호는 파일 이름에서만).
- Bundle 순차 코드는 `bundle_code.py`(`BND-{id:04d}`).
- `tobe.py`·`tobe_excel.py`(To-Be 목록·Excel 가져오기)(New 목록 응답은 `sentence_counts`(지울 수 없는 자리)와 `slot_counts`(칸에 보이는 항목 수·칸 제목 수, N/A 칸 상태 표의 근거)를 함께 싣는다).
- `checks.py`(숫자·단위·부정 문장 검사), `filename.py`(파일 이름 파싱), `membership.py`(묶음 접근 — 권한과 별개), `events.py`(작업 기록), `schemas.py`(입력 글자 공통 규칙).

### 5.4 참조 지도 — `ref_map.py`(`routers/sop_map.py`)

- 읽기 전용. 줄 모으기 `collect_map_lines`(줄과 그 끝 마디, 거르기를 모두 지난 것 — 줄 문장 API도 이것만 부른다) → 선 묶기 `build_reference_map`.
- 구성원 아닌 Bundle은 번호·제목·상태·후속 문서·줄 수만, Bundle 제목과 문장은 싣지 않고, 그 Bundle의 제안 줄(확인 안 된 줄)은 쓰지 않는다 — 응답 필드는 설계 `docs/architecture/decisions.md` "2026-11-17-reference-map"의 "1걸음에서 정한 것"과 `tests/test_sop_map.py`의 `MAP_KEYS`가 박아 둔 것만.
- 줄 문장은 `GET …/map/lines?node=&scope=`(`build_node_lines` — `collect_map_lines`를 그 마디로 좁힌다, 지도에 없는 마디는 빈 200).
  - 글을 싣는 질의는 `load_line_texts` 하나이고 `bundle_members`를 SQL에서 조인한다.
  - 그 줄이 든 Bundle의 구성원이 아니거나 글 질의가 돌려주지 않은 줄은 선마다 줄 수만(`withheld_*` — 글·표시 ID·Unit id 없이), 문장 줄 + 가려진 줄 수는 늘 지도의 선 `lines`와 같다(키는 `LINES_KEYS`·`LINE_KEYS`·`WITHHELD_KEYS`).

## 6. AI 제안 층 — `app/sop/ai/`(계획 2, v0.3.0)

- 요청(`routers/sop_ai.py`)은 `ai_jobs` 행을 쌓고(`jobs.py`) 곧바로 응답한다.
- 백엔드 안의 단일 실행기(`runner.py`, lifespan 워커 — AI나 임베딩이 켜져 있을 때만)가 작업을 (priority, id) 순으로 꺼내 **`load`(짧은 세션: 스냅샷 읽기·`revision` 적기) → `compute`(세션 없이 임베딩·LLM 호출) → `apply`(새 세션, 묶음을 `FOR UPDATE`로 잠근 뒤 상태를 다시 보고 쓴다)** 세 단계로 돌린다.
- 종류별 핸들러는 `JobHandler`(`load`/`compute`/`apply`)를 구현해 `handlers.py` `HANDLERS` 표에 등록한다: `classify.py`(칸 고르기+한·영 고쳐 쓰기)·`translate.py`·`match_jobs.py`(입구 2 `match_plan`이 LLM 없이 코드로 묶어 변경 종류까지 정한 제안을 쓴다)·`pairing.py`(한/영 따로 짝, 임베딩만)·`split.py`.
- 순수 부분은 `matching.py`·`similarity.py`(코사인·글자 2-gram)·`candidates.py`(칸 후보)·`context.py`(앞뒤 단위·절·Markdown 표).
- 호출은 `llm.py`(원문을 구분자 데이터로 감싸기·재시도·응답 JSON 파싱)·`embeddings.py`(캐시 `embed_texts`).
- 공용 쓰기는 `apply.py`(낡음 판정·밀린 제안 걷기·제안 행·무효 보류)·`adoption.py`(채택 판정과 채택률).
- 최근 AI 요청 목록(상단 바, 멤버인 묶음만·요청 단위 집계·이름 없음)은 `recent.py`, 수치는 `constants.py`, 지침·프롬프트 버전은 `guidelines.py`와 `seeds/`, 요청·응답 모양은 `schemas.py`다.
- 문서 정보 제안(`doc_meta_job.py`, v0.9.0)은 사람이 요청하지 않고 업로드 때 규칙이 비운 번호·버전만 묻는다(AI가 켜져 있을 때) — 값은 제안 행으로만 남고 문서 목록에서 사람이 눌러야 저장된다(시험의 공용 가짜 AI는 이 자동 작업을 끄고, `test_sop_ai_doc_meta`만 켠다).
- 지침 관리는 `routers/sop_guidelines.py`(`guideline.manage`).
- 프런트와 맞춘 API 계약은 `docs/architecture/api-contract.md`다(계획 2의 "API 계약" 블록을 옮겼다).

## 7. 떼어 내기는 한 함수군

- 배정 지우기·문서 삭제·쪼개기 편집·새 문장 다시 맞추기가 모두 `detach.py` `detach_units`/`detach_targets`로 판단을 미배정·보류로 돌린다 — 새 경로가 판단·출처 연결을 직접 지우지 않는다.

## 8. 사내 AI 호출·사용량 — `app/ai_client.py`·`app/ai_usage.py`

- OpenAI 호환 사내 GLM 호출(`call_ai`)과 임베딩 호출(`call_embeddings`, `EMBED_*`, 같은 동시성 세마포어) + 호출 1건당 `ai_usage_events` 한 행(원문 없음).
- 사용량은 `record_ai_usage`가 자기 짧은 세션으로 남긴다.

## 9. 시각

- 시각은 전부 `DateTime(timezone=True)`와 `app.clock.now()`(KST, 맨 `datetime.now()` 등은 ruff `TID251`이 막는다). 프런트 표시는 `lib/datetime.ts`(Asia/Seoul).

## 10. 체크리스트 상세

### 10.1 새 `/api/admin/*` 엔드포인트

- 라우터 단 게이트가 없으니 엔드포인트마다 권한 의존성이 필수다. `test_every_admin_route_rejects_a_user_without_permissions`가 권한 없는 사용자로 전 라우트를 순회해 누락을 잡는다.
- `/api/access/*`는 라우터 단에 `permission.manage`가 걸려 있다.

### 10.2 모델 변경 = Alembic 리비전 필수

- `backend/alembic/versions/`에 `--rev-id 000N`으로 만든다(`create_all`은 쓰지 않는다 — `test_invariants.py`).
- 모델과 마이그레이션이 어긋나면 `test_models_match_migrations`(`compare_metadata`)가 잡지만 **CHECK 제약 차이는 못 잡는다** — 제약을 건드리면 마이그레이션된 DB에 직접 부딪쳐 보는 테스트를 둔다(`test_migrations.py`).
- 시각 컬럼은 `DateTime(timezone=True)`.
- `batch_job_runs`는 백업 사이드카가 psql로 쓰는 계약이라 컬럼을 바꾸면 `scripts/db-backup.sh`의 INSERT도 함께 바꾼다.

### 10.3 프런트가 사본을 둔 규칙

- 대상: `number_lines`·`get_bullet_depths`·`plan_follow`·`build_block_places`·빈 글자 판정·상수.
- 바꾸면 `.venv/bin/python -m scripts.dump_rule_cases`로 `frontend/src/lib/rule-cases.json`을 다시 뽑고 프런트 사본이 `npx vitest run src/lib/rule-cases.test.ts`를 통과하게 고친다 — 뽑지 않으면 `tests/test_rule_cases.py`가, 사본이 다르면 vitest가 실패한다. 새 사본을 만들면 사례도 더한다.

### 10.4 AI 호출

- 페이로드에 직원 실명(`name`·`korean_name`)을 싣지 않는다 — 역할·부서 등 비식별 정보만.
- 호출은 `call_ai_recorded`를 거쳐(검사: `test_invariants.py`) 사용량 행을 남기고(실패도 `ok=false`), 사용자에게 보이는 오류는 AI 주소·토큰을 뺀 문구다.
- **AI 호출 동안 DB 연결을 잡지 않는다** — `call_ai_recorded`는 세션을 받지 않고, 요청 세션을 쓴 핸들러는 호출 직전 `await session.close()`로 돌려준다(`ping_ai`). AI 작업은 이 규칙을 구조로 지킨다 — 아래 11절.

## 11. AI 제안 층 불변식 상세(`app/sop/ai/`)

새 AI 종류·쓰기 경로를 더할 때 지킨다.

### 11.1 `load/compute/apply` 계약

- 핸들러의 `compute`는 세션을 받지 않는다(검사: `test_invariants.py`).
- `load`가 필요한 값을 불변 값으로 꺼내 세션을 닫고, 임베딩·LLM 호출은 그 뒤에 하며, 쓰기는 묶음을 잠근 `apply`에서만 한다(그 사이 사람이 쪼개거나 지워서 `load`가 적은 `revision`·해시가 달라졌으면 `stale`로, 검토를 요청해 묶음이 작업 중이 아니면 실행기가 `apply`를 하지 않고 `cancelled`로 끝낸다).
- 커밋은 실행기가 해서 상태 전이와 한 트랜잭션이다. 사용량 기록도 호출 뒤 자기 짧은 세션이다(`record_ai_usage`). AI 호출 동안 열린 세션이 있는 핸들러는 없어야 한다.
- LLM까지 가야 끝나는 작업의 `compute`는 임베딩보다 먼저 `llm.ensure_llm_enabled()`를 부른다(AI가 꺼지면 아무것도 보내지 않고 `config`다. 임베딩만 쓰는 `pair`는 제외).

### 11.2 AI는 제안 기록에만 쓴다

사용자 결정 2026-11-19, 설계 `docs/architecture/decisions.md` "2026-11-19-ai-suggest-only". 검사: `test_invariants.py` — `app/sop/ai`가 `confirmed_text`에 빈 글자 밖의 값을 쓰지 않고, 번역 `translate.py`(D5)·짝 `pairing.py`(D6) 밖의 AI 핸들러가 `UnitDecision`·`TargetSentence`·`TargetSource`를 쓰거나 그것을 쓰는 길을 부르지 않는다.

- 분류·묶기의 `apply`는 `ai_suggestions` 행만 쓴다 — 판단·새 문장·출처 연결·`revision`을 건드리지 않아 배경 작업이 사람의 저장을 409로 막지 않는다.
- 사람이 받으려면 화면이 제안 내용으로 초안을 채워 관계 묶음 저장에 `suggestion_id`를 싣고, 그 저장(`decisions._link_suggestion`)이 판단·입구 2 새 문장에 제안 id를 이어 채택을 남긴다.
- 제안은 미배정 단위에만 나오고, "살아 있는 제안"(`apply.load_live_suggestions` — `applied`이고 채택 없음, 단위·새 문장은 `content`에서 `find_covering`으로 가린다)의 같은 종류 이전 제안을 `mark_stale`로 밀어낸다. 분류는 묶기 제안이 살아 있는 단위를, 묶기 계획은 분류 제안이 살아 있는 단위를 다루지 않는다.
- 무효 답은 `invalid` 제안 행뿐이다(단위를 보류하지 않는다).
- 사람이 받지 않고 확정한 줄의 살아 있는 분류·묶기 제안은 그 저장이 정리한다 — 관계 묶음 확정·일괄 처분은 `adoption.judge_unused_suggestions`(저장이 제안과 다르면 채택 "버림", 같으면 채택 없이 stale — 설계 §5 2-7), 입구 2 한 번에 확정(`match.confirm_in_bulk`)은 신규로 확정하는 새 문장을 모두 덮는 살아 있는 신규 제안을 그대로 받은 것으로 남기고(설계 §5 3-5) 나머지는 `apply.close_unused_suggestions`(stale)다.
- **종류별 일괄 수락**(`app/sop/accept_suggestions.py`, 사람의 저장 경로라 `ai/` 밖)은 제안마다 `check_group` → `save_group`을 `suggestion_id`를 실어 부르고(신규는 `confirm_in_bulk`) 라우터가 한 되돌리기 단계(`accept_ai`)로 감싼다 — 저장 요청은 채택 판정과 같은 모양(`adoption.build_rewrite_shapes`)이라 받으면 "그대로"다.
  - 경고·AI가 본 뒤 바뀐 제안(활성·미배정이 아니거나 분류의 단위 해시가 다름, 분류가 짝의 한쪽만)·사람이 사유나 캡션을 적어야 하는 제안은 받지 않고, 짝의 한쪽만 담은 묶기는 화면 Use처럼 남는 쪽을 `release_unit_ids`로 푼다.
  - `check_group` 거절은 그 제안만 건너뛴다(검사는 쓰지 않는다). 남기면 나중에 지운 줄을 문서 범위 분류가 `already_suggested`로 건너뛴다.
- 묶기 제안은 옛 문서를 가로지를 수 있어(제안의 문서는 첫 옛 단위의 것) 분류가 묶기 제안을 볼 때는 문서로 좁히지 않는다.
- 응답은 정해진 JSON 필드로만 읽고 후보 밖이면 그 단위만 보류한다. 응답의 모든 글자는 `replace_unstorable_chars`를 거치고, 무효 제안에는 응답 원문을 남기지 않는다.
- 로그에는 ID·건수·상태 코드·예외 클래스 이름만 쓴다(`logger.exception` 금지, 트레이스백에 값이 실린다).

### 11.3 임계값은 합성 자료로만 잡은 값이다

- `constants.py`의 `MATCH_EMBED_THRESHOLD`·`MATCH_TEXT_THRESHOLD`·`PAIR_THRESHOLD` 등.
- 합성 시험(`tests/fake_ai.py` `SyntheticAnswers`, `tests/ai_fixtures.py`)은 배선과 규칙의 검증이지 실제 모델 연결이 아니라서, 실제 모델·SOP로 시험하기 전에는 정확도·채택률을 근거로 주장하지 않는다.
- 숫자를 바꾸면 합성 시험을 같이 옮기고, 실제 시험 뒤 다시 정한다.

### 11.4 번역은 출처 새 문장을 따른다

- 출처의 글·자리(칸 좌표·부모·출처 단위 집합 포함)가 바뀌거나 출처가 사라지면 `detach.sweep_translations`가 AI 번역은 지우고(제안 `stale`) 확정 번역은 보류(`system:related_unit_changed`)로 돌린다.
- 저장(`decisions`)·순서 바꾸기(`routers/sop_outputs`)·떼어 내기(`detach`)·입구 2 새 문장 맞추기(`match.sync_new_doc_targets`)가 이것을 부르니, 새 문장의 글이나 자리를 바꾸는 새 경로도 부른다.
- 출처가 그대로인 AI 번역은 표에 딸려 와도 일반 보류에서 뺀다(`detach._should_hold`, 보류하면 확정 글이 빈 보류가 된다).
- AI 번역 줄의 칸·단계·깊이는 출처를 따라 잠겨 있다(저장 경로는 422 `invalid_group`의 사유 `translation_locked`, 순서 바꾸기 엔드포인트는 422 `translation_locked`).
- 번호 표시와 칸 안 순서는 그 줄 자신의 것이다 — 출처의 표시를 따라 바꾸지 않고(`detach._follow_source`도 덮지 않는다), 새 AI 번역은 번호 생략으로 출처 바로 뒤에 놓인다(순서를 정한 문서는 `target_placement.insert_after`, 아니면 결과물 정렬 키 — 제품 명세 §7.13 섹션 번호).

### 11.5 요청 묶음 `request_id`

- 사람의 요청 한 번은 `enqueue_jobs` 한 번(넘기지 않으면 새 uuid를 만들어 그 호출의 작업이 모두 같은 값을 받는다)이거나 같은 값을 넘긴 여러 번이고, 작업이 뒤따라 쌓는 작업은 부모 작업의 `request_id`를 넘긴다(지금은 그런 작업이 없다 — 입구 2 계획이 쌓던 `match`는 걷었다).
- 빠뜨리면 상단 바 목록에서 한 요청이 여러 줄로 갈라지고 진행 "n / N"이 틀린다.

### 11.6 순위와 `background`, 묶기 먼저, 계획은 묶음마다 하나

- `ai_jobs.priority`(`constants.py` `AI_PRIORITY_PLAN` 0 < `USER` 1 < `PRE_CLASSIFY` 2)가 꺼내는 순서이고 같은 순위 안에서는 id 순이다(`claim_next_job`).
- `background`는 미리 돌리기 표시일 뿐 순서는 `priority`만 정한다.
- 같은 묶음에 `match_plan`이 대기·실행 중이면 `classify`는 건너뛰고(묶은 뒤에 분류), `match_plan`은 같은 묶음에서 하나만 돈다.
- 새 작업을 `enqueue_jobs`로 쌓을 때 사람 요청이 아니면 `priority`를 넘긴다.

### 11.7 계획이 쓴다(입구 2, 제품 명세 §7.10)

- `match_plan`이 LLM 없이 문장 묶음까지 제안을 바로 쓰고 변경 종류는 구조·글이 정한 값이 마지막이다(12.1절 "변경 종류", 내용에 `links`·`target_change_types`, 이유·규칙 ID는 빈다).
- 말투·고침을 LLM에 다시 묻던 `match` 작업·`prompt.match`·제안의 `provisional`(다듬기 대기)은 걷었다(설계 `docs/architecture/decisions.md` "2026-11-20-change-type-two" D6) — 작업 종류 값 `match`는 옛 행 때문에 `AI_JOB_KINDS`(CHECK)에 남고 다시 시도로 줄 세우지 않으며(`AI_RETIRED_JOB_KINDS`), 옛 제안의 `provisional`은 읽지 않고(일괄 수락도 받는다), 옛 `prompt.match` 지침 행은 지침 목록이 아는 키만 실어 보이지 않는다.
- 다시 세운 계획은 `(모양, 단위, 새 문장)`이 살아 있는 제안과 같은 것을 밀어내지도 쓰지도 않고, 달라진 것에 닿는 살아 있는 제안만 `mark_stale`로 밀어내고 다시 쓴다.
- 계획 `payload["origin"]`이 나머지를 정한다:

  | `origin` | 짝 없는 옛 단위의 삭제 후보 | 사람이 버린 묶음 |
  |---|---|---|
  | `user`(**Match** 단추, 키 없는 옛 계획) | 배정 New 문서가 없을 때만 | 다시 쓴다 |
  | `prepare`(배정 화면 첫 진입) | 같은 규칙 | 쓰지 않는다 |
  | `upload`(파일 읽기 끝) | **새로 쓰지 않는다** — 목록이 덜 찼을 수 있다 | 쓰지 않는다 |

- `upload`의 삭제 후보는 "새로 쓰지 않을" 뿐이다. 그대로 비교는 삭제 후보를 `origin`과 상관없이 지금 규칙이 쓸 것과 견준다 — 지금 규칙으로도 삭제 후보인 살아 있는 제안은 같은 제안 id로 남고, 짝을 얻었거나 배정 New 문서가 생겨 규칙이 달라졌으면 보통처럼 걷는다(걷은 뒤 새 삭제 후보는 쓰지 않는다).
- 저절로 선 계획(`upload`·`prepare`)은 사람이 버린(채택 `rejected`) 짝 맞추기 제안과 `(모양, 단위, 새 문장)`이 같은 묶음을 쓰지도 걷지도 않고 그 줄을 그대로 둔다 — **Match**(`user`)는 다시 쓴다.

### 11.8 저절로 쌓는 자리(`AI_AUTO_PREPARE`, 기본 켬)

- 파일 읽기가 끝난 업로드 핸들러(`routers/sop_documents.py`)가 `match_jobs.enqueue_auto_plan(..., origin=PLAN_ORIGIN_UPLOAD)`를 부른다 — AI와 설정이 켜져 있고 읽힌 Old 문서와 이미 쓴 New 문서(`entrance == "match"`)가 각각 하나 이상이고 줄 선 `match_plan`이 없을 때만 계획 하나(`AI_PRIORITY_PLAN`, 미리 돌리기 아님)를 쌓는다.
- 호출부가 `lock_bundle`로 묶음을 잠근 채 부르고 커밋한다 — 줄 선 계획 확인과 쌓기 사이에 다른 업로드가 끼지 않게. 업로드는 이미 끝났으니 `ensure_editable`로 거절하지 않는다.
- 돌고 있는 계획은 막지 않는다. `ai.request` 기록은 남기지 않는다.
- 시험의 공용 가짜 AI는 이것을 끄고(`install_fake_ai(auto_prepare=False)`, 시드가 쓰는 `fake_ai_session`도 같다) 켜는 시험만 `auto_prepare` 픽스처를 쓴다.

### 11.9 배정 화면 첫 진입(`POST /ai/prepare`, `prepare.queue_prepare`)

묶음 잠금 안에서:

1. 설정이 꺼져 있으면 0건.
2. 이미 쓴 New가 있고 `origin`이 `prepare`·`user`(키 없음 포함)인 `match_plan` 행이 상태와 상관없이 없으면 `enqueue_auto_plan(origin=prepare)`.
3. 배정 New 문서가 없으면 분류 없음.
4. 읽힌 Old 문서 가운데 `background` 분류 행이 한 번도 없던 문서(열어 본 문서 먼저, 나머지는 문서 id 순)마다 `select_classify_items`로 골라 `AI_PRIORITY_PRE_CLASSIFY`·`background`로, 글이 똑같은 1:1 후보(`list_identical_candidates`, 짝이면 줄 전체)를 빼고 한 `request_id`로 쌓는다.

- 응답 `queued`는 분류 작업만 세고 `ai.request` 기록은 남기지 않는다.
- 첫 `prepare`가 고른 줄이 하나도 없던 문서는 `ai_jobs` 행이 없어 미리 돌린 문서로 치지 않으므로, 그 뒤에 지운 줄은 다음 진입 때 미리 분류된다(설계대로 받아들인 동작).

### 11.10 기록

- 채택은 사람의 저장 트랜잭션 안에서 `adoption.py`가 남기고 처음 정한 판정이 남는다.
- 작업 기록(`bundle_events`)에는 `ai.request`·`ai.cancel`·`ai.retry`만 쓰고 적용·채택은 쓰지 않는다(조회 상한 500을 큰 분류가 채우지 않게).

## 12. SOP 규칙 이중 사용 지점 상세

아래는 각각 한 곳에만 쓴다. 두 번째 구현을 만들면 커버리지·상태가 조용히 어긋난다.

### 12.1 변경 종류 `decisions._decide_change_type`·`_settle_table_types`

설계 `docs/architecture/decisions.md` "2026-11-20-change-type-two", Alembic `0032`.

- 사람이 고르지 않고 저장 입력도 받지 않는다(`TargetIn`에 `change_type` 없음 — 옛 화면이 보내면 무시).
- 구조 종류(번역·칸 제목·신규·합침·나눔)가 먼저, 글자 비교는 둘뿐이다 — 문장은 출처 글(번호를 뺀 내용 포함)과 같으면 `as_is`, 다르면 `rewritten`.
- 표는 원문 모양(R27: 격자, 칸 새 문장의 칸 자리, 묶인 칸 문장마다 칸 새 문장 하나)을 지키면 `as_is`, 아니면 `rewritten`이고 사유는 선택, 그림은 늘 `as_is`.
- AI 제안 쪽 사본은 `apply.decide_ai_change_type`(문장)·`match_jobs._plan_table`(표)·`classify._derive_change_type`(기록용)이라 규칙을 바꾸면 함께 고친다 — 어긋나면 입구 2 채택 판정(`adoption`, 짝 하나·표는 종류까지 견준다)이 틀린다.

### 12.2 SOP 칸 = 문서 골격 사본 `outline.py`

- 칸의 순서·번호·라벨·부모·배정 가능 여부는 그 문서의 사본(`target_doc_outline_items`, 값 객체 `DocOutline`)에서 읽는다 — 코드에 고정 칸 목록은 없다.
- 기본 표준은 회사 SOP 템플릿 1–9장(`outline.TEMPLATE_OUTLINE`, Alembic `0024`가 옛 15칸 자료를 옮겼다)이고, 항목의 종류(`kind`)가 줄을 받는지(`is_assignable` — 묶음 제목·자동 목록은 422 `slot_not_assignable`)·세는지(`counts_lines`)를 정한다.
- 번호는 결과물이 내보낼 항목끼리 센다(`list_emitted_keys` → `number_outline` — 비어 있는 선택 항목은 빠진다. 결과물 `outputs._Index.outline_numbers`와 To-Be 목록 `tobe.build_tobe_out`이 같은 두 함수를 쓴다).
- 새 SOP 사본은 첫 절차 `procedures.p1`을 함께 받고, 새 줄의 기본 번호 표시는 항목의 `default_style`이다(`target_placement.get_default_style`, 다른 절로 옮길 때는 `restyle_moved`).
- AI 규칙 글의 칸 ID(S1 … S7.2)는 후보의 안내 글을 고르는 데만 쓴다(`ai/candidates.match_rule_slot`).
- 표준(`outline_standard_items`)은 기동 때 비어 있으면 시드하고 관리자가 `routers/sop_outline.py`(`/api/admin/outline`, 권한 `outline.manage`)로 통째로 바꾼다 — 바꿔도 이미 만든 문서의 사본은 그대로다.
- SOP `TargetDoc`을 만드는 길은 모두 `copy_standard_to_doc`을 부른다(사본이 없는 SOP는 칸이 하나도 없어 모든 배정이 `unknown_slot`이다).
- 위계는 키의 점이다(부모 = 마지막 점 앞, `get_parent_key`). `slot_key` 칸(`target_sentences`·`target_doc_na_slots`)은 사본의 키를 가리킨다(계획 `2026-11-17-template-fit-1-outline-plan.md`).
- **사본을 고치는 길은 `outline_edit.py` 하나다**(선언 항목 — 6장 절차·9장 부록·5장 범주 — 의 더하기·이름·순서·빼기 API와 To-Be Excel `SOP 절차` 시트):
  - 새 키는 `부모.n<수>`이고, 뺀 선언 항목은 행을 지우지 않고 `is_removed`로 남겨 그 수를 다시 쓰지 않는다(`DocOutline`이 건너뛴다 — 그 키로 줄을 되살리는 되돌리기는 `decision_steps._find_misplaced_targets`가 거절한다).
  - 칸 제목 줄의 글은 늘 그 칸의 라벨이라, 사본의 이름·순서를 바꾸는 길은 끝에서 `_sync_slot_heading_texts`를 거친다(`_finish_edit`).

### 12.3 빈 글자 판정 `segment.py`의 `is_blank_char`·`has_visible_char`·`INVISIBLE_CHARS`

- 추출기·쪼개기·커버리지(`coverage.py`)가 모두 이것을 쓰고, 누락 대조의 `aux_compare.normalize_for_compare`는 같은 판정의 빠른 사본이다.
- `isspace()`를 새로 쓰지 않는다 — 불변식(공백 아닌 글자를 빠짐없이·겹침 없이 덮는다)이 이 판정 위에 서 있다.
- 검사: `tests/test_invariants.py`(`isspace` 사용처), 프런트 사본은 `rule-cases.json`.

### 12.4 관계 묶음 그래프 `groups.collect_component`(출처 연결 + 표↔칸 새 문장 연결)

- 묶음 읽기(`build_group_out`)·저장의 닫힘 검사(`decisions`)·떼어 내기(`detach`)가 같은 그래프를 본다. 묶음 ID와 표 접기도 `groups.py` 하나(결과물 A도 쓴다).
- 연결 종류를 더하면 `_find_neighbors` 하나만 고친다.
- 칸 제목(`slot_heading`)은 단위에서 들어가기만 하는 끝 노드라 다른 옛 문서의 같은 제목을 한 묶음으로 엮지 않고 관계 묶음 ID에도 들지 않는다 — 저장은 보낸 단위의 출처만 바꾸고(`decisions._resolve_slot_headings`), 칸 제목의 상태는 출처 판단 중 가장 덜 끝난 것을 저장·떼어 내기가 출처나 판단을 바꿀 때마다 `detach.apply_slot_heading_status` 하나로 다시 정한다(사람이 칸 제목을 따로 확정·보류하지 않는다).

### 12.5 커버 상태 `status.get_cover_status`

- 칸 문장은 묶인 표 단위의 판단을 따른다. view·단위 목록·결과물·검토 조건이 이 함수를 부르고, SQL로 다시 쓴 사본 둘(`coalesce(group_decision.status, UnitDecision.status)` — `decisions` 단위 목록 거르기·`match`)은 규칙을 바꾸면 함께 고친다.
- 배정 화면 한 줄(짝 하나·짝 없는 판단 단위 하나)의 상태는 `status.pick_row_status`(순서 `ROW_STATUS_ORDER` = 프런트 `classify-model.ts` `STATUS_RANK`)이고, `snapshot.load_bundle_progress`가 같은 순서를 SQL 순번으로 쓴다 — 순서를 바꾸면 셋을 함께 고친다.

### 12.6 줄 기준 숫자 `snapshot.load_bundle_progress` ↔ `outputs.build_review_facts`

- 진행 숫자(묶음 목록·개요·관리, `RowProgress`)와 검토 요청 조건의 `units_*` 건수는 같은 줄 규칙이다 — 짝 하나 전체 또는 짝 없는 판단 단위 하나(데이터 표는 한 줄, 묶인 칸 문장은 세지 않음, 그림 한 번, 잡음 표시 단위(목차 줄)는 세지 않음), 상태는 가장 덜 끝난 구성 단위.
- 앞은 원문 글자를 읽지 않는 SQL 두 번이고 뒤는 스냅숏(`BundleSnapshot.pair_of`)에서 센다.
- 프런트 `classify-model.ts` `buildRows`도 같은 줄이다 — 줄의 뜻을 바꾸면 셋을 함께 고친다(제품 명세 §6.5 커버리지).
- 결과물 A의 묶음·B의 건수·C의 삭제·이동·요약(`build_summary`)도 같은 줄(`output_rows.build_meaning_rows`)을 쓴다.

### 12.7 짝의 운명 `pair_settle.settle_pairs`

- 한/영 짝의 확정·풀기는 판단을 쓰는 길 끝에서 이 함수 하나가 한다(관계 묶음 저장 `save_group` — `release_unit_ids` 포함, `dispose_units`, `match.confirm_in_bulk`, 짝 만들기 `create_pair`·AI 짝·`refresh_code_pairs`).
- 운명 판정은 `get_decided_fate`·`load_decided_fates`·`has_diverging_fates` 한 벌이고(사람 짝 만들기의 409 `pair_fates_differ`도 이것), 짝 확정과 그때의 번역 쓸기는 `pairs.mark_pair_confirmed` 한 곳이다.
- **판단이나 짝을 쓰는 새 길을 만들면 그 끝에서 `settle_pairs`를 부른다** — 빠뜨리면 한 줄(짝)에 처분 둘이 남는다(제품 명세 §6.5 "짝은 한 곳으로 간다"). 시스템이 떼어 내는 길(문서 삭제·쪼개기 편집)은 부르지 않는다.

### 12.8 경계 확인은 없다(v1.0.18)

- 배정 확정이 곧 경계 확인이라(네 단계 워크플로우 명세 §5) 확인 API(`…/units/boundary`·`…/units/boundary/all`), 남은 수(`unchecked_boundaries`), 문서 보기의 `boundary_confirmed`를 없앴다.
- 남긴 것은 둘뿐이다 — `units.boundary_confirmed` 열(리비전을 만들지 않으려고)과 `editing._step_edit`의 `BOUNDARY_OPS` 가지. 운영 DB의 되돌리기 줄(`unit_edits`)에 옛 확인 기록(`boundary`·`check_all`)이 편집과 섞여 있어, 그 가지를 지우면 되돌리기가 거기서 막힌다.
- 작업 기록의 `unit.check_all`도 옛 기록으로 남아 있다(프런트 `event-kinds.ts`·`edit-step-model.ts`가 계속 읽는다).

### 12.9 새 문서 새 문장 맞추기 `match.sync_new_doc_targets`

- 쪼개기 편집·되돌리기·다시 하기 뒤 새 문서 하나의 절 경로·언어·칸 부모·좌표·순서를 통째로 다시 맞춘다.
- 단위를 바꾸는 새 경로가 새 문장을 직접 고치지 않고 이것을 부른다.
- Assign 되돌리기 · 다시 하기(`decision_steps._move_unit_edit`)는 편집을 거꾸로 돌린 뒤 찍어 둔 새 문장을 옛 id로 되쓴다. 그래서 되쓸 새 문장의 단위를 `restoring_unit_ids`로 `undo_edit`·`redo_edit` → `_step_edit` → `_write_change`를 거쳐 넘기고, 맞추기는 그 단위의 새 문장을 만들지도 고치지도 않는다(만들면 단위 하나에 새 문장이 둘이 된다, 쪼개기 먼저 설계 §4-1). 은퇴한 단위의 떼어 내기는 그대로 돌고, 문서 편집 되돌리기(`edits/undo`)는 되쓸 것이 없어 넘기지 않는다.
- 같은 단계가 찍은(= 지금과 같다고 확인한) 새 문장의 단위는 `settled`에도 들어 이은 칸이 있어도 다시 하기가 확인을 묻지 않는다.

### 12.10 편집 쓰기 길 `editing._write_change`

- 편집·되돌리기·다시 하기가 하나로 합쳐 검사(판단 있는 단위·확인 플래그) → 단위 은퇴·생성 → 떼어 내기·맞추기 → 커버리지 가드 → 문서 revision +1을 돈다.
- 새 편집 종류는 `_Change`로 이 길에 얹는다.

### 12.11 문단 번호 `numbering.py`(표 풀기·표준화 명세 F5, Alembic `0028`)

- 번호는 범위로 표시할 뿐 단위 글(`text`)에서 빼지 않는다(커버리지 그대로).
- 단위의 `number_read`·`number_source`·`number_len`은 범위와 블록 신호에서 나오는 값이라 처음 쪼개기(`units._build_unit_rows`)와 쪼개기 편집(`editing._build_draft`)이 `build_number_columns` 하나로 쓰고, 사람이 고치는 것은 `number_set`뿐이다(NULL 고치지 않음, `""` 번호 없음 — `set_number` 편집이 제자리에서 바꾸고 `unit_edits.number_changes`에 적어 되돌린다).
- 글 앞 타자 번호는 제목 줄이든 본문 줄이든 처음부터 번호다(사용자 결정 2026-11-20, 본문 줄은 `is_read_from_text`로 "Read from text"를 알린다).
- DOCX는 추출 신호가 없는 줄바꿈 뒤 줄머리의 타자 번호도 읽고(`reads_line_starts`, 정규식은 `segment.TYPED_NUMBER_RE` 하나), 첫 범위 전체가 번호이고 뒤 범위가 있으면 그 범위가 번호다.
- 단위 글(`segment.build_unit_text`)은 범위를 띄어쓰기로 잇고 범위 안 줄바꿈도 띄어쓰기다(길이 그대로, Alembic `0035`가 옛 글을 바꿈) — 변경 종류의 "그대로"는 `numbering.is_source_text`가 줄바꿈을 띄어쓰기로 보고 견준다.
- 목차 줄(`noise_kind`)은 번호 칸이 없다.
- 번호 칸의 값·가릴 길이·내용은 `get_number`·`get_hidden_len`·`strip_number`만 읽는다 — 새 문장 기본 글·변경 종류·문장 검사(`decisions`), 결과물 A 원문 칸·위치(`outputs`), 문서 보기(`routers/sop_documents._to_number_out`)가 함께 쓴다.
- AI 입력 글은 번호를 품은 `text` 그대로다(§11-8).
- 따라 고치기 `plan_follow`는 프런트 `lib/number-model.ts` `planFollow`가 미리 보기에 사본으로 쓰니 규칙을 바꾸면 함께 고친다(두 쪽 시험이 같은 사례다).
- 레이아웃 표의 번호만 든 칸은 `segment.build_unit_drafts`가 같은 행 첫 줄의 범위 앞에 붙인다.

### 12.12 입력 글자의 NUL·서로게이트 `schemas.NO_NUL`/`NoNulStr`

- Postgres text는 NUL을 담지 못하고 sqlite는 받아 줘 테스트에 안 보인다.
- DB까지 가는 새 글자 입력 칸은 이 타입을 쓴다(`StringConstraints`가 있으면 그 뒤에 `NO_NUL`, 앞에 두면 길이를 공백을 걷기 전에 잰다).
- 선택 칸은 `Field(max_length)`가 아니라 `Annotated[str, StringConstraints(max_length=…), NO_NUL] | None`으로 쓴다(`| None`에 `Field` 상한을 걸면 오류 종류가 `string_too_long`이 아니라 `too_long`이다).
- 저장 못 하는 글자(NUL·U+D800–DFFF)의 판정은 `segment.has_unstorable_char` 하나이고, 파일 이름은 `ingest_upload`가 422 `invalid_file_name`으로 막으며, 추출·AI 응답 글자는 `segment.replace_unstorable_chars`가 같은 길이의 대체 문자로 바꾼다.

### 12.13 제목 ↔ 문장 `segment.is_heading_like`(F8b, Alembic `0029`)

- 제목다움 판정은 이 함수 하나를 옛 문서 쪼개기(`build_unit_drafts`의 `shift_headings` — 바꾼 문장에 `units.from_heading`)와 추출기 절 이름(`docx_reader` — 바꾼 조항은 번호가 있을 때만 절을 연다)이 함께 쓴다. 규칙을 바꾸면 두 곳이 같이 움직인다.
- 바꾼 문장은 코드 짝에서 조항마다 덩어리(같은 문장 수면 1:1)이고, 번호 없는 번역 조항의 첫 문장은 `numbering.find_inherited_numbers`로 앞 조항 번호를 받는다(`number_source = "pair"`, 처음 쪼개기와 편집 `set_heading`이 같이 쓴다).
- 편집 `set_heading`과 그 되돌리기는 짝을 `units.pair_new_units`로 새 단위만 다시 세운다.

### 12.14 띠 표 → 제목 줄 `segment.is_certain_band`·`is_band_heading`(F4, Alembic 없음)

- 꼴이 확실한 띠 표(표 신호 `band`, 본문의 바깥 표)는 옛 문서를 올릴 때 `units.create_initial_units`가 `source_tables.is_layout`을 켜 두고, 레이아웃 띠 표(`TableView.is_band`)는 `build_unit_drafts`가 번호 칸 + 제목 칸을 `heading` 단위 하나로 만든다.
- 띠 표의 `set_layout_table`은 단위 모양이 바뀌어 `editing._plan_band_layout`이 같은 `build_unit_drafts`로 제목 줄 ↔ 데이터 표(표 단위 + 새 칸 문장, `_Draft.group_draft`)를 다시 세운다.
- 띠 표가 아닌 표의 `set_layout_table`은 바로 안쪽 띠 표도 같은 편집으로 함께 바꾼다(F2, `_merge_change`) — 그 밖의 안쪽 표는 누른 표만.
- "`table_id`가 있는 `heading`" 판정은 결과물 A 위치(`outputs._format_place` — "띠 표")와 프런트 `paper-model.isBandHeading`(용지가 표 대신 제목 줄로 그림·Shape의 **Back to band table**)이 함께 쓴다.

### 12.15 캡션 자리 `caption_slot.build_block_places`(F7, Alembic `0030`)

- 블록 자리(문단 · 표(칸은 바깥 표 하나) · 그림이 한 자리, 빈 문단은 자리가 아니다)는 캡션 후보를 가까운 순으로 늘어놓는 잣대다 — `attach_caption`은 거리를 재지 않는다(B10 8-b).
- 캡션이 될 수 있는 글은 `editing.CAPTIONABLE_KINDS`(문장 · 제목 · 묶음이 풀린 칸 문장)이고 프런트 `caption-slot-model.getCaptionRefusal`이 같은 판단이다.
- 프런트 `lib/caption-slot-model.ts`(공용 사례 `scripts/dump_rule_cases.py` → `rule-cases.json`)가 자리를 사본으로 쓰니 규칙을 바꾸면 함께 고친다(두 쪽 시험이 같은 사례다).
- 그림 여럿 ↔ 캡션 하나는 그림 단위의 `caption_figure_id`(묶음의 첫 그림)만 바꾸는 편집 `group_figures`·`ungroup_figures`(기록 `unit_edits.figure_changes`)이고, 확정 캡션 검사는 `decisions._find_shared_captioned`가 같은 판단을 프런트 `isSharedCaptioned`와 나눠 쓴다.

### 12.16 대응 표 `counterparts.py`(F8a, Alembic 없음)

- 한/영 따로 문서의 같은 꼴 표 판정(`is_same_form`)과 비슷한 차례는 이 순수 모듈에 두고 짝 다시 세우기(`units.refresh_code_pairs` → `_find_table_pairs`)가 쓴다 — 둘 다 벗긴 한글 표를 같은 꼴인 가장 비슷한 벗긴 영어 표와 맺는다.
- 표는 하나씩 벗긴다(함께 벗기기는 걷었다, 사용자 결정 2026-11-19 — 옛 편집 기록의 `payload.counterpart_table_id`는 읽지 않는다).
- 행 수가 다른 대응 표는 추출 경고 `pair_rows_differ`(확인 불필요)로 남고 짝을 다시 세울 때마다 맞춘다.

### 12.17 참조 판정·번호 꼴 `refs.read_ref_state`·`is_document_number`

- 지도(`ref_map.py`)는 문서 보기와 같은 함수를 부른다 — 지도에 둘째 판정을 쓰지 않는다.
- 임시 번호는 `tobe.is_temp_match_code` 한 곳.
- 지도가 Bundle을 건너 번호를 맞출 때는 양쪽 모두 번호 꼴이어야 한다(`ref_map._is_matchable` — 자유 글 번호로 남의 숨은 글을 맞혀 보지 못하게).

### 12.18 업무 규칙 거절 `errors.raise_rule(status, code, **context)`

검사: `test_invariants.py` — SOP 코드의 `HTTPException`은 `errors.py`에만.

- `detail={"code", ...문맥}` 모양 하나(입력 형식 오류만 422 `{"detail": [{type, loc, msg}]}` — `main.handle_validation_error`가 `input`·`ctx`를 빼 요청 원문이 응답·로그로 되돌아가지 않게 한다).
- revision 충돌은 `check_revision`이 409 `revision_conflict`와 `conflicts[].current_revision`으로 낸다.
- `app/sop`·`routers/sop_*`에서 `HTTPException`을 직접 던지지 않는다.

### 12.19 결과물 `outputs.py`

- A·B·C·요약 숫자는 스냅숏(`snapshot.py`)만 받는 순수 함수이고 보낸 곳·칸 순서·신규 판정은 한 벌이다.
- Excel·미리보기의 시트 모델(`sheet_model.py`)은 이 결과를 옮겨 쓰기만 하고(`excel_export.py`는 그 모델을 xlsx로 쓴다), 검토 조건(`review.py`)은 `outputs.build_review_facts`의 단위 재료를 쓴다 — 같은 규칙을 다시 계산하지 않는다.
- 결과물은 한 벌이고(`?lang=`은 라벨 언어만) 옛 쪽 줄은 `output_rows.build_meaning_rows` 하나, 미리보기와 xlsx는 같은 시트 모델이라 칸 글·모양 판정은 `sheet_model.py`에만 둔다(쓰는 쪽에서 새로 정하면 미리보기와 파일이 어긋난다).
- 섹션 번호 규칙 `outputs.number_lines`는 프런트 `section-number.numberLines`가 C 순서 바꾸기의 미리 세기에 사본으로 쓰고(직접 놓인 줄을 세지 않는 칸은 문서 골격 사본이 정한다 — `outline.DocOutline.counts_lines` 한 곳, 프런트는 절 응답의 `counts_lines`를 읽을 뿐 다시 정하지 않는다).
- 새로 놓이는 짝·번역의 기본 표시·순서(O10)는 `target_placement.arrange_new_targets` 하나를 저장(`decisions`)과 AI 분류(`classify`)가 함께 쓴다 — 규칙을 바꾸면 함께 고친다.
- 저장의 자리 받기(`TargetIn.position`, 문장 사이에 놓기)는 문서를 지금 보이는 순서로 굳힌 뒤(`target_placement.freeze_order` — 라우터가 되돌리기 단계 밖에서 불러 되돌려도 굳힌 순서는 남는다) 그 자리에 끼우고, 한 자리에 여럿이면 `arrange_new_targets` 순서(짝은 영어 먼저)다.
- Excel의 모든 글 칸은 `write_text_cell` 하나로 쓴다(수식 방지).

## 13. SOP 데모·E2E는 한 벌의 몰이를 쓴다

- `backend/scripts/sop_demo_driver.py`(API로 업로드→편집→배정→검토까지 모는 쪽)를 E2E 테스트(`tests/test_sop_e2e.py`)와 데모 시드(`scripts/seed_sop_demo.py`)가 함께 쓴다.
- 정답은 합성 생성기 `scripts/synthetic_sop.py`가 만드는 `SYNTHETIC_expected.json`(모든 합성 파일 이름은 `SYNTHETIC_`로 시작)이다.
- SOP API 모양이나 규칙을 바꾸면 드라이버·생성기 정답과 두 소비자를 함께 확인한다.
- AI 경로는 `tests/fake_ai.py`의 `SyntheticAnswers`가 같은 정답으로 답한다(단순한 답은 정답, 합침·중복 배정·표·외부 이동은 무효 응답으로 사람 경로) — 합성 검증이고 실제 모델 연결이 아니다.
- 시드 명령은 루트 CLAUDE.md Commands·`docs/qa/verification-commands.md`(로컬 전용, 운영 DB 금지).
