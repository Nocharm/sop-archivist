# SPEC — Assign 피드백 2차 (main v1.5.0 기준)

> 원문 그대로다(T/F 피드백 2차 명세, 2026-11-23). 2026-11-25 사용자 결정: **적힌 내용은 모두 확정이고 전부 다음 패치 범위다.** 11-25에 새로 정한 것과 겹치는 곳만 쪼개기 먼저 설계 11-1절(`docs/architecture/decisions.md` `## 2026-11-25-split-first`)을 따른다. v1.6.43 정식 업데이트까지 F2-R1~R5만 남았다(그 절: 숨긴 새 문서 기능을 풀 때 함께). 버전 번호 규칙(G2)은 `rules/common/git.md`가 먼저다.

## 0. 메타

- 대상 독자: Claude Code 작업 세션. **이 파일 하나로 완결**된다 — 다른 파일 · 링크 · 대화 기록이 필요 없다.
- 기준 코드: `main` v1.5.0, 커밋 `6f289576`, 2026-11-23. `file:line`은 이 커밋 기준이다. 줄이 밀렸으면 함께 적은 **심볼 이름**으로 다시 찾는다.
- 경로 약어: `FE/` = `frontend/src/`, `BE/` = `backend/app/`, `UAP` = `FE/app/bundles/[id]/assign/use-assign-page.tsx`, `PG` = `FE/app/bundles/[id]/assign/page.tsx`, `SP` = `FE/app/bundles/[id]/assign/assign-side-panel.tsx`.
- ID 체계: `<항목>-R<n>` 요구, `<항목>-AC<n>` 수용 기준, `<항목>-T<n>` 시험, `S<n>` 부록 A 시나리오.
- 출처 표시: **[U]** = 사용자가 고른 결정(바꾸지 않는다), **[D]** = 명세 작성자 판단(사용자 미확인 — 바꿔야 할 근거가 있으면 사용자에게 먼저 묻는다), **[B]** = 빌더 재량.
- 우선순위: 요구(R) > 수용 기준(AC) > 시나리오(S) > 문구 예시. 충돌하면 앞의 것을 따른다.
- 문구 표의 en · ko는 뜻을 고정한 예시다. 최종 꼴은 기존 i18n 문구 꼴에 맞춘다 [B]. "제안"이라 적은 testid도 [B].

## 1. 목적과 범위

**왜**: 사용자(SOP Restructuring T/F)가 v1.5.0을 실제 SOP로 쓰며 낸 불편 셋.
1. 손이 화면을 앞지르면 명령이 조용히 사라지고, 반응이 느리다.
2. 무엇을 골랐고 무엇이 바뀌는지 안 보인다(묶음 전체가 골라진 듯 보임, Enter의 할 일 불명, 이미 정한 것에 AI 제안이 남음).
3. 표를 벗긴 뒤 손질이 많다(번호가 1부터, 한글 표에서 한 일을 영어 표에 다시).

**목표**: §3의 17개 브랜치를 순서대로 dev에 올린다.
**비목표**: 앱 전체의 "Bundle" 용어 변경(이동 기능 이름만 바꾼다), 추출기 변경(이미 올린 문서 재업로드 불필요), 운영 DB 기존 행 변경, AI가 판단을 직접 쓰기.
**실패 조건(하나라도 생기면 실패)**: 운영 자료 삭제 · 변경 / AI가 판단을 씀 / 스모크 기대값을 낮춰 통과 / 같은 키가 상황마다 다른 일을 해 예측 불가.

## 2. 전역 제약 (모든 브랜치에 적용)

- **G1 브랜치 단위**: 브랜치 1개 = §3 표의 한 줄. 차례로 dev에 합치고 다음 브랜치는 새 dev에서 딴다. 브랜치 끝에 diff 전체를 한 번 검토한다.
- **G2 버전 · 기록**: dev에 올릴 때마다 `frontend/package.json` PATCH +1(`npm version patch --no-git-tag-version`), `CHANGELOG.md` `## Unreleased (dev)`에 `vX.Y.Z — 날짜` 한 줄, `PROGRESS.md` 갱신. 커밋 메시지 `type(scope): English — 한국어`.
- **G3 설명서**: 화면 · 동작 · 라벨이 바뀌면 같은 커밋에서 `frontend/public/manual/user-manual.md`의 해당 글을 고친다(그림은 정식 업데이트 때). `manual-content.test.ts`가 설명서의 굵은 영어 라벨을 en 문구와 대조한다.
- **G4 i18n**: 모든 새 문구는 `FE/lib/i18n-messages.ts`에 en · ko. 새 `raise_rule` 코드는 `rule.<code>` 문구도.
- **G5 effect 기준선**: 새 `useEffect`는 ESLint 기준선(`effect-baseline.json`)이 막는다. 늘리려면 사용자 승인 — 기존 훅을 넓히는 길을 먼저.
- **G6 스모크**: 기대값을 낮추거나 단계를 빼지 않는다. 설계가 바뀌어 기대 화면이 달라진 경우만 고치고 커밋 메시지에 사유. 평소엔 고친 화면만(`QUIET=1 ONLY="assign:" node scripts/pw-smoke-sop.mjs`).
- **G7 Alembic**: 모델을 바꾸면 리비전 필수(`alembic revision --autogenerate --rev-id "<다음 번호>"`, 생성물 검토). 기존 행을 지우거나 바꾸는 리비전 금지(이 명세 범위에 없음). 더하기(새 표 · 열 · CHECK 값)만 허용.
- **G8 AI 층 불변식**(`backend/CLAUDE.md`): AI는 `ai_suggestions` 행에만 쓴다, `compute`는 세션 없이, 페이로드에 직원 실명 없음, 새 작업 종류 = Alembic CHECK(`BE/sop/constants.py:51` `AI_JOB_KINDS`) + `GUIDELINE_KEYS` + 지침 시드. `test_invariants.py` 통과.
- **G9 규칙 사본 동기화**: 번호 따라 고치기 `planFollow`(FE `lib/number-model.ts`) ↔ `plan_follow`(BE `sop/numbering.py:399`) ↔ `rule-cases.json`(`scripts.dump_rule_cases`). 진행 세기 `RowProgress`(BE `sop/snapshot.py:552-563`) ↔ FE `lib/progress-model.ts` ↔ `buildRows`(FE `lib/classify-model.ts`) — 검토 사실 `build_review_facts`와 같은 행 규칙.
- **G10 하위 에이전트**: 서버 · 브라우저를 띄우지 않는다(단위 시험 · lint · tsc까지). 스모크 · 화면 확인은 메인 세션이 브랜치 끝에.
- **G11 커밋 전 필수**: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, backend `pytest tests/ -q -n auto` · `ruff check app/ tests/`, `npm run build` 경고 0.

## 3. 브랜치 계획

| # | 항목 | 브랜치 | 요구 | 의존 | 크기 | 스키마 |
|---|---|---|---|---|---|---|
| 1 | A1 명령 큐 · 즉시 다음 박스 | `fix/assign-command-queue` | A1-R1~R9 | – | 중 | 없음 |
| 2 | A2 측정 → 원인별 수정 | `perf/assign-measure`, 이어서 `perf/assign-<원인>` n개 | A2-R1~R6 | A1 | 중~대 | 없음 |
| 3 | B1 Enter = 확정 단추 | `fix/assign-enter` | B1-R1~R7 | A1 | 소~중 | 없음 |
| 4 | B2 글쇠표 단일 소스 | `feat/assign-keymap` | B2-R1~R11 | B1 | 중 | 없음 |
| 5 | J1 ⇧J⇧J · ⇧K⇧K 합치기 | `feat/assign-merge-keys` | J1-R1~R6 | B2 | 소 | 없음 |
| 6 | B3 번호 칸 창 단추 | `feat/number-cell-buttons` | B3-R1~R4 | – | 소 | 없음 |
| 7 | C1 고름 두 겹 | `feat/assign-two-level-pick` | C1-R1~R5 | – | 중 | 없음 |
| 8 | C2 표 우클릭 구역 · 칠하기 | `feat/assign-table-menu` | C2-R1~R4 | C1 | 중 | 없음 |
| 9 | F3 개요 · 대시보드 | `fix/progress-by-disposition` | F3-R1~R7 | – | 중 | 없음 |
| 10 | F1 미리보기 · 받기 창 | `feat/space-preview-trim` | F1-R1~R5 | – | 중 | 없음 |
| 11 | F2 To-Be 문서로 이동 · 새 문서 | `feat/move-to-tobe-doc` | F2-R1~R8 | B2 | 중 | 없음(요청 본문 확장 가능 [B]) |
| 12 | G1 ⇧G 여럿 고르기 · 일괄 | `feat/assign-multi-pick` | G1-R1~R4 | A1, F2 | 소~중 | 없음 |
| 13 | E1 떨어진 짝 괄호선 | `feat/assign-pair-bracket` | E1-R1~R4 | – | 소~중 | 없음 |
| 14 | E2 표 탭 · 본문 표 접기 | `feat/assign-tables-tab` | E2-R1~R5 | B2 | 중 | 없음 |
| 15 | E3 AI 제안 거두기 · 세기 | `fix/ai-suggestions-retire` | E3-R1~R5 | F3 | 중 | 없음 |
| 16 | D1 표 번호 이어 매기기 | `feat/unwrap-continue-numbers` | D1-R1~R7 | J1 | 중 | 없음 |
| 17 | D2 한글 표 따라 하기 | 모음 `feat/table-follow` + 걸음 `-1-counterpart` · `-2-rule` · `-3-ai` | D2-R1~R10 | D1 | 대 | 더하기만(짝 표 저장, 새 AI 작업 종류) |

순서는 사용자 결정 [U](속도 · 명령 → Enter · 단축키 → 고름 · 우클릭 → 개요 → 미리보기 · 보내기 · 보기 → 표 번호 → 한글 표). G1만 F2 뒤로 옮겼다 [D](⇧D 일괄 이동이 F2에 의존). F3가 "AI 제안 대기" 세기 함수를 만들고 E3가 재사용한다.

---

## 4. 항목 명세

### A1 — 처리 중 명령도 빠짐없이, 고름은 즉시 다음 박스로

**원문**: "삭제 처리중에 다음 셀로 이동해서 삭제를 보내면 명령이 스킵됨 (삭제 뿐만 아니라 다른 명령도 비슷할것 같아서 큐로 쌓아서 처리해야될듯한데)"
**결정 [U]**: 누르는 즉시 다음 박스(낙관적) + 명령 큐. 큐 안 명령 실패 → 뒤 명령 정지 + 알림.

**현재 동작(사실)**
- 모든 쓰기는 `focusCtl.runPending`(FE `app/bundles/[id]/assign/use-assign-focus.ts:60-66`) 경유. `canStart`(FE `lib/assign-focus-model.ts:173-177`)가 false면 null → **무알림 폐기**.
- `busy`(UAP:462) 조기 return: `decideNow` :2041, `runSave` :1918, `runClear` :2069 (Del · H · U · M · Enter 전부), 되돌리기 · 일괄 :2131 · :2097 · :2226, Ctrl+Z :3426.
- 행 정보 로딩 중(`isRowLoading`) 저장은 1칸 보관 `queuedSaveRef`(:2026-2036): 덮어쓰기, 다른 행으로 가면 폐기(:2031), `pick` 손실.
- 저장 흐름 `runPending` :1949 → `await saveGroup` :1970 → `focusCtl.succeed(next)` :1986 → `reloadData()` :1987. 따라가기는 재조회 후 고름이 처음과 같을 때만(`assign-focus-model.ts:91-98`, `applyLoaded` :110-134) → 응답 후 재조회 전에 Del을 누르면 같은 박스로 간다.
- 기존 큐 유틸: `FE/lib/doc-write-queue.ts`(원문 편집, 문서별, `use-assign-focus`만 사용), `FE/lib/c-save-queue.ts`(같은 일 합치고 순차, `outputs-workspace.tsx` · `use-composed-order.ts`). 판단 저장은 lane null(`use-assign-focus.ts:64`).
- 잠금 우회 쓰기: BulkModal(PG:960-990), `deleteFigure`(UAP:3350).

**요구**
- **A1-R1** Assign 페이지의 모든 쓰기를 단일 FIFO 큐로 보낸다: 판단 저장(`runSave`/`saveGroup`), 즉시 확정(`decideNow`), 배정 취소(`runClear`), 원문 편집(`runUnitEdit`), 짝 생성 · 확정 · 삭제, 되돌리기 · 다시 하기(`runUndoStep`), 일괄(`bulkDecide`), 그림 삭제(`deleteFigure`).
- **A1-R2** 판단 명령(Del · ⌫, ⇧H, U, Enter 확정, ⇧D 이동, 일괄)은 누른 순간의 대상(행 키 + unit ids)을 캡처하고, 즉시 (a) 대상 박스에 처리 중 표시(`data-pending` 의미 유지), (b) 고름을 다음 박스로 옮긴다. 다음 박스 규칙은 현재 저장 후 규칙과 같다: 같은 문서 · 같은 탭 · 그림 제외 · 삭제면 바로 아래 · 되감기 없음(`findNextOpen` FE `lib/classify-model.ts:714-718` 재사용 · 수정).
- **A1-R3 [D]** 결과 박스가 응답 후에 정해지는 명령(합치기 · 나누기 · 표 벗기기 · 다시 표로 · 짝 생성 · 삭제 · 모양을 바꾸는 언어 전환 · 되돌리기 · 다시 하기)은 **장벽**이다: 응답까지 고름을 옮기지 않는다. 장벽 대기 중 눌린 키는 대상을 캡처하지 않고 큐에 쌓아, 장벽 완료 후의 고름 기준으로 순서대로 실행한다.
- **A1-R4** 같은 박스에 연속 명령이 있으면 앞 응답의 revision으로 보낸다.
- **A1-R5** 대기 중인 명령(2번째 이후)의 박스에 칩 "대기 n".
- **A1-R6** 행 목록 재조회(`reloadData`)는 큐가 빌 때 1회(디바운스). 큐 처리 중 개별 재조회 금지.
- **A1-R7** 실패 시: 큐 정지 → 실패 박스의 낙관적 표시 원복 → 알림(어떤 박스 · 어떤 명령 · 사유 · 대기 n개) + [다시 시도] · [버리기].
- **A1-R8** 무알림 폐기 제거: 위 `busy` 조기 return들, `queuedSaveRef` 1칸 보관, `canStart` null → 모두 큐 대기로 바꾼다.
- **A1-R9** `MoveModal` 경로는 F2에서 제거되므로 큐에 넣지 않아도 된다.

**문구**
| 키(제안) | en | ko |
|---|---|---|
| `assign.queue.chip` | Queued {n} | 대기 {n} |
| `assign.queue.failed` | {action} failed on box {no}: {reason}. {n} queued actions paused. | {no}번 박스의 {action}이(가) 실패했습니다: {reason}. 대기 {n}개를 멈췄습니다. |
| `assign.queue.retry` / `.discard` | Retry / Discard | 다시 시도 / 버리기 |

**시험**: A1-T1 큐 · 장벽 · 실패 정지를 순수 모델로 분리해 vitest(순서, 장벽 뒤 대상 해석, revision 연결, 실패 시 뒤 미전송). A1-T2 `assign-focus-model.test.ts`의 canStart 시험을 새 규칙으로. A1-T3 스모크 S1.
**수용 기준**: A1-AC1 응답 전에 Del · J · Del · J · Del → 박스 3개 모두 삭제, 고름은 매 입력마다 즉시 이동, 재조회 1회. A1-AC2 ⇧J⇧J 직후 Del → 합친 박스가 삭제된다. A1-AC3 실패를 주입하면 뒤 명령이 전송되지 않고 알림 · 다시 시도가 동작. A1-AC4 기존 스모크(`assign.mjs:4815, 4862` — `:not([data-pending])` 대기) 통과.
**주의**: `docs/qa/feature-map.md` Assign 행("처리 중 박스는 `:not([data-pending])` 기다림") 유지 · 갱신. 설명서에 "누르는 즉시 다음 박스, 대기 표시".

---

### A2 — 먼저 측정, 큰 원인부터 수정

**원문**: "그리고 전체적으로 프론트 반응이 좀 느림... 왤까" · "어쩔 수 없이 오래걸리는 건 애니메이션 해두었으니 같이 확인할 것" · "현재 애니메이션 재생도 좀 더 즉각적으로 반응하였으면 함"
**결정 [U]**: 측정 후 큰 것부터. 사용자 체감 지점 = **Del · 확정 후 다음 박스까지**, **번호 칸 입력**. 줄일 수 없는 대기엔 애니메이션 추가, 기존 애니메이션은 **누르는 즉시 시작**.

**원인 후보(코드 판독, 미측정, 확신도 순)**
1. 명령 1회 = 왕복 2회 + 요청 10여 개: `reloadData()`(UAP:322-325) → 묶음 전체 Unit 1000개씩 **순차**(FE `lib/api-sop.ts:1005-1013` `listAllUnits`) + `unitsKey`로 tobe · written · identical · 제안 3종(UAP:299-319) · split(:669) · unwrap_order(FE `lib/use-unwrap-ai.ts:43`) · composed(:756-760) · bundle(:1988) · 다음 행 group · 후보(:554-561). 서버 `record_snapshot_step`이 묶음 잠금 안에서 `dump_bundle_state` 2회(BE `sop/decision_steps.py:376-380`, :130-140). uvicorn 워커 1개(`backend/Dockerfile:25-27`), HTTP/1.1 연결 6개, gzip 없음(`nginx/default.conf`).
2. 명령마다 문서 전체 청크 3~4회 재렌더: 청크 비교(FE `components/paper/paper.tsx:123`) deps(:1577)에 `strips.pending`(UAP:639-640), `strips.deleted.folds`(PG:197), `unwrapAiPreviews`(매번 새 Map, AI off여도 `Promise.resolve([])`, `use-unwrap-ai.ts:43-56`). **필터 ≠ All이면 청크 분할 자체가 꺼짐**(`renderFolded` paper.tsx:1788, :1602-1690, `foldMatch` UAP:416-420).
3. 박스 선택 1회 = 페이지 전체 3~5회 렌더: group(UAP:139-141, :554) · similar(:144-147, :557-561) · refDetail(:1333) · pickedGroups(:620) 각각 setState(FE `lib/use-loaded.ts:31-46`), 렌더 중 setState(paper.tsx:360, PG:116, UAP:750). `NewPane` 메모 없음 + `getPairBrackets` · `getCardTops` · `getTabWidths` 매번(FE `components/assign/new-pane.tsx:309-334`), New 행 `content-visibility` 없음(FE `styles/components.css:1292-1303`). `LinkLines`에 매번 새 `pairs` · Set(PG:808, :308, UAP:777) → 호버 판정 실패(`link-lines.tsx:250-255`), `querySelectorAll`(:61-68) · 배지별(:99-112) · 짝별(:197-206) `getBoundingClientRect`로 화면 밖 청크까지 강제 레이아웃.
4. AI on 묶음: 폴링 3초(FE `lib/ai-jobs-model.ts:7`, `lib/use-ai-jobs.ts:66-84`), 작업 완료마다(최대 15초 1회) `reloadData(true)`(UAP:308-313) 전체 재조회.
5. 입구 2 묶음: 선택마다 서버가 쓴 문장 전체와 재비교(BE `sop/written.py:351-378`, 벡터 `sop/ai/embeddings.py:131-139`, 2-gram 루프 :109-130), 짝 행은 2회.
6. 렌더마다 메모 없는 O(n): `rowMap` · `rowOfUnit`(UAP:370-371), counts · `findRowSuggestion`(:389-393), `refPendingIds`(:1317), `splitPendingIds`(:1675), `countDone`(:3563), PG:308-371, **`placeOf`가 행마다 쓴 문장 전체 filter**(PG:429 — 같은 일 하는 `linkedTargets` UAP:703-707 존재), `pairHint`(paper.tsx:530-545), `selectedBlock`(:496).
7. 번호 칸 입력: 키마다 `setNumberEdit`(FE `components/paper/number-cell.tsx:314` → paper.tsx:333) → `followed` · `continuous` O(n)(:338-341, :476) + 근처 청크 전부(:477-486). 툴팁 상태도 Paper 안(FE `components/ui/delegated-tip.tsx:34-46`).
- 전제: React Compiler off(`next.config.ts`, 커밋 53d155ef). Assign 쪽 `React.memo`는 `PaperChunk` 하나. `useAssignPage()`는 렌더마다 필드 약 250개 새 객체(UAP:3589-3619).

**요구**
- **A2-R1** `scripts/pw-perf-assign.mjs`(현재 클릭 이벤트 시간만, 필터 All, New · AI 없음 — :170-182)에 시나리오 추가: (a) Del 5연타 → 키 입력부터 다음 박스 선택까지 ms(`performance.mark`), 요청 수 · 폭포 · 요청별 TTFB(`/groups/save`, `/units`, `new-candidates`) (b) (a)를 필터 Unassigned에서 (c) 번호 칸 5글자 입력 지연 (d) 가짜 AI(`frontend/scripts/fake-ai-server.mjs`) on 묶음에서 60초 무조작(long task · 재조회).
- **A2-R2** 서버에 `/groups/save` 처리 시간과 그중 `dump_bundle_state` 시간을 구조화 로그로.
- **A2-R3** 측정 환경: 로컬 운영 빌드(`npm run build && npm start`) 또는 개발 스택, 합성 최악 자료(backend `scripts.seed_sop_worst`), localhost가 아닌 LAN 주소. React Profiler로 J 1회 · Del 1회의 커밋 수와 커밋별 `PaperChunk` 렌더 수.
- **A2-R4** 결과 문서 `docs/qa/<날짜>-assign-perf.md`(시나리오 x 지표 표, 원인별 몫) + `docs/README.md` 인덱스 한 줄.
- **A2-R5** 몫이 큰 원인부터 브랜치 1개씩(`perf/assign-<원인>`), 각 브랜치는 같은 시나리오로 전후 수치를 문서에 추가.
- **A2-R6** 애니메이션 즉시 시작: 삭제 행 접기(FE `components/ui/motion.tsx:278-309` `Collapse`/`usePresence`, 약 260ms), 표 벗기기 · 다시 표로 전환(FE `lib/unwrap-motion.ts`), 번호 도착 강조(FE `lib/use-number-arrival.ts`)를 A1의 낙관적 상태에 걸어 누르는 순간 시작. 서버 대기 동안은 처리 중 표시(줄무늬 등 [B]). 실패 시 역전환.
**수용 기준**: A2-AC1 결과 문서와 수치 존재. A2-AC2 "Del → 다음 박스"와 "번호 칸 입력" 지표가 같은 시나리오에서 개선됨을 전후로 제시. A2-AC3 build 경고 0.

---

### B1 — Enter = 오른쪽 칸 확정 단추

**원문**: "결정이 사라지면서 엔터가 기능을 못하는데 단축키와 기능 맵 검토" · "추천으로 포커싱 가는걸 고쳐야됨, 직관적으로 엔터가 기능하도록 배선할 것" · "삭제인 경우엔 단추 색상도 같이 변경"
**사실**: 결정 칸(`assign-decide` SP:975-991)과 Confirm(`assign-primary` SP:494)은 존재한다. v1.3.3(0dea2784) Del · M · 우클릭 즉시 확정, 끌어 놓기 즉시 확정(UAP:529), v1.4.4(7dd3633b) Undo delete = 배정 취소로 결정 칸을 거치지 않는 길이 늘어 Enter의 역할이 흐려졌다.
**현재 Enter**(UAP:3369-3376): 보낼 곳 있음 → `runSave("confirm")`(이미 확정 행이면 같은 곳 재저장 후 다음 행) / 없음 → **첫 추천 카드로 포커스만**. 무반응 경우: ① 보낼 곳 잎(Nearby · All · Deleted · Moved, SP:176,182,193,200,203)을 누른 뒤 포커스가 그 단추에 남음(포커스가 단추면 Enter · Space는 단추가 받음, UAP:3431) ② `role=dialog`가 떠 있으면 모든 단축키 차단(UAP:3413) — 마우스 호버로 열리는 문서 대시보드(FE `components/assign/doc-dashboard.tsx:183`), 짝 판 · 그림 위치 판(FE `components/assign/spot-panel.tsx:100`) ③ 행이 아님(목차 블록, New 문서 선택, :3452) ④ 처리 중(A1).

**요구**
- **B1-R1 [U]** Enter = `assign-primary` 단추 동작. 용지 · 오른쪽 칸 맥락에서 포커스가 다른 단추여도 Enter는 primary(다른 단추는 Space로 누른다). 텍스트 입력 · 메뉴 · 실제 모달 안에서는 그곳의 Enter.
- **B1-R2 [U]** 보낼 곳 미정이면 **맨 위 추천 = 오른쪽 칸 Suggested의 첫 카드**로 즉시 확정한다(AI 카드가 있으면 AI, 없으면 identical · similar 카드의 첫째). Nearby(SP:168-170 `listSiblingPlaces`, 첫 카드의 이웃 자리)는 대상이 아니다.
- **B1-R3 [U]** 첫 카드가 AI면 **Use와 동일하게** 확정한다: `buildUseDraft`의 texts + `suggestionId`를 초안에 싣는다(UAP:3545-3548과 같은 경로) → AI 채택으로 기록된다. Use 없이 자리만 저장하는 길은 쓰지 않는다(`judge_unused_suggestions`가 stale로 남겨 채택률이 틀어짐).
- **B1-R4 [U]** primary 라벨 미리보기: 보낼 곳/첫 카드의 자리를 보인다. AI면 "AI 그대로" 표시. 첫 카드가 삭제면 위험 색 + "삭제". Suggested가 비면 단추 비활성 + 사유, Enter = 사유 알림 + 보낼 곳 목록 강조.
- **B1-R5 [U]** ⇧O AI 순서 미리보기 표시 중: primary = "AI 순서 적용", Enter = 적용, Esc = Keep as is.
- **B1-R6** 비모달 패널(문서 대시보드 호버 팝오버, 짝 판, 그림 위치 판)은 단축키를 막지 않는다(`role=dialog` 제거 또는 UAP:3413 검사에서 제외 [B]).
- **B1-R7** "첫 추천 카드로 포커스만" 동작 제거.

**문구**
| 키(제안) | en | ko |
|---|---|---|
| primary 라벨 | Confirm → {place} | 확정 → {place} |
| AI 접미 | · ✦ AI as is | · ✦ AI 그대로 |
| 삭제 | Delete | 삭제 |
| 적용 | Apply AI order | AI 순서 적용 |
| 비활성 사유 | Pick a destination first | 보낼 곳을 먼저 고르세요 |

**시험**: B1-T1 스모크 S3. B1-T2 BE: AI 첫 카드 Enter 경로의 저장 → 채택 `as_is`(글을 고쳤으면 `edited`).
**수용 기준**: B1-AC1 보낼 곳 잎 클릭 후 Enter → 확정. B1-AC2 문서 대시보드 호버 중 J/K/Enter 동작. B1-AC3 AI 첫 카드에서 Enter → AI 글 포함 저장 + AI 채택 기록. B1-AC4 첫 카드 삭제 → 위험 색 라벨. B1-AC5 Suggested 빈 행 → 비활성, Enter = 알림. 설명서 `#assign-confirm`(534-544), `#assign-keys` 갱신.

---

### B2 — 글쇠: 이동은 단독, 바꾸는 일은 Shift, 목록은 한 곳

**원문**: "그외 단축키 만들어줘 표벗기기/AI 순서 제안등" · "단축키와 기능 맵 검토 (들여쓰기 내어쓰기 한문장/한영짝 탭이동 등..)" · "AI 기능은 쉬프트 … J,K 단순 이동 근처 버튼들은 쉬프트 (보류, 그룹, 언어, 한문장/짝, 번호, 이동), 표 벗기기도 쉬프트 … 탭 이동은 컨트롤 방향키 … 뒤로가기버튼 누르면 이전 탭으로" · "g는 짝으로 가기로 하고 쉬프트는 빼고, 쉬프트 g는 여럿 고르기"

**최종 글쇠표 [U]**
| 키 | 동작 | 조건 | v1.5.0 대비 |
|---|---|---|---|
| J · K · ↑ · ↓ | 이동 | – | 그대로 |
| Enter | primary 단추(B1) | – | 변경 |
| Esc | 거두기(나눌 선 → New 고름 → 체크) | – | 그대로 |
| Del · ⌫ | 삭제 즉시 확정 | – | 그대로 |
| U | 배정 취소 · Undo delete | – | 그대로 |
| E | 고쳐 쓰기 | – | 그대로 |
| S · ← · → | 나누기 · 나눌 선 이동 | 나눌 선 있음 | 그대로 |
| V | 1단 ↔ 2단 | – | 그대로 |
| Space | 미리보기 | – | 그대로 |
| G | 짝으로 가기(안내 줄 두 번 누름 = `goToUnit`) | 짝 있음 | 신규 |
| ⇧H | 보류 | – | 변경(H→⇧H) |
| ⇧L | 언어 KO ↔ EN(짝이면 v1.4.8 모양 전환 규칙) | 글 Unit | 신규 |
| ⇧P | 한 문장 ↔ 한/영 짝(`assign-shape-mode-one|pair`, FE `components/assign/shape-tools.tsx:159-178`, UAP:1560) | 전환 가능 | 신규 |
| ⇧N | 번호 칸 창 열기 | 번호 칸 있음 | 신규 |
| ⇧A | AI 추천 받기(Use) | AI 제안 있음 | 변경(A→⇧A) |
| ⇧O | AI 순서 제안 요청(B1-R5로 적용) | 고른 행이 벗긴 표 안 | 신규 |
| ⇧T | 표 벗기기 ↔ 다시 표로 | 고른 박스가 표 안 | 신규 |
| ⇧D | To-Be 문서로 이동(F2) | 편집 가능 | 신규 |
| ⇧G | 여럿 고르기 넣기 · 빼기(G1) | 편집 가능 | 신규 |
| ⇧J ⇧J · ⇧K ⇧K | 아래 · 위 박스와 합치기(J1) | 편집 가능 | 신규 |
| Tab · Shift+Tab | 들여쓰기 · 내어쓰기 | 용지에서 박스 고름 | 신규 |
| Ctrl+← · Ctrl+→ | 탭 순환(body · header · footer · figures · tables 중 존재하는 것) | – | 신규 |
| 뒤로 가기 | 이전 탭 | 탭 기록 있음 | 신규 |
| Ctrl+Z · Ctrl+Shift+Z | 되돌리기 · 다시 하기 | – | 그대로 |
| ? | 단축키 도움말 | – | 신규 |
| ~~M~~ | ~~다른 문서로 이동(다른 Bundle)~~ | – | **제거**(F2-R6) |

**현재 동작(사실)**: 핸들러 UAP:3391-3463(window keydown). Ctrl · Alt · Meta 누르면 종료, **Shift는 막지 않아 Shift+E = E**. 입력 · dialog · menu · listbox 열림 → Esc · Ctrl/⌘+Enter만(:3413). 단축키 노출 3곳이 불일치: 도움말 FE `components/assign/assign-help.tsx:22-41`(A · S · ←→ · Shift+F10 누락), 설명서 `#assign-keys`(772-794, A 누락) · `#keys`(1196-1206) · `#split-keys`(404-414), 기능 맵 `docs/qa/feature-map.md:22`. 표 벗기기 진입 = 우클릭 `table_layout`(UAP:1812) · 다듬기 단추(FE `lib/assign-context-menu-model.ts:311-314`), 다시 표로 = 표 머리 `assign-paper-rewrap-<t>` · 다듬기(UAP:1307-1315), ✦ AI order = 벗긴 표 머리 `assign-paper-unwrap-ai-<t>`(paper.tsx:1434-1493). 들여쓰기 = 번호 칸 ◀▶만, Order 화면은 Tab(FE `lib/section-number.ts:125-133`). 탭 전환 = 클릭만(FE `components/paper/part-tabs.tsx`).

**요구**
- **B2-R1** 글쇠 목록 단일 소스(예: `FE/lib/assign-keymap.ts` [B]): 항목 = {key, shift, action, when, labelKey}. 키 처리와 도움말 패널이 이 목록을 읽는다.
- **B2-R2** 설명서 단축키 절과 목록을 대조하는 시험(불일치 시 실패, 메시지에 고칠 위치).
- **B2-R3 [D]** Shift 동작은 Shift 필수. Shift 없이 같은 글자를 누르면 동작 없음 + 짧은 힌트(예: "⇧H: Hold").
- **B2-R4** G = 짝으로 가기, ⇧L · ⇧P · ⇧N · ⇧A · ⇧O · ⇧T · ⇧H는 표의 동작.
- **B2-R5** Tab · Shift+Tab: 용지에서 박스를 고른 동안만 들여쓰기 · 내어쓰기 — 번호 칸 ◀▶(v1.4.10)와 같은 규칙(연속 번호 = 단계, 점 기호 · 직접 · 없음 = 들여쓰기 저장, 이어진 같은 단계 일괄, Ctrl+Z 두 단계). 입력 · 오른쪽 칸 · 메뉴에서는 기본 Tab.
- **B2-R6** Ctrl+← · →: 존재하는 탭 사이 순환.
- **B2-R7 [U]** 뒤로 가기 = 이전 탭: 탭 전환마다 history 항목 추가, popstate → 이전 탭, 탭 기록 소진 후엔 원래 뒤로 가기. Next.js App Router와 충돌 없는 방법 [B] + 스모크 확인.
- **B2-R8** 조건 불충족(⇧O가 벗긴 표 밖 등) → 사유 짧게 알림.
- **B2-R9** M 제거(F2-R6과 같은 브랜치에서 해도 됨 [B]).
- **B2-R10** `docs/qa/feature-map.md` Assign 행 갱신.
- **B2-R11** CHANGELOG · 설명서에 H → ⇧H, A → ⇧A, M 제거를 눈에 띄게.
**시험**: B2-T1 목록 ↔ 도움말 ↔ 설명서 대조. B2-T2 스모크 S4. `assign.mjs:459`(도움말 kbd 8개 이상) 유지.
**수용 기준**: B2-AC1 대조 시험 통과. B2-AC2 H 단독 → 보류 안 됨 + 힌트, ⇧H → 보류. B2-AC3 Tab → 들여쓰기 저장. B2-AC4 Ctrl+→ → 다음 탭, 뒤로 가기 → 이전 탭.

---

### J1 — ⇧J ⇧J · ⇧K ⇧K 아래 · 위 박스와 합치기

**원문**: "아래박스와 합치기는 단축키가 없나? … 아래와 위 박스와 합치기" · "두번 연속눌렀을때 작동하도록 해줘"
**현재 동작(사실)**: 합치기 = 우클릭 `merge_prev/next`(UAP:1664-1668) · `pair_*`(:1669-1672) · 틈 Join `planOldJoin`/`joinOld`(:1704-1713) · 끌어 놓기(v1.4.6). 공통 `planJoin`(FE `lib/split-menu-model.ts:28-43`): 같은 언어 → merge(이웃 + `getMergeBlocker` FE `lib/paper-model.ts:394-401`), 한/영 → pair. op `{type:"merge", unit_ids}` → `runUnitEdit`, 되돌리기 1칸. 서버 `_plan_merge`(BE `sop/editing.py:643-659`): 글 Unit만, 목차 행 잠김, 칸 문장 · 캡션은 같은 묶음 · 종류만, 배정된 Unit → 409 `confirm_required`(화면이 한 번 묻고 재전송).

**요구**
- **J1-R1 [U]** ⇧J = 아래 이웃, ⇧K = 위 이웃.
- **J1-R2 [U]** 첫 누름: `planJoin` 평가 → 막히면 사유 알림(무장하지 않음). 가능하면 무장: 두 박스 점선 미리보기 + 안내 띠(testid 제안 `assign-merge-armed`).
- **J1-R3 [U]** 무장 상태에서 같은 키 재입력 → 실행(같은 언어 = merge, 다른 언어 = pair — 틈 Join과 같은 규칙). 배정 있으면 기존 `confirm_required` 확인 흐름.
- **J1-R4 [U]** 무장 해제 = 다른 키 · 클릭 · Esc. 시간 제한 없음.
- **J1-R5** Ctrl+Z 1칸. A1-R3의 장벽.
- **J1-R6** 합친 뒤 번호 당기기는 D1-R6.
**문구**: 안내 띠 en "Press ⇧J again to merge · Esc to cancel" / ko "한 번 더 ⇧J로 합치기 · Esc 취소", 짝이면 en "…to pair" / ko "…짝 맺기", ⇧K도 같은 꼴.
**수용 기준**: J1-AC1 ⇧J 1회 → 저장 없음 + 미리보기. J1-AC2 ⇧J 2회 → 합침. J1-AC3 ⇧J 후 J → 미리보기 해제 + 이동. J1-AC4 위가 다른 언어일 때 ⇧K 2회 → 짝. 시나리오 S5.

---

### G1 — ⇧G 여럿 고르기와 일괄 동작

**원문**: "쉬프트 g는 여럿 고르기 및 여럿 골랐을 때 사용가능한 기능은 뭔지 확인해줘"
**현재 동작(사실)**: 여럿 고르기 = Shift+클릭만(UAP:3332-3341 — 첫 체크 시 고르고 있던 행도 넣음), 클릭 · Esc로 해제(:3342, :3442). 체크 시 위쪽 바(FE `app/bundles/[id]/assign/assign-bar.tsx:76-87`, `assign-bulk`)에 "N개 고름" + `assign-bulk-delete` · `assign-bulk-move`(다른 Bundle)만. BulkModal(PG:962-990, `bulkDecide`)이 사유를 묻고 일괄 저장 — 처리 중 잠금 미경유.

**요구**
- **G1-R1 [U]** ⇧G = 고른 행을 `checked` 집합에 넣기 · 빼기(Shift+클릭과 같은 집합).
- **G1-R2 [U]** 일괄 동작: 삭제(기존), **To-Be 문서로 이동**(F2 펼침, 모두 같은 자리로), **배정 취소**(신규), **언어 바꾸기**(신규).
- **G1-R3 [D]** 언어 바꾸기 = 단추 둘 "→ KO" · "→ EN"(고른 행을 한 언어로 맞춤). 이미 그 언어인 행과 언어 전환이 모양을 바꾸는 행(짝 · 합친 박스 — v1.4.8)은 건너뛰고 건너뛴 수를 알린다.
- **G1-R4** 일괄 "다른 문서로 이동(다른 Bundle)" 제거. 일괄 처리는 A1 큐 경유, 일괄 1회 = 되돌리기 1칸.
**testid 제안**: `assign-bulk-move-tobe`, `assign-bulk-unassign`, `assign-bulk-lang-ko`, `assign-bulk-lang-en`.
**수용 기준**: G1-AC1 J · ⇧G 반복으로 2행 체크 → 바 표시. G1-AC2 각 일괄 동작이 큐로 처리되고 Ctrl+Z 1회에 함께 복구. G1-AC3 다른 Bundle 이동 단추 없음. 시나리오 S6.

---

### B3 — 번호 칸 창에 확인 · 취소

**원문**: "글머리번호 뜨는 모달은 확인버튼 만들것 (현재는 엔터만 가능)"
**현재 동작(사실)** FE `components/paper/number-cell.tsx`: 종류 단추(연속 번호 · • o ▪ · 직접 · 없음, :252-269), ◀ ▶ + 입력(:275-328), "Also renumber the rest of this list" 체크(:373-378). 입력에서 Enter → `save()`(:333-335), 빈 입력은 무알림 무시(:226-231). 점 기호 · None 즉시 저장(:241-245). 연속 번호 아닐 때 ◀▶ = 들여쓰기 즉시 저장(:296, PG:639-647). Esc(:336-338 · `useDismiss`) · 바깥 클릭 = 저장 없이 닫기.

**요구**
- **B3-R1 [U]** 창 아래 **취소 · 확인** 단추. 확인 = Enter와 같은 저장, 취소 = Esc.
- **B3-R2** 입력이 비면 확인 비활성 + 사유.
- **B3-R3 [U]** 바깥 클릭 = 저장 없이 닫기(현행).
- **B3-R4** 즉시 저장 종류(점 기호 · None)는 현행.
**문구**: 확인 en "OK" / ko "확인", 취소 en "Cancel" / ko "취소"(기존 단추 꼴에 맞춤 [B]), 사유 en "Type a number" / ko "번호를 적으세요". **testid 제안**: `number-cell-ok`, `number-cell-cancel`.
**수용 기준**: B3-AC1 확인 클릭 = Enter와 같은 결과. B3-AC2 빈 입력 → 확인 비활성. 스모크 `assign.mjs:4187-4468`에 단추 경로 추가, 설명서 `#assign-number`(589-596) 갱신. 시나리오 S7.

---

### C1 — 고름은 두 겹: 묶음은 얇게, 누른 조각은 진하게

**원문**: "짝이나 표내 셀단위 클릭 시 선택효과가 모호함 (묶음만 선택되어 묶음 단위로 인식됨)"
**현재 동작(사실)**: 고름 `pickedId`(UAP:444), 행 키 `rowOfUnit`(:371), `highlightIds` = 행의 unitIds(PG:308), 용지 `selectedId=pickedId`(PG:579-580). (a) 이웃한 짝 카드: 누른 쪽만 `data-sel`, 다른 쪽 `data-mate`(paper.tsx:728-730, 1221-1222)이나 카드 테 규칙 `.strip-card:has(> .strip-row > .strip:is([data-sel],[data-partner])) … ::after`(FE `styles/components.css:1546-1547`)가 이겨 두 행 모두 같은 2px 실선(점선 mate 규칙 :1549 패배). (b) 아직 표인 표의 칸: 클릭이 `resolvePickUnit`으로 표 단위로 승격(paper.tsx:1699-1718, FE `lib/paper-model.ts:417-419`) → 표 전체 고리, 칸 `data-sel`(paper.tsx:996) 미발생 → `.cell-piece[data-sel]`(css:1322) · `.cell-piece[data-mate]`(:1550) 미사용. 호버도 표 전체(css:1313). 오른쪽 칸 다듬기도 표 단위(UAP:1272, 1299). 우클릭만 칸 대상.

**요구**
- **C1-R1 [U]** 묶음(짝 카드 · 표) = 얇은 테 + 꼬리표.
- **C1-R2 [U]** 누른 행 · 칸 = 진한 칠 + 테. 언어 · 참조 · 합치기는 진한 쪽에, 삭제 · 이동 · 배정은 묶음 전체에(현행 동작 유지).
- **C1-R3 [U]** 아직 표인 표의 칸 클릭 → 그 칸 문장이 `pickedId`, 배정 행은 표 그대로. 오른쪽 칸 다듬기 대상 = 누른 칸.
- **C1-R4** J/K는 현행대로 행(묶음) 단위.
- **C1-R5** 호버 칠도 누른 단위.
**문구**: 꼬리표 en "Group · pair" · "Group · Table {n} (assigned as a whole)" / ko "묶음 · 짝" · "묶음 · 표 {n} (배정은 표째)".
**수용 기준**: C1-AC1 짝 KO 클릭 → KO만 진하게, 카드는 얇은 테. C1-AC2 표 칸 클릭 → 칸만 진하게, 표는 얇은 테 + 꼬리표, 오른쪽 칸 다듬기가 그 칸. C1-AC3 Del → 표 전체 삭제(현행). 스모크 `assign.mjs:721`(고리 2px)은 새 기대로 바꾸고 커밋에 사유(G6), `feature-map.md:22` 갱신. 시나리오 S8.

---

### C2 — 표 우클릭: "이 칸" 위, "이 표" 아래, 호버 시 닿는 칸 칠하기

**원문**: "테이블 우클릭 항목에 언어나 참조줄 셀단위 기능은 호버링시 해당 셀과 타겟 셀 하이라이트하고, 표단위 기능과 분리할 것"
**현재 동작(사실)**: 메뉴(FE `components/assign/assign-context-menu.tsx:186-199`) = Assignment(Unassign · Move · 구분선 · Delete) → Edit sentence 한 목록(소제목 "Each piece" :130, "Use as caption of" :159). 아직 표인 표의 칸 문장 항목(FE `lib/assign-context-menu-model.ts:232-278`): Unassign · Move · Delete = **표 전체**(UAP:1771-1773, `decideNow` :2040, `runClear` :2068), Split · Merge/Pair 앞뒤 · Pair with… · Separate · Language · Each piece · Reference = **칸**, Unwrap table = **표**(`findTableOf` :1197-1201), Use as caption of = 숨김(`caption-slot-model.ts:144`). 칸의 언어 · 참조는 표에 판단 있으면 "assigned"로 비활성(UAP:1184-1187). 벗긴 표 행 메뉴에 Back to table · AI order 없음. 호버 처리 없음. 재사용 가능한 강조: `data-link-hover`(FE `components/assign/link-lines.tsx:2, 312-313`, css:1877-1878), `data-flash`(:1880), `data-mate`(:1549-1550).

**요구**
- **C2-R1 [U]** 칸(또는 벗긴 표의 행) 우클릭 메뉴 = 두 구역, 순서 고정: **이 칸** 구역(언어 바꾸기 ⇧L, 참조 줄로, 앞 · 뒤 칸과 합치기, 짝 맺기, 나누기, Each piece …) → **이 표** 구역(표 배정 취소, 표를 To-Be 문서로 ⇧D, **표 전체 삭제**, 표 벗기기 ⇧T).
- **C2-R2 [U]** 표 단위 항목 이름에 범위를 넣는다("표 전체 삭제" 등).
- **C2-R3 [U]** 항목 호버 · 키보드 포커스 시 용지 칠하기: 바뀌는 칸 = 진한 칠, 함께 닿는 칸(합칠 앞 칸, 짝 맺을 칸, 참조 대상) = 점선, 표 단위 항목 = 표 둘레.
- **C2-R4 [U]** 벗긴 표 행의 "이 표" 구역에 다시 표로(⇧T) · AI 순서(⇧O).
**문구**: 구역 머리 en "This cell · row {r}, col {c}" · "This table · Table {n}" / ko "이 칸 · {r}행 {c}열" · "이 표 · 표 {n}", 항목 en "Delete whole table" / ko "표 전체 삭제" 등.
**수용 기준**: C2-AC1 구역 순서와 항목 배치. C2-AC2 "앞 칸과 합치기" 호버 → 두 칸 칠함, 떠나면 해제. C2-AC3 표 단위 호버 → 표 둘레. `assign-context-menu-model.test.ts:53`, `:174` 갱신, 스모크 `assign.mjs:885-888`, testid `assign-ctx-<action>` 유지, 설명서 표(562-574). 시나리오 S9.

---

### F3 — 개요 · 대시보드: 처분별 진행

**원문**: "결정의 의미가 변한만큼 개요나 개요대시보드가 제대로 현황을 반영 못하는것 같으니 같이 확인해줘"
**숫자 위치(사실)**: ① 개요 Coverage(FE `app/bundles/[id]/page.tsx:59-63,148-227` ← BE `load_bundle_progress` `sop/snapshot.py:599-645`; 행 = 짝 1 또는 Unit 1, 옛 문서 · 활성 · 최신 추출 · `group_unit_id IS NULL` · `noise_kind IS NULL`) ② 다음 할 일 `countPending`(FE `lib/progress-model.ts`) ③ 검토 조건(BE `review.py:36-37,109`) ④ 묶음 목록(FE `app/page.tsx:29-36`) · 관리 목록(`bundles-panel.tsx`) ⑤ Assign 위쪽 `assign-progress`(UAP:242-244, 3563) · 필터 칩(:389-393) · PendingCount(나누기 · REF · 캡션) ⑥ 문서 대시보드 `assign-dash`(UAP:1322-1328, FE `lib/doc-dashboard-model.ts`, `components/assign/doc-dashboard.tsx`).
**불일치(사실)**: a 삭제 · 이동도 "Confirmed" → 전부 지운 문서가 100%. b 대시보드에 항상 0인 `ai_suggested` 칸(`doc-dashboard.tsx:18-24`, `doc-dashboard-model.ts:33`; v1.3.0 e3bf6197 · Alembic 0031에서 그 상태 폐지; `doc-dashboard-model.test.ts:22,41` · 도움말 칩 `assign-help.tsx:50`이 고정). c 보낼 곳 둔 보류 → "간 곳"엔 포함, 막대에선 보류(`classify-model.ts:582`). d 편집으로 전체 수 변화가 안 보임. e 손질은 숫자에 없음. f 캡션 · 목차 행은 전체에서 빠지는데 그림 행은 포함.

**요구**
- **F3-R1 [U]** 확정(처분 무관) = **"정함"**. 막대를 처분별로 분할: 배정 · 삭제 · 이동(레거시 기록이 있을 때만) · 보류 · 안 정함, 범례에 수.
- **F3-R2 [U]** 개요에 추가: **남은 손질**(참조 · 캡션 · 나누기 — Assign PendingCount와 같은 셈), **AI 제안 대기**(live 제안 중 Unit이 활성이고 행이 안 정함인 것만 — 이 세기 함수를 이 브랜치에서 만들고 E3가 재사용), **그림 행 따로**.
- **F3-R3 [U]** 그림 행은 **모든 진행 숫자에서 제외**(개요 · 묶음 목록 · 관리 목록 · Assign 위쪽 — `RowProgress` 하나로) → "그림 m/n 정함"으로 따로 표시. **검토 요청 조건은 현행**(그림까지 정해야 함), 막히면 사유에 "그림 n개 남음".
- **F3-R4 [U]** 대시보드 `ai_suggested` 칸 → "AI 제안 대기"(F3-R2와 같은 셈).
- **F3-R5 [D]** 보낼 곳 둔 보류 행은 어디서나 **보류**로 센다(상태 기준). 대시보드 "간 곳" · 받는 문서 수는 **정한 행만**.
- **F3-R6** G9의 세 사본과 `build_review_facts` 불변식을 함께 갱신.
- **F3-R7** 편집에 의한 구조 변화(d)는 이번에 표시하지 않는다 [U].
**문구**: en "Decided" / ko "정함", "Assigned · Deleted · Moved · On hold · Unassigned" / "배정 · 삭제 · 이동 · 보류 · 안 정함", en "Left to tidy: references {r} · captions {c} · splits {s}" / ko "남은 손질: 참조 {r} · 캡션 {c} · 나누기 {s}", en "AI suggestions waiting" / ko "AI 제안 대기", en "Figures: {m} of {n} decided" / ko "그림 {n}개 중 {m}개 정함".
**수용 기준**: F3-AC1 모든 행 삭제한 문서 → "정함 100%"이고 막대가 전부 삭제 색. F3-AC2 개요 · 목록 · Assign 위쪽 %가 같다(그림 제외). F3-AC3 그림 미결정 시 검토 요청 막힘 + 사유. F3-AC4 대시보드 "AI 제안 대기"가 E3 기준. 스모크 `assign.mjs:86,477,3169`(`assign-progress`) 갱신. 시나리오 S10.

---

### F1 — Excel 미리보기 정리 · 받을 때 묻기

**원문**: "엑셀 미리보기에 문단은 제외하고 출력시엔 물어볼것, 그림위치도 생략할것" · "'문단 제외'는 기존 문서의 ToC를 의미하는 거였음"
**현재 동작(사실)**: Space 미리보기 시트 = 1단 보기 문단 Excel / 2단 보기 그 Old 문서의 Excel A(FE `lib/space-preview-model.ts:79-81` `pickSpaceSheet`), 문단 미리보기는 항상 `tables=true`(FE `lib/api-sop.ts:1577-1580`). 미리보기 받기 단추는 묻지 않음(FE `components/assign/space-preview.tsx:159-175` — 문단 Excel `downloadParagraphs(…, true)`, Excel A 묶음 전체 `export.xlsx`). 문서 대시보드 받기만 With/Without tables(`doc-dashboard.tsx:117-152`). 문단 Excel(BE `sop/paragraph_excel.py`): 열 Section No. · Text · Lang · Number note · Remark(:43), 본문만(:117), 아직 표인 표 = 행 1개당 줄 1개 · 칸 글 ` | ` 연결(:133-147), 그림 = 제자리 `[Figure] 그림 글 캡션`(:148-151), 확정 삭제 행 = Remark "Deleted" · 취소선 · Lang 빈칸(:8-10, :212-216), **목차 행 = 번호 칸 없는 보통 줄**(:80, :346 `noise`). 미리보기만 삭제 행 숨김 · 고른 동안만 표시(FE `lib/sheet-view-model.ts:188-191`). Excel A 위치 칸 "§절 · 자리 · p.쪽"(BE `sop/sheet_model.py:257-263`), 자리 = 문단 "Paragraph"(ko "문단") · 그림 "Figure"(BE `sop/outputs.py:1032-1062`, `sop/output_labels.py:53-54, 89-90`). 목차 행 = 업로드 시 `noise_kind="toc"`(BE `sop/segment.py:362-394`), 자동 "삭제 · 목차", Excel A 미리보기는 연속 목차 행을 1줄로 접음(`sheet_model.py:136,:330`, `outputs.py:123`).

**요구**
- **F1-R1 [U]** 미리보기(두 시트): 위치 칸의 "Paragraph/문단" 글자 제거(§ · p.만), 그림 자리 제거(문단 Excel `[Figure]` 행 · Excel A 위치의 "Figure" 조각), 삭제 행은 현행(고른 동안만), **옛 문서 목차 행은 1줄로 접기**(문단 Excel 시트에도).
- **F1-R2 [U]** 문단 Excel 받기(Space 미리보기 · 문서 대시보드) 시 창으로 묻는다: 아직 표인 표 포함 · 삭제 행 포함 · 그림 자리 포함 · 옛 문서 목차 포함. 서버 문단 Excel에 네 매개변수 추가.
- **F1-R3 [D]** 기본값: 표 · 삭제 행 · 그림 자리 = 켬(현행 파일과 같음), 목차 = 끔 [U].
- **F1-R4 [D]** Excel A 받기(묶음 전체 `export.xlsx`)는 현행. "Paragraph" 글자는 미리보기에서만 제거.
- **F1-R5** 미리보기가 "받는 파일과 같은 행"이라 약속하는 문구(`assign.spacePreview.sameFile*`)를 새 규칙으로 교체.
**문구**: 창 제목 en "Download Excel" / ko "Excel 받기", en "Include tables still as tables" · "Include deleted lines" · "Include figure places" · "Include the old table of contents" / ko "아직 표인 표 포함" · "삭제한 줄 포함" · "그림 자리 포함" · "옛 문서 목차 포함", 접힌 목차 en "▸ Table of contents · {n} lines" / ko "▸ 목차 {n}줄", 안내 en "The preview folds the table of contents and hides figure places and deleted lines. Choose what to include when you download." / ko "미리보기는 목차를 접고 그림 자리 · 삭제 줄을 숨깁니다. 받을 때 넣을지 고릅니다." **testid 제안**: `space-download-dialog`.
**시험**: BE `tests/test_sop_paragraph_excel.py:220`(그림 자리 — 기본 켬이면 유지), `:253`(can_drop_tables), `test_preview_matches_the_file` 계열을 새 약속으로, `tests/test_sop_outputs.py:783`(place == "Paragraph" — 파일은 현행), FE `lib/output-location.test.ts:8`, 스모크 `assign.mjs:641-659`(대시보드) · `:2993-3006`(Space 받기 즉시 다운로드 → 창).
**수용 기준**: F1-AC1 미리보기에 목차 1줄 · "문단" 글자 없음 · 그림 자리 없음. F1-AC2 받기 창 기본값으로 받은 파일 = 현행 파일에서 목차 행만 빠짐. F1-AC3 네 체크 각각이 파일에 반영. 설명서 `:432`, `:770`. 시나리오 S11.

---

### F2 — To-Be 문서로 이동, 없으면 새로 추가 (다른 Bundle로 이동 제거)

**원문**: "다른 문서가 없으면 다른 문서로 보내기 버튼 비활성화하고 1개인 경우 그 이름으로 변경, 2개 이상인 경우 플라이 아웃형식으로" · "번들이동이 좀더 심플해야될듯함.. 한 번들 내에서만 문단의 이동이 일어나는 걸로 단순화 하고.... 없으면 번들에 문서를 추가하는 방식으로 진행. 번들이란 표현은 여기서만 사용하고 있으니 혼동이 올 수 있으니 to be 문서로 이동 등의 명확한 표현사용. 현재 번들이란건 결국 기존 작성된 문서로 보내는게 아니라면... (이건 수정 불가니까) 다른 번들로 갈일이 없긴함"
**현재 동작(사실)**
- 화면의 "다른 문서로 이동" = **다른 Bundle**로 보내는 `move_external`: 우클릭 `assign-ctx-move`(FE `lib/assign-context-menu-model.ts:232-237`), **M**(UAP:3460), 오른쪽 칸 "Delete or move"의 Moved `assign-pick-move`(SP:203) → `MoveTargetField`(SP:981-988), 일괄 `assign-bulk-move`. `MoveModal`(PG:950-959, 1000-1041) → `decideNow({kind:"move"})`. 후보 `GET /bundles/{id}/move-targets` = **내가 멤버인** 다른 Bundle의 To-Be 문서 + 전에 쓴 이동 코드(BE `sop/remarks.py` `list_move_targets` :105-150), 직접 입력 허용(FE `components/assign/move-target-field.tsx`). 박스를 그 Bundle에 **복사하지 않는다** — 처분 + 대상 번호만, 상대에겐 참조 지도의 줄 수로만(BE `sop/ref_map.py` :145-156, :242-250), Excel A엔 "Moved to another document · 번호".
- 같은 Bundle의 다른 To-Be 문서로는 오른쪽 칸 **All** 트리 · 끌어 놓기뿐. 보낼 곳 = 문서 안의 자리: SOP = 표준 골격 칸(`slot` · `slot_heading`), WI = 단계 × Instruction/Why, 단계 없으면 단계 없는 자리(FE `lib/classify-model.ts:139-185` `buildDestinationOptions`, `entrance === "assign"` 문서만).
- To-Be 문서 추가 API: `POST /bundles/{id}/tobe/docs`(BE `routers/sop_tobe.py:151-162`, 묶음 역할 **author** `_require_author`), 본문 `NewDocIn{code, doc_type, parent_code}`(BE `sop/tobe.py:653-658` — 제목 없음), FE `addToBeDoc`(`lib/api-sop.ts:740-748`). 제목 등 수정 = `PATCH /bundles/{id}/tobe/docs/{target_doc_id}`(`routers/sop_tobe.py:208`, FE `api-sop.ts:773`).

**요구**
- **F2-R1 [U]** 동작 이름 **"To-Be 문서로 이동"**. 진입: 우클릭 · 오른쪽 칸 결정 자리 · ⇧D · 일괄(G1). 대상은 같은 Bundle의 To-Be 문서(`entrance === "assign"`)만. 이동 기능 문구에 "Bundle" 미사용.
- **F2-R2 [D]** "다른" = 박스가 현재 배정된 문서를 뺀 To-Be 문서(안 정한 박스면 전부). **0개**: 항목 활성, 펼침에 "+ 새 To-Be 문서 추가…"만(사용자 메모 "없으면 문서를 추가"가 처음의 "0개면 비활성"을 대신함). **1개**: 항목 이름 = 그 문서, 펼침 = 그 문서의 자리 목록 + 맨 아래 "+ 새 To-Be 문서 추가…". **2개 이상**: 문서 펼침(FE `lib/flyout.ts`, `user-menu.tsx` 선례) + 맨 아래 "+ 새 To-Be 문서 추가…".
- **F2-R3 [U]** 문서 선택 → 그 문서의 자리 목록을 한 단 더 펼친다. 박스가 이미 SOP 칸에 있으면 **같은 칸(같은 slot key)이 맨 위**. WI는 단계 · Instruction/Why. 선택 = 현행 All 트리 선택과 같은 저장, Ctrl+Z 1칸.
- **F2-R4 [U]** 새 To-Be 문서 추가 창: 종류(SOP/WI) · 번호 · 제목 · (WI면 상위 — 비워 둘 수 있음, v1.4.19). 기존 `POST /tobe/docs`로 생성 후 제목은 PATCH(또는 `NewDocIn`에 선택 제목 추가 [B]). 권한 = To-Be 화면과 같음(author). 생성 후 즉시 그 문서의 자리 목록으로. 번호 규칙 거절(`rule.duplicate_code` 등)은 창에 표시.
- **F2-R5 확인 필요 [B]**: 새로 만든 SOP의 표준 골격 칸(`tobe.outline_items`)이 생성 직후 자리 목록에 나오는지, 새 문서 `entrance`가 `assign`인지. 아니면 그 경로를 맞춘다.
- **F2-R6 [U]** `move_external` 생성 경로를 화면에서 제거: 우클릭 항목, M, Moved 잎 · `MoveTargetField`, 일괄 이동, `MoveModal`. **서버 API · 데이터는 유지**.
- **F2-R7 [U]** 운영에 이미 `move_external`로 정한 박스는 그대로 보인다: 오른쪽 칸에 "다른 문서로 이동 · {번호}(이전 기능)" 읽기 전용, 배정 취소로 풀 수 있고 풀면 다시 고를 수 없다. Excel A · 지도 표시는 현행.
- **F2-R8** 문구 정리: `assign.ctx.move` · `assign.moveModal.*` · `assign.move.*` · `classify.moved` · `classify.bulkMoveTitle` · `assign.help.keyMoveTo` 제거 · 교체(Excel A용 `outputs.dest.move_external`, 지도 `map.legend.moved`는 유지).
**문구**: en "Move to To-Be document" / ko "To-Be 문서로 이동", en "Move to {code}" / ko "{code}로 이동", en "+ Add a To-Be document…" / ko "+ 새 To-Be 문서 추가…", 창 en "New To-Be document" · "Type" · "Number" · "Title" · "Add and pick a place" / ko "새 To-Be 문서" · "종류" · "번호" · "제목" · "추가하고 자리 고르기", 결과 알림 en "Moved to {code} {place}" / ko "{code} {place}로 옮겼습니다", 레거시 en "Moved to another document · {code} (previous feature)" / ko "다른 문서로 이동 · {code} (이전 기능)". **testid 제안**: `assign-move-tobe`, `assign-move-tobe-doc-<code>`, `assign-move-tobe-place-<id>`, `assign-add-tobe-doc`.
**수용 기준**: F2-AC1 문서 0 · 1 · 2+개에서 F2-R2대로 표시. F2-AC2 같은 칸이 맨 위, 선택 시 배정 · Ctrl+Z 1회 복구. F2-AC3 새 문서 추가 → To-Be 화면 · Documents에 즉시 보이고 그 문서의 자리로 배정. F2-AC4 M · 다른 Bundle 이동 UI 없음, 레거시 박스는 읽기 전용 표시. 설명서 `#assign-confirm`(547행). 시나리오 S12 · S13.

---

### E1 — 떨어진 짝 왼쪽 괄호선

**원문**: "떨어진짝이 한 화면에 있으면 왼쪽 부분에 선으로 표시"
**현재 동작(사실)**: `matesOf`(paper.tsx:390-403). 이웃한 짝 = 카드(`getPairBrackets` FE `lib/strip-pill-model.ts:137`, css:1426-1432). 떨어진 짝 = 행 끝 짝 아이콘(paper-model.ts:376-379), 고른 동안 상대에 `data-mate`(paper.tsx:686,997), 고른 박스 아래 안내 줄 `assign-paper-pair-hint-<id>`(FE `lib/pair-hint-model.ts:27-39`, paper.tsx:801-823,1263 — 화면 노출 여부 무관). 선 그리기 선례: `link-lines.tsx`(Old↔New), `pair-lines.tsx`(Pair view) — `.assign-panes` 기준 SVG, `getBoundingClientRect`, ResizeObserver · 스크롤 캡처 · resize를 rAF 1회로 묶음(`pair-lines.tsx:38-95`), 두 끝이 칸 안일 때만(:58). `unwrap-rail`(paper.tsx:1428-1431)은 행마다 span이라 연속 행 전용.

**요구**
- **E1-R1 [U]** 고른 박스의 떨어진 짝이 **둘 다 Old 칸 화면 안**이면 왼쪽 여백(`strip-lead` 왼쪽)에 괄호선. 고른 짝만.
- **E1-R2 [U]** 하나라도 화면 밖이면 현행 안내 줄. 괄호선이 보이면 안내 줄은 숨김.
- **E1-R3** 화면 안 두 박스만 측정(화면 밖 청크 강제 레이아웃 금지 — A2 원인 3과 같은 함정). 괄호선은 표시 전용(클릭 동작 없음, 짝으로 가기는 G).
- **E1-R4** 새 effect가 필요하면 G5 승인. `pair-lines.tsx` 측정 훅 확장을 먼저 검토.
**testid 제안**: `assign-pair-bracket`.
**수용 기준**: E1-AC1 둘 다 보이면 괄호선 · 안내 줄 숨김. E1-AC2 스크롤로 하나가 밖으로 나가면 안내 줄. 스모크 `assign.mjs:5247`(`pair-hint`) 갱신. 시나리오 S14.

---

### E2 — 표 탭 · 본문 표 접기

**원문**: "탭 중에 표만 보기 > 표 내용은 생략하고 본문" · "본문에 표 내용은 그대로 나오고 접을 수 있게함"
**현재 동작(사실)**: 탭 키 `["body","header","footer","figures"]` 중 내용 있는 것(UAP:662, `PaperTabKey` paper-model.ts:592), 활성 탭 = 수동 선택 또는 고른 박스의 탭(:708-712), 전환 = 클릭만(`part-tabs.tsx`, PG:625), J/K는 탭 안에서만(:1131, :1152). 본문 탭 `figureRows="hide"`(FE `components/assign/old-pane.tsx:164`) — 그림 · 캡션 빠지고 자리 표시 없음, 그림 탭 = `FigureTab` 카드(:230-232), 표는 본문에 통째로. 상태 필터 접기(FE `lib/paper-fold-model.ts`)는 맞지 않는 구간을 1줄로 접는다(재사용 가능).

**요구**
- **E2-R1 [U]** **표 탭**(수 표시): 그 문서의 표만 — 아직 표인 격자, 벗긴 표의 행과 머리. 표마다 위치 머리("§5 아래"). J/K는 표 탭 안에서.
- **E2-R2 [U]** 본문 탭의 표는 **처음엔 펼침**(현행), 표 머리에 접기 단추. 접힘 = 1줄 자리 표시(캡션 · 크기), 클릭하면 펼침.
- **E2-R3** 본문 탭 위에 "표 모두 접기 · 펼치기" 단추 1개.
- **E2-R4 [U]** 접힘 상태 문서별 기억(브라우저 저장, try/catch, 키 예 `sopa.assign.tablesFolded.<docId>` [B]).
- **E2-R5** 탭 전환 키는 B2(Ctrl+← →, 뒤로 가기).
**문구**: 탭 en "Tables" / ko "표", 접기 en "Collapse" · "Expand" / ko "접기" · "펼치기", 모두 en "Collapse all tables" · "Expand all tables" / ko "표 모두 접기" · "표 모두 펼치기", 자리 표시 en "▸ Table {n} · {caption} · {rows} x {cols}" / ko "▸ 표 {n} · {caption} · {rows}행 {cols}열". **testid 제안**: `assign-tab-tables`(기존 `assign-tab-<key>` 꼴), `assign-table-fold-<t>`, `assign-tables-fold-all`.
**수용 기준**: E2-AC1 표 탭에 그 문서의 표만. E2-AC2 접기 → 1줄, 클릭 → 펼침, 새로고침 후 유지. 문구 `split.tab.*`(i18n :1267-1270, ko :3294-3297), 기능 맵 `assign-tab-figures` 설명 · J/K 규칙, 설명서 `:430-431`. 시나리오 S15.

---

### E3 — AI 제안은 안 정한 박스에만 산다

**원문**: "AI삭제가 늘 남아있는데.. 클릭하면 없앨까? 지속적인 노출은 필요없을듯한데" · "이미 결정한 사항에 AI제안이 계속 남아있는게 문제인듯함"
**현재 동작(사실)**
- 노출 4곳: ① 박스 아래 `assign-ai-note-<id>` "AI · Deleted"(PG:399-410) ② 오른쪽 칸 `assign-ai-reason`(SP:926-942) ③ Suggested AI 카드(UAP:603-615, SP:191) ④ 상단 알약 `top-bar-ai` · 수락 창(FE `components/ai-jobs-indicator.tsx:76-84`, 팝오버 `ai-accept-offer`).
- live = `result==="applied" && adoption===null`(FE `lib/ai-suggestion-model.ts:8-10`). ①②③은 `findRowSuggestion`(:23-31)이 **안 정한 행만** 반환. 정하는 경로는 모두 제안을 거둔다: `save_group`(BE `sop/decisions.py` `record_group_adoption` :1479, `judge_unused_suggestions` :1484), 즉시 확정 `dispose_units`(:1649-1653), `clear_unit`(:1676-1678), 초기화(:1722).
- **`BE/sop/editing.py`(합치기 · 나누기 · 표 벗기기 · 다시 표로 · 언어 · 모양 전환)는 제안을 건드리지 않는다** → 은퇴 · 변경된 Unit의 제안이 live로 남는다.
- **④ · 수락 창 수 `countLiveOffer`(FE `lib/ai-accept-model.ts:44-51`, UAP:635-636)는 Unit 상태 · 활성 여부를 보지 않는다.** 필터 칩 AI 수(UAP:389-393) · F3 "AI 제안 대기"도 같은 목록.
- 분류 제안은 사람이 직접 채택을 적는 길이 없다(`BE/sop/ai/adoption.py:31-32,375-382` — split · unwrap_order만).

**요구**
- **E3-R1 [U]** 편집이 Unit을 은퇴시키면 그 Unit을 덮는 live 제안을 같은 트랜잭션에서 `result="stale"`로 거둔다(재실행하지 않음).
- **E3-R2 [D]** 편집을 Ctrl+Z로 되돌려도 거둔 제안은 되살리지 않는다. 채택률 통계(`load_adoption_stats`, `_count_offered`)에서 stale의 의미가 바뀌지 않게 확인.
- **E3-R3 [U]** 세기 기준 = live이고, Unit이 활성이고, 행이 안 정함: 상단 알약 · 수락 창(`countLiveOffer`), 필터 칩, 대시보드 · 개요 "AI 제안 대기"(F3에서 만든 함수). 알약은 0이면 숨김(AI 작업 중에는 현행대로 표시).
- **E3-R4** 수락 창 "모두 받기"(FE `components/assign/accept-suggestions-modal.tsx`, BE `sop/accept_suggestions.py` `preview_accept` · `accept_suggestions`)도 같은 기준으로 거른다(이미 정한 박스에 재적용 금지).
- **E3-R5 [U]** 박스 아래 "AI · …"는 안 정한 박스 모두에 현행대로. 운영 DB의 기존 좀비 제안은 변경하지 않는다(세는 쪽이 거름, 마이그레이션 없음).
**시험**: E3-T1 BE 편집 시험 — 합치기 후 은퇴 Unit의 제안이 stale. E3-T2 FE `countLiveOffer` — 정한 · 은퇴 Unit 제외. `test_invariants.py` 통과.
**수용 기준**: E3-AC1 모든 박스를 정하면 알약이 사라진다. E3-AC2 제안 있는 두 박스를 합치면 두 제안이 거둬지고 수가 줄어든다. E3-AC3 "모두 받기"가 정한 박스를 건드리지 않는다. 시나리오 S16.

---

### D1 — 표 번호 이어 매기기 · 합치면 뒤 번호 당기기

**원문**: "표 내의 번호는 새로운 번호로 시작하는데 이거 연속된 번호로 시작하게 해줘 (한/영 따로 써진 문서 아니면 통일된 번호로)" · "안쪽 내용이 합쳐지면 번호 재배정?"
**현재 동작(사실)**: 벗긴 표의 숫자만 든 칸 = 그 행의 번호(`NUMBER_CELL`, BE `sop/segment.py:58-60`, `sop/numbering.py:78`) → 1부터. Word 자동 번호도 칸 안 목록이 따로면 1부터(BE `sop/extract/docx_reader.py:243-274`). 이어 세기 3경로: 번호 칸 창 제안(FE `lib/number-kind-model.ts:71-80`, `lib/number-model.ts:150-157` — 표 경계 무시, 한 행만, 값 불변), 따라 고치기(FE `number-model.ts:133-148` `listNumberSiblings` ↔ BE `sop/editing.py:1044-1074` `_plan_set_number`, `plan_follow` `numbering.py:399` — **같은 표 안에서만**), 문단 Excel Section No.(BE `numbering.py:236-264`, `paragraph_excel.py:342-343` — 칸 번호는 그 표 안에서만). 번호 규칙 어디도 `language_layout` 미사용(사용처 UAP:644 · :837 · :3084). 합치기 `_plan_merge`(`editing.py:643-659`)는 `units[0]`로 새 Unit을 만들고 **뒤 번호를 재배정하지 않는다**.

**요구**
- **D1-R1 [U]** 표를 **벗길 때 자동으로** 표 안 숫자 칸 번호를 **위 번호의 아래 단계**로 매긴다(제목 5 아래 1 · 2 · 3 → 5.1 · 5.2 · 5.3). 숫자 칸이 아닌 행(점 기호 · 직접 · 없음)은 건드리지 않는다.
- **D1-R2 [U]** **위 번호** = 표 밖의 가장 가까운 숫자 번호(제목 · 본문의 연속 번호). `1)` 꼴 · 점 기호 · 직접 번호 행은 건너뛴다. 같은 언어, 한/영 따로 문서면 같은 반쪽. 위 번호가 없으면 그대로 둔다.
- **D1-R3 [U]** 그 위 번호 아래에 이미 자식 번호가 있으면(앞 표가 5.1–5.3, 본문 5.1 등) **이어서** 다음 번호부터(같은 제목 아래 둘째 표 → 5.4).
- **D1-R4 [U]** 흐름: 한 언어 · 번갈아 문서는 표 안팎 한 흐름(번갈아는 한/영 행이 같은 번호를 나눔 — 현행처럼 언어별로 셈), 한/영 따로 문서는 반쪽별.
- **D1-R5 [D]** 이어 매기기는 벗기기 직후의 별도 되돌리기 1칸으로 기록: 첫 Ctrl+Z = 원래 번호(벗긴 상태 유지), 두 번째 = 다시 표로.
- **D1-R6 [U]** **합치면 같은 목록의 뒤 번호를 당긴다**(본문 · 벗긴 표 어디서나). "같은 목록" = 따라 고치기와 같은 범위(같은 언어 · 같은 표 안, 표 밖은 표 밖). 합치기와 같은 되돌리기 1칸.
- **D1-R7 [U]** 문단 Excel Number note에 원래 번호(en "Original {n}" — 기존 "Read from text" 꼴). Section No.는 새 번호를 따르며 "칸 번호는 그 표 안에서만" 규칙과 맞는지 확인. G9 규칙 사본 동기화.

**정답 표(시험 데이터로 사용)**
| 입력 | 결과 |
|---|---|
| 제목 5 아래 표(1 · 2 · 3) 벗김 | 5.1 · 5.2 · 5.3 |
| 같은 제목 5 아래 둘째 표(1 · 2) 벗김(첫 표 5.1–5.3) | 5.4 · 5.5 |
| 제목 5 아래 본문 "5.1" 다음 표(1 · 2) | 5.2 · 5.3 |
| 본문 "5.2" 아래(자식 없음) 표(1 · 2) | 5.2.1 · 5.2.2 |
| 위가 "1)" 또는 점 기호 행, 그 위가 제목 5 | 제목 5 기준(5.1 …) |
| 위 번호가 없는 문서 첫 표 | 그대로(1 · 2 · 3) |
| 한/영 따로 문서 영어 반쪽 제목 5 아래 표 | 영어 반쪽 안에서 5.1 … |
| 5.1 · 5.2 · 5.3 · 5.4에서 5.2 + 5.3 합치기 | 5.1 · 5.2 · 5.3 |
| 벗김 직후 Ctrl+Z 1회 / 2회 | 원래 번호 / 다시 표 |

**시험**: FE `number-model.test.ts:33,42`, `number-kind-model.test.ts:61,73,101`, BE `test_sop_paragraph_excel.py:73,84,332,358` 갱신, 정답 표를 `rule-cases.json`에 추가.
**수용 기준**: D1-AC1 정답 표 전부 통과(FE · BE 양쪽). D1-AC2 Number note에 원래 번호. 설명서 `:432`, `:605`. 시나리오 S17.

---

### D2 — 한글 표에서 한 일을 영어 표에 제안

**원문**: "테이블 AI 순서제안에서 한/영 문서의 경우 위쪽에 한글 작업이 되어있으면 참고해서 삭제/병합/들여쓰기 수준도 같이 제안해주면 좋을듯함" · "꼴뿐만 아니라 내용의 유사도로 비교해야됨 꼴은 재활용 내용은 다른 경우가 매우 많음"
**현재 동작(사실)**
- ✦ AI order(v1.4.16): FE `lib/use-unwrap-ai.ts:41-90`, `lib/unwrap-ai-model.ts:12-33`(행 집합 동일 시만 미리보기), 적용 = 편집 `reorder_unwrapped` 1회(UAP:670-680) 후 채택 `as_is`. 서버 `POST /ai/unwrap_order`(BE `routers/sop_ai.py:182-191`), `sop/ai/unwrap_order_job.py`: 페이로드 `{task, table: 원문 격자 Markdown, lines: [{id, text, row, col}]}`(:152-158 — 언어 · 짝 · 판단 · 들여쓰기 없음), 응답 `{order, reason}`(:37-41), 순열 검사(:174-180), 낡음 = 행 집합 · 글 해시(:200-208), 제안 내용 `{table_id, unit_ids, reason}`(:186-197), 채택은 수동(`ai/adoption.py:32` `_MANUAL_KINDS`, `routers/sop_ai.py:234-247`). 지침 `ai/seeds/prompt.unwrap_order.md`("You only reorder. You never rewrite, merge, drop, or add a line"), 시드는 키에 버전이 없을 때만(`ai/guidelines.py:48-66`).
- 한/영 표 연결: **한/영 따로 문서만**, 둘 다 벗긴 같은 꼴 표를 계산으로 연결(BE `sop/counterparts.py:136-155`, 표↔표 관계 미저장), 행 수 같으면 같은 행끼리 제안 짝(`sop/units.py:248-251, 283-319`), 다르면 경고 `pair_rows_differ`. **번갈아 문서는 표가 바뀌면 짝을 끊음**(`units.py:369-405`) → 위 한글 표 ↔ 아래 영어 표 연결 없음.
- 적용 가능한 편집: 삭제 = 판단 저장, 합치기 `MergeOp`(`editing.py:141`), 들여쓰기 `SetIndentsOp`(:264) · `SetNumberOp.indent_shift`(:241-262), 순서 `ReorderUnwrappedOp`(:301).
- 임베딩: `BE/sop/ai/embeddings.py`, 모델 `EMBED_MODEL`, `EMBED_ENABLED` 기본 false. 한/영 교차 성능은 운영 모델로 미측정. 기존 유사도 임계값은 합성 자료로 잡은 값.

**요구**
- **D2-R1 [U]** 짝 표 판정 점수 = 꼴(행 · 열 수) + **언어 무관 토큰 겹침**(숫자+단위 37 °C · 10 mL · pH 7.0, 문서 번호 SOP-QC-0101, 영문 약어, 날짜) + **임베딩 유사도**(`EMBED_ENABLED`일 때). 꼴만으로 연결 금지.
- **D2-R2 [U]** 번갈아 문서: 후보 = **바로 위의 같은 꼴 한글 표**. 한/영 따로 문서: 기존 counterparts 후보에 점수 적용.
- **D2-R3 [U]** 애매하면(점수 < 임계값, 또는 상위 두 후보 근접) 표 머리에 **"짝 표 고르기"** → 사람이 지정. 지정 결과는 저장(새 표 또는 열 — G7 더하기만 [B]).
- **D2-R4 [U]** 표 안은 **행마다 내용으로 짝을 맞춘 뒤** 제안(위치 기준 금지).
- **D2-R5 [U]** 맞춘 꼴이 같으면 **규칙 제안**(AI 없음 — 한글 표에서 한 편집을 대응 행에 투영), 다르면 **AI 제안**.
- **D2-R6 [U]** 제안 종류: 순서 · 삭제 · 합치기 · 들여쓰기 · 번호.
- **D2-R7 [D]** 규칙 제안은 AI 제안이 아니다 — `ai_suggestions` 행으로 저장하지 않고 즉석 계산해 보인다. 알약 · 수락 창 · "AI 제안 대기"에 포함되지 않는다.
- **D2-R8** UI: 영어 표 머리에 "한글 표처럼 하기 · n건" → [적용](편집 묶음 1회 = Ctrl+Z 1칸) · [하나씩 보기] · [그대로 두기], 행마다 제안 칩. 진입은 ✦ AI order(⇧O)를 확장 — 손본 한글 짝 표가 있으면 이 제안, 없으면 현행 순서 제안.
- **D2-R9** AI 경로(꼴이 다를 때): 새 작업 종류(G8: CHECK · `GUIDELINE_KEYS` · 지침 시드 v1), 페이로드 = 한글 표의 손본 결과(행 글 · 처분 · 순서 · 들여쓰기 · 번호) + 영어 행(실명 없음), 응답 검증(같은 행 집합 · 알려진 편집 종류만), 채택은 수동 기록(`_MANUAL_KINDS`에 추가), 가짜 AI(`frontend/scripts/fake-ai-server.mjs`)에 응답 모양 추가.
- **D2-R10** 임계값은 상수로 두고 "합성 자료 기준, 실제 문서로 재설정" 주석. 실제 SOP · 실제 모델 미검증을 CHANGELOG에.
**걸음(모음 `feat/table-follow`, 걸음마다 그 diff만 검토, 모음 → dev 시 재검토 대신 시험 · 스모크)**: `-1-counterpart`(D2-R1~R3), `-2-rule`(D2-R4~R8), `-3-ai`(D2-R9~R10).
**수용 기준**: D2-AC1 같은 꼴 · 다른 내용 표를 짝으로 잡지 않는다(합성 시험). D2-AC2 행 순서가 다른 같은 내용 표에서 행 짝을 맞춘다. D2-AC3 규칙 제안 정답(부록 A S18). D2-AC4 AI 응답 검증 · 낡음 처리. D2-AC5 `test_invariants.py` 통과. 시나리오 S18.

---

## 5. 빌더 재량 [B]

문구 최종 꼴 · i18n 키 이름 · testid 이름(제안은 예시), 구현 파일 이름 · 상태 위치, A1 실패 알림 모양 · 역전환, A2 원인별 수정 방법, B2 뒤로 가기와 App Router 연동, B2-R3 힌트 모양, E1 그리기 방법(G5 안에서), F2 새 문서 제목 저장 방식(PATCH 또는 요청 본문 확장), D2 저장 모양 · 점수 식.

## 6. [D] 목록 — 명세 작성자 판단(사용자 미확인)

| ID | 내용 |
|---|---|
| §3 | G1을 F2 뒤로 |
| A1-R3 | 고름을 바꾸는 명령은 장벽, 대기 중 키는 장벽 후 고름 기준으로 실행 |
| B2-R3 | Shift 없는 같은 글자 = 동작 없음 + 힌트 |
| G1-R3 | 언어 바꾸기 = "→ KO" · "→ EN", 짝 · 합친 박스는 건너뜀 |
| F1-R3 · R4 | 받기 창 기본값(표 · 삭제 · 그림 켬), Excel A 받기 현행, "문단" 글자는 미리보기에서만 제거 |
| F2-R2 | 0개면 "+ 새 To-Be 문서 추가…"만, 1개면 그 문서 이름 + 자리 목록, "다른" = 현재 문서 제외 |
| F3-R5 | 보낼 곳 둔 보류 = 보류, "간 곳"은 정한 행만 |
| E3-R2 | 편집을 되돌려도 거둔 제안은 되살리지 않음 |
| D1-R5 | 첫 Ctrl+Z = 번호만, 두 번째 = 다시 표로 |
| D2-R7 | 규칙 제안은 저장하지 않음(AI 제안 아님) |

---

## 부록 A. 시나리오 (사용자가 확인한 최종 시안 → Given / When / Then)

스모크 · 시험 명세로 그대로 쓸 수 있게 썼다. 문장 · 번호는 합성 예시. `▣` = 고른 박스.

**S1 · A1 큐** — Given 같은 문서 행 3(KO "작업 구역을 정리한다."), 4("탱크를 비운다."), 5("밸브를 연다."), 3을 고름, 서버 응답이 느림(지연 주입). When Del → J → Del 을 응답 전에 입력. Then 3에 처리 중 표시 · 고름 즉시 4 → 4에 "대기 1" · 고름 즉시 5 → 3 완료(접힘) → 4 전송 · 완료(접힘) → 행 목록 재조회 1회. 3 · 4 모두 삭제. (A1-R2 · R5 · R6, AC1)

**S2 · A2 애니메이션** — Given 삭제할 박스. When Del. Then 접힘 전환이 입력 즉시 시작하고, 서버 대기 동안 처리 중 표시가 보인다. 실패 주입 시 역전환. (A2-R6)

**S3 · B1 Enter** — Given 보낼 곳 미정 박스, Suggested 첫 카드 = ✦ AI "SOP-QC-0101 · §4.2 시료 채취", 둘째 = Nearby "§4.3". Then primary 라벨 "확정 → §4.2 · ✦ AI 그대로". When Enter. Then §4.2로 확정 + AI 글 저장 + AI 채택 기록 + 다음 박스 고름. 변형: 첫 카드 = 삭제 → 라벨 "삭제"(위험 색). 변형: Suggested 비어 있음 → 단추 비활성 + "보낼 곳을 먼저 고르세요", Enter = 알림 · 목록 강조. 변형: ⇧O 미리보기 중 → 라벨 "AI 순서 적용", Enter = 적용, Esc = 그대로. 변형: 보낼 곳 잎(All)을 클릭한 직후 Enter → 확정. 변형: 문서 대시보드에 마우스를 올린 채 J · Enter → 동작. (B1 전체)

**S4 · B2 글쇠** — When H → Then 보류 안 됨 + 힌트 "⇧H". When ⇧H → 보류. When 박스 고른 상태 Tab → 들여쓰기 저장(번호 칸 ▶와 같은 결과), Shift+Tab → 내어쓰기. When Ctrl+→ → 다음 탭, 뒤로 가기 → 이전 탭, 탭 기록 소진 후 뒤로 가기 → 이전 화면. When G(떨어진 짝 있음) → 짝으로 고름 이동. When ? → 도움말(목록 = 설명서 단축키 절). When M → 아무 동작 없음. (B2)

**S5 · J1 합치기** — Given 3 EN "Close the tank valves and drain the rest.", ▣4 KO "탱크 밸브를 닫고", 그 아래 KO "잔량을 배출한다.", 5 KO. When ⇧J. Then 4와 아래 행 점선 미리보기 + 안내 띠 "한 번 더 ⇧J로 합치기 · Esc 취소", 저장 없음. When ⇧J. Then 4 = "탱크 밸브를 닫고 잔량을 배출한다."(합침). When ⇧K. Then 3 EN과 4 점선 + "한 번 더 ⇧K로 짝 맺기". When ⇧K. Then 3 · 4 짝 카드, 알림 + Ctrl+Z. 변형: ⇧J 후 J → 미리보기 해제 + 이동. 변형: 목차 행에서 ⇧J → 사유 알림, 무장 안 함. (J1)

**S6 · G1 여럿 고르기** — Given ▣3. When ⇧G. Then 3 체크 + 위쪽 바 "1개 고름" [삭제] [To-Be 문서로 이동 ⇧D] [배정 취소] [언어 → KO] [언어 → EN]. When J, ⇧G. Then "2개 고름". When [배정 취소]. Then 큐로 처리, Ctrl+Z 1회에 둘 다 복구. 다른 Bundle 이동 단추 없음. When Esc → 체크 해제. (G1)

**S7 · B3 번호 칸 창** — Given 번호 칸 창(연속 번호, 입력 "5.1"). Then 아래에 [취소] [확인]. When [확인] → Enter와 같은 저장. Given 입력 비움 → [확인] 비활성 + "번호를 적으세요". When 바깥 클릭 → 저장 없이 닫힘. (B3)

**S8 · C1 고름** — Given 이웃한 짝 카드(5 KO "탱크를 비운다." / 5 EN "Empty the tank."). When KO 클릭. Then KO 행만 진한 칠, 카드는 얇은 테 + "묶음 · 짝". Given 아직 표인 표 2(3×3, 2행 2열 "온도"). When "온도" 클릭. Then 그 칸만 진하게, 표는 얇은 테 + "묶음 · 표 2 (배정은 표째)", 오른쪽 칸 다듬기 대상 = 그 칸. When Del → 표 전체 삭제. (C1)

**S9 · C2 표 우클릭** — Given 표 2의 2행 2열 "온도". When 우클릭. Then 위 "이 칸 · 2행 2열": 언어 바꾸기 KO→EN ⇧L · 참조 줄로 · 앞 칸 "예열"과 합치기 · 다음 칸 "37 °C"와 짝 맺기 · 나누기…, 아래 "이 표 · 표 2": 표 배정 취소 U · 표를 To-Be 문서로… ⇧D · 표 전체 삭제 Del · 표 벗기기 ⇧T. When "앞 칸과 합치기"에 호버 → "온도" 진한 칠 + "예열" 점선. When "표 전체 삭제"에 호버 → 표 둘레. Given 벗긴 표의 행 우클릭 → "이 표"에 다시 표로 ⇧T · AI 순서 ⇧O. (C2)

**S10 · F3 개요** — Given 503행: 배정 282 · 삭제 106 · 이동 24(레거시) · 보류 21 · 안 정함 70, 그림 9개 중 7 정함, 참조 3 · 캡션 2 · 나누기 1 남음, 안 정한 박스의 live AI 제안 3. Then 개요 "정함 82%"(그림 제외), 처분별 막대 · 범례, "남은 손질: 참조 3 · 캡션 2 · 나누기 1", "AI 제안 대기 3", "그림 9개 중 7개 정함". 대시보드 "AI 제안 대기 3". 묶음 목록 · Assign 위쪽 %도 82. 검토 요청 → 그림 2개 남아 막힘 + 사유. (F3)

**S11 · F1 미리보기 · 받기** — Given Excel A 미리보기에 목차 3행(p.1, Deleted), "§1 · 문단 · p.2" 행, "§5 · 그림 · p.3 [Figure] 그림 1. 배양기 계통도" 행. Then 목차 = "▸ 목차 3줄" 1행, 위치 "§1 · p.2"("문단" 없음), 그림 자리 행 없음. When 문단 Excel 받기. Then 창: ☑ 표 · ☑ 삭제 줄 · ☑ 그림 자리 · ☐ 목차. When 기본값으로 받기 → 파일 = 현행 파일에서 목차 행만 빠짐. (F1)

**S12 · F2 이동** — Given ▣4.2.1 KO "시료는 멸균 용기에 담는다." 배정 SOP-QC-0101 §4.2, 같은 Bundle에 SOP-QC-0102 · SOP-QC-0103 · WI-QC-0101-01. When ⇧D(또는 우클릭 "To-Be 문서로 이동"). Then 문서 펼침(3개 + "+ 새 To-Be 문서 추가…"). When SOP-QC-0102. Then 자리 펼침, 맨 위 "§4.2 시료 채취 (같은 칸)". When 선택. Then 배정 SOP-QC-0102 §4.2, 알림 "SOP-QC-0102 §4.2로 옮겼습니다", Ctrl+Z 1회 복구. 변형: 다른 To-Be 문서 1개(SOP-QC-0102) → 항목 "SOP-QC-0102로 이동 ▸" → 자리 목록. 변형: 0개 → 펼침에 "+ 새 To-Be 문서 추가…"만. 변형: 레거시 move_external 박스 → 오른쪽 칸 "다른 문서로 이동 · {번호} (이전 기능)" 읽기 전용. (F2)

**S13 · F2 새 문서** — When "+ 새 To-Be 문서 추가…". Then 창(종류 SOP/WI · 번호 · 제목, WI면 상위 선택 가능 · 비움 허용). When SOP · "SOP-QC-0104" · "시료 보관 관리" → [추가하고 자리 고르기]. Then To-Be에 SOP-QC-0104 생성(To-Be 화면 · Documents에 보임), 자리 목록(§4.2 같은 칸 맨 위) → 선택 시 배정. 변형: 이미 있는 번호 → `rule.duplicate_code` 문구가 창에. (F2-R4 · R5)

**S14 · E1 괄호선** — Given 행 3 KO, ▣4 KO "탱크를 비운다.", 5 · 6 KO, 7 EN, 8 EN "Empty the tank."(4의 짝), 4 · 8 모두 화면 안. Then 4~8을 잇는 왼쪽 괄호선, 4 아래 안내 줄 없음. When 스크롤로 8이 화면 밖. Then 괄호선 없음, 안내 줄 "↓ 짝 EN · 아래 4줄". (E1)

**S15 · E2 표 탭** — Given 본문에 표 2 "배양 조건"(4×2). Then 탭 [본문] [표 3] [그림 2] [머리말], 본문에서 표 2가 펼친 채 머리에 [접기]. When [접기]. Then "▸ 표 2 · 배양 조건 · 4행 2열" 1행. When 새로고침 → 접힘 유지. When [표 3] 탭 → 표만, 각 표 머리에 "§5 아래". When "표 모두 접기" → 본문의 모든 표 접힘. (E2)

**S16 · E3 AI 제안** — Given 안 정한 박스 3(AI · Deleted) · 4(AI · Deleted) · 5(AI · New SOP §2), 이미 정한 박스 · 은퇴 Unit에 걸린 live 제안 11. Then 알약 "수락할 제안 3"(현행 14가 아님). When 3 · 4 합치기. Then 두 제안 stale, 알약 1, 합친 박스 아래 AI 표시 없음. When 5 확정. Then 알약 숨김. When 합치기를 Ctrl+Z → 제안은 되살아나지 않음. (E3)

**S17 · D1 번호** — Given 제목 "5 조작 순서" 아래 표(1 전원을 켠다 · 2 압력이 0.2 MPa가 되면 · 3 밸브를 연다 · 4 10분 동안 순환한다), 다음 제목 "6 기록". When ⇧T(벗김). Then 5.1 · 5.2 · 5.3 · 5.4, Number note "Original 1~4". When 5.2에서 ⇧J ⇧J. Then 5.2 "압력이 0.2 MPa가 되면 밸브를 연다." + 뒤 5.4 → 5.3. When Ctrl+Z → 합치기 전(5.1~5.4). When Ctrl+Z → 원래 번호(1~4, 벗긴 상태). When Ctrl+Z → 다시 표. (D1 정답 표)

**S18 · D2 한글 표 따라 하기** — Given 손본 한글 표 3: 5.1 "장비를 준비한다." · 5.2 "시료 10 mL를 채취한다." · 5.2.1(들여쓰기) "채취 뒤 4 °C에 둔다." · "(빈 칸)" 삭제. 같은 꼴 영어 표 둘: Table 5 = 1 "Take 10 mL of sample." · 2 "Prepare the equipment." · 3 "Keep at 4 °C after." · 4 "(blank)", Table 6 = "Training record" 등(공통 토큰 0). When Table 5에서 ⇧O(또는 ✦). Then Table 5가 짝("10 mL" · "4 °C" 겹침 + 뜻 유사), Table 6은 짝 아님. 행 짝 = 1↔5.2, 2↔5.1, 3↔5.2.1, 4↔빈 칸. 제안 칩: 1 → 순서 2 · 번호 5.2, 2 → 순서 1 · 번호 5.1, 3 → 들여쓰기 · 번호 5.2.1, 4 → 삭제. 머리 "한글 표처럼 하기 · 4건". When [적용]. Then 5.1 Prepare the equipment. / 5.2 Take 10 mL of sample. / 5.2.1 Keep at 4 °C after. / (blank) 삭제, Ctrl+Z 1회에 전부 복구. 꼴이 같아 AI 미호출(규칙), `ai_suggestions` 행 없음. (D2)

## 부록 B. 결정 요약 (사용자 [U], 2026-11-23)

| 항목 | 결정 |
|---|---|
| 순서 | 속도 · 명령 → Enter · 단축키 → 고름 · 우클릭 → 개요 → 미리보기 · 보내기 · 보기 → 표 번호 → 한글 표 |
| A1 | 즉시 다음 박스 + 명령 큐, 실패 시 뒤 정지 + 알림 |
| A2 | 측정 후 큰 것부터. 체감: Del · 확정 후 다음 박스, 번호 칸 입력. 애니메이션 즉시 시작 · 줄일 수 없는 대기엔 추가 |
| B1 | Enter = primary 단추. 미정이면 Suggested 첫 카드로 즉시 확정(AI면 Use와 동일, AI 글 포함). 삭제면 위험 색. AI 순서 미리보기 중 Enter = 적용 |
| B2 | 이동 단독 · 변경은 Shift, G = 짝으로 가기, Tab 들여쓰기, Ctrl+←/→ 탭, 뒤로 가기 = 이전 탭, 목록 단일 소스 |
| J1 | ⇧J ⇧J 아래 · ⇧K ⇧K 위, 두 번, 시간 제한 없음, 다른 언어는 짝 |
| G1 | ⇧G, 일괄: 삭제 · To-Be 문서로 이동 · 배정 취소 · 언어 |
| B3 | 확인 · 취소, 바깥 클릭 = 저장 없이 닫기 |
| C1 | 두 겹(묶음 얇게 · 조각 진하게), 표 칸 클릭 = 칸 고름 · 배정은 표째 |
| C2 | 이 칸 위 · 이 표 아래, 범위 이름, 호버 칠하기, 벗긴 표 행 메뉴에 다시 표로 · AI 순서 |
| F3 | "정함" · 처분별 막대, 남은 손질 · AI 제안 대기 · 그림 따로(모든 진행 숫자에서 제외, 검토는 그림까지), 대시보드 "AI 제안 대기" |
| F1 | "문단 제외" = 옛 문서 목차 → 미리보기에서 접기, "문단" 글자 · 그림 자리 · 삭제 행 제거, 받기 창(표 · 삭제 · 그림 · 목차(기본 끔)) |
| F2 | 다른 Bundle 이동 제거(레거시는 읽기 전용 유지), To-Be 문서로 이동 ⇧D, 문서 → 자리 2단, 없으면 새 To-Be 문서 추가, "Bundle" 문구 미사용 |
| E1 | 고른 짝만, 둘 다 화면 안이면 왼쪽 괄호선, 아니면 안내 줄 |
| E2 | 표 탭, 본문 표는 펼침 + 접기, 문서별 기억 |
| E3 | AI 제안은 안 정한 박스에만, 편집 시 거두고 재실행 안 함, 알약은 안 정한 박스만 · 0이면 숨김, 박스 아래 표시는 현행 |
| D1 | 벗길 때 자동 아래 단계(5.1…), 이미 자식 있으면 이어서(5.4), Ctrl+Z로 원래 번호, Number note 원래 번호, 합치면 같은 목록 어디서나 당김, 따로 문서는 반쪽별 |
| D2 | 짝 표 = 꼴 + 토큰 겹침 + 임베딩, 번갈아는 바로 위 같은 꼴 한글 표, 애매하면 사람이 지정, 행 내용 매칭, 같은 꼴 = 규칙 · 다르면 AI, 제안: 순서 · 삭제 · 합치기 · 들여쓰기 · 번호 |
