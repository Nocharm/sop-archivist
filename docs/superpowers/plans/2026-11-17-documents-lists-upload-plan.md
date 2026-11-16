# Documents 화면 3·4·5걸음 — WI를 SOP에 끌기 · Old 목록 두 줄 · 올리기 묶음 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New 목록의 WI 줄을 SOP 줄에 끌어 상위 SOP를 바꾸고 알림의 **Undo** 로 되돌리며(N/A **Restore** 도), Old 문서 목록을 값이 글자로 보이는 두 줄 줄로, 올리기 창을 Old · New 두 묶음(줄 끌기 · 창 안 파일 놓기 · 결과가 제자리에 남는 올리는 국면)으로 바꾼다.

**Architecture:** 서버는 바꾸지 않는다 — 지금 있는 `PATCH …/tobe/docs/{id}` · `PUT`과 `DELETE …/na/{slot_key}` · `PATCH`와 `POST …/documents`만 부른다. 놓을 수 있는지와 거절 사유, 되돌려도 되는지는 새 순수 모델 `lib/parent-drop-model.ts`가 정하고, 끌기는 공통 끌기 층(`useBoxDrag`)을 New 목록 틀과 올리기 창에 하나씩 붙인다. Undo는 공용 알림의 행동 단추(`showToast(text, tone, { action })`)가 맡는다. Old 줄은 앞 계획의 줄 틀(`DocRow`)을 그대로 쓰고, 올리기 창은 `lib/upload-model.ts`를 넓혀 `upload-modal.tsx`를 다시 쓴다.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · vitest(jsdom) · Playwright(시스템 Chrome) 스모크. 새 의존성 없음. backend · Alembic 변경 없음.

**Spec:** `docs/superpowers/specs/2026-11-17-documents-screen-design.md` — §2, §3, §4, §5, §7, §8("고치고 되돌리기"의 Undo), §9, §11("목록과 줄" · "WI를 SOP에 끌기" · "올리기 창"), §12, §13의 3·4·5걸음, §14, §15. 공통 끌기 규칙은 `docs/superpowers/specs/2026-11-16-drag-and-drop-design.md` §4(G1~G13) — 끌기 층의 본보기는 Order(`frontend/src/components/outputs/output-c.tsx`)다. 알림의 행동 단추는 `docs/superpowers/plans/2026-11-17-pair-view-plan.md` Task 1이 정했다. 앞 계획 `docs/superpowers/plans/2026-11-17-documents-na-table-plan.md`(1·2걸음)가 `dev`에 합쳐진 뒤에 시작한다. 구현 전에 루트 `CLAUDE.md`, `frontend/CLAUDE.md`, `docs/lessons/react-ts-patterns.md`(§2 ref 미러 · §3 · §6 · §7) · `browser-verification.md` · `ui-review.md`를 읽는다.

## Global Constraints

- 작업 폴더는 이 작업의 워크트리(`<worktree>`), 브랜치 `feat/documents-lists-upload`(앞 계획이 합쳐진 `dev`에서 딴다 — `frontend/src/components/documents/doc-row.tsx`가 있고 `frontend/package.json`의 버전이 앞 계획의 릴리스인지 먼저 본다). 원본 체크아웃(`<original-checkout>`)은 읽기와 venv 실행만 한다. 공개 저장소다 — 추적 파일에 사용자 경로 · 실서버 IP · 시크릿을 쓰지 않는다.
- **서버를 바꾸지 않는다.** `backend/` 아래 파일을 고치지 않는다(`git diff --stat dev -- backend/`가 비어 있어야 한다). 화면이 먼저 막되 서버 검사는 그대로 둔다(G7) — 서버가 거절하면 지금처럼 `humanizeApiError` 알림이고 목록을 다시 받는다.
- **끌기는 사용자 결정 그대로다**: 손잡이 없이 상자 전체를 끈다, 놓을 때 행동한다, 글자 긁기는 Alt를 누른 동안만, `pointerdown`에서 `preventDefault`를 부르지 않는다(G2), 상자 안의 단추 · 링크 · 입력 · `[data-no-drag]`에서 누른 것은 끌기가 아니다(G4), 끌기 뒤의 `click` 한 번은 삼킨다(G5), 끄는 동안 다른 호버 효과를 끈다(G10), 포인터가 움직일 때마다 React 상태를 바꾸지 않는다(G11 — 놓을 자리 표시는 끌기 층이 다는 `data-drop`과 DOM 속성뿐). `lib/box-drag.ts` · `use-box-drag.ts`는 고치지 않는다.
- **끌기로만 할 수 있는 일은 없다**(G12): 상위 SOP는 펼친 곳의 **Parent SOP** 고르기 칸, 올리기의 쪽은 **Old | New** 단추, 파일 더하기는 **Choose files**. 지금의 그 길들은 뜻이 달라지지 않는다.
- **읽기 전용**(검토자, `in_review` · `done` Bundle — 화면의 `canEdit`가 거짓)에서는 끌기가 시작되지 않고(`data-drag-box`를 달지 않는다) 고치는 칸 · 고치는 단추 · 올리기 단추가 없다(G13). **Preview** · **Download** 는 남는다.
- **상위 SOP가 없는 WI를 만들지 않는다**(서버 422 `invalid_parent`, 제품 명세 §6.6). 여러 줄을 한 번에 끌지 않는다. 터치 끌기를 만들지 않는다. New 문서 · 단계의 순서를 바꾸지 않는다. Old 줄에 Unit 수를 넣지 않는다.
- **하위 칸이 있는 상위 칸에 직접 놓인 줄에 관한 규칙을 만들지 않는다**(이 걸음과 무관하다).
- **지금 할 수 있는 일은 하나도 사라지지 않는다**: Old 문서의 번호 · 버전 · 제목 · 언어 배치 고치기, 빈 번호 · 버전의 AI 제안과 빈 버전의 EQUIS 제안 받기, EQUIS 다시 조회와 **Use current number**, 미리 보기 · 내려받기 · 지우기, 제목을 눌러 Assign 한 단 보기로 열기, 화면에 파일을 놓아 올리기 창 열기, 올린 뒤 결과 줄에서 Old 파일의 번호 · 버전 · 언어 배치 고치기와 **Go to Assign**.
- **줄은 읽기, 펼치면 고치기**(사용자 결정): Old 줄에는 입력 칸 · 고르기 칸을 두지 않는다. 예외는 올리기 창의 결과 줄뿐이다(§9).
- 공용 부품은 쓰기만 한다: `components/ui/toast.tsx`(`showToast(text, tone, { action: { label, run } })`와 문구 `common.undo`) · `components/modal.tsx` · `components/ui/data-list.tsx`(다른 화면이 쓴다)를 고치지 않는다. `components/equis/equis-status.tsx`는 클래스 이름 하나만 더한다(Task 3).
- 화면 규칙은 순수 모델에 두고 단위 시험한다. 색 · 그림자는 토큰만(raw hex 금지), 한쪽 막대 강조는 막대 쪽 모서리를 직각으로.
- 새 문구는 `frontend/src/lib/i18n-messages.ts`에 en · ko 한 쌍(`i18n-messages.test.ts`가 키 집합을 가드). 도메인 용어(Bundle · Old · New · Unit)와 상태 표기는 화면 언어와 상관없이 영어다. 문구에 긴 대시를 쓰지 않는다. 쓰지 않게 된 키는 그 태스크에서 en · ko를 함께 지운다.
- 사용 설명서 글(`frontend/public/manual/user-manual.md`)은 화면을 바꾸는 커밋에서 함께 고치고, 화면 라벨은 영어 화면 글자 그대로 **굵게** 적는다(`manual-content.test.ts`). 그림은 뽑지 않는다.
- **남는 `data-testid`는 지금 이름을 지킨다**: `documents-drop` · `documents-drop-veil` · `documents-upload` · `documents-empty` · `documents-empty-upload` · `documents-old-title` · `documents-list`, 줄마다 `documents-<id>-row` · `-code` · `-version`(과 `-version-up` · `-version-down` · `-version-clear`) · `-title` · `-layout` · `-status` · `-aux` · `-warnings` · `-reason` · `-preview` · `-download` · `-delete` · `-equis` · `-equis-link` · `-title-lock` · `-code-ai` · `-version-ai` · `-version-equis` · `-ai-reading`, 올리기 창의 `upload` · `upload-files` · `upload-pick` · `upload-picked` · `upload-picked-<i>` · `upload-side-<i>-old|new` · `upload-note-<i>` · `upload-kind-<i>` · `upload-parent-<i>` · `upload-remove-<i>` · `upload-cancel` · `upload-submit` · `upload-results` · `upload-row-<i>` · `upload-row-<i>-code|version|layout|listed|code-ai|version-ai` · `upload-done` · `upload-go-assign`. `<i>`는 **고른 순서의 자리**다(묶음 안의 자리가 아니다).
- 기존 시험(vitest · 스모크 · 감사)의 기대값을 고치지 않는다. 예외는 아래 "허락한 기존 시험 변경"에 이름을 적은 것뿐이다.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. 커밋 전 `PROGRESS.md` 갱신. 푸시 · 태그 · 버전 올리기는 하지 않는다 — 버전은 마지막 태스크에서만 올리고, 푸시는 조율하는 세션이 한다.
- 검증 스택(이 워크트리 전용 포트): backend 8787, frontend 3787. 내 것이 아닌 프로세스는 죽이지 않는다. Documents 스모크는 `ONLY="documents:"` · `ONLY="new documents:"`로 거른다(전체 스모크는 마지막 태스크).

```bash
# 워크트리 backend/ 에서 (backend는 띄우기만 한다 — 고치지 않는다)
PY=<original-checkout>/backend/.venv/bin/python
DATABASE_URL=sqlite+aiosqlite:///./docs-smoke.db AUTH_MODE=dev $PY -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./docs-smoke.db AUTH_MODE=dev $PY -m scripts.seed_sop_demo   # 극단 자료는 이어서 seed_sop_worst
DATABASE_URL=sqlite+aiosqlite:///./docs-smoke.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $PY -m uvicorn app.main:app --port 8787
# 워크트리 frontend/ 에서
BACKEND_URL=http://localhost:8787 npx next dev -p 3787
QUIET=1 ONLY="documents:,new documents:" BASE_URL=http://localhost:3787 BACKEND_PYTHON=$PY node scripts/pw-smoke-sop.mjs
npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run     # 커밋 전
```

## 이 계획이 정한 것(내 판단 — 설계에 없는 빈칸)

**WI를 SOP에 끌기**

1. **끌 수 있는 줄**: 그 WI의 지금 부모가 아닌 SOP가 목록에 하나라도 있는 WI 줄(작성자 · 작업 중 · 줄 쓰기가 돌지 않을 때). §7의 "SOP가 하나뿐이면 꺼진다"와 같되, 부모를 못 찾은 WI는 SOP가 하나여도 끌린다(놓을 곳이 있다).
2. **표 한 장**: ID 자리에 번호(`truncateMiddle(code, 14, 8)`), 글 자리에 제목 한 줄(없으면 "No title yet"), 개수 없음. 메모는 §7의 표 그대로.
3. **이유를 보이지 않는 곳**: 자기 줄, Old 줄, 펼친 곳, 등록 칸, 빈 곳. 놓을 자리는 New 목록 틀 안의 줄 상자(`.doc-row[data-doc]`)뿐이다.
4. **끄는 동안의 흐림**: Documents 화면 틀(`documents-drop`)에 DOM 속성 `data-parent-drag` 하나를 달고 CSS가 SOP 줄 말고 전부를 흐리게 한다(불투명도 0.35 — Order와 같은 값).
5. **놓은 뒤의 움직임**: 응답이 오면 New 줄 전체의 자리를 재고(`useFlip` — 옮긴 줄의 키가 첫째) 옮긴 줄을 강조한다(`flashElement`). 창 밖이면 `scrollIntoView({ block: "nearest" })`. 낙관적으로 먼저 옮기지 않는다(§7).
6. **알림의 글에 번호를 적는다**("WI-07 moved under SOP-PH"). 알림은 같은 글이면 앞의 것을 지우므로, 번호가 있어야 잇달아 옮길 때 앞 알림의 **Undo** 가 남는다. Undo가 끝나면 같은 문장을 앞의 SOP 번호로 한 번 더 알린다(단추 없이).
7. **그사이 목록이 바뀌었을 때의 Undo**: 누르면 목록을 다시 읽는다. 그 줄이 아직 WI이고 부모가 **놓았던 그 SOP 그대로**일 때만 앞의 부모로 저장한다. 아니면(다른 사람이 다시 옮겼다 · 줄이 없어졌다 · SOP가 됐다) 아무것도 쓰지 않고 "The list changed after that. Nothing was undone."을 알린다 — 남이 바꾼 것을 Undo가 덮지 않는다. 앞의 부모 SOP가 그사이 사라졌으면 서버가 422 `invalid_parent`로 거절하고 그 문구가 뜬다.
8. **다른 화면으로 간 뒤의 Undo**: 알림은 화면을 넘어 10초 남는다. 누르면 같은 길로 저장한다(Bundle id · 줄 id · 번호만 있으면 된다). 알림의 콜백은 그 렌더의 함수를 붙들지 않는다(ref 미러).
9. **부모가 없던 WI를 끌어 놓았을 때**는 Undo를 주지 않는다(되돌릴 "앞의 부모"가 없고 서버가 부모 없는 WI를 받지 않는다). 알림만 띄운다.
10. **Restore의 Undo**(§8): 알림 "Restored 6.3 Troubleshooting"에 **Undo**. 누르면 목록을 다시 읽어 그 줄이 아직 SOP이고 그 칸이 N/A가 아닐 때만 지우기 전의 사유로 다시 저장한다. 그사이 그 칸에 문장이 들어왔으면 서버가 409 `slot_has_targets`로 거절하고 그 문구가 뜬다.

**Old 목록**

11. **줄의 값과 펼친 곳의 칸은 `data-testid`가 다르다**: 줄의 글자는 `-code-text` · `-version-text` · `-layout-text` · `-file`, 펼친 곳의 칸은 지금 이름(`-code` · `-version` · `-layout`). 제목은 줄의 링크가 지금 이름(`-title`)을 지키고(스모크 · 감사가 "누르면 Assign"으로 쓴다) 펼친 곳의 입력이 `-title-input`이다.
12. **받지 못한 파일(Rejected · Failed)의 줄은 펼쳐지지 않는다**(고칠 값이 없다). 화살표 단추를 그리지 않고 그 자리는 비워 둔다(줄의 글이 다른 줄과 같은 x에서 시작한다).
13. **끝 자리의 보조 검사는 예외만**(§5): 정상(**Checked**) 아이콘은 줄에서 빼고 펼친 곳의 **Aux check** 옆에 둔다. 추출 상태의 정상(**Ready**) 아이콘은 줄에 남는다.
14. **EQUIS**: 줄의 `EquisStatus`는 지금 그대로다(누르면 지금의 정보 창이 뜬다 — **Look up again** · **Use current number** 포함). 좁을 때 글자를 감추는 것은 React가 아니라 CSS다(`EquisStatus`의 글자 `span`에 클래스 `equis-text` 하나를 더하고 딸린 정보 줄의 컨테이너 질의가 감춘다). 펼친 곳에는 같은 부품을 글자가 보이는 모양으로 하나 더 둔다(`-panel-equis`) — 정보 창의 내용을 펼친 곳에 풀어 그리지 않는다(`equis-status.tsx`를 뜯지 않는다).
15. **Old 줄의 단추 자리는 80px**(아이콘 셋), 좁으면 ⋯ 하나. 넓음 · 좁음의 문턱과 숨는 방식은 앞 계획이 정한 것 그대로다(같은 CSS).
16. **펼친 곳의 저장**은 지금의 `saveField`(성공하면 "Saved" 알림, 실패하면 까닭 알림과 다시 받기)를 그대로 쓴다. 번호 · 제목 칸은 `CommitInput`이다(§5) — 빈 값을 저장하는지는 지금 `InlineText`의 동작을 읽어 같게 맞춘다.
17. **줄에 섞인 New 파일**(읽지 못해 목록 줄이 없는 것)은 식별 자리에 **New** 표(`.side-tag.new`, `documents-<id>-side`)가 붙는다. Old 표시와 Side 열은 없다.

**올리기 창**

18. **줄의 자리 번호는 고른 순서다.** 묶음은 같은 목록을 쪽으로 걸러 그린 것이라 `upload-picked-<i>` 등의 `<i>`가 쪽을 바꿔도 변하지 않는다.
19. **창 안 파일 놓기는 `window`의 `dragover` · `drop`을 듣는다**(고르는 국면 동안만, `UploadModal` 안의 이펙트). `Modal`을 고치지 않고, 창 밖 어두운 바탕에 놓은 것도 "창의 다른 곳"으로 받는다. 지금은 창이 열린 동안 화면의 놓기 처리가 꺼져 있어 파일을 놓으면 브라우저가 그 파일을 열어 버린다 — 이 걸음이 그것도 막는다.
20. **파일을 끄는 동안의 표시**: 포인터 아래 묶음의 `data-drop="over"`(공통 테두리)와 창 틀의 점선 테두리 속성 하나. 화면의 `drop-veil`을 창 안으로 옮기지 않는다(§14). 둘 다 DOM 속성이다.
21. **같은 파일**은 이름과 크기가 같은 것이다. 다시 더해도 줄이 늘지 않고 앞서 고른 쪽 · 종류 · 상위 SOP가 그대로다. DOCX · PDF가 아닌 파일을 놓아도 지금처럼 줄이 생긴다(서버가 거절하고 까닭이 그 줄에 남는다) — 화면에 새 규칙을 만들지 않는다.
22. **"Creates"의 ko**: §11의 "{code} 줄을 만듭니다 · 상위 …"는 고르기 칸 뒤에 오는 조각이라 빈 문구 없이는 만들 수 없다(문구 가드가 빈 값을 막는다). 라벨 모양으로 둔다 — en "Creates [SOP|WI] `WI-08` · under [SOP-PH]", ko "새 줄 [SOP|WI] `WI-08` · 상위 [SOP-PH]".
23. **묶음 영역의 높이 상한**: `max-height: min(560px, calc(100vh - 340px))`와 안쪽 스크롤(AI 목록 읽기 창과 같은 값). 줄 끌기의 스스로 스크롤은 그 영역이다.
24. **올리는 국면에서도 같은 줄이다**: 묶음과 줄의 DOM이 남고 줄의 `data-testid`만 `upload-picked-<i>` → `upload-row-<i>`, 틀이 `upload-picked` → `upload-results`로 바뀐다. 올리는 차례는 Old 묶음의 위에서 아래, 그다음 New 묶음(§9).
25. **파일 크기**: 1 MB 미만은 KB(반올림, 최소 1), 그 이상은 MB 소수 한 자리("184 KB" · "2.1 MB").
26. **사용 설명서 그림 스크립트**(`pw-manual-shots.mjs`)는 고치지 않는다. 마지막 태스크가 `PROGRESS.md`에 "정식 업데이트 때 `documents` · `upload` 장면의 표시 자리를 새 화면에 맞춘다"를 남긴다.

## 설계와 코드가 어긋난 곳 — 이렇게 정했다

- **알림의 행동 단추는 이미 있다**(§3 · §7은 "아직 만들지 않았다"). Pair view 걸음이 넣은 `showToast(text, tone, { action })`를 그대로 쓴다 — 이 계획은 `toast.tsx`를 고치지 않는다.
- **`documents list, inline edit and delete prompt` 단계는 `ONLY="documents:"`에 걸리지 않는다**(이름에 쌍점이 없다). §12가 "평소에는 `ONLY="documents:"`만"이라 적었으므로 이름을 바꾼다(아래 허락).
- **그 단계의 "aux check label" 확인은 줄에 정상 아이콘이 있다고 본다.** 판단 13으로 정상 아이콘이 펼친 곳으로 가므로 줄을 펼친 뒤에 본다(아래 허락).
- **배치 감사의 Old 목록 항목은 여섯이다**: `C7b` · `C10a` · `C10b` · `C10c` · `C10d` · `C10e`(`pw-layout-audit.mjs`). 표의 칸(`td`)과 늘 흐린 단추(`.row-actions-quiet`, 불투명도 0.45)를 박은 것이라 새 줄에 맞게 고친다. `C10e`(추출 · 보조 열 폭의 합)는 열이 없어져 뺀다.
- **끌기 중의 Esc가 창을 닫지 않는 까닭**을 코드로 확인했다: 끌기 층은 `window`의 캡처 단계에서 `stopPropagation`하고(`box-drag.ts` `handleKey`), `Modal`은 `window`의 버블 단계에서 듣는다 — 끌기 중의 Esc는 `Modal`에 닿지 않는다. 스모크로 박는다(Task 5).
- **`documents.pickHint`**("…You can also drop files anywhere on this screen.")는 창 안에서 읽히는 글인데 화면을 말한다. §11의 새 글로 바꾸고 옛 키를 지운다.

## 허락한 기존 시험 변경(이것뿐이다)

| 어디 | 무엇을 | 새 기대 |
|---|---|---|
| 스모크 `documents list, inline edit and delete prompt` | (Task 3) 단계 이름 | `documents: Old rows read in two lines, expand to edit, delete prompt` |
| 같은 단계 | (Task 3) 버전 칸 고치기 · "aux check label" | 첫 줄을 펼친 뒤 같은 이름의 칸(`-version` · `-version-up` · `-version-clear`)에서 한다(값 기대 "2.9" · "2.10"과 "줄이 움직이지 않는다"는 그대로). 보조 검사는 펼친 곳의 `[data-testid$="-aux"][data-state="ok"]`가 `aria-label="Checked"`(없으면 지금처럼 "Aux check unavailable" 글) |
| `pw-layout-audit.mjs` `C7b` · `C10a` · `C10b` · `C10c` · `C10d` | (Task 6) 표의 칸을 찾는 선택자와 기대값 | `C7b`: 1920에서 제목 상자 폭 ≥ 420px. `C10a`: 1120에서 모든 줄이 틀 안, 딸린 정보 줄이 한 줄, 단추 자리의 오른쪽 끝이 같다(±1px), 경고 칩이 수를 보인다. `C10b`: 줄 끝 단추의 불투명도가 평소 0, 줄에 올리면 1, 단추에 포커스가 있으면 1. `C10c`: 받지 못한 줄과 보통 줄의 제목 글 왼쪽 x가 같다. `C10d`: 그대로(선택자만) |
| `pw-layout-audit.mjs` `C10e` | (Task 6) | 항목을 뺀다(열이 없다) |
| `pw-overlap-audit.mjs` `mbtnScenes`의 `documents` | (Task 6) `.row-actions-quiet` 단추 | 올린 줄의 단추 묶음이 제목 · 딸린 정보 글을 덮지 않는 장면으로 바꾼다 |

## Review Focus

1. 옮긴 뒤 다른 사람이 그 WI를 다시 옮기거나 지운 다음 **Undo** 를 누른다 → 아무것도 쓰지 않고 이유를 알린다. 남이 바꾼 부모가 덮이면 안 된다.
2. 잇달아 두 줄을 옮긴다 · 옮긴 뒤 다른 화면으로 간다 → 알림 둘이 저마다 제 **Undo** 를 지니고, 다른 화면에서 눌러도 되돌리거나 이유를 말한다(예외가 나지 않는다).
3. 저장이 도는 사이에 다시 끌려 한다 → 끌기가 시작되지 않는다(응답 순서가 엇갈려 낡은 목록이 얹히지 않는다).
4. 번호 · 버전 · 제목이 모두 빈 Old 문서, 받지 못한 파일, 읽기 전용 사용자 → 줄이 무너지지 않고 "No number" · "No version" · "No title"이 보이며, 고치는 칸과 지우기 단추가 없다.
5. 같은 파일을 고르기와 놓기로 두 번 더한다 · 문서가 아닌 파일을 놓는다 → 줄은 하나이고, 받지 못한 파일은 까닭과 함께 제 묶음에 남는다.

---

### Task 1: 순수 모델 — 상위 SOP 놓기와 되돌리기 판정

**Files:**
- Create: `frontend/src/lib/parent-drop-model.ts` · Test: `frontend/src/lib/parent-drop-model.test.ts`
- Modify: `frontend/src/lib/slot-status-model.ts`(`canUndoRestore`) · Test: `slot-status-model.test.ts`(덧붙인다)

**Interfaces:**
- Consumes: `DraftDoc`(`tobe-draft`), `ToBe`(`api-sop`), `DragCard`(`box-drag`), `truncateMiddle`.
- Produces:

```ts
// parent-drop-model.ts
type DropDoc = Pick<DraftDoc, "key" | "code" | "doc_type" | "parent_key">;
export type ParentRefusal = "wiTarget" | "sameParent";
export type ParentDrop =
  | { kind: "move"; parentKey: string; parentCode: string }
  | { kind: "refused"; reason: ParentRefusal }
  | { kind: "none" };                                     // 자기 줄 · 줄이 아닌 곳
export const PARENT_REFUSAL_KEYS: Readonly<Record<ParentRefusal, string>>;   // wiTarget "tobe.drag.wiTarget" · sameParent "tobe.drag.sameParent"
/** 끄는 WI를 포인터 아래 줄에 놓으면 - 먼저 걸리는 것: 줄 없음·자기 줄 → none, WI 줄 → wiTarget, 지금 부모 → sameParent, 그 밖의 SOP → move */
export function resolveParentDrop(source: DropDoc, target: DropDoc | null): ParentDrop;
/** 이 WI 줄을 끌 수 있는가 - 고칠 수 있고, 줄 쓰기가 돌지 않고, 지금 부모가 아닌 SOP가 하나라도 있다 */
export function canDragParent(doc: DropDoc, state: { canEdit: boolean; saving: boolean; sopKeys: readonly string[] }): boolean;
export function buildParentCard(doc: Pick<DraftDoc, "code" | "title">, noTitle: string): DragCard;   // { id: truncateMiddle(code, 14, 8), text: title || noTitle, count: null }
/** 알림의 Undo - 그 줄이 아직 WI이고 부모가 놓았던 SOP(movedTo) 그대로일 때만 */
export function canUndoParentMove(tobe: ToBe, docId: number, movedTo: string): boolean;

// slot-status-model.ts
/** Restore의 Undo - 그 줄이 아직 SOP이고 그 칸에 저장된 N/A가 없을 때만 */
export function canUndoRestore(tobe: ToBe, docId: number, slotKey: string): boolean;
```

- [ ] **Step 1: 실패하는 시험을 쓴다.**

```ts
const sopA = { key: "id-1", code: "SOP-CF", doc_type: "sop" as const, parent_key: null };
const sopB = { key: "id-2", code: "SOP-PH", doc_type: "sop" as const, parent_key: null };
const wi1 = { key: "id-3", code: "WI-01", doc_type: "wi" as const, parent_key: "id-1" };
const wi2 = { key: "id-4", code: "WI-02", doc_type: "wi" as const, parent_key: "id-1" };

describe("resolveParentDrop", () => {
  it("moves a WI under another SOP", () => expect(resolveParentDrop(wi1, sopB)).toEqual({ kind: "move", parentKey: "id-2", parentCode: "SOP-PH" }));
  it("refuses its own parent and any WI, with the reason", () => {
    expect(resolveParentDrop(wi1, sopA)).toEqual({ kind: "refused", reason: "sameParent" });
    expect(resolveParentDrop(wi1, wi2)).toEqual({ kind: "refused", reason: "wiTarget" });
    expect(PARENT_REFUSAL_KEYS).toEqual({ wiTarget: "tobe.drag.wiTarget", sameParent: "tobe.drag.sameParent" });
  });
  it("is silent on itself and off the rows", () => {
    expect(resolveParentDrop(wi1, wi1)).toEqual({ kind: "none" });
    expect(resolveParentDrop(wi1, null)).toEqual({ kind: "none" });
  });
  it("lets a WI without a parent land on any SOP", () => expect(resolveParentDrop({ ...wi1, parent_key: null }, sopA)).toEqual({ kind: "move", parentKey: "id-1", parentCode: "SOP-CF" }));
});

describe("canDragParent", () => {
  const on = { canEdit: true, saving: false, sopKeys: ["id-1", "id-2"] };
  it("needs an SOP other than the current parent", () => {
    expect(canDragParent(wi1, on)).toBe(true);
    expect(canDragParent(wi1, { ...on, sopKeys: ["id-1"] })).toBe(false);
    expect(canDragParent({ ...wi1, parent_key: null }, { ...on, sopKeys: ["id-1"] })).toBe(true);
  });
  it("is off for a reader, during a save and for an SOP row", () => {
    expect(canDragParent(wi1, { ...on, canEdit: false })).toBe(false);
    expect(canDragParent(wi1, { ...on, saving: true })).toBe(false);
    expect(canDragParent(sopA, on)).toBe(false);
  });
});
```

  이어서: `buildParentCard({ code: "WI-01", title: "" }, "No title yet")`가 `{ id: "WI-01", text: "No title yet", count: null }`, 100자 번호의 `id`가 23자(14 + … + 8). `canUndoParentMove`(Review Focus 1): 목록의 줄 3이 `wi` · `parent_code: "SOP-PH"`일 때만 `canUndoParentMove(tobe, 3, "SOP-PH") === true`, 부모가 `"SOP-CF"`로 바뀌었거나 · 줄이 없거나 · `sop`가 됐으면 `false`. `canUndoRestore`: 줄 1이 `sop`이고 `na_slots`에 (그 번호, `"scope"`)가 없을 때만 `true`, 다시 N/A가 됐거나 · 줄이 없거나 · `wi`면 `false`, 상위 칸만 N/A인 하위 칸은 `true`.
- [ ] **Step 2: 실패를 본다** — `cd frontend && npx vitest run src/lib/parent-drop-model.test.ts src/lib/slot-status-model.test.ts` → 새 시험 FAIL, 기존 PASS.
- [ ] **Step 3: 모델을 쓴다.**
- [ ] **Step 4: 초록을 본다** — 위 명령 PASS, `npm run lint && npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: 커밋** — `feat(tobe): add the parent drop model and the undo checks — 상위 SOP 놓기 모델과 되돌리기 판정` (`PROGRESS.md` 포함)

---

### Task 2: 화면 — WI를 SOP에 끌기, 알림의 Undo(상위 SOP · Restore)

**Files:**
- Modify: `frontend/src/components/tobe/tobe-section.tsx`(끌기 설정 · 저장 · Undo · 자리 바꿈), `tobe-row.tsx`(`rowData` · `flipKey`), `frontend/src/app/bundles/[id]/documents/page.tsx`(Old 목록 묶음에 클래스 `docs-old`, 화면 틀 `documents-drop`에 속성 `data-parent-drag-root` — 둘뿐이다)
- Modify: `frontend/src/styles/components.css`(앞 계획의 `.doc-row` 규칙 옆), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(`#tobe-docs` · `#tobe-slots`)
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 둘)

**Interfaces:**
- Consumes: Task 1 전부. 앞 계획의 `DocRow`(`rowData`) · `ToBeRow` · `runWriteResult` · `restoreNa` · `tobe-list` 틀. `useBoxDrag` · `BoxDragConfig` · `findUnderPoint`(`lib/box-drag`), `useFlip` · `flashElement`(`ui/motion`), `showToast(text, tone, { action: { label, run } })`, `getToBe` · `updateToBeDoc` · `setNaSlot`(`api-sop`), `orderDocs`.
- Produces(`tobe-section.tsx` 안):

```ts
/** tobe-list 틀 - 끌기의 root이자 자리 바꿈(useFlip)의 틀 */
const listRef: RefObject<HTMLDivElement | null>;
/** 줄 쓰기 - beforeApply는 응답을 얹기 바로 전에 한 번(자리 재기) */
async function runWriteResult(write: () => Promise<ToBe>, options?: { beforeApply?: () => void }): Promise<{ ok: true } | { ok: false; error: unknown }>;
/** 놓아서 상위 SOP 바꾸기 - 바로 저장하고 Undo가 든 알림을 띄운다. saving이면 버린다 */
async function moveParent(doc: DraftDoc, parent: DraftDoc): Promise<void>;
async function undoParentMove(docId: number, wiCode: string, movedTo: string, previous: string): Promise<void>;
async function undoRestore(docId: number, slotKey: SlotKey, reason: string): Promise<void>;
```

  - 줄의 속성(`ToBeRow`가 `DocRow`에 넘긴다): 모든 New 줄에 `rowData`로 `data-doc={doc.key}`, `flipKey={doc.key}`(바깥 상자에 달려 펼친 곳이 함께 움직인다), `canDragParent`가 참인 WI 줄에만 `rowData`의 `data-drag-box=""`.
  - 새 문구(en / ko):
    - `tobe.drag.parent`: "Parent SOP: {code}" / "상위 SOP: {code}"
    - `tobe.drag.wiTarget`: "A WI cannot be a parent" / "WI는 상위 문서가 될 수 없습니다"
    - `tobe.drag.sameParent`: "Already under this SOP" / "이미 이 SOP 아래에 있습니다"
    - `tobe.drag.moved`: "{wi} moved under {sop}" / "{wi}를 {sop} 아래로 옮겼습니다"
    - `tobe.undoStale`: "The list changed after that. Nothing was undone." / "그 뒤에 목록이 바뀌어 되돌리지 않았습니다."
    - Undo 단추는 `common.undo`(있는 키).

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 둘 다 앞 계획의 `new documents:` 단계들 뒤.

  **단계 A** `new documents: drag a WI onto another SOP to change its parent, Undo on the toast puts it back`(`halfBundleId`, `allowConsoleErrors: true`). 준비: 줄에 `data-drag-box`가 하나도 없는지 먼저 본다(SOP가 하나뿐이다). API로 둘째 SOP를 더한다(`POST …/tobe/docs` `{ code: "SOP-DRAG", doc_type: "sop" }`) → 다시 읽는다. 쓴 파일이 없는 WI 둘 W · X(부모 `SOP-CF`)를 잡는다. `installCommitCounter`, `/tobe/docs/`로 가는 `PATCH`와 `/na/`로 가는 요청을 모두 적는다(주소 · 본문). 끝에 W · X의 부모를 API로 확인하고(`SOP-CF`) `SOP-DRAG`를 지운다.
  1. **끌 수 있는 줄**: WI 줄마다 `data-drag-box`가 있고 SOP 줄과 Old 줄에는 없다. W에 올리면 `box-shadow`가 `none`이 아니고(들림) SOP 줄은 `none`이다.
  2. **누르고 바로 떼면 펼친다**: W의 제목 글에서 누르고 움직이지 않은 채 뗀다 → W의 `-panel`이 보이고 `drag-card`가 0개. 다시 눌러 닫는다.
  3. **끄는 동안**(W → `SOP-DRAG` 줄): `drag-card`의 메모가 "Parent SOP: SOP-DRAG", 그 줄에 `data-drop="over"`, W에 `data-drag-src`, `documents-drop`에 `data-parent-drag`. 다른 WI 줄과 Old 목록 묶음의 `opacity`가 1보다 작고 SOP 줄은 1이다. 올린 줄의 `-acts` · `-more`가 `opacity` 0이다. 줄들 위를 30걸음 지나는 동안 `window.__commits`가 늘지 않는다.
  4. **못 놓는 곳은 이유를 말한다**: X(WI) 위 → `drag-card[data-refused]`, 메모 "A WI cannot be a parent", X에 `data-drop="refused"`. `SOP-CF`(지금 부모) 위 → "Already under this SOP", `data-drop="refused"`. 자기 줄 · Old 줄 · 펼쳐 둔 `SOP-CF`의 `-panel` · 등록 칸 · 빈 곳 위 → `[data-drop]`이 0개이고 메모가 감춰져 있다.
  5. **놓이지 않는 것**: `SOP-DRAG` 위에서 `Escape` → 표와 `[data-drop]` · `[data-parent-drag]` · `[data-drag-src]`가 없고 `PATCH` 0건. X 위에 놓기 · 빈 곳에 놓기도 `PATCH` 0건.
  6. **놓는다**: `PATCH …/tobe/docs/{W}`가 정확히 1건, 본문이 `{"parent_code":"SOP-DRAG"}`, 200. W의 줄이 DOM에서 `SOP-DRAG` 줄 바로 다음이고 `data-child`와 `data-flash`가 있다. W의 `-panel`이 0개다(끌기 뒤의 누름이 삼켜져 펼쳐지지 않는다 — G5). `toast-ok`의 글이 "WI-… moved under SOP-DRAG"(W의 번호)이고 `[data-testid^="toast-action-"]`이 1개, 글 "Undo". `page.reload()` 뒤에도 API의 부모가 `SOP-DRAG`다.
  7. **글쇠로 Undo**: 다시 끌어 놓은 뒤 그 단추에 포커스를 주고 <kbd>↵</kbd> → `PATCH` 본문 `{"parent_code":"SOP-CF"}`, API의 부모가 `SOP-CF`, 알림 "… moved under SOP-CF"(단추 없음).
  8. **같은 일을 하는 길**(G12): W를 펼쳐 `-parent`에서 `SOP-DRAG`를 고르면 API의 부모가 바뀐다. 되돌린다.
  9. **Alt는 글자**: <kbd>Alt</kbd>를 누른 채 W의 제목 위를 끌면 `drag-card`가 0개이고 `getSelection().toString()`이 비어 있지 않다. 선택을 지운다.
  10. **열린 메뉴는 바깥 누름으로 닫힌다**(G2): `tobe-more`의 메뉴를 열고 W 줄을 누르면 `tobe-more-menu`가 사라진다.
  11. **그사이 바뀐 뒤의 Undo**(Review Focus 1): W → `SOP-DRAG`로 놓은 뒤 API로 W의 부모를 `SOP-CF`로 바꾼다. **Undo** → 화면에서 나간 `PATCH`가 늘지 않고 `toast-info`의 글이 "The list changed after that. Nothing was undone.".
  12. **잇달아 둘, 다른 화면에서**(Review Focus 2): W → `SOP-DRAG`, 그 저장이 끝나면 X → `SOP-DRAG` → `[data-testid^="toast-action-"]`이 2개. 레일의 `stage-nav-outputs`를 눌러 Outputs로 간 뒤 먼저 뜬 알림의 **Undo** → API에서 W만 `SOP-CF`로 돌아가고 X는 그대로, `pageerror`가 없다. Documents로 돌아와 X를 API로 되돌린다.
  13. **저장이 도는 사이**(Review Focus 3): `page.route`로 그 `PATCH`를 1.5초 늦춘다. W를 `SOP-DRAG`에 놓고 응답 전에 X를 끌려 하면 `drag-card`가 0개다(줄에 `data-drag-box`가 없다). 응답 뒤에는 다시 끌린다. `page.unroute`, API로 되돌린다.
  14. **Restore의 Undo**: `SOP-CF`를 펼쳐 시드의 N/A 칸(`procedures.troubleshooting`, 사유 R)의 `-restore` → 알림 "Restored 6.3 Troubleshooting"에 **Undo**. 누르면 `PUT …/na/procedures.troubleshooting`의 본문 `reason`이 R이고 API의 `na_slots`에 그 사유로 돌아와 있다.

  **단계 B** `new documents: nothing drags on a read-only bundle`(`devUser: "qa.lead"`, 검토 대기 묶음): `tobe-list`에 `[data-drag-box]`가 0개, WI 줄을 누른 채 40px 움직여도 `drag-card`가 0개이고 `PATCH` 0건, 떼면 그 줄이 펼쳐진다.
- [ ] **Step 2: 실패를 본다** — 화면을 고치기 전에 갓 시드한 DB에서 전체 스모크를 한 번 돌려 **실패 기준선**을 `PROGRESS.md`에 적는다(Task 6이 견준다). 이어서 `ONLY="new documents:"` → 단계 A만 FAIL(B는 끌기가 아직 없어 통과한다 — 넣은 뒤에도 통과해야 한다).
- [ ] **Step 3: `tobe-section.tsx` — 끄는 동안.** `listRef`를 `tobe-list` 틀에 달고 `useBoxDrag(listRef, 끌 수 있는 줄이 하나라도 있으면 parentDrag 아니면 null)`.
  - `BoxDragConfig<{ key: string }>`. `pick`: 누른 곳의 `.doc-row[data-drag-box]` → `{ key: el.dataset.doc }`. `getCard`: `buildParentCard(doc, t("tobe.row.noTitle"))`. `getScrollers`: `listRef.current?.closest(".overflow-auto, .overflow-y-auto")`(Order와 같은 화면 스크롤 칸).
  - `onStart`: 그 줄에 `data-drag-src`, 화면 틀(`listRef.current.closest("[data-parent-drag-root]")` — `page.tsx`의 `documents-drop` 요소에 `data-parent-drag-root`를 단다)에 `data-parent-drag`. `onEnd`: 둘 다 지운다(취소 때도).
  - `onMove`: `findUnderPoint(point, ".doc-row[data-doc]")`가 `listRef` 안의 줄일 때만 그 줄의 문서로 `resolveParentDrop` → `move`는 `{ state: "ok", note: t("tobe.drag.parent", { code: parentCode }), target: el }`, `refused`는 `{ state: "refused", note: t(PARENT_REFUSAL_KEYS[reason]), target: el }`, 그 밖은 `{ state: "none" }`.
  - `onDrop`: 놓은 자리에서 다시 판단해 `move`면 `void moveParent(doc, parent)`.
- [ ] **Step 4: `tobe-section.tsx` — 놓았을 때와 Undo.**
  - `runWriteResult`에 `options.beforeApply`를 더한다(`setFresh` 바로 앞에서 부른다). 다른 호출은 그대로다.
  - `const flip = useFlip(listRef)`. `moveParent`: `saving`이면 돌아간다 → `runWriteResult(() => updateToBeDoc(bundleId, readDocId(doc.key), { parent_code: parent.code }), { beforeApply: () => flip.capture([doc.key, ...나머지 줄의 키]) })` → 성공이면 강조할 키를 상태에 적고(다음 커밋 뒤 이펙트가 그 줄을 `flashElement`, 창 밖이면 `scrollIntoView({ block: "nearest" })`) 알림을 띄운다: 앞의 부모 번호가 있으면 `showToast(t("tobe.drag.moved", { wi: doc.code, sop: parent.code }), "ok", { action: { label: t("common.undo"), run: () => void parentUndoRef.current(docId, doc.code, parent.code, previousCode) } })`, 없으면(판단 9) 단추 없이.
  - `undoParentMove`: `getToBe(bundleId)`로 다시 읽어 `canUndoParentMove(fresh, docId, movedTo)`가 아니면 `showToast(t("tobe.undoStale"), "info")`만 한다. 맞으면 `updateToBeDoc(bundleId, docId, { parent_code: previous })` → `showToast(t("tobe.drag.moved", { wi: wiCode, sop: previous }))`. 실패는 `humanizeApiError` 알림. 끝에 `reload()`와 `loadBundle(bundleId)`. `saving`으로 막지 않는다(알림의 단추는 한 번뿐이다).
  - `restoreNa`(앞 계획)의 알림에 행동을 단다: `{ action: { label: t("common.undo"), run: () => void naUndoRef.current(docId, row.key, reason) } }` — `reason`은 지우기 전에 읽어 둔 사유. `undoRestore`: `getToBe`로 다시 읽어 `canUndoRestore`가 아니면 `tobe.undoStale` 알림만, 맞으면 `setNaSlot(bundleId, docId, slotKey, reason)`. 실패는 `humanizeApiError` 알림. 끝에 `reload()`와 `loadBundle(bundleId)`.
  - `parentUndoRef` · `naUndoRef`에는 가장 최근의 함수를 이펙트에서 넣는다(`use-box-drag.ts`의 최신 config 미러와 같은 짜임 — 렌더 중에 ref를 쓰지 않는다).
- [ ] **Step 5: CSS**(토큰만).
  - 들림(G9): `@media (hover: hover)`에서 `html:not([data-box-drag]):not([data-box-select]) .doc-row[data-drag-box]:hover { box-shadow: 0 0 0 1px var(--line-2), var(--shadow-1); }`. 움직임 줄이기에서는 전환 없이.
  - 끄는 동안(G10): `html[data-box-drag] .doc-list :is(.doc-acts, .doc-more) { opacity: 0; pointer-events: none; }`, `html[data-box-drag] .doc-list :is(button, a, input, select) { pointer-events: none; }`(줄 상자는 받는다 — 놓을 곳이다). 올림 바탕은 앞 계획의 `:where(html:not([data-box-drag]))` 규칙이 이미 끈다.
  - 흐림: `[data-parent-drag] :is(.docs-old, .doc-row:not([data-kind="sop"]), .doc-panel, .doc-add) { opacity: .35; }`(등록 칸의 폼에 클래스 `doc-add`가 없으면 단다).
  - `data-drop` 테두리(공통 규칙)가 SOP 줄의 바탕 · 나무 선과 겹쳐 읽히지 않는지 화면에서 본다(겹치면 `.doc-row[data-drop]`의 `outline-offset`만 고친다).
- [ ] **Step 6: 문구 · 사용 설명서.** 문구 다섯(en · ko). 설명서 `#tobe-docs`에 "끌어서 상위 SOP 바꾸기" 문단: WI 줄을 잡아 다른 SOP 줄에 놓으면 그 SOP 아래로 옮겨 가고 바로 저장된다는 것(끄는 동안 표에 "Parent SOP: SOP-PH"처럼 적힌다), WI 줄과 지금 부모인 SOP에는 놓이지 않고 이유가 적힌다는 것, 알림의 **Undo** 로 10초 안에 되돌린다는 것(그사이 다른 사람이 그 줄을 바꿨으면 되돌리지 않는다), 같은 일을 펼친 곳의 **Parent SOP** 에서도 한다는 것, 줄의 글자를 긁으려면 <kbd>Alt</kbd>를 누른 채 끈다는 것, 저장하는 동안과 읽기 전용 Bundle에서는 끌리지 않는다는 것. `#tobe-slots`의 **Restore** 문장에 "알림의 **Undo** 로 지우기 전의 사유를 되살린다"를 잇는다. `manual-content.test.ts` 통과.
- [ ] **Step 7: 초록을 본다** — `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, 갓 시드한 DB에서 `ONLY="new documents:"` 전부 PASS(앞 계획의 단계들도 그대로), `next dev`를 내리고 `npm run build` 경고 0. `git diff --stat dev -- backend/`가 비어 있다.
- [ ] **Step 8: 커밋** — `feat(documents): drag a WI row onto an SOP to change its parent, with Undo on the toast — WI 줄을 SOP에 끌어 상위 SOP 바꾸기, 알림의 Undo(Restore 포함)` (`PROGRESS.md` 포함)

---

### Task 3: 화면 — Old 목록 두 줄

**Files:**
- Create: `frontend/src/lib/old-row-model.ts` · Test: `frontend/src/lib/old-row-model.test.ts`
- Create: `frontend/src/components/documents/old-row.tsx`(`OldRow`)
- Modify: `frontend/src/app/bundles/[id]/documents/page.tsx`(`DataList`와 열 정의를 지우고 줄을 그린다), `frontend/src/components/documents/doc-row.tsx`(`expandable` prop 하나), `frontend/src/components/equis/equis-status.tsx`(글자 `span`에 클래스 `equis-text`), `frontend/src/styles/components.css`, `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(`#documents` · `#document-columns` · `#document-equis`)
- Test: `frontend/scripts/pw-smoke-sop.mjs`(허락한 변경 + 새 단계 하나)

**Interfaces:**
- Consumes: 앞 계획의 `DocRow` · `RowAction` · `FileName`과 `.doc-list` · `.doc-row` CSS. `page.tsx`의 `saveField` · `handleEquisRefresh` · `handleDownload` · `setPreviewing` · `setDeleting` · `reading` · `canEdit`. `ClampText`, `CommitInput`, `VersionInput`, `Select`, `LayoutLabel`, `AiSuggestChip`, `EquisStatus` · `EquisLink` · `TitleLock`, `DocStatusPill` · `AuxPill` · `WarningChips` · `WarningCountChip` · `getDocReason`, `getEditOriginalHref`, `LANGUAGE_LAYOUTS`.
- Produces:

```ts
// old-row-model.ts
export function isStrayNew(document: Pick<SopDocument, "side" | "target_doc_id">): boolean;   // side "new"이고 목록 줄이 없다
/** 위 목록의 줄 - Old 문서 먼저(서버 순서), 그 뒤에 줄 없는 New 파일 */
export function listOldRows(documents: readonly SopDocument[]): SopDocument[];
export type OldActionKey = "preview" | "download" | "delete";
/** 줄 끝 단추 - 읽힌 문서는 preview·download, 고칠 수 있으면 끝에 delete */
export function listOldActions(document: Pick<SopDocument, "status">, canEdit: boolean): OldActionKey[];
/** 펼칠 수 있는 줄 - 읽힌 문서만 */
export function canExpandOld(document: Pick<SopDocument, "status">): boolean;
```

```tsx
// old-row.tsx - props는 문서 하나와 page.tsx가 지금 칸마다 넘기던 것(canEdit · isReading · open · onToggle · onSave · onEquisRefresh · onPreview · onDownload · onDelete)
export function OldRow(props: OldRowProps): ReactNode;
```

  - `OldRow`가 `DocRow`에 넘기는 것(`prefix = documents-<id>`, `kind="old"`):
    - `identity`: 번호 `<span className="doc-code" data-testid={`${prefix}-code-text`}>`(없으면 흐린 글 `documents.noNumber`) · 빈 번호의 AI 제안 칩(`-code-ai`, 지금 조건 그대로) · AI가 읽는 중 표시(`-ai-reading`) · 줄 없는 New 파일이면 `<span className="side-tag new" data-testid={`${prefix}-side`}>New</span>`. 그 아래 한 줄: 버전 `<span data-testid={`${prefix}-version-text`}>`(`v` + 값), 읽힌 문서인데 비었으면 `<span className="pill warn">`(`documents.noVersion`)과 EQUIS 제안 칩(`-version-equis`) · AI 제안 칩(`-version-ai`)(지금 조건 그대로 — 누르면 저장).
    - `title`: 읽힌 문서는 `<ClampText tabbable={false}>` 안의 `<a className="inline-link" href={getEditOriginalHref(bundleId, id)} data-testid={`${prefix}-title`}>`(글이 없으면 `documents.noTitle`), 읽지 못한 문서는 같은 `data-testid`의 글자(링크 아님). `TitleLock`(`-title-lock`) · `EquisLink`(`-equis-link`).
    - `meta`: 읽힌 문서면 `<LayoutLabel>`(`<span data-testid={`${prefix}-layout-text`}>`) · `<FileName testId={`${prefix}-file`} />` · `EquisStatus`(`-equis`, 지금 props 그대로).
    - `below`: 읽지 못한 문서의 까닭 `<span className="doc-why" data-testid={`${prefix}-reason`}>`.
    - `state`: 경고가 있으면 `WarningCountChip`(`-warnings`) · 보조 검사가 예외일 때만 `AuxPill`(`-aux`) · `DocStatusPill`(`-status`).
    - `actions`: `listOldActions`의 순서대로 `-preview`(`Eye`, `documents.preview`) · `-download`(`Download`, `documents.download`) · `-delete`(`Trash2`, `documents.deleteShort`, `danger`).
    - `toggleLabel`: `documents.details`. `canExpandOld`가 거짓이면 화살표 단추 없이(그 자리는 비운다) 눌러도 펼쳐지지 않는다 — `DocRow`에 `expandable?: boolean`(기본 `true`)을 더한다.
  - 펼친 곳(`${prefix}-panel`, 라벨 + 값, 읽기 전용이면 값만 글자로): **Doc no.** `CommitInput`(`-code`, `maxLength={100}`, mono) · **Version** `VersionInput`(`-version`) · **Title** `CommitInput`(`-title-input`, `maxLength={500}`, EQUIS가 잠그면 `disabled` + 자물쇠) · **Language layout** `Select`(`-layout`, 폭 178 — 지금의 `LAYOUT_SELECT_WIDTH`) · EQUIS가 있으면 `EquisStatus`(`-panel-equis`, `onRefresh` · `onUseCurrentNumber`) · **Extraction** `DocStatusPill`(`-panel-status`) · **Aux check** `AuxPill`(`-panel-aux`) · **Warnings** `WarningChips`(`-warnings-list`).
  - 목록 틀: `<div className="doc-list docs-old" data-testid="documents-list">`(Task 2의 클래스 `docs-old`를 이 틀로 옮긴다). 머리의 줄 수 `<span className="count" data-testid="documents-old-count">`. `--doc-acts-w: 80px`, `--doc-id-w: 164px`에서 시작.
  - 새 문구(en / ko): `documents.noNumber`: "No number" / "번호 없음" · `documents.noVersion`: "No version" / "버전 없음" · `documents.noTitle`: "No title" / "제목 없음" · `documents.details`: "Details" / "자세히". 지우는 키: `documents.colSide` · `documents.col.trailWithWarnings`. (`documents.colCode` · `colVersion` · `colTitle` · `colLayout` · `colExtraction` · `colAux` · `colWarnings`는 펼친 곳의 라벨과 다른 부품이 쓴다 — 남긴다.)

- [ ] **Step 1: 실패하는 단위 시험을 쓴다**(`old-row-model.test.ts`).

```ts
const doc = (id: number, side: "old" | "new", target: number | null, status = "ready") => ({ id, side, target_doc_id: target, status }) as SopDocument;
it("lists Old documents first, then New files that have no row", () => {
  const rows = listOldRows([doc(1, "new", null), doc(2, "old", null), doc(3, "new", 7), doc(4, "old", null)]);
  expect(rows.map((row) => row.id)).toEqual([2, 4, 1]);
});
it("offers preview and download only for a read document, delete only to an editor", () => {
  expect(listOldActions({ status: "ready" }, true)).toEqual(["preview", "download", "delete"]);
  expect(listOldActions({ status: "ready" }, false)).toEqual(["preview", "download"]);
  expect(listOldActions({ status: "rejected" }, true)).toEqual(["delete"]);
  expect(listOldActions({ status: "failed" }, false)).toEqual([]);
});
it("expands only a read document", () => expect([canExpandOld({ status: "ready" }), canExpandOld({ status: "rejected" })]).toEqual([true, false]));
```

- [ ] **Step 2: 실패하는 스모크를 쓴다.**

  **허락한 변경**: `documents list, inline edit and delete prompt`의 이름을 `documents: Old rows read in two lines, expand to edit, delete prompt`로 바꾸고, 버전 확인들 앞에서 첫 줄을 펼친다(`-toggle`). "aux check label"은 펼친 뒤에 본다. 그 단계에 덧붙이는 확인:
  1. **표가 아니다**: `documents-list` 안에 `table`이 0개, 줄 수가 API의 Old 문서 수(+ 줄 없는 New 파일 수)와 같고 `documents-old-count`의 글이 그 수다. 닫힌 줄에 `input` · `select`가 0개.
  2. **줄의 값**: 첫 줄의 `-code-text`가 API의 `doc_code`, `-version-text`가 `v` + `doc_version`, `-layout-text`가 그 배치의 이름(예 "KO/EN interleaved"), `-file`의 글이 파일 이름의 머리와 확장자를 담는다.
  3. **펼치기**: 줄의 딸린 정보 글을 누르면 `-panel`이 보이고 `-toggle`의 `aria-label`이 "Details", `aria-expanded="true"`. 줄에 포커스를 주고 <kbd>Enter</kbd>로도 열고 닫힌다. 버전을 고치면(지금 확인 그대로) 줄의 `-version-text`가 따라 바뀐다.
  4. **제목은 링크다**: `-title`을 누르면 그 문서가 Assign 한 단 보기로 열린다(`assign-old-tag`가 "Old", `assign-new`가 0개). Documents로 돌아온다.
  5. **줄 끝 단추**: 평소 `-acts`의 `opacity` 0, 올리면 1, Tab으로 `-preview`에 가면 1. 줄마다 `-acts`의 오른쪽 끝 x가 ±1px 안이다. 창 폭을 900으로 줄이면 `-more` → `-more-menu`에 `-preview-item` · `-download-item` · `-delete-item`이 있고 `-delete-item`이 지금의 지우기 확인 창을 연다(<kbd>Esc</kbd>로 닫는다 — 지금 확인 그대로). 폭을 되돌린다.
  6. **빈 값과 받지 못한 파일**(Review Focus 4): `page.route("**/api/bundles/*/documents", …)`로 `GET` 응답의 첫 문서를 `doc_code: ""` · `doc_version: ""` · `title: ""`로, 둘째 문서를 `status: "rejected"` · `status_reason: "no_text_layer"`(모르는 값이어도 일반 문구가 나온다)로 바꿔 다시 읽는다. 첫 줄에 "No number" · "No version"(알약) · "No title"이 보이고 줄의 `scrollWidth ≤ clientWidth`. 둘째 줄에 `-toggle`이 0개, `-reason`의 글이 비어 있지 않고, `-acts` 안의 단추가 `-delete` 하나, 끝에 "Rejected" 알약이 있고 눌러도 `-panel`이 생기지 않는다. `page.unroute`.

  **새 단계** `documents: a reviewer reads Old rows, nothing edits`(`devUser: "qa.lead"`, 검토 대기 묶음): 줄이 펼쳐지고 `documents-list` 안에 `input` · `select`가 0개, `-delete`가 0개, `-preview` · `-download`는 있다. `documents-upload`가 0개.
- [ ] **Step 3: 실패를 본다** — `npx vitest run src/lib/old-row-model.test.ts` FAIL, `ONLY="documents:"` → 고친 단계와 새 단계 FAIL.
- [ ] **Step 4: `old-row-model.ts` · `old-row.tsx` · `equis-status.tsx`.** Interfaces대로. `equis-status.tsx`는 글자를 그리는 `span`(둘)에 `equis-text`를 더하는 것뿐이다 — 다른 화면의 모양이 달라지지 않는다.
- [ ] **Step 5: `page.tsx`.** `DataList` · `DataColumn` · 열 정의 · `TRAIL_WRAP_BELOW` · `ACTIONS_WIDTH` · `hostRef`(`useElementWidth`) · `view`를 지우고, `listOldRows(data)`의 줄마다 `<OldRow>`를 그린다. 펼침은 `const [open, setOpen] = useState<Set<number>>(new Set())`. 뼈대는 줄 상자 넷. 화면 틀의 놓기(`documents-drop` · `drop-veil`) · 머리 · 빈 상태 · 창 셋은 그대로다. 칸의 저장은 `saveField(document, change).then(() => true, () => false)`를 `CommitInput`에 넘긴다(판단 16).
- [ ] **Step 6: CSS**(토큰만). `.docs-old`의 `--doc-id-w` · `--doc-acts-w`. 식별 자리는 번호 줄 + 버전 줄(작은 mono, `--ink-3`). `.doc-why`: 빨간 작은 글(`--danger` 계열 토큰), `overflow-wrap: anywhere`. 딸린 정보 줄이 좁을 때: 파일 이름이 먼저 줄고(최소 96px) 그다음 `@container doc-meta (max-width: …)`에서 `.equis-text`를 감춘다(문턱은 Task 6에서 잰다, 시작값 420px). 언어 배치는 줄이지 않는다(`flex: none`). 받지 못한 줄의 화살표 자리는 빈 24px.
- [ ] **Step 7: 문구 · 사용 설명서.** 문구 넷과 지우는 키 둘. 설명서 `#documents`의 "표의 뒤쪽 열" 문단을 지우고 — 목록은 문서마다 두 줄이고(왼쪽에 번호와 버전, 가운데에 제목과 딸린 정보 — 언어 배치 · 파일 이름 · EQUIS 표시, 오른쪽에 상태) 값은 글자로 보이며 **줄을 누르거나 <kbd>Enter</kbd>로 펼치면 고치는 칸이 나온다**고 적는다. `#document-columns`의 열 표를 펼친 곳의 칸 표로 바꾼다(**Doc no.** · **Version** · **Title** · **Language layout** · **Extraction** · **Aux check** · **Warnings** — **Side** 줄은 지우고 "읽지 못한 New 파일은 번호 옆에 New가 붙는다"로). 빈 값은 "No number" · "No version" · "No title"로 보이고 버전이 비면 검토를 요청할 수 없다는 것, 제목을 누르면 그 문서가 **Assign** 의 한 단 보기로 열린다는 것, 줄 끝 단추(**Preview** · **Download** · **Delete**)는 줄에 올리거나 Tab으로 들어가면 보이고 창이 좁으면 **Actions** 메뉴 하나가 같은 일을 한다는 것, 받지 못한 파일은 까닭이 줄 아래에 붙고 지우기만 된다는 것. `#document-equis`: 표시를 누르면 지금처럼 정보가 뜨고 펼친 곳에도 같은 표시가 있다. `manual-content.test.ts` 통과.
- [ ] **Step 8: 초록을 본다** — `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, 갓 시드한 DB에서 `ONLY="documents:,new documents:,old Edit original"` 전부 PASS(고치지 않은 `old Edit original addresses open the document in the one-document view` · `documents: an Old list and a New list, with written files on their rows` 포함), `npm run build` 경고 0.
- [ ] **Step 9: 커밋** — `feat(documents): read the Old list in two-line rows and edit in the expanded row — Old 목록을 두 줄 줄로, 고치기는 펼친 곳에서` (`PROGRESS.md` 포함)

---

### Task 4: 순수 모델 — 올리기 묶음

**Files:**
- Modify: `frontend/src/lib/upload-model.ts` · Test: `frontend/src/lib/upload-model.test.ts`(덧붙인다 — 지금 시험은 건드리지 않는다)

**Interfaces:**
- Consumes: 지금의 `UploadSide` · `readFileCode` · `guessUploadSide` · `planNewUpload`, `TargetDocType`.
- Produces:

```ts
/** 고른 파일 한 줄 - side가 null이면 앱이 고른 쪽을 쓴다(사람이 누르거나 끌거나 묶음에 놓으면 그 값) */
export interface PickedFile { id: string; file: File; side: UploadSide | null; docType: TargetDocType; parentCode: string }
/** 고른 목록에 파일을 더한다 - 이름과 크기가 같은 파일은 다시 더하지 않는다(더하는 파일끼리도). 있던 줄은 그대로다 */
export function addPickedFiles(picked: readonly PickedFile[], files: readonly File[], side: UploadSide | null, makeId: () => string): PickedFile[];
/** 줄이나 파일을 놓은 묶음이 정하는 쪽 - 같은 묶음이거나 묶음 밖이면 null(바뀌지 않는다) */
export function resolveSideDrop(current: UploadSide | null, zone: UploadSide | null): UploadSide | null;
/** 올리는 차례 - Old인 줄의 자리(고른 순서) 다음에 New인 줄의 자리 */
export function listUploadOrder(sides: readonly UploadSide[]): number[];
export function formatFileSize(bytes: number): string;   // 1 MB 미만은 "184 KB"(반올림, 최소 1), 그 이상은 "2.1 MB"
```

- [ ] **Step 1: 실패하는 시험을 쓴다.**

```ts
describe("the picked list of the upload window", () => {
  const file = (name: string, size: number) => new File([new Uint8Array(size)], name);
  const ids = () => { let n = 0; return () => `f${(n += 1)}`; };

  it("adds files, each on the side given or left to the app", () => {
    const picked = addPickedFiles([], [file("a.docx", 1), file("b.docx", 2)], null, ids());
    expect(picked.map((item) => [item.id, item.file.name, item.side, item.docType, item.parentCode])).toEqual([["f1", "a.docx", null, "sop", ""], ["f2", "b.docx", null, "sop", ""]]);
    expect(addPickedFiles(picked, [file("c.docx", 3)], "new", ids()).at(-1)?.side).toBe("new");
  });
  it("does not add a file with the same name and size again, and keeps what was chosen", () => {
    const first = addPickedFiles([], [file("a.docx", 1)], null, ids()).map((item) => ({ ...item, side: "new" as const, docType: "wi" as const, parentCode: "SOP-01" }));
    const next = addPickedFiles(first, [file("a.docx", 1), file("a.docx", 2), file("a.docx", 2)], "old", ids());
    expect(next.map((item) => [item.file.size, item.side, item.docType, item.parentCode])).toEqual([[1, "new", "wi", "SOP-01"], [2, "old", "sop", ""]]);
  });
  it("changes side only on the other group", () => {
    expect([resolveSideDrop("old", "new"), resolveSideDrop("old", "old"), resolveSideDrop("new", null), resolveSideDrop(null, "old")]).toEqual(["new", null, null, "old"]);
  });
  it("uploads the Old group first, each group in picked order", () => expect(listUploadOrder(["new", "old", "old", "new"])).toEqual([1, 2, 0, 3]));
  it("writes a size in KB or MB", () => expect([formatFileSize(0), formatFileSize(188416), formatFileSize(2202010)]).toEqual(["1 KB", "184 KB", "2.1 MB"]));
});
```

- [ ] **Step 2: 실패를 본다** — `npx vitest run src/lib/upload-model.test.ts` → 새 시험 FAIL, 기존 PASS.
- [ ] **Step 3: 넷을 쓴다.**
- [ ] **Step 4: 초록을 본다** — 위 명령 PASS, `npm run lint && npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: 커밋** — `feat(upload): add the picked-list rules for the grouped upload window — 올리기 묶음의 순수 규칙(더하기·쪽·차례·크기)` (`PROGRESS.md` 포함)

---

### Task 5: 화면 — 올리기 창(두 묶음 · 줄 끌기 · 창 안 파일 놓기 · 제자리 결과)

**Files:**
- Modify: `frontend/src/components/documents/upload-modal.tsx`(다시 쓴다 — props는 그대로), `frontend/src/styles/components.css`(`.upload-picked` · `.upload-row` 규칙 자리), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(`#upload` · `#upload-rejected` · `#tobe-written`)
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 둘)

**Interfaces:**
- Consumes: Task 4 전부, 앞 계획의 `FileName`. `useBoxDrag` · `BoxDragConfig` · `findUnderPoint`, `genId`(`lib/id`), 지금의 `planNewUpload` · `guessUploadSide` · `readFileCode` · `uploadDocument` · `updateDocument` · `getToBe`, `Modal`, `Select`, `InlineText`, `VersionInput`, `AiSuggestChip`, `DocStatusPill` · `getDocReason`.
- Produces: `UploadModal`(props 그대로 — `bundleId` · `initialFiles` · `onClose` · `onUploaded` · `latest`).
  - DOM(고정 — 스모크가 기댄다):
    - 맨 위: 숨은 `<input data-testid="upload-files">`(고르면 **더한다**) · `upload-pick` 단추 · 그 옆 글 `upload.dropHint`.
    - 묶음 영역 `<div className="upload-groups" data-testid={올리기 전이면 "upload-picked" 아니면 "upload-results"}>`(높이 상한과 안쪽 스크롤) 안에 묶음 둘 `<section className="upload-group" data-upload-zone={side} data-testid={`upload-group-${side}`}>`: 머리(이름 `documents.oldTitle` | `documents.tobeTitle` · 수 `upload-group-${side}-count` · 한 줄 설명), 줄들, 줄이 없으면 `<p className="upload-empty" data-testid={`upload-group-${side}-empty`}>`.
    - 줄 `<div className="upload-item" data-index={i} data-testid={올리기 전이면 `upload-picked-${i}` 아니면 `upload-row-${i}`}>`, 올리기 전에만 `data-drag-box`. 윗줄: 파일 아이콘 · `<FileName>` · 크기 `<span data-testid={`upload-size-${i}`}>`. 아랫줄: 올리기 전에는 올리면 생기는 일 `<span data-testid={`upload-note-${i}`}>`, 올리는 국면에는 상태 `<span data-testid={`upload-row-${i}-state`} data-state="waiting|uploading|done|error">`. 오른쪽(올리기 전에만): **Old | New** `upload-side-${i}-old|new`(지금 그대로) · 빼기 `upload-remove-${i}`.
    - 아랫줄의 내용(올리기 전): Old이고 번호가 있으면 `upload.oldAdds`, 번호가 없으면 알약 `upload.noNumber` + `upload.setLater`. New이고 붙으면 `upload.attachNote`(지금 키), 새로 생기면 `upload.creates` + 종류 `Select`(`upload-kind-${i}`) + 번호(mono) + WI면 `upload.under` + 상위 SOP `Select`(`upload-parent-${i}`) — 번호가 없으면 `upload.createNoCode`(지금 키) + 종류(+ 상위 SOP), 붙일 수 없으면 빨간 까닭(지금 키 셋).
    - 아랫줄의 내용(올리는 국면): 기다림 `documents.waiting`(흐린 글) · 읽는 중 도는 표시 + `documents.reading` · 읽힌 Old는 그 자리에서 고치는 세 칸(지금 결과 표의 칸 그대로 — `upload-row-${i}-code` · `-version` · `-layout`, 출처 표, AI 제안 칩 `-code-ai` · `-version-ai`) · 읽힌 New는 붙은 줄의 번호 `upload-row-${i}-listed` · 받지 못함은 `DocStatusPill` + 빨간 까닭 · 요청 실패는 빨간 글(`humanizeApiError`).
    - 아래 단추는 지금 그대로(`upload-cancel` · `upload-submit` / `upload-done` · `upload-go-assign`).
  - 새 문구(en / ko):
    - `upload.dropHint`: "or drop files anywhere in this window · DOCX · text PDF" / "이 창 아무 데나 파일을 놓아도 됩니다 · DOCX · 텍스트 PDF"
    - `upload.group.oldLead`: "What you have now" / "지금 있는 문서" · `upload.group.newLead`: "Already written SOPs and WIs" / "이미 쓴 SOP와 WI"
    - `upload.group.oldEmpty`: "Drop a file here to make it an Old document" / "여기에 놓으면 Old 문서가 됩니다" · `upload.group.newEmpty`: "Drop a file here to make it a New document" / "여기에 놓으면 New 문서가 됩니다"
    - `upload.oldAdds`: "Adds {code} to Old documents" / "Old documents에 {code}를 더합니다"
    - `upload.noNumber`: "No number in the file name" / "파일 이름에 번호 없음" · `upload.setLater`: "Set it after it is read" / "읽힌 뒤에 정합니다"
    - `upload.creates`: "Creates" / "새 줄" · `upload.under`: "under" / "상위"
    - `upload.drag.old`: "Side: Old" / "쪽: Old" · `upload.drag.new`: "Side: New" / "쪽: New"
    - 지우는 키: `documents.pickHint` · `upload.oldNote` · `upload.createNote` · `documents.file`.

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 둘 다 `documents: one upload window takes Old and New files` 바로 뒤. 그 단계처럼 `devUser: "dev.admin"`으로 새 묶음을 만들고 New 목록에 `SOP-01`과 그 아래 `WI-05`를 API로 넣는다. 파일은 그 단계가 쓰는 합성 표본(`SYNTHETIC_OLD-6_…docx` · `SYNTHETIC_WI-05_…docx` · `SYNTHETIC_WI-04_…docx`)과 스크립트가 만든 것(`setInputFiles`의 `{ name, mimeType, buffer }`).

  **단계 A** `documents: the upload window sorts files into Old and New groups, a row drags between them, files drop in`. `POST …/documents` 요청 수를 센다(이 단계는 올리지 않는다 — 끝까지 0).
  1. **두 묶음**: 표본 셋과 `SYNTHETIC_notes.docx`(번호 없음)를 고르면 줄 0 · 2 · 3이 `upload-group-old` 안, 줄 1이 `upload-group-new` 안이고 수가 "3" · "1"이다. `upload-note-0`이 "Adds OLD-6 to Old documents", `upload-note-1`이 "WI-05"를 담고, `upload-note-3`이 "No number in the file name"과 "Set it after it is read"를 담는다. `upload-size-0`이 `KB`나 `MB`로 끝난다.
  2. **고르기는 더한다**: 다시 `upload-files`로 표본 하나(이미 있는 것)와 새 파일 하나를 고르면 줄이 5개다(같은 파일은 늘지 않는다 — Review Focus 5). 앞 줄들의 쪽이 그대로다.
  3. **줄을 끌어 묶음을 바꾼다**: 줄 2(`WI-04`, Old)를 New 묶음 위로 → `drag-card`의 메모가 "Side: New", `upload-group-new`에 `data-drop="over"`. 제 묶음 위에서는 `[data-drop]`이 0개이고 메모가 감춰져 있다. 놓으면 줄 2가 `upload-group-new` 안에 있고 `upload-side-2-new`의 `aria-pressed="true"`, `upload-note-2`가 "Creates"로 시작한다. 줄 안의 **Old | New** 단추나 고르기 칸에서 누른 채 움직이면 `drag-card`가 생기지 않는다(G4).
  4. **Esc는 끌기만 취소한다**: 줄 0을 끌다가 `Escape` → `drag-card`가 없고 창(`upload`)이 그대로 열려 있으며 줄 0이 Old 묶음에 있다.
  5. **단추도 같은 결과다**(G12): `upload-side-2-old` → 줄 2가 Old 묶음, `upload-note-2`가 "Adds WI-04 to Old documents". 다시 `upload-side-2-new`.
  6. **올리기 단추가 꺼지는 때**: 줄 2의 종류를 WI로 하면 상위 SOP를 고르기 전까지 `upload-submit`이 꺼져 있다(지금 규칙). 고르면 켜진다. 줄 2를 Old 묶음으로 끌어 놓아도 켜져 있다.
  7. **붙일 수 없는 쪽**: `page.route`로 `GET …/tobe` 응답의 `WI-05`를 `entrance: "match"` · `document_id: 9`로 바꾸고 창을 다시 연다(같은 파일 넷). 줄 1(New)의 `upload-note-1`이 빨간 글로 "already has a written file"을 담고 `upload-submit`이 꺼져 있다. 줄 1을 Old 묶음에 끌어 놓으면 켜진다. `page.unroute`.
  8. **창 안에 파일을 놓는다**: `DataTransfer`에 `dropped-new.docx`를 담아 `upload-group-new`에 `dragover` → 그 묶음에 `data-drop="over"`, `drop` → 새 줄이 New 묶음에 생기고 그 줄의 `-new` 단추가 눌려 있다. 창의 제목 줄에 `dropped-any.docx`를 놓으면 줄이 생기고 앱이 고른 쪽(Old)이다. 같은 파일을 다시 놓아도 줄 수가 그대로다. 주소가 바뀌지 않는다(브라우저가 파일을 열지 않았다).
  9. **많은 파일**: 스크립트가 만든 파일 30개를 더하면 묶음 영역의 `scrollHeight > clientHeight`이고 `upload-submit`의 아래 끝이 창(뷰포트) 안이다. `upload-cancel`.

  **단계 B** `documents: uploading keeps each row in its group and shows Waiting, Reading and the result`(`allowConsoleErrors: true`). 파일: `SYNTHETIC_OLD-6_…docx`(Old) · `SYNTHETIC_WI-05_…docx`(New, 붙는다) · 스크립트가 만든 `SYNTHETIC_broken.docx`(내용이 docx가 아니다 — Old). `page.route`로 `POST …/documents`를 1.2초씩 늦춘다.
  1. **올리는 동안**: `upload-submit` → 틀의 `data-testid`가 `upload-results`, 줄이 `upload-row-<i>`로 제 묶음 안에 그대로 있고 `[data-drag-box]` · `upload-side-…` · `upload-remove-…`가 0개. 첫째로 올라가는 줄의 `-state`가 `data-state="uploading"`이고 글 "Reading", 나머지가 `waiting` · "Waiting". `upload-done`이 꺼져 있고 창이 닫히지 않는다(<kbd>Esc</kbd>를 눌러도 `upload`가 남는다).
  2. **차례**: 줄이 `uploading`이 되는 순서가 Old 묶음의 위에서 아래(줄 0 · 2), 그다음 New 묶음(줄 1)이다.
  3. **끝난 뒤**: 줄 0에 `upload-row-0-code` · `-version` · `-layout`이 있고(그 자리에서 고친다) 번호가 "OLD-6", 줄 1의 `upload-row-1-listed`가 "WI-05", 줄 2는 `data-state="done"`에 "Rejected"(또는 "Failed") 알약과 빈 글이 아닌 빨간 까닭이 있고 여전히 Old 묶음 안이다(Review Focus 5). `upload-done`이 켜지고 `upload-go-assign`이 있다. 줄 0의 버전을 고치면 저장된다(API의 `doc_version`).
  4. **닫은 뒤**: `upload-done` → Old 목록에 `OLD-6` 줄과 받지 못한 파일의 줄(까닭 `-reason`)이 있고, New 목록의 `WI-05` 줄에 파일 이름이 붙어 있다.
- [ ] **Step 2: 실패를 본다** — `ONLY="documents:"` → 새 단계 둘만 FAIL(고치지 않은 `documents: one upload window takes Old and New files`는 PASS).
- [ ] **Step 3: `upload-modal.tsx` — 고르는 국면.**
  - 상태: `picked: PickedFile[]`(처음 값 `addPickedFiles([], initialFiles, null, genId)`), 줄의 계획 계산(`plans`)과 `canSubmit`은 지금 그대로. 묶음은 `plans[i].side`로 걸러 그린다(자리 `i`는 `picked`의 자리).
  - 고르기: `setPicked((prev) => addPickedFiles(prev, [...files], null, genId))` 뒤 `event.target.value = ""`.
  - 줄 끌기: 묶음 영역의 ref에 `useBoxDrag(ref, 올리기 전이면 sideDrag 아니면 null)`. `pick`: `.upload-item[data-drag-box]` → `{ index }`. `getCard`: `{ id: t(`upload.side.${지금 쪽}`), text: 파일 이름, count: null }`(ID 자리에 지금 쪽 "Old" | "New"). `getScrollers`: 묶음 영역 하나. `onMove`: `findUnderPoint(point, "[data-upload-zone]")` → `resolveSideDrop(plans[index].side, zone)`가 `null`이 아니면 `{ state: "ok", note: t(`upload.drag.${side}`), target: 그 묶음 }`, 아니면 `{ state: "none" }`. `onDrop`: 그 쪽으로 `patchPicked(index, { side })`. 거절은 없다.
  - 창 안 파일 놓기(판단 19 · 20): 올리기 전인 동안만 `window`에 `dragover` · `dragleave` · `drop`을 건다(이펙트, 최신 상태는 `useEffectEvent`). `dataTransfer.types`에 `"Files"`가 있을 때만 `preventDefault`. `dragover`마다 포인터 아래 `[data-upload-zone]`에 `data-drop="over"`를 달고 앞의 것을 지운다(DOM만). `drop`: 표시를 지우고 `addPickedFiles(prev, files, zone ?? null, genId)`.
- [ ] **Step 4: `upload-modal.tsx` — 올리는 국면.** 결과는 `picked`와 같은 자리의 배열(`UploadRow[]`, 지금 모양)로 든다. `handleUpload`는 `listUploadOrder(plans.map((plan) => plan.side))`의 차례로 하나씩 올린다(나머지는 지금 그대로 — 붙는 줄에는 종류 · 상위 SOP를 보내지 않는다). 줄은 같은 부품이 `rows[i]`의 상태로 아랫줄만 바꿔 그린다. `saveRow`와 출처 표는 지금 그대로다.
- [ ] **Step 5: CSS**(토큰만). `.upload-groups`: `display: grid; gap: 12px; max-height: min(560px, calc(100vh - 340px)); overflow-y: auto`. `.upload-group`: 테두리 · 둥근 모서리, 머리는 `--sunken` 바탕, 수는 작은 알약. `.upload-item`: `grid-template-columns: minmax(0, 1fr) auto auto; gap: 2px 10px; padding: 8px 12px`, 윗줄과 아랫줄이 첫 열에 쌓이고 **Old | New** 와 빼기가 두 줄에 걸친다. 창이 좁으면(`@container`, 문턱은 Task 6에서 잰다) **Old | New** 가 셋째 줄로 내려간다. `.upload-empty`: 점선 테두리의 흐린 글. 끌 수 있는 줄의 들림은 Task 2의 규칙을 `.upload-item[data-drag-box]`에도 건다. 창 틀의 파일 놓기 표시(점선 테두리)는 속성 하나로. 지금의 `.upload-picked` · `.upload-picked-row` · `.upload-results` · `.upload-row` 규칙을 지운다.
- [ ] **Step 6: 문구 · 사용 설명서.** 문구 열둘과 지우는 키 넷. 설명서 `#upload`의 순서를 새 창에 맞춘다 — **Choose files** 로 고르거나 창 아무 데나 파일을 놓는다(고를 때마다 더해지고 같은 파일은 한 번만), 파일은 **Old documents** 와 **New documents** 두 묶음으로 나뉘어 보이고 줄마다 올리면 생기는 일이 적힌다("Adds OLD-7 to Old documents" · "Attaches to WI-08 on the New list." · **Creates** 와 종류 · 상위 SOP 고르기), 쪽은 **Old** · **New** 단추로 바꾸거나 줄을 끌어 다른 묶음에 놓거나 파일을 묶음 위에 바로 놓아 정한다, 올리는 동안 줄이 제자리에서 **Waiting** → **Reading** → 결과로 바뀌고 Old 파일은 그 자리에서 번호 · 버전 · 언어 배치를 고친다. `#upload-rejected`: 받지 못한 파일은 까닭과 함께 창의 제 묶음에 남고, 닫으면 Old 목록의 그 줄 아래에 까닭이 붙는다. `#tobe-written`의 "그 창에서 파일을 **New** 로 두면 됩니다"에 "(또는 New 묶음에 놓습니다)"를 잇는다. `manual-content.test.ts` 통과.
- [ ] **Step 7: 초록을 본다** — `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, 갓 시드한 DB에서 `ONLY="documents:"` 전부 PASS, `npm run build` 경고 0.
- [ ] **Step 8: 커밋** — `feat(upload): group picked files by side, drag rows between groups and drop files into the window — 올리기 창을 Old·New 묶음으로, 줄 끌기와 창 안 파일 놓기` (`PROGRESS.md` 포함)

---

### Task 6: 극단 자료 · 좁은 창 검토와 올리기 준비

**Files:**
- Modify(필요할 때만): Task 2 · 3 · 5의 CSS와 부품
- Modify: `frontend/scripts/pw-layout-audit.mjs`(`C7b` · `C10a`~`C10e`) · `pw-overlap-audit.mjs`(`mbtnScenes`의 `documents`) · `pw-contrast-audit.mjs`(장면 둘 더)
- Modify: `frontend/package.json` · `package-lock.json`, `CHANGELOG.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-11-17-documents-screen-design.md`, `docs/README.md`, `docs/lessons/ui-review.md`(13번), `frontend/docs/design/2026-11-07-frontend-design-foundations.md`(§11), `frontend/CLAUDE.md`

**Interfaces:**
- Consumes: Task 1~5.
- Produces: `dev`에 합칠 수 있는 브랜치(푸시 · 합치기는 조율하는 세션이 한다).

- [ ] **Step 1: 극단 자료로 다시 시드한다**(`seed_sop_demo` → `seed_sop_worst`, 버려도 되는 DB). W1 묶음에서 창 폭 1120과 2560, 라이트 · 다크, en · ko로 스크립트(`playwright-core` + 시스템 Chrome)가 잰다. 눈으로만 보지 않는다. **처방은 `page.addStyleTag`로 주입해 전 · 후를 잰 뒤 값을 정하고**, 겹치면 고친다(보고만 하지 않는다).
  - **Old 줄**(W1의 문서 — 이름 246자 · 255자 파일, 거절된 docx, 큰 문서. 100자 번호와 480자 · 공백 없는 435자 · 빈 제목은 응답을 바꿔 그린다): 모든 줄의 `scrollWidth ≤ clientWidth`, 제목 두 줄 이하, 번호 두 줄 이하, 딸린 정보 줄 한 줄. 255자 파일 이름이 머리에서 줄고 확장자가 보이며 폭이 96px 아래로 내려가지 않는다. EQUIS 표시가 글자를 감추는 문턱을 정한다(응답에 EQUIS 표시를 넣어 그린다 — en · ko). 언어 배치("KO/EN interleaved")가 잘리지 않는다. 올린 줄의 단추 묶음이 글과 겹치는 px 0, 단추 자리의 오른쪽 끝이 줄마다 같다(±1px, 받지 못한 줄도). 식별 자리 폭(`--doc-id-w`)에 14자 번호가 한 줄로 들어간다.
  - **끌기**(New 줄 52개): WI를 잡고 포인터를 화면 스크롤 칸의 아래 가장자리에 두면 그 칸의 `scrollTop`이 늘고(스스로 스크롤) 놓을 자리 표시가 포인터 밑의 줄을 따라간다. 100자 번호 · 480자 제목의 WI를 끌 때 `drag-card`의 높이가 한 줄(≤ 34px)이고, 가장 긴 메모(en · ko)에서 표가 1120 창 밖으로 나가지 않는다. 줄들 위를 40걸음 지나는 동안 `window.__commits` 증가 0. 놓은 뒤 옮긴 줄이 화면 안에 있다.
  - **알림**: 100자 번호 둘이 든 "… moved under …" 알림(폭 380)에서 글 · **Undo** · 닫기 단추가 서로 덮지 않고(겹치는 px 0) 창 밖으로 나가지 않는다(en · ko).
  - **올리기 창**: 255자 파일 이름이 윗줄에서 머리가 줄고 확장자가 보인다. 30개에서 묶음 영역만 스크롤하고 아래 단추가 늘 보인다(1120 × 800 창). 줄을 끌어 영역의 아래 가장자리에 두면 그 영역이 스스로 스크롤한다. 창이 좁을 때 **Old | New** 가 내려가는 문턱을 정한다 — 가장 긴 아랫줄(en · ko: 번호 없는 New 파일 + 종류 WI + 상위 SOP 100자 번호)이 줄 밖으로 나가지 않는다. 올리는 국면의 세 칸(번호 · 버전 · 언어 배치 + 출처 표 + AI 제안 칩)이 한 줄에 못 들어가면 감긴다(겹치지 않는다).
  - **2560**: 본문 상한(1600) 안에서 Old 줄의 빈 자리가 한쪽으로 몰리지 않는다(제목 상자가 남는 폭을 받는다).
  - **다크 테마 · 대비**: 흐림(0.35) 속의 SOP 줄이 또렷하고, "No number" · "No title" · 받지 못한 까닭 · 묶음의 빈 자리 글의 대비를 `pw-contrast-audit.mjs`의 계산 방식으로 잰다(모자라면 토큰을 한 단 진하게).
  - 움직임 줄이기에서 자리 바꿈 없이 강조만 보이고 들림의 전환이 없다.
- [ ] **Step 2: 감사 스크립트를 새 화면에 맞춘다**(허락한 변경 — 위 표의 기대대로). `C7b` · `C10a` · `C10b` · `C10c` · `C10d`를 줄 상자의 선택자로 고치고 `C10e`를 뺀다. `pw-overlap-audit.mjs`의 `documents` 장면을 바꾼다. `pw-contrast-audit.mjs`에 Old 줄 하나를 펼친 장면과 올리기 창(파일 셋을 고른 고르는 국면) 장면을 더한다.
- [ ] **Step 3: 전체 검증.** `git diff --stat dev -- backend/`가 비어 있다. frontend: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, `npm run build` 경고 0. 갓 시드한 DB(`seed_sop_demo`)에서 전체 스모크(이 계획의 새 단계 다섯과 고친 단계 PASS, 실패가 Task 2 Step 2의 기준선보다 늘지 않음) → 다시 시드(`seed_sop_demo` → `seed_sop_worst`) → `pw-overlap-audit.mjs`, `DS=worst pw-layout-audit.mjs`, `pw-contrast-audit.mjs`.
- [ ] **Step 4: 버전과 기록.** `frontend/package.json`의 지금 버전을 읽고(`dev`의 값 — 앞 계획의 릴리스, 1.1.9일 것이다) `frontend/`에서 `npm version patch --no-git-tag-version`(1.1.10이 될 것이다 — 아래의 `vX.Y.Z`는 그 결과다). `CHANGELOG.md` `## Unreleased (dev)` 아래 `### vX.Y.Z — <이 커밋을 만드는 날>`: WI 줄을 SOP 줄에 끌어 상위 SOP 바꾸기와 알림의 **Undo**, N/A **Restore** 의 **Undo**, Old 목록이 두 줄 줄이 된 것(값은 글자, 고치기는 펼친 곳, 빈 값 표시, 줄 끝 단추는 호버 · 포커스 · 좁으면 **Actions** 메뉴), 올리기 창의 두 묶음 · 줄 끌기 · 창 안 파일 놓기 · 고르기가 더해지는 것 · 올리는 동안 줄이 제자리에 남는 것. 알려진 한계 — 끌기는 한 줄씩이고 터치에서는 고르기 칸 · 단추만 쓴다, 줄 쓰기가 도는 동안과 SOP가 하나뿐일 때는 끌리지 않는다, 그사이 목록이 바뀌면 **Undo** 는 되돌리지 않는다, 부모가 없던 WI를 옮긴 것에는 **Undo** 가 없다, Old 줄에 Unit 수는 없다, 올리기 창에 놓은 문서가 아닌 파일은 올린 뒤에 거절된다. `PROGRESS.md`는 이 브랜치의 항목을 요약 하나로 줄이고 판단 26의 한 줄을 남긴다. 설계 문서: §13의 3 · 4 · 5걸음에 "(vX.Y.Z로 dev에 올렸다.)", §5 · §7 · §9 끝에 "3~5걸음에서 정한 것" 묶음으로 위 "이 계획이 정한 것"과 "설계와 코드가 어긋난 곳"을 "(내 판단)" 한 줄씩, §3의 "알림에는 단추가 없다"를 "Pair view 걸음이 넣은 행동 단추를 쓴다"로. `docs/README.md`의 설계 · 계획 줄 상태(1~5걸음 구현됨). `docs/lessons/ui-review.md` 13번과 디자인 기초 §11의 Documents 문장에서 "(New 목록)" 같은 단서를 떼어 두 목록 모두로 고친다. `frontend/CLAUDE.md`: 끌기 문장에 "Documents의 상위 SOP 놓기는 `lib/parent-drop-model.ts`, 올리기 창의 묶음 규칙은 `lib/upload-model.ts`", 알림 문장의 쓰는 곳에 Documents(상위 SOP · Restore)를 더한다.
- [ ] **Step 5: 커밋** — `chore(release): vX.Y.Z, drag a WI onto its SOP, two-line Old list and the grouped upload window — WI를 SOP에 끌기, Old 목록 두 줄, 올리기 묶음 (vX.Y.Z)`

---

## Self-Review 기록

- **설계 대비**: §7의 끄는 것 · 놓는 곳 표 · 끄는 동안 · 바로 저장 · 응답으로 그리기 · 되돌리기 · 같은 일을 하는 길 · 끌기가 꺼지는 때 · 서버 거절은 Task 1(모델)과 Task 2(스모크 A의 1~13, B). §8의 Restore Undo는 Task 1(`canUndoRestore`)과 Task 2 스모크 14. §5의 자리 표 · Old 표시 빼기 · 제목 링크 · 빈 값 · 받지 못한 파일 · 좁을 때 줄어드는 순서 · 펼친 곳 · "끌기는 없다"는 Task 3(Old 줄에 `data-drag-box`가 없다는 것은 Task 2 스모크 1이 박는다). §9의 고르는 국면(두 묶음 · 두 줄 · 쪽을 정하는 길 넷 · 줄 끌기 · 파일 놓기 · 파일은 더해진다 · 아래 단추)과 올리는 국면(묶음이 남는다 · 차례 · 다섯 상태 · 닫히지 않는다 · 결과 줄의 예외)은 Task 4(모델)와 Task 5(스모크 A · B). §12의 극단 자료 · 감사는 Task 6. G1~G5 · G8은 끌기 층, G6 · G7 · G9~G11은 Task 2 · 5, G12는 Global Constraints와 Task 2 스모크 8 · Task 5 스모크 A의 5, G13은 `canDragParent`와 Task 2 단계 B · Task 3의 검토자 단계.
- **Review Focus의 시험**: 1 → Task 1 `canUndoParentMove` + Task 2 스모크 11. 2 → Task 2 스모크 12. 3 → Task 1 `canDragParent`(saving) + Task 2 스모크 13. 4 → Task 3 스모크 6과 검토자 단계. 5 → Task 4 "does not add a file with the same name and size again…" + Task 5 스모크 A의 2 · 8, B의 3.
- **설계와 다르게 정한 것**은 "이 계획이 정한 것"의 1(부모 없는 WI는 SOP가 하나여도 끌린다) · 13(정상 보조 검사 아이콘은 펼친 곳) · 14(EQUIS 정보는 같은 창을 연다) · 22(ko "새 줄")이고 까닭을 적었다. 서버 변경은 없다.
- **하지 않는 것**: 낙관적으로 먼저 옮기기, 줄 끝 메뉴에 **Parent SOP** 항목, 여러 줄 끌기 · 터치 끌기, 끄는 동안 접힌 줄을 저절로 펴기, Old 줄을 끌 상자로 만들기, Old 줄의 Unit 수, `EquisPopover`를 펼친 곳에 풀어 그리기, `Modal` · `toast` · `box-drag` 고치기, 올리기 창의 파일 종류 검사, 사용 설명서 그림 다시 뽑기.
- **이름 맞춤**: `ParentDrop`(`move` · `refused` · `none`) ↔ `resolveParentDrop` ↔ `moveParent`(`move`만 받는다)가 Task 1 · 2에서 같은 이름이다. `canUndoParentMove` · `canUndoRestore`는 Task 1이 정하고 Task 2의 `undoParentMove` · `undoRestore`가 쓴다. 줄의 `data-doc` · `data-drag-box` · `data-kind`와 바깥 상자의 `data-flip-key`는 앞 계획의 `DocRow`(`rowData` · `kind` · `flipKey`)로 단다. `OldActionKey`의 순서(`preview` · `download` · `delete`)가 `data-testid` 접미와 같다. `PickedFile` · `addPickedFiles` · `resolveSideDrop` · `listUploadOrder` · `formatFileSize`는 Task 4가 정하고 Task 5가 쓴다. 올리기 창의 `<i>`는 처음부터 끝까지 고른 순서의 자리다. 알림은 `showToast(text, tone, { action: { label, run } })`와 `toast-action-<id>`(Pair view 걸음이 정한 것)를 그대로 쓴다.
