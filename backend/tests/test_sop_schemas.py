"""SOP 입력 글자 칸 — Postgres text가 담지 못하는 NUL은 칸마다 경계에서 422로 막고, 공백 걷기·길이 규칙은 그대로다."""

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

from app.routers.sop_bundles import BundleCreateIn, BundleUpdateIn, MemberIn, ReviewReasonIn
from app.routers.sop_documents import DocumentUpdateIn, WarningAckIn
from app.sop.decisions import BulkDecisionIn, GroupSaveIn, TargetIn, UnitDecisionIn
from app.sop.tobe import NaSlotIn, TargetDocIn, WiStepIn
from tests.sop_helpers import AUTHOR

pytestmark = pytest.mark.usefixtures("clean_sop")

NUL_TEXT = "합성\x00글"
BULK_UNITS = [{"unit_id": 1, "revision": 1}]
UNIT_FIELDS = {"unit_id": 1, "revision": 1, "disposition": "move_external"}


@pytest.mark.parametrize(
    ("model", "fields"),
    [
        (BundleCreateIn, {"title": NUL_TEXT}),
        (BundleCreateIn, {"title": "Synthetic", "description": NUL_TEXT}),
        (BundleUpdateIn, {"revision": 1, "title": NUL_TEXT}),
        (BundleUpdateIn, {"revision": 1, "description": NUL_TEXT}),
        (MemberIn, {"login_id": NUL_TEXT, "role": "author"}),
        (ReviewReasonIn, {"revision": 1, "reason": NUL_TEXT}),
        (DocumentUpdateIn, {"revision": 1, "doc_code": NUL_TEXT}),
        (DocumentUpdateIn, {"revision": 1, "doc_version": NUL_TEXT}),
        (DocumentUpdateIn, {"revision": 1, "title": NUL_TEXT}),
        (WarningAckIn, {"note": NUL_TEXT}),
        (UnitDecisionIn, {**UNIT_FIELDS, "reason": NUL_TEXT}),
        (UnitDecisionIn, {**UNIT_FIELDS, "move_target_code": NUL_TEXT}),
        (TargetIn, {"key": "t", "source_unit_ids": [], "text": NUL_TEXT}),
        (GroupSaveIn, {"action": "hold", "hold_reason": NUL_TEXT, "units": [], "targets": []}),
        (BulkDecisionIn, {"action": "delete", "reason": NUL_TEXT, "units": BULK_UNITS}),
        (
            BulkDecisionIn,
            {"action": "move_external", "reason": "Synthetic", "move_target_code": NUL_TEXT, "units": BULK_UNITS},
        ),
        (TargetDocIn, {"code": NUL_TEXT, "doc_type": "sop"}),
        (TargetDocIn, {"code": "SOP-1", "title": NUL_TEXT, "doc_type": "sop"}),
        (TargetDocIn, {"code": "WI-1", "doc_type": "wi", "parent_code": NUL_TEXT}),
        (NaSlotIn, {"code": NUL_TEXT, "slot_key": "scope", "reason": "Synthetic"}),
        (NaSlotIn, {"code": "SOP-1", "slot_key": "scope", "reason": NUL_TEXT}),
        (WiStepIn, {"code": NUL_TEXT, "step_no": 1}),
        (WiStepIn, {"code": "WI-1", "step_no": 1, "title": NUL_TEXT}),
    ],
)
def test_input_text_rejects_nul(model: type[BaseModel], fields: dict[str, object]) -> None:
    with pytest.raises(ValidationError, match="NUL"):
        model.model_validate(fields)


def test_nul_check_keeps_strip_and_length_rules() -> None:
    """길이는 공백을 걷은 뒤에 잰다 — NUL 검사를 StringConstraints 앞에 두면 이 순서가 뒤집힌다."""
    assert BundleCreateIn(title=f"  {'x' * 200}  ").title == "x" * 200
    for title in ("   ", "x" * 201):
        with pytest.raises(ValidationError):
            BundleCreateIn(title=title)


def test_api_rejects_nul_in_a_json_field(client: TestClient) -> None:
    response = client.post("/api/bundles", json={"title": "Synthetic\u0000 bundle", "is_synthetic": True}, headers=AUTHOR)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "title"]
