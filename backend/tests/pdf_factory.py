"""테스트용 최소 PDF — 라이브러리 없이 객체·xref 표를 손으로 써서 텍스트 PDF와 글자 없는 스캔본을 만든다."""

import struct
from hashlib import md5
from io import BytesIO
from typing import Literal

from pdfminer.arcfour import Arcfour
from pdfminer.pdfdocument import PDFStandardSecurityHandler
from PIL import Image

LEADING = 14  # 줄 간격(pt) — 빈 줄은 줄 간격 한 칸을 더 내려 글자 사이를 벌린다
DOC_ID = b"synthetic-test-doc"  # 암호 키 계산에 들어가는 문서 id
EncryptMode = Literal["empty_password", "needs_password"]


def _escape(text: str) -> str:
    """PDF 문자열 리터럴에서 뜻이 있는 글자만 이스케이프한다(ASCII 전용)."""
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _make_content_stream(lines: list[str]) -> bytes:
    """한 쪽의 내용 — 빈 문자열은 글자 없이 한 줄만 내려가 문단 사이 빈 줄이 된다."""
    ops = ["BT", f"/F1 12 Tf {LEADING} TL", "72 720 Td"]
    for line in lines:
        ops.append(f"({_escape(line)}) Tj T*" if line else "T*")
    ops.append("ET")
    return "\n".join(ops).encode("ascii")


def _make_encrypt_dict(mode: EncryptMode) -> str:
    """표준 RC4 40비트(R2) /Encrypt 사전. empty_password는 빈 암호로 열리는 쓰기·복사 제한 PDF(pdfminer가 그냥 열어 준다),
    needs_password는 U 값이 틀려 암호를 물어보는 PDF다."""
    owner = bytes(range(32))
    permissions = -4
    key = md5(
        PDFStandardSecurityHandler.PASSWORD_PADDING + owner + struct.pack("<l", permissions) + DOC_ID
    ).digest()[:5]
    user = Arcfour(key).encrypt(PDFStandardSecurityHandler.PASSWORD_PADDING)
    if mode == "needs_password":
        user = bytes(32)
    return f"<< /Filter /Standard /V 1 /R 2 /O <{owner.hex()}> /U <{user.hex()}> /P {permissions} >>"


def build_text_pdf(pages: list[list[str]], *, encrypt: EncryptMode | None = None) -> bytes:
    """쪽마다 줄 목록을 Helvetica로 쓴 PDF — 빈 문자열 줄이 문단 사이의 빈 줄이다.

    encrypt를 주면 /Encrypt 사전을 더한다(내용 스트림은 암호화하지 않는다 — 추출기는 열기 전에 거절한다).
    """
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{' '.join(f'{4 + 2 * i} 0 R' for i in range(len(pages)))}] /Count {len(pages)} >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for number, lines in enumerate(pages):
        content = _make_content_stream(lines)
        objects.append(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * number} 0 R >>"
        )
        objects.append(f"<< /Length {len(content)} >>\nstream\n{content.decode('ascii')}\nendstream")
    trailer = ""
    if encrypt is not None:
        objects.append(_make_encrypt_dict(encrypt))
        trailer = f" /Encrypt {len(objects)} 0 R /ID [<{DOC_ID.hex()}> <{DOC_ID.hex()}>]"

    return assemble_pdf(objects, trailer)


def assemble_pdf(objects: list[str], trailer: str = "") -> bytes:
    """객체 본문 목록(1번부터, 1번은 Catalog)을 머리·xref 표·꼬리로 감싼다 — 바이트 위치를 세어 xref를 맞춘다."""
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("ascii")
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii")
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets).encode("ascii")
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R{trailer} >>\nstartxref\n{xref_at}\n%%EOF\n".encode("ascii")
    return bytes(out)


def build_image_pdf() -> bytes:
    """글자 없이 그림 한 장만 든 PDF — 스캔본 흉내."""
    buffer = BytesIO()
    Image.new("RGB", (200, 120), "white").save(buffer, format="PDF")
    return buffer.getvalue()
