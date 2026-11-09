# Documentation Rules

`README.md` (and `USAGE.md` when needed) describes **the current project**. Don't leave template placeholders or meta guides in place.

**Do:**
- Root `README.md` covers — one-line summary of what the project does, who uses it, setup, key commands, primary directory layout.
- **로컬에서 실행하는 명령어는 bash(macOS/Linux)와 PowerShell(Windows)을 항상 병기**한다 — 로컬 검증이 Windows PC에서 이뤄지는 운영 파이프라인 때문. 서버(리눅스) 전용 절차(docker compose 등)는 bash만 작성한다.
- If the project warrants a `USAGE.md` (CLI tool, library, app with separate end-user guide), write **that project's** usage — not a meta guide.
- For projects started from a template, replacing the root `README.md` placeholder is one of the first tasks.
- README upkeep is two-tier — at commit time, update only the sections the commit invalidates (see `git.md` — Before Every Commit); full sweeps run on request via `/sync` · `/sync-all` (backend/Docker projects: `rules/backend/sync-checklist.md`).

**Don't:**
- Stack `feat:` / `fix:` commits while `_TODO_` or `<project name>` placeholders remain.
- Leave the template's meta README/USAGE (which describes the *template*, not your project) in a downstream project.
- Make the first meaningful commit while the README is still a one-line placeholder.

## docs/ 구조 · 유지관리

문서는 카테고리 폴더로 정리한다. 인덱스는 [`docs/README.md`](../../docs/README.md).

- **루트 유지**: `docs/README.md`(인덱스). 살아있는 기능 명세는 `docs/superpowers/specs/`의 설계 문서이고, 코드·문서가 `§X`로 참조하니 이동·개명 금지.
- **카테고리 폴더**: `docs/deploy/`(배포·DB 시드·마이그레이션) · `docs/qa/`(검증·감사) · `docs/design/`(기능별 설계 스냅샷 + 분야별 인덱스) · `docs/lessons/`(시행착오 방지) · `docs/domain/`(업무 도메인 기준·사례 — AI 지침과 테스트 정답의 근거, 살아있는 문서) · `docs/manual/`(시스템 설명서 — 실제 화면 그림은 스크립트로 다시 뽑는다) · `docs/superpowers/`(`specs/` 설계·`plans/` 구현 계획) · `docs/history/`(아카이브).
- **설계 문서 참조 불변식**: `docs/design/*-design.md`는 **소스 코드 주석(`// 설계: docs/design/…`)이 정확한 경로로 참조**한다. 옮기거나 이름을 바꾸면 `git grep "docs/design/"`로 그 참조도 반드시 함께 갱신한다.
- **설계 스냅샷 폐기 정책**: 기능이 **main에 머지되면 해당 설계 스냅샷은 삭제**한다(git history가 보존). 저장소에는 아직 소비될 문서(미구현 트랙·대기 중 계약·핸드오프)만 남긴다. **단, 개발 중 자주 참조하는 불변식·계약은 삭제 전에 살아있는 문서(CLAUDE.md 계약 섹션·`docs/lessons/`·`docs/superpowers/specs/`)로 흡수했는지 확인하고, 흡수가 어색하면 파일을 유지한다.** 삭제 시 `git grep`으로 코드 주석 참조는 `docs/design/` 경로 접두를 떼 파일명만 남기고, 문서 링크는 라벨 텍스트로 강등한다. 완료된 기능의 구현 플랜(`docs/superpowers/plans/`)도 동일하게 삭제.
- **새 문서**: 위 카테고리 중 하나에 넣고 `docs/README.md` 인덱스(설계 문서면 `docs/design/README.md`도)에 한 줄 추가한다. 문서를 옮기면 `git grep`으로 참조를 전수 갱신하고 끊긴 링크가 없는지 확인한다.
- **PROGRESS 아카이브**: 루트 `PROGRESS.md`는 최근 항목만 유지하고, 오래된 상세 항목은 `docs/history/PROGRESS-archive.md`로 옮긴다(더 오래된 것은 git history).
