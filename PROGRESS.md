# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.1.0(2026-11-16 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-16

- **Assign 우클릭 메뉴에서 확정 빼기(v1.1.1)** — 우클릭 확정은 Enter와 같은 일인데 보낼 곳을 고르기 전에는 늘 꺼져 있어 쓰이지 않았다. 메뉴 모델의 `confirm`·`hasDestination`·`isConfirmedAsIs`와 보낼 곳 이름 표시(`readDestinationLabel`·`.ctx-hint`)를 함께 지웠다.
- **그 자리 메뉴를 New 쪽 선 끝에(v1.1.1)** — 누른 곳 근처에 뜨면 어느 연결을 확정하는지 읽히지 않았다. 선 끝 계산은 `link-lines`의 것을 그대로 쓰고(`readNewLineEnd`), 선이 실제로 그려졌는지는 SVG의 `data-link`로 본다 — 그려지지 않았으면 예전 자리라 한 단 보기·선 끔·스크롤 밖을 따로 가리지 않는다. 고른 직후엔 선이 아직 없을 수 있어 메뉴가 나타나는 순간(`animationstart`) 한 번 더 잰다. 끊기 메뉴도 같은 규칙(사용자 결정).
- **v1.1.0 정식 업데이트(`dev` → `main`)** — v1.0.1~v1.0.37을 릴리스 항목 하나로 모으고, 그때까지의 항목을 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)로 옮겼다. 사용 설명서 그림을 다시 찍었다. 끝난 구현 계획 둘(EQUIS 조회, 워크플로우 B1)을 지웠다. 설계 문서는 지우지 않았다 — 코드 주석이 절 번호로 가리키거나(되돌리기·EQUIS·참조 줄) 다른 세션이 이어 쓰는 것(AI 미리 돌리기)이라 다음 정리 때 본다.
