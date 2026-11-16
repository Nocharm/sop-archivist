# Assign 보내기(끌어다 놓기 3걸음) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign의 Old 조각을 끌어 아직 쓰지 않은 New 문서(New · from Assign)의 두 문장 사이·빈 칸, 또는 옆 패널 All 나무의 칸·step에 놓으면 그 줄의 "Not saved yet" 초안이 되고, 문장 사이에 놓은 것은 Confirm 때 그 자리까지 저장된다.

**Architecture:** 서버는 `POST /groups/save`의 새 문장 항목에 선택 필드 `position`을 받고, 저장을 검사(`check_group`) → 순서 굳히기(되돌리기 단계 밖) → 쓰기(`save_group`, 되돌리기 단계에 기록) 세 걸음으로 나눈다. 화면은 2걸음의 끌기 설정(`dragConfig`)의 `onMove`·`onDrop`을 넓힌다 — 놓을 곳의 종류와 거절은 순수 모델 `lib/assign-drop-model.ts`가 정하고, 놓기는 저장하지 않고 줄 초안(`destination` + `position`)만 채운다. 끄는 동안의 표시는 DOM 속성과 명령형 DOM이고, 놓은 뒤의 점선 초안만 React가 그린다(놓을 때 한 번).

**Tech Stack:** Python 3.11 · FastAPI · SQLAlchemy(async) · pytest / Next.js 16 · React 19 · TypeScript · vitest · Playwright(시스템 Chrome) 스모크. 새 의존성 없음. Alembic 리비전 없음(모델을 바꾸지 않는다).

**Spec:** `docs/superpowers/specs/2026-11-16-drag-and-drop-design.md` — §2(반목표), §4(G1~G13), §6(놓는 곳 표의 둘째~넷째 줄, 거절, 2걸음에서 정한 것), §8 "Assign 보내기 — 자리 받기(3걸음)", §9, §10의 3걸음, §11, §12. 되돌리기는 `docs/superpowers/specs/2026-11-13-assign-undo-design.md` §5.2·§5.3. 구현 전에 루트 `CLAUDE.md`, 고칠 쪽의 `backend/CLAUDE.md`·`frontend/CLAUDE.md`, `docs/lessons/react-ts-patterns.md`·`browser-verification.md`·`ui-review.md`, 그리고 형식의 본보기인 2걸음 계획 `docs/superpowers/plans/2026-11-16-assign-drag-link-plan.md`를 읽는다.

## Global Constraints

- 작업 폴더는 이 작업의 워크트리(`<worktree>`), 브랜치 `feat/assign-drag-send`. 원본 체크아웃(`<original-checkout>`)은 읽기와 venv 실행만 한다. 워크트리에 venv 링크를 만들지 않는다. 공개 저장소다 — 추적 파일에 사용자 경로·실서버 IP·시크릿을 쓰지 않는다.
- **놓는 것은 고르는 것까지다**(반목표): 놓기는 `POST /groups/save`를 부르지 않는다. 저장은 지금처럼 **Confirm**·<kbd>↵</kbd>·**Edit and confirm**(E)·그 자리 메뉴의 Confirm만 한다. AI 제안 여러 개를 한 번에 확정하는 길을 만들지 않는다.
- **지금의 클릭·단축키 경로는 하나도 사라지거나 뜻이 달라지지 않는다**(G12): `handleNewPick`·`handleOldClick`·`pickNewSentence`·나무 클릭(`onPickPlace`)의 동작을 바꾸지 않는다. `position`이 없는 저장 요청은 v1.1.6과 글자 하나 다르지 않다 — `position` 키 자체를 넣지 않는다(`position: null`도 보내지 않는다). 서버도 `position`이 없는 저장은 지금과 똑같이 쓴다.
- **하위 칸이 있는 상위 칸에 놓는 것에 관한 규칙을 새로 만들지 않는다**(번호 충돌은 사용자가 답하지 않은 열린 질문이다). 나무 클릭이 지금 받는 칸은 놓기도 받고, 지금 막는 칸(N/A)만 막는다.
- 2걸음의 판단은 그대로다: 손잡이 없이 상자 전체를 끈다, 놓을 때 행동한다, 글자 긁기는 Alt를 누른 동안만, Old 조각의 커서는 손가락 그대로, 한 단 보기에서도 끌기는 시작된다, 끌기가 꺼지는 때는 `canDragOld`(읽기 전용 · `mode === "unsourced"` · 짝 고르는 중 · 한 단의 New 문서 원문 보기) 그대로. New · from Assign 문서의 미리 보기 줄은 여전히 눌러 고르지 못한다(놓을 자리로만 쓴다).
- 화면 규칙은 순수 모델(`assign-drop-model.ts`·`classify-model.ts`·`composed-model.ts`)에 두고 단위 시험한다. 포인터가 움직일 때마다 React 상태를 바꾸지 않는다(G11) — 놓을 자리 표시는 DOM 속성이나 명령형 DOM이다. `pointerdown`에서 `preventDefault`를 부르지 않는다(G2).
- backend: 검사는 모두 쓰기 전에, 거절마다 규칙 코드와 시험. 저장 경로의 거절은 `decisions._reject(reason, …)`(422 `invalid_group` + `reason`)로만 낸다 — `HTTPException`을 직접 던지지 않는다. 화면에서 닿는 새 사유는 `rule.invalid_group.<reason>` en·ko를 같은 커밋에 넣는다. Python 3.11 문법만(`ruff` `target-version = "py311"`).
- 기존 시험(pytest·vitest·스모크)의 기대값을 고치지 않는다.
- 새 문구는 `frontend/src/lib/i18n-messages.ts`에 en·ko 한 쌍(`i18n-messages.test.ts`가 키 집합을 가드). 사용 설명서 글(`frontend/public/manual/user-manual.md`)은 화면을 바꾸는 커밋에서 함께 고치고, 화면 라벨은 영어 화면 글자 그대로 **굵게** 적는다(`manual-content.test.ts`). 그림은 뽑지 않는다. 색·그림자는 토큰만(raw hex 금지).
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. 커밋 전 `PROGRESS.md` 갱신. 푸시·태그·버전 올리기는 하지 않는다 — 버전(1.1.6 → 1.1.7)은 마지막 태스크에서만 올리고, 푸시는 조율하는 세션이 한다.
- 검증 스택(이 워크트리 전용 포트): backend 8787, frontend 3787. 내 것이 아닌 프로세스는 죽이지 않는다. Assign 스모크 단계는 `ONLY=`로 거르지 못한다(스크립트 한계) — 갓 시드한 DB의 전체 스모크로 판정한다.

```bash
# 워크트리 backend/ 에서
PY=<original-checkout>/backend/.venv/bin/python
$PY -m pytest tests/ -q -n auto                       # 한 파일만 볼 때는 -n 없이
<original-checkout>/backend/.venv/bin/ruff check app/ tests/
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev $PY -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev $PY -m scripts.seed_sop_demo   # 극단 자료는 seed_sop_worst
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $PY -m uvicorn app.main:app --port 8787
# 워크트리 frontend/ 에서
BACKEND_URL=http://localhost:8787 npx next dev -p 3787
QUIET=1 BASE_URL=http://localhost:3787 BACKEND_PYTHON=$PY node scripts/pw-smoke-sop.mjs
npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run     # 커밋 전
```

## 이 계획이 정한 것(내 판단 — 설계에 없는 빈칸)

**서버**

1. **필드 이름과 "맨 앞"**(§11): 새 문장 항목 `TargetIn`에 `position: {"after_target_id": <새 문장 id> | null}`. 키가 있는 객체라 "자리 없음(필드 생략)"과 "칸의 맨 앞(`after_target_id: null`)"이 섞이지 않는다. `{}`는 형식 오류(422 검증)다.
2. **자리를 받는 항목**: 최상위(`parent_key` 없음)이고 칸 제목이 아니며, 새로 만들거나 줄에서 만든 기존 문장(`origin` units)인데 (문서, 칸, step, part)가 바뀌는 것. WI의 Instruction ↔ Why만 바뀌어도 칸이 바뀐 것이다(결과물 C의 칸이 다르다). 그 밖에는 사유 넷으로 거절한다(Task 1).
3. **한 저장에서 자리를 받은 문장들이 놓이는 순서는 `arrange_new_targets` 순서다** — 영어 먼저, 번역은 출처 바로 뒤. **설계 §8의 "받은 순서대로"와 다르다**: 화면은 원문 순서(한국어 먼저)로 보내는데 번호 표시 기본값은 서버가 "영어가 첫 줄"로 매기므로(`target_placement._arrange_meaning`), 받은 순서대로 두면 번호가 둘째 줄에 붙는다. 순서를 사람이 정한 문서 끝에 짝이 붙는 지금 모습(`test_manual_order_doc_appends_english_then_korean`)과 같게 한다.
4. **굳히기는 `PUT /targets/order`와 같은 일을 한다**: 결과물 C가 보이는 순서로 `order_index`를 0부터 매기고 `manual_order`를 켜고 작업 기록 `targets.reorder`를 남긴다. 그리고 자리를 받은 저장은 묶음 `revision`을 1 올린다(굳혔든 아니든) — 낡은 Order 화면의 순서 저장이 409가 되게.
5. **자리를 받아 옮긴 문장의 남은 번역은 그 문장 바로 뒤로 옮긴다.** 떼어 내기(`sweep_translations`)는 남긴 번역의 칸만 출처에 맞추고 `order_index`는 그대로 둔다 — 옮긴 문장만 새 순번을 받으면 번역이 그 칸의 엉뚱한 자리에 선다.
6. **되돌리기** — 아래 "§12 열린 것" 절.

**화면**

7. **놓을 자리 계산**: 포인터 밑의 `.new-item[data-row]`(New 칸의 줄 하나)에서 그 줄이 든 **의미 묶음 상자**(같은 Old 줄에서 나온 이웃 줄들)의 중간선과 견준다 — 위 절반이면 묶음 앞, 아래 절반이면 묶음 뒤. 그래서 다른 의미 묶음의 한가운데에는 끼울 자리가 없다(거절하지 않고 앞뒤로 붙는다). 칸 머리 줄과 용지 여백은 놓을 자리가 아니다.
8. **의미 묶음은 화면이 정한다**: 엮은 문서 응답(`ComposedItem`)에는 굵은 선 키가 없어, 문장의 첫 출처 Unit이 든 Old 줄(`rowOfUnit`)이 같고 이웃한 줄을 한 묶음으로 본다(출처가 없으면 혼자). 서버 응답을 넓히지 않는다 — 묶음은 놓는 자리를 다듬는 데만 쓰고 서버는 묶음 한가운데를 거절하지 않는다.
9. **놓을 자리 표시**: 두 문서 틀(`.assign-panes`)에 붙인 명령형 선 하나(`drop-gap-line.ts`, Order의 `.c-dropline` 모양). 표의 메모는 "→ 칸 머리 글"(예 "→ 6.1. Procedure"), 나무 위에서는 "→ 문서 번호 · 칸 이름". 빈 칸·나무 줄은 공통 테두리(`data-drop`)다.
10. **점선 초안**: 놓은 뒤 New 칸이 prop으로 받아 그린다(React, 놓을 때 한 번). 문장 줄(`.new-line`)이 아니라 따로 선 `.new-draft-line`이고 `data-target`이 없다 — 이음 선·고르기·놓기 대상에 끼지 않는다. 글은 저장될 문장(고쳐 쓴 글이 있으면 그 글), 짝은 영어 먼저. 빈 칸에 놓았으면 줄 대신 그 자리 표시(`assign-new-slot-<칸>`)에 `data-draft` 테두리만 단다(칸을 나무에서 눌러 골라도 같다 — 같은 초안 상태를 그리는 것이라 저장 내용은 그대로다).
11. **자리의 수명**: 줄 초안에 `position: { placeId, after }`(`placeId`는 놓은 곳의 `getDestinationId`)로 둔다. 고쳐 쓰기(E)·글 고침·Remark는 자리를 지킨다. 보낼 곳을 다시 고르면(`pickDestination`) 지우고, 그 밖의 길로 보낼 곳이 달라져도 `placeId`가 맞지 않으면 저장 요청에 싣지 않는다. 다시 읽은 문서에서 그 자리의 문장이 사라졌으면 자리만 버린다(칸 초안으로 남는다).
12. **놓은 뒤 그 자리 메뉴**: New 칸에 놓았으면 점선 초안(빈 칸이면 그 자리 표시)에 그 자리 메뉴(Confirm / Cancel, "Not saved yet")가 뜬다 — 칸 초안의 Cancel은 지금 오른쪽 칸에 없다. 나무에 놓았으면 메뉴 없이 클릭과 같다.
13. **다른 줄을 끌어 놓아도 된다**(2걸음과 같다): 그 줄이 골라지고 관계 묶음이 온 뒤 초안이 적용된다. 그 사이 다른 줄을 고르면 버린다. New 칸에 놓았으면 New 칸은 놓은 문서에 둔다.
14. **"이미 그 칸에 있다"**: 문장 사이에 놓을 때만 본다 — 열려 있는 엮은 문서의 그 칸에 끄는 줄의 Unit을 출처로 둔 문장이 하나라도 있으면 거절한다(AI 제안 문장도 문장이다). 관계 묶음을 기다리지 않고 화면의 문서로 판단한다. 빈 칸과 나무는 클릭과 같아 이 거절이 없다.
15. **나무**: 놓이는 곳은 칸 줄(`slot`)과 step 줄(`step`)뿐이다. 칸 제목 자리(`slot_heading`)와 이미 쓴 문서의 문장 줄은 놓을 곳이 아니다. 접힌 문서·접힌 **All** 묶음은 끄는 동안 저절로 펼쳐지지 않는다 — 끌기 전에 펼쳐 둔다(끄는 동안 호버 효과를 끄는 G10과 맞추고, 펼침은 React 상태다).
16. **이미 쓴 문서의 "문장 사이"**: 그 용지의 줄 상자(`.new-item`) 안에서 문장 줄(`.new-line`)과 표·그림 상자(`.new-block`) 밖 — 줄 사이 틈과 왼쪽 번호 칸이다.
17. **저장 직후의 미리 고침**(`applySavedTargets`)도 놓은 자리에 넣는다 — 끝에 넣으면 다시 읽을 때 줄이 뛴다.
18. **초안은 줄에 남는다**: 설계 §6은 "다른 줄 고르기로 초안이 사라진다"고 적었지만 지금 코드의 초안은 줄마다 남는다(`drafts[rowKey]`, 나갈 때 묻는다). 바꾸지 않는다 — 다른 줄을 고르면 점선 초안은 화면에서 사라지고 그 줄로 돌아오면 다시 보인다.

## §12 열린 것 — 되돌리기 스냅숏과 `order_index` (사용자 확인 필요, 진행은 이 판단으로)

**읽은 것**(`backend/app/sop/decision_steps.py`): 스냅숏은 묶음의 `target_sentences` **모든 열**을 찍는다 — `order_index`도 견주고 되쓴다(`TRACKED_TABLES`, `_UNCOMPARED_COLUMNS`는 `revision`·`updated_at`뿐). 한 저장의 단계에는 그 저장이 값을 바꾼 **모든 줄**이 들어가므로, 자리에 끼우느라 민 줄들도 단계에 들고 되돌리면 제자리로 돌아온다(순서를 정한 문서에 번역을 끼우는 지금의 `insert_after`가 이미 그렇다). `target_docs`는 찍지 않는다 — `manual_order`는 되돌려지지 않는다.

**§8의 "되돌리기"와 맞는가**: 반만 맞는다. "새 문장이 사라진다"와 "`manual_order`는 그대로"는 그대로 된다. 그러나 굳히기를 저장 단계 안에서 하면 **어긋난다** — 굳히며 바꾼 그 문서의 모든 줄의 `order_index`가 단계에 들어가, 되돌리면 굳히기 전 값(대개 모두 0)으로 돌아가는데 `manual_order`는 켜진 채라 문서가 만든 순서(id 순)로 뒤섞인다.

**판단(가장 작은 것)**: 굳히기를 되돌리기 단계 **밖**에서 한다 — 저장을 `check_group`(검사) → `freeze_positioned_docs`(굳히기) → `record_snapshot_step(… save_group …)`(쓰기)로 나눠, 단계의 "앞 모습"을 굳힌 뒤에 찍는다. 그러면 되돌리기는 새 문장을 지우고 민 줄을 되돌릴 뿐, 굳힌 순서와 `manual_order`는 남는다 — §8 그대로다. 검사가 모두 끝난 뒤에만 굳히므로 "거절은 아무것도 쓰지 않는다"도 지킨다.

**이 판단이 낳는 것**(Order에서 순서를 바꾼 뒤와 같다): 굳힌 문서의 문장을 건드린 **그 전 단계**는 되돌릴 때 409 `undo_conflict`가 된다(그 문장의 `order_index`가 단계에 찍힌 값과 달라졌다). 문서마다 처음 한 번, 문장 사이에 놓고 확정했을 때만 생긴다. 이것이 싫으면 다른 길은 `manual_order`도 스냅숏에 넣어 되돌리기가 굳히기까지 무르게 하는 것인데, §8을 바꾸는 일이라 고르지 않았다.

## Review Focus

1. 놓은 뒤 Confirm 전에 그 자리의 문장이 사라졌다(다른 사람이 지우거나 옮김) — 서버는 아무것도 쓰지 않고 422 `unknown_position_target`·`position_target_elsewhere`, 화면은 그 문구를 알리고 초안을 남긴다. 다시 읽어 화면이 먼저 알았으면 자리만 버린다.
2. 한 저장에 자리를 받은 문장과 받지 않은 문장이 같은 문서로 간다 — 받지 않은 문장은 지금처럼 끝에 붙고 끼운 문장 때문에 중간에 서지 않는다.
3. 확정 번역이 딸린 문장을 다른 칸의 문장 사이로 옮긴다 — 번역(보류가 된다)이 옮긴 문장 바로 뒤에 선다.
4. WI 문서 — step·Instruction/Why 칸에서도 자리가 맞고, 다른 part의 문장을 가리키면 거절된다.
5. 놓은 직후 뒤따르는 `click`이 나무 줄 단추나 New 줄에 닿아 고름이 두 번 적용되거나 자리가 지워지지 않는다. 끄는 동안 New 칸이 스스로 스크롤되어도 놓을 자리 선이 용지 밖에 남지 않는다.

---

### Task 1: 서버 — `position` 받기

**Files:**
- Modify: `backend/app/sop/decisions.py`(요청 모양, 자리 검사, 검사·쓰기 나누기, 자리에 끼우기)
- Modify: `backend/app/sop/target_placement.py`(굳히기, 밀기), `backend/app/sop/outputs.py`(보이는 순서)
- Modify: `backend/app/routers/sop_decisions.py`(`save_relation_group`)
- Modify: `frontend/src/lib/i18n-messages.ts`(거절 문구 셋 — 거절 코드와 같은 커밋), `backend/CLAUDE.md`(`target_placement` 언급 옆 한 문장), `docs/superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md`("API 계약" 블록의 `POST /groups/save` 줄 아래 한 줄)
- Test: Create `backend/tests/test_sop_target_position.py`. Modify `backend/tests/test_sop_ai_translate.py`(시험 하나)

**Interfaces:**
- Consumes: 지금의 `decisions.py` 내부(`_State`·`_Plan`·`_reject`·`_get_spot`·`_get_saved_place`·`_read_place`·`_build_new_target`·`_find_placed_sources`·`_place_new_targets`·`_apply_plan`·`_write_group`), `target_placement.arrange_new_targets`·`insert_after`, `outputs._build_index`·`_plan_sections`·`LABELS`, `snapshot.load_bundle_snapshot`, `events.record_event`, `detach.sweep_translations`·`load_source_target_ids`, `decision_steps.record_snapshot_step`.
- Produces:

```python
# decisions.py
class PositionIn(BaseModel):
    """새 문장이 칸 안에서 놓일 자리 — 그 새 문장 바로 뒤, None이면 칸의 맨 앞(끌어다 놓기 설계 §8)."""
    after_target_id: DbId | None  # 기본값 없음 — 키를 빼면 형식 오류다

class TargetIn(BaseModel):
    ...
    position: PositionIn | None = None

@dataclass
class CheckedGroup:
    """검사를 모두 통과한 저장 — 쓰기가 그대로 옮긴다."""
    payload: GroupSaveIn
    plans: list[_Plan]
    releases: list[SlotRelease]
    state: _State

async def check_group(session: AsyncSession, bundle: Bundle, payload: GroupSaveIn) -> CheckedGroup          # 잠금·작업 중 검사·검사 전부. 쓰지 않는다
async def freeze_positioned_docs(session: AsyncSession, bundle: Bundle, checked: CheckedGroup, actor: str) -> None
async def save_group(session: AsyncSession, bundle: Bundle, checked: CheckedGroup, actor: str) -> GroupOut  # 쓰기 — 서명이 바뀐다(부르는 곳은 라우터 하나)

# target_placement.py
async def freeze_order(session: AsyncSession, bundle_id: int, doc: TargetDoc, actor: str) -> None
async def open_gap(session: AsyncSession, target_doc_id: int, at: int, count: int) -> None

# outputs.py
def list_target_order(snap: BundleSnapshot, target_doc_id: int) -> list[int]
```

  - 요청: `targets[].position` = `{"after_target_id": 12}` | `{"after_target_id": null}` | 생략.
  - 거절(모두 422 `invalid_group`, `reason`과 `keys`): `position_not_allowed`(칸 문장·칸 제목·번역 줄·이미 쓴 문서의 문장에 자리를 실었다), `position_same_place`(칸이 바뀌지 않는 기존 문장), `unknown_position_target`(가리킨 새 문장이 이 묶음에 없다·이 저장이 지운다·칸 문장이나 칸 제목이다·그 문장도 자리를 받는다 — `target_ids` 포함), `position_target_elsewhere`(가리킨 새 문장의 저장 뒤 자리가 다른 문서·칸·step·part다 — `target_ids` 포함). 이미 쓴 문서에 새 문장을 만들려는 저장은 지금처럼 `match_doc_new_target`이 먼저다.
  - 문구(en / ko):
    - `rule.invalid_group.match_doc_new_target`: "A document that is already written takes no new sentences. Link to one of its sentences." / "이미 쓴 문서에는 새 문장을 넣지 않습니다. 그 문서의 문장에 이으세요."
    - `rule.invalid_group.unknown_position_target`: "The sentence you dropped next to is gone. Drop it again." / "옆에 놓은 문장이 없어졌습니다. 다시 놓아 주세요."
    - `rule.invalid_group.position_target_elsewhere`: "The sentence you dropped next to has moved. Drop it again." / "옆에 놓은 문장이 다른 곳으로 옮겨졌습니다. 다시 놓아 주세요."
    - `position_not_allowed`·`position_same_place`는 화면이 보내지 않는 모양이라 문구를 두지 않는다(일반 문구 `rule.invalid_group`).

- [ ] **Step 1: 실패하는 시험을 쓴다** — `tests/test_sop_target_position.py`. 묶음은 `tests.test_sop_numbering`의 `_create_sop_bundle`·`_pair_units`·`_put_styles`·`_read_slot_lines`·`PAIR_SLOT`·`PAIRED`를 그대로 쓴다(그 파일이 `test_sop_outputs`에서 가져오는 방식과 같다). `pytestmark = pytest.mark.usefixtures("clean_sop")`.

```python
FIRST, SECOND, THIRD = "Check the synthetic valve.", "Open the synthetic hatch.", "Close the synthetic hatch."
DRAGGED, LATE = "Record the synthetic reading.", "Store the synthetic log."
OTHER_SLOT = "scope"

def _setup(client: TestClient) -> tuple[int, int, dict, dict[str, int]]:
    """SOP 하나와 옛 문서(FIRST·SECOND·THIRD·DRAGGED·LATE 순). THIRD → SECOND → FIRST 순서로 짝 칸에 확정해 둔다 —
    만든 순서(id)가 보이는 순서의 반대라, 굳히기가 id 순으로 굳히면 시험이 잡는다. (묶음, SOP, view, 글 → 새 문장 id)"""

def _save(client: TestClient, bundle_id: int, sop_id: int, unit: dict, *, undo: dict | None = None, **fields: object) -> httpx2.Response:
    """단위 하나를 원문 그대로 확정 — 항목 {"key": "t", "target_doc_id": sop_id, "slot_key": PAIR_SLOT, "source_unit_ids": [unit["id"]]}을 fields가 덮는다."""

def _texts(client: TestClient, bundle_id: int, slot_key: str = PAIR_SLOT) -> list[str]:
    return [text for text, _, _ in _read_slot_lines(client, bundle_id, slot_key)]

def _is_manual_order(target_doc_id: int) -> bool: ...  # tests.access_helpers.run_in_session으로 TargetDoc.manual_order를 읽는다


def test_position_after_a_sentence_freezes_the_visible_order(client: TestClient) -> None:
    bundle_id, sop_id, view, ids = _setup(client)
    revision = get_bundle(client, bundle_id)["revision"]
    assert (_texts(client, bundle_id), _is_manual_order(sop_id)) == ([FIRST, SECOND, THIRD], False)

    response = _save(client, bundle_id, sop_id, find_unit(view, DRAGGED), position={"after_target_id": ids[FIRST]})

    assert response.status_code == 200, response.text
    assert _texts(client, bundle_id) == [FIRST, DRAGGED, SECOND, THIRD]
    assert _is_manual_order(sop_id)
    assert get_bundle(client, bundle_id)["revision"] == revision + 1
    events = client.get(f"/api/bundles/{bundle_id}/events", headers=AUTHOR).json()
    assert ("targets.reorder", "target_doc", [sop_id]) in [(e["action"], e["target_type"], e["target_ids"]) for e in events]


@pytest.mark.parametrize(("anchor", "expected"), [
    (None, [DRAGGED, FIRST, SECOND, THIRD]),    # 칸의 맨 앞
    (SECOND, [FIRST, SECOND, DRAGGED, THIRD]),  # 가운데
    (THIRD, [FIRST, SECOND, THIRD, DRAGGED]),   # 끝
])
def test_position_front_middle_and_end(client: TestClient, anchor: str | None, expected: list[str]) -> None:
    # position={"after_target_id": ids[anchor] if anchor else None} → 200, _texts(...) == expected


def test_position_in_a_manual_order_doc_pushes_only_the_lines_after_it(client: TestClient) -> None:
    # _put_styles(client, bundle_id, sop_id, [ids[FIRST], ids[SECOND], ids[THIRD]], {})로 먼저 굳힌 문서(0, 1, 2)에 after FIRST
    # 그 문서 최상위 새 문장의 order_index(tests.ai_fixtures.read_rows(TargetSentence)) == {ids[FIRST]: 0, 새 문장: 1, ids[SECOND]: 2, ids[THIRD]: 3}
    # targets.reorder 기록은 _put_styles의 하나뿐이다(다시 굳히지 않는다). 묶음 revision은 이 저장으로 1 오른다


def test_position_puts_a_pair_english_first(client: TestClient) -> None:
    # 옛 문서 p(FIRST) + p(SECOND) + p(ko) + p(en)(ko, en = PAIRED[0]). FIRST·SECOND를 짝 칸에 확정, _pair_units로 짝을 맺는다.
    # test_sop_numbering._save_new_targets와 같은 요청([한, 영] 순서)에 두 항목 모두 position={"after_target_id": FIRST의 새 문장}
    assert _read_slot_lines(client, bundle_id) == [
        (FIRST, "6.1.1", "numbered"), (en, "6.1.2", "numbered"), (ko, None, "omitted"), (SECOND, "6.1.3", "numbered"),
    ]


def test_position_moves_an_existing_sentence_into_another_slot(client: TestClient) -> None:
    # DRAGGED를 먼저 OTHER_SLOT에 확정(자리 없이). 그 새 문장을 id·revision·slot_key=PAIR_SLOT·position(after FIRST)으로 다시 저장
    assert (_texts(client, bundle_id), _texts(client, bundle_id, OTHER_SLOT)) == ([FIRST, DRAGGED, SECOND, THIRD], [])


def test_a_sentence_without_a_position_in_the_same_save_goes_to_the_end(client: TestClient) -> None:
    # 한 요청: DRAGGED 항목은 position(after FIRST), LATE 항목은 자리 없음(단위 둘, 항목 둘)
    assert _texts(client, bundle_id) == [FIRST, DRAGGED, SECOND, THIRD, LATE]


def test_no_position_keeps_the_document_as_it_was(client: TestClient) -> None:
    # DRAGGED를 자리 없이 저장 → 출처 위치 순서 그대로, 굳지 않는다, 묶음 revision도 그대로
    assert (_texts(client, bundle_id), _is_manual_order(sop_id)) == ([FIRST, SECOND, THIRD, DRAGGED], False)


@pytest.mark.parametrize(("case", "reason"), [
    ("another_slot", "position_target_elsewhere"),   # DRAGGED를 OTHER_SLOT에, after = ids[FIRST](짝 칸의 문장)
    ("missing", "unknown_position_target"),          # after = 999_999
    ("same_place", "position_same_place"),           # FIRST의 새 문장을 id·revision·같은 칸으로 다시 보내며 after = ids[SECOND]
    ("slot_heading", "position_not_allowed"),        # DRAGGED를 kind="slot_heading" 항목으로, position 포함
])
def test_position_rejections_write_nothing(client: TestClient, case: str, reason: str) -> None:
    # 응답: (422, detail.code "invalid_group", detail.reason == reason)
    # 그 뒤: _texts(...) == [FIRST, SECOND, THIRD], _is_manual_order(sop_id) is False, 묶음 revision 그대로, 작업 기록에 targets.reorder 없음


def test_position_in_a_wi_step_and_across_documents(client: TestClient) -> None:
    # tests.test_sop_decisions의 _setup(SOP + WI 1단계)·WARM_UP·RECORDS·STORAGE·_unit_in·_target·_body·_reason을 쓴다
    # WARM_UP, RECORDS를 WI의 {"wi_step": 1, "wi_part": "instruction"}에 차례로 확정(a = WARM_UP의 새 문장)
    # STORAGE를 (1) wi_part="why"에 after a → _reason == "position_target_elsewhere"
    #          (2) SOP의 slot_key="purpose"에 after a → _reason == "position_target_elsewhere"
    #          (3) 같은 step·instruction에 after a → 200, 결과물 C WI-01의 "step:1:instruction" 글 == [WARM_UP, STORAGE, RECORDS]


def test_position_on_a_written_document_is_still_match_doc_new_target(client: TestClient) -> None:
    # test_sop_decisions.test_location_rules의 "match" 갈래와 같은 문서에 position={"after_target_id": None}을 실어 보낸다
    assert _reason(response) == "match_doc_new_target"


def test_undo_of_a_positioned_save_removes_the_sentence_and_keeps_the_frozen_order(client: TestClient) -> None:
    bundle_id, sop_id, view, ids = _setup(client)
    saved = _save(client, bundle_id, sop_id, find_unit(view, DRAGGED), undo={"session": "s1"}, position={"after_target_id": ids[FIRST]})
    assert saved.status_code == 200, saved.text

    undone = client.post(f"/api/bundles/{bundle_id}/decisions/undo", json={"session": "s1"}, headers=AUTHOR)

    assert undone.status_code == 200, undone.text
    assert _texts(client, bundle_id) == [FIRST, SECOND, THIRD]  # 만든 순서 [THIRD, SECOND, FIRST]가 아니다 — 굳힌 순서가 남는다
    assert _is_manual_order(sop_id)
    redone = client.post(f"/api/bundles/{bundle_id}/decisions/redo", json={"session": "s1"}, headers=AUTHOR)
    assert redone.status_code == 200, redone.text
    assert _texts(client, bundle_id) == [FIRST, DRAGGED, SECOND, THIRD]
```

  `tests/test_sop_ai_translate.py`에 하나(그 파일의 도우미로): `test_a_positioned_source_takes_its_kept_translation_right_after_it` — `make_settled_translation`으로 확정 문장과 확정 번역을 만들고, `test_ai_translation_lands_right_after_its_source_in_a_manual_order_doc`가 문서를 더 올리는 방식으로 `OTHER_SLOT`에 문장 둘(`before`, `after`)을 확정한 뒤 `save_source(client, bundle.id, unit["id"], slot_key=OTHER_SLOT, position={"after_target_id": before})`. 단언: 200, `[item["target_id"] for item in read_slot_items(get_output_c(client, bundle.id, "en"), "SOP-AI", OTHER_SLOT)] == [before, source["id"], translation.id, after]`, `assert_held(unit["id"])`.

- [ ] **Step 2: 실패를 본다** — `$PY -m pytest tests/test_sop_target_position.py -q` → 자리를 받는 시험은 FAIL(지금 서버는 모르는 필드를 버린다 — 순서가 `[FIRST, SECOND, THIRD, DRAGGED]`). `test_no_position_keeps_the_document_as_it_was`와 `…_is_still_match_doc_new_target`은 지금도 통과한다(지금 동작을 박아 두는 시험이다).
- [ ] **Step 3: 순서 재료를 쓴다.**
  - `outputs.list_target_order`: 그 문서의 최상위 새 문장(칸 제목 제외) id를 결과물 C가 보이는 순서로 — `_plan_sections(_build_index(snap), doc, LABELS["en"])`의 칸 순서와 칸 안 순서 그대로. 문서가 없으면 빈 목록.
  - `target_placement.freeze_order`: `load_bundle_snapshot(session, bundle_id)`(글자 포함 기본값 — `include_text=False`는 같은 세션의 단위 글을 못 읽게 만든다) → `list_target_order`(스레드에서) → 그 문서의 최상위·칸 제목 아닌 새 문장에 0부터 `order_index`, `doc.manual_order = True`, `record_event(action="targets.reorder", target_type="target_doc", target_ids=[doc.id])`. 문서마다 평생 한 번만 도는 길이다(그 뒤로는 `manual_order`다).
  - `target_placement.open_gap`: `order_index >= at`인 그 문서의 최상위 새 문장을 `count`칸 민다 — `insert_after`와 같은 조건의 UPDATE 한 번.
- [ ] **Step 4: 요청 모양과 자리 검사.** `PositionIn`·`TargetIn.position`. `_State`에 `anchors: dict[int, TargetSentence]`(보낸 `after_target_id`가 가리키는 이 묶음의 새 문장 — `_load_state`가 읽는다). `_check_positions(plans, by_row_id, state)`를 `check_group`의 `_check_duplicates` 뒤에 둔다. 항목마다 이 순서로 본다: ① `plan.is_cell` · `kind == SLOT_HEADING` · `plan.origin != ORIGIN_UNITS` → `position_not_allowed` ② 기존 문장이고 `_get_spot(plan)`이 지금 (문서, 칸, step, part)와 같다 → `position_same_place` ③ 가리킨 id가 `state.anchors`에 없다 · `state.removed`에 있다 · 칸 문장(`parent_target_id`)이거나 칸 제목이다 · 그 문장의 계획도 `position`을 실었다 → `unknown_position_target` ④ 가리킨 문장의 저장 뒤 자리(이 요청에 있으면 `_get_spot(그 계획)`, 없으면 지금 자리)가 `_get_spot(plan)`과 다르다 → `position_target_elsewhere`.
- [ ] **Step 5: 저장을 세 걸음으로 나누고 자리에 끼운다.**
  - `check_group` = 지금 `save_group`의 `_write_group` 호출 앞까지(잠금·`ensure_editable`·검사 1–11) + `_check_positions`. `save_group(session, bundle, checked, actor)` = `_write_group` → `settle_pairs` → `build_group_out`(지금 그대로) + 자리를 받은 계획이 하나라도 있으면 `bundle.revision += 1`.
  - `freeze_positioned_docs`: 자리를 받은 계획의 문서 가운데 `manual_order`가 아닌 것마다 `freeze_order`. 없으면 아무것도 하지 않는다.
  - 라우터 `save_relation_group`: `checked = await check_group(...)` → `await freeze_positioned_docs(...)` → `record_snapshot_step(..., lambda: save_group(session, ctx.bundle, checked, ctx.login_id))`. 굳히기가 단계의 앞 모습보다 먼저라 되돌리기 단계에 들지 않는다("§12 열린 것").
  - `_write_group` 안에서: 자리를 받은 계획은 끝 붙이기(`_apply_plan`의 `is_appended`)와 `_place_new_targets`의 순서 정하기를 건너뛴다(번호 표시 기본값은 그대로 받는다). 그 문서의 끝 붙이기가 **모두 끝난 뒤** 끼운다:

    ```
    order  = arrange_new_targets([_build_new_target(plan, placed, state) for plan in 자리 받은 계획])  # 기존 문장도 같은 함수로 순서만
    묶음   = (문서, 칸·step·part, after_target_id)가 같은 계획끼리, order 순서로
    묶음마다: at = 가리킨 문장의 지금 order_index + 1          # 앞 묶음이 밀었을 수 있다 — DB에서 다시 읽는다
              (after가 None이면 그 칸의 최상위·칸 제목 아닌 문장 가운데 이 묶음 밖의 가장 작은 order_index, 칸이 비었으면 그 문서 최댓값 + 1)
              open_gap(session, doc.id, at, len(묶음)); 묶음의 i번째 문장 order_index = at + i
    ```

  - `sweep_translations` 뒤: 자리를 받은 문장의 남은 번역(`origin` translation, 지워지지 않은 것)을 그 문장 바로 뒤로 옮긴다(`insert_after`, 번역이 여럿이면 앞 번역 뒤에 잇는다).
- [ ] **Step 6: 문구 셋**을 `i18n-messages.ts` en·ko에 넣는다(위 Interfaces). `backend/CLAUDE.md`의 "새로 놓이는 짝·번역의 기본 표시·순서(O10)는 `target_placement.arrange_new_targets`" 문장 옆에 자리 받기(`position` — 굳히기 `freeze_order`는 되돌리기 단계 밖, 끼우는 순서는 `arrange_new_targets`)를 한 문장으로, API 계약 블록에 `position` 한 줄.
- [ ] **Step 7: 초록을 본다** — `$PY -m pytest tests/test_sop_target_position.py tests/test_sop_ai_translate.py tests/test_sop_decisions.py tests/test_sop_decision_undo.py tests/test_sop_numbering.py -q` → PASS. 전체 `$PY -m pytest tests/ -q -n auto` → PASS(실패 0), `ruff check app/ tests/` → 깨끗. `cd ../frontend && npx vitest run src/lib/i18n-messages.test.ts` → PASS.
- [ ] **Step 8: 커밋** — `feat(sop): accept a position for a new sentence in a group save — 관계 묶음 저장이 새 문장의 자리를 받는다` (`PROGRESS.md` 포함)

---

### Task 2: 순수 모델 — 놓을 곳·거절·저장 요청

**Files:**
- Modify: `frontend/src/lib/api-sop.ts`(`TargetPosition`, `TargetInput.position`)
- Modify: `frontend/src/lib/classify-model.ts`(`DropPosition`, `RowDraft.position`, `buildGroupSave`) · Test: `classify-model.test.ts`
- Modify: `frontend/src/lib/assign-drop-model.ts` · Test: `assign-drop-model.test.ts`
- Modify: `frontend/src/lib/composed-model.ts`(`applySavedTargets`의 넷째 인자, `formatSectionPath` 내보내기) · Test: `composed-model.test.ts`

**Interfaces:**
- Consumes: Task 1의 요청 모양. `Destination`·`DestinationOption`·`SentenceSlot`·`getDestinationId`(`classify-model`), `ComposedSection`·`ComposedItem`·`GroupTarget`(`api-sop`).
- Produces:

```ts
// api-sop.ts
export interface TargetPosition { after_target_id: number | null }
export interface TargetInput { /* … */ position?: TargetPosition }   // 없으면 키를 넣지 않는다

// classify-model.ts
/** 문장 사이에 놓은 자리 - placeId는 놓은 곳의 getDestinationId, after는 그 뒤에 끼울 새 문장(null이면 칸의 맨 앞) */
export interface DropPosition { placeId: string; after: number | null }
export interface RowDraft { /* … */ position?: DropPosition | null }

// composed-model.ts
export function formatSectionPath(number: string | null, label: string): string;   // 지금 있는 함수를 내보내기만 한다
export function applySavedTargets(doc: ComposedDoc, targets: readonly GroupTarget[], textOf: (unitIds: number[]) => string, at?: { sectionKey: string; after: number | null } | null): ComposedDoc;

// assign-drop-model.ts
export interface DropItem { targetId: number; groupKey: string | null; sourceUnitIds: readonly number[] }
/** 엮은 문서의 한 칸 - key는 ComposedSection.location_key */
export interface DropSection { key: string; isNa: boolean; items: DropItem[] }
export function buildDropSections(sections: readonly Pick<ComposedSection, "location_key" | "na_reason" | "items">[], rowKeyOf: (unitId: number) => string | undefined): DropSection[];
export interface DropBlock { firstId: number; lastId: number }
/** hoverId가 든 의미 묶음 - groupKey(null 아님)가 같은 이웃 줄들. 그 칸에 없으면 null. 화면이 이 상자의 중간선을 잰다 */
export function findDropBlock(section: DropSection, hoverId: number): DropBlock | null;
export type SendRefusal = "na_slot" | "written_doc" | "same_slot";
export const REFUSAL_KEYS: Record<SendRefusal, string>;   // na_slot → "rule.invalid_group.na_slot", written_doc → "rule.invalid_group.match_doc_new_target", same_slot → "assign.drag.sameSlot"
export type SendDrop =
  | { kind: "gap"; sectionKey: string; after: number | null; edge: { targetId: number; side: "top" | "bottom" } }
  | { kind: "slot"; sectionKey: string }
  | { kind: "refused"; reason: SendRefusal }
  | { kind: "none" };
/** 엮은 문서의 줄 위 - isUpperHalf는 그 줄이 든 묶음 상자의 위 절반인가. dragUnitIds는 끄는 줄의 Unit */
export function resolveGapDrop(section: DropSection, hoverId: number, isUpperHalf: boolean, dragUnitIds: readonly number[]): SendDrop;
/** 엮은 문서의 빈 칸 */
export function resolveSlotDrop(section: Pick<DropSection, "key" | "isNa">): SendDrop;
export type TreeDrop = { kind: "place"; destination: Destination } | { kind: "refused"; reason: "na_slot" } | { kind: "none" };
/** 옆 패널 나무의 줄 - 클릭이 받는 그대로(disabled = N/A). 칸·step만 */
export function resolveTreeDrop(option: Pick<DestinationOption, "destination" | "disabled"> | undefined): TreeDrop;
export function readSectionDestination(docId: number, sectionKey: string): Destination | null;
export function getSectionKey(destination: Destination | null): string | null;
/** 초안의 자리가 아직 그 칸에 있나 - 맨 앞(after null)은 칸이 있으면 참 */
export function isPositionLive(sections: readonly DropSection[], sectionKey: string, after: number | null): boolean;
export interface DraftLine { key: string; lang: SentenceSlot["lang"]; text: string }
/** 점선 초안의 줄 - 서버가 끼울 순서(영어 먼저, 번역 칸은 같은 출처 칸 바로 뒤). texts는 사람이 고친 글(칸 key별) */
export function listDraftLines(slots: readonly Pick<SentenceSlot, "key" | "lang" | "text" | "sourceIds" | "isTranslated">[], texts: Readonly<Record<string, string>>): DraftLine[];
```

- [ ] **Step 1: 실패하는 시험을 쓴다.** 기존 `describe`는 건드리지 않고 덧붙인다.

`assign-drop-model.test.ts`:

```ts
const PURPOSE: DropSection = { key: "purpose", isNa: false, items: [
  { targetId: 1, groupKey: "u10", sourceUnitIds: [10] },
  { targetId: 2, groupKey: "u20", sourceUnitIds: [20] },   // 짝 줄 u20의 두 문장
  { targetId: 3, groupKey: "u20", sourceUnitIds: [21] },
  { targetId: 4, groupKey: null, sourceUnitIds: [] },
] };
const SCOPE_NA: DropSection = { key: "scope", isNa: true, items: [] };
const ROLES: DropSection = { key: "roles", isNa: false, items: [] };

describe("buildDropSections", () => {
  it("keys each line by the Old row of its first source unit", () => {
    const item = (target_id: number, source_unit_ids: number[]) => ({ target_id, kind: "sentence", lang: "en", text: "", status: "confirmed", change_type: "as_is", number: null, source_unit_ids });
    const rowKeyOf = (id: number) => ({ 10: "u10", 20: "u20", 21: "u20" } as Record<number, string>)[id];
    expect(buildDropSections([
      { location_key: "purpose", na_reason: null, items: [item(1, [10]), item(2, [20]), item(3, [21]), item(4, [])] },
      { location_key: "scope", na_reason: "Synthetic", items: [] },
    ], rowKeyOf)).toEqual([PURPOSE, SCOPE_NA]);
  });
});

describe("findDropBlock", () => {
  it("groups neighbours from the same Old row", () => {
    expect(findDropBlock(PURPOSE, 1)).toEqual({ firstId: 1, lastId: 1 });
    expect(findDropBlock(PURPOSE, 3)).toEqual({ firstId: 2, lastId: 3 });
    expect(findDropBlock(PURPOSE, 4)).toEqual({ firstId: 4, lastId: 4 });
    expect(findDropBlock(PURPOSE, 99)).toBeNull();
  });
});

describe("resolveGapDrop", () => {
  it("drops before a block from its upper half and after it from its lower half", () => {
    expect(resolveGapDrop(PURPOSE, 1, true, [50])).toEqual({ kind: "gap", sectionKey: "purpose", after: null, edge: { targetId: 1, side: "top" } });
    expect(resolveGapDrop(PURPOSE, 1, false, [50])).toEqual({ kind: "gap", sectionKey: "purpose", after: 1, edge: { targetId: 1, side: "bottom" } });
  });
  it("never lands in the middle of another meaning group", () => {
    expect(resolveGapDrop(PURPOSE, 3, true, [50])).toEqual({ kind: "gap", sectionKey: "purpose", after: 1, edge: { targetId: 2, side: "top" } });
    expect(resolveGapDrop(PURPOSE, 2, false, [50])).toEqual({ kind: "gap", sectionKey: "purpose", after: 3, edge: { targetId: 3, side: "bottom" } });
  });
  it("refuses the slot the dragged row is already in, even for one sentence of a pair", () => {
    expect(resolveGapDrop(PURPOSE, 1, false, [21, 22])).toEqual({ kind: "refused", reason: "same_slot" });
  });
  it("refuses an N/A slot and is nowhere for a line that is not in the section", () => {
    expect(resolveGapDrop({ ...PURPOSE, isNa: true }, 1, true, [50])).toEqual({ kind: "refused", reason: "na_slot" });
    expect(resolveGapDrop(PURPOSE, 99, true, [50])).toEqual({ kind: "none" });
  });
});

describe("resolveSlotDrop", () => {
  it("takes an empty slot without a position and refuses an N/A one", () => {
    expect(resolveSlotDrop(ROLES)).toEqual({ kind: "slot", sectionKey: "roles" });
    expect(resolveSlotDrop(SCOPE_NA)).toEqual({ kind: "refused", reason: "na_slot" });
  });
});

describe("resolveTreeDrop", () => {
  const slot = { kind: "slot", docId: 6, slotKey: "scope" } as const;
  const step = { kind: "step", docId: 8, step: 1, part: "why" } as const;
  it("takes what a click takes", () => {
    expect(resolveTreeDrop({ destination: slot, disabled: false })).toEqual({ kind: "place", destination: slot });
    expect(resolveTreeDrop({ destination: step, disabled: false })).toEqual({ kind: "place", destination: step });
    expect(resolveTreeDrop({ destination: slot, disabled: true })).toEqual({ kind: "refused", reason: "na_slot" });
  });
  it("is nowhere over a slot heading, a link or no row", () => {
    expect(resolveTreeDrop({ destination: { kind: "slot_heading", docId: 6, slotKey: "scope" }, disabled: false })).toEqual({ kind: "none" });
    expect(resolveTreeDrop({ destination: { kind: "link", targetIds: [7] }, disabled: false })).toEqual({ kind: "none" });
    expect(resolveTreeDrop(undefined)).toEqual({ kind: "none" });
  });
});

describe("readSectionDestination / getSectionKey", () => {
  it("maps a section key to a destination and back", () => {
    expect(readSectionDestination(6, "procedures.procedure")).toEqual({ kind: "slot", docId: 6, slotKey: "procedures.procedure" });
    expect(readSectionDestination(8, "step:2:why")).toEqual({ kind: "step", docId: 8, step: 2, part: "why" });
    expect(readSectionDestination(8, "unstepped:instruction")).toEqual({ kind: "step", docId: 8, step: null, part: "instruction" });
    expect(readSectionDestination(9, "path:1. Purpose")).toBeNull();
    expect(getSectionKey({ kind: "slot", docId: 6, slotKey: "scope" })).toBe("scope");
    expect(getSectionKey({ kind: "step", docId: 8, step: 2, part: "why" })).toBe("step:2:why");
    expect(getSectionKey({ kind: "step", docId: 8, step: null, part: "instruction" })).toBe("unstepped:instruction");
    expect(getSectionKey({ kind: "delete" })).toBeNull();
    expect(getSectionKey(null)).toBeNull();
  });
});

describe("isPositionLive", () => {
  it("is live while the anchor line is still in that section", () => {
    expect(isPositionLive([PURPOSE, ROLES], "purpose", 3)).toBe(true);
    expect(isPositionLive([PURPOSE, ROLES], "purpose", 99)).toBe(false);
    expect(isPositionLive([PURPOSE, ROLES], "roles", 1)).toBe(false);
    expect(isPositionLive([PURPOSE, ROLES], "purpose", null)).toBe(true);
    expect(isPositionLive([PURPOSE, ROLES], "nope", null)).toBe(false);
  });
});

describe("listDraftLines", () => {
  const slot = (key: string, lang: "ko" | "en", text: string, sourceIds: number[], isTranslated = false) => ({ key, lang, text, sourceIds, isTranslated });
  it("orders a KO/EN pair English first, like the server", () => {
    expect(listDraftLines([slot("u10", "ko", "장갑을 낀다.", [10]), slot("u11", "en", "Wear gloves.", [11])], {})).toEqual([
      { key: "u11", lang: "en", text: "Wear gloves." }, { key: "u10", lang: "ko", text: "장갑을 낀다." },
    ]);
  });
  it("shows the edited text and puts a hand-written translation right after its source", () => {
    expect(listDraftLines([slot("u10", "ko", "원문", [10]), slot("u12", "ko", "둘째", [12]), slot("x10", "en", "", [10], true)], { u10: "고친 글", x10: "Edited" })).toEqual([
      { key: "u10", lang: "ko", text: "고친 글" }, { key: "x10", lang: "en", text: "Edited" }, { key: "u12", lang: "ko", text: "둘째" },
    ]);
  });
  it("skips a hand-written slot that is still empty", () => {
    expect(listDraftLines([slot("u10", "ko", "원문", [10]), slot("x10", "en", "", [10], true)], {})).toEqual([{ key: "u10", lang: "ko", text: "원문" }]);
  });
});
```

`classify-model.test.ts`(그 파일의 `makeDraft`·`makeTarget`·`SCOPE`·`ONE_UNIT`을 쓴다 — `makeTarget`의 기본 칸은 `scope`다):

```ts
describe("buildGroupSave with a drop position", () => {
  const position = { placeId: "slot:6:scope", after: 41 };
  const context = (group: Group | null) => ({ units: ONE_UNIT, group, tables: new Map() });
  it("sends the position on a new sentence, and null for the front of the slot", () => {
    expect(buildGroupSave(makeDraft({ position }), context(null), "confirm").targets[0]).toMatchObject({ key: "u10", position: { after_target_id: 41 } });
    expect(buildGroupSave(makeDraft({ position: { placeId: "slot:6:scope", after: null } }), context(null), "confirm").targets[0].position).toEqual({ after_target_id: null });
  });
  it("adds no position key without a drop, or once the destination is no longer the dropped place", () => {
    expect(buildGroupSave(makeDraft(), context(null), "confirm").targets[0]).not.toHaveProperty("position");
    expect(buildGroupSave(makeDraft({ position: { placeId: "slot:6:purpose", after: 41 } }), context(null), "confirm").targets[0]).not.toHaveProperty("position");
  });
  it("sends it on a sentence that moves from another slot, not on one already in the slot", () => {
    const moved: Group = { units: [], targets: [makeTarget({ id: 90, slot_key: "purpose", confirmed_text: "원문", status: "confirmed" })] };
    expect(buildGroupSave(makeDraft({ position }), context(moved), "confirm").targets[0]).toMatchObject({ id: 90, slot_key: "scope", position: { after_target_id: 41 } });
    const here: Group = { units: [], targets: [makeTarget({ id: 90, confirmed_text: "원문", status: "confirmed" })] };
    expect(buildGroupSave(makeDraft({ position }), context(here), "confirm").targets[0]).not.toHaveProperty("position");
  });
  it("sends it on a table sentence but not on its cells", () => {
    const tables = new Map([[10, { rows: 1, cols: 1, cells: [{ id: 11, lang: "ko" as const, text: "칸", row: 0, col: 0 }] }]]);
    const body = buildGroupSave(makeDraft({ position }), { units: [{ id: 10, kind: "table", lang: "neutral" as const, text: "", revision: 1 }], group: null, tables }, "confirm");
    expect(body.targets.map((target) => [target.key, target.position ?? null])).toEqual([["u10", { after_target_id: 41 }], ["c11", null]]);
  });
});
```

`composed-model.test.ts`:

```ts
it("puts the saved sentences at the dropped place, in their saved order, instead of at the end", () => {
  const doc = makeDoc([makeSlot("purpose", "1", "Purpose", [makeItem(1, "1.1"), makeItem(2, "1.2")])]);
  const saved = [makeTarget({ id: 50, slot_key: "purpose", order_index: 3 }), makeTarget({ id: 51, slot_key: "purpose", order_index: 2 })];
  const ids = (at: { sectionKey: string; after: number | null }) => applySavedTargets(doc, saved, () => "", at).sections[0].items.map((item) => item.target_id);
  expect(ids({ sectionKey: "purpose", after: 1 })).toEqual([1, 51, 50, 2]);
  expect(ids({ sectionKey: "purpose", after: null })).toEqual([51, 50, 1, 2]);
  expect(ids({ sectionKey: "purpose", after: 99 })).toEqual([1, 2, 50, 51]);   // 자리의 문장이 없으면 지금처럼 끝에, 받은 순서로
});
```

- [ ] **Step 2: 실패를 본다** — `cd frontend && npx vitest run src/lib/assign-drop-model.test.ts src/lib/classify-model.test.ts src/lib/composed-model.test.ts` → 새 시험 FAIL(없는 함수를 부른다 · `position` 없음). 기존 시험은 그대로 PASS.
- [ ] **Step 3: 모델을 쓴다.**
  - `buildDropSections`: `groupKey = rowKeyOf(item.source_unit_ids[0]) ?? null`(출처가 없으면 null), `isNa = na_reason !== null`.
  - `resolveGapDrop`의 판단 순서: 그 칸에 없는 줄 → `none`, N/A → `na_slot`, 그 칸의 어느 문장이든 `sourceUnitIds`가 `dragUnitIds`와 겹친다 → `same_slot`, 아니면 `gap`. 위 절반: `after` = 앞 묶음의 `lastId`(첫 묶음이면 null), `edge` = 이 묶음 `firstId`의 `top`. 아래 절반: `after` = 이 묶음의 `lastId`, `edge` = 그 줄의 `bottom`.
  - `readSectionDestination`: `:`가 없으면 SOP 칸, `step:<n>:<part>`·`unstepped:<part>`면 step, 그 밖(`path:`)은 null.
  - `listDraftLines`: 번역이 아닌 칸을 영어 먼저로(같은 언어끼리는 받은 순서), 번역 칸(`isTranslated`)은 `sourceIds[0]`이 같은 마지막 줄 바로 뒤(없으면 끝). 글은 `texts[key] ?? text`, 빈 글의 번역 칸은 뺀다.
  - `buildGroupSave`: `destination`이 칸·step이고 `draft.position?.placeId === getDestinationId(destination)`일 때만, 최상위 항목(표 새 문장·그림·문장 칸) 가운데 **새로 만들거나 (문서, 칸, step, part)가 바뀌는** 것에 `position: { after_target_id: draft.position.after }`를 더한다. 칸 문장(`parent_key`)·되보내는 문장(`echoTarget`)·칸 제목·잇기에는 넣지 않는다.
  - `applySavedTargets`: `at`이 있고 그 칸에 `after`의 문장이 남아 있으면(`after === null`이면 맨 앞) 그 칸에 넣을 문장을 `order_index` 순으로 그 자리에, 아니면 지금처럼 끝에.
- [ ] **Step 4: 통과를 본다** — 같은 명령 → PASS. `npx tsc --noEmit -p tsconfig.json`, `npm run lint`도 초록.
- [ ] **Step 5: 커밋** — `feat(assign): add the drop model for sending an Old piece into a slot — Old 조각을 칸으로 보내는 놓기 모델과 자리를 싣는 저장 요청` (`PROGRESS.md` 포함)

---

### Task 3: 화면 — New · from Assign 문서에 놓기

**Files:**
- Modify: `frontend/src/components/assign/new-pane.tsx`(줄 상자 표시, 빈 칸 표시, 점선 초안)
- Create: `frontend/src/components/assign/drop-gap-line.ts`(놓을 자리 선 — React 없는 명령형 DOM, `drag-link-line.ts`와 같은 짜임)
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx`(놓을 곳 읽기·놓기 적용·초안 메뉴·저장 뒤 미리 고침)
- Modify: `frontend/src/styles/components.css`(Assign New 칸 규칙 옆), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 하나)

**Interfaces:**
- Consumes: Task 2의 전부. `findUnderPoint`·`DragHover`(`@/lib/box-drag`), `createDragLinkLine`·`readOldLineStart`, `page.tsx`의 `dragConfig`·`readDropAt`·`dropLink`·`selectRow`·`setManualNewDoc`·`openMenu`·`revealElement`·`flashElement`·`pickDestination`·`runMenu`·`showSent`·`slots`·`rowOfUnit`·`composedDoc`·`isComposedDoc`·`newDocId`.
- Produces:
  - DOM: New 칸의 모든 줄 상자 `.new-item`에 `data-row={getNewRowKey(row)}`(`t:<id>` | `slot:<칸>`). 빈 칸 자리 표시 `.new-slot-empty`에 `data-slot={row.key}`, N/A면 `data-na=""`, 지금 줄의 초안이 그 칸이면 `data-draft=""`.
  - `NewPane` prop `draft?: { anchorKey: string; side: "before" | "after"; lines: DraftLine[] } | null` — 엮은 문서(`readOnly`)에서만. `anchorKey`의 줄 상자 바로 앞(`before`)이나 뒤(`after`)에 `<div className="new-draft" data-testid="assign-new-draft">`를 그리고, 그 안에 줄마다 `<div className="strip new-draft-line" data-lang={lang} data-testid={`assign-new-draft-line-${index}`}>`(글과 `LangToken`)과 맨 위에 "Not saved yet"(`assign.unsaved`) 꼬리표. 앞머리 폭만큼 들여 문장 상자와 왼쪽 x가 같다(빈 칸 줄의 `strip-lead-gap`과 같은 방식). 줄 들고 남(`useRowPresence`)·이음 선·`data-target`에 끼지 않는다. `anchorKey`의 줄이 없으면 그리지 않는다.
  - `NewPane` prop `draftSlotKey?: string | null` — 그 칸의 빈 칸 자리 표시에 `data-draft`.
  - `drop-gap-line.ts`: `export function createDropGapLine(root: HTMLElement): { show(at: { left: number; top: number; width: number }): void; hide(): void; remove(): void }` — `root`(`.assign-panes`)에 `<div class="c-dropline" data-testid="assign-drop-gap" hidden>` 하나. 좌표는 client 좌표로 받아 `root` 기준으로 옮긴다.
  - 새 문구(en / ko): `assign.drag.sameSlot`: "Already in this section. Change the order in Order" / "이미 이 칸에 있습니다 · 순서는 Order에서 바꿉니다". 기존 키의 글만 고침: `assign.help.keyDrag`: "Link an Old piece to a sentence, or send it to a slot" / "Old 조각을 New 문장에 잇거나 칸으로 보내기".
  - 표의 메모: 문장 사이·빈 칸 위에서 `→ ${formatSectionPath(section.number, section.label)}`(번역 키 없음 — Order의 "→ 5.2"와 같은 짜임).

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 단계 이름 `assign: drag an Old piece between two sentences of a New · from Assign document, Confirm saves it at that place`. 자리는 시드 묶음을 쓰는 Assign·Order 단계가 모두 끝난 뒤(`new bundle in one click, locked stages, empty assign` 바로 앞) — 이 단계가 문서를 `manual_order`로 굳히는데 화면으로 되돌릴 길이 없어 앞에 두면 뒤 단계의 순서를 흔든다. 자료는 단계 안에서 API로 만든다(시드를 고치지 않는다): `halfBundleId`의 엮는 SOP 문서 하나를 골라(`GET /tobe`의 `entrance === "assign"`·`doc_type === "sop"`), 미배정이고 짝 없는 Old 문장 Unit 여섯(`GET /units`)을 원문 순서로 A·B·C·P·X·Y라 하고, A·B·C를 N/A가 아닌 칸 K에, P를 다른 칸 K2에 `POST /groups/save`(자리 없이)로 확정한다. 빈 칸 E와 N/A 칸 N은 `GET /outputs/c/docs/{id}`에서 고르고, N/A 칸이 없으면 `PUT /tobe`로 하나 만든다. 미배정·짝 없는 문장이 여섯에 못 미치면 `POST /decisions/reset`(묶음 전체)으로 비운 뒤 고른다 — 그 전에 이 뒤의 단계가 그 묶음의 배정을 읽지 않는지 `grep`으로 확인한다. 끄는 길은 2걸음 단계의 도우미(`dragThrough`·`installCommitCounter`·`pointInUnit`·`openNewDoc`)를 쓴다. 확인할 것:
  1. **끄는 동안**(X를 K의 A와 B 사이로): `drag-card`의 메모가 `→ `로 시작한다. `assign-drop-gap`이 보이고 그 세로 자리가 A 줄 상자의 아래 끝에서 6px 안이다. `[data-drop]`은 없다. 문장 위·사이를 40걸음 지나는 동안 `window.__commits`가 늘지 않는다.
  2. **놓은 뒤**: X의 조각에 `data-sel`. `assign-new-draft`가 A 줄과 B 줄 사이에 있고(DOM 순서와 화면 y 모두) `assign-new-draft-line-0`의 글이 X의 글이다. `assign-chosen`이 그 칸을 보인다. `assign-link-menu`가 보이고 `assign-link-menu-unsaved`가 하나다. `assign-primary`의 `data-state`가 `confirm`이다. `drag-card`·`svg[data-drag-line]`·`[data-drop]`·`[data-drag-src]`가 없고 `assign-drop-gap`은 감춰졌다.
  3. **저장되지 않았다**: `GET /units`에서 X의 `status`가 `unassigned`, `GET /outputs/c/docs/{id}`의 K가 여전히 [A, B, C]의 새 문장이다.
  4. **Cancel**(`assign-link-menu-cancel`): `assign-new-draft`가 사라지고 `assign-chosen`이 빈 상자(`is-empty`)다.
  5. **Esc**: 다시 끌다가 문장 사이에서 `Escape` → 표·선이 사라지고 초안·메뉴가 생기지 않는다.
  6. **Confirm**: 다시 놓고 <kbd>↵</kbd>. `page.waitForRequest`로 잡은 `/groups/save` 본문에서 X가 출처인 최상위 항목의 `position`이 `{ after_target_id: A의 새 문장 }`이다. 응답 뒤 `GET /outputs/c/docs/{id}`의 K가 [A, X, B, C] 순서다. `page.reload()` 뒤 다시 읽어도, 화면의 줄 순서도 같다.
  7. **빈 칸**(Y를 E로): 올린 동안 `assign-new-slot-<E>`에 `data-drop="over"`. 놓은 뒤 그 자리 표시에 `data-draft`, 메뉴가 뜬다. <kbd>↵</kbd> → 요청의 어느 항목에도 `position` 키가 없다. E가 [Y]다.
  8. **거절은 이유를 보이고 아무것도 쓰지 않는다**: N/A 칸 N 위 → `drag-card[data-refused]`, 메모가 "That section is N/A in the To-Be list.", `assign-new-slot-<N>`에 `data-drop="refused"`. 이미 쓴 문서로 바꿔(`openNewDoc`) 두 문장 사이 틈 위 → 메모가 `rule.invalid_group.match_doc_new_target`의 en 글. 확정한 X를 K의 문장 위로 → 메모가 "Already in this section. Change the order in Order". 셋 다 놓은 뒤 초안·메뉴가 없고 `GET /units`·K가 그대로다.
  9. **확정한 줄을 다른 칸으로**: X를 K2의 P 위 절반에 놓는다 → 초안이 P 앞에 있고 New 칸 화면 안에 보인다. <kbd>↵</kbd> → 요청의 그 항목에 `id`(기존 새 문장)와 `position: { after_target_id: null }`. K2가 [X, P], K가 [A, B, C].
  10. **클릭 길은 그대로**: 엮은 문서의 문장을 눌러도 `assign-chosen`이 바뀌지 않는다(미리 보기 줄은 고르지 못한다). Y 줄을 고른 채 옆 패널 나무에서 칸 K를 눌러 고르고 <kbd>↵</kbd> → 요청에 `position` 키가 없고 Y가 K의 끝에 선다(순서를 사람이 정한 문서의 지금 규칙).
  11. 끝에 이 단계가 확정한 줄을 **Clear**(U)로 되돌린다.
- [ ] **Step 2: 실패를 본다.** 갓 시드한 DB에서 전체 스모크 → 새 단계만 실패. 다른 단계의 지금 실패 기준선을 적어 둔다.
- [ ] **Step 3: `new-pane.tsx`.** `data-row`·`data-slot`·`data-na`·`data-draft`와 `draft`·`draftSlotKey` prop. 문장 줄·빈 칸 줄의 기존 `data-testid`·글은 그대로 둔다. 엮은 문서의 문장은 여전히 `span.new-hit.is-static`이다(단추로 바꾸지 않는다).
- [ ] **Step 4: `drop-gap-line.ts`.** `.c-dropline`의 모양을 그대로 받는다(값을 다시 적지 않는다).
- [ ] **Step 5: `page.tsx` — 끄는 동안.** `dragConfig.onMove`가 보는 순서: ① 이미 쓴 문서의 고를 수 있는 문장 줄(2걸음 `readDropAt` 그대로 — 고치지 않는다) ② `findUnderPoint(point, '[data-pane="new"] .new-item[data-row]:not([data-leave])')`.
  - 엮은 문서(`.pg[data-read-only]` 안): `t:<id>`면 `findDropBlock`으로 묶음을 찾아 그 첫 줄 상자의 위와 끝 줄 상자의 아래를 재고(`getBoundingClientRect`) 중간선과 견줘 `resolveGapDrop`. `slot:<칸>`이면 `resolveSlotDrop`.
  - 이미 쓴 문서: 포인터가 `.new-line`·`.new-block` 밖이면 `{ kind: "refused", reason: "written_doc" }`.
  - 돌려주는 것: `gap` → `{ state: "ok", note }`(target 없음)이고 놓을 자리 선을 `edge` 줄 상자의 그 변에, 왼쪽 끝·폭은 그 줄의 문장 상자(`.new-line`·`.new-block`)에 맞춘다. `slot` → `{ state: "ok", note, target: 그 자리 표시 }`. `refused` → `{ state: "refused", note: t(REFUSAL_KEYS[reason]), target }`(N/A는 그 자리 표시, `same_slot`은 올린 줄의 문장 상자, `written_doc`은 없음). 그 밖은 `{ state: "none" }`. `gap`이 아니면 선을 감춘다. 선의 세로 자리가 New 칸 `.pane-body` 화면 밖이면 감춘다(Review Focus 5).
  - `DropSection` 목록은 끌기마다 한 번(`composedDoc` 객체가 바뀌면 다시) 지어 ref에 둔다 — `pointermove`마다 짓지 않는다. 따라오는 점선의 끝은 `gap`이면 놓을 자리 선의 왼쪽 끝, 그 밖은 지금처럼 포인터.
  - `onStart`에서 선을 만들고 `onEnd`에서 지운다(취소 때도).
- [ ] **Step 6: `page.tsx` — 놓았을 때와 그 뒤.**
  - `onDrop`: 놓은 자리에서 다시 판단한다. `gap`·`slot`이면 2걸음과 같은 줄 고르기(`setChecked(new Set())` → `setCtxMenu(null)` → `selectRow(rowKey, false)`) → `setManualNewDoc({ key: rowKey, docId: newDocId })` → `setDropPlace({ rowKey, destination: readSectionDestination(newDocId, sectionKey), position: gap이면 { placeId: getDestinationId(destination), after } 아니면 null, menu: true })`. `refused`·`none`이면 아무 일도 없다.
  - 새 상태 `dropPlace: { rowKey: string; destination: Destination; position: DropPosition | null; menu: boolean } | null` — `dropLink`와 같은 "렌더 중 상태 맞추기"로 푼다: `activeKey !== dropPlace.rowKey`면 버리고, 같고 `groupPending`이 아니면 `setDropPlace(null)` 뒤 자리가 없으면 `pickDestination(destination)`(클릭과 같은 함수), 있으면 `setDraft({ destination, position, linkChangeTypes: {} })`와 `setPickSeq`. `menu`면 이어서 `setDraftMenu({ rowKey })`.
  - 새 상태 `draftMenu: { rowKey: string } | null`과 이펙트(`jump` 이펙트의 짜임 — 프레임마다 최대 60번 찾는다): `[data-testid="assign-new-draft"]`(없으면 `.new-slot-empty[data-draft]`)를 찾아 `revealElement` → `flashElement` → `openMenu(el, null, rowKey, null)`. 렌더 중에 DOM을 읽지 않는다.
  - `pickDestination`의 `setDraft`에 `position: null`을, `runMenu`의 `cancel`에도 `position: null`을 더한다(그 밖의 동작은 그대로).
  - `NewPane`에 넘기는 값: 엮은 문서이고 지금 줄의 초안(`draft.destination`)이 이 문서의 칸·step일 때만. `draft.position`이 있고 `placeId`가 맞으면 `draft = { anchorKey, side, lines }` — `after`가 있으면 `{ anchorKey: "t:" + after, side: "after" }`, null이면 그 칸 첫 줄의 `before`. `lines`는 `listDraftLines(slots, draft.texts)`이고 줄이 표·그림 Unit이면 그 Unit마다 한 줄(`lang: "neutral"`, 글은 `t("split.table")` / `t("assign.newFigure")`). 자리가 없고 그 칸이 비어 있으면 `draftSlotKey`.
  - 자리가 죽었으면 버린다(렌더 중 상태 맞추기): 초안의 문서가 지금 받은 `composedDoc`이고 `!isPositionLive(buildDropSections(…), getSectionKey(draft.destination), draft.position.after)`면 `setDraft({ position: null })`.
  - `runSave`의 `showSent`: 이 저장이 자리를 실었으면 `applySavedTargets(…, { sectionKey, after })`로 그 자리에 미리 넣는다.
  - 서버가 자리를 거절하면(422) 지금처럼 `humanizeApiError` 알림이 뜨고 초안은 남는다 — 따로 다루지 않는다(`rule.invalid_group.<reason>` 문구는 Task 1이 넣었다).
- [ ] **Step 7: CSS**(값은 토큰만).
  - `.new-draft-line`: 후보 줄과 같은 점선(`1.5px dashed var(--accent)`) 테두리의 문장 상자, 글은 `.new-text`와 같은 글꼴. 꼬리표는 `--ink-3`의 캡션.
  - `.new-slot-empty[data-draft]`: 테두리 색만 `--accent`(점선 그대로).
  - 끄는 동안(G10) New 칸의 호버로 뜨는 것은 2걸음 규칙(`html[data-box-drag] .assign-panes …`)이 이미 끈다 — 엮은 문서에서 새로 뜨는 것이 없는지 `grep`으로 확인한다.
  - 거절 테두리(`[data-drop="refused"]`)가 `.new-line`·`.new-slot-empty`에서 이웃 줄의 글·출처 칩을 덮지 않는지 화면에서 잰다 — 덮으면 그 선택자에서 `outline-offset`만 고친다.
- [ ] **Step 8: 문구·사용 설명서.** `assign.drag.sameSlot`(en·ko)과 `assign.help.keyDrag`의 글. 설명서 `#assign-destination`의 "끌어서 잇기" 문단 뒤에 "끌어서 보내기" 문단 — **New · from Assign** 문서의 두 문장 사이에 놓으면 그 자리에 점선 초안이 생기고 **Confirm** 때 그 자리로 들어간다는 것(그 문서는 그때부터 순서를 사람이 정한 문서가 된다), 빈 칸에 놓으면 그 칸으로만 간다는 것, 놓아도 저장이 아니라는 것(**Not saved yet**), 같은 의미의 줄 한가운데에는 끼우지 않는다는 것, 못 놓는 곳 셋과 이유, 이미 확정한 줄을 다른 칸의 문장 사이로 옮길 수 있고 같은 칸 안의 순서는 **Order & numbering** 에서 바꾼다는 것. 2걸음 문단의 "아직 쓰지 않은 문서…에는 아직 놓이지 않는다"는 말을 `grep`으로 찾아 고친다(옆 패널은 Task 4에서). `#assign-keys`의 끌기 줄도 고친다. `manual-content.test.ts` 통과.
- [ ] **Step 9: 초록을 본다.** `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, 갓 시드한 DB에서 전체 스모크(새 단계 PASS, Step 2의 기준선보다 실패가 늘지 않음), `next dev`를 내리고 `npm run build` 경고 0.
- [ ] **Step 10: 커밋** — `feat(assign): drop an Old piece between sentences or into an empty slot of a New document being composed — Old 조각을 엮는 New 문서의 문장 사이·빈 칸에 놓기` (`PROGRESS.md` 포함)

---

### Task 4: 화면 — 옆 패널 나무에 놓기와 한 단 보기

**Files:**
- Modify: `frontend/src/components/assign/destination-tree.tsx`(칸·step 줄 표시)
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx`(나무 위 판단과 놓기)
- Modify: `frontend/src/styles/components.css`, `frontend/public/manual/user-manual.md`
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 하나)

**Interfaces:**
- Consumes: Task 2의 `resolveTreeDrop`·`REFUSAL_KEYS`, Task 3의 `dropPlace`(`menu: false`로).
- Produces: 나무의 보낼 곳 줄 `.tree-row`에 `data-place={option.id}`(칸 제목 줄 포함 — 무엇을 받는지는 모델이 정한다), N/A면 `data-na=""`. 표의 메모 `→ ${option.docCode} · ${option.label}`. 새 문구·새 `data-testid` 없음.

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 단계 이름 `assign: drag an Old piece onto a slot in the All list, in both views, it saves like a click`, 자리는 Task 3의 단계 바로 뒤. 자료는 Task 3과 같은 방식으로 단계 안에서 만든다(미배정 Unit 둘 Z·W, 엮는 SOP 문서의 N/A가 아닌 칸 K와 N/A 칸 N). 끌기 전에 **All**(`assign-acc-all`)과 그 문서 마디(`assign-tree-p<번호>`)를 펼친다. 확인할 것:
  1. **두 단 보기**: Z를 `assign-tree-place-slot:<문서>:<K>` 줄 위로 → 그 `.tree-row`에 `data-drop="over"`, 표의 메모가 `→ `로 시작하고 문서 번호를 담는다. 나무 줄들을 30걸음 지나는 동안 `window.__commits`가 늘지 않는다.
  2. 놓은 뒤: Z의 조각에 `data-sel`, `assign-chosen`이 그 칸을 보이고 `assign-primary`의 `data-state`가 `confirm`, 그 자리 메뉴(`assign-link-menu`)는 **없다**. `GET /units`의 Z는 `unassigned` 그대로다. <kbd>↵</kbd> → `/groups/save` 본문의 어느 항목에도 `position` 키가 없고, `GET /outputs/c/docs/{id}`의 K에 Z의 새 문장이 있다.
  3. **N/A 줄** 위 → `drag-card[data-refused]`, 메모가 "That section is N/A in the To-Be list.", 줄에 `data-drop="refused"`. 놓아도 `assign-chosen`·`GET /units`가 그대로다.
  4. **놓을 곳이 아닌 줄**: 칸 제목 줄(`assign-tree-place-heading:…`, 보이면)과 이미 쓴 문서의 문장 줄(`assign-tree-sentence-…`, 있으면) 위에서는 `[data-drop]`이 생기지 않고 놓아도 아무 일도 없다.
  5. **한 단 보기**(`assign-view-one`): `assign-new`가 없다. W를 같은 방식으로 나무의 K 줄에 놓고 <kbd>↵</kbd> → K에 W의 새 문장, 요청에 `position` 없음. Old 용지 위에 놓으면 아무 일도 없다. `assign-view-two`로 되돌린다.
  6. **Esc**: 나무 줄 위에서 `Escape` → 표가 사라지고 `assign-chosen`이 그대로다.
  7. **클릭은 그대로**: 놓기 직후 그 줄을 눌러도(뒤따르는 `click` 삼킴 뒤의 진짜 클릭) 고름이 그 칸이고 다른 저장이 생기지 않는다. 끌지 않고 누르면 지금처럼 그 칸이 골라진다.
  8. 끝에 Z·W를 **Clear**로 되돌린다.
- [ ] **Step 2: 실패를 본다** — 갓 시드한 DB의 전체 스모크에서 새 단계만 실패.
- [ ] **Step 3: `destination-tree.tsx`** — 보낼 곳 줄의 `.tree-row`에 `data-place`·`data-na`. 단추·클릭·지우기 단추는 건드리지 않는다.
- [ ] **Step 4: `page.tsx`** — `onMove`의 맨 앞에 나무를 본다: `findUnderPoint(point, '.dest-tree .tree-row[data-place]')` → `options.find((option) => option.id === row.dataset.place)` → `resolveTreeDrop`. `place` → `{ state: "ok", note, target: 그 줄 }`, `refused` → `{ state: "refused", note: t(REFUSAL_KEYS.na_slot), target: 그 줄 }`, `none`이면 New 칸 판단으로 넘어간다. `onDrop`: `place`면 줄 고르기 뒤 `setDropPlace({ rowKey, destination, position: null, menu: false })` — 풀릴 때 `pickDestination(destination)`을 부른다(클릭과 같은 함수, 자리 없음). New 칸의 문서는 바꾸지 않는다(클릭과 같다). 한 단 보기에서는 New 칸이 없어 나무만 놓을 곳이다 — 따로 가를 것이 없다.
- [ ] **Step 5: CSS** — 끄는 동안 옆 패널의 호버·툴팁을 끈다(G10): `html[data-box-drag] .assign-side :is(button, a, input, [role="slider"]) { pointer-events: none; }`(두 문서 틀의 2걸음 규칙과 같은 방식 — 단추가 포인터를 받지 않아도 그 줄 `.tree-row`가 받는다). `.tree-row[data-drop]`의 테두리가 이웃 줄의 글과 줄 끝 지우기 단추를 덮지 않는지 잰다(덮으면 `outline-offset`만).
- [ ] **Step 6: 사용 설명서** — "끌어서 보내기" 문단에 옆 패널: **All** 목록의 칸·step 줄에 놓으면 그 줄을 누른 것과 같다(자리는 정하지 않는다), 접힌 문서는 끌기 전에 펼친다, **One document** 보기에서는 옆 패널이 놓을 곳이다. Task 3에서 남긴 "옆 패널에는 아직 놓이지 않는다"는 말이 있으면 지운다.
- [ ] **Step 7: 초록을 본다** — Task 3 Step 9와 같은 명령(전체 스모크에서 새 단계 둘 PASS).
- [ ] **Step 8: 커밋** — `feat(assign): drop an Old piece onto a slot in the All list, also in the one-document view — Old 조각을 옆 패널 나무의 칸에 놓기(한 단 보기 포함)` (`PROGRESS.md` 포함)

---

### Task 5: 극단 자료·좁은 창 검토와 올리기 준비

**Files:**
- Modify(필요할 때만): Task 3·4의 CSS·`drop-gap-line.ts`·`new-pane.tsx`·`page.tsx`
- Modify: `frontend/package.json`·`package-lock.json`(1.1.7), `CHANGELOG.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-11-16-drag-and-drop-design.md`, `docs/README.md`, `frontend/CLAUDE.md`

**Interfaces:**
- Consumes: Task 1~4.
- Produces: dev에 합칠 수 있는 브랜치(푸시·합치기는 조율하는 세션이 한다).

- [ ] **Step 1: 극단 자료로 다시 시드한다**(`seed_sop_worst`) — 창 폭 1120과 2560에서 Assign을 열고 스크립트(`playwright-core` + 시스템 Chrome)로 잰다. 눈으로만 보지 않는다. 겹치면 고친다(보고만 하지 않는다).
  - Unit 수천 개 문서에서 Old 조각을 끌어 엮은 문서의 줄 위를 40걸음, 나무 줄 위를 30걸음 지나는 동안 `window.__commits` 증가 0.
  - 1,800자 문단을 끌 때 `drag-card`의 높이가 한 줄(≤ 34px)이고, 가장 긴 거절 이유(en·ko 둘 다 — `rule.invalid_group.match_doc_new_target`)가 메모에 있을 때 표가 창 오른쪽 밖으로 나가지 않는다(나가면 표의 글 칸을 줄여 메모가 남게 고친다).
  - 1,800자 문단을 문장 사이에 놓았을 때 점선 초안의 아래 끝이 다음 줄의 위 끝을 넘지 않고, 초안의 왼쪽 x가 문장 상자의 왼쪽 x와 같다(±1px).
  - 놓을 자리 선: 왼쪽 동그라미가 앞머리 번호 글자를 덮지 않는다(겹치는 px를 잰다). New 칸 아래 가장자리에 포인터를 두면 New 칸이 스스로 스크롤되고 선이 줄과 함께 움직이며, 그 자리가 `.pane-body` 밖이면 감춰진다.
  - 놓은 뒤 그 자리 메뉴가 폭 1120에서 화면 안에 있고 점선 초안의 글을 덮지 않는다.
  - 나무: 폭 1120에서 거절 테두리(점선)와 올림 테두리가 이웃 줄의 글·지우기 단추를 덮지 않는다.
  - 움직임 줄이기(`prefers-reduced-motion`)에서 초안이 바로 나타나고 번쩍임이 정지한 테두리로만 보인다.
- [ ] **Step 2: Review Focus 5를 스모크로 박는다**(Task 3·4의 단계에 덧붙인다): 문장 사이에 놓은 직후 `assign-new-draft`가 한 개로 남고(뒤따르는 `click`이 고름을 바꾸지 않는다), 나무에 놓은 직후 `/groups/save` 요청이 0건이다. 놓자마자 `j`로 다른 줄로 가면 초안이 그 줄에 적용되지 않는다(옮겨 간 줄의 `assign-chosen`이 제 값).
- [ ] **Step 3: 전체 검증.** backend: `$PY -m pytest tests/ -q -n auto` PASS, `ruff check app/ tests/` 깨끗. frontend: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, `npm run build` 경고 0. 갓 시드한 DB(`seed_sop_demo`)에서 전체 스모크 → 다시 시드 → `pw-overlap-audit.mjs`, `DS=worst pw-layout-audit.mjs`, `pw-contrast-audit.mjs`(공용 부품 `new-pane.tsx`·`destination-tree.tsx`와 API 층을 고쳤다). 합성 데모·E2E 몰이(`scripts/sop_demo_driver.py`)는 `position`을 보내지 않아 그대로다 — `test_sop_e2e.py`·`test_seed_sop_demo.py`가 전체 pytest에서 초록인 것으로 확인한다.
- [ ] **Step 4: 버전과 기록.** `frontend/`에서 `npm version patch --no-git-tag-version` → 1.1.7. `CHANGELOG.md` `## Unreleased (dev)` 아래 `### v1.1.7 — <이 커밋을 만드는 날>`(무엇이 되는지, 문장 사이에 놓고 확정하면 그 문서가 순서를 사람이 정한 문서가 된다는 것, 알려진 한계 — 접힌 나무는 끄는 동안 펼쳐지지 않는다 · 굳힌 문서의 그 전 단계는 되돌리기가 409다 · 터치는 그대로). `PROGRESS.md`는 이 브랜치의 항목을 요약 하나로 줄인다. 설계 문서: §10의 3걸음에 "(v1.1.7로 dev에 올렸다.)", §6 끝에 "3걸음(보내기)에서 정한 것" 묶음으로 위 "이 계획이 정한 것"을 "(내 판단)" 한 줄씩, §8의 "받은 순서대로"를 3번 판단으로 고치고 "되돌리기" 문단에 굳히기가 단계 밖이라는 것과 그 결과를 더하고, §12의 되돌리기 줄을 "확인했다 — 사용자 확인 대기"로 바꾼다. `docs/README.md`에 이 계획 한 줄을 더하고 설계 줄의 상태를 고친다. `frontend/CLAUDE.md`의 "Assign 잇기는 `lib/assign-drop-model.ts`"를 "잇기·보내기"로.
- [ ] **Step 5: 커밋** — `chore(release): v1.1.7, send an Old piece into a slot by dragging — Old 조각을 끌어 칸으로 보내기 (v1.1.7)`

---

## Self-Review 기록

- **설계 대비**: §6 놓는 곳 표의 둘째 줄(문장 사이)·셋째 줄(빈 칸)은 Task 3, 넷째 줄(나무의 칸·step)은 Task 4. "자리를 보내는 것은 두 문장 사이에 놓았을 때뿐"은 Task 2의 `buildGroupSave` 시험과 Task 3·4 스모크의 요청 본문 확인. 거절 셋(N/A · 이미 쓴 문서의 문장 사이 · 같은 칸)과 묶음 한가운데는 Task 2 모델 + Task 3 스모크 8. "이미 확정한 줄을 끌면"은 Task 2(`position`은 옮기는 문장에만)와 Task 3 스모크 9. "끄는 동안 초안 이음 선"은 2걸음 것을 그대로 쓰고 끝만 맞춘다(Task 3 Step 5). "놓은 뒤 Not saved yet · Confirm · Edit and confirm · Cancel"은 Task 3 Step 6. §8 자리 받기의 네 문단은 Task 1(굳히기 · 끼우기 · 거절 · 되돌리기), §9 서버 항목(맨 앞·가운데·끝, 짝, 굳는 것, 다른 칸의 ID 거절, 자리 없는 저장)은 Task 1 시험에 하나씩 있다. §9 극단 자료는 Task 5. G1~G5·G8은 끌기 층, G6·G7·G9~G11은 Task 3·4, G12는 Global Constraints와 스모크의 "클릭 길", G13은 `canDragOld` 그대로.
- **설계와 다르게 정한 것**은 셋이고 모두 위에 적었다: 끼우는 순서(서버 3번), 다른 줄을 고를 때의 초안(화면 18번), 굳히기를 되돌리기 단계 밖에 두는 것("§12 열린 것").
- **하지 않는 것**: 하위 칸이 있는 상위 칸의 규칙(열린 질문), 끄는 동안 나무 펼치기, 추천 카드·Nearby 목록에 놓기(설계의 놓는 곳이 아니다), `manual_order`를 API로 내보내기(스모크는 요청 본문의 `position` 유무와 다시 읽은 순서로 본다 — 굳는 것 자체는 pytest가 박는다), 엮은 문서 응답에 묶음 키 더하기.
- **이름 맞춤**: `position`/`after_target_id`(서버·`TargetInput`) ↔ `DropPosition { placeId, after }`(초안) ↔ `at { sectionKey, after }`(미리 고침) — 셋은 다른 층의 다른 모양이고 Task 2의 Interfaces에 모두 있다. `save_group`은 이름은 남고 서명이 바뀐다(Task 1).
