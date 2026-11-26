# Documentation Rules

- 루트 `README.md`는 지금 프로젝트를 설명한다(무엇 · 누가 · 설치 · 주요 명령 · 폴더). 커밋 때는 그 커밋이 어긋나게 만든 절만 고치고, 전수 점검은 `/sync` · `/sync-all`.
- **로컬 명령은 bash와 PowerShell을 늘 병기**한다 — 로컬 검증 PC가 Windows다. 서버(리눅스) 전용 절차는 bash만.
- 제품 명세 `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`와 기반 명세 `2026-11-04-sop-archivist-baseline-design.md`는 코드 · 문서가 `§X`로 참조하니 **옮기거나 이름을 바꾸지 않는다**.
- `docs/design/*-design.md`는 소스 주석(`// 설계: docs/design/…`)이 경로로 참조한다 — 옮기거나 지우면 `git grep "docs/design/"`로 참조도 함께 고친다.
- 새 문서는 `docs/`의 카테고리 폴더에 넣고 `docs/README.md` 인덱스에 한 줄. 폴더 구성 · 끝난 설계와 계획 지우기 · 아카이브 정책은 `docs/README.md` "문서 정리 정책".
