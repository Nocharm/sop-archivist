"""입구 2 — 새 문서를 올리면 생기는 새 문장(절 경로·표·그림), 같은 글자 후보, 한 번에 확정, 수동 짝 맞추기와 편집 뒤 다시 만들기."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.sop.match import MAX_BULK_MATCH, sync_new_doc_targets
from app.sop.models import Bundle, BundleEvent, Document, TargetSentence, TargetSource, Unit
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.sop_helpers import (
    AUTHOR,
    OUTSIDER,
    REVIEWER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_Match.docx"
NEW_NAME = "SYNTHETIC_SOP-M_Match.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
TARGET_FIELDS = (
    "id", "kind", "lang", "confirmed_text", "section_path", "order_index", "status", "origin", "change_type",
    "new_unit_id", "parent_target_id", "cell_row", "cell_col", "grid", "revision",
)


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    old_view: dict
    new_doc: dict
    new_view: dict


def _upload_ready(client: TestClient, bundle_id: int, data: bytes, name: str, **kwargs: str) -> dict:
    response = upload(client, bundle_id, data, name, **kwargs)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()
    return response.json()


def _upload_new(client: TestClient, bundle_id: int, body: str, **docx: object) -> dict:
    return _upload_ready(client, bundle_id, build_docx(body, **docx), NEW_NAME, side="new", doc_type="sop")


def _setup(client: TestClient, old_body: str, new_body: str) -> Fixture:
    """To-Be(입구 1 SOP 하나)와 옛 문서 하나, 입구 2 새 문서 하나를 올린 묶음."""
    bundle = create_bundle(client, is_synthetic=True)
    response = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    old_doc = _upload_ready(client, bundle["id"], build_docx(old_body), OLD_NAME)
    # 머리말은 새 문장을 만들지 않으니 같은 본문이어도 파일 내용만 다르게 한다(같은 파일은 duplicate_file)
    new_doc = _upload_new(client, bundle["id"], new_body, headers=[p("합성 새 문서")])
    return Fixture(
        bundle["id"], sop_id, get_view(client, bundle["id"], old_doc["id"]), new_doc,
        get_view(client, bundle["id"], new_doc["id"]),
    )


def _load_targets(target_doc_id: int) -> list[dict]:
    """새 문서의 새 문장 — order_index·id 순."""

    async def _load(session: AsyncSession) -> list[dict]:
        rows = await session.scalars(
            select(TargetSentence)
            .where(TargetSentence.target_doc_id == target_doc_id)
            .order_by(TargetSentence.order_index, TargetSentence.id)
        )
        return [{field: getattr(row, field) for field in TARGET_FIELDS} for row in rows]

    return run_in_session(_load)


def _find_target(targets: list[dict], text: str) -> dict:
    (found,) = [target for target in targets if target["confirmed_text"] == text]
    return found


def _get_candidates(client: TestClient, bundle_id: int, headers: dict[str, str] = AUTHOR) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/match/identical-candidates", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _bulk_confirm(
    client: TestClient, bundle_id: int, body: dict, headers: dict[str, str] = AUTHOR
) -> httpx2.Response:
    return client.post(f"/api/bundles/{bundle_id}/match/bulk-confirm", json=body, headers=headers)


def _identical_in(candidate: dict, unit_revision: int = 1, target_revision: int = 1) -> dict:
    return {
        "unit_id": candidate["unit_id"], "unit_revision": unit_revision,
        "target_id": candidate["target_id"], "target_revision": target_revision,
    }


def _get_group_by_target(client: TestClient, bundle_id: int, target_id: int) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/groups/by-target/{target_id}", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _link(key: str, target: dict, sources: list[dict], **fields: object) -> dict:
    """기존 입구 2 새 문장에 옛 단위를 출처로 붙이는 저장 항목."""
    return {
        "key": key, "id": target["id"], "revision": target["revision"],
        "source_unit_ids": [unit["id"] for unit in sources], **fields,
    }


def _assigned(unit: dict, revision: int = 1) -> dict:
    return {"unit_id": unit["id"], "revision": revision, "disposition": "assigned"}


# ── 새 문서를 올리면 생기는 새 문장 ──────────────────────────────────────────


def test_new_doc_upload_creates_targets_with_section_paths(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    body = p("1. 준비", "Heading1") + p("합성 장비를 켠다. 합성 시료를 넣는다.")
    new_doc = _upload_new(client, bundle["id"], body, headers=[p("합성 머리말")])
    view = get_view(client, bundle["id"], new_doc["id"])

    targets = _load_targets(new_doc["target_doc_id"])

    assert [(t["confirmed_text"], t["section_path"], t["kind"], t["lang"], t["origin"]) for t in targets] == [
        ("합성 장비를 켠다.", "1. 준비", "sentence", "ko", "new_doc"),
        ("합성 시료를 넣는다.", "1. 준비", "sentence", "ko", "new_doc"),
    ]
    assert [t["new_unit_id"] for t in targets] == [
        find_unit(view, "합성 장비를 켠다.")["id"], find_unit(view, "합성 시료를 넣는다.")["id"],
    ]
    assert {(t["status"], t["change_type"], t["revision"]) for t in targets} == {("unassigned", None, 1)}
    assert targets[0]["order_index"] < targets[1]["order_index"]
    # 제목·머리말 단위는 있지만 새 문장을 만들지 않는다
    assert find_unit(view, "1. 준비")["kind"] == "heading"
    header = find_unit(view, "합성 머리말")
    assert header["id"] not in {t["new_unit_id"] for t in targets}


def test_new_doc_tables_figures_and_nested_paths(client: TestClient) -> None:
    """하위 제목은 " › "로 쌓이고 같은 단계 제목이 나오면 갈린다. 데이터 표는 표 새 문장 + 칸 새 문장, 그림은 그림 새 문장."""
    bundle = create_bundle(client, is_synthetic=True)
    body = (
        p("1. 준비", "Heading1")
        + p("1.1 장비", "Heading2")
        + p("합성 장비를 켠다.")
        + p("2. 기록", "Heading1")
        + tbl([["항목", "Item"], ["합성 값", "Synthetic value"]])
        + f"<w:p>{make_drawing_run('image1.png')}</w:p>"
        + p("그림 1 합성 장비", "Caption")
    )
    new_doc = _upload_new(client, bundle["id"], body, media={"image1.png": TINY_PNG})
    view = get_view(client, bundle["id"], new_doc["id"])
    table_unit = next(unit for unit in view["units"] if unit["kind"] == "table")
    figure_unit = next(unit for unit in view["units"] if unit["kind"] == "figure")

    targets = _load_targets(new_doc["target_doc_id"])

    sentence, table, *cells, figure = targets
    assert (sentence["confirmed_text"], sentence["section_path"]) == ("합성 장비를 켠다.", "1. 준비 › 1.1 장비")
    assert (table["kind"], table["lang"], table["confirmed_text"], table["grid"], table["section_path"]) == (
        "table", "neutral", "", {"rows": 2, "cols": 2}, "2. 기록",
    )
    assert (table["new_unit_id"], table["parent_target_id"]) == (table_unit["id"], None)
    assert [(c["confirmed_text"], c["lang"], c["cell_row"], c["cell_col"], c["parent_target_id"]) for c in cells] == [
        ("항목", "ko", 0, 0, table["id"]),
        ("Item", "en", 0, 1, table["id"]),
        ("합성 값", "ko", 1, 0, table["id"]),
        ("Synthetic value", "en", 1, 1, table["id"]),
    ]
    assert [c["new_unit_id"] for c in cells] == [find_unit(view, c["confirmed_text"])["id"] for c in cells]
    assert {(c["kind"], c["section_path"]) for c in cells} == {("sentence", "2. 기록")}
    assert (figure["kind"], figure["lang"], figure["confirmed_text"], figure["new_unit_id"]) == (
        "figure", "neutral", "", figure_unit["id"],
    )
    assert [t["order_index"] for t in targets] == sorted(t["order_index"] for t in targets)


def test_clause_number_headings_set_level_one_without_styles(client: TestClient) -> None:
    """제목 스타일이 없는 문서는 조항 번호만 있는 줄을 1단계 제목으로 본다 — 다음 번호가 앞 절을 닫는다."""
    bundle = create_bundle(client, is_synthetic=True)
    body = p("1.") + p("합성 장비를 켠다.") + p("2.") + p("합성 시료를 넣는다.")
    new_doc = _upload_new(client, bundle["id"], body)

    targets = _load_targets(new_doc["target_doc_id"])

    assert [(t["confirmed_text"], t["section_path"]) for t in targets] == [
        ("합성 장비를 켠다.", "1."), ("합성 시료를 넣는다.", "2."),
    ]


def test_deleting_new_doc_removes_its_unassigned_targets(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    new_doc = _upload_new(client, bundle["id"], p("합성 장비를 켠다."))
    assert len(_load_targets(new_doc["target_doc_id"])) == 1

    deleted = client.delete(
        f"/api/bundles/{bundle['id']}/documents/{new_doc['id']}", params={"revision": 1}, headers=AUTHOR
    )

    assert deleted.status_code == 204, deleted.text
    assert _load_targets(new_doc["target_doc_id"]) == []


# ── 같은 글자 후보 ────────────────────────────────────────────────────────────


def test_identical_candidates_are_unique_pairs(client: TestClient) -> None:
    """(언어, 글자)가 양쪽에 딱 하나씩일 때만 후보 — 옛 쪽이 둘(시료)이거나 새 쪽이 둘(뚜껑)이면 빠지고, 배정한 단위도 빠진다."""
    old_body = (
        p("합성 장비를 켠다.") + p("합성 시료를 넣는다.") + p("합성 시료를 넣는다.")
        + p("합성 뚜껑을 닫는다.") + p("합성 기록을 남긴다.")
    )
    new_body = (
        p("합성 장비를 켠다.") + p("합성 시료를 넣는다.") + p("합성 뚜껑을 닫는다.") + p("합성 뚜껑을 닫는다.")
        + p("합성 기록을 남긴다.") + p("합성 라벨을 붙인다.")
    )
    fx = _setup(client, old_body, new_body)
    targets = _load_targets(fx.new_doc["target_doc_id"])

    candidates = _get_candidates(client, fx.bundle_id)

    expected = [
        {
            "unit_id": find_unit(fx.old_view, text)["id"], "target_id": _find_target(targets, text)["id"],
            "lang": "ko", "text": text,
        }
        for text in ("합성 장비를 켠다.", "합성 기록을 남긴다.")
    ]
    assert candidates == expected

    assign_as_is(client, fx.bundle_id, find_unit(fx.old_view, "합성 기록을 남긴다."), fx.sop_id, slot_key="scope")
    assert _get_candidates(client, fx.bundle_id) == expected[:1]


def test_table_cells_are_not_identical_candidates(client: TestClient) -> None:
    """칸 문장·칸 새 문장은 표와 한 관계 묶음이라 1:1 후보로 내지 않고, 한 번에 확정에 담아도 not_identical이다."""
    fx = _setup(
        client,
        p("합성 장비를 켠다.") + tbl([["합성 값", "Synthetic value"]]),
        p("합성 값") + tbl([["합성 장비를 켠다.", "Synthetic item"]]),
    )
    old_cell = find_unit(fx.old_view, "합성 값")
    new_cell = _find_target(_load_targets(fx.new_doc["target_doc_id"]), "합성 장비를 켠다.")
    paragraph = find_unit(fx.old_view, "합성 장비를 켠다.")

    candidates = _get_candidates(client, fx.bundle_id)
    response = _bulk_confirm(
        client, fx.bundle_id, {"identical": [_identical_in({"unit_id": paragraph["id"], "target_id": new_cell["id"]})]}
    )

    assert old_cell["group_unit_id"] is not None and new_cell["parent_target_id"] is not None
    assert candidates == []
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == {"code": "not_identical", "unit_id": paragraph["id"], "target_id": new_cell["id"]}


# ── 한 번에 확정 ──────────────────────────────────────────────────────────────


def test_bulk_confirm_identical_and_new(client: TestClient) -> None:
    fx = _setup(
        client,
        p("합성 장비를 켠다.") + p("합성 시료를 넣는다."),
        p("합성 장비를 켠다.") + p("합성 시료를 넣는다.") + p("합성 라벨을 붙인다."),
    )
    candidates = _get_candidates(client, fx.bundle_id)
    fresh = _find_target(_load_targets(fx.new_doc["target_doc_id"]), "합성 라벨을 붙인다.")
    body = {
        "identical": [_identical_in(candidate) for candidate in candidates],
        "new": [{"target_id": fresh["id"], "revision": fresh["revision"]}],
    }

    response = _bulk_confirm(client, fx.bundle_id, body)

    assert response.status_code == 200, response.text
    assert len(candidates) == 2
    for candidate in candidates:
        group = _get_group_by_target(client, fx.bundle_id, candidate["target_id"])
        (unit,) = group["units"]
        (target,) = group["targets"]
        assert (target["change_type"], target["status"], target["source_unit_ids"], target["revision"]) == (
            "as_is", "confirmed", [candidate["unit_id"]], 2,
        )
        assert (target["confirmed_text"], target["warnings"], target["group_id"]) == (candidate["text"], [], None)
        decision = unit["decision"]
        assert (decision["disposition"], decision["status"], decision["confirmed_by"], decision["revision"]) == (
            "assigned", "confirmed", "qa.member", 2,
        )
    (new_target,) = _get_group_by_target(client, fx.bundle_id, fresh["id"])["targets"]
    assert (new_target["change_type"], new_target["status"], new_target["source_unit_ids"], new_target["revision"]) == (
        "new", "confirmed", [], 2,
    )
    returned = response.json()
    assert sorted(t["id"] for t in returned["targets"]) == sorted([c["target_id"] for c in candidates] + [fresh["id"]])
    assert _get_candidates(client, fx.bundle_id) == []

    async def _load_events(session: AsyncSession) -> list[tuple[str, str, list]]:
        rows = await session.execute(
            select(BundleEvent.action, BundleEvent.target_type, BundleEvent.target_ids).where(
                BundleEvent.bundle_id == fx.bundle_id, BundleEvent.action == "match.bulk_confirm"
            )
        )
        return [tuple(row) for row in rows]

    ((action, target_type, target_ids),) = run_in_session(_load_events)
    assert (action, target_type) == ("match.bulk_confirm", "target")
    assert sorted(target_ids) == sorted([c["target_id"] for c in candidates] + [fresh["id"]])


def _count_sources(bundle_id: int) -> int:
    async def _count(session: AsyncSession) -> int:
        return await session.scalar(
            select(func.count())
            .select_from(TargetSource)
            .join(TargetSentence, TargetSentence.id == TargetSource.target_id)
            .where(TargetSentence.bundle_id == bundle_id)
        )

    return run_in_session(_count)


def test_bulk_confirm_rejects_non_identical(client: TestClient) -> None:
    """한 글자만 달라도 전체 422 not_identical — 앞의 맞는 짝과 신규 표시도 쓰지 않는다. 낡은 revision은 409, 역시 아무것도 안 쓴다."""
    fx = _setup(
        client,
        p("합성 장비를 켠다.") + p("합성 시료 A를 넣는다."),
        p("합성 장비를 켠다.") + p("합성 시료 B를 넣는다.") + p("합성 라벨을 붙인다."),
    )
    (candidate,) = _get_candidates(client, fx.bundle_id)
    targets = _load_targets(fx.new_doc["target_doc_id"])
    near = _find_target(targets, "합성 시료 B를 넣는다.")
    fresh = _find_target(targets, "합성 라벨을 붙인다.")
    old_near = find_unit(fx.old_view, "합성 시료 A를 넣는다.")
    near_pair = {"unit_id": old_near["id"], "target_id": near["id"]}

    rejected = _bulk_confirm(client, fx.bundle_id, {
        "identical": [_identical_in(candidate), _identical_in(near_pair)],
        "new": [{"target_id": fresh["id"], "revision": 1}],
    })
    stale = _bulk_confirm(client, fx.bundle_id, {
        "identical": [_identical_in(candidate, target_revision=2)],
        "new": [{"target_id": fresh["id"], "revision": 1}],
    })

    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["detail"] == {"code": "not_identical", "unit_id": old_near["id"], "target_id": near["id"]}
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"] == {
        "code": "revision_conflict", "conflicts": [{"entity": "target", "id": candidate["target_id"], "current_revision": 1}],
    }
    assert _load_targets(fx.new_doc["target_doc_id"]) == targets
    assert _count_sources(fx.bundle_id) == 0
    group = _get_group_by_target(client, fx.bundle_id, candidate["target_id"])
    assert group["units"] == []


def test_bulk_confirm_rejects_assigned_unit_and_duplicates(client: TestClient) -> None:
    """이미 배정한 옛 단위는 같은 글자여도 not_identical, 한 요청에 같은 단위·새 문장을 두 번 담으면 duplicate_items."""
    fx = _setup(client, p("합성 장비를 켠다."), p("합성 장비를 켠다.") + p("합성 라벨을 붙인다."))
    (candidate,) = _get_candidates(client, fx.bundle_id)
    fresh = _find_target(_load_targets(fx.new_doc["target_doc_id"]), "합성 라벨을 붙인다.")
    twice = _bulk_confirm(client, fx.bundle_id, {
        "identical": [_identical_in(candidate)],
        "new": [{"target_id": candidate["target_id"], "revision": 1}, {"target_id": fresh["id"], "revision": 1}],
    })
    unit = find_unit(fx.old_view, "합성 장비를 켠다.")
    assign_as_is(client, fx.bundle_id, unit, fx.sop_id, slot_key="scope")

    taken = _bulk_confirm(client, fx.bundle_id, {"identical": [_identical_in(candidate, unit_revision=2)]})

    assert twice.status_code == 422, twice.text
    assert twice.json()["detail"] == {"code": "duplicate_items", "unit_ids": [], "target_ids": [candidate["target_id"]]}
    assert taken.status_code == 422, taken.text
    assert taken.json()["detail"] == {
        "code": "not_identical", "unit_id": candidate["unit_id"], "target_id": candidate["target_id"],
    }


def test_bulk_new_table_needs_its_cells(client: TestClient) -> None:
    """출처 없는 표 새 문장을 신규로 확정하려면 칸 새 문장을 모두 함께 담아야 한다 — 표를 반만 확정하지 않게."""
    bundle = create_bundle(client, is_synthetic=True)
    new_doc = _upload_new(client, bundle["id"], tbl([["항목", "Item"]]))
    table, *cells = _load_targets(new_doc["target_doc_id"])

    def _new_items(rows: list[dict]) -> dict:
        return {"new": [{"target_id": row["id"], "revision": row["revision"]} for row in rows]}

    half = _bulk_confirm(client, bundle["id"], _new_items([table]))
    cell_only = _bulk_confirm(client, bundle["id"], _new_items(cells[:1]))
    whole = _bulk_confirm(client, bundle["id"], _new_items([table, *cells]))

    assert half.status_code == 422, half.text
    assert half.json()["detail"] == {"code": "not_new", "target_id": table["id"]}
    assert cell_only.status_code == 422, cell_only.text
    assert cell_only.json()["detail"] == {"code": "not_new", "target_id": cells[0]["id"]}
    assert whole.status_code == 200, whole.text
    assert {(t["change_type"], t["status"]) for t in _load_targets(new_doc["target_doc_id"])} == {("new", "confirmed")}


def test_bulk_confirm_request_limits_and_roles(client: TestClient) -> None:
    fx = _setup(client, p("합성 장비를 켠다."), p("합성 장비를 켠다."))
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    (candidate,) = _get_candidates(client, fx.bundle_id, headers=REVIEWER)
    body = {"identical": [_identical_in(candidate)]}
    too_many = {"new": [{"target_id": n, "revision": 1} for n in range(1, MAX_BULK_MATCH + 2)]}

    assert _bulk_confirm(client, fx.bundle_id, {"identical": [], "new": []}).status_code == 422
    assert _bulk_confirm(client, fx.bundle_id, too_many).status_code == 422
    as_reviewer = _bulk_confirm(client, fx.bundle_id, body, headers=REVIEWER)
    assert (as_reviewer.status_code, as_reviewer.json()["detail"]["code"]) == (403, "role_required")
    outsider = client.get(f"/api/bundles/{fx.bundle_id}/match/identical-candidates", headers=OUTSIDER)
    assert (outsider.status_code, outsider.json()["detail"]["code"]) == (404, "bundle_not_found")
    update_row(Bundle, fx.bundle_id, status="in_review")
    locked = _bulk_confirm(client, fx.bundle_id, body)
    assert (locked.status_code, locked.json()["detail"]["code"]) == (409, "bundle_not_editable")


@contextmanager
def _count_queries() -> Iterator[list[str]]:
    statements: list[str] = []

    def _record(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _record)


def test_candidates_and_bulk_confirm_use_bounded_queries(client: TestClient) -> None:
    """후보 목록과 한 번에 확정은 짝 수에 비례하는 질의를 내지 않는다 — 2쌍과 40쌍의 질의 수가 같다."""

    def _measure(count: int) -> tuple[int, int, int]:
        body = "".join(p(f"합성 문장 {n}번을 확인한다.") for n in range(count))
        fx = _setup(client, body, body)
        with _count_queries() as listing:
            candidates = _get_candidates(client, fx.bundle_id)
        with _count_queries() as confirming:
            response = _bulk_confirm(client, fx.bundle_id, {"identical": [_identical_in(c) for c in candidates]})
        assert response.status_code == 200, response.text
        return len(candidates), len(listing), len(confirming)

    small_pairs, small_listing, small_confirming = _measure(2)
    large_pairs, large_listing, large_confirming = _measure(40)

    assert (small_pairs, large_pairs) == (2, 40)
    assert small_listing > 0 and small_confirming > 0  # 수집기가 실제로 문장을 셌다
    assert (large_listing, large_confirming) == (small_listing, small_confirming)


# ── 수동 짝 맞추기(관계 묶음 저장) ────────────────────────────────────────────


def test_manual_match_split_and_merge(client: TestClient) -> None:
    """옛 단위 하나 → 새 문장 둘은 나눔, 옛 단위 둘 → 새 문장 하나는 합침 — 새 문서 글자는 그대로 확정 글자다."""
    fx = _setup(
        client,
        p("합성 장비를 5분간 예열하고 기록은 보관한다.") + p("합성 시료는 4 ℃에서 보관한다.") + p("합성 시료는 밀봉한다."),
        p("1. 보관", "Heading1") + p("합성 장비를 5분간 예열한다. 합성 기록은 보관한다.")
        + p("합성 시료는 밀봉하여 4 ℃에서 보관한다."),
    )
    warm = find_unit(fx.old_view, "합성 장비를 5분간 예열하고 기록은 보관한다.")
    store = find_unit(fx.old_view, "합성 시료는 4 ℃에서 보관한다.")
    seal = find_unit(fx.old_view, "합성 시료는 밀봉한다.")
    targets = _load_targets(fx.new_doc["target_doc_id"])
    first, second, merged = targets

    split = save_group(client, fx.bundle_id, {
        "action": "confirm", "units": [_assigned(warm)],
        "targets": [_link("a", first, [warm]), _link("b", second, [warm])],
    })
    merge = save_group(client, fx.bundle_id, {
        "action": "confirm", "units": [_assigned(store), _assigned(seal)],
        "targets": [_link("m", merged, [store, seal])],
    })

    assert split.status_code == 200, split.text
    assert [(t["id"], t["change_type"], t["status"], t["confirmed_text"]) for t in split.json()["targets"]] == [
        (first["id"], "split", "confirmed", "합성 장비를 5분간 예열한다."),
        (second["id"], "split", "confirmed", "합성 기록은 보관한다."),
    ]
    assert {t["group_id"] for t in split.json()["targets"]} == {f"G-{warm['display_id']}"}
    assert merge.status_code == 200, merge.text
    ((target_id, change_type, sources, path),) = [
        (t["id"], t["change_type"], t["source_unit_ids"], t["section_path"]) for t in merge.json()["targets"]
    ]
    assert (target_id, change_type, sources, path) == (merged["id"], "merged", [store["id"], seal["id"]], "1. 보관")
    assert _get_candidates(client, fx.bundle_id) == []


def test_unmatched_new_target_saved_alone_is_new(client: TestClient) -> None:
    fx = _setup(client, p("합성 장비를 켠다."), p("합성 라벨을 붙인다."))
    (target,) = _load_targets(fx.new_doc["target_doc_id"])

    response = save_group(client, fx.bundle_id, {"action": "confirm", "units": [], "targets": [_link("n", target, [])]})

    assert response.status_code == 200, response.text
    (saved,) = response.json()["targets"]
    assert (saved["id"], saved["change_type"], saved["status"], saved["source_unit_ids"]) == (
        target["id"], "new", "confirmed", [],
    )


def test_match_doc_text_is_locked(client: TestClient) -> None:
    fx = _setup(client, p("합성 장비를 켠다."), p("합성 장비를 켠다."))
    (target,) = _load_targets(fx.new_doc["target_doc_id"])
    unit = find_unit(fx.old_view, "합성 장비를 켠다.")

    response = save_group(client, fx.bundle_id, {
        "action": "confirm", "units": [_assigned(unit)],
        "targets": [_link("n", target, [unit], text="합성 장비를 끈다.", change_type="rewritten")],
    })

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == {"code": "invalid_group", "reason": "match_target_locked", "keys": ["n"]}
    assert _load_targets(fx.new_doc["target_doc_id"]) == [target]


# ── 편집 뒤 다시 만들기(Task 13이 쓴다) ──────────────────────────────────────


def test_sync_rebuilds_targets_for_edited_units(client: TestClient) -> None:
    """두 문장 단위를 은퇴시키고 합친 단위를 만들면 — 옛 새 문장은 지우고 새 단위의 새 문장을 같은 절 경로로 만든다."""
    bundle = create_bundle(client, is_synthetic=True)
    body = p("1. 준비", "Heading1") + p("합성 장비를 켠다. 합성 시료를 넣는다.") + p("합성 기록을 남긴다.")
    new_doc = _upload_new(client, bundle["id"], body)
    view = get_view(client, bundle["id"], new_doc["id"])
    first, second = find_unit(view, "합성 장비를 켠다."), find_unit(view, "합성 시료를 넣는다.")
    before = _load_targets(new_doc["target_doc_id"])

    async def _merge(session: AsyncSession) -> tuple[int, list[int]]:
        document = await session.get_one(Document, new_doc["id"])
        olds = [await session.get_one(Unit, unit["id"]) for unit in (first, second)]
        last_no = await session.scalar(select(func.max(Unit.local_no)).where(Unit.extraction_id == olds[0].extraction_id))
        merged = Unit(
            extraction_id=olds[0].extraction_id, local_no=last_no + 1,
            kind="sentence", spans=[*olds[0].spans, *olds[1].spans], text=f"{olds[0].text} {olds[1].text}",
            lang="ko", pos_seq=olds[0].pos_seq, pos_start=olds[0].pos_start,
        )
        session.add(merged)
        for old in olds:
            old.status = "retired"
        await session.flush()
        report = await sync_new_doc_targets(
            session, document, created_unit_ids=[merged.id], retired_unit_ids=[old.id for old in olds], actor="qa.member"
        )
        await session.commit()
        return merged.id, report.deleted_target_ids

    merged_id, deleted = run_in_session(_merge)

    after = _load_targets(new_doc["target_doc_id"])
    assert sorted(deleted) == sorted(_find_target(before, text)["id"] for text in ("합성 장비를 켠다.", "합성 시료를 넣는다."))
    assert [(t["confirmed_text"], t["section_path"], t["new_unit_id"], t["status"]) for t in after] == [
        ("합성 장비를 켠다. 합성 시료를 넣는다.", "1. 준비", merged_id, "unassigned"),
        ("합성 기록을 남긴다.", "1. 준비", find_unit(view, "합성 기록을 남긴다.")["id"], "unassigned"),
    ]
