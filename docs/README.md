# docs/ 인덱스

문서 구조 규칙은 [`rules/common/documentation.md`](../rules/common/documentation.md) 참조. 새 문서를 추가하면 이 표에 한 줄 더한다.

| 문서 | 내용 |
|------|------|
| [superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md](superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md) | 제품 설계: SOP 재구성 End-to-End(쪼개기 → 분류·제안 → 결과물 A·B·C, 두 입구, 데이터 모델, AI 경계, 화면 인수인계) |
| [superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md](superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md) | 구현 계획 2: AI 층(v0.3.0 — 구현 완료, 다시 실행하지 않는다). 살아 있는 부분은 프런트와 맞춘 "API 계약" 블록. 계획 1(결정적 코어, v0.2.0)과 기반 세팅 계획(v0.1.0)은 끝나서 지웠다(git history) — 계획이 정한 세부는 설계 문서에 "(계획 N에서 정함)"으로 반영 |
| [superpowers/specs/2026-11-09-ui-feedback-revamp-design.md](superpowers/specs/2026-11-09-ui-feedback-revamp-design.md) | 첫 실사용 피드백 개편(v0.9.0) 설계 — 공통 부품·라벨 원칙·Bundle 바로 생성·History·문서 정보 탐지·Split 종이 조각·피커. 구현 계획과 승인 목업은 main 머지 뒤 지웠다(git history) |
| [superpowers/specs/2026-11-09-assign-unified-design.md](superpowers/specs/2026-11-09-assign-unified-design.md) | 3단계 Assign 통합 화면(v0.10.0) 설계 — 분류·짝 맞추기를 Old 조각 한 줄씩 처리하는 한 화면으로, 두 문서 나란히·문서별 확대·우선순위 아코디언. 구현 계획과 목업은 main 머지 뒤 지웠다(git history) |
| [superpowers/specs/2026-11-12-paper-marks-filter-fold-design.md](superpowers/specs/2026-11-12-paper-marks-filter-fold-design.md) | 용지 표시 정리 설계 — Split·Assign 왼쪽 번호 칸·언어 막대·보류 칩·짝 카드(P2), 문장 앞 번호 숨김, Unit 상태 칩 한 벌, Assign 필터 접기(F3), 첫 진입 All |
| [superpowers/specs/2026-11-12-language-axis-design.md](superpowers/specs/2026-11-12-language-axis-design.md) | 언어 축 걷어 내기 명세 수정안 — (1)~(3)은 v0.16.6에서 구현해 제품 명세에 흡수했고 (4) 결과물·번호가 남았다. 묶기 하나, 언어로 막지 않는 배정·Remark, 숫자·검토 조건·결과물을 한 벌(줄 기준)로, 용지 언어 표시 삭제. 결과물(Excel·미리보기) 작업에 넘기는 합의 포함 |
| [superpowers/plans/2026-11-13-language-axis.md](superpowers/plans/2026-11-13-language-axis.md) | 구현 계획: 언어 축 (1)~(3)(v0.16.6 dev, 구현 완료 — 다시 실행하지 않는다) — 줄 기준 숫자·검토 조건, 쪼개기 `Join`, 용지 언어 표시 삭제, 배정 잠금 해제·짝 정하기·Remark. 결과물·번호 (4)는 다음 작업 |
| [../frontend/docs/design/2026-11-07-frontend-design-foundations.md](../frontend/docs/design/2026-11-07-frontend-design-foundations.md) | 프런트 디자인 기초 — 토큰(색 값의 단일 소스는 `frontend/src/styles/tokens.css`)·글꼴·화면 구조·상태 표현·동작 규칙·언어. 화면 코드 주석이 "디자인 문서 N절"로 절 번호를 참조한다 |
| [domain/restructuring-rules.md](domain/restructuring-rules.md) | SOP 재구성 판단 기준(R01–R13, SOP 일곱 칸, WI Instruction/Why, 고쳐 쓰기 원칙) — AI 지침의 원문·테스트 정답의 근거 |
| [domain/restructuring-cases.md](domain/restructuring-cases.md) | SOP 재구성 사례(QC Centrifuge 등)와 데이터를 쓰는 원칙 |
| [manual/system-walkthrough.html](manual/system-walkthrough.html) | 시스템 설명서(v0.8.0) — 합성 묶음 하나를 처음부터 끝까지 실제 화면(번호 표시)으로 따라가며 용어·데이터 모양·단계별 동작·AI 경계·결과물·검토·라이프사이클·관리자 화면과 권한·피드백해 볼 곳을 설명한다. 브라우저로 연다. 그림은 `frontend/scripts/pw-manual-shots.mjs`로 다시 뽑는다(옛 `deploy/workflow-manual.html`을 대체) |
| [../frontend/public/manual/user-manual.md](../frontend/public/manual/user-manual.md) | 사용 설명서(사용자용, 한국어) — 앱의 `/manual` 화면이 이 Markdown 한 벌을 조각으로 나눠 보인다(상단 바 도움말). 문서 올리기부터 검토까지의 순서, AI가 하는 일과 하지 않는 일, 권한, 자주 묻는 것, 용어. 화면을 바꾸면 같은 커밋에서 고친다(`CLAUDE.md` 체크리스트, 가드 `frontend/src/lib/manual-content.test.ts`). 그림은 `MANUAL=app node scripts/pw-manual-shots.mjs`. 위 시스템 설명서는 만든 쪽의 설명(데이터 모양·관리 화면)이고 이쪽은 쓰는 사람의 안내다 |
| [superpowers/specs/2026-11-04-sop-archivist-baseline-design.md](superpowers/specs/2026-11-04-sop-archivist-baseline-design.md) | 기반 세팅 설계(범위·사내 서버 제약·이식 목록·권한 체계) |
| [deploy/setup-once.md](deploy/setup-once.md) | 서버 최초 1회 셋업 — GitLab·러너·배포 폴더, `.env`, Keycloak 클라이언트, 첫 파이프라인·`FORWARDED_ALLOW_IPS`, 첫 HR 동기화, `permission.manage` 위임, 절대 하지 말 것 |
| [deploy/gitlab-runner.md](deploy/gitlab-runner.md) | GitLab Runner 배포 파이프라인 — 프로젝트 설정, 러너 두 개 등록, 배포 폴더, 평소 흐름, `.env`만 바꿀 때, 가드 메시지별 트러블슈팅, 되돌리기, 비상 수동 경로 |
| [deploy/deploy.md](deploy/deploy.md) | 매 배포 런북 — GitLab 파이프라인 ▶, 베이스 이미지 tar 반입, 헬스체크, 트러블슈팅, 롤백 |
| [deploy/backup.md](deploy/backup.md) | 일간 DB 백업 정책(덤프에 SOP 원문·원본 파일이 들어 있어 대외비), 기존 스택 복구·신규 서버 복구, 오프서버 사본 |
| [deploy/db-viewer-readonly.md](deploy/db-viewer-readonly.md) | db-viewer 읽기 전용 연결(`dbviewer_ro`, 별칭 `sop-archivist-db`) |
| [qa/2026-11-sop-parse-dependencies.md](qa/2026-11-sop-parse-dependencies.md) | 파싱 의존성·메모리 실측 — MarkItDown 새 패키지 목록, 메인이 될 수 없는 이유, 자식 프로세스 RSS, backend 메모리 상한 결정, Task 8에 넘기는 주의 |
| [qa/2026-11-10-design-workflow-convenience-review.md](qa/2026-11-10-design-workflow-convenience-review.md) | 디자인·워크플로우·편의성 전체 검토(v0.10.1) — 코드 감사 3건 + 극단 자료·5개 화면 조합 확인, 발견 표(근거 `파일:줄`·심각도·처리), 이번에 반영한 것과 보류한 것 |
| [lessons/README.md](lessons/README.md) | 시행착오 방지 — React/TS 패턴, 브라우저 검증 |
| [history/PROGRESS-archive.md](history/PROGRESS-archive.md) | `PROGRESS.md`에서 옮긴 오래된 태스크 단위 기록(v0.1.0–v0.3.0) |

