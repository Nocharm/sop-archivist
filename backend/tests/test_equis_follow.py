"""EQUIS 옛 번호 따라가기 테스트 — 조회는 가짜 함수로 넣는다(설계 §7). 값은 모두 합성이다."""

import asyncio
from collections.abc import Sequence

from app.equis.rules import MAX_LEGACY_HOPS, EquisRow, Resolution, parse_row, resolve_number


def make_doc(number: str, doc_id: str, legacy: str = "", status: str = "Effective") -> EquisRow:
    row = parse_row({
        "DOC_DOCUMENT_NUMBER": number, "DOC_DOCUMENT_ID": doc_id, "DOC_VERSION": "1.0",
        "DOC_DOCUMENT_STATUS": status, "DOC_LIFECYCLE": "Draft to Effective Lifecycle",
        "DOC_DOCUMENT_NAME": f"Synthetic {number}", "DOC_LEGACY_DOCUMENT_ID": legacy,
    })
    assert row is not None
    return row


def resolve(number: str, docs: Sequence[EquisRow]) -> tuple[Resolution, list[str]]:
    """웹훅의 두 조회를 흉내 낸다 — 번호가 같은 줄과, Legacy 글에 번호가 들어 있는 줄(일부만 겹쳐도 온다)."""
    asked: list[str] = []

    async def fetch(wanted: str) -> list[EquisRow]:
        asked.append(wanted)
        return [doc for doc in docs if doc.number == wanted or wanted in " / ".join(doc.legacy_numbers)]

    return asyncio.run(resolve_number(number, fetch)), asked


def test_number_that_exists_is_found_without_hops() -> None:
    result, asked = resolve(" sop-abc-00001 ", [make_doc("SOP-ABC-00001", "1")])
    assert result.state == "found" and result.trail == ("SOP-ABC-00001",)
    assert result.facts is not None and result.facts.doc_id == "1"
    assert asked == ["SOP-ABC-00001"]


def test_unknown_number_is_not_found() -> None:
    result, _ = resolve("SOP-ABC-09999", [make_doc("SOP-ABC-00001", "1")])
    assert result.state == "not_found" and result.facts is None and result.ambiguous == ()


def test_old_number_follows_to_the_current_document() -> None:
    result, _ = resolve("SOP-ABC-1016", [make_doc("SOP-ABC-00001", "1", legacy="SOP-ABC-1016")])
    assert result.state == "found"
    assert result.trail == ("SOP-ABC-1016", "SOP-ABC-00001")
    assert result.facts is not None and result.facts.number == "SOP-ABC-00001"


def test_one_of_several_legacy_numbers_matches() -> None:
    doc = make_doc("FRM-01234", "7", legacy="FRM-ABC-2047-02 / FRM-ABC-00639")
    result, _ = resolve("FRM-ABC-00639", [doc])
    assert result.state == "found" and result.trail[-1] == "FRM-01234"


def test_number_renamed_three_times_reaches_the_last_document() -> None:
    docs = [
        make_doc("SOP-ABC-1016", "1", legacy="SOP-QA-204", status="Obsolete"),
        make_doc("SOP-ABC-00001", "2", legacy="SOP-ABC-1016", status="Obsolete"),
        make_doc("SOP-XYZ-00009", "3", legacy="SOP-ABC-00001"),
    ]
    result, _ = resolve("SOP-QA-204", docs)
    assert result.trail == ("SOP-QA-204", "SOP-ABC-1016", "SOP-ABC-00001", "SOP-XYZ-00009")
    assert result.facts is not None and result.facts.doc_id == "3"


def test_retired_document_without_successor_is_where_it_stops() -> None:
    result, _ = resolve("SOP-ABC-00052", [make_doc("SOP-ABC-00052", "5", status="Obsolete")])
    assert result.state == "found" and result.trail == ("SOP-ABC-00052",)
    assert result.facts is not None and result.facts.retired is not None


def test_live_document_is_not_followed_even_if_listed_as_legacy() -> None:
    docs = [make_doc("SOP-ABC-00001", "1"), make_doc("SOP-XYZ-00009", "3", legacy="SOP-ABC-00001")]
    result, _ = resolve("SOP-ABC-00001", docs)
    assert result.trail == ("SOP-ABC-00001",)
    assert result.facts is not None and result.facts.doc_id == "1"


def test_partial_overlap_is_not_a_legacy_match() -> None:
    # contains 조회는 SOP-ABC-10160을 가진 문서도 돌려준다 — 조각이 정확히 같을 때만 잇는다
    result, _ = resolve("SOP-ABC-1016", [make_doc("SOP-ABC-00777", "9", legacy="SOP-ABC-10160")])
    assert result.state == "not_found"


def test_two_successors_are_reported_not_chosen() -> None:
    docs = [
        make_doc("SOP-ABC-00002", "2", legacy="SOP-ABC-1016"),
        make_doc("SOP-ABC-00001", "1", legacy="SOP-ABC-1016"),
    ]
    result, _ = resolve("SOP-ABC-1016", docs)
    assert result.state == "not_found" and result.facts is None
    assert result.ambiguous == ("SOP-ABC-00001", "SOP-ABC-00002")


def test_documents_pointing_at_each_other_do_not_loop() -> None:
    docs = [
        make_doc("SOP-ABC-00010", "1", legacy="SOP-ABC-00020", status="Obsolete"),
        make_doc("SOP-ABC-00020", "2", legacy="SOP-ABC-00010", status="Obsolete"),
    ]
    result, asked = resolve("SOP-ABC-00010", docs)
    assert result.trail == ("SOP-ABC-00010", "SOP-ABC-00020")
    assert len(asked) == 2


def test_follows_at_most_five_hops() -> None:
    docs = [make_doc("SOP-ABC-00000", "0", status="Obsolete")] + [
        make_doc(f"SOP-ABC-0000{index}", str(index), legacy=f"SOP-ABC-0000{index - 1}", status="Obsolete")
        for index in range(1, 8)
    ]
    result, asked = resolve("SOP-ABC-00000", docs)
    assert len(result.trail) == MAX_LEGACY_HOPS + 1
    assert result.facts is not None and result.facts.number == "SOP-ABC-00005"
    assert len(asked) == MAX_LEGACY_HOPS + 1
