"""Bundle 코드 — 이름 없이 바로 만든 Bundle을 가리키는 순차 코드. id에서 만들어 새 열·순번 표가 필요 없다."""


def format_bundle_code(bundle_id: int) -> str:
    """BND-0013 꼴. 지운 번호는 비어 남고, 10000번째부터는 자릿수가 늘어난다."""
    return f"BND-{bundle_id:04d}"
