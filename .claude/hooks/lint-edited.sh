#!/usr/bin/env bash
# PostToolUse hook: lint the one file Claude just edited and hand failures back (exit 2 sends stderr to Claude).
# Works from any worktree: tools come from that worktree, else from the main checkout.
# Plan: docs/superpowers/plans/2026-11-19-trust-foundation-plan.md (step 1).
set -u

file=$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))')
[ -n "$file" ] && [ -f "$file" ] || exit 0
root=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) || exit 0
# The main checkout owns node_modules and the venv; extra worktrees usually have neither.
main=$(dirname "$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)")

case "$file" in
  "$root"/frontend/*.ts | "$root"/frontend/*.tsx | "$root"/frontend/*.mjs)
    eslint="$root/frontend/node_modules/.bin/eslint"
    [ -x "$eslint" ] || eslint="$main/frontend/node_modules/.bin/eslint"
    [ -x "$eslint" ] || exit 0
    if ! out=$(cd "$root/frontend" && "$eslint" --no-warn-ignored "$file" 2>&1); then
      printf 'eslint failed on %s — fix the cause the message names, do not disable the rule:\n%s\n' "$file" "$out" >&2
      exit 2
    fi
    ;;
  "$root"/backend/*.py)
    ruff="$root/backend/.venv/bin/ruff"
    [ -x "$ruff" ] || ruff="$main/backend/.venv/bin/ruff"
    [ -x "$ruff" ] || exit 0
    if ! out=$(cd "$root/backend" && "$ruff" check --quiet "$file" 2>&1); then
      printf 'ruff failed on %s:\n%s\n' "$file" "$out" >&2
      exit 2
    fi
    ;;
esac
exit 0
