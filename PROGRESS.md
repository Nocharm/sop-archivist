# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.2.0(2026-11-19 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-19

- **AI는 제안 기록에만 — 스텝 1 서버(`feat/ai-suggest-only-1-server`)** — 분류·묶기·다듬기의 `apply`가 `ai_suggestions` 행만 쓴다(자리·처분·언어별 고쳐 쓴 글·변경 종류, 묶기는 `links`·`target_change_types`). "살아 있는 제안"은 판단 포인터 대신 `applied`·채택 없음 행의 `content`로 찾는다. 판단의 `ai_suggested`를 진행 숫자·검토 조건에서 걷고, 새 문장의 `ai_suggested`는 AI 번역 줄(D5)이라 남겼다(사용자 결정). 채택이 판단 포인터에 기대던 터라 저장의 `suggestion_id`(D2 서버 쪽)를 이 스텝에 당겼다(사용자 결정). Alembic `0031`이 AI가 쓴 입구 1 새 문장·AI 번역을 지우고 입구 2 새 문장·판단(AI 무효 보류 포함)을 미배정으로 돌린다. 불변식 시험 "AI 핸들러는 판단·새 문장을 쓰지 않는다"(번역·짝 제외). 브랜치 끝 검토에서 넷을 더 고쳤다 — 받지 않고 확정한 줄의 제안을 밀어내기(지운 뒤 다시 분류되게), 문서를 가로지른 묶기 제안도 분류를 막기, `0031`이 AI 표 아래 칸 번역을 지우고 살아 있는 옛 제안을 새 내용 모양으로 옮기기, 무효 제안은 받지 않기. 화면은 tsc가 도는 만큼만(진행 숫자 타입) — 카드·Use·설명서는 스텝 2.

- **AI는 제안 기록에만 — 설계(`feat/ai-suggest-only`, 구현 전)** — 혼자 쓰는데도 Assign의 "다른 사람이 먼저 바꿨습니다"와 굼뜸의 남은 원인이 배경 AI 분류가 판단 revision을 올리고 New 문장을 직접 쓰는 것임을 로컬에서 재현했다(보류 12번 중 2번 409). 사용자가 AI를 보조 수단으로 돌리기로 정했다 — AI는 `ai_suggestions`만 쓰고 사람이 **Use**로 받아 확정, 종류별 일괄 수락, DB는 지워도 됨. 설계 `docs/superpowers/specs/2026-11-19-ai-suggest-only-design.md`, 스텝 셋 + 따로 `feat/assign-inline-actions`(그 자리 메뉴 → 문단 상자 안 단추 줄).

- **v1.2.0 정식 업데이트(`dev` → `main`)** — v1.1.1~v1.1.54를 릴리스 항목 하나로 모으고, 그때까지의 항목을 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)로, CHANGELOG v1.0.0을 아카이브로 옮겼다. 사용 설명서 그림을 다시 찍고 설명서 버전을 1.2로 올렸다. 끝난 구현 계획 12개와 이어하기 핸드오프를 지우고(코드 주석이 가리키는 표 풀기 · 후속 명세와 API 계약 · 신뢰 기반 계획은 남김) 색인의 낡은 상태 표시를 고쳤다.
  - 확인: 설명서 그림 20장 다시 찍음, 겹침 감사 72 · 대비 감사 통과, 전체 스모크 ALL PASS 1,825, 배치 감사(DS=worst) 196 통과 — R2의 기대값이 v1.1.18 전의 한 줄 Remark 그대로라 두 줄(`clamp-2`)로 고쳤다.
