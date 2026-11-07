"""AI 지침·프롬프트 버전 관리 API(guideline.manage) — 버전 목록·내용 읽기, 새 버전 올리기, 활성화.

버전을 올려도 활성은 그대로이고 활성화는 따로 한다. 이미 만든 AI 제안은 자기가 쓴 버전 번호를 그대로 기억한다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.access.deps import require_permission
from app.db import get_session
from app.routers.admin import KstDatetime
from app.sop.ai.guidelines import (
    RULES_KEY,
    activate_guideline_version,
    create_guideline_version,
    extract_rule_ids,
)
from app.sop.constants import GUIDELINE_KEYS
from app.sop.errors import raise_rule
from app.sop.models import GuidelineVersion
from app.sop.schemas import NO_NUL

router = APIRouter(prefix="/api/admin/guidelines", tags=["sop-guidelines"])

# 각 엔드포인트의 첫 의존성으로 건다 — 경로 변수가 아무 값이어도 권한 없는 사람은 403이 먼저 난다(test_admin_ops가 전 라우트로 확인)
_require_guideline_manage = require_permission("guideline.manage")

MAX_CONTENT_CHARS = 200_000
MAX_NOTE_CHARS = 2000

# 공백만인 내용은 막고 앞뒤 공백은 걷는다. NO_NUL은 StringConstraints 뒤에 둔다 — 앞에 두면 길이를 공백을 걷기 전에 잰다
GuidelineContent = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_CONTENT_CHARS), NO_NUL
]
GuidelineNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_NOTE_CHARS), NO_NUL]


class GuidelineVersionCreateIn(BaseModel):
    content: GuidelineContent
    note: GuidelineNote = ""


class GuidelineVersionMetaOut(BaseModel):
    """버전 한 줄 — 내용은 싣지 않는다(목록이 무거워지지 않게)."""

    model_config = ConfigDict(from_attributes=True)

    version: int
    note: str
    is_active: bool
    created_by: str
    created_at: KstDatetime
    activated_by: str | None
    activated_at: KstDatetime | None


class GuidelineVersionOut(GuidelineVersionMetaOut):
    key: str
    content: str


class GuidelineOut(BaseModel):
    key: str
    # 시드가 있어 정상에선 늘 값이 있다 — 표를 손으로 고친 경우에도 목록이 500이 되지 않게 비울 수 있게 둔다
    active_version: int | None
    versions: list[GuidelineVersionMetaOut]  # 최신 버전부터


def _check_known_key(key: str) -> None:
    if key not in GUIDELINE_KEYS:
        raise_rule(404, "guideline_not_found")


@router.get("", response_model=list[GuidelineOut])
async def list_guidelines(
    _login_id: str = Depends(_require_guideline_manage),
    session: AsyncSession = Depends(get_session),
) -> list[GuidelineOut]:
    rows = await session.scalars(
        select(GuidelineVersion).options(defer(GuidelineVersion.content)).order_by(GuidelineVersion.version.desc())
    )
    by_key: dict[str, list[GuidelineVersion]] = {key: [] for key in GUIDELINE_KEYS}
    for row in rows:
        by_key.setdefault(row.key, []).append(row)
    return [
        GuidelineOut(
            key=key,
            active_version=next((row.version for row in versions if row.is_active), None),
            versions=[GuidelineVersionMetaOut.model_validate(row) for row in versions],
        )
        for key, versions in by_key.items()
    ]


@router.get("/{key}/versions/{version}", response_model=GuidelineVersionOut)
async def get_guideline_version(
    key: str,
    version: int,
    _login_id: str = Depends(_require_guideline_manage),
    session: AsyncSession = Depends(get_session),
) -> GuidelineVersion:
    _check_known_key(key)
    row = await session.scalar(
        select(GuidelineVersion).where(GuidelineVersion.key == key, GuidelineVersion.version == version)
    )
    if row is None:
        raise_rule(404, "guideline_version_not_found")
    return row


@router.post("/{key}/versions", response_model=GuidelineVersionOut, status_code=201)
async def create_version(
    key: str,
    body: GuidelineVersionCreateIn,
    login_id: str = Depends(_require_guideline_manage),
    session: AsyncSession = Depends(get_session),
) -> GuidelineVersion:
    _check_known_key(key)
    # 규칙 문서는 AI가 인용할 ID가 있어야 쓸모가 있다 — ID 표가 없는 글이 활성이 되면 모든 인용이 버려진다
    if key == RULES_KEY and not extract_rule_ids(body.content):
        raise_rule(422, "no_rule_ids")
    return await create_guideline_version(
        session, key=key, content=body.content, note=body.note, created_by=login_id
    )


@router.post("/{key}/versions/{version}/activate", response_model=GuidelineVersionOut)
async def activate_version(
    key: str,
    version: int,
    login_id: str = Depends(_require_guideline_manage),
    session: AsyncSession = Depends(get_session),
) -> GuidelineVersion:
    _check_known_key(key)
    row = await activate_guideline_version(session, key=key, version=version, activated_by=login_id)
    if row is None:
        raise_rule(404, "guideline_version_not_found")
    return row
