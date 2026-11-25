# 쪼개기 먼저 — 구현 계획 차례(오케스트레이션)

> **For agentic workers:** 이 파일은 차례 · 공용 계약 · 운영 방법이다. 작업 단계는 아래 다섯 계획 파일에 있다. 실행 방식은 `superpowers:subagent-driven-development`이되 **검토는 브랜치 끝에 한 번**(`CLAUDE.md` "일 크기에 맞는 절차"가 먼저다).

**Goal:** 새 문서 생성 쪽을 숨기고, Old와 New가 같은 규칙 · 같은 용지 · 같은 손짓으로 쪼개지고 이어지게 하며, 누른 글쇠가 사라지지 않게 한다.

**Architecture:** FastAPI + Next.js. 규칙은 `backend/app/sop/segment.py`에 규칙 번호로 더하고, 화면은 `Paper` 하나로 모으고, Assign의 쓰기는 한 줄 큐로 모은다. 자료는 더하기만 한다.

**Spec:** [`2026-11-25-split-first-design.md`](../specs/2026-11-25-split-first-design.md) (먼저) · [`2026-11-23-assign-feedback-2.md`](../specs/2026-11-23-assign-feedback-2.md) (원문, 17개 항목). 겹치면 앞의 것 11-1절.

## 계획 파일

| 파일 | 스텝 | 운영 묶음 |
|---|---|---|
| [`2026-11-25-split-first-1.md`](2026-11-25-split-first-1.md) | 0 · 1 · 2 · 2-1 | 1 |
| [`2026-11-25-split-first-2.md`](2026-11-25-split-first-2.md) | 2-2 · 3 | 1 |
| [`2026-11-25-split-first-3.md`](2026-11-25-split-first-3.md) | 4 | 2 |
| [`2026-11-25-split-first-4.md`](2026-11-25-split-first-4.md) | 5 | 3 |
| [`2026-11-25-split-first-5.md`](2026-11-25-split-first-5.md) | 6 · 7 | 3 |

## Global Constraints

- 운영에 실사용 자료가 있다. Alembic은 **더하기만**, 기존 행을 지우거나 바꾸지 않는다. 다음 번호는 만들 때 `alembic heads`로 정한다(지금 head `0037`, `feat/admin-polish`가 먼저 쓸 수 있다).
- 이미 올린 문서의 박스는 바뀌지 않는다(`split_rule` 1).
- AI는 제안만 쓴다. `test_invariants.py` 통과. AI 페이로드에 실명 없음.
- 공개 저장소: 실제 SOP 원문 · 실서버 IP · 사내 호스트명 · 시크릿 금지. 시험 문서는 합성, 파일 이름 `SYNTHETIC_`.
- 스모크 · 시험: 단계를 빼거나 기준을 낮추지 않는다. 동작이 바뀌어 따라 바뀌는 것만 같은 수의 단계로 고치고 커밋 메시지에 까닭. 승인 목록은 설계 14절.
- 새 `useEffect`는 `frontend/effect-baseline.json`이 막는다. 늘려야 하면 **그 브랜치를 세워 두고** 보고(늘리지 않는다).
- 화면 · 동작 · 문구를 바꾸면 같은 커밋에서 `frontend/public/manual/user-manual.md`의 글(그림은 아님), 새 문구는 en · ko, 새 `raise_rule` 코드는 `rule.<code>`.
- 새 권한 3곳 · 새 env 3곳 규칙(`CLAUDE.md` 체크리스트)은 그대로. 이 계획에는 새 권한 · env가 없다.
- 관리 화면 파일(`components/admin/*`, `app/admin/*`)은 건드리지 않는다. 공용 CSS는 새 선택자를 더하고 있는 규칙을 바꾸지 않는다.
- 커밋 · 푸시는 GitHub `origin`에만. 사내 GitLab push · 배포는 사용자. `main`에는 합치지 않는다.
- 커밋 메시지 `type(scope): English — 한국어`, 끝에 그 세션의 attribution 줄.

## 공용 계약 — 여러 계획이 함께 쓰는 이름

| 이름 | 자리 | 뜻 | 만드는 브랜치 |
|---|---|---|---|
| `isDraftingOn(): boolean` | `frontend/src/lib/drafting.ts` | 숨긴 기능을 켤지. 운영 빌드는 늘 false, 개발은 브라우저 저장 `sopa.drafting === "1"` | hide-drafting |
| `HIDDEN_AI_KINDS: ReadonlySet<string>` | `frontend/src/lib/ai-suggestion-model.ts` | `classify` · `split` · `translate` · `tobe_list` | hide-drafting |
| `AUTO_CLASSIFY = False`, `PLAN_DELETES = False` | `backend/app/sop/ai/constants.py` | 자동 칸 추천 · 계획의 삭제 후보 | hide-drafting |
| `SHOW_C_SHEET = False` | `backend/app/sop/sheet_model.py` | Excel C 시트 | hide-drafting |
| `createCommandQueue<T>()` · `QueuedCommand` · `isBarrier` | `frontend/src/lib/command-queue.ts` | 순수 모델(React 없음). 명령 한 줄 큐 · 장벽 · 실패 멈춤 | assign-command-queue |
| `enqueue(command: AssignCommand): void` | `frontend/src/app/bundles/[id]/assign/use-command-queue.ts` | Assign의 모든 쓰기가 지나는 문 | assign-command-queue |
| `ASSIGN_KEYS: readonly AssignKey[]` (`{ id, key, shift, when, labelKey }`) | `frontend/src/lib/assign-keymap.ts` | 글쇠 목록 하나. 키 처리 · 도움말 · 설명서 대조 시험이 읽는다 | assign-keymap |
| `RULE_LEGACY = 1` · `RULE_PARAGRAPH = 2` | `backend/app/sop/segment.py` | 쪼개기 규칙 번호. `extractions.split_rule`(int, 서버 기본 1) | split-rule-2 |
| `backend/tests/split_golden/` | – | 꼴 하나 = 문서 하나 + 기대 JSON, Old · New 둘 다 | split-rule-2 |
| `NOISE_FRONT = "front"` · `NOISE_HISTORY = "history"` | `backend/app/sop/noise.py` | 잡음 종류. `units.noise_reason`(Text, 기본 "") | split-front-matter |
| `SetNoiseReasonOp`(`set_noise_reason`) · `StartBodyOp`(`start_body`) | `backend/app/sop/editing.py` | 사유 쓰기 · 여기부터 본문 | split-front-matter |
| `NoiseBlock`(종류별) | `frontend/src/lib/toc-block-model.ts` 확장 | 접힌 블록은 종류가 바뀌면 끊는다 | split-front-matter |
| `NewPaper` | `frontend/src/components/assign/new-paper.tsx` | 이미 쓴 New 문서를 `Paper`로 + 얹기 층 | new-paper-1-render |
| `buildPickBar(state): PickBar` | `frontend/src/lib/pick-bar-model.ts` | 고름 → 단추 줄 · 더보기 · Enter의 뜻. 화면 · 글쇠 · 확정 단추가 함께 읽는다 | new-paper-2-pick |
| `MergeRowsOp`(`merge_rows`) · `SetLayoutTablesOp`(`set_layout_tables`, `table_ids`) | `backend/app/sop/editing.py` | 짝 줄 여럿 합치기 · 표 여럿 벗기기 | assign-multi-merge |

이 이름은 바꾸지 않는다. 꼭 바꿔야 하면 이 표와 뒤 계획을 같은 커밋에서 고친다.

## 브랜치 순서와 맡길 모델

`S` = sonnet, `O` = opus, `F` = fable(사용자 허락 2026-11-26, 아래 네 자리에만). 구현과 검토의 모델을 따로 적는다(검토는 브랜치 끝에 한 번). 기계적인 글 · 문구 · 설명서 · 시험 돌리기만이면 `S`.

| # | 브랜치 | 구현 | 검토 | 앞서야 하는 것 |
|---|---|---|---|---|
| 0 | `fix/new-edit-undo` | O | F | – |
| 1a | `feat/hide-drafting` | O | O | 0 |
| 1b | `fix/remove-bundle-move` | S | O | 1a |
| 2a | `fix/pair-spot-scroll` | S | S | – |
| 2b | `feat/inspector-float` | O | S | 2a |
| 3a | `perf/assign-measure` | S | S | 0 |
| 3b | `fix/assign-command-queue` | O | F | 1b · 3a |
| 3c | `fix/assign-instant-motion` | O | S | 3b |
| 3d | `perf/assign-filter-chunks` | O | O | 3a |
| 3e | `perf/assign-number-input` | O | S | 3a, 재서 100ms를 넘을 때만 |
| 4a | `fix/assign-enter` | O | O | 3b |
| 4b | `feat/assign-keymap` | O | O | 4a |
| 4c | `feat/assign-merge-keys` | S | S | 4b |
| 4d | `feat/number-cell-buttons` | S | S | – |
| 5a | `feat/split-rule-2` | O | O | – |
| 5b | `feat/split-front-matter` | O | O | 5a · 3b |
| 5c | `feat/split-new-parity` | O | O | 5a |
| 6 | `feat/new-paper` ← `-1-render` · `-2-pick` · `-3-tools` | O | O, `-2-pick`만 F | 4b · 5c |
| 7 | 계획 4의 일곱 | 파일에 | 파일에 | 6 |
| 8 | 계획 5의 아홉(모음 둘째 포함) | 파일에 | 파일에 | 7 |

**Fable을 쓰는 네 자리**: 위 표의 검토 셋(운영 자료의 중복 · 글쇠 유실과 순서 · 두 고름의 상태가 걸려, 시험이 초록이어도 틀리기 쉬운 곳)과, opus 구현이 같은 게이트에서 **두 번 실패했을 때 세우기 전 한 번**. 그 한 번에는 실패 출력 · diff · 계획 절만 주고 원인부터 쓰게 한다. 그래도 안 되면 세운다. 지휘 세션과 나머지는 opus · sonnet이고, model을 빠뜨려 지휘 세션의 모델을 물려받게 하지 않는다.

**막히면 건너뛰는 길**: 5a는 화면과 겹치지 않으므로 3b가 막혀도 먼저 할 수 있다. 4d · 2a · 5a는 서로 다른 워크트리에서 나란히 해도 된다. 앞선 것이 막힌 브랜치는 하지 않는다.

## 브랜치 하나를 도는 법

1. **메인 세션**: `git fetch` → 새 `dev`에서 `scripts/dev-worktree.sh new <branch>`. 장부(아래)에 시작을 적는다.
2. **구현 하위 에이전트**(모델 명시): 그 브랜치의 계획 절과 공용 계약 · 명세의 해당 절 경로를 준다. 시험 먼저. 고친 파일의 단위 시험 · lint · tsc까지만. **서버 · 브라우저를 띄우지 않는다.** 브랜치 하나에 에이전트 하나를 쓰고, 문맥이 차면 같은 브랜치를 이어받는 새 에이전트에 `git log`와 장부를 준다.
3. **메인 세션 게이트**(차례로, 실패하면 멈추고 고침):
   - backend를 고쳤으면 `.venv/bin/python -m pytest tests/ -q -n auto` · `ruff check app/ tests/`
   - frontend를 고쳤으면 `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run` · `npm run build` 경고 0
   - 화면을 고쳤으면 `dev-worktree.sh up` 뒤 **고친 화면만** `QUIET=1 ONLY="assign:" node scripts/pw-smoke-sop.mjs`(고친 범위를 더 좁힐 수 있으면 좁힌다), 실패는 `reset` → `ONLY_FAILED=1`
   - 서버를 쓴 뒤 `down`. 한 번에 스모크 하나
4. **검토 하위 에이전트**(읽기 전용, 모델 명시): 브랜치 전체 diff + 계획 절 + 명세. 지적은 구현 에이전트에 `SendMessage`로 돌려 고치고, 게이트를 다시 돈다. 같은 지적이 두 번 남으면 멈추고 장부에.
5. **합치기**: `dev`에 `--no-ff`. 앱 동작이 바뀌었으면 `npm version`(첫 앱 푸시는 `minor` → 1.6.0, 이미 1.6.x면 `patch`)과 `CHANGELOG.md` `Unreleased (dev)` 한 줄, `PROGRESS.md`는 브랜치 요약 하나로. 합친 뒤 그 브랜치의 단위 시험을 한 번 더.
6. **푸시**: 푸시 전에 `git fetch`로 `origin/dev`가 앞서 있으면 합치고 게이트 3을 다시. 그 뒤 `git push origin dev`. 워크트리 · 로컬 브랜치를 지운다.
7. 장부에 결과 한 줄.

## 장부 — 문맥이 사라져도 이어지게

`.dev`가 아니라 **추적되는 파일** `docs/superpowers/plans/2026-11-25-split-first-ledger.md`에 쓴다(모든 워크트리에서 `dev`로 본다). 브랜치마다 한 줄: `| 브랜치 | 상태(대기 · 진행 · 합침 · 세움) | 커밋 | 게이트 결과 | 승인이 필요한 것 · 남은 것 |`. 세션이 압축되거나 새로 시작하면 이 장부와 `git log origin/dev`만 보고 이어 간다. 장부를 고친 커밋은 그 브랜치의 합치기 커밋에 담는다.

## 멈추고 사람을 기다리는 때

아래면 그 브랜치를 **세워 두고**(푸시하지 않은 채 로컬 브랜치로 남김) 장부에 까닭과 물음을 적은 뒤 다음 할 수 있는 브랜치로 간다.

- 운영 자료를 지우거나 바꿔야 한다 / Alembic이 더하기로 안 된다
- 설계 14절에 없고 "동작이 바뀌어 따라 바뀌는 것"도 아닌 시험을 고쳐야 한다
- 새 `useEffect`, 새 의존성, 새 env, 새 권한, nginx · Docker · CI 변경이 필요하다
- 같은 게이트가 두 번 고쳐도 실패하고, Fable 한 번으로도 안 된다
- 명세끼리 부딪히는데 11-1절에 답이 없다(사용자에게 보이는 동작이 갈릴 때)
- `feat/admin-polish`와 같은 줄에서 충돌해 어느 쪽이 맞는지 모르겠다

전체를 멈출 때: `dev`가 빨갛다(합친 뒤 시험이 깨졌고 되돌려도 안 낫다) / 디스크 · 인증 오류 / 세운 브랜치 때문에 할 수 있는 것이 없다.

## Review Focus

- 저장이 느린 동안 글쇠를 이어 누름 → 하나도 사라지지 않고 누른 차례대로(명령 큐 시험)
- New 손질 뒤 `Ctrl+Z` · 다시 하기를 여러 번 오감 → `new_unit_id`마다 새 문장 하나(스텝 0 시험)
- 이미 올린 문서를 편집(띠 표 벗기기 · 제목↔문장) → 규칙 1의 결과(split-rule-2 시험)
- 본문 번호가 1에서 시작하지 않거나 표지가 없는 문서 → 아무것도 저절로 삭제되지 않음(정답 문서 G17)
- 숨긴 기능의 자료(빈 문서에 배정 · 번역 · 칸 추천)가 있는 묶음 → 배정 취소와 검토 요청까지 감(hide-drafting 시험)
