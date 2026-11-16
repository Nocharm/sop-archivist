# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.1.0(2026-11-16 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-16

- **끌어다 놓기 설계·1걸음 계획 추가(`feat/drag-and-drop`)** — 손잡이 없이 상자 전체를 끄는 공통 규칙(G1~G13)과 Order 줄 순서·깊이를 첫 걸음으로 정했다. 명세·계획·인덱스를 먼저 커밋하고 코드는 Task마다 따로.
- **공통 끌기 층(`lib/box-drag.ts`·`use-box-drag.ts`)** — 손잡이 없이 상자 전체를 4px 넘게 끌고 Esc로 취소하며 가장자리에서 스스로 스크롤하는 엔진과 얇은 훅, 끌기 표현 CSS를 더했다. 끄는 동안 툴팁은 뜨지 않는다. 화면은 아직 안 붙였다(Task 2~).
- **끌기 층 보강(리뷰 1회차)** — 끄는 도중 창이 포커스를 잃거나(blur) 숨겨지면(visibilitychange) 취소해 `user-select: none`·grabbing이 남지 않게 했다. 훅은 마지막 config를 ref로 들고 있어 config가 null이 되거나 화면이 사라질 때의 취소(`onEnd`)가 던지지 않는다.
- **v1.1.0 정식 업데이트(`dev` → `main`)** — v1.0.1~v1.0.37을 릴리스 항목 하나로 모으고, 그때까지의 항목을 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)로 옮겼다. 사용 설명서 그림을 다시 찍었다. 끝난 구현 계획 둘(EQUIS 조회, 워크플로우 B1)을 지웠다. 설계 문서는 지우지 않았다 — 코드 주석이 절 번호로 가리키거나(되돌리기·EQUIS·참조 줄) 다른 세션이 이어 쓰는 것(AI 미리 돌리기)이라 다음 정리 때 본다.
