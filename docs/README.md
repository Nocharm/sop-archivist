# docs/ 인덱스

문서 구조 규칙은 [`rules/common/documentation.md`](../rules/common/documentation.md) 참조. 새 문서를 추가하면 이 표에 한 줄 더한다.

| 문서 | 내용 |
|------|------|
| [superpowers/specs/2026-11-04-sop-archivist-baseline-design.md](superpowers/specs/2026-11-04-sop-archivist-baseline-design.md) | 기반 세팅 설계(범위·사내 서버 제약·이식 목록·권한 체계) — 현재 기준 명세 |
| [superpowers/plans/2026-11-04-sop-archivist-baseline.md](superpowers/plans/2026-11-04-sop-archivist-baseline.md) | 기반 세팅 구현 계획(12개 태스크) |
| [deploy/setup-once.md](deploy/setup-once.md) | 서버 최초 1회 셋업 — `.env`, Keycloak 클라이언트, 첫 기동·`FORWARDED_ALLOW_IPS`, 첫 HR 동기화, `permission.manage` 위임, 절대 하지 말 것 |
| [deploy/deploy.md](deploy/deploy.md) | 매 배포 런북 — 파이프라인, 베이스 이미지 tar 반입, 헬스체크, 트러블슈팅, 롤백 |
| [deploy/backup.md](deploy/backup.md) | 일간 DB 백업 정책, 기존 스택 복구·신규 서버 복구, 오프서버 사본 |
| [deploy/db-viewer-readonly.md](deploy/db-viewer-readonly.md) | db-viewer 읽기 전용 연결(`dbviewer_ro`, 별칭 `sop-archivist-db`) |
| [lessons/README.md](lessons/README.md) | 시행착오 방지 — React/TS 패턴, 브라우저 검증 |

예정 폴더(생길 때 이 표에 추가): `qa/`(검증·감사), `design/`(기능별 설계 스냅샷), `history/`(PROGRESS 아카이브).
