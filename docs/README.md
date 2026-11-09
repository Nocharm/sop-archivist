# docs/ 인덱스

문서 구조 규칙은 [`rules/common/documentation.md`](../rules/common/documentation.md) 참조. 새 문서를 추가하면 이 표에 한 줄 더한다.

| 문서 | 내용 |
|------|------|
| [superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md](superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md) | 제품 설계: SOP 재구성 End-to-End(쪼개기 → 분류·제안 → 결과물 A·B·C, 두 입구, 데이터 모델, AI 경계, 화면 인수인계) |
| [superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md](superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md) | 구현 계획 2: AI 층(v0.3.0 — 구현 완료, 다시 실행하지 않는다). 살아 있는 부분은 프런트와 맞춘 "API 계약" 블록. 계획 1(결정적 코어, v0.2.0)과 기반 세팅 계획(v0.1.0)은 끝나서 지웠다(git history) — 계획이 정한 세부는 설계 문서에 "(계획 N에서 정함)"으로 반영 |
| [../frontend/docs/design/2026-11-07-frontend-design-foundations.md](../frontend/docs/design/2026-11-07-frontend-design-foundations.md) | 프런트 디자인 기초 — 토큰(색 값의 단일 소스는 `frontend/src/styles/tokens.css`)·글꼴·화면 구조·상태 표현·동작 규칙·언어. 화면 코드 주석이 "디자인 문서 N절"로 절 번호를 참조한다 |
| [domain/restructuring-rules.md](domain/restructuring-rules.md) | SOP 재구성 판단 기준(R01–R13, SOP 일곱 칸, WI Instruction/Why, 고쳐 쓰기 원칙) — AI 지침의 원문·테스트 정답의 근거 |
| [domain/restructuring-cases.md](domain/restructuring-cases.md) | SOP 재구성 사례(QC Centrifuge 등)와 데이터를 쓰는 원칙 |
| [superpowers/specs/2026-11-04-sop-archivist-baseline-design.md](superpowers/specs/2026-11-04-sop-archivist-baseline-design.md) | 기반 세팅 설계(범위·사내 서버 제약·이식 목록·권한 체계) |
| [deploy/workflow-manual.html](deploy/workflow-manual.html) | 그림으로 보는 작업 흐름 설명서(v0.7.0 기준) — 전체 흐름·개요 화면·입구 1/2·분류·상태 변화·검토 조건·AI·막힌 곳·첫 배포 순서. 브라우저로 연다. 코드가 바뀌면 낡으니 기준 커밋을 꼬리말에서 본다. **9절 첫 배포 순서는 서버에서 직접 `up` 하던 시절 것이라 낡았다** — 첫 배포는 [setup-once.md](deploy/setup-once.md)·[gitlab-runner.md](deploy/gitlab-runner.md)를 따른다 |
| [deploy/setup-once.md](deploy/setup-once.md) | 서버 최초 1회 셋업 — GitLab·러너·배포 폴더, `.env`, Keycloak 클라이언트, 첫 파이프라인·`FORWARDED_ALLOW_IPS`, 첫 HR 동기화, `permission.manage` 위임, 절대 하지 말 것 |
| [deploy/gitlab-runner.md](deploy/gitlab-runner.md) | GitLab Runner 배포 파이프라인 — 프로젝트 설정, 러너 두 개 등록, 배포 폴더, 평소 흐름, `.env`만 바꿀 때, 가드 메시지별 트러블슈팅, 되돌리기, 비상 수동 경로 |
| [deploy/deploy.md](deploy/deploy.md) | 매 배포 런북 — GitLab 파이프라인 ▶, 베이스 이미지 tar 반입, 헬스체크, 트러블슈팅, 롤백 |
| [deploy/backup.md](deploy/backup.md) | 일간 DB 백업 정책(덤프에 SOP 원문·원본 파일이 들어 있어 대외비), 기존 스택 복구·신규 서버 복구, 오프서버 사본 |
| [deploy/db-viewer-readonly.md](deploy/db-viewer-readonly.md) | db-viewer 읽기 전용 연결(`dbviewer_ro`, 별칭 `sop-archivist-db`) |
| [qa/2026-11-sop-parse-dependencies.md](qa/2026-11-sop-parse-dependencies.md) | 파싱 의존성·메모리 실측 — MarkItDown 새 패키지 목록, 메인이 될 수 없는 이유, 자식 프로세스 RSS, backend 메모리 상한 결정, Task 8에 넘기는 주의 |
| [lessons/README.md](lessons/README.md) | 시행착오 방지 — React/TS 패턴, 브라우저 검증 |
| [history/PROGRESS-archive.md](history/PROGRESS-archive.md) | `PROGRESS.md`에서 옮긴 오래된 태스크 단위 기록(v0.1.0–v0.3.0) |

