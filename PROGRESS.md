# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.2.0(2026-11-19 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-19

- **Assign 확정한 이음 선이 가까워도 안 보이던 것(`fix/assign-link-lines`)** — 사용자 보고. 재 보니 셋이 겹쳤다: 두 끝 높이 차 24px 넘으면 꼬리만(데모의 나란한 짝 0~8px로 잡은 값이라 한두 문단 어긋난 Assign 이음이 다 꼬리), 40개 상한을 화면이 아니라 두 문서 이음 전체로 세어 긴 문서는 고른 선만, 평소 선 투명도 0.38. 240px(화면 약 3분의 1)·화면에 보이는 이음으로 세기·0.5로 바꿨다. 분류 절반 묶음 OLD-1 ↔ SOP-CF에서 꼬리 3 → 1(남은 하나는 260px).

- **AI는 제안 기록에만 — 설계와 스텝 1 서버(`feat/ai-suggest-only`, v1.2.1)** — 혼자 쓰는데도 Assign의 "다른 사람이 먼저 바꿨습니다"는 배경 AI 분류가 판단 revision을 올리고 New 문장을 직접 쓰기 때문이었다(로컬 재현, 보류 12번 중 2번 409). 사용자가 AI를 보조 수단으로 돌리기로 정했다(설계 `docs/superpowers/specs/2026-11-19-ai-suggest-only-design.md`). 스텝 1: 분류·묶기·다듬기는 `ai_suggestions` 행만 쓰고(내용에 자리·고쳐 쓴 글·변경 종류, 묶기는 `links`·`target_change_types`), 살아 있는 제안은 `content`로 찾는다. 저장의 `suggestion_id`가 판단에 이어 채택을 남기고(D2 서버 쪽을 당김, 사용자 결정), 받지 않고 확정한 줄의 제안은 밀어낸다. 판단의 `ai_suggested`는 진행 숫자·검토 조건에서 걷고 새 문장의 것은 AI 번역 줄로 남겼다(사용자 결정). Alembic `0031`, 불변식 시험 "AI 핸들러는 판단·새 문장을 쓰지 않는다". 사용자 요청으로 스텝 1만 `dev`에 먼저 합쳤다 — 카드·Use·설명서(스텝 2)와 일괄 수락(스텝 3) 전이라 Assign에 AI 제안이 아직 안 보인다.
  - 확인: pytest 3107 · ruff, 프런트 lint · tsc · vitest 1625. 스모크는 스텝 2에서(`PREPARE=1` 단계의 AI suggested 탭 검사는 카드 기준으로 바꿀 몫).

- **혼자 연달아 고쳐도 나던 "다른 사람이 먼저 바꿨습니다"(`fix/assign-self-conflict`)** — 사용자 보고: 혼자일 때도 Assign에서 동시 작업 토스트가 잦고 굼뜨다. 1인 편집 잠금을 검토했지만 원인이 아니었다 — 편집이 끝나면 `busy`가 바로 풀리는데 화면의 문서 revision은 다시 받기(요청 10여 개)가 끝나야 바뀌어, 그 사이 다음 편집이 낡은 revision으로 409 `revision_conflict` → 토스트 + 또 다시 받기였다. 문서 쓰기(편집·되돌리기·짝·캡션 참조)를 `lib/doc-revision.ts` `sendDocWrite`로 보내 이 탭이 응답으로 받은 revision과 화면 값 중 큰 것을 보낸다(대상은 Unit id라 낡은 보기로 보내도 없어진 Unit은 서버가 따로 거절, 남·AI의 쓰기는 그대로 409). 남은 것: 편집마다 다시 받는 양 줄이기(느림의 나머지)는 재어 본 뒤 따로. 확인: vitest 새 시험 5 · lint · tsc, `assign:` 스모크 839 통과.

- **v1.2.0 정식 업데이트(`dev` → `main`)** — v1.1.1~v1.1.54를 릴리스 항목 하나로 모으고, 그때까지의 항목을 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)로, CHANGELOG v1.0.0을 아카이브로 옮겼다. 사용 설명서 그림을 다시 찍고 설명서 버전을 1.2로 올렸다. 끝난 구현 계획 12개와 이어하기 핸드오프를 지우고(코드 주석이 가리키는 표 풀기 · 후속 명세와 API 계약 · 신뢰 기반 계획은 남김) 색인의 낡은 상태 표시를 고쳤다.
  - 확인: 설명서 그림 20장 다시 찍음, 겹침 감사 72 · 대비 감사 통과, 전체 스모크 ALL PASS 1,825, 배치 감사(DS=worst) 196 통과 — R2의 기대값이 v1.1.18 전의 한 줄 Remark 그대로라 두 줄(`clamp-2`)로 고쳤다.
