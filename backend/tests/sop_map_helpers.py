"""참조 지도 시험 도우미 — 서로 가리키는 합성 Bundle 셋(V 보는 것 · M 구성원 · S 남의 것)을 앱 API로 만든다.

S의 문장·제목·사유에는 응답에 실리면 안 되는 표시 글자(`MARKERS`)를 심는다. 번호·이름은 모두 지어낸 값이다.
"""

import httpx2
from fastapi.testclient import TestClient

from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, assign_as_is, find_unit, get_group_by_unit, get_view, put_tobe, set_members, upload

V_TITLE = "SYNTHETIC map viewed"
M_TITLE = "SYNTHETIC map member"
S_TITLE = "ZZ-BUNDLE-TITLE synthetic"
S_DESCRIPTION = "ZZ-DESCRIPTION synthetic"

# V의 줄
REF_UV = "SOP-ABC-1016 Operation of UV spectrophotometer"
REF_DC = "SOP-ABC-1020 Document control"
REF_NONE = "SOP-ZZ-404 Synthetic missing document"
REF_SELF = "OLD-1 Synthetic self reference"
MOVED_OK = "Calibrate the rotor every year."
MOVED_FREE = "Order spare tubes from the supplier."
PLAIN = "Balance the tubes before loading the rotor."
# M의 줄
M_REF = "OLD-1 Operation of the centrifuge"
M_PLAIN = "Warm up the lamp for thirty minutes."
M_EXTRA = "Check the lamp hours on the display."
# S의 줄
S_REF = "OLD-1 ZZ-REF-TEXT synthetic"
S_MOVED = "ZZ-MOVED-SENTENCE synthetic."
S_PLAIN = "ZZ-NEW-SENTENCE synthetic."
S_HOLD = "ZZ-HOLD-TEXT synthetic."

# 구성원이 아닌 사람의 응답 어디에도 나오면 안 되는 글자
MARKERS = (
    "ZZ-BUNDLE-TITLE", "ZZ-DESCRIPTION", "ZZ-FILE-NAME", "ZZ-REF-TEXT", "ZZ-MOVED-SENTENCE", "ZZ-REASON",
    "ZZ-NEW-SENTENCE", "ZZ-HOLD",
)
OPS = {"X-Dev-User": "ops.member"}


def _create_bundle(client: TestClient, title: str, description: str = "") -> int:
    body = {"title": title, "description": description, "is_synthetic": True}
    response = client.post("/api/bundles", json=body, headers=AUTHOR)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _put_tobe_ids(client: TestClient, bundle_id: int, docs: list[dict], wi_steps: list[dict] | None = None) -> dict[str, int]:
    response = put_tobe(client, bundle_id, docs, wi_steps=wi_steps or [])
    assert response.status_code == 200, response.text
    return {doc["code"]: doc["id"] for doc in response.json()["docs"]}


def _sop(code: str, title: str, parent_code: str | None = None, doc_type: str = "sop") -> dict:
    return {"code": code, "title": title, "doc_type": doc_type, "parent_code": parent_code}


def get_map(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR, scope: str = "linked") -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/map", params={"scope": scope}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def get_lines(
    client: TestClient, bundle_id: int, node: str, headers: dict[str, str] = AUTHOR, scope: str = "linked"
) -> dict:
    """그 마디의 줄 문장(`…/map/lines`) — 200을 단언한다."""
    response = client.get(f"/api/bundles/{bundle_id}/map/lines", params={"node": node, "scope": scope}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def edit(client: TestClient, bundle_id: int, doc_id: int, op: dict) -> httpx2.Response:
    """쪼개기 편집 하나(set_ref·clear_ref 등) — 보기의 문서 revision으로 보낸다."""
    body = {"revision": get_view(client, bundle_id, doc_id)["document"]["revision"], "confirm": False, "op": op}
    return client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)


def move_out(client: TestClient, bundle_id: int, units: list[dict], code: str, reason: str = "Synthetic reason") -> None:
    """view 단위들을 다른 문서로 보낸다(확정)."""
    items = []
    for unit in units:
        group = get_group_by_unit(client, bundle_id, unit["id"])
        entry = next(member for member in group["units"] if member["unit_id"] == unit["id"])
        items.append({"unit_id": unit["id"], "revision": entry["decision"]["revision"]})
    body = {"action": "move_external", "reason": reason, "move_target_code": code, "units": items}
    response = client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


def add_doc(client: TestClient, bundle_id: int, file_name: str, *lines: str) -> dict:
    """줄마다 문단 하나인 Old 문서를 올리고 문서 응답을 돌려준다."""
    response = upload(client, bundle_id, build_docx("".join(p(text) for text in lines)), file_name)
    assert response.status_code == 201, response.text
    doc = response.json()
    assert doc["status"] == "ready", doc
    return doc


def find_line(client: TestClient, bundle_id: int, doc_id: int, text: str) -> dict:
    return find_unit(get_view(client, bundle_id, doc_id), text)


class World:
    """V·M·S 세 Bundle. 속성은 Bundle id(v_id·m_id·s_id), Old 문서 응답(v_doc·m_doc·s_doc), New 문서 id(v_sop·m_sop·s_sop·m_wi)."""

    def __init__(self, client: TestClient) -> None:
        self.v_id = _create_bundle(client, V_TITLE)
        self.m_id = _create_bundle(client, M_TITLE)
        self.s_id = _create_bundle(client, S_TITLE, S_DESCRIPTION)
        for bundle_id, members in (
            (self.v_id, [("qa.member", "author"), ("qa.lead", "reviewer"), ("ops.member", "author")]),
            (self.m_id, [("qa.member", "author"), ("qa.lead", "reviewer")]),
        ):
            response = set_members(client, bundle_id, members)
            assert response.status_code == 200, response.text

        self.v_sop = _put_tobe_ids(client, self.v_id, [_sop("SOP-CF", "Synthetic SOP")])["SOP-CF"]
        m_codes = _put_tobe_ids(
            client, self.m_id,
            [_sop("SOP-UV", "Synthetic UV SOP"), _sop("WI-11", "Synthetic UV WI", "SOP-UV", "wi")],
            wi_steps=[{"code": "WI-11", "step_no": 1, "title": "Check"}],
        )
        self.m_sop, self.m_wi = m_codes["SOP-UV"], m_codes["WI-11"]
        self.s_sop = _put_tobe_ids(client, self.s_id, [_sop("SOP-QC-99999", "Synthetic calibration SOP")])["SOP-QC-99999"]

        self.v_doc = add_doc(
            client, self.v_id, "SYNTHETIC_OLD-1_Centrifuge.docx",
            REF_UV, REF_DC, REF_NONE, REF_SELF, MOVED_OK, MOVED_FREE, PLAIN,
        )
        self.m_doc = add_doc(client, self.m_id, "SYNTHETIC_SOP-ABC-1016_UV.docx", M_REF, M_PLAIN, M_EXTRA)
        s_doc = add_doc(client, self.s_id, "SYNTHETIC_SOP-ABC-1020_ZZ-FILE-NAME.docx", S_REF, S_MOVED, S_PLAIN, S_HOLD)
        patched = client.patch(
            f"/api/bundles/{self.s_id}/documents/{s_doc['id']}",
            json={"revision": s_doc["revision"], "title": "Synthetic document control"}, headers=AUTHOR,
        )
        assert patched.status_code == 200, patched.text
        self.s_doc: dict = patched.json()

        v, m, s = self.v_doc["id"], self.m_doc["id"], self.s_doc["id"]
        assert edit(client, self.v_id, v, {
            "type": "set_ref", "unit_id": find_line(client, self.v_id, v, REF_DC)["id"], "number": "SOP-ABC-1020",
        }).status_code == 200
        move_out(client, self.v_id, [find_line(client, self.v_id, v, MOVED_OK)], " sop-qc-99999 ")
        move_out(client, self.v_id, [find_line(client, self.v_id, v, MOVED_FREE)], "see the purchasing team")
        assign_as_is(client, self.v_id, find_line(client, self.v_id, v, PLAIN), self.v_sop, slot_key="purpose")

        assign_as_is(client, self.m_id, find_line(client, self.m_id, m, M_PLAIN), self.m_sop, slot_key="purpose")

        assert edit(client, self.s_id, s, {
            "type": "set_ref", "unit_id": find_line(client, self.s_id, s, S_REF)["id"], "number": "OLD-1",
        }).status_code == 200
        move_out(client, self.s_id, [find_line(client, self.s_id, s, S_MOVED)], "old-1", "ZZ-REASON synthetic")
        assign_as_is(client, self.s_id, find_line(client, self.s_id, s, S_PLAIN), self.s_sop, slot_key="purpose")
        assign_as_is(
            client, self.s_id, find_line(client, self.s_id, s, S_HOLD), self.s_sop,
            slot_key="purpose", hold_reason="ZZ-HOLD-REASON synthetic",
        )
        response = set_members(client, self.s_id, [("prod.member", "author")])
        assert response.status_code == 200, response.text
