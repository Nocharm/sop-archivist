# 신뢰 기반 계획 (2026-11-19)

Lauren Tan의 에이전트 개발 방식(코드 구조 → 정적 검사 → 검증 → 산문 순으로 투자하고, 교정을 결정적 검사로 바꾼다)으로 dev v1.1.51을 점검하고 사용자가 정한 방향. 스텝 1·2가 `dev`에 오를 때까지 새 기능 작업과 병렬 에이전트를 멈춘다(사용자 결정 2026-11-19). 그 뒤 병렬 에이전트는 동시에 2~3개까지.

## 점검 결과 (근거)

| 층 | 지금 | 신호 |
|---|---|---|
| 코드 구조 | `assign/page.tsx` 5,055줄(useEffect 19 · 타이머 26 · 훅 50), backend `editing.py`·`outputs.py`·`decisions.py` 약 2천 줄씩 | 11-05~19 커밋 762 중 fix 232, 그중 `fix(assign)` 52. 머지 당일 후속 fix가 잦다 |
| 정적 검사 | ESLint는 Next 기본, ruff는 기본(E·F), Python 타입 검사·import 경계·hook·pre-commit 없음. GitLab `deploy-dev`는 시험을 기다리지 않는다 | useEffect 120곳(54파일) · 타이머 90곳 무제한. TS `any`·`ts-ignore` 0, strict, React Compiler lint는 켜져 있다 |
| 검증 | `pw-smoke-sop.mjs` 12,638줄 한 파일, 감사 4종, 합성 E2E | 흔들림 언급이 PROGRESS에 15번, 브랜치 e는 기대값을 낮춰 합쳤다. 에이전트용 기능 맵이 없다 |
| 산문 | `backend/CLAUDE.md` "이중 사용 지점" 약 17개, `lessons/react-ts-patterns.md` §9·§10 | 대부분 시험·lint로 바꿀 수 있다. 프런트 사본 4개(`caption-slot-model`·`number-model`·`section-number`·`c-edit-model`)가 공용 사례 없이 백엔드 규칙을 따라간다 |

들이지 않는 것: 자동 병합(사내 규제 문서 도구), TLA+, 주석 대부분 금지(`rules/common/comments.md`의 why 주석과 충돌), 클라우드 에이전트. 스텝 4(`assign/page.tsx` 쪼개기)는 이번에 채택하지 않았다 — 스텝 1·2 뒤 다시 묻는다.

## 스텝

브랜치는 차례로(`dev`에 합친 뒤 다음 스텝을 새 `dev`에서 딴다). 각 스텝의 완료는 "추가한 검사가 실제로 실패하는 예와 통과하는 예의 출력"으로 보인다.

### 스텝 1 — 정적 관문 · `chore/static-gate`

- **ESLint 새 코드 차단**: `useEffect`·`useLayoutEffect`·`setTimeout`·`setInterval`·`requestAnimationFrame`을 허용 목록(지금 쓰는 파일 = 기준선) 밖에서 막는다. 에러 메시지에 대체 방법(이벤트 핸들러에서 처리, 렌더 중 파생값, `useEffectEvent`, `ResizeObserver` 콜백, 공용 훅)을 적는다. 허용 목록 파일이 늘지 않게 파일별 개수 예산 시험(vitest가 소스를 세어 기준선과 견줌)을 함께 둔다.
- **lessons를 검사로**: `react-ts-patterns.md` §9(display 유틸리티 이중 지정) · §10(직접 만든 클래스 이름이 Tailwind 유틸리티와 겹침)을 소스 검사 시험이나 lint로. 옮긴 뒤 lessons 항목은 "검사: <시험 이름>" 한 줄로 줄인다.
- **사유 없는 `eslint-disable` 금지**: `-- 사유`가 없는 disable 주석을 소스 검사 시험으로 막는다(새 의존성 없이).
- **ruff 규칙 확대**: `B`·`BLE`·`UP`·`TID`를 켠다. 먼저 위반 수를 재 보고, 많으면 규칙마다 나눠 켠다(ruff에는 기준선 기능이 없다).
- **Claude Code hook**: 프로젝트 `.claude/settings.json`에 PostToolUse(Edit·Write) → 고친 파일 하나만 eslint 또는 ruff를 돌려 결과를 돌려준다. 설정 문법은 현재 공식 문서를 확인한 뒤 쓴다.
- 확인: `npm run lint`·`tsc`·`vitest`·`ruff`·`pytest` 0 실패, CI(`.gitlab-ci.yml`)가 같은 명령을 돈다.
- **됨(2026-11-19)**: 기준선 `frontend/effect-baseline.json`, 시험 `frontend/src/source-rules.test.ts`, hook `.claude/hooks/lint-edited.sh`. 유틸리티를 일부러 덮는 선택자 4개(`truncate`·`flex-1`·`overflow-auto`·`overflow-y-auto`)는 사유와 함께 허용 목록. Python 타입 검사기는 넣지 않았다(계획 밖, 필요하면 따로).

### 스텝 2 — 불변식 시험 · `test/invariants`

- **backend 소스 검사 시험** `tests/test_invariants.py`: `backend/CLAUDE.md` "이중 사용 지점" 가운데 기계로 잴 수 있는 것을 시험으로(예: `segment.py` 밖 `isspace()` 판정 금지(허용 목록과 사유), 앱 코드의 `create_all` 금지, DB로 가는 글자 입력 칸의 `NoNulStr`). 잴 수 없는 것은 남기되 "왜 검사로 못 하는지"를 한 줄 적는다. 옮긴 항목의 CLAUDE.md 글은 시험 이름으로 줄인다.
- **프런트 사본 공용 사례**: backend 스크립트가 규칙 함수의 입력·답을 JSON으로 뽑고(저장소에 둔다), vitest가 프런트 사본으로 같은 답을 내는지 본다. pytest는 JSON이 지금 규칙과 같은지(다시 뽑아 비교) 본다 — 어느 쪽이 바뀌어도 CI가 깨진다. 대상: `caption-slot-model` · `number-model` · `section-number` · `c-edit-model`.
- 크면 2a(backend) · 2b(공용 사례)로 나눈다.
- **됨(2026-11-19)**: `backend/tests/test_invariants.py`(빈 글자 판정 · `create_all` · `call_ai_recorded` · AI의 `confirmed_text` · `compute` 세션 · `raise_rule` · `noqa` 사유, 술어마다 나쁜 꼴·좋은 꼴 시험), ruff `TID251`로 맨 `datetime.now()` 금지, `scripts/dump_rule_cases.py` → `frontend/src/lib/rule-cases.json` ↔ `rule-cases.test.ts`(`numberLines` · 글머리 기호 깊이 · `planFollow` · `buildBlockPlaces` · 상수). 첫 실행에서 실제 어긋남 하나를 찾아 고쳤다 — 프런트 빈 문단 판정이 `\x1c`–`\x1f`·`\x85`를 보이는 글자로 봐 캡션 자리 거리가 서버와 달랐다. 프런트 "한 길" 규칙(raw hex · `<select>` · `router.push` · 체크박스 · `dangerouslySetInnerHTML` · `title`)도 `source-rules.test.ts`로. 기계로 잴 수 없어 글로 남긴 것: SQL로 다시 쓴 커버 상태 사본, 관계 묶음 그래프 · 짝의 운명 · 편집 쓰기 길의 "한 함수로" 규칙(호출 경로를 정적으로 가릴 표지가 없다), DB로 가는 입력 칸의 `NoNulStr`(출력 스키마와 구별할 표지가 없다). `c-edit-model.numberDoc` ↔ `number_targets`는 입력이 스냅숏 전체라 사례로 뽑지 않았다.

### 스텝 3 — 검증 정비 · `test/smoke-split`

- **먼저** 다른 세션의 `fix/smoke-flaky`(워크트리 `sop-archivist-x4`)가 끝났는지 본다 — 겹치면 그 브랜치가 `dev`에 오른 뒤 시작한다.
- 12,638줄 `pw-smoke-sop.mjs`를 공용 도우미 + 화면별 파일로 나누고, 화면마다 제 시드를 써서 같은 DB를 거듭 쓰는 데서 오는 흔들림을 없앤다. `ONLY=` 사용법은 그대로 둔다.
- 남은 흔들리는 단계는 원인을 고친다. 기대값을 낮추거나 단계를 빼는 것은 사용자 승인을 받는다.
- **에이전트용 기능 맵** `docs/qa/feature-map.md`: 화면·기능마다 도달 방법, 조작 방법, 알려진 함정, 해당 스모크 영역. 앱이 원본이고 맵은 색인이다.

### 스텝 5 — 교정 사다리 · `docs/trust-direction` (이 브랜치)

- `.claude/commands/harden.md`, 루트 `CLAUDE.md` "신뢰 기반 먼저" 절, 이 계획.
