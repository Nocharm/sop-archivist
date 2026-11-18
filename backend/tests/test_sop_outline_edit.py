"""문서 골격의 선언 항목(6장 절차·9장 부록·5장 범주) — 더하기·이름·순서·빼기 API와 거절, 확정 줄·칸 제목이 따라가는 모양, 권장 이름."""

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import Bundle, TargetDocOutlineItem, TargetSentence, TargetSource, TargetTextHistory
from app.sop.outline import TEMPLATE_SUGGESTIONS
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import p
from tests.sop_helpers import (
    ADMIN,
    AUTHOR,
    REVIEWER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_bundle,
    get_view,
    put_tobe,
    save_group,
    set_members,
)
from tests.test_sop_decision_undo import _ok, _redo, _undo
from tests.test_sop_decisions import _body, _unit_in
from tests.test_sop_numbering import _create_sop_bundle, _read_slot_lines
from tests.test_sop_outline_admin import (
    _get_items,
    _put,
    restore_outline_standard,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
)
from tests.test_sop_slot_heading import _link_headings_recorded, _read_heads
from tests.test_sop_slot_heading import _setup as _setup_headings
from tests.test_sop_tobe import _seed_match_doc

pytestmark = pytest.mark.usefixtures("clean_sop")

SOP = "SOP-P"  # _create_sop_bundle이 만드는 SOP의 번호
HEAD, FIRST, SECOND = "5. Procedure", "Start the synthetic unit.", "Check the synthetic display."
BODY = p(HEAD, "Heading1") + p(FIRST) + p(SECOND)


def _url(bundle_id: int, doc_id: int, key: str = "") -> str:
    return f"/api/bundles/{bundle_id}/tobe/docs/{doc_id}/outline" + (f"/{key}" if key else "")


def _add(
    client: TestClient, bundle_id: int, doc_id: int, parent_key: str, title_en: str, title_ko: str = "",
    headers: dict[str, str] = AUTHOR,
) -> httpx2.Response:
    body = {"parent_key": parent_key, "title_en": title_en, "title_ko": title_ko}
    return client.post(_url(bundle_id, doc_id), json=body, headers=headers)


def _added(client: TestClient, bundle_id: int, doc_id: int, parent_key: str, title_en: str, title_ko: str = "") -> dict:
    """항목을 더하고 응답의 그 항목을 돌려준다."""
    response = _add(client, bundle_id, doc_id, parent_key, title_en, title_ko)
    assert response.status_code == 201, response.text
    return next(item for item in _list_children(response.json(), parent_key) if item["title_en"] == title_en)


def _patch(client: TestClient, bundle_id: int, doc_id: int, key: str, **body: object) -> httpx2.Response:
    return client.patch(_url(bundle_id, doc_id, key), json=body, headers=AUTHOR)


def _remove(client: TestClient, bundle_id: int, doc_id: int, key: str) -> httpx2.Response:
    return client.delete(_url(bundle_id, doc_id, key), headers=AUTHOR)


def _list_children(tobe: dict, parent_key: str) -> list[dict]:
    """To-Be 응답에서 그 부모 바로 아래 항목(골격 순서)."""
    return [item for item in tobe["outline_items"] if item["parent_key"] == parent_key]


def _get_tobe(client: TestClient, bundle_id: int) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/tobe", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _assert_rejected(response: httpx2.Response, status: int, code: str, **context: object) -> None:
    assert response.status_code == status, response.text
    assert response.json()["detail"] == {"code": code, **context}


def _load_targets(target_doc_id: int) -> dict[int, dict]:
    """새 문서의 새 문장 — id → 종류·상태·자리·글·출처(seq 순)·revision."""

    async def _load(session: AsyncSession) -> dict[int, dict]:
        rows = (await session.scalars(select(TargetSentence).where(TargetSentence.target_doc_id == target_doc_id))).all()
        links = (
            await session.execute(
                select(TargetSource.target_id, TargetSource.unit_id)
                .where(TargetSource.target_id.in_([row.id for row in rows]))
                .order_by(TargetSource.seq)
            )
        ).all()
        return {
            row.id: {
                "kind": row.kind, "status": row.status, "slot_key": row.slot_key, "text": row.confirmed_text,
                "order_index": row.order_index, "confirmed_by": row.confirmed_by, "revision": row.revision,
                "sources": [unit_id for target_id, unit_id in links if target_id == row.id],
            }
            for row in rows
        }

    return run_in_session(_load)


def _load_text_history(target_id: int) -> list[str]:
    async def _load(session: AsyncSession) -> list[str]:
        rows = await session.scalars(
            select(TargetTextHistory.previous_text)
            .where(TargetTextHistory.target_id == target_id)
            .order_by(TargetTextHistory.id)
        )
        return list(rows)

    return run_in_session(_load)


def _link_heading(client: TestClient, bundle_id: int, sop_id: int, unit: dict, slot_key: str) -> int:
    """옛 제목 하나를 그 칸의 칸 제목에 이어 확정하고 칸 제목 새 문장의 id를 돌려준다."""
    target = {"key": "h", "kind": "slot_heading", "target_doc_id": sop_id, "slot_key": slot_key, "source_unit_ids": [unit["id"]]}
    response = save_group(client, bundle_id, _body([_unit_in(unit)], [target]))
    assert response.status_code == 200, response.text
    (heading_id,) = [key for key, row in _load_targets(sop_id).items() if (row["kind"], row["slot_key"]) == ("slot_heading", slot_key)]
    return heading_id


# ── 더하기 ────────────────────────────────────────────────────────────────────


def test_add_procedure_gets_next_number(client: TestClient) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    before = _get_tobe(client, bundle_id)
    assert [(item["key"], item["number"], item["title_en"]) for item in _list_children(before, "procedures")] == [
        ("procedures.p1", "6.1", "Procedure 1"),
    ]

    response = _add(client, bundle_id, sop_id, "procedures", "  Cleaning  ", "세척")

    assert response.status_code == 201, response.text
    after = response.json()
    assert after["revision"] == before["revision"] + 1
    first, added = _list_children(after, "procedures")
    assert (first["key"], first["number"]) == ("procedures.p1", "6.1")
    assert added == {
        "code": SOP, "key": "procedures.n1", "parent_key": "procedures", "level": 1, "number": "6.2",
        "title_en": "Cleaning", "title_ko": "세척", "label": "Procedures › Cleaning", "kind": "general",
        "is_required": True, "default_style": "numbered", "is_assignable": True, "counts_lines": True,
        "shows_number": True, "origin": "declared", "is_removed": False, "deviation_reason": None,
    }
    # 목록의 다른 한 줄 쓰기와 같은 기록이다 — 문서를 만든 저장과 이 더하기
    events = client.get(f"/api/bundles/{bundle_id}/events", headers=AUTHOR).json()
    assert [(e["action"], e["target_type"], e["target_ids"]) for e in events if e["action"].startswith("tobe.")] == [
        ("tobe.update", "target_doc", [sop_id]),
    ] * 2
    # 더한 절차는 곧바로 줄을 받는다
    view = get_view(client, bundle_id, _doc_id)
    assign_as_is(client, bundle_id, find_unit(view, FIRST), sop_id, slot_key="procedures.n1")
    assert _read_slot_lines(client, bundle_id, "procedures.n1") == [(FIRST, "6.2.1", "numbered")]


def test_add_category_from_suggestion(client: TestClient) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    suggestion = _get_tobe(client, bundle_id)["outline_suggestions"]["general_requirements"][0]

    category = _added(client, bundle_id, sop_id, "general_requirements", suggestion)

    assert suggestion == "Safety"
    # 범주는 번호 없는 제목이고 그 줄은 글머리 기호다
    assert (category["key"], category["number"], category["label"], category["default_style"], category["is_assignable"]) == (
        "general_requirements.n1", None, "General Requirements › Safety", "bullet", True,
    )


def test_add_appendix_label(client: TestClient) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)

    first = _added(client, bundle_id, sop_id, "appendices", "Alarm list")
    second = _added(client, bundle_id, sop_id, "appendices", "Rotor table")

    assert (first["key"], first["number"], first["label"], first["shows_number"]) == (
        "appendices.n1", "1", "Appendix 1. Alarm list", False,
    )
    assert (second["number"], second["label"]) == ("2", "Appendix 2. Rotor table")


@pytest.mark.parametrize("parent_key", ["purpose", "document_relationships", "procedures.p1", "no_such_item"])
def test_parent_must_be_declarable(client: TestClient, parent_key: str) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    before = _get_tobe(client, bundle_id)

    response = _add(client, bundle_id, sop_id, parent_key, "Synthetic item")

    _assert_rejected(response, 422, "outline_parent_not_declarable", doc_code=SOP, parent_key=parent_key)
    assert _get_tobe(client, bundle_id) == before


def test_wi_has_no_outline_to_declare(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    saved = put_tobe(client, bundle_id, [
        {"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None},
        {"code": "WI-01", "title": "Synthetic WI", "doc_type": "wi", "parent_code": "SOP-NEW"},
    ])
    wi_id = next(doc["id"] for doc in saved.json()["docs"] if doc["code"] == "WI-01")

    added = _add(client, bundle_id, wi_id, "procedures", "Synthetic item")
    patched = _patch(client, bundle_id, wi_id, "procedures.p1", title_en="Synthetic item")
    removed = _remove(client, bundle_id, wi_id, "procedures.p1")

    _assert_rejected(added, 422, "outline_parent_not_declarable", doc_code="WI-01", parent_key="procedures")
    for response in (patched, removed):
        _assert_rejected(response, 422, "outline_parent_not_declarable", doc_code="WI-01", key="procedures.p1")


@pytest.mark.parametrize(
    "body",
    [
        {"parent_key": "procedures", "title_en": "   "},
        {"parent_key": "procedures", "title_en": "x" * 201},
        {"parent_key": "procedures", "title_en": "Synthetic", "title_ko": "가" * 201},
        {"parent_key": "procedures", "title_en": "Synthetic\x00"},
        {"title_en": "Synthetic"},
    ],
    ids=["blank_title", "long_title", "long_korean_title", "nul", "no_parent"],
)
def test_add_rejects_malformed_fields(client: TestClient, body: dict) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)

    response = client.post(_url(bundle_id, sop_id), json=body, headers=AUTHOR)

    assert response.status_code == 422, response.text
    assert isinstance(response.json()["detail"], list)  # 입력 형식 오류 모양


def test_outline_writes_need_an_author_and_an_editable_bundle(client: TestClient) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    assert set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200

    for response in (
        _add(client, bundle_id, sop_id, "procedures", "Synthetic item", headers=REVIEWER),
        client.patch(_url(bundle_id, sop_id, "procedures.p1"), json={"title_en": "Synthetic"}, headers=REVIEWER),
        client.delete(_url(bundle_id, sop_id, "procedures.p1"), headers=REVIEWER),
    ):
        assert (response.status_code, response.json()["detail"]["code"]) == (403, "role_required")
    _assert_rejected(_add(client, bundle_id, sop_id + 1000, "procedures", "Synthetic item"), 404, "target_doc_not_found",
                     target_doc_id=sop_id + 1000)
    update_row(Bundle, bundle_id, status="in_review")
    for response in (
        _add(client, bundle_id, sop_id, "procedures", "Synthetic item"),
        _patch(client, bundle_id, sop_id, "procedures.p1", title_en="Synthetic"),
        _remove(client, bundle_id, sop_id, "procedures.p1"),
    ):
        assert (response.status_code, response.json()["detail"]["code"]) == (409, "bundle_not_editable")


# ── 빼기 ──────────────────────────────────────────────────────────────────────


def test_remove_blocked_by_lines(client: TestClient) -> None:
    bundle_id, sop_id, doc_id = _create_sop_bundle(client, BODY)
    view = get_view(client, bundle_id, doc_id)
    lined = _added(client, bundle_id, sop_id, "procedures", "Cleaning")["key"]
    headed = _added(client, bundle_id, sop_id, "procedures", "Operation")["key"]
    assign_as_is(client, bundle_id, find_unit(view, FIRST), sop_id, slot_key=lined)
    _link_heading(client, bundle_id, sop_id, find_unit(view, HEAD), headed)  # 칸 제목만 있는 항목도 막힌다
    before = _get_tobe(client, bundle_id)

    for key in (lined, headed):
        response = _remove(client, bundle_id, sop_id, key)

        _assert_rejected(response, 409, "slot_has_targets", slots=[{"doc_code": SOP, "slot_key": key}])
    assert _get_tobe(client, bundle_id) == before


def test_remove_drops_the_item_and_its_na(client: TestClient) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    _added(client, bundle_id, sop_id, "procedures", "Cleaning")
    base = f"/api/bundles/{bundle_id}/tobe/docs/{sop_id}/na"
    assert client.put(f"{base}/procedures.p1", json={"reason": "Synthetic: unused"}, headers=AUTHOR).status_code == 200
    revision = get_bundle(client, bundle_id)["revision"]

    response = _remove(client, bundle_id, sop_id, "procedures.p1")  # 새 SOP에 저절로 있는 첫 절차도 뺄 수 있다

    assert response.status_code == 200, response.text
    after = response.json()
    assert after["revision"] == revision + 1
    assert after["na_slots"] == []
    # 남은 절차가 6.1이 된다
    assert [(item["key"], item["number"]) for item in _list_children(after, "procedures")] == [("procedures.n1", "6.1")]
    _assert_rejected(_remove(client, bundle_id, sop_id, "procedures.p1"), 404, "outline_item_not_found",
                     doc_code=SOP, key="procedures.p1")


def test_removed_number_is_not_reused(client: TestClient) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    keys = [_added(client, bundle_id, sop_id, "procedures", title)["key"] for title in ("Cleaning", "Operation")]
    assert keys == ["procedures.n1", "procedures.n2"]
    assert _remove(client, bundle_id, sop_id, "procedures.n2").status_code == 200

    again = _added(client, bundle_id, sop_id, "procedures", "Operation")  # 뺀 항목의 이름은 다시 쓸 수 있다

    assert again["key"] == "procedures.n3"
    assert [item["key"] for item in _list_children(_get_tobe(client, bundle_id), "procedures")] == [
        "procedures.p1", "procedures.n1", "procedures.n3",
    ]
    # 다른 부모는 따로 센다
    assert _added(client, bundle_id, sop_id, "appendices", "Alarm list")["key"] == "appendices.n1"


def test_retyped_doc_does_not_reuse_declared_keys(client: TestClient) -> None:
    # Arrange — 절차를 선언한 SOP를 WI로 바꿨다가 다시 SOP로(문장이 없어 종류를 바꿀 수 있다)
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    parent = {"code": "SOP-A", "title": "Synthetic parent", "doc_type": "sop", "parent_code": None}
    sop = {"code": "SOP-B", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}
    saved = put_tobe(client, bundle_id, [parent, sop])
    sop_id = next(doc["id"] for doc in saved.json()["docs"] if doc["code"] == "SOP-B")
    assert _added(client, bundle_id, sop_id, "procedures", "Cleaning")["key"] == "procedures.n1"
    assert put_tobe(client, bundle_id, [parent, {**sop, "doc_type": "wi", "parent_code": "SOP-A"}]).status_code == 200
    assert put_tobe(client, bundle_id, [parent, sop]).status_code == 200

    # Act
    added = _added(client, bundle_id, sop_id, "procedures", "Calibration")

    # Assert — 옛 선언 키(n1, 기본 p1)는 뺀 표시로 남아 다시 쓰이지 않는다: 새 첫 절차가 n2, 더한 것이 n3
    assert added["key"] == "procedures.n3"
    children = [item for item in _list_children(_get_tobe(client, bundle_id), "procedures") if item["code"] == "SOP-B"]
    assert [(item["key"], item["title_en"]) for item in children] == [
        ("procedures.n2", "Procedure 1"), ("procedures.n3", "Calibration"),
    ]


def test_uploaded_sop_has_no_outline_to_declare(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    match_id = _seed_match_doc(bundle_id, "UP-SOP", "sop")

    added = _add(client, bundle_id, match_id, "procedures", "Synthetic item")

    _assert_rejected(added, 422, "outline_parent_not_declarable", doc_code="UP-SOP", parent_key="procedures")


# ── 이름·순서 ─────────────────────────────────────────────────────────────────


def test_rename_and_reorder_keep_confirmed_lines(client: TestClient) -> None:
    bundle_id, sop_id, doc_id = _create_sop_bundle(client, BODY)
    view = get_view(client, bundle_id, doc_id)
    _added(client, bundle_id, sop_id, "procedures", "Cleaning")
    for text in (FIRST, SECOND):
        assign_as_is(client, bundle_id, find_unit(view, text), sop_id, slot_key="procedures.p1")
    heading_id = _link_heading(client, bundle_id, sop_id, find_unit(view, HEAD), "procedures.p1")
    before = _load_targets(sop_id)
    assert before[heading_id]["text"] == "Procedures › Procedure 1"
    assert _read_slot_lines(client, bundle_id, "procedures.p1") == [(FIRST, "6.1.1", "numbered"), (SECOND, "6.1.2", "numbered")]
    revision = get_bundle(client, bundle_id)["revision"]

    response = _patch(client, bundle_id, sop_id, "procedures.p1", title_en="Operation", title_ko="운전", position=1)

    assert response.status_code == 200, response.text
    tobe = response.json()
    assert tobe["revision"] == revision + 1
    # 키는 그대로이고 번호만 순서를 따른다
    assert [(i["key"], i["number"], i["title_en"], i["title_ko"]) for i in _list_children(tobe, "procedures")] == [
        ("procedures.n1", "6.1", "Cleaning", ""), ("procedures.p1", "6.2", "Operation", "운전"),
    ]
    after = _load_targets(sop_id)
    lines = [key for key in before if key != heading_id]
    assert len(lines) == 2
    # 확정 줄은 상태·출처 연결·자리·글·revision까지 그대로다
    assert {key: after[key] for key in lines} == {key: before[key] for key in lines}
    assert {after[key]["status"] for key in lines} == {"confirmed"}
    assert _read_slot_lines(client, bundle_id, "procedures.p1") == [(FIRST, "6.2.1", "numbered"), (SECOND, "6.2.2", "numbered")]
    # 칸 제목은 글만 새 이름을 따르고(낡은 저장을 막게 revision이 오른다) 출처·상태는 그대로다
    assert after[heading_id] == {
        **before[heading_id], "text": "Procedures › Operation", "revision": before[heading_id]["revision"] + 1,
    }
    assert _load_text_history(heading_id) == ["Procedures › Procedure 1"]


def test_reordering_appendices_renumbers_their_slot_headings(client: TestClient) -> None:
    bundle_id, sop_id, doc_id = _create_sop_bundle(client, BODY)
    alarm = _added(client, bundle_id, sop_id, "appendices", "Alarm list")["key"]
    rotor = _added(client, bundle_id, sop_id, "appendices", "Rotor table")["key"]
    spare = _added(client, bundle_id, sop_id, "appendices", "Spare parts")["key"]
    heading_id = _link_heading(client, bundle_id, sop_id, find_unit(get_view(client, bundle_id, doc_id), HEAD), rotor)
    assert _load_targets(sop_id)[heading_id]["text"] == "Appendix 2. Rotor table"

    moved = _patch(client, bundle_id, sop_id, alarm, position=99)  # 형제 수를 넘는 자리는 끝이다

    assert moved.status_code == 200, moved.text
    assert [(item["key"], item["label"]) for item in _list_children(moved.json(), "appendices")] == [
        (rotor, "Appendix 1. Rotor table"), (spare, "Appendix 2. Spare parts"), (alarm, "Appendix 3. Alarm list"),
    ]
    assert _load_targets(sop_id)[heading_id]["text"] == "Appendix 1. Rotor table"

    # 앞의 부록을 빼도 뒤 부록의 번호가 당겨지고 칸 제목 글이 따라간다
    assert _patch(client, bundle_id, sop_id, rotor, position=1).status_code == 200
    assert _load_targets(sop_id)[heading_id]["text"] == "Appendix 2. Rotor table"
    assert _remove(client, bundle_id, sop_id, spare).status_code == 200
    assert _load_targets(sop_id)[heading_id]["text"] == "Appendix 1. Rotor table"


def test_patch_that_changes_nothing_keeps_the_revision(client: TestClient) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    _added(client, bundle_id, sop_id, "procedures", "Cleaning")
    before = _get_tobe(client, bundle_id)

    for body in ({}, {"title_en": "Procedure 1", "title_ko": "", "position": 0}):
        response = _patch(client, bundle_id, sop_id, "procedures.p1", **body)

        assert response.status_code == 200, response.text
        assert response.json() == before


def test_standard_item_cannot_be_renamed_or_removed_yet(client: TestClient) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    before = _get_tobe(client, bundle_id)

    for key in ("purpose", "procedures", "document_relationships.references"):
        for response in (
            _patch(client, bundle_id, sop_id, key, title_en="Synthetic title"),
            _patch(client, bundle_id, sop_id, key, position=0),
            _remove(client, bundle_id, sop_id, key),
        ):
            _assert_rejected(response, 422, "outline_standard_item", doc_code=SOP, key=key)
    for response in (
        _patch(client, bundle_id, sop_id, "procedures.n9", title_en="Synthetic title"),
        _remove(client, bundle_id, sop_id, "procedures.n9"),
    ):
        _assert_rejected(response, 404, "outline_item_not_found", doc_code=SOP, key="procedures.n9")
    assert _get_tobe(client, bundle_id) == before


def test_duplicate_title_is_rejected(client: TestClient) -> None:
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    key = _added(client, bundle_id, sop_id, "procedures", "Cleaning")["key"]

    again = _add(client, bundle_id, sop_id, "procedures", "  cleaning ")
    renamed = _patch(client, bundle_id, sop_id, "procedures.p1", title_en="CLEANING")

    for response in (again, renamed):
        _assert_rejected(response, 422, "duplicate_outline_title", doc_code=SOP, parent_key="procedures")
    # 자기 이름의 대소문자만 바꾸는 것과 다른 부모 아래 같은 이름은 된다
    assert _patch(client, bundle_id, sop_id, key, title_en="cleaning").status_code == 200
    assert _add(client, bundle_id, sop_id, "appendices", "Cleaning").status_code == 201


# ── 권장 이름 ─────────────────────────────────────────────────────────────────


@pytest.mark.usefixtures("restore_outline_standard")
def test_outline_suggestions_follow_the_standard(client: TestClient) -> None:
    bundle_id, _sop_id, _doc_id = _create_sop_bundle(client, BODY)

    assert _get_tobe(client, bundle_id)["outline_suggestions"] == {
        key: list(names) for key, names in TEMPLATE_SUGGESTIONS.items()
    }

    changes = {"general_requirements": ["Synthetic category"], "procedures": [], "purpose": ["Synthetic ignored"]}
    items = [{**item, "suggestions": changes.get(item["key"], item["suggestions"])} for item in _get_items(client)]
    assert _put(client, items, headers=ADMIN).status_code == 200

    # 지금 표준을 따른다 — 권장 이름이 없는 항목과 하위를 선언하지 않는 항목(purpose)은 싣지 않는다
    assert _get_tobe(client, bundle_id)["outline_suggestions"] == {"general_requirements": ["Synthetic category"]}


# ── 되돌리기 ──────────────────────────────────────────────────────────────────


def test_redo_refused_when_the_slot_heading_item_was_renamed(client: TestClient) -> None:
    """칸 제목을 이은 저장을 되돌린 뒤 그 절차의 이름을 바꾸면, 다시 하기가 옛 이름의 칸 제목을 되살리지 않는다."""
    fx = _setup_headings(client)
    _link_headings_recorded(client, fx, fx.old1)
    _ok(_undo(client, fx.bundle_id))
    assert _patch(client, fx.bundle_id, fx.sop_id, "procedures.p1", title_en="Operation").status_code == 200

    response = _redo(client, fx.bundle_id)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "undo_conflict"
    assert _read_heads(fx.sop_id) == {}


def test_removed_item_keeps_a_retired_row(client: TestClient) -> None:
    """뺀 선언 항목은 행을 지우지 않고 뺀 표시로 남긴다 — 그 키를 다시 쓰지 않는 근거다."""
    bundle_id, sop_id, _doc_id = _create_sop_bundle(client, BODY)
    key = _added(client, bundle_id, sop_id, "procedures", "Cleaning")["key"]
    assert _remove(client, bundle_id, sop_id, key).status_code == 200


    async def _load(session: AsyncSession) -> list[tuple[str, bool]]:
        rows = await session.execute(
            select(TargetDocOutlineItem.key, TargetDocOutlineItem.is_removed).where(
                TargetDocOutlineItem.target_doc_id == sop_id, TargetDocOutlineItem.key.like("procedures.%")
            )
        )
        return sorted((key, is_removed) for key, is_removed in rows)

    assert run_in_session(_load) == [("procedures.n1", True), ("procedures.p1", False)]
