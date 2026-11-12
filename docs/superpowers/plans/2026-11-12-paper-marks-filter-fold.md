# 용지 표시 정리 · 상태 칩 · 필터 접기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split·Assign 용지의 색 탭을 [번호 칸][언어 막대] + 보류 칩으로 바꾸고, 문장 앞 번호를 숨기고, 짝을 P2로, Unit 상태를 칩 한 벌로, 언어 표시를 한 모양으로 통일하고, Assign 필터를 걸면 Old 용지를 F3로 접는다.

**Architecture:** 판단은 순수 모델로 뗀다 — 번호 숨김 길이(`strip-pill-model.ts`), 접기 계획(`paper-fold-model.ts`), 필터 밖에서 다음·이전(`classify-model.ts`). 화면 부품은 셋 — 줄 앞머리 `StripLead`(Paper·New 칸 공용), 상태 칩 `UnitStatusChip`(+ 필터 칩), 언어 표시 `LangMark`. `Paper`는 선택적 `strips.fold`를 받아 접고, Assign이 스냅숏 목록으로 그것을 넘긴다.

**Tech Stack:** Next.js 16 · React 19 · TypeScript strict · Tailwind 4 + `src/styles/components.css` · vitest · Playwright 스크립트(`frontend/scripts/pw-*.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-12-paper-marks-filter-fold-design.md` (절 번호 §는 이 문서 기준)

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/paper-marks-impl`, 브랜치 `feat/paper-marks-impl`(`fix/screen-review` 146a320 = v0.16.4 기준). 원본 체크아웃은 건드리지 않는다. 계획의 줄 번호는 98e0327 기준이라 `components.css`·`tokens.css`는 몇 줄 밀렸을 수 있다 — 선택자 이름으로 찾는다.
- 새 정보는 용지 **왼쪽에만**. 오른쪽 끝 아이콘(`.strip-marks`)·연결 배지(`.lbadge`) 자리는 그대로.
- 원문·결과물 데이터 불변 — 번호 숨김은 표시만. backend 변경 없음.
- 상태 칩 글자 = 기존 `status.unit.*` 문구(영어 고정), 대문자는 CSS `text-transform`만.
- 묶음 상태·문서 상태·시스템 보류(`pill warn`) 알약은 그대로.
- 색만으로 구분하지 않는다 — 칩은 아이콘 + 글자, 막대는 툴팁·sr-only 글.
- 글자 대비 4.5:1 라이트·다크(`pw-contrast-audit`), 움직임은 모션 토큰·reduced-motion 즉시.
- 인터랙티브·상태 요소에 `data-testid`(`surface-role`, 목록은 id 붙임).
- 새 의존성 없음. i18n 새 키는 en·ko 둘 다(`src/lib/i18n-messages.ts`).
- 커밋마다 `PROGRESS.md` 한두 줄, 화면·라벨이 바뀌는 커밋은 같은 커밋에서 `frontend/public/manual/user-manual.md`.
- 커밋 메시지 `type(scope): English — 한국어`, 끝에 세션 attribution 두 줄.
- 커밋 전 `npx vitest run` · `npx tsc --noEmit -p tsconfig.json` · `npm run lint` 초록.

## Review Focus

1. **번호 앞머리 모양이 제각각** — `5.1 제목`, `5.1. 제목`, `5.1제목`(공백 없음), `5.10 제목`인데 절 번호가 `5.1`, 글 전체가 번호뿐. 정확히 그 번호만 숨기고, 숫자가 이어지면 숨기지 않고, 숨기면 빈 글이 되는 경우는 숨기지 않는다 → Task 1 테스트.
2. **접힌 곳의 Unit이 골라진다** — 출처 칩(`jumpToOld`)·연결 배지·Shift 다중 고르기로 필터 밖 Unit이 골라져도 화면에 보여야 한다(조용히 못 찾지 않게) → Task 2 `forceOpenIds` 테스트, Task 7 스모크.
3. **필터를 건 채 확정·보류** — 상태가 바뀐 문장이 그 자리에서 접히거나 사라지면 안 된다 → Task 7은 `snapshot.keys`로만 맞음을 정한다, Task 2 테스트(맞음 집합은 입력 그대로).
4. **짝이 접기 경계에 걸침** — 짝 위 줄은 맞고 아래 줄은 아님, 짝이 곁 자리, 짝이 묶음 안. 짝은 언제나 한 덩어리로 같은 모양 → Task 2 테스트.
5. **Split 나누기 자리가 숨긴 앞머리에 닿음** — 두 번 눌러 자르기·손잡이 ←→로 숨긴 범위 안으로 가도 깨지지 않고 원문 위치가 맞다 → Task 1 `sliceVisible` 테스트, Task 5 스모크.

---

### Task 1: 번호 숨김 순수 함수

**Files:**
- Modify: `frontend/src/lib/strip-pill-model.ts`
- Test: `frontend/src/lib/strip-pill-model.test.ts`

**Interfaces:**
- Produces: `getHiddenPrefixLength(text: string, sectionLabel: string): number`, `sliceVisible(start: number, end: number, skip: number): { start: number; end: number } | null`

- [ ] **Step 1: Write the failing tests**

```ts
describe("getHiddenPrefixLength", () => {
  it("hides the section number and the space after it", () => {
    expect(getHiddenPrefixLength("5.1 장비 점검", "5.1")).toBe(4);
    expect(getHiddenPrefixLength("5.1. 장비 점검", "5.1.")).toBe(5);
    expect(getHiddenPrefixLength("5.1. 장비 점검", "5.1")).toBe(5);
    expect(getHiddenPrefixLength("5. 시험 절차", "5.")).toBe(3);
    expect(getHiddenPrefixLength("5.1장비", "5.1")).toBe(3);
    expect(getHiddenPrefixLength("  5.1\t장비", "5.1")).toBe(6);
  });
  it("keeps text that does not start with exactly that number", () => {
    expect(getHiddenPrefixLength("5.10 제목", "5.1")).toBe(0);
    expect(getHiddenPrefixLength("시험 절차", "5")).toBe(0);
    expect(getHiddenPrefixLength("가. 범위", "가.")).toBe(0);
    expect(getHiddenPrefixLength("5.1", "5.1")).toBe(0); // 숨기면 빈 글
    expect(getHiddenPrefixLength("5.1 ", "5.1")).toBe(0);
  });
});
describe("sliceVisible", () => {
  it("trims a segment by the hidden prefix", () => {
    expect(sliceVisible(0, 10, 4)).toEqual({ start: 4, end: 10 });
    expect(sliceVisible(0, 3, 4)).toBeNull();
    expect(sliceVisible(6, 12, 4)).toEqual({ start: 6, end: 12 });
    expect(sliceVisible(0, 10, 0)).toEqual({ start: 0, end: 10 });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/strip-pill-model.test.ts` — Expected: FAIL (not exported).

- [ ] **Step 3: Implement** both in `strip-pill-model.ts`. `getHiddenPrefixLength`: 숫자 번호(`getSectionPill(label) !== null`)일 때만; 라벨 끝 `.`을 떼고 `^\s*<번호>\.?` 다음 글자가 숫자가 아니어야 하고, 뒤따르는 공백(`\s*`)까지 길이. 남은 글이 비면 0. 이 함수는 절 머리 블록에만 불린다(Task 5) — 단위 수량 판정은 두지 않는다. `sliceVisible`: `skip >= end`면 null, 아니면 `{ start: Math.max(start, skip), end }`.

- [ ] **Step 4: Run** same command — Expected: PASS.

- [ ] **Step 5: Commit** `feat(paper): hidden section-number prefix helpers — 문장 앞 절 번호 숨김 함수` (+ PROGRESS.md 한 줄)

---

### Task 2: 접기 계획 순수 모델 (F3)

**Files:**
- Create: `frontend/src/lib/paper-fold-model.ts`
- Test: `frontend/src/lib/paper-fold-model.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FoldItem { key: string; unitIds: number[]; section: string } // 짝 두 줄 = 한 item
  export interface FoldOpen { runs: ReadonlySet<string>; peeks: ReadonlySet<string> } // runKey = 묶음 첫 item key
  export type FoldEntry =
    | { kind: "full"; key: string }                    // 맞음
    | { kind: "peek"; key: string }                    // 펼친 필터 밖
    | { kind: "line"; key: string; runKey: string | null } // 한 줄 판(곁 또는 펼친 묶음 안)
    | { kind: "run"; runKey: string; count: number; from: string; to: string } // 접힌 묶음
    | { kind: "runHead"; runKey: string };             // 펼친 묶음 위 "접기"
  export const EMPTY_FOLD_OPEN: FoldOpen;
  export function buildFoldPlan(items: readonly FoldItem[], matchIds: ReadonlySet<number>, open: FoldOpen, forceOpenIds?: ReadonlySet<number>): FoldEntry[];
  ```

- [ ] **Step 1: Write the failing tests** (item 헬퍼 `it(key, ids, section)`):
  - 맞음 1개가 가운데: `[a,b,c,M,d,e,f]` → `run(a..b, count 2)`, `line c`, `full M`, `line d`, `run(e..f)`.
  - 한 개뿐인 묶음은 `line`: `[a,M,b,c]`의 끝 `c`가 단독이면 → `line a`, `full M`, `line b`, `line c`.
  - 묶음 `from`/`to`: 걸친 item들의 첫·끝 `section`(같으면 같은 값), 빈 section은 건너뛴다.
  - `count` = 묶음 안 `unitIds` 수 합(unit 없는 item은 1).
  - 짝 item(`unitIds: [7, 8]`)은 둘 중 하나라도 `matchIds`에 있으면 `full`.
  - `open.runs`에 든 묶음 → `runHead` 다음 그 item들이 `line`(`runKey` 붙음), `open.peeks`에 든 key는 `peek`.
  - `forceOpenIds`에 든 unit이 묶음 안이면 그 묶음이 펼쳐지고 그 item은 `peek`; 곁 줄이면 `peek`.
  - 맞음 0개면 빈 배열.
  - 맞음끼리 이웃하면 사이에 아무것도 없다; 연속 맞음 `[M1,M2]` → `full, full`.
  - 5,000 item에서 한 번 계산이 50ms 안(`performance.now()`).

- [ ] **Step 2: Run** `npx vitest run src/lib/paper-fold-model.test.ts` — FAIL.

- [ ] **Step 3: Implement** — 한 번 훑기: 맞음 표시 → 곁(맞음의 바로 앞·뒤 item) 표시 → 남은 것들을 이어진 구간으로 묶고, 구간 길이 1이면 `line`. O(n).

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** `feat(paper): fold plan model for filtered paper — 필터 접기 계획 모델`

---

### Task 3: 상태 칩 한 벌

**Files:**
- Modify: `frontend/src/components/status.tsx` (`UnitStatusPill` → `UnitStatusChip`, `FilterChip` 추가)
- Modify: `frontend/src/styles/components.css` (`.schip` 계열 추가, `.fpill` 계열 삭제)
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx` (줄 상태 1266, 필터 줄 1347–1381, `FILTER_LOOK` 삭제)
- Modify: `frontend/src/components/outputs/output-a-row.tsx:98`
- Test: `frontend/src/components/status.test.ts` (새로, `output-c.test.ts`의 createElement + LangProvider 렌더 방식)

**Interfaces:**
- Produces:
  ```ts
  export type ChipTone = CoverStatus | "all" | "danger";
  export function UnitStatusChip(props: { status: CoverStatus; size?: "md" | "sm"; testId?: string }): JSX.Element; // md 18px, sm 15px(용지 보류)
  export function FilterChip(props: { tone: ChipTone; label: string; count: number; selected: boolean; onClick: () => void; testId: string; icon: LucideIcon }): JSX.Element; // 26px 단추, role="tab", aria-selected
  ```
  DOM: `<span class="schip" data-tone="on_hold" data-size="sm">` + 아이콘 + 글. 필터는 `<button class="schip schip-btn" data-tone=… aria-selected>` + `.schip-n` 수.

- [ ] **Step 1: Failing test** — `UnitStatusChip status="on_hold"` 렌더 → `.schip[data-tone="on_hold"]`, textContent `On hold`(대문자 아님 — CSS가 바꾼다), svg 하나. `size="sm"` → `data-size="sm"`. `FilterChip selected` → `aria-selected="true"`, 클릭이 `onClick` 부름, `.schip-n` 글 = count.
- [ ] **Step 2: Run** `npx vitest run src/components/status.test.ts` — FAIL.
- [ ] **Step 3: Implement** 부품과 CSS. 색은 §3.4: 톤마다 `--sc-ink`/`--sc-tint`(미배정 = `--st-none-ink` + `--sunken` + 안쪽 1px `--line-2`, AI = `--st-ai-ink`/`--st-ai-tint`, 보류 = `--st-hold-ink`/`--st-hold-tint`, 확정 = `--accent`/`--accent-tint`, all = `--ink-2`/`--sunken`, danger = `--danger-ink`/`--danger-tint`), 모서리 `--r-1`, 글 `700 9.5px var(--font-mono)` 대문자·자간 .03em. 고른 필터 칩 = 바탕 `--sc-ink`, 글 `--surface`. Assign 필터 줄과 줄 상태·결과물 A를 새 부품으로, 출처 없는 New 문장 칩은 `tone="danger"` `icon={TriangleAlert}`.
- [ ] **Step 4: Run** test + `npx tsc --noEmit -p tsconfig.json` + `npm run lint` — PASS.
- [ ] **Step 5: 설명서** — `user-manual.md`의 Assign 필터·상태 문단에서 "알약"을 칩으로 바꾸는 글만(굵은 라벨 글자는 그대로).
- [ ] **Step 6: Commit** `feat(status): one chip family for unit status and filters — 상태 칩 한 벌`

---

### Task 4: 언어 표시 `LangMark`

**Files:**
- Create: `frontend/src/components/lang-mark.tsx`
- Modify: `frontend/src/styles/components.css` (`.lmark` 추가, `.ptag`·`.tree-leaf .ptag` 삭제; `.lg`는 남긴다 — Split 순번이 쓴다)
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx` (862, 934, 983), `frontend/src/components/assign/destination-tree.tsx:71`, `frontend/src/app/bundles/[id]/split/page.tsx:660`, `frontend/src/app/bundles/[id]/page.tsx` (153, 191, 229), `frontend/src/app/page.tsx` (110, 123)
- Test: `frontend/src/components/lang-mark.test.ts`

**Interfaces:**
- Produces: `export function LangMark(props: { lang: "ko" | "en" | "neutral"; testId?: string }): JSX.Element` → `<span class="lmark" data-lang="ko">KO</span>`(neutral은 `–`, data-lang 없음). `::before` 3×13px 막대 = 언어색(neutral 회색 `--ink-4`), 글 mono 700 10px `--ink-2`.

- [ ] **Step 1: Failing test** — `ko` → `data-lang="ko"`, 글 `KO`; `neutral` → 글 `–`, `data-lang` 없음.
- [ ] **Step 2: Run** `npx vitest run src/components/lang-mark.test.ts` — FAIL.
- [ ] **Step 3: Implement** 부품·CSS, 위 사용처 전부 교체(Split 868의 순번 `.lg`는 건드리지 않는다).
- [ ] **Step 4: Run** test·tsc·lint — PASS.
- [ ] **Step 5: Commit** `feat(ui): one language mark across screens — 언어 표시 통일`

---

### Task 5: 용지 줄 앞머리 · 번호 숨김 · 보류 칩 · 짝 P2 (Paper)

**Files:**
- Create: `frontend/src/components/paper/strip-lead.tsx`
- Modify: `frontend/src/components/paper/paper.tsx` (`renderTab`·`describeTab` → `StripLead`, `renderSegment`에 숨김, 줄 첫머리 보류 칩, 클릭 위임 `.strip-tab` → `.strip-lead`, 머리 주석)
- Modify: `frontend/src/styles/components.css` (1008 주석, 1016–1018, 1050 `--gap-tab`, 1108, 1111–1131의 `.strip-tab*`를 `.strip-lead*`로; 짝 카드 구분선을 점선으로)
- Modify: `frontend/src/styles/tokens.css` (`--tab-*` 5개 라이트·다크 삭제 — 쓰는 곳이 없어지면)
- Modify: `frontend/scripts/pw-smoke-sop.mjs` (Split 머리 줄 번호 중복 없음 확인 추가)

**Interfaces:**
- Consumes: Task 1 `getHiddenPrefixLength`, `sliceVisible`; Task 3 `UnitStatusChip`(size `sm`).
- Produces:
  ```ts
  export interface StripLeadProps { width: number; number: string | null; lang: "ko" | "en" | null; bracket?: PairBracket; dim: boolean; tip: string; testId: string; onClick?: () => void }
  export function StripLead(props: StripLeadProps): JSX.Element;
  ```
  DOM: `<span class="strip-lead" data-bracket data-dim data-testid="{testId}-lead-{id}"><span class="strip-lead-num" data-testid="{testId}-num-{id}">5.1</span><span class="strip-lead-bar" data-lang="ko" data-tip="…"/></span>`. 폭 = 기존 `readTabWidth`(번호 칸) + 8px(막대 3 + 틈 5).

- [ ] **Step 1: StripLead + CSS** — 번호 칸 오른쪽 맞춤 mono 500 11px `--ink-3`(`dim`이면 번호 없음), 막대 3px 둥근 끝, 줄 높이 전체, KO `--lang-ko` / EN `--lang-en` / 없음 `--ink-4` 40%. 짝: `bracket="top"`이면 막대 아래 모서리 직각·`bottom`이면 위 모서리 직각, 두 줄 사이 틈 0이라 이어 붙는다. 짝 카드 안 구분선 `border-top: 1px dashed var(--line-2)`(지금 `::before` 실선 교체). 고른 짝 강조: `.strip-row:has(> .strip[data-partner], > .strip[data-link-hover]) > .strip-lead`의 inset 테두리 대신 `.strip[data-partner]`에 `box-shadow: 0 0 0 2px var(--accent)`(짝 카드 두 줄 모두). 1280 미만 Split 46px 상한은 `.strip-lead-num`에(말줄임). `--gap-tab`은 새 앞머리 폭.
- [ ] **Step 2: Paper 배선** — `renderTab` 자리에 `StripLead`; 툴팁 글은 지금 `describeTab` 글 재사용(`split.tabKo`·`split.tabEn`·`split.tabHold`) — 막대에 `data-tip`, 같은 글을 sr-only로. 앞머리를 누르면 지금 탭과 같이 그 줄을 고른다(`handleClick`의 `.strip-tab` 분기를 `.strip-lead`로). 올리면 글자가 바뀌던 `.strip-tab-letters`는 없앤다.
- [ ] **Step 3: 번호 숨김** — `renderRow`의 piece에서 `sectionHeads.has(unit.id)`이고 `part`가 첫 part이며 그 블록의 첫 segment가 이 unit이고 `start === 0`일 때 `skip = getHiddenPrefixLength(block.text, section)`. `renderSegment(block, segment, index, skip)`이 `sliceVisible`로 잘라 그리고 `data-start`는 잘린 시작값. 잘라 낼 자리(`cut`)가 `skip`보다 앞이면 `cut-a`는 빈 글(그리지 않음)로 둔다.
- [ ] **Step 4: 보류 칩** — `getTags(live).hold`면 그 줄 첫 `<p>` 앞머리(첫 글자 조각 앞)에 `<UnitStatusChip status="on_hold" size="sm" testId={`${testId}-hold-${unit.id}`} />`. 칩은 `.su` 밖, `<p>` 안 첫 자식으로 두고 `data-start`를 달지 않는다 — `readNodeOffset`은 `closest("[data-start]")`가 없으면 null이라 칩을 눌러도 글자 위치로 읽히지 않고, `handleClick`의 조각 상자 분기가 그 줄을 고른다.
- [ ] **Step 5: 확인** — `npx vitest run` · tsc · lint 초록. 개발 서버(`reset_db → seed_sop_demo`, backend 8777, frontend 3777)에서 Split·Assign을 열어 눈으로: 머리 줄 번호가 한 번만, 짝 막대 이어짐, 보류 칩. 스모크에 추가: Split 첫 머리 줄 `split-paper-piece-<id>`의 글이 `split-paper-num-<id>` 글로 시작하지 않는다, 두 번 눌러 나누기 기존 단계가 그대로 통과. `BASE_URL=http://localhost:3777 node scripts/pw-smoke-sop.mjs` — ALL PASS.
- [ ] **Step 6: 설명서** — `user-manual.md` Split 절의 "조각 왼쪽 탭" 문단(번호 칸·막대·보류 칩·막대 툴팁), "조각 사이 간격"의 짝 탭 문장, 짝 강조 문장(탭 테두리 → 카드 테두리)을 고친다.
- [ ] **Step 7: Commit** `feat(paper): number column, language bar, hold chip, P2 pairs — 번호 칸·언어 막대·보류 칩·짝 카드`

---

### Task 6: Assign New 칸

**Files:**
- Modify: `frontend/src/components/assign/new-pane.tsx` (탭 → `StripLead`, `.new-sec` 글에서 앞 번호 빼기)
- Modify: `frontend/src/styles/components.css` (`.new-line[data-state="unsourced"]`의 왼쪽 inset 3px 빨강이 언어 막대와 맞붙지 않게 — 아래)

**Interfaces:**
- Consumes: Task 5 `StripLead`, 기존 `readSectionNumber`.

- [ ] **Step 1:** 줄마다 `StripLead`(번호 = 지금 `number`, lang = neutral이면 null, testId `assign-new`), 짝 P2는 Task 5 CSS가 이미 맡는다. `.new-sec` 글 = `row.section_path`에서 `readSectionNumber` 앞머리와 뒤 `.`·공백을 뗀 글(번호가 없으면 그대로) — Task 1 `getHiddenPrefixLength(path, number)`를 재사용.
- [ ] **Step 2:** 출처 없는 줄 표시는 왼쪽 inset 대신 테두리 전체 `inset 0 0 0 1.5px var(--danger-fill)`로(바로 왼쪽 언어 막대와 두 줄 막대로 읽히지 않게).
- [ ] **Step 3: 확인** — tsc·lint·vitest 초록, 개발 서버 Assign New 칸에서 절 머리 줄 번호 한 번, 언어 차단 줄 흐림 그대로, 짝 막대.
- [ ] **Step 4: Commit** `feat(assign): New pane uses the same lead and P2 pairs — New 칸 앞머리·짝 통일`

---

### Task 7: Assign 필터 접기 + 첫 진입 All

**Files:**
- Modify: `frontend/src/components/paper/paper.tsx` (`strips.fold`, `renderRows`가 `buildFoldPlan` 결과를 그림)
- Modify: `frontend/src/components/assign/old-pane.tsx` (fold 넘기기, 빈 상태 + 바로 가기)
- Modify: `frontend/src/app/bundles/[id]/assign/page.tsx` (첫 필터 `all`, 펼침 상태, 맞음 집합, 다음·이전)
- Modify: `frontend/src/lib/classify-model.ts` (`pickFirstFilter` 삭제, `stepInList` 추가) · `frontend/src/lib/classify-model.test.ts`
- Modify: `frontend/src/styles/components.css` (`.fold-line`·`.fold-run`·`.fold-head`·`.strip-row[data-peek]`)
- Modify: `frontend/src/lib/i18n-messages.ts` (en·ko)
- Modify: `frontend/scripts/pw-smoke-sop.mjs` (475·1105의 첫 필터 확인 → `assign-filter-all`, 접기 단계 추가), `frontend/scripts/pw-manual-shots.mjs`·`pw-overlap-audit.mjs`는 필터를 직접 누르므로 그대로인지 확인

**Interfaces:**
- Consumes: Task 2 전부, Task 5 `StripLead`.
- Produces:
  ```ts
  // paper.tsx strips에 추가
  fold?: { matchIds: ReadonlySet<number>; open: FoldOpen; onOpenChange: (next: FoldOpen) => void };
  // classify-model.ts
  export function stepInList(allKeys: readonly string[], listKeys: readonly string[], activeKey: string | null, step: 1 | -1): string | null;
  ```
  testid: `assign-paper-fold-run-{runKey}`, `assign-paper-fold-line-{key}`, `assign-paper-fold-head-{runKey}`, 엿보기 줄은 `.strip-row[data-peek]`, 빈 상태 `assign-fold-empty`, 바로 가기 `assign-fold-go-{docId}-{part}`.
  i18n: `paper.foldRun` en "{n} more" / ko "문장 {n}개", `paper.foldExpand` "Expand"/"펼치기", `paper.foldCollapse` "Collapse"/"접기", `assign.foldEmpty` "No sentences with this status in this document part." / "이 문서·부분에는 이 상태의 문장이 없습니다.", `assign.foldElsewhere` "Found in" / "있는 곳".

- [ ] **Step 1: `stepInList` failing test** — `all=[a,b,c,d,e]`, `list=[b,d]`: active `c`(목록 밖), step 1 → `d`; step -1 → `b`; active `e`, step 1 → `d`(끝이면 마지막 맞음); active `b` step 1 → `d`; active null step 1 → `b`; list 빈 → null. `pickFirstFilter` 테스트 삭제.
- [ ] **Step 2: Run** `npx vitest run src/lib/classify-model.test.ts` — FAIL, 구현, PASS.
- [ ] **Step 3: 첫 진입 All** — 스냅숏 초기화(지금 `pickFirstFilter(counts)`)를 `"all"`로, `useState<Filter>("all")`. `moveRow`는 `stepInList(rows.map(r => r.key), listKeys, activeKey, step)`.
- [ ] **Step 4: 맞음 집합·펼침 상태** — `const foldMatch = mode === "old" && filter !== "all" ? new Set(listKeys.flatMap(k => rowMap.get(k)?.unitIds ?? [])) : null`(스냅숏 기준 — Review Focus 3). 펼침 `useState<{ filter: Filter; seq: number; open: FoldOpen }>`; `applyFilter`가 `seq`를 올려 비운다(같은 필터를 다시 눌러도 접힘). 출처 없는 New 모드(`mode === "unsourced"`)면 `foldMatch = null`.
- [ ] **Step 5: Paper 그리기** — `strips.fold`가 있으면 `sections`마다 rows를 `FoldItem`으로(짝 `top`+`bottom` 두 row = 한 item, key는 위 row key, section은 `readRowSection`) 바꿔 `buildFoldPlan(items, matchIds, open, forceOpenIds = selectedBlock)` — 고른 Unit(과 짝)이 접혀 있으면 저절로 엿보기(Review Focus 2). `full`·`peek`는 지금 `renderRow`(peek는 `.strip-row[data-peek]`: 바탕 `--sunken`, 테두리 점선, 그림자 없음), `line`은 단추 `.fold-line`(StripLead를 옅게 + 한 줄 말줄임 11.5px `--ink-4`, 짝은 두 글을 ` / `로, 표는 `assign.newTable`, 그림은 `assign.newFigure` 글), `run`은 단추 `.fold-run`(점선 테두리 22px, `paper.foldRun` + mono `§ from–to` + 오른쪽 `paper.foldExpand`), `runHead`는 작은 글 단추 `paper.foldCollapse`. 줄 사이 틈(`strip-gap`)은 `full`·`peek`끼리 이웃할 때만, 합치기는 Assign에 없으니 그대로. `line` 누르면 `peeks`에 더하기, `run` 누르면 `runs`에 더하기, `runHead`는 그 runKey의 `runs`와 그 안 `peeks`를 지운다. 단추라 Tab·Enter·Space가 된다.
- [ ] **Step 6: 빈 상태** — 지금 문서·부분에 맞음이 0개(`foldMatch`가 있고 그 part 항목 중 맞음 없음)면 OldPane이 용지 대신 `assign.foldEmpty` + `assign.foldElsewhere` 아래 바로 가기 목록: `listKeys` 줄들을 `documentId`와 부분(그 문서 view의 `buildPaperTabs(view, buildPaperModel(view)).tabOf`)으로 묶어 "문서 코드 · Body/Header/Footer · N". 누르면 `setManualOldDoc(docId)` + `setManualPart`, 저절로 옮기지 않는다.
- [ ] **Step 7: 확인** — vitest·tsc·lint 초록. 스모크(`seed_sop_demo` 직후): Assign 진입 시 `assign-filter-all` 선택·`assign-paper-fold-run-*` 0개; `assign-filter-on_hold`(데모에 보류가 없으면 `unassigned`) 클릭 → `fold-run` 1개 이상·맞음 줄 수 = 필터 수; run 클릭 → `fold-line` 늘고 `fold-head` 생김; line 클릭 → `data-peek` 줄 생김; 그 상태에서 맞음 줄 확정 → 그 줄이 여전히 제 모양(접히지 않음); New 출처 칩으로 필터 밖 Unit 이동 → 그 조각이 보이고 번쩍임(`findOldStrip` 성공). `BASE_URL=http://localhost:3777 node scripts/pw-smoke-sop.mjs` ALL PASS.
- [ ] **Step 8: 설명서** — Assign 필터 문단: 첫 진입 **All**, 필터를 누르면 맞는 문장만 제 모양·앞뒤 한 줄·나머지 묶음, 눌러 펼치기, 같은 필터를 다시 누르면 접힘, 출처 없는 문장 모드는 접지 않음.
- [ ] **Step 9: Commit** `feat(assign): fold the Old paper to the filter, open on All — 필터 접기·첫 진입 All`

---

### Task 8: 도움말 범례

**Files:**
- Modify: `frontend/src/components/split/split-help.tsx` (28–29), `frontend/src/components/assign/assign-help.tsx` (41–48)
- Modify: `frontend/src/lib/i18n-messages.ts` (필요한 범례 글만)

- [ ] **Step 1:** 견본을 새 표시로 — Split: `LangMark ko`·`LangMark en`·`UnitStatusChip on_hold sm`·짝 견본(두 색 막대 `StripLead` 축소판 또는 `.strip-lead-bar` 두 개). Assign: 같은 셋 + 상태 칩 네 개(`UnitStatusChip` md).
- [ ] **Step 2: 확인** — tsc·lint·vitest, `pw-contrast-audit`의 `assign-help-marks` 항목 포함 ALL PASS(라이트·다크).
- [ ] **Step 3: Commit** `feat(help): legends show the new marks — 도움말 범례 새 표시`

---

### Task 9: 감사 · 설명서 그림 · 버전

**Files:**
- Modify: `frontend/public/manual/img/*`, `docs/manual/img/*`(스크립트가 다시 뽑음), `frontend/package.json`·`package-lock.json`(PATCH), `CHANGELOG.md`, `PROGRESS.md`

- [ ] **Step 1: 배치 감사(극단)** — 별도 sqlite에 `reset_db → seed_sop_demo → seed_sop_worst`, backend 8787·frontend 3787, `DS=worst BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs` ALL PASS. 극단에서 8단 번호 말줄임, 두 줄 넘는 짝 막대, 수천 Unit 문서에서 필터 접기(묶음 한 줄)가 깨지지 않는지 `.shots/` 그림으로 확인.
- [ ] **Step 2: 겹침 감사** — `BASE_URL=http://localhost:3777 node scripts/pw-overlap-audit.mjs`, `LONG=1`, `THEMES=light,dark` ALL PASS(보류 칩이 글 첫머리를 덮지 않음, 번호 칸이 막대·조각과 겹치지 않음).
- [ ] **Step 3: 대비 감사** — `node scripts/pw-contrast-audit.mjs` ALL PASS(칩 톤 6가지 + 고른 필터 칩, 번호 칸 `--ink-3`, 접힌 줄 `--ink-4`가 4.5:1에 못 미치면 `--ink-3`으로 올린다).
- [ ] **Step 4: 설명서 그림** — `MANUAL=app BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs` 먼저, 그다음 `node scripts/pw-manual-shots.mjs`(reset_db → seed_sop_demo 직후). 설명서 글과 그림 대조.
- [ ] **Step 5: 버전** — `cd frontend && npm version patch --no-git-tag-version`(0.16.4 → 0.16.5, 푸시 시점 dev가 더 앞서 있으면 그다음), `CHANGELOG.md` Unreleased에 한 줄, `PROGRESS.md` 정리.
- [ ] **Step 6: Commit** `chore(release): vX.Y.Z — paper marks, status chips, filter fold on dev — 용지 표시·상태 칩·필터 접기를 dev에`
