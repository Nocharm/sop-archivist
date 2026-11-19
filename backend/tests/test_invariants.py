"""Source invariants that backend/CLAUDE.md used to state only in prose — one place per rule, AI suggests only, recorded AI calls.

Each failure message says how to fix the cause. Plan: docs/superpowers/plans/2026-11-19-trust-foundation-plan.md (step 2).
"""

import ast
import io
import re
import tokenize
from collections.abc import Callable, Iterable
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1] / "app"

Predicate = Callable[[ast.AST], bool]


def _rel(path: Path) -> str:
    return path.relative_to(APP.parent).as_posix()


def _find(predicate: Predicate, paths: Iterable[Path], allowed: frozenset[str] = frozenset()) -> list[str]:
    """`file:line` of every node the predicate accepts, outside the allowed files."""
    return [
        f"{_rel(path)}:{getattr(node, 'lineno', 0)}"
        for path in sorted(paths)
        if _rel(path) not in allowed
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if predicate(node)
    ]


def _is_empty_string(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value == ""


def uses_isspace(node: ast.AST) -> bool:
    return isinstance(node, ast.Attribute) and node.attr == "isspace"


def uses_create_all(node: ast.AST) -> bool:
    return isinstance(node, ast.Attribute) and node.attr == "create_all"


def uses_call_ai(node: ast.AST) -> bool:
    if isinstance(node, ast.Name) and node.id == "call_ai":
        return True
    return isinstance(node, ast.ImportFrom) and any(alias.name == "call_ai" for alias in node.names)


def writes_confirmed_text(node: ast.AST) -> bool:
    if isinstance(node, ast.keyword) and node.arg == "confirmed_text":
        return not _is_empty_string(node.value)
    if isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        return any(isinstance(t, ast.Attribute) and t.attr == "confirmed_text" for t in targets)
    if isinstance(node, ast.Dict):
        return any(
            isinstance(k, ast.Constant) and k.value == "confirmed_text" and not _is_empty_string(v)
            for k, v in zip(node.keys, node.values, strict=True)
        )
    return False


def compute_holds_session(node: ast.AST) -> bool:
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or node.name != "compute":
        return False
    params = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
    if any(p.arg == "session" or (p.annotation is not None and "Session" in ast.unparse(p.annotation)) for p in params):
        return True
    return any(isinstance(n, ast.Name) and n.id in {"SessionLocal", "get_session"} for n in ast.walk(node))


def raises_http_exception(node: ast.AST) -> bool:
    return isinstance(node, ast.Call) and ast.unparse(node.func).endswith("HTTPException")


BARE_NOQA = re.compile(r"#\s*noqa(?::\s*[A-Z]+[0-9]+(?:\s*,\s*[A-Z]+[0-9]+)*)?\s*$")


def test_blank_char_judgment_lives_in_segment() -> None:
    # The coverage invariant (every visible char covered once) stands on segment.is_blank_char / has_visible_char.
    allowed = frozenset({
        "app/sop/segment.py",
        "app/sop/filename.py",  # splits a file name into words; not unit text, never feeds coverage
    })
    found = _find(uses_isspace, APP.rglob("*.py"), allowed)
    assert found == [], f"Use segment.is_blank_char / has_visible_char instead of str.isspace(): {found}"


def test_schema_comes_only_from_alembic() -> None:
    found = _find(uses_create_all, APP.rglob("*.py"))
    assert found == [], f"Tables come from Alembic revisions (`alembic revision --autogenerate`), not create_all: {found}"


def test_ai_calls_go_through_the_recorded_wrapper() -> None:
    # call_ai_recorded leaves one ai_usage_events row per call, failures included.
    found = _find(uses_call_ai, APP.rglob("*.py"), frozenset({"app/ai_client.py", "app/ai_usage.py"}))
    assert found == [], f"Call AI through app.ai_usage.call_ai_recorded, not call_ai: {found}"


def test_ai_layer_never_writes_confirmed_text() -> None:
    # AI suggests only: a person's confirmed text is never written by app/sop/ai (new rows start with "").
    found = _find(writes_confirmed_text, (APP / "sop" / "ai").rglob("*.py"))
    assert found == [], f"The AI layer writes ai_text and suggestions only; confirmed_text belongs to people: {found}"


def test_ai_compute_holds_no_db_session() -> None:
    # load/compute/apply: compute runs the slow model call, so it must not hold a DB connection.
    found = _find(compute_holds_session, (APP / "sop" / "ai").rglob("*.py"))
    assert found == [], f"compute() takes immutable values from load(); open sessions only in load/apply: {found}"


def test_business_rejections_use_raise_rule() -> None:
    # One error shape for the SOP API: detail={"code", ...context}, which the frontend maps to rule.<code> text.
    paths = [*(APP / "sop").rglob("*.py"), *(APP / "routers").glob("sop_*.py")]
    found = _find(raises_http_exception, paths, frozenset({"app/sop/errors.py"}))
    assert found == [], f"Raise SOP rejections with app.sop.errors.raise_rule(status, code, **context): {found}"


def test_noqa_comments_give_a_reason() -> None:
    found = []
    for path in sorted(APP.rglob("*.py")):
        tokens = tokenize.generate_tokens(io.StringIO(path.read_text(encoding="utf-8")).readline)
        found += [f"{_rel(path)}:{tok.start[0]}" for tok in tokens if tok.type == tokenize.COMMENT and BARE_NOQA.search(tok.string)]
    assert found == [], f"Write `# noqa: CODE -- why the rule does not apply here`: {found}"


@pytest.mark.parametrize(
    ("predicate", "bad", "good"),
    [
        (uses_isspace, "ok = ch.isspace()", "ok = is_blank_char(ch)"),
        (uses_create_all, "Base.metadata.create_all(engine)", "command.upgrade(config, 'head')"),
        (uses_call_ai, "from app.ai_client import call_ai", "from app.ai_usage import call_ai_recorded"),
        (writes_confirmed_text, "TargetSentence(confirmed_text=reply)", "TargetSentence(confirmed_text='', ai_text=reply)"),
        (writes_confirmed_text, "row.confirmed_text = reply", "row.ai_text = reply"),
        (compute_holds_session, "async def compute(self, job, loaded, session): ...", "async def compute(self, job, loaded): ..."),
        (compute_holds_session, "async def compute(self, job, loaded):\n    async with SessionLocal() as s: ...", "async def load(self): SessionLocal()"),
        (raises_http_exception, "raise HTTPException(409, 'taken')", "raise_rule(409, 'taken')"),
    ],
)
def test_predicates_catch_the_bad_form_only(predicate: Predicate, bad: str, good: str) -> None:
    assert any(predicate(node) for node in ast.walk(ast.parse(bad)))
    assert not any(predicate(node) for node in ast.walk(ast.parse(good)))


def test_noqa_pattern_needs_text_after_the_codes() -> None:
    assert BARE_NOQA.search("x = 1  # noqa: F401")
    assert not BARE_NOQA.search("x = 1  # noqa: F401 -- fixture found by name")
