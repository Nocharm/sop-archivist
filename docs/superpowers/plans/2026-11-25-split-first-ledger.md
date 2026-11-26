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
| 3a | `perf/assign-measure` | 합침 | v1.6.6과 함께 · 1aaa2de0 | pytest+시드 · vitest 1961 · ruff(화면 변경 없음, 스모크 해당 없음) | 결과 문서(T3)는 3b 앞뒤를 잰 뒤 |
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
| 6-2 | `feat/new-paper-2-pick` | 모음 `feat/new-paper`에 합침 | d574eda1(9fcc501d) | dev v1.6.18 합침(충돌 13) · vitest 2475 · build 경고 0 · `assign:` 스모크 1305(시간 단계 하나는 혼자 2번 통과) · Enter · 잇기 단계 95 | fable 검토 두 번: 손질 뒤 Enter가 숨은 확정 · 되돌리기의 문서가 응답 때 정해짐 · Del→잇기→Del · 그 고침이 만든 출처 없음 두 번째 Enter 갈아 끼움 — 모두 고침. 스모크가 찾은 제품 결함: 빈 곳 누르기가 Pair 조각 · 칸 자리 · 템플릿 자리 고름을 지움, 짝 놓기가 New 다듬기에 머묾, 메뉴 위로 단추 줄이 펼쳐짐 — 고침 |
| 6-3 | `feat/new-paper-3-tools` | 모음에 합침 → 모음을 dev에 | v1.6.22 · c8e014c2 | dev v1.6.21 합침 · pytest 3756+시드 15 · vitest 2545 · build 경고 0 · `assign:` 스모크 1400(100ms 단계는 혼자 통과, 그림 캡션 단계는 혼자 두 번에 한 번 통과 — dev 기반 브랜치에서도 흔들림) | opus 검토 막음 1 · 권함 1 고침, 스모크 뒤 제품 고침 셋은 opus 짧은 검토 통과 |
| 3b+ | `fix/undo-follow-after-click` | 합침 | v1.6.16 · f1cbc921 | vitest 2297 · build 경고 0 · `assign:` 스모크 1240 + 손질 뒤 5단계 | — |
| 7a | `feat/assign-two-level-pick` | 합침 | v1.6.23 · 00d81d1e | vitest 2562 · build 경고 0 · `assign:` 스모크 전부 통과(두 번째 전체 실행 ALL PASS, 첫 실행의 필터 단계는 따라 고침) · opus 검토 막음 0 · 권함 1 고침 | 꼬리표가 글 · 보류 칩과 겹치는지(세워 둘 조건 ③)는 그림으로 보지 않음 — 감사 때 |
| 7b | `feat/assign-table-menu` | 합침 | v1.6.25 · 9d3383a0 | dev v1.6.24 합침 · vitest 2633 · build 경고 0 · `assign:` 스모크 1447 + 새 단계 고쳐 혼자 22 통과 · opus 검토 막음 0 · 권함 2 고침 + 아무것도 안 보던 호버 검사 고침 | 새 감사 장면 `assign-cell-menu`(겹침)는 정식 업데이트 때 돌림 |
| 7c | `feat/assign-multi-mark` | 합침 | v1.6.26 · b55ee5c6 | dev v1.6.25 합침 · vitest 2650 · build 경고 0 · `assign:` 스모크 1450 + 새 · 고친 검사 둘 고쳐 혼자 37 통과 · sonnet 검토 막음 1(스모크 1904) · 권함 1 고침 | 대비 감사(체크 · 꼬리표 글자)는 정식 업데이트 때. 번호 칸 폭이 다른 두 줄 사이 틈의 좌우 선이 몇 px 어긋날 수 있음(눈으로 안 봄) |
| 7d | `feat/assign-multi-merge` | 합침 | v1.6.28 · 9a533c3b | dev v1.6.26 · v1.6.27 합침 · pytest 3781+시드 15 · ruff · vitest 2671 · build 경고 0 · `assign:` 스모크 1478(그림 캡션 단계는 혼자 다시 통과) · opus 검토 막음 1 고침 → opus 재검토 통과 | Old 표 여럿에 배정이 있으면 확인창은 공통 글. 함께 벗김의 번호 칸 이음은 "바깥 먼저"와 같다(안쪽 먼저와 드물게 다름) |
| 7e | `feat/assign-multi-pick` | 합침 | v1.6.30 · d857ab92 | dev v1.6.29 합침 · pytest 3796+시드 15 · ruff · vitest 2698 · build 경고 0 · `assign:` 스모크 1496 + 표 탭 단계 1검사(접힌 줄 글을 읽기 전 대기만 더함, 기대 그대로) 혼자 30 통과 · opus 검토 막음 0 · 권함 1 고침 | 일괄 삭제는 보낸 초안을 지우지 않는다(한 줄 U와 일괄 취소는 지움) |
| 7f | `feat/split-by-sentence` | 합침 | v1.6.27 · 7174cf7b | pytest 3763+시드 15 · ruff · vitest 2659 · build 경고 0 · `assign:` 스모크 1461 + 고친 둘 다시 · 메뉴 단계 92(흔들린 1은 혼자 24 통과) · opus 검토 막음 0 · 권함 2 고침 | 키 큰 메뉴가 옆으로 비키면 반대편 판(New) 글을 덮을 수 있음(위 · 아래 모두 모자랄 때만) |
| 7g | `feat/assign-pair-bracket` | 합침 | v1.6.29 · 456f25b3 | dev v1.6.28 합침 · vitest 2689 · build 경고 0 · `assign:` 스모크 1486(프록시 ECONNRESET 1단계는 혼자 34 통과) · sonnet 검토 막음 0 · 권함 2 고침 | perf(스크롤 프레임, 세워 둘 조건 ②)는 재지 않음 — 정식 업데이트 전 perf에서 |
| 8 | 계획 5의 아홉 | 합침 | v1.6.31 | 아홉 모두 dev에 | — |
| 8a | `feat/assign-tables-tab` | 합침 | v1.6.24 · 9d9f177d | dev v1.6.23 합침 · vitest 2593 · build 경고 0 · `assign:` 스모크 1435 + 따라 고친 1검사 혼자 16 통과 · sonnet 검토 막음 0 · 권함 1 고침 · perf(52문서 CPU1 J 22.1→24.1 · Delete 25.1→24.5ms, 스크롤 같음) | 표 탭 J/K는 그 문서의 표만(그림 탭은 모든 Old 문서), 벗긴 표 캡션은 접힌 줄에 안 보임 |
| 8b | `feat/unwrap-continue-numbers` | 합침 | v1.6.31 · c1efc2ad | dev v1.6.29 · v1.6.30 합침 · pytest 3832+시드 15 · ruff · vitest 2715 · build 경고 0 · `assign:` 스모크 ALL PASS 1507 · opus 검토 막음 1 고침 → opus 재검토 통과 | — |


## 이어 가기 (2026-11-26 저녁, 계획 1~5 전부 dev에)

`origin/dev` = **v1.6.31**(`e88cb55b`). 계획의 36 브랜치가 모두 합침 · 건너뜀이다(3e만 조건이 안 되어 건너뜀). 세운 브랜치 · 남은 워크트리 없음(admin-polish는 따로). 지휘 도구 `~/Documents/sop-orchestration/`.

남은 것은 **정식 업데이트(dev→main) — 사용자가 정한다**(main 합치기 · 태그 · GitLab · 배포는 지휘 세션 권한 밖):
1. 감사 넷(layout `DS=worst` · overlap · contrast · manual-shots) — 새 장면 `assign-cell-menu`(7b), 체크 · 꼬리표 대비(7c), 괄호선(7g, 대비는 단위 시험으로 3:1 확인) 포함. 전체 스모크 `FULL=1`.
   - (11-26 저녁, `2ccff578` = v1.6.31) 전체 스모크 `FULL=1`(새 시드): **2522 통과 · 1 실패** — `assign: the New pane shows a real table and figure`의 그림 캡션 검사(`the figure row shows its caption line above it`). reset 뒤 그 단계만 다시 돌려 16/16 통과 → 알려진 흔들림. 제품 결함 후보 없음. 감사 넷은 아직.
2. perf 한 번 더(`perf.sh`, 8a에서 몇 칸이 ±20% 오감 · 7g는 재지 않음).
3. 설명서 그림은 바뀐 장면만(`ONLY=<장면>`), 설명서 머리 `version` · `updated`, CHANGELOG 릴리스 제목, 루트 `CLAUDE.md` 상태 줄 · README, 끝난 계획 · 설계 스냅숏 지우기(`rules/common/git.md` 정식 업데이트).
4. 아래 "아침에 볼 것"을 사용자와 정리 — 특히 8b 합치면 당기기의 범위, 7b 양 단 New 칸 메뉴 없음, 7c 첫 Shift+클릭이 지금 줄도 넣음, 7g 괄호선 동안 빈 줄.

**운영하며 배운 것**
- 하위 에이전트는 셋 안팎. 넷 이상이면 부하 평균이 40~60으로 올라 스모크(100ms · 30s 기준)와 시간 시험이 흔들렸다. 흔들린 것은 혼자 다시 돌려 통과를 보고 합쳤다(장부 줄마다 적음).
- 스모크는 한 번에 하나가 원칙. 급하면 다른 포트(`up 3797`)로 짧은 단계만.
- dev를 브랜치에 합칠 때 긴 표 줄 md 충돌은 `wmerge.py`, 코드 충돌(대부분 `use-assign-page.tsx` · `page.tsx`의 구조 분해 · import 줄)은 양쪽을 다 넣어 풀고 `tsc` · `eslint`로 확인.
- 새 스모크 단계는 거의 늘 처음에 경합으로 실패했다(응답 · 다시 읽기 전에 검사). 제품 결함인지 먼저 요청 로그로 가린다 — 4c의 Esc 단계가 3b 결함(되돌리기 중 클릭이 늦은 따라가기에 덮임)을 실제로 찾았다.
- 하위 에이전트끼리 scratchpad 파일 이름이 겹쳐 남의 스크립트를 돌린 일이 있었다 — 지침에 `<브랜치 이름>/` 하위 폴더 규칙을 넣었다.
- (11-26 저녁) 구현 둘을 나란히 돌리고 먼저 끝난 쪽부터 게이트 → 검토 → 스모크 → 합침, 다른 쪽은 dev를 합친 뒤 다시. 검토가 막음을 찾으면 게이트를 멈추고(어차피 다시 돈다) 고친 뒤 데이터를 건드린 고침만 opus 짧은 재검토. 일부 단계만 돌린 스모크는 앞 단계에 기대는 단계가 실패하니 판정은 전체 실행으로(같은 단계가 dev 기준 워크트리에서도 실패함을 확인했다). 프록시 ECONNRESET 500은 게이트 부하 탓 — 백엔드 로그에 500이 없으면 혼자 다시.

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
- ai-suggestions-retire · `test_sop_ai_adoption.py:1073` `applied` → `stale`, `:1075` · `~1088` 종류 키 → `"classify" not in` · 편집이 거둔 제안은 applied에서 빠짐(계획 `test_adoption_stats_do_not_count_stale`)
- ai-suggestions-retire · `ai-accept-model.test.ts` `countLiveOffer` 셋째 인자, `assign-focus-model.test.ts` · `reload-ask-model.test.ts` 기대 객체에 `suggestions` 필드 · 필드가 늘어남(기대값 그대로)
- table-follow-2 · 없음(새 시험만). table-follow-3 · `test_sop_ai_llm.py:134` 시드 7 → 8, `test_sop_guidelines.py` `REPLY_FIELDS`에 `prompt.table_follow`, `test_sop_table_follow.py` ai 시험에 `lines` 단언 한 줄, `ai-suggestion-model.test.ts`에 `HIDDEN_AI_KINDS.has("table_follow") === false` · 새 지침 키 · 응답 필드가 늘어남
- 6-3 · `test_sop_tables.py:389` 409 응답에 `linked_cells` · `held_rows` · New 표 응답 꼴이 늘어남, `new-paper.test.ts:106` testid 글자 · 새 testid가 옛 글자를 품어서
- 6-2 · `baa5cde3` 한 단을 닫은 근거 `assign-solo` 수 0 → `.assign-panes`에 `data-single` 없음(Old 태그 검사 그대로) · 닫아도 New 고름이 남음(계획 T3), `e4d3a51c` 짝 판을 단추 줄이 다 펼친 뒤에 잼(검사 · 한도 그대로)
- 7a · `paper-model.test.ts:210-219` 묶인 칸 → 표 기대를 칸 → 칸으로, 캡션 → 묶음 사례 더함 · C1-R3
- 7a · `smoke/assign.mjs` 표 칸 단계 이름 · 1083 "칸 글을 누르면 표 전체" → "표 줄 다듬기에 Unwrap table" · 1084 표 조각 data-sel → 칸 data-sel + 표 `data-group="table"`(검사 2 그대로) · C1-R3, 정한 것 5
- 7a · `smoke/assign.mjs:4182 · 4184` `:is([data-sel], [data-mate])` → `+ [data-group="pair"]`, `:741 · :1802` 짝 카드 다른 조각 글도 읽게 selector 더함 · 이웃한 짝의 다른 조각이 data-mate 대신 data-group을 받음
- 8a · `paper-model.test.ts` "adds a Figures tab after the others" 탭 목록에 "tables" · 픽스처 본문에 표가 있어 표 탭이 생김
- 8a · `new-paper.test.ts` `not.toContain('assign-new-tab-')` → `'assign-new-tab-header"'` · 표가 있으면 탭 줄이 늘 섬
- 8a · `smoke/assign.mjs` 그림 단계 "탭 줄 끝이 Figures" → "끝이 Figures, 또는 Figures 다음이 Tables" · 탭 차례 B2
- 8a · `smoke/assign.mjs` 필터 접기 단계 부분마다 셈에서 `assign-tab-tables`를 뺌 · 표 탭은 본문 표를 다시 모은 탭이라 두 번 세지 않게
- 8a · `smoke/assign.mjs:6706` 벗긴 표 머리 "✦ AI order | ↺ Back to table" → "… | Collapse"(검사 1 그대로) · 머리 끝에 접기 단추(E2)
- 7f · `assign-context-menu-model.test.ts:56 · 139 · 165 · 183` 편집 항목 목록에 `split_sentences`가 `split` 뒤에, `:408 · 409 · 418` Shape 줄 단추 목록에 `split_sentences` · 새 항목이 생김(같은 단계 수)
- 7g · `smoke/assign.mjs` counterpart 단계 · "the pair panel never moves the picked box up or down" 단계 · 사이 줄을 `addStyleTag`로 1600px 늘려 짝을 화면 밖으로 민 채 기존 검사(검사 수 그대로, counterpart에 괄호선 검사 +1) · 짝이 둘 다 보이면 안내 줄이 숨음(E1-R2, 정한 것 6) — 뒤 단계는 계획 목록 밖
- 7e · `use-command-queue.test.ts:64` `bulk` 명령에 `action: "delete"` · 필드가 필수가 됨(기대 그대로)
- 7e · `smoke/assign.mjs` 약 731 표 탭 단계 `[new-pair] Collapse folds…` 앞에 `.table-fold-text`에 글이 찰 때까지 대기 두 줄 · 부하에서 접힌 줄이 그려진 첫 프레임에 글이 비어 읽힘(기대값 그대로, 원인 코드는 못 찾음)
- 8b · `test_sop_paragraph_excel.py:358-359 · 388-389` 칸 번호 1 2 3 → 5.1 5.2 5.3, `number-kind-model.test.ts:73` "6" → "5.1" · 명세 D1이 이름을 댄 시험
- 8b · `test_sop_table_follow.py:508 · 516 · 583 · 591` · `test_sop_ai_table_follow.py:205 · 251` "4" → "1.4" 등 · 고정물이 제목 1 아래 표를 벗겨 번호가 이어짐(D1)
- 8b · `decision-step-model.test.ts:86 · 101` 목록에 `continue_numbers`만 더함

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
- AI 알약 수는 신규 전용 match 제안(document_id 없음)을 세지 않는다 — Old 문서가 열려 있지 않으면 0(전에는 신규 전용만 셈). 받을 때는 서버 미리 보기의 수가 먼저 뜬다(ai-suggestions-retire 검토).
- 표 짝 점수 가중치를 0.2·꼴+0.3·토큰+0.5·뜻으로 바꿨다(계획 식으로는 계획 자신의 시험이 성립 안 함). 운영은 임베딩이 꺼져 꼴+토큰만 돈다 — 임베딩을 켤 때 실제 자료로 다시 잰다. 토큰 분모가 작은 쪽 수라 "QA" 하나뿐인 표 둘도 1.0이 된다(table-follow-1 검토).
- `feat/assign-tables-tab`이 들어오면 표 탭에도 `renderFollow`(짝 표 고르기)를 넣는다(지금은 `renderUnwrapHead` 안).
- 고른 Old 박스 안에서 단추 줄이 240ms 동안 펼쳐지며 그 아래 짝 안내 단추가 줄 높이만큼 내려간다 — 고르자마자 안내를 누르면 빗나갈 수 있다(6-2 검토). 거슬리면 안내를 단추 줄 위로.
- 100ms 시간 단계(`deletion folds and unwrap start before the response`)가 다른 게이트와 겹치면 102~117ms로 실패한다(세 브랜치 모두, 혼자면 통과).
- 표 따라 하기: 임베딩이 꺼진 운영에서는 토큰이 없는 행이 하나만 있어도 AI 길로 간다(정한 것 7). `follow_table`로 합친 줄은 조각 표시 · 합치기 풀기가 없고 Ctrl+Z로만 돌아온다. AI가 "바꿀 것 없음"이라 답한 뒤 닫기는 채택으로 세지 않는다.
- 임베딩을 켜면 화면 GET(임베딩 씀)과 AI 요청 판정(임베딩 안 씀)이 갈려 422 `follow_not_needed`가 날 수 있다 — 켤 때 함께 본다.
- 가짜 AI 서버는 **고친 브랜치의 워크트리에서** 띄운다(dev 체크아웃 것은 새 응답이 없어 `invalid`가 된다). AI 단계는 `AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_API_TOKEN=fake AI_MODEL=fake AI_AUTO_PREPARE=false scripts/dev-worktree.sh reset`으로 backend를 켠 뒤 그 단계만.
- 스모크 `has:`에는 pane에 뿌리를 둔 locator가 아니라 `page.locator(testid)`를 넘긴다(바깥에 대고 다시 찾는다).
- New를 오른쪽에 연 채로도(Old 다듬기 중) Old 표의 '한글 표처럼 하기'가 켜져 있다 — dev는 이때 껐지만 6-3이 그때도 Old 표 도구를 켜 두게 해 맞췄다. 끄려면 `page.tsx`의 `follow:` 한 줄.
- New 표 풀기 전환(움직임)은 없다(New 보기를 `docViews`로 받지 않음). 스모크 그림 캡션 단계(`the New pane shows a real table and figure`)가 가끔 흔들린다.
- 7a: 계획의 `:721` 짝 1px · 꼬리표 검사는 그 문서에 짝이 없어 새 S8 단계로 옮겼다. 짝 카드 2px 규칙은 scope 없는 위치 판에서만 남는다. `paper.tsx` `selectedBlock`은 아직 `selectedId`로 재서 칸을 골라도 표 위아래 틈이 벌어지지 않는다(표는 합치기 대상이 아니라 해는 없어 보임).
- 8a: 성능 6회 가운데 값이 몇 칸에서 ±20% 넘게 오갔다(작은 문서 CPU4 J 42.8→52.8, 52문서 CPU4 filter Delete 44.7→54.6, 대신 작은 문서 CPU1 filter Delete 23→6.4) — 방향이 섞여 잡음으로 봤다. 정식 업데이트 전 perf를 한 번 더 잰다.
- 7b: 양 단 보기의 New 표 칸 · 제목은 우클릭 메뉴가 없다(전부터 문장 박스에만) — 새 단계는 한 단으로 연 New(`?edit=`)에서 칸 메뉴를 본다. 양 단 New 칸에도 메뉴를 열지 정한다. 접힌 표 줄은 우클릭 메뉴가 없다(펼친 뒤). 마우스가 항목을 떠나면 포커스는 첫 항목에 남는데 칠은 사라진다.
- 7c: 첫 Shift+클릭은 지금 고른 줄도 여럿 고름에 넣는다(전부터) — 떨어진 두 줄을 Shift로 고르면 꼬리표가 셋 뜬다. 필터로 접힌 목록에서는 사이에 접힌 줄이 끼어도 덩어리가 이어 보일 수 있다.
- 7f: 계획의 캡션 거절 시험은 표로 봤다(같은 `invalid_unit_kind` 길). 마침표 없는 줄을 합친 박스가 범위 경계에서 나뉘는지는 시험으로 따로 증명하지 않았다.
- 7d: 위쪽 바로 여럿 합치기 · 표 여럿 벗기기를 한다(⇧G 일괄 단추는 7e). Split 기록 되돌리기(`/edits/undo`)로는 쓸어 낸 AI 번역이 돌아오지 않는다 — Assign 되돌리기(Ctrl+Z)로는 돌아온다(사람 짝 맺기와 같은 수준).
- 7g: 괄호선이 보이는 동안 고른 박스 아래에 안내 줄 높이의 빈 줄이 남고, 안내 줄은 고른 뒤 한 프레임 늦게 선다(밀림을 막은 대가). 좁은 창에서 Old 괄호선이 왼쪽 스크롤바 가까이 붙을 수 있다(눈으로 안 봄).
- 7e: 같은 표의 캡션 둘을 골라 →KO를 누르면 서버가 422(`_ensure_one_caption_per_language`)로 거절해 알림만 난다. 한 단으로 연 New 문서에서 ⇧G는 "줄 없음" 알림.
- 8b: **합치면 당기기는 그 목록 끝까지 이어 센다** — 사람이 고친 뒤 번호나 원문의 빈 번호도 덮고(5.1 · 5.2 · 5.4 · 5.7에서 5.2+5.3 → 5.3 · 5.4), 제목 둘을 합치면 문서 끝까지 장 · 하위 번호가 당겨진다(7 → 6, 8.1.1 → 7.1.1). D1-R6 글자대로지만 운영 자료에서는 큰 변화 — 써 보고 정한다. 한 표 안에서 1 2 1 2로 다시 시작하면 5.1–5.4로 평평해진다. 표를 새 편집으로 다시 표로 돌려도 이은 번호 기록은 남는다. 합치기로 당겨진 칸은 문단 Excel 노트가 "Source 4 → 5.3".
