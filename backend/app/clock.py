"""앱 공통 시계 — 모든 타임스탬프 기준시는 KST(UTC+9). DB 컬럼 기본값·라우터 공용."""

from datetime import datetime, timedelta, timezone

# 한국 표준시 — 타임스탬프 기준시(요청: KST 고정). tz-aware로 저장해 비교는 절대시각 기준 정확.
KST = timezone(timedelta(hours=9))


def now() -> datetime:
    """현재 시각(KST, tz-aware)."""
    return datetime.now(KST)
