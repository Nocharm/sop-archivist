# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.3.0(2026-11-20 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-20 — 겹침 감사 그 자리 메뉴 (fix/link-menu-overlap)

- `assign-link-menu`가 이은 New 줄을 덮는다고 잡던 것은 앱이 아니라 재는 법의 문제였다 — New 문장을 누르면 메뉴는 2026-11-19 결정대로 그 문단 상자 안 글 아래에 단추 줄로 들어가(inline) 상자를 늘리는데, 감사는 그 상자 전체와 겹침을 봤다. 메뉴를 품은 줄은 메뉴 밖 글자 자리와 견주게 했다(다른 이은 줄·고른 Old 글은 그대로). 하위 에이전트가 처음 낸 뜨는 메뉴 배치 변경은 이 장면과 무관해 넣지 않았다.
