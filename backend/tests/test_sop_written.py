"""Assign 화면의 읽기 — 이미 쓴 문서(입구 2)의 문장 목록과 Old Unit 하나의 New 문장 후보."""

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import TargetSentence
from app.sop.written import WrittenRow, rank_new_candidates
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p
from tests.sop_helpers import AUTHOR, OUTSIDER, create_bundle, find_unit, get_view, put_tobe, save_group, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]


def _upload_ready(client: TestClient, bundle_id: int, data: bytes, name: str, **kwargs: str) -> dict:
    response = upload(client, bundle_id, data, name, **kwargs)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()
    return response.json()


def _setup(client: TestClient, old_body: str, new_body: str) -> tuple[int, dict, dict]:
    """To-Be 하나·Old 문서 하나·이미 쓴 New 문서 하나를 올린 Bundle — (id, Old 보기, New 업로드 응답)."""
    bundle = create_bundle(client, is_synthetic=True)
    assert put_tobe(client, bundle["id"], TOBE_DOCS).status_code == 200
    old_doc = _upload_ready(client, bundle["id"], build_docx(old_body), "SYNTHETIC_OLD-1_Written.docx")
    new_doc = _upload_ready(
        client, bundle["id"], build_docx(new_body, headers=[p("합성 새 문서")]), "SYNTHETIC_SOP-W_Written.docx",
        side="new", doc_type="sop",
    )
    return bundle["id"], get_view(client, bundle["id"], old_doc["id"]), new_doc


def _list_written(client: TestClient, bundle_id: int) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/written-sentences", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _load_new_targets(target_doc_id: int) -> list[tuple[int, int | None]]:
    async def _load(session: AsyncSession) -> list[tuple[int, int | None]]:
        rows = await session.execute(
            select(TargetSentence.id, TargetSentence.parent_target_id)
            .where(TargetSentence.target_doc_id == target_doc_id, TargetSentence.origin == "new_doc")
            .order_by(TargetSentence.order_index, TargetSentence.id)
        )
        return [(row.id, row.parent_target_id) for row in rows]

    return run_in_session(_load)


def test_written_sentences_lists_match_doc_sentences_in_order(client: TestClient) -> None:
    bundle_id, _, new_doc = _setup(
        client, p("합성 장비를 켠다."), p("1. 준비", "Heading1") + p("합성 장비를 켠다.") + p("합성 라벨을 붙인다."),
    )
    top_level = [target_id for target_id, parent in _load_new_targets(new_doc["target_doc_id"]) if parent is None]

    rows = _list_written(client, bundle_id)

    assert [row["target_id"] for row in rows] == top_level
    assert [row["text"] for row in rows] == ["합성 장비를 켠다.", "합성 라벨을 붙인다."]
    assert {row["section_path"] for row in rows} == {"1. 준비"}
    assert len({row["target_doc_id"] for row in rows}) == 1
    assert rows[0]["target_doc_id"] == new_doc["target_doc_id"]
    assert all(row["source_unit_ids"] == [] and row["kind"] == "sentence" for row in rows)


def test_written_sentences_reports_partner_target(client: TestClient) -> None:
    bundle_id, _, _ = _setup(
        client, p("합성 장비를 켠다."), p("합성 장비를 켠다.") + p("Turn on the synthetic unit."),
    )

    ko, en = _list_written(client, bundle_id)

    assert (ko["lang"], en["lang"]) == ("ko", "en")
    assert ko["partner_target_id"] == en["target_id"]
    assert en["partner_target_id"] == ko["target_id"]


def test_written_sentences_shows_sources_after_link(client: TestClient) -> None:
    bundle_id, old_view, _ = _setup(client, p("합성 장비를 켠다."), p("합성 장비를 켠다."))
    unit = find_unit(old_view, "합성 장비를 켠다.")
    (row,) = _list_written(client, bundle_id)

    saved = save_group(client, bundle_id, {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [{"key": "t", "id": row["target_id"], "revision": row["revision"], "source_unit_ids": [unit["id"]]}],
    })

    assert saved.status_code == 200, saved.text
    (after,) = _list_written(client, bundle_id)
    assert (after["source_unit_ids"], after["status"]) == ([unit["id"]], "confirmed")


def test_one_language_link_leaves_the_pair_partner_open(client: TestClient) -> None:
    """Old는 한/영 짝인데 New에 한 언어만 있을 때 — 있는 언어만 이어 확정하고 짝을 풀면 남은 단위는 판단 없는 제 줄로 남는다.

    Assign 화면이 보내는 요청 그대로다(남은 단위를 싣지 않는다). 판단 없는 단위를 함께 실으면 422 hold_required다.
    """
    korean_text, english_text = "합성 장비를 켠다.", "Turn on the synthetic unit."
    bundle_id, old_view, _ = _setup(client, p(korean_text) + p(english_text), p(english_text))
    korean, english = find_unit(old_view, korean_text), find_unit(old_view, english_text)
    (pair,) = old_view["pairs"]
    assert sorted(pair["unit_ids"]) == sorted([korean["id"], english["id"]])
    (row,) = _list_written(client, bundle_id)
    link = {"key": "t", "id": row["target_id"], "revision": row["revision"], "source_unit_ids": [english["id"]]}
    linked_unit = {"unit_id": english["id"], "revision": 1, "disposition": "assigned"}
    doc_url = f"/api/bundles/{bundle_id}/documents/{old_view['document']['id']}"

    with_partner = save_group(client, bundle_id, {
        "action": "confirm",
        "units": [linked_unit, {"unit_id": korean["id"], "revision": 1, "disposition": "unassigned"}],
        "targets": [link],
    })
    saved = save_group(client, bundle_id, {"action": "confirm", "units": [linked_unit], "targets": [link]})
    unpaired = client.delete(
        f"{doc_url}/pairs/{pair['id']}", params={"revision": old_view["document"]["revision"]}, headers=AUTHOR
    )

    assert with_partner.status_code == 422
    assert with_partner.json()["detail"] == {"code": "invalid_group", "reason": "hold_required", "unit_ids": [korean["id"]]}
    assert saved.status_code == 200, saved.text
    assert unpaired.status_code == 200, unpaired.text
    units = client.get(f"/api/bundles/{bundle_id}/units", params={"limit": 1000}, headers=AUTHOR).json()["items"]
    assert {unit["unit_id"]: (unit["status"], unit["pair_id"]) for unit in units} == {
        korean["id"]: ("unassigned", None),
        english["id"]: ("confirmed", None),
    }


def test_new_candidates_same_language_only(client: TestClient) -> None:
    bundle_id, old_view, _ = _setup(
        client, p("합성 장비를 켠다."),
        p("합성 장비를 켠다.") + p("Turn on the synthetic unit.") + p("합성 장비를 끈다.") + p("Turn off the synthetic unit."),
    )
    unit = find_unit(old_view, "합성 장비를 켠다.")
    written = {row["target_id"]: row for row in _list_written(client, bundle_id)}

    response = client.get(f"/api/bundles/{bundle_id}/units/{unit['id']}/new-candidates", headers=AUTHOR)

    assert response.status_code == 200, response.text
    assert response.json()
    assert {written[item["target_id"]]["lang"] for item in response.json()} == {"ko"}


def test_new_candidates_ranks_identical_text_first(client: TestClient) -> None:
    bundle_id, old_view, _ = _setup(
        client, p("합성 시료는 밀봉하여 보관한다."), p("합성 시료를 확인한다.") + p("합성 시료는 밀봉하여 보관한다."),
    )
    unit = find_unit(old_view, "합성 시료는 밀봉하여 보관한다.")

    response = client.get(f"/api/bundles/{bundle_id}/units/{unit['id']}/new-candidates", headers=AUTHOR)

    assert response.status_code == 200, response.text
    first = response.json()[0]
    assert (first["text"], first["basis"]) == ("합성 시료는 밀봉하여 보관한다.", "text")


def test_new_candidates_hides_bundle_from_non_member(client: TestClient) -> None:
    """멤버가 아니면 묶음이 없는 것처럼 404 — 다른 묶음 읽기와 같은 규칙."""
    bundle_id, old_view, _ = _setup(client, p("합성 장비를 켠다."), p("합성 장비를 켠다."))
    unit = find_unit(old_view, "합성 장비를 켠다.")

    response = client.get(f"/api/bundles/{bundle_id}/units/{unit['id']}/new-candidates", headers=OUTSIDER)
    written = client.get(f"/api/bundles/{bundle_id}/written-sentences", headers=OUTSIDER)

    assert (response.status_code, written.status_code) == (404, 404)


def _row(target_id: int, text: str) -> WrittenRow:
    return WrittenRow(target_id=target_id, lang="ko", kind="sentence", text=text)


def test_rank_new_candidates_prefers_embedding_when_cached() -> None:
    near = np.array([1.0, 0.0], dtype=np.float32)
    far = np.array([0.0, 1.0], dtype=np.float32)
    rows = [_row(1, "가나다라"), _row(2, "마바사아")]

    ranked = rank_new_candidates("가나다라", near, rows, {"가나다라": far, "마바사아": near})

    assert [(target_id, basis) for target_id, _, basis in ranked] == [(2, "embedding")]


def test_rank_new_candidates_falls_back_to_text_without_vectors() -> None:
    rows = [_row(1, "합성 장비를 켠다."), _row(2, "전혀 다른 글")]

    ranked = rank_new_candidates("합성 장비를 켠다.", None, rows, {})

    assert [(target_id, basis) for target_id, _, basis in ranked] == [(1, "text")]
