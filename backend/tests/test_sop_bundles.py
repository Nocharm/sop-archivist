"""묶음·멤버십·작업 기록·묶음 관리 — 비멤버 404, 역할 403, revision 409, 멤버 바꾸기 검사."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import KST
from app.models import Employee
from app.settings import settings
from app.sop.models import Bundle, BundleDeletionRecord, BundleEvent
from tests.access_helpers import add_grant, run_in_session, update_row
from tests.sop_helpers import ADMIN, AUTHOR, OUTSIDER, REVIEWER, create_bundle, get_bundle, set_members

pytestmark = pytest.mark.usefixtures("clean_sop")

OPS = {"X-Dev-User": "ops.member"}  # 이 파일에서 bundle.admin을 개인 부여하는 사람


def _count_bundles() -> int:
    async def _count(session: AsyncSession) -> int:
        return await session.scalar(select(func.count()).select_from(Bundle))

    return run_in_session(_count)


def _list_deletion_records() -> list[BundleDeletionRecord]:
    async def _list(session: AsyncSession) -> list[BundleDeletionRecord]:
        return list(await session.scalars(select(BundleDeletionRecord)))

    return run_in_session(_list)


def _get_events(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/events", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _patch_title(client: TestClient, bundle_id: int, revision: int, title: str, headers: dict[str, str] = AUTHOR):
    return client.patch(f"/api/bundles/{bundle_id}", json={"revision": revision, "title": title}, headers=headers)


# ── 만들기·목록·읽기 ───────────────────────────────────────────────────────────


def test_create_bundle_makes_creator_author(client: TestClient) -> None:
    bundle = create_bundle(client, title="TF bundle")

    assert bundle["title"] == "TF bundle"
    assert bundle["my_role"] == "author"
    assert bundle["status"] == "in_progress"
    assert bundle["revision"] == 1
    assert bundle["is_synthetic"] is False
    assert bundle["created_by"] == "qa.member"
    assert bundle["created_at"].endswith("+09:00")  # 응답 시각은 KST 오프셋
    assert bundle["members"] == [
        {"login_id": "qa.member", "role": "author", "name": "QA Member", "korean_name": "품질담당", "active": True}
    ]


def test_create_bundle_keeps_the_synthetic_flag_and_trims_the_title(client: TestClient) -> None:
    response = client.post("/api/bundles", json={"title": "  Demo  ", "is_synthetic": True}, headers=AUTHOR)

    assert response.status_code == 201
    assert response.json()["title"] == "Demo"
    assert response.json()["is_synthetic"] is True


@pytest.mark.parametrize("body", [{"title": ""}, {"title": "   "}, {"title": "x" * 201}, {}])
def test_create_bundle_rejects_a_bad_title(client: TestClient, body: dict) -> None:
    response = client.post("/api/bundles", json=body, headers=AUTHOR)

    assert response.status_code == 422
    assert _count_bundles() == 0


def test_list_shows_only_my_bundles_with_my_role(client: TestClient) -> None:
    mine = create_bundle(client, title="Mine")
    shared = create_bundle(client, title="Shared", headers=REVIEWER)
    set_members(client, shared["id"], [("qa.lead", "author"), ("qa.member", "reviewer")], headers=REVIEWER)
    create_bundle(client, title="Not mine", headers=REVIEWER)

    rows = client.get("/api/bundles", headers=AUTHOR).json()

    assert {row["id"]: (row["title"], row["my_role"]) for row in rows} == {
        mine["id"]: ("Mine", "author"),
        shared["id"]: ("Shared", "reviewer"),
    }
    assert set(rows[0]) == {"id", "title", "status", "my_role", "updated_at"}
    assert client.get("/api/bundles", headers=OUTSIDER).json() == []


def test_non_member_gets_404_even_sysadmin(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_sysadmins", "dev.admin")
    bundle = create_bundle(client)

    for headers in (ADMIN, OUTSIDER):
        for path in (f"/api/bundles/{bundle['id']}", f"/api/bundles/{bundle['id']}/events"):
            response = client.get(path, headers=headers)
            assert response.status_code == 404
            assert response.json() == {"detail": {"code": "bundle_not_found"}}
    # 없는 묶음과 모양이 같다 — 존재 여부를 흘리지 않는다
    missing = client.get("/api/bundles/999999", headers=AUTHOR)
    assert (missing.status_code, missing.json()) == (404, {"detail": {"code": "bundle_not_found"}})


def test_out_of_range_bundle_id_is_a_validation_error(client: TestClient) -> None:
    assert client.get("/api/bundles/0", headers=AUTHOR).status_code == 422
    assert client.get("/api/bundles/99999999999999999999", headers=AUTHOR).status_code == 422


@pytest.mark.usefixtures("clean_directory")
def test_retired_member_is_blocked(client: TestClient) -> None:
    bundle = create_bundle(client)
    assert set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    assert client.get(f"/api/bundles/{bundle['id']}", headers=REVIEWER).status_code == 200

    update_row(Employee, "qa.lead", active=False)

    for response in (
        client.get(f"/api/bundles/{bundle['id']}", headers=REVIEWER),
        client.get(f"/api/bundles/{bundle['id']}/events", headers=REVIEWER),
        client.get("/api/bundles", headers=REVIEWER),
    ):
        assert response.status_code == 403
        assert response.json() == {"detail": {"code": "inactive_account"}}


def test_user_without_an_employee_row_is_blocked(client: TestClient) -> None:
    ghost = {"X-Dev-User": "ghost.user"}

    response = client.get("/api/bundles/1", headers=ghost)

    assert (response.status_code, response.json()) == (403, {"detail": {"code": "inactive_account"}})


# ── 고치기·삭제 ───────────────────────────────────────────────────────────────


def test_author_patches_title_and_description_and_bumps_revision(client: TestClient) -> None:
    bundle = create_bundle(client, title="Before")

    response = client.patch(
        f"/api/bundles/{bundle['id']}",
        json={"revision": 1, "title": "After", "description": "Scope note"},
        headers=AUTHOR,
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["title"], body["description"], body["revision"]) == ("After", "Scope note", 2)
    assert get_bundle(client, bundle["id"])["title"] == "After"


def test_patch_with_only_one_field_keeps_the_other(client: TestClient) -> None:
    bundle = create_bundle(client, title="Keep me")

    client.patch(f"/api/bundles/{bundle['id']}", json={"revision": 1, "description": "Only this"}, headers=AUTHOR)

    after = get_bundle(client, bundle["id"])
    assert (after["title"], after["description"]) == ("Keep me", "Only this")


@pytest.mark.parametrize("body", [{"revision": 1}, {"revision": 1, "title": " "}, {"title": "No revision"}])
def test_patch_rejects_an_empty_or_malformed_body(client: TestClient, body: dict) -> None:
    bundle = create_bundle(client)

    response = client.patch(f"/api/bundles/{bundle['id']}", json=body, headers=AUTHOR)

    assert response.status_code == 422
    assert get_bundle(client, bundle["id"])["revision"] == 1


def test_reviewer_cannot_patch(client: TestClient) -> None:
    bundle = create_bundle(client, title="Original")
    set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "reviewer")])
    revision = get_bundle(client, bundle["id"])["revision"]

    response = _patch_title(client, bundle["id"], revision, "Hijacked", headers=REVIEWER)

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "role_required"
    assert get_bundle(client, bundle["id"])["title"] == "Original"


def test_reviewer_cannot_delete_or_replace_members(client: TestClient) -> None:
    bundle = create_bundle(client)
    set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "reviewer")])

    deleted = client.delete(f"/api/bundles/{bundle['id']}?revision=2", headers=REVIEWER)
    replaced = set_members(client, bundle["id"], [("qa.lead", "author")], headers=REVIEWER)

    assert (deleted.status_code, replaced.status_code) == (403, 403)
    assert {deleted.json()["detail"]["code"], replaced.json()["detail"]["code"]} == {"role_required"}
    assert _count_bundles() == 1


def test_patch_with_stale_revision_conflicts(client: TestClient) -> None:
    bundle = create_bundle(client, title="First")
    assert _patch_title(client, bundle["id"], 1, "Second").status_code == 200  # revision 2

    response = _patch_title(client, bundle["id"], 1, "Stale")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "revision_conflict"
    assert response.json()["detail"]["conflicts"][0] == {
        "entity": "bundle", "id": bundle["id"], "current_revision": 2,
    }
    assert get_bundle(client, bundle["id"])["title"] == "Second"  # 낡은 요청은 아무것도 바꾸지 못한다


def test_changes_are_refused_unless_the_bundle_is_in_progress(client: TestClient) -> None:
    bundle = create_bundle(client)
    update_row(Bundle, bundle["id"], status="in_review")

    patched = _patch_title(client, bundle["id"], 1, "Late")
    deleted = client.delete(f"/api/bundles/{bundle['id']}?revision=1", headers=AUTHOR)

    for response in (patched, deleted):
        assert response.status_code == 409
        assert response.json()["detail"] == {"code": "bundle_not_editable", "status": "in_review"}
    assert _count_bundles() == 1


def test_delete_records_global_trace(client: TestClient) -> None:
    bundle = create_bundle(client, title="To delete")
    set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "reviewer")])

    response = client.delete(f"/api/bundles/{bundle['id']}?revision=2", headers=AUTHOR)

    assert response.status_code == 204
    records = _list_deletion_records()
    assert [(record.bundle_id, record.title, record.actor) for record in records] == [
        (bundle["id"], "To delete", "qa.member")
    ]
    assert client.get(f"/api/bundles/{bundle['id']}", headers=AUTHOR).status_code == 404
    assert client.get(f"/api/bundles/{bundle['id']}", headers=REVIEWER).status_code == 404  # 멤버 행도 함께 사라진다


def test_delete_with_stale_revision_changes_nothing(client: TestClient) -> None:
    bundle = create_bundle(client)
    _patch_title(client, bundle["id"], 1, "Edited")

    response = client.delete(f"/api/bundles/{bundle['id']}?revision=1", headers=AUTHOR)

    assert response.status_code == 409
    assert response.json()["detail"]["conflicts"][0]["current_revision"] == 2
    assert _count_bundles() == 1
    assert _list_deletion_records() == []


def test_delete_requires_a_revision(client: TestClient) -> None:
    bundle = create_bundle(client)

    assert client.delete(f"/api/bundles/{bundle['id']}", headers=AUTHOR).status_code == 422
    assert _count_bundles() == 1


# ── 멤버 바꾸기 ───────────────────────────────────────────────────────────────


def test_author_replaces_members_and_keeps_who_added_whom(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "reviewer")])

    assert response.status_code == 200
    body = response.json()
    assert body["revision"] == 2
    assert body["my_role"] == "author"
    assert [(m["login_id"], m["role"]) for m in body["members"]] == [("qa.member", "author"), ("qa.lead", "reviewer")]
    assert body["members"][1]["korean_name"] == "품질리드"

    # 통째로 바꾸기 — 빠진 사람은 접근을 잃고, 남은 사람의 역할은 바뀐다
    again = set_members(client, bundle["id"], [("qa.lead", "author")])
    assert again.status_code == 200
    assert [(m["login_id"], m["role"]) for m in again.json()["members"]] == [("qa.lead", "author")]
    assert again.json()["my_role"] is None  # 호출한 작성자는 목록에서 빠졌다
    assert client.get(f"/api/bundles/{bundle['id']}", headers=AUTHOR).status_code == 404
    assert client.get(f"/api/bundles/{bundle['id']}", headers=REVIEWER).json()["my_role"] == "author"


def test_members_rules(client: TestClient) -> None:
    bundle = create_bundle(client)

    no_author = set_members(client, bundle["id"], [("qa.member", "reviewer")])
    nobody = set_members(client, bundle["id"], [])
    unknown = set_members(client, bundle["id"], [("qa.member", "author"), ("nobody.here", "reviewer")])
    duplicate = set_members(client, bundle["id"], [("qa.member", "author"), ("qa.member", "reviewer")])

    assert (no_author.status_code, no_author.json()["detail"]["code"]) == (422, "no_active_author")
    assert (nobody.status_code, nobody.json()["detail"]["code"]) == (422, "no_active_author")
    assert (unknown.status_code, unknown.json()["detail"]) == (
        422, {"code": "unknown_member", "login_ids": ["nobody.here"]},
    )
    assert (duplicate.status_code, duplicate.json()["detail"]) == (
        422, {"code": "duplicate_member", "login_ids": ["qa.member"]},
    )
    after = get_bundle(client, bundle["id"])
    assert (after["revision"], [m["login_id"] for m in after["members"]]) == (1, ["qa.member"])  # 거절은 아무것도 바꾸지 않는다


@pytest.mark.usefixtures("clean_directory")
def test_retired_person_cannot_be_added_as_member(client: TestClient) -> None:
    bundle = create_bundle(client)
    update_row(Employee, "prod.member", active=False)

    response = set_members(client, bundle["id"], [("qa.member", "author"), ("prod.member", "reviewer")])

    assert response.status_code == 422
    assert response.json()["detail"] == {"code": "unknown_member", "login_ids": ["prod.member"]}


def test_members_can_change_while_the_bundle_is_in_review(client: TestClient) -> None:
    bundle = create_bundle(client)
    update_row(Bundle, bundle["id"], status="in_review")

    response = set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "reviewer")])

    assert response.status_code == 200  # 검토 대기 중에도 검토자를 더할 수 있다
    assert response.json()["status"] == "in_review"


def test_members_with_stale_revision_conflict(client: TestClient) -> None:
    bundle = create_bundle(client)
    members = [{"login_id": "qa.member", "role": "author"}, {"login_id": "qa.lead", "role": "reviewer"}]
    body = {"revision": 1, "members": members}
    _patch_title(client, bundle["id"], 1, "Moved on")  # revision 2

    response = client.put(f"/api/bundles/{bundle['id']}/members", json=body, headers=AUTHOR)

    assert response.status_code == 409
    assert response.json()["detail"]["conflicts"] == [
        {"entity": "bundle", "id": bundle["id"], "current_revision": 2}
    ]
    assert [m["login_id"] for m in get_bundle(client, bundle["id"])["members"]] == ["qa.member"]


def test_unchanged_members_do_not_bump_revision_or_log(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = set_members(client, bundle["id"], [("qa.member", "author")])

    assert response.status_code == 200
    assert response.json()["revision"] == 1
    assert [event["action"] for event in _get_events(client, bundle["id"])] == ["bundle.create"]


@pytest.mark.parametrize("role", ["owner", ""])
def test_member_role_must_be_a_known_role(client: TestClient, role: str) -> None:
    bundle = create_bundle(client)

    response = set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", role)])

    assert response.status_code == 422


# ── 권한 ──────────────────────────────────────────────────────────────────────


@pytest.mark.usefixtures("enforce", "demo_access")
def test_create_requires_permission(client: TestClient) -> None:
    denied = client.post("/api/bundles", json={"title": "No right"}, headers=OUTSIDER)

    assert denied.status_code == 403
    assert denied.json() == {"detail": "missing permission: bundle.create"}
    assert _count_bundles() == 0

    add_grant("user", "prod.member", permission="bundle.create")
    allowed = client.post("/api/bundles", json={"title": "With right"}, headers=OUTSIDER)
    assert allowed.status_code == 201


# ── 묶음 관리(bundle.admin) ───────────────────────────────────────────────────


@pytest.mark.usefixtures("demo_access", "clean_directory")
def test_admin_list_shows_meta_and_orphans(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = create_bundle(client, title="Orphan candidate")  # 권한 강제를 켜기 전에 만든다
    healthy = create_bundle(client, title="Healthy", headers=REVIEWER)
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    add_grant("user", "ops.member", permission="bundle.admin")
    update_row(Employee, "qa.member", active=False)  # 작성자 퇴직

    rows = {row["id"]: row for row in client.get("/api/admin/bundles", headers=OPS).json()}

    orphan = rows[bundle["id"]]
    assert set(orphan) == {"id", "title", "status", "revision", "members", "has_active_author", "created_at"}  # 내용 없음
    assert orphan["has_active_author"] is False
    assert [(m["login_id"], m["active"]) for m in orphan["members"]] == [("qa.member", False)]
    assert rows[healthy["id"]]["has_active_author"] is True
    assert client.get("/api/admin/bundles", headers=AUTHOR).status_code == 403  # bundle.admin이 없다
    assert client.get(f"/api/bundles/{bundle['id']}", headers=OPS).status_code == 404  # 목록 권한은 내용을 열지 않는다

    # 관리자가 자기를 작성자로 넣어 정리하면 그 사실이 작업 기록에 남는다
    response = client.put(
        f"/api/admin/bundles/{bundle['id']}/members",
        json={"revision": orphan["revision"], "members": [{"login_id": "ops.member", "role": "author"}]},
        headers=OPS,
    )
    assert response.status_code == 200
    assert response.json()["has_active_author"] is True
    latest = _get_events(client, bundle["id"], headers=OPS)[0]
    assert (latest["action"], latest["reason"], latest["actor"]) == ("bundle.members", "admin", "ops.member")
    assert set(latest["target_ids"]) == {"ops.member", "qa.member"}
    assert client.get(f"/api/bundles/{bundle['id']}", headers=OPS).json()["my_role"] == "author"


@pytest.mark.usefixtures("demo_access", "enforce")
def test_admin_member_change_checks_revision_and_target(client: TestClient) -> None:
    add_grant("user", "ops.member", permission="bundle.admin")
    # 권한 강제가 켜진 채라 만들기 권한도 필요하다
    add_grant("user", "qa.member", permission="bundle.create")
    bundle = create_bundle(client)
    body = {"revision": 99, "members": [{"login_id": "ops.member", "role": "author"}]}

    stale = client.put(f"/api/admin/bundles/{bundle['id']}/members", json=body, headers=OPS)
    missing = client.put("/api/admin/bundles/999999/members", json=body, headers=OPS)

    assert stale.status_code == 409
    assert stale.json()["detail"]["conflicts"] == [{"entity": "bundle", "id": bundle["id"], "current_revision": 1}]
    assert (missing.status_code, missing.json()) == (404, {"detail": {"code": "bundle_not_found"}})
    assert client.get(f"/api/bundles/{bundle['id']}", headers=OPS).status_code == 404  # 거절된 요청은 멤버를 더하지 않았다


# ── 작업 기록 ─────────────────────────────────────────────────────────────────


def test_events_list_newest_first(client: TestClient) -> None:
    bundle = create_bundle(client)
    bundle_id = bundle["id"]
    _patch_title(client, bundle_id, 1, "Renamed")
    set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")])

    events = _get_events(client, bundle_id)

    assert [event["action"] for event in events] == ["bundle.members", "bundle.update", "bundle.create"]
    assert events[0]["actor"] == "qa.member"
    assert (events[0]["target_type"], events[0]["target_ids"]) == ("member", ["qa.lead"])  # 바뀐 사람만 가리킨다
    assert (events[1]["target_type"], events[1]["target_ids"]) == ("bundle", [bundle_id])
    assert events[0]["occurred_at"].endswith("+09:00")
    assert [event["action"] for event in _get_events(client, bundle_id, headers=REVIEWER)] == [
        "bundle.members", "bundle.update", "bundle.create"
    ]  # 검토자도 읽는다
    limited = client.get(f"/api/bundles/{bundle_id}/events?limit=2", headers=AUTHOR).json()
    assert [event["action"] for event in limited] == ["bundle.members", "bundle.update"]
    assert client.get(f"/api/bundles/{bundle_id}/events?limit=0", headers=AUTHOR).status_code == 422


def test_events_with_the_same_time_are_ordered_by_id(client: TestClient) -> None:
    bundle = create_bundle(client)
    same_time = datetime(2030, 1, 1, tzinfo=KST)  # 지금보다 뒤라 목록 맨 앞에 온다

    async def _add(session: AsyncSession) -> None:
        for action in ("tie.first", "tie.second", "tie.third"):
            session.add(BundleEvent(bundle_id=bundle["id"], occurred_at=same_time, actor="qa.member", action=action))
        await session.commit()

    run_in_session(_add)

    events = _get_events(client, bundle["id"])

    assert [event["action"] for event in events[:3]] == ["tie.third", "tie.second", "tie.first"]


def test_events_stay_private_to_the_bundle(client: TestClient) -> None:
    mine = create_bundle(client)
    other = create_bundle(client, headers=REVIEWER)
    _patch_title(client, other["id"], 1, "Other edit", headers=REVIEWER)

    assert [event["action"] for event in _get_events(client, mine["id"])] == ["bundle.create"]
