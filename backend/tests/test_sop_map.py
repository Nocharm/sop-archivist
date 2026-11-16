"""참조 지도 요약 API — 번호 규칙, 선과 마디, 후속 문서, 그리고 누가 무엇을 받는지(설계 2026-11-17 참조 지도 §4·§5·§7.1).

번호·이름은 모두 합성이다. 남의 Bundle(S)의 문장·제목에는 표시 글자를 심어 응답 본문 전체에서 찾는다.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee
from app.settings import settings
from app.sop import ref_map
from app.sop.bundle_code import format_bundle_code
from app.sop.models import Extraction, TargetSentence, Unit, UnitDecision
from app.sop.refs import is_document_number
from app.sop.tobe import is_temp_match_code
from tests.access_helpers import add_grant, run_in_session, update_row
from tests.sop_helpers import (
    ADMIN,
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    get_group_by_unit,
    get_view,
    put_tobe,
)
from tests.sop_map_helpers import (
    M_EXTRA,
    M_TITLE,
    MARKERS,
    MOVED_OK,
    OPS,
    PLAIN,
    REF_NONE,
    REF_UV,
    S_TITLE,
    V_TITLE,
    World,
    add_doc,
    edit,
    find_line,
    get_map,
    move_out,
)

pytestmark = pytest.mark.usefixtures("clean_sop")


def _edges_from(body: dict, source: str) -> list[dict]:
    return [edge for edge in body["edges"] if edge["source"] == source]


def _edge(body: dict, source: str, target: str, kind: str) -> dict | None:
    return next(
        (e for e in body["edges"] if (e["source"], e["target"], e["kind"]) == (source, target, kind)), None
    )


def _node(body: dict, node_id: str) -> dict:
    return next(node for node in body["nodes"] if node["id"] == node_id)


def _becomes(body: dict, doc_id: int) -> list[dict]:
    return _node(body, f"old:{doc_id}")["becomes"]


# --- 번호 규칙 ---


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("SOP-ABC-1016", True), ("OLD-1", True), ("WI-04", True), ("NEW-12", True),
        ("sop-abc-1016", False), ("SOP-ABC-1016A", False), ("SOP ABC 1016", False), ("see the purchasing team", False),
        ("SPIN THE SAMPLES AT 3000 RPM", False), ("", False), ("A-1", False), ("SOP-ABC-1016 ", False),
    ],
)
def test_is_document_number(text: str, expected: bool) -> None:
    assert is_document_number(text) is expected


def test_is_temp_match_code() -> None:
    codes = ("NEW-12", " new-7 ", "NEW-", "NEW-1A", "SOP-NEW-1", "")
    assert [is_temp_match_code(code) for code in codes] == [True, True, False, False, False, False]


# --- 한 장의 지도 ---


def test_linked_map_for_a_member(client: TestClient) -> None:
    w = World(client)
    v, m, s, st = f"old:{w.v_doc['id']}", f"old:{w.m_doc['id']}", f"old:{w.s_doc['id']}", f"target:{w.s_sop}"

    assert get_map(client, w.v_id) == {
        "scope": "linked", "truncated": False,
        "bundles": [
            {"id": w.v_id, "code": format_bundle_code(w.v_id), "title": V_TITLE, "status": "in_progress",
             "relation": "self", "document_count": 1},
            {"id": w.m_id, "code": format_bundle_code(w.m_id), "title": M_TITLE, "status": "in_progress",
             "relation": "member", "document_count": 1},
            {"id": w.s_id, "code": format_bundle_code(w.s_id), "title": "", "status": "in_progress",
             "relation": "summary", "document_count": 1},
        ],
        "nodes": [
            {"id": v, "kind": "old", "bundle_id": w.v_id, "number": "OLD-1", "title": w.v_doc["title"], "doc_type": None,
             "becomes": [{"code": "SOP-CF", "title": "Synthetic SOP", "doc_type": "sop"}]},
            {"id": m, "kind": "old", "bundle_id": w.m_id, "number": "SOP-ABC-1016", "title": w.m_doc["title"],
             "doc_type": None, "becomes": [{"code": "SOP-UV", "title": "Synthetic UV SOP", "doc_type": "sop"}]},
            {"id": s, "kind": "old", "bundle_id": w.s_id, "number": "SOP-ABC-1020", "title": "Synthetic document control",
             "doc_type": None,
             "becomes": [{"code": "SOP-QC-99999", "title": "Synthetic calibration SOP", "doc_type": "sop"}]},
            {"id": st, "kind": "target", "bundle_id": w.s_id, "number": "SOP-QC-99999",
             "title": "Synthetic calibration SOP", "doc_type": "sop", "becomes": []},
            {"id": "num:SOP-ZZ-404", "kind": "num", "bundle_id": None, "number": "SOP-ZZ-404", "title": "",
             "doc_type": None, "becomes": []},
        ],
        "edges": sorted([
            {"source": v, "target": m, "kind": "ref", "state": "proposed", "lines": 1},
            {"source": v, "target": s, "kind": "ref", "state": "confirmed", "lines": 1},
            {"source": v, "target": "num:SOP-ZZ-404", "kind": "ref", "state": "proposed", "lines": 1},
            {"source": v, "target": st, "kind": "moved", "state": "confirmed", "lines": 1},
            {"source": m, "target": v, "kind": "ref", "state": "proposed", "lines": 1},
            {"source": s, "target": v, "kind": "ref", "state": "confirmed", "lines": 1},
            {"source": s, "target": v, "kind": "moved", "state": "confirmed", "lines": 1},
        ], key=lambda e: (e["source"], e["target"], e["kind"], e["state"])),
    }


# --- 누가 받나 ---


def test_map_requires_membership_and_an_active_account(
    client: TestClient, enforce: None, demo_access: None, clean_directory: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_grant("user", "qa.member", permission="bundle.create")  # 권한 판정을 켠 채 World를 만든다
    w = World(client)
    url = f"/api/bundles/{w.v_id}/map"
    not_found = (404, {"detail": {"code": "bundle_not_found"}})

    def call(path: str = url, headers: dict[str, str] | None = None) -> tuple[int, dict]:
        response = client.get(path, headers=headers or {})
        return response.status_code, response.json()

    assert call(headers=OUTSIDER) == not_found  # S만의 구성원
    monkeypatch.setattr(settings, "app_sysadmins", "dev.admin")
    assert call(headers=ADMIN) == not_found
    monkeypatch.setattr(settings, "app_sysadmins", "")
    add_grant("user", "dev.admin", permission="bundle.admin")
    assert call(headers=ADMIN) == not_found
    assert call() == not_found  # dev 모드에서 헤더가 없으면 DEV_USER(dev.admin)다
    assert call(f"/api/bundles/{w.s_id + 1000}/map", AUTHOR) == not_found
    assert client.get(url, params={"scope": "everything"}, headers=AUTHOR).status_code == 422
    assert client.get("/api/bundles/0/map", headers=AUTHOR).status_code == 422
    update_row(Employee, "qa.lead", active=False)
    assert call(headers=REVIEWER) == (403, {"detail": {"code": "inactive_account"}})
    monkeypatch.setattr(settings, "auth_mode", "keycloak")
    assert client.get(url).status_code == 401


def test_author_and_reviewer_get_the_same_map(client: TestClient) -> None:
    w = World(client)

    for scope in ("linked", "all"):
        url = f"/api/bundles/{w.v_id}/map?scope={scope}"
        author, reviewer = client.get(url, headers=AUTHOR), client.get(url, headers=REVIEWER)
        assert author.status_code == reviewer.status_code == 200
        assert author.text == reviewer.text


def test_relation_follows_membership_not_permissions(
    client: TestClient, enforce: None, demo_access: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_grant("user", "qa.member", permission="bundle.create")
    w = World(client)
    expected = get_map(client, w.v_id)

    def check_ops() -> None:
        body = get_map(client, w.v_id, OPS)
        assert [(b["relation"], b["title"]) for b in body["bundles"]] == [("self", V_TITLE), ("summary", ""), ("summary", "")]
        assert (body["nodes"], body["edges"]) == (expected["nodes"], expected["edges"])

    check_ops()
    add_grant("user", "ops.member", permission="bundle.admin")
    check_ops()
    monkeypatch.setattr(settings, "app_sysadmins", "ops.member")
    check_ops()

    body = get_map(client, w.s_id, OUTSIDER)
    assert [(b["id"], b["relation"], b["title"]) for b in body["bundles"]] == [(w.s_id, "self", S_TITLE), (w.v_id, "summary", "")]


def test_no_marker_text_reaches_a_non_member(
    client: TestClient, enforce: None, demo_access: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """S의 구성원이 아닌 모든 보는 사람(작성자·검토자·권한 많은 작성자)의 V 지도 본문에 S의 글이 한 글자도 없다."""
    add_grant("user", "qa.member", permission="bundle.create")
    w = World(client)
    add_grant("user", "ops.member", permission="bundle.admin")
    monkeypatch.setattr(settings, "app_sysadmins", "ops.member")

    for headers in (AUTHOR, REVIEWER, OPS):
        for scope in ("linked", "all"):
            response = client.get(f"/api/bundles/{w.v_id}/map", params={"scope": scope}, headers=headers)
            assert response.status_code == 200, response.text
            assert f"old:{w.s_doc['id']}" in response.text  # S의 요약은 실려 있다
            assert [marker for marker in MARKERS if marker in response.text] == []


# --- 선 ---


def test_ref_edges_follow_read_ref_state(client: TestClient) -> None:
    w = World(client)
    v, m = f"old:{w.v_doc['id']}", f"old:{w.m_doc['id']}"

    response = edit(client, w.v_id, w.v_doc["id"], {"type": "clear_ref", "unit_id": find_line(client, w.v_id, w.v_doc["id"], REF_UV)["id"]})
    assert response.status_code == 200, response.text
    assert _edge(get_map(client, w.v_id), v, m, "ref") is None

    response = edit(client, w.v_id, w.v_doc["id"], {
        "type": "set_ref", "unit_id": find_line(client, w.v_id, w.v_doc["id"], REF_NONE)["id"], "number": "SOP-ZZ-404",
    })
    assert response.status_code == 200, response.text
    assert _edge(get_map(client, w.v_id), v, "num:SOP-ZZ-404", "ref")["state"] == "confirmed"

    prose = "Follow SOP-ABC-1016 for details."
    extra = add_doc(client, w.v_id, "SYNTHETIC_OLD-7_Extra.docx", prose)
    assert _edges_from(get_map(client, w.v_id), f"old:{extra['id']}") == []
    response = edit(client, w.v_id, extra["id"], {
        "type": "set_ref", "unit_id": find_line(client, w.v_id, extra["id"], prose)["id"], "number": "SOP-ABC-1016",
    })
    assert response.status_code == 200, response.text
    assert _edges_from(get_map(client, w.v_id), f"old:{extra['id']}") == [
        {"source": f"old:{extra['id']}", "target": m, "kind": "ref", "state": "confirmed", "lines": 1},
    ]


def test_moved_edges_need_a_confirmed_human_decision(client: TestClient) -> None:
    w = World(client)
    v, st = f"old:{w.v_doc['id']}", f"target:{w.s_sop}"
    unit_id = find_line(client, w.v_id, w.v_doc["id"], MOVED_OK)["id"]

    update_row(UnitDecision, unit_id, status="ai_suggested")
    assert _edge(get_map(client, w.v_id), v, st, "moved") is None
    update_row(UnitDecision, unit_id, status="on_hold")
    assert _edge(get_map(client, w.v_id), v, st, "moved") is None
    update_row(UnitDecision, unit_id, status="confirmed")
    assert _edge(get_map(client, w.v_id), v, st, "moved") is not None


def test_moved_pair_counts_one_line(client: TestClient) -> None:
    w = World(client)
    ko, en = "원심분리기 덮개를 닫는다.", "Close the lid of the centrifuge."
    pair_doc = add_doc(client, w.v_id, "SYNTHETIC_OLD-7_Pair.docx", ko, en)
    view = get_view(client, w.v_id, pair_doc["id"])
    assert len(view["pairs"]) == 1

    move_out(client, w.v_id, [find_line(client, w.v_id, pair_doc["id"], ko), find_line(client, w.v_id, pair_doc["id"], en)], "SOP-QC-99999")

    edge = _edge(get_map(client, w.v_id), f"old:{pair_doc['id']}", f"target:{w.s_sop}", "moved")
    assert edge is not None and edge["lines"] == 1


def test_same_number_in_two_bundles_draws_both(client: TestClient) -> None:
    w = World(client)
    v, m = f"old:{w.v_doc['id']}", f"old:{w.m_doc['id']}"
    twin = add_doc(client, w.m_id, "SYNTHETIC_SOP-ABC-1020_Twin.docx", "Synthetic twin line.")

    body = get_map(client, w.v_id)
    for target in (f"old:{w.s_doc['id']}", f"old:{twin['id']}"):
        assert {k: _edge(body, v, target, "ref")[k] for k in ("state", "lines")} == {"state": "confirmed", "lines": 1}

    second = add_doc(client, w.v_id, "SYNTHETIC_OLD-1_Second.docx", "Synthetic second line.")
    body = get_map(client, w.v_id)
    assert {e["target"] for e in _edges_from(body, m)} == {v, f"old:{second['id']}"}


def test_free_text_numbers_never_become_nodes(client: TestClient) -> None:
    w = World(client)
    v, st = f"old:{w.v_doc['id']}", f"target:{w.s_sop}"
    line = "Spin the samples at 3000 rpm before reading."
    extra = add_doc(client, w.v_id, "SYNTHETIC_OLD-7_Extra.docx", line)
    response = edit(client, w.v_id, extra["id"], {
        "type": "set_ref", "unit_id": find_line(client, w.v_id, extra["id"], line)["id"],
        "number": "SPIN THE SAMPLES AT 3000 RPM",
    })
    assert response.status_code == 200, response.text

    for scope in ("linked", "all"):
        response = client.get(f"/api/bundles/{w.v_id}/map", params={"scope": scope}, headers=AUTHOR)
        assert response.status_code == 200, response.text
        assert "SPIN THE" not in response.text
        assert _edges_from(response.json(), f"old:{extra['id']}") == []

    update_row(UnitDecision, find_line(client, w.v_id, w.v_doc["id"], MOVED_OK)["id"], move_target_code="NEW-12")
    body = get_map(client, w.v_id)
    assert "num:NEW-12" not in {node["id"] for node in body["nodes"]}
    assert _edge(body, v, st, "moved") is None


def test_odd_document_numbers_do_not_break_the_scan(client: TestClient) -> None:
    w = World(client)
    odd = add_doc(client, w.m_id, "SYNTHETIC_OLD-9_Odd.docx", "OLDX1 Synthetic line")

    def rename(code: str) -> None:
        current = get_view(client, w.v_id, w.v_doc["id"])["document"]["revision"]
        response = client.patch(
            f"/api/bundles/{w.v_id}/documents/{w.v_doc['id']}", json={"revision": current, "doc_code": code}, headers=AUTHOR
        )
        assert response.status_code == 200, response.text

    rename("OLD_1%")
    assert _edges_from(get_map(client, w.v_id), f"old:{odd['id']}") == []
    rename("MAP" + "-ABCDEFGH" * 10 + "-123456")
    assert _edges_from(get_map(client, w.v_id), f"old:{odd['id']}") == []


def test_only_active_units_of_the_latest_extraction_count(client: TestClient) -> None:
    w = World(client)
    v, m = f"old:{w.v_doc['id']}", f"old:{w.m_doc['id']}"

    update_row(Unit, find_line(client, w.v_id, w.v_doc["id"], REF_UV)["id"], status="retired")
    assert _edge(get_map(client, w.v_id), v, m, "ref") is None

    async def add_extraction(session: AsyncSession) -> None:
        current = (await session.scalars(
            select(Extraction).where(Extraction.document_id == w.v_doc["id"]).order_by(Extraction.id.desc())
        )).first()
        assert current is not None
        session.add(Extraction(
            document_id=w.v_doc["id"], extractor_version=current.extractor_version, aux_status=current.aux_status
        ))
        await session.commit()

    run_in_session(add_extraction)
    body = get_map(client, w.v_id)
    assert _edges_from(body, v) == []
    assert _becomes(body, w.v_doc["id"]) == []


# --- 후속 문서 ---


def test_becomes_lists_confirmed_successors_sop_first(client: TestClient) -> None:
    w = World(client)
    assign_as_is(
        client, w.m_id, find_line(client, w.m_id, w.m_doc["id"], M_EXTRA), w.m_wi, wi_step=1, wi_part="instruction"
    )
    assert _becomes(get_map(client, w.v_id), w.m_doc["id"]) == [
        {"code": "SOP-UV", "title": "Synthetic UV SOP", "doc_type": "sop"},
        {"code": "WI-11", "title": "Synthetic UV WI", "doc_type": "wi"},
    ]

    held_line = "Synthetic held line."
    held = add_doc(client, w.m_id, "SYNTHETIC_OLD-9_Held.docx", held_line)
    assign_as_is(
        client, w.m_id, find_line(client, w.m_id, held["id"], held_line), w.m_sop,
        slot_key="purpose", hold_reason="Synthetic hold",
    )
    assert _becomes(get_map(client, w.m_id), held["id"]) == []

    async def find_plain_target(session: AsyncSession) -> int:
        return (await session.scalars(
            select(TargetSentence.id).where(TargetSentence.target_doc_id == w.m_sop, TargetSentence.status == "confirmed")
        )).one()

    update_row(TargetSentence, run_in_session(find_plain_target), status="ai_suggested")
    assert [item["code"] for item in _becomes(get_map(client, w.v_id), w.m_doc["id"])] == ["WI-11"]


def test_temp_code_successor_has_no_number(client: TestClient) -> None:
    bundle = client.post("/api/bundles", json={"title": "SYNTHETIC map temp", "is_synthetic": True}, headers=AUTHOR)
    assert bundle.status_code == 201, bundle.text
    bundle_id = bundle.json()["id"]
    response = put_tobe(
        client, bundle_id, [{"code": "NEW-900001", "title": "Synthetic draft", "doc_type": "sop", "parent_code": None}]
    )
    assert response.status_code == 200, response.text
    draft_id = response.json()["docs"][0]["id"]
    first, second = "Synthetic draft line.", "Synthetic sent line."
    doc = add_doc(client, bundle_id, "SYNTHETIC_OLD-8_Temp.docx", first, second)

    assign_as_is(client, bundle_id, find_line(client, bundle_id, doc["id"], first), draft_id, slot_key="purpose")
    body = get_map(client, bundle_id)
    assert _becomes(body, doc["id"]) == [{"code": "", "title": "Synthetic draft", "doc_type": "sop"}]

    move_out(client, bundle_id, [find_line(client, bundle_id, doc["id"], second)], "NEW-900001")
    body = get_map(client, bundle_id)
    assert body["edges"] == []
    assert [node["id"] for node in body["nodes"]] == [f"old:{doc['id']}"]


def test_becomes_disappears_when_the_assignment_is_cleared(client: TestClient) -> None:
    w = World(client)
    unit_id = find_line(client, w.v_id, w.v_doc["id"], PLAIN)["id"]
    decision_revision = get_group_by_unit(client, w.v_id, unit_id)["units"][0]["decision"]["revision"]
    response = client.post(
        f"/api/bundles/{w.v_id}/decisions/clear", json={"unit_id": unit_id, "revision": decision_revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text

    assert _becomes(get_map(client, w.v_id), w.v_doc["id"]) == []


def test_caps_keep_this_bundle_first(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    w = World(client)
    v, m = f"old:{w.v_doc['id']}", f"old:{w.m_doc['id']}"

    monkeypatch.setattr(ref_map, "MAX_NODES", 2)
    body = get_map(client, w.v_id)
    assert body["truncated"] is True
    assert [node["id"] for node in body["nodes"]] == [v, m]
    assert [b["id"] for b in body["bundles"]] == [w.v_id, w.m_id]
    assert {(e["source"], e["target"]) for e in body["edges"]} == {(v, m), (m, v)}

    monkeypatch.setattr(ref_map, "MAX_EDGES", 1)
    body = get_map(client, w.v_id)
    assert body["truncated"] is True and len(body["edges"]) == 1


def test_bundle_without_documents_still_opens_its_map(client: TestClient) -> None:
    response = client.post("/api/bundles", json={"title": "SYNTHETIC map empty", "is_synthetic": True}, headers=AUTHOR)
    assert response.status_code == 201, response.text
    bundle_id = response.json()["id"]

    body = get_map(client, bundle_id)

    assert body["bundles"] == [{
        "id": bundle_id, "code": format_bundle_code(bundle_id), "title": "SYNTHETIC map empty", "status": "in_progress",
        "relation": "self", "document_count": 0,
    }]
    assert (body["nodes"], body["edges"]) == ([], [])
