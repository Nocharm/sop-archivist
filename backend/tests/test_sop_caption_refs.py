"""표·그림 참조 연결 — 올릴 때 잡은 번호·자리 참조, 나눈 뒤 따라가기, 사람이 다시 잇기·떼기, 종류가 다른 대상 거절."""

import pathlib
from types import SimpleNamespace

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.sop.caption_refs import build_ref_drafts
from scripts.synthetic_sop import build_synthetic_bundle
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import AUTHOR, REVIEWER, create_bundle, find_unit, get_view, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

TABLE_3_CAPTION = "표 3. 운전 조건 (Table 3. Operating conditions)"
TABLE_4_CAPTION = "Table 4: Rotor limits"
FIGURE_5_CAPTION = "그림 5. 로터 장착 (Figure 5. Rotor mounting)"


def _upload_old_7(client: TestClient, tmp_path: pathlib.Path) -> tuple[int, dict]:
    bundle = build_synthetic_bundle(tmp_path)
    old7 = next(doc for doc in bundle.documents if "OLD-7" in doc.path.name)
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = upload(client, bundle_id, old7.path.read_bytes(), old7.path.name)
    assert response.status_code == 201, response.text
    doc = response.json()
    return bundle_id, doc


def _only(items: list[dict]) -> dict:
    assert len(items) == 1, items
    return items[0]


def _table_unit_of(view: dict, caption_text: str) -> int:
    return find_unit(view, caption_text)["group_unit_id"]


def _patch(
    client: TestClient, bundle_id: int, doc_id: int, ref_id: int, body: dict, headers: dict[str, str] = AUTHOR
) -> httpx2.Response:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    return client.patch(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/caption-refs/{ref_id}",
        json={"revision": revision, **body}, headers=headers,
    )


def test_upload_links_numbered_and_place_references(client: TestClient, tmp_path: pathlib.Path) -> None:
    bundle_id, doc = _upload_old_7(client, tmp_path)
    view = get_view(client, bundle_id, doc["id"])

    ref = _only(find_unit(view, "운전 조건은 표 3을 따른다.")["caption_refs"])
    assert (ref["kind"], ref["number"], ref["state"], ref["origin"]) == ("table", 3, "linked", "auto")
    assert ref["target_unit_id"] == _table_unit_of(view, TABLE_3_CAPTION)

    place = _only(find_unit(view, "회전 속도는 아래 표를 따른다.")["caption_refs"])
    assert place["number"] is None and place["kind"] == "table"
    captionless = next(
        unit for unit in view["units"]
        if unit["kind"] == "table" and not any(c["group_unit_id"] == unit["id"] for c in view["units"] if c["kind"] == "caption")
    )
    assert place["target_unit_id"] == captionless["id"]

    missing = _only(find_unit(view, "표 9 참조.")["caption_refs"])
    assert (missing["number"], missing["target_unit_id"], missing["state"]) == (9, None, "linked")

    figure = _only(find_unit(view, "See Figure 5 for the mounting position.")["caption_refs"])
    figure_unit_id = find_unit(view, FIGURE_5_CAPTION)["group_unit_id"]
    assert (figure["kind"], figure["target_unit_id"]) == ("figure", figure_unit_id)

    # 캡션 단위 자기 머리 번호(와 같은 번호의 이중 언어 표기)는 참조가 아니다
    assert find_unit(view, TABLE_3_CAPTION)["caption_refs"] == []
    assert find_unit(view, FIGURE_5_CAPTION)["caption_refs"] == []


def test_ref_follows_the_sentence_through_a_split(client: TestClient) -> None:
    body = p("표 2를 보고 그림 1을 본다.") + p("표 2. 시험 결과")
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = upload(client, bundle_id, build_docx(body), "SYNTHETIC_OLD-1_Split.docx")
    assert response.status_code == 201, response.text
    doc = response.json()
    view = get_view(client, bundle_id, doc["id"])
    unit = find_unit(view, "표 2를 보고 그림 1을 본다.")
    assert sorted(ref["number"] for ref in unit["caption_refs"]) == [1, 2]

    at = view_block_offset(view, unit, "그림")
    result = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}/edits",
        json={"revision": view["document"]["revision"], "confirm": False,
              "op": {"type": "split", "unit_id": unit["id"], "at": at}},
        headers=AUTHOR,
    )
    assert result.status_code == 200, result.text
    after = get_view(client, bundle_id, doc["id"])
    first = next(u for u in after["units"] if u["text"].startswith("표 2를"))
    second = next(u for u in after["units"] if u["text"].startswith("그림 1을"))
    assert [(r["kind"], r["number"]) for r in first["caption_refs"]] == [("table", 2)]
    assert [(r["kind"], r["number"]) for r in second["caption_refs"]] == [("figure", 1)]


def view_block_offset(view: dict, unit: dict, needle: str) -> int:
    block = next(b for b in view["blocks"] if b["id"] == unit["block_id"])
    return block["text"].index(needle)


def test_human_relink_and_detach(client: TestClient, tmp_path: pathlib.Path) -> None:
    bundle_id, doc = _upload_old_7(client, tmp_path)
    view = get_view(client, bundle_id, doc["id"])
    ref = _only(find_unit(view, "운전 조건은 표 3을 따른다.")["caption_refs"])
    table_4 = _table_unit_of(view, TABLE_4_CAPTION)

    relinked = _patch(client, bundle_id, doc["id"], ref["id"], {"target_unit_id": table_4})
    assert relinked.status_code == 200, relinked.text
    body = relinked.json()
    assert body["ref"]["target_unit_id"] == table_4 and body["ref"]["origin"] == "human"
    assert body["document_revision"] == view["document"]["revision"] + 1

    detached = _patch(client, bundle_id, doc["id"], ref["id"], {"state": "detached"})
    assert detached.status_code == 200, detached.text
    after = get_view(client, bundle_id, doc["id"])
    again = _only(find_unit(after, "운전 조건은 표 3을 따른다.")["caption_refs"])
    assert (again["state"], again["origin"], again["target_unit_id"]) == ("detached", "human", table_4)
    assert after["edits"] == {"can_undo": False, "can_redo": False}  # 되돌리기 줄에 서지 않는다


def test_relink_to_wrong_kind_is_rejected(client: TestClient, tmp_path: pathlib.Path) -> None:
    bundle_id, doc = _upload_old_7(client, tmp_path)
    view = get_view(client, bundle_id, doc["id"])
    ref = _only(find_unit(view, "운전 조건은 표 3을 따른다.")["caption_refs"])
    figure_unit = find_unit(view, FIGURE_5_CAPTION)["group_unit_id"]
    sentence = find_unit(view, "표 9 참조.")["id"]

    for target in (figure_unit, sentence, 999_999_999):
        response = _patch(client, bundle_id, doc["id"], ref["id"], {"target_unit_id": target})
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "invalid_caption_ref_target"


def test_missing_ref_is_404_and_reviewer_cannot_edit(client: TestClient, tmp_path: pathlib.Path) -> None:
    bundle_id, doc = _upload_old_7(client, tmp_path)
    view = get_view(client, bundle_id, doc["id"])
    ref = _only(find_unit(view, "운전 조건은 표 3을 따른다.")["caption_refs"])

    missing = _patch(client, bundle_id, doc["id"], 999_999_999, {"state": "detached"})
    assert (missing.status_code, missing.json()["detail"]["code"]) == (404, "caption_ref_not_found")
    denied = _patch(client, bundle_id, doc["id"], ref["id"], {"state": "detached"}, headers=REVIEWER)
    assert (denied.status_code, denied.json()["detail"]["code"]) == (404, "bundle_not_found")  # 멤버가 아니면 묶음이 보이지 않는다


def _setup_table(client: TestClient, body: str) -> tuple[int, dict, dict]:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = upload(client, bundle_id, build_docx(body), "SYNTHETIC_OLD-1_Refs.docx")
    assert response.status_code == 201, response.text
    doc = response.json()
    return bundle_id, doc, get_view(client, bundle_id, doc["id"])


def test_separate_ko_and_en_captions_still_link_to_their_one_table() -> None:
    # 추출기는 묶음마다 캡션 하나만 만들지만 편집으로 언어마다 캡션이 따로 생긴다 — 묶음 수로 세어야 모호하지 않다
    blocks = {1: (0, "운전 조건은 표 3을 따른다. Table 3 applies."), 2: (1, "표 3 운전"), 3: (2, "Table 3 Operation")}

    def unit(unit_id: int, kind: str, spans: list, text: str, **extra: object) -> SimpleNamespace:
        values = {"id": unit_id, "kind": kind, "spans": spans, "text": text, "status": "active", "table_id": None,
                  "group_unit_id": None, "pos_seq": 0, "pos_start": 0} | extra
        return SimpleNamespace(**values)

    units = [
        unit(10, "sentence", [[1, 0, 14]], "운전 조건은 표 3을 따른다."),
        unit(11, "sentence", [[1, 15, 36]], "Table 3 applies."),
        unit(20, "table", [], "", table_id=7, pos_seq=1, pos_start=-1),
        unit(21, "caption", [[2, 0, 7]], "표 3 운전", group_unit_id=20, pos_seq=1),
        unit(22, "caption", [[3, 0, 17]], "Table 3 Operation", group_unit_id=20, pos_seq=2),
    ]
    drafts = build_ref_drafts(blocks, units)
    assert [(d.kind, d.number, d.target_table_id) for d in drafts] == [("table", 3, 7), ("table", 3, 7)]


def test_sentence_attached_as_caption_loses_its_own_head_reference(client: TestClient) -> None:
    bundle_id, doc, view = _setup_table(client, p("표 6 기존", "Caption") + tbl([["합성 칸 하나."]]) + p("Table 5 Test results"))
    sentence = find_unit(view, "Table 5 Test results")
    assert sentence["kind"] == "sentence" and _only(sentence["caption_refs"])["number"] == 5
    table = next(unit for unit in view["units"] if unit["kind"] == "table")

    result = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}/edits",
        json={"revision": view["document"]["revision"], "confirm": False,
              "op": {"type": "attach_caption", "unit_id": sentence["id"], "bundle_unit_id": table["id"]}},
        headers=AUTHOR,
    )
    assert result.status_code == 200, result.text
    after = get_view(client, bundle_id, doc["id"])
    caption = find_unit(after, "Table 5 Test results")
    assert caption["kind"] == "caption"
    assert caption["text"] == "Table 5 Test results" and caption["caption_refs"] == []


def test_ref_to_a_row_split_table_targets_the_first_row(client: TestClient) -> None:
    body = p("표 3. 운전 조건", "Caption") + tbl([["합성 칸 하나."], ["합성 칸 둘."]]) + p("운전 조건은 표 3을 따른다.")
    bundle_id, doc, view = _setup_table(client, body)
    table = next(unit for unit in view["units"] if unit["kind"] == "table")
    result = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}/edits",
        json={"revision": view["document"]["revision"], "confirm": False,
              "op": {"type": "split_table_rows", "table_unit_id": table["id"]}},
        headers=AUTHOR,
    )
    assert result.status_code == 200, result.text
    after = get_view(client, bundle_id, doc["id"])
    first_row = min((u for u in after["units"] if u["kind"] == "table_row"), key=lambda u: u["row_index"])
    ref = _only(find_unit(after, "운전 조건은 표 3을 따른다.")["caption_refs"])
    assert ref["target_unit_id"] == first_row["id"]
