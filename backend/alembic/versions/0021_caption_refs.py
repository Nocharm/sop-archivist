"""Add caption_refs — table/figure references found in old documents' text, and backfill the latest extraction of each.

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-17 09:00:00.000000

"""
import json
import re
from bisect import bisect_left, bisect_right
from collections import defaultdict
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 이행 때의 값과 규칙을 얼려 둔다 — app.sop를 가져오지 않는다(renumber.py가 바뀌어도 이 리비전의 뜻은 그대로).
# 아래 정규식·토큰 규칙은 app/sop/renumber.py의 그때 모습 그대로다.
_CAPTION_KINDS = ("caption",)
_TEXT_KINDS = ("sentence", "heading", "cell_sentence", "caption")
_TABLE_UNIT_KINDS = ("table", "table_row")
_ACTIVE = "active"

_CAPTION_TAIL = r"(?=$|[\s.:)\-–—])"
_FIGURE_CAPTION_RE = re.compile(r"^(?:그림|Figure|Fig)\s*\.?\s*(\d+)" + _CAPTION_TAIL)
_TABLE_CAPTION_RE = re.compile(r"^(?:표|Table)\s*\.?\s*(\d+)" + _CAPTION_TAIL)
_REF_RE = re.compile(
    r"(?:(?<![가-힣])(?P<ko_table>표)|(?<![가-힣])(?P<ko_figure>그림)"
    r"|(?<![A-Za-z])(?P<en_table>Table)|(?<![A-Za-z])(?P<en_figure>Figure|Fig))\s*\.?\s*(?P<a>\d+)",
    re.IGNORECASE,
)
_TILDE_RANGE_RE = re.compile(r"\s*~\s*(\d+)")
_DASH_RANGE_RE = re.compile(r"[-–](\d+)")
_COMPOUND_TAIL_RE = re.compile(r"[.\-–]\d")
_KO_PLACE_RE = re.compile(
    r"(?<![가-힣])(?P<dir>아래|위|다음|앞)\s*(?:(?P<table>표(?![현준시면기지]))|(?P<figure>그림(?!자)))"
)
_EN_PLACE_RES = (
    re.compile(r"\bthe\s+following\s+(?P<kind>table|figure)\b", re.IGNORECASE),
    re.compile(r"\bthe\s+(?P<kind>table|figure)\s+(?P<dir>above|below)\b", re.IGNORECASE),
    re.compile(r"\bthe\s+(?P<dir>above|below)\s+(?P<kind>table|figure)\b", re.IGNORECASE),
)
_KO_DIRECTIONS = {"아래": "next", "다음": "next", "위": "previous", "앞": "previous"}
_EN_DIRECTIONS = {"above": "previous", "below": "next"}

_extractions = sa.table("extractions", sa.column("id", sa.Integer), sa.column("document_id", sa.Integer))
_documents = sa.table("documents", sa.column("id", sa.Integer), sa.column("side", sa.String))
_blocks = sa.table(
    "source_blocks", sa.column("id", sa.Integer), sa.column("extraction_id", sa.Integer), sa.column("seq", sa.Integer),
    sa.column("text", sa.Text),
)
_units = sa.table(
    "units",
    sa.column("id", sa.Integer), sa.column("extraction_id", sa.Integer), sa.column("kind", sa.String),
    sa.column("spans", sa.JSON), sa.column("text", sa.Text), sa.column("table_id", sa.Integer),
    sa.column("group_unit_id", sa.Integer), sa.column("status", sa.String), sa.column("pos_seq", sa.Integer),
    sa.column("pos_start", sa.Integer),
)
_refs = sa.table(
    "caption_refs",
    sa.column("extraction_id", sa.Integer), sa.column("block_id", sa.Integer), sa.column("start", sa.Integer),
    sa.column("end", sa.Integer), sa.column("kind", sa.String), sa.column("number", sa.Integer),
    sa.column("target_table_id", sa.Integer), sa.column("target_block_id", sa.Integer), sa.column("state", sa.String),
    sa.column("origin", sa.String),
)


def upgrade() -> None:
    """Upgrade schema, then link the references of each old document's latest extraction."""
    op.create_table(
        "caption_refs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("extraction_id", sa.Integer(), nullable=False),
        sa.Column("block_id", sa.Integer(), nullable=False),
        sa.Column("start", sa.Integer(), nullable=False),
        sa.Column("end", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=6), nullable=False),
        sa.Column("number", sa.Integer(), nullable=True),
        sa.Column("target_table_id", sa.Integer(), nullable=True),
        sa.Column("target_block_id", sa.Integer(), nullable=True),
        sa.Column("state", sa.String(length=8), nullable=False),
        sa.Column("origin", sa.String(length=5), nullable=False),
        sa.CheckConstraint("kind IN ('table', 'figure')", name=op.f("ck_caption_refs_kind")),
        sa.CheckConstraint("state IN ('linked', 'detached')", name=op.f("ck_caption_refs_state")),
        sa.CheckConstraint("origin IN ('auto', 'human')", name=op.f("ck_caption_refs_origin")),
        sa.ForeignKeyConstraint(
            ["extraction_id"], ["extractions.id"], name=op.f("fk_caption_refs_extraction_id_extractions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["block_id"], ["source_blocks.id"], name=op.f("fk_caption_refs_block_id_source_blocks"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_table_id"], ["source_tables.id"], name=op.f("fk_caption_refs_target_table_id_source_tables"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_block_id"], ["source_blocks.id"], name=op.f("fk_caption_refs_target_block_id_source_blocks"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_caption_refs")),
    )
    op.create_index(op.f("ix_caption_refs_extraction_id"), "caption_refs", ["extraction_id"], unique=False)
    conn = op.get_bind()
    latest = (
        sa.select(sa.func.max(_extractions.c.id)).join(_documents, _documents.c.id == _extractions.c.document_id)
        .where(_documents.c.side == "old").group_by(_extractions.c.document_id)
    )
    for extraction_id in [row[0] for row in conn.execute(latest)]:
        rows = _build_refs(conn, extraction_id)
        if rows:
            conn.execute(sa.insert(_refs), rows)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_caption_refs_extraction_id"), table_name="caption_refs")
    op.drop_table("caption_refs")


def _read_spans(value: Any) -> list[Any]:
    """JSON 칸 값 — 드라이버에 따라 이미 풀린 목록이거나 문자열이다."""
    return json.loads(value) if isinstance(value, str) else (value or [])


def _read_caption_number(text: str) -> tuple[str, int] | None:
    for kind, pattern in (("table", _TABLE_CAPTION_RE), ("figure", _FIGURE_CAPTION_RE)):
        match = pattern.match(text)
        if match is not None:
            return kind, int(match.group(1))
    return None


def _find_number_tokens(text: str) -> list[tuple[str, int, int, int]]:
    """(종류, 번호, 시작, 끝) — "~"·공백 없는 증가 줄표 범위는 양 끝 둘, "3-1"·"3.2" 복합 번호는 없음."""
    tokens: list[tuple[str, int, int, int]] = []
    for match in _REF_RE.finditer(text):
        kind = "table" if match.group("ko_table") or match.group("en_table") else "figure"
        first = int(match.group("a"))
        rest = match.end("a")
        second = None
        if (tilde := _TILDE_RANGE_RE.match(text, rest)) is not None:
            second = tilde
        elif (dash := _DASH_RANGE_RE.match(text, rest)) is not None:
            if int(dash.group(1)) <= first:
                continue
            second = dash
        elif _COMPOUND_TAIL_RE.match(text, rest) is not None:
            continue
        tokens.append((kind, first, match.start("a"), match.end("a")))
        if second is not None:
            tokens.append((kind, int(second.group(1)), second.start(1), second.end(1)))
    return tokens


def _find_place_tokens(text: str) -> list[tuple[str, str, int, int]]:
    """(종류, 방향, 시작, 끝) — 구 전체."""
    tokens: list[tuple[str, str, int, int]] = []
    for match in _KO_PLACE_RE.finditer(text):
        tokens.append(("table" if match.group("table") else "figure", _KO_DIRECTIONS[match.group("dir")], match.start(), match.end()))
    for pattern in _EN_PLACE_RES:
        for match in pattern.finditer(text):
            word = match.groupdict().get("dir")
            direction = _EN_DIRECTIONS[word.lower()] if word else "next"
            tokens.append((match.group("kind").lower(), direction, match.start(), match.end()))
    return sorted(tokens, key=lambda token: token[2])


def _get_target(unit: Any, block_id_by_seq: dict[int, int]) -> tuple[int | None, int | None] | None:
    """묶음 단위 → (대상 표 id, 대상 그림 블록 id)."""
    if unit.kind in _TABLE_UNIT_KINDS and unit.table_id is not None:
        return unit.table_id, None
    if unit.kind == "figure" and unit.pos_seq in block_id_by_seq:
        return None, block_id_by_seq[unit.pos_seq]
    return None


def _build_refs(conn: Any, extraction_id: int) -> list[dict[str, Any]]:
    """한 추출의 참조 행 — app.sop.caption_refs.build_ref_drafts와 같은 규칙을 얼려 둔 것."""
    blocks = {
        row.id: (row.seq, row.text)
        for row in conn.execute(sa.select(_blocks).where(_blocks.c.extraction_id == extraction_id))
    }
    block_id_by_seq = {seq: block_id for block_id, (seq, _) in blocks.items()}
    units = conn.execute(
        sa.select(_units).where(_units.c.extraction_id == extraction_id, _units.c.status == _ACTIVE)
    ).all()
    by_id = {unit.id: unit for unit in units}
    captions: dict[tuple[str, int], list[Any]] = defaultdict(list)
    for unit in units:
        head = _read_caption_number(unit.text) if unit.kind in _CAPTION_KINDS else None
        if head is not None:
            captions[head].append(unit)
    groups: dict[str, list[Any]] = {"table": [], "figure": []}
    for unit in units:
        if unit.kind in groups:
            groups[unit.kind].append(unit)
    keys: dict[str, list[tuple[int, int]]] = {}
    for kind, members in groups.items():
        members.sort(key=lambda unit: (unit.pos_seq, unit.pos_start, unit.id))
        keys[kind] = [(unit.pos_seq, unit.pos_start) for unit in members]

    rows: list[dict[str, Any]] = []

    def add(block_id: int, start: int, end: int, kind: str, number: int | None, target: Any) -> None:
        table_id, target_block_id = target if target else (None, None)
        rows.append({
            "extraction_id": extraction_id, "block_id": block_id, "start": start, "end": end, "kind": kind,
            "number": number, "target_table_id": table_id, "target_block_id": target_block_id,
            "state": "linked", "origin": "auto",
        })

    for unit in units:
        if unit.kind not in _TEXT_KINDS:
            continue
        head = _read_caption_number(unit.text) if unit.kind in _CAPTION_KINDS else None
        for block_id, span_start, span_end in _read_spans(unit.spans):
            seq, block_text = blocks[block_id]
            text = block_text[span_start:span_end]
            for kind, number, start, end in _find_number_tokens(text):
                if head == (kind, number):
                    continue
                same = captions.get((kind, number), [])
                target = None
                group_ids = {caption.group_unit_id for caption in same if caption.group_unit_id in by_id}
                if len(group_ids) == 1:  # 언어마다 캡션이 따로여도 묶음은 하나
                    target = _get_target(by_id[group_ids.pop()], block_id_by_seq)
                add(block_id, span_start + start, span_start + end, kind, number, target)
            for kind, direction, start, end in _find_place_tokens(text):
                position = (seq, span_start + start)
                members, member_keys = groups[kind], keys[kind]
                index = bisect_right(member_keys, position) if direction == "next" else bisect_left(member_keys, position) - 1
                target = _get_target(members[index], block_id_by_seq) if 0 <= index < len(members) else None
                add(block_id, span_start + start, span_start + end, kind, None, target)
    return rows
