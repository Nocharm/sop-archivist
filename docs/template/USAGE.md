# Claude Code 템플릿 사용 가이드

이 가이드는 `claude-code-template` 을 새 프로젝트의 출발점으로 사용하는 방법을 설명한다. 핵심 흐름은 **3 단계**다 — 복사 → `/init` → `/setup-from-template`.

---

## 파일 구성

```
CLAUDE.md                       # 허브 seed (## Rules / Language-Specific 만)
README.md                       # 프로젝트 placeholder (한 줄)
.claude/
  commands/
    setup-from-template.md      # 셋업 자동화 슬래시 커맨드
    sync.md                     # /sync — 변경 기반 동기화
    sync-all.md                 # /sync-all — 전체 체크리스트 점검
    agile.md                    # /agile — 소규모 작업 고속 구현 모드
docs/
  template/
    README.md                   # 이 템플릿의 README (다운스트림에서는 보통 삭제)
    USAGE.md                    # 이 가이드 (다운스트림에서는 보통 삭제)
rules/
  guidelines.md                 # 행동 가이드 (최우선)
  common/                       # 범용 규칙
    comments.md
    naming.md
    git.md
    security.md
    error-handling.md
    dependencies.md
    documentation.md            # README/USAGE 작성 규칙
    testing.md
  backend/                      # 백엔드·Docker 규칙
    config.md
    docker.md
    sync-checklist.md
  languages/
    python.md
    typescript.md
```

**관계:**
- `CLAUDE.md` 는 허브 seed. `## Rules` 블록의 `@rules/<file>.md` import 만 담는다.
- `/init` 이 Project / Commands 같은 프로젝트 메타 섹션을 자동 생성.
- `/setup-from-template` 이 사용 안 하는 언어 import 가지치기, 메타 문서 정리를 자동화.

---

## Step 1. 폴더 복사

새 프로젝트 위치로 통째로 복사한다.

```bash
# 옵션 A — 파일 복사
cp -r /path/to/claude-code-template ~/new-project
cd ~/new-project
rm -rf .git && git init                  # 템플릿 이력 제거 후 새 git 시작

# 옵션 B — 템플릿 레포 clone 후 git 초기화
git clone <template-repo-url> ~/new-project
cd ~/new-project
rm -rf .git && git init
```

> **중요:** 허브 파일은 반드시 `CLAUDE.md` 라는 이름이어야 한다. Claude Code 는 프로젝트 루트의 `CLAUDE.md` 를 자동으로 읽는다.

---

## Step 2. `/init` 실행

Claude Code 안에서:

```
/init
```

`/init` 은 폴더 내용을 분석해 다음을 생성/보강한다:
- "What this repository is" / "Project" 같은 프로젝트 설명
- "Commands" — build / test / lint / dev 명령어 (실제 의존성 파일에서 추론)
- "Architecture" / 주요 디렉터리 설명

기존의 `## Rules` / `## Language-Specific Rules` 블록은 그대로 보존되는 것이 일반적이다.
다만 `/init` 의 동작 (도구 버전·폴더 상태에 따라 augment 또는 overwrite) 에 따라 블록이 변경되거나 사라질 수 있다 — 그 경우에도 다음 Step 의 `/setup-from-template` 이 `## Rules` 블록을 복원/정상화하므로 그대로 진행하면 된다.

---

## Step 3. `/setup-from-template` 실행

Claude Code 안에서:

```
/setup-from-template
```

다음을 자동 수행한다:
0. 재실행 감지 — `docs/template/` 부재 + `README.md` placeholder 부재 등 휴리스틱으로 이미 셋업된 폴더인지 확인. 그렇다면 진행 여부를 묻고 N 이면 종료
1. 스택 감지 (`package.json`, `pyproject.toml` / `requirements.txt`)
2. `## Rules — 백엔드/Docker` / `## Language-Specific Rules` 의 사용 안 하는 `@import` 라인 제거
3. 메타 문서 (`docs/template/`) 삭제 확인 — 이 프로젝트는 더 이상 템플릿이 아니므로 보통 삭제
4. 루트 `README.md` 가 placeholder 상태면 안내 (사용자 또는 `/init` 결과로 교체할 것)
5. 모든 `@import` 경로가 실제 파일을 가리키는지 검증 후 결과 요약

비가역 작업 (파일 삭제·이동) 전에는 매번 사용자 확인을 받는다.

---

## Step 4 (선택). 프로젝트 특화 규칙 추가

범용 규칙 외에 프로젝트에만 해당하는 규칙이 있다면:

**방법 A — `CLAUDE.md` 에 직접 추가:**

`## Rules` 위쪽에 프로젝트 전용 섹션을 둔다.

````markdown
## Project Structure

```
src/
├── api/          # API 라우터. 비즈니스 로직 금지.
├── services/     # 비즈니스 로직.
├── models/       # DB 모델.
└── utils/        # 공용 유틸.
```

## Gotchas
- Redis 연결은 connection pool 필수
- 파일 업로드 50MB 제한 (nginx + 앱 양쪽 설정)
````

**방법 B — `rules/` 에 새 파일 생성:**

규칙이 길거나 여러 개라면 `rules/<topic>.md` 를 만들고 `CLAUDE.md` 의 `## Rules` 목록에 `@rules/<topic>.md` 를 추가.

프로젝트별로 계속 커지는 규칙은 B 가 낫다 — 허브가 얇게 유지된다.

---

## 전체 체크리스트

- [ ] 1. 폴더 복사 + `rm -rf .git && git init`
- [ ] 2. `/init` 실행
- [ ] 3. `/setup-from-template` 실행
- [ ] 4. (선택) 프로젝트 특화 규칙 추가
- [ ] 5. 첫 의미있는 커밋 전에 루트 `README.md` 를 실제 내용으로 교체

---

## FAQ

**Q: `/init` 만 쓰고 이 템플릿 안 쓰면 안 되나?**
A: 가능하다. 다만 `rules/` 의 공통 규칙들을 못 쓴다. 이 템플릿의 가치는 `## Rules` 블록(범용/백엔드/언어)과 행동 가이드.

**Q: `/setup-from-template` 을 다시 실행해도 되나?**
A: 안전. 휴리스틱으로 이미 셋업된 폴더인지 감지해 사용자에게 진행 여부를 묻는다.

**Q: 규칙이 너무 많으면 Claude 가 무시하나?**
A: Anthropic 권장은 파일당 200줄 이하, 전체 규칙 150개 이하. 넘으면 준수율이 균일하게 하락한다. 허브 구조 덕분에 분리되어 있지만 총량 관리는 필요.

**Q: 팀원이 다른 AI 도구(Cursor, Copilot)를 쓰면?**
A: `CLAUDE.md` 는 Claude Code 전용이다. Cursor 는 `.cursorrules`, Copilot 은 `.github/copilot-instructions.md` 를 쓴다. 내용은 동일하게, 파일명·형식만 맞추면 된다.

**Q: `CLAUDE.md` 와 `.claude/settings.json` 의 차이는?**
A: `CLAUDE.md` = "이렇게 해줘" (권장 사항). `settings.json` = "이것만 허용" (권한 강제). 예: "pytest 허용" → `settings.json`, "테스트는 mock 으로" → `CLAUDE.md`.

**Q: `rules/` 가 아니라 `.claude/` 에 넣으면?**
A: `.claude/` 는 하네스 설정(`settings.json`, `commands/`, `agents/`, `hooks/`) 자리. `@import` 로 읽히는 지침 문서는 `rules/` 가 의미상 맞는다. 단, `.claude/commands/` 는 슬래시 커맨드 자리로 적극 활용한다 (이 템플릿의 `setup-from-template` 처럼).

**Q: `CLAUDE.md` 가 프로젝트 루트가 아닌 위치에 있어도 되나?**
A: Claude Code 는 프로젝트 루트의 `CLAUDE.md` 를 자동으로 읽는다. 또는 `.claude/CLAUDE.md` 에 둬도 된다. 모노레포처럼 서브 패키지마다 두려면 각 서브 패키지 루트에 별도 `CLAUDE.md` 를 두는 식이 적절하다.
