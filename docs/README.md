# docs/ 인덱스

문서 구조 규칙은 [`rules/common/documentation.md`](../rules/common/documentation.md) 참조. 새 문서를 추가하면 이 표에 한 줄 더한다.

| 문서 | 내용 |
|------|------|
| [superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md](superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md) | 제품 설계: SOP 재구성 End-to-End(쪼개기 → 분류·제안 → 결과물 A·B·C, 두 입구, 데이터 모델, AI 경계, 화면 인수인계) |
| [superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md](superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md) | 구현 계획 2: AI 층(v0.3.0 — 구현 완료, 다시 실행하지 않는다). 살아 있는 부분은 프런트와 맞춘 "API 계약" 블록. 계획 1(결정적 코어, v0.2.0)과 기반 세팅 계획(v0.1.0)은 끝나서 지웠다(git history) — 계획이 정한 세부는 설계 문서에 "(계획 N에서 정함)"으로 반영 |
| [superpowers/specs/2026-11-09-assign-unified-design.md](superpowers/specs/2026-11-09-assign-unified-design.md) | 3단계 Assign 통합 화면(v0.10.0) 설계 — 분류·짝 맞추기를 Old 조각 한 줄씩 처리하는 한 화면으로, 두 문서 나란히·문서별 확대·우선순위 아코디언. 구현 계획과 목업은 main 머지 뒤 지웠다(git history) |
| [superpowers/specs/2026-11-13-assign-undo-design.md](superpowers/specs/2026-11-13-assign-undo-design.md) | Assign 되돌리기·다시 하기(v0.16.13) 설계 — 판단 단계 스냅숏, 거절(409 `undo_conflict`) 목록 §5.3. 코드 주석이 절 번호로 가리키는 살아 있는 계약 |
| [superpowers/specs/2026-11-13-equis-lookup-design.md](superpowers/specs/2026-11-13-equis-lookup-design.md) | EQUIS 문서 번호 조회 1단계(v1.0.1) 설계 — 줄마다의 표시와 판정 규칙(§6), 옛 번호 따라가기(§7), 제목 따라가기와 잠금(§8.3), 조회 창구(db-viewer의 `dbv-query`). 2·3단계(REF 문단, 결과물)는 워크플로우 개편 뒤 |
| [superpowers/specs/2026-11-15-ref-paragraph-design.md](superpowers/specs/2026-11-15-ref-paragraph-design.md) | REF 문단(참조 줄) 설계 — EQUIS 2단계. 타입을 KO·EN 자리에 두기, 제안은 읽을 때 계산, 확인·참조 아님, 그 번호의 EQUIS 표시, 빠지는 검사, 만드는 순서 |
| [superpowers/specs/2026-11-15-assign-merge-documents-design.md](superpowers/specs/2026-11-15-assign-merge-documents-design.md) | 원문 고치기를 Assign에 합치기(한 단·양 단 보기, 옮겨 올 도구 표, 오른쪽 칸 세 걸음), Documents를 목록 둘·올리는 창구 하나로, 번호로 새 문서 더하기와 EQUIS 채움, 새 문서 목록 AI 읽기 — 만드는 순서 여섯 걸음(§6, 1번은 v1.0.20) |
| [superpowers/specs/2026-11-15-ai-prepare-queue-design.md](superpowers/specs/2026-11-15-ai-prepare-queue-design.md) | AI 미리 돌리기와 대기 줄 순서 설계(시연 피드백 "AI 속도"의 서버 쪽, 구현됨 — 버전은 dev에 올릴 때 매긴다) — 작업 순위와 묶기 먼저(§3), 계획이 묶기 제안을 바로 쓰고 LLM은 다듬기(§4), 저절로 시작하는 두 자리와 `AI_AUTO_PREPARE`(§5), 일괄 삭제·이동이 AI 제안 줄을 받는다(§6), 회사에서 확인할 것(§12). 정확도·이유 보이기·매칭 필터는 따로(머리 표) |
| [superpowers/plans/2026-11-15-ai-prepare-queue-plan.md](superpowers/plans/2026-11-15-ai-prepare-queue-plan.md) | 위 설계의 구현 계획 — Task 10개(대기 줄 순서 → 묶기 제안 → 읽기 끝 계획 → 일괄 → 첫 진입 분류 → 다시 받기). 브랜치 `feat/ai-speed-accuracy`, 10개 모두 구현됨(버전은 dev에 올릴 때 매긴다) |
| [superpowers/specs/2026-11-16-drag-and-drop-design.md](superpowers/specs/2026-11-16-drag-and-drop-design.md) | 끌어다 놓기 설계(1걸음 — 끌기 층 + Order —, 1b걸음 — Order 다른 칸으로 끌기 —, 2걸음 — Assign 잇기 —, 3걸음 — Assign 보내기 —, 4걸음 — Pair view와 가까운 줄 짝 — 구현됨) — 손잡이 없이 상자 전체 끌기와 Alt 글자 긁기(§4 공통 규칙 G1~G13), Order 줄 순서·깊이와 줄 끝 단추를 호버·포커스에만(§5), Assign 잇기와 문장 사이에 보내기(§6, 서버는 자리 하나 받기 §8), Pair view(§7), 만드는 순서 네 걸음(§10). Documents 화면과 참조 지도는 따로 쓴다 |
| [superpowers/plans/2026-11-16-drag-layer-order-plan.md](superpowers/plans/2026-11-16-drag-layer-order-plan.md) | 위 설계의 1걸음 구현 계획 — 공통 끌기 층(`box-drag`)과 Order 화면의 줄 끌기(순서·깊이). 브랜치 `feat/drag-and-drop`, 구현됨(버전은 `dev`에 올릴 때 매긴다) |
| [superpowers/plans/2026-11-16-order-cross-section-plan.md](superpowers/plans/2026-11-16-order-cross-section-plan.md) | 위 설계의 1b걸음 구현 계획 — Order에서 줄 덩어리를 같은 New 문서의 다른 칸(SOP 칸·WI 단계)으로 끌기(서버 `slot_key` → 편집 모델 → 놓을 자리 모델 → 화면). 브랜치 `feat/order-cross-section`, 구현됨(v1.1.5) |
| [superpowers/plans/2026-11-16-assign-drag-link-plan.md](superpowers/plans/2026-11-16-assign-drag-link-plan.md) | 위 설계의 2걸음 구현 계획 — Assign의 Old 조각을 이미 쓴 New 문장에 끌어 놓으면 클릭으로 이을 때와 같은 상태(놓기 모델 `assign-drop-model` → 화면 → 극단 자료 검토). 브랜치 `feat/assign-drag-link`, 구현됨(v1.1.6) |
| [superpowers/plans/2026-11-17-assign-drag-send-plan.md](superpowers/plans/2026-11-17-assign-drag-send-plan.md) | 위 설계의 3걸음 구현 계획 — Assign의 Old 조각을 아직 쓰지 않은 New 문서의 문장 사이·빈 칸과 옆 패널 **All** 의 칸·step 줄에 끌어 놓기(서버 `position` 자리 받기 → 놓기 모델 → New 칸 → 나무 → 극단 자료 검토). 브랜치 `feat/assign-drag-send`, 구현됨(v1.1.7) |
| [superpowers/plans/2026-11-17-pair-view-plan.md](superpowers/plans/2026-11-17-pair-view-plan.md) | 위 설계의 4걸음 구현 계획 — 한/영 따로 문서를 KO \| EN 두 칸으로 펴는 Pair view에서 조각을 맞은편 언어 조각에 끌어 짝 맺기·제안 확정, 연달아 문서는 Old 칸 안에서 같은 끌기, 알림의 **Undo**(알림의 행동 단추 → 놓기 모델 `pair-drop-model` → Pair view 화면 → 끌기 → 가까운 줄 → 극단 자료 검토). 브랜치 `feat/pair-view`, 구현됨(v1.1.8) |
| [superpowers/specs/2026-11-17-documents-screen-design.md](superpowers/specs/2026-11-17-documents-screen-design.md) | Documents 화면 설계 — 값이 글자로 보이는 두 줄 목록, WI 줄을 SOP 줄에 끌어 상위 SOP 바꾸기(알림의 **Undo**), Old · New 두 묶음 올리기 창, SOP 칸 15개의 N/A 상태 표. 미구현 |
| [superpowers/plans/2026-11-17-documents-na-table-plan.md](superpowers/plans/2026-11-17-documents-na-table-plan.md) | 위 설계의 1·2걸음 구현 계획 — N/A 칸 상태 표와 New 목록 두 줄(서버는 New 목록 응답에 `slot_counts` 하나). 미구현 |
| [superpowers/plans/2026-11-17-documents-lists-upload-plan.md](superpowers/plans/2026-11-17-documents-lists-upload-plan.md) | 위 설계의 3·4·5걸음 구현 계획 — WI를 SOP에 끌기와 Undo, Old 목록 두 줄, 올리기 창 두 묶음(서버 변경 없음). 미구현 |
| [superpowers/specs/2026-11-17-reference-map-design.md](superpowers/specs/2026-11-17-reference-map-design.md) | 참조 지도 설계 — Bundle 안의 Map 화면(List · 지도)에서 문서 사이 참조와 후속 문서를 보이고, 구성원이 아닌 Bundle은 번호·제목·상태·수만(서버 응답에서부터). 미구현 |
| [superpowers/plans/2026-11-17-reference-map-plan.md](superpowers/plans/2026-11-17-reference-map-plan.md) | 위 설계의 1·2걸음 구현 계획 — 읽기 전용 요약 API(`GET …/map`), Map 레일, List, 지도 그리기. 미구현 |
| [superpowers/plans/2026-11-17-reference-map-lines-plan.md](superpowers/plans/2026-11-17-reference-map-lines-plan.md) | 위 설계의 3걸음 구현 계획 — 구성원에게만 보이는 문장(`GET …/map/lines`)과 줄의 **Open in Assign**. 미구현 |
| [superpowers/specs/2026-11-14-four-step-workflow-design.md](superpowers/specs/2026-11-14-four-step-workflow-design.md) | 네 단계 워크플로우 설계(B1·B2·B4, 확정 = 경계, 보낼 곳 추가·삭제까지 구현, v1.0.13. Split 화면은 배정 화면 안의 원문 고치기가 됐고 경계 확인 단추가 없어졌다. 남은 것은 확인 API 정리 — §11) — 문서 / 쪼개기&배정 / 순서·번호 / 결과. 배정 확정 = 경계 확인(§5), 사용성 기준(§7), 만드는 순서 B1~B4(§11) |
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
| [qa/verification-commands.md](qa/verification-commands.md) | 로컬 실행·검증 명령 전체(bash·PowerShell) — 시드·서버·테스트·브라우저 스모크·배치/겹침/대비 감사·설명서 그림·가짜 AI·배포 스크립트 검증의 전제와 옵션 |
| [qa/2026-11-10-design-workflow-convenience-review.md](qa/2026-11-10-design-workflow-convenience-review.md) | 디자인·워크플로우·편의성 전체 검토(v0.10.1) — 코드 감사 3건 + 극단 자료·5개 화면 조합 확인, 발견 표(근거 `파일:줄`·심각도·처리), 이번에 반영한 것과 보류한 것 |
| [lessons/README.md](lessons/README.md) | 시행착오 방지 — React/TS 패턴, 브라우저 검증 |
| [history/PROGRESS-archive.md](history/PROGRESS-archive.md) | `PROGRESS.md`에서 옮긴 지난 기록(v0.1.0–v1.0.0) — 정식 업데이트마다 그 릴리스까지의 항목이 맨 위로 온다 |
| [history/CHANGELOG-archive.md](history/CHANGELOG-archive.md) | `CHANGELOG.md`에서 옮긴 지난 릴리스 항목(0.x — v0.1.0–v0.16.0) |

