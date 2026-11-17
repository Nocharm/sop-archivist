"""SOP 골격 — 값 객체 DocOutline(순서·번호·수준·라벨·줄 세기)과 문서 사본이 생기고 지워지는 때, To-Be 응답의 골격 항목."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import SLOT_KEYS
from app.sop.models import OutlineStandardItem, TargetDocOutlineItem
from app.sop.outline import (
    LEGACY_OUTLINE,
    DocOutline,
    OutlineItemInfo,
    get_parent_key,
    seed_outline_standard,
)
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, assign_as_is, create_bundle, find_unit, get_view, put_tobe, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

# 골격으로 옮기기 전 output_labels.SLOT_LABELS의 글 그대로 — 라벨이 바뀌면 결과물 A·C·Excel의 칸 이름이 바뀐다
LEGACY_LABELS = {
    "purpose": "Purpose",
    "scope": "Scope",
    "definitions": "Definitions",
    "responsibilities": "Responsibilities",
    "general_requirements": "General Requirements",
    "general_requirements.safety": "General Requirements › Safety",
    "general_requirements.operation": "General Requirements › Operation",
    "procedures": "Procedures",
    "procedures.procedure": "Procedures › Procedure",
    "procedures.electronic_record_control": "Procedures › Electronic Record Control",
    "procedures.troubleshooting": "Procedures › Troubleshooting",
    "procedures.maintenance": "Procedures › Maintenance",
    "document_relationships": "Document Relationships",
    "document_relationships.attachments": "Document Relationships › Attachments",
    "document_relationships.appendices": "Document Relationships › Appendices",
}


def _item(key: str, order_index: int, *, kind: str = "general", is_removed: bool = False) -> OutlineItemInfo:
    return OutlineItemInfo(
        key=key, title_en=key.rpartition(".")[2].upper(), title_ko="", kind=kind, is_required=True,
        default_style="numbered", child_prefix="", order_index=order_index, origin="standard", is_removed=is_removed,
        deviation_reason=None,
    )


def _doc(code: str, doc_type: str = "sop", parent: str | None = None) -> dict:
    return {"code": code, "title": "", "doc_type": doc_type, "parent_code": parent}


def _load_outline_keys(target_doc_id: int) -> list[str]:
    async def _load(session: AsyncSession) -> list[str]:
        rows = await session.scalars(
            select(TargetDocOutlineItem.key)
            .where(TargetDocOutlineItem.target_doc_id == target_doc_id)
            .order_by(TargetDocOutlineItem.order_index)
        )
        return list(rows)

    return run_in_session(_load)


def _get_tobe(client: TestClient, bundle_id: int) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/tobe", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


# ── 값 객체 ────────────────────────────────────────────────────────────────────


def test_legacy_outline_matches_slot_keys() -> None:
    assert [item.key for item in DocOutline(LEGACY_OUTLINE).items] == list(SLOT_KEYS)


def test_numbers_follow_order() -> None:
    outline = DocOutline(LEGACY_OUTLINE)

    assert outline.get_number("purpose") == "1"
    assert outline.get_number("procedures.troubleshooting") == "6.3"
    assert outline.get_number("document_relationships.appendices") == "7.2"
    assert outline.get_number("no_such_item") is None


def test_named_children_do_not_count_direct_lines() -> None:
    outline = DocOutline(LEGACY_OUTLINE)

    assert outline.counts_lines("procedures") is False
    assert outline.counts_lines("procedures.procedure") is True
    # 세지 않아도 직접 줄은 받는다(머리 글)
    assert all(outline.is_assignable(key) for key in SLOT_KEYS)
    assert [item.key for item in outline.items if item.kind == "named_children"] == [
        "general_requirements", "procedures", "document_relationships",
    ]


def test_three_levels() -> None:
    outline = DocOutline([_item("a", 0), _item("a.b", 1), _item("a.b.c", 2)])

    assert outline.get_level("a.b.c") == 2
    assert outline.is_within("a.b.c", "a") is True
    assert outline.is_within("a", "a") is True
    assert outline.is_within("ab", "a") is False
    assert get_parent_key("a.b.c") == "a.b"
    assert get_parent_key("a") is None
    assert outline.get_number("a.b.c") == "1.1.1"
    assert outline.get_label("a.b.c") == "A › B › C"
    assert [item.key for item in outline.list_children("a")] == ["a.b"]
    assert [item.key for item in outline.list_children(None)] == ["a"]


def test_labels_match_the_former_slot_labels() -> None:
    outline = DocOutline(LEGACY_OUTLINE)

    assert {key: outline.get_label(key) for key in SLOT_KEYS} == LEGACY_LABELS
    assert outline.get_label("no_such_item") == "no_such_item"  # 골격에 없는 키는 키 그대로


def test_items_are_ordered_by_hierarchy_and_skip_removed() -> None:
    # 순서 값이 섞여 있어도 하위는 부모 바로 뒤에 오고, 뺀 항목과 그 하위는 빠지며 번호는 남은 항목끼리 센다
    outline = DocOutline([
        _item("b", 5), _item("a.y", 1), _item("a", 3), _item("a.x", 9), _item("c", 4, is_removed=True), _item("c.z", 0),
        _item("d", 7),
    ])

    assert [item.key for item in outline.items] == ["a", "a.y", "a.x", "b", "d"]
    assert [outline.get_number(item.key) for item in outline.items] == ["1", "1.1", "1.2", "2", "3"]
    assert outline.find("c") is None and outline.find("c.z") is None


# ── 문서 사본 ──────────────────────────────────────────────────────────────────


def test_new_sop_doc_gets_outline_copy(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)

    response = put_tobe(client, bundle["id"], [_doc("SOP-1")])

    assert response.status_code == 200, response.text
    sop = response.json()["docs"][0]
    assert _load_outline_keys(sop["id"]) == list(SLOT_KEYS)
    # 응답의 골격 항목은 지금까지의 고정 번호·순서·라벨 그대로다
    items = _get_tobe(client, bundle["id"])["outline_items"]
    assert [(item["code"], item["key"]) for item in items] == [("SOP-1", key) for key in SLOT_KEYS]
    by_key = {item["key"]: item for item in items}
    assert {key: item["label"] for key, item in by_key.items()} == LEGACY_LABELS
    assert by_key["procedures"] == {
        "code": "SOP-1", "key": "procedures", "parent_key": None, "level": 0, "number": "6",
        "title_en": "Procedures", "title_ko": "", "label": "Procedures", "kind": "named_children",
        "is_required": True, "default_style": "numbered", "is_assignable": True, "counts_lines": False,
        "origin": "standard", "is_removed": False, "deviation_reason": None,
    }
    troubleshooting = by_key["procedures.troubleshooting"]
    assert (troubleshooting["number"], troubleshooting["level"], troubleshooting["counts_lines"]) == ("6.3", 1, True)
    assert (troubleshooting["parent_key"], troubleshooting["title_en"], troubleshooting["kind"]) == (
        "procedures", "Troubleshooting", "general",
    )


def test_wi_doc_has_no_outline(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)

    response = put_tobe(client, bundle["id"], [_doc("SOP-1"), _doc("WI-1", "wi", "SOP-1")])

    assert response.status_code == 200, response.text
    wi = next(doc for doc in response.json()["docs"] if doc["code"] == "WI-1")
    assert _load_outline_keys(wi["id"]) == []
    assert {item["code"] for item in response.json()["outline_items"]} == {"SOP-1"}


def test_doc_type_change_drops_and_recopies_outline(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    docs = put_tobe(client, bundle["id"], [_doc("SOP-1"), _doc("SOP-2")]).json()["docs"]
    doc_id = next(doc["id"] for doc in docs if doc["code"] == "SOP-2")
    url = f"/api/bundles/{bundle['id']}/tobe/docs/{doc_id}"

    as_wi = client.patch(url, json={"doc_type": "wi", "parent_code": "SOP-1"}, headers=AUTHOR)

    assert as_wi.status_code == 200, as_wi.text
    assert _load_outline_keys(doc_id) == []
    assert {item["code"] for item in as_wi.json()["outline_items"]} == {"SOP-1"}

    as_sop = client.patch(url, json={"doc_type": "sop"}, headers=AUTHOR)

    assert as_sop.status_code == 200, as_sop.text
    assert _load_outline_keys(doc_id) == list(SLOT_KEYS)
    assert [item["key"] for item in as_sop.json()["outline_items"] if item["code"] == "SOP-2"] == list(SLOT_KEYS)


def test_uploaded_sop_doc_gets_outline_copy(client: TestClient) -> None:
    # 입구와 상관없이 SOP는 사본을 갖는다 — 올린 새 문서(입구 2)의 목록 줄도
    bundle = create_bundle(client, is_synthetic=True)

    response = upload(
        client, bundle["id"], build_docx(p("합성 문장이다.")), "SYNTHETIC_SOP-M_Outline.docx", side="new", doc_type="sop"
    )

    assert response.status_code == 201, response.text
    tobe = _get_tobe(client, bundle["id"])
    assert [doc["entrance"] for doc in tobe["docs"]] == ["match"]
    assert _load_outline_keys(tobe["docs"][0]["id"]) == list(SLOT_KEYS)


def test_every_tobe_response_carries_outline_items(client: TestClient) -> None:
    # 화면은 To-Be 응답마다 목록을 통째로 바꿔 쓴다 — 줄 하나를 고친 응답에서 골격이 빠지면 칸이 사라진다
    bundle = create_bundle(client, is_synthetic=True)
    base = f"/api/bundles/{bundle['id']}/tobe"
    assert _get_tobe(client, bundle["id"])["outline_items"] == []  # SOP가 없으면 빈 목록

    uploaded = upload(
        client, bundle["id"], build_docx(p("합성 문장이다.")), "SYNTHETIC_SOP-M_Outline.docx", side="new", doc_type="sop"
    )
    assert uploaded.status_code == 201, uploaded.text
    put = put_tobe(client, bundle["id"], [_doc("SOP-1"), _doc("WI-1", "wi", "SOP-1")])
    assert put.status_code == 200, put.text
    ids = {doc["code"]: doc["id"] for doc in put.json()["docs"]}
    sop_url, wi_url = f"{base}/docs/{ids['SOP-1']}", f"{base}/docs/{ids['WI-1']}"
    na_url = f"{sop_url}/na/procedures.maintenance"

    added_doc = client.post(f"{base}/docs", json={"code": "SOP-2", "doc_type": "sop"}, headers=AUTHOR)
    assert added_doc.status_code == 201, added_doc.text
    sop_2_id = next(doc["id"] for doc in added_doc.json()["docs"] if doc["code"] == "SOP-2")
    responses = [
        put,
        added_doc,
        client.patch(sop_url, json={"title": "Synthetic title"}, headers=AUTHOR),
        client.put(na_url, json={"reason": "Synthetic: not applicable"}, headers=AUTHOR),
        client.delete(na_url, headers=AUTHOR),
        client.post(f"{wi_url}/steps", json={"title": "Synthetic step"}, headers=AUTHOR),
        client.patch(f"{wi_url}/steps/1", json={"title": "Synthetic step renamed"}, headers=AUTHOR),
        client.delete(f"{wi_url}/steps/1", headers=AUTHOR),
        client.delete(f"{base}/docs/{sop_2_id}", headers=AUTHOR),
        client.get(base, headers=AUTHOR),
    ]

    for response in responses:
        assert response.status_code in (200, 201), response.text
        body = response.json()
        # 문서 순서로 문서마다 모이고 그 안은 골격 순서 — 올린 새 문서(입구 2)의 SOP도 실리고 WI는 없다
        sop_codes = [doc["code"] for doc in body["docs"] if doc["doc_type"] == "sop"]
        assert "SOP-1" in sop_codes
        assert [doc["entrance"] for doc in body["docs"] if doc["doc_type"] == "sop"].count("match") == 1
        assert [(item["code"], item["key"]) for item in body["outline_items"]] == [
            (code, key) for code in sop_codes for key in SLOT_KEYS
        ]


def test_removing_a_doc_removes_its_outline(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    doc_id = put_tobe(client, bundle["id"], [_doc("SOP-1")]).json()["docs"][0]["id"]

    assert put_tobe(client, bundle["id"], []).status_code == 200

    assert _load_outline_keys(doc_id) == []


def test_na_slot_must_be_in_the_docs_outline(client: TestClient) -> None:
    # 새로 만드는 SOP의 N/A 칸은 지금 표준에서, 이미 있는 SOP는 자기 사본에서 본다
    bundle = create_bundle(client, is_synthetic=True)
    na = [{"code": "SOP-1", "slot_key": "procedures.maintenance", "reason": "Synthetic: not applicable"}]

    created = put_tobe(client, bundle["id"], [_doc("SOP-1")], na_slots=na)
    unknown = put_tobe(client, bundle["id"], [_doc("SOP-1")], na_slots=[{**na[0], "slot_key": "procedures.cleaning"}])

    assert created.status_code == 200, created.text
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["code"] == "unknown_slot"


def _read_section_fields(doc: dict) -> dict[str, tuple[str | None, int, bool, str]]:
    return {
        section["location_key"]: (section["kind"], section["level"], section["counts_lines"], section["default_style"])
        for section in doc["sections"]
    }


def test_output_sections_carry_outline_fields(client: TestClient) -> None:
    # 결과물 C와 새 문서 미리 보기의 칸이 같은 값을 싣는다 — SOP는 골격 항목의 것, 골격 항목이 아닌 칸(WI 단계·단계 없는 WI·절 경로)은
    # 종류 없음·수준 0에 줄을 세는 칸이다(counts_lines가 거짓이면 화면이 깊이 한도를 푼다)
    old_line = "Wipe the synthetic bench."
    bundle = create_bundle(client, is_synthetic=True)
    docs = put_tobe(
        client, bundle["id"], [_doc("SOP-1"), _doc("WI-1", "wi", "SOP-1"), _doc("WI-2", "wi", "SOP-1")],
        wi_steps=[{"code": "WI-1", "step_no": 1, "title": "Synthetic step"}],
    ).json()["docs"]
    uploaded = upload(
        client, bundle["id"], build_docx(p("합성 문장이다.")), "SYNTHETIC_SOP-M_Outline.docx", side="new", doc_type="sop"
    )
    assert uploaded.status_code == 201, uploaded.text
    old_doc = upload(client, bundle["id"], build_docx(p(old_line)), "SYNTHETIC_OLD-1_Outline.docx")
    assert old_doc.status_code == 201, old_doc.text
    unit = find_unit(get_view(client, bundle["id"], old_doc.json()["id"]), old_line)
    unstepped_wi_id = next(doc["id"] for doc in docs if doc["code"] == "WI-2")
    assign_as_is(client, bundle["id"], unit, unstepped_wi_id, wi_part="instruction")

    output = client.get(f"/api/bundles/{bundle['id']}/outputs/c", headers=AUTHOR).json()

    by_code = {doc["code"]: _read_section_fields(doc) for doc in output["docs"]}
    sop = by_code["SOP-1"]
    assert list(sop) == list(SLOT_KEYS)
    assert sop["purpose"] == ("general", 0, True, "numbered")
    assert sop["procedures"] == ("named_children", 0, False, "numbered")
    assert sop["procedures.troubleshooting"] == ("general", 1, True, "numbered")
    assert by_code["WI-1"] == {
        "step:1:instruction": (None, 0, True, "numbered"), "step:1:why": (None, 0, True, "numbered"),
    }
    assert by_code["WI-2"] == {"unstepped:instruction": (None, 0, True, "numbered")}
    (match_code,) = [doc["code"] for doc in output["docs"] if doc["entrance"] == "match"]
    match_sections = by_code[match_code]
    assert match_sections and all(key.startswith("path:") for key in match_sections)
    assert set(match_sections.values()) == {(None, 0, True, "numbered")}
    # 줄을 세는 칸이어도 번호 없는 칸(단계 없는 WI·절 경로)의 줄은 지금처럼 번호가 없다
    numberless = [
        (section["number"], item["number"])
        for doc in output["docs"] if doc["code"] in ("WI-2", match_code)
        for section in doc["sections"]
        for item in section["items"]
    ]
    assert numberless and set(numberless) == {(None, None)}
    for doc in docs:
        composed = client.get(f"/api/bundles/{bundle['id']}/outputs/c/docs/{doc['id']}", headers=AUTHOR)
        assert composed.status_code == 200, composed.text
        assert _read_section_fields(composed.json()) == by_code[doc["code"]]


def test_seed_outline_standard_fills_only_an_empty_table() -> None:
    async def _seed_twice(session: AsyncSession) -> list[tuple[str, str, str]]:
        await seed_outline_standard(session)
        await seed_outline_standard(session)
        rows = await session.execute(
            select(OutlineStandardItem.key, OutlineStandardItem.title_en, OutlineStandardItem.kind)
            .order_by(OutlineStandardItem.order_index)
        )
        return [tuple(row) for row in rows]

    rows = run_in_session(_seed_twice)

    assert [key for key, _, _ in rows] == list(SLOT_KEYS)
    assert [(item.key, item.title_en, item.kind) for item in LEGACY_OUTLINE] == rows
