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

## On Main Merge — 서비스 버전

`Nocharm/sop-archivist`의 `main`에 머지할 때마다(작업 브랜치 → main fast-forward 포함) 서비스 버전을 올린다. 상단 바 서비스 이름 옆에 보이는 값이라, 운영 서버에 어느 빌드가 올라가 있는지 화면으로 확인하는 기준이 된다.

- **단일 소스**: `frontend/package.json` `version`(SemVer). `frontend/`에서 `npm version <minor|patch> --no-git-tag-version`으로 올린다(`package-lock.json`이 같이 바뀐다). 빌드 때 `next.config.ts` `env.APP_VERSION`으로 번들에 들어간다.
- **올림 규칙**: 사용자에게 보이는 기능·동작 변경이 있으면 MINOR, 버그 수정·문서·내부 변경만이면 PATCH. MAJOR는 사용자와 정한다.
- **같은 커밋에서**: 버전 올림과 루트 `CHANGELOG.md` 항목(날짜·범위·주요 변경·배포 메모)을 머지 정리 커밋에 담는다. 그 커밋에 annotated 태그 `vX.Y.Z`를 달고 태그까지 `sop-archivist` 저장소에 푸시한다(`git push <remote> vX.Y.Z`, 새로 clone한 PC·서버에서는 `<remote>`가 `origin`). 태그는 옮기거나 다시 달지 않는다. 고칠 것이 생기면 다음 PATCH로.
- **배포 기록**: 운영 서버에 올린 뒤 상단 바 버전으로 확인하고, `CHANGELOG.md` 해당 항목에 배포일을 적는다.
- main에 직접 들어가는 문서만의 커밋은 버전을 올리지 않아도 된다. 앱 동작이 바뀌는 커밋이 main에 단독으로 들어가면 PATCH를 올린다. 단 `v0.1.0`(기반 세팅)이 태그되기 전에는 태스크 커밋이 main에 푸시되어도 버전을 올리지 않고 `CHANGELOG.md` `Unreleased`에 쌓았다가 `v0.1.0` 한 번에 기록했다. 위 규칙은 `v0.1.0` 태그 이후의 main 푸시부터 그대로 적용한다.

## On Branch Merge

브랜치를 main에 머지할 때, 그 브랜치에서 쌓인 `PROGRESS.md` 항목들을 **하나의 요약 항목으로 압축**한다 — 브랜치의 목적·결과·주요 결정만 남기고 중간 시행착오 항목은 삭제한다. 머지 커밋(또는 머지 직후 커밋)에서 수행하며, PROGRESS 머지 충돌도 이 요약본으로 해소한다.
