"""작업 종류 → 핸들러 표 — 실행기가 kind로 찾는다. 표에 없는 종류의 작업은 failed(internal)로 끝난다."""

from app.sop.ai.classify import CLASSIFY_HANDLER, CLASSIFY_KIND
from app.sop.ai.match_jobs import MATCH_HANDLER, MATCH_KIND, MATCH_PLAN_HANDLER, MATCH_PLAN_KIND
from app.sop.ai.pairing import PAIR_HANDLER, PAIR_KIND
from app.sop.ai.runner import JobHandler
from app.sop.ai.translate import TRANSLATE_HANDLER, TRANSLATE_KIND

HANDLERS: dict[str, JobHandler] = {
    CLASSIFY_KIND: CLASSIFY_HANDLER,
    TRANSLATE_KIND: TRANSLATE_HANDLER,
    MATCH_PLAN_KIND: MATCH_PLAN_HANDLER,
    MATCH_KIND: MATCH_HANDLER,
    PAIR_KIND: PAIR_HANDLER,
}
