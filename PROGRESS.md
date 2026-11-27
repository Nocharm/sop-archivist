# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.5.0(2026-11-21 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 이 파일이 크기 상한을 넘으면 최근 릴리스까지의 항목을 거기로 옮긴다(`docs/deploy/release.md` "문서 정리").


## 2026-11-21 — 버전 규칙: 개발 번호를 그대로 운영에 (`chore/version-policy`)

- 운영 번호의 끝자리가 늘 0이고(정식 업데이트마다 MINOR를 새로 만들었다) 개발에서 본 번호와 달라 헷갈린다는 사용자 판단 — `dev` 번호를 그대로 태그해 운영에 올리고, 운영 뒤 첫 `dev` 푸시에 MINOR, 급한 수정은 운영 줄의 PATCH(번호가 `dev`와 겹치지 않는다). v1.5.0 뒤 첫 앱 변경 푸시가 1.6.0.
- 정식 업데이트를 가볍게: 버전 커밋 없음, CHANGELOG는 줄들 위에 제목·배포 메모만, 설명서 그림은 바뀐 장면만, CHANGELOG·PROGRESS 보관은 `release-docs.test.ts` 크기 상한(각 4만 바이트)이 알릴 때 따로. 설명서 머리 `version`은 `X.Y.Z`로, `manual-content.test.ts`가 CHANGELOG 최근 릴리스 제목과 줄(MAJOR.MINOR)을 대조한다.

## 2026-11-21 — md 점검 고침 (`docs/md-audit-fixes`)

- 오늘 버전 규칙에서 설계·계획 삭제를 크기 시험 쪽으로 옮겨 계기가 없어졌던 것을 정식 업데이트 준비로 되돌림. 루트 CLAUDE.md의 지난 기록 문장·세 곳에 겹친 설명서 그림 규칙을 줄이고, `sync-checklist.md`를 이 저장소의 파일(`.env.example`·compose `environment:`·기능 맵·설명서)로 바꿈.
- 끝난 신뢰 기반 계획 문서를 지움 — 아직 쓰일 스텝 4-3의 생각은 문단 분리 요청서로 옮기고, 코드 주석은 파일 이름만, 문서 링크는 글로 낮춤.

## 2026-11-21 — 폴더 CLAUDE.md 줄이기 (`docs/slim-folder-claude-md`)

- **폴더 CLAUDE.md 줄이기(브랜치 `docs/slim-folder-claude-md`, 문서만)** — `backend/CLAUDE.md`(42KB)·`frontend/CLAUDE.md`(16KB)는 그 폴더를 다루는 세션마다 실리는데 "핵심 구조"가 한 줄 수천 자의 글 벽이었다. 흐름·파일 목록·이력은 새 살아 있는 문서 `docs/architecture/backend.md`·`frontend.md`로 원문 그대로 옮기고, 폴더 CLAUDE.md에는 자리·불변식·금지 규칙과 절 번호 링크만 남겼다(약 15KB·8KB). 구조를 바꾸면 두 파일을 같은 커밋에서 고친다.

## 2026-11-22 — 끝난 설계 하나 정리 · "스텝" 표기 (`docs/spec-trim`)

- 기능별 설계 가운데 코드·살아 있는 문서가 전혀 가리키지 않는 `four-step-workflow`만 지움(보수적으로, 사용자 결정) — 나머지는 코드 주석·제품 명세·`docs/architecture`가 절을 가리켜 남김. 루트 CLAUDE.md의 "걸음"을 사용자가 쓰는 "스텝"으로.

## 2026-11-22 — 끝난 설계에서 인용된 부분만 남김 (`docs/spec-extract`)

- 제품·기반 명세 밖의 끝난 기능 설계 16개와 계획 2를 지움(사용자 결정) — 코드·문서가 가리키는 절(`D3`·`§5.2`·`G3`·"1걸음에서 정한 것")만 `docs/architecture/decisions.md`의 `## <stem>` 절로, 계획 2의 "API 계약" 블록은 `docs/architecture/api-contract.md`로 글자 그대로 옮기고 전체 경로 인용을 고침. 전문은 git 이력. 문서 규칙에 같은 정책을 적음.

## 2026-11-22 — 스모크 실패 단계만 다시 돌기 · 전체 실행은 FULL=1 (`chore/smoke-rerun-failed`)

- 11-20~22 세션 기록을 재 보니 도구 시간 9.7시간 중 스모크가 3.7시간(38%), 217번 중 71번이 ONLY 없이(전부) 돌았고 실패 뒤 다시 돌기가 잦았다. 실행기가 실패한 단계 이름을 `.dev/smoke-failed.txt`에 남기고 `ONLY_FAILED=1`로 그 단계만 다시 돌며, ONLY도 FULL=1도 없으면 멈춘다(규칙을 실행기로 — 교정 사다리).
- 같은 기록에서 pytest 1.2시간 · 하위 에이전트 31번 중 27번 opus — CLAUDE.md에 `--lf`와 일에 맞춘 model 고르기 한 줄씩.

## 2026-11-22~26 — 관리 화면 다듬기 (`feat/admin-polish`, v1.6.19에 `dev`로)

- 관리 메뉴 코드 검토(하위 탭 주소·부여 이름 언어 버그 둘, 두 줄 표·한 명씩 부여 불편)와 시안 세션 결정을 `docs/design/2026-11-22-admin-polish-design.md`에 모음 — 부여 목록+상세, 사내 AI 일괄 등록은 로그인 ID 기준(이름은 브라우저가 ID로 바꾸고 못 바꾼 이름은 지움, 사용자 결정), batch API, 이어 불러오기, 2단 전환 규칙, 머리글자 원은 겹친 명단에서만. 눌러 보는 프로토타입은 `docs/design/admin-polish/prototype.html`. 구현은 스텝 0~8 브랜치로.
- 구현(모음 브랜치 `feat/admin-polish`, 2026-11-25~): 스텝 0 — 하위 탭을 주소에(`?tab=access&sub=`), 부여 대상 이름을 화면 언어로(직원 디렉터리·부서 표, 없으면 서버 이름). 스텝 1 — `POST /api/access/grants/batch`(회수 먼저·추가 나중, 한 트랜잭션, 이미 있음/없음은 거절하지 않고 skipped·unknown·missing으로, 항목마다 기록) — 스텝 2의 여러 역할 더하기·되돌리기가 쓴다(사내 AI 등록은 빠졌다). 스텝 2 — 부여를 목록+상세로, 유효 권한 조회 항목을 흡수(옛 `sub=lookup` 주소는 부여로), 역할 여러 개 더하기(`grant-add-pop`, 키 A)와 5초 되돌리기 회수, 30개씩 이어 그리기. 새 CSS는 `styles/admin.css`(`.adm-*`)만, 공용 부품·`components.css`는 그대로. 스모크는 조회·회수 단계를 같은 뜻으로 옮기고 되돌리기·고르기·키보드를 더함. 스텝 5 — 관리 본문(`.adm-scope`)에서만 표 모양(줄 52px·좌우 16px·짝수 줄·올린 줄 선택색)을 `styles/admin.css`로 얹음, 홈·작업 기록 표의 계산값이 앞뒤로 같음을 잼. 스텝 6 — 왼쪽 메뉴 묶음 제목(사람·권한 / 운영 / SOP 기준), 표준 골격 한 줄(키는 영문 제목 아래, 조용한 편집 칸, 하위 항목 칸은 눌러 펼침). 스모크에 줄 높이·펼침·묶음 확인을 더함. 스텝 7 — AI 지침에 읽을 이름(`guidelines.name.<key>`, 모르는 키는 내부 이름 그대로)과 버전 타임라인, 본문 560px 상자 스크롤 없앰, Bundle에 상태 알약·진행 막대·구성원 머리글자 요약·패널 제목. AI 층·지침 키·시드는 그대로(스텝 3이 나중에 `prompt.grant`를 더함). 스텝 4 — 역할 × 권한 표(칸을 눌러 켜고 끔, 바뀐 칸·받은 대상 건수 저장 띠, 저장 전 확인, 받은 대상 명단 → 부여에서 역할로 거르기, 폼 권한 묶음 + `permission.<key>.hint`). 저장 직전 역할을 다시 받아 표를 연 뒤 바뀌었으면 아무것도 쓰지 않고 멈춤(서버 버전 확인은 Alembic이라 뺌). effect 2 → 0이라 기준선을 낮춤(사용자 승인 2026-11-26). 역할 삭제 단추 미리 끄기는 409 스모크 단계를 바꿔야 해서 미룸. 스텝 8 — 변경 기록을 날짜 묶음·종류 알약·찾기·30건씩 이어 불러오기로(서버 `GET /api/access/audit?before=<기록 id>`, 시각이 같아도 빠지지 않게 (시각, id)로 끊음, 공용 훅 `use-cursor-list`), 배치는 한 작업 한 줄, 동기화 미설정이면 실행 기록 칸을 숨기고 설정되면 최근 실행 요약 한 줄, AI 사용량 합계·천 단위. 스텝 3(2026-11-26 다시 넣음, 쪼개기 먼저의 `table-follow-3-ai`보다 먼저) — 사내 AI로 부여 등록: `POST /api/access/grants/ai-read`는 요청 안 동기 호출로 읽기만 하고(지침 `prompt.grant`, Alembic 없음) 서버가 AI가 옮겨 쓴 이름·ID·부서를 직원·부서 표에 맞춘다. 창은 지금 부여와 맞춘 미리보기(새로·이미 있음·회수·받은 적 없음·확인할 줄), 동명이인 고르기, 고른 줄만 batch로. 사용자 결정으로 실명 금지를 예외 대신 완화 — AI는 사내 모델로만, 실명·로그인 ID는 필요할 때(루트·backend CLAUDE.md, 명세 §8.5). 그래서 이름 → ID 바꾸기·`[이름 지움]`·서버 재검사는 하지 않음. 끝 점검 — 극단 자료(worst) 배치 감사의 관리 항목을 돌려 좁은 창(1120)에서 Bundle 표가 넘치던 것을 고침(칸 여백 줄임, 만든 날 열 감춤). 문서 — 빠뜨렸던 `docs/architecture` 두 파일과 시스템 설명서 글을 맞춤(그림은 정식 업데이트 때, 폴더 CLAUDE.md는 사용자 확인 대기).

## 2026-11-25 — 쪼개기 먼저 설계 (`docs/split-first`)

- T/F 피드백 15건 · 회의 결정 · 11-23 명세를 쪼개기 관점으로 다시 묶어 다음 패치 설계를 썼다(`docs/superpowers/specs/2026-11-25-split-first-design.md`, 2026-11-25 승인). 결정: 새 문서 생성 쪽은 모두 숨김, 문단 안 언어별 한 박스, Old 규칙을 New에도, 양 단 New도 같은 용지, 새로 올리는 문서부터. 시안 1차 답 반영: 앞부분은 "삭제 · 삭제 취소", 고른 것에 따라 단추 줄 바꿈(한쪽이면 손질, 양쪽이면 잇기), 여럿 고름 강조, New 표 벗기기를 넣음, 자동 칸 추천 스모크 변경 승인. 시안 2차 답 · 코드 대조 반영: 삭제 취소 · 사유 쓰기 늘 보임, 단추 한 줄, 표 칸 표시, 표 여럿 벗기기, Claude API는 매핑 패치 때 합성 문서로만. **New 편집을 Ctrl+Z로 되돌리면 New 문장이 중복되는 결함을 찾음**(스텝 0 `fix/new-edit-undo`). 시안 3차 답: C 시트 가림, 시험 변경 승인, Ctrl+Z 결함만 먼저, 반응속도(6-1절)를 넣음 — 실측 `Del` → 다음 박스 366ms, 0.15초 연타 5번 중 3번 사라짐. 11-23 명세 17개 항목은 모두 확정 · 모두 범위(원문을 `specs/2026-11-23-assign-feedback-2.md`로 넣음, 겹치는 곳은 설계 11-1절 — F2의 To-Be 이동 · 새 문서 추가만 숨김 결정으로 보류). 구현 계획은 `docs/superpowers/plans/2026-11-25-split-first.md`(브랜치 35개, 다섯 파일 + 장부), 구현은 다음 세션.
- 합성 문서로 확인한 것: 한 문단에 한/영이 섞인 문서를 배치가 "한/영 따로"로 잡는다, 제목 스타일 조항은 New에서 이을 박스가 없다, 짝 판이 넓은 창에서 용지 폭을 줄인다(860 → 752).

## 2026-11-26 — 짝 판을 열어도 보던 자리 그대로 (`fix/pair-spot-scroll`)

- 쪼개기 먼저 2a. 판이 열릴 때 용지 폭을 줄이던 것이(1920에서 860→752) 자리가 튀는 까닭이라, 폭은 두고 옆으로만 비킨다(`planSpotPlace`). 재현 스모크가 고치기 전 실패 · 고친 뒤 통과. Part 탭을 오가며 낡은 `.sheet`를 보던 것은 검토에서 잡아 같이 고침.

## 2026-11-26 — New 편집 되돌리기의 중복 (`fix/new-edit-undo`)

- 쪼개기 먼저 0. 단계 되돌리기가 문장을 되쓰기 전에 새 문장 맞추기가 먼저 만들어 단위 하나에 둘이 되던 것 — 되쓸 단위는 맞추기가 건너뛴다(`restoring_unit_ids`). 검토에서 둘을 더 고침: 번역 행의 NULL 정렬이 sqlite · postgres에서 갈리던 것, 단계에 안 찍힌 중복 행에 붙은 남의 이음은 확인 없이 떼지 않음(409).
- 결과물 C의 칸 안 순서는 아직 새 문장 id 순(계획 범위 밖).

## 2026-11-26 — 좁은 화면에서 오른쪽 칸 떼기 (`feat/inspector-float`)

- 쪼개기 먼저 2b. 같은 `aside`를 띄워 다시 마운트하지 않고, 높이는 창의 70%로 고정(줄이 바뀌어도 Confirm 제자리). 계획 밖에 셋을 더함 — 접힌 채 편집하면 펴기, 뜬 동안 알림을 내림, 두 칸 끝 빈 칸(끝 줄을 판 위로 굴리게). 새 이펙트 없음.

## 2026-11-26 — 문단 안 언어별 박스 (`feat/split-rule-2`)

- 쪼개기 먼저 5a. 추출마다 규칙 번호(`split_rule`)를 남기고 편집은 그 추출의 규칙으로 — 이미 올린 문서의 박스는 하나도 안 바뀐다(시험으로 못 박음). 정답 문서 21개(`tests/split_golden/`), 남은 xfail은 R3 · R4 몫.
- 검토에서 잡아 고침: 칸 안 캡션 문단의 둘째 줄이 캡션과 겹치던 것(커버리지 실패), PDF 문서 번호 · 줄표 줄에서 문장 중간이 끊기던 것(계획과 달리 앞 줄이 문장 끝일 때만 — 지휘자 판단). 자동 보안 검토 셋(긴 입력의 계산량)도 고침.
- 규칙 1을 보는 시험 파일은 입력 · 기대 그대로 `legacy_split_rule`로 돈다. 시연 시드에 묶음 하나(SYNTHETIC 10 문단 박스)를 더해 7~9번 묶음 id가 하나씩 밀린다.

## 2026-11-26 — 새 문서 생성 쪽을 숨김 (`feat/hide-drafting`)

- 쪼개기 먼저 1a. 상수 · 개발 전용 스위치 하나(`isDraftingOn`, 운영 빌드는 늘 false)로 숨기고 자료는 그대로 둔다. 스모크는 숨긴 기능을 쓰는 단계만 켜고 돌린다.
- 검토 막음 둘: 문장 번역을 확정 · 지운 뒤 상자가 남던 것, 번역의 출처 문장을 나누면 어느 줄에서도 닿지 않아 검토 요청이 막히던 것(숨기기 전부터 있던 막힘) — 묶음 단위 `GET /translations/open` 목록으로 풀었다. 출처가 없는 번역은 지우기만.

## 2026-11-26 — 다른 Bundle로 이동 제거 (`fix/remove-bundle-move`)

- 쪼개기 먼저 1b. 만드는 길만 없애고 자료 · 서버 API는 둔다. 검토에서 H(보류)와 초안이 생긴 뒤의 잇기 · 삭제가 읽기 전용을 풀던 것을 막음(저장된 값 기준) — 명세 F2-R7 글자 그대로. 부르는 곳이 없어진 Combobox도 걷음(effect-baseline이 줄었다).

## 2026-11-26 — Assign 반응 시간 재기 (`perf/assign-measure`)

- 쪼개기 먼저 3a. `pw-perf-assign.mjs`에 글쇠 · 연타 · 필터 · 번호 시나리오, 서버는 `app.timing` 로거 하나만 켜 저장 시간을 JSON 한 줄로(원문 · 이름 없음). 검토에서 앱에 logging 설정이 없어 INFO가 버려지던 것을 잡음. 측정 결과 문서는 3b 앞뒤를 재서 `docs/qa/2026-11-assign-perf.md`에.

## 2026-11-26 — New도 같은 쪼개기 규칙 (`feat/split-new-parity`)

- 쪼개기 먼저 5c. 규칙 2 추출만 띠 표 · 조항 제목을 같게 읽고 절 경로도 그때만 바꾼다. 검토 막음 하나: New 칸 모양 전환이 형제 칸의 확정을 묻지 않고 보류로 돌리던 것 — 구경꾼 규칙을 `detach_targets`에도(은퇴하는 칸의 있던 같은 문제도 함께). 이음이 풀리면 Old 줄 · 진행 수를 다시 받는다.

## 2026-11-26 — 번호 칸 창에 확인 · 취소 (`feat/number-cell-buttons`)

- 쪼개기 먼저 4d. Enter와 확인이 같은 판정을 쓴다. 점 기호 · None 창은 그대로.

## 2026-11-26 — 명령 큐 (`fix/assign-command-queue`)

- 쪼개기 먼저 3b. 순수 모델(`lib/command-queue`)과 훅(`use-command-queue`)으로 떼고 이펙트 기준선은 15 → 14. CPU 4배 · 289박스에서 Del → 다음 박스 471 → 61ms, 0.15초 간격 5연타가 5개 모두(전 2개).
- 검토(fable)에서 고침: 글쇠 자동 반복이 줄줄이 삭제하던 것, Undo 지름길이 고름을 잃어 뒤의 Del이 말없이 사라지던 것, 나가기 확인의 버리기가 누른 판단까지 버리던 것. 자동 보안 검토의 낙관 잠금 구멍(받은 값으로 보내던 것)도 막음.
- 보류(H) · 배정 취소(U) · 일괄은 지금 저장 뒤 규칙대로 머문다(6-1절 "다음 박스 규칙은 지금 저장 뒤 규칙과 같다"를 따름, A1-R2 글자와 다름 — 장부 물음).

## 2026-11-26 — 움직임이 누른 순간 시작 (`fix/assign-instant-motion`)

- 쪼개기 먼저 3c. 접힘 · 번호는 큐 상태에서 파생하고 벗기기는 `begin().commit()/revert()`로 나눔. 다시 표로 머리의 전환 자리를 안쪽으로 옮겨 처리 중 알약이 줄 높이를 밀지 않게. 새 이펙트 없음.

## 2026-11-26 — 필터를 켠 용지도 덩어리로 (`perf/assign-filter-chunks`)

- 쪼개기 먼저 3d + 측정 결과 문서. 검토에서 묶음을 펼쳐 120칸을 넘나들면 용지 전체가 다시 마운트되던 것을 고침(덩어리 여부를 펼침에 안 바뀌는 칸 수로). 덩어리 값마다 변이 시험으로 조임. 목표(필터 J 60 · Del 100ms 안)를 이뤄 진짜 가상화는 열지 않음.

## 2026-11-26 — 본문 앞부분 · 개정 이력 제외 (`feat/split-front-matter`)

- 쪼개기 먼저 5b. 판정은 `noise.py` 순수 함수, 규칙 2로 새로 쪼갠 문서만. 검토에서 본문이 저절로 지워질 수 있는 꼴 셋(한/영 따로, 절차 안 목록 "1.", 이력이 끝까지 먹음)을 잡아 판정을 좁혔다 — 헷갈리면 표시하지 않는다(정답 문서 G22~G28, 의심 꼴 26개). 그 결과 개정 이력은 제목 + 글 두 줄 이하 + 이력 표 하나까지로 명세("같은 단계 제목까지")보다 좁다.
- 삭제 취소 · 사유 · 여기부터 본문은 큐를 지나되 장벽이 아니다(계획 T7) — 응답 전에 누른 Del · H · Enter · R은 알림을 띄운다. 자동 보안 검토 둘(숫자 꼴 글자의 ValueError, O(n²) 훑기)도 고침.

## 2026-11-26 — Enter는 늘 확정 단추 (`fix/assign-enter`)

- 쪼개기 먼저 4a. 무엇을 확정할지는 `lib/primary-model`, 누른 자리는 `lib/assign-key-target`(순수 모델). 검토에서 고침: 추천 첫 로딩 중 다른 카드가 확정될 수 있던 것, 오른쪽 칸 링크의 Enter. 브라우저에서 잡은 것: 위쪽 거르기 단추를 누른 뒤 Enter가 거르기를 다시 누르던 것 — 마우스로 누른 위쪽 줄도 포커스를 용지로. 5b와 맞물려 삭제된 블록 단추를 누른 뒤의 Enter가 다른 줄을 확정하던 길도 막음.

## 2026-11-26 — Assign 글쇠 목록 하나로 (`feat/assign-keymap`)

- 쪼개기 먼저 4b. 삭제된 줄의 U · R · ⇧U · ⇧R(5b)도 목록으로 옮김. 검토에서 고침: 되살아난 Tab의 저장 차례가 뒤집히던 것, R 뒤에 친 글자가 장벽 뒤 명령으로 되살아나던 것, 낡은 글쇠를 알리던 문구 둘(설명서 전체를 보는 검사를 더함). 덩어리 시험(`paper-chunks`)은 바쁜 기계에서 5초를 넘어 시간 제한만 30초로.

## 2026-11-26 — Space 미리보기 다듬기 (`feat/space-preview-trim`)

- 쪼개기 먼저 8(계획 5)의 하나. Section No.는 빠질 줄까지 세고 나서 줄만 뺀다. Outputs 내보내기 · Excel A 파일은 그대로(Assign 미리보기에서만 위치 글자를 뺌). 체크 16가지를 검토에서 모두 돌려 봄.

## 2026-11-26 — Excel A 삭제 줄 취소선 (`fix/excel-a-strike`)

- 쪼개기 먼저 8의 하나. Old text 칸에만, 이어진 줄마다. 검토에서 삭제를 보류한 줄의 경계 시험을 더함.

## 2026-11-26 — 되돌리기 중 누른 줄이 고름을 지킴 (`fix/undo-follow-after-click`)

- 3b 뒤에 찾은 결함(4c 스모크가 드러냄): 같은 박스를 다시 고르면 늦은 따라가기를 남기는 규칙 때문에 Del이 옮겨 간 줄을 누른 뒤 고름이 되돌린 줄로 튀었다. 사람의 고름은 늘 따라가기를 버리고(`isPickedOver`), 큐의 다시 시도는 따로 `restore`로 되살린다(검토가 잡은 회귀).

## 2026-11-26 — ⇧J ⇧J · ⇧K ⇧K 합치기 (`feat/assign-merge-keys`)

- 쪼개기 먼저 4c. 무장은 순수 모델 `merge-arm-model`, 실행은 우클릭 메뉴와 같은 길. 검토에서 처리 중인 박스 · 이웃의 막음을 더함. 스모크의 Esc 단계가 3b의 늦은 따라가기 결함을 드러내 `fix/undo-follow-after-click`으로 먼저 고침.

## 2026-11-26 — 진행 숫자를 처분별로 (`fix/progress-by-disposition`)

- 쪼개기 먼저 8의 하나. 세 사본(snapshot · outputs/review · progress-model.ts)을 함께 바꿈 — 검토에서 합성 자료 16벌로 서버와 화면의 1,424값을 맞대 어긋남 0, 검토 조건은 전과 같음. 대시보드의 "묶음 전체" 참조 수가 연 문서 하나만 세던 것도 고침. 큰 문서 판정 시험을 벽시계 대신 읽은 줄 수로.

## 2026-11-26 — fix/ai-suggestions-retire — 편집이 바꾼 Unit의 AI 제안 거두기

- 편집(`_write_change`)이 은퇴시킨 Unit의 분류 · 묶기 제안을 stale로 거두고, 되돌리기 단계에서는 이번에 거둔 id만 빼서 되살리지 않는다(번역 제안의 stale은 전처럼 되돌린다 — 검토가 찾은 회귀를 고침). 받아 보류한 줄이 가리키는 제안은 남긴다(`keep_linked`).
- 알약 · 수락 창 · 개요가 안 정한 줄의 제안만 센다(`countLiveOffer`). 구조 편집 · 되돌리기 뒤 제안 목록을 다시 받는다 — 스모크가 '되돌린 뒤 옛 캐시가 다시 세어짐'을 찾아 고침. `WAITING_KINDS == OFFERED_KINDS - HIDDEN_AI_KINDS`를 불변식 시험으로 묶음.

## 2026-11-26 — 모음 feat/table-follow — 짝 표 고르기 · 규칙 따라 하기 · AI 따라 하기

- 1 짝 표: 영어 표의 짝 한글 표를 꼴 · 토큰 · 뜻(임베딩, 운영은 꺼짐)으로 고르고 애매하거나 점수 미달이면 사람이 고른다(새 표 `table_counterparts`, Alembic 0040). 가중치는 계획 식으로는 계획 자신의 시험이 성립 안 해 0.2·꼴+0.3·토큰+0.5·뜻으로.
- 2 규칙: 한글 표의 순서 · 삭제 · 합치기 · 들여쓰기 · 번호를 행 짝으로 맞춰 칩으로 보이고, 적용은 `follow_table` 편집 하나(되돌리기 한 번). 검토가 순서만 있는 계획 422 · 한 줄 적용 꼬리 줄 · 삭제만 적용 뒤 Undo가 잘못 켜짐을 찾아 고침. 스모크가 머리 글이 폭 0으로 사라지는 결함을 찾음.
- 3 AI: 행이 규칙으로 안 맞으면 `table_follow` AI 작업(Alembic 0041, CHECK 값 하나)이 같은 꼴 제안을 내고 사람이 받는다. 알약 · 수락 창 · 대기 수에는 들지 않는다. 낡은 차례로 순서를 되돌리던 것 · 한 줄 적용 채택 기록을 검토 뒤 고침.

## 2026-11-26 — 모음 feat/new-paper — New 용지 · 두 고름과 단추 줄 · New 손질

- 6-1: 이미 쓴 New 문서를 `Paper`로 그리고 얹기 층을 둠. 6-2: 고름을 Old · New 쪽마다 하나로, 단추 줄 `buildPickBar`가 화면 · 글쇠 · 확정 단추의 뜻을 한곳에서 정함, 잇기는 명령 하나(그 자리 메뉴 없앰). fable 검토 두 번이 숨은 확정 · 되돌리기 문서 어긋남 · 출처 없음 두 번째 Enter 갈아 끼움을 찾아 고침.
- 6-3: New에서도 Old와 같은 손질(표 벗기기 · 다시 표로 · 번호 · 나누기 · 제목 · 줄 순서 손잡이 · 삭제 블록 되돌리기 · 여기부터 본문), New 표를 바꾸기 전 n · m을 물음 — 6-3 전 운영 금지 조건(New의 거짓 제외를 되돌릴 화면 없음)이 풀림. 스모크가 Shift+누르기 선택 범위 · New 줄을 확정으로 셈 · 되돌리기 중 쌓인 Ctrl+Z를 버림(명령 큐, fable 한 번)을 찾아 고침.

## 2026-11-26 — feat/assign-two-level-pick (계획 4-1) dev에

- 누른 조각(pickedId)과 배정 박스(boxId)를 `pick-scope-model`로 갈랐다(C1-R1~R5). 칸을 눌러도 Del · U · 잇기 · 확정 · 끌기는 표째, 다듬기(언어 · 번호)만 누른 칸.
- 이웃한 짝의 다른 조각은 `data-mate` 대신 `data-group="pair"` — 스모크 locator 셋을 같은 검사 수로 따라 고침. 양 단에서 New를 마지막에 누르면 Shape 맨 위가 누른 New 조각(검토 고침, `pickShapeScope`).

## 2026-11-26 — feat/assign-tables-tab (계획 5) dev에

- 표 탭 · 본문 표 접기를 Old · New 용지에(E2-R1~R5, S15), 접힘은 문서마다 브라우저에 기억(`use-folded-tables`, 새 effect 없음). 표 탭도 같은 `Paper` · `strips`라 `renderFollow`가 그대로 뜬다(사용자 답).
- 접힌 표 안 줄은 J/K와 확정 뒤 다음 줄 고르기에서 건너뛴다(검토 고침, `readStepTab`). 성능은 dev v1.6.23과 극단 시드로 견줘 긴 문서 J · Delete · 스크롤이 잡음 안(세워 둘 조건 ② 아님).

## 2026-11-26 — feat/assign-table-menu (계획 4-2) dev에

- 표 칸 · 벗긴 표 줄의 우클릭 메뉴를 "이 칸" · "이 표" 구역으로(C2-R1~R4, ⇧D 제외), 항목 호버 · 포커스에 닿는 칸을 칠한다(`menu-section-model` · `menu-reach-model` · `ReachPaint`, 칠 상태는 메뉴 안).
- 메뉴의 AI order 켜짐 · 꺼짐을 ⇧O와 같은 `readUnwrapOrderReason`으로 모음, 한 단 New의 칠은 그린 용지 쪽으로(검토 고침).

## 2026-11-26 — feat/assign-multi-mark (계획 4-3) dev에

- Shift로 고른 줄(Old `checked` · New `checkedNew`)을 `multi-mark-model`로 이어진 덩어리마다 inset 테 · "n줄 고름" 꼬리표, 줄마다 칠 · 왼쪽 막대(막대 쪽 직각) · 오른쪽 체크로(§9). 용지의 `pickedIds`는 짝 고르기와 New Ctrl 고름만, Shift 고름은 `checkedRows`로 따로.
- 접힌 표 안 줄을 Shift로 고른 채면 표가 펴진다(검토 고침). 여럿 고른 동안은 묶음 꼬리표를 그리지 않는다.

## 2026-11-26 — feat/split-by-sentence (계획 4-6) dev에

- `SplitSentencesOp`(`split_sentences`)를 `_write_change` 길의 편집 하나로(§9) — 경계는 규칙 1(`RULE_LEGACY`) 고정, 판단 · 짝 · New 새 문장까지 되돌리기 한 번(검토 뒤 시험 더함). 글쇠 ⇧S는 새 `when: "sentence"`(언어 글쇠의 막는 까닭을 빌리지 않게).
- 메뉴가 한 줄 늘어 키 큰 메뉴가 박스 위 · 아래 어디에도 안 들어가면 박스 옆으로 비켜 선다(`placeLinkMenu`, Assign 우클릭만 — 지운 줄 메뉴가 박스를 덮던 스모크 실패).

## 2026-11-26 — feat/assign-multi-merge (계획 4-4) dev에

- `MergeRowsOp`(`merge_rows`) · `SetLayoutTablesOp`(`set_layout_tables`)를 `_write_change`의 `_Change` 하나로(§9) — 짝 줄은 언어끼리 합쳐 다시 짝, `payload.merged`로 합친 박스의 조각 · 풀기(`find_merged_pieces`, 옛 기록은 지금 규칙). Alembic 없음.
- opus 검토가 바깥 표 + 칸 안 캡션 달린 안쪽 표를 함께 벗기면 캡션이 은퇴한 표 단위에 매달리는 것을 찾아 고침(차례로 벗긴 것과 같게). 합치며 짝에 드는 외톨이 Unit의 AI 번역도 `create_pair`처럼 쓸어 냄.

## 2026-11-26 — feat/assign-pair-bracket (계획 4-7) dev에

- 고른 박스의 떨어진 짝이 둘 다 보이면 왼쪽 괄호선(`resolvePairBracket`, Old · New 같음)을 긋고 안내 줄을 숨긴다(E1-R1~R4). 재는 이펙트는 `use-pane-measure.ts`로 옮겨 effect-baseline 109→107 · 타이머 74→73.
- 검토 뒤: 고를 때 안내 줄이 섰다 숨으며 내용이 밀리던 것을 같은 높이 빈 자리로 막고(재기 전 · 괄호선 동안), 선색을 `--accent`로(28% 선은 1.6:1이라 대비 시험 더함).

## 2026-11-26 — feat/assign-multi-pick (계획 4-5) dev에

- ⇧G로 고른 줄을 넣고 빼고(Shift+클릭과 같은 `toggleOldChecked` · `toggleNewChecked`, 한쪽에 넣으면 다른 쪽 비움), 위쪽 바에서 삭제 · 배정 취소 · →KO · →EN · 합치기 · 표 벗기기(G1-R1~R4). 일괄 배정 취소는 서버 요청 하나(`bulk` action `clear`, 낡은 줄 하나면 409로 아무것도 안 바뀜) · 되돌리기 한 칸.
- 고름은 일괄 뒤 그 자리에 머문다(사용자 결정, 계획 T3의 "다음 박스로"는 따르지 않음). opus 검토 뒤 일괄 취소 응답에 보류로 바뀐 형제 줄의 revision을 실어 이어 누른 글쇠가 409로 멈추지 않게.

## 2026-11-26 — feat/unwrap-continue-numbers (계획 5) dev에

- Old 표를 벗기면 첫 칸 숫자를 위 번호 아래로 잇는 `continue_numbers`를 벗기기 뒤 따로 한 칸으로(D1-R1~R5, New는 저절로 안 함 §11-1), 번호가 있는 줄을 합치면 뒤 번호 당기기(D1-R6, 여럿 합치기 포함). 규칙 사본 셋(`numbering.py` · `continue-number-model.ts` · `rule-cases.json`)이 같은 답. Alembic 없음.
- opus 검토 막음 고침: "저절로 이은 번호"를 적용 중인 `continue_numbers` 기록이 쓴 값과 같을 때만으로 좁혀, 사람이 번호만 고친 한글 표가 손댄 표로 읽히게(따라 하기 · 문단 Excel). 이미 벗긴 운영 표는 다시 매기지 않는다.

## 2026-11-26 — 정식 업데이트 전 자동 검사 · 고침 (v1.6.31 → v1.6.32)

- 전체 스모크 `FULL=1`(`2ccff578`) 2522 통과 · 1 흔들림(New 판 그림 캡션). 같은 흔들림의 두 번째 고침이라 `readCaptionLine`을 맞을 때까지 다시 읽고 실패 글에 본 값을 남기게 함(`test/smoke-caption-settle`, 기대값 그대로).
- 감사 넷(`f2e20b78`): overlap · contrast · manual-shots 통과, layout `DS=worst` 196 중 5 실패. 관리 역할 표 1120 넘침(X0 · A11)은 제품 결함 — 켜진 칸의 `sr-only`(absolute)가 위치 기준 없는 스크롤 상자를 빠져나가 문서를 넓혔다: 감싸개 `position: relative`, 긴 역할 이름 `clamp-2`(`fix/admin-roles-fit`, v1.6.32). 낡은 기대값 둘은 사용자 승인("다 처리")으로 고침 — P1 Excel 미리보기 탭 5 → 4(1a §14), A4b는 W1 옛 줄이 738이라 번호 칸 마지막 20개에 네 자리를 넣어 잰다(`test/layout-audit-stale`). 고친 넷 모두 다시 통과.
- 정식 업데이트 체크리스트 HTML을 읽기 쉽게 다시 씀(항목마다 제목 · 볼 것 목록 · 버전 칩 · 정할 것 띠, 섹션별 셈, 남은 것만).

## 2026-11-26 — 1차 피드백 개선 (v1.6.32 → )

- 스크롤 막대(`fix/scrollbar-near-reveal`, v1.6.33): macOS 오버레이가 아니라 앱 CSS가 막대를 늘 투명하게 두고 스크롤 중에만 보이던 것 — `nav-host`의 같은 배선에 포인터가 스크롤 상자 오른쪽 끝 40px 안이면 `.is-scroll-near`(흐린 색)를 붙임. 조상 상자 찾기는 가리킨 요소가 바뀔 때만.
- 글쇠(`feat/assign-tab-keys`, v1.6.34): Tab/⇧Tab = J/K, 들여쓰기는 ` · ⇧`(사용자 요청). 접근성 — Tab은 용지(`.pane-body`)에 포커스가 있을 때만 옮기기, 단추 줄 · 오른쪽 칸 · 위쪽 줄은 브라우저 기본. ` 는 자리(`event.code === "Backquote"`)로 받는다 — 맥 한글 입력은 ₩, Shift는 ~를 친다.
- 짝 판 두 번 누름(`fix/pair-dblclick-panel`, v1.6.35): 판의 바깥 누르기 닫기(`useDismiss`)가 안내 줄의 첫 mousedown에 판을 닫아 용지가 가운데로 돌아오는 동안 둘째 누름이 빗나갔다 — `useDismiss`에 `keepOpenOn`(`.pair-hint`). Playwright `dblclick`은 사이가 없어 재현되지 않아 150ms 사이를 둔 두 번 누름으로 스모크 검사를 더함(고치기 전 실패 확인).
- 스모크 표 접기 흔들림(`test/smoke-fold-settle`, 시험만): `[new-pair] Collapse folds the table…`가 dev 코드에서도 3번에 1번 빈 글(`innerText` "")로 실패 — 접는 움직임 중 한 번 읽던 것을 T 안에서 맞을 때까지 다시 읽고 실패 글에 본 값(줄 · 머리 수)을 남김. 기대값 그대로, 혼자 4/4 통과. 7e의 글 기다리기 · smoke-caption-settle에 이어 같은 꼴(한 번 읽기)의 세 번째 고침.
- 참조 칸 이름(`feat/ref-section-forms`, v1.6.36): 조사 결과 참조 칸은 정상 동작(제목 스타일 + 이름 목록)이었고 목록에 Form이 없었다 — `_REF_SECTION_NAME`에 form(s) · 서식 · 양식, 조각을 and · & · , · 및으로 한 번 더 나눠 조각마다 통째로 맞춤("Forms and equipment" · "Formulation"은 닫힘). 굵은 글 제목은 여전히 열지 않음. Reference 아래가 안 된 실제 사례 · 표 꼴 개정 이력(6)은 실제 문서로 분석한 뒤.
- 밀린 명령 이름(`feat/assign-queue-labels`, v1.6.37, 사용자 결정 1-A): 박스를 잡은 명령은 그 박스 칩 "Queued · X"(같으면 ×n, 섞이면 +n), 박스 없는 명령(Undo · Redo · 장벽 뒤 글쇠)은 Undo 옆 `assign-queue-global` 하나. 규칙은 `command-queue.ts` `listQueueWaits` · `formatQueueWait`, 칩 순번 대신 개수. 나누기 이름 Cut → Split(단추와 같게). `assign:` 1516 통과.
- 키보드 그림(`feat/assign-keyboard-map`, v1.6.38, 사용자 결정 3-A + 화면 피드백 셋): 처음 자판 전체 · 파스텔 채움은 "낡아 보임" → 예전 시안 모양(둥근 타일 · 큰 글쇠 · 짧은 이름) 요청 → "자판 전체는 좋음, Esc 자리 현실화" → 75% 배열(Esc · F열 · Del 위 줄, 화살표를 블록 안에) · Graphite 톤(중립 타일 + 종류 아래 띠, 앱 토큰만). 글쇠 표(`ASSIGN_KEYS`)에서 그림(`keyboard-map-model.ts`), 창이 떠 있는 동안 누른 글쇠는 `data-pressed` · 기능 있으면 `data-flash`(effect 없이 onKeyDown). `Modal` 크기 `board` 하나 더함.

## 2026-11-26 — F7b 양 단 New 칸 메뉴 (feat/new-cell-menu-two-pane)

- 양 단 New 칸 · 머리 · 제목 · 캡션 · 그림 우클릭 = 한 단 메뉴(`buildMenuSections(…, doc)`), Shift+F10 · 메뉴 글쇠는 마지막 고른 쪽(`readMenuKeyTarget`) — 사용자가 자는 동안 추천안(New 박스에서도 열기)으로 정함.

## 2026-11-27 — F5 단추 줄 라벨 (feat/pick-bar-labels)

- 순수 CSS container query로 단추 줄 이름 접기, 못 하는 손질도 이름 + 까닭은 툴팁, ⋯는 줄 오른쪽 끝(에이전트 판단 그대로). 넓은 박스 가운데에 단추가 오게 되어 짝 판 스모크 단계는 박스 글 자리를 누르게 따라 고침.

## 2026-11-27 — Fm 메뉴가 이동 뒤 열린 채 남던 결함 (fix/user-menu-close-on-nav)

- nav-host의 capture click이 `stopPropagation`해 항목의 `closeAll`이 안 불렸다 — nav-host는 그대로 두고 user-menu · ai-jobs-indicator가 경로가 바뀌면 렌더 중에 닫는다(새 effect 없음). 연습 페이지 스모크가 찾음.

## 2026-11-27 — F9 연습 페이지 (feat/practice-page, 스텝 4개)

- 설계 · 계획(opus) → 스텝 1 백엔드가 합성 docx로 뽑는 연습 자료 JSON + 신선도 시험 · 2 `api.ts` 앞 가짜 서버(25경로, 업무 규칙 사본 없음) · 3 `/practice` 띠 + 실제 Assign(`useRouteBundleId` 한 줄) · 진입 두 곳 · 4 과제 12개 자동 ✓.
- opus 검토가 막은 것: 실제 Assign에서 밀린 저장이 /practice로 옮길 때 버려짐 → `/bundles/<id>`는 id로만 가름(-1만 가짜). D22 짐작(확정 op)이 틀려 잇기/확정은 `focus_target_id`로 가름. 연습 스모크가 앞부터 있던 메뉴 결함을 찾음(v1.6.41).

## 2026-11-27 — Fh 문서 하나인 칸 머리 줄 (fix/assign-new-head-fit)

- `.pane-head > * { flex-shrink: 0 }` 때문에 하나뿐인 문서 제목 `.pane-title`이 줄지 않았다 — Old · New 모두 `Truncate` + `flex-shrink: 1; min-width: 4ch`. 연습 화면(1120, 과제 칸 펼침) 그림에서 찾음. overlap 감사 새 장면 `assign-pane-head-narrow`(고치기 전 16 문제를 잡음).

## 2026-11-27 — 설명서 그림 — 바뀐 장면만 (docs/manual-shots-1-6)

- 새 장면 넷(practice · assign-keyboard-map · assign-queued(저장을 6초 늦춰 칩을 띄움, mutates라 맨 끝) · assign-new-cell-menu(합성 묶음을 만들고 지움))과 다시 찍은 셋(user-menu · assign · assign-link), 설명서에 그림 줄 넷.

## 2026-11-27 — v1.6.43 정식 업데이트 준비 (`chore/release-1.6.43`)

- CHANGELOG `## v1.6.43 — 2026-11-27` 제목 + 배포 메모(Alembic `0038`~`0041` 더하기만, v1.5.0 운영 배포 기록이 없어 운영이 v1.4.0이면 v1.5.0의 `0035` 행 변경도 함께 — 굵게) · 검증 결과, 설명서 머리 · 루트 CLAUDE.md 상태 줄 · README 버전 · 프런트 체크리스트 HTML(1차 피드백 셋 · 감사 결과).
- 끝난 설계 · 계획을 지움: 쪼개기 먼저 설계 · 계획 `-0`~`-5`, 연습 페이지 설계 · 계획. 코드 · 문서가 인용하는 절만 `docs/architecture/decisions.md`로 글자 그대로 — `## 2026-11-25-split-first`(§4-1 · §5 · §6-1 · §7 R3 · §8 · §9 · §11-1 · §14), `## 2026-11-25-split-first-3` · `-4`("정한 것"), `## 2026-11-26-practice-page`(§2~§7 · §10). 11-23 명세는 F2-R1~R5(숨긴 새 문서로 보내기) 보류라 남기고, 장부는 main 합친 뒤 지운다.

## 2026-11-27 — F9b 연습 화면 말풍선 (feat/practice-coach)

- 시안 A(스포트라이트) + 완료 플립(사용자 11-27). 오른쪽 과제 칸 · 좁은 창 접기를 지우고 `practice-coach.tsx` · 자리 셈 `coach-place.ts` · 공용 훅 `use-target-rect.ts`(effect 1, 화면 쪽 effect · 타이머 0, 넘어가기는 `animationend`). 막은 클릭을 막지 않는다.

## 2026-11-27 — Space 시트 높이 끌기 (F10, v1.6.45)

- Space 시트 위 손잡이를 끌어 작업 화면 높이의 30~90%로 조절하고 보기 설정에 기억한다(사용자 11-27, 이번 정식 업데이트에). 비율 기준은 시트가 아니라 작업 화면(손잡이 offsetParent 버그 고침), 스모크 `assign: Space preview`에 끌기 단계.

## 2026-11-27 — 늘 실리는 md 다이어트 (`docs/env-diet`)

- 모델이 기본으로 하는 것(단순하게 · 고칠 곳만 · 범용 보안/시험/오류 규칙)을 늘 싣는 글에서 빼자는 사용자 점검 — 루트 CLAUDE.md + rules 41KB → 24KB. guidelines는 이 저장소만의 것(물을 때 · 멈춤 · 말하기)만, 범용 6개는 `conventions.md` 하나로, `git.md`는 커밋 · dev 푸시 버전만 남기고 정식 업데이트 · 급한 수정 · 문서 정리는 `docs/deploy/release.md` + `/release`로, docs 폴더 정책은 `docs/README.md`로. `/agile`은 루트 "작은 수정은 직접"과 겹쳐 지움.
- 같은 날 저장소 밖에서: 겹치는 플러그인(karpathy · code-review · code-simplifier)과 context-mode는 전역, claude-mem · claude-md-management는 이 프로젝트(`.claude/settings.local.json`)에서 끔.

## 2026-11-27 — 원본 보기 (F11, 모음 `feat/original-view`)

- Space 시트 "원본 보기" 탭 — 서버는 Unit → 원본 XML 경로만(`GET …/original-places`, 표 · 그림 Unit은 표 경로 · `pos_seq` 블록), 원본 파일에 ETag 캐시. 브라우저가 책갈피 표지를 심어 `docx-preview`로 그림자 뿌리 안에 그리고 앱이 쪽을 나눈다(종이 크기가 없는 장은 Word 기본 A4). 그리개 CSS · 링크는 거른다(보안 검토 두 번), CSP는 nginx라 다음 일.
- EMF · WMF는 사용자 결정으로 1차에 — `rtf.js` EMFJS가 글자 · 비트맵 · 타원을 건너뛰어(합성 EMF 비교) `emf-converter/lite` 4.28.1로(같은 img의 PNG 2배, 5초 넘으면 빗금). 그린 원본은 시트를 닫아도 문서 넷까지 남겨 다시 열 때 그대로(자리 조회가 바뀌면 다시 그림).
- 스텝 넷을 하위 에이전트로(서버 sonnet ∥ 그리개 opus → 시트 opus ∥ EMF sonnet), 지휘 세션이 스텝마다 diff 검토 · 게이트 · 스모크. 새 npm 의존성 `docx-preview` 0.4.1 · `jszip` 3.10.2 · `emf-converter` 4.28.1.

## 2026-11-27 — 원본 보기 · Space 시트 고침 (v1.6.47~v1.6.49)

- v1.6.47 쪽 나누기에 문단 바깥 여백까지 셈(`FULL=1`이 첫 장 23px 넘침을 잡음), v1.6.48 칠은 4px 번지고 막대는 그 바깥, v1.6.49 양 단에서 New를 골라도 Space 시트를 켜 둠(`isNewEdit`가 껐다).

## 2026-11-27 — UI 다듬기 넷 (v1.6.50, 모음 `feat/ui-polish-1127`)

- 사용자 넷 + 후속: 단추 줄 호버 진동(`:has(:hover)`가 형제를 접고 올린 단추는 240px에 묶여 포인터에서 빠짐 → 호버는 색만, 이름은 툴팁, 소스 검사 "hover never re-lays out siblings"), 우클릭 메뉴 동안 줄 유지(줄이 이미 떠 있던 박스만 — 다른 박스는 메뉴 덮침 때문에 그대로) · ⋯ 바로 열기, 삭제 줄 포커스의 Space(`data-space-pick`), 연습 안내형(결정 D25~D27), 맥 안내 제외.
- 하위 에이전트 넷(opus 셋 · sonnet 하나, 워크트리마다) → 모음에서 vitest · 연습 · Assign 스모크. 준비 커밋 내용을 v1.6.50으로 다시 맞춤.
