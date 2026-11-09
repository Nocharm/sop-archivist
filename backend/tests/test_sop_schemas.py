"""SOP 입력 글자 칸 — Postgres text가 담지 못하는 NUL·짝 없는 서로게이트는 칸마다 경계에서 422로 막고(값은 응답에 되돌리지 않는다), 공백 걷기·길이 규칙은 그대로다."""

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

from app.routers.sop_bundles import BundleCreateIn, BundleUpdateIn, MemberIn, ReviewReasonIn
from app.routers.sop_documents import DocumentUpdateIn, WarningAckIn
from app.sop.decisions import BulkDecisionIn, GroupSaveIn, TargetIn, UnitDecisionIn
from app.sop.tobe import NaSlotIn, TargetDocIn, WiStepIn
from app.sop.segment import has_unstorable_char
from tests.sop_helpers import AUTHOR, create_bundle

pytestmark = pytest.mark.usefixtures("clean_sop")

NUL_TEXT = "합성\x00글"
SURROGATE_TEXT = "합성\ud800글"
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
    assert BundleCreateIn(title="   ").title == ""  # 이름 없이 만들 수 있다(코드로 보인다)
    with pytest.raises(ValidationError):
        BundleCreateIn(title="x" * 201)


def test_api_rejects_nul_in_a_json_field(client: TestClient) -> None:
    response = client.post("/api/bundles", json={"title": "Synthetic\u0000 bundle", "is_synthetic": True}, headers=AUTHOR)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "title"]


@pytest.mark.parametrize("text", ["\x00", "\ud800", "\udbff", "\udc00", "\udfff", "a\ud83dz"])
def test_has_unstorable_char_flags_nul_and_surrogates(text: str) -> None:
    assert has_unstorable_char(text)


@pytest.mark.parametrize("text", ["", "합성 text", "\U0001f600", "\ud7ff\ue000"])
def test_has_unstorable_char_accepts_storable_text(text: str) -> None:
    """서로게이트 범위 바로 바깥 글자와 짝을 이룬 문자(이모지)는 받는다."""
    assert not has_unstorable_char(text)


@pytest.mark.parametrize(
    ("model", "fields"),
    [
        (BundleCreateIn, {"title": SURROGATE_TEXT}),
        (BundleUpdateIn, {"revision": 1, "description": SURROGATE_TEXT}),
        (TargetIn, {"key": "t", "source_unit_ids": [], "text": SURROGATE_TEXT}),
        (UnitDecisionIn, {**UNIT_FIELDS, "reason": SURROGATE_TEXT}),
    ],
)
def test_input_text_rejects_lone_surrogate(model: type[BaseModel], fields: dict[str, object]) -> None:
    """pydantic이 str 단계에서 이미 거절한다 — 어느 층이 막든 짝 없는 서로게이트가 칸을 통과하지 못함을 지킨다."""
    with pytest.raises(ValidationError):
        model.model_validate(fields)


def test_lone_surrogate_in_json_is_422_without_echo(client: TestClient) -> None:
    bundle = create_bundle(client)
    body = b'{"revision": 1, "title": "\\ud800"}'

    response = client.patch(
        f"/api/bundles/{bundle['id']}", content=body, headers={**AUTHOR, "content-type": "application/json"}
    )

    assert response.status_code == 422
    assert "input" not in response.json()["detail"][0]


def test_validation_error_never_echoes_input(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = client.patch(f"/api/bundles/{bundle['id']}", json={"revision": 1, "title": "x" * 300}, headers=AUTHOR)

    assert response.status_code == 422
    assert "xxx" not in response.text
    assert set(response.json()["detail"][0]) == {"type", "loc", "msg"}


def test_optional_text_fields_report_string_too_long(client: TestClient) -> None:
    bundle = create_bundle(client)

    response = client.patch(
        f"/api/bundles/{bundle['id']}", json={"revision": 1, "description": "x" * 2001}, headers=AUTHOR
    )

    assert response.json()["detail"][0]["type"] == "string_too_long"


def test_lone_surrogate_in_a_json_key_is_422(client: TestClient) -> None:
    """검증 오류의 loc에는 딕셔너리 키가 실린다 — 짝 없는 서로게이트 키도 응답 인코딩을 깨지 않고 글자가 그대로 되돌아가지 않는다."""
    bundle = create_bundle(client)
    body = b'{"revision": 1, "checks": {"\\ud800": "x"}}'

    response = client.put(
        f"/api/bundles/{bundle['id']}/semantic-checks", content=body, headers={**AUTHOR, "content-type": "application/json"}
    )

    assert response.status_code == 422
    assert "\ud800" not in response.text
