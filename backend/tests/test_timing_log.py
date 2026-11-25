"""측정 로그 설정 — 허용한 숫자 키만 JSON 한 줄로, 두 번 불러도 핸들러 하나."""

import json
import logging

from app.timing_log import TIMING_LOGGER, TimingFormatter, configure_timing_log


def test_formatter_prints_message_and_allowed_numeric_keys_only() -> None:
    record = logging.LogRecord(TIMING_LOGGER, logging.INFO, __file__, 1, "group save timed", None, None)
    record.total_ms = 12.5
    record.bundle_id = 3
    record.login_id = "qa.member"
    record.text = "원문"
    record.dump_ms = "not a number"
    assert json.loads(TimingFormatter().format(record)) == {"msg": "group save timed", "bundle_id": 3, "total_ms": 12.5}


def test_configure_twice_keeps_one_handler() -> None:
    configure_timing_log()
    configure_timing_log()
    logger = logging.getLogger(TIMING_LOGGER)
    assert sum(isinstance(h.formatter, TimingFormatter) for h in logger.handlers) == 1
    assert logger.level == logging.INFO
