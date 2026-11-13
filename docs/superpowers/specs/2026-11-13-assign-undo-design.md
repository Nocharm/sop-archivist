# Assign 되돌리기·다시 하기 — 설계

2026-11-13. 브랜치 `feat/assign-undo`(dev v0.16.11에서). 이 문서에서 "사용자 결정"은 사용자가 정한 것이고, "내 판단"은 사용자가 "추천 방식으로" 맡긴 것이다(2026-11-13).

## 1. 왜

Assign에서 줄을 잘못 확정하거나 잘못 비웠을 때, 지금은 손으로 다시 판단하는 수밖에 없다. 확정하면서 New 문장이 지워졌거나, 비우기 때문에 같은 묶음의 다른 줄이 보류로 바뀌었거나, AI 제안이 rejected로 넘어갔으면 손으로도 원래대로 되돌리지 못한다. Split은 v0.16.11부터 버튼, Ctrl+Z / Ctrl+Shift+Z, "Undone: Check boundary · OLD-1-009" 알림을 갖췄다. Assign도 같은 모양으로 맞춘다.

## 2. 목표 · 비목표 · 반목표

**목표**
- 줄 판단을 바꾼 저장을 하나씩 거꾸로 되돌린다. 대상은 확정, 보류, 비우기(Clear), 잇기·끊기, 같은 글자 일괄 확정, New 신규 표시, 출처로 잇기, 일괄 삭제·이동, 배정 초기화(Reset)이고, 각각 저장 바로 전 상태로 돌아간다. 이 화면에 있는 동안 여러 단계를 되돌릴 수 있고 다시 하기도 된다(사용자 결정).
- "바로 전 상태"는 화면에 보이는 것만이 아니라 서버의 상태 전부다. AI 제안 상태(`ai_suggested`, 채택 여부), 지운 New 문장(같은 id로), 출처, KO/EN 짝, 다른 줄에 번진 보류까지 포함한다.
- 알림은 무엇을, 어느 Unit에 했는지 말한다. 예: "Undone: Confirm · OLD-1-009". 되돌린 뒤에는 그 줄을 고른다(사용자 결정).
- 상단 바에 Undo·Redo 아이콘 단추를 두고, 단축키는 Ctrl/⌘+Z와 Ctrl/⌘+Shift+Z다.

**비목표**
- 다른 사람의 저장을 되돌리지 않는다. 자기 저장만 대상이다(내 판단).
- 화면을 떠났다 돌아오면 기록을 잇지 않는다. 다시 열면 빈 기록에서 시작한다. "이 화면에 있는 동안"을 그대로 따른다(사용자 결정을 내 판단으로 구체화).
- AI 작업이 백그라운드에서 적용한 결과는 사람이 한 저장이 아니라서 기록하지 않는다.
- 활동 기록(BundleEvent)과 TargetTextHistory는 지우지 않는다. 되돌리기도 기록의 한 줄로 남는다.

**반목표** (기술적으로 돌아가도 이렇게 되면 실패다)
- 그 사이 남이나 AI, Split이 바꾼 것을 되돌리기가 덮어쓰는 것. 이때는 거절해야 한다.
- 일부만 되돌아가는 것. 한 단계는 모두 되돌리거나, 아무것도 되돌리지 않거나 둘 중 하나다.
- 알림이 "Undone"만 말하고 무엇을 되돌렸는지 말하지 않는 것.
- Ctrl+Z가 텍스트 입력 중의 기본 되돌리기(글자 지우기)를 빼앗는 것.

## 3. 조사로 확인한 제약

- 판단 상태는 **묶음 단위**로 여러 표에 흩어져 있다. UnitDecision(Unit마다 한 행, 그 자리에서 고친다), TargetSentence(넣기·고치기·**지우기**), TargetSource(출처, 잇기 묶음은 이것과 부모 칸에서 나온다), UnitPair·UnitPairMember(짝 확정이나 **지우기**, Document.revision이 오른다), AiSuggestion(adoption·result)이다. 한 번 저장하면 여러 문서와 여러 To-Be 문서에 걸칠 수 있다(`save_group`, `clear_unit`→`detach_units`가 묶음의 나머지를 보류로 바꾼다, `settle_pairs`, `sweep_translations`).
- 서버에는 거꾸로 돌릴 판단 이력이 없다. UnitDecisionHistory는 detach만 쓰는 검토용 "전" 기록이다. 그래서 화면이 직전 값을 다시 저장하는 식으로는 안 된다. `ai_suggested` 상태를 다시 만들 수 없고, New 문장을 다시 넣으면 id가 바뀌고, unassigned는 clear로만 만들 수 있다.
- 한 번의 사용자 동작이 여러 요청으로 나뉘는 곳이 있다. 같은 글자 일괄 확정은 1000개씩 차례로 보내고, Clear는 줄의 Unit마다 한 번씩 보낸다.
- Assign의 오른쪽 클릭 "자르기"는 판단 저장이 아니라 Split 편집 길(`editUnits`)이다. 그 기록은 Split 문서 기록(UnitEdit)에 들어간다.

## 4. 동작 (사용자에게 보이는 것)

### 4.1 단추와 단축키
- 상단 바 `assign-bar-end` 맨 앞, 일괄 단추와 같은 글자 단추 앞에 Undo2·Redo2 아이콘 단추 두 개를 둔다. 모양은 Split과 같다(`btn icon h-7`, 호버하면 Tooltip으로 "Undo (Ctrl+Z)" / "Redo (Ctrl+Shift+Z)", 아이콘 단추에는 툴팁을 기본으로 붙이는 원칙). 맨 앞에 두는 것은 내 판단이다. 오른쪽 묶음이 줄을 넘겨도 늘 같은 자리에 있게 하려는 것이다.
- 되돌릴 것이 없으면 흐리게 해서 누를 수 없게 한다(숨기지 않는다). 쓰기 권한이 없거나 읽기 전용이면 아예 그리지 않는다(`canEdit`).
- 단축키: Ctrl/⌘+Z는 되돌리기, Ctrl/⌘+Shift+Z는 다시 하기다. Ctrl+Y는 Split이 쓰지 않으니 넣지 않는다. 텍스트 입력 중이거나 대화창·메뉴·목록이 떠 있으면 단축키를 쓰지 않고 브라우저 기본 동작에 맡긴다(Split의 `getSplitKeyAction` 규칙과 같다). `handleKey`가 meta·ctrl·alt를 먼저 돌려보내는 줄 앞에 분기를 둔다.
- 저장 중(`busy`)이면 단추와 단축키 모두 무시한다.

### 4.2 알림
- 성공: "Undone: {무엇} · {대상}" / "Redone: {무엇} · {대상}". 한국어는 "되돌렸습니다: {무엇} · {대상}" / "다시 했습니다: …"로, Split과 같은 틀(`.what` 키)을 쓴다.
- {무엇}은 단계 이름이다. Confirm·Hold·Clear·Link·Unlink·Confirm identical·Mark as New·Link as source·Delete·Move out·Reset·Cut(자르기, 4.4)·Split edit.
- {대상}은 Unit 하나면 그 표시 번호(OLD-1-009), 여럿이면 "{n} lines", New 문장만이면 그 New 문장의 표시 번호다. Reset은 문서 번호 또는 "whole bundle"이다.
- 실패(거절)는 오류 알림으로 이유를 말한다. 예: "Can't undo: someone changed these lines since (OLD-1-009)." 기록은 그대로 둬서, 다시 눌러도 같은 이유로 거절된다.

### 4.3 고름 옮기기
되돌리거나 다시 하면 응답의 `focus`(Unit id 또는 New 문장 id)가 속한 줄을 고르고 그 자리로 스크롤한다. Split의 고름 복귀와 같은 방식(`setFollow`)이다. 그 줄이 지금 필터에 가려져 있으면 필터를 건드리지 않고 고르기만 한다(내 판단, 원문 쪽 종이는 그 Unit으로 간다).

### 4.4 Assign 안의 자르기 (내 판단)
Assign에서 문장을 자른 직후 Ctrl+Z를 누르면 사용자는 그 자르기가 되돌아가길 기대한다. 이때 판단 기록만 보면 자르기는 그대로 두고 그 전 확정을 되돌리게 되어 엉뚱하다. 그래서 Assign 기록에 **자르기도 한 단계로 넣는다**. 다만 내용을 따로 찍지 않고 "이 문서의 Split 편집 기록 n번"을 가리키는 표만 남긴다. 되돌리면 Split 되돌리기(같은 문서, 같은 revision 검사)를 부른다. Split에서 그 사이 다른 편집이 있었으면 Split 규칙대로 409로 거절된다.
- 자르기를 되돌리면 자른 조각들이 은퇴한다. 그 사이 누가 조각에 판단을 걸어 Split이 `confirm_required`를 내면 **묻지 않고 거절한다**(내 판단). Assign은 지금도 판단이 걸린 Unit을 자르지 않고 "먼저 배정을 비우라"고 안내한다(`assign.ctx.why.assigned`). 되돌리기에서 확인하고 떼어 내게 하면 남의 판단이 Assign 기록 밖에서 사라진다. 거절 알림은 같은 안내 문구를 쓴다. 그래서 undo/redo 본문에는 `confirm`이 없다.

### 4.5 Reset · 일괄 삭제·이동 (내 판단 — 사용자가 "추천 방식으로" 맡김)
**둘 다 되돌리기에 넣는다.** 실수했을 때 가장 아픈 동작이 바로 이것들이고(문서 전체나 묶음 전체의 판단이 사라진다), 스냅숏 방식이면 크기 말고는 다른 저장과 다를 게 없다. 지금 있는 확인 창은 그대로 둔다. Reset 확인 창의 문구에 "Ctrl+Z로 되돌릴 수 있습니다"를 덧붙이지는 않는다. 화면을 떠나면 사라지는 기록이라 약속처럼 읽히면 안 되기 때문이다.

## 5. 서버 설계

### 5.1 기록 단위와 범위
- **한 단계 = 사용자 동작 하나.** 여러 요청으로 나뉘는 동작(같은 글자 일괄 확정의 1000개 단위, Clear의 Unit별 요청)은 화면이 같은 `step_key`를 실어 보내고, 서버는 같은 세션의 마지막 단계에 이어 붙인다. 이어 붙이는 것은 그 단계가 아직 applied이고 맨 끝일 때만이다.
- **기록은 (묶음, 사람, 화면 세션)마다 하나.** 화면 세션은 Assign 화면을 열 때마다 화면이 새로 만드는 id다(`genId`, 평문 HTTP에서도 되는 것). Assign은 묶음 전체를 한 화면에 싣고 문서·Old/New 전환은 주소를 바꾸지 않는 화면 상태라서, 세션 id는 페이지가 처음 그려질 때 한 번 만드는 ref에 둔다. 그러면 문서를 오가도 기록이 이어진다. "이 화면"은 그 묶음의 Assign 전체다(내 판단). 모든 판단 저장 요청에 `undo_session`으로 싣는다. 실리지 않은 요청(다른 화면, 스크립트, 시드)은 기록하지 않는다.
- 같은 사람이 같은 묶음에서 새 세션으로 첫 단계를 기록하면, 그 사람의 그 묶음 옛 세션 단계는 지운다. 탭 두 개를 연 경우에는 마지막에 저장한 탭의 기록만 살아남는데, 예전 탭에서 되돌리면 "기록이 없다"로 거절된다(내 판단, 드문 경우라 단순하게 둔다). 그 밖에 24시간이 지난 단계는 기록할 때 지운다.
- 세션당 최대 **100단계**(내 판단). 넘치면 가장 오래된 단계부터 버린다.
- 선형이다. 되돌린 뒤 새 저장을 하면 그 세션의 undone 단계가 모두 사라진다(Split과 같다).

### 5.2 무엇을 찍나 (스냅숏 범위)
한 단계는 그 저장이 **실제로 바꾼 행**의 전(before)과 후(after) 모습을 담는다. 대상 표와 열:
- `unit_decisions`: 행 전체(PK unit_id, revision 포함).
- `target_sentences`: 행 전체. 지운 행은 before에만, 새로 넣은 행은 after에만 있다. 부모·자식(칸, `parent_target_id` cascade)으로 같이 지워진 자식도 각각 행으로 담는다.
- `target_sources`: (target_id, unit_id, seq) 행.
- `unit_pairs`·`unit_pair_members`: 행 전체.
- `ai_suggestions`: adoption, adopted_by, adopted_at, result 같은 고쳐지는 열. 행을 지우는 일은 없다.

바뀐 행을 어떻게 모을지는 구현에 맡긴다(아래 7절). 다만 이 표들에 쓰는 **모든 판단 저장 길**이 빠짐없이 기록되어야 하고, 이는 시험으로 지킨다(6절).

### 5.3 되돌리기·다시 하기
- `POST /api/sop/bundles/{id}/decisions/undo`, `…/decisions/redo`. 본문은 `{undo_session}`이고, 대상은 그 세션의 마지막 applied 단계(undo) 또는 첫 undone 단계(redo)다. 묶음을 잠그고 `ensure_editable`을 거친다. 권한은 판단 저장과 같다.
- **거절 규칙(낙관적)**: undo는 단계의 after 모습이 지금 DB와 행마다 같을 때만 한다. 비교는 행의 있고 없음과 **revision을 뺀 열 값**으로 한다(내 판단). revision으로 비교하지 않는 이유가 있다. 확정 → 비우기 → 자르기 → Ctrl+Z(자르기 되돌림, Unit은 미배정으로 되살아난다) → Ctrl+Z(비우기 되돌림)처럼, 내용은 그대로인데 revision만 바뀐 행 때문에 앞 단계를 영영 되돌릴 수 없게 되면 안 되기 때문이다. 남이 같은 값으로 다시 저장한 경우에는 되돌려도 남의 일을 잃지 않는다. 이 순서는 시험으로 고정한다. 하나라도 다르면 409 `undo_conflict`로 거절하고 무엇도 바꾸지 않는다. 응답의 `unit_ids`에 어긋난 줄을 싣는다. redo는 before 모습과 같은지를 본다. 이렇게 하면 다른 사람, AI 적용, Split detach, Unit 은퇴(행이 사라지거나 바뀜)가 모두 같은 규칙으로 걸린다. 은퇴한 Unit의 행을 되살리는 경우도 Unit이 살아 있는지 함께 본다.
- **거절 — 짝의 운명**: 되쓴 결과에서 단계가 건드린 Unit(판단·짝 멤버·출처)이 든 짝의 운명이 둘로 갈리면 409 `undo_conflict`이고 `unit_ids`는 그 짝의 멤버다. 그 사이 단계 밖에서 짝을 맺었거나(미배정이라 운명 검사를 지났다) 단계 밖에서 짝 상대를 다른 곳으로 보낸 경우다. 판정은 `pair_settle`의 운명 규칙 한 벌을 쓰고, 되쓰기 savepoint 안에서 재서 갈리면 savepoint째 물린다(내 판단 2026-11-13, dev 정리 검토).
- **거절 — 옛 글의 번역**: 되쓰기가 새 문장의 글·자리·출처 Unit을 바꾸거나 그 새 문장을 지우는데 그 새 문장에 단계에 없는 번역이 지금 있으면(그 사이 다시 번역했다) 409 `undo_conflict`이고 `unit_ids`는 그 새 문장의 출처 Unit이다. 단계를 남긴 저장이 그때의 번역을 모두 쓸어 단계에 담았으니 단계에 없는 번역은 그 뒤 지금 글을 옮긴 것이다. 조용히 쓸지 않는다(내 판단 2026-11-13, dev 정리 검토).
- **적용**: before 모습으로 되쓴다. after에만 있는 행은 지우고, before에만 있는 행은 **같은 id로** 다시 넣고, 둘 다 있는 행은 before 값으로 고친다. 단 revision 열은 before 값이 아니라 **지금 값 + 1**로 둔다. 화면에 남은 옛 revision으로 하는 저장은 409가 되어야 하기 때문이다. 단계에는 적용 뒤의 실제 모습을 새 after로 다시 저장해, 다시 하기·되돌리기가 계속 맞물리게 한다. 짝 행이 바뀌면 그 문서의 Document.revision을 올린다(`pairs._record`와 같다). 확정 글이 바뀌면 TargetTextHistory를 보통 저장처럼 남긴다.
- 활동 기록에는 `decision.undo` / `decision.redo`(단계 이름, 건수)를 남긴다.
- **응답 `DecisionStepResult`**(Split `EditStepResult`와 맞춘 모양): `op`(단계 이름), `unit_ids`(대상 Unit), `target_ids`(대상 New 문장), `focus`(`{unit_id}` 또는 `{target_id}`), `scope_label`(Reset의 문서 번호, 묶음 전체면 null), `can_undo`, `can_redo`.
- 저장 응답의 모양은 바꾸지 않는다. 일괄 처분 응답이 목록이라 필드를 더할 수 없어서다. 화면이 단추 상태를 스스로 정한다(계획 때 정한 내 판단). 기록이 실린 저장이 성공하면 Undo를 켜고 Redo를 끈다. undo·redo를 한 뒤에는 응답의 `can_undo`·`can_redo`를 따른다. `nothing_to_*` 거절을 받으면 그 방향 단추를 끈다. 화면을 처음 열 때는 새 세션이라 둘 다 꺼짐이다.

### 5.4 단계 이름(op)은 화면이 준다
`save_group` 하나가 확정·보류·잇기·끊기·New 표시·출처로 잇기를 모두 맡기 때문에 서버만으로는 이름을 가를 수 없다. 저장 요청에 `undo_op`(정해진 값 목록, 경계에서 검증)를 실어 보내고 서버는 그대로 담는다. clear·bulk(delete/move)·reset·bulk-confirm은 서버가 이름을 안다. 대상 Unit·New 문장도 화면이 `undo_focus`로 준다. 알림의 "어느 Unit"은 사용자가 고른 줄이어야 하는데, 서버가 바꾼 행(보류로 번진 다른 줄 포함)으로는 그것을 알 수 없기 때문이다.

### 5.5 Split 기록과의 관계
- 둘은 따로다. Split의 UnitEdit는 문서마다 하나이고 모두가 함께 쓴다. Assign 기록은 사람·세션마다다. 서로의 단계를 지우지 않는다.
- Split 편집이 판단을 떼어 내면(detach) 그 행들의 after가 어긋나므로, 그보다 앞선 Assign 단계는 5.3 규칙에 따라 거절된다. 이것은 의도한 동작이다.
- Assign 안의 자르기는 4.4대로 "Split 기록 가리키기" 단계다. 데이터는 `{document_id, unit_edit_id}`다. 되돌릴 때 그 UnitEdit가 그 문서의 마지막 applied 편집이 아니면 `undo_conflict`로 거절한다. 다시 하기도 마찬가지로, 첫 undone 편집일 때만 한다.

### 5.6 새 표 (Alembic 리비전 하나)
`decision_steps`: id, bundle_id(FK, cascade), actor(사용자 키), session(문자열), seq, op, kind(`snapshot`|`unit_edit`), state(`applied`|`undone`), step_key(nullable), focus/unit_ids/target_ids/scope_label(JSON), before/after(JSON, 표별 행 목록), unit_edit 가리키기(nullable), created_at. 인덱스는 (bundle_id, actor, session, seq)다. 이 행에는 SOP 원문(확정 글, New 문장 글)이 들어가는데, 원문 표와 같은 DB이고 24시간 뒤 지워지므로 따로 다루지 않는다. 백업 덤프에 들어가는 것도 원문 표와 같다.

## 6. 검증
- backend pytest, 저장 길마다 하나씩: 확정·보류·잇기·끊기·New 표시·출처로 잇기·Clear(묶음의 나머지가 보류로 번지는 경우)·일괄 삭제/이동·Reset(문서/묶음)·같은 글자 일괄 확정(1000개 넘게 나뉜 경우). 각 시험은 묶음 전체 판단 상태를 덤프해 **저장 전 = undo 뒤**, **저장 뒤 = redo 뒤**(revision 열은 빼고)를 비교한다. `ai_suggested`가 되살아나는지, 지운 New 문장이 같은 id로 돌아오는지, 짝이 되살아나는지를 따로 확인한다.
- 거절: 다른 사람이 그 줄을 다시 저장한 뒤, AI 적용 뒤, Split detach 뒤, Unit 은퇴 뒤에는 409 `undo_conflict`이고 DB가 바뀌지 않는다. 남의 세션 단계는 보이지 않는다. 새 세션은 옛 기록을 지운다. 100단계 상한. 되돌린 뒤 새 저장을 하면 redo가 사라진다. 읽기 전용 묶음(검토 중)에서는 거절된다.
- 기록 누락 방지: 5.2의 표에 쓰는 판단 저장 라우트 목록을 시험에 고정해, 새 라우트가 생기면 그 시험이 기록 여부를 묻게 한다.
- frontend: vitest(알림 문구 모델 `decision-step-model.ts`, 키 분기), tsc·lint·build.
- 화면: 극단 자료(seed_sop_worst)에서 1280·1920 × EN·KO로 단추 자리가 겹치지 않는지, Ctrl+Z로 확정·Clear·같은 글자 일괄·Reset을 되돌릴 때 알림 문구와 고름 복귀가 맞는지 Playwright로 확인한다.
- 사용 설명서 `frontend/public/manual/user-manual.md`의 Assign 조각에 되돌리기를 같은 커밋에서 더한다.

## 7. 구현에 맡기는 것
- 바뀐 행을 모으는 방법. 예를 들어 저장 함수 앞뒤에서 영향 범위(대상 Unit·묶음 닫힘·짝·New 문장)를 찍는 방식이나, SQLAlchemy 세션 이벤트로 dirty/new/deleted를 모으는 방식이 있다. 단, `delete()` 같은 Core 문장은 ORM 이벤트를 타지 않는다. 어느 쪽이든 6절의 덤프 비교 시험이 기준이다.
- JSON 행 모습의 정확한 형태와 날짜·enum 직렬화.
- 버튼 아이콘 크기·간격은 Split의 값을 따른다.
- 메시지 키 이름(`assign.step.*`, `assign.undone.what` 등).
