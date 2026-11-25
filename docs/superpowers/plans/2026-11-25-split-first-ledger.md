# 쪼개기 먼저 — 장부

지휘 세션이 브랜치를 시작 · 끝낼 때마다 고친다. 압축되거나 새 세션이면 이 파일과 `git log --oneline origin/dev`부터 읽는다. 하는 법은 [`2026-11-25-split-first.md`](2026-11-25-split-first.md).

상태: 대기 · 진행 · 합침 · 세움(사람을 기다림) · 건너뜀(조건이 안 됨)

| # | 브랜치 | 상태 | 버전 · 커밋 | 게이트(pytest · vitest · build · 스모크) | 남은 것 · 물음 |
|---|---|---|---|---|---|
| 0 | `fix/new-edit-undo` | 진행(11-26) | | | |
| 1a | `feat/hide-drafting` | 대기 | | | |
| 1b | `fix/remove-bundle-move` | 대기 | | | |
| 2a | `fix/pair-spot-scroll` | 합침 | v1.6.0 · 7a863a50 | vitest 1927 · build 경고 0 · 스모크 3단계 통과(pytest 해당 없음) | 스모크는 단추 자리가 바뀐 감사(겹침)를 정식 업데이트 전에 |
| 2b | `feat/inspector-float` | 대기 | | | |
| 3a | `perf/assign-measure` | 대기 | | | |
| 3b | `fix/assign-command-queue` | 대기 | | | |
| 3c | `fix/assign-instant-motion` | 대기 | | | |
| 3d | `perf/assign-filter-chunks` | 대기 | | | |
| 3e | `perf/assign-number-input` | 대기(재서 정함) | | | |
| 4a | `fix/assign-enter` | 대기 | | | |
| 4b | `feat/assign-keymap` | 대기 | | | |
| 4c | `feat/assign-merge-keys` | 대기 | | | |
| 4d | `feat/number-cell-buttons` | 대기 | | | |
| 5a | `feat/split-rule-2` | 대기 | | | |
| 5b | `feat/split-front-matter` | 대기 | | | |
| 5c | `feat/split-new-parity` | 대기 | | | |
| 6-1 | `feat/new-paper-1-render` | 대기 | | | |
| 6-2 | `feat/new-paper-2-pick` | 대기 | | | |
| 6-3 | `feat/new-paper-3-tools` | 대기 | | | |
| 7 | 계획 4의 일곱 | 대기 | | | |
| 8 | 계획 5의 아홉 | 대기 | | | |

## 따라 바뀐 시험 (브랜치 · 파일:줄 · 전 → 뒤 · 까닭)

- 2a · `frontend/scripts/smoke/assign.mjs` counterpart 단계의 창 폭 목록 · `[1248, 1680]` → `[1248, 1680, 1920]` · 1680에서는 판이 덮는 모양이 되어 비켜서는 모양을 1920에서 본다
- 2a · 같은 단계 `isAside` · `pane >= 1000` → `pane - 용지 폭 - 12 >= 420` · 판 모양의 기준이 용지 옆 남는 자리로 바뀜
- 2a · 같은 단계 스크린샷 조건 · `width !== 기본` → `width === 1680` · 창이 셋이 되어 같은 파일을 덮지 않게(그림은 그대로 1680)

## 아침에 볼 것 (사람이 정할 것 · 봐 줄 것)

- 짧은 영어 예외: 한 줄의 `탱크를 비운다. Drain it.`은 한 박스가 된다(계획 2 "정한 것" 2).
- 운영에 이미 생긴 New 문장 중복을 세는 질의(읽기 전용)와 정리 여부.
- 벗긴 표 번호 이어 매기기를 New에서는 저절로 하지 않는 것(설계 11-1).
- 벗긴 표 번호: 제목 5 · 본문 5.1 · 5.2 다음 표는 5.3으로 읽었다(5.2.1이 맞으면 한 줄 바꿈). 표 뒤에 이미 5.1이 있으면 번호가 겹칠 수 있다.
- 합친 글 가운데에 뒤 줄의 번호 글자가 남는다(S17과 다름, 원문 글자를 지울 수 없어서).
- 표 따라 하기는 임베딩이 꺼진 운영에서 공통 글자가 없는 행을 규칙으로 맞추지 못한다.
