"""결과물 A·B·C·요약 숫자·C 순서 바꾸기·진행 숫자 — To-Be와 합성 옛 문서 둘, 입구 2 새 문서 하나를 올린 묶음으로 본다.

픽스처 묶음에는 나눔·합침·중복 배정·삭제·이동·데이터 표·그림(보류)·입구 2 짝과 신규·미배정 1건이 모두 있다.
결과물 A 한 벌의 의미 묶음 모서리는 한/영 연달아 옛 문서 하나(`_setup_pair_edges`)에 경우마다 판단을 넣어 본다.
"""

import pathlib
import tempfile
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from functools import cache, partial
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.models import Employee
from app.sop.models import TargetSentence, TargetSource, UnitDecision, UnitPair, UnitPairMember
from app.sop.output_labels import LABELS
from app.sop.outputs import BundleCellOut, Lang, Renumbering, _build_index, build_bundle_table, build_renumbering
from app.sop.snapshot import BundleSnapshot, load_bundle_snapshot
from tests.access_helpers import run_in_session
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.sop_helpers import (
    ADMIN,
    AUTHOR,
    NEW_SOP_KEYS,
    REVIEWER,
    WRITTEN_CAPTION,
    assign_as_is,
    build_as_is_targets,
    create_bundle,
    declare_outline_item,
    find_unit,
    get_bundle,
    get_group_by_unit,
    get_view,
    put_tobe,
    save_group,
    set_members,
    upload,
)
from scripts.synthetic_sop import build_synthetic_bundle
from tests.test_sop_pairs import EN_BOTH, EN_ON, KO_KEEP, KO_LOAD, KO_ON

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
# 픽스처 SOP(SOP-NEW)가 내보내는 절 — 새 SOP의 골격에 범주 Work(_setup이 선언)를 더하고, 비어 있는 선택 항목(7.1.x)은 뺀다
SOP_SECTION_KEYS = [
    key
    for base in NEW_SOP_KEYS
    if not base.startswith("document_relationships.associated_documents.")
    for key in ((base, "general_requirements.work") if base == "general_requirements" else (base,))
]
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
    declare_outline_item(client, sop_id, "general_requirements.work", "Work")  # 5장 범주 하나
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
        _target("m", sop_id, [first, second], slot_key="general_requirements.work", text=MERGED),
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
    assign_as_is(client, bundle_id, find_unit(old2, RECORDS_EN), sop_id, slot_key="general_requirements.work")

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

    rows = _get_output(client, fx.bundle_id, "outputs/a", "ko")
    en = _get_output(client, fx.bundle_id, "outputs/a", "en")

    def _shape(rows: list[dict]) -> list[tuple]:
        return [
            (r["row_no"], r["row_kind"], r["display_id"], r["dest_kind"], r["dest_doc_code"], r["change_type"],
             r["group_id"])
            for r in rows
        ]

    # 한 벌 — 두 언어의 줄이 원문 순서로 함께, 의미 묶음(짝이 없어 단위 하나)마다 번호
    assert _shape(rows) == [
        (1, "unit", d1(OLD1_HEADINGS[0]), "delete", "", "deleted", None),
        (2, "unit", d1(OLD1_HEADINGS[1]), "delete", "", "deleted", None),
        (3, "unit", d1(SPLIT_SOURCE), "wi", "WI-01", "split", f"G-{d1(SPLIT_SOURCE)}"),
        (4, "unit", d1(UNASSIGNED_EN), "", "", "", None),
        (5, "unit", d1(MERGE_1), "sop", "SOP-NEW", "merged", f"G-{d1(MERGE_1)}"),
        # 중복 배정은 보낸 곳마다 한 줄 — 같은 묶음
        (6, "unit", d1(DUPLICATE), "sop", "SOP-NEW", "as_is", f"G-{d1(DUPLICATE)}"),
        (6, "unit", d1(DUPLICATE), "wi", "WI-01", "as_is", f"G-{d1(DUPLICATE)}"),
        (7, "unit", d1(DELETED), "delete", "", "deleted", None),
        (8, "unit", d1(MOVED), "move_external", MOVE_CODE, "", None),
        # 표 줄이 칸 문장 줄보다 앞, 칸 문장은 두 언어 모두 한 묶음 안에
        (9, "table", table, "sop", "SOP-NEW", "as_is", None),
        (9, "cell", d1("항목"), "sop", "SOP-NEW", "as_is", None),
        (9, "cell", d1("Item"), "sop", "SOP-NEW", "as_is", None),
        (9, "cell", d1("합성 값"), "sop", "SOP-NEW", "as_is", None),
        (9, "cell", d1("Synthetic value"), "sop", "SOP-NEW", "as_is", None),
        # 그림 줄 뒤에 딸린 캡션 단위 줄 — 같은 묶음
        (10, "unit", figure, "wi", "WI-01", "as_is", None),
        (10, "caption", d1(CAPTION), "wi", "WI-01", "as_is", None),
        (11, "unit", d2(OLD2_HEADINGS[0]), "delete", "", "deleted", None),
        (12, "unit", d2(OLD2_HEADINGS[1]), "delete", "", "deleted", None),
        (13, "unit", d2(MERGE_2), "sop", "SOP-NEW", "merged", f"G-{d1(MERGE_1)}"),
        (14, "unit", d2(LABEL), "sop", "SOP-9", "as_is", None),
        (15, "unit", d2(RECORDS_EN), "sop", "SOP-NEW", "as_is", None),
        # 입구 2 신규 줄은 옛 문장 칸이 빈 채로 끝에
        (16, "new", "", "sop", "SOP-9", "new", None),
    ]
    assert [row["row_kind"] for row in en] == [row["row_kind"] for row in rows]  # 라벨 언어만 다르다

    split = _pick_row(rows, d1(SPLIT_SOURCE))
    assert (split["confirmed_text"], split["dest_location"]) == (
        f"① {SPLIT_A}\n② {SPLIT_B}", "① 1단계 · Instruction\n② 2단계 · Instruction",
    )
    assert (split["source_text"], split["old_doc_code"], split["status"]) == (SPLIT_SOURCE, "OLD-1", "confirmed")
    assert (split["location"]["section"], split["location"]["place"]) == ("5.1", "문단")
    assert split["confirmed_at"].endswith("+09:00")
    merged = [row for row in rows if row["change_type"] == "merged"]
    assert [(row["confirmed_text"], row["dest_location"]) for row in merged] == [
        (MERGED, "General Requirements › Work"),
    ] * 2
    duplicate_rows = [row for row in rows if row["display_id"] == d1(DUPLICATE)]
    assert [(row["dest_location"], row["remark"]) for row in duplicate_rows] == [
        ("Responsibilities", DUPLICATE_REASON), ("1단계 · Why", DUPLICATE_REASON),
    ]
    moved = _pick_row(rows, d1(MOVED))
    assert (moved["remark"], moved["confirmed_text"], moved["status"]) == (MOVE_REASON, "", "confirmed")
    table_row = _pick_row(rows, table)
    assert (table_row["source_text"], table_row["location"]["place"], table_row["confirmed_text"]) == (
        "[표 1, 2×2]", "표 1", "",
    )
    assert _pick_row(rows, d1("합성 값"))["location"]["place"] == "표 1 · 2행 1열"
    assert _pick_row(en, d1("Item"))["location"]["place"] == "Table 1 · R 1 C 2"
    assert _pick_row(en, table)["source_text"] == "[Table 1, 2×2]"
    # 그림 줄은 한 번, 보류 상태 그대로
    figure_row = _pick_row(rows, figure)
    assert (figure_row["status"], figure_row["source_text"]) == ("on_hold", CAPTION)
    assert _pick_row(en, figure)["dest_location"] == "Step 2 · Instruction"
    assert _pick_row(rows, d1(UNASSIGNED_EN))["status"] == "unassigned"
    label_row = _pick_row(rows, d2(LABEL))
    # 입구 2 문서의 위치는 새 문서의 실제 절, 제목은 파일 이름에서 읽은 것
    assert (label_row["dest_location"], label_row["dest_doc_title"]) == ("1. 라벨", "SYNTHETIC Outputs")
    new_row = rows[-1]
    assert (new_row["unit_id"], new_row["source_text"], new_row["confirmed_text"], new_row["is_group_start"]) == (
        None, "", NEW_SENTENCE, True,
    )
    assert (new_row["dest_location"], new_row["status"], new_row["location"]["section"]) == ("1. 라벨", "confirmed", "")


def test_output_a_old_groups_equal_old_rows_and_every_cover_unit_appears_once(client: TestClient) -> None:
    fx = _setup(client)

    rows = _get_output(client, fx.bundle_id, "outputs/a")
    progress = get_bundle(client, fx.bundle_id)["progress"]

    old = [r for r in rows if r["row_kind"] in ("unit", "table", "cell") or (r["row_kind"] == "translation" and r["unit_id"])]
    assert max(r["row_no"] for r in old) == progress["total"]
    assert [r["row_no"] for r in rows if r["is_group_start"]] == list(range(1, len({r["row_no"] for r in rows}) + 1))
    cover = Counter(r["display_id"] for r in rows if r["row_kind"] in ("unit", "cell"))
    assert cover[_display(fx.old1, DUPLICATE)] == 2  # 중복 배정은 보낸 곳마다
    assert all(count == 1 for display_id, count in cover.items() if display_id != _display(fx.old1, DUPLICATE))
    assert Counter(r["row_kind"] for r in rows)["table"] == 1
    assert sum(r["source_text"] == "" and r["row_kind"] == "unit" for r in rows) == 0


def _group_lines(rows: list[dict], display_id: str) -> list[dict]:
    """그 옛 단위 줄이 든 의미 묶음의 줄 전부 — 줄 순서 그대로."""
    (row_no,) = {r["row_no"] for r in rows if r["display_id"] == display_id and r["row_kind"] in ("unit", "table", "cell")}
    return [r for r in rows if r["row_no"] == row_no]


def test_human_written_other_language_sentence_is_a_translation_line(client: TestClient) -> None:
    """영어 옛 문장 하나 → 같은 SOP 칸에 영어 + 한글 새 문장(한 저장). 한글은 ①②가 아니라 같은 묶음의 번역 줄이다."""
    fx = _setup(client)
    en = find_unit(fx.old1, UNASSIGNED_EN)
    _save(client, fx.bundle_id, [_unit_in(en)], [
        _target("en", fx.sop_id, [en], slot_key="purpose"),
        _target("ko", fx.sop_id, [en], slot_key="purpose", lang="ko", text=SPLIT_SOURCE),
    ])

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    unit_line, translation_line = _group_lines(rows, en["display_id"])
    assert (unit_line["change_type"], unit_line["confirmed_text"]) == ("as_is", UNASSIGNED_EN)  # ①② 아님, split 아님
    assert (translation_line["row_kind"], translation_line["source_text"], translation_line["change_type"]) == (
        "translation", "", "translated",
    )
    assert (translation_line["confirmed_text"], translation_line["unit_id"]) == (SPLIT_SOURCE, en["id"])
    assert unit_line["row_no"] == translation_line["row_no"] and not translation_line["is_group_start"]
    # 번역 줄은 AI 번역과 같은 종류다 — 관계 묶음(나눔·합침·중복 배정)이 아니다
    assert (unit_line["group_id"], translation_line["group_id"]) == (None, None)


# ── A 의미 묶음 모서리 — 한/영 연달아 옛 문서 ─────────────────────────────────


PAIR_NAME = "SYNTHETIC_OLD-7_PairEdges.docx"
LONE = "합성 홀로 문장을 둔다."
LONE_EN = "Keep the synthetic lone sentence."
PAIR_TABLE = [["항목", "Item"], ["합성 값", "Synthetic value"]]
PAIR_EDGE_BODY = (
    p(KO_ON) + p(EN_ON) + p(f"{KO_LOAD} {KO_KEEP}") + p(EN_BOTH) + p(LONE) + tbl(PAIR_TABLE)
    + f"<w:p>{make_drawing_run('image1.png')}</w:p>" + p(CAPTION, "Caption")
)


class PairFixture(NamedTuple):
    bundle_id: int
    sop_id: int
    wi_id: int
    doc_id: int
    view: dict


def _setup_pair_edges(client: TestClient) -> PairFixture:
    """To-Be(SOP-NEW·WI-01)와 한/영 연달아 옛 문서 하나 — 1:1 제안 짝·1:2 제안 짝·짝 없는 문장·데이터 표·그림. 판단은 테스트마다 넣는다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS, wi_steps=WI_STEPS)
    assert response.status_code == 200, response.text
    codes = {doc["code"]: doc["id"] for doc in response.json()["docs"]}
    doc = _upload_ready(client, bundle_id, build_docx(PAIR_EDGE_BODY, media={"image1.png": TINY_PNG}), PAIR_NAME)
    view = get_view(client, bundle_id, doc["id"])
    ids = {text: find_unit(view, text)["id"] for text in (KO_ON, EN_ON, KO_LOAD, KO_KEEP, EN_BOTH)}
    assert sorted(sorted(pair["unit_ids"]) for pair in view["pairs"]) == sorted([
        sorted([ids[KO_ON], ids[EN_ON]]), sorted([ids[KO_LOAD], ids[KO_KEEP], ids[EN_BOTH]]),
    ])
    assert find_unit(view, LONE)["pair_id"] is None
    return PairFixture(bundle_id, codes["SOP-NEW"], codes["WI-01"], doc["id"], view)


def _units(fx: PairFixture, *texts: str) -> list[dict]:
    return [find_unit(fx.view, text) for text in texts]


def _unit_of_kind(view: dict, kind: str) -> dict:
    (unit,) = [unit for unit in view["units"] if unit["kind"] == kind]
    return unit


def test_a_pair_split_across_documents_is_two_groups(client: TestClient) -> None:
    fx = _setup_pair_edges(client)
    ko, en = _units(fx, KO_ON, EN_ON)
    _save(client, fx.bundle_id, [_unit_in(ko), _unit_in(en)], [
        _target("ko", fx.sop_id, [ko], slot_key="purpose"),
        _target("en", fx.wi_id, [en], wi_step=1, wi_part="instruction"),
    ])

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    # 짝은 다른 새 문서로 가면 풀린다(pair_settle) — 두 줄이 따로 묶음
    ko_line, en_line = _pick_row(rows, ko["display_id"]), _pick_row(rows, en["display_id"])
    assert ko_line["row_no"] != en_line["row_no"]
    assert (ko_line["is_group_start"], en_line["is_group_start"]) == (True, True)
    assert (ko_line["dest_doc_code"], en_line["dest_doc_code"]) == ("SOP-NEW", "WI-01")


def test_ko_only_link_leaves_the_english_line(client: TestClient) -> None:
    fx = _setup_pair_edges(client)
    ko, en = _units(fx, KO_ON, EN_ON)
    body = {
        "action": "confirm", "units": [_unit_in(ko)], "targets": [_target("ko", fx.sop_id, [ko], slot_key="purpose")],
        "release_unit_ids": [en["id"]],
    }
    assert save_group(client, fx.bundle_id, body).status_code == 200

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    ko_line, en_line = _pick_row(rows, ko["display_id"]), _pick_row(rows, en["display_id"])
    assert ko_line["row_no"] != en_line["row_no"]
    assert _group_lines(rows, en["display_id"]) == [en_line]
    assert (en_line["dest_kind"], en_line["dest_doc_code"], en_line["status"]) == ("", "", "unassigned")


def test_delete_plus_new_are_two_groups(client: TestClient) -> None:
    fx = _setup_pair_edges(client)
    (lone,) = _units(fx, LONE)
    _bulk(client, fx.bundle_id, "delete", [lone], DELETE_REASON)
    new_doc = _upload_ready(client, fx.bundle_id, build_docx(p(NEW_SENTENCE)), NEW_NAME, side="new", doc_type="sop")
    (fresh,) = _load_targets(new_doc["target_doc_id"])
    _save(client, fx.bundle_id, [], [{"key": "n", "id": fresh["id"], "revision": fresh["revision"], "source_unit_ids": []}])

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    (deleted,) = _group_lines(rows, lone["display_id"])
    assert (deleted["dest_kind"], deleted["confirmed_text"], deleted["remark"]) == ("delete", "", DELETE_REASON)
    (new,) = [row for row in rows if row["row_kind"] == "new"]
    assert (new["row_no"], new["is_group_start"]) == (max(row["row_no"] for row in rows), True)
    assert new["row_no"] > deleted["row_no"]
    assert (new["confirmed_text"], new["change_type"], new["dest_doc_code"]) == (NEW_SENTENCE, "new", "SOP-9")


def test_one_to_two_pair_is_three_lines_in_one_group(client: TestClient) -> None:
    fx = _setup_pair_edges(client)
    units = _units(fx, KO_LOAD, KO_KEEP, EN_BOTH)
    _save(client, fx.bundle_id, [_unit_in(unit) for unit in units], [
        _target(str(n), fx.sop_id, [unit], slot_key="procedures.p1") for n, unit in enumerate(units)
    ])

    lines = _group_lines(_get_output(client, fx.bundle_id, "outputs/a"), units[0]["display_id"])

    assert [line["display_id"] for line in lines] == [unit["display_id"] for unit in units]
    assert [line["is_group_start"] for line in lines] == [True, False, False]
    assert [line["confirmed_text"] for line in lines] == [KO_LOAD, KO_KEEP, EN_BOTH]
    assert {line["status"] for line in lines} == {"confirmed"}


def test_unpaired_sentence_is_a_one_line_group(client: TestClient) -> None:
    fx = _setup_pair_edges(client)
    (lone,) = _units(fx, LONE)
    assign_as_is(client, fx.bundle_id, lone, fx.sop_id, slot_key="purpose")

    (line,) = _group_lines(_get_output(client, fx.bundle_id, "outputs/a"), lone["display_id"])

    assert (line["row_kind"], line["is_group_start"], line["confirmed_text"]) == ("unit", True, LONE)


def _add_ai_translation(bundle_id: int, sop_id: int, source_unit_id: int, text: str) -> None:
    """AI 번역 새 문장(기원 translation)을 가짜 AI 경로 없이 넣는다 — 결과물 A는 기원·출처 단위만 본다."""

    async def _insert(session: AsyncSession) -> None:
        session.add(TargetSentence(
            bundle_id=bundle_id, target_doc_id=sop_id, slot_key="purpose", lang="en", kind="sentence", ai_text=text,
            origin="translation", translation_source_unit_id=source_unit_id, change_type="translated",
            status="ai_suggested",
        ))
        await session.commit()

    run_in_session(_insert)


def test_ai_translation_line_follows_its_source(client: TestClient) -> None:
    fx = _setup_pair_edges(client)
    (lone,) = _units(fx, LONE)
    assign_as_is(client, fx.bundle_id, lone, fx.sop_id, slot_key="purpose")
    _add_ai_translation(fx.bundle_id, fx.sop_id, lone["id"], LONE_EN)

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    unit_line, translation_line = _group_lines(rows, lone["display_id"])
    assert rows.index(translation_line) == rows.index(unit_line) + 1
    assert (translation_line["row_kind"], translation_line["unit_id"], translation_line["source_text"]) == (
        "translation", lone["id"], "",
    )
    assert (translation_line["ai_text"], translation_line["change_type"], translation_line["status"]) == (
        LONE_EN, "translated", "ai_suggested",
    )


def test_figure_and_data_table_once(client: TestClient) -> None:
    fx = _setup_pair_edges(client)
    table, figure = _unit_of_kind(fx.view, "table"), _unit_of_kind(fx.view, "figure")
    assign_as_is(client, fx.bundle_id, table, fx.sop_id, slot_key="general_requirements")
    assign_as_is(client, fx.bundle_id, figure, fx.wi_id, wi_step=1, wi_part="instruction")

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    table_group = _group_lines(rows, table["display_id"])
    assert [line["row_kind"] for line in table_group] == ["table", "cell", "cell", "cell", "cell"]
    assert [line["source_text"] for line in table_group[1:]] == [text for row in PAIR_TABLE for text in row]
    figure_line, caption_line = _group_lines(rows, figure["display_id"])
    assert (figure_line["row_kind"], figure_line["source_text"]) == ("unit", CAPTION)
    assert (caption_line["row_kind"], caption_line["display_id"]) == ("caption", find_unit(fx.view, CAPTION)["display_id"])
    assert Counter(row["display_id"] for row in rows)[figure["display_id"]] == 1


def test_layout_table_cells_are_sentences(client: TestClient) -> None:
    """레이아웃 표의 칸 문장은 자기 판단을 가진 문장이라 표 줄 없이 행마다 한/영 짝 묶음이다."""
    fx = _setup_pair_edges(client)
    table = _unit_of_kind(fx.view, "table")
    edit = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits",
        json={"revision": fx.view["document"]["revision"], "confirm": False,
              "op": {"type": "set_layout_table", "table_id": table["table_id"], "is_layout": True}},
        headers=AUTHOR,
    )
    assert edit.status_code == 200, edit.text
    view = get_view(client, fx.bundle_id, fx.doc_id)

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    assert {"table", "cell"}.isdisjoint(row["row_kind"] for row in rows)
    for ko_text, en_text in PAIR_TABLE:
        ko, en = find_unit(view, ko_text), find_unit(view, en_text)
        lines = _group_lines(rows, ko["display_id"])
        assert [(line["row_kind"], line["display_id"]) for line in lines] == [
            ("unit", ko["display_id"]), ("unit", en["display_id"]),
        ]


def test_suggested_pair_is_one_group(client: TestClient) -> None:
    """한쪽만 판단한 제안 짝은 풀리지 않는다 — 두 줄이 한 묶음, 상태는 줄마다 자기 값."""
    fx = _setup_pair_edges(client)
    ko, en = _units(fx, KO_ON, EN_ON)
    assign_as_is(client, fx.bundle_id, ko, fx.sop_id, slot_key="purpose")
    assert {pair["status"] for pair in get_view(client, fx.bundle_id, fx.doc_id)["pairs"]} == {"suggested"}

    lines = _group_lines(_get_output(client, fx.bundle_id, "outputs/a"), ko["display_id"])

    assert [(line["display_id"], line["status"]) for line in lines] == [
        (ko["display_id"], "confirmed"), (en["display_id"], "unassigned"),
    ]
    assert [line["is_group_start"] for line in lines] == [True, False]


def test_mixed_language_unit_is_one_line(client: TestClient) -> None:
    """한/영을 합친 단위 하나는 한 줄이다 — 번역 줄로 나뉘지 않는다."""
    fx = _setup_pair_edges(client)
    ko, en = _units(fx, KO_ON, EN_ON)
    merged = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{fx.doc_id}/edits",
        json={"revision": fx.view["document"]["revision"], "confirm": False,
              "op": {"type": "merge", "unit_ids": [ko["id"], en["id"]]}},
        headers=AUTHOR,
    )
    assert merged.status_code == 200, merged.text
    (unit,) = [u for u in get_view(client, fx.bundle_id, fx.doc_id)["units"] if KO_ON in u["text"] and EN_ON in u["text"]]
    assign_as_is(client, fx.bundle_id, unit, fx.sop_id, slot_key="purpose")

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    (line,) = _group_lines(rows, unit["display_id"])
    assert (line["source_text"], line["confirmed_text"], line["change_type"]) == (unit["text"], unit["text"], "as_is")
    assert "translation" not in {row["row_kind"] for row in rows}


def _upload_lone_pair_doc(client: TestClient, fx: PairFixture) -> tuple[dict, dict, dict]:
    """입구 2 새 문서(LONE·LONE_EN 한/영 짝)를 올린다 — (옛 LONE 단위, 새 문서 LONE 새 문장, 새 문서 LONE_EN 새 문장)."""
    (lone,) = _units(fx, LONE)
    new_doc = _upload_ready(
        client, fx.bundle_id, build_docx(p(LONE) + p(LONE_EN)), NEW_NAME, side="new", doc_type="sop",
    )
    assert len(get_view(client, fx.bundle_id, new_doc["id"])["pairs"]) == 1  # 새 문서 쪽 한/영 짝이어야 한다
    targets = {target["text"]: target for target in _load_targets(new_doc["target_doc_id"])}
    return lone, targets[LONE], targets[LONE_EN]


def test_one_side_matched_new_pair_is_translated_added_line(client: TestClient) -> None:
    """입구 2 새 문서의 한/영 짝 중 한쪽만 옛 단위와 맞추면 다른 쪽은 그 옛 줄 묶음 안의 Translated · Added 줄이다(제품 명세 §7.13 줄 규칙 (4))."""
    fx = _setup_pair_edges(client)
    lone, linked, _added = _upload_lone_pair_doc(client, fx)
    _save(client, fx.bundle_id, [_unit_in(lone)], [
        {"key": "l", "id": linked["id"], "revision": linked["revision"], "source_unit_ids": [lone["id"]]},
    ])

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    unit_line, added_line = _group_lines(rows, lone["display_id"])
    assert (unit_line["dest_doc_code"], unit_line["confirmed_text"]) == ("SOP-9", LONE)
    assert (added_line["row_kind"], added_line["change_type"], added_line["confirmed_text"]) == (
        "new", "translated_added", LONE_EN,
    )
    assert (added_line["source_text"], added_line["unit_id"], added_line["display_id"], added_line["old_doc_code"]) == (
        "", None, "", "",
    )
    assert [row for row in rows if row["confirmed_text"] == LONE_EN] == [added_line]  # 끝 신규 묶음에는 없다


def test_translated_added_remark_joins_the_old_group_remark(client: TestClient) -> None:
    """출처 없는 Translated · Added 새 문장의 remark는 신규 묶음이 없으니 맞춘 옛 묶음의 Remark 끝에 붙는다."""
    fx = _setup_pair_edges(client)
    lone, linked, added = _upload_lone_pair_doc(client, fx)
    _save(client, fx.bundle_id, [_unit_in(lone, reason="Synthetic: reason A")], [
        {"key": "l", "id": linked["id"], "revision": linked["revision"], "source_unit_ids": [lone["id"]],
         "remark": "Synthetic linked remark"},
        {"key": "n", "id": added["id"], "revision": added["revision"], "source_unit_ids": [],
         "remark": "Synthetic added remark"},
    ])

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    lines = _group_lines(rows, lone["display_id"])
    assert [(line["row_kind"], line["change_type"]) for line in lines][1:] == [("new", "translated_added")]
    assert {line["remark"] for line in lines} == {
        "Synthetic: reason A\nSynthetic linked remark\nSynthetic added remark",
    }
    assert [row for row in rows if row["confirmed_text"] == LONE_EN] == [lines[1]]  # 신규 묶음으로 새지 않는다


def test_remark_joins_reasons_and_target_remarks(client: TestClient) -> None:
    fx = _setup_pair_edges(client)
    ko, en = _units(fx, KO_ON, EN_ON)
    _save(client, fx.bundle_id, [_unit_in(ko, reason="Synthetic: reason A"), _unit_in(en, reason="Synthetic: reason B")], [
        _target("ko", fx.sop_id, [ko], slot_key="purpose", remark="Synthetic remark"),
        _target("en", fx.sop_id, [en], slot_key="purpose", remark="Synthetic remark"),
    ])

    lines = _group_lines(_get_output(client, fx.bundle_id, "outputs/a"), ko["display_id"])

    assert len(lines) == 2
    assert {line["remark"] for line in lines} == {"Synthetic: reason A\nSynthetic: reason B\nSynthetic remark"}


def _set_confirmed_by(unit_id: int, login_id: str) -> None:
    run_in_session(lambda session: _update_confirmed_by(session, unit_id, login_id))


async def _update_confirmed_by(session: AsyncSession, unit_id: int, login_id: str) -> None:
    await session.execute(update(UnitDecision).where(UnitDecision.unit_id == unit_id).values(confirmed_by=login_id))
    await session.commit()


def _add_employee(login_id: str, name: str, korean_name: str, *, active: bool) -> None:
    async def _insert(session: AsyncSession) -> None:
        session.add(Employee(login_id=login_id, name=name, korean_name=korean_name, source="dev", active=active))
        await session.commit()

    run_in_session(_insert)


def _load_employee_name(login_id: str) -> str:
    async def _load(session: AsyncSession) -> str:
        return (await session.get_one(Employee, login_id)).name

    return run_in_session(_load)


@pytest.mark.usefixtures("clean_directory")
def test_confirmed_by_shows_name_and_id(client: TestClient) -> None:
    fx = _setup_pair_edges(client)
    ko, lone = _units(fx, KO_ON, LONE)
    table, figure = _unit_of_kind(fx.view, "table"), _unit_of_kind(fx.view, "figure")
    for unit in (ko, lone, table, figure):
        assign_as_is(client, fx.bundle_id, unit, fx.sop_id, slot_key="purpose")
    _add_employee("retired.user", "Retired Person", "퇴직자", active=False)
    _add_employee("korean.only", "", "한글 이름", active=True)
    _set_confirmed_by(lone["id"], "ghost.user")
    _set_confirmed_by(figure["id"], "retired.user")
    _set_confirmed_by(table["id"], "korean.only")

    rows = _get_output(client, fx.bundle_id, "outputs/a")

    assert _pick_row(rows, ko["display_id"])["confirmed_by"] == f"{_load_employee_name('qa.member')} (qa.member)"
    assert _pick_row(rows, lone["display_id"])["confirmed_by"] == "ghost.user"  # 디렉터리에 없다
    assert _pick_row(rows, figure["display_id"])["confirmed_by"] == "retired.user"  # 퇴직은 ID만
    assert _pick_row(rows, table["display_id"])["confirmed_by"] == "한글 이름 (korean.only)"  # 이름이 비면 한글 이름
    en_line = _pick_row(rows, _units(fx, EN_ON)[0]["display_id"])
    assert en_line["confirmed_by"] is None  # 아직 확정하지 않은 줄


def test_output_a_table_lines_for_rows_empty_tables_and_dropped_cells(client: TestClient) -> None:
    """행으로 나눈 표는 행마다 표 줄, 칸 문장이 없는 표는 한 줄, 칸 새 문장이 빠진 칸 문장은 표의 보낸 곳을 글 없이 따른다."""
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
    assign_as_is(client, bundle_id, first_row, sop_id, slot_key="procedures.p1")
    # 둘째 행은 한글 칸만 남긴 표 구성 변경 — 영어 칸 문장에는 칸 새 문장이 없다
    kept = find_unit(view, "합성 값 둘.")
    _save(client, bundle_id, [_unit_in(second_row, reason="Synthetic: drop the English cell")], [
        _target("t", sop_id, [second_row], slot_key="procedures.p1", kind="table", grid={"rows": 1, "cols": 1},
                change_type="table_restructured"),
        _target("c", sop_id, [kept], slot_key="procedures.p1", parent_key="t", cell_row=0, cell_col=0),
        _target("cap", sop_id, [], slot_key="procedures.p1", parent_key="t", text="합성 표 둘째 행", lang="ko"),
    ])
    d = partial(_display, view)

    rows = _get_output(client, bundle_id, "outputs/a", "ko")
    en = _get_output(client, bundle_id, "outputs/a", "en")

    def _shape(rows: list[dict]) -> list[tuple]:
        return [
            (r["row_no"], r["row_kind"], r["display_id"], r["source_text"], r["location"]["place"], r["dest_doc_code"],
             r["change_type"], r["confirmed_text"])
            for r in rows
        ]

    assert _shape(rows) == [
        (1, "table", empty_table["display_id"], "[표 1, 1×2]", "표 1", "", "", ""),
        (2, "table", first_row["display_id"], "[표 2, 1×2]", "표 2 · 1행", "SOP-NEW", "as_is", ""),
        (2, "cell", d("합성 값 하나."), "합성 값 하나.", "표 2 · 1행 1열", "SOP-NEW", "as_is", "합성 값 하나."),
        (2, "cell", d("Value one."), "Value one.", "표 2 · 1행 2열", "SOP-NEW", "as_is", "Value one."),
        (3, "table", second_row["display_id"], "[표 2, 1×2]", "표 2 · 2행", "SOP-NEW", "table_restructured", ""),
        # 칸 문장 줄의 변경 종류는 자기 칸 새 문장의 것, 칸 새 문장이 빠진 칸은 표의 것을 글 없이
        (3, "cell", d("합성 값 둘."), "합성 값 둘.", "표 2 · 2행 1열", "SOP-NEW", "as_is", "합성 값 둘."),
        (3, "cell", d("Value two."), "Value two.", "표 2 · 2행 2열", "SOP-NEW", "table_restructured", ""),
    ]
    assert _pick_row(en, d("Value two."))["location"]["place"] == "Table 2 · R 2 C 2"
    assert _pick_row(en, second_row["display_id"])["source_text"] == "[Table 2, 1×2]"
    assert {r["remark"] for r in rows if r["row_no"] == 3} == {"Synthetic: drop the English cell"}
    # 요약은 줄로 센다 — 빈 표 하나와 행 둘이 세 줄이고 칸 문장은 따로 세지 않는다
    summary = _get_output(client, bundle_id, "summary")
    assert summary["old_rows"] == get_bundle(client, bundle_id)["progress"]["total"] == 3


def test_output_a_defaults_to_english_labels_and_needs_membership(client: TestClient) -> None:
    """?lang=은 라벨 언어만 고른다(없으면 en) — 내용은 한 벌이다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    _upload_ready(client, bundle_id, build_docx(p(SPLIT_SOURCE)), OLD1_NAME)

    default = _get_output(client, bundle_id, "outputs/a")
    ko = _get_output(client, bundle_id, "outputs/a", "ko")
    wrong = client.get(f"/api/bundles/{bundle_id}/outputs/a", params={"lang": "neutral"}, headers=AUTHOR)
    outsider = client.get(f"/api/bundles/{bundle_id}/outputs/a", headers=REVIEWER)

    assert [row["location"]["place"] for row in default] == ["Paragraph"]
    assert [row["location"]["place"] for row in ko] == ["문단"]
    assert wrong.status_code == 422
    assert (outsider.status_code, outsider.json()["detail"]["code"]) == (404, "bundle_not_found")
    assert _get_output(client, create_bundle(client)["id"], "outputs/a") == []


# ── B 흐름 ───────────────────────────────────────────────────────────────────


def test_output_b_counts_rows(client: TestClient) -> None:
    fx = _setup(client)
    old1, old2 = f"old:{fx.old1['document']['id']}", f"old:{fx.old2['document']['id']}"
    sop, wi, match = f"target:{fx.sop_id}", f"target:{fx.wi_id}", f"target:{fx.match_id}"

    graph = _get_output(client, fx.bundle_id, "outputs/b")
    ko = _get_output(client, fx.bundle_id, "outputs/b", "ko")

    # 한 벌 — 줄(짝이 없어 판단 단위 하나, 표는 칸 넷을 묶어 한 줄)마다 한 번, 나눔은 한 번, 중복 배정은 보낸 곳마다 한 번
    assert [(e["source"], e["target"], e["count"]) for e in graph["edges"]] == [
        (old1, sop, 3), (old1, wi, 3), (old1, "delete", 3), (old1, "move_external", 1), (old1, "unassigned", 1),
        (old2, sop, 2), (old2, match, 1), (old2, "delete", 2),
    ]
    assert [(n["id"], n["kind"], n["label"], n["count"]) for n in graph["nodes"]] == [
        (old1, "old", "OLD-1", 10), (old2, "old", "OLD-2", 5),
        (sop, "sop", "SOP-NEW", 5), (wi, "wi", "WI-01", 3), (match, "sop", "SOP-9", 1),
        ("delete", "delete", "Deleted", 5), ("move_external", "move_external", "Moved to another document", 1),
        ("unassigned", "unassigned", "Unassigned", 1),
    ]
    # 옛 문서 노드 건수의 합은 진행 숫자의 줄 수다
    assert sum(n["count"] for n in graph["nodes"] if n["kind"] == "old") == get_bundle(client, fx.bundle_id)["progress"]["total"]
    # lang은 라벨만 바꾼다
    assert [(n["id"], n["count"]) for n in ko["nodes"]] == [(n["id"], n["count"]) for n in graph["nodes"]]
    assert {n["label"] for n in ko["nodes"] if n["kind"] in ("delete", "move_external", "unassigned")} == {
        "삭제", "다른 문서로 이동", "미배정",
    }


def _add_cross_document_pair(unit_ids: list[int], document_id: int) -> None:
    """두 옛 문서에 걸친 짝을 DB에 바로 넣는다 — API는 한 문서 안에서만 짝을 맺지만(드묾) 결과물은 그런 짝도 한 줄로 센다."""

    async def _insert(session: AsyncSession) -> None:
        pair = UnitPair(document_id=document_id, status="confirmed", source="human")
        session.add(pair)
        await session.flush()
        session.add_all(UnitPairMember(pair_id=pair.id, unit_id=unit_id) for unit_id in unit_ids)
        await session.commit()

    run_in_session(_insert)


def test_b_counts_a_cross_document_pair_under_its_first_unit(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    ko_doc = _upload_ready(client, bundle_id, build_docx(p(KO_ON)), OLD1_NAME)
    en_doc = _upload_ready(client, bundle_id, build_docx(p(EN_ON)), OLD2_NAME)
    ko = find_unit(get_view(client, bundle_id, ko_doc["id"]), KO_ON)
    en = find_unit(get_view(client, bundle_id, en_doc["id"]), EN_ON)
    for unit in (ko, en):
        assign_as_is(client, bundle_id, unit, sop_id, slot_key="purpose")
    _add_cross_document_pair([ko["id"], en["id"]], ko_doc["id"])

    graph = _get_output(client, bundle_id, "outputs/b")

    # 짝 하나가 한 줄 — 묶음의 첫 단위(한글 문서)의 문서 노드에 1, 영어 문서 노드는 0이라 그리지 않는다
    assert [(n["id"], n["count"]) for n in graph["nodes"]] == [(f"old:{ko_doc['id']}", 1), (f"target:{sop_id}", 1)]
    assert [(e["source"], e["target"], e["count"]) for e in graph["edges"]] == [
        (f"old:{ko_doc['id']}", f"target:{sop_id}", 1),
    ]
    assert get_bundle(client, bundle_id)["progress"]["total"] == 1


def test_b_follows_the_row_disposition_of_the_summary(client: TestClient) -> None:
    """한쪽만 판단한 제안 짝은 갈 곳 없는 줄 — B에서도 미배정 노드 하나로 가고, 처분 노드 건수는 요약과 같다(제품 명세 §7.13 B·요약 숫자)."""
    fx = _setup_pair_edges(client)
    ko, en = _units(fx, KO_ON, EN_ON)
    assign_as_is(client, fx.bundle_id, ko, fx.sop_id, slot_key="purpose")
    assert {pair["status"] for pair in get_view(client, fx.bundle_id, fx.doc_id)["pairs"]} == {"suggested"}
    _bulk(client, fx.bundle_id, "delete", _units(fx, LONE), DELETE_REASON)
    _bulk(client, fx.bundle_id, "move_external", [_unit_of_kind(fx.view, "figure")], MOVE_REASON, move_target_code=MOVE_CODE)

    graph = _get_output(client, fx.bundle_id, "outputs/b")
    summary = _get_output(client, fx.bundle_id, "summary")

    # 줄: 한쪽만 판단한 짝·판단 없는 1:2 짝·표는 갈 곳 없음, 홀로 문장은 삭제, 그림은 이동 — 한글 새 문장이 있어도 새 문서로 잇지 않는다
    old = f"old:{fx.doc_id}"
    assert [(e["source"], e["target"], e["count"]) for e in graph["edges"]] == [
        (old, "delete", 1), (old, "move_external", 1), (old, "unassigned", 3),
    ]
    counts = {n["id"]: n["count"] for n in graph["nodes"]}
    assert f"target:{fx.sop_id}" not in counts
    assert (counts["delete"], counts["move_external"], counts["unassigned"]) == (
        summary["deleted"], summary["moved"], summary["no_destination"],
    ) == (1, 1, 3)
    assert counts[old] == summary["old_rows"] == get_bundle(client, fx.bundle_id)["progress"]["total"]


# ── C 새 문서 ────────────────────────────────────────────────────────────────


def _section_items(section: dict) -> list[tuple]:
    return [(item["text"], item["change_type"], item["status"], item["source_note"]) for item in section["items"]]


def test_output_c_one_list_per_slot(client: TestClient) -> None:
    fx = _setup(client)
    d1, d2 = partial(_display, fx.old1), partial(_display, fx.old2)

    output = _get_output(client, fx.bundle_id, "outputs/c")

    sop, wi, match = output["docs"]
    assert [(doc["code"], doc["doc_type"], doc["parent_code"], doc["entrance"]) for doc in output["docs"]] == [
        ("SOP-NEW", "sop", None, "assign"), ("WI-01", "wi", "SOP-NEW", "assign"), ("SOP-9", "sop", None, "match"),
    ]
    # SOP 칸은 골격 순서로 빈 필수 항목까지(비어 있는 선택 항목 7.1.x는 빠진다), N/A 상위 칸의 하위 칸도 N/A(R8)
    assert [section["location_key"] for section in sop["sections"]] == SOP_SECTION_KEYS
    sections = {section["location_key"]: section for section in sop["sections"]}
    assert {key: section["na_reason"] for key, section in sections.items() if section["na_reason"]} == {
        "scope": SCOPE_REASON,
        "document_relationships": RELATIONS_REASON,
        "document_relationships.associated_documents": RELATIONS_REASON,
        "document_relationships.work_instructions": RELATIONS_REASON,
        "document_relationships.references": RELATIONS_REASON,
    }
    assert sections["procedures.p1"]["label"] == "Procedures › Procedure 1"
    # 7장이 N/A라 덮인 자동 목록 절(7.2)도 자식 WI를 싣지 않는다 — 화면이 사유만 보이는 것과 같다(싣는 경우는 test_sop_outline)
    assert {key: section["auto_items"] for key, section in sections.items() if section["auto_items"]} == {}
    assert _section_items(sections["responsibilities"]) == [(DUPLICATE, "as_is", "confirmed", "← OLD-1 §5.1")]
    # 한 칸은 언어를 가리지 않는 한 목록 — 한글 합침 문장 뒤에 영어 문장(원문에서 앞선 출처 순)
    operation = sections["general_requirements.work"]["items"]
    assert _section_items(sections["general_requirements.work"]) == [
        (MERGED, "merged", "confirmed", "← OLD-1 §5.1, OLD-2 §5.1 (merged)"),
        (RECORDS_EN, "as_is", "confirmed", "← OLD-2 §5.1"),
    ]
    assert [item["lang"] for item in operation] == ["ko", "en"]  # 글꼴용으로 남는다
    # 굵은 선 묶음 키 — 옛 줄(짝이 없어 -단위 id)마다, 합침은 첫 출처의 줄
    unit_id = {text: find_unit(view, text)["id"] for view, text in ((fx.old1, MERGE_1), (fx.old2, RECORDS_EN))}
    assert [item["meaning_key"] for item in operation] == [f"old:-{unit_id[MERGE_1]}", f"old:-{unit_id[RECORDS_EN]}"]
    (table,) = sections["general_requirements"]["items"]
    assert (table["kind"], table["lang"], table["change_type"], table["source_note"], table["origin"]) == (
        "table", "neutral", "as_is", "← OLD-1 §5.1", "units",
    )
    cells = [child for child in table["children"] if child["cell_row"] is not None]
    assert [(cell["text"], cell["cell_row"], cell["cell_col"], cell["children"]) for cell in cells] == [
        ("항목", 0, 0, []), ("Item", 0, 1, []), ("합성 값", 1, 0, []), ("Synthetic value", 1, 1, []),
    ]
    # 캡션 없는 표라 확정하며 써 넣은 캡션 — 칸 좌표 없는 자식이고 칸보다 먼저 온다
    assert [child["text"] for child in table["children"][:1] if child["cell_row"] is None] == [WRITTEN_CAPTION_OUT]
    assert table["caption"] == WRITTEN_CAPTION_OUT
    table_unit = _unit_of_kind(fx.old1, "table")
    assert {cell["meaning_key"] for cell in cells} == {table["meaning_key"]} == {f"old:-{table_unit['id']}"}
    assert sum(len(section["items"]) for section in sop["sections"]) == 4

    # WI는 선언 단계 순으로 단계마다 Instruction·Why, 단계 없는 칸은 없을 때 싣지 않는다
    assert [(s["location_key"], s["label"]) for s in wi["sections"]] == [
        ("step:1:instruction", "Step 1 · Instruction"), ("step:1:why", "Step 1 · Why"),
        ("step:2:instruction", "Step 2 · Instruction"), ("step:2:why", "Step 2 · Why"),
    ]
    assert [_section_items(section) for section in wi["sections"]] == [
        [(SPLIT_A, "split", "confirmed", "← OLD-1 §5.1 (split)")],
        [(DUPLICATE, "as_is", "confirmed", "← OLD-1 §5.1")],
        [(SPLIT_B, "split", "confirmed", "← OLD-1 §5.1 (split)"), ("", "as_is", "on_hold", "← OLD-1 §5.1")],
        [],
    ]
    # 입구 2 문서는 절 경로가 처음 나온 순서로 칸을 만든다
    assert [(s["location_key"], s["label"], s["na_reason"]) for s in match["sections"]] == [
        ("path:1. 라벨", "1. 라벨", None),
    ]
    assert _section_items(match["sections"][0]) == [
        (LABEL, "as_is", "confirmed", "← OLD-2 §5.1"), (NEW_SENTENCE, "new", "confirmed", ""),
    ]
    linked, fresh = match["sections"][0]["items"]
    assert (linked["origin"], linked["meaning_key"]) == ("new_doc", f"old:-{find_unit(fx.old2, LABEL)['id']}")
    assert fresh["origin"] == "new_doc" and fresh["meaning_key"].startswith("new:")

    # 삭제·이동은 줄마다 한 번 — 짝이 없어 단위 하나씩
    assert [(d["display_id"], d["doc_code"], d["section"], d["source_text"], d["reason"]) for d in output["deleted"]] == [
        (d1(OLD1_HEADINGS[0]), "OLD-1", "5", OLD1_HEADINGS[0], HEADING_REASON),
        (d1(OLD1_HEADINGS[1]), "OLD-1", "5.1", OLD1_HEADINGS[1], HEADING_REASON),
        (d1(DELETED), "OLD-1", "5.1", DELETED, DELETE_REASON),
        (d2(OLD2_HEADINGS[0]), "OLD-2", "5", OLD2_HEADINGS[0], HEADING_REASON),
        (d2(OLD2_HEADINGS[1]), "OLD-2", "5.1", OLD2_HEADINGS[1], HEADING_REASON),
    ]
    assert output["moved"] == [{
        "display_id": d1(MOVED), "doc_code": "OLD-1", "section": "5.1", "source_text": MOVED,
        "move_target_code": MOVE_CODE, "reason": MOVE_REASON,
    }]
    # lang은 라벨만 바꾼다 — 같은 항목, 한글 라벨
    ko = _get_output(client, fx.bundle_id, "outputs/c", "ko")
    assert _section_items(ko["docs"][1]["sections"][0]) == [(SPLIT_A, "split", "confirmed", "← OLD-1 §5.1 (나눔)")]
    assert (ko["deleted"], ko["moved"]) == (output["deleted"], output["moved"])


def test_output_c_pair_lines_share_a_meaning_and_one_disposal_line(client: TestClient) -> None:
    """짝의 두 문장은 한 칸에서 영어 먼저 이웃하고 같은 묶음 키다. 짝을 지우면 삭제 목록에 한 줄(구성 단위를 줄바꿈으로)."""
    fx = _setup_pair_edges(client)
    ko, en = _units(fx, KO_ON, EN_ON)
    _save(client, fx.bundle_id, [_unit_in(ko), _unit_in(en)], [
        _target("ko", fx.sop_id, [ko], slot_key="purpose"),
        _target("en", fx.sop_id, [en], slot_key="purpose"),
    ])
    trio = _units(fx, KO_LOAD, KO_KEEP, EN_BOTH)
    _bulk(client, fx.bundle_id, "delete", trio, DELETE_REASON)

    output = _get_output(client, fx.bundle_id, "outputs/c")

    purpose = next(s for s in output["docs"][0]["sections"] if s["location_key"] == "purpose")["items"]
    assert [(item["text"], item["lang"], item["origin"]) for item in purpose] == [
        (EN_ON, "en", "units"), (KO_ON, "ko", "units"),
    ]
    assert {item["meaning_key"] for item in purpose} == {f"old:{ko['pair_id']}"}
    # 절 제목이 없는 문서라 절은 빈 글
    assert output["deleted"] == [{
        "display_id": "\n".join(unit["display_id"] for unit in trio), "doc_code": "OLD-7", "section": "",
        "source_text": "\n".join((KO_LOAD, KO_KEEP, EN_BOTH)), "reason": DELETE_REASON,
    }]


def test_composed_doc_carries_both_languages_in_c_order(client: TestClient) -> None:
    fx = _setup(client)
    merged_sources = [find_unit(fx.old1, MERGE_1)["id"], find_unit(fx.old2, MERGE_2)["id"]]
    figure_id = next(unit["id"] for unit in fx.old1["units"] if unit["kind"] == "figure")

    sop = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.sop_id}", "en")
    wi = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.wi_id}", "ko")
    c_sop = next(doc for doc in _get_output(client, fx.bundle_id, "outputs/c", "en")["docs"] if doc["target_doc_id"] == fx.sop_id)

    assert (sop["code"], sop["entrance"]) == ("SOP-NEW", "assign")
    # 칸은 결과물 C와 같다 - 빈 필수 항목까지 골격 순서, N/A 사유 그대로
    assert [section["location_key"] for section in sop["sections"]] == SOP_SECTION_KEYS
    sections = {section["location_key"]: section for section in sop["sections"]}
    assert sections["scope"]["na_reason"] == SCOPE_REASON
    assert sections["purpose"]["items"] == []
    # 한 칸에 두 언어가 함께, 출처 단위가 실린다 - 칸 안 순서·번호는 같은 lang의 결과물 C 그 문서 그대로, 칸 이름은 lang의 언어
    operation = sections["general_requirements.work"]["items"]
    c_operation = next(s for s in c_sop["sections"] if s["location_key"] == "general_requirements.work")["items"]
    assert [(item["target_id"], item["number"]) for item in operation] == [
        (item["target_id"], item["number"]) for item in c_operation
    ]
    assert sorted((item["text"], item["lang"], item["source_unit_ids"]) for item in operation) == sorted([
        (MERGED, "ko", merged_sources), (RECORDS_EN, "en", [find_unit(fx.old2, RECORDS_EN)["id"]]),
    ])
    assert sections["general_requirements.work"]["label"] == "General Requirements › Work"
    # 보류한 그림은 글이 없고(그림 단위 글자도 비었다) 딸린 캡션 새 문장의 글을 caption으로 싣는다
    (step2,) = [section for section in wi["sections"] if section["location_key"] == "step:2:instruction"]
    assert [(item["text"], item["status"], item["source_unit_ids"], item["caption"]) for item in step2["items"]] == [
        (SPLIT_B, "confirmed", [find_unit(fx.old1, SPLIT_SOURCE)["id"]], None), ("", "on_hold", [figure_id], CAPTION),
    ]


def test_composed_doc_carries_table_cells_and_figure_block(client: TestClient) -> None:
    fx = _setup(client)
    figure_unit = next(unit for unit in fx.old1["units"] if unit["kind"] == "figure")

    sop = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.sop_id}", "en")
    wi = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.wi_id}", "en")

    # 표 줄은 칸 새 문장을 격자 그대로 싣는다(원문 그대로 보낸 표라 확정 글 = 원문 칸 글)
    table = next(item for section in sop["sections"] for item in section["items"] if item["kind"] == "table")
    assert (table["table"]["rows"], table["table"]["cols"]) == (2, 2)
    assert [(cell["row"], cell["col"], cell["text"]) for cell in table["table"]["cells"]] == [
        (0, 0, "항목"), (0, 1, "Item"), (1, 0, "합성 값"), (1, 1, "Synthetic value"),
    ]
    assert table["figure"] is None
    # 그림 줄은 출처 단위의 그림 블록 - 보류여도 이미지는 보인다
    figure = next(item for section in wi["sections"] for item in section["items"] if item["kind"] == "figure")
    assert figure["figure"] == {"document_id": fx.old1["document"]["id"], "block_id": figure_unit["block_id"]}
    assert figure["table"] is None
    sentence = next(item for section in sop["sections"] for item in section["items"] if item["kind"] == "sentence")
    assert (sentence["table"], sentence["figure"]) == (None, None)


def test_composed_doc_keeps_a_translated_cell_on_the_same_position(client: TestClient) -> None:
    fx = _setup(client)
    sop = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.sop_id}", "en")
    table_id = next(item for s in sop["sections"] for item in s["items"] if item["kind"] == "table")["target_id"]
    source_cell = find_unit(fx.old1, "항목")

    async def _insert(session: AsyncSession) -> None:
        # 칸 번역 - 같은 표 아래 같은 (행, 열)에 다른 언어 새 문장이 하나 더
        session.add(TargetSentence(
            bundle_id=fx.bundle_id, target_doc_id=fx.sop_id, slot_key="general_requirements", lang="en", kind="sentence",
            ai_text="Item (EN)", origin="translation", translation_source_unit_id=source_cell["id"],
            change_type="translated", status="ai_suggested", parent_target_id=table_id, cell_row=0, cell_col=0,
        ))
        await session.commit()

    run_in_session(_insert)

    sop = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.sop_id}", "en")

    table = next(item for s in sop["sections"] for item in s["items"] if item["kind"] == "table")["table"]
    same_place = [cell for cell in table["cells"] if (cell["row"], cell["col"]) == (0, 0)]
    assert [cell["text"] for cell in same_place] == ["항목", "Item (EN)"]
    assert len({cell["target_id"] for cell in table["cells"]}) == len(table["cells"]) == 5
    assert (table["rows"], table["cols"]) == (2, 2)


def test_bundle_table_grows_past_a_stale_grid() -> None:
    cells = [
        BundleCellOut(target_id=2, row=1, col=2, lang="en", text="b", status="confirmed"),
        BundleCellOut(target_id=1, row=0, col=0, lang="ko", text="a", status="confirmed"),
    ]

    table = build_bundle_table({"rows": 1, "cols": 1}, cells)

    assert (table.rows, table.cols) == (2, 3)
    assert [cell.target_id for cell in table.cells] == [1, 2]


# ── 캡션 글 ───────────────────────────────────────────────────────────────────


TABLE_CAPTION = "표 3. 운전 조건"
TABLE_CAPTION_EN = "Table 3. Operating conditions"
FIGURE_CAPTION = "그림 2. 로터 장착 위치"
# 새 문서의 첫 표·첫 그림이라 결과물은 1로 다시 매긴다(옛 문서 칸은 원문 번호 그대로)
TABLE_CAPTION_OUT = "표 1. 운전 조건"
TABLE_CAPTION_EN_OUT = "Table 1. Operating conditions"
FIGURE_CAPTION_OUT = "그림 1. 로터 장착 위치"
WRITTEN_CAPTION_OUT = f"Table 1. {WRITTEN_CAPTION}"  # 번호 없이 써 넣은 캡션은 머리 번호를 붙인다
CAPTION_TABLE = [["항목", "값", "단위"], ["온도", "25", "℃"], ["압력", "1", "bar"]]
CAPTIONS_BODY = (
    p("1. 절차", "Heading1") + p(TABLE_CAPTION, "Caption") + tbl(CAPTION_TABLE)
    + f"<w:p>{make_drawing_run('image1.png')}</w:p>" + p(FIGURE_CAPTION, "Caption")
)


class CaptionFixture(NamedTuple):
    bundle_id: int
    sop_id: int
    view: dict


def _setup_captions(client: TestClient) -> CaptionFixture:
    """캡션이 딸린 3×3 표와 그림을 원문 그대로 SOP 일반 요구 사항에 확정한 묶음."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS)
    assert response.status_code == 200, response.text
    sop_id = next(doc["id"] for doc in response.json()["docs"] if doc["code"] == "SOP-NEW")
    doc = _upload_ready(
        client, bundle_id, build_docx(CAPTIONS_BODY, media={"image1.png": TINY_PNG}), "SYNTHETIC_OLD-1_Captions.docx",
    )
    view = get_view(client, bundle_id, doc["id"])
    for kind in ("table", "figure"):
        assign_as_is(client, bundle_id, _unit_of_kind(view, kind), sop_id, slot_key="general_requirements")
    return CaptionFixture(bundle_id, sop_id, view)


def _find_item(doc: dict, kind: str) -> dict:
    return next(item for section in doc["sections"] for item in section["items"] if item["kind"] == kind)


def _add_en_table_caption(fx: CaptionFixture, table_target_id: int) -> None:
    """표 아래 영어 캡션 하나(AI 글만) — 여러 언어 캡션은 한국어·영어 순으로 잇는다."""

    async def _insert(session: AsyncSession) -> None:
        session.add(TargetSentence(
            bundle_id=fx.bundle_id, target_doc_id=fx.sop_id, slot_key="general_requirements", lang="en", kind="sentence",
            ai_text=TABLE_CAPTION_EN, origin="units", change_type="new", status="ai_suggested", parent_target_id=table_target_id,
        ))
        await session.commit()

    run_in_session(_insert)


def test_output_a_table_source_shows_original_caption(client: TestClient) -> None:
    fx = _setup_captions(client)
    table, figure = _unit_of_kind(fx.view, "table"), _unit_of_kind(fx.view, "figure")

    rows = _get_output(client, fx.bundle_id, "outputs/a", "ko")

    # 옛 문서 칸은 원문 캡션 글(표는 뒤에 크기), 캡션 단위는 표·그림 줄 바로 뒤에 캡션 줄로
    table_group = _group_lines(rows, table["display_id"])
    assert [line["row_kind"] for line in table_group] == ["table", "caption"] + ["cell"] * 9
    assert table_group[0]["source_text"] == f"{TABLE_CAPTION} [3×3]"
    caption = table_group[1]
    assert (caption["source_text"], caption["confirmed_text"], caption["location"]["place"]) == (
        TABLE_CAPTION, TABLE_CAPTION_OUT, "문단",
    )
    figure_group = _group_lines(rows, figure["display_id"])
    assert [line["row_kind"] for line in figure_group] == ["unit", "caption"]
    assert [line["source_text"] for line in figure_group] == [FIGURE_CAPTION, FIGURE_CAPTION]
    assert figure_group[1]["confirmed_text"] == FIGURE_CAPTION_OUT


def test_output_c_figure_text_is_its_caption(client: TestClient) -> None:
    fx = _setup_captions(client)

    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]

    # 그림의 글은 캡션 자식(줄마다 자기 확정 글·상태)과 caption 한 글 — 그림 새 문장 자기 글(text)은 비어 있다
    figure = _find_item(sop, "figure")
    assert (figure["text"], figure["caption"]) == ("", FIGURE_CAPTION_OUT)
    assert [(child["text"], child["status"], child["cell_row"]) for child in figure["children"]] == [
        (FIGURE_CAPTION_OUT, "confirmed", None),
    ]


def test_output_c_table_caption_comes_before_cells(client: TestClient) -> None:
    fx = _setup_captions(client)
    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]
    _add_en_table_caption(fx, _find_item(sop, "table")["target_id"])

    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]

    table = _find_item(sop, "table")
    assert table["caption"] == f"{TABLE_CAPTION_OUT}\n{TABLE_CAPTION_EN_OUT}"
    children = [(child["text"] or child["ai_text"], child["cell_row"], child["cell_col"]) for child in table["children"]]
    assert children == [
        (TABLE_CAPTION_OUT, None, None), (TABLE_CAPTION_EN_OUT, None, None),
        *[(text, row, col) for row, line in enumerate(CAPTION_TABLE) for col, text in enumerate(line)],
    ]


def test_composed_and_written_items_carry_caption(client: TestClient) -> None:
    fx = _setup_captions(client)
    sop = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.sop_id}", "en")
    _add_en_table_caption(fx, _find_item(sop, "table")["target_id"])

    sop = _get_output(client, fx.bundle_id, f"outputs/c/docs/{fx.sop_id}", "en")

    # 캡션은 표 격자에 끼지 않고 caption 한 글로(여러 언어는 한국어·영어 순, 확정 글이 없으면 AI 글)
    table, figure = _find_item(sop, "table"), _find_item(sop, "figure")
    assert table["caption"] == f"{TABLE_CAPTION_OUT}\n{TABLE_CAPTION_EN_OUT}"
    assert [cell["text"] for cell in table["table"]["cells"]] == [text for line in CAPTION_TABLE for text in line]
    assert figure["caption"] == FIGURE_CAPTION_OUT


def test_composed_doc_rejects_other_bundles_and_outsiders(client: TestClient) -> None:
    fx = _setup(client)
    other = create_bundle(client)["id"]

    foreign = client.get(f"/api/bundles/{other}/outputs/c/docs/{fx.sop_id}", params={"lang": "en"}, headers=AUTHOR)
    outsider = client.get(f"/api/bundles/{fx.bundle_id}/outputs/c/docs/{fx.sop_id}", params={"lang": "en"}, headers=REVIEWER)

    assert (foreign.status_code, foreign.json()["detail"]["code"]) == (404, "target_doc_not_found")
    assert (outsider.status_code, outsider.json()["detail"]["code"]) == (404, "bundle_not_found")


# ── 요약 숫자·진행 숫자 ───────────────────────────────────────────────────────


SUMMARY_KEYS = (
    "old_rows", "assigned", "no_destination", "duplicate", "deleted", "moved", "new", "translated", "confirmed_rate",
    "single_language",
)
# 줄 기준 — 짝이 없어 단위마다 한 줄이고 표는 칸 넷을 묶어 한 줄이다: OLD-1 10줄(그림 보류·영어 미배정) + OLD-2 5줄.
# 한 언어 글은 두 언어 문서(ko_en_separate)의 짝 없는 문장·제목 13개와 보류(처분은 배정)한 그림의 한글 캡션 하나다(번역 새 문장이 없다)
PROGRESS = {"total": 15, "unassigned": 1, "ai_suggested": 0, "confirmed": 13, "on_hold": 1, "single_language": 14}
EMPTY_PROGRESS = dict.fromkeys(PROGRESS, 0)


def test_summary_numbers(client: TestClient) -> None:
    fx = _setup(client)

    summary = _get_output(client, fx.bundle_id, "summary")
    progress = get_bundle(client, fx.bundle_id)["progress"]

    # 한 벌 — 판 키가 없다. 줄 15(진행 숫자와 같은 줄), 확정 13(그림 보류·영어 미배정), 배정은 삭제·이동을 포함한다
    assert summary == {
        "old_rows": 15, "assigned": 14, "no_destination": 1, "duplicate": 1, "deleted": 5, "moved": 1, "new": 1,
        "translated": 0, "confirmed_rate": 0.8667, "single_language": 14,
    }
    assert set(summary) == set(SUMMARY_KEYS)
    assert summary["old_rows"] == progress["total"]
    assert round(summary["confirmed_rate"] * summary["old_rows"]) == progress["confirmed"]
    assert summary["single_language"] == progress["single_language"]
    c, a = _get_output(client, fx.bundle_id, "outputs/c"), _get_output(client, fx.bundle_id, "outputs/a")
    assert (summary["duplicate"], summary["moved"], summary["new"]) == (1, 1, 1)
    assert summary["deleted"] == len(c["deleted"])  # 줄마다 한 번
    assert summary["moved"] == len(c["moved"])
    assert summary["no_destination"] == sum(
        r["is_group_start"] and r["row_kind"] != "new" and r["dest_kind"] == "" for r in a
    )
    assert summary["no_destination"] >= progress["unassigned"]  # 처분 기준 ⊇ 상태 기준(제품 명세 §7.13 요약 숫자)


def test_human_translation_counts_in_summary(client: TestClient) -> None:
    """영어 옛 문장 하나 → 영어 + 한글 새 문장(한 저장). 사람이 쓴 한글은 번역 줄이라 번역 숫자에 든다."""
    fx = _setup(client)
    en = find_unit(fx.old1, UNASSIGNED_EN)
    _save(client, fx.bundle_id, [_unit_in(en)], [
        _target("en", fx.sop_id, [en], slot_key="purpose"),
        _target("ko", fx.sop_id, [en], slot_key="purpose", lang="ko", text=SPLIT_SOURCE),
    ])

    summary = _get_output(client, fx.bundle_id, "summary")

    assert (summary["translated"], summary["no_destination"], summary["duplicate"]) == (1, 0, 1)
    assert summary["single_language"] == get_bundle(client, fx.bundle_id)["progress"]["single_language"] == 13


def test_single_language_counts_a_one_language_caption(client: TestClient) -> None:
    """캡션은 묶여 있어도 한 언어뿐이면 한 언어 숫자에 든다(표·그림 명세 §3.2) — 묶음이 배정됐을 때만, 다른 언어 새 문장이 생기면 빠진다."""
    caption_text = "그림 1 합성 장비 배치도"
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS[:1])
    assert response.status_code == 200, response.text
    sop_id = response.json()["docs"][0]["id"]
    body = p(KO_ON) + p(EN_ON) + f"<w:p>{make_drawing_run('image1.png')}</w:p>" + p(caption_text, "Caption")
    doc = _upload_ready(client, bundle_id, build_docx(body, media={"image1.png": TINY_PNG}), OLD1_NAME)
    view = get_view(client, bundle_id, doc["id"])
    assert view["document"]["language_layout"] == "ko_en_interleaved"
    figure = next(unit for unit in view["units"] if unit["kind"] == "figure")
    caption = find_unit(view, caption_text)

    def count() -> tuple[int, int]:
        summary = _get_output(client, bundle_id, "summary")
        return summary["single_language"], get_bundle(client, bundle_id)["progress"]["single_language"]

    before = count()
    assign_as_is(client, bundle_id, figure, sop_id, slot_key="purpose")
    assigned = count()

    async def _translate(session: AsyncSession) -> None:
        session.add(TargetSentence(
            bundle_id=bundle_id, target_doc_id=sop_id, slot_key="purpose", lang="en", kind="sentence",
            confirmed_text="Figure 1 Synthetic layout", origin="translation", translation_source_unit_id=caption["id"],
            status="confirmed",
        ))
        await session.commit()

    run_in_session(_translate)

    assert before == (0, 0)
    assert assigned == (1, 1)
    assert count() == (0, 0)


def test_translated_added_counts_as_translated_and_new(client: TestClient) -> None:
    """입구 2 한쪽만 맞춘 짝의 출처 없는 쪽(Translated · Added)은 번역과 신규 양쪽에 센다(제품 명세 §7.13 줄 규칙 (4))."""
    fx = _setup_pair_edges(client)
    lone, linked, _added = _upload_lone_pair_doc(client, fx)
    _save(client, fx.bundle_id, [_unit_in(lone)], [
        {"key": "l", "id": linked["id"], "revision": linked["revision"], "source_unit_ids": [lone["id"]]},
    ])

    summary = _get_output(client, fx.bundle_id, "summary")

    assert (summary["translated"], summary["new"]) == (1, 1)


def test_summary_of_an_empty_bundle(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]

    assert _get_output(client, bundle_id, "summary") == {key: 0 for key in SUMMARY_KEYS} | {"confirmed_rate": 0.0}


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
    wi = _get_output(client, fx.bundle_id, "outputs/c")["docs"][1]
    assert [item["text"] for item in wi["sections"][0]["items"]] == ["", SPLIT_A, UNASSIGNED_EN]

    stale = _put_order(client, fx.bundle_id, {"revision": revision, "target_doc_id": fx.wi_id, "items": items})
    assert (stale.status_code, stale.json()["detail"]["code"]) == (409, "revision_conflict")


def _list_top_target_ids(client: TestClient, bundle_id: int, doc_index: int) -> list[int]:
    """결과물 C 한 문서의 칸 새 문장이 아닌 새 문장 id — 한 벌이라 두 언어가 한 목록에, 순서대로."""
    doc = _get_output(client, bundle_id, "outputs/c")["docs"][doc_index]
    return [item["target_id"] for section in doc["sections"] for item in section["items"]]


def test_figure_target_reorders_between_sentences_like_a_sentence(client: TestClient) -> None:
    """표·그림 새 문장은 문장과 같은 순서 목록으로 문장 사이에 놓이고, 캡션은 칸 새 문장처럼 부모를 따른다(표·그림 명세 §4.3)."""
    fx = _setup(client)
    wi = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]
    (split_a,), (duplicate,), (split_b, figure), () = [section["items"] for section in wi["sections"]]
    (caption,) = figure["children"]  # 보류한 그림에도 딸린 캡션 단위의 캡션 새 문장이 그림 아래 자식이다
    revision = get_bundle(client, fx.bundle_id)["revision"]
    items = [
        {"target_id": duplicate["target_id"]},
        {"target_id": split_b["target_id"]},
        {"target_id": figure["target_id"]},
        {"target_id": split_a["target_id"], "wi_step": 2},
    ]
    body = {"revision": revision, "target_doc_id": fx.wi_id, "items": items}

    with_caption = _put_order(client, fx.bundle_id, {**body, "items": [*items, {"target_id": caption["target_id"]}]})
    response = _put_order(client, fx.bundle_id, body)

    assert with_caption.json()["detail"]["unknown_target_ids"] == [caption["target_id"]]  # 순서 목록에 들지 않는다
    assert response.status_code == 200, response.text
    step_2 = _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]["sections"][2]["items"]
    assert [item["target_id"] for item in step_2] == [split_b["target_id"], figure["target_id"], split_a["target_id"]]
    assert [(child["target_id"], child["text"]) for child in step_2[1]["children"]] == [(caption["target_id"], CAPTION)]


def test_reorder_returns_the_doc_as_c_shows_it(client: TestClient) -> None:
    fx = _setup(client)
    order = _list_top_target_ids(client, fx.bundle_id, 1)  # WI 문서
    revision = get_bundle(client, fx.bundle_id)["revision"]

    response = client.put(
        f"/api/bundles/{fx.bundle_id}/targets/order", params={"lang": "ko"}, headers=AUTHOR,
        json={"revision": revision, "target_doc_id": fx.wi_id, "items": [{"target_id": t} for t in reversed(order)]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["revision"] == revision + 1
    # 번호까지 같은 값 — 화면은 C 전체를 다시 받지 않고 이것으로 그 문서만 바꾼다
    assert response.json()["doc"] == _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]


def test_reorder_doc_labels_default_to_english(client: TestClient) -> None:
    fx = _setup(client)
    order = _list_top_target_ids(client, fx.bundle_id, 1)
    revision = get_bundle(client, fx.bundle_id)["revision"]

    response = _put_order(client, fx.bundle_id, {
        "revision": revision, "target_doc_id": fx.wi_id, "items": [{"target_id": t} for t in order],
    })

    assert response.status_code == 200, response.text
    doc = response.json()["doc"]
    assert doc == _get_output(client, fx.bundle_id, "outputs/c")["docs"][1]
    assert doc != _get_output(client, fx.bundle_id, "outputs/c", "ko")["docs"][1]  # 칸 이름이 언어마다 다르다


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


def _load_places(target_doc_id: int) -> dict[int, tuple[str | None, int, int]]:
    """새 문서의 모든 새 문장(칸 새 문장 포함) — id → (칸, 깊이, revision)."""

    async def _load(session: AsyncSession) -> dict[int, tuple[str | None, int, int]]:
        rows = await session.scalars(select(TargetSentence).where(TargetSentence.target_doc_id == target_doc_id))
        return {row.id: (row.slot_key, row.indent_level, row.revision) for row in rows}

    return run_in_session(_load)


def _items_in(doc: dict, key: str) -> list[dict]:
    """C 문서의 그 location_key 칸 items."""
    return next(section["items"] for section in doc["sections"] if section["location_key"] == key)


def _order_body(client: TestClient, fx: Fixture, doc_index: int, doc_id: int, edits: dict[int, dict]) -> dict:
    """그 문서의 지금 순서 그대로, edits의 줄에만 필드를 더한 순서 저장 본문."""
    items = [{"target_id": t, **edits.get(t, {})} for t in _list_top_target_ids(client, fx.bundle_id, doc_index)]
    return {"revision": get_bundle(client, fx.bundle_id)["revision"], "target_doc_id": doc_id, "items": items}


def test_reorder_moves_a_line_to_another_slot(client: TestClient) -> None:
    fx = _setup(client)
    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]
    (duplicate,) = _items_in(sop, "responsibilities")
    target_id = duplicate["target_id"]
    body = _order_body(client, fx, 0, fx.sop_id, {target_id: {"slot_key": "procedures.p1", "indent_level": 0}})
    before = _load_places(fx.sop_id)[target_id]

    response = _put_order(client, fx.bundle_id, body)

    assert response.status_code == 200, response.text
    out = next(i for i in response.json()["items"] if i["target_id"] == target_id)
    assert out["slot_key"] == "procedures.p1"
    # 글머리 기호가 기본인 4장의 줄이 번호가 기본인 절차로 가면 번호 줄이 된다
    assert (duplicate["number_style"], out["number_style"]) == ("bullet", "numbered")
    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]
    assert _items_in(sop, "responsibilities") == []
    # 절 번호는 골격의 순서 — procedures = 6, 첫 절차 = 6.1
    assert [(i["target_id"], i["number"]) for i in _items_in(sop, "procedures.p1")] == [(target_id, "6.1.1")]
    assert _load_places(fx.sop_id)[target_id] == ("procedures.p1", 0, before[2] + 1)
    assert response.json()["doc"] == sop
    events = client.get(f"/api/bundles/{fx.bundle_id}/events", headers=AUTHOR).json()
    assert (events[0]["action"], events[0]["target_ids"]) == ("targets.reorder", [fx.sop_id])


def test_reorder_slot_move_takes_the_table_cells_and_resets_an_unsent_depth(client: TestClient) -> None:
    fx = _setup(client)
    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]
    line_id = _items_in(sop, "general_requirements.work")[-1]["target_id"]
    (table,) = _items_in(sop, "general_requirements")
    table_id, cell_ids = table["target_id"], [cell["target_id"] for cell in table["children"]]
    assert _put_order(client, fx.bundle_id, _order_body(client, fx, 0, fx.sop_id, {line_id: {"indent_level": 1}})).status_code == 200
    before = _load_places(fx.sop_id)
    assert before[line_id][:2] == ("general_requirements.work", 1)

    edits = {line_id: {"slot_key": "purpose"}, table_id: {"slot_key": "definitions", "indent_level": 2}}
    response = _put_order(client, fx.bundle_id, _order_body(client, fx, 0, fx.sop_id, edits))

    assert response.status_code == 200, response.text
    places = _load_places(fx.sop_id)
    assert places[line_id][:2] == ("purpose", 0)  # 보내지 않은 깊이는 step 옮기기처럼 0
    assert places[table_id][:2] == ("definitions", 2)  # 보낸 깊이는 그 값
    assert {places[c][0] for c in cell_ids} == {"definitions"}  # 칸 새 문장이 표를 따른다
    assert all(places[c][2] == before[c][2] + 1 for c in [table_id, line_id, *cell_ids])
    sop = response.json()["doc"]
    assert [i["target_id"] for i in _items_in(sop, "definitions")] == [table_id]
    assert [i["target_id"] for i in _items_in(sop, "general_requirements")] == []
    assert sop == _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]


def test_reorder_slot_move_rejects(client: TestClient) -> None:
    fx = _setup(client)
    cases = {
        "unknown": (0, fx.sop_id, "nope", "unknown_slot"),
        "null": (0, fx.sop_id, None, "unknown_slot"),
        "na": (0, fx.sop_id, "scope", "na_slot"),
        "na_parent": (0, fx.sop_id, "document_relationships.references", "na_slot"),
        # 묶음 제목(7)과 자동 목록(7.2)은 줄을 받지 않는다 — N/A보다 먼저 걸린다
        "group": (0, fx.sop_id, "document_relationships", "slot_not_assignable"),
        "auto_list": (0, fx.sop_id, "document_relationships.work_instructions", "slot_not_assignable"),
        "wi": (1, fx.wi_id, "purpose", "slot_not_allowed"),
    }
    revision = get_bundle(client, fx.bundle_id)["revision"]
    places = {doc_id: _load_places(doc_id) for doc_id in (fx.sop_id, fx.wi_id, fx.match_id)}
    for name, (doc_index, doc_id, slot_key, code) in cases.items():
        first = _list_top_target_ids(client, fx.bundle_id, doc_index)[0]

        response = _put_order(client, fx.bundle_id, _order_body(client, fx, doc_index, doc_id, {first: {"slot_key": slot_key}}))

        assert (response.status_code, response.json()["detail"]) == (422, {"code": code, "target_ids": [first]}), name
        assert get_bundle(client, fx.bundle_id)["revision"] == revision, name
        assert {d: _load_places(d) for d in places} == places, name


def test_reorder_slot_move_rejects_a_line_of_an_already_written_document(client: TestClient) -> None:
    fx = _setup(client)
    first = _list_top_target_ids(client, fx.bundle_id, 2)[0]

    async def _make_own_origin(session: AsyncSession) -> None:
        await session.execute(update(TargetSentence).where(TargetSentence.id == first).values(origin="units"))
        await session.commit()

    run_in_session(_make_own_origin)  # 입구 2 줄은 늘 new_doc이라 출처 규칙만으로도 거절된다 — 입구 규칙만 보려고 출처를 바꾼다
    written = _get_output(client, fx.bundle_id, "outputs/c")["docs"][2]
    assert written["entrance"] == "match"
    assert next(i for s in written["sections"] for i in s["items"] if i["target_id"] == first)["origin"] == "units"
    revision = get_bundle(client, fx.bundle_id)["revision"]

    response = _put_order(client, fx.bundle_id, _order_body(client, fx, 2, fx.match_id, {first: {"slot_key": "purpose"}}))

    assert (response.status_code, response.json()["detail"]) == (422, {"code": "slot_not_allowed", "target_ids": [first]})
    assert get_bundle(client, fx.bundle_id)["revision"] == revision


def test_reorder_same_slot_keeps_depth_and_revision(client: TestClient) -> None:
    fx = _setup(client)
    sop = _get_output(client, fx.bundle_id, "outputs/c")["docs"][0]
    (line,) = _items_in(sop, "responsibilities")
    line_id = line["target_id"]
    assert _put_order(client, fx.bundle_id, _order_body(client, fx, 0, fx.sop_id, {line_id: {"indent_level": 1}})).status_code == 200
    before = _load_places(fx.sop_id)[line_id]
    assert before[:2] == ("responsibilities", 1)

    response = _put_order(client, fx.bundle_id, _order_body(client, fx, 0, fx.sop_id, {line_id: {"slot_key": "responsibilities"}}))

    assert response.status_code == 200, response.text
    assert _load_places(fx.sop_id)[line_id] == before  # 지금 칸을 보내도 옮김이 아니다 — 깊이도 줄 revision도 그대로


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
    """문단 2,000개 문서에서 절반을 일괄 삭제한 묶음 — 결과물 A·Excel 미리보기와 단위 목록이 단위 수에 비례하는 질의를 내지 않는다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    body = "".join(p(f"합성 문장 {n}번을 확인한다.") for n in range(2000))
    _upload_ready(client, bundle_id, build_docx(body), OLD1_NAME)
    page = client.get(f"/api/bundles/{bundle_id}/units", params={"limit": 1000}, headers=AUTHOR).json()
    _bulk(client, bundle_id, "delete", [{"id": item["unit_id"]} for item in page["items"]], DELETE_REASON)

    with _count_queries() as output_statements:
        rows = _get_output(client, bundle_id, "outputs/a", "ko")
    with _count_queries() as preview_statements:
        preview = _get_output(client, bundle_id, "export/preview")
    with _count_queries() as list_statements:
        listed = client.get(f"/api/bundles/{bundle_id}/units", params={"limit": 1000}, headers=AUTHOR)

    assert len(rows) == 2000
    assert sum(row["dest_kind"] == "delete" for row in rows) == 1000
    assert preview["sheets"][0]["total_rows"] == 2 + 2000  # 상태·머리 줄 + 결과물 A 줄
    assert listed.status_code == 200 and len(listed.json()["items"]) == 1000
    assert 0 < len(output_statements) <= 30, len(output_statements)
    assert 0 < len(preview_statements) <= 30, len(preview_statements)
    assert 0 < len(list_statements) <= 30, len(list_statements)


# --- 표·그림 번호 다시 매기기와 참조 ---

TABLE_3 = "표 3. 운전 조건 (Table 3. Operating conditions)"
TABLE_4 = "Table 4: Rotor limits"
FIGURE_5 = "그림 5. 로터 장착 (Figure 5. Rotor mounting)"
FIGURE_6 = "Fig.6 Lid lock"
REF_TABLE_3 = "운전 조건은 표 3을 따른다."
PLACE_REF = "회전 속도는 아래 표를 따른다."
MISSING_REF = "표 9 참조."
GENERAL = "general_requirements"


@cache
def _read_old_7() -> tuple[str, bytes]:
    """합성 OLD-7(표 3·4, 캡션 없는 표, 그림 5·6, 참조 문장) — 생성이 느려 한 번만 만든다."""
    with tempfile.TemporaryDirectory() as tmp:
        doc = next(doc for doc in build_synthetic_bundle(pathlib.Path(tmp)).documents if "OLD-7" in doc.path.name)
        return doc.path.name, doc.path.read_bytes()


class RenumberFixture(NamedTuple):
    bundle_id: int
    sop_id: int
    wi_id: int
    view: dict


def _setup_old_7(client: TestClient) -> RenumberFixture:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = put_tobe(client, bundle_id, TOBE_DOCS)
    assert response.status_code == 200, response.text
    ids = {doc["code"]: doc["id"] for doc in response.json()["docs"]}
    name, data = _read_old_7()
    doc = _upload_ready(client, bundle_id, data, name)
    return RenumberFixture(bundle_id, ids["SOP-NEW"], ids["WI-01"], get_view(client, bundle_id, doc["id"]))


def _bundle_unit(fx: RenumberFixture, caption: str) -> dict:
    group_unit_id = find_unit(fx.view, caption)["group_unit_id"]
    return next(unit for unit in fx.view["units"] if unit["id"] == group_unit_id)


def _captionless_table(fx: RenumberFixture) -> dict:
    """캡션 없는 데이터 표 — "회전 속도는 아래 표를 따른다."가 올릴 때 이은 표."""
    target_unit_id = find_unit(fx.view, PLACE_REF)["caption_refs"][0]["target_unit_id"]
    return next(unit for unit in fx.view["units"] if unit["id"] == target_unit_id)


def _assign_written(
    client: TestClient, fx: RenumberFixture, unit: dict, text: str, lang: str, slot_key: str = GENERAL,
    change_type: str | None = None,
) -> None:
    """unit을 원문 그대로 보내되 새 문장 글을 text로(문장) 또는 캡션을 text로 써 넣어(묶음) 확정한다."""
    group = get_group_by_unit(client, fx.bundle_id, unit["id"])
    entry = next(member for member in group["units"] if member["unit_id"] == unit["id"])
    targets, caption_ids = build_as_is_targets(client, fx.bundle_id, unit, fx.sop_id, slot_key=slot_key)
    assert not caption_ids
    if unit["kind"] in ("table", "figure"):
        targets.append({
            "key": "caption", "target_doc_id": fx.sop_id, "slot_key": slot_key, "parent_key": "t", "lang": lang,
            "text": text, "source_unit_ids": [],
        })
    else:
        targets[0].update(text=text, lang=lang, change_type=change_type or "rewritten")
    response = save_group(client, fx.bundle_id, {
        "action": "confirm", "units": [{"unit_id": unit["id"], "revision": entry["decision"]["revision"], "disposition": "assigned"}],
        "targets": targets,
    })
    assert response.status_code == 200, response.text


def _renumber(bundle_id: int, lang: Lang = "ko") -> tuple[BundleSnapshot, Renumbering]:
    snap = run_in_session(partial(load_bundle_snapshot, bundle_id=bundle_id))
    return snap, build_renumbering(_build_index(snap), LABELS[lang])


def _target_of(snap: BundleSnapshot, unit_id: int, kind: str | None = None) -> int:
    return next(
        target.id for target in snap.targets.values()
        if unit_id in target.source_unit_ids and (kind is None or target.kind == kind)
    )


def _caption_target_of(snap: BundleSnapshot, parent_id: int) -> int:
    return next(
        target.id for target in snap.targets.values()
        if target.parent_target_id == parent_id and target.cell_row is None
    )


def _codes(renum: Renumbering) -> list[tuple[str, int | None, int]]:
    return [(warning.code, warning.target_id, warning.unit_id) for warning in renum.warnings]


def _assign_main_four(client: TestClient, fx: RenumberFixture) -> dict[str, dict]:
    units = {caption: _bundle_unit(fx, caption) for caption in (TABLE_3, TABLE_4, FIGURE_5, FIGURE_6)}
    for unit in units.values():
        assign_as_is(client, fx.bundle_id, unit, fx.sop_id, slot_key=GENERAL)
    return units


def test_tables_and_figures_renumber_per_document_in_output_order(client: TestClient) -> None:
    fx = _setup_old_7(client)
    units = _assign_main_four(client, fx)

    snap, renum = _renumber(fx.bundle_id)

    table3, table4, figure5, figure6 = (_target_of(snap, units[caption]["id"]) for caption in (TABLE_3, TABLE_4, FIGURE_5, FIGURE_6))
    assert renum.numbers == {table3: 1, table4: 2, figure5: 1, figure6: 2}
    assert renum.texts[_caption_target_of(snap, table3)].startswith("표 1. 운전 조건")
    # 캡션 안의 같은 번호 영문 표기도 같은 번호다
    assert renum.texts[_caption_target_of(snap, table3)] == "표 1. 운전 조건 (Table 1. Operating conditions)"
    assert renum.texts[_caption_target_of(snap, table4)] == "Table 2: Rotor limits"
    assert renum.texts[_caption_target_of(snap, figure6)] == "Fig.2 Lid lock"
    assert renum.changes[table3] == ("표 3", "표 1")
    assert renum.changes[figure6] == ("그림 6", "그림 2")
    assert renum.warnings == ()


def test_reference_sentence_follows_the_new_number(client: TestClient) -> None:
    fx = _setup_old_7(client)
    _assign_main_four(client, fx)
    ref = find_unit(fx.view, REF_TABLE_3)
    assign_as_is(client, fx.bundle_id, ref, fx.sop_id, slot_key=GENERAL)

    snap, renum = _renumber(fx.bundle_id)

    assert renum.texts[_target_of(snap, ref["id"])] == "운전 조건은 표 1을 따른다."
    assert renum.warnings == ()


def test_written_caption_without_number_gets_a_prefix(client: TestClient) -> None:
    fx = _setup_old_7(client)
    assign_as_is(client, fx.bundle_id, _bundle_unit(fx, TABLE_3), fx.sop_id, slot_key=GENERAL)
    captionless = _captionless_table(fx)
    _assign_written(client, fx, captionless, "운전 조건", "ko")

    snap, renum = _renumber(fx.bundle_id)

    table = _target_of(snap, captionless["id"], "table")
    assert renum.numbers[table] == 2
    assert renum.changes[table] == ("", "표 2")
    assert renum.texts[_caption_target_of(snap, table)] == "표 2. 운전 조건"


def test_reference_to_a_deleted_table_is_broken(client: TestClient) -> None:
    fx = _setup_old_7(client)
    table3 = _bundle_unit(fx, TABLE_3)
    _bulk(client, fx.bundle_id, "delete", [table3], DELETE_REASON)
    ref = find_unit(fx.view, REF_TABLE_3)
    assign_as_is(client, fx.bundle_id, ref, fx.sop_id, slot_key=GENERAL)

    snap, renum = _renumber(fx.bundle_id)

    ref_target = _target_of(snap, ref["id"])
    assert _codes(renum) == [("caption_ref_broken", ref_target, ref["id"])]
    assert ref_target not in renum.texts


def test_reference_to_a_table_in_another_document_is_broken(client: TestClient) -> None:
    fx = _setup_old_7(client)
    assign_as_is(client, fx.bundle_id, _bundle_unit(fx, TABLE_3), fx.wi_id, wi_step=None, wi_part="instruction")
    ref = find_unit(fx.view, REF_TABLE_3)
    assign_as_is(client, fx.bundle_id, ref, fx.sop_id, slot_key=GENERAL)

    snap, renum = _renumber(fx.bundle_id)

    assert _codes(renum) == [("caption_ref_broken", _target_of(snap, ref["id"]), ref["id"])]


def test_reference_to_a_missing_number_is_unresolved_and_unassigned_refs_are_silent(client: TestClient) -> None:
    fx = _setup_old_7(client)
    missing = find_unit(fx.view, MISSING_REF)
    assign_as_is(client, fx.bundle_id, missing, fx.sop_id, slot_key=GENERAL)

    snap, renum = _renumber(fx.bundle_id)

    # 표 3 참조 문장은 배정하지 않아(새 문장 없음) 대상 표가 없어도 경고하지 않는다
    assert _codes(renum) == [("caption_ref_unresolved", _target_of(snap, missing["id"]), missing["id"])]
    assert _target_of(snap, missing["id"]) not in renum.texts


def test_ambiguous_reference_is_left_and_warned(client: TestClient) -> None:
    """같은 번호 캡션이 둘이라 대상 없이 남은 참조 — 바꾸지 않고 경고한다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    sop_id = put_tobe(client, bundle_id, TOBE_DOCS).json()["docs"][0]["id"]
    body = (
        p("표 1. 합성 첫 표", "Caption") + tbl([["가", "나"]]) + p("표 1. 합성 둘째 표", "Caption") + tbl([["다", "라"]])
        + p("합성 값은 표 1을 따른다.")
    )
    doc = _upload_ready(client, bundle_id, build_docx(body), "SYNTHETIC_OLD-1_Ambiguous.docx")
    view = get_view(client, bundle_id, doc["id"])
    fx = RenumberFixture(bundle_id, sop_id, 0, view)
    for caption in ("표 1. 합성 첫 표", "표 1. 합성 둘째 표"):
        assign_as_is(client, bundle_id, _bundle_unit(fx, caption), sop_id, slot_key=GENERAL)
    ref = find_unit(view, "합성 값은 표 1을 따른다.")
    assign_as_is(client, bundle_id, ref, sop_id, slot_key=GENERAL)

    snap, renum = _renumber(bundle_id)

    ref_target = _target_of(snap, ref["id"])
    assert _codes(renum) == [("caption_ref_ambiguous", ref_target, ref["id"])]
    assert ref_target not in renum.texts


def test_same_number_refs_to_different_tables_in_one_sentence_are_ambiguous(client: TestClient) -> None:
    """합친 새 문장 하나에 같은 원문 번호 참조 둘이 서로 다른 표를 가리키면(사람이 하나를 다시 이음) 어느 쪽인지 정할 수 없다."""
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    sop_id = put_tobe(client, bundle_id, TOBE_DOCS).json()["docs"][0]["id"]
    body = (
        p("표 1. 합성 첫 표", "Caption") + tbl([["가", "나"]]) + p("표 2. 합성 둘째 표", "Caption") + tbl([["다", "라"]])
        + p("합성 값은 표 1을 본다.") + p("합성 한계도 표 1을 본다.")
    )
    doc = _upload_ready(client, bundle_id, build_docx(body), "SYNTHETIC_OLD-1_Relinked.docx")
    view = get_view(client, bundle_id, doc["id"])
    fx = RenumberFixture(bundle_id, sop_id, 0, view)
    second_table = _bundle_unit(fx, "표 2. 합성 둘째 표")
    for caption in ("표 1. 합성 첫 표", "표 2. 합성 둘째 표"):
        assign_as_is(client, bundle_id, _bundle_unit(fx, caption), sop_id, slot_key=GENERAL)
    first, second = find_unit(view, "합성 값은 표 1을 본다."), find_unit(view, "합성 한계도 표 1을 본다.")
    ref_id = second["caption_refs"][0]["id"]
    revision = get_view(client, bundle_id, doc["id"])["document"]["revision"]
    relinked = client.patch(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}/caption-refs/{ref_id}",
        json={"revision": revision, "target_unit_id": second_table["id"]}, headers=AUTHOR,
    )
    assert relinked.status_code == 200, relinked.text
    _save(client, bundle_id, [_unit_in(first), _unit_in(second)], [
        _target("m", sop_id, [first, second], slot_key=GENERAL, lang="ko", text="합성 값과 한계는 표 1을 본다.",
                change_type="rewritten"),
    ])

    snap, renum = _renumber(bundle_id)

    merged = _target_of(snap, first["id"])
    assert sorted(_codes(renum)) == [
        ("caption_ref_ambiguous", merged, first["id"]), ("caption_ref_ambiguous", merged, second["id"]),
    ]
    assert merged not in renum.texts


def test_edited_text_without_token_is_left_and_warned(client: TestClient) -> None:
    fx = _setup_old_7(client)
    _assign_main_four(client, fx)
    ref = find_unit(fx.view, REF_TABLE_3)
    _assign_written(client, fx, ref, "운전 조건은 위 표를 따른다.", "ko")

    snap, renum = _renumber(fx.bundle_id)

    ref_target = _target_of(snap, ref["id"])
    assert _codes(renum) == [("caption_ref_text_changed", ref_target, ref["id"])]
    assert ref_target not in renum.texts


def test_place_reference_out_of_order_warns(client: TestClient) -> None:
    fx = _setup_old_7(client)
    captionless = _captionless_table(fx)
    place = find_unit(fx.view, PLACE_REF)
    # "아래 표"인데 표가 앞 칸(purpose)으로 갔다
    _assign_written(client, fx, captionless, "회전 속도", "ko", slot_key="purpose")
    assign_as_is(client, fx.bundle_id, place, fx.sop_id, slot_key=GENERAL)

    snap, renum = _renumber(fx.bundle_id)

    assert _codes(renum) == [("caption_ref_order", _target_of(snap, place["id"]), place["id"])]


def test_place_reference_in_order_is_quiet(client: TestClient) -> None:
    fx = _setup_old_7(client)
    place = find_unit(fx.view, PLACE_REF)
    assign_as_is(client, fx.bundle_id, place, fx.sop_id, slot_key=GENERAL)
    _assign_written(client, fx, _captionless_table(fx), "회전 속도", "ko")

    _, renum = _renumber(fx.bundle_id)

    assert renum.warnings == ()


def test_confirmed_text_is_never_rewritten(client: TestClient) -> None:
    fx = _setup_old_7(client)
    table4 = _bundle_unit(fx, TABLE_4)
    assign_as_is(client, fx.bundle_id, table4, fx.sop_id, slot_key=GENERAL)
    ref = find_unit(fx.view, "Table 4 lists the rotor limits.")
    assign_as_is(client, fx.bundle_id, ref, fx.sop_id, slot_key=GENERAL)

    output = _get_output(client, fx.bundle_id, "outputs/c", "ko")
    rows = _get_output(client, fx.bundle_id, "outputs/a", "ko")

    sop = output["docs"][0]
    table = _find_item(sop, "table")
    assert table["caption"] == "Table 1: Rotor limits"
    assert [child["text"] for child in table["children"] if child["cell_row"] is None] == ["Table 1: Rotor limits"]
    assert any(item["text"] == "Table 1 lists the rotor limits." for section in sop["sections"] for item in section["items"])
    caption_line = next(row for row in rows if row["row_kind"] == "caption" and row["source_text"] == TABLE_4)
    # 옛 문서 칸은 원문 번호 그대로, 새 문장 칸만 다시 매긴 번호
    assert (caption_line["source_text"], caption_line["confirmed_text"]) == (TABLE_4, "Table 1: Rotor limits")
    stored = {target["text"] for target in _load_targets(fx.sop_id)}
    assert {TABLE_4, "Table 4 lists the rotor limits."} <= stored
    assert not {"Table 1: Rotor limits", "Table 1 lists the rotor limits."} & stored


def test_composed_doc_shows_renumbered_caption_and_change(client: TestClient) -> None:
    fx = _setup_old_7(client)
    assign_as_is(client, fx.bundle_id, _bundle_unit(fx, TABLE_4), fx.sop_id, slot_key=GENERAL)

    response = client.get(f"/api/bundles/{fx.bundle_id}/outputs/c/docs/{fx.sop_id}", params={"lang": "ko"}, headers=AUTHOR)

    assert response.status_code == 200, response.text
    table = _find_item(response.json(), "table")
    assert table["caption"] == "Table 1: Rotor limits"
    assert table["renumber"] == {"from_label": "표 4", "to_label": "표 1"}


def test_output_c_item_carries_the_same_renumber(client: TestClient) -> None:
    fx = _setup_old_7(client)
    assign_as_is(client, fx.bundle_id, _bundle_unit(fx, TABLE_4), fx.sop_id, slot_key=GENERAL)

    response = client.get(f"/api/bundles/{fx.bundle_id}/outputs/c", params={"lang": "en"}, headers=AUTHOR)

    assert response.status_code == 200, response.text
    items = [item for doc in response.json()["docs"] for section in doc["sections"] for item in section["items"]]
    table = next(item for item in items if item["kind"] == "table")
    assert table["renumber"] == {"from_label": "Table 4", "to_label": "Table 1"}
    assert all(item["renumber"] is None for item in items if item["kind"] == "sentence")


def _upload_small(client: TestClient, body: str, name: str) -> RenumberFixture:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    sop_id = put_tobe(client, bundle_id, TOBE_DOCS).json()["docs"][0]["id"]
    doc = _upload_ready(client, bundle_id, build_docx(body), name)
    return RenumberFixture(bundle_id, sop_id, 0, get_view(client, bundle_id, doc["id"]))


def _add_empty_target(fx: RenumberFixture, unit_id: int) -> int:
    """글이 아직 없는 AI 제안 새 문장 하나를 unit에서 — 글이 없으니 참조를 판정할 것이 없다."""

    async def _insert(session: AsyncSession) -> int:
        target = TargetSentence(
            bundle_id=fx.bundle_id, target_doc_id=fx.sop_id, slot_key=GENERAL, lang="ko", kind="sentence",
            ai_text="", origin="units", change_type="rewritten", status="ai_suggested",
        )
        session.add(target)
        await session.flush()
        session.add(TargetSource(target_id=target.id, unit_id=unit_id, seq=0))
        await session.commit()
        return target.id

    return run_in_session(_insert)


def test_split_reference_warns_only_when_no_piece_keeps_the_token(client: TestClient) -> None:
    fx = _setup_old_7(client)
    assign_as_is(client, fx.bundle_id, _bundle_unit(fx, TABLE_3), fx.sop_id, slot_key=GENERAL)
    ref = find_unit(fx.view, REF_TABLE_3)
    _save(client, fx.bundle_id, [_unit_in(ref)], [
        _target("a", fx.sop_id, [ref], slot_key=GENERAL, lang="ko", text="운전 조건은 표 3을 따른다.", change_type="rewritten"),
        _target("b", fx.sop_id, [ref], slot_key=GENERAL, lang="ko", text="조건을 지킨다.", change_type="rewritten"),
    ])
    empty = _add_empty_target(fx, ref["id"])

    snap, renum = _renumber(fx.bundle_id)

    pieces = {target.confirmed_text: target.id for target in snap.targets.values() if ref["id"] in target.source_unit_ids}
    assert renum.texts[pieces["운전 조건은 표 3을 따른다."]] == "운전 조건은 표 1을 따른다."
    assert pieces["조건을 지킨다."] not in renum.texts and empty not in renum.texts
    assert renum.warnings == ()


def test_reference_without_text_yet_does_not_warn(client: TestClient) -> None:
    fx = _setup_old_7(client)
    assign_as_is(client, fx.bundle_id, _bundle_unit(fx, TABLE_3), fx.sop_id, slot_key=GENERAL)
    _add_empty_target(fx, find_unit(fx.view, REF_TABLE_3)["id"])

    _, renum = _renumber(fx.bundle_id)

    assert renum.warnings == ()


def test_reference_inside_a_table_cell_follows_the_new_number(client: TestClient) -> None:
    fx = _upload_small(client, (
        p("표 3. 합성 첫 표", "Caption") + tbl([["가", "나"]])
        + p("표 4. 합성 둘째 표", "Caption") + tbl([["표 3 참조", "라"]])
    ), "SYNTHETIC_OLD-1_CellRef.docx")
    for caption in ("표 3. 합성 첫 표", "표 4. 합성 둘째 표"):
        assign_as_is(client, fx.bundle_id, _bundle_unit(fx, caption), fx.sop_id, slot_key=GENERAL)
    cell = find_unit(fx.view, "표 3 참조")

    snap, renum = _renumber(fx.bundle_id)

    assert renum.texts[_target_of(snap, cell["id"])] == "표 1 참조"
    assert renum.warnings == ()


def test_english_labels_carry_the_same_numbers(client: TestClient) -> None:
    fx = _setup_old_7(client)
    units = _assign_main_four(client, fx)

    _, ko = _renumber(fx.bundle_id, "ko")
    snap, en = _renumber(fx.bundle_id, "en")

    table3 = _target_of(snap, units[TABLE_3]["id"])
    assert en.numbers == ko.numbers and en.texts == ko.texts
    assert en.changes[table3] == ("Table 3", "Table 1")
    assert en.changes[_target_of(snap, units[FIGURE_6]["id"])] == ("Figure 6", "Figure 2")


def test_unlinked_number_in_the_same_sentence_stays(client: TestClient) -> None:
    fx = _upload_small(client, (
        p("표 3. 합성 표", "Caption") + tbl([["가", "나"]]) + p("합성 값은 표 3 및 표 9를 따른다.")
    ), "SYNTHETIC_OLD-1_Unrelated.docx")
    assign_as_is(client, fx.bundle_id, _bundle_unit(fx, "표 3. 합성 표"), fx.sop_id, slot_key=GENERAL)
    ref = find_unit(fx.view, "합성 값은 표 3 및 표 9를 따른다.")
    assign_as_is(client, fx.bundle_id, ref, fx.sop_id, slot_key=GENERAL)

    snap, renum = _renumber(fx.bundle_id)

    ref_target = _target_of(snap, ref["id"])
    assert renum.texts[ref_target] == "합성 값은 표 1 및 표 9를 따른다."
    assert _codes(renum) == [("caption_ref_unresolved", ref_target, ref["id"])]  # 표 9는 원문에 없다


def _upload_with_figure(client: TestClient, body: str, name: str) -> RenumberFixture:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    sop_id = put_tobe(client, bundle_id, TOBE_DOCS).json()["docs"][0]["id"]
    doc = _upload_ready(client, bundle_id, build_docx(body, media={"image1.png": TINY_PNG}), name)
    return RenumberFixture(bundle_id, sop_id, 0, get_view(client, bundle_id, doc["id"]))


def _figure_unit(fx: RenumberFixture) -> dict:
    return next(unit for unit in fx.view["units"] if unit["kind"] == "figure")


def test_compound_caption_heads_are_left_alone(client: TestClient) -> None:
    # "Table 3-1"·"표 3.2"·"Fig. 4.1"은 장·절 번호 — 머리 3으로 읽어 "Table 1-1"로 바꾸면 안 된다
    fx = _upload_with_figure(client, (
        p("Table 3-1. Flow rates", "Caption") + tbl([["가", "나"]]) + p("표 3.2 운전 조건", "Caption") + tbl([["다", "라"]])
        + f"<w:p>{make_drawing_run('image1.png')}</w:p>" + p("Fig. 4.1 Pump", "Caption") + p("Flow follows Table 3.")
    ), "SYNTHETIC_OLD-1_Compound.docx")
    units = [_bundle_unit(fx, caption) for caption in ("Table 3-1. Flow rates", "표 3.2 운전 조건")] + [_figure_unit(fx)]
    for unit in units:
        assign_as_is(client, fx.bundle_id, unit, fx.sop_id, slot_key=GENERAL)
    ref = find_unit(fx.view, "Flow follows Table 3.")
    assign_as_is(client, fx.bundle_id, ref, fx.sop_id, slot_key=GENERAL)

    snap, renum = _renumber(fx.bundle_id)

    bundles = [_target_of(snap, unit["id"]) for unit in units]
    assert all(bundle in renum.numbers for bundle in bundles)  # 세기는 한다
    assert not {bundle for bundle in bundles} & renum.changes.keys()
    assert not {_caption_target_of(snap, bundle) for bundle in bundles} & renum.texts.keys()
    # 본문 "Table 3"은 "Table 3-1" 캡션에 이어지지 않는다
    ref_target = _target_of(snap, ref["id"])
    assert _codes(renum) == [("caption_ref_unresolved", ref_target, ref["id"])]
    assert ref_target not in renum.texts


def test_bracketed_caption_renumbers_its_own_number_without_a_prefix(client: TestClient) -> None:
    fx = _upload_with_figure(client, (
        p("표 1. 합성 첫 표", "Caption") + tbl([["가", "나"]]) + p("<표 3> 운전 조건", "Caption") + tbl([["다", "라"]])
        + f"<w:p>{make_drawing_run('image1.png')}</w:p>" + p("[그림 2] 배관도", "Caption") + p("운전 조건은 표 3을 따른다.")
    ), "SYNTHETIC_OLD-1_Bracketed.docx")
    units = [_bundle_unit(fx, caption) for caption in ("표 1. 합성 첫 표", "<표 3> 운전 조건")] + [_figure_unit(fx)]
    for unit in units:
        assign_as_is(client, fx.bundle_id, unit, fx.sop_id, slot_key=GENERAL)
    ref = find_unit(fx.view, "운전 조건은 표 3을 따른다.")
    assign_as_is(client, fx.bundle_id, ref, fx.sop_id, slot_key=GENERAL)

    snap, renum = _renumber(fx.bundle_id)

    _, table, figure = (_target_of(snap, unit["id"]) for unit in units)
    assert renum.texts[_caption_target_of(snap, table)] == "<표 2> 운전 조건"
    assert renum.texts[_caption_target_of(snap, figure)] == "[그림 1] 배관도"
    assert renum.changes[table] == ("표 3", "표 2") and renum.changes[figure] == ("그림 2", "그림 1")
    # 본문 "표 3"은 올릴 때 "<표 3>" 캡션의 표에 이어져 같은 번호를 따라간다
    assert renum.texts[_target_of(snap, ref["id"])] == "운전 조건은 표 2을 따른다."
    assert renum.warnings == ()


def test_reference_follows_a_caption_attached_after_upload(client: TestClient) -> None:
    fx = _upload_small(client, (
        p("Rotor values follow Table 3.") + p("표 6 기존", "Caption") + tbl([["합성 칸 하나."]]) + p("Table 3 Test results")
    ), "SYNTHETIC_OLD-1_LateCaption.docx")
    table = next(unit for unit in fx.view["units"] if unit["kind"] == "table")
    doc_id = fx.view["document"]["id"]
    result = client.post(
        f"/api/bundles/{fx.bundle_id}/documents/{doc_id}/edits",
        json={"revision": fx.view["document"]["revision"], "confirm": False,
              "op": {"type": "attach_caption", "unit_id": find_unit(fx.view, "Table 3 Test results")["id"],
                     "bundle_unit_id": table["id"]}},
        headers=AUTHOR,
    )
    assert result.status_code == 200, result.text
    view = get_view(client, fx.bundle_id, doc_id)
    ref = find_unit(view, "Rotor values follow Table 3.")
    assert ref["caption_refs"][0]["target_unit_id"] == table["id"]  # 문서 보기 카드도 같은 표를 보인다
    assign_as_is(client, fx.bundle_id, next(u for u in view["units"] if u["id"] == table["id"]), fx.sop_id, slot_key=GENERAL)
    assign_as_is(client, fx.bundle_id, ref, fx.sop_id, slot_key=GENERAL)

    snap, renum = _renumber(fx.bundle_id)

    assert renum.texts[_target_of(snap, ref["id"])] == "Rotor values follow Table 1."
    assert renum.warnings == ()


MERGE_BODY = (
    p("표 3. 합성 첫 표", "Caption") + tbl([["가", "나"]]) + p("표 4. 합성 둘째 표", "Caption") + tbl([["다", "라"]])
    + p("합성 값은 표 3을 본다.") + p("합성 한계도 표 3을 본다.")
)


def _merge_two_refs(client: TestClient, fx: RenumberFixture, first: dict, second: dict) -> None:
    _save(client, fx.bundle_id, [_unit_in(first), _unit_in(second)], [
        _target("m", fx.sop_id, [first, second], slot_key=GENERAL, lang="ko", text="합성 값과 한계는 표 3을 본다.",
                change_type="rewritten"),
    ])


def test_merged_sentence_with_a_broken_same_number_reference_is_left(client: TestClient) -> None:
    """합친 새 문장의 "표 3" 토큰은 두 출처의 것 — 하나가 지운 표를 가리키면 다른 하나의 번호를 그 토큰에 쓰지 않는다."""
    fx = _upload_small(client, MERGE_BODY, "SYNTHETIC_OLD-1_MergedBroken.docx")
    doc_id = fx.view["document"]["id"]
    first, second = find_unit(fx.view, "합성 값은 표 3을 본다."), find_unit(fx.view, "합성 한계도 표 3을 본다.")
    second_table = _bundle_unit(fx, "표 4. 합성 둘째 표")
    revision = get_view(client, fx.bundle_id, doc_id)["document"]["revision"]
    relinked = client.patch(
        f"/api/bundles/{fx.bundle_id}/documents/{doc_id}/caption-refs/{second['caption_refs'][0]['id']}",
        json={"revision": revision, "target_unit_id": second_table["id"]}, headers=AUTHOR,
    )
    assert relinked.status_code == 200, relinked.text
    _bulk(client, fx.bundle_id, "delete", [second_table], DELETE_REASON)
    assign_as_is(client, fx.bundle_id, _bundle_unit(fx, "표 3. 합성 첫 표"), fx.sop_id, slot_key=GENERAL)
    _merge_two_refs(client, fx, first, second)

    snap, renum = _renumber(fx.bundle_id)

    merged = _target_of(snap, first["id"])
    assert sorted(_codes(renum)) == [
        ("caption_ref_ambiguous", merged, first["id"]), ("caption_ref_broken", merged, second["id"]),
    ]
    assert merged not in renum.texts


def test_merged_sentence_with_a_detached_same_number_reference_is_left(client: TestClient) -> None:
    """뗀 참조는 자기 경고는 없지만, 합친 문장에서 같은 토큰을 나눠 쓰면 다른 참조의 번호로 바꾸지 못하게 막는다."""
    fx = _upload_small(client, MERGE_BODY, "SYNTHETIC_OLD-1_MergedDetached.docx")
    doc_id = fx.view["document"]["id"]
    first, second = find_unit(fx.view, "합성 값은 표 3을 본다."), find_unit(fx.view, "합성 한계도 표 3을 본다.")
    revision = get_view(client, fx.bundle_id, doc_id)["document"]["revision"]
    detached = client.patch(
        f"/api/bundles/{fx.bundle_id}/documents/{doc_id}/caption-refs/{second['caption_refs'][0]['id']}",
        json={"revision": revision, "state": "detached"}, headers=AUTHOR,
    )
    assert detached.status_code == 200, detached.text
    assign_as_is(client, fx.bundle_id, _bundle_unit(fx, "표 3. 합성 첫 표"), fx.sop_id, slot_key=GENERAL)
    _merge_two_refs(client, fx, first, second)

    snap, renum = _renumber(fx.bundle_id)

    merged = _target_of(snap, first["id"])
    assert _codes(renum) == [("caption_ref_ambiguous", merged, first["id"])]
    assert merged not in renum.texts


def test_empty_required_flag(client: TestClient) -> None:
    # Arrange — 목적에만 줄이 있고, 정의는 이름을 바꿨고(표준과 다름), 책임은 N/A인 SOP
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    sop = {"code": "SOP-E", "title": "Synthetic SOP", "doc_type": "sop", "parent_code": None}
    saved = put_tobe(client, bundle_id, [sop], na_slots=[{"code": "SOP-E", "slot_key": "responsibilities", "reason": "Synthetic"}])
    sop_id = saved.json()["docs"][0]["id"]
    uploaded = upload(client, bundle_id, build_docx(p(KO_KEEP)), "SYNTHETIC_OLD-E_Empty.docx")
    assign_as_is(client, bundle_id, find_unit(get_view(client, bundle_id, uploaded.json()["id"]), KO_KEEP), sop_id, slot_key="purpose")
    renamed = client.patch(
        f"/api/bundles/{bundle_id}/tobe/docs/{sop_id}/outline/definitions",
        json={"title_en": "Terms", "reason": "Synthetic: house style"}, headers=AUTHOR,
    )
    assert renamed.status_code == 200, renamed.text

    # Act
    c_doc = next(doc for doc in _get_output(client, bundle_id, "outputs/c")["docs"] if doc["target_doc_id"] == sop_id)
    composed = _get_output(client, bundle_id, f"outputs/c/docs/{sop_id}", "en")

    # Assert — 빈 필수 절과 표준과 다름은 결과물 C와 New 칸(쓰는 중 문서)이 같은 값이다
    flags = {section["location_key"]: (section["is_empty_required"], section["deviation_reason"]) for section in c_doc["sections"]}
    assert flags["purpose"] == (False, None)
    assert flags["scope"] == (True, None)
    assert flags["definitions"] == (True, "Synthetic: house style")
    assert flags["responsibilities"] == (False, None)  # N/A는 비어 있음이 아니다
    assert (flags["procedures"], flags["procedures.p1"]) == ((True, None), (True, None))
    assert flags["document_relationships.work_instructions"] == (True, None)  # 자식 WI가 없는 자동 목록
    assert "document_relationships.associated_documents.form" not in flags  # 빈 선택 항목은 절 자체가 없다
    assert {
        section["location_key"]: (section["is_empty_required"], section["deviation_reason"]) for section in composed["sections"]
    } == flags

    # 하위가 모두 N/A인 묶음 제목은 비어 있음이 아니다(7.1 아래 선택 항목 Form만 N/A로 둔 경우)
    na_slots = [
        {"code": "SOP-E", "slot_key": "responsibilities", "reason": "Synthetic"},
        {"code": "SOP-E", "slot_key": "document_relationships.associated_documents.form", "reason": "Synthetic"},
    ]
    assert put_tobe(client, bundle_id, [sop], na_slots=na_slots).status_code == 200
    c_doc = next(doc for doc in _get_output(client, bundle_id, "outputs/c")["docs"] if doc["target_doc_id"] == sop_id)
    covered = {section["location_key"]: section["is_empty_required"] for section in c_doc["sections"]}
    assert (covered["document_relationships.associated_documents"], covered["document_relationships"]) == (False, True)

    # 자식 WI가 생기면 자동 목록과 그 묶음 제목은 비어 있지 않다
    wi = {"code": "WI-E", "title": "Synthetic WI", "doc_type": "wi", "parent_code": "SOP-E"}
    assert put_tobe(client, bundle_id, [sop, wi], na_slots=[{"code": "SOP-E", "slot_key": "responsibilities", "reason": "Synthetic"}]).status_code == 200
    c_doc = next(doc for doc in _get_output(client, bundle_id, "outputs/c")["docs"] if doc["target_doc_id"] == sop_id)
    after = {section["location_key"]: section["is_empty_required"] for section in c_doc["sections"]}
    assert (after["document_relationships.work_instructions"], after["document_relationships"]) == (False, False)
