"""EQUIS 문서 조회 클라이언트 — db-viewer가 쓰는 n8n 질의 웹훅(`dbv-query`의 `table_preview`)으로 EDW 표를 읽는다.

웹훅은 표의 모든 칸을 돌려준다. 받는 칸은 `rules.parse_row`가 고르고, 실명 칸은 이 모듈 밖으로 나가지 않는다(설계 §5).
"""

import logging
import re

import httpx2

from app.equis.rules import EquisRow, parse_row
from app.settings import settings

logger = logging.getLogger(__name__)

# 사람이 번호를 고친 뒤 뒤에서 도는 조회의 상한(초) — HR 단건 조회와 같은 값
EQUIS_TIMEOUT_SECONDS = 10.0
# 한 조회가 받는 최대 줄 수. 꽉 차 오면 잘린 것으로 보고 경고를 남긴다(판이 수백 개인 문서 대비)
EQUIS_ROW_LIMIT = 500
# 일시 오류 다시 시도 횟수 — 그 뒤 마지막 오류를 올린다
RETRY_COUNT = 1

# 웹훅이 값을 SQL 글자로 끼워 넣으므로, 문서 번호 꼴이 아닌 입력은 아예 보내지 않는다
_SENDABLE_NUMBER = re.compile(r"[A-Z0-9][A-Z0-9 ./_-]{1,99}")
_NUMBER_COLUMN = "DOC_DOCUMENT_NUMBER"
_LEGACY_COLUMN = "DOC_LEGACY_DOCUMENT_ID"


class EquisUnavailable(RuntimeError):
    """웹훅이나 EDW가 쓸 수 있는 답을 주지 않았다 — 메시지에 주소를 싣지 않는다."""


def is_sendable_number(number: str) -> bool:
    return _SENDABLE_NUMBER.fullmatch(number) is not None


async def _post(payload: dict) -> object:
    async with httpx2.AsyncClient(timeout=EQUIS_TIMEOUT_SECONDS) as client:
        response = await client.post(settings.n8n_query_url, json=payload)
        response.raise_for_status()
        return response.json()


def _describe_error(error: BaseException) -> str:
    """오류 종류와 상태 코드만 — httpx 오류 글에는 주소가 들어 있어 그대로 쓰지 않는다."""
    if isinstance(error, httpx2.HTTPStatusError):
        return f"status={error.response.status_code}"
    return type(error).__name__


def _read_rows(payload: object) -> list[object]:
    """웹훅 응답 → 줄 목록. `{query, rows}`·한 겹 배열·행 배열을 모두 받고, 조건이 빠진 실행은 거절한다."""
    envelope = payload[0] if isinstance(payload, list) and len(payload) == 1 else payload
    if isinstance(envelope, dict) and "rows" in envelope:
        query = envelope.get("query")
        # 조건을 모르는 옛 워크플로는 표의 앞줄을 그대로 준다 — 그 줄로 "없음"을 판정하면 안 된다
        if isinstance(query, str) and "WHERE" not in query.upper():
            raise EquisUnavailable("EQUIS lookup was not filtered by the webhook")
        rows = envelope["rows"]
    else:
        rows = payload
    if not isinstance(rows, list):
        # `{"message": ...}`는 워크플로가 행 대신 상태를 돌려준 것이다
        raise EquisUnavailable("EQUIS lookup returned no rows object")
    return [row for row in rows if row]


async def _query(column: str, operator: str, value: str) -> list[EquisRow]:
    schema, _, table = settings.equis_edw_table.partition(".")
    body = {
        "kind": "table_preview",
        "schema": schema,
        "table": table,
        "limit": EQUIS_ROW_LIMIT,
        "filters": [{"column": column, "op": operator, "value": value}],
        # filters를 모르는 옛 워크플로도 조건 하나는 이 칸들로 받는다(db-viewer와 같은 하위호환)
        "filter_column": column,
        "filter_value": value,
        "filter_mode": "exact" if operator == "eq" else "contains",
    }
    last_error: Exception | None = None
    for attempt in range(RETRY_COUNT + 1):
        try:
            raw_rows = _read_rows(await _post(body))
        except (httpx2.HTTPError, ValueError, EquisUnavailable) as error:
            last_error = error
            logger.warning(
                "EQUIS lookup attempt failed",
                extra={"number": value, "column": column, "attempt": attempt, "error": _describe_error(error)},
            )
            continue
        rows = [row for row in (parse_row(raw) for raw in raw_rows) if row is not None]
        if len(raw_rows) >= EQUIS_ROW_LIMIT or len(rows) != len(raw_rows):
            logger.warning(
                "EQUIS lookup rows were cut or skipped",
                extra={"number": value, "column": column, "received": len(raw_rows), "kept": len(rows)},
            )
        return rows
    raise EquisUnavailable(f"EQUIS lookup failed: {_describe_error(last_error or RuntimeError())}")


async def fetch_rows(number: str) -> list[EquisRow]:
    """다듬은 번호 하나의 줄 — 번호가 같은 문서와, Legacy 글에 그 번호가 든 문서(일부만 겹친 것도 온다).

    조건을 AND로만 묶는 웹훅이라 두 번 묻는다. 문서 번호 꼴이 아니면 묻지 않고 빈 목록을 돌려준다.
    """
    if not is_sendable_number(number):
        return []
    by_number = await _query(_NUMBER_COLUMN, "eq", number)
    by_legacy = await _query(_LEGACY_COLUMN, "contains", number)
    return list(dict.fromkeys([*by_number, *by_legacy]))
