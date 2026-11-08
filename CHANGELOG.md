# Changelog

SOP Archivist 서비스 버전 기록. 단일 소스는 `frontend/package.json` `version`(SemVer)이고, `Nocharm/sop-archivist`의 `main`에 머지할 때마다 올리고 `vX.Y.Z` 태그를 단다(`rules/common/git.md` "On Main Merge"). 운영 서버 배포 여부와 날짜도 해당 항목에 적는다.

## Unreleased

- To-Be WI 단계를 지워도 남은 단계 번호가 바뀌지 않는다(전에는 분류한 문장이 다른 단계 밑으로 옮겨갔다).
- To-Be 문서 코드를 고치는 중에 다른 문서와 같은 코드를 지나도 그 문서의 WI·N/A·단계를 가져오지 않는다.
- To-Be에 저장하지 않은 변경이 있으면 다른 화면으로 가거나 새로고침할 때 먼저 묻는다(브라우저 뒤로 가기는 제외).
- 분류: AI가 나누거나 합친 제안을 확정해도 문장이 지워지거나 거절되지 않고, 그대로 받은 AI 제안의 변경 종류(말투 등)가 유지된다. 시스템 보류 코드가 사람 사유로 저장되지 않는다. "행으로 나누기"한 표 행과 단계가 없는 WI를 보낼 곳으로 고를 수 있다.
- 보낼 곳을 정하지 못한 문장을 사유와 함께 보류할 수 있다(분류의 보류, 쪼개기의 `H`).
- 묶음 상태(돌려보냄 등)가 화면을 옮길 때마다 새로 반영되고, 검토 요청·완료가 409로 거절되면 새 상태를 받아 다시 시도할 수 있다.

## v0.4.0 — 2026-11-08

- **범위**: SOP 재구성 **프런트 1차 화면**(`feat/sop-frontend` 머지). 지금까지 API로만 쓰던 결정적 코어(v0.2.0)와 AI 제안 층(v0.3.0)을 화면에서 쓸 수 있다. 백엔드는 바뀌지 않았다. 설계 기초: `frontend/docs/design/2026-11-07-frontend-design-foundations.md`.
- **주요 변경**:
  - 디자인 기초: G Graphite 토큰(라이트·다크, `src/styles/tokens.css`)과 저장소에 넣은 글꼴(Pretendard·Archivist Accent(Gmarket Sans 이름만 바꿈)·JetBrains Mono, OFL 라이선스 동봉). 화면 설정(배치·테마 등)과 언어는 첫 페인트 전에 붙는다.
  - 앱 틀: 왼쪽 레일 또는 상단 탭 단계 이동, `/`는 묶음 목록, 내 신원·권한은 `/account`로 옮겼다. 묶음 개요(다음 행동·언어별 배정 현황·검토 요청 조건·AI 작업·멤버).
  - 단계 화면: 문서(올리기·바로 고치기·지우기 확인), 원문 대조 쪼개기(나누기·합치기·새 단위·표 행·한/영 짝·되돌리기, 키보드 조작), To-Be 편집(N/A 칸·WI 단계·Excel), 분류(사람 경로와 AI 제안 표시·"AI에 묻기"), 짝 맞추기(입구 2), 결과물 A·B·C(KO/EN판·Excel), 검토.
  - 다크 테마 공개와 실제 글자 대비 감사(`frontend/scripts/pw-contrast-audit.mjs`, 9화면×2테마 4.5:1 통과). SOP 화면 스모크 `frontend/scripts/pw-smoke-sop.mjs`.
  - 1차에서 뺀 것: 경계 손잡이 끌기·줄 더블클릭, 보낼 곳 없는 보류(`H`), 결과물 B·C 최종 시안.
- **배포 메모**: **서버 미배포** — 첫 배포는 `docs/deploy/setup-once.md` 순서대로 하면 이 버전이 올라가고, v0.2.0·v0.3.0 배포 메모도 함께 적용된다. 새 env·DB 리비전·새 의존성 없음(글꼴은 저장소에 들어 있어 빌드 때 외부 다운로드가 없다).
  - 배포일은 서버 배포 뒤 여기에 적는다.

## v0.3.0 — 2026-11-08

- **범위**: SOP 재구성 **AI 제안 층**(구현 계획 2). 결정적 코어(v0.2.0) 위에서 AI가 분류·고쳐 쓰기·번역·입구 2 짝 맞추기·한/영 따로 짝·복합 문장 나누기를 **제안**하고 사람이 줄마다 확정한다. AI가 꺼지거나 실패해도 사람 경로는 그대로 돈다. **프런트 화면은 아직 없다**(Claude Design 1차 작업이 별도 워크트리에서 병행 중이라, 서버에 올려도 화면에서 달라지는 것은 상단 바 버전뿐이고 AI 기능은 `/api/bundles/{id}/ai/…`로만 쓴다). **검증은 가짜 AI와 합성 SOP(`SYNTHETIC_` 파일)로만 했고 실제 사내 모델·실제 SOP로는 시험하지 않았다. 유사도 임계값은 합성 자료로만 잡은 값**이다. 설계: `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`("(계획 2에서 정함)" 항목), 계획: `docs/superpowers/plans/2026-11-06-sop-restructuring-plan2-ai.md`(프런트 병행용 API 계약 포함).
- **주요 변경**:
  - 작업 실행기: 요청은 `ai_jobs` 행을 쌓고 곧바로 응답한다. backend 안의 단일 워커가 `load`(짧은 세션) → `compute`(세션 없이 AI 호출) → `apply`(묶음 잠금·`revision` 재확인) 세 단계로 처리하고, 늦게 온 응답은 적용하지 않아 작업이 `stale`·`cancelled`로 끝난다. 재시작으로 끊긴 작업은 `queued`로 돌아가 3번 시도한 뒤 `failed`다. 관리 화면 AI 연결 테스트도 호출 동안 DB 연결을 잡지 않는다.
  - 임베딩: 사내 OpenAI 호환 `/embeddings` 클라이언트와 (모델, 글자 해시) 캐시. 코사인 유사도는 backend에서 계산한다(`numpy`). 꺼져 있으면 후보는 전체 칸·글자 유사도로 줄고 한/영 따로 짝 제안만 막힌다(409 `embedding_disabled`).
  - 지침·프롬프트 버전: 키 5개(`rules`·`prompt.classify`·`prompt.translate`·`prompt.match`·`prompt.split`)의 첫 버전을 저장소 시드에서 만들고, `guideline.manage`가 `/api/admin/guidelines`로 새 버전을 올리고 활성화한다. 모든 제안이 쓴 버전을 기록한다.
  - AI 작업 6종(종류 `classify`·`translate`·`match_plan`·`match`·`pair`·`split`): 입구 1 분류와 한·영 고쳐 쓰기(임베딩으로 후보 3칸 → LLM 고르기), 번역(한↔영), 입구 2 짝 맞추기(코드가 묶고 LLM은 변경 종류만, 표·그림은 코드), 한/영 따로 짝(임베딩만), 복합 문장 나누기 위치. 요청·진행·취소·다시 시도·제안 목록·채택 기록 API와 한/영 짝 보기의 출처 `ai`.
  - 채택률: 사람이 저장할 때 코드가 그대로(`as_is`)·고쳐서(`edited`)·버림(`rejected`)을 계산해 제안에 남기고, 종류별 집계가 AI 상태 응답에 실린다.
  - 사람 경로 보강: 일괄 삭제·이동은 AI 제안 단위가 섞이면 409 `ai_suggested_units`. 번역 줄은 출처 새 문장을 따르고(출처가 바뀌면 AI 번역은 지우고 확정 번역은 보류, 표의 다른 칸만 바뀌면 자기 출처가 그대로인 AI 번역은 제안으로 남는다), 저장 못 하는 글자(NUL·짝 없는 서로게이트)가 든 입력은 422이고 AI 응답의 그런 글자는 대체 문자로 바꾼다.
  - 기존 API 응답은 필드 추가만: `DecisionOut.suggestion_id`·`GroupTargetOut.suggestion_id`/`translation_source_unit_id`·`BundleOut.ai_jobs`·`ARow.row_kind` 값 `translation`.
  - 개발 도구: 가짜 AI(`backend/tests/fake_ai.py`의 합성 정답, `frontend/scripts/fake-ai-server.mjs`의 분류·번역·짝·임베딩 응답), 두 입구를 가짜 AI로 끝까지 도는 E2E, 데모 시드의 AI 제안 묶음. backend 테스트 1879개(v0.2.0은 1031개).
  - 문서: 설계 문서에 계획 2 결정 반영, `CLAUDE.md`(`app/sop/ai/` 구조·AI 제안 층 불변식), `README.md`·`docs/deploy/setup-once.md`(`EMBED_*`)·`docs/deploy/deploy.md`(AI 작업 실패 트러블슈팅 행).
- **배포 메모**: **서버 미배포** — v0.1.0·v0.2.0도 아직 배포 전이라 첫 배포는 `docs/deploy/setup-once.md` 순서대로 하면 이 버전이 올라가고, v0.2.0 배포 메모(env 6개·backend 메모리 2G·새 PyPI 의존성)도 함께 적용된다. **실제 모델로는 검증하지 못했다**: 임계값(`backend/app/sop/ai/constants.py`)·지침·프롬프트는 실제 SOP를 본 뒤 다시 정하고, 채팅·임베딩 모두 429·408을 다시 시도하지 않는 현재 동작도 그때 다시 본다.
  - 새 env 4개(모두 compose `environment:`에 기본값 폴백이 있어 `.env`에 없어도 기본 꺼짐, 설명은 `.env.example`): `EMBED_ENABLED`(false)·`EMBED_BASE_URL`·`EMBED_API_TOKEN`(시크릿, 커밋 금지)·`EMBED_MODEL`. 채팅 `AI_*`와는 다른 서버·모델이다. `AI_ENABLED`·`EMBED_ENABLED` 중 하나라도 켜면 AI 작업 워커가 뜬다(AI가 꺼져 있으면 큐에 남은 LLM 작업은 임베딩까지 아무것도 보내지 않고 `config`로 실패한다, 한/영 따로 짝은 그대로 돈다). 임베딩을 켜려면 사내 임베딩 서버 주소·모델(한/영 짝에는 다국어 모델)·토큰이 필요하다.
  - DB: Alembic `0007_sop_ai`(표 4개 추가: `ai_jobs`·`ai_suggestions`·`guideline_versions`·`embedding_cache`)가 backend 기동 때 head까지 자동 적용된다(단일 워커). 기존 표는 건드리지 않고, 첫 기동에서 지침 5개의 첫 버전이 시드된다.
  - 새 PyPI 의존성: `numpy==2.4.6` 고정. MarkItDown이 이미 들여오는 `onnxruntime`의 버전이라 새 휠을 더하지 않고, 베이스 이미지는 그대로라 tar 반입은 없다.
  - **db-viewer 점검 필요**: 새 표 중 `ai_suggestions`는 고쳐 쓴 문장·원문 인용이 담기고 `embedding_cache`의 벡터도 원문에서 나온 값이다. `ALTER DEFAULT PRIVILEGES`가 새 표에 SELECT를 자동으로 주므로, 배포 직후 `docs/deploy/db-viewer-readonly.md` 기준으로 REVOKE 여부를 정한다(v0.2.0의 SOP 표도 같은 점검 대상이다).
  - 배포일은 서버 배포 뒤 여기에 적는다.

## v0.2.1 — 2026-11-06

- **범위**: 검토 규칙 수정.
- **주요 변경**: 검토 대기 중에는 누구도 자기 역할을 바꾸지 못한다(409 `own_role_locked`, `bundle.admin` 경로 포함). 작성자가 자기를 검토자로 바꿔 자기 묶음을 검토 완료하던 길을 막았다. 다른 멤버의 역할 변경과 작업 중 변경은 그대로다.
- **배포 메모**: 서버 미배포. 새 env·마이그레이션·의존성 없음.

## v0.2.0 — 2026-11-06

- **범위**: SOP 재구성 **결정적 코어**(AI 없음, 구현 계획 1). 사람이 API만으로 두 입구(입구 1 배정, 입구 2 새 문서와 짝 맞추기)를 업로드부터 검토 완료까지 끝까지 처리할 수 있다. **프런트 화면은 아직 없다** — Claude Design 단계에서 붙인다(그래서 서버에 올려도 화면에서 달라지는 것은 상단 바 버전과, 홈 "내 권한"·관리 > 권한 관리 화면에 새 권한 3개가 더 보이는 것뿐이고, SOP 기능은 `/api/bundles…`로만 쓴다). AI 분류·번역·짝 제안은 계획 2다. 검증은 합성 SOP(`SYNTHETIC_` 파일)로만 했고 실제 SOP·사내 모델로는 시험하지 않았다. 설계: `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`, 계획: `docs/superpowers/plans/2026-11-05-sop-restructuring-plan1-core.md`.
- **주요 변경**:
  - 묶음·권한: 묶음(작업 중·검토 대기·검토 완료)과 멤버(작성자·검토자), 작업 기록, 관리자용 묶음 메타 목록(`/api/admin/bundles`). 권한 키 3개 추가(`bundle.create`·`bundle.admin`·`guideline.manage`, 모두 7개). 묶음 내용은 멤버만 본다(시스템 관리자도 비멤버면 404). 동시 편집은 대상별 `revision`이고 충돌은 409와 `current_revision`을 돌려준다.
  - 업로드·추출: DOCX 메인 추출기(원문 글자·위치 불변 블록, 머리말·각주·텍스트 상자·병합 칸 처리), 텍스트 PDF 보조 추출기, MarkItDown 누락 대조("추출 누락 의심" 경고를 사람이 하나씩 닫는다). 추출은 시간·메모리 한도를 건 별도 프로세스(spawn 자식)에서 돌고, 암호·변경 추적·altChunk·스캔 PDF·상한 초과는 사유와 함께 거절한다.
  - 쪼개기: 규칙 기반 문장 쪼개기·한/영 판정·한/영 연달아 짝 제안, 편집(나누기·합치기·경계 옮기기·골라 만들기·표 행 나누기/합치기·레이아웃 표 바꾸기·언어 바꾸기)과 서버 쪽 되돌리기·다시 하기, 쪽 단위 원문 대조 데이터, 한/영 짝 만들기·확정·풀기.
  - 배정·확정: To-Be 목록(API와 Excel 템플릿·가져오기), 관계 묶음 단위 저장(닫힘 검사·일괄 삭제/이동·배정 지우기·떼어 내기), 입구 2 새 문장·수동 짝 맞추기·같은 글자 한 번에 확정, 숫자·단위·부정 문장 검사. "그대로"인 표는 칸 문장마다 칸 새 문장이 하나씩 있어야 저장된다(아니면 422 `invalid_group` `table_cells_missing`, 칸을 빼려면 표 구성 변경과 사유).
  - 입력 경계: NUL이 든 입력 글자는 422, 파일 이름은 422 `invalid_file_name`이고, PDF 글꼴 맵이 낸 NUL·짝 없는 서로게이트는 같은 길이의 대체 문자(U+FFFD)로 바꾼다. 입구 2 칸 새 문장도 "그대로"인 표의 칸 자리를 지켜야 한다(아니면 422 `cell_position_mismatch`). 스냅숏을 읽기 전에 묶음이 지워지면 404 `bundle_not_found`.
  - 결과물·내보내기: 결과물 A(문장 비교표)·B(맵핑 흐름)·C(새 문서 기준 묶음)와 언어별 요약 숫자를 코드로 계산, 한글판·영어판 Excel(수식 없음, 흐름도 PNG는 저장소에 넣은 NanumGothic OFL 글꼴로 그린다).
  - 검토: 검토 요청 조건과 막는 이유 목록, 지금 할 다음 행동, 의미 검토 4항목, 검토 완료·되돌리기·다시 열기.
  - 개발 도구: 합성 SOP 생성기와 기대 정답(`backend/scripts/synthetic_sop.py`), 처음부터 끝까지 API 테스트, 로컬 데모 시드(`python -m scripts.seed_sop_demo`, 로컬 전용·운영 DB 금지). backend 테스트 1031개.
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
