"""Move figure captions stored inside figure units (extractor < 3) into their own caption units and caption targets.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-16 20:00:00.000000

"""
import json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0020"
down_revision: str | Sequence[str] | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 이행 때의 값을 얼려 둔다 — app.sop를 가져오지 않는다(코드가 바뀌어도 이 리비전의 뜻은 그대로)
_CAPTION_KIND = "caption"
_FIGURE_KIND = "figure"
_ACTIVE = "active"
_CONFIRMED = "confirmed"

# 데이터만 옮기므로 필요한 칸만 적은 가벼운 표 — sa.JSON이 sqlite·postgres 양쪽에서 직렬화를 맡는다
_units = sa.table(
    "units",
    sa.column("id", sa.Integer), sa.column("extraction_id", sa.Integer), sa.column("local_no", sa.Integer),
    sa.column("kind", sa.String), sa.column("spans", sa.JSON), sa.column("text", sa.Text), sa.column("lang", sa.String),
    sa.column("table_id", sa.Integer), sa.column("row_index", sa.Integer), sa.column("group_unit_id", sa.Integer),
    sa.column("status", sa.String), sa.column("boundary_confirmed", sa.Boolean), sa.column("pos_seq", sa.Integer),
    sa.column("pos_start", sa.Integer),
)
_extractions = sa.table("extractions", sa.column("id", sa.Integer), sa.column("document_id", sa.Integer))
_documents = sa.table(
    "documents", sa.column("id", sa.Integer), sa.column("bundle_id", sa.Integer), sa.column("side", sa.String)
)
_decisions = sa.table(
    "unit_decisions",
    sa.column("unit_id", sa.Integer), sa.column("bundle_id", sa.Integer), sa.column("disposition", sa.String),
    sa.column("move_target_code", sa.String), sa.column("reason", sa.Text), sa.column("status", sa.String),
    sa.column("hold_reason", sa.Text), sa.column("revision", sa.Integer),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
_targets = sa.table(
    "target_sentences",
    sa.column("id", sa.Integer), sa.column("bundle_id", sa.Integer), sa.column("target_doc_id", sa.Integer),
    sa.column("slot_key", sa.String), sa.column("wi_step", sa.Integer), sa.column("wi_part", sa.String),
    sa.column("section_path", sa.Text), sa.column("order_index", sa.Integer), sa.column("indent_level", sa.Integer),
    sa.column("number_style", sa.String), sa.column("lang", sa.String), sa.column("kind", sa.String),
    sa.column("confirmed_text", sa.Text), sa.column("ai_text", sa.Text), sa.column("change_type", sa.String),
    sa.column("origin", sa.String), sa.column("new_unit_id", sa.Integer), sa.column("parent_target_id", sa.Integer),
    sa.column("status", sa.String), sa.column("hold_reason", sa.Text), sa.column("remark", sa.Text),
    sa.column("warnings", sa.JSON), sa.column("confirmed_by", sa.String),
    sa.column("confirmed_at", sa.DateTime(timezone=True)), sa.column("revision", sa.Integer),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
_sources = sa.table(
    "target_sources", sa.column("target_id", sa.Integer), sa.column("unit_id", sa.Integer), sa.column("seq", sa.Integer)
)


def _detect_lang(text: str) -> str:
    """한글 음절이 있으면 ko, 없고 라틴 글자가 있으면 en, 둘 다 없으면 ko — 이행 때의 segment.detect_language를 얼린 것."""
    has_latin = False
    for ch in text:
        if "가" <= ch <= "힣":
            return "ko"
        has_latin = has_latin or "a" <= ch <= "z" or "A" <= ch <= "Z"
    return "en" if has_latin else "ko"


def _read_spans(value: Any) -> list[Any]:
    """JSON 칸 값 — 드라이버에 따라 이미 풀린 목록이거나 문자열이다."""
    return json.loads(value) if isinstance(value, str) else (value or [])


def upgrade() -> None:
    """Upgrade data: one caption unit (and caption target per figure target) for each active figure unit with a caption."""
    conn = op.get_bind()
    now = datetime.now(UTC)
    figures = conn.execute(
        sa.select(_units, _documents.c.bundle_id, _documents.c.side)
        .join(_extractions, _extractions.c.id == _units.c.extraction_id)
        .join(_documents, _documents.c.id == _extractions.c.document_id)
        .where(_units.c.kind == _FIGURE_KIND, _units.c.status == _ACTIVE)
        .order_by(_units.c.id)
    ).all()
    next_local_no: dict[int, int] = {}
    for figure in figures:
        spans = _read_spans(figure.spans)
        if not spans:  # 새 추출(3)의 그림은 글이 없고 캡션이 이미 제 단위다
            continue
        if figure.extraction_id not in next_local_no:
            top = conn.execute(
                sa.select(sa.func.max(_units.c.local_no)).where(_units.c.extraction_id == figure.extraction_id)
            ).scalar()
            next_local_no[figure.extraction_id] = (top or 0) + 1
        local_no = next_local_no[figure.extraction_id]
        next_local_no[figure.extraction_id] = local_no + 1
        lang = _detect_lang(figure.text)
        caption_id = conn.execute(
            sa.insert(_units).values(
                extraction_id=figure.extraction_id, local_no=local_no, kind=_CAPTION_KIND, spans=spans,
                text=figure.text, lang=lang, table_id=None, row_index=None, group_unit_id=figure.id, status=_ACTIVE,
                boundary_confirmed=figure.boundary_confirmed, pos_seq=figure.pos_seq, pos_start=figure.pos_start,
            ).returning(_units.c.id)
        ).scalar_one()
        conn.execute(sa.update(_units).where(_units.c.id == figure.id).values(spans=[], text=""))
        if figure.side == "old":
            # 묶음에 딸린 단위의 상태는 묶음(그림)의 판단을 따른다 — 제 판단 행은 미배정 기본값
            conn.execute(sa.insert(_decisions).values(
                unit_id=caption_id, bundle_id=figure.bundle_id, disposition="unassigned", move_target_code="",
                reason="", status="unassigned", hold_reason="", revision=1, updated_at=now,
            ))
            parent_ids = [row.target_id for row in conn.execute(
                sa.select(_sources.c.target_id).where(_sources.c.unit_id == figure.id).order_by(_sources.c.target_id)
            )]
            parents = conn.execute(sa.select(_targets).where(_targets.c.id.in_(parent_ids))).all() if parent_ids else []
        else:
            parents = conn.execute(
                sa.select(_targets).where(_targets.c.new_unit_id == figure.id).order_by(_targets.c.id)
            ).all()
        for parent in parents:
            confirmed = parent.status == _CONFIRMED
            child_id = conn.execute(
                sa.insert(_targets).values(
                    bundle_id=parent.bundle_id, target_doc_id=parent.target_doc_id, slot_key=parent.slot_key,
                    wi_step=parent.wi_step, wi_part=parent.wi_part, section_path=parent.section_path,
                    order_index=0, indent_level=0, number_style=parent.number_style, lang=lang, kind="sentence",
                    confirmed_text=figure.text if confirmed else "", ai_text=figure.text, change_type="as_is",
                    origin=parent.origin, new_unit_id=None if figure.side == "old" else caption_id,
                    parent_target_id=parent.id, status=parent.status, hold_reason=parent.hold_reason, remark="",
                    warnings=[], confirmed_by=parent.confirmed_by if confirmed else None,
                    confirmed_at=parent.confirmed_at if confirmed else None, revision=1, updated_at=now,
                ).returning(_targets.c.id)
            ).scalar_one()
            if figure.side == "old":
                conn.execute(sa.insert(_sources).values(target_id=child_id, unit_id=caption_id, seq=0))


def downgrade() -> None:
    """Downgrade data: put each caption back into its empty figure unit and drop the caption unit and its targets."""
    conn = op.get_bind()
    figure_units = _units.alias("figure_units")
    captions = conn.execute(
        sa.select(_units.c.id, _units.c.spans, _units.c.text, _units.c.group_unit_id, figure_units.c.spans.label("figure_spans"))
        .join(figure_units, figure_units.c.id == _units.c.group_unit_id)
        .where(_units.c.kind == _CAPTION_KIND, figure_units.c.kind == _FIGURE_KIND)
        .order_by(_units.c.id)
    ).all()
    restored: set[int] = set()
    for caption in captions:
        if _read_spans(caption.figure_spans) or caption.group_unit_id in restored:
            continue
        restored.add(caption.group_unit_id)
        conn.execute(
            sa.update(_units).where(_units.c.id == caption.group_unit_id)
            .values(spans=_read_spans(caption.spans), text=caption.text)
        )
        # 이행 앞에는 캡션 새 문장이 없었다 — 그림 새 문장 아래의 캡션 새 문장을 지운다.
        # 이행 연결은 FK를 켜지 않을 수 있어(sqlite) CASCADE에 기대지 않고 딸린 행을 먼저 지운다
        sourced = sa.select(_sources.c.target_id).where(_sources.c.unit_id == caption.id)
        child_ids = [row.id for row in conn.execute(sa.select(_targets.c.id).where(
            _targets.c.parent_target_id.is_not(None),
            sa.or_(_targets.c.new_unit_id == caption.id, _targets.c.id.in_(sourced)),
        ))]
        if child_ids:
            conn.execute(sa.text("DELETE FROM target_text_history WHERE target_id IN :ids").bindparams(
                sa.bindparam("ids", child_ids, expanding=True)
            ))
            conn.execute(sa.delete(_sources).where(_sources.c.target_id.in_(child_ids)))
            conn.execute(sa.delete(_targets).where(_targets.c.id.in_(child_ids)))
        conn.execute(sa.delete(_sources).where(_sources.c.unit_id == caption.id))
        for table in ("unit_decision_history", "unit_decisions", "unit_pair_members", "unit_refs"):
            conn.execute(sa.text(f"DELETE FROM {table} WHERE unit_id = :unit_id"), {"unit_id": caption.id})
        conn.execute(sa.delete(_units).where(_units.c.id == caption.id))
