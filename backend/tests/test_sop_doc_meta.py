"""문서 정보 규칙 탐지 — 머리글·첫 장에서 문서 번호·버전을, 본문 줄의 한·영 순서에서 언어 배치를 읽는다."""

from fastapi.testclient import TestClient

from app.sop.doc_meta import HeaderFields, detect_header_fields, detect_language_layout
from app.sop.extract.types import ExtractedBlock
from tests.docx_factory import build_docx, p
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
