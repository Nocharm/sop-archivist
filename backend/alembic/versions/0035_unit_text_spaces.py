"""Turn line breaks inside stored unit text into spaces (a box is one line, item 6-a) — data only, no schema change.

Same length (one character for one), so spans, number ranges and figure places inside the text stay valid.
Confirmed New sentence text (target_sentences) is the person's text and is left as it is.

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-21 10:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0035"
down_revision: str | Sequence[str] | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade data."""
    # sqlite는 char(), postgres는 chr() — 같은 SQL을 방언마다 맞춘다
    char = "chr" if op.get_bind().dialect.name == "postgresql" else "char"
    op.execute(sa.text(
        f"UPDATE units SET text = replace(replace(text, {char}(13), ' '), {char}(10), ' ') "
        f"WHERE text LIKE '%' || {char}(10) || '%' OR text LIKE '%' || {char}(13) || '%'"
    ))


def downgrade() -> None:
    """Downgrade data — 어디가 줄바꿈이었는지 남기지 않으므로 되돌리지 않는다(띄어쓰기 글도 옛 코드에서 그대로 읽힌다)."""
