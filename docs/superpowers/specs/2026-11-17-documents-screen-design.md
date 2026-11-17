# Documents 화면 설계 — 두 줄 목록 · WI를 SOP에 끌기 · 올리기 묶음 · N/A 칸 상태 표

2026-11-17. 사용자가 정한 것은 날짜와 함께, 내가 정한 것은 "내 판단"으로 적는다. 사용자는 이 문서를 미리 검토하지 않고 열린 결정마다 추천안으로 진행하라고 했다(2026-11-17). 그래서 결정은 모두 이 문서 안에서 내렸고, 뒤집을 수 있게 까닭을 붙였다. 직접 끌어 보는 시안은 비공개 디자인 세션 산출물이라 저장소에 두지 않는다. 번호·이름 예시는 모두 지어낸 값이다. 조사 기준은 `feat/assign-drag-send` `9b1551b`(dev `73ef1ec` v1.1.6 위)이고, Documents 화면의 파일은 dev와 같다.

2026-11-16에 정한 세 설계 가운데 둘째다. 첫째는 [끌어다 놓기 설계](2026-11-16-drag-and-drop-design.md)이고 그 문서의 4절(공통 끌기 규칙 G1~G13)과 끌기 층(`frontend/src/lib/box-drag.ts`·`use-box-drag.ts`)을 그대로 쓴다. 셋째(참조 지도)는 따로 쓴다.

## 1. 왜

Documents 화면은 목록 둘이다. 위는 Old 문서(`app/bundles/[id]/documents/page.tsx`의 `DataList` 표), 아래는 New 문서(`components/tobe/tobe-section.tsx`의 표). 올리기는 창 하나(`components/documents/upload-modal.tsx`)다.

- **줄이 양식처럼 보인다.** Old 줄에는 번호 입력, 버전 입력, 제목 입력, 언어 배치 고르기가, New 줄에는 번호 입력, 제목 입력, 종류 고르기, 상위 SOP 고르기, 장비 SOP 체크가 늘 열려 있다. 읽을 값(번호·제목)이 테두리 속에 묻힌다. 번호와 제목은 등록할 때 한 번 적고 그 뒤로는 읽기만 하는 값이다.
- **제목이 잘리는데 줄에는 빈 자리가 남는다.** New 표는 아홉 열이 폭을 나눠 가져 제목 열이 196px(좁으면 156px)에서 시작한다. Old 표는 본문이 1230px보다 좁으면 뒤쪽 네 열을 한 열로 접는다(`TRAIL_WRAP_BELOW`).
- **되풀이되는 정보.** 정상 상태(Ready·Checked)가 줄마다 자리를 차지하고, 딸린 정보(파일 이름·EQUIS·경고)는 칸마다 흩어져 있다.
- **SOP와 WI의 관계가 약하다.** WI는 번호 칸이 16px 들어가 있을 뿐이다. 상위 SOP를 바꾸려면 줄마다 고르기 칸을 연다.
- **N/A: 체크의 뜻이 뒤집혀 있다.** 펼친 줄의 체크 목록에서 체크는 "이 칸이 없다"는 뜻이다. 체크는 보통 "있다"로 읽힌다.
- **N/A: 정할 근거가 화면에 없다.** 칸에 문장이 있는지 모른 채 체크하고, 문장이 든 칸이면 사유까지 적은 뒤에야 서버가 거절한다(409 `slot_has_targets`). 장비 SOP에서 채우거나 N/A로 남겨야 하는 세 칸(6.2·6.3·6.4)은 Overview의 알림에만 나온다.
- **N/A: 저장이 조용히 사라진다.** 사유를 적다가 칸을 떠나면 체크가 말없이 풀린다(`CommitInput`의 `onEmpty`).
- **N/A: 목록에서 안 보인다.** 줄에는 "N/A: 1"만 있다.
- **번호로 더하는 칸이 표의 맨 아래에 있다.** 문서가 많으면 멀다. 적는 동안 무엇이 더해질지(종류, 어느 SOP 아래인지) 알 수 없다.
- **올리기 창의 줄이 한 줄에 다 있다.** 파일 이름, Old | New, 만들 문서, 빼기가 한 줄에 놓여 긴 파일 이름이 나머지를 민다. Old와 New가 섞여 있어 "무엇이 어디로 가는지"를 줄마다 읽어야 한다. 창 안에는 파일을 놓을 자리가 없다.

사용자 결정(2026-11-16): **문서 목록은 두 줄로 정리한다. N/A 처리는 시안의 "칸 상태 표" 방향으로 간다.** Documents의 번호와 제목은 **줄은 읽기, 펼치면 고치기**로 한다. 줄 끝 단추를 호버·포커스 때만 보이는 것은 Order와 Documents에만 적용한다. 사용자 요청(2026-11-17 인수인계): 두 줄 목록, WI → SOP 끌기, 올리기 묶음, N/A 칸 상태 표. **칸별 문장 수는 서버가 내려 준다.**

## 2. 목표 · 비목표 · 반목표

**목표**

1. Old 목록과 New 목록의 줄을 **두 줄**(제목 줄 + 딸린 정보 줄)로 읽게 한다. 값은 글자로 보이고, 고치는 칸은 줄을 펼친 곳에 둔다.
2. New 목록에서 **WI 줄을 SOP 줄에 끌어** 상위 SOP를 정한다. 같은 일을 하는 고르기 칸은 펼친 곳에 남는다(G12).
3. **N/A 칸 상태 표.** SOP의 칸 15개마다 지금 상태(문장 수, Empty, N/A)를 먼저 보이고 **Mark N/A** · **Edit reason** · **Restore**로 정한다. 저장과 취소는 사람이 끝낸다. 줄에는 칸 상태 요약이 보인다.
4. **올리기 묶음.** 올리기 창의 파일을 Old 묶음과 New 묶음으로 나눠 보이고, 줄마다 두 줄(파일, 올리면 생기는 일)로 정리한다. 줄을 끌거나 파일을 묶음에 놓아 쪽을 정한다.
5. 서버가 **칸별 문장 수**를 New 목록 응답에 싣는다(10절). 스키마 변경은 없다.

**비목표** (이번에 하지 않는다)

- New 문서의 순서 바꾸기, WI step의 순서 바꾸기(끌어다 놓기 시안의 "보류" — `DocPatchIn`에 `order_index`가 없고 step 번호는 기본 키다).
- 상위 SOP가 없는 WI를 허용하기. 서버 규칙(422 `invalid_parent`)과 제품 명세 §6.6("WI라면 부모 SOP, 필수")을 그대로 둔다(6절).
- 여러 WI를 한 번에 끌기. 한 줄씩 끈다.
- 터치 화면의 끌기. 터치에서는 단추·고르기 칸만 쓴다(끌기 층이 터치 누름을 받지 않는다).
- Old 줄에 Unit 수 보이기(15절).
- Excel 템플릿·가져오기, AI로 목록 읽기(`list-reader.tsx`), EQUIS 조회의 동작. 자리만 새 줄 모양에 맞춘다.
- 상위 칸에 직접 놓인 줄의 번호(7.1…)가 하위 칸 제목 번호와 겹치는 문제. 사용자 답을 기다리는 중이라 이 설계는 건드리지 않는다.

**반목표** (되면 실패)

- 지금 할 수 있는 일이 하나라도 사라진다 — 번호·버전·제목·언어 배치·종류·상위 SOP·장비 SOP 고치기, AI·EQUIS 제안 받기, 미리 보기·내려받기·지우기, Assign으로 열기, 단계 더하기·빼기·이름 고치기.
- 끌기로만 할 수 있는 일이 생긴다(G12).
- AI나 화면이 빈 칸을 스스로 N/A로 채운다(도메인 규칙 RW02). N/A는 사람이 사유와 함께 저장할 때만 생긴다.
- 적던 N/A 사유가 저장도 취소도 아닌 채 사라진다.
- 극단 자료(100자 번호, 480자 제목, 공백 없는 435자 제목, 255자 파일 이름, 1,990자 사유)에서 줄이 옆으로 넘치거나 줄 끝 단추가 글을 덮는다.
- 읽기 전용(검토자, `in_review`·`done` Bundle)에서 끌기가 시작되거나 고치는 단추가 보인다(G13).

## 3. 조사로 확인한 것

**화면**

- **바뀌는 화면은 Documents 하나다.** `/bundles/{id}/tobe`는 `/documents#new-documents`로 넘기는 옛 주소일 뿐이다(`app/bundles/[id]/tobe/page.tsx`). 시안의 "Documents" 그림은 이 화면의 두 목록과 올리기 창이고, "N/A 칸 상태 표"는 New 목록의 SOP 줄을 펼친 곳이다.
- **Old 목록**은 `DataList` 표다. 열: (줄 없는 New 파일이 있을 때만) Side, Doc no.(`InlineText`), Version(`VersionInput`), Title(`InlineText`, 누르면 그 문서를 Assign 한 단 보기로 연다 — `getEditOriginalHref`), Language layout(`Select` 고정 178px), Extraction · Aux check · Warnings · 줄 단추. 줄 단추는 늘 흐린 `.row-actions-quiet`(Preview · Download · Delete)다. AI가 읽는 중 표시, 빈 번호·버전의 AI 제안(`AiSuggestChip`), 빈 버전의 EQUIS 제안, 제목 잠금(`TitleLock`), EQUIS 표시(`EquisStatus`)가 칸 안에 있다. 받지 못한 파일은 제목 아래 빨간 글(`getDocReason`)이다.
- **New 목록**은 `tobe-section.tsx`의 표(`data-testid="tobe-list"`)다. 줄 순서는 `lib/tobe-draft.ts` `orderDocs`(SOP마다 그 아래 WI, 부모를 못 찾은 WI는 끝). 칸마다 바로 저장한다 — `runWrite`가 줄 쓰기 응답(새 목록 전체)을 `fresh`로 얹는다. 펼친 줄(`CollapseRow`): SOP는 N/A 체크 목록(`Checkbox` + 사유 `CommitInput`, `pendingNa`), WI는 단계 목록. 쓴 파일이 붙은 줄은 번호·종류가 잠기고 줄을 뺄 수 없다(`entrance === "match"`).
- **번호로 더하기**는 표 맨 아래 줄(`tobe-add-row`)이다. 종류와 상위 SOP는 `lib/tobe-add-model.ts` `planAddRows`가 정한다 — WI는 그 앞에서 가장 가까운 SOP 아래로, 목록에 SOP가 없으면 SOP로 더한다("상위 없는 WI는 서버가 받지 않는다").
- **올리기 창**은 두 국면이다. 고르는 국면(`upload-picked`): 줄마다 파일 이름, Old | New(`upload-side`), 만들 문서(`renderPlan` — `lib/upload-model.ts` `planNewUpload`의 attach·create·blocked), 빼기. **Choose files** 는 고른 목록을 통째로 바꾼다. 올리는 국면(`upload-results`): 네 열 표(파일·번호·버전·언어 배치), 파일을 하나씩 차례로 올린다(서버 파싱 자리가 둘이다). Old 파일은 읽힌 뒤 그 자리에서 번호·버전·언어 배치를 고친다(출처 표 `src-badge`). 화면 아무 데나 파일을 놓으면 창이 그 파일을 담아 열리지만, **창이 열린 뒤에는 파일을 받지 않는다**(`canDrop = canEdit && uploading === null`).
- **끌기 층이 이미 있다.** `attachBoxDrag`·`useBoxDrag(rootRef, config | null)`. 끌 상자는 `[data-drag-box]`, 끌기를 시작하지 않는 것은 `DRAG_GUARD_SELECTOR`(`button, a, input, select, textarea, [role='slider'], [data-no-drag]`), 끌려가는 표는 `DragCard {id, text, count}`, 놓을 자리 판정은 `onMove`가 돌려주는 `DragHover {state: "ok" | "refused" | "none", note, target}`다. 표 한 장(`.drag-card`)의 `z-index`는 80이라 창 위에 뜬다. 자리 바꿈은 `components/ui/motion.tsx` `useFlip`, 옮겨 간 줄 강조는 `[data-flash]`다.
- **알림에는 단추가 없다.** `components/ui/toast.tsx` `showToast(text, tone)`. 끌어다 놓기 설계 4걸음(Pair view)이 알림의 Undo를 쓰기로 했지만 아직 만들지 않았다.
- **극단 자료**: `backend/scripts/seed_sop_worst.py` `build_w1_tobe`가 SOP 30개·WI 22개를 더한다 — 번호 100자, 제목 480자·공백 없는 435자·빈 것, WI 단계 0~40개, 긴 N/A 사유.

**서버**

- **New 목록 응답**은 `GET /api/bundles/{id}/tobe`의 `ToBeViewOut`(`routers/sop_tobe.py`)이고, 줄 쓰기(더하기·빼기·고치기·N/A·단계)가 모두 같은 모양을 돌려준다. `sentence_counts`는 `count_targets_by_step`이 **(문서, WI 단계)별로** 센 것이다 — SOP는 문서마다 한 줄(`wi_step: null`)뿐이라 **칸별 수가 없다.** 쓰는 곳은 Assign의 보낼 곳 지우기 잠금(`lib/destination-manage-model.ts`)과 올리기 창의 "문장이 든 줄" 판정(`.some`, 문서 id 집합)이다.
- **N/A 쓰기**: `PUT …/tobe/docs/{id}/na/{slot_key}` `{reason}`(1~2,000자), `DELETE` 같은 주소. 문장이 든 칸은 409 `slot_has_targets`(`sop/tobe.py` `_find_blocked_slots`) — **그 칸과 하위 칸에 `slot_key`가 있는 새 문장 줄이 하나라도 있으면** 막는다(`is_within_slot`). 상태를 가리지 않는다(AI 제안·보류 줄도 센다, 제품 명세 §6.6). 칸 제목에 이은 옛 제목(`kind = slot_heading`)도 `slot_key`가 있는 줄이라 막힌다.
- **결과물과 검토는 칸 제목을 "칸을 채운 것"으로 치지 않는다.** `outputs._plan_sections`는 `kind != slot_heading`이고 `parent_target_id IS NULL`인 줄만 칸의 항목으로 그리고, `review._list_equipment_notices`도 칸 제목을 빼고 본다("칸 제목은 칸 항목이 아니라 칸을 채우지 않는다"). 그래서 "막힘"과 "채움"이 한 경우(칸 제목만 이어진 칸)에 갈린다(8절).
- **상위 칸 N/A는 하위 칸을 덮는다**(`outputs._find_na_reason`, 도메인 규칙). 칸 번호는 `SLOT_KEYS`의 고정 자리라 N/A로 바꿔도 다른 칸 번호가 그대로다(`outputs._build_slot_numbers`). N/A 사유는 결과물 C에 "N/A · 사유"로 나온다(`outputs/output-c.tsx`). AI 후보는 N/A 칸을 건너뛴다(`sop/ai/candidates.py`).
- **장비 SOP의 세 칸**(`EQUIPMENT_SLOT_KEYS` — 6.2·6.3·6.4)이 항목도 N/A도 없으면 검토 조건에 알림 `equipment_sop_empty_slots`가 뜬다. 막지는 않는다.
- **이미 쓴 SOP(entrance `match`)의 문장에는 `slot_key`가 없다.** 결과물은 절 경로(`section_path`)로 칸을 짓고 N/A 사유를 찍지 않는다. 그런데 N/A 쓰기는 지금도 되고, 장비 SOP 알림은 그 세 칸을 빈 칸으로 본다. 원래 있던 어긋남이다(15절).
- **상위 SOP 바꾸기**: `PATCH …/tobe/docs/{id}` `{parent_code}`(`DocPatchIn`, 보낸 칸만 바꾼다, revision을 묻지 않고 묶음을 잠근다). WI의 부모가 없거나 SOP가 아니면 422 `invalid_parent`. 문장이 든 WI도, 쓴 파일이 붙은 WI도 부모를 바꿀 수 있다(막는 검사가 없고 지금 화면의 고르기 칸도 잠그지 않는다). 부모는 결과물의 묶기(`outputs.py`)와 AI 문맥에 읽을 때마다 반영된다.
- **Old 목록 응답**(`DocumentOut`)에는 문서별 Unit 수가 없다.

## 4. 공통 — 줄 모양, 펼치기, 줄 끝 단추

두 목록이 같은 줄 틀을 쓴다. 표(`<table>`)가 아니라 줄 상자의 목록이다(내 판단 — 두 줄 줄은 열 머리가 필요 없고, 긴 글이 옆 열의 폭을 빼앗는 표의 문제(`docs/lessons/ui-review.md` 7·10번)가 사라진다).

- **줄의 세 자리**: 왼쪽 **식별**(번호와 그 아래 한 줄), 가운데 **본문**(제목 줄 + 딸린 정보 줄), 오른쪽 **끝**(상태 + 줄 끝 단추). 격자 열은 `식별 고정 폭 · minmax(0, 1fr) · auto`다. 본문 자식은 `min-width: 0`.
- **제목 줄**: 제목을 **두 줄까지** 보이고 넘으면 자른다(`ClampText` — 잘렸을 때만 전체 글이 툴팁에 뜨고 포커스로도 닿는다). 공백 없는 글은 `overflow-wrap: anywhere`. 빈 제목은 흐린 글 한 줄이다.
- **딸린 정보 줄**: **한 줄**이고 접히지 않는다. 자리가 모자라면 정해진 순서로 줄어든다(5·6절). 그래서 줄 높이는 제목이 한 줄이냐 두 줄이냐로만 달라지고, 호버로는 변하지 않는다.
- **번호**: 고정폭 글꼴, 두 줄까지 접고(`overflow-wrap: anywhere`) 넘으면 자른다. 전체 번호는 툴팁과 펼친 곳에 있다. 식별 자리의 폭은 14자 번호(`SOP-CDO-111334`)가 한 줄에 들어가는 폭을 지킨다(지금 164px).
- **줄을 누르면 펼친다.** 줄 어디를 눌러도(단추·링크·입력 밖) 그 줄 아래에 고치는 곳이 열리고 다시 누르면 닫힌다. 줄은 `tabIndex=0`이고 <kbd>Enter</kbd>·<kbd>Space</kbd>로도 펼친다(`lib/row-open.ts` `getRowOpenProps`). 줄 머리에 화살표 단추(`aria-expanded`)를 둔다. 글자를 긁고 뗀 것은 펼침으로 치지 않는다. 여러 줄을 함께 펼쳐 둘 수 있다(지금과 같다).
- **펼친 곳에서는 지금처럼 칸마다 바로 저장한다**(글 칸은 떠나거나 <kbd>Enter</kbd>, 고르는 칸은 고르는 즉시, <kbd>Esc</kbd>는 적던 것을 버린다). N/A 사유만 예외다(8절). 저장 중 표시(**Saving...**)와 거절 알림은 지금 그대로다.
- **줄 끝 단추는 호버·포커스 때만 보인다**(사용자 결정 2026-11-16). 넓으면 줄 오른쪽 끝에 아이콘 단추 묶음, 좁으면 **⋯** 단추 하나가 같은 동작을 메뉴(`components/ui/menu.tsx`)로 연다. `(hover: none)`에서는 늘 보인다. 메뉴가 열려 있는 동안에는 그 줄의 단추가 남는다.
  - 묶음의 자리(아이콘 셋, 80px)는 **늘 비워 둔다**(내 판단). 비우지 않으면 단추가 상태 표시를 덮고, 비워도 잃는 폭이 80px뿐이라 제목이 일찍 접히지 않는다. Order가 단추를 용지 밖에 띄운 것은 단추가 일곱 개(184px)였기 때문이다. 좁을 때는 ⋯ 하나(24px) 자리만 비운다.
  - 넓음·좁음은 창이 아니라 **목록 틀의 폭**으로 가른다(`useElementWidth` 또는 컨테이너 질의). 경계값은 구현에서 극단 자료를 띄워 잰 뒤 정한다(시안 값 880px).
  - `docs/lessons/ui-review.md` 13번과 디자인 기초 11절의 "Documents는 Documents 화면 설계에서 적용한다"를 이 절을 가리키게 고친다.
- **상태는 예외만 글자로.** 정상(Ready, Checked)은 아이콘 하나(툴팁과 `aria-label`에 뜻), 살펴야 할 것(Rejected, Failed, 보조 검사 불가, 경고 수)만 알약이다(디자인 기초 11절 그대로).
- **읽기 전용**: 줄은 펼쳐지고 값은 글자로만 보인다. 고치는 칸·단추·끌기가 없다. 미리 보기와 내려받기는 남는다.
- **목록 머리**: 이름 옆에 줄 수를 적는다(**Old documents** 5). 지금의 설명 글 한 줄은 남긴다.

## 5. Old 문서 목록

| 자리 | 보이는 것 |
|---|---|
| 식별 | 문서 번호. 그 아래 버전(`v1.0`) |
| 본문 · 제목 줄 | 제목. EQUIS가 정한 제목이면 자물쇠(`TitleLock`), EQUIS 원본 링크 아이콘(`EquisLink`) |
| 본문 · 딸린 정보 줄 | 언어 배치(그림 + 이름) · 파일 이름 · EQUIS 표시(`EquisStatus`) |
| 끝 | 경고 수 칩 · 보조 검사(예외만) · 추출 상태(정상은 아이콘) · 줄 끝 단추(**Preview** · **Download** · **Delete**) |

- **Old 표시는 줄에서 뺀다.** 묶음 머리(**Old documents**)가 말한다. 읽지 못해 New 목록 줄이 생기지 않은 New 파일(`side === "new"`, `target_doc_id === null`)만 지금처럼 이 목록 끝에 남고, 그 줄에만 **New** 표시를 붙인다(지울 수 있게).
- **제목은 링크로 남긴다**(내 판단). 누르면 그 문서가 Assign 한 단 보기로 열린다(지금과 같다 — 가장 자주 쓰는 길이고 설명서·스모크가 이 길을 쓴다). 줄의 나머지를 누르면 펼쳐진다. 읽지 못한 문서의 제목은 링크가 아니다.
- **빈 값은 예외로 보인다.** 번호가 없으면 **No number**, 버전이 없으면 **No version**(버전이 비면 검토 조건 `missing_doc_versions`가 막으므로 호박색 알약), 제목이 없으면 **No title**. 빈 번호·버전에 AI 제안이나 EQUIS 제안이 있으면 그 자리 바로 옆에 지금의 제안 칩(`AiSuggestChip`, EQUIS 칩)을 둔다 — 누르면 저장된다(지금과 같다). AI가 읽는 중이면 번호 옆에 도는 표시.
- **받지 못한 파일**(Rejected · Failed): 번호·버전·언어 배치가 없고, 딸린 정보 줄 아래에 까닭 한 줄(`getDocReason`, 빨간 글)이 붙는다. 끝에는 **Rejected** 알약과 **Delete** 만 있다.
- **딸린 정보 줄이 좁을 때**: 파일 이름이 먼저 줄어든다(가운데 말줄임 `lib/truncate-middle.ts`, 최소 96px, 전체 이름은 툴팁). 그다음 EQUIS 표시가 아이콘만 남는다(`compact`). 언어 배치는 줄이지 않는다(가장 긴 "KO/EN interleaved"가 136px).
- **펼친 곳**(고치는 칸, 지금 줄에 있던 것 그대로): **Doc no.**(`InlineText`가 아니라 `CommitInput`), **Version**(`VersionInput`), **Title**(EQUIS가 잠그면 읽기 전용 + 자물쇠), **Language layout**(`Select`). 그 옆에 EQUIS에서 받은 정보(지금 `EquisStatus`를 눌러 펼치던 것 — **Look up again**, **Use current number** 포함)와 경고 목록(`WarningChips`). 줄에서 번호·버전을 바로 고치는 길은 없앤다(사용자 결정 2026-11-16 "줄은 읽기, 펼치면 고치기". 시안은 버전과 언어 배치를 줄에서 고치는 칩처럼 그렸지만 줄에 고치는 칩이 섞이면 "양식처럼 보인다"가 되돌아온다 — 내 판단).
- 끌기는 없다. Old 줄은 끌 상자가 아니라 글자가 그냥 긁힌다.

**극단 자료에서**(1120 폭): 100자 번호는 식별 자리에서 두 줄로 접히고 잘린다. 480자 제목은 두 줄에서 잘린다. 공백 없는 435자 제목도 같은 폭에서 접힌다. 255자 파일 이름은 가운데가 줄어 확장자가 보인다. 줄의 어느 것도 목록 틀 밖으로 나가지 않고 줄 끝 단추 자리는 줄마다 같은 오른쪽 끝이다.

## 6. New 문서 목록

**머리와 등록 칸**

- 머리: **New documents** + 줄 수 + 설명 한 줄 + 저장 중 표시 + AI 제안 단추(있을 때) + **⋯**(Excel 템플릿·가져오기·AI 읽기, 지금 그대로).
- **번호로 더하는 칸을 머리 바로 아래로 올린다.** 번호를 적는 동안 **무엇이 더해질지**를 칸 옆에 적는다 — `planAddRows`의 결과를 그대로 읽어 적으므로 미리 보기와 실제가 어긋나지 않는다.
  - 한 줄: "Adds WI `WI-09` under `SOP-PH`", "Adds SOP `SOP-MX`".
  - 목록에 SOP가 없는데 WI 번호를 적으면: "No SOP on the list yet, so `WI-09` is added as an SOP"(`planAddRows`가 지금 그렇게 한다).
  - 이미 있는 번호: "`WI-04` is already on the list"(더하기 단추가 꺼진다).
  - 여러 줄을 붙여 넣으면 지금처럼 바로 줄마다 더한다.
  - 더한 줄은 잠깐 강조되고(`[data-flash]`) 화면 밖이면 그쪽으로 스크롤한다. 포커스는 칸에 남는다.
- 시안은 상위 SOP 없이 WI를 더하고 "끌어서 SOP에 놓으라"고 안내했다. **그 상태는 만들지 않는다**(내 판단). 서버가 상위 없는 WI를 받지 않고(422 `invalid_parent`), 제품 명세 §6.6이 부모를 필수로 정했으며, 상위 없는 WI는 결과물 묶기와 AI 문맥에서 따로 다뤄야 한다. 앱이 가장 가까운 SOP 아래로 먼저 두고 사람이 끌어 고치는 지금 방식이 손길도 같다. 부모를 못 찾은 WI가 응답에 오면(있어서는 안 되는 자료) 목록 끝에 **No parent SOP** 묶음으로 보이고 줄에 호박색 알약이 붙는다 — `orderDocs`가 지금도 그런 줄을 끝에 둔다.

**줄**

| 자리 | SOP 줄 | WI 줄 |
|---|---|---|
| 머리 | 펼침 화살표 | 펼침 화살표 |
| 식별 | **SOP** 표 + 번호 + EQUIS 아이콘(`EquisStatus compact`) | **WI** 표 + 번호 + EQUIS 아이콘 |
| 본문 · 제목 줄 | 제목(없으면 **No title yet**), 잠겼으면 자물쇠 | 같다 |
| 본문 · 딸린 정보 줄 | 칸 상태 막대 · "7 of 15 sections filled" · **N/A** 2 + 첫 N/A 칸 이름(+1) · "2 to decide"(장비 SOP) · **Not written** 또는 쓴 파일 · **Equipment SOP** | 쓴 파일 이름 + 버전(없으면 **Not written**) · "Steps 3" |
| 끝 | 줄 끝 단추: **Edit**(펼친다) · **Remove** | 같다 |

- **SOP 줄은 바탕으로 구분하고**(`--sunken` 계열 옅은 바탕), **WI 줄은 그 아래에 들여 나무 선으로 묶는다.** 줄 순서는 지금과 같다(`orderDocs`).
- **칸 상태 막대**: 칸 15개를 작은 눈금 15개로 그린다(하위 칸은 낮은 눈금). 상태는 색만으로 가르지 않는다 — 문장 있음(채운 눈금), 빈 칸(테두리만), N/A(빗금), 정할 칸(호박색 + 위에 점). 막대는 `aria-hidden`이고 뜻은 옆의 글이 말한다. 막대에 올리면 칸 이름과 상태가 툴팁으로 뜬다(`useDelegatedTip`).
- **요약 글**(8절의 상태에서 센다): 채운 칸 = 문장이 있거나 하위 칸에 있는 칸. **N/A** n = N/A 칸 + 상위 칸의 N/A에 덮인 칸. **n to decide** = 장비 SOP의 세 칸 가운데 비어 있고 N/A도 아닌 칸(Overview의 알림과 같은 규칙).
- **이미 쓴 SOP**(쓴 파일이 붙은 줄)는 막대와 "n of 15"를 그리지 않는다(내 판단 — 그 문서의 칸은 파일의 절을 따르고 문장에 칸 키가 없어 모든 칸이 빈 칸으로 보인다). 쓴 파일 이름과 버전, 그리고 있을 때만 **N/A** n · "n to decide"를 적는다.
- **딸린 정보 줄이 좁을 때** 줄어드는 순서: 첫 N/A 칸 이름 → **Equipment SOP** 글자(아이콘만) → 파일 이름(가운데 말줄임, 최소 96px) → 막대. "n of 15", **N/A** n, "n to decide", **Not written** 은 끝까지 남는다.
- **EQUIS가 아는 값의 제안**(EQUIS에서는 SOP인데 줄이 WI, 장비 번호가 있는데 장비 SOP가 아님 — `listEquisHints`)은 펼친 곳의 그 칸 옆으로 옮기고, 줄에는 "EQUIS suggests 1" 칩 하나만 둔다. 누르면 줄이 펼쳐진다(내 판단 — 딸린 정보 줄을 한 줄로 지킨다. 제안은 지금처럼 눌러야 들어간다).
- **Remove** 는 뺄 수 없는 줄에서 꺼지고 까닭이 툴팁으로 뜬다. 지금은 쓴 파일이 붙은 줄만 미리 끄고 나머지는 눌러 본 뒤 서버 거절로 안다. Assign의 보낼 곳 지우기가 쓰는 규칙과 문구를 그대로 쓴다 — `getDocRemoveBlock`의 세 까닭(`tobe.matchLocked`, `assign.tree.why.hasSentences`, `assign.tree.why.hasChildren`).

**펼친 곳** — 왼쪽 **Document**, 오른쪽 SOP는 **Sections**(8절), WI는 **Steps**. 좁으면 위아래로 쌓인다.

- **Document**: **Doc no.**(쓴 파일이 붙은 줄은 잠김), **Title**(EQUIS가 잠그면 잠김), **Type**(SOP | WI 두 칸 단추, 쓴 파일이 붙은 줄은 잠김 — WI로 바꿀 때 목록의 첫 SOP 아래로 가는 것과 SOP가 없으면 `tobe.needSop`으로 알리는 것은 지금 그대로), WI면 **Parent SOP**(`Select`, 7절의 같은 길), SOP면 **Equipment SOP**(`Checkbox`), 쓴 파일이 있으면 **Written file**(이름 + 버전 `VersionInput` + 언어 배치 `Select` + **Preview** · **Download** · **Delete the written file** — 지금 줄과 펼친 곳에 나뉘어 있던 것을 모은다).
- **Steps**: 지금의 단계 목록(번호 · 이름 `CommitInput` · **Remove step**)과 **Add step**. 단계마다 문장 수를 이름 옆에 적고, 문장이 든 단계에는 **Remove step** 을 그리지 않는다(`getStepRemoveBlock` — 응답에 이미 있는 `sentence_counts`로 안다. N/A 표의 "문장이 든 칸에는 단추를 두지 않는다"와 같은 원칙, 내 판단).

**극단 자료에서**: New 줄 52개(SOP 30 · WI 22)에서 목록은 화면 스크롤 하나로 흐른다. 단계 40개인 WI를 펼치면 단계 목록이 그 줄 아래로 길게 열린다(안쪽 스크롤을 만들지 않는다 — 두 겹 스크롤 금지). 100자 번호는 식별 자리에서 두 줄로 접힌다.

**1·2걸음에서 정한 것**(v1.1.10, 구현하며 정한 빈칸과 코드에 맞춘 곳)

- 줄 끝 단추의 넓음 · 좁음은 목록 틀(`tobe-list`)의 컨테이너 질의로 가른다 — 두 모양을 다 그려 두고 CSS가 고른다. `useElementWidth`는 첫 그림에서 폭을 모르는 한 프레임이 생긴다(내 판단).
- 숨은 줄 끝 단추는 `opacity: 0`만 준다. 줄 안의 단추라 포인터가 닿으면 줄이 이미 올려진 상태다(내 판단). 읽기 전용 줄에는 단추도 그 자리도 없다(내 판단).
- 문턱은 840px이다. 가장 넓은 SOP 줄(EQUIS 제안 칩 + "Unsaved N/A reason", 줄어드는 단계를 다 쓴 뒤 525px)이 묶음 모양에서 목록 틀 827px부터 한 줄에 든다(잰 값). 그런데 `.app`의 최소 폭(1120px) 때문에 목록 틀은 1016px 아래로 내려가지 않아 **실제 창에서는 늘 묶음**이다. ⋯는 지우지 않고 틀이 더 좁아질 때의 대비로 두며, 스모크가 틀 폭을 820px로 묶어 시험한다(내 판단). 펼친 곳을 위아래로 쌓는 720px도 같은 까닭으로 대비다.
- 식별 자리 `--doc-id-w`는 172px — 14자 번호(`SOP-CDO-111334`)가 종류 표 · EQUIS 아이콘과 166px부터 한 줄(160px은 두 줄, en · ko 같다)에 여유 6px. 시작값 212px보다 40px을 제목에 준다(잰 값).
- 딸린 정보 줄의 줄어드는 순서는 **글로 정한다**(내 판단). 시작값의 컨테이너 질의(560/480/400px)는 1120 창에서도 줄이 646px 이상이라 걸리지 않았고, 같은 폭의 줄마다 든 것이 달라(쓴 파일 · N/A 이름 · 알약) 순서를 지키지 못했다 — 파일 이름이 N/A 이름과 함께 줄었다. 이제 줄이 넘치는 동안 `data-fit`을 한 단씩 올린다(`lib/use-meta-fit.ts`): 0단계에서 첫 N/A 칸 이름만 말줄임으로 줄고, 1 이름을 빼고, 2 **Equipment SOP** 글자를 빼고, 3 파일 이름이 가운데부터 줄고(최소 96px), 4 막대를 뺀다. 255자 파일이 붙은 쓴 SOP는 1120에서 3단계, 넓은 창에서도 3단계다(이름이 파일보다 먼저 빠진다).
- 첫 N/A 칸 이름이 말줄임으로 줄었으면 올리거나 포커스할 때 전체 이름이 툴팁으로 뜬다(`ClampText`와 같은 방식, 내 판단).
- 쓴 파일 이름의 가운데 말줄임은 글자 수가 아니라 폭으로 한다 — 머리(줄며 말줄임) + 꼬리(마지막 12자, 확장자 포함). 계획의 예시는 13자로 잘못 셌고 규칙(12자)을 따랐다(`splitFileName`, 내 판단).
- 쓴 파일의 단추 셋(**Preview** · **Download** · **Delete the written file**)은 펼친 곳의 **Written file** 로 간다. 줄에는 이름과 버전만 남는다.
- **Edit** 는 펼치기만 한다(이미 펼친 줄을 접지 않는다). 펼친 곳의 첫 고칠 칸으로 포커스를 옮긴다(내 판단).
- 줄의 값은 `-code-text` · `-title-text`, 펼친 곳의 칸은 지금 이름(`-code` · `-title`)이다. 종류는 두 칸 단추(`-type-sop` · `-type-wi`)로 바뀌었다.
- 등록 칸에 번호를 여럿 적으면 미리 보기는 "Adds {n} documents", 모두 이미 있으면 첫 번호로 "{code} is already on the list"이고 **Add** 가 꺼진다. "SOP가 없어 SOP로 더한다"는 번호가 WI라고 말할 때만 적는다(내 판단).
- 부모를 못 찾은 WI는 목록 끝 **No parent SOP** 묶음에 모인다. EQUIS 제안 칩은 WI 줄에도 붙는다(WI에만 있는 종류 제안이 줄에 보이지 않던 것을 막는다, 내 판단).
- 단계의 문장 수는 **Remove step** 자리에 적는다(둘은 함께 있지 않다) — 단계 칸의 열이 바뀌지 않는다(내 판단).
- 저장 · 더하기 · 되돌리기 단추와 <kbd>Enter</kbd>는 진행 중인 쓰기가 있으면 다시 보내지 않는다. 막는 값은 React 상태(`saving`)가 아니라 바로 바뀌는 ref다 — 상태는 다시 그린 뒤에야 닿아, 한 작업 안의 두 번째 <kbd>Enter</kbd>가 두 번째 요청을 보냈다(기계가 바쁠 때 스모크에서 한 번 보였다, 내 판단).
- 저장과 겹친 다시 받기(다른 줄의 거절)는 저장한 값을 덮을 수 있었다 — 저장이 끝날 때 다시 받는 중이었거나 목록이 바뀌었으면 한 번 더 받는다(전부터 있던 경쟁, 이 걸음의 시간에 드러났다).
- 사용 설명서는 칸 이름(`SLOT_LABELS`)을 굵게 쓰지 않고 따옴표로 적는다("Electronic record control" 등) — 설명서 시험이 굵은 글을 화면 문구(`MESSAGES.en`)로만 받는다(내 판단).

## 7. WI를 SOP에 끌어 상위 SOP 정하기

공통 규칙 G1~G13을 그대로 따른다. 이 화면에서 정한 것만 적는다.

- **끄는 것**: New 목록의 WI 줄 한 줄. 줄 상자 전체가 끌 상자(`[data-drag-box]`)다 — 손잡이가 없고, 누른 채 4px 넘게 움직이면 끌기, 그 전에 떼면 펼치기다(G1). 줄의 글자는 Alt를 누른 동안만 긁힌다(G3). 줄 안의 단추·링크에서 누른 것은 끌기가 아니다(G4). 올리면 줄이 살짝 들린다(G9). SOP 줄과 Old 줄은 끌리지 않는다(들리지도 않는다 — 들리는 줄이 곧 끌 수 있는 줄이다).
- **쓴 파일이 붙은 WI와 문장이 든 WI도 끌린다.** 지금 고르기 칸이 그 줄들의 부모를 바꾸게 두는 것과 같다.
- **끌려가는 표**: 번호(길면 가운데 말줄임) + 제목 한 줄 + 놓으면 생기는 일.
- **놓는 곳과 결과**

| 포인터 아래 | 표시 | 표의 글 |
|---|---|---|
| 다른 SOP 줄 | 진한 테두리 | "Parent SOP: `SOP-PH`" |
| 지금 부모인 SOP 줄 | 끊긴 테두리 | "Already under this SOP" |
| WI 줄(자기 자신 제외) | 끊긴 테두리 | "A WI cannot be a parent" |
| 그 밖(Old 줄, 펼친 곳, 머리, 빈 곳) | 없음 | 없음. 놓아도 아무 일 없다(G8) |

- 놓을 자리는 **SOP 줄 상자**뿐이다. 펼쳐진 SOP의 고치는 곳은 놓을 자리가 아니다(입력 칸 위에 떨어뜨리는 실수를 막는다 — 내 판단).
- **끄는 동안**(G10): 줄 끝 단추, 툴팁, 올림 바탕을 끈다. SOP 줄만 또렷하게 두고 Old 목록, 다른 WI 줄, 펼친 곳은 흐리게 한다(내 판단 — Order가 받을 수 없는 칸을 흐리게 하는 것과 같은 표현). 목록이 길면 화면 스크롤 칸의 위아래 가장자리에서 스스로 스크롤한다(G8). 놓을 자리 표시는 DOM 속성으로만 한다(G11 — 끌기 층이 `data-drop`을 붙인다).
- **놓으면 바로 저장한다.** 상위 SOP는 목록의 편집이라 고르기 칸과 똑같이 그 자리에서 저장된다(`PATCH …/tobe/docs/{id}` `{parent_code}` — 서버 변경 없음). 끌어다 놓기 설계의 "놓는 것은 고르는 것, 저장은 Confirm"은 Assign의 판단에 대한 규칙이고, 문서 편집(짝·순서)은 바로 반영하고 되돌리기를 준다는 같은 문서의 규칙을 따른다.
- **화면은 응답으로 그린다**(내 판단 — 낙관적으로 먼저 옮기지 않는다. 줄 쓰기는 짧은 요청 하나이고 지금 `runWrite`가 그렇게 한다). 응답이 오면 그 WI가 새 SOP 아래로 미끄러져 가고(`useFlip`) 잠깐 강조된다(`[data-flash]`). 화면 밖이면 그쪽으로 스크롤한다. 움직임 줄이기에서는 미끄러짐 없이 강조만 보인다.
- **되돌리기**: 알림 "`WI-07` moved under `SOP-PH`"에 **Undo** 를 둔다. 누르면 앞의 부모로 다시 저장한다(같은 PATCH). 알림이 사라진 뒤에는 다시 끌거나 펼친 곳의 **Parent SOP** 에서 고른다. Assign의 Ctrl+Z와는 무관하다(목록 편집은 그 줄에 서지 않는다).
  - 알림에 단추가 아직 없다(3절). 끌어다 놓기 4걸음(Pair view)이 먼저 넣었으면 그것을 쓰고, 아니면 이 걸음에서 `showToast`에 선택 인자로 단추 하나를 더한다(공용 부품이라 그 PATCH는 전체 스모크를 돌린다).
- **같은 일을 하는 길**(G12): 펼친 곳의 **Parent SOP** 고르기 칸. 키보드로는 줄에서 <kbd>Enter</kbd>로 펼치고 Tab으로 그 칸에 간다. 줄 끝 메뉴에 따로 항목을 더하지 않는다(내 판단 — 같은 일을 하는 자리가 셋이 되면 설명할 것만 는다).
- **끌기가 꺼지는 때**(끌 상자 표시도 없어 글자는 그냥 긁힌다): 읽기 전용(G13), 줄 쓰기가 도는 동안(`saving` — 응답 순서가 엇갈려 낡은 목록이 얹히지 않게, 내 판단), 목록에 SOP가 하나뿐일 때(놓을 곳이 없다).
- **서버가 거절하면**(끄는 사이 다른 작성자가 그 SOP를 지웠거나 WI로 바꿨다 — 422 `invalid_parent`, 문구는 이미 있다): 알림으로 까닭을 보이고 목록을 다시 받는다(지금 `runWrite`의 길).

## 8. N/A 칸 상태 표

SOP 줄을 펼친 곳의 **Sections** 다. 체크 목록을 없애고, 칸마다 **지금 상태를 먼저** 보인 뒤 하는 일이 적힌 단추를 둔다.

**표의 모양**

- 줄 15개, `SLOT_KEYS` 순서. 넓으면 두 단(1 ~ 5.2 | 6 ~ 7.2), 좁으면 한 단이다. 상위 칸과 그 하위 칸은 단이 갈릴 때 함께 움직인다(지금 `SLOT_GROUPS`가 하는 묶음을 그대로 — 그래서 두 단의 경계는 5.2와 6 사이로 고정한다).
- 열: **번호**(1, 5.1, 6.2 … — `SLOT_KEYS`의 고정 자리에서 센다. 서버 `outputs._build_slot_numbers`와 같은 규칙이고 순수 모델에 둔다) · **칸 이름**(`SLOT_LABELS`, 화면 언어와 상관없이 영어. 하위 칸은 들여 쓴다) · **상태** · **단추**. 사유와 사유 편집기는 그 줄 아래에 붙는다.
- 표 머리: **Sections** + "7 with sentences · 6 empty · 2 N/A" + (있으면) "2 to decide" 알약. 줄의 요약과 같은 수다.
- 표 아래 한 줄: "An N/A section stays in the document with its reason. A section that holds sentences cannot be N/A. Clear them in Assign first."

**칸의 상태** — 위에서부터 먼저 맞는 것

| # | 상태 | 조건 | 보이는 것 | 단추 |
|---|---|---|---|---|
| 1 | N/A | 그 칸에 N/A가 저장돼 있다 | **N/A** 칩 + 사유(두 줄에서 자르고 누르면 그 자리에서 다 펼친다) | **Edit reason** · **Restore**(호버·포커스 때) |
| 2 | 덮임 | 상위 칸이 N/A다 | **N/A** 칩 + "Covered by 7 Document relationships" | 없다(상위 칸에서 되돌린다) |
| 3 | 문장 있음 | 그 칸의 문장 수 > 0 | "**6** sentences" | 없다 |
| 4 | 하위 칸에 있음 | 상위 칸이고, 자기 수는 0, 하위 칸 수의 합 > 0 | "8 in sub-sections" | 없다(하위 칸에 문장이 있으면 서버가 상위 칸 N/A를 막는다) |
| 5 | 정할 칸 | 장비 SOP의 6.2·6.3·6.4이고 위 넷이 아니다 | "Fill or mark N/A" 호박색 알약 | **Mark N/A**(늘 보인다) |
| 6 | 빈 칸 | 그 밖 | **Empty** | **Mark N/A**(호버·포커스 때) |

- **N/A** 와 **Empty** 는 상태 표기라 화면 언어와 상관없이 영어다(디자인 기초 10절).
- **Mark N/A** 가 "정할 칸"에서만 늘 보이는 것은 그 줄이 다음 할 일이기 때문이다. 빈 칸 열 줄에 단추가 늘 보이면 다시 양식이 된다(내 판단. `(hover: none)`에서는 모두 늘 보인다).
- **문장이 든 칸에는 단추가 없다.** 눌러 보고 거절당하게 하지 않는다. 표 아래 한 줄이 까닭과 할 일을 말한다.
- **칸 제목만 이어진 칸**(문장 수는 0인데 칸 제목에 옛 제목이 이어져 있다 — 10절의 `heading_count > 0`, 그 칸이나 하위 칸): 상태는 5·6번 그대로 두되 **Mark N/A** 를 그리지 않고 그 자리에 "An Old heading is linked to this section title. Unlink it in Assign to mark N/A."를 흐린 글로 적는다(내 판단). 서버가 그 칸의 N/A를 막기 때문이다(3절). 검토 알림은 그 칸을 빈 칸으로 보므로 "정할 칸"이라는 표시는 Overview와 맞는다.
- **이미 쓴 SOP**: 문장 수를 세지 않는다(3절). 3·4번이 없고 6번의 자리에 **Empty** 대신 "From the file"을 흐린 글로 적는다. N/A로 두기와 되돌리기, 장비 SOP의 "정할 칸"은 그대로 된다 — 지금 되는 일을 없애지 않는다(내 판단, 15절).

**N/A로 두기**

1. **Mark N/A** 를 누르면 그 줄 아래에 사유 편집기가 열리고 포커스가 사유 칸으로 간다.
   - 머리글: "Reason. Printed in the document as “N/A · reason”".
   - 칸: 한 줄 입력, 2,000자까지, 자리 글 "Why this SOP has no Troubleshooting"(칸 이름이 들어간다).
   - **Used in this Bundle**: 이 Bundle의 N/A에 이미 쓴 사유를 많이 쓴 순으로 셋까지 칩으로 보인다(응답의 `na_slots`에서 센다 — 서버 변경 없음). 누르면 칸에 들어간다. 칩은 한 줄(최대 폭 240px)에서 자르고 전체 글은 툴팁이다. 쓴 사유가 없으면 이 줄을 그리지 않는다.
   - 단추: **Save N/A** <kbd>↵</kbd>, **Cancel** <kbd>Esc</kbd>.
2. 사유가 비어 있으면 **Save N/A** 가 꺼져 있다. <kbd>Enter</kbd>로 저장, <kbd>Esc</kbd>로 취소한다.
3. **칸을 떠나도 아무 일도 일어나지 않는다.** 편집기는 **Save N/A** 나 **Cancel** 로만 닫힌다.
4. 저장하면(`PUT …/na/{slot_key}`) 편집기가 닫히고 그 줄이 N/A가 된다. 하위 칸은 "Covered by …"로 바뀌고, 표 머리의 수와 줄의 막대·요약이 같은 응답으로 바뀐다.

**고치고 되돌리기**

- **Edit reason**: 같은 편집기가 저장된 사유를 담아 열린다. 저장은 같은 `PUT`(사유만 바뀐다).
- **Restore**: 바로 되돌린다(`DELETE …/na/{slot_key}`). 그 칸은 빈 칸(또는 정할 칸)으로 돌아가고 덮였던 하위 칸도 제 상태로 돌아간다. 알림 "Restored 6.3 Troubleshooting"에 **Undo** 를 둔다 — 누르면 지우기 전의 사유로 다시 저장한다(7절의 알림 단추와 같은 것. 사유는 2,000자까지라 실수로 지우면 아깝다 — 내 판단).
- 상위 칸이 N/A인 동안 하위 칸에 따로 저장된 N/A가 있으면 그 하위 칸은 1번 상태(자기 사유)로 보인다. 상위 칸을 되돌려도 그 칸은 N/A로 남는다(서버의 줄이 따로다).

**편집기는 한 번에 하나다**(내 판단)

- 사유를 적는 중(저장된 값과 다르다)에 다른 칸의 **Mark N/A** · **Edit reason** 을 누르면 새 편집기를 열지 않고, 열려 있는 편집기로 포커스를 돌리며 "Save or cancel this reason first."를 그 아래에 적는다. 적은 것이 없으면 조용히 옮겨 간다.
- 줄을 접어도 적던 사유는 버리지 않는다. 다시 펼치면 그대로 있다. 그동안 그 줄의 딸린 정보 줄에 "Unsaved N/A reason" 알약이 붙는다.
- 적던 사유가 있는 채 다른 화면으로 가려 하면 이탈 가드(`lib/leave-guard.ts` `useLeaveGuard`)가 묻는다.

**이미 든 문장은 어떻게 되나**

- 문장이 든 칸(하위 칸 포함)은 N/A로 둘 수 없다. 화면이 단추를 두지 않고 서버가 409 `slot_has_targets`로 다시 막는다. AI 제안·보류 상태의 문장도 든 것으로 센다.
- 그래서 N/A로 바꿀 때 사라지거나 옮겨지는 문장은 없다. 먼저 Assign에서 그 칸의 배정을 비운다.
- N/A인 칸은 Assign의 보낼 곳과 Order의 놓을 곳에서 빠지고(지금 그대로 — `na_slot`), AI 후보에서도 빠진다. 되돌리면 다시 받는다.
- 표를 보는 사이에 다른 사람이 그 칸에 문장을 보냈으면 저장이 409로 거절된다. 알림으로 까닭을 보이고 목록을 다시 받으면 그 줄이 "n sentences"가 되고 편집기는 닫힌다(적던 사유는 버린다 — 둘 곳이 없어졌다).

**문장 수는 어디서 오나**: New 목록 응답의 `slot_counts`(10절). 화면에 들어올 때와 이 화면의 줄 쓰기마다 새로 받는다. 수는 Assign·Order에서만 바뀌므로 이 화면에 머무는 동안 낡을 수 있고, 낡은 수로 누른 저장은 서버가 막는다(위).

**1·2걸음에서 정한 것**(v1.1.10)

- **Restore** 는 이번에는 바로 지우고 알림("Restored 6.3 Troubleshooting")만 띄운다. 알림의 **Undo** 는 3걸음에서 붙인다 — 알림의 행동 단추는 이미 있지만(Pair view 걸음) 걸음을 설계 순서대로 둔다(내 판단).
- 편집기는 화면에 하나(목록의 상태)이고, "적는 중"은 `text.trim() !== saved`다 — 새로 여는 칸은 한 글자라도 적어야, 고치는 칸은 저장된 사유와 달라야 적는 중이다(내 판단).
- 저장이 409 `slot_has_targets`면 알림 · 다시 받기 · 편집기 닫기, **그 밖의 실패(네트워크 · 5xx · 다른 거절)는 편집기와 적던 사유를 그대로 둔다** — 2,000자를 다시 적게 하지 않는다(내 판단).
- 접힌 줄에 적던 사유가 있는 채 다른 칸의 **Mark N/A** 가 막히면 그 줄을 다시 펼쳐 편집기와 "Save or cancel this reason first."가 보이게 하고 포커스를 그 사유 칸으로 옮긴다(내 판단 — 접힌 줄에서는 막힌 까닭이 보이지 않았다).
- 편집기가 닫히며 포커스가 쪽으로 떨어지면 그 칸의 다음 할 일(**Edit reason** · **Mark N/A**)로 옮긴다. <kbd>Esc</kbd>는 편집기 어디에서나(사유 칸 · 칩 · 단추) 닫는다(내 판단).
- 긴 사유는 두 줄에서 자르고 사유 글 자체가 단추다(`aria-expanded`). 누르면 그 자리에서 다 펴지고 그 단 안에서만 길어진다(1,863자 · 공백 없는 2,000자, 단의 폭 그대로 — 잰 값). 기억하지 않는다(내 판단).
- 쓴 사유 칩은 앞뒤 공백을 걷은 글이 같으면 하나로 세고, 많이 쓴 순 → 같으면 목록에 먼저 나온 순으로 셋, 한 줄 최대 240px이다. 지금 고치고 있는 칸의 사유도 센다(내 판단).
- 이미 쓴 SOP의 표 머리는 **N/A** n과 (있으면) "n to decide"만 적는다 — 문장 수를 세지 않는 문서에 "0 with sentences"는 거짓이다(내 판단).
- "하위 칸에 있음"의 까닭은 그 줄의 상태 글에 붙는 툴팁이다(포커스로도 닿는다, 내 판단).
- 표는 두 단의 단마다 최소 420px이다. 1248 창(펼친 곳의 오른쪽 778px)에 두 단을 넣으면 단이 375px이 되어 칸 이름 8개가 낱자로 접혀(en, 잰 값) 한 단으로 둔다. 1440부터 두 단(471px), 경계는 5.2와 6 사이다(내 판단).
- 이탈 가드의 확인 창은 새 키 셋(`tobe.leaveTitle` · `tobe.leaveBody` · `tobe.leaveConfirm`, `data-testid="tobe-leave"`)이다.

## 9. 올리기 창

창 하나, 두 국면인 것은 그대로다. 줄의 모양과 쪽 정하는 길이 바뀐다.

**고르는 국면**

- 맨 위: **Choose files** + "or drop files anywhere in this window · DOCX · text PDF".
- 그 아래 **묶음 둘**: **Old documents**(n) "What you have now", **New documents**(n) "Already written SOPs and WIs". 묶음마다 머리와 줄들이 있고, 줄이 없으면 점선 자리에 "Drop a file here to make it an Old document" / "… a New document"를 적는다.
- **줄은 두 줄이다.**
  - 윗줄: 파일 아이콘 + 파일 이름(고정폭, 가운데 말줄임, 전체는 툴팁) + 크기.
  - 아랫줄(올리면 생기는 일 — 지금 `renderPlan`의 내용):
    - Old: "Adds `OLD-7` to Old documents". 파일 이름에 번호가 없으면 "No number in the file name" 알약 + "Set it after it is read".
    - New, 목록에 번호가 같은 빈 줄이 있다: "Attaches to `WI-08` on the New list".
    - New, 줄이 새로 생긴다: "Creates" + 종류 고르기(SOP | WI) + 번호, WI면 "under" + 상위 SOP 고르기. 번호가 없으면 임시 번호로 생긴다는 글(지금 문구).
    - New, 붙일 수 없다: 빨간 글 까닭(`upload.why.hasFile` · `upload.why.inUse` · `upload.why.noSop`).
  - 줄 오른쪽: **Old | New** 두 칸 단추(지금 그대로, G12의 같은 길) + 빼기(×).
- **쪽을 정하는 길 넷**: (1) 앱이 먼저 고른다(`guessUploadSide`, 지금 그대로), (2) Old | New 단추, (3) **줄을 끌어 다른 묶음에 놓는다**, (4) **파일을 묶음 위에 놓는다**(탐색기에서 끌어 온 파일).
- **줄 끌기**(끌기 층): 끄는 것은 줄, 놓을 곳은 **다른 묶음 전체**(머리와 줄들, 빈 자리 포함). 표의 글은 "Side: New" / "Side: Old". 같은 묶음 위에서는 표시가 없다. 놓으면 그 줄의 쪽이 바뀐다 — 창 안의 고르기일 뿐 저장이 아니다. 거절은 없다. 놓은 쪽에서 붙일 수 없는 파일이면 그 줄 아랫줄에 빨간 까닭이 뜨고 올리기 단추가 꺼진다(지금 `canSubmit`의 규칙). 줄 안의 단추·고르기 칸에서 누른 것은 끌기가 아니다(G4). Esc는 끌기만 취소하고 창은 닫지 않는다 — 끌기 층이 끌기 중의 Esc를 창의 캡처 단계에서 먼저 받아 멈춘다(`box-drag.ts` `handleKey`). 스모크로 확인한다.
- **파일 놓기**: 창이 열려 있는 동안 창이 파일을 받는다. 묶음 위에 놓으면 **그 묶음의 쪽으로 정해져**(사람이 고른 것과 같다) 더해지고, 창의 다른 곳에 놓으면 앱이 쪽을 고른다. 끄는 동안 포인터 아래 묶음에 진한 테두리가 뜬다.
- **파일은 더해진다**(내 판단). 지금 **Choose files** 는 목록을 통째로 바꾸는데, 놓아서 더할 수 있게 되면 한쪽만 바꾸는 것이 어색하다. 고르기도 놓기도 이미 있는 목록에 더하고, 이름과 크기가 같은 파일은 다시 더하지 않는다.
- 아래: **Cancel**, **Upload n files**(붙일 수 없는 줄이나 상위 SOP를 고르지 않은 WI가 있으면 꺼진다 — 지금 그대로).

**올리는 국면** — 파일을 읽는 동안과 받지 못했을 때

- **묶음은 그대로 남고 줄이 제자리에서 결과 줄이 된다**(내 판단 — 지금은 묶음 없는 네 열 표로 바뀐다. 어느 쪽으로 올렸는지가 자리로 남는다). 끌기, Old | New, 빼기는 사라진다(쪽은 이미 보냈다).
- 올리는 순서는 Old 묶음 위에서 아래로, 그다음 New 묶음이다. 하나씩 차례로 올린다(서버 파싱 자리가 둘이라 지금처럼).
- 줄의 아랫줄이 상태가 된다.
  - 기다림: "Waiting"(흐린 글).
  - 읽는 중: 도는 표시 + "Reading"(지금 `documents.reading`).
  - 읽힘(Ready): Old는 그 자리에서 고치는 세 칸(번호 · 버전 · 언어 배치 + 출처 표 + AI 제안 칩 — 지금 결과 표의 칸을 그대로 옮긴다). New는 붙은 줄의 번호만 글자로(번호는 목록에서 고친다 — 지금 그대로).
  - 받지 못함: **Rejected** 또는 **Failed** 알약 + 까닭(`getDocReason`, 빨간 글). 줄은 묶음에 남는다. 받지 못한 New 파일은 목록 줄이 생기지 않아 Old 목록 끝에 **New** 표시로 남는다(5절).
  - 요청이 실패함(겹친 파일, 붙일 수 없게 됨 등): 서버 까닭을 빨간 글로(`humanizeApiError`).
- 읽는 동안 창은 닫히지 않는다(`isBusy`, 지금 그대로). 다 끝나면 **Close** 와 (읽힌 문서가 있으면) **Go to Assign**.
- 결과 줄에서 Old 파일의 값을 바로 고치는 것은 "줄은 읽기, 펼치면 고치기"의 예외로 둔다(내 판단 — 방금 채워진 값을 확인하는 자리이고 지금도 그렇게 쓴다).

**극단 자료에서**: 255자 파일 이름은 윗줄에서 가운데가 줄어 확장자가 보인다. 파일 30개를 고르면 **묶음 영역이 창 안에서 스크롤하고** 아래 단추는 늘 보인다 — `Modal`은 겹침 층 전체가 스크롤해 긴 창의 단추가 화면 밖으로 밀리므로, 묶음 영역에 높이 상한을 준다(AI 목록 읽기 창 `list-reader.tsx`의 표가 쓰는 방식). 줄을 끄는 동안 그 영역의 위아래 가장자리에서 스스로 스크롤한다(끌기 층의 `getScrollers`에 그 영역을 준다).

## 10. 서버

바뀌는 것은 **하나**다 — New 목록 응답에 칸별 문장 수를 싣는다. 새 주소, 새 거절 코드, 스키마(Alembic) 변경은 없다. 권한·env도 없다.

**`slot_counts` — `GET /api/bundles/{id}/tobe`와 모든 줄 쓰기 응답(`ToBeViewOut`)**

```
slot_counts: [
  { "target_doc_id": 12, "slot_key": "procedures.procedure", "count": 6, "heading_count": 0 },
  { "target_doc_id": 12, "slot_key": "purpose",              "count": 0, "heading_count": 1 }
]
```

- **`count`** — 그 문서의 그 칸에 있는 **칸 항목 수**: `target_sentences`에서 `slot_key`가 그 칸이고 `parent_target_id IS NULL`(표의 칸 새 문장은 표 하나로 센다), `kind != slot_heading`인 줄. 결과물 C와 Order가 그 칸의 줄로 그리는 것과 같은 집합이다(`outputs._plan_sections`). **언어마다 따로**(한/영 짝은 2), **상태를 가리지 않고**(AI 제안·보류 포함 — N/A를 막는 규칙과 같다) 센다. 하위 칸의 수는 상위 칸에 더하지 않는다(화면이 더한다).
- **`heading_count`** — 그 칸의 칸 제목에 이은 옛 제목 수(`kind == slot_heading`).
- `count + heading_count > 0`인 (문서, 칸)만 싣는다. 문장이 없는 문서, WI(칸이 없다), 이미 쓴 문서(문장에 칸 키가 없다)는 나오지 않는다. 정렬은 (문서 id, `SLOT_KEYS` 순서).
- **"막힘"은 화면이 `count + heading_count > 0`(그 칸과 하위 칸)으로 읽는다.** 서버의 막는 규칙(`_find_blocked_slots`)은 `slot_key`가 있는 모든 줄을 세지만, 표의 칸 새 문장은 그 표와 같은 칸에 있어 결과가 같다(순서 저장이 표와 그 칸 새 문장의 자리를 함께 옮기는 데서 읽은 것이다). 이 같음을 서버 시험으로 박는다(12절) — 시험이 어긋나면 `count`의 뜻은 두고 막힘을 알리는 값을 따로 싣는다.
- **`sentence_counts`는 그대로 둔다**(내 판단). 칸 키를 그 모양에 더하면 SOP가 문서마다 여러 줄이 되어, 지금 그 값을 읽는 Assign의 지우기 잠금과 올리기 창, 그리고 값이 정확히 같은지 보는 서버 시험이 함께 움직인다. 뜻도 다르다 — `sentence_counts`는 "지울 수 없는 자리", `slot_counts`는 "칸에 보이는 항목 수와 칸 제목"이다.
- **검증**: 읽기 전용 값이라 입력이 없다. 접근은 지금 그대로다(읽기는 멤버, 쓰기는 작성자·작업 중).
- **비용**: `_build_tobe_view`에 질의 하나가 는다 — `target_sentences`를 `target_doc_id IN (…)`, `slot_key IS NOT NULL`로 걸러 (문서, 칸)으로 묶고 조건부 합 둘을 낸다. `target_doc_id`에 인덱스가 있고(`models.py`) 지금 `count_targets_by_step`과 같은 범위를 읽는다. 줄 수는 그 Bundle의 새 문장 수(극단 시드에서 수천)이고 결과는 많아야 SOP 수 × 15줄이다. 두 수 세기를 질의 하나로 합쳐도 된다(구현에 맡긴다) — 질의 수가 지금보다 둘 이상 늘지 않게 한다.
- **프런트 타입**: `lib/api-sop.ts` `ToBe`에 `slot_counts?: SlotCount[]`. 없으면(옛 응답) 빈 것으로 읽는다.
- 프런트와 맞춘 API 계약 블록(`docs/superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md`)은 AI 층의 계약이고 `/tobe` 응답을 적지 않아 고칠 것이 없다.

**그대로 쓰는 것**(바꾸지 않는다)

| 화면의 일 | 요청 | 닿는 거절 코드 | `rule.<code>` 문구 |
|---|---|---|---|
| WI를 SOP에 놓기 · **Parent SOP** 고르기 · 알림의 Undo | `PATCH …/tobe/docs/{id}` `{parent_code}` | 422 `invalid_parent`, 404 `target_doc_not_found` | 있다 |
| **Save N/A** · **Edit reason** · Restore의 Undo | `PUT …/tobe/docs/{id}/na/{slot_key}` `{reason}` | 409 `slot_has_targets`, 422 `unknown_slot` · `na_on_wi` | 있다 |
| **Restore** | `DELETE …/tobe/docs/{id}/na/{slot_key}` | — | — |
| 번호로 더하기 | `POST …/tobe/docs` | 422 `duplicate_code` · `invalid_parent` · `tobe_list_full` | 있다 |
| 올리기 | `POST …/documents`(`side`, `doc_type`, `parent_code`) | 409 `doc_in_use` · `duplicate_code`, 422 `invalid_parent` | 있다 |

새 거절 코드가 없으므로 새 `rule.<code>` 문구도 없다. 끌기의 거절 사유 둘(7절)은 화면에만 있는 규칙이라 새 문구를 둔다(11절).

## 11. 문구

화면에 새로 나오는 글이다. 키 이름은 구현에 맡긴다. 도메인 용어(Bundle · Old · New · Unit)와 상태 표기, 칸 이름은 화면 언어와 상관없이 영어다. 긴 대시를 쓰지 않는다. 설명서는 영어 라벨을 굵게 적으므로(`manual-content.test.ts`가 en 사전과 대조한다) 아래 en 글자를 그대로 쓴다.

**목록과 줄**

| 자리 | en | ko |
|---|---|---|
| 빈 번호 · 버전 · 제목 | No number · No version · No title | 번호 없음 · 버전 없음 · 제목 없음 |
| New 줄의 빈 제목 | No title yet | 제목 없음 |
| 줄 펼침 화살표(Old) | Details | 자세히 |
| 좁은 줄의 ⋯ | Actions(`manage.rowActions`) | 동작 |
| 줄 끝 단추(New) | Edit · Remove(있는 키) | 수정 · 빼기 |
| 칸 요약 | {filled} of {total} sections filled | 칸 {total}개 중 {filled}개 채움 |
| N/A 요약 | N/A {n} | N/A {n} |
| 정할 칸 | {n} to decide | 정할 칸 {n}개 |
| 쓴 문서 | Written · Not written(있는 키) | 쓴 문서 · 아직 안 씀 |
| 단계 수 | Steps {n} | 단계 {n}개 |
| 단계의 문장 수 | {n} sentences | 문장 {n}개 |
| EQUIS 제안 칩 | EQUIS suggests {n} | EQUIS 제안 {n}개 |
| 부모 없는 WI 묶음 · 알약 | No parent SOP | 상위 SOP 없음 |
| 저장 안 한 사유 | Unsaved N/A reason | 저장 안 한 N/A 사유 |

**번호로 더하기**

| 자리 | en | ko |
|---|---|---|
| SOP | Adds SOP {code} | SOP {code} 줄을 더합니다 |
| WI | Adds WI {code} under {parent} | WI {code} 줄을 {parent} 아래에 더합니다 |
| SOP가 없을 때의 WI | No SOP on the list yet, so {code} is added as an SOP | 목록에 SOP가 없어 {code}를 SOP로 더합니다 |
| 이미 있는 번호 | {code} is already on the list | {code}는 이미 목록에 있습니다 |

**WI를 SOP에 끌기**

| 자리 | en | ko |
|---|---|---|
| 놓을 수 있다 | Parent SOP: {code} | 상위 SOP: {code} |
| WI 줄 위 | A WI cannot be a parent | WI는 상위 문서가 될 수 없습니다 |
| 지금 부모 위 | Already under this SOP | 이미 이 SOP 아래에 있습니다 |
| 알림 | {wi} moved under {sop} | {wi}를 {sop} 아래로 옮겼습니다 |
| 알림 단추 | Undo | 되돌리기 |

**N/A 칸 상태 표**

| 자리 | en | ko |
|---|---|---|
| 표 이름 | Sections | 칸 |
| 표 머리 요약 | {filled} with sentences · {empty} empty · {na} N/A | 문장 있음 {filled} · 빈 칸 {empty} · N/A {na} |
| 문장 있음 | {n} sentences(1이면 1 sentence) | 문장 {n}개 |
| 하위 칸에 있음 | {n} in sub-sections | 하위 칸에 {n}개 |
| 빈 칸 | Empty | Empty |
| 정할 칸 | Fill or mark N/A | 채우거나 N/A로 |
| 덮임 | Covered by {number} {name} | {number} {name}의 N/A에 포함 |
| 이미 쓴 SOP의 칸 | From the file | 파일을 따름 |
| 단추 | Mark N/A · Edit reason · Restore | N/A로 두기 · 사유 고치기 · 되돌리기 |
| 편집기 머리글 | Reason. Printed in the document as “N/A · reason” | 사유. 결과물에 “N/A · 사유”로 찍힙니다 |
| 사유 칸 자리 글 | Why this SOP has no {name} | 이 SOP에 {name} 칸이 없는 까닭 |
| 쓴 사유 | Used in this Bundle | 이 Bundle에서 쓴 사유 |
| 편집기 단추 | Save N/A · Cancel | N/A 저장 · 취소 |
| 다른 편집기를 열려 할 때 | Save or cancel this reason first. | 이 사유를 먼저 저장하거나 취소하세요. |
| 하위 칸에 문장(툴팁) | Sub-sections hold sentences, so this section cannot be N/A. | 하위 칸에 문장이 있어 N/A로 둘 수 없습니다. |
| 칸 제목만 이어진 칸 | An Old heading is linked to this section title. Unlink it in Assign to mark N/A. | 이 칸 제목에 Old 제목이 이어져 있습니다. Assign에서 끊어야 N/A로 둘 수 있습니다. |
| 표 아래 한 줄 | An N/A section stays in the document with its reason. A section that holds sentences cannot be N/A. Clear them in Assign first. | N/A 칸은 사유와 함께 문서에 남습니다. 문장이 든 칸은 N/A로 둘 수 없습니다. Assign에서 먼저 비우세요. |
| 되돌린 알림 | Restored {number} {name} | {number} {name} 칸을 되돌렸습니다 |

**올리기 창**

| 자리 | en | ko |
|---|---|---|
| 고르기 옆 | or drop files anywhere in this window · DOCX · text PDF | 이 창 아무 데나 파일을 놓아도 됩니다 · DOCX · 텍스트 PDF |
| 묶음 머리 | Old documents · What you have now | Old documents · 지금 있는 문서 |
| 묶음 머리 | New documents · Already written SOPs and WIs | New documents · 이미 쓴 SOP와 WI |
| 빈 묶음 | Drop a file here to make it an Old document / a New document | 여기에 놓으면 Old 문서가 됩니다 / New 문서가 됩니다 |
| Old 줄 | Adds {code} to Old documents | Old documents에 {code}를 더합니다 |
| 번호 없는 파일 | No number in the file name · Set it after it is read | 파일 이름에 번호 없음 · 읽힌 뒤에 정합니다 |
| New 줄(새로 생김) | Creates … {code} · under … | {code} 줄을 만듭니다 · 상위 … |
| 끌려가는 표 | Side: Old · Side: New | 쪽: Old · 쪽: New |

그 밖의 글(붙는 줄, 붙일 수 없는 까닭, 읽는 중, 기다림, 올리기 단추)은 지금 키를 그대로 쓴다. 쓰지 않게 되는 키(`tobe.naHint`, `tobe.naCount`, 표의 열 머리 `tobe.col*`·`documents.col*` 일부, `upload.oldNote` 등)는 그 걸음에서 en·ko를 함께 지운다.

## 12. 검증

- **순수 모델을 먼저 시험한다**(화면 규칙은 순수 모델에 둔다).
  - 칸 상태: 여섯 상태의 우선순위, 상위 칸 N/A가 하위 칸을 덮는 것, 하위 칸에 따로 저장된 N/A, "하위 칸에 있음"의 합, 장비 SOP의 "정할 칸"이 `review._list_equipment_notices`와 같은 집합인 것, 칸 제목만 이어진 칸의 막힘(자기와 하위 칸), 이미 쓴 SOP, `slot_counts`가 없을 때. 요약 세기(채움 + 빈 칸 + N/A + 정할 칸 = 15). 칸 번호가 `SLOT_KEYS`의 자리에서 서버와 같게 나오는 것. 쓴 사유 고르기(많이 쓴 순, 셋, 같은 글은 하나).
  - 상위 SOP 놓기: SOP · 지금 부모 · WI · 자기 자신 · 그 밖의 판정과 사유, 끌기가 꺼지는 조건 셋.
  - 등록 미리 보기: `planAddRows`의 결과에서 네 문장이 나오는 것(SOP, WI + 부모, SOP 없는 WI, 이미 있는 번호).
  - 올리기: 묶음 나누기, 줄을 다른 묶음에 놓았을 때와 파일을 묶음에 놓았을 때의 쪽, 이름·크기가 같은 파일을 다시 더하지 않는 것, 올리는 순서(Old 먼저).
  - 딸린 정보 줄에서 줄어드는 순서는 CSS라 브라우저에서 본다.
- **서버**(`backend/tests/test_sop_tobe.py`): `slot_counts` — 문장 하나, 한/영 짝(2), AI 제안 상태의 문장(센다), 표(칸 새 문장이 있어도 1), 칸 제목만(`count` 0 · `heading_count` 1이고 그 칸의 `PUT …/na`가 409 `slot_has_targets`), 하위 칸의 문장이 상위 칸 줄에 더해지지 않는 것, WI와 이미 쓴 문서가 나오지 않는 것, Order에서 칸을 옮긴 뒤 수가 따라가는 것, 줄 쓰기 응답마다 실리는 것, 빈 Bundle의 `[]`(지금 응답 전체를 견주는 시험 둘을 함께 고친다), `sentence_counts`가 글자 하나 달라지지 않는 것. 그리고 **막힘 판정의 같음**: 여러 모양의 문서에서 `count + heading_count > 0`인 칸 집합과 N/A가 409로 거절되는 칸 집합이 같다.
- **브라우저 스모크**(`frontend/scripts/pw-smoke-sop.mjs`, 평소에는 `ONLY="documents:"` · `ONLY="new documents:"`만): 지금 장면 넷("documents list, inline edit and delete prompt", "new documents: nested rows, N/A detail, each cell saves as you leave it", "documents: an Old list and a New list…", "documents: one upload window takes Old and New files")을 새 모양에 맞게 고치고 아래를 더한다.
  - 줄: 줄을 눌러 펼치고 <kbd>Enter</kbd>로도 펼친다. 줄 끝 단추가 평소에 안 보이고 호버·포커스에 보인다. 좁은 틀에서 ⋯ 메뉴가 같은 일을 한다. Old 제목 링크가 Assign 한 단 보기를 연다. 읽기 전용 사용자에게 고치는 칸과 단추가 없다.
  - N/A: 문장이 든 칸에 단추가 없다. **Mark N/A** → 사유 없이는 저장 단추가 꺼져 있다 → 칸을 떠나도 편집기가 남는다 → 칩으로 사유를 넣고 <kbd>Enter</kbd> → 다시 읽어도 N/A다 → 줄의 막대와 요약이 바뀐다. **Edit reason**, **Restore**, 알림의 Undo. 상위 칸 N/A가 하위 칸을 "Covered by"로 덮는다. 적는 중에 다른 칸의 단추를 누르면 안내가 뜬다. <kbd>Esc</kbd>가 편집기만 닫는다.
  - 끌기: WI를 다른 SOP에 놓으면 그 아래로 옮겨 가고 다시 읽어도 그대로다. WI 줄 위와 지금 부모 위에서 사유가 적히고 놓이지 않는다. <kbd>Esc</kbd> 취소, 빈 곳에 놓기. 끌기 뒤 클릭이 삼켜져 줄이 펼쳐지지 않는다(G5). 누르고 바로 떼면 펼쳐진다. Alt를 누르면 글자가 긁힌다. 알림의 Undo. 끄는 동안 React 커밋이 없다(스모크의 커밋 세기 `installCommitCounter`). 검토자와 `in_review` Bundle에서 끌기가 시작되지 않는다. 열린 메뉴가 바깥 누름으로 닫힌다(G2).
  - 올리기: 파일 넷이 두 묶음으로 나뉜다. 줄을 끌어 묶음을 바꾸면 아랫줄의 글이 바뀐다. Old | New 단추도 같은 결과다. 붙일 수 없는 쪽으로 옮기면 올리기 단추가 꺼진다. 올리는 동안 줄이 제자리에서 Waiting → Reading → Ready로 바뀌고, 받지 못한 파일은 까닭과 함께 묶음에 남는다. 창 안 파일 놓기는 Playwright로 `DataTransfer`를 만들어 본다.
- **극단 자료**(`seed_sop_worst`, 1120과 2560 폭, 라이트·다크, en·ko): 5·6·9절의 "극단 자료에서"를 잰다. `docs/lessons/ui-review.md`의 방식대로 **처방은 실행 중인 화면에 주입해 잰 뒤** 값을 정한다(식별 자리 폭, 넓음·좁음의 경계, 딸린 정보 줄의 최소 폭). 재는 것: 줄이 틀 밖으로 나가지 않는다, 제목이 두 줄을 넘지 않는다, 줄 끝 단추가 글을 덮지 않고 줄마다 같은 오른쪽 끝이다, 1,990자 사유가 두 줄에서 잘리고 펼치면 표의 단을 밀어내지 않는다, 칩의 긴 사유가 한 줄이다, 2560에서 본문 상한(1600) 안에 빈 자리가 한쪽으로 몰리지 않는다, 줄 52개에서 WI를 끌 때 자동 스크롤이 되고 표 한 장이 한 줄이다.
- **감사 스크립트**: `pw-layout-audit.mjs`의 Documents 장면들이 표(`documents-list tbody tr`, `tobe-list`, `-slots`)를 찾는다 — 그 걸음에서 새 줄에 맞게 고친다. `pw-overlap-audit.mjs` · `pw-contrast-audit.mjs`에 새 줄, N/A 표, 올리기 묶음을 더한다(N/A 빗금 눈금과 흐린 글의 대비). 전체 스모크와 감사 넷은 `dev`→`main` 전에 돈다(사용자 결정 2026-11-16).
- 움직임 줄이기(`prefers-reduced-motion`)에서 자리 바꿈과 들림이 바로 끝난다.
- 걸음마다 `npm run lint`, `tsc`, `vitest`, 서버를 고친 걸음은 `pytest`와 `ruff`.

## 13. 만드는 순서

걸음마다 dev에 올릴 수 있다(걸음마다 PATCH). 화면이 바뀌는 걸음은 사용 설명서의 글을 같은 커밋에서 고친다(`#documents` · `#upload` · `#document-columns` · `#tobe-docs` · `#tobe-slots` · `#tobe-save`). 그림은 정식 업데이트 때 다시 뽑는다. 첫 걸음의 첫 커밋에서 `docs/README.md` 인덱스에 이 문서를 한 줄 더한다.

1. **N/A 칸 상태 표.** 서버의 `slot_counts`(10절) + 칸 상태 순수 모델 + 지금 표의 펼친 줄 안에서 체크 목록을 상태 표로 바꾼다(편집기, 쓴 사유 칩, Restore). 줄의 "N/A: 1" 칸은 그대로 둔다. 알림의 Undo는 3걸음에서 붙인다(그 전에는 Restore가 바로 지운다). 가장 작고, 사용자가 서버 일이라고 짚은 것이 여기 다 들어 있으며, 목록 모양과 무관하게 쓸 수 있다. (v1.1.10로 dev에 올렸다.)
2. **New 목록 두 줄.** 줄 상자 틀(4절) + New 줄과 펼친 곳(6절) + 등록 칸을 머리 아래로 + 줄의 칸 상태 막대와 요약 + 줄 끝 단추(호버·포커스, 좁으면 ⋯) + 단계의 문장 수. `ui-review.md` 13번과 디자인 기초 11절의 Documents 문장을 고친다. (v1.1.10로 dev에 올렸다 — 1걸음과 함께.)
3. **WI를 SOP에 끌기.** 놓기 순수 모델 + 끌기 층 붙이기 + 자리 바꿈과 강조 + 알림의 Undo(`showToast`에 단추가 없으면 여기서 더한다 — 그러면 전체 스모크) + 1걸음 Restore의 Undo.
4. **Old 목록 두 줄.** Old 줄과 펼친 곳(5절). `DataList`는 다른 화면이 쓰므로 그대로 둔다.
5. **올리기 묶음.** 두 묶음, 두 줄 줄, 줄 끌기, 창 안 파일 놓기, 결과가 제자리에 남는 올리는 국면(9절).

2걸음이 3걸음의 앞이다(끌 줄 상자가 2걸음에서 생긴다). 1 · 4 · 5걸음은 서로 기대지 않는다.

## 14. 구현에 맡기는 것

- 부품과 순수 모델의 파일 이름, 문구 키, `data-testid`(남는 칸은 지금 이름을 지킨다 — `documents-{id}-code`, `tobe-id-{n}-title`, `upload-side-{i}-{side}` 등).
- 줄 틀의 정확한 값 — 식별 자리 폭, 넓음·좁음의 경계, 줄 높이, SOP 줄 바탕과 나무 선, 칸 상태 막대의 눈금 크기와 모양(토큰만 쓴다: `--accent`, `--ink-4`, `--line-2`, `--sunken`, 상태 색). 12절대로 재서 정한다.
  - 잰 값(2026-11-17, 극단 자료 W1 · 1120/1248/1440/1920/2560 · en · ko · 라이트 · 다크, 6절 "1·2걸음에서 정한 것"): 식별 자리 `--doc-id-w` 172px(New), 줄 끝 단추 자리 `--doc-acts-w` 52px, 넓음 · 좁음 문턱 840px(목록 틀 — 실제 창에서는 늘 넓음), 펼친 곳 쌓기 720px(대비), 딸린 정보 줄은 컨테이너 질의 대신 `data-fit` 네 단계, 칸 상태 표의 단 최소 420px. 줄: 제목 두 줄 최대 44px, 번호 두 줄 최대 36px, 딸린 정보 줄 18px, 올려도 줄 높이 그대로, 줄 끝 단추가 글을 덮는 넓이 0. 막대 눈금의 바탕 대비(라이트 · 다크): 채움 5.85 · 7.06, 빈 칸 테두리 1.49 · 1.97, N/A 테두리 4.35 · 5.38, 정할 칸 3.10 · 6.50 — 빈 칸은 모양(테두리만)으로 갈리고 막대는 `aria-hidden`이며 뜻은 옆 글이 말한다.
- `slot_counts`를 지금 수 세기와 질의 하나로 합칠지, 스키마 이름(`SlotCountOut`).
- 알림 단추의 모양과 머무는 시간.
- N/A 사유가 길 때 그 자리에서 펼치는 방식(누르면 펼치기, 접기).
- 줄을 접었다 펼 때 적던 사유를 들고 있는 방법(상태의 자리).
- 창 안에서 파일을 끄는 동안의 표시(지금 화면의 `drop-veil`을 창 안으로 옮길지 묶음 테두리만 쓸지).

## 15. 열린 것

진행을 막지 않는다. 각 항목에 지금 택한 쪽을 적었다.

- **Old 줄에 Unit 수를 보일지.** 시안은 딸린 정보 줄에 "63 units"를 적었다. 문서 목록 응답에 그 수가 없고, "Unit 수"와 Assign의 "줄 수"(짝 하나가 한 줄) 가운데 무엇을 적을지 정해야 한다. **택한 쪽: 넣지 않는다.** 원하면 `DocumentOut`에 수 하나를 더하는 작은 서버 일이다.
- **이미 쓴 SOP의 N/A.** 지금도 저장은 되지만 결과물에는 나오지 않고(절 경로로 칸을 짓는다) 장비 SOP 알림만 끈다. **택한 쪽: 지금 되는 대로 둔다** — 표는 문장 수 없이 "From the file"로 보이고 N/A로 두기는 남긴다(8절). 이미 쓴 SOP에서 N/A를 아예 없앨지는 장비 SOP 알림 규칙과 함께 사용자가 정할 일이다.
- **칸 제목만 이어진 칸의 N/A.** 서버가 막는다(3절). **택한 쪽: 서버 규칙을 그대로 두고 화면이 까닭을 적는다**(8절). 칸 제목만 있는 칸은 N/A로 둘 수 있게 풀지는 규칙을 바꾸는 일이라 따로 정한다.
- **상위 SOP 없는 WI.** 시안에는 그 상태가 있었다. **택한 쪽: 만들지 않는다**(6절). 허용하려면 제품 명세 §6.6과 서버 검사, 결과물 묶기, AI 문맥을 함께 정해야 한다.
- 상위 칸에 직접 놓인 줄의 번호와 하위 칸 제목 번호의 겹침은 사용자 답을 기다린다. 이 설계는 칸 번호를 `SLOT_KEYS`의 자리에서만 읽으므로 어느 쪽으로 정해져도 바뀌지 않는다.
