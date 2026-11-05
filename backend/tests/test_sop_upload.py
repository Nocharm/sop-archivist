"""문서 업로드 — 격리 추출(시간 초과·죽은 자식·보조 실패), 거절 기록, 중복, 새 문서의 To-Be 연결, 내려받기, 경고 확인, 로그."""

import asyncio
import logging
import multiprocessing
from functools import partial
from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import settings
from app.sop import ingest
from app.sop.extract import worker
from app.sop.extract.types import ExtractLimits
from app.sop.models import (
    Bundle,
    Document,
    DocumentFile,
    Extraction,
    ExtractionWarning,
    SourceBlock,
    SourceTable,
)
from tests import worker_targets
from tests.access_helpers import run_in_session, update_row
from tests.docx_factory import TINY_PNG, build_docx, make_drawing_run, p, tbl
from tests.pdf_factory import build_text_pdf
from tests.sop_helpers import AUTHOR, REVIEWER, create_bundle, get_bundle, put_tobe, set_members, upload

pytestmark = pytest.mark.usefixtures("clean_sop")

LIMITS = ExtractLimits(
    max_unzipped_bytes=20 * 1024 * 1024,
    max_zip_entries=2000,
    max_compression_ratio=200,
    max_pdf_pages=500,
    max_chars=100_000,
)
BODY_TEXT = "Synthetic centrifuge step text"
DOCX_NAME = "SYNTHETIC_SOP-QC-00005_v3.0_Eppendorf Centrifuge.docx"
DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TRACKED_BODY = '<w:p><w:ins w:id="1" w:author="qa" w:date="2026-11-05T00:00:00Z"><w:r><w:t>Synthetic</w:t></w:r></w:ins></w:p>'


def _sample_docx(body_text: str = BODY_TEXT) -> bytes:
    """문단 하나 + 표 하나(한 행 두 칸) + 그림 하나."""
    return build_docx(
        p(body_text)
        + tbl([["Synthetic head", "Synthetic value"]])
        + f"<w:p>{make_drawing_run('image1.png')}</w:p>",
        media={"image1.png": TINY_PNG},
    )


def _sop(code: str) -> dict:
    return {"code": code, "title": "", "doc_type": "sop", "parent_code": None, "is_equipment_sop": False, "order_index": 0}


def _list_documents(client: TestClient, bundle_id: int) -> list[dict]:
    response = client.get(f"/api/bundles/{bundle_id}/documents", headers=AUTHOR)
    assert response.status_code == 200, response.text
    return response.json()


def _count(model: type, *conditions: object) -> int:
    async def _run(session: AsyncSession) -> int:
        return await session.scalar(select(func.count()).select_from(model).where(*conditions))

    return run_in_session(_run)


def _find_blocks(extraction_id: int) -> list[SourceBlock]:
    async def _run(session: AsyncSession) -> list[SourceBlock]:
        rows = await session.scalars(
            select(SourceBlock).where(SourceBlock.extraction_id == extraction_id).order_by(SourceBlock.seq)
        )
        return list(rows)

    return run_in_session(_run)


def _get_extraction(document_id: int) -> Extraction:
    async def _run(session: AsyncSession) -> Extraction:
        return await session.scalar(select(Extraction).where(Extraction.document_id == document_id))

    return run_in_session(_run)


def _use_extractor(monkeypatch: pytest.MonkeyPatch, **targets: object) -> None:
    """업로드가 부르는 격리 추출의 자식 대상을 바꾼다(target·aux_target)."""
    monkeypatch.setattr(ingest, "extract_in_subprocess", partial(worker.extract_in_subprocess, **targets))


# --- 업로드와 거절 ---


def test_upload_docx_ready(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = upload(client, bundle["id"], _sample_docx(), DOCX_NAME)

    assert response.status_code == 201, response.text
    doc = response.json()
    assert (doc["status"], doc["status_reason"], doc["side"], doc["file_format"]) == ("ready", "", "old", "docx")
    assert (doc["doc_code"], doc["doc_version"], doc["title"]) == (
        "SOP-QC-00005", "3.0", "SYNTHETIC Eppendorf Centrifuge",
    )
    assert (doc["file_name"], doc["uploaded_by"], doc["revision"], doc["target_doc_id"]) == (
        DOCX_NAME, "qa.member", 1, None,
    )
    assert doc["extraction"]["aux_status"] == "ok"
    assert doc["extraction"]["warnings"] == []  # 진짜 MarkItDown 결과와 대조해도 오탐이 없다
    blocks = _find_blocks(doc["extraction"]["id"])
    assert [block.kind for block in blocks] == ["paragraph", "table_cell", "table_cell", "figure"]
    assert blocks[1].table_id is not None and blocks[1].flags == []
    assert _count(SourceTable, SourceTable.extraction_id == doc["extraction"]["id"]) == 1
    assert _count(DocumentFile, DocumentFile.document_id == doc["id"]) == 1
    assert _list_documents(client, bundle["id"]) == [doc]


def test_upload_maps_tables_and_warning_blocks_to_ids(client: TestClient) -> None:
    # 병합 칸(경고가 블록 seq를 가리킨다)과 칸 안의 표(안쪽 표가 바깥 표 순번을 가리킨다)를 DB id로 옮긴다
    body = (
        '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>'
        '<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' + p("Synthetic top") + "</w:tc>"
        "<w:tc>" + p("Synthetic right") + "</w:tc></w:tr>"
        "<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>" + p("Synthetic hidden") + "</w:tc>"
        "<w:tc>" + tbl([["Synthetic inner"]]) + p("") + "</w:tc></w:tr>"
        "</w:tbl>"
    )
    bundle = create_bundle(client)

    doc = upload(client, bundle["id"], build_docx(body), DOCX_NAME).json()

    async def _load_tables(session: AsyncSession) -> list[SourceTable]:
        rows = await session.scalars(
            select(SourceTable).where(SourceTable.extraction_id == doc["extraction"]["id"]).order_by(SourceTable.table_index)
        )
        return list(rows)

    outer, inner = run_in_session(_load_tables)
    block_by_text = {block.text: block for block in _find_blocks(doc["extraction"]["id"])}
    assert (outer.parent_table_id, inner.parent_table_id) == (None, outer.id)
    assert block_by_text["Synthetic inner"].table_id == inner.id
    assert (block_by_text["Synthetic top"].table_id, block_by_text["Synthetic top"].flags) == (outer.id, ["merged_cell"])
    merged = [w for w in doc["extraction"]["warnings"] if w["kind"].startswith("merged_cell")]
    assert [(w["kind"], w["block_id"], w["needs_ack"]) for w in merged] == [
        ("merged_cell", block_by_text["Synthetic top"].id, False),
        ("merged_cell_content", block_by_text["Synthetic hidden"].id, False),
    ]


def test_upload_pdf_ready_with_layout_warning(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = upload(client, bundle["id"], build_text_pdf([["Synthetic PDF line"]]), "SYNTHETIC_SOP-QC-00007.PDF")

    assert response.status_code == 201, response.text
    doc = response.json()
    assert (doc["status"], doc["file_format"], doc["extraction"]["aux_status"]) == ("ready", "pdf", "ok")
    assert [(w["kind"], w["block_id"], w["needs_ack"]) for w in doc["extraction"]["warnings"]] == [
        ("pdf_layout", None, False),
    ]


@pytest.mark.parametrize(
    ("data", "file_name", "max_file_mb", "reason"),
    [
        (build_docx(TRACKED_BODY), "SYNTHETIC_SOP-QC-00005.docx", 25, "tracked_changes"),
        (b"Synthetic plain text", "SYNTHETIC_SOP-QC-00005 notes.txt", 25, "invalid_format"),
        (_sample_docx(), "SYNTHETIC_SOP-QC-00005.docx", 0, "too_large"),
    ],
    ids=["tracked_changes", "invalid_format", "too_large"],
)
def test_upload_rejections_are_recorded(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, data: bytes, file_name: str, max_file_mb: int, reason: str
) -> None:
    monkeypatch.setattr(settings, "sop_max_file_mb", max_file_mb)
    bundle = create_bundle(client)

    response = upload(client, bundle["id"], data, file_name)

    assert response.status_code == 201, response.text
    doc = response.json()
    assert (doc["status"], doc["status_reason"], doc["extraction"]) == ("rejected", reason, None)
    assert doc["doc_code"] == "SOP-QC-00005"  # 받지 않은 문서도 이름에서 읽은 번호는 보인다
    assert _count(DocumentFile, DocumentFile.document_id == doc["id"]) == 0  # 받지 않은 파일의 바이트는 남기지 않는다
    download = client.get(f"/api/bundles/{bundle['id']}/documents/{doc['id']}/file", headers=AUTHOR)
    assert download.status_code == 404
    assert download.json()["detail"] == {"code": "file_not_found"}


def test_upload_failed_extraction_is_recorded(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_extractor(monkeypatch, target=worker_targets.exit_hard)
    bundle = create_bundle(client)

    response = upload(client, bundle["id"], _sample_docx(), DOCX_NAME)

    assert response.status_code == 201, response.text
    doc = response.json()
    assert (doc["status"], doc["status_reason"], doc["extraction"]) == ("failed", "crashed", None)
    assert multiprocessing.active_children() == []


def test_duplicate_file_conflicts(client: TestClient) -> None:
    bundle = create_bundle(client)
    data = _sample_docx()
    assert upload(client, bundle["id"], data, DOCX_NAME).status_code == 201

    response = upload(client, bundle["id"], data, "SYNTHETIC renamed copy.docx")

    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "duplicate_file"}
    assert len(_list_documents(client, bundle["id"])) == 1


def test_upload_rejects_overlong_file_names(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = upload(client, bundle["id"], _sample_docx(), "S" * 251 + ".docx")

    assert response.status_code == 422
    assert response.json()["detail"] == {"code": "file_name_too_long", "max_chars": 255}
    assert _list_documents(client, bundle["id"]) == []


def test_upload_requires_editable_bundle_and_author(client: TestClient) -> None:
    bundle = create_bundle(client)
    assert set_members(client, bundle["id"], [("qa.member", "author"), ("qa.lead", "reviewer")]).status_code == 200

    as_reviewer = upload(client, bundle["id"], _sample_docx(), DOCX_NAME, headers=REVIEWER)
    update_row(Bundle, bundle["id"], status="in_review")
    while_in_review = upload(client, bundle["id"], _sample_docx(), DOCX_NAME)

    assert as_reviewer.status_code == 403
    assert as_reviewer.json()["detail"]["code"] == "role_required"
    assert while_in_review.status_code == 409
    assert while_in_review.json()["detail"] == {"code": "bundle_not_editable", "status": "in_review"}
    assert _count(Document, Document.bundle_id == bundle["id"]) == 0


# --- 격리 추출 ---


def test_parse_timeout_marks_failed() -> None:
    result = asyncio.run(
        worker.extract_in_subprocess(
            b"", "docx", LIMITS, timeout_s=1, memory_mb=2048, target=worker_targets.sleep_forever
        )
    )

    assert (result.outcome, result.code, result.result) == ("failed", "timeout", None)
    assert multiprocessing.active_children() == []


def test_child_crash_marks_failed() -> None:
    result = asyncio.run(
        worker.extract_in_subprocess(b"", "docx", LIMITS, timeout_s=30, memory_mb=2048, target=worker_targets.exit_hard)
    )

    assert (result.outcome, result.code) == ("failed", "crashed")
    assert multiprocessing.active_children() == []


def test_child_exception_keeps_only_the_class_name() -> None:
    result = asyncio.run(
        worker.extract_in_subprocess(
            b"", "docx", LIMITS, timeout_s=30, memory_mb=2048, target=worker_targets.raise_with_text
        )
    )

    assert (result.outcome, result.code, result.error_class) == ("failed", "parse_error", "ValueError")
    assert "secret" not in repr(result)  # 예외 메시지는 원문 글자를 담을 수 있다


@pytest.mark.parametrize(
    ("aux_target", "aux_error"),
    [
        (worker_targets.sleep_forever, "timeout"),
        (worker_targets.exit_hard, "crashed"),
        (worker_targets.raise_with_text, "ValueError"),
    ],
    ids=["timeout", "crashed", "exception"],
)
def test_aux_child_failure_keeps_the_main_result(aux_target: object, aux_error: str) -> None:
    result = asyncio.run(
        worker.extract_in_subprocess(
            b"", "docx", LIMITS, timeout_s=2, memory_mb=2048,
            target=worker_targets.return_tiny_result, aux_target=aux_target,
        )
    )

    assert (result.outcome, result.aux_markdown, result.aux_error) == ("ok", None, aux_error)
    assert result.result is not None and len(result.result.blocks) == 1
    assert multiprocessing.active_children() == []


def test_run_extraction_reports_rejections_without_raising() -> None:
    result = worker.run_extraction(build_docx(TRACKED_BODY), "docx", LIMITS)

    assert (result.outcome, result.code, result.result) == ("rejected", "tracked_changes", None)


def test_parallel_parses_are_capped(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # 자식은 release 파일이 생길 때까지 붙잡혀 있다 — 상한이 없으면 셋째 업로드의 자식도 곧바로 들어온다
    _use_extractor(
        monkeypatch, target=worker_targets.block_until_released, aux_target=worker_targets.return_tiny_result
    )

    def count_entered() -> int:
        return len(list(tmp_path.glob("entered-*")))

    async def run_three_uploads() -> tuple[int, list[worker.WorkerResult]]:
        # 이 테스트의 이벤트 루프 전용 자리 — 모듈 세마포어를 다른 테스트의 루프와 섞지 않는다
        monkeypatch.setattr(ingest, "_parse_slots", asyncio.Semaphore(ingest.MAX_PARALLEL_PARSES))
        tasks = [asyncio.create_task(ingest._extract(str(tmp_path).encode(), "docx")) for _ in range(3)]
        for _ in range(400):  # 둘이 들어올 때까지 최대 20초
            if count_entered() >= ingest.MAX_PARALLEL_PARSES:
                break
            await asyncio.sleep(0.05)
        await asyncio.sleep(1)  # 상한이 없다면 셋째 자식이 이 사이에 들어온다
        entered_while_held = count_entered()
        (tmp_path / worker_targets.RELEASE_FILE).touch()
        return entered_while_held, await asyncio.gather(*tasks)

    entered_while_held, results = asyncio.run(run_three_uploads())

    assert entered_while_held == ingest.MAX_PARALLEL_PARSES == 2
    assert count_entered() == 3  # 자리가 나자 셋째가 돌았다
    assert [result.outcome for result in results] == ["ok", "ok", "ok"]
    assert multiprocessing.active_children() == []


# --- 보조 대조 결과 저장 ---


def test_aux_failure_keeps_the_document_ready(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_extractor(monkeypatch, aux_target=worker_targets.raise_with_text)
    bundle = create_bundle(client)

    doc = upload(client, bundle["id"], _sample_docx(), DOCX_NAME).json()

    assert (doc["status"], doc["extraction"]["aux_status"], doc["extraction"]["warnings"]) == ("ready", "failed", [])
    assert _get_extraction(doc["id"]).aux_detail == "ValueError"


def test_missing_text_warnings_point_at_the_nearest_block(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_extractor(monkeypatch, aux_target=worker_targets.convert_with_extra_line)
    bundle = create_bundle(client)

    doc = upload(client, bundle["id"], _sample_docx(), DOCX_NAME).json()

    warnings = doc["extraction"]["warnings"]
    assert [(w["kind"], w["detail"], w["needs_ack"]) for w in warnings] == [
        ("missing_text", {"snippet": worker_targets.EXTRA_LINE}, True),
    ]
    blocks = {block.id: block for block in _find_blocks(doc["extraction"]["id"])}
    assert blocks[warnings[0]["block_id"]].text == "Synthetic value"  # 마지막으로 찾은 조각이 든 블록


def test_missing_text_warnings_are_capped(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_extractor(monkeypatch, aux_target=worker_targets.convert_to_many_missing_lines)
    bundle = create_bundle(client)

    doc = upload(client, bundle["id"], _sample_docx(), DOCX_NAME).json()

    warnings = doc["extraction"]["warnings"]
    assert len(warnings) == 201
    assert {(w["kind"], w["block_id"], w["needs_ack"]) for w in warnings[:200]} == {("missing_text", None, True)}
    assert (warnings[200]["kind"], warnings[200]["needs_ack"]) == ("missing_text_truncated", False)


# --- 새 문서(입구 2) ---


def test_upload_new_doc_creates_match_target_doc(client: TestClient) -> None:
    bundle = create_bundle(client)
    assert put_tobe(client, bundle["id"], [_sop("SOP-NEW")]).status_code == 200
    revision_before = get_bundle(client, bundle["id"])["revision"]

    response = upload(
        client, bundle["id"], _sample_docx(), "SYNTHETIC_WI-NEW-01_v1.0_Operation.docx",
        side="new", doc_type="wi", parent_code="SOP-NEW",
    )

    assert response.status_code == 201, response.text
    doc = response.json()
    assert doc["target_doc_id"] is not None and doc["side"] == "new"
    tobe = client.get(f"/api/bundles/{bundle['id']}/tobe", headers=AUTHOR).json()
    match = next(item for item in tobe["docs"] if item["id"] == doc["target_doc_id"])
    assert (match["code"], match["doc_type"], match["parent_code"], match["entrance"], match["document_id"]) == (
        "WI-NEW-01", "wi", "SOP-NEW", "match", doc["id"],
    )
    assert match["title"] == "SYNTHETIC Operation"
    assert tobe["revision"] == revision_before + 1  # To-Be 목록이 바뀌었다


def test_upload_new_doc_without_code_gets_a_temporary_code(client: TestClient) -> None:
    bundle = create_bundle(client)

    doc = upload(client, bundle["id"], _sample_docx(), "원심분리기 운영.docx", side="new", doc_type="sop").json()

    tobe = client.get(f"/api/bundles/{bundle['id']}/tobe", headers=AUTHOR).json()
    assert [(item["code"], item["entrance"]) for item in tobe["docs"]] == [(f"NEW-{doc['id']}", "match")]
    assert doc["doc_code"] == ""  # 문서 번호는 지어내지 않는다 — 임시 코드는 To-Be 목록에만 둔다


def test_rejected_new_doc_leaves_tobe_alone_so_a_fixed_file_can_retry(client: TestClient) -> None:
    bundle = create_bundle(client)
    assert put_tobe(client, bundle["id"], [_sop("SOP-NEW")]).status_code == 200
    tobe_before = client.get(f"/api/bundles/{bundle['id']}/tobe", headers=AUTHOR).json()
    name = "SYNTHETIC_WI-NEW-01_v1.0_Operation.docx"

    rejected = upload(
        client, bundle["id"], build_docx(TRACKED_BODY), name, side="new", doc_type="wi", parent_code="SOP-NEW"
    )
    tobe_after_rejection = client.get(f"/api/bundles/{bundle['id']}/tobe", headers=AUTHOR).json()
    retried = upload(client, bundle["id"], _sample_docx(), name, side="new", doc_type="wi", parent_code="SOP-NEW")

    assert (rejected.json()["status"], rejected.json()["target_doc_id"]) == ("rejected", None)
    assert tobe_after_rejection == tobe_before  # 목록 줄도 revision도 그대로다
    assert retried.status_code == 201, retried.text
    assert retried.json()["status"] == "ready" and retried.json()["target_doc_id"] is not None
    tobe = client.get(f"/api/bundles/{bundle['id']}/tobe", headers=AUTHOR).json()
    assert [(item["code"], item["entrance"]) for item in tobe["docs"]] == [("SOP-NEW", "assign"), ("WI-NEW-01", "match")]


def test_new_doc_code_edit_renames_its_match_doc(client: TestClient) -> None:
    bundle = create_bundle(client)
    assert put_tobe(client, bundle["id"], [_sop("SOP-NEW"), _sop("SOP-TAKEN")]).status_code == 200
    doc = upload(
        client, bundle["id"], _sample_docx(), "원심분리기 운영.docx", side="new", doc_type="wi", parent_code="SOP-NEW"
    ).json()
    url = f"/api/bundles/{bundle['id']}/documents/{doc['id']}"
    revision_before = get_bundle(client, bundle["id"])["revision"]

    clash = client.patch(url, json={"revision": 1, "doc_code": "SOP-TAKEN"}, headers=AUTHOR)
    renamed = client.patch(url, json={"revision": 1, "doc_code": "WI-09"}, headers=AUTHOR)

    assert clash.status_code == 409
    assert clash.json()["detail"] == {"code": "duplicate_code", "doc_code": "SOP-TAKEN"}
    # 막힌 요청은 아무것도 남기지 않아 같은 revision 1로 다시 고칠 수 있다
    assert renamed.status_code == 200, renamed.text
    assert (renamed.json()["doc_code"], renamed.json()["revision"]) == ("WI-09", 2)
    tobe = client.get(f"/api/bundles/{bundle['id']}/tobe", headers=AUTHOR).json()
    match = next(item for item in tobe["docs"] if item["id"] == doc["target_doc_id"])
    assert (match["code"], match["entrance"], match["parent_code"]) == ("WI-09", "match", "SOP-NEW")
    assert tobe["revision"] == revision_before + 1  # To-Be 목록이 바뀌었다


@pytest.mark.parametrize(
    ("file_name", "doc_type", "parent_code", "status", "detail"),
    [
        ("SYNTHETIC_WI-NEW-02.docx", None, None, 422, {"code": "invalid_doc_type", "doc_code": "WI-NEW-02"}),
        ("SYNTHETIC_WI-NEW-02.docx", "wi", "SOP-MISSING", 422,
         {"code": "invalid_parent", "doc_code": "WI-NEW-02", "parent_code": "SOP-MISSING"}),
        ("SYNTHETIC_WI-NEW-02.docx", "wi", "WI-OLD-01", 422,
         {"code": "invalid_parent", "doc_code": "WI-NEW-02", "parent_code": "WI-OLD-01"}),
        ("SYNTHETIC_SOP-QC-00009.docx", "sop", "SOP-NEW", 422,
         {"code": "invalid_parent", "doc_code": "SOP-QC-00009", "parent_code": "SOP-NEW"}),
        ("SYNTHETIC_SOP-QC-00009 copy.docx", "sop", None, 409, {"code": "duplicate_code", "doc_code": "SOP-QC-00009"}),
    ],
    ids=["no_doc_type", "unknown_parent", "parent_is_wi", "sop_with_parent", "duplicate_code"],
)
def test_upload_new_doc_rules(
    client: TestClient, file_name: str, doc_type: str | None, parent_code: str | None, status: int, detail: dict
) -> None:
    bundle = create_bundle(client)
    wi = {**_sop("WI-OLD-01"), "doc_type": "wi", "parent_code": "SOP-NEW"}
    assert put_tobe(client, bundle["id"], [_sop("SOP-NEW"), wi, _sop("SOP-QC-00009")]).status_code == 200

    response = upload(client, bundle["id"], _sample_docx(), file_name, side="new", doc_type=doc_type, parent_code=parent_code)

    assert response.status_code == status
    assert response.json()["detail"] == detail
    assert _count(Document, Document.bundle_id == bundle["id"]) == 0


# --- 고치기·지우기 ---


def test_update_document_fields(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = upload(client, bundle["id"], _sample_docx(), DOCX_NAME).json()
    url = f"/api/bundles/{bundle['id']}/documents/{doc['id']}"

    updated = client.patch(
        url, json={"revision": 1, "doc_code": " SOP-QC-00006 ", "language_layout": "en_only"}, headers=AUTHOR
    )
    stale = client.patch(url, json={"revision": 1, "title": "Synthetic title"}, headers=AUTHOR)
    bad_layout = client.patch(url, json={"revision": 2, "language_layout": "fr_only"}, headers=AUTHOR)

    assert updated.status_code == 200, updated.text
    assert (updated.json()["doc_code"], updated.json()["language_layout"], updated.json()["revision"]) == (
        "SOP-QC-00006", "en_only", 2,
    )
    assert updated.json()["title"] == doc["title"]
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "revision_conflict"
    assert bad_layout.status_code == 422


def test_delete_document_removes_its_extraction(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = upload(client, bundle["id"], _sample_docx(), DOCX_NAME).json()
    url = f"/api/bundles/{bundle['id']}/documents/{doc['id']}"

    stale = client.delete(f"{url}?revision=2", headers=AUTHOR)
    deleted = client.delete(f"{url}?revision=1", headers=AUTHOR)

    assert stale.status_code == 409
    assert deleted.status_code == 204
    assert _list_documents(client, bundle["id"]) == []
    assert _count(SourceBlock, SourceBlock.extraction_id == doc["extraction"]["id"]) == 0
    assert _count(DocumentFile, DocumentFile.document_id == doc["id"]) == 0


def test_delete_new_document_removes_its_match_doc(client: TestClient) -> None:
    bundle = create_bundle(client)
    sop = upload(client, bundle["id"], _sample_docx(), "SYNTHETIC_SOP-QC-00010.docx", side="new", doc_type="sop").json()
    wi = upload(
        client, bundle["id"], _sample_docx("Synthetic WI step"), "SYNTHETIC_WI-QC-00011.docx",
        side="new", doc_type="wi", parent_code="SOP-QC-00010",
    ).json()

    blocked = client.delete(f"/api/bundles/{bundle['id']}/documents/{sop['id']}?revision=1", headers=AUTHOR)
    removed_wi = client.delete(f"/api/bundles/{bundle['id']}/documents/{wi['id']}?revision=1", headers=AUTHOR)

    assert blocked.status_code == 409
    assert blocked.json()["detail"] == {"code": "doc_has_children", "codes": ["WI-QC-00011"]}
    assert removed_wi.status_code == 204
    tobe = client.get(f"/api/bundles/{bundle['id']}/tobe", headers=AUTHOR).json()
    assert [item["code"] for item in tobe["docs"]] == ["SOP-QC-00010"]


# --- 내려받기·경고 확인·로그 ---


def test_download_original_and_figure(client: TestClient) -> None:
    bundle = create_bundle(client)
    data = _sample_docx()
    file_name = "SYNTHETIC_SOP-QC-00005_v3.0_원심분리기.docx"
    doc = upload(client, bundle["id"], data, file_name).json()
    blocks = _find_blocks(doc["extraction"]["id"])
    figure = next(block for block in blocks if block.kind == "figure")
    base = f"/api/bundles/{bundle['id']}/documents/{doc['id']}"

    original = client.get(f"{base}/file", headers=AUTHOR)
    image = client.get(f"{base}/figures/{figure.id}", headers=AUTHOR)
    not_a_figure = client.get(f"{base}/figures/{blocks[0].id}", headers=AUTHOR)

    assert original.status_code == 200
    assert original.content == data
    assert original.headers["content-type"] == DOCX_MEDIA_TYPE
    assert original.headers["content-disposition"] == (
        # 한글 다섯 글자가 ASCII 대체 이름에서 "_" 다섯 개가 된다
        f"attachment; filename=\"SYNTHETIC_SOP-QC-00005_v3.0______.docx\"; filename*=UTF-8''{quote(file_name)}"
    )
    assert image.status_code == 200
    assert image.content == TINY_PNG
    assert image.headers["content-type"] == "image/png"
    assert image.headers["x-content-type-options"] == "nosniff"
    assert not_a_figure.status_code == 404
    assert not_a_figure.json()["detail"] == {"code": "figure_not_found"}


def test_ack_warning(client: TestClient) -> None:
    bundle = create_bundle(client)
    doc = upload(client, bundle["id"], _sample_docx(), DOCX_NAME).json()

    async def _add_warning(session: AsyncSession) -> int:
        warning = ExtractionWarning(
            extraction_id=doc["extraction"]["id"], kind="missing_text", detail={"snippet": "Synthetic"}, needs_ack=True,
        )
        session.add(warning)
        await session.commit()
        return warning.id

    warning_id = run_in_session(_add_warning)
    url = f"/api/bundles/{bundle['id']}/warnings/{warning_id}/ack"

    acked = client.post(url, json={"note": "Synthetic check note"}, headers=AUTHOR)
    again = client.post(url, json={"note": "Second"}, headers=AUTHOR)

    assert acked.status_code == 200, acked.text
    assert (acked.json()["acked_by"], acked.json()["ack_note"]) == ("qa.member", "Synthetic check note")
    assert acked.json()["acked_at"] is not None
    assert again.status_code == 409
    assert again.json()["detail"] == {"code": "warning_already_acked"}
    listed = _list_documents(client, bundle["id"])[0]["extraction"]["warnings"]
    assert listed == [acked.json()]


def test_upload_logs_no_text(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    # 앱 로거(app.*)만 본다 — DB 드라이버의 DEBUG 로그는 SQL 인자를 싣고, 운영에서는 켜지 않는다
    caplog.set_level(logging.DEBUG, logger="app")
    bundle = create_bundle(client)

    ready = upload(
        client, bundle["id"], _sample_docx("Synthetic quokka paragraph"), "SYNTHETIC_SOP-QC-00012_v1.0_Zebra Title.docx"
    )
    rejected = upload(client, bundle["id"], b"Synthetic quokka notes", "SYNTHETIC Zebra notes.txt")

    assert (ready.status_code, rejected.status_code) == (201, 201)
    app_log = "\n".join(record.getMessage() for record in caplog.records if record.name.startswith("app"))
    assert f"document={ready.json()['id']}" in app_log  # 업로드마다 ID·상태 한 줄은 남는다
    assert f"document={rejected.json()['id']}" in app_log
    for text in ("quokka", "Zebra", "SYNTHETIC"):
        assert text not in app_log
