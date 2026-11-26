# 원본 보기 Implementation Plan

> **For agentic workers:** 지휘 세션이 스텝마다 하위 에이전트 하나에게 맡긴다(공통 지침 `~/Documents/sop-orchestration/brief-impl.md`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign Space 시트에 "원본 보기" 탭을 더해 원본 DOCX를 인쇄 미리보기처럼 그리고, 고른 박스의 문단으로 따라간다.

**Architecture:** 서버는 Unit → 원본 블록 경로(`xml_path`)만 알려 주고 원본 파일에 캐시 머리를 단다. 브라우저가 원본 DOCX의 XML에 책갈피 표지를 심은 뒤 `docx-preview`로 그리고, 앱이 쪽을 종이 높이로 나눈다. Space 시트는 탭 두 개(결과 미리보기 · 원본 보기)와 두 번 탁으로 탭을 바꾼다.

**Tech Stack:** FastAPI · SQLAlchemy async · pytest / Next.js 16 · React 19 · vitest(jsdom) · npm `docx-preview` 0.4.1 · `jszip` 3.10.2

**Spec:** `docs/superpowers/specs/2026-11-27-original-view-design.md`(결정 D1~D10, §7 만드는 사람 몫). 실측 참고 구현: `~/Documents/sop-orchestration/original-view-spike/`(`page.html` 표지 심기 · `paginate.js` 쪽 나누기 초안 · `make_dirty.py` 지저분한 합성 문서).

## Global Constraints

- 새 npm 의존성은 **`docx-preview` 0.4.1 · `jszip` 3.10.2 둘만**, 정확한 버전(`^` 없이), `dependencies`에. 사용자가 설계에서 승인했다 — 공통 지침의 "새 의존성 막음"은 스텝 2의 이 둘에만 풀린다. 그리개는 원본 탭을 처음 열 때 `import()`로만 불러온다(첫 화면 번들에 넣지 않는다).
- Alembic · env · 권한 · `raise_rule` 새 코드 · nginx · Docker · CI 변경 없음.
- 새 이펙트는 공용 훅(`frontend/src/lib/use-*.ts`)에만. 화면 파일(`components/**`)의 `effect-baseline.json` 값은 올리지 않는다. 타이머 대신 `animationend` · `transitionend`.
- 원본 글은 그리개가 DOM으로 만든다 — HTML 문자열 끼우기(`dangerouslySetInnerHTML` · `innerHTML =`) 금지. 그린 뒤 `<a href>`는 `http:` · `https:` · `#…`만 남기고 `href`를 지운다.
- 그리개 `<style>`은 원본 칸 컨테이너 안에만, 클래스 접두 `sopa-ov`(그리개 옵션 `className`). 앱 CSS와 섞이지 않는다.
- 색은 토큰만(`source-rules.test.ts` raw hex 금지). 책상 토큰 `--ov-desk`, 칠 `--ov-paint`. **다크 테마에서도 종이는 흰색**(인쇄 모양) — 종이 흰색도 토큰 `--ov-paper`로 두고 다크에서 바꾸지 않는다.
- 탭 기억 키 `sopa.assign.spaceTab`(값 `"result" | "original"`, 처음 `"result"`). 두 번 탁 간격 `DOUBLE_TAP_MS = 300`.
- 움직임(D8): 같은 화면 → 칠만 · 한 화면 남짓 → 부드럽게 0.25초 · 멀면 0.09초 흐림 → 0.14초 밝힘 · 탭 사이 0.14초 겹침 · 처음 그리기 쉬머 → 0.15초 나타남 · 닫힘 0.3초. 꾹 누른 반복 중과 `prefers-reduced-motion`은 바로.
- 문구: 탭 **Result preview / 결과 미리보기**, **Original / 원본 보기**, PDF "PDF 원본은 아직 여기서 보이지 않아요", 파일 없음 "이 문서는 앱에서 만든 문서라 원본 파일이 없어요", 못 찾음 "이 줄은 원본 자리를 못 찾았어요", EMF "미리보기 불가(EMF)" — en · ko 둘 다(`i18n-messages.ts`).
- 원문 글자를 새 응답에 싣지 않는다(위치만). 원본 쪽은 읽기만(D10).

## Review Focus

1. **줄인 경로 · 못 찾은 경로** — 추출기가 500자에서 `/…/`로 줄인 `xml_path`나 그리개와 어긋난 경로: 가장 가까운 상위 요소 → 그 블록의 쪽 → "못 찾음" 안내로 물러나야 하고 그리기는 멈추지 않는다. 시험: 스텝 2 T2-1 `falls back to the nearest ancestor for a shortened path`.
2. **본문 밖 블록** — 머리말 · 꼬리말 · 각주에 걸친 Unit(`xml_path` 머리가 `header1` · `footnotes` …): 그 부분 파일에 표지를 심는다. 시험: T2-1 `plants marks in header parts`.
3. **글상자 두 벌** — `txbx[n]`은 `mc:Choice` 쪽 n번째, 같은 자리 `mc:Fallback` 사본에도 같은 표지. 시험: T2-1 `marks both Choice and Fallback copies of a text box`.
4. **올린 문서 안의 위험한 링크** — `javascript:` · `file:` · `data:` href는 지워지고 글은 남는다. 시험: T2-3 `strips non-http links`.
5. **그리는 중에 바뀐 고름 · 바뀐 문서** — 다 그린 뒤 마지막 고름으로 가고, 문서가 바뀌면 옛 그리기 결과를 쓰지 않는다. 시험: T2-4 `uses the latest pick after rendering` · `drops a stale render when the document changes`(훅을 순수 함수 `pickFollowTarget`로 덜어 시험).

---

## 브랜치 · 차례

모음 `feat/original-view`(워크트리 `../sop-wt-original-view`, 로컬만). 스텝 브랜치는 모음에서 따고, 지휘 세션이 스텝 diff만 검토 · `gate.sh` 뒤 모음에 `--no-ff`로 합친다. 모음이 다 되면 dev에 PATCH 번호로(dev를 합친 뒤 시험 + 고친 화면 스모크 + `FULL=1` 한 번 · 감사 넷).

| 스텝 | 브랜치 · 워크트리 | 모델 | 동시에 | 게이트(지휘 세션) |
|---|---|---|---|---|
| 1 | `feat/original-view-1-places` · `../sop-wt-original-view-1-places` | sonnet | 2와 | `gate.sh <wt> be` |
| 2 | `feat/original-view-2-render` · `../sop-wt-original-view-2-render` | opus | 1과 | `gate.sh <wt> fe build` |
| 3 | `feat/original-view-3-sheet` · `../sop-wt-original-view-3-sheet` | opus | 1 · 2 합친 뒤 | `gate.sh <wt> fe build` + 스모크 `QUIET=1 ONLY="assign: Space preview"` · `ONLY="practice:"` + 화면 확인(한 단 · 양단 · 다크) |

**설계 §6 표와 다르게 나눈 것:** 따라가기 · 움직임(§5.4)은 DOM을 가진 원본 부품 안이 맞아 스텝 2로 옮겼다. 스텝 3은 시트(탭 · 기억 · 두 번 탁 · 한 단/양단 배치 · 고른 Unit 넘기기 · 연습 경로 · 설명서 · 스모크)만. 설계의 "부품 단독 확인은 시험 페이지"는 따로 페이지를 만들지 않고 스텝 3 뒤 실제 시트에서 지휘 세션이 본다(하위 에이전트는 브라우저를 띄우지 않는다).

---

## 스텝 1 — 서버: 원본 자리 조회 + 파일 캐시 머리

### Task 1-1: `GET …/original-places`

**Files:**
- Create: `backend/app/sop/original_places.py`
- Modify: `backend/app/sop/schemas.py`(응답 모델), `backend/app/routers/sop_documents.py`(라우트, `download_document_file` 옆)
- Test: `backend/tests/test_sop_original_places.py`
- Docs: `docs/architecture/api-contract.md`(새 경로 한 절), `backend/CLAUDE.md` · `docs/architecture/backend.md`(새 모듈 한 줄 — 폴더 CLAUDE.md 형식대로)

**Interfaces:**
- Produces (스텝 2가 TS 타입으로 그대로 옮긴다):
  ```
  GET /api/bundles/{bundle_id}/documents/{doc_id}/original-places   (구성원, _require_member)
  200 { "file_format": "docx" | "pdf" | "none",
        "page_basis": str | null,
        "places": [ { "unit_id": int, "blocks": [ { "path": str, "page": int | null } ] } ] }
  ```
  - `file_format`: `DocumentFile` 행이 없으면 `"none"`(앱에서 만든 New · 바이트를 남기지 않은 문서), 있으면 `document.file_format`.
  - `places`: `"docx"`일 때만 채운다. 최신 추출(`get_latest_extraction_id`)의 `status == "active"` Unit을 `(pos_seq, pos_start, id)` 순서로, Unit마다 `spans`(`[블록 id, 시작, 끝]` 목록)의 블록을 범위 순서대로 **처음 나온 것만** 남겨 `SourceBlock.xml_path` · `SourceBlock.page`. 블록이 하나도 없는 Unit은 뺀다. 추출이 없으면 빈 목록.
  - `page_basis`: 그 추출의 `part == "body"`(실제 값은 코드에서 확인) 블록 중 `seq`가 가장 작은 것의 `page_basis`, 없으면 null.
  - 블록은 한 번의 `select`로(Unit마다 조회 금지 — 3천 블록 문서).
- `async def load_original_places(session: AsyncSession, document: Document) -> OriginalPlaces` (`original_places.py`), 응답 모델 `OriginalPlaces` · `OriginalPlace` · `OriginalPlaceBlock`(`schemas.py`).

- [ ] **Step 1: 실패하는 시험** — `test_sop_original_places.py`(기존 `test_sop_upload.py`의 합성 DOCX 올리기 도우미 · `AUTHOR` 머리를 따른다):
  - `test_places_follow_unit_spans_in_order` — 합성 DOCX를 올리고 응답 `file_format == "docx"`, `places`의 `unit_id` 순서가 `/view`의 Unit 순서와 같고, 각 `blocks[0]["path"]`가 그 Unit 첫 범위 블록의 `xml_path`.
  - `test_merged_unit_lists_each_block_once` — 쪼개기 편집으로 두 문단을 합친 Unit(기존 merge API 사용)의 `blocks`가 두 블록 경로, 중복 없음.
  - `test_deleted_units_are_left_out` — 지운 Unit은 `places`에 없다.
  - `test_pdf_has_format_but_no_places` — PDF 문서: `file_format == "pdf"`, `places == []`.
  - `test_document_without_file_is_none` — `DocumentFile` 행이 없는 문서(앱에서 만든 New 또는 행을 지운 문서): `file_format == "none"`, `places == []`.
  - `test_non_member_is_refused` — 구성원 아닌 사용자 403(기존 구성원 시험과 같은 코드).
  - `test_response_has_no_source_text` — 응답 JSON 문자열에 블록 `text`가 들어 있지 않다.
- [ ] **Step 2:** `.../backend/.venv/bin/python -m pytest tests/test_sop_original_places.py -q` → FAIL(404 경로 없음).
- [ ] **Step 3:** 위 Interfaces대로 구현.
- [ ] **Step 4:** 같은 명령 → PASS, `ruff check app/ tests/` 깨끗.
- [ ] **Step 5: Commit** `feat(sop): original places lookup for the original view — 원본 보기용 원본 자리 조회`

### Task 1-2: `GET …/file` 캐시 머리

**Files:**
- Modify: `backend/app/routers/sop_documents.py:1121-1135`(`download_document_file`)
- Test: `backend/tests/test_sop_upload.py`(파일 받기 시험 옆에 더함)
- Docs: `docs/architecture/api-contract.md` 파일 받기 절

**Interfaces:** 응답에 `ETag: "<document.sha256>"`(큰따옴표 포함) · `Cache-Control: private, max-age=86400`. 요청 `If-None-Match`가 그 ETag와 같으면(`W/` 접두 · 쉼표 목록 · `*` 허용) 본문 없이 304 + 같은 두 머리. 304 경로는 `DocumentFile.content`를 읽지 않는다(존재만 가벼운 select로 확인 — 없으면 여전히 404 `file_not_found`).

- [ ] **Step 1: 실패하는 시험** — `test_file_has_cache_headers`(`etag == f'"{sha}"'`, `"max-age=86400" in cache-control`, `"private"`), `test_file_not_modified_when_etag_matches`(같은 ETag로 다시 → 304, 본문 빈 것), `test_file_sent_when_etag_differs`(다른 값 → 200).
- [ ] **Step 2:** `pytest tests/test_sop_upload.py -q -k "cache or etag"` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `pytest tests/test_sop_upload.py tests/test_sop_original_places.py -q` → PASS, ruff 깨끗.
- [ ] **Step 5: Commit** `feat(sop): cache headers on the original file — 원본 파일에 캐시 머리`

---

## 스텝 2 — 화면: 원본 그리기 부품(그리개 · 표지 · 쪽 나누기 · 인쇄 미리보기 · 따라가기)

스텝 1과 동시에 하므로 서버는 위 Interfaces 계약만 믿는다(시험은 가짜 응답).

### Task 2-1: 표지 심기 순수 모델

**Files:**
- Create: `frontend/src/lib/original-place-model.ts`, `frontend/src/lib/original-place-model.test.ts`
- Modify: `frontend/src/lib/api-sop.ts`(타입 `OriginalPlaces` · `OriginalPlace` · `OriginalPlaceBlock`과 `fetchOriginalPlaces(bundleId: number, docId: number): Promise<OriginalPlaces>` — 스텝 1 계약 그대로)

**Interfaces:**
- `MARK_PREFIX = "sopa_"`.
- `type PlaceMark = { id: string; cell: boolean; exact: boolean; page: number | null }` — `id`는 그린 DOM의 요소 id(`sopa_<n>`), 못 찾으면 `id: ""`, `exact: false`.
- `plantPlaceMarks(parts: Record<string, string>, places: readonly OriginalPlace[]): { parts: Record<string, string>; marks: Map<number, PlaceMark[]>; missed: number }`
  - `parts` 키는 `xml_path` 첫 조각(`document`, `header1`, `footnotes` …) = `word/<키>.xml`. 값은 XML 문자열, 돌려주는 것도 문자열(DOMParser · XMLSerializer).
  - 경로 조각 `tag[n]` = 같은 태그(로컬 이름) 형제 중 n번째(0부터 — 추출기 `docx_reader.py`의 경로 만드는 코드로 확인하고 스파이크 `page.html` `resolve`를 따른다). **요소마다 자식 목록을 한 번만 훑어 캐시**(처음 방식은 60배 문서에서 0.5초였다).
  - `txbx[n]` = `mc:Fallback` 밖의 n번째 `w:txbxContent`. 표지는 그 사본과 같은 자리의 `mc:Fallback` 사본 양쪽에(같은 이름 · 다른 id).
  - 표지 자리: `tc`면 칸의 첫 `w:p`, 그 밖은 `w:p`의 `w:pPr` 다음(없으면 첫 자식). `w:bookmarkStart`(`w:name`=`sopa_<n>`, `w:id`=문서 안 기존 `w:id`들의 최댓값보다 큰 수) + 바로 뒤 `w:bookmarkEnd`.
  - 줄인 경로(`/…/` 포함)나 중간에 못 찾은 경로: 그때까지 찾은 가장 깊은 `p` · `tc` 조상에 `exact: false`로, 그것도 없으면 `id: ""`(화면은 `page`로 그 쪽 머리, 없으면 "못 찾음").
  - 같은 경로는 표지 하나를 함께 쓴다.

- [ ] **Step 1: 실패하는 시험**(XML 조각을 시험 안에서 문자열로 만든다):
  - `plants a bookmark at the start of each paragraph` — `document/body/p[1]` → 둘째 `w:p`의 `pPr` 다음에 `bookmarkStart name="sopa_0"`, `marks.get(unitId)[0]` = `{ id: "sopa_0", cell: false, exact: true }`.
  - `marks the first paragraph of a table cell` — `…/tbl[0]/tr[1]/tc[2]` → `cell: true`.
  - `keeps bookmark ids above existing ids` — 문서에 `w:id="900"`이 있으면 새 id > 900.
  - `marks both Choice and Fallback copies of a text box`.
  - `plants marks in header parts` — `header1/p[0]` → `parts.header1`에 표지, `parts.document`는 그대로.
  - `falls back to the nearest ancestor for a shortened path` — `document/body/tbl[0]/…/p[3]` → 표 칸 또는 표 조상, `exact: false`.
  - `reports a missed path` — 없는 `document/body/p[99]` → `id: ""`, `missed === 1`.
  - `shares one mark for repeated paths` — 두 Unit이 같은 경로 → 같은 `id`.
  - `plants 3,000 paths within 200ms` — 문단 3,000개 문서, `performance.now()` 차이 < 200(jsdom 여유값).
- [ ] **Step 2:** `npx vitest run src/lib/original-place-model.test.ts` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 같은 명령 → PASS.
- [ ] **Step 5: Commit** `feat(assign): plant place marks in the source DOCX — 원본 DOCX에 자리 표지 심기`

### Task 2-2: 쪽 나누기 · 따라가기 셈 순수 모델

**Files:**
- Create: `frontend/src/lib/original-page-model.ts`, `frontend/src/lib/original-page-model.test.ts`

**Interfaces:**
- `PAGE_SLACK_PX = 6` — 아래 여백을 이만큼 넘는 것은 넘침으로 보지 않는다(스파이크: 문단 아래 여백 4px 넘침).
- `type FlowBox = { top: number; bottom: number; floating: boolean }` — 본문 아이의 흐름 위치(떠 있는 요소는 `floating: true`, 셈에서 뺀다 — 스파이크의 "글상자 바깥 상자 높이로 너무 일찍 끊김" 고침).
- `planPageBreaks(boxes: readonly FlowBox[], usable: number): number[]` — 새 장을 시작할 아이 번호들(오름차순). 장 첫 아이 `top`을 0으로 다시 재며, `bottom − 장 시작 > usable + PAGE_SLACK_PX`인 첫 아이부터 새 장. 한 장보다 큰 아이 하나는 그 장에 혼자 둔다(다음 아이부터 새 장).
- `planRowBreaks(rowBottoms: readonly number[], firstRoom: number, usable: number): number[]` — 표 줄을 나눌 줄 번호들(첫 장은 `firstRoom`, 다음 장부터 `usable`, 같은 여유값).
- `type FollowMotion = "none" | "smooth" | "fade" | "instant"`
- `readFollowMotion(input: { scrollTop: number; viewHeight: number; targetTop: number; targetBottom: number; repeating: boolean; reduced: boolean }): FollowMotion` — `repeating || reduced` → `"instant"`, 대상이 지금 화면 안 → `"none"`, 대상 가운데까지 거리 ≤ `1.5 × viewHeight` → `"smooth"`, 그 밖 → `"fade"`.
- `pickFollowTarget(input: { renderedDocId: number | null; docId: number; pickedUnitIds: readonly number[]; marks: ReadonlyMap<number, readonly PlaceMark[]> }): { unitId: number; marks: readonly PlaceMark[] } | null` — 그린 문서가 지금 문서가 아니면 null(낡은 그리기 버림), 고른 Unit들 중 표지가 있는 첫 것.

- [ ] **Step 1: 실패하는 시험** — `planPageBreaks`: 높이 100짜리 12개 · usable 400 → `[4, 8]`; 4px 넘침은 같은 장; 떠 있는 상자가 끝을 넘어도 끊지 않음; 900짜리 하나는 혼자 장. `planRowBreaks`: 첫 여유 150 · usable 400 · 줄 높이 50 × 12 → `[3, 11]`. `readFollowMotion` 네 갈래 + 반복 · 줄이기. `pickFollowTarget`: `uses the latest pick after rendering`(고른 것을 바꿔 다시 부르면 마지막 것), `drops a stale render when the document changes`(`renderedDocId !== docId` → null), 표지 없는 Unit은 건너뜀.
- [ ] **Step 2:** `npx vitest run src/lib/original-page-model.test.ts` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(assign): page and follow math for the original view — 원본 보기 쪽 나누기 · 따라가기 셈`

### Task 2-3: 그린 DOM 다듬기(안전 · 쪽 나누기 옮기기 · 쪽 번호 · EMF)

**Files:**
- Create: `frontend/src/components/assign/original-render.ts`(React 없는 DOM 모듈), `frontend/src/components/assign/original-render.test.ts`(jsdom, 손으로 만든 DOM)
- Modify: `frontend/package.json`(`"docx-preview": "0.4.1"`, `"jszip": "3.10.2"` — `npm install --save-exact` 로, `package-lock.json` 함께), `frontend/src/source-rules.test.ts`(허용 목록이 필요하면 사유 한 줄)

**Interfaces:**
- `renderOriginal(file: Blob, parts: Record<string,string>, host: HTMLElement, styleHost: HTMLElement): Promise<void>` — `jszip`로 열어 `word/<키>.xml`을 표지 심은 것으로 바꿔 다시 묶고 `docx-preview`의 `renderAsync`를 `import()`로 불러 그린다. 옵션: `className: "sopa-ov"`, `inWrapper: true`, `breakPages: true`, `ignoreLastRenderedPageBreak: false`, `renderHeaders/renderFooters/renderFootnotes/renderEndnotes: true`, `experimental: false`. 그리기 전에 머리말 · 꼬리말의 PAGE · NUMPAGES 필드 결과를 표지 글자(`⟦PAGE⟧` · `⟦NUMPAGES⟧`)로 바꿔 둔다.
- `readPartsToMark(file: Blob, places: readonly OriginalPlace[]): Promise<Record<string,string>>` — 경로에 나오는 부분 파일만 꺼낸다.
- `stripUnsafeLinks(root: HTMLElement): void` — `href`가 `http:` · `https:` · `#`로 시작하지 않으면 `href` 지움.
- `paginateRendered(root: HTMLElement): number` — `section.sopa-ov`마다 본문(`article`) 아이를 `FlowBox`로 재서 `planPageBreaks`/`planRowBreaks`로 새 장을 만든다(장 얕은 복제 + 머리말 · 꼬리말 깊은 복제, 표는 같은 `colgroup` · 문서가 머리 반복(`w:tblHeader` → 그리개가 `thead`/표시로 남긴 줄)을 켰으면 그 줄 되풀이). 나눈 뒤 쪽 번호 표지를 그 장 번호 · 전체 장 수로 채우고 전체 장 수를 돌려준다. 종이 높이 · 여백은 그린 장의 스타일(문서 값)에서 읽는다.
- `replaceUnrenderable(root: HTMLElement, label: string): number` — `src`가 `image/x-emf` · `image/x-wmf` · `.emf` · `.wmf`인 `img`(그리개가 넣은 blob 형식은 코드에서 확인)를 같은 크기의 빗금 상자 `span.sopa-ov-unrenderable` + `label` 글로 바꾸고 바꾼 수를 돌려준다.

- [ ] **Step 1: 실패하는 시험** — `strips non-http links`(`javascript:alert(1)` · `file:///c` · `data:text/html,…` → href 없음, 글 남음; `https://x` · `#sec` 남음). `paginateRendered`: jsdom에는 배치가 없으니 `offsetTop` · `offsetHeight`를 `Object.defineProperty`로 심은 장 하나(아이 12개 × 100, 종이 높이로 usable 400) → 장 3개, 머리말 · 꼬리말이 장마다, 쪽 번호 표지가 `1`·`2`·`3`과 `3`으로. 표 줄 나누기 → 둘째 장에 같은 `colgroup`과 머리 줄. `replaceUnrenderable`: EMF `img` 둘 → 2, 상자 크기 = 원래 `width`·`height`.
- [ ] **Step 2:** `npx vitest run src/components/assign/original-render.test.ts` → FAIL.
- [ ] **Step 3:** 의존성 설치 + 구현. `package.json`에 왜를 남길 곳이 없으면 `frontend/CLAUDE.md` 의존성 줄(또는 `docs/architecture/frontend.md`)에 "docx-preview · jszip — 원본 보기 브라우저 DOCX 그리기(서버 PDF 변환은 배포 제약으로 불가)".
- [ ] **Step 4:** PASS + `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit** `feat(assign): render, sanitize and paginate the source DOCX — 원본 DOCX 그리기 · 다듬기 · 쪽 나누기`

### Task 2-4: `OriginalView` 부품 + 공용 훅 둘

**Files:**
- Create: `frontend/src/components/assign/original-view.tsx`, `frontend/src/lib/use-original-render.ts`, `frontend/src/lib/use-original-follow.ts`, 시험 `frontend/src/lib/use-original-render.test.ts`(가능한 범위 — 상태 전이를 순수 함수로 덜어 시험해도 된다)
- Modify: `frontend/src/lib/i18n-messages.ts`(이 스텝 문구: 못 보임 셋 · 못 찾음 · EMF · 쪽 칩 `{page} / {total}` · 다시 시도 · 파일 받기), `frontend/src/styles/components.css`(책상 · 종이 그림자 · 틈 · 칠 · 번쩍임 · 흐림 · 쉬머 · 쪽 칩, 토큰 `--ov-desk` · `--ov-paper` · `--ov-paint`을 라이트 · 다크 토큰 자리에), `frontend/CLAUDE.md` · `docs/architecture/frontend.md`(새 부품 · 모델 · 훅 한 줄씩)

**Interfaces:**
- `export function OriginalView(props: { bundleId: number; docId: number; pickedUnitIds: readonly number[]; repeating: boolean; testId: string }): JSX.Element`
  - 상태: 불러오는 중(종이 모양 쉬머) → 그림(0.15초 나타남) | `"pdf"` 안내 + 파일 받기 단추 | `"none"` 안내 | 실패(다시 시도 + 파일 받기).
  - 파일은 기존 `downloadDocumentFile`(`api-manage.ts`), 자리는 `fetchOriginalPlaces`. 받기 단추는 기존 파일 저장 도우미를 쓴다(찾아서).
  - 보기: 회색 책상(`--ov-desk`) 위 종이, 칸 폭에 맞춘 배율(CSS `zoom`, 종이가 칸보다 좁으면 1), 오른쪽 아래 쪽 칩 "3 / 12"(굴릴 때 바뀜, 바뀔 때 살짝 커짐).
  - 칠: `pickFollowTarget`의 표지들 → 요소(`cell`이면 가장 가까운 `td`, 아니면 가장 가까운 `p`) 모두에 `is-ov-picked`, 첫 것을 가운데로(`readFollowMotion` 갈래대로). 도착하면 한 번 번쩍. `exact: false`면 칠은 하되 쪽 칩 옆에 "가까운 자리" 표시 없이 그대로, `id: ""`면 `page` 쪽 머리로 가고 "못 찾음" 줄.
  - testid: `${testId}`(뿌리), `${testId}-page-chip`, 칠한 요소는 클래스 `is-ov-picked`, 장은 `section.sopa-ov`.
- `useOriginalRender(bundleId, docId): { state: "loading" | "ready" | "pdf" | "none" | "error"; host: RefObject<HTMLDivElement>; marks: Map<number, PlaceMark[]>; pageCount: number; renderedDocId: number | null; retry: () => void }` — 이펙트 1. 문서가 바뀌면 그린 것 버리고 새로.
- `useOriginalFollow(input: { host: RefObject<HTMLElement>; scroller: RefObject<HTMLElement>; target: ReturnType<typeof pickFollowTarget>; repeating: boolean }): { page: number }` — 이펙트로 칠 · 굴림 · 흐림(흐림 끝은 `animationend`), 굴릴 때 쪽 번호.

- [ ] **Step 1: 실패하는 시험** — 훅 상태 전이(문서 바뀜 → loading, `"pdf"` 응답 → pdf, 그리기 throw → error, retry → loading)를 순수 리듀서로 덜어 시험.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 화면 파일 `original-view.tsx`에는 이펙트 0.
- [ ] **Step 4:** `npx vitest run --maxWorkers=3` 전체 · `npm run lint` · `npx tsc --noEmit -p tsconfig.json` 통과(`source-rules` · effect 기준선 포함).
- [ ] **Step 5: Commit** `feat(assign): original view component with print-preview pages — 원본 보기 부품(인쇄 미리보기)`

---

## 스텝 3 — Space 시트: 탭 · 기억 · 두 번 탁 · 배치 · 연습 · 설명서 · 스모크

스텝 1 · 2가 모음에 합쳐진 뒤 모음에서 딴다.

### Task 3-1: 시트 상태 기계 · 탭 기억

**Files:**
- Modify: `frontend/src/lib/space-preview-model.ts` · `.test.ts`, `frontend/src/lib/assign-view-prefs.ts` · `.test.ts`

**Interfaces:**
- `DOUBLE_TAP_MS = 300`.
- `SpacePhase`에 `"closing"`. `SpaceEvent`에 `{ type: "closed" }`(닫힘 움직임 끝 — `animationend`).
  - `kept` + 짧은 탁(`up`, 끌지 않음, `< TAP_MS`) → `closing`(지금은 `closed`).
  - `closing` + `down` → `kept`, **탭 바꿈**. `closing` + `closed` · `escape` · `blur` → `closed`.
  - 나머지 전이는 그대로.
- `isTabFlip(prev: SpaceState, next: SpaceState): boolean` — `prev.phase === "closing" && next.phase === "kept"`.
- `isSpaceOpen`은 `closing`도 열림(그리는 중이니), `isSpaceKept`는 `closing` 아님.
- `type SpaceTab = "result" | "original"`, `readSpaceTab(): SpaceTab`(처음 · 모르는 값 `"result"`), `writeSpaceTab(tab: SpaceTab): void` — 키 `sopa.assign.spaceTab`, 저장소 접근은 기존 도우미처럼 try/catch.

- [ ] **Step 1: 실패하는 시험** — `closes through closing after a short tap`, `flips the tab on a second tap while closing`(`isTabFlip` true), `closing ends on animation end`, `escape while closing closes`, `held shows the remembered tab`(상태 기계 밖 — 부품 몫이면 생략하고 3-2에서), `readSpaceTab defaults to result` · `round-trips original` · `ignores unknown values`.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: Commit** `feat(assign): Space sheet closing phase and tab memory — Space 시트 닫힘 단계 · 탭 기억`

### Task 3-2: 시트 머리 탭 · 원본 탭 배치 · 움직임

**Files:**
- Modify: `frontend/src/components/assign/space-preview.tsx`, `frontend/src/styles/components.css`, `frontend/src/lib/i18n-messages.ts`(탭 이름), Space 시트를 부르는 곳(고른 Unit을 넘기려면 — 찾아서)

**Interfaces:**
- 머리: `role="tablist"` 안 탭 둘(`data-testid="space-tab-result"` · `"space-tab-original"`, `aria-selected`), 누르면 바로 바꾸고 `writeSpaceTab`. 탭 단추는 포커스를 가져가지 않는다(`onMouseDown` 기본 막기 — 기존 시트 단추와 같은 방식). 받기 단추는 결과 미리보기 탭에서만. 고른 줄 · 상태 표시는 그대로.
- 두 탭 내용은 `<Activity mode={…}>`로 숨겨 두어(D: 다시 그리지 않음) 탭 사이 0.14초 겹침.
- 원본 탭: 한 단 → 그 문서 `OriginalView` 하나. 양단 → 왼쪽 Old 문서(고른 Old 박스의 Unit들), 오른쪽 New 문서(New 고름의 Unit들), 폭 비율은 `readAssignView().split`(본 화면 세로선) — 시트 안 세로선 없음. testid `space-original-old` · `space-original-new`(한 단은 `space-original`).
- 닫힘: `closing` 동안 시트에 `is-closing`(0.3초 흐려지며 내려감, 줄이기면 투명도만), `onAnimationEnd` → `{type:"closed"}`. `--space-double-tap: 300ms`를 CSS 변수로 넘겨 움직임 길이와 같게.
- 꾹 누르기(`held`)는 기억한 탭으로 연다. 원본을 못 보이는 문서여도 기억은 바꾸지 않는다(D2).
- `repeating`은 J · K 꾹 누름 반복 중 표시(기존 반복 판정이 있으면 그것).

- [ ] **Step 1:** 바뀐 동작에 맞는 기존 시험 고치기(있으면) — 단계 수 유지, 커밋 메시지에 까닭.
- [ ] **Step 2:** 구현. `space-preview.tsx` 이펙트 기준선은 그대로(필요한 이펙트는 공용 훅으로).
- [ ] **Step 3:** `npx vitest run --maxWorkers=3` · lint · tsc 통과.
- [ ] **Step 4: Commit** `feat(assign): Result preview and Original tabs in the Space sheet — Space 시트 결과 미리보기 · 원본 보기 탭`

### Task 3-3: 연습 경로 · 설명서 · 기능 맵 · 스모크

**Files:**
- Modify: `frontend/src/lib/practice/practice-server.ts`(`ROUTES`에 `GET …/original-places` → `{ file_format: "none", page_basis: null, places: [] }`, `PRACTICE_ROUTE_COUNT`를 보는 시험이 있으면 함께), `frontend/public/manual/user-manual.md`(Space 절 글: 탭 둘 · 두 번 탁 · 기억 · 원본 따라가기 · 못 보이는 경우 — 그림은 정식 업데이트 때), `docs/qa/feature-map.md`(Assign Space 줄), `frontend/scripts/smoke/assign.mjs`(Space preview 묶음에 단계 더함)
- Test: `frontend/src/lib/practice-route.test.ts` 등 따라 바뀌는 것, `manual-content.test.ts`

**스모크 단계**(이름 그대로, `assign: Space preview` 묶음 안 — 시드 문서가 합성 DOCX 원본을 가진 것을 먼저 확인):
- `Space sheet: tabs switch between Result preview and Original`
- `Space sheet: a second tap while closing flips the tab`
- `Space sheet: the last tab is remembered after reload`
- `Space sheet: Original paints the picked paragraph`(J로 옮기면 `is-ov-picked`가 따라감)
- `Space sheet: two-pane shows both originals`
- `Space sheet: pages are one paper tall`(장 높이가 서로 같고 내용이 장 밖으로 넘치지 않음 — 한 장보다 큰 덩어리가 없는 시드 기준)
- 연습: `practice: Original tab says the practice document has no source file`(`practice:` 묶음)

- [ ] **Step 1:** 연습 경로 + 시험 → vitest PASS.
- [ ] **Step 2:** 설명서 · 기능 맵 · 스모크 단계(`node --check frontend/scripts/smoke/assign.mjs`). 스모크 실행은 지휘 세션.
- [ ] **Step 3:** 전체 vitest · lint · tsc.
- [ ] **Step 4: Commit** `feat(assign): practice route, manual and smoke steps for the original view — 원본 보기 연습 경로 · 설명서 · 스모크`

---

## 스텝 4 — EMF · WMF 그림 그리기 (사용자 결정 2026-11-27 오후: "인쇄 미리보기처럼" — 빗금 상자만으로는 모자람)

브랜치 `feat/original-view-4-emf` · 워크트리 `../sop-wt-original-view-4-emf`, sonnet, 스텝 3과 동시에(고치는 파일이 겹치지 않는다). 게이트 `gate.sh <wt> fe build`.

### Task 4-1: 메타파일을 SVG로

**Files:**
- Modify: `frontend/src/components/assign/original-render.ts`(`replaceUnrenderable` 앞에 그리기 단계), `frontend/src/components/assign/original-render.test.ts`, `frontend/src/lib/use-original-render.ts`(부르는 자리), `frontend/package.json` · `package-lock.json`(`rtf.js` 3.0.9 정확한 버전), `frontend/CLAUDE.md`(의존성 줄에 왜)
- Docs: 설계 §5.5는 지휘 세션이 합칠 때 고친다

**Interfaces:**
- `renderMetafiles(root: HTMLElement): Promise<{ drawn: number; failed: number }>` — 메타파일 `img`(지금 `METAFILE_SRC_RE`로 고르는 것, `useBase64URL` data 주소)마다 바이트를 풀어 EMF는 `EMFJS.Renderer`, WMF는 `WMFJS.Renderer`로 SVG를 만들어 같은 자리 · 같은 크기(`img`의 width · height · style)의 `span.sopa-ov-metafile` 안에 넣는다. `rtf.js`는 메타파일이 있을 때만 `import()`. 그리개가 throw하거나 빈 SVG면 그대로 두어 다음 `replaceUnrenderable`이 빗금 상자로 바꾼다(실패만 빗금).
- SVG는 그리개가 DOM으로 만든 것을 그대로 붙인다(문자열 끼우기 금지). 붙이기 전에 `<script>` · `foreignObject` · `on*` 속성 · `href`/`xlink:href`가 `data:`·`#`이 아닌 것을 지운다(`sanitizeMetafileSvg(svg: SVGElement): void`).

- [ ] **Step 1: 실패하는 시험** — `draws an EMF image as inline svg`(rtf.js를 vi.mock으로 SVG 돌려주게 — 바깥 그리개라 가짜로), `falls back to the hatch box when the renderer throws`, `keeps the original size`, `sanitizeMetafileSvg strips script, foreignObject, event handlers and external hrefs`, `does not load rtf.js when there is no metafile`.
- [ ] **Step 2–4:** FAIL → 구현 → PASS, 전체 vitest · lint · tsc.
- [ ] **Step 5: Commit** `feat(assign): draw EMF and WMF images in the original view — 원본 보기에서 EMF · WMF 그림 그리기`

## 모음 → dev (지휘 세션)

1. 스텝 3 합친 뒤 모음에서 `gate.sh ../sop-wt-original-view be fe build`, 고친 화면 스모크 `ONLY="assign: Space preview"` · `ONLY="practice:"`, 화면 확인(한 단 · 양단 · 다크 · 좁은 창).
2. `merge.py`로 dev에 PATCH(CHANGELOG 줄은 `## v1.6.44` 제목 아래 줄 목록 맨 위로 손으로), 장부 F11 → 합침, 설계 스냅숏은 준비 커밋에서 지우고 인용 절만 `docs/architecture/decisions.md`로.
3. dev에서 `FULL=1` 스모크 + 감사 넷 한 번(공용 부품 Space 시트) → 준비 커밋을 마지막 번호로 다시 맞춤(배포 메모에 새 npm 의존성 둘) → 사용자 :4444 확인 → main · 태그.
