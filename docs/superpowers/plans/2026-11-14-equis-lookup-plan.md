# EQUIS 조회 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 문서 번호를 EQUIS(EDW)에서 조회해 줄마다 표시를 붙이고, EQUIS에 있는 문서의 제목을 EQUIS 이름으로 맞춰 잠근다.

**Architecture:** 새 모듈 `backend/app/equis/`가 조회 창구(`client`), 판정과 옛 번호 따라가기(`rules`, 순수 함수), 보관과 제목 따라가기(`service`)를 맡는다. 번호별 사실은 표 `equis_lookups` 하나에 담고 판정은 읽을 때 계산한다. 화면은 꽂는 조각 네 개다.

**Tech Stack:** FastAPI · SQLAlchemy(async) · Alembic · httpx2 · pytest / Next.js · React · vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-equis-lookup-design.md`

## Global Constraints

- 조회 결과와 조회 실패는 어떤 저장도 막지 않는다.
- 설정 셋(`N8N_QUERY_URL` · `EQUIS_EDW_TABLE` · `EQUIS_DOC_URL_BASE`)이 모두 있어야 켜진다. 꺼지면 응답의 `equis`는 `null`이고 화면은 v1.0.0과 같다.
- 이름 칸(소유자·작성자·만든 사람·고친 사람)은 `client`의 반환값, DB, 로그, 예외 메시지 어디에도 없다.
- 실제 번호·이름·ID·주소를 시험·시드·문서에 쓰지 않는다. 합성 값과 `<equis-host>` · `<n8n-host>`만 쓴다.
- 새 env는 `app/settings.py` · `.env.example` · `docker-compose.yml` · `docs/deploy/setup-once.md` 네 곳을 함께 고친다.
- 새 거절 코드에는 `rule.<code>` en·ko 문구, 새 화면 문구는 en·ko 한 쌍, 조작 요소에는 `data-testid`.
- 화면이 바뀌므로 사용 설명서를 같은 커밋에서 고친다.
- 시험 실행: `backend/`에서 `.venv/bin/python -m pytest tests/<file> -q`, 전체는 `-n auto`. `ruff check app/ tests/`. `frontend/`에서 `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`.

## Review Focus

1. 번호 일부만 겹치는 다른 문서를 옛 번호로 잇지 않는다(`SOP-ABC-1016`과 `SOP-ABC-10160`) → Task 2.
2. Draft만 있는 새 문서는 이름이 없고 제목을 잠그지 않는다 → Task 1, Task 5.
3. 검토 중이거나 끝난 묶음의 제목은 조회가 끝나도 바뀌지 않는다 → Task 4.
4. 서버가 재시작돼 남은 `pending`이 화면을 영영 "Looking up"으로 두지 않는다 → Task 4.
5. 작은따옴표·세미콜론이 든 번호를 웹훅에 보내지 않는다 → Task 3.

---

### Task 1: 판정 규칙

**Files:** Create `backend/app/equis/__init__.py`, `backend/app/equis/rules.py` · Test `backend/tests/test_equis_rules.py`

**Interfaces — Produces:**
- `parse_version(text: str) -> tuple[int, int] | None`
- `read_kst_date(value: object) -> str` — 앞 10글자(`YYYY-MM-DD`), 아니면 `""`
- `split_legacy(value: object) -> tuple[str, ...]` — ` / `로 나눠 다듬고 대문자
- `normalize_number(text: str) -> str` — 공백 떼고 대문자
- `parse_row(raw: Mapping[str, object]) -> EquisRow | None` — 필수 칸(번호·문서 ID·판·상태·생애주기)이 없으면 `None`. 받는 칸은 명세 §6.1뿐
- `build_facts(rows: Sequence[EquisRow]) -> DocFacts` — 한 문서의 줄들
- `judge(facts: DocFacts, side: Literal["old", "new"], doc_version: str) -> Verdict`
- `EquisRow`(frozen dataclass): `number, doc_id, version, version_text, status, lifecycle, name, subtype, owning_department, plant, area, legacy_numbers, equipment_tag, effective_date, approved_date, superseded_date, obsolete_date, withdrawn_date`
- `VersionFact`: `version_text, status, effective_date, retired_date`
- `DocFacts`: `doc_id, number, name, subtype, owning_department, plant, area, legacy_numbers, equipment_tag, current: VersionFact | None, in_progress: tuple[VersionFact, ...], retired: VersionFact | None, name_version: VersionFact | None`. `to_dict()` · `from_dict()`
- `Verdict`: `verdict: Literal["ok", "attention", "in_equis"], reasons: tuple[str, ...], notes: tuple[VersionFact, ...]`. 이유 코드 `retired` · `version_mismatch` · `newer_authorized` · `no_current`

- [x] 시험을 쓴다(명세 §10 "규칙" 목록 전부, 합성 줄).
- [x] 실패를 본다.
- [x] 구현한다.
- [x] 통과를 본다.

### Task 2: 옛 번호 따라가기

**Files:** Modify `backend/app/equis/rules.py` · Test `backend/tests/test_equis_follow.py`

**Interfaces — Produces:**
- `Fetch = Callable[[str], Awaitable[Sequence[EquisRow]]]`
- `async resolve_number(number: str, fetch: Fetch) -> Resolution`
- `Resolution`: `state: Literal["found", "not_found"], asked: str, trail: tuple[str, ...], facts: DocFacts | None, ambiguous: tuple[str, ...]`
- `MAX_LEGACY_HOPS = 5`

규칙: 맞은 문서가 있고 폐기되지 않았으면 거기서 멈춘다. 맞은 문서가 없거나 폐기됐으면 이어받은 문서(Legacy 조각이 정확히 같은 문서)로 넘어간다. 이어받은 문서가 둘 이상이면 고르지 않고 `ambiguous`에 담는다.

- [x] 시험: 한 번, 세 번, 한 칸에 여러 옛 번호, 고리, 후보 둘, 일부만 겹침, 다섯 번 상한, 없음.
- [x] 구현하고 통과를 본다.

### Task 3: 설정과 조회 창구

**Files:** Modify `backend/app/settings.py`, `.env.example`, `docker-compose.yml`, `docs/deploy/setup-once.md` · Create `backend/app/equis/client.py` · Test `backend/tests/test_equis_client.py`

**Interfaces — Produces:**
- `settings.n8n_query_url`, `settings.equis_edw_table`, `settings.equis_doc_url_base`, `settings.equis_enabled`
- `is_sendable_number(number: str) -> bool` — `^[A-Z0-9][A-Z0-9 ./_-]{1,99}$`
- `async fetch_rows(number: str) -> list[EquisRow]` — 번호 `eq` 요청과 Legacy `contains` 요청을 합친 줄. 보낼 수 없는 번호는 `[]`
- `class EquisUnavailable(RuntimeError)` — 시간 초과·5xx·형식 오류. 메시지에 주소를 넣지 않는다
- `EQUIS_TIMEOUT_SECONDS = 10.0`, `EQUIS_ROW_LIMIT = 500`, 다시 시도 1회
- 안쪽 `_post(payload: dict) -> object`는 시험이 바꿔치기한다

- [x] 시험: 응답 모양 셋, 빈 객체 줄, `message` 봉투, 시간 초과, 500줄 상한, 보낼 수 없는 번호, 이름 칸이 반환값에 없음.
- [x] 구현하고 통과를 본다.

### Task 4: 표와 서비스

**Files:** Modify `backend/app/sop/models.py`(또는 `app/models.py` 규칙을 따른다) · Create `backend/alembic/versions/0016_equis_lookups.py`, `backend/app/equis/service.py` · Test `backend/tests/test_equis_service.py`

**Interfaces — Consumes:** Task 1–3. **Produces:**
- 모델 `EquisLookup(doc_number PK, state, facts JSON, requested_at, fetched_at)`
- `needs_lookup(code: str) -> bool` — 빈 번호와 `NEW-<숫자>`는 `False`
- `async request_lookup(session, numbers: Iterable[str]) -> list[str]` — `pending`으로 만든 번호. 커밋은 호출부
- `async run_lookup(number: str) -> None` — 새 세션에서 조회·저장·제목 따라가기
- `async load_lookups(session, numbers: Iterable[str]) -> dict[str, EquisLookup]`
- `read_state(lookup, now) -> str` — 60초 넘은 `pending`은 `unavailable`
- `is_stale(lookup, now) -> bool` — `fetched_at`이 24시간을 넘음
- `is_title_locked(lookup, now) -> bool`
- `async apply_titles(session, number: str, name: str) -> int` — 작업 중인 묶음의 `Document.title` · `TargetDoc.title`만, 행위자 `system:equis`

- [x] 시험: 같은 번호 두 번 요청은 한 번만 `pending`, 실패하면 `facts` 유지, 검토 중 묶음 제목 불변, 60초 `pending`, 24시간 stale.
- [x] `alembic upgrade head` · `downgrade -1`.

### Task 5: API 잇기

**Files:** Modify `backend/app/routers/sop_documents.py`, `backend/app/routers/sop_tobe.py`, `backend/app/sop/tobe.py`(응답 모델), `backend/app/main.py` · Create `backend/app/routers/sop_equis.py`, `backend/app/equis/view.py` · Test `backend/tests/test_equis_api.py`

**Interfaces — Produces:**
- `EquisOut`(Pydantic): `state, verdict, reasons, current, in_progress, retired, name, doc_url, title_locked, current_number, trail, ambiguous, info, fetched_at`
- `build_equis_out(lookup, side, doc_version, now) -> EquisOut | None`
- `DocumentOut.equis`, To-Be 줄 `equis`
- `POST /api/bundles/{bundle_id}/equis/refresh` 본문 `{document_number}`
- 거절 코드 `title_locked`(409)

- [x] 시험: 명세 §10 "API" 목록 전부.
- [x] 구현하고 통과를 본다. 전체 `pytest -n auto`와 `ruff`.

### Task 6: 화면 조각

**Files:** Modify `frontend/src/lib/api-sop.ts`, `frontend/src/lib/i18n-messages.ts`, `frontend/src/app/bundles/[id]/documents/page.tsx`, `frontend/src/app/bundles/[id]/tobe/page.tsx`, `frontend/public/manual/user-manual.md` · Create `frontend/src/lib/equis-model.ts`(+ `.test.ts`), `frontend/src/components/equis/equis-status.tsx`, `equis-popover.tsx`, `equis-link.tsx`, `frontend/scripts/fake-equis-webhook.mjs`

**Interfaces — Consumes:** `EquisOut`. **Produces:** `formatEquisLabel(equis, t) -> { tone, icon, text }`(순수), `<EquisStatus>`, `<EquisPopover>`, `<EquisLink>`.

- [ ] `equis-model.test.ts`: 명세 §4.1의 표시 열 가지.
- [ ] 조각과 두 화면에 꽂기. 사용성 기준은 명세 §9.
- [ ] 가짜 웹훅으로 브라우저에서 확인. `lint` · `tsc` · `vitest` · `build`.

### Task 7: 문서와 릴리스

**Files:** Modify `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md` §6.2, `docs/README.md`, `CHANGELOG.md`, `PROGRESS.md`, `frontend/package.json`

- [ ] 명세 §11의 문서를 고친다. 버전 PATCH.
