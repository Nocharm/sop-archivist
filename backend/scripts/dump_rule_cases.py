"""Write frontend/src/lib/rule-cases.json — inputs and backend answers for the rules the frontend copies.

The frontend keeps copies of a few backend rules to preview before the save answer arrives (caption places, line numbers,
number follow, constants). `tests/test_rule_cases.py` fails when this file is stale and `rule-cases.test.ts` fails when a
frontend copy answers differently, so a rule change on either side breaks CI until both agree.

Run from backend/: `.venv/bin/python -m scripts.dump_rule_cases`
"""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.sop import constants
from app.sop.caption_slot import CAPTION_REACH, PlaceBlock, build_block_places
from app.sop.numbering import MAX_NUMBER_CHARS, MAX_ROW_LEVEL, LevelRow, build_row_levels, plan_follow
from app.sop.outputs import get_bullet_depths, number_lines
from app.sop.unwrap_order import order_unwrapped, order_unwrapped_lines

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "rule-cases.json"

NUMBER_LINES_INPUTS: list[tuple[str, list[int | None]]] = [
    ("5", [0, 0, 1, 1, 2, 0]),
    ("5", [None, 0, 1, None, 1]),
    ("5", [2, 0]),  # first numbered line deeper than 0 reads as 0
    ("5", [0, 3, 3]),  # a jump of more than one level reads as one level
    ("3.2", [0, 1, 2, 1, 0, 1]),
    ("1", []),
    ("1", [None, None]),
    ("7", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
]

PLAN_FOLLOW_INPUTS: list[tuple[list[str | None], int, str]] = [
    (["1", "2", "3"], 0, "4"),
    (["1", "2", "3"], 1, "7"),
    (["1.1", "1.2", "1.3"], 0, "2.1"),
    (["1", "1.1", "1.2", "2"], 1, "1.5"),
    ([None, "2", "3"], 1, "5"),
    (["a)", "b)", "c)"], 0, "d)"),
    (["(1)", "(2)", "(3)"], 0, "(4)"),
    (["A.", "B.", "C."], 1, "F."),
    (["1", "2", "3"], 2, "9"),
    (["1", "2"], 0, "x"),
]

# (number_style, indent_level) per line of one section; bullet lines count apart from numbered ones.
BULLET_INPUTS: list[list[tuple[str, int]]] = [
    [("bullet", 0), ("bullet", 1), ("bullet", 2), ("bullet", 3)],
    [("bullet", 2), ("bullet", 2)],  # first bullet line reads as 0
    [("bullet", 0), ("numbered", 3), ("bullet", 1), ("omitted", 0), ("bullet", 2)],
    [("numbered", 0), ("note", 1), ("bullet", 1)],
]

# (unit id, unwrap_seq, source position) per line of one unwrapped table block, given out of source order on purpose.
UNWRAP_ORDER_INPUTS: list[list[tuple[int, int | None, int]]] = [
    [(1, None, 0), (2, None, 1), (3, None, 2)],  # never reordered: source order
    [(1, 2, 0), (2, 0, 1), (3, 1, 2)],  # reordered
    [(1, 1, 0), (4, None, 1), (5, None, 2), (3, 0, 3)],  # lines still without a value borrow the line before them
    [(4, None, 0), (2, 0, 1), (3, 1, 2)],  # nothing to borrow at the top: before every set line
    [(3, 0, 2), (1, None, 0), (2, 1, 1)],  # positions decide the borrowing, not list order
    [(1, 1, 0), (2, 2, 1), (6, 0, 2), (7, 0, 3)],  # split pieces inherit the moved line's value: they stay on top in source order
    [(1, 2, 0), (7, 0, 1), (5, 1, 3)],  # a join keeps the first joined line's value
    [(1, 0, 0), (2, 0, 1), (3, None, 2)],  # stale equal values keep source order
]

# Items in the order on screen: (id, line unit or None, block of that line or None); lines' seqs. Items of one line move together.
UNWRAP_LINES_INPUTS: list[tuple[list[tuple[int, int | None, int | None]], dict[int, int]]] = [
    (
        [(10, None, None), (20, 20, 7), (21, 21, 7), (30, 30, 7), (31, 30, 7), (32, 30, 7), (22, 22, 7), (50, 50, 7),
         (40, 40, 7), (41, 41, 7)],
        {40: 0, 20: 1, 21: 2, 30: 3, 22: 4, 50: 5, 41: 6},
    ),
    (
        [(20, 20, 7), (21, 21, 7), (31, 31, 8), (32, 32, 8), (22, 22, 7)],  # an inner unwrapped table keeps its slots
        {22: 0, 20: 1, 21: 2, 32: 0},
    ),
]

# Paper rows in order: (number label, indent_shift, has a number cell, index of the pair card's first row or None).
ROW_LEVEL_INPUTS: list[list[tuple[str, int, bool, int | None]]] = [
    [("5", 0, True, None), ("5.1", 0, True, None), ("•", 0, True, None), ("", 0, True, None), ("", -1, True, None)],
    [("", 0, True, None), ("○", 0, True, None), ("▪", 2, True, None), ("", 1, True, None), ("", 0, False, None)],
    [("3", 0, True, None), ("가.", 0, True, None), ("", 2, True, None), ("4", 0, True, None), ("", 0, True, 3), ("•", 9, True, None)],
    [("1.2.3.4.5.6.7.8.9", 0, True, None), ("•", 0, True, None), ("", -9, True, None), ("2", 5, True, None)],
]

# Blank-text judgment must match segment.is_blank_char: Python str.isspace() plus INVISIBLE_CHARS.
BLANK_SAMPLES = ["", " ", "\t\n", "　", " ", "​", "﻿", "⁠", "\x1c", "\x85", "᠎", "a", " ​가"]


def _place_case(blocks: list[dict[str, Any]], tables: list[dict[str, Any]]) -> dict[str, Any]:
    parent_of = {table["id"]: table["parent_table_id"] for table in tables}
    places = build_block_places([PlaceBlock(**block) for block in blocks], parent_of)
    return {"blocks": blocks, "tables": tables, "places": {str(k): v for k, v in sorted(places.items())}}


def _build_place_cases() -> list[dict[str, Any]]:
    blank_blocks = [
        {"id": i + 1, "seq": i, "kind": "paragraph", "text": text, "table_id": None} for i, text in enumerate(BLANK_SAMPLES)
    ]
    nested = [
        {"id": 1, "seq": 0, "kind": "paragraph", "text": "Intro", "table_id": None},
        {"id": 2, "seq": 1, "kind": "table_cell", "text": "a", "table_id": 10},
        {"id": 3, "seq": 2, "kind": "table_cell", "text": "", "table_id": 11},
        {"id": 4, "seq": 3, "kind": "table_cell", "text": "b", "table_id": 10},
        {"id": 5, "seq": 4, "kind": "table_cell", "text": "c", "table_id": 12},
        {"id": 6, "seq": 5, "kind": "figure", "text": "", "table_id": None},
        {"id": 7, "seq": 6, "kind": "paragraph", "text": " ", "table_id": None},
        {"id": 8, "seq": 7, "kind": "paragraph", "text": "Table 1. Caption", "table_id": None},
    ]
    nested_tables = [
        {"id": 10, "parent_table_id": None},
        {"id": 11, "parent_table_id": 10},
        {"id": 12, "parent_table_id": None},
    ]
    shuffled = [dict(block, seq=100 - block["seq"]) for block in nested]  # places follow seq, not list order
    return [_place_case(blank_blocks, []), _place_case(nested, nested_tables), _place_case(shuffled, nested_tables)]


def build_rule_cases() -> dict[str, Any]:
    return {
        "_comment": "Generated by backend/scripts/dump_rule_cases.py — do not edit by hand.",
        "constants": {
            "MAX_INDENT_LEVEL": constants.MAX_INDENT_LEVEL,
            "MAX_BULLET_LEVEL": constants.MAX_BULLET_LEVEL,
            "BULLET_SYMBOLS": list(constants.BULLET_SYMBOLS),
            "NUMBER_STYLES": list(constants.NUMBER_STYLES),
            "MAX_NUMBER_CHARS": MAX_NUMBER_CHARS,
            "CAPTION_REACH": CAPTION_REACH,
            "MAX_ROW_LEVEL": MAX_ROW_LEVEL,
        },
        "number_lines": [
            {"base": base, "depths": depths, "numbers": number_lines(base, depths)} for base, depths in NUMBER_LINES_INPUTS
        ],
        "plan_follow": [
            {
                "numbers": numbers,
                "index": index,
                "next": new,
                "follow": {str(k): v for k, v in sorted(plan_follow(numbers, index, new).items())},
            }
            for numbers, index, new in PLAN_FOLLOW_INPUTS
        ],
        "block_places": _build_place_cases(),
        "bullet_depths": [
            {
                "items": [{"number_style": style, "indent_level": level} for style, level in items],
                "depths": get_bullet_depths([SimpleNamespace(number_style=style, indent_level=level) for style, level in items]),
            }
            for items in BULLET_INPUTS
        ],
        "row_levels": [
            {
                "rows": [{"label": label, "shift": shift, "has_cell": has_cell, "pair_top": top} for label, shift, has_cell, top in rows],
                "levels": build_row_levels([LevelRow(*row) for row in rows]),
            }
            for rows in ROW_LEVEL_INPUTS
        ],
        "unwrap_order": [
            {
                "lines": [{"id": unit_id, "seq": seq, "pos": pos} for unit_id, seq, pos in lines],
                "order": [line[0] for line in order_unwrapped(lines, lambda line: line[1], lambda line: (line[2],))],
            }
            for lines in UNWRAP_ORDER_INPUTS
        ],
        "unwrap_lines": [
            {
                "items": [{"id": item_id, "line": line, "block": block} for item_id, line, block in items],
                "seqs": {str(line): seq for line, seq in sorted(seqs.items())},
                "order": [
                    item[0]
                    for item in order_unwrapped_lines(
                        items, lambda item: item[1], {item[1]: item[2] for item in items}.get, seqs.get
                    )
                ],
            }
            for items, seqs in UNWRAP_LINES_INPUTS
        ],
    }


def render_rule_cases() -> str:
    return json.dumps(build_rule_cases(), ensure_ascii=False, indent=2) + "\n"


def main() -> None:
    OUT.write_text(render_rule_cases(), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
