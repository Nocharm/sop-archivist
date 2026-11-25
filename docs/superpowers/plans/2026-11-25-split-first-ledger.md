# 쪼개기 먼저 — 장부

지휘 세션이 브랜치를 시작 · 끝낼 때마다 고친다. 압축되거나 새 세션이면 이 파일과 `git log --oneline origin/dev`부터 읽는다. 하는 법은 [`2026-11-25-split-first.md`](2026-11-25-split-first.md).

상태: 대기 · 진행 · 합침 · 세움(사람을 기다림) · 건너뜀(조건이 안 됨)

| # | 브랜치 | 상태 | 버전 · 커밋 | 게이트(pytest · vitest · build · 스모크) | 남은 것 · 물음 |
|---|---|---|---|---|---|
| 0 | `fix/new-edit-undo` | 합침 | v1.6.1 · f363167e | pytest 3244 + 시드 13 통과 · ruff · 스모크 1단계(화면 변경 없음) | 결과물 C의 칸 안 문장 순서는 id 순 그대로(계획 밖) |
| 1a | `feat/hide-drafting` | 합침 | v1.6.4 · 56c50032 | pytest 3260+시드 13 · vitest 1961 · build 경고 0 · 스모크 전체 2121 통과 · 운영 빌드에서 `sopa.drafting=1` 듣지 않음 확인 | 칸 번역을 정하면 표 묶음의 확정자 · 시각을 다시 쓴다(서버 닫힘 규칙) |
| 1b | `fix/remove-bundle-move` | 합침 | v1.6.5 · edd65a9b | vitest 1964 · build 경고 0 · `assign:` 스모크 1117(낡은 시드로 난 1은 새 시드로 통과) | 이미 "보류 + 이동"인 줄은 확정할 수 없고 배정 취소로만 나간다 |
| 2a | `fix/pair-spot-scroll` | 합침 | v1.6.0 · 7a863a50 | vitest 1927 · build 경고 0 · 스모크 3단계 통과(pytest 해당 없음) | 스모크는 단추 자리가 바뀐 감사(겹침)를 정식 업데이트 전에 |
| 2b | `feat/inspector-float` | 합침 | v1.6.2 · aec15ead | vitest 1934 · build 경고 0 · `assign:` 스모크 전체 1117 통과 · 겹침 감사 장면 1120/1280/1440 | 판을 맨 위로 끌면 상단 바를 덮음(다시 끌어 내릴 수 있음), 접어도 칸 끝 빈 칸은 남음 — 거슬리면 고침 |
| 3a | `perf/assign-measure` | 합침 | (번호는 다음 푸시에 함께) 1aaa2de0 | pytest+시드 · vitest 1961 · ruff(화면 변경 없음, 스모크 해당 없음) | 결과 문서(T3)는 3b 앞뒤를 잰 뒤 |
| 3b | `fix/assign-command-queue` | 합침 | v1.6.8 · 278c271d | vitest 2071 · build 경고 0 · `assign:` 스모크 1144(새 단계의 경합 하나는 응답을 기다리게 고쳐 통과) | 배정 취소 응답에 새 revision이 없어 취소 직후 같은 박스에 이어 누르면 그 단위만 받은 값을 씀 |
| 3c | `fix/assign-instant-motion` | 합침 | v1.6.9 · a4e02416 | vitest 2092 · build 경고 0 · `assign:` 스모크 전체 1164 통과 | 응답 뒤 처리에서 던지면 걷은 표 선이 잠깐 거꾸로 돌아 보일 수 있음(자료는 맞음) |
| 3d | `perf/assign-filter-chunks` | 합침 | v1.6.10 · 9fe9f04b | vitest 2138 · build 경고 0 · `assign:` 스모크 1163 + 흔들린 1단계는 혼자 4번 통과 | 1,050박스로는 재지 않음(289박스) |
| 3e | `perf/assign-number-input` | 건너뜀 |  | 번호 칸 5글자 CPU 4배 가운데 값 25ms(기준 100ms) | 조건(100ms 초과)이 안 됨 — 브랜치를 만들지 않음 |
| 4a | `fix/assign-enter` | 합침 | v1.6.12 · 53442350 | vitest 2203 · build 경고 0 · 스모크 전체 2208 + 새 단계 경합 하나 고쳐 3번 통과 | 보류 줄에서 ↵ 한 번이 첫 카드로 확정(B1-R2 글자대로) |
| 4b | `feat/assign-keymap` | 합침 | v1.6.13 · 2f4c6f21 | vitest 2281 · build 경고 0 · `assign:` 스모크 1226 통과(고침 뒤 6단계 다시) | 맥에서 Ctrl+←→는 공간 전환과 겹칠 수 있음 |
| 4c | `feat/assign-merge-keys` | 합침 | v1.6.17 · 19d3ffe7 | vitest 2312 · build 경고 0 · 스모크 `assign: merge keys` 26 ×2 · keys · join · drag merge | 짝 카드의 "아래"는 문서 순서 이웃(화면 바로 아래와 다를 수 있음) |
| 4d | `feat/number-cell-buttons` | 합침 | v1.6.7 · 3670d20c | vitest 1969 · build 경고 0 · `assign:` 스모크 전체 통과(5c와 합친 트리) | IME 조합 중 Enter는 전과 같음(범위 밖), 번호 칸 단계 둘은 앞 단계에 기대어 혼자 돌리면 실패(dev에서도 같음) |
| 5a | `feat/split-rule-2` | 합침 | v1.6.3 · 42e4751b | pytest 3404+시드 통과 · 10 xfail(R3 · R4 몫) · vitest 1934 · build 경고 0 · 스모크 전체 2111 통과 | PDF의 콜론 뒤 줄표 목록은 나누지 않는다(사람이 나눔) |
| 5b | `feat/split-front-matter` | 합침 | v1.6.11 · ff0a6718 | pytest 3622+시드 15 · vitest 2167 · build 경고 0 · 스모크 전체 2181(새 단계의 두 번 누름 하나는 단계를 고쳐 통과) | 아래 "아침에 볼 것" |
| 5c | `feat/split-new-parity` | 합침 | v1.6.6 · d750564c | pytest 3453+시드 14(6 xfail = R3 몫) · vitest 1969 · build 경고 0 · `assign:` 스모크 전체 통과(4d와 합친 트리) | Old 한/영 짝이 New 두 문장에 이어져 하나만 풀린 뒤 다시 하기는 409(있던 것) |
| 6-1 | `feat/new-paper-1-render` | 모음 `feat/new-paper`에 합침 | 7dcf645f | vitest 2361 · build 경고 0 · `assign:` 스모크 1233 + 부하에서 흔들린 둘은 혼자 통과 | New 문장은 글쇠만으로 고를 길이 없음(계획 글자대로, 6-2에서 다시) |
| 6-2 | `feat/new-paper-2-pick` | 진행(11-26) | | | |
| 6-3 | `feat/new-paper-3-tools` | 대기 | | | |
| 3b+ | `fix/undo-follow-after-click` | 합침 | v1.6.16 · f1cbc921 | vitest 2297 · build 경고 0 · `assign:` 스모크 1240 + 손질 뒤 5단계 | — |
| 7 | 계획 4의 일곱 | 대기 | | | |
| 8 | 계획 5의 아홉 | 진행 | … · 6d1792ad | space-preview-trim v1.6.14 · excel-a-strike v1.6.15 · progress-by-disposition v1.6.18 합침 | 남은 여섯: tables-tab · unwrap-continue-numbers · table-follow 1~3 · ai-suggestions-retire |

## 따라 바뀐 시험 (브랜치 · 파일:줄 · 전 → 뒤 · 까닭)

- 2a · `frontend/scripts/smoke/assign.mjs` counterpart 단계의 창 폭 목록 · `[1248, 1680]` → `[1248, 1680, 1920]` · 1680에서는 판이 덮는 모양이 되어 비켜서는 모양을 1920에서 본다
- 2a · 같은 단계 `isAside` · `pane >= 1000` → `pane - 용지 폭 - 12 >= 420` · 판 모양의 기준이 용지 옆 남는 자리로 바뀜
- 2a · 같은 단계 스크린샷 조건 · `width !== 기본` → `width === 1680` · 창이 셋이 되어 같은 파일을 덮지 않게(그림은 그대로 1680)
- 2b · `frontend/src/lib/assign-view-prefs.test.ts` 네 곳의 객체 전체 비교 · 같은 값 → 같은 값 + `...SIDE_DEFAULTS` · 새 설정 네 필드가 생김(단계 수 그대로)
- 5a · `backend/tests/` outputs · editing · decisions · numbering · excel · units · lang_shape · ai_split · match · pairs · target_position · ai_match_plan · decision_undo · paragraph_excel · `pytestmark`에 `legacy_split_rule`만 더함(입력 · 기대 그대로) · 규칙 1 길을 지키는 시험(계획 5a T7)
- 5a · `test_sop_units.py` `test_upload_creates_units_with_full_coverage` · `test_docx_line_breaks_…`, `test_sop_heading_sentence.py` 둘 · 규칙 1 → 규칙 1 · 2 둘 다 · 새 규칙의 기대를 더함(계획 5a T7)
- 5a · `test_measure_extraction.py:17-` · `units_by_kind` 한 규칙(최대 5) → 두 규칙({1:5, 2:4}) · 도구가 규칙을 고르게 됨(계획 5a T7)
- 5a · `test_seed_sop_demo.py` `EXPECTED_BUNDLES` 9 → 10 · 시연 묶음 하나를 더함
- 1a · `test_sop_excel.py:246` · `test_sop_e2e.py:219` · 시트 5 → 4 · C 시트 숨김(§14)
- 1a · `test_sop_excel.py:519 · 588 · 594` · `SHEET_NAMES` → `get_sheet_names()` · 같은 까닭(§14), `545` `filter_columns`에서 C 키를 뺌(목록 밖, 같은 까닭)
- 1a · 숨긴 AI를 쓰는 backend 시험 · 고정물 `hidden_ai_on` · `c_sheet_on`만 더함(기대값 그대로)
- 1a · `smoke/outputs.mjs` "A, B, C and the Excel preview" · 시트 5 → 4, `pw-overlap-audit.mjs` export-preview 5 → 4(§14)
- 1a · `smoke/assign.mjs` `PREPARE_STEP` · "first entry classifies…" → "does not classify the remaining rows"(검사 수 같음, §14) — ai_suggested 칩은 "수가 잇기 제안에서만"으로 봄
- 1a · `smoke/*.mjs` 숨긴 기능을 쓰는 단계에 `drafting: true`만, documents 1566 · 2012와 assign 1525는 숨긴 채 도는 앞부분과 켠 새 단계로 나눔(검사 수 +1)
- 1a · layout · contrast · overlap 감사와 manual-shots의 숨긴 화면 장면에 `drafting: true`(실행은 정식 업데이트 전에)
- 1b · `assign-context-menu-model.test.ts:55 · 73` · `["clear","move","delete"]` → `["clear","delete"]`, `["clear","move"]` → `["clear"]` · 이동 항목이 없어짐(정한 것 4)
- 1b · `smoke/assign.mjs:665` 이동 단계(검사 3) → "a row moved earlier is read-only and Unassign frees it"(검사 5) · 동작이 바뀜(정한 것 4)
- 1b · `source-rules.test.ts:199` 안내 글의 "(or Combobox)"만 뺌(규칙 그대로)
- 5c · `frontend/src/lib/assign-focus-model.test.ts` `new_edit` 원인에 `isReleased: false` · 타입이 바뀜(기대값 그대로)
- 3b · `frontend/src/lib/assign-focus-model.test.ts` `canStart` 시험 둘 → 판단 저장 중 잠그지 않음 · 둘 다 잡으면 잠김 · `dropFollows` · 큐 규칙(§14 승인)
- 3c · `smoke/assign.mjs` "keys pressed during a slow save"의 marks · halted · `assign-paper-piece-<id>`의 `data-pending` → `assign-paper-deleted-u<id>`의 `data-pending` · 지운 박스가 누른 순간 접힘
- 3c · `components/ui/motion.test.ts` · `motion.run(change, opt)` 6곳 → `begin(opt).commit(change)`(기대값 그대로), `lib/deleted-fold-model.test.ts` `OPTIONS`에 `pendingDeletes` · 필수 인자가 생김
- 5b · `test_sop_ai_translate.py:1827` · `legacy_split_rule` 한 줄 · 1장 앞 문장이 앞부분으로 잠김(명세대로)
- 5b · `test_sop_outputs.py:1244 · 1261` · 요약 열쇠 12 → 14(`front_deleted` · `history_deleted`) · 필드가 늘어남
- 5b · `test_sop_split_golden.py` · 범위 G1~G21 → G1~G28, PENDING 비움 · `test_migrations.py` `_UNIT_NUMBER_COLUMNS`에 `noise_reason` · `test_seed_sop_demo.py` 문단 박스 묶음 문서 1 → 2 · 시드에 문서를 더함
- 5b · `command-queue.test.ts` · "toc"를 장벽 → 장벽 아님 · 계획 5b T7이 3b의 목록을 바꿈
- 5b · `assign-press-model.test.ts` 쌓는 글쇠에 "r", `toc-block-model.test.ts` 바뀐 이름 · 꼴에 맞춤
- 5b · `smoke/assign.mjs` 목차 두 단계 · testid `assign-paper-toc-*` → `assign-paper-noise-*`, `assign-toc-*` → `assign-noise-*`, 단계 이름 둘 · 검사 25 → 25
- 4a · `smoke/assign.mjs` 434 · 2108 · 7084 · 7146 · 포커스 = Confirm → `data-state="confirm"` + 포커스가 Old 용지 · S1(마우스 뒤 포커스)
- 4a · `smoke/assign.mjs` 3180 묶음 단추 Enter → Space, 753/758 언어 단추 click → 글쇠 + 마우스 두 번 더(검사 +2), 4544 `isDisabled()` → `data-state` choose/blocked(고름이 풀렸다는 같은 뜻) · Enter의 뜻이 바뀜
- 4b · `smoke/assign.mjs:542 · 685` `h` → `Shift+H`, `3238 · 9257` `a` → `Shift+A` · 글쇠가 바뀜
- 4b · `assign-press-model.test.ts` 글자 → id(같은 검사), `noise-keys.test.ts` · `classify-model.test.ts` `getRowStep` 3개 → `assign-keymap.test.ts`로 옮김 · 함수가 없어짐
- 4b · `paper-chunks.test.ts` 시간 제한 5초 → 30초(단언 그대로) · 부하에서 시간 초과
- space-preview-trim · `test_sop_paragraph_excel.py` 호출 8곳 시그니처 · `test_contents_lines_in_the_paragraph_excel_are_unchanged` → `…are_left_out_unless_the_check_is_on`(기본에서 목차 줄이 빠짐, `toc=true`는 전과 같음) · F1
- space-preview-trim · `test_remark_column_…_the_preview_matches_the_file` 파일 행에서 [Figure] 행을 뺀 것과 견줌 · `test_assign_preview_lists_only_…` 위치 칸만 비우고 견줌 · 미리보기가 그림 · Paragraph 글자를 뺌
- space-preview-trim · `smoke/assign.mjs` 대시보드 · 한 단 문단 시트 단계가 받기 창을 거침(단계 수 같음), 푸터 글 · 창이 생김
- progress · `test_sop_outputs.py:343 · 812 · 880 · 1270` `total` → `total + figures_total`, `1271` `confirmed` → `+ figures_decided`, `1250` `PROGRESS` 값, `test_sop_e2e.py:198`, `test_sop_front_matter.py:379` 6 → (5, 1), `test_sop_progress.py` 여러 곳 · 그림이 진행 total에서 빠짐(F3)
- progress · `doc-dashboard-model.test.ts` `status` → `parts` 등, `progress-model.test.ts` 26% · 45 → 82% · 91(S10) · 처분별 셈
- progress · `smoke/assign.mjs:647` 상태 합 → 처분 합(검사 수 같음), `common.mjs:273` 이름만 · F3
- progress · `test_sop_front_matter.py:1158` 벽시계 비율 → 읽은 줄 수(네 배에 8배 미만, 기준 그대로) · 부하에서 흔들림

## 아침에 볼 것 (사람이 정할 것 · 봐 줄 것)

- 짧은 영어 예외: 한 줄의 `탱크를 비운다. Drain it.`은 한 박스가 된다(계획 2 "정한 것" 2).
- 운영에 이미 생긴 New 문장 중복을 세는 질의(읽기 전용)와 정리 여부.
- 벗긴 표 번호 이어 매기기를 New에서는 저절로 하지 않는 것(설계 11-1).
- 벗긴 표 번호: 제목 5 · 본문 5.1 · 5.2 다음 표는 5.3으로 읽었다(5.2.1이 맞으면 한 줄 바꿈). 표 뒤에 이미 5.1이 있으면 번호가 겹칠 수 있다.
- 합친 글 가운데에 뒤 줄의 번호 글자가 남는다(S17과 다름, 원문 글자를 지울 수 없어서).
- 표 따라 하기는 임베딩이 꺼진 운영에서 공통 글자가 없는 행을 규칙으로 맞추지 못한다.
- 결과물 C · Excel의 표 칸 안 문장은 아직 새 문장 id 순이다(Assign New 칸만 Unit 순으로 바뀜, 0번 검토) — 맞출지 정한다.
- 운영에 이미 중복이 있으면 정리 전까지: 칸 중복은 되돌리기를 오가도 남고 표 밖 줄로 보일 수 있다. 중복 행에 남의 이음이 있으면 다시 하기가 409(0번).
- 규칙 2에서 한글만 문서에 영어 문장이 하나 섞이면 배치 판정이 `ko_only` → `ko_en_separate`가 되어 짝 없는 줄이 "한 언어뿐" 수에 잡힌다(5a 검토, R2-7의 뜻 안).
- PDF 문서 번호 · 줄표 줄머리는 앞 줄이 문장 끝일 때만 나누게 했다(계획은 늘 나눔) — 실제 PDF에서 확인.
- 숨긴 칸에 배정된 줄에서 H(보류)를 누르거나 시스템 보류가 되면 다시 확정할 수 없다 — 배정 취소나 잇기로 나간다(설명서에 적음, 1a).
- 이동한 줄(옛 기능)은 글자 그대로 읽기 전용으로 했다 — 보류 · 잇기 · 삭제로 바로 덮지 못하고 배정 취소부터 해야 한다. 운영의 "보류 + 이동" 줄은 배정 취소해야 검토 조건을 채운다(1b). 바로 덮게 하고 싶으면 말해 주세요.
- **보류(H) · 배정 취소(U) · 일괄 뒤에는 고름이 그 자리에 머문다**(지금과 같음). A1-R2 글자대로 다음 박스로 옮길지 정한다(3b).
- **앞부분 · 개정 이력 판정이 명세보다 좁다(5b)** — 거짓 삭제를 막으려 헷갈리면 제외하지 않는다. 놓치는 꼴: 이력 표가 없는 이력, 제목 스타일 표지, 안내 문장 셋 이상 표지, 장이 하나뿐인 문서 등(사람이 여기부터 본문 · 직접 삭제). 값(글 60 · 120자 등)은 합성 자료로 잡았다 — 실제 문서로 다시 정한다.
- **New는 4-3(`new-paper-3-tools`) 전까지 거짓 제외를 되돌릴 화면이 없다**(블록 · 우클릭은 Old만) — 6-3이 들어가기 전에는 이 묶음을 운영에 올리지 않는 것을 권한다(5b 검토).
- 삭제 취소(`clear_noise`)를 장벽으로 되돌릴지 — 지금은 응답 전에 누른 글쇠를 알림만 띄우고 버린다(계획 T7 글자대로).
- 보류한 줄에서 ↵ 한 번이면 추천 첫 카드로 확정된다(H → 사유 창 → ↵ 하면 보류가 풀림) — 보류 줄은 카드 확정에서 뺄지 정한다(4a).
- 빠르게 두 번 누른 ↵는 다음 줄의 첫 카드를 확정한다(명세가 정한 결과). 써 보고 불편하면 말해 주세요.

## 사용자 답 (2026-11-26 아침)

- 6-3이 들어가기 전에는 운영에 올리지 않는다 · 5b 판정을 좁힌 것 그대로 · H · U · 일괄 뒤에는 지금처럼 머문다 — 모두 제안대로.
- 보류 줄의 ↵: 바꾸자고 제안한 것이 아니라 물은 것이라 지금 동작(첫 카드로 확정) 그대로 둔다. 바꿀 때는 따로 답을 받는다.
- 성능에 문제가 없으면 하위 에이전트를 둘보다 더 늘려도 된다(스모크는 여전히 한 번에 하나).
- 맥 시스템 글쇠: Ctrl+←→(탭 넘기기)가 macOS 공간 전환과 겹칠 수 있다(4b, 사내 PC는 Windows라 무관).
- 6-2의 "승인받을 목록"(계획 3의 179줄: 감사 세 스크립트의 메뉴 장면, New 누름 = 고름, 칸 누르기, `data-state` → `data-sel`)은 처음 허락의 "동작이 바뀌어 따라 바뀌는 같은 성격"으로 보고 진행했다(같은 수의 단계 · 검사).
