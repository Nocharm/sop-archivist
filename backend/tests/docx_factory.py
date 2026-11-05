"""테스트용 최소 DOCX — python-docx 없이 WordprocessingML을 zip에 직접 써서 Word가 여는 파일을 만든다."""

import itertools
import zipfile
from collections.abc import Mapping, Sequence
from io import BytesIO
from xml.sax.saxutils import escape

NAMESPACES = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
    'xmlns:v="urn:schemas-microsoft-com:vml" '
    'xmlns:o="urn:schemas-microsoft-com:office:office"'
)
XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT = "application/vnd.openxmlformats-officedocument.wordprocessingml"
# 1×1 투명 PNG — 그림 블록의 image_part가 가리킬 실제 미디어
TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082"
)
STYLES_XML = (
    f"<w:styles {NAMESPACES}>"
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
    '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>'
    '<w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
    '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/></w:style>'
    "</w:styles>"
)
_MEDIA_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif"}
# 머리말·꼬리말을 구역에 거는 종류 — Word는 종류마다 하나씩만 받는다
_SECTION_REF_TYPES = ("default", "first", "even")
# 문서 안 그림마다 다른 docPr id — 같은 id가 겹치면 Word가 복구를 묻는다
_drawing_ids = itertools.count(1)


def p(text: str, style: str | None = None) -> str:
    """문단 하나 — 글자는 xml:space="preserve"로 앞뒤 공백까지 그대로 둔다."""
    p_pr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    run = f'<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r>' if text else ""
    return f"<w:p>{p_pr}{run}</w:p>"


def tbl(rows: list[list[str]]) -> str:
    """병합 없는 표 — 칸마다 글자 문단 하나, 열 수는 첫 행 기준."""
    grid = "".join('<w:gridCol w:w="2000"/>' for _ in rows[0])
    body = "".join("<w:tr>" + "".join(f"<w:tc>{p(text)}</w:tc>" for text in row) + "</w:tr>" for row in rows)
    return f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{body}</w:tbl>'


def get_media_rel_id(name: str) -> str:
    """build_docx(media=…)가 미디어마다 붙이는 관계 id."""
    return "rIdMedia_" + name.replace(".", "_")


def make_drawing_run(media_name: str) -> str:
    """media_name 그림을 담은 인라인 그림 run — 문단 안에 넣어 쓴다."""
    n = next(_drawing_ids)
    return (
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="914400" cy="914400"/><wp:docPr id="{n}" name="Picture {n}"/>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f'<pic:pic><pic:nvPicPr><pic:cNvPr id="{n}" name="{escape(media_name)}"/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{get_media_rel_id(media_name)}"/><a:stretch><a:fillRect/></a:stretch>'
        '</pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
        "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
    )


def make_textbox_run(content_xml: str) -> str:
    """Word가 저장하는 모양의 텍스트 상자 run — Choice(DrawingML)와 Fallback(VML)이 같은 글을 두 번 담는다."""
    n = next(_drawing_ids)
    return (
        '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>'
        '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" '
        'locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>'
        '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>'
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
        f'<wp:extent cx="1828800" cy="457200"/><wp:wrapNone/><wp:docPr id="{n}" name="Text Box {n}"/>'
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
        '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>'
        '<a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>'
        f"<wps:txbx><w:txbxContent>{content_xml}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>"
        "</a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>"
        '<mc:Fallback><w:pict><v:shape type="#_x0000_t202" style="width:144pt;height:36pt">'
        f"<v:textbox><w:txbxContent>{content_xml}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>"
        "</mc:AlternateContent></w:r>"
    )


def build_docx(
    body_xml: str,
    *,
    headers: Sequence[str] = (),
    footers: Sequence[str] = (),
    footnotes: Sequence[str] = (),
    endnotes: Sequence[str] = (),
    media: Mapping[str, bytes] = {},
    alt_chunks: Sequence[str] = (),
) -> bytes:
    """최소 DOCX 바이트 — 머리말·꼬리말은 구역에 걸고, 미디어 관계 id는 get_media_rel_id, altChunk는 rIdAltChunk{n}."""
    files: dict[str, bytes] = {"word/styles.xml": (XML_DECL + STYLES_XML).encode()}
    overrides = {"/word/document.xml": f"{CT}.document.main+xml", "/word/styles.xml": f"{CT}.styles+xml"}
    defaults = {"rels": "application/vnd.openxmlformats-package.relationships+xml", "xml": "application/xml"}
    rels = [("rIdStyles", f"{REL}/styles", "styles.xml")]
    section_refs = []
    for kind, root, contents in (("header", "w:hdr", headers), ("footer", "w:ftr", footers)):
        for n, content in enumerate(contents, start=1):
            files[f"word/{kind}{n}.xml"] = f"{XML_DECL}<{root} {NAMESPACES}>{content}</{root}>".encode()
            overrides[f"/word/{kind}{n}.xml"] = f"{CT}.{kind}+xml"
            rels.append((f"rId{kind.title()}{n}", f"{REL}/{kind}", f"{kind}{n}.xml"))
        section_refs += [
            f'<w:{kind}Reference w:type="{ref_type}" r:id="rId{kind.title()}{n}"/>'
            for n, ref_type in enumerate(_SECTION_REF_TYPES[: len(contents)], start=1)
        ]
    for kind, contents in (("footnote", footnotes), ("endnote", endnotes)):
        if contents:
            files[f"word/{kind}s.xml"] = _build_notes(kind, contents).encode()
            overrides[f"/word/{kind}s.xml"] = f"{CT}.{kind}s+xml"
            rels.append((f"rId{kind.title()}s", f"{REL}/{kind}s", f"{kind}s.xml"))
    for name, content in media.items():
        files[f"word/media/{name}"] = content
        extension = name.rsplit(".", 1)[-1].lower()
        defaults[extension] = _MEDIA_TYPES.get(extension, "application/octet-stream")
        rels.append((get_media_rel_id(name), f"{REL}/image", f"media/{name}"))
    for n, html in enumerate(alt_chunks, start=1):
        files[f"word/afchunk{n}.htm"] = html.encode()
        defaults["htm"] = "text/html"
        rels.append((f"rIdAltChunk{n}", f"{REL}/aFChunk", f"afchunk{n}.htm"))
    files["word/document.xml"] = (
        f"{XML_DECL}<w:document {NAMESPACES}><w:body>{body_xml}"
        f"<w:sectPr>{''.join(section_refs)}</w:sectPr></w:body></w:document>"
    ).encode()
    files["word/_rels/document.xml.rels"] = _build_rels(rels).encode()
    files["_rels/.rels"] = _build_rels([("rId1", f"{REL}/officeDocument", "word/document.xml")]).encode()
    content_types = (
        f'{XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + "".join(f'<Default Extension="{ext}" ContentType="{ctype}"/>' for ext, ctype in defaults.items())
        + "".join(f'<Override PartName="{part}" ContentType="{ctype}"/>' for part, ctype in overrides.items())
        + "</Types>"
    )
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _build_notes(kind: str, contents: Sequence[str]) -> str:
    """각주·미주 부분 — Word처럼 구분선 두 개(id -1, 0)를 앞에 두고 실제 주석은 1부터."""
    separators = (
        f'<w:{kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:{kind}>'
        f'<w:{kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p>'
        f"</w:{kind}>"
    )
    notes = "".join(f'<w:{kind} w:id="{n}">{content}</w:{kind}>' for n, content in enumerate(contents, start=1))
    return f"{XML_DECL}<w:{kind}s {NAMESPACES}>{separators}{notes}</w:{kind}s>"


def _build_rels(rels: Sequence[tuple[str, str, str]]) -> str:
    items = "".join(f'<Relationship Id="{rid}" Type="{rtype}" Target="{target}"/>' for rid, rtype, target in rels)
    return f'{XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{items}</Relationships>'
