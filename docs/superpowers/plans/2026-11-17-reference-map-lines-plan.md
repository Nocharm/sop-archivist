# 참조 지도(Map) 3걸음 — 구성원에게만 보이는 문장과 줄에서 Assign 열기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참조 지도에서 고른 문서의 줄(문장)을 **그 줄이 든 Bundle의 구성원에게만** 옆 칸에 보이고, 줄 끝의 **Open in Assign** 으로 그 Bundle의 Assign을 그 줄을 고른 채 연다.

**Architecture:** 서버는 1·2걸음의 라우터·모듈에 읽기 하나를 더한다 — `GET /api/bundles/{bundle_id}/map/lines?node=<마디 id>&scope=linked|all`. 줄은 1·2걸음의 줄 모으기(`ref_map.MapLine`)를 마디 하나로 좁혀 얻고(규칙을 두 번 쓰지 않는다), 글은 `bundle_members`를 SQL에서 조인한 질의 하나로만 싣는다. 구성원이 아닌 Bundle의 줄은 항목 없이 수만 간다. 화면은 순수 모델 둘(`lib/map-lines-model.ts` 줄을 옆 칸의 줄에 붙이기, `lib/assign-line-param.ts` Assign 주소 값 풀기)이 규칙을 갖고, Assign은 `?doc=<문서 id>&unit=<unit id>`를 읽어 그 줄을 고른 뒤 주소에서 뗀다(`?edit=`과 같은 방식).

**Tech Stack:** Python 3.11 · FastAPI · SQLAlchemy(async) · pytest / Next.js 16 · React 19 · TypeScript · vitest · Playwright(시스템 Chrome) 스모크. 새 의존성·새 권한 키·새 env·Alembic 리비전·새 거절 코드 없음.

**Spec:** `docs/superpowers/specs/2026-11-17-reference-map-design.md` — §2(반목표 "문장 한 글자라도"), §5, §6.8(옆 칸·가기·줄 주소), §6.9("문장을 읽지 못함"), §7.2, §8(`map.side.hidden`·`moreLines`·`map.lines.error`·`map.assign.gone`), §9(`lines` 시험·브라우저 2·5), §10의 3걸음, §11. 먼저 1·2걸음 계획 `docs/superpowers/plans/2026-11-17-reference-map-plan.md`의 "가시성 행렬"·"이 계획이 정한 것"(판단 1·3·4·5·6·14)과 그것이 만든 코드(`backend/app/sop/ref_map.py`·`tests/sop_map_helpers.py`·`frontend/src/lib/map-model.ts`·`components/map/map-side.tsx`)를 읽는다. 그리고 루트 `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `rules/common/security.md`, `docs/lessons/react-ts-patterns.md`(§3·§7)·`browser-verification.md`·`ui-review.md`(8·9번).

## Global Constraints

- **접근 규칙이 첫째다(사용자 결정 2026-11-16): "문장은 그 Bundle 구성원만 본다."** 줄 항목(Unit 글·표시 ID·Unit id·문서 id·번호·상태)은 **그 줄이 든 Bundle의 구성원에게만** 싣는다. 구성원이 아닌 Bundle의 줄은 항목 자체가 응답에 없고 수(`hidden_out`·`hidden_in`)만 있다 — 화면에서 가리는 것은 접근 제어가 아니다. sysadmin·`bundle.admin` 보유자도 구성원이 아니면 수만 받는다. 응답의 모든 필드는 아래 "가시성 행렬"에 줄이 있고 칸마다 서버 시험이 있다.
- **글을 싣는 질의는 하나이고 `bundle_members`(그 문서의 Bundle, 요청한 사람)를 SQL에서 조인한다**(`load_line_texts`). 파이썬 필터에만 기대지 않는다. 그 질의가 돌려주지 않은 Unit의 줄은 **가려진 것으로 센다**(닫힌 쪽으로 실패한다). 수는 글을 응답 객체에 넣지 않는 길로 센다.
- **구성원에게도 싣지 않는 것**: Moved to의 사유(`UnitDecision.reason`)·보류 사유·새 문장·파일 이름·설명·구성원·AI 제안·EQUIS. 스키마에 그런 필드를 두지 않는다.
- **있고 없음을 응답 코드로 가르지 않는다**: 없는 마디, 다른 종류(합성/실제)의 마디, 번호 꼴이 아니거나 임시 번호인 `num:` 마디는 모두 **빈 목록의 200**이다(수도 0). 꼴이 틀린 `node`만 422.
- **지도의 줄 수와 목록은 어긋나지 않는다**: 어느 마디·어느 범위에서든 `len(out) + hidden_out + more_out`은 그 마디에서 나가는 선의 `lines` 합과, `len(in) + hidden_in + more_in`은 들어오는 선의 합과 같다. 줄 규칙(참조 판정·이동·번호 풀기·번호 꼴·자기 참조·남끼리의 제안 빼기)은 1·2걸음의 함수를 다시 쓴다 — 둘째 구현을 만들지 않는다.
- 지도를 여는 조건은 1·2걸음과 같다: 첫 의존성 `require_bundle_role(*MEMBER_ROLES)`(403 `inactive_account` → 404 `bundle_not_found`). 읽기만 한다 — 아무것도 쓰지 않고 잠그지 않는다. `source_blocks`·`document_files`를 읽지 않는다. 로그에는 건수와 시간만(번호·글 없음). 질의 수는 Bundle 수와 무관하다.
- **Open in Assign 은 응답에 실린 줄에만 있다**(그 줄이 든 Bundle의 구성원이라는 뜻이다). 가려진 줄에는 단추도 주소도 없다.
- **Assign 화면은 주소 값 둘을 읽는 것만 더한다.** 지금의 `?edit=`, 클릭·단축키·끌기, 고르기(`selectRow`)·문서 열기(`setManualOldDoc`·`openSolo`)의 동작은 바뀌지 않는다. `components/assign/`은 고치지 않는다. 이 계획을 쓴 때 Assign 화면 파일은 다른 작업(끌어다 놓기 4걸음)이 고치고 있었다 — **줄 번호가 아니라 이름으로 찾고**(`openEditParam`·`rowOfUnit`·`selectRow`·`scrollToUnit`·`setManualOldDoc`·`viewList`), 그 작업이 합쳐진 `dev`에서 시작한다.
- 화면 규칙은 순수 모델에 두고 단위 시험한다. 새 문구는 en·ko 한 쌍(설계 §8의 글자 그대로). 사용 설명서 글은 화면을 바꾸는 커밋에서 함께 고친다(라벨은 영어 그대로 **굵게**, 그림은 뽑지 않는다). 색은 토큰만. 아이콘만 있는 단추는 툴팁(포커스로도). `crypto`·Clipboard를 쓰지 않는다.
- **기존 시험(pytest·vitest·스모크·감사)의 기대값을 고치지 않는다.** 허락하는 것은 줄을 **더하는** 것뿐이다(`stages.test.ts`, `test_sop_map.py`는 그대로 두고 새 파일 `test_sop_map_lines.py`).
- 합성 자료만 쓴다. 공개 저장소다 — 추적 파일에 사용자 경로·실서버 IP·사내 호스트명·시크릿·실제 SOP 글을 쓰지 않는다.
- 작업 폴더는 이 작업의 워크트리(`<worktree>`), 브랜치 `feat/reference-map-lines`(1·2걸음과 끌어다 놓기 4걸음이 합쳐진 `dev`에서 딴다 — `frontend/src/app/bundles/[id]/map/page.tsx`가 있는지 먼저 본다). 버전은 가정하지 않는다 — 마지막 태스크가 지금 값을 읽어 다음 PATCH로 올린다. 푸시·태그는 하지 않는다. 커밋 메시지: `type(scope): English summary — 한국어 요약`. 커밋 전 `PROGRESS.md` 갱신.

```bash
# 워크트리 backend/ 에서
PY=<original-checkout>/backend/.venv/bin/python
$PY -m pytest tests/test_sop_map_lines.py tests/test_sop_map.py -q
$PY -m pytest tests/ -q -n auto && $PY -m ruff check app/ tests/ scripts/
DATABASE_URL=sqlite+aiosqlite:///./map-smoke.db AUTH_MODE=dev $PY -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./map-smoke.db AUTH_MODE=dev $PY -m scripts.seed_sop_demo   # 극단 자료는 이어서 seed_sop_worst
DATABASE_URL=sqlite+aiosqlite:///./map-smoke.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $PY -m uvicorn app.main:app --port 8787
# 워크트리 frontend/ 에서
BACKEND_URL=http://localhost:8787 npx next dev -p 3787
QUIET=1 ONLY="map:" BASE_URL=http://localhost:3787 BACKEND_PYTHON=$PY node scripts/pw-smoke-sop.mjs
npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run     # 커밋 전
```

## 가시성 행렬

**표 1 — 누가 받나.** V는 보는 Bundle, L은 어떤 줄이 든 Bundle이다.

| 보는 사람 | `GET /api/bundles/{V}/map/lines` | L의 줄은 |
|---|---|---|
| V의 작성자 · V의 검토자 | 200 — 둘의 본문이 글자까지 같다(다른 Bundle 구성이 같을 때) | L의 구성원이면 항목으로, 아니면 수로 |
| 다른 Bundle만의 구성원(V 구성원 아님) | 404 `bundle_not_found` | — |
| sysadmin · `bundle.admin` 보유 — V 구성원 아님 | 404 `bundle_not_found` | — |
| sysadmin · `bundle.admin` 보유 — V 구성원 · L 구성원 아님 | 200 | 수로만 |
| 퇴직자(V 구성원) | 403 `inactive_account` | — |
| 로그인 없음(keycloak 모드) | 401 | — |
| dev 모드에서 `X-Dev-User` 없음 | `DEV_USER`로 본다(구성원이 아니면 404) | — |

**표 2 — 필드마다, 그 줄이 든 Bundle과의 관계에 따라.**

| 필드 | L이 V 자신 | L의 구성원 | L의 구성원 아님 |
|---|---|---|---|
| `out[]`·`in[]`의 항목 — `bundle_id` · `document_id` · `unit_id` · `display_id` · `kind` · `state` · `number` · `source` · `target` · `text` · `text_truncated` | ○ | ○ | **✗ — 항목이 없다** |
| `hidden_out` · `hidden_in` | 더하지 않는다 | 더하지 않는다 | 줄 수만 더한다 |
| `more_out` · `more_in`(한쪽 200줄을 넘은 수) | 실을 수 있는 줄에서만 센다 | | — |
| `node` | 요청한 값 그대로(꼴 검사를 통과한 것) | | |
| 사유 · 보류 사유 · 새 문장 · 파일 이름 · 설명 · 구성원 · AI 제안 · EQUIS | **스키마에 없다(누구에게도)** | | |

칸마다의 시험은 Task 1에 있다(`test_lines_require_membership_and_an_active_account` · `test_member_lines_come_with_text` · `test_author_and_reviewer_get_the_same_lines` · `test_non_member_lines_are_counted_not_sent` · `test_admins_who_are_not_members_get_counts_only` · `test_no_sentence_of_a_non_member_bundle_for_any_node` · `test_lines_carry_only_the_listed_fields`).

## 이 계획이 정한 것(내 판단 — 설계에 없는 빈칸)

**서버**

1. **`scope`를 받는다**(`linked` 기본 · `all`, 설계 §7.2에는 없다). 범위 `linked`의 지도는 한쪽 끝이 보는 Bundle인 선만 그리므로, 남의 문서를 골랐을 때 그 문서가 다른 남을 가리키는 줄까지 주면 옆 칸의 줄 수(Cites n)와 목록이 어긋난다. 화면은 지금 지도의 범위를 그대로 보낸다.
2. **줄 항목의 모양을 하나로 맞춘다**: 설계의 예시는 `out`에 `target`, `in`에 `source`만 실었다 → 두 목록 모두 `source`와 `target`(둘 다 마디 id)을 싣는다. 화면 타입이 하나가 되고 선(`edges[]`)과 같은 이름이다. JSON 열쇠는 설계대로 `out`·`in`(파이썬 예약어라 모델 필드는 `incoming`, `serialization_alias="in"`).
3. **같은 번호가 여러 Bundle에 있어 한 줄이 마디 여럿으로 가면 항목도 그만큼이다**(줄 × 도착 마디). 지도의 선이 그렇게 세기 때문이다(1·2걸음 "어긋난 곳" 5). 옆 칸은 맞은편 마디별로 묶으므로 같은 문장이 서로 다른 묶음 아래에 한 번씩 보인다.
4. **이동한 한/영 짝 줄은 한 항목이다** — 그 줄의 원문 순서 첫 Unit의 글·표시 ID·`unit_id`(`MapLine.unit_id`가 이미 그 Unit이다). Assign은 그 Unit의 줄(짝 전체)을 고른다.
5. **순서**: `out`은 원문 순서(`pos_seq`·`pos_start`·Unit id) → 도착 마디 id. `in`은 (Bundle id, 문서 id, 원문 순서). 200줄 상한은 이 순서의 앞에서부터 채운다.
6. **`num:` 마디는 문서 번호 꼴(`refs.is_document_number`)이고 임시 번호가 아니며 어느 문서와도 맞지 않을 때만 줄을 가진다.** 그렇지 않으면 빈 응답이다 — 임의의 글을 `num:`에 넣어 "그 글을 번호로 표시한 줄이 몇 개인가"를 캐는 길을 닫는다(1·2걸음 판단 3과 같은 까닭). 지도가 그런 마디를 그리지 않으므로 줄 수 불변식과도 맞다.
7. **id가 DB 정수 범위(2,147,483,647)를 넘는 `old:`·`target:`** 은 질의하지 않고 빈 응답이다(Postgres에서 500이 되지 않게 — `membership.BundleIdPath`와 같은 까닭). 꼴(1~10자리 수)은 422 대상이 아니다.
8. **글 자르기**: `text[:300]`, 잘렸으면 `text_truncated: true`(`MAX_LINE_TEXT = 300`). 한쪽 `MAX_LINES_PER_SIDE = 200`. 둘 다 코드 상수.
9. **가려진 수를 세려고 남의 글을 서버 안에서 읽는 일이 있다**(설계 §7.2의 "DB에서 읽지도 않는다"와 어긋나는 한 곳): 구성원이 아닌 Bundle의 **확인 전 참조**는 글의 맨 앞 번호로만 알 수 있어, 그 줄 수를 세려면 1·2걸음의 요약이 이미 하듯 서버가 글을 읽어 번호만 꺼내야 한다. 이 계획은 그 길을 **수를 세는 함수 안에만** 두고(글을 반환값에 싣지 않는다), 응답 객체에 글을 넣는 길은 `bundle_members`를 조인한 `load_line_texts` 하나로 묶는다. 표식 시험이 모든 마디·보는 사람에 대해 지킨다.

**화면**

10. **문장은 옆 칸의 Cites · Cited by 줄 아래에 붙는다**: 1·2걸음의 줄(맞은편 번호 · 상태 알약 · `{n} lines`)마다, 그 맞은편 마디·상태의 줄 항목이 응답에 있으면 그 아래에 문장 줄들을 그린다(표시 ID · 글 두 줄까지 · 줄 끝 **Open in Assign**). 항목이 없는 줄(가려진 Bundle)은 지금처럼 수만 보인다. 목록 끝에 가려진 수가 있으면 "{n} lines hidden · summary only", 상한을 넘었으면 "{n} more lines".
11. **문장은 마디를 고를 때 받고, 고른 마디·범위·다시 읽기가 바뀌면 다시 받는다.** `useLoaded`는 다음 요청이 끝날 때까지 앞 자료를 남기므로, **응답의 `node`가 지금 고른 마디와 같고 읽는 중이 아닐 때만** 그린다(그 사이에는 쉬머) — 앞 문서의 문장이 새 문서 아래에 잠깐이라도 보이지 않게.
12. **문장을 읽지 못해도 지도와 요약은 그대로다**: 목록 자리에 `map.lines.error` 한 줄과 다시 시도. 403·404면 지도 전체를 다시 읽는다(접근을 잃은 것이다 — 1·2걸음 판단 29의 길을 탄다).
13. **줄 주소**(§11): `/bundles/{id}/assign?doc=<문서 id>&unit=<unit id>`, 상수 `ASSIGN_DOC_PARAM = "doc"`·`ASSIGN_UNIT_PARAM = "unit"`와 `getAssignLineHref`는 `lib/stages.ts`. `?edit=`이 같이 있으면 `edit`이 이긴다(지금 동작을 건드리지 않는다).
14. **Assign이 그 주소를 받으면**: 그 Unit이 든 줄을 고르고(`selectRow` — Old 문서가 그 줄의 문서로 바뀐다) 그 Unit으로 스크롤한다. 보기(한 단·양 단)는 바꾸지 않는다 — `?edit=`은 "그 문서를 넓게 본다"는 뜻이라 한 단으로 바꾸지만, 줄 주소는 줄을 가리킬 뿐이다. 표의 칸 문장이면 그 표·행의 줄을 고른다. 그 Unit이 없으면(쪼개기 편집으로 사라짐·다른 문서의 Unit·수가 아님) 문서만 열고 알림 `map.assign.gone`을 띄운다(지금 알림 자리, 기본 색). `doc`이 이 Bundle의 읽힌 Old 문서가 아니면 아무 일도 없이 주소만 뗀다(알림 없음). 어느 쪽이든 읽은 뒤 주소에서 값을 뗀다(`router.replace`, `openEditParam`과 같은 한 줄).
15. **문서의 Open in Assign(1·2걸음)은 그대로 `?edit=`이다.** 줄의 단추만 새 주소를 쓴다.

## 설계와 코드가 어긋난 곳 — 이렇게 정했다

1. **§7.2 "구성원이 아닌 Bundle의 글은 DB에서 읽지도 않는다"** 는 확인 전 참조의 수를 세는 데서는 지킬 수 없다(판단 9). 글이 응답으로 나가는 길만 SQL에서 막는다.
2. **§7.2에는 범위가 없다** → `scope`를 더한다(판단 1). 설계의 "지도에 그려지는 선의 줄만"을 지키는 값이다.
3. **§6.8 "Assign이 읽어 그 문서를 열고"** — 지금 `?edit=`은 한 단 보기로 바꾸지만 줄 주소는 바꾸지 않는다(판단 14).
4. **§9 "로그인 없음 → 401"** 은 keycloak 모드에서만이다(1·2걸음 "어긋난 곳" 3과 같다).

## Review Focus

1. **문장이 오기 전에 다른 문서를 고른다** — 늦게 온 앞 문서의 문장이 새 문서 아래에 보이면 안 된다(남의 문장이 아니어도 틀린 줄에서 Assign을 열게 된다).
2. **지도를 연 뒤 그 Bundle의 구성원에서 빠진 사람**이 그 Bundle의 문서를 고른다 — 서버는 그 요청 때의 구성으로 가르므로 문장 대신 수가 오고, 화면은 "가려짐" 한 줄을 보인다. 오류도, 앞서 받은 문장도 없다.
3. **주소 값이 엉뚱할 때**(`?doc=`이 다른 Bundle의 문서·New 문서·받지 못한 파일·글자, `?unit=`이 다른 문서의 Unit·글자·아주 큰 수, `?edit=`과 같이) — 예외 없이 문서만 열거나 아무 일도 없고, 주소에서 값이 떼인다.
4. **`num:` 마디의 번호나 손으로 고친 주소에 URL에서 뜻이 있는 글자(`/`·`&`·`#`·빈칸·한글)** 가 있다 — 화면은 값을 인코딩해 보내고, 서버는 꼴이 맞으면 200(번호 꼴이 아니면 빈 목록), 틀리면 422다. 500이 없다.
5. **한 번호를 가리키는 줄이 200개를 넘거나 한 줄이 1,800자** — "N개 더"와 잘린 글(툴팁에 300자까지)이 보이고, 옆 칸이 따로 스크롤하며, 줄 끝 단추에 Tab으로 닿는다.

---

### Task 1: 서버 — `GET …/map/lines`와 가시성 시험

**Files:**
- Modify: `backend/app/sop/ref_map.py` · `backend/app/routers/sop_map.py` · `backend/tests/sop_map_helpers.py`(도우미 `get_lines`) · `backend/CLAUDE.md`(1·2걸음이 더한 줄에 덧붙인다)
- Create: `backend/tests/test_sop_map_lines.py`

**Interfaces:**
- Consumes(1·2걸음): `MapLine`·`MapScope`·`collect_map_lines`와 그 안쪽 조각(나가는 줄 = 문서 조건, 들어오는 줄 = 번호 조건), 번호 풀기, `refs.is_document_number`, `tobe.is_temp_match_code`, `snapshot.select_latest_extractions`, `units.compute_display_id`, `tests.sop_map_helpers`의 `World`·`MARKERS`·`OPS`·`add_doc`·`move_out`·`edit`·상수.
- Produces:

```python
# ref_map.py
MAX_LINE_TEXT = 300        # 줄 글의 상한(자) — 넘으면 자르고 text_truncated
MAX_LINES_PER_SIDE = 200   # 한쪽(out·in)에 싣는 줄 수 — 넘는 수는 more_*
NODE_PATTERN = r"^(?:old:[0-9]{1,10}|target:[0-9]{1,10}|num:[^\x00]{1,100})$"

class MapLineOut(BaseModel):
    bundle_id: int
    document_id: int
    unit_id: int
    display_id: str
    kind: Literal["ref", "moved"]
    state: Literal["confirmed", "proposed"]
    number: str
    source: str            # 그 줄의 문서 마디
    target: str            # 그 줄이 가리키는 마디
    text: str
    text_truncated: bool
class MapLinesOut(BaseModel):
    node: str
    out: list[MapLineOut]
    incoming: list[MapLineOut] = Field(serialization_alias="in")
    hidden_out: int
    hidden_in: int
    more_out: int
    more_in: int

async def load_line_texts(session: AsyncSession, login_id: str, unit_ids: Collection[int]) -> dict[int, LineText]:
    """줄의 글·표시 ID — 요청한 사람이 그 문서의 Bundle 구성원인 Unit만 돌려준다(SQL에서 bundle_members 조인)."""
async def build_node_lines(session: AsyncSession, ctx: BundleContext, node: str, scope: MapScope) -> MapLinesOut: ...

# routers/sop_map.py
@router.get("/{bundle_id}/map/lines", response_model=MapLinesOut)
async def get_map_lines(node: str = Query(max_length=104, pattern=NODE_PATTERN), scope: MapScope = Query("linked"), ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)) -> MapLinesOut
```
`LineText`는 `ref_map.py` 안의 작은 자료형(`display_id: str`, `text: str`)이다. `tests/sop_map_helpers.py`에 `get_lines(client, bundle_id, node, headers=AUTHOR, scope="linked") -> dict`(200을 단언)을 더한다.

- [ ] **Step 1: 실패하는 시험을 쓴다** — `tests/test_sop_map_lines.py`(`pytestmark = pytest.mark.usefixtures("clean_sop")`, 시험마다 `World(client)`). 아래에서 `v`·`m`·`s`·`st`는 1·2걸음 시험과 같은 마디 id, `did(text)`는 그 문서 보기에서 그 글의 Unit `display_id`, `uid(text)`는 Unit id다.

  ```python
  def test_member_lines_come_with_text(client):
      w = World(client)
      body = get_lines(client, w.v_id, v)
      line = lambda text, kind, state, number, target: {
          "bundle_id": w.v_id, "document_id": w.v_doc["id"], "unit_id": uid(text), "display_id": did(text), "kind": kind, "state": state,
          "number": number, "source": v, "target": target, "text": text, "text_truncated": False}
      assert body == {
          "node": v,
          "out": [
              line(REF_UV, "ref", "proposed", "SOP-ABC-1016", m),
              line(REF_DC, "ref", "confirmed", "SOP-ABC-1020", s),
              line(REF_NONE, "ref", "proposed", "SOP-ZZ-404", "num:SOP-ZZ-404"),
              line(MOVED_OK, "moved", "confirmed", "SOP-QC-99999", st),
          ],
          "in": [{"bundle_id": w.m_id, "document_id": w.m_doc["id"], "unit_id": <M_REF의 unit id>, "display_id": <M_REF의 display_id>, "kind": "ref", "state": "proposed",
                  "number": "OLD-1", "source": m, "target": v, "text": M_REF, "text_truncated": False}],
          "hidden_out": 0, "hidden_in": 2, "more_out": 0, "more_in": 0,
      }
  ```
  이 시험이 박는 것: 자기 참조(`REF_SELF`)·번호 꼴 아닌 이동(`MOVED_FREE`)·참조가 아닌 줄(`PLAIN`)은 항목이 아니다 · 이동 줄에 사유가 없다 · S의 두 줄은 수로만 온다.

  나머지(이름과 단언):
  - `test_lines_require_membership_and_an_active_account(client, enforce, demo_access, clean_directory, monkeypatch)` — 1·2걸음의 같은 이름 시험과 같은 차례를 `…/map/lines?node=<v>`로: prod.member → 404 `bundle_not_found`, `app_sysadmins`의 dev.admin → 404, `bundle.admin`을 받은 dev.admin → 404, 헤더 없음(dev) → 404, 없는 묶음 → 404, 퇴직한 qa.lead → 403 `inactive_account`, keycloak 모드 헤더 없음 → 401.
  - `test_author_and_reviewer_get_the_same_lines(client)` — `v`·`m`·`s`·`st`·`num:SOP-ZZ-404` × 범위 둘에서 `AUTHOR`와 `REVIEWER`의 `response.text`가 같다.
  - `test_non_member_lines_are_counted_not_sent(client)` — qa.member로 `s`: `out == []`, `hidden_out == 2`(S의 확인한 참조와 이동, 둘 다 V의 `OLD-1`로), `in`은 V의 `REF_DC` 한 항목(`source == v`, `target == s`), `hidden_in == 0`. `st`: `out == []`, `in`은 V의 `MOVED_OK` 한 항목. prod.member로 S의 지도에서 `s`: `out`이 `S_REF`(글에 `"ZZ-REF-TEXT"`가 있다 — 자기 Bundle의 문장이다)와 `S_MOVED` 두 항목이고 어느 항목에도 `"ZZ-REASON"`이 없으며, `in == []`, `hidden_in == 1`(V의 `REF_DC`).
  - `test_admins_who_are_not_members_get_counts_only(client, enforce, demo_access, monkeypatch)` — ops.member(V만의 구성원)를 그대로 / `bundle.admin`을 준 뒤 / `app_sysadmins`에 넣은 뒤 세 번 모두: `v`의 `in == []`·`hidden_in == 3`(M 1 + S 2), `m`의 `out == []`·`hidden_out == 1`.
  - `test_no_sentence_of_a_non_member_bundle_for_any_node(client, enforce, demo_access, monkeypatch)` — 보는 사람 넷(qa.member · qa.lead · `bundle.admin`을 받은 ops.member · `app_sysadmins`의 ops.member) × 범위 둘 × 마디(그 사람의 `scope=all` 지도의 모든 마디 + `old:<S의 문서 id>` + `target:<S의 New 문서 id>` + `num:OLD-1` + `num:ZZ-REF-TEXT`)의 `response.text`에 `MARKERS`의 어느 글자도 없다. 그리고 모든 항목의 `bundle_id`가 그 사람이 구성원인 Bundle의 id 집합 안에 있다.
  - `test_lines_carry_only_the_listed_fields(client)` — 응답을 재귀로 훑은 키 집합이 정확히 `{"node", "out", "in", "hidden_out", "hidden_in", "more_out", "more_in", "bundle_id", "document_id", "unit_id", "display_id", "kind", "state", "number", "source", "target", "text", "text_truncated"}`.
  - `test_line_counts_match_the_map(client)` — `World`에 1·2걸음 Task 2의 넷째 Bundle P(남끼리의 확정 선과 제안)를 더하고, qa.member·ops.member·prod.member(자기 Bundle S에서) × 범위 둘: 그 지도의 모든 마디에 대해 `len(out) + hidden_out + more_out == Σ(source가 그 마디인 선의 lines)`, `len(in) + hidden_in + more_in == Σ(target이 그 마디인 선의 lines)`.
  - `test_load_line_texts_filters_by_membership_in_sql(client)` — `run_in_session`으로 `load_line_texts(session, "qa.member", [<S_REF의 unit id>, <REF_UV의 unit id>])`의 열쇠가 `{<REF_UV의 unit id>}`뿐이다. `"prod.member"`로는 `{<S_REF의 unit id>}`뿐. `_count_queries`로 잡은 그 호출의 SQL 글에 `bundle_members`가 들어 있다.
  - `test_unknown_nodes_answer_200_with_nothing(client)` — `EMPTY = {"out": [], "in": [], "hidden_out": 0, "hidden_in": 0, "more_out": 0, "more_in": 0}`. `old:999999`, `old:9999999999`(정수 범위 밖), `target:999999`, `num:SOP-NOBODY-1`(아무도 가리키지 않는다), `num:OLD-1`(문서가 있는 번호), `num:ZZ-REF-TEXT`·`num:SPIN THE SAMPLES AT 3000 RPM`(번호 꼴 아님 — 뒤의 것은 `add_doc`·`set_ref`로 그 글을 번호로 표시해 둔 뒤), `num:NEW-12`, 그리고 실제 종류 Bundle R의 문서 마디(`old:<R의 문서 id>`)를 V에서 물으면 모두 200이고 `node`를 뺀 나머지가 `EMPTY`다. 거꾸로 R에서 V의 문서 마디를 물어도 같다.
  - `test_malformed_node_is_422(client)` — `""`(없는 것 포함), `"old:"`, `"old:abc"`, `"old:-1"`, `"old:12345678901"`, `"target:1.5"`, `"num:"`, `"num:" + "A" * 101`, `"x:1"`, `"old:1 "`, `"num:A\x00B"` → 모두 422. `?scope=everything` → 422.
  - `test_odd_characters_in_a_num_node_do_not_break(client)` — `client.get(…, params={"node": "num:SOP/1&2#3 가"})` → 200, 빈 목록(Review Focus 4).
  - `test_text_is_cut_at_300_chars(client)` — V에 `add_doc(…, "SYNTHETIC_OLD-7_Long.docx", "SOP-ABC-1016 " + "long " * 360)` → 그 줄 항목의 `len(text) == 300`, `text_truncated is True`.
  - `test_lines_are_capped_per_side(client, monkeypatch)` — `monkeypatch.setattr(ref_map, "MAX_LINES_PER_SIDE", 2)` → `v`의 `len(out) == 2`(원문 순서 앞의 둘), `more_out == 2`, 그리고 줄 수 불변식이 그대로다.
  - `test_moved_pair_is_one_line(client)` — V에 한/영 짝(`add_doc(…, "SYNTHETIC_OLD-7_Pair.docx", "원심분리기 덮개를 닫는다.", "Close the lid of the centrifuge.")`)을 한 번에 `move_out(…, code="SOP-QC-99999")` → 그 문서 마디의 `out`이 한 항목이고 `unit_id`가 한국어 Unit(원문 순서 첫째)의 것이다.
  - `test_linked_scope_leaves_out_lines_between_two_other_bundles(client)` — P를 더한 자료에서 qa.member의 `s`(범위 `linked`)의 `hidden_in`은 0, 범위 `all`은 1(P의 확정 참조).
  - `test_reading_lines_writes_nothing(client)` — 1·2걸음의 같은 시험과 같은 값을 이 엔드포인트로.
  - `test_line_query_count_does_not_grow_with_bundles(client)` — `run_in_session`으로 `build_node_lines`를 직접 불러 `v`에 대해 낸 질의 수가 Bundle 3개와 12개에서 같고 `MAX_LINE_STATEMENTS = 20` 이하다.

- [ ] **Step 2: 실패를 확인한다** — `$PY -m pytest tests/test_sop_map_lines.py -q` → 404(라우트 없음)·import 오류로 FAIL.

- [ ] **Step 3: `build_node_lines`와 라우터를 만든다.** 규칙:
  1. **마디 읽기**: `old:<id>` → 같은 종류(`is_synthetic`)의 Bundle에 있는 읽힌 Old 문서, `target:<id>` → 같은 종류의 New 문서(임시 번호 아님), `num:<N>` → `N == normalize_number(N)`이고 `is_document_number(N)`이며 임시 번호가 아니고 어느 문서·New 문서와도 맞지 않는 번호. 아니면 빈 응답(판단 6·7).
  2. **줄 모으기** — 1·2걸음의 조각을 그대로 부른다. 그 조각이 보는 Bundle의 문서·번호에 묶여 짜여 있으면 **문서 조건·번호 조건을 인자로 받게 먼저 가른다**(동작 불변 — `test_sop_map.py`가 그대로 통과해야 한다). 나가는 줄: 마디가 `old`일 때 그 문서의 줄(참조는 `read_ref_state`, 이동은 확정). 들어오는 줄: 같은 종류의 모든 Bundle에서 그 마디의 번호를 가리키는 줄(표시가 있는 참조 · 글에 번호가 든 줄을 `read_ref_state`로 다시 본 것 · 확정 이동).
  3. **지도와 같은 거르기**: 번호 풀기의 차례(`ref`는 Old → New → `num`, `moved`는 New → Old → `num`)로 그 줄이 **이 마디로 오는지**(들어오는 줄), 어느 마디들로 가는지(나가는 줄 — 줄 × 도착 마디) 정한다. 자기 참조는 버린다. `proposed`는 한쪽 끝이 보는 Bundle일 때만 남긴다. 범위 `linked`면 한쪽 끝(줄의 Bundle이나 도착 마디의 Bundle)이 보는 Bundle인 것만 남긴다.
  4. **가르기**: 요청한 사람의 `bundle_members`로 줄을 둘로 나눈다. 구성원이 아닌 Bundle의 줄은 `hidden_*`에 수만 더한다. 구성원인 Bundle의 줄은 판단 5의 순서로 세워 앞 200개의 Unit id를 `load_line_texts`에 넘기고, **돌려받지 못한 Unit의 줄은 `hidden_*`으로 옮긴다**. 200을 넘는 수는 `more_*`.
  5. **`load_line_texts`**: `select(Unit.id, Unit.local_no, Unit.text, Document.id, Document.doc_code)`에 `Extraction`·`Document`와 `BundleMember`(`BundleMember.bundle_id == Document.bundle_id`, `BundleMember.login_id == login_id`)를 **안쪽 조인**하고 `Unit.id.in_(…)`(`select_in_chunks`). `display_id`는 `units.compute_display_id`와 같은 꼴이다(그 함수가 받는 것이 ORM 객체라 맞지 않으면 그 함수 옆에 값 둘을 받는 순수 함수를 꺼내 둘이 같이 쓴다 — 꼴을 두 번 쓰지 않는다).
  6. 로그: `logger.info("reference map lines built", extra={"shown": n, "hidden": n, "elapsed_ms": n})`.

- [ ] **Step 4: 통과를 확인한다** — `$PY -m pytest tests/test_sop_map_lines.py tests/test_sop_map.py -q` PASS, `$PY -m pytest tests/ -q -n auto` PASS, ruff 깨끗.

- [ ] **Step 5: `backend/CLAUDE.md`** — 1·2걸음이 더한 `ref_map.py` 줄 끝에 "문장은 `…/map/lines`(`build_node_lines`) — 글을 싣는 질의는 `load_line_texts` 하나이고 `bundle_members`를 SQL에서 조인한다. 구성원이 아닌 Bundle의 줄은 항목 없이 수만(`hidden_*`), 줄 수는 지도의 선과 늘 같다"를 덧붙인다.

- [ ] **Step 6: 커밋** — `feat(map): lines of a document for members only, counts for everyone else — 문서의 줄은 구성원에게만, 그 밖에는 수만`

---

### Task 2: 화면 — 옆 칸의 문장 목록

**Files:**
- Create: `frontend/src/lib/map-lines-model.ts` · `map-lines-model.test.ts` · `frontend/src/components/map/map-lines.tsx`
- Modify: `frontend/src/lib/api-sop.ts` · `frontend/src/lib/stages.ts`(`getAssignLineHref`와 상수 둘) · `frontend/src/lib/stages.test.ts`(줄을 더한다) · `frontend/src/components/map/map-side.tsx` · `frontend/src/app/bundles/[id]/map/page.tsx` · `frontend/src/styles/map.css` · `frontend/src/lib/i18n-messages.ts` · `frontend/public/manual/user-manual.md` · `frontend/scripts/pw-smoke-sop.mjs`

**Interfaces:**
- Consumes: Task 1의 응답, 1·2걸음의 `NodeDetail`·`NodeLink`·`EdgeLabel`·`getEdgeLabel`·`MapScope`(`map-model`·`api-sop`), `useLoaded`, `LoadError`, `Tooltip`, `isBundleUnavailable`.
- Produces:

```ts
// stages.ts
export const ASSIGN_DOC_PARAM = "doc";
export const ASSIGN_UNIT_PARAM = "unit";
/** 그 Bundle의 Assign을 그 줄(Unit이 든 줄)을 고른 채 여는 주소 - Assign이 읽은 뒤 주소에서 뗀다 */
export function getAssignLineHref(bundleId: number, docId: number, unitId: number): string;   // `/bundles/4/assign?doc=101&unit=5012`

// api-sop.ts
export interface MapLine { bundle_id: number; document_id: number; unit_id: number; display_id: string; kind: "ref" | "moved"; state: "confirmed" | "proposed"; number: string; source: string; target: string; text: string; text_truncated: boolean }
export interface MapLines { node: string; out: MapLine[]; in: MapLine[]; hidden_out: number; hidden_in: number; more_out: number; more_in: number }
export function getMapLines(bundleId: number, node: string, scope: MapScope): Promise<MapLines>;   // GET `/bundles/${bundleId}/map/lines?${new URLSearchParams({ node, scope })}`

// map-lines-model.ts
export type LineSide = "out" | "in";
export interface LinkLines { link: NodeLink; lines: MapLine[] }
export interface SideLines { rows: LinkLines[]; hidden: number; more: number }
/** 옆 칸의 줄(맞은편 마디 · 상태)마다 그 줄의 문장을 붙인다 - 문장이 없는 줄은 lines가 비어 수만 보인다 */
export function attachLines(links: readonly NodeLink[], lines: MapLines | null, side: LineSide): SideLines;
export function getLineHref(line: MapLine): string;   // getAssignLineHref(line.bundle_id, line.document_id, line.unit_id)
/** 지금 고른 마디의 응답일 때만 쓴다 - 앞 마디의 문장이 남아 보이지 않게 */
export function pickCurrentLines(lines: MapLines | null, selectedId: string | null, isLoading: boolean): MapLines | null;

// components/map — MapSide가 받는 것이 하나 는다(1·2걸음의 나머지 prop은 그대로)
export interface SideLinesState { data: MapLines | null; isLoading: boolean; error: unknown; onRetry(): void }
export function MapSide(props: { data: RefMap; selectedId: string | null; lines: SideLinesState; onPick(nodeId: string): void; onClear(): void }): JSX.Element;
export function MapLineList(props: { side: LineSide; rows: SideLines; state: SideLinesState; renderLink(link: NodeLink): ReactNode }): JSX.Element;   // map-lines.tsx
```
`attachLines`: 맞은편 마디는 `out`이면 `line.target`, `in`이면 `line.source`. `link.nodeId`가 그 마디이고 `link.label === getEdgeLabel(line)`인 줄을 응답 순서 그대로 붙인다. `hidden`·`more`는 그쪽의 `hidden_*`·`more_*`(`lines`가 `null`이면 0).

- `data-testid`: 목록 `map-lines-out` · `map-lines-in`(1·2걸음의 `map-side-cites`·`map-side-cited-by` 안), 문장 줄 `map-line-<unit id>-<맞은편 마디 id>`, 줄의 단추 `map-line-open-<unit id>-<맞은편 마디 id>`, 가려짐 `map-lines-hidden-out` · `map-lines-hidden-in`, 더 있음 `map-lines-more-out` · `map-lines-more-in`, 읽는 중 `map-lines-loading`, 오류 `map-lines-error` · `map-lines-retry`.
- 문구(en · ko, 설계 §8 그대로): `map.side.hidden` "{n} lines hidden · summary only" · "줄 {n}개 가려짐 · 요약만", `map.side.moreLines` "{n} more lines" · "줄 {n}개 더", `map.lines.error` "Could not read the lines." · "줄을 읽지 못했습니다.", `map.assign.gone` "That line has changed. The document is open instead." · "그 줄이 바뀌었습니다. 문서를 열었습니다."(Task 3이 쓴다 — 같은 커밋에 넣어 둔다).

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `stages.test.ts`에 더한다: "builds the address that opens Assign on one line" — `getAssignLineHref(4, 101, 5012)` → `"/bundles/4/assign?doc=101&unit=5012"`.
  - `map-lines-model.test.ts` — `LINKS = [{ nodeId: "old:140", number: "SOP-ABC-1016", label: "confirmed", lines: 2 }, { nodeId: "old:140", number: "SOP-ABC-1016", label: "proposed", lines: 1 }, { nodeId: "target:77", number: "SOP-LOG", label: "moved", lines: 2 }]`, `LINES`의 `out`은 `old:140`으로 가는 확인한 참조 둘(Unit 11·12)과 제안 하나(Unit 13), `hidden_out: 2`, `more_out: 0`.
    - "attaches each sentence under its counterpart and state, in the response order" — `attachLines(LINKS, LINES, "out").rows.map((r) => r.lines.map((l) => l.unit_id))` → `[[11, 12], [13], []]`, `hidden === 2`, `more === 0`.
    - "uses the source as the counterpart for incoming lines" — `in` 쪽 자료로 같은 모양.
    - "shows counts only until the lines arrive" — `attachLines(LINKS, null, "out")` → 모든 `lines`가 `[]`, `hidden === 0`.
    - "ignores a line that matches no row" — 맞은편이 `old:999`인 줄은 어디에도 붙지 않고 예외가 없다.
    - "uses lines only for the document that is picked now" — `pickCurrentLines({ ...LINES, node: "old:101" }, "old:101", false)` → 그 객체, `(…, "old:102", false)` → `null`, `(…, "old:101", true)` → `null`, `(null, "old:101", false)` → `null`(Review Focus 1).
    - "links a line to its row in Assign" — `getLineHref({ bundle_id: 15, document_id: 140, unit_id: 7301, … })` → `"/bundles/15/assign?doc=140&unit=7301"`.
  - 스모크 — 파일 끝에. 지도는 qa.member의 `분류 절반`(1·2걸음의 `openMap` 도우미).
    1. **`map: a member bundle's lines show their sentences`** — `OLD-1` 마디를 고르면 `…/map/lines?node=old%3A…&scope=linked` 요청이 나가고, `map-lines-out`에 글 "SOP-ABC-1016 Operation of UV spectrophotometer"와 그 표시 ID가 든 줄이 있다. `map-lines-in`에 5번(구성원)의 줄 "OLD-1 Operation of the QC centrifuge"가 있고, 6번(구성원 아님)에서 온 줄은 문장 없이 수만 보이며 `map-lines-hidden-in`의 글이 응답의 `hidden_in`으로 만든 "… lines hidden · summary only"다. 문장 줄에 올리면 툴팁에 글 전체가 뜬다. `map-scope-all`로 바꾸면 요청이 `scope=all`로 다시 나간다.
    2. **`map: a non-member gets counts, not sentences — on screen and in the response`**(`devUser: "prod.member"`, `문서 관리`) — 두 마디를 차례로 고른다(어느 마디인지는 그 사람의 `…/map` 응답에서 찾는다 — 데모 단계마다 저장된 답이 달라 번호를 박지 않는다). ⓐ To가 `OLD-1`인 줄의 맞은편(남의 Bundle의 OLD-1): 잡은 `…/map/lines` 응답의 `out`이 빈 배열이고, `in`의 항목이 1개 이상이며 모두 `bundle_id`가 6번이다(자기 Bundle의 줄 "OLD-1 Operation of the QC centrifuge"). 화면에는 그 문장과 `map-line-open-…`이 있고 `map-side-not-member` 줄이 그대로 있다. ⓑ `kind`가 `moved`이고 도착이 6번의 `target:` 마디인 선의 출발 마디(남의 Bundle의 Old 문서): 응답의 `out`이 빈 배열이고 `hidden_out`이 1 이상이며, 화면에 `map-lines-hidden-out`이 보이고 `map-lines-out` 안에 `map-line-open-…`이 없다. 두 응답 모두 글에 `"Operation of UV"`(남의 Bundle 1~4의 참조 줄)와 `"Rotor cleaning"`(5번의 줄)이 없다.
    3. **`map: picking another document before the lines arrive never shows the first one's lines`** — `page.route("**/map/lines*", …)`로 첫 요청만 1.5초 늦춘다. `OLD-1`을 고르고 곧바로 `OLD-2`를 고른다 → 2초 뒤 `map-lines-out`·`map-lines-in`의 모든 문장 줄이 `OLD-2`의 응답에 있는 Unit이다(`OLD-1`의 "Operation of UV spectrophotometer" 글이 화면에 없다).
    4. **`map: when the lines cannot be read the map stays`** — `…/map/lines`를 500으로 바꿔 답하게 하고 마디를 고르면 `map-lines-error`("Could not read the lines.")와 `map-lines-retry`가 보이고 `map-side-number`·`map-side-becomes`·지도는 그대로다. 가로채기를 풀고 다시 시도를 누르면 문장이 뜬다(`allowConsoleErrors: true`).

- [ ] **Step 2: 실패를 확인한다** — vitest 새 줄 FAIL, 스모크 네 단계 FAIL.

- [ ] **Step 3: 만든다.**
  - `api-sop.ts`·`stages.ts`·`map-lines-model.ts`.
  - `page.tsx`: `const lines = useLoaded(() => (selectedId ? getMapLines(bundleId, selectedId, scope) : Promise.resolve(null)), \`${bundleId}:${scope}:${selectedId ?? ""}\`)`. 지도를 다시 읽을 때(`map-refresh`) `lines.reload()`도 부른다. 그리는 값은 `pickCurrentLines(lines.data, selectedId, lines.isLoading)`. `lines.error`가 `isBundleUnavailable`이면 지도를 다시 읽는다(판단 12). `MapSide`에 `lines={{ data, isLoading: selectedId !== null && lines.isLoading, error: lines.error, onRetry: lines.reload }}`를 넘긴다.
  - `map-side.tsx`: Cites · Cited by 목록을 `attachLines(detail.cites, lines.data, "out")`·`attachLines(detail.citedBy, lines.data, "in")`로 얻어 `MapLineList`에 넘긴다. 줄(맞은편 번호 · 알약 · `{n} lines` — `renderLink`)은 1·2걸음 그대로이고 testid도 그대로다.
  - `map-lines.tsx`(`MapLineList`): 줄마다 `renderLink(link)` 아래에 그 줄의 문장들. 문장 줄 — 표시 ID(`font-mono`, `--ink-3`) · 글(감싼 `div.clamp-2`, `data-tip`으로 받은 글 전체, `text_truncated`면 끝에 "…") · 줄 끝 `<Link href={getLineHref(line)}>` 아이콘 단추(lucide `ArrowUpRight`, `Tooltip`과 `aria-label`이 `map.side.openAssign`). 줄 끝 단추는 제자리에 흐리게 있다가 줄 호버·포커스에 진해진다(`.row-actions` — 숨기지 않는다, `ui-review.md` 13번). 읽는 중이면 목록마다 `.sk` 줄 둘(`map-lines-loading`). 오류면 목록 자리에 `LoadError compact`(문구 `map.lines.error`). `hidden > 0`이면 목록 끝에 자물쇠 아이콘과 `map.side.hidden`, `more > 0`이면 `map.side.moreLines`.
- [ ] **Step 4: 설명서** — `#map`의 옆 칸 문단에 더한다: "문서를 고르면 **Cites** 와 **Cited by** 아래에 그 줄의 문장이 보입니다. 내가 구성원인 Bundle의 줄만 문장이 보이고, 그 밖의 줄은 수만 보입니다(목록 끝의 "줄 N개 가려짐 · 요약만"). 문장 끝의 **Open in Assign** 을 누르면 그 Bundle의 Assign이 그 줄을 고른 채 열립니다." `#map-visibility`의 "문장을 보려면 그 Bundle의 구성원이어야 합니다" 뒤에 "관리자 권한이 있어도 구성원이 아니면 같습니다." 한 줄.
- [ ] **Step 5: 통과를 확인한다** — `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, 갓 시드한 DB에서 `QUIET=1 ONLY="map:"` 전부 PASS(1·2걸음의 단계 포함). en·ko, 라이트·다크로 직접 본다.
- [ ] **Step 6: 커밋** — `feat(map): show a document's lines in the side panel, sentences only where the viewer is a member — 옆 칸에 문서의 줄, 문장은 구성원인 Bundle 것만`

---

### Task 3: Assign — `?doc=&unit=`으로 줄 하나를 열기

**Files:**
- Create: `frontend/src/lib/assign-line-param.ts` · `assign-line-param.test.ts`
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx`(`openEditParam` 바로 아래에 줄 주소 읽기 — 그 밖은 건드리지 않는다) · `frontend/public/manual/user-manual.md` · `frontend/scripts/pw-smoke-sop.mjs`

**Interfaces:**
- Consumes: `ASSIGN_DOC_PARAM`·`ASSIGN_UNIT_PARAM`·`EDIT_ORIGINAL_PARAM`·`getStageHref`(`stages`), Assign 화면의 `docs`·`oldDocs`·`viewList`·`units`·`rowOfUnit`·`selectRow`·`scrollToUnit`·`setSolo`·`setManualOldDoc`·`setSelectedKey`·`router`, `showToast`(`ui/toast`), `map.assign.gone`(Task 2).
- Produces:

```ts
// assign-line-param.ts
export type LineTarget =
  | { kind: "row"; rowKey: string; unitId: number }
  | { kind: "document"; docId: number; isGone: boolean }   // isGone = unit 값이 있었는데 그 문서에서 줄을 찾지 못했다
  | { kind: "none" };
export interface LineParamInput {
  doc: string | null;
  unit: string | null;
  /** 이 Bundle의 읽힌 Old 문서 id */
  oldDocIds: readonly number[];
  /** Unit id → 그 Unit이 든 문서 id(원문 보기에 있는 활성 Unit만) */
  docOfUnit: (unitId: number) => number | undefined;
  /** Unit(칸 문장이면 묶인 표·행)의 줄 열쇠 */
  findRowKey: (unitId: number) => string | undefined;
}
export function resolveLineParam(input: LineParamInput): LineTarget;
```
규칙: `doc`이 `/^\d{1,10}$/`가 아니거나 `oldDocIds`에 없으면 `none`. `unit`이 `null`이면 `{ kind: "document", docId, isGone: false }`. `unit`이 수가 아니거나, `docOfUnit(unit) !== docId`이거나, `findRowKey(unit)`가 없으면 `{ kind: "document", docId, isGone: true }`. 아니면 `row`.

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `assign-line-param.test.ts` — `oldDocIds = [101, 102]`, Unit 5012는 문서 101의 줄 `"u5012"`, Unit 5013은 문서 101의 칸 문장이고 `findRowKey`가 표의 줄 `"u5000"`을 준다, Unit 6001은 문서 102의 줄.
    - "opens the row that holds the unit" — `{ doc: "101", unit: "5012" }` → `{ kind: "row", rowKey: "u5012", unitId: 5012 }`.
    - "opens the table row for a cell sentence" — `unit: "5013"` → `rowKey: "u5000"`, `unitId: 5013`.
    - "opens only the document without a unit" — `{ doc: "101", unit: null }` → `{ kind: "document", docId: 101, isGone: false }`.
    - "says the line is gone when the unit is missing, belongs to another document or is not a number" — `unit`이 `"999"`·`"6001"`·`"abc"`·`"-1"`·`"99999999999999999999"` → 모두 `{ kind: "document", docId: 101, isGone: true }`.
    - "does nothing for a document that is not a ready Old document of this bundle" — `doc`이 `"999"`·`"abc"`·`""`·`"101 "`·`null`(unit만 있음) → `{ kind: "none" }`(Review Focus 3).
  - 스모크 — 파일 끝에.
    1. **`map: a line opens in Assign with that row picked`** — qa.member의 `분류 절반` 지도에서 `OLD-1`을 고르고 "SOP-ABC-1016 Operation of UV spectrophotometer" 줄의 `map-line-open-…`의 `href`가 `/bundles/<id>/assign?doc=<문서 id>&unit=<unit id>`임을 보고 누른다 → Assign이 뜨고(`assign-bar`) 주소가 `/assign`으로 끝나며(값이 떼였다), `assign-row-id`의 글이 그 줄의 표시 ID이고, Old 칸의 그 조각(`assign-paper-unit-<unit id>`)이 칸 안에 보인다. 보기(한 단·양 단)는 들어오기 전에 기억된 그대로다(`sopa.assign.single`을 미리 지운 양 단에서 `assign-new`가 여전히 보인다). 이어서 5번(구성원) 문서의 줄에서 누르면 5번의 Assign이 그 줄을 고른 채 뜬다. 검토자(`qa.lead`, `검토 대기`)로도 같은 주소가 그 줄을 고른다(읽기 전용이라 확정 단추는 꺼져 있다).
    2. **`map: an address for a line that is gone opens the document and says so`** — `/bundles/<분류 절반>/assign?doc=<OLD-2의 문서 id>&unit=2147483000`으로 들어간다 → 알림(`toast-ok`)이 "That line has changed. The document is open instead."이고, Old 칸이 OLD-2를 보이며, 주소에서 값이 떼였고, 고른 줄이 없다. `?doc=<5번 Bundle의 문서 id>&unit=1`(다른 Bundle의 문서)과 `?doc=abc&unit=x`는 알림 없이 평소의 Assign이고 값이 떼인다. `?edit=<OLD-3 id>&doc=<OLD-2 id>&unit=1`은 지금의 `edit` 동작(OLD-3을 한 단으로) 그대로다. 세 경우 모두 콘솔 오류가 없다.

- [ ] **Step 2: 실패를 확인한다.**

- [ ] **Step 3: `assign-line-param.ts`를 만들고 Assign에 잇는다.** `page.tsx`에서(이름으로 찾는다):
  - `useSearchParams()`를 한 번 불러 `edit`·`doc`·`unit` 셋을 읽는다(지금 `editParam`을 읽는 줄을 고친다 — 값은 같다).
  - `openEditParam` 아래에 `openLineParam = useEffectEvent((doc: string, unit: string | null) => { … })`: `resolveLineParam`에 `oldDocIds`, `docOfUnit`(`viewList`의 문서마다 `units`를 훑어 만든 Unit id → 문서 id), `findRowKey`(편집 뒤 따라가기 `follow`가 쓰는 것과 같은 식 — `rowOfUnit.get(id) ?? rowOfUnit.get(그 Unit의 group_unit_id)`, `viewList`에서 `group_unit_id`를 읽는다)를 넘긴다. 결과가 `row`면 `selectRow(rowKey)` 뒤 `scrollToUnit(unitId)`. `document`면 `setSolo(null)`·`setManualOldDoc(docId)`·`setSelectedKey(null)`(보기는 바꾸지 않는다)이고 `isGone`이면 `showToast(t("map.assign.gone"))`. 끝에 어느 경우든 `router.replace(getStageHref(bundleId, "assign"), { scroll: false })`.
  - 이펙트: `doc` 값이 있고 `edit` 값이 없으며 문서 목록·원문 보기·단위 목록을 모두 받았을 때(`docs.data !== null && viewList !== null && units.data !== null`) 한 번 부른다. 이펙트 안에서 동기로 상태를 바꾸지 않게 지금 `openEditParam`의 이펙트와 같은 모양을 따른다(`react-ts-patterns.md` §3·§7).
  - `edit`와 `doc`이 같이 오면 `openEditParam`만 돈다(그것이 주소를 통째로 뗀다).
- [ ] **Step 4: 설명서** — `#map`의 **Open in Assign** 문장 뒤에 "그 줄이 그사이 쪼개기 편집으로 바뀌었으면 문서만 열리고 "That line has changed. The document is open instead." 알림이 뜹니다."(알림 글은 굵게 쓰지 않는다 — 라벨이 아니다). `#assign-links`(이어진 곳 보기·이동) 끝에 "**Map** 의 줄에서 **Open in Assign** 으로 들어오면 그 줄이 골라진 채 열립니다." 한 줄.
- [ ] **Step 5: 통과를 확인한다** — lint·tsc·vitest. 갓 시드한 DB의 **전체 스모크**로 판정한다(Assign 화면 파일을 고쳤다 — 새 두 단계 PASS, 그 밖의 실패가 이 태스크 시작 전에 적어 둔 기준선보다 늘지 않음).
- [ ] **Step 6: 커밋** — `feat(assign): open one line from the reference map with ?doc=&unit= — 참조 지도의 줄을 Assign에서 그 줄을 고른 채 열기`

---

### Task 4: 극단 자료·좁은 창 검토와 올리기 준비

**Files:**
- Modify(필요할 때만): `frontend/src/components/map/map-lines.tsx` · `map-side.tsx` · `frontend/src/styles/map.css`
- Modify: `frontend/scripts/pw-layout-audit.mjs`(항목 둘) · `pw-overlap-audit.mjs`(장면 하나) · `pw-contrast-audit.mjs`(화면 하나) · `frontend/package.json`·`package-lock.json` · `CHANGELOG.md` · `PROGRESS.md` · `docs/README.md` · `frontend/CLAUDE.md` · `docs/superpowers/specs/2026-11-17-reference-map-design.md`

**Interfaces:**
- Consumes: Task 1~3, 1·2걸음의 극단 시드(`SYNTHETIC M1 map` … `M8`)와 감사의 `ids.m`.
- Produces: dev에 합칠 수 있는 브랜치(푸시·합치기는 조율하는 세션이 한다).

- [ ] **Step 1: 감사 항목을 더한다.** `pw-layout-audit.mjs`: `M8`(worst · 1120, 2560 · `/bundles/${ids.m[1]}/map`, `open`에서 `MAP-101` 마디를 고른다 — 문서 30개가 가리킨다) `map-side`가 가로로 넘치지 않고(`scrollWidth ≤ clientWidth + 1`) 문장 줄 높이의 최댓값이 64px 이하 → 둘 다 참. `M9`(worst · 1120 · 같은 주소, 1,800자 참조 줄이 든 문서를 고른다) 그 문장 줄이 두 줄에서 접히고(`≤ 64px`) 줄 끝 단추가 옆 칸 안에 있다. `pw-overlap-audit.mjs`: 장면 `map-lines`(qa.member, `/bundles/${BUNDLE}/map`에서 OLD-1을 고른 상태) — 문장 줄마다 표시 ID·글·줄 끝 단추의 상자가 겹치지 않는다(겹친 px 0, 호버한 상태에서도 — `auditHover`). `pw-contrast-audit.mjs`: 1·2걸음의 `map-selected` 화면이 이제 문장 줄을 포함한다 — 준비 단계에 문장이 뜰 때까지 기다림(`[data-testid^="map-line-"]`)을 더한다(구성원인 Bundle의 마디를 고른다).
- [ ] **Step 2: 극단 자료로 재고 고친다** — `reset_db → seed_sop_demo → seed_sop_worst`한 DB, 1120과 2560, en·ko, 라이트·다크. 겹치거나 넘치면 이 태스크에서 고친다.
  - **많은 줄**: `MAP-101`(Cited by 30개 문서)과 `MAP-102`(Cites 40개 번호)를 골랐을 때 옆 칸이 따로 스크롤하고 지도 칸을 누르지 않는다(1120에서 `map-canvas` 폭 ≥ 700). 문장이 뜨는 데 걸린 시간을 적는다.
  - **200줄 상한**(Review Focus 5): 극단 시드에는 한쪽 200줄을 넘는 마디가 없다 — 버려도 되는 DB에 한 번 쓰는 스니펫(커밋하지 않는다, 시드와 같은 `TestClient(app)`·`tests.sop_helpers.upload`)으로 M1에 `"MAP-201 Synthetic line"` 줄 220개짜리 문서를 올려 `MAP-201`을 고른다 → 응답의 `more_in == 20`이고 `map-lines-more-in`이 "20 more lines"이며 목록 끝까지 스크롤된다.
  - **긴 글**: 1,800자 참조 줄이 두 줄에서 접히고 툴팁이 300자와 "…"을 보이며 툴팁이 창 밖으로 나가지 않는다. 공백 없는 긴 번호(100자)가 줄을 밀지 않는다.
  - **가려진 줄**: M1에서 구성원이 아닌 Bundle(M6~M8)이 가리키는 문서를 고르면 그 줄들은 수만 보이고 목록 끝의 "가려짐" 줄이 한 줄에 든다(en·ko). 잡은 응답에 M6~M8의 `bundle_id`를 가진 항목이 없다.
  - **글쇠**: 옆 칸에서 Tab으로 맞은편 번호 줄 → 문장의 **Open in Assign** 차례로 닿고 포커스 테두리가 보이며 Enter로 열린다.
  - **Assign 쪽**: 극단 Bundle W1의 큰 문서(372 Unit)의 뒤쪽 줄을 줄 주소로 열어 그 조각이 칸 안에 보이는지, 움직임 줄이기에서는 바로 가는지 본다.
  - **시간**: `curl`로 `…/map/lines?node=<MAP-101의 마디>&scope=all`을 다섯 번 돌려 가운데 값을 적는다(목표 300ms — 고를 때마다 부르는 요청이다. 넘으면 어느 질의인지 로그의 시간으로 적어 조율 세션에 알리고, 스키마는 건드리지 않는다).
- [ ] **Step 3: 전체 검증.** backend: `$PY -m pytest tests/ -q -n auto`, `$PY -m ruff check app/ tests/ scripts/`. frontend: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, `npm run build` 경고 0. 갓 시드한 DB에서 전체 스모크(이 계획의 새 단계 여섯 PASS, 실패가 기준선보다 늘지 않음) → 다시 시드 → `pw-overlap-audit.mjs`, `DS=worst pw-layout-audit.mjs`, `pw-contrast-audit.mjs`. `git diff --stat dev -- frontend/src/components/assign`이 비어 있다.
- [ ] **Step 4: 버전과 기록.** `frontend/`에서 `node -p "require('./package.json').version"`으로 **지금 버전을 읽고** `npm version patch --no-git-tag-version`. `CHANGELOG.md` `## Unreleased (dev)` 아래 `### v<새 버전> — <이 커밋을 만드는 날>`: 지도 옆 칸의 문장(구성원인 Bundle의 줄만 — 그 밖은 수만, 관리자 권한이 있어도 같다), 줄의 **Open in Assign**, Assign의 줄 주소(`?doc=&unit=`)와 줄이 사라졌을 때의 알림, 서버 `GET /api/bundles/{id}/map/lines`, 잰 시간, 알려진 한계(한쪽 200줄까지 · 글은 300자까지 · 같은 번호가 여러 Bundle에 있으면 같은 문장이 묶음마다 보인다 · 이동의 사유는 Assign에서 읽는다). `PROGRESS.md`는 이 브랜치의 항목을 요약 하나로. 설계 문서: §10의 3걸음에 "(v<새 버전>으로 dev에 올렸다.)", §7.2에 "구현에서 정한 것 — `scope`를 받는다 · 항목은 `source`와 `target`을 모두 싣는다 · `num:`은 번호 꼴일 때만 · 가려진 수를 세는 길은 글을 응답에 싣지 않는다(계획 `2026-11-17-reference-map-lines-plan.md` 판단 1·2·6·9)", §6.8에 "줄 주소는 보기를 바꾸지 않는다". `docs/README.md`에 이 계획 한 줄을 더하고 설계 줄의 상태를 "1~3걸음 구현됨"으로. `frontend/CLAUDE.md`의 참조 지도 줄에 "문장은 `lib/map-lines-model.ts`(고른 마디의 응답일 때만 그린다), Assign의 줄 주소는 `lib/assign-line-param.ts`·`stages.getAssignLineHref`"를 덧붙인다.
- [ ] **Step 5: 커밋** — `chore(release): v<새 버전>, sentences on the reference map and Open in Assign for a line — 참조 지도의 문장과 줄에서 Assign 열기 (v<새 버전>)`

---

## Self-Review 기록

- **설계 대비**: §7.2(응답 모양·구성원인 Bundle의 줄만·`hidden_*`·300자·200줄·사유 제외·꼴 검사·없는 마디는 빈 200)는 Task 1 — 달리 정한 것은 판단 1·2·6·7·9와 "어긋난 곳" 1·2. §5의 "그 선의 문장"·"Assign으로 가기" 줄은 "가시성 행렬"과 Task 1의 시험, Task 2 스모크 2. §6.8(옆 칸의 줄 목록·"줄 N개 가려짐"·줄 끝의 **Open in Assign**·줄 주소·사라진 Unit의 알림)은 Task 2·3. §6.9 "문장을 읽지 못함"은 Task 2 스모크 4. §8의 네 문구는 Task 2. §9의 `lines` 시험 줄(없는 마디·다른 종류·300자·200줄과 `more_*`·`hidden_*`가 줄 수와 맞음·422)은 Task 1, 브라우저 2("문장 요청의 응답에 글이 없다")·5("그 줄을 연다")는 Task 2·3, 극단 자료의 1,800자 참조 줄은 Task 4. §10 "Assign 화면 파일을 고치는 것은 이 걸음뿐"은 Global Constraints와 Task 3. §11의 "Assign의 줄 주소 매개변수 이름과 알림 자리"는 판단 13·14.
- **Review Focus의 시험**: 1 → Task 2 `pickCurrentLines` 시험과 스모크 3. 2 → Task 1 `test_non_member_lines_are_counted_not_sent`·`test_admins_who_are_not_members_get_counts_only`(서버가 요청 때의 구성으로 가른다)와 Task 2 스모크 2의 화면. 3 → Task 3 `resolveLineParam`의 "does nothing…"·"says the line is gone…"과 스모크 2. 4 → Task 1 `test_odd_characters_in_a_num_node_do_not_break`·`test_malformed_node_is_422`와 Task 2의 `URLSearchParams`. 5 → Task 1 `test_text_is_cut_at_300_chars`·`test_lines_are_capped_per_side`와 Task 4 Step 2.
- **가시성 행렬의 칸**: 표 1의 줄마다 `test_lines_require_membership_and_an_active_account`(404·403·401), `test_author_and_reviewer_get_the_same_lines`, `test_admins_who_are_not_members_get_counts_only`. 표 2의 칸마다 `test_member_lines_come_with_text`(V 자신·구성원), `test_non_member_lines_are_counted_not_sent`(구성원 아님), `test_lines_carry_only_the_listed_fields`(스키마에 없는 것), `test_no_sentence_of_a_non_member_bundle_for_any_node`(글자로 본다), `test_load_line_texts_filters_by_membership_in_sql`(SQL에서 막는다).
- **하지 않는 것**: 이동 사유·새 문장을 지도에 보이기, 가려진 줄의 Bundle·문서를 따로 나열하기(지도의 선이 이미 말한다), 줄 목록 쪽 나누기(상한과 "N개 더"까지), 문서의 **Open in Assign** 주소 바꾸기, Assign에서 지도로 돌아가는 단추, New 문서의 참조 줄, 문장 찾기(지도의 찾기는 번호·제목뿐이다 — 문장을 찾게 하면 남의 문장을 캐는 길이 된다), 터치 전용 손길.
- **이름 맞춤**: `MapLineOut`의 `source`·`target` ↔ `MapLine`(`api-sop`) ↔ `attachLines`의 맞은편 읽기. JSON 열쇠 `in` ↔ `MapLines.in`. `getAssignLineHref`·`ASSIGN_DOC_PARAM`·`ASSIGN_UNIT_PARAM`은 Task 2가 만들고 Task 3이 읽는다. `map.assign.gone`은 Task 2가 문구를 넣고 Task 3이 쓴다. `data-testid`의 `map-line-<unit id>-<맞은편 마디 id>`는 Task 2가 정하고 Task 3 스모크·Task 4 감사가 쓴다. `NodeLink`·`describeNode`·`map-side-cites`·`map-side-cited-by`는 1·2걸음의 이름 그대로다.
