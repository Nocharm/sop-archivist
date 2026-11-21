# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.5.0(2026-11-21 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 이 파일이 크기 상한을 넘으면 최근 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "문서 정리").


## 2026-11-21 — 버전 규칙: 개발 번호를 그대로 운영에 (`chore/version-policy`)

- 운영 번호의 끝자리가 늘 0이고(정식 업데이트마다 MINOR를 새로 만들었다) 개발에서 본 번호와 달라 헷갈린다는 사용자 판단 — `dev` 번호를 그대로 태그해 운영에 올리고, 운영 뒤 첫 `dev` 푸시에 MINOR, 급한 수정은 운영 줄의 PATCH(번호가 `dev`와 겹치지 않는다). v1.5.0 뒤 첫 앱 변경 푸시가 1.6.0.
- 정식 업데이트를 가볍게: 버전 커밋 없음, CHANGELOG는 줄들 위에 제목·배포 메모만, 설명서 그림은 바뀐 장면만, CHANGELOG·PROGRESS 보관은 `release-docs.test.ts` 크기 상한(각 4만 바이트)이 알릴 때 따로. 설명서 머리 `version`은 `X.Y.Z`로, `manual-content.test.ts`가 CHANGELOG 최근 릴리스 제목과 줄(MAJOR.MINOR)을 대조한다.

## 2026-11-21 — md 점검 고침 (`docs/md-audit-fixes`)

- 오늘 버전 규칙에서 설계·계획 삭제를 크기 시험 쪽으로 옮겨 계기가 없어졌던 것을 정식 업데이트 준비로 되돌림. 루트 CLAUDE.md의 지난 기록 문장·세 곳에 겹친 설명서 그림 규칙을 줄이고, `sync-checklist.md`를 이 저장소의 파일(`.env.example`·compose `environment:`·기능 맵·설명서)로 바꿈.
- 끝난 신뢰 기반 계획 문서를 지움 — 아직 쓰일 스텝 4-3의 생각은 문단 분리 요청서로 옮기고, 코드 주석은 파일 이름만, 문서 링크는 글로 낮춤.
