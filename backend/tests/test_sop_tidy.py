"""개요의 남은 손질(참조 · 캡션)과 AI 제안 대기 — Assign 위쪽 줄의 표시와 같은 규칙으로 센 묶음 전체 수(F3-R2)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import AiSuggestion, TargetSentence, TargetSource, Unit, UnitDecision
from tests.access_helpers import run_in_session, update_row
from tests.ai_fixtures import attach_match_suggestion, attach_new_target_suggestion, attach_suggestion
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.sop_helpers import (
    ADMIN,
    AUTHOR,
    assign_as_is,
    create_bundle,
    find_unit,
    get_bundle,
    get_view,
    put_tobe,
    upload,
)
from tests.test_sop_pairs import EN_ON, KO_ON

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_Tidy.docx"
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
REASON = "Synthetic: decided for the test"
REF_LINES = ("SOP-ABC-1016 Synthetic procedure one", "SOP-ABC-1017 Synthetic procedure two")
FIGURE = f"<w:p>{make_drawing_run('image1.png')}</w:p>"
TABLE = tbl([["Alpha", "Beta"], ["Gamma", "Delta"]])
FOUR_ROWS = "".join(p(f"Keep the synthetic record {n}.") for n in ("one", "two", "three", "four"))


class Fixture:
    def __init__(self, client: TestClient, body: str) -> None:
        self.client = client
        self.bundle_id: int = create_bundle(client, is_synthetic=True)["id"]
        response = put_tobe(client, self.bundle_id, TOBE_DOCS)
        assert response.status_code == 200, response.text
        self.sop_id: int = response.json()["docs"][0]["id"]
        response = upload(client, self.bundle_id, build_docx(body, media={"image1.png": TINY_PNG}), OLD_NAME)
        assert response.status_code == 201 and response.json()["status"] == "ready", response.text
        self.doc_id: int = response.json()["id"]
        self.view = get_view(client, self.bundle_id, self.doc_id)

    def tidy(self) -> dict:
        return get_bundle(self.client, self.bundle_id)["tidy"]

    def of_kind(self, kind: str) -> list[dict]:
        return [unit for unit in self.view["units"] if unit["kind"] == kind and unit["group_unit_id"] is None]

    def delete(self, *units: dict) -> None:
        body = {"action": "delete", "reason": REASON, "units": [{"unit_id": unit["id"], "revision": 1} for unit in units]}
        response = self.client.post(f"/api/bundles/{self.bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
        assert response.status_code == 200, response.text


def _count_view_refs(view: dict) -> int:
    """Assign의 REF 표시 — 줄이 되는 단위(묶이지 않고 저절로 삭제되지 않은)의 제안."""
    return sum(
        unit["group_unit_id"] is None and unit["noise_kind"] is None and (unit["ref"] or {}).get("state") == "proposed"
        for unit in view["units"]
    )


def _count_view_captions(view: dict, decided_away: set[int]) -> int:
    """Assign의 Caption needed — 캡션 단위도 캡션 새 문장도 없는 표 · 그림(삭제 · 이동 빼고)."""
    captioned = {unit["group_unit_id"] for unit in view["units"] if unit["kind"] == "caption"}
    return sum(
        unit["kind"] in ("table", "figure") and unit["id"] not in captioned and unit["id"] not in decided_away
        for unit in view["units"]
    )


@pytest.mark.usefixtures("legacy_ref_proposals")
def test_refs_and_captions_match_the_assign_marks(client: TestClient) -> None:
    body = p(REF_LINES[0]) + p(REF_LINES[1]) + p("Keep the record.") + TABLE + FIGURE + FIGURE + p("Figure 1 Layout", "Caption")
    fx = Fixture(client, body)
    bare, _ = fx.of_kind("figure")
    fx.delete(bare)

    tidy = fx.tidy()

    assert (tidy["refs"], tidy["captions"]) == (_count_view_refs(fx.view), _count_view_captions(fx.view, {bare["id"]})) == (2, 1)


@pytest.mark.usefixtures("legacy_ref_proposals")
def test_a_settled_reference_is_not_left_to_tidy(client: TestClient) -> None:
    fx = Fixture(client, p(REF_LINES[0]) + p(REF_LINES[1]))
    edit = {"type": "clear_ref", "unit_id": find_unit(fx.view, REF_LINES[0])["id"]}
    body = {"revision": fx.view["document"]["revision"], "confirm": False, "op": edit}
    response = client.post(f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text

    assert fx.tidy()["refs"] == 1


@pytest.mark.usefixtures("legacy_ref_proposals")
def test_noise_lines_are_not_left_to_tidy(client: TestClient) -> None:
    """저절로 삭제된 줄은 배정 줄이 아니다 — 진행 숫자처럼 손질에도 들지 않는다."""
    fx = Fixture(client, p(REF_LINES[0]) + p(REF_LINES[1]) + TABLE)
    (table,) = fx.of_kind("table")
    for unit_id in (find_unit(fx.view, REF_LINES[0])["id"], table["id"]):
        update_row(Unit, unit_id, noise_kind="front")

    tidy = fx.tidy()

    assert (tidy["refs"], tidy["captions"]) == (1, 0)


def test_a_figure_sharing_the_first_figures_caption_needs_none(client: TestClient) -> None:
    """캡션 하나를 같이 쓰는 그림 묶음(F7 ⑥) — 뒤 그림은 첫 그림의 캡션이 제 캡션이다(프런트 caption_figure_id 길과 같다)."""
    fx = Fixture(client, FIGURE + FIGURE + p("Figure 1 Synthetic layout", "Caption"))
    first, second = sorted(fx.of_kind("figure"), key=lambda unit: unit["pos_seq"])
    assert find_unit(fx.view, "Figure 1 Synthetic layout")["group_unit_id"] == second["id"]
    assert fx.tidy()["captions"] == 1  # 앞 그림은 캡션이 없다

    body = {"revision": fx.view["document"]["revision"], "confirm": False, "op": {"type": "group_figures", "unit_ids": [first["id"], second["id"]]}}
    response = client.post(f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text
    units = {unit["id"]: unit for unit in get_view(client, fx.bundle_id, fx.doc_id)["units"]}
    assert units[second["id"]]["caption_figure_id"] == first["id"]  # 캡션은 첫 그림으로 옮겼다

    assert fx.tidy()["captions"] == 0


def test_a_written_caption_and_a_linked_table_need_no_caption(client: TestClient) -> None:
    fx = Fixture(client, TABLE + p("Keep the record.") + tbl([["One"], ["Two"]]) + FIGURE)
    first, second = fx.of_kind("table")
    assert fx.tidy()["captions"] == 3
    assign_as_is(client, fx.bundle_id, first, fx.sop_id, slot_key="purpose")  # 확정할 때 캡션을 써 넣는다
    _link_to_written(client, fx, second)

    assert fx.tidy()["captions"] == 1


def _link_to_written(client: TestClient, fx: Fixture, table: dict) -> None:
    """이미 쓴 New 문서의 표에 잇는다 — 캡션은 그 문서가 정한다."""
    response = upload(
        client, fx.bundle_id, build_docx(tbl([["One"], ["Two"]])), "SYNTHETIC_SOP-9_Written.docx", side="new", doc_type="sop"
    )
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text

    async def _link(session: AsyncSession) -> None:
        target_id = await session.scalar(
            select(TargetSentence.id).where(
                TargetSentence.bundle_id == fx.bundle_id, TargetSentence.kind == "table", TargetSentence.origin == "new_doc"
            )
        )
        session.add(TargetSource(target_id=target_id, unit_id=table["id"], seq=0))
        await session.commit()

    run_in_session(_link)


def test_waiting_counts_only_open_active_rows(client: TestClient) -> None:
    """정한 줄 · 은퇴한 단위 · 낡은 제안 · 받거나 버린 제안 · 숨긴 종류(칸 추천)는 세지 않는다."""
    fx = Fixture(client, FOUR_ROWS)
    rows = fx.of_kind("sentence")
    ids = [attach_match_suggestion(fx.bundle_id, unit["id"]) for unit in rows]
    attach_suggestion(fx.bundle_id, rows[0]["id"], "classify")
    assert fx.tidy()["ai_waiting"] == 4

    update_row(AiSuggestion, ids[0], result="stale")
    update_row(AiSuggestion, ids[1], adoption="rejected")
    assert fx.tidy()["ai_waiting"] == 2

    update_row(UnitDecision, rows[2]["id"], status="confirmed", disposition="assigned")
    assert fx.tidy()["ai_waiting"] == 1

    update_row(Unit, rows[3]["id"], status="retired")
    assert fx.tidy()["ai_waiting"] == 0


def test_a_suggestion_with_one_retired_unit_is_not_waiting(client: TestClient) -> None:
    fx = Fixture(client, FOUR_ROWS)
    first, second = fx.of_kind("sentence")[:2]
    suggestion_id = attach_match_suggestion(fx.bundle_id, first["id"])

    async def _cover_both(session: AsyncSession) -> None:
        content = {"unit_ids": [first["id"], second["id"]], "target_ids": []}
        await session.execute(update(AiSuggestion).where(AiSuggestion.id == suggestion_id).values(content=content))
        await session.commit()

    run_in_session(_cover_both)
    assert fx.tidy()["ai_waiting"] == 1

    update_row(Unit, second["id"], status="retired")

    assert fx.tidy()["ai_waiting"] == 0


def test_a_pair_row_is_open_when_one_side_is_open(client: TestClient) -> None:
    fx = Fixture(client, p(KO_ON) + p(EN_ON))
    ko, en = find_unit(fx.view, KO_ON), find_unit(fx.view, EN_ON)
    assert ko["pair_id"] == en["pair_id"] is not None
    attach_match_suggestion(fx.bundle_id, ko["id"])
    update_row(UnitDecision, ko["id"], status="confirmed", disposition="assigned")
    assert fx.tidy()["ai_waiting"] == 1

    update_row(UnitDecision, en["id"], status="confirmed", disposition="assigned")

    assert fx.tidy()["ai_waiting"] == 0


def test_a_held_row_is_not_waiting(client: TestClient) -> None:
    fx = Fixture(client, FOUR_ROWS)
    unit = fx.of_kind("sentence")[0]
    attach_match_suggestion(fx.bundle_id, unit["id"])

    update_row(UnitDecision, unit["id"], status="on_hold", hold_reason=REASON)

    assert fx.tidy()["ai_waiting"] == 0


def test_a_new_sentence_suggestion_waits_on_no_old_row(client: TestClient) -> None:
    """Old 단위가 없는 신규 제안은 안 정한 줄이 없어 세지 않는다."""
    fx = Fixture(client, FOUR_ROWS)
    response = upload(
        client, fx.bundle_id, build_docx(p("Added synthetic text.")), "SYNTHETIC_SOP-9_Written.docx", side="new", doc_type="sop"
    )
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    attach_new_target_suggestion(fx.bundle_id, response.json()["target_doc_id"])

    assert fx.tidy()["ai_waiting"] == 0


def test_an_empty_bundle_has_nothing_to_tidy(client: TestClient) -> None:
    assert create_bundle(client)["tidy"] == {"refs": 0, "captions": 0, "ai_waiting": 0}


def test_list_and_admin_responses_have_no_tidy(client: TestClient) -> None:
    fx = Fixture(client, FOUR_ROWS)

    listed = {row["id"]: row for row in client.get("/api/bundles", headers=AUTHOR).json()}[fx.bundle_id]
    admin = {row["id"]: row for row in client.get("/api/admin/bundles", headers=ADMIN).json()}[fx.bundle_id]

    assert "tidy" in get_bundle(client, fx.bundle_id)
    assert "tidy" not in listed and "tidy" not in admin
