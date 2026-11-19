# 변경 종류 둘 — "=" / "수정" 설계 (요청서 16번)

2026-11-20. 요청서 16번(`docs/superpowers/handoff/2026-11-19-paragraph-split-requests.md`)과 사용자 답(2026-11-19: "=" / "수정" 둘, 표도 같은 규칙, 사유는 선택)을 구현 단위로 적는다. 결과물 라벨과 표 구성 변경 합치기는 권장안으로 구현하고 사용자 확인 뒤 `dev`에 올린다(아래 D3 · D1의 "확인 대기").

## 왜

사람이 고르던 세 칸(그대로 · 말투 · 고쳐 씀)은 말투와 고쳐 씀의 경계가 흐리고, 고르지 않으면 확정이 막혀 손이 많이 갔다. 결과물을 읽는 사람에게 필요한 것은 "원문 그대로인가, 아닌가"뿐이다. 둘로 줄이면 종류를 서버가 글로 정할 수 있어 사람이 고를 것이 없고, 말투 · 고쳐 씀을 가르려고 부르던 LLM `match` 작업도 필요 없다.

## 결정

- **D1 종류.** 사람이 고르던 종류는 `as_is`("=")와 `rewritten`("수정") 둘이다. `tone`과 `table_restructured`는 없앤다(**확인 대기: 표 구성 변경을 `rewritten`에 합치기**). 나눔 · 합침 · 번역 · 신규 · 삭제 · 칸 제목(`split` · `merged` · `translated` · `new` · `deleted` · `heading`)은 지금처럼 구조로 서버가 정한다.
- **D2 서버가 정한다.** 저장 입력에서 `change_type`을 받지 않는다. 문장은 확정 글이 출처 글(앞 번호를 뺀 글 포함)과 같으면 `as_is`, 다르면 `rewritten`. 표는 원문 표 모양(R27 — 격자 · 칸 자리)을 지키면 `as_is`, 아니면 `rewritten`이고 사유는 선택이다. 그림은 늘 `as_is`. `change_type_required` · 표의 `invalid_change_type` 거절과 검토 요청의 "표 구성 변경 사유 필수"는 없앤다.
- **D3 라벨.** 화면 · 결과물 A · B · C · Excel 모두 `as_is` = "="(영어도 "="), `rewritten` = "수정" / "Modified"(**확인 대기: 결과물도 "="로 쓰기**). 다른 종류의 라벨은 그대로.
- **D4 Alembic 0032.** `target_sentences.change_type`의 `tone` · `table_restructured` → `rewritten`. JSON 속 옛 값도 바꾼다 — `ai_suggestions.content`(`change_type`, `target_change_types`의 값)와 `decision_steps.before` · `after`(어느 깊이든 `change_type` 키) — 바꾸지 않으면 Undo가 옛 종류를 되살린다. 대기 · 실행 중인 `match` 작업은 `cancelled`. 되돌리기(downgrade)는 하지 않는다(어느 것이 말투였는지 잃는다).
- **D5 AI 분류.** 분류 지침 · 응답 모양에서 `change_type`을 뺀다 — 받는 쪽(저장)이 글로 정한다. 제안 기록의 `change_type`은 쓰지 않거나 글로 정한 값만 둔다. 채택 판정(adoption)은 둘을 기준으로.
- **D6 AI 묶기.** LLM `match` 작업(말투 · 고쳐 씀 판정, `prompt.match`)을 걷는다. 계획(`match_plan`, LLM 없음)이 종류를 바로 정하고 "다듬기 대기"(`provisional`)가 없어진다 — 일괄 수락 미리 보기의 `excluded_provisional`도 뺀다. 제안 종류 `match`(계획이 쓰는 제안)는 그대로다. DB의 `ai_jobs.kind` 제약은 옛 행 때문에 그대로 둔다.
- **D7 화면.** 결정 칸의 세 칸 고르기를 읽기 전용 "=" / "수정" 표시로 바꾼다(화면은 미리 보기로 같은 규칙을 쓰고 서버 응답이 이긴다). 저장 몸통에서 고른 종류를 뺀다. 일괄 수락 창의 "다듬기 대기" 줄과 AI 작업 목록의 `match` 작업 이름을 뺀다. 표 구성을 바꾸는 손잡이는 그대로이고 그 표시는 "수정"이다.

## 스텝과 브랜치

모음 브랜치 `feat/change-type`에서 걸음 브랜치를 따서 걸음마다 그 걸음 diff만 검토해 합친다(루트 CLAUDE.md "브랜치에서 다시 브랜치" — 걸음 하나만 올리면 화면 저장이 깨진다).

1. `feat/change-type-1-server` — D1 · D2 · D3 · D4 · D5(서버 · Alembic · 라벨 · 분류 지침).
2. `feat/change-type-2-screen` — D7과 설명서 · 스모크 단계(결정 칸 종류 고르기를 누르던 단계는 "=" / "수정" 표시 검사로).
3. `feat/change-type-3-ai-match` — D6.

모음 브랜치는 사용자 확인(D1 · D3) 뒤 `dev`에 합친다(PATCH 하나).
