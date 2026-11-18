"""문서 정보 규칙 탐지 — 머리글·첫 장에서 문서 번호·버전을, 본문 줄의 한·영 순서에서 언어 배치를 읽는다."""

from fastapi.testclient import TestClient

from app.sop.doc_meta import HeaderFields, detect_header_fields, detect_language_layout
from app.sop.extract.types import ExtractedBlock
from tests.docx_factory import build_docx, make_grid_table, make_row, p
from tests.sop_helpers import create_bundle, upload


def _block(seq: int, text: str, part: str = "body", kind: str = "paragraph", table_index: int | None = None) -> ExtractedBlock:
    return ExtractedBlock(
        seq=seq, part=part, kind=kind, text=text, xml_path="", page=1, page_basis="estimated", section_label="",
        heading_level=None, table_index=table_index, row_index=None, col_index=None, grid_span=1, row_span=1,
        image_part=None, flags=(),
    )


def test_reads_number_and_version_from_the_header() -> None:
    blocks = [_block(0, "Doc No.: SOP-CDO-111334   Version 3.1", part="header"), _block(1, "1. 목적")]

    assert detect_header_fields(blocks) == HeaderFields(doc_code="SOP-CDO-111334", version="3.1")


def test_reads_korean_labels_in_the_first_body_blocks() -> None:
    blocks = [_block(0, "QC 원심분리기 운전"), _block(1, "문서번호 : SOP-QC-2207"), _block(2, "개정번호 2")]

    assert detect_header_fields(blocks) == HeaderFields(doc_code="SOP-QC-2207", version="2")


def test_finds_nothing_without_labels() -> None:
    blocks = [_block(0, "QC 원심분리기 운전 절차", part="header"), _block(1, "Version history is kept in Veeva.")]

    assert detect_header_fields(blocks) == HeaderFields(doc_code=None, version=None)


def test_ignores_labels_deep_in_the_body() -> None:
    blocks = [_block(index, f"문장 {index}") for index in range(60)] + [_block(60, "Doc No. SOP-QC-9999")]

    assert detect_header_fields(blocks).doc_code is None


def test_layout_interleaved() -> None:
    blocks = [_block(index, "보호 장갑을 착용한다." if index % 2 == 0 else "Wear protective gloves.") for index in range(20)]

    assert detect_language_layout(blocks) == "ko_en_interleaved"


def test_layout_separate() -> None:
    blocks = [_block(index, "보호 장갑을 착용한다.") for index in range(10)] + [_block(10 + index, "Wear gloves.") for index in range(10)]

    assert detect_language_layout(blocks) == "ko_en_separate"


def test_layout_single_language() -> None:
    assert detect_language_layout([_block(index, "Wear gloves.") for index in range(5)]) == "en_only"
    assert detect_language_layout([_block(index, "장갑을 낀다.") for index in range(5)]) == "ko_only"


def test_layout_ignores_table_cells_and_numbers() -> None:
    blocks = [_block(0, "장갑을 낀다."), _block(1, "1234"), _block(2, "Wear gloves.", kind="table_cell", table_index=0)]

    assert detect_language_layout(blocks) == "ko_only"


def test_upload_fills_empty_fields_from_the_content(client: TestClient) -> None:
    bundle = create_bundle(client)
    body = p("Doc No.: SOP-QC-2207") + p("Version 2.1") + p("보호 장갑을 착용한다.") + p("Wear protective gloves.")

    response = upload(client, bundle["id"], build_docx(body), "SYNTHETIC_Centrifuge_Operation.docx")

    assert response.status_code == 201, response.text
    document = response.json()
    assert (document["doc_code"], document["doc_version"]) == ("SOP-QC-2207", "2.1")
    assert document["prefill_sources"] == {"doc_code": "content", "doc_version": "content", "language_layout": "content"}
    assert document["language_layout"] == "ko_en_interleaved"


def test_upload_keeps_values_from_the_file_name(client: TestClient) -> None:
    bundle = create_bundle(client)
    body = p("Doc No.: SOP-QC-2207") + p("Version 2.1") + p("Wear protective gloves.")

    document = upload(client, bundle["id"], build_docx(body), "SYNTHETIC_SOP-QC-00005_v3.0_Centrifuge.docx").json()

    assert (document["doc_code"], document["doc_version"]) == ("SOP-QC-00005", "3.0")
    assert document["prefill_sources"]["doc_code"] == "file_name"
    assert document["language_layout"] == "en_only"


def test_new_documents_take_the_number_only_from_the_file_name(client: TestClient) -> None:
    bundle = create_bundle(client)
    body = p("Doc No.: SOP-QC-0001") + p("Wear protective gloves.")

    document = upload(client, bundle["id"], build_docx(body), "SYNTHETIC_Centrifuge_New.docx", side="new", doc_type="sop").json()

    assert document["doc_code"] != "SOP-QC-0001"
    assert "doc_code" not in document["prefill_sources"]


def test_listing_does_not_repeat_the_sources(client: TestClient) -> None:
    bundle = create_bundle(client)
    upload(client, bundle["id"], build_docx(p("Version 2.1") + p("Wear gloves.")), "SYNTHETIC_Listing.docx")

    listed = client.get(f"/api/bundles/{bundle['id']}/documents", headers={"X-Dev-User": "qa.member"}).json()

    assert listed[0]["prefill_sources"] == {}


def test_layout_table_with_both_languages_keeps_interleaved() -> None:
    # 한글 제목 하나 + 본문 전체가 KO|EN 두 열 레이아웃 표인 문서 — 문단만 보면 ko_only지만 표 칸에 두 언어가 다 있다
    blocks = [_block(0, "원심분리기 운전")] + [
        _block(1 + index, "장갑을 낀다." if index % 2 == 0 else "Wear gloves.", kind="table_cell", table_index=0)
        for index in range(10)
    ]

    assert detect_language_layout(blocks) == "ko_en_interleaved"


def _cell(seq: int, text: str, table: int, row: int, col: int, span: int = 1) -> ExtractedBlock:
    return ExtractedBlock(
        seq=seq, part="body", kind="table_cell", text=text, xml_path="", page=1, page_basis="estimated",
        section_label="", heading_level=None, table_index=table, row_index=row, col_index=col, grid_span=span,
        row_span=1, image_part=None, flags=(),
    )


def test_reads_values_from_the_cell_below_the_label() -> None:
    # P-META: 표지 표는 라벨이 값의 위 칸이다 — 4열 격자, Document No.가 세 열을 차지한다
    blocks = [
        _cell(0, "Document No.", 0, 0, 0, 3), _cell(1, "Ver.", 0, 0, 3),
        _cell(2, "SYN-00001", 0, 1, 0, 3), _cell(3, "1.0", 0, 1, 3),
        _cell(4, "Record No.", 0, 2, 0), _cell(5, "Title", 0, 2, 1, 3),
        _cell(6, "CC-000001", 0, 3, 0), _cell(7, "합성 필터 관리", 0, 3, 1, 3),
    ]

    assert detect_header_fields(blocks) == HeaderFields(doc_code="SYN-00001", version="1.0", record_no="CC-000001")


def test_reads_values_below_labels_in_a_three_column_cover_table() -> None:
    blocks = [
        _cell(0, "문서번호", 0, 0, 0), _cell(1, "Version", 0, 0, 1), _cell(2, "Title", 0, 0, 2),
        _cell(3, "syn-qc-0042", 0, 1, 0), _cell(4, "12", 0, 1, 1), _cell(5, "합성 원심분리기 운전", 0, 1, 2),
    ]

    assert detect_header_fields(blocks) == HeaderFields(doc_code="SYN-QC-0042", version="12")


def test_cell_below_a_label_must_look_like_the_value() -> None:
    # 라벨 아래가 값 꼴이 아니면(설명 글, 다른 열의 값) 읽지 않는다
    blocks = [
        _cell(0, "Document No.", 0, 0, 0), _cell(1, "Ver.", 0, 0, 1),
        _cell(2, "아래 표를 참고한다", 0, 1, 0), _cell(3, "SYN-00001", 0, 1, 1),
    ]

    assert detect_header_fields(blocks) == HeaderFields(doc_code=None, version=None)


def test_upload_reads_the_cover_table(client: TestClient) -> None:
    bundle = create_bundle(client)
    cover = make_grid_table(
        4,
        make_row(["Document No.", "Ver."], spans=[3, 1]) + make_row(["SYN-00001", "1.0"], spans=[3, 1])
        + make_row(["Record No.", "Title"], spans=[1, 3]) + make_row(["CC-000001", "합성 필터 관리"], spans=[1, 3]),
    )

    response = upload(client, bundle["id"], build_docx(cover + p("필터를 교체한다.")), "SYNTHETIC_Filter_Care.docx")

    assert response.status_code == 201, response.text
    assert (response.json()["doc_code"], response.json()["doc_version"]) == ("SYN-00001", "1.0")


def test_layout_counts_table_rows_when_the_body_is_mostly_tables() -> None:
    # P-LAYOUT: 본문 문단 둘 + 표 둘(앞은 모두 한글, 뒤는 모두 영어) — 문단만 세면 판정할 것이 없다
    korean = [_cell(2 + row * 2 + col, "필터를 꺼낸다." if col else "A", 0, row, col) for row in range(4) for col in range(2)]
    english = [_cell(10 + row * 2 + col, "Take the filter out." if col else "A", 1, row, col) for row in range(4) for col in range(2)]
    blocks = [_block(0, "필터 교체"), _block(1, "Filter change"), *korean, *english]

    assert detect_language_layout(blocks) == "ko_en_separate"


def test_layout_table_rows_with_both_languages_stay_interleaved() -> None:
    # KO|EN 두 열 레이아웃 표는 행마다 한글이 있어 영어 줄이 없다 — 표의 코드 짝을 지키는 기본(연달아) 그대로
    rows = [_cell(1 + row * 2 + col, "Wear gloves." if col else "장갑을 낀다.", 0, row, col) for row in range(5) for col in range(2)]

    assert detect_language_layout([_block(0, "원심분리기 운전"), *rows]) == "ko_en_interleaved"


def test_layout_trusts_language_half_marks_over_line_order() -> None:
    blocks = [_block(index, "보호 장갑을 착용한다." if index % 2 == 0 else "Wear protective gloves.") for index in range(20)]

    assert detect_language_layout(blocks, has_language_halves=True) == "ko_en_separate"
    # 한 언어뿐이면 절반 표시가 있어도(빈 템플릿 절반) 그 언어 하나다
    assert detect_language_layout([_block(0, "장갑을 낀다.")] * 3, has_language_halves=True) == "ko_only"
