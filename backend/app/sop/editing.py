"""쪼개기 편집 — 나누기·합치기·경계 옮기기·골라 만들기·언어 바꾸기·레이아웃 표 바꾸기·캡션 붙이기·떼기·첫 행 ↔ 캡션·
그림 묶기·풀기·잡음 표시 풀기·번호 고치기·제목 ↔ 문장과 서버 쪽
선형 되돌리기·다시 하기, 경계 확인 표시 (스펙 §6.4, §7.5).

단위는 제자리에서 바뀌지 않는다: 편집은 옛 단위를 은퇴시키고 새 단위를 만들며, 되돌리기는 은퇴한 단위를 원래 ID로 되살린다.
칸 문장은 제자리에 두고 묶음(group_unit_id)만 바꾸며, 그 바뀜과 레이아웃 표 표시도 기록해 되돌린다.
번호 고치기도 제자리다 — 단위의 number_set과 그 번호가 여는 절 이름(블록 section_label)만 바꾸고 기록해 되돌린다(범위·글자는 그대로).
그림 묶기·풀기도 제자리다 — 그림 단위의 caption_figure_id만 바꾸고(옮기는 캡션은 칸 묶음처럼 regroup) 기록해 되돌린다.
묶음 잠금·문서 revision·작업 중 검사와 커밋은 부르는 쪽(라우터)이 한다.
"""

from collections import Counter, defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, fields
from typing import Annotated, Literal, TypeVar, assert_never

from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.sop.caption_slot import CAPTION_REACH, PlaceBlock, build_block_places, get_place_distance
from app.sop.captions import CAPTION_KIND
from app.sop.decision_steps import UndoMetaIn
from app.sop.decisions import DbId
from app.sop.detach import (
    ORIGIN_NEW_DOC,
    UNASSIGNED,
    DetachReport,
    detach_targets,
    detach_units,
    find_units_needing_confirm,
    is_unassigned,
)
from app.sop.errors import raise_rule
from app.sop.events import record_event
from app.sop.groups import BUNDLE_UNIT_KINDS, TABLE_UNIT_KINDS, iter_chunks, select_in_chunks
from app.sop.match import sync_new_doc_targets
from app.sop.models import (
    Document,
    SourceBlock,
    SourceTable,
    TargetSentence,
    Unit,
    UnitDecision,
    UnitEdit,
    UnitPair,
    UnitPairMember,
    UnitRef,
)
from app.sop.noise import NOISE_TOC
from app.sop.numbering import (
    MAX_NUMBER_CHARS,
    NO_NUMBER,
    NUMBER_PAIR,
    NUMBERED_KINDS,
    ClauseLine,
    build_number_columns,
    find_inherited_numbers,
    get_hidden_len,
    get_number,
    normalize_number,
    plan_follow,
    read_draft_number,
)
from app.sop.refs import REF_CONFIRMED, REF_LANG, REF_REJECTED, read_number_in_text
from app.sop.schemas import NO_NUL
from app.sop.segment import (
    BlockView,
    TableView,
    build_unit_drafts,
    build_unit_text,
    detect_language,
    has_visible_char,
    is_band_heading,
    is_band_table,
    is_number_cell_range,
    split_sentences,
)
from app.sop.spans import (
    NEUTRAL,
    Span,
    cut_spans,
    fill_languages,
    join_close_spans,
    locate_text_offset,
    overlaps,
    split_around,
    to_spans,
    trim_span,
)
from app.sop.tobe import MAX_DB_INT
from app.sop.units import (
    LINE_SPLIT_FORMAT,
    UNIT_ACTIVE,
    get_latest_extraction_id,
    pair_new_units,
    refresh_code_pairs,
    verify_document_coverage,
)

UNIT_RETIRED = "retired"
EDIT_APPLIED = "applied"
EDIT_UNDONE = "undone"
# 경계 확인 표시만 바꾼 옛 기록 - 확인 동작은 없어졌지만(v1.0.18) 이미 쌓인 기록은 되돌리기 줄에 남아 있어 계속 돌린다.
# 단위 집합은 그대로라 되돌릴 때 표시만 거꾸로 돌린다(payload: unit_ids·confirmed)
BOUNDARY_OPS = ("boundary", "check_all")
# 묶음의 묶인 단위를 바꾸는 편집 — 판단이 있는 묶음을 떼어 낸다
CAPTION_OPS = ("attach_caption", "detach_caption", "set_first_row_caption")
FIGURE_OPS = ("group_figures", "ungroup_figures")  # 그림 묶음(caption_figure_id)을 바꾸는 편집 — 든 그림 모두가 바뀐 묶음이다
# 글자 범위를 고칠 수 있는 단위 — 그림·표는 범위를 나누거나 잇지 않는다
TEXT_KINDS = ("sentence", "heading", "cell_sentence", CAPTION_KIND)
CAPTIONABLE_KINDS = ("sentence", "heading")  # 캡션으로 붙일 수 있는 글 단위
PAIR_LANGS = {"ko", "en"}  # 짝의 두 쪽 — 한쪽이 비면 짝을 지운다
MAX_EDIT_UNITS = 2000  # 합치기·언어 바꾸기가 한 번에 고르는 단위 수 상한

Offset = Annotated[int, Field(ge=0, le=MAX_DB_INT)]
T = TypeVar("T")
ExtractionId = int | None  # 받지 않았거나 추출에 실패한 문서는 추출이 없다 — 단위·블록 조회가 비어 404가 된다


# --- 요청·응답 ---


class SplitOp(BaseModel):
    type: Literal["split"]
    unit_id: DbId
    # 단위 text 안 위치 — 오른쪽 조각의 첫 글자. 범위 사이 이음 글자(" "·"\n") 위는 안 된다
    at: Offset


class MergeOp(BaseModel):
    type: Literal["merge"]
    unit_ids: list[DbId] = Field(min_length=2, max_length=MAX_EDIT_UNITS)


class UnmergeOp(BaseModel):
    """합친 단위를 합치기 전 단위들로 — 그 합치기가 만든 단위가 그 뒤로 바뀌지 않았을 때만(옛 ID 그대로 되살린다)."""

    type: Literal["unmerge"]
    unit_id: DbId


class MoveBoundaryOp(BaseModel):
    type: Literal["move_boundary"]
    left_unit_id: DbId
    right_unit_id: DbId
    # 왼쪽 단위 마지막 범위와 오른쪽 단위 첫 범위가 함께 있는 블록 안 위치
    at: Offset


class CarveOp(BaseModel):
    type: Literal["carve"]
    block_id: DbId
    # 블록 안 [start, end)
    start: Offset
    end: Offset


class SetLanguageOp(BaseModel):
    type: Literal["set_language"]
    unit_ids: list[DbId] = Field(min_length=1, max_length=MAX_EDIT_UNITS)
    lang: Literal["ko", "en"]


class SetLayoutTableOp(BaseModel):
    """표 벗기기(is_layout) · 다시 표로. 표는 하나씩 벗긴다 — 한/영 따로 문서에서 둘 다 벗긴 대응 표는 짝을 다시 세울 때 같은 행끼리
    짝짓는다(F8a, units.refresh_code_pairs). 대응 표 함께 벗기기는 걷었다(사용자 결정 2026-11-19, 요청서 8번)."""

    type: Literal["set_layout_table"]
    table_id: DbId
    is_layout: bool


class AttachCaptionOp(BaseModel):
    """묶이지 않은 글 단위(문장·제목, REF 아님)를 표·그림 단위의 캡션으로 — 같은 범위·언어의 캡션 단위가 된다.

    글은 묶음에서 블록 자리 CAPTION_REACH 안에 있어야 한다(caption_slot — 사이의 문단은 그대로 남는다, F7 ④).
    """

    type: Literal["attach_caption"]
    unit_id: DbId
    bundle_unit_id: DbId


class DetachCaptionOp(BaseModel):
    """캡션 단위를 같은 범위·언어의 묶이지 않은 문장 단위로 — 표 첫 행에서 올린 캡션(칸 블록 위)은 그 표의 칸 문장으로 돌아간다."""

    type: Literal["detach_caption"]
    unit_id: DbId


class SetFirstRowCaptionOp(BaseModel):
    """표 첫 행 ↔ 캡션(F7 ③) — caption이면 첫 행의 칸 문장을 같은 범위·언어의 캡션 단위로 그 표에 묶고("첫 행에서 올림"),
    아니면 그 표의 칸 블록 위 캡션을 모두 다시 첫 행 칸 문장으로("↩ 다시 첫 행으로"). 통째인 표(table 단위)만 받는다."""

    type: Literal["set_first_row_caption"]
    table_unit_id: DbId
    caption: bool


class GroupFiguresOp(BaseModel):
    """그림 묶기(F7 ⑥) — 고른 그림(과 그 그림이 이미 든 묶음)이 캡션 하나를 같이 쓴다. 원문 순 첫 그림이 캡션을 갖고(나머지 그림의
    캡션은 첫 그림으로 옮긴다) 나머지 그림의 caption_figure_id가 첫 그림을 가리킨다."""

    type: Literal["group_figures"]
    unit_ids: list[DbId] = Field(min_length=2, max_length=MAX_EDIT_UNITS)


class UngroupFiguresOp(BaseModel):
    """그림 풀기 — 그 그림이 든 묶음의 그림이 모두 따로 선다. 캡션은 첫 그림에 남는다."""

    type: Literal["ungroup_figures"]
    unit_id: DbId


class SetRefOp(BaseModel):
    """글 단위를 참조 줄(REF)로 — 번호는 그 단위의 글 안에 있어야 한다. 이미 REF면 번호만 고친다."""

    type: Literal["set_ref"]
    unit_id: DbId
    number: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), NO_NUL]


class ClearRefOp(BaseModel):
    """참조 아님 — REF면 그 전 언어로 돌리고, 제안뿐이었으면 다시 제안하지 않게 표시만 남긴다."""

    type: Literal["clear_ref"]
    unit_id: DbId


class SetNumberOp(BaseModel):
    """글 단위의 문단 번호를 고친다 — 번호 칸의 값만 바뀌고 원문 글자·범위는 그대로다.

    number가 null이면 "번호 없음"(번호 범위가 글로 돌아간다). 글 앞에 타자로 친 번호를 번호로 삼을 때는 그 읽은 값을 보낸다.
    follow면 같은 목록의 뒤 번호도 같은 편집으로 따라 고친다(numbering.plan_follow) — 되돌리기도 한 번이다.
    """

    type: Literal["set_number"]
    unit_id: DbId
    number: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NUMBER_CHARS, pattern=r"^[^\r\n]+$"),
        NO_NUL,
    ] | None
    follow: bool = True
class ClearNoiseOp(BaseModel):
    """잡음 표시 풀기 — 목차 아님(줄 하나) · 모두 목차 아님(블록 전체). 단위는 그대로이고 표시만 비운다(되돌리기가 다시 붙인다)."""

    type: Literal["clear_noise"]
    unit_ids: list[DbId] = Field(min_length=1, max_length=MAX_EDIT_UNITS)


class SetHeadingOp(BaseModel):
    """제목 ↔ 문장(F8b · 설계 2d) — 범위·글자는 그대로이고 단위 모양만 바뀐다(옛 단위 은퇴, 새 단위 생성 — 되돌리기 한 번).

    heading이 거짓이면 제목 단위마다 보통 문장 나누기를 하고 바꾼 표시(from_heading)를 단다. 참이면 바꾼 문장은 그 조항 줄의 문장을 모두
    모아 제목 하나로 되돌리고(제목으로 되돌리기), 보통 문장(굵은 글씨로만 쓴 제목 등)은 그 문장이 제목이 된다. 한/영 코드 짝은 새 단위로
    다시 선다(units.pair_new_units).
    """

    type: Literal["set_heading"]
    unit_ids: list[DbId] = Field(min_length=1, max_length=MAX_EDIT_UNITS)
    heading: bool


EditOp = Annotated[
    SplitOp | MergeOp | UnmergeOp | MoveBoundaryOp | CarveOp | SetLanguageOp
    | SetLayoutTableOp | AttachCaptionOp | DetachCaptionOp | SetFirstRowCaptionOp | GroupFiguresOp
    | UngroupFiguresOp | SetRefOp | ClearRefOp | ClearNoiseOp | SetNumberOp | SetHeadingOp,
    Field(discriminator="type"),
]


class EditIn(BaseModel):
    revision: int = Field(ge=1)
    # 판단이 걸린 단위를 은퇴시키는 편집의 명시적 확인 — 없으면 409 confirm_required로 화면이 먼저 묻는다
    confirm: bool = False
    op: EditOp
    undo: UndoMetaIn | None = None  # Assign 안의 자르기만 실어 보낸다 — 그 화면의 되돌리기 기록에 한 단계로 남는다


class EditStepIn(BaseModel):
    """되돌리기·다시 하기 요청."""

    revision: int = Field(ge=1)
    confirm: bool = False


class EditResult(BaseModel):
    document_revision: int
    # 이 요청으로 활성이 된 단위(되살린 것은 id 순, 새로 만든 것은 원문 순)와 은퇴한 단위(id 순)
    created_unit_ids: list[int]
    retired_unit_ids: list[int]
    # 옛 문서는 은퇴하거나 다시 묶인 단위의 떼어 내기, 새 문서는 새 문장 다시 맞추기 결과 — 둘 다 없는 옛 문서 편집은 None
    detach: DetachReport | None


class EditStepResult(EditResult):
    """되돌리기·다시 하기 응답 - 무엇을 거꾸로(또는 다시) 했는지 화면이 알리고 그 자리로 갈 수 있게."""

    op: str
    # 옛 경계 확인 기록(BOUNDARY_OPS)이면 표시가 바뀐 단위와 바뀐 뒤 값, 아니면 빈 목록과 None
    boundary_unit_ids: list[int]
    confirmed: bool | None


# --- 계획 ---


@dataclass(frozen=True)
class _Block:
    seq: int
    text: str
    kind: str
    table_id: int | None
    row_index: int | None
    signals: dict | None = None


@dataclass
class _Draft:
    """만들 단위 하나 — lang이 ""면 글자로 언어를 알 수 없어 앞 단위 규칙으로 채운다."""

    kind: str
    spans: list[Span]
    text: str
    lang: str
    table_id: int | None
    row_index: int | None
    group_unit_id: int | None
    pos_seq: int
    pos_start: int
    # 표 단위만 — 이 단위에 묶을 칸 문장 → 지금 묶음(만든 뒤 _Change.regroup으로 옮긴다)
    cells: dict[int, int | None] = field(default_factory=dict)
    # 번호 열(units.number_*) — 읽은 값·출처·길이는 범위와 신호에서, number_set은 같은 자리에서 시작하던 옛 단위에서 물려받는다
    number: dict[str, object] = field(default_factory=dict)
    # 제목에서 바꾼 문장(units.from_heading) — 바꾼 문장을 자르고 합쳐도 문장으로 남으면 물려받는다
    from_heading: bool = False
    # 같은 변경에서 만드는 표 단위(_Change.drafts의 순번)에 묶을 새 칸 문장 — 띠 표를 표로 되돌릴 때(_plan_band_layout)
    group_draft: int | None = None


Move = tuple[int | None, int | None]  # 칸 문장의 (지금 묶음, 바꿀 묶음)
Shape = tuple[tuple[Span, ...], str, int | None]  # 단위의 (범위, 종류, 묶음) — 이것이 같으면 같은 단위다
NumberSet = str | None  # units.number_set — None 고치지 않음, "" 번호 없음
SectionMove = tuple[int, int, str, str]  # 블록 seq [첫, 끝]의 절 이름 (지금, 바꿀)


@dataclass
class _Change:
    """편집·되돌리기·다시 하기 한 번이 단위 집합에 하는 일 — langs는 단위 → (지금 언어, 바꿀 언어)."""

    retire: list[int] = field(default_factory=list)
    revive: list[int] = field(default_factory=list)
    drafts: list[_Draft] = field(default_factory=list)
    langs: dict[int, tuple[str, str]] = field(default_factory=dict)
    # 칸 문장 → 묶음 옮김. 만들 표 단위에 묶는 칸은 draft.cells에 있다가 그 단위를 쓴 뒤 여기 채워진다(기록용)
    regroup: dict[int, Move] = field(default_factory=dict)
    # 원문 표 → (지금 is_layout, 바꿀 is_layout)
    layouts: dict[int, tuple[bool, bool]] = field(default_factory=dict)
    # 은퇴시킬 단위들의 (범위, 종류, 묶음) — 앞으로 가는 편집만 채운다(is_unchanged가 새 단위의 것과 견준다)
    retired_shapes: list[Shape] = field(default_factory=list)
    # 캡션 붙이기·떼기로 묶인 단위가 바뀌는 묶음 — 판단이 있으면 다시 묶인 칸처럼 확인을 묻고 떼어 낸다
    bundles: list[int] = field(default_factory=list)
    # 번호 고치기 — 단위 → (지금 number_set, 바꿀 number_set)과 그 번호가 열던 절의 블록들
    numbers: dict[int, tuple[NumberSet, NumberSet]] = field(default_factory=dict)
    sections: list[SectionMove] = field(default_factory=list)
    # 단위 → (지금 잡음 표시, 바꿀 잡음 표시) — 제자리에서 바뀐다(목차 아님과 그 되돌리기)
    noises: dict[int, tuple[str | None, str | None]] = field(default_factory=dict)
    # 그림 → (지금 caption_figure_id, 바꿀 caption_figure_id) — 제자리에서 바뀐다(그림 묶기·풀기와 그 되돌리기)
    figures: dict[int, tuple[int | None, int | None]] = field(default_factory=dict)
    # 제목 ↔ 문장(set_heading)과 그 되돌리기·다시 하기 — 활성이 된 단위로 한/영 코드 짝을 다시 세운다(짝은 기록 밖이다)
    repair_pairs: bool = False

    def list_regrouped_cells(self) -> list[int]:
        return sorted({*self.regroup, *(cell_id for draft in self.drafts for cell_id in draft.cells)})

    def is_unchanged(self) -> bool:
        """새 단위들의 (범위, 종류, 묶음)이 은퇴시킬 단위들의 것과 (모음으로) 같고 언어·칸 묶음·표 표시도 그대로면 바뀌는 게 없다.

        경계를 처음 자리나 사이 빈 글자에 다시 놓거나 단위 하나의 범위를 그대로 골라 만든 경우다 — 단위는 범위 그 자체라
        (스펙 §6.4) 같은 범위를 새 ID로 다시 만들면 표시 ID가 바뀌고 확정 판단이 이유 없이 떼어진다. 캡션 붙이기·떼기는
        범위가 그대로여도 종류·묶음이 바뀐다. 표 단위는 범위가 없어 범위로는 견줄 수 없으므로 묶음·표 표시가 바뀌면 바뀐 것이다.
        """
        if (
            self.revive or self.langs or self.layouts or self.noises or self.numbers or self.figures
            or self.list_regrouped_cells()
        ):
            return False
        drafts = Counter((tuple(draft.spans), draft.kind, draft.group_unit_id) for draft in self.drafts)
        return drafts == Counter(self.retired_shapes)


def _build_replacement(units: Iterable[Unit], drafts: list[_Draft]) -> _Change:
    """옛 단위들을 은퇴시키고 drafts를 만드는 변경."""
    replaced = list(units)
    return _Change(
        retire=sorted(unit.id for unit in replaced), drafts=drafts,
        retired_shapes=[(tuple(to_spans(unit.spans)), unit.kind, unit.group_unit_id) for unit in replaced],
    )


def _get_position(unit: Unit) -> tuple[int, int, int]:
    return unit.pos_seq, unit.pos_start, unit.id


def ensure_unique_units(unit_ids: Sequence[int]) -> None:
    repeated = sorted(unit_id for unit_id, count in Counter(unit_ids).items() if count > 1)
    if repeated:
        raise_rule(422, "duplicate_units", unit_ids=repeated)


def _ensure_text_kinds(units: Iterable[Unit]) -> None:
    wrong = sorted(unit.id for unit in units if unit.kind not in TEXT_KINDS)
    if wrong:
        raise_rule(422, "invalid_unit_kind", unit_ids=wrong)


def _ensure_not_toc(units: Iterable[Unit]) -> None:
    """목차 줄은 나누기 · 합치기 · 골라 만들기 · 경계 옮기기를 받지 않는다(사용자 결정 2026-11-19) — 먼저 목차 아님(clear_noise)."""
    locked = sorted(unit.id for unit in units if unit.noise_kind == NOISE_TOC)
    if locked:
        raise_rule(422, "toc_line_locked", unit_ids=locked)


async def load_active_units(
    session: AsyncSession, extraction_id: ExtractionId, unit_ids: Collection[int]
) -> dict[int, Unit]:
    """문서 최신 추출의 활성 단위 — 아닌 id(다른 문서·은퇴한 단위)가 있으면 404."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit).where(
            Unit.id.in_(chunk), Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE
        ),
        unit_ids,
    )
    units = {row[0].id: row[0] for row in rows}
    missing = sorted(set(unit_ids) - set(units))
    if missing:
        raise_rule(404, "unit_not_found", unit_ids=missing)
    return units


async def _load_blocks(
    session: AsyncSession, extraction_id: ExtractionId, block_ids: Collection[int]
) -> dict[int, _Block]:
    rows = await select_in_chunks(
        session,
        lambda chunk: select(
            SourceBlock.id, SourceBlock.seq, SourceBlock.text, SourceBlock.kind, SourceBlock.table_id,
            SourceBlock.row_index, SourceBlock.signals,
        ).where(SourceBlock.id.in_(chunk), SourceBlock.extraction_id == extraction_id),
        block_ids,
    )
    return {block_id: _Block(*fields) for block_id, *fields in rows}


async def _load_unit_blocks(
    session: AsyncSession, extraction_id: ExtractionId, units: Iterable[Unit]
) -> dict[int, _Block]:
    return await _load_blocks(session, extraction_id, {span[0] for unit in units for span in unit.spans})


def _build_draft(
    like: Unit, spans: list[Span], blocks: Mapping[int, _Block], *, kind: str | None = None, lang: str | None = None
) -> _Draft:
    """like의 묶음(그룹 단위)을 물려받는 새 단위 — 자리는 첫 범위의 블록·시작, 언어는 주지 않으면 글자로 판정한다.

    칸 문장의 표·행 번호는 첫 범위 칸 블록의 것이다(R33) — 행을 넘어 합친 칸을 다시 나누면 조각마다 자기 행을 가진다.
    문장·제목은 like를 따른다(표 밖이라 없음).
    문단 번호는 앞 조각에 남는다(§11-10) — 번호 범위는 새 범위와 블록 신호로 다시 읽고, 사람이 고친 값은 like와 같은 자리에서
    시작하는 조각만 물려받는다(자른 뒤 조각은 번호 없음, 합친 단위는 앞 단위의 번호).
    """
    kind = kind or like.kind
    first = blocks[spans[0][0]]
    is_cell = kind == "cell_sentence"
    table_id, row_index = (first.table_id, first.row_index) if is_cell else (like.table_id, like.row_index)
    texts = _get_texts(blocks)
    text = build_unit_text(spans, texts)
    signals = {block_id: block.signals for block_id, block in blocks.items()}
    number = build_number_columns(kind, spans, signals, texts)
    if like.spans and tuple(like.spans[0][:2]) == tuple(spans[0][:2]) and kind in NUMBERED_KINDS:
        number["number_set"] = like.number_set
        if like.number_source == NUMBER_PAIR and number["number_read"] is None and kind == "sentence":
            # 물려받은 번호(F8b)는 범위가 없어 다시 읽히지 않는다 — 같은 자리에서 시작하는 문장 조각이 그대로 갖는다(제목으로 되돌리면 버린다)
            number.update(number_read=like.number_read, number_source=NUMBER_PAIR, number_len=0)
    return _Draft(
        kind=kind, spans=spans, text=text, lang=lang or detect_language(text) or "", table_id=table_id,
        row_index=row_index, group_unit_id=like.group_unit_id, pos_seq=first.seq, pos_start=spans[0][1],
        number=number, from_heading=like.from_heading and kind == "sentence",
    )


def _get_texts(blocks: Mapping[int, _Block]) -> dict[int, str]:
    return {block_id: block.text for block_id, block in blocks.items()}


def _ensure_mergeable(units: Sequence[Unit]) -> None:
    """칸 문장·캡션은 같은 묶음(또는 모두 묶음 없음)의 같은 종류끼리만 — 다른 묶음과 합치면 처분을 따를 곳이 둘이 된다."""
    kinds = {unit.kind for unit in units}
    for bound_kind in ("cell_sentence", CAPTION_KIND):
        if bound_kind in kinds and (kinds != {bound_kind} or len({unit.group_unit_id for unit in units}) > 1):
            raise_rule(422, "cannot_merge", unit_ids=[unit.id for unit in units])


def _decide_merged_kind(units: Iterable[Unit]) -> str:
    """합친 단위의 종류 — 칸 문장끼리면 칸 문장, 캡션끼리면 캡션, 아니면 하나라도 문장이면 문장, 모두 제목이면 제목."""
    kinds = {unit.kind for unit in units}
    if "cell_sentence" in kinds:
        return "cell_sentence"
    if kinds == {CAPTION_KIND}:
        return CAPTION_KIND
    return "sentence" if "sentence" in kinds else "heading"


async def _plan_split(session: AsyncSession, extraction_id: ExtractionId, op: SplitOp) -> _Change:
    unit = (await load_active_units(session, extraction_id, [op.unit_id]))[op.unit_id]
    _ensure_text_kinds([unit])
    _ensure_not_toc([unit])
    spans = to_spans(unit.spans)
    located = locate_text_offset(spans, op.at) if 0 < op.at < len(unit.text) else None
    if located is None:
        raise_rule(422, "invalid_offset", unit_id=unit.id, at=op.at)
    blocks = await _load_unit_blocks(session, extraction_id, [unit])
    left, right = cut_spans(spans, *located, _get_texts(blocks))
    if not left or not right:
        raise_rule(422, "empty_part", unit_id=unit.id)
    drafts = [_build_draft(unit, left, blocks), _build_draft(unit, right, blocks)]
    if unit.kind == CAPTION_KIND:
        await _ensure_caption_split_languages(session, unit, [draft.lang for draft in drafts])
    return _build_replacement([unit], drafts)


async def _ensure_caption_split_languages(session: AsyncSession, unit: Unit, langs: list[str]) -> None:
    """캡션을 나눈 두 조각도 캡션이라 묶음당 언어 하나 규칙을 지켜야 한다 — 같은 언어 둘이 되거나 묶음의 다른 캡션과 언어가 겹치면
    422 caption_exists(reason split). 그대로 두면 묶음 저장이 같은 언어 캡션 둘을 받아 저장할 수 없다. 한/영 한 줄 캡션을 나누는 것만 된다."""
    others = set(
        await session.scalars(
            select(Unit.lang).where(
                Unit.group_unit_id == unit.group_unit_id, Unit.status == UNIT_ACTIVE, Unit.kind == CAPTION_KIND,
                Unit.id != unit.id,
            )
        )
    )
    if len(set(langs)) < len(langs) or others & set(langs):
        raise_rule(422, "caption_exists", unit_ids=[unit.id], reason="split")


async def _plan_merge(session: AsyncSession, extraction_id: ExtractionId, op: MergeOp) -> _Change:
    """결과 범위는 원문 순서로 모으고 같은 블록에서 사이가 빈 글자뿐이면 한 범위로 잇는다. 언어는 합친 단위들이 같으면 그 언어, 섞이면 글자로 판정한다."""
    ensure_unique_units(op.unit_ids)
    units = sorted((await load_active_units(session, extraction_id, op.unit_ids)).values(), key=_get_position)
    _ensure_text_kinds(units)
    _ensure_not_toc(units)
    _ensure_mergeable(units)
    langs = {unit.lang for unit in units}
    blocks = await _load_unit_blocks(session, extraction_id, units)
    spans = sorted(
        (span for unit in units for span in to_spans(unit.spans)), key=lambda span: (blocks[span[0]].seq, span[1])
    )
    draft = _build_draft(
        units[0], join_close_spans(spans, _get_texts(blocks)), blocks, kind=_decide_merged_kind(units),
        lang=next(iter(langs)) if len(langs) == 1 else None,  # 섞이면 글자로 판정(한글이 있으면 ko)
    )
    return _build_replacement(units, [draft])


async def find_merge_edit(session: AsyncSession, document_id: int, unit_id: int) -> UnitEdit | None:
    """unit_id를 만든 적용 중인 합치기 기록 — 없으면 이 단위는 합쳐 생긴 단위가 아니거나 그 뒤로 다시 만들어졌다."""
    edits = await session.scalars(
        select(UnitEdit)
        .where(UnitEdit.document_id == document_id, UnitEdit.op == "merge", UnitEdit.state == EDIT_APPLIED)
        .order_by(UnitEdit.seq.desc())
    )
    return next((edit for edit in edits if list(edit.created_unit_ids) == [unit_id]), None)


async def _plan_unmerge(session: AsyncSession, document_id: int, extraction_id: ExtractionId, op: UnmergeOp) -> _Change:
    """합친 단위를 은퇴시키고 합치기가 은퇴시킨 단위를 원래 ID로 되살린다 — 그 합치기만 골라 되돌리는 것.

    같은 언어끼리 합쳤고 그 뒤 언어를 바꿨으면 되살린 단위도 지금 언어를 따른다. 언어가 섞인 합치기는 각 단위가 제
    언어로 돌아온다. 짝·판단은 되살리지 않는다(되돌리기와 같다).
    """
    unit = (await load_active_units(session, extraction_id, [op.unit_id]))[op.unit_id]
    edit = await find_merge_edit(session, document_id, unit.id)
    if edit is None:
        raise_rule(422, "cannot_unmerge", unit_id=unit.id)
    originals = list(
        await session.scalars(
            select(Unit).where(Unit.id.in_(edit.retired_unit_ids), Unit.extraction_id == extraction_id)
        )
    )
    if len(originals) != len(edit.retired_unit_ids) or any(original.status != UNIT_RETIRED for original in originals):
        raise_rule(422, "cannot_unmerge", unit_id=unit.id)
    is_mixed = len({original.lang for original in originals}) > 1
    return _Change(
        retire=[unit.id],
        revive=sorted(original.id for original in originals),
        langs={}
        if is_mixed
        else {original.id: (original.lang, unit.lang) for original in originals if original.lang != unit.lang},
        # 합친 칸 문장이 그 뒤 다른 묶음(레이아웃 표 바꾸기 등)으로 옮겨졌으면 되살린 칸도 지금 묶음으로
        regroup={
            original.id: (original.group_unit_id, unit.group_unit_id)
            for original in originals if original.group_unit_id != unit.group_unit_id
        },
    )


async def _plan_move_boundary(session: AsyncSession, extraction_id: ExtractionId, op: MoveBoundaryOp) -> _Change:
    ensure_unique_units([op.left_unit_id, op.right_unit_id])
    units = await load_active_units(session, extraction_id, [op.left_unit_id, op.right_unit_id])
    left, right = units[op.left_unit_id], units[op.right_unit_id]
    _ensure_text_kinds([left, right])
    _ensure_not_toc([left, right])
    left_spans, right_spans = to_spans(left.spans), to_spans(right.spans)
    block_id, left_start, left_end = left_spans[-1]
    right_block_id, right_start, right_end = right_spans[0]
    blocks = await _load_unit_blocks(session, extraction_id, [left, right])
    text = blocks[block_id].text
    # 사이에 보이는 글자가 있으면 그 글자를 덮은 다른 단위가 끼어 있다(커버리지 불변식)
    if right_block_id != block_id or left_end > right_start or has_visible_char(text[left_end:right_start]):
        raise_rule(422, "not_adjacent", unit_ids=[left.id, right.id])
    if not left_start <= op.at <= right_end:
        raise_rule(422, "invalid_offset", at=op.at)
    head, tail = cut_spans([(block_id, left_start, right_end)], 0, op.at, {block_id: text})
    new_left, new_right = [*left_spans[:-1], *head], [*tail, *right_spans[1:]]
    if not new_left or not new_right:
        raise_rule(422, "empty_part", unit_ids=[left.id, right.id])
    return _build_replacement(
        [left, right], [_build_draft(left, new_left, blocks), _build_draft(right, new_right, blocks)]
    )


async def _plan_carve(session: AsyncSession, extraction_id: ExtractionId, op: CarveOp) -> _Change:
    """범위와 겹치는 커버 단위(그림 제외)를 은퇴시키고, 범위 앞·뒤 나머지는 단위마다 새 단위로, 범위는 새 단위 하나로."""
    block = (await _load_blocks(session, extraction_id, [op.block_id])).get(op.block_id)
    if block is None:
        raise_rule(404, "block_not_found", block_id=op.block_id)
    if block.kind == "figure":  # 캡션은 그림 단위의 것이라 글자 단위로 떼어 내지 않는다
        raise_rule(422, "invalid_block", block_id=op.block_id)
    if not op.start < op.end <= len(block.text):
        raise_rule(422, "invalid_offset", start=op.start, end=op.end)
    carved = trim_span((op.block_id, op.start, op.end), {op.block_id: block.text})
    if carved is None:
        raise_rule(422, "empty_part", block_id=op.block_id)
    _, start, end = carved
    # 범위가 JSON이라 블록으로 거를 수 없다 — 활성 글자 단위의 범위만 읽어 겹치는 것을 고른다
    rows = await session.execute(
        select(Unit.id, Unit.spans).where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.kind.in_(TEXT_KINDS)
        )
    )
    hit_ids = [unit_id for unit_id, spans in rows if overlaps(to_spans(spans), op.block_id, start, end)]
    units = sorted((await load_active_units(session, extraction_id, hit_ids)).values(), key=_get_position)
    _ensure_not_toc(units)
    # 붙인 캡션은 문단 안 다른 문장과 한 블록에 있을 수 있다 — 골라 만든 조각이 묶음 둘에 걸치지 않게 합치기와 같이 막는다
    _ensure_mergeable(units)
    blocks = await _load_unit_blocks(session, extraction_id, units)
    texts, seqs = _get_texts(blocks), {block_id: item.seq for block_id, item in blocks.items()}
    drafts = []
    for unit in units:
        before, after = split_around(to_spans(unit.spans), op.block_id, start, end, texts, seqs)
        drafts.extend(_build_draft(unit, part, blocks) for part in (before, after) if part)
    drafts.append(_build_draft(units[0], [carved], blocks, kind=_decide_merged_kind(units)))
    return _build_replacement(units, drafts)


async def _plan_set_language(session: AsyncSession, extraction_id: ExtractionId, op: SetLanguageOp) -> _Change:
    ensure_unique_units(op.unit_ids)
    units = await load_active_units(session, extraction_id, op.unit_ids)
    _ensure_text_kinds(units.values())
    changes = {unit_id: (unit.lang, op.lang) for unit_id, unit in sorted(units.items()) if unit.lang != op.lang}
    await _ensure_one_caption_per_language(session, [units[unit_id] for unit_id in changes], op.lang)
    return _Change(langs=changes)


async def _ensure_one_caption_per_language(session: AsyncSession, changing: Sequence[Unit], lang: str) -> None:
    """언어를 바꿀 캡션의 묶음에 그 언어 캡션이 둘 이상 되면 422 caption_exists — 붙이기와 같은 묶음당 언어 하나 규칙."""
    bundle_ids = {unit.group_unit_id for unit in changing if unit.kind == CAPTION_KIND}
    if not bundle_ids:
        return
    changing_ids = {unit.id for unit in changing}
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit.id, Unit.group_unit_id, Unit.lang).where(
            Unit.group_unit_id.in_(chunk), Unit.status == UNIT_ACTIVE, Unit.kind == CAPTION_KIND
        ),
        bundle_ids,
    )
    by_bundle: dict[int, list[int]] = defaultdict(list)
    for unit_id, group_unit_id, unit_lang in rows:
        if unit_id in changing_ids or unit_lang == lang:
            by_bundle[group_unit_id].append(unit_id)
    clashing = sorted(unit_id for unit_ids in by_bundle.values() if len(unit_ids) > 1 for unit_id in unit_ids)
    if clashing:
        raise_rule(422, "caption_exists", unit_ids=clashing)


async def _plan_set_ref(session: AsyncSession, extraction_id: ExtractionId, op: SetRefOp) -> _Change:
    unit = (await load_active_units(session, extraction_id, [op.unit_id]))[op.unit_id]
    _ensure_text_kinds([unit])
    if read_number_in_text(unit.text, op.number) is None:
        raise_rule(422, "ref_number_not_in_text", unit_ids=[unit.id])
    return _Change(langs={} if unit.lang == REF_LANG else {unit.id: (unit.lang, REF_LANG)})


async def _plan_clear_ref(session: AsyncSession, extraction_id: ExtractionId, op: ClearRefOp) -> _Change:
    unit = (await load_active_units(session, extraction_id, [op.unit_id]))[op.unit_id]
    _ensure_text_kinds([unit])
    if unit.lang != REF_LANG:
        return _Change()
    mark = await session.get(UnitRef, unit.id)
    # 표시 없이 REF가 된 단위는 없지만(set_ref만 REF를 만든다) 있더라도 글자로 언어를 정해 돌린다
    lang = (mark.prev_lang if mark is not None else "") or detect_language(unit.text) or "en"
    return _Change(langs={unit.id: (REF_LANG, lang)})


async def _plan_clear_noise(session: AsyncSession, extraction_id: ExtractionId, op: ClearNoiseOp) -> _Change:
    """표시가 붙은 단위만 비운다 — 이미 표시가 없는 단위는 바뀌는 게 없다(블록 전체 풀기에 섞여 와도 된다)."""
    ensure_unique_units(op.unit_ids)
    units = await load_active_units(session, extraction_id, op.unit_ids)
    return _Change(
        noises={unit_id: (unit.noise_kind, None) for unit_id, unit in sorted(units.items()) if unit.noise_kind is not None}
    )


async def _plan_set_heading(
    session: AsyncSession, document_id: int, extraction_id: ExtractionId, op: SetHeadingOp
) -> _Change:
    """제목 ↔ 문장 — 제목은 문장마다 나눠 바꾼 표시를 달고(번호 없는 번역 조항은 앞 조항의 번호를 물려받는다), 문장은 제목 하나로.

    바꿀 수 없는 단위(heading이면 문장 아닌 것, 아니면 제목 아닌 것, 묶인 칸 문장·목차 줄)는 422 heading_shift_kind —
    제목 스타일 조항은 표 밖 문단이다.
    """
    ensure_unique_units(op.unit_ids)
    units = await load_active_units(session, extraction_id, op.unit_ids)
    wanted = "sentence" if op.heading else "heading"
    wrong = sorted(
        unit.id for unit in units.values()
        if unit.kind != wanted or unit.noise_kind is not None or unit.group_unit_id is not None
        # 띠 표 제목 줄의 반대 길은 "표로 되돌리기"(set_layout_table)다
        or is_band_heading(unit.kind, unit.table_id)
    )
    if wrong:
        raise_rule(422, "heading_shift_kind", unit_ids=wrong)
    if op.heading:
        document = await session.get_one(Document, document_id)
        groups = await _gather_heading_lines(session, extraction_id, units.values(), document.file_format == LINE_SPLIT_FORMAT)
        replaced = [unit for group in groups for unit in group]
        blocks = await _load_unit_blocks(session, extraction_id, replaced)
        drafts = [_build_heading_draft(group, blocks) for group in groups]
    else:
        replaced = sorted(units.values(), key=_get_position)
        blocks = await _load_unit_blocks(session, extraction_id, replaced)
        drafts = [draft for unit in replaced for draft in _build_sentence_drafts(unit, blocks)]
        await _inherit_numbers(session, extraction_id, drafts, {unit.id for unit in replaced})
    change = _build_replacement(replaced, drafts)
    change.repair_pairs = True
    return change


async def _gather_heading_lines(
    session: AsyncSession, extraction_id: ExtractionId, units: Iterable[Unit], split_lines: bool
) -> list[list[Unit]]:
    """제목으로 되돌릴 묶음들(원문 순서) — 바꾼 문장은 그 조항 줄(블록, split_lines면 블록 안 줄)의 바꾼 문장 모두, 보통 문장은 그 하나."""
    groups: dict[tuple[int, int], list[Unit]] = {}
    for unit in sorted(units, key=_get_position):
        if not unit.from_heading:
            groups[(unit.pos_seq, unit.pos_start)] = [unit]
            continue
        block = (await _load_blocks(session, extraction_id, [unit.spans[0][0]]))[unit.spans[0][0]]
        line_start = block.text.rfind("\n", 0, unit.pos_start) + 1 if split_lines else 0
        line_end = block.text.find("\n", unit.pos_start) if split_lines else -1
        line_end = len(block.text) if line_end < 0 else line_end
        if (unit.pos_seq, line_start) in groups:
            continue
        siblings = await session.scalars(
            select(Unit)
            .where(
                Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.pos_seq == unit.pos_seq,
                Unit.pos_start >= line_start, Unit.pos_start < line_end, Unit.kind == "sentence",
                Unit.from_heading.is_(True), Unit.noise_kind.is_(None), Unit.group_unit_id.is_(None),
            )
            .order_by(Unit.pos_start, Unit.id)
        )
        groups[(unit.pos_seq, line_start)] = list(siblings)
    return [groups[key] for key in sorted(groups)]


def _build_heading_draft(group: Sequence[Unit], blocks: Mapping[int, _Block]) -> _Draft:
    """문장들을 제목 하나로 — 합치기처럼 범위를 원문 순서로 잇고, 언어가 같으면 그 언어(섞이면 글자로)."""
    spans = sorted(
        (span for unit in group for span in to_spans(unit.spans)), key=lambda span: (blocks[span[0]].seq, span[1])
    )
    langs = {unit.lang for unit in group}
    return _build_draft(
        group[0], join_close_spans(spans, _get_texts(blocks)), blocks, kind="heading",
        lang=next(iter(langs)) if len(langs) == 1 else None,
    )


def _build_sentence_drafts(unit: Unit, blocks: Mapping[int, _Block]) -> list[_Draft]:
    """제목 하나 → 범위마다 보통 문장 나누기(segment.split_sentences)로 나눈 문장들. 언어는 제목의 것을 잇는다."""
    drafts: list[_Draft] = []
    for block_id, start, end in to_spans(unit.spans):
        for sentence_start, sentence_end in split_sentences(blocks[block_id].text[start:end]):
            span = (block_id, start + sentence_start, start + sentence_end)
            draft = _build_draft(unit, [span], blocks, kind="sentence", lang=unit.lang)
            draft.from_heading = True
            drafts.append(draft)
    return drafts


async def _inherit_numbers(
    session: AsyncSession, extraction_id: ExtractionId, drafts: Sequence[_Draft], retiring: Collection[int]
) -> None:
    """바꾼 문장 초안의 번호 물려받기(F8b) — 처음 쪼개기와 같은 규칙(numbering.find_inherited_numbers)을 초안과 앞 블록의 활성 단위로 본다."""
    seqs = {draft.pos_seq for draft in drafts} | {draft.pos_seq - 1 for draft in drafts}
    existing = [
        unit
        for unit in await session.scalars(
            select(Unit).where(
                Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.pos_seq.in_(seqs),
                Unit.noise_kind.is_(None),
            )
        )
        if unit.id not in retiring
    ]
    entries: list[tuple[tuple[int, int], ClauseLine, _Draft | None]] = [
        ((unit.pos_seq, unit.pos_start), ClauseLine(unit.pos_seq, unit.lang, unit.kind, unit.from_heading, get_number(unit)), None)
        for unit in existing
    ]
    for draft in drafts:
        number = read_draft_number(draft.kind, draft.from_heading, draft.number)
        if draft.number.get("number_set") is not None:
            number = draft.number["number_set"] or None
        entries.append(((draft.pos_seq, draft.pos_start), ClauseLine(draft.pos_seq, draft.lang, draft.kind, True, number), draft))
    entries.sort(key=lambda entry: entry[0])
    for index, number in find_inherited_numbers([entry[1] for entry in entries]).items():
        draft = entries[index][2]
        if draft is not None:
            draft.number.update(number_read=number, number_source=NUMBER_PAIR, number_len=0)


async def _save_ref_mark(session: AsyncSession, op: SetRefOp | ClearRefOp, actor: str) -> None:
    """사람의 뜻(참조다·아니다)과 번호를 남긴다 — 언어를 바꾸기 전에 불러 그 전 언어를 기억한다."""
    unit = await session.get_one(Unit, op.unit_id)
    mark = await session.get(UnitRef, op.unit_id)
    if mark is None:
        mark = UnitRef(unit_id=op.unit_id, state=REF_REJECTED, decided_by=actor)
        session.add(mark)
    if isinstance(op, SetRefOp):
        mark.state = REF_CONFIRMED
        mark.number = read_number_in_text(unit.text, op.number) or ""
        if unit.lang != REF_LANG:
            mark.prev_lang = unit.lang
    else:
        mark.state = REF_REJECTED
    mark.decided_by = actor
    mark.decided_at = clock.now()


async def _plan_set_number(session: AsyncSession, extraction_id: ExtractionId, op: SetNumberOp) -> _Change:
    """고칠 단위와(follow면) 같은 목록의 뒤 단위들의 number_set, 그 번호가 열던 절의 블록 범위.

    같은 목록 후보는 같은 언어 · 같은 표(표 밖이면 표 밖)의 글 단위다 — 한/영이 번갈아 놓인 문서에서 한 언어의 고침이 다른
    언어 줄을 밀지 않게 한다(짝은 Unit마다 자기 번호, F5). 띠 표 제목 줄은 표 밖 줄로 친다(프런트 number-model.ts와 같은 규칙).
    """
    unit = (await load_active_units(session, extraction_id, [op.unit_id]))[op.unit_id]
    if unit.kind not in NUMBERED_KINDS or unit.noise_kind is not None:  # 목차 줄은 번호 칸이 없다
        raise_rule(422, "invalid_unit_kind", unit_ids=[unit.id])
    targets: dict[int, tuple[Unit, str]] = {unit.id: (unit, NO_NUMBER if op.number is None else op.number)}
    if op.follow and op.number is not None:
        siblings = list(
            await session.scalars(
                select(Unit)
                .where(
                    Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.kind.in_(NUMBERED_KINDS),
                    Unit.lang == unit.lang, Unit.noise_kind.is_(None),
                    # 띠 표 제목 줄은 장마다 자기 원문 표를 가리키지만 표 밖 줄과 한 목록이다(F4) — 표 밖이면 띠 표 제목도 후보
                    or_(Unit.table_id.is_(None), Unit.kind == "heading")
                    if unit.table_id is None or is_band_heading(unit.kind, unit.table_id)
                    else Unit.table_id == unit.table_id,
                )
                .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
            )
        )
        index = next(position for position, sibling in enumerate(siblings) if sibling.id == unit.id)
        followed = plan_follow([get_number(sibling) for sibling in siblings], index, op.number)
        targets.update(
            {siblings[position].id: (siblings[position], number) for position, number in followed.items()
             if len(number) <= MAX_NUMBER_CHARS}
        )
    change = _Change()
    renamed: list[tuple[Unit, str | None, str]] = []
    for target, number in targets.values():
        before = (get_number(target), get_hidden_len(target))
        after_set: NumberSet = number
        if number and target.number_set is None and number == before[0]:
            after_set = None  # 읽은 값 그대로면 고친 것이 아니다
        if after_set == NO_NUMBER and before == (None, 0):
            continue  # 번호가 없던 줄의 "번호 없음"
        if after_set != target.number_set:
            change.numbers[target.id] = (target.number_set, after_set)
            if number:
                renamed.append((target, before[0], number))
    change.sections = await _find_section_moves(session, extraction_id, renamed)
    return change


async def _find_section_moves(
    session: AsyncSession, extraction_id: ExtractionId, renamed: Sequence[tuple[Unit, str | None, str]]
) -> list[SectionMove]:
    """번호가 바뀐 단위(단위, 옛 번호, 새 번호) 가운데 절을 여는 줄의 블록 범위 — 그 아래 줄의 절이 고친 번호를 따라온다.

    절을 여는 줄 = 자리 블록의 절 이름이 그 줄의 옛 번호이고(번호를 못 읽은 제목은 제목 글) 앞 블록의 절 이름과 다른 줄.
    범위는 그 블록부터 같은 절 이름이 이어지는 데까지다.
    """
    if not renamed:
        return []
    rows = await session.execute(
        select(SourceBlock.seq, SourceBlock.section_label)
        .where(SourceBlock.extraction_id == extraction_id)
        .order_by(SourceBlock.seq)
    )
    labels = dict(rows.tuples().all())
    moves: dict[int, SectionMove] = {}
    for unit, old, new in renamed:
        label = labels.get(unit.pos_seq)
        opens = old is not None and label == normalize_number(old)
        if old is None and unit.kind == "heading":
            opens = label == unit.text.strip()[: SourceBlock.section_label.type.length]
        new_label = normalize_number(new)[: SourceBlock.section_label.type.length]
        if not opens or label == new_label or labels.get(unit.pos_seq - 1) == label:
            continue
        last = unit.pos_seq
        while labels.get(last + 1) == label:
            last += 1
        moves[unit.pos_seq] = (unit.pos_seq, last, label, new_label)
    return [moves[seq] for seq in sorted(moves)]


async def _load_table(session: AsyncSession, extraction_id: ExtractionId, table_id: int) -> SourceTable:
    table = await session.scalar(
        select(SourceTable).where(SourceTable.id == table_id, SourceTable.extraction_id == extraction_id)
    )
    if table is None:
        raise_rule(404, "table_not_found", table_id=table_id)
    return table


async def _load_table_units(
    session: AsyncSession, extraction_id: ExtractionId, table_id: int, kinds: Collection[str]
) -> list[Unit]:
    """원문 표 하나의 활성 표 단위(원문 순) — 칸 안의 표는 table_id가 달라 섞이지 않는다."""
    rows = await session.scalars(
        select(Unit)
        .where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.table_id == table_id,
            Unit.kind.in_(kinds),
        )
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    return list(rows)


async def _load_grouped_cells(session: AsyncSession, group_unit_ids: Collection[int]) -> list[Unit]:
    """표 단위들에 묶인 활성 칸 문장(원문 순)."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit).where(Unit.group_unit_id.in_(chunk), Unit.status == UNIT_ACTIVE),
        group_unit_ids,
    )
    return sorted((row[0] for row in rows), key=_get_position)


async def _load_first_cell_seqs(session: AsyncSession, extraction_id: ExtractionId, table_id: int) -> dict[int, int]:
    """원문 표의 행 → 그 행 첫 칸 블록 seq — 표 단위의 자리(처음 쪼개기처럼 빈 칸 블록도 센다)."""
    rows = await session.execute(
        select(SourceBlock.row_index, func.min(SourceBlock.seq))
        .where(
            SourceBlock.extraction_id == extraction_id, SourceBlock.table_id == table_id,
            SourceBlock.kind == "table_cell",
        )
        .group_by(SourceBlock.row_index)
    )
    return dict(rows.tuples().all())


def _build_group_draft(
    kind: str, table_id: int, row_index: int | None, pos_seq: int, cells: Mapping[int, int | None]
) -> _Draft:
    """표 단위 — 범위·글자 없음, 중립, 자리는 첫 칸 블록의 칸 문장보다 앞(pos_start=-1). cells는 칸 문장 → 지금 묶음."""
    return _Draft(
        kind=kind, spans=[], text="", lang=NEUTRAL, table_id=table_id, row_index=row_index, group_unit_id=None,
        pos_seq=pos_seq, pos_start=-1, cells=dict(cells),
    )


async def _find_crossing_cells(
    session: AsyncSession, extraction_id: ExtractionId, table_id: int
) -> tuple[list[int], list[int]]:
    """묶이지 않은 활성 칸 문장 중 (이 표의 것, 표 경계를 넘은 것) — 레이아웃 칸은 다른 표 칸과도 합칠 수 있다.

    이 표의 칸 문장(첫 범위 블록이 이 표, R33)이 다른 블록에 걸치거나 다른 표의 칸 문장이 이 표 블록에 걸치면 넘은 것이다.
    """
    table_blocks = set(
        await session.scalars(
            select(SourceBlock.id).where(SourceBlock.extraction_id == extraction_id, SourceBlock.table_id == table_id)
        )
    )
    rows = await session.execute(
        select(Unit.id, Unit.table_id, Unit.spans)
        .where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.kind == "cell_sentence",
            Unit.group_unit_id.is_(None),
        )
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    own: list[int] = []
    crossing: list[int] = []
    for unit_id, unit_table_id, spans in rows:
        is_own = unit_table_id == table_id
        if is_own:
            own.append(unit_id)
        if any((block_id in table_blocks) != is_own for block_id, _, _ in spans):
            crossing.append(unit_id)
    return own, sorted(crossing)


def _build_sentence_from(caption: Unit) -> _Draft:
    return _Draft(
        kind="sentence", spans=to_spans(caption.spans), text=caption.text, lang=caption.lang, table_id=None,
        row_index=None, group_unit_id=None, pos_seq=caption.pos_seq, pos_start=caption.pos_start,
    )


def _build_freed_caption(caption: Unit, blocks: Mapping[int, _Block], group_unit_id: int | None) -> _Draft:
    """캡션을 뗀 글 단위 — 표 첫 행에서 올린 캡션(칸 블록 위)은 그 칸의 칸 문장(group_unit_id에 묶임), 아니면 묶이지 않은 문장."""
    if blocks[caption.spans[0][0]].kind != "table_cell":
        return _build_sentence_from(caption)
    draft = _build_draft(caption, to_spans(caption.spans), blocks, kind="cell_sentence", lang=caption.lang)
    draft.group_unit_id = group_unit_id
    return draft


async def _find_number_joins(
    session: AsyncSession, extraction_id: ExtractionId, table_id: int, cells: Sequence[Unit]
) -> list[tuple[Unit, Unit]]:
    """푸는 표에서 (번호만 든 칸의 줄, 그 번호를 받을 줄) — 처음 쪼개기의 레이아웃 표 규칙(segment.build_unit_drafts)과 같다.

    번호 칸("A", "7" — 추출 신호 cell)은 같은 행 다음 칸의 첫 줄 앞에 붙는다. 빈 칸은 건너뛰고, 다른 행·다른 표(안쪽 표)·표 밖
    블록이 먼저 오거나 번호 칸이 잇달아 오면 그 번호 칸은 제 줄로 남는다(§11-7). 칸 줄을 사람이 나눠 칸에 줄이 둘 이상이면 번호 칸이 아니다.
    """
    if not cells:
        return []
    by_block: dict[int, list[Unit]] = defaultdict(list)
    for cell in sorted(cells, key=_get_position):
        by_block[cell.spans[0][0]].append(cell)
    seqs = await session.execute(
        select(func.min(SourceBlock.seq), func.max(SourceBlock.seq)).where(
            SourceBlock.extraction_id == extraction_id, SourceBlock.table_id == table_id
        )
    )
    first_seq, last_seq = seqs.one()
    rows = await session.execute(
        select(SourceBlock.id, SourceBlock.kind, SourceBlock.table_id, SourceBlock.row_index, SourceBlock.signals)
        .where(SourceBlock.extraction_id == extraction_id, SourceBlock.seq.between(first_seq, last_seq))
        .order_by(SourceBlock.seq)
    )
    joins: list[tuple[Unit, Unit]] = []
    waiting: tuple[Unit, int | None] | None = None  # 번호 칸의 줄과 그 행
    for block_id, kind, block_table_id, row_index, signals in rows.tuples():
        is_same_row = kind == "table_cell" and block_table_id == table_id
        if waiting is not None and not (is_same_row and row_index == waiting[1]):
            waiting = None
        own = by_block.get(block_id, []) if block_table_id == table_id else []
        if len(own) == 1 and len(own[0].spans) == 1 and is_number_cell_range(signals, own[0].spans[0][1], own[0].spans[0][2]):
            waiting = (own[0], row_index)
        elif waiting is not None and own:
            joins.append((waiting[0], own[0]))
            waiting = None
    return joins


async def _plan_set_layout_table(
    session: AsyncSession, document_id: int, extraction_id: ExtractionId, op: SetLayoutTableOp
) -> _Change:
    """데이터 → 레이아웃: 표 단위를 은퇴시키고 칸 문장의 묶음을 푼다. 번호만 든 칸은 같은 행 다음 칸의 첫 줄과 한 줄이 되어
    그 줄의 번호가 된다(_find_number_joins). 레이아웃 → 데이터: 새 표 단위에 칸 문장을 묶는다 — 번호를 받은 줄은 그대로 한 줄로
    묶인다(표 안에서는 보이는 모양이 같다, 되돌리기는 Ctrl+Z가 처음 모양으로 돌린다).

    칸 안의 표는 따로 바뀐다(table_id가 다르다, 누른 표만 — F2). 다만 바로 안쪽의 띠 표는 바깥 표를 벗기면 함께 제목 줄이 되고
    다시 묶으면 함께 표로 돌아간다(F2 · F4, 한 편집이라 Ctrl+Z 한 번). 이미 그 표시면 바뀌는 게 없다. 띠 표는 단위 모양이
    바뀐다(_plan_band_layout).
    """
    table = await _load_table(session, extraction_id, op.table_id)
    if table.is_layout == op.is_layout:
        return _Change()
    if is_band_table(table.signals):
        return await _plan_band_layout(session, document_id, extraction_id, table, op.is_layout)
    change = await _plan_plain_layout(session, extraction_id, table, op.is_layout)
    inner_tables = (
        await session.scalars(
            select(SourceTable)
            .where(
                SourceTable.extraction_id == extraction_id, SourceTable.parent_table_id == table.id,
                SourceTable.is_layout != op.is_layout,
            )
            .order_by(SourceTable.table_index)
        )
    ).all()
    for band in inner_tables:
        if is_band_table(band.signals):
            change = _merge_changes(change, await _plan_band_layout(session, document_id, extraction_id, band, op.is_layout))
    return change


async def _plan_plain_layout(
    session: AsyncSession, extraction_id: ExtractionId, table: SourceTable, to_layout: bool
) -> _Change:
    """띠 표가 아닌 표 하나의 데이터 ↔ 레이아웃(_plan_set_layout_table의 몸통)."""
    if to_layout:
        groups = await _load_table_units(session, extraction_id, table.id, TABLE_UNIT_KINDS)
        members = await _load_grouped_cells(session, [group.id for group in groups])
        # 레이아웃 표의 캡션은 보통 문장으로 돌아간다(명세 §3.1) — 같은 범위·언어의 묶이지 않은 문장 단위로 바꾼다
        captions = [member for member in members if member.kind == CAPTION_KIND]
        cells = [member for member in members if member.kind != CAPTION_KIND]
        joins = await _find_number_joins(session, extraction_id, table.id, cells)
        joined = [unit for pair in joins for unit in pair]
        blocks = await _load_unit_blocks(session, extraction_id, [*joined, *captions])
        # 첫 행에서 올린 캡션은 풀린 표의 칸 줄로 돌아간다(묶이지 않은 칸 문장 — 다른 칸 줄과 같다)
        drafts = [_build_freed_caption(caption, blocks, None) for caption in captions]
        for number, content in joins:
            # 번호 칸 블록 전체가 그 줄 범위의 첫 조각 — 처음 쪼개기의 레이아웃 표와 같은 단위(§11-7), 묶음은 풀린다.
            # 같은 자리에서 시작하는 번호 칸 줄을 like로 — 사람이 고친 번호(number_set)를 이은 줄이 물려받는다
            spans = [*to_spans(number.spans), *to_spans(content.spans)]
            draft = _build_draft(number, spans, blocks, kind=content.kind, lang=content.lang)
            draft.group_unit_id = None
            drafts.append(draft)
        change = _build_replacement([*groups, *captions, *joined], drafts)
        joined_ids = {unit.id for unit in joined}
        change.regroup = {cell.id: (cell.group_unit_id, None) for cell in cells if cell.id not in joined_ids}
    else:
        own, crossing = await _find_crossing_cells(session, extraction_id, table.id)
        if crossing:
            raise_rule(422, "cell_crosses_table", unit_ids=crossing)
        first_seqs = await _load_first_cell_seqs(session, extraction_id, table.id)
        # 칸 블록이 없는 표는 처음 쪼개기처럼 표 단위를 만들지 않는다
        change = _Change(
            drafts=[_build_group_draft("table", table.id, None, min(first_seqs.values()), dict.fromkeys(own))]
            if first_seqs else []
        )
    change.layouts = {table.id: (table.is_layout, to_layout)}
    return change


def _merge_changes(first: _Change, second: _Change) -> _Change:
    """두 변경을 한 편집으로 — 표 벗기기와 안쪽 띠 표 바꾸기. 둘은 다른 표의 단위만 건드린다.

    _Change의 모든 칸을 칸 꼴대로 합친다(목록은 잇고 사전은 더하고 참거짓은 또는) — 칸을 더해도 여기서 조용히 빠지지 않는다.
    같은 변경 안 표 단위를 가리키는 칸(group_draft)은 앞 변경의 초안 수만큼 민다.
    """
    offset = len(first.drafts)
    for draft in second.drafts:
        if draft.group_draft is not None:
            draft.group_draft += offset
    merged: dict[str, object] = {}
    for item in fields(_Change):
        left, right = getattr(first, item.name), getattr(second, item.name)
        if isinstance(left, bool):
            merged[item.name] = left or right
        elif isinstance(left, list):
            merged[item.name] = [*left, *right]
        elif isinstance(left, dict):
            merged[item.name] = {**left, **right}
        else:
            raise TypeError(f"_Change.{item.name} has no merge rule: {type(left).__name__}")
    merged["retire"] = sorted({*first.retire, *second.retire})
    return _Change(**merged)


async def _plan_band_layout(
    session: AsyncSession, document_id: int, extraction_id: ExtractionId, table: SourceTable, to_layout: bool
) -> _Change:
    """띠 표 ↔ 제목 줄(F4) — 벗기면 표·칸 단위를 거두고 번호 칸을 품은 제목 줄을, "표로 되돌리기"는 제목 줄을 거두고 데이터 표
    (표 단위 + 묶인 칸 문장)를 만든다. 두 쪽 모두 처음 쪼개기(segment.build_unit_drafts)가 만드는 단위 그대로다. 편집 하나라
    되돌리기·다시 하기는 같은 단위 ID로 오간다. 칸 밖까지 이은 줄이 있으면 표로 되돌리지 않는다(422 cell_crosses_table).
    """
    extra: list[_Draft] = []
    if to_layout:
        groups = await _load_table_units(session, extraction_id, table.id, TABLE_UNIT_KINDS)
        members = await _load_grouped_cells(session, [group.id for group in groups])
        replaced = [*groups, *members]
        # 캡션은 보통 레이아웃 표처럼 문장으로 돌아간다
        extra = [_build_sentence_from(member) for member in members if member.kind == CAPTION_KIND]
    else:
        replaced = await _find_band_units(session, extraction_id, table.id)
    document = await session.get_one(Document, document_id)
    drafts = await _build_band_drafts(session, document, extraction_id, table.id, to_layout)
    _carry_number_sets(replaced, drafts)
    change = _build_replacement(replaced, [*drafts, *extra])
    change.layouts = {table.id: (table.is_layout, to_layout)}
    return change


def _carry_number_sets(replaced: Iterable[Unit], drafts: Iterable[_Draft]) -> None:
    """사람이 고친 번호(number_set)를 같은 자리(첫 범위의 블록 · 시작)에서 시작하는 새 단위로 — 띠 표 제목 줄의 번호 칸 범위와
    표의 번호 칸 줄은 같은 자리에서 시작하므로 벗기기 · 표로 되돌리기를 오가도 고친 번호가 남는다(_build_draft의 물려받기와 같은 규칙)."""
    fixed = {
        tuple(unit.spans[0][:2]): unit.number_set
        for unit in replaced if unit.spans and unit.number_set is not None and unit.kind in NUMBERED_KINDS
    }
    for draft in drafts:
        number_set = fixed.get(tuple(draft.spans[0][:2])) if draft.spans and draft.kind in NUMBERED_KINDS else None
        if number_set is not None:
            draft.number["number_set"] = number_set


async def _find_band_units(session: AsyncSession, extraction_id: ExtractionId, table_id: int) -> list[Unit]:
    """벗긴 띠 표의 블록만 덮는 활성 단위(제목 줄과 그 조각) — 표 밖 단위와 이은 것이 있으면 422 cell_crosses_table."""
    table_blocks = set(
        await session.scalars(
            select(SourceBlock.id).where(SourceBlock.extraction_id == extraction_id, SourceBlock.table_id == table_id)
        )
    )
    rows = await session.execute(
        select(Unit.id, Unit.spans).where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.group_unit_id.is_(None),
            Unit.kind.in_(TEXT_KINDS),
        )
    )
    own: list[int] = []
    crossing: list[int] = []
    for unit_id, spans in rows:
        inside = [span[0] in table_blocks for span in spans]
        if inside and all(inside):
            own.append(unit_id)
        elif any(inside):
            crossing.append(unit_id)
    if crossing:
        raise_rule(422, "cell_crosses_table", unit_ids=sorted(crossing))
    return sorted((await load_active_units(session, extraction_id, own)).values(), key=_get_position)


async def _build_band_drafts(
    session: AsyncSession, document: Document, extraction_id: ExtractionId, table_id: int, is_layout: bool
) -> list[_Draft]:
    """띠 표 칸 블록을 처음 쪼개기 규칙으로 — 레이아웃이면 제목 줄, 아니면 표 단위와 그 표에 묶일 칸 문장(group_draft)."""
    rows = await session.execute(
        select(
            SourceBlock.id, SourceBlock.seq, SourceBlock.kind, SourceBlock.part, SourceBlock.text,
            SourceBlock.heading_level, SourceBlock.flags, SourceBlock.table_id, SourceBlock.row_index,
            SourceBlock.signals,
        )
        .where(
            SourceBlock.extraction_id == extraction_id, SourceBlock.table_id == table_id,
            SourceBlock.kind == "table_cell",
        )
        .order_by(SourceBlock.seq)
    )
    blocks = [BlockView(*row) for row in rows]
    drafts = build_unit_drafts(
        blocks, [TableView(table_id, is_layout, True)], document.language_layout,
        split_lines=document.file_format == LINE_SPLIT_FORMAT,
    )
    texts = {block.id: block.text for block in blocks}
    signals = {block.id: block.signals for block in blocks if block.signals}
    return [
        _Draft(
            kind=draft.kind, spans=list(draft.spans), text=build_unit_text(draft.spans, texts), lang=draft.lang,
            table_id=draft.table_id, row_index=draft.row_index, group_unit_id=None, pos_seq=draft.pos_seq,
            pos_start=draft.pos_start, number=build_number_columns(draft.kind, draft.spans, signals, texts),
            group_draft=draft.group_index,
        )
        for draft in drafts
    ]


async def _measure_caption_distance(session: AsyncSession, extraction_id: ExtractionId, unit: Unit, bundle: Unit) -> int | None:
    """글 단위와 묶음(표는 바깥 표, 그림은 그 블록) 사이의 블록 자리 거리(caption_slot) — 어느 쪽이든 자리가 없으면 None."""
    rows = await session.execute(
        select(SourceBlock.id, SourceBlock.seq, SourceBlock.kind, SourceBlock.text, SourceBlock.table_id).where(
            SourceBlock.extraction_id == extraction_id
        )
    )
    blocks = [PlaceBlock(*row) for row in rows.tuples()]
    parents = dict(
        (await session.execute(
            select(SourceTable.id, SourceTable.parent_table_id).where(SourceTable.extraction_id == extraction_id)
        )).tuples().all()
    )
    places = build_block_places(blocks, parents)
    if bundle.kind in TABLE_UNIT_KINDS:
        bundle_blocks = [block.id for block in blocks if block.table_id == bundle.table_id]
    else:
        bundle_blocks = [block.id for block in blocks if block.seq == bundle.pos_seq]
    return get_place_distance(places, [span[0] for span in unit.spans], bundle_blocks)


async def _plan_attach_caption(session: AsyncSession, extraction_id: ExtractionId, op: AttachCaptionOp) -> _Change:
    """글 단위를 은퇴시키고 같은 범위·언어의 캡션 단위를 그 묶음에 묶어 만든다 — 묶음마다 언어당 캡션 하나.

    글은 묶음에서 블록 자리 CAPTION_REACH 안이어야 하고 사이의 문단은 그대로 남는다(F7 ④). 다른 그림의 캡션을 같이 쓰는 그림은
    제 캡션을 받지 않는다(먼저 푼다).
    """
    units = await load_active_units(session, extraction_id, [op.unit_id, op.bundle_unit_id])
    unit, bundle = units[op.unit_id], units[op.bundle_unit_id]
    if unit.kind not in CAPTIONABLE_KINDS or unit.group_unit_id is not None or unit.lang == REF_LANG:
        raise_rule(422, "invalid_unit_kind", unit_ids=[unit.id])
    if bundle.kind not in BUNDLE_UNIT_KINDS:
        raise_rule(422, "invalid_unit_kind", unit_ids=[bundle.id])
    if bundle.caption_figure_id is not None:
        raise_rule(422, "caption_shared", unit_ids=[bundle.id], figure_id=bundle.caption_figure_id)
    distance = await _measure_caption_distance(session, extraction_id, unit, bundle)
    if distance is None or distance > CAPTION_REACH:
        raise_rule(422, "caption_not_adjacent", unit_ids=[unit.id, op.bundle_unit_id])
    taken = await session.scalar(
        select(Unit.id).where(
            Unit.group_unit_id == bundle.id, Unit.status == UNIT_ACTIVE, Unit.kind == CAPTION_KIND,
            Unit.lang == unit.lang,
        ).limit(1)
    )
    if taken is not None:
        raise_rule(422, "caption_exists", unit_ids=[taken])
    caption = _Draft(
        kind=CAPTION_KIND, spans=to_spans(unit.spans), text=unit.text, lang=unit.lang, table_id=None, row_index=None,
        group_unit_id=bundle.id, pos_seq=unit.pos_seq, pos_start=unit.pos_start,
    )
    change = _build_replacement([unit], [caption])
    change.bundles = [bundle.id]
    return change


async def _plan_detach_caption(session: AsyncSession, extraction_id: ExtractionId, op: DetachCaptionOp) -> _Change:
    """캡션 단위를 은퇴시키고 같은 범위·언어의 묶이지 않은 문장 단위를 만든다.

    0020이 옮긴 옛 그림 캡션은 그림 블록 위에 있다 — 떼면 그림 블록 글이 따로 도는 문장이 되므로 막는다.
    """
    unit = (await load_active_units(session, extraction_id, [op.unit_id]))[op.unit_id]
    if unit.kind != CAPTION_KIND:
        raise_rule(422, "invalid_unit_kind", unit_ids=[unit.id])
    blocks = await _load_unit_blocks(session, extraction_id, [unit])
    if any(blocks[span[0]].kind == "figure" for span in to_spans(unit.spans)):
        raise_rule(422, "caption_in_figure_block", unit_ids=[unit.id])
    change = _build_replacement([unit], [_build_freed_caption(unit, blocks, unit.group_unit_id)])
    change.bundles = [unit.group_unit_id]
    return change


async def _plan_first_row_caption(
    session: AsyncSession, extraction_id: ExtractionId, op: SetFirstRowCaptionOp
) -> _Change:
    """첫 행 ↔ 캡션(F7 ③) — 범위·언어는 그대로이고 종류만 칸 문장 ↔ 캡션으로 바뀐다(단위 은퇴·생성, 되돌리기 한 번).

    첫 행은 묶인 칸 문장 가운데 가장 앞 행이다. 묶음마다 언어당 캡션 하나라 첫 행에 같은 언어 줄이 둘이거나 그 언어 캡션이
    이미 있으면 422 caption_exists(reason first_row), 참조 줄이 있으면 invalid_unit_kind, 첫 행뿐인 표는 표가 비어 empty_table이다.
    """
    table = (await load_active_units(session, extraction_id, [op.table_unit_id]))[op.table_unit_id]
    if table.kind != "table":
        raise_rule(422, "invalid_unit_kind", unit_ids=[table.id])
    members = await _load_grouped_cells(session, [table.id])
    blocks = await _load_unit_blocks(session, extraction_id, members)
    captions = [member for member in members if member.kind == CAPTION_KIND]
    if not op.caption:
        lifted = [caption for caption in captions if blocks[caption.spans[0][0]].kind == "table_cell"]
        change = _build_replacement(lifted, [_build_freed_caption(caption, blocks, table.id) for caption in lifted])
        change.bundles = [table.id] if lifted else []
        return change
    cells = [member for member in members if member.kind == "cell_sentence"]
    first_row = min((cell.row_index for cell in cells), default=None)
    row_cells = [cell for cell in cells if cell.row_index == first_row]
    if len(row_cells) == len(cells):  # 칸 문장이 없거나 첫 행뿐이면 올리고 나서 표가 빈다
        raise_rule(422, "empty_table", unit_id=table.id, reason="first_row")
    refs = [cell.id for cell in row_cells if cell.lang == REF_LANG]
    if refs:
        raise_rule(422, "invalid_unit_kind", unit_ids=refs)
    langs = Counter([*(caption.lang for caption in captions), *(cell.lang for cell in row_cells)])
    clashing = sorted(cell.id for cell in row_cells if langs[cell.lang] > 1)
    if clashing:
        raise_rule(422, "caption_exists", unit_ids=clashing, reason="first_row")
    drafts = [
        _Draft(
            kind=CAPTION_KIND, spans=to_spans(cell.spans), text=cell.text, lang=cell.lang, table_id=None, row_index=None,
            group_unit_id=table.id, pos_seq=cell.pos_seq, pos_start=cell.pos_start,
        )
        for cell in row_cells
    ]
    change = _build_replacement(row_cells, drafts)
    change.bundles = [table.id]
    return change


async def _load_figure_group(session: AsyncSession, extraction_id: ExtractionId, head_ids: Collection[int]) -> list[Unit]:
    """첫 그림들과 그 그림을 가리키는 활성 그림 단위(원문 순) — 캡션 하나를 같이 쓰는 묶음."""
    rows = await session.scalars(
        select(Unit).where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.kind == "figure",
            or_(Unit.id.in_(head_ids), Unit.caption_figure_id.in_(head_ids)),
        )
    )
    return sorted(rows, key=_get_position)


async def _load_bound_captions(session: AsyncSession, bundle_ids: Collection[int]) -> list[Unit]:
    rows = await session.scalars(
        select(Unit).where(
            Unit.group_unit_id.in_(bundle_ids), Unit.status == UNIT_ACTIVE, Unit.kind == CAPTION_KIND
        )
    )
    return sorted(rows, key=_get_position)


async def _plan_group_figures(session: AsyncSession, extraction_id: ExtractionId, op: GroupFiguresOp) -> _Change:
    """그림 묶기(F7 ⑥) — 원문 순 첫 그림을 묶음 머리로 두고 나머지 그림이 그 그림을 가리킨다. 나머지 그림의 캡션은 첫 그림으로 옮긴다.

    묶음마다 언어당 캡션 하나라 옮긴 뒤 같은 언어 캡션이 둘이면 422 caption_exists(reason figures). 그림 블록 위 옛 캡션(0020)은
    옮기면 그 그림 블록 글이 따로 돌므로 422 caption_in_figure_block. 묶음은 범위·단위를 바꾸지 않고 caption_figure_id만 바꾼다.
    """
    ensure_unique_units(op.unit_ids)
    units = await load_active_units(session, extraction_id, op.unit_ids)
    wrong = sorted(unit.id for unit in units.values() if unit.kind != "figure")
    if wrong:
        raise_rule(422, "invalid_unit_kind", unit_ids=wrong)
    members = await _load_figure_group(
        session, extraction_id, {unit.caption_figure_id or unit.id for unit in units.values()}
    )
    head = members[0]
    captions = await _load_bound_captions(session, [member.id for member in members])
    langs = Counter(caption.lang for caption in captions)
    clashing = sorted(caption.id for caption in captions if langs[caption.lang] > 1)
    if clashing:
        raise_rule(422, "caption_exists", unit_ids=clashing, reason="figures")
    moving = [caption for caption in captions if caption.group_unit_id != head.id]
    blocks = await _load_unit_blocks(session, extraction_id, moving)
    fixed = sorted(caption.id for caption in moving if any(blocks[span[0]].kind == "figure" for span in caption.spans))
    if fixed:
        raise_rule(422, "caption_in_figure_block", unit_ids=fixed)
    figures = {
        member.id: (member.caption_figure_id, target)
        for member in members
        if member.caption_figure_id != (target := None if member.id == head.id else head.id)
    }
    return _Change(
        figures=figures, regroup={caption.id: (caption.group_unit_id, head.id) for caption in moving},
        bundles=[member.id for member in members],
    )


async def _plan_ungroup_figures(session: AsyncSession, extraction_id: ExtractionId, op: UngroupFiguresOp) -> _Change:
    """그림 풀기 — 그 그림이 든 묶음의 그림이 모두 따로 선다(첫 그림이 캡션을 그대로 갖는다). 묶이지 않은 그림이면 바뀌는 게 없다."""
    unit = (await load_active_units(session, extraction_id, [op.unit_id]))[op.unit_id]
    if unit.kind != "figure":
        raise_rule(422, "invalid_unit_kind", unit_ids=[unit.id])
    members = await _load_figure_group(session, extraction_id, [unit.caption_figure_id or unit.id])
    figures = {member.id: (member.caption_figure_id, None) for member in members if member.caption_figure_id is not None}
    return _Change(figures=figures, bundles=[member.id for member in members] if figures else [])


async def _plan(session: AsyncSession, document_id: int, extraction_id: ExtractionId, op: EditOp) -> _Change:
    match op:
        case SplitOp():
            return await _plan_split(session, extraction_id, op)
        case MergeOp():
            return await _plan_merge(session, extraction_id, op)
        case UnmergeOp():
            return await _plan_unmerge(session, document_id, extraction_id, op)
        case MoveBoundaryOp():
            return await _plan_move_boundary(session, extraction_id, op)
        case CarveOp():
            return await _plan_carve(session, extraction_id, op)
        case SetLanguageOp():
            return await _plan_set_language(session, extraction_id, op)
        case SetLayoutTableOp():
            return await _plan_set_layout_table(session, document_id, extraction_id, op)
        case AttachCaptionOp():
            return await _plan_attach_caption(session, extraction_id, op)
        case DetachCaptionOp():
            return await _plan_detach_caption(session, extraction_id, op)
        case SetFirstRowCaptionOp():
            return await _plan_first_row_caption(session, extraction_id, op)
        case GroupFiguresOp():
            return await _plan_group_figures(session, extraction_id, op)
        case UngroupFiguresOp():
            return await _plan_ungroup_figures(session, extraction_id, op)
        case SetRefOp():
            return await _plan_set_ref(session, extraction_id, op)
        case ClearRefOp():
            return await _plan_clear_ref(session, extraction_id, op)
        case SetNumberOp():
            return await _plan_set_number(session, extraction_id, op)
        case ClearNoiseOp():
            return await _plan_clear_noise(session, extraction_id, op)
        case SetHeadingOp():
            return await _plan_set_heading(session, document_id, extraction_id, op)
        case _:
            assert_never(op)


# --- 쓰기 ---


async def _find_decided_units(session: AsyncSession, document: Document, unit_ids: Collection[int]) -> list[int]:
    """언어를 바꾸면 사람의 결정과 어긋나는 단위(R31) — 옛 문서는 자기(묶인 칸 문장은 그룹 단위) 판단이 미배정이 아닌 것,
    새 문서는 입구 2 새 문장이 미배정이 아닌 것."""
    if document.side == "new":
        rows = await select_in_chunks(
            session,
            lambda chunk: select(TargetSentence.new_unit_id).where(
                TargetSentence.new_unit_id.in_(chunk), TargetSentence.origin == ORIGIN_NEW_DOC,
                TargetSentence.status != UNASSIGNED,
            ),
            unit_ids,
        )
        return sorted({row[0] for row in rows})
    groups = await select_in_chunks(
        session, lambda chunk: select(Unit.id, Unit.group_unit_id).where(Unit.id.in_(chunk)), unit_ids
    )
    decisions = {
        row[0].unit_id: row[0]
        for row in await select_in_chunks(
            session,
            lambda chunk: select(UnitDecision).where(UnitDecision.unit_id.in_(chunk)),
            {unit_id for row in groups for unit_id in row if unit_id is not None},
        )
    }
    return sorted(
        unit_id for unit_id, group_unit_id in groups
        if any(owner in decisions and not is_unassigned(decisions[owner]) for owner in (unit_id, group_unit_id))
    )


async def _fill_unknown_languages(
    session: AsyncSession, document: Document, extraction_id: ExtractionId, change: _Change
) -> None:
    """글자로 언어를 알 수 없는 새 단위(숫자·기호뿐)는 처음 쪼개기와 같이 앞 단위의 언어를 따른다."""
    if all(draft.lang for draft in change.drafts):
        return
    retiring = set(change.retire)
    rows = await session.execute(
        select(Unit.id, Unit.pos_seq, Unit.pos_start, Unit.lang).where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE
        )
    )
    entries: list[tuple[tuple[int, int, int, int], str, _Draft | None]] = [
        ((pos_seq, pos_start, 0, unit_id), lang, None)
        for unit_id, pos_seq, pos_start, lang in rows
        if unit_id not in retiring
    ]
    entries += [((draft.pos_seq, draft.pos_start, 1, n), draft.lang, draft) for n, draft in enumerate(change.drafts)]
    entries.sort(key=lambda entry: entry[0])
    default = "en" if document.language_layout == "en_only" else "ko"
    for (_, _, draft), lang in zip(entries, fill_languages([entry[1] for entry in entries], default), strict=True):
        if draft is not None:
            draft.lang = lang


async def _set_status(session: AsyncSession, unit_ids: Collection[int], old: str, new: str) -> None:
    """단위 상태를 old → new로 — 그 상태가 아닌 단위가 있으면 편집 기록과 단위가 어긋난 것이라 RuntimeError(버그 가드)."""
    changed = 0
    for chunk in iter_chunks(unit_ids):
        result = await session.execute(
            update(Unit).where(Unit.id.in_(chunk), Unit.status == old).values(status=new)
        )
        changed += result.rowcount
    if changed != len(set(unit_ids)):
        raise RuntimeError(f"unit edit history out of sync: {changed} of {len(set(unit_ids))} units were {old}")


async def _insert_units(
    session: AsyncSession, document: Document, extraction_id: ExtractionId, drafts: list[_Draft]
) -> list[tuple[_Draft, int]]:
    """새 단위를 원문 순서로 local_no 다음 번호부터 만든다 — 옛 문서는 미배정 판단 행도 함께(새 문서는 판단 행이 없다).

    (초안, 만든 단위 id)를 원문 순서로 돌려준다.
    """
    if not drafts:
        return []
    last_no = await session.scalar(select(func.max(Unit.local_no)).where(Unit.extraction_id == extraction_id))
    ordered = sorted(drafts, key=lambda draft: (draft.pos_seq, draft.pos_start))
    units = [
        Unit(
            extraction_id=extraction_id, local_no=last_no + offset, kind=draft.kind,
            spans=[list(span) for span in draft.spans], text=draft.text, lang=draft.lang, table_id=draft.table_id,
            row_index=draft.row_index, group_unit_id=draft.group_unit_id, pos_seq=draft.pos_seq,
            pos_start=draft.pos_start, from_heading=draft.from_heading, **draft.number,
        )
        for offset, draft in enumerate(ordered, start=1)
    ]
    session.add_all(units)
    await session.flush()
    # 같은 변경에서 만든 표 단위에 묶을 새 칸 문장 — 표 단위 id는 INSERT 뒤에야 알므로 한 번 더 쓴다(처음 쪼개기와 같다)
    made = {id(draft): unit for draft, unit in zip(ordered, units, strict=True)}
    grouped = False
    for draft, unit in zip(ordered, units, strict=True):
        if draft.group_draft is not None:
            unit.group_unit_id = made[id(drafts[draft.group_draft])].id
            grouped = True
    if grouped:
        await session.flush()
    if document.side == "old":
        session.add_all(UnitDecision(unit_id=unit.id, bundle_id=document.bundle_id) for unit in units)
    return [(draft, unit.id) for draft, unit in zip(ordered, units, strict=True)]


async def _set_languages(session: AsyncSession, langs: Mapping[int, tuple[str, str]]) -> None:
    by_lang: dict[str, list[int]] = defaultdict(list)
    for unit_id, (_, lang) in langs.items():
        by_lang[lang].append(unit_id)
    for lang, unit_ids in by_lang.items():
        for chunk in iter_chunks(unit_ids):
            await session.execute(update(Unit).where(Unit.id.in_(chunk)).values(lang=lang))


async def _set_numbers(session: AsyncSession, numbers: Mapping[int, tuple[NumberSet, NumberSet]]) -> None:
    for unit_id, (_, number_set) in numbers.items():
        await session.execute(update(Unit).where(Unit.id == unit_id).values(number_set=number_set))


async def _apply_sections(session: AsyncSession, extraction_id: ExtractionId, sections: Sequence[SectionMove]) -> None:
    """절 이름을 옮긴다 — 기록된 범위에서 지금 이름이 기록과 같은 블록만(그 사이 다른 번호 고침이 바꾼 블록은 두고 간다)."""
    for first, last, old, new in sections:
        await session.execute(
            update(SourceBlock)
            .where(
                SourceBlock.extraction_id == extraction_id, SourceBlock.seq >= first, SourceBlock.seq <= last,
                SourceBlock.section_label == old,
            )
            .values(section_label=new)
        )
async def _set_noises(session: AsyncSession, noises: Mapping[int, tuple[str | None, str | None]]) -> None:
    """잡음 표시를 바꾼다 — 지금 표시가 기록과 다른 단위가 있으면 편집 기록과 어긋난 것이라 RuntimeError(버그 가드)."""
    by_move: dict[tuple[str | None, str | None], list[int]] = defaultdict(list)
    for unit_id, move in noises.items():
        by_move[move].append(unit_id)
    changed = 0
    for (old, new), unit_ids in by_move.items():
        current = Unit.noise_kind.is_(None) if old is None else Unit.noise_kind == old
        for chunk in iter_chunks(unit_ids):
            result = await session.execute(update(Unit).where(Unit.id.in_(chunk), current).values(noise_kind=new))
            changed += result.rowcount
    if changed != len(noises):
        raise RuntimeError(f"unit edit history out of sync: {changed} of {len(noises)} units had the recorded noise mark")


async def _set_figures(session: AsyncSession, figures: Mapping[int, tuple[int | None, int | None]]) -> None:
    """그림 묶음(caption_figure_id)을 바꾼다 — 지금 값이 기록과 다른 그림이 있으면 편집 기록과 어긋난 것이라 RuntimeError(버그 가드)."""
    changed = 0
    for unit_id, (old, new) in figures.items():
        current = Unit.caption_figure_id.is_(None) if old is None else Unit.caption_figure_id == old
        result = await session.execute(update(Unit).where(Unit.id == unit_id, current).values(caption_figure_id=new))
        changed += result.rowcount
    if changed != len(figures):
        raise RuntimeError(f"unit edit history out of sync: {changed} of {len(figures)} figures had the recorded group")


async def _leave_pairs(session: AsyncSession, unit_ids: Collection[int]) -> None:
    """은퇴하거나 언어가 바뀐 단위는 한/영 짝에서 빠지고, 남은 짝에 한쪽 언어가 없으면 짝을 지운다.

    되돌리기는 빠진 짝을 되살리지 않는다 — 짝은 단위 집합 기록(unit_edits) 밖의 제안·확인이다.
    """
    pair_ids = {
        row[0]
        for row in await select_in_chunks(
            session, lambda chunk: select(UnitPairMember.pair_id).where(UnitPairMember.unit_id.in_(chunk)), unit_ids
        )
    }
    if not pair_ids:
        return
    for chunk in iter_chunks(unit_ids):
        await session.execute(delete(UnitPairMember).where(UnitPairMember.unit_id.in_(chunk)))
    langs: dict[int, set[str]] = defaultdict(set)
    for pair_id, lang in await select_in_chunks(
        session,
        lambda chunk: select(UnitPairMember.pair_id, Unit.lang)
        .join(Unit, Unit.id == UnitPairMember.unit_id)
        .where(UnitPairMember.pair_id.in_(chunk)),
        pair_ids,
    ):
        langs[pair_id].add(lang)
    for chunk in iter_chunks([pair_id for pair_id in pair_ids if not PAIR_LANGS <= langs[pair_id]]):
        await session.execute(delete(UnitPair).where(UnitPair.id.in_(chunk)))


async def _apply_regroup(session: AsyncSession, regroup: Mapping[int, Move]) -> None:
    """칸 문장 묶음을 옮긴다 — 지금 묶음이 기록과 다른 칸이 있으면 편집 기록과 어긋난 것이라 RuntimeError(버그 가드)."""
    by_move: dict[Move, list[int]] = defaultdict(list)
    for cell_id, move in regroup.items():
        by_move[move].append(cell_id)
    changed = 0
    for (old, new), cell_ids in by_move.items():
        current = Unit.group_unit_id.is_(None) if old is None else Unit.group_unit_id == old
        for chunk in iter_chunks(cell_ids):
            result = await session.execute(update(Unit).where(Unit.id.in_(chunk), current).values(group_unit_id=new))
            changed += result.rowcount
    if changed != len(regroup):
        raise RuntimeError(f"unit edit history out of sync: {changed} of {len(regroup)} cells had the recorded group")


async def _apply_layouts(session: AsyncSession, layouts: Mapping[int, tuple[bool, bool]]) -> None:
    """레이아웃 표 표시를 바꾼다 — 지금 표시가 기록과 다르면 RuntimeError(버그 가드)."""
    for table_id, (old, new) in layouts.items():
        result = await session.execute(
            update(SourceTable).where(SourceTable.id == table_id, SourceTable.is_layout == old).values(is_layout=new)
        )
        if result.rowcount != 1:
            raise RuntimeError(f"unit edit history out of sync: table {table_id} was not is_layout={old}")


async def _find_new_doc_targets(session: AsyncSession, unit_ids: Collection[int]) -> list[int]:
    rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSentence.id).where(
            TargetSentence.new_unit_id.in_(chunk), TargetSentence.origin == ORIGIN_NEW_DOC
        ),
        unit_ids,
    )
    return sorted(row[0] for row in rows)


def _merge_reports(first: DetachReport, second: DetachReport) -> DetachReport:
    """떼어 내기 결과 둘을 하나로(새 문서 R32 떼어 내기와 다시 맞추기, 옛 문서 은퇴와 캡션 묶음) — 나중에 지운 새 문장은 보류 목록에서 뺀다."""
    deleted = {*first.deleted_target_ids, *second.deleted_target_ids}
    return DetachReport(
        reset_unit_ids=sorted({*first.reset_unit_ids, *second.reset_unit_ids}),
        deleted_target_ids=sorted(deleted),
        held_unit_ids=sorted({*first.held_unit_ids, *second.held_unit_ids}),
        held_target_ids=sorted({*first.held_target_ids, *second.held_target_ids} - deleted),
    )


async def _write_change(
    session: AsyncSession,
    document: Document,
    extraction_id: ExtractionId,
    change: _Change,
    *,
    confirm: bool,
    actor: str,
) -> EditResult:
    """검사(판단 있는 단위의 언어·확인 플래그) → 단위 은퇴·되살리기·만들기·언어 → 짝 정리 → 떼어 내기(옛)·새 문장 맞추기(새)
    와 칸 묶음·레이아웃 표 바꾸기 → 짝 다시 제안(표 표시가 바뀌면) → 커버리지 가드 → 문서 revision +1.
    편집·되돌리기·다시 하기가 함께 쓴다.

    다시 묶이는 칸 문장도 확인 대상이다 — 옛 문서는 레이아웃 칸이 가진 자기 판단이 표에 묶이며 떼어지고, 새 문서는 미배정이
    아닌 칸·표 새 문장이 새 부모 아래로 옮겨지지 않게 먼저 미배정으로 돌린다(R32).
    """
    # 언어를 제자리에서 바꾸는 단위만 사람 결정과 어긋난다(R31) - 같은 변경에서 은퇴하거나 되살아나는 단위(합치기 풀기와
    # 그 되돌리기)는 글 그대로의 언어를 따라가는 것이라 묻지 않는다(은퇴는 아래 확인 플래그가 묻는다)
    moving = {*change.retire, *change.revive}
    # 잡음 표시를 다시 붙이는 단위(목차 아님 되돌리기)도 사람 결정과 어긋난다 — 그 사이 배정했으면 표시로 덮지 않는다
    marking = [unit_id for unit_id, (_, noise) in change.noises.items() if noise is not None]
    in_place = [unit_id for unit_id in [*change.langs, *marking] if unit_id not in moving]
    if in_place:
        decided = await _find_decided_units(session, document, in_place)
        if decided:
            raise_rule(409, "unit_has_decision", unit_ids=decided)
    regrouped = change.list_regrouped_cells()
    decided_bundles: list[int] = []
    if change.retire or regrouped or change.bundles:
        needing = await find_units_needing_confirm(session, [*change.retire, *regrouped, *change.bundles])
        if needing and not confirm:
            raise_rule(409, "confirm_required", unit_ids=needing)
        # 캡션이 바뀐 묶음은 판단이 있을 때만 떼어 낸다 — 확정 새 문장에 바뀐 캡션이 빠지거나 남지 않게
        decided_bundles = sorted(set(needing) & set(change.bundles))
    await _fill_unknown_languages(session, document, extraction_id, change)
    await _set_status(session, change.retire, UNIT_ACTIVE, UNIT_RETIRED)
    await _set_status(session, change.revive, UNIT_RETIRED, UNIT_ACTIVE)
    inserted = await _insert_units(session, document, extraction_id, change.drafts)
    for draft, unit_id in inserted:
        change.regroup.update({cell_id: (group_id, unit_id) for cell_id, group_id in draft.cells.items()})
    await _set_languages(session, change.langs)
    await _set_numbers(session, change.numbers)
    await _apply_sections(session, extraction_id, change.sections)
    await _set_noises(session, change.noises)
    await _set_figures(session, change.figures)
    # 다시 목차가 된 단위는 짝을 맺지 않는다(units._find_code_pairs와 같은 규칙)
    await _leave_pairs(session, [*change.retire, *change.langs, *marking])
    await session.flush()
    activated = [*change.revive, *(unit_id for _, unit_id in inserted)]
    detach = None
    if document.side == "new":
        reset = None
        if change.regroup or decided_bundles:
            reset = await detach_targets(
                session, bundle_id=document.bundle_id,
                target_ids=await _find_new_doc_targets(session, [*change.retire, *change.regroup, *decided_bundles]),
            )
        await _apply_regroup(session, change.regroup)
        await _apply_layouts(session, change.layouts)
        detach = await sync_new_doc_targets(
            session, document, created_unit_ids=activated, retired_unit_ids=change.retire, actor=actor
        )
        if reset is not None:
            detach = _merge_reports(reset, detach)
    else:
        if change.retire or change.regroup:
            # 묶음을 옮기기 전에 떼어 낸다 — 은퇴하는 표의 칸 새 문장 연결이 표 판단 이력에 함께 남게
            detach = await detach_units(
                session, bundle_id=document.bundle_id, unit_ids=[*change.retire, *change.regroup],
                cause="retired" if change.retire else "regrouped", actor=actor,
            )
        if decided_bundles:
            regrouped_report = await detach_units(
                session, bundle_id=document.bundle_id, unit_ids=decided_bundles, cause="regrouped", actor=actor
            )
            detach = regrouped_report if detach is None else _merge_reports(detach, regrouped_report)
        await _apply_regroup(session, change.regroup)
        await _apply_layouts(session, change.layouts)
    if change.layouts:
        # 레이아웃 표의 칸 문장은 묶이지 않아 한/영 두 열이 이웃 짝으로 제안되고(따로 배치면 둘 다 벗긴 대응 표의 같은 행끼리, F8a),
        # 다시 데이터 표가 되면 그 제안이 빠진다
        await session.flush()
        await refresh_code_pairs(session, document, actor)
    if change.repair_pairs:
        # 제목 ↔ 문장은 짝의 단위를 바꾼다 — 새로 활성이 된 단위만 다시 짝짓는다(F8b, 조항마다 문장 1:1)
        await session.flush()
        await pair_new_units(session, document, activated, actor)
    await session.flush()
    await verify_document_coverage(session, document.id)
    document.revision += 1
    return EditResult(
        document_revision=document.revision, created_unit_ids=activated, retired_unit_ids=sorted(change.retire),
        detach=detach,
    )


def _record(
    session: AsyncSession, document: Document, action: str, op: str, result: EditResult, change: _Change, actor: str
) -> None:
    """작업 기록 — 대상은 은퇴한·활성이 된·언어가 바뀐·다시 묶인 단위, 사유 칸에 편집 종류(split 등)."""
    unit_ids = sorted(
        {*result.created_unit_ids, *result.retired_unit_ids, *change.langs, *change.regroup, *change.bundles,
         *change.noises, *change.numbers, *change.figures}
    )
    record_event(
        session, bundle_id=document.bundle_id, actor=actor, action=action, target_type="unit", target_ids=unit_ids,
        reason=op,
    )


async def _start_new_edit(session: AsyncSession, document: Document) -> int:
    """새 기록을 붙일 준비 - 다시 하기 기록(undone)을 지우고 다음 순번을 돌려준다."""
    await session.execute(
        delete(UnitEdit).where(UnitEdit.document_id == document.id, UnitEdit.state == EDIT_UNDONE)
    )
    last_seq = await session.scalar(select(func.max(UnitEdit.seq)).where(UnitEdit.document_id == document.id))
    return (last_seq or 0) + 1


async def apply_edit(
    session: AsyncSession, document: Document, op: EditOp, *, confirm: bool, actor: str
) -> EditResult:
    """편집 하나를 적용하고 기록한다 — 새 편집은 다시 하기 기록(undone)을 지운다.

    바뀌는 게 없는 편집(같은 언어로 바꾸기, 범위가 그대로인 경계 옮기기·골라 만들기)은 아무것도 쓰지 않는다 — 확인도
    묻지 않고 revision·기록·다시 하기 기록도 그대로다.
    """
    extraction_id = await get_latest_extraction_id(session, document.id)
    change = await _plan(session, document.id, extraction_id, op)
    if isinstance(op, SetRefOp | ClearRefOp):
        await _save_ref_mark(session, op, actor)
    if change.is_unchanged():
        if isinstance(op, SetRefOp | ClearRefOp):
            # 언어는 그대로여도(제안을 물리거나 번호만 고침) 사람이 한 일이라 작업 기록에는 남긴다
            record_event(
                session, bundle_id=document.bundle_id, actor=actor, action="unit.edit", target_type="unit",
                target_ids=[op.unit_id], reason=op.type,
            )
        return EditResult(document_revision=document.revision, created_unit_ids=[], retired_unit_ids=[], detach=None)
    result = await _write_change(session, document, extraction_id, change, confirm=confirm, actor=actor)
    session.add(
        UnitEdit(
            document_id=document.id, seq=await _start_new_edit(session, document), op=op.type, payload=op.model_dump(),
            created_unit_ids=result.created_unit_ids, retired_unit_ids=result.retired_unit_ids,
            regrouped={str(cell_id): list(move) for cell_id, move in change.regroup.items()},
            lang_changes={str(unit_id): list(langs) for unit_id, langs in change.langs.items()},
            layout_changes={str(table_id): list(flags) for table_id, flags in change.layouts.items()},
            noise_changes={str(unit_id): list(noises) for unit_id, noises in change.noises.items()},
            figure_changes={str(unit_id): list(figures) for unit_id, figures in change.figures.items()},
            number_changes=_dump_numbers(change), actor=actor,
        )
    )
    _record(session, document, "unit.edit", op.type, result, change, actor)
    await session.flush()
    return result


async def _find_caption_bundles(session: AsyncSession, unit_ids: Collection[int]) -> list[int]:
    """캡션 단위들이 묶인 묶음 — 은퇴한 캡션도 묶음을 그대로 갖고 있어 되돌리기·다시 하기가 붙이기·떼기의 묶음을 찾는다."""
    rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit.group_unit_id).where(Unit.id.in_(chunk), Unit.kind == CAPTION_KIND),
        unit_ids,
    )
    return sorted({row[0] for row in rows if row[0] is not None})


def _dump_numbers(change: _Change) -> dict[str, object] | None:
    if not change.numbers:
        return None
    return {
        "units": {str(unit_id): list(values) for unit_id, values in change.numbers.items()},
        "sections": [list(move) for move in change.sections],
    }


def _orient(before_after: Sequence[T], *, backwards: bool) -> tuple[T, T]:
    """기록된 (전, 후) 값 — 되돌리기면 (후, 전)."""
    before, after = before_after
    return (after, before) if backwards else (before, after)


def _replay(edit: UnitEdit, *, backwards: bool) -> _Change:
    """기록된 편집을 되돌리기(backwards) 또는 다시 하기로 — 같은 단위 ID·같은 칸 묶음·같은 표 표시로 뒤집거나 되풀이한다."""
    created, retired = list(edit.created_unit_ids), list(edit.retired_unit_ids)
    numbers = edit.number_changes or {}
    return _Change(
        retire=created if backwards else retired,
        revive=retired if backwards else created,
        langs={int(unit_id): _orient(langs, backwards=backwards) for unit_id, langs in edit.lang_changes.items()},
        regroup={int(cell_id): _orient(move, backwards=backwards) for cell_id, move in edit.regrouped.items()},
        layouts={
            int(table_id): _orient(flags, backwards=backwards) for table_id, flags in edit.layout_changes.items()
        },
        numbers={int(unit_id): _orient(values, backwards=backwards) for unit_id, values in numbers.get("units", {}).items()},
        sections=[(first, last, *_orient((old, new), backwards=backwards)) for first, last, old, new in numbers.get("sections", [])],
        # 0027 전 기록은 빈 객체다(잡음 표시를 바꾼 편집이 없었다)
        noises={int(unit_id): _orient(noises, backwards=backwards) for unit_id, noises in (edit.noise_changes or {}).items()},
        # 0030 전 기록은 빈 객체다(그림 묶음을 바꾼 편집이 없었다)
        figures={
            int(unit_id): _orient(figures, backwards=backwards) for unit_id, figures in (edit.figure_changes or {}).items()
        },
        repair_pairs=edit.op == "set_heading",
    )


async def _step_edit(
    session: AsyncSession, document: Document, edit: UnitEdit, *, backwards: bool, confirm: bool, actor: str
) -> EditStepResult:
    """기록 하나를 거꾸로(되돌리기) 또는 다시 적용하고 작업 기록을 남긴다."""
    action = "unit.undo" if backwards else "unit.redo"
    if edit.op in BOUNDARY_OPS:
        confirmed = edit.payload["confirmed"] != backwards
        units = await load_active_units(session, await get_latest_extraction_id(session, document.id), edit.payload["unit_ids"])
        for unit in units.values():
            unit.boundary_confirmed = confirmed
        unit_ids = sorted(units)
        record_event(
            session, bundle_id=document.bundle_id, actor=actor, action=action, target_type="unit", target_ids=unit_ids,
            reason=edit.op,
        )
        return EditStepResult(
            document_revision=document.revision, created_unit_ids=[], retired_unit_ids=[], detach=None, op=edit.op,
            boundary_unit_ids=unit_ids, confirmed=confirmed,
        )
    change = _replay(edit, backwards=backwards)
    if edit.op in CAPTION_OPS:
        change.bundles = await _find_caption_bundles(session, [*change.retire, *change.revive])
    elif edit.op in FIGURE_OPS:
        # 묶음 머리와 든 그림 모두 — 기록의 전·후 값이 머리를 가리킨다
        change.bundles = sorted({*change.figures, *(head for move in change.figures.values() for head in move if head is not None)})
    result = await _write_change(
        session, document, await get_latest_extraction_id(session, document.id), change, confirm=confirm, actor=actor
    )
    _record(session, document, action, edit.op, result, change, actor)
    return EditStepResult(**result.model_dump(), op=edit.op, boundary_unit_ids=[], confirmed=None)


async def undo_edit(session: AsyncSession, document: Document, *, confirm: bool, actor: str) -> EditStepResult:
    """마지막 적용 편집을 거꾸로 — 만든 단위를 은퇴시키고 은퇴시킨 단위를 원래 ID로 되살린다(되살린 단위의 판단은 미배정).
    칸 묶음과 레이아웃 표 표시도 편집 전으로 돌린다."""
    edit = await session.scalar(
        select(UnitEdit)
        .where(UnitEdit.document_id == document.id, UnitEdit.state == EDIT_APPLIED)
        .order_by(UnitEdit.seq.desc())
        .limit(1)
    )
    if edit is None:
        raise_rule(409, "nothing_to_undo")
    # 되돌리는 기록을 먼저 내린다 — 실패하면 요청이 커밋하지 않아 상태도 그대로다
    edit.state = EDIT_UNDONE
    await session.flush()
    return await _step_edit(session, document, edit, backwards=True, confirm=confirm, actor=actor)


async def redo_edit(session: AsyncSession, document: Document, *, confirm: bool, actor: str) -> EditStepResult:
    """가장 최근에 되돌린 편집을 같은 단위 ID로 다시 적용한다."""
    edit = await session.scalar(
        select(UnitEdit)
        .where(UnitEdit.document_id == document.id, UnitEdit.state == EDIT_UNDONE)
        .order_by(UnitEdit.seq)
        .limit(1)
    )
    if edit is None:
        raise_rule(409, "nothing_to_redo")
    result = await _step_edit(session, document, edit, backwards=False, confirm=confirm, actor=actor)
    edit.state = EDIT_APPLIED
    await session.flush()
    return result
