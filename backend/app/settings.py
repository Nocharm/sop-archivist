"""Application settings loaded from environment / .env."""

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Environment — 배포마다 달라지는 값. .env / docker-compose가 소스 오브 트루스.
    # 로컬 네이티브(Docker 없음)는 sqlite 파일로 무설정 실행, 서버 compose는 postgres로 오버라이드.
    database_url: str = "sqlite+aiosqlite:///./dev.db"

    # 인증 모드 — keycloak(운영 OIDC) | dev(로컬 우회). 비우면 dev.
    auth_mode: str = "dev"
    # 예: http://<keycloak-host>:8080/realms/<realm> (하드코딩 금지 — .env 경유)
    keycloak_issuer: str = ""
    # 토큰 aud 검증값. 비우면 aud 검증 생략 (Keycloak 기본 토큰은 aud=account 등 가변)
    keycloak_audience: str = ""
    # 프론트가 OIDC 클라이언트로 쓸 id — 비밀 아님(브라우저 노출값)
    keycloak_client_id: str = ""
    # dev 모드에서 X-Dev-User 헤더가 없을 때 쓰는 개발용 사용자 loginId
    dev_user: str = "dev.admin"
    # 시스템 관리자 loginId(콤마 구분). 권한 표와 무관하게 모든 권한을 갖는다.
    app_sysadmins: str = ""
    # dev 모드에서도 실제 권한 판정을 적용할지. 기본 False = dev 사용자는 전권(로컬 잠금 방지).
    dev_enforce_permissions: bool = False

    # 온프레미스 AI (OpenAI 호환 GPU 서버) — 로컬 기본 비활성, 서버 compose만 활성
    ai_enabled: bool = False
    ai_base_url: str = ""  # 예: http://<ai-host>:8000/v1
    ai_api_token: str = ""  # Bearer 토큰 (시크릿 — .env만, git 금지)
    ai_model: str = ""
    ai_timeout_seconds: int = 60  # 요청 타임아웃(초)
    # 응답 max_tokens 상한 — 사고(thinking) 토큰 포함. 너무 작으면 GLM이 빈 응답 반환(최대 사고 기준 ≥2000 권장)
    ai_max_tokens: int = 8000
    # 다중 엔드포인트+모델 — JSON 배열 [{"name","base_url","token","model","models"}]. .env에서 추가/삭제.
    # 비우면 위 단일 설정(AI_BASE_URL 등) 사용. 토큰은 시크릿이라 .env 전용.
    ai_endpoints: str = ""
    # AI 부하 가드 — 백엔드 전체 동시 AI 호출 상한(채팅·임베딩이 함께 센다)
    ai_max_concurrency: int = 4

    # 임베딩 서버(OpenAI 호환 /embeddings) — 채팅 서버와 주소·모델이 달라 AI_*와 따로 둔다. 로컬 기본 비활성
    embed_enabled: bool = False
    embed_base_url: str = ""  # 예: http://<embed-host>:8000/v1
    embed_api_token: str = ""  # Bearer 토큰 (시크릿 — .env만, git 금지)
    embed_model: str = ""

    # 사내 n8n HR 웹훅 — 사용자·조직도 단일 소스. 둘 다 비우면 비활성.
    n8n_hr_url: str = ""  # 예: http://<n8n-host>:5678/webhook/hr-dept
    n8n_hr_token: str = ""  # X-API-Key 시크릿 (.env만)
    hr_sync_interval_hours: int = 24  # 내장 스케줄러 주기(시간). 0 = off
    hr_sync_delete_cap_pct: int = 20  # 전체 동기화 삭제 상한(% of 배치 관리 행). 0 = 가드 off

    # SOP 문서 업로드·파싱 상한(Tuning) — 부하 검증 전 추천값(설계 §7.1). 넘는 파일은 사유를 남기고 거절한다.
    sop_max_file_mb: int = 25  # 파일 하나(MiB)
    sop_max_docx_unzipped_mb: int = 200  # DOCX 압축 해제 합계(MiB)
    sop_max_pdf_pages: int = 500
    sop_max_doc_chars: int = 2_000_000  # 문서 하나의 원문 글자 수
    # 파싱 한 번(초) — 메인 추출과 보조 변환(MarkItDown)이 각자 이만큼 쓴다
    sop_parse_timeout_seconds: int = 60
    # 파싱 자식 프로세스 가상 메모리 상한(MiB, 리눅스 RLIMIT_AS). 낮추면 큰 표 문서가 abort한다 — 근거:
    # docs/qa/2026-11-sop-parse-dependencies.md
    sop_parse_memory_mb: int = 2048

    # 조직 경로 해석에서 제외할 최상위 레벨 수 — HR 조직 상위 2단계(법인·사업부급)는 범용이라 분류 제외.
    # departments 체인 해석에만 적용, employees org 컬럼·폴백은 원본 보존.
    # 비즈니스 상수 — env 미노출 (rules/backend/config.md).
    org_trim_levels: int = 2

    def resolved_auth_mode(self) -> Literal["keycloak", "dev"]:
        """항상 keycloak|dev 중 하나. 비면 dev, 그 밖의 값은 오타로 보고 거부한다."""
        raw = self.auth_mode.strip().lower()
        if not raw:
            return "dev"
        if raw == "keycloak":
            return "keycloak"
        if raw == "dev":
            return "dev"
        raise ValueError(f"unknown AUTH_MODE: {self.auth_mode!r}")

    @property
    def hr_enabled(self) -> bool:
        """HR 웹훅 동기화 활성 여부 — URL·토큰이 모두 설정된 경우만."""
        return bool(self.n8n_hr_url and self.n8n_hr_token)

    def sysadmin_login_ids(self) -> set[str]:
        return {x.strip() for x in self.app_sysadmins.split(",") if x.strip()}


settings = Settings()
