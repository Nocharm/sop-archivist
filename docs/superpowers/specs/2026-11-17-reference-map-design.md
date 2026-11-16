# 참조 지도 설계 — Map 레일 · 문서 사이 참조와 후속 문서 · 남의 Bundle은 요약만

2026-11-17. 사용자가 정한 것은 날짜와 함께, 내가 정한 것은 "내 판단"으로 적는다. 직접 눌러 보는 시안은 비공개 디자인 세션 산출물이라 저장소에 두지 않는다. 번호·이름 예시는 모두 지어낸 값이다. 조사 기준은 `feat/assign-drag-send` `9b1551b`(v1.1.6 위)다.

2026-11-16에 정한 세 설계 가운데 셋째다(첫째 `2026-11-16-drag-and-drop-design.md`, 둘째 Documents 화면 고치기). 이 문서는 사용자 검토 없이 바로 구현 계획으로 넘어간다 — 열린 결정마다 추천안을 골라 "내 판단"으로 적었으니 뒤집을 것은 그 표시를 찾아 고친다. 이 문서의 `docs/README.md` 인덱스 줄은 1걸음 커밋에서 더한다(쓴 세션은 파일 하나만 만들었다).

## 1. 왜

- Old 문서의 REF 줄은 **옛 문서 번호**를 가리킨다. 그 문서가 다른 Bundle에서 재구성되고 있으면 새 문서에는 **새 번호**를 적어야 한다. 지금은 그 번호를 알려면 그 Bundle 담당자에게 물어야 한다. Bundle 내용은 멤버만 보기 때문이다(제품 명세 §9).
- 반대 방향도 같다. 내 문서 번호가 바뀌면 내 문서를 가리키는 다른 Bundle이 고쳐야 하는데, 누가 가리키는지 볼 길이 없다.
- **Moved to another document**로 보낸 줄은 대상 문서 번호만 남는다(제품 명세 §6.6 "다른 묶음의 결과물에 자동으로 넣지 않는다"). 그 번호의 문서를 누가 만들고 있는지, 있기는 한지 화면에서 알 수 없다.
- 아무 Bundle도 맡지 않은 문서를 가리키는 줄은 어디에도 드러나지 않는다.

지도가 답하는 물음은 넷이다. (1) 내 문서가 가리키는 문서는 무엇으로 바뀌나 (2) 누가 내 문서를 가리키나 (3) 내가 보낸 줄의 대상 문서는 어느 Bundle에 있나 (4) 가리켜지는데 아무도 맡지 않은 문서는 무엇인가.

사용자 결정(2026-11-16): **모든 Bundle의 문서 번호·제목·상태·후속 문서는 누구나 보고, 문장은 그 Bundle 구성원만 본다. 남의 작업은 중립 색 `--peer-*`. 레일 항목 이름은 "Map". 지도는 Bundle 안의 레일 항목에 둔다.**

## 2. 목표 · 비목표 · 반목표

**목표**

1. Bundle 안의 새 화면 `/bundles/{id}/map`. 이 Bundle의 Old 문서, 그 문서가 가리키는 문서, 그 문서를 가리키는 문서를 한 장에 보인다.
2. 문서마다 **후속 문서**(그 문서가 바뀌는 New 문서 번호)를 보인다. 남의 Bundle 것도 보인다.
3. 선 세 가지 — 확인한 참조, 확인 전 참조(REF?), Moved to. 색만으로 가르지 않고 선 모양을 함께 쓴다.
4. 남의 Bundle은 요약(번호·제목·상태·후속 문서·선의 줄 수)만, 문장은 구성원에게만. **서버 응답에서부터** 가른다.
5. 문서가 수백 개여도 쓸 수 있다 — 기본은 이 Bundle과 이어진 것만, 찾기와 List가 같은 자료를 글자로 준다.
6. 새 의존성 없이 그린다. 새 권한 키·새 env·스키마 변경 없이 만든다.

**비목표** (이번에 하지 않는다)

- 지도에서 고치기. 번호 확인(`set_ref`), 새 문장 고치기, 보낼 곳 바꾸기는 Assign에서 한다. 지도는 읽기만 하고 아무것도 쓰지 않는다(작업 기록도 남기지 않는다).
- 이미 쓴 New 문서(`side = "new"`)의 참조 줄을 선으로 그리기. 그 줄의 번호가 옛 번호인지는 지금 EQUIS 표시(`#assign-ref`)가 본다. 지도의 후속 문서와 견주어 "옛 번호를 적었다"고 알리는 일은 다음 일이다.
- EQUIS 표시. 지도는 EQUIS를 읽지도 조회를 걸지도 않는다.
- 마디를 끌어 옮기기, 배치 저장, 그림 내보내기(PNG·Excel).
- Bundle 밖의 전역 지도(`/map`)와 Bundle이 하나도 없는 사람의 열람(12절).
- 담당 부서·담당자 표시(12절).
- 터치의 두 손가락 확대. 터치에서는 스크롤과 단추만 쓴다.

**반목표** (되면 실패)

- 구성원이 아닌 Bundle의 **문장 한 글자라도** 응답에 실린다 — Unit 글, Unit 표시 ID·id, 사유(Remark·hold 사유), 새 문장, 파일 이름, 설명. 화면에서 가리는 것으로는 부족하다.
- 남의 Bundle의 **AI 제안 상태**가 드러난다. 지도가 말하는 후속 문서와 Moved to는 사람이 확정한 것뿐이다.
- 자유 입력 칸(Moved to 대상 코드)에 적힌 번호 아닌 글이 남에게 번호처럼 보인다.
- 구성원 이름·부서, 진행 숫자, 문서 판(version)이 지도를 통해 구성원 아닌 사람에게 나간다(사용자가 연 것은 번호·제목·상태·후속 문서 넷이다).
- 합성 Bundle과 실제 Bundle이 한 지도에 섞인다.
- 지도 자료가 AI 페이로드에 실린다. 지도는 AI를 부르지 않는다.
- 지도 한 번 여는 것이 다른 Bundle의 저장을 기다리게 한다(잠금), 또는 Bundle 수에 비례해 질의가 늘어난다.
- 색만으로 내 것·남의 것·확인 전을 가른다. 선과 마디가 서로를 덮어 번호를 읽을 수 없다.

## 3. 조사로 확인한 것

**이미 있는 것 — 지도의 재료**

- **Old 문서**: `documents`(`backend/app/sop/models.py` `Document`) — `bundle_id`, `side`(`old`|`new`), `doc_code`(자유 입력, 100자), `title`, `status`(`ready`|`rejected`|`failed`). 단위는 문서의 **가장 새 추출**만 본다(`snapshot._select_latest_extractions`, `units.get_latest_extraction_id`).
- **참조 줄**: `Unit.lang == "ref"`가 확정 참조이고, 사람이 확인한 번호는 `unit_refs`(`UnitRef.state` `confirmed`|`rejected`, `number`)에 있다. **제안은 저장하지 않는다** — 줄이 문서 번호로 시작하면 읽을 때 제안한다. 판정은 `refs.read_ref_state(unit, mark)` 한 곳이다(`backend/app/sop/refs.py`, 설계 `2026-11-15-ref-paragraph-design.md` §2). 화면의 `REF?`는 이 `proposed` 상태다(`components/paper/lang-token.tsx`, 색 `--lang-ref-ink`).
- **Moved to**: `UnitDecision.disposition == "move_external"`과 `move_target_code`(자유 입력, 100자, 필수). 입력 칸(`components/assign/move-target-field.tsx`)은 **내가 구성원인** 다른 Bundle의 New 문서 번호를 추천한다(`remarks.list_move_targets` — "보이는 범위는 묶음 목록과 같은 멤버십이다").
- **New 문서**: `target_docs`(`TargetDoc.code`, `title`, `doc_type` `sop`|`wi`). 번호 없이 올린 New 문서는 임시 번호 `NEW-<id>`를 쓴다(`tobe.temp_match_code`).
- **Old → New**: 새 문장의 출처 `target_sources`(`TargetSource.unit_id` → `TargetSentence.target_doc_id`). 결과물 B(`outputs.build_output_b`)가 같은 관계를 한 Bundle 안에서 줄 수로 센다. B는 AI 제안 상태의 배정도 센다(`_get_row_disposition`은 상태를 보지 않는다).
- **번호 맞추기**: `equis.rules.normalize_number`(앞뒤 빈칸 떼고 대문자). DB 쪽 같은 비교는 `routers/sop_equis.py` `_is_number_in_bundle`의 `func.upper(func.trim(Document.doc_code))`.
- **Bundle 상태**: `Bundle.status` `in_progress`|`in_review`|`done`, 표시는 `components/status.tsx` `BundleStatusPill`(In progress · In review · Review complete). 합성 표시 `Bundle.is_synthetic`.
- **접근**: 권한 키는 `backend/app/access/catalog.py` `PERMISSIONS` 일곱 개(`permission.manage`·`directory.sync`·`ai.admin`·`system.view`·`bundle.create`·`bundle.admin`·`guideline.manage`). Bundle 내용은 권한이 아니라 멤버십이 정한다 — `membership.require_bundle_role(*roles)`가 계정 활성(403 `inactive_account`) → 멤버(404 `bundle_not_found`) → 역할(403 `role_required`) 순으로 보고, sysadmin도 예외가 아니다. `bundle.admin`은 모든 Bundle의 메타(제목·상태·멤버·진행 숫자)만 본다(`routers/sop_admin.py`).
- **레일**: `frontend/src/lib/stages.ts` `STAGES`(overview · documents · assign · order · outputs · history)와 `components/stage-nav.tsx`. 번호 없는 항목은 `STAGE_ICONS`의 아이콘을 쓴다. `lib/manual.ts` `MANUAL_STAGE_SECTION`이 `Record<StageKey, string>`이라 **단계를 더하면 설명서 조각도 같은 커밋에 있어야** 한다. 본문 폭은 `lib/page-width.ts`.
- **선을 라이브러리 없이 그리는 본보기**: `components/assign/link-lines.tsx` — SVG 하나, 강조는 React 상태가 아니라 DOM 속성.
- **이 앱에는 그래프 라이브러리가 없다.** frontend 의존성은 lucide-react·next·oidc-client-ts·react·react-dom·react-oidc-context뿐이다.

**아직 없는 것**

- Bundle을 넘는 읽기. 지금 묶음을 넘는 조회는 내 Bundle 목록(`GET /api/bundles`), 관리 목록(`GET /api/admin/bundles`, `bundle.admin`), Moved to 추천(`GET …/move-targets`, 내가 구성원인 Bundle만) 셋이고, **구성원이 아닌 Bundle의 문서 번호를 주는 길은 없다.**
- 문서 번호에서 문서를 찾는 색인. `documents.doc_code`·`target_docs.code`·`unit_refs.number`·`units.lang`에 색인이 없다.
- `--peer-*` 토큰(`frontend/src/styles/tokens.css`에 없다).
- Assign을 Unit 하나로 여는 주소. 지금은 문서를 한 단으로 여는 `?edit=<문서 id>`뿐이다(`stages.ts` `EDIT_ORIGINAL_PARAM`).
- 시드에 Bundle 사이 참조가 없다(`scripts/seed_sop_demo.py`·`seed_sop_worst.py`).

**bpm에서 가져온 것**(시안): 남의 것은 몸통을 조용히 두고 왼쪽 막대로만 가르기, 색과 선 모양을 함께 쓰기, 마디를 누르면 옆 칸에 내용. 하나는 반대로 배웠다 — 다른 자료에 딸려 나가는 참조 메타는 권한 판정을 건너뛰기 쉽다. 그래서 5절의 규칙을 화면이 아니라 질의에 넣는다.

## 4. 지도의 뜻 — 마디, 선, 후속 문서

**줄기(lane)는 Bundle 하나다.** 마지막에 "Not in any Bundle" 줄기가 하나 더 있다.

**마디는 문서다.** 세 종류이고 id는 결과물 B의 `FlowNode.id`와 같은 꼴을 쓴다.

| 종류 | id | 무엇 | 언제 그리나 |
|---|---|---|---|
| `old` | `old:<document id>` | Old 문서(`side = "old"`, `status = "ready"`) | 이 Bundle 것은 늘, 남의 것은 선이 닿을 때(범위 `all`이면 모두) |
| `target` | `target:<target doc id>` | New 문서(`target_docs`) | **선이 가리킬 때만**(내 판단 — 후속 문서는 Old 마디의 꼬리표로 이미 보인다) |
| `num` | `num:<번호>` | 어느 Bundle에도 없는 번호 | 선이 가리킬 때만 |

- 번호 없는 Old 문서(`doc_code == ""`)도 마디다. 번호 자리에 **No number**를 적고, 가리켜질 수 없다.
- `rejected`·`failed` 문서와 `side = "new"` 문서는 마디가 아니다.

**선은 "이 문서의 줄이 저 번호를 가리킨다"이다.** 같은 (출발 문서, 도착 마디, 종류, 상태)는 선 하나로 묶고 줄 수를 싣는다.

| 종류 · 상태 | 근거 | 모양 |
|---|---|---|
| `ref` · `confirmed` | 활성 Unit이 `lang == "ref"`, 번호는 `read_ref_state` | 실선 |
| `ref` · `proposed` | `read_ref_state`가 `proposed`(줄이 문서 번호로 시작하고 "참조 아님" 표시가 없다) | 짧은 점선(화면의 `REF?`) |
| `moved` · `confirmed` | `UnitDecision.disposition == "move_external"`이고 `status == "confirmed"` | 긴 점선(9 3 2 3) |

- 참조 판정은 `refs.read_ref_state`를 **그대로 부른다**(내 판단). 지도에 둘째 구현을 두지 않는다 — `backend/CLAUDE.md`의 "규칙은 한 곳에만".
- **AI가 제안한 Moved to는 선이 아니다.** 제품 명세 §7.8대로 AI는 이동을 제안하지 않지만, 상태로도 한 번 더 막는다(`confirmed`만).
- **확인 전 참조(`proposed`)는 한쪽 끝이 이 Bundle일 때만 계산한다**(내 판단). 남의 Bundle 둘 사이의 추측은 보는 사람이 할 일이 없고, 모든 Bundle의 Unit 글을 훑어야 해서 비싸다(7절).
- 자기 자신을 가리키는 줄은 선이 아니다. 같은 Bundle 안의 다른 문서를 가리키는 줄은 선이다(줄기 오른쪽으로 도는 고리).
- 줄 수: 참조 줄은 한/영 짝이 없어 Unit 하나가 한 줄이다. Moved to는 확정 짝이면 한 줄로 센다(진행 숫자와 같은 줄 규칙 — `backend/CLAUDE.md` "줄 기준 숫자").

**번호를 마디에 잇는 순서**(`normalize_number`로 맞춘 번호 N, 내 판단)

1. `ref` 선: `upper(trim(doc_code)) == N`인 Old 문서 → 없으면 `upper(trim(code)) == N`인 New 문서 → 없으면 `num:N`. Old 문서의 참조 줄은 옛 번호를 적으므로 Old가 먼저다.
2. `moved` 선: New 문서 → 없으면 Old 문서 → 없으면 `num:N`. Moved to는 새 문서 번호를 적는 칸이라 New가 먼저다.
3. 같은 번호가 여러 Bundle에 있으면 그 마디마다 선을 긋는다(같은 Old SOP를 두 Bundle이 올린 경우. 드물지만 숨기지 않는다 — 두 Bundle이 같은 문서를 따로 재구성하고 있다는 신호다).
4. `moved`의 대상 코드가 어느 마디와도 맞지 않고 **문서 번호 꼴도 아니면 그 선은 버린다**(내 판단). 자유 입력 칸이라 번호가 아닌 글이 들어 있을 수 있고, 그 글이 남에게 번호처럼 보이면 안 된다(2절 반목표). 번호 꼴은 참조 줄 제안과 같은 규칙(`refs.py`의 번호 꼴)이다 — `equis.client.is_sendable_number`는 빈칸과 낱말을 받아 이 용도로는 느슨하다. 누가 보든 같은 규칙이다.

**후속 문서(Becomes)**: Old 문서 D의 후속 문서는, **확정된**(`TargetSentence.status == "confirmed"`) 새 문장 가운데 출처(`target_sources`)가 D의 가장 새 추출의 활성 Unit인 것이 하나라도 있는 New 문서다(내 판단).

- 결과물 B와 **다른 규칙**이다. B는 AI 제안까지 센다. 지도는 남이 믿고 번호를 옮겨 적는 자료라 사람이 확정한 것만 말한다. 이 Bundle 자신에게도 같은 규칙을 쓴다(한 화면에 두 기준을 두지 않는다).
- 순서는 SOP 먼저, 그 안에서 `order_index`(결과물 C의 문서 순서).
- 임시 번호(`NEW-<id>`)인 New 문서는 번호를 비우고 제목만 싣는다(지어낸 번호를 남이 옮겨 적지 않게).
- **Bundle이 Review complete가 되기 전의 후속 문서는 바뀔 수 있다.** 꼬리표를 `--ink-3`으로 흐리게 적고(끝난 Bundle은 잉크), 옆 칸에 그 말을 적는다(디자인 기초 2절 "제안은 연필로, 확정은 잉크로").
- 후속 문서가 없을 때: Bundle이 `done`이면 **No successor document**, 아니면 **Not decided yet**, `num` 마디면 **Nobody is restructuring this document**.

**합성과 실제**: 지도는 보는 Bundle과 `is_synthetic`이 같은 Bundle만 싣는다(내 판단). 합성 Bundle의 지어낸 번호가 실제 문서의 참조로 보이지 않게 한다.

## 5. 누가 무엇을 보나

보는 사람은 늘 **보는 Bundle V의 구성원**이다(작성자든 검토자든 같다 — 검토자는 "전부 읽기"다). 지도의 다른 Bundle B마다 관계가 셋이다.

| 필드 | V 자신(`self`) | B의 구성원(`member`) | B의 구성원 아님(`summary`) |
|---|---|---|---|
| Bundle 코드·제목·상태 | ○ | ○ | ○ |
| Old 문서 번호·제목 | ○ | ○ | ○ |
| 후속 문서 번호·제목·종류(SOP/WI) | ○ | ○ | ○ |
| 선(어느 문서 → 어느 번호, 종류, 상태, 줄 수) | ○ | ○ | ○ |
| 그 선의 문장 — Unit 글, 표시 ID, Unit id | ○ | ○ | **✗** |
| Assign으로 가기 | ○ | ○ | **✗** |
| 설명, 구성원·부서, 진행 숫자, 판, 파일 이름, 사유, 새 문장, AI 제안, EQUIS | 지도에 싣지 않는다(누구에게도) | | |

- **sysadmin과 `bundle.admin`도 구성원이 아니면 `summary`다.** `require_bundle_role`의 "sysadmin도 예외가 아니다"와 제품 명세 §9 "내용은 멤버가 되어야 본다"를 그대로 따른다.
- V의 구성원이 아니면 지도를 열 수 없다(404 `bundle_not_found`). 퇴직자는 403 `inactive_account`. 지금 의존성 그대로다.
- Bundle 제목을 누구에게나 보이는 것은 내 판단이다. 사용자가 연 넷(번호·제목·상태·후속 문서)에 "Bundle 제목"은 글자로 없지만 시안이 모든 줄기에 제목을 적었고, 줄기에 이름이 없으면 "어느 Bundle 것인가"를 읽을 수 없다. 설명(`description`)은 싣지 않는다. 뒤집으려면 `summary` 관계의 `title`을 비우고 코드(`BND-0013`)만 적는다.
- 후속 문서의 제목과 종류까지 싣는 것도 내 판단이다 — `SOP-UV`와 `WI-11` 가운데 어느 번호를 적을지는 제목을 봐야 고른다.

**새 권한 키는 만들지 않는다**(내 판단).

- 사용자가 요약을 "누구나" 보게 정했다. 키를 만들면 모든 작업자에게 주어야 하는 키가 되어 가르는 것이 없고, 세 곳(`catalog.py` · `lib/access.ts` · i18n `permission.<key>`)과 설명서 `#permissions` 표, 운영의 역할 부여가 늘 뿐이다.
- 문장은 권한이 아니라 멤버십이 가른다 — 지금 Bundle 내용과 같은 원칙이고(`#permissions` "Bundle을 보고 고치는 것은 권한이 아니라 구성원 여부"), 판정은 지금 의존성과 `bundle_members` 조인 하나다.
- 알고 받아들이는 것: `bundle.create`가 있는 사람은 빈 Bundle을 만들어 지도의 요약을 볼 수 있다. 요약은 T/F 작업자 모두에게 연 자료라 틈이 아니다. Bundle이 하나도 없고 만들 수도 없는 사람은 지도를 보지 못한다(12절).
- 나중에 "요약도 가려야 하는 Bundle"이 생기면 그때 키가 아니라 Bundle 쪽 표시(지도에서 빼기)로 푼다 — 이번에는 만들지 않는다.

**제품 명세 §9에 한 줄을 더한다**(1걸음): "참조 지도의 요약(문서 번호·제목, Bundle 코드·제목·상태, 후속 문서, 참조·이동 선의 줄 수)은 어느 Bundle의 구성원이든 본다. 문장은 그 Bundle 구성원만 본다(사용자 결정 2026-11-16)."

## 6. 화면

### 6.1 자리

- 주소 `/bundles/{id}/map`, 파일 `frontend/src/app/bundles/[id]/map/page.tsx`, 부품 `components/map/`, 순수 모델 `lib/map-model.ts`(거르기·찾기·옆 칸 요약)·`lib/map-layout.ts`(배치).
- 레일: `StageKey`에 `"map"`, `STAGES`에 `{ key: "map", path: "/map", ready: true }`를 **History 바로 앞**에 둔다(내 판단 — 번호 없는 보는 화면 둘이 레일 아래에 모인다). 레일의 아래로 미는 여백(`components.css` `.stg[data-stage="history"]`의 `margin-top: auto` · 상단 2단의 `margin-left: auto`)은 `map`으로 옮긴다. 아이콘은 lucide `Map`(전역 `Map`과 이름이 겹치니 `MapIcon`으로 들여온다).
- 문서가 없어도 잠그지 않는다(`isStageLocked`의 `NEEDS_DOCUMENTS`에 넣지 않는다, 내 판단) — 다른 Bundle의 문서가 무엇으로 바뀌는지는 내 문서가 없어도 찾아볼 수 있다.
- 본문 폭은 Assign과 같은 `desk`(`--page-max-desk` 1920, `lib/page-width.ts`). 화면은 창 높이를 채우고 쪽 전체는 스크롤하지 않는다(지도와 옆 칸이 따로 스크롤, 최소 높이 420px).
- 읽기 전용 Bundle(`in_review`·`done`)과 검토자에게도 똑같이 보인다. 지도에는 고치는 것이 없다.

### 6.2 틀

```
┌ 도구 줄: Reference map │ 찾기 │ Linked to this Bundle · All Bundles │ REF? only │ Moved to │ ─ │ Map · List │ − + Fit │ ⟳ ┐
├──────────────────────────────────────────────────────────┬───────────────────────┤
│ 지도(스크롤 칸): 줄기 · 마디 · 선                              │ 옆 칸                   │
│  [이 Bundle] [이어진 Bundle …] [Not in any Bundle]          │ clamp(280px,24vw,420px) │
└──────────────────────────────────────────────────────────┴───────────────────────┘
```

- 옆 칸 폭은 `clamp(280px, 24vw, 420px)`(`ui-review.md` 11번 — 고정 폭 옆 패널은 좁은 창에서 본문을 누른다). 틀은 `grid-template-columns: minmax(0, 1fr) <옆 칸>`(같은 문서 7번).
- **지도 위에 떠 있는 상자를 두지 않는다**(내 판단, 시안은 범례와 확대 단추를 지도 위에 띄웠다). 떠 있는 상자는 끝까지 스크롤해도 그 아래 마디를 가린다. 확대 단추는 도구 줄에, 범례는 옆 칸의 기본 보기(아무것도 고르지 않았을 때)에 둔다.
- 1120 폭(레일 72 + 여백): 지도 칸 약 730px — 줄기 셋이 보인다. 2560 폭: 본문 1920에서 지도 칸 약 1,400px — 줄기 다섯에서 여섯. 그 밖은 스크롤과 Fit.

### 6.3 배치 — 정해진 셈, 재지 않는다

배치는 `lib/map-layout.ts`의 순수 함수 하나다(자료와 접힘 상태 → 줄기·마디 좌표, 선의 경로, 전체 크기). DOM을 재지 않고, 난수도 힘 모의(force)도 없다. 같은 자료는 늘 같은 그림이다.

1. **줄기 순서**: 이 Bundle → 이 Bundle과 이어진 Bundle(이은 줄 수가 많은 순, 같으면 Bundle id) → (범위 `all`) 나머지 Bundle(id 순) → Not in any Bundle.
2. **줄기 안 순서**: 이 Bundle은 번호 순(숫자를 수로 읽는 자연 정렬, 로캘 고정), 번호 없는 문서는 끝. 남의 줄기는 **이 Bundle과 이어진 문서 먼저**(가장 위의 이웃 순번 → 번호), 그 아래 `target` 마디, 이어지지 않은 문서는 맨 아래. `num` 줄기는 가장 위의 이웃 순번 순 — 선이 덜 엇갈린다.
3. **크기는 고정**이다: 줄기 폭, 마디 폭·높이, 틈, 줄기 머리 높이(시안 값 200 · 176×44 · 가로 48 세로 10 · 50). 글이 길어도 마디는 커지지 않고 말줄임한다. 좌표는 덧셈과 곱셈뿐이다.
4. **선**: 마주 보는 옆면의 가운데를 3차 베지어로 잇는다(제어점 거리는 가로 간격의 절반, 최소 24). 같은 줄기 안은 오른쪽으로 도는 고리. 같은 두 마디 사이의 선이 둘 이상이면(확인한 참조 + REF? + Moved to) 닿는 높이를 6px씩 벌린다. 도착 쪽 끝에 점 하나로 방향을 보인다.

### 6.4 그리기 — 마디는 DOM, 선은 SVG 한 장

**그래프 라이브러리를 쓰지 않는다**(시안과 같다). 서버 빌드는 npm을 받을 수 있어 막힌 것은 아니지만 쓸 이유가 없다 — 줄기 배치가 정해져 있어 자동 배치도 마디 끌기도 필요 없고, frontend 의존성 여섯 개에 캔버스 층 하나를 더하는 값을 하지 못한다. 선을 직접 그리는 본보기(`link-lines.tsx`)가 이미 있다.

- 스크롤 칸 안에 "세계" 하나를 둔다. 세계 안에 **선의 SVG 한 장**(`aria-hidden`)과 **줄기·마디의 DOM**(절대 위치 `button`)을 같은 좌표로 겹친다. 확대는 세계에 `transform: scale(k)`(원점 왼쪽 위)를 주고 겉 상자 크기를 `폭×k`·`높이×k`로 잡아 스크롤 길이가 맞게 한다.
- 마디를 SVG 글자가 아니라 DOM으로 그리는 까닭(내 판단, 시안은 전부 SVG였다): (1) SVG 글자는 말줄임이 없어 글자 수로 잘라야 하는데 한글·영문 폭이 달라 넘치거나 일찍 잘린다 (2) 포커스 테두리·툴팁·`data-testid`가 다른 화면과 같은 길을 탄다 (3) **글자 대비 감사(`pw-contrast-audit.mjs`)가 DOM 글자의 `color`를 재므로 SVG `fill` 글자는 감사 밖이 된다.**
- **움직이기는 스크롤이다.** 휠·트랙패드·스크롤 막대·터치가 그대로 된다. 바탕을 누른 채 4px 넘게 끌면 스크롤 위치를 옮긴다(시안의 바탕 끌기). 끌기 층(`lib/box-drag.ts`)의 규칙을 따른다 — 4px 문턱(`DRAG_THRESHOLD_PX`), `pointerdown`에서 `preventDefault`를 부르지 않기, 끈 뒤의 `click` 한 번 삼키기, 마디·단추 위에서는 시작하지 않기(끌어다 놓기 설계 G1·G2·G4·G5).
- **확대**: 0.5 ~ 1.5, 0.1씩. 지도 위에서 Ctrl(⌘)+휠(포인터 자리를 지킨다), 도구 줄의 − · + · **Fit all**. 지도 밖에서는 브라우저 확대가 그대로 돈다(`use-pane-zoom.ts`와 같은 원칙). 0.75 아래에서는 마디의 둘째 줄(제목)을 감춘다(읽을 수 없는 글자를 그리지 않는다, 내 판단).
- **호버·포커스 강조는 React 상태가 아니다.** 올린 마디와 이어진 선·마디에 DOM 속성을 달고 CSS가 나머지를 흐리게 한다(`link-lines.tsx`·끌어다 놓기 G11과 같은 까닭 — 마디 수백 개가 올릴 때마다 다시 그려지지 않게). **고르기만 React 상태**다(옆 칸이 바뀐다).
- 움직임 줄이기에서는 고른 마디로 가는 스크롤이 바로 끝나고 번쩍임 대신 멈춘 테두리를 쓴다(지금 `[data-flash]` 규칙).

### 6.5 색 — 내 것은 강조 파랑, 남의 것은 `--peer-*`

사용자 결정(2026-11-16): 남의 작업은 **A안 무채색**. 색 가짓수를 늘리지 않고 무게로 나눈다(디자인 기초 10절 "칩의 진하기 3단"과 같은 생각). B안(청록)은 KO 파랑·EN 초록 사이라 버렸다.

`frontend/src/styles/tokens.css`에 더한다. 넷 모두 잉크·표면 토큰에서 나오므로 **다크는 따로 값을 두지 않아도 따라온다**(파일의 "Derived tokens mix with the surface" 원칙). 앞의 둘은 색 토큰 자리에, 뒤의 둘은 파생 토큰 자리에 둔다.

```css
/* Peer: another Bundle's work on the reference map. Neutral graphite, never the accent (decided 2026-11-16). */
--peer-ink: var(--ink-2);
--peer-fill: var(--ink-4);
--peer-bg: color-mix(in oklab, var(--peer-fill) 12%, var(--surface));
--peer-line: color-mix(in oklab, var(--peer-fill) 55%, var(--surface));
```

| 토큰 | 라이트(풀린 값) | 다크(풀린 값) | 쓰는 곳 |
|---|---|---|---|
| `--peer-ink` | `oklch(.39 .009 255)` | `oklch(.815 .0048 255)` | 남의 마디의 번호·후속 문서 글자, 소유 표시 글자 |
| `--peer-fill` | `oklch(.56 .0054 255)` | `oklch(.64 .0056 255)` | 남의 마디 왼쪽 막대, 남의 선 |
| `--peer-bg` | 흰 바탕에 12% | `--surface`에 12% | 남의 마디 바탕, 소유 표시 바탕 |
| `--peer-line` | 흰 바탕에 55% | `--surface`에 55% | 남의 마디 테두리 |

**대비 목표**: 글자 4.5:1 이상, 뜻을 싣는 막대와 강조된 선 3:1 이상. 아래는 토큰 값으로 어림한 것이고(무채색이라 밝기만으로 셈했다), 실제는 감사 스크립트로 화면의 글자를 잰다(디자인 기초 15절 "대비는 실제 글자로 잰다").

| 쌍 | 라이트 | 다크 | 목표 |
|---|---|---|---|
| `--peer-ink` 글자 / `--peer-bg` | 약 8.2 | 약 8.4 | 4.5 |
| 제목 글자 `--ink-3` / `--peer-bg` | 약 5.4 | 약 5.8 | 4.5 |
| 막대 `--peer-fill` / `--peer-bg` | 약 4.0 | 약 4.4 | 3 |
| 강조된 남의 선 `--peer-fill` / `--bg` | 약 4.2 | 약 5.5 | 3 |

- `--peer-line`(테두리)은 3:1에 못 미친다(라이트 약 2). 테두리만으로 가르지 않으므로 받아들인다 — 남의 마디는 막대·바탕·소유 표시 글자 셋으로 읽힌다.
- 쉬는 선은 흐리다(불투명도 약 .5, 남끼리의 선 .3). 선의 뜻은 문서를 올리거나 골랐을 때 3:1 이상으로 읽히고, 같은 자료를 List가 글자로 준다.

**무엇이 어떤 모양인가** — 색만으로 가르는 것은 없다.

| 대상 | 모양 |
|---|---|
| 이 Bundle의 줄기 | `--accent-tint` 바탕, `--accent-line` 테두리 |
| 남의 줄기 | `--sunken` 바탕, `--line` 테두리. 구성원이 아니면 머리에 자물쇠 아이콘과 툴팁 |
| Not in any Bundle 줄기 | 바탕 없음, `--line-2` 점선 테두리 |
| 이 Bundle의 마디 | `--paper` 바탕, 왼쪽 3px `--accent` 막대 |
| 남의 마디 | `--peer-bg` 바탕, `--peer-line` 테두리, 왼쪽 3px `--peer-fill` 막대 |
| `num` 마디 | 바탕 없음, `--ink-4` 점선 테두리, 막대 없음 — **새 색 없이** 점선으로 가른다 |
| `target` 마디 | 그 줄기의 색 그대로, 번호 앞에 `NEW` 꼬리표 |
| 이 Bundle에서 나가는 선 | `--accent` |
| 이 Bundle로 들어오는 선, 남끼리의 선 | `--peer-fill`(남끼리는 더 가늘고 흐리게) |
| 이 Bundle의 REF? 선 | `--lang-ref-ink` 짧은 점선 — Assign의 `REF?`와 같은 색 |
| 남의 Bundle의 REF? 선 | `--peer-fill` 짧은 점선(내 판단, 시안은 분홍이었다 — 분홍은 "내가 확인할 것"으로만 쓴다) |
| 고른 마디 | 2px `--accent` 테두리 |

- 막대가 있는 마디는 **막대 쪽 모서리를 직각**으로 둔다(오른쪽만 `--r-1`). 둥글면 막대가 손톱처럼 보인다.
- raw hex를 `tokens.css` 밖에서 쓰지 않고, 화면 코드가 테마로 갈라지지 않는다(프런트 UI 규칙).

### 6.6 마디와 줄기에 적는 것

- **마디 첫 줄**: 번호(`--font-mono`, 길면 가운데 말줄임 `lib/truncate-middle.ts` — 번호는 끝자리가 뜻을 싣는다) · 오른쪽에 후속 문서 `→ SOP-UV +1`(첫 번호와 나머지 수). **둘째 줄**: 제목(끝 말줄임, 비면 빈 줄 — 마디 높이는 같다).
- 말줄임한 글은 툴팁으로 전부 읽는다(번호·제목·후속 문서 전부). 툴팁은 마디마다 부품을 두지 않고 위임 툴팁(`ui/delegated-tip.tsx`)을 쓴다. 포커스로도 뜬다(`ui-review.md` 9번).
- **줄기 머리**: Bundle 코드와 제목(말줄임 + 툴팁), `BundleStatusPill`, 문서 수, 접기 단추. 이 Bundle은 **This Bundle**, 남의 것은 **Other Bundle · member** 또는 **Other Bundle · summary only**를 소유 표시로 적는다.
- 아이콘만 있는 것(자물쇠, 확대, 다시 읽기, 접기)은 모두 툴팁을 단다.

### 6.7 많을 때 — 범위, 거르기, 찾기, 접기

- **범위**(도구 줄의 둘 중 하나): **Linked to this Bundle**(기본) — 이 Bundle의 문서 전부와, 이 Bundle과 선으로 이어진 마디만. **All Bundles** — 같은 종류(합성/실제)의 모든 Bundle과 남끼리의 선까지. 범위는 서버가 가른다(7절) — 기본 요청은 남끼리의 선을 세지도 않는다.
- **접기**: 줄기 머리의 단추로 접는다(머리만 남는다). 범위 `all`에서 이 Bundle과 이어지지 않은 줄기는 **접힌 채 시작**한다. 범위 `linked`의 남의 줄기 맨 아래에는 "문서 N개 더"가 한 줄로 서고(그 Bundle의 Old 문서 수 − 보인 수), 누르면 범위를 All Bundles로 바꾸고 그 줄기를 편다.
- **거르기**: **REF? only**(확인 전 참조만), **Moved to**(이동 선 보이기, 기본 켬). 거르면 선이 사라지고, 범위 `linked`에서는 선이 하나도 남지 않은 남의 마디도 함께 사라진다.
- **찾기**: 번호나 제목(대소문자 무시). 맞는 마디만 진하게, 나머지는 흐리게 한다 — 새 색을 쓰지 않는다(내 판단, 시안은 호박색 테두리였는데 호박색은 On hold의 색이다). Enter는 맞는 첫 마디를 고르고 그리로 스크롤하며, 다시 누르면 다음으로 간다. 접힌 줄기의 마디가 맞으면 그 줄기를 편다. 범위 `linked`에서 맞는 것이 없으면 **Search all Bundles** 단추를 보인다(범위를 All Bundles로 바꿔 다시 찾는다).
- **List**: 같은 선을 표로 — **From** · **To** · **Becomes**(도착 문서의 후속 문서) · **Bundle**(맞은편 Bundle) · **State** · **Lines**. 범위·거르기·찾기를 그대로 따른다. 줄을 누르면 맞은편 문서가 골라져 옆 칸이 열린다. 긴 표는 `lib/use-progressive-list.ts`로 이어 그린다. 표는 `table-layout: fixed`에 열 폭을 정하고 번호·제목 칸은 감싼 `div`에 줄 수 제한을 건다(`ui-review.md` 8·10번).
- 시안의 넷째 걸음대로, **Bundle 수십 개에서는 지도보다 List와 찾기가 일을 한다.** All Bundles의 지도는 접힌 줄기가 옆으로 길게 서는 것을 받아들인다(한 줄로 세운다 — 줄을 바꾸면 선이 줄기를 가로지른다).
- 서버가 마디 상한에서 잘랐으면(7절 `truncated`) 지도 위에 한 줄 알림을 보인다.
- 범위·보기·거르기·확대는 기억하지 않는다(내 판단 — 들어올 때마다 "이 Bundle과 이어진 것, 지도, 100%"에서 시작해야 같은 물음에 같은 그림이 나온다).

### 6.8 누르면 — 옆 칸과 가기

- **올리기·포커스**: 그 마디와 이어진 선·마디만 진하게.
- **누르기**(Enter·Space): 그 마디를 고른다. 다시 누르거나 Esc, 바탕 누르기로 푼다. 고른 동안에는 호버 강조가 고른 것을 덮지 않는다.
- **옆 칸 — 아무것도 고르지 않았을 때**: 이 Bundle의 요약(가리키는 줄 수와 문서 수, 가리켜지는 줄 수와 Bundle 수, 확인 전 번호 수, 어느 Bundle에도 없는 문서 수)과 범례.
- **옆 칸 — 마디를 골랐을 때**: 소유 표시, 번호, 제목, **Bundle**(코드와 제목), **Status**, **Becomes**, 그 아래 **Cites n**(이 문서가 가리키는 것)과 **Cited by n**(이 문서를 가리키는 것) 목록. 목록의 줄은 맞은편 번호 · 상태 알약(**Confirmed** · **REF?** · **Moved to**) · 문장이고, 누르면 맞은편 마디가 골라지고 그리로 스크롤한다(접힌 줄기면 편다).
- **문장은 따로 받아 온다**(7절 `…/map/lines`). 구성원인 Bundle의 줄만 Unit 표시 ID와 글이 보이고, 구성원이 아닌 Bundle의 줄은 "줄 N개 가려짐 · 요약만" 한 줄로 수만 적는다.
- **가기 — 갈 수 있는 곳에만 단추가 있다.**

| 고른 것 | 단추 | 가는 곳 |
|---|---|---|
| 이 Bundle이나 구성원인 Bundle의 Old 문서 | **Open in Assign** | 그 Bundle의 Assign에서 그 문서를 연다(`stages.getEditOriginalHref` — 지금 있는 주소) |
| 구성원인 Bundle의 줄 | 줄 끝의 **Open in Assign** | 그 Bundle의 Assign에서 그 줄을 고른 채 연다(새 주소, 3걸음) |
| 구성원이 아닌 Bundle의 것 | 없음 | 단추 대신 "이 Bundle의 구성원이 아닙니다. 번호·제목·상태만 보입니다." 한 줄(내 판단 — 누를 수 없는 단추를 두지 않는다) |
| `num` 마디 | 없음 | — |

- 이동은 링크로 한다(`components/nav-host.tsx`가 `navigate()`로 돌린다 — `router.push`를 새로 쓰지 않는다).
- **Assign을 줄 하나로 여는 주소**(3걸음, 내 판단): `/bundles/{id}/assign?doc=<문서 id>&unit=<unit id>`. Assign이 읽어 그 문서를 열고 그 Unit이 든 줄을 골라 스크롤한 뒤 주소에서 뗀다(`EDIT_ORIGINAL_PARAM`과 같은 방식, 상수는 `lib/stages.ts`에). 그 Unit이 사라졌으면(쪼개기 편집) 문서만 열고 알림 한 줄을 띄운다.

### 6.9 빈 상태와 오류

| 때 | 보이는 것 |
|---|---|
| 읽는 중 | 지도 칸과 옆 칸의 쉬머(지금 부품) |
| 지도를 읽지 못함 | `ui/load-error.tsx` `LoadError`와 다시 시도. 404·403은 지금 Bundle 화면들의 처리(`bundle-load-error.tsx`)를 그대로 |
| 이 Bundle에 읽힌 Old 문서가 없음 | `EmptyState` **No documents yet** + Documents로 가는 단추. 범위·찾기는 살아 있다(남의 문서를 찾아볼 수 있다) |
| 문서는 있는데 선이 하나도 없음 | 이 Bundle의 줄기만 그리고 옆 칸에 **No references yet** |
| 거르기·찾기에 맞는 것이 없음 | **Nothing matches** + **Clear filters** |
| 문장을 읽지 못함 | 옆 칸 목록 자리에 한 줄 알림과 다시 시도. 지도와 요약은 그대로 |
| 마디 상한에서 잘림 | 지도 위 한 줄 알림 |

### 6.10 글쇠

- Tab 순서: 찾기 → 범위 → 거르기 → Map · List → 확대 → 다시 읽기 → **지도(Tab 자리 하나)** → 옆 칸.
- 지도 안은 **움직이는 tabindex**다(마디 수백 개가 Tab 자리가 되지 않게). ↑·↓ 같은 줄기의 앞뒤 마디(맨 위에서 ↑는 줄기 머리), ←·→ 옆 줄기의 가장 가까운 높이의 마디, Home·End 줄기의 처음·끝, Enter·Space 고르기(줄기 머리에서는 접기), Esc 고름 풀기, `+`·`-` 확대, `0` Fit all.
- `/`는 찾기 칸으로 간다(설명서 화면과 같은 글쇠). 글 입력 중에는 글쇠를 가로채지 않는다.
- 포커스가 옮겨 간 마디는 스크롤해 보이게 한다. 포커스 테두리는 전역 `:focus-visible`을 그대로 쓴다.
- 마디의 이름(`aria-label`): 번호, 제목, 소유, 후속 문서, 가리키는 수와 가리켜지는 수. 선의 SVG는 `aria-hidden`이고, **List가 같은 자료의 글자 길**이다.

## 7. 서버

새 라우터 `backend/app/routers/sop_map.py`와 모듈 `backend/app/sop/ref_map.py`(이름은 구현에 맡긴다). 둘 다 읽기 전용이고 `require_bundle_role(*MEMBER_ROLES)`를 첫 의존성으로 건다. 모양은 내 판단이다.

### 7.1 `GET /api/bundles/{bundle_id}/map?scope=linked|all`

요약만 준다. **이 응답에는 문장을 담는 필드가 없다** — 누가 불러도 같은 모양이고, 달라지는 것은 `relation`뿐이다.

```json
{
  "scope": "linked",
  "truncated": false,
  "bundles": [
    { "id": 12, "code": "BND-0012", "title": "SYNTHETIC 원심분리기", "status": "in_progress", "relation": "self", "document_count": 6 },
    { "id": 15, "code": "BND-0015", "title": "SYNTHETIC UV 분광광도계", "status": "in_review", "relation": "member", "document_count": 3 },
    { "id": 18, "code": "BND-0018", "title": "SYNTHETIC 문서 관리", "status": "done", "relation": "summary", "document_count": 2 }
  ],
  "nodes": [
    { "id": "old:101", "kind": "old", "bundle_id": 12, "number": "OLD-1", "title": "SYNTHETIC Eppendorf Centrifuge",
      "becomes": [ { "code": "SOP-CF", "title": "SYNTHETIC Centrifuge", "doc_type": "sop" }, { "code": "WI-01", "title": "…", "doc_type": "wi" } ] },
    { "id": "target:77", "kind": "target", "bundle_id": 18, "number": "SOP-LOG", "title": "…", "doc_type": "sop", "becomes": [] },
    { "id": "num:SOP-ABC-2040", "kind": "num", "bundle_id": null, "number": "SOP-ABC-2040", "title": "", "becomes": [] }
  ],
  "edges": [
    { "source": "old:101", "target": "old:140", "kind": "ref", "state": "proposed", "lines": 1 },
    { "source": "old:106", "target": "target:77", "kind": "moved", "state": "confirmed", "lines": 2 }
  ]
}
```

- `relation`: `self`(보는 Bundle) · `member` · `summary`. `document_count`는 그 Bundle의 읽힌 Old 문서 수(접힌 줄기와 "N개 더"가 쓴다).
- `linked`: 이 Bundle의 Old 문서 전부 + 한쪽 끝이 이 Bundle인 선 + 그 선이 닿는 마디와 그 Bundle. `all`: 같은 종류의 모든 Bundle의 Old 문서 + 모든 선(남끼리는 `confirmed`만, 4절).
- 읽힌 Old 문서가 없는 Bundle은 싣지 않는다(보는 Bundle은 늘 싣는다).
- **검증**: `bundle_id`는 `BundleIdPath`, `scope`는 `Literal["linked", "all"]`(기본 `linked`). 형식 오류는 FastAPI 기본 422.
- **쪽 나누기는 없다**(내 판단) — 선이 쪽 경계에 걸리는 그래프는 나눠 읽을 수 없다. 대신 상한을 둔다: 마디 2,000개, 선 10,000개(코드 상수, env 아님). 넘으면 이 Bundle 것과 이어진 것을 먼저 채우고 `truncated: true`. `linked`에서는 사실상 닿지 않는 값이다.

### 7.2 `GET /api/bundles/{bundle_id}/map/lines?node=<마디 id>`

고른 마디의 줄. **구성원인 Bundle의 줄만** 글과 함께 준다.

```json
{
  "node": "old:101",
  "out": [
    { "bundle_id": 12, "document_id": 101, "unit_id": 5012, "display_id": "OLD-1-051", "kind": "ref", "state": "proposed",
      "number": "SOP-ABC-1016", "target": "old:140", "text": "SOP-ABC-1016 Operation of UV spectrophotometer", "text_truncated": false }
  ],
  "in": [
    { "bundle_id": 15, "document_id": 140, "unit_id": 7301, "display_id": "SOP-ABC-1016-033", "kind": "ref", "state": "confirmed",
      "number": "OLD-1", "source": "old:140", "text": "Spin the samples as in OLD-1 before reading absorbance.", "text_truncated": false }
  ],
  "hidden_out": 0, "hidden_in": 2, "more_out": 0, "more_in": 0
}
```

- `out`은 그 Old 문서 안의 줄(마디가 `old`일 때만), `in`은 그 마디의 번호를 가리키는 줄이다. **지도에 그려지는 선의 줄만** 싣는다(`proposed`는 한쪽 끝이 보는 Bundle일 때만, 4절) — 지도의 줄 수와 목록이 어긋나지 않게.
- 줄마다 그 줄이 든 Bundle의 구성원인지 본다. 구성원이면 싣고, 아니면 `hidden_out`·`hidden_in`에 수만 더한다(그 수는 7.1의 `lines`로 이미 나간 값이다). **글을 읽는 질의에 `bundle_members`(그 Bundle, 요청한 사람) 조인을 넣어** 구성원이 아닌 Bundle의 글은 DB에서 읽지도 않는다. 수는 글 열이 없는 다른 질의로 센다.
- `display_id`는 `units.compute_display_id`. `text`는 300자에서 자르고 `text_truncated`를 세운다(극단 자료의 1,800자 문단). 한쪽에 200줄까지, 넘는 수는 `more_out`·`more_in`.
- Moved to의 사유(`UnitDecision.reason`)는 구성원에게도 싣지 않는다(Assign에서 읽는다).
- **검증**: `node`는 `old:<1~10자리 수>` · `target:<1~10자리 수>` · `num:<1~100자, NUL 없음>` 꼴(전체 104자 이하). 꼴이 틀리면 422. **없는 마디, 다른 종류(합성/실제)의 마디는 빈 목록의 200**이다(내 판단) — 있는지 없는지를 응답 코드로 가르면 번호를 넣어 보며 문서가 있는지 캐는 길이 된다. 볼 수 있는 줄이 없다는 답으로 충분하다.

### 7.3 질의와 비용

Bundle 수와 무관하게 질의 수는 고정이다(표마다 한 번). **원문 블록(`source_blocks`)과 파일(`document_files`)은 읽지 않는다.** 잠그지 않는다 — `lock_bundle`도 `FOR SHARE`도 쓰지 않는다. 질의 사이에 남의 저장이 끼어 한 줄이 어긋날 수 있고, 다시 읽으면 맞는다(읽기만 하는 화면이라 받아들인다, 내 판단).

`linked`(기본):

1. 보는 Bundle과 같은 종류의 Bundle 행 + 요청한 사람의 `bundle_members` — 2번.
2. 이 Bundle의 읽힌 Old 문서와 가장 새 추출 — 1번.
3. **나가는 줄**: 이 Bundle의 활성 Unit 가운데 참조 줄이 될 수 있는 종류(`REF_KINDS`)의 `id·kind·lang·text`와 `unit_refs` → `read_ref_state`. 이동은 `unit_decisions`(이 Bundle, `move_external`, `confirmed`). 글을 읽는 것은 이 Bundle 하나라 Assign이 여는 양보다 적다 — 2번.
4. **번호 풀기**: 나온 번호들을 `documents`(`upper(trim(doc_code))`)와 `target_docs`(`upper(trim(code))`)에서 찾는다 — 2번. 색인이 없어 표 전체를 보지만 문서 표는 수천 행이다.
5. **들어오는 줄**: 이 Bundle의 번호(Old 문서 번호 + New 문서 번호)를 가리키는 남의 줄.
   - 확인한 참조: `unit_refs.number IN (…)`(`state = "confirmed"`) → 그 Unit이 활성 `ref`이고 가장 새 추출인지 조인으로 확인. 표가 작다(사람이 표시한 줄만).
   - 표시 없는 줄(확인 전 제안, 표시 없이 `ref`인 줄): 남의 Bundle의 활성 Unit 가운데 `text LIKE '%<번호>%'`인 것만 골라 `read_ref_state`로 다시 본다. 번호는 번호 꼴(`[A-Z0-9-]`)만 넣고 `%`·`_`가 든 번호는 뺀다. 제안 규칙이 대문자 번호만 잡으므로 `LIKE`로 충분하다(sqlite는 대소문자를 가리지 않아 더 넓게 잡고 파이썬이 다시 거른다).
   - 이동: `unit_decisions`에서 `upper(trim(move_target_code)) IN (…)`, `confirmed`, 다른 Bundle.
6. **후속 문서**: 마디가 된 Old 문서들에 대해 `target_sources ⋈ target_sentences(confirmed) ⋈ units ⋈ target_docs`의 `DISTINCT (문서, New 문서)` — 1번(문서 id는 `groups.select_in_chunks`로 나눈다).

**비싼 것은 5의 `LIKE` 하나다** — 남의 Bundle의 Unit 글 전체를 훑는다. `all`은 여기에 모든 Old 문서(1번)와 모든 확정 참조·이동(2번, 글은 표시 없는 `ref` 줄만 읽는다)을 더하고, 남끼리의 제안은 세지 않는다.

- **목표**: 극단 시드(Bundle 47개)에서 `linked` 300ms, `all` 800ms 안(로컬 sqlite에서 재고, 개발 스택 Postgres에서 다시 잰다).
- 넘으면 12절의 길(읽을 때 계산을 버리고 문서별 참조 표를 둔다)을 사용자와 정한다. 이번에는 **스키마를 바꾸지 않는다**.
- 로그에는 건수만 남긴다(Bundle·마디·선의 수, 걸린 시간). 번호와 글은 남기지 않는다.
- 화면은 들어올 때와 **다시 읽기**(도구 줄의 단추)에서만 부른다. 주기적으로 다시 부르지 않는다.

### 7.4 거절 · 스키마 · 설정

- 거절 코드는 **새로 만들지 않는다**: 404 `bundle_not_found`, 403 `inactive_account`(지금 의존성), 형식 오류 422(FastAPI 기본). 그래서 새 `rule.<code>` 문구도 없다.
- **스키마 변경(Alembic) 없음. 새 env 없음. 새 권한 키 없음. 새 의존성 없음.**
- 새 표가 없으니 db-viewer(`docs/deploy/db-viewer-readonly.md`)와 백업(`docs/deploy/backup.md`)의 범위도 그대로다.
- 지도는 `bundle_events`에 쓰지 않는다.

## 8. 문구와 사용 설명서

en·ko를 한 쌍으로 더한다(`i18n-messages.test.ts`). Bundle·Old·New·Unit과 상태 이름은 ko에서도 영어다. 사이의 값은 `{n}`.

| 키 | en | ko |
|---|---|---|
| `stage.map` | Map | Map |
| `map.title` | Reference map | 참조 지도 |
| `map.search` | Doc no. or title | 문서 번호나 제목 |
| `map.searchAll` | Search all Bundles | 모든 Bundle에서 찾기 |
| `map.scope.linked` | Linked to this Bundle | 이 Bundle과 이어진 것 |
| `map.scope.all` | All Bundles | 모든 Bundle |
| `map.filter.proposed` | REF? only | REF? only |
| `map.filter.moved` | Moved to | Moved to |
| `map.view.map` · `map.view.list` | Map · List | Map · List |
| `map.zoom.in` · `.out` · `.fit` | Zoom in · Zoom out · Fit all | 확대 · 축소 · 전체 보기 |
| `map.refresh` | Read again | 다시 읽기 |
| `map.owner.self` | This Bundle | 이 Bundle |
| `map.owner.member` | Other Bundle · member | 다른 Bundle · 구성원 |
| `map.owner.summary` | Other Bundle · summary only | 다른 Bundle · 요약만 |
| `map.owner.none` | Not in any Bundle | 어느 Bundle에도 없음 |
| `map.lane.noneSub` | Cited, but nobody restructures it | 가리켜지지만 아무도 재구성하지 않는 문서 |
| `map.lane.lockTip` | You are not a member. Numbers, titles and status only. | 구성원이 아닙니다. 번호·제목·상태만 보입니다. |
| `map.lane.more` | {n} more documents | 문서 {n}개 더 |
| `map.lane.collapse` · `.expand` | Collapse · Expand | 접기 · 펴기 |
| `map.node.noNumber` | No number | 번호 없음 |
| `map.node.newTag` | NEW | NEW |
| `map.edge.confirmed` | Confirmed | Confirmed |
| `map.edge.proposed` | REF? | REF? |
| `map.edge.moved` | Moved to | Moved to |
| `map.legend.confirmed` | Confirmed reference | 확인한 참조 |
| `map.legend.proposed` | REF? not confirmed yet | REF? 아직 확인 전 |
| `map.legend.moved` | Line moved to another document | 다른 문서로 보낸 줄 |
| `map.side.bundle` · `.status` · `.becomes` | Bundle · Status · Becomes | Bundle · Status · 바뀔 문서 |
| `map.side.cites` | Cites {n} | 가리키는 문서 {n} |
| `map.side.citedBy` | Cited by {n} | 가리켜지는 곳 {n} |
| `map.side.undecided` | Not decided yet | 아직 정해지지 않음 |
| `map.side.noSuccessor` | No successor document | 후속 문서 없음 |
| `map.side.nobody` | Nobody is restructuring this document | 이 문서를 재구성하는 Bundle이 없습니다 |
| `map.side.tentative` | May change until the Bundle is Review complete | Bundle이 Review complete가 되기 전에는 바뀔 수 있습니다 |
| `map.side.hidden` | {n} lines hidden · summary only | 줄 {n}개 가려짐 · 요약만 |
| `map.side.moreLines` | {n} more lines | 줄 {n}개 더 |
| `map.side.notMember` | You are not a member of this Bundle. You see numbers, titles and status only. | 이 Bundle의 구성원이 아닙니다. 번호·제목·상태만 보입니다. |
| `map.side.openAssign` | Open in Assign | Assign에서 열기 |
| `map.side.clear` | Clear selection | 고름 풀기 |
| `map.sum.cites` | {lines} lines in {docs} documents | 문서 {docs}개에 줄 {lines}개 |
| `map.sum.citedBy` | {lines} lines from {bundles} other Bundles | 다른 Bundle {bundles}개에서 줄 {lines}개 |
| `map.sum.toCheck` | {n} reference numbers not confirmed | 확인하지 않은 참조 번호 {n}개 |
| `map.sum.noOwner` | {n} cited documents are in no Bundle | 가리키는 문서 {n}개가 어느 Bundle에도 없음 |
| `map.sum.hint` | Click a document to see what it cites, what cites it, and what it becomes. | 문서를 누르면 가리키는 문서, 가리켜지는 곳, 바뀔 문서가 보입니다. |
| `map.list.from` · `.to` · `.becomes` · `.bundle` · `.state` · `.lines` | From · To · Becomes · Bundle · State · Lines | From · To · Becomes · Bundle · State · Lines |
| `map.empty.noDocs` | No documents yet | 문서 없음 |
| `map.empty.noDocsBody` | Upload Old documents to see what they cite. You can still look up other Bundles. | Old 문서를 올리면 가리키는 문서가 보입니다. 다른 Bundle의 문서는 지금도 찾아볼 수 있습니다. |
| `map.empty.noRefs` | No references yet | 참조 없음 |
| `map.empty.noRefsBody` | No reference line or moved line connects this Bundle to another document yet. | 이 Bundle을 다른 문서와 잇는 참조 줄이나 보낸 줄이 아직 없습니다. |
| `map.empty.filtered` | Nothing matches | 맞는 것이 없음 |
| `map.empty.clear` | Clear filters | 거르기 지우기 |
| `map.truncated` | Showing the first {n} documents. Search or filter to narrow it. | 문서 {n}개까지만 보입니다. 찾기나 거르기로 좁히세요. |
| `map.lines.error` | Could not read the lines. | 줄을 읽지 못했습니다. |
| `map.assign.gone` | That line has changed. The document is open instead. | 그 줄이 바뀌었습니다. 문서를 열었습니다. |

List의 열 이름과 선의 상태는 상태 이름처럼 ko에서도 영어로 둔다(디자인 기초 10절).

**사용 설명서**(`frontend/public/manual/user-manual.md`, 1걸음 커밋 — `MANUAL_STAGE_SECTION`이 조각을 요구한다). `## History {#history}` 앞에 조각 하나를 더한다. 그림 줄은 정식 업데이트 때 더한다.

- `## Map {#map}` — 무엇을 보는 화면인가(1절의 네 물음), 줄기·마디·선 읽는 법, **Linked to this Bundle** 과 **All Bundles**, **REF? only**, **Moved to**, **List**, 찾기, 확대와 **Fit all**, 글쇠.
- `### 남의 Bundle은 어디까지 보이나 {#map-visibility}` — 5절의 표를 글로. "**Other Bundle · summary only** 는 번호·제목·상태·바뀔 문서만 보입니다. 문장을 보려면 그 Bundle의 구성원이어야 합니다."
- `### 바뀔 문서 읽는 법 {#map-becomes}` — 확정한 줄만 센다는 것, Review complete 전에는 바뀔 수 있다는 것, **Not decided yet** · **No successor document** · **Nobody is restructuring this document** 의 뜻.
- 고치는 곳 셋: `#assign-ref`에 "가리키는 문서가 무엇으로 바뀌는지는 **Map** 에서 봅니다" 한 줄, `#roles`의 Reviewer에 "지도도 작성자와 똑같이 봅니다", `#permissions` 끝의 "Bundle을 보고 고치는 것은 권한이 아니라 구성원 여부로 정해집니다"에 "다만 **Map** 의 요약(번호·제목·상태·바뀔 문서)은 어느 Bundle의 구성원이든 봅니다"를 잇는다. 권한 표는 그대로다.

## 9. 검증

**순수 모델을 먼저 시험한다**(vitest, 브라우저 없이).

- 배치(`map-layout`): 줄기 순서(이 Bundle → 이은 줄 수 → id → Not in any Bundle), 줄기 안 순서(번호 자연 정렬, 번호 없는 문서 끝, 이어진 문서 먼저), 접힌 줄기의 높이, 같은 두 마디 사이 선 셋이 벌어지는 것, 같은 줄기 안 고리, **같은 입력에 같은 출력**(입력 순서를 섞어도), 마디 0개·1개·2,000개.
- 거르기·찾기(`map-model`): REF? only, Moved to 끄기, 선이 사라진 남의 마디가 함께 사라지는 것, 번호·제목 찾기(대소문자, 한글), 찾은 것이 접힌 줄기에 있을 때, 옆 칸 요약의 네 숫자.
- 보이기: `relation`이 `summary`인 마디에서 가는 단추가 나오지 않는 것, `hidden_*`가 있을 때의 한 줄, 후속 문서 꼬리표의 세 가지 빈 문구, 임시 번호 처리.

**서버**(`tests/test_sop_map.py`, 합성 자료). 무엇보다 **가시성 행렬**이다.

| 보는 사람 | 기대 |
|---|---|
| V 작성자 · V 검토자 | 두 응답이 글자까지 같다 |
| B의 작성자 · B의 검토자(V 구성원) | B의 줄이 글과 함께 온다 |
| B의 구성원 아님(V 구성원) | B의 번호·제목·상태·후속 문서·줄 수는 오고, 글·표시 ID·Unit id는 없다 |
| sysadmin(`APP_SYSADMINS`), `bundle.admin` 보유 — B의 구성원 아님 | 위와 같다 |
| V의 구성원 아님(sysadmin 포함) | 두 엔드포인트 모두 404 `bundle_not_found` |
| 퇴직자 | 403 `inactive_account` |
| 로그인 없음 | 401 |

- **새는지 보는 시험**: 구성원이 아닌 Bundle의 참조 줄 글, Moved to 사유, 설명, 파일 이름, 새 문장에 각각 다른 표식 문자열을 심고, 두 엔드포인트의 **응답 본문 전체**(모든 `scope`, 모든 마디 id)에 그 문자열이 하나도 없는지 본다. 필드 이름으로 보지 않고 글자로 본다.
- 선: 확인한 참조·제안·이동의 줄 수, "참조 아님" 표시가 제안을 지우는 것, AI 제안 상태의 이동이 선이 아닌 것, 보류한 줄이 선이 아닌 것, 자기 참조 빼기, 같은 번호가 두 Bundle에 있을 때, 번호 꼴이 아닌 이동 코드가 버려지는 것, 소문자·앞뒤 빈칸 번호가 맞는 것, 가장 새 추출만 보는 것, 은퇴한 Unit이 빠지는 것.
- 남끼리의 제안이 `all`에도 없는 것. `linked`에 남끼리의 선이 없는 것.
- 후속 문서: 확정만 세는 것(AI 제안·보류 제외), SOP 먼저, 임시 번호는 빈 번호, 배정을 지우면 사라지는 것.
- 합성과 실제가 섞이지 않는 것.
- `lines`: 없는 마디·다른 종류의 마디가 빈 목록의 200인 것, 300자 자르기, 200줄 상한과 `more_*`, `hidden_*`가 7.1의 줄 수와 맞는 것, 꼴이 틀린 `node` 422.
- 질의 수가 Bundle 수에 따라 늘지 않는 것(Bundle 2개와 20개에서 같은 수).
- 지도 읽기가 `bundle_events`와 어떤 revision도 바꾸지 않는 것.
- 리비전 시험(`test_migrations.py`)은 그대로 통과해야 한다 — 모델을 건드리지 않는다.

**브라우저**(`pw-smoke-sop.mjs`에 `map:` 장면)

1. 레일의 Map → 이 Bundle의 줄기와 이어진 줄기가 보인다(장면마다 Bundle 코드를 assert — `ui-review.md` 4번).
2. 마디를 누르면 옆 칸에 번호·Status·Becomes·Cites·Cited by가 뜬다. 구성원이 아닌 Bundle의 마디에는 가는 단추가 없고, 문장 요청의 응답에 글이 없다(네트워크 응답을 본다).
3. REF? only, Moved to, List, 찾기와 Enter, All Bundles, 줄기 접기.
4. 글쇠만으로: Tab으로 지도에 들어가 화살표로 옮기고 Enter로 고르고 Esc로 푼다.
5. Open in Assign이 그 문서(3걸음부터는 그 줄)를 연다.
6. 마디 위를 지나는 동안 React 커밋이 없다(끌어다 놓기 스모크와 같은 방법).
7. 평문 HTTP의 LAN IP에서 한 번 연다(`crypto`·Clipboard를 쓰지 않는 것을 확인 — 쓸 일이 없다).

**극단 자료**(`seed_sop_worst`에 더한다, 1120과 2560, 한·영, 라이트·다크)

- 서로 가리키는 Bundle 8개 이상, 문서 100개 이상, 선 170개 이상(시안의 극단 자료와 같은 크기), 그리고 지금의 가벼운 Bundle 36개가 All Bundles에서 접힌 줄기로 선다.
- 100자 번호, 공백 없는 200자 제목, 빈 제목, 번호 없는 문서, 같은 번호가 두 Bundle에, 한 번호를 가리키는 문서 30개, 번호 40개를 가리키는 문서 하나, 어느 Bundle에도 없는 번호 여럿, 임시 번호뿐인 후속 문서, 후속 문서 6개인 문서, 구성원이 아닌 Bundle, 문서 없는 Bundle(W7)에서 연 지도, 1,800자 참조 줄.
- 볼 것: 마디 글이 마디 밖으로 넘치지 않는다, 선이 번호를 덮어 읽을 수 없게 하지 않는다(선은 마디 아래 층), 옆 칸이 1120에서 지도를 누르지 않는다, List가 옆으로 밀리지 않는다, 2560에서 본문이 1920에 멈춘다.
- `pw-layout-audit.mjs`·`pw-overlap-audit.mjs`에 Map 항목을 더하고(감사가 무엇을 재는지 읽는다 — 같은 문서 5번), `pw-contrast-audit.mjs`가 라이트·다크의 마디 글자를 잰다.
- `seed_sop_demo`에도 Bundle 사이 참조 몇 개와 이동 하나를 더한다(스모크와 설명서 그림이 쓴다). `test_seed_sop_demo.py`를 함께 고친다.
- 움직임 줄이기에서 고른 마디로 가는 스크롤과 번쩍임이 바로 끝나는지.

## 10. 만드는 순서

걸음마다 dev에 올릴 수 있다(걸음마다 PATCH). 화면이 바뀌는 걸음은 사용 설명서의 글을 같은 커밋에서 고친다. 작은 쓸모부터다.

1. **요약 API + Map 레일 + List.** 서버 `GET …/map`(두 범위)과 가시성 행렬 시험. 레일 항목·화면·도구 줄(찾기·범위·거르기)·**List 표**·옆 칸(요약과 고른 문서의 번호·Status·Becomes·줄 수). `--peer-*` 토큰(소유 표시가 쓴다). 시드의 Bundle 사이 참조. 설명서 `#map`과 고치는 곳 셋, 제품 명세 §9 한 줄, `docs/README.md` 인덱스, `backend/CLAUDE.md`·`frontend/CLAUDE.md` 핵심 구조 한 줄씩, 디자인 기초 5절·8절(레일 순서와 토큰). **이 걸음만으로 1절의 네 물음에 표로 답한다.**
2. **지도 그리기.** 배치 모델, 줄기·마디·선, 호버 강조와 고르기, 확대·Fit all·바탕 끌기, 접기, 글쇠. 화면만이고 서버는 그대로다. 극단 자료 검토와 감사 스크립트 항목.
3. **문장과 가기.** 서버 `GET …/map/lines`와 새는지 보는 시험, 옆 칸의 줄 목록, 줄의 **Open in Assign**(Assign의 `?doc=&unit=`). Assign 화면 파일(`app/bundles/[id]/assign/page.tsx`)을 고치는 것은 이 걸음뿐이다 — 끌어다 놓기 3·4걸음과 같은 파일이니 그쪽이 dev에 들어간 뒤 그 시점의 dev에서 계획을 쓴다.

1걸음과 2걸음에서 문서의 **Open in Assign**(문서 단위)은 지금 있는 주소라 1걸음부터 된다.

## 11. 구현에 맡기는 것

- 라우터·모듈·부품·훅의 파일 이름, 응답 스키마의 클래스 이름, `data-testid`.
- 줄기·마디·틈의 정확한 값과 쉬는 선·흐린 마디의 불투명도(시안 값에서 시작해 극단 자료에서 잰다). 마디 크기가 고정이라는 것만 지킨다.
- 7.3의 질의를 SQLAlchemy로 쓰는 모양과 조인 순서, 줄 수를 짝 기준으로 세는 식.
- 바탕 끌기를 `lib/box-drag.ts`의 상수·판정(`DRAG_THRESHOLD_PX`·`hasPassedThreshold`)에 얹을지 작은 훅으로 따로 둘지. 놓을 자리가 없는 끌기라 `attachBoxDrag`를 통째로 쓰지는 않는다.
- Assign의 줄 주소 매개변수 이름과, 그 Unit이 사라졌을 때의 알림 자리.
- `num` 마디의 번호 꼴 판정을 `refs.py`에서 공개 함수로 꺼내는 이름.
- 임시 번호 판정을 `tobe.temp_match_code`와 `equis/service.py`의 같은 꼴 가운데 어디에 모을지.

## 12. 열린 것

구현을 멈추지 않도록 고른 안을 함께 적는다. 모두 내 판단이다.

- **담당 부서·담당자를 보일까.** 시안은 줄기마다 팀 이름을 적었다. Bundle에는 부서 필드가 없어 구성원의 부서에서 지어내야 하고, 사용자가 연 넷에 들어 있지 않다. **1차는 보이지 않는다.** 필요하면 작성자들의 부서 이름만(사람 이름 없이) 더하는 것을 사용자와 정한다.
- **Bundle이 없는 사람의 열람과 전역 지도.** 사용자가 지도를 Bundle 안에 두기로 했다. **만들지 않는다.** QA 관리자처럼 Bundle 밖에서 전체를 보려는 요구가 오면 `bundle.admin` 관리 화면의 탭으로 정한다(요약만이라 지금 그 권한이 보는 메타와 같은 급이다).
- **읽을 때 계산이 느리면.** 7.3의 목표를 실제 자료에서 넘으면 문서별 참조 표(문서 id · 번호 · 종류 · 상태 · 줄 수)를 두고 쪼개기 편집·판단 저장의 끝에서 맞춘다. Alembic 리비전 하나와 쓰는 길 여럿을 건드리는 일이라 **지금은 하지 않고 재는 것까지만 한다.**
- **같은 번호를 두 Bundle이 올렸을 때의 알림.** 지도는 두 마디에 다 선을 긋기만 한다. **따로 경고하지 않는다** — 겹친 재구성을 막는 것은 다른 일이다.
- **이미 쓴 New 문서의 참조 줄.** 옛 번호를 적은 줄을 지도의 후속 문서와 견주어 알리는 일은 지도 다음에 따로 정한다(2절 비목표).
- **요약도 가려야 하는 Bundle.** 지금은 없다. 생기면 Bundle에 "지도에서 빼기" 표시를 두는 쪽으로 정한다(스키마 변경).
- **후속 문서를 확정 줄 하나로 말해도 되는가.** 한 줄만 확정해도 후속 문서로 보인다. 일찍 보이는 쪽을 골랐고 "바뀔 수 있다"를 적는다. 실제 사용에서 너무 이르다는 말이 나오면 "그 문서의 줄을 모두 정했을 때"로 좁힌다.
