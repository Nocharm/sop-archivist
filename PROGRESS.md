# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.2.0(2026-11-19 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-19

- **v1.2.0 정식 업데이트(`dev` → `main`)** — v1.1.1~v1.1.54를 릴리스 항목 하나로 모으고, 그때까지의 항목을 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)로, CHANGELOG v1.0.0을 아카이브로 옮겼다. 사용 설명서 그림을 다시 찍고 설명서 버전을 1.2로 올렸다. 끝난 구현 계획 12개와 이어하기 핸드오프를 지우고(코드 주석이 가리키는 표 풀기 · 후속 명세와 API 계약 · 신뢰 기반 계획은 남김) 색인의 낡은 상태 표시를 고쳤다.
  - 확인: 설명서 그림 20장 다시 찍음, 겹침 감사 72 · 대비 감사 통과, 전체 스모크 ALL PASS 1,825, 배치 감사(DS=worst) 196 통과 — R2의 기대값이 v1.1.18 전의 한 줄 Remark 그대로라 두 줄(`clamp-2`)로 고쳤다.
