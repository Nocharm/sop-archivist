# docs/ 인덱스

문서 구조 규칙은 [`rules/common/documentation.md`](../rules/common/documentation.md) 참조. 새 문서를 추가하면 이 표에 한 줄 더한다.

| 문서 | 내용 |
|------|------|
| [superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md](superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md) | 제품 설계: SOP 재구성 End-to-End(쪼개기 → 분류·제안 → 결과물 A·B·C, 두 입구, 데이터 모델, AI 경계, 화면 인수인계) |
| [superpowers/plans/2026-11-05-sop-restructuring-plan1-core.md](superpowers/plans/2026-11-05-sop-restructuring-plan1-core.md) | 구현 계획 1: 결정적 코어(AI 없이 두 입구를 API로 끝까지, 20개 태스크, v0.2.0 — 구현 완료, 계획이 정한 세부는 설계 문서에 "(계획 1에서 정함)"으로 반영) |
| [domain/restructuring-rules.md](domain/restructuring-rules.md) | SOP 재구성 판단 기준(R01–R13, SOP 일곱 칸, WI Instruction/Why, 고쳐 쓰기 원칙) — AI 지침의 원문·테스트 정답의 근거 |
| [domain/restructuring-cases.md](domain/restructuring-cases.md) | SOP 재구성 사례(QC Centrifuge 등)와 데이터를 쓰는 원칙 |
| [superpowers/specs/2026-11-04-sop-archivist-baseline-design.md](superpowers/specs/2026-11-04-sop-archivist-baseline-design.md) | 기반 세팅 설계(범위·사내 서버 제약·이식 목록·권한 체계) |
| [superpowers/plans/2026-11-04-sop-archivist-baseline.md](superpowers/plans/2026-11-04-sop-archivist-baseline.md) | 기반 세팅 구현 계획(12개 태스크) |
| [deploy/setup-once.md](deploy/setup-once.md) | 서버 최초 1회 셋업 — `.env`, Keycloak 클라이언트, 첫 기동·`FORWARDED_ALLOW_IPS`, 첫 HR 동기화, `permission.manage` 위임, 절대 하지 말 것 |
| [deploy/deploy.md](deploy/deploy.md) | 매 배포 런북 — 파이프라인, 베이스 이미지 tar 반입, 헬스체크, 트러블슈팅, 롤백 |
| [deploy/backup.md](deploy/backup.md) | 일간 DB 백업 정책(덤프에 SOP 원문·원본 파일이 들어 있어 대외비), 기존 스택 복구·신규 서버 복구, 오프서버 사본 |
| [deploy/db-viewer-readonly.md](deploy/db-viewer-readonly.md) | db-viewer 읽기 전용 연결(`dbviewer_ro`, 별칭 `sop-archivist-db`) |
| [qa/2026-11-sop-parse-dependencies.md](qa/2026-11-sop-parse-dependencies.md) | 파싱 의존성·메모리 실측 — MarkItDown 새 패키지 목록, 메인이 될 수 없는 이유, 자식 프로세스 RSS, backend 메모리 상한 결정, Task 8에 넘기는 주의 |
| [design/2026-11-06-frontend-first-pass-prompt.md](design/2026-11-06-frontend-first-pass-prompt.md) | 프런트 1차 작업 시작 프롬프트 — 별도 워크트리 세션에 붙일 글, 백엔드 계획 2와 병행하는 규칙 |
| [lessons/README.md](lessons/README.md) | 시행착오 방지 — React/TS 패턴, 브라우저 검증 |

예정 폴더(생길 때 이 표에 추가): `history/`(PROGRESS 아카이브).
