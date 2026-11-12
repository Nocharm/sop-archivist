"""검토 흐름 — 검토 요청 조건(막는 이유·알림)과 다음 행동, 의미 검토 확인, 상태 전이(요청·거두기·완료·되돌리기·다시 열기) (스펙 §7.15).

조건은 결과물·진행 숫자와 같은 스냅숏에서 계산해 화면의 숫자와 어긋나지 않게 하고, 질의 수는 단위 수와 무관하다.
"""

import asyncio
from collections import Counter
from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee
from app.sop.ai.jobs import cancel_active_jobs
from app.sop.constants import EQUIPMENT_SLOT_KEYS, SEMANTIC_CHECK_KEYS
from app.sop.errors import check_revision, raise_rule
from app.sop.events import record_event
from app.sop.membership import ensure_editable, lock_bundle
from app.sop.models import Bundle, BundleMember
from app.sop.outputs import build_review_facts
from app.sop.snapshot import (
    BundleSnapshot,
    count_unacked_missing_text,
    count_unchecked_boundaries,
    load_bundle_snapshot,
)
from app.sop.tobe import is_within_slot

NextAction = Literal[
    "upload_documents", "resolve_documents", "check_boundaries", "fill_tobe", "decide_units", "ack_warnings",
    "fill_reasons", "semantic_checks", "add_reviewer", "request_review", "await_review", "done",
]
Issue = dict[str, object]

PENDING_STATUSES = ("unassigned", "ai_suggested", "on_hold")  # 확정 전 상태 — 막는 이유 코드의 꼬리
REASON_DISPOSITIONS = ("delete", "move_external")  # 사유가 필수인 처분
UNRESOLVED_DOC_STATUSES = ("rejected", "failed")
TABLE_RESTRUCTURED = "table_restructured"


class Readiness(BaseModel):
    """검토 요청 조건 — blockers가 하나라도 있으면 검토 요청이 422, notices는 알리기만 한다."""

    ready: bool
    blockers: list[Issue]
    notices: list[Issue]
    next_action: NextAction


# --- 막는 이유와 알림 ---


def _list_pending_blockers(subject: str, counts: Mapping[str, int]) -> list[Issue]:
    """확정 전 상태(미배정·AI 제안·보류)별 건수 — 코드는 {subject}_{상태}."""
    return [{"code": f"{subject}_{status}", "count": counts[status]} for status in PENDING_STATUSES if counts[status]]


def _count_target_statuses(snap: BundleSnapshot) -> Counter[str]:
    """새 문장 상태 수 — 새 문장마다 한 번(언어를 가르지 않는다)."""
    return Counter(target.status for target in snap.targets.values())


def _find_units_missing_reason(snap: BundleSnapshot) -> list[int]:
    """사유가 비어 있는 삭제·이동 판단과 표 구성 변경 표 단위 — 사유는 모두 판단 단위에 적힌다."""
    unit_ids = {
        decision.unit_id
        for decision in snap.decisions.values()
        if decision.disposition in REASON_DISPOSITIONS and not decision.reason.strip()
    }
    for target in snap.targets.values():
        if target.change_type == TABLE_RESTRUCTURED and target.source_unit_ids:
            decision = snap.decisions.get(target.source_unit_ids[0])
            if decision is None or not decision.reason.strip():
                unit_ids.add(target.source_unit_ids[0])
    return sorted(unit_ids)


def _list_equipment_notices(snap: BundleSnapshot) -> list[Issue]:
    """장비 SOP에서 새 문장도 N/A도 없는 Procedures 하위 칸 — 상위 칸 N/A는 하위 칸을 덮는다. 완료를 막지 않는다."""
    filled: dict[int, set[str]] = {}
    for target in snap.targets.values():
        if target.slot_key is not None:
            filled.setdefault(target.target_doc_id, set()).add(target.slot_key)
    notices: list[Issue] = []
    for doc in sorted(snap.target_docs.values(), key=lambda doc: (doc.order_index, doc.id)):
        if not doc.is_equipment_sop:
            continue
        empty = [
            slot_key
            for slot_key in EQUIPMENT_SLOT_KEYS
            if slot_key not in filled.get(doc.id, set())
            and not any(is_within_slot(slot_key, na_key) for na_key in doc.na_slots)
        ]
        if empty:
            notices.append({"code": "equipment_sop_empty_slots", "doc_code": doc.code, "slot_keys": empty})
    return notices


def _pick_next_action(snap: BundleSnapshot, codes: set[str]) -> NextAction:
    """사람이 다음에 할 일 하나 — 막는 이유를 해야 하는 순서대로 훑어 처음 해당하는 것."""
    if snap.bundle.status == "in_review":
        return "await_review"
    if snap.bundle.status == "done":
        return "done"
    if not any(document.side == "old" for document in snap.documents.values()):
        return "upload_documents"
    if "unresolved_documents" in codes:
        return "resolve_documents"
    # 판단한 단위를 다시 자르면 판단이 떨어지므로 경계부터 굳힌다(단계 순서도 쪼개기가 To-Be·배정보다 앞)
    if "unchecked_boundaries" in codes:
        return "check_boundaries"
    if not snap.target_docs:
        return "fill_tobe"
    if any(code.startswith(("units_", "targets_")) for code in codes):
        return "decide_units"
    if "unacked_missing_text" in codes:
        return "ack_warnings"
    if codes & {"duplicate_without_reason", "missing_reason"}:
        return "fill_reasons"
    if "semantic_checks_incomplete" in codes:
        return "semantic_checks"
    if "no_reviewer" in codes:
        return "add_reviewer"
    return "request_review"


def evaluate_readiness(
    snap: BundleSnapshot,
    *,
    semantic_checks: Mapping[str, object],
    unacked_missing_text: int,
    unchecked_boundaries: Mapping[int, int],
    reviewer_count: int,
) -> Readiness:
    """스냅숏과 질의 몇 개로 읽은 숫자만으로 조건을 가린다 — 순수 함수라 큰 묶음도 스레드에서 돈다."""
    facts = build_review_facts(snap)
    blockers = _list_pending_blockers("units", facts.row_status_counts)
    blockers += _list_pending_blockers("targets", _count_target_statuses(snap))

    # 중복 배정의 사유도 판단 단위에 적힌다 — 판단 행이 없으면 사유도 없는 것이다(조회 경로가 KeyError로 죽지 않게)
    unreasoned = [
        unit_id
        for unit_id in facts.duplicate_unit_ids
        if (decision := snap.decisions.get(unit_id)) is None or not decision.reason.strip()
    ]
    if unreasoned:
        blockers.append({"code": "duplicate_without_reason", "count": len(unreasoned), "unit_ids": unreasoned})
    missing_reason = _find_units_missing_reason(snap)
    if missing_reason:
        blockers.append({"code": "missing_reason", "count": len(missing_reason), "unit_ids": missing_reason})
    if unacked_missing_text:
        blockers.append({"code": "unacked_missing_text", "count": unacked_missing_text})
    # 결과물·Excel이 이 단위 경계대로 나오므로, 사람이 경계를 다 본 뒤에만 검토로 넘긴다
    if unchecked_boundaries:
        blockers.append(
            {
                "code": "unchecked_boundaries",
                "count": sum(unchecked_boundaries.values()),
                "document_ids": sorted(unchecked_boundaries),
            }
        )
    unchecked = [key for key in SEMANTIC_CHECK_KEYS if semantic_checks.get(key) is not True]
    if unchecked:
        blockers.append({"code": "semantic_checks_incomplete", "missing": unchecked})
    if not reviewer_count:
        blockers.append({"code": "no_reviewer"})
    documents = snap.documents.values()
    if not any(document.side == "old" and document.status == "ready" for document in documents):
        blockers.append({"code": "no_documents"})
    # 거절·실패 문서가 남으면 결과물이 그 문서를 조용히 빠뜨린다 — 지우거나 다시 올려야 한다
    unresolved = sorted(document.id for document in documents if document.status in UNRESOLVED_DOC_STATUSES)
    if unresolved:
        blockers.append({"code": "unresolved_documents", "document_ids": unresolved})

    notices = _list_equipment_notices(snap)
    warned = sum(bool(target.warnings) for target in snap.targets.values())
    if warned:
        notices.append({"code": "sentence_warnings", "count": warned})
    return Readiness(
        ready=not blockers,
        blockers=blockers,
        notices=notices,
        next_action=_pick_next_action(snap, {str(blocker["code"]) for blocker in blockers}),
    )


async def _count_active_reviewers(session: AsyncSession, bundle_id: int) -> int:
    """퇴직자는 묶음을 열지 못하므로 활성 검토자만 센다 — 활성 검토자가 없으면 아무도 검토를 끝낼 수 없다."""
    count = await session.scalar(
        select(func.count())
        .select_from(BundleMember)
        .join(Employee, Employee.login_id == BundleMember.login_id)
        .where(BundleMember.bundle_id == bundle_id, BundleMember.role == "reviewer", Employee.active.is_(True))
    )
    return count or 0


async def compute_readiness(session: AsyncSession, bundle: Bundle, *, end_transaction: bool) -> Readiness:
    """검토 요청 조건을 지금 상태로 계산한다 — 질의 수는 단위 수와 무관하고, 개요마다 불리므로 원문 글자는 읽지 않는다.

    end_transaction=True(읽기 전용 경로)면 재료를 다 읽은 뒤 트랜잭션을 끝내 스냅숏의 묶음 행 공유 잠금을 놓고 계산한다.
    검토 요청은 False — 묶음을 FOR UPDATE로 잠근 채 조건을 보고 이어서 쓰므로 여기서 끝내면 잠금이 풀린다.
    """
    snap = await load_bundle_snapshot(session, bundle.id, include_text=False)
    unacked = await count_unacked_missing_text(session, bundle.id)
    unchecked_boundaries = await count_unchecked_boundaries(session, bundle.id)
    reviewers = await _count_active_reviewers(session, bundle.id)
    semantic_checks = dict(bundle.semantic_checks)
    if end_transaction:
        await session.commit()
    return await asyncio.to_thread(
        evaluate_readiness,
        snap,
        semantic_checks=semantic_checks,
        unacked_missing_text=unacked,
        unchecked_boundaries=unchecked_boundaries,
        reviewer_count=reviewers,
    )


async def get_next_action(session: AsyncSession, bundle: Bundle) -> NextAction:
    """개요에 싣는 다음 행동 — 검토 중·완료는 조건을 계산하지 않고 상태만 본다. 조건을 계산하면 읽기 트랜잭션을 끝낸다."""
    if bundle.status == "in_review":
        return "await_review"
    if bundle.status == "done":
        return "done"
    return (await compute_readiness(session, bundle, end_transaction=True)).next_action


# --- 의미 검토 확인 ---


async def update_semantic_checks(
    session: AsyncSession, bundle: Bundle, *, revision: int, checks: Mapping[str, bool], actor: str
) -> None:
    """의미 검토 4항목 확인을 통째로 바꾼다 — 바뀐 항목이 없으면 revision도 기록도 건드리지 않는다. 커밋은 호출부가 한다."""
    await lock_bundle(session, bundle)
    check_revision("bundle", bundle.id, revision, bundle.revision)
    ensure_editable(bundle)
    changed = [key for key in SEMANTIC_CHECK_KEYS if checks[key] != (bundle.semantic_checks.get(key) is True)]
    if not changed:
        return
    bundle.semantic_checks = {key: checks[key] for key in SEMANTIC_CHECK_KEYS}  # 새 dict라야 JSON 변경이 잡힌다
    bundle.revision += 1
    record_event(
        session, bundle_id=bundle.id, actor=actor, action="semantic_checks",
        target_type="semantic_check", target_ids=changed,
    )


# --- 상태 전이 ---


async def _lock_for_transition(session: AsyncSession, bundle: Bundle, revision: int, expected_status: str) -> None:
    """묶음을 잠그고 revision → 현재 상태 순으로 확인한다 — 다른 상태에서 부른 전이는 409 invalid_transition."""
    await lock_bundle(session, bundle)
    check_revision("bundle", bundle.id, revision, bundle.revision)
    if bundle.status != expected_status:
        raise_rule(409, "invalid_transition", status=bundle.status)


def _apply_transition(
    session: AsyncSession, bundle: Bundle, *, to_status: str, action: str, actor: str, reason: str = ""
) -> None:
    bundle.status = to_status
    bundle.revision += 1
    if to_status == "in_progress":
        # 돌아온 동안 내용이 바뀔 수 있어 의미 검토를 다시 확인하게 한다
        bundle.semantic_checks = dict.fromkeys(SEMANTIC_CHECK_KEYS, False)
    record_event(
        session, bundle_id=bundle.id, actor=actor, action=action, target_type="bundle", target_ids=[bundle.id],
        reason=reason,
    )


async def request_review(session: AsyncSession, bundle: Bundle, *, revision: int, actor: str) -> None:
    """작업 중 → 검토 중. 조건은 잠근 상태에서 다시 계산하고 막는 이유가 있으면 422 not_ready. 커밋은 호출부가 한다."""
    await _lock_for_transition(session, bundle, revision, "in_progress")
    readiness = await compute_readiness(session, bundle, end_transaction=False)
    if readiness.blockers:
        raise_rule(422, "not_ready", blockers=readiness.blockers)
    await cancel_active_jobs(session, bundle.id)
    _apply_transition(session, bundle, to_status="in_review", action="review.request", actor=actor)


async def withdraw_review(session: AsyncSession, bundle: Bundle, *, revision: int, actor: str) -> None:
    """검토 중 → 작업 중(작성자가 요청을 거둔다). 자기 요청을 물리는 것이라 사유를 받지 않는다. 커밋은 호출부가 한다."""
    await _lock_for_transition(session, bundle, revision, "in_review")
    _apply_transition(session, bundle, to_status="in_progress", action="review.withdraw", actor=actor)


async def complete_review(session: AsyncSession, bundle: Bundle, *, revision: int, actor: str) -> None:
    """검토 중 → 완료. 커밋은 호출부가 한다."""
    await _lock_for_transition(session, bundle, revision, "in_review")
    _apply_transition(session, bundle, to_status="done", action="review.complete", actor=actor)


async def return_review(session: AsyncSession, bundle: Bundle, *, revision: int, reason: str, actor: str) -> None:
    """검토 중 → 작업 중(되돌리기). 커밋은 호출부가 한다."""
    await _lock_for_transition(session, bundle, revision, "in_review")
    _apply_transition(session, bundle, to_status="in_progress", action="review.return", actor=actor, reason=reason)


async def reopen_review(session: AsyncSession, bundle: Bundle, *, revision: int, reason: str, actor: str) -> None:
    """완료 → 작업 중(다시 열기). 커밋은 호출부가 한다."""
    await _lock_for_transition(session, bundle, revision, "done")
    _apply_transition(session, bundle, to_status="in_progress", action="review.reopen", actor=actor, reason=reason)
