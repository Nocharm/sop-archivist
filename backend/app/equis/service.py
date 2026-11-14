"""EQUIS 조회 서비스 — 조회 요청·결과 보관·제목 따라가기(설계 §8).

조회는 저장 응답 뒤에 돈다(`run_lookup`). 조회 결과도 조회 실패도 어떤 저장을 막지 않는다.
"""

import logging
import re
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.clock import KST
from app.db import SessionLocal
from app.equis.client import EquisUnavailable, fetch_rows, is_sendable_number
from app.equis.rules import DocFacts, normalize_number, resolve_number
from app.settings import settings
from app.sop.events import record_event
from app.sop.models import Bundle, Document, EquisLookup, TargetDoc

logger = logging.getLogger(__name__)

# 이보다 오래 답이 없는 조회는 끝난 것으로 본다(초) — 서버가 재시작돼 남은 "조회 중"이 화면에 영영 남지 않게
PENDING_TIMEOUT_SECONDS = 60
# 받은 값을 다시 조회하는 간격(시간) — EDW 적재 주기에 맞춘 값. 재구성 중의 개정과 EQUIS에서 바꾼 제목을 따라간다
REFRESH_AFTER_HOURS = 24
# 실패한 조회를 다시 시도하는 간격(초) — 화면을 다시 읽을 때 저절로 낫게 한다
RETRY_UNAVAILABLE_SECONDS = 600
# "다시 조회"를 연달아 눌러도 웹훅을 다시 부르지 않는 간격(초)
REFRESH_DEBOUNCE_SECONDS = 30
# 제목을 EQUIS 이름으로 맞춘 기록의 행위자
SYSTEM_ACTOR = "system:equis"

_TEMP_CODE = re.compile(r"NEW-\d+")  # 번호 없는 올린 새 문서에 앱이 붙이는 임시 번호(tobe.temp_match_code)
_EDITABLE_STATUS = "in_progress"


def _to_aware(value: datetime) -> datetime:
    """sqlite는 시간대 없이 KST 벽시계로 돌려준다."""
    return value.replace(tzinfo=KST) if value.tzinfo is None else value


def needs_lookup(code: str) -> bool:
    """EQUIS에 물을 번호인지 — 빈 번호, 앱의 임시 번호, 문서 번호 꼴이 아닌 글은 묻지 않는다."""
    number = normalize_number(code)
    return bool(number) and _TEMP_CODE.fullmatch(number) is None and is_sendable_number(number)


def is_in_flight(lookup: EquisLookup, now: datetime) -> bool:
    """요청한 뒤 아직 답이 오지 않았고 제한 시간 안인지."""
    requested_at = _to_aware(lookup.requested_at)
    is_answered = lookup.fetched_at is not None and _to_aware(lookup.fetched_at) >= requested_at
    return not is_answered and now - requested_at < timedelta(seconds=PENDING_TIMEOUT_SECONDS)


def read_state(lookup: EquisLookup, now: datetime) -> str:
    """화면에 보일 상태 — 한 번도 답을 받지 못한 채 제한 시간을 넘긴 조회는 unavailable이다."""
    if lookup.state == "pending" and not is_in_flight(lookup, now):
        return "unavailable"
    return lookup.state


def is_stale(lookup: EquisLookup, now: datetime) -> bool:
    """다시 조회할 때가 됐는지 — 조회 중인 것은 건드리지 않는다."""
    if is_in_flight(lookup, now):
        return False
    if lookup.fetched_at is None:
        return True
    age = now - _to_aware(lookup.fetched_at)
    limit = (
        timedelta(seconds=RETRY_UNAVAILABLE_SECONDS)
        if lookup.state == "unavailable"
        else timedelta(hours=REFRESH_AFTER_HOURS)
    )
    return age > limit


def read_facts(lookup: EquisLookup | None) -> DocFacts | None:
    doc = (lookup.facts or {}).get("doc") if lookup else None
    return DocFacts.from_dict(doc) if doc else None


def is_title_locked(lookup: EquisLookup | None, now: datetime) -> bool:
    """제목을 사람이 고칠 수 없는지 — EQUIS 이름을 받았거나, 첫 조회가 도는 중이다(끝나며 제목이 바뀔 수 있다)."""
    if lookup is None or not settings.equis_enabled:
        return False
    state = read_state(lookup, now)
    if state == "pending":
        return True
    facts = read_facts(lookup)
    return state != "not_found" and facts is not None and bool(facts.name)


async def load_lookups(session: AsyncSession, codes: Iterable[str]) -> dict[str, EquisLookup]:
    """번호들의 조회 결과 — 열쇠는 다듬은 번호."""
    numbers = {normalize_number(code) for code in codes if needs_lookup(code)}
    if not numbers:
        return {}
    rows = await session.scalars(select(EquisLookup).where(EquisLookup.doc_number.in_(numbers)))
    return {row.doc_number: row for row in rows}


async def request_lookups(session: AsyncSession, codes: Iterable[str], *, force: bool = False) -> list[str]:
    """조회할 번호를 표시하고 그 번호들을 돌려준다 — 커밋은 호출부가 하고, 커밋 뒤 `run_lookup`에 넘긴다.

    처음 보는 번호와 다시 조회할 때가 된 번호만 고른다. 이미 조회 중인 번호는 건너뛴다(같은 번호는 한 번만 묻는다).
    force는 사람이 누른 "다시 조회"다.
    """
    if not settings.equis_enabled:
        return []
    numbers = sorted({normalize_number(code) for code in codes if needs_lookup(code)})
    existing = await load_lookups(session, numbers)
    now = clock.now()
    requested: list[str] = []
    for number in numbers:
        lookup = existing.get(number)
        if lookup is None:
            try:
                # 다른 요청이 같은 번호를 막 넣었을 수 있다 — 그 한 줄만 물리고 저장은 계속한다
                async with session.begin_nested():
                    session.add(EquisLookup(doc_number=number, state="pending", requested_at=now))
            except IntegrityError:
                continue
            requested.append(number)
        elif is_in_flight(lookup, now):
            continue
        elif force or is_stale(lookup, now):
            lookup.requested_at = now
            requested.append(number)
    return requested


async def apply_titles(session: AsyncSession, number: str, name: str, *, bundle_id: int | None = None) -> int:
    """그 번호를 쓰는 문서와 To-Be 줄의 제목을 EQUIS 이름으로 맞춘다. 바꾼 줄 수를 돌려준다.

    작업 중인 묶음만 바꾼다. revision은 올리지 않는다 — 제목은 EQUIS가 주인이라 사람의 다른 칸 저장과 다투지 않게 한다.
    결과물이 같은 칸을 읽으므로 화면만 바꾸지 않고 저장된 값을 바꾼다(설계 §8.3).
    """
    title = name[:500]
    documents = select(Document).join(Bundle, Bundle.id == Document.bundle_id).where(
        func.upper(func.trim(Document.doc_code)) == number, Bundle.status == _EDITABLE_STATUS, Document.title != title
    )
    targets = select(TargetDoc).join(Bundle, Bundle.id == TargetDoc.bundle_id).where(
        func.upper(func.trim(TargetDoc.code)) == number, Bundle.status == _EDITABLE_STATUS, TargetDoc.title != title
    )
    if bundle_id is not None:
        documents = documents.where(Document.bundle_id == bundle_id)
        targets = targets.where(TargetDoc.bundle_id == bundle_id)
    changed = 0
    for document in await session.scalars(documents):
        document.title = title
        record_event(
            session, bundle_id=document.bundle_id, actor=SYSTEM_ACTOR, action="document.update",
            target_type="document", target_ids=[document.id], detail={"source": "equis", "field": "title"},
        )
        changed += 1
    for target in await session.scalars(targets):
        target.title = title
        record_event(
            session, bundle_id=target.bundle_id, actor=SYSTEM_ACTOR, action="tobe.update",
            target_type="target_doc", target_ids=[target.id], detail={"source": "equis", "field": "title"},
        )
        changed += 1
    return changed


async def sync_bundle_titles(session: AsyncSession, bundle: Bundle) -> None:
    """묶음 안의 제목을 이미 받아 둔 EQUIS 이름에 맞춘다 — 번호를 고치거나 To-Be를 저장한 직후에 부른다.

    잠긴 줄에 사람이 다른 제목을 보내도 여기서 EQUIS 이름으로 돌아간다. 커밋은 호출부가 한다.
    """
    if not settings.equis_enabled or bundle.status != _EDITABLE_STATUS:
        return
    codes = list(await session.scalars(select(Document.doc_code).where(Document.bundle_id == bundle.id)))
    codes += list(await session.scalars(select(TargetDoc.code).where(TargetDoc.bundle_id == bundle.id)))
    for number, lookup in (await load_lookups(session, codes)).items():
        facts = read_facts(lookup)
        if lookup.state != "not_found" and facts is not None and facts.name:
            await apply_titles(session, number, facts.name, bundle_id=bundle.id)


async def run_lookup(number: str) -> None:
    """번호 하나를 조회해 결과를 담고 제목을 맞춘다 — 저장 응답 뒤에 따로 돈다(자기 세션).

    조회가 실패하면 상태만 바꾸고 전에 받은 사실은 지우지 않는다.
    """
    try:
        resolution = await resolve_number(number, fetch_rows)
    except EquisUnavailable as error:
        logger.warning("EQUIS lookup unavailable", extra={"number": number, "error": str(error)})
        resolution = None
    async with SessionLocal() as session:
        lookup = await session.get(EquisLookup, number)
        if lookup is None:
            return
        if resolution is None:
            lookup.state = "unavailable"
        else:
            lookup.state = resolution.state
            lookup.facts = {
                "doc": resolution.facts.to_dict() if resolution.facts else None,
                "trail": list(resolution.trail),
                "ambiguous": list(resolution.ambiguous),
            }
            if resolution.facts is not None and resolution.facts.name:
                await apply_titles(session, number, resolution.facts.name)
        lookup.fetched_at = clock.now()
        await session.commit()
