# Pair view와 가까운 줄 짝(끌어다 놓기 4걸음) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ko_en_separate` Old 문서를 KO | EN 두 칸으로 펴는 Pair view에서 조각을 맞은편 언어 조각에 끌어 짝을 맺거나 제안 짝을 확정하고, `ko_en_interleaved` 문서에서는 Old 칸 안에서 같은 끌기로 짝을 맺으며, 둘 다 바로 저장되고 알림의 **Undo** 로 푼다.

**Architecture:** 서버는 바꾸지 않는다 — 지금 있는 짝 라우트 셋(`POST …/pairs`, `POST …/pairs/{id}/confirm`, `DELETE …/pairs/{id}`)만 부른다. 놓을 수 있는지와 거절 사유, 두 칸에 무엇이 서는지는 새 순수 모델 `lib/pair-drop-model.ts`가 정하고, Pair view는 Old 용지(`Paper`)를 다시 쓰지 않는 가벼운 두 칸(`components/assign/pair-column.tsx` + 선 `pair-lines.tsx`)으로 두 문서 틀(`.assign-panes`) 안에 Old·New 칸 대신 그린다. 끌기는 2~3걸음의 끌기 층(`useBoxDrag`)을 그대로 쓰고(Pair view는 설정을 하나 더 붙이고, 가까운 줄은 지금 `dragConfig`의 `onMove`·`onDrop`에 갈래 하나를 더한다), Undo는 공용 알림(`toast.tsx`)에 더하는 행동 단추가 맡는다.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · vitest(jsdom) · Playwright(시스템 Chrome) 스모크. 새 의존성 없음. backend·Alembic 변경 없음.

**Spec:** `docs/superpowers/specs/2026-11-16-drag-and-drop-design.md` — §2(목표 4, 비목표 "끌어서 합치기"·"1:2와 옮기기"·"Ctrl+Z에 기록", 반목표), §3(짝의 규칙), §4(G1~G13), §7 전부, §9, §10의 4걸음, §11, §12. 구현 전에 루트 `CLAUDE.md`, `frontend/CLAUDE.md`, `docs/lessons/react-ts-patterns.md`(§2 ref 미러 · §3 · §6 React Compiler · §7)·`browser-verification.md`·`ui-review.md`, 디자인 기초 `frontend/docs/design/2026-11-07-frontend-design-foundations.md` §2("제안은 연필로, 확정은 잉크로"), 그리고 형식의 본보기인 3걸음 계획 `docs/superpowers/plans/2026-11-17-assign-drag-send-plan.md`를 읽는다.

## Global Constraints

- 작업 폴더는 이 작업의 워크트리(`<worktree>`), 브랜치 `feat/pair-view`(3걸음이 합쳐진 `dev`에서 딴다 — `frontend/package.json`이 1.1.7인지 먼저 본다). 원본 체크아웃(`<original-checkout>`)은 읽기와 venv 실행만 한다. 워크트리에 venv 링크를 만들지 않는다. 공개 저장소다 — 추적 파일에 사용자 경로·실서버 IP·시크릿을 쓰지 않는다.
- **서버를 바꾸지 않는다.** `backend/` 아래 파일을 고치지 않는다(`git diff --stat dev -- backend/`가 비어 있어야 한다). 화면이 먼저 막되 서버 검사는 그대로 둔다(G7) — 서버가 거절하면 지금처럼 `humanizeApiError` 알림이다.
- **끌기로 하는 것은 둘뿐이다**(사용자 결정 "화면만, 1:1부터"): 짝 없는 조각 둘을 맺기(`POST …/pairs`에 Unit 둘), 제안 짝의 구성원끼리 놓아 그 제안을 확정하기(`POST …/pairs/{id}/confirm`). 이미 확정 짝인 조각은 끄는 쪽도 놓는 쪽도 아니다. 1:2·다른 짝으로 옮기기·끌어서 합치기(Join)를 만들지 않는다. AI 제안 여러 개를 한 번에 확정하는 길을 만들지 않는다.
- **바로 저장하고 Undo로 푼다.** 놓으면 저장된다(지금 짝 맺기와 같다). 알림의 **Undo** 는 그 짝을 푼다(`DELETE …/pairs/{id}`) — 제안을 확정한 것이었어도 풀기까지다. Assign의 Ctrl+Z(`runUndoStep`·`undoState`)에 손대지 않는다.
- **지금의 클릭·단축키 경로는 하나도 사라지거나 뜻이 달라지지 않는다**(G12): 틈의 **Join**, 우클릭 메뉴(`buildAssignMenu`), "Pair with another sentence…"(`pairFrom`·`pickPairUnit`·`finishPairPick`), `runPairChange`, `handleOldClick`, 2~3걸음의 잇기·보내기(`readDropAt`·`readSendAt`·`readTreeAt`·`dropLink`·`dropPlace`)의 동작을 바꾸지 않는다. `assign-context-menu-model.ts`는 고치지 않는다.
- 2~3걸음의 판단은 그대로다: 손잡이 없이 상자 전체를 끈다, 놓을 때 행동한다, 글자 긁기는 Alt를 누른 동안만, 조각의 커서는 손가락 그대로, `pointerdown`에서 `preventDefault`를 부르지 않는다(G2), 끌기가 꺼지는 때는 `canDragOld`(읽기 전용 · `mode === "unsourced"` · 짝 고르는 중 · 한 단의 New 문서 원문 보기) 그대로.
- 화면 규칙은 순수 모델(`pair-drop-model.ts`)에 두고 단위 시험한다. 포인터가 움직일 때마다 React 상태를 바꾸지 않는다(G11) — 놓을 자리 표시는 끌기 층이 다는 DOM 속성(`data-drop`)과 명령형 선(`drag-link-line.ts`)이다.
- **하위 칸이 있는 상위 칸에 관한 규칙을 만들지 않는다**(답이 없는 열린 질문, 이 걸음과 무관하다).
- 기존 시험(vitest·스모크)의 기대값을 고치지 않는다. 예외는 이 계획이 이름을 적어 허락한 한 곳(Task 5 Step 1의 놓는 점)뿐이다.
- 새 문구는 `frontend/src/lib/i18n-messages.ts`에 en·ko 한 쌍(`i18n-messages.test.ts`가 키 집합을 가드). 이미 있는 문구의 글은 고치지 않는다. 사용 설명서 글(`frontend/public/manual/user-manual.md`)은 화면을 바꾸는 커밋에서 함께 고치고, 화면 라벨은 영어 화면 글자 그대로 **굵게** 적는다(`manual-content.test.ts`). 그림은 뽑지 않는다. 색·그림자는 토큰만(raw hex 금지), 한쪽 막대 강조는 막대 쪽 모서리를 직각으로.
- `toast.tsx`·`old-pane.tsx`는 공용 부품이다 — 마지막 태스크에서 전체 스모크와 감사 셋(`pw-overlap-audit.mjs` · `DS=worst pw-layout-audit.mjs` · `pw-contrast-audit.mjs`)을 돌린다. `showToast(text)`·`showToast(text, tone)`으로 부르는 지금의 호출(86곳)은 한 글자도 고치지 않고 그대로 돈다.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. 커밋 전 `PROGRESS.md` 갱신. 푸시·태그·버전 올리기는 하지 않는다 — 버전(1.1.7 → 1.1.8)은 마지막 태스크에서만 올리고, 푸시는 조율하는 세션이 한다.
- 검증 스택(이 워크트리 전용 포트): backend 8787, frontend 3787. 내 것이 아닌 프로세스는 죽이지 않는다. Assign 스모크 단계는 `ONLY=`로 거르지 못한다(스크립트 한계) — 갓 시드한 DB의 전체 스모크로 판정한다.

```bash
# 워크트리 backend/ 에서 (backend는 띄우기만 한다 — 고치지 않는다)
PY=<original-checkout>/backend/.venv/bin/python
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev $PY -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev $PY -m scripts.seed_sop_demo   # 극단 자료는 이어서 seed_sop_worst
DATABASE_URL=sqlite+aiosqlite:///./dnd-smoke.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $PY -m uvicorn app.main:app --port 8787
# 워크트리 frontend/ 에서
BACKEND_URL=http://localhost:8787 npx next dev -p 3787
QUIET=1 BASE_URL=http://localhost:3787 BACKEND_PYTHON=$PY node scripts/pw-smoke-sop.mjs
npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run     # 커밋 전
```

## 이 계획이 정한 것(내 판단 — 설계에 없는 빈칸)

**Pair view의 모양**

1. **단추의 자리·라벨·아이콘**(§11): Old 칸 머리(`.pane-head`)의 확대 단추 바로 앞, 머리의 다른 켜기 단추(`.pane-toggle`)와 같은 모양에 글이 붙은 단추 — 아이콘 `Languages` + 라벨 **Pair view**(ko "짝 보기"), `aria-pressed`. 칸 머리가 좁으면 라벨을 접고 아이콘만 남긴다(툴팁이 이름을 말한다). Old 문서가 `ko_en_separate`이고 한 단의 New 문서 원문 보기·"New without source"가 아닐 때만 보인다 — 못 쓰는 문서에 꺼진 단추를 늘 두지 않는다.
2. **기억하지 않는다**: Pair view는 이 화면을 연 동안의 React 상태다(새로 고치면 꺼져 있다). 문서 하나에 묶인 임시 도구이고, New 칸 없이 화면이 열리면 배정 화면으로 읽히지 않는다. 한 단·양 단·확대·폭의 기억(`assign-view-prefs`)은 건드리지 않는다.
3. **오른쪽 칸이 대신하는 것**: 켜면 두 문서 틀 안의 Old 칸·New 칸·이음 선(`LinkLines`)을 그리지 않고 KO 칸 | 세로선 | EN 칸 | 짝 선을 그린다. 세로선(폭)·확대(왼쪽은 Old의 확대 값, 오른쪽은 New의 확대 값)는 그대로 쓴다. **Old 용지(`Paper`)를 두 번 그리지 않고 가벼운 조각 목록을 새로 그린다** — 용지의 도구(나눌 선·틈의 Join·필터 접기·부분 탭·연결 배지)는 한 언어만 남긴 칸에서 뜻이 달라지고(이웃이 아닌 문장 사이에 Join이 뜬다), 조각 수백 개를 두 벌로 그릴 까닭이 없다.
4. **켜 있는 동안의 고른 줄·옆 패널**: 그대로 산다. 조각을 누르면 지금 Old 조각 클릭과 같은 함수(`handleOldClick`)가 그 줄을 고르고(Shift는 여럿 고르기), 옆 패널(Shape · Where it goes · Decide)과 글쇠(J·K·↵·E·H·U)가 그 줄에 그대로 듣는다. 옆 패널 Shape 줄의 **Pair with another sentence…** 도 그대로 되고 그 띠는 KO 칸 위에 뜬다. 우클릭 메뉴·두 번 눌러 나누기·글자 긁어 새 Unit 만들기·Join은 Pair view에 없다(용지의 도구다 — 끄고 쓴다). 상태 필터는 두 칸을 접지 않는다(J·K가 도는 목록만 거른다).
5. **Pair view를 끄는 것**: 단추를 다시 누름, 보기 단추(One document · Two documents — 눌린 보기로 간다), 글쇠 V(보기를 바꾸지 않고 Pair view만 끈다 — 켜기 전 보기로 돌아간다), 세로선을 끝까지 끌어 접기, 그리고 New 칸이나 Old 용지의 자리를 보이라는 길(`showInNew`·`jumpToOld`·`openSolo`·"New without source")과 다른 문서의 줄을 고르는 것(J·K가 문서를 넘거나 목록에서 고름). 끄면 켜기 전의 보기(한 단·양 단, 폭, 확대)가 그대로이고 고른 줄은 그때 고른 줄이다 — 고른 줄이 있으면 Old 용지가 그 조각을 보이게 하고, 없으면 켜기 전의 Old 용지 스크롤 자리로 돌아간다.
6. **두 칸의 스크롤**(§11): 따로 스크롤한다(칸마다 지금의 `.pane-body`). 맞춰 굴리지 않는다 — 두 언어는 길이가 달라 줄을 맞추려면 빈 줄을 끼워야 한다. **짝의 두 끝을 한 화면에 들이는 길은 고르기다**: 조각을 누르거나 J·K로 줄을 고르면 그 줄의 조각이 칸마다 화면 안으로 들어온다(이미 보이면 움직이지 않는다 — `revealElement`). 끄는 동안에는 포인터가 든 칸이 가장자리에서 스스로 스크롤한다(끌기 층).
7. **짝을 그리는 법**: 두 끝이 모두 제 칸 화면 안에 보이는 짝만 KO 조각의 오른쪽 끝에서 EN 조각의 왼쪽 끝으로 선을 긋는다(Old→New 이음 선과 같은 규칙·같은 길 `buildLinkPath`). 확정 짝은 강조색 실선, 제안은 회색(`--ink-4`) 점선. 고른 줄의 짝은 진하게. 선과 별개로 조각마다 세로선 쪽 변에 같은 뜻의 막대를 둔다(확정 실선 · 제안 점선) — 맞은편이 스크롤 밖이어도 짝인지 보인다. 1:2 짝은 선이 둘이다.
8. **언어가 없는 Unit** — 아래 "§12 열린 것".
9. **머리말·꼬리말 Unit**도 원문 순서(`pos_seq`)대로 같은 칸에 선다. 부분 탭은 Pair view에 없다. 표에 묶인 칸 문장(`group_unit_id`가 있는 Unit)은 제 줄이 없어 목록에 서지 않는다(표가 흐리게 선다).
10. **한 단 보기**: 단추는 한 단에서도 보이고, 켜면 한 단이어도 두 칸으로 편다(`view.single`은 바꾸지 않는다). 끄면 한 단으로 돌아간다.
11. **읽기 전용**: Pair view는 켤 수 있다(읽는 일이다). 끌기는 시작되지 않는다(G13 — 조각에 `data-drag-box`를 달지 않는다).

**끌기와 놓기**

12. **끄는 것**: Pair view에서는 조각 하나(Unit 하나). 제안 짝의 구성원도 따로 끌린다 — 그래야 제 짝에 놓아 확정한다. 흐린 줄(언어 없는 Unit)은 끌리지 않는다. 확정 짝의 조각은 끌리지만 어디에 올려도 거절과 이유다(끌리지 않으면 왜 안 되는지 알 길이 없다).
13. **표 한 장**: ID·글 한 줄은 2걸음과 같다(`buildOldDragCard`). 놓을 수 있는 조각 위에서 메모는 맺기면 "Pair with OLD-3-011"(맞은편의 번호), 확정이면 "Confirm this suggested pair". 못 놓는 조각 위에서는 이유. 끄는 동안 출발 조각에서 포인터까지 초안 이음 선(점선)이 따라온다(2걸음 것).
14. **제안이 다른 짝을 가리킬 때**: 끄는 조각이나 놓는 조각이 제안 짝에 들어 있는데 서로가 그 짝이 아니면 거절한다 — 문구는 메뉴가 지금 그런 문장에 쓰는 "One of them is already in a pair. Separate it first."(`split.menu.why.alreadyPaired`). 서버는 이때 제안을 지우고 새 짝을 맺어 주지만(`create_pair`), 그러면 놓기 한 번이 AI 제안을 "버림"으로 기록하며 지우고 Undo로도 제안이 돌아오지 않는다. 끌기로 하는 것은 둘뿐이라는 결정과도 맞지 않는다.
15. **제안 확정은 그 제안 그대로다**: 제안이 1:2면 구성원 하나를 맞은편 언어의 구성원에 놓아도 셋이 함께 확정된다(서버 `confirm_pair`가 짝 전체를 확정한다). 끌기로 1:2를 새로 만드는 길은 없다.
16. **거절 사유와 순서** — 첫 번째로 걸리는 것 하나만 보인다(더 근본적인 까닭이 앞): 언어가 없다(REF 줄 · 그 밖) → 같은 언어 → 확정 짝에 들었다 → 다른 짝을 가리키는 제안 → 배정이 결정됐다(끄는 쪽 · 놓는 쪽) → 저장하지 않은 고름이 있다(끄는 쪽 · 놓는 쪽). 문구는 Task 2의 표.
17. **이유를 보이지 않는 곳**(놓을 자리 밖 — 표에 메모 없음): 자기 자신(가까운 줄에서는 자기 줄의 조각 — 짝 카드는 한 장이다), 표·그림·행 조각, 표에 묶인 칸 문장. 끄는 줄이 표·그림이면 Old 조각 어디에서도 조용하다(잇기·보내기 끌기를 방해하지 않는다).
18. **가까운 줄은 `ko_en_interleaved` 문서에서만 켠다**(§7 그대로). 그 밖의 배치(`ko_en_separate`의 평소 보기, `en_only`·`ko_only`)에서 Old 조각을 Old 조각에 놓는 것은 지금처럼 아무 일도 없다 — 한 언어 문서에서 New 칸으로 끌어 가는 내내 "같은 언어" 거절이 표에 번쩍이는 것을 막는다.
19. **가까운 줄에서 끄는 것은 줄이다**(2걸음과 같다 — 짝 카드는 한 장). 그래서 평소 Old 칸에서는 제안 짝 카드를 "제 짝에 놓아 확정"할 수 없고(카드가 곧 자기 자신이다), 제안은 지금처럼 그 줄을 확정할 때 함께 확정된다. 제안·확정 짝 카드를 다른 Old 조각에 놓는 것은 거절과 이유다(§7).
20. **놓은 뒤**: 저장이 끝나면 지금 짝 맺기와 같이 다시 받아 그 짝의 줄을 고른다. 한 번에 한 저장이다(`busy` 동안 놓은 것은 버린다).

**Undo와 알림**

21. **알림의 행동 단추**(공용 — Documents 화면의 "WI → SOP" 되돌리기가 다시 쓴다): `showToast(text, tone, { action: { label, run } })`. 알림 하나에 행동 하나. 행동이 있는 알림은 **10초** 머문다(평소 3초로는 누를 수 없다. 실패 알림의 7초보다도 길게). 포인터를 올리거나 포커스가 안에 있는 동안에는 사라지지 않고, 떠나면 3초 뒤에 사라진다. 누르면 알림이 닫히고 행동이 한 번 돈다. 단추는 진짜 `<button>`이라 Tab으로 닿고 Enter·Space로 눌린다. 포커스를 알림으로 옮기지 않는다(하던 일의 포커스를 훔치지 않는다).
22. **알림 글에 번호를 적는다**: "Paired OLD-3-004 + OLD-3-011". 알림은 같은 글이면 앞의 것을 지우므로(`pushToast`), 번호가 없으면 잇달아 맺을 때 앞 짝의 Undo가 사라진다.
23. **그사이 짝이 바뀌었을 때의 Undo**: 누르면 그 문서를 다시 읽는다(`getDocumentView`). 그 짝이 같은 Unit들로 확정된 채 남아 있고 구성 Unit에 판단이 없을 때만 푼다(문서의 지금 revision으로). 아니면(이미 풀렸다 · 구성원이 달라졌다 · 그사이 배정했다) 아무것도 쓰지 않고 "The pair changed after that. Nothing was undone."을 알린다 — 배정된 문장의 짝을 풀 수 없다는 지금 메뉴의 규칙을 Undo가 돌아가지 않게 한다.
24. **다른 화면으로 간 뒤의 Undo**: 알림은 화면을 넘어 남는다. 10초 안에 누르면 같은 길로 푼다(짝의 문서와 id만 있으면 된다).

## 설계와 코드가 어긋난 곳 — 이렇게 정했다

- **프런트에 제안 확정 호출이 없다.** §7은 "지금 Pair with another sentence…가 부르는 길과 같다(…제안 확정은 `POST …/pairs/{pair_id}/confirm`)"고 적었지만, 그 라우트는 서버에만 있고(`routers/sop_documents.py` `confirm_unit_pair`, 시험 `test_sop_pairs.py::test_create_confirm_delete_pair`) 화면은 한 번도 부르지 않는다 — 제안은 줄을 확정할 때 서버가 함께 확정한다(`pair_settle`). `lib/api-sop.ts`에 `confirmPair`를 더한다(Task 2). 서버 변경은 아니다.
- **화면은 지금 제안 짝과 확정 짝을 같게 그린다.** `ClassifyRow.pairStatus`는 만들어지기만 하고 읽는 곳이 없고, Old 용지의 짝 카드(`data-bracket`)는 상태를 가리지 않는다. §7의 "제안(점선)"은 이 걸음의 Pair view에서 처음 생긴다. Old 용지의 카드 모양은 바꾸지 않는다(범위 밖 — 가까운 줄은 판단 19로 제안 확정을 다루지 않는다).
- **`pair_fates_differ`는 표에 뜰 수 없다.** 화면 규칙 "배정이 결정된 Unit은 못 맺는다"가 먼저 걸린다(운명이 갈리려면 두 Unit 모두 판단이 있어야 한다). 표의 이유는 "배정" 문구이고, `pair_fates_differ`는 그사이 다른 사람이 배정해 서버가 거절했을 때의 알림(`rule.pair_fates_differ`)으로만 보인다. 화면에서 운명을 따로 계산하지 않는다.
- **화면에만 있는 규칙은 둘이 아니라 넷이다.** 지금 짝 메뉴는 배정·REF 줄 말고도 저장하지 않은 고름(`hasDraft`)과 글이 아닌 Unit을 막는다(`getPairPickBlocker`·`getEditBlocker`). 끌기가 메뉴가 막는 것을 하지 않도록 넷을 모두 쓴다.
- **알림에 번호를 적는 것**(판단 22)과 **표·그림 위에서 조용한 것**(판단 17)은 G7("못 놓는 자리에는 이유")을 좁게 읽은 것이다 — 표·그림은 "맞은편 언어의 조각"이 아니라 놓을 자리가 아니다.

**고치지 말고 알려 둘 것**: "배정이 결정된 Unit"은 지금 메뉴와 같은 함수(`isUnitDecided`)라 AI 분류 제안만 붙은 문장(`ai_suggested`)도 포함한다. 배정 화면 첫 진입의 미리 분류가 켜진 묶음에서는 거의 모든 줄에 제안이 붙어, 끌어서 짝 맺기가 지금의 짝 메뉴처럼 대부분 "먼저 배정을 지우세요"로 거절된다(v1.1.3이 AI 나누기에서 푼 것과 같은 모양의 문제다). 이 걸음은 메뉴의 규칙을 그대로 따르고 규칙을 바꾸지 않는다 — 조율하는 세션이 사용자에게 알린다.

## §12 열린 것 — 언어가 없는 Unit이 서는 곳 (실제 문서로 확인 필요)

**정한 것**: 언어가 `ko`·`en`이 아닌 Unit(REF 줄 `ref`, 표·그림·행 `neutral`)은 **원문 순서로 바로 앞에 있는 `ko`·`en` Unit의 칸**에 선다. 앞에 없으면(문서 맨 앞) 바로 뒤 Unit의 칸, 문서에 `ko`·`en` Unit이 하나도 없으면 KO 칸. 흐리게 그리고 끌리지 않으며, 놓는 곳으로는 REF 줄만 이유를 보인다(판단 16·17).

**근거와 한계**: 합성 시드의 `ko_en_separate` 문서는 OLD-3 하나이고(`scripts/synthetic_sop.py` `_build_old_3` — 한글 제목·문장 전부 뒤에 영어 전부, 머리말 영어·꼬리말 한글) **언어가 없는 Unit이 하나도 없다**. REF 줄·그림·표는 연달아 배치 문서(OLD-1·OLD-4)에만 있다. 그래서 이 규칙은 시드로 확인하지 못하고 단위 시험(Task 2)과 응답을 바꿔 그린 스모크(Task 3), 극단 자료의 배치를 바꿔 본 측정(Task 6)으로만 박는다. REF 줄의 "원래 언어"는 서버에만 있고(`unit_ref_marks.prev_lang`) 보기 응답에 없어 화면이 알 수 없다 — 그래서 "제 언어"를 흐름의 자리로 읽었다. 실제 `ko_en_separate` 문서에서 그림·표가 두 언어 사이(예: 한글 본문 끝과 영어 본문 처음 사이의 공용 부록)에 있을 때 KO 칸 끝에 서는 것이 맞는지 사용자가 확인한다. 설계 §12의 그 줄은 Task 6에서 "합성 자료로 정했다 — 실제 문서로 확인 필요"로 고친다.

## Review Focus

1. 맺은 뒤 그사이 짝이 풀리거나 그 문장을 배정한 다음 **Undo** 를 누른다 — 아무것도 쓰지 않고 이유를 알린다. 풀린 짝을 다시 풀려다 오류 알림이 뜨거나, 배정된 문장의 짝이 풀리면 안 된다.
2. 잇달아 두 번 맺는다 — 알림 둘이 저마다 제 **Undo** 를 지닌다(앞의 것이 뒤의 것에 지워지지 않는다).
3. 놓는 순간 문서 revision이 낡았다(다른 창·다른 사람이 그 문서를 고쳤다) — 서버가 409로 거절하고 화면은 그 문구를 알린 뒤 다시 읽는다. 짝은 생기지 않고, 다시 놓으면 된다.
4. `ko_en_separate`로 표시했지만 한 언어 문장이 없는 문서 — 빈 칸은 빈 상태를 보이고, 화면이 죽거나 끌기가 엉뚱한 곳에 놓이지 않는다.
5. Pair view를 켠 채 다른 문서의 줄을 고른다(J·K가 문서 끝을 넘는다) — 다른 문서를 두 칸으로 잘못 펴지 않고 Pair view가 꺼진다. 그리고 맺은 뒤 다른 화면으로 가서 **Undo** 를 눌러도 풀리거나 이유를 말한다(예외가 나지 않는다).

---

### Task 1: 알림의 행동 단추(공용 부품)

**Files:**
- Modify: `frontend/src/components/ui/toast.tsx` · Test: `frontend/src/components/ui/toast.test.ts`
- Modify: `frontend/src/styles/motion.css`(알림 규칙 옆), `frontend/src/lib/i18n-messages.ts`(`common.undo`)

**Interfaces:**
- Consumes: 지금의 `toast.tsx`(`pushToast`·`dismissToast`·`showToast`·`ToastHost`, `TOAST_MS`·`LEAVE_MS`).
- Produces:

```ts
export interface ToastAction { label: string; run: () => void }
/** action - 알림 하나에 행동 하나. durationMs - 머무는 시간을 직접 정한다(없으면 getToastMs) */
export interface ToastOptions { action?: ToastAction; durationMs?: number }
export interface Toast { id: string; tone: ToastTone; text: string; leaving: boolean; action?: ToastAction }
export const ACTION_TOAST_MS = 10000;      // 행동이 있는 알림이 머무는 시간
export const TOAST_RELEASE_MS = 3000;      // 포인터·포커스가 떠난 뒤 사라지기까지
export function getToastMs(tone: ToastTone, options?: ToastOptions): number;
export function showToast(text: string, tone?: ToastTone, options?: ToastOptions): void;   // 앞 두 인자의 뜻은 그대로
export function listToasts(): readonly Toast[];     // 지금 쌓인 알림(위가 먼저) - 시험이 읽는다
export function runToastAction(id: string): void;   // 닫고 행동을 한 번 돈다. 없거나 빠지는 중이면 아무 일도 없다
export function holdToast(id: string): void;        // 사라지는 타이머를 멈춘다
export function releaseToast(id: string): void;     // TOAST_RELEASE_MS 뒤에 사라지게 다시 건다
```

  - DOM: 행동이 있는 알림만 글과 닫기 단추 사이에 `<button type="button" className="btn ghost h-6 toast-action" data-testid={`toast-action-${toast.id}`}>` (글은 `action.label`). 그 알림의 `.toast`에만 `onPointerEnter`·`onFocus` → `holdToast`, `onPointerLeave`·`onBlur` → `releaseToast`. **행동이 없는 알림의 DOM과 시간은 지금과 한 글자도 다르지 않다.**
  - 문구(en / ko): `common.undo`: "Undo" / "되돌리기".

- [ ] **Step 1: 실패하는 시험을 쓴다** — `toast.test.ts`에 덧붙인다(기존 `describe("pushToast")`는 건드리지 않는다).

```ts
describe("toast actions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const toast of listToasts()) dismissToast(toast.id);
    vi.runAllTimers();
  });
  afterEach(() => vi.useRealTimers());
  const top = () => listToasts()[0];
  const action = { label: "Undo", run: () => undefined };

  it("keeps a plain toast as it was - three seconds, no action", () => {
    showToast("Saved");
    expect(listToasts()).toMatchObject([{ text: "Saved", tone: "ok", leaving: false }]);
    expect(top().action).toBeUndefined();
    vi.advanceTimersByTime(2999);
    expect(top().leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(top().leaving).toBe(true);
    vi.advanceTimersByTime(480);
    expect(listToasts()).toEqual([]);
  });

  it("gives an action toast ten seconds whatever its tone, and a set duration wins", () => {
    expect([getToastMs("ok"), getToastMs("error"), getToastMs("info")]).toEqual([3000, 7000, 6000]);
    expect([getToastMs("ok", { action }), getToastMs("error", { action }), getToastMs("ok", { action, durationMs: 1500 })]).toEqual([10000, 10000, 1500]);
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action });
    vi.advanceTimersByTime(9999);
    expect(top().leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(top().leaving).toBe(true);
  });

  it("runs the action once and closes the toast", () => {
    const run = vi.fn();
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action: { label: "Undo", run } });
    const { id } = top();
    runToastAction(id);
    runToastAction(id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(top().leaving).toBe(true);
    vi.advanceTimersByTime(480);
    expect(listToasts()).toEqual([]);
  });

  it("stays while held and leaves three seconds after release", () => {
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action });
    const { id } = top();
    holdToast(id);
    vi.advanceTimersByTime(60000);
    expect(top().leaving).toBe(false);
    releaseToast(id);
    vi.advanceTimersByTime(2999);
    expect(top().leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(top().leaving).toBe(true);
  });

  it("stacks action toasts with different texts, and a replaced one can no longer run", () => {
    const first = vi.fn();
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action: { label: "Undo", run: first } });
    const firstId = top().id;
    showToast("Paired OLD-3-005 + OLD-3-012", "ok", { action });
    expect(listToasts().map((toast) => toast.text)).toEqual(["Paired OLD-3-005 + OLD-3-012", "Paired OLD-3-004 + OLD-3-011"]);
    showToast("Paired OLD-3-004 + OLD-3-011", "ok", { action });   // 같은 글 - 앞의 것을 지운다(지금 규칙)
    expect(listToasts()).toHaveLength(2);
    runToastAction(firstId);
    expect(first).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패를 본다** — `cd frontend && npx vitest run src/components/ui/toast.test.ts` → 새 시험 FAIL(없는 함수), 기존 셋 PASS.
- [ ] **Step 3: `toast.tsx`.** `getToastMs` = `options?.durationMs ?? (options?.action ? Math.max(TOAST_MS[tone], ACTION_TOAST_MS) : TOAST_MS[tone])`. 사라지는 타이머를 알림 id로 들고 있어(`Map<string, number>`) `holdToast`가 지우고 `releaseToast`가 다시 건다(빠지는 중이거나 없는 알림에는 걸지 않는다). `runToastAction`은 먼저 `dismissToast`를 부른 뒤 행동을 돈다 — 행동이 던져도 알림이 남지 않고, 두 번째 누름은 이미 빠지는 중이라 돌지 않는다. `ToastHost`는 Interfaces의 DOM대로.
- [ ] **Step 4: CSS**(`motion.css`, 토큰만). `.toast-action`: 글은 강조색(`--accent`), 굵기 600, 줄바꿈 없음(`white-space: nowrap`), 알림 글이 길어 두 줄이 되어도 단추와 닫기 단추는 줄어들지 않는다(`flex: none`). 폭 380의 알림에서 번호 둘이 든 글 + 단추 + 닫기가 서로 덮지 않는지는 Task 4·6에서 잰다.
- [ ] **Step 5: 문구** `common.undo`(en·ko).
- [ ] **Step 6: 초록을 본다** — `npx vitest run src/components/ui/toast.test.ts src/lib/i18n-messages.test.ts` → PASS. `npm run lint && npx tsc --noEmit -p tsconfig.json` 초록. 갓 시드한 DB에서 전체 스모크를 한 번 돌려 **이 커밋 전의 실패 기준선**을 적어 두고(다음 태스크들이 견준다) 이 변경으로 실패가 늘지 않았는지 본다(행동 없는 알림은 그대로여야 한다).
- [ ] **Step 7: 커밋** — `feat(ui): let a toast carry one action — 알림에 행동 단추 하나(되돌리기용)` (`PROGRESS.md` 포함)

---

### Task 2: 순수 모델 — 짝 놓기와 두 칸

**Files:**
- Create: `frontend/src/lib/pair-drop-model.ts` · Test: `frontend/src/lib/pair-drop-model.test.ts`
- Modify: `frontend/src/lib/api-sop.ts`(`confirmPair` — `deletePair` 바로 위)

**Interfaces:**
- Consumes: `ViewUnit`·`ViewPair`·`PairResult`·`buildDocPath`·`apiFetch`(`api-sop`), `MESSAGES`(`i18n-messages` — 시험만).
- Produces:

```ts
// api-sop.ts
/** 제안 짝(코드·AI)을 그대로 확정한다 - 이미 확정이면 서버는 아무것도 쓰지 않는다 */
export function confirmPair(bundleId: number, docId: number, pairId: number, revision: number): Promise<PairResult>;
// POST `${buildDocPath(bundleId, docId)}/pairs/${pairId}/confirm`, 본문 { revision }

// pair-drop-model.ts
export type PairLang = "ko" | "en";
export type PairUnit = Pick<ViewUnit, "id" | "display_id" | "kind" | "lang" | "text" | "group_unit_id" | "pos_seq" | "spans" | "status" | "ref">;
export type PairPiece = Pick<PairUnit, "id" | "kind" | "lang" | "group_unit_id">;
export type PairInfo = Pick<ViewPair, "id" | "status" | "unit_ids">;

export interface PairDropContext {
  /** 그 Unit이 든 짝(제안·확정) - 없으면 undefined */
  pairOf: (unitId: number) => PairInfo | undefined;
  /** 지금 짝 메뉴가 쓰는 것과 같은 함수 - page.tsx의 isUnitDecided·hasUnitDraft */
  isDecided: (unit: PairPiece) => boolean;
  hasDraft: (unit: PairPiece) => boolean;
}
export type PairRefusal = "ref_line" | "no_language" | "same_lang" | "paired" | "suggested_pair" | "assigned" | "other_assigned" | "unsaved" | "other_unsaved";
export const PAIR_REFUSAL_KEYS: Record<PairRefusal, string>;
export type PairDrop =
  | { kind: "pair"; unitIds: [number, number] }      // [끄는 Unit, 놓는 Unit] - POST …/pairs
  | { kind: "confirm"; pairId: number }              // POST …/pairs/{id}/confirm
  | { kind: "refused"; reason: PairRefusal }
  | { kind: "none" };
/** sources는 끄는 것의 Unit(Pair view는 하나, 가까운 줄은 그 줄 전부), target은 포인터 밑 조각의 Unit */
export function resolvePairDrop(sources: readonly PairPiece[], target: PairPiece | undefined, ctx: PairDropContext): PairDrop;

export interface PairColumnItem {
  unit: PairUnit;
  /** 끌고 놓을 수 있는 조각(언어가 ko·en인 글 Unit) - 아니면 흐리게 남는 줄 */
  isPiece: boolean;
  /** 든 짝과 그 짝의 다른 Unit(원문 순) - 없으면 null */
  pair: { id: number; status: ViewPair["status"]; mateIds: number[] } | null;
}
export interface PairColumns { ko: PairColumnItem[]; en: PairColumnItem[] }
export function buildPairColumns(view: { units: readonly PairUnit[]; pairs: readonly PairInfo[] }): PairColumns;
export interface PairLink { pairId: number; koId: number; enId: number; status: ViewPair["status"] }
/** 짝마다 KO 구성원 × EN 구성원 - koId, enId 순 */
export function listPairLinks(columns: PairColumns): PairLink[];
/** 알림의 Undo가 그 짝을 풀어도 되나 - 같은 Unit들로 확정된 채 남아 있고 구성 Unit에 판단이 없을 때만 */
export function canUndoPair(view: { units: readonly Pick<PairUnit, "id" | "status">[]; pairs: readonly PairInfo[] }, pairId: number, unitIds: readonly number[]): boolean;
```

  - `PAIR_REFUSAL_KEYS` — 모두 **이미 있는 문구**다(새 문구 없음):

    | 사유 | 키 | en 글 |
    |---|---|---|
    | `ref_line` | `assign.ctx.why.refLang` | A reference line has no language. Choose Not a reference first. |
    | `no_language` | `split.menu.why.noLanguage` | Both sentences need a KO or EN language first. |
    | `same_lang` | `assign.pairPickSameLang` | A pair needs one Korean and one English sentence. Pick one in the other language. |
    | `paired` | `rule.unit_already_paired` | One of these sentences is already in a confirmed pair. |
    | `suggested_pair` | `split.menu.why.alreadyPaired` | One of them is already in a pair. Separate it first. |
    | `assigned` | `assign.ctx.why.assigned` | This sentence is assigned. Clear the assignment first. |
    | `other_assigned` | `assign.ctx.why.neighborAssigned` | The sentence on that side is assigned. Clear its assignment first. |
    | `unsaved` | `assign.ctx.why.unsaved` | This row has an unsaved choice. Confirm or cancel it first. |
    | `other_unsaved` | `assign.ctx.why.neighborUnsaved` | The sentence on that side has an unsaved choice. |

- [ ] **Step 1: 실패하는 시험을 쓴다** — `pair-drop-model.test.ts`.

```ts
const piece = (id: number, lang: PairPiece["lang"], kind: PairPiece["kind"] = "sentence", group_unit_id: number | null = null): PairPiece => ({ id, kind, lang, group_unit_id });
const KO1 = piece(1, "ko"), KO2 = piece(2, "ko"), EN1 = piece(11, "en"), EN2 = piece(12, "en"), EN3 = piece(13, "en");
const REF = piece(20, "ref"), BARE = piece(21, "neutral"), TABLE = piece(30, "neutral", "table"), CELL = piece(31, "en", "cell_sentence", 30);
const SUGGESTED: PairInfo = { id: 7, status: "suggested", unit_ids: [2, 12] };
const CONFIRMED: PairInfo = { id: 8, status: "confirmed", unit_ids: [2, 12] };
const WIDE: PairInfo = { id: 9, status: "suggested", unit_ids: [2, 12, 13] };   // 1:2 제안
const ctx = (pair?: PairInfo, over: Partial<PairDropContext> = {}): PairDropContext => ({
  pairOf: (id) => (pair?.unit_ids.includes(id) ? pair : undefined), isDecided: () => false, hasDraft: () => false, ...over,
});
const refused = (reason: PairRefusal) => ({ kind: "refused", reason });

describe("resolvePairDrop", () => {
  it("pairs two free pieces of opposite languages, in either direction", () => {
    expect(resolvePairDrop([KO1], EN1, ctx())).toEqual({ kind: "pair", unitIds: [1, 11] });
    expect(resolvePairDrop([EN1], KO1, ctx())).toEqual({ kind: "pair", unitIds: [11, 1] });
  });
  it("confirms a suggestion when one member is dropped on a member in the other language", () => {
    expect(resolvePairDrop([KO2], EN2, ctx(SUGGESTED))).toEqual({ kind: "confirm", pairId: 7 });
    expect(resolvePairDrop([EN2], KO2, ctx(SUGGESTED))).toEqual({ kind: "confirm", pairId: 7 });
    expect(resolvePairDrop([KO2], EN3, ctx(WIDE))).toEqual({ kind: "confirm", pairId: 9 });
    expect(resolvePairDrop([EN2], EN3, ctx(WIDE))).toEqual(refused("same_lang"));
  });
  it("is nowhere over itself, a table, a figure, a bound cell sentence or nothing", () => {
    expect(resolvePairDrop([KO1], KO1, ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([KO1], TABLE, ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([KO1], piece(40, "neutral", "figure"), ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([KO1], CELL, ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([KO1], undefined, ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([TABLE], EN1, ctx())).toEqual({ kind: "none" });       // 표 줄을 끌면 Old 조각 어디서도 조용하다
  });
  it("refuses a pair row dragged in the Old pane, and is nowhere over its own pieces", () => {
    expect(resolvePairDrop([KO2, EN2], EN1, ctx(CONFIRMED))).toEqual(refused("paired"));
    expect(resolvePairDrop([KO2, EN2], EN1, ctx(SUGGESTED))).toEqual(refused("suggested_pair"));
    expect(resolvePairDrop([KO2, EN2], EN2, ctx(SUGGESTED))).toEqual({ kind: "none" });
  });
  it("refuses a piece with no language - a reference line with its own reason", () => {
    expect(resolvePairDrop([KO1], REF, ctx())).toEqual(refused("ref_line"));
    expect(resolvePairDrop([REF], EN1, ctx())).toEqual(refused("ref_line"));
    expect(resolvePairDrop([KO1], BARE, ctx())).toEqual(refused("no_language"));
  });
  it("refuses the same language before anything else about pairs or assignments", () => {
    expect(resolvePairDrop([KO1], KO2, ctx())).toEqual(refused("same_lang"));
    expect(resolvePairDrop([KO1], KO2, ctx(CONFIRMED, { isDecided: () => true }))).toEqual(refused("same_lang"));
  });
  it("refuses a confirmed pair on either end, even its own partner", () => {
    expect(resolvePairDrop([KO1], EN2, ctx(CONFIRMED))).toEqual(refused("paired"));
    expect(resolvePairDrop([KO2], EN1, ctx(CONFIRMED))).toEqual(refused("paired"));
    expect(resolvePairDrop([KO2], EN2, ctx(CONFIRMED))).toEqual(refused("paired"));
  });
  it("refuses a suggestion that points at another partner, on either end", () => {
    expect(resolvePairDrop([KO1], EN2, ctx(SUGGESTED))).toEqual(refused("suggested_pair"));
    expect(resolvePairDrop([KO2], EN1, ctx(SUGGESTED))).toEqual(refused("suggested_pair"));
  });
  it("refuses a decided unit, then an unsaved pick - the dragged end first", () => {
    const decided = (...ids: number[]) => ({ isDecided: (unit: PairPiece) => ids.includes(unit.id) });
    const drafted = (...ids: number[]) => ({ hasDraft: (unit: PairPiece) => ids.includes(unit.id) });
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, decided(1, 11)))).toEqual(refused("assigned"));
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, decided(11)))).toEqual(refused("other_assigned"));
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, { ...decided(11), ...drafted(1) }))).toEqual(refused("other_assigned"));
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, drafted(1, 11)))).toEqual(refused("unsaved"));
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, drafted(11)))).toEqual(refused("other_unsaved"));
    expect(resolvePairDrop([KO2], EN2, ctx(SUGGESTED, decided(12)))).toEqual(refused("other_assigned"));   // 제안 확정도 같은 규칙
    expect(resolvePairDrop([KO1], EN2, ctx(CONFIRMED, decided(1)))).toEqual(refused("paired"));             // 짝이 배정보다 앞
  });
  it("names an existing message for every reason, in both languages", () => {
    expect(PAIR_REFUSAL_KEYS).toEqual({
      ref_line: "assign.ctx.why.refLang", no_language: "split.menu.why.noLanguage", same_lang: "assign.pairPickSameLang",
      paired: "rule.unit_already_paired", suggested_pair: "split.menu.why.alreadyPaired",
      assigned: "assign.ctx.why.assigned", other_assigned: "assign.ctx.why.neighborAssigned",
      unsaved: "assign.ctx.why.unsaved", other_unsaved: "assign.ctx.why.neighborUnsaved",
    });
    for (const key of Object.values(PAIR_REFUSAL_KEYS)) expect([typeof MESSAGES.en[key], typeof MESSAGES.ko[key]]).toEqual(["string", "string"]);
  });
});

const makeUnit = (id: number, lang: PairUnit["lang"], over: Partial<PairUnit> = {}): PairUnit => ({
  id, display_id: `OLD-3-${String(id).padStart(3, "0")}`, kind: "sentence", lang, text: `t${id}`, group_unit_id: null, pos_seq: id, spans: [[id, 0, 5]], status: "unassigned", ref: null, ...over,
});
const ids = (items: PairColumnItem[]) => items.map((item) => item.unit.id);

describe("buildPairColumns", () => {
  const view = {
    units: [
      makeUnit(6, "ko"), makeUnit(1, "ko"), makeUnit(2, "ref"), makeUnit(3, "neutral", { kind: "table", text: "" }),
      makeUnit(7, "en", { kind: "cell_sentence", group_unit_id: 3, pos_seq: 3 }), makeUnit(4, "en"), makeUnit(5, "neutral", { kind: "figure" }),
    ],
    pairs: [{ id: 9, status: "suggested" as const, unit_ids: [1, 4] }],
  };
  it("splits a document by language in source order, and keeps units with no language in the flow they sit in", () => {
    const columns = buildPairColumns(view);
    expect([ids(columns.ko), ids(columns.en)]).toEqual([[1, 2, 3, 6], [4, 5]]);
    expect(columns.ko.map((item) => item.isPiece)).toEqual([true, false, false, true]);
    expect(columns.en.map((item) => item.isPiece)).toEqual([true, false]);
  });
  it("carries each unit's pair and its mates", () => {
    const columns = buildPairColumns(view);
    expect(columns.ko[0].pair).toEqual({ id: 9, status: "suggested", mateIds: [4] });
    expect(columns.en[0].pair).toEqual({ id: 9, status: "suggested", mateIds: [1] });
    expect(columns.ko[3].pair).toBeNull();
  });
  it("orders two units of one paragraph by where they start", () => {
    const columns = buildPairColumns({ units: [makeUnit(2, "ko", { pos_seq: 1, spans: [[1, 10, 20]] }), makeUnit(1, "ko", { pos_seq: 1, spans: [[1, 0, 9]] })], pairs: [] });
    expect(ids(columns.ko)).toEqual([1, 2]);
  });
  it("puts a leading unit with no language with the unit after it, and in KO when the document has no language at all", () => {
    const leading = buildPairColumns({ units: [makeUnit(1, "neutral", { kind: "figure" }), makeUnit(2, "en"), makeUnit(3, "ko")], pairs: [] });
    expect([ids(leading.ko), ids(leading.en)]).toEqual([[3], [1, 2]]);
    const bare = buildPairColumns({ units: [makeUnit(1, "neutral", { kind: "figure" })], pairs: [] });
    expect([ids(bare.ko), ids(bare.en)]).toEqual([[1], []]);
    expect(buildPairColumns({ units: [makeUnit(1, "ko")], pairs: [] }).en).toEqual([]);   // 한 언어뿐인 문서 - 빈 칸
  });
});

describe("listPairLinks", () => {
  it("draws one link per KO and EN member of a pair", () => {
    const columns = buildPairColumns({ units: [makeUnit(1, "ko"), makeUnit(4, "en"), makeUnit(8, "en")], pairs: [{ id: 5, status: "confirmed", unit_ids: [1, 4, 8] }] });
    expect(listPairLinks(columns)).toEqual([{ pairId: 5, koId: 1, enId: 4, status: "confirmed" }, { pairId: 5, koId: 1, enId: 8, status: "confirmed" }]);
    expect(listPairLinks(buildPairColumns({ units: [makeUnit(1, "ko")], pairs: [] }))).toEqual([]);
  });
});

describe("canUndoPair", () => {
  const paired = (status: PairUnit["status"] = "unassigned", pair: PairInfo = { id: 9, status: "confirmed", unit_ids: [1, 4] }) => ({ units: [makeUnit(1, "ko", { status }), makeUnit(4, "en")], pairs: [pair] });
  it("undoes a pair that is still the same confirmed pair of undecided units", () => {
    expect(canUndoPair(paired(), 9, [1, 4])).toBe(true);
    expect(canUndoPair(paired(), 9, [4, 1])).toBe(true);
    expect(canUndoPair(paired(null), 9, [1, 4])).toBe(true);
  });
  it("does not when the pair is gone, changed or one of its units was decided meanwhile", () => {
    expect(canUndoPair(paired(), 10, [1, 4])).toBe(false);
    expect(canUndoPair(paired("unassigned", { id: 9, status: "confirmed", unit_ids: [1, 4, 8] }), 9, [1, 4])).toBe(false);
    expect(canUndoPair(paired("unassigned", { id: 9, status: "suggested", unit_ids: [1, 4] }), 9, [1, 4])).toBe(false);
    expect(canUndoPair(paired("confirmed"), 9, [1, 4])).toBe(false);
    expect(canUndoPair(paired("ai_suggested"), 9, [1, 4])).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 본다** — `cd frontend && npx vitest run src/lib/pair-drop-model.test.ts` → FAIL(없는 모듈).
- [ ] **Step 3: 모델을 쓴다.**
  - `resolvePairDrop`이 보는 순서(첫 번째로 걸리는 것): ① `target`이 없다 · `sources`에 `target`이 있다 · `target`이나 `sources`의 어느 Unit이 글 종류(`sentence`·`heading`·`cell_sentence`)가 아니다 · `target.group_unit_id`가 있다 → `none` ② `sources`가 둘 이상(가까운 줄의 짝 카드)이면 그 짝이 확정 → `paired`, 아니면 `suggested_pair` ③ 끄는 Unit의 언어가 `ref` → `ref_line`, `ko`·`en`이 아니면 `no_language`. 놓는 Unit도 같은 차례 ④ 언어가 같다 → `same_lang` ⑤ 둘 중 하나가 확정 짝에 들었다 → `paired` ⑥ 둘 중 하나가 제안 짝에 들었는데 둘이 같은 짝이 아니다 → `suggested_pair` ⑦ `isDecided(끄는 Unit)` → `assigned`, `isDecided(놓는 Unit)` → `other_assigned` ⑧ `hasDraft` 같은 차례로 `unsaved` · `other_unsaved` ⑨ 둘이 같은 제안 짝이면 `confirm`, 아니면 `pair`.
  - `buildPairColumns`: 판단 Unit만(`group_unit_id === null`), 순서는 `pos_seq` → `spans[0]?.[1] ?? 0` → `id`(`classify-model` `buildRows`와 같은 순서). 칸은 "§12 열린 것"의 규칙. `isPiece` = 글 종류이고 언어가 `ko`·`en`.
  - `canUndoPair`: 그 id의 짝이 있고 `status === "confirmed"`이며 `unit_ids`가 `unitIds`와 같은 집합이고, 그 Unit들의 `status`가 모두 `null`이거나 `"unassigned"`.
  - `confirmPair`: Interfaces대로(`deletePair`와 인자 순서가 같다).
- [ ] **Step 4: 통과를 본다** — 같은 명령 → PASS. `npx tsc --noEmit -p tsconfig.json`, `npm run lint` 초록.
- [ ] **Step 5: 커밋** — `feat(assign): add the pure model for pairing by drop and the Pair view columns — 놓아서 짝 맺기 모델과 Pair view 두 칸 모델` (`PROGRESS.md` 포함)

---

### Task 3: 화면 — Pair view(켜기·두 칸·선·끄기)

끌기는 Task 4다. 이 태스크가 끝나면 Pair view를 켜고 읽고 고르고 끌 수 있다(조각은 아직 끌리지 않는다).

**Files:**
- Create: `frontend/src/components/assign/pair-column.tsx`(`PairColumn`·`PairViewToggle`), `frontend/src/components/assign/pair-lines.tsx`(`PairLines`·`readPairAnchor`)
- Modify: `frontend/src/components/assign/old-pane.tsx`(`headExtra` prop 하나)
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx`(상태·켜고 끄기·그리기)
- Modify: `frontend/src/styles/components.css`(Assign 두 문서 틀 규칙 옆), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 하나)

**Interfaces:**
- Consumes: Task 2의 `buildPairColumns`·`listPairLinks`·`PairColumnItem`·`PairLink`·`PairLang`. `page.tsx`의 `oldView`·`mode`·`hasSolo`·`view`·`changeView`·`zoomPane`·`row`·`activeKey`·`pickedOld`·`unitMap`·`handleOldClick`·`pairBanner`·`isNewEdit`·`paperDocOptions`·`cutLine`·`clearCarve`·`setMenu`·`setCtxMenu`·`showInNew`·`jumpToOld`·`scrollToUnit`·`revealElement`·`handleKey`. `PaneDivider`·`PaneZoom`·`Tooltip`·`EmptyState`·`UnitStatusChip`(`@/components/status`)·`LangToken`·`buildLinkPath`(`@/lib/link-route-model`).
- Produces:

```tsx
// pair-column.tsx
export function PairViewToggle(props: { on: boolean; onToggle: () => void }): ReactNode;
// <Tooltip label={t("assign.pairView.tip")}><button type="button" className="pane-toggle has-label" aria-pressed={on} data-testid="assign-pair-view">
//   <Languages size={13} strokeWidth={1.8} aria-hidden /><span>{t("assign.pairView")}</span></button></Tooltip>

interface PairColumnProps {
  side: PairLang;
  items: readonly PairColumnItem[];
  /** 머리 왼쪽의 문서 이름 - KO 칸만 넘긴다 */
  docLabel?: string;
  /** 머리 오른쪽의 Pair view 단추 - KO 칸만 */
  toggle?: ReactNode;
  /** 머리 아래 한 줄(짝 고르기 띠) - KO 칸만 */
  banner?: ReactNode;
  selectedIds: ReadonlySet<number>;
  pickedIds: ReadonlySet<number>;
  statusOf: (unitId: number) => CoverStatus | undefined;
  /** 조각을 끌 수 있다 - Task 4가 켠다 */
  canDrag: boolean;
  onUnitClick: (unitId: number, keys: { shiftKey: boolean }) => void;
  zoom: number;
  onZoom: (dir: "+" | "-") => void;
}
export function PairColumn(props: PairColumnProps): ReactNode;

// pair-lines.tsx
/** 조각에서 선이 나가는 자리(client 좌표) - KO는 오른쪽 끝, EN은 왼쪽 끝, 높이는 첫 글줄(위에서 13px, 낮은 조각은 가운데) */
export function readPairAnchor(el: HTMLElement, side: PairLang): { x: number; y: number };
export function PairLines(props: { links: readonly PairLink[]; focusIds: ReadonlySet<number> }): ReactNode;

// old-pane.tsx
interface OldPaneProps { /* … */ headExtra?: ReactNode }   // 머리의 확대 단추 바로 앞에 그린다
```

  - `PairColumn` DOM(고정 — 스모크와 Task 4가 기댄다):
    - `<section className="assign-pane pair-col" data-pane={side === "ko" ? "old" : "new"} data-pair-col={side} data-testid={`assign-pair-${side}`} style={{ "--z": zoom }}>` — `data-pane`은 두 문서 틀의 자리 규칙(스크롤 막대 쪽·여백)과 문서별 확대(`use-pane-zoom`의 `readPane`)를 그대로 받으려고 지금 값을 쓴다. Pair view의 코드·CSS·스모크는 `data-pair-col`로만 가린다.
    - 머리 `.pane-head`: (KO) `<span className="pane-title">{docLabel}</span>`, `<span className="tag" data-testid={`assign-pair-tag-${side}`}>`(글 `KO` | `EN`), `<span className="flex-1" />`, (KO) `toggle`, `<PaneZoom testId={`assign-pair-zoom-${side}`} …/>`.
    - `banner`, 그 아래 `.pane-body` 안에 `<div className="pair-list" role="list">`. 줄이 없으면 목록 대신 `<EmptyState compact testId={`assign-pair-empty-${side}`} title={t("assign.pairView.empty")} …/>`.
    - 줄마다 `<div className="pair-piece" role="listitem" data-unit={unit.id} data-testid={`assign-pair-piece-${unit.id}`} data-kind={unit.kind} lang={…}>` + 속성: `data-dim`(`!isPiece`), `data-pair="suggested" | "confirmed"`(`pair`가 있을 때), `data-sel`(`selectedIds`), `data-picked`(`pickedIds`), `data-drag-box`(`canDrag && isPiece`). 안: 번호 `<span className="pair-piece-id">{unit.display_id}</span>`, 글 `<span className="pair-piece-text">`(표·행은 `t("split.table")`, 그림은 글이 없으면 `t("assign.newFigure")`), 흐린 REF 줄은 `<LangToken lang="ref" isRefProposed={unit.ref?.state === "proposed"} />`, 상태가 `unassigned`가 아니면 `<UnitStatusChip status={…} size="sm" />`(상태는 `statusOf(unit.id) ?? unit.status`). 누르면 `onUnitClick(unit.id, { shiftKey })`. 흐린 줄도 눌러 고른다(그 줄도 줄이다).
  - `PairLines` DOM: `<svg className="link-lines pair-lines" aria-hidden data-testid="assign-pair-lines">` 안에 선마다 `<g data-pair-link={`${koId}:${enId}`} data-status={status} data-strong={…}><path d={…} /></g>`. `data-strong`은 두 끝 중 하나가 `focusIds`에 있을 때.
  - 틀: `.assign-panes`에 Pair view 동안 `data-pair-view=""`를 달고 `data-single`을 떼낸다.
  - 새 문구(en / ko): `assign.pairView`: "Pair view" / "짝 보기" · `assign.pairView.tip`: "Korean on the left, English on the right" / "왼쪽에 한국어, 오른쪽에 영어" · `assign.pairView.empty`: "No sentences in this language." / "이 언어의 문장이 없습니다."

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 단계 이름 `assign: Pair view opens a KO | EN document in two columns and gives the view back`. 자리는 3걸음의 두 단계 뒤(`new bundle in one click, locked stages, empty assign` 바로 앞). 묶음은 `halfBundleId`, 문서는 `GET /documents`에서 `side === "old"` · `status === "ready"` · `language_layout === "ko_en_separate"`인 것(D — 합성 OLD-3). 자료는 단계 안에서 API로 만든다(시드를 고치지 않는다): 단계 처음에 D의 판단을 비우고(`POST /decisions/reset` `{ revision, document_id }`) D의 짝을 모두 푼다(`DELETE …/documents/{D}/pairs/{id}?revision=` — 풀 때마다 문서 revision을 다시 읽는다). 그 전에 이 뒤의 단계가 그 묶음의 배정·짝을 읽지 않는지 `grep`으로 확인한다(3걸음 단계도 같은 확인을 했다). `GET …/documents/{D}/view`에서 `kind === "sentence"`인 KO 문장 a·b·c·d와 EN 문장 a′·b′·c′·d′를 원문 순으로 잡는다. 응답을 바꿔 그리는 도우미를 하나 둔다: `page.route("**/documents/" + D + "/view", …)`가 진짜 응답을 받아(`route.fetch()`) 단계가 바꿔 끼우는 함수 `patchView(view)`를 지나 돌려준다(처음에는 그대로) — **검증 스택에는 임베딩이 없어 `ko_en_separate` 문서에 진짜 제안 짝을 만들 길이 없고**(코드 제안은 연달아 배치에서만, AI 제안은 임베딩이 켜져야 나온다), 합성 OLD-3에는 언어 없는 Unit도 없다. 확인할 것:
  1. **단추가 보이는 문서**: 연달아 배치 Old 문서를 열면(`assign-old-doc`) `assign-pair-view`가 0개, D를 열면 1개이고 `aria-pressed`가 `false`.
  2. **켜기 전을 적어 둔다**: a의 조각을 눌러 그 줄을 고르고 `assign-row-id`의 글, `assign-new`의 `data-doc`, `assign-view-two`의 `aria-pressed`를 적는다.
  3. **켠다**(`assign-pair-view` 클릭): `assign-pair-ko`·`assign-pair-en`이 보이고 `assign-old`·`assign-new`·`assign-link-lines`가 0개, `assign-divider`는 1개, `.assign-panes`에 `data-pair-view`가 있고 `data-single`이 없다. `assign-pair-view`의 `aria-pressed`가 `true`(KO 칸 머리 안에 있다). KO 칸의 `[data-testid^="assign-pair-piece-"]`의 Unit id 순서가 API의 그 문서 판단 Unit 가운데 `lang === "ko"`인 것의 원문 순서와 같고, EN 칸도 같다. a의 조각에 `data-sel`, `assign-row-id`가 2와 같다(옆 패널이 살아 있다).
  4. **고르기**: b′의 조각을 누르면 `assign-row-id`가 b′의 번호이고 그 조각에 `data-sel`. <kbd>J</kbd>를 누르면 다음 줄의 조각으로 `data-sel`이 옮겨 간다.
  5. **선 — 확정은 실선**: API로 (a, a′)를 맺고(`POST …/pairs`) 다시 읽게 한 뒤(`page.reload()` → 다시 켠다) `g[data-pair-link="${a}:${a′}"]`의 `data-status`가 `confirmed`이고 그 `path`의 `stroke-dasharray`가 `none`. a·a′ 조각에 `data-pair="confirmed"`. a를 누르면 a′에도 `data-sel`이고 그 `g`에 `data-strong`.
  6. **선 — 제안은 회색 점선**: `patchView`로 그 짝의 `status`를 `"suggested"`로 바꿔 다시 읽으면 `data-status`가 `suggested`, `path`의 `stroke-dasharray`가 `none`이 아니고 `g`의 `color`가 5의 확정 선과 다르다. 조각에 `data-pair="suggested"`.
  7. **언어 없는 Unit**: `patchView`로 d′의 `lang`을 `"ref"`(`ref: { state: "confirmed", number: "SOP-ABC-1016" }`)로 바꿔 다시 읽으면 d′의 조각이 EN 칸에 그대로 c′ 다음에 서고 `data-dim`이 있다. 그 조각을 눌러도 줄이 골라진다(`data-sel`).
  8. **지금 길은 그대로**: b의 조각을 고르고 옆 패널의 `assign-shape-pair_pick-${b}`를 누르면 `assign-pair-pick` 띠가 `assign-pair-ko` 안에 뜬다. b′의 조각을 누르면 `POST …/pairs`가 201이고 API에서 b·b′가 한 짝이다. (끝에 API로 푼다.)
  9. **V는 Pair view만 끈다**: <kbd>V</kbd> → `assign-pair-ko`가 없고 `assign-view-two`의 `aria-pressed`가 2에서 적은 값 그대로다. 다시 켠다.
  10. **다른 문서의 줄을 고르면 꺼진다**(Review Focus 5): D의 첫 줄(판단 Unit 가운데 원문 순 첫째)의 조각을 누르고 <kbd>K</kbd> → `assign-pair-ko`가 0개, `assign-old`가 보이고 `assign-old-doc`의 값이 D가 아니다. D를 다시 열고 a를 골라 다시 켠다.
  11. **끈다**(`assign-pair-view` 클릭): `assign-old`·`assign-new`가 돌아오고 `assign-new`의 `data-doc`·`assign-view-two`의 `aria-pressed`·`assign-row-id`가 2에서 적은 값과 같다. `assign-paper-piece-${a}`에 `data-sel`이 있고 Old 칸 `.pane-body`의 화면 안에 있다. `assign-link-lines`가 1개다.
  12. **한 단 보기**: `assign-view-one`을 누른 뒤 켜면 두 칸이 모두 보이고(`data-single` 없음), 끄면 `assign-new`가 0개이고 `.assign-panes`에 `data-single`이 있다. `assign-view-two`로 되돌린다.
  13. 끝에 `page.unroute`, 이 단계가 맺은 짝을 API로 푼다.
- [ ] **Step 2: 실패를 본다.** 갓 시드한 DB에서 전체 스모크 → 새 단계만 실패(기준선은 Task 1 Step 6).
- [ ] **Step 3: `pair-column.tsx`·`pair-lines.tsx`·`old-pane.tsx`.** Interfaces의 DOM대로. `PairLines`는 `link-lines.tsx`의 재는 짜임을 받는다(틀의 스크롤을 캡처로·`ResizeObserver`·창 크기를 듣고 한 프레임에 한 번, 바뀐 것이 없으면 상태를 고치지 않는다) — 두 끝이 **모두** 제 칸 `.pane-body` 화면 안일 때만 긋고, 좌표는 틀 기준으로 옮겨 `buildLinkPath`. 포인터 올림을 듣지 않는다(올림으로 다시 그리지 않는다 — G11). `OldPane`은 `headExtra`를 확대 단추 앞에 그리는 한 줄뿐이다.
- [ ] **Step 4: `page.tsx` — 상태와 켜고 끄기.**
  - `const [pairViewDoc, setPairViewDoc] = useState<number | null>(null)`. `canPairView = mode === "old" && !hasSolo && oldView?.document.language_layout === "ko_en_separate"`, `isPairView = canPairView && pairViewDoc === oldView?.document.id`. `oldView`가 있는데 `pairViewDoc !== null && !isPairView`면 렌더 중에 `setPairViewDoc(null)`(다른 문서·한 단의 New 원문·"New without source"로 가면 꺼진다 — 지금 `dropLink`가 쓰는 "렌더 중 상태 맞추기"와 같은 짜임).
  - 켤 때: 나눌 선·긁은 글자·떠 있는 메뉴를 거두고(`cutLine.clear()`·`clearCarve()`·`setMenu(null)`·`setCtxMenu(null)`) Old 칸 `.pane-body`의 `scrollTop`을 ref에 적은 뒤 `setPairViewDoc(oldView.document.id)`. 짝 고르는 중(`pairFrom`)은 그대로 둔다.
  - 끌 때: `setPairViewDoc(null)`. Old 용지가 다시 그려진 뒤 고른 줄이 있으면 `scrollToUnit(row.unitIds[0])`, 없으면 적어 둔 `scrollTop`으로 돌린다.
  - `changeView`의 맨 앞에 `if (patch.single !== undefined) setPairViewDoc(null);`. `showInNew`·`jumpToOld`의 맨 앞에 `setPairViewDoc(null)`. `handleKey`의 V 갈래: `isPairView`면 `setPairViewDoc(null)`만, 아니면 지금 그대로.
  - 고른 줄이 바뀌면(Pair view 동안) 그 줄의 조각(`[data-testid="assign-pair-piece-<id>"]`)마다 `revealElement` — 이펙트에서(렌더 중에 DOM을 읽지 않는다).
- [ ] **Step 5: `page.tsx` — 그리기.** `pairColumns = isPairView && oldView ? buildPairColumns(oldView) : null`(메모), `pairLinks = listPairLinks(pairColumns)`. 두 문서 틀 안: `pairColumns`가 있으면 `<PairColumn side="ko" …/>` · `<PaneDivider …지금과 같은 props/>` · `<PairColumn side="en" …/>` · `<PairLines links={pairLinks} focusIds={…} />`, 없으면 지금 그대로(`OldPane` + New 칸). 넘기는 값: `selectedIds`·`focusIds` = `new Set(row?.unitIds ?? [])`, `pickedIds={pickedOld}`, `statusOf={(id) => unitMap.get(id)?.status}`, `onUnitClick={handleOldClick}`, `canDrag={false}`, KO 칸에 `docLabel`(`paperDocOptions`에서 그 문서의 `label`)·`toggle={<PairViewToggle on onToggle={…} />}`·`banner={pairBanner !== null && !isNewEdit ? pairBanner : null}`, 확대는 KO `view.zoomOld`·`zoomPane("old", dir)`, EN `view.zoomNew`·`zoomPane("new", dir)`. `OldPane`에는 `headExtra={canPairView ? <PairViewToggle on={false} onToggle={…} /> : undefined}`.
- [ ] **Step 6: CSS**(토큰만, 값은 화면에서 재어 정한다).
  - `.pane-toggle.has-label`: 폭 자동, 아이콘과 글 사이 4px, 글은 `--fs-cap`, 줄바꿈 없음. `.pane-head`를 컨테이너로 두고(`container-type: inline-size`) 머리가 좁으면 라벨 `span`을 감춘다 — 문턱은 창 폭 1120(영·한 모두)에서 머리가 넘치지 않는 값으로 잡는다(Task 6에서 다시 잰다).
  - `.pair-list`: 세로 목록(틈 4px), 폭 상한은 용지와 같은 `calc(860px * var(--z, 1))`, KO 칸은 세로선 쪽(오른쪽)으로, EN 칸은 왼쪽으로 붙는다(`.sheet`의 `margin-inline` 규칙과 같은 방향).
  - `.pair-piece`: Old 조각(`.strip`)과 같은 종이 상자 — `--paper` 바탕, `1px solid var(--line-2)`, `--r-1`, `--shadow-1`, 글은 `calc(var(--fs-read) * var(--z, 1))`, 커서는 손가락. 번호는 mono `--ink-3` 작은 글, 글은 줄바꿈하고 넘치지 않는다(`min-width: 0; overflow-wrap: anywhere`). 제목(`data-kind="heading"`)은 굵게. 수백 줄에서 굴림이 끊기지 않게 `content-visibility: auto` + `contain-intrinsic-size`(`.strip-row`와 같은 방식).
  - `[data-sel]`: 강조색 2px 테두리(Old 조각의 고른 테두리와 같은 굵기). `[data-picked]`: Old 조각의 여럿 고름과 같은 표시. `[data-dim]`: `opacity`로 흐리게(글 대비는 Task 6에서 잰다), 그림자 없음.
  - 짝 막대: `[data-pair]`에 세로선 쪽 변(KO 칸은 오른쪽, EN 칸은 왼쪽) 3px — `confirmed`는 `solid var(--accent)`, `suggested`는 `dashed var(--ink-4)`. 막대 쪽 두 모서리는 직각.
  - `.pair-lines`: `.link-lines`의 규칙을 그대로 받고(옅게, `data-strong`이면 진하게) `g[data-status="suggested"]`만 `color: var(--ink-4)` + 점선(`stroke-dasharray`).
- [ ] **Step 7: 문구·사용 설명서.** 문구 셋(en·ko). 설명서 `#assign-view`에 한 항목: `ko_en_separate`(한/영 따로) 문서를 열면 Old 문서 머리에 **Pair view** 가 보이고, 켜면 왼쪽에 한국어·오른쪽에 영어 Unit이 원문 순서로 펴지며(New 문서 자리를 빌린다), 짝은 선으로 이어지고(확정은 실선, 제안은 회색 점선) 조각을 누르면 그 줄의 조각이 두 칸에서 화면 안으로 들어온다는 것, 언어가 없는 줄(참조 줄·표·그림)은 흐리게 제자리에 남는다는 것, 다시 누르거나 <kbd>V</kbd>·보기 단추로 끄면 보던 화면으로 돌아간다는 것, 켜 둔 것은 기억하지 않는다는 것. `#assign-context`에 한 문장: Pair view에는 우클릭 메뉴·나누기·**Join** 이 없다(끄고 쓴다 — 옆 패널의 **Shape** 줄은 그대로 된다). `manual-content.test.ts` 통과.
- [ ] **Step 8: 초록을 본다.** `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, 갓 시드한 DB에서 전체 스모크(새 단계 PASS, 기준선보다 실패가 늘지 않음), `next dev`를 내리고 `npm run build` 경고 0.
- [ ] **Step 9: 커밋** — `feat(assign): add Pair view, a KO | EN two-column view of a separate-layout Old document — 한/영 따로 문서를 두 칸으로 펴는 Pair view` (`PROGRESS.md` 포함)

---

### Task 4: 화면 — Pair view에서 끌어 짝 맺기·제안 확정·Undo

**Files:**
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx`(끌기 설정·저장·Undo)
- Modify: `frontend/src/components/assign/assign-help.tsx`(Shortcuts에 한 줄), `frontend/src/styles/components.css`, `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 둘)

**Interfaces:**
- Consumes: Task 1의 `showToast(text, tone, { action })`, Task 2의 `resolvePairDrop`·`PAIR_REFUSAL_KEYS`·`PairDrop`·`PairDropContext`·`canUndoPair`·`confirmPair`, Task 3의 `PairColumn`(`canDrag`)·`readPairAnchor`·`isPairView`. `createPair`·`deletePair`·`getDocumentView`(`api-sop`), `BoxDragConfig`·`findUnderPoint`·`useBoxDrag`, `buildOldDragCard`·`canDragOld`, `createDragLinkLine`, `page.tsx`의 `paperModel`·`oldView`·`isUnitDecided`·`hasUnitDraft`·`busy`·`setBusy`·`setSolo`·`setSelectedKey`·`followUnit`·`reloadAfterEdit`·`humanizeApiError`·`panesBoxRef`·`isOldDrag`.
- Produces(`page.tsx` 안 — Task 5가 다시 쓴다):

```ts
/** 짝 놓기가 보는 지금 상태 - 렌더마다 한 번 짓는다(포인터가 움직일 때마다 짓지 않는다) */
const pairDropCtx: PairDropContext;   // pairOf는 oldView.pairs로 만든 Map<unitId, ViewPair>
/** 표의 메모와 테두리 - pair는 "Pair with <번호>", confirm은 "Confirm this suggested pair", refused는 이유, none은 놓을 자리 밖 */
function readPairHover(drop: PairDrop, target: ViewUnit | undefined, el: HTMLElement | null): DragHover;
/** 놓아서 맺기·확정 - 바로 저장하고 Undo가 든 알림을 띄운다. busy면 버린다 */
async function runPairDrop(drop: Extract<PairDrop, { kind: "pair" | "confirm" }>): Promise<void>;
```

  - 새 문구(en / ko):
    - `assign.pairDrag.pair`: "Pair with {id}" / "{id}와 짝 맺기"
    - `assign.pairDrag.confirm`: "Confirm this suggested pair" / "이 제안 짝 확정"
    - `assign.pairDrag.done`: "Paired {ids}" / "{ids} 짝을 맺었습니다"
    - `assign.pairDrag.confirmed`: "Confirmed the pair {ids}" / "{ids} 제안 짝을 확정했습니다"
    - `assign.pairDrag.undoStale`: "The pair changed after that. Nothing was undone." / "그 뒤에 짝이 바뀌어 되돌리지 않았습니다."
    - `assign.help.keyDragPair`: "Pair two Old pieces (KO/EN)" / "Old 조각끼리 한/영 짝 맺기"
    - `{ids}`는 그 짝 Unit의 번호를 원문 순으로 ` + `로 이은 글(예 "OLD-3-004 + OLD-3-011").

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 둘 다 Task 3 단계 바로 뒤.

  **단계 A** `assign: Pair view - drag a piece onto its partner to pair or confirm, Undo separates`. Task 3 단계와 같은 준비(문서 D의 판단·짝을 비우고 KO a·b·c·d, EN a′·b′·c′·d′, 그리고 제목 Unit h·h′도 하나씩 잡는다, `patchView` 도우미), `installCommitCounter`, `/pairs`로 가는 요청을 모두 적는다(`page.on("request")` — 메서드·주소·본문). Pair view를 켜고:
  1. **끄는 동안**(a → a′): `drag-card`의 메모가 `Pair with ${a′의 display_id}`, a′ 조각에 `data-drop="over"`, a 조각에 `data-drag-src`, `svg[data-drag-line]`이 1개. 두 칸의 조각 위를 40걸음 지나는 동안 `window.__commits`가 늘지 않는다.
  2. **놓는다**: `POST …/documents/{D}/pairs`의 본문 `unit_ids`가 `[a, a′]`이고 응답이 201. `toast-ok`의 글이 `Paired `로 시작하고 두 번호를 담는다. `[data-testid^="toast-action-"]`이 1개이고 글이 `Undo`. API에서 a·a′가 한 짝(`status` `confirmed`, `source` `human`). `g[data-pair-link="${a}:${a′}"][data-status="confirmed"]`가 있고 `assign-row-id`가 두 번호를 담는다. `drag-card`·`svg[data-drag-line]`·`[data-drop]`·`[data-drag-src]`가 0개.
  3. **글쇠로 Undo**: 그 단추에 포커스를 주고(`focus()`) <kbd>↵</kbd> → `DELETE …/pairs/{id}`가 200, API에서 a·a′가 짝 없음, 알림 `Separated`. 요청 기록에 Assign 되돌리기(`/decisions/undo`)는 없다.
  4. **반대 방향**(a′ → a): 메모가 `Pair with ${a의 display_id}`, 놓으면 본문이 `[a′, a]`이고 다시 한 짝이다(이 짝 P1은 남겨 둔다).
  5. **거절은 이유를 보이고 아무것도 쓰지 않는다** — 올린 동안 `drag-card[data-refused]`·그 조각의 `data-drop="refused"`·메모가 아래 글이고, 놓은 뒤 `/pairs` 요청 수와 API의 짝이 그대로다:
     - 같은 언어(b → c): "A pair needs one Korean and one English sentence. Pick one in the other language."
     - 확정 짝에 놓기(b → a′), 확정 짝을 끌기(a → b′): "One of these sentences is already in a confirmed pair."
     - 배정된 조각에 놓기(API로 c′를 확정해 둔다 — 3걸음 단계의 `POST /groups/save`를 본보기로. c → c′): "The sentence on that side is assigned. Clear its assignment first." 반대로 끌기(c′ → c): "This sentence is assigned. Clear the assignment first."
     - REF 줄(`patchView`로 d′를 `ref`로. d → d′): "A reference line has no language. Choose Not a reference first." d′ 조각에는 `data-drag-box`가 없고 눌러 끌어도 `drag-card`가 생기지 않는다.
     - 다른 짝을 가리키는 제안(API로 (b, b′)를 맺고 `patchView`로 그 짝을 `suggested`로 바꿔 다시 읽는다. 제안의 조각에 놓기 d → b′, 제안의 조각을 끌기 b → h′): "One of them is already in a pair. Separate it first."
  6. **제안 확정**(b → b′, 5의 제안): 메모가 `Confirm this suggested pair`. 놓으면 `POST …/pairs/{id}/confirm`이 200이고 본문에 `revision`만 있다. 알림이 `Confirmed the pair `로 시작하고 **Undo** 가 있다. `patchView`를 거두고 **Undo** 를 누르면 `DELETE …/pairs/{id}`가 200, API에서 b·b′가 짝 없음(제안으로 돌아가지 않는다).
  7. **Esc**: b → b′ 위에서 `Escape` → 표·선·`[data-drop]`이 없고 `/pairs` 요청이 늘지 않는다.
  8. **그사이 짝이 바뀐 뒤의 Undo**(Review Focus 1): b → b′로 맺은 뒤 API로 그 짝을 직접 푼다. **Undo** 를 누르면 `DELETE` 요청이 **가지 않고** `toast-info`의 글이 "The pair changed after that. Nothing was undone.".
  9. **잇달아 두 번**(Review Focus 2): b → b′를 놓고 그 저장이 끝나면(응답과 알림) 10초 안에 h → h′ → `[data-testid^="toast-action-"]`이 2개이고 아래(먼저 뜬) 알림의 **Undo** 를 누르면 b·b′만 풀린다(h·h′는 그대로).
  10. **낡은 revision**(Review Focus 3): `patchView`를 거두고 다시 읽은 뒤(d′가 다시 영어 문장이다) d를 d′ 위로 끈 채(놓기 전) API로 b·b′를 맺었다 풀어 문서 revision을 올린다. 놓으면 응답이 409, `toast-error`의 글이 "Someone changed this first"를 담고 API에서 d·d′는 짝 없음. 다시 끌어 놓으면 201. (409가 콘솔에 찍히므로 이 단계는 `allowConsoleErrors: true`로 돈다.)
  11. **다른 화면에서의 Undo**(Review Focus 5): 10의 알림이 떠 있는 동안 레일의 `stage-nav-outputs`를 눌러 Outputs로 간다(`page.goto`는 화면을 새로 받아 알림을 지운다). 거기서 **Undo** 를 누르면 `DELETE`가 200이고 API에서 d·d′가 짝 없음, 처리되지 않은 예외(`pageerror`)가 없다.
  12. **메뉴 길은 그대로**: Assign으로 돌아와 Pair view를 켜지 않고 D의 c 조각을 우클릭 → `assign-ctx-pair_pick`이 1개(꺼져 있지 않다), `Escape`.
  13. 끝에 이 단계가 맺은 짝을 API로 풀고 D의 판단을 비운다(`POST /decisions/reset` — 문서 범위).

  **단계 B** `assign: Pair view reads on a read-only bundle, nothing drags`(`devUser: "qa.lead"`, 검토 대기 묶음): `ko_en_separate` Old 문서를 열면 `assign-pair-view`가 있고 누르면 두 칸이 보인다. 조각에 `data-drag-box`가 하나도 없고, 조각을 누른 채 40px 움직여도 `drag-card`가 0개, `/pairs` 요청이 0건.
- [ ] **Step 2: 실패를 본다** — 갓 시드한 DB의 전체 스모크에서 새 단계 A만 실패(B는 끌기가 아직 없어 통과한다 — 끌기를 넣은 뒤에도 통과해야 한다).
- [ ] **Step 3: `page.tsx` — 끄는 동안.** 끌기 설정을 하나 더 만들어 같은 틀에 붙인다: `useBoxDrag(panesBoxRef, isPairView && isOldDrag && ready ? pairDragConfig : null)`. 지금 붙어 있는 `dragConfig`의 조건에는 `!isPairView`를 더한다(둘 중 하나만 붙는다). `PairColumn`의 `canDrag`는 `isOldDrag`.
  - `BoxDragConfig<{ unit: ViewUnit }>`. `pick`: 누른 곳의 `[data-pair-col] .pair-piece[data-drag-box]` → `paperModel.units.get(Number(el.dataset.unit))`. `getCard`: `buildOldDragCard([unit], …)`(Unit 하나라 개수 없음). `getScrollers`: 틀 안의 `.pane-body` 둘.
  - `onStart`: 그 조각에 `data-drag-src`, `createDragLinkLine(root)`. `onMove`: `findUnderPoint(point, "[data-pair-col] .pair-piece[data-unit]")` → 그 Unit → `resolvePairDrop([unit], target, pairDropCtx)` → `readPairHover`. 따라오는 점선은 출발 조각의 `readPairAnchor`(제 칸 화면 밖이면 감춘다 — 2걸음과 같다)에서 포인터까지. `onEnd`: `data-drag-src`와 선을 지운다(취소 때도).
  - `readPairHover`: `pair` → `{ state: "ok", note: t("assign.pairDrag.pair", { id: target.display_id }), target: el }`, `confirm` → `{ state: "ok", note: t("assign.pairDrag.confirm"), target: el }`, `refused` → `{ state: "refused", note: t(PAIR_REFUSAL_KEYS[reason]), target: el }`, `none` → `{ state: "none" }`.
- [ ] **Step 4: `page.tsx` — 놓았을 때와 Undo.**
  - `onDrop`: 놓은 자리에서 다시 판단해 `pair`·`confirm`이면 `runPairDrop(drop)`. 그 밖은 아무 일도 없다.
  - `runPairDrop`: `oldView`가 없거나 `busy`면 돌아간다. 문서와 revision은 **`oldView.document`** 에서 읽는다(`runPairChange`가 쓰는 `shapeView`가 아니다 — 양 단에서 New 문장을 다듬는 중이면 `shapeView`는 New 문서다). `setSolo(null)`(New 문장 다듬기를 닫아 `followUnit`이 Old 줄을 따라가게) → `setBusy(true)` → `pair`면 `createPair(bundleId, doc.id, doc.revision, drop.unitIds)`, `confirm`이면 `confirmPair(bundleId, doc.id, drop.pairId, doc.revision)` → 응답의 `pair`로 `setSelectedKey(null)`, 알림 `showToast(t(pair면 "assign.pairDrag.done" 아니면 "assign.pairDrag.confirmed", { ids }), "ok", { action: { label: t("common.undo"), run: () => pairUndoRef.current(doc.id, pair.id, pair.unit_ids) } })`, `followUnit(pair.unit_ids[0])`. `ids`는 응답의 `pair.unit_ids`(원문 순) Unit의 `display_id`(`unitMap`)를 ` + `로 이은 글이다. 실패하면 `showToast(humanizeApiError(err, t), "error")`. 끝에 늘 `reloadAfterEdit()`와 `setBusy(false)`(`runPairChange`와 같은 짜임).
  - Undo: `async function undoPairDrop(docId: number, pairId: number, unitIds: readonly number[])` — `getDocumentView(bundleId, docId)`로 다시 읽어 `canUndoPair(view, pairId, unitIds)`가 아니면 `showToast(t("assign.pairDrag.undoStale"), "info")`만 하고(아무것도 쓰지 않는다), 맞으면 `deletePair(bundleId, docId, pairId, view.document.revision)` → `showToast(t("split.pairRemoved"))`, `setSelectedKey(null)`, `followUnit(unitIds[0])`. 실패는 `humanizeApiError` 알림. 끝에 `reloadAfterEdit()`. `busy`로 막지 않는다(알림의 단추는 한 번뿐이다).
  - 알림의 콜백은 그 렌더의 함수를 붙들면 안 된다 — `pairUndoRef`에 가장 최근의 `undoPairDrop`을 이펙트에서 넣어 두고(`use-box-drag.ts`의 최신 config 미러와 같은 짜임, 렌더 중에 ref를 쓰지 않는다) 알림은 `pairUndoRef.current(…)`를 부른다.
- [ ] **Step 5: CSS.** 올리면 조각이 살짝 들린다(G9) — `html:not([data-box-drag]):not([data-box-select]) .pair-piece[data-drag-box]:hover`에 Old 조각의 들림과 같은 그림자. 끄는 동안(G10) 조각 안의 것(상태 칩·REF 표시)이 포인터를 받지 않게 `html[data-box-drag] .assign-panes .pair-piece > * { pointer-events: none; }`(조각 상자는 받는다 — 놓을 곳이다). 머리의 단추는 2걸음 규칙(`html[data-box-drag] .assign-panes :is(… button …)`)이 이미 끈다. `data-drop` 테두리가 짝 막대·고른 테두리와 겹쳐 읽히지 않는지 화면에서 본다(겹치면 그 선택자에서 `outline-offset`만 고친다).
- [ ] **Step 6: 문구·도움말·사용 설명서.** 문구 여섯(en·ko). `assign-help.tsx`의 Shortcuts에 끌기 줄 다음 한 줄(`assign.help.keyDragPair`, 글쇠 표시는 지금 끌기 줄과 같은 `drag`). 설명서 `#split-pair`에 "끌어서 짝 맺기" 문단: **Pair view** 에서 조각을 맞은편 언어의 조각에 끌어 놓으면(어느 쪽에서든) 바로 한/영 짝이 되고, 회색 점선으로 이어진 제안의 조각을 제 짝에 놓으면 그 제안이 확정된다는 것(제안이 셋이면 셋 모두), 끄는 동안 표에 "Pair with OLD-3-011"처럼 할 일이 적힌다는 것, 저장은 바로 되고 알림의 **Undo** 로 10초 안에 풀 수 있다는 것(제안을 확정한 것도 풀기까지 — 제안으로 돌아가지 않는다. <kbd>Ctrl</kbd>+<kbd>Z</kbd>로는 되돌리지 않는다. 그 뒤에는 옆 패널이나 우클릭 메뉴의 **Separate the KO/EN pair**), 못 놓는 조각과 이유(같은 언어 · 이미 확정 짝 · 다른 문장과 제안으로 묶인 조각은 먼저 따로 뗀다 · 배정된 문장은 먼저 **Clear assignment** · 참조 줄 · 저장하지 않은 고름), 끌기로는 한 문장과 한 문장만 맺고 셋 이상은 **Pair with another sentence…** 에서 <kbd>Shift</kbd>로 모은다는 것. 같은 절의 "올릴 때 자동으로 잡힌 짝도 따로 확정하지 않습니다" 문장 뒤에 Pair view에서는 제안을 끌어 확정할 수도 있다고 잇는다. `manual-content.test.ts` 통과.
- [ ] **Step 7: 초록을 본다** — Task 3 Step 8과 같은 명령(전체 스모크에서 새 단계 셋 PASS). 알림(폭 380)에서 번호 둘이 든 글·**Undo**·닫기 단추가 서로 덮지 않는지 화면에서 잰다(en·ko).
- [ ] **Step 8: 커밋** — `feat(assign): pair or confirm by dragging a piece onto its partner in Pair view, with Undo on the toast — Pair view에서 끌어 짝 맺기·제안 확정, 알림의 Undo` (`PROGRESS.md` 포함)

---

### Task 5: 화면 — 가까운 줄(연달아 배치 문서의 Old 칸 안에서)

**Files:**
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx`(`dragConfig`의 `onMove`·`onDrop`)
- Modify: `frontend/public/manual/user-manual.md`
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 하나 + 허락한 한 곳)

**Interfaces:**
- Consumes: Task 4의 `pairDropCtx`·`readPairHover`·`runPairDrop`, Task 2의 `resolvePairDrop`. 지금 `dragConfig`(`pick`이 돌려주는 `{ rowKey, unitIds }`), `paperModel`, `findUnderPoint`.
- Produces: `page.tsx` 안 `function readPairAt(point: DragPoint, unitIds: readonly number[]): { drop: PairDrop; el: HTMLElement | null; target: ViewUnit | undefined }` — Old 문서가 `ko_en_interleaved`가 아니면 늘 `{ drop: { kind: "none" }, el: null, target: undefined }`. 새 문구·새 `data-testid` 없음.

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 단계 이름 `assign: drag an Old piece onto a nearby piece in the other language to pair them`, 자리는 Task 4의 단계 뒤. 묶음은 `halfBundleId`, 문서는 `ko_en_interleaved` Old 문서 하나(I). 자료는 단계 안에서 API로 만든다: I에서 두 Unit이 모두 미배정이고 위아래로 붙은 한/영 짝 줄 둘(x·x′, y·y′)을 골라(모자라면 I의 판단을 `POST /decisions/reset`으로 비운다 — 뒤 단계가 읽지 않는지 `grep`으로 확인) 그 두 짝을 API로 풀고, 짝 카드로 남은 줄 하나(q·q′)를 더 잡는다. `installCommitCounter`, `/pairs` 요청을 적는다. 평소의 두 단 보기에서(이 문서에는 `assign-pair-view`가 0개다):
  1. **끄는 동안**(x → x′): `drag-card`의 메모가 `Pair with ${x′의 display_id}`, `assign-paper-piece-${x′}`에 `data-drop="over"`. Old 조각들 위를 30걸음 지나는 동안 `window.__commits`가 늘지 않는다.
  2. **놓는다**: `POST …/pairs` 본문이 `[x, x′]`, 201. 알림 `Paired …`와 **Undo**. API에서 한 짝이고 화면에서 두 조각이 한 카드다(`data-bracket`). **Undo** → 풀린다.
  3. **반대 방향**(x′ → x) → 다시 한 짝(남겨 둔다).
  4. **거절**(아무것도 쓰지 않는다 — 올린 동안 `drag-card[data-refused]`와 그 조각의 `data-drop="refused"`, 놓은 뒤 `/pairs` 요청 수와 API의 짝이 그대로): 같은 언어(영어 y′ → 영어 x′) — "A pair needs one Korean and one English sentence. Pick one in the other language." · 확정 짝의 조각에 놓기(한국어 y → 영어 x′) — "One of these sentences is already in a confirmed pair." · 짝 카드를 끌어 다른 Old 조각에(q의 카드 → y′) — q·q′가 제안이면 "One of them is already in a pair. Separate it first.", 확정이면 "One of these sentences is already in a confirmed pair."(API로 읽은 상태에 맞춰 견준다). 짝 카드를 제 조각에 올리면(q → q′) `[data-drop]`이 없고 메모가 빈 글이다.
  5. **New 칸은 그대로 잇기·보내기다**: y를 끌어 이미 쓴 문서의 문장 위로 → 메모가 `Link to this sentence`, `Escape`. I에 표나 그림 조각이 있으면 그 위에서는 `[data-drop]`이 없고 메모가 빈 글이다.
  6. **다른 배치에서는 조용하다**: `ko_en_separate` 문서(D)를 평소 보기로 열어 KO 문장을 EN 문장 조각 위로 끌면 `[data-drop]`이 없고 메모가 빈 글, 놓아도 `/pairs` 요청이 없다.
  7. 끝에 y·y′를 API로 다시 맺어 둔다(x·x′는 사람이 맺은 짝으로 남는다).

  **허락한 한 곳**: 3걸음 단계 `assign: drag an Old piece onto a slot in the All list, in both views, it saves like a click`의 한 단 보기 확인 "dropping on the Old paper in one view does nothing"은 W를 제자리에서 오른쪽 40px·아래 60px에 놓는다. 그 자리가 연달아 배치 문서의 맞은편 언어 조각이면 이제 짝이 맺어진다. 이 태스크 뒤 그 확인이 그래서 실패하면 **놓는 점만** 조각이 아닌 곳(Old 용지의 아래 여백, 또는 W 자기 조각 안)으로 옮긴다 — 확인의 이름과 기대값(`assign-chosen`·`data-sel`·저장 요청 수)은 그대로 둔다. 다른 기존 단계는 고치지 않는다.
- [ ] **Step 2: 실패를 본다** — 갓 시드한 DB의 전체 스모크에서 새 단계만 실패.
- [ ] **Step 3: `page.tsx`.** `readPairAt`: `findUnderPoint(point, '[data-pane="old"] :is(.cell-piece, .strip)[data-strip-unit]')`(포인터 밑의 가장 안쪽 조각) → `paperModel.units.get(Number(el.dataset.stripUnit))` → `resolvePairDrop(unitIds의 Unit들, target, pairDropCtx)`. `dragConfig.onMove`가 보는 순서는 나무 → 이미 쓴 문서의 문장(잇기) → **Old 조각(짝)** → 보내기다: 짝 판단이 `none`이 아니면 놓을 자리 선을 감추고 따라오는 점선을 포인터에 두고 `readPairHover`를 돌려준다. `onDrop`도 같은 순서로 — 짝 판단이 `pair`·`confirm`이면 `runPairDrop`, `refused`면 아무 일도 없이 끝내고, `none`이면 지금처럼 보내기로 넘어간다. 줄을 고르지 않는다(`selectRow`를 부르지 않는다 — 저장 뒤 `followUnit`이 새 짝 줄을 고른다). 그 밖의 `dragConfig`는 건드리지 않는다.
- [ ] **Step 4: 사용 설명서.** `#split-pair`의 "끌어서 짝 맺기" 문단에: 한/영 연달아 문서에서는 **Pair view** 없이 Old 원문 안에서 조각을 맞은편 언어의 조각에 끌어 놓아 짝을 맺는다는 것(같은 규칙·같은 **Undo**), 짝 카드는 한 장으로 끌려 다른 조각에는 놓이지 않는다는 것, 같은 언어 조각에는 놓이지 않고 합치기는 틈의 **Join** 이라는 것, 조각을 New 문서로 끌면 지금처럼 잇기·보내기라는 것. `#assign-destination`의 "끌어서 잇기" 문단에 한 문장: 한/영 연달아 문서에서 Old 조각 위에 놓으면 짝 맺기다([묶인 문장과 한/영 짝](#split-pair)). `#assign-keys`의 끌기 줄에 "맞은편 언어의 Old 조각에 놓으면 한/영 짝"을 더한다.
- [ ] **Step 5: 초록을 본다** — Task 3 Step 8과 같은 명령(전체 스모크에서 새 단계 넷 PASS, 2~3걸음의 끌기 단계가 그대로 PASS).
- [ ] **Step 6: 커밋** — `feat(assign): pair two nearby Old pieces by dragging one onto the other in an interleaved document — 연달아 배치 문서에서 Old 조각끼리 끌어 짝 맺기` (`PROGRESS.md` 포함)

---

### Task 6: 극단 자료·좁은 창 검토와 올리기 준비

**Files:**
- Modify(필요할 때만): Task 1·3·4의 CSS, `pair-column.tsx`·`pair-lines.tsx`·`toast.tsx`·`page.tsx`
- Modify: `frontend/package.json`·`package-lock.json`(1.1.8), `CHANGELOG.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-11-16-drag-and-drop-design.md`, `docs/README.md`, `frontend/CLAUDE.md`

**Interfaces:**
- Consumes: Task 1~5.
- Produces: dev에 합칠 수 있는 브랜치(푸시·합치기는 조율하는 세션이 한다).

- [ ] **Step 1: 극단 자료로 다시 시드한다**(`seed_sop_demo` → `seed_sop_worst`, 버려도 되는 DB) — 창 폭 1120과 2560에서 스크립트(`playwright-core` + 시스템 Chrome)로 잰다. 눈으로만 보지 않는다. 겹치면 고친다(보고만 하지 않는다). 극단 시드의 가장 큰 문서(OLD-90)도 언어마다 Unit이 160여 개뿐이라, **언어마다 수백 개인 문서를 이 측정에서 하나 만든다**: backend를 띄우기 전에 그 DB를 향해 한 번 쓰는 스니펫(커밋하지 않는다 — `$PY -c`로, 시드와 같은 `TestClient(app)`·`tests.sop_helpers.upload`·`AUTHOR`)으로 `scripts.seed_sop_worst.build_big("OLD-88", 1200, False)`(문단 600개 — 언어마다 600여 Unit)를 W1 묶음(작업 중)에 올린다. 그 문서와 OLD-90(1,800자 문단)을 `PATCH /api/bundles/{id}/documents/{docId}` `{ revision, language_layout: "ko_en_separate" }`로 바꿔 Pair view를 연다(코드 제안 짝은 이때 지워진다 — API로 30쌍쯤 다시 맺어 선을 만든다). REF 줄·그림·표가 있는 합성 문서(OLD-1)와 영어뿐인 작은 문서(OLD-94)도 같은 방식으로 바꿔 본다.
  - **머리**: 폭 1120에서 Old 칸 머리와 KO 칸 머리가 넘치지 않는다(`.pane-head`의 `scrollWidth ≤ clientWidth`, en·ko, 문서 이름이 긴 묶음에서도) — 넘치면 라벨을 접는 문턱을 올린다. 접혔을 때 툴팁이 이름을 말한다.
  - **조각**: 1,800자 문단·공백 없는 330자 토큰이 칸 폭을 넘기지 않고(`.pane-body`의 `scrollWidth ≤ clientWidth`) 번호·상태 칩·짝 막대가 글을 덮지 않는다(겹치는 px 0). 폭 2560에서 두 칸이 세로선 쪽으로 붙고 조각 폭이 상한(860 × 확대)을 넘지 않는다.
  - **끌기**: 언어마다 600여 Unit인 문서(OLD-88)에서 Pair view가 켜지고 굴림이 끊기지 않으며(켜는 데 걸린 시간과 굴리는 동안의 긴 프레임을 적는다 — 눈에 띄게 끊기면 `content-visibility` 값을 고친다), 조각 위를 40걸음 지나는 동안 `window.__commits` 증가 0. 포인터를 EN 칸 아래 가장자리에 두면 그 칸만 스스로 스크롤한다(`scrollTop` 증가, KO 칸은 그대로). 1,800자 문단을 끌 때 `drag-card`의 높이가 한 줄(≤ 34px)이고, 가장 긴 이유(en·ko — `assign.pairPickSameLang`)가 메모에 있을 때 표가 창 오른쪽 밖으로 나가지 않는다.
  - **선**: 30쌍을 맺은 상태에서 선의 두 끝이 조각의 변에 닿고(x 차이 ±1px) 선이 틀(`.assign-panes`) 밖으로 나가지 않으며, 한쪽 끝이 제 칸 화면 밖이면 그 선은 없다. 굴리는 동안 선이 조각과 함께 움직인다. 멀리 떨어진 짝의 KO 조각을 누르면 EN 조각이 제 칸 화면 안으로 들어오고 그 선이 진해진다(움직임 줄이기에서는 바로).
  - **언어 없는 줄**: OLD-1을 따로 배치로 바꿨을 때 REF 줄·그림·표가 "§12 열린 것"의 규칙대로 서고(그 앞 Unit의 칸) 흐리며 끌리지 않는다. 흐린 글의 대비가 읽을 만한지 `pw-contrast-audit.mjs`의 계산 방식으로 잰다(모자라면 `opacity`를 올린다).
  - **빈 칸**(Review Focus 4): 영어뿐인 OLD-94를 따로 배치로 바꿔 켜면 KO 칸에 `assign-pair-empty-ko`가 보이고 EN 칸은 평소대로이며, EN 조각을 빈 칸 위로 끌어 놓아도 `[data-drop]`·`/pairs` 요청·콘솔 오류가 없다.
  - **알림**: 폭 1120에서 번호가 긴 짝(예 `OLD-90-0331 + OLD-90-0662`)의 알림이 폭 380 안에 있고 글·**Undo**·닫기가 서로 덮지 않으며, 상단 바의 AI 작업 목록이 떠 있을 때도 그 목록을 덮지 않는다(지금 알림과 같은 자리 규칙).
  - **다크 테마**에서 확정 선·제안 점선·짝 막대·흐린 줄이 구별된다(값은 토큰이 바꾼다 — 화면 코드에 테마 분기가 없다).
  - 재고 고친 뒤 `PATCH`로 배치를 되돌릴 필요는 없다(버리는 DB다).
- [ ] **Step 2: 전체 검증.** `git diff --stat dev -- backend/`가 비어 있다. frontend: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, `npm run build` 경고 0. 갓 시드한 DB(`seed_sop_demo`)에서 전체 스모크(이 계획의 새 단계 넷 PASS, 실패가 Task 1의 기준선보다 늘지 않음) → 다시 시드 → `pw-overlap-audit.mjs`, `DS=worst pw-layout-audit.mjs`, `pw-contrast-audit.mjs`(공용 부품 `toast.tsx`·`old-pane.tsx`를 고쳤다).
- [ ] **Step 3: 버전과 기록.** `frontend/`에서 `npm version patch --no-git-tag-version` → 1.1.8. `CHANGELOG.md` `## Unreleased (dev)` 아래 `### v1.1.8 — <이 커밋을 만드는 날>`(Pair view가 무엇인지, 끌어서 맺기·제안 확정·**Undo**, 연달아 배치 문서의 Old 칸 안 짝 맺기, 알림이 행동 단추를 지닐 수 있게 된 것, 알려진 한계 — 끌기는 1:1뿐이고 다른 문장과 제안으로 묶인 조각은 먼저 따로 뗀다 · 배정(AI 분류 제안 포함)이 있는 문장은 지금 메뉴와 같이 못 맺는다 · Pair view에는 우클릭 메뉴·나누기·Join이 없다 · 언어 없는 줄의 자리는 합성 자료로 정했다 · 터치는 그대로). `PROGRESS.md`는 이 브랜치의 항목을 요약 하나로 줄인다. 설계 문서: §10의 4걸음에 "(v1.1.8로 dev에 올렸다.)", §7 끝에 "4걸음에서 정한 것" 묶음으로 위 "이 계획이 정한 것"과 "설계와 코드가 어긋난 곳"을 "(내 판단)" 한 줄씩, §12의 첫 줄을 "합성 자료로 정했다(앞 Unit의 칸) — 실제 `ko_en_separate` 문서로 확인 필요"로 바꾼다. `docs/README.md`에 이 계획 한 줄을 더하고 설계 줄의 상태를 고친다(1~4걸음 구현됨). `frontend/CLAUDE.md`: 끌기 문장의 "Assign 잇기·보내기는 `lib/assign-drop-model.ts`" 옆에 "짝 놓기와 Pair view 두 칸은 `lib/pair-drop-model.ts`", 알림 문장에 "(행동 단추 하나 — `showToast(text, tone, { action })`, 되돌리기용)".
- [ ] **Step 4: 커밋** — `chore(release): v1.1.8, Pair view and pairing by drag — Pair view와 끌어서 짝 맺기 (v1.1.8)`

---

## Self-Review 기록

- **설계 대비**: §7 "Pair view(켜는 단추·두 칸·원문 순서·New 칸 자리·끄면 원래 보기·언어 없는 Unit)"는 Task 2(`buildPairColumns`)와 Task 3. "끄는 것과 놓는 곳·방향은 양쪽"·"끌기로 하는 것은 둘"은 Task 2(`resolvePairDrop`의 `pair`·`confirm`)와 Task 4 스모크 2·4·6. "이미 확정 짝인 조각에는 놓이지 않는다·끄는 조각도 짝이 없어야 한다·확정 짝 카드를 Old 조각에 놓는 것은 거절"은 Task 2의 `paired`와 Task 4 스모크 5, Task 5 스모크 4. "바로 저장·알림의 Undo·확정한 제안도 풀기까지·Ctrl+Z에 서지 않는다"는 Task 1과 Task 4 Step 4, 스모크 3·6. "거절과 이유"는 Task 2의 표와 Task 4 스모크 5(다섯 사유) — `pair_fates_differ`는 위 "어긋난 곳"의 판정대로 서버 알림이다. "선"은 Task 3 Step 6과 스모크 5·6. "가까운 줄"은 Task 5(Old 조각이면 짝, New 칸이면 잇기·보내기 — 스모크 5). "Join·우클릭 메뉴·Pair with another sentence…는 그대로"는 Global Constraints와 Task 3 스모크 8, Task 4 스모크 12, 그리고 기존 단계(`assign: join two pieces from the gap…`·`assign: separate and pair KO/EN from the right-click menu`)가 그대로 통과하는 것. §9(짝 놓기의 거절 사유를 순수 모델로, 스모크의 Pair view 장면, 극단 자료)는 Task 2·3·4·6. G1~G5·G8은 끌기 층, G6·G7·G9~G11은 Task 3·4·5, G12는 Global Constraints, G13은 `isOldDrag`와 Task 4 단계 B.
- **Review Focus의 시험**: 1 → Task 2 `canUndoPair` + Task 4 스모크 8. 2 → Task 1 "stacks action toasts…" + Task 4 스모크 9. 3 → Task 4 스모크 10. 4 → Task 2 "한 언어뿐인 문서 - 빈 칸" + Task 3의 `assign-pair-empty-<칸>`(Task 6에서 한 언어만 든 합성 문서를 따로 배치로 바꿔 화면으로 본다). 5 → Task 3 스모크 10 + Task 4 스모크 11.
- **설계와 다르게 정한 것**은 "설계와 코드가 어긋난 곳"의 다섯이고 모두 위에 적었다. 서버 변경은 없다.
- **하지 않는 것**: Old 용지의 짝 카드에 제안·확정 구별을 그리기, 평소 Old 칸에서 제안 짝 카드를 끌어 확정하기, 끌기로 1:2 만들기·다른 짝으로 옮기기·제안 갈아 끼우기, 운명(`pair_fates_differ`)을 화면에서 계산하기, 두 칸의 스크롤 맞추기, Pair view의 우클릭 메뉴·부분 탭·필터 접기, Pair view 기억하기, 이미 쓴 New 문서(`ko_en_separate`)의 Pair view, 시드에 제안 짝 넣기(스모크는 응답을 바꿔 그린다), 터치 끌기.
- **이름 맞춤**: `PairDrop`(`pair`·`confirm`·`refused`·`none`) ↔ `readPairHover` ↔ `runPairDrop`(`pair`·`confirm`만 받는다)이 Task 2·4·5에서 같은 이름이다. `PairColumn`의 `canDrag`는 Task 3에서 `false`, Task 4에서 `isOldDrag`. 조각의 `data-unit`·`data-pair-col`·`data-testid="assign-pair-piece-<id>"`는 Task 3이 정하고 Task 4의 `pick`·`onMove`·스모크가 쓴다. Old 용지의 조각은 지금 이름(`data-strip-unit`·`assign-paper-piece-<id>`) 그대로이고 Task 5가 쓴다. 알림의 `showToast(text, tone, { action })`·`toast-action-<id>`는 Task 1이 정하고 Task 4가 쓴다.
