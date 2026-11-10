"""결과물 스냅숏 — 묶음 하나의 문서·블록·단위·판단·새 문서·새 문장을 DB 표마다 질의 한 번으로 읽은 불변 값(결과물 A·B·C·요약의 입력)과,
목록·개요에 싣는 언어별 진행 숫자(묶음 여럿을 질의 한 번으로).
"""

from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, defer

from app.sop.constants import COVER_KINDS
from app.sop.detach import UNASSIGNED
from app.sop.errors import raise_rule
from app.sop.groups import build_unit_order_key
from app.sop.models import (
    Bundle,
    Document,
    Extraction,
    ExtractionWarning,
    SourceBlock,
    SourceTable,
    TargetDoc,
    TargetDocNaSlot,
    TargetSentence,
    TargetSource,
    Unit,
    UnitDecision,
    WiStep,
)
from app.sop.units import UNIT_ACTIVE, compute_display_id

PROGRESS_LANGS = ("ko", "en")
NEUTRAL = "neutral"  # 그림 단위의 언어 — 두 언어 숫자에 모두 센다


# --- 스냅숏 ---


@dataclass(frozen=True)
class BundleInfo:
    id: int
    title: str
    status: str
    is_synthetic: bool
    created_by: str
    created_at: datetime


@dataclass(frozen=True)
class DocumentInfo:
    id: int
    side: str
    doc_code: str
    doc_version: str
    title: str
    file_name: str
    status: str  # ready | rejected | failed — 검토 요청이 거절·실패 문서가 남았는지 가린다
    order: int  # 문서 순서(0부터) — 옛 문서 먼저, 같은 쪽 안에서는 id 순


@dataclass(frozen=True)
class TableInfo:
    id: int
    table_index: int  # 추출 안 순번(0부터)
    n_rows: int
    n_cols: int


@dataclass(frozen=True)
class BlockInfo:
    id: int
    part: str
    kind: str
    page: int | None
    page_basis: str
    section_label: str
    table_index: int | None  # 표 칸·칸 안 그림이면 그 표의 순번(0부터)
    row_index: int | None
    col_index: int | None


@dataclass(frozen=True)
class UnitInfo:
    id: int
    document_id: int
    display_id: str
    kind: str
    lang: str
    text: str
    group_unit_id: int | None
    table_id: int | None
    row_index: int | None
    order_key: tuple[int, ...]
    # 자리 블록 — 첫 범위의 블록, 범위가 없는 표·행·캡션 없는 그림은 자리(pos_seq)의 블록(R18)
    block_id: int


@dataclass(frozen=True)
class DecisionInfo:
    unit_id: int
    disposition: str
    move_target_code: str
    reason: str
    status: str
    hold_reason: str
    confirmed_by: str | None
    confirmed_at: datetime | None


@dataclass(frozen=True)
class TargetInfo:
    id: int
    target_doc_id: int
    slot_key: str | None
    wi_step: int | None
    wi_part: str | None
    section_path: str
    order_index: int
    indent_level: int  # 사람이 정한 깊이 그대로 — 번호를 셀 때 outputs가 앞줄 깊이 + 1로 눌러 읽는다
    lang: str
    kind: str
    confirmed_text: str
    ai_text: str
    change_type: str | None
    origin: str
    new_unit_id: int | None
    translation_source_unit_id: int | None  # 은퇴한 단위면 스냅숏 단위에 없다 — 번역은 보류로 남는다
    parent_target_id: int | None
    cell_row: int | None
    cell_col: int | None
    grid: dict[str, int] | None
    status: str
    hold_reason: str
    warnings: tuple[dict[str, str], ...]
    confirmed_by: str | None
    confirmed_at: datetime | None
    source_unit_ids: tuple[int, ...]  # 출처 순서(seq)


@dataclass(frozen=True)
class TargetDocInfo:
    id: int
    code: str
    title: str
    doc_type: str
    parent_id: int | None
    entrance: str
    is_equipment_sop: bool
    order_index: int
    manual_order: bool
    na_slots: dict[str, str]  # 칸 키 → N/A 사유
    steps: tuple[tuple[int, str], ...]  # (단계 번호, 제목) 번호 순


@dataclass(frozen=True)
class BundleSnapshot:
    """묶음 한 시점의 결과물 재료 — 단위는 각 문서 최신 추출의 활성 단위(옛·새 문서 모두), 판단은 그 단위의 것."""

    bundle: BundleInfo
    documents: dict[int, DocumentInfo]
    tables: dict[int, TableInfo]
    blocks: dict[int, BlockInfo]
    units: dict[int, UnitInfo]
    decisions: dict[int, DecisionInfo]
    targets: dict[int, TargetInfo]
    target_docs: dict[int, TargetDocInfo]


def _select_latest_extractions(*conditions: ColumnElement[bool]) -> Select[Any]:
    """문서마다 가장 새 추출 id — 다시 추출하면 이전 추출은 읽기 전용으로 남으므로 결과물은 최신 추출만 본다(설계 §6.3).

    바깥 질의도 Document·Extraction을 조인하므로 자동 상관(correlate)을 끈다 — 켜 두면 문서 행마다의 하위 질의가 된다.
    """
    return (
        select(func.max(Extraction.id))
        .join(Document, Document.id == Extraction.document_id)
        .where(*conditions)
        .group_by(Extraction.document_id)
        .correlate(None)
    )


async def load_bundle_snapshot(session: AsyncSession, bundle_id: int, *, include_text: bool = True) -> BundleSnapshot:
    """묶음의 결과물 재료를 읽는다 — DB 표마다 질의 한 번이라 질의 수는 단위·문장 수와 무관하다.

    include_text=False면 단위 글자와 새 문장의 확정·AI 글자를 DB에서 읽지 않고 빈 글로 채운다(원문 전체를 싣지 않고 구조·상태만
    필요한 검토 요청 조건용). 그 필드는 미적재 열이라 같은 세션에서 읽으면 안 되므로, 글자가 필요한 결과물은 기본값을 쓴다.

    표마다 따로 읽으므로 먼저 묶음 행에 공유 잠금(FOR SHARE)을 건다 — 쓰기는 모두 같은 행을 FOR UPDATE로 먼저 잠그므로
    Postgres READ COMMITTED에서도 질의들이 한 시점을 본다(sqlite는 잠금 구문이 없다). 잠금은 트랜잭션 끝까지 가므로 읽기 전용
    경로는 읽은 뒤 바로 트랜잭션을 끝낸다. 잠금이 없는 sqlite를 위해 뒤 질의는 첫 질의가 읽은 추출로만 거른다.
    """
    bundle_row = (
        await session.execute(
            select(Bundle.id, Bundle.title, Bundle.status, Bundle.is_synthetic, Bundle.created_by, Bundle.created_at)
            .where(Bundle.id == bundle_id)
            .with_for_update(read=True)
        )
    ).one_or_none()
    if bundle_row is None:  # 멤버 검사 뒤 묶음 삭제의 FOR UPDATE를 기다리다 깨어나면 행이 없다
        raise_rule(404, "bundle_not_found")
    documents, document_by_extraction = await _load_documents(session, bundle_id)
    extraction_ids = list(document_by_extraction)

    tables = {
        table_id: TableInfo(table_id, table_index, n_rows, n_cols)
        for table_id, table_index, n_rows, n_cols in await session.execute(
            select(SourceTable.id, SourceTable.table_index, SourceTable.n_rows, SourceTable.n_cols).where(
                SourceTable.extraction_id.in_(extraction_ids)
            )
        )
    }
    block_rows = (
        await session.execute(
            select(
                SourceBlock.id, SourceBlock.extraction_id, SourceBlock.seq, SourceBlock.part, SourceBlock.kind,
                SourceBlock.page, SourceBlock.page_basis, SourceBlock.section_label, SourceBlock.table_id,
                SourceBlock.row_index, SourceBlock.col_index,
            ).where(SourceBlock.extraction_id.in_(extraction_ids))
        )
    ).all()
    blocks = {
        row.id: BlockInfo(
            id=row.id, part=row.part, kind=row.kind, page=row.page, page_basis=row.page_basis,
            section_label=row.section_label,
            table_index=tables[row.table_id].table_index if row.table_id is not None else None,
            row_index=row.row_index, col_index=row.col_index,
        )
        for row in block_rows
    }
    block_by_seq = {(row.extraction_id, row.seq): row.id for row in block_rows}

    unit_statement = select(Unit).where(Unit.extraction_id.in_(extraction_ids), Unit.status == UNIT_ACTIVE)
    if not include_text:
        unit_statement = unit_statement.options(defer(Unit.text))
    units: dict[int, UnitInfo] = {}
    for unit in await session.scalars(unit_statement):
        document = document_by_extraction[unit.extraction_id]
        units[unit.id] = UnitInfo(
            id=unit.id, document_id=document.id, display_id=compute_display_id(document, unit), kind=unit.kind,
            lang=unit.lang, text=unit.text if include_text else "", group_unit_id=unit.group_unit_id, table_id=unit.table_id,
            row_index=unit.row_index, order_key=build_unit_order_key(document, unit),
            block_id=unit.spans[0][0] if unit.spans else block_by_seq[(unit.extraction_id, unit.pos_seq)],
        )

    decisions = {
        decision.unit_id: DecisionInfo(
            unit_id=decision.unit_id, disposition=decision.disposition, move_target_code=decision.move_target_code,
            reason=decision.reason, status=decision.status, hold_reason=decision.hold_reason,
            confirmed_by=decision.confirmed_by, confirmed_at=decision.confirmed_at,
        )
        for decision in await session.scalars(select(UnitDecision).where(UnitDecision.bundle_id == bundle_id))
        if decision.unit_id in units  # 은퇴한 단위의 판단은 이력이다
    }
    old_document_ids = {document.id for document in documents if document.side == "old"}
    for unit in units.values():
        if unit.document_id in old_document_ids and unit.id not in decisions:
            # 옛 단위의 판단 행은 단위와 함께 생기므로, 없으면 단위를 읽은 뒤 문서가 지워진 것이다(잠금 없는 sqlite) — 미배정으로 읽는다
            decisions[unit.id] = DecisionInfo(
                unit_id=unit.id, disposition=UNASSIGNED, move_target_code="", reason="", status=UNASSIGNED,
                hold_reason="", confirmed_by=None, confirmed_at=None,
            )
    return BundleSnapshot(
        bundle=BundleInfo(**bundle_row._asdict()),
        documents={
            document.id: DocumentInfo(
                id=document.id, side=document.side, doc_code=document.doc_code, doc_version=document.doc_version,
                title=document.title, file_name=document.file_name, status=document.status, order=order,
            )
            for order, document in enumerate(documents)
        },
        tables=tables,
        blocks=blocks,
        units=units,
        decisions=decisions,
        targets=await _load_targets(session, bundle_id, units.keys(), include_text),
        target_docs=await load_target_docs(session, bundle_id),
    )


async def _load_documents(session: AsyncSession, bundle_id: int) -> tuple[list[Document], dict[int, Document]]:
    """묶음 문서(옛 문서 먼저, 같은 쪽 안에서는 id 순)와 문서마다 최신 추출 id → 문서 — 한 질의라 둘이 같은 시점이다.

    다시 추출하면 이전 추출은 읽기 전용으로 남으므로 결과물은 최신 추출만 본다(설계 §6.3). 추출이 없는 문서(거절·실패)는 목록에만 있다.
    """
    latest = select(func.max(Extraction.id)).where(Extraction.document_id == Document.id).scalar_subquery()
    rows = (await session.execute(select(Document, latest).where(Document.bundle_id == bundle_id))).tuples().all()
    documents = sorted(
        (document for document, _ in rows), key=lambda document: (0 if document.side == "old" else 1, document.id)
    )
    return documents, {extraction_id: document for document, extraction_id in rows if extraction_id is not None}


async def _load_targets(
    session: AsyncSession, bundle_id: int, unit_ids: Collection[int], include_text: bool
) -> dict[int, TargetInfo]:
    """새 문장과 출처(출처 순서) — 출처는 스냅숏 단위만 남긴다.

    질의마다 따로 읽으므로 그 사이에 커밋된 쪼개기 편집이 새 단위를 출처로 이을 수 있다. 그런 연결은 다음 조회에 보이고,
    이번 결과물은 읽은 단위만으로 계산한다(없는 단위를 가리켜 결과물 전체가 실패하지 않게).
    """
    sources: dict[int, list[int]] = defaultdict(list)
    for target_id, unit_id in await session.execute(
        select(TargetSource.target_id, TargetSource.unit_id)
        .join(TargetSentence, TargetSentence.id == TargetSource.target_id)
        .where(TargetSentence.bundle_id == bundle_id)
        .order_by(TargetSource.target_id, TargetSource.seq)
    ):
        if unit_id in unit_ids:
            sources[target_id].append(unit_id)
    target_statement = select(TargetSentence).where(TargetSentence.bundle_id == bundle_id)
    if not include_text:
        target_statement = target_statement.options(defer(TargetSentence.confirmed_text), defer(TargetSentence.ai_text))
    return {
        target.id: TargetInfo(
            id=target.id, target_doc_id=target.target_doc_id, slot_key=target.slot_key, wi_step=target.wi_step,
            wi_part=target.wi_part, section_path=target.section_path, order_index=target.order_index,
            indent_level=target.indent_level, lang=target.lang, kind=target.kind,
            confirmed_text=target.confirmed_text if include_text else "", ai_text=target.ai_text if include_text else "",
            change_type=target.change_type, origin=target.origin, new_unit_id=target.new_unit_id,
            translation_source_unit_id=target.translation_source_unit_id, parent_target_id=target.parent_target_id, cell_row=target.cell_row, cell_col=target.cell_col,
            grid=target.grid, status=target.status, hold_reason=target.hold_reason, warnings=tuple(target.warnings),
            confirmed_by=target.confirmed_by, confirmed_at=target.confirmed_at,
            source_unit_ids=tuple(sources.get(target.id, ())),
        )
        for target in await session.scalars(target_statement)
    }


async def load_target_docs(session: AsyncSession, bundle_id: int) -> dict[int, TargetDocInfo]:
    """묶음의 새 문서 전부와 칸 N/A·WI 단계 — 스냅숏이 쓰고 AI 후보 만들기도 직접 읽는다(질의 세 번)."""
    na_slots: dict[int, dict[str, str]] = defaultdict(dict)
    for doc_id, slot_key, reason in await session.execute(
        select(TargetDocNaSlot.target_doc_id, TargetDocNaSlot.slot_key, TargetDocNaSlot.reason)
        .join(TargetDoc, TargetDoc.id == TargetDocNaSlot.target_doc_id)
        .where(TargetDoc.bundle_id == bundle_id)
    ):
        na_slots[doc_id][slot_key] = reason
    steps: dict[int, list[tuple[int, str]]] = defaultdict(list)
    for doc_id, step_no, title in await session.execute(
        select(WiStep.target_doc_id, WiStep.step_no, WiStep.title)
        .join(TargetDoc, TargetDoc.id == WiStep.target_doc_id)
        .where(TargetDoc.bundle_id == bundle_id)
        .order_by(WiStep.target_doc_id, WiStep.step_no)
    ):
        steps[doc_id].append((step_no, title))
    return {
        doc.id: TargetDocInfo(
            id=doc.id, code=doc.code, title=doc.title, doc_type=doc.doc_type, parent_id=doc.parent_id,
            entrance=doc.entrance, is_equipment_sop=doc.is_equipment_sop, order_index=doc.order_index,
            manual_order=doc.manual_order, na_slots=dict(na_slots.get(doc.id, {})), steps=tuple(steps.get(doc.id, ())),
        )
        for doc in await session.scalars(select(TargetDoc).where(TargetDoc.bundle_id == bundle_id))
    }


# --- 진행 숫자 ---


class LangProgress(BaseModel):
    """한 언어 옛 커버 단위의 커버 상태별 수(get_cover_status와 같은 규칙) — 그림은 두 언어 모두에 센다."""

    total: int = 0
    unassigned: int = 0
    ai_suggested: int = 0
    confirmed: int = 0
    on_hold: int = 0


class BundleProgress(BaseModel):
    ko: LangProgress
    en: LangProgress


async def load_bundle_progress(session: AsyncSession, bundle_ids: Collection[int]) -> dict[int, BundleProgress]:
    """묶음별 언어별 진행 숫자 — 묶음 수와 무관하게 질의 한 번(묶음 목록·개요·관리 목록이 함께 쓴다)."""
    progress = {bundle_id: BundleProgress(ko=LangProgress(), en=LangProgress()) for bundle_id in bundle_ids}
    if not bundle_ids:
        return progress
    group_decision = aliased(UnitDecision)
    # 칸 문장은 묶인 표·행 단위의 판단을 따른다 — get_cover_status와 같은 규칙(단위 목록의 상태 거르기와도 같다)
    cover_status = func.coalesce(group_decision.status, UnitDecision.status)
    in_bundles = Document.bundle_id.in_(list(bundle_ids))
    rows = await session.execute(
        select(Document.bundle_id, Unit.lang, cover_status, func.count())
        .select_from(Unit)
        .join(Extraction, Extraction.id == Unit.extraction_id)
        .join(Document, Document.id == Extraction.document_id)
        .join(UnitDecision, UnitDecision.unit_id == Unit.id)
        .outerjoin(group_decision, group_decision.unit_id == Unit.group_unit_id)
        .where(
            in_bundles, Document.side == "old", Unit.status == UNIT_ACTIVE, Unit.kind.in_(COVER_KINDS),
            Unit.extraction_id.in_(_select_latest_extractions(in_bundles)),
        )
        .group_by(Document.bundle_id, Unit.lang, cover_status)
    )
    for bundle_id, lang, status, count in rows:
        for counted_lang in PROGRESS_LANGS if lang == NEUTRAL else (lang,):
            lang_progress: LangProgress = getattr(progress[bundle_id], counted_lang)
            lang_progress.total += count
            setattr(lang_progress, status, getattr(lang_progress, status) + count)
    return progress


async def count_unacked_missing_text(session: AsyncSession, bundle_id: int) -> int:
    """아직 닫지 않은 확인 필요 경고(추출 누락 의심) 수 — 문서마다 최신 추출의 것만 센다(이전 추출은 읽기 전용 이력)."""
    count = await session.scalar(
        select(func.count())
        .select_from(ExtractionWarning)
        .where(
            ExtractionWarning.extraction_id.in_(_select_latest_extractions(Document.bundle_id == bundle_id)),
            ExtractionWarning.needs_ack.is_(True),
            ExtractionWarning.acked_at.is_(None),
        )
    )
    return count or 0


async def count_unchecked_boundaries(session: AsyncSession, bundle_id: int) -> dict[int, int]:
    """경계를 아직 확인하지 않은 단위 수(문서 id → 건수, 0인 문서는 뺀다) — 검토 요청 조건과 문서 목록이 같이 쓴다.

    글자 범위가 있는 단위(COVER_KINDS)만 센다. 표·행 묶음 단위는 범위가 없고 그 칸 문장이 대신한다.
    """
    rows = await session.execute(
        select(Extraction.document_id, func.count())
        .select_from(Unit)
        .join(Extraction, Extraction.id == Unit.extraction_id)
        .where(
            Unit.extraction_id.in_(_select_latest_extractions(Document.bundle_id == bundle_id)),
            Unit.status == UNIT_ACTIVE,
            Unit.kind.in_(COVER_KINDS),
            Unit.boundary_confirmed.is_(False),
        )
        .group_by(Extraction.document_id)
    )
    return {document_id: count for document_id, count in rows}
