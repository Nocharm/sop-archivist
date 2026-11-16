# Documents 화면 1·2걸음 — N/A 칸 상태 표와 New 목록 두 줄 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New 문서 목록의 SOP 줄을 펼치면 칸 15개의 지금 상태(문장 수 · Empty · N/A)가 먼저 보이고 **Mark N/A** · **Edit reason** · **Restore** 로 정하며, New 목록 자체는 값이 글자로 보이는 두 줄 줄(펼치면 고치기)과 칸 상태 막대로 바뀐다.

**Architecture:** 서버는 New 목록 응답(`ToBeViewOut`)에 읽기 전용 값 `slot_counts` 하나를 더한다(질의 하나). 칸의 여섯 상태 · 요약 · 쓴 사유 · 편집기 하나 규칙은 새 순수 모델 `lib/slot-status-model.ts`가, 등록 미리 보기는 `lib/tobe-add-model.ts`가 정한다. 화면은 표(`<table>`)를 줄 상자 목록으로 바꾼다 — 두 목록이 같이 쓸 줄 틀 `components/documents/doc-row.tsx`, New 줄 `components/tobe/tobe-row.tsx`, 펼친 곳 `tobe-panel.tsx`, 칸 상태 표 `slot-table.tsx`. 자료 읽기와 줄 쓰기(`runWrite`)는 `tobe-section.tsx`에 그대로 남는다.

**Tech Stack:** Python 3.11 · FastAPI · SQLAlchemy(async) · pytest / Next.js 16 · React 19 · TypeScript · vitest(jsdom) · Playwright(시스템 Chrome) 스모크. 새 의존성 없음. Alembic 리비전 없음(모델을 바꾸지 않는다).

**Spec:** `docs/superpowers/specs/2026-11-17-documents-screen-design.md` — §2, §3, §4, §6, §8, §10, §11("목록과 줄" · "번호로 더하기" · "N/A 칸 상태 표"), §12, §13의 1·2걸음, §14, §15. 구현 전에 루트 `CLAUDE.md`, 고칠 쪽의 `backend/CLAUDE.md` · `frontend/CLAUDE.md`, `docs/lessons/react-ts-patterns.md` · `browser-verification.md` · `ui-review.md`, 디자인 기초 `frontend/docs/design/2026-11-07-frontend-design-foundations.md` §10 · §11을 읽는다. 3 · 4 · 5걸음은 다음 계획 `docs/superpowers/plans/2026-11-17-documents-lists-upload-plan.md`다 — 이 계획의 줄 틀과 `data-testid`를 그대로 받아 쓴다.

## Global Constraints

- 작업 폴더는 이 작업의 워크트리(`<worktree>`), 브랜치 `feat/documents-na-table`(Pair view 걸음이 합쳐진 `dev`에서 딴다 — `frontend/package.json`의 버전을 먼저 읽는다, 1.1.8일 것이다). 원본 체크아웃(`<original-checkout>`)은 읽기와 venv 실행만 한다. 공개 저장소다 — 추적 파일에 사용자 경로 · 실서버 IP · 시크릿을 쓰지 않는다.
- **서버가 바뀌는 것은 하나다**: `GET /api/bundles/{id}/tobe`와 모든 줄 쓰기 응답(`ToBeViewOut`)에 `slot_counts`를 싣는다. 새 주소 · 새 거절 코드 · Alembic · 권한 · env가 없다. `sentence_counts`는 값도 모양도 글자 하나 달라지지 않는다. 거절은 지금 있는 것 그대로다(409 `slot_has_targets`, 422 `unknown_slot` · `na_on_wi` · `invalid_parent` · `duplicate_code`).
- **N/A는 사람이 사유와 함께 저장할 때만 생긴다**(도메인 규칙 RW02). 화면이나 AI가 빈 칸을 스스로 N/A로 두지 않는다. 사유 편집기는 **Save N/A** · **Cancel**(과 서버의 409 `slot_has_targets`)로만 닫힌다 — 칸을 떠나도, 줄을 접어도 적던 사유는 남는다.
- **지금 할 수 있는 일은 하나도 사라지지 않는다**: 번호 · 제목 · 종류 · 상위 SOP · 장비 SOP 고치기, 쓴 파일의 버전 · 언어 배치 · 미리 보기 · 내려받기 · 지우기, EQUIS 제안 받기와 다시 조회, 단계 더하기 · 빼기 · 이름 고치기, 줄 빼기, 번호로 더하기(여러 줄 붙여 넣기), Excel 템플릿 · 가져오기 · AI 읽기. 펼친 곳에서는 지금처럼 칸마다 바로 저장한다(글 칸은 떠나거나 <kbd>Enter</kbd>, 고르는 칸은 고르는 즉시, <kbd>Esc</kbd>는 적던 것을 버린다). N/A 사유만 예외다.
- **읽기 전용**(검토자, `in_review` · `done` Bundle — 화면의 `canEdit`가 거짓): 줄은 펼쳐지고 값은 글자로만 보인다. 고치는 칸 · 고치는 단추 · 등록 칸이 없다. 쓴 파일의 **Preview** · **Download** 는 남는다.
- **하위 칸이 있는 상위 칸에 직접 놓인 줄에 관한 규칙을 만들지 않는다**(답이 없는 열린 질문이다). 칸 번호는 `SLOT_KEYS`의 고정 자리에서만 읽는다.
- 화면 규칙은 순수 모델에 두고 단위 시험한다. 색 · 그림자는 토큰만(raw hex 금지), 한쪽 막대 강조는 막대 쪽 모서리를 직각으로. 상태를 색만으로 가르지 않는다.
- 새 문구는 `frontend/src/lib/i18n-messages.ts`에 en · ko 한 쌍(`i18n-messages.test.ts`가 키 집합을 가드). 도메인 용어(Bundle · Old · New · Unit) · 상태 표기(**N/A** · **Empty**) · 칸 이름(`SLOT_LABELS`)은 화면 언어와 상관없이 영어다. 문구에 긴 대시를 쓰지 않는다. 쓰지 않게 된 키는 그 태스크에서 en · ko를 함께 지운다.
- 사용 설명서 글(`frontend/public/manual/user-manual.md`)은 화면을 바꾸는 커밋에서 함께 고치고, 화면 라벨은 영어 화면 글자 그대로 **굵게** 적는다(`manual-content.test.ts`). 그림은 뽑지 않는다(그림 줄은 그대로 둔다).
- **남는 `data-testid`는 지금 이름을 지킨다**: `tobe-section` · `tobe-list` · `tobe-saving` · `tobe-more` · `tobe-add-row` · `tobe-add-code` · `tobe-add` · `tobe-empty`, 줄마다(머리 `tobe-id-<줄 id>`) `-row` · `-toggle` · `-code` · `-title` · `-parent` · `-equipment` · `-remove` · `-equis` · `-title-lock` · `-hint-type` · `-hint-equipment` · `-written` · `-not-written` · `-written-detail` · `-written-version` · `-written-layout` · `-written-preview` · `-written-download` · `-written-delete` · `-slots` · `-steps` · `-step-<번호>` · `-remove-step-<번호>` · `-add-step` · `-na-<칸 키>-reason`.
- 기존 시험(pytest · vitest · 스모크 · 감사)의 기대값을 고치지 않는다. 예외는 아래 "허락한 기존 시험 변경"에 이름을 적은 것뿐이다.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. 커밋 전 `PROGRESS.md` 갱신. 푸시 · 태그 · 버전 올리기는 하지 않는다 — 버전은 마지막 태스크에서만 올리고, 푸시는 조율하는 세션이 한다.
- 검증 스택(이 워크트리 전용 포트): backend 8787, frontend 3787. 내 것이 아닌 프로세스는 죽이지 않는다. Documents 스모크는 `ONLY="documents:"` · `ONLY="new documents:"`로 거른다(전체 스모크는 마지막 태스크).

```bash
# 워크트리 backend/ 에서
PY=<original-checkout>/backend/.venv/bin/python
$PY -m pytest tests/ -q -n auto                       # 한 파일만 볼 때는 -n 없이
<original-checkout>/backend/.venv/bin/ruff check app/ tests/
DATABASE_URL=sqlite+aiosqlite:///./docs-smoke.db AUTH_MODE=dev $PY -m scripts.reset_db
DATABASE_URL=sqlite+aiosqlite:///./docs-smoke.db AUTH_MODE=dev $PY -m scripts.seed_sop_demo   # 극단 자료는 이어서 seed_sop_worst
DATABASE_URL=sqlite+aiosqlite:///./docs-smoke.db AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin $PY -m uvicorn app.main:app --port 8787
# 워크트리 frontend/ 에서
BACKEND_URL=http://localhost:8787 npx next dev -p 3787
QUIET=1 ONLY="new documents:" BASE_URL=http://localhost:3787 BACKEND_PYTHON=$PY node scripts/pw-smoke-sop.mjs
npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run     # 커밋 전
```

## 이 계획이 정한 것(내 판단 — 설계에 없는 빈칸)

**서버**

1. **`slot_counts`는 따로 질의 하나**(`count_targets_by_slot`)로 센다. `count_targets_by_step`과 합치지 않는다 — 그 함수는 값이 정확히 같은지 보는 시험 둘이 지키고 있고, 질의는 하나만 는다(§10의 상한 안).
2. **`SLOT_KEYS`에 없는 칸 키가 든 줄**(있어서는 안 되는 자료)도 응답에 싣고 정렬의 끝에 둔다. 화면 모델은 모르는 키를 버린다. 서버가 거르면 "막힘의 같음"이 깨진다.

**N/A 칸 상태 표**

3. **Restore는 이 계획에서 바로 지우고 알림만 띄운다**("Restored 6.3 Troubleshooting"). 알림의 **Undo** 는 §13대로 다음 계획(3걸음)이 붙인다 — 알림의 행동 단추는 이미 있지만(`showToast(text, tone, { action })`) 걸음을 설계 순서대로 둔다. 이 계획의 스모크는 그 알림에 단추가 없다는 것을 박지 않는다.
4. **편집기의 자리**: 화면에 하나(`ToBeSection`의 상태 `naEdit`). 줄을 접어도 남고, 그동안 그 줄에 "Unsaved N/A reason" 알약이 붙는다. "적는 중"은 `text.trim() !== saved`다 — 새로 여는 칸은 한 글자라도 적어야, 고치는 칸은 저장된 사유와 달라야 적는 중이다.
5. **저장이 거절됐을 때**: 409 `slot_has_targets`면 알림을 띄우고 목록을 다시 받고 편집기를 닫는다(§8). **그 밖의 실패(네트워크 · 5xx · 다른 거절)는 편집기와 적던 사유를 그대로 둔다** — 2,000자를 다시 적게 하지 않는다.
6. **긴 사유**: 두 줄에서 자르고, 사유 글 자체가 단추다(`aria-expanded`). 누르면 그 자리에서 다 펴지고 다시 누르면 접힌다. 펴진 것은 그 줄만이고 기억하지 않는다.
7. **쓴 사유 칩**: 앞뒤 공백을 걷은 글이 같으면 하나로 세고, 많이 쓴 순 → 같으면 목록에 먼저 나온 순으로 셋. 지금 고치고 있는 칸의 사유도 센다(같은 사유를 다른 칸에 다시 쓰는 것이 이 칩의 쓸모다).
8. **이미 쓴 SOP의 표 머리**: "n with sentences · n empty · n N/A" 대신 **N/A** n과 (있으면) "n to decide"만 적는다. 문장 수를 세지 않는 문서에 "0 with sentences"를 적으면 거짓이다. 줄의 요약(§6)과 같은 규칙이다.
9. **"하위 칸에 있음"의 까닭**(§11 "Sub-sections hold sentences…")은 그 줄의 상태 글에 붙는 툴팁이다(포커스로도 닿는다). 단추 자리는 비워 둔다.
10. **이탈 가드의 문구**: 새 키 셋(`tobe.leaveTitle` · `tobe.leaveBody` · `tobe.leaveConfirm`). 확인 창의 `data-testid`는 `tobe-leave`다(지금 스모크가 "아무것도 남지 않았을 때는 묻지 않는다"를 이 이름으로 본다).

**줄과 펼친 곳**

11. **줄 끝 단추의 넓음 · 좁음은 CSS 컨테이너 질의로 가른다**(Order와 같은 방식 — 두 모양을 모두 그려 두고 목록 틀 `tobe-list`의 폭으로 고른다). `useElementWidth`는 첫 그림에서 폭을 모르는 한 프레임이 생긴다. 문턱의 시작값은 시안의 880px이고 Task 7에서 재서 정한다 — 다만 디자인 기준 창(1248 × 720, 스모크의 창)에서는 넓은 모양이어야 한다(스모크의 기존 단계들이 줄 끝 단추를 바로 누른다).
12. **숨은 단추는 `opacity: 0`만 준다**(`pointer-events`를 끄지 않는다). 줄 안에 있는 단추라 포인터가 단추에 닿으면 줄이 이미 올려진 상태다(Order는 단추가 용지 밖에 떠 있어 껐다). 끄는 동안만 `pointer-events: none`이다(다음 계획).
13. **단추 자리의 폭은 그 목록의 단추 수만큼이다**: New 목록은 둘(**Edit** · **Remove** — 24 × 2 + 2 = 50px, 여유 2), Old 목록은 셋(80px). 좁을 때는 ⋯ 하나(24px). 목록 안에서는 줄마다 같은 오른쪽 끝이다.
14. **읽기 전용 줄에는 줄 끝 단추가 없다**(**Edit** 는 "펼친다"와 같은 일이고 화살표 단추가 남는다). 단추 자리도 비우지 않는다.
15. **식별 자리의 폭**: New 줄은 종류 표(SOP · WI) + 14자 번호 + EQUIS 아이콘이 한 줄에 들어가는 폭(시작값 212px), 좁은 틀에서는 줄여도 14자 번호가 두 줄을 넘지 않는 폭. Task 7에서 재서 정한다(§14).
16. **종류는 두 칸 단추다**(`tobe-id-<n>-type-sop` · `-type-wi`, `aria-pressed`). 지금의 고르기 칸(`-type` + `-type-option-wi`)이 없어진다 — 스모크의 그 누름만 바꾼다(허락한 변경).
17. **줄의 값과 펼친 곳의 칸은 `data-testid`가 다르다**: 줄의 글자는 `-code-text` · `-title-text`, 펼친 곳의 입력은 지금 이름(`-code` · `-title`)이다(§14 "남는 칸은 지금 이름").
18. **쓴 파일의 단추 셋**(Preview · Download · Delete the written file)은 줄에서 펼친 곳의 **Written file** 묶음으로 간다(§6). 줄에는 파일 이름과 버전만 남는다.
19. **파일 이름의 가운데 말줄임**은 글자 수가 아니라 폭으로 한다: 머리(줄어들며 말줄임)와 꼬리(마지막 12자, 확장자 포함, 줄지 않음) 두 조각. 순수 도우미 `splitFileName`과 부품 `FileName` — 다음 계획의 Old 줄과 올리기 창이 다시 쓴다.
20. **줄 누름의 가드는 끌기 층의 목록을 그대로 쓴다**(`DRAG_GUARD_SELECTOR`): 줄 안의 단추 · 링크 · 입력 · `[data-no-drag]`에서 누른 것과 글자를 긁고 뗀 것(선택이 비어 있지 않다)은 펼침이 아니다.
21. **등록 칸에 번호를 여럿 적었을 때의 미리 보기**(§6은 한 줄만 적었다): "Adds {n} documents". 모두 이미 있는 번호면 첫 번호로 "{code} is already on the list". 더할 줄이 없으면 **Add** 가 꺼진다.
22. **"SOP가 없어 SOP로 더한다"는 번호가 WI라고 말할 때만 적는다**(`WI-…`). 번호만으로 종류를 모르는 줄은 그냥 "Adds SOP {code}"다 — `planAddRows`가 그 줄을 처음부터 SOP로 고른다.
23. **딸린 정보 줄의 줄어드는 순서**(§6)는 `.doc-meta`의 컨테이너 질의로 한다: 첫 N/A 칸 이름 → **Equipment SOP** 글자 → (파일 이름은 폭으로 줄어든다, 최소 96px) → 막대. 문턱 셋은 Task 7에서 영 · 한 극단 줄을 재서 정한다.
24. **EQUIS 제안 칩**("EQUIS suggests 1")은 누르면 줄을 펼치기만 한다. 제안 단추 둘(`-hint-type` · `-hint-equipment`)은 펼친 곳의 **Type** · **Equipment SOP** 칸 옆에 지금 문구 그대로 둔다.
25. **사용 설명서 그림 스크립트**(`pw-manual-shots.mjs`)의 Documents 장면은 고치지 않는다(그림은 정식 업데이트 때 뽑는다). 마지막 태스크가 `PROGRESS.md`에 "정식 업데이트 때 `tobe` · `tobe-sop` · `tobe-wi` 장면의 표시 자리를 새 화면에 맞춘다"를 남긴다.

## 설계와 코드가 어긋난 곳 — 이렇게 정했다

- **스모크 장면은 넷이 아니라 일곱이다.** §12는 고칠 장면 넷을 적었지만 New 목록을 만지는 단계가 셋 더 있다 — `new documents: removing a step keeps the other numbers`, `old Edit original addresses open the document in the one-document view`(끝에서 `tobe-saving`을 본다), `documents: AI reads a free-form list into New rows`(줄의 번호를 읽는다). 앞의 둘은 `data-testid`를 지키면 고치지 않아도 통과해야 하고, 셋째는 선택자 하나만 바꾼다(아래 허락).
- **배치 감사의 New 목록 항목은 `A1`과 `C3`다**(`pw-layout-audit.mjs`). `C3`("one expanded SOP's N/A slots block <= 280px at 1920")은 체크 목록의 높이를 박은 값이라 새 표에서 다시 잰다. Old 목록 항목(`C7b` · `C10a`~`C10e`)은 다음 계획이 고친다.
- **`tobe.stepCount`("Steps: {n}")와 §11의 "Steps {n}"은 글이 다르다.** 새 키(`tobe.row.steps`)를 두고 옛 키를 지운다. §11의 "Written(있는 키)"는 없다(`tobe.notWritten` · `tobe.colWritten`뿐) — 쓴 줄은 파일 이름을 보이므로 "Written" 글자를 만들지 않는다.
- **알림에 단추가 이미 있다**(§3은 없다고 적었다 — Pair view 걸음이 넣었다). 이 계획은 쓰지 않는다(판단 3).
- **고치지 말고 알려 둘 것**: `apply_tobe`의 막는 검사(`_find_blocked_slots`)는 그 요청의 N/A 하나가 아니라 **그 Bundle의 모든 N/A 줄**을 본다(`set_na_slot`이 목록 전체를 다시 싣는다). 이미 N/A인 칸에 문장이 들어갈 길은 지금 없지만(`na_slot` 거절), 그런 자료가 생기면 그 Bundle의 다른 칸 N/A 저장까지 409가 된다. 규칙을 바꾸지 않는다 — 조율하는 세션이 사용자에게 알린다.

## 허락한 기존 시험 변경(이것뿐이다)

| 어디 | 무엇을 | 새 기대 |
|---|---|---|
| `backend/tests/test_sop_tobe.py` `test_new_bundle_has_an_empty_tobe_list` · `test_tobe_rejects_bad_lists` | 빈 응답 전체를 견주는 dict | `"slot_counts": []` 한 칸을 더한다(다른 값은 그대로) |
| 스모크 `new documents: nested rows, N/A detail, each cell saves as you leave it` | (Task 3) N/A 확인 넷 | `…-na-procedures.troubleshooting`의 체크 대신 `…-slot-procedures.troubleshooting`의 `data-state="na"`와 사유 글. appendices는 체크 · 사유 · 체크 풀기 대신 **Mark N/A** → (저장 전 `na_slots` 수 그대로) → 사유 + <kbd>↵</kbd> → (+1) → **Restore** → (원래 수) |
| 같은 단계 | (Task 5) 줄의 번호 읽기 · 칸 고치기 · 종류 바꾸기 | 번호는 `-code-text`의 글자에서 읽는다(순서 기대 "SOP-CF 다음에 WI-…"는 그대로). 제목 · 번호 입력은 그 줄을 펼친 뒤 같은 이름의 칸에서 한다(저장 · Esc · 거절 기대는 그대로). 종류는 `-type-wi` 단추를 누른다 |
| 스모크 `documents: an Old list and a New list, with written files on their rows` | (Task 5) 쓴 파일의 미리 보기 누름과 `xpath=ancestor::tr` | 그 줄을 펼친 뒤 펼친 곳의 `-written-preview`를 누른다. 줄은 `-row`로 찾는다. 나머지 기대(줄의 `-written`에 파일 이름, `-not-written` 수, 펼치면 버전 · 언어 배치)는 그대로 |
| 스모크 `documents: AI reads a free-form list into New rows` | (Task 5) 줄 번호 선택자 `…-code` | `…-code-text`(읽는 값 기대는 그대로) |
| `pw-layout-audit.mjs` `A1` · `C3` | (Task 7) 표를 찾는 선택자와 기대값 | `A1`: 줄 상자가 목록 틀 안에 있고 식별 자리가 Task 7에서 정한 폭 이상. `C3`: 펼친 SOP의 **Sections** 가 1920에서 두 단이고 높이가 Task 7에서 잰 값 이하 |
| `pw-overlap-audit.mjs` `mbtnScenes`의 `tobe` | (Task 7) 줄의 빼기가 펼치는 단추(`MorphButton`)가 아니게 됐다 | 장면을 빼고, 줄 끝 단추 묶음이 제목 · 딸린 정보 글을 덮지 않는 장면으로 바꾼다. `tobe-steps`는 그대로 |

## Review Focus

1. 사유를 적는 사이 다른 사람이 그 칸에 문장을 보냈다 → **Save N/A** 가 409다. 까닭이 알림으로 뜨고 그 줄이 "n sentences"가 되며 편집기가 닫힌다. 서버가 죽었거나 끊겼을 때는 편집기와 적던 글이 남는다.
2. 사유를 적다가 줄을 접거나, <kbd>Enter</kbd>를 연달아 두 번 누르거나, 다른 화면으로 가려 한다 → 적던 글이 남고(알약), 저장은 한 번만 가고, 떠나기 전에 묻는다.
3. `slot_counts`가 없는 응답(옛 서버 · 캐시)이나 모르는 칸 키가 든 응답 → 표는 15줄 그대로 그려지고 문장 수 없이 빈 칸으로 읽는다. 화면이 죽지 않는다.
4. 부모를 못 찾은 WI가 응답에 온다(있어서는 안 되는 자료) → 목록 끝 **No parent SOP** 묶음에 보이고, 펼친 곳의 **Parent SOP** 로 고칠 수 있다.
5. 공백 없는 2,000자 사유와, 공백만 다른 같은 사유 여럿 → 칩은 하나로 세고 한 줄(최대 240px)이며, 표의 단을 밀어내지 않는다.

---

### Task 1: 서버 — `slot_counts`

**Files:**
- Modify: `backend/app/sop/tobe.py`(`count_targets_by_step` 바로 아래), `backend/app/routers/sop_tobe.py`(`ToBeViewOut` · `_build_tobe_view`)
- Modify: `frontend/src/lib/api-sop.ts`(`PlaceCount` 아래 타입, `ToBe`), `docs/README.md`(설계와 이 계획 · 다음 계획 한 줄씩 — 설계 줄이 아직 없으면 더한다), `backend/CLAUDE.md`(To-Be 목록을 말하는 문장 옆 한 문장)
- Test: `backend/tests/test_sop_tobe.py`

**Interfaces:**
- Consumes: `TargetSentence`(`slot_key` · `parent_target_id` · `kind`), `constants.SLOT_KEYS` · `SLOT_HEADING`, `is_within_slot`. 시험 도우미 `tests.sop_helpers`(`assign_as_is` · `upload` · `get_view` · `find_unit` · `put_tobe`), `tests.docx_factory`(`p` · `tbl` · `build_docx`), `tests.test_sop_numbering._setup_pairs` · `PAIR_SLOT`, `tests.test_sop_slot_heading._setup` · `_link_headings`, `tests.access_helpers.run_in_session`.
- Produces:

```python
# tobe.py
class SlotCountOut(BaseModel):
    target_doc_id: int
    slot_key: str
    count: int          # 칸 항목 수 — parent_target_id IS NULL이고 kind != slot_heading. 언어마다 따로, 상태를 가리지 않는다
    heading_count: int  # 그 칸 제목에 이은 옛 제목 수(kind == slot_heading)

async def count_targets_by_slot(session: AsyncSession, target_doc_ids: Collection[int]) -> list[SlotCountOut]
# count + heading_count > 0인 (문서, 칸)만. 정렬은 (문서 id, SLOT_KEYS의 자리 — 모르는 키는 끝). 하위 칸의 수를 상위 칸에 더하지 않는다

# sop_tobe.py
class ToBeViewOut(ToBeOut):
    ...
    slot_counts: list[SlotCountOut] = []
```

```ts
// api-sop.ts
/** 문장이나 칸 제목이 든 SOP 칸 - count는 결과물 C가 그 칸의 줄로 그리는 수, heading_count는 칸 제목에 이은 옛 제목 수 */
export interface SlotCount { target_doc_id: number; slot_key: string; count: number; heading_count: number }
export interface ToBe { /* … */ slot_counts?: SlotCount[] }
```

- [ ] **Step 1: 실패하는 시험을 쓴다** — `test_sop_tobe.py` 끝에 묶음 `# ── 칸별 문장 수(slot_counts) ──`. 도우미 셋을 그 묶음에 둔다: `_slot_rows(tobe: dict, doc_id: int) -> list[tuple[str, int, int]]`(그 문서의 `(slot_key, count, heading_count)`를 응답 순서로), `_old_view(client, bundle_id, body, name="SYNTHETIC_OLD-1_Slots.docx") -> dict`(`upload` 201을 확인하고 `get_view`), `_set_status(target_doc_id: int, slot_key: str, status: str) -> None`(`run_in_session`으로 그 문서 · 그 칸의 `TargetSentence.status`만 바꾼다). 옛 문서는 짝이 생기지 않게 한국어 문단만 쓴다.

```python
def test_slot_counts_count_the_items_each_sop_slot_holds(client: TestClient) -> None:
    bundle_id, ids, base = _row_setup(client)            # SOP-A · WI-A(단계 1) · SOP-B
    body = p("합성 첫 문장이다.") + p("합성 둘째 문장이다.") + p("합성 셋째 문장이다.") + tbl([["합성 칸 가", "합성 칸 나"], ["합성 칸 다", "합성 칸 라"]])
    view = _old_view(client, bundle_id, body)
    (table,) = [unit for unit in view["units"] if unit["kind"] == "table"]
    assign_as_is(client, bundle_id, find_unit(view, "합성 첫 문장이다."), ids["SOP-A"], slot_key="purpose")
    assign_as_is(client, bundle_id, find_unit(view, "합성 둘째 문장이다."), ids["SOP-A"], slot_key="procedures.maintenance", hold_reason="Synthetic: check")
    assign_as_is(client, bundle_id, find_unit(view, "합성 셋째 문장이다."), ids["WI-A"], wi_step=1, wi_part="instruction")
    assign_as_is(client, bundle_id, table, ids["SOP-A"], slot_key="scope")
    _set_status(ids["SOP-A"], "purpose", "ai_suggested")

    tobe = _get_tobe(client, bundle_id)

    # 표는 칸 새 문장이 넷이어도 1, 보류 · AI 제안도 센다, 하위 칸의 수는 상위 칸(procedures)에 더하지 않는다, WI와 빈 SOP는 나오지 않는다
    assert tobe["slot_counts"] == [
        {"target_doc_id": ids["SOP-A"], "slot_key": "purpose", "count": 1, "heading_count": 0},
        {"target_doc_id": ids["SOP-A"], "slot_key": "scope", "count": 1, "heading_count": 0},
        {"target_doc_id": ids["SOP-A"], "slot_key": "procedures.maintenance", "count": 1, "heading_count": 0},
    ]
    # sentence_counts의 모양은 그대로다 — SOP는 문서마다 한 줄, WI는 단계마다(값은 지금 있는 시험 둘이 지킨다)
    assert [(row["target_doc_id"], row["wi_step"]) for row in tobe["sentence_counts"]] == [(ids["SOP-A"], None), (ids["WI-A"], 1)]
```

  이어서(이름과 단언):
  - `test_slot_counts_count_each_language_of_a_pair`: `bundle_id, sop_id, _ = _setup_pairs(client)` → `_slot_rows(_get_tobe(client, bundle_id), sop_id) == [(PAIR_SLOT, 6, 0)]`.
  - `test_a_slot_heading_counts_apart_and_still_blocks_na`: `fx = _setup(client)`(칸 제목 시험의 것) · `_link_headings(client, fx, fx.old1)` → `_slot_rows(…, fx.sop_id) == [("procedures.procedure", 0, 2)]`. `PUT …/tobe/docs/{fx.sop_id}/na/procedures.procedure`와 `…/na/procedures`가 모두 409이고 `detail["code"] == "slot_has_targets"`.
  - `test_slot_counts_leave_out_written_docs`: `upload(…, "SYNTHETIC_WI-77.docx", side="new", doc_type="wi", parent_code="SOP-A")`와 `side="new", doc_type="sop"`인 파일 하나를 올린 뒤 `slot_counts == []`.
  - `test_slot_counts_follow_a_move_to_another_slot`: 문장 하나를 `purpose`에 보내고 `PUT /api/bundles/{id}/targets/order`(`{"revision", "target_doc_id", "items": [{"target_id", "slot_key": "scope"}]}` — `routers/sop_outputs.py` `OrderItemIn`)로 옮긴 뒤 `_slot_rows == [("scope", 1, 0)]`.
  - `test_every_row_write_returns_slot_counts`: 문장 하나를 `SOP-A`의 `purpose`에 둔 묶음에서 `POST …/tobe/docs` · `PATCH …/docs/{id}` · `PUT`과 `DELETE …/na/scope` · `POST`와 `PATCH`와 `DELETE …/steps…` · `DELETE …/docs/{빈 줄}`의 응답마다 `response.json()["slot_counts"] == [{"target_doc_id": ids["SOP-A"], "slot_key": "purpose", "count": 1, "heading_count": 0}]`.
  - `test_slot_counts_mark_exactly_the_slots_na_refuses`(**막힘의 같음**): 칸 제목 시험의 `_setup` + `_link_headings`(칸 제목만 → `procedures.procedure`)에 한국어 문단 둘과 표 하나짜리 옛 문서를 더 올려 `purpose`(확정), `general_requirements.safety`(DB에서 `ai_suggested`로), `definitions`(표)에 둔다. `SLOT_KEYS`의 칸마다 `refused = PUT …/na/{key}의 상태 == 409`(200이면 바로 `DELETE`로 되돌린다)와 `counted = any(is_within_slot(row["slot_key"], key) for row in slot_counts if row["target_doc_id"] == sop_id)`를 모아 `{refused인 키} == {counted인 키} == {"purpose", "definitions", "general_requirements", "general_requirements.safety", "procedures", "procedures.procedure"}`.
  - 허락한 변경 둘(`"slot_counts": []`).
- [ ] **Step 2: 실패를 본다** — `$PY -m pytest tests/test_sop_tobe.py -q` → 새 시험과 허락한 둘이 FAIL(`KeyError: 'slot_counts'`), 나머지 PASS.
- [ ] **Step 3: `count_targets_by_slot`.** 질의 하나: `target_sentences`를 `target_doc_id IN (…)` · `slot_key IS NOT NULL`로 걸러 (문서, 칸)으로 묶고 조건부 합 둘(`func.sum(case(...))`)을 낸다. 둘 다 0인 줄(칸 새 문장만 있는 칸)은 버린다. 문서 id가 비면 질의 없이 `[]`.
- [ ] **Step 4: `_build_tobe_view`에 싣는다** — `sentence_counts` 바로 다음 줄에서 같은 문서 id로 부른다. 다른 곳은 건드리지 않는다.
- [ ] **Step 5: 프런트 타입 · 인덱스 · `backend/CLAUDE.md`.** `SlotCount`와 `ToBe.slot_counts?`. `docs/README.md`에 설계(상태: 1·2걸음 구현 중)와 두 계획의 줄. `backend/CLAUDE.md`에 "New 목록 응답은 `sentence_counts`(지울 수 없는 자리)와 `slot_counts`(칸에 보이는 항목 수 · 칸 제목 수, N/A 칸 상태 표의 근거)를 함께 싣는다" 한 문장.
- [ ] **Step 6: 초록을 본다** — `$PY -m pytest tests/ -q -n auto` 전부 PASS, `ruff check app/ tests/` 초록, `npx tsc --noEmit -p tsconfig.json` 초록. `test_removing_one_doc_or_step_is_refused_while_sentences_sit_there` · `test_renaming_a_row_keeps_its_id_and_what_hangs_on_it`(둘 다 `sentence_counts`를 값으로 견준다)가 고치지 않은 채 PASS인지 따로 본다.
- [ ] **Step 7: 커밋** — `feat(tobe): return per-slot item counts with the New list — New 목록 응답에 칸별 문장 수(slot_counts)` (`PROGRESS.md` 포함)

---

### Task 2: 순수 모델 — 칸 상태

**Files:**
- Create: `frontend/src/lib/slot-status-model.ts` · Test: `frontend/src/lib/slot-status-model.test.ts`

**Interfaces:**
- Consumes: `SLOT_KEYS` · `ToBe` · `TargetDoc` · `SlotCount`(`api-sop`), `SLOT_LABELS`(`slot-labels`).
- Produces:

```ts
export type SlotKey = (typeof SLOT_KEYS)[number];
/** backend constants.EQUIPMENT_SLOT_KEYS와 같은 값 - 장비 SOP에서 채우거나 N/A로 남겨야 하는 세 칸 */
export const EQUIPMENT_SLOT_KEYS: readonly SlotKey[];
/** 칸 번호 - SLOT_KEYS의 고정 자리(backend outputs._build_slot_numbers와 같은 규칙): 1…7, 하위 칸은 5.1 */
export const SLOT_NUMBERS: Readonly<Record<SlotKey, string>>;
/** 표의 두 단 - 경계는 5.2와 6 사이로 고정이다 */
export const SLOT_COLUMNS: readonly [readonly SlotKey[], readonly SlotKey[]];
export function getSlotParent(key: SlotKey): SlotKey | null;

export type SlotState =
  | { kind: "na"; reason: string }        // 1 그 칸에 N/A가 저장돼 있다
  | { kind: "covered"; by: SlotKey }      // 2 상위 칸이 N/A다
  | { kind: "filled"; count: number }     // 3 그 칸의 count > 0
  | { kind: "sub"; count: number }        // 4 상위 칸, 자기 0, 하위 칸 count의 합 > 0
  | { kind: "decide" }                    // 5 장비 SOP의 세 칸이고 위 넷이 아니다
  | { kind: "empty" };                    // 6 그 밖
export interface SlotRow {
  key: SlotKey; number: string; label: string; isChild: boolean; state: SlotState;
  /** Mark N/A를 그릴 칸 - decide·empty이고 칸 제목이 이어져 있지 않다 */
  canMarkNa: boolean;
  /** 문장은 없는데 그 칸이나 하위 칸의 칸 제목에 옛 제목이 이어져 있다(서버가 N/A를 막는다) */
  headingLinked: boolean;
}
export interface SlotSummary { filled: number; empty: number; na: number; decide: number }

/** SOP 한 줄의 칸 15개, SLOT_KEYS 순서. 이미 쓴 문서(entrance "match")는 수를 읽지 않는다(3·4번 상태와 headingLinked가 없다) */
export function buildSlotRows(tobe: ToBe, doc: TargetDoc): SlotRow[];
/** filled = 3·4번, na = 1·2번. 네 수의 합은 늘 15 */
export function summarizeSlots(rows: readonly SlotRow[]): SlotSummary;
/** 이 Bundle의 N/A에 쓴 사유 - 앞뒤 공백을 걷은 글이 같으면 하나, 많이 쓴 순(같으면 먼저 나온 순), limit개 */
export function listUsedReasons(tobe: ToBe, limit?: number): string[];   // 기본 3

/** 열려 있는 사유 편집기 - 화면에 하나. saved는 그 칸에 저장된 사유(새로 여는 칸은 "") */
export interface NaEdit { docKey: string; slotKey: SlotKey; text: string; saved: string; refused: boolean }
export function isNaEditDirty(edit: NaEdit | null): boolean;    // text.trim() !== saved
/** 다른 칸의 Mark N/A·Edit reason - 적는 중이면 지금 것을 두고 refused를 켠다, 아니면 조용히 옮긴다. 같은 칸이면 지금 것 그대로(refused는 끈다) */
export function openNaEdit(current: NaEdit | null, target: { docKey: string; slotKey: SlotKey; saved: string }): NaEdit;
```

- [ ] **Step 1: 실패하는 시험을 쓴다.** 고정 자료 — 장비 SOP `SOP-CF`(id 12, `entrance: "assign"`), `na_slots`: `procedures.troubleshooting`("r1") · `document_relationships`("r2") · `document_relationships.appendices`("own"), `slot_counts`(문서 12): `purpose` 2/0 · `scope` 0/1 · `general_requirements.safety` 3/0 · `procedures.procedure` 6/0, 그리고 다른 문서(id 99)의 줄 하나와 모르는 키 `"procedures.nope"` 줄 하나.

```ts
it("reads the six states in order, top state first", () => {
  expect(buildSlotRows(tobe, sop).map((row) => [row.number, row.state.kind])).toEqual([
    ["1", "filled"], ["2", "empty"], ["3", "empty"], ["4", "empty"], ["5", "sub"], ["5.1", "filled"], ["5.2", "empty"],
    ["6", "sub"], ["6.1", "filled"], ["6.2", "decide"], ["6.3", "na"], ["6.4", "decide"], ["7", "na"], ["7.1", "covered"], ["7.2", "na"],
  ]);
});
it("counts a parent by its sub-sections and keeps a sub-section's own N/A under an N/A parent", () => {
  const rows = new Map(buildSlotRows(tobe, sop).map((row) => [row.key, row]));
  expect(rows.get("general_requirements")?.state).toEqual({ kind: "sub", count: 3 });
  expect(rows.get("document_relationships.attachments")?.state).toEqual({ kind: "covered", by: "document_relationships" });
  expect(rows.get("document_relationships.appendices")?.state).toEqual({ kind: "na", reason: "own" });
});
it("offers Mark N/A on empty and to-decide sections only, and not where an Old heading is linked", () => {
  expect(buildSlotRows(tobe, sop).filter((row) => row.canMarkNa).map((row) => row.number)).toEqual(["3", "4", "5.2", "6.2", "6.4"]);
  expect(buildSlotRows(tobe, sop).filter((row) => row.headingLinked).map((row) => row.number)).toEqual(["2"]);
});
it("sums to fifteen", () => {
  expect(summarizeSlots(buildSlotRows(tobe, sop))).toEqual({ filled: 5, empty: 4, na: 4, decide: 2 });
});
```

  이어서(이름과 단언):
  - `"blocks a parent whose sub-section has only a linked heading"`: `slot_counts`가 `procedures.maintenance` 0/1뿐인 SOP에서 `procedures`와 `procedures.maintenance`가 `headingLinked: true` · `canMarkNa: false`, 상태는 각각 `empty` · (장비 SOP면) `decide`.
  - `"marks the three equipment sections to decide only on an equipment SOP"`: 같은 자료에서 `is_equipment_sop: false`면 6.2 · 6.4가 `empty`. 상위 칸 `procedures`가 N/A면 셋 다 `covered`(검토 알림 `review._list_equipment_notices`와 같은 집합 — 칸 항목도 N/A도 없는 칸만).
  - `"reads a written SOP without counts"`: N/A가 없는 `entrance: "match"` 장비 SOP는 `slot_counts`에 그 문서 줄이 있어도 `filled` · `sub` · `headingLinked`가 없고 요약이 `{ filled: 0, empty: 12, na: 0, decide: 3 }`.
  - `"treats a missing or unknown count as empty"`(Review Focus 3): 고정 자료에서 `slot_counts: undefined`로 바꾼 응답과 모르는 키(`"procedures.nope"`) 줄만 남긴 응답 둘 다 줄이 15개이고 요약이 `{ filled: 0, empty: 9, na: 4, decide: 2 }`(N/A는 그대로 읽는다) — 던지지 않는다.
  - `"numbers the sections from their fixed places"`: `SLOT_KEYS.map((key) => SLOT_NUMBERS[key])`가 `["1","2","3","4","5","5.1","5.2","6","6.1","6.2","6.3","6.4","7","7.1","7.2"]`, `SLOT_COLUMNS[0]`의 끝이 `general_requirements.operation`, `SLOT_COLUMNS[1]`의 처음이 `procedures`.
  - `"lists the reasons used most, one per text"`(Review Focus 5): 사유 `"A"` · `" A "` · `"B"` · `"C"` · `"C"` · `"C"` · `"D"`에서 `listUsedReasons(tobe)`가 `["C", "A", "B"]`, `listUsedReasons(tobe, 1)`이 `["C"]`, N/A가 없으면 `[]`.
  - `"keeps one editor"`: `openNaEdit(null, target)`이 `{ ...target, text: target.saved, refused: false }`. 적는 중(`text: "x"`, `saved: ""`)에 다른 칸을 열면 지금 것 그대로에 `refused: true`. 적은 것이 없으면(`text: " "`) 새 칸으로 옮긴다. `isNaEditDirty`는 `text: " r1 "` · `saved: "r1"`에서 `false`.
- [ ] **Step 2: 실패를 본다** — `cd frontend && npx vitest run src/lib/slot-status-model.test.ts` → FAIL(없는 모듈).
- [ ] **Step 3: 모델을 쓴다.** 상태는 표의 순서대로 먼저 맞는 것. 그 문서의 수는 `target_doc_id === doc.id`이고 `SLOT_KEYS`에 든 키만 읽는다.
- [ ] **Step 4: 초록을 본다** — 위 시험 PASS, `npm run lint && npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: 커밋** — `feat(tobe): add the section status model for the New list — 칸 상태 순수 모델(여섯 상태·요약·쓴 사유·편집기 하나)` (`PROGRESS.md` 포함)

---

### Task 3: 화면 — N/A 칸 상태 표

지금 표의 펼친 줄 안에서 체크 목록만 바꾼다. 줄의 "N/A: 1" 칸과 표의 나머지는 Task 5까지 그대로다.

**Files:**
- Create: `frontend/src/components/tobe/slot-table.tsx`
- Modify: `frontend/src/components/tobe/tobe-section.tsx`(`renderDetail`의 SOP 갈래, `runWrite`, 이탈 가드), `frontend/src/styles/components.css`(`.tobe-table` 규칙 옆), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(`#tobe-slots` · `#tobe-save`)
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 하나 + 허락한 변경)

**Interfaces:**
- Consumes: Task 1의 `slot_counts`, Task 2 전부. `setNaSlot` · `clearNaSlot`(`api-sop`), `ApiError`, `useLeaveGuard`(`lib/leave-guard`) · `navigate`(`lib/nav-buffer`), `ConfirmModal`, `Tooltip`, `showToast`.
- Produces:

```tsx
// slot-table.tsx
interface SlotTableProps {
  prefix: string;                 // `tobe-id-<줄 id>`
  docKey: string;
  rows: readonly SlotRow[];
  summary: SlotSummary;
  isWritten: boolean;             // 이미 쓴 SOP - 문장 수가 없다
  canEdit: boolean;
  saving: boolean;
  usedReasons: readonly string[];
  edit: NaEdit | null;            // 화면에 하나 - 이 문서의 것일 때만 그린다
  onEdit: (next: NaEdit | null) => void;
  onSave: (slotKey: SlotKey, reason: string) => void;
  onRestore: (row: SlotRow) => void;
}
export function SlotTable(props: SlotTableProps): ReactNode;

// tobe-section.tsx
/** 줄 쓰기의 결과 - 거절이면 그 오류를 함께 돌려준다(알림과 다시 받기는 이 안에서 한다) */
async function runWriteResult(write: () => Promise<ToBe>): Promise<{ ok: true } | { ok: false; error: unknown }>;
async function runWrite(write: () => Promise<ToBe>): Promise<boolean>;   // 지금 서명 그대로 - runWriteResult를 부른다
```

  - DOM(고정 — 스모크와 Task 5가 기댄다):
    - 틀 `<div className="slot-table" data-testid={`${prefix}-slots`}>`. 머리: **Sections** + `<span data-testid={`${prefix}-slots-summary`}>` + (decide > 0이면) `<span className="pill warn" data-testid={`${prefix}-slots-decide`}>`.
    - 두 단 `<div className="slot-cols">` 안에 `SLOT_COLUMNS`마다 `<div>`. 줄 `<div className="slot-row" data-slot={key} data-state={state.kind} data-child={isChild ? "" : undefined} data-testid={`${prefix}-slot-${key}`}>`: 번호(mono) · 이름 · 상태 `<span data-testid={`${prefix}-slot-${key}-state`}>` · 단추 자리.
    - 단추: `${prefix}-na-${key}-mark` · `-edit` · `-restore`(진짜 `<button>`). `-edit` · `-restore`와 빈 칸의 `-mark`는 줄 호버 · 포커스 때만 보이고(`(hover: none)`에서는 늘), "정할 칸"의 `-mark`는 늘 보인다.
    - 사유(1번 상태): `<button type="button" className="slot-reason" aria-expanded data-testid={`${prefix}-na-${key}-text`}>`(두 줄에서 자르고 누르면 편다). 2번 상태는 "Covered by 7 Document relationships" 글.
    - 칸 제목만 이어진 칸: 단추 자리에 `<span data-testid={`${prefix}-slot-${key}-heading-note`}>`.
    - 편집기(그 줄 아래) `<div className="slot-editor" data-testid={`${prefix}-na-${key}-editor`}>`: 머리글 `<label>`, 입력 `<input maxLength={2000} data-testid={`${prefix}-na-${key}-reason`}>`, 칩 `${prefix}-na-${key}-chip-<0…>`, `${prefix}-na-${key}-save`(글 뒤에 `<kbd>↵</kbd>`) · `-cancel`(`<kbd>Esc</kbd>`), 안내 `<p role="status" data-testid={`${prefix}-na-${key}-finish-first`}>`(`edit.refused`일 때만).
    - 표 아래 한 줄 `<p className="slot-help">`.
  - 새 문구(en / ko):
    - `tobe.slots.title`: "Sections" / "칸"
    - `tobe.slots.summary`: "{filled} with sentences · {empty} empty · {na} N/A" / "문장 있음 {filled} · 빈 칸 {empty} · N/A {na}"
    - `tobe.slots.decide`: "{n} to decide" / "정할 칸 {n}개"
    - `tobe.slots.sentences`: "{n} sentences" / "문장 {n}개" · `tobe.slots.sentenceOne`: "1 sentence" / "문장 1개"
    - `tobe.slots.inSub`: "{n} in sub-sections" / "하위 칸에 {n}개"
    - `tobe.slots.empty`: "Empty" / "Empty" · `tobe.slots.fill`: "Fill or mark N/A" / "채우거나 N/A로"
    - `tobe.slots.covered`: "Covered by {number} {name}" / "{number} {name}의 N/A에 포함"
    - `tobe.slots.fromFile`: "From the file" / "파일을 따름"
    - `tobe.slots.mark`: "Mark N/A" / "N/A로 두기" · `tobe.slots.editReason`: "Edit reason" / "사유 고치기" · `tobe.slots.restore`: "Restore" / "되돌리기"
    - `tobe.slots.reasonLabel`: "Reason. Printed in the document as “N/A · reason”" / "사유. 결과물에 “N/A · 사유”로 찍힙니다"
    - `tobe.slots.reasonPlaceholder`: "Why this SOP has no {name}" / "이 SOP에 {name} 칸이 없는 까닭"
    - `tobe.slots.used`: "Used in this Bundle" / "이 Bundle에서 쓴 사유"
    - `tobe.slots.save`: "Save N/A" / "N/A 저장" (취소는 `common.cancel`)
    - `tobe.slots.finishFirst`: "Save or cancel this reason first." / "이 사유를 먼저 저장하거나 취소하세요."
    - `tobe.slots.subHolds`: "Sub-sections hold sentences, so this section cannot be N/A." / "하위 칸에 문장이 있어 N/A로 둘 수 없습니다."
    - `tobe.slots.headingLinked`: "An Old heading is linked to this section title. Unlink it in Assign to mark N/A." / "이 칸 제목에 Old 제목이 이어져 있습니다. Assign에서 끊어야 N/A로 둘 수 있습니다."
    - `tobe.slots.help`: "An N/A section stays in the document with its reason. A section that holds sentences cannot be N/A. Clear them in Assign first." / "N/A 칸은 사유와 함께 문서에 남습니다. 문장이 든 칸은 N/A로 둘 수 없습니다. Assign에서 먼저 비우세요."
    - `tobe.slots.restored`: "Restored {number} {name}" / "{number} {name} 칸을 되돌렸습니다"
    - `tobe.slots.unsaved`: "Unsaved N/A reason" / "저장 안 한 N/A 사유"
    - `tobe.row.na`: "N/A {n}" / "N/A {n}" (이미 쓴 SOP의 표 머리, Task 6의 줄 요약)
    - `tobe.leaveTitle`: "Leave without saving the N/A reason?" / "N/A 사유를 저장하지 않고 나갈까요?" · `tobe.leaveBody`: "The reason you typed is not saved yet. Leaving discards it." / "적던 사유가 아직 저장되지 않았습니다. 나가면 버려집니다." · `tobe.leaveConfirm`: "Discard and leave" / "버리고 나가기"
    - 지우는 키(en · ko): `tobe.naHint` · `tobe.naReason`.

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 이름 `new documents: the section table shows each section's state and saves N/A only with a reason`, 자리는 `new documents: removing a step keeps the other numbers` 바로 뒤, `allowConsoleErrors: true`(거절 응답이 콘솔에 찍힌다). 묶음은 `halfBundleId`, 줄은 `GET /tobe`의 첫 SOP(장비 SOP `SOP-CF`). 단계 처음에 `na_slots` 수를 적고 끝에 같은 수로 되돌린다(만든 N/A는 API로도 지운다). `…/na/…`로 가는 요청을 모두 적는다(메서드 · 주소). 확인할 것:
  1. **15줄**: 줄을 펼치면 `…-slots` 안의 `[data-slot]`이 15개이고 순서가 `SLOT_KEYS`와 같다. 머리의 수가 줄들의 `data-state`에서 센 것과 같다(`filled`+`sub` · `empty` · `na`+`covered`, 그리고 `decide` 수의 알약).
  2. **문장이 든 칸**: API의 `slot_counts`에서 그 문서의 `count > 0`인 칸마다 `data-state="filled"`, 상태 글이 `${count} sentences`(1이면 `1 sentence`), 그 줄 안에 `button`이 0개. 그 칸의 상위 칸(자기 수 0)은 `data-state="sub"`.
  3. **N/A인 칸**: `procedures.troubleshooting`이 `data-state="na"`이고 `-text`가 시드 사유의 앞머리를 담으며 `-edit` · `-restore`가 있다.
  4. **정할 칸**: `procedures.electronic_record_control` · `procedures.maintenance` 가운데 `slot_counts`에 없는 칸은 `data-state="decide"`, 글 "Fill or mark N/A", 그 `-mark`가 올리지 않아도 `opacity` 1. 빈 칸의 `-mark`는 평소 `opacity` 0이고 줄에 올리면 1.
  5. **사유 없이는 저장되지 않는다**: 먼저 P와 E를 잡는다 — P는 하위 칸이 있고 `-mark`가 그려진 상위 칸(시드에서는 `document_relationships`), E는 P의 하위 칸 가운데 `data-state="empty"`인 것(시드에서는 `document_relationships.appendices`). E의 `-mark` → `-editor`가 보이고 입력에 포커스, `-save`가 꺼져 있다. <kbd>↵</kbd> → `PUT` 요청 0건. 표 밖을 눌러 칸을 떠나도 `-editor`가 그대로다.
  6. **한 번에 하나**: "Smoke: covered elsewhere"를 적고 다른 빈 칸의 `-mark`를 누르면 `-editor`는 여전히 E에만 있고 `-finish-first`의 글이 "Save or cancel this reason first.", 포커스가 E의 입력에 있다.
  7. **접어도 남는다**: 줄을 접으면 그 줄의 `…-unsaved` 알약("Unsaved N/A reason")이 보이고, 다시 펼치면 입력 값이 "Smoke: covered elsewhere"다.
  8. **떠나기 전에 묻는다**: `stage-nav-assign`을 누르면 `tobe-leave` 창이 뜨고 주소가 그대로다. 닫는다(`tobe-leave-close`).
  9. **저장은 한 번**: <kbd>↵</kbd>를 연달아 두 번 → `PUT …/na/E`가 정확히 1건이고 200, `-editor`가 사라지고 `data-state="na"`, API의 `na_slots` 수가 +1. `page.reload()` 뒤에도 N/A다.
  10. **쓴 사유 칩과 Esc**: 다른 빈 잎 칸의 `-mark` → `-chip-0`의 글이 시드 사유, `-chip-1`이 "Smoke: covered elsewhere". `-chip-1`을 누르면 입력 값이 그 글이다. <kbd>Esc</kbd> → `-editor`가 없고 줄은 펼쳐진 채(`…-toggle`의 `aria-expanded="true"`), `PUT`이 늘지 않는다.
  11. **상위 칸이 덮는다**: P를 **Mark N/A** → "Smoke: no relationships" → `-save`. P의 다른 하위 칸이 `data-state="covered"`이고 글이 `Covered by ${번호} ${이름}`, E는 제 사유의 `na` 그대로다.
  12. **고치고 되돌린다**: P의 `-edit` → 입력에 저장된 사유 → 고쳐 저장 → API의 사유가 바뀐다. P의 `-restore` → `DELETE` 200, `toast-ok`의 글이 `Restored ${번호} ${이름}`, 덮였던 하위 칸이 `empty`로 돌아온다. E의 `-restore` → `na_slots` 수가 처음 값이다.
  13. **409는 닫고, 그 밖은 남긴다**(Review Focus 1): `page.route("**/tobe/docs/*/na/*", …)`로 `PUT`만 409 `{ detail: { code: "slot_has_targets", slots: [] } }`로 답하게 하고 빈 칸에 사유를 적어 저장 → `toast-error`의 글이 "A section with new sentences cannot be N/A."이고 `-editor`가 없다. 500으로 바꿔 다시 → `toast-error`가 뜨고 `-editor`와 적은 글이 그대로다. `page.unroute`, `-cancel`.

  **허락한 변경**(위 표): `new documents: nested rows, N/A detail…` 단계의 N/A 확인 넷.
- [ ] **Step 2: 실패를 본다** — 화면을 고치기 전에 갓 시드한 DB에서 전체 스모크를 한 번 돌려 **실패 기준선**을 `PROGRESS.md`에 적는다(Task 7이 견준다). 이어서 `ONLY="new documents:"` → 새 단계와 고친 확인이 FAIL, 나머지 PASS.
- [ ] **Step 3: `slot-table.tsx`.** Interfaces의 DOM대로. 상태 글: `filled` → `tobe.slots.sentences` · `sentenceOne`, `sub` → `tobe.slots.inSub`(툴팁 `tobe.slots.subHolds`, `tabIndex={0}`), `decide` → 호박색 알약 `tobe.slots.fill`, `empty` → `isWritten`이면 `tobe.slots.fromFile` 아니면 **Empty**, `na` · `covered` → **N/A** 칩. `isWritten`이면 머리의 `-slots-summary`는 `tobe.row.na`("N/A {n}")뿐이다(판단 8). 단추의 열기는 `onEdit(openNaEdit(edit, { docKey, slotKey: row.key, saved }))` — `saved`는 그 칸의 저장된 사유(없으면 `""`). 편집기: 입력은 제어 입력(`edit.text`), <kbd>↵</kbd>는 `text.trim()`이 있고 `!saving`일 때만 `onSave`, <kbd>Esc</kbd>는 `stopPropagation` 뒤 `onEdit(null)`, `onBlur`를 걸지 않는다. 칩은 한 줄(`max-width: 240px`, 말줄임, 전체 글은 툴팁)이고 누르면 `onEdit({ ...edit, text: reason, refused: false })` 뒤 입력에 포커스. `edit.refused`가 켜지면 입력으로 포커스를 돌린다(이펙트).
- [ ] **Step 4: `tobe-section.tsx`.**
  - `runWrite`를 `runWriteResult`로 나눈다(Interfaces). 부르는 다른 곳은 그대로다.
  - 상태 `const [naEdit, setNaEdit] = useState<NaEdit | null>(null)`. `pendingNa` · `setNaPending`을 지운다.
  - `saveNa(docId, slotKey, reason)`: `saving`이면 돌아간다 → `runWriteResult(() => setNaSlot(…))` → 성공이면 `setNaEdit(null)`. 실패가 `ApiError`이고 `rule?.code === "slot_has_targets"`면 `setNaEdit(null)`, 그 밖은 그대로 둔다.
  - `restoreNa(docId, row)`: `runWrite(() => clearNaSlot(…))`가 참이면 `showToast(t("tobe.slots.restored", { number: row.number, name: row.label }))`. 그 칸의 편집기가 열려 있었으면 닫는다.
  - 다시 받은 목록에서 `naEdit`의 문서가 사라졌거나 SOP가 아니게 됐으면 렌더 중에 `setNaEdit(null)`(렌더 중 상태 맞추기 — `CommitInput`과 같은 짜임).
  - `renderDetail`의 SOP 갈래를 `<SlotTable …/>`로 바꾼다: `rows = buildSlotRows(tobe, saved)`(`saved`는 `savedByCode.get(doc.code)`), `summary = summarizeSlots(rows)`, `usedReasons = listUsedReasons(tobe)`, `isWritten = doc.entrance === "match"`, `edit={naEdit}` · `onEdit={setNaEdit}`.
  - 줄의 세부 칸(`-detail`) 옆에 `naEdit?.docKey === doc.key && isNaEditDirty(naEdit)`일 때 `<span className="pill warn" data-testid={`${prefix}-unsaved`}>`.
  - 이탈 가드: `const [leaveTo, setLeaveTo] = useState<string | null>(null)`, `useLeaveGuard(isNaEditDirty(naEdit), setLeaveTo)`, `ConfirmModal`(`testId="tobe-leave"`, `danger`, 확인하면 `setNaEdit(null)` 뒤 `navigate(href, { immediate: true })` — `outputs-workspace.tsx`의 `outputs-leave`와 같은 짜임).
- [ ] **Step 5: CSS**(토큰만, 값은 화면에서 재어 정한다). `.slot-cols`: `grid-template-columns: repeat(auto-fit, minmax(290px, 1fr))` · `gap: 0 28px` — 틀이 좁으면 한 단. `.slot-row`: `grid-template-columns: 30px minmax(0, 1fr) auto auto`, 줄 높이 최소 32px, 하위 칸은 24px 들인다, 줄마다 아래 선. 사유와 편집기는 둘째 열부터 끝까지(`grid-column: 2 / -1`), 글은 `overflow-wrap: anywhere`. 사유 두 줄 자르기는 `.clamp-2`. 편집 중인 줄은 왼쪽 2px 강조 막대(막대 쪽 모서리 직각). 숨는 단추는 `opacity`만 바꾼다.
- [ ] **Step 6: 문구 · 사용 설명서.** 문구 전부(en · ko)와 지우는 키 둘. 설명서 `#tobe-slots`: 체크 목록 설명을 지우고 — SOP를 펼치면 **Sections** 에 칸 15개가 번호 · 이름 · 지금 상태(문장 수, **Empty**, **N/A**)로 보인다는 것, 빈 칸의 **Mark N/A** 를 누르면 그 줄 아래에 사유 칸이 열리고 **Save N/A**(<kbd>Enter</kbd>)로 저장 · **Cancel**(<kbd>Esc</kbd>)로 닫는다는 것(칸을 떠나도 닫히지 않는다), **Used in this Bundle** 의 칩으로 쓴 사유를 다시 넣는다는 것, N/A 칸은 **Edit reason** · **Restore**, 상위 칸을 N/A로 두면 하위 칸이 함께 덮인다는 것, 문장이 든 칸과 칸 제목에 Old 제목이 이어진 칸에는 단추가 없고 Assign에서 먼저 비운다는 것, 장비 SOP의 세 칸은 **Fill or mark N/A** 로 표시된다는 것, 이미 쓴 SOP는 문장 수 대신 **From the file** 로 보인다는 것. `#tobe-save`의 N/A 줄을 "N/A 사유만은 **Save N/A** 를 눌러야 저장됩니다. 적던 사유는 줄을 접어도 남고, 저장하지 않은 채 다른 화면으로 가려 하면 묻습니다"로 바꾸고, 고르는 칸의 예에서 N/A를 뺀다. `manual-content.test.ts` 통과.
- [ ] **Step 7: 초록을 본다** — `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, 갓 시드한 DB에서 `ONLY="new documents:"` 전부 PASS, `next dev`를 내리고 `npm run build` 경고 0.
- [ ] **Step 8: 커밋** — `feat(tobe): show each SOP section's state and mark N/A from a status table — 체크 목록 대신 칸 상태 표(Mark N/A·Edit reason·Restore)` (`PROGRESS.md` 포함)

---

### Task 4: 순수 모델 — 등록 미리 보기 · 줄 누름 · 파일 이름 · 단계 문장 수

**Files:**
- Modify: `frontend/src/lib/tobe-add-model.ts` · `row-open.ts` · `truncate-middle.ts` · `destination-manage-model.ts`
- Test: 같은 이름의 `.test.ts` 넷(덧붙인다 — 지금 시험은 건드리지 않는다)

**Interfaces:**
- Consumes: `planAddRows` · `readCodes`, `DRAG_GUARD_SELECTOR`(`lib/box-drag`), `getStepRemoveBlock`.
- Produces:

```ts
// tobe-add-model.ts
export function readTypeFromCode(code: string): TargetDocType | null;   // 지금 함수를 export만 한다
export type AddPreview =
  | { kind: "none" }                                   // 적은 번호가 없다
  | { kind: "sop"; code: string }
  | { kind: "wi"; code: string; parent: string }
  | { kind: "sopFallback"; code: string }              // 번호는 WI인데 목록에 SOP가 없어 SOP로 더한다
  | { kind: "taken"; code: string }                    // 더할 줄이 없다 - 첫 번호가 이미 있다
  | { kind: "many"; n: number };                       // 더할 줄이 둘 이상
/** 등록 칸에 적은 글이 무엇을 더하는가 - planAddRows(readCodes(text), listed)의 결과를 그대로 읽는다 */
export function describeAdd(text: string, listed: readonly Pick<TargetDoc, "code" | "doc_type">[]): AddPreview;
export const ADD_PREVIEW_KEYS: Readonly<Record<Exclude<AddPreview["kind"], "none">, string>>;
// sop "tobe.add.sop" · wi "tobe.add.wi" · sopFallback "tobe.add.sopFallback" · taken "tobe.add.taken" · many "tobe.add.many"

// row-open.ts
/** 줄 누름이 펼침인가 - 줄 안의 단추·링크·입력·[data-no-drag]에서 누른 것과 글자를 긁고 뗀 것은 아니다 */
export function shouldRowToggle(target: EventTarget | null, hasSelection: boolean): boolean;

// truncate-middle.ts
/** 파일 이름을 머리와 꼬리(마지막 tail자 - 확장자가 든다)로 가른다. tail보다 짧으면 ["", name] */
export function splitFileName(name: string, tail?: number): [head: string, tail: string];   // 기본 12, 코드포인트로 센다

// destination-manage-model.ts
/** 그 단계에 든 문장 수 - 없으면 0 */
export function getStepCount(tobe: ToBe, docId: number, stepNo: number): number;
```

- [ ] **Step 1: 실패하는 시험을 쓴다.**

```ts
describe("describeAdd (what the add field will do)", () => {
  const listed = [{ code: "SOP-PH", doc_type: "sop" as const }, { code: "WI-04", doc_type: "wi" as const }];
  it("says nothing for an empty field", () => expect(describeAdd("  ", listed)).toEqual({ kind: "none" }));
  it("names the SOP or the WI and its parent", () => {
    expect(describeAdd("SOP-MX", listed)).toEqual({ kind: "sop", code: "SOP-MX" });
    expect(describeAdd(" WI-09 ", listed)).toEqual({ kind: "wi", code: "WI-09", parent: "SOP-PH" });
    expect(describeAdd("QC-0400", listed)).toEqual({ kind: "wi", code: "QC-0400", parent: "SOP-PH" });
  });
  it("says a WI number becomes an SOP when the list has no SOP, and only then", () => {
    expect(describeAdd("WI-09", [])).toEqual({ kind: "sopFallback", code: "WI-09" });
    expect(describeAdd("QC-0400", [])).toEqual({ kind: "sop", code: "QC-0400" });
  });
  it("says a number is already on the list", () => {
    expect(describeAdd("WI-04", listed)).toEqual({ kind: "taken", code: "WI-04" });
    expect(describeAdd("WI-04, SOP-PH", listed)).toEqual({ kind: "taken", code: "WI-04" });
  });
  it("counts several new numbers", () => expect(describeAdd("WI-09, WI-10, WI-04", listed)).toEqual({ kind: "many", n: 2 }));
});
```

  - `shouldRowToggle`(jsdom): 줄 `div` 안의 `span`에서 `true`, `button` · `a` · `input` · `select` · `[data-no-drag]` 안의 `span`에서 `false`, `hasSelection`이면 어디서든 `false`, `target`이 `null`이면 `false`.
  - `splitFileName`: `splitFileName("SYNTHETIC_OLD-1_Eppendorf_Centrifuge.docx")`가 `["SYNTHETIC_OLD-1_Eppendorf_Ce", "ntrifuge.docx"]`, `splitFileName("a.docx")`가 `["", "a.docx"]`, `splitFileName("합성파일이름입니다열두자넘김.docx", 5)`가 `["합성파일이름입니다열두자넘김", ".docx"]`.
  - `getStepCount`: 그 파일의 고정 자료(`sentence_counts: [{ target_doc_id: 2, wi_step: 1, count: 2 }]`)에서 `getStepCount(tobe, 2, 1) === 2`, `getStepCount(tobe, 2, 9) === 0`, `sentence_counts: undefined`면 0.
- [ ] **Step 2: 실패를 본다** — `npx vitest run src/lib/tobe-add-model.test.ts src/lib/row-open.test.ts src/lib/truncate-middle.test.ts src/lib/destination-manage-model.test.ts` → 새 시험 FAIL, 기존 PASS.
- [ ] **Step 3: 넷을 쓴다.** `describeAdd`는 `planAddRows`의 `rows`가 하나면 그 줄의 종류로, `sopFallback`은 `row.doc_type === "sop" && readTypeFromCode(row.code) === "wi"`로 가린다. `shouldRowToggle`은 `target.closest(DRAG_GUARD_SELECTOR)`를 본다.
- [ ] **Step 4: 초록을 본다** — 위 명령 PASS, `npm run lint && npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: 커밋** — `feat(tobe): add the add-field preview and row helpers for the two-line list — 등록 미리 보기와 두 줄 목록의 순수 도우미` (`PROGRESS.md` 포함)

---

### Task 5: 화면 — 줄 틀과 New 목록 두 줄, 펼친 곳

표(`<table>`)를 줄 상자 목록으로 바꾼다. 이 태스크가 끝나면 지금 할 수 있던 일이 모두 새 줄에서 된다. 등록 칸의 자리와 줄의 칸 상태 요약은 Task 6이다(이 태스크에서는 등록 칸을 목록 끝에 그대로 둔다).

**Files:**
- Create: `frontend/src/components/documents/doc-row.tsx`(`DocRow` · `RowAction`), `frontend/src/components/documents/file-name.tsx`(`FileName`), `frontend/src/components/tobe/tobe-row.tsx`(`ToBeRow`), `frontend/src/components/tobe/tobe-panel.tsx`(`ToBePanel`)
- Modify: `frontend/src/components/tobe/tobe-section.tsx`(표를 지우고 줄을 그린다 — `renderDetail`은 `ToBePanel`로 간다), `frontend/src/styles/components.css`(`.tobe-table` 규칙을 지우고 그 자리에), `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(`#tobe-docs` · `#tobe-written` · `#tobe-slots` · `#tobe-save`)
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 둘 + 허락한 변경)

**Interfaces:**
- Consumes: Task 3의 `SlotTable` · `naEdit` · `saveNa` · `restoreNa`, Task 4의 `shouldRowToggle` · `splitFileName`, `getRowOpenProps`, `getDocRemoveBlock`(`destination-manage-model`), `Collapse`(`ui/motion`), `Menu`, `Tooltip`, `ClampText`, `CommitInput`, `Select`, `Checkbox`, `VersionInput`, `MorphButton`, `EquisStatus`, `TitleLock`, `LayoutLabel`, `listEquisHints`.
- Produces:

```tsx
// doc-row.tsx - 두 목록이 같이 쓰는 줄 틀
export interface RowAction {
  key: string; icon: LucideIcon; label: string; testId: string; danger?: boolean;
  /** 꺼진 까닭 - 있으면 단추가 꺼지고 툴팁·메뉴 항목의 작은 글에 뜬다 */
  blocked?: string;
  run: () => void;
}
interface DocRowProps {
  prefix: string;                         // `${prefix}-row` · `-toggle` · `-acts` · `-more` · `-more-menu` · `-panel`
  kind: "old" | "sop" | "wi";             // data-kind - 바탕·나무 선, 다음 계획의 놓을 자리 판정
  isChild?: boolean;                      // SOP 아래 들인 WI - data-child
  open: boolean;
  onToggle: () => void;
  toggleLabel: string;                    // 화살표 단추의 aria-label
  identity: ReactNode;
  title: ReactNode;
  meta: ReactNode;                        // 한 줄
  below?: ReactNode;                      // 딸린 정보 줄 아래 한 줄(다음 계획의 받지 못한 까닭)
  state?: ReactNode;                      // 끝 자리의 상태 표시
  actions: readonly RowAction[];          // 비면 단추와 그 자리가 없다
  panel: () => ReactNode;                 // 펼친 동안만 그린다
  /** 줄 상자(.doc-row)에 그대로 얹는 data-*(다음 계획의 data-drag-box · data-doc) */
  rowData?: Readonly<Record<`data-${string}`, string | undefined>>;
  /** 자리 바꿈(useFlip)의 키 - 줄과 펼친 곳이 함께 움직이게 바깥 상자(.doc-item)에 data-flip-key로 단다. 다음 계획이 쓴다 */
  flipKey?: string;
}
export function DocRow(props: DocRowProps): ReactNode;

// file-name.tsx
export function FileName(props: { name: string; testId?: string; className?: string }): ReactNode;   // 머리(줄어든다) + 꼬리, 전체 이름은 툴팁

// tobe-row.tsx / tobe-panel.tsx - props는 tobe-section이 지금 줄마다 계산하는 값(doc · saved · written · equis · hints · steps · canEdit · saving)과 쓰기 함수(saveDoc · changeType · runWrite · file)다
export function ToBeRow(props: ToBeRowProps): ReactNode;
export function ToBePanel(props: ToBePanelProps): ReactNode;
```

  - `DocRow` DOM(고정 — 스모크 · 감사 · 다음 계획이 기댄다):
    - `<div className="doc-item" data-open={open ? "" : undefined} data-flip-key={flipKey}>` 안에 줄 `<div className="doc-row" data-kind={kind} data-child={isChild ? "" : undefined} data-testid={`${prefix}-row`} tabIndex={0} {...rowData}>`와 `<Collapse open={open} className="doc-panel" testId={`${prefix}-panel`}>`.
    - 줄의 자식 넷: 화살표 `<button className="doc-chev" aria-expanded={open} aria-label={toggleLabel} data-testid={`${prefix}-toggle`}>` · `.doc-id` · `.doc-main`(`.doc-title` + `.doc-meta` + `below`) · `.doc-end`(`.doc-state` + 단추).
    - 단추는 두 모양을 모두 그린다: 묶음 `<span className="doc-acts" data-no-drag data-testid={`${prefix}-acts`}>`(아이콘 단추마다 `Tooltip`, `data-testid={action.testId}`, `blocked`면 `disabled`이고 툴팁이 그 까닭)와 `<span className="doc-more" data-no-drag>` 안의 ⋯ 단추(`aria-haspopup="menu"` · `aria-expanded` · `aria-label={t("manage.rowActions")}` · `data-testid={`${prefix}-more`}`) + `Menu`(`testId={`${prefix}-more-menu`}`, `align="end"`, 항목 `role="menuitem"` · `data-testid={`${action.testId}-item`}`, `blocked`면 `disabled`와 까닭 한 줄).
    - 줄 누름: `getRowOpenProps`의 `onClick`을 `(event) => shouldRowToggle(event.target, 선택이 비어 있지 않은가) && onToggle()`로 감싼다. <kbd>Enter</kbd> · <kbd>Space</kbd>는 그 함수의 `onKeyDown` 그대로(줄 자신에 포커스가 있을 때만).
  - `ToBeRow`가 `DocRow`에 넘기는 것(`prefix = tobe-id-<줄 id>`):
    - `identity`: `<span className="doc-kind" data-testid={`${prefix}-kind`}>`(글 `SOP` | `WI`) · 번호 `<span className="doc-code" data-testid={`${prefix}-code-text`}>`(mono, 두 줄까지, 전체는 툴팁 — `ClampText`) · `EquisStatus compact`(`${prefix}-equis`, 지금 props 그대로).
    - `title`: `<ClampText text={doc.title} testId={`${prefix}-title-text`}>` — 비면 흐린 글 `tobe.row.noTitle`. 잠겼으면 `TitleLock`(`${prefix}-title-lock`).
    - `meta`(이 태스크): 쓴 파일이면 `<FileName testId={`${prefix}-written`} />` + 버전 글, 아니면 `<span data-testid={`${prefix}-not-written`}>`(`tobe.notWritten`). SOP이고 장비 SOP면 `<span data-testid={`${prefix}-equipment-tag`}>`(아이콘 + `tobe.colEquipment`). WI면 `<span data-testid={`${prefix}-steps-count`}>`(`tobe.row.steps`). 저장 안 한 사유가 있으면 `${prefix}-unsaved` 알약.
    - `actions`(`canEdit`일 때만, 아니면 `[]`): `{ key: "edit", icon: Pencil, label: t("common.edit"), testId: `${prefix}-edit`, run: onToggle }`, `{ key: "remove", icon: Trash2, danger: true, label: t("tobe.removeDoc"), testId: `${prefix}-remove`, blocked, run }` — `blocked`는 `getDocRemoveBlock(tobe, saved)`가 `written`이면 `t("tobe.matchLocked")`, `hasSentences`면 `t("assign.tree.why.hasSentences")`, `hasChildren`이면 `t("assign.tree.why.hasChildren")`.
  - `ToBePanel` DOM: 두 칸 `<div className="doc-panel-grid">` — 왼쪽 **Document**, 오른쪽 SOP는 `SlotTable`, WI는 **Steps**. 왼쪽 칸(라벨 + 값, 읽기 전용이면 값만 글자로):
    - **Doc no.** `CommitInput`(`${prefix}-code`, `disabled={!canEdit || isMatch}`, 지금 props 그대로) · **Title** `CommitInput`(`${prefix}-title`, 잠기면 `disabled` + 자물쇠)
    - **Type** 두 칸 단추 `<span className="view-toggle" role="group" data-testid={`${prefix}-type`}>` 안에 `${prefix}-type-sop` · `${prefix}-type-wi`(`aria-pressed`, `disabled={!canEdit || isMatch}`, 누르면 지금의 `changeType`). 옆에 `-hint-type`(있을 때).
    - WI면 **Parent SOP** `Select`(`${prefix}-parent`, 지금 props 그대로), SOP면 **Equipment SOP** `Checkbox`(`${prefix}-equipment`) + `-hint-equipment`(있을 때).
    - 쓴 파일이 있으면 **Written file** 묶음 `${prefix}-written-detail`: 이름 + `VersionInput`(`-written-version`) + `Select`(`-written-layout`) + 단추 `-written-preview` · `-written-download` · (`canEdit`) `-written-delete`.
    - **Steps**(`${prefix}-steps`): 지금의 단계 목록 그대로(번호 · `CommitInput` `-step-<번호>` · `MorphButton` `-remove-step-<번호>` · `-add-step`).
  - 목록 틀: `<div className="doc-list" data-testid="tobe-list">`(컨테이너 질의의 틀). 머리의 줄 수 `<span className="count" data-testid="tobe-count">`.
  - 새 문구(en / ko): `tobe.row.noTitle`: "No title yet" / "제목 없음" · `tobe.row.steps`: "Steps {n}" / "단계 {n}개" · `tobe.panel.document`: "Document" / "문서" · `tobe.panel.steps`: "Steps" / "단계". 지우는 키: `tobe.naCount` · `tobe.stepCount` · `tobe.colDetail`. (`tobe.colCode` · `colTitle` · `colType` · `colParent` · `colEquipment` · `colWritten` · `tobe.details`는 펼친 곳의 라벨과 `list-reader.tsx`가 쓴다 — 남긴다.)

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 둘 다 Task 3의 단계 뒤.

  **단계 A** `new documents: rows read in two lines, a click or Enter opens a row, row-end buttons show on hover or focus`(`halfBundleId`):
  1. **표가 아니다**: `tobe-list` 안에 `table`이 0개, `[data-testid$="-row"]` 수가 API의 `docs` 수와 같고 `tobe-count`의 글이 그 수다. `-code-text`의 글 순서가 SOP마다 그 아래 WI 순서(`orderDocs`)와 같다. SOP 줄은 `data-kind="sop"`, 그 아래 WI는 `data-kind="wi"`이고 `data-child`가 있다.
  2. **줄에는 고치는 칸이 없다**: 닫힌 줄 전체에서 `.doc-row input, .doc-row select`가 0개.
  3. **펼치기**: SOP 줄의 제목 글을 누르면 `-panel`이 보이고 `-toggle`의 `aria-expanded="true"`, 다시 누르면 닫힌다. 줄에 포커스를 주고 <kbd>Enter</kbd> → 열리고 <kbd>Space</kbd> → 닫힌다(쪽이 스크롤되지 않는다 — `scrollY` 그대로). 여러 줄을 함께 펼쳐 둘 수 있다(둘을 열면 `-panel` 둘).
  4. **글자를 긁은 것은 펼침이 아니다**: SOP 줄의 제목 글 위에서 누른 채 60px 움직였다 떼면(`getSelection().toString()`이 비어 있지 않다) `-panel`이 0개다.
  5. **줄 끝 단추**: 평소 `-acts`의 `opacity`가 0, 줄에 올리면 1, 떠나면 0. Tab으로 `-edit`에 가면 1이다. 모든 줄의 `-acts` 오른쪽 끝 x가 ±1px 안이다. `-edit`를 누르면 그 줄이 펼쳐진다.
  6. **빼기가 꺼진 까닭**: 아래 WI가 있는 SOP의 `-remove`가 `disabled`이고 올리면 툴팁 글이 "WIs sit under this SOP. Delete them first.". `sentence_counts`에 든 WI의 `-remove`는 "Sentences are assigned here. Clear them first.". 누름으로 `DELETE` 요청이 가지 않는다.
  7. **좁은 틀**: `page.setViewportSize`로 창 폭을 900으로 줄이면(목록 틀이 문턱보다 좁아야 한다 — Task 7이 문턱을 바꾸면 이 폭도 맞춘다) `-acts`가 `display: none`이고 줄에 올리면 `-more`가 보인다. `-more` → `-more-menu`에 `-edit-item` · `-remove-item`이 있고 `-edit-item`을 고르면 줄이 펼쳐진다. 메뉴는 바깥 누름과 <kbd>Esc</kbd>로 닫히고, 열려 있는 동안 그 줄의 `-more`는 포인터가 떠나도 `opacity` 1이다. 창 폭을 되돌린다.
  8. **펼친 곳에서 고친다**: WI 줄을 펼쳐 `-parent`가 지금 상위 SOP 번호를 보이고, `-type-wi`의 `aria-pressed="true"`. 쓴 파일이 붙은 줄(있으면)은 `-code`와 `-type-sop` · `-type-wi`가 `disabled`다.

  **단계 B** `new documents: a reviewer reads the rows and the section table, nothing edits`(`devUser: "qa.lead"`, 검토 대기 묶음 — `reviewer sees the bundle in review` 단계가 찾는 묶음): 줄이 눌러 펼쳐지고, `tobe-list` 안에 `input` · `select` · `[role="checkbox"]`가 0개, `-acts` · `-more` · `-remove` · `-edit`가 0개, 펼친 SOP의 `…-slots` 안에 `button[data-testid$="-mark"], button[data-testid$="-edit"], button[data-testid$="-restore"]`가 0개, `tobe-add-row`가 0개. 번호 · 제목 · 종류 · 상위 SOP가 글자로 보인다.

  **허락한 변경**(위 표): `new documents: nested rows…`(번호 읽기 · 펼친 뒤 고치기 · `-type-wi`), `documents: an Old list and a New list…`(펼친 뒤 미리 보기, `-row`), `documents: AI reads a free-form list…`(`-code-text`).
- [ ] **Step 2: 실패를 본다** — `ONLY="new documents:,documents:"` → 새 단계 둘과 고친 확인이 FAIL.
- [ ] **Step 3: `doc-row.tsx` · `file-name.tsx`.** Interfaces의 DOM대로. `DocRow`는 React 상태로 메뉴가 열렸는지만 든다. `FileName`은 `splitFileName`의 두 조각을 `<span className="file-name">` 안에 머리(`min-width: 0`, 말줄임) · 꼬리(`flex: none`)로 그리고 `Tooltip`으로 전체 이름을 보인다(`tabIndex={0}`).
- [ ] **Step 4: `tobe-row.tsx` · `tobe-panel.tsx` · `tobe-section.tsx`.** `tobe-section.tsx`의 `<table>`과 `renderDetail`을 지우고 `rows.map`이 `ToBeRow`를 그린다. 줄마다 계산하던 값(`isMatch` · `written` · `equis` · `isTitleLocked` · `hints`)과 쓰기 함수는 props로 넘긴다 — 자료 읽기 · `runWrite` · 머리 · 메뉴 · 등록 칸 · 창들은 `tobe-section.tsx`에 남는다. 등록 칸(`tobe-add-row`)은 `<form>`째 목록 틀 아래에 둔다(Task 6이 올린다). 뼈대(`showSkeleton`)는 줄 상자 넷(식별 · 제목 · 딸린 정보 자리의 `.sk`).
- [ ] **Step 5: CSS**(토큰만. 값은 시안에서 시작해 Task 7에서 재어 정한다).
  - `.doc-list { container: doc-list / inline-size; }`. `.doc-row`: `display: grid; grid-template-columns: 24px var(--doc-id-w) minmax(0, 1fr) auto; column-gap: 10px; align-items: start; padding: 9px var(--pad); border-bottom: 1px solid var(--line);` — New 목록의 `--doc-id-w`는 212px에서 시작한다.
  - SOP 줄(`[data-kind="sop"]`)과 그 펼친 곳은 옅은 바탕(`--sunken` 계열). 들인 WI(`[data-child]`)는 왼쪽을 28px 들이고 세로 나무 선(`--line-2`)과 화살표 높이의 가로 선을 `::before` · `::after`로 긋는다. 펼친 곳도 같은 세로 선을 잇는다.
  - `.doc-main > * { min-width: 0 }`. `.doc-title`은 `.clamp-2`(600, `overflow-wrap: anywhere`). `.doc-code`는 mono, 두 줄까지. `.doc-meta`: 한 줄(`display: flex; flex-wrap: nowrap; gap: 12px; overflow: hidden; white-space: nowrap`), 작은 글(`--ink-3`).
  - `.doc-end`: `display: flex; align-items: center; gap: 8px`. `.doc-acts`: `display: none`, 폭은 단추 수만큼 고정(`--doc-acts-w`, New 52px). `.doc-more`: 24px. `@media (hover: hover)`에서 `.doc-acts, .doc-more { opacity: 0; transition: opacity var(--dur-fast) }`, `.doc-row:is(:hover, :focus-within) :is(.doc-acts, .doc-more), .doc-more:has([aria-expanded="true"]) { opacity: 1 }`. `(hover: none)`에서는 늘 1.
  - 넓음 · 좁음: 기본은 `.doc-more`를 보이고 `@container doc-list (min-width: 880px)`에서 `.doc-acts { display: flex }` · `.doc-more { display: none }`.
  - `.doc-panel-grid`: `grid-template-columns: minmax(0, 280px) minmax(0, 1fr); gap: 12px 28px`, 좁으면 한 칸으로 쌓인다(`@container doc-list (max-width: …)`). 안쪽 스크롤을 만들지 않는다.
  - 올림 바탕은 `:where(html:not([data-box-drag])) .doc-row:hover { background: var(--hover) }`(다음 계획의 끌기가 끈다).
- [ ] **Step 6: 문구 · 사용 설명서.** 문구 넷과 지우는 키 셋. 설명서 `#tobe-docs`의 열 표를 줄 설명으로 바꾼다 — 줄 왼쪽에 종류(SOP · WI)와 번호, 가운데에 제목과 딸린 정보(쓴 파일 또는 **Not written**, **Equipment SOP**, 단계 수), 줄에 올리거나 Tab으로 들어가면 오른쪽 끝에 **Edit** · **Remove** 가 보이고 창이 좁으면 **Actions** 메뉴 하나가 같은 일을 한다는 것, **줄을 누르거나 <kbd>Enter</kbd>로 펼치면 고치는 칸이 나온다**는 것(**Doc no.** · **Title** · **Type** · **Parent SOP** · **Equipment SOP**), 뺄 수 없는 줄은 **Remove** 가 꺼지고 올리면 까닭이 뜬다는 것. `#tobe-written`: 쓴 파일은 줄의 둘째 줄에 이름이 보이고, 펼치면 **Written file** 에서 버전 · 언어 배치를 고치고 미리 보기 · 내려받기 · **Delete the written file** 을 한다. `#tobe-slots` · `#tobe-save`: "줄에서 고칩니다"를 "펼쳐서 고칩니다"로, **N/A or steps** 열의 말을 지운다. `manual-content.test.ts` 통과.
- [ ] **Step 7: 초록을 본다** — `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, 갓 시드한 DB에서 `ONLY="new documents:,documents:"` 전부 PASS(고치지 않은 `new documents: removing a step keeps the other numbers`도), `npm run build` 경고 0.
- [ ] **Step 8: 커밋** — `feat(documents): read the New list in two-line rows and edit in the expanded row — New 목록을 두 줄 줄로, 고치기는 펼친 곳에서` (`PROGRESS.md` 포함)

---

### Task 6: 화면 — 등록 칸과 줄의 칸 상태 요약

**Files:**
- Create: `frontend/src/components/tobe/slot-bar.tsx`(`SlotBar`)
- Modify: `frontend/src/components/tobe/tobe-section.tsx`(등록 칸 · 더한 줄 강조 · 부모 없는 WI 묶음), `tobe-row.tsx`(딸린 정보 줄), `tobe-panel.tsx`(단계의 문장 수), `frontend/src/styles/components.css`, `frontend/src/lib/i18n-messages.ts`, `frontend/public/manual/user-manual.md`(`#tobe-docs` · `#tobe-slots`)
- Test: `frontend/scripts/pw-smoke-sop.mjs`(새 단계 하나)

**Interfaces:**
- Consumes: Task 2의 `buildSlotRows` · `summarizeSlots` · `SlotRow`, Task 4의 `describeAdd` · `ADD_PREVIEW_KEYS` · `getStepCount`, `getStepRemoveBlock`, `flashElement`(`ui/motion`), `useDelegatedTip`, `orderDocs`.
- Produces:

```tsx
// slot-bar.tsx - 칸 15개의 눈금. 장식이라 aria-hidden이고 뜻은 옆의 글이 말한다
export function SlotBar(props: { rows: readonly SlotRow[]; testId: string }): ReactNode;
// <span className="slot-bar" aria-hidden="true" data-testid={testId}> 안에 눈금 15개 <i data-state={state.kind} data-child={…} data-tip={`${number} ${label} · ${상태 글}`} />
```

  - `ToBeRow`의 `meta`(SOP 줄, 이 순서): `<SlotBar testId={`${prefix}-bar`} />` · `<span data-testid={`${prefix}-filled`}>`(`tobe.row.filled`, total 15) · N/A가 있으면 `<span data-testid={`${prefix}-na-summary`}>`(**N/A** 칩 + n, 이어서 `<span className="meta-na-name">`에 첫 N/A 칸의 "번호 이름"과 둘 이상이면 ` +k`) · decide > 0이면 `<span className="pill warn" data-testid={`${prefix}-decide`}>` · 쓴 파일 또는 **Not written** · **Equipment SOP**(아이콘 + `<span className="meta-eq-text">`) · EQUIS 제안이 있으면 `<button className="equis-hint" data-testid={`${prefix}-hints`}>`(`tobe.row.equisHints`, 누르면 펼친다) · `-unsaved`. **이미 쓴 SOP**는 막대와 `-filled`를 그리지 않는다. N/A 수는 `summary.na`(덮인 칸 포함)다.
  - WI 줄의 `meta`: 쓴 파일 + 버전 또는 **Not written** · `-steps-count` · 부모를 못 찾았으면 `<span className="pill warn" data-testid={`${prefix}-no-parent`}>`.
  - 단계: 이름 옆 `<span data-testid={`${prefix}-step-${no}-count`}>`(수가 0보다 클 때만, `tobe.slots.sentences` · `sentenceOne`). `getStepRemoveBlock`이 `null`이 아닌 단계는 `-remove-step-<번호>`를 그리지 않는다.
  - 등록 칸: `<form data-testid="tobe-add-row">`가 목록 머리 바로 아래(`tobe-list`의 첫 줄 위)로 간다. 입력 `tobe-add-code` · 단추 `tobe-add` · 그 옆 `<span data-testid="tobe-add-preview" aria-live="polite">`(적은 것이 없으면 지금의 `tobe.addHint`).
  - 부모 없는 WI: 그런 줄이 있으면 그 앞에 `<div className="doc-loose" data-testid="tobe-loose">`(`tobe.row.noParent` + 수).
  - 새 문구(en / ko):
    - `tobe.row.filled`: "{filled} of {total} sections filled" / "칸 {total}개 중 {filled}개 채움"
    - `tobe.row.equisHints`: "EQUIS suggests {n}" / "EQUIS 제안 {n}개"
    - `tobe.row.noParent`: "No parent SOP" / "상위 SOP 없음"
    - `tobe.add.sop`: "Adds SOP {code}" / "SOP {code} 줄을 더합니다"
    - `tobe.add.wi`: "Adds WI {code} under {parent}" / "WI {code} 줄을 {parent} 아래에 더합니다"
    - `tobe.add.sopFallback`: "No SOP on the list yet, so {code} is added as an SOP" / "목록에 SOP가 없어 {code}를 SOP로 더합니다"
    - `tobe.add.taken`: "{code} is already on the list" / "{code}는 이미 목록에 있습니다"
    - `tobe.add.many`: "Adds {n} documents" / "문서 {n}개를 더합니다"

- [ ] **Step 1: 실패하는 스모크 단계를 먼저 쓴다.** 이름 `new documents: the add field says what it will add, a row shows its sections at a glance`, Task 5의 단계 뒤(`halfBundleId`, 끝에 더한 줄을 API로 지운다):
  1. **등록 칸의 자리**: `tobe-add-row`의 위쪽 y가 첫 줄(`-row`)의 위쪽 y보다 작다.
  2. **미리 보기**: "WI-77" → `tobe-add-preview`가 "Adds WI WI-77 under SOP-CF". "SOP-77" → "Adds SOP SOP-77". 목록에 있는 번호(API에서 읽은 첫 WI) → "`<그 번호>` is already on the list"이고 `tobe-add`가 꺼져 있다. "A-1, B-2" → "Adds 2 documents". 비우면 "Type a number and press Enter. Paste several lines to add them all.".
  3. **더하면**: "WI-77" + <kbd>↵</kbd> → 그 줄이 `SOP-CF` 아래에 생기고 `data-flash`가 붙으며 화면 안에 있다(`getBoundingClientRect`가 창 안). 포커스가 `tobe-add-code`에 있고 값이 비었다.
  4. **칸 상태 막대**: SOP 줄의 `-bar`가 `aria-hidden="true"`이고 눈금 15개의 `data-state` 순서가 그 줄을 펼친 표의 `[data-slot]`의 `data-state` 순서와 같다. 눈금에 올리면 툴팁이 칸 이름을 담는다.
  5. **요약 글**: `-filled`가 `${filled} of 15 sections filled`(표에서 센 `filled`+`sub`), `-na-summary`가 `N/A ${n}`과 "6.3 Troubleshooting"을 담고, `-decide`가 `${n} to decide`(표의 `decide` 수, 0이면 0개).
  6. **단계의 문장 수**: `sentence_counts`에 든 (WI, 단계)의 줄을 펼치면 그 단계에 `-step-<번호>-count`가 `${count} sentences`(1이면 `1 sentence`)이고 `-remove-step-<번호>`가 0개, 문장이 없는 단계에는 `-count`가 없고 빼기 단추가 있다. 줄의 `-steps-count`가 `Steps ${단계 수}`.
  7. **부모 없는 WI**(Review Focus 4): `page.route("**/api/bundles/*/tobe", …)`로 `GET` 응답의 WI 하나의 `parent_code`를 `"GHOST"`로 바꿔 다시 읽으면 `tobe-loose`의 글이 "No parent SOP"를 담고 그 줄이 목록의 마지막이며 `-no-parent` 알약이 있다. 그 줄을 펼치면 `-parent`가 있다. `page.unroute`.
- [ ] **Step 2: 실패를 본다** — `ONLY="new documents:"` → 새 단계만 FAIL.
- [ ] **Step 3: `slot-bar.tsx`와 `tobe-row.tsx`.** `buildSlotRows` · `summarizeSlots`는 줄마다 렌더에서 한 번(SOP 줄만). 막대의 툴팁은 `tobe-section.tsx`가 목록 틀에 `useDelegatedTip`을 하나 걸어 띄운다.
- [ ] **Step 4: `tobe-section.tsx` — 등록 칸과 강조.** 폼을 머리 아래로 옮기고 `describeAdd(adding, tobe.docs)`로 미리 보기를 적는다(`kind: "none"`이면 `tobe.addHint`, 아니면 `t(ADD_PREVIEW_KEYS[kind], …)`). **Add** 는 `saving`이거나 더할 줄이 없으면(`none` · `taken`) 꺼진다. `addCodes`가 끝나면 마지막으로 더한 번호의 줄을 다음 커밋 뒤에 `flashElement`하고 창 밖이면 `scrollIntoView({ block: "nearest" })`, 포커스는 입력에 둔다(이펙트에서 — 렌더 중에 DOM을 읽지 않는다). 지금의 알림(`tobe.added` 등)은 그대로다.
- [ ] **Step 5: `tobe-panel.tsx` — 단계.** 문장 수와 빼기 단추 숨김.
- [ ] **Step 6: CSS.** `.slot-bar`: 눈금 5 × 12px(하위 칸 8px), 틈 2px, 아래 맞춤. 상태는 모양으로도 갈린다 — `filled` · `sub`는 채움(`--ink-3`), `empty`는 테두리만(`--line-2`), `na` · `covered`는 빗금(`repeating-linear-gradient`, 토큰 색), `decide`는 호박색 테두리와 눈금 위의 점. `.doc-meta { container: doc-meta / inline-size }`와 줄어드는 순서: `.meta-na-name` → `.meta-eq-text` → `.slot-bar`를 좁아지는 차례로 `display: none`(문턱 셋은 560 · 480 · 400px에서 시작해 Task 7에서 잰다), 파일 이름은 `min-width: 96px`로 줄어든다. `-filled` · N/A n · `-decide` · **Not written** 은 줄지 않는다(`flex: none`).
- [ ] **Step 7: 문구 · 사용 설명서.** 문구 여덟. 설명서 `#tobe-docs`: 번호로 더하는 칸이 목록 머리 바로 아래에 있고, 적는 동안 옆에 무엇이 더해질지(종류와 어느 SOP 아래인지)가 적힌다는 것, 목록에 SOP가 없을 때 WI 번호는 SOP로 더해진다는 것. SOP 줄의 둘째 줄에 칸 15개의 막대와 "7 of 15 sections filled"처럼 채운 칸 수, **N/A** 수와 첫 N/A 칸, 장비 SOP의 정할 칸 수가 보인다는 것(이미 쓴 SOP는 막대 없이). `#tobe-slots`: 단계마다 문장 수가 적히고 문장이 든 단계에는 **Remove step** 이 없다.
- [ ] **Step 8: 초록을 본다** — Task 5 Step 7과 같은 명령.
- [ ] **Step 9: 커밋** — `feat(documents): move the add field under the list head and show each SOP's sections on its row — 등록 칸을 머리 아래로, 줄에 칸 상태 막대와 요약` (`PROGRESS.md` 포함)

---

### Task 7: 극단 자료 · 좁은 창 검토와 올리기 준비

**Files:**
- Modify(필요할 때만): Task 3 · 5 · 6의 CSS와 부품
- Modify: `frontend/scripts/pw-layout-audit.mjs`(`A1` · `C3`) · `pw-overlap-audit.mjs`(`mbtnScenes`의 `tobe`) · `pw-contrast-audit.mjs`(장면 하나 더)
- Modify: `frontend/package.json` · `package-lock.json`, `CHANGELOG.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-11-17-documents-screen-design.md`, `docs/README.md`, `docs/lessons/ui-review.md`(13번), `frontend/docs/design/2026-11-07-frontend-design-foundations.md`(§11), `frontend/CLAUDE.md`

**Interfaces:**
- Consumes: Task 1~6.
- Produces: `dev`에 합칠 수 있는 브랜치(푸시 · 합치기는 조율하는 세션이 한다). 다음 계획이 받는 값 — `--doc-id-w` · `--doc-acts-w` · 넓음/좁음 문턱의 확정값.

- [ ] **Step 1: 극단 자료로 다시 시드한다**(`seed_sop_demo` → `seed_sop_worst`, 버려도 되는 DB). W1 묶음(New 줄 52개 — SOP 30 · WI 22, 번호 100자, 제목 480자 · 공백 없는 435자 · 빈 것, 단계 0~40개, 1,990자 사유)의 Documents에서 창 폭 1120과 2560, 라이트 · 다크, en · ko로 스크립트(`playwright-core` + 시스템 Chrome)가 잰다. 눈으로만 보지 않는다. **처방은 `page.addStyleTag`로 주입해 전 · 후를 잰 뒤 값을 정하고**, 겹치면 고친다(보고만 하지 않는다).
  - **줄**: 모든 `.doc-row`의 `scrollWidth ≤ clientWidth`이고 목록 틀(`tobe-list`)에 가로 스크롤이 없다. 제목 상자의 높이가 두 줄(줄 높이 × 2) 이하, 번호가 두 줄 이하, 딸린 정보 줄이 한 줄(높이 한 줄)이다. 줄 높이가 호버로 변하지 않는다(올리기 전 · 후 `getBoundingClientRect().height` 같음).
  - **식별 자리**: 14자 번호(`SOP-CDO-111334` — 응답을 바꿔 그린다)가 종류 표 · EQUIS 아이콘과 한 줄에 들어가는 `--doc-id-w`를 정한다(en · ko 같다). 100자 번호는 두 줄에서 잘리고 툴팁이 전체를 보인다.
  - **줄 끝 단추**: 올린 줄의 `-acts`(또는 `-more`)가 제목 · 딸린 정보 글과 겹치는 px가 0, 오른쪽 끝이 줄마다 같다(±1px). 넓음 · 좁음의 문턱을 정한다 — 1120 창에서 어느 쪽이 맞는지 재고(단추 묶음이 제목 폭을 얼마나 빼앗는지), 문턱 바로 위 · 아래 폭에서 두 모양이 겹쳐 보이지 않는다. 1248 창에서는 묶음 모양이다(판단 11).
  - **딸린 정보 줄의 문턱 셋**: 가장 긴 SOP 줄(막대 + "15 of 15 sections filled" + **N/A** 4 + 첫 칸 이름 + "3 to decide" + 255자 파일 이름 + **Equipment SOP** + EQUIS 제안 칩 + "Unsaved N/A reason" — 응답을 바꿔 그린다)에서 줄이 한 줄을 넘지 않게 문턱을 정한다(en · ko). 끝까지 남는 넷이 잘리지 않는다.
  - **표**: 1,990자 사유가 두 줄에서 잘리고, 펴면 그 단 안에서만 길어진다(옆 단의 폭 · 표 틀의 `scrollWidth` 그대로). 공백 없는 2,000자 사유도 같다(Review Focus 5 — 응답을 바꿔 그린다). 쓴 사유 칩이 한 줄이고 폭 240px 이하다. 1120에서 한 단, 넓은 틀에서 두 단이고 경계가 5.2와 6 사이다. 편집기의 단추 둘과 `<kbd>`가 줄 밖으로 나가지 않는다.
  - **펼친 곳**: 단계 40개인 WI를 펼치면 화면 스크롤 하나로 흐른다(펼친 곳에 `overflow` 스크롤이 없다). 100자 번호의 **Parent SOP** 고르기 칸이 왼쪽 칸 폭을 넘지 않는다.
  - **2560**: 본문 상한(1600) 안에서 줄의 빈 자리가 한쪽으로 몰리지 않는다 — 제목 상자가 남는 폭을 받고 단추 자리가 오른쪽 끝이다.
  - **다크 테마 · 대비**: 막대의 네 눈금(채움 · 테두리 · 빗금 · 호박색)이 구별되고, 흐린 글(**Empty** · "From the file" · 딸린 정보)의 대비를 `pw-contrast-audit.mjs`의 계산 방식으로 잰다(모자라면 토큰을 한 단 진하게).
  - 움직임 줄이기(`prefers-reduced-motion`)에서 펼침과 강조가 바로 끝난다.
- [ ] **Step 2: 감사 스크립트를 새 화면에 맞춘다**(허락한 변경). `A1`: `tobe-list`의 줄 상자가 틀 안에 있고 `.doc-id`의 폭이 Step 1에서 정한 값 이상. `C3`: 펼친 SOP의 `…-slots`가 1920에서 두 단이고 높이가 Step 1에서 잰 값 이하(값과 잰 날을 `note`에 적는다). `pw-overlap-audit.mjs`: `mbtnScenes`의 `tobe`를 빼고, 올린 줄의 `-acts`가 `.doc-title` · `.doc-meta`의 글 상자와 겹치지 않는 장면을 더한다(`tobe-steps`는 그대로). `pw-contrast-audit.mjs`: `tobe` 장면에 SOP 줄 하나를 펼친 장면을 더한다(표와 막대의 글 · 눈금).
- [ ] **Step 3: 전체 검증.** backend: `$PY -m pytest tests/ -q -n auto`, `ruff check app/ tests/`. frontend: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, `npm run build` 경고 0. 갓 시드한 DB(`seed_sop_demo`)에서 전체 스모크(이 계획의 새 단계 다섯 PASS, 실패가 Task 3 Step 2에서 적어 둔 기준선보다 늘지 않음) → 다시 시드(`seed_sop_demo` → `seed_sop_worst`) → `pw-overlap-audit.mjs`, `DS=worst pw-layout-audit.mjs`, `pw-contrast-audit.mjs`.
- [ ] **Step 4: 버전과 기록.** `frontend/package.json`의 지금 버전을 읽고(`dev`의 값 — 1.1.8일 것이다) `frontend/`에서 `npm version patch --no-git-tag-version`(1.1.9가 될 것이다 — 아래의 `vX.Y.Z`는 그 결과다). `CHANGELOG.md` `## Unreleased (dev)` 아래 `### vX.Y.Z — <이 커밋을 만드는 날>`: New 목록이 두 줄 줄이 된 것(값은 글자, 고치기는 펼친 곳, 줄 끝 단추는 호버 · 포커스 · 좁으면 **Actions** 메뉴), 등록 칸이 머리 아래로 오고 미리 보기가 붙은 것, 줄의 칸 상태 막대와 요약, N/A 칸 상태 표(**Mark N/A** · **Save N/A** · **Edit reason** · **Restore**, 쓴 사유 칩, 적던 사유가 사라지지 않는 것), 단계의 문장 수, 서버 `slot_counts`. 알려진 한계 — **Restore** 는 바로 지운다(알림의 **Undo** 는 다음 PATCH), 칸 제목에 Old 제목만 이어진 칸은 N/A로 둘 수 없다(Assign에서 먼저 끊는다), 이미 쓴 SOP는 문장 수 없이 "From the file"로 보이고 그 N/A는 결과물에 찍히지 않는다(전부터 그랬다), Old 목록과 올리기 창은 아직 전 모양이다. `PROGRESS.md`는 이 브랜치의 항목을 요약 하나로 줄이고 판단 25의 한 줄을 남긴다. 설계 문서: §13의 1 · 2걸음에 "(vX.Y.Z로 dev에 올렸다.)", §8 · §6 끝에 "1·2걸음에서 정한 것" 묶음으로 위 "이 계획이 정한 것"과 "설계와 코드가 어긋난 곳"을 "(내 판단)" 한 줄씩, §14의 값(식별 자리 폭 · 문턱)을 잰 값으로. `docs/README.md`의 설계 · 계획 줄 상태. `docs/lessons/ui-review.md` 13번과 디자인 기초 §11의 "Documents는 Documents 화면 설계에서 적용한다"를 "Documents는 줄 안 오른쪽 끝에 단추 자리를 비워 두고 호버 · 포커스 때만 보인다(넓으면 묶음, 좁으면 ⋯ — Documents 화면 설계 §4)"로 바꾼다. `frontend/CLAUDE.md`: 순수 모델 목록에 "`slot-status-model`(SOP 칸의 여섯 상태 · 요약 · N/A 사유 편집기 하나)", 공통 부품에 "`components/documents/doc-row.tsx`(두 줄 줄 틀 — 줄 끝 단추는 호버 · 포커스, 좁으면 ⋯)".
- [ ] **Step 5: 커밋** — `chore(release): vX.Y.Z, two-line New list and the N/A section table — New 목록 두 줄과 N/A 칸 상태 표 (vX.Y.Z)`

---

## Self-Review 기록

- **설계 대비**: §10(`slot_counts`의 뜻 · 정렬 · "막힘의 같음" · `sentence_counts` 그대로 · 프런트 타입)은 Task 1. §8의 여섯 상태 · 덮임 · 하위 칸의 자기 N/A · 칸 제목만 이어진 칸 · 이미 쓴 SOP · 요약 · 쓴 사유 · 편집기 하나는 Task 2(모델)와 Task 3(화면 · 스모크 1~13). "칸을 떠나도 아무 일도 없다" · "줄을 접어도 남는다" · 이탈 가드는 Task 3 스모크 5 · 7 · 8. §4의 줄 틀(세 자리 · 두 줄 제목 · 한 줄 딸린 정보 · 줄 누름과 <kbd>Enter</kbd> · <kbd>Space</kbd> · 줄 끝 단추 · 읽기 전용 · 줄 수)과 §6의 줄 · 펼친 곳 · **Remove** 의 까닭은 Task 5, 등록 칸 · 미리 보기 · 막대 · 요약 · EQUIS 칩 · 부모 없는 WI · 단계의 문장 수는 Task 4(모델)와 Task 6. §12의 극단 자료 · 감사는 Task 7. §13의 "`docs/README.md` 인덱스"는 Task 1, "`ui-review.md` 13번과 디자인 기초 11절"은 Task 7. §15의 택한 쪽 넷(Unit 수 안 넣음 · 이미 쓴 SOP의 N/A 그대로 · 칸 제목만 이어진 칸은 화면이 까닭을 적음 · 상위 없는 WI를 만들지 않음)은 그대로 따랐다.
- **이 계획 밖(다음 계획)**: §5(Old 목록) · §7(WI를 SOP에 끌기 · 알림의 Undo · Restore의 Undo) · §9(올리기 창), 그리고 `data-drag-box` · `[data-flash]` 자리 바꿈.
- **Review Focus의 시험**: 1 → Task 3 스모크 13. 2 → Task 3 스모크 7 · 8 · 9 + Task 2 "keeps one editor". 3 → Task 2 "treats a missing or unknown count as empty". 4 → Task 6 스모크 7. 5 → Task 2 "lists the reasons used most…" + Task 7 Step 1(표).
- **하지 않는 것**: 서버의 N/A 규칙 바꾸기(칸 제목만 있는 칸 풀기 · 이미 쓴 SOP의 N/A 없애기), `sentence_counts`에 칸 키 더하기, New 문서 · 단계의 순서 바꾸기, Old 줄의 Unit 수, 상위 없는 WI 허용, 줄에서 바로 고치는 칩, 줄 끝 메뉴에 **Parent SOP** 항목, 사용 설명서 그림 다시 뽑기.
- **이름 맞춤**: `SlotRow` · `SlotSummary` · `NaEdit` · `openNaEdit` · `isNaEditDirty`는 Task 2가 정하고 Task 3 · 6이 쓴다. `runWriteResult` · `saveNa` · `restoreNa` · `naEdit`는 Task 3이 정하고 Task 5가 옮긴다(이름 그대로). `DocRow` · `RowAction` · `FileName`과 `.doc-row[data-kind]` · `data-child` · `rowData` · `flipKey`는 Task 5가 정하고 다음 계획이 쓴다. `data-testid`: 칸 줄 `…-slot-<칸 키>`(`data-slot` · `data-state`), 단추 `…-na-<칸 키>-mark|edit|restore|save|cancel`, 입력 `…-na-<칸 키>-reason`(지금 이름), 줄의 글 `-code-text` · `-title-text`, 펼친 곳의 칸은 지금 이름.
