"""쪼개기 정답 문서(설계 2026-11-25 §7 R1) — 꼴마다 합성 문서를 Old와 New로 올려, 두 결과가 기대 박스와 같고 서로 같은지 본다.

기대는 `split_golden/G*.json`(글 · 언어 · 종류 · 번호 · 제외)이다. 아직 만들지 않은 규칙의 몫은 PENDING에 두고(strict xfail),
그 규칙을 만드는 브랜치가 제 이름을 뺀다 — 빼지 않으면 xpass로 실패한다.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.models import Extraction
from app.sop.segment import RULE_PARAGRAPH
from app.sop.units import verify_document_coverage
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, make_grid_table, make_row, p
from tests.sop_helpers import AUTHOR, create_bundle, find_unit, get_view, upload
from tests.split_golden.builder import CASES, STYLES, Case, build_new_bytes, cell, lines, read_boxes

pytestmark = pytest.mark.usefixtures("clean_sop")

GOLDEN_DIR = Path(__file__).parent / "split_golden"
SIDES = ("old", "new")
# 규칙 → 아직 못 맞는 것. "G01-old" 꼴은 정답 시험, "G11"처럼 쪽이 없는 것은 Old · New가 같은지 보는 시험이다
PENDING: dict[str, frozenset[str]] = {}


def _mark(name: str, *values: object) -> object:
    rule = next((rule for rule, names in PENDING.items() if name in names), None)
    marks = [pytest.mark.xfail(strict=True, reason=f"{rule} is not built yet")] if rule else []
    return pytest.param(*values, id=name, marks=marks)


def _upload(client: TestClient, bundle_id: int, case: Case, side: str) -> dict:
    data = case.build() if side == "old" else build_new_bytes(case)
    name = f"SYNTHETIC_{case.key}_{side}.{case.format}"
    response = upload(client, bundle_id, data, name, side=side, doc_type="sop" if side == "new" else None)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return get_view(client, bundle_id, response.json()["id"])


def _load_expected(key: str) -> dict:
    return json.loads((GOLDEN_DIR / f"{key}.json").read_text(encoding="utf-8"))


def test_every_shape_has_an_answer() -> None:
    keys = {f"G{n:02d}" for n in range(1, 23)}
    assert set(CASES) == keys
    assert {path.stem for path in GOLDEN_DIR.glob("*.json")} == keys
    names = {f"{key}-{side}" for key in keys for side in SIDES} | keys
    assert {name for pending in PENDING.values() for name in pending} <= names


@pytest.mark.parametrize(
    ("key", "side"), [_mark(f"{key}-{side}", key, side) for key in sorted(CASES) for side in SIDES],
)
def test_boxes_match_the_answer(client: TestClient, key: str, side: str) -> None:
    expected = _load_expected(key)

    view = _upload(client, create_bundle(client, is_synthetic=True)["id"], CASES[key], side)

    assert read_boxes(view) == expected["boxes"]
    if expected["layout"] is not None:
        assert view["document"]["language_layout"] == expected["layout"]


@pytest.mark.parametrize("key", [_mark(key, key) for key in sorted(CASES)])
def test_old_and_new_give_the_same_boxes(client: TestClient, key: str) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]

    old, new = (_upload(client, bundle_id, CASES[key], side) for side in SIDES)

    assert read_boxes(old) == read_boxes(new)


def test_new_uploads_record_rule_2(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]

    doc_ids = [_upload(client, bundle_id, CASES["G01"], side)["document"]["id"] for side in SIDES]

    async def _read(session: AsyncSession) -> list[int]:
        rows = await session.scalars(select(Extraction.split_rule).where(Extraction.document_id.in_(doc_ids)))
        return list(rows)

    assert run_in_session(_read) == [RULE_PARAGRAPH, RULE_PARAGRAPH] == [2, 2]


LEGACY_BOXES = {
    "G02": [
        ("5. 절차", "ko"), ("탱크를 비운다.", "ko"), ("밸브를 닫는다.", "ko"), ("Drain the tank completely.", "en"),
        ("Close the outlet valve.", "en"),
    ],
    "G04": [("5. 절차", "ko"), ("탱크를 비우고", "ko"), ("잔량을 확인한다.", "ko"), ("결과를 기록한다.", "ko")],
    "G11": [
        ("5. 절차", "ko"), ("5.1 배출 밸브를 모두 닫는다.", "ko"), ("닫힌 것을 확인한다.", "ko"), ("Close all drain valves.", "en"),
        ("Confirm that they are closed.", "en"),
    ],
}


@pytest.mark.usefixtures("legacy_split_rule")
@pytest.mark.parametrize("key", sorted(LEGACY_BOXES))
def test_documents_of_rule_1_keep_their_boxes(client: TestClient, key: str) -> None:
    # 이미 올린 문서(규칙 1)는 문장마다 · 줄마다 그대로이고, 언어 배치를 바꿔도 다시 쪼개지 않는다
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    view = _upload(client, bundle_id, CASES[key], "old")
    before = [(unit["id"], unit["spans"]) for unit in view["units"]]
    assert [(unit["text"], unit["lang"]) for unit in view["units"]] == LEGACY_BOXES[key]

    doc = view["document"]
    response = client.patch(
        f"/api/bundles/{bundle_id}/documents/{doc['id']}",
        json={"revision": doc["revision"], "language_layout": "ko_en_interleaved"}, headers=AUTHOR,
    )

    assert response.status_code == 200, response.text
    assert [(unit["id"], unit["spans"]) for unit in get_view(client, bundle_id, doc["id"])["units"]] == before


def _edit(client: TestClient, bundle_id: int, doc_id: int, op: dict) -> None:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json={"revision": revision, "op": op}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _step(client: TestClient, bundle_id: int, doc_id: int, action: str) -> None:
    revision = get_view(client, bundle_id, doc_id)["document"]["revision"]
    response = client.post(
        f"/api/bundles/{bundle_id}/documents/{doc_id}/edits/{action}", json={"revision": revision}, headers=AUTHOR
    )
    assert response.status_code == 200, response.text


def _shape(view: dict) -> list[tuple]:
    return [(unit["id"], unit["kind"], unit["text"], unit["lang"], unit["spans"], unit["pair_id"]) for unit in view["units"]]


def _upload_body(client: TestClient, body: str) -> tuple[int, int]:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    response = upload(client, bundle_id, build_docx(body, styles=STYLES), "SYNTHETIC_boxes.docx")
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return bundle_id, response.json()["id"]


def test_cell_caption_with_a_second_line_keeps_the_document_editable(client: TestClient) -> None:
    inner = make_grid_table(2, make_row(["탱크", "부피"]) + make_row(["A", "10"]))
    work = cell(p("앞 글이다."), lines("표 1. 조제 조성", "단위는 mL이다."), inner, p("뒤 글이다."))
    bundle_id, doc_id = _upload_body(
        client, p("탱크를 비운다. 밸브를 닫는다.") + make_grid_table(2, make_row(["조제", work])),
    )
    view = get_view(client, bundle_id, doc_id)
    # 캡션 줄은 캡션 하나, 둘째 줄은 제 칸 문장이다
    texts = {(unit["kind"], unit["text"]) for unit in view["units"]}
    assert {("caption", "표 1. 조제 조성"), ("cell_sentence", "단위는 mL이다."), ("cell_sentence", "뒤 글이다.")} <= texts
    box = find_unit(view, "탱크를 비운다. 밸브를 닫는다.")

    _edit(client, bundle_id, doc_id, {"type": "split", "unit_id": box["id"], "at": len("탱크를 비운다.")})

    run_in_session(lambda session: verify_document_coverage(session, doc_id))


WIDE_BOX = "🧪 시약을 준비한다. \u1100\u1161\u11a8을 잰다. ＡＢＣ　밸브를 닫는다. 👩‍🔬 기록한다."
NEXT_BOX = "다음 문단이다. ①🧫 서명한다."


@pytest.mark.parametrize("name", ["split", "merge", "set_heading"])
def test_edits_of_wide_character_boxes_undo_and_redo(client: TestClient, name: str) -> None:
    # 이모지 · 조합 문자(NFD) · 전각이 섞인 여러 문장 박스(규칙 2) — 편집과 되돌리기 · 다시 하기가 같은 모양으로 오간다
    bundle_id, doc_id = _upload_body(client, p(WIDE_BOX) + p(NEXT_BOX))
    before = get_view(client, bundle_id, doc_id)
    assert [unit["text"] for unit in before["units"]] == [WIDE_BOX, NEXT_BOX]
    first, second = (unit["id"] for unit in before["units"])
    op = {
        "split": {"type": "split", "unit_id": first, "at": WIDE_BOX.index("ＡＢＣ")},
        "merge": {"type": "merge", "unit_ids": [first, second]},
        "set_heading": {"type": "set_heading", "unit_ids": [first], "heading": True},
    }[name]

    _edit(client, bundle_id, doc_id, op)

    after = get_view(client, bundle_id, doc_id)
    assert [(unit["kind"], unit["text"]) for unit in after["units"]] == {
        "split": [("sentence", "🧪 시약을 준비한다. \u1100\u1161\u11a8을 잰다."), ("sentence", "ＡＢＣ　밸브를 닫는다. 👩‍🔬 기록한다."),
                  ("sentence", NEXT_BOX)],
        "merge": [("sentence", f"{WIDE_BOX} {NEXT_BOX}")],
        "set_heading": [("heading", WIDE_BOX), ("sentence", NEXT_BOX)],
    }[name]
    run_in_session(lambda session: verify_document_coverage(session, doc_id))
    for _ in range(2):
        _step(client, bundle_id, doc_id, "undo")
        assert _shape(get_view(client, bundle_id, doc_id)) == _shape(before)
        _step(client, bundle_id, doc_id, "redo")
        assert _shape(get_view(client, bundle_id, doc_id)) == _shape(after)
    if name == "set_heading":
        heading = after["units"][0]["id"]
        _edit(client, bundle_id, doc_id, {"type": "set_heading", "unit_ids": [heading], "heading": False})
        assert [unit["text"] for unit in get_view(client, bundle_id, doc_id)["units"]] == [WIDE_BOX, NEXT_BOX]
        _step(client, bundle_id, doc_id, "undo")
        assert _shape(get_view(client, bundle_id, doc_id)) == _shape(after)
    run_in_session(lambda session: verify_document_coverage(session, doc_id))
