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
