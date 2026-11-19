"""Take back what AI classify / match wrote into decisions and New sentences — AI now writes only ai_suggestions rows.

AI 분류·묶기가 판단과 새 문장에 직접 쓰던 것을 걷는다(설계 2026-11-19-ai-suggest-only D1·D7). 실제 사용 전이라 지워도 된다:
AI가 쓴 입구 1 새 문장(origin units, ai_suggested)과 거기 딸린 번역은 지우고, 입구 2 새 문장은 원문이라 출처를 떼어 미배정으로,
AI 제안·AI 무효 보류 판단은 미배정으로 돌린다. 살아 있는 제안 행은 새 내용 모양으로 고쳐 남겨 사람이 받을 제안이 된다 —
분류는 지워질 새 문장을 가리키던 `target_ids`를 빼고, 묶기는 지울 출처 연결·변경 종류를 `links`·`target_change_types`로 옮긴다.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-19 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0031"
down_revision: str | Sequence[str] | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_AI_HELD = "status = 'on_hold' AND hold_reason = 'system:ai_invalid_response'"  # constants.SYSTEM_HOLD_AI_INVALID
_AI_DECISIONS = f"SELECT unit_id FROM unit_decisions WHERE status = 'ai_suggested' OR ({_AI_HELD})"
# 칸 제목은 사람이 만든 행이고 상태만 출처 판단을 따른다 — 지우지 않고 상태를 다시 정한다
_AI_UNIT_TARGETS = "SELECT id FROM target_sentences WHERE origin = 'units' AND status = 'ai_suggested' AND kind <> 'slot_heading'"
_AI_NEW_DOC_TARGETS = "SELECT id FROM target_sentences WHERE origin = 'new_doc' AND status = 'ai_suggested'"


_suggestions = sa.table(
    "ai_suggestions", sa.column("id", sa.Integer), sa.column("kind", sa.String), sa.column("result", sa.String),
    sa.column("adoption", sa.String), sa.column("content", sa.JSON),
)
_sources = sa.table("target_sources", sa.column("target_id", sa.Integer), sa.column("unit_id", sa.Integer), sa.column("seq", sa.Integer))
_targets = sa.table("target_sentences", sa.column("id", sa.Integer), sa.column("change_type", sa.String))


def _reshape_live_suggestions() -> None:
    """살아 있는(applied, 채택 없음) 분류·묶기 제안을 새 내용 모양으로 — 출처 연결을 지우기 전에 읽어 옮긴다."""
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(_suggestions.c.id, _suggestions.c.kind, _suggestions.c.content).where(
            _suggestions.c.result == "applied", _suggestions.c.adoption.is_(None),
            _suggestions.c.kind.in_(("classify", "match")),
        )
    ).all()
    for suggestion_id, kind, content in rows:
        content = dict(content or {})
        if kind == "classify":
            content.pop("target_ids", None)
        elif "links" not in content:
            target_ids = list(content.get("target_ids", []))
            links = bind.execute(
                sa.select(_sources.c.target_id, _sources.c.unit_id)
                .where(_sources.c.target_id.in_(target_ids))
                .order_by(_sources.c.target_id, _sources.c.seq)
            ).all() if target_ids else []
            types = bind.execute(
                sa.select(_targets.c.id, _targets.c.change_type).where(_targets.c.id.in_(target_ids))
            ).all() if target_ids else []
            content["links"] = [[target_id, unit_id] for target_id, unit_id in links]
            content["target_change_types"] = {str(target_id): change for target_id, change in types if change is not None}
        bind.execute(_suggestions.update().where(_suggestions.c.id == suggestion_id).values(content=content))


def upgrade() -> None:
    """Upgrade data."""
    _reshape_live_suggestions()
    # 걷을 판단의 단위를 번역한 줄과 지울 AI 표 아래 칸 번역 — 따를 출처 새 문장이 사라진다. 실제 사용 전이라 확정한 번역도 지운다
    op.execute(
        "DELETE FROM target_sentences WHERE origin = 'translation' "
        f"AND (translation_source_unit_id IN ({_AI_DECISIONS}) OR parent_target_id IN ({_AI_UNIT_TARGETS}))"
    )
    # sqlite는 alembic 연결에서 외래 키 CASCADE가 꺼져 있을 수 있어 출처 연결을 먼저 지운다(칸·캡션 자식도 같은 조건에 든다)
    op.execute(f"DELETE FROM target_sources WHERE target_id IN ({_AI_UNIT_TARGETS})")
    op.execute(f"DELETE FROM target_sentences WHERE id IN ({_AI_UNIT_TARGETS})")
    op.execute(f"DELETE FROM target_sources WHERE target_id IN ({_AI_NEW_DOC_TARGETS})")
    op.execute(
        "UPDATE target_sentences SET status = 'unassigned', change_type = NULL, hold_reason = '', warnings = '[]', "
        "confirmed_by = NULL, confirmed_at = NULL, suggestion_id = NULL, revision = revision + 1 "
        "WHERE origin = 'new_doc' AND status = 'ai_suggested'"
    )
    op.execute(
        "UPDATE target_sentences SET status = 'unassigned', hold_reason = '', revision = revision + 1 "
        f"WHERE kind = 'slot_heading' AND (status = 'ai_suggested' OR ({_AI_HELD}))"
    )
    op.execute(
        "UPDATE unit_decisions SET status = 'unassigned', disposition = 'unassigned', hold_reason = '', "
        f"suggestion_id = NULL, revision = revision + 1 WHERE status = 'ai_suggested' OR ({_AI_HELD})"
    )


def downgrade() -> None:
    """지운 AI 새 문장과 판단은 되살릴 수 없다 — 제안 행이 남아 있어 다시 받을 수 있다."""
