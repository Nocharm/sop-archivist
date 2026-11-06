# Changelog

SOP Archivist 서비스 버전 기록. 단일 소스는 `frontend/package.json` `version`(SemVer)이고, `Nocharm/sop-archivist`의 `main`에 머지할 때마다 올리고 `vX.Y.Z` 태그를 단다(`rules/common/git.md` "On Main Merge"). 운영 서버 배포 여부와 날짜도 해당 항목에 적는다.

## Unreleased

- (없음)

## v0.2.0 — 2026-11-06

- **범위**: SOP 재구성 **결정적 코어**(AI 없음, 구현 계획 1). 사람이 API만으로 두 입구(입구 1 배정, 입구 2 새 문서와 짝 맞추기)를 업로드부터 검토 완료까지 끝까지 처리할 수 있다. **프런트 화면은 아직 없다** — Claude Design 단계에서 붙인다(그래서 서버에 올려도 화면에서 달라지는 것은 상단 바 버전과, 홈 "내 권한"·관리 > 권한 관리 화면에 새 권한 3개가 더 보이는 것뿐이고, SOP 기능은 `/api/bundles…`로만 쓴다). AI 분류·번역·짝 제안은 계획 2다. 검증은 합성 SOP(`SYNTHETIC_` 파일)로만 했고 실제 SOP·사내 모델로는 시험하지 않았다. 설계: `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`, 계획: `docs/superpowers/plans/2026-11-05-sop-restructuring-plan1-core.md`.
- **주요 변경**:
  - 묶음·권한: 묶음(작업 중·검토 대기·검토 완료)과 멤버(작성자·검토자), 작업 기록, 관리자용 묶음 메타 목록(`/api/admin/bundles`). 권한 키 3개 추가(`bundle.create`·`bundle.admin`·`guideline.manage`, 모두 7개). 묶음 내용은 멤버만 본다(시스템 관리자도 비멤버면 404). 동시 편집은 대상별 `revision`이고 충돌은 409와 `current_revision`을 돌려준다.
  - 업로드·추출: DOCX 메인 추출기(원문 글자·위치 불변 블록, 머리말·각주·텍스트 상자·병합 칸 처리), 텍스트 PDF 보조 추출기, MarkItDown 누락 대조("추출 누락 의심" 경고를 사람이 하나씩 닫는다). 추출은 시간·메모리 한도를 건 별도 프로세스(spawn 자식)에서 돌고, 암호·변경 추적·altChunk·스캔 PDF·상한 초과는 사유와 함께 거절한다.
  - 쪼개기: 규칙 기반 문장 쪼개기·한/영 판정·한/영 연달아 짝 제안, 편집(나누기·합치기·경계 옮기기·골라 만들기·표 행 나누기/합치기·레이아웃 표 바꾸기·언어 바꾸기)과 서버 쪽 되돌리기·다시 하기, 쪽 단위 원문 대조 데이터, 한/영 짝 만들기·확정·풀기.
  - 배정·확정: To-Be 목록(API와 Excel 템플릿·가져오기), 관계 묶음 단위 저장(닫힘 검사·일괄 삭제/이동·배정 지우기·떼어 내기), 입구 2 새 문장·수동 짝 맞추기·같은 글자 한 번에 확정, 숫자·단위·부정 문장 검사. "그대로"인 표는 칸 문장마다 칸 새 문장이 하나씩 있어야 저장된다(아니면 422 `invalid_group` `table_cells_missing`, 칸을 빼려면 표 구성 변경과 사유).
  - 결과물·내보내기: 결과물 A(문장 비교표)·B(맵핑 흐름)·C(새 문서 기준 묶음)와 언어별 요약 숫자를 코드로 계산, 한글판·영어판 Excel(수식 없음, 흐름도 PNG는 저장소에 넣은 NanumGothic OFL 글꼴로 그린다).
  - 검토: 검토 요청 조건과 막는 이유 목록, 지금 할 다음 행동, 의미 검토 4항목, 검토 완료·되돌리기·다시 열기.
  - 개발 도구: 합성 SOP 생성기와 기대 정답(`backend/scripts/synthetic_sop.py`), 처음부터 끝까지 API 테스트, 로컬 데모 시드(`python -m scripts.seed_sop_demo`, 로컬 전용·운영 DB 금지). backend 테스트 942개.
  - 문서: 제품 설계·도메인 판단 기준(`docs/domain/`)·구현 계획 1·파싱 의존성/메모리 실측(`docs/qa/2026-11-sop-parse-dependencies.md`), 백업 문서에 "덤프에 SOP 원문·원본 파일이 들어 있어 대외비" 명시.
- **배포 메모**: **서버 미배포** — v0.1.0도 아직 배포 전이라 첫 배포는 `docs/deploy/setup-once.md` 순서대로 하면 이 버전이 올라간다.
  - 새 env 6개(모두 compose `environment:`에 기본값 폴백이 있어 `.env`에 없어도 된다, 설명은 `.env.example`): `SOP_MAX_FILE_MB`(25) · `SOP_MAX_DOCX_UNZIPPED_MB`(200) · `SOP_MAX_PDF_PAGES`(500) · `SOP_MAX_DOC_CHARS`(2000000) · `SOP_PARSE_TIMEOUT_SECONDS`(60) · `SOP_PARSE_MEMORY_MB`(2048, 낮추지 말 것).
  - **compose backend 메모리 상한 1G → 2G**(파싱 자식 프로세스 몫, 실측 `docs/qa/2026-11-sop-parse-dependencies.md`). limits 합계가 ~4.0G가 되니 서버 여유를 확인하고, 배포 뒤 `docker stats`로 한 번 본다(amd64·실제 SOP·동시 업로드로는 재지 못했다).
  - DB: Alembic `0005_sop_core`(표 22개 추가)·`0006_warning_kind_length`(경고 종류 컬럼 20→40자)가 backend 기동 때 head까지 자동 적용된다(단일 워커). 기존 표는 건드리지 않는다.
  - 새 PyPI 의존성: `openpyxl`·`python-multipart`·`defusedxml`·`pdfminer.six`·`pillow`·`markitdown[docx,pdf]`. MarkItDown이 새 패키지 18개(`onnxruntime`·`numpy`·`magika` 포함, 이미지 +약 125MB)를 딸고 오므로 **서버 빌드 때 PyPI에 접속**되어야 한다(Docker Hub와 별개 경로, `deploy.md`). 베이스 이미지는 그대로라 tar 반입은 없다. 글꼴은 저장소에 들어 있어 빌드 때 내려받지 않는다.
  - 백업 덤프에 SOP 원문·원본 파일이 들어가므로 기존 `0700`·오프서버 사본 정책이 그대로 대외비 자료에 적용된다.
  - 배포일은 서버 배포 뒤 여기에 적는다.

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
