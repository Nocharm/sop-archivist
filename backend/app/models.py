"""SQLAlchemy declarative base and shared column helpers (each model change needs an Alembic revision)."""

from datetime import datetime

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

from app.clock import now as _now_kst

# 제약 이름을 규칙으로 고정한다 — SQLite 배치 마이그레이션(render_as_batch)은 이름 없는 제약을
# 지우거나 바꾸지 못하고, 자동 생성되는 이름은 DB마다 달라 리비전 이식성이 깨진다.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def _now() -> datetime:
    """타임스탬프 컬럼 기본값 — 기준시 KST (app.clock)."""
    return _now_kst()


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
