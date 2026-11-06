"""SOP 입력 글자 칸의 공통 규칙 — Postgres text가 담지 못하는 NUL을 경계에서 422로 막는다(sqlite는 받아 줘 테스트에 안 보인다)."""

from typing import Annotated

from pydantic import AfterValidator


def _check_no_nul(value: str) -> str:
    if "\x00" in value:
        raise ValueError("text must not contain NUL characters")
    return value


# StringConstraints 뒤에 둔다 — 앞에 두면 pydantic이 길이를 공백을 걷기 전에 잰다
NO_NUL = AfterValidator(_check_no_nul)
NoNulStr = Annotated[str, NO_NUL]
