"""SOP 골격 — 값 객체 DocOutline(순서·번호·수준·라벨·줄 세기)과 문서 사본이 생기고 지워지는 때, To-Be 응답의 골격 항목.

기본 표준은 회사 SOP 템플릿 1–9장이다(outline.TEMPLATE_OUTLINE). 새 SOP는 거기에 첫 절차 `procedures.p1`을 더해 받는다.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import OutlineStandardItem
from app.sop.outline import (
    TEMPLATE_OUTLINE,
    TEMPLATE_SUGGESTIONS,
    DocOutline,
    OutlineItemInfo,
    get_parent_key,
    list_emitted_keys,
    load_doc_outlines,
    number_outline,
    seed_outline_standard,
)
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.sop_helpers import (
    AUTHOR,
    NEW_SOP_KEYS,
    assign_as_is,
    build_sop_outline,
    create_bundle,
    declare_outline_item,
    find_unit,
    get_view,
    put_tobe,
    save_group,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

ASSOCIATED = "document_relationships.associated_documents"
OPTIONAL_KEYS = tuple(f"{ASSOCIATED}.{name}" for name in ("form", "visual_aid", "training_material", "quality_risk_assessment"))
# 새 SOP가 내보내는 절 — 비어 있는 선택 항목(7.1.x)은 빠진다
EMITTED_KEYS = [key for key in NEW_SOP_KEYS if key not in OPTIONAL_KEYS]
# 새 SOP 골격의 라벨 — 라벨이 바뀌면 결과물 A·C·Excel의 칸 이름이 바뀐다
NEW_SOP_LABELS = {
    "purpose": "Purpose",
    "scope": "Scope",
    "definitions": "Definitions",
    "responsibilities": "Responsibilities",
    "general_requirements": "General Requirements",
    "procedures": "Procedures",
    "procedures.p1": "Procedures › Procedure 1",
    "document_relationships": "Document Relationships",
    ASSOCIATED: "Document Relationships › Associated Documents",
    f"{ASSOCIATED}.form": "Document Relationships › Associated Documents › Form",
    f"{ASSOCIATED}.visual_aid": "Document Relationships › Associated Documents › Visual Aid",
    f"{ASSOCIATED}.training_material": "Document Relationships › Associated Documents › Training Material",
    f"{ASSOCIATED}.quality_risk_assessment": "Document Relationships › Associated Documents › Quality Risk Assessment",
    "document_relationships.work_instructions": "Document Relationships › Work Instructions",
    "document_relationships.references": "Document Relationships › References",
    "attachments": "Attachments",
    "appendices": "Appendices",
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
    """문서 사본의 키 — 골격 순서(부모 바로 뒤에 하위)."""
    async def _load(session: AsyncSession) -> list[str]:
        outline = (await load_doc_outlines(session, [target_doc_id]))[target_doc_id]
        return [item.key for item in outline.items]

    return run_in_session(_load)


def _get_tobe(client: TestClient, bundle_id: int) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/tobe", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _get_c_doc(client: TestClient, bundle_id: int, code: str) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/outputs/c", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return next(doc for doc in response.json()["docs"] if doc["code"] == code)


# ── 값 객체 ────────────────────────────────────────────────────────────────────


def test_template_outline_is_chapters_one_to_nine() -> None:
    outline = DocOutline(TEMPLATE_OUTLINE)

    assert [(item.key, outline.get_number(item.key)) for item in outline.items if "." not in item.key] == [
        ("purpose", "1"), ("scope", "2"), ("definitions", "3"), ("responsibilities", "4"), ("general_requirements", "5"),
        ("procedures", "6"), ("document_relationships", "7"), ("attachments", "8"), ("appendices", "9"),
    ]
    assert {item.key: item.kind for item in outline.items if item.kind != "general"} == {
        "general_requirements": "category_table", "procedures": "named_children", "document_relationships": "group",
        ASSOCIATED: "group", "document_relationships.work_instructions": "auto_list", "appendices": "named_children",
    }
    # 선택 항목은 7.1.x뿐이고, 번호를 세는 내용은 6장과 부록뿐이다(나머지는 글머리 기호)
    assert [item.key for item in outline.items if not item.is_required] == list(OPTIONAL_KEYS)
    assert [item.key for item in outline.items if item.default_style == "numbered"] == ["procedures", "appendices"]
    assert {item.default_style for item in outline.items} == {"numbered", "bullet"}
    assert next(item for item in outline.items if item.key == "appendices").child_prefix == "Appendix"
    assert set(TEMPLATE_SUGGESTIONS) == {"general_requirements", "procedures"}
    assert TEMPLATE_SUGGESTIONS["general_requirements"][:2] == ("Safety", "Account")
    assert TEMPLATE_SUGGESTIONS["procedures"] == ("Electronic Record Control", "Troubleshooting", "Maintenance")


def test_numbers_follow_order() -> None:
    outline = build_sop_outline()

    assert outline.get_number("purpose") == "1"
    assert outline.get_number("procedures.p1") == "6.1"
    assert outline.get_number(f"{ASSOCIATED}.quality_risk_assessment") == "7.1.4"
    assert outline.get_number("document_relationships.references") == "7.3"
    assert outline.get_number("appendices") == "9"
    assert outline.get_number("no_such_item") is None


def test_only_general_items_count_direct_lines() -> None:
    outline = build_sop_outline([("general_requirements.safety", "Safety")])

    # 범주 표와 하위를 선언하는 항목은 직접 줄을 받되 세지 않는다(머리 글·범주 없는 항목)
    assert [key for key in ("general_requirements", "procedures", "appendices") if outline.counts_lines(key)] == []
    assert all(outline.is_assignable(key) for key in ("general_requirements", "procedures", "appendices"))
    assert outline.counts_lines("procedures.p1") is True
    assert outline.counts_lines("general_requirements.safety") is True  # 줄을 세는 종류지만 범주는 번호가 없어 번호를 받지 않는다
    # 묶음 제목과 자동 목록은 줄을 받지 않는다
    assert [item.key for item in outline.items if not outline.is_assignable(item.key)] == [
        "document_relationships", ASSOCIATED, "document_relationships.work_instructions",
    ]


def test_declared_children_are_numbered_by_their_parents_kind() -> None:
    outline = build_sop_outline([
        ("general_requirements.safety", "Safety"), ("procedures.cleaning", "Cleaning"),
        ("appendices.a1", "Alarm list"), ("appendices.a2", "Rotor table"),
    ])

    # 범주는 번호가 없고, 절차는 "6.n", 부록은 부모 번호 없이 n — 라벨은 "Appendix n. 이름"
    assert outline.get_number("general_requirements.safety") is None
    assert (outline.get_number("procedures.p1"), outline.get_number("procedures.cleaning")) == ("6.1", "6.2")
    assert (outline.get_number("appendices.a1"), outline.get_number("appendices.a2")) == ("1", "2")
    assert outline.get_label("general_requirements.safety") == "General Requirements › Safety"
    assert outline.get_label("procedures.cleaning") == "Procedures › Cleaning"
    assert outline.get_label("appendices.a2") == "Appendix 2. Rotor table"
    # 선언한 항목은 필수이고 기본 표시는 부모의 것이다
    by_key = {item.key: item for item in outline.items}
    assert {key: (by_key[key].default_style, by_key[key].is_required, by_key[key].origin) for key in (
        "general_requirements.safety", "procedures.cleaning", "appendices.a1",
    )} == {
        "general_requirements.safety": ("bullet", True, "declared"),
        "procedures.cleaning": ("numbered", True, "declared"),
        "appendices.a1": ("numbered", True, "declared"),
    }


def test_number_outline_counts_only_emitted_items() -> None:
    outline = build_sop_outline()
    qra = f"{ASSOCIATED}.quality_risk_assessment"

    # 선택 항목은 줄이 있거나 그 항목을 N/A로 둘 때만 내보내고, 남은 항목끼리 센다
    assert list_emitted_keys(outline, (), ()) == set(EMITTED_KEYS)
    numbers = number_outline(outline, list_emitted_keys(outline, {qra}, {f"{ASSOCIATED}.form"}))
    assert (numbers[f"{ASSOCIATED}.form"], numbers[qra]) == ("7.1.1", "7.1.2")
    assert f"{ASSOCIATED}.visual_aid" not in numbers
    assert (numbers["document_relationships.references"], numbers["attachments"]) == ("7.3", "8")
    # 상위 항목의 N/A는 선택 항목을 끌어내지 않는다
    assert list_emitted_keys(outline, (), {"document_relationships"}) == set(EMITTED_KEYS)


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


def test_labels_join_titles_from_the_top() -> None:
    outline = build_sop_outline()

    assert {item.key: outline.get_label(item.key) for item in outline.items} == NEW_SOP_LABELS
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
    # 표준(템플릿)에 첫 절차 "Procedure 1"을 더해 받는다
    assert _load_outline_keys(sop["id"]) == list(NEW_SOP_KEYS)
    items = _get_tobe(client, bundle["id"])["outline_items"]
    assert [(item["code"], item["key"]) for item in items] == [("SOP-1", key) for key in NEW_SOP_KEYS]
    by_key = {item["key"]: item for item in items}
    assert {key: item["label"] for key, item in by_key.items()} == NEW_SOP_LABELS
    assert by_key["procedures"] == {
        "code": "SOP-1", "key": "procedures", "parent_key": None, "level": 0, "number": "6",
        "title_en": "Procedures", "title_ko": "", "label": "Procedures", "kind": "named_children",
        "is_required": True, "default_style": "numbered", "is_assignable": True, "counts_lines": False,
        "shows_number": True, "origin": "standard", "is_removed": False, "deviation_reason": None,
    }
    assert by_key["procedures.p1"] == {
        "code": "SOP-1", "key": "procedures.p1", "parent_key": "procedures", "level": 1, "number": "6.1",
        "title_en": "Procedure 1", "title_ko": "", "label": "Procedures › Procedure 1", "kind": "general",
        "is_required": True, "default_style": "numbered", "is_assignable": True, "counts_lines": True,
        "shows_number": True, "origin": "declared", "is_removed": False, "deviation_reason": None,
    }
    # 번호는 결과물이 내보낼 항목끼리 센 값이다 — 비어 있는 선택 항목(7.1.x)은 번호가 없다
    assert {key: item["number"] for key, item in by_key.items()} == {
        "purpose": "1", "scope": "2", "definitions": "3", "responsibilities": "4", "general_requirements": "5",
        "procedures": "6", "procedures.p1": "6.1", "document_relationships": "7", ASSOCIATED: "7.1",
        **dict.fromkeys(OPTIONAL_KEYS), "document_relationships.work_instructions": "7.2",
        "document_relationships.references": "7.3", "attachments": "8", "appendices": "9",
    }
    assert [key for key, item in by_key.items() if not item["is_assignable"]] == [
        "document_relationships", ASSOCIATED, "document_relationships.work_instructions",
    ]
    assert {item["default_style"] for key, item in by_key.items() if key.split(".")[0] not in ("procedures", "appendices")} == {
        "bullet",
    }


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
    # 옛 첫 절차(p1)는 뺀 표시로 남아 키를 다시 쓰지 않는다 — 새 첫 절차는 다음 수를 받는다
    expected = [key.replace("procedures.p1", "procedures.n1") for key in NEW_SOP_KEYS]
    assert _load_outline_keys(doc_id) == expected
    assert [item["key"] for item in as_sop.json()["outline_items"] if item["code"] == "SOP-2"] == expected


def test_uploaded_sop_doc_gets_outline_copy(client: TestClient) -> None:
    # 입구와 상관없이 SOP는 사본을 갖는다 — 올린 새 문서(입구 2)의 목록 줄도
    bundle = create_bundle(client, is_synthetic=True)

    response = upload(
        client, bundle["id"], build_docx(p("합성 문장이다.")), "SYNTHETIC_SOP-M_Outline.docx", side="new", doc_type="sop"
    )

    assert response.status_code == 201, response.text
    tobe = _get_tobe(client, bundle["id"])
    assert [doc["entrance"] for doc in tobe["docs"]] == ["match"]
    assert _load_outline_keys(tobe["docs"][0]["id"]) == list(NEW_SOP_KEYS)


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
    na_url = f"{sop_url}/na/procedures.p1"

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
            (code, key) for code in sop_codes for key in NEW_SOP_KEYS
        ]


def test_removing_a_doc_removes_its_outline(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    doc_id = put_tobe(client, bundle["id"], [_doc("SOP-1")]).json()["docs"][0]["id"]

    assert put_tobe(client, bundle["id"], []).status_code == 200

    assert _load_outline_keys(doc_id) == []


def test_na_slot_must_be_in_the_docs_outline(client: TestClient) -> None:
    # 새로 만드는 SOP의 N/A 칸은 그 문서가 받을 골격(표준 + 첫 절차)에서, 이미 있는 SOP는 자기 사본에서 본다
    bundle = create_bundle(client, is_synthetic=True)
    na = [{"code": "SOP-1", "slot_key": "procedures.p1", "reason": "Synthetic: not applicable"}]

    created = put_tobe(client, bundle["id"], [_doc("SOP-1")], na_slots=na)
    unknown = put_tobe(client, bundle["id"], [_doc("SOP-1")], na_slots=[{**na[0], "slot_key": "procedures.cleaning"}])

    assert created.status_code == 200, created.text
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["code"] == "unknown_slot"

    # 문서가 선언한 항목은 그 문서의 사본에만 있다
    declare_outline_item(client, created.json()["docs"][0]["id"], "procedures.cleaning", "Cleaning")
    declared = put_tobe(client, bundle["id"], [_doc("SOP-1")], na_slots=[{**na[0], "slot_key": "procedures.cleaning"}])
    assert declared.status_code == 200, declared.text


@pytest.mark.parametrize("group_key", ["document_relationships", ASSOCIATED])
def test_na_on_a_group_item_covers_its_children(client: TestClient, group_key: str) -> None:
    # 줄을 받지 않는 묶음 제목(7·7.1)도 N/A로 둘 수 있고, 상위 칸의 N/A처럼 하위를 덮는다
    bundle = create_bundle(client, is_synthetic=True)
    na = [{"code": "SOP-1", "slot_key": group_key, "reason": "Synthetic: not applicable"}]

    response = put_tobe(client, bundle["id"], [_doc("SOP-1")], na_slots=na)

    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    sections = {section["location_key"]: section for section in _get_c_doc(client, bundle["id"], "SOP-1")["sections"]}
    covered = [key for key in EMITTED_KEYS if key == group_key or key.startswith(f"{group_key}.")]
    assert {key for key, section in sections.items() if section["na_reason"]} == set(covered)
    # 덮인 하위 항목(7.1.1 Form)에는 줄을 놓지 못한다
    (unit,) = _upload_lines(client, bundle["id"], "Keep the synthetic records.")
    body = {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [{"key": "t", "target_doc_id": sop_id, "slot_key": f"{ASSOCIATED}.form", "source_unit_ids": [unit["id"]]}],
    }
    refused = save_group(client, bundle["id"], body)
    assert (refused.status_code, refused.json()["detail"]["reason"]) == (422, "na_slot")


def test_na_is_rejected_on_an_auto_list_item(client: TestClient) -> None:
    # 앱이 채우는 자동 목록(7.2 Work Instructions)은 사람이 N/A로 두지 못한다 — 통째 쓰기도 줄 하나 쓰기도
    bundle = create_bundle(client, is_synthetic=True)
    key = "document_relationships.work_instructions"
    na = [{"code": "SOP-1", "slot_key": key, "reason": "Synthetic: not applicable"}]

    whole = put_tobe(client, bundle["id"], [_doc("SOP-1")], na_slots=na)

    assert whole.status_code == 422
    assert whole.json()["detail"] == {"code": "slot_not_assignable", "doc_code": "SOP-1", "slot_key": key}
    sop_id = put_tobe(client, bundle["id"], [_doc("SOP-1")]).json()["docs"][0]["id"]
    single = client.put(
        f"/api/bundles/{bundle['id']}/tobe/docs/{sop_id}/na/{key}", json={"reason": "Synthetic: not applicable"},
        headers=AUTHOR,
    )
    assert (single.status_code, single.json()["detail"]["code"]) == (422, "slot_not_assignable")
    assert _get_tobe(client, bundle["id"])["na_slots"] == []


def _upload_lines(client: TestClient, bundle_id: int, *lines: str) -> list[dict]:
    doc = upload(client, bundle_id, build_docx("".join(p(line) for line in lines)), "SYNTHETIC_OLD-1_Outline.docx")
    assert doc.status_code == 201, doc.text
    view = get_view(client, bundle_id, doc.json()["id"])
    return [find_unit(view, line) for line in lines]


def test_group_and_auto_list_reject_lines(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    sop_id = put_tobe(client, bundle["id"], [_doc("SOP-1")]).json()["docs"][0]["id"]
    (unit,) = _upload_lines(client, bundle["id"], "Keep the synthetic records.")

    for key in ("document_relationships", ASSOCIATED, "document_relationships.work_instructions"):
        body = {
            "action": "confirm",
            "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
            "targets": [{"key": "t", "target_doc_id": sop_id, "slot_key": key, "source_unit_ids": [unit["id"]]}],
        }

        response = save_group(client, bundle["id"], body)

        assert response.status_code == 422, key
        assert response.json()["detail"] == {"code": "invalid_group", "reason": "slot_not_assignable", "keys": ["t"]}, key
    # 줄을 받는 7.3은 저장된다
    assign_as_is(client, bundle["id"], unit, sop_id, slot_key="document_relationships.references")


def test_auto_list_shows_child_wis(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    docs = [
        {**_doc("SOP-1"), "order_index": 0},
        {**_doc("WI-2", "wi", "SOP-1"), "title": "Synthetic second", "order_index": 1},
        {**_doc("SOP-2"), "order_index": 2},
        {**_doc("WI-1", "wi", "SOP-1"), "title": "Synthetic first", "order_index": 3},
        {**_doc("WI-9", "wi", "SOP-2"), "title": "Synthetic other", "order_index": 4},
    ]
    saved = put_tobe(client, bundle["id"], docs)
    assert saved.status_code == 200, saved.text
    sop_id = next(doc["id"] for doc in saved.json()["docs"] if doc["code"] == "SOP-1")

    sop = _get_c_doc(client, bundle["id"], "SOP-1")
    composed = client.get(f"/api/bundles/{bundle['id']}/outputs/c/docs/{sop_id}", headers=AUTHOR).json()

    # 7.2 절만 그 SOP의 자식 WI를 To-Be 순서로 싣는다(다른 SOP의 WI는 없다)
    for doc in (sop, composed):
        auto_items = {section["location_key"]: section["auto_items"] for section in doc["sections"]}
        assert auto_items.pop("document_relationships.work_instructions") == [
            {"code": "WI-2", "title": "Synthetic second"}, {"code": "WI-1", "title": "Synthetic first"},
        ]
        assert set(map(tuple, auto_items.values())) == {()}
    work_instructions = next(s for s in sop["sections"] if s["location_key"] == "document_relationships.work_instructions")
    assert (work_instructions["number"], work_instructions["kind"], work_instructions["items"]) == ("7.2", "auto_list", [])


def test_only_appendices_hide_their_number_from_the_heading(client: TestClient) -> None:
    # 부록의 라벨("Appendix 1. 이름")에는 번호가 들어 있어 머리에 번호를 따로 적지 않는다(shows_number) — 번호 값은 줄 번호의 머리로 남는다
    bundle = create_bundle(client, is_synthetic=True)
    docs = put_tobe(
        client, bundle["id"], [_doc("SOP-1"), _doc("WI-1", "wi", "SOP-1")],
        wi_steps=[{"code": "WI-1", "step_no": 1, "title": "Synthetic step"}],
    ).json()["docs"]
    ids = {doc["code"]: doc["id"] for doc in docs}
    declare_outline_item(client, ids["SOP-1"], "appendices.a1", "Alarm list")
    declare_outline_item(client, ids["SOP-1"], "general_requirements.safety", "Safety")

    sop, wi = _get_c_doc(client, bundle["id"], "SOP-1"), _get_c_doc(client, bundle["id"], "WI-1")
    composed = client.get(f"/api/bundles/{bundle['id']}/outputs/c/docs/{ids['SOP-1']}", headers=AUTHOR).json()
    items = {item["key"]: item for item in _get_tobe(client, bundle["id"])["outline_items"]}

    for doc in (sop, composed):
        sections = {section["location_key"]: section for section in doc["sections"]}
        assert [key for key, section in sections.items() if not section["shows_number"]] == ["appendices.a1"]
        appendix, procedure = sections["appendices.a1"], sections["procedures.p1"]
        assert (appendix["number"], appendix["label"], appendix["shows_number"]) == ("1", "Appendix 1. Alarm list", False)
        assert (procedure["number"], procedure["label"], procedure["shows_number"]) == (
            "6.1", "Procedures › Procedure 1", True,
        )
    assert {section["shows_number"] for section in wi["sections"]} == {True}
    assert [key for key, item in items.items() if not item["shows_number"]] == ["appendices.a1"]
    assert (items["appendices.a1"]["number"], items["procedures.p1"]["shows_number"]) == ("1", True)
    assert (items["general_requirements.safety"]["number"], items["general_requirements.safety"]["shows_number"]) == (None, True)


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
    assert list(sop) == EMITTED_KEYS
    assert sop["purpose"] == ("general", 0, True, "bullet")
    assert sop["general_requirements"] == ("category_table", 0, False, "bullet")
    assert sop["procedures"] == ("named_children", 0, False, "numbered")
    assert sop["procedures.p1"] == ("general", 1, True, "numbered")
    assert sop[ASSOCIATED] == ("group", 1, False, "bullet")
    assert sop["document_relationships.work_instructions"] == ("auto_list", 1, False, "bullet")
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
    async def _seed_twice(session: AsyncSession) -> list[tuple[str, str, str, list[str]]]:
        await seed_outline_standard(session)
        await seed_outline_standard(session)
        rows = await session.execute(
            select(
                OutlineStandardItem.key, OutlineStandardItem.title_en, OutlineStandardItem.kind,
                OutlineStandardItem.suggestions,
            ).order_by(OutlineStandardItem.order_index)
        )
        return [tuple(row) for row in rows]

    rows = run_in_session(_seed_twice)

    assert [(item.key, item.title_en, item.kind) for item in TEMPLATE_OUTLINE] == [row[:3] for row in rows]
    assert {key: tuple(suggestions) for key, _, _, suggestions in rows if suggestions} == TEMPLATE_SUGGESTIONS


def test_an_na_chapter_hides_the_auto_list_lines(client: TestClient) -> None:
    # 상위 칸(7장)을 N/A로 두면 7.2도 덮인다 — 화면은 사유만 보이므로 응답(과 Excel C)도 자식 WI 줄을 싣지 않는다
    bundle = create_bundle(client, is_synthetic=True)
    docs = [{**_doc("SOP-1"), "order_index": 0}, {**_doc("WI-1", "wi", "SOP-1"), "title": "Synthetic first", "order_index": 1}]
    saved = put_tobe(client, bundle["id"], docs)
    assert saved.status_code == 200, saved.text
    sop_id = next(doc["id"] for doc in saved.json()["docs"] if doc["code"] == "SOP-1")
    marked = client.put(
        f"/api/bundles/{bundle['id']}/tobe/docs/{sop_id}/na/document_relationships", json={"reason": "Synthetic: no related documents"},
        headers=AUTHOR,
    )
    assert marked.status_code == 200, marked.text

    sop = _get_c_doc(client, bundle["id"], "SOP-1")

    work_instructions = next(s for s in sop["sections"] if s["location_key"] == "document_relationships.work_instructions")
    assert work_instructions["na_reason"] == "Synthetic: no related documents"
    assert work_instructions["auto_items"] == []

