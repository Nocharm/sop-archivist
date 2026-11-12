"""묶음 진행 숫자 — 배정 화면과 같은 줄(짝 하나·짝 없는 판단 단위 하나) 기준 한 벌과, 두 언어 문서의 짝 없는 글 수."""

from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import TargetSentence, TargetSource
from app.sop.status import pick_row_status
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import ADMIN, AUTHOR, assign_as_is, create_bundle, find_unit, get_bundle, get_view, put_tobe, upload
from tests.test_sop_pairs import EN_BOTH, EN_ON, KO_KEEP, KO_LOAD, KO_ON

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_Progress.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
PROGRESS_KEYS = {"total", "unassigned", "ai_suggested", "confirmed", "on_hold", "single_language"}


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    view: dict


def _setup(client: TestClient, body: str) -> Fixture:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    response = upload(client, bundle_id, build_docx(body), OLD_NAME)
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
        "total": 2, "unassigned": 2, "ai_suggested": 0, "confirmed": 0, "on_hold": 0, "single_language": 0,
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


def test_empty_bundle_progress_is_all_zero(client: TestClient) -> None:
    bundle_id = create_bundle(client, title="Empty")["id"]
    assert get_bundle(client, bundle_id)["progress"] == dict.fromkeys(PROGRESS_KEYS, 0)
