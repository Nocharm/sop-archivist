"""SOP 표준 골격 관리 API(outline.manage) — 표준 항목 목록 읽기와 통째로 바꾸기.

표준을 바꿔도 이미 만든 문서의 골격 사본은 그대로다. 바꾼 표준은 그 뒤에 만드는 SOP 문서부터 복사된다.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.access.deps import require_permission
from app.db import get_session
from app.sop.constants import NumberStyle, OutlineKind
from app.sop.outline import (
    MAX_STANDARD_ITEMS,
    OutlineStandardItemIn,
    load_standard_rows,
    replace_outline_standard,
)

router = APIRouter(prefix="/api/admin/outline", tags=["sop-outline"])

# 각 엔드포인트의 첫 의존성으로 건다 — 본문이 어떤 모양이어도 권한 없는 사람은 403이 먼저 난다(test_admin_ops가 전 라우트로 확인)
_require_outline_manage = require_permission("outline.manage")


class OutlineStandardItemOut(BaseModel):
    """표준 항목 한 줄 — 순서는 목록에서의 자리다."""

    model_config = ConfigDict(from_attributes=True)

    key: str
    title_en: str
    title_ko: str
    kind: OutlineKind
    is_required: bool
    default_style: NumberStyle
    child_prefix: str
    suggestions: list[str]


class OutlineStandardOut(BaseModel):
    items: list[OutlineStandardItemOut]


class OutlineStandardIn(BaseModel):
    # 빈 목록은 여기서 막지 않는다 — replace_outline_standard가 422 outline_invalid(empty)로 거절한다
    items: list[OutlineStandardItemIn] = Field(max_length=MAX_STANDARD_ITEMS)


async def _read_standard(session: AsyncSession) -> OutlineStandardOut:
    rows = await load_standard_rows(session)
    return OutlineStandardOut(items=[OutlineStandardItemOut.model_validate(row) for row in rows])


@router.get("", response_model=OutlineStandardOut)
async def get_outline_standard(
    _login_id: str = Depends(_require_outline_manage),
    session: AsyncSession = Depends(get_session),
) -> OutlineStandardOut:
    result = await _read_standard(session)
    await session.commit()  # 표가 비어 있어 읽는 길에 시드했으면 남긴다
    return result


@router.put("", response_model=OutlineStandardOut)
async def put_outline_standard(
    body: OutlineStandardIn,
    _login_id: str = Depends(_require_outline_manage),
    session: AsyncSession = Depends(get_session),
) -> OutlineStandardOut:
    await replace_outline_standard(session, body.items)
    await session.commit()
    return await _read_standard(session)
