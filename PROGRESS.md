# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.1.0(2026-11-16 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-16

- **Assign 작은 개편(v1.1.1, `feat/assign-menu-tidy`)** — 실사용 피드백 묶음. 우클릭 메뉴의 확정을 뺐다(Enter와 같고 늘 꺼져 있었다). 그 자리 메뉴는 이음 선이 New 문장에 닿는 끝에 맞춰 뜬다 — 선 끝은 `link-lines`의 계산을 그대로 쓰고, 선이 그려졌는지는 SVG `data-link`로 본다(안 그려졌으면 예전 자리, 끊기 메뉴도 같은 규칙 — 사용자 결정). 고른 조각은 짝 카드와 같은 2px 문단 테두리로 두르고 글자 윤곽(contour)·hover 언어 칩·맞은편 강조의 고리는 지웠다 — 올린 곳이 고른 것처럼 깜빡였다. 언어·참조 편집은 고름을 비우지 않아 오른쪽 칸·포커스가 그대로다. Shape 언어는 줄마다 KO | EN | REF 세 칸(사용자 선택).
- **v1.1.0 정식 업데이트(`dev` → `main`)** — v1.0.1~v1.0.37을 릴리스 항목 하나로 모으고, 그때까지의 항목을 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)로 옮겼다. 사용 설명서 그림을 다시 찍었다. 끝난 구현 계획 둘(EQUIS 조회, 워크플로우 B1)을 지웠다. 설계 문서는 지우지 않았다 — 코드 주석이 절 번호로 가리키거나(되돌리기·EQUIS·참조 줄) 다른 세션이 이어 쓰는 것(AI 미리 돌리기)이라 다음 정리 때 본다.
