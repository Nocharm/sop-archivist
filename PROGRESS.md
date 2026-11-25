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

## 2026-11-25 — 쪼개기 먼저 설계 (`docs/split-first`)

- T/F 피드백 15건 · 회의 결정 · 11-23 명세를 쪼개기 관점으로 다시 묶어 다음 패치 설계를 썼다(`docs/superpowers/specs/2026-11-25-split-first-design.md`, 2026-11-25 승인). 결정: 새 문서 생성 쪽은 모두 숨김, 문단 안 언어별 한 박스, Old 규칙을 New에도, 양 단 New도 같은 용지, 새로 올리는 문서부터. 시안 1차 답 반영: 앞부분은 "삭제 · 삭제 취소", 고른 것에 따라 단추 줄 바꿈(한쪽이면 손질, 양쪽이면 잇기), 여럿 고름 강조, New 표 벗기기를 넣음, 자동 칸 추천 스모크 변경 승인. 시안 2차 답 · 코드 대조 반영: 삭제 취소 · 사유 쓰기 늘 보임, 단추 한 줄, 표 칸 표시, 표 여럿 벗기기, Claude API는 매핑 패치 때 합성 문서로만. **New 편집을 Ctrl+Z로 되돌리면 New 문장이 중복되는 결함을 찾음**(스텝 0 `fix/new-edit-undo`). 시안 3차 답: C 시트 가림, 시험 변경 승인, Ctrl+Z 결함만 먼저, 반응속도(6-1절)를 넣음 — 실측 `Del` → 다음 박스 366ms, 0.15초 연타 5번 중 3번 사라짐. 11-23 명세 17개 항목은 모두 확정 · 모두 범위(원문을 `specs/2026-11-23-assign-feedback-2.md`로 넣음, 겹치는 곳은 설계 11-1절 — F2의 To-Be 이동 · 새 문서 추가만 숨김 결정으로 보류). 구현 계획은 `docs/superpowers/plans/2026-11-25-split-first.md`(브랜치 35개, 다섯 파일 + 장부), 구현은 다음 세션.
- 합성 문서로 확인한 것: 한 문단에 한/영이 섞인 문서를 배치가 "한/영 따로"로 잡는다, 제목 스타일 조항은 New에서 이을 박스가 없다, 짝 판이 넓은 창에서 용지 폭을 줄인다(860 → 752).
