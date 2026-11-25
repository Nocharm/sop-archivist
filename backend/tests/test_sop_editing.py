"""쪼개기 편집 — 나누기·합치기·경계 옮기기·골라 만들기·언어 바꾸기와 서버 쪽 되돌리기·다시 하기(옛 경계 확인 기록 포함), 판단 떼어 내기와 새 문서 새 문장 다시 맞추기."""

import random
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.constants import COVER_KINDS, SYSTEM_HOLD_RELATED_CHANGED
from app.sop.coverage import find_coverage_problems
from app.sop.refs import REF_LANG
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
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.sop_helpers import (
    AUTHOR,
    REVIEWER,
    WRITTEN_CAPTION,
    assign_as_is,
    build_as_is_targets,
    create_bundle,
    find_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop", "legacy_split_rule")

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
    assert (first["kind"], first["lang"], first["status"]) == ("sentence", "ko", "unassigned")
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
    joined = find_unit(view, f"{HEADING} {TWO_IN_ONE}")  # 다른 블록끼리도 띄어쓰기로 잇는다(박스 하나는 한 줄)
    assert across["created_unit_ids"] == [joined["id"]]
    assert joined["spans"] == [heading["spans"][0], two["spans"][0]]
    assert joined["kind"] == "sentence"  # 하나라도 문장이면 문장
    assert _find_coverage_problems(view) == []

    # 가운데 문장까지 합치면 사이가 빈 글자뿐이라 한 범위로 잇는다
    _ok(_merge(client, fx, merged, find_unit(view, CHECK)))

    whole = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), f"{RECORD} {CHECK} {OFF}")
    assert whole["spans"] == [[record["block_id"], 0, len(f"{RECORD} {CHECK} {OFF}")]]


def test_merge_accepts_mixed_language(client: TestClient) -> None:
    fx = _setup(client)
    cell = find_unit(fx.view, "합성 값")
    ko, en = find_unit(fx.view, OFF), find_unit(fx.view, ENGLISH)

    result = _ok(_merge(client, fx, ko, en))

    merged = next(
        unit for unit in get_view(client, fx.bundle_id, fx.doc["id"])["units"] if unit["id"] == result["created_unit_ids"][0]
    )
    assert (merged["lang"], OFF in merged["text"], ENGLISH in merged["text"]) == ("ko", True, True)
    # 칸 문장·표 거절은 언어와 무관하게 그대로다
    with_cell = _merge(client, fx, find_unit(fx.view, CHECK), cell)
    with_table = _merge(client, fx, cell, next(unit for unit in fx.view["units"] if unit["kind"] == "table"))
    alone = _merge(client, fx, find_unit(fx.view, CHECK))
    assert _code(with_cell) == (422, "cannot_merge")
    assert _code(with_table) == (422, "invalid_unit_kind")
    assert alone.status_code == 422  # 2개 이상 — 입력 형식 오류
    assert get_view(client, fx.bundle_id, fx.doc["id"])["document"]["revision"] == 2


def test_merging_the_members_of_a_pair_removes_the_pair(client: TestClient) -> None:
    fx = _setup(client, p(RECORD) + p(ENGLISH))
    record, english = find_unit(fx.view, RECORD), find_unit(fx.view, ENGLISH)
    (pair,) = fx.view["pairs"]
    assert sorted(pair["unit_ids"]) == sorted([record["id"], english["id"]])

    _ok(_merge(client, fx, record, english))

    assert get_view(client, fx.bundle_id, fx.doc["id"])["pairs"] == []


def test_merging_all_members_of_a_many_to_one_pair_removes_the_pair(client: TestClient) -> None:
    fx = _setup(client, p(f"{TWO_IN_ONE} {RECORD}") + p(ENGLISH))
    two, record, english = (find_unit(fx.view, text) for text in (TWO_IN_ONE, RECORD, ENGLISH))
    created = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}/pairs",
        json={"revision": 1, "unit_ids": [two["id"], record["id"], english["id"]]}, headers=AUTHOR,
    )
    assert created.status_code == 201, created.text

    _ok(_merge(client, fx, two, record, english))

    assert get_view(client, fx.bundle_id, fx.doc["id"])["pairs"] == []


def test_unmerge_of_a_mixed_merge_restores_each_language(client: TestClient) -> None:
    fx = _setup(client)
    ko, en = find_unit(fx.view, OFF), find_unit(fx.view, ENGLISH)
    result = _ok(_merge(client, fx, ko, en))
    merged = next(
        unit for unit in get_view(client, fx.bundle_id, fx.doc["id"])["units"] if unit["id"] == result["created_unit_ids"][0]
    )

    _ok(_unmerge(client, fx, merged))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [find_unit(view, text)["lang"] for text in (OFF, ENGLISH)] == ["ko", "en"]


# ── 합치기 풀기 ───────────────────────────────────────────────────────────────


def _unmerge(client: TestClient, fx: Fixture, unit: dict) -> httpx2.Response:
    return _edit(client, fx.bundle_id, fx.doc["id"], {"type": "unmerge", "unit_id": unit["id"]})


def test_unmerge_revives_the_merged_units_and_undoes(client: TestClient) -> None:
    fx = _setup(client)
    record, check = find_unit(fx.view, RECORD), find_unit(fx.view, CHECK)
    _ok(_merge(client, fx, record, check))
    merged = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), f"{RECORD} {CHECK}")
    assert merged["can_unmerge"] is True
    assert not any(unit["can_unmerge"] for unit in fx.view["units"])

    result = _ok(_unmerge(client, fx, merged))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert (result["created_unit_ids"], result["retired_unit_ids"]) == ([record["id"], check["id"]], [merged["id"]])
    for before in (record, check):
        after = find_unit(view, before["text"])
        # 원래 ID·표시 ID·범위 그대로, 되살린 것은 "나눔·합침" 표시가 아니다
        assert (after["id"], after["display_id"], after["spans"], after["is_edited"], after["can_unmerge"]) == (
            before["id"], before["display_id"], before["spans"], False, False,
        )
    assert _load_statuses(merged["id"]) == ["retired"]
    assert _find_coverage_problems(view) == []
    assert _load_edit_rows(fx.doc["id"]) == [(1, "merge", "applied"), (2, "unmerge", "applied")]

    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))

    back = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), f"{RECORD} {CHECK}")
    assert (back["id"], back["can_unmerge"]) == (merged["id"], True)


def test_unmerge_follows_a_later_language_change(client: TestClient) -> None:
    fx = _setup(client)
    record, check = find_unit(fx.view, RECORD), find_unit(fx.view, CHECK)
    _ok(_merge(client, fx, record, check))
    merged = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), f"{RECORD} {CHECK}")
    _ok(_set_language(client, fx.bundle_id, fx.doc["id"], [merged], "en"))

    _ok(_unmerge(client, fx, merged))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert [find_unit(view, text)["lang"] for text in (RECORD, CHECK)] == ["en", "en"]

    # 되살린 단위에 판단이 생겨도 되돌리기는 언어 검사(R31)가 아니라 확인만 묻는다 - 그 단위는 은퇴하는 것이라
    record_now = find_unit(view, RECORD)
    assign_as_is(client, fx.bundle_id, record_now, fx.sop_id, slot_key="purpose")
    refused = _step(client, fx.bundle_id, fx.doc["id"], "undo")
    assert refused.json()["detail"] == {"code": "confirm_required", "unit_ids": [record_now["id"]]}
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo", confirm=True))
    back = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), f"{RECORD} {CHECK}")
    assert (back["id"], back["lang"]) == (merged["id"], "en")


def test_unmerge_refuses_units_not_made_by_a_standing_merge(client: TestClient) -> None:
    fx = _setup(client)
    record, check = find_unit(fx.view, RECORD), find_unit(fx.view, CHECK)
    original = _unmerge(client, fx, record)
    _ok(_merge(client, fx, record, check))
    merged = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), f"{RECORD} {CHECK}")
    _ok(_split(client, fx, merged, len(RECORD) + 1))
    piece = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), CHECK)
    before = get_view(client, fx.bundle_id, fx.doc["id"])

    after_split = _unmerge(client, fx, piece)
    retired = _unmerge(client, fx, merged)

    assert _code(original) == (422, "cannot_unmerge")
    assert _code(after_split) == (422, "cannot_unmerge")
    assert _code(retired) == (404, "unit_not_found")
    assert not any(unit["can_unmerge"] for unit in before["units"])
    assert get_view(client, fx.bundle_id, fx.doc["id"])["document"]["revision"] == before["document"]["revision"]


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
    merged = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), "합성 값 하나. 합성 값 둘.")
    assert (merged["kind"], merged["row_index"]) == ("cell_sentence", 0)

    _ok(_split(client, fx, merged, len("합성 값 하나. ")))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    blocks = {block["id"]: block for block in view["blocks"]}
    pieces = [find_unit(view, text) for text in ("합성 값 하나.", "합성 값 둘.")]
    assert [(unit["table_id"], unit["row_index"], unit["group_unit_id"]) for unit in pieces] == [
        (table["table_id"], 0, None), (table["table_id"], 1, None),
    ]
    assert all(unit["row_index"] == blocks[unit["block_id"]]["row_index"] for unit in pieces)



def test_unwrap_table_turns_its_caption_into_a_sentence(client: TestClient) -> None:
    """레이아웃 표의 캡션은 보통 문장으로 돌아간다(명세 §3.1) — 쪼개지 않고 캡션 범위 그대로, 되돌리면 캡션이 살아난다."""
    caption_text = "표 7. 기록 양식"
    fx = _setup(client, p(HEADING) + p(caption_text, "Caption") + tbl([["합성 칸이다."]]))
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    caption = find_unit(fx.view, caption_text)
    assert (caption["kind"], caption["group_unit_id"]) == ("caption", table["id"])

    to_layout = {"type": "set_layout_table", "table_id": table["table_id"], "is_layout": True}
    _ok(_edit(client, fx.bundle_id, fx.doc["id"], to_layout))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    sentence = find_unit(view, caption_text)
    assert (sentence["kind"], sentence["group_unit_id"], sentence["spans"]) == ("sentence", None, caption["spans"])
    assert sentence["lang"] == caption["lang"]
    assert _find_coverage_problems(view) == []

    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    revived = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), caption_text)
    assert (revived["id"], revived["kind"], revived["group_unit_id"]) == (caption["id"], "caption", table["id"])


# ── 캡션 ──────────────────────────────────────────────────────────────────────

BEFORE_TABLE, AFTER_TABLE, FAR = "합성 표 앞 문장이다.", "합성 표 뒤 문장이다.", "합성 먼 문장이다."
FIGURE_CAPTION = "그림 1. 로터 구조 (Figure 1. Rotor layout)"
TABLE_CAPTION = "표 7. 기록 양식"


def _setup_table_with_neighbors(client: TestClient) -> tuple[Fixture, dict]:
    fx = _setup(client, p(HEADING) + p(BEFORE_TABLE) + tbl([["합성 칸이다."]]) + p(AFTER_TABLE) + p(FAR))
    return fx, next(unit for unit in fx.view["units"] if unit["kind"] == "table")


def _setup_figure(client: TestClient) -> tuple[Fixture, dict, dict]:
    """그림 하나와 그 아래 한/영 한 줄 캡션, 그 뒤 문장 하나."""
    body = p(HEADING) + f"<w:p>{make_drawing_run('image1.png')}</w:p>" + p(FIGURE_CAPTION, "Caption") + p(RECORD)
    bundle = create_bundle(client, is_synthetic=True)
    tobe = put_tobe(client, bundle["id"], TOBE_DOCS)
    assert tobe.status_code == 200, tobe.text
    doc = _upload_ready(client, bundle["id"], build_docx(body, media={"image1.png": TINY_PNG}), OLD_NAME)
    view = get_view(client, bundle["id"], doc["id"])
    figure = next(unit for unit in view["units"] if unit["kind"] == "figure")
    caption = find_unit(view, FIGURE_CAPTION)
    assert (caption["kind"], caption["group_unit_id"]) == ("caption", figure["id"])
    return Fixture(bundle["id"], tobe.json()["docs"][0]["id"], doc, view), figure, caption


def _attach(client: TestClient, fx: Fixture, unit: dict, bundle: dict) -> httpx2.Response:
    op = {"type": "attach_caption", "unit_id": unit["id"], "bundle_unit_id": bundle["id"]}
    return _edit(client, fx.bundle_id, fx.doc["id"], op)


def _detach(client: TestClient, fx: Fixture, unit: dict, **kwargs: int | bool) -> httpx2.Response:
    return _edit(client, fx.bundle_id, fx.doc["id"], {"type": "detach_caption", "unit_id": unit["id"]}, **kwargs)


def _created_units(client: TestClient, fx: Fixture, result: dict) -> list[dict]:
    units = {unit["id"]: unit for unit in get_view(client, fx.bundle_id, fx.doc["id"])["units"]}
    return [units[unit_id] for unit_id in result["created_unit_ids"]]


def test_attach_a_neighbor_sentence_as_caption_and_undo(client: TestClient) -> None:
    fx, table = _setup_table_with_neighbors(client)
    sentence = find_unit(fx.view, BEFORE_TABLE)

    result = _ok(_attach(client, fx, sentence, table))

    (caption,) = _created_units(client, fx, result)
    assert (caption["kind"], caption["group_unit_id"], caption["spans"]) == ("caption", table["id"], sentence["spans"])
    assert (caption["lang"], result["retired_unit_ids"]) == (sentence["lang"], [sentence["id"]])
    assert _find_coverage_problems(get_view(client, fx.bundle_id, fx.doc["id"])) == []
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    assert _load_statuses(sentence["id"], caption["id"]) == ["active", "retired"]


@pytest.mark.parametrize("case", ["ref", "bound", "not_a_bundle"])
def test_attach_refuses_wrong_units(client: TestClient, case: str) -> None:
    fx, table = _setup_table_with_neighbors(client)
    sentence, bundle = find_unit(fx.view, BEFORE_TABLE), table
    if case == "ref":
        update_row(Unit, sentence["id"], lang=REF_LANG)
    elif case == "bound":
        sentence = find_unit(fx.view, "합성 칸이다.")  # 표에 묶인 칸 문장
    else:
        bundle = find_unit(fx.view, AFTER_TABLE)

    assert _code(_attach(client, fx, sentence, bundle)) == (422, "invalid_unit_kind")


def test_attach_on_a_confirmed_bundle_needs_confirm_and_detaches_it(client: TestClient) -> None:
    fx = _setup(client, p(HEADING) + p(TABLE_CAPTION, "Caption") + tbl([["합성 칸이다."]]) + p(ENGLISH))
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    assign_as_is(client, fx.bundle_id, table, fx.sop_id, slot_key="purpose")
    english = find_unit(fx.view, ENGLISH)

    refused = _attach(client, fx, english, table)

    assert _code(refused) == (409, "confirm_required")
    assert table["id"] in refused.json()["detail"]["unit_ids"]
    op = {"type": "attach_caption", "unit_id": english["id"], "bundle_unit_id": table["id"]}
    result = _ok(_edit(client, fx.bundle_id, fx.doc["id"], op, confirm=True))
    assert table["id"] in result["detach"]["reset_unit_ids"]
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert find_unit(view, ENGLISH)["kind"] == "caption"
    assert next(unit for unit in view["units"] if unit["id"] == table["id"])["status"] == "unassigned"
    assert _find_coverage_problems(view) == []
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))


def test_detach_from_a_bundle_confirmed_with_a_written_caption_needs_confirm(client: TestClient) -> None:
    """캡션 단위를 쓰지 않고 써 넣은 캡션으로 확정한 묶음도 묶인 캡션이 바뀌면 떼어 낸다."""
    fx = _setup(client, p(HEADING) + p(TABLE_CAPTION, "Caption") + tbl([["합성 칸이다."]]))
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    caption = find_unit(fx.view, TABLE_CAPTION)
    targets, caption_ids = build_as_is_targets(client, fx.bundle_id, table, fx.sop_id, slot_key="purpose")
    assert caption_ids == [caption["id"]]
    written = {
        "key": "caption", "target_doc_id": fx.sop_id, "slot_key": "purpose", "parent_key": "t", "lang": "en",
        "text": WRITTEN_CAPTION, "source_unit_ids": [],
    }
    body = {
        "action": "confirm", "units": [{"unit_id": table["id"], "revision": 1, "disposition": "assigned"}],
        "targets": [*targets, written],
    }
    assert save_group(client, fx.bundle_id, body).status_code == 200

    assert _code(_detach(client, fx, caption)) == (409, "confirm_required")
    result = _ok(_detach(client, fx, caption, confirm=True))
    assert table["id"] in result["detach"]["reset_unit_ids"]
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    assert next(unit for unit in view["units"] if unit["id"] == table["id"])["status"] == "unassigned"
    assert _find_coverage_problems(view) == []


def test_attach_takes_a_far_sentence_but_not_a_line_still_in_a_table(client: TestClient) -> None:
    """거리 제한은 없다(B10 8-b) — 표 뒤 세 번째 문단도 붙는다. 아직 표인 칸 줄(묶인 칸 문장)은 캡션이 될 수 없다."""
    fx = _setup(client, p(HEADING) + tbl([["합성 칸이다."], ["둘째 칸이다."]]) + p(AFTER_TABLE) + p(RECORD) + p(FAR))
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")

    assert _code(_attach(client, fx, find_unit(fx.view, "둘째 칸이다."), table)) == (422, "invalid_unit_kind")
    _ok(_attach(client, fx, find_unit(fx.view, FAR), table))


def test_attach_rejects_a_second_caption_in_the_same_language(client: TestClient) -> None:
    fx, table = _setup_table_with_neighbors(client)
    _ok(_attach(client, fx, find_unit(fx.view, BEFORE_TABLE), table))
    view = get_view(client, fx.bundle_id, fx.doc["id"])

    assert _code(_attach(client, fx, find_unit(view, AFTER_TABLE), table)) == (422, "caption_exists")


def test_detach_turns_caption_back_into_a_sentence(client: TestClient) -> None:
    fx, _, caption = _setup_figure(client)

    result = _ok(_detach(client, fx, caption))

    (sentence,) = _created_units(client, fx, result)
    assert (sentence["kind"], sentence["group_unit_id"]) == ("sentence", None)
    assert (sentence["spans"], sentence["lang"]) == (caption["spans"], caption["lang"])
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    assert _load_statuses(caption["id"], sentence["id"]) == ["active", "retired"]


def test_detach_legacy_figure_block_caption_is_rejected(client: TestClient) -> None:
    """0020이 옮긴 캡션은 그림 블록 위에 있다 — 떼면 그림 블록 글이 문장이 되어 버리므로 막는다."""
    fx, figure, caption = _setup_figure(client)
    figure_block_id = figure["spans"][0][0] if figure["spans"] else figure["block_id"]
    update_row(SourceBlock, figure_block_id, text=FIGURE_CAPTION)
    update_row(Unit, caption["id"], spans=[[figure_block_id, 0, len(FIGURE_CAPTION)]])

    response = _detach(client, fx, caption, revision=fx.view["document"]["revision"])

    assert _code(response) == (422, "caption_in_figure_block")


def test_split_caption_keeps_both_pieces_on_the_bundle(client: TestClient) -> None:
    fx, figure, caption = _setup_figure(client)

    result = _ok(_split(client, fx, caption, FIGURE_CAPTION.index("(Figure")))

    created = _created_units(client, fx, result)
    assert [(unit["kind"], unit["group_unit_id"]) for unit in created] == [
        ("caption", figure["id"]), ("caption", figure["id"]),
    ]
    assert {unit["lang"] for unit in created} == {"ko", "en"}
    assert _find_coverage_problems(get_view(client, fx.bundle_id, fx.doc["id"])) == []
    _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))
    revived = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), FIGURE_CAPTION)
    assert (revived["id"], revived["kind"], revived["group_unit_id"]) == (caption["id"], "caption", figure["id"])


def test_set_language_refuses_a_second_caption_in_one_language(client: TestClient) -> None:
    """한/영으로 나눈 캡션의 한글 조각을 영어로 바꾸면 묶음당 언어 하나를 깬다."""
    fx, _, caption = _setup_figure(client)
    result = _ok(_split(client, fx, caption, FIGURE_CAPTION.index("(Figure")))
    korean = next(unit for unit in _created_units(client, fx, result) if unit["lang"] == "ko")

    response = _set_language(client, fx.bundle_id, fx.doc["id"], [korean], "en")

    assert _code(response) == (422, "caption_exists")


def test_split_caption_into_one_language_is_rejected(client: TestClient) -> None:
    """같은 언어 조각 둘은 둘 다 캡션이라 묶음 저장이 같은 언어 캡션 둘을 받게 된다 — 나누기에서 막는다(caption_exists, split)."""
    fx, figure, caption = _setup_figure(client)

    response = _split(client, fx, caption, FIGURE_CAPTION.index("로터"))

    assert _code(response) == (422, "caption_exists")
    assert response.json()["detail"]["reason"] == "split"
    kept = find_unit(get_view(client, fx.bundle_id, fx.doc["id"]), FIGURE_CAPTION)
    assert (kept["id"], kept["group_unit_id"]) == (caption["id"], figure["id"])


def test_merge_caption_with_plain_sentence_is_rejected(client: TestClient) -> None:
    fx, _, caption = _setup_figure(client)

    assert _code(_merge(client, fx, caption, find_unit(fx.view, RECORD))) == (422, "cannot_merge")


def test_rewrap_table_leaves_the_former_caption_a_sentence(client: TestClient) -> None:
    """레이아웃 → 데이터로 다시 감싸도 캡션을 저절로 붙이지 않는다 — 사람이 붙이기로 고른다."""
    caption_text = "표 7. 기록 양식"
    fx = _setup(client, p(HEADING) + p(caption_text, "Caption") + tbl([["합성 칸이다."]]))
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    for is_layout in (True, False):
        op = {"type": "set_layout_table", "table_id": table["table_id"], "is_layout": is_layout}
        _ok(_edit(client, fx.bundle_id, fx.doc["id"], op))

    view = get_view(client, fx.bundle_id, fx.doc["id"])
    rewrapped = next(unit for unit in view["units"] if unit["kind"] == "table")
    sentence = find_unit(view, caption_text)
    assert (sentence["kind"], sentence["group_unit_id"]) == ("sentence", None)
    _ok(_attach(client, fx, sentence, rewrapped))


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
        "op": "split", "boundary_unit_ids": [], "confirmed": None,
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
    # 문장 수가 다른 덩어리는 코드가 짝짓지 않아 사람이 맺는다
    created = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}/pairs",
        json={"revision": 1, "unit_ids": [two["id"], record["id"], english["id"]]}, headers=AUTHOR,
    )
    assert created.status_code == 201, created.text
    pair = created.json()["pair"]
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


# ── 옛 경계 확인 기록 ─────────────────────────────────────────────────────────


def _add_legacy_boundary_edit(doc_id: int, op: str, unit_ids: list[int]) -> None:
    """확인 동작이 있던 때(v1.0.17까지) 쌓인 기록 한 줄 — 표시를 켠 기록이라 단위의 표시도 함께 켠다."""

    async def _run(session: AsyncSession) -> None:
        last_seq = await session.scalar(select(func.max(UnitEdit.seq)).where(UnitEdit.document_id == doc_id))
        session.add(
            UnitEdit(
                document_id=doc_id, seq=(last_seq or 0) + 1, op=op, payload={"unit_ids": unit_ids, "confirmed": True},
                actor="qa.member",
            )
        )
        for unit_id in unit_ids:
            (await session.get_one(Unit, unit_id)).boundary_confirmed = True
        await session.commit()

    run_in_session(_run)


def _load_boundary_flags(*unit_ids: int) -> list[bool]:
    async def _run(session: AsyncSession) -> list[bool]:
        return [(await session.get_one(Unit, unit_id)).boundary_confirmed for unit_id in unit_ids]

    return run_in_session(_run)


def test_legacy_boundary_records_still_undo_and_redo(client: TestClient) -> None:
    # 확인 동작은 없어졌지만 운영 DB의 되돌리기 줄에는 옛 기록이 편집과 섞여 남아 있다 — 줄이 거기서 막히면 안 된다
    fx = _setup(client)
    two, record = find_unit(fx.view, TWO_IN_ONE), find_unit(fx.view, RECORD)
    _add_legacy_boundary_edit(fx.doc["id"], "boundary", [record["id"]])
    _ok(_split(client, fx, two, len(FIRST)))
    view = get_view(client, fx.bundle_id, fx.doc["id"])
    halves = sorted(find_unit(view, text)["id"] for text in (FIRST, SECOND))
    _add_legacy_boundary_edit(fx.doc["id"], "check_all", halves)

    undone = _ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))

    assert undone == {
        "document_revision": 2, "created_unit_ids": [], "retired_unit_ids": [], "detach": None,
        "op": "check_all", "boundary_unit_ids": halves, "confirmed": False,
    }
    assert _load_boundary_flags(*halves, record["id"]) == [False, False, True]
    steps = [_ok(_step(client, fx.bundle_id, fx.doc["id"], "undo"))["op"] for _ in range(2)]
    assert steps == ["split", "boundary"]
    assert _load_boundary_flags(record["id"]) == [False]
    assert get_view(client, fx.bundle_id, fx.doc["id"])["edits"] == {"can_undo": False, "can_redo": True}

    redone = _ok(_step(client, fx.bundle_id, fx.doc["id"], "redo"))

    assert (redone["op"], redone["boundary_unit_ids"], redone["confirmed"]) == ("boundary", [record["id"]], True)
    assert _load_boundary_flags(record["id"]) == [True]


def test_edits_are_for_authors_while_in_progress(client: TestClient) -> None:
    fx = _setup(client)
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    unit = find_unit(fx.view, TWO_IN_ONE)
    base = f"/api/bundles/{fx.bundle_id}/documents/{fx.doc['id']}"
    edit = {"revision": 1, "op": {"type": "split", "unit_id": unit["id"], "at": len(FIRST)}}

    def _send_all(headers: dict[str, str]) -> set[tuple[int, str]]:
        responses = [
            client.post(f"{base}/edits", json=edit, headers=headers),
            client.post(f"{base}/edits/undo", json={"revision": 1}, headers=headers),
            client.post(f"{base}/edits/redo", json={"revision": 1}, headers=headers),
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
    (409, "nothing_to_undo"), (409, "nothing_to_redo"),
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


def test_merging_two_changes_keeps_every_field() -> None:
    # 표 벗기기와 안쪽 띠 표 · 대응 표 벗기기를 한 편집으로 합칠 때 어느 칸도 조용히 빠지지 않는다(새 칸이 생겨도 이 시험이 잡는다)
    from dataclasses import fields

    from app.sop.editing import _Change, _Draft, _merge_changes

    def make_draft(group_draft: int | None) -> _Draft:
        return _Draft(
            kind="cell_sentence", spans=[], text="", lang="ko", table_id=None, row_index=None, group_unit_id=None,
            pos_seq=0, pos_start=0, group_draft=group_draft,
        )

    def fill(tag: int) -> _Change:
        values: dict[str, object] = {}
        for item in fields(_Change):
            empty = getattr(_Change(), item.name)
            if item.name == "drafts":
                values[item.name] = [make_draft(None), make_draft(0)]
            elif isinstance(empty, bool):
                values[item.name] = tag == 2
            elif isinstance(empty, list):
                values[item.name] = [(tag, item.name)] if item.name not in ("retire", "revive") else [tag]
            else:
                values[item.name] = {tag: item.name}
        return _Change(**values)

    merged = _merge_changes(fill(1), fill(2))

    for item in fields(_Change):
        value = getattr(merged, item.name)
        if isinstance(value, bool):
            assert value is True, item.name
        else:
            assert len(value) == (4 if item.name == "drafts" else 2), item.name
    # 뒤 변경의 표 단위 순번은 앞 변경의 초안 수만큼 민다
    assert [draft.group_draft for draft in merged.drafts] == [None, 0, None, 2]
