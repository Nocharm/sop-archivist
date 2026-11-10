"""부분 묶음 — 머리말·꼬리말 블록을 DOCX 부분(header1.xml …)마다 묶고, 어느 구역이 쓰는지와 내용이 같은 묶음을 알린다.

쪼개기 화면의 Body/Header/Footer 탭이 읽는다. 블록·단위는 그대로 두고 보기만 묶는다(순수 함수).
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from app.sop.extract.docx_reader import FLAG_SECTION_REF_PREFIX

# 부분 파일마다 묶는 부분 — 나머지(본문·각주·미주·글상자…)는 부분 이름 하나가 묶음이다
_FILE_PARTS = ("header", "footer")


class PartBlock(Protocol):
    part: str
    kind: str
    text: str
    xml_path: str
    flags: Sequence[str]


@dataclass
class PartGroup:
    """key는 블록의 part_group과 같은 값. refs는 (구역 번호 1부터, default·first·even), same_as는 내용이 같은 앞 묶음의 key."""

    key: str
    part: str
    refs: list[tuple[int, str]]
    block_count: int = 0
    same_as: str | None = None
    _content: list[tuple[str, str]] = field(default_factory=list, repr=False)


def get_part_group_key(part: str, xml_path: str) -> str:
    """블록이 속한 묶음 — 머리말·꼬리말은 부분 파일 이름("header2"), 옛 추출·PDF처럼 경로가 없으면 부분 이름."""
    if part in _FILE_PARTS:
        return xml_path.split("/", 1)[0] or part
    return part


def build_part_groups(blocks: Sequence[PartBlock]) -> list[PartGroup]:
    """블록(seq 순) → 묶음(처음 나온 순). 같은 부분에서 블록 종류·글이 모두 같은 묶음은 뒤쪽에 same_as를 단다.

    Word는 "이전 구역과 연결"을 끊으면 같은 머리말을 구역마다 따로 저장한다 — 화면이 같은 내용을 한 번만 보여 줄 수 있게 알린다.
    """
    groups: dict[str, PartGroup] = {}
    for block in blocks:
        key = get_part_group_key(block.part, block.xml_path)
        group = groups.get(key)
        if group is None:
            group = groups[key] = PartGroup(key=key, part=block.part, refs=_read_section_refs(block.flags))
        group.block_count += 1
        group._content.append((block.kind, block.text))
    first_by_content: dict[tuple[str, tuple[tuple[str, str], ...]], str] = {}
    for group in groups.values():
        if group.part in _FILE_PARTS:
            first = first_by_content.setdefault((group.part, tuple(group._content)), group.key)
            group.same_as = None if first == group.key else first
    return list(groups.values())


def _read_section_refs(flags: Sequence[str]) -> list[tuple[int, str]]:
    """추출기가 블록 표시에 남긴 "section_ref:<구역>:<종류>" — 이 표시가 없는 옛 추출은 빈 목록."""
    refs = []
    for flag in flags:
        if flag.startswith(FLAG_SECTION_REF_PREFIX):
            section, _, ref_type = flag[len(FLAG_SECTION_REF_PREFIX):].partition(":")
            refs.append((int(section), ref_type))
    return refs
