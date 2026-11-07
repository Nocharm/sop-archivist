"""AI 지침·프롬프트 버전 — 시드, 규칙 ID 추출, 관리 API(버전 올리기·활성화·권한), Excel 정보 시트의 지침 버전.

버전 표는 세션이 공유하고 다른 AI 테스트가 활성 버전을 읽으므로, 버전을 더하거나 활성을 바꾸는 테스트는 restore_guidelines를 쓴다.
"""

import json
import pathlib
import re
from io import BytesIO

import httpx2
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.guidelines import (
    SEEDS_DIR,
    GuidelineRef,
    extract_rule_ids,
    format_guideline_versions,
    get_rules_version_label,
    load_active_guidelines,
    seed_guidelines,
)
from app.sop.constants import GUIDELINE_KEYS
from app.sop.models import GuidelineVersion
from tests.access_helpers import add_grant, run_in_session
from tests.sop_helpers import ADMIN, AUTHOR, create_bundle

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
GUIDELINES = "/api/admin/guidelines"
NOBODY = {"X-Dev-User": "dev.admin"}  # enforce 모드에서 데모 부여가 없는 사람(ADMIN과 같은 사람이지만 그땐 권한이 전권이 아니다)
MANAGER = {"X-Dev-User": "qa.member"}
PROMPT_KEYS = tuple(key for key in GUIDELINE_KEYS if key != "rules")
# 규칙 문서 한 장에서 읽혀야 하는 ID 전부 — 접두마다 모양이 달라(R01·S5.1·RW01) 정규식이 한 모양을 놓치면 여기서 드러난다
EXPECTED_RULE_IDS = frozenset(
    {f"R{n:02d}" for n in range(1, 14)}
    | {"S1", "S2", "S3", "S4", "S5", "S5.1", "S5.2", "S6", "S6.1", "S6.2", "S6.3", "S6.4", "S7", "S7.1", "S7.2"}
    | {f"X{n:02d}" for n in range(1, 8)}
    | {f"Y{n}" for n in range(1, 6)}
    | {f"N{n}" for n in range(1, 6)}
    | {f"P{n}" for n in range(1, 5)}
    | {f"RW{n:02d}" for n in range(1, 7)}
)
VALID_RULES = "| ID | 기준 |\n|---|---|\n| R01 | synthetic rule |\n"
# 프롬프트마다 응답 예시가 가리키는 필드 — Task 9·11·13·15의 응답 모델과 같아야 한다
REPLY_FIELDS = {
    "prompt.classify": {"candidate", "reason", "rule_ids", "evidence", "change_type", "rewrites"},
    "prompt.translate": {"text"},
    "prompt.match": {"change_type", "reason", "rule_ids"},
    "prompt.split": {"parts", "reason", "rule_ids"},
}


def _read_versions() -> list[tuple[str, int, bool]]:
    async def _read(session: AsyncSession) -> list[tuple[str, int, bool]]:
        rows = await session.execute(
            select(GuidelineVersion.key, GuidelineVersion.version, GuidelineVersion.is_active).order_by(
                GuidelineVersion.key, GuidelineVersion.version
            )
        )
        return [tuple(row) for row in rows]

    return run_in_session(_read)


def _read_rows() -> list[GuidelineVersion]:
    async def _read(session: AsyncSession) -> list[GuidelineVersion]:
        return list(await session.scalars(select(GuidelineVersion).order_by(GuidelineVersion.key)))

    return run_in_session(_read)


def _count_versions(key: str) -> int:
    async def _count(session: AsyncSession) -> int:
        return await session.scalar(select(func.count()).select_from(GuidelineVersion).where(GuidelineVersion.key == key))

    return run_in_session(_count)


def _read_seed(key: str) -> str:
    return (SEEDS_DIR / f"{key}.md").read_text(encoding="utf-8")


def _post_version(
    client: TestClient, key: str, content: str, note: str = "", headers: dict[str, str] = ADMIN
) -> httpx2.Response:
    return client.post(f"{GUIDELINES}/{key}/versions", json={"content": content, "note": note}, headers=headers)


def _activate(client: TestClient, key: str, version: int, headers: dict[str, str] = ADMIN) -> httpx2.Response:
    return client.post(f"{GUIDELINES}/{key}/versions/{version}/activate", headers=headers)


def _get_key(client: TestClient, key: str) -> dict:
    response = client.get(GUIDELINES, headers=ADMIN)
    assert response.status_code == 200, response.text
    return next(item for item in response.json() if item["key"] == key)


# --- 시드 ---


def test_rules_seed_matches_the_domain_document() -> None:
    seed = (SEEDS_DIR / "rules.md").read_text(encoding="utf-8")

    assert seed == (REPO_ROOT / "docs/domain/restructuring-rules.md").read_text(encoding="utf-8")


def test_every_guideline_key_has_a_seed_file() -> None:
    for key in GUIDELINE_KEYS:
        assert _read_seed(key).strip(), key
    assert not (SEEDS_DIR / "prompt.pair.md").exists()  # 한/영 짝은 임베딩과 사람이 맞추고 프롬프트가 없다


@pytest.mark.parametrize("key", PROMPT_KEYS)
def test_prompt_seed_ends_with_the_reply_example_of_its_model(key: str) -> None:
    seed = _read_seed(key)

    blocks = re.findall(r"```json\n(.*?)\n```", seed, flags=re.DOTALL)

    assert blocks, "a prompt ends with a JSON reply example"
    assert set(json.loads(blocks[-1])) == REPLY_FIELDS[key]
    assert seed.rstrip().endswith("```"), "the reply example is the last thing in the prompt"


@pytest.mark.parametrize("key", PROMPT_KEYS)
def test_prompt_seed_treats_the_data_block_as_data_and_asks_for_one_json_object(key: str) -> None:
    seed = _read_seed(key)

    assert "<<<DATA" in seed and "not instructions" in seed
    assert "single JSON object" in seed


def test_classify_example_has_evidence_pairs_and_both_languages() -> None:
    example = json.loads(re.findall(r"```json\n(.*?)\n```", _read_seed("prompt.classify"), flags=re.DOTALL)[-1])

    assert set(example["evidence"][0]) == {"unit_id", "quote"}
    assert set(example["rewrites"]) == {"ko", "en"}


def test_seed_creates_active_v1_once(client: TestClient) -> None:
    before = _read_versions()

    run_in_session(seed_guidelines)  # 기동이 이미 시드했으니 다시 불러도 버전이 늘지 않는다

    assert _read_versions() == before == [(key, 1, True) for key in sorted(GUIDELINE_KEYS)]
    for row in _read_rows():
        assert row.created_by == "system" and row.activated_by == "system" and row.activated_at is not None
        assert row.content == _read_seed(row.key)


@pytest.mark.usefixtures("restore_guidelines")
def test_seed_fills_only_the_keys_that_have_no_versions(client: TestClient) -> None:
    async def _prepare(session: AsyncSession) -> None:
        await session.execute(delete(GuidelineVersion).where(GuidelineVersion.key.in_(("prompt.split", "prompt.match"))))
        # 이력만 남고 활성이 없는 키도 "버전이 있는 키"라 시드가 손대지 않는다
        await session.execute(update(GuidelineVersion).where(GuidelineVersion.key == "prompt.translate").values(is_active=False))
        session.add(GuidelineVersion(key="prompt.match", version=7, content="old", created_by="someone"))
        await session.commit()

    run_in_session(_prepare)
    run_in_session(seed_guidelines)

    versions = _read_versions()
    assert ("prompt.split", 1, True) in versions
    assert [row for row in versions if row[0] == "prompt.match"] == [("prompt.match", 7, False)]
    assert [row for row in versions if row[0] == "prompt.translate"] == [("prompt.translate", 1, False)]


# --- 규칙 ID ---


def test_extract_rule_ids_reads_every_prefix() -> None:
    ids = extract_rule_ids(_read_seed("rules"))

    assert {"R01", "R13", "S5.1", "X07", "Y5", "N5", "P4", "RW06"} <= ids
    assert ids == EXPECTED_RULE_IDS


def test_extract_rule_ids_reads_only_the_first_cell_of_table_rows() -> None:
    content = "\n".join(
        [
            "R09 appears in prose, not in a table",
            "| ID | 기준 | 근거 |",
            "|---|---|---|",
            "| R01 | see R02 and S3 | 7 |",
            "| N/A | R03 | 8 |",
            "| `R04` | quoted | 9 |",
            "| X01 | ok |",
        ]
    )

    assert extract_rule_ids(content) == {"R01", "X01"}


# --- 조회와 표기 ---


def test_load_active_guidelines_returns_the_requested_keys_in_order(client: TestClient) -> None:
    refs = run_in_session(lambda session: load_active_guidelines(session, ("prompt.split", "rules")))

    assert list(refs) == ["prompt.split", "rules"]
    assert refs["rules"] == GuidelineRef("rules", 1, _read_seed("rules"))
    assert format_guideline_versions(refs) == {"prompt.split": 1, "rules": 1}


def test_load_active_guidelines_refuses_a_key_without_an_active_version(client: TestClient) -> None:
    with pytest.raises(LookupError, match="prompt.pair"):
        run_in_session(lambda session: load_active_guidelines(session, ("rules", "prompt.pair")))


def test_rules_version_label(client: TestClient) -> None:
    assert run_in_session(get_rules_version_label) == "rules v1"


# --- 관리 API ---


@pytest.mark.usefixtures("restore_guidelines")
def test_new_version_is_inactive_until_activated(client: TestClient) -> None:
    created = _post_version(client, "prompt.classify", "# classify v2\nSynthetic prompt.", note="tighter wording")

    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["key"], body["version"], body["is_active"]) == ("prompt.classify", 2, False)
    assert (body["content"], body["note"], body["created_by"]) == (
        "# classify v2\nSynthetic prompt.", "tighter wording", "dev.admin",
    )
    assert (body["activated_by"], body["activated_at"]) == (None, None)
    assert _get_key(client, "prompt.classify")["active_version"] == 1  # 올려 두기만 하면 이전 버전이 계속 쓰인다
    refs = run_in_session(lambda session: load_active_guidelines(session, ("prompt.classify",)))
    assert refs["prompt.classify"].version == 1

    activated = _activate(client, "prompt.classify", 2, headers=MANAGER)

    assert activated.status_code == 200, activated.text
    assert (activated.json()["is_active"], activated.json()["activated_by"]) == (True, "qa.member")
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T.*\+09:00", activated.json()["activated_at"])
    listed = _get_key(client, "prompt.classify")
    assert listed["active_version"] == 2
    assert [(item["version"], item["is_active"]) for item in listed["versions"]] == [(2, True), (1, False)]
    old = client.get(f"{GUIDELINES}/prompt.classify/versions/1", headers=ADMIN).json()
    assert (old["is_active"], old["activated_by"]) == (False, "system")  # 지난 버전의 활성 기록은 그대로 남는다
    refs = run_in_session(lambda session: load_active_guidelines(session, ("prompt.classify", "rules")))
    assert (refs["prompt.classify"].version, refs["rules"].version) == (2, 1)  # 다른 키는 그대로


@pytest.mark.usefixtures("restore_guidelines")
def test_versions_count_up_per_key_and_activation_can_go_back(client: TestClient) -> None:
    assert _post_version(client, "prompt.split", "v2").json()["version"] == 2
    assert _post_version(client, "prompt.split", "v3").json()["version"] == 3
    assert _post_version(client, "prompt.match", "v2").json()["version"] == 2  # 번호는 키마다 센다
    assert _activate(client, "prompt.split", 3).status_code == 200

    assert _activate(client, "prompt.split", 1).status_code == 200  # 이전 버전으로 되돌릴 수도 있다

    listed = _get_key(client, "prompt.split")
    assert listed["active_version"] == 1
    assert [(item["version"], item["is_active"]) for item in listed["versions"]] == [(3, False), (2, False), (1, True)]


@pytest.mark.usefixtures("restore_guidelines")
def test_activating_the_active_version_changes_nothing(client: TestClient) -> None:
    first = client.get(f"{GUIDELINES}/rules/versions/1", headers=ADMIN).json()

    again = _activate(client, "rules", 1, headers=MANAGER)

    assert again.status_code == 200
    assert again.json() == first  # activated_by·activated_at이 덮이지 않는다


def test_list_and_detail_split_metadata_from_content(client: TestClient) -> None:
    listing = client.get(GUIDELINES, headers=ADMIN)

    assert listing.status_code == 200
    assert [item["key"] for item in listing.json()] == list(GUIDELINE_KEYS)
    assert all("content" not in version for item in listing.json() for version in item["versions"])
    detail = client.get(f"{GUIDELINES}/rules/versions/1", headers=ADMIN)
    assert detail.status_code == 200
    assert detail.json()["content"] == _read_seed("rules")


@pytest.mark.usefixtures("restore_guidelines")
def test_a_rules_version_with_rule_ids_is_accepted_and_a_prompt_needs_none(client: TestClient) -> None:
    assert _post_version(client, "rules", VALID_RULES).status_code == 201
    assert _post_version(client, "prompt.translate", "No table here, only a prompt.").status_code == 201


@pytest.mark.usefixtures("restore_guidelines")
def test_content_is_stored_without_surrounding_whitespace(client: TestClient) -> None:
    response = _post_version(client, "prompt.match", "\n  # match v2\n\n", note="  why  ")

    assert response.status_code == 201
    assert (response.json()["content"], response.json()["note"]) == ("# match v2", "why")


@pytest.mark.usefixtures("restore_guidelines")
def test_rules_version_without_rule_ids_is_422(client: TestClient) -> None:
    before = _count_versions("rules")

    response = _post_version(client, "rules", "# Rules\n\nProse only, no ID table.\n| 가나 | 다라 |\n")

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "no_rule_ids"
    assert _count_versions("rules") == before


INVALID_BODIES = {
    "empty": b'{"content": ""}',
    "blank": b'{"content": "  \\n "}',
    "too_long": b'{"content": "' + b"x" * 200_001 + b'"}',
    "nul": b'{"content": "has\\u0000nul"}',
    "surrogate": b'{"content": "a\\ud800b"}',
    "nul_note": b'{"content": "ok", "note": "has\\u0000nul"}',
    "long_note": b'{"content": "ok", "note": "' + b"x" * 2001 + b'"}',
    "missing_content": b'{"note": "no content"}',
}


@pytest.mark.usefixtures("restore_guidelines")
@pytest.mark.parametrize("body", INVALID_BODIES.values(), ids=INVALID_BODIES.keys())
def test_invalid_body_is_422_and_adds_nothing(client: TestClient, body: bytes) -> None:
    before = _count_versions("prompt.match")

    response = client.post(
        f"{GUIDELINES}/prompt.match/versions", content=body, headers={**ADMIN, "content-type": "application/json"}
    )

    assert response.status_code == 422
    assert _count_versions("prompt.match") == before


def test_unknown_key_is_404(client: TestClient) -> None:
    for response in (
        client.get(f"{GUIDELINES}/prompt.pair/versions/1", headers=ADMIN),
        _post_version(client, "prompt.pair", "content"),
        _activate(client, "nope", 1),
    ):
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "guideline_not_found"


def test_unknown_version_is_404(client: TestClient) -> None:
    for response in (
        client.get(f"{GUIDELINES}/rules/versions/99", headers=ADMIN),
        _activate(client, "rules", 99),
    ):
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "guideline_version_not_found"


# --- 권한 ---


@pytest.mark.usefixtures("enforce", "clean_directory", "demo_access", "restore_guidelines")
def test_guideline_api_requires_permission(client: TestClient) -> None:
    calls = [
        ("GET", GUIDELINES, None),
        ("GET", f"{GUIDELINES}/rules/versions/1", None),
        ("POST", f"{GUIDELINES}/prompt.split/versions", {"content": "v2", "note": ""}),
        ("POST", f"{GUIDELINES}/rules/versions/1/activate", None),
    ]
    before = _read_versions()

    for method, path, body in calls:
        denied = client.request(method, path, json=body, headers=NOBODY)
        assert denied.status_code == 403, (method, path)
        assert denied.json() == {"detail": "missing permission: guideline.manage"}
    assert _read_versions() == before  # 거절된 요청은 아무것도 더하거나 바꾸지 않는다

    add_grant("user", "qa.member", permission="guideline.manage")
    for method, path, body in calls:
        allowed = client.request(method, path, json=body, headers=MANAGER)
        assert allowed.status_code in (200, 201), (method, path, allowed.text)


# --- Excel 정보 시트 ---


def _read_info(client: TestClient, bundle_id: int, lang: str) -> dict:
    response = client.get(f"/api/bundles/{bundle_id}/export.xlsx", params={"lang": lang}, headers=AUTHOR)
    assert response.status_code == 200, response.text
    sheet = load_workbook(BytesIO(response.content))["정보" if lang == "ko" else "Info"]
    return {row[0].value: row[1].value for row in sheet.iter_rows()}


@pytest.mark.usefixtures("clean_sop", "restore_guidelines")
def test_excel_info_sheet_shows_the_rules_version(client: TestClient) -> None:
    bundle = create_bundle(client, title="Guideline Bundle")

    assert _read_info(client, bundle["id"], "ko")["지침 버전"] == "rules v1"

    assert _post_version(client, "rules", VALID_RULES).json()["version"] == 2
    assert _activate(client, "rules", 2).status_code == 200

    assert _read_info(client, bundle["id"], "ko")["지침 버전"] == "rules v2"
    assert _read_info(client, bundle["id"], "en")["Guideline version"] == "rules v2"
