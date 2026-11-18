"""SOP 표준 골격 관리 API(/api/admin/outline) — 권한, 읽기, 통째로 바꾸기와 거절 사유, 바꾼 표준이 새 문서부터 적용되는지.

표준 표는 세션이 공유하고 SOP 문서를 만드는 다른 시험이 이것을 복사하므로, 모든 시험이 restore_outline_standard로 앞뒤 상태를 지킨다.
"""

import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.sop.models import OutlineStandardItem
from app.sop.outline import TEMPLATE_OUTLINE, load_doc_outlines
from tests.access_helpers import add_grant, run_in_session
from tests.sop_helpers import ADMIN, AUTHOR, NEW_SOP_KEYS, create_bundle, put_tobe

OUTLINE = "/api/admin/outline"
NOBODY = {"X-Dev-User": "dev.admin"}  # enforce 모드에서 데모 부여가 없는 사람
MANAGER = {"X-Dev-User": "qa.member"}
ITEM_KEYS = {"key", "title_en", "title_ko", "kind", "is_required", "default_style", "child_prefix", "suggestions"}


@pytest.fixture
def restore_outline_standard(client: TestClient) -> Iterator[None]:
    """표준 골격 표를 시험 전 상태로 되돌린다 — lifespan이 한 번만 시드하고 표는 세션이 공유한다."""
    columns = [attr.key for attr in inspect(OutlineStandardItem).mapper.column_attrs]

    async def _read() -> list[dict[str, Any]]:
        async with SessionLocal() as session:
            rows = await session.scalars(select(OutlineStandardItem))
            return [{column: getattr(row, column) for column in columns} for row in rows]

    async def _restore(saved: list[dict[str, Any]]) -> None:
        async with SessionLocal() as session:
            await session.execute(delete(OutlineStandardItem))
            session.add_all(OutlineStandardItem(**row) for row in saved)
            await session.commit()

    saved_rows = asyncio.run(_read())
    yield
    asyncio.run(_restore(saved_rows))


pytestmark = pytest.mark.usefixtures("clean_sop", "restore_outline_standard")


def _item(key: str, **overrides: object) -> dict:
    return {
        "key": key, "title_en": f"Synthetic {key}", "title_ko": "", "kind": "general", "is_required": True,
        "default_style": "numbered", "child_prefix": "", "suggestions": [], **overrides,
    }


def _put(client: TestClient, items: list[dict], headers: dict[str, str] = ADMIN):
    return client.put(OUTLINE, json={"items": items}, headers=headers)


def _get_items(client: TestClient) -> list[dict]:
    response = client.get(OUTLINE, headers=ADMIN)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _read_standard() -> list[tuple[str, int]]:
    async def _read(session: AsyncSession) -> list[tuple[str, int]]:
        rows = await session.execute(
            select(OutlineStandardItem.key, OutlineStandardItem.order_index).order_by(OutlineStandardItem.order_index)
        )
        return [tuple(row) for row in rows]

    return run_in_session(_read)


def _load_doc_outline_keys(target_doc_id: int) -> list[str]:
    """문서 사본의 키 — 골격 순서(부모 바로 뒤에 하위)."""
    async def _load(session: AsyncSession) -> list[str]:
        outline = (await load_doc_outlines(session, [target_doc_id]))[target_doc_id]
        return [item.key for item in outline.items]

    return run_in_session(_load)


def _assert_rejected(response, reason: str, index: int | None = None) -> None:
    assert response.status_code == 422, response.text
    expected = {"code": "outline_invalid", "reason": reason}
    if index is not None:
        expected["index"] = index
    assert response.json()["detail"] == expected


# ── 권한 ───────────────────────────────────────────────────────────────────────


@pytest.mark.usefixtures("enforce", "clean_directory", "demo_access")
def test_admin_requires_permission(client: TestClient) -> None:
    before = _read_standard()
    body = {"items": [_item("only")]}

    for method, payload in (("GET", None), ("PUT", body)):
        denied = client.request(method, OUTLINE, json=payload, headers=NOBODY)
        assert denied.status_code == 403, method
        assert denied.json() == {"detail": "missing permission: outline.manage"}
    assert _read_standard() == before  # 거절된 요청은 표준을 바꾸지 않는다

    add_grant("user", "qa.member", permission="outline.manage")
    for method, payload in (("GET", None), ("PUT", body)):
        allowed = client.request(method, OUTLINE, json=payload, headers=MANAGER)
        assert allowed.status_code == 200, (method, allowed.text)


# ── 읽기 ───────────────────────────────────────────────────────────────────────


def test_admin_get_returns_seed(client: TestClient) -> None:
    items = _get_items(client)

    # 기본 표준은 회사 SOP 템플릿 1–9장이다 — 첫 절차(Procedure 1)는 표준이 아니라 새 문서의 사본에만 생긴다
    assert [item["key"] for item in items] == [item.key for item in TEMPLATE_OUTLINE]
    assert len(items) == 16
    assert all(set(item) == ITEM_KEYS for item in items)  # order_index는 싣지 않는다 — 순서가 곧 자리다
    assert [(item["title_en"], item["kind"], item["is_required"], item["default_style"]) for item in items] == [
        (item.title_en, item.kind, item.is_required, item.default_style) for item in TEMPLATE_OUTLINE
    ]
    assert items[4] == {
        "key": "general_requirements", "title_en": "General Requirements", "title_ko": "", "kind": "category_table",
        "is_required": True, "default_style": "bullet", "child_prefix": "",
        "suggestions": [
            "Safety", "Account", "Qualification", "Equipment", "Work", "Excursion/Alarm", "Material", "Training",
            "Record", "Quality", "Caution", "Data Management",
        ],
    }
    assert items[-1] == {
        "key": "appendices", "title_en": "Appendices", "title_ko": "", "kind": "named_children", "is_required": True,
        "default_style": "numbered", "child_prefix": "Appendix", "suggestions": [],
    }


# ── 통째로 바꾸기 ──────────────────────────────────────────────────────────────


def test_admin_put_replaces_and_orders(client: TestClient) -> None:
    items = [
        _item("scope", title_en="  Scope  ", title_ko="적용 범위", is_required=False, default_style="bullet"),
        # order_index를 보내도 받지 않는다 — 자리는 목록 순서다
        _item("purpose", kind="named_children", child_prefix="Appendix", suggestions=["Safety", " Quality "], order_index=99),
        _item("purpose.detail"),
    ]

    response = _put(client, items)

    assert response.status_code == 200, response.text
    saved = response.json()["items"]
    assert [item["key"] for item in saved] == ["scope", "purpose", "purpose.detail"]
    assert all(set(item) == ITEM_KEYS for item in saved)
    assert saved[0] == {
        "key": "scope", "title_en": "Scope", "title_ko": "적용 범위", "kind": "general", "is_required": False,
        "default_style": "bullet", "child_prefix": "", "suggestions": [],
    }
    assert (saved[1]["kind"], saved[1]["child_prefix"], saved[1]["suggestions"]) == (
        "named_children", "Appendix", ["Safety", "Quality"],
    )
    assert _get_items(client) == saved
    # 전에 있던 표준 항목 가운데 목록에 없는 것은 지워지고 자리는 0부터 다시 매긴다
    assert _read_standard() == [("scope", 0), ("purpose", 1), ("purpose.detail", 2)]


def test_admin_put_twice_keeps_the_last_list(client: TestClient) -> None:
    assert _put(client, [_item("a"), _item("b"), _item("c")]).status_code == 200

    response = _put(client, [_item("c", title_en="Third first"), _item("a")])

    assert response.status_code == 200, response.text
    assert [(item["key"], item["title_en"]) for item in _get_items(client)] == [
        ("c", "Third first"), ("a", "Synthetic a"),
    ]
    assert _read_standard() == [("c", 0), ("a", 1)]


# ── 거절 사유 ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("key", ["A b", "a:b", "a.", ".a", "a..b", "1a", "a-b", "", "a\n", "a" * 101])
def test_admin_rejects_bad_key(client: TestClient, key: str) -> None:
    before = _read_standard()

    response = _put(client, [_item("first"), _item(key)])

    _assert_rejected(response, "bad_key", index=1)
    assert _read_standard() == before


@pytest.mark.parametrize("key", ["step", "a_1", "a" * 100])
def test_admin_accepts_plain_key(client: TestClient, key: str) -> None:
    response = _put(client, [_item(key)])

    assert response.status_code == 200, response.text
    assert _read_standard() == [(key, 0)]


def test_admin_rejects_missing_parent(client: TestClient) -> None:
    before = _read_standard()

    absent = _put(client, [_item("a", kind="group"), _item("b.child")])
    later = _put(client, [_item("a.child"), _item("a", kind="group")])  # 부모가 자기 뒤에 있다

    _assert_rejected(absent, "missing_parent", index=1)
    _assert_rejected(later, "missing_parent", index=0)
    assert _read_standard() == before


def test_admin_rejects_duplicate_key(client: TestClient) -> None:
    before = _read_standard()

    response = _put(client, [_item("a"), _item("b"), _item("a")])

    _assert_rejected(response, "duplicate_key", index=2)
    assert _read_standard() == before


@pytest.mark.parametrize("parent_kind", ["general", "auto_list"])
def test_admin_rejects_children_under_leaf(client: TestClient, parent_kind: str) -> None:
    before = _read_standard()

    response = _put(client, [_item("a", kind=parent_kind), _item("a.child")])

    _assert_rejected(response, "children_under_leaf", index=1)
    assert _read_standard() == before


@pytest.mark.parametrize("parent_kind", ["named_children", "category_table", "group"])
def test_admin_accepts_children_under_parent_kinds(client: TestClient, parent_kind: str) -> None:
    response = _put(client, [_item("a", kind=parent_kind), _item("a.child")])

    assert response.status_code == 200, response.text


def test_admin_rejects_bad_kind(client: TestClient) -> None:
    before = _read_standard()

    response = _put(client, [_item("a", kind="chapter")])

    _assert_rejected(response, "bad_kind", index=0)
    assert _read_standard() == before


def test_admin_rejects_empty(client: TestClient) -> None:
    before = _read_standard()

    response = _put(client, [])

    _assert_rejected(response, "empty")
    assert _read_standard() == before


@pytest.mark.parametrize(
    "overrides",
    [
        {"title_en": "   "},
        {"title_en": "t" * 201},
        {"title_ko": "가" * 201},
        {"child_prefix": "p" * 41},
        {"default_style": "roman"},
        {"suggestions": ["s"] * 51},
        {"suggestions": ["s" * 201]},
        {"title_en": "nul\x00"},
    ],
)
def test_admin_rejects_malformed_fields(client: TestClient, overrides: dict) -> None:
    # 칸의 형식·길이는 입력 검증(목록 모양의 422)이 막는다 — 업무 규칙 코드가 아니다
    before = _read_standard()

    response = _put(client, [_item("a", **overrides)])

    assert response.status_code == 422, response.text
    assert isinstance(response.json()["detail"], list)
    assert _read_standard() == before


# ── 새 문서부터 적용 ────────────────────────────────────────────────────────────


def test_admin_edit_applies_to_new_docs_only(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    created = put_tobe(client, bundle["id"], [{"code": "SOP-1", "title": "", "doc_type": "sop", "parent_code": None}])
    assert created.status_code == 200, created.text
    old_doc_id = created.json()["docs"][0]["id"]
    assert _load_doc_outline_keys(old_doc_id) == list(NEW_SOP_KEYS)

    response = _put(client, [*_get_items(client), _item("records", title_en="Records")])
    assert response.status_code == 200, response.text

    added = client.post(f"/api/bundles/{bundle['id']}/tobe/docs", json={"code": "SOP-2", "doc_type": "sop"}, headers=AUTHOR)
    assert added.status_code == 201, added.text
    new_doc_id = next(doc["id"] for doc in added.json()["docs"] if doc["code"] == "SOP-2")
    assert len(_load_doc_outline_keys(old_doc_id)) == 17  # 전에 만든 문서의 사본은 그대로다(표준 16 + 첫 절차)
    assert _load_doc_outline_keys(new_doc_id) == [*NEW_SOP_KEYS, "records"]
    by_code = {
        code: [item for item in added.json()["outline_items"] if item["code"] == code] for code in ("SOP-1", "SOP-2")
    }
    assert len(by_code["SOP-1"]) == 17
    assert len(by_code["SOP-2"]) == 18
    assert (by_code["SOP-2"][-1]["key"], by_code["SOP-2"][-1]["number"], by_code["SOP-2"][-1]["title_en"]) == (
        "records", "10", "Records",
    )


def test_first_procedure_is_added_only_to_an_empty_declaring_procedures_item(client: TestClient) -> None:
    def create_sop(code: str) -> int:
        bundle = create_bundle(client, is_synthetic=True)
        created = put_tobe(client, bundle["id"], [{"code": code, "title": "", "doc_type": "sop", "parent_code": None}])
        assert created.status_code == 200, created.text
        return created.json()["docs"][0]["id"]

    # 표준이 6장에 이미 절을 두었거나 6장이 하위를 선언하는 종류가 아니면 "Procedure 1"을 지어 넣지 않는다
    filled = [_item("procedures", kind="named_children"), _item("procedures.cleaning")]
    assert _put(client, filled).status_code == 200
    assert _load_doc_outline_keys(create_sop("SOP-1")) == ["procedures", "procedures.cleaning"]
    assert _put(client, [_item("procedures", kind="general"), _item("scope")]).status_code == 200
    assert _load_doc_outline_keys(create_sop("SOP-2")) == ["procedures", "scope"]
    assert _put(client, [_item("procedures", kind="named_children"), _item("scope")]).status_code == 200
    assert _load_doc_outline_keys(create_sop("SOP-3")) == ["procedures", "procedures.p1", "scope"]
