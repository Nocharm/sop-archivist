# 화면 개편(T/F 첫 실사용 전 피드백) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 단계별로 써 보며 낸 31개 피드백 + 추가 지시(피커 버그·순위·무한 스크롤, 드롭다운 단추, 기본 컨트롤 금지, 토스트, 라벨 원칙)를 반영해 v0.9.0으로 배포한다.

**Architecture:** 공통 부품(토큰으로 그린 Checkbox·MorphButton·EmptyState·InfoTip·Select 트리거·토스트)을 먼저 만들고 화면이 그것을 쓰게 한다. 서버 변경은 작고 독립적이다(로그인 기록, Bundle 코드·빈 이름, 사건 전/후, 디렉터리 전체, 문서 정보 탐지·AI 제안, Unit 편집 출처). 화면 규칙은 지금처럼 순수 모델(`lib/*-model.ts`, `lib/*.ts`)에 두고 vitest로 시험한다.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind 4 · lucide-react · vitest / FastAPI · SQLAlchemy async · Alembic · pytest · Playwright(시스템 Chrome) 스모크.

**Spec:** `docs/superpowers/specs/2026-11-09-ui-feedback-revamp-design.md` (목업: `docs/design/2026-11-09-ui-revamp-mocks/mock-{1-shell,2-overview,3-documents,4-split}.html` — 브라우저로 열어 호버·클릭으로 동작을 본다).

## Global Constraints

- 브랜치 `feat/ui-feedback-revamp`. 끝나면 `frontend/package.json` version `0.9.0`(MINOR) + `CHANGELOG.md` + 태그 `v0.9.0`(`rules/common/git.md`). 커밋 메시지 `type(scope): English — 한국어`, 커밋마다 `PROGRESS.md` 1~3줄.
- CLAUDE.md 체크리스트 전부 적용: 모델 변경 = Alembic 리비전(`--rev-id 0008`부터 순서대로), CHECK 제약을 바꾸면 마이그레이션된 DB에 부딪치는 시험, 새 화면 문구는 en·ko 한 쌍, 새 `raise_rule` 코드는 `rule.<code>` 문구, 인터랙티브 요소에 `data-testid`(`surface-role`), 사람 이동은 `navigate()`/링크(새 `router.push` 금지), 기본 `<select>` 금지.
- raw 색·반지름·그림자 값은 `frontend/src/styles/tokens.css` 밖에 쓰지 않는다. 다크는 토큰만 바꾸고 화면 코드가 테마로 분기하지 않는다. 상태 표기는 화면 언어와 상관없이 영어.
- 브라우저 기본 모양 금지: 화면에 `<input type="checkbox|radio">`의 기본 모양, DOM `title=` 툴팁, 숫자 입력 화살표를 보이지 않는다(숨긴 네이티브 입력 위에 그리는 것은 허용 — 접근성 유지).
- 움직임은 `--dur-*`·`--ease-*` 토큰, `prefers-reduced-motion`에서 끈다.
- 라벨: 짧은 명사형, 설명은 (i) 툴팁. "올리기"→"업로드", "판"→"버전". 도메인 용어 Bundle · Old · New · Unit은 화면 언어와 상관없이 영어(산출물 `output_labels.py`는 그대로). 맥(Cmd) 안내 문구 삭제.
- AI 페이로드에 직원 실명 금지. AI는 제안만 한다(`confirmed_text`·문서 필드를 AI가 직접 쓰지 않는다). AI 호출 동안 DB 세션을 잡지 않는다(`load/compute/apply`).
- 로컬 명령은 CLAUDE.md Commands대로(backend `.venv/bin/...`, frontend `npm`/`npx`).

## Review Focus

1. **실제 HR 데이터 모양**(긴 부서 경로, 한글 이름만 있는 사람, 5천 명 규모): 피커가 잘리거나 느려지지 않아야 한다 → Task 21의 순위 시험에 긴 경로·한글만·대량(5000) 케이스, Task 24 스모크에 긴 경로 모달 케이스.
2. **제목이 빈 Bundle**: 목록·상단 바·History·관리 표·검토 화면 어디서도 빈 칸이 아니라 `BND-0013`이 보여야 한다 → Task 7의 `getBundleLabel` 시험 + Task 8에서 모든 표시 지점 교체.
3. **여러 줄·표 칸·글꼴 크기 변경 중의 선택 윤곽**: 줄이 바뀌거나 원문 글꼴 설정을 바꾸면 윤곽을 다시 그려야 한다 → Task 17 `buildContourPath` 시험(한 줄·여러 줄·첫 줄이 더 넓은 경우·빈 rect), Task 18에서 ResizeObserver로 다시 그림.
4. **키보드 흐름 충돌**: ↑/↓가 Select·Menu·모달·입력 칸 안에서는 Split 이동을 하면 안 된다 → Task 19 시험(입력 칸·열린 메뉴에서 ArrowDown 무시).
5. **검토 중(잠긴) Bundle**: 바로 생성·이름 연필·틈 합치기·인라인 확인·버전 단추가 잠긴 Bundle에서 보이지 않거나 꺼져야 한다 → Task 9·15·18·19에서 `canEdit=false` 렌더 시험.

---

## Phase A — 공통 부품

### Task 1: 피커 넘침 버그 수정 커밋

**Files:**
- Modify: `frontend/src/components/subject-picker.tsx` (이미 작업 트리에 있음: 바깥 칸 `min-w-0`)
- Modify: `PROGRESS.md`

- [ ] **Step 1:** `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint` — 오류 0.
- [ ] **Step 2: Commit**
```bash
git add frontend/src/components/subject-picker.tsx PROGRESS.md
git commit -m "fix(frontend): keep the picker's Add button inside the panel with long department paths — 긴 부서 경로가 피커의 추가 단추를 밀어내지 않게"
```

### Task 2: 토큰 부품 — Checkbox · MorphButton · EmptyState · InfoTip

**Files:**
- Create: `frontend/src/components/ui/checkbox.tsx`, `frontend/src/components/ui/morph-button.tsx`, `frontend/src/components/ui/empty-state.tsx`, `frontend/src/components/ui/info-tip.tsx`
- Modify: `frontend/src/styles/motion.css`(모핑 규칙), `frontend/src/app/globals.css` 또는 기존 부품 CSS 파일(체크박스·빈 화면 클래스)
- Test: `frontend/src/components/ui/morph-button.test.ts`

**Interfaces:**
- Produces:
  - `Checkbox({ checked, onChange(next: boolean), label?: ReactNode, disabled?, indeterminate?, testId, ariaLabel? })` — 숨긴 `<input type="checkbox">` 위에 그린 네모(체크 시 `--accent` 채움, `--r-1`).
  - `MorphButton({ icon: LucideIcon, label: string, tone?: "default" | "danger" | "primary", onClick, testId, disabled?, revealLabel?: boolean })` — 평소 아이콘만, `:hover`/`:focus-visible`에서 라벨이 `max-width` 전환으로 펼쳐짐. `tone="danger"`면 펼칠 때 `--danger-fill` 바탕·흰 글자. `revealLabel`이면 늘 펼침(확인 모달 안 최종 단추). `aria-label={label}`는 늘 붙인다.
  - `EmptyState({ icon: LucideIcon, title: string, body?: string, action?: ReactNode, testId })` — 가운데 박스(목업 mock-1 §5·15).
  - `InfoTip({ text: string, testId })` — (i) 14px 아이콘, 기존 `Tooltip`으로 설명, `tabIndex=0`.
  - `getMorphClassName(tone, revealLabel): string` (순수 — 시험용).

- [ ] **Step 1: Write the failing test** — `morph-button.test.ts`: `getMorphClassName("danger", false)`가 `"morph danger"`, `getMorphClassName("default", true)`가 `"morph reveal"`를 돌려준다.
- [ ] **Step 2:** `cd frontend && npx vitest run src/components/ui/morph-button.test.ts` → FAIL.
- [ ] **Step 3:** 부품 넷과 CSS를 만든다. 색·간격은 토큰만. 목업 mock-1의 `.morph`, `.empty`, mock-4의 `.info` 값을 출발점으로.
- [ ] **Step 4:** 같은 명령 → PASS. `npx tsc --noEmit -p tsconfig.json` 오류 0.
- [ ] **Step 5: Commit** — `feat(frontend): token-drawn checkbox, morph button, empty state and info tip — 토큰으로 그린 공통 부품`

### Task 3: Select 트리거·메뉴 행 호버

**Files:**
- Modify: `frontend/src/components/ui/select.tsx`, 해당 CSS(`.select-trigger`, `.menu-item`)
- Test: `frontend/src/components/ui/select.test.ts`(기존)

- [ ] **Step 1:** 트리거 마크업: `.select-value`가 가운데(`justify-content:center`), 쉐브론은 `position:absolute` 오른쪽, 평소 `opacity:0`. `:hover`/`:focus-visible`/`[aria-expanded=true]`에서 값이 `translateX(-9px)`, 쉐브론 `opacity:1`(목업 mock-3 `.sel`).
- [ ] **Step 2:** `.menu-item:hover`/포커스: `color-mix(--accent 12~22%)` 바탕 + `box-shadow: inset 2px 0 0 var(--accent)` + `border-radius: 0 var(--r-2) var(--r-2) 0`(막대 쪽은 각지게). 다크 대비는 토큰으로 맞춘다.
- [ ] **Step 3:** `npx vitest run src/components/ui/select.test.ts` PASS(기존 testid 규칙 불변).
- [ ] **Step 4: Commit** — `feat(frontend): centered select label with hover chevron, straight hover bar on menu rows — 드롭다운 단추·행 호버`

### Task 4: 토스트 오른쪽 위

**Files:**
- Modify: `frontend/src/components/ui/toast.tsx`, `frontend/src/styles/motion.css`
- Test: `frontend/src/components/ui/toast.test.ts`

**Interfaces:**
- Produces: `showToast(text, tone?)`·`dismissToast(id)` 시그니처 불변. 내부 상태에 `leaving: boolean` 추가.
- 순수 함수 `pushToast(list: Toast[], next: Toast, max = 4): Toast[]` — 새 것을 **앞에**(위에) 넣고 같은 문구는 지우고 `max`개로 자른다.

- [ ] **Step 1: Write the failing test** — `pushToast([a,b], c)`가 `[c,a,b]`; 같은 text면 앞의 것을 지움; 5개째에서 가장 오래된 것이 빠짐.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** 자리 `fixed; top: calc(44px + 8px); right: max(16px, …)`. 들어올 때 `translateY(-8px)→0` + `opacity`, 유지 뒤 `leaving=true` → `translateX(110%)` + `opacity:0`, 전환이 끝나면 제거. 남은 토스트는 높이 접기(`grid-template-rows 1fr→0fr`)로 매끄럽게 메운다. 오류는 왼쪽 `--danger-fill` 막대. bpm `components/toast-stack.tsx`(HOLD 2500ms, SLIDE 350ms) 참고 — 이 앱은 오류 7000ms 유지 그대로.
- [ ] **Step 4:** vitest PASS.
- [ ] **Step 5: Commit** — `feat(frontend): toasts drop in at the top right and slide out right in order — 토스트 오른쪽 위`

### Task 5: 기본 컨트롤 걷어내기

**Files:**
- Modify: `frontend/src/app/bundles/[id]/classify/page.tsx`, `.../match/page.tsx`, `.../tobe/page.tsx`, `.../outputs/page.tsx`, `frontend/src/components/admin/access-roles.tsx`, `frontend/src/components/documents/upload-modal.tsx`(라디오는 Task 14에서 카드로 바뀌므로 여기서는 건너뜀), `frontend/src/components/new-bundle-modal.tsx`(Task 9에서 지움 — 건너뜀), DOM `title=`이 남은 곳(`git grep -n ' title=' frontend/src` 중 Modal·컴포넌트 prop이 아닌 HTML 속성)
- [ ] **Step 1:** `type="checkbox"` → `Checkbox`(Task 2). DOM `title=` → `Tooltip`. 숫자 입력이 있으면 화살표 숨김 CSS.
- [ ] **Step 2:** `git grep -nE 'type="(checkbox|radio)"' frontend/src` 결과가 `components/ui/checkbox.tsx`와 Task 14·9 대상만 남는다.
- [ ] **Step 3:** `npx vitest run` 전체 PASS, `npm run lint`, tsc 0.
- [ ] **Step 4: Commit** — `refactor(frontend): replace native checkboxes and title tooltips with token parts — 기본 컨트롤 제거`

## Phase B — 상단 바·로그인

### Task 6: 마지막 로그인 기록(서버)

**Files:**
- Create: `backend/alembic/versions/0008_user_logins.py`
- Modify: `backend/app/models.py`(새 표 `UserLogin`), `backend/app/routers/me.py`
- Test: `backend/tests/test_me.py`

**Interfaces:**
- Produces: 표 `user_logins(login_id PK String(100), last_login_at DateTime(tz), previous_login_at DateTime(tz) NULL)` — employees와 FK 없음(HR 동기화가 건드리지 않게).
- `POST /api/me/login` → 204. 행이 없으면 `last=now`; 있으면 `previous=last, last=now`.
- `MeOut.previous_login_at: KstDatetime | None` (= `previous_login_at`).

- [ ] **Step 1: Write the failing tests** — `test_login_record_shifts_previous`: 첫 POST 뒤 `/api/me`의 `previous_login_at is None`; 두 번째 POST 뒤 `previous_login_at`이 첫 POST 시각. `test_login_record_requires_auth`: 헤더 없으면 401(keycloak 모드 기준 conftest 관례대로).
- [ ] **Step 2:** `cd backend && .venv/bin/python -m pytest tests/test_me.py -q` → FAIL.
- [ ] **Step 3:** 모델·리비전(`alembic revision --autogenerate --rev-id 0008 -m "user logins"` 뒤 검토)·라우트.
- [ ] **Step 4:** `pytest tests/test_me.py tests/test_migrations.py -q` PASS.
- [ ] **Step 5: Commit** — `feat(backend): record logins so the menu can show the previous one — 마지막 로그인 기록`

### Task 7: 상단 바 사용자 메뉴·언어 토글·로그인 박스·최소 여백

**Files:**
- Create: `frontend/src/components/user-menu.tsx`, `frontend/src/lib/flyout.ts`
- Modify: `frontend/src/components/top-bar.tsx`, `frontend/src/components/lang-toggle.tsx`, `frontend/src/components/layout-menu.tsx`(항목·아이콘을 사용자 메뉴의 하위 메뉴로 옮김 — 파일은 하위 메뉴 내용으로 남기거나 흡수), `frontend/src/app/login/page.tsx`, `frontend/src/lib/session.ts`(로그인 직후 `POST /api/me/login` 한 번 — Keycloak 콜백 완료와 dev 사용자 전환 때), `frontend/src/lib/api.ts`(`MeOut` 타입에 `previous_login_at`), 레이아웃 CSS(`.page-wrap` 최소 좌우 여백 12~16px)
- Test: `frontend/src/lib/flyout.test.ts`

**Interfaces:**
- Produces: `pickFlyoutSide(anchor: DOMRect, flyoutWidth: number, viewportWidth: number, gap = 6): "right" | "left"`.
- `LangToggle({ tone: "chrome" | "surface", testId })` — 두 칸 `EN | KO`, `aria-pressed`.
- testid: `top-bar-user`(메뉴 열기), `user-menu`, `user-menu-account`, `user-menu-admin`, `user-menu-layout`, `user-menu-layout-flyout`, `user-menu-signout`, `user-menu-last-login`, `lang-toggle-en`, `lang-toggle-ko`. 기존 `top-bar-signout`·`top-bar-lang`·`top-bar-admin-link`를 쓰는 스모크는 Task 24에서 고친다.

- [ ] **Step 1: Write the failing test** — 오른쪽 여유가 `flyoutWidth+gap` 이상이면 `"right"`, 아니면 `"left"`; 양쪽 다 모자라면 넓은 쪽.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** 메뉴(목업 mock-1): 사람 아이콘 + 이름 + 소속(이니셜 원 없음) 단추 → `Menu`. 항목 순서 내 계정 · 관리(`canSeeAdmin`) · 레이아웃 ▸(호버·→ 키로 열림, `pickFlyoutSide`) · 구분선 · 로그아웃(위험색) · 마지막 로그인(`formatDateTime`, `previous_login_at`이 없으면 줄 생략). 언어 토글은 이름 단추 오른쪽. 로그인 화면은 박스 오른쪽 위 `LangToggle tone="surface"`. 개발 모드 사용자 전환은 바에 그대로.
- [ ] **Step 4:** vitest PASS, tsc·lint 0. 수동: 1120px 창에서 하위 메뉴가 왼쪽으로 열림.
- [ ] **Step 5: Commit** — `feat(frontend): fold top bar actions into a user menu with a layout flyout and EN/KO switch — 상단 바 사용자 메뉴`

## Phase C — Bundle

### Task 8: Bundle 코드·빈 이름·시험용 표시 수정(서버)

**Files:**
- Modify: `backend/app/routers/sop_bundles.py`, `backend/app/routers/sop_admin.py`(관리 묶음 목록이 제목을 내면 `code` 추가), `backend/scripts/sop_demo_driver.py`(제목 계속 보냄 — 확인만)
- Test: `backend/tests/test_sop_bundles.py`

**Interfaces:**
- Produces: `format_bundle_code(bundle_id: int) -> str` → `f"BND-{bundle_id:04d}"` (`app/sop/bundle_code.py` 새 파일 또는 `sop_bundles.py` 안 — 관리 라우터도 쓰니 새 파일).
- `BundleBase.code: str`, `BundleListItem.code: str`, 관리 묶음 항목도 `code`.
- `BundleCreateIn.title`: 선택, 기본 `""`(공백만이면 `""`). `BundleUpdateIn`: `title`은 빈 문자열 허용(이름 지우기), `is_synthetic: bool | None` 추가, 셋 다 None이면 422.

- [ ] **Step 1: Write the failing tests** — `test_create_without_title_gets_code`: `POST /api/bundles {}` → 201, `title == ""`, `code == f"BND-{id:04d}"`. `test_code_format`: `format_bundle_code(7) == "BND-0007"`, `format_bundle_code(12345) == "BND-12345"`. `test_update_synthetic_flag`: PATCH `{revision, is_synthetic: true}` → 200, 사건 `bundle.update` 기록. 목록 항목에 `code`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `pytest tests/test_sop_bundles.py tests/test_sop_e2e.py -q` PASS.
- [ ] **Step 5: Commit** — `feat(backend): bundles get a BND code and may start without a title — Bundle 코드와 빈 이름`

### Task 9: 사건 전/후 값과 이전 사건 넘겨 보기(서버)

**Files:**
- Create: `backend/alembic/versions/0009_event_detail.py`
- Modify: `backend/app/sop/models.py`(`BundleEvent.detail: Mapped[dict] = JSON, default=dict`), `backend/app/sop/events.py`(`record_event(..., detail: Mapping[str, object] | None = None)`), `backend/app/routers/sop_bundles.py`(update·members가 detail 기록, 이벤트 목록 `before_id` 커서, `BundleEventOut.detail`)
- Test: `backend/tests/test_sop_bundles.py`

**Interfaces:**
- detail 모양: 이름·설명 변경 `{"title": {"from": str, "to": str}}` / `{"description": {"from","to"}}`(설명은 200자에서 자름), 시험용 `{"is_synthetic": {"from","to"}}`, 멤버 `{"added": [{"login_id","role"}], "removed": [login_id], "role_changed": [{"login_id","from","to"}]}`. SOP 원문 글자는 넣지 않는다.
- `GET /api/bundles/{id}/events?limit=&before_id=` — `before_id`가 있으면 그보다 작은 id만(같은 정렬).

- [ ] **Step 1: Write the failing tests** — 이름 변경 뒤 첫 사건 `detail == {"title": {"from": "", "to": "Centrifuge"}}`; 멤버 추가 사건 `detail["added"] == [{"login_id": "qa.lead", "role": "reviewer"}]`; `before_id`로 두 번째 쪽을 받으면 겹침·빠짐 없음(사건 7개, limit 3).
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** 구현(리비전 `--rev-id 0009`).
- [ ] **Step 4:** `pytest tests/test_sop_bundles.py tests/test_migrations.py -q` PASS.
- [ ] **Step 5: Commit** — `feat(backend): keep before/after values on bundle events and page older ones — 사건 전/후 값`

### Task 10: 바로 생성·제목 줄·목록

**Files:**
- Modify: `frontend/src/app/page.tsx`(New bundle 단추 → `createBundle({})` 후 `navigate(개요)`, 빈 목록 `EmptyState`, 보기 전환 단추 포인터·호버), `frontend/src/components/ui/data-list.tsx`의 `ListViewToggle`(cursor·hover), `frontend/src/components/manage/bundle-manage.tsx`(`BundleHeading`: 코드 크게 + 이름 연필 편집, `…` 메뉴에 시험용 표시 토글), `frontend/src/components/top-bar.tsx`(묶음 제목 자리), `frontend/src/lib/api-sop.ts`(`code`, 수정 입력 `is_synthetic`), `frontend/src/components/admin/bundles-panel.tsx`
- Delete: `frontend/src/components/new-bundle-modal.tsx`
- Create: `frontend/src/lib/bundle-label.ts`
- Test: `frontend/src/lib/bundle-label.test.ts`

**Interfaces:**
- Produces: `getBundleLabel(bundle: { code: string; title: string }): string` — 이름이 있으면 `"BND-0013 · 이름"`이 아니라 **이름**, 없으면 코드(상단 바·목록 첫 칸은 코드와 이름을 따로 그리고, 한 줄만 쓸 곳이 이것을 쓴다).

- [ ] **Step 1: Write the failing test** — `getBundleLabel({code:"BND-0013", title:""}) === "BND-0013"`, 공백만 제목도 코드, 이름 있으면 이름.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** 구현. 제목이 쓰이는 곳(`git grep -n "\.title" frontend/src | grep -i bundle`)을 모두 `getBundleLabel` 또는 코드+이름 표시로. 검토 중(편집 불가) Bundle에서는 연필·시험용 토글을 숨긴다.
- [ ] **Step 4:** vitest·tsc·lint 0. 수동: New bundle 한 번 누르면 `BND-…` 개요로 이동.
- [ ] **Step 5: Commit** — `feat(frontend): create a bundle in one click and name it later — Bundle 바로 생성`

### Task 11: 개요 화면

**Files:**
- Modify: `frontend/src/app/bundles/[id]/page.tsx`, `frontend/src/components/manage/bundle-manage.tsx`(`ActivitySection`, `MembersSection`), `frontend/src/components/stage-nav.tsx`, `frontend/src/lib/stages.ts`, `backend/app/routers/sop_bundles.py`(`document_count`), `backend/tests/test_sop_bundles.py`
- Create: `frontend/src/lib/review-gates.ts`, `frontend/src/lib/event-kinds.ts`, `frontend/src/components/manage/event-modal.tsx`
- Test: `frontend/src/lib/review-gates.test.ts`, `frontend/src/lib/stages.test.ts`(기존), `frontend/src/lib/event-kinds.test.ts`

**Interfaces:**
- Produces:
  - `splitGates<T extends { passed: boolean }>(gates: T[], visible = 3): { fail: T[]; pass: T[]; failHidden: number; passHidden: number }`.
  - `isStageLocked(key: StageKey, documentCount: number): boolean` — 문서 0이면 `split|classify|match|outputs|review`가 true, `overview|documents|tobe|history`는 false. 문서 수는 서버 `BundleOut.document_count: int`(새 필드, `backend/app/routers/sop_bundles.py` `build_bundle_out`에서 `count(Document.id)` 한 번 — 시험 `test_bundle_out_counts_documents`: 새 Bundle 0, 업로드 뒤 1)로 받는다. 문서 업로드·삭제 뒤 묶음 캐시(`bundle-store`)를 다시 불러 레일이 바로 풀리고 잠긴다.
  - `getEventIcon(action: string): LucideIcon`, `getEventGroup(action: string): "bundle" | "document" | "decision" | "ai" | "review"`.
  - `STAGES`에 `{ key: "history", path: "/history", ready: true }`를 **맨 끝**에(레일 맨 아래 정렬은 CSS `margin-top:auto`).
- 개요 아이콘: `Gauge`. 다음 할 일 아이콘 표(lucide): upload_documents `FileUp`, resolve_documents `FileWarning`, fill_tobe `ListTree`, decide_units `Split`, ack_warnings `TriangleAlert`, fill_reasons `MessageSquareText`, semantic_checks `ShieldCheck`, add_reviewer `UserPlus`, request_review `Send`, await_review `Hourglass`, done `BadgeCheck`(구현자가 더 맞는 것으로 바꿔도 된다). 애니메이션은 마운트 때 1회(CSS `animation-iteration-count:1`, reduced-motion 끔).
- `add_reviewer`의 시작 단추는 멤버 관리 모달을 연다.

- [ ] **Step 1: Write the failing tests** — `splitGates`: fail 5·pass 2, visible 3 → fail 3개·failHidden 2·pass 2개; `isStageLocked("tobe", 0) === false`, `isStageLocked("split", 0) === true`, `isStageLocked("split", 1) === false`; `getEventGroup("ai.request") === "ai"`, 모르는 action은 `"bundle"`.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** 구현(목업 mock-2): 설명 칸 `min-height:64px; max-height:200px; resize:vertical`; 오른쪽 열 섹션별 박스; Review request 카드(Fail 위·Pass 아래·"N개 더 보기"); Activity 최근 10 + 아이콘 + 줄 클릭 → `EventModal`(누가·언제·종류·detail 전/후) + "모두 보기" → History; 시작 단추 `MorphButton`류(재생 아이콘 숨었다가 호버 때 등장, 오른쪽 화살표 제거); 잠긴 단계는 `aria-disabled` + 툴팁.
- [ ] **Step 4:** vitest·tsc·lint 0.
- [ ] **Step 5: Commit** — `feat(frontend): overview with boxed side column, pass/fail review cards, activity icons and locked stages — 개요 개편`

### Task 12: History 화면

**Files:**
- Create: `frontend/src/app/bundles/[id]/history/page.tsx`
- Modify: `frontend/src/lib/api-sop.ts`(`listBundleEvents(bundleId, { limit, beforeId })`), `frontend/src/lib/i18n-messages.ts`
- Test: `frontend/src/lib/event-kinds.test.ts`(필터 그룹)

- [ ] **Step 1:** 표(시각·종류·내용·누가) + 그룹 칩 필터(전체/Bundle/문서/판단/AI/검토, `getEventGroup`) + 끝에 닿으면 `beforeId`로 다음 쪽(`lib/use-progressive-list.ts` 또는 IntersectionObserver). 내용 칸은 detail이 있으면 전/후, 없으면 대상 수. 빈 결과는 `EmptyState`.
- [ ] **Step 2:** vitest·tsc·lint 0. 수동: 사건 120개 Bundle에서 끝까지 내려 중복 없음.
- [ ] **Step 3: Commit** — `feat(frontend): bundle history page with filters — History 화면`

## Phase D — 문서

### Task 13: 문서 정보 규칙 탐지(서버)

**Files:**
- Create: `backend/app/sop/doc_meta.py`
- Modify: `backend/app/sop/ingest.py`
- Test: `backend/tests/test_sop_doc_meta.py`, `backend/tests/test_sop_ingest.py`(있으면 그곳, 없으면 `test_sop_documents.py`)

**Interfaces:**
- Produces (순수, `ExtractResult.blocks`만 받는다):
  - `detect_header_fields(blocks: Sequence[ExtractedBlock]) -> HeaderFields` — `HeaderFields(doc_code: str | None, version: str | None)` frozen dataclass. 대상: `part in ("header",)` 블록 전부 + 본문 앞 40블록. 패턴(대소문자 무시): 번호 `(Doc(?:ument)?\s*No\.?|문서\s*번호|SOP\s*No\.?)\s*[:：]?\s*([A-Z]{2,5}(?:-[A-Z0-9]{2,10}){1,3})`, 버전 `(Version|Ver\.?|Rev(?:ision)?\.?|버전|개정\s*번호)\s*[:：]?\s*(\d{1,3}(?:\.\d{1,3})?)`. 첫 일치만.
  - `detect_language_layout(blocks) -> str` (`LANGUAGE_LAYOUTS` 중 하나): 본문 문단 블록마다 한글 비율로 ko/en/mixed 판정 → 한글 블록 0이면 `en_only`, 영어 블록 0이면 `ko_only`; ko→en→ko… 교대가 블록 쌍의 60% 이상이면 `ko_en_interleaved`, 아니면 `ko_en_separate`. 표 칸 블록은 세지 않는다.
- ingest: 추출 성공이면 `Document` 만들기 **전에** 탐지. `doc_version`은 파일명 값이 없을 때만 탐지 값. `doc_code`는 **Old 문서에서만** 파일명 값이 없을 때 탐지 값(New는 짝 문서 코드 규칙(`check_match_doc`)에 닿으니 파일명만 — 내 판단). `language_layout`은 늘 탐지 값으로 시작(Unit을 만들기 전, `create_initial_units` 앞).
- `DocumentOut`에 `prefill_sources: dict[str, Literal["file_name","content"]]`(업로드 응답에서만 채우고 목록 조회에서는 `{}`).

- [ ] **Step 1: Write the failing tests** — 머리글 "Doc No.: SOP-CDO-111334 / Version 3.1" → `HeaderFields("SOP-CDO-111334", "3.1")`; "문서번호 : SOP-QC-2207" → code; 번호 없는 머리글 → None; 블록 한글/영어 교대 10쌍 → `ko_en_interleaved`; 한글 10 뒤 영어 10 → `ko_en_separate`; 영어만 → `en_only`. ingest 시험: 파일명에 번호 없는 합성 DOCX(머리글에 번호·버전, `tests/docx_factory.py`로) 업로드 → 문서 `doc_code`·`doc_version` 채워짐, `prefill_sources == {"doc_code":"content","doc_version":"content"}`; 파일명에 번호가 있으면 파일명 값 유지.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `pytest tests/test_sop_doc_meta.py tests/test_sop_documents.py tests/test_sop_e2e.py -q` PASS(합성 E2E의 기존 정답이 배치 탐지로 바뀌지 않는지 — 바뀌면 탐지 규칙을 고치지 정답을 고치지 않는다).
- [ ] **Step 5: Commit** — `feat(backend): prefill document number, version and language layout from the file — 문서 정보 규칙 탐지`

### Task 14: 문서 번호·버전 AI 제안(서버)

**Files:**
- Create: `backend/app/sop/ai/doc_meta_job.py`, `backend/app/sop/ai/seeds/<기존 시드 규칙에 맞춘 doc_meta 프롬프트 파일>`, `backend/alembic/versions/0010_ai_doc_meta.py`
- Modify: `backend/app/sop/constants.py`(`AI_JOB_KINDS`에 `"doc_meta"`), `backend/app/sop/ai/handlers.py`, `backend/app/sop/ingest.py`(업로드 뒤 비었으면 작업 쌓기), `backend/app/routers/sop_documents.py`(`DocumentOut.ai_meta: {doc_code: str|None, doc_version: str|None, suggestion_id: int} | None`), 채택 기록(`adoption.py`) — 문서 PATCH가 제안 값과 같은 값을 저장하면 `as_is`, 다르면 `edited`
- Test: `backend/tests/test_sop_ai_doc_meta.py`, `backend/tests/test_sop_ai_schema.py`(CHECK 제약)

**Interfaces:**
- `JobHandler` 계약(`load/compute/apply`) 그대로: `load` = 문서의 첫 장 블록 글자(최대 40블록, 4000자)와 빈 칸 목록; `compute` = `llm.ensure_llm_enabled()` 후 JSON `{"doc_code": str|null, "version": str|null}`만 받음, 형식 검사(Task 13과 같은 패턴)에서 벗어나면 그 칸 무효; `apply` = 문서가 아직 그 칸이 비어 있을 때만 `AiSuggestion(kind="doc_meta", document_id, content)` 행을 쓴다. **문서 필드를 쓰지 않는다.**
- 작업은 업로드 트랜잭션이 끝난 뒤 AI가 켜져 있고 탐지 뒤에도 빈 칸이 있을 때만 쌓는다(사건 `ai.request`, actor = 올린 사람).
- 0010: `ck_ai_jobs_kind`에 `'doc_meta'` 추가(0007과 같은 batch 방식, downgrade 포함).

- [ ] **Step 1: Write the failing tests** — 가짜 AI(`tests/fake_ai.py`)가 `{"doc_code":"SOP-QC-2207","version":"2.0"}` 답 → 실행기 한 바퀴 뒤 문서 필드는 그대로 빈 값, `DocumentOut.ai_meta.doc_code == "SOP-QC-2207"`; 그 사이 사람이 번호를 넣었으면 `apply`가 제안을 쓰지 않음; AI 꺼짐이면 작업이 쌓이지 않음; 형식이 틀린 답(`"doc_code":"hello"`)은 그 칸 None; 마이그레이션된 DB에 `kind='doc_meta'` 행 INSERT 성공, `'nope'`는 실패.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** 구현(CLAUDE.md "AI 제안 층 불변식" 그대로 — 로그에 원문 금지, `replace_unstorable_chars`).
- [ ] **Step 4:** `pytest tests/test_sop_ai_doc_meta.py tests/test_sop_ai_schema.py tests/test_sop_ai_jobs.py -q` PASS.
- [ ] **Step 5: Commit** — `feat(backend): suggest missing document number and version with AI, never writing them — 문서 정보 AI 제안`

### Task 15: 업로드 모달

**Files:**
- Modify: `frontend/src/components/documents/upload-modal.tsx`, `frontend/src/lib/api-sop.ts`(`prefill_sources`)
- Create: `frontend/src/components/documents/side-choice.tsx`
- Test: `frontend/src/components/documents/side-choice.test.ts`(순수 부분이 있으면) — 없으면 스모크(Task 24)로

- [ ] **Step 1:** Old/New 선택을 `role="radiogroup"` 카드 두 개로(늘 2열, 좁으면 카드 안 체크만 숨김 — 목업 mock-3). 라벨 "Old SOP · 쪼개서 새 구조로 배정", "New SOP · WI · Old Unit과 짝 맞춤".
- [ ] **Step 2:** 파일 행: 파일명 · 문서 번호 · 버전 · 언어 배치(Task 16의 부품 재사용). 업로드 응답이 오면 서버 값으로 채우고 `prefill_sources`에 따라 칸 오른쪽에 "파일명"/"본문" 표, AI 제안이 생기면(`ai_meta`) "AI" 표 + 흐린 값. 사람이 고치면 표가 사라지고 값은 문서 PATCH로 저장.
- [ ] **Step 3:** tsc·lint·vitest 0.
- [ ] **Step 4: Commit** — `feat(frontend): upload modal with side cards and prefilled rows — 업로드 모달 개편`

### Task 16: 문서 목록

**Files:**
- Modify: `frontend/src/app/bundles/[id]/documents/page.tsx`, `frontend/src/components/documents/*`
- Create: `frontend/src/components/ui/version-input.tsx`, `frontend/src/lib/version-step.ts`, `frontend/src/components/documents/layout-picto.tsx`, `frontend/src/components/documents/preview-popover.tsx`
- Test: `frontend/src/lib/version-step.test.ts`

**Interfaces:**
- Produces: `stepVersion(value: string, dir: 1 | -1): string` — `"1.0"+1→"2.0"`, `"2.0"-1→"1.0"`, `"1.0"-1→"1.0"`(최소), `"2.9"+1→"2.10"`, `"2.10"-1→"2.9"`, `"2.1"-1→"2.0"`, `""+1→"1.0"`, 숫자 아닌 값은 `"1.0"`부터. `sanitizeVersion(text: string): string` — 숫자와 점 하나만 남김(`"v3.1a"→"3.1"`, `"1..2"→"1.2"`).
- `VersionInput({ value, onCommit(next: string), testId, disabled })` — 위/아래 단추, 칸 바깥 호버 x(비우기), placeholder "버전".
- `LayoutPicto({ layout })` + Select 옵션 라벨: 한영 교차 / 한영 분리 / 영어만 / 한국어만(en: KO/EN interleaved / KO/EN separate / English only / Korean only).

- [ ] **Step 1: Write the failing test** — 위 `stepVersion`·`sanitizeVersion` 사례 전부.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** 목록(목업 mock-3): 구분 `Old`/`New`; 문서 번호 칸 `min-width: 15ch`(고정폭) 표·카드 둘 다; 버전 `VersionInput`; 제목 = Split 링크(`/bundles/{id}/split?doc={docId}` — Split이 쿼리로 문서를 고르는지 확인, 없으면 Task 19에서 받게) + 호버 연필 → `InlineText` 편집; 언어 배치 Select + 그림; 줄 끝 `MorphButton` 미리보기(눈) · 내려받기 · 지우기(danger). AI 제안이 있는 빈 칸은 흐린 값 + `AI` 표, 누르면 PATCH. 빈 placeholder "문서 번호"/"버전". 미리보기는 `GET …/view`의 앞 20블록 글을 종이 모양 팝오버로 + "Split 열기".
- [ ] **Step 4:** vitest·tsc·lint 0. 수동: `SOP-CDO-111334`가 1120px 표·카드에서 잘리지 않음.
- [ ] **Step 5: Commit** — `feat(frontend): documents list with version stepper, title drill-in, preview and layout pictures — 문서 목록 개편`

## Phase E — Split

### Task 17: Split 순수 규칙

**Files:**
- Modify: `frontend/src/lib/paper-model.ts`
- Test: `frontend/src/lib/paper-model.test.ts`

**Interfaces:**
- Produces:
  - `buildContourPath(rects: { left: number; right: number; top: number; bottom: number }[], padX = 4, padY = 2): string` — 같은 줄(top 차이 < 4px) rect를 합치고, 줄 사이 경계를 가운데로 맞춘 뒤 오른쪽 가장자리를 따라 내려가 왼쪽을 따라 올라오는 SVG path(`M…H…V…Z`). rect가 없으면 `""`.
  - `shouldRecenter(unitTop: number, unitBottom: number, viewTop: number, viewBottom: number): boolean` — 단위가 화면 위 1/6 위 또는 아래 1/3 아래로 가면 true.
  - `getTags(unit: ViewUnit): { lang: "KO" | "EN"; hold: boolean }`, `getMarks(unit: ViewUnit): Array<"checked" | "pair" | "edited" | "classified" | "ai">` — `status`: `confirmed`→classified, `ai_suggested`→ai, `on_hold`→hold 태그.
  - `canMergeAdjacent(a: ViewUnit, b: ViewUnit): boolean` — 같은 문서·같은 표 소속(둘 다 표 밖이거나 같은 칸)·둘 다 문장류일 때(기존 합치기 규칙과 같은 판정을 재사용).

- [ ] **Step 1: Write the failing tests** — 한 줄 rect → 사각 path 하나(`M0-4,…` 꼴 값 단언); 두 줄(첫 줄이 오른쪽으로 더 길고 둘째 줄이 왼쪽에서 시작) → path에 `H`가 줄 수만큼, 첫 `M`이 첫 줄 left-pad; 같은 줄 rect 두 개는 하나로; 빈 배열 `""`. `shouldRecenter`: 가운데면 false, 맨 아래면 true. `getMarks`: status·pair·is_edited·boundary_confirmed 조합.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** 구현(목업 mock-4 `drawSelection`이 출발점).
- [ ] **Step 4:** vitest PASS.
- [ ] **Step 5: Commit** — `feat(frontend): pure rules for the split paper — contour, recenter, tags and marks — Split 순수 규칙`

### Task 18: Unit 편집 출처(서버) + 종이 그리기

**Files:**
- Modify: `backend/app/routers/sop_documents.py`(`ViewUnitOut.is_edited: bool` — 되돌려지지 않은 `UnitEdit.created_unit_ids`에 든 Unit), `frontend/src/lib/api-sop.ts`, `frontend/src/components/paper/paper.tsx`, `frontend/src/app/bundles/[id]/split/page.tsx`(왼쪽 범례), 종이 CSS
- Test: `backend/tests/test_sop_editing.py`(또는 view 시험이 있는 곳)

- [ ] **Step 1: Write the failing test(서버)** — 나누기 편집 뒤 view의 새 두 Unit `is_edited is True`, 나머지 False; 되돌리기 뒤 원래 Unit `is_edited is False`.
- [ ] **Step 2:** pytest → FAIL → 구현 → PASS.
- [ ] **Step 3:** 종이(목업 mock-4): 경계 확인 Unit은 조각(위아래 7px 틈, 조각 안 위아래 여백 축소, 전체 길이 거의 동일), 틈 호버 → 점선 + "위아래 합치기"(`canMergeAdjacent`일 때만, 기존 합치기 편집 호출), 문단 앞 태그(언어, 보류 겹치면 사선 쪼갠 한 태그), 종이 오른쪽 끝 아이콘(`getMarks`), 확인한 글자는 흐리게, 고른 Unit은 `buildContourPath` SVG 겹침(ResizeObserver·원문 글꼴 설정 변경 때 다시 그림), 왼쪽 문서 목록 아래 범례. 편집 불가면 틈 단추 없음.
- [ ] **Step 4:** pytest·vitest·tsc·lint 0.
- [ ] **Step 5: Commit** — `feat(split): cut-paper strips, gap merge, margin tags and a contour selection — Split 종이 개편`

### Task 19: Split 조작

**Files:**
- Modify: `frontend/src/app/bundles/[id]/split/page.tsx`, `frontend/src/components/paper/paper.tsx`
- Create: `frontend/src/lib/split-keys.ts`
- Test: `frontend/src/lib/split-keys.test.ts`

**Interfaces:**
- Produces: `getSplitKeyAction(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, ctx: { typing: boolean; layerOpen: boolean; hasCut: boolean; checked: boolean; canEdit: boolean }): "next" | "prev" | "check" | "uncheck" | "split" | "hold" | "escape" | "undo" | "redo" | null` — 지금 `handleKey`의 판단을 순수 함수로 옮기고 `ArrowDown`=next, `ArrowUp`=prev 추가. `typing`·`layerOpen`이면 null.

- [ ] **Step 1: Write the failing tests** — `ArrowDown`→next, `j`→next, `ArrowUp`→prev, 입력 중 `ArrowDown`→null, 메뉴 열림 `ArrowDown`→null, `Enter`+미확인→check, `s`+cut 없음→null.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** 페이지: `handleKey`가 `getSplitKeyAction`을 쓴다. 클릭 규칙 — 다른 Unit 클릭 = 고르기; **고른 Unit 단일 클릭 = 아무것도 안 함**; **더블클릭 = 그 자리에 나눌 선 + 선 아래 팝업**("여기서 나누기 S" / "취소 Esc"), 더블클릭의 기본 단어 선택은 `mousedown`의 `detail>1`에서 막음. 끌어 고르기(carve)·Ctrl+클릭(떨어진 합치기)은 그대로. 고른 Unit 끝에 작은 확인 단추(primary, 높이 ≈ 글자 줄 높이 19~20px, 체크만 → 호버 때 "경계 확인" 라벨, Enter와 같은 동작, 확인됐거나 편집 불가면 없음). 이동 뒤 `shouldRecenter`면 `scrollIntoView({ block: "center" })`. 문서 목록 링크의 `?doc=` 쿼리로 해당 문서를 연다(Task 16).
- [ ] **Step 4:** vitest·tsc·lint 0. 수동: 고른 문장 한 번 클릭으로는 나뉘지 않음, 더블클릭→S로 나뉨.
- [ ] **Step 5: Commit** — `feat(split): inline confirm, double-click cut, arrow keys and centered scrolling — Split 조작 개편`

### Task 20: Split 오른쪽 칸

**Files:**
- Modify: `frontend/src/app/bundles/[id]/split/page.tsx`
- [ ] **Step 1:** 칸 전체 `min-width:0`, 글·짝·경고 칸 `overflow-wrap:anywhere` — 가로 스크롤 없음. 상태 칩: 확인 전 = 노란 테두리 칩(빈 원), 확인함 = 파란 채운 칩(체크). 한/영 짝·합치기·누락 의심 설명 문단 → 이름 옆 `InfoTip`(문구는 짧게, 맥 안내 삭제: `split.mergeHint`의 "(맥은 Cmd)" 제거).
- [ ] **Step 2:** tsc·lint 0. 수동: 일련번호가 긴 Unit에서 오른쪽 칸 가로 스크롤 없음.
- [ ] **Step 3: Commit** — `feat(split): wrapping unit panel, distinct check chip and info tips — Split 오른쪽 칸`

## Phase F — 피커

### Task 21: 디렉터리 전체 + 검색 순위 + 무한 스크롤

**Files:**
- Modify: `backend/app/routers/directory.py`(`GET /api/directory/all` → 재직자 전원 `DirectoryUserOut`, login_id 순), `frontend/src/components/subject-picker.tsx`, `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/hangul.ts`, `frontend/src/lib/search.ts`(bpm `frontend/src/lib/hangul.ts`·`lib/search.ts`를 옮겨 이 저장소 규칙에 맞춤), `frontend/src/lib/directory-cache.ts`, `frontend/src/lib/people-order.ts`
- Test: `backend/tests/test_directory.py`, `frontend/src/lib/search.test.ts`(bpm 시험 옮김 + 아래), `frontend/src/lib/people-order.test.ts`

**Interfaces:**
- `filterByQuery<T>(items: T[], query: string, getFields: (item: T) => { field: string; text: string }[]): SearchHit<T>[]` (bpm과 같은 순위: 정확 > 앞 > 단어 시작 > 중간 > 초성 > 로마자 > 띄엄띄엄; 같으면 필드 순서 → 위치 → 짧은 필드). 사람 필드는 `[name, korean_name, login_id]`만(부서 제외).
- `orderBrowse(people: DirectoryUser[], myDeptPath: string): DirectoryUser[]` — 같은 `dept_path` → 내 경로의 조상 경로(가까운 것부터) → 나머지(원순서 유지, stable).
- `loadDirectoryOnce(): Promise<DirectoryUser[]>` — 모듈 캐시, 실패하면 캐시 비움, 로그아웃·사용자 전환 때 비움(`bundle-store`와 같은 지점).
- 목록은 25명씩, 끝 센티널(IntersectionObserver)에서 25명 더. 검색어가 바뀌면 처음부터.

- [ ] **Step 1: Write the failing tests** — 서버: `/api/directory/all`이 50명 넘게(60명 시드) 전부, 퇴직자 제외. 프런트: "kim" 검색에서 `kim`(정확) > `kimberly`(앞) > `a.kim`(단어 시작); "ㄱㅅㅇ"이 "김사용" 매치; 부서명만 맞는 사람은 결과 없음; 5000명에서 `filterByQuery` 1회 < 100ms; `orderBrowse` 내 부서 → 부모 → 조부모 → 나머지.
- [ ] **Step 2:** pytest·vitest → FAIL.
- [ ] **Step 3:** 구현. 긴 부서 경로는 말줄임 + `Tooltip`. 멤버 관리·권한 부여·유효 권한이 같은 피커.
- [ ] **Step 4:** pytest·vitest·tsc·lint 0.
- [ ] **Step 5: Commit** — `feat(picker): full directory with ranked search, own-department-first browse and infinite list — 피커 개편`

## Phase G — 문구·검증·릴리스

### Task 22: 라벨 정리

**Files:**
- Modify: `frontend/src/lib/i18n-messages.ts`, 하드코딩 문구가 남은 컴포넌트
- Test: `frontend/src/lib/i18n-messages.test.ts`(기존 키 가드)
- [ ] **Step 1:** ko 전체를 원칙(짧은 명사형·문장형 풀이 금지·"업로드"·"버전")으로 고친다. 한국어 화면의 "묶음/옛/새/단위" → `Bundle/Old/New/Unit`(화면 문구·`rule.*`까지, 산출물 제외). en도 같은 원칙(장황한 설명 → (i) 툴팁 문구로 이동). 키는 바꾸지 않는다.
- [ ] **Step 2:** `git grep -n "묶음\|옛 \|단위" frontend/src/lib/i18n-messages.ts`가 의도한 예외(권한 이름 등 — 남기면 이유를 PROGRESS에)만 남음. vitest PASS.
- [ ] **Step 3: Commit** — `chore(i18n): concise labels and English domain terms — 라벨 정리`

### Task 23: 빈 화면 적용

**Files:**
- Modify: 빈 상태를 한 줄로 그리는 모든 화면(`git grep -n "empty" frontend/src/app frontend/src/components`): 묶음 목록·문서·To-Be·Split·분류·짝 맞추기·결과물·검토·관리 표들
- [ ] **Step 1:** 각 화면의 빈 상태를 `EmptyState`(아이콘·짧은 제목·한 줄·가능하면 다음 행동 단추)로. 기존 testid는 유지하고 `EmptyState`의 `testId`로 넘긴다.
- [ ] **Step 2:** tsc·lint·vitest 0.
- [ ] **Step 3: Commit** — `feat(frontend): centered empty states on every screen — 빈 화면 통일`

### Task 24: 스모크·대비·설명서·릴리스

**Files:**
- Modify: `frontend/scripts/pw-smoke-baseline.mjs`, `pw-smoke-sop.mjs`, `pw-contrast-audit.mjs`, `pw-manual-shots.mjs`, `docs/manual/system-walkthrough.html`(+ 다시 뽑은 `docs/manual/img/*`), `CLAUDE.md`(새 공통 부품·피커·토스트·History 경로 한 줄씩), `docs/README.md`·`docs/design/README.md`(목업 폴더 인덱스), `PROGRESS.md`, `CHANGELOG.md`, `frontend/package.json`(+lock)
- [ ] **Step 1:** 스모크를 새 흐름으로: 사용자 메뉴로 로그아웃·언어 토글, New bundle 한 번 → `BND-` 개요, 문서 0일 때 Split 잠김·To-Be 열림, 업로드 카드, 버전 단추, Split 인라인 확인·더블클릭 나누기·↓ 이동·틈 합치기, History, 멤버 관리에서 **긴 부서 경로 직원**(스모크 전 DB에 넣는 단계 포함) 검색→추가→저장.
- [ ] **Step 2:** reset_db → seed_sop_demo → backend(DEV_ENFORCE_PERMISSIONS=true) + `npm run dev` → `node scripts/pw-smoke-baseline.mjs`, `pw-smoke-sop.mjs`(가짜 AI `FAKE_AI_SPLIT=1` 경로 포함), `pw-contrast-audit.mjs`(11화면 × 라이트·다크 4.5:1) 모두 통과. 1120·1366·1920 캡처 육안 확인.
- [ ] **Step 3:** `pw-manual-shots.mjs`로 설명서 그림 다시 뽑고 설명서 본문의 옛 동작 문장을 고친다.
- [ ] **Step 4:** 전체 게이트 — backend `pytest tests/ -q`, `ruff check app/ tests/`; frontend `npm run build`(경고 0, dev 서버 내린 뒤), `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`.
- [ ] **Step 5:** `cd frontend && npm version minor --no-git-tag-version`(0.9.0), `CHANGELOG.md` v0.9.0 항목, PROGRESS 브랜치 요약 압축, 설계 목업 폴더는 main 머지 때 지울 대상(`documentation.md` 폐기 정책)으로 PROGRESS에 메모.
- [ ] **Step 6: Commit** — `chore(release): v0.9.0 — first-use feedback revamp — 첫 실사용 피드백 개편 릴리스`. main 머지·태그·푸시는 사용자 확인 뒤.
