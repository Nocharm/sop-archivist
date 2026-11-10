"""섹션 번호 — 칸 번호(SLOT_KEYS 고정 자리)와 들여쓰기 깊이로 세는 순수 함수, 결과물 A·C의 번호, 순서 바꾸기의 깊이 저장·거절.

묶음은 결과물 시험(test_sop_outputs)의 픽스처를 그대로 쓴다 — SOP·WI·입구 2 문서와 표·그림·나눔·중복 배정이 다 있다.
"""

from functools import partial

import pytest
from fastapi.testclient import TestClient

from app.sop.constants import MAX_INDENT_LEVEL, SLOT_KEYS
from app.sop.outputs import SLOT_NUMBERS, number_lines
from tests.sop_helpers import get_bundle
from tests.test_sop_outputs import (
    DUPLICATE,
    MERGED,
    RECORDS_EN,
    SPLIT_A,
    SPLIT_B,
    SPLIT_SOURCE,
    _display,
    _display_of_kind,
    _get_output,
    _list_top_target_ids,
    _put_order,
    _setup,
)

pytestmark = pytest.mark.usefixtures("clean_sop")


@pytest.mark.parametrize(
    ("depths", "expected"),
    [
        ([], []),
        ([0, 0, 0], ["5.1", "5.2", "5.3"]),
        ([0, 1, 1, 2, 0], ["5.1", "5.1.1", "5.1.2", "5.1.2.1", "5.2"]),
        # 첫 줄은 앞줄이 없어 맨 바깥, 앞줄 깊이 + 1을 넘는 깊이는 눌러 읽는다
        ([3], ["5.1"]),
        # 앞줄의 "눌러 읽은" 깊이 + 1이 상한이라 같은 깊이를 연달아 보내면 한 단계씩 내려간다
        ([0, 4, 4], ["5.1", "5.1.1", "5.1.1.1"]),
        ([0, 1, 2, 3, 1, 0], ["5.1", "5.1.1", "5.1.1.1", "5.1.1.1.1", "5.1.2", "5.2"]),
        # 깊은 줄 뒤에서 한 번에 여러 단계 내어 쓴다
        ([0, 1, 2, 0, 2], ["5.1", "5.1.1", "5.1.1.1", "5.2", "5.2.1"]),
    ],
)
def test_number_lines(depths: list[int], expected: list[str]) -> None:
    assert number_lines("5", depths) == expected


def test_slot_numbers_follow_the_fixed_slot_positions() -> None:
    assert list(SLOT_NUMBERS) == list(SLOT_KEYS)
    assert SLOT_NUMBERS == {
        "purpose": "1", "scope": "2", "definitions": "3", "responsibilities": "4",
        "general_requirements": "5", "general_requirements.safety": "5.1", "general_requirements.operation": "5.2",
        "procedures": "6", "procedures.procedure": "6.1", "procedures.electronic_record_control": "6.2",
        "procedures.troubleshooting": "6.3", "procedures.maintenance": "6.4",
        "document_relationships": "7", "document_relationships.attachments": "7.1",
        "document_relationships.appendices": "7.2",
    }


def _read_numbers(doc: dict) -> list[tuple[str, str | None, list[tuple[str, str | None]]]]:
    """(칸 키, 칸 번호, [(글, 번호)]) — 글이 빈 항목(그림·표)은 종류로 적는다."""
    return [
        (
            section["location_key"], section["number"],
            [(item["text"] or item["kind"], item["number"]) for item in section["items"]],
        )
        for section in doc["sections"]
    ]


def test_output_c_numbers_slots_steps_and_lines(client: TestClient) -> None:
    fx = _setup(client)

    ko = _get_output(client, fx.bundle_id, "outputs/c", "ko")
    en = _get_output(client, fx.bundle_id, "outputs/c", "en")

    sop, wi, match = ko["docs"]
    sop_numbers = {key: (number, items) for key, number, items in _read_numbers(sop)}
    # N/A 칸(scope·document_relationships)도 자기 번호를 지켜 다른 칸 번호가 밀리지 않는다
    assert {key: number for key, (number, _) in sop_numbers.items()} == SLOT_NUMBERS
    assert sop_numbers["responsibilities"][1] == [(DUPLICATE, "4.1")]
    assert sop_numbers["general_requirements"][1] == [("table", "5.1")]
    assert sop_numbers["general_requirements.operation"][1] == [(MERGED, "5.2.1")]
    # 표 칸은 표의 번호를 따른다
    (table,) = next(section["items"] for section in sop["sections"] if section["location_key"] == "general_requirements")
    assert {cell["number"] for cell in table["children"]} == {"5.1"}
    # 판마다 그 판에 보이는 줄만 센다 — 영어판의 첫 줄도 5.2.1
    en_sop = {section["location_key"]: section for section in en["docs"][0]["sections"]}
    assert [(item["text"], item["number"]) for item in en_sop["general_requirements.operation"]["items"]] == [
        (RECORDS_EN, "5.2.1"),
    ]
    # WI는 단계 번호 아래로 Instruction·Why를 이어 센다
    assert _read_numbers(wi) == [
        ("step:1:instruction", "1", [(SPLIT_A, "1.1")]),
        ("step:1:why", "1", [(DUPLICATE, "1.2")]),
        ("step:2:instruction", "2", [(SPLIT_B, "2.1"), ("figure", "2.2")]),
        ("step:2:why", "2", []),
    ]
    # 입구 2 문서는 번호를 새로 매기지 않는다
    assert all(number is None and all(n is None for _, n in items) for _, number, items in _read_numbers(match))


def test_indent_changes_numbers_in_outputs_a_and_c(client: TestClient) -> None:
    fx = _setup(client)
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    (split_a,), (duplicate,), (split_b, figure), () = [section["items"] for section in wi["sections"]]
    revision = get_bundle(client, fx.bundle_id)["revision"]
    items = [
        {"target_id": split_a["target_id"]},
        {"target_id": duplicate["target_id"], "indent_level": 1},
        {"target_id": split_b["target_id"]},
        # 앞줄보다 넷 깊게 보내도 저장은 그대로, 번호는 한 단계로 눌러 읽는다
        {"target_id": figure["target_id"], "indent_level": 4},
    ]

    response = _put_order(client, fx.bundle_id, {"revision": revision, "target_doc_id": fx.wi_id, "items": items})

    assert response.status_code == 200, response.text
    assert [(item["target_id"], item["indent_level"]) for item in response.json()["items"]] == [
        (split_a["target_id"], 0), (duplicate["target_id"], 1), (split_b["target_id"], 0), (figure["target_id"], 4),
    ]
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    assert [[(item["number"], item["indent_level"]) for item in section["items"]] for section in wi["sections"]] == [
        [("1.1", 0)], [("1.1.1", 1)], [("2.1", 0), ("2.1.1", 4)], [],
    ]

    # 결과물 A의 새 위치 번호는 결과물 C와 같은 값 — 나눔은 ①② 순서, 중복 배정은 보낸 곳마다
    rows = _get_output(client, fx.bundle_id, "outputs/a", "ko")
    by_display: dict[str, list[dict]] = {}
    for row in rows:
        by_display.setdefault(row["display_id"], []).append(row)
    d1 = partial(_display, fx.old1)
    (split_row,) = by_display[d1(SPLIT_SOURCE)]
    assert split_row["dest_number"] == "① 1.1\n② 2.1"
    assert [(row["dest_doc_code"], row["dest_number"]) for row in by_display[d1(DUPLICATE)]] == [
        ("SOP-NEW", "4.1"), ("WI-01", "1.1.1"),
    ]
    (figure_row,) = by_display[_display_of_kind(fx.old1, "figure")]
    assert figure_row["dest_number"] == "2.1.1"
    # 삭제·이동·미배정과 입구 2 줄은 번호가 비어 있다
    assert {row["dest_number"] for row in rows if row["dest_kind"] in ("delete", "move_external", "")} == {""}
    assert {row["dest_number"] for row in rows if row["dest_doc_code"] == "SOP-9"} == {""}


def test_reorder_rejects_bad_indents(client: TestClient) -> None:
    fx = _setup(client)
    revision = get_bundle(client, fx.bundle_id)["revision"]
    sop_items = [{"target_id": target_id} for target_id in _list_top_target_ids(client, fx.bundle_id, 0)]
    match_items = [{"target_id": target_id} for target_id in _list_top_target_ids(client, fx.bundle_id, 2)]

    too_deep = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.sop_id,
        "items": [{**sop_items[0], "indent_level": MAX_INDENT_LEVEL + 1}, *sop_items[1:]],
    })
    negative = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.sop_id, "items": [{**sop_items[0], "indent_level": -1}, *sop_items[1:]],
    })
    on_match = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.match_id,
        "items": [{**match_items[0], "indent_level": 1}, *match_items[1:]],
    })
    same_on_match = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.match_id,
        "items": [{**match_items[0], "indent_level": 0}, *match_items[1:]],
    })
    deepest = _put_order(client, fx.bundle_id, {
        "revision": revision + 1, "target_doc_id": fx.sop_id,
        "items": [{**sop_items[0], "indent_level": MAX_INDENT_LEVEL}, *sop_items[1:]],
    })

    assert (too_deep.status_code, too_deep.json()["detail"][0]["type"]) == (422, "less_than_equal")
    assert (negative.status_code, negative.json()["detail"][0]["type"]) == (422, "greater_than_equal")
    assert (on_match.status_code, on_match.json()["detail"]) == (
        422, {"code": "indent_not_allowed", "target_ids": [match_items[0]["target_id"]]},
    )
    # 지금 깊이 그대로(0)를 보내는 것은 바꾸지 않는 것이라 입구 2 문서의 순서 바꾸기를 막지 않는다
    assert same_on_match.status_code == 200, same_on_match.text
    assert deepest.status_code == 200, deepest.text
