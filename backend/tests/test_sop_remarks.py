"""Remark 고르기 도움 — 내 최근 사유(GET /api/sop/remarks/recent)와 외부 이동 대상 후보(GET /api/bundles/{id}/move-targets)."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.sop.models import BundleEvent
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    create_bundle,
    find_unit,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

RECENT = "/api/sop/remarks/recent"
TEXTS = ("합성 문장 하나.", "합성 문장 둘.", "합성 문장 셋.", "합성 문장 넷.")


def _setup(client: TestClient, title: str = "Bundle") -> tuple[int, dict]:
    bundle_id = create_bundle(client, title=title, is_synthetic=True)["id"]
    data = build_docx("".join(p(text) for text in TEXTS))
    response = upload(client, bundle_id, data, f"SYNTHETIC_OLD-{bundle_id}_Remarks.docx")
    assert response.status_code == 201, response.text
    return bundle_id, get_view(client, bundle_id, response.json()["id"])


def _revision(client: TestClient, bundle_id: int, unit: dict) -> int:
    return get_group_by_unit(client, bundle_id, unit["id"])["units"][0]["decision"]["revision"]


def _bulk(client: TestClient, bundle_id: int, unit: dict, reason: str, code: str = "") -> None:
    body = {
        "action": "move_external" if code else "delete", "reason": reason, "move_target_code": code,
        "units": [{"unit_id": unit["id"], "revision": _revision(client, bundle_id, unit)}],
    }
    response = client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


def _hold(client: TestClient, bundle_id: int, unit: dict, reason: str) -> None:
    body = {
        "action": "hold", "hold_reason": reason, "targets": [],
        "units": [{"unit_id": unit["id"], "revision": _revision(client, bundle_id, unit), "disposition": "unassigned"}],
    }
    response = save_group(client, bundle_id, body)
    assert response.status_code == 200, response.text


def _recent(client: TestClient, headers: dict[str, str] = AUTHOR, **params: object) -> list[str]:
    response = client.get(RECENT, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [item["text"] for item in response.json()]


def _move_targets(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR, **params: object) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/move-targets", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_recent_remarks_are_mine_newest_first_and_unique(client: TestClient) -> None:
    first, view = _setup(client, "First")
    second, other_view = _setup(client, "Second")
    _bulk(client, first, find_unit(view, TEXTS[0]), "Synthetic: obsolete step")
    _hold(client, first, find_unit(view, TEXTS[1]), "Synthetic: ask the owner")
    _bulk(client, second, find_unit(other_view, TEXTS[0]), "Synthetic: moved to QA", code="SOP-QA-001")
    # 같은 글을 다시 쓰면 한 번만, 가장 최근 자리에
    _bulk(client, second, find_unit(other_view, TEXTS[1]), "Synthetic: obsolete step")

    assert _recent(client) == ["Synthetic: obsolete step", "Synthetic: moved to QA", "Synthetic: ask the owner"]
    # 남의 사유는 보이지 않는다
    assert _recent(client, REVIEWER) == []


def test_recent_remarks_skip_system_reasons_and_respect_limit(client: TestClient) -> None:
    bundle_id, view = _setup(client)
    for index, text in enumerate(TEXTS):
        _bulk(client, bundle_id, find_unit(view, text), f"Synthetic reason {index}")

    async def _add_system_event(session: AsyncSession) -> None:
        session.add(BundleEvent(
            bundle_id=bundle_id, actor="qa.member", action="group.hold", target_type="unit", target_ids=[1],
            reason="system:related_unit_changed", detail={},
        ))
        await session.commit()
        # 시각을 미래로 - 맨 앞에 올 자리라도 사람 사유가 아니면 빠져야 한다
        await session.execute(
            update(BundleEvent).where(BundleEvent.reason.like("system:%")).values(occurred_at=now() + timedelta(hours=1))
        )
        await session.commit()

    run_in_session(_add_system_event)

    assert _recent(client, limit=2) == ["Synthetic reason 3", "Synthetic reason 2"]
    assert client.get(RECENT, params={"limit": 11}, headers=AUTHOR).status_code == 422


def test_move_targets_list_other_bundles_i_can_see(client: TestClient) -> None:
    here, _ = _setup(client, "Here")
    assert put_tobe(client, here, [{"code": "SOP-HERE", "title": "This bundle", "doc_type": "sop"}]).status_code == 200
    mine = create_bundle(client, title="Mine")["id"]
    docs = [
        {"code": "SOP-QA-001", "title": "Synthetic QA", "doc_type": "sop"},
        {"code": "SOP-PR-002", "title": "Synthetic production QA", "doc_type": "sop"},
    ]
    assert put_tobe(client, mine, docs).status_code == 200
    theirs = create_bundle(client, title="Theirs", headers=OUTSIDER)["id"]
    assert put_tobe(client, theirs, [{"code": "SOP-XX-999", "title": "Hidden", "doc_type": "sop"}], headers=OUTSIDER).status_code == 200

    items = _move_targets(client, here)

    # 이 묶음의 To-Be와 내가 멤버가 아닌 묶음의 문서는 없다
    assert [item["code"] for item in items] == ["SOP-PR-002", "SOP-QA-001"]
    assert items[0]["bundle_code"] == f"BND-{mine:04d}"
    assert [item["code"] for item in _move_targets(client, here, q="qa")] == ["SOP-QA-001", "SOP-PR-002"]
    assert _move_targets(client, here, q="nothing-like-this") == []


def test_move_targets_put_used_codes_first(client: TestClient) -> None:
    here, view = _setup(client, "Here")
    other = create_bundle(client, title="Other")["id"]
    assert put_tobe(client, other, [{"code": "SOP-AA-001", "title": "First by code", "doc_type": "sop"}]).status_code == 200
    _bulk(client, here, find_unit(view, TEXTS[0]), "Synthetic: moved", code="SOP-ZZ-900")

    items = _move_targets(client, here)

    assert [(item["code"], item["used"], item["bundle_code"]) for item in items] == [
        ("SOP-ZZ-900", "bundle", None), ("SOP-AA-001", None, f"BND-{other:04d}"),
    ]


def test_move_targets_need_membership(client: TestClient) -> None:
    here, _ = _setup(client)
    assert set_members(client, here, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200

    assert client.get(f"/api/bundles/{here}/move-targets", headers=OUTSIDER).status_code in (403, 404)
    assert client.get(f"/api/bundles/{here}/move-targets", headers=REVIEWER).status_code == 200
    assert client.get(f"/api/bundles/{here}/move-targets", params={"q": "x" * 101}, headers=AUTHOR).status_code == 422
