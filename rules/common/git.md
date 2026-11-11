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

## 서비스 버전 — dev 업데이트는 PATCH, main 정식 업데이트는 MINOR

작업은 `dev` 브랜치에서 하고(push하면 개발 스택 :4444에 바로 배포), 확인이 끝나면 `dev`를 `main`에 합쳐 운영(:7777)에 올린다(사용자 결정 2026-11-11). 버전은 상단 바 서비스 이름 옆에 보여서 개발·운영 서버에 어느 빌드가 올라가 있는지 화면으로 확인하는 기준이 된다.

- **단일 소스**: `frontend/package.json` `version`(SemVer). `frontend/`에서 `npm version <minor|patch> --no-git-tag-version`으로 올린다(`package-lock.json`이 같이 바뀐다). 빌드 때 `next.config.ts` `env.APP_VERSION`으로 번들에 들어간다.
- **PATCH — `dev`에 올릴 때마다**: 앱 동작이 바뀌는 커밋을 GitHub `dev`에 푸시할 때 푸시 한 번에 PATCH 하나를 올린다(0.14.1 → 0.14.2 …). 문서·시험만의 푸시는 그대로 둔다. 태그는 달지 않고, `CHANGELOG.md` 맨 위 `## Unreleased (dev)` 아래에 `vX.Y.Z — 날짜` 한 줄과 바뀐 것을 적는다.
- **MINOR — `dev`→`main` 정식 업데이트**: 머지 정리 커밋에서 MINOR를 올리고(PATCH는 0으로) `Unreleased (dev)`의 줄들을 그 릴리스 항목(날짜·범위·주요 변경·배포 메모) 하나로 모은다. 그 커밋에 annotated 태그 `vX.Y.Z`를 달고 태그까지 푸시한다(`git push origin vX.Y.Z`). 태그는 옮기거나 다시 달지 않는다. 고칠 것이 생기면 `dev`에서 고쳐 다음 업데이트로.
- **운영 급한 수정**: `main`에서 바로 고쳐야 하면 PATCH를 올리고 태그를 단 뒤 같은 커밋을 `dev`에도 합친다.
- **MAJOR — 1.0.0**: T/F가 실제 SOP로 정식 사용을 시작할 때 한 번 올린다(0.x는 "실제 SOP·모델 검증 전"이라는 뜻). 그 뒤로는 화면 흐름이나 자료 구조가 크게 바뀌어 사용자가 다시 익혀야 할 때만, 사용자와 정한다.
- **사용 설명서 버전**: MINOR(또는 MAJOR)를 올리면 `frontend/public/manual/user-manual.md` 머리의 `version`(`MAJOR.MINOR`)·`updated`도 같은 커밋에서 올린다 — 설명서를 그 릴리스의 화면과 다시 맞춰 읽었다는 표시다. 어긋나면 `manual-content.test.ts`가 실패한다. PATCH는 그대로 둔다.
- **푸시 범위**: 커밋·푸시는 GitHub(`origin`)에만 한다. 사내 GitLab push와 파이프라인 배포는 사용자가 PC에서 한다(`docs/deploy/gitlab-runner.md`).
- **배포 기록**: 운영 서버에 올린 뒤 상단 바 버전으로 확인하고, `CHANGELOG.md` 해당 항목에 배포일을 적는다. 개발 스택 배포는 적지 않는다.

## On Branch Merge

브랜치를 dev/main에 머지할 때, 그 브랜치에서 쌓인 `PROGRESS.md` 항목들을 **하나의 요약 항목으로 압축**한다 — 브랜치의 목적·결과·주요 결정만 남기고 중간 시행착오 항목은 삭제한다. 머지 커밋(또는 머지 직후 커밋)에서 수행하며, PROGRESS 머지 충돌도 이 요약본으로 해소한다.
