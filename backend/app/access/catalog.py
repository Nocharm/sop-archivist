"""권한 카탈로그 — 권한 키는 코드가 정의한다. frontend lib/access.ts PERMISSIONS·i18n permission.<key>와 같은 순서·값."""

# 이번 범위는 관리용 4개뿐(SOP 권한은 제품 단계에서 추가). 키를 빼면 이미 저장된 역할·부여의 그 키는
# 판정에서 버려진다(행은 남는다). 키를 더하면 frontend 두 곳도 같은 커밋에서 갱신한다.
PERMISSIONS: tuple[str, ...] = ("permission.manage", "directory.sync", "ai.admin", "system.view")


def is_known_permission(key: str) -> bool:
    return key in PERMISSIONS
