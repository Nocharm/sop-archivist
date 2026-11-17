# 표준 골격(작업 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 저장소 규칙이 스킬 기본 절차보다 먼저다(루트 `CLAUDE.md` "일 크기에 맞는 절차"): 검토는 브랜치 끝에 한 번, 하위 에이전트는 서버·브라우저를 띄우지 않고 고친 파일의 단위 시험·lint·tsc까지만, 스모크는 메인 세션이 브랜치 끝에 한 번.

**Goal:** SOP 칸을 코드 상수 15개에서 "관리자가 고치는 표준 골격 + 문서마다 사본"으로 바꾸고, 기본값을 회사 SOP 템플릿(1–9장)으로 한다.

**Architecture:** 먼저 지금의 15칸을 그대로 DB 골격으로 옮겨 모든 코드가 문서 사본에서 읽게 한다(동작은 그대로). 그다음 골격의 내용을 템플릿으로 바꾸고 개발 데이터를 옮긴다. 새 문장의 자리 칸 `target_sentences.slot_key`와 N/A 표 `target_doc_na_slots`는 그대로 두고, 값이 문서 사본의 항목 키를 가리킨다. 위계는 지금처럼 키의 점(`.`)으로 적는다(부모 = 마지막 점 앞) — 접두사로 부모를 찾는 기존 코드가 살아남는다.

**Tech Stack:** FastAPI · SQLAlchemy(async) · Alembic(batch, sqlite·postgres) · Pydantic / Next.js 16 · React 19 · TS · vitest / Playwright 스모크.

**Spec:** `docs/superpowers/specs/2026-11-17-template-fit-design.md` §6 작업 1, 부록 A. 기준 코드는 `dev` v1.1.24(`fa20953`) — 설계의 v1.1.18 뒤에 v1.1.23(하위 칸이 있는 칸의 직접 줄은 번호 없음)이 들어왔다.

**상태:** 사용자 확인 2026-11-17("확인받을 것" 1–5 · 7–9는 권한 대로, 6번 부록 안 번호는 스텝 4 전에 원본 확인). 스텝 1 · 2 · 3 · 4 끝남(`feat/outline`에 합침, `dev`에는 아직). 다음은 스텝 5 — 그 앞에 "글머리 기호 줄 들여쓰기"를 한 스텝으로 넣을지 사용자와 정한다(`PROGRESS.md` 스텝 4 항목의 남은 것 ②).

## Global Constraints

- 실제 문장·사람 이름·회사 로고·템플릿 파일은 저장소에 넣지 않는다. 시험 자료는 합성, 파일 이름 `SYNTHETIC_`.
- AI 규칙·프롬프트 글(`ai/seeds/rules.md`, `prompt.*.md`)은 바꾸지 않는다(D6). 후보 배선만 바꾼다.
- N/A는 사람만 정한다(RW02). AI·코드가 빈 항목을 N/A로 채우지 않는다.
- 표준은 권고다. 구조 지적·"비어 있음"은 경고일 뿐 검토 요청을 막지 않는다.
- 운영 DB에는 작성 중인 문서가 없다고 본다(D3). 개발 데이터는 마이그레이션으로 옮긴다(D9).
- 항목 키: `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`, 100자 이내. `:`을 쓰지 않는다(프런트가 `step:` · `unstepped:` · `path:` · `slot:<doc>:<key>`를 `:`으로 가른다).
- 모델을 바꾸면 Alembic 리비전(배포 런타임 Python 3.11, `batch_alter_table`). 아래 번호(0022–0024)는 지금 머리 `0021` 기준이다. `dev`를 합쳐 왔을 때 `dev`에 새 리비전이 있으면 이쪽 리비전의 번호와 `down_revision`을 그 뒤로 민다(머리가 둘이면 기동이 죽는다).
- 새 권한은 3곳(backend `catalog.py` ↔ frontend `access.ts` ↔ i18n en·ko), 새 거절 코드는 `rule.<code>` en·ko.
- 화면·동작·라벨을 바꾸는 커밋에서 `frontend/public/manual/user-manual.md` 글을 함께 고친다(그림은 다음 MINOR).
- **이 세션의 작업은 `dev`에 합치지 않는다(사용자 결정 2026-11-17).** 모음 브랜치 `feat/outline`에 쌓고, 필요할 때 `dev`를 `feat/outline`으로 합쳐 오고, 마지막 마무리 때 한 번 `dev`에 합친다. 스텝마다 스텝 브랜치 `feat/outline-<n>-<이름>`을 `feat/outline`에서 따서 그 스텝의 diff만 검토해 `feat/outline`에 합친다.
- PATCH(`npm version patch --no-git-tag-version`) · `CHANGELOG.md`는 마지막에 `dev`에 합칠 때 한 번. `PROGRESS.md`는 스텝마다 적고 합칠 때 한 항목으로 줄인다. 푸시는 GitHub `origin`에만.
- 커밋 전: backend `ruff check app/ tests/` · `pytest tests/ -q -n auto`, frontend `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`.

## 스텝과 브랜치

| # | 스텝 브랜치 | 한 문장 | 화면에서 보이는 것 | Alembic |
|---|---|---|---|---|
| 1 | `feat/outline-1-bullet` | 줄 번호 표시에 글머리 기호를 더한다 | Order 화면의 표시 단추에 "•" | 0022 |
| 2 | `feat/outline-2-doc-copy` | 15칸을 DB 골격과 문서 사본으로 옮기고 모든 코드가 사본에서 읽는다 | 화면은 그대로(전체 스모크로 확인) | 0023 |
| 3 | `feat/outline-3-admin` | 관리자가 표준 골격을 고친다 | Admin의 Outline 탭 | – |
| 4 | `feat/outline-4-template` | 표준을 회사 템플릿 1–9장으로 바꾸고 개발 데이터를 옮긴다 | To-Be 표·Assign 나무·결과물 C가 9장, 내용은 글머리 기호 | 0024 |
| 5 | `feat/outline-5-declare` | 6장 절차·9장 부록·5장 범주를 문서마다 선언한다 | To-Be 패널의 선언 목록, Excel `SOP 절차` 시트 | – |
| 6 | `feat/outline-6-deviation` | 표준에서 벗어나면 사유를 남기고 빈 필수 항목을 경고한다 | "표준과 다름" 표시, "비어 있음" 경고 | – |

모음 브랜치 `feat/outline`(워크트리 `sop-archivist-template`)에서 스텝 브랜치를 차례로 따고, 스텝이 끝나면 그 스텝의 diff만 검토해 `feat/outline`에 합친다. `dev`를 합쳐 오는 때: 스텝을 시작하기 전, 그리고 `dev`에 이 계획이 고치는 파일(아래 File Structure)을 건드린 머지가 들어왔을 때. 마지막에 `feat/outline` → `dev`는 전체를 다시 검토하지 않고 `dev`를 합친 뒤의 시험과 전체 스모크로 본다.

Assign 화면(`assign/page.tsx`)은 스텝 2에서 한 줄(목적지 목록 만들기)만 고치고, 선언 UI는 To-Be 패널에만 둔다 — 진행 중인 `feat/assign-ai-focus`, 1.2.0 피드백 8번(가상화)과 겹치지 않게.

## 확인받을 것 (설계 §9와 계획하다 찾은 빈 곳)

설계 §9에서 작업 1에 걸린 것:
1. 관리자가 표준을 고치면 **새 문서부터** 적용한다(기존 문서 사본은 그대로).
2. 장비 SOP의 N/A 권장(옛 6.2–6.4)과 검토 알림 `equipment_sop_empty_slots`를 없애고, 장비 표시는 6장 권장 절 이름(Electronic Record Control · Troubleshooting · Maintenance)을 띄우는 데만 쓴다.
3. 옛 AI 칸 ID → 새 후보 대응표(설계 §6 작업 1 #11) 그대로.
4. 8장은 배정할 수 있는 글머리 기호 항목, 9장은 선언하는 부록, 7.1.x 번호는 남은 항목끼리, 5장에는 범주 없는 항목 허용.

계획하다 찾은 것(권하는 답을 앞에):
5. **옛 6 칸(`procedures`)에 직접 놓인 줄** — 설계의 마이그레이션 표에 없다. 권함: 6장의 머리 글로 그대로 둔다(번호 없음, v1.1.23 규칙 유지). 다른 길: 첫 절차로 옮긴다.
6. **부록 안 번호** — "Appendix 2 안은 2., 2.1."을 "부록 자신이 2., 그 안의 줄은 2.1, 2.2, 2.1.1"로 읽었다. 원본에서 부록 안 첫 수준 줄이 `2.1`인지 확인이 필요하다.
7. **개발 데이터의 번호 표시** — 1–5 · 7 · 8장으로 옮겨진 줄 가운데 `numbered`로 저장된 것은 `bullet`로 바꾼다(템플릿 모양에 맞춘다). 6장 · 부록은 그대로.
8. **줄을 다른 절로 옮길 때** — 번호 ↔ 글머리 기호는 도착한 절의 기본 표시로 바꾸고, 생략 · 주석은 그대로 둔다.
9. **필수 장을 빼면(벗어남)** 뒤 장의 번호가 당겨진다(번호는 순서에서 센다). 5장 범주는 하위 항목(노드)으로 둔다(설계의 빌더 재량).

## Review Focus

1. 표준을 고치기 전에 만든 문서는 사본이 그대로다(스텝 3 `test_admin_edit_applies_to_new_docs_only`).
2. 마이그레이션 뒤 되돌리기 — 옛 키가 든 판단 단계(`DecisionStep.before/after`)를 되돌려도 줄이 새 키 자리에 놓인다(스텝 4 `test_migration_rewrites_keys_in_json`).
3. 확정 줄이 있는 절차의 이름·순서를 바꿔도 연결·확정은 그대로이고 번호와 칸 제목 글만 따라간다(스텝 5 `test_rename_and_reorder_keep_confirmed_lines`).
4. 관리자가 넣은 키에 `:`이나 대문자·빈칸이 있으면 거절한다(스텝 3 `test_admin_rejects_bad_key`).
5. 문서 종류를 SOP → WI → SOP로 바꾸면 사본이 지워졌다 다시 생긴다(스텝 2 `test_doc_type_change_drops_and_recopies_outline`).

---

## File Structure

| 파일 | 책임 | 스텝 |
|---|---|---|
| `backend/app/sop/outline.py` (새) | 골격 값 객체 `DocOutline`(찾기·부모·번호·수준·배정 가능·줄 세기), 표준 시드, 문서 사본 만들기·읽기 | 2, 4 |
| `backend/app/sop/outline_edit.py` (새) | 문서 사본의 선언·이름·순서·빼기·벗어남 규칙 | 5, 6 |
| `backend/app/routers/sop_outline.py` (새) | 관리자 표준 API `/api/admin/outline` | 3 |
| `backend/app/sop/models.py` | `OutlineStandardItem`, `TargetDocOutlineItem`, `number_style` CHECK | 1, 2 |
| `backend/app/sop/outputs.py` · `tobe.py` · `decisions.py` · `routers/sop_outputs.py` · `snapshot.py` · `ai/candidates.py` | 고정 목록 읽기를 문서 사본 읽기로 | 2, 4 |
| `backend/alembic/versions/0022…0024` | CHECK · 표와 사본 채우기 · 템플릿 전환 | 1, 2, 4 |
| `frontend/src/lib/api-sop.ts` | `OutlineItem`, 절 응답의 새 칸, `SLOT_KEYS` 삭제 | 1, 2 |
| `frontend/src/lib/slot-status-model.ts` · `classify-model.ts` · `section-number.ts` · `c-edit-model.ts` | 고정 목록·점 파싱을 서버 골격 읽기로, `slot-labels.ts` 삭제 | 2 |
| `frontend/src/components/admin/outline-panel.tsx` (새) | 표준 골격 고치기 | 3 |
| `frontend/src/components/tobe/outline-declare.tsx` (새) | 절차·부록·범주 선언 목록(`ToBePanel` 안) | 5 |

---

### Task 1: 글머리 기호 표시 — `feat/outline-1-bullet`

**Files:**
- Modify: `backend/app/sop/constants.py`(`NumberStyle`, `NUMBER_STYLES`), `backend/app/sop/models.py`(CHECK는 `_build_in_check`가 따라간다), `backend/app/sop/outputs.py`(`number_targets`, 결과물 A의 `dest_number`), `backend/app/sop/sheet_model.py`(C 시트 번호 칸)
- Create: `backend/alembic/versions/0022_number_style_bullet.py`(`0011_target_number_style.py`의 batch CHECK 바꾸기 방식)
- Modify: `frontend/src/lib/api-sop.ts:1157`, `frontend/src/lib/section-number.ts`, `frontend/src/components/outputs/output-c.tsx`(표시 단추·줄 머리), 새 줄 머리를 그리는 곳(`composed-model.ts`를 쓰는 New 칸), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`
- Test: `backend/tests/test_sop_numbering.py`, `test_sop_excel.py`, `test_migrations.py`, `frontend/src/lib/section-number.test.ts`

**Interfaces:**
- Produces: `NUMBER_BULLET = "bullet"`; `NUMBER_STYLES = ("numbered", "omitted", "note", "bullet")`. 글머리 기호 줄은 세지 않는다(생략과 같은 깊이 규칙). 결과물 C 줄의 `number`는 `null`이고 화면이 "•"를 그린다. 결과물 A · Excel의 `No.`는 그 절의 번호다.

- [x] **Step 1: 실패하는 시험** — `test_sop_numbering.py`
  - `test_bullet_line_is_not_counted`: `purpose`에 표시 `[numbered, bullet, numbered]` → 줄 번호 `["1.1", None, "1.2"]`.
  - `test_bullet_row_shows_section_number_in_output_a`: 같은 자료의 결과물 A에서 글머리 기호 줄의 `dest_number == "1"`.
  - `test_migrations.py::test_0022_accepts_bullet`: 올린 DB에 `number_style='bullet'` 줄을 넣을 수 있고 `'dots'`는 CHECK로 막힌다.
- [x] **Step 2: 돌려서 실패 확인** — `.venv/bin/python -m pytest tests/test_sop_numbering.py tests/test_migrations.py -q`
- [x] **Step 3: 구현** — 상수 · 리비전 · `number_targets`(bullet은 `isCounted` 아님) · A 행의 번호 대체 · C 시트는 번호 칸에 "•".
- [x] **Step 4: 프런트** — `NumberStyle`에 `"bullet"`, `NUMBER_STYLES`에 더하고 vitest `readStyleChoices`가 넷을 내놓는지(하위 칸이 있는 칸은 `numbered`만 뺀 셋). 표시 단추에 아이콘 + 호버 설명(en "Bullet" / ko "글머리 기호"), 줄 머리에 "•".
- [x] **Step 5: 확인** — backend 전체 시험, 프런트 lint · tsc · vitest, Order 화면 스모크(`QUIET=1 ONLY="order:" node scripts/pw-smoke-sop.mjs` — 접두사는 스크립트의 Order 단계 이름으로 맞춘다).
- [x] **Step 6: 설명서 글 · PROGRESS → 커밋 → 스텝 diff 검토 → `feat/outline`**

---

### Task 2: 15칸을 DB 골격과 문서 사본으로 — `feat/outline-2-doc-copy`

동작은 바뀌지 않는다. 표준의 내용은 지금의 15칸 그대로다.

**Files:**
- Create: `backend/app/sop/outline.py`, `backend/alembic/versions/0023_outline_items.py`, `backend/tests/test_sop_outline.py`
- Modify: `backend/app/sop/models.py`, `constants.py`, `outputs.py`, `output_labels.py`, `tobe.py`, `decisions.py`, `snapshot.py`, `routers/sop_outputs.py`, `routers/sop_tobe.py`, `ai/candidates.py`, `app/main.py`(lifespan 시드 — `seed_guidelines` 옆)
- Modify: `frontend/src/lib/api-sop.ts`, `slot-status-model.ts`, `classify-model.ts`, `section-number.ts`, `c-edit-model.ts`, `components/tobe/slot-table.tsx` · `tobe-section.tsx` · `slot-bar.tsx`, `components/assign/destination-tree.tsx`, `app/bundles/[id]/assign/page.tsx:404`, `components/outputs/output-c.tsx:849`
- Delete: `frontend/src/lib/slot-labels.ts`
- Test: `backend/tests/test_sop_outline.py`, `test_migrations.py`, 기존 `test_sop_tobe.py` · `test_sop_outputs.py` · `test_sop_numbering.py` · `test_sop_ai_candidates.py`; `frontend/src/lib/slot-status-model.test.ts` · `classify-model.test.ts` · `section-number.test.ts` · `c-edit-model.test.ts`

**Interfaces — 모델**

```python
OUTLINE_KINDS = ("general", "category_table", "named_children", "auto_list", "group")
OUTLINE_ORIGINS = ("standard", "declared", "custom")

class OutlineStandardItem(Base):      # outline_standard_items
    key: str            # String(100) PK
    order_index: int
    title_en: str       # String(200)
    title_ko: str       # String(200), 빈 문자열 허용
    kind: str           # String(16), CHECK OUTLINE_KINDS
    is_required: bool
    default_style: str  # String(8), CHECK NUMBER_STYLES
    child_prefix: str   # String(40), "" 이면 하위 번호가 "부모.n", "Appendix"면 "Appendix n."
    suggestions: list   # JSON, 권장 이름(5장 범주 · 6장 절 이름)

class TargetDocOutlineItem(Base):     # target_doc_outline_items, PK (target_doc_id FK CASCADE, key)
    # 위 칸 전부(suggestions 제외) + origin(String(8), CHECK OUTLINE_ORIGINS)
    #   + is_removed: bool(기본 False) + deviation_reason: str | None(Text)
```

종류의 뜻(스텝 2에서 정하고 스텝 4에서 다 쓴다):

| 종류 | 직접 배정 | 직접 줄 세기 | 하위 |
|---|---|---|---|
| `general` | 됨 | 줄의 표시대로 | 없음(사용자 항목은 스텝 6) |
| `category_table` | 됨(범주 없는 항목) | 안 셈 | 범주 — 번호 없는 제목 |
| `named_children` | 됨(머리 글) | 안 셈 | 선언한 절 — `부모.n` 또는 `child_prefix n.` |
| `group` | 안 됨 | – | 하위만 |
| `auto_list` | 안 됨 | – | 없음(앱이 채움) |

스텝 2의 표준은 `SLOT_KEYS` 15개이고 5 · 6 · 7은 `named_children`(지금처럼 직접 줄을 받되 세지 않는다), 나머지는 `general`, 모두 `is_required=True` · `default_style="numbered"` · `origin="standard"`. 제목은 `SLOT_LABELS`의 마지막 조각.

**Interfaces — `outline.py`**

```python
def get_parent_key(key: str) -> str | None            # "a.b.c" -> "a.b", "a" -> None

@dataclass(frozen=True)
class OutlineItemInfo:
    key: str; title_en: str; title_ko: str; kind: str; is_required: bool
    default_style: str; child_prefix: str; order_index: int
    origin: str; is_removed: bool; deviation_reason: str | None

class DocOutline:
    def __init__(self, items: Sequence[OutlineItemInfo]) -> None
    items: tuple[OutlineItemInfo, ...]                 # 빠진(is_removed) 항목을 뺀, 위계 순서(부모 바로 뒤에 하위)
    def find(self, key: str) -> OutlineItemInfo | None
    def list_children(self, key: str | None) -> list[OutlineItemInfo]
    def is_within(self, key: str, ancestor: str) -> bool        # 자기 자신 포함
    def get_level(self, key: str) -> int                        # 최상위 0
    def get_number(self, key: str) -> str | None                # "5", "5.1"; 번호 없는 항목은 None
    def get_label(self, key: str) -> str                        # "General Requirements › Safety"
    def is_assignable(self, key: str) -> bool
    def counts_lines(self, key: str) -> bool

LEGACY_OUTLINE: tuple[OutlineItemInfo, ...]                     # SLOT_KEYS에서 만든다
async def seed_outline_standard(session) -> None                 # 표가 비었을 때만
async def copy_standard_to_doc(session, target_doc_id: int) -> None
async def load_doc_outlines(session, doc_ids: Iterable[int]) -> dict[int, DocOutline]
```

**Interfaces — API 응답에 더하는 것**(프런트와 맞춘 계약, `plan2-ai.md` "API 계약" 블록에도 적는다)

```ts
interface OutlineItem {            // ToBe.outline_items: OutlineItem[]
  code: string;                    // 새 문서 코드(ToBe의 다른 줄과 같은 키)
  key: string; parent_key: string | null; level: number; number: string | null;
  title_en: string; title_ko: string; label: string;
  kind: "general" | "category_table" | "named_children" | "auto_list" | "group";
  is_required: boolean; default_style: NumberStyle;
  is_assignable: boolean; counts_lines: boolean;
  origin: "standard" | "declared" | "custom"; is_removed: boolean; deviation_reason: string | null;
}
// OutputC.docs[].sections[] 와 ComposedSection 에 더한다:
//   kind: OutlineItem["kind"] | null   (WI 단계 · path: 절은 null)
//   level: number; counts_lines: boolean; default_style: NumberStyle;
```

- [x] **Step 1: `test_sop_outline.py` — 값 객체** (실패 먼저)
  - `test_legacy_outline_matches_slot_keys`: `[i.key for i in DocOutline(LEGACY_OUTLINE).items] == list(SLOT_KEYS)`.
  - `test_numbers_follow_order`: `get_number("purpose") == "1"`, `"procedures.troubleshooting"` → `"6.3"`, `"document_relationships.appendices"` → `"7.2"`.
  - `test_named_children_do_not_count_direct_lines`: `counts_lines("procedures") is False`, `counts_lines("procedures.procedure") is True`.
  - `test_three_levels`: `a` · `a.b` · `a.b.c`로 `get_level("a.b.c") == 2`, `is_within("a.b.c", "a") is True`, `get_parent_key("a.b.c") == "a.b"`.
- [x] **Step 2: 모델 · 리비전 0023** — 표 둘을 만들고, 리비전 파일 안에 **얼려 둔** 15칸 목록으로 `doc_type='sop'`인 기존 `target_docs`마다 사본을 넣는다(앱 코드를 import하지 않는다). `test_migrations.py::test_0023_backfills_sop_docs`: 0022까지 올린 DB에 SOP 1 · WI 1을 넣고 올리면 SOP에만 15줄.
- [x] **Step 3: 시드와 사본** — `seed_outline_standard`를 lifespan과 시험 설비(`seed_guidelines`를 부르는 곳)에 넣는다. `tobe.apply_tobe`가 SOP 문서 줄을 새로 넣을 때 `copy_standard_to_doc`, 종류가 WI로 바뀌면 사본을 지우고 SOP로 바뀌면 다시 복사한다. 시험: `test_new_sop_doc_gets_outline_copy`, `test_wi_doc_has_no_outline`, `test_doc_type_change_drops_and_recopies_outline`.
- [x] **Step 4: 읽는 쪽 바꾸기 (backend)** — 아래를 문서 사본 읽기로 바꾼다. 응답 글·번호·순서는 그대로여야 한다(기존 시험이 증거).
  - `snapshot.TargetDocInfo.outline: DocOutline`(SOP가 아니면 빈 골격).
  - `outputs._plan_sections` SOP 갈래: `doc.outline.items` 순서. `_SectionPlan`에 `kind` · `level` · `counts_lines` · `default_style`. `SLOT_NUMBERS` · `_build_slot_numbers` · `has_sub_slots` 삭제. `_find_na_reason`은 조상을 끝까지 본다. `_format_target_location`과 칸 제목 글(`decisions.py:730`)은 `outline.get_label(key)`.
  - `unknown_slot` 검사 3곳(`tobe._check_list_rules`, `decisions._check_location`, `sop_outputs._check_slot_moves`)은 그 문서의 `outline.find(key)`.
  - `tobe.count_targets_by_slot` · `build_tobe_out`의 순서는 사본의 순서. `ToBeOut.outline_items` 추가.
  - `ai/candidates._list_sop_places`: 사본에서 `is_assignable`인 항목을 순서대로(후보 수 · 순서 · 라벨이 지금과 같다 — `test_sop_ai_candidates.py`).
  - `constants.SLOT_KEYS`는 `LEGACY_OUTLINE`의 재료와 시험 값으로만 남는다.
- [x] **Step 5: 읽는 쪽 바꾸기 (frontend)** — 실패하는 vitest 먼저.
  - `slot-status-model.ts`: `type SlotKey = string`. `buildSlotRows(tobe, doc)`는 `tobe.outline_items`에서 그 문서 줄을 읽는다. `SlotRow.level: number`(`isChild` 대신). `SLOT_NUMBERS` · `getSlotParent` · `hasSubSlots` · `KNOWN_KEYS` 삭제. `SLOT_COLUMNS` 대신 `splitSlotColumns(rows): [SlotRow[], SlotRow[]]`(최상위 항목 기준으로 반을 가른다 — 15칸에서는 지금처럼 `procedures` 앞).
  - `section-number.ts`: `listCounted(section)`은 `section.counts_lines`, `readStyleChoices(section, style)`(첫 인자가 절).
  - `c-edit-model.ts` `numberDoc`: `section.counts_lines`.
  - `classify-model.ts`: `buildDestinationOptions(tobe)`(라벨 인자 삭제, `is_assignable`만, `depth: number` = `level`), `isNa`는 `parent_key`를 따라 올라간다.
  - 시험 값: 기존 시험의 고정 절에 `counts_lines` · `level`을 더하고, 3수준 골격(`a` · `a.b` · `a.b.c`)으로 깊이 2가 나오는 경우를 하나씩 더한다.
- [x] **Step 6: 확인** — backend 전체, 프런트 lint · tsc · vitest · `npm run build`(경고 0). API 층과 공용 모델을 고쳤으니 **전체 스모크**(`node scripts/pw-smoke-sop.mjs`) — 시험 ID(`…-slot-<key>`, `assign-tree-place-slot:<doc>:<key>`)는 키가 그대로라 바뀌지 않는다.
- [x] **Step 7: `plan2-ai.md` API 계약 블록 · `backend/CLAUDE.md` · `frontend/CLAUDE.md`의 칸 설명 · PROGRESS → 커밋 → 스텝 diff 검토 → `feat/outline`**

---

### Task 3: 관리자가 표준을 고친다 — `feat/outline-3-admin`

**Files:**
- Create: `backend/app/routers/sop_outline.py`, `backend/tests/test_sop_outline_admin.py`, `frontend/src/components/admin/outline-panel.tsx`
- Modify: `backend/app/access/catalog.py`, `backend/app/main.py`(라우터 등록), `backend/app/sop/outline.py`(`replace_outline_standard`), `frontend/src/lib/access.ts`(`PERMISSIONS`, `ADMIN_TAB_PERMISSIONS`), `frontend/src/lib/api-manage.ts`, `frontend/src/app/admin/page.tsx`(`ADMIN_TABS`), `frontend/src/lib/i18n-messages.ts`, 사용 설명서

**Interfaces:**
- 권한 키 `outline.manage` — backend `PERMISSIONS` 맨 끝, frontend 같은 자리, i18n `permission.outline.manage` · `admin.tab.outline`(en·ko).
- `GET /api/admin/outline` → `{items: OutlineStandardItemOut[]}` · `PUT /api/admin/outline` body `{items: OutlineStandardItemIn[]}` → 같은 모양. 목록을 통째로 바꾼다(순서 = 배열 순서).
- `async def replace_outline_standard(session, items: list[OutlineStandardItemIn]) -> None` — 거절은 422 `outline_invalid`에 사유: `bad_key` · `duplicate_key` · `missing_parent`(부모가 없거나 자기 뒤) · `bad_kind` · `children_under_leaf`(`general` · `auto_list` 아래 하위) · `empty`(항목 0개). i18n `rule.outline_invalid.<사유>`.
- 프런트 `getOutlineStandard()` · `putOutlineStandard(items)`.

- [x] **Step 1: 실패하는 시험** — `test_admin_requires_permission`(403), `test_admin_get_returns_seed`, `test_admin_put_replaces_and_orders`, `test_admin_rejects_bad_key`(`"A b"`, `"a:b"`, `"step"`은 통과 · `"a."`는 거절), `test_admin_rejects_missing_parent`, `test_admin_edit_applies_to_new_docs_only`(표준에 항목을 더한 뒤 — 전에 만든 SOP는 15줄, 새 SOP는 16줄).
- [x] **Step 2: 구현 (backend)** — `routers/sop_guidelines.py`의 권한 의존성 방식을 따른다.
- [x] **Step 3: 화면** — `guidelines-panel.tsx`의 부품(`useLoaded`, `PanelTitle`, `showToast`, `humanizeApiError`)으로 표 하나: 번호(계산) · 키 · 영어 제목 · 한글 제목 · 종류 · 필수 · 기본 표시 · 하위 머리말 · 권장 이름. 줄 더하기 · 빼기 · 위아래 옮기기 · **Save**. 머리에 "Applies to documents created after saving"(ko "저장한 뒤에 만드는 문서부터 적용됩니다"). 시험 ID `admin-panel-outline`, `admin-outline-row-<key>`, `admin-outline-save`.
- [x] **Step 4: 확인** — backend 한 파일 + 전체, 프런트 lint · tsc · vitest, 스모크는 Admin 단계에 Outline 탭 열기 · 제목 하나 고쳐 저장 · 다시 읽기를 더해 그 단계만.
- [x] **Step 5: 설명서 글 · PROGRESS → 커밋 → 스텝 diff 검토 → `feat/outline`**

---

### Task 4: 표준을 회사 템플릿으로 — `feat/outline-4-template`

**Files:**
- Modify: `backend/app/sop/outline.py`(`TEMPLATE_OUTLINE`, 종류 규칙), `outputs.py`, `decisions.py`, `routers/sop_outputs.py`, `tobe.py`, `review.py`, `constants.py`, `ai/candidates.py`, `sheet_model.py`
- Create: `backend/alembic/versions/0024_template_outline.py`
- Modify: `backend/scripts/synthetic_sop.py` · `seed_sop_demo.py` · `seed_sop_worst.py` · `sop_demo_driver.py`, `backend/tests/fake_ai.py` · `sop_helpers.py` · `sop_map_helpers.py`와 칸 키를 쓰는 시험(많은 순: `test_sop_outputs` 75 · `test_sop_decisions` 60 · `test_sop_tobe` 55 · `test_sop_numbering` 19 · `test_sop_map` 19 · `test_sop_decision_undo` 17 · `test_sop_pair_settle` 15 · `test_sop_ai_classify` 12 · `test_sop_review` 11 · `test_sop_excel` 10)
- Modify: `frontend/src/lib/slot-status-model.ts`(`EQUIPMENT_SLOT_KEYS` · "decide" 상태 삭제), `components/tobe/slot-table.tsx`, `components/outputs/output-c.tsx`(범주 줄 · 자동 목록 절), `frontend/scripts/pw-smoke-sop.mjs`(`SLOT_ORDER`와 글자로 박힌 키), `i18n-messages.ts`, 사용 설명서("칸 15개" · 고정 절 이름)
- Docs: `docs/domain/restructuring-rules.md` §2(메모 두 줄만), 제품 명세 §6.6 · §7.13, `2026-11-17-documents-screen-design.md`의 N/A 표

**Interfaces — 기본 표준 `TEMPLATE_OUTLINE`**

| 키 | 번호 | 영어 제목 | 종류 | 필수 | 기본 표시 |
|---|---|---|---|---|---|
| `purpose` | 1 | Purpose | general | ✓ | bullet |
| `scope` | 2 | Scope | general | ✓ | bullet |
| `definitions` | 3 | Definitions | general | ✓ | bullet |
| `responsibilities` | 4 | Responsibilities | general | ✓ | bullet |
| `general_requirements` | 5 | General Requirements | category_table | ✓ | bullet |
| `procedures` | 6 | Procedures | named_children | ✓ | numbered |
| `document_relationships` | 7 | Document Relationships | group | ✓ | bullet |
| `document_relationships.associated_documents` | 7.1 | Associated Documents | group | ✓ | bullet |
| `….associated_documents.form` | 7.1.x | Form | general | – | bullet |
| `….associated_documents.visual_aid` | 7.1.x | Visual Aid | general | – | bullet |
| `….associated_documents.training_material` | 7.1.x | Training Material | general | – | bullet |
| `….associated_documents.quality_risk_assessment` | 7.1.x | Quality Risk Assessment | general | – | bullet |
| `document_relationships.work_instructions` | 7.2 | Work Instructions | auto_list | ✓ | bullet |
| `document_relationships.references` | 7.3 | References | general | ✓ | bullet |
| `attachments` | 8 | Attachments | general | ✓ | bullet |
| `appendices` | 9 | Appendices | named_children (`child_prefix="Appendix"`) | ✓ | numbered |

- `general_requirements.suggestions`: Safety, Account, Qualification, Equipment, Work, Excursion/Alarm, Material, Training, Record, Quality, Caution, Data Management.
- `procedures.suggestions`: Electronic Record Control, Troubleshooting, Maintenance(화면은 장비 SOP일 때만 띄운다 — 스텝 5).
- 새 SOP의 사본에는 `procedures.p1`("Procedure 1", `origin="declared"`)을 함께 넣는다(설계 #11).
- 선언한 하위 항목의 기본 표시: 6장 절차 · 부록은 `numbered`, 5장 범주는 `bullet`.

**Interfaces — 규칙**
- `DocOutline.get_number`: 최상위는 남은 항목 순서 1…n. `named_children`의 하위는 `부모.n`(`child_prefix`가 있으면 번호 `n`, 라벨 "Appendix n. 이름"). `category_table`의 하위(범주)는 `None`. 선택 항목이 비었고 N/A도 아니면 내보내지 않고 번호도 세지 않는다 — 그래서 번호는 결과물을 만들 때 `outputs`가 "내보낼 항목" 목록으로 다시 센다: `number_outline(outline, emitted_keys: set[str]) -> dict[str, str | None]`.
- 줄 번호의 머리(`number_lines`의 `base`): 6장 절차는 그 절 번호("6.1" → 6.1.1), 부록은 부록 번호("2" → 2.1).
- 글머리 기호 줄과 범주 안 줄의 `No.`(결과물 A · Excel)는 가장 가까운 번호 있는 조상의 번호(범주 줄은 "5").
- `group` · `auto_list`에 줄을 놓으면 422 `slot_not_assignable`(새 코드, i18n en "Lines cannot be placed in this section." / ko "이 절에는 줄을 놓을 수 없습니다."). 검사 자리는 `unknown_slot`과 같은 3곳.
- 새 문장이 처음 그 절에 놓일 때 `number_style`은 그 항목의 `default_style`. 다른 절로 옮길 때 `numbered` ↔ `bullet`은 도착 항목의 기본으로, `omitted` · `note`는 그대로(확인받을 것 8).
- 결과물 C의 `auto_list` 절: `sections[].auto_items: {code: string; title: string}[]`(그 SOP의 자식 WI, To-Be 순서). 다른 절은 빈 배열.
- 장비: `EQUIPMENT_SLOT_KEYS`, `review._list_equipment_notices`, 알림 `equipment_sop_empty_slots`와 그 문구, 프런트의 "decide" 상태를 지운다. `TargetDoc.is_equipment_sop`는 남는다.

**Interfaces — AI 후보** (`ai/candidates.py`)

```python
RULE_SLOT_GUIDE: dict[str, tuple[str, str]]     # "S1" … "S7.2" → (이름, 안내) — 지금 SLOT_GUIDE의 값을 ID로 다시 묶는다
def match_rule_slot(outline: DocOutline, key: str) -> str | None
```

| 항목 | `match_rule_slot` |
|---|---|
| `purpose` · `scope` · `definitions` · `responsibilities` | S1 · S2 · S3 · S4 |
| `general_requirements` | S5 |
| 5장 범주, 제목이 Safety / Work | S5.1 / S5.2 |
| 5장의 그 밖 범주 | S5 |
| 6장 절차, 제목에 "Electronic Record" / "Troubleshoot" / "Maintenance"(대소문자 무시) | S6.2 / S6.3 / S6.4 |
| 6장의 그 밖 절차 | S6.1 |
| `procedures`(머리 글) | S6 |
| 7.1.x · 7.3 | S7 |
| `attachments` | S7.1 |
| `appendices`와 선언한 부록 | S7.2 |
| `group` · `auto_list` | 후보가 아니다 |

후보 라벨은 `"{문서} / {outline.get_label(key)}: {안내}"`(안내는 `RULE_SLOT_GUIDE[match]`의 둘째 값, 대응이 없으면 가장 가까운 조상의 것).

**Interfaces — 리비전 0024** (파일 안에 얼려 둔 상수로만)

```python
LEGACY_KEY_MAP = {
    "general_requirements.operation": "general_requirements.work",
    "document_relationships.attachments": "attachments",
    "document_relationships.appendices": "appendices.a1",
    "document_relationships": "document_relationships.references",
}
```

1. `outline_standard_items`를 비우고 템플릿 줄을 넣는다(개발 스택에서 스텝 3으로 고친 표준은 사라진다 — 운영에는 아직 없다).
2. SOP 문서마다 사본을 템플릿으로 다시 만든다. 그 문서의 `target_sentences.slot_key` · `target_doc_na_slots.slot_key`에 쓰인 옛 하위 키는 선언 항목으로 살린다: `general_requirements.safety`("Safety") · `.work`("Work") · `procedures.procedure`("Procedure") · `.electronic_record_control`("Electronic Record Control") · `.troubleshooting`("Troubleshooting") · `.maintenance`("Maintenance") · `appendices.a1`("Appendix 1"). 6장에 선언 항목이 하나도 없으면 `procedures.p1`.
3. `LEGACY_KEY_MAP`으로 `target_sentences.slot_key`, `target_doc_na_slots.slot_key`, 그리고 JSON 안의 `slot_key`(`decision_steps.before` · `after`, `unit_decision_history.snapshot`, `ai_suggestions.content`)를 바꾼다. JSON은 파이썬에서 읽어 고쳐 쓴다(sqlite · postgres 공통).
4. 옮긴 뒤 자리의 기본 표시가 `bullet`인 줄 가운데 `number_style='numbered'`인 것을 `bullet`로(확인받을 것 7).
5. `downgrade`는 표준 · 사본을 15칸으로 되돌리고 키를 거꾸로 바꾼다(선언 항목의 내용은 가까운 옛 칸으로).

- [x] **Step 1: 실패하는 시험 — 번호** (`test_sop_numbering.py`, `test_sop_outline.py`)
  - `test_template_chapter_numbers`: 새 SOP의 절 번호가 `purpose` 1 … `attachments` 8 · `appendices` 9, `document_relationships.references` 7.3.
  - `test_empty_optional_items_are_skipped`: 7.1.x 가운데 `quality_risk_assessment`에만 줄이 있으면 그 절의 번호가 `"7.1.1"`, 나머지 셋은 절 목록에 없다.
  - `test_procedure_lines_are_numbered`: `procedures.p1`의 줄 둘(깊이 0 · 1) → `"6.1.1"`, `"6.1.1.1"`.
  - `test_appendix_restarts_from_its_number`: 부록 둘 가운데 둘째의 첫 줄 → `"2.1"`, 절 라벨 `"Appendix 2. <이름>"`.
  - `test_category_lines_are_bullets_under_five`: 범주 Safety의 줄 — `number is None`, 결과물 A `dest_number == "5"`, 절 번호 `None`.
  - `test_group_and_auto_list_reject_lines`: `document_relationships`와 `….work_instructions`에 배정 → 422 `slot_not_assignable`.
  - `test_auto_list_shows_child_wis`: 7.2 절의 `auto_items`가 자식 WI 둘의 코드 · 제목.
- [x] **Step 2: 실패하는 시험 — 마이그레이션** (`test_migrations.py`)
  - `test_0024_moves_legacy_keys`: 0023 상태의 SOP에 옛 키 9종의 줄과 N/A(`procedures.maintenance`)를 넣고 올리면 — `LEGACY_KEY_MAP`대로 옮겨지고, `procedures.maintenance`는 N/A를 지닌 선언 항목이고, `procedures`에 직접 놓인 줄은 그대로다(확인받을 것 5).
  - `test_migration_rewrites_keys_in_json`: `decision_steps.before`와 `ai_suggestions.content`의 `document_relationships.attachments` → `attachments`.
  - `test_0024_turns_numbered_into_bullets`: `purpose`의 `numbered` 줄 → `bullet`, `procedures.procedure`의 줄은 `numbered` 그대로.
- [x] **Step 3: 실패하는 시험 — AI 후보** (`test_sop_ai_candidates.py`) — `test_match_rule_slot_table`(위 표의 줄마다 한 경우), `test_candidates_skip_group_and_auto_list`, `test_candidates_skip_na_items`(지금 시험을 새 키로).
- [x] **Step 4: 구현** — `TEMPLATE_OUTLINE` · 종류 규칙 · `number_outline` · 기본 표시 · `slot_not_assignable` · 자동 목록 · 장비 알림 삭제 · 후보 · 리비전.
- [x] **Step 5: 합성 자료와 기존 시험** — `synthetic_sop.py`의 `_sop(slot_key, …)` 값과 `tobe_na_slots`, 시드 스크립트, `fake_ai.py`, 시험 도우미, 위 시험 파일의 키를 새 키로. `test_sop_outputs.py`의 `location_key == list(SLOT_KEYS)`는 템플릿 키 목록으로.
- [x] **Step 6: 프런트** — N/A 표는 스텝 2에서 이미 서버 골격을 읽는다. 여기서는 장비 "decide" 상태 삭제, 범주 줄(번호 없는 제목) · `group` · `auto_list` 줄의 모양(배정 단추 없음, 자동 목록은 WI 번호 · 제목), 결과물 C의 자동 목록 절, 스모크의 `SLOT_ORDER` · 박힌 키 · 번호 기대값. vitest: `slot-status-model.test.ts`(템플릿 골격으로 줄 수 · 수준 · 번호), `classify-model.test.ts`(`group`은 목적지 목록에 없다).
- [x] **Step 7: 확인** — backend 전체, 프런트 lint · tsc · vitest · build, 로컬 DB 다시 만들기(`scripts.reset_db` → `seed_sop_demo`) 뒤 **전체 스모크**. 옛 자료가 든 로컬 `dev.db`가 있으면 그대로 올려(기동 때 `upgrade head`) To-Be · Assign · Order 화면이 열리는지 본다.
- [x] **Step 8: 문서(도메인 §2 메모, 제품 명세 §6.6 · §7.13, Documents 화면 설계) · 설명서 글 · PROGRESS → 커밋 → 스텝 diff 검토 → `feat/outline`**

---

### Task 5: 절차·부록·범주 선언 — `feat/outline-5-declare`

**Files:**
- Create: `backend/app/sop/outline_edit.py`, `backend/tests/test_sop_outline_edit.py`, `frontend/src/components/tobe/outline-declare.tsx`, `frontend/src/lib/outline-declare-model.ts`(+ `.test.ts`)
- Modify: `backend/app/routers/sop_tobe.py`, `backend/app/sop/tobe.py`, `tobe_excel.py`, `frontend/src/lib/api-sop.ts`, `components/tobe/tobe-panel.tsx` · `tobe-section.tsx`, `i18n-messages.ts`, 사용 설명서

**Interfaces:**

| Method | Path (`/api/bundles/{bundle_id}/tobe/docs/{id}` 아래) | Body | 응답 |
|---|---|---|---|
| POST | `/outline` (201) | `NewOutlineItemIn{parent_key: str, title_en: str(1–200), title_ko: str = ""}` | `ToBeViewOut` |
| PATCH | `/outline/{key}` | `OutlineItemPatchIn{title_en?: str, title_ko?: str, position?: int(≥0, 형제 안 자리)}` | `ToBeViewOut` |
| DELETE | `/outline/{key}` | – | `ToBeViewOut` |

```python
async def add_outline_item(session, bundle, doc_id, body, actor) -> None      # 키: "{parent}.n{k}", k = 그 부모 아래에서 쓴 적 없는 다음 수
async def patch_outline_item(session, bundle, doc_id, key, body, actor) -> None
async def remove_outline_item(session, bundle, doc_id, key, actor) -> None
```

- 이 스텝에서는 부모가 `named_children` · `category_table`일 때만(선언). 그 밖의 부모는 422 `outline_parent_not_declarable`. 표준 항목의 이름 · 빼기는 422 `outline_standard_item`(스텝 6에서 사유와 함께 풀린다).
- 없는 키 404 `outline_item_not_found`. 줄이나 칸 제목이 있는 항목을 지우면 409 `slot_has_targets`(지금 코드). 같은 부모 아래 같은 영어 제목(대소문자 무시)은 422 `duplicate_outline_title`.
- 이름을 바꾸면 그 항목의 칸 제목 줄(`kind='slot_heading'`)의 글도 같은 트랜잭션에서 새 라벨로 바꾼다. 순서를 바꿔도 키는 그대로다 — 번호만 따라간다.
- To-Be `revision`을 올리고 기존 작업 기록 방식(`apply_tobe`가 남기는 것)을 따른다.
- Excel: `PROCEDURE_SHEET = "SOP 절차"`, `PROCEDURE_HEADER = ("SOP 번호", "절차 번호", "영어 제목", "한글 제목")`. 내보내기는 선언한 절차를, 가져오기는 시트가 있을 때만 그 SOP의 절차 목록을 맞춘다(영어 제목으로 기존 항목과 짝짓고, 없으면 더하고, 시트에서 빠진 항목은 줄이 없을 때만 지운다 — 있으면 409 `slot_has_targets`). 시트가 없으면 건드리지 않는다(`ParsedWorkbook.procedures = None`).
- 프런트 `addOutlineItem(bundleId, docId, parentKey, titleEn, titleKo)` · `patchOutlineItem(…)` · `removeOutlineItem(…)`. `OutlineDeclare` props: `{ prefix, parent: OutlineItem, items: OutlineItem[], suggestions: string[], canEdit, saving, onAdd(titleEn), onRename(key, titleEn, titleKo): Promise<boolean>, onMove(key, position), onRemove(key) }`. 표준의 권장 이름은 `ToBe.outline_suggestions: Record<string /*parent key*/, string[]>`으로 받는다(6장 것은 `is_equipment_sop`일 때만 보인다).

- [ ] **Step 1: 실패하는 시험 (backend)** — `test_add_procedure_gets_next_number`(6.2), `test_add_category_from_suggestion`, `test_add_appendix_label`("Appendix 1. Alarm list"), `test_parent_must_be_declarable`(`purpose` 아래 → 422), `test_remove_blocked_by_lines`(409), `test_rename_and_reorder_keep_confirmed_lines`(확정 줄 둘이 있는 절차를 둘째 자리로 — 줄의 `status` · 출처 연결 · `slot_key`는 그대로, 번호는 6.2.1, 칸 제목 글은 새 이름), `test_removed_number_is_not_reused`(`n2`를 지우고 더하면 `n3`).
- [ ] **Step 2: 실패하는 시험 (Excel)** — `test_template_has_procedure_sheet`, `test_import_adds_and_keeps_procedures`, `test_import_without_sheet_leaves_outline`.
- [ ] **Step 3: 구현 (backend)**
- [ ] **Step 4: 화면** — `ToBePanel`의 SOP 갈래(`sections` 위)에 묶음 셋: **Procedures (6)** · **Appendices (9)** · **Categories (5)**. 줄마다 번호 · 영어 제목 · 한글 제목(`CommitInput`) · 줄 수 · 지우기(줄이 있으면 숨긴다 — WI 단계의 `getStepRemoveBlock`과 같은 판단), 끝에 더하기. 범주와 장비 SOP의 절차에는 권장 이름 칩(이미 쓴 이름은 뺀다). 시험 ID `${prefix}-outline-<key>`, `-outline-add-<parentKey>`, `-outline-chip-<parentKey>-<i>`. 순서 바꾸기는 위 · 아래 단추(호버 · 포커스에만 보이는 줄 끝 단추).
- [ ] **Step 5: 확인** — backend 전체, 프런트 lint · tsc · vitest, Documents(To-Be) 스모크 단계에 "절차 더하기 → 이름 → Assign 나무에 6.2가 보임 → 지우기"를 더해 그 단계만.
- [ ] **Step 6: 설명서 글 · PROGRESS → 커밋 → 스텝 diff 검토 → `feat/outline`**

---

### Task 6: 벗어남과 빈 항목 경고 — `feat/outline-6-deviation`

**Files:**
- Modify: `backend/app/sop/outline_edit.py`, `outline.py`, `outputs.py`, `tobe.py`, `routers/sop_tobe.py`, `sheet_model.py`; `backend/tests/test_sop_outline_edit.py` · `test_sop_outputs.py` · `test_sop_review.py`
- Modify: `frontend/src/lib/api-sop.ts`, `slot-status-model.ts`, `components/tobe/slot-table.tsx` · `tobe-row.tsx`, `components/outputs/output-c.tsx`, New 칸의 절 머리, `i18n-messages.ts`, 사용 설명서

**Interfaces:**
- `NewOutlineItemIn` · `OutlineItemPatchIn`에 `reason: str = ""`, 그리고 `OutlineItemPatchIn.is_removed?: bool`.
- 사유가 필요한 것(비면 422 `deviation_reason_required`): ① 선언할 수 없는 부모 아래나 최상위에 항목 더하기(`origin="custom"`, 종류 `general`, 기본 표시는 부모의 것) ② 표준 항목의 제목 바꾸기 ③ 필수 표준 항목 빼기(`is_removed=True` — 줄이 있으면 409 `slot_has_targets`, 하위까지 함께 빠진다). 되살리기(`is_removed=False`)와 제목을 표준으로 되돌리기는 사유를 지운다.
- 선택 항목(7.1.x)을 빼는 것, N/A 표시, 선언(스텝 5)은 벗어남이 아니다.
- 응답: `OutlineItem.is_deviation: boolean`(위 ①②③), `sections[].deviation_reason: string | null`, `sections[].is_empty_required: boolean`(필수 · 배정 가능하거나 `group`인데 자기와 하위에 줄이 없고 N/A도 아님 — `auto_list`는 자식 WI가 없을 때).
- 빠진 항목은 절 목록에 없고 번호를 세지 않는다(뒤 장이 당겨진다 — 확인받을 것 9).
- 검토: 빈 필수 항목과 벗어남은 알림(notice)일 뿐이다. 검토 요청을 막는 검사에 넣지 않는다.

- [ ] **Step 1: 실패하는 시험** — `test_custom_item_needs_reason`, `test_rename_standard_needs_reason`, `test_remove_required_needs_reason_and_shifts_numbers`(`definitions`를 빼면 `responsibilities`가 3), `test_restore_clears_reason`, `test_na_is_not_a_deviation`, `test_empty_required_flag`(빈 `scope` → `True`, N/A를 달면 `False`, 빈 7.1.x 선택 항목은 절 자체가 없다), `test_review_request_not_blocked_by_empty_required`.
- [ ] **Step 2: 구현 (backend)** — C 시트에 "표준과 다름" 사유 칸 하나(`heading_note` 옆).
- [ ] **Step 3: 화면** — N/A 표의 줄에 **Differs from standard** 표시(아이콘 + 호버에 사유), 문서 목록 줄에 벗어남 수, 결과물 C · New 칸 절 머리에 같은 표시와 **Empty**(ko "비어 있음") 경고. 표준 항목의 제목 고치기 · 빼기 · 되살리기와 사용자 항목 더하기는 N/A 표의 줄 끝 단추 + 사유 입력(N/A 사유 편집기 `NaEdit`의 부품을 쓴다).
- [ ] **Step 4: 확인** — backend 전체, 프런트 lint · tsc · vitest, To-Be · Order 스모크 단계에 "항목 빼기(사유) → 번호 당겨짐 → 되살리기"를 더해 그 단계만.
- [ ] **Step 5: 설명서 글 · PROGRESS → 커밋 → 스텝 diff 검토 → `feat/outline`**

---

## 이 계획 밖 (설계의 다른 작업으로)

- "Attachment 1. Document Change History" 시스템 항목, 5장 표 · 2–4장 표 모양, 한·영 절반으로 그리기 — 작업 5(템플릿 보기).
- 입구 2 문서(`path:` 절)를 골격에 얹기 — 작업 7. 이 계획은 `entrance="match"` 갈래를 건드리지 않는다.
- Assign 나무에서 절차 더하기(WI 단계의 둘째 UI에 해당) — 1.2.0 피드백 8번(가상화)이 끝난 뒤 따로.
