"""scripts.reset_db 거부 판정 — 직원 데이터가 든 postgres(운영 의심)는 지우지 않는다."""

from scripts.reset_db import should_refuse_reset


def test_reset_refuses_postgres_with_hr_rows() -> None:
    assert should_refuse_reset(is_postgres=True, hr_rows=3) is True
    assert should_refuse_reset(is_postgres=False, hr_rows=3) is False  # 로컬 sqlite는 데모 리셋이 본래 용도
    assert should_refuse_reset(is_postgres=True, hr_rows=0) is False  # 새로 만든 빈 postgres
