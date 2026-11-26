"""Write frontend/src/lib/practice/practice-fixture.json — the practice screen's first answers, built by the real backend.

The practice page (/practice) answers Assign's requests from a fake server in the browser. Its starting data is what this
backend answers today for two synthetic documents (an Old SOP with ko/en pairs, a table and a contents block, and a New SOP
nothing is linked to yet — practice design §4). Sentences are picked from the user manual; nothing is a real SOP.
`tests/test_practice_fixture.py` fails when this file is stale, so a change to the answer shapes or the split rule breaks CI
until the file is regenerated.

The documents are uploaded into a throwaway sqlite file in a child process (the app binds its database at import time), so
the result never touches dev.db or the test database and is the same bytes on every run.

Run from backend/:
    bash:       .venv/bin/python -m scripts.dump_practice_fixture
    PowerShell: .venv\\Scripts\\python -m scripts.dump_practice_fixture
"""

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
OUT = BACKEND_DIR.parent / "frontend" / "src" / "lib" / "practice" / "practice-fixture.json"
GENERATED = "backend/scripts/dump_practice_fixture.py"

PRACTICE_BUNDLE_ID = -1  # frontend practice-route.ts PRACTICE_BUNDLE_ID (design D3) — real ids are positive
FIRST_DOC_ID = 900001  # practice document ids start here so browser keys (sopa.assign.tablesFolded.<doc id>) never meet a real one
FIXED_AT = "2026-11-26T00:00:00+09:00"  # every timestamp in the file, so the bytes do not depend on when it ran
PRACTICE_LOGIN = "practice"  # the one synthetic member and every *_by value
PRACTICE_TITLE = "Practice"
PRACTICE_MEMBER = {"active": True, "korean_name": "연습", "login_id": PRACTICE_LOGIN, "name": "Practice", "role": "author"}
MAX_FIXTURE_BYTES = 100_000  # the file ships in the practice page's chunk; past this, shorten the documents (plan step 1)
UNDO_SESSION = "practice-fixture"  # the undo log session the table snapshot writes under
CANDIDATE_KINDS = {"sentence", "heading"}  # Old Units the screen asks suggestion cards for
CHILD_FLAG = "--build-into"
CHILD_TIMEOUT_S = 300  # the build takes a few seconds (two small uploads); the cap only stops a hung child

OLD_FILE = "SYNTHETIC_PRACTICE-OLD.docx"
NEW_FILE = "SYNTHETIC_PRACTICE-NEW.docx"
NEW_DOC_TYPE = "sop"

# Old document (design §4.2) — Korean picked or adapted from frontend/public/manual/user-manual.md, English written for each pair.
TITLE = ("연습용 SOP — Assign 따라 하기", "Practice SOP — Following Assign")
TOC_HEAD = "목차"
TOC_LINES = (
    "1. 목적 ........ 1", "1. Purpose ........ 1", "2. 연습 ........ 1", "2. Practice ........ 1",
    "3. 글쇠 ........ 2", "3. Keys ........ 2",
)
PURPOSE_HEAD = ("1. 목적", "1. Purpose")
PAIR_A = (
    "Old Unit마다 새 문서의 어디로 갈지 정하고 확정합니다.",
    "Decide where each Old Unit goes in the new document and confirm it.",
)
PAIR_B = (
    "추천 카드를 누르면 고르기만 하고, 이어서 Enter로 바로 확정합니다.",
    "Clicking a suggestion card only picks it, and Enter confirms it right away.",
)
PAIR_C = (
    "정할 수 없는 Unit은 사유를 적어 미룹니다.",
    "Put off a Unit you cannot decide yet and write the reason.",
)
SPLIT_KO = "정할 수 없는 Unit은 보류합니다. 보류한 Unit은 On hold에 모입니다."
MERGE_PIECES = ("나누기와 합치기는 확정과 같은 저장이라", "한 번에 한 동작씩 되돌립니다.")
PRACTICE_HEAD = ("2. 연습", "2. Practice")
PAIR_D = (
    "한/영 짝은 한 문장으로 합치고 다시 짝으로 풉니다.",
    "A Korean–English pair joins into one sentence and splits back into a pair.",
)
KEYS_HEAD = ("3. 글쇠", "3. Keys")
TABLE_ROWS = (("글쇠", "뜻"), ("Enter", "확정"), ("Ctrl+Z", "되돌리기"))

# New document (design §4.3) — A′ and B′ rewrite pairs A and B, B′ close enough to B that it is B's first suggestion.
NEW_TITLE = "연습용 새 SOP"
NEW_A = (
    "Old Unit마다 새 문서에서 갈 곳을 정합니다.",
    "Decide where each Old Unit goes in the new document.",
)
NEW_B = (
    "추천 카드를 누르면 고르기만 하고, 이어서 Enter로 확정합니다.",
    "Clicking a suggestion card only picks it, and Enter confirms it.",
)
NEW_OTHERS = (
    "보류한 Unit은 검토 요청 전에 풀어야 합니다.",
    "Held Units must be settled before asking for review.",
)


def build_old_docx() -> bytes:
    """The Old practice SOP — title, a contents block (toc style), ko/en pairs A–D, a two-sentence box, a broken sentence, a table."""
    from tests.docx_factory import build_docx, make_grid_table, make_row, make_style, p

    body = (
        "".join(p(text, "Title") for text in TITLE)
        + p(TOC_HEAD, "TOCHeading")
        + "".join(p(line, "TOC1") for line in TOC_LINES)
        + "".join(p(text, "Heading1") for text in PURPOSE_HEAD)
        + "".join(p(text) for pair in (PAIR_A, PAIR_B, PAIR_C) for text in pair)
        + p(SPLIT_KO)
        + "".join(p(piece) for piece in MERGE_PIECES)
        + "".join(p(text, "Heading1") for text in PRACTICE_HEAD)
        + "".join(p(text) for text in PAIR_D)
        + "".join(p(text, "Heading1") for text in KEYS_HEAD)
        + make_grid_table(2, "".join(make_row(list(row)) for row in TABLE_ROWS))
    )
    styles = (
        make_style("Title", "title")
        + make_style("TOCHeading", "TOC Heading")
        + make_style("TOC1", "toc 1")
        + make_style("Heading1", "heading 1", outline=0)
    )
    return build_docx(body, styles=styles)


def build_new_docx() -> bytes:
    """The New practice SOP — a heading line (cannot be linked) and the sentences pairs A and B are rewritten into."""
    from tests.docx_factory import build_docx, make_style, p

    body = p(NEW_TITLE, "Heading1") + "".join(p(text) for pair in (NEW_A, NEW_B, NEW_OTHERS) for text in pair)
    return build_docx(body, styles=make_style("Heading1", "heading 1", outline=0))


def render_practice_fixture() -> str:
    """Build the fixture in a child process on a fresh sqlite file and return the JSON text."""
    with tempfile.TemporaryDirectory(prefix="practice-fixture-") as directory:
        database = Path(directory) / "practice.db"
        out = Path(directory) / "practice-fixture.json"
        env = {
            **os.environ,
            "DATABASE_URL": f"sqlite+aiosqlite:///{database}",
            "AUTH_MODE": "dev",
            "DEV_ENFORCE_PERMISSIONS": "false",
            "APP_SYSADMINS": "",
            "AI_ENABLED": "false",
            "EMBED_ENABLED": "false",
            "N8N_HR_URL": "",
            "N8N_HR_TOKEN": "",
            "N8N_QUERY_URL": "",
            "PYTHONIOENCODING": "utf-8",
        }
        result = subprocess.run(
            [sys.executable, "-m", "scripts.dump_practice_fixture", CHILD_FLAG, str(database), str(out)],
            cwd=BACKEND_DIR, env=env, capture_output=True, text=True, encoding="utf-8", timeout=CHILD_TIMEOUT_S,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"practice fixture build failed (exit {result.returncode}): {result.stderr[-4000:]}")
        return out.read_text(encoding="utf-8")


def _build_into(database: Path, out: Path) -> None:
    """Child process: upload the two documents into the fresh database and write the fixture JSON to out."""
    from fastapi.testclient import TestClient

    from app.main import app
    from app.settings import settings

    expected_url = f"sqlite+aiosqlite:///{database}"
    if settings.database_url != expected_url or database.exists():
        raise SystemExit(f"refusing to build: the child needs a fresh sqlite file at {database}")
    settings.ai_enabled = settings.embed_enabled = False
    with TestClient(app) as client:
        fixture = _collect(client, database)
    # one value per line without indent — readable diffs, and about a quarter smaller than indent=2 (budget: MAX_FIXTURE_BYTES)
    text = json.dumps(fixture, ensure_ascii=False, indent=0, separators=(",", ":"), sort_keys=True) + "\n"
    out.write_text(text, encoding="utf-8")


def _collect(client: Any, database: Path) -> dict[str, Any]:
    """Upload the two documents and read every answer the practice screen starts from (design §4.1-3–5)."""
    from tests.sop_helpers import AUTHOR, create_bundle, get_view, upload

    _push_document_ids(client, database)
    bundle_id = create_bundle(client, title=PRACTICE_TITLE)["id"]
    old_id = _ok(upload(client, bundle_id, build_old_docx(), OLD_FILE), 201)["id"]
    _ok(upload(client, bundle_id, build_new_docx(), NEW_FILE, side="new", doc_type=NEW_DOC_TYPE), 201)

    def get(path: str) -> Any:
        return _ok(client.get(f"/api/bundles/{bundle_id}{path}", headers=AUTHOR), 200)

    documents = get("/documents")
    views = {str(doc["id"]): get_view(client, bundle_id, doc["id"]) for doc in documents}
    written = get("/written-sentences")
    targets = {
        str(target["id"]): target
        for sentence in written
        for target in get(f"/groups/by-target/{sentence['target_id']}")["targets"]
    }
    candidates = {
        str(unit["id"]): get(f"/units/{unit['id']}/new-candidates")
        for unit in views[str(old_id)]["units"]
        if unit["kind"] in CANDIDATE_KINDS and unit["noise_kind"] is None
    }
    fixture = {
        "_generated": GENERATED,
        "bundle": get(""),
        "documents": documents,
        "views": views,
        "units": get("/units?limit=1000&offset=0")["items"],
        "tobe": get("/tobe"),
        "written": written,
        "targets": targets,
        "candidates": candidates,
    }
    # last: it edits the Old document and undoes the edit, so the answers above are the untouched first look
    fixture["tableVariants"] = _snap_tables(client, bundle_id, old_id, views[str(old_id)])
    return _mask(fixture, bundle_id)


def _snap_tables(client: Any, bundle_id: int, doc_id: int, first_view: dict[str, Any]) -> dict[str, Any]:
    """Each table's two looks (design D7): as uploaded and after a real set_layout_table, which is then undone.

    A look is the table's `tables` row, its table and cell Units and the pairs those Units are in (unwrapping pairs the cells
    of a ko/en row). Only the table's own Units may change and the undo must bring back the first view — the fake server
    swaps exactly these rows, so anything else moving would be a difference it cannot show.
    """
    from tests.sop_helpers import AUTHOR, get_view

    variants: dict[str, Any] = {}
    for table in first_view["tables"]:
        body = {
            "revision": get_view(client, bundle_id, doc_id)["document"]["revision"], "confirm": True,
            "undo": {"session": UNDO_SESSION}, "op": {"type": "set_layout_table", "table_id": table["id"], "is_layout": True},
        }
        _ok(client.post(f"/api/bundles/{bundle_id}/documents/{doc_id}/edits", json=body, headers=AUTHOR), 200)
        unwrapped = get_view(client, bundle_id, doc_id)
        _ok(client.post(f"/api/bundles/{bundle_id}/decisions/undo", json={"session": UNDO_SESSION}, headers=AUTHOR), 200)
        wrapped, after = _pick_table(first_view, table["id"]), _pick_table(unwrapped, table["id"])
        if _drop_table(first_view, wrapped) != _drop_table(unwrapped, after):
            raise RuntimeError(f"unwrapping table {table['id']} changed more than its own Units and pairs")
        if _drop_edit_marks(get_view(client, bundle_id, doc_id)) != _drop_edit_marks(first_view):
            raise RuntimeError(f"undoing the unwrap of table {table['id']} did not bring back the first view")
        variants[str(table["id"])] = {"wrapped": wrapped, "unwrapped": after}
    return variants


def _pick_table(view: dict[str, Any], table_id: int) -> dict[str, Any]:
    units = [unit for unit in view["units"] if unit["table_id"] == table_id]
    unit_ids = {unit["id"] for unit in units}
    return {
        "table": next(row for row in view["tables"] if row["id"] == table_id),
        "units": units,
        "pairs": [pair for pair in view["pairs"] if unit_ids & set(pair["unit_ids"])],
    }


def _drop_table(view: dict[str, Any], look: dict[str, Any]) -> dict[str, Any]:
    """The view's other Units, pairs and tables — what must stay the same across an unwrap.

    Pairs are named by their members: an unwrap re-suggests the document's code pairs under new ids (units.refresh_code_pairs),
    which the fake server does not need to copy — the same Units are paired the same way.
    """
    unit_ids = {unit["id"] for unit in look["units"]}
    members = {pair["id"]: pair["unit_ids"] for pair in view["pairs"]}
    return {
        "units": [
            {**unit, "pair_id": members.get(unit["pair_id"])} for unit in view["units"] if unit["id"] not in unit_ids
        ],
        "pairs": [
            {**pair, "id": None} for pair in view["pairs"] if not unit_ids & set(pair["unit_ids"])
        ],
        "tables": [row for row in view["tables"] if row["id"] != look["table"]["id"]],
    }


def _drop_edit_marks(view: dict[str, Any]) -> dict[str, Any]:
    """A view without what an edit and its undo move on purpose — the document revision and the undo/redo flags."""
    return {**view, "document": {**view["document"], "revision": None}, "edits": None}


def _push_document_ids(client: Any, database: Path) -> None:
    """Make the next document id FIRST_DOC_ID — one throwaway document moved to FIRST_DOC_ID - 1 with every row that points at it."""
    from tests.docx_factory import build_docx, p
    from tests.sop_helpers import create_bundle, upload

    spare = create_bundle(client, title="Practice id spacer")["id"]
    doc_id = _ok(upload(client, spare, build_docx(p("합성 자리 채움 문장.")), "SYNTHETIC_SPACER.docx"), 201)["id"]
    with sqlite3.connect(database) as connection:  # a plain connection leaves foreign keys off, so the moves need no order
        tables = [name for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        for table in tables:
            for row in connection.execute(f'PRAGMA foreign_key_list("{table}")').fetchall():
                if row[2] == "documents" and row[4] == "id":
                    connection.execute(f'UPDATE "{table}" SET "{row[3]}" = ? WHERE "{row[3]}" = ?', (FIRST_DOC_ID - 1, doc_id))
        connection.execute("UPDATE documents SET id = ? WHERE id = ?", (FIRST_DOC_ID - 1, doc_id))


def _mask(fixture: dict[str, Any], bundle_id: int) -> dict[str, Any]:
    """Practice bundle id, fixed timestamps, one synthetic member — the same input gives the same bytes (design §4.1-6)."""
    masked = _mask_value(fixture, bundle_id)
    masked["bundle"].update(id=PRACTICE_BUNDLE_ID, title=PRACTICE_TITLE, my_role="author", members=[PRACTICE_MEMBER])
    return masked


def _mask_value(value: Any, bundle_id: int, key: str = "") -> Any:
    if isinstance(value, dict):
        return {name: _mask_value(item, bundle_id, name) for name, item in value.items()}
    if isinstance(value, list):
        return [_mask_value(item, bundle_id, key) for item in value]
    if key.endswith("_at") and isinstance(value, str):
        return FIXED_AT
    if key.endswith("_by") and isinstance(value, str):
        return PRACTICE_LOGIN
    if key == "bundle_id" and value == bundle_id:
        return PRACTICE_BUNDLE_ID
    return value


def _ok(response: Any, status: int) -> Any:
    if response.status_code != status:
        raise RuntimeError(f"{response.request.method} {response.request.url.path} -> {response.status_code}: {response.text[:500]}")
    return response.json()


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == CHILD_FLAG:
        _build_into(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(render_practice_fixture(), encoding="utf-8")
        print(f"wrote {OUT.relative_to(BACKEND_DIR.parent)} ({OUT.stat().st_size} bytes)")
