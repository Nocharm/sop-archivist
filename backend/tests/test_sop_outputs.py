"""결과물 A·B·C·요약 숫자·C 순서 바꾸기·진행 숫자 — To-Be와 합성 옛 문서 둘, 입구 2 새 문서 하나를 올린 묶음으로 본다.

픽스처 묶음에는 나눔·합침·중복 배정·삭제·이동·데이터 표·그림(보류)·입구 2 짝과 신규·미배정 1건이 모두 있다.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from functools import partial
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.sop.constants import SLOT_KEYS
from app.sop.models import TargetSentence
from tests.access_helpers import run_in_session
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.sop_helpers import (
    ADMIN,
    AUTHOR,
    REVIEWER,
    assign_as_is,
    create_bundle,
    find_unit,
    get_bundle,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)

pytestmark = pytest.mark.usefixtures("clean_sop")

OLD1_NAME = "SYNTHETIC_OLD-1_Outputs.docx"
OLD2_NAME = "SYNTHETIC_OLD-2_Outputs.docx"
NEW_NAME = "SYNTHETIC_SOP-9_Outputs.docx"

SPLIT_SOURCE = "합성 장비를 켜고 시료를 넣는다."
SPLIT_A = "합성 장비를 켠다."
SPLIT_B = "합성 시료를 넣는다."
UNASSIGNED_EN = "Turn on the synthetic unit and load the sample."
MERGE_1 = "합성 기록을 보관한다."
MERGE_2 = "합성 기록은 3년간 보관한다."
MERGED = "합성 기록을 3년간 보관한다."
DUPLICATE = "합성 시료는 4 ℃에서 보관한다."
DELETED = "합성 메모는 지운다."
MOVED = "합성 교정은 다른 SOP가 다룬다."
CAPTION = "그림 1 합성 장비"
LABEL = "합성 라벨을 붙인다."
NEW_SENTENCE = "합성 라벨을 확인한다."
RECORDS_EN = "Records are kept for three years."
OLD1_HEADINGS = ("5. 절차", "5.1 준비")
OLD2_HEADINGS = ("5. 기록", "5.1 보관")

OLD1_BODY = (
    p(OLD1_HEADINGS[0], "Heading1")
    + p(OLD1_HEADINGS[1], "Heading2")
    + p(SPLIT_SOURCE)
    + p(UNASSIGNED_EN)
    + p(MERGE_1)
    + p(DUPLICATE)
    + p(DELETED)
    + p(MOVED)
    + tbl([["항목", "Item"], ["합성 값", "Synthetic value"]])
    + f"<w:p>{make_drawing_run('image1.png')}</w:p>"
    + p(CAPTION, "Caption")
)
OLD2_BODY = p(OLD2_HEADINGS[0], "Heading1") + p(OLD2_HEADINGS[1], "Heading2") + p(MERGE_2) + p(LABEL) + p(RECORDS_EN)
NEW_BODY = p("1. 라벨", "Heading1") + p(f"{LABEL} {NEW_SENTENCE}")

TOBE_DOCS = [
    {"code": "SOP-NEW", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None},
    {"code": "WI-01", "title": "Synthetic WI", "doc_type": "wi", "parent_code": "SOP-NEW"},
]
SCOPE_REASON = "Synthetic: covered elsewhere"
RELATIONS_REASON = "Synthetic: no related documents"
NA_SLOTS = [
    {"code": "SOP-NEW", "slot_key": "scope", "reason": SCOPE_REASON},
    {"code": "SOP-NEW", "slot_key": "document_relationships", "reason": RELATIONS_REASON},
]
WI_STEPS = [{"code": "WI-01", "step_no": 1, "title": "Prepare"}, {"code": "WI-01", "step_no": 2, "title": "Load"}]
HEADING_REASON = "Synthetic: structure heading"
DELETE_REASON = "Synthetic: obsolete note"
MOVE_REASON = "Synthetic: owned by another SOP"
MOVE_CODE = "SOP-OTHER-1"
DUPLICATE_REASON = "Synthetic: needed in both"
FIGURE_HOLD = "Synthetic: check the image"


class Fixture(NamedTuple):
    bundle_id: int
    sop_id: int
    wi_id: int
    match_id: int
    old1: dict
    old2: dict


def _upload_ready(client: TestClient, bundle_id: int, data: bytes, name: str, **kwargs: str) -> dict:
    response = upload(client, bundle_id, data, name, **kwargs)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ready", response.json()
    return response.json()


def _unit_in(unit: dict, revision: int = 1, **fields: str) -> dict:
    return {"unit_id": unit["id"], "revision": revision, "disposition": "assigned", **fields}


def _target(key: str, doc_id: int, sources: list[dict], **fields: object) -> dict:
    return {"key": key, "target_doc_id": doc_id, "source_unit_ids": [unit["id"] for unit in sources], **fields}


def _save(client: TestClient, bundle_id: int, units: list[dict], targets: list[dict]) -> dict:
    response = save_group(client, bundle_id, {"action": "confirm", "units": units, "targets": targets})
    assert response.status_code == 200, response.text
    return response.json()


def _bulk(client: TestClient, bundle_id: int, action: str, units: list[dict], reason: str, **fields: str) -> None:
    body = {"action": action, "reason": reason, "units": [{"unit_id": u["id"], "revision": 1} for u in units], **fields}
    response = client.post(f"/api/bundles/{bundle_id}/decisions/bulk", json=body, headers=AUTHOR)
    assert response.status_code == 200, response.text


def _load_targets(target_doc_id: int) -> list[dict]:
    """새 문서의 새 문장 — order_index·id 순."""

    async def _load(session: AsyncSession) -> list[dict]:
        rows = await session.scalars(
            select(TargetSentence)
            .where(TargetSentence.target_doc_id == target_doc_id)
            .order_by(TargetSentence.order_index, TargetSentence.id)
        )
        return [{"id": row.id, "revision": row.revision, "text": row.confirmed_text} for row in rows]

    return run_in_session(_load)


def _setup(client: TestClient) -> Fixture:
    """To-Be(SOP-NEW·그 WI-01, N/A 둘, 단계 둘) + 옛 문서 OLD-1·OLD-2 + 입구 2 새 문서 SOP-9에 판단을 모두 넣은 묶음.

    미배정으로 남는 것은 OLD-1의 영어 문장 하나, 그림은 보류다.
    """
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS, na_slots=NA_SLOTS, wi_steps=WI_STEPS)
    assert response.status_code == 200, response.text
    codes = {doc["code"]: doc["id"] for doc in response.json()["docs"]}
    sop_id, wi_id = codes["SOP-NEW"], codes["WI-01"]
    old1_doc = _upload_ready(client, bundle_id, build_docx(OLD1_BODY, media={"image1.png": TINY_PNG}), OLD1_NAME)
    old2_doc = _upload_ready(client, bundle_id, build_docx(OLD2_BODY), OLD2_NAME)
    new_doc = _upload_ready(client, bundle_id, build_docx(NEW_BODY), NEW_NAME, side="new", doc_type="sop")
    old1, old2 = get_view(client, bundle_id, old1_doc["id"]), get_view(client, bundle_id, old2_doc["id"])

    headings = [find_unit(old1, text) for text in OLD1_HEADINGS] + [find_unit(old2, text) for text in OLD2_HEADINGS]
    _bulk(client, bundle_id, "delete", headings, HEADING_REASON)
    _bulk(client, bundle_id, "delete", [find_unit(old1, DELETED)], DELETE_REASON)
    _bulk(client, bundle_id, "move_external", [find_unit(old1, MOVED)], MOVE_REASON, move_target_code=MOVE_CODE)
    split = find_unit(old1, SPLIT_SOURCE)
    _save(client, bundle_id, [_unit_in(split)], [
        _target("a", wi_id, [split], wi_step=1, wi_part="instruction", text=SPLIT_A),
        _target("b", wi_id, [split], wi_step=2, wi_part="instruction", text=SPLIT_B),
    ])
    first, second = find_unit(old1, MERGE_1), find_unit(old2, MERGE_2)
    _save(client, bundle_id, [_unit_in(first), _unit_in(second)], [
        _target("m", sop_id, [first, second], slot_key="general_requirements.operation", text=MERGED),
    ])
    duplicate = find_unit(old1, DUPLICATE)
    _save(client, bundle_id, [_unit_in(duplicate, reason=DUPLICATE_REASON)], [
        _target("s", sop_id, [duplicate], slot_key="responsibilities"),
        _target("w", wi_id, [duplicate], wi_step=1, wi_part="why"),
    ])
    table = next(unit for unit in old1["units"] if unit["kind"] == "table")
    assign_as_is(client, bundle_id, table, sop_id, slot_key="general_requirements")
    figure = next(unit for unit in old1["units"] if unit["kind"] == "figure")
    assign_as_is(client, bundle_id, figure, wi_id, wi_step=2, wi_part="instruction", hold_reason=FIGURE_HOLD)
    assign_as_is(client, bundle_id, find_unit(old2, RECORDS_EN), sop_id, slot_key="general_requirements.operation")

    # 입구 2 — 같은 글자 짝 하나와 출처 없는 신규 하나
    match_id = new_doc["target_doc_id"]
    targets = {target["text"]: target for target in _load_targets(match_id)}
    label = find_unit(old2, LABEL)
    linked, fresh = targets[LABEL], targets[NEW_SENTENCE]
    _save(client, bundle_id, [_unit_in(label)], [
        {"key": "l", "id": linked["id"], "revision": linked["revision"], "source_unit_ids": [label["id"]]},
    ])
    _save(client, bundle_id, [], [{"key": "n", "id": fresh["id"], "revision": fresh["revision"], "source_unit_ids": []}])
    return Fixture(bundle_id, sop_id, wi_id, match_id, old1, old2)


def _get_output(client: TestClient, bundle_id: int, kind: str, lang: str | None = None) -> object:
    params = {"lang": lang} if lang is not None else {}
    response = client.get(f"/api/bundles/{bundle_id}/{kind}", params=params, headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _display(view: dict, text: str) -> str:
    return find_unit(view, text)["display_id"]


def _display_of_kind(view: dict, kind: str) -> str:
    (unit,) = [unit for unit in view["units"] if unit["kind"] == kind]
    return unit["display_id"]


def _pick_row(rows: list[dict], display_id: str) -> dict:
    (row,) = [row for row in rows if row["display_id"] == display_id]
    return row


# ── A 비교표 ─────────────────────────────────────────────────────────────────


def test_output_a_rows_follow_line_rules(client: TestClient) -> None:
    fx = _setup(client)
    d1, d2 = partial(_display, fx.old1), partial(_display, fx.old2)
    table, figure = _display_of_kind(fx.old1, "table"), _display_of_kind(fx.old1, "figure")

    ko = _get_output(client, fx.bundle_id, "outputs/a", "ko")
    en = _get_output(client, fx.bundle_id, "outputs/a", "en")

    def _shape(rows: list[dict]) -> list[tuple]:
        return [
            (r["row_kind"], r["display_id"], r["dest_kind"], r["dest_doc_code"], r["change_type"], r["group_id"])
            for r in rows
        ]

    assert _shape(ko) == [
        ("unit", d1(OLD1_HEADINGS[0]), "delete", "", "deleted", None),
        ("unit", d1(OLD1_HEADINGS[1]), "delete", "", "deleted", None),
        ("unit", d1(SPLIT_SOURCE), "wi", "WI-01", "split", f"G-{d1(SPLIT_SOURCE)}"),
        ("unit", d1(MERGE_1), "sop", "SOP-NEW", "merged", f"G-{d1(MERGE_1)}"),
        # 중복 배정은 보낸 곳마다 한 줄
        ("unit", d1(DUPLICATE), "sop", "SOP-NEW", "as_is", f"G-{d1(DUPLICATE)}"),
        ("unit", d1(DUPLICATE), "wi", "WI-01", "as_is", f"G-{d1(DUPLICATE)}"),
        ("unit", d1(DELETED), "delete", "", "deleted", None),
        ("unit", d1(MOVED), "move_external", MOVE_CODE, "", None),
        # 표 줄이 칸 문장 줄보다 앞, 칸 문장은 그 언어 것만
        ("table", table, "sop", "SOP-NEW", "as_is", None),
        ("unit", d1("항목"), "sop", "SOP-NEW", "as_is", None),
        ("unit", d1("합성 값"), "sop", "SOP-NEW", "as_is", None),
        ("unit", figure, "wi", "WI-01", "as_is", None),
        ("unit", d2(OLD2_HEADINGS[0]), "delete", "", "deleted", None),
        ("unit", d2(OLD2_HEADINGS[1]), "delete", "", "deleted", None),
        ("unit", d2(MERGE_2), "sop", "SOP-NEW", "merged", f"G-{d1(MERGE_1)}"),
        ("unit", d2(LABEL), "sop", "SOP-9", "as_is", None),
        # 입구 2 신규 줄은 옛 문장 칸이 빈 채로 끝에
        ("new", "", "sop", "SOP-9", "new", None),
    ]
    assert _shape(en) == [
        ("unit", d1(UNASSIGNED_EN), "", "", "", None),
        ("table", table, "sop", "SOP-NEW", "as_is", None),
        ("unit", d1("Item"), "sop", "SOP-NEW", "as_is", None),
        ("unit", d1("Synthetic value"), "sop", "SOP-NEW", "as_is", None),
        ("unit", figure, "wi", "WI-01", "as_is", None),
        ("unit", d2(RECORDS_EN), "sop", "SOP-NEW", "as_is", None),
    ]

    split = _pick_row(ko, d1(SPLIT_SOURCE))
    assert (split["confirmed_text"], split["dest_location"]) == (
        f"① {SPLIT_A}\n② {SPLIT_B}", "① 1단계 · Instruction\n② 2단계 · Instruction",
    )
    assert (split["source_text"], split["old_doc_code"], split["lang"], split["status"]) == (
        SPLIT_SOURCE, "OLD-1", "ko", "confirmed",
    )
    assert (split["location"]["section"], split["location"]["place"]) == ("5.1", "문단")
    assert split["confirmed_at"].endswith("+09:00")
    merged = [row for row in ko if row["change_type"] == "merged"]
    assert [(row["confirmed_text"], row["dest_location"]) for row in merged] == [
        (MERGED, "General Requirements › Operation"),
    ] * 2
    duplicate_rows = [row for row in ko if row["display_id"] == d1(DUPLICATE)]
    assert [(row["dest_location"], row["reason"]) for row in duplicate_rows] == [
        ("Responsibilities", DUPLICATE_REASON), ("1단계 · Why", DUPLICATE_REASON),
    ]
    moved = _pick_row(ko, d1(MOVED))
    assert (moved["reason"], moved["confirmed_text"], moved["status"]) == (MOVE_REASON, "", "confirmed")
    table_row = _pick_row(ko, table)
    assert (table_row["source_text"], table_row["location"]["place"], table_row["confirmed_text"]) == (
        "[표 1, 2×2]", "표 1", "",
    )
    assert _pick_row(ko, d1("합성 값"))["location"]["place"] == "표 1 · 2행 1열"
    assert _pick_row(en, d1("Item"))["location"]["place"] == "Table 1 · R 1 C 2"
    assert _pick_row(en, table)["source_text"] == "[Table 1, 2×2]"
    # 그림 줄은 두 언어 모두에, 보류 상태 그대로
    for rows in (ko, en):
        figure_row = _pick_row(rows, figure)
        assert (figure_row["status"], figure_row["lang"], figure_row["source_text"]) == ("on_hold", "neutral", CAPTION)
    assert _pick_row(en, figure)["dest_location"] == "Step 2 · Instruction"
    assert _pick_row(en, d1(UNASSIGNED_EN))["status"] == "unassigned"
    label_row = _pick_row(ko, d2(LABEL))
    # 입구 2 문서의 위치는 새 문서의 실제 절, 제목은 파일 이름에서 읽은 것
    assert (label_row["dest_location"], label_row["dest_doc_title"]) == ("1. 라벨", "SYNTHETIC Outputs")
    new_row = ko[-1]
    assert (new_row["unit_id"], new_row["source_text"], new_row["confirmed_text"], new_row["lang"]) == (
        None, "", NEW_SENTENCE, "ko",
    )
    assert (new_row["dest_location"], new_row["status"], new_row["location"]["section"]) == ("1. 라벨", "confirmed", "")


def test_output_a_table_lines_for_rows_empty_tables_and_dropped_cells(client: TestClient) -> None:
    """행으로 나눈 표는 행마다 표 줄, 칸 문장이 없는 표는 두 언어 모두, 칸 새 문장이 빠진 칸 문장은 표의 보낸 곳을 글 없이 따른다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    body = tbl([["", ""]]) + tbl([["합성 값 하나.", "Value one."], ["합성 값 둘.", "Value two."]])
    doc = _upload_ready(client, bundle_id, build_docx(body), OLD1_NAME)
    view = get_view(client, bundle_id, doc["id"])
    empty_table, table = [unit for unit in view["units"] if unit["kind"] == "table"]
    split = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}/edits",
        json={"revision": view["document"]["revision"], "confirm": False,
              "op": {"type": "split_table_rows", "table_unit_id": table["id"]}},
        headers=AUTHOR,
    )
    assert split.status_code == 200, split.text
    view = get_view(client, bundle_id, doc["id"])
    first_row, second_row = [unit for unit in view["units"] if unit["kind"] == "table_row"]
    assign_as_is(client, bundle_id, first_row, sop_id, slot_key="procedures.procedure")
    # 둘째 행은 한글 칸만 남긴 표 구성 변경 — 영어 칸 문장에는 칸 새 문장이 없다
    kept = find_unit(view, "합성 값 둘.")
    _save(client, bundle_id, [_unit_in(second_row, reason="Synthetic: drop the English cell")], [
        _target("t", sop_id, [second_row], slot_key="procedures.procedure", kind="table", grid={"rows": 1, "cols": 1},
                change_type="table_restructured"),
        _target("c", sop_id, [kept], slot_key="procedures.procedure", parent_key="t", cell_row=0, cell_col=0),
    ])
    d = partial(_display, view)

    ko = _get_output(client, bundle_id, "outputs/a", "ko")
    en = _get_output(client, bundle_id, "outputs/a", "en")

    def _shape(rows: list[dict]) -> list[tuple]:
        return [
            (r["row_kind"], r["display_id"], r["source_text"], r["location"]["place"], r["dest_doc_code"],
             r["change_type"], r["confirmed_text"])
            for r in rows
        ]

    restructured = ("table", second_row["display_id"], "[표 2, 1×2]", "표 2 · 2행", "SOP-NEW", "table_restructured", "")
    assert _shape(ko) == [
        ("table", empty_table["display_id"], "[표 1, 1×2]", "표 1", "", "", ""),
        ("table", first_row["display_id"], "[표 2, 1×2]", "표 2 · 1행", "SOP-NEW", "as_is", ""),
        ("unit", d("합성 값 하나."), "합성 값 하나.", "표 2 · 1행 1열", "SOP-NEW", "as_is", "합성 값 하나."),
        restructured,
        # 칸 문장 줄의 변경 종류는 자기 칸 새 문장의 것이다
        ("unit", d("합성 값 둘."), "합성 값 둘.", "표 2 · 2행 1열", "SOP-NEW", "as_is", "합성 값 둘."),
    ]
    assert _shape(en) == [
        ("table", empty_table["display_id"], "[Table 1, 1×2]", "Table 1", "", "", ""),
        ("table", first_row["display_id"], "[Table 2, 1×2]", "Table 2 · R 1", "SOP-NEW", "as_is", ""),
        ("unit", d("Value one."), "Value one.", "Table 2 · R 1 C 2", "SOP-NEW", "as_is", "Value one."),
        ("table", second_row["display_id"], "[Table 2, 1×2]", "Table 2 · R 2", "SOP-NEW", "table_restructured", ""),
        ("unit", d("Value two."), "Value two.", "Table 2 · R 2 C 2", "SOP-NEW", "table_restructured", ""),
    ]
    assert _pick_row(en, d("Value two."))["reason"] == "Synthetic: drop the English cell"
    # 표 줄은 요약 숫자에 세지 않는다 — 언어마다 그 언어 칸 문장 둘만
    summary = _get_output(client, bundle_id, "summary")
    assert (summary["ko"]["old_units"], summary["en"]["old_units"]) == (2, 2)


def test_output_a_requires_lang_and_membership(client: TestClient) -> None:
    bundle_id = create_bundle(client)["id"]

    missing = client.get(f"/api/bundles/{bundle_id}/outputs/a", headers=AUTHOR)
    wrong = client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": "neutral"}, headers=AUTHOR)
    outsider = client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": "ko"}, headers=REVIEWER)

    assert (missing.status_code, wrong.status_code) == (422, 422)
    assert (outsider.status_code, outsider.json()["detail"]["code"]) == (404, "bundle_not_found")
    assert _get_output(client, bundle_id, "outputs/a", "ko") == []


# ── B 흐름 ───────────────────────────────────────────────────────────────────


def test_output_b_counts(client: TestClient) -> None:
    fx = _setup(client)
    old1, old2 = f"old:{fx.old1['document']['id']}", f"old:{fx.old2['document']['id']}"
    sop, wi, match = f"target:{fx.sop_id}", f"target:{fx.wi_id}", f"target:{fx.match_id}"

    ko = _get_output(client, fx.bundle_id, "outputs/b", "ko")
    en = _get_output(client, fx.bundle_id, "outputs/b", "en")

    # 나눔은 한 번, 중복 배정은 보낸 곳마다 한 번
    assert [(e["source"], e["target"], e["count"]) for e in ko["edges"]] == [
        (old1, sop, 4), (old1, wi, 3), (old1, "delete", 3), (old1, "move_external", 1),
        (old2, sop, 1), (old2, match, 1), (old2, "delete", 2),
    ]
    assert [(n["id"], n["kind"], n["label"], n["count"]) for n in ko["nodes"]] == [
        (old1, "old", "OLD-1", 10), (old2, "old", "OLD-2", 4),
        (sop, "sop", "SOP-NEW", 5), (wi, "wi", "WI-01", 3), (match, "sop", "SOP-9", 1),
        ("delete", "delete", "삭제", 5), ("move_external", "move_external", "다른 문서로 이동", 1),
    ]
    assert [(e["source"], e["target"], e["count"]) for e in en["edges"]] == [
        (old1, sop, 2), (old1, wi, 1), (old1, "unassigned", 1), (old2, sop, 1),
    ]
    assert [(n["id"], n["count"]) for n in en["nodes"]] == [
        (old1, 4), (old2, 1), (sop, 3), (wi, 1), ("unassigned", 1),
    ]
    (unassigned,) = [node for node in en["nodes"] if node["kind"] == "unassigned"]
    assert (unassigned["label"], unassigned["count"]) == ("Unassigned", 1)


# ── C 새 문서 ────────────────────────────────────────────────────────────────


def _section_items(section: dict) -> list[tuple]:
    return [(item["text"], item["change_type"], item["status"], item["source_note"]) for item in section["items"]]


def test_output_c_structure(client: TestClient) -> None:
    fx = _setup(client)
    d1, d2 = partial(_display, fx.old1), partial(_display, fx.old2)

    ko = _get_output(client, fx.bundle_id, "outputs/c", "ko")

    sop, wi, match = ko["docs"]
    assert [(doc["code"], doc["doc_type"], doc["parent_code"], doc["entrance"]) for doc in ko["docs"]] == [
        ("SOP-NEW", "sop", None, "assign"), ("WI-01", "wi", "SOP-NEW", "assign"), ("SOP-9", "sop", None, "match"),
    ]
    # SOP 칸은 SLOT_KEYS 순서로 빈 칸까지, N/A 상위 칸의 하위 칸도 N/A(R8)
    assert [section["location_key"] for section in sop["sections"]] == list(SLOT_KEYS)
    sections = {section["location_key"]: section for section in sop["sections"]}
    assert {key: section["na_reason"] for key, section in sections.items() if section["na_reason"]} == {
        "scope": SCOPE_REASON,
        "document_relationships": RELATIONS_REASON,
        "document_relationships.attachments": RELATIONS_REASON,
        "document_relationships.appendices": RELATIONS_REASON,
    }
    assert sections["procedures.maintenance"]["label"] == "Procedures › Maintenance"
    assert _section_items(sections["responsibilities"]) == [(DUPLICATE, "as_is", "confirmed", "← OLD-1 §5.1")]
    # 영어 새 문장(RECORDS_EN)은 한글판에 나오지 않는다
    assert _section_items(sections["general_requirements.operation"]) == [
        (MERGED, "merged", "confirmed", "← OLD-1 §5.1, OLD-2 §5.1 (합침)"),
    ]
    (table,) = sections["general_requirements"]["items"]
    assert (table["kind"], table["lang"], table["change_type"], table["source_note"]) == (
        "table", "neutral", "as_is", "← OLD-1 §5.1",
    )
    assert [(cell["text"], cell["cell_row"], cell["cell_col"], cell["children"]) for cell in table["children"]] == [
        ("항목", 0, 0, []), ("합성 값", 1, 0, []),
    ]
    assert sum(len(section["items"]) for section in sop["sections"]) == 3

    # WI는 선언 단계 순으로 단계마다 Instruction·Why, 단계 없는 칸은 없을 때 싣지 않는다
    assert [(s["location_key"], s["label"]) for s in wi["sections"]] == [
        ("step:1:instruction", "1단계 · Instruction"), ("step:1:why", "1단계 · Why"),
        ("step:2:instruction", "2단계 · Instruction"), ("step:2:why", "2단계 · Why"),
    ]
    assert [_section_items(section) for section in wi["sections"]] == [
        [(SPLIT_A, "split", "confirmed", "← OLD-1 §5.1 (나눔)")],
        [(DUPLICATE, "as_is", "confirmed", "← OLD-1 §5.1")],
        [(SPLIT_B, "split", "confirmed", "← OLD-1 §5.1 (나눔)"), ("", "as_is", "on_hold", "← OLD-1 §5.1")],
        [],
    ]
    # 입구 2 문서는 절 경로가 처음 나온 순서로 칸을 만든다
    assert [(s["location_key"], s["label"], s["na_reason"]) for s in match["sections"]] == [
        ("path:1. 라벨", "1. 라벨", None),
    ]
    assert _section_items(match["sections"][0]) == [
        (LABEL, "as_is", "confirmed", "← OLD-2 §5.1"), (NEW_SENTENCE, "new", "confirmed", ""),
    ]

    assert [(d["display_id"], d["doc_code"], d["section"], d["source_text"], d["reason"]) for d in ko["deleted"]] == [
        (d1(OLD1_HEADINGS[0]), "OLD-1", "5", OLD1_HEADINGS[0], HEADING_REASON),
        (d1(OLD1_HEADINGS[1]), "OLD-1", "5.1", OLD1_HEADINGS[1], HEADING_REASON),
        (d1(DELETED), "OLD-1", "5.1", DELETED, DELETE_REASON),
        (d2(OLD2_HEADINGS[0]), "OLD-2", "5", OLD2_HEADINGS[0], HEADING_REASON),
        (d2(OLD2_HEADINGS[1]), "OLD-2", "5.1", OLD2_HEADINGS[1], HEADING_REASON),
    ]
    assert ko["moved"] == [{
        "display_id": d1(MOVED), "doc_code": "OLD-1", "section": "5.1", "source_text": MOVED,
        "move_target_code": MOVE_CODE, "reason": MOVE_REASON,
    }]

    en = _get_output(client, fx.bundle_id, "outputs/c", "en")
    en_sop = {section["location_key"]: section for section in en["docs"][0]["sections"]}
    assert _section_items(en_sop["general_requirements.operation"]) == [
        (RECORDS_EN, "as_is", "confirmed", "← OLD-2 §5.1"),
    ]
    assert [cell["text"] for cell in en_sop["general_requirements"]["items"][0]["children"]] == [
        "Item", "Synthetic value",
    ]
    assert (en["deleted"], en["moved"]) == ([], [])


def test_composed_doc_carries_both_languages_in_c_order(client: TestClient) -> None:
    fx = _setup(client)
    merged_sources = [find_unit(fx.old1, MERGE_1)["id"], find_unit(fx.old2, MERGE_2)["id"]]
    figure_id = next(unit["id"] for unit in fx.old1["units"] if unit["kind"] == "figure")

    sop = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.sop_id}", "en")
    wi = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.wi_id}", "ko")

    assert (sop["code"], sop["entrance"]) == ("SOP-NEW", "assign")
    # 칸은 결과물 C와 같다 - 빈 칸까지 SLOT_KEYS 순서, N/A 사유 그대로
    assert [section["location_key"] for section in sop["sections"]] == list(SLOT_KEYS)
    sections = {section["location_key"]: section for section in sop["sections"]}
    assert sections["scope"]["na_reason"] == SCOPE_REASON
    assert sections["purpose"]["items"] == []
    # 한 칸에 두 언어가 함께, 출처 단위가 실린다 - 칸 이름은 lang의 언어
    assert [(item["text"], item["lang"], item["source_unit_ids"]) for item in sections["general_requirements.operation"]["items"]] == [
        (MERGED, "ko", merged_sources), (RECORDS_EN, "en", [find_unit(fx.old2, RECORDS_EN)["id"]]),
    ]
    assert sections["general_requirements.operation"]["label"] == "General Requirements › Operation"
    # 보류한 그림은 고친 글이 없어 출처 원문(캡션)을 보인다
    (step2,) = [section for section in wi["sections"] if section["location_key"] == "step:2:instruction"]
    assert [(item["text"], item["status"], item["source_unit_ids"]) for item in step2["items"]] == [
        (SPLIT_B, "confirmed", [find_unit(fx.old1, SPLIT_SOURCE)["id"]]), (CAPTION, "on_hold", [figure_id]),
    ]


def test_composed_doc_rejects_other_bundles_and_outsiders(client: TestClient) -> None:
    fx = _setup(client)
    other = create_bundle(client)["id"]

    foreign = client.get(f"/api/bundles/{other}/outputs/c/docs/{fx.sop_id}", params={"lang": "en"}, headers=AUTHOR)
    outsider = client.get(f"/api/bundles/{fx.bundle_id}/outputs/c/docs/{fx.sop_id}", params={"lang": "en"}, headers=REVIEWER)

    assert (foreign.status_code, foreign.json()["detail"]["code"]) == (404, "target_doc_not_found")
    assert (outsider.status_code, outsider.json()["detail"]["code"]) == (404, "bundle_not_found")


# ── 요약 숫자·진행 숫자 ───────────────────────────────────────────────────────


KO_SUMMARY = {
    "old_units": 14, "assigned": 14, "unassigned": 0, "duplicate": 1, "deleted": 5, "moved": 1, "new": 1,
    "translated": 0, "confirmed_rate": 0.9286,
}
EN_SUMMARY = {
    "old_units": 5, "assigned": 4, "unassigned": 1, "duplicate": 0, "deleted": 0, "moved": 0, "new": 0,
    "translated": 0, "confirmed_rate": 0.6,
}
# 줄 기준 — 짝이 없어 단위마다 한 줄이고 표는 칸 넷을 묶어 한 줄이다: OLD-1 10줄(그림 보류·영어 미배정) + OLD-2 5줄.
# 한 언어 글은 두 언어 문서(ko_en_separate)의 짝 없는 문장·제목 13개다(번역 새 문장이 없다)
PROGRESS = {"total": 15, "unassigned": 1, "ai_suggested": 0, "confirmed": 13, "on_hold": 1, "single_language": 13}
EMPTY_PROGRESS = dict.fromkeys(PROGRESS, 0)


def test_summary_numbers(client: TestClient) -> None:
    fx = _setup(client)

    summary = _get_output(client, fx.bundle_id, "summary")

    # 한글: 옛 커버 단위 13 + 그림 1, 그림 보류라 13/14. 영어: 영어 4 + 그림 1, 미배정 1·그림 보류라 3/5
    assert summary == {"ko": KO_SUMMARY, "en": EN_SUMMARY}
    empty = create_bundle(client)["id"]
    zero = {key: 0 for key in KO_SUMMARY} | {"confirmed_rate": 0.0}
    assert _get_output(client, empty, "summary") == {"ko": zero, "en": zero}


def test_progress_in_list_and_overview(client: TestClient) -> None:
    fx = _setup(client)
    empty = create_bundle(client, title="Empty")["id"]
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200

    rows = {row["id"]: row for row in client.get("/api/bundles", headers=AUTHOR).json()}
    reviewer_rows = {row["id"]: row for row in client.get("/api/bundles", headers=REVIEWER).json()}
    admin_rows = {row["id"]: row for row in client.get("/api/admin/bundles", headers=ADMIN).json()}

    assert (rows[fx.bundle_id]["progress"], rows[empty]["progress"]) == (PROGRESS, EMPTY_PROGRESS)
    assert reviewer_rows[fx.bundle_id]["progress"] == PROGRESS
    assert (admin_rows[fx.bundle_id]["progress"], admin_rows[empty]["progress"]) == (PROGRESS, EMPTY_PROGRESS)
    assert get_bundle(client, fx.bundle_id)["progress"] == PROGRESS
    assert get_bundle(client, empty)["progress"] == EMPTY_PROGRESS
    assert PROGRESS["total"] == sum(PROGRESS[status] for status in ("unassigned", "ai_suggested", "confirmed", "on_hold"))


# ── C 순서 바꾸기 ─────────────────────────────────────────────────────────────


def _put_order(client: TestClient, bundle_id: int, body: dict, headers: dict[str, str] = AUTHOR) -> httpx2.Response:
    return client.put(f"/api/bundles/{bundle_id}/targets/order", json=body, headers=headers)


def test_reorder_targets_sets_manual_order(client: TestClient) -> None:
    fx = _setup(client)
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    (split_a,), (duplicate,), (split_b, figure), () = [section["items"] for section in wi["sections"]]
    revision = get_bundle(client, fx.bundle_id)["revision"]
    items = [
        {"target_id": figure["target_id"], "wi_step": 1},
        {"target_id": duplicate["target_id"]},
        {"target_id": split_b["target_id"]},
        {"target_id": split_a["target_id"]},
    ]

    missing = _put_order(client, fx.bundle_id, {"revision": revision, "target_doc_id": fx.wi_id, "items": items[:3]})
    response = _put_order(client, fx.bundle_id, {"revision": revision, "target_doc_id": fx.wi_id, "items": items})

    assert (missing.status_code, missing.json()["detail"]["code"]) == (422, "order_mismatch")
    assert missing.json()["detail"]["missing_target_ids"] == [split_a["target_id"]]
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == revision + 1
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    assert [[item["target_id"] for item in section["items"]] for section in wi["sections"]] == [
        [figure["target_id"], split_a["target_id"]], [duplicate["target_id"]], [split_b["target_id"]], [],
    ]
    events = client.get(f"/api/bundles/{fx.bundle_id}/events", headers=AUTHOR).json()
    assert (events[0]["action"], events[0]["target_type"], events[0]["target_ids"]) == (
        "targets.reorder", "target_doc", [fx.wi_id],
    )

    # 순서를 사람이 정한 문서에 새로 저장한 새 문장은 원문 순서와 무관하게 끝에 온다
    unassigned = find_unit(fx.old1, UNASSIGNED_EN)
    assign_as_is(client, fx.bundle_id, unassigned, fx.wi_id, wi_step=1, wi_part="instruction")
    en_wi = _get_output(client, fx.bundle_id, "outputs/c", "en")["docs"][1]
    assert [item["text"] for item in en_wi["sections"][0]["items"]] == ["", UNASSIGNED_EN]

    stale = _put_order(client, fx.bundle_id, {"revision": revision, "target_doc_id": fx.wi_id, "items": items})
    assert (stale.status_code, stale.json()["detail"]["code"]) == (409, "revision_conflict")


def _list_top_target_ids(client: TestClient, bundle_id: int, doc_index: int) -> list[int]:
    """결과물 C 한 문서의 칸 새 문장이 아닌 새 문장 id — 두 언어판을 합쳐(중립인 표·그림은 한 번) 순서대로."""
    ids: dict[int, None] = {}
    for lang in ("ko", "en"):
        doc = _get_output(client, bundle_id, "outputs/c", lang)["docs"][doc_index]
        ids.update(dict.fromkeys(item["target_id"] for section in doc["sections"] for item in section["items"]))
    return list(ids)


def test_reorder_targets_rejects(client: TestClient) -> None:
    fx = _setup(client)
    assert set_members(client, fx.bundle_id, [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200
    revision = get_bundle(client, fx.bundle_id)["revision"]
    sop = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][0]
    items = [{"target_id": target_id} for target_id in _list_top_target_ids(client, fx.bundle_id, 0)]
    body = {"revision": revision, "target_doc_id": fx.sop_id, "items": items}
    (table,) = next(s["items"] for s in sop["sections"] if s["location_key"] == "general_requirements")
    cell_id = table["children"][0]["target_id"]

    duplicated = _put_order(client, fx.bundle_id, {**body, "items": [*items, items[0]]})
    with_cell = _put_order(client, fx.bundle_id, {**body, "items": [*items, {"target_id": cell_id}]})
    sop_step = _put_order(client, fx.bundle_id, {**body, "items": [{**items[0], "wi_step": 1}, *items[1:]]})
    unknown_doc = _put_order(client, fx.bundle_id, {**body, "target_doc_id": 999_999})
    as_reviewer = _put_order(client, fx.bundle_id, body, headers=REVIEWER)

    assert duplicated.json()["detail"] == {
        "code": "order_mismatch", "missing_target_ids": [], "unknown_target_ids": [],
        "duplicate_target_ids": [items[0]["target_id"]],
    }
    assert with_cell.json()["detail"]["unknown_target_ids"] == [cell_id]  # 칸 새 문장은 표를 따른다
    assert (sop_step.status_code, sop_step.json()["detail"]["code"]) == (422, "wi_step_not_allowed")
    assert (unknown_doc.status_code, unknown_doc.json()["detail"]["code"]) == (404, "target_doc_not_found")
    assert (as_reviewer.status_code, as_reviewer.json()["detail"]["code"]) == (403, "role_required")
    assert get_bundle(client, fx.bundle_id)["revision"] == revision  # 거절은 아무것도 바꾸지 않는다

    wi_items = [{"target_id": target_id} for target_id in _list_top_target_ids(client, fx.bundle_id, 1)]
    undeclared = {"revision": revision, "target_doc_id": fx.wi_id, "items": [{**wi_items[0], "wi_step": 9}, *wi_items[1:]]}
    refused = _put_order(client, fx.bundle_id, undeclared)
    assert (refused.status_code, refused.json()["detail"]) == (
        422, {"code": "unknown_wi_step", "target_ids": [wi_items[0]["target_id"]]},
    )


# ── 큰 묶음의 질의 수 ─────────────────────────────────────────────────────────


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


def test_outputs_use_bounded_queries(client: TestClient) -> None:
    """문단 2,000개 문서에서 절반을 일괄 삭제한 묶음 — 결과물 A와 단위 목록이 단위 수에 비례하는 질의를 내지 않는다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    body = "".join(p(f"합성 문장 {n}번을 확인한다.") for n in range(2000))
    _upload_ready(client, bundle_id, build_docx(body), OLD1_NAME)
    page = client.get(f"/api/bundles/{bundle_id}/units", params={"limit": 1000}, headers=AUTHOR).json()
    _bulk(client, bundle_id, "delete", [{"id": item["unit_id"]} for item in page["items"]], DELETE_REASON)

    with _count_queries() as output_statements:
        rows = _get_output(client, bundle_id, "outputs/a", "ko")
    with _count_queries() as list_statements:
        listed = client.get(f"/api/bundles/{bundle_id}/units", params={"limit": 1000}, headers=AUTHOR)

    assert len(rows) == 2000
    assert sum(row["dest_kind"] == "delete" for row in rows) == 1000
    assert listed.status_code == 200 and len(listed.json()["items"]) == 1000
    assert 0 < len(output_statements) <= 30, len(output_statements)
    assert 0 < len(list_statements) <= 30, len(list_statements)
