# Git Conventions

```
type(scope): English summary — 한국어 요약

# Types: feat, fix, docs, refactor, test, chore, perf
# Scope: optional, module or feature name
```

- 커밋 메시지는 **왜**를 적는다. 한 커밋에 한 가지. `git add <파일>`로 골라 담는다(`.` · `-A` 말고).
- 올린 커밋을 요청 없이 amend하지 않고, main에 강제 푸시하지 않는다.
- **커밋 · 푸시는 GitHub(`origin`)에만.** 사내 GitLab push와 파이프라인 배포는 사용자가 PC에서 한다(`docs/deploy/gitlab-runner.md`).

## 커밋 직전 (같은 커밋에 담는다)

1. **`PROGRESS.md`** — 무엇을 · 왜 바꿨는지 커밋당 1–3줄, 맥락 · 결정 위주(WHAT은 커밋 메시지). 같은 작업의 중간 단계 · 되돌린 시도는 요약으로 합친다.
2. **README** — 이번 커밋이 README가 설명하는 것(명령 · 구조 · 설정 · 사용법)을 바꿨을 때만 그 절을 고친다. 전수 점검은 `/sync-all`.
3. **진행 중인 트래커 md**(체크리스트 · 장부)가 있으면 해당 행을 같은 커밋에서.

브랜치를 dev/main에 합칠 때는 그 브랜치의 `PROGRESS.md` 항목을 목적 · 결과 · 주요 결정만 남긴 요약 하나로 합친다(머지 충돌도 이 요약으로 푼다).

## 서비스 버전 — dev에 올릴 때마다 하나

작업은 `dev`에서 하고(푸시하면 개발 스택 :4444에 바로 배포), 확인이 끝나면 `dev`를 `main`에 합쳐 운영(:7777)에 올린다. 버전은 상단 바에 보여 어느 빌드가 올라갔는지 화면으로 확인하는 기준이다. `MAJOR.MINOR.PATCH` = 큰 개편 · 운영에 올리는 묶음 · 그 묶음 안의 개발 빌드.

- **단일 소스**: `frontend/package.json` `version`. `frontend/`에서 `npm version <minor|patch> --no-git-tag-version`(`package-lock.json`이 같이 바뀐다). 빌드 때 `next.config.ts` `env.APP_VERSION`으로 번들에 들어간다.
- **앱 동작이 바뀌는 푸시 한 번에 번호 하나.** 문서 · 시험만의 푸시는 그대로. `CHANGELOG.md` 맨 위 `## Unreleased (dev)` 아래에 `vX.Y.Z — 날짜` 한 줄과 바뀐 것.
  - **운영에 올린 뒤 첫 푸시는 MINOR**, 그다음은 PATCH. 올릴 번호의 MINOR가 `CHANGELOG.md`의 가장 최근 릴리스 제목(`## vX.Y.Z`)과 같으면 이미 운영에 나간 줄이니 MINOR를 올린다.
- **정식 업데이트(dev→main) · 운영 급한 수정 · MAJOR · 설명서 그림과 버전 · 배포 기록 · 문서 정리**는 그때 `/release`(절차 `docs/deploy/release.md`). 요점: 운영에는 개발에서 본 번호를 그대로 올리고 새 번호를 만들지 않는다.
