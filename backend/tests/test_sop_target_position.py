"""관계 묶음 저장의 자리 받기(position) — 문장 사이에 놓은 새 문장, 순서 굳히기, 거절, 되돌리기 (끌어다 놓기 설계 §8).

묶음은 섹션 번호 시험(test_sop_numbering)의 SOP 하나·옛 문서 하나 묶음을 그대로 쓴다.
"""

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.models import DecisionStep, TargetDoc, TargetSentence
from tests.access_helpers import run_in_session
from tests.ai_fixtures import read_rows
from tests.docx_factory import build_docx, p
from tests.sop_helpers import (
    AUTHOR,
    assign_as_is,
    find_unit,
    get_bundle,
    get_group_by_unit,
    get_view,
    save_group,
)
from tests.test_sop_decisions import (
    RECORDS,
    STORAGE,
    WARM_UP,
    _body,
    _reason,
    _target,
    _unit_in,
    _upload_ready,
)
from tests.test_sop_decisions import _setup as _setup_sop_and_wi
from tests.test_sop_numbering import PAIR_SLOT, PAIRED, _create_sop_bundle, _pair_units, _put_styles, _read_slot_lines

pytestmark = pytest.mark.usefixtures("clean_sop")

FIRST, SECOND, THIRD = "Check the synthetic valve.", "Open the synthetic hatch.", "Close the synthetic hatch."
DRAGGED, LATE = "Record the synthetic reading.", "Store the synthetic log."
OTHER_SLOT = "scope"


def _setup(client: TestClient) -> tuple[int, int, dict, dict[str, int]]:
    """SOP 하나와 옛 문서(FIRST·SECOND·THIRD·DRAGGED·LATE 순). THIRD → SECOND → FIRST 순서로 짝 칸에 확정해 둔다 —
    만든 순서(id)가 보이는 순서의 반대라, 굳히기가 id 순으로 굳히면 시험이 잡는다. (묶음, SOP, view, 글 → 새 문장 id)"""
    bundle_id, sop_id, doc_id = _create_sop_bundle(client, "".join(p(text) for text in (FIRST, SECOND, THIRD, DRAGGED, LATE)))
    view = get_view(client, bundle_id, doc_id)
    ids = {}
    for text in (THIRD, SECOND, FIRST):
        (target,) = assign_as_is(client, bundle_id, find_unit(view, text), sop_id, slot_key=PAIR_SLOT)["targets"]
        ids[text] = target["id"]
    return bundle_id, sop_id, view, ids


def _unit_entry(client: TestClient, bundle_id: int, unit: dict) -> dict:
    """저장 요청의 단위 항목 — 지금 판단 revision으로 배정."""
    group = get_group_by_unit(client, bundle_id, unit["id"])
    revision = next(member for member in group["units"] if member["unit_id"] == unit["id"])["decision"]["revision"]
    return {"unit_id": unit["id"], "revision": revision, "disposition": "assigned"}


def _save(
    client: TestClient, bundle_id: int, sop_id: int, unit: dict, *, undo: dict | None = None, **fields: object
) -> httpx2.Response:
    """단위 하나를 원문 그대로 확정 — 항목 {"key": "t", "target_doc_id": sop_id, "slot_key": PAIR_SLOT, "source_unit_ids": [unit["id"]]}을 fields가 덮는다."""
    body: dict = {
        "action": "confirm",
        "units": [_unit_entry(client, bundle_id, unit)],
        "targets": [
            {"key": "t", "target_doc_id": sop_id, "slot_key": PAIR_SLOT, "source_unit_ids": [unit["id"]], **fields}
        ],
    }
    if undo is not None:
        body["undo"] = undo
    return save_group(client, bundle_id, body)


def _texts(client: TestClient, bundle_id: int, slot_key: str = PAIR_SLOT) -> list[str]:
    return [text for text, _, _ in _read_slot_lines(client, bundle_id, slot_key)]


def _is_manual_order(target_doc_id: int) -> bool:
    doc = run_in_session(lambda session: session.get(TargetDoc, target_doc_id))
    return doc.manual_order


def _list_events(client: TestClient, bundle_id: int) -> list[tuple[str, str, list[int]]]:
    events = client.get(f"/api/bundles/{bundle_id}/events", headers=AUTHOR).json()
    return [(event["action"], event["target_type"], event["target_ids"]) for event in events]


def _count_reorders(client: TestClient, bundle_id: int) -> int:
    return sum(action == "targets.reorder" for action, _, _ in _list_events(client, bundle_id))


def test_position_after_a_sentence_freezes_the_visible_order(client: TestClient) -> None:
    bundle_id, sop_id, view, ids = _setup(client)
    revision = get_bundle(client, bundle_id)["revision"]
    assert (_texts(client, bundle_id), _is_manual_order(sop_id)) == ([FIRST, SECOND, THIRD], False)

    response = _save(client, bundle_id, sop_id, find_unit(view, DRAGGED), position={"after_target_id": ids[FIRST]})

    assert response.status_code == 200, response.text
    assert _texts(client, bundle_id) == [FIRST, DRAGGED, SECOND, THIRD]
    assert _is_manual_order(sop_id)
    assert get_bundle(client, bundle_id)["revision"] == revision + 1
    assert ("targets.reorder", "target_doc", [sop_id]) in _list_events(client, bundle_id)


@pytest.mark.parametrize(("anchor", "expected"), [
    (None, [DRAGGED, FIRST, SECOND, THIRD]),    # 칸의 맨 앞
    (SECOND, [FIRST, SECOND, DRAGGED, THIRD]),  # 가운데
    (THIRD, [FIRST, SECOND, THIRD, DRAGGED]),   # 끝
])
def test_position_front_middle_and_end(client: TestClient, anchor: str | None, expected: list[str]) -> None:
    bundle_id, sop_id, view, ids = _setup(client)

    response = _save(
        client, bundle_id, sop_id, find_unit(view, DRAGGED),
        position={"after_target_id": ids[anchor] if anchor else None},
    )

    assert response.status_code == 200, response.text
    assert _texts(client, bundle_id) == expected


def test_position_in_a_manual_order_doc_pushes_only_the_lines_after_it(client: TestClient) -> None:
    bundle_id, sop_id, view, ids = _setup(client)
    _put_styles(client, bundle_id, sop_id, [ids[FIRST], ids[SECOND], ids[THIRD]], {})  # 먼저 굳힌 문서(0, 1, 2)
    revision = get_bundle(client, bundle_id)["revision"]

    response = _save(client, bundle_id, sop_id, find_unit(view, DRAGGED), position={"after_target_id": ids[FIRST]})

    assert response.status_code == 200, response.text
    (dragged,) = [target["id"] for target in response.json()["targets"]]
    orders = {
        row.id: row.order_index
        for row in read_rows(TargetSentence) if row.target_doc_id == sop_id and row.parent_target_id is None
    }
    assert orders == {ids[FIRST]: 0, dragged: 1, ids[SECOND]: 2, ids[THIRD]: 3}
    assert _count_reorders(client, bundle_id) == 1  # _put_styles의 것 하나 — 다시 굳히지 않는다
    assert get_bundle(client, bundle_id)["revision"] == revision + 1


def test_position_puts_a_pair_english_first(client: TestClient) -> None:
    ko, en = PAIRED[0]
    bundle_id, sop_id, doc_id = _create_sop_bundle(client, p(FIRST) + p(SECOND) + p(ko) + p(en))
    view = get_view(client, bundle_id, doc_id)
    (first,) = assign_as_is(client, bundle_id, find_unit(view, FIRST), sop_id, slot_key=PAIR_SLOT)["targets"]
    assign_as_is(client, bundle_id, find_unit(view, SECOND), sop_id, slot_key=PAIR_SLOT)
    units = _pair_units(client, bundle_id, doc_id, ko, en)

    response = save_group(client, bundle_id, {  # test_sop_numbering._save_new_targets와 같은 요청([한, 영] 순서)
        "action": "confirm",
        "units": [_unit_entry(client, bundle_id, unit) for unit in units],
        "targets": [
            {
                "key": f"t{index}", "target_doc_id": sop_id, "slot_key": PAIR_SLOT, "source_unit_ids": [unit["id"]],
                "position": {"after_target_id": first["id"]},
            }
            for index, unit in enumerate(units)
        ],
    })

    assert response.status_code == 200, response.text
    assert _read_slot_lines(client, bundle_id) == [
        (FIRST, "6.1.1", "numbered"), (en, "6.1.2", "numbered"), (ko, None, "omitted"), (SECOND, "6.1.3", "numbered"),
    ]


def test_position_moves_an_existing_sentence_into_another_slot(client: TestClient) -> None:
    bundle_id, sop_id, view, ids = _setup(client)
    unit = find_unit(view, DRAGGED)
    assert _save(client, bundle_id, sop_id, unit, slot_key=OTHER_SLOT).status_code == 200
    (target,) = get_group_by_unit(client, bundle_id, unit["id"])["targets"]

    response = _save(
        client, bundle_id, sop_id, unit, id=target["id"], revision=target["revision"],
        position={"after_target_id": ids[FIRST]},
    )

    assert response.status_code == 200, response.text
    assert (_texts(client, bundle_id), _texts(client, bundle_id, OTHER_SLOT)) == ([FIRST, DRAGGED, SECOND, THIRD], [])


def test_a_sentence_without_a_position_in_the_same_save_goes_to_the_end(client: TestClient) -> None:
    bundle_id, sop_id, view, ids = _setup(client)
    dragged, late = find_unit(view, DRAGGED), find_unit(view, LATE)

    response = save_group(client, bundle_id, {
        "action": "confirm",
        "units": [_unit_entry(client, bundle_id, unit) for unit in (dragged, late)],
        "targets": [
            {
                "key": "d", "target_doc_id": sop_id, "slot_key": PAIR_SLOT, "source_unit_ids": [dragged["id"]],
                "position": {"after_target_id": ids[FIRST]},
            },
            {"key": "l", "target_doc_id": sop_id, "slot_key": PAIR_SLOT, "source_unit_ids": [late["id"]]},
        ],
    })

    assert response.status_code == 200, response.text
    assert _texts(client, bundle_id) == [FIRST, DRAGGED, SECOND, THIRD, LATE]


def test_no_position_keeps_the_document_as_it_was(client: TestClient) -> None:
    bundle_id, sop_id, view, _ = _setup(client)
    revision = get_bundle(client, bundle_id)["revision"]

    response = _save(client, bundle_id, sop_id, find_unit(view, DRAGGED))

    assert response.status_code == 200, response.text
    assert (_texts(client, bundle_id), _is_manual_order(sop_id)) == ([FIRST, SECOND, THIRD, DRAGGED], False)
    assert get_bundle(client, bundle_id)["revision"] == revision


@pytest.mark.parametrize(("case", "reason"), [
    ("another_slot", "position_target_elsewhere"),
    ("missing", "unknown_position_target"),
    ("same_place", "position_same_place"),
    ("slot_heading", "position_not_allowed"),
])
def test_position_rejections_write_nothing(client: TestClient, case: str, reason: str) -> None:
    bundle_id, sop_id, view, ids = _setup(client)
    revision = get_bundle(client, bundle_id)["revision"]
    dragged = find_unit(view, DRAGGED)

    if case == "another_slot":
        response = _save(
            client, bundle_id, sop_id, dragged, slot_key=OTHER_SLOT, position={"after_target_id": ids[FIRST]}
        )
    elif case == "missing":
        response = _save(client, bundle_id, sop_id, dragged, position={"after_target_id": 999_999})
    elif case == "same_place":
        first = find_unit(view, FIRST)
        (target,) = get_group_by_unit(client, bundle_id, first["id"])["targets"]
        response = _save(
            client, bundle_id, sop_id, first, id=target["id"], revision=target["revision"],
            position={"after_target_id": ids[SECOND]},
        )
    else:
        response = _save(
            client, bundle_id, sop_id, dragged, kind="slot_heading", position={"after_target_id": ids[FIRST]}
        )

    assert (response.status_code, response.json()["detail"]["code"], response.json()["detail"]["reason"]) == (
        422, "invalid_group", reason,
    )
    assert _texts(client, bundle_id) == [FIRST, SECOND, THIRD]
    assert _is_manual_order(sop_id) is False
    assert get_bundle(client, bundle_id)["revision"] == revision
    assert _count_reorders(client, bundle_id) == 0


def _read_top_orders(target_doc_id: int) -> dict[int, int]:
    return {
        row.id: row.order_index
        for row in read_rows(TargetSentence) if row.target_doc_id == target_doc_id and row.parent_target_id is None
    }


def test_position_at_the_front_of_an_empty_slot_goes_after_the_document_end(client: TestClient) -> None:
    bundle_id, sop_id, view, ids = _setup(client)

    response = _save(
        client, bundle_id, sop_id, find_unit(view, DRAGGED), slot_key=OTHER_SLOT, position={"after_target_id": None}
    )

    assert response.status_code == 200, response.text
    (dragged,) = [target["id"] for target in response.json()["targets"]]
    assert (_texts(client, bundle_id), _texts(client, bundle_id, OTHER_SLOT)) == ([FIRST, SECOND, THIRD], [DRAGGED])
    assert _is_manual_order(sop_id)
    assert _read_top_orders(sop_id) == {ids[FIRST]: 0, ids[SECOND]: 1, ids[THIRD]: 2, dragged: 3}  # 굳힌 최댓값 + 1


def test_position_without_after_target_id_is_a_validation_error(client: TestClient) -> None:
    bundle_id, sop_id, view, _ = _setup(client)
    revision = get_bundle(client, bundle_id)["revision"]

    response = _save(client, bundle_id, sop_id, find_unit(view, DRAGGED), position={})

    assert response.status_code == 422, response.text
    assert [error["loc"][-1] for error in response.json()["detail"]] == ["after_target_id"]
    assert (_texts(client, bundle_id), _is_manual_order(sop_id)) == ([FIRST, SECOND, THIRD], False)
    assert get_bundle(client, bundle_id)["revision"] == revision


def test_a_rejected_positioned_save_records_no_undo_step(client: TestClient) -> None:
    bundle_id, sop_id, view, _ = _setup(client)
    revision = get_bundle(client, bundle_id)["revision"]

    response = _save(
        client, bundle_id, sop_id, find_unit(view, DRAGGED), undo={"session": "s1"},
        position={"after_target_id": 999_999},
    )

    assert _reason(response) == "unknown_position_target"
    assert [step for step in read_rows(DecisionStep) if step.bundle_id == bundle_id] == []
    assert (_texts(client, bundle_id), _is_manual_order(sop_id)) == ([FIRST, SECOND, THIRD], False)
    assert get_bundle(client, bundle_id)["revision"] == revision
    assert _count_reorders(client, bundle_id) == 0


@pytest.mark.parametrize("case", ["deleted_in_this_save", "slot_heading", "positioned_in_this_save"])
def test_unknown_position_target_cases(client: TestClient, case: str) -> None:
    bundle_id, sop_id, view, ids = _setup(client)
    dragged, late = find_unit(view, DRAGGED), find_unit(view, LATE)
    if case == "deleted_in_this_save":
        second = find_unit(view, SECOND)
        anchor_id = ids[SECOND]
        body = {
            "action": "confirm",
            "units": [
                _unit_entry(client, bundle_id, dragged),
                {**_unit_entry(client, bundle_id, second), "disposition": "delete", "reason": "Synthetic reason"},
            ],
            "targets": [{
                "key": "t", "target_doc_id": sop_id, "slot_key": PAIR_SLOT, "source_unit_ids": [dragged["id"]],
                "position": {"after_target_id": anchor_id},
            }],
            "removed_target_ids": [anchor_id],
        }
    elif case == "slot_heading":
        heading = _save(client, bundle_id, sop_id, late, kind="slot_heading")
        assert heading.status_code == 200, heading.text
        (anchor_id,) = [target["id"] for target in heading.json()["targets"]]
        body = {
            "action": "confirm",
            "units": [_unit_entry(client, bundle_id, dragged)],
            "targets": [{
                "key": "t", "target_doc_id": sop_id, "slot_key": PAIR_SLOT, "source_unit_ids": [dragged["id"]],
                "position": {"after_target_id": anchor_id},
            }],
        }
    else:
        assert _save(client, bundle_id, sop_id, dragged, slot_key=OTHER_SLOT).status_code == 200
        (moved,) = get_group_by_unit(client, bundle_id, dragged["id"])["targets"]
        anchor_id = moved["id"]
        body = {
            "action": "confirm",
            "units": [_unit_entry(client, bundle_id, unit) for unit in (dragged, late)],
            "targets": [
                {
                    "key": "d", "id": moved["id"], "revision": moved["revision"], "target_doc_id": sop_id,
                    "slot_key": PAIR_SLOT, "source_unit_ids": [dragged["id"]],
                    "position": {"after_target_id": ids[FIRST]},
                },
                {
                    "key": "t", "target_doc_id": sop_id, "slot_key": PAIR_SLOT, "source_unit_ids": [late["id"]],
                    "position": {"after_target_id": anchor_id},
                },
            ],
        }
    revision = get_bundle(client, bundle_id)["revision"]

    response = save_group(client, bundle_id, body)

    assert _reason(response) == "unknown_position_target"
    assert (response.json()["detail"]["keys"], response.json()["detail"]["target_ids"]) == (["t"], [anchor_id])
    assert (_texts(client, bundle_id), _is_manual_order(sop_id)) == ([FIRST, SECOND, THIRD], False)
    assert get_bundle(client, bundle_id)["revision"] == revision


def test_position_in_a_wi_step_and_across_documents(client: TestClient) -> None:
    fx = _setup_sop_and_wi(client)
    warm_up, records, storage = (find_unit(fx.view, text) for text in (WARM_UP, RECORDS, STORAGE))
    instruction = {"wi_step": 1, "wi_part": "instruction"}
    for unit in (warm_up, records):
        assign_as_is(client, fx.bundle_id, unit, fx.wi_id, **instruction)
    (anchor,) = get_group_by_unit(client, fx.bundle_id, warm_up["id"])["targets"]
    position = {"after_target_id": anchor["id"]}

    def _send(doc_id: int, **location: object) -> httpx2.Response:
        return save_group(
            client, fx.bundle_id, _body([_unit_in(storage)], [_target("t", doc_id, [storage], position=position, **location)])
        )

    assert _reason(_send(fx.wi_id, wi_step=1, wi_part="why")) == "position_target_elsewhere"
    assert _reason(_send(fx.sop_id, slot_key="purpose")) == "position_target_elsewhere"
    saved = _send(fx.wi_id, **instruction)

    assert saved.status_code == 200, saved.text
    output = client.get(f"/api/bundles/{fx.bundle_id}/outputs/c", headers=AUTHOR).json()
    wi = next(doc for doc in output["docs"] if doc["code"] == "WI-01")
    section = next(section for section in wi["sections"] if section["location_key"] == "step:1:instruction")
    assert [item["text"] for item in section["items"]] == [WARM_UP, STORAGE, RECORDS]


def test_position_on_a_written_document_is_still_match_doc_new_target(client: TestClient) -> None:
    fx = _setup_sop_and_wi(client)
    unit = find_unit(fx.view, STORAGE)
    new_doc = _upload_ready(
        client, fx.bundle_id, build_docx(p(STORAGE)), "SYNTHETIC_SOP-M_Match.docx", side="new", doc_type="sop"
    )

    response = save_group(client, fx.bundle_id, _body(
        [_unit_in(unit)], [_target("t", new_doc["target_doc_id"], [unit], position={"after_target_id": None})]
    ))

    assert _reason(response) == "match_doc_new_target"


def test_undo_of_a_positioned_save_removes_the_sentence_and_keeps_the_frozen_order(client: TestClient) -> None:
    bundle_id, sop_id, view, ids = _setup(client)
    saved = _save(
        client, bundle_id, sop_id, find_unit(view, DRAGGED), undo={"session": "s1"},
        position={"after_target_id": ids[FIRST]},
    )
    assert saved.status_code == 200, saved.text

    undone = client.post(f"/api/bundles/{bundle_id}/decisions/undo", json={"session": "s1"}, headers=AUTHOR)

    assert undone.status_code == 200, undone.text
    assert _texts(client, bundle_id) == [FIRST, SECOND, THIRD]  # 만든 순서 [THIRD, SECOND, FIRST]가 아니다 — 굳힌 순서가 남는다
    assert _is_manual_order(sop_id)
    redone = client.post(f"/api/bundles/{bundle_id}/decisions/redo", json={"session": "s1"}, headers=AUTHOR)
    assert redone.status_code == 200, redone.text
    assert _texts(client, bundle_id) == [FIRST, DRAGGED, SECOND, THIRD]


def test_an_earlier_undo_step_on_a_frozen_document_conflicts(client: TestClient) -> None:
    """굳히기는 되돌리기 단계 밖이다 — 굳히며 순번이 바뀐 문장을 건드린 그 전 단계는 409 undo_conflict(Order에서 순서를 바꾼 뒤와 같다, 설계 §12)."""
    bundle_id, sop_id, doc_id = _create_sop_bundle(client, "".join(p(text) for text in (FIRST, SECOND, THIRD, DRAGGED)))
    view = get_view(client, bundle_id, doc_id)
    ids = {}
    for text in (FIRST, THIRD, SECOND):
        saved = _save(client, bundle_id, sop_id, find_unit(view, text), undo={"session": "s1"})
        assert saved.status_code == 200, saved.text
        (target,) = saved.json()["targets"]
        ids[text] = target["id"]
    first_id = ids[FIRST]
    positioned = _save(
        client, bundle_id, sop_id, find_unit(view, DRAGGED), undo={"session": "s1"}, position={"after_target_id": first_id},
    )
    assert positioned.status_code == 200, positioned.text

    undone = client.post(f"/api/bundles/{bundle_id}/decisions/undo", json={"session": "s1"}, headers=AUTHOR)
    earlier = client.post(f"/api/bundles/{bundle_id}/decisions/undo", json={"session": "s1"}, headers=AUTHOR)

    assert undone.status_code == 200, undone.text
    assert earlier.status_code == 409, earlier.text
    assert earlier.json()["detail"]["code"] == "undo_conflict"
    assert _texts(client, bundle_id) == [FIRST, SECOND, THIRD]
