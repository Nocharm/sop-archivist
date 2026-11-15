"""Assign 화면의 읽기 — 이미 쓴 문서(입구 2)의 문장 목록과, Old Unit 하나에 가까운 New 문장 후보.

후보는 사람이 고를 거리를 좁히는 눈금이지 정답 확률이 아니다. LLM·임베딩 API를 부르지 않고 임베딩 캐시만 읽으며,
캐시에 없으면 글자 2-gram으로 떨어진다.
"""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import numpy as np
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.equis import service as equis_service
from app.equis.view import EquisOut, build_equis_out
from app.sop.ai.constants import CANDIDATE_MIN_EMBED, CANDIDATE_MIN_TEXT, CANDIDATE_LIMIT
from app.sop.ai.embeddings import load_cached_vectors
from app.sop.ai.similarity import build_text_bigrams, compare_bigrams
from app.sop.errors import raise_rule
from app.sop.groups import select_in_chunks
from app.sop.models import (
    EquisLookup,
    Extraction,
    Document,
    TargetDoc,
    TargetSentence,
    TargetSource,
    Unit,
    UnitPairMember,
    UnitRef,
)
from app.sop.refs import REF_LANG, check_ref_text, find_leading_number, read_ref_state

Basis = Literal["embedding", "text"]


class WrittenRefOut(BaseModel):
    """참조 줄인 새 문서 문장이 가리키는 문서 — 번호는 서버가 읽는다(출처 참조 줄의 번호, 없으면 이 문장의 글)."""

    number: str
    # 그 번호의 EQUIS 표시(참조 카드와 같은 모양, 새 문서 쪽 판정) — 기능이 꺼져 있으면 null. 처음 보는 번호는 pending으로
    # 나가고 목록을 읽은 요청이 조회를 건다(refreshing이 꺼질 때까지 화면이 다시 읽는다)
    equis: EquisOut | None = None


class WrittenSentenceOut(BaseModel):
    target_id: int
    target_doc_id: int
    doc_code: str
    section_path: str
    order_index: int
    lang: str
    kind: str
    text: str
    status: str
    change_type: str | None
    remark: str
    source_unit_ids: list[int]
    # 같은 New 문서의 한/영 짝 상대가 만든 문장 — Old 짝 조각에 함께 붙이는 데 쓴다
    partner_target_id: int | None
    revision: int
    # 참조 줄이면 가리키는 문서 — 출처가 참조 줄인 문장과, 출처 없이 이 문서에만 있는 참조 줄 둘 다. 아니면 null
    ref: WrittenRefOut | None = None
    # 참조 줄인데 이 문장의 번호나 이름이 EQUIS와 다르다 — 작은 주의. 참조 줄이 아니거나 견줄 값이 없으면 null
    # (EQUIS가 모르는 번호·폐기한 문서는 여기 싣지 않는다 — ref.equis의 state·retired로 보인다)
    ref_issue: Literal["number", "title"] | None = None


class NewCandidateOut(BaseModel):
    target_id: int
    target_doc_id: int
    doc_code: str
    section_path: str
    text: str
    basis: Basis


@dataclass(frozen=True)
class _Ref:
    """참조 줄인 문장 하나의 번호와, EQUIS에 맞춘 글을 만들 때 바탕이 되는 원문(출처 참조 줄의 글 또는 이 문장의 글)."""

    number: str
    source_text: str


@dataclass(frozen=True)
class WrittenRow:
    """후보 순위에 쓰는 New 문장 한 줄 — 순수 함수가 받는 불변 값."""

    target_id: int
    lang: str
    kind: str
    text: str


def rank_new_candidates(
    unit_text: str,
    unit_vector: np.ndarray | None,
    rows: list[WrittenRow],
    vectors: dict[str, np.ndarray],
    limit: int = CANDIDATE_LIMIT,
) -> list[tuple[int, float, Basis]]:
    """(target_id, 점수, 근거)를 점수 내림차순으로. 두 쪽 벡터가 다 있으면 코사인, 아니면 글자 2-gram, 기준 미만은 뺀다."""
    unit_grams = build_text_bigrams(unit_text)
    scored: list[tuple[int, float, Basis]] = []
    for row in rows:
        row_vector = vectors.get(row.text)
        if unit_vector is not None and row_vector is not None:
            score = float(np.dot(unit_vector, row_vector))  # 캐시 벡터는 단위 정규화돼 있다
            if score >= CANDIDATE_MIN_EMBED:
                scored.append((row.target_id, score, "embedding"))
            continue
        score = compare_bigrams(unit_grams, build_text_bigrams(row.text))
        if score >= CANDIDATE_MIN_TEXT:
            scored.append((row.target_id, score, "text"))
    scored.sort(key=lambda item: (-item[1], item[0]))
    return scored[:limit]


async def list_written_sentences(session: AsyncSession, bundle_id: int) -> list[WrittenSentenceOut]:
    """입구 2 문서의 최상위 new_doc 문장 — 문서 순서 → 문장 순서. 질의는 셋(문장·출처·짝)이다."""
    rows = (
        await session.execute(
            select(TargetSentence, TargetDoc.code)
            .join(TargetDoc, TargetDoc.id == TargetSentence.target_doc_id)
            .where(
                TargetDoc.bundle_id == bundle_id,
                TargetDoc.entrance == "match",
                TargetSentence.origin == "new_doc",
                TargetSentence.parent_target_id.is_(None),
            )
            .order_by(TargetDoc.order_index, TargetDoc.id, TargetSentence.order_index, TargetSentence.id)
        )
    ).all()
    target_ids = [target.id for target, _ in rows]
    sources: dict[int, list[int]] = defaultdict(list)
    source_rows = await select_in_chunks(
        session,
        lambda chunk: select(TargetSource.target_id, TargetSource.unit_id)
        .where(TargetSource.target_id.in_(chunk))
        .order_by(TargetSource.target_id, TargetSource.seq),
        target_ids,
    )
    for target_id, unit_id in source_rows:
        sources[target_id].append(unit_id)
    partners = await _find_partner_targets(session, {target.new_unit_id: target.id for target, _ in rows if target.new_unit_id})
    refs = await _find_refs(session, [target for target, _ in rows], sources)
    lookups = await equis_service.load_lookups(session, [ref.number for ref in refs.values()])
    now = clock.now()
    return [
        WrittenSentenceOut(
            target_id=target.id,
            target_doc_id=target.target_doc_id,
            doc_code=code,
            section_path=target.section_path,
            order_index=target.order_index,
            lang=target.lang,
            kind=target.kind,
            text=target.confirmed_text,
            status=target.status,
            change_type=target.change_type,
            remark=target.remark,
            source_unit_ids=sources.get(target.id, []),
            partner_target_id=partners.get(target.id),
            revision=target.revision,
            ref=None if ref is None else WrittenRefOut(
                number=ref.number, equis=build_equis_out(ref.number, "new", "", lookups, now)
            ),
            ref_issue=None if ref is None else _check_ref(target.confirmed_text, ref, lookups.get(ref.number), now),
        )
        for target, code in rows
        for ref in [refs.get(target.id)]
    ]


async def _find_refs(
    session: AsyncSession, targets: Sequence[TargetSentence], sources: dict[int, list[int]]
) -> dict[int, _Ref]:
    """참조 줄인 문장과 그 번호(새 문장 id → 번호·견줄 원문).

    출처가 참조 줄(REF)이면 그 줄의 번호와 글이다(여럿이면 첫 참조 줄). 출처에 참조 줄이 없으면 이 문장의 단위를 옛 문서와 같은
    규칙으로 본다(`read_ref_state`) — 사람이 REF로 표시했거나, 글이 문서 번호로 시작하고 "참조 아님" 표시가 없다. 새 문서 쪽에는
    확인 절차가 없어 제안도 참조 줄로 친다(설계 2026-11-15 REF 문단 §7).
    """
    source_rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit.id, Unit.text, UnitRef.number)
        .join(UnitRef, UnitRef.unit_id == Unit.id)
        .where(Unit.id.in_(chunk), Unit.lang == REF_LANG),
        {unit_id for ids in sources.values() for unit_id in ids},
    )
    source_refs = {unit_id: _Ref(number, text) for unit_id, text, number in source_rows if number}
    refs: dict[int, _Ref] = {}
    own_units: dict[int, int] = {}
    for target in targets:
        linked = next((source_refs[unit_id] for unit_id in sources.get(target.id, []) if unit_id in source_refs), None)
        if linked is not None:
            refs[target.id] = linked
        elif target.new_unit_id is not None and (target.lang == REF_LANG or find_leading_number(target.confirmed_text)):
            own_units[target.new_unit_id] = target.id
    own_rows = await select_in_chunks(
        session,
        lambda chunk: select(Unit, UnitRef).outerjoin(UnitRef, UnitRef.unit_id == Unit.id).where(Unit.id.in_(chunk)),
        list(own_units),
    )
    for unit, mark in own_rows:
        state = read_ref_state(unit, mark)
        if state is not None and state.number:
            refs[own_units[unit.id]] = _Ref(state.number, unit.text)
    return refs


def _check_ref(
    text: str, ref: _Ref, lookup: EquisLookup | None, now: datetime
) -> Literal["number", "title"] | None:
    """참조 줄인 문장의 번호·이름이 EQUIS와 다른지 — 받아 둔 조회 결과로만 본다. EQUIS가 그 번호를 모르거나 폐기했으면 견주지 않는다."""
    facts = equis_service.read_facts(lookup)
    if lookup is None or facts is None or facts.retired or equis_service.read_state(lookup, now) != "found":
        return None
    return check_ref_text(text, ref.source_text, ref.number, facts.number, facts.name)


async def _find_partner_targets(session: AsyncSession, target_of_unit: dict[int, int]) -> dict[int, int]:
    """New 단위의 한/영 짝 → 그 상대가 만든 문장. 짝 한쪽이 여럿이면(1:N 짝) 상대를 하나로 정할 수 없어 뺀다."""
    if not target_of_unit:
        return {}
    pair_rows = await select_in_chunks(
        session,
        lambda chunk: select(UnitPairMember.pair_id, UnitPairMember.unit_id).where(
            UnitPairMember.pair_id.in_(select(UnitPairMember.pair_id).where(UnitPairMember.unit_id.in_(chunk)))
        ),
        list(target_of_unit),
    )
    members: dict[int, set[int]] = defaultdict(set)
    for pair_id, unit_id in pair_rows:
        members[pair_id].add(unit_id)
    partners: dict[int, int] = {}
    for unit_ids in members.values():
        targets = [target_of_unit[unit_id] for unit_id in unit_ids if unit_id in target_of_unit]
        if len(unit_ids) == 2 and len(targets) == 2:
            first, second = targets
            partners[first] = second
            partners[second] = first
    return partners


async def list_new_candidates(session: AsyncSession, bundle_id: int, unit_id: int) -> list[NewCandidateOut]:
    """Old 단위 하나와 같은 언어의 이미 쓴 문서 문장(표·그림 제외) 중 가까운 것 — 출처가 있는 문장도 낸다(합침이 될 수 있다)."""
    unit = (
        await session.execute(
            select(Unit.id, Unit.lang, Unit.text)
            .join(Extraction, Extraction.id == Unit.extraction_id)
            .join(Document, Document.id == Extraction.document_id)
            .where(Unit.id == unit_id, Document.bundle_id == bundle_id, Document.side == "old")
        )
    ).one_or_none()
    if unit is None:
        raise_rule(404, "unit_not_found")
    written = [row for row in await list_written_sentences(session, bundle_id) if row.kind == "sentence" and row.lang == unit.lang]
    rows = [WrittenRow(target_id=row.target_id, lang=row.lang, kind=row.kind, text=row.text) for row in written]
    vectors = await load_cached_vectors([unit.text, *(row.text for row in rows)])
    ranked = rank_new_candidates(unit.text, vectors.get(unit.text), rows, vectors)
    by_id = {row.target_id: row for row in written}
    return [
        NewCandidateOut(
            target_id=target_id,
            target_doc_id=by_id[target_id].target_doc_id,
            doc_code=by_id[target_id].doc_code,
            section_path=by_id[target_id].section_path,
            text=by_id[target_id].text,
            basis=basis,
        )
        for target_id, _, basis in ranked
    ]
