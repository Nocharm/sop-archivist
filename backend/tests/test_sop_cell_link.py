"""New 표 칸 잇기(시안 2 D5) — Assign 화면이 보내는 칸 잇기 저장 모양, 형제 칸이 그대로인지, 결과물 A Place의 칸 자리."""

import pytest
from fastapi.testclient import TestClient

from tests.ai_fixtures import (
    MatchBundle,
    clean_ai_jobs,  # noqa: F401 -- 픽스처는 usefixtures가 이름으로 찾는다
    make_match_bundle,
    run_jobs,
)
from tests.docx_factory import p, tbl
from tests.fake_ai import FakeAi
from tests.sop_helpers import AUTHOR, get_group_by_unit, get_view, save_group
from tests.test_sop_ai_translate import load_translation, queue_translation, use_translation

pytestmark = pytest.mark.usefixtures("clean_sop", "clean_ai_jobs")

OLD_ONE = "합성 압력"
OLD_TWO = "합성 압력을 기록한다."
OLD_THREE = "합성 결과를 적는다."
CELLS = [["합성 항목", "합성 값"], [OLD_ONE, "합성 결과"]]
TRANSLATED = "Synthetic pressure"


def _make_bundle(client: TestClient) -> tuple[MatchBundle, dict]:
    """Old 문장 셋과 2×2 표 하나만 든 이미 쓴 New 문서 — (묶음, Old 보기)."""
    bundle = make_match_bundle(client, p(OLD_ONE) + p(OLD_TWO) + p(OLD_THREE), p("1. 합성 절", "Heading1") + tbl(CELLS))
    return bundle, get_view(client, bundle.id, bundle.old_document_id)


def _get_group_by_target(client: TestClient, bundle_id: int, target_id: int) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/groups/by-target/{target_id}", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _list_cells(client: TestClient, bundle_id: int) -> dict[tuple[int, int], dict]:
    """이미 쓴 문서 표 줄의 한국어 칸 — (행, 열) → 칸(written-sentences 응답 그대로). 칸 번역(영어)은 같은 자리에 하나 더 있다."""
    response = client.get(f"/api/bundles/{bundle_id}/written-sentences", headers=AUTHOR)
    assert response.status_code == 200, response.text
    (table,) = [row for row in response.json() if row["kind"] == "table"]
    return {(cell["row"], cell["col"]): cell for cell in table["table"]["cells"] if cell["lang"] == "ko"}


def _find_unit_id(view: dict, text: str) -> int:
    return next(unit["id"] for unit in view["units"] if unit["text"] == text)


def link_cell(client: TestClient, bundle_id: int, cell_id: int, unit_ids: list[int]):
    """Assign 화면의 칸 잇기 저장(classify-model link) — 칸의 닫힌 관계 묶음과 Old 줄의 묶음을 합쳐, 그 칸 새 문장의 출처에만
    줄 단위를 더하고 나머지 단위·새 문장은 지금 그대로 되보낸다. 입구 2 칸은 parent_key를 비운다(서버가 지금 부모로 묶는다)."""
    groups = [_get_group_by_target(client, bundle_id, cell_id), *(get_group_by_unit(client, bundle_id, uid) for uid in unit_ids)]
    units = {unit["unit_id"]: unit for group in groups for unit in group["units"]}
    targets = {target["id"]: target for group in groups for target in group["targets"]}
    return save_group(client, bundle_id, {
        "action": "confirm",
        "units": [
            {
                "unit_id": unit_id,
                "revision": unit["decision"]["revision"],
                "disposition": "assigned" if unit_id in unit_ids else unit["decision"]["disposition"],
                "move_target_code": unit["decision"]["move_target_code"],
                "reason": unit["decision"]["reason"],
            }
            for unit_id, unit in units.items()
        ],
        "targets": [
            {
                "key": f"t{target['id']}", "id": target["id"], "revision": target["revision"], "kind": target["kind"],
                "source_unit_ids": target["source_unit_ids"] + (unit_ids if target["id"] == cell_id else []),
            }
            for target in targets.values()
        ],
        "removed_target_ids": [],
    })


def test_linking_one_old_sentence_to_a_cell_confirms_only_that_cell(client: TestClient) -> None:
    bundle, view = _make_bundle(client)
    unit_id = _find_unit_id(view, OLD_ONE)
    before = _list_cells(client, bundle.id)
    cell = before[(1, 0)]

    response = link_cell(client, bundle.id, cell["target_id"], [unit_id])

    assert response.status_code == 200, response.text
    after = _list_cells(client, bundle.id)
    linked = after[(1, 0)]
    assert (linked["source_unit_ids"], linked["status"]) == ([unit_id], "confirmed")
    assert linked["revision"] > cell["revision"]
    group = _get_group_by_target(client, bundle.id, cell["target_id"])
    (target,) = [target for target in group["targets"] if target["id"] == cell["target_id"]]
    assert target["change_type"] == "as_is"  # 칸 글이 Old 글과 같다
    # 형제 칸은 글·상태·revision·출처 그대로
    for place in [(0, 0), (0, 1), (1, 1)]:
        assert after[place] == before[place]


def test_linking_two_old_sentences_to_one_cell_merges(client: TestClient) -> None:
    bundle, view = _make_bundle(client)
    first, second = _find_unit_id(view, OLD_ONE), _find_unit_id(view, OLD_TWO)
    cell_id = _list_cells(client, bundle.id)[(1, 0)]["target_id"]
    assert link_cell(client, bundle.id, cell_id, [first]).status_code == 200

    response = link_cell(client, bundle.id, cell_id, [second])

    assert response.status_code == 200, response.text
    assert _list_cells(client, bundle.id)[(1, 0)]["source_unit_ids"] == [first, second]
    group = _get_group_by_target(client, bundle.id, cell_id)
    (target,) = [target for target in group["targets"] if target["id"] == cell_id]
    assert target["change_type"] == "merged"
    assert {unit["unit_id"]: unit["decision"]["status"] for unit in group["units"]} == {
        first: "confirmed", second: "confirmed",
    }


def test_linking_a_cell_keeps_a_sibling_cells_ai_translation(client: TestClient, fake_ai: FakeAi) -> None:
    """표 전체가 한 관계 묶음이라 칸 하나를 이으면 형제 칸도 같은 저장에 실린다 — 형제 칸의 번역 쓸기(sweep_translations)가
    돌지 않아야 한다(글·출처를 바꾸지 않은 되보냄)."""
    bundle, view = _make_bundle(client)
    first, second = _find_unit_id(view, OLD_ONE), _find_unit_id(view, OLD_THREE)
    cells = _list_cells(client, bundle.id)
    assert link_cell(client, bundle.id, cells[(1, 0)]["target_id"], [first]).status_code == 200
    use_translation(fake_ai, TRANSLATED)
    queue_translation(client, bundle.id, first)
    run_jobs()
    translation = load_translation(first)
    sibling = _list_cells(client, bundle.id)[(1, 0)]

    response = link_cell(client, bundle.id, cells[(1, 1)]["target_id"], [second])

    assert response.status_code == 200, response.text
    after = _list_cells(client, bundle.id)
    assert (after[(1, 1)]["source_unit_ids"], after[(1, 1)]["status"]) == ([second], "confirmed")
    assert after[(1, 0)] == sibling
    kept = load_translation(first)
    assert (kept.id, kept.status, kept.ai_text, kept.parent_target_id, kept.cell_row, kept.cell_col) == (
        translation.id, "ai_suggested", TRANSLATED, translation.parent_target_id, 1, 0,
    )
    # 형제 칸의 출처 판단도 쓰지 않는다(revision 그대로)
    assert get_group_by_unit(client, bundle.id, first)["units"][0]["decision"]["revision"] == 2


def test_clearing_a_cell_link_leaves_the_other_cells_alone(client: TestClient) -> None:
    """칩 ×(출처가 그 칸 하나뿐인 줄)는 배정 지우기다 — 떼어 내기가 관계 묶음의 나머지를 보류하는데, 표의 다른 칸과 그 출처는
    칸 하나의 일과 상관이 없어 그대로 둔다."""
    bundle, view = _make_bundle(client)
    first, second = _find_unit_id(view, OLD_ONE), _find_unit_id(view, OLD_THREE)
    cells = _list_cells(client, bundle.id)
    assert link_cell(client, bundle.id, cells[(1, 0)]["target_id"], [first]).status_code == 200
    assert link_cell(client, bundle.id, cells[(1, 1)]["target_id"], [second]).status_code == 200
    before = _list_cells(client, bundle.id)
    revision = get_group_by_unit(client, bundle.id, second)["units"][0]["decision"]["revision"]

    response = client.post(
        f"/api/bundles/{bundle.id}/decisions/clear", json={"unit_id": second, "revision": revision}, headers=AUTHOR,
    )

    assert response.status_code == 200, response.text
    assert response.json()["held_unit_ids"] == [] and response.json()["held_target_ids"] == []
    after = _list_cells(client, bundle.id)
    assert (after[(1, 1)]["source_unit_ids"], after[(1, 1)]["status"]) == ([], "unassigned")
    assert after[(1, 0)] == before[(1, 0)]
    unit = get_group_by_unit(client, bundle.id, first)["units"][0]
    assert unit["decision"]["status"] == "confirmed"


@pytest.mark.parametrize(("lang", "place"), [("ko", "1. 합성 절 · 표 1 · 2행 1열"), ("en", "1. 합성 절 · Table 1 · R 2 C 1")])
def test_output_a_place_names_the_linked_cell(client: TestClient, lang: str, place: str) -> None:
    bundle, view = _make_bundle(client)
    unit_id = _find_unit_id(view, OLD_ONE)
    cell_id = _list_cells(client, bundle.id)[(1, 0)]["target_id"]
    assert link_cell(client, bundle.id, cell_id, [unit_id]).status_code == 200

    response = client.get(f"/api/bundles/{bundle.id}/outputs/a", params={"lang": lang}, headers=AUTHOR)

    assert response.status_code == 200, response.text
    (row,) = [row for row in response.json() if row["unit_id"] == unit_id]
    assert row["dest_location"] == place
