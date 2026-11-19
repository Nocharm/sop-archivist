"""frontend/src/lib/rule-cases.json must match what the backend rules answer today (the frontend copies are tested against it)."""

from scripts.dump_rule_cases import OUT, render_rule_cases


def test_rule_cases_file_is_current() -> None:
    assert OUT.read_text(encoding="utf-8") == render_rule_cases(), (
        "A rule the frontend copies changed. Regenerate with `.venv/bin/python -m scripts.dump_rule_cases`, "
        "then make the frontend copy pass `npx vitest run src/lib/rule-cases.test.ts`."
    )
