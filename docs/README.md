# docs/ 인덱스

문서 구조 규칙은 [`rules/common/documentation.md`](../rules/common/documentation.md) 참조. 새 문서를 추가하면 이 표에 한 줄 더한다.

| 문서 | 내용 |
|------|------|
| [superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md](superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md) | 제품 설계: SOP 재구성 End-to-End(쪼개기 → 분류·제안 → 결과물 A·B·C, 두 입구, 데이터 모델, AI 경계, 화면 인수인계) |
| [superpowers/plans/2026-11-25-split-first-ledger.md](superpowers/plans/2026-11-25-split-first-ledger.md) | 쪼개기 먼저 · 연습 페이지 장부(넘김 문서) — 브랜치별 결과와 "아침에 볼 것". v1.6.43 정식 업데이트를 main에 합친 뒤 지운다 |
| [superpowers/specs/2026-11-23-assign-feedback-2.md](superpowers/specs/2026-11-23-assign-feedback-2.md) | T/F 피드백 2차 명세 원문(17개 항목): 요구 · 문구 · 수용 기준 · 시나리오. v1.6.43까지 모두 끝났고 **F2-R1~R5(To-Be 문서로 이동 · 새 문서 추가 ⇧D)만 보류** — 숨긴 새 문서 기능을 다시 켤 때 함께. 겹치는 곳의 결정은 `architecture/decisions.md` `## 2026-11-25-split-first` 11-1절 |
| [superpowers/handoff/2026-11-19-paragraph-split-requests.md](superpowers/handoff/2026-11-19-paragraph-split-requests.md) | 문서 문단 분리 · 문단 엑셀 개선 요청(사용자, 2026-11-19, 사진에서 옮김) 16항목 + 공통 요구(제로베이스 통일 설계)와 시안 1 · 2 결정. 작은 것 · 시안 1(v1.2.11) · 시안 2(v1.2.12~v1.3.2) 됨 — 남은 것은 끝 "다음 순서"의 4번 2차(매핑 · 비교 엑셀) |
| [qa/feature-map.md](qa/feature-map.md) | 기능 맵(에이전트용) — 화면마다 도달 주소·조작 요점·알려진 함정·스모크 `ONLY` 머리·설명서 자리. 앱이 원본, 맵은 색인(화면을 바꾸면 같은 커밋에서 고친다) |
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
| [qa/2026-11-26-release-frontend-checklist.html](qa/2026-11-26-release-frontend-checklist.html) | 정식 업데이트 화면 체크리스트 — v1.5.0 → v1.6.31 프런트 변경을 화면에서 볼 것(브라우저에서 열어 체크, 정식 업데이트 뒤 지운다) |
| [qa/2026-11-assign-perf.md](qa/2026-11-assign-perf.md) | Assign 반응 시간 실측 — 명령 큐 · 필터 덩어리 앞뒤의 글쇠 → 다음 박스, 연타, 번호 입력, 스크롤 튐(합성 자료, 로컬 운영 빌드) |
| [qa/verification-commands.md](qa/verification-commands.md) | 로컬 실행·검증 명령 전체(bash·PowerShell) — 시드·서버·테스트·브라우저 스모크·배치/겹침/대비 감사·설명서 그림·가짜 AI·배포 스크립트 검증의 전제와 옵션 |
| [qa/2026-11-10-design-workflow-convenience-review.md](qa/2026-11-10-design-workflow-convenience-review.md) | 디자인·워크플로우·편의성 전체 검토(v0.10.1) — 코드 감사 3건 + 극단 자료·5개 화면 조합 확인, 발견 표(근거 `파일:줄`·심각도·처리), 이번에 반영한 것과 보류한 것 |
| [architecture/backend.md](architecture/backend.md) | backend 코드 구조 상세 — `backend/CLAUDE.md`가 줄여 싣는 내용의 원문(기동·권한·SOP 코어 흐름·AI 제안 층·불변식과 이중 사용 지점의 자세한 설명). 구조를 바꾸면 `backend/CLAUDE.md`와 같은 커밋에서 고친다 |
| [architecture/frontend.md](architecture/frontend.md) | frontend 코드 구조 상세 — `frontend/CLAUDE.md`가 줄여 싣는 내용의 원문(공통 lib·순수 모델·Assign·공통 부품·설명서·Map). 구조를 바꾸면 `frontend/CLAUDE.md`와 같은 커밋에서 고친다 |
| [architecture/decisions.md](architecture/decisions.md) | 끝난 기능 설계에서 코드·문서가 아직 인용하는 부분만 글자 그대로 옮긴 것 — 설계마다 `## <stem>` 절(`D3`·`§5.2`·`G3` 같은 원래 이름 그대로), 설계 전문은 git 이력(사용자 결정 2026-11-22) |
| [architecture/api-contract.md](architecture/api-contract.md) | 프런트와 맞춘 AI API 계약 — 구현 계획 2의 "API 계약" 블록을 옮긴 것(경로·응답 모양·`content` 종류별 필드·오류 코드·기존 응답에 더한 필드) |
| [lessons/README.md](lessons/README.md) | 시행착오 방지 — React/TS 패턴, 브라우저 검증 |
| [history/PROGRESS-archive.md](history/PROGRESS-archive.md) | `PROGRESS.md`에서 옮긴 지난 기록(v0.1.0–v1.0.0) — `PROGRESS.md`가 크기 상한을 넘으면 최근 릴리스까지의 항목이 맨 위로 온다 |
| [history/CHANGELOG-archive.md](history/CHANGELOG-archive.md) | `CHANGELOG.md`에서 옮긴 지난 릴리스 항목(0.x — v0.1.0–v0.16.0) |

