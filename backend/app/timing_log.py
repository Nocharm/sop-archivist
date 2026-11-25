"""측정용 로그 하나("app.timing")만 INFO로 켜고 JSON 한 줄로 찍는다 — 앱 전체 로그 수준은 건드리지 않는다."""

import json
import logging

TIMING_LOGGER = "app.timing"
# 허용한 숫자 키만 찍는다 — 모르는 extra·이름·원문이 섞여 나가지 않게
TIMING_KEYS = ("bundle_id", "total_ms", "dump_ms", "run_ms", "unit_count", "target_count")


class TimingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        fields = {key: getattr(record, key) for key in TIMING_KEYS if isinstance(getattr(record, key, None), (int, float))}
        return json.dumps({"msg": record.getMessage(), **fields}, ensure_ascii=False)


def configure_timing_log() -> None:
    """backend 시작 때 한 번 부른다 — 여러 번 불러도 핸들러는 하나."""
    logger = logging.getLogger(TIMING_LOGGER)
    logger.setLevel(logging.INFO)
    if any(isinstance(handler.formatter, TimingFormatter) for handler in logger.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(TimingFormatter())
    logger.addHandler(handler)
