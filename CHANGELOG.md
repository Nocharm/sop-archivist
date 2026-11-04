# Changelog

SOP Archivist 서비스 버전 기록. 단일 소스는 `frontend/package.json` `version`(SemVer)이고, `Nocharm/sop-archivist`의 `main`에 머지할 때마다 올리고 `vX.Y.Z` 태그를 단다(`rules/common/git.md` "On Main Merge"). 운영 서버 배포 여부와 날짜도 해당 항목에 적는다.

## Unreleased

- (없음)

## v0.1.0 — 2026-11-04

- **범위**: 기반 세팅. 제품 기능(SOP 구조 검토·비교·초안)은 없고, 사내 서버 71번에 바로 올라가 사내 로그인·직원 디렉터리·사내 AI에 붙는 빈 앱이다. 형제 프로젝트 bpm의 사내 인프라를 도메인 결합 없이 이식했다. 설계: `docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`.
- **주요 변경**:
  - 인증: Keycloak OIDC(realm `ai-portal`의 public 클라이언트 `sop-archivist-frontend`, 토큰 `azp` 검사)와 로컬 dev 사용자 전환. 로그인 후 복귀 경로 검증, PKCE는 보안 컨텍스트에서만 켠다.
  - 직원 디렉터리: HR 웹훅(n8n) 동기화(가드 3종·대량 퇴직 기록·회차 이력·내장 스케줄러)와 부서 미러, `/api/me`, 직원·부서 검색 API.
  - 권한: 표 기반 체계(역할=권한 묶음, 개인/부서 부여, 부서 부여는 하위 부서까지 상속, 변경 기록). 권한 4개(`permission.manage`·`directory.sync`·`ai.admin`·`system.view`), `APP_SYSADMINS` 비상 열쇠.
  - 사내 AI: OpenAI 호환 GLM 연결, 호출별 사용량 기록(원문 없음), 관리 화면 연결 테스트.
  - 화면: 로그인 게이트, 상단 바(서비스 이름+버전), 홈(내 신원, 내 권한과 각 권한의 출처 — 역할·부서·직접 부여, `/api/me`의 `sources`), 관리 화면(권한 관리·직원 동기화·배치 작업·AI). UI 영어 기본 + 한국어 전환.
  - 컨테이너: proxy·frontend·backend·db·db-backup 5서비스(포트 7777), Alembic 자동 마이그레이션, 일간 DB 백업 사이드카(04:00 KST·14일 보존·소유자 전용 권한), db-viewer 읽기 전용 합류(`dbv-shared`).
  - 문서: 배포 런북 4종(`docs/deploy/`), `CLAUDE.md`·`README.md`, 시행착오 정리(`docs/lessons/`).
- **배포 메모**: 서버 미배포 — setup-once 대기. 첫 배포는 `docs/deploy/setup-once.md` 순서대로 진행한다(서버 `.env` 작성 `AUTH_MODE=keycloak`·`APP_SYSADMINS` 포함, Keycloak 클라이언트 생성, 첫 기동 뒤 `FORWARDED_ALLOW_IPS`, 첫 HR 동기화 미리보기 → 실행). 서버에 `dbv-shared` 네트워크와 베이스 이미지 4종이 있어야 한다. 배포일은 서버 배포 뒤 여기에 적는다.
