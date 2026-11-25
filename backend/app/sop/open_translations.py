"""아직 정하지 않은 번역 목록 — 검토 요청을 막는 번역을 묶음 단위로 찾는다(쪼개기 먼저 설계 §5 H5).

번역은 출처 연결이 없어 관계 묶음이 저 하나고, 출처 Old 단위가 나누기·합치기로 은퇴하거나 배정이 취소되면 어느 줄에서도 닿지 않는다.
읽기만 한다 — 확정과 지우기는 관계 묶음 저장(decisions.save_group)이다.
"""

from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.sop.detach import ORIGIN_TRANSLATION, TRANSLATED_TARGET_ID
from app.sop.models import AiSuggestion, Document, Extraction, TargetDoc, TargetSentence, Unit
from app.sop.units import UNIT_ACTIVE, compute_display_id

_CONFIRMED = "confirmed"


class OpenTranslationOut(BaseModel):
    """확정하지 않은 번역 하나(AI 제안·보류). 출처 단위가 은퇴했으면 source_*와 row_unit_id·document_id가 비어 있다."""

    id: int
    revision: int
    status: str
    lang: str
    text: str
    target_doc_code: str
    # 표 칸의 번역이면 그 표 새 문장 — 저장이 표 묶음 전체를 실어야 한다
    parent_target_id: int | None
    source_unit_id: int | None
    source_display_id: str
    source_text: str
    # 그 단위가 든 Assign 줄 — 칸 문장은 표 단위가 줄이다
    row_unit_id: int | None
    document_id: int | None
    # 출처 새 문장과 단위가 모두 살아 있나 — 아니면 지우기만 한다(출처 없는 번역이 확정으로 결과물에 남지 않게)
    can_confirm: bool


async def list_open_translations(session: AsyncSession, bundle_id: int) -> list[OpenTranslationOut]:
    """출처 줄이 있는 것이 Old 문서 순서로 먼저, 출처가 은퇴한 것이 끝. 질의는 번역 수와 상관없이 한 번이다."""
    source = aliased(TargetSentence)
    rows = (
        await session.execute(
            select(TargetSentence, TargetDoc.code, source.id, Unit, Document)
            .join(TargetDoc, TargetDoc.id == TargetSentence.target_doc_id)
            .outerjoin(AiSuggestion, AiSuggestion.id == TargetSentence.suggestion_id)
            .outerjoin(source, source.id == TRANSLATED_TARGET_ID)
            .outerjoin(Unit, and_(Unit.id == TargetSentence.translation_source_unit_id, Unit.status == UNIT_ACTIVE))
            .outerjoin(Extraction, Extraction.id == Unit.extraction_id)
            .outerjoin(Document, Document.id == Extraction.document_id)
            .where(
                TargetSentence.bundle_id == bundle_id, TargetSentence.origin == ORIGIN_TRANSLATION,
                TargetSentence.status != _CONFIRMED,
            )
        )
    ).all()

    def _read_order(row: tuple) -> tuple:
        target, _, _, unit, document = row
        if unit is None:
            return (1, target.id)
        return (0, document.id, unit.pos_seq, unit.pos_start, target.id)

    return [
        OpenTranslationOut(
            id=target.id, revision=target.revision, status=target.status, lang=target.lang,
            text=target.confirmed_text or target.ai_text, target_doc_code=code, parent_target_id=target.parent_target_id,
            source_unit_id=unit.id if unit else None,
            source_display_id=compute_display_id(document, unit) if unit else "",
            source_text=unit.text if unit else "",
            row_unit_id=(unit.group_unit_id or unit.id) if unit else None,
            document_id=document.id if unit else None,
            can_confirm=unit is not None and source_id is not None,
        )
        for target, code, source_id, unit, document in sorted((tuple(row) for row in rows), key=_read_order)
    ]
