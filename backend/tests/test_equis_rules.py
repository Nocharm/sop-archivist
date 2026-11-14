"""EQUIS 판정 규칙 테스트 — 순수 함수(HTTP·DB 없음). 줄은 모두 합성 값이다(설계 §6·§10)."""

from app.equis.rules import (
    DocFacts,
    EquisRow,
    build_facts,
    judge,
    normalize_number,
    parse_row,
    parse_version,
    read_kst_date,
    split_legacy,
)

EFFECTIVE_LIFECYCLE = "Draft to Effective Lifecycle"
APPROVED_LIFECYCLE = "Draft to Approved Lifecycle"
FINAL_LIFECYCLE = "Initial to Final Lifecycle"


def make_raw(version: str, status: str, **extra: object) -> dict[str, object]:
    """합성 EDW 줄 하나 — 필수 칸을 채우고 나머지는 덮어쓴다."""
    raw: dict[str, object] = {
        "DOC_DOCUMENT_NUMBER": "SOP-ABC-00001",
        "DOC_DOCUMENT_ID": "900001",
        "DOC_VERSION": version,
        "DOC_DOCUMENT_STATUS": status,
        "DOC_LIFECYCLE": EFFECTIVE_LIFECYCLE,
        "DOC_DOCUMENT_NAME": "Operation and Maintenance of UV spectrophotometer",
        "DOC_SUBTYPE": "Standard Operating Procedure (SOP)",
        "DOC_OWNING_DEPARTMENT": "Purification",
        "DOC_PLANT": "P1, P2, P3",
        "DOC_AREA": "Manufacturing Equipment",
        "DOC_LEGACY_DOCUMENT_ID": "SOP-ABC-1016",
        "DOC_EQUIPMENT_TAG_NO": "",
        "DOC_EFFECTIVE_DATE_KST": "",
        "DOC_APPROVED_DATE_KST": "",
        "DOC_SUPERSEDED_DATE_KST": "",
        "DOC_OBSOLETE_DATE_KST": "",
        "DOC_WITHDRAWN_DATE_KST": "",
    }
    raw.update(extra)
    return raw


def make_rows(*specs: tuple[str, str] | tuple[str, str, dict[str, object]]) -> list[EquisRow]:
    rows = []
    for spec in specs:
        extra = spec[2] if len(spec) == 3 else {}
        row = parse_row(make_raw(spec[0], spec[1], **extra))
        assert row is not None
        rows.append(row)
    return rows


def build_history() -> list[EquisRow]:
    """판 이력 끝부분(설계 §3, 인계서 7.5의 모양) — 최신판 표시가 여러 줄이고 초안에 시행일이 적혀 있다."""
    return make_rows(
        ("12.0", "Superseded", {"DOC_EFFECTIVE_DATE_KST": "2024-11-26T00:00:00.000Z"}),
        ("13.0", "Superseded", {"DOC_EFFECTIVE_DATE_KST": "2025-08-29T00:00:00.000Z"}),
        ("13.1", "Draft", {"DOC_EFFECTIVE_DATE_KST": "2025-08-29T00:00:00.000Z"}),
        ("13.4", "In Review", {"LATEST_VERSION__V": "True"}),
        ("14.0", "Effective", {"DOC_EFFECTIVE_DATE_KST": "2025-09-17T00:00:00.000Z", "LATEST_VERSION__V": "True"}),
        ("14.1", "Draft", {"DOC_EFFECTIVE_DATE_KST": "2025-09-17T00:00:00.000Z", "LATEST_VERSION__V": "True"}),
        ("14.2", "In Review", {"LATEST_VERSION__V": "True"}),
        ("15.0", "Authorized", {"LATEST_VERSION__V": "True"}),
    )


# --- 읽기 ---


def test_parse_version_reads_edw_and_app_forms() -> None:
    assert parse_version("14.1") == (14, 1)
    assert parse_version("3") == (3, 0)
    assert parse_version("v3") == (3, 0)
    assert parse_version("Ver 1.1") == (1, 1)
    assert parse_version("Rev. 2") == (2, 0)


def test_parse_version_unreadable_is_none() -> None:
    assert parse_version("") is None
    assert parse_version("draft") is None


def test_read_kst_date_keeps_the_date_part_only() -> None:
    # 칸 이름이 KST다 — UTC로 보고 바꾸면 하루가 밀린다
    assert read_kst_date("2025-09-17T00:00:00.000Z") == "2025-09-17"
    assert read_kst_date("") == ""
    assert read_kst_date(None) == ""
    assert read_kst_date("N/A") == ""


def test_split_legacy_splits_and_normalizes() -> None:
    assert split_legacy("frm-abc-2047-02 / FRM-ABC-00639") == ("FRM-ABC-2047-02", "FRM-ABC-00639")
    assert split_legacy("") == ()
    assert split_legacy(None) == ()


def test_normalize_number_trims_and_uppercases() -> None:
    assert normalize_number("  sop-abc-00001 ") == "SOP-ABC-00001"


def test_parse_row_keeps_only_listed_columns() -> None:
    raw = make_raw("14.0", "Effective", DOC_OWNER="Synthetic Person", DOC_AUTHOR="합성 작성자", DOC_CREATED_BY="System")
    row = parse_row(raw)
    assert row is not None
    assert "Synthetic Person" not in repr(row)
    assert "합성 작성자" not in repr(row)
    assert row.version == (14, 0) and row.version_text == "14.0"
    assert row.legacy_numbers == ("SOP-ABC-1016",)


def test_parse_row_accepts_non_string_values() -> None:
    # 웹훅은 글·불리언·숫자·null을 섞어 준다
    row = parse_row(make_raw("2.0", "Effective", DOC_DOCUMENT_ID=900001, DOC_AREA=None, DOC_VERSION=2.0))
    assert row is not None
    assert row.doc_id == "900001" and row.area == "" and row.version == (2, 0)


def test_parse_row_missing_required_column_is_none() -> None:
    for column in ("DOC_DOCUMENT_NUMBER", "DOC_DOCUMENT_ID", "DOC_VERSION", "DOC_DOCUMENT_STATUS", "DOC_LIFECYCLE"):
        assert parse_row(make_raw("1.0", "Effective", **{column: ""})) is None
    assert parse_row("not-a-dict") is None


# --- 문서 하나의 사실 ---


def test_current_version_ignores_latest_flag_and_draft_dates() -> None:
    facts = build_facts(build_history())
    assert facts.current is not None
    assert (facts.current.version_text, facts.current.status, facts.current.effective_date) == (
        "14.0", "Effective", "2025-09-17",
    )


def test_in_progress_keeps_only_versions_above_current() -> None:
    # 13.1 Draft와 13.4 In Review는 다음 정식 판에 밀려 남은 초안이다
    facts = build_facts(build_history())
    assert [(v.version_text, v.status) for v in facts.in_progress] == [
        ("14.1", "Draft"), ("14.2", "In Review"), ("15.0", "Authorized"),
    ]


def test_retired_when_highest_version_is_obsolete_or_withdrawn() -> None:
    obsolete = build_facts(make_rows(
        ("1.0", "Obsolete"), ("2.0", "Obsolete"),
        ("3.0", "Obsolete", {"DOC_OBSOLETE_DATE_KST": "2018-11-21T00:00:00.000Z"}),
    ))
    withdrawn = build_facts(make_rows(
        ("1.0", "Obsolete"), ("2.0", "Withdrawn", {"DOC_WITHDRAWN_DATE_KST": "2019-03-04T00:00:00.000Z"}),
    ))
    assert obsolete.current is None and obsolete.retired is not None
    assert (obsolete.retired.status, obsolete.retired.retired_date) == ("Obsolete", "2018-11-21")
    assert withdrawn.retired is not None and withdrawn.retired.retired_date == "2019-03-04"


def test_end_status_follows_lifecycle() -> None:
    approved = build_facts(make_rows(
        ("1.0", "Superseded", {"DOC_LIFECYCLE": APPROVED_LIFECYCLE}),
        ("2.0", "Approved", {"DOC_LIFECYCLE": APPROVED_LIFECYCLE}),
        ("2.1", "In Approval", {"DOC_LIFECYCLE": APPROVED_LIFECYCLE}),
    ))
    final = build_facts(make_rows(("1.0", "Final", {"DOC_LIFECYCLE": FINAL_LIFECYCLE})))
    assert approved.current is not None and approved.current.version_text == "2.0"
    assert [v.version_text for v in approved.in_progress] == ["2.1"]
    assert final.current is not None and final.current.status == "Final"


def test_approved_is_not_current_in_effective_lifecycle() -> None:
    # Effective 생애주기에서 Approved는 끝 상태가 아니다
    facts = build_facts(make_rows(("1.0", "Effective"), ("2.0", "Approved")))
    assert facts.current is not None and facts.current.version_text == "1.0"


def test_name_comes_from_highest_approved_version() -> None:
    # 초안이 이름을 바꿨어도 승인 전이면 쓰지 않는다. Authorized는 승인된 판이다
    facts = build_facts(make_rows(
        ("14.0", "Effective", {"DOC_DOCUMENT_NAME": "Old Name"}),
        ("15.0", "Authorized", {"DOC_DOCUMENT_NAME": "Approved Name", "DOC_PLANT": "Site"}),
        ("15.1", "Draft", {"DOC_DOCUMENT_NAME": "Draft Name"}),
        ("15.2", "In Review", {"DOC_DOCUMENT_NAME": "Review Name"}),
    ))
    assert facts.name == "Approved Name"
    assert facts.plant == "Site"  # 문서 정보는 이름을 고른 줄의 값


def test_draft_only_document_has_no_name() -> None:
    facts = build_facts(make_rows(("0.1", "Draft", {"DOC_DOCUMENT_NAME": "Draft Name"})))
    assert facts.name == "" and facts.current is None and facts.retired is None


def test_facts_round_trip_through_dict() -> None:
    facts = build_facts(build_history())
    assert DocFacts.from_dict(facts.to_dict()) == facts


# --- 줄의 판정 ---


def test_old_document_on_current_version_without_revisions_is_ok() -> None:
    facts = build_facts(make_rows(("5.0", "Superseded"), ("6.0", "Effective")))
    verdict = judge(facts, "old", "v6")
    assert verdict.verdict == "ok" and verdict.reasons == ()


def test_old_document_on_older_version_needs_attention() -> None:
    facts = build_facts(make_rows(("13.0", "Superseded"), ("14.0", "Effective")))
    assert judge(facts, "old", "13.0").reasons == ("version_mismatch",)


def test_old_document_with_authorized_next_version_needs_attention() -> None:
    verdict = judge(build_facts(build_history()), "old", "14.0")
    assert verdict.verdict == "attention" and verdict.reasons == ("newer_authorized",)


def test_in_review_next_version_is_a_note_not_a_warning() -> None:
    facts = build_facts(make_rows(("14.0", "Effective"), ("14.1", "Draft"), ("14.2", "In Review")))
    verdict = judge(facts, "old", "14.0")
    assert verdict.verdict == "ok"
    assert [(v.version_text, v.status) for v in verdict.notes] == [("14.2", "In Review")]


def test_reasons_stack_in_fixed_order() -> None:
    verdict = judge(build_facts(build_history()), "old", "13.0")
    assert verdict.reasons == ("version_mismatch", "newer_authorized")


def test_unreadable_app_version_skips_the_comparison() -> None:
    facts = build_facts(make_rows(("6.0", "Effective")))
    assert judge(facts, "old", "").verdict == "ok"
    assert judge(facts, "old", "final copy").verdict == "ok"


def test_retired_document_needs_attention_on_both_sides() -> None:
    facts = build_facts(make_rows(("3.0", "Obsolete", {"DOC_OBSOLETE_DATE_KST": "2018-11-21T00:00:00.000Z"})))
    assert judge(facts, "old", "3.0").reasons == ("retired",)
    assert judge(facts, "new", "").reasons == ("retired",)


def test_old_document_without_current_version_needs_attention() -> None:
    facts = build_facts(make_rows(("0.1", "Draft"), ("1.0", "Authorized")))
    assert judge(facts, "old", "1.0").reasons == ("no_current",)


def test_new_document_only_reports_existence() -> None:
    # 새 문서는 폐기만 본다 — 판 비교와 진행 중인 판은 경고가 아니다
    assert judge(build_facts(build_history()), "new", "").verdict == "in_equis"
    assert judge(build_facts(make_rows(("0.1", "Draft"))), "new", "").verdict == "in_equis"
