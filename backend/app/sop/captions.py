"""캡션 단위·캡션 새 문장의 판정 — 캡션은 표·그림 묶음에 딸린 글 단위이고, 그 새 문장은 칸 좌표 없는 묶음의 자식 문장이다."""

from typing import Protocol

CAPTION_KIND = "caption"  # 묶음(표·행·그림 단위)에 딸린 캡션 단위의 kind


class _TargetShape(Protocol):
    """ORM TargetSentence 행과 snapshot.TargetInfo가 함께 갖는 칸."""

    @property
    def kind(self) -> str: ...
    @property
    def parent_target_id(self) -> int | None: ...
    @property
    def cell_row(self) -> int | None: ...
    @property
    def cell_col(self) -> int | None: ...


def is_caption_target(target: _TargetShape) -> bool:
    """부모(표·그림 새 문장)가 있고 칸 좌표가 없는 문장 새 문장이면 캡션 새 문장이다."""
    return (
        target.kind == "sentence"
        and target.parent_target_id is not None
        and target.cell_row is None
        and target.cell_col is None
    )
