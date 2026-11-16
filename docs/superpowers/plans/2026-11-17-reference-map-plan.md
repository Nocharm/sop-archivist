# 참조 지도(Map) 1·2걸음 — 요약 API · Map 레일 · List · 지도 그리기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle 안의 새 화면 `/bundles/{id}/map`에서 이 Bundle의 Old 문서가 가리키는 문서·그 문서를 가리키는 문서·바뀔 문서(후속 문서)를 표(List)와 지도(줄기·마디·선)로 보이되, 구성원이 아닌 Bundle은 번호·제목·상태·후속 문서·줄 수만 **서버 응답에서부터** 준다.

**Architecture:** 서버는 읽기 전용 라우터 하나(`routers/sop_map.py` `GET /api/bundles/{bundle_id}/map?scope=linked|all`)와 모듈 하나(`app/sop/ref_map.py`)다 — 줄을 모으는 단계(`MapLine`)와 선으로 묶는 단계를 갈라 두고(다음 계획의 문장 API가 줄 단계를 다시 쓴다), 참조 판정은 `refs.read_ref_state`를 그대로 부른다. 이 응답에는 문장을 담는 필드가 아예 없다. 화면은 순수 모델 셋(`lib/map-model.ts` 거르기·찾기·옆 칸, `lib/map-layout.ts` 배치·확대 셈, `lib/map-keys.ts` 글쇠)이 규칙을 갖고, 마디는 DOM 단추·선은 SVG 한 장으로 같은 좌표에 겹쳐 그린다(그래프 라이브러리 없음). 호버 강조는 DOM 속성, 고르기만 React 상태다.

**Tech Stack:** Python 3.11 · FastAPI · SQLAlchemy(async) · pytest / Next.js 16 · React 19 · TypeScript · vitest · Playwright(시스템 Chrome) 스모크. 새 의존성·새 권한 키·새 env·Alembic 리비전 없음.

**Spec:** `docs/superpowers/specs/2026-11-17-reference-map-design.md` — §2(목표·비목표·반목표), §4(마디·선·후속 문서), §5(누가 무엇을 보나), §6 전부, §7.1·§7.3·§7.4, §8, §9, §10의 1·2걸음, §11, §12. 3걸음(문장 `…/map/lines`·줄의 **Open in Assign**)은 `2026-11-17-reference-map-lines-plan.md`가 맡는다. 구현 전에 루트 `CLAUDE.md`, `backend/CLAUDE.md`("SOP 규칙 이중 사용 지점"), `frontend/CLAUDE.md`, `rules/common/security.md`, `docs/lessons/react-ts-patterns.md`(§3·§6·§7)·`browser-verification.md`(함정 1·2·5·6·8·9)·`ui-review.md`(4·5·7~11), 디자인 기초 `frontend/docs/design/2026-11-07-frontend-design-foundations.md` §2·§5·§10·§15를 읽는다. 시안은 비공개 세션 산출물이라 저장소에 없다 — 필요한 값은 이 계획에 옮겨 적었다.

## Global Constraints

- **접근 규칙이 첫째다(사용자 결정 2026-11-16).** "모든 Bundle의 문서 번호·제목·상태·후속 문서는 누구나 보고, 문장은 그 Bundle 구성원만 본다. 남의 작업은 중립 색 `--peer-*`. 레일 항목 이름은 'Map'." **보면 안 되는 값은 응답에 싣지 않는다 — 화면에서 가리는 것은 접근 제어가 아니다.** 응답의 모든 필드는 아래 "가시성 행렬"에 줄이 있어야 하고, 행렬에 없는 필드를 스키마에 더하지 않는다. 행렬의 칸마다 서버 시험이 있다.
- **지도를 여는 사람은 그 Bundle의 구성원뿐이다**: 첫 의존성 `require_bundle_role(*MEMBER_ROLES)` — 계정 활성(403 `inactive_account`) → 구성원(404 `bundle_not_found`) 순서 그대로, sysadmin(`APP_SYSADMINS`)·`bundle.admin` 보유자도 예외가 아니다. 판정 함수를 새로 쓰지 않는다. 다른 Bundle과의 관계(`self`·`member`·`summary`)는 `bundle_members`만으로 정한다 — 권한(`get_effective_access`)을 보지 않는다.
- **구성원이 아닌 Bundle(`summary`)에서 응답에 실리는 것은 이것뿐이다**: Bundle `id`·`code`·`status`·`document_count`, Old 문서의 번호·제목, 후속 문서의 번호·제목·종류, 선(어느 마디 → 어느 마디, 종류, 상태, 줄 수). **Bundle 제목은 싣지 않는다(빈 문자열)** — 아래 판단 1. 설명·구성원·부서·진행 숫자·문서 판·파일 이름·사유·새 문장·AI 제안 상태·EQUIS·Unit 글·Unit id·표시 ID는 누구에게도 싣지 않는다.
- **자유 입력이 번호처럼 새지 않게**: 어느 문서와도 맞지 않고 문서 번호 꼴(`refs.is_document_number`)도 아닌 번호는 선째로 버린다 — `moved`뿐 아니라 `ref`도(판단 3). 임시 번호(`NEW-<숫자>`)는 번호로 치지 않는다. 누가 보든 같은 규칙이다.
- **합성 Bundle과 실제 Bundle은 서로의 지도에 나오지 않는다**(`Bundle.is_synthetic`이 보는 Bundle과 같은 것만). 시험·시드·예시는 모두 합성이다(파일 이름 `SYNTHETIC_`). 공개 저장소다 — 추적 파일에 사용자 경로·실서버 IP·사내 호스트명·시크릿·실제 SOP 글을 쓰지 않는다.
- **읽기만 한다.** 지도는 아무것도 쓰지 않는다 — `bundle_events`·어떤 `revision`도 바뀌지 않고, `lock_bundle`·`FOR UPDATE`·`FOR SHARE`를 쓰지 않는다. `source_blocks`·`document_files`를 읽지 않는다. AI를 부르지 않고 지도 자료를 AI 페이로드에 싣지 않는다. EQUIS를 읽지도 조회를 걸지도 않는다.
- **질의 수는 Bundle 수와 무관하다.** Bundle마다 도는 질의(루프 안 `session.get`·`execute`)를 쓰지 않는다. id·번호 목록이 길면 `groups.select_in_chunks`로 나눈다. 로그에는 건수와 걸린 시간만 남긴다(번호·제목·글을 남기지 않는다).
- **규칙은 한 곳에만**: 참조 판정은 `refs.read_ref_state`, 번호 맞추기는 `equis.rules.normalize_number`와 DB 쪽 `func.upper(func.trim(...))`, 가장 새 추출은 `snapshot.select_latest_extractions`, 표시 가능한 번호 꼴은 `refs.is_document_number`, 임시 번호는 `tobe.is_temp_match_code`. 지도에 둘째 구현을 두지 않는다.
- **새로 만들지 않는 것**: 권한 키(`catalog.py`·`lib/access.ts`·`permission.<key>` 그대로), env, 의존성(backend·frontend 모두), Alembic 리비전·모델 변경(`test_migrations.py`가 그대로 통과), 업무 규칙 거절 코드(`rule.<code>` 문구 없음). 그래프·캔버스 라이브러리를 들이지 않는다.
- **화면 규칙은 순수 모델에 두고 단위 시험한다**(`map-model`·`map-layout`·`map-keys`). 배치는 DOM을 재지 않는 정해진 셈이다(난수·힘 모의 없음, 입력 순서를 섞어도 같은 출력). 마디 위를 지나는 동안 React 커밋이 없다.
- **고치는 길이 없다**: 번호 확인·새 문장·보낼 곳은 Assign에서 한다. 지도에 저장 단추·입력 양식을 두지 않는다. 갈 수 있는 곳에만 **Open in Assign** 이 있다(`relation`이 `self`·`member`인 Bundle의 Old 문서).
- 색·그림자는 토큰만(raw hex 금지, 화면 코드가 테마로 갈라지지 않는다). 색만으로 가르는 것이 없다(선 모양·막대·소유 표시 글자를 함께). 한쪽 막대가 있는 마디는 막대 쪽 모서리가 직각이다. 아이콘만 있는 것은 모두 툴팁(포커스로도). 브라우저 기본 `title`·체크박스·`<select>`를 쓰지 않는다. `crypto.randomUUID`·`crypto.subtle`·Clipboard를 쓰지 않는다(평문 HTTP 서버).
- 새 문구는 `frontend/src/lib/i18n-messages.ts`에 en·ko 한 쌍. Bundle·Old·New·Unit과 상태·열 이름·선의 상태는 ko에서도 영어다. 사용 설명서 글(`frontend/public/manual/user-manual.md`)은 화면을 만드는 커밋에서 함께 쓰고, 화면 라벨은 영어 화면 글자 그대로 **굵게** 적는다(`manual-content.test.ts`). 그림은 뽑지 않는다.
- **기존 시험(pytest·vitest·스모크·감사)의 기대값을 고치지 않는다.** 예외는 이 계획이 이름을 적어 허락한 곳뿐이다: `stages.test.ts`·`page-width.test.ts`·`manual.test.ts`에 **줄을 더하는 것**(Task 5), `test_seed_sop_demo.py`의 `EXPECTED_BUNDLES`와 문서 수 단언(Task 3), `pw-layout-audit.mjs`의 `loadIds`·`checkIds`·`sceneUrls`(Task 3·9), 스모크의 레일 순서를 보는 단언이 있으면 그 한 줄(Task 5 Step 1에서 찾는다).
- 다른 작업(끌어다 놓기 4걸음 Pair view)이 Assign 화면 파일·`toast.tsx`·스모크 스크립트·`PROGRESS.md`·`CHANGELOG.md`를 고치고 있다. **이 계획은 `frontend/src/app/bundles/[id]/assign/`과 `components/assign/`을 고치지 않는다**(`git diff --stat dev -- "frontend/src/app/bundles/[id]/assign" frontend/src/components/assign`가 비어 있어야 한다). 스모크 스크립트에는 새 단계를 파일 끝(`await browser.close()` 앞)에만 더한다.
- 작업 폴더는 이 작업의 워크트리(`<worktree>`), 브랜치 `feat/reference-map`(앞선 작업이 합쳐진 `dev`에서 딴다). 버전은 가정하지 않는다 — 마지막 태스크가 `frontend/package.json`의 지금 값을 읽고 그 다음 PATCH로 올린다. 푸시·태그는 하지 않는다.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. 커밋 전 `PROGRESS.md` 갱신.

```bash
# 워크트리 backend/ 에서
PY=<original-checkout>/backend/.venv/bin/python
$PY -m pytest tests/test_sop_map.py -q                      # 한 파일은 -n 없이
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

**표 1 — 누가 지도를 받나.** V는 보는 Bundle, B는 지도에 나오는 다른 Bundle이다.

| 보는 사람 | `GET /api/bundles/{V}/map` | B의 자료는 |
|---|---|---|
| V의 작성자 | 200 | B의 구성원이면 `member`, 아니면 `summary` |
| V의 검토자 | 200 — 작성자와 **본문이 글자까지 같다**(둘의 다른 Bundle 구성이 같을 때) | 위와 같다 |
| 다른 Bundle만의 구성원(V 구성원 아님) | 404 `bundle_not_found` | — (자기 Bundle의 지도에서는 V가 `summary`다) |
| sysadmin · V 구성원 아님 | 404 `bundle_not_found` | — |
| sysadmin · V 구성원 · B 구성원 아님 | 200 | `summary`(제목 빈 값) |
| `bundle.admin` 보유 · V 구성원 아님 | 404 `bundle_not_found` | — |
| `bundle.admin` 보유 · V 구성원 · B 구성원 아님 | 200 | `summary`(제목 빈 값) |
| 퇴직자(V 구성원) | 403 `inactive_account` | — |
| 로그인 없음(keycloak 모드, Bearer 없음) | 401 | — |
| dev 모드에서 `X-Dev-User` 없음 | `DEV_USER`로 본다 — 구성원이 아니면 404(401이 아니다, 아래 "어긋난 곳" 3) | — |

**표 2 — 필드마다, 그 자료가 속한 Bundle과의 관계에 따라.** ○ = 값이 실린다.

| 필드 | `self` | `member` | `summary` | 어느 Bundle에도 없음(`num`) |
|---|---|---|---|---|
| `bundles[].id` · `code` · `status` · `relation` · `document_count` | ○ | ○ | ○ | — |
| `bundles[].title` | ○ | ○ | **`""`** | — |
| `nodes[].id` · `kind` · `bundle_id` · `number` | ○ | ○ | ○ | ○ (`bundle_id: null`) |
| `nodes[].title` · `doc_type` | ○ | ○ | ○ | `""` · `null` |
| `nodes[].becomes[].code` · `title` · `doc_type` | ○ | ○ | ○ | `[]` |
| `edges[].source` · `target` · `kind` · `state` · `lines` | ○ | ○ | ○ — `proposed`는 한쪽 끝이 V일 때만 | ○ |
| `scope` · `truncated` | 요청·상한의 것 — Bundle과 무관 | | | |
| 설명 · 구성원 · 부서 · 진행 숫자 · 판 · 파일 이름 · 사유 · 새 문장 · AI 제안 · EQUIS · Unit 글·id·표시 ID | **스키마에 없다(누구에게도)** | | | |

칸마다의 시험은 Task 1(`test_map_requires_membership_and_an_active_account` · `test_linked_map_for_a_member` · `test_author_and_reviewer_get_the_same_map` · `test_relation_follows_membership_not_permissions`)과 Task 2(`test_response_carries_only_the_listed_fields` · `test_no_text_of_a_non_member_bundle_leaves_the_server` · `test_all_scope_…`)에 있다.

## 이 계획이 정한 것(내 판단 — 설계에 없는 빈칸)

**누가 무엇을 보나**

1. **Bundle 제목은 구성원에게만 싣는다(설계 §5의 "내 판단"을 뒤집는다).** 지금 코드에서 로그인한 사람이 모든 Bundle의 제목을 보는 길은 없다: `GET /api/bundles`(`routers/sop_bundles.py` `list_my_bundles`)는 `bundle_members`에 요청한 사람이 있는 행만 주고, 전체 목록 `GET /api/admin/bundles`는 `bundle.admin`만, `GET …/move-targets`(`remarks.list_move_targets`)도 내가 구성원인 Bundle의 New 문서만 준다. 사용자가 연 넷에도 Bundle 제목은 없다 → 넓히지 않는다. `summary` 관계의 `title`은 `""`이고 줄기 머리는 코드(`BND-0018`)와 소유 표시 **Other Bundle · summary only** 만 적는다(설계 §5가 적어 둔 뒤집는 길 그대로). sysadmin·`bundle.admin`도 같다 — 그들은 관리 화면에서 제목을 볼 수 있지만, 지도에 권한 갈래를 하나 더 만들면 규칙이 둘이 된다.
2. **사용자가 말한 넷(번호·제목·상태·후속 문서) 밖에서 응답에 남긴 것과 까닭** — 하나씩: ① Bundle `id`·`code`: id에서 만든 순번이라 그 자체로 뜻이 없고, 줄기에 붙일 중립 이름이 필요하다. ② `document_count`: 범위 `all`이 이미 그 Bundle의 Old 문서를 모두 나열하므로 새 정보가 아니다. ③ `relation`: 보는 사람 자신의 구성 여부다. ④ 마디 `id`의 문서 id·New 문서 id: 내용 없는 열쇠다. ⑤ 후속 문서의 `title`·`doc_type`: "후속 문서"를 알아보는 데 필요한 그 문서의 번호·제목이고, 종류(SOP/WI)는 번호에서도 읽힌다. ⑥ `target` 마디(남의 New 문서의 번호·제목): 누군가의 줄이 이미 그 번호를 가리킬 때만 나온다 — 문서 번호·제목이다. ⑦ 선(남끼리의 `confirmed` 선 포함)과 줄 수: 지도의 목적(§1의 물음 2~4)이고 사용자가 본 시안에 있었다 — 번호와 수만 담는다. **뺀 것**: Bundle 제목(판단 1).
3. **번호 꼴 아닌 번호를 버리는 규칙을 `ref` 선에도 건다**(설계 §4는 `moved`에만 걸었다). 사람이 확인한 참조 번호(`unit_refs.number`)는 그 문장의 글에서 고른 글자다 — `refs.read_number_in_text`가 받는 꼴(`equis.client.is_sendable_number`)은 대문자·숫자·빈칸·`./_-`로 100자까지라, 영어 문장 한 토막이 "번호"로 저장될 수 있다. 그것이 어느 문서와도 맞지 않으면 `num:<그 글>` 마디가 되어 구성원 아닌 사람에게 문장 조각이 나간다. 그래서 **풀리지 않은 번호는 종류와 상관없이 `refs.is_document_number`를 통과할 때만 `num` 마디가 된다.** 문서와 맞은 번호는 그 문서 마디가 되므로 영향이 없다. 값: 이 Bundle 자신의, 번호 꼴이 아닌 확정 참조(예: 양식 번호 `QP 07`)가 어느 Bundle에도 없으면 지도에 나오지 않는다 — 설명서 `#map`에 한 줄 적는다.
4. **임시 번호(`NEW-<숫자>`)**: 그런 `code`의 New 문서는 번호로 찾아지지 않고, 그런 꼴의 번호를 가리키는 선은 버린다. 후속 문서로는 `code: ""`와 제목만 싣는다(§4).
5. **참조 줄의 범위**: 읽힌 Old 문서(`side = "old"`, `status = "ready"`)의 가장 새 추출의 활성 Unit(`status == "active"`) 가운데 `kind ∈ refs.REF_KINDS`. 그 Unit의 판단(삭제·보류·배정)은 보지 않는다 — Old 문서가 그 번호를 가리킨다는 사실은 처분과 무관하다. `moved`는 `disposition == "move_external"`이고 `status == "confirmed"`인 판단만.
6. **줄 수 세는 식**: `ref`는 Unit 하나가 한 줄. `moved`는 진행 숫자와 같은 줄 열쇠(`snapshot.load_bundle_progress`의 `coalesce(UnitPairMember.pair_id, -Unit.id)`, `group_unit_id IS NULL`인 Unit만)의 가짓수다 — 설계의 "확정 짝이면"보다 넓게 짝이면 한 줄인데, 이동을 확정하면 그 짝은 `pair_settle`이 이미 정리해 두므로 값은 같다.
7. **상한에서 자르는 순서**(`MAX_NODES = 2000` · `MAX_EDGES = 10000`, 코드 상수): 마디는 이 Bundle 것 → 이 Bundle과 선으로 이어진 것 → 나머지를 (Bundle id, 종류, id) 순으로 채운다. 선은 두 끝이 모두 남은 것만, 한쪽 끝이 이 Bundle인 것 먼저 (source, target, kind, state) 순. 하나라도 잘리면 `truncated: true`.
8. **응답의 순서는 정해져 있다**(같은 자료는 같은 본문): `bundles`는 `self` 먼저, 그 뒤 id 순. `nodes`는 그 Bundle 순서 → 종류(`old` · `target` · `num`) → 문서 id(`num`은 번호) 순. `edges`는 (source, target, kind, state)의 문자열 순.
9. **`bundles`에 실리는 Bundle**: 보는 Bundle은 늘, 그리고 마디가 하나라도 실린 Bundle. `all`에서는 읽힌 Old 문서가 있는 같은 종류의 Bundle 전부. `document_count`는 읽힌 Old 문서 수(New 문서만 가리켜져 실린 Bundle은 0일 수 있다).
10. **모든 마디가 같은 모양이다**: `doc_type`(`target`만 값, 나머지 `null`)과 `becomes`(`old`만 채워질 수 있다)를 늘 싣는다.
11. **느릴 때**(§7.3의 목표 linked 300ms · all 800ms, 극단 시드·로컬 sqlite): Task 9에서 잰다. 넘으면 로그의 시간으로 어느 질의인지 적고, 스키마를 건드리지 않는 손질(번호 `LIKE`를 한 질의에 묶는 수·조건 순서) 한 번까지만 한다. 그래도 넘으면 **표를 만들지 않고**(§12) 측정값을 설계 §7.3·CHANGELOG "알려진 한계"·PROGRESS에 적어 조율 세션에 알린다. linked 1,000ms·all 3,000ms를 넘으면 올리지 않고 멈춘다(내 판단 — 그 위는 화면이 멈춘 것처럼 보인다). 개발 스택(Postgres)의 값은 배포 뒤 backend 로그의 `elapsed_ms`로 사용자가 본다.

**서버의 이름과 모양**

12. 모듈 `backend/app/sop/ref_map.py`, 라우터 `backend/app/routers/sop_map.py`(`router = APIRouter(prefix="/api/bundles", tags=["sop-map"])`), 시험 `backend/tests/test_sop_map.py`와 도우미 `backend/tests/sop_map_helpers.py`. 스키마 클래스 `MapOut`·`MapBundleOut`·`MapNodeOut`·`MapBecomesOut`·`MapEdgeOut`.
13. 공개로 꺼내는 함수 셋: `refs.is_document_number`(§11 "번호 꼴 판정"), `tobe.is_temp_match_code`(§11 "임시 번호 판정" — `tobe.temp_match_code` 옆에 두고 `equis/service.py`의 `_TEMP_CODE`를 이것으로 바꾼다), `snapshot.select_latest_extractions`(지금 `_select_latest_extractions` — 이름만 공개로, 그 파일 안의 쓰는 곳 둘도 같이).
14. 줄을 모으는 단계와 선으로 묶는 단계를 가른다(`MapLine` · `collect_map_lines` · `build_reference_map`). 다음 계획의 문장 API가 `collect_map_lines`의 줄을 다시 쓴다 — 줄 규칙을 두 번 쓰지 않게.

**화면**

15. **레일**: `StageKey`에 `"map"`, `STAGES`에서 History 바로 앞, 아이콘 lucide `Map`(`MapIcon`으로 들여온다). `stage.map`은 ko에서도 "Map"이다(다른 레일 항목은 ko가 한글이지만 사용자가 이름을 "Map"으로 정했다). 레일을 아래로 미는 여백(`components.css`의 `.stg[data-stage="history"]` 두 줄)은 `map`으로 옮긴다. 본문 폭은 `desk`.
16. **List는 `DataList`를 쓰지 않고 History처럼 `dtable`을 직접 그린다** — `DataList`는 표·카드 보기를 기억하는 단추를 지녀 Map · List 옆에 보기 단추가 둘이 된다. `table-layout: fixed`, 열 폭 From 22% · To 22% · Becomes 22% · Bundle 16% · State 104px · Lines 64px, 번호·제목 칸은 감싼 `div.clamp-2`.
17. **이 계획의 옆 칸은 문장 대신 줄 수를 적는다**: Cites · Cited by 목록의 줄은 맞은편 번호 · 상태 알약 · `{n} lines`. 문장과 "줄 N개 가려짐"은 다음 계획이 그 자리에 넣는다.
18. **줄기 이름**: `self`·`member`는 코드 + 제목, `summary`는 코드만. 마지막 줄기는 **Not in any Bundle** 과 작은 글 "Cited, but nobody restructures it".
19. **배치 값**(시안 값 그대로, Task 9에서 극단 자료로 재고 바꾸면 상수만 바꾼다): 줄기 폭 200 · 마디 176×44 · 가로 틈 48 · 세로 틈 10 · 줄기 머리 50 · 줄기 최소 높이 120 · "N개 더" 줄 28 · 같은 줄기 고리의 볼록함 34 · 같은 두 마디 사이 선의 벌림 6 · 제어점 최소 24.
20. **접힌 줄기**는 폭을 지키고 머리(50)만 남는다. 접힌 줄기의 마디에 닿는 선은 그리지 않는다(머리에 모아 긋지 않는다 — 어느 문서인지 말하지 못하는 선은 잡음이다). List는 접힘과 무관하게 모두 보인다.
21. **같은 두 마디 사이의 선**(방향 무관)은 (확인한 참조 · REF? · Moved to, 그 안에서 source id) 순으로 세워 가운데를 기준으로 6px씩 벌린다 — 두 끝 모두 같은 값만큼.
22. **확대**: 0.5 ~ 1.5, 0.1씩(소수 첫째 자리로 맞춘다). **Fit all** 은 `min((칸 폭 − 32) / 세계 폭, (칸 높이 − 32) / 세계 높이, 1)`을 0.1 아래로 내리고 0.5보다 작으면 0.5. 0.75 미만이면 마디의 둘째 줄을 감춘다. 확대는 `transform: scale(k)`(원점 왼쪽 위)와 겉 상자 크기 `폭×k`·`높이×k`.
23. **바탕 끌기**는 작은 훅 `components/map/use-map-pan.ts`로 따로 둔다(§11) — `lib/box-drag.ts`의 `DRAG_THRESHOLD_PX`·`hasPassedThreshold`·`DRAG_GUARD_SELECTOR`만 가져다 쓰고 `attachBoxDrag`는 쓰지 않는다. `pointerdown`에서 `preventDefault`를 부르지 않고, 끈 뒤의 `click` 한 번을 삼키고, 마디·단추 위에서는 시작하지 않는다.
24. **찾기**: 번호나 제목에 그 글이 들어 있으면 맞는다(앞뒤 빈칸 떼고 `toLowerCase()`로 견준다). 맞는 마디에 `data-match`, 찾는 중이면 나머지는 흐리다. Enter는 줄기 순서 → 줄기 안 순서로 다음 맞는 마디를 고른다(끝이면 처음으로). 한글 입력 중의 Enter(`isComposing`)는 건너뛴다. 입력값은 `useDeferredValue`로 늦춰 그린다.
25. **호버 강조는 고른 것이 없을 때만** DOM 속성으로 단다(고른 동안에는 고른 마디의 이웃이 강조된 채다). 툴팁은 위임 툴팁(`useDelegatedTip`)이고 그 훅은 겉 상자 부품에만 둔다 — 마디·선을 그리는 부품은 따로 떼어, 툴팁이 뜰 때 마디 수백 개가 다시 그려지지 않게 한다.
26. **"문서 N개 더"**(범위 `linked`의 남의 줄기 맨 아래, N = `document_count` − 그 줄기에 보인 Old 마디 수)를 누르면 범위를 **All Bundles** 로 바꾸고 그 줄기를 편 채 연다. 범위 `all`로 들어가면 이 Bundle과 선으로 이어지지 않은 줄기는 접힌 채 시작한다.
27. **고른 것이 사라지면 풀린다**: 범위·거르기를 바꿔 고른 마디가 보이지 않게 되면 고름을 푼다(옆 칸은 요약으로).
28. **`target` 마디의 옆 칸에는 Becomes 줄이 없다**(New 문서는 바뀌는 문서가 아니다). `num` 마디에는 Bundle·Status 줄이 없다.
29. **권한을 잃은 뒤의 화면**: 다시 읽기가 403·404로 끝나면 앞서 받은 지도를 지우고 `BundleLoadError`를 보인다(`useLoaded`는 실패해도 앞 자료를 남긴다 — 접근을 잃은 사람에게 남의 요약을 계속 보이지 않는다).
30. **빈 상태**: 이 Bundle에 읽힌 Old 문서가 없으면 지도·표 자리에 `EmptyState` **No documents yet**(범위 `linked`일 때 — 도구 줄은 살아 있다). 문서는 있는데 선이 없으면 이 Bundle 줄기만 그리고 옆 칸 요약 아래에 **No references yet**. 거르기·찾기로 List가 비면 **Nothing matches** + **Clear filters**.

**시드**

31. **데모 시드**에 지도용 Bundle 둘을 단계 Bundle 넷 **뒤에** 만든다(id가 5·6이 되어 `pw-overlap-audit.mjs`의 `BUNDLE=2`와 스모크의 제목 찾기를 흔들지 않는다): `SYNTHETIC 5 UV 분광광도계`(qa.member 작성자 · qa.lead 검토자 → 작성자에게 `member`), `SYNTHETIC 6 문서 관리`(prod.member 혼자 → qa.member에게 `summary`). 내용은 Task 3.
32. **극단 시드**에 서로 가리키는 Bundle 8개(`SYNTHETIC M1 map` … `M8`, Old 문서 104개)를 더한다. 내용은 Task 3. 지금의 가벼운 Bundle 36개 가운데 **All Bundles** 에 서는 것은 읽힌 Old 문서가 있고 종류가 같은 것뿐이다(아래 "어긋난 곳" 4).

## 설계와 코드가 어긋난 곳 — 이렇게 정했다

1. **Bundle 제목**(§5 "내 판단")은 지금 코드에서 구성원·`bundle.admin` 밖으로 나가지 않는다 → 넓히지 않는다(판단 1). §8의 `map.lane.lockTip`·`map.side.notMember` 문구의 "titles"는 문서 제목을 말하므로 그대로 쓴다.
2. **확인한 참조 번호가 자유 글일 수 있다**는 것을 §4는 `moved` 대상 코드에서만 보았다 → `ref`에도 같은 규칙(판단 3).
3. **"로그인 없음 → 401"**(§9)은 keycloak 모드에서만 참이다. dev 모드의 `auth.get_current_user`는 헤더가 없으면 `settings.dev_user`를 돌려준다. 시험은 둘 다 박는다(`monkeypatch.setattr(settings, "auth_mode", "keycloak")`로 401, dev 모드 헤더 없음은 `DEV_USER` 판정).
4. **"가벼운 Bundle 36개가 All Bundles에서 접힌 줄기로 선다"**(§9)는 §7.1 "읽힌 Old 문서가 없는 Bundle은 싣지 않는다"와 어긋난다. 극단 시드의 가벼운 Bundle은 셋에 하나만 문서가 있고 여섯에 하나는 실제 종류(`is_synthetic=False`)다 → 실제로 서는 것은 10개 안팎이다. §7.1을 따른다.
5. **데모 Bundle 넷은 같은 문서 번호(OLD-1 … OLD-6)를 지닌다.** 그래서 지도용 Bundle의 `OLD-1 …` 줄은 넷 모두의 OLD-1에 선을 긋는다(§4 "같은 번호가 여러 Bundle에 있으면 그 마디마다"). 데모에서 늘 보이는 정상 동작이다 — 스모크는 수를 박지 않고 응답과 화면을 견준다.
6. **§3의 조사 기준**(`feat/assign-drag-send` `9b1551b`) 뒤로 지도가 기대는 코드(`refs.py`·`membership.py`·`remarks.py`·`snapshot.py`·`stages.ts`·`stage-nav.tsx`·`tokens.css`)는 바뀌지 않았다(이 계획을 쓰며 다시 읽었다). Assign 화면 파일은 바뀌는 중이라 이 계획은 건드리지 않는다.

## Review Focus

1. **보던 중에 구성원에서 빠진 사람**이 **Read again** 을 누른다 — 서버는 404, 화면은 앞서 받은 지도를 지우고 "없음" 화면이 된다. 남의 요약이 화면에 남으면 안 된다.
2. **문서 번호에 `%`·`_`·따옴표가 있거나 100자인 문서**를 가진 Bundle의 지도 — 500이 나지 않고, `LIKE` 조건에 그 번호가 들어가 엉뚱한 줄(`OLDX1 …`)을 선으로 세지 않는다.
3. **한 Bundle 안에 같은 번호의 Old 문서가 둘**(파일이 다르면 올릴 수 있다) — 두 마디 모두 선을 받고, 화면의 마디 열쇠가 겹치지 않으며 배치가 흔들리지 않는다.
4. **선이 하나도 없거나 문서가 하나도 없는 Bundle, 그리고 거르기로 선이 모두 사라진 때** — 배치·옆 칸·List가 빈 입력에서 죽지 않고 빈 상태를 말한다.
5. **찾는 글이 빈칸뿐이거나 정규식 글자(`(`·`[`·`\`)이거나 한글 입력 중** — 예외 없이 "맞는 것 없음"이거나 그대로 찾고, 입력 중의 Enter가 엉뚱한 마디로 뛰지 않는다.

---

### Task 1: 서버 — 번호 규칙 셋과 요약 API(범위 `linked`), 접근 시험

**Files:**
- Create: `backend/app/sop/ref_map.py` · `backend/app/routers/sop_map.py` · `backend/tests/sop_map_helpers.py` · `backend/tests/test_sop_map.py`
- Modify: `backend/app/sop/refs.py`(`is_document_number`) · `backend/app/sop/tobe.py`(`is_temp_match_code`) · `backend/app/equis/service.py`(`_TEMP_CODE` → `is_temp_match_code`) · `backend/app/sop/snapshot.py`(`select_latest_extractions` 공개) · `backend/app/main.py`(라우터 등록 — `sop_equis_router` 다음 줄)

**Interfaces:**
- Consumes: `membership.require_bundle_role`·`BundleContext`·`BundleIdPath`, `refs.read_ref_state`·`REF_KINDS`·`REF_LANG`, `equis.rules.normalize_number`, `groups.select_in_chunks`, `bundle_code.format_bundle_code`, 모델 `Bundle`·`BundleMember`·`Document`·`Extraction`·`Unit`·`UnitRef`·`UnitDecision`·`UnitPairMember`·`TargetDoc`·`TargetSentence`·`TargetSource`.
- Produces:

```python
# refs.py — 지금 _NUMBER의 몸통(끝의 (?!…)를 뺀 부분)을 상수로 꺼내 둘이 같이 쓴다. find_leading_number의 동작은 그대로다
def is_document_number(number: str) -> bool:
    """글 전체가 문서 번호 꼴인가 — [A-Z]{2,}(?:-[A-Z0-9]{1,8})*-\\d{1,6} 에 fullmatch."""

# tobe.py
def is_temp_match_code(code: str) -> bool:
    """앱이 붙인 임시 번호(NEW-<숫자>)인가 — 앞뒤 빈칸·대소문자를 가리지 않는다."""

# snapshot.py — _select_latest_extractions의 새 이름(본문 그대로)
def select_latest_extractions(*conditions: ColumnElement[bool]) -> Select[Any]: ...

# ref_map.py
MapScope = Literal["linked", "all"]
MAX_NODES = 2000    # 응답의 마디 상한 — 넘으면 truncated
MAX_EDGES = 10000   # 응답의 선 상한

@dataclass(frozen=True)
class MapLine:
    """선으로 묶기 전의 한 줄 — 참조 줄은 Unit 하나, 이동은 줄(짝 하나 또는 짝 없는 Unit 하나, 그 줄의 원문 순서 첫 Unit)."""
    bundle_id: int
    document_id: int
    unit_id: int
    kind: Literal["ref", "moved"]
    state: Literal["confirmed", "proposed"]
    number: str   # normalize_number를 거친 번호

class MapBundleOut(BaseModel):
    id: int
    code: str
    title: str                                   # relation이 summary면 ""
    status: str
    relation: Literal["self", "member", "summary"]
    document_count: int
class MapBecomesOut(BaseModel):
    code: str                                    # 임시 번호면 ""
    title: str
    doc_type: Literal["sop", "wi"]
class MapNodeOut(BaseModel):
    id: str                                      # old:<document id> | target:<target doc id> | num:<번호>
    kind: Literal["old", "target", "num"]
    bundle_id: int | None
    number: str
    title: str
    doc_type: Literal["sop", "wi"] | None        # target만
    becomes: list[MapBecomesOut]
class MapEdgeOut(BaseModel):
    source: str
    target: str
    kind: Literal["ref", "moved"]
    state: Literal["confirmed", "proposed"]
    lines: int
class MapOut(BaseModel):
    scope: MapScope
    truncated: bool
    bundles: list[MapBundleOut]
    nodes: list[MapNodeOut]
    edges: list[MapEdgeOut]

async def collect_map_lines(session: AsyncSession, bundle: Bundle, scope: MapScope) -> list[MapLine]: ...
async def build_reference_map(session: AsyncSession, ctx: BundleContext, scope: MapScope) -> MapOut: ...

# routers/sop_map.py
@router.get("/{bundle_id}/map", response_model=MapOut)
async def get_reference_map(scope: MapScope = Query("linked"), ctx: BundleContext = Depends(_require_member), session: AsyncSession = Depends(get_session)) -> MapOut
```

- **이 태스크는 범위 `linked`까지다.** `scope="all"`도 받되 이 태스크에서는 `linked`와 같은 줄을 모은다(남끼리의 선과 나머지 Bundle은 Task 2). 응답의 `scope`는 요청값이다.

- [ ] **Step 1: 시험 도우미를 쓴다** — `tests/sop_map_helpers.py`. 세 Bundle을 앱 API로 만든다(모두 `is_synthetic=True`, 작성자 헤더로 만들고 S만 끝에 구성원을 갈아 끼운다 — `assign_as_is`가 작성자 헤더로만 부른다).

  | Bundle | 구성원 | New 문서 | Old 문서(파일 이름 → 번호) | 줄과 처리 |
  |---|---|---|---|---|
  | **V** `V_TITLE = "SYNTHETIC map viewed"` | qa.member 작성자 · qa.lead 검토자 · ops.member 작성자 | `SOP-CF` "Synthetic SOP" | `SYNTHETIC_OLD-1_Centrifuge.docx` → `OLD-1` | `REF_UV = "SOP-ABC-1016 Operation of UV spectrophotometer"`(그대로 → 제안) · `REF_DC = "SOP-ABC-1020 Document control"`(`set_ref`로 확인) · `REF_NONE = "SOP-ZZ-404 Synthetic missing document"`(그대로) · `REF_SELF = "OLD-1 Synthetic self reference"`(그대로) · `MOVED_OK = "Calibrate the rotor every year."`(`decisions/bulk` `move_external`, 코드 `" sop-qc-99999 "`) · `MOVED_FREE = "Order spare tubes from the supplier."`(`move_external`, 코드 `"see the purchasing team"`) · `PLAIN = "Balance the tubes before loading the rotor."`(`assign_as_is` → `SOP-CF`, `slot_key="purpose"`) |
  | **M** `M_TITLE = "SYNTHETIC map member"` | qa.member 작성자 · qa.lead 검토자 | `SOP-UV` "Synthetic UV SOP" · `WI-11` "Synthetic UV WI"(부모 `SOP-UV`, `wi_steps=[{"code": "WI-11", "step_no": 1, "title": "Check"}]`) | `SYNTHETIC_SOP-ABC-1016_UV.docx` → `SOP-ABC-1016` | `M_REF = "OLD-1 Operation of the centrifuge"`(그대로 → 제안) · `M_PLAIN = "Warm up the lamp for thirty minutes."`(`assign_as_is` → `SOP-UV`, `slot_key="purpose"`) · `M_EXTRA = "Check the lamp hours on the display."`(그대로 — 미배정) |
  | **S** `S_TITLE = "ZZ-BUNDLE-TITLE synthetic"`, 설명 `"ZZ-DESCRIPTION synthetic"` | 끝에 `set_members(…, [("prod.member", "author")])` — prod.member 혼자 | `SOP-QC-99999` "Synthetic calibration SOP" | `SYNTHETIC_SOP-ABC-1020_ZZ-FILE-NAME.docx` → `SOP-ABC-1020`, 올린 뒤 `PATCH …/documents/{id}`로 `title: "Synthetic document control"` | `S_REF = "OLD-1 ZZ-REF-TEXT synthetic"`(`set_ref`로 확인) · `S_MOVED = "ZZ-MOVED-SENTENCE synthetic."`(`move_external`, 코드 `"old-1"`, 사유 `"ZZ-REASON synthetic"`) · `S_PLAIN = "ZZ-NEW-SENTENCE synthetic."`(`assign_as_is` → `SOP-QC-99999`) · `S_HOLD = "ZZ-HOLD-TEXT synthetic."`(`save_group` `action: "hold"`, `hold_reason: "ZZ-HOLD-REASON synthetic"`) |

  ```python
  MARKERS = ("ZZ-BUNDLE-TITLE", "ZZ-DESCRIPTION", "ZZ-FILE-NAME", "ZZ-REF-TEXT", "ZZ-MOVED-SENTENCE", "ZZ-REASON", "ZZ-NEW-SENTENCE", "ZZ-HOLD")
  OPS = {"X-Dev-User": "ops.member"}

  class World:   # 속성: v_id, m_id, s_id, v_doc, m_doc, s_doc(문서 응답 dict), v_sop, m_sop, s_sop(New 문서 id)
      def __init__(self, client: TestClient) -> None: ...
  def get_map(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR, scope: str = "linked") -> dict: ...   # 200을 단언하고 json
  def edit(client: TestClient, bundle_id: int, doc_id: int, op: dict) -> httpx2.Response: ...   # POST …/documents/{doc}/edits, 본문 {"revision": 보기의 문서 revision, "confirm": False, "op": op}
  def move_out(client: TestClient, bundle_id: int, units: list[dict], code: str, reason: str = "Synthetic reason") -> None: ...   # POST …/decisions/bulk
  def add_doc(client: TestClient, bundle_id: int, file_name: str, *lines: str) -> dict: ...   # 줄마다 문단 하나인 docx를 올리고(201·ready 단언) 문서 응답을 돌려준다
  ```
  세 Bundle의 문서는 영어 줄뿐이다(한/영 코드 짝이 생기지 않는다). 시험이 줄을 더 쓰려면 `World`를 고치지 않고 `add_doc`으로 그 Bundle에 문서를 하나 더 올린다(예: `add_doc(client, w.v_id, "SYNTHETIC_OLD-7_Extra.docx", …)`) — `test_linked_map_for_a_member`의 기대값이 흔들리지 않게.
  본문은 `tests.docx_factory.build_docx("".join(p(text) for text in …))`, 올리기·보기·찾기는 `tests.sop_helpers`의 `upload`·`get_view`·`find_unit`·`put_tobe`·`set_members`·`assign_as_is`·`save_group`. 묶음 설명은 `POST /api/bundles` 본문의 `description`으로 준다.

- [ ] **Step 2: 실패하는 시험을 쓴다** — `tests/test_sop_map.py`(`pytestmark = pytest.mark.usefixtures("clean_sop")`). 시험마다 `World(client)`를 새로 만든다(모듈 범위 픽스처를 쓰지 않는다 — 같은 작업자의 다른 시험이 `clean_sop`으로 묶음을 지운다).

  ```python
  @pytest.mark.parametrize(("text", "expected"), [
      ("SOP-ABC-1016", True), ("OLD-1", True), ("WI-04", True), ("NEW-12", True),
      ("sop-abc-1016", False), ("SOP-ABC-1016A", False), ("SOP ABC 1016", False), ("see the purchasing team", False),
      ("SPIN THE SAMPLES AT 3000 RPM", False), ("", False), ("A-1", False), ("SOP-ABC-1016 ", False),
  ])
  def test_is_document_number(text, expected): assert is_document_number(text) is expected

  def test_is_temp_match_code():
      assert [is_temp_match_code(c) for c in ("NEW-12", " new-7 ", "NEW-", "NEW-1A", "SOP-NEW-1", "")] == [True, True, False, False, False, False]

  def test_linked_map_for_a_member(client):
      w = World(client)
      v, m, s, st = f"old:{w.v_doc['id']}", f"old:{w.m_doc['id']}", f"old:{w.s_doc['id']}", f"target:{w.s_sop}"
      assert get_map(client, w.v_id) == {
          "scope": "linked", "truncated": False,
          "bundles": [
              {"id": w.v_id, "code": format_bundle_code(w.v_id), "title": V_TITLE, "status": "in_progress", "relation": "self", "document_count": 1},
              {"id": w.m_id, "code": format_bundle_code(w.m_id), "title": M_TITLE, "status": "in_progress", "relation": "member", "document_count": 1},
              {"id": w.s_id, "code": format_bundle_code(w.s_id), "title": "", "status": "in_progress", "relation": "summary", "document_count": 1},
          ],
          "nodes": [
              {"id": v, "kind": "old", "bundle_id": w.v_id, "number": "OLD-1", "title": w.v_doc["title"], "doc_type": None,
               "becomes": [{"code": "SOP-CF", "title": "Synthetic SOP", "doc_type": "sop"}]},
              {"id": m, "kind": "old", "bundle_id": w.m_id, "number": "SOP-ABC-1016", "title": w.m_doc["title"], "doc_type": None,
               "becomes": [{"code": "SOP-UV", "title": "Synthetic UV SOP", "doc_type": "sop"}]},
              {"id": s, "kind": "old", "bundle_id": w.s_id, "number": "SOP-ABC-1020", "title": "Synthetic document control", "doc_type": None,
               "becomes": [{"code": "SOP-QC-99999", "title": "Synthetic calibration SOP", "doc_type": "sop"}]},
              {"id": st, "kind": "target", "bundle_id": w.s_id, "number": "SOP-QC-99999", "title": "Synthetic calibration SOP", "doc_type": "sop", "becomes": []},
              {"id": "num:SOP-ZZ-404", "kind": "num", "bundle_id": None, "number": "SOP-ZZ-404", "title": "", "doc_type": None, "becomes": []},
          ],
          "edges": sorted([
              {"source": v, "target": m, "kind": "ref", "state": "proposed", "lines": 1},
              {"source": v, "target": s, "kind": "ref", "state": "confirmed", "lines": 1},
              {"source": v, "target": "num:SOP-ZZ-404", "kind": "ref", "state": "proposed", "lines": 1},
              {"source": v, "target": st, "kind": "moved", "state": "confirmed", "lines": 1},
              {"source": m, "target": v, "kind": "ref", "state": "proposed", "lines": 1},
              {"source": s, "target": v, "kind": "ref", "state": "confirmed", "lines": 1},
              {"source": s, "target": v, "kind": "moved", "state": "confirmed", "lines": 1},
          ], key=lambda e: (e["source"], e["target"], e["kind"], e["state"])),
      }
  ```
  이 한 시험이 박는 것: 자기 참조(`REF_SELF`)와 번호 꼴 아닌 이동 코드(`MOVED_FREE`)는 선이 아니다 · 소문자와 앞뒤 빈칸 코드가 맞는다 · `moved`는 New 문서가 먼저(`target:`), 없으면 Old(`S_MOVED` → `OLD-1`) · `summary`의 제목은 `""` · 보류한 줄(`S_HOLD`)은 아무것도 만들지 않는다.

  나머지(이름과 단언):
  - `test_map_requires_membership_and_an_active_account(client, enforce, demo_access, clean_directory, monkeypatch)` — `World` 하나로 차례로: ① prod.member(S만의 구성원) → `(404, {"detail": {"code": "bundle_not_found"}})` ② `monkeypatch.setattr(settings, "app_sysadmins", "dev.admin")` 뒤 dev.admin → 같은 404 ③ `add_grant("user", "dev.admin", permission="bundle.admin")`(sysadmin 설정을 지우고) dev.admin → 같은 404 ④ 헤더 없이(dev 모드 → `dev.admin`) → 같은 404 ⑤ 없는 묶음 id(`w.s_id + 1000`) qa.member → 같은 404 ⑥ `?scope=everything` → 422, `…/bundles/0/map` → 422 ⑦ `update_row(Employee, "qa.lead", active=False)` 뒤 qa.lead → `(403, {"detail": {"code": "inactive_account"}})` ⑧ `monkeypatch.setattr(settings, "auth_mode", "keycloak")` 뒤 헤더 없이 → 401.
  - `test_author_and_reviewer_get_the_same_map(client)` — `client.get(…, headers=AUTHOR).text == client.get(…, headers=REVIEWER).text`(범위 둘 다).
  - `test_relation_follows_membership_not_permissions(client, enforce, demo_access, monkeypatch)` — ops.member(V만의 구성원)로: 그대로 / `add_grant("user", "ops.member", permission="bundle.admin")` 뒤 / `app_sysadmins = "ops.member"` 뒤 세 번 모두 `[(b["relation"], b["title"]) for b in bundles] == [("self", V_TITLE), ("summary", ""), ("summary", "")]`이고 `nodes`·`edges`는 qa.member의 것과 같다. 그리고 prod.member로 S의 지도: `[(b["id"], b["relation"], b["title"]) for b in bundles] == [(w.s_id, "self", S_TITLE), (w.v_id, "summary", "")]`.
  - `test_ref_edges_follow_read_ref_state(client)` — V에서 `REF_UV`에 `clear_ref`("참조 아님") → `v→m` 선이 없다. `REF_NONE`에 `set_ref` → 그 선의 `state`가 `"confirmed"`. 번호가 문장 가운데 있는 줄(`add_doc(…, "SYNTHETIC_OLD-7_Extra.docx", "Follow SOP-ABC-1016 for details.")`)은 표시 전에는 선이 아니고(`old:<OLD-7>`에서 나가는 선 0) `set_ref` 뒤에는 `old:<OLD-7> → m` `ref` `confirmed` `lines == 1`.
  - `test_moved_edges_need_a_confirmed_human_decision(client)` — `update_row(UnitDecision, <MOVED_OK의 unit id>, status="ai_suggested")` → `v→st` 선이 없다. `status="on_hold"`도 없다. `"confirmed"`로 되돌리면 다시 있다.
  - `test_moved_pair_counts_one_line(client)` — V에 `add_doc(…, "SYNTHETIC_OLD-7_Pair.docx", "원심분리기 덮개를 닫는다.", "Close the lid of the centrifuge.")`(기본 배치 `ko_en_interleaved`가 코드 짝을 만든다 — 보기의 `pairs`가 1개임을 먼저 단언)의 두 Unit을 한 번에 `move_out(…, code="SOP-QC-99999")` → `old:<OLD-7> → st` `moved` 선의 `lines == 1`.
  - `test_same_number_in_two_bundles_draws_both(client)` — M에도 `SYNTHETIC_SOP-ABC-1020_Twin.docx`를 올린다 → `REF_DC`의 선이 S의 문서와 M의 새 문서 **둘 다**로 간다(각 `confirmed` 1). V에 같은 번호의 문서를 하나 더 올리면(`SYNTHETIC_OLD-1_Second.docx`) `m→` 선이 V의 두 `old:` 마디 모두로 간다(Review Focus 3).
  - `test_free_text_numbers_never_become_nodes(client)` — V에 `add_doc(…, "SYNTHETIC_OLD-7_Extra.docx", "Spin the samples at 3000 rpm before reading.")`, 그 줄에 `set_ref`(번호 `"SPIN THE SAMPLES AT 3000 RPM"` — 200으로 받아들여진다) → 두 범위의 응답 본문에 `"SPIN THE"`가 없고 `old:<OLD-7>`에서 나가는 선이 0이다. `update_row(UnitDecision, <MOVED_OK의 unit id>, move_target_code="NEW-12")` → `num:NEW-12`가 없고 `v → st` 선도 없다.
  - `test_odd_document_numbers_do_not_break_the_scan(client)` — V의 문서 번호를 `PATCH`로 `"OLD_1%"`로 바꾸고 M에 `"OLDX1 Synthetic line"` 줄을 둔다 → 200, 그 줄은 선이 아니다. 번호를 `"MAP" + "-ABCDEFGH" * 10 + "-123456"`(100자)로 바꿔도 200(Review Focus 2).
  - `test_only_active_units_of_the_latest_extraction_count(client)` — `update_row(Unit, <REF_UV의 unit id>, status="retired")` → `v→m` 선이 없다. V의 문서에 `Extraction` 행을 하나 더 넣으면(그 문서의 지금 추출 행의 `extractor_version`·`aux_status`를 복사, `run_in_session`) V에서 나가는 선이 모두 없고 `becomes == []`.
  - `test_becomes_lists_confirmed_successors_sop_first(client)` — M의 `M_EXTRA`를 `assign_as_is(…, w.m_wi, wi_step=1, wi_part="instruction")`로 확정 → `m`의 `becomes == [{"code": "SOP-UV", …"sop"}, {"code": "WI-11", "title": "Synthetic UV WI", "doc_type": "wi"}]`(SOP 먼저, 그 안에서 `order_index`·id). `add_doc`으로 올린 줄을 `hold_reason`과 함께 보류로 저장한 것은 그 문서의 `becomes`에 없고(`[]`), `update_row(TargetSentence, <M_PLAIN의 새 문장 id>, status="ai_suggested")` 뒤에는 `SOP-UV`가 빠진다. (`World`에 `m_wi` — `WI-11`의 id — 를 더한다.)
  - `test_temp_code_successor_has_no_number(client)` — 새 Bundle에 `put_tobe`로 `{"code": "NEW-900001", "title": "Synthetic draft", "doc_type": "sop", "parent_code": None}` 하나를 두고 `add_doc`의 한 줄을 그리로 확정 → 그 문서 마디의 `becomes == [{"code": "", "title": "Synthetic draft", "doc_type": "sop"}]`. 다른 줄을 `move_out(…, code="NEW-900001")` → 선이 없다(`target:` 마디도 `num:NEW-900001`도 없다).
  - `test_becomes_disappears_when_the_assignment_is_cleared(client)` — `PLAIN`의 배정을 지우면(`POST …/decisions/clear`, 본문 `{"unit_id", "revision"}`) `v`의 `becomes == []`.
  - `test_bundle_without_documents_still_opens_its_map(client)` — 문서 없는 새 Bundle: `bundles`는 자기 하나(`document_count == 0`), `nodes == []`, `edges == []`(Review Focus 4).

- [ ] **Step 3: 실패를 확인한다** — `$PY -m pytest tests/test_sop_map.py -q` → import 오류(`ref_map` 없음)로 전부 FAIL.

- [ ] **Step 4: 번호 규칙 셋을 만든다** — `is_document_number`, `is_temp_match_code`(+ `equis/service.py`가 그것을 쓰게), `select_latest_extractions`. 지금 시험(`test_sop_refs.py`·`test_equis_service.py`·`test_sop_snapshot.py`)이 그대로 통과해야 한다.

- [ ] **Step 5: `ref_map.py`와 라우터를 만든다.** 질의는 표마다 한 번이고 모양·조인 순서는 맡긴다. 규칙은 아래 그대로다.

  1. **같은 종류의 Bundle과 내 구성 여부** — `Bundle.is_synthetic == ctx.bundle.is_synthetic`인 행(`id`·`title`·`status`)과 `bundle_members`에서 `login_id == ctx.login_id`인 `bundle_id` 집합. 관계: 보는 Bundle `self`, 집합에 있으면 `member`, 아니면 `summary`. **`title`을 응답 객체에 넣는 자리는 한 곳이고 거기서 `summary`면 `""`를 넣는다.**
  2. **나가는 줄**(이 Bundle): 읽힌 Old 문서의 가장 새 추출(`select_latest_extractions`)의 활성 Unit 가운데 `kind ∈ REF_KINDS` — `read_ref_state`가 읽는 것(`unit.kind`·`lang`·`text`, `mark.state`·`number`)만 싣고(`load_only`) `unit_refs`를 바깥 조인해 `read_ref_state(unit, mark)`를 그대로 부른다. 결과가 있고 `number`가 비어 있지 않으면 `MapLine(kind="ref", state=…)`. 이동은 판단 5·6의 조건으로 줄마다 `MapLine(kind="moved", state="confirmed", number=normalize_number(move_target_code))`.
  3. **들어오는 줄**(다른 Bundle, 같은 종류): 이 Bundle의 번호 = 읽힌 Old 문서의 `normalize_number(doc_code)`(빈 값 빼고) ∪ New 문서의 `normalize_number(code)`(임시 번호 빼고). ① 표시가 있는 참조: `unit_refs.number IN (번호)`인 Unit을 2와 같은 조건(활성·가장 새 추출·읽힌 Old 문서·`REF_KINDS`)으로 싣고 `read_ref_state`. ② 표시 없는 줄: **번호 가운데 `is_document_number`인 것만** `Unit.text.like(f"%{번호}%")`의 `OR`로 걸러(한 질의에 번호 50개씩) 싣고 `read_ref_state`로 다시 본다(sqlite의 `LIKE`는 대소문자를 가리지 않아 더 넓게 잡는다). ③ 이동: `func.upper(func.trim(UnitDecision.move_target_code)) IN (번호)`, `confirmed`. 세 길 모두 결과의 `number`가 이 Bundle의 번호일 때만 남긴다(①②가 같은 Unit을 두 번 싣지 않게 Unit id로 한 번).
  4. **번호 풀기**(모든 줄의 번호를 모아 두 질의 — 같은 종류의 Bundle에서 `func.upper(func.trim(Document.doc_code)) IN (…)`인 읽힌 Old 문서, `func.upper(func.trim(TargetDoc.code)) IN (…)`인 New 문서 가운데 임시 번호 아닌 것): `ref`는 맞는 Old 문서 **전부** → 없으면 맞는 New 문서 전부 → 없으면 `num`. `moved`는 New 문서 전부 → 없으면 Old 문서 전부 → 없으면 `num`. `num`은 `is_document_number(number)`이고 `is_temp_match_code`가 아닐 때만 — 아니면 그 줄을 버린다. 줄의 출발 문서와 같은 마디로 가는 것은 버린다(자기 참조).
  5. **선으로 묶기**: (출발 `old:<document_id>`, 도착 마디, kind, state)마다 줄 수.
  6. **마디**: 이 Bundle의 읽힌 Old 문서 전부 + 선이 닿는 마디. **후속 문서**는 Old 마디들에 대해 한 번 — `target_sources ⋈ target_sentences(status == "confirmed") ⋈ units(활성 · 그 문서의 가장 새 추출) ⋈ target_docs`의 서로 다른 (문서, New 문서), SOP 먼저 → `order_index` → id. `code`는 임시 번호면 `""`.
  7. **`document_count`**(실린 Bundle들의 읽힌 Old 문서 수 — 묶어 세는 질의 하나), 판단 7의 상한, 판단 8의 순서.
  8. **로그**: `logger.info("reference map built", extra={"scope": …, "bundles": n, "nodes": n, "edges": n, "elapsed_ms": n})` — 건수와 시간만.

- [ ] **Step 6: 통과를 확인한다** — `$PY -m pytest tests/test_sop_map.py tests/test_sop_refs.py tests/test_equis_service.py -q` PASS, `$PY -m ruff check app/ tests/` 깨끗.

- [ ] **Step 7: 커밋** — `feat(map): summary API for the reference map, members only, titles of other bundles withheld — 참조 지도 요약 API(구성원만, 남의 Bundle 제목은 싣지 않는다)`

---

### Task 2: 서버 — 범위 `all`, 새는지 보는 시험, 질의 수, 쓰지 않음

**Files:**
- Modify: `backend/app/sop/ref_map.py` · `backend/tests/test_sop_map.py` · `backend/CLAUDE.md`(핵심 모듈에 한 줄, "SOP 규칙 이중 사용 지점"에 한 줄)

**Interfaces:**
- Consumes: Task 1의 `collect_map_lines`·`build_reference_map`·`World`·`MARKERS`.
- Produces: `scope="all"`의 응답(같은 `MapOut`). 다음 계획이 기대는 것 — `collect_map_lines(session, bundle, "all")`이 돌려주는 줄이 범위 `all` 지도의 선과 줄 수로 꼭 맞는다.

- [ ] **Step 1: 실패하는 시험을 쓴다** — `test_sop_map.py`에 더한다.
  - `test_all_scope_lists_every_bundle_of_the_same_kind(client)` — `World`에 넷째 Bundle P(prod.member 혼자, Old 문서 `SYNTHETIC_SOP-ABC-1030_Peer.docx`, 줄 `"SOP-ABC-1020 Peer confirmed"`는 `set_ref`로 확인, 줄 `"SOP-ABC-1016 Peer proposed"`는 그대로)를 더한다. qa.member의 `scope=all`: `bundles`가 V·M·S·P 넷이고 P는 `("summary", "")`. P의 문서 마디가 있고, `p→s` `ref` `confirmed` 1 선이 **있고**, `p→m` `proposed` 선은 **없다**(남끼리의 추측은 세지 않는다). 같은 사람의 `scope=linked`에는 P도 그 선도 없다.
  - `test_linked_scope_has_no_edge_between_two_other_bundles(client)` — 위 자료의 `linked` 응답에서 모든 선의 한쪽 끝이 V의 마디다.
  - `test_synthetic_and_real_bundles_never_share_a_map(client)` — 실제 종류(`is_synthetic=False`) Bundle R(qa.member 작성자, Old 문서 `SYNTHETIC_SOP-ABC-1016_Real.docx`에 줄 `"OLD-1 Real line"`)을 더한다. V의 지도 두 범위 모두 `bundles`에 R이 없고 R의 문서 id가 든 마디·선이 없다(`REF_UV`는 M으로만 간다). R의 지도에는 R 하나뿐이고 `OLD-1`은 `num:OLD-1` 마디다.
  - `test_response_carries_only_the_listed_fields(client)` — 두 범위의 응답을 재귀로 훑어 모은 키 집합이 정확히 `{"scope", "truncated", "bundles", "nodes", "edges", "id", "code", "title", "status", "relation", "document_count", "kind", "bundle_id", "number", "doc_type", "becomes", "source", "target", "state", "lines"}`.
  - `test_no_text_of_a_non_member_bundle_leaves_the_server(client, enforce, demo_access, monkeypatch)` — 보는 사람 넷(qa.member · qa.lead · `bundle.admin`을 받은 ops.member · `app_sysadmins`에 든 ops.member) × 범위 둘의 `response.text`에 `MARKERS`의 어느 글자도 없다. 그리고 S의 구성원 prod.member의 S 지도에는 `"ZZ-BUNDLE-TITLE"`만 있고(자기 Bundle 제목) 나머지 표식은 없다 — 이 응답에는 구성원에게도 문장이 없다. V의 표식 아닌 글(`"Operation of UV"` · `"Calibrate the rotor"` · `"Balance the tubes"`)도 prod.member의 응답에 없다.
  - `test_query_count_does_not_grow_with_bundles(client)` — `test_sop_review.py`의 `_count_queries`와 같은 방식(`event.listen(engine.sync_engine, "before_cursor_execute", …)`)으로 `World`(Bundle 3개)에서 `ref_map`이 낸 질의 수를 범위마다 세고, V를 가리키는 줄 하나짜리 Old 문서를 가진 Bundle 9개를 더한 뒤 다시 센다 → 두 수가 같고 `MAX_MAP_STATEMENTS = 20` 이하다. 의존성(구성원 판정)의 질의가 섞이지 않게 `run_in_session`으로 `build_reference_map`을 직접 부른다.
  - `test_reading_the_map_writes_nothing(client)` — 두 범위를 읽기 전후로 `bundle_events` 행 수, 세 Bundle의 `revision`·`updated_at`, 세 문서의 `revision`이 같다.
  - `test_map_is_cut_at_the_node_cap(client, monkeypatch)` — `monkeypatch.setattr(ref_map, "MAX_NODES", 2)` → `truncated is True`, `nodes`는 2개이고 첫째가 V의 문서, 모든 선의 두 끝이 남은 마디다. `MAX_EDGES = 1`이면 선 하나(한쪽 끝이 V).

- [ ] **Step 2: 실패를 확인한다** — 새 시험 가운데 `all`·상한 시험이 FAIL.

- [ ] **Step 3: `collect_map_lines`와 `build_reference_map`에 범위 `all`을 더한다.** `linked`의 줄에 더해: 같은 종류의 다른 Bundle들의 **확정** 줄 전부 — `lang == "ref"`인 Unit(활성·가장 새 추출·읽힌 Old 문서·`REF_KINDS`)을 `unit_refs` 바깥 조인으로 실어 `read_ref_state`(글은 이 `ref` 줄에서만 읽는다), 그리고 `move_external`·`confirmed` 판단. 남의 Bundle의 `proposed`는 `linked`가 이미 모은 것(도착이 이 Bundle의 번호)뿐이다. 같은 Unit을 두 번 싣지 않는다. 마디는 같은 종류의 모든 Bundle의 읽힌 Old 문서 전부 + 선이 닿는 마디, `bundles`는 판단 9.

- [ ] **Step 4: 통과를 확인한다** — `$PY -m pytest tests/test_sop_map.py -q` PASS, `$PY -m pytest tests/ -q -n auto` PASS(`test_migrations.py` 포함 — 모델을 건드리지 않았다), ruff 깨끗.

- [ ] **Step 5: `backend/CLAUDE.md`** — 핵심 모듈의 `app/sop/` 문단 끝에 "참조 지도 `ref_map.py`(`routers/sop_map.py` — 읽기 전용, 줄 모으기 `collect_map_lines` → 선 묶기 `build_reference_map`. 구성원 아닌 Bundle은 번호·제목·상태·후속 문서·줄 수만, Bundle 제목과 문장은 싣지 않는다 — 응답 필드는 계획 `2026-11-17-reference-map-plan.md`의 가시성 행렬에 있는 것만)" 한 줄. "SOP 규칙 이중 사용 지점"에 "**참조 판정·번호 꼴 `refs.read_ref_state`·`is_document_number`**: 지도(`ref_map.py`)는 문서 보기와 같은 함수를 부른다 — 지도에 둘째 판정을 쓰지 않는다. 임시 번호는 `tobe.is_temp_match_code` 한 곳." 한 줄.

- [ ] **Step 6: 커밋** — `feat(map): All Bundles scope, leak sweep and a fixed query count — 모든 Bundle 범위, 새는지 보는 시험, Bundle 수와 무관한 질의 수`

---

### Task 3: 시드 — Bundle 사이 참조(데모와 극단)

**Files:**
- Modify: `backend/scripts/seed_sop_demo.py` · `backend/scripts/seed_sop_worst.py` · `backend/tests/test_seed_sop_demo.py` · `frontend/scripts/pw-layout-audit.mjs`(`loadIds`·`checkIds`와 머리말의 ids 지도 설명만) · 시드가 만드는 묶음 수를 적은 글(`git grep -n "묶음 4개\|묶음 네 개\|43\b.*bundles\|47개"`로 찾아 시드 설명인 곳만: `seed_sop_demo.py`·`seed_sop_worst.py` 머리말, 루트 `CLAUDE.md` Commands 주석, `docs/qa/verification-commands.md`, `pw-smoke-sop.mjs` 머리말 둘째 줄)

**Interfaces:**
- Consumes: Task 1·2의 API(시드는 앱 API만 부른다), `tests.sop_helpers`(`AUTHOR`·`OUTSIDER`·`create_bundle`·`set_members`·`put_tobe`·`upload`·`get_view`·`find_unit`·`assign_as_is`), `tests.docx_factory.build_docx`·`p`, `scripts.synthetic_sop.MOVE_TARGET_CODE`.
- Produces: 데모 DB의 Bundle 5·6, 극단 DB의 `SYNTHETIC M1 map` … `M8`. `pw-layout-audit.mjs`의 `ids.mid[5]`(데모 5번)와 `ids.m[1..8]`(극단 — qa.member가 구성원인 것만 값이 있다: 1~5).

- [ ] **Step 1: 실패하는 시험을 쓴다** — `tests/test_seed_sop_demo.py`. **이 계획이 허락하는 기대값 수정**: `EXPECTED_BUNDLES`에 `("SYNTHETIC 5 UV 분광광도계", "in_progress")`·`("SYNTHETIC 6 문서 관리", "in_progress")` 두 줄을 끝에 더하고, `test_seed_creates_bundles_at_stages`의 문서 수 단언을 `[(bundle_id, DOCUMENTS_PER_BUNDLE) for bundle_id in ids[:4]] + [(ids[4], 1), (ids[5], 1)]`로 바꾼다(다른 단언은 그대로 — `skipped` 수는 `len(EXPECTED_BUNDLES)`로 6이 된다). 새 시험 `test_seed_links_bundles_for_the_map(seed_runs)`:
  - `bundle_members`: `ids[4]` → `[("qa.lead", "reviewer"), ("qa.member", "author")]`, `ids[5]` → `[("prod.member", "author")]`.
  - `documents`의 `(bundle_id, doc_code)`에 `(ids[4], "SOP-ABC-1016")`·`(ids[5], "SOP-ABC-1020")`, `target_docs`의 `(bundle_id, code)`에 `(ids[4], "SOP-UV")`·`(ids[4], "WI-11")`·`(ids[5], MOVE_TARGET_CODE)`.
  - `SELECT count(*) FROM unit_refs r JOIN units u ON u.id = r.unit_id JOIN extractions e ON e.id = u.extraction_id JOIN documents d ON d.id = e.document_id WHERE r.state = 'confirmed' AND d.bundle_id IN (ids[4], ids[5])` → `2`.
  - 시드의 출력(`first.stdout`)에 지도용 Bundle의 제목 둘이 있고 문장 글(`"Warm up the lamp"`)은 없다.

- [ ] **Step 2: 실패를 확인한다** — `$PY -m pytest tests/test_seed_sop_demo.py -q` → 묶음 수에서 FAIL.

- [ ] **Step 3: 데모 시드에 지도용 Bundle 둘을 더한다** — `seed_sop_demo.py`에 `MAP_BUNDLES`(제목 둘)와 `seed_map_bundles(client) -> dict[str, str]`(제목 → `"created"`|`"skipped"`). 단계 Bundle 넷이 끝난 **뒤에** 부르고 요약 출력에 그 두 줄(제목 · created/skipped)을 더한다. 있는지는 제목으로 본다 — 5번은 `AUTHOR`의 목록, 6번은 `OUTSIDER`의 목록(작성자에게는 보이지 않는다). 만들다 실패하면 그 Bundle을 지우고 다시 던진다(`drive_stage`와 같다). 머리말을 "묶음 네 개 + 지도용 둘"로 고친다.

  | Bundle | 구성원 | New 문서 | Old 문서 | 줄과 처리 |
  |---|---|---|---|---|
  | `SYNTHETIC 5 UV 분광광도계` | qa.member 작성자 · qa.lead 검토자 | `SOP-UV` "SYNTHETIC UV spectrophotometer" · `WI-11` "SYNTHETIC UV lamp check"(부모 `SOP-UV`, step 1 "Check the lamp") | `SYNTHETIC_SOP-ABC-1016_UV_spectrophotometer.docx` | `"OLD-1 Operation of the QC centrifuge"`(그대로 → REF?) · `"OLD-2 Rotor cleaning"`(`set_ref`로 확인) · `"Warm up the lamp for thirty minutes before reading."`(→ `SOP-UV` `slot_key="procedures.procedure"` 확정) · `"Check the lamp hours on the display."`(→ `WI-11` `wi_step=1` `wi_part="instruction"` 확정) |
  | `SYNTHETIC 6 문서 관리` | 작성자 헤더로 만들고 끝에 `set_members(…, [("prod.member", "author")])` | `MOVE_TARGET_CODE`(`SOP-QC-99999`) "SYNTHETIC equipment calibration" | `SYNTHETIC_SOP-ABC-1020_Document_control.docx` | `"OLD-1 Operation of the QC centrifuge"`(`set_ref`로 확인) · `"OLD-3 Synthetic separate layout"`(그대로) · `"Keep the calibration certificate with the record."`(→ `SOP-QC-99999` `slot_key="purpose"` 확정) |

  이렇게 되면 데모 Bundle 1~4의 OLD-1이 `SOP-ABC-1016`(5번, `member`)을 가리키고, 답을 저장한 단계(2·3번)의 이동 줄이 6번의 New 문서(`summary`)로 가며, 5·6번이 OLD-1·2·3을 가리킨다.

- [ ] **Step 4: 극단 시드에 지도용 Bundle 여덟을 더한다** — `seed_sop_worst.py`의 `WorstSeeder.create_map_bundles()`(`create_bundles` 끝, `check_validation_limits` 앞에서 부르고 제목 접두 `SYNTHETIC M<n> map`으로 건너뛰기를 본다. `created`·`skipped`에 센다 — 끝 줄의 수는 51이 된다, 머리말도 고친다). 문서는 `build_docx`로 만든 작은 docx다(문서마다 줄 3~8개).
  - **M1**(보는 Bundle, qa.member 작성자 · qa.lead 검토자): Old 문서 13개 `MAP-101` … `MAP-113`. **M2~M5**: qa.member가 구성원(작성자). **M6~M8**: 끝에 prod.member 혼자로 갈아 끼운다(`summary`). 각 13개(`MAP-<n>01` … `MAP-<n>13`) — 모두 104개.
  - **선 170개 이상**: 문서마다 다른 Bundle의 문서 번호로 시작하는 줄 둘(하나는 `set_ref`로 확인, 하나는 그대로) + 문서 넷에 하나는 `move_external`(다른 Bundle의 New 문서 번호).
  - **극단 값**(M1에 모은다): 번호 100자(`"MAP" + "-ABCDEFGH" * 10 + "-123456"` — `PATCH`로 `doc_code`) · 제목이 공백 없는 200자 · 빈 제목(`PATCH` `title: ""`) · 번호 없는 문서(파일 이름에 번호 없음) · M2에도 올린 같은 번호 `MAP-101` · 다른 Bundle의 문서 30개가 `MAP-101`을 가리킨다 · `MAP-102`는 줄 40개가 서로 다른 번호 40개를 가리킨다 · 어느 Bundle에도 없는 번호 다섯(`MAP-901` … `MAP-905`) · 후속 문서가 임시 번호뿐인 문서(New 문서 `NEW-900001` "SYNTHETIC temp successor"에 한 줄 확정) · 후속 문서가 6개인 문서(여섯 줄을 여섯 SOP로) · 1,800자 참조 줄(`"MAP-201 " + long_text(1790, "en")`, `set_ref`로 확인) · 번호 꼴이 아닌 이동 코드(`"see the other team"`) 하나.
  - 문서 없는 Bundle은 지금의 W7을 쓴다(더하지 않는다).

- [ ] **Step 5: `pw-layout-audit.mjs`의 id 지도** — `loadIds`: `for (let n = 1; n <= 5; n += 1) ids.mid[n] = findByPrefix(\`SYNTHETIC ${n} \`)`, 그리고 `ids.m = {}`에 `SYNTHETIC M${n} map`(n = 1..8, 보이는 것만). `known`에 `ids.m`의 값도 넣어 `ids.light`가 지금과 같은 36개로 남게 한다. `checkIds`: `mid`는 1~5, `worst`는 `m 1`도 있어야 한다. 머리말의 ids 지도 설명에 두 줄을 더한다. 지금의 감사 항목은 고치지 않는다.

- [ ] **Step 6: 통과와 시드를 확인한다** — `$PY -m pytest tests/test_seed_sop_demo.py -q` PASS. 버려도 되는 DB에 `reset_db → seed_sop_demo → seed_sop_worst`를 돌려 끝 줄이 `worst seed done: 51 bundles`이고 실패 0. backend를 띄워 `curl -s -H "X-Dev-User: qa.member" "http://localhost:8787/api/bundles/<M1 id>/map?scope=all"`의 `nodes` 수 ≥ 100, `edges` 수 ≥ 170임을 본다(수를 PROGRESS에 적는다). 갓 시드한 데모 DB에서 지금의 전체 스모크가 Task 시작 전과 같은 결과인지 본다(지도용 Bundle 둘이 다른 단계를 깨지 않는다 — 기준선의 실패 수를 먼저 적어 둔다).

- [ ] **Step 7: 커밋** — `chore(seed): cross-bundle references for the map, in the demo and the worst-case seed — 데모·극단 시드에 Bundle 사이 참조`

---

### Task 4: 화면의 바탕 — `--peer-*` 토큰, API 타입, 순수 모델 `map-model`

**Files:**
- Create: `frontend/src/lib/map-model.ts` · `frontend/src/lib/map-model.test.ts`
- Modify: `frontend/src/styles/tokens.css` · `frontend/src/lib/api-sop.ts`(파일 끝에 지도 절)

**Interfaces:**
- Consumes: `apiFetch`, `BundleStatus`(`api-sop`), `getEditOriginalHref`(`stages`).
- Produces:

```css
/* tokens.css — 앞의 둘은 :root 색 토큰의 REF 줄 아래, 뒤의 둘은 파생 토큰 자리(--lang-ref-line 아래). 다크 블록에는 더하지 않는다(잉크·표면에서 나온다) */
/* Peer: another Bundle's work on the reference map. Neutral graphite, never the accent (decided 2026-11-16). */
--peer-ink: var(--ink-2);
--peer-fill: var(--ink-4);
--peer-bg: color-mix(in oklab, var(--peer-fill) 12%, var(--surface));
--peer-line: color-mix(in oklab, var(--peer-fill) 55%, var(--surface));
```

```ts
// api-sop.ts
export type MapScope = "linked" | "all";
export type MapRelation = "self" | "member" | "summary";
export interface MapBundle { id: number; code: string; /** summary면 빈 글 */ title: string; status: BundleStatus; relation: MapRelation; document_count: number }
export interface MapBecomes { /** 임시 번호면 빈 글 */ code: string; title: string; doc_type: "sop" | "wi" }
export interface MapNode { id: string; kind: "old" | "target" | "num"; bundle_id: number | null; number: string; title: string; doc_type: "sop" | "wi" | null; becomes: MapBecomes[] }
export interface MapEdge { source: string; target: string; kind: "ref" | "moved"; state: "confirmed" | "proposed"; lines: number }
export interface RefMap { scope: MapScope; truncated: boolean; bundles: MapBundle[]; nodes: MapNode[]; edges: MapEdge[] }
export function getRefMap(bundleId: number, scope: MapScope): Promise<RefMap>;   // GET `/bundles/${bundleId}/map?scope=${scope}`

// map-model.ts
export interface MapFilters { proposedOnly: boolean; showMoved: boolean; query: string }
export const DEFAULT_FILTERS: MapFilters;                       // { proposedOnly: false, showMoved: true, query: "" }
export interface MapView { scope: MapScope; selfId: number; bundles: MapBundle[]; nodes: MapNode[]; edges: MapEdge[]; hasQuery: boolean; matches: ReadonlySet<string> }
/** 거르기를 건 지도 - 선이 사라지면 그 선에만 기대던 마디·Bundle도 함께 빠진다 */
export function buildMapView(data: RefMap, filters: MapFilters): MapView;
export function compareNumbers(a: string, b: string): number;   // 숫자를 수로 읽는 자연 정렬(로캘 "en" 고정), 빈 번호는 끝
export type EdgeLabel = "confirmed" | "proposed" | "moved";     // 화면의 상태 이름 - kind가 moved면 moved, 아니면 state
export function getEdgeLabel(edge: Pick<MapEdge, "kind" | "state">): EdgeLabel;
export function getEdgeKey(edge: MapEdge): string;              // `${source}>${target}:${kind}:${state}`
export interface MapRow { key: string; from: MapNode; to: MapNode; label: EdgeLabel; lines: number; /** 맞은편 Bundle - 없으면 null(어느 Bundle에도 없음) */ bundle: MapBundle | null; /** 줄을 누르면 고르는 마디 */ pickId: string }
export function listMapRows(view: MapView): MapRow[];
export interface SelfSummary { citesLines: number; citesDocs: number; citedByLines: number; citedByBundles: number; toCheck: number; noOwner: number; hasEdges: boolean }
export function summarizeSelf(data: RefMap): SelfSummary;
export interface NodeLink { nodeId: string; number: string; label: EdgeLabel; lines: number }
export type BecomesState = "list" | "undecided" | "noSuccessor" | "nobody" | "none";
export interface NodeDetail { node: MapNode; bundle: MapBundle | null; relation: MapRelation | null; becomesState: BecomesState; /** Review complete 전이라 바뀔 수 있다 */ tentative: boolean; cites: NodeLink[]; citedBy: NodeLink[]; /** 그 Bundle의 Assign에서 이 문서를 여는 주소 - 갈 수 없으면 null */ assignHref: string | null }
export function describeNode(data: RefMap, nodeId: string): NodeDetail | null;
/** 마디 첫 줄의 꼬리표 - 첫 후속 문서의 번호(없으면 제목)와 나머지 수. 후속 문서가 없으면 null */
export function formatBecomes(node: Pick<MapNode, "becomes">): { first: string; more: number } | null;
/** 범위 all로 들어갈 때 접어 둘 줄기의 열쇠 - 이 Bundle과 선으로 이어지지 않은 Bundle(와 keep은 뺀다) */
export function listCollapsedAtStart(data: RefMap, keep?: string | null): string[];
export function getLaneKey(bundleId: number | null): string;    // String(id) | "none"
```

- 규칙: **`buildMapView`** — 선은 `proposedOnly`면 `state === "proposed"`만, `showMoved`가 꺼지면 `kind === "moved"`를 뺀다. 마디는 이 Bundle의 `old` 전부 + 남은 선이 닿는 마디 + (범위 `all`이면 모든 `old` 마디). Bundle은 `self`와 마디가 남은 것. `matches`는 `query.trim()`이 있을 때 번호나 제목에 그 글이 든 마디(`toLowerCase()`로 견준다). **`listMapRows`** — 순서는 이 Bundle에서 나가는 선 → 들어오는 선 → 남끼리의 선, 그 안에서 `compareNumbers(from.number)` → `compareNumbers(to.number)` → 확인 · REF? · Moved to. `bundle`은 나가는 선이면 도착 쪽, 들어오는 선이면 출발 쪽, 남끼리는 도착 쪽의 Bundle. `pickId`는 이 Bundle 것이 아닌 쪽(둘 다 이 Bundle이면 도착). **`summarizeSelf`**(거르지 않은 자료로) — `citesLines`·`citesDocs`는 출발이 이 Bundle인 선의 줄 수 합과 서로 다른 도착 마디 수, `citedByLines`·`citedByBundles`는 도착이 이 Bundle이고 출발이 남인 선의 줄 수 합과 서로 다른 출발 Bundle 수, `toCheck`는 출발이 이 Bundle인 `proposed` 선의 줄 수 합, `noOwner`는 출발이 이 Bundle인 선이 닿는 `num` 마디 수. **`describeNode`** — `becomesState`: `target`이면 `"none"`, `num`이면 `"nobody"`, 후속 문서가 있으면 `"list"`, 없고 그 Bundle이 `done`이면 `"noSuccessor"`, 아니면 `"undecided"`. `tentative`는 `"list"`이고 그 Bundle이 `done`이 아닐 때. `assignHref`는 `kind === "old"`이고 `relation`이 `self`·`member`일 때만 `getEditOriginalHref(bundle.id, 문서 id)`. `cites`·`citedBy`는 `compareNumbers(number)` → 확인 · REF? · Moved to 순.

- [ ] **Step 1: 실패하는 시험을 쓴다** — `map-model.test.ts`. 자료 `MAP`(범위 `linked`):
  - `bundles`: `{ id: 12, code: "BND-0012", title: "SYNTHETIC 원심분리기", status: "in_progress", relation: "self", document_count: 4 }` · `{ id: 15, …, title: "SYNTHETIC UV", status: "in_review", relation: "member", document_count: 3 }` · `{ id: 18, code: "BND-0018", title: "", status: "done", relation: "summary", document_count: 2 }`.
  - `nodes`: `old:101` OLD-1 "SYNTHETIC 원심분리기 운전"(12, becomes `[SOP-CF, WI-01]`) · `old:102` OLD-2(12) · `old:110` OLD-10(12) · `old:199` 번호 `""`(12) · `old:140` SOP-ABC-1016 "UV spectrophotometer"(15, becomes `[SOP-UV]`) · `old:160` SOP-ABC-1020(18, becomes `[]`) · `target:77` SOP-LOG(18, `doc_type: "sop"`) · `num:SOP-ZZ-404`.
  - `edges`: `101→140 ref proposed 1` · `101→140 ref confirmed 2` · `102→target:77 moved confirmed 2` · `160→101 ref confirmed 3` · `110→num:SOP-ZZ-404 ref proposed 1` · `101→102 ref confirmed 1`.

  시험(이름 — 단언):
  - "keeps everything with the default filters" — `buildMapView(MAP, DEFAULT_FILTERS)`의 마디 8 · 선 6 · Bundle 3, `hasQuery === false`, `matches.size === 0`.
  - "REF? only keeps proposed edges and drops the nodes and bundles that lose every edge" — 선 열쇠 `["old:101>old:140:ref:proposed", "old:110>num:SOP-ZZ-404:ref:proposed"]`, 마디 id `["old:101", "old:102", "old:110", "old:199", "old:140", "num:SOP-ZZ-404"]`(순서는 자료 순), Bundle id `[12, 15]`.
  - "hiding Moved to drops the moved edge and its target node, not the bundle that is still cited from" — 선 5, `target:77` 없음, Bundle id `[12, 15, 18]`.
  - "in the All Bundles scope other bundles keep their documents without an edge" — `{ ...MAP, scope: "all" }`에 `proposedOnly` → `old:160`이 남는다.
  - "finds by number or title, ignoring case, and by Korean title" — `query: "abc-1016"` → `matches`가 `{"old:140"}`, `"원심"` → `{"old:101"}`, `"  "` → `hasQuery === false`, `"("`·`"[a-"`·`"\\"` → 예외 없이 `matches.size === 0`이고 `hasQuery === true`(Review Focus 5).
  - "compareNumbers reads digits as numbers and puts the empty number last" — `["OLD-10", "", "OLD-2", "OLD-1"].sort(compareNumbers)` → `["OLD-1", "OLD-2", "OLD-10", ""]`.
  - "lists rows: out of this bundle, then into it" — `listMapRows(view).map((r) => [r.from.number, r.to.number, r.label, r.lines, r.bundle?.id ?? null, r.pickId])` → `[["OLD-1", "OLD-2", "confirmed", 1, 12, "old:102"], ["OLD-1", "SOP-ABC-1016", "confirmed", 2, 15, "old:140"], ["OLD-1", "SOP-ABC-1016", "proposed", 1, 15, "old:140"], ["OLD-2", "SOP-LOG", "moved", 2, 18, "target:77"], ["OLD-10", "SOP-ZZ-404", "proposed", 1, null, "num:SOP-ZZ-404"], ["SOP-ABC-1020", "OLD-1", "confirmed", 3, 18, "old:160"]]`.
  - "summarizes this bundle" — `summarizeSelf(MAP)` → `{ citesLines: 7, citesDocs: 4, citedByLines: 3, citedByBundles: 1, toCheck: 2, noOwner: 1, hasEdges: true }`. 선이 없는 자료 → 모두 0이고 `hasEdges: false`. 마디도 없는 자료 → 예외 없음(Review Focus 4).
  - "describes a document of this bundle" — `describeNode(MAP, "old:101")` → `relation: "self"`, `becomesState: "list"`, `tentative: true`, `assignHref: "/bundles/12/assign?edit=101"`, `cites`의 `[nodeId, label, lines]`가 `[["old:102", "confirmed", 1], ["old:140", "confirmed", 2], ["old:140", "proposed", 1]]`, `citedBy`가 `[["old:160", "confirmed", 3]]`.
  - "gives no way into a bundle the viewer is not a member of" — `"old:160"` → `relation: "summary"`, `assignHref: null`, `becomesState: "noSuccessor"`(그 Bundle이 `done`), `tentative: false`. `"old:140"` → `relation: "member"`, `assignHref: "/bundles/15/assign?edit=140"`, `tentative: true`.
  - "names the three empty successor states" — `old:102`(작업 중, 후속 없음) → `"undecided"`, `num:SOP-ZZ-404` → `"nobody"`·`bundle: null`·`relation: null`·`assignHref: null`, `target:77` → `"none"`·`assignHref: null`. 없는 id → `null`.
  - "formats the successor tag" — `formatBecomes(old:101)` → `{ first: "SOP-CF", more: 1 }`, 임시 번호뿐(`[{ code: "", title: "Draft", doc_type: "sop" }]`) → `{ first: "Draft", more: 0 }`, `[]` → `null`.
  - "starts the All Bundles scope with unlinked lanes collapsed" — 범위 `all` 자료에 이어지지 않은 Bundle 21·22를 더하면 `listCollapsedAtStart(data)` → `["21", "22"]`, `listCollapsedAtStart(data, "22")` → `["21"]`.

- [ ] **Step 2: 실패를 확인한다** — `npx vitest run src/lib/map-model.test.ts` → 모듈 없음으로 FAIL.
- [ ] **Step 3: 토큰 넷, `api-sop.ts`의 타입과 `getRefMap`, `map-model.ts`를 만든다.**
- [ ] **Step 4: 통과를 확인한다** — `npx vitest run src/lib/map-model.test.ts` PASS, `npm run lint && npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: 커밋** — `feat(map): peer tokens, API types and the pure model for filters, rows and the side panel — --peer-* 토큰, API 타입, 거르기·표·옆 칸 순수 모델`

---

### Task 5: 화면 — Map 레일 · 도구 줄 · List · 옆 칸, 문구와 설명서

**Files:**
- Create: `frontend/src/app/bundles/[id]/map/page.tsx` · `frontend/src/components/map/map-toolbar.tsx` · `map-list.tsx` · `map-side.tsx` · `frontend/src/styles/map.css`
- Modify: `frontend/src/lib/stages.ts` · `frontend/src/components/stage-nav.tsx` · `frontend/src/lib/manual.ts` · `frontend/src/lib/page-width.ts` · `frontend/src/styles/components.css`(`.stg[data-stage="history"]` 두 줄의 선택자를 `map`으로) · `frontend/src/app/globals.css`(`@import "../styles/map.css";`) · `frontend/src/lib/i18n-messages.ts` · `frontend/public/manual/user-manual.md` · `frontend/scripts/pw-smoke-sop.mjs` · `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`(§9 한 줄) · `frontend/docs/design/2026-11-07-frontend-design-foundations.md`(§5·§8 한 줄씩)
- Test(줄을 더한다): `frontend/src/lib/stages.test.ts` · `page-width.test.ts` · `manual.test.ts`

**Interfaces:**
- Consumes: Task 4 전부, `useLoaded`, `useProgressiveList`, `BundleLoadError`·`LoadError`·`EmptyState`, `BundleStatusPill`, `Tooltip`, `truncateMiddle`, `isBundleUnavailable`(`api-errors`), `getStageHref`.
- Produces(Task 7·8과 다음 계획이 쓴다):

```tsx
// page.tsx가 쥐는 상태 - 이름을 그대로 쓴다
const [scope, setScope] = useState<MapScope>("linked");
const [view, setView] = useState<"map" | "list">("list");          // Task 7이 "map"으로 바꾸고 Map · List 단추를 더한다
const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
const [selectedId, setSelectedId] = useState<string | null>(null);
const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
// components/map
export function MapToolbar(props: { scope: MapScope; filters: MapFilters; view: "map" | "list"; canSearchAll: boolean; isLoading: boolean; onScope(scope: MapScope): void; onFilters(next: MapFilters): void; onSearchEnter(): void; onSearchAll(): void; onRefresh(): void; children?: ReactNode /* Task 7·8이 Map · List와 확대 단추를 넣는 자리 */ }): JSX.Element;
export function MapList(props: { view: MapView; selectedId: string | null; onPick(nodeId: string): void; onClear(): void }): JSX.Element;
export function MapSide(props: { data: RefMap; selectedId: string | null; onPick(nodeId: string): void; onClear(): void }): JSX.Element;   // 다음 계획이 Cites · Cited by 줄 아래에 문장을 넣는다
```

- `data-testid`: 화면 `map`, 도구 줄 `map-search` · `map-search-all` · `map-scope-linked` · `map-scope-all` · `map-filter-proposed` · `map-filter-moved` · `map-refresh`, 알림 `map-truncated`, 표 `map-list` · 줄 `map-row-<순번>`(`data-source`·`data-target`·`data-label`도 단다), 빈 상태 `map-empty-docs` · `map-empty-filtered` · `map-empty-clear`, 옆 칸 `map-side` · `map-side-summary` · `map-side-no-refs` · `map-side-legend` · `map-side-node` · `map-side-owner` · `map-side-number` · `map-side-title` · `map-side-bundle` · `map-side-status` · `map-side-becomes` · `map-side-cites` · `map-side-cited-by` · `map-side-link-<맞은편 마디 id>-<label>` · `map-side-open-assign` · `map-side-not-member` · `map-side-clear`, 오류 `map-missing`·`map-error`·`map-retry`(`BundleLoadError testId="map"`).

- 문구(en · ko) — 설계 §8의 표에서 이 계획이 쓰는 것 전부를 그 글자 그대로: `stage.map` · `map.title` · `map.search` · `map.searchAll` · `map.scope.linked` · `map.scope.all` · `map.filter.proposed` · `map.filter.moved` · `map.view.map` · `map.view.list` · `map.zoom.in` · `map.zoom.out` · `map.zoom.fit` · `map.refresh` · `map.owner.self` · `map.owner.member` · `map.owner.summary` · `map.owner.none` · `map.lane.noneSub` · `map.lane.lockTip` · `map.lane.more` · `map.lane.collapse` · `map.lane.expand` · `map.node.noNumber` · `map.node.newTag` · `map.edge.confirmed` · `map.edge.proposed` · `map.edge.moved` · `map.legend.confirmed` · `map.legend.proposed` · `map.legend.moved` · `map.side.bundle` · `map.side.status` · `map.side.becomes` · `map.side.cites` · `map.side.citedBy` · `map.side.undecided` · `map.side.noSuccessor` · `map.side.nobody` · `map.side.tentative` · `map.side.notMember` · `map.side.openAssign` · `map.side.clear` · `map.sum.cites` · `map.sum.citedBy` · `map.sum.toCheck` · `map.sum.noOwner` · `map.sum.hint` · `map.list.from` · `map.list.to` · `map.list.becomes` · `map.list.bundle` · `map.list.state` · `map.list.lines` · `map.empty.noDocs` · `map.empty.noDocsBody` · `map.empty.noRefs` · `map.empty.noRefsBody` · `map.empty.filtered` · `map.empty.clear` · `map.truncated`. (`map.side.hidden` · `map.side.moreLines` · `map.lines.error` · `map.assign.gone`은 다음 계획이 더한다.) **설계에 없어 더하는 것**:

  | 키 | en | ko |
  |---|---|---|
  | `map.lane.docs` | {n} documents | 문서 {n}개 |
  | `map.lines.count` | {n} lines | 줄 {n}개 |
  | `map.sum.out` | This Bundle cites | 이 Bundle이 가리키는 것 |
  | `map.sum.in` | Other Bundles cite this Bundle | 다른 Bundle이 가리키는 것 |
  | `map.side.legend` | Lines | 선 |
  | `map.canvas.label` | Reference map. Use the arrow keys to move between documents. | 참조 지도. 화살표 글쇠로 문서 사이를 옮깁니다. |

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - `stages.test.ts`에 더한다: "puts Map right before History, without a step number" — `STAGES.map((s) => s.key)` → `["overview", "documents", "assign", "order", "outputs", "map", "history"]`, `STAGES.find((s) => s.key === "map")` → `{ key: "map", path: "/map", ready: true }`, `parseBundlePath("/bundles/3/map")` → `{ bundleId: 3, stage: "map" }`, `getStageHref(4, "map")` → `"/bundles/4/map"`. "keeps Map open without documents" — `isStageLocked("map", 0)` → `false`. (지금의 "numbers four rail steps" 시험은 그대로 통과한다.)
  - `page-width.test.ts`의 표에 `["/bundles/1/map", "desk"]` 한 줄.
  - `manual.test.ts`에 더한다: `getManualHref("/bundles/1/map")` → `"/manual#map"`, `getSectionStage("map")` → `"map"`.
  - 스모크 — 파일 끝에 더한다. 먼저 `grep -n "stage-nav-history\|data-stage" scripts/pw-smoke-sop.mjs`로 레일의 항목 순서나 수를 보는 단언이 있는지 찾고, 있으면 그 줄만 `map`을 넣어 고친다(지금 본 바로는 번호 붙은 넷만 본다 — 고칠 것이 없으면 건드리지 않는다). 도우미 `openMap(page, bundleId)`(주소로 들어가 `map`을 기다린다)와 `openMapList(page)`(`map-view-list`가 있으면 누른다 — Task 7 뒤에도 같은 단계가 돈다)를 둔다. 묶음 id는 목록의 제목으로 잡는다(`분류 절반` · `UV 분광광도계`, prod.member는 `문서 관리`).
    1. **`map: the rail opens Map and the List shows this bundle's references`**(qa.member, `분류 절반`) — 개요에서 `stage-nav-map`을 누르면 주소가 `/map`으로 끝나고 `aria-current="page"`다. 레일에서 `map`이 `history` 바로 앞이고 `history`가 여전히 맨 아래다(두 항목의 `getBoundingClientRect().top` 순서, 상단 2단 배치에서는 `left`). 같은 사람의 `GET /api/bundles/{id}/map` 응답을 받아(`page.request`, `X-Dev-User`) `map-row-*` 수가 `edges.length`와 같고, From `OLD-1` · To `SOP-ABC-1016`인 줄이 있다. `map-side-summary`의 글에 응답으로 셈한 줄 수(출발이 이 Bundle인 선의 `lines` 합)가 들어 있다.
    2. **`map: filters, search and scope on the List`** — `map-filter-proposed`를 누르면 모든 줄의 `data-label`이 `proposed`이고 다시 누르면 처음 수로 돌아온다. `map-filter-moved`를 끄면 `data-label="moved"` 줄이 0. `map-search`에 `abc-1016`을 넣으면 줄이 그 번호가 든 것만 남고, Enter를 누르면 `map-side-number`가 `SOP-ABC-1016`이다. `zz-nothing`을 넣으면 `map-empty-filtered`와 `map-search-all`이 보이고, `map-empty-clear`를 누르면 처음 수로 돌아온다. `map-scope-all`을 누르면 `?scope=all` 요청이 나가고 줄 수가 그 응답의 `edges.length`다. `/`를 누르면 `map-search`가 포커스를 받는다.
    3. **`map: selecting a document shows what it becomes; a member bundle opens in Assign`** — From `OLD-1` · To `SOP-ABC-1016` 줄을 누르면 `map-side-owner`가 "Other Bundle · member", `map-side-bundle`에 5번의 코드와 제목, `map-side-becomes`에 `SOP-UV`와 `WI-11`, 그 아래 "May change until the Bundle is Review complete". `map-side-open-assign`의 `href`가 `/bundles/<5번>/assign?edit=<그 문서 id>`이고 누르면 Assign의 Old 칸이 그 문서를 연다(`assign-bar`가 뜨고 주소에서 `edit`가 떼인다). Esc와 `map-side-clear`가 고름을 푼다.
    4. **`map: a non-member sees numbers only, on screen and in the response`**(`devUser: "prod.member"`, `문서 관리`) — `page.waitForResponse`로 잡은 `…/map` 응답 글에 `"쪼개기 직후"` · `"분류 절반"` · `"검토 대기"` · `"Operation of UV"` · `"Operation of the QC"`가 없다(남의 Bundle 이름도, 남의 문장도, 자기 문장도 이 응답에는 없다). To가 `OLD-1`인 줄을 눌러 `map-side-owner`가 "Other Bundle · summary only", `map-side-bundle`의 글이 `BND-` 코드뿐이고(한글이 없다), `map-side-open-assign`이 0개, `map-side-not-member`가 보인다.
    5. **`map: a sysadmin who is not a member cannot open it, and losing access clears the screen`**(`devUser: "dev.admin"`) — `/bundles/<분류 절반 id>/map`이 `map-missing`을 보이고 `page.request`의 같은 주소가 404다. 그리고 qa.member로: 지도를 연 뒤 `page.route("**/api/bundles/*/map*", (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":{"code":"bundle_not_found"}}' }))`를 걸고 `map-refresh`를 누르면 `map-missing`이 뜨고 `map-row-*`가 0개다(Review Focus 1, `allowConsoleErrors: true`).
    6. **`map: a reviewer on a bundle in review reads the same map`**(`devUser: "qa.lead"`, `검토 대기`) — `map`이 뜨고 도구 줄·표가 작성자와 같다(저장 단추·입력 양식이 없다: `map` 안의 `input`은 `map-search` 하나).

- [ ] **Step 2: 실패를 확인한다** — vitest의 새 줄 FAIL(타입 오류 포함), 스모크 `ONLY="map:"` FAIL.

- [ ] **Step 3: 레일과 길을 잇는다.** `stages.ts`: `StageKey`에 `"map"`, `STAGES`의 History 앞에 `{ key: "map", path: "/map", ready: true }`(주석: 번호 없는 보는 화면 — 문서가 없어도 잠그지 않는다. `NEEDS_DOCUMENTS`는 그대로). `stage-nav.tsx`: `import { Map as MapIcon } from "lucide-react"`, `STAGE_ICONS.map = MapIcon`, 머리 주석의 "History는 레일 맨 아래에 붙는다"를 "Map과 History는 레일 아래에 붙는다"로. `manual.ts`: `MANUAL_STAGE_SECTION.map = "map"`. `page-width.ts`: `inBundle?.stage === "assign" || inBundle?.stage === "map"`이면 `desk`. `components.css`: 두 줄의 `[data-stage="history"]`를 `[data-stage="map"]`으로.

- [ ] **Step 4: 화면을 만든다.**
  - **틀**(`page.tsx`): `<div className="map-screen" data-testid="map">` — `display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; min-height: 420px`. 아래 줄은 `grid-template-columns: minmax(0, 1fr) clamp(280px, 24vw, 420px)`(본문 | 옆 칸), 둘이 따로 스크롤한다. 자료는 `useLoaded(() => getRefMap(bundleId, scope), \`${bundleId}:${scope}\`)`. **`error`가 `isBundleUnavailable`이면 자료가 있어도 `BundleLoadError`만 그린다**(판단 29). 그 밖의 오류는 자료가 있으면 도구 줄 아래 한 줄(`LoadError compact`), 없으면 `LoadError`. 읽는 중(자료 없음)은 본문과 옆 칸에 `.sk` 쉬머. `truncated`면 본문 위에 한 줄 `map-truncated`(`map.truncated`의 `{n}`은 `nodes.length`).
  - **도구 줄**: 제목 `map.title`(`page-title`) · 찾기 칸(설명서 화면의 찾기 칸과 같은 모양 `manual-search-input`, `aria-label`과 placeholder가 `map.search`) · 범위 둘(`view-toggle`의 단추 둘, `aria-pressed`) · 거르기 둘(`chip-toggle`, `aria-pressed`) · `children` · 다시 읽기(아이콘 단추 + `Tooltip`, 읽는 동안 꺼진다). 좁으면 줄을 바꾼다(`flex-wrap`). `/`는 찾기 칸으로(글 입력 중에는 가로채지 않는다, Ctrl·⌘·Alt와 함께면 무시). 범위를 바꾸면 고름은 그 마디가 새 자료에 없을 때 푼다(판단 27).
  - **찾기와 Enter**: `filters.query`는 입력값, 그리는 데는 `useDeferredValue`. Enter는 `onSearchEnter` — 이 태스크에서는 List의 보이는 줄 순서로 맞는 마디(`view.matches`)를 차례로 고른다(Task 7이 지도 순서로 바꾼다). 범위 `linked`에서 `hasQuery`이고 맞는 것이 없으면 `canSearchAll` — **Search all Bundles** 는 범위를 `all`로 바꾼다(찾는 글은 그대로).
  - **List**(`map-list.tsx`): `hasQuery`면 From이나 To가 `matches`에 든 줄만. 판단 16의 표. From·To 칸은 번호(`font-mono`, `truncateMiddle(number, 14, 8)`, 빈 번호는 `map.node.noNumber`)와 그 아래 제목(`clamp-2`), 칸에 `data-tip`으로 전체 글. Becomes는 To 마디의 후속 문서 번호(없으면 제목)를 쉼표로, 비면 `describeNode`의 빈 상태 문구. Bundle은 코드와 제목(없으면 코드만, `null`이면 `map.owner.none`). State는 알약 — 확인 `pill quiet` · REF? `pill ref` · Moved to `pill dash`. Lines는 `.num`. 줄은 `data-link`와 `getRowOpenProps(() => onPick(row.pickId))`, 고른 마디의 줄에 `aria-selected`. 긴 표는 `useProgressiveList(rows, resetKey)`와 `LoadMoreRows`. 줄이 없으면 `map-empty-filtered`(거르기·찾기가 걸려 있을 때)나 아무것도 그리지 않는다(선이 원래 없을 때 — 옆 칸이 말한다).
  - **옆 칸**(`map-side.tsx`): 고른 것이 없으면 소유 표시 **This Bundle**, `summarizeSelf`의 네 줄(`map.sum.out` 아래 `map.sum.cites`, `map.sum.in` 아래 `map.sum.citedBy`, `toCheck > 0`이면 `map.sum.toCheck`, `noOwner > 0`이면 `map.sum.noOwner`), 선이 없으면 `map-side-no-refs`(`map.empty.noRefs`·`noRefsBody`), 안내 `map.sum.hint`, 범례 셋(작은 SVG 선 — 실선 · 짧은 점선 `3 3` · 긴 점선 `9 3 2 3` — 과 `map.legend.*`). 고르면 `describeNode`: 소유 표시(`.map-owner[data-o]`) · 번호 · 제목 · **Bundle** · **Status**(`BundleStatusPill`) · **Becomes**(목록은 번호 · 제목 · `SOP`/`WI` 꼬리표, `tentative`면 `--ink-3`과 `map.side.tentative`, 빈 상태 문구 셋, `"none"`이면 줄 없음) · **Cites n** · **Cited by n**(n은 줄 수의 합, 줄마다 단추 — 번호 · 알약 · `map.lines.count`, 누르면 `onPick`) · `assignHref`가 있으면 링크 **Open in Assign**(`<Link>` — `nav-host`가 돌린다), `relation === "summary"`면 `map-side-not-member` 한 줄(단추 없음) · **Clear selection**. Esc는 고름을 푼다.
  - **`map.css`**: `.map-owner` — `[data-o="self"]`는 `--accent-tint` 바탕·`--accent` 글자, `member`·`summary`는 `--peer-bg` 바탕·`--peer-ink` 글자·`--peer-line` 테두리, `none`은 `--ink-4` 점선 테두리·`--ink-2` 글자. 나머지는 지금 클래스(`dtable`·`pill`·`tag`·`btn`·`view-toggle`·`chip-toggle`)를 쓴다.

- [ ] **Step 5: 사용 설명서와 문서.** `user-manual.md`의 `## History {#history}` 앞에 조각을 더한다(그림 줄 없음, 화면 라벨은 영어 그대로 굵게):
  - `## Map {#map}` — 무엇을 보는 화면인가(내 문서가 가리키는 문서는 무엇으로 바뀌나 · 누가 내 문서를 가리키나 · 보낸 줄의 대상 문서는 어느 Bundle에 있나 · 가리켜지는데 아무도 맡지 않은 문서), 읽기만 하는 화면이고 고치는 일은 Assign에서 한다는 것, 표의 열 **From** · **To** · **Becomes** · **Bundle** · **State** · **Lines** 와 상태 **Confirmed** · **REF?** · **Moved to**, **Linked to this Bundle** 과 **All Bundles**, **REF? only**, **Moved to**, 찾기(<kbd>/</kbd>, <kbd>Enter</kbd>로 다음)와 **Search all Bundles**, **Read again**, 옆 칸과 **Open in Assign**, 문서가 없어도 열린다는 것, "번호 꼴이 아닌 번호(양식 번호 등)는 그 번호의 문서가 어느 Bundle에도 없으면 지도에 그리지 않습니다", 합성 Bundle과 실제 Bundle은 서로의 지도에 나오지 않는다는 것.
  - `### 남의 Bundle은 어디까지 보이나 {#map-visibility}` — "**Other Bundle · member** 는 내가 구성원인 Bundle입니다. **Other Bundle · summary only** 는 Bundle 이름 대신 코드(`BND-0018`)만 보이고, 문서 번호·제목·상태·바뀔 문서·줄 수만 보입니다. 문장을 보려면 그 Bundle의 구성원이어야 합니다." **Not in any Bundle** 의 뜻.
  - `### 바뀔 문서 읽는 법 {#map-becomes}` — 사람이 확정한 줄만 센다(AI 제안·보류는 세지 않는다), Review complete 전에는 바뀔 수 있다, **Not decided yet** · **No successor document** · **Nobody is restructuring this document** 의 뜻, 번호 없이 올린 New 문서는 제목만 보인다.
  - 고치는 곳 셋: `#assign-ref` 끝에 "가리키는 문서가 무엇으로 바뀌는지는 **Map** 에서 봅니다." 한 줄, `#roles`의 **Reviewer** 줄 끝에 "**Map** 도 작성자와 똑같이 봅니다.", `#permissions`의 "Bundle을 보고 고치는 것은 권한이 아니라 구성원 여부로 정해집니다." 뒤에 "다만 **Map** 의 요약(문서 번호·제목·상태·바뀔 문서)은 어느 Bundle의 구성원이든 봅니다. Bundle 이름과 문장은 그 Bundle의 구성원만 봅니다." 권한 표는 그대로다.
  - 지도 그림(줄기·마디·확대·글쇠)의 글은 Task 7·8이 같은 조각에 더한다.
  - 제품 명세 §9 끝에 한 줄: "참조 지도의 요약(문서 번호·제목, Bundle 코드·상태, 후속 문서, 참조·이동 선의 줄 수)은 어느 Bundle의 구성원이든 본다. Bundle 제목과 문장은 그 Bundle 구성원만 본다(사용자 결정 2026-11-16, 제목은 계획 `2026-11-17-reference-map-plan.md`의 판단 1)." 디자인 기초 §5에 "`--peer-*`(남의 Bundle의 작업 — 참조 지도) 넷은 잉크·표면에서 나와 다크 값을 따로 두지 않는다" 한 줄, §8의 레일 문단 끝에 "번호 없는 보는 화면 Map · History는 레일 아래에 모은다(2026-11-17)" 한 줄.

- [ ] **Step 6: 통과를 확인한다** — `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`(특히 `i18n-messages.test.ts`·`manual-content.test.ts`·`stages.test.ts`), 갓 시드한 DB에서 `QUIET=1 ONLY="map:"` 스모크 여섯 단계 PASS. 화면을 직접 열어 en·ko, 라이트·다크를 본다.

- [ ] **Step 7: 커밋** — `feat(map): Map rail item with the List, filters and the side panel — Map 레일 항목, List 표·거르기·옆 칸`

---

### Task 6: 순수 모델 — 배치 `map-layout`과 글쇠 `map-keys`

**Files:**
- Create: `frontend/src/lib/map-layout.ts` · `map-layout.test.ts` · `frontend/src/lib/map-keys.ts` · `map-keys.test.ts`

**Interfaces:**
- Consumes: `MapView`·`compareNumbers`·`getEdgeKey`·`getEdgeLabel`·`getLaneKey`(Task 4).
- Produces:

```ts
// map-layout.ts
export const LANE_W = 200, NODE_W = 176, NODE_H = 44, GAP_X = 48, GAP_Y = 10, LANE_HEAD = 50, LANE_MIN_H = 120, LANE_PAD = 2, MORE_H = 28, LOOP_BULGE = 34, PORT_STEP = 6, MIN_CTRL = 24;
export interface LaidLane { key: string; bundleId: number | null; x: number; height: number; collapsed: boolean; nodeIds: string[]; more: { y: number; count: number } | null }
export interface LaidNode { id: string; laneKey: string; x: number; y: number }
export interface LaidEdge { key: string; source: string; target: string; d: string; dot: { x: number; y: number } }
export interface MapLayout { lanes: LaidLane[]; nodes: ReadonlyMap<string, LaidNode>; edges: LaidEdge[]; width: number; height: number }
export function layoutMap(view: MapView, collapsed: ReadonlySet<string>): MapLayout;
export const ZOOM_MIN = 0.5, ZOOM_MAX = 1.5, ZOOM_STEP = 0.1, ZOOM_FAR = 0.75, FIT_MARGIN = 32;
export function stepZoom(zoom: number, dir: 1 | -1): number;
export function fitZoom(frame: { width: number; height: number }, world: { width: number; height: number }): number;
/** 확대를 바꿔도 포인터 밑의 자리가 그대로이게 하는 새 스크롤 위치(한 축) */
export function keepPoint(scroll: number, pointer: number, from: number, to: number): number;   // (scroll + pointer) * to / from - pointer

// map-keys.ts
export type MapFocus = string;   // 마디 id, 또는 줄기 머리 `lane:<key>`
export type MapKeyAction = { kind: "focus"; id: MapFocus } | { kind: "select" } | { kind: "toggle"; laneKey: string } | { kind: "clear" } | { kind: "zoom"; dir: 1 | -1 } | { kind: "fit" };
export function getMapKeyAction(key: string, focus: MapFocus, layout: MapLayout): MapKeyAction | null;
/** 지도에 들어설 때의 포커스 자리 - 고른 마디, 없으면 이 Bundle 줄기의 첫 마디, 그것도 없으면 첫 줄기의 머리 */
export function getEntryFocus(layout: MapLayout, selectedId: string | null): MapFocus | null;
```

- **배치 셈**(이대로):
  1. **줄기 순서**: `self` → 이 Bundle과 선으로 이어진 Bundle(이 Bundle의 마디와 맞닿은 선의 줄 수 합이 큰 순, 같으면 Bundle id) → 나머지 Bundle(id 순) → `num` 마디가 있으면 `"none"` 줄기.
  2. **이 Bundle 줄기 안**: `old` 마디를 `compareNumbers(number)` → id 순, 그 아래 `target` 마디를 같은 순.
  3. **남의 줄기 안**: 마디의 "이웃 순번"은 그 마디와 선으로 이어진 이 Bundle 마디들의 2번 순번 가운데 가장 작은 값(없으면 무한대). ① 이웃 순번이 있는 `old`(이웃 순번 → 번호 → id) ② `target`(같은 순) ③ 이웃 순번이 없는 `old`(번호 → id). `"none"` 줄기는 이웃 순번 → 번호.
  4. **좌표**: i번째 줄기의 `x = i * (LANE_W + GAP_X)`. 줄기의 j번째 마디는 `x = 줄기 x + (LANE_W - NODE_W) / 2`, `y = LANE_HEAD + j * (NODE_H + GAP_Y)`. 접힌 줄기는 마디를 내놓지 않고 `nodeIds: []`, `height = LANE_HEAD`.
  5. **"N개 더"**: 범위 `linked`의 남의 Bundle 줄기(접히지 않은 것)에서 `count = document_count - (그 줄기의 old 마디 수)`가 0보다 크면 `more = { y: LANE_HEAD + n * (NODE_H + GAP_Y), count }`.
  6. **줄기 높이**: `bottom = LANE_HEAD + n * (NODE_H + GAP_Y) + (more ? MORE_H + GAP_Y : 0)`, `height = max(LANE_MIN_H, bottom + LANE_PAD)`. 세계는 `width = 줄기 수 * LANE_W + (줄기 수 - 1) * GAP_X`(줄기가 없으면 0), `height = 가장 높은 줄기`.
  7. **선**(두 끝 마디가 모두 놓였을 때만): 같은 두 마디 사이의 선들(방향 무관)을 (확인 · REF? · Moved to → source id) 순으로 세워 k번째(0부터, 모두 m개)의 벌림 `off = (k - (m - 1) / 2) * PORT_STEP`. `y1 = a.y + NODE_H / 2 + off`, `y2 = b.y + NODE_H / 2 + off`. 다른 줄기: 도착이 오른쪽이면 `x1 = a.x + NODE_W`, `x2 = b.x`, 왼쪽이면 `x1 = a.x`, `x2 = b.x + NODE_W`. `c = max(MIN_CTRL, |x2 - x1| / 2)`에 방향 부호. `d = "M{x1} {y1} C{x1 + c} {y1} {x2 - c} {y2} {x2} {y2}"`, `dot = (x2, y2)`. 같은 줄기: `x = a.x + NODE_W`, `d = "M{x} {y1} C{x + LOOP_BULGE} {y1} {x + LOOP_BULGE} {y2} {x} {y2}"`, `dot = (x, y2)`. `edges`의 순서는 `getEdgeKey` 순.
  8. 입력의 `bundles`·`nodes`·`edges` 순서와 무관하게 같은 출력이다(먼저 정렬한다).
- **확대 셈**: `stepZoom`은 `round((zoom + dir * ZOOM_STEP) * 10) / 10`을 0.5~1.5에 가둔다. `fitZoom`은 `min((frame.width - 32) / world.width, (frame.height - 32) / world.height, 1)`을 `floor(x * 10) / 10`하고 0.5 아래면 0.5(세계가 0이면 1).
- **글쇠**(`getMapKeyAction`): 마디에서 `ArrowDown`·`ArrowUp`은 같은 줄기의 다음·앞 마디(맨 위에서 `ArrowUp`은 `lane:<key>`, 맨 아래에서 `ArrowDown`은 `null`). 줄기 머리에서 `ArrowDown`은 그 줄기의 첫 마디(접혔거나 비면 `null`). `ArrowRight`·`ArrowLeft`는 옆 줄기에서 `y`가 가장 가까운 마디(같으면 위쪽), 그 줄기가 접혔거나 비면 머리. 머리에서의 좌우는 옆 줄기의 머리. `Home`·`End`는 그 줄기의 첫·끝 마디. `Enter`·` `는 마디면 `select`, 머리면 `toggle`. `Escape`는 `clear`. `+`·`=`는 `zoom 1`, `-`는 `zoom -1`, `0`은 `fit`. 그 밖은 `null`.

- [ ] **Step 1: 실패하는 시험을 쓴다** — Task 4의 `MAP`으로 만든 `buildMapView(MAP, DEFAULT_FILTERS)`를 쓴다(시험 파일 사이에 자료를 나누려면 `map-model.test.ts`의 `MAP`을 `src/lib/map-fixture.ts`로 옮겨 둘이 가져다 쓴다).
  - "orders lanes: this bundle, linked bundles by lines, then the no-bundle lane" — `lanes.map((l) => [l.key, l.x])` → `[["12", 0], ["18", 248], ["15", 496], ["none", 744]]`(18번이 줄 5, 15번이 줄 3).
  - "orders this bundle's documents by natural number with the empty number last" — 12번 줄기의 `nodeIds` → `["old:101", "old:102", "old:110", "old:199"]`, 좌표 → `(12, 50)` `(12, 104)` `(12, 158)` `(12, 212)`.
  - "puts linked documents first in another lane, then its New documents" — 18번 줄기의 `nodeIds` → `["old:160", "target:77"]`, 좌표 `(260, 50)` `(260, 104)`. 15번의 `old:140` → `(508, 50)`, `num:SOP-ZZ-404` → `(756, 50)`.
  - "sizes lanes, the more-documents row and the world" — `more`: 12번 `null`(이 Bundle), 18번 `{ y: 158, count: 1 }`(문서 2 − 보인 Old 1), 15번 `{ y: 104, count: 2 }`(문서 3 − 보인 Old 1), `none` `null`. 높이 `{ "12": 268, "18": 198, "15": 144, none: 120 }`(12번 `50 + 4×54 + 2`, 18번 `158 + 38 + 2`, 15번 `104 + 38 + 2`, `none`은 최소 높이). 세계 `width === 944`, `height === 268`. 범위 `all`이면 `more`는 모두 `null`이다.
  - "draws a straight-across edge back to this bundle" — `old:160>old:101:ref:confirmed`의 `d === "M260 72 C224 72 224 72 188 72"`, `dot` → `{ x: 188, y: 72 }`.
  - "spreads two edges between the same two documents by 6px, confirmed first" — `old:101>old:140:ref:confirmed`의 `d === "M188 69 C348 69 348 69 508 69"`, `…:proposed`의 `d === "M188 75 C348 75 348 75 508 75"`.
  - "loops to the right inside one lane" — `old:101>old:102:ref:confirmed`의 `d === "M188 72 C222 72 222 126 188 126"`, `dot` → `{ x: 188, y: 126 }`.
  - "a collapsed lane keeps its width, drops its nodes and their edges" — `collapsed = new Set(["18"])` → 18번 `height === 50`·`nodeIds` 빈 배열·`more === null`, `nodes.has("old:160") === false`, 선 열쇠에 `old:160`·`target:77`이 든 것이 없다. 15번 줄기의 `x`는 그대로 496.
  - "gives the same layout whatever the input order" — `bundles`·`nodes`·`edges`를 뒤집은 입력의 결과가 `toEqual`.
  - "lays out nothing, one document, two same-numbered documents and two thousand" — 빈 view → `{ lanes: 1개(이 Bundle, 높이 120), nodes.size 0, edges [], width 200 }`. 문서 하나 → 마디 하나. 번호가 같은 `old:1`·`old:2` → id 순으로 둘 다 놓이고 좌표가 다르다(Review Focus 3). `old` 2,000개 → 예외 없이 `nodes.size === 2000`, 마지막 `y === 50 + 1999 * 54`.
  - 확대: `stepZoom(1, 1) === 1.1`, `stepZoom(1.5, 1) === 1.5`, `stepZoom(0.5, -1) === 0.5`, `stepZoom(0.7, 1) === 0.8`. `fitZoom({ width: 730, height: 600 }, { width: 944, height: 268 }) === 0.7`, 세계가 `{ 9000, 9000 }`이면 `0.5`, `{ 200, 120 }`이면 `1`, `{ 0, 0 }`이면 `1`. `keepPoint(200, 100, 1, 1.1)`이 `230`에 가깝다(`toBeCloseTo`).
  - 글쇠(`map-keys.test.ts`): `old:101`에서 `ArrowDown` → `focus old:102`, `ArrowUp` → `focus lane:12`. `old:199`에서 `ArrowDown` → `null`. `lane:12`에서 `ArrowDown` → `focus old:101`. `old:102`(y 104)에서 `ArrowRight` → `focus target:77`. `old:160`에서 `ArrowLeft` → `focus old:101`. `old:110`(y 158)에서 `ArrowRight` → `focus target:77`(가장 가까운 104). 18번을 접으면 `old:102`의 `ArrowRight` → `focus lane:18`, `lane:18`의 `ArrowDown` → `null`. `Home`·`End` → `old:101`·`old:199`. `Enter`: 마디 → `select`, `lane:18` → `{ kind: "toggle", laneKey: "18" }`. `Escape` → `clear`, `+` → `zoom 1`, `-` → `zoom -1`, `0` → `fit`, `a` → `null`. `getEntryFocus(layout, "old:140")` → `"old:140"`, `(layout, null)` → `"old:101"`, 이 Bundle에 마디가 없으면 `"lane:12"`.

- [ ] **Step 2: 실패를 확인한다** — `npx vitest run src/lib/map-layout.test.ts src/lib/map-keys.test.ts` FAIL.
- [ ] **Step 3: 두 모듈을 만든다**(DOM을 읽지 않는다 — `document`·`window`를 가져오지 않는다).
- [ ] **Step 4: 통과를 확인한다** — 두 시험 PASS, lint·tsc.
- [ ] **Step 5: 커밋** — `feat(map): deterministic lane layout, zoom math and key moves as pure models — 줄기 배치·확대 셈·글쇠 이동 순수 모델`

---

### Task 7: 화면 — 지도 그리기(줄기·마디·선), 호버·고르기·접기

**Files:**
- Create: `frontend/src/components/map/map-canvas.tsx`(겉 상자 — 스크롤 칸·툴팁) · `map-world.tsx`(줄기·마디·선) 
- Modify: `frontend/src/app/bundles/[id]/map/page.tsx`(보기 단추, 기본 보기 `"map"`, 접힘) · `frontend/src/styles/map.css` · `frontend/public/manual/user-manual.md`(`#map`에 지도 읽는 법) · `frontend/scripts/pw-smoke-sop.mjs`

**Interfaces:**
- Consumes: `layoutMap`·상수(Task 6), `MapView`·`formatBecomes`·`describeNode`·`listCollapsedAtStart`·`getLaneKey`(Task 4), `useDelegatedTip`, `BundleStatusPill`, `truncateMiddle`, `flashElement`(`ui/motion`).
- Produces:

```tsx
export function MapCanvas(props: { view: MapView; layout: MapLayout; zoom: number; selectedId: string | null; onSelect(nodeId: string | null): void; onToggleLane(laneKey: string): void; onMore(laneKey: string): void; scrollRef: RefObject<HTMLDivElement | null> }): JSX.Element;
/** 그 마디가 보이게 스크롤하고 한 번 번쩍인다(움직임 줄이기면 바로) */
export function revealMapNode(scroller: HTMLElement, nodeId: string): void;
```

- DOM과 `data-testid`: 스크롤 칸 `map-canvas`(`tabIndex`는 Task 8) › 크기 상자 `map-sizer`(`width: layout.width * zoom`, `height: layout.height * zoom`) › 세계 `map-world`(`transform: scale(zoom)`, `transform-origin: 0 0`, `data-far`는 `zoom < ZOOM_FAR`일 때) › ① 줄기 `map-lane-<key>`(`data-o="self|member|summary|none"`, `data-collapsed`) — 머리에 코드·제목(`data-tip`), 소유 표시, `BundleStatusPill`, `map.lane.docs`, 자물쇠 `map-lane-lock-<key>`(`summary`만, `data-tip`은 `map.lane.lockTip`), 접기 단추 `map-lane-toggle-<key>`(`aria-expanded`, `data-tip`은 `map.lane.collapse`·`expand`), "N개 더" 단추 `map-lane-more-<key>` ② 선의 SVG `map-edges`(`aria-hidden`, `pointer-events: none`, 줄기 위·마디 아래 층) — 선마다 `<path class="map-edge" data-edge={key} data-k="out|in|peer" data-label="confirmed|proposed|moved">`와 끝점 `<circle class="map-edge-dot" r="2.5">` ③ 마디 `<button class="map-node" data-testid={\`map-node-${id}\`} data-node={id} data-o=… data-kind=… data-tip=…>` — 첫 줄 `.map-node-no`(번호, `truncateMiddle(number, 10, 6)`, `target`이면 앞에 `NEW` 꼬리표)와 오른쪽 `.map-node-becomes`(`→ {first}` + `+{more}`), 둘째 줄 `.map-node-title`. `aria-label`은 번호(없으면 `map.node.noNumber`), 제목, 소유 표시 글, 후속 문서가 있으면 `map.side.becomes` + 그 글, `map.side.cites`·`map.side.citedBy`(그 마디의 줄 수)를 쉼표로 이은 것. `aria-pressed`는 고른 마디.
- 선의 `data-k`: 출발이 이 Bundle이면 `out`, 아니고 도착이 이 Bundle이면 `in`, 둘 다 아니면 `peer`.

- [ ] **Step 1: 실패하는 스모크를 쓴다** — 파일 끝에. 지도는 qa.member의 `분류 절반`에서 본다.
  1. **`map: lanes, documents and lines draw, and another bundle's work is graphite`** — `map`이 뜨면 기본 보기가 지도다(`map-view-map`의 `aria-pressed="true"`). 응답을 받아 `map-lane-*` 수가 `bundles.length`(+ `num` 마디가 있으면 1), `map-node-*` 수가 `nodes.length`, `.map-edge` 수가 `edges.length`와 같다. 이 Bundle 줄기의 글에 그 Bundle 코드가 있다(장면이 무엇을 찍었는지 — `ui-review.md` 4번). 이 Bundle의 마디 하나와 5번의 마디 하나의 `getComputedStyle(…).borderLeftColor`가 서로 다르고, 5번 마디의 `backgroundColor`가 `--peer-bg`를 푼 값(`getComputedStyle(document.documentElement)`로 임시 요소에 칠해 견준다)과 같다. 마디의 `borderTopLeftRadius`가 `0px`이고 `borderTopRightRadius`가 `0px`이 아니다. `document.elementFromPoint`로 마디 가운데를 찍으면 그 마디다(선이 마디를 덮지 않는다). `map-view-list`를 누르면 `map-list`, 다시 `map-view-map`이면 지도다.
  2. **`map: hovering lights the neighbours without a React commit; selecting opens the side panel`** — `installCommitCounter`. `OLD-1` 마디에 올리면 `map-world`에 `data-hot`이 붙고, 그 마디와 이어진 선·마디에 `data-on`, 나머지 마디의 `opacity`가 1보다 작다. 마디 스무 개 위를 50ms 간격으로 지나는 동안 `window.__commits` 증가 0. 마디에 멈추면 툴팁(`[role="tooltip"]`)에 전체 번호가 뜨고 Tab으로 포커스가 가도 뜬다. 마디를 누르면 `aria-pressed="true"`·2px 강조 테두리, `map-side-number`가 그 번호, 다른 마디에 올려도 강조가 고른 마디의 것 그대로다. 같은 마디를 다시 누르거나 바탕(`map-canvas`의 빈 곳)을 누르면 풀린다. 옆 칸의 `map-side-link-…`를 누르면 그 마디가 골라지고 화면 안에 있다(`boundingBox`가 `map-canvas` 안).
  3. **`map: a summary-only lane shows a lock and a code, never a name`**(`devUser: "prod.member"`, `문서 관리`) — 남의 줄기마다 `map-lane-lock-<key>`가 있고 머리의 글이 `BND-` 코드와 "Other Bundle · summary only"·상태·문서 수뿐이다(한글이 없다). 자물쇠에 올리면 툴팁이 "You are not a member. Numbers, titles and status only."
  4. **`map: collapse a lane; "more documents" switches to All Bundles with that lane open`** — qa.member의 `분류 절반`: `map-lane-toggle-<5번>`을 누르면 그 줄기 안의 `map-node-*`가 0이고 `.map-edge` 수가 그 줄기에 닿던 수(응답으로 센다)만큼 줄며 `aria-expanded="false"`다. 다시 누르면 돌아온다. 이어서 `devUser: "prod.member"`의 `문서 관리`(남의 줄기마다 Old 문서 6개 가운데 가리키는 것만 보인다): 응답에서 `document_count`가 보인 Old 마디 수보다 큰 Bundle 하나를 골라 그 `map-lane-more-<key>`의 글이 `"<차이> more documents"`임을 보고 누른다 → `map-scope-all`이 눌린 상태가 되고 `?scope=all` 요청이 나가며, 그 줄기가 펴져 Old 마디 6개를 보이고, 이 Bundle과 이어지지 않은 줄기(5번)는 `data-collapsed`다.
  5. **`map: REF? only and search dim the map`** — `map-filter-proposed`를 켜면 `.map-edge` 전부의 `data-label`이 `proposed`다. `map-search`에 `abc-1016`을 넣으면 그 마디에 `data-match`, 나머지의 `opacity`가 1보다 작다. Enter를 누르면 그 마디가 골라지고, 그 줄기를 먼저 접어 두었으면 펴진다.

- [ ] **Step 2: 실패를 확인한다** — `ONLY="map:"`의 새 다섯 단계 FAIL.

- [ ] **Step 3: 지도를 그린다.**
  - `page.tsx`: `view`의 기본을 `"map"`으로, 도구 줄의 `children`에 `view-toggle` 둘(`map-view-map`·`map-view-list`, `map.view.*`). `layout = layoutMap(mapView, collapsed)`(`useMemo`). 자료가 올 때(범위·다시 읽기) `collapsed`를 맞춘다 — 범위 `all`로 **바꾼 순간**에만 `listCollapsedAtStart(data, pendingLane)`으로 채우고(`pendingLane`은 "N개 더"를 누른 줄기), 다시 읽기에서는 사람이 접고 편 것을 지킨다(이펙트 안에서 동기로 상태를 바꾸지 않는다 — `react-ts-patterns.md` §3). Enter 찾기는 지도 순서(줄기 순서 → `nodeIds`)로 돌고, 맞은 마디의 줄기가 접혀 있으면 편 뒤 `revealMapNode`.
  - `MapCanvas`: `useDelegatedTip()`을 여기에만 두고 `handlers`를 스크롤 칸에 펼친다. 바탕(마디·단추가 아닌 곳)을 누르면 `onSelect(null)`. `MapWorld`는 `view`·`layout`·`zoom`·`selectedId`와 콜백만 받는 따로 뗀 부품이다 — 툴팁 상태가 바뀔 때 다시 그려지지 않는다(수동 메모를 쓰면 `react-ts-patterns.md` §6을 지킨다).
  - **호버 강조**(React 상태가 아니다 — `link-lines.tsx`와 같은 까닭): `MapWorld`가 이웃 표(마디 id → 이어진 마디 id들·선 열쇠들)를 `useMemo`로 만들어 ref에 두고, 세계의 `pointerover`·`focusin`에서 **고른 마디가 없을 때만** `data-hot`(세계)·`data-on`(그 마디·이웃 마디·맞닿은 선과 끝점)을 달고 `pointerout`·`focusout`에서 뗀다. 속성은 직접 단다(`setAttribute`·`removeAttribute`).
  - **고르기**(React 상태): `selectedId`가 있으면 렌더가 세계에 `data-focus`, 고른 마디에 `data-sel`, 그 이웃과 선에 `data-on`을 단다. 찾는 중이면 세계에 `data-find`, 맞는 마디에 `data-match`.
  - `revealMapNode`: 그 마디의 상자가 스크롤 칸 밖이면 `scrollIntoView({ block: "center", inline: "center", behavior: 움직임 줄이기면 "auto" 아니면 "smooth" })`, 그리고 `flashElement`.
- [ ] **Step 4: `map.css` — 설계 §6.5의 표를 그대로 옮긴다.**

  | 대상 | 값 |
  |---|---|
  | `.map-lane[data-o="self"]` | 바탕 `--accent-tint`, 테두리 1px `--accent-line`, 모서리 `--r-3` |
  | `.map-lane[data-o="member"]`·`[data-o="summary"]` | 바탕 `--sunken`, 테두리 1px `--line` |
  | `.map-lane[data-o="none"]` | 바탕 없음, 테두리 1px dashed `--line-2` |
  | `.map-node`(공통) | `position: absolute`, 176×44, 글자 `--ink`, 번호 `--font-mono`, 제목 `--ink-3`, 모서리 `0 var(--r-1) var(--r-1) 0`, 커서 손가락, 글은 한 줄 말줄임(`min-width: 0`) |
  | `.map-node[data-o="self"]` | 바탕 `--paper`, 테두리 1px `--line-2`, 왼쪽 3px `--accent` |
  | `.map-node[data-o="member"]`·`[data-o="summary"]` | 바탕 `--peer-bg`, 테두리 1px `--peer-line`, 왼쪽 3px `--peer-fill`, 번호·후속 문서 글자 `--peer-ink` |
  | `.map-node[data-o="none"]` | 바탕 없음, 테두리 1px dashed `--ink-4`(네 변 모두, 막대 없음, 모서리 `--r-1`) |
  | `.map-node-becomes` | 이 Bundle `--ink-2`, 남 `--peer-ink`. 그 Bundle이 `done`이 아니면 `--ink-3`(`data-tentative`) |
  | `.map-node[data-sel]` | 테두리 2px `--accent`(막대는 그대로) |
  | `.map-edge` | `fill: none`, `stroke-linecap: round`. `[data-k="out"]`은 `--accent` 1.5px, `in`은 `--peer-fill` 1.25px, `peer`는 `--peer-fill` 1px |
  | `.map-edge[data-label="proposed"]` | `stroke-dasharray: 3 3` — `data-k="out"`이면 `--lang-ref-ink`, 아니면 `--peer-fill` |
  | `.map-edge[data-label="moved"]` | `stroke-dasharray: 9 3 2 3` |
  | 쉬는 선 | `opacity: .5`, `peer`는 `.3` |
  | 강조(`[data-hot]`·`[data-focus]` 아래) | `[data-on]`인 선 `opacity: 1`·굵기 +0.5, 아닌 선 `.12`, 아닌 마디 `.4` |
  | 찾는 중(`[data-find]`) | `[data-match]`가 아닌 마디 `.4` |
  | `[data-far] .map-node-title` | `display: none` |
  움직임 줄이기에서는 `opacity` 전환을 끈다. 클래스 이름이 Tailwind 유틸리티와 겹치지 않게 모두 `map-`으로 시작한다(`react-ts-patterns.md` §10).
- [ ] **Step 5: 설명서 `#map`에 더한다** — 줄기는 Bundle 하나·마디는 문서 하나, 마디 오른쪽 위의 `→ SOP-UV +1`이 바뀔 문서, 선 셋의 모양(실선 · 짧은 점선 **REF?** · 긴 점선 **Moved to**), 파란 것은 이 Bundle·회색은 다른 Bundle·점선 테두리는 **Not in any Bundle**, 문서를 누르면 옆 칸, 줄기 머리의 **Collapse** · **Expand**, "문서 N개 더"를 누르면 **All Bundles** 로 넘어간다는 것, **Map** · **List** 는 같은 자료라는 것.
- [ ] **Step 6: 통과를 확인한다** — lint·tsc·vitest, 갓 시드한 DB에서 `ONLY="map:"` 전부 PASS(Task 5의 여섯 단계 포함 — `openMapList`가 List로 바꾼다). en·ko, 라이트·다크로 직접 본다.
- [ ] **Step 7: 커밋** — `feat(map): draw lanes, documents and lines; hover, select and collapse — 줄기·마디·선 그리기, 호버·고르기·접기`

---

### Task 8: 화면 — 확대 · Fit all · 바탕 끌기 · 글쇠

**Files:**
- Create: `frontend/src/components/map/use-map-pan.ts` · `use-map-zoom.ts`
- Modify: `frontend/src/components/map/map-canvas.tsx` · `map-world.tsx` · `frontend/src/app/bundles/[id]/map/page.tsx` · `frontend/src/styles/map.css` · `frontend/public/manual/user-manual.md` · `frontend/scripts/pw-smoke-sop.mjs`

**Interfaces:**
- Consumes: `stepZoom`·`fitZoom`·`keepPoint`·`ZOOM_FAR`(Task 6), `getMapKeyAction`·`getEntryFocus`(Task 6), `DRAG_THRESHOLD_PX`·`hasPassedThreshold`·`DRAG_GUARD_SELECTOR`(`lib/box-drag`), `revealMapNode`(Task 7).
- Produces: `const [zoom, setZoom] = useState(1)`(`page.tsx`), `useMapPan(scrollRef: RefObject<HTMLElement | null>): void`, `useMapZoom(scrollRef, zoom, onZoom: (next: number, anchor: { x: number; y: number } | null) => void): void`. `data-testid`: `map-zoom-out` · `map-zoom-in` · `map-zoom-fit` · `map-zoom-value`.

- [ ] **Step 1: 실패하는 스모크를 쓴다.**
  1. **`map: zoom buttons, Ctrl+wheel, Fit all and dragging the background`** — `map-zoom-in`을 두 번 누르면 `map-zoom-value`가 `120%`이고 `map-sizer`의 폭이 처음의 1.2배(±1px)다. 다섯 번 더 눌러도 `150%`에서 멈추고 단추가 꺼진다. `map-zoom-out`으로 `70%`까지 내리면 `map-world`에 `data-far`가 붙고 `.map-node-title`이 보이지 않는다. `50%`에서 멈춘다. `map-zoom-fit`을 누르면 세계 전체가 칸 안에 든다(`map-sizer`의 폭·높이가 `map-canvas`의 `clientWidth`·`clientHeight` 이하이거나 값이 `50%`). 지도 위에서 Ctrl+휠(`page.mouse.wheel` 전에 `keyboard.down("Control")`)을 올리면 값이 커지고 포인터 밑의 마디가 포인터 밑에 남는다(그 마디 상자가 포인터를 계속 품는다). 지도 밖(옆 칸)에서의 Ctrl+휠은 값을 바꾸지 않는다. 확대를 `150%`로 올려 스크롤이 생기게 한 뒤 바탕을 누른 채 (−120, −80) 끌면 `scrollLeft`·`scrollTop`이 그만큼 늘고, 놓은 뒤 고름이 바뀌지 않는다(끈 뒤의 click을 삼킨다). 3px만 움직이고 놓으면 스크롤이 그대로다. 마디 위에서 시작한 끌기는 스크롤하지 않는다.
  2. **`map: keyboard only`** — `map-search`에서 Tab을 거듭 눌러 `map-canvas` 안으로 들어가면 이 Bundle의 첫 마디가 포커스다(Tab 한 번에 지도를 지나 옆 칸으로 나간다 — 지도 안의 Tab 자리는 하나). `ArrowDown`으로 다음 마디, `ArrowRight`로 옆 줄기, `Home`·`End`, 맨 위에서 `ArrowUp`은 줄기 머리의 접기 단추. Enter로 고르면 `map-side-number`가 그 번호, Esc로 풀린다. 줄기 머리에서 Enter는 접는다. `+`·`-`·`0`이 확대 값을 바꾼다. 포커스가 간 마디는 늘 `map-canvas` 안에 보인다. `map-search`에 글을 넣는 동안의 `+`·`0`·화살표는 지도를 움직이지 않는다.

- [ ] **Step 2: 실패를 확인한다.**

- [ ] **Step 3: 확대와 끌기를 만든다.**
  - 도구 줄의 `children`에 − · 값 · + · **Fit all**(아이콘 단추 + `Tooltip`, 끝에서 꺼진다). 확대를 바꿀 때 스크롤 위치를 `keepPoint`로 맞춘다 — 단추·글쇠는 칸의 가운데를, 휠은 포인터를 기준으로(렌더 뒤 `useLayoutEffect`에서 `scrollLeft`·`scrollTop`을 쓴다). 지도에 처음 들어올 때는 100%다(범위·보기·거르기·확대를 기억하지 않는다 — `localStorage`를 쓰지 않는다).
  - `useMapZoom`: `use-pane-zoom.ts`와 같은 원칙 — 스크롤 칸에 `wheel`을 `passive: false`로 직접 달고 Ctrl·⌘일 때만 `preventDefault`, 작은 휠을 40만큼 모아 한 칸.
  - `useMapPan`: 스크롤 칸의 `pointerdown`(왼쪽 단추, 마우스·펜만 — 터치는 브라우저 스크롤에 맡긴다)에서 `DRAG_GUARD_SELECTOR`나 `.map-node`·`.map-lane-head` 안이면 시작하지 않는다. `preventDefault`를 부르지 않는다. `hasPassedThreshold`를 넘으면 `data-pan`을 달고(커서 `grabbing`, 글자 긁힘은 CSS `user-select: none`) `scrollLeft`·`scrollTop`을 옮긴다. 놓으면 따라오는 `click` 한 번을 캡처 단계에서 삼킨다. Esc·`pointercancel`은 처음 자리로 돌린다.
- [ ] **Step 4: 글쇠를 잇는다** — 움직이는 tabindex: 세계 안의 마디와 접기 단추는 모두 `tabIndex={-1}`이고 포커스 자리 하나만 `0`이다(`getEntryFocus`). 세계의 `keydown`에서 `getMapKeyAction(event.key, 지금 포커스, layout)` — `focus`면 그 요소에 `focus()`와 `scrollIntoView({ block: "nearest", inline: "nearest" })`, `select`는 `onSelect`, `toggle`은 `onToggleLane`, `clear`는 `onSelect(null)`, `zoom`·`fit`은 확대. 처리한 글쇠만 `preventDefault`. Ctrl·⌘·Alt와 함께면 넘긴다. 포커스 테두리는 전역 `:focus-visible` 그대로.
- [ ] **Step 5: 설명서 `#map`에 더한다** — 확대(**Zoom in** · **Zoom out** · **Fit all**, 지도 위에서 <kbd>Ctrl</kbd>+휠), 바탕을 끌어 움직이기, 글쇠 표(<kbd>↑</kbd><kbd>↓</kbd> 같은 줄기, <kbd>←</kbd><kbd>→</kbd> 옆 줄기, <kbd>Home</kbd><kbd>End</kbd>, <kbd>Enter</kbd> 고르기·접기, <kbd>Esc</kbd> 풀기, <kbd>+</kbd><kbd>-</kbd><kbd>0</kbd> 확대, <kbd>/</kbd> 찾기). `#keys`(단축키 모아 보기)에 Map 줄을 더한다.
- [ ] **Step 6: 통과를 확인한다** — lint·tsc·vitest, `ONLY="map:"` 전부 PASS.
- [ ] **Step 7: 커밋** — `feat(map): zoom, Fit all, background drag and keyboard moves — 확대·전체 보기·바탕 끌기·글쇠`

---

### Task 9: 극단 자료·좁은 창 검토, 감사 항목, 시간 재기, 올리기 준비

**Files:**
- Modify(필요할 때만): `frontend/src/styles/map.css` · `components/map/*` · `lib/map-layout.ts`의 상수(바꾸면 시험의 좌표도 같은 커밋에서 — 이 계획이 만든 시험이다)
- Modify: `frontend/scripts/pw-layout-audit.mjs`(Map 항목과 `sceneUrls`) · `pw-overlap-audit.mjs`(Map 장면) · `pw-contrast-audit.mjs`(Map 화면 셋) · `frontend/package.json`·`package-lock.json` · `CHANGELOG.md` · `PROGRESS.md` · `docs/README.md` · `frontend/CLAUDE.md` · `docs/superpowers/specs/2026-11-17-reference-map-design.md`

**Interfaces:**
- Consumes: Task 1~8, Task 3의 `ids.mid[5]`·`ids.m`.
- Produces: dev에 합칠 수 있는 브랜치(푸시·합치기는 조율하는 세션이 한다).

- [ ] **Step 1: 감사 항목을 더한다**(먼저 각 감사가 무엇을 재는지 읽는다 — `ui-review.md` 5번).
  - `pw-layout-audit.mjs`: `sceneUrls`에 `"/map"`을 더한다(X0 — 가로 넘침 없음. 이 계획이 허락한 수정). 새 항목(모두 `user: MEMBER`):

    | id | ds · 창 | 주소 | 재는 것 → 기대 |
    |---|---|---|---|
    | `M1` | worst · 1120, 2560 | `/bundles/${ids.m[1]}/map` | 글이 제 상자를 넘는 마디 수(`.map-node`의 `scrollWidth > clientWidth + 1` 또는 자식 글의 오른쪽 끝이 마디 밖) → `0` |
    | `M2` | worst · 1120 | 같다 | `map-canvas`의 폭 → `≥ 700`, 그리고 `map-side`의 폭이 280~420 |
    | `M3` | worst · 1120, 1920 | 같다, `open`에서 `map-view-list` | `map-list`를 감싼 칸이 가로로 넘치지 않고(`scrollWidth ≤ clientWidth + 1`) 줄 높이의 최댓값(`maxRowHeight`) → `≤ 72` |
    | `M4` | worst · 2560 | 같다 | `.page-wrap`의 폭 → `≤ 1920` |
    | `M5` | worst · 1120 | `/bundles/${ids.w[7]}/map` | `map-empty-docs`가 보이고 도구 줄의 단추가 켜져 있다 → `true` |
    | `M6` | worst · 1120, 2560 | `/bundles/${ids.m[1]}/map`, `open`에서 `map-scope-all` | 줄기 머리의 글이 제 줄기를 넘는 수 → `0`, 접힌 줄기의 높이가 모두 50 |
    | `M7` | mid · 1120, 1920 | `/bundles/${ids.mid[2]}/map` | 도구 줄이 칸을 넘지 않는다(`scrollWidth ≤ clientWidth + 1`) — `LANGS=ko,en`으로도 |
  - `pw-overlap-audit.mjs`: 장면 `map-nodes`(qa.member, `/bundles/${BUNDLE}/map`) — 마디마다 `.map-node-no`와 `.map-node-becomes`의 상자가 겹치지 않고(겹친 px 0), 줄기 머리의 코드·소유 표시·알약·접기 단추가 서로 겹치지 않으며, 마디 가운데의 `elementFromPoint`가 그 마디다(선·다른 마디가 덮지 않는다). 장면 `map-side`(마디를 고른 상태) — 옆 칸의 줄 끝 글과 알약이 겹치지 않는다.
  - `pw-contrast-audit.mjs`의 `screens`에 셋: `["map", \`/bundles/${id}/map\`, '[data-testid="map-canvas"]']`, `["map-selected", 같은 주소, 같은 준비, 남의 마디 하나를 누른다]`, `["map-list", 같은 주소, '[data-testid="map-canvas"]', map-view-list를 누른다]`. 라이트·다크 모두 실패 0이어야 한다 — 이 감사는 `opacity`가 1보다 작은 글자를 건너뛰므로, **쉬는 마디의 글자는 `opacity: 1`이어야 잰다**(흐리게 하는 것은 호버·고르기·찾기 때뿐이다).
- [ ] **Step 2: 극단 자료로 재고 고친다** — `reset_db → seed_sop_demo → seed_sop_worst`한 DB, 창 폭 1120과 2560, en·ko, 라이트·다크. 스크립트(`playwright-core` + 시스템 Chrome)로 잰다. 겹치거나 넘치면 **이 태스크에서 고친다**(보고만 하지 않는다).
  - **마디**: 100자 번호·공백 없는 200자 제목·빈 제목·번호 없는 문서·후속 문서 6개(`→ … +5`)·임시 번호뿐인 후속 문서가 마디(176×44)를 넘지 않고 툴팁이 전체 글을 보인다. 빈 제목 마디의 높이가 다른 마디와 같다.
  - **선**: 문서 30개가 가리키는 `MAP-101`과 번호 40개를 가리키는 `MAP-102`를 골랐을 때 그 선들이 진하고 나머지가 흐리며, 마디의 번호가 선에 가려지지 않는다(선은 마디 아래 층). 쉬는 선의 불투명도(.5 · .3)가 다크에서도 보이는지, 강조된 `--peer-fill` 선이 바탕과 3:1 이상인지 감사 스크립트의 계산식으로 잰다(모자라면 불투명도·굵기를 고치고 값을 설계 §6.5 표 아래에 적는다).
  - **대비**: `--peer-ink`/`--peer-bg`, `--ink-3`/`--peer-bg`가 4.5:1 이상, `--peer-fill` 막대/`--peer-bg`가 3:1 이상 — 설계의 어림값(8.2·5.4·4.0, 다크 8.4·5.8·4.4)을 **화면에서 잰 값**으로 바꿔 적는다. 모자라면 토큰이 아니라 그 자리의 글자 토큰을 한 단 진하게 고른다(`--ink-3` → `--ink-2`).
  - **많을 때**: M1의 범위 `all`(마디 100개 이상 · 줄기 10개 이상)에서 지도가 뜨는 데 걸린 시간과 굴리는 동안의 긴 프레임을 적는다. 마디 위를 40걸음 지나는 동안 `window.__commits` 증가 0. 눈에 띄게 끊기면 줄기에 `content-visibility: auto`를 준다.
  - **List**: 1120에서 열이 옆으로 밀리지 않고 번호·제목이 두 줄에서 접힌다. 100자 번호가 가운데 말줄임된다.
  - **옆 칸**: 1120에서 280px, 2560에서 420px. 줄 40개짜리 Cites 목록이 옆 칸 안에서 스크롤한다.
  - **빈 Bundle**(W7)과 **상한**: W7의 지도가 빈 상태를 보이고 **All Bundles** 가 된다. `truncated`는 극단 자료에서도 `false`다(상한에 닿지 않는다) — 한 줄 알림은 응답을 바꿔 그려(`page.route`) 1120에서 한 줄에 드는지 본다.
  - **움직임 줄이기**(`page.emulateMedia({ reducedMotion: "reduce" })`): 고른 마디로 가는 스크롤이 바로 끝나고 번쩍임 대신 테두리다.
  - **평문 HTTP**: backend·frontend를 띄운 PC의 LAN IP 주소로 지도를 한 번 연다(`crypto`·Clipboard를 쓰지 않는다 — 콘솔 오류 0).
- [ ] **Step 3: 시간을 잰다**(극단 DB, backend 8787) — `for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" -H "X-Dev-User: qa.member" "http://localhost:8787/api/bundles/<id>/map?scope=<linked|all>"; done`을 M1과 W1(가장 큰 Bundle)에서 범위마다 돌려 가운데 값을 적는다. 목표 linked 300ms · all 800ms. 넘으면 판단 11의 차례대로 한다.
- [ ] **Step 4: 전체 검증.** `git diff --stat dev -- "frontend/src/app/bundles/[id]/assign" frontend/src/components/assign`가 비어 있다. backend: `$PY -m pytest tests/ -q -n auto`, `$PY -m ruff check app/ tests/ scripts/`. frontend: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, `npm run build` 경고 0(`next dev`를 먼저 내린다). 갓 시드한 DB(`seed_sop_demo`)에서 전체 스모크(새 `map:` 단계 열셋 PASS, 실패가 Task 3에서 적은 기준선보다 늘지 않음) → 다시 시드 → `pw-overlap-audit.mjs`, `DS=worst pw-layout-audit.mjs`(극단 DB) · `DS=mid pw-layout-audit.mjs`, `pw-contrast-audit.mjs`.
- [ ] **Step 5: 버전과 기록.** `frontend/`에서 `node -p "require('./package.json').version"`으로 **지금 버전을 읽고** `npm version patch --no-git-tag-version`(그 다음 PATCH — 번호를 가정하지 않는다). `CHANGELOG.md` `## Unreleased (dev)` 아래 `### v<새 버전> — <이 커밋을 만드는 날>`: 레일의 **Map**, List와 지도, 범위·거르기·찾기·확대·글쇠, 누가 무엇을 보나(구성원 아닌 Bundle은 코드·문서 번호·제목·상태·바뀔 문서·줄 수만 — Bundle 이름과 문장은 구성원만), 서버 `GET /api/bundles/{id}/map`, 새 토큰 `--peer-*`, 시드의 지도용 Bundle, 잰 시간, 알려진 한계(문장과 줄의 **Open in Assign** 은 다음 업데이트 · 번호 꼴이 아닌 번호는 맞는 문서가 없으면 그리지 않는다 · 접힌 줄기의 선은 그리지 않는다 · 터치는 스크롤과 단추만 · 개발 스택(Postgres)의 시간은 배포 뒤 로그로 확인). `PROGRESS.md`는 이 브랜치의 항목을 요약 하나로 줄인다. `docs/README.md`에 설계 한 줄(1·2걸음 구현됨, 3걸음 미구현)과 이 계획 한 줄. `frontend/CLAUDE.md` 핵심 구조에 "참조 지도(`app/bundles/[id]/map`, `components/map/`): 규칙은 `lib/map-model.ts`(거르기·찾기·옆 칸)·`map-layout.ts`(배치·확대 셈 — DOM을 재지 않는다)·`map-keys.ts`, 마디는 DOM·선은 SVG 한 장, 호버 강조는 DOM 속성. 응답에 없는 것을 화면이 지어내지 않는다(Bundle 이름이 비면 코드만)" 한 줄. 설계 문서: §10의 1·2걸음에 "(v<새 버전>으로 dev에 올렸다.)", §5의 Bundle 제목 문단에 "구현에서 뒤집었다 — `summary`의 제목은 싣지 않는다(계획 판단 1)", §4의 4번에 "`ref` 선에도 같은 규칙(계획 판단 3)", §6.5의 대비 표를 잰 값으로, §7.3에 잰 시간, §9의 "가벼운 Bundle 36개"를 "문서가 있는 같은 종류의 것만"으로.
- [ ] **Step 6: 커밋** — `chore(release): v<새 버전>, reference map with the List and the drawn map — 참조 지도(Map): List와 지도 (v<새 버전>)`

---

## Self-Review 기록

- **설계 대비**: §4(마디 셋·선 셋·번호를 잇는 순서·후속 문서·합성과 실제)는 Task 1·2. §5의 표는 "가시성 행렬"과 Task 1·2의 시험(제목은 판단 1로 뒤집었다). §6.1(자리·레일·잠그지 않음·폭)은 Task 5 Step 3, §6.2(틀·떠 있는 상자 없음)는 Task 5·7·8, §6.3은 Task 6, §6.4(DOM 마디·SVG 선·스크롤·확대·호버)는 Task 7·8, §6.5는 Task 4의 토큰과 Task 7의 표·Task 9의 대비 측정, §6.6은 Task 7, §6.7(범위·접기·거르기·찾기·List·상한 알림·기억하지 않음)은 Task 4·5·7, §6.8(옆 칸·문서의 **Open in Assign**)은 Task 5 — 문장과 줄의 가기는 다음 계획, §6.9는 Task 5(판단 29·30), §6.10은 Task 6·8. §7.1·§7.3·§7.4는 Task 1·2와 Task 9의 시간. §8의 문구·설명서는 Task 5·7·8. §9의 순수 모델 시험은 Task 4·6, 서버 시험은 Task 1·2(`lines` 줄은 다음 계획), 브라우저 1~4·6·7은 Task 5·7·8·9(5의 "그 줄"은 다음 계획), 극단 자료는 Task 3·9. §12의 열린 것은 모두 설계가 고른 안 그대로다(부서 보이지 않음 · 전역 지도 없음 · 표 만들지 않음 · 같은 번호 경고 없음 · New 문서의 참조 줄 그리지 않음 · 요약을 가리는 표시 없음 · 확정 줄 하나로 후속 문서).
- **Review Focus의 시험**: 1 → Task 5 스모크 5와 판단 29. 2 → Task 1 `test_odd_document_numbers_do_not_break_the_scan`. 3 → Task 1 `test_same_number_in_two_bundles_draws_both`와 Task 6 "two same-numbered documents". 4 → Task 1 `test_bundle_without_documents_still_opens_its_map`, Task 4 "summarizes this bundle"의 빈 자료, Task 6 "lays out nothing…". 5 → Task 4 "finds by number or title…"의 정규식 글자·빈칸, Task 5 Step 4의 `isComposing`(스모크 2의 Enter).
- **설계와 다르게 정한 것**은 "어긋난 곳"의 여섯과 판단 1·3·6·20이고 모두 위에 적었다.
- **하지 않는 것**: 문장·줄의 가기(다음 계획), Assign 화면 고치기, 지도에서 고치기, New 문서의 참조 줄, EQUIS, 마디 끌기·배치 저장·그림 내보내기, 전역 지도, 부서 표시, 문서별 참조 표(스키마), 범위·확대 기억, 터치의 두 손가락 확대, 설명서 그림.
- **이름 맞춤**: `MapLine`·`collect_map_lines`·`build_reference_map`(Task 1 → 2 → 다음 계획). `RefMap`·`MapView`·`getEdgeKey`·`getLaneKey`(Task 4 → 5·6·7). `layoutMap`·`MapLayout`·`LaidLane.nodeIds`(Task 6 → 7·8). `scope`·`view`·`filters`·`selectedId`·`collapsed`·`zoom`(Task 5 → 7 → 8). `data-testid`는 Task 5(도구 줄·표·옆 칸)·Task 7(`map-canvas`·`map-world`·`map-lane-*`·`map-node-*`·`map-edges`·`map-view-*`)·Task 8(`map-zoom-*`)이 정하고 스모크·감사가 쓴다. 시드의 제목(`SYNTHETIC 5 UV 분광광도계`·`SYNTHETIC 6 문서 관리`·`SYNTHETIC M<n> map`)은 Task 3이 정하고 스모크·감사가 쓴다.
