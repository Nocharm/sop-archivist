# 프런트 1차 작업 시작 프롬프트

별도 워크트리의 새 세션에 아래 블록을 그대로 붙인다. 백엔드 계획 2(AI 층)는 다른 세션이 동시에 진행한다.

```text
SOP Archivist 프런트 1차 작업을 시작한다. 백엔드 계획 2(AI 층)는 다른 세션이 동시에 진행 중이다.

준비
- 워크트리를 만들고 그 폴더에서 일한다.
  git -C /Users/hyeonjin/Documents/sop-archivist fetch sop-archivist
  git -C /Users/hyeonjin/Documents/sop-archivist worktree add -b feat/sop-frontend /Users/hyeonjin/Documents/sop-archivist-frontend sop-archivist/main
- CLAUDE.md와 rules/를 먼저 읽는다. 실행법은 README "로컬 실행"을 따른다(backend 8777, frontend 3777).
- 데모 데이터는 backend/에서 `.venv/bin/python -m scripts.seed_sop_demo`로 넣는다. 합성 묶음 3개(쪼개기 직후, 분류 절반, 검토 대기)가 생기고 로컬 전용이다.
- 화면 범위는 docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md §12, 자원은 §11이다. 실제 스키마는 backend를 띄운 뒤 /docs(OpenAPI)가 기준이다.

순서
1. 디자인 컨셉과 토큰이 아직 없다. 사용자와 먼저 정한다. 큰 화면은 시안 2–4개를 보여 고르게 한다.
2. AI 없이 되는 화면부터 만든다: 묶음 목록·개요, 문서, 쪼개기(원문 대조), To-Be, 입구 2 수동 짝 맞추기, 결과물, 검토.
3. 분류와 짝 맞추기 화면은 사람 경로로 먼저 만들고 AI 제안 자리만 잡아 둔다. AI API 스키마가 main에 들어오면 합쳐서 붙인다.

병행 규칙
- frontend/만 고친다. backend/, docs/superpowers/, docker-compose.yml은 건드리지 않는다. 백엔드 변경이 필요하면 고치지 말고 사용자에게 알린다.
- 버전(frontend/package.json version)과 CHANGELOG.md, 태그는 건드리지 않는다. main 합칠 때 정한다.
- main에 직접 푸시하지 않는다. 푸시는 `git push sop-archivist HEAD:feat/sop-frontend`만 쓴다. main 합치기는 사용자가 정한다.
- 백엔드 변경을 따라갈 때는 `git fetch sop-archivist && git merge sop-archivist/main`을 쓴다.
- 다른 세션이 claude-code-template 쪽 브랜치를 정리할 수 있다. 내 브랜치 말고 다른 브랜치·워크트리는 건드리지 않는다.
- 저장소는 공개다. 실서버 주소, 시크릿, 실제 SOP 원문을 넣지 않고 합성 데이터는 합성으로 표시한다.
```
