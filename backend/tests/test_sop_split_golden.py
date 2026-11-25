"""쪼개기 정답 문서(설계 2026-11-25 §7 R1) — 꼴마다 합성 문서를 Old와 New로 올려, 두 결과가 기대 박스와 같고 서로 같은지 본다.

기대는 `split_golden/G*.json`(글 · 언어 · 종류 · 번호 · 제외)이다. 아직 만들지 않은 규칙의 몫은 PENDING에 두고(strict xfail),
그 규칙을 만드는 브랜치가 제 이름을 뺀다 — 빼지 않으면 xpass로 실패한다.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.sop_helpers import create_bundle, get_view, upload
from tests.split_golden.builder import CASES, Case, build_new_bytes, read_boxes

pytestmark = pytest.mark.usefixtures("clean_sop")

GOLDEN_DIR = Path(__file__).parent / "split_golden"
SIDES = ("old", "new")
# 규칙 → 아직 못 맞는 것. "G01-old" 꼴은 정답 시험, "G11"처럼 쪽이 없는 것은 Old · New가 같은지 보는 시험이다
PENDING: dict[str, frozenset[str]] = {
    "R2": frozenset(
        f"{key}-{side}"
        for key in ("G01", "G02", "G03", "G04", "G06", "G07", "G08", "G09", "G18", "G19", "G21") for side in SIDES
    ) | {"G11-old"},
    "R3": frozenset(f"{key}-{side}" for key in ("G14", "G15", "G16") for side in SIDES),
    "R4": frozenset({"G11-new", "G13-new", "G11", "G13"}),
}


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
    keys = {f"G{n:02d}" for n in range(1, 22)}
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
