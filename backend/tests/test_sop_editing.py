"""쪼개기 편집 — 나누기·합치기·경계 옮기기·골라 만들기·언어 바꾸기·경계 확인과 서버 쪽 되돌리기·다시 하기, 판단 떼어 내기와 새 문서 새 문장 다시 맞추기."""

import random
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import COVER_KINDS, SYSTEM_HOLD_RELATED_CHANGED
from app.sop.coverage import find_coverage_problems
from app.sop.models import (
    Bundle,
    Extraction,
    SourceBlock,
    TargetSentence,
    Unit,
    UnitDecisionHistory,
    UnitEdit,
)
from app.sop.segment import build_unit_text
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import (
    AUTHOR,
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

OLD_NAME = "SYNTHETIC_OLD-1_Editing.docx"
NEW_NAME = "SYNTHETIC_SOP-E_Editing.docx"
HEADING = "1. 목적"
# 문장 끝 뒤에 빈 글자가 없어 규칙 쪼개기가 한 단위로 둔 두 문장
TWO_IN_ONE = "합성 장비를 켠다.합성 시료를 넣는다."
FIRST, SECOND = "합성 장비를 켠다.", "합성 시료를 넣는다."
RECORD, CHECK, OFF = "합성 기록을 남긴다.", "합성 결과를 확인한다.", "합성 장비를 끈다."
ENGLISH = "Synthetic records are kept."
OLD_BODY = (
    p(HEADING, "Heading1") + p(TWO_IN_ONE) + p(f"{RECORD} {CHECK} {OFF}") + p(ENGLISH)
    + tbl([["합성 값", "Synthetic value"]])
)
TOBE_DOCS = [{"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}]
EMPTY_DETACH = {"reset_unit_ids": [], "deleted_target_ids": [], "held_unit_ids": [], "held_target_ids": []}


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    doc: dict
    view: dict


def _upload_ready(client: TestClient, bundle_id: int, data: bytes, name: str, **kwargs: str) -> dict:
    response = upload(client, bundle_id, data, name, **kwargs)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()
    return response.json()


def _setup(client: TestClient, body: str = OLD_BODY) -> Fixture:
    """To-Be(입구 1 SOP 하나)와 옛 문서 하나를 올린 묶음."""
    bundle = create_bundle(client, is_synthetic=True)
    response = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert response.status_code == 200, response.text
    doc = _upload_ready(client, bundle["id"], build_docx(body), OLD_NAME)
    return Fixture(bundle["id"], response.json()["docs"][0]["id"], doc, get_view(client, bundle["id"], doc["id"]))


def _edit(
    client: TestClient,
    bundle_id: int,
    doc_id: int,
    op: dict,
    *,
    revision: int | None = None,
    confirm: bool = False,
    headers: dict[str, str] = AUTHOR,
) -> httpx2.Response:
    """편집 하나 — revision을 주지 않으면 지금 문서 revision을 읽어 싣는다. 거절 응답도 그대로 돌려준다."""
    if revision is None:
        revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    body = {"revision": revision, "confirm": confirm, "op": op}
    return client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=headers)


def _step(
    client: TestClient, bundle_id: int, doc_id: int, action: str, *, confirm: bool = False
) -> httpx2.Response:
    """되돌리기(undo)·다시 하기(redo) — 지금 문서 revision을 싣는다."""
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    return client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}",
        json={"revision": revision, "confirm": confirm}, headers=AUTHOR,
    )


def _ok(response: httpx2.Response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()


def _code(response: httpx2.Response) -> tuple[int, str]:
    return response.status_code, response.json()["detail"]["code"]


def _split(client: TestClient, fx: Fixture, unit: dict, at: int, **kwargs: bool) -> httpx2.Response:
    return _edit(client, fx.bundle_id, fx.doc["id"], {"type": "split", "unit_id": unit["id"], "at": at}, **kwargs)


def _merge(client: TestClient, fx: Fixture, *units: dict) -> httpx2.Response:
    return _edit(client, fx.bundle_id, fx.doc["id"], {"type": "merge", "unit_ids": [unit["id"] for unit in units]})


def _block_text(view: dict, unit: dict) -> str:
    return next(block["text"] for block in view["blocks"] if block["id"] == unit["block_id"])


def _find_coverage_problems(view: dict) -> list[str]:
    block_texts = {block["id"]: block["text"] for block in view["blocks"]}
    return find_coverage_problems(
        block_texts, [[tuple(span) for span in unit["spans"]] for unit in view["units"] if unit["kind"] in COVER_KINDS]
    )


def _load_statuses(*unit_ids: int) -> list[str]:
    async def _run(session: AsyncSession) -> list[str]:
        return [(await session.get_one(Unit, unit_id)).status for unit_id in unit_ids]

    return run_in_session(_run)


def _count_history(unit_id: int) -> int:
    async def _run(session: AsyncSession) -> int:
        return await session.scalar(
            select(func.count()).select_from(UnitDecisionHistory).where(UnitDecisionHistory.unit_id == unit_id)
        )

    return run_in_session(_run)


def _load_edit_rows(doc_id: int) -> list[tuple[int, str, str]]:
    async def _run(session: AsyncSession) -> list[tuple[int, str, str]]:
        rows = await session.execute(
            select(UnitEdit.seq, UnitEdit.op, UnitEdit.state)
            .where(UnitEdit.document_id == doc_id)
            .order_by(UnitEdit.seq)
        )
        return [tuple(row) for row in rows]

    return run_in_session(_run)


def _load_targets(target_doc_id: int) -> list[dict]:
    """새 문서의 새 문장(order_index·id 순) — 편집 뒤 다시 맞춘 모습."""

    async def _run(session: AsyncSession) -> list[dict]:
        rows = await session.scalars(
            select(TargetSentence)
            .where(TargetSentence.target_doc_id == target_doc_id)
            .order_by(TargetSentence.order_index, TargetSentence.id)
        )
        return [
            {"id": row.id, "text": row.confirmed_text, "new_unit_id": row.new_unit_id, "status": row.status,
             "lang": row.lang, "revision": row.revision}
            for row in rows
        ]

    return run_in_session(_run)


def _save_merged_target(client: TestClient, fx: Fixture, *units: dict) -> dict:
    """여러 옛 단위를 SOP 새 문장 하나로 합쳐 확정하고 그 새 문장을 돌려준다."""
    body = {
        "action": "confirm",
        "units": [{"unit_id": unit["id"], "revision": 1, "disposition": "assigned"} for unit in units],
        "targets": [{
            "key": "merged", "target_doc_id": fx.sop_id, "slot_key": "purpose",
            "source_unit_ids": [unit["id"] for unit in units], "text": "합성 장비를 켜고 기록한다.",
            "change_type": "rewritten",
        }],
    }
    response = save_group(client, fx.bundle_id, body)
    assert response.status_code == 200, response.text
    return response.json()["targets"][0]


def _next_display_ids(view: dict, count: int) -> list[str]:
    """편집이 만들 새 단위의 표시 ID — local_no는 추출 안 최댓값 다음 번호부터."""
    prefix = view["units"][0]["display_id"].rsplit("-", 1)[0]
    last = max(int(unit["display_id"].rsplit("-", 1)[1]) for unit in view["units"])
    return [f"{prefix}-{last + offset:03d}" for offset in range(1, count + 1)]


# ── 나누기 ────────────────────────────────────────────────────────────────────


def test_split_retires_and_creates(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, TWO_IN_ONE)

    result = _ok(_split(client, fx, unit, len(FIRST)))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    first, second = find_unit(view, FIRST), find_unit(view, SECOND)
    assert result == {
        "document_revision": 2, "created_unit_ids": [first["id"], second["id"]], "retired_unit_ids": [unit["id"]],
        "detach": EMPTY_DETACH,
    }
    assert unit["id"] not in {member["id"] for member in view["units"]}
    assert _load_statuses(unit["id"], first["id"], second["id"]) == ["retired", "active", "active"]
    assert [first["display_id"], second["display_id"]] == _next_display_ids(fx.view, 2)
    assert (first["kind"], first["lang"], first["status"], first["boundary_confirmed"]) == (
        "sentence", "ko", "unassigned", False,
    )
    assert second["spans"] == [[unit["block_id"], len(FIRST), len(TWO_IN_ONE)]]
    assert view["document"]["revision"] == 2
    assert view["edits"] == {"can_undo": True, "can_redo": False}
    assert _find_coverage_problems(view) == []
    stale = _split(client, fx, first, 2, revision=1)
    assert _code(stale) == (409, "revision_conflict")


def test_piece_without_letters_takes_previous_language(client: TestClient) -> None:
    """글자로 언어를 알 수 없는 조각(숫자·기호뿐)은 처음 쪼개기처럼 앞 단위의 언어를 따른다."""
    fx = _setup(client, p(ENGLISH) + p("4 ℃ 합성 온도"))
    unit = find_unit(fx.view, "4 ℃ 합성 온도")

    _ok(_split(client, fx, unit, len("4 ℃ ")))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [find_unit(view, text)["lang"] for text in ("4 ℃", "합성 온도")] == ["en", "ko"]


@pytest.mark.parametrize(
    ("case", "code"),
    [("start", "invalid_offset"), ("end", "invalid_offset"), ("separator", "invalid_offset"),
     ("table", "invalid_unit_kind")],
)
def test_split_rejects_bad_offsets(client: TestClient, case: str, code: str) -> None:
    """0·끝·범위 사이 이음 글자 위는 invalid_offset, 표는 나눌 수 없다.

    빈 조각(empty_part)은 나누기로는 생기지 않는다 — 단위 범위의 앞뒤 글자가 빈 글자가 아니라서 어느 쪽이든 첫·끝 글자를 갖는다.
    경계 옮기기·골라 만들기가 그 거절을 본다.
    """
    fx = _setup(client)
    unit, at = find_unit(fx.view, TWO_IN_ONE), 0
    if case == "end":
        at = len(TWO_IN_ONE)
    elif case == "separator":
        _ok(_merge(client, fx, find_unit(fx.view, RECORD), find_unit(fx.view, OFF)))
        unit, at = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), f"{RECORD} {OFF}"), len(RECORD)
    elif case == "table":
        unit, at = next(member for member in fx.view["units"] if member["kind"] == "table"), 1
    before = get_view(client, fx.bundle_id, fx.doc["id"])

    response = _split(client, fx, unit, at)

    assert _code(response) == (422, code)
    after = get_view(client, fx.bundle_id, fx.doc["id"])
    assert (after["document"]["revision"], after["units"]) == (before["document"]["revision"], before["units"])


# ── 합치기 ────────────────────────────────────────────────────────────────────


def test_merge_far_apart_sentences(client: TestClient) -> None:
    fx = _setup(client)
    record, check, off = (find_unit(fx.view, text) for text in (RECORD, CHECK, OFF))
    heading, two = find_unit(fx.view, HEADING), find_unit(fx.view, TWO_IN_ONE)

    far = _ok(_merge(client, fx, off, record))
    across = _ok(_merge(client, fx, two, heading))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    merged = find_unit(view, f"{RECORD} {OFF}")
    assert far["created_unit_ids"] == [merged["id"]] and far["retired_unit_ids"] == [record["id"], off["id"]]
    assert merged["spans"] == [record["spans"][0], off["spans"][0]]  # 같은 블록의 떨어진 두 범위는 그대로 둘
    assert (merged["kind"], merged["lang"]) == ("sentence", "ko")
    joined = find_unit(view, f"{HEADING}\n{TWO_IN_ONE}")  # 다른 블록끼리는 줄바꿈으로 잇는다
    assert across["created_unit_ids"] == [joined["id"]]
    assert joined["spans"] == [heading["spans"][0], two["spans"][0]]
    assert joined["kind"] == "sentence"  # 하나라도 문장이면 문장
    assert _find_coverage_problems(view) == []

    # 가운데 문장까지 합치면 사이가 빈 글자뿐이라 한 범위로 잇는다
    _ok(_merge(client, fx, merged, find_unit(view, CHECK)))

    whole = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), f"{RECORD} {CHECK} {OFF}")
    assert whole["spans"] == [[record["block_id"], 0, len(f"{RECORD} {CHECK} {OFF}")]]


def test_merge_rejects_mixed_language(client: TestClient) -> None:
    fx = _setup(client)
    cell = find_unit(fx.view, "합성 값")

    mixed = _merge(client, fx, find_unit(fx.view, OFF), find_unit(fx.view, ENGLISH))
    with_cell = _merge(client, fx, find_unit(fx.view, OFF), cell)
    with_table = _merge(client, fx, cell, next(unit for unit in fx.view["units"] if unit["kind"] == "table"))
    alone = _merge(client, fx, find_unit(fx.view, OFF))

    assert _code(mixed) == (422, "mixed_language")
    assert mixed.json()["detail"]["langs"] == ["en", "ko"]
    assert _code(with_cell) == (422, "cannot_merge")
    assert _code(with_table) == (422, "invalid_unit_kind")
    assert alone.status_code == 422  # 2개 이상 — 입력 형식 오류
    assert get_view(client, fx.bundle_id, fx.doc["id"])["document"]["revision"] == 1


# ── 경계 옮기기·골라 만들기 ───────────────────────────────────────────────────


def test_move_boundary_and_carve(client: TestClient) -> None:
    fx = _setup(client)
    record, check, off = (find_unit(fx.view, text) for text in (RECORD, CHECK, OFF))
    move = {"type": "move_boundary", "left_unit_id": record["id"], "right_unit_id": check["id"]}
    at = check["spans"][0][1] + len("합성 ")

    moved = _ok(_edit(client, fx.bundle_id, fx.doc["id"], {**move, "at": at}))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    left, right = find_unit(view, f"{RECORD} 합성"), find_unit(view, "결과를 확인한다.")
    assert moved["created_unit_ids"] == [left["id"], right["id"]]
    assert moved["retired_unit_ids"] == [record["id"], check["id"]]
    assert _find_coverage_problems(view) == []
    empty = _edit(client, fx.bundle_id, fx.doc["id"], {
        "type": "move_boundary", "left_unit_id": left["id"], "right_unit_id": right["id"], "at": left["spans"][0][1],
    })
    apart = _edit(client, fx.bundle_id, fx.doc["id"], {
        "type": "move_boundary", "left_unit_id": left["id"], "right_unit_id": off["id"], "at": off["spans"][0][1],
    })
    outside = _edit(client, fx.bundle_id, fx.doc["id"], {
        "type": "move_boundary", "left_unit_id": left["id"], "right_unit_id": right["id"], "at": 10_000,
    })
    assert _code(empty) == (422, "empty_part")
    assert _code(apart) == (422, "not_adjacent")
    assert _code(outside) == (422, "invalid_offset")

    two = find_unit(view, TWO_IN_ONE)
    start, end = len("합성 "), len("합성 장비를 켠다.합성")
    carve = {"type": "carve", "block_id": two["block_id"]}

    carved = _ok(_edit(client, fx.bundle_id, fx.doc["id"], {**carve, "start": start, "end": end}))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    pieces = [unit for unit in view["units"] if unit["block_id"] == two["block_id"]]
    assert [unit["text"] for unit in pieces] == ["합성", "장비를 켠다.합성", "시료를 넣는다."]
    assert carved["retired_unit_ids"] == [two["id"]]
    assert sorted(carved["created_unit_ids"]) == sorted(unit["id"] for unit in pieces)
    assert _find_coverage_problems(view) == []
    blank = _edit(client, fx.bundle_id, fx.doc["id"], {**carve, "start": 2, "end": 3})  # 띄어쓰기 한 칸
    reversed_range = _edit(client, fx.bundle_id, fx.doc["id"], {**carve, "start": 5, "end": 5})
    assert _code(blank) == (422, "empty_part")
    assert _code(reversed_range) == (422, "invalid_offset")


def test_noop_boundary_edits_change_nothing(client: TestClient) -> None:
    """경계를 제자리에 놓거나 단위 하나의 범위를 그대로 골라 만들면 범위가 같은 단위라 아무것도 쓰지 않는다.

    확인도 묻지 않고(확정 판단이 그대로 남는다) 표시 ID·revision·되돌리기 기록(다시 하기 포함)도 그대로다.
    """
    fx = _setup(client)
    record, check = find_unit(fx.view, RECORD), find_unit(fx.view, CHECK)
    assign_as_is(client, fx.bundle_id, record, fx.sop_id, slot_key="purpose")
    _ok(_split(client, fx, find_unit(fx.view, TWO_IN_ONE), len(FIRST)))
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    before = get_view(client, fx.bundle_id, fx.doc["id"])
    block_id, start, end = record["spans"][0]
    move = {"type": "move_boundary", "left_unit_id": record["id"], "right_unit_id": check["id"]}
    carve = {"type": "carve", "block_id": block_id, "start": start}
    # 처음 경계(왼쪽 끝), 사이 빈 글자 뒤(오른쪽 시작), 단위 범위 그대로, 뒤 빈 글자까지 고른 범위
    ops = [{**move, "at": end}, {**move, "at": check["spans"][0][1]}, {**carve, "end": end}, {**carve, "end": end + 1}]

    results = [_ok(_edit(client, fx.bundle_id, fx.doc["id"], op)) for op in ops]

    assert results == [
        {"document_revision": before["document"]["revision"], "created_unit_ids": [], "retired_unit_ids": [],
         "detach": None}
    ] * len(ops)
    assert get_view(client, fx.bundle_id, fx.doc["id"]) == before
    assert before["edits"] == {"can_undo": False, "can_redo": True}
    assert _load_edit_rows(fx.doc["id"]) == [(1, "split", "undone")]
    assert find_unit(before, RECORD)["status"] == "confirmed"


def test_cell_pieces_take_row_from_their_block(client: TestClient) -> None:
    """칸 문장 조각의 표·행 번호는 첫 범위 칸 블록의 것이다(R33) — 행을 넘어 합친 칸을 다시 나누면 조각마다 자기 행."""
    fx = _setup(client, p(HEADING) + tbl([["합성 값 하나.", "Value one."], ["합성 값 둘.", "Value two."]]))
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    # 레이아웃 표 칸끼리는 행을 넘어 합칠 수 있다
    to_layout = {"type": "set_layout_table", "table_id": table["table_id"], "is_layout": True}
    _ok(_edit(client, fx.bundle_id, fx.doc["id"], to_layout))
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    _ok(_merge(client, fx, find_unit(view, "합성 값 하나."), find_unit(view, "합성 값 둘.")))
    merged = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), "합성 값 하나.\n합성 값 둘.")
    assert (merged["kind"], merged["row_index"]) == ("cell_sentence", 0)

    _ok(_split(client, fx, merged, len("합성 값 하나.\n")))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    blocks = {block["id"]: block for block in view["blocks"]}
    pieces = [find_unit(view, text) for text in ("합성 값 하나.", "합성 값 둘.")]
    assert [(unit["table_id"], unit["row_index"], unit["group_unit_id"]) for unit in pieces] == [
        (table["table_id"], 0, None), (table["table_id"], 1, None),
    ]
    assert all(unit["row_index"] == blocks[unit["block_id"]]["row_index"] for unit in pieces)


# ── 되돌리기·다시 하기 ────────────────────────────────────────────────────────


def test_undo_revives_original_ids_and_redo_reapplies(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, TWO_IN_ONE)
    created = _ok(_split(client, fx, unit, len(FIRST)))["created_unit_ids"]

    undone = _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    revived = find_unit(view, TWO_IN_ONE)
    assert undone == {
        "document_revision": 3, "created_unit_ids": [unit["id"]], "retired_unit_ids": created, "detach": EMPTY_DETACH,
    }
    assert (revived["id"], revived["display_id"], revived["spans"], revived["status"]) == (
        unit["id"], unit["display_id"], unit["spans"], "unassigned",
    )
    assert _load_statuses(*created) == ["retired", "retired"]
    assert view["edits"] == {"can_undo": False, "can_redo": True}
    assert _find_coverage_problems(view) == []

    redone = _ok(_step(client, fx.bundle_id, fx.doc["id"], "redo"))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert (redone["document_revision"], redone["created_unit_ids"], redone["retired_unit_ids"]) == (
        4, created, [unit["id"]],
    )
    assert [find_unit(view, FIRST)["id"], find_unit(view, SECOND)["id"]] == created
    assert _load_statuses(unit["id"]) == ["retired"]
    assert view["edits"] == {"can_undo": True, "can_redo": False}
    assert _load_edit_rows(fx.doc["id"]) == [(1, "split", "applied")]
    assert _find_coverage_problems(view) == []


def test_new_edit_clears_redo(client: TestClient) -> None:
    fx = _setup(client)
    _ok(_split(client, fx, find_unit(fx.view, TWO_IN_ONE), len(FIRST)))
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    assert get_view(client, fx.bundle_id, fx.doc["id"])["edits"]["can_redo"] is True

    _ok(_merge(client, fx, find_unit(fx.view, RECORD), find_unit(fx.view, CHECK)))

    assert get_view(client, fx.bundle_id, fx.doc["id"])["edits"] == {"can_undo": True, "can_redo": False}
    assert _load_edit_rows(fx.doc["id"]) == [(1, "merge", "applied")]
    assert _code(_step(client, fx.bundle_id, fx.doc["id"], "redo")) == (409, "nothing_to_redo")
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    assert _code(_step(client, fx.bundle_id, fx.doc["id"], "undo")) == (409, "nothing_to_undo")


# ── 판단이 있는 단위 ──────────────────────────────────────────────────────────


def test_edit_on_decided_unit_needs_confirm_and_detaches(client: TestClient) -> None:
    fx = _setup(client)
    two, record = find_unit(fx.view, TWO_IN_ONE), find_unit(fx.view, RECORD)
    target = _save_merged_target(client, fx, two, record)

    refused = _split(client, fx, two, len(FIRST))

    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "confirm_required", "unit_ids": [two["id"]]}
    assert get_view(client, fx.bundle_id, fx.doc["id"])["document"]["revision"] == 1

    result = _ok(_split(client, fx, two, len(FIRST), confirm=True))

    assert result["detach"] == {
        "reset_unit_ids": [two["id"]], "deleted_target_ids": [],
        "held_unit_ids": [record["id"]], "held_target_ids": [target["id"]],
    }
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [find_unit(view, text)["status"] for text in (FIRST, SECOND)] == ["unassigned", "unassigned"]
    assert _count_history(two["id"]) == 1
    assert find_unit(view, RECORD)["status"] == "on_hold"
    group = client.get(f"/api/bundles/{fx.bundle_id}/groups/by-unit/{record['id']}", headers=AUTHOR).json()
    (kept,) = group["targets"]
    assert (kept["id"], kept["source_unit_ids"], kept["status"], kept["hold_reason"]) == (
        target["id"], [record["id"]], "on_hold", SYSTEM_HOLD_RELATED_CHANGED,
    )


def test_undo_that_retires_decided_units_needs_confirm(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, TWO_IN_ONE)
    _ok(_split(client, fx, unit, len(FIRST)))
    first = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), FIRST)
    assign_as_is(client, fx.bundle_id, first, fx.sop_id, slot_key="purpose")

    refused = _step(client, fx.bundle_id, fx.doc["id"], "undo")

    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "confirm_required", "unit_ids": [first["id"]]}

    result = _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo", confirm=True))

    assert result["detach"]["reset_unit_ids"] == [first["id"]]
    assert len(result["detach"]["deleted_target_ids"]) == 1  # 그 단위만 출처였던 새 문장
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    revived = find_unit(view, TWO_IN_ONE)
    assert (revived["id"], revived["status"]) == (unit["id"], "unassigned")
    assert _load_statuses(first["id"]) == ["retired"]
    assert _count_history(first["id"]) == 1
    # 다시 하기는 되살린 원래 단위를 은퇴시키는데, 그 단위는 미배정이라 확인 없이 된다
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "redo"))


def test_retired_units_leave_pairs(client: TestClient) -> None:
    """은퇴한 단위는 한/영 짝에서 빠지고, 한쪽 언어가 비면 짝이 지워진다."""
    fx = _setup(client, p(f"{TWO_IN_ONE} {RECORD}") + p(ENGLISH))
    two, record, english = (find_unit(fx.view, text) for text in (TWO_IN_ONE, RECORD, ENGLISH))
    (pair,) = fx.view["pairs"]
    assert pair["unit_ids"] == [two["id"], record["id"], english["id"]]

    _ok(_split(client, fx, two, len(FIRST)))

    (kept,) = get_view(client, fx.bundle_id, fx.doc["id"])["pairs"]
    assert (kept["id"], kept["unit_ids"]) == (pair["id"], [record["id"], english["id"]])

    _ok(_split(client, fx, english, len("Synthetic ")))

    assert get_view(client, fx.bundle_id, fx.doc["id"])["pairs"] == []
    # 언어가 바뀐 단위도 자기 쪽이 달라져 짝에서 빠진다
    other = _upload_ready(client, fx.bundle_id, build_docx(p(RECORD) + p(ENGLISH)), "SYNTHETIC_OLD-2_Pair.docx")
    other_view = get_view(client, fx.bundle_id, other["id"])
    assert len(other_view["pairs"]) == 1
    _ok(_set_language(client, fx.bundle_id, other["id"], [find_unit(other_view, RECORD)], "en"))
    assert get_view(client, fx.bundle_id, other["id"])["pairs"] == []


# ── 새 문서(입구 2) ───────────────────────────────────────────────────────────


def test_edit_on_new_doc_rebuilds_its_targets(client: TestClient) -> None:
    bundle = create_bundle(client, is_synthetic=True)
    new_doc = _upload_ready(
        client, bundle["id"], build_docx(p(TWO_IN_ONE) + p(RECORD)), NEW_NAME, side="new", doc_type="sop"
    )
    fx = Fixture(bundle["id"], 0, new_doc, get_view(client, bundle["id"], new_doc["id"]))
    unit, record = find_unit(fx.view, TWO_IN_ONE), find_unit(fx.view, RECORD)
    (old_target, record_target) = _load_targets(new_doc["target_doc_id"])

    result = _ok(_split(client, fx, unit, len(FIRST)))

    first, second = result["created_unit_ids"]
    assert result["detach"]["deleted_target_ids"] == [old_target["id"]]
    targets = _load_targets(new_doc["target_doc_id"])
    assert [(t["text"], t["new_unit_id"], t["status"]) for t in targets] == [
        (FIRST, first, "unassigned"), (SECOND, second, "unassigned"), (RECORD, record["id"], "unassigned"),
    ]
    assert targets[2]["id"] == record_target["id"]

    _ok(_step(client, fx.bundle_id, new_doc["id"], "undo"))

    targets = _load_targets(new_doc["target_doc_id"])
    assert [(t["text"], t["new_unit_id"]) for t in targets] == [(TWO_IN_ONE, unit["id"]), (RECORD, record["id"])]


# ── 언어 바꾸기 ───────────────────────────────────────────────────────────────


def _set_language(client: TestClient, bundle_id: int, doc_id: int, units: list[dict], lang: str) -> httpx2.Response:
    op = {"type": "set_language", "unit_ids": [unit["id"] for unit in units], "lang": lang}
    return _edit(client, bundle_id, doc_id, op)


def test_set_language_refused_when_decided(client: TestClient) -> None:
    fx = _setup(client)
    off, check = find_unit(fx.view, OFF), find_unit(fx.view, CHECK)
    assign_as_is(client, fx.bundle_id, off, fx.sop_id, slot_key="purpose")

    refused = _set_language(client, fx.bundle_id, fx.doc["id"], [check, off], "en")

    assert refused.status_code == 409
    assert refused.json()["detail"] == {"code": "unit_has_decision", "unit_ids": [off["id"]]}

    changed = _ok(_set_language(client, fx.bundle_id, fx.doc["id"], [check], "en"))

    assert changed == {"document_revision": 2, "created_unit_ids": [], "retired_unit_ids": [], "detach": None}
    assert find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), CHECK)["lang"] == "en"
    same = _ok(_set_language(client, fx.bundle_id, fx.doc["id"], [check], "en"))
    assert same["document_revision"] == 2  # 바뀐 게 없으면 기록도 revision도 그대로
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert (find_unit(view, CHECK)["lang"], view["document"]["revision"]) == ("ko", 3)
    assert view["edits"] == {"can_undo": False, "can_redo": True}
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    assert _code(_set_language(client, fx.bundle_id, fx.doc["id"], [table], "ko")) == (422, "invalid_unit_kind")

    # 새 문서 단위는 입구 2 새 문장이 미배정이 아니면 거절한다(R31)
    new_doc = _upload_ready(client, fx.bundle_id, build_docx(p(RECORD)), NEW_NAME, side="new", doc_type="sop")
    new_unit = find_unit(get_view(client, fx.bundle_id, new_doc["id"]), RECORD)
    (new_target,) = _load_targets(new_doc["target_doc_id"])
    confirmed = client.post(
        f"/api/bundles/{fx.bundle_id}/match/bulk-confirm",
        json={"new": [{"target_id": new_target["id"], "revision": new_target["revision"]}]}, headers=AUTHOR,
    )
    assert confirmed.status_code == 200, confirmed.text
    new_refused = _set_language(client, fx.bundle_id, new_doc["id"], [new_unit], "en")
    assert new_refused.json()["detail"] == {"code": "unit_has_decision", "unit_ids": [new_unit["id"]]}


# ── 경계 확인 표시 ────────────────────────────────────────────────────────────


def test_boundary_confirm_flag(client: TestClient) -> None:
    fx = _setup(client)
    two, record = find_unit(fx.view, TWO_IN_ONE), find_unit(fx.view, RECORD)
    url = f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}/units/boundary"

    marked = client.post(url, json={"unit_ids": [two["id"], record["id"]], "confirmed": True}, headers=AUTHOR)
    cleared = client.post(url, json={"unit_ids": [two["id"]], "confirmed": False}, headers=AUTHOR)

    assert marked.status_code == cleared.status_code == 200, (marked.text, cleared.text)
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [find_unit(view, text)["boundary_confirmed"] for text in (TWO_IN_ONE, RECORD)] == [False, True]
    # 되돌리기 대상이 아니고 문서 revision도 올리지 않는다
    assert (view["document"]["revision"], view["edits"]) == (1, {"can_undo": False, "can_redo": False})
    _ok(_split(client, fx, two, len(FIRST)))
    retired = client.post(url, json={"unit_ids": [two["id"]], "confirmed": True}, headers=AUTHOR)
    assert retired.status_code == 404
    assert retired.json()["detail"] == {"code": "unit_not_found", "unit_ids": [two["id"]]}
    # 새 단위는 확인되지 않은 채로 시작한다
    assert find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), FIRST)["boundary_confirmed"] is False


def test_edits_are_for_authors_while_in_progress(client: TestClient) -> None:
    fx = _setup(client)
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    unit = find_unit(fx.view, TWO_IN_ONE)
    base = f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}"
    edit = {"revision": 1, "op": {"type": "split", "unit_id": unit["id"], "at": len(FIRST)}}
    boundary = {"unit_ids": [unit["id"]], "confirmed": True}

    def _send_all(headers: dict[str, str]) -> set[tuple[int, str]]:
        responses = [
            client.post(f"{base}/edits", json=edit, headers=headers),
            client.post(f"{base}/edits/undo", json={"revision": 1}, headers=headers),
            client.post(f"{base}/edits/redo", json={"revision": 1}, headers=headers),
            client.post(f"{base}/units/boundary", json=boundary, headers=headers),
        ]
        return {_code(response) for response in responses}

    assert _send_all(REVIEWER) == {(403, "role_required")}
    update_row(Bundle, fx.bundle_id, status="in_review")
    assert _send_all(AUTHOR) == {(409, "bundle_not_editable")}
    assert get_view(client, fx.bundle_id, fx.doc["id"])["units"] == fx.view["units"]


# ── 난수 편집 열 ──────────────────────────────────────────────────────────────

RANDOM_BODY = (
    p("1. 목적", "Heading1")
    + p("합성 장비를 켠다. 합성 시료를 넣는다.합성 기록을 남긴다.")
    + p("Turn on the synthetic unit. Load the synthetic sample. Keep the records.")
    + p("2. 절차", "Heading1")
    + p("합성 결과를 확인한다.  합성 장비를 끈다.​ 합성 보고서를 쓴다.")
    + tbl([["합성 값 하나. 합성 값 둘.", "Synthetic value one. Value two."], ["합성 셋", "Three"]])
    + p("Wipe the synthetic bench. Close the synthetic log.")
)
TEXT_KINDS = ("sentence", "heading", "cell_sentence")
# 난수 편집이 받을 수 있는 거절 — 그 밖의 응답(특히 500)은 실패다
EXPECTED_REFUSALS = {
    (422, "invalid_offset"), (422, "empty_part"), (422, "not_adjacent"), (422, "cannot_merge"),
    (422, "mixed_language"), (409, "nothing_to_undo"), (409, "nothing_to_redo"),
}


def _pick_random_op(rng: random.Random, view: dict) -> dict:
    """지금 view에서 그럴듯한 편집 하나 — 일부는 일부러 거절될 수 있다."""
    units = [unit for unit in view["units"] if unit["kind"] in TEXT_KINDS]
    # 되돌린 직후에는 다시 하기를 자주 골라 되돌리기·다시 하기가 섞인 열을 만든다
    if view["edits"]["can_redo"] and rng.random() < 0.5:
        return {"type": "redo"}
    kind = rng.choice(("split", "split", "merge", "move_boundary", "carve", "carve", "undo", "redo"))
    if kind in ("undo", "redo"):
        return {"type": kind}
    if kind == "split":
        unit = rng.choice(units)
        return {"type": "split", "unit_id": unit["id"], "at": rng.randrange(1, max(len(unit["text"]), 2))}
    if kind == "merge":
        first = rng.choice(units)
        same_lang = [unit for unit in units if unit["id"] != first["id"] and unit["lang"] == first["lang"]]
        second = rng.choice(same_lang or units)
        return {"type": "merge", "unit_ids": [first["id"], second["id"]]}
    if kind == "move_boundary":
        neighbors = [
            (left, right) for left in units for right in units
            if left["id"] != right["id"] and left["spans"][-1][0] == right["spans"][0][0]
            and left["spans"][-1][2] <= right["spans"][0][1]
        ]
        if neighbors:
            left, right = rng.choice(neighbors)
            at = rng.randint(left["spans"][-1][1], right["spans"][0][2])
            return {"type": "move_boundary", "left_unit_id": left["id"], "right_unit_id": right["id"], "at": at}
    block = rng.choice([block for block in view["blocks"] if block["kind"] != "figure" and block["text"].strip()])
    start = rng.randrange(0, len(block["text"]))
    return {"type": "carve", "block_id": block["id"], "start": start, "end": rng.randint(start + 1, len(block["text"]))}


def _check_unit_invariants(doc_id: int) -> None:
    """활성 단위의 자리(pos_seq·pos_start)가 첫 범위 블록·시작이고, 글자는 범위를 이은 것이고, local_no는 겹치지 않는다."""

    async def _run(session: AsyncSession) -> None:
        extraction_id = await session.scalar(select(func.max(Extraction.id)).where(Extraction.document_id == doc_id))
        blocks = {
            block_id: (seq, text)
            for block_id, seq, text in await session.execute(
                select(SourceBlock.id, SourceBlock.seq, SourceBlock.text)
                .where(SourceBlock.extraction_id == extraction_id)
            )
        }
        units = list(await session.scalars(select(Unit).where(Unit.extraction_id == extraction_id)))
        assert len({unit.local_no for unit in units}) == len(units)
        texts = {block_id: text for block_id, (_, text) in blocks.items()}
        for unit in units:
            if unit.status != "active" or not unit.spans:
                continue
            first_block, first_start, _ = unit.spans[0]
            assert (unit.pos_seq, unit.pos_start) == (blocks[first_block][0], first_start), unit.id
            assert unit.text == build_unit_text(unit.spans, texts), unit.id

    run_in_session(_run)


def test_random_edit_sequences_keep_coverage(client: TestClient) -> None:
    fx = _setup(client, RANDOM_BODY)
    rng = random.Random(20261106)
    applied: list[str] = []

    for _ in range(50):
        view = get_view(client, fx.bundle_id, fx.doc["id"])
        op = _pick_random_op(rng, view)
        if op["type"] in ("undo", "redo"):
            response = _step(client, fx.bundle_id, fx.doc["id"], op["type"])
        else:
            response = _edit(client, fx.bundle_id, fx.doc["id"], op, revision=view["document"]["revision"])
        if response.status_code == 200:
            applied.append(op["type"])
        else:
            assert _code(response) in EXPECTED_REFUSALS, (op, response.text)
        after = get_view(client, fx.bundle_id, fx.doc["id"])
        assert _find_coverage_problems(after) == [], op
        _check_unit_invariants(fx.doc["id"])

    # 시드가 고정이라 매번 같은 열이다 — 모든 편집 종류가 한 번 이상 실제로 적용됐는지 본다
    assert set(applied) == {"split", "merge", "move_boundary", "carve", "undo", "redo"}, applied


def test_view_marks_units_made_by_an_edit(client: TestClient) -> None:
    fx = _setup(client)
    unit = find_unit(fx.view, TWO_IN_ONE)
    assert {member["is_edited"] for member in fx.view["units"]} == {False}

    _ok(_split(client, fx, unit, len(FIRST)))
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    edited = {member["id"] for member in view["units"] if member["is_edited"]}

    assert edited == {find_unit(view, FIRST)["id"], find_unit(view, SECOND)["id"]}

    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    undone = get_view(client, fx.bundle_id, fx.doc["id"])

    assert [member["is_edited"] for member in undone["units"] if member["id"] == unit["id"]] == [False]
    assert not any(member["is_edited"] for member in undone["units"])
