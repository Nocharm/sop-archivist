"""도형 그림 읽기 — Word 도형 캔버스(wpc)·도형 묶음(wpg) 안 도형(wps)을 간이 그림 재료(평범한 dict)로 바꾼다(순수 함수).

업무흐름도는 그림 파일이 아니라 도형으로 그려져 있다. 도형마다 자리·크기·모양·선·화살표·글을 읽어 블록 신호 "drawing"에 남기고,
그림은 보낼 때 그린다(sop.drawing_image). 도형 안 글은 문단으로 내지 않고 그림 안 글(list_drawing_texts)로만 보인다.
자식 프로세스 경계를 넘어 피클되므로 dict·list·str·int·bool만 쓴다.
"""

from collections.abc import Iterator
from xml.etree.ElementTree import Element

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
WPC = "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
WPG = "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"

WP_INLINE, WP_ANCHOR, WP_EXTENT = f"{{{WP}}}inline", f"{{{WP}}}anchor", f"{{{WP}}}extent"
A_GRAPHIC, A_GRAPHIC_DATA = f"{{{A}}}graphic", f"{{{A}}}graphicData"
A_XFRM, A_OFF, A_EXT, A_CH_OFF, A_CH_EXT = (
    f"{{{A}}}xfrm", f"{{{A}}}off", f"{{{A}}}ext", f"{{{A}}}chOff", f"{{{A}}}chExt",
)
A_PRST_GEOM, A_LN, A_NO_FILL, A_HEAD_END, A_TAIL_END = (
    f"{{{A}}}prstGeom", f"{{{A}}}ln", f"{{{A}}}noFill", f"{{{A}}}headEnd", f"{{{A}}}tailEnd",
)
WPC_WPC, WPG_WGP, WPG_GRP_SP, WPG_GRP_SP_PR = f"{{{WPC}}}wpc", f"{{{WPG}}}wgp", f"{{{WPG}}}grpSp", f"{{{WPG}}}grpSpPr"
WPS_WSP, WPS_SP_PR, WPS_CNV_CN_PR, WPS_TXBX = f"{{{WPS}}}wsp", f"{{{WPS}}}spPr", f"{{{WPS}}}cNvCnPr", f"{{{WPS}}}txbx"
PIC_PIC, PIC_SP_PR = f"{{{PIC}}}pic", f"{{{PIC}}}spPr"
W_TXBX_CONTENT, W_P, W_T, W_TAB, W_BR, W_SZ = (
    f"{{{W}}}txbxContent", f"{{{W}}}p", f"{{{W}}}t", f"{{{W}}}tab", f"{{{W}}}br", f"{{{W}}}sz",
)

SIGNAL_DRAWING = "drawing"  # 블록 신호 열쇠 — 값은 read_drawing의 dict
MAX_ITEMS = 500  # 그림 하나에 남기는 도형 수 — 조작한 캔버스가 신호(DB JSON)와 그리기 시간을 끝없이 늘리지 못하게(실사례 최대 27)
MAX_TEXT_CHARS = 300  # 도형 하나의 글 길이 상한 — 흐름도 상자 글은 짧다
MAX_GROUP_DEPTH = 8  # 묶음 안 묶음 깊이 상한
ROT_UNIT = 60000  # a:xfrm rot 단위(1도 = 60000)

Transform = tuple[float, float, float, float]  # 바깥 좌표 = 안 좌표 × (sx, sy) + (tx, ty)
_IDENTITY: Transform = (1.0, 1.0, 0.0, 0.0)


def read_drawing(drawing: Element) -> dict[str, object] | None:
    """w:drawing 하나 → 도형 그림 재료. 캔버스·묶음 안에 도형이 하나도 없으면 None(보통 그림·글상자로 읽는다).

    결과: {"w", "h": 그림 크기(EMU), "items": [도형…]} — 도형은 {"geom", "x", "y", "w", "h"(그림 왼쪽 위 기준 EMU),
    "rot"(도), "fh", "fv"(뒤집기), "line"(테두리 보임), "lw"(선 굵기 EMU), "head", "tail"(선 끝 모양, 없으면 ""),
    "conn"(연결선), "text"(줄은 "\\n"), "sz"(글자 크기, 반 포인트, 모르면 0)}.
    """
    frame = next((child for child in drawing if child.tag in (WP_INLINE, WP_ANCHOR)), None)
    if frame is None:
        return None
    extent = frame.find(WP_EXTENT)
    data = frame.find(f"{A_GRAPHIC}/{A_GRAPHIC_DATA}")
    if extent is None or data is None:
        return None
    width, height = _read_int(extent, "cx"), _read_int(extent, "cy")
    root = next((child for child in data if child.tag in (WPC_WPC, WPG_WGP)), None)
    if root is None or width <= 0 or height <= 0:
        return None
    items: list[dict[str, object]] = []
    if root.tag == WPC_WPC:
        _read_children(root, _IDENTITY, items, 0)  # 캔버스 안 도형 좌표는 이미 캔버스 왼쪽 위 기준이다
    else:
        # 맨 바깥 묶음은 제 틀이 그림 틀이다 — 자식 좌표(chOff·chExt)를 그림 크기(extent)에 맞춘다
        group_xfrm = root.find(f"{WPG_GRP_SP_PR}/{A_XFRM}")
        _read_children(root, _fit_group(group_xfrm, (0, 0, width, height), _IDENTITY), items, 0)
    if not any(item["geom"] != "pic" for item in items):
        return None
    return {"w": width, "h": height, "items": items}


def list_drawing_texts(drawing: object) -> list[str]:
    """도형 그림의 그림 안 글 — 위에서 아래, 같은 높이면 왼쪽부터(흐름도는 위에서 아래로 읽는다). 빈 글은 뺀다."""
    if not isinstance(drawing, dict):
        return []
    items = [item for item in drawing.get("items", []) if isinstance(item, dict) and str(item.get("text", "")).strip()]
    items.sort(key=lambda item: (int(item.get("y", 0)), int(item.get("x", 0))))
    return [" ".join(str(item["text"]).split()) for item in items]


def _read_children(parent: Element, transform: Transform, items: list[dict[str, object]], depth: int) -> None:
    for child in parent:
        if len(items) >= MAX_ITEMS:
            return
        if child.tag == WPS_WSP:
            item = _read_shape(child, transform)
            if item is not None:
                items.append(item)
        elif child.tag == PIC_PIC:
            box = _read_box(child.find(f"{PIC_SP_PR}/{A_XFRM}"), transform)
            if box is not None:
                items.append(_make_item("pic", box, rot=0.0, flips=(False, False), line=True, line_width=0, ends=("", "")))
        elif child.tag == WPG_GRP_SP and depth < MAX_GROUP_DEPTH:
            group_xfrm = child.find(f"{WPG_GRP_SP_PR}/{A_XFRM}")
            box = _read_raw_box(group_xfrm)
            if box is not None:
                _read_children(child, _fit_group(group_xfrm, box, transform), items, depth + 1)


def _read_shape(shape: Element, transform: Transform) -> dict[str, object] | None:
    sp_pr = shape.find(WPS_SP_PR)
    if sp_pr is None:
        return None
    xfrm = sp_pr.find(A_XFRM)
    box = _read_box(xfrm, transform)
    if box is None:
        return None
    geom_element = sp_pr.find(A_PRST_GEOM)
    geom = geom_element.get("prst", "rect") if geom_element is not None else "rect"
    line = sp_pr.find(A_LN)
    has_line = line is None or line.find(A_NO_FILL) is None
    ends = ("", "")
    line_width = 0
    if line is not None:
        line_width = _read_int(line, "w")
        ends = (_read_end(line.find(A_HEAD_END)), _read_end(line.find(A_TAIL_END)))
    item = _make_item(
        geom,
        box,
        rot=_read_int(xfrm, "rot") / ROT_UNIT if xfrm is not None else 0.0,
        flips=(_is_true(xfrm, "flipH"), _is_true(xfrm, "flipV")),
        line=has_line,
        line_width=line_width,
        ends=ends,
    )
    item["conn"] = shape.find(WPS_CNV_CN_PR) is not None
    content = shape.find(f"{WPS_TXBX}/{W_TXBX_CONTENT}")
    if content is not None:
        item["text"], item["sz"] = _read_box_text(content)
    return item


def _make_item(
    geom: str,
    box: tuple[int, int, int, int],
    *,
    rot: float,
    flips: tuple[bool, bool],
    line: bool,
    line_width: int,
    ends: tuple[str, str],
) -> dict[str, object]:
    x, y, width, height = box
    return {
        "geom": geom[:40], "x": x, "y": y, "w": width, "h": height, "rot": round(rot, 2), "fh": flips[0], "fv": flips[1],
        "line": line, "lw": line_width, "head": ends[0], "tail": ends[1], "conn": False, "text": "", "sz": 0,
    }


def _read_box_text(content: Element) -> tuple[str, int]:
    """글상자 글(문단은 줄 하나)과 처음 만난 글자 크기(반 포인트, 없으면 0)."""
    lines: list[str] = []
    size = 0
    for paragraph in content.iter(W_P):
        pieces: list[str] = []
        for node in _iter_own(paragraph):
            if node.tag == W_T:
                pieces.append(node.text or "")
            elif node.tag == W_TAB:
                pieces.append(" ")
            elif node.tag == W_BR:
                pieces.append("\n")
            elif node.tag == W_SZ and not size:
                size = _read_int(node, f"{{{W}}}val")
        lines.append("".join(pieces))
    text = "\n".join(lines).strip()
    return text[:MAX_TEXT_CHARS], size


def _iter_own(paragraph: Element) -> Iterator[Element]:
    """문단 안 요소 — 안쪽 문단(글상자 속 글상자)은 제 차례에 따로 읽으므로 내려가지 않는다."""
    for child in paragraph:
        if child.tag == W_P:
            continue
        yield child
        yield from _iter_own(child)


def _fit_group(xfrm: Element | None, box: tuple[int, int, int, int], transform: Transform) -> Transform:
    """묶음 자식 좌표 → 바깥 좌표 변환. box는 바깥 좌표계의 묶음 틀(off·ext), 자식 좌표계는 chOff·chExt."""
    x, y, width, height = box
    ch_off = xfrm.find(A_CH_OFF) if xfrm is not None else None
    ch_ext = xfrm.find(A_CH_EXT) if xfrm is not None else None
    child_x, child_y = (_read_int(ch_off, "x"), _read_int(ch_off, "y")) if ch_off is not None else (0, 0)
    child_w, child_h = (_read_int(ch_ext, "cx"), _read_int(ch_ext, "cy")) if ch_ext is not None else (width, height)
    scale_x = width / child_w if child_w > 0 else 1.0
    scale_y = height / child_h if child_h > 0 else 1.0
    # 묶음 안: inner = (p - chOff) × scale + off, 그다음 바깥 변환
    sx, sy, tx, ty = transform
    return (sx * scale_x, sy * scale_y, sx * (x - child_x * scale_x) + tx, sy * (y - child_y * scale_y) + ty)


def _read_raw_box(xfrm: Element | None) -> tuple[int, int, int, int] | None:
    if xfrm is None:
        return None
    off, ext = xfrm.find(A_OFF), xfrm.find(A_EXT)
    if off is None or ext is None:
        return None
    return _read_int(off, "x"), _read_int(off, "y"), max(_read_int(ext, "cx"), 0), max(_read_int(ext, "cy"), 0)


def _read_box(xfrm: Element | None, transform: Transform) -> tuple[int, int, int, int] | None:
    raw = _read_raw_box(xfrm)
    if raw is None:
        return None
    x, y, width, height = raw
    sx, sy, tx, ty = transform
    return round(x * sx + tx), round(y * sy + ty), round(width * sx), round(height * sy)


def _read_end(end: Element | None) -> str:
    kind = end.get("type", "none") if end is not None else "none"
    return "" if kind == "none" else kind[:20]


def _read_int(element: Element | None, name: str) -> int:
    if element is None:
        return 0
    try:
        return int(element.get(name, "0"))
    except ValueError:
        return 0


def _is_true(element: Element | None, name: str) -> bool:
    return element is not None and element.get(name, "0") in ("1", "true", "on")
