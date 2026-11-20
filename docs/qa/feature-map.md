# 기능 맵 (에이전트용)

에이전트가 앱을 직접 열어 확인할 때 쓰는 색인이다. **앱이 원본이고 이 맵은 싼 색인이다** — 맵과 화면이 다르면 화면을 믿고 맵을 고친다. 화면을 바꾸는 브랜치는 해당 줄도 같은 커밋에서 고친다(신뢰 기반 계획 스텝 3, `docs/superpowers/plans/2026-11-19-trust-foundation-plan.md`). 사람용 설명은 `frontend/public/manual/user-manual.md`, 띄우는 법·함정 전부는 `docs/lessons/browser-verification.md`.

## 띄우기

- 이미 떠 있는 서버가 있으면 그대로 쓴다(`lsof -i :3777 -i :8777`). 새로 띄우면 backend `:8777`(`AUTH_MODE=dev DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin`), frontend `:3777`(루트 `CLAUDE.md` Commands).
- 자료: `backend/`에서 `scripts.reset_db` → `scripts.seed_sop_demo`(합성 묶음 4 + 지도용 2 + 목차 1). 극단 자료는 따로 sqlite에 `seed_sop_worst`. **DB를 바꾸면 backend를 다시 띄운다**(실행 중 교체는 readonly).
- 사용자: dev 로그인은 localStorage `sopa.devUser`(API는 헤더 `X-Dev-User`). 스모크 기본은 `qa.member`, 권한 차등은 `dev.admin`(sysadmin).
- 화면 하나만 확인: `frontend/`에서 `QUIET=1 ONLY="<머리>" node scripts/pw-smoke-sop.mjs`(첫 단계 `bundle list`는 늘 함께 돈다).
- 스모크 단계는 화면별 파일 `frontend/scripts/smoke/{shell,outputs,documents,order,assign,map}.mjs`에, 공용 도우미와 첫 단계는 `smoke/common.mjs`에 있다. `pw-smoke-sop.mjs`는 그 차례로 부르는 실행기다.

## 화면

| 기능 | 도달 | 조작의 요점 | 알려진 함정 | 스모크 `ONLY` | 설명서 |
|---|---|---|---|---|---|
| 로그인 | `/login` | dev는 계정 목록에서 고른다 | 평문 HTTP 서버에서만 깨지는 코드(`crypto.subtle`·Clipboard)는 localhost에서 재현되지 않는다 — LAN IP로 | (`bundle list`가 겸함) | `#sign-in` |
| Bundle 목록 | `/` | 카드 하나 = 묶음, **New bundle** 한 번에 만들기 | DB가 오염되면 "목록 비어 있음"이 코드 버그처럼 보인다 | `bundle list`, `new bundle in one click` | `#home` |
| Overview · 구성원 | `/bundles/{id}` | 레일의 단계 이동, 제목·설명·구성원 | 구성원 고르기 창 안에 **Add**가 남는지(좁은 폭) | `overview in rail`, `members picker` | `#bundle`, `#members` |
| 1단계 Documents — Old | `/bundles/{id}/documents` | 올리기 창(두 묶음), 줄 펼치기, WI 줄을 SOP 줄에 끌어 상위 바꾸기 | 업로드 파싱은 자식 프로세스 — 최악 문서는 메모리 상한에 걸린다 | `documents:` | `#documents`, `#upload` |
| 1단계 Documents — New | `/bundles/{id}/documents#new-documents` (옛 `/tobe`가 넘긴다) | 문서 적기, 칸과 단계, Excel 가져오기, AI 목록 읽기 | | `new documents:` | `#tobe` |
| 2단계 Assign | `/bundles/{id}/assign` (옛 `/classify`·`/match`가 넘긴다) | Old 원문 = 목록, 옆에 New 원문. 클릭·끌기로 잇기·보내기, 우클릭 메뉴, 표 벗기기, 캡션 자리, 되돌리기 | 상태 · 동작은 `use-assign-page.tsx`의 `useAssignPage()`, 그리기는 `page.tsx` · 위쪽 줄 `assign-bar.tsx` · 결정 칸 `assign-side-panel.tsx` — effect·타이머 기준선 최대 파일. 고른 줄이 되돌리기 뒤 사라진 단위를 붙드는 회귀가 잦았다(v1.1.51). 고름은 누른 박스(Unit) 하나이고 짝의 다른 구성원은 `data-mate` — 줄 전체를 `[data-sel]`로 찾으면 짝을 놓친다, J/K도 박스 하나씩(Pair view만 줄). 삭제로 확정한 줄은 흐린 한 줄 `assign-paper-deleted-u<id>`로 접혀 그 박스의 `assign-paper-piece-<id>` · `-unit-<id>`가 없다 — 그 줄을 누르거나 J/K로 골라 펼친 뒤 찾는다(Confirmed 거르기는 펼친 채). 편집을 누르면 응답 전부터 그 자리 알약(`assign-paper-pending`, `data-kind`)과 박스 `data-pending`이 서고 그 박스만 잠긴다(누름 · 끌기 무시, 표 벗기기는 새 보기를 놓을 때까지) — 다른 박스는 바로 고를 수 있고 Undo/Redo · 일괄은 무엇이든 처리 중이면 꺼진다. 처리 중 박스를 누르려면 `:not([data-pending])`을 기다린다. 짝 카드 안 순서는 고른 박스 왼쪽 손잡이(`assign-paper-grip-<id>`, `data-drag-handle`)로만 끈다 — 손잡이 누름은 박스 전체 끌기가 받지 않는다. 벗긴 표 안에서는 그 손잡이 대신 덩이 안 순서 손잡이(`assign-paper-unwrap-grip-<id>`, 짝 카드는 카드째)가 뜨고, 놓으면 편집 `reorder_unwrapped` · 표 머리 알약 `data-kind="reorder"` — 판단이 걸린 줄도 옮긴다, 시드를 되돌리려면 Undo 두 번(순서 → 벗기기). 이미 쓴 New 표의 칸은 `assign-new-cell-<targetId>`(Old 줄을 고른 동안만 `data-pickable` · 누름 단추 `assign-new-cell-pick-<id>`, 놓기는 `data-drop="cell"`), 칸 칩 `assign-new-src-<cellId>-<unitId>` · 끊기 × `assign-new-src-x-<cellId>-<unitId>`(칸에 올려야 보인다) — 칸은 `written-sentences` 목록에 줄이 없고 표 줄의 `table.cells`에 있다. 번호 칸 창(`assign-paper-num-<id>`를 누름)은 종류 단추 줄 `assign-paper-num-kind-{continuous,bullet-0..2,custom,none}`이 먼저이고 입력 상자 `assign-paper-num-input`은 연속 · 직접 종류에서만 있다 — 고치려면 **1.2.3 Continuous**를 누른 뒤 입력, 점 기호 · **None**은 누르면 바로 저장. 원문과 다르게 고친 번호는 번호 칸 `data-tip`에 `Source <원문>`, 창 아래 `assign-paper-num-note`. 빈 템플릿(엮은 New, **New · from Assign**) 기본 보기는 같은 줄 틀 — 칸 머리 제목 박스 줄 `assign-new-head-<location_key>`(번호 칸 `assign-new-head-num-<key>`, 클릭 배치 자리는 박스 `assign-place-s:<key>`), 줄 상자 `.new-item[data-csec=<칸 키>]`. 기본 보기의 문장 박스는 눌러도 고르지 않는다(Old 줄을 고른 채 놓는 클릭 길을 지킨다 — 고름은 Old 칸에서). 고른 Old 줄에서 온 박스는 `data-sel`과 손잡이 `assign-new-grip-<id>`(끌면 `PUT …/targets/order`, 알림 Undo가 되돌린다 — 이 문서는 클릭 배치 단계가 이미 `manual_order`로 굳혔다), 번호 칸 `assign-new-num-<id>` 창은 C 번호 표시 `assign-new-num-kind-{continuous,bullet-0..2,custom,none}`(custom은 늘 꺼짐, 누르면 바로 저장). 끌기 단계는 같은 DB를 거듭 쓰면 흔들린다 | `assign:` | `#assign` 아래 전부 |
| 문장 다듬기(쪼개기) | `/bundles/{id}/assign?edit={docId}` (옛 `/split?doc=`가 넘긴다) | 한 단 보기에서 경계 옮기기·묶기, 한/영 짝 | 경계 확인 단계는 없다(배정 확정이 곧 확인) | `split rows of a table` | `#split` |
| 3단계 Order | `/bundles/{id}/order` | 줄 덩어리 끌기(순서·깊이·칸 넘기), 번호·글머리 기호 표시 | 좁은 틀 메뉴 단계가 흔들린다. 깊이 규칙은 줄의 최종 표시(번호/글머리)로 정한다 | `order:` | `#order` |
| 4단계 Outputs · 검토 | `/bundles/{id}/outputs` (옛 `/review`가 넘긴다) | 결과물 A·B·C·Excel 미리보기, 의미 확인, 검토 띠 | 헤드리스의 내려받기 이름은 `download` — 시작 여부만 본다. review 단계 셋이 흔들린다 | `outputs`, `review:` | `#outputs` |
| Map(참조 지도) | `/bundles/{id}/map` | List · 지도, 옆 칸의 줄 문장, **Open in Assign** | 구성원이 아닌 Bundle은 코드·수만 온다(비구성원 단계가 흔들린다). transform 걸린 SVG `<g>`는 `locator.click()` 대신 `boundingBox()` 중심 클릭 | `map:` | `#map`, `#map-visibility` |
| 작업 기록 | `/bundles/{id}/history` | 묶음의 사건 목록 | 조회 상한 500 | — | `#history` |
| 계정 · 화면 설정 | `/account`, 사용자 메뉴 | 레이아웃(레일/위 탭)·테마·언어, 첫 페인트 전 적용 | 첫 페인트 전 boot 스크립트와 `ui-prefs`가 같은 값을 써야 한다 | `layout menu`, `dark theme`, `Korean before first paint` | `#settings` |
| 관리 | `/admin` | 역할·권한·AI 연결·HR 동기화 | 권한 차등은 `DEV_ENFORCE_PERMISSIONS=true`에서만 보인다 | `pw-smoke-baseline.mjs` | `#admin` |
| 사용 설명서 | `/manual` | 조각 목차·찾기·읽음 표시 | 글을 바꾸면 `manual-content.test.ts`가 라벨·그림·권한 키를 대조한다 | — | — |

## 감사 (화면 배치)

정식 업데이트 전이나 공용 부품을 고쳤을 때만(루트 `CLAUDE.md`): `pw-layout-audit.mjs`(`DS=worst`), `pw-overlap-audit.mjs`, `pw-contrast-audit.mjs`, 그림은 `pw-manual-shots.mjs`.
