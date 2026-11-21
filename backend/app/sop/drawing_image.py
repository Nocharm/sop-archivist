"""도형 그림 PNG — 추출기가 남긴 도형 재료(extract.drawing.read_drawing)로 업무흐름도를 간이 그림으로 그린다.

원본 Word 렌더러가 아니라 모양·선·화살표·글만 흑백으로 다시 그린다(원본과 다를 수 있다 — 설명서에 적는다). 서버는 외부 렌더러를
쓸 수 없어 PIL과 저장소의 한글 글꼴만 쓴다. 2배로 그린 뒤 줄여 가장자리를 부드럽게 한다(flow_image와 같은 방식).
"""

import math
from functools import cache
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_PATH = Path(__file__).parent / "assets" / "fonts" / "NanumGothic-Regular.ttf"

SCALE = 2  # 2배로 그린 뒤 줄인다
EMU_PER_PX = 9525  # 96 dpi에서 1px
MAX_ZOOM = 1.4  # 원래 크기(96 dpi)보다 이만큼까지 키운다 — 작은 흐름도 글도 읽히게
MAX_WIDTH, MAX_HEIGHT = 1000, 3000  # 최종 그림 크기 상한(px) — 큰 캔버스도 메모리가 일정 안에 머물게
MARGIN = 8  # 바깥 여백(px)
DEFAULT_TEXT_SIZE = 20  # 글자 크기를 모를 때(반 포인트 = 10pt)
DEFAULT_LINE_EMU = 9525  # 선 굵기를 모를 때(0.75pt)
TEXT_PAD = 3  # 도형 안 글 여백(px)
ARROW_LEN = 7.0  # 화살촉 길이(px, 확대 전) — 선이 굵으면 함께 커진다
INK = (30, 34, 44)
PIC_INK = (150, 154, 164)  # 캔버스 안 사진 자리 테두리
WHITE = (255, 255, 255)
ELLIPSE_STEPS = 48

Point = tuple[float, float]

# 모양 → 단위 상자(0..1) 안 다각형. 여기 없는 모양(rect·flowChartProcess·모르는 모양)은 네모
_ROUNDS = frozenset({"roundRect", "flowChartAlternateProcess", "round1Rect", "round2SameRect"})
_STADIUMS = frozenset({"flowChartTerminator"})
_ELLIPSES = frozenset({"ellipse", "flowChartConnector", "flowChartOr", "flowChartSummingJunction", "donut"})
_DIAMONDS = frozenset({"diamond", "flowChartDecision"})
_PARALLELOGRAMS = frozenset({"parallelogram", "flowChartInputOutput", "flowChartData"})
_HEXAGONS = frozenset({"hexagon", "flowChartPreparation"})
_TRIANGLES = frozenset({"triangle", "flowChartExtract"})
_DOWN_TRIANGLES = frozenset({"flowChartMerge"})
_BLOCK_ARROWS = {"rightArrow": 0, "downArrow": 90, "leftArrow": 180, "upArrow": 270}
_LINES = frozenset({"line", "straightConnector1"})
_BENT2 = frozenset({"bentConnector2"})
_BENT3 = frozenset({"bentConnector3", "bentConnector4", "bentConnector5", "curvedConnector3", "curvedConnector4", "curvedConnector5"})
_DOT_ENDS = frozenset({"oval", "diamond"})


def render_drawing_png(drawing: dict) -> bytes:
    """도형 그림 재료 → PNG 바이트. 재료가 틀렸으면 ValueError — 부르는 쪽이 그림 없음으로 다룬다."""
    width_px, height_px = drawing["w"] / EMU_PER_PX, drawing["h"] / EMU_PER_PX
    if width_px <= 0 or height_px <= 0:
        raise ValueError("drawing has no size")
    zoom = min(MAX_ZOOM, (MAX_WIDTH - 2 * MARGIN) / width_px, (MAX_HEIGHT - 2 * MARGIN) / height_px)
    out_w, out_h = round(width_px * zoom) + 2 * MARGIN, round(height_px * zoom) + 2 * MARGIN
    image = Image.new("RGB", (out_w * SCALE, out_h * SCALE), WHITE)
    draw = ImageDraw.Draw(image)
    unit = zoom * SCALE / EMU_PER_PX  # EMU → 그리는 px
    origin = MARGIN * SCALE
    for item in drawing["items"]:
        _draw_item(draw, item, unit, origin, zoom)
    image = image.resize((out_w, out_h), Image.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _draw_item(draw: ImageDraw.ImageDraw, item: dict, unit: float, origin: float, zoom: float) -> None:
    x, y = origin + item["x"] * unit, origin + item["y"] * unit
    width, height = item["w"] * unit, item["h"] * unit
    line_w = max(1, round((item.get("lw") or DEFAULT_LINE_EMU) * unit))
    geom = str(item.get("geom", "rect"))
    place = _make_placer(x, y, width, height, float(item.get("rot", 0)), bool(item.get("fh")), bool(item.get("fv")))
    if geom == "pic":
        draw.rectangle([x, y, x + width, y + height], outline=PIC_INK, width=line_w)
        return
    path = _get_line_path(geom)
    if path is not None or item.get("conn"):
        points = [place(point) for point in (path or [(0.0, 0.0), (1.0, 1.0)])]
        if item.get("line", True):
            draw.line(points, fill=INK, width=line_w, joint="curve")
            arrow = ARROW_LEN * zoom * SCALE + line_w * 1.5
            _draw_end(draw, str(item.get("head", "")), points[0], points[1], arrow)
            _draw_end(draw, str(item.get("tail", "")), points[-1], points[-2], arrow)
        return
    polygon = [place(point) for point in _get_outline(geom, width, height)]
    draw.polygon(polygon, fill=WHITE, outline=INK if item.get("line", True) else None, width=line_w)
    text = str(item.get("text", "")).strip()
    if text:
        size = item.get("sz") or DEFAULT_TEXT_SIZE
        _draw_text(draw, text, (x, y, width, height), size / 2 * 96 / 72 * zoom * SCALE, zoom)


def _make_placer(x: float, y: float, width: float, height: float, rot: float, flip_h: bool, flip_v: bool):
    """단위 상자 점 → 그리는 px. 뒤집기 다음 상자 가운데를 축으로 돌린다(Word와 같은 차례)."""
    center_x, center_y = x + width / 2, y + height / 2
    angle = math.radians(rot)
    cos, sin = math.cos(angle), math.sin(angle)

    def place(point: Point) -> Point:
        unit_x, unit_y = point
        if flip_h:
            unit_x = 1 - unit_x
        if flip_v:
            unit_y = 1 - unit_y
        dx, dy = (unit_x - 0.5) * width, (unit_y - 0.5) * height
        return center_x + dx * cos - dy * sin, center_y + dx * sin + dy * cos

    return place


def _get_line_path(geom: str) -> list[Point] | None:
    """선 모양의 단위 상자 꺾은선 — 선이 아니면 None. 꺾인 연결선은 가운데에서 한 번(기본 조절값 50%) 꺾는다."""
    if geom in _LINES:
        return [(0.0, 0.0), (1.0, 1.0)]
    if geom in _BENT2:
        return [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]
    if geom in _BENT3:
        return [(0.0, 0.0), (0.5, 0.0), (0.5, 1.0), (1.0, 1.0)]
    return None


def _get_outline(geom: str, width: float, height: float) -> list[Point]:
    """닫힌 모양의 단위 상자 다각형."""
    if geom in _ROUNDS:
        return _make_round_rect(width, height, min(width, height) * 0.1667)
    if geom in _STADIUMS:
        return _make_round_rect(width, height, min(width, height) / 2)
    if geom in _ELLIPSES:
        return [
            (0.5 + 0.5 * math.cos(2 * math.pi * step / ELLIPSE_STEPS), 0.5 + 0.5 * math.sin(2 * math.pi * step / ELLIPSE_STEPS))
            for step in range(ELLIPSE_STEPS)
        ]
    if geom in _DIAMONDS:
        return [(0.5, 0.0), (1.0, 0.5), (0.5, 1.0), (0.0, 0.5)]
    if geom in _PARALLELOGRAMS:
        return [(0.2, 0.0), (1.0, 0.0), (0.8, 1.0), (0.0, 1.0)]
    if geom in _HEXAGONS:
        return [(0.2, 0.0), (0.8, 0.0), (1.0, 0.5), (0.8, 1.0), (0.2, 1.0), (0.0, 0.5)]
    if geom in _TRIANGLES:
        return [(0.5, 0.0), (1.0, 1.0), (0.0, 1.0)]
    if geom in _DOWN_TRIANGLES:
        return [(0.0, 0.0), (1.0, 0.0), (0.5, 1.0)]
    if geom in _BLOCK_ARROWS:
        return _make_block_arrow(_BLOCK_ARROWS[geom])
    return [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]


def _make_round_rect(width: float, height: float, radius: float) -> list[Point]:
    if width <= 0 or height <= 0:
        return [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    rx, ry = radius / width, radius / height
    corners = ((1 - rx, ry, -90), (1 - rx, 1 - ry, 0), (rx, 1 - ry, 90), (rx, ry, 180))
    points: list[Point] = []
    for center_x, center_y, start in corners:
        for step in range(7):
            angle = math.radians(start + step * 15)
            points.append((center_x + rx * math.cos(angle), center_y + ry * math.sin(angle)))
    return points


def _make_block_arrow(degrees: int) -> list[Point]:
    """오른쪽 굵은 화살표를 degrees만큼 돌린 꼴(단위 상자 안)."""
    right = [(0.0, 0.25), (0.6, 0.25), (0.6, 0.0), (1.0, 0.5), (0.6, 1.0), (0.6, 0.75), (0.0, 0.75)]
    turns = {0: lambda p: p, 90: lambda p: (1 - p[1], p[0]), 180: lambda p: (1 - p[0], 1 - p[1]), 270: lambda p: (p[1], 1 - p[0])}
    return [turns[degrees](point) for point in right]


def _draw_end(draw: ImageDraw.ImageDraw, kind: str, tip: Point, before: Point, length: float) -> None:
    """선 끝 모양 — 화살촉(triangle·arrow·stealth)은 채운 세모, 동그라미·마름모 끝은 작은 점."""
    if not kind:
        return
    if kind in _DOT_ENDS:
        radius = length / 3
        draw.ellipse([tip[0] - radius, tip[1] - radius, tip[0] + radius, tip[1] + radius], fill=INK)
        return
    dx, dy = tip[0] - before[0], tip[1] - before[1]
    distance = math.hypot(dx, dy)
    if distance == 0:
        return
    ux, uy = dx / distance, dy / distance
    base_x, base_y = tip[0] - ux * length, tip[1] - uy * length
    half = length * 0.45
    draw.polygon([tip, (base_x - uy * half, base_y + ux * half), (base_x + uy * half, base_y - ux * half)], fill=INK)


@cache
def _load_font(pixels: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), pixels)


def _draw_text(draw: ImageDraw.ImageDraw, text: str, box: tuple[float, float, float, float], font_px: float, zoom: float) -> None:
    """도형 안 글 — 가운데 맞춤, 폭에 맞춰 글자 단위로 줄을 바꾼다(한글은 띄어쓰기 없이도 끊긴다). 넘치면 글자를 줄인다."""
    x, y, width, height = box
    pad = TEXT_PAD * zoom * SCALE
    inner_w, inner_h = max(width - 2 * pad, 1.0), max(height - 2 * pad, 1.0)
    pixels = max(round(font_px), 8)
    while True:
        font = _load_font(pixels)
        lines = _wrap(text, font, inner_w)
        line_h = pixels * 1.2
        if len(lines) * line_h <= inner_h or pixels <= 8 * SCALE:
            break
        pixels = max(pixels - SCALE, 8 * SCALE)
    top = y + (height - len(lines) * line_h) / 2
    for index, line in enumerate(lines):
        line_w = font.getlength(line)
        draw.text((x + (width - line_w) / 2, top + index * line_h), line, fill=INK, font=font)


def _wrap(text: str, font: ImageFont.FreeTypeFont, max_width: float) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        current = ""
        for char in paragraph:
            if current and font.getlength(current + char) > max_width:
                # 낱말 가운데서 끊지 않게 마지막 띄어쓰기로 돌아간다(없으면 글자에서 끊는다)
                cut = current.rfind(" ")
                if cut > 0:
                    lines.append(current[:cut])
                    current = current[cut + 1:]
                else:
                    lines.append(current)
                    current = ""
            current += char
        lines.append(current.strip())
    return lines
