# 디자인·워크플로우·편의성 전체 검토 (v0.10.1)

2026-11-10, 기준 `main` 59860d7(v0.10.1). 화면 전체를 디자인 일관성·작업 흐름·편의성 세 관점에서 훑고, 바로 고칠 것과 결정이 필요한 것을 나눴다. 이 문서의 "반영" 표시는 같은 브랜치에서 실제로 고친 것이고, "보류"는 손대지 않았다.

## 1. 한 줄 결론

토대(색 토큰·공통 부품·이동 경로·오류 번역 층)는 흐트러진 곳이 거의 없다. 사용자가 막히는 곳은 대부분 **"다음에 무엇을 해야 하는지"와 "왜 안 되는지"를 화면이 말해 주지 않는 자리**다 — 잘못된 곳으로 보내는 안내 하나, 저장 안 한 초안이 조용히 사라지는 화면 하나, 문구가 없는 거절 27종, 다시 시도 단추가 없는 오류 화면 여럿, 그리고 도움말이 아예 없다는 점.

## 2. 방법

- **코드 감사 3건**(관점별로 따로): 작업 흐름, 디자인 체계, 편의성. 근거는 모두 `파일:줄`로 남겼다.
- **실제 화면 확인**: 로컬 데모 DB(`reset_db` → `seed_sop_demo`)에 극단 자료(195자 제목·900자 설명 Bundle, 제목 없는 Bundle)를 더해 28개 장면을 5개 조합으로 찍었다 — 1280×720 한국어, 1024×768 영어, 1920×1080 다크, 1440×900 영어, 1440×900 한국어 상단 막대형.
- **기계 대조**: backend의 업무 규칙 거절 코드(`raise_rule`) 84개를 프런트 문구 키 `rule.<code>`와 맞춰 봤다.
- 아래 표의 **확인** 칸: ✔ = 내가 코드나 화면으로 다시 확인함, ○ = 감사 보고만(손댈 때 확인).
- 한계: 실제 SOP·실제 모델로 본 것이 아니다(합성 자료). 2560 폭은 찍지 않았다. 디자인 감사는 코드 읽기 위주라 "보기에 어색한가"는 내 화면 확인분만 근거다.

## 3. 잘 되어 있는 것 (바꾸지 않는다)

- 색은 전부 토큰(raw hex 0, `dark:` 분기 0), 기본 `<select>`·체크박스·`title` 툴팁 0.
- 상태 칩·모달·빈 화면·삭제 단추·목록(`DataList`)·값 고르기(`Select`)가 한 벌이다. `Menu`/`Select`는 키보드·Esc 층·포커스 복귀까지 갖췄다.
- 이동은 `navigate()` 한 길, 오류는 `humanizeApiError` 한 층에서 사람 말로 바뀐다.
- To-Be의 초안 보호(이탈 가드), Split의 되돌리기와 확인 요청, Assign의 키보드 흐름, 업로드 결과 줄, 화면 설정 기억.
- 다크·한국어·상단 막대형에서 깨지는 화면이 없었다. 1024 폭의 가로 넘침 96px은 정한 최소 폭(1120)이다.

## 4. 발견

심각도: **H** 작업이 틀어지거나 자료를 잃는다 · **M** 막히거나 헤맨다 · **L** 거슬린다. 크기: S 한두 파일 · M 여러 파일 · L 설계 필요.

### 4.1 작업 흐름

| ID | 심각 | 내용 | 근거 | 확인 | 처리 |
|---|---|---|---|---|---|
| W-1 | H | 다음 할 일 "의미 검토"가 Review 화면으로 보낸다. 체크 칸은 Outputs에 있다 | `lib/stages.ts:62` | ✔ | 반영 |
| W-2 | H | Assign에서 고쳐 쓰던 초안이 다른 화면으로 가면 경고 없이 사라진다 | `assign/page.tsx:209` (가드 없음) | ✔ | 반영 |
| W-3 | H | 검토자가 되돌린 사유와 "의미 검토가 지워졌다"는 사실을 작성자가 Overview에서 볼 수 없다(History 줄을 눌러야 보인다) | `manage/bundle-manage.tsx:299-315`, `backend/app/sop/review.py:262` | ○ | 반영 |
| W-4 | M | 검토 대기·완료 Bundle에서 편집 단추가 사라지기만 하고 이유를 말하지 않는다. 완료 Bundle의 거절 문구도 "검토 중이라…"로 나온다 | `documents/page.tsx:57`, `split/page.tsx:78`, `outputs/page.tsx:50`, `i18n-messages.ts:497` | ○ | 반영 |
| W-5 | M | 검토 조건 Fail 카드가 눌리지 않고, 꺼진 Request review 단추가 이유를 말하지 않는다 | `bundles/[id]/page.tsx:312-322, 352-355` | ✔ | 반영 |
| W-6 | M | "Start"가 첫 화면에만 내려 준다(경고 있는 문서 표시 없음, "사유 필요" 거르기 없음) | `split/page.tsx:82, 334-346`, `assign/page.tsx:1012-1039` | ○ | 보류(일부는 W-5로 완화) |
| W-7 | M | 불러오기 실패 화면에 다시 시도가 없다: Assign·Outputs·Review의 결과물·Split. Split은 문서 목록 실패를 읽지도 않는다 | `assign/page.tsx:994-1002`, `outputs/page.tsx:139-140`, `review/page.tsx:104-105`, `split/page.tsx:80, 454-457` | ✔ | 반영 |
| W-8 | M | AI 작업 지켜보기가 첫 오류에서 멈추고, 어느 화면도 그 오류를 읽지 않는다. 진행 표시가 "진행 중"으로 얼어붙는다 | `lib/use-ai-jobs.ts:42-45` | ✔ | 반영(다시 묻기 + 화면 표시) |
| W-9 | M | 다음 할 일 순서가 "단위 판단"을 "추출 경고 확인"보다 앞에 둔다(경고가 판단보다 먼저여야 할 수 있다) | `backend/app/sop/review.py:123-126` | ○ | 보류(의도 확인) |
| W-10 | M | Split의 "경계 확인"이 필수처럼 보이지만 검토 조건이 아니다 | `backend/app/sop/editing.py:951-958` | ○ | 반영(6.7 — 검토 조건으로 올림) |
| W-11 | H | To-Be 저장이 409로 실패해도 화면이 최신을 불러오지 않는다. 문구는 "최신 버전을 불러왔습니다"라고 말하고, 다시 눌러도 계속 실패한다. 멤버 모달도 같다 | `tobe/page.tsx:80-100`, `bundle-manage.tsx:289-292` | ✔ | 반영 |
| W-12 | M | 작성자가 검토 대기·완료 Bundle의 멤버를 못 바꾼다. 서버는 허용한다(검토자가 바뀌어야 할 때 막힌다) | `bundle-manage.tsx:34-36, 262`, `routers/sop_bundles.py` `replace_bundle_members` | ✔ | 반영 |
| W-13 | M | 자리를 잊는다: Split의 문서, Outputs의 탭·언어, Assign의 거르기 | `outputs/page.tsx:51-52` 등 | ○ | 일부 반영(Outputs) |
| W-14 | M | "다음" 길이 없다. 업로드 모달은 Close뿐인데 문구는 "올리면 Split이 열린다"고 말한다 | `upload-modal.tsx:107-109`, `i18n-messages.ts:375` | ○ | 일부 반영(업로드 → Split) |
| W-15 | L | 업로드에서 파일마다 종류·언어를 다시 고른다 | `upload-modal.tsx` | ○ | 보류 |
| W-16 | L | 실패한 문서 줄에 삭제만 있고 문구는 "교체하거나 지우라"고 한다. 경고 칩이 눌리지 않는다 | `documents/page.tsx:177-196`, `i18n-messages.ts:377` | ○ | 일부 반영(문구) |
| W-17 | L | To-Be가 비면 Assign의 보낼 곳 나무가 그냥 빈다 | `assign/destination-tree.tsx:46,67` | ○ | 반영 |
| W-18 | L | 여러 줄 고르기가 Shift+클릭뿐이고 범위 선택이 아니다. 저장 조건이 안 맞으면 조용히 아무 일도 없다 | `assign/page.tsx:504-523` | ○ | 보류 |
| W-19 | M | Complete review가 확인 없이 바로 상태를 바꾼다 | `review/page.tsx:86-90` | ✔ | 반영 |
| W-20 | L | 멤버 모달: 고르기 → 추가 → 저장 세 번 | `manage/members-modal.tsx:41-86` | ○ | 보류 |
| W-21 | L | 빈 화면에 갈 곳이 없다(Assign 빈 거르기, Outputs C) | `assign/page.tsx:1095-1096`, `outputs/output-c.tsx:67` | ○ | 반영 |
| W-22 | L | Bundle 목록에 찾기·거르기가 없다 | `app/page.tsx:96-133` | ○ | 보류 |
| W-23 | M | Outputs A의 보낸 곳·변경 종류가 내부 코드값이다(`delete`, `as_is`, `tone`) | `outputs/page.tsx:164-173` | ✔ | 반영 |
| W-24 | L | History 줄이 마우스로만 열린다 | `history/page.tsx:116` | ✔ | 반영 |
| W-25 | L | Assign에서 보낼 곳을 모를 때 "→ Assigned"만 보인다 | `assign/page.tsx:1087` | ○ | 보류 |

### 4.2 디자인 체계

| ID | 심각 | 내용 | 근거 | 확인 | 처리 |
|---|---|---|---|---|---|
| D-1 | H | 모달에 포커스 가두기·첫 포커스·닫은 뒤 복귀가 없고, Esc가 층 순서를 따르지 않는다(디자인 기초 :244 위반). 모달 안 드롭다운을 Esc로 닫으면 모달까지 닫힌다 | `components/modal.tsx:27-51` | ✔ | 반영 |
| D-2 | M | 줄 클릭으로만 여는 목록이 키보드로 안 열린다 | `ui/data-list.tsx:109-148`, `history/page.tsx:116`, `admin/guidelines-panel.tsx:211` | ○ | 반영(`getRowOpenProps`) |
| D-3 | M | "상태 표기는 영어" 규칙인데 한국어 사전이 상태 칩을 옮긴다(성공·실패·활성·신규·삭제) | `i18n-messages.ts:1006-1007, 1190, 1579, 1762` | ✔ | 일부 반영(상태 표기만) |
| D-4 | L | 상태 글자가 코드에 박혀 있다(`Done`/`Failed`, "All") | `manage/ai-job-panel.tsx:64-65`, `assign/page.tsx:1023`, `split/page.tsx:594,748` | ○ | 반영(Assign·Split·AI 작업) |
| D-5 | M | 글자 크기 토큰이 Tailwind에 이어져 있지 않아 `text-xs`·`text-[13px]` 등이 섞여 쓰인다 | `app/globals.css` `@theme inline` | ○ | 보류(전 화면 영향) |
| D-6 | M | 둘 중 하나 고르기 단추가 7벌·4모양이다 | `.view-toggle`·`.lang-toggle`·`.chip-toggle`·`.mini-chip`·손으로 만든 것 셋 | ○ | 보류(부품화 설계) |
| D-7 | M | 글 입력 칸 9곳이 공통 클래스를 쓰지 않는다 | `lib/ui-classes.ts` `INPUT_FIELD` | ○ | 보류 |
| D-8 | M | 관리 화면 Bundle 찾기 칸에 포커스 표시가 없다 | `admin/bundles-panel.tsx:118-127` | ○ | 반영 |
| D-9 | L | 손으로 만든 읽기 표 4곳 | `history/page.tsx:103-116` 등 | ○ | 보류 |
| D-10 | L | Account 머리글이 다른 화면과 다르고, To-Be 머리글에 아래 줄이 없다 | `app/account/page.tsx:20-22`, `tobe/page.tsx:213` | ○ | 반영 |
| D-11 | L | 로그인 단추가 `.btn` 밖이다 | `app/login/page.tsx:145-200` | ○ | 보류 |
| D-12 | L | 불러오기 실패 줄이 화면마다 따로 만들어져 있다 | `history/page.tsx:93-99`, `guidelines-panel.tsx:167-176`, `bundles-panel.tsx:139-145` | ○ | 반영(`LoadError`) |
| D-13 | L | `InlineNotice`의 오류가 안내와 같은 색이다 | `components/inline-notice.tsx:12-19` | ○ | 보류(의도일 수 있음) |
| D-14 | L | `BusyLabel` 대신 스피너를 쓴 곳 4곳 | `admin/ai-panel.tsx:82` 등 | ○ | 보류 |
| D-15 | L | 토큰 밖 모서리·그림자(`rounded`, `rounded-full`, `shadow-lg`) | `modal.tsx:50`, `confirm-modal.tsx:46` 등 | ○ | 반영 |
| D-16 | L | 아이콘 크기·획 굵기가 규칙(12/14/16/28, 1.5) 밖인 곳이 많다 | `user-menu.tsx:26,138-168` 등 | ○ | 보류 |
| D-17 | L | 굵기 500·700이 섞여 있다 | `subject-picker.tsx:89`, `preview-popover.tsx:47`, `components.css` 8곳 | ○ | 일부 반영(TSX 2곳) |
| D-18 | L | 상태 칩 모양을 단추로 썼다 | `assign/page.tsx:970-974` | ○ | 반영 |
| D-19 | L | 1120 폭에서 Split 가운데 용지가 424px쯤으로 좁다 | `split/page.tsx:330` | ○ | 보류(화면 확인 필요) |
| D-20 | L | `data-testid`가 빠진 조작 요소, 박힌 `aria-label` | `ui/markdown-view.tsx:84` 등 | ○ | 반영 |

### 4.3 편의성

| ID | 심각 | 내용 | 근거 | 확인 | 처리 |
|---|---|---|---|---|---|
| C-1 | H | 이미 배정된 줄을 여럿 골라 삭제·이동하면 `unit_has_targets`인데 문구가 없어 "누가 먼저 바꿨다"로 나온다 | `backend/app/sop/decisions.py:1043` | ✔ | 반영 |
| C-3 | H | 실패한 문서의 안내가 "다시 올리세요"인데, 같은 파일을 다시 올리면 `duplicate_file`로 거절된다(실패 줄도 같은 파일로 친다) | `backend/app/sop/ingest.py:168-172`, `i18n-messages.ts:472, 484-485` | ✔ | 반영(문구) |
| C-5 | H | 도움말·설명서로 가는 길이 화면 어디에도 없다 | 전 화면 | ✔ | 반영(설명서 + 도움말 길) |
| C-6 | M | Split의 합치기·짝 만들기 거절(`mixed_language`, `invalid_unit_kind`)에 문구가 없다 | 기계 대조 | ✔ | 반영 |
| C-7 | M | Assign의 "같은 글 모두 확정"이 확인 없이 여러 줄을 바꾼다 | `assign/page.tsx:444-451, 1058-1063` | ○ | 반영(확인 창) |
| C-8 | M | 업로드 크기 한도(기본 25 MiB)를 화면이 말하지 않고, 프록시가 막는 413에 문구가 없다 | `backend/app/settings.py:57`, `nginx/default.conf:26`, `lib/api-errors.ts` | ○ | 일부 반영(413 문구) |
| C-11 | M | History에서 이어 불러오기가 실패하면 아무 표시가 없다 | `history/page.tsx:92` | ✔ | 반영 |
| C-13 | M | Bundle·문서 목록에 찾기·정렬이 없다 | `app/page.tsx` | ○ | 보류 |
| C-15 | M | To-Be Excel 가져오기가 확인 없이 목록을 통째로 바꾼다 | `tobe/page.tsx:103-117` | ✔ | 반영 |
| C-16 | M | 여러 줄 고르기가 Shift+클릭 토글뿐이다 | `assign/page.tsx:504-523` | ○ | 보류 |
| C-17 | M | 지침 활성화 거절 `no_rule_ids`에 문구가 없다 | `backend/app/routers/sop_guidelines.py:129` | ✔ | 반영 |
| C-18 | M | 문구 없는 거절 27종과 404가 "알 수 없는 오류"로 떨어진다. 화면이 낡았을 때 나는 것들이다 | 기계 대조, `lib/api-errors.ts` | ✔ | 반영(빠진 코드 27개 + 404·413) |
| C-19 | L | 경계 확인을 하나씩만 한다(API는 여럿을 받는다) | `split/page.tsx:252` | ○ | 반영(6.7 — 남은 경계 한 번에 확인) |
| C-20 | L | To-Be에 Ctrl/⌘+S가 없다 | `tobe/page.tsx` | ○ | 반영 |
| C-21 | L | Split에서 단추에 포커스가 있을 때 Enter가 경계 확인까지 한다 | `lib/split-keys.ts` | ○ | 반영 |
| C-22 | L | 단축키 안내가 화면마다 다르고 빠진 키가 있다 | `assign/assign-legend.tsx:39-43` | ○ | 일부 반영(빠진 키) |
| C-23 | L | 끌어다 놓기 업로드, 파일별 다시 시도가 없다 | `upload-modal.tsx` | ○ | 보류 |
| C-24 | L | 관리 화면의 역할·부여 저장에 완료 알림이 없다 | `access-grants.tsx:83`, `access-roles.tsx:52` | ✔ | 반영 |
| C-26 | L | History 찾기 | — | ○ | 보류 |
| C-27 | L | Bundle 코드 등 복사 단추 | — | ○ | 보류 |
| C-28 | L | 상단 버전 글자가 변경 내용으로 이어지지 않는다 | `top-bar.tsx:34-35` | ○ | 보류 |
| C-30 | L | 쓰이지 않는 문구 키 `rule.invalid_group.revision_conflict` | `i18n-messages.ts:710, 1618` | ✔ | 반영(삭제) |

### 4.4 화면에서 직접 본 것

| ID | 심각 | 내용 | 조합 | 처리 |
|---|---|---|---|---|
| V-1 | M | 제목이 아주 긴 Bundle에서 상단 막대의 사용자 단추가 짓눌린다 | 1280 | 반영 |
| V-2 | M | 없는 Bundle·멤버가 아닌 Bundle이 글 한 줄 + Retry로 보이고 단계 레일은 그대로 남는다 | 전 조합 | 반영 |
| V-3 | L | 긴 설명(8줄)이 Overview의 다음 할 일 카드를 아래로 민다 | 1280 | 반영(접기) |
| V-5 | L | Outputs를 다시 열면 탭·언어가 처음으로 돌아간다 | — | 반영 |
| V-10 | L | To-Be의 입구 표시 "Match"가 v0.10 앞 용어다 | — | 보류(의도 확인) |

## 5. 보류한 것과 이유

결정이 필요하거나 화면 전체에 번지는 것은 이번에 손대지 않았다.

- **사용자 결정이 필요한 것**: W-9(다음 할 일 순서), W-10·C-19(경계 확인의 위상 — 2026-11-10 사용자가 필수로 정함, 6.7), V-10·D-13(의도 확인), C-8의 한도 숫자 표시(설정값을 프런트에 내보내는 API가 필요).
- **부품화 설계가 먼저인 것**: D-5(글자 크기 토큰 연결), D-6(고르기 단추 한 벌), D-7(입력 칸 한 벌), D-9(읽기 표), D-11, D-14, D-16, D-17의 CSS 쪽, D-19.
- **기능 추가에 가까운 것**: W-6 나머지, W-13 나머지, W-14 나머지(단계마다 "다음" 단추), W-15·C-23, W-16의 "파일 교체", W-18·C-16(범위 선택), W-20, W-22·C-13, W-25, C-7의 되돌리기 알림, C-22의 단축키 표, C-26~28.
- **앞서 미뤄 둔 것(그대로)**: Outputs B 라벨 일부만 한글, C에 출처 표시 없음, 이름 없는 Bundle의 Excel 이름, Split 키와 드롭다운 충돌, AI 작업 패널의 doc_meta 줄, Gmarket Sans 기준선.

## 6. 반영 결과

브랜치 `feat/review-fixes-and-manual`에서 고쳤다. 발견 72건 중 반영 40 · 일부 반영 7 · 보류 25(이유는 5절).

### 6.1 표의 "반영"이 실제로 뜻하는 범위

표의 한 낱말로는 범위가 안 보이는 것만 적는다.

| 발견 | 실제로 한 것 |
|---|---|
| W-3 | 되돌린 사유를 Overview에 띄운다. History 조회에 `action_prefix` 거르기를 더해(backend `routers/sop_bundles.py`) 마지막 되돌림 한 줄만 읽는다 |
| W-5 | 꺼진 Request review 단추 아래에 이유를 한 줄로 적었다(툴팁이 아니라 늘 보이는 글). Fail 카드는 고칠 화면으로 간다 |
| W-8 | AI 작업 지켜보기가 오류 뒤에도 다시 묻는다(간격을 30초까지 늘림, 4xx는 다시 묻지 않음). 끊긴 동안 "마지막으로 확인한 상태"임을 Overview·Split·Assign이 말한다 |
| W-11 | To-Be 저장이 409면 Bundle revision만 움직인 경우(멤버·제목 변경) 새 revision으로 한 번 다시 보내고, To-Be 자체가 바뀌었으면 최신을 불러올지 묻는 창을 띄운다. 멤버 모달은 409 때 최신 Bundle을 받아 두어 다시 누르면 통한다 |
| W-21 | Assign의 빈 거르기와 Outputs C의 빈 화면에 갈 곳을 달았다 |
| C-5 | 사용 설명서(`/manual`)와 도움말 길(상단 바·사용자 메뉴, 지금 화면을 설명하는 조각으로 새 탭)을 만들었다 — 6.3 |
| C-7 | "같은 글 모두 확정" 앞에 확인 창. 되돌리기 알림은 하지 않았다(5절) |
| C-18 | 문구 없던 거절 코드 27개 전부와 404·413 문구(en·ko) |
| D-2 | 줄을 여는 길을 `lib/row-open.ts` `getRowOpenProps` 하나로 — Tab으로 닿고 Enter·Space로 열린다. 줄 안에 이미 링크가 있는 목록(`DataList` `hasRowLink`)은 그 링크가 키보드 길이라 줄에 포커스를 또 두지 않는다 |
| D-3 | 실제 상태 칩만 영어로 되돌렸다. 상태가 아닌 낱말(거르기 이름 등)은 그대로 옮긴다 |
| D-4 | Assign·Split·AI 작업 패널의 박힌 글자만. 나머지는 손댈 때 |
| D-17 | TSX 2곳만. `components.css` 8곳은 굵기 토큰을 정한 뒤(5절) |
| D-20 | 빠진 `data-testid`를 달고, Markdown 보기의 복사 단추 라벨을 화면 문구로 받는다 |
| V-1 | 상단 막대 사용자 단추에 `flex: none` — 195자 제목에서도 눌리지 않는다 |

### 6.2 표를 닫은 뒤에 찾아 고친 것

설명서 그림을 좁은 폭으로 찍다가 나왔다. 표에는 없다.

- **Split 용지가 오른쪽 패널 밑으로 들어간다**(창 폭 약 1280 아래) — 암묵 열(auto)이 위 줄의 한 줄 글자만큼 넓어진 것이라 열을 `minmax(0,1fr)`로 못 박았다(`bundles/[id]/split/page.tsx`).
- **Assign 처리 단추의 긴 라벨(Edit and confirm)이 단추 밖으로 나온다** — 세 등분 대신 글자 길이만큼 잡고 남는 폭을 나눈다(`bundles/[id]/assign/page.tsx`).
- **`split.hold*` 문구 둘이 없어진 "Classify" 화면을 가리킨다** — Assign으로 고쳤다(en·ko).

### 6.3 사용 설명서

- 원문은 Markdown 한 벌 `frontend/public/manual/user-manual.md`(한국어, 14조각) — 나중에 챗봇이 같은 파일을 읽을 수 있게 화면 코드가 아니라 글에 내용을 둔다. 화면(`/manual`)은 `##` 조각마다 종이 조각으로 나눠 보이기만 한다.
- 화면 구성은 제품 개념("제안은 연필로, 확정은 잉크로")을 그대로 썼다. 읽지 않은 조각은 점선, 읽음 표시를 하면 실선, 읽은 뒤에 글이 바뀐 조각은 `Updated`로 돌아온다(조각 본문의 지문을 이 브라우저에 기억). 글쇠는 Split과 같은 J/K·↵·U에 찾기(/)를 더했다.
- 글이 화면과 어긋나지 않게 하는 가드는 `src/lib/manual-content.test.ts` — 굵은 글씨로 쓴 화면 라벨이 영어 화면 문구와 글자까지 같은지, 권한 키를 모두 설명하는지, 그림이 빠짐·남음 없이 맞는지, 도움말이 여는 조각이 있는지, 바깥 주소·IP가 없는지, 버전 표시가 서비스 MINOR와 같은지 본다.
- 그림 17장은 `MANUAL=app node scripts/pw-manual-shots.mjs`로 합성 데모 DB에서 다시 뽑는다.

### 6.4 검증 (모두 실행함, 2026-11-10)

| 검사 | 결과 |
|---|---|
| frontend `npx tsc --noEmit` · `npm run lint` | 오류·경고 0 (6.7 뒤 다시 실행) |
| frontend `npx vitest run` | 51 파일 · 420 통과 (6.7 뒤 다시 실행) |
| frontend `npm run build` | 경고 0, `/manual`은 정적(○) (6.7 뒤 다시 실행) |
| backend `pytest tests/ -q` · `ruff check app/ tests/` | 1935 통과 · 통과 (6.7 뒤 다시 실행) |
| `pw-smoke-baseline.mjs`(`reset_db` 직후) | PASS 136 / FAIL 0 — 설명서 장면 포함 (6.7 뒤 다시 실행) |
| `pw-smoke-sop.mjs`(`seed_sop_demo` 직후) | PASS 146 / FAIL 0 (6.7 뒤 다시 실행 — 거두기, 남은 경계 한 번에 확인, 검토 요청 창 폭 포함). 가짜 AI를 나눔 모드(`FAKE_AI_SPLIT=1`)로 켜서 AI 나눔 확정 단계도 돌았다 |
| `pw-contrast-audit.mjs` | 14화면 × 라이트·다크 = 28 PASS(설명서, 읽음 표시 세 모양 포함) (6.7 뒤 다시 실행) |

실제 SOP·실제 모델·운영 서버(Keycloak, 평문 HTTP)에서는 보지 않았다. 도움말이 새 탭으로 열릴 때 Keycloak이 새 탭을 조용히 다시 로그인시키는 길은 로컬(dev 로그인)에서 확인할 수 없다.

### 6.5 찾았지만 고치지 않은 것

- **포커스 테두리가 지워지지 않는다(앱 전체)**: `styles/base.css`의 `:focus-visible { outline … }`이 레이어 밖에 있어 `@layer components`와 Tailwind 유틸리티를 모두 이긴다. `outline-none`을 쓴 20여 곳(예: 관리 Bundle 찾기 칸 — 실측 `solid 2px`)이 자기 테두리와 전역 테두리를 겹쳐 그린다. 그 규칙을 `@layer base { … }`로 감싸면 한 줄로 풀리지만 포커스 모양이 앱 전체에서 바뀌므로 결정을 기다린다. 설명서 화면만 `manual.css` 끝의 레이어 밖 규칙으로 먼저 풀었다. → **2026-11-10 사용자가 감싸기로 정해 고쳤다(6.7).**
- **시스템 설명서(`docs/manual/system-walkthrough.html`) `assign-link` 장면의 6번 표시가 그려지지 않는다**: 스크립트가 찾는 `assign-new-zoom`을 가진 요소가 없다(`components/assign/pane-zoom.tsx`는 `-out`·`-value`·`-in`만 단다). 이 브랜치 앞부터 그랬다.
- 시스템 설명서의 그림·번호 자리는 이 브랜치 화면으로 다시 뽑았다(38장 + `marks.js`, 번호 개수는 그대로). 글은 검토 요청 거두기(6.6)가 닿는 세 곳(역할 설명, 그림 12-1 설명, 묶음 상태 그림)만 고쳤다 — 나머지 글과 머리의 버전 표기는 v0.8.0 그대로다.
- **묶음 상태 그림의 "되돌리기" 글자를 "다시 열기" 곡선이 지나간다**(시스템 설명서). 이 브랜치 앞부터 그랬고 그대로 뒀다.
- **Overview의 "Waiting for review" 카드가 기다리는 작성자에게도 `Start`(Review 단계로 가는 길)를 보인다.** 작성자가 Review에서 할 수 있는 일은 읽기와 요청 거두기뿐이다. 다음 할 일 순서(W-9)와 같이 정할 일이라 그대로 뒀다.

### 6.6 검토 요청 거두기 (5절에서 사용자 결정으로 남겼던 것, 2026-11-10 사용자가 만들라고 정함)

작성자가 검토 대기(`in_review`)를 스스로 작업 중(`in_progress`)으로 되돌리는 새 전이다. 스키마 변화는 없다.

- **backend**: `app/sop/review.py` `withdraw_review`, `POST /api/bundles/{id}/review/withdraw`(`routers/sop_bundles.py`). 다른 전이와 같은 길이다 — 묶음 잠금, revision 검사(409 `revision_conflict`), 검토 대기가 아니면 409 `invalid_transition`, 검토자는 403 `role_required`, 멤버가 아니면(sysadmin 포함) 404 `bundle_not_found`. 작업 기록에 `review.withdraw`를 남긴다.
- **frontend**: `components/withdraw-review.tsx` `WithdrawReviewButton`(확인 창 포함) 하나를 Overview의 Review request 칸(`overview-withdraw-review`)과 Review 머리(`review-withdraw`)에 둔다. 검토 대기이고 그 Bundle의 작성자일 때만 보인다. 거둔 뒤 Overview에 누가 언제 거뒀는지와 의미 검토가 지워졌다는 알림이 남는다.
- **문서**: 사용 설명서(작성자 순서 3번, 자주 묻는 것), 제품 명세 §7.15·§9·API 목록, 시스템 설명서(역할, 그림 12-1, 묶음 상태 그림 — `overview-ready` 그림 다시 뽑음).

사용자가 정하지 않아 내가 정한 것:

| 정한 것 | 이유 |
|---|---|
| 요청한 사람이 아니어도 그 Bundle의 작성자면 거둘 수 있다 | 요청·다시 열기도 작성자 역할로만 가른다. 요청한 사람이 자리에 없을 때 Bundle이 묶이지 않는다 |
| 사유를 받지 않는다 | 되돌리기·다시 열기의 사유는 남의 결정을 뒤집는 근거다. 거두기는 자기 쪽 요청을 물리는 것이다 |
| 의미 검토 4항목을 지운다 | 작업 중으로 돌아오는 다른 두 길과 같다. 거둔 뒤 글을 고칠 것이므로 고친 글을 다시 봐야 한다 |
| 요청 때 취소한 AI 작업은 되살리지 않는다 | 취소 시점의 스냅숏이 이미 낡았다. 필요하면 다시 요청한다 |

검증: `test_sop_review.py`에 거두기 시험을 먼저 쓰고(실패 확인) 구현했다. 6.4의 표가 거두기까지 넣은 뒤의 숫자다. 브라우저 스모크는 작성자로 거두기 → 알림·다음 할 일(`semantic_checks`)·History 기록 확인 → 의미 검토를 다시 하고 재요청, 검토자에게는 단추가 없음까지 돈다. 단추·확인 창은 1440×900 라이트·영어와 760×700 다크·한국어에서 그려 봤다. `pw-smoke-baseline.mjs`와 `pw-contrast-audit.mjs`는 다시 돌리지 않았다 — 앞은 Bundle이 없는 DB에서 돌고, 뒤는 작업 중 Bundle만 열어 이 단추가 그려지지 않는다(단추는 다른 화면에서 감사한 `.btn` 그대로다).

### 6.7 경계 확인 필수 · 창 폭 · 포커스 테두리 (2026-11-10 사용자 결정 세 가지)

**1) 경계 확인이 검토 요청 조건이 됐다 (W-10·C-19).** 결과물과 Excel이 Unit을 자른 자리를 그대로 따르므로, 글자를 가진 Unit의 경계가 모두 확인돼야 검토를 요청할 수 있다. 스키마 변화는 없다.

- **backend**: 남은 수는 `snapshot.count_unchecked_boundaries` 한 곳에서 센다(검토 조건과 문서 목록이 같이 쓴다). `review.py`에 막는 사유 `unchecked_boundaries`(수·문서 id)와 다음 할 일 `check_boundaries`. 문서 하나의 남은 경계를 한 번에 확인하는 `editing.confirm_all_boundaries` + `POST /api/bundles/{id}/documents/{doc_id}/units/boundary/all`(작성자, 작업 중일 때만 — 검토자 403 `role_required`, 검토 대기 409 `bundle_not_editable`). 문서 목록 응답에 `unchecked_boundaries`.
- **frontend**: Overview의 조건 줄 **All boundaries checked**와 다음 할 일, Split의 남은 수(`split-unchecked-count`)·문서별 남은 수(`split-doc-left-<id>`)·**Check the rest**(`split-check-rest`, 확인 창).
- **데모·시험**: 합성 드라이버 `confirm_boundaries`를 E2E와 데모 시드가 같이 쓴다. 시드의 묶음 2~4는 경계를 미리 확인하고 "SYNTHETIC 1 쪼개기 직후"만 남겨 둔다.
- **문서**: 사용 설명서(Split, 검토 요청 조건 여덟 가지), 제품 명세 §6.4·§7.15·API 목록, 시스템 설명서.

사용자가 정하지 않아 내가 정한 것:

| 정한 것 | 이유 |
|---|---|
| 세는 것은 글자 범위를 가진 Unit(문장·제목·그림·칸 문장), Old·New 모든 문서의 최신 추출 | 표·행 묶음 단위는 글자 범위가 없어 Split에서 고를 수도, 확인할 수도 없다 |
| 명시한 확인 표시만 센다 | 명세에는 "판단을 확정하면 경계도 확인된 것으로 본다"가 있었지만 그 코드는 없었다. 조건으로 삼으려면 눈으로 본 표시여야 한다(명세 문장을 고쳤다) |
| 남은 것을 한 번에 확인하는 길을 둔다(문서 하나씩, 확인 창) | 수백 문장을 하나씩만 넘기게 하면 조건이 막일이 된다. 대신 History에 `unit.check_all` 한 줄(누가·어느 문서·몇 개)이 남는다 — 하나씩 한 확인은 기록이 없다 |
| 쪼개기·합치기·AI 나눔 확정으로 생긴 Unit은 미확인으로 시작한다 | 경계가 바뀐 자리가 곧 다시 볼 자리다 |
| 다음 할 일 순서는 문서 문제 해결 다음, To-Be 앞 | 자른 자리가 Assign의 줄을 정한다 |

**2) 창 폭을 줄였다.** `Modal`에 `size`를 두고 창마다 골랐다 — `sm` 384(확인 창 전부, 검토 요청, 역할·부여 삭제, 문서 삭제) · `md` 448(기본 — 보류 사유, 되돌리기·다시 열기 사유, 일괄 확정, 역할·부여 양식, 구성원, 기록 상세) · `lg` 512(문서 미리 보기) · `xl` 768(업로드 — 파일 표가 들어간다). 앞에는 대부분 512~672였다. 448로 줄인 역할 양식은 권한 체크박스가 서로 닿아 두 열 격자로 바꿨다.

**3) 포커스 테두리(6.5 첫 항목).** 전역 `:focus-visible`을 `@layer base` 안으로 옮겼다. `outline-none`을 쓴 곳의 겹친 테두리가 사라졌고, 그런 곳은 저마다 자기 표시(테두리 색·바탕·고리)를 그린다. `manual.css`의 레이어 밖 예외 규칙은 레이어 안으로 돌아왔다.

검증(6.4의 표가 여기까지 넣은 뒤의 숫자다):

- 경계: `test_sop_review.py`·`test_sop_editing.py`에 시험을 먼저 쓰고 구현했다. 브라우저 스모크는 작성자로 "SYNTHETIC 1"의 남은 경계를 한 번에 확인 → 남은 수 0·History 줄·Overview 조건 통과까지 돈다.
- 창: 11개 창을 1440×900 라이트·영어와 760×600 다크·한국어에서 그려 폭·넘침·화면 안에 드는지를 쟀다(전부 넘침 없음). 검토 요청 창 폭(≤384)은 스모크가 본다.
- 포커스: 12개 화면(홈·Overview·Documents·Split·To-Be·Assign·Outputs·Admin·역할 양식·설명서·계정, 라이트와 다크)을 Tab으로 돌며 포커스가 선 요소의 계산된 테두리를 읽었다. 전역 테두리가 없는 곳은 다섯 종류(기록 줄·버전 칸·To-Be 입력 칸·역할 양식 입력 칸·(i) 설명)였고 잘라 찍어 자기 표시가 보이는 것을 확인했다.
- 설명서 그림 17장과 시스템 설명서 그림 38장 + `marks.js`를 v0.11.0 화면으로 다시 뽑았다(합성 데모 DB).

이 작업 중 찾았지만 고치지 않은 것:

- **한/영 짝 줄에서 한 언어만 New 문장에 이으면 저장이 거절된다(Assign, 이 브랜치 앞부터).** 한/영이 한 줄로 묶인 Old에서 New 후보 하나(예: 영어)를 눌렀는데 그 문장에 다른 언어 짝이 없으면(`partner_target_id` 없음) 화면은 그 언어만 잇고, 저장 요청에는 나머지 언어 Unit이 미배정인 채 같이 실린다. 서버(`decisions._check_dispositions`)는 확정 저장에 미배정이 섞였다고 422 `invalid_group` / `hold_required`로 거절한다. `rule.invalid_group.hold_required` 문구가 없어 사용자는 "The decision could not be saved. Reload and try again."만 본다. 고치는 길은 둘 — (가) 미배정으로 남는 다른 언어 Unit을 저장에서 빼거나 보류로 같이 보낸다(동작이 바뀌므로 결정이 필요), (나) 최소한 사유 문구를 en·ko로 더한다.
- **스모크의 줄 찾기가 실행 속도에 따라 다른 줄에 닿았다(고침).** `pw-smoke-sop.mjs`가 `j`로 줄을 넘기며 `networkidle`을 기다렸는데, 첫 로드 뒤로는 곧바로 풀려 후보 응답보다 먼저 다음 줄로 넘어갔다. 그래서 위 짝 줄에 닿은 실행만 실패했다. 줄마다 `/new-candidates` 요청이 끝나기를 기다리게 고쳤다(제품 코드는 아니다).
