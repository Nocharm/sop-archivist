# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙).

## 2026-11-04

- **SOP Archivist 기반 세팅 설계** — SOP Restructuring T/F용 AI 에이전트를 템플릿에서 분기(`feat/sop-archivist` → 공개 저장소 `Nocharm/sop-archivist`). 제품 기능 전에 bpm의 사내 인프라(서버 71번·포트 7777·Keycloak·HR 디렉터리·사내 GLM·백업·db-viewer)를 이식하고, 표 기반 권한 체계(역할·개인/부서 부여·하위 부서 상속)를 새로 둔다. 설계: `docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`. compose 내부 대역은 배포 전 사용자 확인.
- **기반 세팅 구현 계획** — 12태스크(규칙·문서 → backend 기반·인증·디렉터리·권한·운영 API·AI → frontend 기반·화면 → 컨테이너 → 배포 문서·v0.1.0). 모델 변경 누락은 `test_models_match_migrations`가, 백업 사이드카와 마이그레이션 경합은 테이블 대기로 막는다. 계획: `docs/superpowers/plans/2026-11-04-sop-archivist-baseline.md`.
- **Task 1 규칙·문서 골격** — 템플릿의 일반 규칙을 bpm 개정본으로 교체하고(서비스 버전·같은 커밋 갱신·`environment:` 매핑·`# syntax=` 금지·`useEffectEvent`/`<Activity>`), bpm 도메인 낱말은 일반화했다. `docs/lessons/`(React 패턴·브라우저 검증)·CLAUDE.md 제약 표·CHANGELOG·`docs/README.md` 인덱스를 두고 템플릿 메타(`docs/template/`, seed 주석, 옛 PROGRESS 항목)를 지웠다.
