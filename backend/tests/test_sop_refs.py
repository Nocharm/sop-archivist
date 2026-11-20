"""참조 줄(REF) — 번호 영역 제안, 사람의 확인·참조 아님, 되돌리기, 그 번호의 EQUIS 표시, 짝·숫자 검사에서 빠지기.

번호·이름은 모두 합성이다. 웹훅은 `test_equis_api`의 가짜를 쓴다.
"""

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.equis.service import REF_LOOKUPS_PER_READ
from app.sop.refs import build_ref_text, check_ref_text, find_leading_number, read_number_in_text
from tests.docx_factory import build_docx, p
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
from tests.test_equis_api import FakeEquis, equis, make_row  # noqa: F401 -- equis는 픽스처

# 지도 · REF 제안의 길은 글에서 제안하던 옛 추출에서 본다 — 새 추출의 Reference 절 확정은 test_sop_ref_section.py
pytestmark = pytest.mark.usefixtures("clean_sop", "legacy_ref_proposals")

OLD_NUMBER, NUMBER = "SOP-ABC-1016", "SOP-ABC-00001"
NAME = "Operation and Maintenance of UV spectrophotometer"
REF_LINE = f"{OLD_NUMBER} Operation of UV spectrophotometer"
PROSE = f"세부 사항은 {OLD_NUMBER}을 따른다."
PROSE_EN = f"Follow {OLD_NUMBER} for details."
HEADING = "참고 문서"
# 제목, 참조 줄, 그리고 번호를 글 가운데에 가진 한/영 짝 한 쌍
BODY = p(HEADING, "Heading1") + p(REF_LINE) + p(PROSE) + p(PROSE_EN)
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]


class Setup:
    def __init__(self, client: TestClient) -> None:
        self.client = client
        bundle = create_bundle(client, is_synthetic=True)
        self.bundle_id: int = bundle["id"]
        response = put_tobe(client, self.bundle_id, TOBE_DOCS)
        assert response.status_code == 200, response.text
        self.sop_id: int = response.json()["docs"][0]["id"]
        uploaded = upload(client, self.bundle_id, build_docx(BODY), "SYNTHETIC_OLD-1_Refs.docx")
        assert uploaded.status_code == 201, uploaded.text
        self.doc_id: int = uploaded.json()["id"]

    def view(self) -> dict:
        return get_view(self.client, self.bundle_id, self.doc_id)

    def unit(self, text: str) -> dict:
        return find_unit(self.view(), text)

    def edit(self, op: dict) -> httpx2.Response:
        body = {"revision": self.view()["document"]["revision"], "confirm": False, "op": op}
        return self.client.post(f"/api/bundles/{self.bundle_id}/documents/{self.doc_id}/edits", json=body, headers=AUTHOR)

    def set_ref(self, text: str, number: str) -> httpx2.Response:
        return self.edit({"type": "set_ref", "unit_id": self.unit(text)["id"], "number": number})

    def clear_ref(self, text: str) -> httpx2.Response:
        return self.edit({"type": "clear_ref", "unit_id": self.unit(text)["id"]})

    def step(self, action: str) -> httpx2.Response:
        body = {"revision": self.view()["document"]["revision"], "confirm": False}
        return self.client.post(
            f"/api/bundles/{self.bundle_id}/documents/{self.doc_id}/edits/{action}", json=body, headers=AUTHOR
        )

    def detail(self, text: str, headers: dict[str, str] = AUTHOR) -> dict:
        unit_id = self.unit(text)["id"]
        response = self.client.get(
            f"/api/bundles/{self.bundle_id}/documents/{self.doc_id}/units/{unit_id}/ref", headers=headers
        )
        assert response.status_code == 200, response.text
        return response.json()


# --- 번호 찾기(순수 함수) ---


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (REF_LINE, OLD_NUMBER),
        ("- WI-04 Synthetic cleaning", "WI-04"),
        ("3) SOP-ABC-00001 Synthetic", "SOP-ABC-00001"),
        ("5.1 SOP-QA-204, Synthetic", "SOP-QA-204"),
        (PROSE, None),
        ("Synthetic text only", None),
        ("SOP-ABC-1016A is not a number", None),
    ],
)
def test_find_leading_number(text: str, expected: str | None) -> None:
    assert find_leading_number(text) == expected


def test_read_number_in_text_only_accepts_what_the_text_holds() -> None:
    assert read_number_in_text(PROSE, " sop-abc-1016 ") == OLD_NUMBER
    assert read_number_in_text(PROSE, NUMBER) is None
    assert read_number_in_text(PROSE, "") is None
    assert read_number_in_text("see ';drop", "';drop") is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # 번호로 시작하는 줄 — 번호와 이름을 모두 맞춘다
        (REF_LINE, f"{NUMBER} {NAME}"),
        (f"- {OLD_NUMBER}, Operation of UV spectrophotometer.", f"- {NUMBER}, {NAME}."),
        (f"3) {OLD_NUMBER} - UV operation;", f"3) {NUMBER} - {NAME};"),
        # 이름 없이 번호만 있는 줄 — 번호만 바꾼다
        (OLD_NUMBER, NUMBER),
        # 번호가 문장 가운데 — 문장은 두고 번호만 바꾼다
        (PROSE, f"세부 사항은 {NUMBER}을 따른다."),
        # 이미 같다
        (f"{NUMBER} {NAME}", None),
    ],
)
def test_build_ref_text(text: str, expected: str | None) -> None:
    number = NUMBER if text.startswith(NUMBER) else OLD_NUMBER
    assert build_ref_text(text, number, NUMBER, NAME) == expected


def test_build_ref_text_without_a_current_number_suggests_nothing() -> None:
    assert build_ref_text(REF_LINE, OLD_NUMBER, "", NAME) is None
    assert build_ref_text(REF_LINE, "SOP-ZZZ-1", NUMBER, NAME) is None


# --- 제안과 확인 ---


def test_view_proposes_lines_that_start_with_a_number(client: TestClient) -> None:
    fx = Setup(client)

    assert fx.unit(REF_LINE)["ref"] == {"state": "proposed", "number": OLD_NUMBER}
    assert fx.unit(PROSE)["ref"] is None
    assert fx.unit(HEADING)["ref"] is None


def test_set_ref_makes_the_unit_a_reference_and_undo_brings_the_proposal_back(client: TestClient) -> None:
    fx = Setup(client)

    result = fx.set_ref(REF_LINE, OLD_NUMBER)

    assert result.status_code == 200, result.text
    assert result.json()["document_revision"] == 2
    unit = fx.unit(REF_LINE)
    assert (unit["lang"], unit["ref"]) == ("ref", {"state": "confirmed", "number": OLD_NUMBER})

    assert fx.step("undo").status_code == 200
    undone = fx.unit(REF_LINE)
    assert (undone["lang"], undone["ref"]) == ("en", {"state": "proposed", "number": OLD_NUMBER})

    assert fx.step("redo").status_code == 200
    assert fx.unit(REF_LINE)["ref"] == {"state": "confirmed", "number": OLD_NUMBER}


def test_set_ref_takes_a_number_from_the_middle_of_the_text(client: TestClient) -> None:
    fx = Setup(client)

    assert fx.set_ref(PROSE, OLD_NUMBER.lower()).status_code == 200

    unit = fx.unit(PROSE)
    assert (unit["lang"], unit["ref"]) == ("ref", {"state": "confirmed", "number": OLD_NUMBER})


def test_set_ref_refuses_a_number_the_text_does_not_hold(client: TestClient) -> None:
    fx = Setup(client)

    refused = fx.set_ref(REF_LINE, NUMBER)

    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "ref_number_not_in_text"
    assert fx.unit(REF_LINE)["lang"] == "en"


def test_set_ref_refuses_a_decided_unit(client: TestClient) -> None:
    fx = Setup(client)
    assign_as_is(client, fx.bundle_id, fx.unit(REF_LINE), fx.sop_id, slot_key="purpose")

    refused = fx.set_ref(REF_LINE, OLD_NUMBER)

    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "unit_has_decision"


def test_set_ref_takes_the_unit_out_of_its_pair(client: TestClient) -> None:
    fx = Setup(client)
    assert fx.unit(PROSE)["pair_id"] is not None
    assert fx.unit(PROSE)["pair_id"] == fx.unit(PROSE_EN)["pair_id"]

    assert fx.set_ref(PROSE_EN, OLD_NUMBER).status_code == 200

    assert (fx.unit(PROSE)["pair_id"], fx.unit(PROSE_EN)["pair_id"]) == (None, None)


def test_set_ref_refuses_an_empty_number(client: TestClient) -> None:
    fx = Setup(client)

    assert fx.set_ref(REF_LINE, "  ").status_code == 422
    assert fx.unit(REF_LINE)["lang"] == "en"


def test_clear_ref_on_a_proposal_stops_proposing_without_touching_the_document(client: TestClient) -> None:
    fx = Setup(client)

    result = fx.clear_ref(REF_LINE)

    assert result.status_code == 200, result.text
    assert result.json()["document_revision"] == 1
    unit = fx.unit(REF_LINE)
    assert (unit["lang"], unit["ref"]) == ("en", None)


def test_clear_ref_on_a_reference_restores_the_language(client: TestClient) -> None:
    fx = Setup(client)
    assert fx.set_ref(PROSE, OLD_NUMBER).status_code == 200

    assert fx.clear_ref(PROSE).status_code == 200

    unit = fx.unit(PROSE)
    assert (unit["lang"], unit["ref"]) == ("ko", None)
    # 되돌리면 다시 REF다 — 표시는 번호를 기억한다
    assert fx.step("undo").status_code == 200
    assert fx.unit(PROSE)["ref"] == {"state": "confirmed", "number": OLD_NUMBER}


def test_reviewer_cannot_mark_references(client: TestClient) -> None:
    fx = Setup(client)
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    body = {"revision": 1, "confirm": False, "op": {"type": "clear_ref", "unit_id": fx.unit(REF_LINE)["id"]}}

    refused = client.post(f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits", json=body, headers=REVIEWER)

    assert refused.status_code == 403


# --- 그 번호의 EQUIS 표시 ---


def test_detail_is_empty_without_equis(client: TestClient) -> None:
    fx = Setup(client)

    assert fx.detail(REF_LINE) == {"state": "proposed", "number": OLD_NUMBER, "equis": None, "suggested_text": None}
    assert fx.detail(HEADING) == {"state": None, "number": "", "equis": None, "suggested_text": None}


def test_detail_follows_an_old_number_to_the_current_document(client: TestClient, equis: FakeEquis) -> None:  # noqa: F811
    equis.rows = [make_row(NUMBER, legacy=OLD_NUMBER)]
    fx = Setup(client)
    asked_by_setup = len(equis.asked)  # 올린 문서와 To-Be 줄의 번호

    first = fx.detail(REF_LINE)
    assert first["equis"]["state"] == "pending"

    found = fx.detail(REF_LINE)["equis"]
    assert (found["state"], found["number"], found["name"]) == ("found", NUMBER, NAME)
    assert found["reasons"][0] == "old_number"
    assert found["doc_url"] == "https://equis.test/ui/#doc_info/900001"
    # 새 문장에 쓸 글 — 지금 번호와 정식 이름
    assert fx.detail(REF_LINE)["suggested_text"] == f"{NUMBER} {NAME}"
    # 글에 있는 번호만 묻는다
    assert set(equis.asked[asked_by_setup:]) == {OLD_NUMBER, NUMBER}


def test_detail_does_not_ask_for_units_that_are_not_references(client: TestClient, equis: FakeEquis) -> None:  # noqa: F811
    fx = Setup(client)
    asked_before = list(equis.asked)

    fx.detail(PROSE)

    assert equis.asked == asked_before


# --- 짝·숫자 검사에서 빠지기 ---


def test_reference_is_not_counted_as_one_language_only(client: TestClient) -> None:
    fx = Setup(client)
    before = client.get(f"/api/bundles/{fx.bundle_id}", headers=AUTHOR).json()["progress"]["single_language"]

    assert fx.set_ref(REF_LINE, OLD_NUMBER).status_code == 200

    after = client.get(f"/api/bundles/{fx.bundle_id}", headers=AUTHOR).json()["progress"]["single_language"]
    assert after == before - 1


def test_new_sentence_of_a_reference_keeps_the_type_and_skips_the_number_check(client: TestClient) -> None:
    fx = Setup(client)
    assert fx.set_ref(REF_LINE, OLD_NUMBER).status_code == 200
    unit = fx.unit(REF_LINE)
    entry = get_group_by_unit(client, fx.bundle_id, unit["id"])["units"][0]
    body = {
        "action": "confirm",
        "hold_reason": "",
        "units": [{"unit_id": unit["id"], "revision": entry["decision"]["revision"], "disposition": "assigned"}],
        "targets": [{
            "key": "t", "target_doc_id": fx.sop_id, "slot_key": "purpose", "source_unit_ids": [unit["id"]],
            "text": f"{NUMBER} {NAME}", "change_type": "rewritten",
        }],
    }

    response = save_group(client, fx.bundle_id, body)

    assert response.status_code == 200, response.text
    target = response.json()["targets"][0]
    assert (target["lang"], target["warnings"]) == ("ref", [])


# --- 이미 쓴 새 문서의 문장에 이은 참조 줄 ---


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (REF_LINE, "number"),
        (f"{NUMBER} Operation of UV spectrophotometer", "title"),
        (f"{NUMBER}  {NAME.lower()}", None),
    ],
)
def test_check_ref_text(text: str, expected: str | None) -> None:
    assert check_ref_text(text, REF_LINE, OLD_NUMBER, NUMBER, NAME) == expected


def _link_to_written(client: TestClient, new_line: str) -> tuple[Setup, dict]:
    """옛 문서의 참조 줄을 REF로 확정하고, 이미 쓴 새 문서의 한 줄에 출처로 잇는다 — (묶음, 저장 응답의 새 문장)."""
    fx = Setup(client)
    uploaded = upload(
        client, fx.bundle_id, build_docx(p(new_line), headers=[p("합성 새 문서")]), "SYNTHETIC_SOP-W_Refs.docx",
        side="new", doc_type="sop",
    )
    assert uploaded.status_code == 201, uploaded.text
    assert fx.set_ref(REF_LINE, OLD_NUMBER).status_code == 200
    unit = fx.unit(REF_LINE)
    written = next(row for row in _list_written(client, fx.bundle_id) if row["text"] == new_line)
    entry = get_group_by_unit(client, fx.bundle_id, unit["id"])["units"][0]
    body = {
        "action": "confirm",
        "hold_reason": "",
        "units": [{"unit_id": unit["id"], "revision": entry["decision"]["revision"], "disposition": "assigned"}],
        "targets": [{"key": "t", "id": written["target_id"], "revision": written["revision"], "source_unit_ids": [unit["id"]]}],
    }
    if new_line != REF_LINE:
        # 글이 원문과 다르면 변경 종류를 사람이 고른다
        body["targets"][0]["change_type"] = "rewritten"
    response = save_group(client, fx.bundle_id, body)
    assert response.status_code == 200, response.text
    return fx, response.json()["targets"][0]


def _list_written(client: TestClient, bundle_id: int) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/written-sentences", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def test_linking_a_reference_to_a_written_sentence_is_not_a_translation(client: TestClient) -> None:
    _, target = _link_to_written(client, f"{NUMBER} {NAME}")

    assert target["change_type"] == "rewritten"


@pytest.mark.parametrize(
    ("new_line", "expected"),
    [
        (REF_LINE, "number"),
        (f"{NUMBER} Operation of UV spectrophotometer", "title"),
        (f"{NUMBER} {NAME}", None),
    ],
)
def test_written_sentence_of_a_reference_is_checked_against_equis(
    client: TestClient, equis: FakeEquis, new_line: str, expected: str | None  # noqa: F811
) -> None:
    equis.rows = [make_row(NUMBER, legacy=OLD_NUMBER)]
    fx, _ = _link_to_written(client, new_line)
    fx.detail(REF_LINE)  # 그 번호를 조회한다(응답 뒤에 끝난다)

    row = next(row for row in _list_written(client, fx.bundle_id) if row["text"] == new_line)

    assert row["ref_issue"] == expected
    # 견준 번호는 출처 참조 줄의 번호다(이 문장의 글에서 다시 읽지 않는다)
    assert (row["ref"]["number"], row["ref"]["equis"]["number"]) == (OLD_NUMBER, NUMBER)


def test_written_sentence_is_not_checked_without_equis(client: TestClient) -> None:
    fx, _ = _link_to_written(client, REF_LINE)

    assert [row["ref_issue"] for row in _list_written(client, fx.bundle_id)] == [None]


# --- 새 문서에만 있는 참조 줄(출처 없음) ---


def _upload_written(client: TestClient, fx: Setup, *lines: str) -> int:
    """이미 쓴 새 문서를 올리고 옛 문서와 잇지 않은 채 둔다 — 문서 id."""
    uploaded = upload(
        client, fx.bundle_id, build_docx("".join(p(line) for line in lines), headers=[p("합성 새 문서")]),
        "SYNTHETIC_SOP-W_Refs.docx", side="new", doc_type="sop",
    )
    assert uploaded.status_code == 201, uploaded.text
    return uploaded.json()["id"]


def _find_written(client: TestClient, bundle_id: int, text: str) -> dict:
    return next(row for row in _list_written(client, bundle_id) if row["text"] == text)


def _edit_written(client: TestClient, fx: Setup, doc_id: int, op_type: str, text: str, **extra: str) -> httpx2.Response:
    view = get_view(client, fx.bundle_id, doc_id)
    op = {"type": op_type, "unit_id": find_unit(view, text)["id"], **extra}
    body = {"revision": view["document"]["revision"], "confirm": False, "op": op}
    return client.post(f"/api/bundles/{fx.bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)


@pytest.mark.parametrize(
    ("new_line", "expected"),
    [
        (REF_LINE, "number"),
        (f"{NUMBER} Operation of UV spectrophotometer", "title"),
        (f"{NUMBER} {NAME}", None),
    ],
)
def test_reference_line_only_in_a_written_document_is_checked_against_equis(
    client: TestClient, equis: FakeEquis, new_line: str, expected: str | None  # noqa: F811
) -> None:
    equis.rows = [make_row(NUMBER, legacy=OLD_NUMBER)]
    fx = Setup(client)
    _upload_written(client, fx, new_line)

    first = _find_written(client, fx.bundle_id, new_line)  # 이 읽기가 조회를 건다(응답 뒤에 끝난다)
    row = _find_written(client, fx.bundle_id, new_line)

    assert row["source_unit_ids"] == []
    assert (first["ref"]["number"], first["ref"]["equis"]["state"], first["ref_issue"]) == (
        find_leading_number(new_line), "pending", None,
    )
    found = row["ref"]["equis"]
    assert (found["state"], found["number"], found["name"]) == ("found", NUMBER, NAME)
    assert row["ref_issue"] == expected


def test_written_prose_that_mentions_a_number_is_not_a_reference(client: TestClient, equis: FakeEquis) -> None:  # noqa: F811
    fx = Setup(client)
    _upload_written(client, fx, PROSE_EN)
    asked_before = list(equis.asked)

    row = _find_written(client, fx.bundle_id, PROSE_EN)

    assert (row["ref"], row["ref_issue"]) == (None, None)
    assert equis.asked == asked_before


def test_reference_line_unknown_to_equis_is_shown_as_not_found(client: TestClient, equis: FakeEquis) -> None:  # noqa: F811
    fx = Setup(client)
    _upload_written(client, fx, REF_LINE)
    _list_written(client, fx.bundle_id)

    row = _find_written(client, fx.bundle_id, REF_LINE)

    assert (row["ref"]["equis"]["state"], row["ref_issue"]) == ("not_found", None)


def test_a_written_line_marked_not_a_reference_is_left_alone(client: TestClient) -> None:
    fx = Setup(client)
    doc_id = _upload_written(client, fx, REF_LINE)
    # EQUIS가 꺼져 있어도 참조 줄인지는 안다(표시만 없다)
    assert _find_written(client, fx.bundle_id, REF_LINE)["ref"] == {"number": OLD_NUMBER, "equis": None}

    response = _edit_written(client, fx, doc_id, "clear_ref", REF_LINE)

    assert response.status_code == 200, response.text
    assert _find_written(client, fx.bundle_id, REF_LINE)["ref"] is None


def test_a_written_line_marked_as_a_reference_by_hand_uses_that_number(client: TestClient) -> None:
    fx = Setup(client)
    doc_id = _upload_written(client, fx, PROSE_EN)

    response = _edit_written(client, fx, doc_id, "set_ref", PROSE_EN, number=OLD_NUMBER)

    assert response.status_code == 200, response.text
    row = _find_written(client, fx.bundle_id, PROSE_EN)
    assert (row["lang"], row["ref"]) == ("ref", {"number": OLD_NUMBER, "equis": None})


def test_reference_lookups_are_asked_a_few_at_a_time(client: TestClient, equis: FakeEquis) -> None:  # noqa: F811
    # 조회는 응답 뒤에 줄지어 돈다 — 한꺼번에 걸면 뒤쪽 번호가 제한 시간을 넘겨 다음 읽기에 또 걸린다
    fx = Setup(client)
    extra = 2
    lines = [f"SOP-REF-{index:03d} Synthetic reference {index}" for index in range(REF_LOOKUPS_PER_READ + extra)]
    _upload_written(client, fx, *lines)
    asked_before = len(equis.asked)

    _list_written(client, fx.bundle_id)
    asked_first = len(equis.asked) - asked_before
    _list_written(client, fx.bundle_id)
    _list_written(client, fx.bundle_id)

    assert (asked_first, len(equis.asked) - asked_before) == (REF_LOOKUPS_PER_READ, REF_LOOKUPS_PER_READ + extra)
