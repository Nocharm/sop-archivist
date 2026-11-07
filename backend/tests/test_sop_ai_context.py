"""단위 맥락(app.sop.ai.context) — 표 Markdown 이스케이프, 앞뒤 이웃·소속 절·표 격자, 은퇴 단위 제외, 질의 수."""

from collections.abc import Iterator, Sequence
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.sop import groups
from app.sop.ai import context
from app.sop.ai.context import UnitContext, load_unit_context, render_table_markdown
from app.sop.models import Unit
from tests.access_helpers import run_in_session
from tests.docx_factory import build_docx, p, tbl
from tests.sop_helpers import create_bundle, find_unit, get_view, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

# 합성 문서 — 제목 하나, 문장 다섯, 2×2 표, 문장 둘. 문단마다 문장 하나라 단위 하나다
SECTION = "목적"
BEFORE_TABLE = [f"합성 문장 {name}을 켠다." for name in "ABCDE"]
AFTER_TABLE = [f"합성 문장 {name}을 쓴다." for name in "FG"]
TABLE_ROWS = [["항목", "값"], ["a|b", "c"]]
TABLE_MARKDOWN = "| 항목 | 값 |\n| --- | --- |\n| a\\|b | c |"


def _build_body() -> str:
    return (
        p(SECTION, "Heading1")
        + "".join(p(text) for text in BEFORE_TABLE)
        + tbl(TABLE_ROWS)
        + "".join(p(text) for text in AFTER_TABLE)
    )


def _upload_view(client: TestClient, bundle_id: int, body: str, name: str) -> dict:
    response = upload(client, bundle_id, build_docx(body), name)
    assert response.status_code == 201 and response.json()["status"] == "ready", response.text
    return get_view(client, bundle_id, response.json()["id"])


def _load(unit_ids: Sequence[int]) -> dict[int, UnitContext]:
    return run_in_session(lambda session: load_unit_context(session, unit_ids))


@pytest.fixture(autouse=True)
def two_neighbors(monkeypatch: pytest.MonkeyPatch) -> None:
    """이웃 수를 2로 고정한다 — 기대 값이 운영 상수(NEIGHBOR_UNITS)를 조정할 때마다 깨지지 않게."""
    monkeypatch.setattr(context, "NEIGHBOR_UNITS", 2)


@pytest.fixture
def view(client: TestClient) -> dict:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    return _upload_view(client, bundle_id, _build_body(), "SYNTHETIC_CTX-1.docx")


@contextmanager
def _count_queries() -> Iterator[list[str]]:
    statements: list[str] = []

    def _record(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _record)


# --- render_table_markdown ---


def test_render_table_escapes_pipes_and_newlines() -> None:
    grid = [["이름", "비고"], ["a|b", "첫 줄\n둘째 줄"], ["x\r\ny", "z\rw"]]

    markdown = render_table_markdown(grid)

    assert markdown == (
        "| 이름 | 비고 |\n| --- | --- |\n| a\\|b | 첫 줄<br>둘째 줄 |\n| x<br>y | z<br>w |"
    )
    # 이스케이프한 뒤에도 줄 수는 격자 행 수 + 구분 줄이다 — 칸 안의 줄바꿈이 행을 깨지 않는다
    assert len(markdown.split("\n")) == len(grid) + 1


def test_render_table_pads_short_rows_and_handles_empty_input() -> None:
    assert render_table_markdown([["a", "b", "c"], ["d"]]) == "| a | b | c |\n| --- | --- | --- |\n| d |  |  |"
    assert render_table_markdown([["only"]]) == "| only |\n| --- |"
    assert render_table_markdown([]) == ""
    assert render_table_markdown([[]]) == ""


# --- load_unit_context ---


def test_unit_context_has_neighbors_section_and_table(view: dict) -> None:
    heading = find_unit(view, SECTION)
    middle = find_unit(view, BEFORE_TABLE[2])
    last_before_table = find_unit(view, BEFORE_TABLE[4])
    table = next(unit for unit in view["units"] if unit["kind"] == "table")
    last = find_unit(view, AFTER_TABLE[-1])
    a, b, c, d, e = BEFORE_TABLE
    f, g = AFTER_TABLE

    contexts = _load([unit["id"] for unit in view["units"]])

    # 가운데 문장 — 앞뒤 이웃은 원문 순서이고, 소속 절은 가장 가까운 제목이며, 표 단위가 아니라 표 칸은 비어 있다
    assert contexts[middle["id"]] == UnitContext(section=SECTION, before=(a, b), after=(d, e), table_markdown="")
    # 문서 끝에서는 있는 만큼만 — 표 칸 문장도 읽는 순서의 이웃이다
    assert contexts[heading["id"]] == UnitContext(section=SECTION, before=(), after=(a, b), table_markdown="")
    assert contexts[last["id"]].before == ("c", f) and contexts[last["id"]].after == ()
    assert contexts[last_before_table["id"]].after == ("항목", "값")
    # 표 단위 — 칸 격자가 Markdown이 되고, 자기 칸 문장은 이웃이 아니라 표 앞뒤 문장이 이웃이다
    assert contexts[table["id"]] == UnitContext(section=SECTION, before=(d, e), after=(f, g), table_markdown=TABLE_MARKDOWN)


def test_table_row_unit_gets_the_same_table_markdown(view: dict, client: TestClient) -> None:
    table = next(unit for unit in view["units"] if unit["kind"] == "table")

    async def _make_row(session: AsyncSession) -> None:
        await session.execute(update(Unit).where(Unit.id == table["id"]).values(kind="table_row", row_index=1))
        await session.commit()

    run_in_session(_make_row)

    assert _load([table["id"]])[table["id"]].table_markdown == TABLE_MARKDOWN


def test_context_skips_retired_neighbors(view: dict) -> None:
    retired = find_unit(view, BEFORE_TABLE[1])
    target = find_unit(view, BEFORE_TABLE[2])
    first = find_unit(view, BEFORE_TABLE[0])

    async def _retire(session: AsyncSession) -> None:
        await session.execute(update(Unit).where(Unit.id == retired["id"]).values(status="retired"))
        await session.commit()

    run_in_session(_retire)
    contexts = _load([target["id"], first["id"]])

    # 은퇴한 단위는 이웃에서 빠지고 그 너머의 단위가 대신 들어온다
    assert contexts[target["id"]].before == (SECTION, BEFORE_TABLE[0])
    assert contexts[first["id"]].after == (BEFORE_TABLE[2], BEFORE_TABLE[3])


def test_context_stays_inside_its_extraction(client: TestClient) -> None:
    bundle_id = create_bundle(client, is_synthetic=True)["id"]
    first_view = _upload_view(client, bundle_id, p("첫째 문서의 마지막 문장이다."), "SYNTHETIC_CTX-A.docx")
    second_view = _upload_view(client, bundle_id, p("둘째 문서의 처음 문장이다."), "SYNTHETIC_CTX-B.docx")
    first_unit, second_unit = first_view["units"][0], second_view["units"][0]

    contexts = _load([first_unit["id"], second_unit["id"]])

    assert contexts[first_unit["id"]].after == () and contexts[second_unit["id"]].before == ()


def test_context_for_unknown_or_no_units_is_empty(view: dict) -> None:
    with _count_queries() as statements:
        assert _load([]) == {}
    assert statements == []
    assert _load([999_999_999]) == {}


def test_context_query_count_does_not_grow_with_units(view: dict) -> None:
    all_ids = [unit["id"] for unit in view["units"]]
    table = next(unit for unit in view["units"] if unit["kind"] == "table")
    sample = [find_unit(view, BEFORE_TABLE[0])["id"], table["id"]]  # 범위가 있는 단위와 표 단위가 하나씩
    assert len(all_ids) > 10

    with _count_queries() as few:
        _load(sample)
    with _count_queries() as many:
        _load(all_ids)

    # 질의는 종류마다 한 번이다(단위·순서·이웃 글·첫 블록 절·표 칸) — 단위당 질의가 아니다
    assert len(many) == len(few) == 5


def test_context_reads_ids_in_chunks(view: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    all_ids = [unit["id"] for unit in view["units"]]
    expected = _load(all_ids)
    real_iter_chunks = groups.iter_chunks
    # select_in_chunks가 기본 크기로 부르는 iter_chunks를 작게 바꿔, IN 목록이 한 조각을 넘는 상황을 만든다
    monkeypatch.setattr(groups, "iter_chunks", lambda ids, size=3: real_iter_chunks(ids, size))

    with _count_queries() as chunked:
        assert _load(all_ids) == expected

    assert len(chunked) > 5  # 조각마다 질의가 나뉜다 — 한 문장에 몰아 싣지 않는다
