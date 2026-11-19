# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.2.0(2026-11-19 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-19

- **AI는 제안 기록에만 — 설계와 스텝 1 서버(`feat/ai-suggest-only`, v1.2.1)** — 혼자 쓰는데도 Assign의 "다른 사람이 먼저 바꿨습니다"는 배경 AI 분류가 판단 revision을 올리고 New 문장을 직접 쓰기 때문이었다(로컬 재현, 보류 12번 중 2번 409). 사용자가 AI를 보조 수단으로 돌리기로 정했다(설계 `docs/superpowers/specs/2026-11-19-ai-suggest-only-design.md`). 스텝 1: 분류·묶기·다듬기는 `ai_suggestions` 행만 쓰고(내용에 자리·고쳐 쓴 글·변경 종류, 묶기는 `links`·`target_change_types`), 살아 있는 제안은 `content`로 찾는다. 저장의 `suggestion_id`가 판단에 이어 채택을 남기고(D2 서버 쪽을 당김, 사용자 결정), 받지 않고 확정한 줄의 제안은 밀어낸다. 판단의 `ai_suggested`는 진행 숫자·검토 조건에서 걷고 새 문장의 것은 AI 번역 줄로 남겼다(사용자 결정). Alembic `0031`, 불변식 시험 "AI 핸들러는 판단·새 문장을 쓰지 않는다". 사용자 요청으로 스텝 1만 `dev`에 먼저 합쳤다 — 카드·Use·설명서(스텝 2)와 일괄 수락(스텝 3) 전이라 Assign에 AI 제안이 아직 안 보인다.
  - 확인: pytest 3107 · ruff, 프런트 lint · tsc · vitest 1625. 스모크는 스텝 2에서(`PREPARE=1` 단계의 AI suggested 탭 검사는 카드 기준으로 바꿀 몫).

- **v1.2.0 정식 업데이트(`dev` → `main`)** — v1.1.1~v1.1.54를 릴리스 항목 하나로 모으고, 그때까지의 항목을 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)로, CHANGELOG v1.0.0을 아카이브로 옮겼다. 사용 설명서 그림을 다시 찍고 설명서 버전을 1.2로 올렸다. 끝난 구현 계획 12개와 이어하기 핸드오프를 지우고(코드 주석이 가리키는 표 풀기 · 후속 명세와 API 계약 · 신뢰 기반 계획은 남김) 색인의 낡은 상태 표시를 고쳤다.
  - 확인: 설명서 그림 20장 다시 찍음, 겹침 감사 72 · 대비 감사 통과, 전체 스모크 ALL PASS 1,825, 배치 감사(DS=worst) 196 통과 — R2의 기대값이 v1.1.18 전의 한 줄 Remark 그대로라 두 줄(`clamp-2`)로 고쳤다.
