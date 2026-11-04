# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙).

## 2026-11-04

- **SOP Archivist 기반 세팅 설계** — SOP Restructuring T/F용 AI 에이전트를 템플릿에서 분기(`feat/sop-archivist` → 공개 저장소 `Nocharm/sop-archivist`). 제품 기능 전에 bpm의 사내 인프라(서버 71번·포트 7777·Keycloak·HR 디렉터리·사내 GLM·백업·db-viewer)를 이식하고, 표 기반 권한 체계(역할·개인/부서 부여·하위 부서 상속)를 새로 둔다. 설계: `docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`. compose 내부 대역은 배포 전 사용자 확인.

## 2026-08-05

- **`/agile` 커맨드 신설** — 소규모 기능·UI 작업에 테스트 작성·검증 루프가 과하다는 문제로, 완화 룰(테스트 생략·스모크 확인)과 비협상 룰(보안·심플리시티·커밋 컨벤션)을 명시한 모드 전환 커맨드 추가. 범위 이탈 시 일반 모드로 자동 복귀하는 가드 포함.

## 2026-08-01

- **프론트엔드 룰 신설** — UI 요소를 디버깅·테스트·대화에서 안정적으로 특정하기 위해 `data-testid` 식별자 룰(`rules/frontend/identifiers.md`) 추가, CLAUDE.md에 선택적 프론트엔드 블록 신설.
- **guidelines Claude 5 튜닝** — Fable 5 주력 + Opus 5 병용 절충: 준-네이티브 동작(결과 먼저·배칭 등)은 한 줄 리마인더로 유지하되, 자율 진행과 충돌하는 무조건 "ask" 문구는 제거하고 질문 기준을 §1 ask-vs-proceed 표로 일원화.
- **커밋·머지 룰 확장** — 커밋 전: PROGRESS 항목 간소화(1–3줄, 맥락·결정 위주) + README 영향 섹션만 같은 커밋에서 갱신. 머지 시: 브랜치 PROGRESS 항목을 요약 하나로 압축 (브랜치별 파일 분리안은 링크·orphan 유지비용으로 기각).
