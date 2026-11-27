"""원본 보기용 원본 자리 조회(GET …/original-places) — 합성 문서로 Unit 순서·경로·형식을 본다."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.sop.models import DocumentFile, SourceBlock, Unit
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.pdf_factory import build_text_pdf
from tests.sop_helpers import AUTHOR, OUTSIDER, create_bundle, find_unit, get_view, upload

pytestmark = pytest.mark.usefixtures("clean_sop", "legacy_split_rule")

FIRST, SECOND = "합성 장비를 켠다.", "합성 시료를 넣는다."
OLD_BODY = p("1. 목적", "Heading1") + p(FIRST) + p(SECOND) + p("Synthetic records are kept.")


def _upload_docx(client: TestClient) -> tuple[int, dict]:
    bundle = create_bundle(client, is_synthetic=True)
    response = upload(client, bundle["id"], build_docx(OLD_BODY), "SYNTHETIC_OLD-1_Places.docx")
    assert response.status_code == 201, response.text
    return bundle["id"], response.json()


def _places(client: TestClient, bundle_id: int, doc_id: int, headers: dict[str, str] = AUTHOR):
    return client.get(f"/api/bundles/{bundle_id}/documents/{doc_id}/original-places", headers=headers)


def _block_paths(extraction_id: int) -> dict[int, str]:
    async def _load(session):
        from sqlalchemy import select

        rows = await session.execute(select(SourceBlock.id, SourceBlock.xml_path).where(SourceBlock.extraction_id == extraction_id))
        return dict(rows.tuples().all())

    return run_in_session(_load)


def test_places_follow_unit_spans_in_order(client: TestClient) -> None:
    bundle_id, doc = _upload_docx(client)
    view = get_view(client, bundle_id, doc["id"])
    paths = _block_paths(doc["extraction"]["id"])

    response = _places(client, bundle_id, doc["id"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["file_format"] == "docx"
    assert [place["unit_id"] for place in body["places"]] == [unit["id"] for unit in view["units"]]
    for place, unit in zip(body["places"], view["units"], strict=True):
        assert place["blocks"][0]["path"] == paths[unit["spans"][0][0]]


def test_merged_unit_lists_each_block_once(client: TestClient) -> None:
    bundle_id, doc = _upload_docx(client)
    view = get_view(client, bundle_id, doc["id"])
    first, second = find_unit(view, FIRST), find_unit(view, SECOND)
    edit = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}/edits",
        json={"revision": view["document"]["revision"], "confirm": False, "op": {"type": "merge", "unit_ids": [first["id"], second["id"]]}},
        headers=AUTHOR,
    )
    assert edit.status_code == 200, edit.text
    merged_id = edit.json()["created_unit_ids"][0]
    paths = _block_paths(doc["extraction"]["id"])

    places = {place["unit_id"]: place for place in _places(client, bundle_id, doc["id"]).json()["places"]}

    assert [block["path"] for block in places[merged_id]["blocks"]] == [paths[first["spans"][0][0]], paths[second["spans"][0][0]]]
    assert first["id"] not in places and second["id"] not in places


def test_deleted_units_are_left_out(client: TestClient) -> None:
    bundle_id, doc = _upload_docx(client)
    unit = find_unit(get_view(client, bundle_id, doc["id"]), FIRST)
    update_row(Unit, unit["id"], status="retired")

    unit_ids = [place["unit_id"] for place in _places(client, bundle_id, doc["id"]).json()["places"]]

    assert unit["id"] not in unit_ids and unit_ids


def test_pdf_has_format_but_no_places(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = upload(client, bundle["id"], build_text_pdf([["Synthetic PDF line"]]), "SYNTHETIC_SOP-QC-00007.PDF").json()

    body = _places(client, bundle["id"], doc["id"]).json()

    assert (body["file_format"], body["places"]) == ("pdf", [])


def test_document_without_file_is_none(client: TestClient) -> None:
    bundle_id, doc = _upload_docx(client)
    run_in_session(_drop_file(doc["id"]))

    body = _places(client, bundle_id, doc["id"]).json()

    assert (body["file_format"], body["places"]) == ("none", [])


def _drop_file(document_id: int):
    async def _drop(session):
        await session.execute(delete(DocumentFile).where(DocumentFile.document_id == document_id))
        await session.commit()

    return _drop


def test_non_member_is_refused(client: TestClient) -> None:
    bundle_id, doc = _upload_docx(client)

    assert _places(client, bundle_id, doc["id"], OUTSIDER).status_code == 404  # 구성원이 아니면 묶음이 있다는 것도 숨긴다(기존 시험과 같은 코드)


def test_response_has_no_source_text(client: TestClient) -> None:
    bundle_id, doc = _upload_docx(client)
    view = get_view(client, bundle_id, doc["id"])

    raw = json.dumps(_places(client, bundle_id, doc["id"]).json(), ensure_ascii=False)

    assert all(block["text"] not in raw for block in view["blocks"] if len(block["text"]) > 4)


def test_table_and_figure_units_point_at_their_place(client: TestClient) -> None:
    # 표 · 그림 Unit은 범위가 비어 있다 - 표는 표 전체 경로, 그림은 그림 블록 경로로 원본에 칠한다(D9)
    bundle = create_bundle(client, is_synthetic=True)
    body = p("1. 목적", "Heading1") + tbl([["단계", "내용"], ["준비", "켠다."]]) + f"<w:p>{make_drawing_run('image1.png')}</w:p>"
    response = upload(client, bundle["id"], build_docx(body, media={"image1.png": TINY_PNG}), "SYNTHETIC_OLD-2_Places.docx")
    assert response.status_code == 201, response.text
    doc = response.json()
    view = get_view(client, bundle["id"], doc["id"])
    kinds = {unit["id"]: unit["kind"] for unit in view["units"]}

    places = {place["unit_id"]: place["blocks"] for place in _places(client, bundle["id"], doc["id"]).json()["places"]}

    table_ids = [unit_id for unit_id, kind in kinds.items() if kind == "table"]
    figure_ids = [unit_id for unit_id, kind in kinds.items() if kind == "figure"]
    assert table_ids and figure_ids
    assert [block["path"] for block in places[table_ids[0]]] == ["document/body/tbl[1]"]
    assert places[figure_ids[0]][0]["path"].startswith("document/body/p[")
