"""AI API의 입력·응답 모양 — 프런트와 약속한 계약이다(계획 2 "API 계약"). 유사도 점수는 어디에도 싣지 않는다."""

from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.routers.admin import KstDatetime
from app.sop.constants import AI_ADOPTIONS, AI_JOB_KINDS
from app.sop.errors import raise_rule
from app.sop.tobe import MAX_DB_INT

# 범위 목록의 상한 — 본문 크기만 막는다. MAX_JOBS_PER_REQUEST보다 커야 넘친 단위가 422가 아니라 limit_reached로 돌아간다
MAX_SCOPE_UNITS = 20_000

SkipReason = Literal[
    "not_unassigned", "already_queued", "bound_cell", "not_assigned", "other_language", "has_pair",
    "already_translated", "too_short", "limit_reached", "already_suggested", "not_splittable",
]
RequestId = Annotated[int, Field(ge=1, le=MAX_DB_INT)]


def _check_job_kind(value: str) -> str:
    if value not in AI_JOB_KINDS:
        raise ValueError(f"kind must be one of {AI_JOB_KINDS}")
    return value


JobKind = Annotated[str, AfterValidator(_check_job_kind)]


def _check_adoption(value: str) -> str:
    if value not in AI_ADOPTIONS:
        raise ValueError(f"adoption must be one of {AI_ADOPTIONS}")
    return value


class AdoptionIn(BaseModel):
    """사람이 직접 남기는 채택 결과 — 나누기 제안만 받는다(다른 종류는 사람의 저장이 채택을 정한다)."""

    adoption: Annotated[str, AfterValidator(_check_adoption)]


class ScopeIn(BaseModel):
    """AI 요청의 범위 — 문서 하나 또는 단위 목록. 빈 목록은 없는 것과 같다."""

    document_id: RequestId | None = None
    unit_ids: list[RequestId] | None = Field(None, max_length=MAX_SCOPE_UNITS)

    @model_validator(mode="after")
    def check_scope(self) -> Self:
        if self.document_id is None and not self.unit_ids:
            # ValueError면 detail이 검증 오류 목록이 된다 — 다른 AI 거절처럼 detail.code로 읽히게 업무 규칙 거절로 낸다
            raise_rule(422, "scope_required")
        return self


class PairRequestIn(BaseModel):
    """한/영 짝 제안 요청 — 문서 하나(설계 §7.11). 짝은 한 문서 안에서만 맺어 단위 목록은 받지 않는다."""

    document_id: RequestId


class TranslateIn(ScopeIn):
    """번역 요청 — 범위에 오너가 고른 방향을 더한다(설계 §7.9)."""

    direction: Literal["ko_to_en", "en_to_ko"]


class JobKindIn(BaseModel):
    """취소·다시 시도의 범위 — 비우면 묶음의 모든 종류."""

    kind: JobKind | None = None


class CancelOut(BaseModel):
    cancelled: int


class RetryOut(BaseModel):
    queued: int


class SkippedOut(BaseModel):
    unit_id: int
    reason: SkipReason


class AiRequestOut(BaseModel):
    queued: int
    # 이번에 쌓은 작업들의 묶음 값 — GET /api/ai/jobs/recent의 request_id와 같다. 쌓인 게 없으면 null
    request_id: str | None = None
    skipped_total: int
    skipped: list[SkippedOut]  # 앞쪽 MAX_SKIPPED_REPORTED건
    # 건너뛴 단위 전체의 사유별 수(합 = skipped_total) — 화면이 "왜 0건인지"를 잘린 목록 없이 말한다
    skipped_by_reason: dict[SkipReason, int]


class AiJobCounts(BaseModel):
    """상태별 작업 수 — 칸은 AI_JOB_STATUSES와 같다."""

    queued: int = 0
    running: int = 0
    done: int = 0
    failed: int = 0
    stale: int = 0
    cancelled: int = 0


class RecentRequestOut(BaseModel):
    """요청 한 번의 진행 — 범위와 상관없이 그 요청의 모든 작업을 센다("n / N" = 끝난 수 / total)."""

    request_id: str
    bundle_id: int
    bundle_code: str
    bundle_title: str
    kind: str  # 요청의 첫 작업 종류(짝 맞추기는 match_plan — 뒤에 쌓이는 match 작업도 이 요청으로 센다)
    kinds: list[str]  # 이 요청에 든 작업 종류 전부(정렬)
    requested_by_me: bool
    total: int
    jobs: AiJobCounts
    error_counts: dict[str, int]  # 실패 코드 → 건수(failed만)
    created_at: KstDatetime  # 첫 작업이 쌓인 때
    started_at: KstDatetime | None  # 가장 이른 시작
    running_started_at: KstDatetime | None  # 지금 실행 중인 작업의 가장 이른 시작 — 작업 목록 상한과 상관없이 "오래 걸림"을 잰다
    finished_at: KstDatetime | None  # 모든 작업이 끝났을 때 가장 늦은 끝, 아니면 null
    document_id: int | None  # 요청의 작업이 모두 한 문서일 때 그 문서, 아니면 null(지워졌으면 제목·파일 이름이 빈 글자)
    document_title: str
    document_file_name: str


class RecentJobsOut(BaseModel):
    server_time: KstDatetime  # 화면이 "오래 도는 중"을 판단하는 기준 시각
    requests: list[RecentRequestOut]  # 도는 요청 먼저, 그다음 최신 순 — 앞쪽 MAX_RECENT_REQUESTS건
    requests_total: int


class AdoptionStats(BaseModel):
    applied: int
    as_is: int
    edited: int
    rejected: int
    pending: int
    adoption_rate: float | None  # 사람이 정한 제안이 없으면 None


class AiStatusOut(BaseModel):
    ai_enabled: bool
    embed_enabled: bool
    jobs: AiJobCounts
    by_kind: dict[str, AiJobCounts]
    failed_errors: dict[str, int]  # 실패 코드 → 건수
    adoption: dict[str, AdoptionStats]


class SuggestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    kind: str
    document_id: int | None
    result: str
    content: dict[str, object]
    warnings: list[dict[str, object]]
    guideline_versions: dict[str, int]
    model: str
    adoption: str | None
    adopted_by: str | None
    adopted_at: KstDatetime | None
    created_at: KstDatetime


class SuggestionsPageOut(BaseModel):
    total: int
    items: list[SuggestionOut]
