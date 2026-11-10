"""부분 묶음 — 머리말·꼬리말을 부분 파일마다 묶고 구역 참조·같은 내용을 알린다."""

from dataclasses import dataclass

from app.sop.part_groups import build_part_groups, get_part_group_key


@dataclass(frozen=True)
class _Block:
    part: str
    xml_path: str
    text: str
    flags: tuple[str, ...] = ()
    kind: str = "paragraph"


def test_group_key_is_the_part_file_for_headers_and_footers() -> None:
    assert get_part_group_key("header", "header2/p[1]") == "header2"
    assert get_part_group_key("footer", "footer1/tbl[1]/tr[1]/tc[1]") == "footer1"
    assert get_part_group_key("body", "body/p[3]") == "body"
    assert get_part_group_key("footnote", "footnotes/footnote[2]/p[1]") == "footnote"
    # 경로가 없는 블록(PDF)은 부분 이름으로 묶는다
    assert get_part_group_key("header", "") == "header"


def test_groups_follow_first_appearance_and_carry_section_refs() -> None:
    blocks = [
        _Block("body", "body/p[1]", "본문"),
        _Block("header", "header1/p[1]", "합성 제약", ("section_ref:1:default", "section_ref:2:default")),
        _Block("header", "header1/p[2]", "SOP-QC-001", ("section_ref:1:default", "section_ref:2:default")),
        _Block("header", "header2/p[1]", "표지", ("section_ref:1:first", "auto_numbering")),
        _Block("footer", "footer1/p[1]", "대외비", ("section_ref:1:default",)),
        _Block("body", "body/p[2]", "본문 둘"),
    ]

    groups = build_part_groups(blocks)

    assert [(g.key, g.part, g.refs, g.block_count, g.same_as) for g in groups] == [
        ("body", "body", [], 2, None),
        ("header1", "header", [(1, "default"), (2, "default")], 2, None),
        ("header2", "header", [(1, "first")], 1, None),
        ("footer1", "footer", [(1, "default")], 1, None),
    ]


def test_identical_parts_point_at_the_first_one() -> None:
    # 구역마다 따로 저장된 같은 머리말 — 뒤쪽 묶음이 앞 묶음을 가리킨다. 머리말과 꼬리말은 내용이 같아도 서로 가리키지 않는다
    blocks = [
        _Block("header", "header1/p[1]", "합성 제약"),
        _Block("header", "header2/p[1]", "합성 제약"),
        _Block("header", "header3/p[1]", "합성 제약 "),
        _Block("header", "header4/p[1]", "합성 제약"),
        _Block("footer", "footer1/p[1]", "합성 제약"),
        _Block("body", "body/p[1]", "합성 제약"),
    ]

    assert [(g.key, g.same_as) for g in build_part_groups(blocks)] == [
        ("header1", None), ("header2", "header1"), ("header3", None), ("header4", "header1"), ("footer1", None),
        ("body", None),
    ]
