"""캡션 단위·캡션 새 문장의 판정 — 캡션은 표·그림 묶음에 딸린 글 단위이고, 그 새 문장은 칸 좌표 없는 묶음의 자식 문장이다."""

from collections.abc import Iterable
from typing import Protocol

CAPTION_KIND = "caption"  # 묶음(표·행·그림 단위)에 딸린 캡션 단위의 kind
_CAPTION_LANG_RANKS = {"ko": 0, "en": 1}  # 여러 언어 캡션은 한국어 → 영어 → 그 밖 순으로 잇는다


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


def get_caption_lang_rank(lang: str) -> int:
    """여러 언어 캡션의 차례 — 한국어 0, 영어 1, 그 밖 2."""
    return _CAPTION_LANG_RANKS.get(lang, 2)


def join_caption_texts(captions: Iterable[tuple[str, str]]) -> str | None:
    """(언어, 글) 캡션들을 결과물 한 글로 — 한국어·영어 순 줄바꿈 이음(같은 언어는 받은 순), 빈 글은 빼고 하나도 없으면 None."""
    texts = [text for lang, text in sorted(captions, key=lambda caption: get_caption_lang_rank(caption[0])) if text]
    return "\n".join(texts) or None
