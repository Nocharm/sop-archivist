"""Reference 절의 참조 줄 확정(요청서 12 · 14, 사용자 결정 2026-11-19) — 새 추출은 Reference 절 아래 줄을 쪼갤 때 REF로 확정하고
문서 다른 곳의 줄은 제안하지 않는다. 번호 없는 줄은 한/영 짝이 없을 때만 REF다. 옛 추출의 제안 길은 test_sop_refs.py가 본다."""

import pytest
from fastapi.testclient import TestClient

from app.sop.refs import (
    SectionLine,
    find_ref_section_lines,
    is_proposing_version,
    is_ref_section_heading,
    list_ref_section_blocks,
)
from app.sop.segment import BlockView, build_unit_drafts, build_unit_text
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

REF_LINE = "SOP-ABC-1016 Operation of UV spectrophotometer"
OUTSIDE_LINE = "SOP-QA-204 Synthetic cleaning record"
LATER_LINE = "WI-04 Synthetic history note"
STANDARD = "ISO 9001:2015"
PROSE_KO, PROSE_EN = "제조사 사용 설명서를 참고한다.", "Refer to the manufacturer's operating manual."
BODY = (
    p("1. 목적", "Heading1") + p("1. Purpose", "Heading1")
    + p("이 절차는 합성 장비의 사용을 다룬다.") + p("This procedure covers the synthetic equipment.")
    + p(OUTSIDE_LINE)
    + p("7. 참고 문서 (References)", "Heading1")
    + p(REF_LINE) + p(STANDARD) + p(PROSE_KO) + p(PROSE_EN)
    + p("8. 개정 이력", "Heading1") + p(LATER_LINE)
)


# --- 절 제목 · 줄 고르기(순수 함수) ---


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("7. References", True),
        ("Reference", True),
        ("7.1 Related Documents:", True),
        ("Associated documents", True),
        ("6. Work Instructions", True),
        ("참고 문헌", True),
        ("7. 참고 문서 (References)", True),
        ("관련문서", True),
        ("VII. References", True),
        ("4. Forms", True),
        ("Form(s)", True),
        ("Related Forms", True),
        ("서식", True),
        ("관련 양식", True),
        ("4. References and Forms", True),
        ("Reference & Forms", True),
        ("참고 문서 및 서식", True),
        ("References, Forms", True),
        ("Forms and equipment", False),  # 나뉜 조각이 모두 이름이어야 한다
        ("Formulation", False),
        ("Form of the tablet", False),
        ("Reference standards and equipment", False),
        ("1. Purpose", False),
        ("참고 사항", False),
        ("7. References (" + "x" * 300 + ")", False),  # 긴 글은 절 제목이 아니다(MAX_SECTION_HEADING_CHARS)
    ],
)
def test_is_ref_section_heading(text: str, expected: bool) -> None:
    assert is_ref_section_heading(text) is expected


def _line(kind: str, text: str, lang: str = "en", level: int | None = None, *, body: bool = True, noise: bool = False) -> SectionLine:
    return SectionLine(kind, text, lang, level, body, noise)


def test_section_runs_to_the_next_heading_of_the_same_level() -> None:
    lines = [
        _line("sentence", OUTSIDE_LINE),  # 0 절 밖 — 번호로 시작해도 확정하지 않는다
        _line("heading", "7. References", level=1),  # 1
        _line("sentence", REF_LINE),  # 2
        _line("heading", "7.1 Internal", level=2),  # 3 더 깊은 제목은 절을 끝내지 않는다
        _line("cell_sentence", "SOP-QA-204 Synthetic"),  # 4
        _line("sentence", STANDARD, "neutral", noise=True),  # 5 목차 줄은 보지 않는다
        _line("sentence", "WI-04 Footer line", body=False),  # 6 머리말 · 꼬리말은 보지 않는다
        _line("heading", "8. History", level=1),  # 7
        _line("sentence", LATER_LINE),  # 8
    ]

    assert find_ref_section_lines(lines, interleaved=False, separate=False) == [2, 4]


def test_bold_non_heading_forms_line_opens_no_section() -> None:
    lines = [_line("sentence", "Forms"), _line("sentence", REF_LINE)]  # 굵은 글자만인 줄은 제목 종류가 아니다
    assert find_ref_section_lines(lines, interleaved=False, separate=False) == []


def test_prose_with_a_korean_english_partner_stays_a_sentence() -> None:
    interleaved = [
        _line("heading", "References", level=1),
        _line("sentence", STANDARD),  # 1 짝 없음 → REF
        _line("sentence", PROSE_KO, "ko"),  # 2
        _line("sentence", PROSE_EN),  # 3 바로 다음 줄이 다른 언어 → 짝
        _line("sentence", "Keep the manual near the equipment."),  # 4 짝 없음 → REF
    ]
    assert find_ref_section_lines(interleaved, interleaved=True, separate=False) == [1, 4]

    separate = [
        _line("heading", "참고 문서", "ko", level=1),
        _line("sentence", PROSE_KO, "ko"),  # 1 영어 절의 첫 영어 줄과 짝
        _line("heading", "References", level=1),
        _line("sentence", STANDARD),  # 3 첫 영어 줄 — 한글 1과 짝으로 친다(차례 맞추기)
        _line("sentence", PROSE_EN),  # 4 남은 영어 줄 → REF
    ]
    assert find_ref_section_lines(separate, interleaved=False, separate=True) == [4]

    # 한 언어 문서는 짝이 없어 번호 없는 줄도 모두 REF
    assert find_ref_section_lines(interleaved, interleaved=False, separate=False) == [1, 2, 3, 4]


def test_only_older_extractions_propose() -> None:
    assert is_proposing_version("5") and is_proposing_version("1") and is_proposing_version("")
    assert not is_proposing_version("6")


# --- 올리기 ---


def _upload(client: TestClient) -> tuple[int, int, dict]:
    bundle = create_bundle(client, is_synthetic=True)
    response = upload(client, bundle["id"], build_docx(BODY), "SYNTHETIC_OLD-1_Reference_section.docx")
    assert response.status_code == 201, response.text
    assert response.json()["language_layout"] == "ko_en_interleaved"
    return bundle["id"], response.json()["id"], get_view(client, bundle["id"], response.json()["id"])


def test_upload_confirms_reference_section_lines_and_proposes_nothing_else(client: TestClient) -> None:
    _, _, view = _upload(client)

    ref_line, standard = find_unit(view, REF_LINE), find_unit(view, STANDARD)
    assert (ref_line["lang"], ref_line["ref"]) == ("ref", {"state": "confirmed", "number": "SOP-ABC-1016"})
    # EQUIS에 없는 참고 문서도 참조 줄 — 번호 칸은 빈다
    assert (standard["lang"], standard["ref"]) == ("ref", {"state": "confirmed", "number": ""})
    # 한/영 짝이 있는 문장, 절 밖 · 다음 절의 번호 줄은 그대로(제안도 없음)
    for text, lang in ((PROSE_KO, "ko"), (PROSE_EN, "en"), (OUTSIDE_LINE, "en"), (LATER_LINE, "en")):
        unit = find_unit(view, text)
        assert (unit["lang"], unit["ref"]) == (lang, None), text


def test_not_a_reference_restores_the_detected_language(client: TestClient) -> None:
    bundle_id, doc_id, view = _upload(client)
    op = {"type": "clear_ref", "unit_id": find_unit(view, REF_LINE)["id"]}

    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits",
        json={"revision": view["document"]["revision"], "confirm": False, "op": op}, headers=AUTHOR,
    )

    assert response.status_code == 200, response.text
    unit = find_unit(get_view(client, bundle_id, doc_id), REF_LINE)
    assert (unit["lang"], unit["ref"]) == ("en", None)


# --- 규칙 2가 참조 줄을 찾는 길(설계 2026-11-25 R2-6) ---


def _block(block_id: int, text: str, level: int | None = None, **fields: object) -> BlockView:
    values = {
        "id": block_id, "seq": block_id, "kind": "paragraph", "part": "body", "text": text, "heading_level": level,
        "flags": (), "table_id": None, "row_index": None, **fields,
    }
    return BlockView(**values)


def _find_ref_texts(blocks: list[BlockView], layout: str = "ko_en_interleaved") -> list[tuple[str, str]]:
    """규칙 1 초안에서 REF로 확정할 줄의 (글, 언어) — 쪼개기(_build_unit_rows)와 같은 길."""
    texts = {block.id: block.text for block in blocks}
    by_id = {block.id: block for block in blocks}
    drafts = build_unit_drafts(blocks, [], layout, split_lines=True)
    lines = [
        SectionLine(
            draft.kind, build_unit_text(draft.spans, texts), draft.lang, by_id[draft.spans[0][0]].heading_level,
            by_id[draft.spans[0][0]].part == "body", draft.noise_kind is not None,
        )
        for draft in drafts
    ]
    found = find_ref_section_lines(lines, interleaved=layout == "ko_en_interleaved", separate=layout == "ko_en_separate")
    return [(lines[index].text, lines[index].lang) for index in found]


SECTION_DOCS = {
    "two sections, nested levels": [
        ("1. 목적", 1), (OUTSIDE_LINE, None), ("3. Reference", 1), (REF_LINE, None), ("3.1 Related documents", 2), (STANDARD, None),
        ("3.2 기타", 2), (LATER_LINE, None), ("4. 책임", 1), (OUTSIDE_LINE, None), ("9. 참고 문헌", 1), (f"{REF_LINE}\n{STANDARD}", None),
    ],
    "a clause turned into sentences does not close the section": [
        ("3. Reference", 1), (REF_LINE, None),
        ("4. Close the valve and confirm that it is closed. Record the time and the name of the operator.", 1),
        ("밸브를 닫는다", 1), (LATER_LINE, None), ("5. 책임", 1), (OUTSIDE_LINE, None),
    ],
    "a translated clause named like the section is not a heading": [
        ("5.2.1 Close the valve. Confirm that the valve is closed and record it.", 2), ("참고 문헌", 2), (REF_LINE, None),
        ("6. 책임", 1), (OUTSIDE_LINE, None),
    ],
    "no section": [("1. 목적", 1), (REF_LINE, None)],
}


@pytest.mark.parametrize("layout", ["ko_en_interleaved", "ko_en_separate", "ko_only"])
@pytest.mark.parametrize("name", list(SECTION_DOCS))
def test_section_blocks_give_the_same_answer_as_the_whole_document(name: str, layout: str) -> None:
    blocks = [_block(index, text, level) for index, (text, level) in enumerate(SECTION_DOCS[name], start=1)]

    picked = list_ref_section_blocks(blocks, [])

    assert _find_ref_texts(picked, layout) == _find_ref_texts(blocks, layout)


def test_only_section_blocks_are_split_twice() -> None:
    blocks = [_block(index, text, level) for index, (text, level) in enumerate(SECTION_DOCS["two sections, nested levels"], start=1)]

    assert [block.id for block in list_ref_section_blocks(blocks, [])] == [3, 4, 5, 6, 7, 8, 9, 11, 12]
    assert list_ref_section_blocks(blocks[:2], []) == []


@pytest.mark.parametrize("heading", ["4. Forms", "4. References and Forms", "4. 참고 문서 및 서식"])
def test_upload_forms_heading_confirms_lines_as_ref(client: TestClient, heading: str) -> None:
    body = p("1. Purpose", "Heading1") + p("This procedure covers the synthetic equipment.") + p(heading, "Heading1") + p(REF_LINE)
    bundle = create_bundle(client, is_synthetic=True)
    response = upload(client, bundle["id"], build_docx(body), "SYNTHETIC_OLD-1_Forms_section.docx")
    assert response.status_code == 201, response.text
    view = get_view(client, bundle["id"], response.json()["id"])
    assert find_unit(view, REF_LINE)["lang"] == "ref"


def test_upload_plain_forms_line_opens_no_section(client: TestClient) -> None:
    body = p("1. Purpose", "Heading1") + p("Forms") + p(REF_LINE)
    bundle = create_bundle(client, is_synthetic=True)
    response = upload(client, bundle["id"], build_docx(body), "SYNTHETIC_OLD-1_Forms_plain.docx")
    assert response.status_code == 201, response.text
    view = get_view(client, bundle["id"], response.json()["id"])
    assert find_unit(view, REF_LINE)["lang"] != "ref"
