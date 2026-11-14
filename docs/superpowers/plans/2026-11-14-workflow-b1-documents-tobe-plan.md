# 워크플로우 B1 (문서 + 새 문서 목록) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** To-Be 목록을 Documents 화면 아래로 옮겨 레일에서 To-Be 칸을 없애고, 레일 번호를 Documents 1 · Split 2 · Assign 3 · Outputs 4로 맞춘다.

**Architecture:** To-Be 화면의 본문을 컴포넌트 하나(`ToBeSection`)로 옮겨 Documents 화면이 목록 아래에 그린다. 저장 규칙·API·초안 모델(`lib/tobe-draft.ts`)은 그대로다. `/tobe`는 `/documents#new-documents`로 넘긴다.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · vitest · Playwright(시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-11-14-four-step-workflow-design.md` §4.1·§4.2·§7·§11

## Global Constraints

- 저장되는 값과 API는 바꾸지 않는다. backend는 건드리지 않는다.
- To-Be에서 되던 일이 모두 된다: 문서 추가, Excel 템플릿·가져오기, 이미 쓴 문서 올리기, 종류·부모·Equipment SOP, N/A 사유, WI 단계, 저장 안 한 초안 띠와 이탈 가드, 충돌 때 최신 불러오기, EQUIS 표시와 제목 잠금.
- `data-testid`는 그대로 둔다(`tobe-*`). 스모크와 감사 스크립트가 주소만 바꾸면 돌게 한다.
- 주 버튼은 영역당 하나다. Old 영역은 **Upload documents**, New 영역은 **Save**.
- 화면·라벨이 바뀌므로 사용 설명서와 그림을 같은 커밋에서 고친다(`MANUAL=app node scripts/pw-manual-shots.mjs`).
- 문구는 en·ko 한 쌍. 1366 폭에서 가로 넘침이 없다.
- 검사: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`, `npm run build` 경고 0, `pw-smoke-sop.mjs` · `pw-layout-audit.mjs`(DS=worst) · `pw-overlap-audit.mjs`.

## Review Focus

1. 저장하지 않은 To-Be 초안이 있을 때 문서를 올리거나 지워 Documents 목록이 다시 읽혀도 초안이 버려지지 않는다 → Task 2.
2. 문서가 하나도 없는 Bundle에서도 새 문서 목록을 채울 수 있다(지금 To-Be는 문서 없이 열린다) → Task 2.
3. 검토자와 검토 중인 Bundle에서 New 영역이 읽기 전용이다 → Task 2.
4. 옛 주소 `/tobe`의 즐겨찾기와 설명서 링크가 New 영역으로 간다 → Task 3.
5. 좁은 창(1120)에서 두 표가 화면 전체를 옆으로 밀지 않는다 → Task 5.

---

### Task 1: To-Be 본문을 컴포넌트로 옮기기

**Files:** Move `frontend/src/app/bundles/[id]/tobe/page.tsx` → `frontend/src/components/tobe/tobe-section.tsx`

**Interfaces — Produces:** `ToBeSection({ bundleId, documents, onDocumentsChanged })`
- `documents: SopDocument[] | null` — 남은 경계 안내에 쓴다. 자기 fetch(`listDocuments`)를 없앤다.
- `onDocumentsChanged: () => void` — 이미 쓴 문서를 올린 뒤 Documents 목록을 다시 읽게 한다.

- [ ] `git mv`로 옮기고 기본 내보내기를 이름 있는 컴포넌트로 바꾼다. `useParams` 대신 `bundleId` 인자를 쓴다.
- [ ] 화면 제목 줄(`h1.page-title.ul` "To-Be")을 영역 머리로 바꾼다: `h2` **New documents**(ko "New 문서"), `id="new-documents"`, 같은 줄에 지금 단추들. 제목 밑줄(`.ul`)은 화면에 한 번만 쓰므로 뗀다.
- [ ] 바깥 `div.dense.flex.min-h-full`을 `section`으로 바꾼다(높이 채우기 제거).
- [ ] `tsc`가 통과한다.

### Task 2: Documents 화면에 붙이기

**Files:** Modify `frontend/src/app/bundles/[id]/documents/page.tsx`

- [ ] 문서 목록(또는 빈 상태) 아래에 `<ToBeSection bundleId={bundleId} documents={data} onDocumentsChanged={refreshAll} />`.
- [ ] 문서가 없을 때의 빈 상태(`EmptyState`)가 화면을 다 차지하지 않게 높이를 줄여 New 영역이 한 화면 안에 보이게 한다.
- [ ] Old 표가 12줄을 넘으면 접고 "{n} more"로 편다(명세 §7.1). `paper.foldRun`·`paper.foldExpand` 문구를 다시 쓴다.
- [ ] 브라우저에서 확인: 초안이 있는 채로 문서를 올려도 초안이 남는다. 문서 0개 Bundle에서 New 영역이 열린다. 검토자에게 단추가 없다.

### Task 3: 레일과 주소

**Files:** Modify `frontend/src/lib/stages.ts`(+ `stages.test.ts`), `frontend/src/lib/manual.ts`(+ `manual.test.ts`), `frontend/src/lib/page-width.ts`(+ test), `frontend/src/lib/event-kinds.ts`, `frontend/src/lib/i18n-messages.ts`, `frontend/src/app/bundles/[id]/page.tsx`, `frontend/src/app/bundles/[id]/assign/page.tsx`, `frontend/src/app/bundles/[id]/outputs/page.tsx`, `frontend/src/components/stage-nav.tsx` · Create `frontend/src/app/bundles/[id]/tobe/page.tsx`(넘기기, `classify/page.tsx`와 같은 모양)

- [ ] `StageKey`에서 `"tobe"`를 뺀다. `STAGES`: documents `step: 1`, split `step: 2`, assign `step: 3`, outputs `step: 4`. 번호가 붙으므로 `STAGE_ICONS.documents`를 뺀다.
- [ ] `NEXT_ACTION_STAGE.fill_tobe` → `"documents"`. Overview의 그 다음 할 일은 `/documents#new-documents`로 간다.
- [ ] `getStageHref(bundleId, "tobe")`를 쓰는 두 곳(Assign 빈 New 칸의 **Go to To-Be**, Outputs의 To-Be 링크)을 `/documents#new-documents`로 바꾼다. 도우미 `getNewDocumentsHref(bundleId)`를 `stages.ts`에 둔다.
- [ ] `MANUAL_STAGE_SECTION`에서 `tobe`를 빼고 `documents`가 설명서의 `documents` 조각을 가리키게 둔다. `tobe` 조각은 단계 없는 조각으로 남는다(`getSectionStage("tobe")`는 `null`).
- [ ] `stage.tobe` 문구를 지우고 `documents.newTitle`(en "New documents", ko "New 문서")을 더한다.
- [ ] `/tobe` 넘기기 화면. 시험: `parseBundlePath("/bundles/12/tobe/")`의 stage는 `null`.

### Task 4: 사용 설명서

**Files:** Modify `frontend/public/manual/user-manual.md`, `frontend/public/manual/img/*`

- [ ] 조각 번호: Documents가 1단계, Split 2단계, Assign 3단계, Outputs 4단계. "2단계 To-Be" 조각은 Documents 아래의 "새 문서 목록" 조각으로 옮기고 id `tobe`와 하위 id는 그대로 둔다(도움말 링크·다른 조각의 링크가 산다).
- [ ] "한눈에 보기 › 일의 흐름"의 단계 그림과 글을 네 단계로.
- [ ] 그림을 다시 뽑는다. `manual-content.test.ts`가 통과한다.

### Task 5: 검증 스크립트와 릴리스

**Files:** Modify `frontend/scripts/pw-smoke-sop.mjs`, `pw-layout-audit.mjs`, `pw-overlap-audit.mjs`, `pw-manual-shots.mjs`, `docs/manual/system-walkthrough.html`(단계 이름), `CHANGELOG.md`, `PROGRESS.md`, `frontend/package.json`

- [ ] 스크립트의 `/tobe` 주소를 `/documents`로, `stage-nav-tobe` 확인을 "문서 없는 Bundle에서 Documents의 New 영역이 열린다"로 바꾼다. 이탈 가드 확인은 `/documents`에서 한다.
- [ ] 세 스크립트를 돌린다. 걸음 수(화면 전환·입력)를 스모크에서 세어 v1.0.1 값과 함께 PROGRESS에 적는다(명세 §10).
- [ ] 버전 PATCH(v1.0.2), CHANGELOG, PROGRESS. `dev`에 머지.
