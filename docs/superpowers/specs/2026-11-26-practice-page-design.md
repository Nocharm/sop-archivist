# 연습 페이지(`/practice`): 설계

- 날짜: 2026-11-26
- 출처: 쪼개기 먼저 장부의 "9 연습 페이지"(사용자 11-26 밤 정정 — 이번 정식 업데이트에 넣는다), 그 브리프, 그리고 사용자가 질문 창에서 확정한 컨셉 네 가지(11-26 밤, §2 U1~U4). 나머지는 묻지 않고 추천안으로 정했고 §2에 까닭과 함께 적었다.
- 기반: v1.6.38 `dev`의 Assign(`app/bundles/[id]/assign`), API 층 `src/lib/api.ts` `sendRequest`, 글쇠 표 `lib/assign-keymap.ts`, 숨긴 기능 스위치 `lib/drafting.ts`, 데모 시드 도구 `backend/scripts/seed_sop_demo.py` · `dump_rule_cases.py`.
- 계획: [`../plans/2026-11-26-practice-page.md`](../plans/2026-11-26-practice-page.md)
- 표기: **(사용자 결정)** 브리프 · 질문 창에서 정한 것 — 바꾸지 않는다. **(내 판단)** 이 문서가 정한 기본값 — 사용자 검토 대상. 표시가 없는 문장은 위에서 따라 나오는 설명이다.

## 1. 의도와 범위

T/F 사람이 실제 자료를 건드리지 않고 Assign의 손짓 열둘(고르기 · 옮기기, 잇기, 확정, 보류, 배정 취소, 합치기, 나누기, 한/영 짝, 표 벗기기, 목차, 되돌리기, 키보드 그림)을 한 번씩 해 보는 화면이다.

- **(사용자 결정)** 실제 Assign 부품을 그대로 쓰고 API 부르기만 브라우저 메모리의 가짜 서버로 돌린다. 서버 · DB에는 아무것도 쓰지 않는다. 간단한 튜토리얼 느낌.
- **(사용자 결정)** 주소 `/practice`, 진입은 두 곳만(U5). 로그인한 사람 누구나. 운영 빌드에서도 보인다. 새로고침하면 처음으로.
- **(사용자 결정)** 새 화면 요소는 Graphite 톤 · 기존 토큰만(중립 바탕, 종류는 띠나 점, 파스텔 채움 금지).
- 화면 · 진행 · 과제 · 자료는 §2 U1~U4.

만들지 않는 것: 다른 단계 화면(Documents · Outputs · Map …)의 연습, AI 제안, Excel · 미리 보기 내려받기, 서버 업무 규칙(거절 · 409 · 422)의 흉내, 연습 진행의 저장.

## 2. 정한 것

### 2.1 사용자 결정(질문 창, 11-26 밤)

| # | 정한 것 |
|---|---|
| U1 | **과제 안내 자리 = 오른쪽 과제 목록.** Old · New 용지(와 Assign 오른쪽 결정 칸) 옆 오른쪽 칸에 과제 12개 체크리스트가 늘 보이고, 지금 과제만 펼쳐져 무엇을 누르는지(글쇠)와 "설명서에서 보기 →"(en "See in the manual →") 링크가 보인다. 끝낸 과제는 ✓. 위에 띠 "연습 화면 — 저장되지 않음"(en "Practice — nothing is saved")과 "처음부터"(en "Start over") 단추. 좁은 창에서는 과제 칸을 접을 수 있다. |
| U2 | **진행 = 화면이 알아채 자동 체크**(가짜 서버 상태로 판정). 과제를 끝내면 다음 과제가 펼쳐진다. 순서는 자유 — 아무 과제나 먼저 해도 된다. |
| U3 | **과제 = 기본 12개**: 줄 고르기 · 옮기기(J/K) / New에 잇기 / 확정(Enter) / 보류(⇧H) / 배정 취소(U) / 합치기(⇧J) / 나누기 / 한·영 짝(⇧P) / 표 벗기기(⇧T) / 목차 삭제 / 되돌리기(Ctrl+Z) / 키보드 그림(?). 실제 글쇠는 `lib/assign-keymap.ts`와 맞춘다. |
| U4 | **자료 = 한/영 짝이 섞인 Old 문서 하나(표 하나 · 목차 블록 포함) + 빈 New 하나.** UI 언어는 사용자 설정(en/ko)을 따르고 자료 글은 한 벌. |
| U5 | **진입은 두 곳만**: 상단 바 도움말(설명서 자리에 "연습하기" 항목)과 설명서 `/manual` 머리의 "연습 화면에서 따라 해 보기 →" 링크. Assign의 ? 도움말 창과 Bundle 목록에는 넣지 않는다. |

### 2.2 설계가 정한 것

| # | 정한 것 | 까닭 |
|---|---|---|
| D1 | 가짜 서버는 `src/lib/api.ts` `sendRequest` **한 곳**에서 갈아 끼운다. `fetch` 앞에서 `isPracticeRequest(path, pathname)`이 참이면 `await import("./practice/practice-server")`의 `handlePracticeRequest(method, path, body)`가 `Response`를 지어 돌려주고, 그 뒤 오류 처리(`ApiError` · `rule`)는 실제와 같은 줄을 지난다. | Assign의 모든 읽기 · 쓰기가 `apiFetch` → `sendRequest`를 지난다(실측: Assign 트리 229파일에서 `/api`로 가는 `fetch`는 `api.ts` 하나, 나머지 하나는 부팅 때의 `auth-mode.ts`). 부품마다 주입하면 52개 함수를 건드린다. 동적 import라 가짜 서버와 자료는 연습 화면 덩이에만 실린다. |
| D2 | 연습 요청의 판정은 둘의 합: ① 경로가 연습 Bundle(`/bundles/-1` 아래)이면 **늘** 가짜, ② 지금 화면 주소가 `/practice`이고 경로가 실제로 보낼 목록(`/me`, `/ai/jobs/recent`) 밖이면 가짜. 주소 판정은 `typeof window` 가드. | ①은 화면을 떠난 뒤에도 큐가 마저 보내는 판단("앱 안 이동은 큐가 마저 보낸다")이 실제 서버로 새지 않게 한다. ②는 Bundle 밖 경로(`/sop/remarks/recent` 등)와 앞으로 생길 경로를 기본으로 막는다 — 새는 길은 목록에 적은 것만. `/me`는 신원(새로 연 `/practice`에서도 로그인 상태를 읽어야 한다), `/ai/jobs/recent`는 상단 바 공용 폴러(가짜 빈 답이 실제 AI 작업 표시를 지우지 않게) — 둘 다 읽기만이고 SOP 자료가 아니다. |
| D3 | 연습 Bundle id는 상수 `PRACTICE_BUNDLE_ID = -1`(`src/lib/practice-route.ts`, 무거운 import 없음 — `api.ts`가 가져온다). 연습 문서 id는 900001부터(자료를 뽑을 때 정한다). | 실제 id는 1부터 오르는 양수라 겹치지 않는다. 문서 id는 브라우저 저장 키(`sopa.assign.tablesFolded.<문서 id>`)에 들어가므로 실제 문서의 접은 표와 섞이지 않게 멀리 둔다. |
| D4 | 연습 자료는 **실제 백엔드가 뽑는다**: `backend/scripts/dump_practice_fixture.py`가 합성 DOCX 둘(Old · New)을 지어 임시 sqlite에 TestClient로 올리고, 화면이 처음 읽는 GET 응답과 표 벗긴 모습(D7)을 `frontend/src/lib/practice/practice-fixture.json`에 쓴다. `backend/tests/test_practice_fixture.py`가 파일이 지금 백엔드의 답과 같은지 본다(`test_rule_cases.py`와 같은 꼴). | 용지는 블록 · 범위 · 번호 칸 · 짝 · 잡음 표시가 서로 맞아야 그려진다. 손으로 쓰면 틀리고, 백엔드가 응답 꼴을 바꾸면 연습만 조용히 깨진다. 뽑은 자료면 처음 모습이 실제와 같고, 꼴이 바뀌면 CI가 알린다. |
| D5 | 가짜 서버는 **과제에 쓰는 동작만** 흉내 내고(§6.3), 받은 요청을 검사하지 않고 그대로 반영한다. 그 밖의 경로 · 편집 종류는 `422 {detail: {code: "practice_unsupported", what}}` — 화면은 기존 길(`humanizeApiError` → `rule.practice_unsupported`)로 "Not available in practice" 알림을 띄운다. | 서버 업무 규칙의 사본을 만들지 않는다(사용자 결정). 막는 판단은 이미 화면의 순수 모델(`pick-bar-model` · `primary-model` · `planShapeMode` …)이 한다. 거절 길을 새로 만들지 않고 규칙 거절 문구 길을 쓴다. |
| D6 | 원문 편집은 일곱 종류만: `split` · `merge` · `unmerge` · `set_language` · `set_layout_table` · `set_noise_reason` · `clear_noise`. 앞의 넷은 "글자 자르기 · 잇기 · 되살리기 · 값 바꾸기"만 하는 일반 연산이고 번호 칸 · 문장 경계 규칙은 하지 않는다. 짝은 맺기 · 풀기 · 확정. | U3의 과제가 이것만 쓴다 — ⇧P는 짝 카드면 `merge`, 합친 문장이면 `unmerge` → `set_language` → `pairs` POST(`use-assign-page.tsx` `switchShapeMode` · `switchToPair` 실측), ⇧T는 `set_layout_table`, 목차의 사유는 `set_noise_reason`, 되돌릴 때 쓰는 `clear_noise`. 쪼갠 뒤 번호 칸이 실제와 조금 달라도 연습에는 지장이 없다. |
| D7 | 표 벗기기 · 다시 표로(`set_layout_table`)는 흉내 내지 않고 **백엔드가 뽑은 두 모습 사이를 바꾼다**: 자료가 그 표의 `wrapped`(처음)와 `unwrapped`(실제 서버로 벗긴 뒤의 `tables` · 바뀐 Unit들)를 함께 싣고, 가짜는 그 Unit 묶음을 갈아 끼운다. | 표 벗기기는 번호만 든 칸 합치기 · 띠 표 · 안쪽 표가 얽힌 서버 규칙이다(`editing._plan_set_layout_table`). 자료의 표 하나만 다루니 두 모습을 찍어 두면 사본 없이 실제와 같다. |
| D8 | 되돌리기 · 다시 하기는 **상태 통째 사진**으로 한다: `undo` 메타가 실린 쓰기마다 쓰기 전 상태를 쌓고(같은 `step_key`의 이어진 요청은 한 칸), `decisions/undo`가 꺼내 되쓴다. 응답의 `unit_ids`는 사진 둘의 판단 · 단위 차이에서 짓는다. | 서버의 단계 기록 규칙을 흉내 내지 않고도 판단 · 편집 · 짝이 한 줄로 되돌아간다. 상태가 작아(Unit 40개 안팎) 사진이 싸다. |
| D9 | 과제 판정(U2)은 연습 상태의 **한 일 기록**(append-only `log`)으로 한다. 쓰기 열 과제는 가짜 서버가 받은 요청(경로 · 편집 종류 · `undo.op` · Unit id)으로, 서버에 자취가 없는 두 과제(고르기 · 옮기기, 키보드 그림)는 연습 틀이 본 손짓 — 틀의 `onKeyDownCapture`가 `findAssignKey`로 찾은 `move_next` · `move_prev`, `onClickCapture`가 본 키보드 그림 여는 단추 — 을 같은 `log`에 적는다(`notePracticeAct`). 한 번 이룬 과제는 계속 ✓(되돌려도 지우지 않는다). 어느 줄에서 해도 된다. | U2 "가짜 서버 상태로 판정"을 따르되 두 과제는 서버에 아무것도 오가지 않아 상태가 없다 — 그 둘만 손짓을 같은 기록에 넣어 판정 길은 하나다. 글쇠는 `ASSIGN_KEYS` 표로 찾아 글쇠를 바꾸면 따라간다. React 합성 이벤트라 이펙트가 없고, Assign은 `window` 버블 단계에서 듣고 전파를 막지 않아(실측) 틀의 캡처가 먼저 본다. 되돌리기 과제가 앞 과제의 ✓를 지우면 헷갈린다. |
| D10 | 펼친 과제(U1 · U2)는 렌더 중에 셈한다: 사람이 누른 과제가 있고 그것을 누른 뒤 아직 이루지 않았으면 그것, 아니면 첫 미완료(차례대로). 다 끝나면 "다 했어요" 한 줄과 **Start over**. | 타이머 · 이펙트 없이 "끝나면 다음이 펼쳐짐"과 "순서 자유"가 함께 된다. |
| D11 | 연습 상태는 가짜 서버 모듈의 변수에만 산다 — 페이지를 새로 읽으면 처음, 앱 안에서 떠났다 돌아오면 이어진다. **Start over**는 `window.location.reload()`. | 상태를 지우는 길이 "모듈이 새로 읽힘" 하나라 렌더 중 부작용 · 이펙트가 없다. 설명서 링크는 새 탭이라 하던 연습이 그대로다. |
| D12 | Assign은 `useParams().id` 한 줄만 바꾼다: `use-assign-page.tsx`의 `Number(useParams<{ id: string }>().id)` → `useRouteBundleId()`(새 `src/lib/use-route-bundle-id.ts` — `BundleIdContext` 값이 있으면 그것, 없으면 `useParams`). `/practice`는 `<BundleIdContext value={PRACTICE_BUNDLE_ID}><AssignPage /></BundleIdContext>`로 `app/bundles/[id]/assign/page.tsx`의 기본 내보내기를 그대로 그린다. | 주소 · 라우터 의존은 이 한 줄과, 연습에서는 닿지 않는 `router.replace` 둘(옛 `?edit=` · `?doc=&unit=` 주소를 읽을 때만)뿐이다(실측 §12). 페이지 파일은 기본 내보내기만 가져다 쓰니 Next 페이지 내보내기 규칙에 걸리지 않는다. |
| D13 | 연습 Bundle 주소로 가는 이동(`/bundles/-1/...`)은 `lib/nav-buffer.ts` `navigate()`가 막고 "Not available in practice" 알림을 띄운다. | `DestinationTree`의 To-Be 링크 · 빈 화면의 Documents 링크 같은 다른 단계 길이 연습 Bundle의 실제 단계 화면으로 가지 않게 한다. `nav-host`가 앱 안 `<a>` 클릭을 모두 `navigate()`로 보내니 한 곳이면 된다. 주소창에 `/bundles/-1/assign`을 직접 치면 띠 없는 연습이 되지만(모든 요청이 D2 ①로 가짜) 아무것도 저장되지 않아 둔다. |
| D14 | 화면 틀: 상단 바 아래 **띠**(한 줄, 폭 전체) → 그 아래 두 칸 grid `minmax(0, 1fr) | 과제 칸`. 과제 칸 폭 `clamp(240px, 18vw, 300px)`, 접으면 36px 세로 막대(진행 `n/12`와 펴기 단추만). 접힘은 `useState` 하나(기억하지 않는다). | U1. Assign의 오른쪽 결정 칸은 Assign 안에 그대로 있고 과제 칸은 그 바깥 오른쪽이다. Assign이 창 폭 1440px 밑에서 결정 칸을 띄우는 셈(`side-float-model`)은 창 폭을 보므로 과제 칸만큼 좁아진 사이 폭(1440~1740px)에서 용지가 빠듯하다 — 그때 접는다(U1 "좁은 창에서는 접을 수 있게"). 기억은 한 화면의 일이라 두지 않는다. |
| D15 | U5를 이렇게 놓는다: ① **상단 바 사용자 메뉴의 도움말 항목 `user-menu-manual`("User manual") 바로 아래에 `user-menu-practice`**("Practice" / "연습하기", 아이콘 `GraduationCap`, 같은 탭 이동, `/practice`에서는 빠짐). ② 설명서 화면 머리(`manual-view.tsx` 첫 줄, 한국어 글 안내 옆)의 링크 `manual-practice`("Try it in the practice screen →" / "연습 화면에서 따라 해 보기 →", 같은 탭). 책 아이콘 `top-bar-manual`은 그대로 링크 하나이고, `/practice`에서는 새 설명서 조각 `#practice`로 연다. Assign 도움말 창(`assign-help.tsx`) · Bundle 목록은 건드리지 않는다. | 상단 바에서 설명서가 "항목"으로 있는 곳은 사용자 메뉴의 `user-menu-manual`이다 — 그 자리에 항목 하나를 더하는 것이 U5의 "설명서 자리에 '연습하기' 항목"과 맞고 새 메뉴 부품이 없다. 책 아이콘을 메뉴로 바꾸면 기준 스모크(`pw-smoke-baseline.mjs`가 `top-bar-manual`의 `href`를 바로 본다)의 기대를 바꿔야 한다. 연습은 하던 일을 덮어도 되는 화면이라 같은 탭(떠날 때는 Assign의 나가기 확인이 그대로 걸린다). **(내 판단 — U5의 자리 해석, 사용자 확인 대상)** |
| D16 | 권한 키를 더하지 않는다. `AppShell`의 로그인 게이트만 지난다. 연습 Bundle의 `my_role`은 자료에서 `"author"`, `status`는 `"in_progress"`라 편집이 켜진다. | 서버에 아무것도 쓰지 않으니 막을 권한이 없다(사용자 결정 "로그인 사용자 누구나"). |
| D17 | 숨긴 기능과 다른 길이다: 연습은 `isDraftingOn()`을 읽지 않고 운영 빌드에서도 늘 있다. 연습 안의 Assign은 실제와 같이 `useDraftingOn()`을 읽으므로 운영에서는 숨긴 쪽이 꺼진 Assign이 된다. 개발에서 `sopa.drafting="1"`을 켜면 숨긴 쪽 읽기는 빈 답 · 쓰기는 `practice_unsupported`(최선만, 시험하지 않는다). | 사용자 결정 "운영에서도 보여야 한다". 연습은 운영 사용자가 보는 Assign을 가르치는 것이라 숨긴 쪽을 따로 다룰 까닭이 없다. |
| D18 | 보기 설정(`sopa.assign.*` — 한 단/양 단 · 확대 · 결정 칸 띄우기)은 실제 Assign과 같이 기억된다. | 사람 취향이라 같이 가도 된다. 따로 두려면 Assign 저장 층을 고쳐야 한다(실제 Assign 변경 최소). |
| D19 | 과제 글의 글쇠는 `ASSIGN_KEYS`의 id로 적고 `formatAssignKey`로 그린다. | U3 "실제 글쇠는 keymap과 맞춘다". 시험이 id가 표에 있고 그 글쇠가 U3의 글쇠(J/K · Enter · ⇧H · U · ⇧J · ⇧P · ⇧T · Ctrl+Z · ?)와 같은지 본다 — 글쇠가 바뀌면 시험이 알리고 과제 글이 따라간다. |
| D20 | **"빈 New"(U4)를 "아직 아무것도 이어지지 않은 New 문서"로 읽는다** — 문장은 있고(Old 짝 둘을 고쳐 쓴 글 · 그 밖의 두셋), 이음 · 확정은 하나도 없다. | 문장이 없는 New면 "New에 잇기" · "확정(Enter)"이 이을 상대가 없어 할 수 없다(숨긴 기능이 꺼진 Assign은 이미 쓴 New 문장에만 잇는다). 미리 확정한 줄도 두지 않아 처음 화면에 이음이 없다 — 그래서 "배정 취소"는 잇기나 확정을 먼저 한 뒤에 된다(과제 글이 그렇게 알린다, 순서 자유는 그대로). |
| D21 | **"목차 삭제"(U3)는 저절로 삭제된 목차 블록에 사유를 적는 것(R, `set_noise_reason`)으로 판정한다.** 과제 글: 목차 블록이 이미 삭제로 접혀 있음을 보고, 블록을 골라 R로 사유를 적는다. | 지금 올리는 규칙(규칙 2)은 목차를 올릴 때 이미 삭제로 접는다(`noise_kind: "toc"`) — 사람이 할 일은 확인과 사유다. 목차를 일반 줄로 두고 Del로 지우게 하면 실제와 다른 화면을 가르친다. |
| D22 | **"New에 잇기"와 "확정(Enter)"은 보내는 요청의 `undo.op`로 가른다**: 잇기 = Old · New를 고르고 단추 줄의 잇기(또는 끌어 놓기 · 양쪽 고른 Enter), 확정 = Old 줄 하나에서 추천 카드가 든 채 Enter(`planPrimary`의 첫 카드 확정). 스텝 4가 두 손짓의 실제 본문을 시험으로 고정한다(예상: `"link"` · `"confirm"`). | 둘 다 `groups/save`로 나간다. 사람에게는 다른 손짓이라 U3가 나눴다. |
| D23 | 브랜치는 **모음 브랜치** `feat/practice-page`에서 스텝 브랜치를 딴다(계획 문서). | 자료만 · 가짜 서버만 · 과제 없는 빈 화면만으로는 `dev`에서 확인할 것이 반쪽이다. |
| D24 | 설명서는 `## 연습 화면 {#practice}` 조각 하나를 `## 시작하기 {#start}` 바로 뒤에 더한다(글은 스텝 3 · 4, 그림은 정식 업데이트 준비 때 장면 `practice`). | 도움말 단추가 여는 자리는 조각(`##`) 단위다(`getManualHref` · `MANUAL_PAGE_SECTION`). Map · History처럼 화면 하나가 조각 하나다. |

## 3. 화면

```
┌ 상단 바 ─ SOP Archivist v1.6.x ──────────────────── [AI] [📖] [사용자 ▾ … User manual · Practice] [EN|KO] ┐
├ 띠 practice-band ─ ▍ Practice — nothing is saved · Reloading starts over          [Start over] ┤
├ Assign(실제 부품, 연습 Bundle) ─────────────────────────────────┬ 과제 칸 practice-tasks ─────┤
│ Old 용지              │ New 용지          │ 결정 칸(Assign)     │ Tasks · 3/12           [⟩] │
│                       │                   │                     │ ✓ Pick and move a line     │
│                       │                   │                     │ ✓ Link to New              │
│                       │                   │                     │ ▾ Confirm  ────────────────│
│                       │                   │                     │   Pick pair B and press    │
│                       │                   │                     │   [Enter] with the card…   │
│                       │                   │                     │   See in the manual →      │
│                       │                   │                     │ ○ Hold                     │
│                       │                   │                     │ ○ …                        │
```

- **띠** `practice-band`: 바탕 `--sunken`, 왼쪽 3px 띠는 기존 주의 토큰(파스텔 채움 없음), 아이콘 `FlaskConical`(상단 바 "Synthetic data"와 같은 뜻의 아이콘). 글 `practice.band`("Practice — nothing is saved" / "연습 화면 — 저장되지 않음"), 흐린 보조 글 `practice.bandHint`("Reloading starts over" / "새로 읽으면 처음으로"), 오른쪽 `practice-start-over`("Start over" / "처음부터", `btn ghost`).
- **과제 칸** `practice-tasks`(`<aside>`, 모달 아님 — role 없음): 머리 "Tasks" · 진행 `n/12`(`practice-progress`) · 접기 단추(`practice-tasks-fold`). 과제 줄 `practice-task-<id>`(`data-done="true|false"`, `data-open`) — 왼쪽 점: 미완료는 빈 점(`--line-2` 테두리), 끝낸 것은 ✓(`CircleCheck`, 기존 확정 색 토큰), 펼친 줄은 왼쪽 2px 강조 띠(막대 쪽 모서리 직각). 펼친 줄 아래: 할 일 한두 줄(글쇠는 `<kbd>` — `formatAssignKey`)과 `practice-task-manual` 링크("See in the manual →" / "설명서에서 보기 →", `/manual#<anchor>`, 새 탭). 줄 머리를 누르면 그 과제가 펼쳐진다(D10).
- 접힌 과제 칸 `data-folded`: 36px 막대에 `n/12`와 펴기 단추만.
- 높이: 띠는 `flex: none`, 아래 grid는 남은 높이(`min-height: 0`), 과제 칸은 저 혼자 세로 스크롤. Assign 쪽 CSS는 고치지 않고 연습 페이지의 감싸개만 더한다(`.practice-*` 새 선택자, `components.css` 끝 — 공용 규칙은 바꾸지 않는다).
- 폰 폭은 생각하지 않는다(Assign 자체가 데스크톱 화면).

## 4. 연습 자료

### 4.1 만드는 법

`backend/scripts/dump_practice_fixture.py`(개발 전용, `synthetic_sop.py`처럼 python-docx와 테스트 팩토리 `build_docx` · `p` · `make_style` · `upload`를 쓴다):

1. 빈 임시 sqlite로 앱을 띄우고(테스트가 DB를 만드는 길과 같게) TestClient · dev 작성자 헤더를 쓴다.
2. 문서 id를 900001부터 받게 한다(D3) — 예: 버리는 Bundle에 작은 문서 하나를 올린 뒤 그 행 id를 900000으로 옮겨 sqlite의 다음 행 id를 밀어 둔다. 방법은 스텝 1이 정하되 시험이 "자료의 문서 id ≥ 900001"을 본다.
3. 연습 Bundle을 만들고 Old DOCX(`SYNTHETIC_PRACTICE-OLD.docx`)와 New DOCX(`SYNTHETIC_PRACTICE-NEW.docx`, New 쪽 올리기)를 올린다. 지금 올리는 규칙(규칙 2)으로 쪼개진다. 판단 · 이음은 하나도 만들지 않는다(D20).
4. 화면이 처음 읽는 응답을 받아 쓴다: `GET /bundles/{b}` · `/documents` · 문서마다 `/view` · `/units?limit=1000` · `/tobe` · `/written-sentences` · New 문장마다 `/groups/by-target/{t}`(→ `targets`) · Old 문장 Unit마다 `/units/{u}/new-candidates`.
5. 표 벗긴 모습(D7): 표에 실제 `set_layout_table`(`is_layout: true`)을 보내 그 뒤 보기에서 그 표의 `tables` 줄과 표 · 칸 Unit을 `tableVariants.<tableId>.unwrapped`로 찍고, 처음 모습을 `wrapped`로 둔다. 찍은 뒤 되돌려(`decisions/undo`) 4의 처음 응답과 같은지 확인한다.
6. 다듬기: `bundle.id`와 모든 `bundle_id` → -1, 제목 "Practice", 구성원은 합성 한 명(`practice`), 시각 칸은 고정 값(`2026-11-26T00:00:00+09:00`), `*_by`는 `practice`, `my_role` "author". 키 차례를 정렬해 같은 입력이면 같은 바이트.
7. `{ "_generated": "backend/scripts/dump_practice_fixture.py", bundle, documents, views: {<docId>: DocumentView}, units, tobe, written, targets, candidates: {<unitId>: NewCandidate[]}, tableVariants: {<tableId>: {wrapped, unwrapped}} }`로 쓴다.

`backend/tests/test_practice_fixture.py`: 파일이 `render_practice_fixture()`와 같은지(다르면 "다시 뽑고 `npx vitest run src/lib/practice`를 돌려라"), 그리고 §4.2의 각 자리가 의도대로 나왔는지 — 나눌 Unit이 두 문장, 합칠 두 조각이 이웃한 같은 언어(⇧J로 합쳐지는 자리), ⇧P 짝이 확정 · 이웃 짝, 목차 줄 `noise_kind == "toc"`, 표 Unit 하나(벗기기 전), 짝 B의 후보에 New B′가 첫째, 이음 · 확정 0 — 쪼개기 규칙이 바뀌어 자리가 무너지면 여기서 걸린다.

프런트는 `practice-fixture.json`을 타입으로 묶는다(`satisfies PracticeFixture` — 필드가 `api-sop.ts` 타입과 어긋나면 tsc가 잡는다).

### 4.2 Old 문서 — 설명서 글로 지은 합성 SOP(짧게, 한 벌)

모든 문장은 사용 설명서에서 따온 합성 글이다(실제 SOP 원문 아님, 파일 이름 `SYNTHETIC_`). 아래는 차례와 쓰임이고, 글은 스텝 1이 설명서에서 고른다. UI가 en이어도 자료 글은 이 한 벌이다(U4).

| # | 블록 | 쓰임(과제) |
|---|---|---|
| 1 | 제목 "연습용 SOP — Assign 따라 하기" | 제목 줄, 고르기 · 옮기기 |
| 2 | 목차 머리 + 목차 스타일 줄 3(점 끌기 · 쪽 번호) | 목차 블록(저절로 삭제) — 목차 삭제(R 사유) |
| 3 | 1. 목적 제목 | – |
| 4 | 한/영 이웃 문단 짝 A(설명서 "Old Unit마다 새 문서의 어디로 갈지 정하고 확정합니다" 류) | New에 잇기(New A′를 골라 잇기) |
| 5 | 한/영 이웃 문단 짝 B — New B′와 글이 비슷해 추천 카드가 뜬다 | 확정(Enter), 그 뒤 배정 취소(U) |
| 6 | 한/영 짝 C | 보류(⇧H) |
| 7 | 한 문단에 두 문장인 한국어 Unit("정할 수 없는 Unit은 보류합니다. 보류한 Unit은 On hold에 모입니다.") | 나누기(두 번 눌러 선 → S) |
| 8 | 문장 하나가 두 문단으로 끊긴 같은 언어 두 조각 | 합치기(⇧J ⇧J) |
| 9 | 한/영 이웃 짝 D | 한·영 짝(⇧P로 한 문장 ↔ 짝) |
| 10 | 표 하나(3행 × 2열, 글쇠 · 뜻 — 번호만 든 칸 · 띠 · 안쪽 표 없음) | 표 벗기기(⇧T) |
| 11 | 끝 문단 한/영 짝 E | 여유 |

되돌리기(Ctrl+Z)와 키보드 그림(?)은 자리가 따로 없다.

### 4.3 New 문서 — 아무것도 이어지지 않은 New(D20)

New 문서 하나(`SYNTHETIC_PRACTICE-NEW`, SOP): A′(A를 고쳐 쓴 한/영 두 문장), B′(B와 거의 같은 한/영), 그 밖의 문장 두셋, 이을 수 없는 제목 줄 하나(이을 수 없다는 까닭 툴팁이 보이게). 이음 · 확정은 없다.

## 5. Assign이 부르는 API (실측)

`app/bundles/[id]/assign/page.tsx`에서 import를 따라간 229파일이 `api.ts` · `api-sop.ts` · `api-manage.ts`에서 가져다 쓰는 함수 전부. "가짜"의 뜻: **상태** = 연습 상태에서 지어 답, **자료** = 뽑은 자료 그대로, **빈 답** = 빈 목록 · 꺼짐, **흉내** = 쓰기를 상태에 반영, **안 됨** = `practice_unsupported`, **실제** = 실제 서버로(D2).

| 함수 | 메서드 · 경로(`/api` 뒤) | 쓰는 곳 | 과제에 필요 | 가짜 |
|---|---|---|---|---|
| `getMe` | GET `/me` | 세션(껍데기) | – | 실제 |
| `getRecentAiJobs` | GET `/ai/jobs/recent` | `lib/ai-jobs-store.ts`(상단 바) | – | 실제 |
| `getBundle` | GET `/bundles/{b}` | `lib/bundle-store.ts` | 예(편집 켜짐) | 자료 |
| `listDocuments` | GET `/bundles/{b}/documents` | 훅 | 예 | 자료 |
| `getDocumentView` | GET `/bundles/{b}/documents/{d}/view` | 훅 · `use-doc-views` | 예 | 상태 |
| `listAllUnits` | GET `/bundles/{b}/units?…&document_id=` | `use-doc-views` | 예 | 상태 |
| `getToBe` | GET `/bundles/{b}/tobe` | 훅 | 예(New 문서 목록) | 자료 |
| `listWrittenSentences` | GET `/bundles/{b}/written-sentences` | 훅 | 예(New 문장 · 출처) | 상태 |
| `getGroupByUnit` | GET `/bundles/{b}/groups/by-unit/{u}` | 훅 · `clearDecisions` | 예 | 상태 |
| `getGroupByTarget` | GET `/bundles/{b}/groups/by-target/{t}` | 훅 | 예 | 상태 |
| `listNewCandidates` | GET `/bundles/{b}/units/{u}/new-candidates` | 훅(추천 카드) | 예(확정) | 자료(처음 Unit만, 새 Unit은 빈 답) |
| `listRecentRemarks` | GET `/sop/remarks/recent` | `remark-modal.tsx` | 예(보류 · 목차 사유 창) | 상태(연습에서 쓴 사유) |
| `getAiStatus` | GET `/bundles/{b}/ai/status` | `use-ai-jobs` | 예(꺼짐을 알려 AI 단추가 숨는다) | 빈 답(`ai_enabled: false`) |
| `listSuggestions` · `listAppliedSuggestions` | GET `/bundles/{b}/ai/suggestions?…` | 훅 · `use-unwrap-ai` · `use-table-follow` | 아니오 | 빈 답 |
| `listIdenticalCandidates` | GET `/bundles/{b}/match/identical-candidates` | 훅 | 아니오 | 빈 답(같은 글자 일괄 단추가 안 보이게) |
| `listOpenTranslations` | GET `/bundles/{b}/translations/open` | 훅 | 아니오 | 빈 답 |
| `getTableCounterpart` | GET `…/documents/{d}/tables/{t}/counterpart` | 훅(따를 표가 있을 때만) | 아니오 | 빈 답(`null` 상대) |
| `getUnitRef` | GET `…/documents/{d}/units/{u}/ref` | 훅(참조 줄을 고를 때만 — 자료에 없음) | 아니오 | 빈 답(`state: null`) |
| `saveGroup` | POST `/bundles/{b}/groups/save` | 훅(명령 큐) | 예(잇기 · 확정 · 보류) | 흉내 |
| `bulkDecide` | POST `/bundles/{b}/decisions/bulk` | 훅 | 예(여럿 배정 취소) | 흉내(`delete` · `clear`, `move_external`은 안 됨) |
| `clearDecision`(`clearDecisions` 안) | POST `/bundles/{b}/decisions/clear` | 훅 | 예(배정 취소) | 흉내 |
| `undoDecision` · `redoDecision` | POST `/bundles/{b}/decisions/undo` · `redo` | 훅 | 예(되돌리기) | 흉내(D8) |
| `editUnits` | POST `…/documents/{d}/edits` | 훅 | 예(합치기 · 나누기 · 짝 · 표 · 목차) | 흉내: D6의 일곱 종류. 나머지는 안 됨 |
| `createPair` | POST `…/documents/{d}/pairs` | 훅 | 예(⇧P로 짝으로) | 흉내 |
| `deletePair` | DELETE `…/documents/{d}/pairs/{p}?revision=` | 훅 | 아니오(짝 풀기) | 흉내 |
| `confirmPair` | POST `…/documents/{d}/pairs/{p}/confirm` | 훅 | 아니오 | 흉내(상태 `confirmed`) |
| `ackWarning` | POST `/bundles/{b}/warnings/{w}/ack` | `missing-warnings.tsx` | 아니오(자료에 경고 없음) | 안 됨 |
| `acceptSuggestions` · `getAcceptPreview` | POST `…/ai/accept` · GET `…/ai/accept-preview` | 훅 · `accept-suggestions-modal` | 아니오(AI 꺼짐) | 안 됨 |
| `requestAi` · `prepareAi` · `requestTableFollow` · `requestUnwrapOrder` | POST `…/ai/{kind}` · `ai/prepare` · `ai/table_follow` · `ai/unwrap_order` | 훅 · `use-ai-prepare` · `use-table-follow` · `use-unwrap-ai` | 아니오 | 안 됨 |
| `setSuggestionAdoption` | POST `…/ai/suggestions/{s}/adoption` | 훅 외 | 아니오 | 안 됨 |
| `confirmMatchesInBulk` | POST `/bundles/{b}/match/bulk-confirm` | 훅 | 아니오 | 안 됨 |
| `resetAssignments` | POST `/bundles/{b}/decisions/reset` | 훅 · `reset-modal` | 아니오 | 안 됨 |
| `addToBeDoc` · `removeToBeDoc` · `addWiStep` · `removeWiStep` | POST · DELETE `/bundles/{b}/tobe/docs…` | 훅(숨긴 기능) | 아니오 | 안 됨 |
| `getComposedDoc` · `putTargetOrder` | GET `…/outputs/c/docs/{d}` · PUT `…/targets/order` | 훅 · `use-composed-order`(숨긴 기능) | 아니오 | 안 됨 |
| `getTableFollow` · `setTableCounterpart` | GET `…/tables/{t}/follow` · PUT `…/counterpart` | `use-table-follow` · 훅(영어 벗긴 표의 한글 표 따르기) | 아니오 | 안 됨 |
| `updateCaptionRef` | PATCH `…/caption-refs/{r}` | 훅 | 아니오 | 안 됨 |
| `getFigureImage` | GET `…/documents/{d}/figures/{blk}` | `figure-image.tsx`(자료에 그림 없음) | 아니오 | 안 됨 |
| `getAssignSheetPreview` · `getParagraphSheetPreview` · `downloadExport` · `downloadParagraphs` | GET `…/export/preview/a` · `…/paragraphs/preview` · `…/export.xlsx` · 문단 Excel | `space-preview.tsx` · `doc-dashboard.tsx` | 아니오 | 안 됨 |

가짜 서버가 흉내 내는 것: **경로 25개(함수 26개)** — 쓰기 9(`groups/save` · `decisions/bulk` · `decisions/clear` · `decisions/undo` · `decisions/redo` · `edits` · `pairs` POST · `pairs/{p}` DELETE · `pairs/{p}/confirm`), 상태 · 자료 읽기 10(`/bundles/{b}` · `documents` · `view` · `units` · `tobe` · `written-sentences` · `groups/by-unit` · `groups/by-target` · `new-candidates` · `/sop/remarks/recent`), 빈 답 6(`ai/status` · `ai/suggestions` · `identical-candidates` · `translations/open` · `counterpart` · `units/{u}/ref`). 나머지는 모두 안 됨. 표 벗긴 영어 표가 생기면 Assign이 `getTableCounterpart`를 부를 수 있어 빈 답으로 둔다(자료의 표는 한국어 · 영어 섞임이라 보통 부르지 않는다 — 스텝 2가 확인).

## 6. 가짜 서버

### 6.1 끼우는 자리

- `src/lib/practice-route.ts`: `PRACTICE_PATH = "/practice"`, `PRACTICE_BUNDLE_ID = -1`, `REAL_ON_PRACTICE = ["/me", "/ai/jobs/recent"]`, `isPracticeRequest(path, pathname)`(순수 — 시험), 브라우저용 `readPathname()`.
- `src/lib/api.ts` `sendRequest`: 인증 헤더를 짓기 전에 `if (isPracticeRequest(path, readPathname()))` → `const { handlePracticeRequest } = await import("./practice/practice-server")` → `response = await handlePracticeRequest(method, path, init?.body)`. 그 뒤 `!response.ok` 처리는 그대로(가짜의 거절도 실제와 같은 `ApiError`). `fetch`는 부르지 않는다.
- `src/lib/practice/practice-server.ts`: 상태 하나 · 길잡이(메서드 + 경로 패턴 → 처리 함수) · `notePracticeAct(act)`(D9) · `subscribePractice(listener)` · `readPracticeSnapshot()`(과제 칸이 `useSyncExternalStore`로 읽는다, 쓰기 · 손짓마다 판 번호가 오른다). 응답은 `new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })`, 204는 본문 없음. 처리 함수의 반환은 `api-sop.ts` 타입으로 묶는다(`satisfies Group` 등).
- `src/lib/practice/practice-state.ts`(순수): 자료 → 상태, 상태 → 응답 꼴(`DocumentView` · `UnitRow` · `Group` · `WrittenSentence`), 쓰기 연산(§6.3). React · fetch 없음 — 시험의 몸통.

### 6.2 상태

```ts
interface PracticeState {
  docRevision: Record<number, number>;
  views: Record<number, DocumentView>;   // units[] · pairs · tables를 여기서 고친다
  decisions: Record<number, Decision>;   // Unit id → 판단(자료 units[].decision에서)
  targets: Record<number, GroupTarget>;  // New 문장(자료 targets에서), source_unit_ids로 잇는다
  merged: Record<number, ViewUnit[]>;    // merge가 만든 Unit → 합치기 전 Unit들(unmerge가 옛 id 그대로 되살린다)
  remarks: RecentRemark[];
  nextId: number;                        // 새 Unit · 짝 id, 950001부터
  undo: Snapshot[]; redo: Snapshot[];    // D8
  log: PracticeLogEntry[];               // D9, append-only — 되돌려도 지우지 않는다
}
```

응답 짓기:
- `view`: `views[d]`, `units[].status`는 판단에서, `edits.can_undo/can_redo`는 스택에서.
- `units`: 보기의 Unit마다 `UnitRow` — `decision` · `status`(판단에서, 없으면 `unassigned`) · `target_ids` · `target_doc_ids`(`targets`의 `source_unit_ids`로 거꾸로) · `content_start`(보기의 `number.content_start`). 잡음 줄 · 칸 문장을 넣고 빼는 것은 자료의 처음 응답과 같게 한다(시험: 처음 상태에서 지은 `units`가 자료의 `units`와 같다).
- `groups/by-unit` · `by-target`: Unit ↔ 새 문장(출처) · 칸 문장 ↔ 표(`group_unit_id`) · 칸 새 문장 ↔ 표 새 문장(`parent_target_id`)을 따라간 연결 요소(백엔드 `groups.collect_component`와 같은 그래프 걷기 — 짝은 넣지 않는다).
- `written-sentences`: 자료의 목록에 `targets`의 `source_unit_ids` · `status` · `revision`을 덮어 쓴다(시험: 처음 상태에서 지은 목록 = 자료).

### 6.3 쓰기 — 받은 것을 그대로 반영한다

| 경로 | 반영 | 응답 |
|---|---|---|
| `groups/save` | `units[]`마다 판단을 `{disposition, reason, move_target_code, status: action === "confirm" ? "confirmed" : "on_hold", hold_reason}`로, revision +1. `targets[]`의 `id`가 있으면 그 새 문장의 `source_unit_ids` · `status`를 받은 값으로(새 `id` 없는 새 문장 만들기는 안 됨 — 숨긴 기능). `removed_target_ids`는 출처를 비운다(이미 쓴 문서의 문장은 지우지 않는다). `release_unit_ids`는 그 Unit의 짝을 푼다. | 저장한 Unit들의 연결 요소 `Group` + `pairs_dissolved` |
| `decisions/bulk` | `delete`: 판단 `{disposition: "delete", status: "confirmed", reason}`. `clear`: 판단을 처음 값(미배정)으로, 그 Unit을 출처에서 뺀다. | `[{unit_id, decision}]` |
| `decisions/clear` | `clear`와 같다 | `{reset_unit_ids, deleted_target_ids: [], held_unit_ids: [], held_target_ids: []}` |
| `edits` `split` | Unit의 글을 `at`에서 둘로(범위가 여럿이면 글 자리를 범위로 걸어 찾는다), 오른쪽 조각은 새 id · `number: null` · `is_edited: true`, 언어는 한글이 있으면 ko 아니면 en(설명서에 적힌 규칙 문장 그대로), 판단은 둘 다 미배정. 문서 revision +1. | `{document_revision, created_unit_ids: [왼, 오], retired_unit_ids: [원래]}` |
| `edits` `merge` | 받은 Unit들의 범위를 이어 하나로(새 id, `can_unmerge: true`, `merge_pieces` = 조각 글, 언어는 한글 규칙), 짝이면 짝을 지운다. 합치기 전 Unit을 `merged`에 둔다. | 같은 꼴 |
| `edits` `unmerge` | `merged`의 Unit들을 옛 id 그대로 되살린다 | 같은 꼴 |
| `edits` `set_language` | `lang`만 바꾼다 | `created/retired` 빈 목록 |
| `edits` `set_layout_table` | D7 — `tableVariants`의 `unwrapped` / `wrapped` 묶음으로 그 표의 `tables` 줄과 표 · 칸 Unit을 갈아 끼운다(이미 그 모습이면 그대로) | 같은 꼴(사라진 · 생긴 Unit id) |
| `edits` `set_noise_reason` · `clear_noise` | `noise_reason` 쓰기 · `noise_kind` · `noise_reason` 비우기 | 같은 꼴 |
| `pairs` POST | 새 `ViewPair{status: "confirmed", source: "human"}`, 구성원의 `pair_id` | `{document_revision, pair}` |
| `pairs/{p}` DELETE · `confirm` | 짝을 지우고 `pair_id`를 비움 · 상태만 `confirmed` | `{document_revision, pair}` |
| `decisions/undo` · `redo` | D8 — 사진을 꺼내 되쓰고 반대쪽 스택에 지금 상태를 넣는다. 스택이 비면 백엔드가 쓰는 "되돌릴 것 없음" 거절을 그대로(스텝 2가 `decision_steps.py`에서 코드를 확인). | `{op, unit_ids, focus_unit_id, focus_target_id, scope_label, can_undo, can_redo, restored_decisions: true}` |

모든 쓰기는 `log`에 `{route, editType?, undoOp?, action?, unitIds}`를 남기고 판 번호를 올린다. revision 검사 · 409 · 422 검증은 하지 않는다.

### 6.4 실제 서버로 새는 요청이 0임을 지키는 법

1. **구조**: `/bundles/-1` 아래는 주소와 상관없이 가짜(D2 ①). `/practice`에서는 목록 둘(`/me` · `/ai/jobs/recent`)만 실제(D2 ②). 판정은 `fetch` 앞 한 곳.
2. **소스 검사**: `src/source-rules.test.ts` "one path per concern"에 규칙 "raw fetch to the API"를 더한다 — `fetch(`는 `src/lib/api.ts`(공용 길)와 `src/lib/auth-mode.ts`(부팅 때 인증 방식 한 번)에만. 새 파일이 `/api`를 직접 부르면 실패하고, 메시지는 "apiFetch를 써라 — 연습 화면의 가짜 서버가 그 한 곳에서 끼어든다".
3. **단위 시험**(`src/lib/practice/practice-server.test.ts`): 전역 `fetch`를 스파이로 바꾸고, `api-sop.ts`의 실제 함수로 과제 순서(목록 → 보기 → 잇기 → 확정 → 보류 → 배정 취소 → 합치기 → 나누기 → ⇧P 두 번 → 표 벗기기 → 목차 사유 → 되돌리기)를 연습 Bundle id로 부른 뒤 `fetch`가 한 번도 불리지 않았는지. `api.test.ts`: 주소가 `/practice`일 때 `/me`는 `fetch`로, `/sop/remarks/recent`는 가짜로, 주소가 다른 곳일 때 `/bundles/-1/groups/save`는 가짜로.
4. **스모크**(`practice: nothing reaches the backend`): 띠가 보인 뒤부터 과제를 따라 하고 새로 읽는 동안 `page.on("request")`로 `/api/` 요청을 모아 `/api/me` · `/api/auth/mode` · `/api/ai/jobs/recent` 밖이 0인지.

## 7. 과제(U3)

`src/lib/practice/practice-tasks.ts`(순수): `PRACTICE_TASKS: { id, titleKey, bodyKey, anchor, keys: AssignKeyId[], isDone(log): boolean }[]`, `listAchieved(log)`(기록에서 이룬 과제 집합 — 기록이 append-only라 한 번 이룬 것은 남는다), `pickOpenTask(achieved, picked)`(D10). 판정은 "그 손짓이 한 번 성공했다"이고 어느 줄이든 된다. 과제 글이 자료의 알맞은 자리를 가리킨다.

| # | id | 과제(en · ko 메시지) | 글쇠(`ASSIGN_KEYS` id) | 판정(`log`) | 설명서 |
|---|---|---|---|---|---|
| 1 | `pick` | 줄을 눌러 고르고 J · K로 옮겨 본다 | `move_next` · `move_prev` | 손짓 `key: move_next|move_prev` | `#assign` |
| 2 | `link` | 짝 A를 고르고 오른쪽 New에서 A′를 골라 단추 줄의 잇기(또는 끌어 놓기) | – | `groups/save`, `undoOp: "link"`(D22) | `#assign-destination` |
| 3 | `confirm` | 짝 B를 고르면 추천 카드가 뜬다 — Enter로 그 카드대로 확정 | `confirm` | `groups/save`, `action: "confirm"`, `undoOp: "confirm"`(D22) | `#assign-confirm` |
| 4 | `hold` | 짝 C에서 ⇧H, 사유를 적어 보류 | `hold` | `groups/save`, `action: "hold"` | `#assign-confirm` |
| 5 | `unassign` | 이은 줄이나 확정한 줄을 고르고 U — 아직 없으면 2 · 3을 먼저 | `clear` | `decisions/clear` 또는 `decisions/bulk` `clear` | `#assign-confirm` |
| 6 | `merge` | 끊긴 두 조각의 앞 조각에서 ⇧J를 두 번 | `merge_next` | `edits` `merge` | `#split-edit` |
| 7 | `split` | 두 문장이 한 박스인 줄을 나눌 자리에서 두 번 눌러 선을 놓고 S | `split` | `edits` `split` | `#split-edit` |
| 8 | `pair` | 짝 D에서 ⇧P로 한 문장이 되는 것을 보고, 다시 ⇧P로 한/영 짝으로 | `shape_mode` | `pairs` POST | `#split-pair` |
| 9 | `unwrap` | 표를 고르고 ⇧T로 벗겨 줄로 본다(다시 ⇧T면 표로) | `table` | `edits` `set_layout_table` `is_layout: true` | `#assign-unwrap` |
| 10 | `toc` | 목차가 이미 삭제로 접힌 블록을 골라 R로 사유를 적는다(D21) | `remark` | `edits` `set_noise_reason` | `#assign-toc` |
| 11 | `undo` | Ctrl+Z로 방금 한 일을 되돌린다 | `undo` | `decisions/undo` 성공 | `#assign-undo` |
| 12 | `keyboard` | ?로 도움말을 열고 키보드 그림을 연다 | `help` | 손짓 `click: keyboard-map`(여는 단추의 testid는 스텝 4가 고정) | `#assign-keys` |

- 앵커는 지금 설명서의 자리 이름이다. 시험이 과제 앵커마다 `user-manual.md`에 `{#anchor}`가 있는지 본다(앵커를 바꾸면 여기서 걸린다).
- 시험이 과제 `keys`가 `ASSIGN_KEYS`에 있고 `formatAssignKey`의 글쇠가 U3와 같은지(J · K · Enter · ⇧H · U · ⇧J · S · ⇧P · ⇧T · R · Ctrl+Z · ?) 본다(D19).
- 설명서 뷰어가 `###` 자리 이름 해시(`#split-edit`)로 그 자리를 여는지 스텝 4가 확인한다 — `manual-view.tsx` `openTarget(id)`가 조각 id만 받으면 그 스텝에서 `###` id → 조각 + 스크롤로 넓힌다(작은 고침, 이펙트 수 그대로).

## 8. 운영 빌드에서 켜지는가

켜진다. `/practice`는 일반 라우트이고 어떤 스위치도 읽지 않는다. 숨긴 기능 길(`isDraftingOn()` — `NODE_ENV === "production"`이면 false, 개발만 `sopa.drafting`)과 **다르다**(D17). 시험: `practice-route.test.ts`가 `process.env.NODE_ENV = "production"`에서도 `isPracticeRequest`의 답이 같은지, 그리고 `src/lib/practice/`와 `app/practice/`가 `lib/drafting`을 가져오지 않는지 본다. `npm run build`의 라우트 목록에 `/practice`가 있는지는 스텝 3의 게이트에서 본다.

## 9. 같이 움직이는 것

- **effect 예산**: 새 `useEffect` · 타이머 없음. 과제 칸은 `useSyncExternalStore(subscribePractice, readPracticeSnapshot)`, 펼친 과제는 렌더 중에 셈하고(D10), 손짓은 React `onKeyDownCapture` · `onClickCapture`(D9), 새로 시작은 이벤트 처리기의 `reload()`. 새 파일은 `effect-baseline.json` 밖이라 ESLint가 이펙트를 막는다. `use-route-bundle-id.ts`는 공용 훅 자리지만 이펙트가 없다.
- **권한 · env**: 없음(D16).
- **i18n**(en · ko 한 쌍): `nav.practice`("Practice" / "연습하기"), `manual.practice`("Try it in the practice screen →" / "연습 화면에서 따라 해 보기 →"), `practice.band` · `practice.bandHint` · `practice.startOver`("Start over" / "처음부터") · `practice.tasks.*`(머리 "Tasks", 진행 `n/m`, 접기 · 펴기, "See in the manual →" / "설명서에서 보기 →", 다 했을 때 한 줄), `practice.task.<id>.title` · `.body` 12쌍, `practice.notHere`(D13), `rule.practice_unsupported`("Not available in practice" / "연습에서는 안 됩니다").
- **설명서**: `## 연습 화면 {#practice}`(D24) — 들어가는 길(사용자 메뉴 **Practice** · 설명서 머리의 **Try it in the practice screen →** — 두 곳뿐), 띠의 **Practice — nothing is saved**, **Start over**, 오른쪽 과제 칸(자동 ✓, 끝나면 다음이 펼쳐짐, 순서 자유, 접기), 연습에서 안 되는 것(AI · Excel · 다른 단계 — "Not available in practice"), 새로 읽으면 처음으로. 굵은 영어는 en 문구 그대로(`manual-content.test.ts`). `getManualHref("/practice")` → `/manual#practice`(`MANUAL_PAGE_SECTION`에 `practice`).
- **기능 맵**(`docs/qa/feature-map.md` 화면 표): `| 연습 화면 | /practice (사용자 메뉴 user-menu-practice · 설명서 머리 manual-practice, 두 곳뿐) | 실제 Assign + 브라우저 안 가짜 서버, 오른쪽 과제 칸 12(자동 ✓ — 쓰기는 가짜 서버 기록, 고르기 · 키보드 그림은 틀이 본 손짓), Start over = 새로 읽기 | 연습 Bundle id -1 · 문서 id 900001~, 실제로 가는 요청은 /api/me · auth/mode · ai/jobs/recent뿐, 자료는 백엔드가 뽑는다(dump_practice_fixture), 1440~1740px에서는 과제 칸을 접어야 용지가 넉넉 | practice: | #practice |`, "띄우기" 목록의 스모크 파일 목록에 `practice`.
- **구조 문서**: `docs/architecture/frontend.md` 새 절 "17. 연습 화면"(가짜 서버 자리 · 판정 · 자료 · 과제), `frontend/CLAUDE.md` 핵심 구조에 한 줄(→ 17, "Assign 쓰기 · 읽기를 더하면 가짜 서버의 경로 표(`practice-server.ts`)도 — 없으면 연습에서 Not available"). `backend/CLAUDE.md`에 "연습 자료" 한 줄(`dump_practice_fixture` · 신선도 시험).
- **사용 설명서 그림**: §11.

## 10. 스모크 `practice:`

새 파일 `frontend/scripts/smoke/practice.mjs`(`run()` 안에 단계들, `pw-smoke-sop.mjs`가 `runMap()` 뒤에 `runPractice()`). 단계 이름이 모두 `practice:`로 시작해 `ONLY="practice:"`로 걸린다. 서버에 쓰지 않으니 `dev-worktree.sh reset`이 필요 없다.

| 단계 | 보는 것 |
|---|---|
| `practice: entry and band` | 홈에서 사용자 메뉴를 열어 `user-menu-practice`를 눌러 `/practice`에 간다, 띠 글 "Practice — nothing is saved", 과제 칸 12줄 · `0/12` · 첫 과제가 펼쳐져 글쇠와 `practice-task-manual`(`/manual#assign`, 새 탭)이 보인다. `/practice`에서는 사용자 메뉴에 `user-menu-practice`가 없고 `top-bar-manual`의 주소가 `/manual#practice`. 설명서 머리 `manual-practice`가 `/practice`로 간다. Assign 화면의 도움말 창에는 연습 링크가 없다(U5). 과제 칸 접기 · 펴기 |
| `practice: follow tasks` | 순서를 섞어 다섯: 나누기(두 번 눌러 선 → S) → 고르기 · 옮기기(J) → 확정(짝 B → Enter) → 보류(⇧H, 사유) → 되돌리기(Ctrl+Z) — 과제마다 `practice-task-<id>` `data-done="true"`와 용지의 결과(박스 둘 · 확정 표시 · 보류 표시 · 되돌린 모습), 끝낼 때마다 다음 미완료가 펼쳐진다(`data-open`) |
| `practice: nothing reaches the backend` | 위 두 단계와 새로 읽기 동안 `/api/` 요청 중 `/api/me` · `/api/auth/mode` · `/api/ai/jobs/recent` 밖이 0 |
| `practice: reload starts over` | 과제 하나를 이룬 뒤 **Start over** → `0/12`, 그 Unit이 다시 처음 모습 |
| `practice: unsupported says so` | 안 되는 동작 하나(스텝 4가 고른다 — 예: Space 미리 보기의 내려받기)에 "Not available in practice"가 뜬다 |

## 11. 설명서 그림 장면

정식 업데이트 준비 때(그림은 그때만 — `rules/common/git.md`) `frontend/scripts/pw-manual-shots.mjs` `SCENES`에 한 줄을 더한다:

```js
{
  name: "practice", app: { height: 640 }, user: "qa.member", path: "/practice",
  prep: async (page) => { /* 짝 B를 눌러 추천 카드가 뜬 모습 · 과제 '확정'이 펼쳐진 모습 */ },
  marks: [id("practice-band"), id("practice-tasks"), `[data-testid="practice-task-confirm"][data-open]`, id("practice-task-manual")],
},
```

`MANUAL=app ONLY=practice node scripts/pw-manual-shots.mjs`로 `img/practice.png`를 뽑고, `## 연습 화면` 조각에 `![연습 화면](img/practice.png "띠 · 오른쪽 과제 칸 · 실제 Assign")` 한 줄을 같은 커밋에서 더한다(그림 줄 없이 장면만 더하거나 그 반대면 `manual-content.test.ts`가 잡는다). 장면은 서버에 쓰지 않으니 다른 장면의 자료를 흔들지 않는다.

## 12. 위험과 끊는 법

Assign 트리 229파일을 훑은 실측:

| 기대는 곳 | 어디 | 끊는 법 |
|---|---|---|
| 주소의 Bundle id | `use-assign-page.tsx` `useParams` 한 줄 | D12 `useRouteBundleId()` + `BundleIdContext` |
| 라우터 | 같은 파일 `router.replace` 둘(옛 `?edit=` · `?doc=&unit=` 주소를 읽을 때만) · `useSearchParams` | `/practice`에는 그 값이 없어 닿지 않는다. 그대로 둔다 |
| 다른 단계로 가는 링크 | `page.tsx` 빈 화면 Documents 링크 · `NewPaneEmpty` · `DestinationTree` To-Be 링크 · 나가기 확인 | D13 `navigate()`가 `/bundles/-1/…`를 막는다(나가기 확인으로 연습 밖으로 가는 것은 그대로) |
| 실제 Bundle 캐시 | `lib/bundle-store.ts` `useBundle(-1)` | 가짜가 답한다. id가 음수라 실제 캐시와 섞이지 않는다 |
| 권한 훅 | 없음(편집 여부는 `bundle.my_role` · `status`) | 자료의 값(D16) |
| 폴링 | `use-equis-polling`(참조 줄이 있을 때만 — 자료에 없음), `ai-jobs-store`(상단 바, 실제), `use-ai-jobs` → `/ai/status`(가짜, 꺼짐) | 자료에서 참조 줄을 빼고 AI를 끈다 |
| SSE | 없음 | – |
| 글쇠 | `window` keydown(버블, 전파를 막지 않음) | 틀의 캡처가 먼저 본다(D9). 포커스가 `body`에 있으면 틀이 못 보므로 과제 1 글은 "줄을 눌러 고른 뒤"로 시작한다 |
| 브라우저 저장 | `assign-view-prefs`(D18 같이 기억), `table-fold-prefs`(문서 id 키 — D3로 분리), `help-prefs` | 위 |
| 큐가 떠난 뒤 마저 보냄 | `use-command-queue.ts` | D2 ① |
| 결정 칸 띄우기 셈 | `side-float-model`(창 폭 기준) | D14 과제 칸 접기 |

큰 위험 둘:

1. **가짜와 실제가 어긋나 연습만 조용히 깨진다.** Assign이 읽는 응답 꼴(`UnitRow` · `Group` · `WrittenSentence` · `DocumentView`)이나 손짓이 보내는 요청(새 경로 · 새 편집 종류 · ⇧P의 순서)이 바뀌어도 운영 화면은 멀쩡하고 연습만 빈 화면 · "Not available" · 체크 안 됨이 된다. 끊는 법: 자료는 백엔드가 뽑고 신선도 시험(D4), 표 벗기기는 찍은 모습(D7), 처리 함수 반환을 `api-sop.ts` 타입으로 묶기(tsc), "처음 상태에서 지은 `units` · `written` = 자료의 실제 응답" 시험, 과제 순서 시나리오 시험(D22의 두 손짓 본문 고정 포함), 모르는 경로는 조용히 비우지 않고 "Not available in practice"로 보이게(D5), 스모크 `practice:`는 `FULL=1`(정식 업데이트 전)에 돈다, `frontend/CLAUDE.md` 한 줄. 남는 틈: 새 동작이 실제와 다른 꼴로 반영되는 것(예: 나눈 뒤 번호 칸) — 연습 범위에서는 받아들인다(D6).
2. **연습이 실제 서버에 닿는다.** 판정이 빠진 경로(Bundle 밖 · 새 공용 폴러), `fetch`를 직접 부르는 새 코드, 화면을 떠난 뒤의 큐. 끊는 법: D2(연습 Bundle은 늘 가짜 + `/practice`에서는 허용 목록 밖 모두 가짜), 소스 검사 "raw fetch"(§6.4-2), fetch 스파이 시험, 스모크의 요청 세기. 허용 목록 둘은 읽기 전용 · SOP 자료가 아님을 문서에 적는다.

작은 위험: 개발에서 숨긴 기능을 켠 채 연습하면 숨긴 쪽 쓰기가 "Not available"(D17, 시험 안 함). 주소창에 `/bundles/-1/assign`을 치면 띠 없는 연습(D13, 저장 안 됨). 백엔드 쪼개기 규칙이 바뀌면 자료의 과제 자리가 무너진다 — 신선도 시험의 자리 검사(§4.1)가 알린다. "빈 New"를 문장 있는 New로 읽은 것(D20)과 "목차 삭제"를 사유 쓰기로 읽은 것(D21)은 사용자 확인이 필요하다.
