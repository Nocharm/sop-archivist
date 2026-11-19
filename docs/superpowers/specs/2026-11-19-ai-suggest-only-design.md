# AI는 제안 기록에만 — 판단·New 문장은 사람이 받을 때만 (설계)

상태: 구현 중 — 스텝 1(서버) 브랜치 `feat/ai-suggest-only-1-server`. 사용자 결정 2026-11-19. 스텝 1에서 채택 기록의 서버 쪽(저장의 `suggestion_id`, D2 일부)을 함께 했다(사용자 결정 2026-11-19). 제품 명세(`2026-11-05-sop-restructuring-e2e-design.md`) §1·§3·§6.5·§6.6·§6.8의 "AI 제안 상태" 부분을 이 문서가 바꾼다(구현 스텝 1에서 명세 본문을 함께 고친다).

## 1. 왜

- AI 분류(`classify`)와 묶기(`match_plan`·`match`)가 `apply`에서 판단(`unit_decisions.status = ai_suggested`, 처분, `revision += 1`)과 New 문장(`target_sentences`, `ai_text`)을 직접 쓴다. 사람은 그 줄을 열면 AI가 고른 보낼 곳이 이미 골라져 있고, New 칸·엮은 문서·결과물 A·B·C·Excel에도 "AI 제안" 꼬리표만 단 채 놓여 확정처럼 보인다. 생각과 다르면 매번 **Clear**로 지워야 하고 그것도 되돌리기 기록에 남는다.
- 배경 분류가 판단 `revision`을 올려 사람이 보던 줄의 저장이 409 `revision_conflict`("다른 사람이 먼저 바꿨습니다")로 막힌다 — 혼자서도 재현됨(로컬, 가짜 AI 1.5초 지연, 보류 12번 중 2번). AI 작업이 끝날 때마다 Assign이 원문 보기까지 통째로 다시 받는다.

## 2. 정한 것

| # | 결정 | 내용 |
|---|---|---|
| D1 | AI는 제안 기록에만 쓴다 | `classify`·`match_plan`·`match`의 `apply`는 `ai_suggestions` 행만 쓴다. 판단·New 문장·출처 연결·`revision`을 건드리지 않는다. 판단 상태는 사람이 정하기 전까지 `unassigned` |
| D2 | 받기는 사람이 누른다 | Assign 오른쪽 칸의 AI 추천 카드에서 **Use**(글쇠 하나)를 누르면 보낼 곳·고쳐 쓴 글·변경 종류가 초안에 채워지고, 확정은 늘 사람의 **Confirm**. 채택 기록(`adoption.py`)은 그 저장이 `suggestion_id`를 실어 남긴다(그대로 / 고침) |
| D3 | 종류별 일괄 수락 | AI 제안 종류(분류 · 묶기)마다 남은 제안을 한 번에 받아 확정하는 길을 둔다 — 범위(지금 Old 문서 / Bundle 전체)와 건수를 먼저 보이고, 한 되돌리기 단계로 거둔다. 사람이 누른 확정이라 `confirmed_by`는 누른 사람 |
| D4 | 미리 분류는 그대로 | Assign 첫 진입의 미리 분류·업로드 뒤 묶기 계획은 계속 돈다 — 판단을 쓰지 않으니 충돌도, 끝날 때의 화면 전체 다시 받기도 없다(제안 목록만 다시 받는다) |
| D5 | 번역은 그대로 | 사람이 요청하는 번역(`translate`)은 지금처럼 New 문서에 AI 번역 줄을 바로 넣는다(요청 자체가 사람의 결정) |
| D6 | 짝 제안은 그대로 | AI 짝(`pair`)은 이미 `PAIR_SUGGESTED`로만 남고 사람이 확정한다 |
| D7 | DB는 지워도 된다 | 실제 사용 전이다 — Alembic 데이터 리비전이 AI가 쓴 New 문장을 지우고 `ai_suggested` 판단을 `unassigned`로 되돌린다(제안 행은 남김) |

## 3. 바뀌는 곳 (개요)

- **서버**: `ai/classify.py` `_write_targets`·판단 쓰기 제거 → 제안 `content`에 후보(문서·칸·자리·삭제), 언어별 고쳐 쓴 글, 변경 종류, 경고를 싣는다. `ai/match_jobs.py` `_apply_write`도 같은 식(묶음: 단위 id ↔ New 문장 id, 변경 종류). `apply.clear_previous_suggestion`은 제안 행만 걷는다. `status`의 `ai_suggested`를 쓰는 곳 — 진행 숫자(`snapshot.load_bundle_progress`, `RowProgress.ai_suggested`), 검토 조건(`review.PENDING_STATUSES`, `units_ai_suggested`·`targets_ai_suggested`), 결과물 라벨(`output_labels` "AI 제안", `sheet_model` tone `ai`), To-Be `sentence_counts` — 을 걷는다. 일괄 수락 API는 사람 저장 경로(`save_group`)를 제안마다 부르고 한 되돌리기 단계로 묶는다(제안의 단위 해시·상태가 지금과 같을 때만, 아니면 건너뛰고 수를 돌려준다).
- **화면**: Assign의 `ai_suggested` 거르기·상태 아이콘·`isAiRow` 미리 채움(`savedDestination`)·`aiPending` 대신 제안 목록(`listSuggestions`)에서 그 줄의 살아 있는 제안을 찾아 카드로 보인다. New 칸의 AI 이음은 제안의 묶음에서 점선 추천 표시로. AI 작업이 끝나면 제안 목록만 다시 받는다(`useAiJobs` 콜백). 상단 바·개요·관리의 진행 숫자에서 AI 칸이 빠진다.
- **문서**: 제품 명세 해당 절, `backend/CLAUDE.md` "AI는 제안만 한다" 불변식(검사 `test_invariants.py`에 "AI 핸들러는 `UnitDecision`·`TargetSentence`를 쓰지 않는다"를 더한다), 사용 설명서 `#assign-filters`·`#assign-confirm`·AI 절, 기능 맵.

## 4. 스텝과 브랜치

하나만 `dev`에 올리면 화면이 반쪽이 되므로 모음 브랜치 `feat/ai-suggest-only`에서 스텝 브랜치를 딴다(루트 CLAUDE.md "브랜치에서 다시 브랜치").

1. `feat/ai-suggest-only-1-server` — D1·D7 서버, 진행 숫자·검토 조건에서 판단의 `ai_suggested` 걷기(새 문장의 `ai_suggested`는 AI 번역 줄로 남아 `targets_ai_suggested`와 결과물 라벨·톤도 남는다 — 사용자 결정 2026-11-19), 저장의 `suggestion_id`와 채택 기록, 불변식 시험, 명세 본문 고치기. 확인: pytest 전체, ruff.
2. `feat/ai-suggest-only-2-assign` — D2 Assign 카드 · **Use** · 채택 기록, 거르기·상태 정리, New 칸 추천 표시, AI 끝남 때 제안만 다시 받기, 설명서. 확인: vitest·lint·tsc, `assign:` 스모크(가짜 AI 켠 시나리오 포함).
3. `feat/ai-suggest-only-3-bulk` — D3 일괄 수락(API + 범위·건수 확인 창 + 되돌리기), 설명서. 확인: pytest 새 시험, `assign:` 스모크.

따로(같은 모음에 넣지 않는다): `feat/assign-inline-actions` — 그 자리 메뉴(고른 뒤 떠오르는 확정 상자)를 고른 문단 상자 안의 단추 줄로 바꾸기(사용자 결정 2026-11-19, "정신 사납다"). 실제 화면 지금/시안을 아티팩트로 먼저 보이고 정한다.

## 5. 아직 정할 것

- 일괄 수락 진입점: Assign 상단 바 AI 알약의 메뉴 / 위쪽 줄 더보기 — 스텝 3 시작 때 시안으로.
- **Use** 글쇠: <kbd>A</kbd> 제안(지금 비어 있는지 스텝 2에서 확인).
