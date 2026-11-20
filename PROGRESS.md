# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.4.0(2026-11-20 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-21 — B6-2 짝 맺기 · 풀기와 편집이 푼 판단을 되돌리기 줄에 (`feat/pair-undo`)

- 짝 라우트(만들기 · 확정 · 풀기)에 `undo` 메타 → 판단 단계와 같은 스냅숏 단계(`record_snapshot_step`, op `pair` · `confirm_pair` · `unpair`). 스냅숏 엔진이 이미 짝 · 멤버 · 번역 쓸기 · AI 채택을 찍어 새 되쓰기 코드는 없다. DELETE는 JSON 본문(`PairUndoIn`)을 받는다.
- 편집 단계(`kind="unit_edit"`)도 편집 전후 판단 상태 diff를 같은 칸(`before` · `after`, 스키마 변경 없음)에 찍는다 — 되돌리기는 찍은 쪽이 지금과 같은지 먼저 보고(아니면 편집도 움직이지 않고 409), Split 되돌리기를 부른 뒤 스냅숏처럼 되쓴다(`_move_snapshot`을 `_ensure_unchanged` + `_restore_state`로 나눔). 찍은 판단의 단위는 확인 없이 뗀다(`_write_change(settled=…)`), 편집이 만든 단위의 빈 판단 행은 찍지 않는다(그 뒤 판단한 조각은 지금처럼 `confirm_required`). 다시 하기는 편집이 방금 은퇴시킨 단위의 판단 행을 되써도 된다(`retired`). 응답 `restored_decisions`로 화면이 다시 받을 범위를 고른다(편집만이면 가벼운 다시 받기 그대로).
- 알림의 Undo = Ctrl+Z(내 판단을 하나 더함): 알림 뒤 되돌리기 줄이 움직였으면(`stepTick`) 되돌리지 않고 Ctrl+Z를 알린다 — 줄이 하나라 앞 알림의 단계를 건너뛰어 되돌릴 수 없다. 옛 `canUndoPair`(다시 읽어 확인 후 DELETE)는 걷었다. 확정 알림의 Undo는 이제 짝을 지우지 않고 제안으로 돌린다.
- 스모크가 찾은 것: 판단 상태를 찍은 편집 단계를 되돌릴 때 기록 재생이 짝을 건드리면 안 된다(`keeps_pairs`) — 제목 ↔ 문장 재생의 짝 다시 세우기가 되쓸 짝과 부딪쳤고(409), `_leave_pairs`는 지운 뒤 같은 id로 다시 생긴 짝(SQLite rowid 재사용)의 그대로인 멤버를 지워 되쓰기가 되살리지 못했다. 되쓴 뒤 은퇴한 단위에 남은 단계 밖 짝만 뺀다. 짝 요청이 아무것도 쓰지 않으면(이미 확정인 짝 확정) 단계가 없어 알림에 Undo를 주지 않는다. "한 문장 → 한/영 짝" 전환의 짝 맺기는 B6-3 전까지 기록하지 않는다(Undo 한 번에 합친 문장, 이제 풀린 배정도 함께 돌아옴).

## 2026-11-21 — B6-1 끌어 놓기로 합치기 (`feat/assign-drop-join`)

- B6을 차례로 세 브랜치로 나눴다(diff가 크고 셋 다 혼자 화면에서 확인된다): B6-1 끌어 놓기 합치기(FE) → B6-2 짝 맺기 · 풀기를 Ctrl+Z 줄에 + 편집 단계가 배정 · 짝도 되살림(BE 되돌리기 엔진) → B6-3 언어 바꾸기 → 모양 전환 · 조각 언어 메뉴.
- 놓기 판단은 `resolveBoxDrop`(pair-drop-model) 하나 — 같은 언어는 용지 순서(`paperTabs.order`)에서 바로 옆일 때만 합치기(틈 Join · `merge_prev`와 같은 이웃 기준 · `getMergeBlocker`), 다른 언어는 지금 `resolvePairDrop` 그대로(문서 꼴 제한은 짝에만). 배정된 박스 합치기는 막지 않고 서버 409 → 확인 창(틈 Join과 같다). Pair view 끌기는 짝만 그대로.
- 스모크: 옛 "같은 언어 → 짝 거절" 기대를 새 규칙의 "이웃만 합친다" 까닭으로 바꿨다(결정된 동작 변경, y′ · x′가 이웃이 아님을 먼저 확인), en_only 문서에서 거절 · 합치기 · Ctrl+Z 단계를 더했다.

## 2026-11-21 — B5 박스 안 줄바꿈 없애기 · 첫머리 번호 저절로 (`fix/unit-text-linebreaks`)

- 6-a: 단위 글을 늘 띄어쓰기로 잇고 범위 안 줄바꿈도 띄어쓰기(`segment.build_unit_text`, 한 글자 ↔ 한 글자라 범위 · 번호 · 그림 좌표 그대로). 옛 글은 데이터 리비전 `0035`(사용자 승인 — 운영 기존 행 변경, CHANGELOG 굵게). 확정한 New 문장 글은 사람 글이라 두고, 변경 종류 "그대로"는 `numbering.is_source_text`가 줄바꿈 = 띄어쓰기로 견줘 다시 저장해도 고침이 되지 않게 했다(사람 저장 · AI 제안 사본 둘 다). 용지는 블록 글을 그리므로 단위 조각만 `flattenLineBreaks`. 남는 부작용: 줄바꿈이 있던 줄의 옛 AI 분류 제안은 해시가 달라 일괄 수락에서 건너뛴다.
- 6-b: "본문 타자 번호는 ↤ 전에는 글"을 세 곳에서 거뒀다(`get_number` · `read_draft_number` · 문서 보기 `typed_len` → `from_text`). Shift+Enter 뒤 줄은 추출기를 바꾸지 않고 `read_number_range`가 DOCX일 때 줄바꿈 뒤 줄머리를 같은 정규식(`segment.TYPED_NUMBER_RE`로 옮김)으로 읽는 대체를 골랐다 — 다시 올리지 않아도 그 줄을 편집할 때부터 적용되고(편집하지 않은 옛 줄은 번호 열이 저장값이라 그대로) `EXTRACTOR_VERSION`을 B10 · B12에 남긴다. PDF는 줄바꿈이 접힌 줄이라 읽지 않는다(편집 길 `_load_blocks`가 문서 형식을 함께 읽는다). 첫 범위 전체가 번호이고 뒤 범위가 있으면 번호 칸 칸만이 아니라 어느 출처든 번호.
- 확인한 것: 이미 확정한 New 문장(옛 규칙에서 번호를 품고 복사된 글)은 저장값이라 그대로이고, 다시 저장해도 Old 글 전체와 같아 "그대로"다. 결과물 A 원문 칸은 이제 번호를 뺀 내용이다. Number note는 본문 줄에서 저절로 읽은 번호만 "Read from text"(제목 줄은 전부터 번호라 빼고, 결과물 A 위치 칸은 바꾸지 않음). 전환은 effect 없이 렌더 중 상태 맞추기 훅(`use-number-arrival`) + CSS 키프레임(`data-arrived`).
- 검증: backend 3,130 · ruff, vitest · lint · tsc, Assign 스모크(아래).

## 2026-11-20 — 워크트리 준비 · 시드 DB 검사 (`chore/worktree-setup`)

- 까닭: 워크트리마다 venv · node_modules · 시드 DB · 서버를 손으로 갖추다 거짓 스모크 실패가 되풀이됐다 — B4에서 전체 Assign 스모크 한 번(7분)이 `BACKEND_PYTHON` 누락 실패 5개 · 바뀐 DB 실패 2개로 버려졌고, B1도 바뀐 DB로 거짓 실패했다. 교정 사다리대로 산문 대신: 스모크가 원본 체크아웃 venv를 저절로 찾고(`findBackendPython`, 단계마다 찾지 못하게 `source-rules.test.ts`가 막음), `scripts/dev-worktree.sh`(new · up · reset · seed · down)가 준비와 DB 되돌리기를 하며, 스모크는 시드 지문과 다르면 첫 초에 멈춘다(`DIRTY_DB_OK=1`로 넘김).
- 지문은 묶음 `updated_at`만으로는 안 됐다 — 판단 · 편집은 그것도 `revision`도 바꾸지 않아 마지막 History 사건 id(`/events?limit=1`)를 더했다. `next dev`가 업그레이드 안내를 찍고 한 번 멈출 때가 있어 `up`은 응답 뒤에도 듣고 있는지 보고 한 번 다시 띄운다(Next 업그레이드 자체는 보류 중인 그대로).
- 검증: `new`(버릴 브랜치로 1분 24초, upstream 없음) · `up`(약 10초) · 포트 충돌 메시지, `BACKEND_PYTHON` 없이 xlsx 단계 통과, 두 번째 실행이 종료 코드 2로 멈춤 → `DIRTY_DB_OK=1` 통과 → `reset` 뒤 통과. shellcheck 깨끗.

## 2026-11-20 — B4 삭제 줄 다시 접기 · 우클릭 "삭제 취소" (`feat/deleted-fold-restore`)

- 펼침을 화면 상태(`deletedOpen`, 빼는 곳이 없었다) 대신 고름 하나로(`isDeletedLineOpen`) — 다른 박스를 고르면 저절로 접히고, 접을 단위가 고름으로 바뀌지 않아 먼 덩어리는 다시 그리지 않는다. 줄 ↔ 박스는 `Collapse` 둘로 전환하고, 펼친 뒤에는 `.fold-inner` 잘림을 CSS 키프레임(`fold-release`, `--dur-slow` 뒤 `overflow: visible`)으로 풀어 고른 테두리 · 번호 창이 잘리지 않게 — effect · 타이머 수는 그대로.
- 우클릭: 접힌 줄에 `data-strip-unit`, 닻은 `assign-paper-deleted-u<id>`로 대체, 메뉴가 피할 박스는 렌더 때가 아니라 잴 때 찾는다(`readCover`) — 우클릭이 그 줄을 펼치니 렌더 때는 박스가 아직 없다. 내 판단을 하나 바꿨다: 위 테두리 DELETED 꼬리표는 박스 안 상태 칩 "Deleted"와 겹치고 첫 줄 글을 덮어 빼고 옅은 빨강 바탕만 남겼다.
- 검증: vitest 1,835 · lint · tsc, Assign 스모크 1,019(새 DB, 새 단계 20 — 펼침 · 다시 접힘 · Undo delete 메뉴 · 메뉴가 박스를 덮지 않음).

## 2026-11-20 — B3 표 벗긴 뒤 보던 자리 지키기 (`fix/unwrap-scroll`)

- 까닭: 풀기 전환은 스크롤을 브라우저 스크롤 고정에 맡겨, 고정한 요소가 바뀌는 표 안이면 놓쳤고, 바꿈을 그리는 렌더에서 따라가기가 새 줄(캡션 · 번호 붙인 줄)로 다시 굴렸다. 공용 `useUnwrapMotion`이 바꾸기 전 기준(표 머리 `data-unwrap-scope`가 칸에 보이면 그것, 아니면 칸 윗변에 걸친 `data-flip-key` 줄)을 재 두고, 바꾼 직후 · 끝 자리 재기 전에 `scrollTop`을 되맞춘다(순수 계산 `pickScrollAnchor` · `computeAnchoredScrollTop`). 표 벗기기 · 다시 표로의 따라가기 스크롤은 `afterMotion`으로 전환 뒤에, 박스가 칸 밖일 때만 — effect · 타이머 수는 그대로.
- 기준은 걷기 전에 잰다: 다시 표로의 걷기는 머리 줄을 작게 줄여(enter 표시 scale) 바꾸기 직전에 재면 3px 밀렸다. 스모크 새 단계는 편집 응답을 붙든 동안(처리 중 표시가 그려진 뒤)의 표 머리 높이와 비교해 ±1.5px — 옛 코드는 6~8px 어긋나 실패, 문서 맨 위 표는 scrollTop 0이라 못 올리니 문서에서 가장 아래 표를 쓴다.
- 검증: vitest 1,835 · lint · tsc, 전체 스모크 1,994, 대비 · 겹침 감사 통과. 배치 감사(극단 자료)는 CSS · DOM 구조를 바꾸지 않아 돌리지 않았다.

## 2026-11-20 — B2 Space 미리보기가 누른 박스의 행으로 늘 (`fix/space-preview-follow`)

- 되다 안 되다의 까닭: 같은 박스를 다시 누르면 고른 행이 같아 가운데 맞추기가 돌지 않았고(끌어 둔 시트 그대로), 줄의 첫 단위를 찾아 한/영 따로 문서의 EN 박스가 KO 행으로 갔고, 본문 밖(머리말 · 꼬리말) 단위는 시트에 없어 맨 위 창으로 갔다. 누른 박스를 맨 앞에(`pickSheetAnchor`, 시트에 없으면 문서 차례로 가까운 위 본문 단위), 박스를 누를 때마다 오르는 `spacePickSeq`를 `SheetView`의 가운데 맞추기 effect deps(`centreKey`)에 더했다 — effect 수는 그대로.
- 서버 `limit_window`는 그대로: 프런트가 늘 본문 단위를 `around`로 보내 못 찾는 경우가 없어졌다. 다시 받는 중에 누른 것은 받은 뒤 deps(`selectedUnitId` · `sheet`)가 다시 맞춘다. 스모크 단계는 옛 코드에서 실패하는 것을 확인했다.

## 2026-11-20 — B1 삭제 뒤 고름이 튀지 않게 (`fix/assign-delete-focus`)

- 까닭: 확정 뒤 다음 줄을 처음 불러온 목록 스냅숏에서 찾아, 표 벗기기로 새로 생긴 칸 줄은 목록에 없어 지우면 묶음 맨 처음(다른 문서 · 그림 탭)으로 갔고, 아래가 모두 확정이면 되감아 맨 위로 갔다. All 거르기는 스냅숏 대신 지금 줄 전부를 쓰고(J/K가 벗긴 줄을 건너뛰던 것도 함께), 다음 고름은 줄 이동 차례(문서 차례)에서 같은 문서 · 같은 탭 안 · 되감기 없이(`findNextAfterSave`). 삭제는 바로 아래 박스, 다른 확정은 아래로 첫 미확정. 옮김은 `focusCtl.succeed`로 다시 받은 뒤 — 그 사이 다른 박스를 골랐으면 그대로.
- 내 판단: 삭제 뒤 "바로 아래"는 이미 삭제한 접힌 줄을 건너뛴다(골라 펼치면 연달아 지울 때 걸린다). 거르기가 All이 아니면 그 거르기 목록 안에서 고른다. 스모크에 "벗긴 줄 삭제 → 바로 아래 · 스크롤 그대로" 단계를 더했다.

## 2026-11-20 — Assign 시험 피드백 13가지 명세

- 사용자가 v1.4.0을 실제 SOP로 시험한 피드백 13가지를 시안으로 정한 명세를 `docs/superpowers/plans/2026-11-20-assign-test-feedback-plan.md`에 남겼다 — 브랜치 B1–B13을 차례로, 진행은 그 문서 §4 "상태" 열. B1(삭제 뒤 고름)부터.

## 2026-11-20 — v1.4.0 운영 배포 · 실사용 시작

- 사용자가 v1.4.0을 운영에 올리고 실사용자에게 접속 안내 메일을 보냈다 — 이제 운영 DB에 실제 데이터가 쌓인다. 운영 배포 기록이 v1.1.0 뒤 처음이라 v1.2.0 · v1.3.0 배포 메모(`outline.manage` 부여, `prompt.classify` 새 버전 저장)도 이번 배포의 일이다. CLAUDE.md 상태 줄에 운영 자료를 지우는 리비전은 승인 · 배포 전 백업 확인을 적었다.
- md 오딧(`/sync-all`): 설정 · Docker · README는 맞았다. 기능 맵에 v1.3.3 단축키 · 이동 창, 아카이브로 옮긴 글의 깨진 자기 링크 4곳, CLAUDE.md의 풀린 기능 작업 보류 문장, 끝난 handoff 둘(`2026-11-18-1` · `-2`, 코드 주석 참조는 파일 이름만)을 정리했다. 문단 분리 요청서는 2차(매핑 · 비교 엑셀)가 남아 둔다.
