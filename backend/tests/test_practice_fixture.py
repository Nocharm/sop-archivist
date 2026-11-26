"""frontend/src/lib/practice/practice-fixture.json must be what the backend answers today, with every practice spot still in place.

The practice screen's fake server starts from this file (practice design §4). The spot test fails when a split-rule change
moves a task's spot (the two-sentence box, the broken sentence, pair D, the contents block, the table, B's suggestion).
"""

import json
from typing import Any

import pytest

from app.dev_users import DEV_USERS
from scripts.dump_practice_fixture import (
    FIRST_DOC_ID,
    MAX_FIXTURE_BYTES,
    MERGE_PIECES,
    NEW_B,
    OUT,
    PAIR_B,
    PAIR_D,
    PRACTICE_BUNDLE_ID,
    SPLIT_KO,
    TOC_LINES,
    render_practice_fixture,
)

FIXTURE_KEYS = {
    "_generated", "bundle", "documents", "views", "units", "tobe", "written", "targets", "candidates", "tableVariants",
}


@pytest.fixture(scope="module")
def rendered() -> str:
    """One build for both tests — it uploads two documents in a child process (a few seconds)."""
    return render_practice_fixture()


def test_practice_fixture_is_current(rendered: str) -> None:
    assert OUT.is_file() and OUT.read_text(encoding="utf-8") == rendered, (
        "The practice fixture is stale (an answer shape or the split rule changed). Regenerate with "
        "`.venv/bin/python -m scripts.dump_practice_fixture`, then run `npx vitest run src/lib/practice` in frontend/."
    )


def test_practice_fixture_spots(rendered: str) -> None:
    fixture = json.loads(rendered)
    assert set(fixture) == FIXTURE_KEYS
    assert len(rendered.encode()) <= MAX_FIXTURE_BYTES, "shorten the practice documents (plan step 1 size budget)"
    old_doc = next(doc for doc in fixture["documents"] if doc["side"] == "old")
    old = fixture["views"][str(old_doc["id"])]
    order = [unit["id"] for unit in old["units"]]

    # Merge (⇧J ⇧J): a sentence broken over two paragraphs is two neighbouring same-language Units outside any pair
    first, second = (_find_unit(old, piece) for piece in MERGE_PIECES)
    assert order.index(second["id"]) == order.index(first["id"]) + 1
    assert first["lang"] == second["lang"] == "ko" and first["pair_id"] is None and second["pair_id"] is None
    # Split (S): one paragraph with two Korean sentences stays one box under split rule 2
    box = _find_unit(old, SPLIT_KO)
    assert box["kind"] == "sentence" and box["lang"] == "ko" and box["pair_id"] is None
    # KO/EN pair (⇧P): pair D's two Units are neighbours in one pair. A fresh upload suggests it (code pair) — that is
    # what the real screen shows, and ⇧P merges a suggested pair the same way (planShapeMode)
    korean, english = (_find_unit(old, text) for text in PAIR_D)
    assert order.index(english["id"]) == order.index(korean["id"]) + 1 and korean["pair_id"] == english["pair_id"]
    (pair,) = [pair for pair in old["pairs"] if pair["id"] == korean["pair_id"]]
    assert pair["unit_ids"] == [korean["id"], english["id"]] and pair["status"] in {"suggested", "confirmed"}
    # Contents (R reason): the contents lines are already deleted as a contents block
    assert all(_find_unit(old, line)["noise_kind"] == "toc" for line in TOC_LINES)

    # Unwrap (⇧T): one table, still a table, and its unwrapped look as the backend made it
    tables = [unit for unit in old["units"] if unit["kind"] == "table"]
    assert len(tables) == 1 and [row["is_layout"] for row in old["tables"]] == [False]
    table_id = str(tables[0]["table_id"])
    assert set(fixture["tableVariants"]) == {table_id}
    wrapped, unwrapped = fixture["tableVariants"][table_id]["wrapped"], fixture["tableVariants"][table_id]["unwrapped"]
    assert wrapped["table"]["is_layout"] is False and unwrapped["table"]["is_layout"] is True
    assert [unit["kind"] for unit in wrapped["units"]].count("table") == 1
    assert "table" not in [unit["kind"] for unit in unwrapped["units"]]
    assert all(unit["group_unit_id"] is None for unit in unwrapped["units"])
    first_pair_ids = {pair["id"] for view in fixture["views"].values() for pair in view["pairs"]}
    assert not first_pair_ids & {pair["id"] for pair in unwrapped["pairs"]}, "unwrapped pairs must not reuse a pair id"

    # Confirm (Enter): B's suggestion cards put New B′ first, for both halves of the pair
    new_doc = next(doc for doc in fixture["documents"] if doc["side"] == "new")
    for old_text, new_text in zip(PAIR_B, NEW_B, strict=True):
        (top, *_) = fixture["candidates"][str(_find_unit(old, old_text)["id"])]
        assert top["text"] == new_text and top["target_doc_id"] == fixture["targets"][str(top["target_id"])]["target_doc_id"]
    assert all(target["target_doc_id"] == fixture["tobe"]["docs"][0]["id"] for target in fixture["targets"].values())
    assert fixture["tobe"]["docs"][0]["document_id"] == new_doc["id"]

    # Nothing is decided or linked yet (design D20)
    assert all(row["decision"]["disposition"] == "unassigned" and row["target_ids"] == [] for row in fixture["units"])
    assert all(sentence["source_unit_ids"] == [] for sentence in fixture["written"])
    assert all(target["source_unit_ids"] == [] for target in fixture["targets"].values())

    # Practice ids and masking (design D3, §4.1-6)
    assert all(doc["id"] >= FIRST_DOC_ID for doc in fixture["documents"])
    assert fixture["bundle"]["id"] == PRACTICE_BUNDLE_ID and fixture["bundle"]["my_role"] == "author"
    assert set(_collect_values(fixture, "bundle_id")) <= {PRACTICE_BUNDLE_ID}
    people = {value for user in DEV_USERS for value in (user.login_id, user.name, user.korean_name)}
    assert not [person for person in people if person in rendered], "a directory person leaked into the fixture"


def _find_unit(view: dict[str, Any], text: str) -> dict[str, Any]:
    (unit,) = [unit for unit in view["units"] if unit["text"] == text]
    return unit


def _collect_values(value: Any, key: str) -> list[Any]:
    """Every value stored under key anywhere in the JSON tree."""
    if isinstance(value, dict):
        return [item for name, child in value.items() for item in ([child] if name == key else _collect_values(child, key))]
    if isinstance(value, list):
        return [item for child in value for item in _collect_values(child, key)]
    return []
