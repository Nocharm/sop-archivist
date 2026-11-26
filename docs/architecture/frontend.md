# frontend 코드 구조 상세

> [`frontend/CLAUDE.md`](../../frontend/CLAUDE.md)가 줄여 싣는 내용의 원문이다(살아 있는 문서). 이 문서가 설명하는 구조(부품·모델·화면이 사는 자리)가 바뀌면 `frontend/CLAUDE.md`와 함께 같은 커밋에서 고친다. 경로 표기는 `frontend/CLAUDE.md`와 같다 — `src/…`·`public/…`·`app/…` 라우트·`scripts/pw-*.mjs`는 `frontend/` 아래, `docs/…`·`rules/…`는 저장소 루트. `lib/…`·`components/…`는 `src/` 아래.

## 1. 공통 lib

- `src/lib/api.ts` `apiFetch`(인증 헤더, dev 사용자는 요청마다 localStorage에서 읽음).
- `api-errors.ts` `humanizeApiError`(상태 코드별 사람 말 문구, 서버 원문은 422 검증 사유에만).
- `access.ts` 권한 카탈로그 미러 · `i18n-messages.ts` en/ko 메시지.
- `keycloak-login.ts` OIDC 설정 단일 소스(PKCE는 `crypto.subtle`이 있을 때만).
- `genId()`·`copyText()`(secure context 우회).
- localStorage 키 접두는 `sopa.`.

## 2. SOP 화면 — API와 순수 모델

SOP 화면: `api-sop.ts`(SOP API 호출·응답 타입), 화면 규칙은 순수 모델에 두고 시험한다.

- `paper-model`(원문 용지):
  - 고름 두 겹(11-23 명세 C1)은 `pick-scope-model` — `resolvePickUnit`(누르면 고를 것: 칸 문장은 칸, 캡션은 묶음)과 `resolveBoxUnit`(그것이 든 박스: 칸 · 캡션은 묶음, 끌기 · 줄 찾기), `buildPickScope`가 누른 조각 · 줄의 박스 · 묶음(짝 카드 · 표)을 내고 `Paper`의 `scope`가 묶음을 얇은 테(`data-group`)와 꼬리표 하나로 그린다. 이웃한 짝만 묶음(떨어진 짝은 `data-mate`), `scope`가 없는 용지(위치 판)는 짝 카드 전체에 2px 그대로. 칸을 고른 표의 삭제 접힘은 `scope.boxId`로 묻는다.
  - 여럿 고른 표시(11-25 명세 §9)는 `multi-mark-model` — `buildCheckMarks`가 카드 순서에서 고른 카드가 이어진 덩어리를 찾고(사이에 안 고른 카드가 끼면 갈린다), `Paper`의 `checkedRows`(Unit → 줄 키, Old · New 모두 Shift)가 줄마다 `data-check`(윗 가장자리는 덩어리 첫 줄, 아랫 가장자리는 끝 줄)와 틈 `data-check="gap"` · 오른쪽 체크 `.strip-check` · 첫 카드의 꼬리표 `.check-tag`로 그린다. 짝 카드는 한 줄로 세고, 여럿 고른 동안은 묶음 꼬리표(`group-tag`)를 그리지 않는다. 덩어리 `deps`에는 `readCheckKey` 글 하나. `data-pick`은 짝 고르기만 남았다.
  - 표 칸 우클릭(11-23 명세 C2)은 `menu-section-model`이 `buildAssignMenu`의 두 묶음을 구역으로 나누고(`readMenuPlace` = text · cell · unwrapped · table, 표 밖은 지금 두 묶음 그대로, 표 단위 항목은 이름에 범위), 항목이 닿는 칸은 `menu-reach-model` `readMenuReach`가 정해 `AssignContextMenu`가 호버 · 포커스 때 `ReachPaint`(`<style>` 한 장 — 메뉴 안 상태라 용지를 다시 그리지 않고 닫으면 함께 떼인다)로 칠한다. 구역 · 칠은 순수 모델이 판정하고 `use-assign-page.tsx`는 값을 대 주기만 한다.
  - 여럿 고른 줄(Shift+클릭, Old `checked` · New `checkedNew`)의 위쪽 바 합치기 · 표 벗기기(쪼개기 먼저 §9)는 `multi-pick-model` — `planMultiMerge`가 언어 무리마다 용지 순서(`tabs.order`)로 이웃인지만 보고(둘 사이 Unit이 모두 고른 것이면 이웃, 번갈아 놓인 한/영 짝) 막는 까닭을 내며, 언어마다 합치기 · 짝 다시 맺기는 서버 편집 `merge_rows`, 표 여럿은 `planMultiUnwrap` → `set_layout_tables`(둘 다 명령 큐 · 되돌리기 한 칸). New 박스는 `listNewRows`가 짝까지 한 줄로 묶는다. 고름은 `toggleChecked`(Shift+클릭은 처음 고를 때 고르던 줄도, ⇧G는 그 줄만 — Old · New 여럿 고름은 함께 두지 않는다), 바 단추 차례는 `listBulkActions`, 배정 취소는 `planBulkClear` → 큐의 `bulk` 명령(`action: "clear"`, 서버 `POST /decisions/bulk` 요청 하나), 언어는 `planBulkLang` → `set_language`(`unit_ids` 여럿)이다.
  - 긴 문서는 카드 40장씩 덩어리로 그려 화면에서 먼 덩어리는 다시 그리지 않고 브라우저도 건너뛴다, `paper-chunk-model`·`Paper`의 `PaperChunk`. 필터로 접힌 목록도 접기 계획의 칸 40개씩 같은 덩어리다(`sliceFoldEntries`). 덩어리로 그릴지는 펼침 · 고름에 바뀌지 않는 접기 전 칸 수로 정하고, 펼친 묶음은 머리와 줄을 가르지 않은 채 접혔을 때처럼 한 칸으로 센다 — 묶음을 펼치고 접어도 어느 줄도 덩어리를 옮기지 않는다(옮긴 줄은 다시 마운트된다). 접힌 묶음 안을 골라 엿보기가 끼면 칸이 늘어, 그 뒤 경계의 줄만 옮긴다(덩어리 key는 자리 번호).
  - 먼 덩어리를 다시 그릴지는 `PaperChunk`의 `deps`로 견준다. 글쇠마다 통째로 새 값이 되는 것(처리 중 · 삭제 접힘 · 저장 중인 번호)은 그대로 넣지 않고 덩어리마다 그 안의 것만 글로 읽어 넣는다(`readChunkPending` · `readChunkDeleted` · `readChunkNumbers`). 표 알약은 그 표나 벗긴 표의 머리가 든 덩어리에, 머리의 잠금은 묶음 · 표의 단위가 다른 덩어리에 있어도 든다(`chunkScopes`).
  - `content-visibility`는 덩어리에 한 겹만 — 줄에도 걸면 스크롤 고정이 놓친다.
  - 저절로 삭제된 줄(`noise_kind` 목차 · 본문 앞부분 · 개정 이력)은 Assign의 Old에서만 `strips.noise`로 종류마다 흐린 블록 한 카드로 접는다 — `toc-block-model`(`listNoiseBlocks` · `buildNoiseBlock`, 표 · 그림은 한 줄이고 칸 · 캡션은 세지 않는다), `buildRows`의 줄이 아니다. 고름은 `Focus` `kind: "toc"`(블록 · 줄), 화면은 `noisePick`이 그 블록을 찾는다(첫 줄이 빠져 키가 바뀌어도 고른 줄로).
    - 글쇠는 판단 글쇠보다 먼저 `lib/noise-keys.ts`(`U` · `R`, Shift는 블록 전체, Del · ⇧H · Enter는 아무것도 하지 않음). 편집 `clear_noise` · `set_noise_reason` · `start_body`는 처리 중 종류 `toc`이고 **장벽이 아니다**(결과 박스가 누를 때 정해져 있다) — 다시 받기는 큐가 빌 때. 삭제 취소는 고름을 그대로 두고 따라가기로 돌아온 줄을 고른다.
  - 표 탭(11-23 명세 E2)은 `table-tab-model`(`listTableBlocks` → `PaperModel.tableBlocks`, 본문의 바깥 표 · 문서 차례, 띠 표 제목 줄 · 안쪽 표는 바깥 표의 것)이 정한다. 탭 키는 `listTabKeys` 하나(본문 · 머리말 · 꼬리말 · 그림 · 표 중 있는 것, Old · New가 같이 쓴다). 표 탭은 `buildPaperTabs`의 탭이지만 `tabOf`는 본문 그대로이고 `order`에 다시 넣지 않는다(한 단위가 두 번 오지 않게). 그리기는 같은 `Paper`에 `tableRows="only"` — `buildStripRows` 뒤에서 `findRowTable`로 거르고 표마다 위치 머리, 표끼리 맞닿은 틈에는 합치기가 없다.
  - 본문 표 접기는 `strips.tables`(접은 표 · `onToggle` · New의 이은 칸 수 `links`) — `resolveFolded`로 고른 단위 · 짝이 든 표는 펼치고, `keepFoldedHeads`가 접은 표의 첫 줄만 남겨 그 자리에 한 줄 단추를 그린다(나머지 줄은 DOM에 없다). 같은 접힘이면 같은 글(`foldedKey`)이라 고를 때마다 줄을 다시 펴지 않는다. 고른 채 접기를 누른 표는 그 고름 동안 접힌다(용지의 `foldPress`).
- `tobe-draft`(To-Be 초안, 하위 항목은 줄 키에 묶고 단계 번호는 다시 매기지 않는다).
- `classify-model`(Assign 줄·보낼 곳·저장 요청):
  - 새 문장 칸 단위로 AI 나눔·합침 보존, 이미 쓴 문서 문장에 잇는 `link`는 닫힌 관계 묶음 전체를 보낸다.
  - 단 한/영 짝 줄을 한 언어만 이을 때 판단 없는 다른 언어 Unit은 확정 저장에서 빼고(`listLinkLeftovers` — 실으면 서버가 422 `hold_required`) 남는 단위를 같은 저장의 `release_unit_ids`로 보낸다 — 짝은 서버가 그 저장 안에서 풀고(`pair_settle`) 화면은 응답의 `pairs_dissolved`로 줄을 나눈다.
  - 줄은 서버 진행 숫자·검토 조건과 같은 규칙이다(`buildRows`, `backend/CLAUDE.md` 줄 기준 숫자).
  - 진행 숫자는 `lib/progress-model.ts` 하나다(개요 · 목록 · Assign 위쪽 · 문서 대시보드) — 정한 줄을 처분별 칸(`listProgressParts`, 색 `PROGRESS_PART_FILL`)으로 가르고 그림 줄(`isFigureRow`)은 따로 센다. 상태 칩의 수는 거르는 줄 수라 그림을 센다. AI 제안 대기는 `ai-suggestion-model.countWaitingSuggestions`(서버 `tidy.py`와 같은 규칙).
- `assign-model`(묶음 합치기·함께 확정·New 짝 함께 고르기 `addPartnerTargets`·추천 섞기·추천 고른 표시(짝 포함 비교)·이음 선·확대/폭 범위).
- `match-model`(같은 글자 일괄 확정 나누기).
- `slot-status-model`(SOP 칸의 여섯 상태 · 요약 · N/A 사유 편집기 하나).
- `old-row-model`(Documents Old 목록의 줄 · 줄 끝 단추 · 펼칠 수 있는 줄).
- **숨긴 기능**: `lib/drafting.ts` — 새 문서를 만드는 쪽(Order · 번호로 더하기 · 칸 배정 · 템플릿 보기 · 결과물 C)과 칸 추천 · 나누기 · 번역 · 목록 읽기 AI를 화면에서 숨기는 스위치 하나(쪼개기 먼저 설계 §5 H1). 단계 목록은 `stages.ts` `listStages(drafting)`(숨기면 Order가 빠지고 번호를 이어 매긴다 — 주소 읽기는 그대로 `STAGES`), AI 종류는 `ai-suggestion-model.ts` `HIDDEN_AI_KINDS`, 보낼 곳은 `classify-model.ts` `listPickOptions`(고르기) · `readHiddenPlace`(이미 보낸 곳 읽기), Documents는 `tobe-add-model.ts` `listTobeTools`, 결과물 탭은 `outputs-view-prefs.ts` `resolveOutputsTab`. 숨긴 동안 남은 AI 번역(`GET …/translations/open`)은 `translation-decision.ts`로 정한다 — 오른쪽 칸(고른 줄의 것)과 `components/assign/leftover-translations.tsx`(묶음 전체, 위쪽 줄 단추 · `?translations=1`)가 같은 저장을 쓰고, 칸 번역은 누른 때의 표 묶음을 새로 읽어 나머지가 모두 확정일 때만 보낸다. 서버 쪽은 따로다 — `ai/constants.py` `AUTO_CLASSIFY` · `PLAN_DELETES`, `sheet_model.py` `SHOW_C_SHEET`.

## 3. 3단계 Assign 화면 — `app/bundles/[id]/assign`(v0.10.0)

- 옛 `/classify`·`/match`는 이리로 넘긴다.
- 상태 · 데이터 · 동작은 `use-assign-page.tsx` `useAssignPage()`, `page.tsx`는 그리기 — 위쪽 줄은 `assign-bar.tsx`, 오른쪽 결정 칸은 `assign-side-panel.tsx`, 둘 다 `state`(`AssignPageState`)를 받는다.
- 고름 · 처리 중 · 따라가기는 순수 모델 `lib/assign-focus-model.ts` + 훅 `lib/use-assign-focus.ts` 한 곳 — 편집 중에도 고름을 두고, 응답 뒤 같은 쪽(Old · New)의 고름이 누른 때 그대로이고 그 사이 그 쪽에서 사람이 고르지 않았을 때만(같은 박스를 다시 눌러도 고른 것이다, 다시 시도가 되살린 고름은 아니다) 결과 박스를 따라간다. 판단 저장 중인 박스는 잠기지 않는다(다시 고를 수 있다).
- **명령 큐(한 줄)**: 판단 저장 · 배정 취소 · 일괄 · 그림 삭제 · 원문 편집 · 짝 · 되돌리기 · 묶음 전체 일(같은 글자 · 모두 받기 · 초기화 · 신규 표시 · 출처 잇기 …) · 번역 확정/지우기가 모두 `use-command-queue.ts` `enqueue`를 지난다. 순수 모델 `lib/command-queue.ts`(하나씩 · 장벽 · 실패 멈춤 · 되묻기)는 React를 모르고, 훅은 이펙트가 없다 — `use-assign-page.tsx`의 줄 없는 이펙트 하나가 커밋마다 `mount` · `pump`를 부른다.
  - 판단(`save`)은 누른 순간 줄 · Unit · 초안을 잡고 `lib/next-box-model.ts` `pickNextBox`(저장 중인 것도 된 것으로 센다)로 고름을 옮긴다. 보류 · 배정 취소 · 일괄은 저장 뒤처럼 그 자리에 머문다. 한 언어만 이어 짝이 풀리는 저장은 결과 박스를 몰라 줄에서는 장벽(`unpair`)이다.
  - 장벽(`isBarrier`) 앞에서 누른 글쇠 · 판단 단추 · (글쇠가 쌓인 뒤의) 클릭은 `key` · `press` · `pick`으로 쌓이고, 장벽의 보기가 놓여 고름이 선 **그 커밋**(`settleWait`)에서 하나씩 다시 눌린다. 되살린 글쇠가 만든 명령은 남은 글쇠 앞(`pushNext`)에, 사유 창을 열면 답할 때까지(`asking`) 뒤가 기다린다. 되돌리기(`step`)만 대상이 없어 앞 장벽의 응답 뒤 바로 나가고(New 문서 보기를 기다리는 장벽은 빼고), 그때 앞 장벽의 늦은 보기는 놓지 않는다(`ctx.isCurrent` · `useDocViews().discard`) — 놓으면 은퇴한 박스의 고름이 풀려 되돌리기가 따라가지 못한다. 장벽이 끝나자 고른 것이 사라졌으면 쌓인 글쇠를 버리고 알린다 — 맨 앞에 쌓인 것이 Ctrl+Z · 다시 하기면 버리지 않는다(대상이 없는 글쇠고 그 되돌리기가 고름을 다시 세운다, `hasStrandedKey`). 글 칸을 여는 글쇠(고쳐 쓰기 `E` · 번호 칸 `⇧N` · Remark `R`)가 쌓이면 그 뒤 글쇠는 쌓지 않고, 누르고 있는 글쇠는 이동만 받는다(`lib/assign-press-model.ts`).
  - 보낼 값은 누른 때가 아니라 나갈 때의 것(`liveRef`)이고, 판단 revision은 누른 때 화면에서 본 것(`seen`)을 `lib/write-log.ts`가 앞 응답으로 이어 준다(문서 revision은 `doc-revision`). 미룬 명령과 다시 시도는 나가는 때의 화면 값을 찍고, 보내려고 방금 받은 묶음의 revision은 화면에 없던 것 · 방금 비운 단위에만 쓴다(남이 바꾼 것을 덮지 않게). 받아 둔 관계 묶음은 그 뒤 쓴 것이 들지 않았을 때만 쓴다(`isFresh`).
  - 저장 응답의 판단은 `useDocViews().patchDecisions`로 줄에 먼저 얹고, 다시 읽기는 `requestReload`(`lib/reload-ask-model.ts`)로 모아 큐가 빌 때(또는 멈췄을 때) 한 번 — 장벽의 문서 보기(`placeReload`)만 바로 받는다.
  - 기다리는 명령은 칩으로 보인다(`listQueueWaits` · `formatQueueWait`): 박스를 잡은 것은 용지의 그 박스(장벽은 첫 박스)에 `assign-queue-<unitId>`, 박스가 없는 것(되돌리기 · 장벽 뒤에 쌓인 글쇠 · 판단 단추)은 위쪽 줄 되돌리기 옆 `assign-queue-global` 하나. 글은 첫째로 이름이 있는 명령의 이름("Queued · Merge", 거듭이면 `×n`, 섞이면 `+나머지`, 이름이 없으면 "Queued n")이고 `data-kind`는 첫째 명령의 종류. 이름은 실패 알림과 같은 곳(`readCommandLabel`, 쌓인 글쇠는 `command-label.ts` `readKeyLabelKey`), 장벽 뒤의 고름(`pick`)은 세지 않는다.
  - 실패하면 멈추고 `queue-failure.tsx`(Retry · Discard)가 알린다. 뒤에 기다리는 것이 없는 편집 · 되돌리기의 거절(4xx)은 알림만(`shouldHalt`). 화면을 떠나면 남은 판단은 마저 보내고 글쇠는 버리며, 떠난 뒤의 실패와 멈춘 채 떠난 것은 못 나간 수를 알린다(나가기 확인은 초안 · 멈춘 것만 센다).
- Old 원문(Split `Paper` 조각)이 곧 목록이고 옆에 이미 쓴 New 원문을 연다(`components/assign/`).
- **두 고름과 단추 줄**(쪼개기 먼저 §8 4-2): 고름은 쪽마다 하나다(`assign-focus-model` `Picks` — `old` · `new` · 마지막에 누른 쪽 `last` · 한 일 `act`). 한 단으로 연 New 문서는 고름이 아니라 보기(`soloDocId`)이고, 안 보이는 쪽의 고름은 남되 세지 않는다(`side-panel-model` `readPanelSide`가 오른쪽 칸의 쪽을 정한다). 편집은 고치는 문서를 인자로 받는다(`doc-shape-model` `DocShape`, `shapeOf(side)`). Old 고름의 `unitId`는 아직 표인 표의 칸일 수 있다 — 줄 키는 `readRowKeyOf`(칸 → 표의 줄), J/K · 저장 뒤 다음 박스 · Space 미리 보기 · 명령이 잡는 박스는 `pickedBoxId`(칸이면 표), 단추 줄 · 나눌 선 · 우클릭 · 용지의 진한 쪽은 `pickedId`(누른 조각). 마지막에 누른 박스 아래 단추 줄은 `lib/pick-bar-model.ts` `buildPickBar` 한 곳이 정하고(잇기 · 손질 넷 · 이을 상대 · ⋯ · Enter의 뜻), `components/assign/pick-bar.tsx`가 그린다(용지의 `renderUnitActions`). Enter와 확정 단추는 `resolveEnter`, 글쇠의 쪽은 `assign-keymap` `routeKey`. 잇기 · 끊기 · 끌어 놓기 · 칸 칩 ×는 명령 하나(`{ kind: "link" }`, 저장 꼴은 `lib/link-save-model.ts` `buildLinkSave`). 두 용지의 빈 곳 누르기는 `.assign-panes`의 `onClick` 하나(`lib/blank-click-model.ts`).
- **이미 쓴 New 문서의 용지**(쪼개기 먼저 §8 4-1): 양 단의 New도 Old와 같은 `Paper`다(`components/assign/new-paper.tsx` — 머리말 · 꼬리말 · 그림 탭과 제목 줄, 한 단의 New는 `old-pane.tsx`가 그린다).
  - 박스는 Unit, New 문장은 `new_unit_id`로 잇는다. 순수 모델 `lib/new-overlay-model.ts` `buildNewOverlay`가 Unit마다 한 덩이(`NewBox` — 새 문장 id · 종류(sentence · cell · bundle) · 출처 · 상태 focus > picked(간 곳) > candidate > unsourced · AI 거르기 · `isLinkable`)를 정하고, 같은 Unit에 새 문장이 둘이면 하나만 남긴다(지금 보는 것 → 고른 것 → 출처가 있는 것 → 작은 id). 원문 조각이 없는 칸 문장(칸 번역, `new_unit_id` null)은 빼지 않고 같은 행 · 열의 칸에 읽기 전용으로 딸린다(`notes`). 접힌 AI 띠는 칸 · 탭마다 하나이고 용지는 짝 카드도 줄마다 접는다. 이을 수 없는 까닭은 `readUnlinkableKey`(`assign.newPaper.why.*`).
  - `Paper`의 얹기 손잡이는 `strips.overlay`(`PaperOverlay`) — 박스 class · 속성 · testid, 줄 속성, 글 위 칩, 글 아래(칸 번역), 접힌 카드의 띠, 글 감싸개(`.new-text`), 까닭(`data-tip`). 모두 Unit마다의 값이고 `Paper`는 New를 모른다. 덩어리 `deps`에는 `overlay.keyOf(그 덩어리의 Unit)` 글 하나만 든다 — 먼 덩어리의 칩 · `data-target`도 맞아야 연결선이 맞으므로 **얹어 그리는 값은 빠짐없이 `NewBox.key`나 `new-paper.tsx` `readKey`(칩 글 · 펼친 칩 · 칸 누르기 · 놓기 · 끊기)에** 넣는다. 맵 · 함수를 deps에 넣으면 매 렌더 전부 다시 그려진다. `overlay`가 없으면 마크업이 그대로다.
  - 찾는 표시: 문장 박스 `.new-line[data-target][data-linkable]`(testid `assign-new-<id>`, 글 `assign-new-pick-<id>`), 표 칸 `.new-cell[data-cell-target]`(`assign-new-cell-<id>`), 이을 문장이 없는 박스 `assign-new-paper-piece-<unitId>`. `[data-target]`은 새 문장 id 하나만 뜻한다(짝 안내 줄은 `data-hint-target`).
  - New 보기는 하나다(`use-assign-page.tsx` `newDocFile` → `newView` · `newModel` · `newTabs`): 한 단이면 연 New 문서, 양 단이면 New 칸의 문서, 엮은 문서면 null. 양 단 용지와 그 자리 다듬기가 같이 쓰고, 고르지 않은 채 되돌려도 New 보기와 New 문장을 다시 받는다(낡은 revision으로 다음 편집이 409가 되지 않게). New 문장 목록만 새로 와 보기에 없는 Unit이 있으면 그 목록에 한 번 보기도 받는다(`hasStrayUnit`). New 문서를 바꾸면 그 자리 다듬기 고름을 놓는다(`showNewDoc`).
  - 각주 · 미주의 New 문장은 꼬리말 탭에 있다 — 이동해 갈 곳 · 누른 추천 · 출처 없는 New의 고른 문장을 `showUnitIds`로 넘기면 바뀌어 든 박스의 탭이 열리고(풀리면 보던 탭 그대로), 다른 탭의 문장을 가리키는 배지 방향은 `data-tab`과 `readHiddenTabSide`로 읽는다.
  - `new-pane.tsx`는 숨긴 엮은 문서(읽기 전용 미리 보기)만 그린다. 출처 칩은 둘이 `new-sources.tsx`를 같이 쓴다.
  - 손질(쪼개기 먼저 §8 4-3): 용지마다 쓸 수 있는 손질은 `lib/doc-tools-model.ts` `buildDocTools`(자리 `old` · `new-wide` · `new-pair`) 한 표다 — New 두 자리는 Old와 같고 판단에 묶인 것(삭제 접기 · 필터 접기 · 그림 지우기 · 묶음째 고르기)만 Old에 있다. 훅이 `leftTools` · `rightTools`로 내고 `page.tsx`가 용지 속성을 그것으로 켠다. 편집은 누른 박스의 문서로(`doc-shape-model` `pickEditTarget`, 두 번 눌러 나누기는 `canSplitInPlace` — 표 칸도 그 자리에서), 벗긴 표 AI 순서 제안은 문서마다 한 벌(`unwrapAi` · `newUnwrapAi`). New 블록(삭제된 줄)은 접고 펴기와 단추만이고 블록 고름은 Old만이다. 편집 확인창의 글은 `lib/edit-ask-model.ts`(`readEditAsk` · New 표면 `describeNewTableAsk`가 서버의 `linked_cells` · `held_rows`로).
- 두 문서 사이 세로선으로 폭, 마우스를 올린 문서만 Ctrl+휠·Ctrl ±로 확대(`lib/use-pane-zoom.ts`, 값은 `lib/assign-view-prefs.ts`가 `sopa.assign.*`에 기억).
- **확정 단추 = Enter**(설계 2026-11-25 §6 S1 · 11-23 B1): `lib/primary-model.ts` `planPrimary`가 할 일(고른 곳 확정 · Suggested 첫 카드로 확정 · AI 순서 적용 · 막힘과 까닭)을, `describePrimary`가 이름 · 색을 정하고 단추와 `handlePrimary`가 같은 답을 읽는다. 카드 확정(`confirmCard`)은 Use와 같은 글 · `suggestionId`를 저장 명령에 싣고 초안에도 넣는다(`DecidePick` `kind: "card"` — 막음 · 캡션 조건은 그 카드의 자리로 본다, 버리면 앞 초안으로). 앞 줄의 비슷한 문장이 남아 있는 동안(`similar.key`)은 그 카드로 확정하지 않는다. 누른 자리는 `lib/assign-key-target.ts` `readKeyPlace`(typing · layer · pop · paper · side · other) — 용지 · 오른쪽 칸의 Enter는 포커스와 상관없이 확정이라 그 안의 단추는 Space로만 누르게 만든다. 마우스로 누른 오른쪽 칸 · 위쪽 도구 줄 · 문서 머리의 단추(`returnsToPaper`)는 화면 틀의 `handleFramePress`가 포커스를 바로 Old `.pane-body`(`tabIndex=-1`)로 돌린다(연 창은 닫힐 때 그리로 돌아오고, 글 칸은 뒤에 가져간다. `aria-haspopup`이면 두고). 저절로 삭제된 줄을 고른 동안은 `isDeletedLine`이라 막힘이고 Enter는 `noise-keys.ts`가 먼저 받아 아무것도 하지 않는다 — 블록의 단추는 그 블록 · 줄을 함께 고른다.
- **글쇠 목록 하나**(11-23 B2): `lib/assign-keymap.ts` `ASSIGN_KEYS`(`{ id, key, shift, when, labelKey }`) — `findAssignKey`가 누른 것을 찾고(Shift를 빠뜨리면 `hint`, Ctrl = ⌘), `resolveAssignKey`가 지금 자리에서 되는지와 까닭을, `handleKey` · `pressKey` · `runKey`가 일을 한다. 까닭은 다듬기 줄 · 우클릭 메뉴가 쓰는 `buildUnitMenu`의 답이다. 단추 · 메뉴의 글쇠 표시는 `formatAssignKey`, 쌓기 · 반복은 같은 id로 `lib/assign-press-model.ts`, 짝으로 가기(G)는 `lib/pair-hint-model.ts` `findPairTarget`. 번호 칸 글쇠(⇧N · Tab)는 용지가 `numberCell.handleRef`로 내놓는 `PaperNumberHandle`(번호 칸 창과 같은 함수)을 부른다 — 머리말 · 꼬리말은 쪽마다 용지라 여럿이다. 이어 누른 Tab은 저장 중인 들여쓰기(`number-arrival-model.ts` `listExpectedShifts`)에서 이어 세어 잠겨 있어도 받는다. Tab은 Old 용지에 포커스가 있고 번호 칸이 있는 박스를 골랐을 때만 가로챈다. ⇧J ⇧J · ⇧K ⇧K 합치기는 `lib/merge-arm-model.ts` `stepMergeArm`(무장 · 실행 · 까닭을 정하는 순수 함수)이 답하고 `pressMerge`가 읽는다 — 무장은 `mergeArmRef`(렌더 사이에 이어 누른 글쇠가 보는 값) + 상태, 실행은 우클릭 메뉴의 `merge_*`/`pair_*`와 같은 `runUnitAction`이라 큐 장벽 · 확인창 · 되돌리기 한 칸이 그대로다. 풀림은 `handleKey` 머리(다른 글쇠 · Esc, Shift 같은 조합 글쇠는 제외) · `pressKey`(장벽 뒤 되살린 글쇠) · 창의 `pointerdown`(기존 이펙트에 얹었다). 점선은 `Paper` `strips.mergeArm`과 New 칸의 `mergeArmTargets`. Space(미리보기)는 `SpacePreview`, 고쳐 쓰기 E는 숨긴 기능이라 표에 없다.
- **탭과 뒤로 가기**(11-23 B2-R6 · R7): 사람이 Old 용지의 탭을 바꾸는 길은 `changePart` 하나(탭 누름 · Ctrl+←→ · 위치 판) — `lib/part-history.ts`가 지금 탭을 지금 기록에 적고(`replaceState`) 같은 주소의 기록을 더한다(`pushState`). Next의 상태 칸(`__NA` 등)을 그대로 두어야 Next가 기록을 제 것으로 보고 화면을 다시 읽지 않는다. `popstate`는 keydown과 같은 이펙트가 듣고 탭이 적혀 있을 때만 움직인다. 고름을 따라 저절로 바뀐 탭과 문서를 바꾸는 이동은 기록을 더하지 않는다.
- **표 탭 · 접은 표**(11-23 E2): 접은 표는 `lib/use-folded-tables.ts`(문서마다 `useState` 하나, 문서가 바뀌면 그리는 중에 `table-fold-prefs`를 다시 읽는다)를 훅이 용지마다(왼쪽 · 양 단 New) 쥔다. J/K는 `isTableWalkUnit` — 표 탭은 그 문서의 표만, 다른 탭은 접힌 표를 건너뛴다. 양 단 New 용지의 탭은 `NewPaper`가 쥐어 훅은 칸 뿌리의 `data-tab`을 읽는다. 표 탭의 `NewPaper`는 고른 것이 표 단위면 탭을 옮기지 않는다.
- 오른쪽 칸의 틀은 `components/assign/side-float.tsx` — 창이 1440px보다 좁으면 떼어 띄운다(자리 셈 `lib/side-float-model.ts`, 창 크기 `lib/use-window-size.ts`, 기억은 `assign-view-prefs`의 `sideFloat`·`sideX`·`sideY`·`sideFolded`). 붙어 있든 떠 있든 같은 `<aside>`라 안의 내용이 다시 만들어지지 않고, 열 폭은 CSS(`.assign-frame:has(> .assign-side[data-float])`)가 바꾼다. 모달이 아니다(role 없음) — 화면 단축키는 `[role="dialog"]`이 있으면 멈춘다.
- New 문장 목록·Old 하나의 New 후보는 서버 `app/sop/written.py`(`/written-sentences`·`/units/{id}/new-candidates`, 임베딩 캐시만 읽고 없으면 글자 유사도).
- **원본 보기**(원본 보기 설계 §5.2~5.5): 원본 DOCX를 브라우저가 인쇄 미리보기처럼 그린다 — 서버 PDF 변환은 배포 제약(외부 다운로드 · 새 바이너리 금지)으로 못 해 npm `docx-preview` 0.4.1 · `jszip` 3.10.2를 쓰고, 원본 탭을 처음 열 때 `import()`로만 불러온다. 자리 표지는 `lib/original-place-model.ts` `plantPlaceMarks`(서버 `original-places`의 `xml_path` → 부분 XML에 책갈피 `sopa_<n>`, 경로 규칙은 추출기 `docx_reader.py` `_iter_tagged`의 사본 — 같은 태그 형제 중 1부터, 글상자는 Choice · Fallback 양쪽, 못 찾으면 가장 가까운 p · tc · tbl). 그리기 · 다듬기는 React 없는 `components/assign/original-render.ts`(그리개 클래스 `sopa-ov` — 그리기는 `openOriginalRoot`가 연 **그림자 뿌리** 안에만 해 그리개 CSS가 앱에 닿지 않는다(앱 모양은 토큰만 쓰는 시트 하나를 `adoptedStyleSheets`로, 표지는 `root.getElementById`). 올린 문서에서 만든 CSS라 붙이기 전에 `scopeRenderedStyles`가 브라우저가 다시 쓴 cssText로 바깥 자원(blob:/data: 밖 url() · image-set · cross-fade · element · src() · @import · `//` 글자열)과 `:host` 규칙을 버린다, 링크는 http(s) · `#`만, 종이 높이로 쪽 나누기 · 표는 줄에서 자르고 머리 반복 줄을 되풀이, 쪽 번호 필드는 `⟦PAGE⟧` · `⟦NUMPAGES⟧` 표지로 바꿨다가 채움, EMF · WMF는 빗금 상자), 쪽 나누기 · 따라가기 셈은 `lib/original-page-model.ts`.

## 4. 공용 훅·저장소

- `bundle-store`(묶음 캐시 — 화면 진입마다 다시 부르고 로그아웃·사용자 전환 때 비운다).
- AI 작업 상태는 공용 폴러 `lib/ai-jobs-store.ts`(사용자당 하나, `GET /api/ai/jobs/recent`)가 읽고 규칙은 `ai-jobs-model.ts`, 상단 바 표시는 `components/ai-jobs-indicator.tsx`·`ai-jobs-popover.tsx`(`use-ai-jobs`는 그 묶음의 요청이 바뀔 때 `/ai/status`만 다시 읽는다).
- `leave-guard`(미저장 이탈 가드)·`use-loaded`·`use-cursor-list`(서버 커서로 한 묶음씩 이어 받는 목록 — 이미 받은 목록을 나눠 그리는 `use-progressive-list`와 다르다).
- `use-pane-measure`(`.assign-panes` 위 선 층이 다시 재는 때 — 스크롤 캡처 · 창 크기 · ResizeObserver · 렌더마다를 rAF 한 번으로 묶는다. Pair view 짝 선 `pair-lines`와 떨어진 짝 괄호선 `components/assign/pair-bracket.tsx`(규칙 `lib/pair-bracket-model.ts` — 짝이 모두 화면 안일 때만, 보이는 동안 · 재기 전에는 용지 `strips.pairHint.isHidden`으로 안내 줄 대신 같은 높이 빈 자리를 둔다(`isPairHintShown`, 고를 때 밀림 없음))가 쓴다. 선 층을 새로 만들면 이펙트를 새로 두지 않고 이 훅을 쓴다).
- `ui-prefs`(화면 설정 값 목록)와 `layout.tsx`의 첫 페인트 전 boot 스크립트가 같은 값을 쓴다.

## 5. UI 규칙(디자인 기초 문서)

- raw hex는 `src/styles/tokens.css` 밖에서 쓰지 않고, 다크는 토큰만 바꾸며 화면 코드가 테마로 분기하지 않고, 상태 표기는 화면 언어와 상관없이 영어다.

## 6. 이동·움직임 공통 층

- 앱 안 이동은 `lib/nav-buffer.ts` `navigate()`(0.6초 버퍼, 같은 곳 재클릭·Esc 취소)로 하고 링크 클릭은 `components/nav-host.tsx`가 창 캡처 단계에서 같은 길로 돌린다 — 사람이 고른 이동에 `router.push`를 새로 쓰지 않는다(저장 안 한 변경 가드 `useLeaveGuard`도 이 길에 걸려 있다).
- 접기·쉬머·폭 모핑·말줄임 툴팁은 `components/ui/motion.tsx`, 긴 목록은 `lib/use-progressive-list.ts`.
- 목록 자리 바꿈(FLIP — 바뀔 줄만 재고 움직임 줄이기면 바로)은 `components/ui/motion.tsx` `useFlip`(거리는 `lib/flip.ts`).
- 표 벗기기처럼 원문 모양이 바뀌는 전환(걷기 → 펼치기 → 붙이기, 줄마다 늦춤, 화면 안만, 움직임 줄이기면 바로 + 번쩍)은 `useUnwrapMotion`(`motion.tsx`, 사용법은 그 JSDoc, 순수 계산 `lib/unwrap-motion.ts`)으로 — 새로 짜지 않는다. 누르면 `begin`(걷기), 새 모양을 받으면 그 손잡이의 `commit(change)`, 거절 · 되묻기면 `revert`(거꾸로)다. Assign은 큐의 처리 중 시작 · 끝(`CommandEnv.start` · `end`)에 걸어 둘 중 하나가 꼭 불린다.
- 저장 전에 먼저 보이는 것(A2-R6)은 큐 상태에서 파생한다 — 삭제 접기는 `buildDeletedFolds`의 `pendingDeletes`(달리는 · 기다리는 · 멈춘 삭제의 줄 키, 접힘은 `Collapse startOpen`, 버린 삭제의 펼침은 `lib/use-released-folds.ts`), 번호는 `listExpectedNumbers`(응답 뒤 그 revision의 보기가 닿을 때까지, 실패하면 빠진다). 내용이 같으면 같은 값을 내려 용지의 먼 덩어리를 다시 그리지 않는다.
- 호버로 드러나는 보조 단추는 `.row-actions`(`styles/motion.css`).

## 7. 상자 전체 끌기

- 상자 전체 끌기는 `lib/box-drag.ts`·`use-box-drag.ts`로 한다(끌기 중 표시 `<html data-box-drag>`를 CSS와 `isBoxDragActive()`가 같이 보고, 화면마다의 놓기 규칙은 순수 모델 — Order는 `lib/c-drop-model.ts`, Assign 잇기·보내기는 `lib/assign-drop-model.ts`, 짝 놓기와 Pair view 두 칸은 `lib/pair-drop-model.ts`) — 포인터 끌기를 새로 짜지 않는다.

## 8. 결과물 C

- 결과물 C의 순서·깊이·표시는 화면에 먼저 얹고(`lib/c-edit-model.ts`) 저장은 한 번에 하나씩 보내며(`lib/c-save-queue.ts`, 의미 확인 체크도 같은 줄) 응답의 그 문서로 맞춘다.
- 저장 전 번호 미리 세기 `section-number.ts` `numberLines`는 backend `outputs.number_lines`의 사본이라(저장 응답이 이긴다) 서버 규칙을 바꾸면 함께 고친다.

## 9. 관리 화면·API·Markdown 보기

- 관리 화면 `app/admin/page.tsx` + `components/admin/`: 탭·하위 탭은 주소(`?tab=&sub=`)에 두고 옛 `sub=lookup`은 부여로 연다. 부여는 `access-grants.tsx`(목록) + `grant-detail.tsx`(상세, 유효 권한 `effective-permissions.tsx`), 역할 여러 개 더하기는 `add-roles-popover.tsx`. 사내 AI로 등록은 `grant-ai-modal.tsx` — 읽기는 `readGrantsWithAi`(아무것도 쓰지 않음), 지금 부여와 맞춘 미리보기·동명이인 고르기·일괄 본문은 순수 모델 `lib/grant-ai-model.ts`, 반영은 `batchGrants`.
- 규칙은 순수 모델 — `lib/grants-model.ts`(왼쪽 목록), `lib/audit-model.ts`(거르기·날짜 묶음), `lib/batch-jobs.ts`(작업마다 한 줄), `lib/subject-label.ts` + `lib/use-subject-names.ts`(대상 이름을 화면 언어로).
- 관리 화면만의 CSS는 `styles/admin.css`(`.adm-*`, 표 모양은 관리 본문 `.adm-scope` 안에서만) — 공용 `DataList`·`components.css`를 고치지 않는다.
- 백엔드에만 있던 묶음 관리·AI 요청·관리 묶음·AI 지침 API는 `lib/api-manage.ts`.
- Markdown 글(AI 지침)의 읽기 보기는 `components/ui/markdown-view.tsx` 하나를 쓴다(escape 뒤 서식만 태그로 — 원문 HTML을 그대로 넣는 길을 새로 만들지 않는다).

## 10. 목록·값 고르기 공통 부품

- 읽기 위주 목록은 `components/ui/data-list.tsx` `DataList`(열 정의 하나로 표·밀도 높은 카드, 보기는 `ListViewToggle`·`lib/use-list-view.ts`가 목록마다 `sopa.listView.<key>`에 기억, 남은 폭을 채우는 열은 `grow`)를 쓴다.
- Documents의 문서 목록은 `components/documents/doc-row.tsx`(두 줄 줄 틀 — 줄 끝 단추는 호버 · 포커스, 좁으면 ⋯. 딸린 정보 줄은 넘치는 동안 `lib/use-meta-fit.ts`가 `data-fit` 단계를 올려 CSS가 정한 순서로 줄인다)를 쓴다.
- 값 하나 고르기는 `components/ui/select.tsx` `Select`(떠 있는 목록은 `Menu` listbox, 항목 testid `<testId>-option-<value>`, 스모크는 트리거→항목 클릭)를 쓴다 — 기본 `<select>`를 새로 쓰지 않는다.

## 11. 본문 폭

- 본문 폭 상한은 `tokens.css` `--page-max`(1280)·`--page-max-wide`(1600, 쪼개기·Assign)이고 `AppShell`의 `.page-wrap`이 건다(좁은 창에서도 좌우 최소 여백).

## 12. 화면 공통 부품(v0.9.0)

- 브라우저 기본 모양(체크박스·라디오·`title` 툴팁)을 쓰지 않는다 — `components/ui/checkbox.tsx` `Checkbox`(숨긴 네이티브 입력 위에 토큰으로 그림)·`tooltip.tsx` `Tooltip`·`info-tip.tsx` `InfoTip`(개념 설명은 본문 대신 (i) 툴팁).
- 글자 없이 아이콘만 있는 표시는 포인터를 올리거나 키보드 포커스가 가면 툴팁이 뜨게 한다 — 원문 용지의 표시처럼 수가 많은 것은 `Tooltip`을 하나씩 두지 않고 `components/ui/delegated-tip.tsx` `useDelegatedTip`(영역 하나가 `data-tip`을 가진 요소의 툴팁을 띄운다)을 쓴다.
- 삭제류 아이콘 단추는 `morph-button.tsx` `MorphButton`(평소 아이콘, 호버 때 라벨이 펼쳐짐, `tone="danger"`), 빈 화면은 `empty-state.tsx` `EmptyState`(가운데 박스), 알림은 `toast.tsx`(오른쪽 위, 새 것이 위, 빠질 때 높이 접기, 행동 단추 하나 — `showToast(text, tone, { action })`, 되돌리기용).
- 창은 `components/modal.tsx` `Modal`의 `size`로 폭을 고른다 — 시선이 좌우로 덜 움직이게 좁게:
  - 확인 창(`ConfirmModal`)·짧은 물음은 `sm`(384), 양식은 `md`(448, 기본), 미리 보기는 `lg`(512), 표가 들어가는 업로드만 `xl`(768).
  - 시트를 그리는 Excel 미리보기만 `sheet`(뷰포트 가장자리 24px 안쪽 거의 전체 — 시트 보기 `components/outputs/sheet-view.tsx`가 남은 높이를 다 쓰고 스크롤바 없이 끌어 옮긴다 `lib/sheet-pan.ts`, 다음에 올 Assign Space 미리보기도 이 부품을 쓴다).
  - 새 창에 임의 폭 클래스를 쓰지 않는다.
- 상단 막대는 `user-menu.tsx`(계정·관리·레이아웃 하위 메뉴 — 자리가 없으면 `lib/flyout.ts`로 왼쪽·로그아웃·마지막 로그인)와 `lang-toggle.tsx`(EN|KO).
- 사람 고르기(`subject-picker.tsx`)는 `lib/directory-cache.ts`가 직원 전체(`/api/directory/all`)를 한 번 받아 `lib/people-order.ts`(bpm `lib/search.ts`·`hangul.ts`를 옮긴 순위 — 이름 > 한글 이름 > 아이디, 부서명으로는 찾지 않음, 비었으면 내 부서 코드 체인 먼저)로 정렬하고 25명씩 이어 그린다.
- 라벨은 짧은 명사형, 도메인 용어 Bundle·Old·New·Unit은 화면 언어와 상관없이 영어(산출물 문구는 제외).

## 13. 사용 설명서(`/manual`)

- 글은 Markdown 한 벌 `frontend/public/manual/user-manual.md`(한국어, 그림 `public/manual/img/`)이고 화면은 나눠 보이기만 한다 — 나중에 챗봇이 같은 파일을 읽는다.
- `##` 하나가 조각 하나이고 `##`·`###`마다 자리 이름 `{#id}`가 있어야 한다.
- `app/manual/page.tsx`(서버 컴포넌트, 정적)가 빌드 때 `lib/manual-files.ts`(node:fs — 브라우저 쪽 코드가 가져오지 않는다)로 글과 그림 크기를 읽어 `components/manual/`(`manual-view`·`manual-toc`·`manual-unit`·`read-state`)에 넘긴다.
- 규칙은 순수 모델에 둔다 — `lib/manual.ts`(조각 나누기·찾기·읽음 상태·도움말이 여는 조각 `getManualHref`)·`manual-keys.ts`(글쇠)·`manual-read.ts`(읽음 표시, 이 브라우저의 `sopa.manual.read`에 조각 id → 본문 지문. 글이 바뀌면 `Updated`).
- 도움말 길은 상단 바 `top-bar-manual`과 사용자 메뉴 `user-menu-manual`(새 탭, 지금 화면을 설명하는 조각으로)이고, 로그인 전 주소의 `#자리`는 `providers.tsx`가 로그인 뒤까지 들고 간다.
- 설명서를 위해 `MarkdownView`에 그림(`imageBase`·`imageSizes`, 같은 사이트 파일만)·자리 이름·알림(`[!NOTE]`)·`<kbd>`·`lang`을 더했다 — 뷰어가 그리지 않는 문법을 글에 쓰면 `manual-content.test.ts`가 잡는다.

## 14. 포커스 테두리

- 전역 `:focus-visible` 테두리는 `base.css`의 `@layer base` 안에 있어 `outline-none`이나 컴포넌트 레이어 규칙으로 끌 수 있다 — 끄는 곳은 자기 포커스 표시(테두리 색·`focus-within` 고리·바탕)를 반드시 그린다(레이어 밖으로 다시 빼면 끈 곳마다 테두리가 겹친다).

## 15. Map(참조 지도)

- `app/bundles/[id]/map/page.tsx` + `components/map/`(도구 줄·List·옆 칸) — 읽기 전용, 서버가 준 것만 그린다(남의 Bundle은 코드만, 제목·문장·남의 확인 전 참조는 응답에 없다).
- 순수 모델 `lib/map-model.ts`(거르기·표·옆 칸).
- 옆 칸의 줄 문장 `lib/map-lines-model.ts`·`components/map/map-lines.tsx`(`GET …/map/lines` — 구성원인 Bundle의 줄만 글이 오고 그 밖은 선마다 수만, 지금 고른 문서의 응답만 그린다 `pickCurrentLines`).
- `lib/map-layout.ts`·`lib/map-keys.ts`(지도 배치·글쇠 — 그리는 화면은 아직 없다).

## 16. 문단 번호 칸(표 풀기·표준화 명세 F5) 상세

- 번호 칸의 값과 내용 경계는 서버가 정해 보낸다(문서 보기 `units[].number`, 단위 목록 `content_start`) — 화면은 읽기만 하고 다시 정하지 않는다.
- 용지(`components/paper/paper.tsx`)는 `model.hasNumberRanges`일 때 번호 칸(`number-cell.tsx`)에 그 줄의 번호를 보이고 번호 범위를 가리며(`lib/number-model.ts` `getHiddenEnds`), 옛 추출은 전처럼 절 첫 줄의 번호만 가린다(`strip-pill-model.ts`).
- New 초안의 원문은 번호를 뺀 내용이다(`classify-model.ts` `getContent`).
- 따라 고치기 미리 보기 `planFollow`는 서버 `numbering.plan_follow`의 사본이라 함께 고친다.
- 벗긴 표 번호 이어 매기기(11-23 명세 D1)는 서버가 Old 표를 벗길 때 매기고(편집 `continue_numbers`, 되돌리기 한 칸), `lib/continue-number-model.ts`(`findParentNumber` · `planContinue`)가 서버 `numbering.find_parent_number` · `plan_continue`의 사본이다(`rule-cases.json` `plan_continue`). 번호 칸 창의 연속 제안 `number-kind-model.suggestUnitContinuous`는 벗긴 표 줄이면 위 번호 아래 다음 순번(제목 5 아래 → 5.1)을 낸다.

## 17. 연습 화면(`/practice`) — 가짜 서버

설계 `docs/architecture/decisions.md`의 `## 2026-11-26-practice-page`. 실제 Assign 부품을 그대로 쓰고 API 부르기만 브라우저 메모리의 가짜 서버로 돌린다 — 서버 · DB에는 아무것도 가지 않는다.

- **끼우는 자리 하나**: `lib/api.ts` `sendRequest`가 인증 헤더 · `fetch` 앞에서 `lib/practice-route.ts` `isPracticeRequest(path, readPathname())`를 묻고, 참이면 `await import("./practice/practice-server")`의 `handlePracticeRequest(method, path, body)`가 `Response`를 짓는다. 그 뒤 `!response.ok` → `ApiError` · `rule`은 실제와 같은 줄이다. 동적 import라 가짜 서버와 자료는 연습 덩이에만 실린다.
- **판정(D2)**: Bundle 경로는 id로만 — 연습 Bundle(`PRACTICE_BUNDLE_ID = -1`) 아래는 화면 주소와 상관없이 늘 가짜(떠난 뒤 명령 큐가 마저 보내는 쓰기도), 실제 id는 `/practice`에서도 실제 서버(실제 Assign의 큐가 남은 저장을 잃지 않게). 화면이 `/practice`이면 Bundle 밖 경로 중 `REAL_ON_PRACTICE`(`/me` · `/ai/jobs/recent` — 읽기만, SOP 자료 아님) 밖 모두 가짜. 운영 빌드에서도 같고 `lib/drafting`을 읽지 않는다.
- **새는 길 막기**: `src/source-rules.test.ts` "raw fetch to the API" — `fetch(`는 `api.ts`와 `auth-mode.ts`(부팅 때 인증 방식)에만. `practice-server.test.ts`가 `api-sop.ts`의 실제 함수로 과제 순서를 불러 `fetch` 0번을 본다. `lib/nav-buffer.ts` `navigate()`는 `/bundles/-1/…`로 가지 않고 `practice.notHere` 알림(D13).
- **상태 `lib/practice/practice-state.ts`(순수)**: 자료(`practice-fixture.json` — `backend/scripts/dump_practice_fixture.py`가 실제 백엔드 응답을 뽑는다, 타입 `PracticeFixture`)에서 판(보기 · 판단 · 새 문장 · 합치기 전 Unit · 표 모습)을 짓고, 읽기는 그 판에서 Assign이 받는 꼴(`UnitRow` · `WrittenSentence` · `Group` · `DocumentView`)을 다시 짓는다 — 처음 판에서 지은 응답은 자료와 같다(시험). 쓰기는 받은 것을 검사 없이 반영한다(서버 업무 규칙의 사본이 아니다, D5): 판단 · 출처 저장, 배정 취소, 원문 편집 일곱 종류(`split` · `merge` · `unmerge` · `set_language` · `set_layout_table` · `set_noise_reason` · `clear_noise`), 짝 맺기 · 풀기 · 확정. 표 벗기기는 백엔드가 찍은 두 모습(`tableVariants` — 표 줄 · Unit · 짝)을 갈아 끼운다(D7). 되돌리기는 `undo` 메타가 실린 쓰기마다 판 통째 사진(같은 `step_key`는 한 칸, revision은 늘기만, D8).
- **서버 `lib/practice/practice-server.ts`**: 경로 표 `ROUTES` 25개(읽기 10 · 빈 답 6 · 쓰기 9, 설계 §5). 그 밖의 경로 · 편집 종류는 `422 {detail: {code: "practice_unsupported", what}}` → `rule.practice_unsupported` "Not available in practice". 쓰기는 append-only 기록(`PracticeLogEntry` — `route` · `editType` · `undoOp` · `action` · `unitIds`, 과제 판정용 `focusTargetId`(잇기 길만 싣는 되돌리기 메타) · `isPairJoin`(⇧P의 짝 합치기))에 남고, 서버에 자취가 없는 손짓은 `notePracticeAct`로 같은 기록에(D9). 연습 틀은 `useSyncExternalStore(subscribePractice, readPracticeSnapshot)`로 읽는다. 상태는 모듈 변수뿐 — 새로 읽으면 처음(D11).
- **같이 움직이는 것**: Assign이 새 읽기 · 쓰기(경로 · 편집 종류)를 쓰기 시작하면 `ROUTES`와 `practice-state.ts`에도 더한다 — 없으면 운영은 멀쩡하고 연습만 "Not available in practice"가 된다. 응답 꼴이 바뀌면 백엔드 신선도 시험(`test_practice_fixture.py`)이 자료를 다시 뽑게 알린다.
- **화면(스텝 3)**: `app/practice/page.tsx`가 `<BundleIdContext value={PRACTICE_BUNDLE_ID}><AssignPage /></BundleIdContext>`(`app/bundles/[id]/assign/page.tsx` 기본 내보내기 그대로)를 `components/practice/practice-frame.tsx`로 감싼다 — 틀이 위 띠 `practice-band.tsx`(`practice-band` · 진행 점 · **Start over** `practice-start-over` = `window.location.reload()`)와 무대 `.practice-stage`(Assign 한 칸 + 그 위 말풍선 층 `practice-coach.tsx`)를 그린다. Assign이 바뀐 곳은 `use-assign-page.tsx`의 `useRouteBundleId()` 한 줄(`lib/use-route-bundle-id.ts` — 맥락 값이 있으면 그것, 없으면 `useParams`). `getPageWidth("/practice")`는 Assign과 같은 `desk`. 진입은 두 곳뿐: 사용자 메뉴 `user-menu-practice`(`/practice`에서는 빠짐)와 설명서 머리 `manual-practice`. `getManualHref("/practice")` → `/manual#practice`. CSS는 `components.css` 끝 `.practice-*`.
- **과제(스텝 4)**: `lib/practice/practice-tasks.ts`(순수) `PRACTICE_TASKS` 열둘(`id` · 문구 키 · 설명서 앵커 · `keys`(`ASSIGN_KEYS` id — 글자는 `formatAssignKey`) · `isDone(entry)`), `listAchieved(log)`(기록이 늘기만 해 되돌려도 ✓가 남는다), `pickOpenTask(log, picked)`(누른 과제를 누른 뒤 아직 이루지 않았으면 그것, 아니면 첫 미완료, 다 끝나면 null — D10). 잇기와 카드 확정은 둘 다 `groups/save` · `op: "link"`라 `focusTargetId`로 가른다(D22 — `practice-tasks.test.ts`가 `use-assign-page.tsx`의 두 메타 줄을 소스로 붙든다). 틀은 `onKeyDownCapture`(Assign 안 `.practice-main`에서 누른 `move_next` · `move_prev` → `notePracticeAct`)와 `onClickCapture`(`assign-help-keyboard-map` → `{click: "keyboard-map"}`)로 서버에 자취가 없는 두 손짓을 적는다.
- **말풍선(2026-11-27 시안 A — 오른쪽 과제 칸을 대신함)**: 과제마다 `chapter`(말풍선 머리 `practice.chapter.*`)와 `target`(밝힐 상자 — 연습 자료의 Old Unit id `{unit}` · 목차 블록 머리 `{noise}` · Assign 단추 `{testId}` · 배정 취소는 기록에서 마지막으로 잇거나 확정한 줄 `{lastLinked}`)이 있고, `listTargetSelectors(target, log)`가 고르개 차례(`assign-old` 안 `assign-paper-piece-<id>` → `-unit-<id>` → `-deleted-u<id>`)를 준다 — Assign 부품은 고치지 않는다. 자료를 다시 뽑아 id가 바뀌면 `practice-tasks.test.ts`가 과제 글의 문장으로 대조해 알린다. 틀의 `useState` 둘: 누른 과제 `picked`(D10)와 말풍선이 보이는 과제 `seen`(`CoachSeen` — id와 그때의 기록 길이). `readCoachView(log, picked, seen)`(순수)이 렌더 중에 셈한다: 보던 과제를 보인 뒤 이루었으면 그것을 뒤집힌 채(`isDone`), 아니면 `pickOpenTask`. 띠의 점 `practice-dot-<id>`(`data-done` · `data-now`, 툴팁은 `useDelegatedTip`)를 누르거나 **Skip**(`practice-coach-skip`, `pickNextTask` — 뒤로 돌아 첫 미완료)이면 `picked` · `seen`을 함께 바꾼다. `practice-coach.tsx`: 무대를 덮는 층 `.practice-coach-layer`(`pointer-events: none`, z 45 — 모달 50 아래)에 밝힌 상자 `practice-coach-hole`(둘레 그림자가 막 — `--scrim`을 묽게, 숨쉬는 테두리)과 카드 `practice-coach`(`data-task` · `data-place` right|below|above|center · 재기 전 `data-pending`, 카드 안 링크 · 단추만 눌린다). 카드 속 `practice-coach-flip`(`data-done`)은 앞면(과제 n / 12 · 장, 제목, 할 일, 글쇠 `formatAssignKey`, `practice-coach-manual` `/manual#<앵커>` 새 탭, 건너뛰기)과 뒷면(✓)을 겹쳐 3D로 뒤집고, 뒤집기 CSS 애니메이션(움직임 줄이기면 체크로 바꿔 끼워 머무는 애니메이션)의 `animationend`가 `seen`을 다음 과제로 옮긴다 — 타이머 없음. 다 끝나면 같은 카드 자리에 `practice-finish`(`practice-finish-home` = `navigate("/")` · `practice-finish-again` = 새로 읽기). 자리: `lib/use-target-rect.ts`(공용 훅, effect 하나 — 스크롤 캡처 · 창 크기 · `ResizeObserver`(무대 · 카드) · `MutationObserver`(body, 층 안의 바뀜은 빼고)를 rAF 한 번으로 묶어 대상의 보이는 부분을 무대 좌표로 잰다, 고르개가 바뀌어 처음 찾았을 때 반도 안 보이면 한 번 `scrollIntoView`)와 `lib/practice/coach-place.ts` `placeCoach`(순수 — 오른쪽, 모자라면 아래 · 위, 무대 안으로 당김, 꼬리 자리). 대상이 DOM에 없으면 막 없이 띠 아래 가운데. CSS anchor positioning은 쓰지 않는다.
