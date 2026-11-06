"""격리 추출 — 메인 추출과 보조 변환(MarkItDown)을 시간·메모리 한도를 건 spawn 자식 프로세스에서 하나씩 돌린다.

이상한 파일이 백엔드 프로세스를 멈추거나 메모리를 다 쓰지 못하게 한다. 자식 대상은 새 인터프리터가 import할 수 있는
모듈 최상위 함수여야 하고, 주고받는 값은 모두 피클된다. 누락 대조(find_missing_text)는 부모가 한다.
"""

import asyncio
import logging
import multiprocessing
import sys
import warnings
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from multiprocessing.connection import Connection
from multiprocessing.process import BaseProcess
from typing import Literal

from app.sop.extract.aux_compare import convert_with_markitdown
from app.sop.extract.docx_reader import read_docx
from app.sop.extract.pdf_reader import read_pdf
from app.sop.extract.types import ExtractionRejected, ExtractLimits, ExtractResult

# 결과를 받은 뒤·terminate 뒤 자식이 스스로 끝나기를 기다리는 시간(초) — 넘기면 kill한다
EXIT_GRACE_SECONDS = 5
_MIB = 1024 * 1024
_READERS = {"docx": read_docx, "pdf": read_pdf}


@dataclass(frozen=True)
class WorkerResult:
    """추출 한 번의 결과 — outcome이 문서 상태를 정하고(ok → ready), aux_*는 보조 대조용이다.

    code: rejected면 거절 코드, failed면 timeout|crashed|parse_error, ok면 "".
    aux_error: 보조 변환이 실패한 이유 — timeout|crashed|예외 클래스 이름. 보조 실패는 문서 상태를 바꾸지 않는다.
    error_class: 자식에서 난 예외의 클래스 이름 — 메시지는 원문 글자를 담을 수 있어 넘기지 않는다.
    """

    outcome: Literal["ok", "rejected", "failed"]
    code: str
    result: ExtractResult | None
    aux_markdown: str | None
    aux_error: str | None
    error_class: str | None = None


def run_extraction(data: bytes, file_format: str, limits: ExtractLimits) -> WorkerResult:
    """메인 추출(자식 쪽, 순수) — 받지 않는 파일은 예외 대신 rejected로 돌려준다."""
    try:
        result = _READERS[file_format](data, limits)
    except ExtractionRejected as error:
        return WorkerResult("rejected", error.code, None, None, None)
    return WorkerResult("ok", "", result, None, None)


def run_aux_conversion(data: bytes, file_format: str) -> WorkerResult:
    """보조 변환(자식 쪽) — MarkItDown 마크다운을 aux_markdown에 담는다. 실패는 자식 진입점이 클래스 이름으로 바꾼다."""
    return WorkerResult("ok", "", None, convert_with_markitdown(data, file_format), None)


async def extract_in_subprocess(
    data: bytes,
    file_format: str,
    limits: ExtractLimits,
    *,
    timeout_s: float,
    memory_mb: int,
    target: Callable[..., WorkerResult] = run_extraction,
    aux_target: Callable[..., WorkerResult] = run_aux_conversion,
) -> WorkerResult:
    """메인 추출 자식 → (성공했을 때만) 보조 변환 자식을 차례로 돌린다. 둘은 시간 한도를 따로 갖는다.

    보조를 따로 두는 이유: MarkItDown이 큰 문서에서 20~30초 걸려(docs/qa/2026-11-sop-parse-dependencies.md),
    한 자식에서 이어 돌리면 메인이 성공한 문서도 시간 초과로 failed가 될 수 있다. 보조 실패는 aux_error에만 남는다.
    """
    main = await asyncio.to_thread(_run_child, target, (data, file_format, limits), timeout_s, memory_mb)
    if main.outcome != "ok":
        return main
    aux = await asyncio.to_thread(_run_child, aux_target, (data, file_format), timeout_s, memory_mb)
    if aux.outcome == "ok":
        return replace(main, aux_markdown=aux.aux_markdown, aux_error=None)
    return replace(main, aux_markdown=None, aux_error=aux.error_class or aux.code)


def _run_child(
    target: Callable[..., WorkerResult], args: Sequence[object], timeout_s: float, memory_mb: int
) -> WorkerResult:
    """자식 하나를 띄워 결과를 기다린다(블로킹 — 부모는 스레드에서 부른다). 어떤 길로 끝나든 자식을 남기지 않는다."""
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_serve_child, args=(sender, target, tuple(args), memory_mb), daemon=True)
    try:
        process.start()
        # 부모 쪽 송신 끝을 닫아야 자식이 결과 없이 죽었을 때 받는 쪽이 기다리지 않고 EOFError로 끝난다
        sender.close()
        if not receiver.poll(timeout_s):
            return _build_failure("timeout")
        try:
            return receiver.recv()
        # 결과 없이 죽으면 EOFError, 결과를 보내다 죽으면(메모리 상한·OOM kill) 메시지가 잘려 OSError다
        except (EOFError, OSError):
            return _build_failure("crashed")
    finally:
        sender.close()
        receiver.close()
        _stop_child(process)


def _stop_child(process: BaseProcess) -> None:
    """살아 있으면 terminate → 잠시 기다려도 안 끝나면 kill. join까지 해서 좀비·고아를 남기지 않는다."""
    if process.pid is None:  # 시작하지 못했다
        return
    if process.is_alive():
        process.terminate()
    process.join(EXIT_GRACE_SECONDS)
    if process.is_alive():
        process.kill()
        process.join()
    process.close()


def _build_failure(code: str, error_class: str | None = None) -> WorkerResult:
    return WorkerResult("failed", code, None, None, None, error_class)


def _serve_child(
    sender: Connection, target: Callable[..., WorkerResult], args: tuple[object, ...], memory_mb: int
) -> None:
    """자식 프로세스 진입점 — 메모리 상한을 먼저 걸고 target을 돌려 결과를 보낸다.

    거절(ExtractionRejected)은 target이 rejected로 돌려주므로, 여기서 잡히는 예외는 모두 parse_error다.
    """
    # 자식의 stderr는 부모 출력(앱 로그)으로 이어진다 — 서드파티(pdfminer·MarkItDown 등)의 로그·경고에 원문 조각이 실릴 수
    # 있어 자식에서만 끈다(spawn 자식은 따로 뜬 인터프리터라 부모 로깅은 그대로다)
    logging.disable(logging.CRITICAL)
    warnings.simplefilter("ignore")
    _limit_memory(memory_mb)
    try:
        result = target(*args)
    except Exception as error:  # 예외 메시지는 원문 글자를 담을 수 있어 클래스 이름만 넘긴다
        result = _build_failure("parse_error", type(error).__name__)
    sender.send(result)
    sender.close()


def _limit_memory(memory_mb: int) -> None:
    """리눅스에서 가상 메모리 상한(RLIMIT_AS)을 건다 — 넘는 할당은 MemoryError가 되어 컨테이너 OOM으로 번지지 않는다.

    macOS는 RLIMIT_AS를 강제하지 않고 Windows에는 resource 모듈이 없어 리눅스에서만 건다(서버는 리눅스 컨테이너).
    """
    if not sys.platform.startswith("linux"):
        return
    import resource

    limit = memory_mb * _MIB
    _, hard = resource.getrlimit(resource.RLIMIT_AS)
    if hard != resource.RLIM_INFINITY:
        limit = min(limit, hard)  # 이미 더 낮은 상한이 있으면 올릴 수 없다(ValueError)
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
