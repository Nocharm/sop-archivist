# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙).

## 2026-11-04

- **SOP Archivist 기반 세팅 v0.1.0 (Task 1–11 압축)** — SOP Restructuring T/F용 AI 에이전트를 템플릿에서 분기해(`feat/sop-archivist` → 공개 저장소 `Nocharm/sop-archivist`) 제품 기능 전에 bpm의 사내 인프라(서버 71번·포트 7777·Keycloak·HR 디렉터리·사내 GLM·백업·db-viewer)를 도메인 결합 없이 이식하고, 표 기반 권한 체계를 새로 두었다. 설계·계획: `docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`, `docs/superpowers/plans/2026-11-04-sop-archivist-baseline.md`. 주요 결정:
  - **스키마**: `create_all`+수동 `_ADDED_COLUMNS`(미등록 컬럼 500 반복 사고) 대신 Alembic을 처음부터 쓴다. 기동 때 head까지 자동 적용하므로 backend는 단일 워커다. 모델 변경 누락은 `test_models_match_migrations`, CHECK 제약은 마이그레이션된 DB에 직접 부딪쳐 확인한다.
  - **인증**: `keycloak|dev` 두 모드만. realm `ai-portal`을 다른 사내 앱과 공유하므로 토큰 `azp`가 `KEYCLOAK_CLIENT_ID`와 다르면 401이고 client id가 비면 전부 거부(fail closed)한다. 실패 사유는 응답이 아니라 서버 로그에만 남긴다(`%r` 이스케이프·200자). 로그인 복귀 경로는 URL 파서로 origin을 확인해 `//evil.com`류를 막고, PKCE는 `crypto.subtle`이 있을 때만 켠다(Keycloak은 필수로 걸지 않는다).
  - **직원 디렉터리**: HR 웹훅 동기화에 가드 3종·500건 청크를 두고 `source="hr"` 행만 지우거나 비활성화한다(dev 시드 행은 건드리지 않음). 전체 동기화는 모듈 잠금으로 동시에 둘이 돌지 않고, 실패 기록에는 예외 메시지 대신 클래스명+상태만 남겨 웹훅 주소가 새지 않게 했다.
  - **권한**: 개인/부서 부여 → 부서 체인 상속 → 역할 펼침, 더하기만. 판정은 `get_effective_access` 하나를 `require_permission`·`/api/me`·유효 권한 조회가 공유한다. 대상은 FK 없이 두어 개편으로 사라진 부서·사람의 부여도 `subject_missing`으로 보존하고, 역할은 부여가 남으면 지울 수 없다(409+RESTRICT). `/api/access/*`는 라우터 단 게이트, `/api/admin/*`는 엔드포인트별 권한과 전 라우트 순회 테스트.
  - **AI**: `ai_client`(GLM-5.3 사고량 kwargs·동시성 상한)를 이식하고 `call_ai_recorded`가 성공·실패 모두 사용량 한 행을 남긴다(원문 없음). 연결 테스트 오류는 주소·토큰을 뺀 503/502.
  - **프런트**: Next 16.4.3, 사내 공용 lib 이식(`sopa.` 키 접두). `humanizeApiError`는 상태 코드별 사람 말만 보이고(서버 원문은 422 검증 사유에만), 관리 화면은 권한별 탭이다. 평문 HTTP 대응은 `genId`·`copyText`.
  - **컨테이너**: 5서비스·7777·자동 할당 대역(ipam 없음), backend env 전부 `environment:` 매핑(`AUTH_MODE` 기본은 keycloak으로 닫음). 백업 사이드카는 `batch_job_runs`를 만들지 않고 Alembic을 기다리며, 디렉터리 `0700`·덤프 `0600`(직원 디렉터리 포함).
- **Task 12 운영 문서·CLAUDE.md·v0.1.0** — 배포 런북 4종(`docs/deploy/`)을 bpm에서 줄여 이식하고 CLAUDE.md(Commands·Architecture·체크리스트)·README·CHANGELOG `v0.1.0`(서버 미배포)을 채웠다. 로컬 postgres 실측으로 bpm 복구 절차의 결함 둘을 고쳤다(새 볼륨 복원은 `--no-acl`, `DROP ROLE` 전에 `DROP OWNED BY`). `up -d`는 proxy를 다시 만들지 않고 nginx는 시작 때 푼 backend 주소를 계속 쓰므로, backend를 다시 만드는 단계는 `up -d backend && docker compose restart proxy`로 통일했다. 태그는 전체 리뷰 뒤 컨트롤러가 단다.
