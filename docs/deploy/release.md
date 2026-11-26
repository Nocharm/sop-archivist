# 정식 업데이트 · 버전 절차

`/release`가 이 문서를 읽고 따른다. 평소 커밋 · dev 푸시마다의 버전 규칙은 `rules/common/git.md`(세션마다 실림), 이 문서는 운영에 올릴 때와 가끔 쓰는 절차다.

**개발 서버에서 확인한 번호가 운영에 그대로 올라간다** — 운영에 올릴 때 새 번호를 만들지 않는다(사용자 결정 2026-11-21, v1.5.0 뒤부터. 그전에는 정식 업데이트마다 MINOR를 올려 운영 번호의 끝자리가 늘 0이었다). dev→main 운영 흐름은 사용자 결정 2026-11-11.

## 정식 업데이트 `dev`→`main` — 버전을 올리지 않는다

`dev`에서 릴리스 준비 커밋 하나(문서만이라 번호는 그대로)를 만든다:

1. `CHANGELOG.md` — `## Unreleased (dev)` 아래 줄들 위에 `## vX.Y.Z — 날짜` 제목(지금 `package.json`의 번호)을 달고 배포 메모 · 검증 결과를 덧붙인다. 줄마다의 기록은 다시 쓰지 않고 그대로 두고, `Unreleased (dev)`는 비워서 맨 위에 남긴다. 운영 DB의 기존 행을 지우거나 바꾸는 Alembic 리비전이 있으면 배포 메모에 굵게.
2. 사용 설명서 머리 `version`·`updated`(아래 "사용 설명서"), 루트 `CLAUDE.md` 상태 줄, `README.md` 현재 버전.
3. 이 묶음으로 끝난 설계 스냅숏 · 구현 계획을 지운다(`docs/README.md` "문서 정리 정책", 인덱스도).

그 커밋에 annotated 태그 `vX.Y.Z`를 달고 `main`에 합친 뒤 브랜치와 태그를 푸시한다(`git push origin vX.Y.Z`). 태그는 옮기거나 다시 달지 않는다. 고칠 것이 생기면 `dev`에서 고쳐 다음 업데이트로.

```bash
git fetch && git switch dev && git pull --ff-only
git tag -a vX.Y.Z -m "vX.Y.Z — 정식 업데이트" && git switch main && git pull --ff-only \
  && git merge --no-ff dev -m "Merge dev into main (vX.Y.Z)" && git push origin main && git push origin vX.Y.Z && git switch dev
```

그 뒤 사용자가 GitLab `deploy-production` ▶ → 상단 바 확인.

## 배포 기록

운영 서버에 올린 뒤 상단 바 버전으로 확인하고, `CHANGELOG.md` 해당 항목에 배포일을 적는다. 개발 스택 배포는 적지 않는다.

## 운영 급한 수정

`main`에서 바로 고쳐야 하면 운영 줄에서 PATCH를 올린다(1.6.12 → 1.6.13). `CHANGELOG.md`에 `## v1.6.13 — 날짜` 항목을 맨 위 릴리스로 더하고 태그를 단 뒤 `main`을 `dev`에 합친다 — `dev`는 이미 다음 줄(1.7.x)이라 번호가 겹치지 않고, `package.json` 충돌은 `dev`의 번호를 남긴다.

## MAJOR

1.0.0은 T/F가 실제 SOP로 정식 사용을 시작할 때 올렸다(0.x는 "실제 SOP·모델 검증 전"). 그 뒤로는 화면 흐름이나 자료 구조가 크게 바뀌어 사용자가 다시 익혀야 할 때만, 사용자와 정한다. 올린 뒤 첫 번호는 X.0.0.

## 사용 설명서

- **그림**: 설명서의 글은 화면을 바꾸는 커밋에서 함께 고치고, 화면 그림은 정식 업데이트 준비 때만 다시 뽑는다(사용자 결정 2026-11-15) — 그림 뽑기는 오래 걸리고, 글은 나중에 몰아서 검사하기 어렵다. 그 묶음에서 바뀐 화면의 장면만 뽑는다(`ONLY=<장면,…>`, 사용자 결정 2026-11-21). 전부 다시 뽑는 것은 공용 부품 · 테마처럼 모든 화면이 바뀌었을 때만.
- **버전**: 정식 업데이트 준비 커밋에서 `frontend/public/manual/user-manual.md` 머리의 `version`(그 릴리스 번호 `X.Y.Z`)·`updated`를 올린다 — 설명서를 그 릴리스의 화면과 다시 맞춰 읽었다는 표시다. `manual-content.test.ts`가 `CHANGELOG.md` 가장 최근 릴리스 제목과 MAJOR.MINOR가 같은지 본다(운영 급한 수정은 같은 줄이라 그대로 둔다).

## 문서 정리 (문맥 다이어트) — 시험이 알릴 때

세션마다 실리는 md와 커밋마다 읽는 기록(`PROGRESS.md`·`CHANGELOG.md`)이 쌓이면 세션이 무거워진다(사용자 결정 2026-11-14). 정식 업데이트와 떼어(사용자 결정 2026-11-21), `frontend/src/lib/release-docs.test.ts`가 크기 상한을 넘었다고 알리면 정리 커밋 하나에서 한다(문서만이라 번호는 그대로):

1. **CHANGELOG**: `Unreleased (dev)`와 가장 최근 정식 릴리스(그 줄의 운영 급한 수정 포함)만 남기고, 그 전 항목은 `docs/history/CHANGELOG-archive.md` 맨 위로 옮긴다. 운영 배포일 기록은 옮긴 항목에도 그대로.
2. **PROGRESS**: 가장 최근 정식 릴리스까지 쌓인 항목을 `docs/history/PROGRESS-archive.md` 맨 위로 옮기고, `PROGRESS.md`에는 머리말과 릴리스 뒤 항목만 둔다. 그래도 넘으면 같은 작업의 항목을 요약으로 합친다.

늘 지키는 것:

- **루트 CLAUDE.md 상태 줄은 덧붙이지 않고 바꿔 쓴다** — 버전 · 배포 · 검증 상태만(기능 이력은 CHANGELOG).
- **루트 CLAUDE.md에 새 내용을 더할 때** 모든 세션에 필요한지 본다 — 한 폴더 일이면 그 폴더 `CLAUDE.md`, 가끔 쓰는 절차 · 명령은 `docs/`에 두고 링크만.
