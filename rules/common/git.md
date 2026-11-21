# Git Conventions

```
type(scope): English summary — 한국어 요약

# Types: feat, fix, docs, refactor, test, chore, perf
# Scope: optional, module or feature name
```

- Commit messages explain **WHY**, not WHAT.
- **Write the description in both English and Korean** so it's easy to grasp at a glance (`type(scope): English summary — 한국어 요약`).
- One logical change per commit.
- Never amend published commits without explicit request.
- Never force-push to main/master.
- Prefer specific `git add <files>` over `git add .` or `git add -A`.

## Before Every Commit

커밋 직전 항상 확인한 뒤 스테이징·커밋한다 (갱신은 코드 변경과 **같은 커밋에** 담는다):

1. **`PROGRESS.md` 갱신** — 저장소 루트의 진행 현황 로그(없으면 생성)에 무엇을·왜 바꿨는지 기록한다.
   - 항목은 간결하게 — 커밋당 1–3줄, WHAT 나열보다 맥락·결정 위주 (WHAT은 커밋 메시지가 담당).
   - 갱신하는 김에 압축 가능한 기존 항목(같은 작업의 중간 단계, 되돌린 시도)은 요약으로 합친다.
2. **README 영향 확인** — 이번 커밋이 README가 설명하는 내용(커맨드, 구조, 설정, 사용법)을 바꿨으면 해당 섹션을 같은 커밋에서 갱신한다. 영향 없으면 건드리지 않는다. 전수 점검은 `/sync-all` (문서 규칙: `documentation.md`).
3. **진행 중인 체크리스트/트래커 md** — 작업 단위 트래커(예: 화면 개편 체크리스트 md)가 있으면 해당 행·항목(검증·시현·검토결과·커밋 열 등)을 같은 커밋에서 갱신한다. 없으면 생략.

## 서비스 버전 — 개발에서 본 번호를 그대로 운영에

작업은 `dev` 브랜치에서 하고(push하면 개발 스택 :4444에 바로 배포), 확인이 끝나면 `dev`를 `main`에 합쳐 운영(:7777)에 올린다(사용자 결정 2026-11-11). 버전은 상단 바 서비스 이름 옆에 보여서 개발·운영 서버에 어느 빌드가 올라가 있는지 화면으로 확인하는 기준이 된다. **개발 서버에서 확인한 번호가 운영에 그대로 올라간다** — 운영에 올릴 때 새 번호를 만들지 않는다(사용자 결정 2026-11-21, v1.5.0 뒤부터. 그전에는 정식 업데이트마다 MINOR를 올려 운영 번호의 끝자리가 늘 0이었다).

`MAJOR.MINOR.PATCH` = 큰 개편 · 운영에 올리는 묶음 · 그 묶음 안의 개발 빌드.

- **단일 소스**: `frontend/package.json` `version`(SemVer). `frontend/`에서 `npm version <minor|patch> --no-git-tag-version`으로 올린다(`package-lock.json`이 같이 바뀐다). 빌드 때 `next.config.ts` `env.APP_VERSION`으로 번들에 들어간다.
- **`dev`에 올릴 때마다 하나씩**: 앱 동작이 바뀌는 커밋을 GitHub `dev`에 푸시할 때 푸시 한 번에 번호 하나를 올린다. 문서·시험만의 푸시는 그대로 둔다. `CHANGELOG.md` 맨 위 `## Unreleased (dev)` 아래에 `vX.Y.Z — 날짜` 한 줄과 바뀐 것을 적는다.
  - **운영에 올린 뒤 첫 푸시는 MINOR**(`npm version minor` → 1.6.0), 그다음부터는 PATCH(1.6.1, 1.6.2 …). 지금 올릴 번호의 MINOR가 `CHANGELOG.md`의 가장 최근 릴리스 제목(`## vX.Y.Z`)과 같으면 이미 운영에 나간 줄이니 MINOR를 올린다.
- **정식 업데이트 `dev`→`main` — 버전을 올리지 않는다**: `dev`에서 릴리스 준비 커밋 하나(문서만이라 번호는 그대로)를 만든다 — `## Unreleased (dev)` 아래 줄들 위에 `## vX.Y.Z — 날짜` 제목(지금 `package.json`의 번호)을 달고 배포 메모 · 검증 결과를 덧붙이고(줄마다의 기록은 다시 쓰지 않고 그대로 둔다, `Unreleased (dev)`는 비워서 맨 위에 남긴다), 사용 설명서 머리 `version`·`updated`, 루트 `CLAUDE.md` 상태 줄 · `README.md` 현재 버전을 같이 고치고, 이 묶음으로 끝난 설계 스냅숏·구현 계획을 지운다(`documentation.md` "설계 스냅샷 폐기 정책", `docs/README.md` 인덱스도). 그 커밋에 annotated 태그 `vX.Y.Z`를 달고 `main`에 합친 뒤 브랜치와 태그를 푸시한다(`git push origin vX.Y.Z`). 태그는 옮기거나 다시 달지 않는다. 고칠 것이 생기면 `dev`에서 고쳐 다음 업데이트로.
- **운영 급한 수정**: `main`에서 바로 고쳐야 하면 운영 줄에서 PATCH를 올린다(1.6.12 → 1.6.13). `CHANGELOG.md`에 `## v1.6.13 — 날짜` 항목을 맨 위 릴리스로 더하고 태그를 단 뒤 `main`을 `dev`에 합친다 — `dev`는 이미 다음 줄(1.7.x)이라 번호가 겹치지 않고, `package.json` 충돌은 `dev`의 번호를 남긴다.
- **MAJOR**: 1.0.0은 T/F가 실제 SOP로 정식 사용을 시작할 때 올렸다(0.x는 "실제 SOP·모델 검증 전"). 그 뒤로는 화면 흐름이나 자료 구조가 크게 바뀌어 사용자가 다시 익혀야 할 때만, 사용자와 정한다. 올린 뒤 첫 번호는 X.0.0.
- **사용 설명서 그림**: 설명서의 글은 화면을 바꾸는 커밋에서 함께 고치고, 화면 그림은 정식 업데이트 준비 때만 다시 뽑는다(사용자 결정 2026-11-15) — 그림 뽑기는 오래 걸리고, 글은 나중에 몰아서 검사하기 어렵다. 그 묶음에서 바뀐 화면의 장면만 뽑는다(`ONLY=<장면,…>`, 사용자 결정 2026-11-21). 전부 다시 뽑는 것은 공용 부품 · 테마처럼 모든 화면이 바뀌었을 때만.
- **사용 설명서 버전**: 정식 업데이트 준비 커밋에서 `frontend/public/manual/user-manual.md` 머리의 `version`(그 릴리스 번호 `X.Y.Z`)·`updated`를 올린다 — 설명서를 그 릴리스의 화면과 다시 맞춰 읽었다는 표시다. `manual-content.test.ts`가 `CHANGELOG.md` 가장 최근 릴리스 제목과 MAJOR.MINOR가 같은지 본다(운영 급한 수정은 같은 줄이라 그대로 둔다).
- **푸시 범위**: 커밋·푸시는 GitHub(`origin`)에만 한다. 사내 GitLab push와 파이프라인 배포는 사용자가 PC에서 한다(`docs/deploy/gitlab-runner.md`).
- **배포 기록**: 운영 서버에 올린 뒤 상단 바 버전으로 확인하고, `CHANGELOG.md` 해당 항목에 배포일을 적는다. 개발 스택 배포는 적지 않는다.

## 문서 정리 (문맥 다이어트) — 시험이 알릴 때

세션마다 실리는 md(루트 `CLAUDE.md` + `@` 불러오기)와 커밋마다 읽는 기록(`PROGRESS.md`·`CHANGELOG.md`)이 쌓이면 세션이 무거워진다(사용자 결정 2026-11-14, 1.0.0 때 처음 정리 — 늘 실리는 양 약 1.7만 → 1만 토큰). 정식 업데이트와 떼어(사용자 결정 2026-11-21), `frontend/src/lib/release-docs.test.ts`가 `CHANGELOG.md`·`PROGRESS.md` 크기 상한을 넘었다고 알리면 정리 커밋 하나에서 한다(문서만이라 번호는 그대로):

1. **CHANGELOG**: `CHANGELOG.md`에는 `Unreleased (dev)`와 가장 최근 정식 릴리스(그 줄의 운영 급한 수정 포함)만 남기고, 그 전 항목은 `docs/history/CHANGELOG-archive.md` 맨 위로 옮긴다. 운영 배포일 기록은 옮긴 항목에도 그대로 적는다.
2. **PROGRESS**: 가장 최근 정식 릴리스까지 쌓인 항목을 `docs/history/PROGRESS-archive.md` 맨 위로 옮기고, `PROGRESS.md`에는 머리말과 릴리스 뒤 항목만 둔다. 그래도 넘으면 같은 작업의 항목을 요약으로 합친다.

늘 지키는 것:

- **루트 CLAUDE.md 상태 줄은 덧붙이지 않고 바꿔 쓴다** — 버전·배포·검증 상태만(기능 이력은 CHANGELOG의 몫).
- **루트 CLAUDE.md에 새 내용을 더할 때**: 모든 세션에 필요한지 본다 — 한 폴더 일이면 그 폴더 `CLAUDE.md`, 가끔 쓰는 절차·명령은 `docs/`(예: `docs/qa/verification-commands.md`)에 두고 링크만. 언어·폴더 규칙은 폴더 `CLAUDE.md`가 `@../rules/...`로 불러온다.

## On Branch Merge

브랜치를 dev/main에 머지할 때, 그 브랜치에서 쌓인 `PROGRESS.md` 항목들을 **하나의 요약 항목으로 압축**한다 — 브랜치의 목적·결과·주요 결정만 남기고 중간 시행착오 항목은 삭제한다. 머지 커밋(또는 머지 직후 커밋)에서 수행하며, PROGRESS 머지 충돌도 이 요약본으로 해소한다.
