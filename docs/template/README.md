# Claude Code Template

Claude Code 프로젝트용 공통 규칙 + 셋업 자동화 템플릿.

새 프로젝트는 **3 단계**로 시작한다 — 복사 → `/init` → `/setup-from-template`.
자세한 절차·예시·FAQ 는 [`USAGE.md`](./USAGE.md) 참고.

## 구성

| 파일/폴더 | 역할 |
|-----------|------|
| `CLAUDE.md` | 허브 seed. `## Rules` (범용 / 백엔드·Docker / 프론트엔드) / `## Language-Specific` `@import` 만 담는다 |
| `.claude/commands/setup-from-template.md` | 셋업 자동화 슬래시 커맨드 |
| `.claude/commands/sync.md` | `/sync` — 변경 감지 후 영향받는 파일만 동기화 |
| `.claude/commands/sync-all.md` | `/sync-all` — 동기화 체크리스트 전체 점검 |
| `.claude/commands/agile.md` | `/agile` — 간단한 기능·UI 개선을 테스트·계획 오버헤드 없이 빠르게 구현하는 모드 |
| `rules/guidelines.md` | 행동 가이드 (최우선, `CLAUDE.md` 최상단 링크) |
| `rules/common/` | 범용 규칙 (주석·네이밍·Git·보안·에러·의존성·문서·테스트) |
| `rules/backend/` | 백엔드·Docker 규칙 (설정·Docker·동기화) — 백엔드/배포 프로젝트만 |
| `rules/frontend/` | 프론트엔드 규칙 (`data-testid` 식별자) — UI 프로젝트만 |
| `rules/languages/` | 언어 규칙 (Python, TypeScript) |
| `docs/template/` | **이 템플릿** 의 메타 문서 (`README.md`, `USAGE.md`). 다운스트림에서는 보통 삭제 |
| `.gitignore` | Claude 로컬 파일·env·OS·언어별 산출물 제외 |

## Quick Start

```bash
# 1) 복사
cp -r . ../project_path
cd ~/project_path
rm -rf .git && git init

# 2) /init  (Claude Code 안에서)
#    프로젝트 메타 섹션 (Project, Commands 등) 자동 생성

# 3) /setup-from-template  (Claude Code 안에서)
#    사용 안 하는 import 가지치기, 디자인 토큰 배치, 메타 문서 정리, 검증
```

## 허브 구조를 쓰는 이유

- `CLAUDE.md` 는 항상 짧다 → 프로젝트 overview 가 한눈에 들어온다
- 규칙을 바꿔도 허브는 건드리지 않는다 (`rules/*.md` 만 수정)
- 규칙을 끄려면 `@import` 한 줄만 지운다
- 언어별 규칙은 `rules/languages/` 로 분리해 일반 규칙과 시각적으로 구분
- `/init` + `/setup-from-template` 으로 수동 단계 제거 — placeholder 상태가 방치되지 않는다 (`rules/documentation.md` 가 강제)
