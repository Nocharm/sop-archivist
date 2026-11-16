"""scripts.synthetic_sop OLD-7 — 표·그림 캡션의 모든 꼴(앞·뒤·번호 어긋남·스타일 없음)과 참조 문장·레이아웃 표."""

from app.sop.extract.docx_reader import read_docx
from app.sop.extract.types import ExtractLimits
from scripts.synthetic_sop import build_synthetic_bundle

LIMITS = ExtractLimits(
    max_unzipped_bytes=20 * 1024 * 1024,
    max_zip_entries=100,
    max_compression_ratio=100,
    max_pdf_pages=500,
    max_chars=100_000,
)


def test_old_7_has_every_caption_shape(tmp_path):
    bundle = build_synthetic_bundle(tmp_path)
    doc = next(d for d in bundle.documents if "OLD-7" in d.path.name)
    blocks = read_docx(doc.path.read_bytes(), LIMITS).blocks
    texts = [b.text for b in blocks if b.kind == "paragraph"]
    assert "표 3. 운전 조건 (Table 3. Operating conditions)" in texts
    assert "Table 4: Rotor limits" in texts
    assert "회전 속도는 아래 표를 따른다." in texts
    assert sum(b.kind == "figure" for b in blocks) == 2
    assert {b.table_index for b in blocks if b.kind == "table_cell"} == {0, 1, 2, 3}


def test_old_7_answers_cover_every_judged_unit(tmp_path):
    expected = build_synthetic_bundle(tmp_path).expected
    old7 = [a for a in expected["answers"] if a["doc"] == "OLD-7"]
    assert any(a.get("disposition") == "delete" and a["text"] == "표 9 참조." for a in old7)
    assert {"doc": "OLD-7", "op": "set_layout_table", "table_index": 3, "is_layout": True} in expected["edits"]
