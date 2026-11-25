"""New 문서 편집의 단계 되돌리기 · 다시 하기 — new_unit_id마다 새 문장 하나(쪼개기 먼저 설계 §4-1)."""

from collections import Counter

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.decision_steps import Snapshot
from app.sop.detach import ORIGIN_TRANSLATION, UNASSIGNED
from app.sop.models import TargetSentence
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, make_grid_table, make_row, p
from tests.sop_helpers import AUTHOR, REVIEWER, create_bundle, find_unit, get_view, save_group, set_members, upload
from tests.test_sop_decision_undo import _dump, _redo, _undo, assert_same_state

pytestmark = pytest.mark.usefixtures("clean_sop")

K1 = "새 필터를 끼우고 기록지에 적는다."
K2 = "장치를 멈추고 압력을 확인한다."
K3 = "보호 장갑과 보안경을 착용한다."
UNDO = {"session": "s1"}


def _setup(client: TestClient) -> tuple[int, dict, dict]:
    """묶음 id, Old 문서, New 문서 — New는 문장 · 표(칸 하나에 문장 둘) · 문장이다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    old_body = p("절", "Heading1") + p(K1) + p(K2)
    old = upload(client, bundle_id, build_docx(old_body), "SYNTHETIC_OLD-1_A.docx")
    table = make_grid_table(
        2, make_row(["항목", "내용"], header=True) + make_row(["교체", p(K1) + p(K2)]) + make_row(["준비", K3])
    )
    new_body = p("새 절", "Heading1") + p("앞 문장이다. 이어진 문장이다.") + table + p("뒤 문장이다.") + p("끝 문장이다.")
    new = upload(client, bundle_id, build_docx(new_body), "SYNTHETIC_NEW-1_B.docx", side="new", doc_type="sop")
    assert old.status_code == 201 and new.status_code == 201, (old.text, new.text)
    return bundle_id, old.json(), new.json()


def _push_ids(client: TestClient, bundle_id: int, number: int) -> None:
    """다른 New 문서를 올려 id를 민다 — sqlite가 지운 id를 다시 쓰면 결함이 가려진다(글이 매번 달라야 409 중복 파일이 안 난다)."""
    data = build_docx(p("다른 절", "Heading1") + p(f"다른 문서의 문장 {number}이다."))
    response = upload(client, bundle_id, data, f"SYNTHETIC_NEW-{number}_C.docx", side="new", doc_type="sop")
    assert response.status_code == 201, response.text


def _edit(client: TestClient, bundle_id: int, doc: dict, op: dict) -> None:
    """편집 하나 — 409 confirm_required면 confirm을 켜고 한 번 더."""
    for confirm in (False, True):
        revision = get_view(client, bundle_id, doc["id"])["document"]["revision"]
        response = client.post(
            f"/api/bundles/{bundle_id}/documents/{doc['id']}/edits",
            json={"revision": revision, "confirm": confirm, "op": op, "undo": UNDO}, headers=AUTHOR,
        )
        if response.status_code != 409:
            break
    assert response.status_code == 200, response.text


def _link_cell(client: TestClient, bundle_id: int, old: dict, new: dict) -> None:
    """Old K1을 New K1 문장에 잇고 확정 — 칸이면 같은 표의 줄을 parent_key와 함께 되보낸다."""
    unit = find_unit(get_view(client, bundle_id, old["id"]), K1)
    cell_id = find_unit(get_view(client, bundle_id, new["id"]), K1)["id"]
    state = _dump(bundle_id)["target_sentences"]
    target_id, parent = next((int(key), row["parent_target_id"]) for key, row in state.items() if row["new_unit_id"] == cell_id)
    rows = {
        key: row for key, row in state.items()
        if int(key) == target_id or (parent is not None and parent in (int(key), row["parent_target_id"]))
    }
    targets = [
        {
            "key": key, "id": int(key), "revision": row["revision"], "kind": row["kind"],
            "cell_row": row["cell_row"], "cell_col": row["cell_col"],
            "source_unit_ids": [unit["id"]] if int(key) == target_id else [],
            "parent_key": str(row["parent_target_id"]) if row["parent_target_id"] else None,
        }
        for key, row in rows.items()
    ]
    body = {
        "action": "confirm", "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": targets, "undo": UNDO,
    }
    response = save_group(client, bundle_id, body)
    assert response.status_code == 200, response.text


def _build_op(view: dict, case: str) -> dict:
    sentences = [unit for unit in view["units"] if unit["kind"] == "sentence"]
    if case == "split":
        return {"type": "split", "unit_id": sentences[0]["id"], "at": 3}
    if case == "merge":
        at = next(index for index, unit in enumerate(sentences) if unit["text"] == "뒤 문장이다.")
        return {"type": "merge", "unit_ids": [sentences[at]["id"], sentences[at + 1]["id"]]}
    if case == "split_cell":  # 이은 칸 자체를 나눈다
        return {"type": "split", "unit_id": find_unit(view, K1)["id"], "at": 4}
    if case == "merge_cell":  # 이은 칸을 같은 칸의 옆 문장과 합친다
        return {"type": "merge", "unit_ids": [find_unit(view, K1)["id"], find_unit(view, K2)["id"]]}
    return {"type": "set_layout_table", "table_id": view["tables"][0]["id"], "is_layout": case == "unwrap"}


def _assert_one_each(state: Snapshot) -> None:
    counts = Counter(row["new_unit_id"] for row in state["target_sentences"].values() if row["new_unit_id"] is not None)
    assert [unit_id for unit_id, count in counts.items() if count != 1] == []


def _copy_target(unit_id: int, **columns: object) -> int:
    """그 단위의 새 문장을 베낀 행 하나 — columns는 바꿀 값. 만든 새 문장 id를 돌려준다."""
    async def _run(session: AsyncSession) -> int:
        source = await session.scalar(select(TargetSentence).where(TargetSentence.new_unit_id == unit_id))
        assert source is not None
        skipped = ("id", "updated_at", "confirmed_by", "confirmed_at")
        values = {col.name: getattr(source, col.name) for col in TargetSentence.__table__.columns if col.name not in skipped}
        copy = TargetSentence(**{**values, "revision": 1, **columns})
        session.add(copy)
        await session.commit()
        return copy.id

    return run_in_session(_run)


def _read_cell(client: TestClient, bundle_id: int) -> list[str]:
    """New 표에서 문장 둘인 칸의 글."""
    rows = client.get(f"/api/bundles/{bundle_id}/written-sentences", headers=AUTHOR).json()
    table = next(row for row in rows if row["kind"] == "table")
    return [cell["text"] for cell in table["table"]["cells"] if (cell["row"], cell["col"]) == (1, 1)]


def _strip(rows: dict[str, dict]) -> dict[str, dict]:
    return {key: {col: v for col, v in row.items() if col not in ("revision", "updated_at")} for key, row in rows.items()}


@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("case", ["split", "merge", "unwrap", "rewrap", "split_cell", "merge_cell"])
def test_undo_and_redo_keep_one_new_sentence_per_unit(client: TestClient, case: str, linked: bool) -> None:
    bundle_id, old, new = _setup(client)
    _push_ids(client, bundle_id, 2)
    if case == "rewrap":
        _edit(client, bundle_id, new, _build_op(get_view(client, bundle_id, new["id"]), "unwrap"))
    if linked:
        _link_cell(client, bundle_id, old, new)
    before = _dump(bundle_id)
    _edit(client, bundle_id, new, _build_op(get_view(client, bundle_id, new["id"]), case))
    _push_ids(client, bundle_id, 3)
    after = _dump(bundle_id)

    for _ in range(2):  # 여러 번 오간다
        undo = _undo(client, bundle_id)
        assert undo.status_code == 200, undo.text
        undone = _dump(bundle_id)
        _assert_one_each(undone)
        for name in ("target_sentences", "target_sources", "unit_decisions"):  # 이음과 확정까지 되살아난다
            assert _strip({key: undone[name].get(key, {}) for key in before[name]}) == _strip(before[name])

        redo = _redo(client, bundle_id)  # 이은 칸이 있어도 409 confirm_required가 아니다
        assert redo.status_code == 200, redo.text
        _assert_one_each(_dump(bundle_id))
        assert_same_state(_dump(bundle_id), after)


def test_redo_asks_when_a_row_outside_the_step_is_linked(client: TestClient) -> None:
    """고치기 전에 생긴 중복 새 문장(단계에 안 찍힌 행)에 남이 이은 것은 다시 하기가 말없이 떼지 않는다."""
    bundle_id, old, new = _setup(client)
    _push_ids(client, bundle_id, 2)
    op = _build_op(get_view(client, bundle_id, new["id"]), "split")
    _edit(client, bundle_id, new, op)
    _push_ids(client, bundle_id, 3)
    assert _undo(client, bundle_id).status_code == 200
    duplicate_id = _copy_target(op["unit_id"])
    old_unit = find_unit(get_view(client, bundle_id, old["id"]), K1)
    assert set_members(client, bundle_id, [("qa.member", "author"), ("qa.lead", "author")]).status_code == 200
    target = {"key": "d", "id": duplicate_id, "revision": 1, "kind": "sentence", "source_unit_ids": [old_unit["id"]]}
    body = {
        "action": "confirm", "units": [{"unit_id": old_unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [target], "undo": {"session": "s2"},
    }
    saved = save_group(client, bundle_id, body, headers=REVIEWER)
    assert saved.status_code == 200, saved.text
    linked = _dump(bundle_id)

    redo = _redo(client, bundle_id)

    assert redo.status_code == 409, redo.text
    assert redo.json()["detail"] == {"code": "confirm_required", "unit_ids": [op["unit_id"]]}
    assert _dump(bundle_id) == linked


def test_redo_passes_when_a_row_outside_the_step_is_untouched(client: TestClient) -> None:
    """이음 · 판단이 없는 중복 새 문장은 이은 칸의 다시 하기를 막지 않는다."""
    bundle_id, old, new = _setup(client)
    _push_ids(client, bundle_id, 2)
    _link_cell(client, bundle_id, old, new)
    op = _build_op(get_view(client, bundle_id, new["id"]), "split_cell")
    _edit(client, bundle_id, new, op)
    _push_ids(client, bundle_id, 3)
    assert _undo(client, bundle_id).status_code == 200
    _copy_target(op["unit_id"], status=UNASSIGNED, change_type=None)

    redo = _redo(client, bundle_id)

    assert redo.status_code == 200, redo.text
    _assert_one_each(_dump(bundle_id))


def test_translation_rows_come_after_their_cell_sentences(client: TestClient) -> None:
    """번역 행은 new_unit_id가 없다 — NULL 정렬이 다른 sqlite · postgres 모두 칸 문장 뒤다."""
    bundle_id, _, new = _setup(client)
    unit = find_unit(get_view(client, bundle_id, new["id"]), K1)
    _copy_target(
        unit["id"], new_unit_id=None, origin=ORIGIN_TRANSLATION, lang="en", confirmed_text="", ai_text="Translation of K1.",
        status="ai_suggested", change_type="translated",
    )

    assert _read_cell(client, bundle_id) == [K1, K2, "Translation of K1."]


def test_cell_sentences_follow_unit_order_after_split_and_edit_undo(client: TestClient) -> None:
    bundle_id, _, new = _setup(client)
    _push_ids(client, bundle_id, 2)

    assert _read_cell(client, bundle_id) == [K1, K2]

    unit = find_unit(get_view(client, bundle_id, new["id"]), K1)
    _edit(client, bundle_id, new, {"type": "split", "unit_id": unit["id"], "at": 4})
    assert _read_cell(client, bundle_id) == ["새 필터", "를 끼우고 기록지에 적는다.", K2]

    revision = get_view(client, bundle_id, new["id"])["document"]["revision"]
    undo = client.post(
        f"/api/bundles/{bundle_id}/documents/{new['id']}/edits/undo", json={"revision": revision}, headers=AUTHOR
    )
    assert undo.status_code == 200, undo.text
    assert _read_cell(client, bundle_id) == [K1, K2]
