"""KST clock — every timestamp is tz-aware UTC+9."""

from datetime import timedelta

from app.clock import now


def test_now_is_kst() -> None:
    assert now().utcoffset() == timedelta(hours=9)
