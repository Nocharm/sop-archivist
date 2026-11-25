# frontend/CLAUDE.md

frontend(Next.js) 세부 구조와 frontend에만 걸리는 체크리스트. 루트 [`CLAUDE.md`](../CLAUDE.md)에서 그대로 옮겨 왔고 이 폴더의 파일을 읽을 때 실린다. 프로젝트 개요·명령·배포 제약·규칙(`rules/`)·양쪽에 걸친 체크리스트(권한·env·거절 코드 문구)는 루트에 있다.
경로 표기는 루트에 있을 때 그대로다 — `src/…`·`public/…`·`app/…` 라우트·`scripts/pw-*.mjs`는 `frontend/` 아래, `docs/…`·`rules/…`는 저장소 루트. 화면이나 검증 스크립트를 건드리기 전에 `docs/lessons/`도 먼저 읽는다(루트 Lessons).

**상세는 [`docs/architecture/frontend.md`](../docs/architecture/frontend.md)에 있다**(부품·모델·화면 목록, 아래 "→ N"은 그 문서의 절 번호). 이 파일은 고치기 전에 알아야 할 자리와 금지 규칙만 싣는다. 화면·부품을 고치기 전에 그 절을 읽고, 구조를 바꾸면 두 파일을 같은 커밋에서 고친다.

## 핵심 구조

- **공통 lib**: `src/lib/api.ts` `apiFetch`, `api-errors.ts` `humanizeApiError`(서버 원문은 422 검증 사유에만), `keycloak-login.ts` OIDC 설정 단일 소스(PKCE는 `crypto.subtle`이 있을 때만), `genId()`·`copyText()`(secure context 우회). localStorage 키 접두는 `sopa.`. → 1
- **화면 규칙은 순수 모델에 두고 시험한다**(`paper-model`·`classify-model`·`assign-model` 등, API는 `api-sop.ts`). → 2
  - 용지 `content-visibility`는 덩어리에 한 겹만 — 줄에도 걸면 스크롤 고정이 놓친다. 덩어리 `deps`에 글쇠마다 새 값이 되는 것을 통째로 넣지 않는다(`readChunk…`로 그 안의 것만). `tobe-draft`는 단계 번호를 다시 매기지 않는다.
  - `classify-model` `buildRows`의 줄은 서버 진행 숫자·검토 조건과 같은 규칙이다(`backend/CLAUDE.md` 줄 기준 숫자). 한/영 짝 줄을 한 언어만 이을 때 남는 Unit은 확정 저장에서 빼고(`listLinkLeftovers` — 실으면 422 `hold_required`) `release_unit_ids`로 보낸다.
- **숨긴 기능(`lib/drafting.ts`)**: 새 문서를 만드는 쪽은 지우지 않고 `isDraftingOn()` · `useDraftingOn()`(서버 렌더 · 하이드레이션 중 null, `=== true`로 읽는다) 하나로 숨긴다. 운영 빌드에는 켜는 길이 없고 개발은 `localStorage sopa.drafting="1"`. 숨긴 기능의 스모크는 `runStep(…, { drafting: true }, …)`. → 2
- **Assign** `app/bundles/[id]/assign`: 상태·데이터·동작은 `use-assign-page.tsx` `useAssignPage()`, `page.tsx`는 그리기. 고름·처리 중·따라가기는 `lib/assign-focus-model.ts` + `lib/use-assign-focus.ts` 한 곳. 쓰기는 모두 `use-command-queue.ts` `enqueue` 한 줄로(순수 모델 `lib/command-queue.ts`) — 화면에서 API 쓰기를 바로 부르지 않고, 보내기는 누른 때의 값이 아니라 `liveRef`(나갈 때의 값)와 `lib/write-log.ts`의 revision으로. → 3
- **UI 규칙(디자인 기초 문서)**: raw hex는 `src/styles/tokens.css` 밖에서 쓰지 않고, 다크는 토큰만 바꾸며 화면 코드가 테마로 분기하지 않고, 상태 표기는 화면 언어와 상관없이 영어다. → 5
- **이동**: 앱 안 이동은 `lib/nav-buffer.ts` `navigate()` — 사람이 고른 이동에 `router.push`를 새로 쓰지 않는다(`useLeaveGuard`도 이 길에 걸려 있다). → 6
- **움직임·끌기는 새로 짜지 않는다**: `components/ui/motion.tsx`(접기·쉬머·`useFlip`·`useUnwrapMotion`), `lib/use-progressive-list.ts`, 보조 단추 `.row-actions`, 상자 끌기 `lib/box-drag.ts`·`use-box-drag.ts`(놓기 규칙은 화면마다 순수 모델). → 6·7
- **결과물 C**: 화면에 먼저 얹고(`lib/c-edit-model.ts`) 저장은 `lib/c-save-queue.ts`로 하나씩. `section-number.ts` `numberLines`는 backend `outputs.number_lines`의 사본이라 함께 고친다(저장 응답이 이긴다). → 8
- **Markdown 보기는 `components/ui/markdown-view.tsx` 하나** — 원문 HTML을 그대로 넣는 길을 새로 만들지 않는다. 관리 API는 `lib/api-manage.ts`. → 9
- **목록·값 고르기**: 읽기 목록 `DataList`, 값 고르기 `Select`(기본 `<select>`를 새로 쓰지 않는다), 고르거나 입력 `Combobox`. 본문 폭은 `--page-max`·`--page-max-wide`(`AppShell` `.page-wrap`). → 10·11
- **화면 공통 부품**: 브라우저 기본 모양(체크박스·라디오·`title` 툴팁)을 쓰지 않는다 — `Checkbox`·`Tooltip`·`InfoTip`. 아이콘만 있는 표시는 호버·포커스에 툴팁, 수가 많으면 `useDelegatedTip`. 삭제류 `MorphButton`, 빈 화면 `EmptyState`, 알림 `toast.tsx`. → 12
  - 창은 `Modal`의 `size`(`sm`·`md`·`lg`·`xl`·`sheet`)로 폭을 고른다 — 새 창에 임의 폭 클래스를 쓰지 않는다.
  - 사람 고르기 `lib/people-order.ts`는 부서명으로 찾지 않는다. 도메인 용어 Bundle·Old·New·Unit은 화면 언어와 상관없이 영어(산출물 문구는 제외).
- **사용 설명서(`/manual`)**: 글은 `frontend/public/manual/user-manual.md` 한 벌, `##`·`###`마다 자리 이름 `{#id}`가 있어야 한다. `lib/manual-files.ts`(node:fs)는 브라우저 쪽 코드가 가져오지 않는다. 뷰어가 그리지 않는 문법은 `manual-content.test.ts`가 잡는다. → 13
- **포커스 테두리**: 전역 `:focus-visible`(`base.css` `@layer base`)을 끄는 곳은 자기 포커스 표시를 반드시 그린다(레이어 밖으로 다시 빼지 않는다). → 14
- **Map** `app/bundles/[id]/map/page.tsx` + `components/map/`: 읽기 전용, 서버가 준 것만 그린다(남의 Bundle은 코드만). → 15

## 체크리스트 — 같이 움직여야 하는 곳

- **effect·타이머 예산(사용자 결정 2026-11-19):** `useEffect`·`useLayoutEffect`·`setTimeout`·`setInterval`·`requestAnimationFrame`은 공용 훅(`src/lib/use-*.ts`)과 `effect-baseline.json`에 적힌 파일에만 있다 — ESLint가 새 파일을 막고 `src/source-rules.test.ts`가 파일별 개수가 늘지 않게(줄면 기준선을 낮추게) 본다. 기준선을 올리는 것은 사용자 승인. 줄였으면 `UPDATE_EFFECT_BASELINE=1 npx vitest run src/source-rules.test.ts`.
- **한 길 규칙(사용자 결정 2026-11-19):** raw hex · 기본 `<select>` · `router.push` · 기본 체크박스 · `dangerouslySetInnerHTML` · `title` 툴팁은 공용 부품 한 곳에만 — `src/source-rules.test.ts` "one path per concern"이 본다(허용 목록에 사유). 서버 규칙의 사본(`section-number`·`number-model`·`caption-slot-model`)은 `src/lib/rule-cases.test.ts`가 백엔드가 뽑은 사례로 대조한다.
- **기능 맵:** 화면의 주소·조작·함정·스모크 머리가 바뀌면 `docs/qa/feature-map.md`의 그 줄도 같은 커밋에서 고친다(에이전트가 앱을 열 때 보는 색인).
- **프런트 텍스트:** en·ko 메시지를 한 쌍으로 추가한다(`i18n-messages.test.ts`가 키 집합을 가드). 인터랙티브 요소에는 `data-testid`(`rules/frontend/identifiers.md`).
- **화면·동작·라벨을 바꾸면 사용 설명서의 글도 같은 커밋에서, 그림은 정식 업데이트 준비 때(사용자 결정 2026-11-15):** `frontend/public/manual/user-manual.md`의 해당 조각을 고친다.
  - 그림은 `dev`에 올릴 때마다 다시 뽑지 않고 `dev`→`main` 정식 업데이트 준비 때 그 묶음에서 바뀐 화면의 장면만 뽑는다(`MANUAL=app ONLY=<장면,…> node scripts/pw-manual-shots.mjs`, 장면 이름은 스크립트의 `SCENES`, 루트 Commands. 전부는 공용 부품·테마처럼 모든 화면이 바뀌었을 때만) — 새 그림이 필요한 조각은 그때까지 글로만 적고, 그림 줄(`![…](img/…)`)과 찍는 장면은 정식 업데이트 때 더한다(없는 그림을 가리키면 아래 시험이 실패한다).
  - 설명서는 화면 라벨을 영어 화면 글자 그대로 **굵게** 적는다 — `manual-content.test.ts`가 굵은 영어 글자를 en 문구 사전과 대조하고(라벨을 바꾸면 여기서 걸린다), 권한 키 전부·그림 빠짐과 남음·도움말이 여는 조각·바깥 주소와 IP 없음을 본다.
- **문단 번호 칸(표 풀기·표준화 명세 F5):** 번호 칸의 값과 내용 경계는 서버가 정해 보낸다(문서 보기 `units[].number`, 단위 목록 `content_start`) — 화면은 읽기만 하고 다시 정하지 않는다. 따라 고치기 미리 보기 `planFollow`는 서버 `numbering.plan_follow`의 사본이라 함께 고친다. 용지·번호 칸 부품은 → 16

## 규칙 — frontend에서 불러오는 것

아래 규칙은 루트에서 세션마다 싣지 않고 이 폴더를 다룰 때만 실린다(2026-11-14 문맥 정리).

@../rules/languages/typescript.md
@../rules/frontend/identifiers.md
