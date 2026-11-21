# Assign 시안 1 설계 — 고름 · 처리 중 · 따라가기 한 곳, 다시 받기 범위, 박스 모양

2026-11-20. 사용자가 확정한 시안 1(2026-11-19, 아티팩트 v4 `https://claude.ai/artifact/EjnLRVJFB7RajXZ5TiwyH2`)을 구현 단위로 적는다. 요청서는 `docs/superpowers/handoff/2026-11-19-paragraph-split-requests.md`의 1 · 5 · 9 · 13 · 15번과 "시안 1 피드백" · "시안 1 확정", 바탕은 신뢰 기반 계획 스텝 4-3(지운 계획 문서의 내용은 요청서 `docs/superpowers/handoff/2026-11-19-paragraph-split-requests.md` "분류 메모"로 옮겼다). 3번(번호 칸 폭)은 v1.2.6에 끝났다 — 여기서는 다루지 않는다. 시안이 정한 것은 다시 정하지 않고, 시안이 답하지 않은 것만 끝의 "확인할 것"에 둔다.

## 왜

- **"반응이 없다 · 답답하다"(9 · 13)**: 붙이기 한 번에 쓰기 1번 + 다시 받기 N+8번 이상(아래 표)이고, 누르는 순간 화면에 아무 표시가 없다.
- **결정 칸이 범례로 갔다 돌아온다(9)**: 편집 응답이 오면 고름을 지우고(`setSelectedKey(null)`) 모든 문서를 다시 받은 뒤에야 다시 고른다.
- **짝의 아래 박스를 눌러도 위 박스가 잡힌다(1)**: 화면이 "짝 한 줄(row)"을 고르고 그 줄의 첫 Unit을 용지에 넘긴다(`page.tsx:536` `row?.unitIds[0]`). 떨어진 짝(1↔4, 2↔5, 3↔6)에서 4를 누르면 1이 잡힌다.
- **결정 칸으로 카드가 날아간다(15)**: 0.36초 그림자 비행(`pick-flight.ts`)이 정신 사납다.
- **삭제 박스가 평소 크기(5)**: 확정 · 삭제된 박스도 평소 박스에 빨간 `Deleted` 메모만 붙는다(`page.tsx:368-378`).
- **구조 신호**: 고름 · 따라가기 · 처리 중이 `useAssignPage()` 안 네 군데에 흩어져 "사라진 Unit을 고르는" 고침이 거듭됐다(v1.1.51 · v1.1.53 · v1.2.2, 스텝 4-3). 이 셋을 순수 모델 하나가 쥐면 규칙을 vitest로 잴 수 있고, 나머지 기능 훅의 입력이 좁아진다.

## 지금 구조 (2026-11-20 `dev`, 줄 번호는 `frontend/src/` 기준)

**고름** — `app/bundles/[id]/assign/use-assign-page.tsx`
- 줄 고름 `selectedKey`(줄 키) → `activeKey` → `row` `:354-356`. 짝이면 줄 하나에 Unit이 여럿이고, 용지는 `row.unitIds[0]`을 고른 박스로 받는다(`page.tsx:536`), 짝 전체는 `highlightIds`(`page.tsx:293`)로 `data-sel`을 받는다.
- 고름의 다른 갈래가 따로 산다: 한 단 New 문서 `solo` `:360-364`, 목차 블록 `tocSel` `:367`, 짝을 푼 뒤 남은 줄로 옮기기 `splitRow` `:391-399`.
- 고르기 함수: `selectRow` `:896-911`, `selectToc` `:881`, `selectNewSentence` `:931`, `openSolo` `:959`, `goToUnit` `:981`. J/K는 줄 키 순서 `navKeys`(`:372-378`, `lib/toc-block-model.ts` `buildNavKeys`).

**따라가기** — `follow` `:426-437`(Old), `soloFollow` `:382-389`(New 문서), 거는 곳 `followUnit` `:975-978`. 렌더 중 상태 맞추기로, **모든 Old 문서 보기와 전체 Unit 목록이 둘 다 새로 와야**(`viewList !== staleViews && units.data !== staleUnits`) 줄을 고른다. 사람이 다른 줄을 고르면 `selectRow`가 `follow`를 버린다(`:898`).

**처리 중** — 화면 전체 하나 `busy` `:699`. 편집 · 저장 함수마다 `if (busy) return` 뒤 `setBusy(true)`: `runUnitEdit` `:1198`, `runPairChange` `:1297`, `runCaptionRefChange` `:1316`, `switchToPair` `:1346`, `applySplitSuggestion` `:1386`, `dismissSplitSuggestion` `:1417`, `runSave` `:1624`, `runClear` `:1729`, `runUndoStep` `:1789`, `acceptAll` `:1875`, `runPairDrop` `:2718`. 누르는 순간의 표시는 없고 단추만 꺼진다. 응답 전후로 고름을 지우는 곳: `:1224` · `:1303` · `:1377` · `:1402` · `:1808` · `:2729` · `:2754`.

**다시 받기** — `reloadAfterEdit` `:1189-1194`: `views.reload()`(모든 Old 문서 보기, `:237-240`) + `setUnitsKey`(→ `dataKey` `:242`) + `loadBundle`. `dataKey`에 걸린 것이 모두 다시 돈다. 고른 줄의 묶음 · 후보 키(`rowKey` `:445`)에도 `unitsKey`가 있어 고른 줄이 그대로여도 다시 받고, 보기를 받는 동안(`isViewSettled` `:444`)은 결정 칸의 묶음 · 후보가 로딩으로 남는다.

### 잰 다시 받기 — 붙이기(Join, `merge`) 한 번

코드에서 센 것(`runUnitEdit` → `finally`의 `reloadAfterEdit`). Old 문서 N개, 한 단 New 문서 닫힘, 판단 안 걸림 기준.

| # | 요청 | 걸린 곳 |
|---|---|---|
| 1 | `GET …/documents/{id}/view` × **N**(모든 Old 문서) | `views.reload()` `:237` |
| 2 | `GET …/units?limit=1000&offset=…`(전체, 1000개마다 한 번) | `units` `:243` |
| 3 | `GET …/tobe` | `tobe` `:245` |
| 4 | `GET …/written-sentences` | `writtenList` `:250` |
| 5 | `GET …/match/identical-candidates` | `identical` `:251` |
| 6 | 분류 제안 목록 | `suggestions` `:263` |
| 7 | 묶기 적용 제안 목록 | `matchSuggestions` `:264` |
| 8 | 무효 분류 제안 목록 | `invalidSuggestions` `:266` |
| 9 | `GET …/bundles/{id}` | `loadBundle` `:1193` |
| 10 | 그 문서 나누기 제안 (AI 켬) | `splitSuggestions` `:544` |
| 11 | 엮은 New 문서 (템플릿 · 엮은 문서가 열렸으면) | `composed` `:620-623` |
| 12 | `GET /sop/remarks/recent` × 보이는 Remark 줄 수 | `RemarkLine reloadKey={unitsKey}` (`assign-side-panel.tsx:528` · `:821`) |
| 13 | 시트 미리 보기 (Space가 열렸으면) | `SpacePreview unitsKey` (`page.tsx:441`) |
| 14 | 따라간 줄의 `groups/by-unit` × 줄 Unit 수, `new-candidates` × 문장 Unit 수 | `rowKey`에 `unitsKey` `:445-452`, `pickedGroups` `:508` |

곧 **쓰기 1 + 읽기 N+8 이상**(AI · 열린 칸에 따라 N+13까지, 그 뒤 고른 줄의 묶음 · 후보). 표 벗기기 · 캡션 편집은 전환을 위해 그 문서 보기를 먼저 한 번 더 받고(`:1234`) 다시 1번에서 또 받는다. 참조 풀기 + 언어(`:1212`), 짝으로 바꾸기(`:1356`), 짝 놓기 Undo(`:2747`)도 보기를 한 번 더 받는다. 판단 저장(`runSave` 등)은 보기를 빼고 2–8 · 10–14를 받는다.

**결정 칸 비행** — `pickSeq` · `flightRef` `:694-695`, 효과 `:2998-3011`(rAF → `scrollIntoView` → `runPickFlight`), 클릭 캡처 `:3014-3017`, `components/assign/pick-flight.ts`(`FLIGHT_MS = 360`, `.pick-ghost` · `data-landing`). 같은 자리 쉬머는 이미 있다 — `components/ui/motion.tsx:312` `Refresh`(`styles/motion.css:59-68`, 700ms). 단 이 700ms는 토큰이 아니라 움직임 줄이기(`styles/tokens.css:251`)에서 꺼지지 않는다.

**용지** — `components/paper/paper.tsx`: 짝 구성원 `matesOf` `:333-346`(떨어진 구성원 포함), 한 카드 `brackets` `:347-356`(`lib/strip-pill-model.ts` `getPairBrackets` — 끊김 없이 이어진 같은 짝만), 고른 카드 `selectedBlock` `:430-439`, 줄 끝 짝 표시 `Link2`(`lib/paper-model.ts:269` mark `pair`), 고른 박스 위아래 틈의 묶기 단추 `:682-707`, 목차 블록 `renderTocBlock` `:1056`(삭제 박스 접기의 본보기).

**끌기** — 공용 엔진 `lib/box-drag.ts`(`buildCard` · `applyHover` `:130-160`: 표에 id · 글 · 개수 · **사유 알약** `drag-card-note`) + `lib/use-box-drag.ts`. 쓰는 곳 다섯: Assign 잇기 · 보내기 · 짝 · 템플릿 · 캡션 `dragConfig` `use-assign-page.tsx:2510-2647`, Pair view `pairDragConfig` `:2681-2715`, Order `components/outputs/output-c.tsx:714`, To-Be 상위 문서 `components/tobe/tobe-section.tsx:403`, Documents 올리기 창 `components/documents/upload-modal.tsx:139`. 놓을 자리 표시가 화면마다 다르다 — 점 달린 선 `.c-dropline`(`styles/components.css:2282-2283`, Order · Assign 보내기 `components/assign/drop-gap-line.ts`), 템플릿 틈 `showTemplateGap` `:2422`, 상자 테두리 `data-drop`, 출발 → 포인터 점선 `components/assign/drag-link-line.ts`. 끄는 동안 원래 박스 흐림(`[data-drag-src] { opacity: .45 }`, `motion.css:101`)은 모두 같다. 가까운 짝 놓기는 한/영 연달아 문서만(`readPairAt` `:2665`).

## 결정

### D1 상태 한 곳 — `lib/assign-focus-model.ts`(순수) + `lib/use-assign-focus.ts`(훅)

```ts
/** 고름은 박스(Unit) 하나 - 짝은 고름이 아니라 곁에 딸린 표시다 */
export type Focus =
  | { kind: "none" }
  | { kind: "unit"; unitId: number }                                          // Old 박스(묶음 칸 · 캡션은 resolvePickUnit으로 올린 것)
  | { kind: "toc"; docId: number; key: number; unitId: number | null }        // 목차 블록 · 그 줄
  | { kind: "new"; docId: number; unitId: number | null; inPlace: boolean };  // 한 단 New 문서 · 양 단 New 문장

export type PendingKind = "join" | "split" | "unmerge" | "unwrap" | "rewrap" | "pair" | "unpair" | "lang" | "heading" | "ref" | "caption" | "toc" | "figure" | "save" | "undo" | "bulk";
export type PendingPlace = { at: "gap"; firstId: number; secondId: number } | { at: "box"; unitId: number } | { at: "table"; tableId: number } | { at: "none" };
export interface Pending { id: string; kind: PendingKind; docId: number | null; unitIds: readonly number[]; place: PendingPlace; isGlobal: boolean }

/** 응답 뒤 고를 박스 - 그 문서 보기가 revision 이상으로 다시 오면 고른다. from은 누른 때의 고름 */
export interface Follow { pendingId: string; docId: number; minRevision: number | null; pickUnitId: number | null; from: Focus }

export interface FocusState { focus: Focus; pending: readonly Pending[]; follows: readonly Follow[] }

export type FocusEvent =
  | { type: "pick"; focus: Focus }                                           // 사람이 고름
  | { type: "start"; pending: Pending }
  | { type: "succeed"; pendingId: string; docId: number; revision: number | null; pickUnitId: number | null }
  | { type: "fail"; pendingId: string }
  | { type: "loaded"; docId: number; revision: number; liveUnitIds: ReadonlySet<number>; liftUnit: (id: number) => number | null };

export function reduceFocus(state: FocusState, event: FocusEvent): FocusState;
export function isUnitLocked(state: FocusState, unitId: number): boolean;
export function canStart(state: FocusState, pending: Pending): boolean;
```

규칙(모두 vitest로):
1. **고름은 Unit 하나.** 줄(`row`)은 고름에서 파생한다 — `rowKey = rowOfUnit.get(focus.unitId)`. 초안 · 체크 · 그 자리 메뉴처럼 줄 단위인 것은 그대로 줄 키를 쓰고, Old 우클릭 메뉴(`ctxMenu`)는 Unit이 바뀌면 닫는다.
2. **처리 중에도 고름은 그대로.** `start`는 `focus`를 바꾸지 않는다(지금의 `setSelectedKey(null)` 일곱 곳은 없어진다).
3. **따라가기.** `succeed`는 `Follow`를 건다(`pickUnitId` = 응답의 첫 새 Unit — 합친 박스, 나눈 앞 조각 — 없으면 호출이 준 `followId`). `loaded`가 그 문서의 revision ≥ `minRevision`으로 오면, **고름이 여전히 `from`과 같을 때만** `pickUnitId`(살아 있지 않으면 `liftUnit`으로 묶음까지 올린 것)를 고른다. 사람이 그 사이 다른 박스를 골랐으면 따라가지 않는다(지금 `selectRow`의 `setFollow(null)`과 같은 뜻). `pickUnitId`가 없으면 고름을 둔다.
4. **실패.** `fail`은 그 `Pending`만 걷고 고름 · 따라가기는 건드리지 않는다. 알림은 훅이 띄운다(지금과 같은 `humanizeApiError`). 확인 창(`confirm_required`)으로 되물을 때도 `fail`과 같다 — 확인하면 새 `Pending`으로 다시 보낸다.
5. **사라진 Unit을 고르지 않는다.** `loaded`에서 `focus.unitId`가 그 문서의 살아 있는 Unit이 아니고 그 Unit을 기다리는 `Follow`도 없으면 `none`.
6. **잠금.** 처리 중인 `Pending`의 `unitIds`만 잠긴다(`isUnitLocked`). `canStart`는 잠긴 Unit과 겹치는 일과, `isGlobal` 일(초기화 · 일괄 수락 · 같은 글자 일괄 확정 · 일괄 삭제/이동 · Assign Undo/Redo)을 다른 일과 함께 시작하지 않는다.

훅 `useAssignFocus()`는 `useReducer(reduceFocus)`와 `runPending(pending, send, after)` 하나를 낸다 — `send`를 문서별 줄(D4)에 넣고, `start` → 응답 → `succeed`/`fail` → `planReload`(D2) 실행 → 알림까지. `loaded`는 다시 받기 훅(D2)의 응답 콜백에서 보낸다 — 화면 파일에 effect를 더하지 않는다. `follow` · `soloFollow` · `splitRow` · `busy` · `pickSeq` · `flightRef`는 이 훅으로 흡수되고, 남는 화면용 이름은 `focus` · `row`(파생) · `isUnitLocked` · `isAnyPending` · `runPending`이다.

### D2 다시 받기 범위 — `planReload`(같은 모델 파일) + `lib/use-doc-views.ts`

- **문서별 보기 · 줄.** `use-doc-views.ts`가 Old 문서 보기를 `Map<docId, DocumentView>`로 쥐고 `reloadDocs(ids)`가 그 문서만 다시 받는다. Unit 목록은 같은 훅이 쥐고 `reloadUnits(docId)`가 `GET …/units?document_id=`(서버에 이미 있다, `routers/sop_decisions.py:63`)로 **그 문서의 줄만 바꿔 끼운다**. `listAllUnits(bundleId, docId?)`에 인자 하나를 더한다. 전체 다시 받기(`reloadAll`)는 AI 작업 끝 · 판단 저장용으로 남긴다.
- **키를 나눈다.** `dataKey` 하나 대신 `unitsKey`(전체) · `tobeKey` · `writtenKey` · `suggestKey` · `savesKey`(Remark 최근 목록). 고른 줄의 묶음 · 후보 키는 `unitsKey` 대신 그 줄 Unit들의 `decision.revision`으로 — 고른 줄이 안 바뀌었으면 다시 받지 않는다. `SpacePreview`는 그 문서의 보기 revision을 키로.
- **편집 전 보기 한 번 더 받기**(`:1212` · `:1234` · `:1356`)는 다시 받기 훅의 `reloadDocs`가 돌려주는 새 보기를 쓴다 — 같은 문서를 두 번 받지 않는다.

```ts
export type ReloadCause =
  | { kind: "old_edit"; docId: number; isInPlace: boolean; isReleased: boolean }  // isReleased = confirm으로 판단을 풀며 보냈다
  | { kind: "new_edit"; docId: number }
  | { kind: "pair"; docId: number }
  | { kind: "caption_ref"; docId: number }
  | { kind: "split_suggestion"; docId: number; isApplied: boolean }
  | { kind: "edit_undo"; docId: number | null };
export interface ReloadPlan { docs: number[]; newDoc: number | null; tobe: boolean; written: boolean; identical: boolean; splitSuggestions: number | null; bundle: boolean }
export function planReload(cause: ReloadCause, ctx: { aiOn: boolean }): ReloadPlan;
```

| 편집 | 기다림(따라가기가 기다리는 것) | 뒤에서(고름을 막지 않음) |
|---|---|---|
| Old 구조 편집, 판단 안 걸림 — `split` · `merge` · `unmerge` · `carve` · `move_boundary` · `set_heading` · `clear_noise` · `set_layout_table` · 캡션 붙이기/떼기/첫 행 · 그림 묶기/풀기 | 그 문서 보기 + 그 문서 줄 | Bundle · 같은 글자 후보 · (AI 켬) 그 문서 나누기 제안 |
| 제자리 편집 — `set_language` · `set_ref` · `clear_ref` · `set_number` | 그 문서 보기 + 그 문서 줄(따라가기 없음) | Bundle |
| 위 둘 + `confirm`(판단을 풀었다) | 같음 | + To-Be · New 문장 목록 · 엮은 문서(열렸으면) · 같은 글자 후보 |
| 짝 맺기 · 풀기 · 확정 · 짝 놓기 Undo · 짝으로 바꾸기 | 그 문서 보기 + 그 문서 줄 | Bundle |
| 표 · 그림 참조 떼기 · 잇기 | 그 문서 보기 | — |
| AI 나누기 제안 적용 / 버리기 | 적용: Old 구조 편집과 같음 / 버리기: 그 문서 보기 | 그 문서 나누기 제안 |
| New 문서 편집(한 단 · 양 단) | 그 New 문서 보기 + New 문장 목록 | To-Be · 엮은 문서(열렸으면) |
| 편집 Undo · Redo | 응답의 문서 보기 + 그 줄(문서를 모르면 지금처럼 모든 Old 문서) | Bundle · 같은 글자 후보 |

분류 · 묶기 · 무효 제안 목록과 Remark 최근 목록은 편집 뒤 받지 않는다(편집이 바꾸지 않는다 — 은퇴한 Unit의 제안은 줄이 없어 저절로 안 보인다). 붙이기 한 번은 **쓰기 1 + 기다림 2(그 문서 보기 · 그 문서 줄) + 뒤에서 2–3**이 된다.

### D3 짝 고름과 안내 줄 (1번)

- **누른 박스를 고른다.** 용지 `selectedId`는 `focus.unitId`다(`page.tsx:536`의 `row?.unitIds[0]`를 없앤다). 짝의 다른 구성원은 `data-sel` 대신 `data-mate`(흐린 테두리)를 받는다. New 칸 · 이음 선의 강조(`highlightIds`)는 지금처럼 줄 전체다 — 보낼 곳 · 확정은 짝 전체가 한 번에 간다.
- **결정 칸 Shape는 누른 박스 먼저.** `shapeTabs.order`에서 고른 Unit을 맨 앞으로(나머지는 문서 순서). 합치기 순서(`switchShapeMode`)는 문서 순서 그대로.
- **떨어진 짝은 제자리.** 위로 모아 보이지 않는다. 고른 박스의 줄 끝 짝 표시(`Link2`)를 켜고, 고른 박스 바로 아래 흐린 한 줄 `↑ 짝 KO · 위 §1`(en `↑ Pair KO · above §1`)을 그린다 — 화살표 = 짝이 위/아래, 언어 = 짝의 언어, 자리 = 짝의 번호 칸 값(없으면 표시 ID). 누르면 짝의 원래 자리로 스크롤하고 그 박스를 고른다(거기서는 반대 방향 안내). 한/영 따로 쓴 문서(`ko_en_separate`)도 같다. 같은 카드 안에 이어 붙은 구성원은 안내하지 않는다. 떨어진 구성원이 여럿이면 가장 가까운 하나와 `+n`.
- 규칙은 순수 `lib/pair-hint-model.ts` `getPairHint(selectedId, mates, brackets, labelOf)` — `{ dir, lang, where, targetUnitId, more } | null`.
- **J/K는 박스 하나씩.** 평소 Old 칸에서 줄 키 대신 박스(Unit) 순서로 걷는다 — `buildNavKeys`가 줄의 Unit을 용지 순서로 펼친 목록을 낸다(목차 블록 · 거르기 스냅숏 규칙은 그대로). Pair view는 한 줄에 두 언어가 나란하므로 지금처럼 줄 단위다.

### D4 처리 중 표시 (9 · 13번)

- **누르는 즉시**(지연 없음, `useDelayedFlag`를 쓰지 않는다) `Pending`이 서면 용지가 그린다: 처리 중인 박스에 `data-pending`(빛이 지나가는 쉬머, CSS만 · 되풀이), 자리에 알약 하나.

| 일 | 알약(en / ko) | 자리 |
|---|---|---|
| 붙이기 · 틈의 묶기 | Joining… / 붙이는 중… | 두 박스 사이 틈 |
| 나누기 · AI 나누기 적용 | Splitting… / 나누는 중… | 그 박스 |
| 표 벗기기 · 다시 표로 | Unwrapping… / 벗기는 중… · Wrapping… / 다시 묶는 중… | 표 머리 |
| 짝 맺기 · 풀기 · 놓기 | Pairing… / 짝 맺는 중… · Unpairing… / 짝 푸는 중… | 앞 박스(틈에서 했으면 틈) |
| 언어 · 참조 · 번호 · 제목 · 캡션 · 그림 · 목차 아님 | Saving… / 저장 중… | 그 박스 |

- **잠금은 그 박스만.** 잠긴 박스는 끌기 · 틈 단추 · 우클릭 메뉴 · 고르기를 받지 않는다. 다른 박스 고르기 · 스크롤 · 다른 박스의 편집은 막지 않는다. 판단 저장(`save`)은 그 줄의 Unit을 잠그되 알약은 그리지 않는다(결정 칸 단추의 지금 표시 그대로). `isGlobal` 일 동안은 지금처럼 모두 꺼진다.
- **같은 문서의 쓰기는 줄을 선다.** 같은 revision으로 두 쓰기가 나가면 둘째가 409가 된다 — `lib/doc-write-queue.ts`(문서마다 하나씩, `lib/c-save-queue.ts`와 같은 짜임)가 앞 응답 뒤에 보낸다(revision은 `doc-revision.ts`가 이미 이어 준다). 줄 서는 동안에도 알약 · 쉬머는 바로 보인다. 앞 일이 뒤 일의 Unit을 은퇴시켰으면 서버 거절 → `fail` → 알림.
- **실패**: 쉬머가 멈추고 박스가 제자리(용지는 응답 전 보기 그대로였다), 오른쪽 위 알림.
- 움직임 줄이기: 쉬머 대신 옅은 바탕만, 알약은 그대로.

### D5 결정 칸 쉬머 (15번)

- 비행을 걷는다 — `pick-flight.ts`, `pickSeq` · `flightRef` · 클릭 캡처, 효과 `:2998-3011`(effect 1 · rAF 1 · `pick-flight.ts`의 타이머 1이 기준선에서 빠진다).
- 고른 곳 상자(`assign-chosen`)를 `Refresh`로 감싸 token = `고른 Unit:보낼 곳 키` — 보낼 곳을 고르거나 바꾸면 빛이 한 번 쓸며 내용이 바뀐다. 다른 박스를 골라 결정 칸 전체가 바뀔 때는 결정 칸 몸통을 `Refresh`(token = 고른 Unit)로 같은 쉬머. `scrollIntoView`를 하지 않는다(스크롤 튐 없음).
- 움직임 줄이기: `motion.css` `.refresh-sweep`의 700ms를 토큰 `--dur-refresh`로 바꾸고 `tokens.css` 줄이기 블록에서 0, 줄이기면 쓸기를 그리지 않는다. 다른 화면의 `Refresh`(AI 지침 · AI 작업 관리 칸 두 곳)도 같이 따른다 — 같은 부품이라 맞는 방향이다.

### D6 삭제 박스 접기 (5번)

- 확정 · `disposition === "delete"`인 줄은 목차 블록처럼 흐린 한 줄로 접는다: `DELETED · 종류 · 앞부분 글`. 종류는 `KO/EN`(짝) · `KO` · `EN` · `TABLE` · `FIGURE`. `DELETED` 태그만 반투명 빨강, 나머지는 흐림. Remark가 있으면 툴팁(`data-tip`, 용지의 `useDelegatedTip`).
- 누르면 그 줄을 펼치고 고른다 — 결정 칸에서 살피고 배정을 풀 수 있다(배정을 풀면 다시 평소 박스). 펼침은 화면을 연 동안만(`tocOpen`과 같은 짜임), 고른 박스는 늘 펼친다.
- 짝 카드 · 표 · 그림 모두 줄 하나로 접힌다. 접힌 줄은 끌기 · 틈 단추를 받지 않는다.
- 규칙은 순수 `lib/deleted-fold-model.ts` `buildDeletedFolds(rows, unitMap, { filter, open, focusUnitId })` → 접을 줄 키와 한 줄 내용. 용지는 `strips.deleted`(목차의 `strips.toc`와 같은 모양)로 받아 그리기만 한다. `page.tsx`의 `placeOf` 삭제 메모(`:372-378`)는 접힌 줄이 대신한다.
- "Deleted" 거르기 탭에서는 펼친 채 — 확인할 것 1.

### D7 끌어 놓기 모양 통일 — `lib/box-drag.ts` · `use-box-drag.ts`

모든 끌기(Assign 잇기 · 보내기 · 짝 · 템플릿 · 캡션, Pair view, Order, To-Be 상위 문서, Documents 올리기 창)가 공용 엔진 하나를 쓰므로 모양은 엔진과 공용 선 하나에서 바꾼다.

- **원래 박스는 흐리게 남는다** — 지금 그대로(`[data-drag-src]`).
- **표는 작은 한 줄 카드** — `id · 글(말줄임) · 개수`. 사유 알약 `drag-card-note`를 없앤다. `DragHover.note`는 남기되 화면 밖 상태 글 `role="status"`(`data-testid="drag-status"`)에 넣는다 — 읽기 프로그램과 스모크가 같은 글을 읽는다. 거절이면 표에 `data-refused`(지금의 점선 테두리) + 커서 `not-allowed`.
- **놓일 자리는 왼쪽 끝 점 달린 얇은 선 하나** — `components/assign/drop-gap-line.ts`를 `lib/drop-line.ts` `createDropLine(root)`로 옮겨 Assign 보내기 · 템플릿 틈 · Order가 함께 쓴다(모양은 `.c-dropline`). 상자에 놓는 자리(New 문장 잇기 · 짝 · 나무 줄 · 캡션 자리 · To-Be 상위 문서 · 올리기 칸)는 지금처럼 그 상자 테두리(`data-drop`)만.
- **출발 → 포인터 점선**(`drag-link-line.ts`)은 확인할 것 3의 기본안대로 New 문장 위(잇기)일 때만.
- 공용 API 변화: `DragHover`에 `line?: { left: number; top: number; width: number } | null`을 더해 엔진이 선을 그리고 지운다 — 화면마다 선 객체를 만들고 치우던 코드(`onStart` · `onEnd`의 `dropGapRef`)가 빠진다.

### D8 끌어서 짝 맺기와 카드 안 순서 (1번)

- **따로 쓴 문서에서도 끌어 짝 맺기.** `readPairAt`(`:2663`)의 `ko_en_interleaved` 조건을 `ko_en_separate`까지 넓힌다. 거절 규칙(`lib/pair-drop-model.ts`, 같은 언어 · 판단 걸림 · 초안 있음)은 그대로.
- **카드 안 순서는 손잡이로만.** 고른 박스가 이어 붙은 짝 카드 안에 있으면 그 박스 왼쪽 바깥에 점 여섯 손잡이(`GripVertical`, 테스트 id `assign-paper-grip-<unitId>`)를 그린다. 박스 전체 끌기는 잇기 · 보내기 · 짝 맺기, 손잡이 끌기는 카드 안 순서 — 손잡이에 `data-no-drag`를 달아 박스 끌기가 시작하지 않고, 손잡이용 `BoxDragConfig`가 따로 붙는다(같은 엔진, D7 모양, 놓일 자리 = 카드 안 두 박스 사이 선).
- **서버**: 지금 카드 안 순서는 원문 자리(`pos_seq` · `pos_start`)라 바꿀 길이 없다. 새 편집 op `reorder_pair { pair_id, unit_ids }`(편집 기록 · Undo에 남음)와 순서 칸이 필요하다 — 무엇이 그 순서를 따르는지는 확인할 것 2. 벗긴 표 안 순서(7번)는 시안 2.

## 바뀌지 않는 것

- 서버 규칙 · 거절 코드 · 편집 op의 뜻(D8의 `reorder_pair`를 더하는 것만 새것). 줄(row)의 정의 `buildRows`와 진행 숫자 · 검토 조건.
- 보낼 곳 · 확정 · 초안은 줄(짝 전체) 단위. 체크 · 일괄 처리 · 거르기 스냅숏 · 거르기 접기 · 목차 블록.
- 판단 저장 뒤 다시 받기 범위(D2는 편집만 좁힌다 — 판단 저장은 지금 키를 모두 올린다), AI 작업 끝의 다시 받기.
- Undo 기록 · 세션 키(설계 `2026-11-13-assign-undo-design.md`)와 `focus_unit_id`로 따라가기.
- 끌기의 놓기 규칙 모델(`assign-drop-model` · `pair-drop-model` · `c-drop-model` · `parent-drop-model`)과 문턱 · Alt 긁기 · 가장자리 스크롤.
- 들여쓰기 폭과 번호 칸(3번, v1.2.6).

## 위험과 시험

**위험**
- **따라가기 경합**: 응답 · 다시 받기 · 사람 고름이 엇갈린다. 규칙 3 · 5를 모델 시험이 사례로 못 박는다(늦게 온 보기, 그 사이 다른 박스 고름, 은퇴한 Unit, 실패 뒤 고름).
- **부분 다시 받기의 빈틈**: 편집이 그 문서 밖을 바꾸는데 받지 않는 경우. `confirm` 편집만 To-Be · New 문장을 받는다는 가정은 서버 `editing.py`가 판단을 풀 때만 대상(Target)을 지우는지 스텝 2에서 코드로 확인하고 pytest 한 개로 못 박는다(판단 안 걸린 `merge` 전후 `/tobe` · `/written-sentences` 응답이 같다).
- **동시 쓰기**: 줄 선 둘째 쓰기가 첫째가 은퇴시킨 Unit을 가리킨다 → 서버 거절이 정상 경로다(알림). 문서 줄 시험이 차례를 본다.
- **`useAssignPage()` 넓은 입력**: D1이 `busy` · `follow` 등 11곳의 손을 바꾼다 — 스텝 1은 동작을 바꾸지 않는 옮기기 + 고름 유지만 한다.

**바뀌는 스모크(`frontend/scripts/smoke/assign.mjs`) — 기대값은 낮추지 않고 읽는 자리만 바꾼다**
- `:438` `isSentenceRow` · `:1249` `readRowLangs`: 줄의 Unit 전부가 `data-sel`이라 보던 것 → `[data-sel], [data-mate]`(같은 기대).
- `:2102-2104` "picking a line lights its pair in both halves": 짝은 `data-mate`로 켜진다 — 고른 쪽 `data-sel` + 짝 `data-mate`.
- `:4210-4260` · `:4597-4650` "the drop picks once": `data-landing` · `.pick-ghost` 대신 `assign-chosen` 안 `.refresh-sweep` 추가 수 ≤ 1(같은 기대 — 한 번만 고른다).
- `documents.mjs:1592` · `:1956` · `:2128`, `order.mjs`(2), `assign.mjs`(11)의 `.drag-card-note` 글 읽기(모두 16곳) → `[data-testid="drag-status"]`(같은 글).
- 삭제된 줄을 평소 박스로 찾는 단계(`assign: legend first, place, delete…` `:405` 등)는 접힌 줄(`assign-paper-deleted-<rowKey>`)을 누른 뒤 찾는다.
- `:5288` "J moves the picked piece to the next row"(Pair view)는 그대로(Pair view J/K는 줄 단위).

**더할 시험**
- vitest: `lib/assign-focus-model.test.ts`(규칙 1–6 · `planReload` 표의 줄마다), `lib/pair-hint-model.test.ts`(1↔4 · 2↔5 · 3↔6, 위/아래 어느 쪽을 골라도, 같은 카드 안은 없음, 따로 쓴 문서), `lib/deleted-fold-model.test.ts`(짝 · 표 · 그림, 고른 줄 펼침, 거르기), `lib/doc-write-queue.test.ts`(문서마다 차례, 실패가 다음을 막지 않음), `lib/box-drag.test.ts`(상태 글 · 선 그리기/지우기), `lib/toc-block-model.test.ts`(박스 단위 J/K).
- pytest: 판단 안 걸린 구조 편집이 To-Be · New 문장을 바꾸지 않음(스텝 2), `reorder_pair`(스텝 9 — 짝 아님 · 이어지지 않음 · 판단 걸림 거절, Undo).
- 스모크 새 단계(메인 세션): Join이 처리 중에 고름을 놓지 않고(`__selDrops` 0, `:676`과 같은 관찰자) 합친 박스를 고른다 · Join 뒤 다시 받는 요청이 그 문서 보기 1 + `units?document_id=` 1뿐(요청 기록) · 응답을 붙잡아(`page.route`) 알약 · 쉬머가 응답 전에 보이고 다른 박스를 고를 수 있다 · 실패 응답에 고름 그대로 + 알림 · 4를 누르면 4가 잡히고 안내 줄로 1에 간다 · 삭제 줄 접힘 · 펼침 · 결정 칸 쉬머(줄이기면 없음).

## 스텝

모음 브랜치 `feat/mockup1`(이 설계 커밋이 있는 브랜치)에서 스텝 브랜치 `feat/mockup1-<n>-<이름>`을 따고, 스텝마다 그 스텝의 diff만 검토해 모음 브랜치에 합친다(루트 `CLAUDE.md` "브랜치에서 다시 브랜치" — 뒤 스텝이 앞 스텝의 모델 · 훅 위에 선다). 모음 브랜치를 `dev`에 합칠 때 PATCH 하나, `dev`를 합친 뒤 시험과 고친 화면 스모크(`ONLY="assign:"` 등). 하위 에이전트에 맡기면 서버 · 브라우저를 띄우지 않고 고친 파일의 단위 시험 · lint · tsc까지, 스모크는 메인 세션이 스텝 끝에 고친 화면만. 화면 · 라벨이 바뀌는 스텝은 `frontend/public/manual/user-manual.md`의 Assign 조각 글과 `docs/qa/feature-map.md`를 같은 커밋에서 고친다. 새 effect · 타이머는 `src/lib/use-*.ts`에만, 기준선은 줄기만 한다.

1. **`feat/mockup1-1-focus-model`** — 고름 · 처리 중 · 따라가기를 `assign-focus-model` + `useAssignFocus` 하나로 옮겨, 편집 중에 고름이 풀리지 않고 응답 뒤 결과 박스를 고른다.
   파일: `lib/assign-focus-model.ts`(+test), `lib/use-assign-focus.ts`, `use-assign-page.tsx`(D1 흡수 — 고름은 아직 줄 첫 Unit을 넘기는 그대로, 잠금은 아직 `isAnyPending` 전체), `page.tsx` · `assign-side-panel.tsx`(이름 바꿈만).
   확인: vitest 모델, lint · tsc, 스모크 `ONLY="assign:"` 전체 + 새 단계 "Join keeps the selection and follows the merged box". 결정 칸이 범례로 가지 않는 것이 화면에서 보인다.
2. **`feat/mockup1-2-reload-scope`** — 편집 뒤 고친 문서의 보기와 그 줄만 기다려 받고 나머지는 표대로 뒤에서 받는다.
   파일: `lib/use-doc-views.ts`, `lib/api-sop.ts`(`listAllUnits` 문서 인자), 모델의 `planReload`(+test), `use-assign-page.tsx`(키 나누기 · 편집 전 보기 재사용), `assign-side-panel.tsx` · `page.tsx`(Remark · Space 키), backend pytest 하나.
   확인: vitest `planReload`, pytest, 스모크 새 단계 "after Join only the edited document is fetched again" + `ONLY="assign:"` 전체.
3. **`feat/mockup1-3-pair-select`** — 누른 박스 하나를 고르고, 떨어진 짝은 제자리에 안내 줄로 알리며, J/K는 박스 하나씩 걷는다.
   파일: `lib/pair-hint-model.ts`(+test), `lib/toc-block-model.ts`(박스 순서), `components/paper/paper.tsx`(`data-mate` · 안내 줄 · 짝 표시 강조), `page.tsx`(`selectedId`), 모델(고름이 Unit), `assign-side-panel.tsx`(Shape 순서), i18n 두 쌍, CSS.
   확인: vitest, 스모크 바뀌는 단계 셋 + 새 단계 "clicking box 4 picks 4 and the hint goes to 1", 설명서 Assign 조각.
4. **`feat/mockup1-4-pending`** — 누르는 즉시 그 자리에 처리 중 알약과 쉬머를 보이고, 처리 중인 박스만 잠그고 같은 문서 쓰기는 줄을 세운다.
   파일: `lib/doc-write-queue.ts`(+test), 모델(잠금 · `canStart`), `use-assign-focus.ts`, `paper.tsx`(`data-pending` · 알약), `use-assign-page.tsx`(편집 함수마다 `Pending` 자리), `styles/motion.css`, i18n 여섯 쌍.
   확인: vitest, 스모크 새 단계 "a held Join shows the pill at once, other boxes stay pickable, a failed Join keeps the selection".
5. **`feat/mockup1-5-decide-shimmer`** — 결정 칸으로 날아가는 카드를 걷고 고른 곳 상자 · 결정 칸이 그 자리에서 쉬머로 바뀐다.
   파일: `components/assign/pick-flight.ts` 삭제, `use-assign-page.tsx`(효과 · 캡처 걷기), `assign-side-panel.tsx`(`Refresh` 둘), `styles/motion.css` · `tokens.css`(`--dur-refresh`), `effect-baseline.json` 낮춤.
   확인: `UPDATE_EFFECT_BASELINE=1 npx vitest run src/source-rules.test.ts`, 스모크 "the drop picks once" 두 곳을 쉬머 수로, 줄이기 확인(`page.emulateMedia({ reducedMotion: "reduce" })`).
6. **`feat/mockup1-6-deleted-fold`** — 삭제로 확정된 박스 · 짝 카드 · 표 · 그림을 흐린 한 줄로 접고 누르면 펼친다.
   파일: `lib/deleted-fold-model.ts`(+test), `paper.tsx`(`strips.deleted`), `use-assign-page.tsx` · `page.tsx`(펼침 상태 · 메모 걷기), `components.css`, i18n.
   확인: vitest, 스모크 삭제 단계 + 새 단계 "a deleted pair folds into one line, a click opens it for unassign".
7. **`feat/mockup1-7-drag-look`** — 앱의 모든 끌어 놓기를 흐린 원래 박스 · 한 줄 카드 · 점 달린 선 하나의 모양으로 맞춘다.
   파일: `lib/box-drag.ts`(+test, 상태 글 · `line`), `lib/drop-line.ts`(옮김), `components/assign/drop-gap-line.ts` 삭제, `use-assign-page.tsx`(두 config), `output-c.tsx`, `tobe-section.tsx`, `upload-modal.tsx`, `styles/motion.css`.
   확인: vitest, 스모크 `.drag-card-note` 16곳을 `drag-status`로 — 공용 부품을 고치므로 전체 스모크(`assign` · `order` · `documents`).
8. **`feat/mockup1-8-pair-drag-separate`** — 한/영 따로 쓴 문서에서도 박스를 끌어 다른 박스에 놓아 짝을 맺는다.
   파일: `use-assign-page.tsx`(`readPairAt` 조건), 설명서.
   확인: 스모크 새 단계 "in a separate KO/EN document, dragging a KO box onto an EN box pairs them, Undo takes it back".
9. **`feat/mockup1-9-pair-reorder`** — 고른 박스 왼쪽 손잡이로 짝 카드 안 순서를 끌어 바꾼다.
   파일: backend 편집 op · Alembic(확인할 것 2의 답에 따라) · pytest, `lib/api-sop.ts`, `paper.tsx`(손잡이), `use-assign-page.tsx`(손잡이 config), 설명서.
   확인: pytest · Alembic 왕복, vitest, 스모크 새 단계 "the grip reorders a pair card, whole-box drag still pairs and sends".

차례는 위험이 큰 바탕(1 · 2)부터. 3 · 4는 1에, 5 · 6은 앞 스텝과 독립(1 뒤 아무 때), 8 · 9는 7 뒤.

## 확인할 것

1. **"Deleted" 거르기 탭이 지금 없다** — 거르기는 Unassigned · AI suggested · On hold · Confirmed · All이다(`FILTERS`, `use-assign-page.tsx:73`). 기본안: 탭을 더하지 않고 **Confirmed** 거르기에서 삭제 줄을 펼친 채 보인다. 다른 안: Deleted 탭을 더한다(서버 진행 숫자에 삭제 수가 없어 화면이 센다).
2. **짝 카드 안 순서가 무엇을 바꾸나** — 지금 순서는 원문 자리라 결과물이 따르는 값이 없다. 기본안: 짝 Unit에 카드 안 순서 칸(`units.pair_seq`, Alembic)을 두고 카드 그리기 · Shape 탭 · 짝을 한 문장으로 합치는 순서 · 문단 Excel의 그 카드 범위 안 순서가 따른다(원문 글자 자리는 그대로).
3. **사유 알약을 없앤 뒤의 거절 이유와 이음 점선** — 기본안: 사유는 화면 밖 상태 글(읽기 프로그램 · 스모크용)에 두고, 거절 자리에 놓으면 그 사유를 알림으로 한 번 보인다(지금은 아무 일도 없다). 출발 → 포인터 점선은 New 문장 위(잇기)일 때만 남긴다 — 놓은 뒤 남는 이음 선과 같은 뜻이라서.
