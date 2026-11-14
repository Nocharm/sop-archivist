"""표 행 나누기·다시 합치기·레이아웃 표 바꾸기 — 칸 문장 다시 묶기, 확인 플래그, 되돌리기·다시 하기, 새 문서 칸 새 문장(R32)."""

import random
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import COVER_KINDS, SYSTEM_HOLD_RELATED_CHANGED
from app.sop.coverage import find_coverage_problems
from app.sop.models import TargetSentence, TargetSource, Unit, UnitDecisionHistory, UnitEdit
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import (
    AUTHOR,
    assign_as_is,
    create_bundle,
    find_unit,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD_NAME = "SYNTHETIC_OLD-1_Tables.docx"
NEW_NAME = "SYNTHETIC_SOP-T_Tables.docx"
ROWS = [["합성 값 하나.", "Value one."], ["합성 값 둘.", "Value two."], ["합성 값 셋.", "Value three."]]
CELL_TEXTS = [text for row in ROWS for text in row]
TOBE_DOCS = [
    {"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None},
    {"code": "WI-01", "title": "Synthetic WI", "doc_type": "wi", "parent_code": "SOP-NEW"},
]
EMPTY_DETACH = {"reset_unit_ids": [], "deleted_target_ids": [], "held_unit_ids": [], "held_target_ids": []}


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    wi_id: int
    doc: dict
    view: dict


def _upload_ready(client: TestClient, bundle_id: int, data: bytes, name: str, **kwargs: str) -> dict:
    response = upload(client, bundle_id, data, name, **kwargs)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()
    return response.json()


def _setup(client: TestClient, body: str) -> Fixture:
    """To-Be(입구 1 SOP 하나와 그 WI)와 옛 문서 하나를 올린 묶음."""
    bundle = create_bundle(client, is_synthetic=True)
    response = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop, wi = response.json()["docs"]
    doc = _upload_ready(client, bundle["id"], build_docx(body), OLD_NAME)
    return Fixture(bundle["id"], sop["id"], wi["id"], doc, get_view(client, bundle["id"], doc["id"]))


def _edit(client: TestClient, bundle_id: int, doc_id: int, op: dict, *, confirm: bool = False) -> httpx2.Response:
    """편집 하나 — 지금 문서 revision을 읽어 싣는다. 거절 응답도 그대로 돌려준다."""
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    body = {"revision": revision, "confirm": confirm, "op": op}
    return client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR)


def _step(client: TestClient, bundle_id: int, doc_id: int, action: str, *, confirm: bool = False) -> httpx2.Response:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    return client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}",
        json={"revision": revision, "confirm": confirm}, headers=AUTHOR,
    )


def _split_rows(table_unit: dict) -> dict:
    return {"type": "split_table_rows", "table_unit_id": table_unit["id"]}


def _merge_rows(table_id: int) -> dict:
    return {"type": "merge_table_rows", "table_id": table_id}


def _set_layout(table_id: int, is_layout: bool) -> dict:
    return {"type": "set_layout_table", "table_id": table_id, "is_layout": is_layout}


def _ok(response: httpx2.Response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()


def _code(response: httpx2.Response) -> tuple[int, str]:
    return response.status_code, response.json()["detail"]["code"]


def _units_of_kind(view: dict, kind: str) -> list[dict]:
    return [unit for unit in view["units"] if unit["kind"] == kind]


def _groups_of(view: dict, texts: list[str]) -> list[int | None]:
    return [find_unit(view, text)["group_unit_id"] for text in texts]


def _load_statuses(*unit_ids: int) -> list[str]:
    async def _run(session: AsyncSession) -> list[str]:
        return [(await session.get_one(Unit, unit_id)).status for unit_id in unit_ids]

    return run_in_session(_run)


def _load_last_edit(doc_id: int) -> dict:
    async def _run(session: AsyncSession) -> dict:
        edit = await session.scalar(
            select(UnitEdit).where(UnitEdit.document_id == doc_id).order_by(UnitEdit.seq.desc()).limit(1)
        )
        return {"op": edit.op, "regrouped": edit.regrouped, "layout_changes": edit.layout_changes}

    return run_in_session(_run)


def _load_first_cell_seqs(view: dict, table_id: int) -> dict[int, int]:
    """표의 행 → 그 행 첫 칸 블록 seq (행 단위의 자리)."""
    seqs: dict[int, int] = {}
    for block in view["blocks"]:
        if block["table_id"] == table_id and block["kind"] == "table_cell":
            seqs.setdefault(block["row_index"], block["seq"])
    return seqs


def _load_targets(target_doc_id: int) -> list[dict]:
    async def _run(session: AsyncSession) -> list[dict]:
        rows = await session.scalars(
            select(TargetSentence)
            .where(TargetSentence.target_doc_id == target_doc_id)
            .order_by(TargetSentence.order_index, TargetSentence.id)
        )
        return [
            {
                "id": row.id, "kind": row.kind, "text": row.confirmed_text, "new_unit_id": row.new_unit_id,
                "parent_target_id": row.parent_target_id, "cell_row": row.cell_row, "cell_col": row.cell_col,
                "grid": row.grid, "status": row.status, "change_type": row.change_type, "revision": row.revision,
            }
            for row in rows
        ]

    return run_in_session(_run)


def _count_sources(target_id: int) -> int:
    async def _run(session: AsyncSession) -> int:
        return await session.scalar(
            select(func.count()).select_from(TargetSource).where(TargetSource.target_id == target_id)
        )

    return run_in_session(_run)


def _load_history_causes(unit_id: int) -> list[str]:
    async def _run(session: AsyncSession) -> list[str]:
        return list(
            await session.scalars(
                select(UnitDecisionHistory.cause).where(UnitDecisionHistory.unit_id == unit_id)
                .order_by(UnitDecisionHistory.id)
            )
        )

    return run_in_session(_run)


def _find_coverage_problems(view: dict) -> list[str]:
    block_texts = {block["id"]: block["text"] for block in view["blocks"]}
    return find_coverage_problems(
        block_texts, [[tuple(span) for span in unit["spans"]] for unit in view["units"] if unit["kind"] in COVER_KINDS]
    )


# ── 행 나누기 ────────────────────────────────────────────────────────────────


def test_split_table_rows_regroups_cells(client: TestClient) -> None:
    """칸이 있는 행마다 행 단위(범위 없음·중립·미배정, 자리는 그 행 첫 칸 블록 앞)를 만들고 칸 문장을 자기 행에 묶는다."""
    fx = _setup(client, p("합성 표 앞 문장.") + tbl([ROWS[0], ROWS[1], ["", ""], ROWS[2]]))
    (table,) = _units_of_kind(fx.view, "table")
    cells = [find_unit(fx.view, text) for text in CELL_TEXTS]

    result = _ok(_edit(client, fx.bundle_id, fx.doc["id"], _split_rows(table)))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    rows = _units_of_kind(view, "table_row")
    first_seqs = _load_first_cell_seqs(view, table["table_id"])
    assert result == {
        "document_revision": 2, "created_unit_ids": [row["id"] for row in rows], "retired_unit_ids": [table["id"]],
        "detach": EMPTY_DETACH,
    }
    # 빈 행(2)은 칸 문장이 없어 행 단위가 없다
    assert [
        (row["row_index"], row["table_id"], row["spans"], row["text"], row["lang"], row["status"], row["pos_seq"])
        for row in rows
    ] == [(index, table["table_id"], [], "", "neutral", "unassigned", first_seqs[index]) for index in (0, 1, 3)]
    assert _units_of_kind(view, "table") == []
    row_ids = {row["row_index"]: row["id"] for row in rows}
    assert _groups_of(view, CELL_TEXTS) == [row_ids[index] for index in (0, 0, 1, 1, 3, 3)]
    assert [find_unit(view, text)["status"] for text in CELL_TEXTS] == ["unassigned"] * 6
    assert _load_statuses(table["id"]) == ["retired"]
    assert _load_last_edit(fx.doc["id"]) == {
        "op": "split_table_rows",
        "regrouped": {
            str(cell["id"]): [table["id"], row_ids[index]]
            for cell, index in zip(cells, (0, 0, 1, 1, 3, 3), strict=True)
        },
        "layout_changes": {},
    }
    assert _find_coverage_problems(view) == []


def test_split_table_rows_rejects(client: TestClient) -> None:
    """표 단위만 나눈다 — 행 단위·문장은 422, 칸 문장이 없는 표는 422, 행을 넘어 합친 칸은 먼저 나눠야 한다."""
    fx = _setup(client, p("합성 문장.") + tbl([["", ""]]) + tbl(ROWS[:2]))
    empty_table, table = _units_of_kind(fx.view, "table")
    sentence = find_unit(fx.view, "합성 문장.")

    assert _code(_edit(client, fx.bundle_id, fx.doc["id"], _split_rows(sentence))) == (422, "invalid_unit_kind")
    assert _code(_edit(client, fx.bundle_id, fx.doc["id"], _split_rows(empty_table))) == (422, "empty_table")
    merge = {"type": "merge", "unit_ids": [find_unit(fx.view, "합성 값 하나.")["id"], find_unit(fx.view, "합성 값 둘.")["id"]]}
    _ok(_edit(client, fx.bundle_id, fx.doc["id"], merge))
    merged = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), "합성 값 하나.\n합성 값 둘.")

    refused = _edit(client, fx.bundle_id, fx.doc["id"], _split_rows(table))

    assert refused.status_code == 422
    assert refused.json()["detail"] == {"code": "cell_spans_rows", "unit_ids": [merged["id"]]}
    # 합친 칸을 되돌려 행마다 나뉘면 행으로 나눌 수 있다
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    _ok(_edit(client, fx.bundle_id, fx.doc["id"], _split_rows(table)))
    (row, _) = _units_of_kind(get_view(client, fx.bundle_id, fx.doc["id"]), "table_row")
    assert _code(_edit(client, fx.bundle_id, fx.doc["id"], _split_rows(row))) == (422, "invalid_unit_kind")


def test_rows_get_own_destinations(client: TestClient) -> None:
    """행마다 다른 곳으로 보낸다 — 칸 문장 상태는 자기 행의 판단을, 행의 표 새 문장은 그 행 하나짜리 격자다."""
    fx = _setup(client, tbl(ROWS))
    (table,) = _units_of_kind(fx.view, "table")
    _ok(_edit(client, fx.bundle_id, fx.doc["id"], _split_rows(table)))
    rows = _units_of_kind(get_view(client, fx.bundle_id, fx.doc["id"]), "table_row")

    assign_as_is(client, fx.bundle_id, rows[0], fx.sop_id, slot_key="procedures.procedure")
    assign_as_is(client, fx.bundle_id, rows[1], fx.wi_id, wi_part="instruction")
    assign_as_is(
        client, fx.bundle_id, rows[2], fx.wi_id, wi_part="instruction", hold_reason="Synthetic: check the step"
    )

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [find_unit(view, text)["status"] for text in CELL_TEXTS] == [
        "confirmed", "confirmed", "confirmed", "confirmed", "on_hold", "on_hold",
    ]
    for row, doc_id in zip(rows, (fx.sop_id, fx.wi_id, fx.wi_id), strict=True):
        group = get_group_by_unit(client, fx.bundle_id, row["id"])
        assert {target["target_doc_id"] for target in group["targets"]} == {doc_id}
        table_target, *cell_targets = sorted(group["targets"], key=lambda target: target["kind"] != "table")
        assert table_target["grid"] == {"rows": 1, "cols": 2}
        assert [(target["cell_row"], target["cell_col"]) for target in cell_targets] == [(0, 0), (0, 1)]


# ── 다시 합치기·되돌리기 ──────────────────────────────────────────────────────


def test_merge_rows_back_and_undo(client: TestClient) -> None:
    """다시 합치면 새 표 단위, 되돌리면 행 단위가 원래 ID로 돌아오고 칸도 원래 행에 묶인다."""
    fx = _setup(client, tbl(ROWS))
    (table,) = _units_of_kind(fx.view, "table")
    _ok(_edit(client, fx.bundle_id, fx.doc["id"], _split_rows(table)))
    row_ids = [row["id"] for row in _units_of_kind(get_view(client, fx.bundle_id, fx.doc["id"]), "table_row")]

    merged = _ok(_edit(client, fx.bundle_id, fx.doc["id"], _merge_rows(table["table_id"])))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    (new_table,) = _units_of_kind(view, "table")
    assert merged == {
        "document_revision": 3, "created_unit_ids": [new_table["id"]], "retired_unit_ids": row_ids,
        "detach": EMPTY_DETACH,
    }
    assert new_table["id"] not in (table["id"], *row_ids)
    assert (new_table["table_id"], new_table["row_index"], new_table["pos_seq"]) == (
        table["table_id"], None, table["pos_seq"],
    )
    assert _groups_of(view, CELL_TEXTS) == [new_table["id"]] * 6
    assert _units_of_kind(view, "table_row") == []
    assert _code(_edit(client, fx.bundle_id, fx.doc["id"], _merge_rows(table["table_id"]))) == (422, "table_not_split")

    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [row["id"] for row in _units_of_kind(view, "table_row")] == row_ids
    assert _groups_of(view, CELL_TEXTS) == [row_ids[0], row_ids[0], row_ids[1], row_ids[1], row_ids[2], row_ids[2]]
    assert _load_statuses(new_table["id"]) == ["retired"]

    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [unit["id"] for unit in _units_of_kind(view, "table")] == [table["id"]]
    assert _groups_of(view, CELL_TEXTS) == [table["id"]] * 6
    assert _load_statuses(*row_ids) == ["retired"] * 3

    _ok(_step(client, fx.bundle_id, fx.doc["id"], "redo"))
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "redo"))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [unit["id"] for unit in _units_of_kind(view, "table")] == [new_table["id"]]
    assert _groups_of(view, CELL_TEXTS) == [new_table["id"]] * 6
    assert _find_coverage_problems(view) == []


def test_split_decided_table_needs_confirm_and_detaches(client: TestClient) -> None:
    """판단이 있는 표를 행으로 나누면 확인 플래그가 필요하고, 적용하면 표 판단은 이력으로 가고 표·칸 새 문장이 지워진다."""
    fx = _setup(client, tbl(ROWS[:2]))
    (table,) = _units_of_kind(fx.view, "table")
    group = assign_as_is(client, fx.bundle_id, table, fx.sop_id, slot_key="purpose")
    target_ids = sorted(target["id"] for target in group["targets"])
    cells = [find_unit(fx.view, text) for text in CELL_TEXTS[:4]]

    refused = _edit(client, fx.bundle_id, fx.doc["id"], _split_rows(table))

    assert refused.status_code == 409
    assert refused.json()["detail"] == {
        "code": "confirm_required", "unit_ids": sorted([table["id"], *(cell["id"] for cell in cells)]),
    }
    result = _ok(_edit(client, fx.bundle_id, fx.doc["id"], _split_rows(table), confirm=True))
    assert result["detach"] == {
        "reset_unit_ids": [table["id"]], "deleted_target_ids": target_ids, "held_unit_ids": [], "held_target_ids": [],
    }
    assert _load_history_causes(table["id"]) == ["retired"]
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [find_unit(view, text)["status"] for text in CELL_TEXTS[:4]] == ["unassigned"] * 4


# ── 레이아웃 표 ───────────────────────────────────────────────────────────────


def test_layout_toggle_makes_cells_independent(client: TestClient) -> None:
    """레이아웃 표가 되면 표 단위가 은퇴하고 칸 문장마다 자기 판단(미배정)을 가지며, 한/영 두 열은 행 순서대로 이웃 짝이 된다."""
    start_ko, start_en = "합성 문서를 시작한다.", "The synthetic document starts."
    fx = _setup(client, p(start_ko) + p(start_en) + tbl(ROWS[:2]))
    (table,) = _units_of_kind(fx.view, "table")
    start_ids = [find_unit(fx.view, text)["id"] for text in (start_ko, start_en)]
    cells = [find_unit(fx.view, text) for text in CELL_TEXTS[:4]]
    assert [pair["unit_ids"] for pair in fx.view["pairs"]] == [start_ids]

    result = _ok(_edit(client, fx.bundle_id, fx.doc["id"], _set_layout(table["table_id"], True)))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert result == {
        "document_revision": 2, "created_unit_ids": [], "retired_unit_ids": [table["id"]], "detach": EMPTY_DETACH,
    }
    assert [(table_out["id"], table_out["is_layout"]) for table_out in view["tables"]] == [(table["table_id"], True)]
    assert _units_of_kind(view, "table") == []
    assert [(find_unit(view, text)["group_unit_id"], find_unit(view, text)["status"]) for text in CELL_TEXTS[:4]] == [
        (None, "unassigned")
    ] * 4
    assert [(pair["unit_ids"], pair["status"], pair["source"]) for pair in view["pairs"]] == [
        (start_ids, "suggested", "code"),
        ([cells[0]["id"], cells[1]["id"]], "suggested", "code"),
        ([cells[2]["id"], cells[3]["id"]], "suggested", "code"),
    ]
    # 칸 문장이 이제 자기 판단으로 관계 묶음을 연다
    group = get_group_by_unit(client, fx.bundle_id, cells[0]["id"])
    assert [entry["unit_id"] for entry in group["units"]] == [cells[0]["id"]]
    assert _load_last_edit(fx.doc["id"]) == {
        "op": "set_layout_table",
        "regrouped": {str(cell["id"]): [table["id"], None] for cell in cells},
        "layout_changes": {str(table["table_id"]): [False, True]},
    }
    # 이미 레이아웃이면 바뀌는 게 없다
    same = _ok(_edit(client, fx.bundle_id, fx.doc["id"], _set_layout(table["table_id"], True)))
    assert (same["document_revision"], same["created_unit_ids"], same["retired_unit_ids"]) == (2, [], [])

    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [table_out["is_layout"] for table_out in view["tables"]] == [False]
    assert [unit["id"] for unit in _units_of_kind(view, "table")] == [table["id"]]
    assert _groups_of(view, CELL_TEXTS[:4]) == [table["id"]] * 4
    assert [pair["unit_ids"] for pair in view["pairs"]] == [start_ids]

    _ok(_step(client, fx.bundle_id, fx.doc["id"], "redo"))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert view["tables"][0]["is_layout"] is True
    assert _groups_of(view, CELL_TEXTS[:4]) == [None] * 4


def test_layout_table_pairs_stay_inside_the_table(client: TestClient) -> None:
    """R34 — 레이아웃 표의 이웃 짝은 행마다이고 표 앞뒤 문단을 끌어들이지 않는다. 칸 안의 표도 자기 표 안에서만 짝짓는다."""
    before, after = "합성 목적 문단.", "Synthetic closing line."
    fx = _setup(client, p(before) + tbl(ROWS[:2]) + p(after))
    (table,) = _units_of_kind(fx.view, "table")
    paragraphs = [find_unit(fx.view, text) for text in (before, after)]
    # 데이터 표 단위는 중립이라 표 경계로 세지 않는다 — 묶인 칸은 빠지고 앞뒤 문단이 이웃 짝이다
    assert [pair["unit_ids"] for pair in fx.view["pairs"]] == [[unit["id"] for unit in paragraphs]]

    _ok(_edit(client, fx.bundle_id, fx.doc["id"], _set_layout(table["table_id"], True)))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    cells = [find_unit(view, text)["id"] for text in CELL_TEXTS[:4]]
    assert [pair["unit_ids"] for pair in view["pairs"]] == [cells[:2], cells[2:]]
    assert [find_unit(view, text)["pair_id"] for text in (before, after)] == [None, None]

    inner = tbl([["합성 안쪽 값.", "Inner value."]])
    nested = _setup(client, (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>'
        f"<w:tr><w:tc>{p('합성 바깥 값.')}{inner}{p('')}</w:tc><w:tc>{p('Outer value.')}</w:tc></w:tr></w:tbl>"
    ))
    for table_out in nested.view["tables"]:
        _ok(_edit(client, nested.bundle_id, nested.doc["id"], _set_layout(table_out["id"], True)))

    view = get_view(client, nested.bundle_id, nested.doc["id"])
    inner_ids = [find_unit(view, text)["id"] for text in ("합성 안쪽 값.", "Inner value.")]
    # 바깥 칸 사이에 안쪽 표가 끼어 바깥 행은 짝이 되지 않는다 — 안쪽 표 행만 짝이다
    assert [pair["unit_ids"] for pair in view["pairs"]] == [inner_ids]


def test_layout_back_needs_confirm_when_cells_decided(client: TestClient) -> None:
    """레이아웃 표 칸에 미배정이 아닌 판단이 있으면 데이터 표로 되돌리기에 확인 플래그가 필요하고, 그 판단은 떼어 낸다."""
    fx = _setup(client, tbl(ROWS[:2]))
    (table,) = _units_of_kind(fx.view, "table")
    _ok(_edit(client, fx.bundle_id, fx.doc["id"], _set_layout(table["table_id"], True)))
    ko = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), CELL_TEXTS[0])
    (target,) = assign_as_is(client, fx.bundle_id, ko, fx.sop_id, slot_key="purpose")["targets"]

    refused = _edit(client, fx.bundle_id, fx.doc["id"], _set_layout(table["table_id"], False))

    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "confirm_required", "unit_ids": [ko["id"]]}
    assert get_view(client, fx.bundle_id, fx.doc["id"])["tables"][0]["is_layout"] is True
    result = _ok(_edit(client, fx.bundle_id, fx.doc["id"], _set_layout(table["table_id"], False), confirm=True))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    (new_table,) = _units_of_kind(view, "table")
    assert result == {
        "document_revision": 3, "created_unit_ids": [new_table["id"]], "retired_unit_ids": [],
        "detach": {
            "reset_unit_ids": [ko["id"]], "deleted_target_ids": [target["id"]], "held_unit_ids": [],
            "held_target_ids": [],
        },
    }
    assert (new_table["pos_seq"], new_table["status"]) == (table["pos_seq"], "unassigned")
    assert _groups_of(view, CELL_TEXTS[:4]) == [new_table["id"]] * 4
    assert [find_unit(view, text)["status"] for text in CELL_TEXTS[:4]] == ["unassigned"] * 4
    assert _load_history_causes(ko["id"]) == ["regrouped"]
    assert view["tables"][0]["is_layout"] is False


def test_layout_to_data_rejects_cells_across_tables(client: TestClient) -> None:
    """레이아웃 표 칸끼리는 다른 표 칸과도 합칠 수 있다 — 표 경계를 넘은 칸 문장이 있으면 그 표를 데이터 표로 묶지 않는다."""
    fx = _setup(client, tbl([["합성 첫 표."]]) + tbl([["합성 둘째 표."]]))
    first, second = _units_of_kind(fx.view, "table")
    for table in (first, second):
        _ok(_edit(client, fx.bundle_id, fx.doc["id"], _set_layout(table["table_id"], True)))
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    cells = [find_unit(view, text)["id"] for text in ("합성 첫 표.", "합성 둘째 표.")]
    _ok(_edit(client, fx.bundle_id, fx.doc["id"], {"type": "merge", "unit_ids": cells}))
    merged = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), "합성 첫 표.\n합성 둘째 표.")

    for table in (first, second):
        refused = _edit(client, fx.bundle_id, fx.doc["id"], _set_layout(table["table_id"], False))
        assert refused.status_code == 422
        assert refused.json()["detail"] == {"code": "cell_crosses_table", "unit_ids": [merged["id"]]}
    assert _code(_edit(client, fx.bundle_id, fx.doc["id"], _set_layout(999_999, False))) == (404, "table_not_found")


def test_nested_table_changes_alone(client: TestClient) -> None:
    """칸 안의 표는 따로 바뀐다 — 바깥 표를 행으로 나누거나 레이아웃으로 바꿔도 안쪽 표 단위와 그 칸 묶음은 그대로다."""
    inner = tbl([["합성 안쪽 값.", "Inner value."]])
    body = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>'
        f"<w:tr><w:tc>{p('합성 바깥 하나.')}{inner}{p('')}</w:tc><w:tc>{p('Outer one.')}</w:tc></w:tr>"
        f"<w:tr><w:tc>{p('합성 바깥 둘.')}</w:tc><w:tc>{p('Outer two.')}</w:tc></w:tr></w:tbl>"
    )
    fx = _setup(client, body)
    outer_table, inner_table = fx.view["tables"]
    outer, inner_unit = _units_of_kind(fx.view, "table")
    assert (outer["table_id"], inner_unit["table_id"]) == (outer_table["id"], inner_table["id"])
    outer_texts = ["합성 바깥 하나.", "Outer one.", "합성 바깥 둘.", "Outer two."]
    inner_texts = ["합성 안쪽 값.", "Inner value."]

    _ok(_edit(client, fx.bundle_id, fx.doc["id"], _split_rows(outer)))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    rows = _units_of_kind(view, "table_row")
    assert [(row["table_id"], row["row_index"]) for row in rows] == [(outer_table["id"], 0), (outer_table["id"], 1)]
    assert _groups_of(view, outer_texts) == [rows[0]["id"], rows[0]["id"], rows[1]["id"], rows[1]["id"]]
    assert [unit["id"] for unit in _units_of_kind(view, "table")] == [inner_unit["id"]]
    assert _groups_of(view, inner_texts) == [inner_unit["id"]] * 2

    _ok(_edit(client, fx.bundle_id, fx.doc["id"], _set_layout(outer_table["id"], True)))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert _units_of_kind(view, "table_row") == []
    assert _groups_of(view, outer_texts) == [None] * 4
    assert _groups_of(view, inner_texts) == [inner_unit["id"]] * 2
    assert [table_out["is_layout"] for table_out in view["tables"]] == [True, False]

    _ok(_edit(client, fx.bundle_id, fx.doc["id"], _set_layout(outer_table["id"], False)))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    new_outer = next(unit for unit in _units_of_kind(view, "table") if unit["table_id"] == outer_table["id"])
    assert new_outer["pos_seq"] == outer["pos_seq"]
    assert _groups_of(view, outer_texts) == [new_outer["id"]] * 4
    assert _groups_of(view, inner_texts) == [inner_unit["id"]] * 2


# ── 새 문서(입구 2) ───────────────────────────────────────────────────────────


def _setup_new_doc(client: TestClient, body: str) -> tuple[int, dict, dict]:
    """묶음과 입구 2 새 문서 하나 — (묶음 id, 문서, view)."""
    bundle = create_bundle(client, is_synthetic=True)
    new_doc = _upload_ready(client, bundle["id"], build_docx(body), NEW_NAME, side="new", doc_type="sop")
    return bundle["id"], new_doc, get_view(client, bundle["id"], new_doc["id"])


def test_split_rows_on_new_doc_rebuilds_row_targets(client: TestClient) -> None:
    """새 문서 표를 행으로 나누면 표 새 문장 대신 행마다 한 행짜리 표 새 문장과 그 행 기준 칸 새 문장이 생긴다."""
    bundle_id, new_doc, view = _setup_new_doc(client, tbl(ROWS[:2]))
    (table,) = _units_of_kind(view, "table")

    _ok(_edit(client, bundle_id, new_doc["id"], _split_rows(table)))

    rows = _units_of_kind(get_view(client, bundle_id, new_doc["id"]), "table_row")
    targets = _load_targets(new_doc["target_doc_id"])
    tables = [target for target in targets if target["kind"] == "table"]
    assert [(target["new_unit_id"], target["grid"]) for target in tables] == [
        (row["id"], {"rows": 1, "cols": 2}) for row in rows
    ]
    cells = [target for target in targets if target["kind"] == "sentence"]
    assert [(target["text"], target["parent_target_id"], target["cell_row"], target["cell_col"]) for target in cells] == [
        (CELL_TEXTS[0], tables[0]["id"], 0, 0), (CELL_TEXTS[1], tables[0]["id"], 0, 1),
        (CELL_TEXTS[2], tables[1]["id"], 0, 0), (CELL_TEXTS[3], tables[1]["id"], 0, 1),
    ]


def test_new_doc_regroup_resets_decided_cell_targets(client: TestClient) -> None:
    """R32 — 확정된 칸 새 문장이 다른 표로 다시 묶이면 확인 플래그가 필요하고, 적용하면 그 새 문장은 출처를 떼고 미배정으로,
    관계 묶음의 나머지(옛 단위)는 보류(관련 단위가 바뀜)로 간다."""
    bundle_id, new_doc, view = _setup_new_doc(client, tbl(ROWS[:2]) + p("합성 문장을 쓴다."))
    old_doc = _upload_ready(client, bundle_id, build_docx(p(CELL_TEXTS[0])), OLD_NAME)
    old_unit = find_unit(get_view(client, bundle_id, old_doc["id"]), CELL_TEXTS[0])
    (table,) = _units_of_kind(view, "table")
    _ok(_edit(client, bundle_id, new_doc["id"], _set_layout(table["table_id"], True)))
    cell = find_unit(get_view(client, bundle_id, new_doc["id"]), CELL_TEXTS[0])
    cell_target = next(target for target in _load_targets(new_doc["target_doc_id"]) if target["new_unit_id"] == cell["id"])
    assert cell_target["parent_target_id"] is None
    saved = save_group(client, bundle_id, {
        "action": "confirm",
        "units": [{"unit_id": old_unit["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [{
            "key": "m", "id": cell_target["id"], "revision": cell_target["revision"], "source_unit_ids": [old_unit["id"]],
        }],
    })
    assert saved.status_code == 200, saved.text

    refused = _edit(client, bundle_id, new_doc["id"], _set_layout(table["table_id"], False))

    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "confirm_required", "unit_ids": [cell["id"]]}
    result = _ok(_edit(client, bundle_id, new_doc["id"], _set_layout(table["table_id"], False), confirm=True))

    assert result["detach"]["held_unit_ids"] == [old_unit["id"]]
    targets = {target["id"]: target for target in _load_targets(new_doc["target_doc_id"])}
    (new_table,) = _units_of_kind(get_view(client, bundle_id, new_doc["id"]), "table")
    (table_target,) = [target for target in targets.values() if target["new_unit_id"] == new_table["id"]]
    after = targets[cell_target["id"]]
    assert (after["status"], after["change_type"], after["parent_target_id"], after["cell_row"], after["cell_col"]) == (
        "unassigned", None, table_target["id"], 0, 0,
    )
    assert after["revision"] > saved.json()["targets"][0]["revision"]
    assert _count_sources(cell_target["id"]) == 0
    (entry,) = get_group_by_unit(client, bundle_id, old_unit["id"])["units"]
    assert (entry["decision"]["status"], entry["decision"]["hold_reason"]) == ("on_hold", SYSTEM_HOLD_RELATED_CHANGED)


# ── 난수 표 편집 열 ───────────────────────────────────────────────────────────

RANDOM_BODY = (
    p("합성 문서를 시작한다.") + p("The synthetic document starts.")
    + tbl([["합성 값 하나. 합성 값 둘.", "Value one. Value two."], ["", "Value blank."], ["합성 셋", "Three"]])
    + p("합성 문서를 끝낸다.")
)
# 난수 편집이 받을 수 있는 거절 — 그 밖의 응답(특히 500)은 실패다
EXPECTED_REFUSALS = {
    (422, "cannot_merge"), (422, "cell_spans_rows"), (422, "table_not_split"),
    (422, "invalid_offset"), (409, "nothing_to_undo"), (409, "nothing_to_redo"),
}


def _pick_random_op(rng: random.Random, view: dict) -> dict:
    """표 편집·칸 문장 합치기·나누기·되돌리기·다시 하기 중 하나 — 일부는 일부러 거절될 수 있다."""
    (table,) = view["tables"]
    kind = rng.choice(("split_rows", "merge_rows", "layout", "layout", "merge", "split", "undo", "undo", "redo"))
    if kind in ("undo", "redo"):
        return {"type": kind}
    if kind == "split_rows":
        tables = _units_of_kind(view, "table")
        return _split_rows(tables[0]) if tables else _merge_rows(table["id"])
    if kind == "merge_rows":
        return _merge_rows(table["id"])
    if kind == "layout":
        return _set_layout(table["id"], not table["is_layout"])
    cells = _units_of_kind(view, "cell_sentence")
    if kind == "split":
        cell = rng.choice(cells)
        return {"type": "split", "unit_id": cell["id"], "at": rng.randrange(1, max(len(cell["text"]), 2))}
    return {"type": "merge", "unit_ids": [cell["id"] for cell in rng.sample(cells, 2)]}


def _check_table_invariants(view: dict) -> None:
    """데이터 표는 표 단위 하나 또는 행 단위들로만, 칸 문장은 같은 표(행이면 같은 행)의 활성 단위에 묶이고, 레이아웃 표는 묶지 않는다."""
    (table,) = view["tables"]
    units = {unit["id"]: unit for unit in view["units"]}
    groups = [unit for unit in view["units"] if unit["kind"] in ("table", "table_row")]
    cells = _units_of_kind(view, "cell_sentence")
    if table["is_layout"]:
        assert groups == []
        assert {cell["group_unit_id"] for cell in cells} <= {None}
        return
    kinds = {group["kind"] for group in groups}
    assert kinds in ({"table"}, {"table_row"}), kinds
    if kinds == {"table"}:
        assert len(groups) == 1
    for cell in cells:
        group = units[cell["group_unit_id"]]
        assert group["table_id"] == cell["table_id"] == table["id"]
        if group["kind"] == "table_row":
            assert group["row_index"] == cell["row_index"]


def test_random_table_edit_sequences_keep_groups(client: TestClient) -> None:
    fx = _setup(client, RANDOM_BODY)
    rng = random.Random(20261106)
    applied: list[str] = []

    for _ in range(60):
        view = get_view(client, fx.bundle_id, fx.doc["id"])
        op = _pick_random_op(rng, view)
        if op["type"] in ("undo", "redo"):
            response = _step(client, fx.bundle_id, fx.doc["id"], op["type"])
        else:
            response = _edit(client, fx.bundle_id, fx.doc["id"], op)
        if response.status_code == 200:
            applied.append(op["type"])
        else:
            assert _code(response) in EXPECTED_REFUSALS, (op, response.text)
        after = get_view(client, fx.bundle_id, fx.doc["id"])
        assert _find_coverage_problems(after) == [], op
        _check_table_invariants(after)

    # 시드가 고정이라 매번 같은 열이다 — 표 편집 세 종류와 되돌리기·다시 하기가 모두 실제로 적용됐는지 본다
    assert {"split_table_rows", "merge_table_rows", "set_layout_table", "undo", "redo"} <= set(applied), applied
