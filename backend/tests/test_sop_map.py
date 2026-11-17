"""참조 지도 요약 API — 번호 규칙, 선과 마디, 후속 문서, 그리고 누가 무엇을 받는지(설계 2026-11-17 참조 지도 §4·§5·§7.1).

번호·이름은 모두 합성이다. 남의 Bundle(S)의 문장·제목에는 표시 글자를 심어 응답 본문 전체에서 찾는다.
"""

import re
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.models import Employee
from app.settings import settings
from app.sop import ref_map
from app.sop.bundle_code import format_bundle_code
from app.sop.membership import BundleContext
from app.sop.models import (
    Bundle,
    BundleEvent,
    Document,
    Extraction,
    TargetDoc,
    TargetSentence,
    Unit,
    UnitDecision,
    UnitRef,
)
from app.sop.refs import is_document_number
from app.sop.tobe import is_temp_match_code
from tests.access_helpers import add_grant, run_in_session, update_row
from tests.docx_factory import build_docx, p
from tests.sop_helpers import (
    ADMIN,
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    create_bundle,
    get_group_by_unit,
    get_view,
    put_tobe,
    set_members,
    upload,
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
    S_MOVED,
    S_REF,
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

SCOPES = ("linked", "all")
# 지도 하나를 만드는 질의 수의 상한 — Bundle 수와 무관해야 한다(설계 §7.1)
MAX_MAP_STATEMENTS = 20
# 응답에 실릴 수 있는 키 전부(계획의 가시성 행렬) — 여기 없는 키가 나오면 누군가 필드를 더한 것이다
MAP_KEYS = {
    "scope", "truncated", "bundles", "nodes", "edges", "id", "code", "title", "status", "relation", "document_count",
    "kind", "bundle_id", "number", "doc_type", "becomes", "source", "target", "state", "lines",
}
P_CONFIRMED = "SOP-ABC-1020 ZZ-PEER-CONFIRMED synthetic"
P_PROPOSED = "SOP-ABC-1016 ZZ-PEER-PROPOSED synthetic"
# 범위 all만 실어 오는 P의 문장 표시 글자 — 구성원 아닌 사람의 응답에 나오면 안 된다
PEER_MARKERS = ("ZZ-PEER-CONFIRMED", "ZZ-PEER-PROPOSED", "ZZ-PEER-EXTRA")
HPLC_LINE = "HPLC-02 ZZ-HPLC-SENTENCE synthetic"


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


@contextmanager
def _record_statements() -> Iterator[list[tuple[str, Any]]]:
    """이 안에서 DB로 나간 SQL과 그 매개변수(test_sop_review의 _count_queries와 같은 방식)."""
    statements: list[tuple[str, Any]] = []

    def record(_conn: object, _cursor: object, statement: str, parameters: Any, *_args: object) -> None:
        statements.append((statement, parameters))

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)


def _find_active_unit_id(text: str) -> int:
    async def find(session: AsyncSession) -> int:
        return (await session.scalars(select(Unit.id).where(Unit.text == text, Unit.status == "active"))).one()

    return run_in_session(find)


def _add_peer(client: TestClient, *extra_files: str) -> tuple[int, dict, list[dict]]:
    """넷째 Bundle P(prod.member 혼자) — S를 가리키는 확정 줄 하나와 M을 가리키는 제안 줄 하나.

    extra_files는 P에 더 올릴 한 줄짜리 Old 문서의 파일 이름이다. (Bundle id, 첫 Old 문서, 더 올린 문서들).
    """
    peer_id = create_bundle(client, title="SYNTHETIC map peer", is_synthetic=True)["id"]
    doc = add_doc(client, peer_id, "SYNTHETIC_SOP-ABC-1030_Peer.docx", P_CONFIRMED, P_PROPOSED)
    extras = [add_doc(client, peer_id, file_name, "ZZ-PEER-EXTRA synthetic line.") for file_name in extra_files]
    assert edit(client, peer_id, doc["id"], {
        "type": "set_ref", "unit_id": find_line(client, peer_id, doc["id"], P_CONFIRMED)["id"], "number": "SOP-ABC-1020",
    }).status_code == 200
    response = set_members(client, peer_id, [("prod.member", "author")])
    assert response.status_code == 200, response.text
    return peer_id, doc, extras


def _collect_keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {key for item in value.values() for key in _collect_keys(item)}
    if isinstance(value, list):
        return {key for item in value for key in _collect_keys(item)}
    return set()


def _plant_free_text_in_s() -> None:
    """S(qa.member에게 summary)의 확정 참조 번호와 이동 대상 코드를 번호 꼴이 아닌 그 줄의 글 조각으로 바꾼다."""
    update_row(UnitRef, _find_active_unit_id(S_REF), number="ZZ-REF-TEXT SYNTHETIC")
    update_row(UnitDecision, _find_active_unit_id(S_MOVED), move_target_code="ZZ-MOVED-SENTENCE synthetic.")


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
    # M의 제안 줄(M_REF → V)은 M의 구성원에게만 선이 된다 — ops.member는 M의 구성원이 아니다(Fix round 1 판정)
    m_proposed = {"source": f"old:{w.m_doc['id']}", "target": f"old:{w.v_doc['id']}", "kind": "ref", "state": "proposed",
                  "lines": 1}
    assert m_proposed in expected["edges"]
    expected_edges = [edge for edge in expected["edges"] if edge != m_proposed]

    def check_ops() -> None:
        body = get_map(client, w.v_id, OPS)
        assert [(b["relation"], b["title"]) for b in body["bundles"]] == [("self", V_TITLE), ("summary", ""), ("summary", "")]
        assert (body["nodes"], body["edges"]) == (expected["nodes"], expected_edges)

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


def test_only_number_shaped_values_reach_the_like_scan(client: TestClient) -> None:
    """표시 없는 줄을 고르는 LIKE에는 문서 번호 꼴만 들어간다 — `%`·`_`나 자유 글이 들어가면 엉뚱한 줄을 잡는다.

    뒤의 거르기(read_ref_state)가 넓게 잡힌 줄을 다시 버리므로 응답만으로는 이것을 볼 수 없다 — 나간 매개변수를 본다.
    """
    w = World(client)
    add_doc(client, w.v_id, "SYNTHETIC_OLD-7_Extra.docx", "Synthetic extra line.")
    current = get_view(client, w.v_id, w.v_doc["id"])["document"]["revision"]
    response = client.patch(
        f"/api/bundles/{w.v_id}/documents/{w.v_doc['id']}", json={"revision": current, "doc_code": "OLD_1%"}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text

    for scope in SCOPES:
        with _record_statements() as statements:
            get_map(client, w.v_id, scope=scope)
        like_count, patterns = 0, []
        for statement, parameters in statements:
            like_count += statement.count(" LIKE ")
            patterns += [value for value in parameters if isinstance(value, str) and value.startswith("%")]
        assert len(patterns) == like_count  # LIKE 매개변수를 하나도 빠뜨리지 않고 본다
        assert [value for value in patterns if not re.fullmatch(r"%[A-Z0-9-]+%", value)] == []
        # 이 Bundle의 번호 OLD-7 · OLD_1% · SOP-CF 가운데 번호 꼴은 OLD-7 하나다
        assert set(patterns) == {"%OLD-7%"}


@pytest.mark.parametrize("guess", ["Zz-Ref-Text Synthetic", "zz-moved-sentence synthetic."])
def test_free_text_elsewhere_cannot_be_guessed_with_an_old_document_code(client: TestClient, guess: str) -> None:
    """작성자가 자기 Old 문서 번호를 남의 Bundle의 숨은 글(확정 참조 번호·이동 대상 코드)로 바꿔도 그 Bundle에서 선이 오지 않는다."""
    w = World(client)
    _plant_free_text_in_s()
    current = get_view(client, w.v_id, w.v_doc["id"])["document"]["revision"]
    response = client.patch(
        f"/api/bundles/{w.v_id}/documents/{w.v_doc['id']}", json={"revision": current, "doc_code": guess}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text

    for scope in SCOPES:
        response = client.get(f"/api/bundles/{w.v_id}/map", params={"scope": scope}, headers=AUTHOR)
        assert response.status_code == 200, response.text
        assert _edges_from(response.json(), f"old:{w.s_doc['id']}") == []
        assert [marker for marker in MARKERS if marker in response.text] == []


@pytest.mark.parametrize("guess", ["Zz-Ref-Text Synthetic", "zz-moved-sentence synthetic."])
def test_free_text_elsewhere_cannot_be_guessed_with_a_new_document_code(client: TestClient, guess: str) -> None:
    w = World(client)
    _plant_free_text_in_s()
    update_row(TargetDoc, w.v_sop, code=guess)

    for scope in SCOPES:
        response = client.get(f"/api/bundles/{w.v_id}/map", params={"scope": scope}, headers=AUTHOR)
        assert response.status_code == 200, response.text
        assert _edges_from(response.json(), f"old:{w.s_doc['id']}") == []
        assert [marker for marker in MARKERS if marker in response.text] == []


def test_linked_scope_draws_no_edge_to_a_third_bundle_with_the_same_number(client: TestClient) -> None:
    """M의 제안 줄과 S의 확정 줄이 가리키는 OLD-1이 셋째 Bundle에도 있다 — linked는 V 쪽 선만 긋는다."""
    w = World(client)
    third_id = create_bundle(client, title="SYNTHETIC map third", is_synthetic=True)["id"]
    twin = add_doc(client, third_id, "SYNTHETIC_OLD-1_Twin.docx", "Synthetic twin line.")
    response = set_members(client, third_id, [("prod.member", "author")])
    assert response.status_code == 200, response.text
    v, m, s, t = (f"old:{doc_id}" for doc_id in (w.v_doc["id"], w.m_doc["id"], w.s_doc["id"], twin["id"]))

    body = get_map(client, w.v_id)
    assert _edge(body, m, v, "ref") is not None and _edge(body, s, v, "ref") is not None
    # T에 닿는 선은 V 자신의 줄(REF_SELF "OLD-1 …")에서 나간 것 하나뿐 — 한쪽 끝이 V다
    assert [(e["source"], e["kind"], e["state"]) for e in body["edges"] if t in (e["source"], e["target"])] == [
        (v, "ref", "proposed"),
    ]


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


# --- 범위 all ---


def test_all_scope_lists_every_bundle_of_the_same_kind(client: TestClient) -> None:
    w = World(client)
    peer_id, peer_doc, _ = _add_peer(client)
    p, m, s = f"old:{peer_doc['id']}", f"old:{w.m_doc['id']}", f"old:{w.s_doc['id']}"

    body = get_map(client, w.v_id, scope="all")
    assert [b["id"] for b in body["bundles"]] == [w.v_id, w.m_id, w.s_id, peer_id]
    assert [(b["relation"], b["title"]) for b in body["bundles"] if b["id"] == peer_id] == [("summary", "")]
    assert _node(body, p)["bundle_id"] == peer_id
    assert _edges_from(body, p) == [{"source": p, "target": s, "kind": "ref", "state": "confirmed", "lines": 1}]
    assert [e for e in body["edges"] if (e["source"], e["target"]) == (p, m)] == []  # 남끼리의 추측은 세지 않는다

    linked = get_map(client, w.v_id)
    assert peer_id not in {b["id"] for b in linked["bundles"]}
    assert [n for n in linked["nodes"] if n["bundle_id"] == peer_id] == []
    assert [e for e in linked["edges"] if p in (e["source"], e["target"])] == []


def test_all_scope_draws_proposed_lines_only_at_this_bundle(client: TestClient) -> None:
    """M의 제안 줄과 S의 확정 줄이 가리키는 OLD-1이 P에도 있다 — P 쪽 선은 all의 확정 줄만이고 linked에는 없다."""
    w = World(client)
    _, _, (twin,) = _add_peer(client, "SYNTHETIC_OLD-1_Twin.docx")
    v, m, s, t = (f"old:{doc_id}" for doc_id in (w.v_doc["id"], w.m_doc["id"], w.s_doc["id"], twin["id"]))

    body = get_map(client, w.v_id, scope="all")
    assert _edge(body, m, v, "ref")["state"] == "proposed"
    assert _edge(body, m, t, "ref") is None
    assert {(e["kind"], e["state"]) for e in body["edges"] if (e["source"], e["target"]) == (s, t)} == {
        ("ref", "confirmed"), ("moved", "confirmed"),
    }

    linked = get_map(client, w.v_id)
    assert [e for e in linked["edges"] if t in (e["source"], e["target"]) and e["source"] != v] == []


@pytest.mark.parametrize("guess", ["Zz-Ref-Text Synthetic", "zz-moved-sentence synthetic."])
def test_all_scope_free_text_cannot_be_guessed_through_a_member_bundle(client: TestClient, guess: str) -> None:
    """범위 all은 남끼리의 확정 선도 긋는다 — 작성자가 M(구성원)의 문서 번호를 S의 숨은 글로 바꿔도 S에서 선이 오지 않는다."""
    w = World(client)
    _plant_free_text_in_s()
    current = get_view(client, w.m_id, w.m_doc["id"])["document"]["revision"]
    response = client.patch(
        f"/api/bundles/{w.m_id}/documents/{w.m_doc['id']}", json={"revision": current, "doc_code": guess}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text

    for bundle_id in (w.v_id, w.m_id):
        response = client.get(f"/api/bundles/{bundle_id}/map", params={"scope": "all"}, headers=AUTHOR)
        assert response.status_code == 200, response.text
        assert _edges_from(response.json(), f"old:{w.s_doc['id']}") == []
        assert [marker for marker in MARKERS if marker in response.text] == []


def test_linked_scope_has_no_edge_between_two_other_bundles(client: TestClient) -> None:
    w = World(client)
    _add_peer(client)

    body = get_map(client, w.v_id)
    own = {node["id"] for node in body["nodes"] if node["bundle_id"] == w.v_id}
    assert body["edges"]
    assert [e for e in body["edges"] if e["source"] not in own and e["target"] not in own] == []


def test_synthetic_and_real_bundles_never_share_a_map(client: TestClient) -> None:
    w = World(client)
    real_id = create_bundle(client, title="SYNTHETIC map real kind", is_synthetic=False)["id"]
    real_doc = add_doc(client, real_id, "SYNTHETIC_SOP-ABC-1016_Real.docx", "OLD-1 Real line")
    r, v, m = f"old:{real_doc['id']}", f"old:{w.v_doc['id']}", f"old:{w.m_doc['id']}"

    for scope in SCOPES:
        body = get_map(client, w.v_id, scope=scope)
        assert real_id not in {b["id"] for b in body["bundles"]}
        assert r not in {n["id"] for n in body["nodes"]}
        assert [e for e in body["edges"] if r in (e["source"], e["target"])] == []
        assert [n["id"] for n in body["nodes"] if n["number"] == "SOP-ABC-1016"] == [m]
        assert _edge(body, v, m, "ref") is not None

        own = get_map(client, real_id, scope=scope)
        assert [b["id"] for b in own["bundles"]] == [real_id]
        assert [n["id"] for n in own["nodes"]] == [r, "num:OLD-1"]
        assert own["edges"] == [{"source": r, "target": "num:OLD-1", "kind": "ref", "state": "proposed", "lines": 1}]


def test_response_carries_only_the_listed_fields(client: TestClient) -> None:
    w = World(client)
    _add_peer(client)

    for scope in SCOPES:
        assert _collect_keys(get_map(client, w.v_id, scope=scope)) == MAP_KEYS


def test_no_text_of_a_non_member_bundle_leaves_the_server(
    client: TestClient, enforce: None, demo_access: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_grant("user", "qa.member", permission="bundle.create")  # 권한 판정을 켠 채 World를 만든다
    w = World(client)
    _add_peer(client, "SYNTHETIC_OLD-1_Twin.docx")  # P는 범위 all만 실어 온다 — P의 문장에도 표시 글자를 심었다
    markers = (*MARKERS, *PEER_MARKERS)

    def check(headers: dict[str, str]) -> None:
        for scope in SCOPES:
            response = client.get(f"/api/bundles/{w.v_id}/map", params={"scope": scope}, headers=headers)
            assert response.status_code == 200, response.text
            assert [marker for marker in markers if marker in response.text] == []

    check(AUTHOR)
    check(REVIEWER)
    monkeypatch.setattr(settings, "app_sysadmins", "ops.member")
    check(OPS)
    monkeypatch.setattr(settings, "app_sysadmins", "")
    add_grant("user", "ops.member", permission="bundle.admin")
    check(OPS)

    # S의 구성원에게도 이 응답에는 문장이 없다 — 자기 Bundle 제목만 실린다
    for scope in SCOPES:
        response = client.get(f"/api/bundles/{w.s_id}/map", params={"scope": scope}, headers=OUTSIDER)
        assert response.status_code == 200, response.text
        assert [marker for marker in markers if marker in response.text] == ["ZZ-BUNDLE-TITLE"]
        assert [text for text in ("Operation of UV", "Calibrate the rotor", "Balance the tubes") if text in response.text] == []


def _count_map_statements(bundle_id: int, scope: str) -> int:
    """구성원 판정(의존성)을 빼고 build_reference_map 하나가 낸 질의 수."""

    async def build(session: AsyncSession) -> int:
        bundle = await session.get(Bundle, bundle_id)
        assert bundle is not None
        ctx = BundleContext(bundle=bundle, login_id="qa.member", role="author")
        with _record_statements() as statements:
            await ref_map.build_reference_map(session, ctx, scope)  # type: ignore[arg-type]
        return len(statements)

    return run_in_session(build)


def test_query_count_does_not_grow_with_bundles(client: TestClient) -> None:
    w = World(client)
    before = {scope: _count_map_statements(w.v_id, scope) for scope in SCOPES}

    pointer = "OLD-1 Synthetic pointer line"
    for index in range(9):
        bundle_id = create_bundle(client, title=f"SYNTHETIC map pointer {index}", is_synthetic=True)["id"]
        doc = add_doc(client, bundle_id, f"SYNTHETIC_SOP-ABC-{2000 + index}_Pointer.docx", pointer)
        if index % 2:  # 절반은 확정 — 범위 all의 남의 확정 줄 길도 행을 싣는다
            assert edit(client, bundle_id, doc["id"], {
                "type": "set_ref", "unit_id": find_line(client, bundle_id, doc["id"], pointer)["id"], "number": "OLD-1",
            }).status_code == 200
    after = {scope: _count_map_statements(w.v_id, scope) for scope in SCOPES}

    assert len(get_map(client, w.v_id, scope="all")["bundles"]) == 12
    assert after == before
    assert all(0 < count <= MAX_MAP_STATEMENTS for count in after.values()), after


def test_reading_the_map_writes_nothing(client: TestClient) -> None:
    w = World(client)
    bundle_ids = (w.v_id, w.m_id, w.s_id)
    doc_ids = (w.v_doc["id"], w.m_doc["id"], w.s_doc["id"])

    async def read_state(session: AsyncSession) -> tuple[Any, ...]:
        events = await session.scalar(select(func.count()).select_from(BundleEvent))
        bundles = (await session.execute(
            select(Bundle.id, Bundle.revision, Bundle.updated_at).where(Bundle.id.in_(bundle_ids)).order_by(Bundle.id)
        )).all()
        docs = (await session.execute(
            select(Document.id, Document.revision).where(Document.id.in_(doc_ids)).order_by(Document.id)
        )).all()
        return events, [tuple(row) for row in bundles], [tuple(row) for row in docs]

    before = run_in_session(read_state)
    with _record_statements() as statements:
        for scope in SCOPES:
            get_map(client, w.v_id, scope=scope)
            get_map(client, w.s_id, OUTSIDER, scope=scope)
    after = run_in_session(read_state)

    assert len(before[1]) == len(before[2]) == 3
    assert after == before
    # 요청이 낸 질의는 모두 잠그지 않는 SELECT다(의존성의 구성원 판정 포함)
    assert statements
    assert [sql for sql, _ in statements if not sql.lstrip().upper().startswith("SELECT")] == []
    assert [sql for sql, _ in statements if "FOR UPDATE" in sql.upper() or "FOR SHARE" in sql.upper()] == []


def test_map_is_cut_at_the_node_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    w = World(client)
    _add_peer(client)
    v = f"old:{w.v_doc['id']}"

    for scope in SCOPES:
        monkeypatch.setattr(ref_map, "MAX_NODES", 2)
        monkeypatch.setattr(ref_map, "MAX_EDGES", 10000)
        body = get_map(client, w.v_id, scope=scope)
        kept = [node["id"] for node in body["nodes"]]
        assert body["truncated"] is True
        assert len(kept) == 2 and kept[0] == v
        assert body["edges"] and all(e["source"] in kept and e["target"] in kept for e in body["edges"])

        monkeypatch.setattr(ref_map, "MAX_NODES", 2000)
        monkeypatch.setattr(ref_map, "MAX_EDGES", 1)
        body = get_map(client, w.v_id, scope=scope)
        assert body["truncated"] is True
        assert len(body["edges"]) == 1 and v in (body["edges"][0]["source"], body["edges"][0]["target"])


# --- 줄과 선이 한 규칙 · 제안 줄은 구성원에게만 (Fix round 1) ---


def _expand_links(bundle_id: int, login_id: str, scope: str) -> Counter[tuple[str, str, str, str]]:
    """collect_map_lines가 돌려준 (줄, 끝 마디)를 선의 열쇠로 센다."""

    async def collect(session: AsyncSession) -> Counter[tuple[str, str, str, str]]:
        bundle = await session.get(Bundle, bundle_id)
        assert bundle is not None
        member_of = await ref_map.load_member_bundle_ids(session, login_id)
        links = await ref_map.collect_map_lines(session, bundle, member_of, scope)  # type: ignore[arg-type]
        return Counter((f"old:{link.line.document_id}", link.end.id, link.line.kind, link.line.state) for link in links)

    return run_in_session(collect)


def test_map_lines_match_the_edges(client: TestClient) -> None:
    """문장 API가 다시 쓸 줄(collect_map_lines)은 지도의 선과 줄 수에 꼭 맞는다 — 줄 규칙을 두 번 쓰지 않는다."""
    w = World(client)
    _add_peer(client, "SYNTHETIC_OLD-1_Twin.docx")  # 셋째 Bundle의 같은 번호 · 남끼리의 확정 선 · 남의 제안 줄

    for bundle_id, login_id, headers in (
        (w.v_id, "qa.member", AUTHOR), (w.v_id, "ops.member", OPS), (w.m_id, "qa.member", AUTHOR),
        (w.s_id, "prod.member", OUTSIDER),
    ):
        for scope in SCOPES:
            body = get_map(client, bundle_id, headers, scope)
            assert body["truncated"] is False and body["edges"]
            edges = Counter({(e["source"], e["target"], e["kind"], e["state"]): e["lines"] for e in body["edges"]})
            assert _expand_links(bundle_id, login_id, scope) == edges, (bundle_id, login_id, scope)


def _upload_as(client: TestClient, bundle_id: int, headers: dict[str, str], file_name: str, *lines: str) -> dict:
    response = upload(client, bundle_id, build_docx("".join(p(text) for text in lines)), file_name, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_unconfirmed_lines_count_only_for_members_of_their_bundle(client: TestClient) -> None:
    """S의 숨은 문장이 HPLC-02로 시작한다. S의 구성원이 아닌 작성자가 자기 New 문서 번호를 HPLC-02로 바꿔도 답이 없다.

    맞힌 번호(HPLC-02)와 틀린 번호(HPLC-03)의 응답은 자기 문서 번호 말고는 글자까지 같다. S의 확정 줄은 그대로 보이고,
    S의 구성원이 되면 제안 선도 보인다.
    """
    w = World(client)
    hplc = _upload_as(client, w.s_id, OUTSIDER, "SYNTHETIC_SOP-ABC-1021_Hplc.docx", HPLC_LINE)
    h, v, s = f"old:{hplc['id']}", f"old:{w.v_doc['id']}", f"old:{w.s_doc['id']}"
    proposed = [{"source": h, "target": f"target:{w.v_sop}", "kind": "ref", "state": "proposed", "lines": 1}]

    bodies: dict[tuple[str, str], str] = {}
    for guess in ("HPLC-02", "HPLC-03"):
        update_row(TargetDoc, w.v_sop, code=guess)
        for scope in SCOPES:
            response = client.get(f"/api/bundles/{w.v_id}/map", params={"scope": scope}, headers=AUTHOR)
            assert response.status_code == 200, response.text
            assert _edges_from(response.json(), h) == []
            assert "ZZ-HPLC" not in response.text
            bodies[(guess, scope)] = response.text
    for scope in SCOPES:
        assert bodies[("HPLC-03", scope)].replace("HPLC-03", "HPLC-02") == bodies[("HPLC-02", scope)]

    assert _edge(get_map(client, w.v_id), s, v, "ref")["state"] == "confirmed"  # 확정 줄은 구성원 아닌 사람에게도 선이다

    update_row(TargetDoc, w.v_sop, code="HPLC-02")
    response = set_members(client, w.s_id, [("prod.member", "author"), ("qa.member", "author")], headers=OUTSIDER)
    assert response.status_code == 200, response.text
    for scope in SCOPES:
        assert _edges_from(get_map(client, w.v_id, scope=scope), h) == proposed


def test_end_nodes_without_an_edge_are_dropped(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """질의 사이에 출발 문서가 지워지면 그 선이 빠진다 — 그 선에만 매달린 num 마디도 남지 않는다.

    한 요청 안의 동시 삭제는 시험에서 일으킬 수 없어, Old 마디를 읽는 단계가 그 문서를 못 본 것으로 흉내 낸다.
    """
    w = World(client)
    extra = add_doc(client, w.v_id, "SYNTHETIC_OLD-7_Extra.docx", "SOP-ZZ-405 Synthetic missing document")
    vanished = f"old:{extra['id']}"
    assert _edges_from(get_map(client, w.v_id), vanished) == [
        {"source": vanished, "target": "num:SOP-ZZ-405", "kind": "ref", "state": "proposed", "lines": 1},
    ]
    load_old_nodes = ref_map._load_old_nodes

    async def load_without_extra(*args: Any, **kwargs: Any) -> Any:
        nodes = await load_old_nodes(*args, **kwargs)
        nodes.pop(vanished, None)
        return nodes

    monkeypatch.setattr(ref_map, "_load_old_nodes", load_without_extra)
    for scope in SCOPES:
        body = get_map(client, w.v_id, scope=scope)
        ids = {node["id"] for node in body["nodes"]}
        assert vanished not in ids and "num:SOP-ZZ-405" not in ids
        assert "num:SOP-ZZ-404" in ids  # 선이 남은 num 마디는 그대로다


def test_non_members_get_document_titles_but_not_bundle_titles(client: TestClient) -> None:
    """지금 정한 그대로를 박는다 — 구성원 아닌 Bundle의 Old 문서 제목(기본값은 파일 이름의 나머지)은 실리고 Bundle 제목은 안 실린다."""
    w = World(client)
    peer_id, peer_doc, _ = _add_peer(client)

    response = client.get(f"/api/bundles/{w.v_id}/map", params={"scope": "all"}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    body = response.json()
    assert _node(body, f"old:{peer_doc['id']}")["title"] == peer_doc["title"] == "SYNTHETIC Peer"
    assert [b["title"] for b in body["bundles"] if b["id"] == peer_id] == [""]
    assert "SYNTHETIC map peer" not in response.text
