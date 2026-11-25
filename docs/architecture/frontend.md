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
  - 긴 문서는 카드 40장씩 덩어리로 그려 화면에서 먼 덩어리는 다시 그리지 않고 브라우저도 건너뛴다, `paper-chunk-model`·`Paper`의 `PaperChunk`. 필터로 접힌 목록도 접기 계획의 칸 40개씩 같은 덩어리다(`sliceFoldEntries`). 덩어리로 그릴지는 펼침 · 고름에 바뀌지 않는 접기 전 칸 수로 정하고, 펼친 묶음은 머리와 줄을 가르지 않은 채 접혔을 때처럼 한 칸으로 센다 — 묶음을 펼치고 접어도 어느 줄도 덩어리를 옮기지 않는다(옮긴 줄은 다시 마운트된다). 접힌 묶음 안을 골라 엿보기가 끼면 칸이 늘어, 그 뒤 경계의 줄만 옮긴다(덩어리 key는 자리 번호).
  - 먼 덩어리를 다시 그릴지는 `PaperChunk`의 `deps`로 견준다. 글쇠마다 통째로 새 값이 되는 것(처리 중 · 삭제 접힘 · 저장 중인 번호)은 그대로 넣지 않고 덩어리마다 그 안의 것만 글로 읽어 넣는다(`readChunkPending` · `readChunkDeleted` · `readChunkNumbers`). 표 알약은 그 표나 벗긴 표의 머리가 든 덩어리에, 머리의 잠금은 묶음 · 표의 단위가 다른 덩어리에 있어도 든다(`chunkScopes`).
  - `content-visibility`는 덩어리에 한 겹만 — 줄에도 걸면 스크롤 고정이 놓친다.
  - 저절로 삭제된 줄(`noise_kind` 목차 · 본문 앞부분 · 개정 이력)은 Assign의 Old에서만 `strips.noise`로 종류마다 흐린 블록 한 카드로 접는다 — `toc-block-model`(`listNoiseBlocks` · `buildNoiseBlock`, 표 · 그림은 한 줄이고 칸 · 캡션은 세지 않는다), `buildRows`의 줄이 아니다. 고름은 `Focus` `kind: "toc"`(블록 · 줄), 화면은 `noisePick`이 그 블록을 찾는다(첫 줄이 빠져 키가 바뀌어도 고른 줄로).
    - 글쇠는 판단 글쇠보다 먼저 `lib/noise-keys.ts`(`U` · `R`, Shift는 블록 전체, Del · H · Enter는 아무것도 하지 않음). 편집 `clear_noise` · `set_noise_reason` · `start_body`는 처리 중 종류 `toc`이고 **장벽이 아니다**(결과 박스가 누를 때 정해져 있다) — 다시 받기는 큐가 빌 때. 삭제 취소는 고름을 그대로 두고 따라가기로 돌아온 줄을 고른다.
- `tobe-draft`(To-Be 초안, 하위 항목은 줄 키에 묶고 단계 번호는 다시 매기지 않는다).
- `classify-model`(Assign 줄·보낼 곳·저장 요청):
  - 새 문장 칸 단위로 AI 나눔·합침 보존, 이미 쓴 문서 문장에 잇는 `link`는 닫힌 관계 묶음 전체를 보낸다.
  - 단 한/영 짝 줄을 한 언어만 이을 때 판단 없는 다른 언어 Unit은 확정 저장에서 빼고(`listLinkLeftovers` — 실으면 서버가 422 `hold_required`) 남는 단위를 같은 저장의 `release_unit_ids`로 보낸다 — 짝은 서버가 그 저장 안에서 풀고(`pair_settle`) 화면은 응답의 `pairs_dissolved`로 줄을 나눈다.
  - 줄은 서버 진행 숫자·검토 조건과 같은 규칙이다(`buildRows`, `backend/CLAUDE.md` 줄 기준 숫자).
- `assign-model`(묶음 합치기·함께 확정·New 짝 함께 고르기 `addPartnerTargets`·추천 섞기·추천 고른 표시(짝 포함 비교)·이음 선·그 자리 메뉴 항목·확대/폭 범위).
- `match-model`(같은 글자 일괄 확정 나누기).
- `slot-status-model`(SOP 칸의 여섯 상태 · 요약 · N/A 사유 편집기 하나).
- `old-row-model`(Documents Old 목록의 줄 · 줄 끝 단추 · 펼칠 수 있는 줄).
- **숨긴 기능**: `lib/drafting.ts` — 새 문서를 만드는 쪽(Order · 번호로 더하기 · 칸 배정 · 템플릿 보기 · 결과물 C)과 칸 추천 · 나누기 · 번역 · 목록 읽기 AI를 화면에서 숨기는 스위치 하나(쪼개기 먼저 설계 §5 H1). 단계 목록은 `stages.ts` `listStages(drafting)`(숨기면 Order가 빠지고 번호를 이어 매긴다 — 주소 읽기는 그대로 `STAGES`), AI 종류는 `ai-suggestion-model.ts` `HIDDEN_AI_KINDS`, 보낼 곳은 `classify-model.ts` `listPickOptions`(고르기) · `readHiddenPlace`(이미 보낸 곳 읽기), Documents는 `tobe-add-model.ts` `listTobeTools`, 결과물 탭은 `outputs-view-prefs.ts` `resolveOutputsTab`. 숨긴 동안 남은 AI 번역(`GET …/translations/open`)은 `translation-decision.ts`로 정한다 — 오른쪽 칸(고른 줄의 것)과 `components/assign/leftover-translations.tsx`(묶음 전체, 위쪽 줄 단추 · `?translations=1`)가 같은 저장을 쓰고, 칸 번역은 누른 때의 표 묶음을 새로 읽어 나머지가 모두 확정일 때만 보낸다. 서버 쪽은 따로다 — `ai/constants.py` `AUTO_CLASSIFY` · `PLAN_DELETES`, `sheet_model.py` `SHOW_C_SHEET`.

## 3. 3단계 Assign 화면 — `app/bundles/[id]/assign`(v0.10.0)

- 옛 `/classify`·`/match`는 이리로 넘긴다.
- 상태 · 데이터 · 동작은 `use-assign-page.tsx` `useAssignPage()`, `page.tsx`는 그리기 — 위쪽 줄은 `assign-bar.tsx`, 오른쪽 결정 칸은 `assign-side-panel.tsx`, 둘 다 `state`(`AssignPageState`)를 받는다.
- 고름 · 처리 중 · 따라가기는 순수 모델 `lib/assign-focus-model.ts` + 훅 `lib/use-assign-focus.ts` 한 곳 — 편집 중에도 고름을 두고, 응답 뒤 고름이 누른 때 그대로일 때만 결과 박스를 따라간다. 판단 저장 중인 박스는 잠기지 않는다(다시 고를 수 있다).
- **명령 큐(한 줄)**: 판단 저장 · 배정 취소 · 일괄 · 그림 삭제 · 원문 편집 · 짝 · 되돌리기 · 묶음 전체 일(같은 글자 · 모두 받기 · 초기화 · 신규 표시 · 출처 잇기 …) · 번역 확정/지우기가 모두 `use-command-queue.ts` `enqueue`를 지난다. 순수 모델 `lib/command-queue.ts`(하나씩 · 장벽 · 실패 멈춤 · 되묻기)는 React를 모르고, 훅은 이펙트가 없다 — `use-assign-page.tsx`의 줄 없는 이펙트 하나가 커밋마다 `mount` · `pump`를 부른다.
  - 판단(`save`)은 누른 순간 줄 · Unit · 초안을 잡고 `lib/next-box-model.ts` `pickNextBox`(저장 중인 것도 된 것으로 센다)로 고름을 옮긴다. 보류 · 배정 취소 · 일괄은 저장 뒤처럼 그 자리에 머문다. 한 언어만 이어 짝이 풀리는 저장은 결과 박스를 몰라 줄에서는 장벽(`unpair`)이다.
  - 장벽(`isBarrier`) 앞에서 누른 글쇠 · 판단 단추 · (글쇠가 쌓인 뒤의) 클릭은 `key` · `press` · `pick`으로 쌓이고, 장벽의 보기가 놓여 고름이 선 **그 커밋**(`settleWait`)에서 하나씩 다시 눌린다. 되살린 글쇠가 만든 명령은 남은 글쇠 앞(`pushNext`)에, 사유 창을 열면 답할 때까지(`asking`) 뒤가 기다린다. 되돌리기(`step`)만 대상이 없어 앞 장벽의 응답 뒤 바로 나가고(New 문서 보기를 기다리는 장벽은 빼고), 그때 앞 장벽의 늦은 보기는 놓지 않는다(`ctx.isCurrent` · `useDocViews().discard`) — 놓으면 은퇴한 박스의 고름이 풀려 되돌리기가 따라가지 못한다. 장벽이 끝나자 고른 것이 사라졌으면 쌓인 글쇠를 버리고 알린다. 고쳐 쓰기(`E`)가 쌓이면 그 뒤 글쇠는 쌓지 않고, 누르고 있는 글쇠는 이동만 받는다(`lib/assign-press-model.ts`).
  - 보낼 값은 누른 때가 아니라 나갈 때의 것(`liveRef`)이고, 판단 revision은 누른 때 화면에서 본 것(`seen`)을 `lib/write-log.ts`가 앞 응답으로 이어 준다(문서 revision은 `doc-revision`). 미룬 명령과 다시 시도는 나가는 때의 화면 값을 찍고, 보내려고 방금 받은 묶음의 revision은 화면에 없던 것 · 방금 비운 단위에만 쓴다(남이 바꾼 것을 덮지 않게). 받아 둔 관계 묶음은 그 뒤 쓴 것이 들지 않았을 때만 쓴다(`isFresh`).
  - 저장 응답의 판단은 `useDocViews().patchDecisions`로 줄에 먼저 얹고, 다시 읽기는 `requestReload`(`lib/reload-ask-model.ts`)로 모아 큐가 빌 때(또는 멈췄을 때) 한 번 — 장벽의 문서 보기(`placeReload`)만 바로 받는다.
  - 실패하면 멈추고 `queue-failure.tsx`(Retry · Discard)가 알린다. 뒤에 기다리는 것이 없는 편집 · 되돌리기의 거절(4xx)은 알림만(`shouldHalt`). 화면을 떠나면 남은 판단은 마저 보내고 글쇠는 버리며, 떠난 뒤의 실패와 멈춘 채 떠난 것은 못 나간 수를 알린다(나가기 확인은 초안 · 멈춘 것만 센다).
- Old 원문(Split `Paper` 조각)이 곧 목록이고 옆에 이미 쓴 New 원문을 연다(`components/assign/`).
- 두 문서 사이 세로선으로 폭, 마우스를 올린 문서만 Ctrl+휠·Ctrl ±로 확대(`lib/use-pane-zoom.ts`, 값은 `lib/assign-view-prefs.ts`가 `sopa.assign.*`에 기억).
- 오른쪽 칸의 틀은 `components/assign/side-float.tsx` — 창이 1440px보다 좁으면 떼어 띄운다(자리 셈 `lib/side-float-model.ts`, 창 크기 `lib/use-window-size.ts`, 기억은 `assign-view-prefs`의 `sideFloat`·`sideX`·`sideY`·`sideFolded`). 붙어 있든 떠 있든 같은 `<aside>`라 안의 내용이 다시 만들어지지 않고, 열 폭은 CSS(`.assign-frame:has(> .assign-side[data-float])`)가 바꾼다. 모달이 아니다(role 없음) — 화면 단축키는 `[role="dialog"]`이 있으면 멈춘다.
- New 문장 목록·Old 하나의 New 후보는 서버 `app/sop/written.py`(`/written-sentences`·`/units/{id}/new-candidates`, 임베딩 캐시만 읽고 없으면 글자 유사도).

## 4. 공용 훅·저장소

- `bundle-store`(묶음 캐시 — 화면 진입마다 다시 부르고 로그아웃·사용자 전환 때 비운다).
- AI 작업 상태는 공용 폴러 `lib/ai-jobs-store.ts`(사용자당 하나, `GET /api/ai/jobs/recent`)가 읽고 규칙은 `ai-jobs-model.ts`, 상단 바 표시는 `components/ai-jobs-indicator.tsx`·`ai-jobs-popover.tsx`(`use-ai-jobs`는 그 묶음의 요청이 바뀔 때 `/ai/status`만 다시 읽는다).
- `leave-guard`(미저장 이탈 가드)·`use-loaded`.
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

## 9. 관리 API·Markdown 보기

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
