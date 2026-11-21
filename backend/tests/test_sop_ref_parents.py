"""참조로 찾은 상위(B13) — 상위를 고르지 않은 WI는 올린 New SOP의 확정 참조 줄 번호로 상위를 찾는다. 직접 정한 상위가 이기고,
여러 SOP가 참조하면 모두의 자식이며, 상위 하나만 받는 곳(결과물 C 머리 · 순서)은 번호 순 첫 SOP를 쓴다.

올린 SOP의 결과물 C는 골격이 아니라 파일의 절을 따라 7.2 자동 목록이 없다 — 7.2 · 채움 검사가 실효 상위를 읽는 것은
TargetDocInfo 단위 시험이 본다(참조 줄은 파일의 References 절에 이미 있다)."""

import pytest
from fastapi.testclient import TestClient

from app.sop.outline import DocOutline
from app.sop.refs import normalize_ref_code
from app.sop.snapshot import TargetDocInfo
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, create_bundle, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

WI_CODE = "WI-SYN-0101"


def _sop_body(code: str, ref_line: str) -> bytes:
    return build_docx(
        p("1. Purpose", "Heading1") + p(f"This synthetic procedure {code} covers tank cleaning.")
        + p("7. References", "Heading1") + p(ref_line)
    )


def _upload_new(client: TestClient, bundle_id: int, file_name: str, data: bytes, doc_type: str, parent_code: str | None = None) -> None:
    response = upload(client, bundle_id, data, file_name, side="new", doc_type=doc_type, parent_code=parent_code)
    assert response.status_code == 201, response.text


def _get_docs(client: TestClient, bundle_id: int) -> dict[str, dict]:
    response = client.get(f"/api/bundles/{bundle_id}/tobe", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return {doc["code"]: doc for doc in response.json()["docs"]}


def _get_c_docs(client: TestClient, bundle_id: int) -> dict[str, dict]:
    response = client.get(f"/api/bundles/{bundle_id}/outputs/c", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return {doc["code"]: doc for doc in response.json()["docs"]}


@pytest.mark.parametrize(
    "code", ["WI-SYN-0101", "wi-syn-0101", "WI SYN 0101", "WI–SYN–0101", " WI-SYN - 0101 "],
)
def test_normalize_ref_code_ignores_case_spaces_and_hyphen_variants(code: str) -> None:
    assert normalize_ref_code(code) == "WISYN0101"


def _info(parent_id: int | None, ref_parent_ids: tuple[int, ...]) -> TargetDocInfo:
    return TargetDocInfo(
        id=9, code=WI_CODE, title="", doc_type="wi", parent_id=parent_id, entrance="assign", is_equipment_sop=False,
        order_index=0, manual_order=False, na_slots={}, steps=(), outline=DocOutline(()), ref_parent_ids=ref_parent_ids,
    )


@pytest.mark.parametrize(
    ("parent_id", "ref_parent_ids", "expected"),
    [(None, (), ()), (None, (3, 1), (3, 1)), (5, (), (5,)), (5, (3, 1), (5,))],
    ids=["none", "references", "direct", "direct_wins"],
)
def test_effective_parents_prefer_the_direct_parent(
    parent_id: int | None, ref_parent_ids: tuple[int, ...], expected: tuple[int, ...]
) -> None:
    info = _info(parent_id, ref_parent_ids)

    assert (info.effective_parent_ids, info.effective_parent_id) == (expected, next(iter(expected), None))


def _setup(client: TestClient, *sops: tuple[str, str]) -> int:
    """New SOP 파일(번호, 참조 줄)을 올리고, 상위를 고르지 않은 New WI를 함께 올린다."""
    bundle = create_bundle(client, is_synthetic=True)
    for code, ref_line in sops:
        _upload_new(client, bundle["id"], f"SYNTHETIC_{code}_Tank.docx", _sop_body(code, ref_line), "sop")
    _upload_new(client, bundle["id"], f"SYNTHETIC_{WI_CODE}_Tank_cleaning.docx", build_docx(p("Synthetic WI step.")), "wi")
    return bundle["id"]


def test_a_wi_without_a_parent_is_found_under_the_sop_that_references_it(client: TestClient) -> None:
    bundle_id = _setup(client, ("SOP-SYN-0100", f"{WI_CODE} Tank cleaning"), ("SOP-SYN-0200", "WI-SYN-0999 Other"))

    docs = _get_docs(client, bundle_id)
    c_docs = _get_c_docs(client, bundle_id)

    assert (docs[WI_CODE]["parent_code"], docs[WI_CODE]["ref_parent_codes"]) == (None, ["SOP-SYN-0100"])
    assert docs["SOP-SYN-0100"]["ref_parent_codes"] == []
    # 결과물 C의 머리와 순서도 그 SOP 아래
    assert c_docs[WI_CODE]["parent_code"] == "SOP-SYN-0100"
    assert list(c_docs) == ["SOP-SYN-0100", WI_CODE, "SOP-SYN-0200"]


def test_several_referencing_sops_all_list_the_wi_and_the_first_code_is_the_single_parent(client: TestClient) -> None:
    bundle_id = _setup(client, ("SOP-SYN-0300", f"{WI_CODE} Tank cleaning"), ("SOP-SYN-0100", f"{WI_CODE} Tank cleaning"))

    docs = _get_docs(client, bundle_id)
    c_docs = _get_c_docs(client, bundle_id)

    assert docs[WI_CODE]["ref_parent_codes"] == ["SOP-SYN-0100", "SOP-SYN-0300"]
    assert c_docs[WI_CODE]["parent_code"] == "SOP-SYN-0100"


def test_a_direct_parent_wins_over_references(client: TestClient) -> None:
    bundle_id = _setup(client, ("SOP-SYN-0100", f"{WI_CODE} Tank cleaning"), ("SOP-SYN-0200", "WI-SYN-0999 Other"))
    wi_id = _get_docs(client, bundle_id)[WI_CODE]["id"]

    moved = client.patch(f"/api/bundles/{bundle_id}/tobe/docs/{wi_id}", json={"parent_code": "SOP-SYN-0200"}, headers=AUTHOR)

    assert moved.status_code == 200, moved.text
    wi = next(doc for doc in moved.json()["docs"] if doc["code"] == WI_CODE)
    assert (wi["parent_code"], wi["ref_parent_codes"]) == ("SOP-SYN-0200", [])
    c_docs = _get_c_docs(client, bundle_id)
    assert c_docs[WI_CODE]["parent_code"] == "SOP-SYN-0200"
    assert list(c_docs) == ["SOP-SYN-0100", "SOP-SYN-0200", WI_CODE]


def test_a_line_that_is_no_longer_a_reference_stops_linking(client: TestClient) -> None:
    bundle_id = _setup(client, ("SOP-SYN-0100", f"{WI_CODE} Tank cleaning"))
    sop_doc = next(
        doc for doc in client.get(f"/api/bundles/{bundle_id}/documents", headers=AUTHOR).json()
        if doc["doc_code"] == "SOP-SYN-0100"
    )
    view = client.get(f"/api/bundles/{bundle_id}/documents/{sop_doc['id']}/view", headers=AUTHOR).json()
    ref_unit = next(unit for unit in view["units"] if unit["text"] == f"{WI_CODE} Tank cleaning")

    cleared = client.post(
        f"/api/bundles/{bundle_id}/documents/{sop_doc['id']}/edits",
        json={"revision": view["document"]["revision"], "confirm": False, "op": {"type": "clear_ref", "unit_id": ref_unit["id"]}},
        headers=AUTHOR,
    )

    assert cleared.status_code == 200, cleared.text
    assert _get_docs(client, bundle_id)[WI_CODE]["ref_parent_codes"] == []
