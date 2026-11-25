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
| 3a | `perf/assign-measure` | 진행(11-26) | | | |
| 3b | `fix/assign-command-queue` | 진행(11-26) | | | |
| 3c | `fix/assign-instant-motion` | 대기 | | | |
| 3d | `perf/assign-filter-chunks` | 대기 | | | |
| 3e | `perf/assign-number-input` | 대기(재서 정함) | | | |
| 4a | `fix/assign-enter` | 대기 | | | |
| 4b | `feat/assign-keymap` | 대기 | | | |
| 4c | `feat/assign-merge-keys` | 대기 | | | |
| 4d | `feat/number-cell-buttons` | 진행(11-26) | | | |
| 5a | `feat/split-rule-2` | 합침 | v1.6.3 · 42e4751b | pytest 3404+시드 통과 · 10 xfail(R3 · R4 몫) · vitest 1934 · build 경고 0 · 스모크 전체 2111 통과 | PDF의 콜론 뒤 줄표 목록은 나누지 않는다(사람이 나눔) |
| 5b | `feat/split-front-matter` | 대기 | | | |
| 5c | `feat/split-new-parity` | 진행(11-26) | | | |
| 6-1 | `feat/new-paper-1-render` | 대기 | | | |
| 6-2 | `feat/new-paper-2-pick` | 대기 | | | |
| 6-3 | `feat/new-paper-3-tools` | 대기 | | | |
| 7 | 계획 4의 일곱 | 대기 | | | |
| 8 | 계획 5의 아홉 | 대기 | | | |

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
