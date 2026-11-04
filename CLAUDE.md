<!--
이 파일은 claude-code-template seed.

[다운스트림 프로젝트 시작 시]
1. `/init` 실행 — Project/Commands 섹션 자동 생성
2. `/setup-from-template` 실행 — 사용 안 하는 import 라인 정리, 디자인 토큰 배치, 메타 문서 정리

[이 템플릿 자체를 편집 중이라면]
- 레포 성격, 구조, 편집 컨벤션은 docs/template/README.md 참고.
-->

## Working Style — 최우선 (모든 룰보다 먼저)

**모든 작업의 행동 기반.** 아래 도메인 룰과 충돌해도 이 가이드의 원칙이 우선한다.

@rules/guidelines.md

---

## Rules — 범용 (유지)

@rules/common/comments.md
@rules/common/naming.md
@rules/common/git.md
@rules/common/security.md
@rules/common/error-handling.md
@rules/common/dependencies.md
@rules/common/documentation.md
@rules/common/testing.md

## Rules — 백엔드/Docker (아니면 이 블록 삭제)

배포/컨테이너 전제 규칙. 라이브러리·CLI·프론트 단독 프로젝트면 이 블록을 통째로 삭제한다.

@rules/backend/config.md
@rules/backend/docker.md
@rules/backend/sync-checklist.md

## Rules — 프론트엔드 (아니면 이 블록 삭제)

UI 컴포넌트 작성 규칙. 백엔드·라이브러리·CLI 단독 프로젝트면 이 블록을 통째로 삭제한다.

@rules/frontend/identifiers.md

## Language-Specific Rules

프로젝트에서 사용하는 언어만 남기고 나머지 줄은 삭제한다.

@rules/languages/python.md
@rules/languages/typescript.md
