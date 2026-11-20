"""Fold the tone and table_restructured change types into rewritten — people no longer pick a change type.

변경 종류를 그대로·고침 둘로 줄인다(설계 2026-11-20-change-type-two D1·D4). 자료만 바꾼다:
새 문장의 `tone`·`table_restructured`는 `rewritten`으로, JSON 속 옛 값도 — AI 제안 내용(`change_type`, `target_change_types`의 값)과
되돌리기 기록의 앞·뒤 모습(어느 깊이든 `change_type` 키). 기록을 두면 Undo가 옛 종류를 되살린다. 말투·고침을 가르던 LLM
`match` 작업의 대기·실행 중인 것은 취소한다 — 그 답이 옛 종류를 다시 쓰지 않게.

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-20 12:00:00.000000

"""
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0032"
down_revision: str | Sequence[str] | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_TYPES = {"tone": "rewritten", "table_restructured": "rewritten"}
_CHUNK = 200  # 한 번에 읽는 JSON 행 수 — 되돌리기 기록은 묶음 상태를 통째로 담아 클 수 있다

_suggestions = sa.table("ai_suggestions", sa.column("id", sa.Integer), sa.column("content", sa.JSON))
_steps = sa.table("decision_steps", sa.column("id", sa.Integer), sa.column("before", sa.JSON), sa.column("after", sa.JSON))
_jobs = sa.table(
    "ai_jobs", sa.column("kind", sa.String), sa.column("status", sa.String),
    sa.column("finished_at", sa.DateTime(timezone=True)),
)


def _replace_old_types(value: Any) -> Any:
    """`change_type` 키의 옛 값과 `target_change_types`의 옛 값을 고침으로 — 다른 값은 그대로 둔 사본."""
    if isinstance(value, list):
        return [_replace_old_types(item) for item in value]
    if not isinstance(value, dict):
        return value
    replaced: dict[str, Any] = {}
    for key, item in value.items():
        if key == "change_type" and isinstance(item, str):
            replaced[key] = _OLD_TYPES.get(item, item)
        elif key == "target_change_types" and isinstance(item, dict):
            replaced[key] = {
                target_id: _OLD_TYPES.get(kind, kind) if isinstance(kind, str) else kind for target_id, kind in item.items()
            }
        else:
            replaced[key] = _replace_old_types(item)
    return replaced


def _mentions_old_type(column: sa.ColumnElement[Any]) -> sa.ColumnElement[bool]:
    """옛 값이 글로 든 행만 — JSON을 글로 견줘 바뀔 수 없는 큰 기록을 읽지 않는다(sqlite·postgres 모두 JSON 글자는 "tone" 꼴이다)."""
    text = sa.cast(column, sa.Text)
    return sa.or_(*(text.like(f'%"{old}"%') for old in _OLD_TYPES))


def _rewrite_json_rows(table: sa.TableClause, columns: Sequence[str]) -> None:
    """옛 값이 들었을 수 있는 행을 id 순으로 조금씩 읽어, 바뀐 행만 다시 쓴다."""
    bind = op.get_bind()
    wanted = sa.or_(*(_mentions_old_type(table.c[name]) for name in columns))
    last_id = 0
    while True:
        rows = bind.execute(
            sa.select(table.c.id, *(table.c[name] for name in columns))
            .where(table.c.id > last_id, wanted).order_by(table.c.id).limit(_CHUNK)
        ).all()
        if not rows:
            return
        for row in rows:
            values = {name: _replace_old_types(row._mapping[name]) for name in columns}
            changed = {name: value for name, value in values.items() if value != row._mapping[name]}
            if changed:
                bind.execute(table.update().where(table.c.id == row.id).values(**changed))
        last_id = rows[-1].id


def upgrade() -> None:
    """Upgrade data."""
    op.execute(
        "UPDATE target_sentences SET change_type = 'rewritten' WHERE change_type IN ('tone', 'table_restructured')"
    )
    _rewrite_json_rows(_suggestions, ("content",))
    _rewrite_json_rows(_steps, ("before", "after"))
    op.get_bind().execute(
        _jobs.update()
        .where(_jobs.c.kind == "match", _jobs.c.status.in_(("queued", "running")))
        .values(status="cancelled", finished_at=sa.func.now())
    )


def downgrade() -> None:
    """되돌리지 않는다 — 어느 고침이 말투·표 구성 변경이었는지 잃었다. 고침은 옛 코드에서도 쓰던 값이라 그대로 읽힌다."""
