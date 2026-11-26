# Code Conventions

언어 공통. casing은 `rules/languages/<lang>.md`.

## 주석

- 파일마다 맨 위에 역할 한 줄(`"""Role description."""` · `// ...`).
- 주석은 **왜**만 — 코드를 다시 읽어 주는 주석은 쓰지 않는다. 라이브러리 옵션 · 공식 · 경합은 그 줄에 까닭.
- 상수는 단위 · 범위 · 바꾸면 무엇이 달라지는지를 줄 끝에.

## 함수 이름은 동사로 시작

| 뜻 | 동사 |
|----|------|
| 읽기 | `get` `fetch` `load` `read` `find` |
| 만들기 | `create` `build` `make` `generate` |
| 바꾸기 | `update` `set` `apply` `merge` |
| 지우기 | `delete` `remove` `clear` |
| 변환 | `parse` `format` `convert` `normalize` |
| 검사 | `validate` `check` `ensure` `verify` |
| 참거짓 | `is` `has` `should` `can` |
| 처리 | `handle` `process` `run` `execute` |

## 오류 · 보안

- 입력 검증은 API 경계에서만, 안쪽 코드는 믿는다. SQL은 매개변수로만.
- 예외를 조용히 삼키지 않는다. 메시지에 맥락(요청 값 · 상태 코드)을 담고, 로그는 문자열 끼워 넣기 대신 필드로.
- 외부 API는 로그와 함께 다시 시도한 뒤 마지막 오류를 올린다.
- 시크릿 · `.env`는 커밋하지 않고 코드에 박지 않는다(환경 변수). 공개 저장소 규칙은 루트 CLAUDE.md.

## 의존성 · 시험

- 운영 · 개발 의존성을 나누고(requirements.txt · requirements-dev.txt, dependencies · devDependencies) 정확한 버전으로 고정한다. 새 의존성은 표준 라이브러리로 안 되는지 먼저 보고, 뻔하지 않으면 까닭을 적는다.
- 새 기능에는 시험. 외부 의존(API · 사내 AI · 엔진)만 mock하고 안쪽 로직은 진짜 경로로. AAA(준비 · 실행 · 확인).
