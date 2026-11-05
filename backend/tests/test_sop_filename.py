"""파일 이름 파싱 — 문서 번호·버전·제목을 이름에서 채우고, 없는 값은 지어내지 않고 빈 칸으로 둔다."""

import pytest

from app.sop.filename import ParsedFileName, parse_file_name


@pytest.mark.parametrize(
    ("file_name", "expected"),
    [
        ("SOP-QC-00005_v3.0_Eppendorf Centrifuge.docx", ("SOP-QC-00005", "3.0", "Eppendorf Centrifuge")),
        ("SOP-QC-00155 Rev.2 Eppendorf 5702R Centrifuge.docx", ("SOP-QC-00155", "2", "Eppendorf 5702R Centrifuge")),
        ("WI-01(ver 1) Operation.docx", ("WI-01", "1", "Operation")),
        ("원심분리기 운영.docx", ("", "", "원심분리기 운영")),
        ("SYNTHETIC_OLD-1_v1.0_Eppendorf Centrifuge.docx", ("OLD-1", "1.0", "SYNTHETIC Eppendorf Centrifuge")),
    ],
)
def test_parse_file_name(file_name: str, expected: tuple[str, str, str]) -> None:
    assert parse_file_name(file_name) == ParsedFileName(*expected)


def test_parse_file_name_normalizes_to_nfc() -> None:
    # macOS는 한글 파일 이름을 NFD(자모 분리)로 보낸다 — 제목은 화면·검색과 같은 NFC여야 한다
    decomposed = "SOP-QC-00005 심험.docx"
    assert parse_file_name(decomposed) == ParsedFileName("SOP-QC-00005", "", "심험")


def test_parse_file_name_keeps_dotted_version_without_extension() -> None:
    # 확장자로 보이지 않는 끝 조각(".2")은 버전이지 확장자가 아니다
    assert parse_file_name("SOP-QC-00155 Rev.2") == ParsedFileName("SOP-QC-00155", "2", "")


def test_parse_file_name_leaves_values_longer_than_the_column_blank() -> None:
    # 컬럼보다 긴 번호는 잘라서 다른 번호를 지어내지 않고, 사람이 채울 빈 칸으로 둔다
    long_code = "SOP-" + "-".join(["ABCDEFGH"] * 12) + "-1"
    parsed = parse_file_name(f"{long_code}.docx")
    assert parsed.doc_code == ""
    assert parsed.title == long_code
