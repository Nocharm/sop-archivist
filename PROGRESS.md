# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.0.0(2026-11-14 운영 배포)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 정식 업데이트마다 그 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "정식 업데이트 때 문서 정리").

## 2026-11-14

- **1.0.0 문서 정리(브랜치 `chore/md-tidy` → dev)** — 세션이 무겁다는 피드백으로 1.0.0에 맞춰 md를 정리했다(사용자가 범위를 골랐다). 늘 실리는 양(루트 CLAUDE.md + `@` 불러오기)이 약 1.7만 → 9.6천 토큰: 상태 줄은 이력 대신 버전·배포·검증 상태만, 명령 전체(bash·PowerShell·전제)는 `docs/qa/verification-commands.md`로 옮기고 자주 쓰는 bash만, 운영 표는 제약을 그대로 두고 문장만 압축, Python·설정 규칙은 `backend/CLAUDE.md`·TypeScript·식별자 규칙은 `frontend/CLAUDE.md`가 불러오고 docker·sync 규칙은 필요할 때 읽게. 커밋 때 읽는 PROGRESS·CHANGELOG의 1.0.0 이전 기록은 `docs/history/`로(약 4만 → 1.6천 토큰). 끝난 설계 스냅숏 셋(11-09 피드백 개편·11-11 v0.14 피드백·11-12 용지 표시)은 지웠고 코드가 가리키는 Assign 통합·되돌리기 설계는 남겼다. 앞으로도 유지되게 `rules/common/git.md`에 "정식 업데이트 때 문서 정리"를 더했다(사용자 요청). README 현재 상태 문단도 1.0.0으로.
