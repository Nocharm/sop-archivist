"""권한 카탈로그 — 권한 키는 코드가 정의한다. frontend lib/access.ts PERMISSIONS·i18n permission.<key>와 같은 순서·값."""

# 관리용 4개 + SOP 제품용 3개(묶음 만들기·전체 묶음 관리·AI 지침 관리). 묶음 안의 작성자·검토자 역할은
# 권한 표가 아니라 묶음 멤버십이 정한다. 키를 빼면 이미 저장된 역할·부여의 그 키는
# 판정에서 버려진다(행은 남는다). 키를 더하면 frontend 두 곳도 같은 커밋에서 갱신한다.
PERMISSIONS: tuple[str, ...] = (
    "permission.manage", "directory.sync", "ai.admin", "system.view",
    "bundle.create", "bundle.admin", "guideline.manage",
)


def is_known_permission(key: str) -> bool:
    return key in PERMISSIONS
