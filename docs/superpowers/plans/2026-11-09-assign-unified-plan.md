# Assign 통합 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 분류·짝 맞추기 두 화면을 Old 조각 한 줄씩 처리하는 `/bundles/[id]/assign` 한 화면으로 합친다(v0.10.0).

**Architecture:**
- **서버**: 읽기 엔드포인트 둘을 더한다. 이미 쓴 문서의 문장 목록과 Old Unit 하나의 New 문장 후보이고, 저장 규칙은 그대로다.
- **프런트 순수 모델**: 지금 `classify-model.buildGroupSave`에 보낼 곳 종류 `link`(이미 쓴 문서의 문장 연결)를 더해 닫힌 묶음 전체를 보내게 한다. 새 `assign-model`이 추천 섞기·짝 자동·함께 확정 목록·확대·폭 규칙을 맡는다.
- **화면**: 분류 화면의 줄·편집·저장 흐름을 바탕으로 쓰고, 왼쪽 목록·가운데 용지를 "Old 조각 ‖ New 원문" 두 칸으로, 오른쪽을 아코디언 4단으로 바꾼다. 짝 맞추기의 똑같은 문장 일괄과 신규 표시를 옮긴다.

**Tech Stack:** FastAPI·SQLAlchemy async·pytest, Next.js 16·React 19·Tailwind 4·vitest, Playwright 스모크.

**Spec:** `docs/superpowers/specs/2026-11-09-assign-unified-design.md` (목업 `docs/design/2026-11-09-assign-mock.html`)

## Global Constraints

- 저장 규칙·데이터 모델·결과물 계산은 바꾸지 않는다. Alembic 리비전 없음.
- AI는 제안만 한다. 새 엔드포인트는 LLM·임베딩 API를 부르지 않는다(임베딩 캐시 읽기만).
- 라벨은 짧은 명사형이다. Bundle·Old·New·Unit은 영어로 둔다. en·ko 메시지는 한 쌍으로 더한다(`i18n-messages.test.ts`).
- 브라우저 기본 모양(체크박스·`title` 툴팁·`<select>`)을 쓰지 않는다. 기존 `Select`·`Tooltip`·`InfoTip`·`MorphButton`·`EmptyState`를 쓴다. 색은 토큰만 쓴다.
- 인터랙티브 요소에는 `data-testid`를 단다(`assign-*`).
- 앱 안 이동은 `navigate()`/Link로 한다(`router.push` 금지). 미저장 이탈 가드(`useLeaveGuard`)는 유지한다.
- 상태 표기는 영어로 둔다. 대비 4.5:1, 라이트·다크.
- 확대는 70~160%(10%씩), 폭은 30~70%이고 사람마다 브라우저에 기억한다(`sopa.assign.*`).
- 원문 글자는 앱 로그에 남기지 않는다.

## Review Focus

1. 나눔·합침 연결 저장(같은 Old가 New 문장 둘에 붙음, Old 둘이 New 하나에 붙음)이 `not_closed` 없이 저장되는지. 문서가 다른 New 두 곳에 붙은 Old도 포함한다.
2. 보낼 곳을 바꿀 때(칸 → 문장, 문장 → 칸, 문장 → 다른 문장) 이전 연결이 남지 않는지. 출처가 사라진 New 문장은 미배정으로 돌아가는지.
3. 한/영 짝 자동에서 New 쪽 짝이 없거나 Old 쪽이 한 언어뿐일 때, 있는 언어만 저장되는지.
4. 한국어만 있는 Old 문서에서 칸 배정 뒤 "영어 만들기"가 번역 제안(AI 켬)이나 빈 EN 칸(AI 끔)으로 이어지는지.
5. 마우스가 문서 위에 없을 때 Ctrl +/−·Ctrl+휠이 브라우저 확대로 그대로 가는지. 입력 칸에 포커스가 있을 때 ↑↓·J/K·Enter가 가로채이지 않는지.

---

### Task 1: 서버 — 이미 쓴 문서 문장 목록과 New 문장 후보

**Files:**
- Create: `backend/app/sop/written.py`
- Modify: `backend/app/routers/sop_decisions.py` (라우트 둘, `_require_member`)
- Test: `backend/tests/test_sop_written.py`

**Interfaces:**
- Produces (HTTP):
  - `GET /api/bundles/{id}/written-sentences` → `list[WrittenSentenceOut]`. 입구 `match`인 To-Be 문서의 `origin="new_doc"` 최상위 target(칸 문장 제외), 문서 → `order_index` 순서.
    - 필드: `{target_id, target_doc_id, doc_code, section_path, order_index, lang, kind ("sentence"|"table"|"figure"), text, status, change_type, source_unit_ids: list[int], partner_target_id: int | None, revision}`
    - `text`는 확정 글이다(new_doc은 원문 그대로). `partner_target_id`는 `new_unit_id`의 `UnitPairMember` 짝 상대 Unit이 만든 target이다.
  - `GET /api/bundles/{id}/units/{unit_id}/new-candidates` → `list[NewCandidateOut]`, 최대 5개, 점수 내림차순.
    - 필드: `{target_id, target_doc_id, doc_code, section_path, text, basis: "embedding"|"text"}`
    - 대상: 같은 `lang`의 `written-sentences` 중 `kind="sentence"`. 이미 출처가 있는 문장도 넣는다.
    - 점수: 두 글자 모두 임베딩 캐시에 있으면 코사인, 아니면 `similarity.text_similarity`.
    - 점수가 `CANDIDATE_MIN_SCORE`(새 상수, `constants.py`) 미만이면 뺀다. 값은 합성 시험으로 고정하고 "합성 자료로만 잡은 값" 주석을 단다.
- 순수 함수(시험 대상):
  - `rank_new_candidates(unit_text, unit_vec, sentences, vectors, limit=5) -> list[tuple[int, float, str]]` (`written.py`)
  - `find_partner_targets(rows) -> dict[int, int]`
- 캐시 읽기는 `embeddings._load_cached_vectors`를 공개 함수 `load_cached_vectors(texts) -> dict[str, np.ndarray]`로 감싸 쓴다. 호출이 없으니 세션 규칙 문제도 없다.

- [ ] **Step 1: 실패하는 시험 작성** (`test_sop_written.py`, 기존 `sop_demo_driver`·합성 fixture로 Old + 입구 match New 문서가 있는 Bundle)
  - `test_written_sentences_lists_match_doc_sentences_in_order`: 개수 = New 문서의 new_doc 최상위 target 수, `order_index` 오름차순, 칸 문장 없음
  - `test_written_sentences_reports_partner_target`: 한/영 짝 New Unit 둘의 target이 서로를 `partner_target_id`로 가리킨다
  - `test_written_sentences_shows_sources_after_link`: `/groups/save`로 Old U → T를 이은 뒤 T의 `source_unit_ids == [U]`
  - `test_new_candidates_same_language_only`: KO Unit의 후보가 모두 `lang == "ko"`
  - `test_new_candidates_ranks_identical_text_first`: 글이 같은 New 문장이 첫째, `basis == "text"`(임베딩 꺼짐)
  - `test_new_candidates_rejects_non_member`: 멤버가 아니면 403
  - `test_rank_new_candidates_prefers_embedding_when_cached`: 순수 함수, 두 벡터가 있으면 `basis == "embedding"`
- [ ] **Step 2: 실행해 실패 확인** — `cd backend && .venv/bin/python -m pytest tests/test_sop_written.py -q` → 404/ImportError로 FAIL
- [ ] **Step 3: `written.py`와 라우트 구현.** 질의는 Bundle당 한 번씩(N+1 금지, `select_in_chunks`). 응답 모델은 `schemas.py`나 라우터 근처에 둔다.
- [ ] **Step 4: 실행해 통과 확인** — 같은 명령 → PASS. `.venv/bin/ruff check app/ tests/` 깨끗
- [ ] **Step 5: 커밋** `feat(backend): written-sentence list and per-unit New candidates for Assign — 이미 쓴 문서 문장·New 후보 API`

### Task 2: 프런트 모델 — `link` 보낼 곳과 닫힌 묶음 저장

**Files:**
- Modify: `frontend/src/lib/classify-model.ts` (`Destination`, `RowDraft`, `buildGroupSave`, `readDestination`, `getDestinationId`)
- Modify: `frontend/src/lib/api-sop.ts` (`WrittenSentence`, `NewCandidate` 타입, `listWrittenSentences`, `listNewCandidates`)
- Create: `frontend/src/lib/assign-model.ts`
- Test: `frontend/src/lib/classify-model.test.ts`, `frontend/src/lib/assign-model.test.ts`

**Interfaces:**
- `Destination`에 `{ kind: "link"; targetIds: number[] }`를 더한다. `getDestinationId` → `link:<정렬한 ids>`.
- `RowDraft`에 `linkChangeTypes: Record<number, ChangeType | null>`(키 = target id, null = AI 제안 그대로 받기)를 더한다.
- `readDestination(group, unitIds)`: 줄 Unit을 출처로 둔 `origin="new_doc"` target이 있으면 `{kind:"link", targetIds}`. 칸 판정보다 먼저 본다(칸·연결이 둘 다면 연결).
- `buildGroupSave(draft, context, action, holdReason)`의 `link` 분기:
  - `units` = 줄 Unit 전부 `assigned`.
  - 줄 Unit을 출처로 둔 `origin="units"` target(칸 새 문장과 그 번역)은 `removed_target_ids`로 보낸다(바꾸기).
  - `context.group`의 `origin="new_doc"` target마다 새 출처를 계산한다: 지금 출처에서 줄 Unit을 빼고, `targetIds`에 들었으면 같은 `lang`의 줄 Unit을 더한다.
    - 새 출처가 비고 원래 줄 Unit만 출처였으면 → `removed_target_ids`(서버가 미배정으로 돌린다)
    - 고른 target → `{key:"t<id>", id, revision, kind, source_unit_ids, change_type}`. `change_type`은 `linkChangeTypes[id]`가 null이면 넣지 않는다(AI 제안 받기). undefined면 지금 사람 값, 없으면 `"rewritten"`.
    - 그 밖 → `{key, id, revision, kind, source_unit_ids}`(되보냄)
  - 줄과 관계없는 묶음 안 다른 target(다른 Old의 칸 새 문장 등)은 지금처럼 되보낸다. 묶음 밖 target은 넣지 않는다.
- `assign-model.ts`:
  - `mergeGroups(groups: Group[]): Group` — units·targets를 id로 중복 없이 합친다. 연결 저장 전에 줄 묶음 + 고른 target 묶음들을 합치는 데 쓴다.
  - `listCoConfirmed(group: Group, rowUnitIds: number[], picked: number[]): CoConfirmed[]` — `{kind:"unit"|"target", id, label}`. 줄 밖 Unit 판단과 고르지 않은 target 중 상태가 확정이 아닌 것만 넣는다.
  - `addPartnerTargets(picked: number[], rowLangs: UnitLang[], written: Map<number, WrittenSentence>): number[]` — 고른 문장의 `partner_target_id`가 있고 그 언어 Old Unit이 줄에 있으면 더한다.
  - `buildRecommendations(input): Recommendation[]` — `{kind:"link", targetIds, why, source:"ai"|"identical"|"similar"} | {kind:"place", destination, why, source:"ai"} | {kind:"delete", why, source:"ai"}`. 순서는 설계 §6이고, 같은 `targetIds`·`destination`은 한 번만, 최대 5.
  - `listUnsourced(written: WrittenSentence[]): WrittenSentence[]` — `kind="sentence"`, `source_unit_ids` 비었고 `change_type !== "new"`.
  - `clampZoom(z: number): number` (0.7~1.6, 0.1 단위 반올림), `clampSplit(r: number): number` (0.3~0.7)
  - `stepZoom(z: number, dir: "+"|"-"|"0"): number`

- [ ] **Step 1: 실패하는 시험 작성**
  - `classify-model.test.ts`
    - `link save echoes the sibling target of a split`: Unit U가 T1(확정 출처)이고 T2를 고름 → T1·T2 모두 `targets`에, 둘 다 `source_unit_ids` 포함 U
    - `link save removes the row's own slot sentence`: 칸 새 문장 S가 있던 줄을 연결로 바꾸면 S id가 `removed_target_ids`
    - `link save resets a new_doc target that loses its only source`: T1만 출처였던 줄을 T2로 바꿈 → T1이 `removed_target_ids`
    - `link save keeps other sources on a merged target`: T의 출처 [U1, U2], 줄 U2를 다른 T'로 → T 되보냄 `source_unit_ids [U1]`
    - `link save sends null change type as AI accept`: `linkChangeTypes[T]=null` → T에 `change_type` 키 없음
    - `readDestination prefers link`
  - `assign-model.test.ts`: `mergeGroups` 중복 제거, `listCoConfirmed`(합침의 다른 Old 포함, 확정된 것 제외), `addPartnerTargets`(짝 있음·없음·줄에 그 언어 없음), `buildRecommendations` 순서·중복·5개 상한, `listUnsourced`, `clampZoom`/`stepZoom`/`clampSplit` 경계
- [ ] **Step 2: 실행해 실패 확인** — `cd frontend && npx vitest run src/lib/classify-model.test.ts src/lib/assign-model.test.ts` → FAIL
- [ ] **Step 3: 구현** (위 시그니처, `api-sop.ts` 타입·호출 포함)
- [ ] **Step 4: 실행해 통과 확인**. `npx tsc --noEmit -p tsconfig.json` 깨끗
- [ ] **Step 5: 커밋** `feat(assign): link destination and closed-group saves — 연결 보낼 곳과 묶음 전체 저장`

### Task 3: 단계·주소 정리

**Files:**
- Modify: `frontend/src/lib/stages.ts`, `stages.test.ts`
  - `StageKey`의 `classify`·`match` → `assign`(step 3, path `/assign`)
  - `NEEDS_DOCUMENTS`, `NEXT_ACTION_STAGE`·`pickNextStage`가 assign으로 간다
  - `groupStages`·`StageSlot` 삭제
- Modify: `frontend/src/components/stage-nav.tsx`(그룹 칸 렌더 삭제), `styles/components.css`(`.stg-group`·`.stg.sub` 삭제)
- Modify: `frontend/src/components/app-shell.tsx`(넓은 화면 목록), 개요 등 `classify`/`match` 링크를 쓰는 곳(`git grep -n '"classify"\|"match"' frontend/src`)
- Replace: `frontend/src/app/bundles/[id]/classify/page.tsx`, `match/page.tsx` → `redirect(\`/bundles/${id}/assign\`)` 서버 컴포넌트(`next/navigation` `redirect`)
- Modify: `frontend/src/lib/ui-prefs.ts`·`ui-prefs.test.ts`·`components/user-menu.tsx`·i18n(`layout.classify`·`layout.paper`·`layout.list` 키 삭제) — `classifyLayout` 제거. `app/layout.tsx` 부트 스크립트가 목록을 읽으면 함께 고친다.
- 이 Task 끝에 임시로 `app/bundles/[id]/assign/page.tsx` = 지금 classify 페이지 내용을 옮긴 것(동작 유지, `layout` 분기는 paper로 고정). 그래야 각 Task 뒤에도 앱이 돈다.

- [ ] **Step 1: 실패하는 시험 수정·작성**
  - `stages.test.ts`: assign 하나, `pickNextStage`가 `targets_*`만 남아도 assign, `parseBundlePath("/bundles/3/assign")`
  - `ui-prefs.test.ts`: `classifyLayout` 없음
- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/lib/stages.test.ts src/lib/ui-prefs.test.ts`
- [ ] **Step 3: 구현**(위 파일들). `git mv` classify 페이지 → assign 페이지, classify·match 자리에 redirect
- [ ] **Step 4: 확인** — vitest 전체, tsc, `npm run lint`
- [ ] **Step 5: 커밋** `refactor(assign): one step-3 stage and route, drop the classify layout setting — 3단계 주소 하나로`

### Task 4: 가운데 두 칸 — Old 조각·New 원문·세로선·문서별 확대

**Files:**
- Create: `frontend/src/lib/assign-view-prefs.ts` (+ test)
  - `readAssignView(): { zoomOld: number; zoomNew: number; split: number }`, `writeAssignView(patch)` — localStorage `sopa.assign.zoomOld`·`zoomNew`·`split`
  - 읽기·쓰기는 try/catch이고, 실패하면 기본값 1·1·0.5를 쓴다. 값은 `clampZoom`/`clampSplit`를 거친다.
- Create: `frontend/src/lib/use-pane-zoom.ts`
  - `usePaneZoom(): { hovered: "old"|"new"|null; bind(pane): { onPointerEnter, onPointerLeave, onWheel } }` + 창 keydown(Ctrl/⌘ + `=`/`+`/`-`/`_`/`0`)
  - 가로채는 것은 `hovered`가 있을 때만이다. 입력 칸 포커스일 때는 무시한다.
  - Ctrl+휠은 `deltaY`를 모아 |40| 이상일 때 한 칸 움직인다. wheel 리스너는 `{ passive: false }`(React onWheel은 passive라 ref로 단다).
- Create: `frontend/src/components/assign/pane-divider.tsx`
  - `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow`, `tabIndex=0`, `data-testid="assign-divider"`
  - pointer capture로 끌기, 더블클릭이면 0.5, ←→이면 ±0.03
- Create: `frontend/src/components/assign/old-pane.tsx`
  - 문서 선택 `Select`(Old 문서 둘 이상일 때), 확대 −/+ (`assign-old-zoom-in/out`)
  - `Paper`를 `strips`+`contour`로 그린다. 상태 표시는 `cover status`(확정 ✓, AI 제안 ✦, 보류 H 태그는 기존, 미배정 ○)이고, 확정 조각 아래에 간 곳 한 줄을 단다.
  - Shift+클릭은 일괄 고르기, 그냥 클릭은 줄 고르기.
- Create: `frontend/src/components/assign/new-pane.tsx`
  - 문서 선택 `Select`(이미 쓴 문서 둘 이상), 확대 −/+
  - 문장 줄은 번호·KO/EN 태그·출처 칩(`← 1-012`)·`신규`로 그린다. 상태 클래스는 후보(점선)·고름(채움)·출처 없음(위험색)이다.
  - 표·그림은 회색 상자로 두고 고를 수 없다.
  - 클릭이면 `onPick(targetId, additive)`, Ctrl/⌘+클릭이면 additive.
- Modify: `frontend/src/components/paper/paper.tsx` — 선택 prop 둘을 더한다.
  - `renderUnitMark?: (unitId) => ReactNode`: 있으면 strips 끝 표시를 대신한다.
  - `renderUnitNote?: (unitId) => ReactNode`: 조각 아래 한 줄.
  - Split 동작은 그대로 둔다.
- Modify: `frontend/src/styles/components.css` — `.assign-desk`, `.assign-panes`(grid `minmax(0,var(--split)) 12px minmax(0,1fr)`), `.pane-divider`, `.pane-zoom`, `.new-line` 상태 클래스. 목업 값을 토큰으로 옮긴다.

- [ ] **Step 1: 실패하는 시험** — `assign-view-prefs.test.ts`: 저장값 읽기, 범위 밖 값 자르기, localStorage가 던질 때 기본값
- [ ] **Step 2: 실패 확인** → **Step 3: 구현** → **Step 4: vitest·tsc·lint 통과**
- [ ] **Step 5: 커밋** `feat(assign): side-by-side Old and New panes with divider and per-pane zoom — 두 문서 나란히·폭·문서별 확대`

### Task 5: 오른쪽 칸 — 범례·고른 곳·함께 확정·아코디언·다른 언어 만들기

**Files:**
- Create: `frontend/src/components/assign/assign-legend.tsx` — `AssignLegend`(전체)와 `LegendButton`(오른쪽 위 (i), 호버·포커스 팝오버, `data-testid="assign-legend-button"`). 기존 `Tooltip`과 같은 floating 규칙.
- Create: `frontend/src/components/assign/destination-accordion.tsx` — 4단, `data-testid="assign-acc-<ai|near|all|move>"`
  - ① 추천: `buildRecommendations` 카드(`assign-rec-<i>`)
  - ② 가까운 곳: 맨 위 연결 후보의 같은 문서 앞뒤 문장, 또는 맨 위 칸과 같은 To-Be 문서의 다른 칸
  - ③ 전체: 이미 쓴 문서 → 절 → 문장 / 안 쓴 문서 → 칸·단계(지금 `buildDestinationOptions`). 한 단계씩 펼치고, N/A는 비활성.
  - ④ 삭제·외부 이동
- Create: `frontend/src/components/assign/chosen-box.tsx`
  - 고른 곳을 보인다: 연결이면 문장들과 언어별 변경 종류(그대로·말투·고쳐 씀, 나눔·합침 자동 표시), 칸이면 지금 분류의 새 문장 칸 편집, 삭제·이동이면 사유.
  - "함께 확정되는 것" 목록(`listCoConfirmed`)과 "다른 곳에도 추가"(두 문서 보내기, 사유 칸)를 둔다.
  - "영어 만들기/한국어 만들기"는 칸 배정이 확정됐고 그 줄에 한 언어만 있을 때 보인다. AI가 켜져 있으면 `askAi("translate", {unit_ids, direction})`, 꺼져 있으면 빈 다른 언어 새 문장 칸을 열어 저장한다(`buildGroupSave`의 새 칸 `u<id>`와 같은 길로, 번역 target이 아니라 같은 자리의 다른 언어 새 문장 — 서버가 받는지 Step 1 시험으로 확인한다. 안 받으면 AI 꺼짐일 때 단추를 숨기고 ledger에 Ruling).
- 오른쪽 칸 상태: 줄 없음 → `AssignLegend` 전체 + "Old 조각을 고르세요". 줄 있음 → 머리(ID·상태 칩·원문) + `LegendButton` + 고른 곳 + 확정/보류/비우기 + 아코디언. 출처 없는 New 모드 → New 문장 머리 + "신규로 표시"(`assign-mark-new`) + 안내.

- [ ] **Step 1: 실패하는 시험** — 화면 부품은 순수 모델로 시험한다.
  - `assign-model.test.ts`에 `pickNearby(written, targetId, 1)` 앞뒤 문장을 더한다.
  - `listSiblingPlaces(options, destination)`
  - `canMakeOtherLanguage(rowLangs, destination, confirmed)`
- [ ] **Step 2~4**: 실패 확인 → 구현 → vitest·tsc·lint
- [ ] **Step 5: 커밋** `feat(assign): destination panel with legend, accordion and co-confirm list — 오른쪽 칸`

### Task 6: Assign 페이지 조립

**Files:**
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx` (Task 3에서 옮긴 분류 페이지)
  - 왼쪽 목록·가운데 용지·`layout` 분기를 지우고 `.assign-desk`(막대 + OldPane + PaneDivider + NewPane) + 오른쪽 칸으로 바꾼다.
  - 줄 모델·초안·저장·보류·비우기·AI 메뉴·일괄 모달·`useLeaveGuard`·키(↑↓/J/K/↵/E/H/U/Esc)는 그대로 쓴다.
  - 연결 저장 전에 `mergeGroups([줄 묶음, ...고른 target 묶음(getGroupByTarget)])`로 context를 만든다.
- 막대(`assign-bar`):
  - 거르기 칩 `assign-filter-<unassigned|ai_suggested|on_hold|confirmed|all|unsourced>`와 진행
  - 똑같은 문장 일괄(`assign-identical`, `listIdenticalCandidates`, 지금 match 페이지 로직)
  - AI 요청 메뉴(분류·번역·짝: 지금 두 페이지 메뉴를 합침)
  - New 원문 열기/닫기(`assign-toggle-new`, 이미 쓴 문서가 없으면 숨김)
- New 원문 자동 열기 규칙(설계 §3.3): 사람이 토글하면 그 줄 동안 사람 값을 따른다.
- 출처 없는 New 모드: New 칸 클릭은 그 문장 고르기, Old 조각 클릭은 출처로 잇기(`getGroupByTarget` + Unit 묶음을 합쳐 `link` 저장의 역방향: 줄 = 그 Old Unit, `targetIds=[고른 New]`). "신규로 표시"는 `/match/bulk-confirm`의 `new`.
- 확정 뒤 `findNextOpen`, 고른 조각은 화면 가운데로 스크롤(`shouldRecenter` 재사용).
- `written-sentences`는 저장·AI 작업이 끝날 때마다 다시 부른다(`unitsKey`와 같은 키).
- Delete: `frontend/src/lib/match-model.ts`에서 이제 안 쓰는 함수(쓰는 것은 assign-model로 옮기고 시험도 함께), `components/classify/destination-picker.tsx`(아코디언이 대신하면).

- [ ] **Step 1**: 스모크 시나리오를 먼저 고친다(`frontend/scripts/pw-smoke-sop.mjs`의 classify·match 단계 → assign). 목업 따라가기와 같은 순서로 카드 연결·원문 클릭·나눔(Ctrl)·칸 배정·전체에서 고르기·삭제·출처 없는 New 신규·Ctrl+휠 확대(Old만 바뀜)·세로선 키보드를 넣는다. 지금은 FAIL이 정상이다.
- [ ] **Step 2: 구현**
- [ ] **Step 3: 확인** — vitest·tsc·lint·`npm run build`(경고 0). 로컬 서버(reset_db → seed_sop_demo)에서 `pw-smoke-sop`·`pw-smoke-baseline` ALL PASS
- [ ] **Step 4: 커밋** `feat(assign): assemble the unified Assign screen — Assign 화면 조립`

### Task 7: 문구·검증 스크립트·문서·버전

**Files:**
- Modify: `frontend/src/lib/i18n-messages.ts` — `assign.*`(en·ko), 안 쓰는 `classify.*`·`match.*` 삭제, `stage.assign` = "Assign"/"배정"
- Modify: `frontend/scripts/pw-contrast-audit.mjs`(classify·match 화면 → assign: 줄 없음·연결 고름·출처 없는 New), `pw-manual-shots.mjs`, `docs/manual/system-walkthrough.html`(분류·짝 맞추기 장을 Assign 한 장으로), `docs/manual/img/*` 다시 뽑기
- Modify: `CLAUDE.md`(frontend 핵심의 classify-model/match-model 설명, 상태 줄 v0.10.0), `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`는 바꾸지 않는다(제품 명세). 대신 `docs/README.md` 색인 확인
- Modify: `frontend/package.json` 0.10.0(`npm version minor --no-git-tag-version`), `CHANGELOG.md` v0.10.0(v0.9.0 미배포 메모 포함), `PROGRESS.md`

- [ ] **Step 1**: 문구 정리 → `npx vitest run src/lib/i18n-messages.test.ts` 통과
- [ ] **Step 2**: 대비 감사 ALL PASS(라이트·다크), 설명서 그림 다시 뽑기
- [ ] **Step 3**: 전체 검증 — backend pytest 전체·ruff, frontend vitest·tsc·lint·build, 스모크 둘
- [ ] **Step 4: 커밋** `chore(release): v0.10.0 — unified Assign screen — Assign 통합 화면 릴리스`
