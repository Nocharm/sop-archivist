"""관계 묶음 저장·일괄 처분·배정 지우기·문서 삭제의 떼어 내기, 단위 목록과 묶음 읽기 — To-Be와 합성 DOCX를 올린 묶음으로 본다."""

from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import STATUSES, SYSTEM_HOLD_RELATED_CHANGED
from app.sop.models import Bundle, TargetSentence, TargetSource, TargetTextHistory, UnitDecisionHistory
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import (
    AUTHOR,
    REVIEWER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_Decisions.docx"
OLD_BODY = (
    p("1. 목적", "Heading1")
    + p("1. Purpose", "Heading1")
    + p("합성 장비를 5분간 예열한다. 합성 기록은 보관한다.")
    + p("Warm up the synthetic unit for 5 minutes. Synthetic records are kept.")
    + p("합성 시료는 4 ℃에서 보관한다.")
    + tbl([["항목", "Item"], ["합성 값", "Synthetic value"]])
    + f"<w:p>{make_drawing_run('image1.png')}</w:p>"
    + p("그림 1 합성 장비", "Caption")
)
OLD_HEADERS = [p("합성 머리말 하나") + p("합성 머리말 둘") + p("합성 머리말 셋")]
WARM_UP = "합성 장비를 5분간 예열한다."
RECORDS = "합성 기록은 보관한다."
STORAGE = "합성 시료는 4 ℃에서 보관한다."
HEADER_TEXTS = ("합성 머리말 하나", "합성 머리말 둘", "합성 머리말 셋")
NO_DESTINATION = "Synthetic: no destination yet"

TOBE_DOCS = [
    {"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None},
    {"code": "WI-01", "title": "Synthetic WI", "doc_type": "wi", "parent_code": "SOP-NEW"},
]
NA_SLOTS = [
    {"code": "SOP-NEW", "slot_key": "procedures", "reason": "Synthetic: no procedures"},
    {"code": "SOP-NEW", "slot_key": "scope", "reason": "Synthetic: covered elsewhere"},
]
WI_STEPS = [{"code": "WI-01", "step_no": 1, "title": "Prepare"}]


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    wi_id: int
    doc: dict
    view: dict


def _upload_ready(client: TestClient, bundle_id: int, data: bytes, name: str, **kwargs: str) -> dict:
    response = upload(client, bundle_id, data, name, **kwargs)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()
    return response.json()


def _setup(client: TestClient) -> Fixture:
    """To-Be(SOP 하나 — procedures·scope N/A, 그 아래 WI 하나 — 1단계)와 옛 문서 하나를 올린 묶음."""
    bundle = create_bundle(client, is_synthetic=True)
    response = put_tobe(client, bundle["id"], TOBE_DOCS, na_slots=NA_SLOTS, wi_steps=WI_STEPS)
    assert response.status_code == 200, response.text
    codes = {doc["code"]: doc["id"] for doc in response.json()["docs"]}
    data = build_docx(OLD_BODY, headers=OLD_HEADERS, media={"image1.png": TINY_PNG})
    doc = _upload_ready(client, bundle["id"], data, OLD_NAME)
    return Fixture(bundle["id"], codes["SOP-NEW"], codes["WI-01"], doc, get_view(client, bundle["id"], doc["id"]))


def _unit_in(unit: dict, revision: int = 1, disposition: str = "assigned", **fields: str) -> dict:
    return {"unit_id": unit["id"], "revision": revision, "disposition": disposition, **fields}


def _target(key: str, doc_id: int, sources: list[dict], **fields: object) -> dict:
    return {"key": key, "target_doc_id": doc_id, "source_unit_ids": [unit["id"] for unit in sources], **fields}


def _body(units: list[dict], targets: list[dict], **fields: object) -> dict:
    return {"action": "confirm", "units": units, "targets": targets, **fields}


def _reason(response: httpx2.Response) -> str:
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "invalid_group", response.json()
    return response.json()["detail"]["reason"]


def _merge(client: TestClient, fx: Fixture, first: dict, second: dict, doc_id: int | None = None) -> dict:
    """두 단위를 SOP 한 문장으로 합쳐 확정한다."""
    target = _target(
        "merged", doc_id or fx.sop_id, [first, second], slot_key="general_requirements.operation",
        text="합성 장비를 5분간 예열하고 기록은 보관한다.", change_type="rewritten",
    )
    response = save_group(client, fx.bundle_id, _body([_unit_in(first), _unit_in(second)], [target]))
    assert response.status_code == 200, response.text
    return response.json()


def _list_units(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR, **params: object) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/units", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _count_rows(model: type, **filters: int) -> int:
    async def _run(session: AsyncSession) -> int:
        conditions = [getattr(model, name) == value for name, value in filters.items()]
        return await session.scalar(select(func.count()).select_from(model).where(*conditions))

    return run_in_session(_run)


# ── 관계 묶음 저장 ────────────────────────────────────────────────────────────


def test_assign_as_is_confirms_and_fixes_change_type(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    target = _target("t", fx.sop_id, [unit], slot_key="responsibilities", text=STORAGE, change_type="tone")

    response = save_group(client, fx.bundle_id, _body([_unit_in(unit)], [target]))

    assert response.status_code == 200, response.text
    (entry,) = response.json()["units"]
    (saved,) = response.json()["targets"]
    decision = entry["decision"]
    assert (decision["disposition"], decision["status"], decision["confirmed_by"], decision["revision"]) == (
        "assigned", "confirmed", "qa.member", 2,
    )
    assert decision["confirmed_at"].endswith("+09:00")
    assert (entry["display_id"], entry["document_id"], entry["group_id"]) == (unit["display_id"], fx.doc["id"], None)
    # 글자가 원문과 같으면 요청이 말투(tone)여도 그대로(as_is)다
    assert saved["change_type"] == "as_is"
    assert (saved["status"], saved["origin"], saved["lang"], saved["kind"]) == ("confirmed", "units", "ko", "sentence")
    assert (saved["target_doc_id"], saved["slot_key"], saved["confirmed_text"]) == (fx.sop_id, "responsibilities", STORAGE)
    assert (saved["source_unit_ids"], saved["group_id"], saved["warnings"], saved["revision"]) == ([unit["id"]], None, [], 1)
    events = client.get(f"/api/bundles/{fx.bundle_id}/events", headers=AUTHOR).json()
    assert (events[0]["action"], events[0]["target_type"], events[0]["target_ids"]) == ("group.confirm", "unit", [unit["id"]])


def test_split_into_two_targets_is_split(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, WARM_UP)
    targets = [
        _target("a", fx.wi_id, [unit], wi_step=1, wi_part="instruction", text="합성 장비를 예열한다."),
        _target("b", fx.wi_id, [unit], wi_step=1, wi_part="why", text="예열 시간은 5분이다."),
    ]

    response = save_group(client, fx.bundle_id, _body([_unit_in(unit)], targets))

    assert response.status_code == 200, response.text
    group = response.json()
    first, second = group["targets"]
    expected_group = f"G-{unit['display_id']}"
    assert (first["change_type"], second["change_type"]) == ("split", "split")
    assert {first["group_id"], second["group_id"], group["units"][0]["group_id"]} == {expected_group}

    # 둘째 문장을 지우면 나눔이 풀리고 남은 문장은 사람이 고른 종류가 된다
    kept = {"key": "a", "id": first["id"], "revision": first["revision"], "source_unit_ids": [unit["id"]],
            "wi_step": 1, "wi_part": "instruction", "change_type": "rewritten"}
    response = save_group(client, fx.bundle_id, _body([_unit_in(unit, 2)], [kept], removed_target_ids=[second["id"]]))

    assert response.status_code == 200, response.text
    (only,) = response.json()["targets"]
    assert (only["id"], only["change_type"], only["group_id"], only["revision"]) == (first["id"], "rewritten", None, 2)
    assert only["confirmed_text"] == "합성 장비를 예열한다."
    assert _count_rows(TargetSentence, id=second["id"]) == 0


def test_merge_two_units_is_merged(client: TestClient) -> None:
    fx = _setup(client)
    first, second = find_unit(fx.view, WARM_UP), find_unit(fx.view, RECORDS)

    saved = _merge(client, fx, first, second)

    (target,) = saved["targets"]
    assert target["change_type"] == "merged"
    assert target["source_unit_ids"] == [first["id"], second["id"]]
    group = get_group_by_unit(client, fx.bundle_id, second["id"])
    expected_group = f"G-{first['display_id']}"
    assert [(entry["unit_id"], entry["group_id"]) for entry in group["units"]] == [
        (first["id"], expected_group), (second["id"], expected_group),
    ]
    assert [t["group_id"] for t in group["targets"]] == [expected_group]
    by_target = client.get(f"/api/bundles/{fx.bundle_id}/groups/by-target/{target['id']}", headers=AUTHOR)
    assert by_target.status_code == 200
    assert by_target.json() == group


def test_pair_units_saved_together(client: TestClient) -> None:
    fx = _setup(client)
    ko, en = find_unit(fx.view, "1. 목적"), find_unit(fx.view, "1. Purpose")
    targets = [_target("ko", fx.sop_id, [ko], slot_key="purpose"), _target("en", fx.sop_id, [en], slot_key="purpose")]

    response = save_group(client, fx.bundle_id, _body([_unit_in(ko), _unit_in(en)], targets))

    assert response.status_code == 200, response.text
    group = response.json()
    assert [(e["unit_id"], e["decision"]["status"], e["group_id"]) for e in group["units"]] == [
        (ko["id"], "confirmed", None), (en["id"], "confirmed", None),
    ]
    assert [(t["lang"], t["confirmed_text"], t["change_type"], t["group_id"]) for t in group["targets"]] == [
        ("ko", "1. 목적", "as_is", None), ("en", "1. Purpose", "as_is", None),
    ]


def test_send_as_is_without_text(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, RECORDS)

    response = save_group(
        client, fx.bundle_id, _body([_unit_in(unit)], [_target("t", fx.sop_id, [unit], slot_key="definitions")])
    )

    assert response.status_code == 200, response.text
    (target,) = response.json()["targets"]
    assert (target["confirmed_text"], target["change_type"]) == (RECORDS, "as_is")


def test_duplicate_assignment_requires_reason(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    targets = [
        _target("sop", fx.sop_id, [unit], slot_key="responsibilities"),
        _target("wi", fx.wi_id, [unit], wi_step=1, wi_part="instruction"),
    ]

    assert _reason(save_group(client, fx.bundle_id, _body([_unit_in(unit)], targets))) == "duplicate_without_reason"
    response = save_group(client, fx.bundle_id, _body([_unit_in(unit, reason="Synthetic: needed in both")], targets))

    assert response.status_code == 200, response.text
    assert [t["change_type"] for t in response.json()["targets"]] == ["as_is", "as_is"]
    assert response.json()["units"][0]["decision"]["reason"] == "Synthetic: needed in both"


def test_group_must_be_closed(client: TestClient) -> None:
    fx = _setup(client)
    first, second = find_unit(fx.view, WARM_UP), find_unit(fx.view, RECORDS)
    target = _merge(client, fx, first, second)["targets"][0]
    existing = {"key": "t", "id": target["id"], "revision": 1, "slot_key": "general_requirements.operation",
                "change_type": "rewritten"}

    # 합친 문장의 한 출처만 보내면 그 문장의 다른 출처가 묶음 밖에 남는다
    only_first = _body([_unit_in(first, 2)], [{**existing, "source_unit_ids": [first["id"]]}])
    # 단위만 보내고 이어진 문장을 빼먹었다
    without_target = _body([_unit_in(first, 2, "delete", reason="Synthetic")], [])
    # 보내지 않은 단위를 출처로 쓴다
    foreign_source = _body([_unit_in(first, 2)], [{**existing, "source_unit_ids": [first["id"], second["id"]]}])

    for body in (only_first, without_target, foreign_source):
        assert _reason(save_group(client, fx.bundle_id, body)) == "not_closed"


def test_group_save_with_one_stale_revision_changes_nothing(client: TestClient) -> None:
    fx = _setup(client)
    first, second = find_unit(fx.view, WARM_UP), find_unit(fx.view, RECORDS)
    target = _merge(client, fx, first, second)["targets"][0]
    # 다른 작성자가 둘을 나눠 다시 저장하려는데 둘째 단위의 revision만 낡았다
    split = [
        _target("a", fx.sop_id, [first], slot_key="general_requirements.operation"),
        _target("b", fx.sop_id, [second], slot_key="general_requirements.operation"),
    ]

    response = save_group(
        client, fx.bundle_id, _body([_unit_in(first, 2), _unit_in(second, 1)], split, removed_target_ids=[target["id"]])
    )

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "revision_conflict",
        "conflicts": [{"entity": "unit", "id": second["id"], "current_revision": 2}],
    }
    group = get_group_by_unit(client, fx.bundle_id, first["id"])
    assert [(e["unit_id"], e["decision"]["revision"], e["decision"]["status"]) for e in group["units"]] == [
        (first["id"], 2, "confirmed"), (second["id"], 2, "confirmed"),
    ]
    assert [(t["id"], t["revision"], t["change_type"]) for t in group["targets"]] == [(target["id"], 1, "merged")]


@pytest.mark.parametrize(
    ("place", "location", "reason"),
    [
        ("sop", {"slot_key": "scope"}, "na_slot"),
        ("sop", {"slot_key": "procedures.maintenance"}, "na_slot"),  # 상위 칸 N/A는 하위 칸도 덮는다
        ("sop", {"slot_key": "nope"}, "unknown_slot"),
        ("sop", {"slot_key": "purpose", "wi_part": "instruction"}, "invalid_location"),
        ("wi", {"wi_step": 9, "wi_part": "instruction"}, "unknown_wi_step"),
        ("wi", {"wi_step": 1}, "wi_part_required"),
        ("match", {}, "match_doc_new_target"),
    ],
)
def test_location_rules(client: TestClient, place: str, location: dict, reason: str) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    doc_ids = {"sop": fx.sop_id, "wi": fx.wi_id}
    if place == "match":
        new_doc = _upload_ready(
            client, fx.bundle_id, build_docx(p(STORAGE)), "SYNTHETIC_SOP-M_Match.docx", side="new", doc_type="sop"
        )
        doc_ids["match"] = new_doc["target_doc_id"]

    response = save_group(client, fx.bundle_id, _body([_unit_in(unit)], [_target("t", doc_ids[place], [unit], **location)]))

    assert _reason(response) == reason
    assert response.json()["detail"]["keys"] == ["t"]


def test_language_must_match_source(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    target = _target("t", fx.sop_id, [unit], slot_key="purpose", lang="en", text="Keep synthetic samples at 4 ℃.",
                     change_type="rewritten")

    assert _reason(save_group(client, fx.bundle_id, _body([_unit_in(unit)], [target]))) == "lang_mismatch"


def test_target_kind_follows_source_kind(client: TestClient) -> None:
    fx = _setup(client)
    sentence = find_unit(fx.view, STORAGE)
    figure = next(unit for unit in fx.view["units"] if unit["kind"] == "figure")
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    cases = [
        # 그림은 그림 새 문장으로만, 표·행은 표 새 문장으로만, 문장은 문장 새 문장으로만 간다
        (figure, {"text": "그림 1 합성 장비"}, "kind_mismatch"),
        (sentence, {"kind": "table", "grid": {"rows": 1, "cols": 1}}, "invalid_table_target"),
        (table, {"kind": "figure"}, "invalid_figure_target"),
        (figure, {"kind": "figure", "text": "글자를 바꾼 합성 캡션"}, "invalid_figure_target"),
        (table, {"kind": "table"}, "invalid_table_target"),  # 표 새 문장은 격자가 있어야 한다
    ]

    for unit, fields, reason in cases:
        body = _body([_unit_in(unit)], [_target("t", fx.sop_id, [unit], slot_key="purpose", **fields)])
        assert _reason(save_group(client, fx.bundle_id, body)) == reason, (unit["kind"], fields)


def test_group_rules_reject_without_writing(client: TestClient) -> None:
    fx = _setup(client)
    unit, other = find_unit(fx.view, STORAGE), find_unit(fx.view, RECORDS)
    target = _target("t", fx.sop_id, [unit], slot_key="purpose")
    cases = [
        (_body([], []), "empty"),
        (_body([_unit_in(unit), _unit_in(unit)], [target]), "duplicate_unit"),
        (_body([_unit_in(unit)], [target, {**target}]), "duplicate_key"),
        (_body([_unit_in(unit)], []), "assigned_without_targets"),
        (_body([_unit_in(unit, disposition="delete")], [target]), "disposed_with_targets"),
        (_body([_unit_in(unit, disposition="delete")], []), "reason_required"),
        (_body([_unit_in(unit, disposition="move_external", reason="Synthetic")], []), "move_target_code_required"),
        (_body([_unit_in(unit)], [{**target, "text": " ​ "}]), "empty_text"),
        (_body([_unit_in(unit), _unit_in(other)], [{**target, "source_unit_ids": [unit["id"], other["id"]]}]),
         "empty_text"),  # 여러 출처를 합칠 때는 글자를 직접 쓴다
        (_body([_unit_in(unit)], [{**target, "text": "합성 시료는 냉장 보관한다."}]), "change_type_required"),
        # 글자가 원문과 다른데 "그대로"라고 할 수 없다
        (_body([_unit_in(unit)], [{**target, "text": "합성 시료는 냉장 보관한다.", "change_type": "as_is"}]),
         "invalid_change_type"),
        (_body([_unit_in(unit)], [{**target, "cell_row": 0, "cell_col": 0}]), "invalid_cell_target"),
        (_body([_unit_in(unit)], [{**target, "parent_key": "nope"}]), "invalid_cell_target"),
        (_body([_unit_in(unit)], [{**target, "target_doc_id": None}]), "target_doc_required"),
        (_body([{"unit_id": 999_999, "revision": 1, "disposition": "assigned"}], [target]), "unknown_unit"),
        (_body([_unit_in(unit)], [target], removed_target_ids=[999_999]), "unknown_target"),
    ]

    for body, reason in cases:
        assert _reason(save_group(client, fx.bundle_id, body)) == reason, reason
    cell = next(u for u in fx.view["units"] if u["kind"] == "cell_sentence" and u["group_unit_id"] is not None)
    bound = save_group(client, fx.bundle_id, _body([_unit_in(cell)], [_target("c", fx.sop_id, [cell], slot_key="purpose")]))
    assert _reason(bound) == "bound_cell_sentence"
    page = _list_units(client, fx.bundle_id, limit=1000)
    assert {row["decision"]["revision"] for row in page["items"]} == {1}
    assert _count_rows(TargetSentence, bundle_id=fx.bundle_id) == 0


def test_table_destination_creates_table_and_cell_targets(client: TestClient) -> None:
    fx = _setup(client)
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    cells = [unit for unit in fx.view["units"] if unit["group_unit_id"] == table["id"]]

    group = assign_as_is(client, fx.bundle_id, table, fx.sop_id, slot_key="general_requirements")

    (entry,) = group["units"]
    assert (entry["unit_id"], entry["cell_unit_ids"]) == (table["id"], [cell["id"] for cell in cells])
    (table_target,) = [t for t in group["targets"] if t["kind"] == "table"]
    assert (table_target["grid"], table_target["lang"], table_target["confirmed_text"]) == ({"rows": 2, "cols": 2}, "neutral", "")
    assert (table_target["change_type"], table_target["source_unit_ids"]) == ("as_is", [table["id"]])
    cell_targets = [t for t in group["targets"] if t["parent_target_id"] == table_target["id"]]
    assert len(cell_targets) == len(cells) == 4
    assert [(t["source_unit_ids"], t["confirmed_text"], t["lang"], t["change_type"]) for t in cell_targets] == [
        ([cell["id"]], cell["text"], cell["lang"], "as_is") for cell in cells
    ]
    assert [(t["cell_row"], t["cell_col"]) for t in cell_targets] == [(0, 0), (0, 1), (1, 0), (1, 1)]
    assert {t["group_id"] for t in group["targets"]} == {None}
    rows = {row["unit_id"]: row for row in _list_units(client, fx.bundle_id, limit=1000)["items"]}
    assert {rows[cell["id"]]["status"] for cell in cells} == {"confirmed"}


def test_table_restructure_needs_reason(client: TestClient) -> None:
    fx = _setup(client)
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    first_cell = next(unit for unit in fx.view["units"] if unit["group_unit_id"] == table["id"])
    reshaped = _target("t", fx.sop_id, [table], slot_key="purpose", kind="table", grid={"rows": 3, "cols": 2})
    cell = _target("c", fx.sop_id, [first_cell], slot_key="purpose", parent_key="t", cell_row=0, cell_col=1)

    # 그대로인 표는 원래 격자·칸 자리를 지킨다
    assert _reason(save_group(client, fx.bundle_id, _body([_unit_in(table)], [reshaped]))) == "grid_mismatch"
    as_is = {**reshaped, "grid": {"rows": 2, "cols": 2}}
    assert _reason(save_group(client, fx.bundle_id, _body([_unit_in(table)], [as_is, cell]))) == "cell_position_mismatch"
    restructured = {**reshaped, "change_type": "table_restructured"}
    assert _reason(save_group(client, fx.bundle_id, _body([_unit_in(table)], [restructured, cell]))) == "reason_required"
    response = save_group(
        client, fx.bundle_id, _body([_unit_in(table, reason="Synthetic: added a row")], [restructured, cell])
    )

    assert response.status_code == 200, response.text
    table_target, cell_target = response.json()["targets"]
    assert (table_target["change_type"], table_target["grid"]) == ("table_restructured", {"rows": 3, "cols": 2})
    assert (cell_target["parent_target_id"], cell_target["cell_col"]) == (table_target["id"], 1)


def test_as_is_table_needs_one_cell_target_per_cell_sentence(client: TestClient) -> None:
    """그대로인 표는 묶인 칸 문장마다 칸 새 문장이 정확히 하나다 — 빠진 칸 글이 결과물에 "그대로"로 적힌 채 사라지지 않게(R27).

    표 구성 변경(사유)은 칸을 빼고 담을 수 있다 — test_table_restructure_needs_reason이 칸 하나만 담아 저장한다.
    """
    fx = _setup(client)
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    cells = [unit for unit in fx.view["units"] if unit["group_unit_id"] == table["id"]]
    table_target = _target("t", fx.sop_id, [table], slot_key="purpose", kind="table", grid={"rows": 2, "cols": 2})
    cell_targets = [
        _target(f"c{index}", fx.sop_id, [cell], slot_key="purpose", parent_key="t", cell_row=index // 2, cell_col=index % 2)
        for index, cell in enumerate(cells)
    ]

    def _save(targets: list[dict]) -> httpx2.Response:
        return save_group(client, fx.bundle_id, _body([_unit_in(table)], [table_target, *targets]))

    bare, partial = _save([]), _save(cell_targets[:3])
    doubled = _save([*cell_targets, {**cell_targets[0], "key": "again"}])

    for response, unit_ids in ((bare, [cell["id"] for cell in cells]), (partial, [cells[3]["id"]]), (doubled, [cells[0]["id"]])):
        assert (response.status_code, response.json()["detail"]) == (
            422, {"code": "invalid_group", "reason": "table_cells_missing", "unit_ids": unit_ids},
        )
    assert _count_rows(TargetSentence, bundle_id=fx.bundle_id) == 0
    whole = _save(cell_targets)
    assert whole.status_code == 200, whole.text
    assert sorted(t["change_type"] for t in whole.json()["targets"]) == ["as_is"] * 5


def test_hold_requires_reason_and_sets_on_hold(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    targets = [_target("t", fx.sop_id, [unit], slot_key="responsibilities")]

    missing = save_group(client, fx.bundle_id, _body([_unit_in(unit)], targets, action="hold"))
    response = save_group(
        client, fx.bundle_id, _body([_unit_in(unit)], targets, action="hold", hold_reason="Synthetic: ask the owner")
    )

    assert _reason(missing) == "hold_reason_required"
    assert response.status_code == 200, response.text
    (entry,) = response.json()["units"]
    (target,) = response.json()["targets"]
    assert (entry["decision"]["status"], entry["decision"]["hold_reason"], entry["decision"]["confirmed_by"]) == (
        "on_hold", "Synthetic: ask the owner", None,
    )
    assert (target["status"], target["hold_reason"]) == ("on_hold", "Synthetic: ask the owner")


def _hold_without_destination(
    client: TestClient, fx: Fixture, unit: dict, revision: int = 1, reason: str = NO_DESTINATION
) -> httpx2.Response:
    body = _body([_unit_in(unit, revision, disposition="unassigned")], [], action="hold", hold_reason=reason)
    return save_group(client, fx.bundle_id, body)


def _get_decision(client: TestClient, fx: Fixture, unit: dict) -> dict:
    return get_group_by_unit(client, fx.bundle_id, unit["id"])["units"][0]["decision"]


def test_hold_without_destination_saves_on_hold(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)

    response = _hold_without_destination(client, fx, unit)

    assert response.status_code == 200, response.text
    assert response.json()["targets"] == []
    (entry,) = response.json()["units"]
    decision = entry["decision"]
    assert entry["unit_id"] == unit["id"]
    assert (
        decision["status"], decision["disposition"], decision["hold_reason"], decision["confirmed_by"],
        decision["revision"],
    ) == ("on_hold", "unassigned", NO_DESTINATION, None, 2)
    row = next(row for row in _list_units(client, fx.bundle_id, limit=1000)["items"] if row["unit_id"] == unit["id"])
    assert (row["status"], row["decision"]["disposition"], row["target_ids"]) == ("on_hold", "unassigned", [])


def test_confirm_with_unassigned_is_422(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)

    response = save_group(client, fx.bundle_id, _body([_unit_in(unit, disposition="unassigned")], []))

    assert _reason(response) == "hold_required"
    assert response.json()["detail"]["unit_ids"] == [unit["id"]]
    assert _get_decision(client, fx, unit)["revision"] == 1


def test_hold_without_destination_refuses_targets(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    target = _target("t", fx.sop_id, [unit], slot_key="responsibilities")
    body = _body([_unit_in(unit, disposition="unassigned")], [target], action="hold", hold_reason=NO_DESTINATION)

    response = save_group(client, fx.bundle_id, body)

    assert _reason(response) == "disposed_with_targets"
    assert response.json()["detail"]["unit_ids"] == [unit["id"]]
    assert get_group_by_unit(client, fx.bundle_id, unit["id"])["targets"] == []
    assert _get_decision(client, fx, unit)["revision"] == 1


def test_hold_needs_a_reason(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)

    missing = _hold_without_destination(client, fx, unit, reason="")
    blank = _hold_without_destination(client, fx, unit, reason="  ")

    assert _reason(missing) == "hold_reason_required"
    assert _reason(blank) == "hold_reason_required"
    decision = _get_decision(client, fx, unit)
    assert (decision["status"], decision["revision"]) == ("unassigned", 1)


def test_held_unit_can_be_assigned_later(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    assert _hold_without_destination(client, fx, unit).status_code == 200
    target = _target("t", fx.sop_id, [unit], slot_key="responsibilities")

    response = save_group(client, fx.bundle_id, _body([_unit_in(unit, revision=2)], [target]))

    assert response.status_code == 200, response.text
    decision = response.json()["units"][0]["decision"]
    assert (
        decision["status"], decision["disposition"], decision["hold_reason"], decision["confirmed_by"],
        decision["revision"],
    ) == ("confirmed", "assigned", "", "qa.member", 3)
    (saved,) = response.json()["targets"]
    assert (saved["confirmed_text"], saved["status"]) == (STORAGE, "confirmed")


def test_held_unit_can_be_held_again(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    assert _hold_without_destination(client, fx, unit).status_code == 200

    response = _hold_without_destination(client, fx, unit, revision=2, reason="Synthetic: still waiting")

    assert response.status_code == 200, response.text
    decision = response.json()["units"][0]["decision"]
    assert (decision["status"], decision["hold_reason"], decision["revision"]) == (
        "on_hold", "Synthetic: still waiting", 3,
    )


def test_held_unit_can_be_cleared(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    assert _hold_without_destination(client, fx, unit).status_code == 200

    response = client.post(
        f"/api/bundles/{fx.bundle_id}/decisions/clear", json={"unit_id": unit["id"], "revision": 2}, headers=AUTHOR
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "reset_unit_ids": [unit["id"]], "deleted_target_ids": [], "held_unit_ids": [], "held_target_ids": [],
    }
    decision = _get_decision(client, fx, unit)
    assert (decision["status"], decision["disposition"], decision["hold_reason"], decision["revision"]) == (
        "unassigned", "unassigned", "", 3,
    )


def test_human_target_does_not_inherit_its_change_type(client: TestClient) -> None:
    # 글자 비교 종류는 사람이 고른다(§6.7) — 출처가 바뀌면 지난 종류는 근거가 없으니 다시 고르게 한다
    fx = _setup(client)
    first, second = find_unit(fx.view, STORAGE), find_unit(fx.view, RECORDS)
    saved = save_group(client, fx.bundle_id, _body(
        [_unit_in(first)],
        [_target("t", fx.sop_id, [first], slot_key="purpose", text="합성 시료는 냉장 보관한다.", change_type="tone")],
    ))
    assert saved.status_code == 200, saved.text
    target = saved.json()["targets"][0]

    response = save_group(client, fx.bundle_id, _body(
        [_unit_in(first, 2, "delete", reason="합성 사유"), _unit_in(second)],
        [{
            "key": "t", "id": target["id"], "revision": target["revision"], "slot_key": "purpose",
            "source_unit_ids": [second["id"]],
        }],
    ))

    assert _reason(response) == "change_type_required"


def test_held_unit_can_be_bulk_disposed_by_a_person(client: TestClient) -> None:
    # 보류 → 확정은 사람의 전이다(§6.8). 일괄 처분은 상태가 아니라 새 문장 유무만 막는다
    fx = _setup(client)
    unit = find_unit(fx.view, HEADER_TEXTS[0])
    assert _hold_without_destination(client, fx, unit).status_code == 200
    body = {"action": "delete", "reason": "구조 제목", "units": [{"unit_id": unit["id"], "revision": 2}]}

    response = client.post(f"/api/bundles/{fx.bundle_id}/decisions/bulk", json=body, headers=AUTHOR)

    assert response.status_code == 200, response.text
    decision = response.json()[0]["decision"]
    assert (decision["status"], decision["disposition"], decision["hold_reason"]) == ("confirmed", "delete", "")


def test_held_unit_blocks_review_and_shows_in_output_a(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    before = client.get(f"/api/bundles/{fx.bundle_id}/summary", headers=AUTHOR).json()["ko"]
    assert _hold_without_destination(client, fx, unit).status_code == 200

    readiness = client.get(f"/api/bundles/{fx.bundle_id}/review/readiness", headers=AUTHOR).json()
    rows = client.get(f"/api/bundles/{fx.bundle_id}/outputs/a", params={"lang": "ko"}, headers=AUTHOR).json()
    summary = client.get(f"/api/bundles/{fx.bundle_id}/summary", headers=AUTHOR).json()["ko"]

    assert {"code": "units_on_hold", "lang": "ko", "count": 1} in readiness["blockers"]
    row = next(row for row in rows if row["unit_id"] == unit["id"])
    assert (row["dest_kind"], row["dest_doc_code"], row["status"]) == ("", "", "on_hold")
    # 보낸 곳이 비어 있으니 요약은 미배정으로 센다 — 보류 전과 같은 숫자다
    assert before["assigned"] == 0
    assert (summary["assigned"], summary["unassigned"]) == (before["assigned"], before["unassigned"])


def test_classify_skips_a_person_held_unit(client: TestClient, fake_ai: FakeAi) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    assert _hold_without_destination(client, fx, unit).status_code == 200

    response = client.post(
        f"/api/bundles/{fx.bundle_id}/ai/classify", json={"unit_ids": [unit["id"]]}, headers=AUTHOR
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "queued": 0, "skipped_total": 1, "skipped": [{"unit_id": unit["id"], "reason": "not_unassigned"}],
        "skipped_by_reason": {"not_unassigned": 1},
    }
    assert fake_ai.requests == []


def test_sentence_checks_are_stored(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    target = _target("t", fx.sop_id, [unit], slot_key="responsibilities", text="합성 시료는 8 ℃에서 보관한다.",
                     change_type="rewritten")

    response = save_group(client, fx.bundle_id, _body([_unit_in(unit)], [target]))

    assert response.status_code == 200, response.text
    (saved,) = response.json()["targets"]
    assert saved["warnings"][0]["kind"] == "number_mismatch"
    assert saved["status"] == "confirmed"


def test_text_history_on_edit(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    (target,) = assign_as_is(client, fx.bundle_id, unit, fx.sop_id, slot_key="responsibilities")["targets"]
    edited = {"key": "t", "id": target["id"], "revision": 1, "source_unit_ids": [unit["id"]],
              "slot_key": "responsibilities", "text": "합성 시료는 4 ℃ 냉장고에 보관한다.", "change_type": "rewritten"}

    response = save_group(client, fx.bundle_id, _body([_unit_in(unit, 2)], [edited]))
    # 글자를 그대로 둔 다시 저장은 이력을 남기지 않는다
    again = save_group(client, fx.bundle_id, _body([_unit_in(unit, 3)], [{**edited, "revision": 2}]))

    assert response.status_code == 200, response.text
    assert again.status_code == 200, again.text
    assert response.json()["targets"][0]["confirmed_text"] == "합성 시료는 4 ℃ 냉장고에 보관한다."

    async def _history(session: AsyncSession) -> list[tuple[str, str]]:
        rows = await session.scalars(select(TargetTextHistory).where(TargetTextHistory.target_id == target["id"]))
        return [(row.previous_text, row.changed_by) for row in rows]

    assert run_in_session(_history) == [(STORAGE, "qa.member")]


# ── 일괄 처분·배정 지우기 ──────────────────────────────────────────────────────


def test_bulk_delete_and_move(client: TestClient) -> None:
    fx = _setup(client)
    headers = [find_unit(fx.view, text) for text in HEADER_TEXTS]
    url = f"/api/bundles/{fx.bundle_id}/decisions/bulk"
    body = {"action": "delete", "reason": "구조 제목", "units": [{"unit_id": u["id"], "revision": 1} for u in headers]}

    response = client.post(url, json=body, headers=AUTHOR)

    assert response.status_code == 200, response.text
    assert [(row["unit_id"], row["decision"]["disposition"], row["decision"]["status"], row["decision"]["reason"])
            for row in response.json()] == [(u["id"], "delete", "confirmed", "구조 제목") for u in headers]
    rows = {row["unit_id"]: row for row in _list_units(client, fx.bundle_id, limit=1000)["items"]}
    assert {rows[u["id"]]["status"] for u in headers} == {"confirmed"}

    other = find_unit(fx.view, RECORDS)
    move = {"action": "move_external", "reason": "Synthetic", "units": [{"unit_id": other["id"], "revision": 1}]}
    assert client.post(url, json=move, headers=AUTHOR).status_code == 422
    moved = client.post(url, json={**move, "move_target_code": "SOP-OTHER"}, headers=AUTHOR)
    assert moved.status_code == 200, moved.text
    assert (moved.json()[0]["decision"]["disposition"], moved.json()[0]["decision"]["move_target_code"]) == (
        "move_external", "SOP-OTHER",
    )

    assigned = find_unit(fx.view, STORAGE)
    assign_as_is(client, fx.bundle_id, assigned, fx.sop_id, slot_key="responsibilities")
    loose = find_unit(fx.view, WARM_UP)
    mixed = {**body, "units": [{"unit_id": loose["id"], "revision": 1}, {"unit_id": assigned["id"], "revision": 2}]}
    refused = client.post(url, json=mixed, headers=AUTHOR)
    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "unit_has_targets", "unit_ids": [assigned["id"]]}
    assert get_group_by_unit(client, fx.bundle_id, loose["id"])["units"][0]["decision"]["status"] == "unassigned"


def test_clear_detaches_and_holds_rest_of_group(client: TestClient) -> None:
    fx = _setup(client)
    first, second = find_unit(fx.view, WARM_UP), find_unit(fx.view, RECORDS)
    target = _merge(client, fx, first, second)["targets"][0]
    url = f"/api/bundles/{fx.bundle_id}/decisions/clear"

    response = client.post(url, json={"unit_id": first["id"], "revision": 2}, headers=AUTHOR)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "reset_unit_ids": [first["id"]], "deleted_target_ids": [],
        "held_unit_ids": [second["id"]], "held_target_ids": [target["id"]],
    }
    cleared = get_group_by_unit(client, fx.bundle_id, first["id"])
    assert cleared["targets"] == []
    assert (cleared["units"][0]["decision"]["status"], cleared["units"][0]["decision"]["revision"]) == ("unassigned", 3)
    assert _count_rows(UnitDecisionHistory, unit_id=first["id"]) == 1
    rest = get_group_by_unit(client, fx.bundle_id, second["id"])
    (kept,) = rest["targets"]
    assert (kept["source_unit_ids"], kept["status"], kept["hold_reason"]) == (
        [second["id"]], "on_hold", SYSTEM_HOLD_RELATED_CHANGED,
    )
    assert kept["confirmed_text"] == target["confirmed_text"]
    assert (rest["units"][0]["decision"]["status"], rest["units"][0]["decision"]["hold_reason"]) == (
        "on_hold", SYSTEM_HOLD_RELATED_CHANGED,
    )
    stale = client.post(url, json={"unit_id": first["id"], "revision": 2}, headers=AUTHOR)
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "revision_conflict"


def test_every_old_cover_unit_has_exactly_one_status(client: TestClient) -> None:
    fx = _setup(client)
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    assign_as_is(client, fx.bundle_id, table, fx.sop_id, slot_key="general_requirements")
    _merge(client, fx, find_unit(fx.view, WARM_UP), find_unit(fx.view, RECORDS))
    headers = [find_unit(fx.view, text) for text in HEADER_TEXTS]
    bulk = {"action": "delete", "reason": "구조 제목", "units": [{"unit_id": u["id"], "revision": 1} for u in headers]}
    assert client.post(f"/api/bundles/{fx.bundle_id}/decisions/bulk", json=bulk, headers=AUTHOR).status_code == 200
    figure = next(unit for unit in fx.view["units"] if unit["kind"] == "figure")
    held = save_group(client, fx.bundle_id, _body(
        [_unit_in(figure)], [_target("f", fx.sop_id, [figure], slot_key="purpose", kind="figure")],
        action="hold", hold_reason="Synthetic: check the image",
    ))
    assert held.status_code == 200, held.text

    page = _list_units(client, fx.bundle_id, limit=1000)

    rows = {row["unit_id"]: row for row in page["items"]}
    assert page["total"] == len(rows) == len(fx.view["units"])
    assert all(row["status"] in STATUSES for row in rows.values())
    cells = [row for row in rows.values() if row["group_unit_id"] is not None]
    assert cells and all(row["status"] == rows[row["group_unit_id"]]["status"] for row in cells)
    assert rows[figure["id"]]["status"] == "on_hold"
    assert {row["status"] for row in rows.values()} == {"unassigned", "confirmed", "on_hold"}


def test_document_delete_needs_confirm_when_decided(client: TestClient) -> None:
    fx = _setup(client)
    other = _upload_ready(client, fx.bundle_id, build_docx(p("합성 둘째 문서의 문장이다.")), "SYNTHETIC_OLD-2_Other.docx")
    outside = find_unit(get_view(client, fx.bundle_id, other["id"]), "합성 둘째 문서의 문장이다.")
    inside = find_unit(fx.view, RECORDS)
    target = _merge(client, fx, inside, outside)["targets"][0]
    url = f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}"

    refused = client.delete(url, params={"revision": 1}, headers=AUTHOR)
    deleted = client.delete(url, params={"revision": 1, "confirm": "true"}, headers=AUTHOR)

    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "confirm_required", "unit_ids": [inside["id"]]}
    assert deleted.status_code == 204
    group = get_group_by_unit(client, fx.bundle_id, outside["id"])
    (kept,) = group["targets"]
    assert (kept["id"], kept["source_unit_ids"], kept["status"], kept["hold_reason"]) == (
        target["id"], [outside["id"]], "on_hold", SYSTEM_HOLD_RELATED_CHANGED,
    )
    assert group["units"][0]["decision"]["status"] == "on_hold"


def test_new_doc_target_links_and_detaches(client: TestClient) -> None:
    """입구 2 새 문장(new_doc) — 출처만 붙고 글자는 잠기며, 떼면 지우지 않고 미배정으로, 새 문서를 지우면 함께 지운다."""
    fx = _setup(client)
    new_doc = _upload_ready(
        client, fx.bundle_id, build_docx(p(STORAGE)), "SYNTHETIC_SOP-M_Match.docx", side="new", doc_type="sop"
    )
    new_unit = find_unit(get_view(client, fx.bundle_id, new_doc["id"]), STORAGE)

    async def _seed(session: AsyncSession) -> int:
        target = TargetSentence(
            bundle_id=fx.bundle_id, target_doc_id=new_doc["target_doc_id"], lang="ko", kind="sentence",
            confirmed_text=STORAGE, origin="new_doc", new_unit_id=new_unit["id"], status="unassigned",
        )
        session.add(target)
        await session.commit()
        return target.id

    target_id = run_in_session(_seed)
    old_unit = find_unit(fx.view, STORAGE)
    link = {"key": "n", "id": target_id, "revision": 1, "source_unit_ids": [old_unit["id"]]}

    linked = save_group(client, fx.bundle_id, _body([_unit_in(old_unit)], [link]))
    locked = save_group(client, fx.bundle_id, _body([_unit_in(old_unit, 2)], [{**link, "revision": 2, "text": "바뀐 합성 글"}]))
    cleared = client.post(
        f"/api/bundles/{fx.bundle_id}/decisions/clear", json={"unit_id": old_unit["id"], "revision": 2}, headers=AUTHOR
    )

    assert linked.status_code == 200, linked.text
    (target,) = linked.json()["targets"]
    assert (target["origin"], target["change_type"], target["status"]) == ("new_doc", "as_is", "confirmed")
    assert _reason(locked) == "match_target_locked"
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["deleted_target_ids"] == []
    alone = client.get(f"/api/bundles/{fx.bundle_id}/groups/by-target/{target_id}", headers=AUTHOR).json()
    assert alone["units"] == []
    assert [(t["status"], t["change_type"], t["source_unit_ids"], t["revision"]) for t in alone["targets"]] == [
        ("unassigned", None, [], 3),
    ]

    # 다시 이어 확정한 뒤 새 문서를 지우면 확인을 묻고, 지우면 새 문장이 사라져 옛 단위가 보류된다
    relinked = save_group(client, fx.bundle_id, _body([_unit_in(old_unit, 3)], [{**link, "revision": 3}]))
    assert relinked.status_code == 200, relinked.text
    url = f"/api/bundles/{fx.bundle_id}/documents/{new_doc['id']}"
    refused = client.delete(url, params={"revision": 1}, headers=AUTHOR)
    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "confirm_required", "unit_ids": [new_unit["id"]]}
    assert client.delete(url, params={"revision": 1, "confirm": "true"}, headers=AUTHOR).status_code == 204
    left = get_group_by_unit(client, fx.bundle_id, old_unit["id"])
    assert left["targets"] == []
    assert (left["units"][0]["decision"]["status"], left["units"][0]["decision"]["disposition"]) == ("on_hold", "assigned")


def test_closure_follows_table_cell_target_links(client: TestClient) -> None:
    """입구 2 표 새 문장 P(출처: 옛 표 TU)의 칸 새 문장 C1이 옛 문단 X를 출처로 삼으면 TU·X·P·C1이 한 관계 묶음이다.

    출처 연결만 보면 TU와 P만으로 닫혀 보이지만, 칸 새 문장은 부모 표와 한 묶음이라 반쪽 확정이 된다.
    """
    fx = _setup(client)
    table_body = tbl([["항목", "Item"], ["합성 값", "Synthetic value"]])
    new_doc = _upload_ready(
        client, fx.bundle_id, build_docx(table_body), "SYNTHETIC_SOP-M_Match.docx", side="new", doc_type="sop"
    )
    new_view = get_view(client, fx.bundle_id, new_doc["id"])
    new_table = next(unit for unit in new_view["units"] if unit["kind"] == "table")
    new_cell = next(unit for unit in new_view["units"] if unit["group_unit_id"] == new_table["id"])
    old_table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    paragraph = find_unit(fx.view, RECORDS)

    async def _seed(session: AsyncSession) -> tuple[int, int]:
        common = {"bundle_id": fx.bundle_id, "target_doc_id": new_doc["target_doc_id"], "origin": "new_doc",
                  "status": "unassigned"}
        table = TargetSentence(**common, kind="table", lang="neutral", grid={"rows": 2, "cols": 2},
                               new_unit_id=new_table["id"])
        session.add(table)
        await session.flush()
        cell = TargetSentence(**common, kind="sentence", lang="ko", confirmed_text=RECORDS, parent_target_id=table.id,
                              cell_row=0, cell_col=0, new_unit_id=new_cell["id"])
        session.add(cell)
        await session.flush()
        session.add_all([
            TargetSource(target_id=table.id, unit_id=old_table["id"], seq=0),
            TargetSource(target_id=cell.id, unit_id=paragraph["id"], seq=0),
        ])
        await session.commit()
        return table.id, cell.id

    table_id, cell_id = run_in_session(_seed)
    # 옛 표의 칸 문장은 칸 새 문장으로 가지 않으므로 그대로가 아니다(R27) — 표 구성 변경과 사유로 확정한다
    table_in = {
        "key": "p", "id": table_id, "revision": 1, "kind": "table", "change_type": "table_restructured",
        "source_unit_ids": [old_table["id"]],
    }
    cell_in = {"key": "c1", "id": cell_id, "revision": 1, "parent_key": "p", "source_unit_ids": [paragraph["id"]]}
    restructured = _unit_in(old_table, reason="Synthetic: cells rebuilt in the new document")

    half = save_group(client, fx.bundle_id, _body([restructured], [table_in]))
    whole = save_group(client, fx.bundle_id, _body([restructured, _unit_in(paragraph)], [table_in, cell_in]))

    assert _reason(half) == "not_closed"
    assert half.json()["detail"]["target_ids"] == [cell_id]
    assert half.json()["detail"]["unit_ids"] == [paragraph["id"]]
    assert whole.status_code == 200, whole.text
    assert [(t["id"], t["status"], t["change_type"]) for t in whole.json()["targets"]] == [
        (table_id, "confirmed", "table_restructured"), (cell_id, "confirmed", "as_is"),
    ]
    group = get_group_by_unit(client, fx.bundle_id, old_table["id"])
    expected_group = f"G-{paragraph['display_id']}"
    assert [(u["unit_id"], u["group_id"]) for u in group["units"]] == [
        (paragraph["id"], expected_group), (old_table["id"], expected_group),
    ]


# ── 읽기·권한 ────────────────────────────────────────────────────────────────


def test_units_list_filters_and_pages(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, STORAGE)
    assign_as_is(client, fx.bundle_id, unit, fx.sop_id, slot_key="responsibilities")

    everything = _list_units(client, fx.bundle_id)
    confirmed = _list_units(client, fx.bundle_id, status="confirmed")
    in_sop = _list_units(client, fx.bundle_id, target_doc_id=fx.sop_id)
    english = _list_units(client, fx.bundle_id, lang="en")
    page = _list_units(client, fx.bundle_id, limit=2, offset=1)

    # 옛 문서 하나뿐이라 단위 정렬 키 순서가 view 순서와 같다
    assert [row["unit_id"] for row in everything["items"]] == [u["id"] for u in fx.view["units"]]
    (row,) = confirmed["items"]
    assert (row["unit_id"], row["document_id"], row["display_id"], row["text"]) == (
        unit["id"], fx.doc["id"], unit["display_id"], STORAGE,
    )
    assert (row["decision"]["disposition"], len(row["target_ids"])) == ("assigned", 1)
    assert [r["unit_id"] for r in in_sop["items"]] == [unit["id"]]
    assert english["total"] == len(english["items"]) > 0 and {r["lang"] for r in english["items"]} == {"en"}
    assert page["total"] == everything["total"]
    assert [r["unit_id"] for r in page["items"]] == [r["unit_id"] for r in everything["items"][1:3]]
    too_many = client.get(f"/api/bundles/{fx.bundle_id}/units", params={"limit": 1001}, headers=AUTHOR)
    assert too_many.status_code == 422


def test_units_rows_carry_pair_id(client: TestClient) -> None:
    fx = _setup(client)
    confirmed, suggested = fx.view["pairs"]
    confirm = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}/pairs/{confirmed['id']}/confirm",
        json={"revision": fx.view["document"]["revision"]}, headers=AUTHOR,
    )
    assert confirm.status_code == 200, confirm.text
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert {pair["status"] for pair in view["pairs"]} == {"confirmed", "suggested"}  # 제안·확정 짝 모두

    rows = {row["unit_id"]: row for row in _list_units(client, fx.bundle_id, limit=1000)["items"]}

    # /documents/{id}/view의 units[].pair_id와 같은 뜻이다
    assert {unit_id: row["pair_id"] for unit_id, row in rows.items()} == {unit["id"]: unit["pair_id"] for unit in view["units"]}
    assert {row["pair_id"] for unit_id, row in rows.items() if unit_id in confirmed["unit_ids"]} == {confirmed["id"]}
    assert {row["pair_id"] for unit_id, row in rows.items() if unit_id in suggested["unit_ids"]} == {suggested["id"]}
    unpaired = [row for row in rows.values() if row["pair_id"] is None]
    assert unpaired and find_unit(fx.view, STORAGE)["id"] in {row["unit_id"] for row in unpaired}


def test_reviewer_cannot_save_and_in_review_is_locked(client: TestClient) -> None:
    fx = _setup(client)
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    unit = find_unit(fx.view, STORAGE)
    body = _body([_unit_in(unit)], [_target("t", fx.sop_id, [unit], slot_key="responsibilities")])
    base = f"/api/bundles/{fx.bundle_id}"
    bulk = {"action": "delete", "reason": "Synthetic", "units": [{"unit_id": unit["id"], "revision": 1}]}
    clear = {"unit_id": unit["id"], "revision": 1}

    as_reviewer = [
        save_group(client, fx.bundle_id, body, headers=REVIEWER),
        client.post(f"{base}/decisions/bulk", json=bulk, headers=REVIEWER),
        client.post(f"{base}/decisions/clear", json=clear, headers=REVIEWER),
    ]
    assert {(r.status_code, r.json()["detail"]["code"]) for r in as_reviewer} == {(403, "role_required")}
    # 읽기는 멤버면 누구나
    assert get_group_by_unit(client, fx.bundle_id, unit["id"], headers=REVIEWER)["units"][0]["unit_id"] == unit["id"]
    assert _list_units(client, fx.bundle_id, headers=REVIEWER)["total"] > 0

    update_row(Bundle, fx.bundle_id, status="in_review")
    locked = [
        save_group(client, fx.bundle_id, body),
        client.post(f"{base}/decisions/bulk", json=bulk, headers=AUTHOR),
        client.post(f"{base}/decisions/clear", json=clear, headers=AUTHOR),
    ]
    assert {(r.status_code, r.json()["detail"]["code"]) for r in locked} == {(409, "bundle_not_editable")}
    assert get_group_by_unit(client, fx.bundle_id, unit["id"])["units"][0]["decision"]["status"] == "unassigned"
