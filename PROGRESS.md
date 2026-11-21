# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.5.0(2026-11-21 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 이 파일이 크기 상한을 넘으면 최근 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "문서 정리").


## 2026-11-21 — 버전 규칙: 개발 번호를 그대로 운영에 (`chore/version-policy`)

- 운영 번호의 끝자리가 늘 0이고(정식 업데이트마다 MINOR를 새로 만들었다) 개발에서 본 번호와 달라 헷갈린다는 사용자 판단 — `dev` 번호를 그대로 태그해 운영에 올리고, 운영 뒤 첫 `dev` 푸시에 MINOR, 급한 수정은 운영 줄의 PATCH(번호가 `dev`와 겹치지 않는다). v1.5.0 뒤 첫 앱 변경 푸시가 1.6.0.
- 정식 업데이트를 가볍게: 버전 커밋 없음, CHANGELOG는 줄들 위에 제목·배포 메모만, 설명서 그림은 바뀐 장면만, CHANGELOG·PROGRESS 보관은 `release-docs.test.ts` 크기 상한(각 4만 바이트)이 알릴 때 따로. 설명서 머리 `version`은 `X.Y.Z`로, `manual-content.test.ts`가 CHANGELOG 최근 릴리스 제목과 줄(MAJOR.MINOR)을 대조한다.
