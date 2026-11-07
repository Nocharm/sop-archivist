"""AI 지침·프롬프트 버전 — 시드, 활성 버전 조회, 버전 올리기·활성화, 규칙 ID 추출, Excel 정보 시트 표기.

버전은 키마다 번호를 세고 활성은 키마다 하나다(부분 유일 인덱스). 지난 버전은 지우지 않아 AI 제안 기록이 가리키는 번호가 늘 남는다.
"""

import asyncio
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now
from app.sop.constants import GUIDELINE_KEYS
from app.sop.models import GuidelineVersion

# 시드는 app/ 안에 둔다 — 도커 이미지가 app/만 복사한다. rules.md는 docs/domain/restructuring-rules.md의 바이트 복사본(테스트가 지킨다)
SEEDS_DIR = Path(__file__).resolve().parent / "seeds"
SEED_ACTOR = "system"
RULES_KEY = "rules"

# 규칙 문서 표의 첫 칸이 규칙 ID인 줄 — R01·RW01·S5.1·X01·Y1·N1·P1. 머리 줄(ID)·구분 줄·`N/A`·본문 속 언급은 첫 칸이 이 꼴이 아니라 걸리지 않는다
_RULE_ID_ROW_RE = re.compile(r"^[ \t]*\|[ \t]*(RW\d+|[RSXYNP]\d+(?:\.\d+)?)[ \t]*\|", re.MULTILINE)


@dataclass(frozen=True)
class GuidelineRef:
    """활성 지침 한 건 — AI 호출이 읽은 버전 번호를 제안 기록에 남기려고 내용과 함께 든다."""

    key: str
    version: int
    content: str


def extract_rule_ids(content: str) -> frozenset[str]:
    """규칙 문서에서 규칙 ID를 읽는다 — 표 줄의 첫 칸만 본다. 비면 규칙 문서가 아니라는 뜻이다."""
    return frozenset(_RULE_ID_ROW_RE.findall(content))


def format_guideline_versions(refs: Mapping[str, GuidelineRef]) -> dict[str, int]:
    """AI 제안에 남기는 {키: 버전 번호} — 내용은 싣지 않는다."""
    return {key: ref.version for key, ref in refs.items()}


async def seed_guidelines(session: AsyncSession) -> None:
    """버전이 하나도 없는 키만 시드 파일로 v1을 만들어 활성으로 둔다 — 이미 버전이 있는 키는 손대지 않는다(멱등)."""
    seeded_keys = set(await session.scalars(select(GuidelineVersion.key).distinct()))
    stamp = now()
    for key in GUIDELINE_KEYS:
        if key in seeded_keys:
            continue
        session.add(
            GuidelineVersion(
                key=key,
                version=1,
                content=await asyncio.to_thread((SEEDS_DIR / f"{key}.md").read_text, encoding="utf-8"),
                is_active=True,
                created_by=SEED_ACTOR,
                activated_by=SEED_ACTOR,
                activated_at=stamp,
            )
        )
    await session.commit()


async def load_active_guidelines(session: AsyncSession, keys: Sequence[str]) -> dict[str, GuidelineRef]:
    """요청한 키의 활성 버전을 키 순서대로 돌려준다. 활성이 없는 키가 있으면 LookupError — 시드가 있어 정상에선 일어나지 않는다."""
    rows = await session.scalars(
        select(GuidelineVersion).where(GuidelineVersion.key.in_(keys), GuidelineVersion.is_active.is_(True))
    )
    refs = {row.key: GuidelineRef(row.key, row.version, row.content) for row in rows}
    missing = [key for key in keys if key not in refs]
    if missing:
        raise LookupError(f"no active guideline version for: {', '.join(missing)}")
    return {key: refs[key] for key in keys}


async def get_rules_version_label(session: AsyncSession) -> str:
    """Excel 정보 시트에 적는 규칙 문서 버전 — 예: "rules v1"."""
    refs = await load_active_guidelines(session, (RULES_KEY,))
    return f"{RULES_KEY} v{refs[RULES_KEY].version}"


async def _lock_key_and_load_versions(session: AsyncSession, key: str) -> set[int]:
    """그 키의 버전 번호를 돌려준다 — 먼저 키 단위 잠금을 잡아 버전 만들기·활성화가 같은 키에서 동시에 돌지 않게 한다(Postgres. sqlite는 잠금이 없다).

    가장 오래된 행 하나가 키의 뮤텍스다. 모든 행을 한 문장으로 잠그며 읽으면 안 된다: 기다리던 쪽은 먼저 끝난 쪽이 새로 넣은 행을
    못 봐서 같은 번호를 잡는다(실측). 잠금을 얻은 뒤 번호를 따로 읽어야 앞선 쪽이 커밋한 행까지 보인다.
    """
    await session.execute(
        select(GuidelineVersion.id)
        .where(GuidelineVersion.key == key)
        .order_by(GuidelineVersion.version)
        .limit(1)
        .with_for_update()
    )
    return set(await session.scalars(select(GuidelineVersion.version).where(GuidelineVersion.key == key)))


async def create_guideline_version(
    session: AsyncSession, *, key: str, content: str, note: str, created_by: str
) -> GuidelineVersion:
    """키의 다음 버전을 비활성으로 올린다 — 활성화는 따로 한다. 번호를 세는 동안 그 키를 잠가 같은 번호를 둘이 잡지 않게 한다."""
    versions = await _lock_key_and_load_versions(session, key)
    row = GuidelineVersion(
        key=key, version=max(versions, default=0) + 1, content=content, note=note, is_active=False, created_by=created_by
    )
    session.add(row)
    await session.commit()
    return row


async def activate_guideline_version(
    session: AsyncSession, *, key: str, version: int, activated_by: str
) -> GuidelineVersion | None:
    """그 키의 활성을 version으로 옮긴다. 없는 버전이면 None. 이미 활성이면 아무것도 바꾸지 않는다(활성화 기록을 덮지 않는다).

    키를 잠근 뒤 이전 활성을 먼저 끄고 켠다 — 부분 유일 인덱스가 키당 활성 하나를 지키므로 순서가 바뀌면 거절된다.
    ORM 속성 대입은 flush 순서를 보장하지 않아 벌크 UPDATE 두 번으로 순서를 고정한다.
    """
    if version not in await _lock_key_and_load_versions(session, key):
        return None
    await session.execute(
        update(GuidelineVersion)
        .where(GuidelineVersion.key == key, GuidelineVersion.version != version, GuidelineVersion.is_active.is_(True))
        .values(is_active=False)
    )
    await session.execute(
        update(GuidelineVersion)
        .where(GuidelineVersion.key == key, GuidelineVersion.version == version, GuidelineVersion.is_active.is_(False))
        .values(is_active=True, activated_by=activated_by, activated_at=now())
    )
    await session.commit()
    return await session.scalar(
        select(GuidelineVersion).where(GuidelineVersion.key == key, GuidelineVersion.version == version)
    )
