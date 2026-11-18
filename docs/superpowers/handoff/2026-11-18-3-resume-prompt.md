# 이어 하기 프롬프트 — 표 풀기 · 표준화 (2026-11-18 저녁에 멈춘 곳부터)

새 세션에 아래 "프롬프트"를 그대로 붙여 넣는다. 그 아래는 멈춘 시점의 상태 기록이다.

## 프롬프트

> 저장소 `sop-archivist`의 "표 풀기 · 표준화" 작업을 멈춘 곳부터 이어서 한다. 워크트리 `/Users/hyeonjin/Documents/sop-archivist-template`의 아래 문서를 순서대로 읽어라.
>
> 1. `docs/superpowers/handoff/2026-11-18-3-resume-prompt.md` — 이 문서. 멈춘 시점의 브랜치 · 워크트리 상태와 남은 일.
> 2. `docs/superpowers/handoff/2026-11-18-1-unwrap-standardize.md` (MD 1) — 본문 §0–12. 브랜치 순서는 §10 한 곳.
> 3. `docs/superpowers/handoff/2026-11-18-2-followups.md` (MD 2) — 본문 §0–10.
> 4. `docs/superpowers/plans/2026-11-17-template-fit-1-outline-plan.md` — 골격 스텝 5 · 6(Task 5 · 6).
> 5. 그 워크트리의 `PROGRESS.md` 맨 위 항목들(스텝 1–4의 결과와 남은 것).
>
> 규칙
> - 기준은 MD 본문이다. 부록의 HTML · CSS는 참고용 목업이라 마크업 · 클래스 이름을 옮기지 않는다. 두 MD는 사진을 OCR로 옮긴 사본이니, 부록의 색 · 소수점 · 기호가 이상하면 고치지 말고 물어라. 문서에 없는 것은 추측하지 말고 물어라.
> - **하위 에이전트를 띄울 때는 `model`을 반드시 지정한다. 메인 세션의 모델을 물려받게 두지 않는다**(2026-11-18 사용자 지적: Fable을 물려받아 토큰을 많이 썼다). 어느 모델로 띄울지 내가 말하지 않았으면 시작할 때 한 줄로 물어라.
> - 이 작업이 끝날 때까지 나 혼자 작업한다. 브랜치가 끝나면 바로 `dev`에 합치고(PATCH · CHANGELOG · PROGRESS, GitHub `origin`에만 푸시) 다음으로 간다. 빠르게 한다 — 서로 기다리지 않는 브랜치는 병렬로 돌린다.
> - 내 결정이 필요한 것은 HTML로 이해시키고 물어라(지금/바뀐 뒤를 나란히 보이는 한 장). 급하지 않은 결정은 다른 브랜치를 하면서 모아 둔다.
> - 브랜치를 시작할 때 계획과 기본값(MD 1 §11, MD 2 §9)을 보여 주고, 내 확인이 필요 없으면 그대로 구현한다. 끝나면 결과를 보고하고 큰 문제가 없으면 계속한다.
> - 저장소 CLAUDE.md의 절차와 체크리스트를 따른다. 하위 에이전트는 서버 · 브라우저를 띄우지 않고, 스모크 · 화면 확인은 메인 세션이 브랜치 끝에 한다. 작업 단위는 "스텝"이라고 쓴다("걸음" 아님).
>
> 먼저 이 문서의 "멈춘 시점 상태"가 지금 워크트리 · 브랜치와 맞는지 `git worktree list`와 각 브랜치의 `git log -3`로 확인하고, 다른 곳이 있으면 보고한 뒤 "다음에 할 일" 1번부터 진행해라.

## 멈춘 시점 상태 (2026-11-18 약 19:30)

- `origin/dev` = v1.1.29(`af5b019`). 골격(스텝 1–4)은 아직 `dev`에 없다.
- 바탕 커밋 `f000e35` = `feat/outline`(스텝 1–4) + `dev` v1.1.29 합침(`6ae301e`, backend 2,843 · vitest 1,310 통과) + 핸드오프 문서 둘. 아래 다섯 브랜치는 모두 이 커밋에서 땄고, 맨 위 커밋이 **`chore(wip)` 보존 커밋**이다(합칠 수 있는 상태가 아니다 — 끝낸 뒤 제대로 된 커밋을 더한다).
- GitHub의 `origin/feat/outline`은 스텝 4(`ef6d0ba`)까지만 올라가 있다. 그 뒤(`dev` 합침, 핸드오프 문서, 아래 브랜치)는 로컬에만 있다.

| 브랜치 | 워크트리 | 무엇 | 멈춘 곳 | 남은 것 |
|---|---|---|---|---|
| `feat/outline-5-declare`(`38c689c`) | `sop-archivist-template` | 골격 스텝 5 — 절차 · 부록 · 범주 선언 | backend: `outline_edit.py` · 엔드포인트 · Excel `SOP 절차` 시트 · 되돌리기 거절까지 썼고 `test_sop_outline_edit.py` 18개 + `test_sop_tobe` · `test_sop_decision_undo`(218개) 통과, ruff 통과. frontend: 끝남(vitest 1,327 · lint · tsc 통과) | backend 전체 pytest를 아직 돌리지 않았다. 구현 에이전트의 마지막 보고를 못 받았으니 계획 Task 5와 코드를 대조한다(거절 코드 목록, "번호 다시 쓰지 않기" 방식 — 뺀 선언 항목을 `is_removed`로 남기는 것으로 보인다, API 계약 블록). Documents 화면을 직접 보고 스모크(`ONLY="declare a procedure"`, `new documents:`), 스텝 diff 검토, 커밋, `feat/outline`에 합침 |
| `feat/assign-new-ai-filter`(`4ea1fb4`) | `sop-archivist-wa` | a — MD 2 S4, New 쪽 AI 제안 필터(프런트만) | 모델 `new-ai-filter-model.ts` + 시험, 보기 설정 `sopa.assign.newAiOnly`, i18n, `new-pane.tsx` · `assign/page.tsx` 일부 배선. vitest 1,325 · lint · tsc 통과 | 화면 배선 마무리(구현 에이전트가 "page 고치는 중"에 멈춤), 스모크 단계 `assign: New-side AI filter…`(아직 없음), 설명서 글 확인, 화면 확인 |
| `feat/sheet-view`(`d61270c`) | `sop-archivist-wb` | b — MD 2 S1, 시트 보기 부품 + Export 미리보기 창 | backend 미리보기 모델 필드(`sheet_model.py`) + 시험(`test_sop_excel` 29 통과), 프런트 타입과 순수 모델 `sheet-view-model.ts` · `sheet-pan.ts`만 | **`SheetView` 부품 자체와 `ExportPreviewModal`은 아직 손대지 않았다.** tsc 오류 3개(`sheet-view.test.ts`가 새 타입 필드를 모른다). 모델 시험, i18n, 토큰, 설명서, 스모크, 감사(레이아웃 · 겹침 · 대비)까지 전부 남음 |
| `feat/unwrap-motion`(`61aec36`) | `sop-archivist-wm` | 2 — MD 1 F10 전환 효과 부품 | `lib/unwrap-motion.ts` + 시험, `components/ui/motion.tsx` 고침, 토큰 추가. vitest 1,333 · lint · tsc 통과. 구현 에이전트가 "쓰는 쪽 주의 글을 더하고 다시 확인"에서 멈춤 | 계약(내보낸 API와 쓰는 법) 읽고 확인, 기존 `useFlip` 쓰는 곳이 그대로인지, 커밋. 화면에서 쓰는 곳은 뒤 브랜치(3 · 4 …) |
| `feat/parse-2a`(`1d18448`) | `sop-archivist-wp` | 1 — 설계 작업 2a 전부 + 블록 신호 + 띠 표 절 경로 + 측정 스크립트 | 막 시작한 상태 — `docx_reader.py`(P-DRM의 `drm_protected` 등) · `segment.py` · 시험 팩토리 일부. `test_sop_docx_reader` · `test_sop_segment` 154개 통과 | 거의 전부. MD 1 §10 1번 행과 설계 §6 작업 2(2a 표 · 2b 절 경로 · 측정 도구 · 부록 E), MD 1 §6-1의 신호 목록대로. Alembic은 `0025`(골격이 `0022`–`0024`) |

그 밖의 워크트리(`sop-archivist-dnd` · `-map` · `-remark`)와 포트 3787 · 8787의 서버는 다른 세션 것이다. 건드리지 않는다.

## 다음에 할 일

1. **걸음 0 마무리** — 스텝 5를 끝내 `feat/outline`에 합치고(위 표), 스텝 6(`feat/outline-6-deviation`, 계획 Task 6)을 한 뒤 `feat/outline`을 `dev`에 합친다(PATCH 하나 = v1.1.30, CHANGELOG, PROGRESS 항목을 하나로 줄임 — `rules/common/git.md` On Branch Merge). 스텝 6을 시작할 때 아래 "정할 것" 1번을 HTML로 물어라.
2. **이미 딴 브랜치를 끝내 차례로 `dev`에** — a, 2는 조금 남았고 b, 1은 많이 남았다. 걸음 0이 `dev`에 올라간 뒤 각 브랜치에 `dev`를 합치고(같은 바탕이라 충돌은 작다) PATCH를 하나씩 올린다. 병렬로 돌려도 되는 묶음: (a, b, 2, 1) 그리고 걸음 0 뒤의 d, 11.
3. **나머지는 MD 1 §10 차례** — c(b 뒤) → d → 3(1 · 2 뒤) → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → e → f. 앞선 것만 지키면 차례를 바꿔도 된다(바꾸면 한 줄로 알린다).

## 정할 것 (HTML로 묻는다)

1. **9장 · 6장 자체에 줄 놓기.** MD 2 S3은 "선언하지 않은 9장에는 못 놓는다(부록은 To-Be에서 먼저 선언)"고 한다. 지금 코드는 9장(`appendices`)과 6장(`procedures`) 자체에 줄을 놓을 수 있다(번호 없는 머리 글, `outline.ASSIGNABLE_KINDS`). 권하는 답: 9장 자체는 못 놓게(선언한 부록에만), 6장 자체는 지금처럼 머리 글로 허용. 스텝 6이나 브랜치 e에서 반영한다.
2. **부록 안 줄 번호.** "Appendix 2 안은 2.1, 2.2"는 원본 확인 전 가정이다(`outputs._get_line_base` 한 곳).
3. **Space 미리보기의 안내 문구**(MD 2 §9-4: 처음 몇 번만 · 늘 · 없음) — 브랜치 c에서.
4. **1:2 짝의 번호**(MD 1 §11 남은 질문) — 브랜치 11에서. **떨어진 Old 줄 둘을 한 New 문장에 잇는 길**(F3) — 브랜치 4를 시작할 때 dev의 묶음 저장으로 되는지 먼저 본다.

## 환경에서 알아 둘 것

- 워크트리에는 venv가 없다. backend 명령은 원본 체크아웃의 것을 쓴다: `PY=/Users/hyeonjin/Documents/sop-archivist/backend/.venv/bin/python`(각 워크트리의 `backend/`에서 실행). frontend는 워크트리마다 `npm ci`가 돼 있다(스모크를 돌릴 워크트리에는 `npm i --no-save playwright-core`).
- 화면 확인 · 스모크용 서버는 워크트리마다 따로 띄운다(예: backend 8795 · frontend 3795, DB는 `DATABASE_URL=sqlite+aiosqlite:///<임시 폴더>/x.db AUTH_MODE=dev`로 `scripts.reset_db` → `scripts.seed_sop_demo`). 끝나면 내린다. 스모크는 `BACKEND_PYTHON=$PY`를 준다.
- `next dev` · `next build`는 Next.js 16.4.3 보안 안내로 처음 한 번 멈춘다. 같은 명령을 다시 돌리면 진행된다. 업그레이드는 사용자가 정할 일이라 하지 않았다.
- 전체 스모크에서 흔들리는 단계(코드 탓이 아님, `dev` 코드로 같은 조건에서 확인): `order: a move chosen from the narrow-frame menu…`, `review:` 세 단계(마지막 의미 확인 저장 전에 화면을 떠남), `map: a non-member gets counts…`. 기본 스모크(`pw-smoke-baseline.mjs`)의 `unknown employee` 403 콘솔 오류와 `admin ops panels as ops.member` 시간 초과는 원인을 보지 않았다.
- 전체 pytest와 스모크를 여러 워크트리에서 한꺼번에 돌리면 `tests/test_seed_sop_demo.py`가 시간 초과로 오류를 낸다. 그 파일만 다시 돌려 확인한다.
- 스텝 4에서 정한 계약(절의 `shows_number` · `auto_items`, 줄 번호는 SOP 절마다 따로, 옮긴 줄의 표시 규칙, `slot_not_assignable`의 세 꼴)은 `PROGRESS.md`의 스텝 4 항목과 `docs/superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md` "API 계약" 블록에 있다.
