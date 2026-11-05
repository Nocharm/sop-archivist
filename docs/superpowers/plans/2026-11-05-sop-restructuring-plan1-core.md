# SOP 재구성 계획 1: 결정적 코어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 없이 사람이 API만으로 두 입구를 끝까지(업로드 → 쪼개기 → To-Be → 배정·짝 맞추기 → 결과물 A·B·C → Excel → 검토 완료) 처리할 수 있는 백엔드를 만들고 `v0.2.0`으로 낸다.

**Architecture:** 제품 코드는 `backend/app/sop/` 패키지(순수 함수 모듈과 DB 서비스 모듈)와 `backend/app/routers/sop_*.py` 라우터다. 파일 파싱은 spawn 자식 프로세스에서 시간 제한을 걸고 돌리고, 결과물은 한 번에 읽은 스냅샷 dataclass 위의 순수 함수로 계산한다. 스키마는 Alembic 리비전 `0005` 하나에 모두 담는다.

**Tech Stack:** 기존(Python 3.11 · FastAPI 0.136.3 · SQLAlchemy 2.0.50 async · Alembic 1.20.1 · pytest 9.0.3 · ruff 0.15.16) + 새 운영 의존성 `python-multipart==0.0.33` · `defusedxml==0.7.1` · `pdfminer.six==20260107` · `markitdown[docx,pdf]==0.1.9` · `openpyxl==3.1.5` · `pillow==13.0.0`, 개발 의존성 `python-docx==1.2.0`.

**Spec:** `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md` (도메인 기준 `docs/domain/restructuring-rules.md`·`restructuring-cases.md`). 이 계획은 스펙 §14의 **계획 1**만 다룬다. AI 작업·임베딩·지침 버전·번역·채택률은 계획 2다.

## Global Constraints

- 작업 위치 `/Users/hyeonjin/Documents/sop-archivist`(브랜치 `feat/sop-archivist`). 태스크마다 커밋 뒤 `git push sop-archivist HEAD:main`. force push 금지.
- 배포 런타임 Python 3.11(`backend/ruff.toml` `target-version = "py311"`). 3.12 문법 금지.
- 모델 변경은 Alembic 리비전. 이 계획의 스키마는 Task 2의 `0005` 하나다. 이후 태스크가 컬럼을 바꿔야 하면 `--rev-id 0006`부터 새 리비전을 만든다(0005 수정 금지).
- 시각 컬럼 `DateTime(timezone=True)`, 기본값·현재 시각은 `app.clock.now()`(KST). 응답의 시각은 `app/routers/admin.py`의 `KstDatetime`처럼 KST 오프셋으로 맞춘다.
- 새 env는 `backend/app/settings.py` · `.env.example` · `docker-compose.yml` backend `environment:` 세 곳(int는 compose에 Settings 기본값과 같은 폴백).
- 새 권한 키는 backend `catalog.py` · frontend `src/lib/access.ts` · i18n en/ko를 한 커밋에서(Task 1에서 끝낸다).
- 애플리케이션 로그(stdout)에 원문 글자·파일 이름·인증값을 남기지 않는다. ID·건수·상태 코드·예외 클래스 이름만.
- 외부 서비스 호출 금지. MarkItDown은 DOCX·PDF 변환기만 쓰고 플러그인·LLM·URL·Document Intelligence를 켜지 않는다.
- 업무 규칙 거절은 `HTTPException(status_code, detail={"code": "<snake_case>", ...문맥})`(아래 "공용 계약"). 입력 형식 오류는 FastAPI 기본 422 그대로.
- 원문 불변: `source_blocks.text`와 원본 파일 바이트는 만든 뒤 바꾸지 않는다. Excel 출력에서만 XML에 못 쓰는 문자를 바꾼다(Task 16).
- 합성 데이터는 파일 이름·문서 속성·묶음 플래그에 합성 표시를 하고, 실제 SOP 문장을 쓰지 않는다.
- 프런트는 Task 1의 권한 미러 외에 건드리지 않는다.
- 이름은 동사로 시작(`rules/common/naming.md`), 모듈 첫 줄 docstring, 주석은 기존 코드처럼 한국어로 "왜"만.
- 커밋 `type(scope): English summary — 한국어 요약` + 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`·`Claude-Session: https://claude.ai/code/session_01T4sqoWoGcxKzpMpvsupvDq`. 커밋마다 `PROGRESS.md`에 1–3줄. `git add <파일>`로 명시 스테이징.
- 검증 명령(`backend/`에서): `.venv/bin/python -m pytest tests/ -q` 전체 초록 + `.venv/bin/ruff check app/ tests/ scripts/`. 태스크 안에서는 해당 테스트 파일만 먼저 돌리고 커밋 전에 전체를 돌린다.

## Review Focus

1. **실제 Word가 만든 DOCX의 감싸는 요소**(`w:hyperlink`·`w:sdt`·`w:smartTag`·`w:fldSimple`·`w:customXml` 안의 글자, `w:tab`·`w:br`·`w:cr`·`w:noBreakHyphen`) → 글자가 빠지지 않고 원문 순서대로 블록에 들어간다. `w:moveFrom`·`w:moveTo`도 변경 추적으로 거절한다. 테스트: Task 5 `test_docx_keeps_text_inside_wrappers`, `test_docx_rejects_move_tracking`.
2. **XML에 못 쓰는 제어 문자**(`\x0b`·`\x07` 등, PDF 추출이나 붙여 넣은 글에서 나온다)와 `=`로 시작하는 원문 → Excel 저장이 실패하지 않고, 수식이 되지 않으며, 제어 문자만 `�`로 바뀐다. 테스트: Task 16 `test_export_survives_control_chars_and_formula_text`.
3. **보이지 않는 글자**(`​`·`﻿`·` `·`　`) → 쪼개기와 커버리지 검사가 같은 "빈 글자" 판정을 써서, 그런 글자만 있는 블록이 단위 없이 남아도 커버리지 오류가 아니고 단위 끝에 붙지도 않는다. 테스트: Task 9 `test_invisible_chars_follow_one_blank_rule`.
4. **두 작성자의 동시 저장**: 관계 묶음 저장 중 한 대상의 `revision`만 낡았을 때 → 409이고 묶음의 어느 행도 바뀌지 않는다(부분 쓰기 없음). 테스트: Task 11 `test_group_save_with_one_stale_revision_changes_nothing`.
5. **큰 묶음의 결과물·목록 조회**: 단위 2,000개 묶음에서 결과물 A와 단위 목록이 단위 수에 비례하는 쿼리를 내지 않는다(N+1 금지). 테스트: Task 15 `test_outputs_use_bounded_queries`.

## 이 계획 밖 (계획 2)

AI 작업 실행기와 세션 분리, 임베딩·캐시, 지침·프롬프트 버전과 시드·`guideline.manage` 라우트, 분류·고쳐 쓰기·번역·입구 2 짝 제안·한/영 짝 제안·복합 문장 나누기 제안, AI 제안 기록과 채택률, LLM 입력용 표 Markdown(메인 칸 격자에서 만든다), 결과물 A의 번역 줄, 짝 없는 옛 단위의 삭제 후보 표시, 가짜 AI 서버 확장. 계획 1은 이들의 자리(`ai_text` 컬럼, `ai_suggested` 상태, `translated` 변경 종류)만 둔다.

---

## 공용 계약

### 오류 모양

```python
# app/sop/errors.py
def raise_rule(status_code: int, code: str, **context: object) -> NoReturn:
    """업무 규칙 거절 — detail={"code": code, **context}."""

def check_revision(entity: str, entity_id: int, expected: int, actual: int) -> None:
    """다르면 409 detail={"code": "revision_conflict", "conflicts": [{"entity", "id", "current_revision"}]}."""
```

여러 대상을 한 번에 검사하는 요청(관계 묶음 저장 등)은 낡은 대상을 모두 모아 `conflicts` 목록 하나로 409를 낸다. 화면은 409를 받으면 그 대상을 다시 읽는다(스펙 §6.13의 "현재 상태"는 `current_revision`과 재조회로 갈음한다).

자주 쓰는 코드: `bundle_not_found`(404, 멤버가 아닌 사람에게도 같은 404), `inactive_account`(403), `role_required`(403), `bundle_not_editable`(409), `revision_conflict`(409), `confirm_required`(409), `duplicate_file`(409).

### 멤버십

- 묶음 하위 경로는 모두 `require_bundle_role(...)` 의존성을 거친다. 요청 사용자의 `employees` 행이 없거나 `active=false`면 403 `inactive_account`. 멤버가 아니면 404 `bundle_not_found`. 역할이 다르면 403 `role_required`. **sysadmin도 멤버가 아니면 404**다(스펙 §9).
- 권한 판정(`bundle.create`·`bundle.admin`)은 기존 `require_permission` 하나로 한다. dev 모드에서 권한 강제가 꺼져 있어도 멤버십 검사는 항상 한다.
- 변경 요청은 `ensure_editable(bundle)`로 `in_progress`일 때만 받는다.

### revision 범위 (스펙 §6.13)

| 대상 | 올리는 변경 |
|---|---|
| `bundles.revision` | 제목·설명, 멤버, To-Be 목록(쓰기·가져오기·N/A·단계), 결과물 C 순서, 의미 검토 확인, 상태 전이 |
| `documents.revision` | 문서 정보·언어 배치, 쪼개기 편집·되돌리기·다시 하기, 짝 만들기·확정·풀기, 레이아웃 표 바꾸기 |
| `unit_decisions.revision`, `target_sentences.revision` | 관계 묶음 저장, 일괄 처분, 배정 지우기, 떼어 내기(detach)로 생긴 변경 |

### 코드 값 (`app/sop/constants.py`)

```python
BUNDLE_STATUSES = ("in_progress", "in_review", "done")
MEMBER_ROLES = ("author", "reviewer")
DOC_SIDES = ("old", "new")
DOC_STATUSES = ("ready", "rejected", "failed")
LANGUAGE_LAYOUTS = ("ko_en_interleaved", "ko_en_separate", "en_only", "ko_only")
BLOCK_PARTS = ("body", "header", "footer", "footnote", "endnote", "textbox")
BLOCK_KINDS = ("paragraph", "table_cell", "figure")
UNIT_KINDS = ("sentence", "heading", "figure", "table", "table_row", "cell_sentence")
COVER_KINDS = ("sentence", "heading", "figure", "cell_sentence")
LANGS = ("ko", "en", "neutral")
DISPOSITIONS = ("unassigned", "assigned", "delete", "move_external")
STATUSES = ("unassigned", "ai_suggested", "confirmed", "on_hold")
TARGET_KINDS = ("sentence", "table", "figure")
ORIGINS = ("units", "translation", "new_doc")
CHANGE_TYPES = ("as_is", "tone", "rewritten", "split", "merged", "translated", "deleted", "new", "table_restructured")
TARGET_DOC_TYPES = ("sop", "wi")
ENTRANCES = ("assign", "match")
WI_PARTS = ("instruction", "why")
SLOT_KEYS = (
    "purpose", "scope", "definitions", "responsibilities",
    "general_requirements", "general_requirements.safety", "general_requirements.operation",
    "procedures", "procedures.procedure", "procedures.electronic_record_control",
    "procedures.troubleshooting", "procedures.maintenance",
    "document_relationships", "document_relationships.attachments", "document_relationships.appendices",
)
EQUIPMENT_SLOT_KEYS = ("procedures.electronic_record_control", "procedures.troubleshooting", "procedures.maintenance")
SEMANTIC_CHECK_KEYS = ("numbers", "conditions", "tables", "figures")
SYSTEM_HOLD_RELATED_CHANGED = "system:related_unit_changed"  # 화면은 "관련 단위가 바뀜"으로 보인다
MAX_PAIR_SIDE = 3  # 한/영 짝 한쪽 최대 단위 수(작은 다대다)
```

변경 종류 코드 ↔ 스펙 이름: `as_is` 그대로, `tone` 말투, `rewritten` 고쳐 씀, `split` 나눔, `merged` 합침, `translated` 번역, `deleted` 삭제, `new` 신규, `table_restructured` 표 구성 변경.

### 스키마 (Task 2가 만든다)

FK의 `ondelete`는 괄호 안. `bundle_id`를 가진 모든 표는 묶음 삭제에 CASCADE로 따라 지워진다.

```text
bundles             id PK · title S200 · description Text="" · status S20="in_progress" CHECK(BUNDLE_STATUSES)
                    · is_synthetic Bool=False · semantic_checks JSON={} · revision Int=1
                    · created_by S100 · created_at · updated_at
bundle_members      bundle_id FK bundles(CASCADE) PK · login_id S100 PK · role S10 CHECK(MEMBER_ROLES)
                    · added_by S100 · added_at
bundle_events       id PK · bundle_id FK(CASCADE) idx · occurred_at idx · actor S100 · action S40
                    · target_type S30="" · target_ids JSON=[] · reason Text=""
bundle_deletion_records  id PK · bundle_id Int(FK 없음) · title S200 · actor S100 · occurred_at
target_docs         id PK · bundle_id FK(CASCADE) idx · code S100 · title S500="" · doc_type S3
                    · parent_id FK target_docs(RESTRICT) null · entrance S6 · is_equipment_sop Bool=False
                    · order_index Int=0 · manual_order Bool=False · UNIQUE(bundle_id, code)
target_doc_na_slots target_doc_id FK(CASCADE) PK · slot_key S100 PK · reason Text · set_by S100 · set_at
wi_steps            target_doc_id FK(CASCADE) PK · step_no Int PK · title S500=""
documents           id PK · bundle_id FK(CASCADE) idx · side S3 · file_name S255 · file_format S4
                    · size_bytes Int · sha256 S64 · doc_code S100="" · doc_version S50="" · title S500=""
                    · language_layout S20="ko_en_interleaved" · status S10 · status_reason S40=""
                    · target_doc_id FK target_docs(SET NULL) null UNIQUE · revision Int=1
                    · uploaded_by S100 · uploaded_at · UNIQUE(bundle_id, sha256)
document_files      document_id FK(CASCADE) PK · content LargeBinary
extractions         id PK · document_id FK(CASCADE) idx · extractor_version S20 · created_at
                    · aux_status S10 · aux_detail S100=""
source_tables       id PK · extraction_id FK(CASCADE) idx · table_index Int · parent_table_id FK source_tables(CASCADE) null
                    · part S10 · xml_path S500 · n_rows Int · n_cols Int · is_layout Bool=False
source_blocks       id PK · extraction_id FK(CASCADE) idx · seq Int · part S10 · kind S12 · text Text
                    · xml_path S500 · page Int null · page_basis S10 · section_label S200=""
                    · heading_level Int null · table_id FK source_tables(CASCADE) null · row_index Int null
                    · col_index Int null · grid_span Int=1 · row_span Int=1 · image_part S200 null · flags JSON=[]
extraction_warnings id PK · extraction_id FK(CASCADE) idx · kind S20 · block_id FK source_blocks(CASCADE) null
                    · detail JSON={} · needs_ack Bool · acked_by S100 null · acked_at null · ack_note Text=""
units               id PK · extraction_id FK(CASCADE) idx · local_no Int · kind S14 · spans JSON · text Text
                    · lang S7 · table_id FK source_tables(CASCADE) null · row_index Int null
                    · group_unit_id FK units(SET NULL) null · status S8="active" · boundary_confirmed Bool=False
                    · pos_seq Int · pos_start Int
unit_edits          id PK · document_id FK(CASCADE) idx · seq Int · op S24 · payload JSON
                    · created_unit_ids JSON=[] · retired_unit_ids JSON=[] · regrouped JSON={}
                    · lang_changes JSON={} · layout_changes JSON={} · state S8="applied" · actor S100 · created_at
unit_pairs          id PK · document_id FK(CASCADE) idx · status S10 · source S5 · created_at
unit_pair_members   pair_id FK unit_pairs(CASCADE) PK · unit_id FK units(CASCADE) PK UNIQUE
unit_decisions      unit_id FK units(CASCADE) PK · bundle_id FK(CASCADE) idx · disposition S14="unassigned"
                    · move_target_code S100="" · reason Text="" · status S12="unassigned" CHECK(STATUSES)
                    · hold_reason Text="" · confirmed_by S100 null · confirmed_at null · revision Int=1 · updated_at
unit_decision_history id PK · unit_id FK units(CASCADE) idx · snapshot JSON · cause S10 · actor S100 · created_at
target_sentences    id PK · bundle_id FK(CASCADE) idx · target_doc_id FK target_docs(RESTRICT) idx
                    · slot_key S100 null · wi_step Int null · wi_part S11 null · section_path Text=""
                    · order_index Int=0 · lang S7 · kind S8 · confirmed_text Text="" · ai_text Text=""
                    · change_type S20 null · origin S11 · new_unit_id FK units(CASCADE) null
                    · parent_target_id FK target_sentences(CASCADE) null · cell_row Int null · cell_col Int null
                    · grid JSON null · status S12 CHECK(STATUSES) · hold_reason Text="" · warnings JSON=[]
                    · confirmed_by S100 null · confirmed_at null · revision Int=1 · updated_at
target_sources      target_id FK target_sentences(CASCADE) PK · unit_id FK units(CASCADE) PK · seq Int
target_text_history id PK · target_id FK(CASCADE) idx · previous_text Text · changed_by S100 · changed_at
```

데이터 규칙(코드가 지킨다):
- **판단 행**은 옛 문서(`side="old"`)의 판단 가능 단위(`sentence`·`heading`·`figure`·`table`·`table_row`·`cell_sentence`)마다 단위를 만들 때 함께 만든다(미배정). 새 문서 단위에는 판단 행이 없다.
- **칸 문장**(`cell_sentence`)은 `group_unit_id`가 있으면 그 표·행 단위의 처분과 상태를 따르고, 자기 판단 행은 늘 미배정으로 둔다. `group_unit_id`가 없으면(레이아웃 표) 보통 문장처럼 자기 판단을 갖는다.
- **커버 단위의 상태** = `group_unit_id`가 있으면 그룹 단위의 판단 상태, 없으면 자기 판단 상태. 이 계산은 `app/sop/status.py` `get_cover_status(unit, decisions_by_unit_id) -> str` 하나로 한다(Task 9).
- **표 단위**(`table`·`table_row`)는 `spans=[]`이고 위치는 첫 칸 블록(`pos_start=-1`, 칸 문장보다 앞)이다. 그림 단위는 캡션 글자를 범위로 갖고, 캡션이 없으면 `spans=[]`다.
- 단위 글자 `text`는 범위 글자를 이어 붙인 것이다. 같은 블록의 범위끼리는 `" "`, 다른 블록끼리는 `"\n"`로 잇는다.
- 표시 ID `display_id(document, unit) = f"{document.doc_code or f'D{document.id}'}-{unit.local_no:03d}"`. `local_no`는 추출 안에서 1부터 늘어나기만 하고 다시 쓰지 않는다.
- 단위의 정렬 키는 (문서 순서, `pos_seq`, `pos_start`, `id`)다. 문서 순서는 옛 문서 먼저, 같은 쪽 안에서는 `documents.id` 순서다.

### 테스트 공용

- `tests/conftest.py`에 `clean_sop` 픽스처를 더한다: 앞뒤로 `Bundle`과 `BundleDeletionRecord` 행을 지운다(나머지는 CASCADE).
- `tests/sop_helpers.py`(Task 3에서 만들고 태스크마다 더한다): 헤더 `AUTHOR={"X-Dev-User": "qa.member"}`, `REVIEWER={"X-Dev-User": "qa.lead"}`, `OUTSIDER={"X-Dev-User": "prod.member"}`, `ADMIN={"X-Dev-User": "dev.admin"}`. 헬퍼 시그니처는 각 태스크의 Interfaces에 적었다.

---

### Task 1: 권한 키 3개 추가

**Files:**
- Modify: `backend/app/access/catalog.py`, `backend/tests/test_access_resolve.py`(카탈로그 단언), 카탈로그 전체를 나열하는 다른 테스트(`git grep -n "system.view\"\]\|frozenset(PERMISSIONS)" backend/tests`로 찾는다)
- Modify: `frontend/src/lib/access.ts`, `frontend/src/lib/access.test.ts`, `frontend/src/lib/i18n-messages.ts`, `frontend/src/lib/i18n-messages.test.ts`

**Interfaces:**
- Produces: 권한 키 `bundle.create`, `bundle.admin`, `guideline.manage`(Task 3이 `require_permission`으로 쓴다). frontend `ADMIN_TAB_PERMISSIONS`.

- [ ] **Step 1: 실패하는 테스트**

```python
# backend/tests/test_access_resolve.py
assert PERMISSIONS == ("permission.manage", "directory.sync", "ai.admin", "system.view",
                       "bundle.create", "bundle.admin", "guideline.manage")
```

```ts
// access.test.ts
expect(PERMISSIONS).toEqual(["permission.manage", "directory.sync", "ai.admin", "system.view",
  "bundle.create", "bundle.admin", "guideline.manage"]);
expect(canSeeAdmin({ ...BASE_ME, permissions: ["bundle.create"] })).toBe(false); // 관리 탭이 없는 키는 관리 화면을 열지 않는다
// i18n-messages.test.ts: 라벨 표에 세 줄 추가
"permission.bundle.create": ["Create bundles", "묶음 만들기"],
"permission.bundle.admin": ["Manage all bundles", "전체 묶음 관리"],
"permission.guideline.manage": ["Manage AI guidelines", "AI 지침 관리"],
```

- [ ] **Step 2: 실패 확인** — `cd backend && .venv/bin/python -m pytest tests/test_access_resolve.py -q`, `cd frontend && npx vitest run src/lib/access.test.ts src/lib/i18n-messages.test.ts` → FAIL.
- [ ] **Step 3: 구현** — 두 `PERMISSIONS`에 세 키를 이 순서로 덧붙인다. `access.ts`에 `ADMIN_TAB_PERMISSIONS`(기존 4개)를 두고 `canSeeAdmin`은 그것만 본다(묶음 관리·지침 관리 탭은 프런트 단계에서 생긴다). i18n en/ko에 라벨을 넣는다. `catalog.py` 머리 주석의 "SOP 권한은 제품 단계에서 추가"를 지금 상태로 고친다.
- [ ] **Step 4: 통과 확인** — backend 전체 pytest, frontend `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`.
- [ ] **Step 5: 커밋** — `feat(access): add bundle and guideline permission keys — 묶음·지침 권한 키 추가`

---

### Task 2: SOP 스키마와 리비전 0005

**Files:**
- Create: `backend/app/sop/__init__.py`, `backend/app/sop/constants.py`, `backend/app/sop/models.py`, `backend/alembic/versions/0005_sop_core.py`, `backend/tests/test_sop_schema.py`
- Modify: `backend/app/db.py`, `backend/alembic/env.py`(둘 다 `import app.sop.models  # noqa: F401` — 메타데이터 등록), `backend/tests/conftest.py`(`clean_sop`)

**Interfaces:**
- Produces: 위 "스키마"의 ORM 클래스 `Bundle`, `BundleMember`, `BundleEvent`, `BundleDeletionRecord`, `TargetDoc`, `TargetDocNaSlot`, `WiStep`, `Document`, `DocumentFile`, `Extraction`, `SourceTable`, `SourceBlock`, `ExtractionWarning`, `Unit`, `UnitEdit`, `UnitPair`, `UnitPairMember`, `UnitDecision`, `UnitDecisionHistory`, `TargetSentence`, `TargetSource`, `TargetTextHistory`(모두 `app.sop.models`). 상수는 "코드 값" 그대로.

- [ ] **Step 1: 실패하는 테스트** — `test_sop_schema.py`는 `test_migrations.py`처럼 임시 sqlite에 `run_migrations` 후 FK를 켠 동기 엔진으로 직접 INSERT한다.
  - `test_status_checks_reject_unknown_values`: `bundles.status='archived'`, `bundle_members.role='owner'`, `unit_decisions.status='done'`, `target_sentences.status='done'` 각각 `IntegrityError`.
  - `test_unique_constraints`: 같은 묶음에 같은 `sha256` 문서 두 번, 같은 `code` 새 문서 두 번, 한 단위를 두 짝에 넣기 → 각각 `IntegrityError`.
  - `test_bundle_delete_cascades`: 묶음 1·멤버 1·문서 1·추출 1·블록 1·단위 1·판단 1·새 문서 1·새 문장 1·출처 1을 넣고 묶음을 지우면 그 표들의 행 수가 모두 0.
  - `test_check_constraint_names`: `inspect(engine).get_check_constraints("unit_decisions")` 이름 집합에 `ck_unit_decisions_status`.
- [ ] **Step 2: 실패 확인** — `pytest tests/test_sop_schema.py -q` → FAIL(테이블 없음).
- [ ] **Step 3: 구현** — 상수·모델을 쓰고 `cd backend && .venv/bin/alembic revision --autogenerate --rev-id 0005 -m "sop core"`로 리비전을 만든 뒤 파일 이름을 `0005_sop_core.py`로 맞추고, 생성 결과를 스키마 표와 대조해 고친다(CHECK는 autogenerate가 빠뜨리므로 손으로 넣는다, 제약 이름은 `NAMING_CONVENTION`을 따른다). 자기 참조 FK(`units.group_unit_id`, `target_docs.parent_id`, `source_tables.parent_table_id`, `target_sentences.parent_target_id`)는 `use_alter` 없이 같은 `create_table` 안에 둔다.
- [ ] **Step 4: 통과 확인** — `pytest tests/test_sop_schema.py tests/test_migrations.py -q`(모델↔리비전 일치·downgrade 왕복 포함) → PASS, 전체 pytest.
- [ ] **Step 5: 커밋** — `feat(sop): add the restructuring schema as revision 0005 — SOP 재구성 스키마 0005`

---

### Task 3: 묶음·멤버·작업 기록·묶음 관리

**Files:**
- Create: `backend/app/sop/errors.py`, `backend/app/sop/membership.py`, `backend/app/sop/events.py`, `backend/app/routers/sop_bundles.py`, `backend/app/routers/sop_admin.py`, `backend/tests/sop_helpers.py`, `backend/tests/test_sop_bundles.py`
- Modify: `backend/app/main.py`(라우터 등록)

**Interfaces:**
- Produces:
  - `errors.raise_rule`, `errors.check_revision`(공용 계약)
  - `membership.BundleContext(bundle: Bundle, login_id: str, role: str)`(frozen dataclass), `membership.require_bundle_role(*roles: str) -> Callable[..., Awaitable[BundleContext]]`(경로 변수 이름 `bundle_id`), `membership.ensure_editable(bundle: Bundle) -> None`
  - `events.record_event(session, *, bundle_id: int, actor: str, action: str, target_type: str = "", target_ids: Sequence[int | str] = (), reason: str = "") -> None`(행만 추가, 커밋은 호출부)
  - 테스트 헬퍼 `create_bundle(client, *, title="Bundle", headers=AUTHOR, is_synthetic=False) -> dict`, `get_bundle(client, bundle_id, headers=AUTHOR) -> dict`, `set_members(client, bundle_id, members: list[tuple[str, str]], headers=AUTHOR) -> Response`(현재 revision을 읽어 보낸다)
- 엔드포인트:

| 경로 | 권한 | 동작 |
|---|---|---|
| `GET /api/bundles` | 로그인 | 내가 멤버인 묶음 `[BundleListItem]`(id, title, status, my_role, updated_at) |
| `POST /api/bundles` | `bundle.create` | `{title(1–200), description?, is_synthetic?}` → 201 `BundleOut`, 만든 사람이 작성자 |
| `GET /api/bundles/{bundle_id}` | 멤버 | `BundleOut`(필드 + `my_role` + `members[{login_id, role, name, korean_name, active}]`) |
| `PATCH /api/bundles/{bundle_id}` | 작성자·작업 중 | `{revision, title?, description?}` |
| `DELETE /api/bundles/{bundle_id}?revision=` | 작성자·작업 중 | 204, `bundle_deletion_records`에 한 행 |
| `PUT /api/bundles/{bundle_id}/members` | 작성자 | `{revision, members[{login_id, role}]}` 통째 바꾸기 |
| `GET /api/bundles/{bundle_id}/events?limit=100` | 멤버 | 최신순 기록 |
| `GET /api/admin/bundles` | `bundle.admin` | `[{id, title, status, members, has_active_author, created_at}]` — 내용 없음 |
| `PUT /api/admin/bundles/{bundle_id}/members` | `bundle.admin` | 위 멤버 바꾸기와 같은 본문·검사, 기록 `reason="admin"` |

멤버 바꾸기 검사: `login_id` 중복이면 422 `duplicate_member`, `employees`에 없거나 퇴직자면 422 `unknown_member`, 활성 작성자가 0명이면 422 `no_active_author`. 상태와 무관하게 멤버는 바꿀 수 있다(검토 대기 중 검토자 추가). 기록 action: `bundle.create`·`bundle.update`·`bundle.members`.

- [ ] **Step 1: 실패하는 테스트**(`clean_sop` 사용)
  - `test_create_bundle_makes_creator_author`: `create_bundle` → `my_role == "author"`, `members == [{"login_id": "qa.member", "role": "author", ...}]`, `status == "in_progress"`, `revision == 1`.
  - `test_non_member_gets_404_even_sysadmin`: `monkeypatch` `settings.app_sysadmins="dev.admin"` 상태에서 `ADMIN`으로 GET → 404 `{"detail": {"code": "bundle_not_found"}}`. `OUTSIDER`도 404.
  - `test_retired_member_is_blocked`(`clean_directory`): `REVIEWER`를 멤버로 넣은 뒤 `update_row(Employee, "qa.lead", active=False)` → GET 403 `inactive_account`.
  - `test_reviewer_cannot_patch`: 403 `role_required`.
  - `test_patch_with_stale_revision_conflicts`: 409, `detail["conflicts"][0] == {"entity": "bundle", "id": id, "current_revision": 2}`(먼저 한 번 고친 뒤).
  - `test_members_rules`: 작성자 0명 → 422 `no_active_author`, 모르는 사람 → 422 `unknown_member`, 같은 사람 두 역할 → 422 `duplicate_member`.
  - `test_delete_records_global_trace`: 삭제 204 뒤 `BundleDeletionRecord` 한 행(`title`, `actor="qa.member"`)이고 GET은 404.
  - `test_create_requires_permission`(`enforce`): 권한 없는 `prod.member` → 403 `missing permission: bundle.create`.
  - `test_admin_list_shows_meta_and_orphans`(`demo_access` + `clean_directory`): 묶음은 권한 강제를 켜기 **전에** 만들고, 그다음 `monkeypatch.setattr(settings, "dev_enforce_permissions", True)`와 `add_grant("user", "ops.member", permission="bundle.admin")`. 작성자 퇴직 처리 뒤 목록 행 `has_active_author is False`, 응답에 문서·문장 필드 없음. 관리자가 자기를 멤버로 넣으면 이벤트 `reason == "admin"`.
  - `test_events_list_newest_first`.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — `require_bundle_role`은 `get_current_user`·`get_session`을 쓰고 묶음·멤버·직원 행을 한 번씩 읽는다. `/api/admin/bundles` 라우터는 각 엔드포인트의 첫 의존성으로 `require_permission("bundle.admin")`을 걸어 경로 변수가 아무 값이어도 403이 먼저 나게 한다(`test_admin_ops`의 전 라우트 순회가 자동으로 확인한다). 상태 변경마다 `bundles.revision += 1`.
- [ ] **Step 4: 통과 확인** — `pytest tests/test_sop_bundles.py tests/test_admin_ops.py -q` → PASS, 전체.
- [ ] **Step 5: 커밋** — `feat(sop): add bundles, membership and the activity log — 묶음·멤버십·작업 기록`

---

### Task 4: To-Be 목록과 Excel 가져오기

**Files:**
- Create: `backend/app/sop/tobe.py`, `backend/app/sop/tobe_excel.py`, `backend/app/routers/sop_tobe.py`, `backend/tests/test_sop_tobe.py`
- Modify: `backend/requirements.txt`(`openpyxl==3.1.5`, `python-multipart==0.0.33`), `backend/app/main.py`, `backend/tests/sop_helpers.py`

**Interfaces:**
- Consumes: Task 3 멤버십·오류·기록.
- Produces:
  - 스키마 `TargetDocIn{code(1–100), title(≤500), doc_type, parent_code?, is_equipment_sop=False, order_index=0}`, `NaSlotIn{code, slot_key, reason(1–2000)}`, `WiStepIn{code, step_no(≥1), title=""}`, `ToBeIn{revision, docs, na_slots, wi_steps}`, `ToBeOut{revision, docs[{id, code, title, doc_type, parent_code, entrance, is_equipment_sop, order_index, document_id}], na_slots, wi_steps}`
  - `tobe.apply_tobe(session, bundle: Bundle, payload: ToBeIn | ParsedWorkbook, *, actor: str, source: Literal["api", "excel"]) -> None` — 검사와 저장을 한곳에서 한다(API·Excel 공용).
  - `tobe.count_targets_in(session, target_doc_ids) -> dict[int, int]` 같은 질의 헬퍼(빌더 재량)
  - 테스트 헬퍼 `put_tobe(client, bundle_id, docs: list[dict], *, na_slots=(), wi_steps=(), headers=AUTHOR) -> Response`
- 엔드포인트: `GET /api/bundles/{bundle_id}/tobe`(멤버), `PUT …/tobe`(작성자·작업 중), `GET …/tobe/template.xlsx`(멤버), `POST …/tobe/import`(작성자·작업 중, multipart `file`, form `revision`).

검사 규칙(위반 시 422, `detail.code`):
- `duplicate_code`, `invalid_doc_type`, WI에 부모 없음·부모가 목록의 SOP가 아님 `invalid_parent`, SOP에 부모 `invalid_parent`, WI에 `is_equipment_sop=true` `equipment_flag_on_wi`.
- N/A: 칸 키가 `SLOT_KEYS` 밖 `unknown_slot`, SOP가 아님 `na_on_wi`, 그 칸에 새 문장이 있음 `slot_has_targets`(409).
- WI 단계: SOP에 단계 `steps_on_sop`, 같은 번호 두 번 `duplicate_step`, 새 문장이 든 단계를 빼기 `step_has_targets`(409).
- 입구: `PUT`·가져오기는 `assign` 문서만 만들고 고친다. `match` 문서(문서 업로드가 만든 것)는 목록에 그대로 실어 보내야 하고 입구·종류를 바꿀 수 없다 `match_doc_locked`(409). 목록에서 빠진 `match` 문서는 지우지 않는다(문서 삭제로만 지운다).
- 빠진 `assign` 문서에 새 문장이 있으면 409 `doc_has_targets`, 새 문장이 있는 문서의 종류 SOP↔WI 변경 409 `doc_has_targets`. 기존 코드는 같은 `id`를 유지한다(코드 기준으로 합친다).

Excel(`tobe_excel.py`):
- `build_tobe_template(tobe: ToBeOut) -> bytes`: 시트 `새 문서`(머리 `문서 번호`·`제목`·`종류`·`부모 SOP 번호`·`장비 SOP 여부`), `WI 단계`(`WI 번호`·`단계 번호`·`단계 제목`). 현재 `assign` 목록으로 채워 내려 준다(왕복 가능).
- `parse_tobe_workbook(data: bytes) -> ParsedWorkbook`: `load_workbook(BytesIO(data), read_only=True, data_only=True)`(수식은 저장된 값만). 파일 5 MiB·행 2,000 초과 422 `tobe_file_too_large`. 머리 줄이 다르면 422 `invalid_tobe_file{sheet}`. `종류`는 대소문자 무시 `SOP`|`WI`, `장비 SOP 여부`는 `Y`·`예`·`TRUE`·`1` → 참, 빈 칸·`N`·`아니오`·`FALSE`·`0` → 거짓, 그 밖은 422 `invalid_tobe_file{sheet, row, column}`. 숫자 셀로 읽힌 문서 번호는 정수면 `str(int(v))`.
- 가져오기는 N/A를 건드리지 않고, 파일에 나온 WI의 단계는 파일 내용으로 바꾼다.

- [ ] **Step 1: 실패하는 테스트**
  - `test_put_and_get_tobe_roundtrip`: SOP 1(`SOP-NEW`, 장비) + WI 2(`WI-01`·`WI-02`, 부모 `SOP-NEW`) + N/A(`SOP-NEW`, `procedures.troubleshooting`) + 단계(`WI-01` 1·2) → GET이 같은 내용, `revision == 2`.
  - `test_tobe_rejects_bad_lists`(parametrize): 위 규칙의 422 코드 각각.
  - `test_tobe_keeps_ids_when_merging_by_code`: 같은 코드로 제목만 바꿔 다시 PUT → `id` 그대로.
  - `test_template_roundtrip_imports_same_list`: 템플릿을 받아 그대로 가져오기 → 목록 동일.
  - `test_import_reads_values_not_formulas`: openpyxl로 `제목` 칸에 `="X"&"Y"`, 저장된 값 없음 → 제목 `""`(수식 문자열이 들어가지 않는다). 다른 칸에 값 `=SUM(1)`을 문자열 셀(`data_type="s"`)로 넣으면 그 글자 그대로.
  - `test_import_rejects_bad_cells`: `종류="Policy"` → 422 `{"code": "invalid_tobe_file", "sheet": "새 문서", "row": 2, "column": "종류"}`.
  - `test_reviewer_cannot_write_tobe`: 403.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — 새 문장 수를 세는 검사(`slot_has_targets`·`step_has_targets`·`doc_has_targets`)도 지금 넣는다(테스트는 새 문장이 생기는 Task 11에서 더한다). 기록 action `tobe.update`·`tobe.import`.
- [ ] **Step 4: 통과 확인** → PASS, 전체.
- [ ] **Step 5: 커밋** — `feat(sop): add the To-Be list API and Excel import — To-Be 목록·Excel 가져오기`

---

### Task 5: DOCX 메인 추출기

**Files:**
- Create: `backend/app/sop/extract/__init__.py`, `backend/app/sop/extract/types.py`, `backend/app/sop/extract/docx_reader.py`, `backend/tests/docx_factory.py`, `backend/tests/test_sop_docx_reader.py`
- Modify: `backend/requirements.txt`(`defusedxml==0.7.1`)

**Interfaces:**
- Produces(`extract/types.py`, 모두 frozen dataclass라 피클 가능):

```python
EXTRACTOR_VERSION = "1"

@dataclass(frozen=True)
class ExtractLimits:
    max_unzipped_bytes: int; max_zip_entries: int; max_compression_ratio: int; max_pdf_pages: int; max_chars: int

@dataclass(frozen=True)
class ExtractedTable:
    index: int; parent_index: int | None; part: str; xml_path: str; n_rows: int; n_cols: int

@dataclass(frozen=True)
class ExtractedBlock:
    seq: int; part: str; kind: str; text: str; xml_path: str; page: int | None; page_basis: str
    section_label: str; heading_level: int | None; table_index: int | None; row_index: int | None
    col_index: int | None; grid_span: int; row_span: int; image_part: str | None; flags: tuple[str, ...]

@dataclass(frozen=True)
class ExtractedWarning:
    kind: str; block_seq: int | None; detail: dict[str, str]

@dataclass(frozen=True)
class ExtractResult:
    blocks: tuple[ExtractedBlock, ...]; tables: tuple[ExtractedTable, ...]; warnings: tuple[ExtractedWarning, ...]

class ExtractionRejected(Exception):
    """code: not_a_zip_or_encrypted | unsafe_zip | invalid_format | tracked_changes | alt_chunk
    | too_many_chars | empty_document | encrypted_pdf | scanned_pdf | too_many_pages"""
    code: str
```

- `docx_reader.read_docx(data: bytes, limits: ExtractLimits) -> ExtractResult`(순수, `ExtractionRejected`를 던진다)
- 테스트 팩토리 `tests/docx_factory.py`: `build_docx(body_xml: str, *, headers: Sequence[str] = (), footers: Sequence[str] = (), footnotes: Sequence[str] = (), media: Mapping[str, bytes] = {}) -> bytes`(최소 DOCX zip: `[Content_Types].xml`, rels, `word/document.xml`, `Heading1`·`Heading2`·`Caption` 스타일만 있는 `styles.xml`), 조각 헬퍼 `p(text, style=None) -> str`, `tbl(rows: list[list[str]]) -> str`.

추출 규칙(스펙 §7.2 + 결정):
- 거절 순서: OLE 서명(`D0 CF 11 E0`) 또는 ZIP 아님 → `not_a_zip_or_encrypted`. 항목 수 > `max_zip_entries`, 압축 해제 합계 > `max_unzipped_bytes`, 압축 해제 1 MiB 이상인 항목의 비율 > `max_compression_ratio`, 이름에 `..`·절대 경로 → `unsafe_zip`. `word/document.xml` 없음 → `invalid_format`. 본문·머리말·꼬리말·각주·미주 어디든 `w:ins`·`w:del`·`w:moveFrom`·`w:moveTo` → `tracked_changes`. `w:altChunk` → `alt_chunk`. 글자 합계 > `max_chars` → `too_many_chars`. 빈 글자 아닌 글자도 그림도 없음 → `empty_document`.
- XML은 `defusedxml.ElementTree.fromstring(…, forbid_dtd=True)`.
- 부분 순서: 본문 → 머리말들 → 꼬리말들(`document.xml.rels` 관계 순서) → 각주 → 미주(`w:type`이 `separator`·`continuationSeparator`인 각주 제외). 텍스트 상자 문단은 그 상자를 담은 문단 바로 뒤에 `part="textbox"` 블록으로 내고, 담은 문단의 글자에서는 뺀다.
- 글자: `w:t` 이어 붙임, `w:tab`→`"\t"`, 쪽 나눔이 아닌 `w:br`·`w:cr`→`"\n"`, `w:noBreakHyphen`→`"-"`, `w:softHyphen`→`""`, `w:sym`→`chr(int(w:char, 16))`. `w:instrText`·`w:delText`는 읽지 않는다. `w:hyperlink`·`w:sdt`/`w:sdtContent`·`w:smartTag`·`w:customXml`·`w:fldSimple` 안으로 내려간다. `mc:AlternateContent`는 첫 `mc:Choice`만 읽는다.
- 표: `w:tc` 하나가 `table_cell` 블록 하나(칸 안 문단은 `"\n"`으로 잇는다). 열 번호는 `w:gridSpan` 누적. `w:vMerge` 이어지는 칸은 블록을 만들지 않고 시작 칸의 `row_span`을 늘린다. 병합 칸에는 `flags`에 `merged_cell`, 표마다 경고 `merged_cell` 하나. 칸 안의 표는 부모 칸 블록 뒤에 나오고 `parent_index`가 붙으며 부모 칸 글자에서 빠진다. `n_cols`는 `w:tblGrid` 열 수.
- 제목: 스타일 이름(styles.xml의 `w:name`, 대소문자 무시)이 `heading N`·`제목 N`이거나 `w:outlineLvl`이 있으면 `heading_level`. 조항 번호만 있는 줄(`^\s*\d+(\.\d+)*\.?\s*$`)은 `flags`에 `clause_number`.
- 구역 이름 `section_label`: 제목·조항 줄을 만날 때마다 갱신. 글자가 `^(\d+(\.\d+)*)\.?\s`로 시작하면 그 번호, 아니면 제목 글자(200자). 머리말·꼬리말·각주·미주는 `""`.
- 자동 번호: `w:numPr` 문단에 `flags` `auto_numbering`, 문서 경고 `auto_numbering{count}` 하나.
- 쪽: 1부터. 문서에 `w:lastRenderedPageBreak`가 하나라도 있으면 그것만 세고 `page_basis="rendered"`, 없고 `w:br w:type="page"`가 있으면 그것을 세고 `manual`, 둘 다 없으면 앞선 본문 글자 수 // 1800 + 1로 `estimated`. 본문 밖 부분은 `page=None`.
- 그림: `w:drawing`·`w:pict`·`w:object`가 든 문단 → `figure` 블록(문단에 다른 글자가 있으면 그 글자의 `paragraph` 블록이 먼저). `image_part`는 첫 `a:blip r:embed`의 관계 대상(`word/media/…`). 캡션 = 바로 다음 문단이 `Caption` 스타일이거나 `^(그림|Figure|Fig\.)\s*\d+`로 시작하면 그 글자, 아니면 바로 앞 문단이 그 조건이면 그 글자. 캡션 문단은 그림 블록의 `text`가 되고 따로 블록을 만들지 않는다.
- `xml_path`: `"{부분 파일 이름(확장자 없이)}/" + "/".join(f"{tag}[{같은 태그 형제 중 1부터 순번}]")`, 예 `document/body/tbl[2]/tr[3]/tc[1]`, `header1/p[1]`, `document/body/p[5]/txbx[1]/p[2]`.

- [ ] **Step 1: 실패하는 테스트**(모두 `build_docx`로 만든 바이트 → `read_docx`)
  - `test_docx_paragraph_order_and_parts`: 본문 2문단 + 머리말 1 + 꼬리말 1 + 각주 1 → 블록 `part` 순서 `["body","body","header","footer","footnote"]`, 글자 원문 그대로.
  - `test_docx_keeps_text_inside_wrappers`: 한 문단에 `w:hyperlink`·`w:sdt`·`w:smartTag`·`w:fldSimple` 안의 run과 `w:tab`·`w:br` → `text == "A\tB\nC D E"` 꼴로 모두 들어 있다.
  - `test_docx_skips_field_instructions`: `w:fldChar begin` + `w:instrText "PAGE"` + `separate` + `w:t "3"` + `end` → 글자에 `PAGE` 없음, `3` 있음.
  - `test_docx_textbox_once`: `mc:AlternateContent` Choice·Fallback 둘 다 같은 상자 글 → `textbox` 블록 하나, 담은 문단 글자에 상자 글 없음.
  - `test_docx_merged_cells_not_duplicated`: 2×2 표에서 위 두 칸 `gridSpan=2`, 왼쪽 열 `vMerge` → 칸 블록 3개, `grid_span`·`row_span` 값, 경고 `merged_cell` 1개.
  - `test_docx_nested_table_path`: 칸 안 표 → 바깥 칸 블록 다음에 안쪽 칸 블록, 안쪽 표 `parent_index == 0`.
  - `test_docx_headings_and_section_labels`: `Heading1 "5. 절차"` 다음 문단의 `section_label == "5"`, `"Scope"` 제목 다음 문단은 `"Scope"`, `"5.1"`만 있는 줄은 `clause_number`.
  - `test_docx_pages_rendered_manual_estimated`: 세 가지 경우 `page`·`page_basis`.
  - `test_docx_figure_with_caption`: 그림 문단 + `Caption "그림 1 로터"` → `figure` 블록 `text == "그림 1 로터"`, `image_part == "word/media/image1.png"`, 캡션 블록 따로 없음.
  - `test_docx_auto_numbering_warning`.
  - `test_docx_rejects`(parametrize): OLE 바이트·`b"not a zip"` → `not_a_zip_or_encrypted`, `w:ins`·`w:del` → `tracked_changes`, `w:altChunk` → `alt_chunk`, `../evil` 항목 → `unsafe_zip`, `max_chars=5`에 10자 → `too_many_chars`, 빈 본문 → `empty_document`.
  - `test_docx_rejects_move_tracking`: `w:moveFrom`/`w:moveTo` → `tracked_changes`.
  - `test_docx_rejects_dtd`: `<!DOCTYPE …>`가 든 `document.xml` → `invalid_format`(defusedxml 예외를 이 코드로 바꾼다).
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현** — 위 규칙대로. 네임스페이스 상수(`w`, `mc`, `wps`, `v`, `a`, `r`)를 모듈 상단에 둔다.
- [ ] **Step 4: 통과 확인** → PASS, 전체.
- [ ] **Step 5: 커밋** — `feat(sop): read DOCX into immutable source blocks — DOCX 메인 추출기`

---

### Task 6: PDF 추출기(보조 지원)

**Files:**
- Create: `backend/app/sop/extract/pdf_reader.py`, `backend/tests/pdf_factory.py`, `backend/tests/test_sop_pdf_reader.py`
- Modify: `backend/requirements.txt`(`pdfminer.six==20260107`, `pillow==13.0.0`)

**Interfaces:**
- Consumes: Task 5 `types`.
- Produces: `pdf_reader.read_pdf(data: bytes, limits: ExtractLimits) -> ExtractResult`. 테스트 팩토리 `build_text_pdf(pages: list[list[str]]) -> bytes`(Helvetica Type1, ASCII, 손으로 쓴 최소 PDF, 문단 사이는 빈 줄), `build_image_pdf() -> bytes`(Pillow 이미지를 PDF로 저장 = 글자 없는 스캔본).

규칙: `%PDF` 머리 없음 → `invalid_format`. `PDFDocument`의 `encryption`이 있으면(열리더라도) `encrypted_pdf`. 쪽 수 > `max_pdf_pages` → `too_many_pages`. 빈 글자 아닌 글자가 0 → `scanned_pdf`. 쪽마다 pdfminer 텍스트를 줄로 나눠 빈 줄(공백뿐인 줄 포함)로 문단 블록을 자른다. 블록 안 줄바꿈은 `"\n"`으로 보존하고 줄을 이어 붙이지 않는다. 블록은 `part="body"`, `kind="paragraph"`, `page=쪽 번호`, `page_basis="rendered"`, `xml_path=f"page[{n}]/block[{k}]"`. 문서 경고 `pdf_layout` 하나를 항상 붙인다. 표 구조는 만들지 않는다.

- [ ] **Step 1: 실패하는 테스트**
  - `test_pdf_blocks_split_on_blank_lines`: 1쪽 `["Line one", "line two", "", "Second para"]` → 블록 2개, 첫 블록 `text == "Line one\nline two"`, `page == 1`.
  - `test_pdf_pages_numbered`: 2쪽 → 둘째 쪽 블록 `page == 2`, `xml_path == "page[2]/block[1]"`.
  - `test_pdf_always_warns_layout`.
  - `test_pdf_rejects`(parametrize): 스캔본 → `scanned_pdf`, `max_pdf_pages=1`에 2쪽 → `too_many_pages`, `b"hello"` → `invalid_format`, 암호화 PDF(팩토리에 `/Encrypt` 사전을 넣은 변형) → `encrypted_pdf`.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(sop): read text PDFs as paragraph blocks — PDF 보조 추출기`

---

### Task 7: MarkItDown 보조 대조와 의존성 기록

**Files:**
- Create: `backend/app/sop/extract/aux_compare.py`, `backend/tests/test_sop_aux_compare.py`, `docs/qa/2026-11-sop-parse-dependencies.md`
- Modify: `backend/requirements.txt`(`markitdown[docx,pdf]==0.1.9`), `docs/README.md`(qa 행)

**Interfaces:**
- Produces:
  - `convert_with_markitdown(data: bytes, file_format: Literal["docx", "pdf"]) -> str` — `MarkItDown(enable_plugins=False)`로 스트림 변환. LLM·Document Intelligence 인자를 주지 않는다. 설치 버전의 실제 API(`convert_stream`의 인자 이름)를 확인해 쓴다.
  - `normalize_for_compare(text: str) -> str`: NFKC → 마크다운 표시 걷기(이미지 `![..](..)` 삭제, 링크 `[글](주소)` → 글, `\`로 이스케이프된 기호의 `\` 삭제, 줄 머리 `#`·`>`·`- `·`* `·`1. `, 강조 `*`·`_`·`` ` ``) → 빈 글자(Task 9 `is_blank_char`와 같은 판정) 모두 삭제.
  - `@dataclass(frozen=True) class MissingText: snippet: str; after_block_index: int | None`
  - `find_missing_text(block_texts: Sequence[str], markdown: str, *, min_chars: int = 4) -> list[MissingText]`: 마크다운을 줄로 나누고 표 줄(`|`로 시작)은 `|`로 칸을 나눈다. 정규화한 조각이 `min_chars` 이상인데 정규화한 메인 블록 전체를 이은 글자에 없으면 누락이다. `after_block_index`는 바로 앞에서 찾은 조각이 들어 있던 블록 번호(없으면 `None`). `snippet`은 원래 조각 200자.

메인 결과는 고치지 않는다(스펙 §7.3). 병합 셀을 펼친 MarkItDown 표는 포함 검사라 문제없다.

- [ ] **Step 1: 실패하는 테스트**
  - `test_find_missing_text_flags_only_absent_pieces`: 블록 `["회전 속도를 확인한다.", "Check the speed."]`, 마크다운 `"# 회전 속도를 확인한다.\n\n| Check the speed. | **숨은 글자 조각** |"` → 누락 1개 `snippet == "**숨은 글자 조각**"`, `after_block_index == 1`.
  - `test_normalize_ignores_spacing_and_markup`: `"- **A  b**\\_c"`와 `"A b_c"`의 정규화가 같다.
  - `test_short_pieces_are_ignored`: 3자 조각은 무시.
  - `test_markitdown_converts_docx_and_pdf`: Task 5·6 팩토리 문서를 변환한 글에 본문 글자가 들어 있다(실제 라이브러리 호출, 외부 네트워크 없음).
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.**
- [ ] **Step 4: 의존성·메모리 실측과 기록** — `docs/qa/2026-11-sop-parse-dependencies.md`에 적는다: `pip install` 뒤 `pip freeze`의 새 패키지 목록(magika·onnxruntime·pdfplumber·pypdfium2 등 딸려 온 것 포함), MarkItDown이 메인으로 맞지 않는 이유를 이 버전으로 직접 확인한 결과(위치 정보 없음, 병합 셀 펼침, PDF 표 구조 없음, 공백·기호 변경 — 각각 작은 예시 입력과 출력 한 줄), 자식 프로세스 하나가 메인 추출+MarkItDown을 돌릴 때의 최대 RSS(`resource.getrusage(RUSAGE_CHILDREN).ru_maxrss`, 합성 문서와 200만 자 근처 DOCX 하나), import 시간. 결과로 compose backend 메모리 상한을 정한다: (backend 프로세스 RSS + 자식 최대 RSS) > 768 MiB면 `docker-compose.yml`의 `memory: 1G`를 `2G`로 올리고 그 이유를 같은 문서에 적는다. Docker가 있으면 `docker build backend`가 되는지 확인하고, 없으면 "확인 못 함"이라고 적는다.
- [ ] **Step 5: 통과 확인** → PASS, 전체.
- [ ] **Step 6: 커밋** — `feat(sop): cross-check extraction with MarkItDown — MarkItDown 누락 대조`

---

### Task 8: 업로드 — 설정, 파일 이름 파싱, 자식 프로세스 추출, 문서 API

**Files:**
- Create: `backend/app/sop/filename.py`, `backend/app/sop/extract/worker.py`, `backend/app/sop/ingest.py`, `backend/app/routers/sop_documents.py`, `backend/tests/worker_targets.py`, `backend/tests/test_sop_filename.py`, `backend/tests/test_sop_upload.py`
- Modify: `backend/app/settings.py`, `.env.example`, `docker-compose.yml`, `backend/app/main.py`, `backend/tests/sop_helpers.py`

**Interfaces:**
- Consumes: Task 5·6·7 함수, Task 3·4.
- Produces:
  - Settings(Tuning, env 세 곳): `sop_max_file_mb: int = 25`, `sop_max_docx_unzipped_mb: int = 200`, `sop_max_pdf_pages: int = 500`, `sop_max_doc_chars: int = 2_000_000`, `sop_parse_timeout_seconds: int = 60`, `sop_parse_memory_mb: int = 2048`(리눅스 자식 프로세스 `RLIMIT_AS`). 업무 상수(코드): ZIP 항목 수 2,000, 항목 압축 비율 200.
  - `filename.ParsedFileName(doc_code: str, version: str, title: str)`, `filename.parse_file_name(file_name: str) -> ParsedFileName`
  - `worker.WorkerResult(outcome: Literal["ok", "rejected", "failed"], code: str, result: ExtractResult | None, aux_markdown: str | None, aux_error: str | None)`
  - `worker.run_extraction(data: bytes, file_format: str, limits: ExtractLimits) -> WorkerResult`(자식 쪽, 순수)
  - `async worker.extract_in_subprocess(data: bytes, file_format: str, limits: ExtractLimits, *, timeout_s: float, memory_mb: int, target: Callable[..., WorkerResult] = run_extraction) -> WorkerResult` — `multiprocessing.get_context("spawn").Process` + `Pipe`. 리눅스면 자식이 시작하자마자 `RLIMIT_AS`를 건다. 부모는 `asyncio.to_thread`로 결과를 기다리고, 시간 초과면 `terminate()`·`join()` 뒤 `failed`/`timeout`, 자식이 결과 없이 죽으면 `failed`/`crashed`. 메인 추출과 MarkItDown은 자식에서, 누락 대조(`find_missing_text`)는 부모에서 한다.
  - `async ingest.ingest_upload(session, *, bundle: Bundle, side: str, file_name: str, data: bytes, actor: str, doc_type: str | None, parent_code: str | None) -> Document`
  - 테스트 헬퍼 `upload(client, bundle_id, data: bytes, file_name: str, *, side="old", doc_type=None, parent_code=None, headers=AUTHOR) -> Response`
- 엔드포인트(`sop_documents.py`):

| 경로 | 권한 | 동작 |
|---|---|---|
| `POST /api/bundles/{bundle_id}/documents` | 작성자·작업 중 | multipart `file`, `side`(old\|new), `doc_type`·`parent_code`(new일 때) → 201 `DocumentOut` |
| `GET …/documents` | 멤버 | `[DocumentOut]` 업로드 순 |
| `PATCH …/documents/{doc_id}` | 작성자·작업 중 | `{revision, doc_code?, doc_version?, title?, language_layout?}` |
| `DELETE …/documents/{doc_id}?revision=&confirm=false` | 작성자·작업 중 | 204 |
| `GET …/documents/{doc_id}/file` | 멤버 | 원본 바이트, `Content-Disposition`(RFC 5987 `filename*` + ASCII 대체) |
| `GET …/documents/{doc_id}/figures/{block_id}` | 멤버 | 그림 블록의 `image_part` 바이트(확장자로 content-type) |
| `POST …/warnings/{warning_id}/ack` | 작성자·작업 중 | `{note(≤2000)}` → `acked_by/at` |

`DocumentOut{id, side, file_name, file_format, size_bytes, doc_code, doc_version, title, language_layout, status, status_reason, revision, target_doc_id, uploaded_by, uploaded_at, extraction{id, aux_status, warnings[{id, kind, block_id, detail, needs_ack, acked_by, acked_at, ack_note}]} | null}`.

업로드 순서(`ingest_upload`):
1. 라우터는 `await file.read(limit + 1)`까지만 읽는다. 크기 > `sop_max_file_mb` → 413이 아니라 `rejected`/`too_large` 행(바이트 저장 없음). 확장자(대소문자 무시) `.docx`·`.pdf` 밖 → `rejected`/`invalid_format`.
2. SHA-256 계산, 같은 묶음에 같은 해시 → 409 `duplicate_file`(행 없음).
3. `side="new"`: `doc_type` 필수, WI면 `parent_code`가 묶음의 SOP 새 문서여야 한다(422 `invalid_parent`). 파일 이름 파싱 코드가 이미 To-Be에 있으면 409 `duplicate_code`, 코드가 비면 임시 코드 `NEW-{문서 id}`.
4. 파싱 전에 `await session.rollback()`으로 연결을 놓는다(파싱은 수십 초까지 걸릴 수 있다).
5. `extract_in_subprocess` → `rejected`면 상태 `rejected`·사유 코드, `failed`면 `failed`·코드, `ok`면 `ready`.
6. 쓰기 트랜잭션: 문서 행(파일 이름 파싱으로 번호·버전·제목, 비면 빈 칸), `ready`면 `document_files`·`extractions`(`aux_status` = MarkItDown 성공 `ok`/실패 `failed`·`aux_detail` = 예외 클래스 이름)·`source_tables`·`source_blocks`·`extraction_warnings`(추출 경고는 `needs_ack=False`, 누락 의심은 `kind="missing_text"`·`needs_ack=True`·`detail={"snippet"}`). `side="new"`면 `target_docs`(`entrance="match"`) 행을 만들고 문서에 잇는다. 같은 해시 경합으로 `IntegrityError`면 409 `duplicate_file`. 기록 `document.upload`.
7. (Task 9가 이 트랜잭션 끝에 단위 만들기를 더한다.)

문서 삭제는 이 태스크에서는 단위·블록째 지우고 `side="new"`면 그 `target_docs` 행도 지운다(판단이 붙은 경우의 확인 플래그는 Task 11이 더한다). 언어 배치 변경의 짝 재계산은 Task 9가 더한다.

파일 이름 파싱: NFC 정규화, 확장자 제거. 문서 번호 = 첫 `(?<![A-Za-z0-9])([A-Z]{2,}(?:-[A-Z0-9]{1,8})*-\d{1,6})(?![A-Za-z0-9])`. 버전 = `(?i)(?:\bv|\brev\.?\s*|\bver\.?\s*|\bversion\s*)(\d+(?:\.\d+)*)`. 제목 = 나머지에서 번호·버전 토큰과 감싼 괄호를 지우고 `_`와 연속 공백·` - `를 공백 하나로, 양끝 공백·구두점 제거.

- [ ] **Step 1: 실패하는 테스트**
  - `test_parse_file_name`(parametrize):
    - `"SOP-QC-00005_v3.0_Eppendorf Centrifuge.docx"` → `("SOP-QC-00005", "3.0", "Eppendorf Centrifuge")`
    - `"SOP-QC-00155 Rev.2 Eppendorf 5702R Centrifuge.docx"` → `("SOP-QC-00155", "2", "Eppendorf 5702R Centrifuge")`
    - `"WI-01(ver 1) Operation.docx"` → `("WI-01", "1", "Operation")`
    - `"원심분리기 운영.docx"` → `("", "", "원심분리기 운영")`
    - `"SYNTHETIC_OLD-1_v1.0_Eppendorf Centrifuge.docx"` → `("OLD-1", "1.0", "SYNTHETIC Eppendorf Centrifuge")`
  - `test_upload_docx_ready`: 팩토리 DOCX → 201 `status == "ready"`, `doc_code`·`title` 채움, `extraction.aux_status == "ok"`, DB 블록 수 > 0.
  - `test_upload_rejections_are_recorded`(parametrize): 변경 추적 DOCX → `status == "rejected"`, `status_reason == "tracked_changes"`, `.txt` → `invalid_format`, `sop_max_file_mb`를 0으로 패치 → `too_large`.
  - `test_duplicate_file_conflicts`: 같은 바이트 두 번 → 둘째 409 `duplicate_file`.
  - `test_parse_timeout_marks_failed`: `extract_in_subprocess(..., timeout_s=1, target=tests.worker_targets.sleep_forever)` → `outcome == "failed"`, `code == "timeout"`, 자식이 남아 있지 않다(`multiprocessing.active_children() == []`).
  - `test_child_crash_marks_failed`: `target=tests.worker_targets.exit_hard`(`os._exit(3)`) → `code == "crashed"`.
  - `test_upload_new_doc_creates_match_target_doc`: SOP를 To-Be에 넣고 `side="new"`, `doc_type="wi"`, `parent_code="SOP-NEW"` → `target_doc_id`가 생기고 To-Be GET에 `entrance == "match"`.
  - `test_upload_requires_editable_bundle_and_author`: 검토자 403, (상태를 DB로 `in_review`로 바꾼 뒤) 409 `bundle_not_editable`.
  - `test_download_original_and_figure`: 원본 바이트가 같고, 그림 블록 이미지가 팩토리 PNG와 같다.
  - `test_ack_warning`: `missing_text` 경고(테스트가 DB에 직접 넣는다) 확인 → `acked_by == "qa.member"`.
  - `test_upload_logs_no_text`: `caplog`로 업로드 로그에 파일 이름·본문 글자가 없다.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** → PASS, 전체.
- [ ] **Step 5: 커밋** — `feat(sop): upload and extract documents in a time-limited child process — 업로드·격리 추출`

---

### Task 9: 규칙 기반 쪼개기·언어 판정·연달아 짝·원문 대조 데이터

**Files:**
- Create: `backend/app/sop/segment.py`, `backend/app/sop/coverage.py`, `backend/app/sop/units.py`, `backend/app/sop/status.py`, `backend/tests/test_sop_segment.py`, `backend/tests/test_sop_units.py`
- Modify: `backend/app/sop/ingest.py`(쓰기 트랜잭션 끝에 `create_initial_units`), `backend/app/routers/sop_documents.py`(view, 언어 배치 변경 시 짝 재계산), `backend/app/sop/extract/aux_compare.py`(`is_blank_char` 공유), `backend/tests/sop_helpers.py`

**Interfaces:**
- Produces:
  - `segment.is_blank_char(ch: str) -> bool` = `ch.isspace() or ch in "​‌‍⁠﻿"` — 쪼개기·커버리지·누락 대조가 모두 이것 하나를 쓴다.
  - `status.get_cover_status(unit: Unit, decisions_by_unit_id: Mapping[int, UnitDecision]) -> str` — 커버 단위 상태 계산 단일 소스(view·단위 목록·결과물·검토 조건이 모두 쓴다).
  - `segment.split_sentences(text: str) -> list[tuple[int, int]]` — 앞뒤 빈 글자를 뺀 범위, 빈 글자 아닌 글자를 빠짐없이 덮는다.
  - `segment.detect_language(text: str) -> Literal["ko", "en"] | None`
  - `segment.BlockView(id, seq, kind, part, text, heading_level, flags, table_id, row_index)`, `segment.TableView(id, is_layout)`, `segment.UnitDraft(kind, spans: list[tuple[int, int, int]], lang, table_id, row_index, group_index: int | None)`
  - `segment.build_unit_drafts(blocks: Sequence[BlockView], tables: Sequence[TableView], layout: str) -> list[UnitDraft]`
  - `segment.suggest_interleaved_pairs(units: Sequence[tuple[int, str]]) -> list[tuple[list[int], list[int]]]` — `(unit_id, lang)` 순서 목록, `neutral`은 건너뛴다.
  - `coverage.find_coverage_problems(block_texts: Mapping[int, str], cover_spans: Sequence[Sequence[tuple[int, int, int]]]) -> list[str]` — 겹침, 덮이지 않은 빈 글자 아닌 글자, 앞뒤가 빈 글자인 범위를 문자열로 알린다.
  - `async units.create_initial_units(session, document: Document, extraction: Extraction) -> None` — 단위 삽입(`local_no` 1부터, `pos_seq`·`pos_start`), 옛 문서면 판단 행, 연달아 배치면 코드 짝(`status="suggested"`, `source="code"`).
  - `units.compute_display_id(document: Document, unit: Unit) -> str`
  - `async units.verify_document_coverage(session, document_id: int) -> None` — 문제가 있으면 `RuntimeError`(버그 가드, Task 13·14가 편집 뒤에 부른다).
  - `async units.refresh_code_pairs(session, document: Document) -> None` — 제안 상태 코드 짝을 지우고 배치가 연달아면 다시 만든다(확정 짝은 둔다).
  - 엔드포인트 `GET /api/bundles/{bundle_id}/documents/{doc_id}/view`(멤버) → `{document, extraction{id, aux_status, warnings}, tables[{id, table_index, parent_table_id, part, n_rows, n_cols, is_layout}], blocks[{id, seq, part, kind, text, xml_path, page, page_basis, section_label, heading_level, table_id, row_index, col_index, grid_span, row_span, flags, has_image}], units[{id, display_id, kind, spans, text, lang, table_id, row_index, group_unit_id, boundary_confirmed, status, pair_id}], pairs[{id, status, source, unit_ids}], edits{can_undo, can_redo}}` — 활성 단위만. `status`는 커버 단위 상태(새 문서 단위는 `null`).
  - 테스트 헬퍼 `get_view(client, bundle_id, doc_id) -> dict`, `find_unit(view, text: str, occurrence: int = 1) -> dict`(글자가 정확히 같은 활성 단위의 n번째)

쪼개기 규칙:
- 문단 블록: `heading_level`이 있거나 `clause_number`면 블록 전체가 제목 단위 하나. 아니면 문장 단위. 머리말·꼬리말·각주·미주·텍스트 상자도 같은 규칙(지우지 않는다).
- 표 칸 블록: 데이터 표(`is_layout=False`)는 표마다 `table` 단위 하나(`spans=[]`, `neutral`)를 만들고 칸 글자를 `cell_sentence`로 쪼개 그 표에 묶는다(`group_index`). 칸 안의 표는 자기 `table` 단위를 갖는다. 레이아웃 표는 칸 문장을 묶지 않는다. 처음 추출 때 모든 표는 데이터 표다(스펙 §6.4 사용자 결정).
- 그림 블록: `figure` 단위 하나(`neutral`, 캡션 글자 범위, 캡션 없으면 `spans=[]`).
- 문장 끝: `.`·`!`·`?`·`。` 다음에(닫는 `"'”’)]`는 앞 문장에 붙인다) 빈 글자가 오거나 글이 끝나면 경계 후보다. 다음 경우는 자르지 않는다: 마침표 앞 토큰이 `ABBREVIATIONS = ("e.g", "i.e", "etc", "no", "nos", "fig", "figs", "vol", "approx", "dr", "mr", "ms", "vs", "eq", "ref", "cf", "ca", "sec", "min")`(대소문자 무시)이면서 다음 빈 글자 아닌 글자가 소문자 라틴·숫자일 때, 다음 글자가 소문자 라틴일 때, 마침표 앞이 대문자 한 글자(이니셜)일 때. 줄바꿈은 경계가 아니다.
- 언어: 한글 음절 수 h, 라틴 글자 수 l. 둘 다 0이면 `None`, `h / (h + l) >= 0.2`면 `ko`, 아니면 `en`. `None`은 같은 문서 앞 단위의 언어, 없으면 뒤 단위, 없으면 배치 기본값(`en_only` → `en`, 나머지 → `ko`).
- 연달아 짝: `neutral`을 건너뛴 순서에서 같은 언어가 이어진 덩어리를 만들고 앞에서부터 두 덩어리씩(언어가 서로 다를 때) 짝을 짓는다. 어느 쪽이든 `MAX_PAIR_SIDE`(3)를 넘으면 그 두 덩어리는 짝을 만들지 않는다.

- [ ] **Step 1: 실패하는 테스트**
  - `test_split_sentences`(parametrize, 결과 글자 목록으로 단언):
    - `"QC 팀장은 책임자를 지정한다. 기록은 보관한다."` → 2문장
    - `"Use e.g. a 50 mL tube. Then close the lid."` → 2문장(`e.g.` 뒤에서 안 자름)
    - `"See Fig. 3 for details. Done."` → 2문장
    - `"Set to 3.5 rpm. Check No. 5 before use."` → 2문장
    - `"He said \"Stop.\" Then left."` → `["He said \"Stop.\"", "Then left."]`
    - `"Refer to SOP-QC-00005. Next step."` → 2문장
    - `"J. Smith approves it."` → 1문장
    - `"첫 줄\n둘째 줄."` → 1문장(줄바꿈은 경계 아님)
  - `test_detect_language`(parametrize): `"원심분리기의 rpm을 확인한다."` → `ko`, `"Press START (시작)."` → `en`, `"12.5 %"` → `None`.
  - `test_invisible_chars_follow_one_blank_rule`: `split_sentences("​가나다. 　")` → `[(1, 5)]`, 블록 `{1: "﻿"}`에 단위 없음 → `find_coverage_problems == []`.
  - `test_build_drafts_tables_figures_headings`: 제목 1·문단 1·2×2 데이터 표·그림 → 종류 순서와 칸 문장의 `group_index`가 표 초안을 가리킨다.
  - `test_suggest_interleaved_pairs`: `[(1,"ko"),(2,"en"),(3,"ko"),(4,"ko"),(5,"en"),(6,"neutral"),(7,"en")]` → `[([1],[2]), ([3,4],[5,7])]`, 한쪽 4개 덩어리는 짝 없음.
  - `test_upload_creates_units_with_full_coverage`(API): 한/영 연달아 DOCX 업로드 → view의 커버 단위가 모든 블록을 덮는다(`find_coverage_problems == []`), 단위마다 `status == "unassigned"`, 짝이 제안 상태로 있다, `display_id`가 `"OLD-1-001"` 꼴.
  - `test_new_doc_units_have_no_decisions`: `side="new"` 업로드 → view의 단위 `status is None`, DB `unit_decisions` 행 0.
  - `test_layout_change_refreshes_code_pairs`: 배치를 `ko_only`로 → 제안 짝 0, 다시 `ko_en_interleaved` → 제안 짝 생김, 문서 `revision`이 오른다.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** → PASS, 전체.
- [ ] **Step 5: 커밋** — `feat(sop): split blocks into units, detect language and pair interleaved text — 규칙 쪼개기·언어·짝`

---

### Task 10: 문장 검사(숫자·단위·부정)

**Files:**
- Create: `backend/app/sop/checks.py`, `backend/tests/test_sop_checks.py`

**Interfaces:**
- Produces: `check_sentence(source_texts: Sequence[str], target_text: str) -> list[dict[str, str]]` — 경고 `{"kind": "number_mismatch" | "unit_mismatch" | "negation_mismatch", "source": …, "target": …}`. 값 칸에는 숫자·단위 토큰만 넣는다(문장 원문을 싣지 않는다).

규칙(스펙 §7.12, 사전은 테스트로 굳힌다):
- 숫자: `\d+(?:[.,]\d+)*`, 세 자리 묶음 쉼표는 지운다(`1,000` → `1000`). 출처 전체와 새 문장의 숫자 다중집합이 다르면 경고 하나(`source`·`target`에 정렬해 `", "`로 이은 목록).
- 단위: 같은 뜻 묶음 `{℃, °C}`, `{mL, ml}`, `{µL, uL, μL}`, `{L}`, `{rpm}`, `{×g, xg}`, `{g}`, `{mg}`, `{kg}`, `{min, 분}`, `{h, hr, 시간}`, `{sec, 초}`, `{%}`, `{bar}`, `{psi}`, `{kPa}`, `{MPa}`. 단어 경계로 찾은 묶음 집합이 다르면 경고.
- 부정: 한글 `않`·`없`·`금지`·`말 것`·`불가`·`아니`, 영어 `\bnot\b`·`\bno\b`·`\bnever\b`·`\bwithout\b`·`\bprohibited\b`·`\bcannot\b`·`n't`·`\bnone\b`(대소문자 무시). 출처에 있음 ≠ 새 문장에 있음이면 경고. 언어가 달라도 비교한다(번역 대비).

- [ ] **Step 1: 실패하는 테스트**
  - `test_numbers`: `(["5분간 원심분리한다."], "10분간 원심분리한다.")` → `number_mismatch`, `source == "5"`, `target == "10"`. `1,000 rpm` ↔ `1000 rpm` → 경고 없음.
  - `test_units`: `"4 ℃에서 보관"` ↔ `"Store at 4 °C"` → 경고 없음, `"4 ℃"` ↔ `"4 mL"` → `unit_mismatch`.
  - `test_negation_cross_language`: `"직사광선에 두지 않는다."` ↔ `"Keep in direct sunlight."` → `negation_mismatch`, ↔ `"Do not keep in direct sunlight."` → 없음.
  - `test_merged_sources`: 출처 두 문장의 숫자 합집합과 비교한다.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(sop): warn on number, unit and negation drift — 문장 검사`

---

### Task 11: 관계 묶음 저장·일괄 처분·배정 지우기·떼어 내기

**Files:**
- Create: `backend/app/sop/groups.py`, `backend/app/sop/detach.py`, `backend/app/sop/decisions.py`, `backend/app/routers/sop_decisions.py`, `backend/tests/test_sop_decisions.py`, `backend/tests/test_sop_groups.py`
- Modify: `backend/app/routers/sop_documents.py`(문서 삭제의 확인 플래그·떼어 내기), `backend/app/main.py`, `backend/tests/test_sop_tobe.py`(Task 4가 미뤄 둔 새 문장 관련 거절 테스트), `backend/tests/sop_helpers.py`

**Interfaces:**
- Consumes: Task 4 `To-Be`, Task 9 단위·`get_cover_status`, Task 10 `check_sentence`.
- Produces:
  - `groups.build_group_ids(edges: Iterable[tuple[int, int]], unit_order: Mapping[int, tuple[int, ...]], display_ids: Mapping[int, str]) -> tuple[dict[int, str], dict[int, str]]` — `edges`는 (새 문장 id, 단위 id). 반환은 (단위 → 묶음 ID, 새 문장 → 묶음 ID)이고 연결 요소 중 단위 ≥2 또는 새 문장 ≥2인 것만 담는다. 묶음 ID = `"G-" + 요소 안에서 unit_order가 가장 앞선 단위의 display_id`. **호출 전에 묶인 칸 문장은 그룹 단위로, 칸 새 문장은 부모 표 새 문장으로 접는다**(표 하나가 관계 묶음으로 잡히지 않게). 이 접기도 `groups.collapse_table_members(...)`로 같은 모듈에 둔다(시그니처는 빌더 재량, Task 15가 같은 함수를 쓴다).
  - `async groups.load_group(session, bundle_id: int, *, unit_id: int | None = None, target_id: int | None = None) -> GroupOut` — 출처 연결과 칸 묶음을 따라간 연결 요소 전체.
  - `async detach.detach_units(session, *, bundle_id: int, unit_ids: Collection[int], cause: Literal["retired", "cleared"], actor: str) -> DetachReport` — `DetachReport(reset_unit_ids, deleted_target_ids, held_unit_ids, held_target_ids)`
  - `async decisions.save_group(session, bundle: Bundle, payload: GroupSaveIn, actor: str) -> GroupOut`
  - 요청·응답 스키마:

```python
class UnitDecisionIn(BaseModel):
    unit_id: int; revision: int
    disposition: Literal["assigned", "delete", "move_external"]
    move_target_code: str = Field("", max_length=100); reason: str = Field("", max_length=2000)

class GridIn(BaseModel):
    rows: int = Field(ge=1, le=500); cols: int = Field(ge=1, le=100)

class TargetIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)          # 요청 안 식별자
    id: int | None = None; revision: int | None = None      # 기존 새 문장이면 둘 다
    target_doc_id: int | None = None                        # 새로 만들 때 필수
    slot_key: str | None = None; wi_step: int | None = None
    wi_part: Literal["instruction", "why"] | None = None
    kind: Literal["sentence", "table", "figure"] = "sentence"
    lang: Literal["ko", "en", "neutral"] | None = None
    text: str | None = Field(None, max_length=20000)
    change_type: Literal["as_is", "tone", "rewritten", "table_restructured"] | None = None
    source_unit_ids: list[int] = Field(max_length=200)
    parent_key: str | None = None; cell_row: int | None = None; cell_col: int | None = None
    grid: GridIn | None = None

class GroupSaveIn(BaseModel):
    action: Literal["confirm", "hold"]; hold_reason: str = Field("", max_length=2000)
    units: list[UnitDecisionIn] = Field(max_length=500)
    targets: list[TargetIn] = Field(max_length=2000)
    removed_target_ids: list[int] = Field(default_factory=list, max_length=2000)
```

  - `GroupOut{units[{unit_id, display_id, document_id, kind, lang, text, group_id, decision{disposition, move_target_code, reason, status, hold_reason, confirmed_by, confirmed_at, revision}, cell_unit_ids}], targets[{id, target_doc_id, slot_key, wi_step, wi_part, section_path, order_index, lang, kind, confirmed_text, ai_text, change_type, origin, new_unit_id, parent_target_id, cell_row, cell_col, grid, status, hold_reason, warnings, source_unit_ids, group_id, revision}]}` — `group_id`는 나눔·합침 관계 묶음일 때만 값이 있다. 한 요청에 연결 요소가 여럿(예: 한/영 짝 두 단위)이어도 된다.
  - 테스트 헬퍼 `save_group(client, bundle_id, body, headers=AUTHOR) -> Response`, `assign_as_is(client, bundle_id, unit: dict, target_doc_id: int, **location) -> dict`(단위 하나를 원문 그대로 보낸다, 칸 문장 있는 표 단위도 처리)
- 엔드포인트:

| 경로 | 권한 | 동작 |
|---|---|---|
| `GET /api/bundles/{bundle_id}/units?side=old&lang=&status=&document_id=&target_doc_id=&limit=200&offset=0` | 멤버 | 판단 가능 단위 + 판단 + 새 문장 id 목록 + 커버 상태(limit 최대 1,000) |
| `GET …/groups/by-unit/{unit_id}`, `GET …/groups/by-target/{target_id}` | 멤버 | `GroupOut` |
| `POST …/groups/save` | 작성자·작업 중 | `GroupSaveIn` → `GroupOut` |
| `POST …/decisions/bulk` | 작성자·작업 중 | `{action: "delete" \| "move_external", reason(1–2000), move_target_code?, units[{unit_id, revision}]}` |
| `POST …/decisions/clear` | 작성자·작업 중 | `{unit_id, revision}` → `DetachReport` |

**관계 묶음 저장 검사**(모두 통과해야 쓴다, 실패는 422 `invalid_group{reason}` 또는 표시한 코드):
1. 보낸 단위는 이 묶음 옛 문서의 활성 판단 가능 단위이고 묶인 칸 문장이 아니다(묶인 칸 문장은 그룹 단위를 보내면 함께 따라온다). 보낸 기존 새 문장은 이 묶음 것이다.
2. `revision`: 단위 판단과 기존 새 문장 전부 확인, 낡은 것을 모아 409 하나.
3. **닫힘**: (a) 보낸 단위(와 그 칸 문장)에 지금 이어진 기존 새 문장은 모두 `targets`(id) 또는 `removed_target_ids`에 있다. (b) 모든 `targets`의 출처는 보낸 단위 또는 그 칸 문장이다. (c) 보낸 기존 새 문장의 지금 출처도 (b)를 만족한다. 아니면 `invalid_group{reason: "not_closed"}`.
4. 처분: `assigned`면 그 단위(표 단위는 자기 또는 칸 문장)를 출처로 갖는 새 문장이 1개 이상, `delete`·`move_external`이면 0개이고 `reason` 필수, `move_external`은 `move_target_code` 필수.
5. 새 문장 위치: `target_doc_id`가 묶음 To-Be에 있다. SOP는 `slot_key ∈ SLOT_KEYS`이고 N/A가 아니다. WI는 `wi_part` 필수, `wi_step`은 비었거나 선언된 단계. 새 새 문장은 `entrance="assign"` 문서에만 만든다. `match` 문서는 기존 `new_doc` 새 문장만 보낼 수 있고 그 위치·글자·언어·종류는 바꿀 수 없다(출처와 변경 종류만).
6. 언어: `sentence` 새 문장의 언어 = 모든 출처 단위의 언어. `table`은 출처가 그 표·행 단위 하나이고 `neutral`·`grid` 필수, `figure`는 출처가 그림 단위 하나이고 `neutral`·글자 없음.
7. 칸 새 문장: `parent_key`(같은 요청의 `table` 새 문장) 필수, 같은 새 문서, 출처는 그 표 단위에 묶인 칸 문장 하나, `cell_row`·`cell_col` 필수.
8. 글자: `sentence`는 확정 글자가 비면 안 된다(빈 글자만이면 422). 새로 만드는 `sentence`에서 `text`를 비우고(`None`) 출처가 하나면 확정 글자 = 출처 단위 글자다("그대로 보내기", 스펙 §7.7).
9. 변경 종류: 코드가 계산하는 종류가 먼저다 — 출처 0(`new_doc`) `new`, 출처 ≥2 `merged`, 같은 새 문서 안에서 한 출처 단위가 `sentence` 새 문장 ≥2개로 가면 그 새 문장들 `split`(칸 새 문장은 세지 않는다). 그 밖의 `sentence`는 요청의 `as_is`·`tone`·`rewritten` 중 하나가 필수이고, 출처가 하나이고 확정 글자가 출처 글자와 같으면 `as_is`로 고정한다. `table`은 `as_is`(기본)나 `table_restructured`이고 후자면 표 단위 판단의 `reason` 필수. `figure`는 `as_is`.
10. 중복 배정: 한 단위의 새 문장(칸 새 문장은 부모로 접어서)이 서로 다른 새 문서 둘 이상이면 그 단위 `reason` 필수(`invalid_group{reason: "duplicate_without_reason"}`).
11. `hold`면 `hold_reason` 필수.

**쓰기**(한 트랜잭션): `removed_target_ids` 삭제(`new_doc`은 지우지 않고 출처만 떼어 미배정으로 — 아니면 422), 새 문장 만들기·고치기(확정 글자가 바뀌면 `target_text_history`), 출처 다시 쓰기(`seq`는 요청 순서), 변경 종류, `warnings = check_sentence(...)`(`sentence`만), 상태 `confirmed`(확정한 사람·시각) 또는 `on_hold`(`hold_reason`), 판단 행 갱신, `revision += 1`. `order_index`: 새 문서가 `manual_order`면 새 새 문장은 그 문서 최댓값 + 1, 아니면 0(결과물이 출처 위치로 정렬한다). 기록 `group.confirm`·`group.hold`.

**떼어 내기**(`detach_units`, 스펙 §7.5와 배정 지우기 공용):
1. 대상 단위와 그 칸 문장, 그리고 그들과 이어진 연결 요소 전체를 먼저 구한다.
2. 대상 단위의 판단이 미배정이 아니면 `unit_decision_history`에 스냅숏(처분·사유·상태·보류 사유·새 문장 id와 글자)을 남기고 미배정으로 되돌린다(`revision += 1`).
3. 대상 단위(와 칸 문장)의 출처 연결을 지운다. `cause="retired"`이고 대상이 새 문서 단위면 그 단위의 `new_doc` 새 문장도 지운다.
4. 출처가 하나도 남지 않은 새 문장: `origin="units"`면 삭제(칸 새 문장은 CASCADE), `new_doc`이면 `unassigned`·`change_type=None`·`revision += 1`.
5. 연결 요소의 나머지(지우거나 되돌리지 않은 단위·새 문장)는 내용을 그대로 두고 상태를 `on_hold`, `hold_reason = SYSTEM_HOLD_RELATED_CHANGED`로 바꾼다.

**일괄 처분**: 단위마다 따로 저장하는 것과 같다. 각 단위에 새 문장이 없어야 한다(있으면 409 `unit_has_targets`). 상태 `confirmed`. AI 제안을 한 번에 확정하는 경로는 만들지 않는다. **배정 지우기**: `detach_units(cause="cleared")`.

**문서 삭제(Task 8 보강)**: 지울 문서의 단위에 미배정이 아닌 판단이 있거나 확정 새 문장의 출처이면 `confirm=true` 없이는 409 `confirm_required{unit_ids}`. 지우기 전에 `detach_units(cause="retired")`를 부른다.

- [ ] **Step 1: 실패하는 테스트**(`test_sop_groups.py`는 순수, `test_sop_decisions.py`는 API. API 테스트는 To-Be를 넣고 팩토리 DOCX를 올린 묶음을 픽스처로 만든다)
  - `test_build_group_ids_only_for_splits_and_merges`: 1:1 연결은 묶음 없음, 1→2와 2→1은 묶음, ID는 가장 앞선 단위 기준.
  - `test_assign_as_is_confirms_and_fixes_change_type`: 원문 그대로 SOP `responsibilities`로 → 단위 `confirmed`, 새 문장 `change_type == "as_is"`(요청이 `tone`이어도 글자가 같으면 `as_is`).
  - `test_split_into_two_targets_is_split`: 한 단위 → 같은 WI 새 문장 2개 → 둘 다 `split`.
  - `test_merge_two_units_is_merged`: 두 단위 → 새 문장 1개 → `merged`, `GET groups/by-unit`의 두 단위와 새 문장이 같은 `group_id`.
  - `test_pair_units_saved_together`: 한/영 짝 두 단위를 각자의 새 문장(ko·en)과 한 요청에 담아 확정 → 둘 다 `confirmed`, `group_id`는 둘 다 `None`.
  - `test_send_as_is_without_text`: 새 문장 `text=None`, 출처 하나 → 확정 글자가 원문과 같고 `as_is`.
  - `test_duplicate_assignment_requires_reason`: SOP와 WI 두 문서로 → 사유 없으면 422 `duplicate_without_reason`, 있으면 200.
  - `test_group_must_be_closed`: 합친 새 문장의 한 출처만 보내면 422 `not_closed`.
  - `test_group_save_with_one_stale_revision_changes_nothing`: 단위 2개 묶음에서 둘째 단위 revision만 낡게 → 409, `conflicts` 1건, 첫째 단위 판단·새 문장 개수 그대로.
  - `test_location_rules`(parametrize): N/A 칸, 없는 칸 키, 선언 안 된 WI 단계, `match` 문서에 새 새 문장 → 각 422.
  - `test_language_must_match_source`: 한글 단위에 `lang="en"` 새 문장 → 422.
  - `test_table_destination_creates_table_and_cell_targets`: 데이터 표 단위 → `table` 새 문장 1(`grid`) + 칸 새 문장(칸 문장 수만큼, `parent_target_id`), 칸 문장의 커버 상태가 `confirmed`.
  - `test_table_restructure_needs_reason`.
  - `test_hold_requires_reason_and_sets_on_hold`.
  - `test_sentence_checks_are_stored`: 숫자를 바꾼 확정 글자 → 새 문장 `warnings[0]["kind"] == "number_mismatch"`, 저장은 된다.
  - `test_text_history_on_edit`: 확정 뒤 글자를 다시 고치면 `target_text_history` 한 행.
  - `test_bulk_delete_and_move`: 머리말 단위 3개 일괄 삭제(사유 "구조 제목") → 모두 `confirmed`·`delete`. 이동은 `move_target_code` 없으면 422. 새 문장 있는 단위가 섞이면 409 `unit_has_targets`.
  - `test_clear_detaches_and_holds_rest_of_group`: 두 단위를 합친 새 문장에서 한 단위를 지우면 → 그 단위 미배정·이력 1행, 새 문장은 남은 출처 하나로 유지되고 `on_hold`·`hold_reason == "system:related_unit_changed"`, 남은 단위도 `on_hold`.
  - `test_every_old_cover_unit_has_exactly_one_status`: 여러 저장 뒤 `GET units`의 모든 행 상태가 `STATUSES` 중 하나이고, 칸 문장은 그룹 단위와 같은 상태.
  - `test_document_delete_needs_confirm_when_decided`: 확정 판단이 있는 문서 삭제 → 409 `confirm_required`, `confirm=true` → 204, 다른 문서 단위와 합쳐졌던 새 문장은 `on_hold`.
  - `test_tobe_rejects_changes_under_targets`(`test_sop_tobe.py`): 새 문장 있는 문서 빼기 409 `doc_has_targets`, 그 칸 N/A 409 `slot_has_targets`, 그 단계 빼기 409 `step_has_targets`, SOP↔WI 409.
  - `test_reviewer_cannot_save_and_in_review_is_locked`: 검토자 403, `in_review`면 409 `bundle_not_editable`.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** → PASS, 전체.
- [ ] **Step 5: 커밋** — `feat(sop): save decisions per relation group with closure checks — 관계 묶음 저장·떼어 내기`

---

### Task 12: 입구 2 — 새 문서 새 문장, 같은 글자 후보, 한 번에 확정

**Files:**
- Create: `backend/app/sop/match.py`, `backend/tests/test_sop_match.py`
- Modify: `backend/app/sop/units.py`(새 문서면 `create_new_doc_targets` 호출), `backend/app/routers/sop_decisions.py`

**Interfaces:**
- Consumes: Task 9·11.
- Produces:
  - `async match.create_new_doc_targets(session, document: Document, unit_ids: Collection[int] | None = None) -> list[int]` — 새 문서 활성 커버 단위마다 새 문장(`origin="new_doc"`, `new_unit_id`, 확정 글자 = 단위 글자, 상태 `unassigned`). 머리말·꼬리말 단위와 제목 단위는 만들지 않는다. 제목은 `section_path`(그 단위 앞 제목들을 `heading_level` 계층으로 쌓아 `" › "`로 이은 것, 제목 단계가 없는 문서는 조항 번호 제목을 1단계로 본다)만 정한다. 데이터 표는 `table` 새 문장 하나(`grid`) + 칸 문장마다 칸 새 문장, 그림은 `figure` 새 문장. `order_index` = 단위 순서. `unit_ids`를 주면 그 단위들만 만든다(Task 13이 편집 뒤에 쓴다).
  - `async match.sync_new_doc_targets(session, document: Document, *, created_unit_ids: Collection[int], retired_unit_ids: Collection[int], actor: str) -> DetachReport` — 은퇴한 새 문서 단위는 `detach_units(cause="retired")`, 생긴 단위는 `create_new_doc_targets(unit_ids=…)`.
  - `async match.list_identical_candidates(session, bundle_id: int) -> list[IdenticalCandidate]` — `IdenticalCandidate(unit_id, target_id, lang, text)`. 옛 미배정·새 문장 없는 커버 단위와 출처 없는 `unassigned` `new_doc` `sentence` 새 문장 중 (언어, 글자)가 정확히 같은 것이 양쪽에 **딱 하나씩**인 경우만.
  - 엔드포인트: `GET /api/bundles/{bundle_id}/match/identical-candidates`(멤버), `POST …/match/bulk-confirm`(작성자·작업 중) `{identical[{unit_id, unit_revision, target_id, target_revision}], new[{target_id, revision}]}`(합쳐 1,000개 이하).

한 번에 확정(스펙 §7.7 내 판단): `identical` 항목마다 서버가 다시 확인한다(단위 미배정·새 문장 없음, 새 문장 출처 없음·미배정, 언어·글자 정확히 같음). 하나라도 어긋나면 전체 422 `not_identical{unit_id, target_id}`. 통과하면 출처 연결, `change_type="as_is"`, 단위·새 문장 `confirmed`. `new` 항목은 출처 없는 `new_doc` 새 문장만(`change_type="new"`, `confirmed`). AI 제안 짝은 이 경로로 확정하지 않는다(계획 2에서도). 기록 `match.bulk_confirm`.

수동 짝 맞추기(1:N 나눔, N:1 합침, 고쳐 씀)는 Task 11의 관계 묶음 저장을 `match` 문서의 기존 새 문장으로 쓴다. 출처 없는 새 문장 하나만 담은 묶음(`units=[]`)도 저장할 수 있고 변경 종류는 `new`다.

- [ ] **Step 1: 실패하는 테스트**
  - `test_new_doc_upload_creates_targets_with_section_paths`: 제목 `"1. 준비"` 아래 문장 2 + 머리말 1 → 새 문장 2개, `section_path == "1. 준비"`, 머리말·제목은 새 문장 없음, 상태 `unassigned`.
  - `test_identical_candidates_are_unique_pairs`: 같은 글자 옛 단위가 둘이면 후보에서 빠진다.
  - `test_bulk_confirm_identical_and_new`: 후보 1:1 확정 → `as_is`·`confirmed`, 출처 없는 새 문장 `new` 확정.
  - `test_bulk_confirm_rejects_non_identical`: 글자 한 글자 다르면 422 `not_identical`, 아무것도 바뀌지 않는다.
  - `test_manual_match_split_and_merge`: 옛 단위 1 → 새 문장 2(나눔), 옛 단위 2 → 새 문장 1(합침), 변경 종류 계산 확인.
  - `test_unmatched_new_target_saved_alone_is_new`: `units=[]`, 새 문장 하나 → `change_type == "new"`.
  - `test_match_doc_text_is_locked`: `new_doc` 새 문장의 `text`를 바꿔 보내면 422.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(sop): match new-document sentences by hand and bulk-confirm exact pairs — 입구 2 짝 맞추기`

---

### Task 13: 쪼개기 편집 — 나누기·합치기·경계 옮기기·골라 만들기·언어·경계 확인·되돌리기

**Files:**
- Create: `backend/app/sop/editing.py`, `backend/tests/test_sop_editing.py`
- Modify: `backend/app/routers/sop_documents.py`

**Interfaces:**
- Consumes: Task 9 `verify_document_coverage`·`compute_display_id`, Task 11 `detach_units`, Task 12 `sync_new_doc_targets`.
- Produces:
  - `async editing.apply_edit(session, document: Document, op: EditOp, *, confirm: bool, actor: str) -> EditResult`
  - `async editing.undo_edit(session, document: Document, *, confirm: bool, actor: str) -> EditResult`, `async editing.redo_edit(...) -> EditResult`
  - `EditResult(document_revision: int, created_unit_ids: list[int], retired_unit_ids: list[int], detach: DetachReport | None)`
  - `EditOp`(판별 유니언, `type`): `{"type": "split", "unit_id", "at"}`, `{"type": "merge", "unit_ids"}`, `{"type": "move_boundary", "left_unit_id", "right_unit_id", "at"}`, `{"type": "carve", "block_id", "start", "end"}`, `{"type": "set_language", "unit_ids", "lang"}`. Task 14가 `split_table_rows`·`merge_table_rows`·`set_layout_table`을 더한다.
  - 엔드포인트: `POST /api/bundles/{bundle_id}/documents/{doc_id}/edits` `{revision, confirm=false, op}`, `POST …/edits/undo` `{revision, confirm=false}`, `POST …/edits/redo` `{revision, confirm=false}`(작성자·작업 중, 문서 `revision`), `POST …/units/boundary` `{unit_ids, confirmed: bool}`(작성자·작업 중, revision 없음, 되돌리기 대상 아님).

편집 규칙:
- **나누기**: `at`은 단위 `text` 안 위치. 범위 안쪽이어야 하고(구분자 위·0·끝은 422 `invalid_offset`), 양쪽을 빈 글자 규칙으로 다듬은 뒤 어느 쪽이든 비면 422 `empty_part`. 제목·문장·칸 문장만(그림·표는 422).
- **합치기**: 2개 이상, 같은 문서. 종류는 모두 `sentence`·`heading`(결과는 하나라도 문장이면 `sentence`)이거나, 모두 같은 그룹(또는 모두 그룹 없음)의 `cell_sentence`. 언어가 섞이면 422 `mixed_language`. 결과 범위는 위치 순으로 모으고 같은 블록에서 사이가 빈 글자뿐이면 한 범위로 잇는다.
- **경계 옮기기**: 왼쪽 단위의 마지막 범위와 오른쪽 단위의 첫 범위가 같은 블록이어야 한다. `at`은 블록 안 위치, 두 단위 모두 비지 않게.
- **골라 만들기**: 블록 하나 안의 `[start, end)`. 그 범위와 겹치는 커버 단위(그림 제외)를 은퇴시키고, 범위 밖 나머지는 새 단위로, 범위는 새 단위 하나로 만든다(다듬기 후 빈 조각은 버린다).
- 단위는 제자리에서 바뀌지 않는다: 위 동작은 모두 옛 단위를 `retired`로, 새 단위를 만든다(`local_no` 다음 번호, 언어는 `detect_language` → 앞 단위 규칙, 새 문서면 판단 행 없음, 옛 문서면 미배정 판단 행). 은퇴한 단위는 짝에서 빠지고(한쪽이 비면 짝 삭제), `boundary_confirmed`는 새 단위에서 거짓.
- **언어 바꾸기**: 미배정이 아닌 판단이 있는 단위면 409 `unit_has_decision`(먼저 배정을 지운다). 되돌리기 대상이다(`lang_changes`).
- **확인 플래그**: 동작이(앞으로 가기·되돌리기·다시 하기 모두) 미배정이 아닌 판단을 가진 단위를 은퇴시키거나, 새 문서에서 미배정이 아닌 새 문장이 달린 단위를 은퇴시키면 `confirm=true` 없이 409 `confirm_required{unit_ids}`. 적용하면 옛 문서는 `detach_units(cause="retired")`, 새 문서는 `sync_new_doc_targets`.
- **기록·되돌리기**: `unit_edits`에 `seq`·`op`·`payload`·만든/은퇴시킨 단위 id·언어 변경을 남긴다. 되돌리기는 마지막 `applied` 편집의 만든 단위를 은퇴시키고 은퇴시킨 단위를 **원래 ID 그대로** 되살린다(되살린 단위의 판단은 미배정, 예전 판단은 이력에만). 다시 하기는 마지막 `undone` 편집을 같은 ID로 다시 적용한다. 새 편집을 하면 `undone` 편집 행을 지운다. 없으면 409 `nothing_to_undo`·`nothing_to_redo`.
- 모든 편집·되돌리기·다시 하기 뒤 `verify_document_coverage`, 문서 `revision += 1`, 기록 `unit.edit`·`unit.undo`·`unit.redo`.

- [ ] **Step 1: 실패하는 테스트**
  - `test_split_retires_and_creates`: 두 문장짜리 단위를 `at`에서 나누면 → 옛 단위 은퇴, 새 단위 2개(글자 확인), 커버리지 문제 없음, `revision` +1.
  - `test_split_rejects_bad_offsets`(parametrize): 0, 끝, 빈 조각 → 422 코드.
  - `test_merge_far_apart_sentences`: 떨어진 두 문장 합치기 → 범위 2개, `text`가 `" "` 또는 `"\n"`로 이어진다.
  - `test_merge_rejects_mixed_language`.
  - `test_move_boundary_and_carve`: 경계를 옮긴 뒤 두 단위 글자, 골라 만들기 뒤 세 조각 글자.
  - `test_undo_revives_original_ids_and_redo_reapplies`: 나누기 → 되돌리기 → 원래 단위 ID가 다시 활성, 새 단위는 은퇴 → 다시 하기 → 같은 새 단위 ID가 다시 활성.
  - `test_new_edit_clears_redo`.
  - `test_edit_on_decided_unit_needs_confirm_and_detaches`: 확정된 단위 나누기 → 409 `confirm_required` → `confirm=true` → 새 단위 미배정, 판단 이력 1행, 그 단위와 합쳐졌던 다른 단위는 `on_hold`.
  - `test_undo_that_retires_decided_units_needs_confirm`: 나누기 → 새 단위 하나 확정 → 되돌리기 409 → 확인하면 되살린 단위 미배정.
  - `test_edit_on_new_doc_rebuilds_its_targets`: 새 문서 단위 나누기 → 옛 `new_doc` 새 문장 삭제, 새 단위 2개의 새 문장 생성.
  - `test_set_language_refused_when_decided`: 409 `unit_has_decision`, 미배정이면 바뀌고 되돌리기로 돌아온다.
  - `test_boundary_confirm_flag`.
  - `test_random_edit_sequences_keep_coverage`: 시드 고정 난수로 나누기·합치기·경계 옮기기·골라 만들기·되돌리기·다시 하기 50번 → 매번 `find_coverage_problems == []`.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(sop): edit unit boundaries with server-side undo and redo — 쪼개기 편집·되돌리기`

---

### Task 14: 표 행 나누기·레이아웃 표·한/영 짝 API

**Files:**
- Modify: `backend/app/sop/editing.py`, `backend/app/routers/sop_documents.py`
- Create: `backend/app/sop/pairs.py`, `backend/tests/test_sop_tables.py`, `backend/tests/test_sop_pairs.py`

**Interfaces:**
- Consumes: Task 13.
- Produces:
  - `EditOp` 추가: `{"type": "split_table_rows", "table_unit_id"}`, `{"type": "merge_table_rows", "table_id"}`, `{"type": "set_layout_table", "table_id", "is_layout"}`
  - `async pairs.create_pair(session, document: Document, unit_ids: Sequence[int], actor: str) -> UnitPair`, `async pairs.confirm_pair(...)`, `async pairs.delete_pair(...)`
  - 엔드포인트(작성자·작업 중, 문서 `revision`): `POST /api/bundles/{bundle_id}/documents/{doc_id}/pairs` `{revision, unit_ids}`, `POST …/pairs/{pair_id}/confirm` `{revision}`, `DELETE …/pairs/{pair_id}?revision=`

표 규칙:
- **행 나누기**: 데이터 표 단위를 은퇴시키고 칸이 있는 행마다 `table_row` 단위(`row_index`, `spans=[]`, `neutral`, 옛 문서면 판단 행)를 만든다. 칸 문장의 `group_unit_id`를 자기 행 단위로 바꾸고 `regrouped`에 기록한다.
- **행 합치기**: 그 표의 활성 행 단위를 모두 은퇴시키고 새 `table` 단위를 만들어 칸 문장을 다시 묶는다.
- **레이아웃 바꾸기**: 데이터 → 레이아웃이면 표·행 단위를 은퇴시키고 칸 문장의 `group_unit_id=None`, `source_tables.is_layout=True`(`layout_changes`). 레이아웃 → 데이터면 반대로 새 `table` 단위를 만들어 칸 문장을 묶는다. 이때 칸 문장의 미배정이 아닌 판단은 확인 플래그 대상이다(떼어 내고 미배정으로).
- 칸 안의 표(중첩)는 그 표만 바뀐다. 되돌리기·다시 하기는 묶음 변경과 레이아웃 변경도 되돌린다(Task 13 규칙과 같다).

짝 규칙: 같은 문서의 활성 커버 단위, 양쪽 언어(`ko`·`en`)가 모두 있고 한쪽 ≤ `MAX_PAIR_SIDE`. 다른 확정 짝에 든 단위가 있으면 409 `unit_already_paired`, 제안 짝에 든 단위면 그 제안 짝을 지우고 만든다. 사람이 만든 짝은 `status="confirmed"`, `source="human"`. 기록 `pair.create`·`pair.confirm`·`pair.delete`.

- [ ] **Step 1: 실패하는 테스트**
  - `test_split_table_rows_regroups_cells`: 3행 표 → 행 단위 3개, 칸 문장의 `group_unit_id`가 자기 행.
  - `test_rows_get_own_destinations`: 행 1은 SOP, 행 2·3은 WI로 저장 → 결과 칸 문장 상태가 각 행을 따른다.
  - `test_merge_rows_back_and_undo`: 다시 합치기 → 새 표 단위, 되돌리기 → 행 단위 원래 ID.
  - `test_layout_toggle_makes_cells_independent`: 레이아웃으로 → 표 단위 은퇴, 칸 문장마다 자기 판단(미배정), 한/영 두 열 표면 행 순서대로 이웃 짝이 제안된다(Task 9 짝 재계산을 부른다).
  - `test_layout_back_needs_confirm_when_cells_decided`.
  - `test_create_confirm_delete_pair`, `test_pair_rules`(한 언어뿐 422, 한쪽 4개 422, 확정 짝 단위 409).
  - `test_retired_unit_leaves_pair`: 짝 단위를 나누면 짝에서 빠지고, 한쪽이 비면 짝이 지워진다.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(sop): split tables by row, toggle layout tables and edit KO/EN pairs — 표 행·레이아웃 표·짝`

---

### Task 15: 결과물 A·B·C와 요약 숫자

**Files:**
- Create: `backend/app/sop/snapshot.py`, `backend/app/sop/outputs.py`, `backend/app/sop/output_labels.py`, `backend/app/routers/sop_outputs.py`, `backend/tests/test_sop_outputs.py`
- Modify: `backend/app/routers/sop_bundles.py`(목록·개요에 `progress`), `backend/app/main.py`

**Interfaces:**
- Consumes: Task 11 `groups`(접기·묶음 ID), `status.get_cover_status`.
- Produces:
  - `snapshot.BundleSnapshot`(frozen) — `bundle`(id, title, status, is_synthetic, created_by, created_at), `documents`(id, side, doc_code, doc_version, title, file_name, order), `blocks`(id → part, kind, page, page_basis, section_label, table_index, row_index, col_index), `units`(활성, id → document_id, display_id, kind, lang, text, group_unit_id, table_id, row_index, order_key), `decisions`(unit_id → …), `targets`(id → 스키마 필드 + `source_unit_ids` seq 순), `target_docs`(id → 필드 + `na_slots: dict[str, str]` + `steps: tuple[tuple[int, str], ...]`)
  - `async snapshot.load_bundle_snapshot(session, bundle_id: int) -> BundleSnapshot` — 표마다 질의 한 번(쿼리 수는 단위 수와 무관).
  - `outputs.build_output_a(snap, lang) -> list[ARow]`, `outputs.build_output_b(snap, lang) -> FlowGraph`, `outputs.build_output_c(snap, lang) -> COutput`, `outputs.build_summary(snap, lang) -> Summary` — 모두 순수 함수, `lang ∈ {"ko", "en"}`.
  - `output_labels.LABELS[lang]` — 변경 종류·상태·보낸 곳 종류·위치 표기·`(이어짐)`/`(continued)`·`(합침)`/`(merged)`·`(나눔)`/`(split)` 문구, 칸 이름(영문 그대로: Purpose, Scope, Definitions, Responsibilities, General Requirements › Safety …).
  - 엔드포인트(멤버): `GET /api/bundles/{bundle_id}/outputs/a?lang=`, `…/outputs/b?lang=`, `…/outputs/c?lang=`, `…/summary`(두 언어), `PUT …/targets/order`(작성자·작업 중, 묶음 `revision`) `{revision, target_doc_id, items[{target_id, wi_step?}]}`.

**A 줄**(`ARow` 필드): `row_kind`(`unit`|`table`|`new`), `lang`, `old_doc_code`, `old_doc_version`, `location`(`section`, `place` = 문단·`표 n · r행 c열`/`Table n · R r C c`·머리말 등, `page`, `page_basis`), `unit_id`, `display_id`, `source_text`, `dest_kind`(`sop`|`wi`|`delete`|`move_external`|`""`), `dest_doc_code`, `dest_doc_title`, `dest_location`, `confirmed_text`, `ai_text`, `change_type`, `group_id`, `reason`, `status`, `confirmed_by`, `confirmed_at`, `warnings`.
- 그 언어의 옛 커버 단위마다 한 줄(정렬 키 순). 같은 새 문서로 나눈 새 문장 여럿은 한 칸에 `"① …\n② …"`, 합침은 각 출처 줄에 같은 글과 같은 `group_id`, 중복 배정은 새 문서마다 줄을 나눈다. 미배정은 보낸 곳이 빈 줄, 삭제는 `change_type="deleted"`, 이동은 `change_type=""`·`dest_kind="move_external"`·`dest_doc_code=move_target_code`.
- 데이터 표: 칸 문장 줄들 앞에 `row_kind="table"` 줄 하나(`source_text = "[표 n, 행×열]"`/`"[Table n, R×C]"`, 변경 종류·사유는 표 단위 판단과 `table` 새 문장). 그 표의 칸 문장 중 그 언어가 하나라도 있을 때만 나오고(칸이 아예 없으면 두 언어 모두), 요약 숫자에 세지 않는다. 행으로 나눈 표는 행마다 이 줄.
- 그림 줄은 두 언어 모두에 나오고 두 언어 숫자에 모두 센다.
- 입구 2의 `new` 줄(출처 없는 `new_doc` 새 문장, 그 언어)은 옛 문장 칸이 빈 채로 새 문서별로 끝에 모은다.
- (번역 줄은 계획 2.)

**B**: `FlowGraph{nodes[{id, kind, label, title, count}], edges[{source, target, count}]}`. 노드 id `old:<doc_id>`(옛 문서, 그 언어 커버 단위 수), `target:<target_doc_id>`(SOP·WI), `delete`, `move_external`, `unassigned`. 간선 수 = 그 옛 문서에서 그 보낸 곳으로 간 단위 수(나눔은 한 번, 중복 배정은 보낸 곳마다 한 번). 0인 노드·간선은 뺀다.

**C**: `COutput{docs[{target_doc_id, code, title, doc_type, parent_code, entrance, sections[{location_key, label, na_reason, items[{target_id, kind, lang, text, ai_text, change_type, status, source_note, cell_row, cell_col, children}]}]}], deleted[{display_id, doc_code, section, source_text, reason}], moved[{display_id, doc_code, section, source_text, move_target_code, reason}]}`. 문서 순서는 SOP(order_index) 다음 그 SOP의 WI들. SOP 칸은 `SLOT_KEYS` 순서로 빈 칸도 싣고 N/A면 `na_reason`. WI는 선언 단계 순으로 단계마다 `step:<n>:instruction`·`step:<n>:why`, 단계 없는 새 문장은 `unstepped:instruction`·`unstepped:why`(있을 때만). `match` 문서는 `section_path`가 처음 나온 순서로 칸을 만든다. 칸 안 순서: 문서가 `manual_order`면 `order_index`, 아니면 첫 출처의 정렬 키(출처 없는 `new_doc`은 새 단위 정렬 키). `source_note = "← " + ", ".join(f"{doc_code} §{section}")` + 합침·나눔 표기. 칸 새 문장은 표 항목의 `children`. 그 언어 새 문장과 `neutral` 새 문장만.

**요약**(그 언어): `old_units`, `assigned`(처분이 미배정이 아닌 단위, 삭제·이동 포함), `unassigned`, `duplicate`(§6.9), `deleted`, `moved`, `new`(그 언어 출처 없는 `new_doc` 새 문장), `translated`(계획 1은 0), `confirmed_rate`(확정 상태 커버 단위 / `old_units`, 소수 넷째 자리 반올림, 단위 0이면 0). 진행 숫자 `progress[lang] = {total, unassigned, ai_suggested, confirmed, on_hold}`를 묶음 목록·개요에 싣는다.

**C 순서 바꾸기**: `items`는 그 새 문서의 새 문장(칸 새 문장 제외) 전부를 한 번씩. WI면 `wi_step`을 선언 단계나 `null`로 바꿀 수 있다. 저장하면 `manual_order=True`, `order_index`는 목록 순서. 기록 `targets.reorder`.

- [ ] **Step 1: 실패하는 테스트**(픽스처: To-Be + 옛 문서 2 + 새 문서 1을 올리고 Task 11·12 API로 나눔·합침·중복·삭제·이동·표·그림·신규·미배정 1건을 만든 묶음)
  - `test_output_a_rows_follow_line_rules`: 줄 수와 각 줄의 `dest_kind`·`change_type`·`group_id`, 나눔 줄 `"① "` 접두, 중복 배정 2줄, 표 줄이 칸 줄보다 앞, 그림 줄이 ko·en 모두에, 신규 줄이 끝에.
  - `test_output_b_counts`: 간선 수, `unassigned` 노드 수 1.
  - `test_output_c_structure`: SOP 칸 15개 순서, N/A 칸 사유, WI 단계 칸, `source_note == "← OLD-1 §5.1, OLD-2 §5.1 (합침)"`(ko), 삭제·이동 목록.
  - `test_summary_numbers`: 픽스처에서 계산한 기대값과 같다(`confirmed_rate` 포함).
  - `test_reorder_targets_sets_manual_order`: 순서 바꾼 뒤 C 순서 반영, 새로 저장한 새 문장은 끝에. 목록 누락 422.
  - `test_outputs_use_bounded_queries`: 문단 2,000개 DOCX를 올리고 절반을 일괄 삭제한 묶음에서 `GET outputs/a`·`GET units?limit=1000`의 SQL 실행 수(`event.listen(engine.sync_engine, "before_cursor_execute", …)`)가 각각 30 이하.
  - `test_progress_in_list_and_overview`.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(sop): compute outputs A, B and C from confirmed decisions — 결과물 A·B·C 계산`

---

### Task 16: Excel 내보내기와 흐름도 그림

**Files:**
- Create: `backend/app/sop/excel_export.py`, `backend/app/sop/flow_image.py`, `backend/app/sop/assets/fonts/NanumGothic-Regular.ttf`, `backend/app/sop/assets/fonts/OFL.txt`, `backend/tests/test_sop_excel.py`
- Modify: `backend/app/routers/sop_outputs.py`

**Interfaces:**
- Consumes: Task 15.
- Produces:
  - `excel_export.ExportMeta(exported_by: str, exported_at: datetime, guideline_version: str)` — 계획 1의 지침 버전은 `"-"`.
  - `excel_export.build_workbook(snap: BundleSnapshot, lang: Literal["ko", "en"], meta: ExportMeta) -> bytes`
  - `excel_export.build_export_file_name(title: str, lang: str, at: datetime) -> str` — `f"{정리한 제목}_{lang}_{at:%Y%m%d-%H%M}.xlsx"`. NFC, `\/:*?"<>|`와 제어 문자는 `_`, 제목 150자.
  - `excel_export.split_cell_text(text: str, limit: int = 32767) -> list[str]`
  - `excel_export.write_text_cell(cell, value: str) -> None` — `ILLEGAL_CHARACTERS_RE`에 걸리는 글자를 `"�"`로 바꿔 넣고 `cell.data_type = "s"`(=·+·-·@로 시작해도 수식이 되지 않게).
  - `flow_image.draw_flow_png(graph: FlowGraph, lang: str) -> bytes` — Pillow, 묶음 글꼴. 왼쪽 열 옛 문서, 오른쪽 열 보낸 곳, 선 굵기는 건수에 비례, 노드에 이름과 숫자. 모양은 빌더 재량.
  - 엔드포인트 `GET /api/bundles/{bundle_id}/export.xlsx?lang=ko|en`(멤버, 모든 상태) → 파일. 실패는 500 `export_failed`(저장 실패와 구별). 기록 `export`.

통합 문서: 시트 이름 ko `A 비교표`·`B 흐름`·`C 새 문서`·`정보`, en `A Comparison`·`B Flow`·`C New documents`·`Info`. A·B·C 시트 1행은 상태 줄(`상태: 작업 중` / `Status: In progress`), 2행부터 표. A는 스펙 §7.13 칸 순서. B는 요약 숫자 표 + 옛 문서 × 보낸 곳 건수 표 + 흐름도 그림(openpyxl `Image`). C는 문서·칸·항목을 들여쓰기 열로. 정보 시트: 묶음 제목, 상태, 내보낸 시각(KST), 내보낸 사람, 만든 사람, 지침 버전, 합성 데이터 여부. 글이 32,767자를 넘으면 다음 줄에 이어 싣고 그 줄의 표시 ID 칸에 `(이어짐)`/`(continued)`.

글꼴: `https://github.com/google/fonts/tree/main/ofl/nanumgothic`의 `NanumGothic-Regular.ttf`와 `OFL.txt`(SIL OFL 1.1)를 받아 넣는다(개발 때 한 번, 서버 빌드는 외부를 받지 않는다). 받을 수 없으면 BLOCKED로 보고한다. `backend/.dockerignore`가 `app/sop/assets/`를 빼지 않는지 확인한다.

- [ ] **Step 1: 실패하는 테스트**
  - `test_workbook_sheets_and_headers`: ko 파일 시트 이름 4개, A 2행 머리가 스펙 칸 이름, 정보 시트에 `합성 데이터 여부` 값.
  - `test_export_survives_control_chars_and_formula_text`: 원문에 `"=SUM(A1)\x0b끝"`인 단위를 원문 그대로 확정 → 저장되고, 다시 읽은 칸 `data_type == "s"`, 값 `"=SUM(A1)�끝"`. 통합 문서 어디에도 `data_type == "f"` 칸이 없다.
  - `test_long_text_continues_on_next_row`: 70,000자 → 3줄, 둘째·셋째 줄 표시 ID 칸 `(이어짐)`.
  - `test_flow_image_embedded`: B 시트에 그림 1개, PNG 서명.
  - `test_export_file_name`: `("QC/원심분리기:1", "ko", 2026-11-05 14:30 KST)` → `"QC_원심분리기_1_ko_20261105-1430.xlsx"`, 응답 `Content-Disposition`에 `filename*=UTF-8''`.
  - `test_export_records_event_and_works_in_review`.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(sop): export outputs to formula-free Excel per language — 언어별 Excel 내보내기`

---

### Task 17: 검토 흐름·검토 요청 조건·다음 행동

**Files:**
- Create: `backend/app/sop/review.py`, `backend/tests/test_sop_review.py`
- Modify: `backend/app/routers/sop_bundles.py`

**Interfaces:**
- Consumes: Task 15 스냅숏·요약.
- Produces:
  - `async review.compute_readiness(session, bundle: Bundle) -> Readiness` — `Readiness(ready: bool, blockers: list[dict], notices: list[dict], next_action: str)`
  - 엔드포인트: `GET /api/bundles/{bundle_id}/review/readiness`(멤버), `PUT …/semantic-checks`(작성자·작업 중) `{revision, checks{numbers, conditions, tables, figures}}`, `POST …/review/request`(작성자) `{revision}`, `POST …/review/complete`(검토자) `{revision}`, `POST …/review/return`(검토자) `{revision, reason(1–2000)}`, `POST …/review/reopen`(작성자) `{revision, reason(1–2000)}`.

막는 이유(`blockers`, 하나라도 있으면 검토 요청 422 `not_ready{blockers}`): `units_unassigned`·`units_ai_suggested`·`units_on_hold`(언어별 `{code, lang, count}`), `targets_unassigned`·`targets_ai_suggested`·`targets_on_hold`(같은 꼴), `duplicate_without_reason`, `missing_reason`(사유 없는 삭제·이동·표 구성 변경), `unacked_missing_text{count}`, `semantic_checks_incomplete{missing: [...]}`, `no_reviewer`, `no_documents`(준비된 옛 문서 0), `unresolved_documents{document_ids}`(`rejected`·`failed` 문서가 남음 — 지우거나 다시 올려야 결과물이 문서를 조용히 빠뜨리지 않는다, 내 판단).

알림(`notices`, 막지 않음): `equipment_sop_empty_slots{code, slot_keys}`(장비 SOP의 `EQUIPMENT_SLOT_KEYS` 중 새 문장도 N/A도 없는 칸), `sentence_warnings{count}`.

`next_action`(개요에도 싣는다): 순서대로 처음 해당하는 것 — `upload_documents`(옛 문서 없음) · `resolve_documents` · `fill_tobe`(To-Be 문서 없음) · `decide_units`(미배정·AI 제안·보류 단위·새 문장) · `ack_warnings` · `fill_reasons` · `semantic_checks` · `add_reviewer` · `request_review` — 상태가 `in_review`면 `await_review`, `done`이면 `done`.

전이: 요청 `in_progress → in_review`(조건 통과, 계획 2의 AI 작업 취소 자리), 완료 `in_review → done`, 되돌리기 `in_review → in_progress`(사유), 다시 열기 `done → in_progress`(사유). 다른 상태에서 부르면 409 `invalid_transition`. `in_progress`로 돌아갈 때 의미 검토 확인을 모두 거짓으로 되돌린다(내용이 바뀔 수 있어 다시 확인하게, 내 판단). 기록 `review.request`·`review.complete`·`review.return`·`review.reopen`·`semantic_checks`(사유 포함). 작성자는 검토 완료를 못 한다(한 사람 한 역할이라 역할 검사로 막힌다).

- [ ] **Step 1: 실패하는 테스트**
  - `test_request_review_blocked_by_one_unassigned_unit`: 하나만 남기고 다 확정, 확인 4항목·검토자 있음 → 422, `blockers == [{"code": "units_unassigned", "lang": "ko", "count": 1}]`. 그 단위를 확정하면 200, 상태 `in_review`.
  - `test_blockers_cover_each_condition`(parametrize): 보류 1, 닫지 않은 누락 의심 1, 확인 항목 하나 빠짐, 검토자 0, 거절된 문서 1 → 각 코드.
  - `test_content_locked_in_review`: 관계 묶음 저장·업로드·To-Be 쓰기 → 409 `bundle_not_editable`, 결과물·Excel은 200.
  - `test_reviewer_completes_or_returns`: 완료 → `done`, 되돌리기 → `in_progress`·확인 항목 초기화·이벤트 사유.
  - `test_author_reopens_done_bundle_with_reason`.
  - `test_author_cannot_complete_review`: 403 `role_required`.
  - `test_equipment_notice_does_not_block`.
  - `test_next_action_sequence`: 빈 묶음 `upload_documents` → 업로드 뒤 `fill_tobe` → To-Be 뒤 `decide_units`.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(sop): gate review requests on coverage and semantic checks — 검토 요청 조건·검토 흐름`

---

### Task 18: 합성 자료 생성기와 처음부터 끝까지 테스트

**Files:**
- Create: `backend/scripts/synthetic_sop.py`, `backend/tests/test_sop_e2e.py`
- Modify: `backend/requirements-dev.txt`(`python-docx==1.2.0`)

**Interfaces:**
- Consumes: 모든 앞 태스크의 API.
- Produces:
  - `synthetic_sop.SyntheticBundle(directory: Path, documents: list[SyntheticDocument], tobe_file: Path, expected: dict)`, `SyntheticDocument(path: Path, side: str, layout: str, doc_type: str | None, parent_code: str | None)`
  - `synthetic_sop.build_synthetic_bundle(out_dir: Path) -> SyntheticBundle` — 파일과 `expected.json`을 쓰고 돌려준다. 같은 입력이면 같은 바이트(문서 속성 시각 고정).
  - `expected.json` 형식(계획 2의 가짜 AI가 같은 파일을 정답으로 쓴다):

```json
{
  "bundle_title": "SYNTHETIC QC Centrifuge",
  "edits": [{"doc": "OLD-1", "op": "split", "unit_text": "…", "at_text": "…"},
            {"doc": "OLD-4", "op": "set_layout_table", "table_index": 0, "is_layout": true}],
  "answers": [
    {"doc": "OLD-1", "text": "…", "occurrence": 1, "group": "g01",
     "disposition": "assigned", "reason": "",
     "targets": [{"key": "t01", "code": "SOP-CF", "slot_key": "responsibilities",
                  "text": "…", "change_type": "tone"}]},
    {"doc": "OLD-5", "text": "…", "occurrence": 1, "group": "g40", "disposition": "delete", "reason": "…", "targets": []}
  ],
  "match": {"identical_count": 0, "new_texts": [{"doc": "WI-04", "text": "…"}]},
  "omitted": {"doc": "OLD-2", "text": "…", "occurrence": 1}
}
```

  단위는 (문서 번호, 정확한 글자, 같은 글자 중 몇 번째)로 가리킨다. 같은 `group`의 답들은 한 번에 저장하고, 같은 `key`의 새 문장은 합침이다. 표 답은 `kind`, `grid`, 칸 `targets`를 갖고 그림 답은 `kind: "figure"`를 갖는다. 위치 키는 `slot_key` 또는 `wi_step`+`wi_part` 또는(입구 2) `section_path`.

합성 내용(스펙 §13, 도메인 사례 §1). 모든 문장은 지어낸 것이고 파일 이름은 `SYNTHETIC_` 접두, DOCX 핵심 속성 `title`·`subject`에 `SYNTHETIC`:
- `OLD-1` Eppendorf(DOCX, 한/영 연달아): 1–7절 제목, 책임 문장(→ SOP `responsibilities`, 말투), 조작 문장(→ `WI-01`), 나눌 복합 문장 `"로터를 장착하고 뚜껑을 닫은 후 START 버튼을 누른다."`(편집으로 나눈 뒤 `WI-01` 3·4단계), 데이터 표 2×3(→ `WI-01`), 캡션 있는 그림(PNG는 Pillow로 생성), 같은 문장 반복 1건(두 절에 같은 글자).
- `OLD-2` Eppendorf 5702R(DOCX, 연달아): `OLD-1`과 합칠 문장 1쌍(→ `WI-01` 합침), 중복 배정 1건(SOP `general_requirements.safety`와 `WI-01`, 사유 있음), 일부러 남기는 누락 1건(`omitted`).
- `OLD-3` Beckman Coulter(DOCX, 한/영 따로: 한글 전체 뒤 영어 전체): 삭제 1건(사유), 머리말·꼬리말(구조 제목·머리말 일괄 삭제).
- `OLD-4` Thermoscientific(DOCX, 연달아): 한/영 두 열 레이아웃 표 하나(편집으로 레이아웃 전환), 다른 문서로 이동 1건(`SOP-QC-99999`, 사유), 텍스트 상자 1개.
- `OLD-5` Labogene(텍스트 PDF, 영어만, ASCII): `WI-04`와 짝 맞출 문장들.
- `WI-04` Labogene 운전(새 문서 DOCX, 영어만): `OLD-5`와 글자가 같은 문장 여러 개(한 번에 확정), 고쳐 쓴 문장 1(말투), 나눈 문장 1(1:2), 신규 문장 1, `OLD-5`에서 짝이 없는 문장 1(삭제).
- To-Be(`tobe.xlsx`): `SOP-CF` `Use and Maintenance of QC Centrifuge`(장비 SOP, `procedures.troubleshooting` N/A), `WI-01` Eppendorf(단계 1–5), `WI-02` Beckman Coulter, `WI-03` Thermoscientific. `WI-04`는 업로드로 생긴다(부모 `SOP-CF`).
- 메인 추출기가 텍스트 상자를 읽으므로 합성 문서로는 누락 의심 경고가 나오지 않아야 한다(대조의 경고 경로는 Task 7 단위 테스트가 맡는다).

- [ ] **Step 1: 실패하는 테스트**(`test_sop_e2e.py`, 생성기는 `tmp_path`에)
  - `test_synthetic_files_are_marked`: 모든 파일 이름이 `SYNTHETIC_`로 시작하고 DOCX 속성 `title`에 `SYNTHETIC`.
  - `test_end_to_end_both_entrances`(한 함수에 단계별 단언, `settings.ai_enabled is False`를 먼저 확인):
    1. 묶음 생성(`is_synthetic=True`), 검토자 추가, To-Be 가져오기.
    2. 옛 문서 5개·새 문서 1개 업로드 → 모두 `ready`, 누락 의심 경고 0, 모든 문서 커버리지 문제 0.
    3. 언어 배치 지정(`OLD-3` 따로, `OLD-5` 영어만), `edits` 적용.
    4. `answers`를 `group`별로 저장하되 `omitted`는 건너뛴다. `match`는 같은 글자 후보로 한 번에 확정한 뒤 나머지를 관계 묶음 저장으로 맞춘다.
    5. 확인 4항목 표시 → 검토 요청 422, `blockers`에 `units_unassigned` 1건(그 언어).
    6. `omitted`를 저장 → 검토 요청 200.
    7. A·B·C·요약(두 언어): 요약 `unassigned == 0`, `duplicate == 1`, `deleted`·`moved`·`new` 기대값, B의 간선 합이 기대값.
    8. Excel 두 언어 → 시트 4개, 수식 칸 0, A 시트 데이터 줄 수 = A JSON 줄 수.
    9. 검토자 완료 → `done`, 이후 저장 409.
    10. 모든 옛 커버 단위의 상태가 정확히 하나(`confirmed`)다.
  - `test_two_authors_get_identical_output_format`: 같은 합성 자료로 묶음 두 개를 다른 작성자(`qa.member`, `ops.member`)가 처리 → A·B·C JSON에서 `unit_id`·`display_id`·`confirmed_by`·`confirmed_at`·묶음 id·문서 id를 지운 결과가 같다.
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `test(sop): drive both entrances end to end with synthetic SOPs — 합성 자료 E2E`

---

### Task 19: 로컬 데모 시드

**Files:**
- Create: `backend/scripts/seed_sop_demo.py`, `backend/tests/test_seed_sop_demo.py`

**Interfaces:**
- Consumes: Task 18 생성기, 앞 태스크 API.
- Produces: `async seed_sop_demo.main() -> int` — 실행 `python -m scripts.seed_sop_demo`(bash·PowerShell 병기 docstring).

동작: `reset_db`와 같은 가드(postgres에 HR 직원이 있으면 아무것도 하지 않고 종료 코드 1), `AUTH_MODE`가 dev가 아니면 종료 코드 1. `fastapi.testclient.TestClient(app)`로 앱 API를 그대로 부른다(로직을 두 벌 두지 않는다, `X-Dev-User`). 합성 묶음 세 개를 만든다: `SYNTHETIC 1 쪼개기 직후`(업로드·편집까지), `SYNTHETIC 2 분류 절반`(답의 절반 저장), `SYNTHETIC 3 검토 대기`(전부 저장 후 검토 요청). 작성자 `qa.member`, 검토자 `qa.lead`. 이미 같은 제목 묶음이 있으면 그 묶음은 건너뛴다. 끝에 묶음별 상태·진행 숫자를 출력한다(원문 글자는 출력하지 않는다).

- [ ] **Step 1: 실패하는 테스트** — `test_seed_refuses_on_production_like_db`(가드 함수 단위), `test_seed_creates_three_bundles_at_stages`(임시 sqlite `DATABASE_URL`로 자식 프로세스 실행 → 종료 코드 0, 묶음 3개의 상태 `in_progress`·`in_progress`·`in_review`, 두 번째 실행은 새 묶음을 만들지 않는다).
- [ ] **Step 2: 실패 확인** → FAIL. **Step 3: 구현.** **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(sop): seed a local demo with synthetic bundles at three stages — 로컬 데모 시드`

---

### Task 20: 문서·버전 v0.2.0

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/README.md`, `CHANGELOG.md`, `PROGRESS.md`, `frontend/package.json`·`frontend/package-lock.json`(버전), `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`(이 계획에서 정한 것 반영)

- [ ] **Step 1: CLAUDE.md** — Architecture의 backend 핵심 모듈에 `app/sop/`(추출 자식 프로세스·순수 결과물·떼어 내기 단일 함수·`get_cover_status`)와 라우터 `sop_*`를 더하고, 체크리스트에 "SOP 규칙 이중 사용 지점"(빈 글자 판정 `is_blank_char` 하나, 관계 묶음 접기 `groups` 하나, 상태 계산 `get_cover_status` 하나, 업무 규칙 거절 `raise_rule` 모양)과 로컬 데모 시드 명령(bash·PowerShell)을 적는다.
- [ ] **Step 2: README·docs/README·백업 문서** — 기능 요약 한 단락과 시드 명령, 인덱스에 이 계획·QA 문서 행. `docs/deploy/backup.md`에 "DB에 SOP 원문과 원본 파일이 들어가므로 덤프도 대외비 자료"를 적는다(스펙 §10, 기존 0700·사적 오프서버 사본 정책 그대로).
- [ ] **Step 3: 설계 문서** — 이 계획이 정한 것(파일 이름 파싱 규칙, 표시 ID 꼴, 레이아웃 표 바꾸기를 편집으로 다룸, 검토를 막는 거절 문서, 확인 항목 초기화, Excel 영어판 시트 이름, 409 응답의 `current_revision`)을 해당 절에 "(계획 1에서 정함)"으로 한 줄씩 적는다.
- [ ] **Step 4: 버전** — `cd frontend && npm version minor --no-git-tag-version`(0.1.0 → 0.2.0), CHANGELOG `v0.2.0` 항목(범위·주요 변경·배포 메모: 새 env 6개, compose 메모리 상한 결과, 서버 빌드 때 PyPI에서 새 의존성을 받는다, 미배포).
- [ ] **Step 5: 전체 검증** — backend 전체 pytest·ruff, frontend `npx vitest run`·`npx tsc --noEmit -p tsconfig.json`·`npm run lint`, 3.11 venv에서 `python -c "import app.main"`.
- [ ] **Step 6: 커밋** — `chore(release): v0.2.0 — deterministic SOP restructuring core — 결정적 코어 v0.2.0`. 태그 `v0.2.0`은 전체 리뷰를 통과한 뒤 컨트롤러가 단다(`git tag -a v0.2.0` + `git push sop-archivist v0.2.0`).
