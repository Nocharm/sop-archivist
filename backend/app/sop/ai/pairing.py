"""한/영 따로 짝 제안 — 문서 하나의 짝 없는 한글·영어 문장을 임베딩으로 견줘 서로 가장 가까운 것끼리 제안 짝(출처 ai)으로 쓴다 (설계 §6.5, §7.11).

LLM을 부르지 않고 임베딩만 쓴다. 점수는 compute 안에서만 쓰고 제안·작업·응답·로그 어디에도 남기지 않는다(설계 §12).
짝은 사람이 확정하기 전까지 제안이고, 이미 짝인 단위는 후보가 아니라서 사람이나 코드가 맺은 짝을 덮지 않는다.
짝은 같은 부분(본문·머리말·꼬리말·각주) 안에서만 맺는다.
"""

import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sop.ai.apply import add_suggestion
from app.sop.ai.classify import load_input_refs
from app.sop.ai.constants import PAIR_THRESHOLD
from app.sop.ai.embeddings import EmbeddingUnavailable, UnavailableReason, embed_texts
from app.sop.ai.jobs import ACTIVE_JOB_STATUSES, JobItem
from app.sop.ai.matching import MatchItem
from app.sop.ai.runner import AiCallFailed
from app.sop.ai.schemas import SkippedOut
from app.sop.ai.similarity import cosine_matrix
from app.sop.editing import PAIR_LANGS, TEXT_KINDS
from app.sop.errors import raise_rule
from app.sop.models import AiJob, Document, SourceBlock, Unit, UnitPair, UnitPairMember
from app.sop.pair_settle import has_diverging_fates, load_decided_fates, settle_pairs
from app.sop.pairs import PAIR_SOURCE_AI
from app.sop.segment import has_visible_char
from app.sop.units import PAIR_SUGGESTED, UNIT_ACTIVE, get_latest_extraction_id

PAIR_KIND = "pair"
_SEPARATE_LAYOUT = "ko_en_separate"
_WHOLE_DOCUMENT = 0  # 건너뜀 응답의 unit_id — 문서 전체 요청이라 가리킬 단위가 없고, 0은 어떤 단위의 id도 아니다
# 임베딩을 못 쓰는 이유 → 작업 실패 코드. 꺼진 것은 다시 해도 소용없는 설정 문제고, 호출 실패는 다시 시도할 수 있는 연결 문제다
_FAILURE_OF_UNAVAILABLE: dict[UnavailableReason, str] = {"disabled": "config", "failed": "connection"}


def propose_language_pairs(
    kos: Sequence[MatchItem], ens: Sequence[MatchItem], scores: np.ndarray, threshold: float
) -> list[tuple[int, int]]:
    """scores[한글][영어]에서 서로 가장 가까운 한글·영어 쌍을 고른다 — [(한글 id, 영어 id)]를 한글 id 순으로 돌려준다.

    한쪽의 최고가 상대의 최고이기도 하고 점수가 임계값 이상일 때만 쌍이라 1:1이다. 최고가 둘 이상이면(같은 벡터) 작은 id가 이겨서
    넘긴 순서와 상관없이 같은 입력은 같은 결과다 — 되풀이되는 같은 문장은 가장 앞의 한 쌍만 나오고 나머지는 사람이 맺는다.
    """
    if not kos or not ens:
        return []
    ko_order = sorted(range(len(kos)), key=lambda index: kos[index].id)
    en_order = sorted(range(len(ens)), key=lambda index: ens[index].id)
    ordered = scores[np.ix_(ko_order, en_order)]
    best_en = ordered.argmax(axis=1)  # 첫 최댓값을 주는 argmax와 id 순 행렬 덕에 동점은 작은 id가 이긴다
    best_ko = ordered.argmax(axis=0)
    return [
        (kos[ko_order[row]].id, ens[en_order[col]].id)
        for row, col in enumerate(best_en)
        if best_ko[col] == row and ordered[row, col] >= threshold
    ]


# --- 요청 ---


async def select_pair_items(
    session: AsyncSession, bundle_id: int, document_id: int
) -> tuple[list[JobItem], list[SkippedOut]]:
    """요청을 작업 줄로 — 문서 하나에 작업 하나다. 따로 배치가 아니면 409, 이 문서의 짝 작업이 돌고 있으면 쌓지 않는다.

    옛 문서뿐 아니라 새 문서도 받는다 — 언어 배치는 두 쪽 모두 문서마다 고르고 짝은 언제나 한 문서 안에서 맺는다(설계 §6.5).
    """
    document = await session.get(Document, document_id)
    if document is None or document.bundle_id != bundle_id:
        raise_rule(404, "document_not_found")
    if document.language_layout != _SEPARATE_LAYOUT:
        raise_rule(409, "not_separate_layout")
    active = await session.scalar(
        select(AiJob.id)
        .where(
            AiJob.bundle_id == bundle_id, AiJob.kind == PAIR_KIND, AiJob.document_id == document_id,
            AiJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        .limit(1)
    )
    if active is not None:
        return [], [SkippedOut(unit_id=_WHOLE_DOCUMENT, reason="already_queued")]
    return [JobItem(document_id=document_id)], []


# --- load ---


@dataclass(frozen=True)
class _Loaded:
    """load가 읽어 둔 입력 — compute는 세션 없이 이 값만 본다. items는 {단위 id: 항목}이고 apply가 낡음을 견주는 기준이다."""

    items: dict[int, MatchItem]
    parts: dict[int, str]  # 단위 id → 원문 부분(본문·머리말·꼬리말·각주) — 단위는 바뀌지 않아 apply가 다시 읽지 않는다
    input_refs: dict[str, object]


async def _load_document(session: AsyncSession, job: AiJob) -> Document | None:
    """짝을 맺을 문서 — 지워졌거나 그사이 배치가 바뀌었으면 None(낡음)."""
    document = None if job.document_id is None else await session.get(Document, job.document_id)
    return document if document is not None and document.language_layout == _SEPARATE_LAYOUT else None


async def _load_items(
    session: AsyncSession, document_id: int
) -> tuple[int | None, dict[int, MatchItem], dict[int, str]]:
    """(최신 추출 id, 짝 없는 활성 한글·영어 글자 단위, 단위의 원문 부분) — 표·행에 묶인 칸 문장은 표의 판단을 따라 코드 짝처럼 뺀다.

    글자가 없는 단위는 비교할 수 없어 임베딩에 보내지 않고 사람 몫으로 남긴다(설계 §7.10, 입구 2와 같다).
    """
    extraction_id = await get_latest_extraction_id(session, document_id)
    if extraction_id is None:
        return None, {}, {}
    rows = await session.execute(
        select(Unit.id, Unit.lang, Unit.kind, Unit.text, SourceBlock.part)
        # 단위 자리(pos_seq)의 블록이 그 단위의 부분이다
        .join(SourceBlock, (SourceBlock.extraction_id == Unit.extraction_id) & (SourceBlock.seq == Unit.pos_seq))
        .outerjoin(UnitPairMember, UnitPairMember.unit_id == Unit.id)
        .where(
            Unit.extraction_id == extraction_id, Unit.status == UNIT_ACTIVE, Unit.kind.in_(TEXT_KINDS),
            Unit.group_unit_id.is_(None), Unit.lang.in_(sorted(PAIR_LANGS)), UnitPairMember.unit_id.is_(None),
        )
        .order_by(Unit.pos_seq, Unit.pos_start, Unit.id)
    )
    visible = [row for row in rows if has_visible_char(row.text)]
    return (
        extraction_id,
        {row.id: MatchItem(row.id, row.lang, row.kind, row.text) for row in visible},
        {row.id: row.part for row in visible},
    )


def _build_scores(
    kos: Sequence[MatchItem], ens: Sequence[MatchItem], vectors: Mapping[str, np.ndarray], parts: Mapping[int, str]
) -> np.ndarray:
    """코사인 점수 행렬 (한글 수, 영어 수) — 부분이 다른 쌍은 -inf라 임계값을 넘지 못하고 같은 부분의 최고를 가리지도 않는다.

    본문 문장이 머리말·꼬리말·각주 문장과 짝지어지면 안 된다(코드 짝과 같은 경계). 표 경계는 넘는다 — 한글 표와 영어 표가 짝인 배치가 있다.
    """
    scores = cosine_matrix(np.stack([vectors[item.text] for item in kos]), np.stack([vectors[item.text] for item in ens]))
    ko_parts = np.array([parts[item.id] for item in kos])
    en_parts = np.array([parts[item.id] for item in ens])
    return np.where(ko_parts[:, np.newaxis] == en_parts[np.newaxis, :], scores, -np.inf)


class PairHandler:
    """문서 하나 — 짝 없는 문장을 임베딩으로 견줘 제안 짝을 쓴다. 낡음은 짝마다 봐서 바뀐 단위가 든 짝만 건너뛴다."""

    async def load(self, session: AsyncSession, job: AiJob) -> _Loaded | None:
        document = await _load_document(session, job)
        if document is None:
            return None
        extraction_id, items, parts = await _load_items(session, document.id)
        return _Loaded(items, parts, {} if extraction_id is None else await load_input_refs(session, extraction_id))

    async def compute(self, job: AiJob, loaded: _Loaded) -> list[tuple[int, int]]:
        kos = [item for item in loaded.items.values() if item.lang == "ko"]
        ens = [item for item in loaded.items.values() if item.lang == "en"]
        if not kos or not ens:  # 한쪽뿐이면 견줄 상대가 없다
            return []
        try:
            vectors = await embed_texts(sorted({item.text for item in loaded.items.values()}), login_id=job.requested_by)
        except EmbeddingUnavailable as unavailable:
            raise AiCallFailed(_FAILURE_OF_UNAVAILABLE[unavailable.reason]) from unavailable
        scores = await asyncio.to_thread(_build_scores, kos, ens, vectors, loaded.parts)
        return await asyncio.to_thread(propose_language_pairs, kos, ens, scores, PAIR_THRESHOLD)

    async def apply(self, session: AsyncSession, job: AiJob, loaded: _Loaded, computed: list[tuple[int, int]]) -> str:
        """묶음 잠금 안에서 단위를 다시 읽어, 읽을 때와 같고 아직 짝이 없는 단위끼리의 쌍만 쓴다 — 그사이 짝이 생기거나 은퇴한 단위는 current에 없고 언어가 바뀐 단위는 달라진다.

        이미 서로 다른 곳으로 보낸 두 단위는 짝짓지 않는다(운명이 갈림, pair_settle — 한 줄의 처분은 하나다).
        짝을 쓴다고 문서 revision을 올리지 않는다. 사람의 짝 편집이 아니라 제안이라, 열어 둔 화면의 저장을 막지 않는다.
        다만 두 단위가 이미 같은 곳으로 확정돼 있으면 settle_pairs가 그 짝을 바로 확정하고, 확정은 revision을 올린다.
        """
        document = await _load_document(session, job)
        if document is None:
            return "stale"
        _, current, _ = await _load_items(session, document.id)
        fresh = [
            (ko_id, en_id) for ko_id, en_id in computed
            if current.get(ko_id) == loaded.items[ko_id] and current.get(en_id) == loaded.items[en_id]
        ]
        fates = await load_decided_fates(session, [unit_id for pair in fresh for unit_id in pair])
        fresh = [pair for pair in fresh if not has_diverging_fates(fates, pair)]
        pairs = [UnitPair(document_id=document.id, status=PAIR_SUGGESTED, source=PAIR_SOURCE_AI) for _ in fresh]
        session.add_all(pairs)
        await session.flush()  # 짝 id가 제안 내용에 든다
        session.add_all(
            UnitPairMember(pair_id=pair.id, unit_id=unit_id) for pair, unit_ids in zip(pairs, fresh, strict=True) for unit_id in unit_ids
        )
        suggestions = [
            add_suggestion(
                session, job, content={"pair_id": pair.id, "ko_unit_id": ko_id, "en_unit_id": en_id},
                result="applied", input_refs=loaded.input_refs,
            )
            for pair, (ko_id, en_id) in zip(pairs, fresh, strict=True)
        ]
        await session.flush()  # 짝이 제안 id를 가리킨다
        for pair, suggestion in zip(pairs, suggestions, strict=True):
            pair.suggestion_id = suggestion.id
        await settle_pairs(session, document.bundle_id, [unit_id for pair in fresh for unit_id in pair], job.requested_by)
        return "done"


PAIR_HANDLER = PairHandler()
