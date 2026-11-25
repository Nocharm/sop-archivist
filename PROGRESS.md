# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신한다 (`rules/common/git.md` 규칙). v1.5.0(2026-11-21 정식 업데이트)까지의 항목은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)에 있다 — 이 파일이 크기 상한을 넘으면 최근 릴리스까지의 항목을 거기로 옮긴다(`rules/common/git.md` "문서 정리").


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

## 2026-11-22 — 관리 화면 다듬기 설계·프로토타입 (`feat/admin-polish`, 문서만)

- 관리 메뉴 코드 검토(하위 탭 주소·부여 이름 언어 버그 둘, 두 줄 표·한 명씩 부여 불편)와 시안 세션 결정을 `docs/design/2026-11-22-admin-polish-design.md`에 모음 — 부여 목록+상세, 사내 AI 일괄 등록은 로그인 ID 기준(이름은 브라우저가 ID로 바꾸고 못 바꾼 이름은 지움, 사용자 결정), batch API, 이어 불러오기, 2단 전환 규칙, 머리글자 원은 겹친 명단에서만. 눌러 보는 프로토타입은 `docs/design/admin-polish/prototype.html`. 구현은 스텝 0~8 브랜치로.
- 구현(모음 브랜치 `feat/admin-polish`, 2026-11-25~): 스텝 0 — 하위 탭을 주소에(`?tab=access&sub=`), 부여 대상 이름을 화면 언어로(직원 디렉터리·부서 표, 없으면 서버 이름). 스텝 1 — `POST /api/access/grants/batch`(회수 먼저·추가 나중, 한 트랜잭션, 이미 있음/없음은 거절하지 않고 skipped·unknown·missing으로, 항목마다 기록) — 스텝 2의 여러 역할 더하기·되돌리기가 쓴다(사내 AI 등록은 빠졌다). 스텝 2 — 부여를 목록+상세로, 유효 권한 조회 항목을 흡수(옛 `sub=lookup` 주소는 부여로), 역할 여러 개 더하기(`grant-add-pop`, 키 A)와 5초 되돌리기 회수, 30개씩 이어 그리기. 새 CSS는 `styles/admin.css`(`.adm-*`)만, 공용 부품·`components.css`는 그대로. 스모크는 조회·회수 단계를 같은 뜻으로 옮기고 되돌리기·고르기·키보드를 더함. 스텝 5 — 관리 본문(`.adm-scope`)에서만 표 모양(줄 52px·좌우 16px·짝수 줄·올린 줄 선택색)을 `styles/admin.css`로 얹음, 홈·작업 기록 표의 계산값이 앞뒤로 같음을 잼. 스텝 6 — 왼쪽 메뉴 묶음 제목(사람·권한 / 운영 / SOP 기준), 표준 골격 한 줄(키는 영문 제목 아래, 조용한 편집 칸, 하위 항목 칸은 눌러 펼침). 스모크에 줄 높이·펼침·묶음 확인을 더함. 스텝 7 — AI 지침에 읽을 이름(`guidelines.name.<key>`, 모르는 키는 내부 이름 그대로)과 버전 타임라인, 본문 560px 상자 스크롤 없앰, Bundle에 상태 알약·진행 막대·구성원 머리글자 요약·패널 제목. AI 층·지침 키·시드는 그대로. 스텝 8 — 변경 기록을 날짜 묶음·종류 알약·찾기·30건씩 이어 불러오기로(서버 `GET /api/access/audit?before=<기록 id>`, 시각이 같아도 빠지지 않게 (시각, id)로 끊음, 공용 훅 `use-cursor-list`), 배치는 한 작업 한 줄, 동기화 미설정이면 실행 기록 칸을 숨기고 설정되면 최근 실행 요약 한 줄, AI 사용량 합계·천 단위. 끝 점검 — 극단 자료(worst) 배치 감사의 관리 항목을 돌려 좁은 창(1120)에서 Bundle 표가 넘치던 것을 고침(칸 여백 줄임, 만든 날 열 감춤). 문서 — 빠뜨렸던 `docs/architecture` 두 파일과 시스템 설명서 글을 맞춤(그림은 정식 업데이트 때, 폴더 CLAUDE.md는 사용자 확인 대기).
