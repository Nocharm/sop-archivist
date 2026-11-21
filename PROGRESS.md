# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.4.0(2026-11-20 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-21 — B11 벗긴 표 AI 순서 제안 (`feat/ai-unwrap-order`)

- 새 AI 작업 `unwrap_order`(`ai/unwrap_order_job.py`, 경로 `POST /ai/unwrap_order {document_id, table_id}`): 표 하나 = 작업 하나, 표 id는 작업 `payload`. 보내는 것은 원문 표 Markdown과 덩이 줄(id · 글 · 원래 행 · 열)뿐. 답이 덩이 줄의 순열이 아니면 `invalid`(경고 `order_mismatch`). 제안 `content = {table_id, unit_ids, reason}`은 그대로 `reorder_unwrapped`로 보낼 수 있다. 채택 기록은 split 전용이던 것을 `record_manual_adoption`(split · unwrap_order)으로 넓힘.
- 명세와 다르게 정한 것: 낡음 기준을 문서 revision이 아니라 **덩이 자체**(최신 추출 · 줄 id와 글의 해시)로 — 문서 어디든 편집하면 revision이 올라 사람이 일하는 동안 거의 모든 제안이 낡는다. 사람이 그 사이 순서만 바꾼 것은 낡음이 아니다(여전히 같은 줄의 순열).
- 화면: 상태는 새 훅 `use-unwrap-ai.ts`(effect · 타이머 없음 — `useLoaded` · `useAiJobs` 재사용), 미리 보기 판정은 `unwrap-ai-model.ts`. 작업 중 칩은 `/ai/status`의 종류별 끝난 수가 요청 때 기준에 닿으면 걷힌다(표별 상태가 없어 두 표를 연달아 물으면 걷히는 차례가 실제와 다를 수 있음). 놓기는 `runUnitEdit`에 더한 `afterOk`로 편집이 받아들여진 뒤에만 채택을 남긴다.
- 스모크: 벗긴 표 머리 글 전체를 "↺ Back to table"과 견주던 두 검사를 머리 단추 둘(✦ AI order · ↺ Back to table)로 고침(머리에 단추가 늘었기 때문 — 기대를 낮춘 것 아님). 새 단계(AI가 켜진 backend에서만): 미리 보기 → 놓기 → 되돌리기, 다시 물어 그대로 두기. 가짜 AI는 받은 줄 차례를 거꾸로 답한다. 긴 줄에서 "n → m" 칩이 글을 덮지 않는 것을 화면에 주입해 쟀다(겹침 0).

## 2026-11-21 — B10-3 캡션 지정 길 넷 (`feat/caption-pick-paths`)

- 우클릭: 글 대상의 위/아래 캡션 항목(`caption_attach_prev/next` + `prevBundle/nextBundle`)을 `caption_of` 줄들로 바꿈 — `listCaptionHolders`가 가까운 표·그림 5개(자리 거리 → 원문 자리 차이)를 고르고 줄마다 `holder`(번호 · 거리 · 쪽)를 싣는다. 묶음 대상의 "위/아래 문장을 캡션으로"는 그대로. 다듬기 줄의 글 대상 캡션 단추는 없어졌다(캡션은 우클릭 · 캡션 자리가 맡음).
- 줄 고르기는 짝 고르기(`pairFrom`)와 같은 꼴: 상태 `captionPick` · 안내 띠 · Esc · `handleOldClick` 앞단 가로채기, 판단은 끌어 놓기와 같은 `resolveCaptionDrop`. effect · 타이머는 더하지 않음. `slotPlaces`를 그리는 중에 읽게 돼 `buildUnitMenu` 앞으로 옮김(TDZ).
- 검증: frontend 1,904 · lint · tsc, assign 스모크(새 단계: 우클릭 줄 · 줄 고르기 · Esc · 되돌리기 통과). 전체 스모크의 "언어 바꾸면 모양 전환" 단계가 두 번째 Ctrl+Z에서 응답을 못 기다리는 일이 두 번 있었으나 그 단계만 새 DB로 돌리면 19/19 — 메뉴를 다 지난 뒤의 되돌리기라 이 변경과 무관한, 전에도 기록된 흔들림으로 봄.

## 2026-11-21 — B10-2 캡션 규칙 넓히기 (`feat/caption-any-line`)

- 캡션 가능 = 문장 · 제목 · 묶음이 풀린 칸 문장(서버 `CAPTIONABLE_KINDS` + `group_unit_id` 검사, 프런트 `getCaptionRefusal` 하나 — 메뉴 모델의 사본은 걷음). 거리 제한을 걷어 서버 `_measure_caption_distance` · `get_place_distance` · `CAPTION_REACH`(rule-cases 상수 포함)를 지웠고, 블록 자리는 후보 순서 잣대로만 남겼다. 그림 묶기 후보는 이웃 그림의 일이라 프런트 상수 `FIGURE_GROUP_REACH = 2`로 남김.
- 후보 순서: 자리 거리 → 원문 자리 차이. 같은 바깥 표 안(자리 0)은 위 · 아래를 원문 차례로 정하고 "같은 표 안"으로 적는다 — 칸 안 줄은 블록이 안쪽 표보다 앞이라 위 · 아래 구분이 원문 읽기 차례와 다를 수 있어 거리 0은 방향을 적지 않는다. 결과물 A의 캡션 위치는 명세가 권한 "캡션 자리"(`표 n 캡션` · `그림 캡션`, 대상 표의 첫 행에서 올린 캡션은 칸 좌표 그대로).
- 검증: backend 전체(거리 제한을 박아 둔 옛 시험 둘을 새 규칙으로 고침), frontend 전체, assign 스모크 1,076(첫 실행 1건 실패 · 다시 돌려 통과 — 알려진 흔들림), 합성 업로드 화면(벗긴 바깥 표 · 안쪽 표 캡션 자리 후보).

## 2026-11-21 — B10-1 칸 안 캡션 · 캡션 읽기 넓히기 (`feat/caption-extract`)

- B10을 스텝 셋으로 나눔(B10-1 추출 · B10-2 규칙 넓히기 · B10-3 지정 길 넷). B10-1은 추출기 8: 칸 블록을 쪼개지 않고 칸 블록 신호 `captions`([시작, 끝, 안쪽 표 첫 칸 seq])로 줄 범위만 가리키고, `build_unit_drafts`가 그 줄을 캡션 Unit(`table_id` 없음, 안쪽 표 묶음)으로 만든다 — 명세 권장대로 캡션은 안쪽 표 쪽. 번호 칸은 캡션 줄에 붙지 않는다.
- 합성 문서로 화면을 보다 찾은 것: 바깥 표 바로 뒤 "<표 2>"가 위 표로 갔다(먼저 만난 묶음이 갖는 규칙). 템플릿 자리(표 위 · 그림 아래)를 모든 묶음이 먼저 보고 남은 묶음만 반대쪽을 보는 두 바퀴로 바꿨다(칸 안도 같은 규칙) — 옛 시험 둘의 기대를 이 규칙으로 고침. 괄호 꼴은 옛 시험이 "머리 아님"을 박아 두었으나 명세대로 머리로 바꿈(rule-cases `caption_heads`로 프런트 사본 대조).
- 떼기 · 안쪽 표 벗기기는 바깥 칸 줄로 돌아간다(`_build_freed_caption`이 대상 표의 칸일 때만 첫 행, 다른 표의 칸이면 그 표 단위 · 벗긴 표면 묶음 없음). 프런트 캡션 칩의 "첫 행" 판정도 블록의 표가 대상 표일 때만(`cellTables`), 용지는 바깥 칸에서 그 줄을 빼고(`isOtherTableCaption`) 안쪽 표 머리에 접는다. 검증: backend 3,185, frontend 1,900+, assign 스모크 1,076, 합성 업로드 화면(바깥 표 그대로 · 벗김).

## 2026-11-21 — 벗긴 표 안 벗긴 표의 Section No. (`fix/nested-cell-numbers`)

- B9가 남긴 끝 사례를 사용자 결정으로 고침("자주 있을 수 있고 경험 통일성을 해친다"): 줄이 덩이 하나가 아니라 덩이 사슬(바깥 → 안쪽, `_list_blocks`)을 지니고, `build_section_numbers`는 열린 덩이마다 돌아갈 번호를 쌓는다 — 안쪽 덩이로 들어갈 때는 지금 번호를 복사해 이어받고, 나갈 때만 그 덩이(와 안쪽)의 칸 번호를 버린다. 칸 번호는 열린 어느 덩이의 돌아갈 값에도 넣지 않는다. 합성 업로드 시험(칸 "1" 안 안쪽 표를 둘 다 벗김 → 안쪽 줄 "1", 표 뒤 "5.")과 단위 시험(안쪽 칸 "A"는 안쪽 표 안에서만). 검증: backend 3,166, 문단 시트 스모크 단계.

## 2026-11-21 — B9 문단 Excel에 편집 반영 (`feat/paragraph-sheet-edits`)

- 시트 모형에 미리보기 전용 줄 값 둘(`SheetRow.deleted` · `unit_ids`)과 칸 `strike`를 더했다 — 파일과 미리보기가 같은 줄이라는 계약은 그대로(지운 줄도 파일 행), 화면만 지운 줄을 숨긴다(`listShownItems`, 고른 지운 줄은 `data-mark="deleted"`). 미리보기 머리 "n rows"는 파일 행 수 그대로 두고 범례에 지운 줄 안내를 더했다(행 수를 숨긴 수만큼 빼면 잘린 창의 위 · 아래 수와 어긋난다).
- 한 행 묶기(9-c): 확정 배정(`assigned` + `confirmed`)이고 New 문장이 하나뿐인 Old 줄끼리 시트 차례로 이어지면 한 행 — 섹션 번호는 묶기 전 줄로 세어 뒤 줄의 번호 물려받기가 그대로다. 나누어 여러 문장으로 간 줄은 묶지 않는다. 시트 글은 영어 한 벌이라 Remark는 "Deleted"(명세의 "삭제"를 바꿈).
- 칸 번호 범위(내 판단 그대로): `number_source == cell` · 사람이 안 고침 · 띠 표 제목 줄 아님인 번호만 그 벗긴 덩이(`find_line_table`) 안에서 쓰고, 덩이를 나오면 칸 번호를 뺀 번호 상태로 돌아간다(`build_section_numbers`가 두 상태를 든다). 합성 §6-3(절 "5." 아래 숫자 칸 표 → 벗김)으로 업로드 경로 시험 — 고치기 전에는 표 뒤 문단이 "3"이었다. 안쪽 벗긴 표로 들어갈 때도 바깥 칸 번호가 풀리는 끝 사례는 남겼다.
- 들여쓰기: 용지 `getRowLevels`를 `numbering.build_row_levels`로 옮기고 rule-cases(`row_levels`, `MAX_ROW_LEVEL`)로 대조. Excel 들여쓰기 = 단계 − 1(맨 바깥은 0). 옛 추출(번호 범위 없는 추출기 5 전)은 용지가 절 번호로 셈하지만 시트는 번호 칸 값으로 셈한다.
- 덤: B8이 남긴 설명서 굵은 글 `**◀ ▶**`(화면 라벨이 아니라 `manual-content.test.ts`가 dev에서 실패)를 보통 글로.
- 스모크: 지운 줄 단계에 문단 시트(숨김 · 고르면 빨간 음영 · 취소선 · Lang 빈 칸) 확인을 더했다. 전체 실행에서는 앞 단계가 묶음 목록 순서를 바꿔 "첫 묶음 첫 줄 = 확정 삭제한 제목"이 되므로, 문단 시트의 고른 행 고르개를 `picked` 또는 `deleted`로 넓혔다(Excel A 쪽은 그대로) — 시트 옮기기(`sheet-pan`)도 고른 지운 줄을 가운데로 맞추게 같은 고르개. 검증: backend 3,164 · vitest 1,883, 전체 스모크 2,059/2,060(남은 하나는 B6-3 언어 바꾸기 단계의 흔들림 — 깨끗한 시드에서 브랜치 3/3 · dev 2/2 통과), 대비 · 겹침(72) 감사 통과.

## 2026-11-21 — B8 번호 ◀ ▶ · 들여쓰기 저장 · 일괄 (`feat/number-levels`)

- 들여쓰기는 상대 값 `units.indent_shift`(명세 그대로): 화면 단계 = 셈한 단계 + 차이. 셈한 단계를 `getRowLevels`(strip-pill-model)로 옮겨 정했다 — 숫자 번호는 깊이(차이 무시), 점 기호는 앞 숫자 깊이 + 1 + 순번, 직접 · 번호 없는 줄은 **가장 가까운 숫자 · 기호 줄(anchor)의 화면 단계**에 기댄다(앞 줄이 아니라). 그래야 기호 줄을 옮기면 이어 쓴 줄이 따라가고, 이어진 번호 없는 줄끼리는 서로 기대지 않아 일괄을 한 칸씩 되돌릴 수 있다. 차이가 모두 0이면 옛 "앞 줄 폭"과 같다. 일괄(`planIndent`)은 옮기는 기호 줄에 기댄 줄을 적지 않는다(두 번 더하지 않게).
- 편집 `set_indents [{unit_id, indent_shift}]`(제자리 · 한 칸, 번호 칸 있는 줄만 · -9…9) + `set_number.indent_shift`(기호 위로 맞춤을 번호와 한 편집으로). 명세의 `set_numbers`는 만들지 않았다 — 번호 줄 ◀ ▶는 입력 상자 값만 바꾸고 기존 `set_number`(+ 따라 고치기 미리 보기)로 저장해 필요가 없었다. 일괄 두 칸은 화면이 `set_indents`를 차례로 두 번 보낸다.
- 내 판단: ◀ 끝은 1단계(명세 "0"은 맨 바깥으로 읽음), 입력 상자는 이미 9ch 고정이라 그대로(40자 폭은 창에 너무 넓다), 기호 위로 맞춤은 숫자 번호 줄을 만나면 멈추고 위 기호 줄의 차이를 그대로 복사(같은 절이면 숫자 깊이가 같아 같은 단계), 없으면 차이를 건드리지 않음. 연속 번호 제안만 표 경계를 무시(`listSuggestSiblings`), 서버 따라 고치기 범위는 그대로(rule-cases 변경 없음). 일괄은 숫자 번호 줄에서 멈추고 표 · 그림 줄 · 짝 카드 둘째 줄은 건너뛴다.
- 스모크 새 단계(시드 "1." 아래 번호 없는 줄 셋): 연속 번호 → ◀ ▶ 끝 · 단추 자리 고정 · Esc 무저장, 첫 줄 • → 둘 • 단계, 둘째 ◀ → 둘 다 내어씀 → Undo 한 번은 셋째만.

## 2026-11-21 — B7 1단 보기 짝 엿보기 · 그림 위치 판 넓히기 (`feat/pair-peek`)

- 위치 판을 `SpotPanel`(전 `FigureSpotPanel`) 하나로 — 대상이 그림이면 그림 자리, 짝이면 짝 박스(`findUnitSpot`, 앞뒤 3줄은 `findFigureSpot`과 같은 `listAround`). 판 상태는 OldPane에 두고, 짝 판은 연 때 고른 박스를 쥐어 고름이 바뀌거나 2단 보기로 가면 렌더 중에 지운다(다시 그 박스로 와도 열리지 않게). 한 번/두 번 누름은 새 공용 훅 `use-click-or-double`(250ms, effect 예산 밖).
- 1단 보기 배치(내 판단 그대로): 판이 열리면 CSS 컨테이너 쿼리로 Old 칸이 1000px 이상이면 두 열(판 `min(600px, 45%)`, 용지는 판 옆으로) — 명세의 1180 대신 1000으로 정했다(오른쪽 결정 칸 때문에 1680px 창에서도 Old 칸이 1144px). 좁으면 판 `min(600px, 92%)`이 덮는다. 비켜서는 움직임은 `use-pane-slide`의 FLIP을 `startSlide`로 떼어 낸 `useSheetSlide`(`data-motion="aside"`).
- 그림 자리 표지: 줄 사이는 점선 네모(그림 미리 보기 48px · "그림 · here" · 캡션 한 줄 — `FigureImage thumb`), 문장 속은 나눌 선 자리(`renderAtCut`)에 "▣ 그림" 칩. 스모크: 그림 단계는 표지 둘 중 하나 + 1단 보기 오른쪽 판, 짝 단계에 1단 엿보기(1248 · 1680px 덮음 / 비켜섬, Esc 복귀, 판 줄 누름, 두 번 누름). 판 들어오는 움직임이 끝난 뒤 재고 찍게 했다(전에는 움직이는 도중 스크린숏).

## 2026-11-21 — B6-3 언어 바꾸기 → 모양 전환 (`feat/lang-shape-switch`)

- 새 편집 `switch_language {unit_id, lang, piece?, merge_pair?}`(옛 문서만): 짝을 한 언어로 → `merge_pair`면 `_plan_merge`로 합치고 아니면 언어만(짝은 `_leave_pairs`가 지움), `piece`면 그 합치기가 은퇴시킨 조각을 되살려 언어를 바꾸고 남은 조각은 하나면 되살리고 둘 이상이면 새로 합쳐 짝(`_Change.pair_units` · `pair_drafts` → `_create_human_pair`). 이웃 판단은 합치기 이웃 검사처럼 화면이 용지 순서로(`planLanguageChange`). 3-c는 `_Change.release`(확인 없이 settled, 제자리 단위는 `detach_units(cleared)`) — 보통 언어 바꾸기의 409는 그대로.
- 짝을 합친 박스도 조각이 남게 `is_merge_edit`가 `switch_language`의 합침(만든 1 · 은퇴 2+)을 합치기로 본다 — 끝 조각을 되돌리면 다시 짝(사용자 원문 "반대의 경우에도 짝으로"). 문서 보기 `merge_pieces`(조각 글, 원문 순 = piece 순번). 되돌리기는 B6-2 스냅숏이 짝 · 배정을 되쓴다.
- 내 판단: 남은 조각은 합친 박스의 언어를 따른다(조각마다 따로 정하지 않음). "One sentence → KO/EN pair"는 `pickPairPiece`(planPairLanguages 기준의 EN 조각이 끝이고 합친 문장이 KO)일 때만 이 편집 하나, 아니면 옛 세 걸음. 풀린 배정 수는 `detach.reset_unit_ids`.
- 응답 `shape`는 값이 있을 때만 싣는다(`model_serializer`) — 다른 편집 응답은 전과 같은 꼴. 스모크: 보통 언어 바꾸기 · 배정 문장 언어 잠김을 보던 두 단계는 대상을 짝 없는 문장으로(짝 구성원은 이제 모양 전환), "One sentence → KO/EN pair" 단계는 확인 창 없이(3-c), 새 단계(이웃 짝 합침 → 끝 조각 → 짝, 떨어진 짝 풂, Ctrl+Z). 떨어진 짝은 시드에 없어 짝 없는 문장끼리 API로 맺고 끝에 푼다. 검증: backend 3,150 · vitest 1,853, Assign 스모크 1,045, 대비 · 겹침 감사(극단 자료 배치 감사는 폴리싱 때 — 메모리 결정).

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
