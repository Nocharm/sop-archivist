"""묶음 진행 숫자 — 배정 화면과 같은 줄(짝 하나·짝 없는 판단 단위 하나) 기준 한 벌과, 두 언어 문서의 짝 없는 글 수."""

import itertools
from collections import Counter
from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import TargetSentence, TargetSource, UnitDecision
from app.sop.output_rows import build_meaning_rows, count_single_language
from app.sop.snapshot import BundleSnapshot, load_bundle_snapshot
from app.sop.status import pick_row_status
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.sop_helpers import ADMIN, AUTHOR, assign_as_is, create_bundle, find_unit, get_bundle, get_view, put_tobe, upload
from tests.test_sop_pairs import EN_BOTH, EN_ON, KO_KEEP, KO_LOAD, KO_ON

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_Progress.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
PROGRESS_KEYS = {
    "total", "unassigned", "confirmed", "on_hold", "single_language",
    "assigned", "deleted", "moved", "figures_total", "figures_decided",
}
REASON = "Synthetic: decided for the test"
FIGURE = f"<w:p>{make_drawing_run('image1.png')}</w:p>"


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    view: dict


def _setup(client: TestClient, body: str, *, media: dict[str, bytes] | None = None) -> Fixture:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    response = upload(client, bundle_id, build_docx(body, media=media or {}), OLD_NAME)
    assert response.status_code == 201, response.text
    doc = response.json()
    assert doc["status"] == "ready", doc
    return Fixture(bundle_id, sop_id, get_view(client, bundle_id, doc["id"]))


def _expected_rows(view: dict) -> int:
    """배정 화면의 줄과 같은 규칙 — 묶이지 않은 단위를 짝으로 묶어 센다."""
    return len({unit["pair_id"] or -unit["id"] for unit in view["units"] if unit["group_unit_id"] is None})


def _expected_single(view: dict) -> int:
    """두 언어 문서에서 짝이 없는 글 단위(문장·제목) 수 — 픽스처에 번역·다른 언어 새 문장이 없을 때."""
    return sum(
        1 for unit in view["units"]
        if unit["group_unit_id"] is None and unit["pair_id"] is None and unit["kind"] in ("sentence", "heading")
    )


def test_progress_counts_a_pair_as_one_row(client: TestClient) -> None:
    fx = _setup(client, p(KO_ON) + p(EN_ON) + p(f"{KO_LOAD} {KO_KEEP}") + p(EN_BOTH))
    assert len(fx.view["pairs"]) == 2  # 짝 [ko_on,en_on]·[ko_load,ko_keep,en_both]가 생기는 픽스처여야 한다
    assert get_bundle(client, fx.bundle_id)["progress"] == {
        "total": 2, "unassigned": 2, "confirmed": 0, "on_hold": 0, "single_language": 0,
        "assigned": 0, "deleted": 0, "moved": 0, "figures_total": 0, "figures_decided": 0,
    }


def test_row_status_is_the_least_finished_member(client: TestClient) -> None:
    fx = _setup(client, p(KO_ON) + p(EN_ON))
    assert len(fx.view["pairs"]) == 1
    assign_as_is(client, fx.bundle_id, find_unit(fx.view, KO_ON), fx.sop_id, slot_key="purpose")
    progress = get_bundle(client, fx.bundle_id)["progress"]
    assert (progress["confirmed"], progress["unassigned"]) == (0, 1)
    assign_as_is(client, fx.bundle_id, find_unit(fx.view, EN_ON), fx.sop_id, slot_key="purpose")
    assert get_bundle(client, fx.bundle_id)["progress"]["confirmed"] == 1


def test_progress_counts_a_table_once_and_not_its_cells(client: TestClient) -> None:
    fx = _setup(client, p(KO_ON) + p(EN_ON) + tbl([["가", "나"], ["다", "라"]]))
    progress = get_bundle(client, fx.bundle_id)["progress"]
    cells = [unit for unit in fx.view["units"] if unit["group_unit_id"] is not None]
    assert cells  # 표에 묶인 칸 문장이 있는 픽스처여야 한다
    assert progress["total"] == _expected_rows(fx.view)  # 표는 한 줄, 묶인 칸은 세지 않는다


def test_single_language_counts_unpaired_text_in_two_language_documents(client: TestClient) -> None:
    fx = _setup(client, p(KO_ON) + p(EN_ON) + p(KO_KEEP))
    assert _expected_single(fx.view) >= 1  # 짝이 안 된 문장이 적어도 하나인 픽스처여야 한다
    assert get_bundle(client, fx.bundle_id)["progress"]["single_language"] == _expected_single(fx.view)


def _add_target(bundle_id: int, sop_id: int, lang: str, *, translates: int | None = None, source: int | None = None) -> None:
    """번역·입구 2 새 문장을 사람 저장 경로 없이 넣는다 — 사람 저장은 출처와 다른 언어의 새 문장을 만들지 못한다."""

    async def _insert(session: AsyncSession) -> None:
        target = TargetSentence(
            bundle_id=bundle_id, target_doc_id=sop_id, slot_key="purpose", lang=lang, kind="sentence",
            confirmed_text="Keep the synthetic records.", origin="translation", translation_source_unit_id=translates,
            status="confirmed",
        )
        session.add(target)
        await session.flush()
        if source is not None:
            session.add(TargetSource(target_id=target.id, unit_id=source, seq=0))
        await session.commit()

    run_in_session(_insert)


def test_single_language_skips_text_with_an_other_language_target(client: TestClient) -> None:
    fx = _setup(client, p(KO_ON) + p(EN_ON) + p(KO_KEEP) + p(KO_LOAD))
    keep, load = find_unit(fx.view, KO_KEEP), find_unit(fx.view, KO_LOAD)
    before = _expected_single(fx.view)
    assert {keep["pair_id"], load["pair_id"]} == {None}

    _add_target(fx.bundle_id, fx.sop_id, "ko", translates=keep["id"])  # 같은 언어 새 문장은 짝을 대신하지 않는다
    assert get_bundle(client, fx.bundle_id)["progress"]["single_language"] == before
    _add_target(fx.bundle_id, fx.sop_id, "en", translates=keep["id"])
    _add_target(fx.bundle_id, fx.sop_id, "en", source=load["id"])
    assert get_bundle(client, fx.bundle_id)["progress"]["single_language"] == before - 2


def test_pick_row_status_takes_the_least_finished() -> None:
    assert pick_row_status(["confirmed", "on_hold", "ai_suggested"]) == "ai_suggested"
    assert pick_row_status(["confirmed", "unassigned"]) == "unassigned"
    assert pick_row_status([]) == "confirmed"


def test_single_language_ignores_one_language_documents(client: TestClient) -> None:
    fx = _setup(client, p(EN_ON) + p(EN_BOTH))  # 올릴 때 en_only로 판정된다
    assert fx.view["document"]["language_layout"] == "en_only"
    progress = get_bundle(client, fx.bundle_id)["progress"]
    assert (progress["total"], progress["single_language"]) == (_expected_rows(fx.view), 0)


def test_progress_is_the_same_in_list_overview_and_admin(client: TestClient) -> None:
    fx = _setup(client, p(KO_ON) + p(EN_ON) + p(KO_KEEP))
    assign_as_is(client, fx.bundle_id, find_unit(fx.view, KO_KEEP), fx.sop_id, slot_key="purpose")

    overview = get_bundle(client, fx.bundle_id)["progress"]
    listed = {row["id"]: row for row in client.get("/api/bundles", headers=AUTHOR).json()}[fx.bundle_id]["progress"]
    admin = {row["id"]: row for row in client.get("/api/admin/bundles", headers=ADMIN).json()}[fx.bundle_id]["progress"]

    assert set(overview) == PROGRESS_KEYS
    assert (overview["total"], overview["confirmed"]) == (_expected_rows(fx.view), 1)
    assert listed == overview == admin
    assert (overview["assigned"], overview["deleted"], overview["moved"]) == (1, 0, 0)


def test_empty_bundle_progress_is_all_zero(client: TestClient) -> None:
    bundle_id = create_bundle(client, title="Empty")["id"]
    assert get_bundle(client, bundle_id)["progress"] == dict.fromkeys(PROGRESS_KEYS, 0)


def _bulk(client: TestClient, fx: Fixture, action: str, units: list[dict], **fields: str) -> None:
    body = {"action": action, "reason": REASON, "units": [{"unit_id": u["id"], "revision": 1} for u in units], **fields}
    response = client.post(f"/api/bundles/{fx.bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


def _list_rows(fx: Fixture, *kinds: str) -> list[dict]:
    """묶이지 않은 단위 — 짝 없는 본문이면 하나가 한 줄이다."""
    return [u for u in fx.view["units"] if u["group_unit_id"] is None and u["kind"] in kinds]


# 한 언어 문서라 짝이 없다 — 줄 넷
FOUR_ROWS = "".join(p(f"Keep the synthetic record {n}.") for n in ("one", "two", "three", "four"))


def test_confirmed_splits_by_disposition(client: TestClient) -> None:
    fx = _setup(client, FOUR_ROWS)
    first, second, third, _ = _list_rows(fx, "sentence")
    assign_as_is(client, fx.bundle_id, first, fx.sop_id, slot_key="purpose")
    _bulk(client, fx, "delete", [second, third])

    progress = get_bundle(client, fx.bundle_id)["progress"]

    assert (progress["confirmed"], progress["assigned"], progress["deleted"], progress["moved"]) == (3, 1, 2, 0)
    assert (progress["total"], progress["unassigned"]) == (4, 1)


def test_legacy_moves_are_counted_apart(client: TestClient) -> None:
    """다른 문서로 이동은 화면에서 뺐지만 운영에 남은 줄은 이동으로 센다."""
    fx = _setup(client, FOUR_ROWS)
    _bulk(client, fx, "move_external", _list_rows(fx, "sentence")[:1], move_target_code="SOP-ELSE")

    progress = get_bundle(client, fx.bundle_id)["progress"]

    assert (progress["confirmed"], progress["assigned"], progress["deleted"], progress["moved"]) == (1, 0, 0, 1)


def test_all_rows_deleted_is_all_decided(client: TestClient) -> None:
    fx = _setup(client, FOUR_ROWS)
    _bulk(client, fx, "delete", _list_rows(fx, "sentence"))

    progress = get_bundle(client, fx.bundle_id)["progress"]

    assert progress["confirmed"] == progress["total"] == progress["deleted"] == 4


def test_a_pair_decided_two_ways_counts_as_assigned(client: TestClient) -> None:
    """줄의 처분은 구성원 중 배정 · 삭제 · 이동 차례로 앞선 것 하나다 — 확정한 짝 줄이 두 번 세지지 않는다."""
    fx = _setup(client, p(KO_ON) + p(EN_ON))
    for text, disposition in ((KO_ON, "delete"), (EN_ON, "assigned")):
        update_row(UnitDecision, find_unit(fx.view, text)["id"], status="confirmed", disposition=disposition)

    progress = get_bundle(client, fx.bundle_id)["progress"]

    assert (progress["total"], progress["confirmed"], progress["assigned"], progress["deleted"]) == (1, 1, 1, 0)


def test_a_held_row_with_a_place_is_on_hold(client: TestClient) -> None:
    fx = _setup(client, FOUR_ROWS)
    unit = _list_rows(fx, "sentence")[0]
    assign_as_is(client, fx.bundle_id, unit, fx.sop_id, slot_key="purpose", hold_reason=REASON)

    progress = get_bundle(client, fx.bundle_id)["progress"]

    assert (progress["on_hold"], progress["confirmed"], progress["assigned"]) == (1, 0, 0)


def test_figures_are_counted_apart(client: TestClient) -> None:
    """그림 줄은 앞의 모든 숫자에서 빠지고 그림 수에만 든다(정한 것 = 확정)."""
    fx = _setup(client, FOUR_ROWS + FIGURE + FIGURE, media={"image1.png": TINY_PNG})
    rows_without_figures = len(_list_rows(fx, "sentence"))
    first, second = _list_rows(fx, "figure")
    _bulk(client, fx, "delete", [first])
    update_row(UnitDecision, second["id"], status="on_hold", hold_reason=REASON)

    progress = get_bundle(client, fx.bundle_id)["progress"]

    assert (progress["total"], progress["figures_total"], progress["figures_decided"]) == (rows_without_figures, 2, 1)
    assert (progress["unassigned"], progress["on_hold"], progress["confirmed"], progress["deleted"]) == (4, 0, 0, 0)


PAIR_TABLE_BODY = p(KO_ON) + p(EN_ON) + p(f"{KO_LOAD} {KO_KEEP}") + p(EN_BOTH) + p("합성 홀로 문장을 둔다.") + tbl([["가", "나"], ["다", "라"]]) + FIGURE


def _load_snapshot(bundle_id: int) -> BundleSnapshot:
    async def _load(session: AsyncSession) -> BundleSnapshot:
        return await load_bundle_snapshot(session, bundle_id)

    return run_in_session(_load)


def test_meaning_rows_match_progress(client: TestClient) -> None:
    # 짝(1:1·1:2)·표·그림·짝 없는 문장이 섞인 본문 — 진행 숫자와 스냅숏 줄 목록이 같은 줄이다(그림은 따로 센다)
    fx = _setup(client, PAIR_TABLE_BODY, media={"image1.png": TINY_PNG})
    progress = get_bundle(client, fx.bundle_id)["progress"]
    snap = _load_snapshot(fx.bundle_id)
    rows = build_meaning_rows(snap)
    assert len(rows) == progress["total"] + progress["figures_total"]
    figures = [row for row in rows if any(snap.units[unit_id].kind == "figure" for unit_id in row.unit_ids)]
    assert len(figures) == progress["figures_total"] == 1
    assert Counter(row.status for row in rows if row not in figures) == Counter(
        {key: progress[key] for key in ("unassigned", "confirmed", "on_hold") if progress[key]}
    )
    assert count_single_language(snap) == progress["single_language"]
    assert all(
        snap.units[first].order_key < snap.units[second].order_key
        for row in rows for first, second in itertools.pairwise(row.unit_ids)
    )
