# Assign 시안 2 설계 — 번호 종류 · 벗긴 표 순서 · 그림 탭 · Space = 문단 Excel · New 표 칸 잇기 · 빈 템플릿 용지 통일

2026-11-20. 사용자가 확정한 시안 2(아티팩트 `https://claude.ai/artifact/6UHCMju1Ajw6ZwccW4ZWax`)를 구현 단위로 적는다. 요청서는 `docs/superpowers/handoff/2026-11-19-paragraph-split-requests.md`의 2 · 7 · 10 · 11 · 17번과 "기타 공통 요구사항"(통일), 결정은 그 문서 끝 "시안 2 확정 (2026-11-20)"이다. 바탕은 시안 1(`docs/superpowers/specs/2026-11-20-assign-mockup1-design.md`, v1.2.11) — 고름 · 처리 중 · 따라가기 모델(`lib/assign-focus-model.ts` · `use-assign-focus.ts`), 다시 받기 범위(`planReload`), 끌기 모양(`lib/box-drag.ts` · `lib/drop-line.ts`), 짝 카드 손잡이(`reorder_pair`, Alembic `0033`) 위에 선다. 시안이 정한 것은 다시 정하지 않고, 답하지 않은 것만 끝의 "확인할 것"에 둔다.

## 왜

- **번호 칸이 아무 글이나 받는 상자 하나(2)**: 종류(숫자 · 점 기호 · 그 밖)가 없어 점 기호를 손으로 치고, 원문 번호와 다르게 고친 흔적이 결과물에 남지 않는다.
- **벗긴 표의 줄 차례가 고정(7)**: 칸 문장이 행 → 열 차례로 늘어서고 바꿀 길이 없다. 열 단위로 읽혀야 하는 표는 차례가 틀린다(요청서 "임의로 순서를 박아 넣은 것").
- **그림이 본문 흐름을 끊는다(10)**: 실제 문서는 문장 한가운데 아이콘 · 그림 다섯 장 연달아 등이라 늘 보이면 시끄럽다.
- **Space가 쪼개기 화면에서 20열 비교 Excel을 보인다(11)**: 한 단 보기는 쪼개기를 보는 자리인데, 문단 Excel은 머리 줄 없는 한 열(번호가 글 안)이라 미리 볼 수도 없다.
- **New 표 칸에 이을 수 없다(17)**: 서버 모형(표 새 문장 + 칸 새 문장)은 있으나 화면이 칸을 고르지 못한다(`new-bundle.tsx:79` `data-cell-target`은 쓰는 곳이 없다).
- **빈 템플릿만 다른 모양(통일)**: Old · 이미 쓴 New는 용지(번호 칸 + 박스)인데 빈 템플릿 기본 보기는 칸 이름 아래 카드 목록이다.

## 지금 구조 (2026-11-20 `dev` v1.2.11, 프런트 줄 번호는 `frontend/src/` 기준)

**번호 칸** — `components/paper/number-cell.tsx`: 값 `number.value`(서버 `get_number`), 누르면 입력 상자 + "번호 없음" + "뒤 번호도 따라 고치기" 체크 + 따라 바뀔 번호 미리 보기(`:124-150`), 저장 `onSave(text, follow)` → 편집 op `set_number`. 서버 `app/sop/editing.py` `SetNumberOp`(`:235`, 글 1–40자 · `null` = 번호 없음), `_plan_set_number`(`:878` — 같은 언어 · 같은 표의 형제를 `plan_follow`로 따라 고치고, 고친 번호가 절을 열면 `_find_section_moves`로 블록 절 이름까지). 열은 `units.number_read` · `number_source` · `number_len` · `number_set`(`models.py:365-370`, NULL 고치지 않음 · `""` 번호 없음). 규칙 `numbering.py` — `get_number` `:135`, `is_number_fixed` `:178`(결과물 A 위치 칸만 씀), `plan_follow` `:236`(프런트 사본 `lib/number-model.ts` `planFollow` `:76`, 사례 `rule-cases.json`). 응답 `routers/sop_documents.py` `ViewNumberOut` `:270` · `_to_number_out` `:802` → `lib/api-sop.ts` `ViewNumber` `:390`. 점 기호는 결과물 C의 번호 표시(`number_style = "bullet"`, `constants.py:36-45` `BULLET_SYMBOLS = ("•", "○", "▪")`, 깊이 `outputs.get_bullet_depths` `:626`)에만 있고 Old · New 문서 단위에는 없다. 번호 칸 폭은 깊이별(`lib/strip-pill-model.ts` `getSectionLevel` `:13` · `getLevelWidths` `:31`).

**벗긴 표** — 칸 줄은 용지 모델이 문단처럼 펴고(`lib/paper-model.ts` `orderBlockPieces` `:153` — 안쪽 표는 바깥 칸의 놓였던 자리로), `lib/unwrap-model.ts`가 줄이 든 벗긴 표(`getRowUnwrapTable` `:13`) · 덩이 머리(`findUnwrapHeads` `:28`)만 정한다. 차례는 블록 원문 순서(행 → 열)뿐이다. 용지는 벗긴 덩이에 왼쪽 세로선(`components/paper/paper.tsx:1093-1104`) · 머리 "↺ 다시 표로"(`:1317-1331`). 시안 1의 카드 안 순서는 `units.pair_seq`(`models.py:380-382`) + 편집 `reorder_pair`(`editing.py:269` · `_plan_reorder_pair` `:1475`, 되돌리기 `unit_edits.pair_seq_changes` `:1950`) + 순수 규칙 `app/sop/pair_order.py` `order_pair_card`(사본 `lib/pair-order-model.ts`) + 손잡이 `pairGrip`(`app/bundles/[id]/assign/use-assign-page.tsx:2815`).

**그림** — 추출은 문단 안 그림 요소마다 그림 레코드를 문단 뒤에 낸다(`app/sop/extract/docx_reader.py:796-800` 그림 요소 → `read.figures`, 칸 안은 `:1128-1165`). **문단 안 글자 자리는 남기지 않는다.** 블록 신호(`extract/types.py:52`, `source_blocks.signals`, Alembic `0025`)에 그림 자리는 없고, 표에만 안쪽 표 자리 신호 `place` → 응답 `ViewTable.anchor {block_id, at}`(`routers/sop_documents.py:438-448`)가 있다. 용지는 그림 블록을 본문 줄로 그린다 — `paper-model.ts` 그림 줄 `:410`, 캡션 접기 `foldCaptionRows` `:366`, 그리기 `paper.tsx` `renderBundleHead` `:956` · `renderFigure` `:1027`. 탭은 본문 · 머리말 · 꼬리말 셋(`PaperTabKey` `paper-model.ts:474`, `buildPaperTabs` `:532`, `components/paper/part-tabs.tsx`, Old 칸 `components/assign/old-pane.tsx:159`). New 칸은 그림 줄을 `NewBundle`(`new-bundle.tsx:50`)로 그린다(`new-pane.tsx:533`). 여러 그림 ↔ 캡션 하나는 `caption_figure_id`(편집 `group_figures` · `ungroup_figures`).

**Space 미리 보기** — `components/assign/space-preview.tsx`(상태 기계 `lib/space-preview-model.ts`)가 그 Old 문서의 Excel A를 `GET …/export/preview/a`(`routers/sop_outputs.py:241`, `api-sop.ts:1529` `getAssignSheetPreview`)로 받아 `SheetView`로 그린다. 켜짐은 `page.tsx:443` `enabled={!isNewEdit && oldView !== null && rows.length > 0}` — 한 단 · 양 단 구분 없이 같다.

**문단 Excel** — `app/sop/paragraph_excel.py`: 본문 단위를 원문 순서로 한 열에 단위 글 그대로(번호가 글 안), 머리 줄 없음(`build_paragraph_rows` `:42`), 표는 행마다 한 줄 · 칸은 옆 열(`:55-60`, **벗긴 표의 칸 줄도 표 행으로 묶는다**), 그림은 `[Figure]`, 짝 카드는 `pair_seq` 순서(`:145`). 라우터 `routers/sop_documents.py:945-985`(`…/documents/{id}/paragraphs.xlsx` · `…/old-paragraphs.xlsx`, `tables=`), 프런트 `api-sop.ts:1540` `downloadParagraphs` ← 문서 대시보드(`components/assign/doc-dashboard.tsx:122`).

**New 표 · 칸** — 이미 쓴 New 문서의 표 줄은 `WrittenSentence.table`(`api-sop.ts:1126`) = 격자 + `BundleCell { target_id, row, col, lang, text, status }`(`:1134`, 서버 `app/sop/written.py:207-226`). 칸의 출처 · revision은 응답에 없다. 저장 쪽은 이미 된다 — `decisions.py` `TargetIn`(`:122`, `parent_key` · `cell_row` · `cell_col`), 칸 새 문장 검사 `_link_cell_target`(`:846` — 입구 2(`ORIGIN_NEW_DOC`) 칸은 `parent_key` 없이 지금 부모를 쓰고 출처 검사를 건너뜀), 출처 종류 `_check_source_kinds`(`:711` — 칸 새 문장은 `kind = "sentence"`라 Old 문장 · 칸 문장을 받음), 변경 종류는 칸 글로(`_decide_change_type`, 둘 이상이면 `merged`). 관계 묶음은 표 ↔ 칸 연결로 표 전체가 한 묶음(`groups.collect_component`). 결과물: C 시트는 칸 줄마다 자기 출처(`sheet_model.py:401-433` `C_SOURCE`), A 시트의 Place는 새 문서 절 경로뿐이다(`outputs.py:987` `_format_target_location` — 칸 자리 없음. 칸 문구 `output_labels.py:54` `cell_template = "표 {table} · {row}행 {col}열"`은 Old 쪽 위치만 씀).

**빈 템플릿(엮은 New) 기본 보기** — `components/assign/new-pane.tsx`: 이미 쓴 문서 · 엮은 문서가 같은 부품이지만 엮은 줄은 `lib/composed-model.ts` `buildComposedRows`(`:64`)로 편 칸 머리(`renderSectionHead` `:451`) · 빈 칸 자리(`renderRow` `:487-522`) · 자기 번호 앞머리(`getComposedLeadWidths` `:135`, `StripLead` 읽기 전용)를 그리고, `readOnly`(`page.tsx:669`)라 출처 칩 · 고르기만 있다. 머리의 "기본 | 템플릿" 전환(`viewSwitch` `new-pane.tsx:117` · `:593` · `:609`)이 템플릿 보기(`components/template/template-view`)를 그린다. 이미 쓴 New를 고치는 한 단 보기(`isNewEdit`, `use-assign-page.tsx:420`)는 Old와 같은 `Paper`다. 엮은 문서의 순서 · 깊이 · 번호 표시는 결과물 C 편집(`lib/c-edit-model.ts` `CEdit` — `move` · `indent` · `style` · place, 저장 `PUT …/targets/order` `routers/sop_outputs.py:479`, 줄 `lib/c-save-queue.ts`)이 이미 한다.

## 결정

### D1 번호 칸 종류 (2번)

- **종류 단추 줄** — 번호 칸 창 맨 위: `1.2.3 연속 번호` · `•` · `○` · `▪` · `A-1 직접` · `없음`(en `1.2.3 Continuous` · `A-1 Custom` · `None`). 바깥 누르기 · Esc 닫기(v1.2.3)는 그대로.
  - **연속 번호**: 입력 상자에 앱이 센 값을 채우고 옆에 `연속이면 3.`(en `Continuous: 3.`)을 보인다. 사람이 고치면 그 값이 저장된다. "뒤 번호도 따라 고치기"는 이 종류에서만 보인다(지금 `planFollow` 그대로).
  - **• ○ ▪**: 누르면 바로 저장 — `number = "•"` 등, `follow = false`.
  - **A-1 직접**: 빈 입력 상자(지금 값이 있으면 그 값), 따라 고치기 없음(`follow = false`).
  - **없음**: 지금 "번호 없음"(`number = null`).
- **종류는 저장하지 않고 값에서 읽는다** — 새 열 · Alembic 없음. 순수 `lib/number-kind-model.ts` `readNumberKind(value)`: `""`/null → `none`, `BULLET_SYMBOLS` 하나 → `bullet`, `^\d+(\.\d+)*\.?$` → `continuous`, 그 밖 → `custom`. 창은 지금 값의 종류 단추를 눌린 채로 연다.
- **연속 값 세기** — `suggestContinuous(numbers, index)`(같은 파일, 프런트 전용 — 저장되는 것은 사람이 확인한 글이라 서버 사본이 필요 없다): 같은 목록 후보(`_plan_set_number`과 같은 규칙 — 같은 언어 · 같은 표, 띠 표 제목은 표 밖, 프런트의 형제 고르기는 이미 `listFollowPreview` `number-model.ts:142`에 있다)에서 그 줄 앞의 가장 가까운 숫자 번호를 본다. 그 줄이 읽은 번호가 있으면 그 깊이, 없으면 앞 번호의 깊이에서 같은 부모 아래 다음 순번, 꼴(끝 점)은 앞 번호를 따른다. 앞에 없으면 `1`(앞 번호 꼴의 끝 점). 점 기호 · 직접 번호 줄은 건너뛴다.
- **점 기호 줄의 들여쓰기** — 번호 칸 폭 · 들여쓰기 단계는 `getBulletLevel(previousLevel, symbol)` = 앞의 가장 가까운 숫자 번호 줄 깊이 + 1 + 기호 순번(• 0 · ○ 1 · ▪ 2), 3번의 단계 폭(`getLevelWidths`)에 그대로 들어간다.
- **번호 노트** — 서버 `numbering.get_number_note(unit) -> str | None`: 사람이 고쳤고(`number_set is not None`) 읽은 값이 있고 두 값이 다르면(`normalize_number` 비교, 번호 없음 · 점 기호로 바꾼 것 포함) 읽은 값. `is_number_fixed`는 이 함수 위로 다시 쓴다(한 곳). 응답 `ViewNumberOut.note: str | None` → `ViewNumber.note`.
  - 번호 칸 툴팁: `§ 4. · 원문 3.`(en `· Source 3.`), 창 아래 노트 줄 `원문 번호 "3."과 다름 — 결과물에 노트로 남깁니다.`(en `Differs from the source number "3." — kept as a note in the outputs.`).
  - 문단 Excel "번호 노트" 열(D4).
- **서버** — `set_number`의 입력 모양은 그대로(1–40자). 점 기호 값은 절을 열지 않는다: `_plan_set_number`이 기호 값의 줄을 `renamed`에 넣지 않는다(절 이름이 `•`이 되지 않게), `plan_follow`는 기호를 셀 수 없어 이미 빈 결과다. 새 거절 코드 없음.

### D2 벗긴 표 줄 순서 — 손잡이 끌기 (7번)

- **모양** — 시안 1 D8의 짝 카드 손잡이와 같다: 고른 박스가 벗긴 덩이 안이면 박스 왼쪽 바깥에 점 여섯 손잡이(테스트 id `assign-paper-unwrap-grip-<unitId>`), 끄는 동안 원래 줄 흐림 · 한 줄 카드 · 놓일 자리는 덩이 안 두 줄 사이 점 달린 선(`lib/drop-line.ts`). 덩이 밖은 놓을 자리 밖. 박스 전체 끌기(잇기 · 보내기 · 짝)는 그대로다. 세로 · 가로 우선(b)과 AI 제안(c)은 하지 않는다.
- **움직이는 단위는 용지 줄** — 문장 줄, 짝 카드(구성원이 함께), 아직 표인 안쪽 표(표 단위), 안쪽 띠 표의 제목 줄. 모두 단위가 있다.
- **서버 순서 칸** — `units.unwrap_seq`(Integer, NULL) + `unit_edits.unwrap_seq_changes`(JSON, 기본 `{}`), **Alembic `0034`**. 새 편집 op:
  ```python
  class ReorderUnwrappedOp(BaseModel):
      type: Literal["reorder_unwrapped"]
      table_id: DbId            # 벗긴 표(레이아웃 표)
      unit_ids: list[DbId]      # 그 덩이의 활성 단위 전부, 새 순서(짝 카드 구성원은 붙여서)
  ```
  - 덩이 = 첫 블록이 그 표의 칸이거나, 그 표 안쪽의 아직 표인 표 · 띠 표 제목에 속한 활성 단위(프런트 `getRowUnwrapTable`과 같은 뜻 — 서버는 `source_blocks.table_id`와 `source_tables.parent_table_id` 사슬로 잰다). 순수 규칙 `app/sop/unwrap_order.py` `order_unwrapped(units, seq_of, pos_of)`, 프런트 사본 `lib/unwrap-order-model.ts`(사례 `rule-cases.json`에 더함).
  - **순서 규칙**: 덩이의 줄을 (`unwrap_seq`, 원문 자리)로 정렬하되, `unwrap_seq`가 없는 단위는 원문 순서에서 바로 앞 단위의 값을 빌린다 — 바꾼 적 없으면 원문 순서, 나누기 · 붙이기로 새로 생긴 조각은 옛 줄 자리에 원문 순서로 남는다(`pair_order`처럼 "하나라도 없으면 원문 순서"로 돌아가지 않게).
  - **거절**: 벗긴 표가 아니면 422 `table_not_unwrapped`, `unit_ids`가 덩이와 다르면 422 `unwrap_lines_mismatch`(`unit_ids` 문맥). 지금 순서와 같으면 바뀌는 게 없다. **판단은 막지 않는다** — 글 · 출처가 그대로이고 순서는 용지 · 문단 Excel만 따른다(`_write_change`의 판단 검사에서 `unwrap_seqs`만 바뀐 편집은 뺀다. `reorder_pair`와 다른 까닭: 짝 순서는 짝을 한 문장으로 합치는 순서를 바꾼다).
  - **다시 표로**(`set_layout_table` 묶기)는 같은 편집에서 덩이의 `unwrap_seq`를 비운다(`_Change.unwrap_seqs`, 되돌리면 돌아온다) — 다시 벗겼을 때 낡은 순서가 살아나지 않게. 쪼개기 편집의 새 단위는 값을 물려받지 않는다(위 빌리기 규칙이 자리를 지킨다).
  - 응답 `ViewUnitOut.unwrap_seq` → `ViewUnit.unwrap_seq?`.
- **따르는 곳**: 용지 줄 차례(`unwrap-model.ts`에 `orderUnwrappedRows` — `buildRows` 뒤, 덩이 안만), J/K 순서(`model.order`), Shape 줄 순서, 문단 Excel · Space 미리 보기(D4). 결과물 A는 원문 순서 그대로(확인할 것 4).
- 처리 중 알약은 시안 1 D4의 표 머리 자리 `Reordering… / 순서 바꾸는 중…`, `PendingKind`에 `reorder` 하나를 더한다.

### D3 그림 탭과 위치 판 (10번)

- **탭** — `PaperTabKey`에 `"figures"`를 더해 탭 줄이 **본문 | 머리말 | 꼬리말 | 그림 n**(n = 그 문서 그림 묶음 수, 0이면 탭 없음). Old 칸 · 이미 쓴 New 한 단(`Paper`) · 양 단 New 칸(`NewPane` 머리 탭) · 빈 템플릿(D6 용지) 모두 같은 탭.
- **본문에서 빼는 것** — 그림 묶음 = 그림 단위 하나 + 거기 붙은 캡션 단위(`group_unit_id`가 그 그림) + 같은 캡션을 나눠 쓰는 그림들(`caption_figure_id`가 같은 것 — 카드 하나에 그림 여럿). 본문 탭(용지 · J/K · 묶기 틈)에서 빠지고 **원래 자리 표시는 없다**. 아직 표인 데이터 표의 칸 안 그림도 빠진다(칸에는 글만). 본문 글의 "그림 5 참조" 연결(캡션 참조)은 그대로.
- **그림 탭** — 그림 카드를 문서 순서로: 머리(`FIGURE · 표시 ID · 캡션`) · 이미지 · 줄 끝 단추 **Show position**(위치 보기) · **Delete**. 카드를 누르면 그 그림 단위를 고른다(시안 1 `Focus { kind: "unit" }`) — 결정 칸 · 보내기 · 끌어 보내기 · 캡션 묶기(`caption-slot`)는 지금 그림 박스와 같다. Delete는 그 줄의 삭제 확정(지금 결정 칸 삭제와 같은 저장, Remark 선택 — v1.2.5)이고 확정된 삭제 카드는 시안 1 D6처럼 흐린 한 줄로 접힌다. J/K는 탭 안 카드 순서.
- **위치 판** — **Show position**을 누르면 왼쪽에서 판이 미끄러져 나와(움직임 줄이기면 바로) 그 그림 자리 앞뒤 본문만 읽기 전용으로 보인다: 자리 앞 3줄 · 자리 표시 · 뒤 3줄(용지 줄 단위, 같은 `Paper` 조각을 `readOnly`로). 자리 표시는 줄 사이 점 달린 선(`FIGURE 1-034`). **문장 속 그림**이면 그 문장 줄을 강조하고 글자 자리에 세로 표시(caret)를 넣는다. 판 안 줄을 누르면 본문 탭으로 가 그 줄을 고른다. Esc · 바깥 누르기로 닫는다. 순수 `lib/figure-spot-model.ts` `findFigureSpot(model, figureUnitId) -> { before: rowKeys, after: rowKeys, host: { unitId, at } | null }`.
- **서버 — 문장 속 자리** — 추출기 7(`EXTRACTOR_VERSION = "7"`): 문단 안 그림 요소를 읽을 때 그 순간의 글 길이(써 넣은 자동 번호 길이를 더한 값)를 그림 레코드에 적고, 그림 블록 신호 `"inline": {"at": <앞 문단 글 안 자리>}`로 남긴다(블록 신호 docstring `types.py:52`에 한 줄). 그림만 든 문단 · 칸 안 그림도 같은 규칙(칸은 칸 글 안 자리). **Alembic 없음**(`signals` JSON). 응답 `ViewBlockOut.anchor: {block_id, at} | None`(그림 블록만, 앞 문단 블록 id와 자리 — 표의 `ViewTableAnchorOut`과 같은 모양) → `ViewBlock.anchor?`. 추출기 6까지의 문서는 `anchor = null` → 판은 그림 블록 바로 앞 줄 뒤에 선만 긋는다(다시 올리면 글자 자리까지).
- 다시 받기: 그림 탭 · 판은 그 문서 보기 하나에서 파생 — 새 요청 없음.

### D4 문단 Excel 열과 Space 미리 보기 (11번)

**열 계약**(xlsx · 미리 보기 같은 시트 모델, 시스템 표시는 다른 Excel처럼 en):

| # | 머리(en) | 화면 이름(ko) | 값 |
|---|---|---|---|
| 1 | `Section No.` | 섹션 번호 | 그 줄 번호 칸 값(숫자 · 직접 번호), 점 기호 · 번호 없는 줄 · 제목 아닌 본문은 **앞의 가장 가까운 숫자 · 직접 번호**(같은 언어 목록, `get_number` 기준). 앞에 없으면 빈 칸 |
| 2 | `Text` | 내용 | 번호를 뺀 내용(`strip_number`). 점 기호 줄은 `• 내용`(기호 + 공백). 그림은 `[Figure]` + 캡션 글 |
| 3 | `Lang` | 언어 | `KO` · `EN` · `REF` · 빈 칸(중립) — 일단 둔다 |
| 4 | `Number note` | 번호 노트 | `get_number_note`가 있으면 `Source 3. → 4.`(번호 없음으로 바꿨으면 `Source 3. → none`) |
| 5 | `Remark` | Remark | 그 단위 판단의 `reason`(삭제 · 이동 사유 · 사람이 적은 Remark), 없으면 빈 칸 |

- 머리 줄 1행, 긴 글은 칸 안 줄바꿈(`wrap_text`, 열 폭 고정 — 섹션 12 · 내용 90 · 언어 6 · 노트 18 · Remark 40), 한 칸을 넘는 글은 지금처럼 `split_cell_text`로 다음 줄 같은 열. 모든 글 칸은 `write_text_cell`.
- 줄 차례: 본문 원문 순서 + 짝 카드 순서(`pair_order`) + 벗긴 덩이 순서(D2). **벗긴 표의 칸 줄은 보통 줄**(지금처럼 표 행으로 묶지 않는다 — 벗긴 것은 문단이다). 아직 표인 데이터 표는 `tables=true`일 때 행마다 한 줄, 내용 = 칸 글을 ` | `로 이음(확인할 것 2).
- 숨은 값 없음(요청서 "표면에 드러나지 않는 값 제외") — Unit ID · 그룹 · 상태 · 쪽은 싣지 않는다. 미리 보기만 줄마다 `unit_id`(고른 줄 강조 · 펼침 위치용, xlsx에 쓰지 않음 — `SheetRow`의 기존 미리 보기 전용 칸).
- **서버** — `paragraph_excel.py`가 줄을 `sheet_model.Sheet`(머리 · 폭 · 줄)로 짓고(`build_paragraph_sheet(lines, include_tables) -> Sheet`), xlsx는 `excel_export`의 시트 쓰기를 쓴다(미리 보기와 파일이 같은 모델 — `sheet_model.py` 머리말의 원칙). `UnitLine`에 번호 칸 값 · 노트 · 언어 · Remark · `unwrap_seq` · 표 덩이를 싣는다(`load_unit_lines`가 판단 `reason`을 한 번에 읽는다). 섹션 번호 세기는 순수 `numbering.build_section_numbers(lines) -> list[str | None]`.
- **새 API** — `GET /api/sop/bundles/{bundle_id}/documents/{doc_id}/paragraphs/preview?tables=&around=` → `Sheet`(줄이 `MAX_PREVIEW_ROWS`를 넘으면 `around` 단위 주변만 싣고 `truncated` — Excel A 미리 보기 `sheet_model.build_a_preview` `:589`와 같은 계약이라 `space-preview.tsx`의 다시 받기 규칙이 그대로 돈다). 문서 쪽(old · new) 제한 없음. 내려받기 두 주소는 그대로, 열만 바뀐다.
- **Space** — 한 단 보기(`view.single`)에서는 문단 Excel(그 문서 — Old 한 단 · 이미 쓴 New 한 단(`isNewEdit`) 둘 다), 양 단 보기는 지금처럼 Excel A(시안 본문 "두 단 보기의 Space는 지금처럼 비교 엑셀"). `SpacePreview`에 `sheet: "paragraphs" | "comparison"` 하나를 더하고 머리 이름 · 받기 단추(문단 Excel 받기)가 따른다. 엮은 New(빈 템플릿)는 단위가 없어 꺼진다. 다시 받기 키는 시안 1 D2대로 그 문서 보기 revision(+ 판단 저장 키 — Remark 열 때문).

### D5 New 표 칸 잇기 (17번)

- **고르기** — Old 줄을 고른 채 New 칸(양 단 New 칸의 이미 쓴 문서 표)의 칸을 누르면 그 칸에 잇는다(문장에 잇기와 같은 동작 · 같은 확정). 칸은 누를 수 있는 상자(`data-cell-target`, 테스트 id `assign-new-cell-<targetId>`), 고른 Old 줄이 있을 때만 호버 강조. 칸 위에 출처 칩(문장 상자 위와 같은 `renderSources`), 칩 ×로 끊기(지금 문장 칩과 같은 저장). 한 칸에 여러 Old 줄(합침), 짝 줄은 지금 문장 잇기와 같은 짝 규칙(`listLinkLeftovers`). 끌어 놓기도 칸에 놓을 수 있다(`assign-drop-model`의 상자 놓기 — 칸 테두리 `data-drop`).
- **API 변화(응답만)** — `BundleCellOut`에 `source_unit_ids: list[int]` · `revision: int`을 더한다(`written.py:207-226`) → `BundleCell`. 저장 요청 모양은 바꾸지 않는다.
- **저장 모양** — `classify-model`의 `link`와 같은 길: `groups/by-target/{cellTargetId}`로 닫힌 관계 묶음(표 새 문장 + 형제 칸 + 그 출처)을 받아, 그 칸 새 문장만 바꾼 묶음 저장:
  ```json
  { "action": "confirm",
    "units": [{ "unit_id": 812, "revision": 3, "disposition": "assigned" }, …묶음의 다른 단위 그대로],
    "targets": [
      { "key": "t40", "id": 40, "revision": 7, "kind": "table", "source_unit_ids": [ …지금 그대로 ] },
      { "key": "c41", "id": 41, "revision": 2, "kind": "sentence", "source_unit_ids": [ …지금, 812 ] },
      …형제 칸 그대로 },
    "removed_target_ids": [] }
  ```
  입구 2 칸은 `parent_key`를 비운다(`_link_cell_target`이 지금 부모로 묶는다). 변경 종류는 서버가 칸 글로(`=` / 수정 / 합침). 이 모양이 지금 통과하는지 pytest로 먼저 못 박는다 — 막히면 거절 코드와 고침을 스텝 안에서(새 코드면 `rule.<code>` en · ko).
- **결과물 칸마다 출처** — C 시트는 이미 칸 줄마다 `Old units`. **A 시트 Place**: Old 줄이 칸 새 문장에 이어졌으면 `<절 경로> · 표 n · r행 c열`(en `Table n · R r C c` — `output_labels.cell_template`), n은 그 New 문서 안 표 순번(새 문서 단위의 `table_index + 1`). `outputs._format_target_location`이 칸 새 문장이면 붙인다. 확인할 것 1.

### D6 빈 템플릿 기본 보기를 같은 용지로 (통일)

- **같은 것** — 엮은 New(빈 템플릿)의 기본 보기를 이미 쓴 New 양 단 칸과 같은 줄 부품으로 그린다: 칸 머리는 번호 칸에 칸 번호가 있는 **제목 박스**(Old · New의 `heading` 박스 모양), 문장은 박스, 한/영 짝(번역 · `partner_target_id`)은 짝 카드 하나(시안 1의 카드 · 대괄호), 출처 칩은 박스 위, 표 · 그림은 `NewBundle`(D5의 칸 고르기 포함), 그림은 D3 탭. 빈 칸은 박스 모양의 흐린 자리 박스(지금 `new-slot-empty`의 글 그대로), 앱이 채우는 목록(7.2)은 읽기 전용 박스. 고름 · 처리 중 · 삭제 접기 모양은 시안 1 그대로.
- **다른 것 둘뿐**:
  - **순서 · 칸 옮기기**: 고른 박스 왼쪽 손잡이로 끌어 옮긴다(시안 1 끌기 모양, 놓을 자리 = 박스 사이 선 · 빈 칸 박스). 규칙 · 저장은 Order 화면과 같은 `c-drop-model` → `CEdit` → `c-save-queue` → `PUT …/targets/order`. 이미 쓴 New는 원문 순서라 손잡이가 없다.
  - **글 고치기**: 박스를 고르면 결정 칸의 New 글 칸에서 고친다(지금 저장 경로 그대로). 용지 위 제자리 편집은 하지 않는다(확인할 것 5).
- **번호 칸** — 엮은 문서의 번호는 결과물 C 번호 표시(`number_style`)라 D1 종류 단추가 이리로 옮겨진다: 연속 번호 = `numbered`, `•` `○` `▪` = `bullet` + 깊이(`indent_level` 0 · 1 · 2, `get_bullet_depths`가 눌러 읽는 그대로), 없음 = `omitted`, **A-1 직접은 꺼짐**(C에 직접 번호 꼴이 없다 — 툴팁 `Custom numbers are not used in a New document built here`). 저장은 `CEdit` `style` · `indent`. 번호 노트는 없다(원문 번호가 없다).
- **템플릿 보기**는 그대로(회사 양식 미리 보기, 끌어 놓기 · 클릭 배치 그대로). 머리 전환 "기본 | 템플릿"도 그대로.
- **구조** — 줄 부품을 `Paper`와 `NewPane`이 함께 쓰게 뽑는다: `components/paper/strip-box.tsx`(앞머리 + 박스 + 위 칩 줄 + 짝 대괄호, 지금 `paper.tsx`의 줄 틀과 `new-pane.tsx` `renderSentence` `:355`가 따로 그리는 것). 엮은 줄 → 용지 줄은 순수 `lib/composed-model.ts` `buildComposedStrips(doc)`(칸 머리 = 제목 줄, 짝 = 카드 묶음, 빈 칸 = 자리 줄). `getComposedLeadWidths`는 3번의 `getLevelWidths`로 바꾼다(같은 깊이 같은 폭).
- 서버 변화 없음.

## 바뀌지 않는 것

- `set_number`의 입력 모양 · 따라 고치기 규칙(`plan_follow`) · 번호 칸 값을 서버가 정하는 원칙(F5). 원문 글자 · 범위 · 커버리지.
- 짝 카드 순서(`reorder_pair`), 시안 1의 고름 · 처리 중 · 따라가기 · 다시 받기 범위 · 끌기 엔진. 벗기기 · 다시 표로의 뜻(D2는 순서 칸만 더한다).
- 저장 API(`groups/save`) 요청 모양, 관계 묶음 그래프, 변경 종류 규칙(둘 — v1.2.10), 칸 새 문장 검사(`_link_cell_target`).
- 결과물 A의 줄 차례 · 열, B Flow, C 시트. 문단 Excel 내려받기 주소 두 개(열만 바뀜). 양 단 보기의 Space = Excel A.
- 템플릿 보기 · 클릭 배치(MD 2 S3) · 엮은 문서의 순서 규칙(Order 화면과 같은 서버 규칙).
- 머리말 · 꼬리말 탭, 캡션 묶기 · 떼기 · 첫 행 캡션, 캡션 참조.

## 위험과 시험

**위험**
- **그림 자리 신호(D3)**: Word의 그림 요소가 런 사이 · 글상자 · 칸 안에 있어 자리 셈이 번호 써 넣기 · 공백 처리와 어긋날 수 있다. 합성 docx 세 꼴(문장 가운데 아이콘 · 그림만 든 문단 · 칸 안 그림 · 번호 붙은 문단 안 그림)으로 pytest가 `text[at-2:at+2]`를 본다. 옛 추출은 `anchor = null` 길로만 — 화면이 null을 늘 견딘다.
- **그림이 본문에서 빠지는 영향**: 묶기 틈 · J/K · 캡션 자리 거리(`caption_slot`)가 그림 줄을 이웃으로 썼다. 캡션 자리 판정은 서버 규칙 그대로(본문 표시만 바뀜), 캡션 묶기 단추는 그림 탭 카드에 둔다. 스모크 "caption slot - group a figure…"(`assign.mjs:1020`)를 그림 탭에서 하도록 옮긴다(기대값은 그대로).
- **벗긴 순서의 빌리기 규칙(D2)**: 나눈 조각 · 붙인 줄이 자리를 지키는지 — `unwrap_order` 사례 시험(나누기 · 붙이기 · 다시 표로 → 다시 벗기기 · 되돌리기)을 서버 · 프런트가 같은 `rule-cases.json`으로 본다.
- **칸 잇기 저장(D5)**: 표 전체가 한 관계 묶음이라 칸 하나를 이으면 표의 다른 칸 판단 · 번역 쓸기(`sweep_translations`)가 같이 돈다. pytest가 형제 칸의 글 · 상태 · AI 번역이 그대로인지 본다.
- **통일(D6)**: `new-pane.tsx`(682줄) · `paper.tsx`(1632줄)의 줄 틀을 뽑는다 — 스텝 7은 먼저 부품만 뽑고(그림 · 테스트 id 그대로) 그 뒤 엮은 줄을 옮긴다. 테스트 id(`assign-new-<id>` · `assign-new-slot-<key>` · `assign-new-auto-<key>`)는 지킨다.
- **effect 예산**: 위치 판 미끄러짐 · 손잡이는 CSS · 기존 엔진으로. 새 effect는 `src/lib/use-*.ts`에만.

**바뀌는 스모크(`frontend/scripts/smoke/assign.mjs`) — 기대값은 낮추지 않고 읽는 자리만 바꾼다**
- `:3832` · `:3933` number cell 둘: 입력 상자가 종류 단추 뒤에 있다 — 연속 번호 단추를 누른 뒤 입력(같은 기대), "No number"는 `없음` 단추(`assign-paper-num-kind-none`).
- `:2664` · `:2706` Space preview 둘: 한 단 보기면 문단 Excel(`assign-space-preview` 머리 `Section No.`), 양 단에서 Excel A — 두 단계의 보기 상태를 밝혀 둔다.
- `:610` 문서 대시보드 문단 받기: 받은 파일 머리 줄이 `Section No. | Text | Lang | Number note | Remark`.
- `:1020` 캡션 묶기 · `:2034` New 칸 표 · 그림 · `:6706` AI 그림 제안: 그림을 그림 탭에서 찾는다.
- `:1969` · `:5335` 엮은 New 기본 보기: 칸 머리 · 빈 칸 · 틈을 같은 테스트 id로 찾는다(모양만 바뀜).

**더할 시험**
- pytest: `test_sop_numbering.py`(`get_number_note` — 같음 · 끝 점만 다름 · 번호 없음 · 점 기호, 점 기호가 절 이름을 바꾸지 않음), `test_sop_unwrap.py`(`reorder_unwrapped` — 거절 둘, 판단 걸린 줄도 받음, 다시 표로가 비우고 되돌리기가 살림, 나누기 뒤 자리), `test_migrations.py`(`0034` 왕복), 추출 그림 자리(`test_sop_docx_signals.py`, `tests/docx_factory.py`로 만든 합성 docx 세 꼴), `test_sop_paragraph_excel.py`(열 · 섹션 번호 · 점 기호 위 번호 · 노트 · Remark · 벗긴 줄은 문단 · 미리 보기 = 파일), `test_sop_written.py`(칸 출처 · revision), 칸 잇기 저장(입구 2 칸에 Old 문장 하나 · 둘(합침), 형제 칸 그대로, A Place `Table n · R r C c`), `scripts.dump_rule_cases`(unwrap 순서).
- vitest: `lib/number-kind-model.test.ts`(종류 읽기, 연속 세기 — 앞 번호 없음 · 깊이 · 끝 점 · 점 기호 건너뜀 · 다른 언어 건너뜀, 점 기호 단계), `lib/unwrap-order-model.test.ts`(+ `rule-cases.test.ts`), `lib/unwrap-model.test.ts`(덩이 줄 차례), `lib/paper-model.test.ts`(그림 탭 — 묶음 · 공유 캡션 · 칸 안 그림이 본문에서 빠짐), `lib/figure-spot-model.test.ts`(앞뒤 3줄 · 문서 끝 · 문장 속 자리 · anchor 없음), `lib/space-preview-model.test.ts`(한 단 = 문단, 양 단 = 비교), `lib/composed-model.test.ts`(`buildComposedStrips` — 칸 머리 제목 줄 · 짝 카드 · 빈 칸), `lib/classify-model.test.ts`(칸 잇기 저장 모양).
- 스모크 새 단계(메인 세션): "number cell - bullet • saves at once and indents, Continuous fills 4., a changed number shows Source 3. in the tip" · "unwrap table - the grip moves a line to the top, Undo puts it back, the paragraph Excel follows" · "figures - the Figures tab holds the figure cards, Show position opens the side panel at the spot, Delete folds the card" · "Space preview in one pane shows the paragraph sheet with Section No." · "New table - picking an Old line then a New cell links it, the chip sits on the cell, × unlinks" · "blank template basic view - a slot head is a heading box with its number, the grip moves a line to another slot, Undo".

## 스텝

모음 브랜치 `feat/mockup2`(이 설계 커밋이 있는 브랜치)에서 스텝 브랜치 `feat/mockup2-<n>-<이름>`을 따고, 스텝마다 그 스텝의 diff만 검토해 모음 브랜치에 합친다(루트 `CLAUDE.md` "브랜치에서 다시 브랜치"). 모음 브랜치를 `dev`에 합칠 때 PATCH 하나. 하위 에이전트는 서버 · 브라우저를 띄우지 않고 고친 파일의 단위 시험(pytest · vitest 한 파일) · ruff · lint · tsc까지, 스모크는 메인 세션이 스텝을 합친 뒤 고친 화면만(`ONLY="assign:"`). 화면 · 라벨이 바뀌는 스텝은 `frontend/public/manual/user-manual.md`의 그 조각 글과 `docs/qa/feature-map.md`를 같은 커밋에서. 새 거절 코드는 `rule.<code>` en · ko를 같은 커밋에서.

**같이 고치는 큰 파일**: 아래 "공용 파일"은 여러 스텝이 서로 다른 자리에 **더하기만** 하므로 병렬 스텝이 함께 고쳐도 된다 — 합칠 때 겹치면 둘 다 살린다: `lib/api-sop.ts`(서로 다른 interface · 함수), `routers/sop_documents.py`(서로 다른 응답 클래스 · 엔드포인트), `lib/i18n-messages.ts`(스텝마다 제 접두), `styles/components.css`(제 블록), `user-manual.md`(제 조각), `docs/qa/feature-map.md`, `PROGRESS.md`. 그 밖의 코드 파일은 병렬 스텝끼리 겹치지 않게 나눴다.

1. **`feat/mockup2-1-number-kind`** — 번호 칸에 종류 단추(연속 · • ○ ▪ · A-1 직접 · 없음)를 두고, 원문과 다르게 고친 번호를 노트로 보인다.
   파일: backend `numbering.py`(`get_number_note`, `is_number_fixed` 위로), `editing.py`(`_plan_set_number` 기호 줄), `routers/sop_documents.py`(`ViewNumberOut.note`), pytest. frontend `lib/number-kind-model.ts`(+test), `lib/strip-pill-model.ts`(점 기호 단계), `components/paper/number-cell.tsx`, `components/paper/paper.tsx`(번호 칸에 연속 값 · 형제 넘기기만), 공용 파일.
   확인: pytest `test_sop_numbering.py`, vitest, 스모크 number cell 두 단계 + 새 단계.
2. **`feat/mockup2-2-figure-anchor`** — 추출기 7이 문장 속 그림의 글자 자리를 남기고 문서 보기가 그림 블록의 `anchor`를 싣는다(화면 변화 없음).
   파일: backend `extract/docx_reader.py`, `extract/types.py`(버전 · docstring), `segment.py`(자리 셈 도우미가 필요하면), `routers/sop_documents.py`(`ViewBlockOut.anchor`), 합성 docx 픽스처 · pytest, 공용 `api-sop.ts`(`ViewBlock.anchor?`).
   확인: pytest 추출 · 문서 보기, ruff.
3. **`feat/mockup2-3-cell-link`** — Old 줄을 고른 뒤 New 표의 칸을 누르면 그 칸에 잇고, A 시트 Place가 칸 자리를 적는다.
   파일: backend `written.py`(`BundleCellOut`), `outputs.py`(`_format_target_location`), pytest(저장 · A Place). frontend `components/assign/new-bundle.tsx`, `components/assign/new-pane.tsx`(칸 칩 · 칸 누르기 넘기기), `lib/classify-model.ts`(+test), `app/bundles/[id]/assign/use-assign-page.tsx`(칸 고르기 → 잇기), `page.tsx`(NewPane 속성), `lib/assign-drop-model.ts`(칸 놓기), 공용 파일, 설명서.
   확인: pytest, vitest, 스모크 새 단계 "New table - … links it".
4. **`feat/mockup2-4-unwrap-order`** — 벗긴 표 안 줄을 손잡이로 끌어 차례를 바꾸고 용지 · J/K가 그 차례를 따른다.
   파일: backend Alembic `0034`, `models.py`, `unwrap_order.py`, `editing.py`(op · 다시 표로 비우기 · 판단 검사 예외), `routers/sop_documents.py`(`ViewUnitOut.unwrap_seq`), `scripts/dump_rule_cases.py`, pytest. frontend `lib/unwrap-order-model.ts`(+test), `lib/unwrap-model.ts`(+test), `lib/rule-cases.json`, `components/paper/paper.tsx`(손잡이), `use-assign-page.tsx`(손잡이 config — `pairGrip` 옆), `lib/assign-focus-model.ts`(`reorder`), 공용 파일(`rule.table_not_unwrapped` · `rule.unwrap_lines_mismatch`), 설명서.
   확인: pytest · Alembic 왕복, vitest(+ `rule-cases.test.ts`), 스모크 새 단계 "unwrap table - the grip moves a line…".
5. **`feat/mockup2-5-figure-tab`** — 그림을 본문에서 빼 **그림 n** 탭으로 옮기고, 카드의 위치 보기 판 · 지우기를 둔다(Old · 이미 쓴 New).
   파일: `lib/paper-model.ts`(+test, `figures` 탭), `lib/figure-spot-model.ts`(+test), `components/paper/part-tabs.tsx`, `components/paper/figure-tab.tsx`(새), `components/assign/figure-spot-panel.tsx`(새), `components/assign/old-pane.tsx`, `components/paper/paper.tsx`, `components/assign/new-pane.tsx`(양 단 New 칸 탭), `use-assign-page.tsx`(카드 고르기 · 지우기 · 판 상태), 공용 파일, 설명서. **`page.tsx`는 고치지 않는다**(탭 키는 `partKeys`로, 판은 `old-pane` 안에서) — 고쳐야 하면 스텝 6 뒤로.
   확인: vitest, 스모크 바뀌는 그림 단계 셋 + 새 단계 "figures - …".
6. **`feat/mockup2-6-paragraph-sheet`** — 문단 Excel을 섹션 번호 | 내용 | 언어 | 번호 노트 | Remark로 바꾸고 한 단 보기 Space가 그 미리 보기를 보인다.
   파일: backend `paragraph_excel.py`(시트 모델 · 벗긴 순서 · 섹션 번호), `numbering.py`(`build_section_numbers` — 스텝 1 뒤라 겹치지 않음), `excel_export.py`(시트 쓰기 재사용이 모자라면), `routers/sop_documents.py`(미리 보기 엔드포인트), pytest. frontend `components/assign/space-preview.tsx`, `lib/space-preview-model.ts`(+test), `page.tsx`(`SpacePreview` 요소 `:441-450`만), 공용 파일, 설명서.
   확인: pytest `test_sop_paragraph_excel.py`, vitest, 스모크 Space 두 단계 · 문서 대시보드 받기 + 새 단계.
7. **`feat/mockup2-7-template-paper`** — 빈 템플릿 기본 보기를 Old · New와 같은 용지(제목 박스 · 짝 카드 · 출처 칩 · 번호 칸 종류)로 그리고 손잡이로 순서 · 칸을 옮긴다.
   파일: `components/paper/strip-box.tsx`(새, 줄 틀 뽑기), `components/assign/new-pane.tsx`, `lib/composed-model.ts`(+test), `lib/use-composed-order.ts`(새 — `c-edit-model` · `c-save-queue`를 엮은 문서에 거는 훅, `page.tsx`에서 부른다), `page.tsx`(NewPane 속성 · 훅), `components/paper/number-cell.tsx`(C 번호 표시 모드 — 스텝 1 뒤), CSS, 설명서. **`use-assign-page.tsx` · `paper.tsx`는 고치지 않는다**(필요하면 스텝 4 · 5 뒤로).
   확인: vitest, 스모크 `:1969` · `:5335` + 새 단계 "blank template basic view - …".

**병렬 묶음(동시에 최대 3, 각자 워크트리 — 공용 파일 말고는 겹치지 않음)**
- **묶음 A — 1 · 2 · 3 동시.** 1은 `paper.tsx` · `number-cell.tsx` · 번호 backend, 2는 추출기, 3은 New 칸 · `use-assign-page.tsx` · `page.tsx` · `written.py` · `outputs.py`.
- **묶음 B — 4 · 7 동시**(A가 모음 브랜치에 합쳐진 뒤). 4는 `paper.tsx` · `use-assign-page.tsx` · `editing.py`(1 뒤), 7은 `new-pane.tsx`(3 뒤) · `number-cell.tsx`(1 뒤) · `page.tsx`(3 뒤).
- **묶음 C — 5 · 6 동시**(B 뒤). 5는 그림 탭 · `paper.tsx` · `use-assign-page.tsx` · `new-pane.tsx`(4 · 7 뒤) · anchor(2 뒤), 6은 `paragraph_excel.py`(4의 `unwrap_seq` 뒤) · 노트(1 뒤) · `page.tsx`의 Space 요소만.
- 묶음마다 끝에 메인 세션이 모음 브랜치에서 스모크 `ONLY="assign:"`(+ 6 뒤 `documents:` 문단 받기). 공용 부품(`paper.tsx` 줄 틀, 스텝 7)을 고친 묶음 B 뒤에는 `assign` 전체.

## 확인할 것

1. **"비교 엑셀 B가 칸마다 출처"의 B** — 지금 Excel B는 Flow(요약 숫자 · 건수 표 · 흐름도)라 칸 출처를 담을 자리가 없다. 기본안: **A Comparison의 Place**에 `… · Table n · R r C c`를 적고(D5), C 시트는 이미 칸 줄마다 `Old units`다. B Flow는 그대로.
2. **문단 Excel의 아직 표인 데이터 표** — 고정 다섯 열이라 칸을 옆 열로 둘 수 없다. 기본안: 표 한 행 = 한 줄, 내용 = 칸 글을 ` | `로 이음, 섹션 번호 = 앞 번호. `tables=false`면 지금처럼 뺀다. 다른 안: 칸마다 한 줄.
3. **이미 쓴 New 한 단 보기의 Space** — 결정은 "한 단 보기 = 문단 엑셀"이다. 기본안: Old 한 단 · 이미 쓴 New 한 단 둘 다 그 문서의 문단 Excel(빈 템플릿은 단위가 없어 꺼짐).
4. **벗긴 순서가 결과물 A 줄 차례를 바꾸나** — 기본안: 바꾸지 않는다(A는 원문 자리 순이고 Location이 `표 n · r행 c열`을 적는다). 용지 · J/K · Shape · 문단 Excel · Space만 따른다.
5. **빈 템플릿에서 나누기 · 붙이기 · 짝 맺기 · 글 고치기** — 시안의 비교 표는 셋 다 "같음"이고 빈 템플릿만 "글 고치기 됨"이라 했다. 엮은 문서의 박스는 새 문장이라 Old 편집 op가 닿지 않는다. 기본안: 시안 2에서는 글 고치기 = 결정 칸의 New 글 칸(지금 길), 나누기 · 붙이기 · 짝은 지금 길(결정 칸 · 잇기 메뉴) 그대로 두고, 용지 위 같은 단추(두 번 누르기 나누기 · 틈 붙이기 = 새 문장 둘로 · 하나로의 묶음 저장)는 써 본 뒤 스텝 8로 따로 정한다.
6. **문단 Excel의 그림 줄** — 그림은 화면 본문에서 빠지지만 Excel은 Word 복사본 성격이다. 기본안: 원래 자리에 `[Figure] 캡션` 한 줄을 남긴다(지금처럼).
