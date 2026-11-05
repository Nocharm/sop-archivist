"""결과물 B 흐름도 그림 — 옛 문서(왼쪽)에서 보낸 곳(오른쪽)으로 건수에 비례하는 굵기의 선을 그린 PNG (Excel 내보내기용).

서버는 외부에서 글꼴을 받을 수 없어 저장소에 넣은 OFL 한글 글꼴(assets/fonts)만 쓴다. 모양은 읽기 쉬운 쪽을 택했다:
선 굵기가 건수, 노드는 이름·제목·숫자, 미배정 노드는 빨간 굵은 테두리로 눈에 띄게 한다.
"""

from collections import defaultdict
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.sop.outputs import FlowEdge, FlowGraph, FlowNode

FONT_PATH = Path(__file__).parent / "assets" / "fonts" / "NanumGothic-Regular.ttf"

SCALE = 2  # 2배로 그린 뒤 줄여 선·글자 가장자리를 부드럽게 한다
WIDTH = 1100  # 최종 그림 폭(px). Excel에는 이 크기 그대로 들어간다
MARGIN = 30
BOX_W, BOX_H, BOX_GAP = 340, 54, 16
HEAD_H = 36  # 열 머리 글자 줄 높이
FOOT_H = 28  # 생략 안내 줄 높이
MAX_COLUMN_NODES = 30  # 열마다 그리는 노드 수 상한 — 그림 크기(메모리)가 문서 수에 비례해 커지지 않게. 전체 건수는 표에 있다
MIN_LINE_W, MAX_LINE_W = 1.5, 14.0  # 건수 비례 선 굵기의 범위(px)
LINE_ALPHA = 150  # 겹친 선이 비쳐 보이도록 반투명

Color = tuple[int, int, int]
KIND_COLORS: dict[str, Color] = {
    "old": (84, 98, 124),
    "sop": (40, 98, 196),
    "wi": (18, 134, 124),
    "delete": (120, 120, 120),
    "move_external": (214, 126, 24),
    "unassigned": (200, 40, 40),
}
INK: Color = (30, 34, 44)
MUTED: Color = (110, 116, 130)
CAPTIONS = {"ko": ("옛 문서 (단위 수)", "보낸 곳 (건수)"), "en": ("Old documents (units)", "Destinations (count)")}
OMITTED_NOTES = {"ko": "건수가 적은 {count}개는 그리지 않음 (표 참고)", "en": "{count} smaller nodes not drawn (see the table)"}


@lru_cache(maxsize=None)
def _load_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size * SCALE)


def _fit_text(text: str, font: ImageFont.FreeTypeFont, max_width: float) -> str:
    """상자 폭에 들어가게 뒤를 …로 줄인다."""
    if font.getlength(text) <= max_width:
        return text
    while text and font.getlength(text + "…") > max_width:
        text = text[:-1]
    return text + "…"


def _mix_with_white(color: Color, ratio: float) -> Color:
    return (
        round(255 - (255 - color[0]) * ratio),
        round(255 - (255 - color[1]) * ratio),
        round(255 - (255 - color[2]) * ratio),
    )


def _sample_curve(x0: float, y0: float, x1: float, y1: float, steps: int = 48) -> list[tuple[float, float]]:
    """가로로 나갔다 가로로 들어오는 3차 베지어 곡선의 점들."""
    mid = (x0 + x1) / 2
    points = []
    for step in range(steps + 1):
        t = step / steps
        u = 1 - t
        points.append((
            u**3 * x0 + 3 * u * u * t * mid + 3 * u * t * t * mid + t**3 * x1,
            u**3 * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t**3 * y1,
        ))
    return points


def _limit_nodes(nodes: list[FlowNode]) -> tuple[list[FlowNode], int]:
    """상한을 넘으면 건수가 큰 노드만 원래 순서대로 남기고, 뺀 노드 수를 함께 돌려준다."""
    if len(nodes) <= MAX_COLUMN_NODES:
        return nodes, 0
    kept = {node.id for node in sorted(nodes, key=lambda node: -node.count)[:MAX_COLUMN_NODES]}
    return [node for node in nodes if node.id in kept], len(nodes) - MAX_COLUMN_NODES


def _place_column(nodes: list[FlowNode], x: float, rows: int) -> dict[str, tuple[float, float]]:
    """열의 노드 왼쪽 위 좌표 — 더 짧은 열은 위아래 가운데로 맞춘다."""
    pitch = BOX_H + BOX_GAP
    top = MARGIN + HEAD_H + (rows - len(nodes)) * pitch / 2
    return {node.id: (x, top + index * pitch) for index, node in enumerate(nodes)}


def _draw_edges(
    overlay: ImageDraw.ImageDraw, edges: list[FlowEdge], boxes: dict[str, tuple[float, float]],
    nodes: dict[str, FlowNode],
) -> None:
    """선 끝은 노드 변을 따라 흩어 붙이고(맞은편 높이 순), 굵기는 건수에 비례한다."""
    edges = [edge for edge in edges if edge.source in boxes and edge.target in boxes]
    center = {node_id: top + BOX_H / 2 for node_id, (_, top) in boxes.items()}
    outgoing: dict[str, list[FlowEdge]] = defaultdict(list)
    incoming: dict[str, list[FlowEdge]] = defaultdict(list)
    for edge in sorted(edges, key=lambda e: (center[e.target], center[e.source])):
        outgoing[edge.source].append(edge)
    for edge in sorted(edges, key=lambda e: (center[e.source], center[e.target])):
        incoming[edge.target].append(edge)
    max_count = max((edge.count for edge in edges), default=1)
    for edge in edges:
        out_group, in_group = outgoing[edge.source], incoming[edge.target]
        y0 = boxes[edge.source][1] + BOX_H * (out_group.index(edge) + 1) / (len(out_group) + 1)
        y1 = boxes[edge.target][1] + BOX_H * (in_group.index(edge) + 1) / (len(in_group) + 1)
        width = MIN_LINE_W + (MAX_LINE_W - MIN_LINE_W) * edge.count / max_count
        color = KIND_COLORS.get(nodes[edge.target].kind, KIND_COLORS["old"])
        points = _sample_curve(boxes[edge.source][0] + BOX_W, y0, boxes[edge.target][0], y1)
        overlay.line(
            [(x * SCALE, y * SCALE) for x, y in points], fill=(*color, LINE_ALPHA), width=round(width * SCALE),
            joint="curve",
        )


def _draw_node(draw: ImageDraw.ImageDraw, node: FlowNode, x: float, y: float) -> None:
    color = KIND_COLORS.get(node.kind, KIND_COLORS["old"])
    is_alert = node.kind == "unassigned"
    draw.rounded_rectangle(
        [x * SCALE, y * SCALE, (x + BOX_W) * SCALE, (y + BOX_H) * SCALE], radius=8 * SCALE,
        fill=_mix_with_white(color, 0.22 if is_alert else 0.1), outline=color, width=(4 if is_alert else 2) * SCALE,
    )
    count_font, label_font, title_font = _load_font(20), _load_font(17), _load_font(13)
    count_text = f"{node.count:,}"
    draw.text(((x + BOX_W - 14) * SCALE, (y + BOX_H / 2) * SCALE), count_text, font=count_font, fill=color, anchor="rm")
    max_width = (BOX_W - 28) * SCALE - count_font.getlength(count_text) - 12 * SCALE
    label = _fit_text(node.label, label_font, max_width)
    if node.title:
        draw.text(((x + 14) * SCALE, (y + 9) * SCALE), label, font=label_font, fill=INK, anchor="la")
        draw.text(
            ((x + 14) * SCALE, (y + 32) * SCALE), _fit_text(node.title, title_font, max_width), font=title_font,
            fill=MUTED, anchor="la",
        )
    else:
        draw.text(((x + 14) * SCALE, (y + BOX_H / 2) * SCALE), label, font=label_font, fill=INK, anchor="lm")


def draw_flow_png(graph: FlowGraph, lang: str) -> bytes:
    """흐름도 PNG — 왼쪽 열은 옛 문서, 오른쪽 열은 보낸 곳(새 문서·삭제·이동·미배정). 노드가 없으면 머리 글자만 그린다."""
    left, left_omitted = _limit_nodes([node for node in graph.nodes if node.kind == "old"])
    right, right_omitted = _limit_nodes([node for node in graph.nodes if node.kind != "old"])
    rows = max(len(left), len(right))
    body_bottom = MARGIN + HEAD_H + max(rows, 1) * (BOX_H + BOX_GAP) - BOX_GAP
    height = body_bottom + MARGIN + (FOOT_H if left_omitted or right_omitted else 0)
    size = (WIDTH * SCALE, height * SCALE)

    boxes = {**_place_column(left, MARGIN, rows), **_place_column(right, WIDTH - MARGIN - BOX_W, rows)}
    nodes = {node.id: node for node in graph.nodes}
    overlay = Image.new("RGBA", size, (255, 255, 255, 0))
    _draw_edges(ImageDraw.Draw(overlay), graph.edges, boxes, nodes)
    canvas = Image.new("RGB", size, (255, 255, 255))
    canvas.paste(overlay, (0, 0), overlay)  # 반투명 선을 흰 바탕에 얹는다(합성 사본을 따로 만들지 않아 메모리를 아낀다)
    del overlay

    draw = ImageDraw.Draw(canvas)
    left_caption, right_caption = CAPTIONS.get(lang, CAPTIONS["en"])
    caption_font = _load_font(15)
    draw.text((MARGIN * SCALE, MARGIN * SCALE), left_caption, font=caption_font, fill=MUTED, anchor="la")
    draw.text(((WIDTH - MARGIN) * SCALE, MARGIN * SCALE), right_caption, font=caption_font, fill=MUTED, anchor="ra")
    for node_id, (x, y) in boxes.items():
        _draw_node(draw, nodes[node_id], x, y)
    note = OMITTED_NOTES.get(lang, OMITTED_NOTES["en"])
    if left_omitted:
        draw.text(
            (MARGIN * SCALE, (body_bottom + 10) * SCALE), note.format(count=left_omitted), font=caption_font,
            fill=MUTED, anchor="la",
        )
    if right_omitted:
        draw.text(
            ((WIDTH - MARGIN) * SCALE, (body_bottom + 10) * SCALE), note.format(count=right_omitted),
            font=caption_font, fill=MUTED, anchor="ra",
        )

    buffer = BytesIO()
    canvas.resize((WIDTH, height), Image.Resampling.LANCZOS).save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
