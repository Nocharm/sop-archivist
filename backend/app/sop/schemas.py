"""SOP 입력 글자 칸의 공통 규칙 — Postgres text가 담지 못하는 NUL·짝 없는 서로게이트를 경계에서 422로 막는다(sqlite는 받아 줘 테스트에 안 보인다)."""

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel

from app.sop.segment import has_unstorable_char


def _check_no_nul(value: str) -> str:
    # 서로게이트는 pydantic의 str 단계가 먼저 거절하지만 그 동작에 기대지 않고, 저장 못 하는 글자의 판정을 한 곳(has_unstorable_char)에 둔다
    if has_unstorable_char(value):
        raise ValueError("text must not contain NUL or surrogate characters")
    return value


# StringConstraints 뒤에 둔다 — 앞에 두면 pydantic이 길이를 공백을 걷기 전에 잰다
NO_NUL = AfterValidator(_check_no_nul)
NoNulStr = Annotated[str, NO_NUL]


class OriginalPlaceBlock(BaseModel):
    path: str
    page: int | None


class OriginalPlace(BaseModel):
    unit_id: int
    blocks: list[OriginalPlaceBlock]


class OriginalPlaces(BaseModel):
    """원본 보기가 쓰는 Unit별 원본 블록 자리 — 원문 글자는 싣지 않는다(위치만)."""

    file_format: Literal["docx", "pdf", "none"]
    page_basis: str | None
    places: list[OriginalPlace]
