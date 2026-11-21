"""도형 그림(업무흐름도) — 도형 캔버스·묶음을 그림 블록 하나로 읽고(도형 안 글은 문단이 아니라 그림 안 글), 보낼 때 PNG로 그린다."""

from io import BytesIO
from time import perf_counter

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.sop.drawing_image import MAX_HEIGHT, MAX_WIDTH, render_drawing_png
from app.sop.extract.docx_reader import read_docx
from app.sop.extract.drawing import MAX_ITEMS, SIGNAL_DRAWING, list_drawing_texts
from app.sop.extract.types import DRAWING_IMAGE_PART, ExtractResult
from tests.docx_factory import (
    FLOW_SHAPES, TINY_PNG, build_docx, make_canvas_run, make_drawing_run, make_flow_shape_xml, make_grid_table, make_textbox_run, p,
)
from tests.sop_helpers import AUTHOR, create_bundle, get_view, upload
from tests.test_sop_docx_reader import LIMITS

pytestmark = pytest.mark.usefixtures("clean_sop")

FLOW_TEXTS = [text for *_, text in FLOW_SHAPES]


def _flow_in_cell(run: str) -> str:
    """흐름도를 "공정흐름도" 표 칸 안 문단에 둔다(실사례 꼴)."""
    return make_grid_table(2, f"<w:tr><w:tc>{p('공정흐름도')}</w:tc><w:tc><w:p>{run}</w:p></w:tc></w:tr>")


def _read(body: str, **kwargs: object) -> ExtractResult:
    return read_docx(build_docx(body, **kwargs), LIMITS)


def _figures(result: ExtractResult) -> list:
    return [block for block in result.blocks if block.kind == "figure"]


@pytest.mark.parametrize("variant", ["canvas", "wrapped", "grouped"])
def test_flowchart_in_a_cell_is_one_figure_with_its_texts_not_paragraphs(variant: str) -> None:
    run = make_canvas_run(wrapped=variant == "wrapped", grouped=variant == "grouped")

    result = _read(p("앞 문단") + _flow_in_cell(run))

    figures = _figures(result)
    assert len(figures) == 1
    figure = figures[0]
    assert figure.image_part == DRAWING_IMAGE_PART
    assert (figure.table_index, figure.row_index, figure.col_index) == (0, 0, 1)
    # 도형 안 글은 문단(텍스트 상자 블록)으로 나오지 않는다 — 감싼 변형의 VML 대체 갈래 글도
    assert [block.part for block in result.blocks if block.part == "textbox"] == []
    assert not any("공정 시작" in block.text for block in result.blocks)
    drawing = figure.signals[SIGNAL_DRAWING]
    assert list_drawing_texts(drawing) == FLOW_TEXTS
    assert len(drawing["items"]) == 9  # 도형 다섯 + 연결선 넷
    decision = next(item for item in drawing["items"] if item["geom"] == "flowChartDecision")
    # 묶음 변형은 자식 좌표가 두 배라도 원래 자리로 돌아온다
    assert (decision["x"], decision["y"], decision["w"], decision["h"]) == (1143000, 1371600, 1828800, 685800)
    connectors = [item for item in drawing["items"] if item["conn"]]
    assert len(connectors) == 4 and all(item["tail"] == "triangle" and not item["head"] for item in connectors)


def test_flowchart_paragraph_in_the_body_is_a_figure_block() -> None:
    result = _read(p("공정흐름도") + f"<w:p>{make_canvas_run()}</w:p>")

    assert [(block.kind, block.text) for block in result.blocks] == [("paragraph", "공정흐름도"), ("figure", "")]
    assert result.blocks[1].image_part == DRAWING_IMAGE_PART


def test_plain_textbox_and_picture_stay_as_before() -> None:
    """캔버스·묶음 밖 글상자는 지금처럼 텍스트 상자 문단, 그림 파일은 그 파일을 가리킨다."""
    body = f"<w:p>{make_textbox_run(p('상자 글'))}</w:p>" + f"<w:p>{make_drawing_run('a.png')}</w:p>"

    result = _read(body, media={"a.png": TINY_PNG})

    assert [(block.part, block.text) for block in result.blocks if block.kind == "paragraph"] == [("textbox", "상자 글")]
    assert [block.image_part for block in _figures(result)] == [None, "word/media/a.png"]
    assert not any(SIGNAL_DRAWING in block.signals for block in result.blocks)


def test_canvas_without_shapes_is_not_a_drawing() -> None:
    result = _read(f"<w:p>{make_canvas_run('')}</w:p>")

    assert [(block.kind, block.image_part) for block in result.blocks] == [("figure", None)]


def test_render_draws_a_png_and_unknown_shapes_as_boxes() -> None:
    shapes = make_flow_shape_xml("cloudCallout", (0, 0, 1828800, 457200), "모르는 모양") + make_flow_shape_xml(
        "bentConnector3", (0, 457200, 914400, 457200), connector=True
    )
    drawing = _figures(_read(f"<w:p>{make_canvas_run(shapes)}</w:p>"))[0].signals[SIGNAL_DRAWING]

    image = Image.open(BytesIO(render_drawing_png(drawing)))

    assert image.format == "PNG"
    # 4.5인치(432px) 캔버스를 1.4배로 + 여백
    assert image.size == (round(4114800 / 9525 * 1.4) + 16, round(3429000 / 9525 * 1.4) + 16)
    # 모르는 모양도 테두리를 그린다 — 도형 왼쪽 위 모서리 근처에 잉크가 있다
    assert image.convert("L").crop((8, 8, 20, 20)).getextrema()[0] < 128


def test_render_rejects_a_drawing_without_size() -> None:
    with pytest.raises(ValueError):
        render_drawing_png({"w": 0, "h": 100, "items": []})


def test_huge_canvas_stays_within_limits() -> None:
    """도형이 상한보다 많은 캔버스 — 남기는 도형 수와 그림 크기가 상한 안이고 빨리 끝난다."""
    shapes = "".join(
        make_flow_shape_xml("rect", ((index % 20) * 600000, (index // 20) * 300000, 500000, 200000), f"상자 {index}")
        for index in range(MAX_ITEMS + 100)
    )
    drawing = _figures(_read(f"<w:p>{make_canvas_run(shapes)}</w:p>"))[0].signals[SIGNAL_DRAWING]

    started = perf_counter()
    image = Image.open(BytesIO(render_drawing_png(drawing)))

    assert len(drawing["items"]) == MAX_ITEMS
    assert image.width <= MAX_WIDTH and image.height <= MAX_HEIGHT
    assert perf_counter() - started < 10


def test_figure_endpoint_draws_the_flowchart_and_view_lists_its_texts(client: TestClient) -> None:
    bundle = create_bundle(client)
    data = build_docx(p("본문 문장이다.") + _flow_in_cell(make_canvas_run(wrapped=True)))
    doc = upload(client, bundle["id"], data, "SYNTHETIC_SOP-QC-00077_flow.docx").json()
    view = get_view(client, bundle["id"], doc["id"])
    figure = next(block for block in view["blocks"] if block["kind"] == "figure")

    image = client.get(f"/api/bundles/{bundle['id']}/documents/{doc['id']}/figures/{figure['id']}", headers=AUTHOR)

    assert figure["has_image"] is True
    assert figure["figure_texts"] == FLOW_TEXTS
    assert all(block["figure_texts"] == [] for block in view["blocks"] if block["kind"] != "figure")
    assert not any("공정 시작" in unit["text"] for unit in view["units"])
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert Image.open(BytesIO(image.content)).format == "PNG"


def test_render_ignores_huge_line_widths_and_text_sizes() -> None:
    """문서가 적은 선 굵기 · 글자 크기는 믿지 않는다 — 조작한 큰 값도 상한 안에서 금방 그린다."""
    item = {
        "geom": "rect", "x": 0, "y": 0, "w": 914400, "h": 457200, "rot": 0, "fh": False, "fv": False, "line": True,
        "lw": 10**12, "head": "", "tail": "triangle", "conn": False, "text": "가" * 300, "sz": 10**9,
    }
    drawing = {"w": 914400, "h": 457200, "items": [item, {**item, "geom": "line", "conn": True, "text": ""}]}

    started = perf_counter()
    image = Image.open(BytesIO(render_drawing_png(drawing)))

    assert image.format == "PNG"
    assert perf_counter() - started < 5
