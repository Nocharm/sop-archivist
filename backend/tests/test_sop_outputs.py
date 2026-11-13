"""결과물 A·B·C·요약 숫자·C 순서 바꾸기·진행 숫자 — To-Be와 합성 옛 문서 둘, 입구 2 새 문서 하나를 올린 묶음으로 본다.

픽스처 묶음에는 나눔·합침·중복 배정·삭제·이동·데이터 표·그림(보류)·입구 2 짝과 신규·미배정 1건이 모두 있다.
결과물 A 한 벌의 의미 묶음 모서리는 한/영 연달아 옛 문서 하나(`_setup_pair_edges`)에 경우마다 판단을 넣어 본다.
"""

from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from functools import partial
from typing import NamedTuple

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.models import Employee
from app.sop.constants import SLOT_KEYS
from app.sop.models import TargetSentence, UnitDecision, UnitPair, UnitPairMember
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
        (10, "unit", figure, "wi", "WI-01", "as_is", None),
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
        (MERGED, "General Requirements › Operation"),
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
        _target(str(n), fx.sop_id, [unit], slot_key="procedures.procedure") for n, unit in enumerate(units)
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
    (figure_line,) = _group_lines(rows, figure["display_id"])
    assert (figure_line["row_kind"], figure_line["source_text"]) == ("unit", CAPTION)
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
    """입구 2 새 문서의 한/영 짝 중 한쪽만 옛 단위와 맞추면 다른 쪽은 그 옛 줄 묶음 안의 Translated · Added 줄이다(설계 §4.5)."""
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
    assign_as_is(client, bundle_id, first_row, sop_id, slot_key="procedures.procedure")
    # 둘째 행은 한글 칸만 남긴 표 구성 변경 — 영어 칸 문장에는 칸 새 문장이 없다
    kept = find_unit(view, "합성 값 둘.")
    _save(client, bundle_id, [_unit_in(second_row, reason="Synthetic: drop the English cell")], [
        _target("t", sop_id, [second_row], slot_key="procedures.procedure", kind="table", grid={"rows": 1, "cols": 1},
                change_type="table_restructured"),
        _target("c", sop_id, [kept], slot_key="procedures.procedure", parent_key="t", cell_row=0, cell_col=0),
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
    """한쪽만 판단한 제안 짝은 갈 곳 없는 줄 — B에서도 미배정 노드 하나로 가고, 처분 노드 건수는 요약과 같다(설계 §5.1·§5.3)."""
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
    # 한 칸은 언어를 가리지 않는 한 목록 — 한글 합침 문장 뒤에 영어 문장(원문에서 앞선 출처 순)
    operation = sections["general_requirements.operation"]["items"]
    assert _section_items(sections["general_requirements.operation"]) == [
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
    assert [(cell["text"], cell["cell_row"], cell["cell_col"], cell["children"]) for cell in table["children"]] == [
        ("항목", 0, 0, []), ("Item", 0, 1, []), ("합성 값", 1, 0, []), ("Synthetic value", 1, 1, []),
    ]
    table_unit = _unit_of_kind(fx.old1, "table")
    assert {cell["meaning_key"] for cell in table["children"]} == {table["meaning_key"]} == {f"old:-{table_unit['id']}"}
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


# ── 요약 숫자·진행 숫자 ───────────────────────────────────────────────────────


SUMMARY_KEYS = (
    "old_rows", "assigned", "no_destination", "duplicate", "deleted", "moved", "new", "translated", "confirmed_rate",
    "single_language",
)
# 줄 기준 — 짝이 없어 단위마다 한 줄이고 표는 칸 넷을 묶어 한 줄이다: OLD-1 10줄(그림 보류·영어 미배정) + OLD-2 5줄.
# 한 언어 글은 두 언어 문서(ko_en_separate)의 짝 없는 문장·제목 13개다(번역 새 문장이 없다)
PROGRESS = {"total": 15, "unassigned": 1, "ai_suggested": 0, "confirmed": 13, "on_hold": 1, "single_language": 13}
EMPTY_PROGRESS = dict.fromkeys(PROGRESS, 0)


def test_summary_numbers(client: TestClient) -> None:
    fx = _setup(client)

    summary = _get_output(client, fx.bundle_id, "summary")
    progress = get_bundle(client, fx.bundle_id)["progress"]

    # 한 벌 — 판 키가 없다. 줄 15(진행 숫자와 같은 줄), 확정 13(그림 보류·영어 미배정), 배정은 삭제·이동을 포함한다
    assert summary == {
        "old_rows": 15, "assigned": 14, "no_destination": 1, "duplicate": 1, "deleted": 5, "moved": 1, "new": 1,
        "translated": 0, "confirmed_rate": 0.8667, "single_language": 13,
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
    assert summary["no_destination"] >= progress["unassigned"]  # 처분 기준 ⊇ 상태 기준(설계 §5.3)


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
    assert summary["single_language"] == get_bundle(client, fx.bundle_id)["progress"]["single_language"] == 12


def test_translated_added_counts_as_translated_and_new(client: TestClient) -> None:
    """입구 2 한쪽만 맞춘 짝의 출처 없는 쪽(Translated · Added)은 번역과 신규 양쪽에 센다(설계 §4.5)."""
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
