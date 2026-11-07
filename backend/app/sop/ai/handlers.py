"""작업 종류 → 핸들러 표 — 실행기가 kind로 찾는다. 표에 없는 종류의 작업은 failed(internal)로 끝난다."""

from app.sop.ai.runner import JobHandler

HANDLERS: dict[str, JobHandler] = {}
