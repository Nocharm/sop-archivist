# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙).

## 2026-11-04

- **SOP Archivist 기반 세팅 설계** — SOP Restructuring T/F용 AI 에이전트를 템플릿에서 분기(`feat/sop-archivist` → 공개 저장소 `Nocharm/sop-archivist`). 제품 기능 전에 bpm의 사내 인프라(서버 71번·포트 7777·Keycloak·HR 디렉터리·사내 GLM·백업·db-viewer)를 이식하고, 표 기반 권한 체계(역할·개인/부서 부여·하위 부서 상속)를 새로 둔다. 설계: `docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`. compose 내부 대역은 배포 전 사용자 확인.
- **기반 세팅 구현 계획** — 12태스크(규칙·문서 → backend 기반·인증·디렉터리·권한·운영 API·AI → frontend 기반·화면 → 컨테이너 → 배포 문서·v0.1.0). 모델 변경 누락은 `test_models_match_migrations`가, 백업 사이드카와 마이그레이션 경합은 테이블 대기로 막는다. 계획: `docs/superpowers/plans/2026-11-04-sop-archivist-baseline.md`.
- **Task 1 규칙·문서 골격** — 템플릿의 일반 규칙을 bpm 개정본으로 교체하고(서비스 버전·같은 커밋 갱신·`environment:` 매핑·`# syntax=` 금지·`useEffectEvent`/`<Activity>`), bpm 도메인 낱말은 일반화했다. `docs/lessons/`(React 패턴·브라우저 검증)·CLAUDE.md 제약 표·CHANGELOG·`docs/README.md` 인덱스를 두고 템플릿 메타(`docs/template/`, seed 주석, 옛 PROGRESS 항목)를 지웠다.
- **Task 2 backend 기반** — 설정·KST 시각·async DB를 bpm에서 이식하되 `create_all`+수동 `_ADDED_COLUMNS`(미등록 컬럼 500 반복 사고) 대신 Alembic(1.20.1 고정, async env.py, `render_as_batch`, 제약 이름 규칙)을 도입했다. `run_migrations()`는 cwd와 무관하게 패키지 기준 `alembic.ini`를 쓰고 lifespan에서 `asyncio.to_thread`로 돈다. 모델 변경 시 리비전 누락은 `test_models_match_migrations`(`compare_metadata`)가 잡는다.
- **Task 3 인증** — bpm `auth.py`에서 dev·keycloak만 이식했다(ldap·로컬 계정·HS256 토큰·`/login` 제외). realm `ai-portal`을 다른 사내 앱과 공유하므로 서명·issuer가 맞아도 `azp`가 `KEYCLOAK_CLIENT_ID`와 다르면 401이고, client id가 비었거나 azp가 없으면 fail closed다. 검증 실패 사유는 응답(`invalid token` 고정)이 아니라 서버 로그로만 남긴다. 앱에 로깅 설정이 없어 lastResort가 `%(message)s`만 찍으므로 예외 종류·사유·azp를 메시지 인자에도 싣는다(`extra=` 필드 유지, 토큰 원문 제외). 사유에는 미검증 헤더(kid·crit)가 실려 개행으로 로그 줄을 위조할 수 있어 `%r` 이스케이프·200자 상한을 둔다. 프런트 부팅용 `GET /api/auth/mode`(무인증) 추가.
- **Task 4 직원 디렉터리·HR 동기화** — bpm HR 웹훅 동기화(가드 3종·500건 청크·퇴직 `active=false`·회차 200건·대량 퇴직 기록)와 부서 미러를 이식하되 title·role·position·EDW·AD/로컬 분기·맵 연동(체크아웃 해제·고아 부서 경로)은 걷어 냈다. 동기화는 `source="hr"` 행만 지우고 비활성화하며, 피드에 같은 loginId가 와도 `source="dev"` 시드 행은 건드리지 않는다. 부서 부여 상속의 입력이 될 `get_dept_chain_codes`(끊기면 닿은 데까지·순환은 반복 직전까지)를 두었고, 직원·부서 검색 API(`/api/directory`, `/api/departments`)와 dev 시드를 lifespan에 얹었다.
