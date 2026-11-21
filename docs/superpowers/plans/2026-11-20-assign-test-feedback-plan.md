# Assign 시험 피드백 13가지 — 작업 명세 (2026-11-20)

사용자가 main v1.4.0을 실제 SOP로 시험하고 적어 준 개선점 13가지를, 코드로 확인하고 시안(HTML)으로 사용자와 정한 결과다. **이 파일 하나로 일할 수 있게 썼다** — 참고 문서 · 실사례 파일은 넘어오지 않는다. 시안 페이지(부록 A)는 계획 때 참고하는 그림일 뿐, 기준은 이 본문이다. (사용자가 OCR로 옮겨 준 글을 저장소에 그대로 남겼다 — 글자가 어색한 곳은 OCR 탓일 수 있다.)

- 코드 사실의 `file:line`은 **main v1.4.0** 기준이다. 줄 번호가 어긋나면 함수 · 상수 이름으로 찾는다. 경로 줄임: FE = `frontend/src/`, BE = `backend/app/`, UAP = FE `app/bundles/[id]/assign/use-assign-page.tsx`.
- "사용자 결정"은 사용자가 고른 것, "내 판단"은 이 문서를 쓴 세션이 정한 것(받는 세션이 근거를 갖고 바꿀 수 있다 — 바꾸면 PROGRESS에 까닭을 적는다).
- **진행 상황은 §4 표의 "상태" 열**에 적는다(브랜치를 `dev`에 합친 커밋에서).

---

## 0. 받는 세션에게

1. **`dev`에서 시작한다.** 브랜치는 §4 표의 이름으로 `dev`에서 딴다(한 브랜치 = 한 문장으로 말할 수 있는 일 하나). 끝나면 브랜치 전체 diff를 한 번 검토하고 `dev`에 합친다 — 작업(task)마다 검토를 띄우지 않는다(루트 `CLAUDE.md` "일 크기에 맞는 절차").
2. **작은 브랜치는 메인 세션이 직접**(B1–B4 · B7). 자료 구조 · API 계약 · Alembic을 건드리는 브랜치(B5 · B6 · B8 · B9 · B10 · B11 · B12 · B13)는 짧은 계획부터. 하위 에이전트를 쓰면 **모델을 지정하고**, 서버 · 브라우저를 띄우지 않게 적고, 고친 파일의 단위 시험 · lint · tsc까지만 맡긴다.
3. `dev`에 올릴 때마다 PATCH(`frontend/`에서 `npm version patch --no-git-tag-version`), `CHANGELOG.md` `## Unreleased (dev)`에 한 줄, `PROGRESS.md` 갱신, 화면 · 라벨이 바뀌면 `frontend/public/manual/user-manual.md` 해당 조각의 **글**(그림은 정식 업데이트 때), 화면 조작 · testid가 바뀌면 `docs/qa/feature-map.md`의 Assign 줄. 커밋 메시지 `type(scope): English — 한국어`.
4. 지킬 검사: en · ko 문구 한 쌍(`i18n-messages.test.ts`), 상호작용 요소에 `data-testid`, **effect · 타이머 예산**(`useEffect` · `setTimeout` · `requestAnimationFrame` 등은 `src/lib/use-*.ts` 공용 훅과 `frontend/effect-baseline.json`에 적힌 파일에만, 적힌 파일도 그 수를 넘지 못한다 — 예: `use-assign-page.tsx` effects 16 · timers 23, `components/ui/motion.tsx` effects 7 · timers 9. 늘리면 `src/source-rules.test.ts`가 실패하고, 기준선을 올리는 것은 사용자 승인. **새 타이머 · effect는 새 `src/lib/use-*.ts` 훅에**), "한 길" 규칙(raw hex · 기본 `<select>` · `router.push` · 기본 체크박스 · `title` 툴팁 금지), 서버 규칙 사본(`section-number` · `number-model` · `caption-slot-model`)은 `rule-cases.test.ts`가 대조 — 서버 규칙을 바꾸면 `scripts/dump_rule_cases.py`로 사례를 다시 뽑는다.
5. 원칙: AI는 제안만, 사람이 확정한다(AI가 꺼져도 사람 길은 돈다). AI 페이로드에 직원 실명 없음. 실제 SOP 원문 · 실서버 IP는 저장소에 넣지 않는다 — 시험 자료는 합성(파일 이름 `SYNTHETIC_`), §6에 실사례를 흉내 내는 구조를 적었다.
6. 워크트리 준비 · 서버 · DB 되돌리기는 `scripts/dev-worktree.sh`(`new <브랜치>` → 워크트리 안에서 `up`, 스모크를 다시 돌리기 전 `reset` — `docs/qa/verification-commands.md`). 커밋 전: `npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run`(frontend), `.venv/bin/python -m pytest tests/ -q -n auto` · `.venv/bin/ruff check app/ tests/`(backend). 스모크는 고친 화면만: `QUIET=1 ONLY="assign:" node scripts/pw-smoke-sop.mjs`. 공용 부품 · API 층을 고친 브랜치(B1 · B2 · B4를 뺀 전부 — B3은 공용 `useUnwrapMotion`, B7은 공용 판 · 훅, 나머지는 API · 자료)는 `dev`에 합치기 전 전체 스모크 + 감사 넷(`docs/qa/verification-commands.md`).

---

## 1. 배경

- SOP Archivist는 옛 SOP 묶음을 새 SOP · WI 구조로 다시 짜는 사내 웹 서비스다. **Assign** 화면(2단계)은 Old 원문 용지가 곧 목록이고 박스 하나가 Unit(문단)이다. 박스를 나누고 · 합치고 · 한/영 짝을 맺고 · 지우고, New 문서의 자리로 보낸다. 표는 "표 벗기기"로 칸 문장 줄로 풀 수 있고, 박스 앞 번호 칸에서 문단 번호를 고친다. <kbd>Space</kbd>를 누르는 동안 그 문서의 문단 Excel 미리보기(시트)가 아래에서 올라온다.
- 시험 문서 중 하나(사용자 PC의 실사례 DS SOP, 저장소에 없음)의 구조를 Python으로 읽었다:
  - "표 1. … · 표 2. … · 표 3. …"(영어 쪽 "Table 1–3")은 모두 **바깥 배치 표의 칸 안 문단**이고, **바로 다음에 안쪽 표**(7×2, 9×4, 3×2)가 같은 칸 안에 있다. 표 1 바로 앞에는 일반 문단 2개, 안쪽 표 뒤에는 빈 문단 하나.
  - 업무흐름도는 그림 파일이 아니라 **Word 도형 캔버스**다. 문서 전체: `wpc` 캔버스 28 · `wpg` 묶음 4 · `wps` 도형 262 · 글상자(`w:txbxContent`) 284 · `mc:AlternateContent` 36(VML 대체 갈래 포함). 흐름도 30개(한/영 각 15), 모두 "공정흐름도" 표 칸 안, 하나에 도형 5–27 · 글상자 3–14, 사진(`a:blip`) 없음. 글상자 글은 "공정 시작 · 7.1.1 장비 상태 확인 · 이상 있음? …" 같은 짧은 글.
  - 문서 꼴: 한글 절반 → 영어 절반(한/영 따로), 절 띠 표(번호 칸 + 제목 칸) 아래 작업 표, 작업 표 첫 행 안에 절 띠 표가 중첩.

---

## 2. 정한 것

| # | 항목 | 정한 것 |
|---|---|---|
| 1-a | 삭제 뒤 고름 | **바로 아래 박스**(같은 문서 · 같은 탭, 되감기 없음, 응답을 기다리는 사이 다른 박스를 골랐으면 그대로) |
| 2 | 삭제 줄 | 고른 동안만 펼침, 떠나면 접힘, 펼칠 때 · 접을 때 전환 |
| 3-a | 끌어 놓기 | **언어로 저절로**: 같은 언어 → 합치기, 한/영 → 짝(틈의 Join 단추와 같은 규칙) |
| 3-b | 이웃 아닌 같은 언어 | **놓지 못함 + 까닭 꼬리표** |
| 3-c | 언어 전환이 배정을 풀 때 | **바로 하고 알림의 되돌리기**(확인 창 없음) |
| 3+ | 사용자 덧붙임 | 짝은 멀리서도 맺을 수 있지만 합치기는 이웃만 → **멀리 맺은 짝이 언어 변경으로 같은 언어가 되면 짝만 푼다**(합치지 않음) |
| 4-a | 그림 "위치 보기" | 1단 보기에서는 짝 엿보기와 **같은 오른쪽 판** |
| 4-b | 2단 보기의 짝 안내 줄 | **지금처럼 바로 이동** |
| 4+ | 사용자 덧붙임 | 판 넓이 **1.3배**(460 → 600px), 그림 위치를 **더 직관적인 네모**로 표시 |
| 5-a | 삭제된 박스 우클릭 | **"삭제 취소"만**(배정 취소의 이름만 바꿈, "삭제" 항목 숨김) |
| 6-a | 박스 안 줄바꿈 | **띄어쓰기로 바꿈** |
| 6-b | 박스 첫머리 번호 꼴 | **저절로 번호 칸으로**(Number note 남김) + 사용자 덧붙임: **전환 효과**, 되돌릴 수 있어야, **번호뿐인 박스("6.1."만, 뒤가 빔)는 제외**, **이미 올린 묶음에도 적용** |
| 7-a | ◀ ▶ 함께 바뀌는 줄 | **아래로 같은 단계 · 같은 꼴이 이어지는 줄** |
| 7-b | 더 깊은 아래 줄 | **함께 움직임** |
| 7-c | 번호 줄 ◀ ▶ 뒤 아래 번호 | **지금처럼 "따라 고치기" 미리 보기** + 사용자 덧붙임: 입력 **폭 고정**(번호 길이에 따라 단추가 안 움직이게), **▶ 끝 = 위 번호보다 한 단계 깊게까지**(두 단계 이상 못 뜀) |
| 7-d | 문단 Excel 들여쓰기 | **Text 칸에 Excel 셀 들여쓰기 값** |
| 8-a | 캡션 지정 길 | **넷 다**: 줄을 표 머리에 끌어 놓기 · 줄 우클릭 → 캡션으로 → 표 n · 결정 칸 "줄을 눌러 고르기" · 직접 쓰기 |
| 8-b | 후보 거리 | **제한 없앰, 가까운 순 후보** |
| 9-a | Excel 삭제 표시 | 행을 지우지 않고 Remark "삭제"(사유 있으면 "삭제 — 사유") **+ 글자 취소선 · 회색**, 사용자 덧붙임: 삭제 행의 **Lang은 빈 칸** |
| 9-b | 숫자 섹션 아래 기호 줄 | Section No. **"5.1 •"**(그 줄의 기호) |
| 9-c | New 쪽에서 묶인 Old 줄 | **한 행으로 묶음** — 빈 템플릿 Join이든 이미 쓴 New 문장에 Old 줄들을 잇든 같게, 원문에서 이어진 줄만(사용자 확인) |
| 10 | Space 클릭 | 정할 것 없음 — 누른 박스의 행으로 늘 |
| 11-a | AI 순서 제안 보이기 | **그 자리 미리 보기**(줄마다 제안 순번) |
| 11-b | 제안 범위 | **순서만** |
| 12-a | 흐름도 | **(가) 간이 그림 + 그림 안 글** |
| 12-b | 그림 안 글 배정 | **아니오 — 그림째 배정** |
| 13-a | 참조로 찾은 상위 | **보이기 + 7.2 목록 · 검토에도**(직접 정한 상위처럼) |
| 13-b | 한 WI를 여러 SOP가 참조 | **모든 SOP 아래에 보임** |

---

## 3. 사용자 원문 (2026-11-20, 그대로)

> 문단박스 삭제하면 다른 문단박스가 포커싱되면서 스크롤이 크게 움직일때가 가끔 있음 (첫 문단으로 돌아가고그럼) - 아마 표 분해 후 문단 내용삭제하면 이런 상황이 발생하는 것으로보이는데 조사필요함 가끔은 그림으로도 넘어가고...
>
> 삭제된 반투명 문단 클릭하면 이전으로 돌아오는데(의도된기능) 포커싱 해제되면 다시 반투명으로 돌아갔으면 하고 돌아올때와 돌아갈때 전환 효과 넣을것
>
> 같은 문서 내 문단 드래그엔 드랍 > 현재는 짝만되는데.... 합치기도 작동되게 하고싶음, 그리고 짝일때 언어 바뀌면 자동으로 배정 풀고 합쳐지는걸로 전환 (반대의 경우에도 짝으로 전환)
>
> 그림의 위치보기 기능을 1열 보기에서 짝 1회 클릭하면 우측쪽에 짝 부분 랜더되게 하고 더블클릭하면 기존 기능처럼 그쪽으로 스크롤 이동하도록 수정
>
> 삭제는 배정취소로 취소되나 우클릭시 삭제 취소로도 직관적으로 취소 가능하게 (사실상 둘이 같은기능)
>
> 합친 문장에서 줄바꿈이 취소되는데 표를 분리한 문장 내에서 줄바꿈이 그대로 유지되는듯한데 한번 봐줘, 아니면 줄바꿈 제거하던가 줄바꿈이 되어 있으면 문단 번호 추출도 안되네
>
> 번호형식의 문단번호가 아닌 경우 들여쓰기 내어쓰기가 일부 수정되도록할까? 예를들어 1단에서 표를 해제하면 문단 내 점 이있으면 들여쓰기가 적용되는데 그러다가 또 점이 없는애가 나오면 자동으로 위의 들여쓰기를 택하게 되어있음 근데 이런 경우 문단을 내어써도 될듯함 (번호는 룰 지키고, 현재 번호식은 문단 들여쓰기 수준을 조정하기 어려운데 이것도 좌우 화살표 버튼으로 조절할 수 있으면 좋겠고 입력된 번호는 가장 가까운 위에 있는 숫자로 기준 잡아줘, 제목 5 아래에 있는 표 해제후 문단 입력가면 1로 입력되어 있음.. 이런경우엔 6이어야하고 오른쪽 화살표 누르면(왼쪽은 비활성화) 5.1 이 되는 느낌으로해줘
> 문단 기호 적용시 근처의 문단 들여쓰기 수준에 맞추고(위로 추적), 들여쓰기 내어쓰기 적용시 연속된 문단은 일괄로 변경 (두번 나눠 작업해서 Undo하면 그 문단만 남고 일괄 변경된것들만 취소)
>
> 표의 캡션 지정이 너무 제한적임 예를들어 (실사례 SOP) 이 문서의 표 1. (제목)이 캡션인데 시스템에 들어와서 작업하려니까 1행 1열값이 자동으로 지정되어 있고 수정이 어렵네.. 드래그하려니까 문장과 제목만 고칠 수 있다고 나오고.. 사용자 직관성이 좀 떨어지고 변수에 대응이 어려우니 수정 필요
>
> 스페이스 눌렀을때와 다운로드되는 엑셀은 문단 편집 내용을 반영하고 (삭제는 스페이스 누른 화면에서는 삭제(포커싱된상태만 해당줄 살리고 빨간 음영)
> 엑셀에서는 행 삭제하지말고 삭제라고 표기할것 (합치기도 실제로 한행으로하고.. 표 벗겨서 한경우 섹션넘버가 제대로 안들어가는 거 같은데 확인. 그리고 숫자 섹션넘버 하위에 점이나 그런 특수글머리가 있으면 연결해서 표시해줘
>
> 스페이스 눌러서 미리보기 보고있을때 남은 화면 영역으로 문단 클릭하면 해당 문단으로 스크롤해줘 (기능은 있는데 제대로 작동이 안되는듯함 되다 안되다...?)
>
> 표 벗기기 이후 스크롤 위치 신경써주고 불편하지않게, 다시 표로 버튼 옆에 AI 에게 순서 제안받기 해서 제안 받을 수 있게하면 기능 추가
>
> (같은 실사례 SOP) 이 문서에.. 업무흐름도가있고 도형안에 있는 글씨가 문단으로 나왔는데.. 별도 처리가 가능할까 먼가 좀.. 그림로 봐야할 것 같아서
>
> + 문서 업로드시 SOP와 WI를 동시에 업로드하려고 하는데 SOP와 WI의 의존성이 반드시 필요하진 않아보여서 그냥 독립적으로 할 수 있을까? 어짜피 문서 내에 레퍼런스로 달리긴 하니까 문서 작업 해서 레퍼런스 항 중에 그 문서가 있으면 표현만 자식처럼 표시하면 될듯한데?

시안을 본 뒤 덧붙인 말:

> 3번은 짝은 원거리 매칭이 가능한데 합치기는 안되니까 짝 원거리 매칭후 언어 변경시 풀리는 것도 감안할것
> 4번의 오른쪽 판 (그림의 왼쪽판) 은 넓이를 지금 보다 좀더 넓게 해줘 1.3배정도? 그리고 그림 왼쪽판의 그림위치는 지금보다 좀더 직관적인 네모모양으로 위치를 표시해줘
> 6-b의 저절로 번호 칸으로는 좋고 전환효과 넣을것 다시 돌리기는 할 수 있지?(현재처럼? 그냥 현재 첫작업을 자동으로 인식한걸로 이해했고 간혹 인식이 6.1. 만 문장으로 인식되서 뒤에 문장이랑 합친 후 번호따야될텐데 이렇게 그것만 남고 뒷 내용은 공백인 경우는 자동 인식 제외)
> 7-c 는 번호에 따라 버튼 위치 바뀌지 않게 폭 고정하고 직전 번호를 2단계 이상뛸수 없게 우측끝 설정필요해보이는데...
> 9-c 는 기 작성한 뉴문서는 해당 올드문서랑 똑같게 적용인거지?
> 한가지더 내려받은 엑셀 삭제행 > Lang은 의미없는 값 아닐까? 빈값으로 넣어도될듯

---

## 4. 작업 차례

버그부터, 기대는 것은 뒤로. 각 줄이 브랜치 하나다(`dev`에서 따고 `dev`에 합침). "앞선 것"이 `dev`에 오른 뒤 시작한다.

| 차례 | 브랜치 | 항목 | 크기 · 닿는 곳 | 앞선 것 | 상태 |
|---|---|---|---|---|---|
| B1 | `fix/assign-delete-focus` | 1 | 작음 · FE | — | 됨 v1.4.1 |
| B2 | `fix/space-preview-follow` | 10 | 작음 · FE + BE 한 곳 | — | 됨 v1.4.2 |
| B3 | `fix/unwrap-scroll` | 11 스크롤 | 작음 · FE | — | 됨 v1.4.3 |
| B4 | `feat/deleted-fold-restore` | 2 · 5 | 작음 · FE | B1 | 됨 v1.4.4 |
| B5 | `fix/unit-text-linebreaks` | 6 | 중간 · BE(+ 데이터 고침) + FE 전환 | — | 됨 v1.4.5 |
| B6 | `feat/assign-drop-join` → `feat/pair-undo` → `feat/lang-shape-switch`(차례로 셋) | 3 | 중간 · FE + BE 편집(모양 전환 한 편집) | B5 | B6-1 끌어 합치기 됨 v1.4.6 · B6-2 짝 되돌리기 됨 v1.4.7 · B6-3 언어 → 모양 전환 됨 v1.4.8 |
| B7 | `feat/pair-peek` | 4 | 중간 · FE | — | 됨 v1.4.9 |
| B8 | `feat/number-levels` | 7 | 큼 · BE(열 · Alembic · 편집 op) + FE | B5 | 됨 v1.4.10 |
| B9 | `feat/paragraph-sheet-edits` | 9 | 중간 · BE 시트 + FE 시트 보기 | B5 · B8 | 됨 v1.4.11 |
| B10 | `feat/caption-extract` → `feat/caption-any-line` → `feat/caption-pick-paths`(차례로 셋) | 8 | 큼 · BE(추출기 · 편집 규칙) + FE | — | B10-1 칸 안 캡션 · 읽기 넓히기 됨 v1.4.13(추출기 8) · B10-2 규칙 넓히기 됨 v1.4.14 · B10-3 지정 길 넷 됨 v1.4.15 |
| B11 | `feat/ai-unwrap-order` | 11 AI | 큼 · BE AI 작업(Alembic) + FE | B3 | |
| B12 | `feat/flowchart-figure` | 12 | 큼 · BE 추출기 · 그림 그리기(+ 저장) | — | |
| B13 | `feat/wi-parent-optional` | 13 | 중간 · BE To-Be · 결과물 + FE 올리기 창 · Documents | — | |

추출기를 바꾸는 브랜치(B10 · B12, B5에서 추출기 쪽을 고르면 B5도)는 같은 `EXTRACTOR_VERSION`(BE `sop/extract/types.py:14`, 지금 `"7"`)을 올린다 — 먼저 `dev`에 합친 쪽이 다음 번호를 가진다. 이미 올린 문서는 다시 올려야 새 추출이 적용된다(설명서에 적는다).

---

## 5. 브랜치별 명세

### B1 · `fix/assign-delete-focus` — 삭제 뒤 고름이 튀지 않게 (항목 1)

**지금**
- 삭제(메뉴 · <kbd>Del</kbd>, UAP:1644 · 3309) → `decideNow`(UAP:1881-1886) → `runSave` → `sendSave`. 저장 뒤 `shouldAdvanceAfterSave`가 참이면 `next = findNextOpen(listKeys, rowMap, row.key)`(UAP:1851) → `selectRow(next)`(UAP:1857, **조건 없이**) → `scrollToUnit` → `revealFarElement`의 `scrollIntoView({block:"center"})`(UAP:199-224).
- `findNextOpen`(FE `lib/classify-model.ts:714-718`): 지금 줄 **뒤**에서 첫 미확정, 없으면 **앞에서**(되감기). 지금 줄이 목록에 없으면(index −1) **처음부터**. 그림 거르기 없음(J/K는 `isFigureWalk` UAP:1094-1097로 거른다).
- `listKeys`(UAP:379-382)는 `snapshot` — 처음 불러올 때(UAP:385-388), 거르기를 걸 때(`applyFilter` UAP:395), 짝을 풀 때(`applyPairSettle` UAP:1773), 저장 아닌 편집의 follow를 소비할 때(UAP:470-475, 이때는 모든 줄로 다시 찍음) 찍는다. follow는 응답이 따라갈 Unit(`pickUnitId`)을 주고 **고름이 누른 때 그대로일 때만** 생긴다(FE `lib/assign-focus-model.ts:95`). 표 벗기기는 `created_unit_ids[0] ?? null`(UAP:1369, 1388-1390)을 넘기는데, 서버는 풀린 캡션 · 숫자 칸을 붙인 줄 · 안쪽 띠 표 제목 줄을 만들 때만 새 Unit이 생긴다(BE `sop/editing.py:1145-1147` `_plan_band_layout`, 1170-1182). 그래서 **번호 칸 · 캡션 · 안쪽 띠 표가 없는 표를 벗겼거나, 응답 전에 다른 박스를 눌렀으면** 벗긴 칸 줄 `u<cellId>`(classify-model:69)가 목록에 없다 → 그 줄을 지우면 index −1이라 **묶음 맨 처음 미확정 줄**(다른 Old 문서일 수도, UAP:600)로 간다.
- 실사례처럼 작업 표 안에 띠 표가 든 표에서는 목록이 다시 찍혔을 수 있다 — 그때 "첫 문단으로" 가는 까닭은 **되감기**다: 지운 줄 아래가 모두 확정(또는 삭제)이면 `findNextOpen`이 앞에서 찾아 묶음 첫 미확정 줄로 간다. 다음 줄이 그림이면 그림 탭으로 넘어가 스크롤한다(UAP:667-668, FE `lib/paper-model.ts:676`).
- 짝 나눔 갈래만 `focusCtl.succeed`(UAP:1856)로 "고름이 누른 때 그대로일 때만 따라가기"를 지킨다.
- **재현부터**: 합성 표 둘(번호 칸 · 띠 표 없는 표 / 숫자 칸 + 안쪽 띠 표가 든 표)로 ① 벗긴 줄 삭제, ② 아래가 모두 확정인 줄 삭제, ③ 응답 전에 다른 박스 누르기, ④ 그림 바로 앞 줄 삭제를 시험으로 먼저 쓴다.
- 덤: 같은 까닭으로 표를 벗긴 뒤 J/K(`moveRow` UAP:1087-1092)가 벗긴 줄을 건너뛴다. 삭제 박스가 접힌 줄로 바뀌는 건 다시 받은 뒤(FE `lib/deleted-fold-model.ts:50-74`)라 새로 고른 박스 위가 한 번 밀린다.

**바꿀 것**
1. **삭제로 확정한 뒤**의 다음 고름 = 지운 박스의 **문서 차례 바로 아래 박스**(확정 여부와 상관없이), 같은 Old 문서 · 같은 탭(본문이면 그림 줄 건너뜀, 그림 탭이면 그림만), 아래가 없으면 바로 위, 그것도 없으면 그대로. 되감기 없음. 다른 확정(<kbd>Enter</kbd> 등)의 "다음 미확정 줄"은 그대로 두되 **같은 문서 안 · 되감기 없음 · 그림 거르기**만 더한다.
2. 고름 이동은 `focusCtl.succeed(job, { docId, revision: null, pickUnitId })` 길로 — 응답을 기다리는 사이 사람이 다른 박스를 골랐으면 옮기지 않는다.
3. 줄 목록: 거르기가 "all"이면 `rows`를 그대로 쓰거나, `rows`에 snapshot에 없는 키가 생기면 그 자리(문서 차례)에 끼워 다시 찍는다. J/K도 이 목록을 쓰므로 함께 고쳐진다.
4. 지금 줄이 목록에 없을 때(index −1) 처음부터 찾지 말고 문서 차례 위치로 대체한다(`stepInList`와 같은 방식).

**시험**: `classify-model.test.ts`(또는 새 순수 모델)에 — 목록에 없는 줄에서 다음 줄, 그림 건너뛰기, 문서 경계에서 멈춤, 되감기 없음, 삭제 뒤 "바로 아래"(확정된 줄이어도). 고름 따라가기는 `assign-focus-model` 시험에 "그 사이 다른 박스를 고름 → 안 옮김".
**확인**: 합성 묶음에서 표 벗기기 → 벗긴 줄 <kbd>Del</kbd> → 바로 아래 박스가 골라지고 화면이 그대로. 그림 바로 앞 줄 삭제 → 탭이 안 바뀜. `ONLY="assign:"` 스모크.

### B2 · `fix/space-preview-follow` — Space 미리보기가 누른 박스의 행으로 늘 (항목 10)

**지금**: 박스 누름 `handleOldClick` → `selectRow(key,false)`(UAP:3197). `page.tsx:473`이 `unitIds = row.unitIds`를 넘기고 FE `components/assign/space-preview.tsx:95-106`이 `findSheetUnit` · `selectedUnitId`를 정한다 → FE `components/outputs/sheet-view.tsx:179-181`의 effect(`[selectedUnitId, sheet]`)가 `centrePicked`(FE `lib/sheet-pan.ts:75-79`)로 `tr[data-mark="picked"]`를 CSS transform으로 가운데 옮긴다(스크롤이 아니다). 고른 행이 500행 창 밖이면 `around = unitIds[0]`로 다시 받는다(space-preview.tsx:97-102, 서버 창 BE `sop/sheet_model.py:600-612`).

**되다 안 되다의 까닭 넷**: (a) 같은 박스 · 짝의 다른 박스를 다시 누르면 `selectedUnitId`가 같아 effect가 안 돈다(시트를 끌어 둔 뒤면 그대로). (b) 줄의 **첫** Unit을 찾는다 — 한/영 따로 문서에서 EN 박스를 눌러도 멀리 있는 KO 행으로. (c) 문단 시트는 본문만(BE `sop/paragraph_excel.py:88`) — 머리말 · 꼬리말 · 목차 덩이는 행이 없다. 서버가 `around` Unit을 못 찾으면 0번 창으로(sheet_model.py:609) 가서 맨 위가 보이고 끌기 값은 남는다. (d) `reloadKey`가 저장마다 바뀌어 시트를 다시 받는다 — 그 사이 누른 것을 놓친다.

**바꿀 것**: 누른 박스의 Unit(`pickedId`)을 `unitIds` 맨 앞에. 고름 차례 번호(누를 때마다 +1)를 가운데 맞추기 effect의 의존값에 더해 다시 눌러도 다시 가운데로(effect 수가 늘면 안 된다 — 기존 effect의 deps만 바꾼다). 시트에 없는 Unit이면 문서 차례로 가장 가까운 **위** 본문 행으로(그 행에 옅은 "가까운 행" 표시는 내 판단, 생략 가능). 다시 받는 중에 누른 것은 받은 뒤 그 값으로 다시 맞춘다. 서버 `limit_window`는 못 찾은 `around`를 0이 아니라 "가장 가까운 앞 Unit"으로(가능하면) — 안 되면 프런트가 가까운 본문 행 id를 `around`로 보낸다.
**시험**: `sheet-view-model` · space-preview 순수 부분(누른 Unit 고르기, 본문 밖 → 가까운 위 행), 서버 `limit_window` 시험. **확인**: 한/영 따로 합성 문서에서 EN 박스 누름 → EN 행, 같은 박스 두 번 누름(사이에 시트를 끌어 둠) → 다시 가운데.

### B3 · `fix/unwrap-scroll` — 표 벗긴 뒤 보던 자리 지키기 (항목 11 앞부분)

**지금**: `unwrapTable` → `runUnitEdit` → `sendUnitEdit`: `succeed(created_unit_ids[0])`(UAP:1369) → 새 보기 → `unwrapMotion.run`(UAP:1373-1384). `useUnwrapMotion`(FE `components/ui/motion.tsx:213-271`, 걷기 → 펼치기 → 붙이기)은 스크롤을 저장 · 복원하지 않고 브라우저 스크롤 고정에 맡긴다 — 고정 요소가 바뀌는 표 안이면 놓친다. 덩어리 용지(`styles/components.css:1296`, 40장씩 `content-visibility`)라 더 약하다(`docs/lessons/ui-review.md` §15에 같은 기록). 그 사이 follow 스크롤까지 걸린다: 렌더 중 `load` → `scrollToUnit`(UAP:476) → 다음 프레임 `revealFarElement`가 슬라이드 transform이 걸린 span(paper.tsx:634, 1129)을 재서 이전 위치를 읽고, 먼 경우 최대 10프레임 다시 스크롤한다. 따라가는 박스는 풀린 캡션 → 첫 숫자 붙인 줄(editing.py:1172-1182), 띠 표는 첫 제목 줄 — 보던 곳과 떨어져 있을 수 있다.

**바꿀 것**: `run` 시작 전에 화면 안 기준 요소(벗기는 표의 머리 줄 — 없으면 화면 맨 위에 걸친 줄)와 `.pane-body` 안 그 요소의 높이(offset)를 적고, 바뀐 DOM이 그려진 직후(`run`의 "바꿈" 단계 안) 같은 요소의 높이가 같도록 `scrollTop`을 되맞춘다. 표 벗기기 · 다시 표로(`set_layout_table`) 뒤의 follow 스크롤은 하지 않는다 — 따라갈 박스가 화면 밖일 때만, 전환이 끝난 뒤 한 번. 움직임 줄이기 설정이면 전환 없이 바로 바꾸고 자리만 맞춘다. 이 처리는 `useUnwrapMotion` 안(공용)에 둔다 — 화면마다 새로 짜지 않는다.
**시험**: `lib/unwrap-motion.ts`의 순수 계산(기준 요소 · 높이 차이 → 새 scrollTop). **확인**: 긴 합성 문서 가운데의 표를 벗김 · 다시 표로 — 표 머리가 화면의 같은 높이에 남는다. `ONLY="assign:"`.

### B4 · `feat/deleted-fold-restore` — 삭제 줄 다시 접기 · 우클릭 "삭제 취소" (항목 2 · 5)

**지금**
- 접힌 줄(`assign-paper-deleted-u<id>`, `.deleted-line` — 점선 · 흐린 바탕 · "DELETED" 꼬리표 · 한 줄 말줄임)을 누르면 `page.tsx:195-197`의 `deletedOpen`(Set)에 넣고(page.tsx:574) **빼는 곳이 없다**. `buildDeletedFolds`가 그 키를 건너뛰고(deleted-fold-model.ts:54), `readDeletedLine`은 고른 박스의 줄을 이미 펼쳐 둔다(:72). 줄 ↔ 박스는 전환 없이 바꿔 그린다(FE `components/paper/paper.tsx:1405-1406`, 줄 그리기 1311-1335).
- 접기 부품: `Collapse` · `usePresence`(motion.tsx:278-309, grid 0fr→1fr, 약 260ms, `styles/motion.css:48-54`) — 목차 본문(paper.tsx:1263) · 줄 단추(:774)가 쓴다.
- 삭제를 푸는 것은 **배정 취소**와 같은 동작: `runClear`(UAP:1909-1934) → `clearDecisions`. 메뉴 항목 `clear`, 문구 `classify.clear` "Unassign"/"배정 취소"(FE `lib/i18n-messages.ts:1417` · 3385), 단축키 <kbd>U</kbd>, 연결 UAP:1643. 결정 칸 단추 `assign-clear`(FE `app/bundles/[id]/assign/assign-side-panel.tsx:514-516`).
- 메뉴 모델 `buildAssignMenu`(FE `lib/assign-context-menu-model.ts:184-215`)는 박스 상태와 상관없이 배정 무리 `[clear, move, delete]`. 문맥(`buildUnitMenu` UAP:1186-1201)은 `rowStatus` · `isDecided`만 안다. `AssignMenuItem.labelKey`는 있다(FE `components/assign/assign-context-menu.tsx:107`). 아이콘 · 문구 · 단축키 맵(:17-66)은 lang 빼고 모든 동작을 요구하는 타입.
- 삭제 판정 = confirmed + disposition `delete`(`isDeletedUnit`, deleted-fold-model.ts:41-43, export 안 됨).
- **접힌 줄은 우클릭이 안 먹는다**: `handleContextMenu`(paper.tsx:1602-1614)가 `[data-strip-unit]` · `.su[data-unit]`을 찾는데 `.deleted-line` 단추(paper.tsx:1319-1333)엔 없다. `openCtxMenu`는 `assign-paper-piece-<id>`/`-unit-<id>`를 닻으로 쓴다(UAP:1284-1285). 메뉴를 열면 그 줄이 골라져 펼쳐지므로 닻 요소가 바뀐다.

**바꿀 것**
1. 펼침 = **지금 골라져 있음** 하나로. `deletedOpen`을 없애고 `selectedId`만 본다(Shift 클릭은 고름을 안 바꾸니 펼치지 않는다 — 괜찮다). 다른 박스를 고르면 저절로 접힌다.
2. 줄 ↔ 박스 바꿈을 `Collapse`로: 줄은 `open={!expanded}`, 박스는 `open={expanded}` + `appear`(높이 + 흐려짐 약 260ms). 움직임 줄이기면 바로. 펼친 삭제 박스는 옅은 위험 색 바탕(토큰, 예 `color-mix(var(--danger-fill) …)`)과 "삭제" 꼬리표로 삭제 상태를 계속 알린다(내 판단).
3. 우클릭: 접힌 줄에 `data-strip-unit` 붙이기, 닻 대체 `assign-paper-deleted-u<id>`, 펼친 뒤 닻을 다시 찾아 메뉴 위치를 맞춘다.
4. 메뉴 문맥에 `isDeleted`(`isDeletedUnit` export). 삭제된 박스면 배정 무리 맨 위 항목을 `clear` 그대로 + `labelKey: "assign.ctx.undoDelete"`("Undo delete" / "삭제 취소", 단축키 <kbd>U</kbd> 그대로), **"삭제" 항목은 숨김**. 결정 칸의 `assign-clear` 단추도 삭제된 박스에서는 같은 문구(내 판단).

**주의**: 260ms 동안 `assign-paper-deleted-u<id>`와 `assign-paper-piece-<id>`가 함께 있다 — 스모크가 둘 중 하나가 사라지기를 기다려야 할 수 있다. 틈 계산(`isDeletedRow` paper.tsx:1302-1307)은 바로 바뀐다. 먼 덩어리는 memo지만 앞 고름을 쥔 덩어리는 다시 그려진다(paper.tsx:336-337, 459).
**시험**: `deleted-fold-model.test.ts`(고름 기준 펼침), `assign-context-menu-model.test.ts`(삭제 박스 → undoDelete · delete 없음). **문구**: `assign.ctx.undoDelete` en/ko. **설명서**: Assign의 삭제 조각. **기능 맵**: 삭제 줄 설명("그 줄을 누르거나 J/K로 골라 펼친 뒤" → 고른 동안만 펼침).

### B5 · `fix/unit-text-linebreaks` — 박스 안 줄바꿈 없애기 · 첫머리 번호 저절로 (항목 6)

**지금**
- Unit 글 `build_unit_text`(BE `sop/segment.py:525-534`): 같은 블록 범위는 `" "`, 다른 블록은 `"\n"`으로 잇는다. `Unit.text`는 저장되는 열이다(BE `sop/models.py:349`), 만드는 곳 `units.py:186` · `editing.py:510` · `editing.py:1310`.
- Old 합치기 `join_close_spans`(BE `sop/spans.py:46-56`)는 같은 블록 범위를 원문 `"\n"`을 품은 한 범위로 잇는다. New 쪽(빈 템플릿) Join `buildComposedMerge`(FE `lib/composed-ops-model.ts:81`)는 `${upper.trim()} ${lower.trim()}` — 그래서 사용자 눈에 둘이 달랐다.
- 표 칸 = 블록 하나, 칸 안 여러 문단은 `"\n"`으로(BE `sop/extract/docx_reader.py:1121-1141`), Shift+Enter(`w:br`)도 `"\n"`(:795-799). DOCX는 Unit을 `"\n"`에서 나누고(`split_lines` BE `sop/units.py:178`, segment.py:420) PDF는 안 나눈다. 표 벗기기는 새 문장을 만들지 않고 올릴 때 만든 칸 문장의 묶음만 푼다(`_plan_plain_layout` editing.py:1158-1194). 숫자만 든 칸을 옆 칸과 붙인 줄은 두 블록이라 `"7\n내용"`(editing.py:1173-1179).
- 번호 찾기는 Unit 글을 다시 읽지 않는다: 추출기 `_find_number`(docx_reader.py:1188-1199, 정규식 :96)가 **원문 문단마다 맨 앞 한 번** 표지를 달고, `read_number_range`(BE `sop/numbering.py:50-75`)는 그 표지가 Unit **첫 범위의 시작**에 있고 **뒤에 내용이 남을 때만** 번호로 본다(번호 칸 `NUMBER_CELL`은 첫 범위가 그 칸 전체이고 뒤 범위가 있을 때). `build_number_columns`(:78-85)가 Unit을 만들 때 · 편집할 때(editing.py:512) `number_read` · `number_source`를 채운다.
- 번호 값 `get_number`(numbering.py:136-140, **읽을 때 셈하는 값**): `number_set`(사람 값, `""` = 번호 없음)이 먼저, 없으면 `number_read` — 단 타자 번호면 글: **본문 줄의 타자 번호는 사람이 ↤(번호로)를 누르기 전에는 글**(사용자 결정 2026-11-18). 이 규칙은 **세 곳**에 있다: `_is_typed_text`(numbering.py:143-149), `read_draft_number`(numbering.py:119-125 — units.py:198 · editing.py:866에서 쓰고 `find_inherited_numbers`의 입력), 문서 보기의 `typed_len`(BE `routers/sop_documents.py:847` — 프런트 `number-cell.tsx`의 "↤ 번호로" 단추가 이 값으로 뜬다). 이번 6-b가 이 결정을 바꾼다(사용자 결정 2026-11-20) — **세 곳을 함께** 고친다.

**바꿀 것**
1. **줄바꿈 → 띄어쓰기(6-a)**: `build_unit_text`가 블록 사이를 `" "`로 잇고, 범위 안의 `"\n"`도 `" "`로 바꾼다. **길이가 같으니 범위 · 글 안 좌표(나눌 선, 번호 범위, 그림 자리)는 안 바뀐다.** 용지는 블록 글로 그리므로, 한 Unit 범위 안의 `"\n"`을 띄어쓰기로 보이게 그리기도 고친다(Paper의 조각 글 그리기 — `white-space` 처리 또는 글 바꿈). 이미 있는 Unit은 Alembic 데이터 리비전 하나로 `units.text`의 `"\n"`(그리고 `"\r"`)을 `" "`로(sqlite · postgres 둘 다 되는 `replace(text, char(10), ' ')` / `chr(10)` — 방언마다 맞춘다). 임베딩 캐시는 글이 바뀌어 다시 계산될 수 있다 — 괜찮다.
2. **첫머리 번호 저절로(6-b)**:
   - "본문 줄 타자 번호는 글" 규칙을 세 곳(`_is_typed_text` · `read_draft_number` · `typed_len`)에서 함께 거둔다 → 본문 줄도 첫머리 타자 번호가 바로 번호 칸. "↤ 번호로" 단추는 쓸 일이 없어지니 걷거나(문구 · 설명서 · testid 함께) 남는 경우만 남긴다. **이미 올린 묶음에도 적용한다**(사용자 결정 2026-11-20) — `get_number`가 저장된 열(`number_read` · `number_source` · `number_set`)로 읽을 때 셈하므로, 규칙을 거두면 기존 묶음의 본문 타자 번호(확정한 줄 포함)도 곧바로 번호 칸이 된다(데이터 리비전 없음). 글 앞 숨김 · Section No. · 결과물 A의 그 줄 표시가 바뀐다. 같은 열로 늘 같은 값을 내므로 화면을 나갔다 들어와도 다시 할 일은 없고, 사람이 "없음"으로 되돌린 줄은 `number_set=""`로 남아 다시 잡히지 않는다(사용자가 물어 확인한 점 — 시험으로 고정). 이미 확정해 만든 New 문장 글이 저장값이라 그대로인지, Old 글에서 다시 셈해 번호가 빠지는지는 받는 세션이 확인해 PROGRESS에 적는다. Number note는 지금 규칙("Source …")대로 — 사람이 고치지 않았으면 note 없음이 지금 동작이니, **저절로 잡은 번호임을 남기는 note**(예 `Read from text`)를 더할지 받는 세션이 정한다(사용자는 "Number note 남김"을 골랐다 → 남기는 쪽으로).
   - 번호 꼴이 첫 범위 **전체**이고 뒤에 다른 범위가 있을 때도 번호로(지금은 `NUMBER_CELL`만) — "6.1."만 있던 박스를 다음 줄과 합치면 그 합친 박스의 번호가 된다.
   - **번호뿐인 박스는 제외**: 뒤 내용이 비면(공백만) 번호로 보지 않는다(지금 규칙 그대로, `read_number_range`의 `number_end < end`).
   - 줄바꿈 뒤 줄(Shift+Enter로 Unit이 나뉜 줄)은 원문 문단 맨 앞이 아니라 표지가 없다 → 추출기가 문단 안 `"\n"` 뒤 줄머리에서도 `_find_number`를 돌린다(이 브랜치에서 하면 `EXTRACTOR_VERSION`을 올린다 — B10 · B12와 차례 맞추기). 또는 `build_number_columns`가 표지 없는 첫 범위의 글 머리를 같은 정규식으로 읽는 대체 — 받는 세션이 고른다(대체 쪽은 다시 올리지 않아도 편집할 때부터 적용된다는 이점).
   - 숫자처럼 시작하는 문장("3개월마다 …")이 잡히지 않게 지금 추출기 정규식(번호 뒤 띄어쓰기 · 마침표 꼴)을 그대로 쓴다.
3. **되돌리기**: 번호 칸 **없음**을 누르면 `number_set = ""`로 기억되어 다시 저절로 잡히지 않는다(지금 구조 그대로 — 시험으로 고정). 합치기 · 표 벗기기 같은 편집 안에서 잡힌 번호는 그 편집과 한 되돌리기 칸이다.
4. **전환**: 편집 응답 뒤 번호 칸이 새로 생긴 박스는 글 앞 번호가 왼쪽으로 빠지며 번호 칸이 옅은 강조로 나타나는 짧은 전환(약 0.3초, 움직임 줄이기면 바로). 바뀌기 전 · 뒤 보기를 견줘 "번호가 새로 생긴 Unit"을 고르는 순수 함수(`src/lib/`) + **새 훅 `src/lib/use-*.ts`**(예 `use-number-arrival.ts`) — `motion.tsx` · `use-assign-page.tsx`는 effect 예산이 차 있어 더하지 않는다. CSS 키프레임만으로 되면 effect 없이(새로 생긴 번호 칸에 `data-arrived` 속성 → 애니메이션)가 가장 싸다.
5. 빈 템플릿 New Join(composed-ops-model.ts:81)은 이미 띄어쓰기라 그대로.

**시험**: `test_sop_segment*.py`(build_unit_text), 번호 시험(본문 타자 번호 → 번호, 번호뿐 제외, 합친 두 블록의 번호, 없음 기억), 데이터 리비전(시드한 `"\n"` 글 → 바뀜, 길이 같음), `rule-cases.json`을 다시 뽑아 프런트 사본 대조. **확인**: 합성 표("7" 칸 + 내용 칸, 칸 안 Shift+Enter 줄)를 벗김 → 줄바꿈 없음 · 번호 칸 7, "6.1." 박스 + 다음 줄 Join → 번호 칸 6.1 전환, Ctrl+Z → 둘 다 되돌아감. 문단 Excel 한 칸에 두 줄이 없다. **설명서**: 번호 칸 조각(타자 번호가 이제 저절로 번호가 됨, 없음으로 되돌림).

### B6 · `feat/assign-drop-join` — 끌어 놓기로 합치기, 언어 바뀌면 모양 전환 (항목 3)

**지금**
- 끌기는 짝만: `onMove` → `readPairAt`(UAP:2840-2842), `onDrop` → `runPairDrop`(UAP:2864-2869). `readPairAt`은 한/영 문서(`ko_en_interleaved` · `ko_en_separate`)에서만(UAP:2912-2922) — 한 언어 문서에서는 놓아도 아무 일 없다. 규칙 `resolvePairDrop`(FE `lib/pair-drop-model.ts:54-85`): 같은 언어 `same_lang` 거절(:72), 짝 카드째 끌기 거절(:61-65), 배정 · 미저장 거절(:78-81), 제안 짝이면 확정(:83).
- `runPairDrop`(UAP:3068-3091) → `createPair` / `confirmPair`. 되돌리기는 알림 단추뿐 `undoPairDrop` → `deletePair`(UAP:3097-3119). **짝은 되돌리기 줄(undo stack)에 없다**(BE editing.py:1835).
- 합치기 길은 이미 있다: 틈 Join `planOldJoin` / `joinOld`(UAP:1704-1713), 메뉴 `merge_prev/next`(:1664-1668) · `pair_*`(:1669-1672) — 모두 `planJoin`(FE `lib/split-menu-model.ts:28-43`): 같은 언어 → 합치기(이웃 + `getMergeBlocker` FE `lib/paper-model.ts:394-401`), 한/영 → 짝. 합치기 op `{type:"merge", unit_ids}` → `runUnitEdit`, 되돌리기 한 칸. 배정된 Unit은 서버 409 `confirm_required` → 화면이 묻고 다시 보낸다(editing.py:1940-1943).
- 서버 짝 `create_pair`(BE `sop/pairs.py:49-97`): 글 Unit만, KO · EN 둘 다, 한쪽 최대 3(`MAX_PAIR_SIDE`), 이미 짝이면 409 `unit_already_paired`, 간 곳이 다르면 409 `pair_fates_differ`, 같은 문서, **이웃 규칙 없음**(멀리서 맺을 수 있다). 서버 합치기 `_plan_merge`(editing.py:580-596): 글 Unit만, 목차 줄 잠김, 칸 문장 · 캡션은 같은 묶음 · 종류만(`_ensure_mergeable` :529-534), 이웃 검사는 **화면만**. 합친 언어 = 공통 언어, 다르면 글에서 감지.
- 언어는 Unit마다: `SetLanguageOp`(editing.py:165-168, 700-706), 메뉴 · 모양 도구(UAP:1691-1692). 배정된 Unit의 언어 바꾸기는 409 `unit_has_decision`(editing.py:1923-1932). 언어를 바꾸면 `_leave_pairs`(editing.py:1832-1857, 호출 :1961)가 그 Unit을 짝에서 빼고 한쪽이 비면 짝을 지운다 — **되돌려도 짝은 안 돌아온다.**
- 반대(합친 박스 → 짝): "한 문장 | 한/영 짝" `switchToPair`(UAP:1494-1538) = unmerge → set_language → createPair(되돌리기 2-3칸, 짝 부분은 못 되돌림), `can_unmerge` + 한글 · 로마자가 섞였을 때만(`planShapeMode` FE `lib/assign-context-menu-model.ts:300-309`).

**바꿀 것**
1. **놓기 규칙(3-a · 3-b)**: 같은 문서 박스 위에 놓으면 `planJoin`과 같은 규칙 — 같은 언어 → **합치기**(이웃일 때만, `getMergeBlocker` 통과), 한/영 → **짝**(지금 규칙 그대로, 멀리서도). 이웃이 아닌 같은 언어 → 놓지 못함 + 꼬리표 "이웃한 박스만 합칠 수 있어요"(새 문구). 한 언어 문서에서도 합치기는 된다(`readPairAt`의 문서 꼴 제한을 짝에만). 끄는 동안 대상 박스 꼬리표 **합치기** / **짝** / 거절 까닭(`DragHover` box-drag.ts:26). 합치기는 `runUnitEdit` merge 길(되돌리기 한 칸), 배정된 박스면 틈 Join과 같은 확인 흐름(내 판단 — 3-c는 아래 언어 전환에만).
2. **짝 맺기 · 풀기도 되돌리기 줄에**: 끌어 놓기뿐 아니라 짝을 맺고 푸는 모든 길(메뉴 `pair_pick` · 틈 Join(짝) · Pair view 끌기 · 제안 짝 확정 · 아래 언어 전환)을 <kbd>Ctrl</kbd>+<kbd>Z</kbd>로 되돌린다(내 판단 — 길마다 다르면 헷갈린다). 알림의 되돌리기도 같은 길. 참고: 판단 스냅숏 엔진 `decision_steps.dump_bundle_state`는 이미 `unit_pairs` · `unit_pair_members` · `unit_decisions`를 찍는다(BE `sop/decision_steps.py:217-226`). 반면 `kind="unit_edit"` 단계의 되돌리기(`_move_unit_edit` :564-587)는 `undo_edit`만 불러 **풀린 배정을 되살리지 않는다** — 짝 · 배정이 함께 바뀌는 편집은 짝 · 결정까지 되살리는 단계 종류로 기록한다(방법은 받는 세션이 고름).
3. **언어 전환 → 모양 전환(서버 편집 하나, 되돌리기 한 칸)**: `set_language`(또는 새 op)가 서버에서 —
   - 짝의 한 구성원 언어를 바꿔 짝이 **한 언어**가 되면: 구성원들이 **이웃**(원문 차례로 붙어 있고 `getMergeBlocker`와 같은 서버 검사 통과)이면 **짝을 풀고 합친다**. 이웃이 아니면(멀리 맺은 짝) **짝만 푼다**(사용자 덧붙임).
   - **합친 박스**(조각 2개 이상)에서 **조각 하나의 언어**를 바꾸면: 그 조각을 나누고 남은 쪽과 **짝**으로. "조각" = 합치기 전 Unit들(unmerge 기록 — `can_unmerge`가 참일 때만 메뉴에 "조각마다"가 뜬다. 같은 블록의 이웃 범위는 `join_close_spans`가 한 범위로 이어 경계가 남지 않으므로, 경계는 unmerge 기록에서 읽는다). **맨 앞 · 맨 뒤 조각만** 바꿀 수 있다 — 가운데 조각은 꺼진 항목 + 까닭("가운데 조각은 앞뒤가 떨어져 바꿀 수 없어요")(내 판단). 남은 조각이 둘 이상이면 그대로 합친 채 짝의 한쪽이 된다(한쪽 최대 3 `MAX_PAIR_SIDE`).
   - **3-c의 범위는 이 두 전환뿐**(내 판단): 짝 구성원 · 합친 박스 조각의 언어를 바꿔 모양이 바뀔 때만 배정을 풀고 바로 한다. 짝이 아닌 배정된 박스의 보통 언어 바꾸기는 지금처럼 409 `unit_has_decision`으로 막는다(editing.py:1923-1932).
   - 배정이 있으면 확인 창 없이 **바로 하고**(3-c) 알림: "합쳤습니다 · 배정 N개 풀림 [되돌리기]" / "짝을 풀었습니다 — 떨어져 있어 합치지 않음 · 배정 N개 풀림 [되돌리기]" / "짝으로 나눴습니다 [되돌리기]".
   - 되돌리면 **언어 · 짝(카드 안 순서 · 확정 상태 포함) · 합침 · 풀린 배정이 함께** 돌아온다. 지금 `_leave_pairs`는 짝을 되살리지 않고 `unit_edit` 단계 되돌리기는 배정을 되살리지 않는다(위 2) — 짝 · 결정까지 찍는 단계로 기록한다.
4. **조각 언어 메뉴**: 합친 박스의 우클릭 "언어"에 "조각마다" 무리(조각 글 앞부분 + 지금 언어) — 조각을 골라 언어를 바꾼다. 기존 "한 문장 | 한/영 짝" 전환은 이 새 길로 대체하거나 같은 서버 편집을 부르게 한다(되돌리기 한 칸).

**시험**: `pair-drop-model.test.ts`(합치기 · 짝 · 거절 · 한 언어 문서), 서버 편집 시험(짝 → 같은 언어 + 이웃 → 합침, + 멀리 → 짝만 풂, 합친 박스 조각 → 짝, 각 되돌리기가 전부 되살림, 배정 풀림 수). **문구**: 드롭 꼬리표 · 거절 까닭 · 알림 셋 en/ko. **설명서**: Assign 짝 · 합치기 조각. **기능 맵**.

### B7 · `feat/pair-peek` — 1단 보기 짝 엿보기 · 그림 위치 판 넓히기 (항목 4)

**지금**
- 짝 안내 줄 `assign-paper-pair-hint-<id>`(paper.tsx:739-761, 모델 FE `lib/pair-hint-model`): 고른 박스의 짝이 멀리 있으면 그 박스 아래 "↓ 짝 EN · 아래 §7.1"(`paper.pairHint.*`). 누르면 `goToUnit`(page.tsx:570 → UAP:1060-1069, 그 짝을 고르고 스크롤).
- 그림 카드의 위치 보기 `assign-figure-show-<id>`(FE `components/paper/figure-tab.tsx:37`) → OldPane의 `spot`(FE `components/assign/old-pane.tsx:111-112, 212`) → `FigureSpotPanel`(FE `components/assign/figure-spot-panel.tsx`, old-pane.tsx:233-246). 판은 Old 칸 **왼쪽**에서 나온다(`styles/components.css:2407-2419`: `.figure-spot` absolute left:0, `width: min(460px, 92%)`). 내용은 그림 앞뒤 본문 3줄(`SPOT_ROWS`, `findFigureSpot` FE `lib/figure-spot-model.ts:35-60`)을 읽기 전용 `Paper`로, 자리는 **점선 + 점**(`.figure-spot-line` · `-label`), 문장 속 그림이면 그 문장을 고른 것처럼 칠하고 글자 자리에 **세로 줄**(`.cut-b` inset 2px). 판 줄을 누르면 닫고 본문 탭의 그 줄로(old-pane.tsx:239-243). Esc · 바깥 누름으로 닫힘(`useDismiss`).
- 그림은 한/영 짝이 될 수 없다(`create_pair`가 글 아닌 Unit 거절). 1단/2단 보기 `assign-view-one` / `-two`(FE `app/bundles/[id]/assign/assign-bar.tsx:49-56`) → `changeView({single})`, 1단은 New 칸을 숨긴다(page.tsx:493, 677), 기억 `sopa.assign.single`(FE `lib/assign-view-prefs.ts:19-20`). **1단 보기는 한 열**(`.assign-panes[data-single]` `minmax(0,1fr)`)이고 Old 용지가 `margin-inline: auto`로 **가운데**에 놓인다(`styles/components.css:1745-1747`) — 빈 곳은 양옆으로 나뉘어, 600px 판을 그냥 오른쪽에 띄우면 용지를 가린다. 한 단 ↔ 양 단 전환 움직임은 `lib/use-pane-slide`.

**바꿀 것**
0. **1단 보기 배치(내 판단)**: 판이 열리면 1단 보기의 칸을 두 열(`minmax(0,1fr)` | `min(600px, 45%)`)로 바꾸고 Old 용지는 가운데에서 왼쪽으로 미끄러진다(`use-pane-slide`와 같은 움직임 — 새 타이머는 공용 훅에). 창이 좁아 두 열이 안 들어가면(용지 최소 폭을 못 지키면) 판은 오른쪽에서 용지 위로 덮는다. 판이 닫히면 다시 가운데.
1. **1단 보기**에서 짝 안내 줄을 **한 번** 누르면 오른쪽에 **짝 판**: 짝 박스 + 앞뒤 본문 3줄(그림 판과 같은 수 — 내 판단), 짝 박스를 칠함. **두 번** 누르면 지금처럼 그 짝을 고르고 스크롤(판은 닫힘). 판 줄을 누르면 그 줄로 이동. Esc · 바깥 · 닫기 단추 · 다른 박스 고르기로 닫힘. 한 번/두 번을 가르느라 한 번 누름은 약 250ms 늦게 연다 — 타이머는 공용 훅(`src/lib/use-*.ts`, 예 `use-click-or-double.ts`)에.
2. **2단 보기**에서는 안내 줄 한 번 누름 = 지금처럼 바로 이동(4-b).
3. **그림 위치 보기(4-a)**: 1단 보기에서는 같은 오른쪽 판으로(부품 하나 — `FigureSpotPanel`을 "어느 Unit의 자리든" 보이는 판으로 일반화: 그림이면 그림 자리, 짝이면 짝 박스). 2단 보기에서는 지금처럼 왼쪽 판.
4. **판 폭 1.3배**: `min(460px, 92%)` → `min(600px, 92%)`(왼쪽 · 오른쪽 둘 다).
5. **그림 자리를 네모로**: 문단 사이 자리 = 점선 + 점 대신 **점선 네모 상자**(그림을 줄인 작은 미리 보기 — 높이 약 48px, 받아 온 그림이 없으면 그림 아이콘 — + "그림 N · 이 자리" + 캡션 글 한 줄). 문장 속 그림 = 세로 줄 대신 그 글자 자리에 **작은 네모 표지** "▣ 그림 N"(점선 테두리, 강조 색 옅은 바탕)을 글 사이에 끼워 그림. 색은 토큰만.

**시험**: 판 모델(짝 Unit의 앞뒤 줄 — `findFigureSpot` 일반화) 시험, 클릭/더블클릭 훅 시험. **문구**: 판 머리 "짝 · 아래 §7.1 (EN)" 등 en/ko. **설명서**: 1단 보기 · 그림 탭 조각. **기능 맵**: `assign-figure-spot` 위치 · 판 testid(짝 판은 예 `assign-pair-spot`).

### B8 · `feat/number-levels` — 번호 ◀ ▶ · 들여쓰기 저장 · 일괄 (항목 7)

**지금**
- **들여쓰기는 저장 값이 아니다** — 번호 칸 폭으로 그때그때 정한다: `getTabWidths`(FE `lib/strip-pill-model.ts:43-65`) ← paper.tsx:535-546, 라벨 `readRowLabel`(paper.tsx:131-136). 번호 없는 줄은 **앞 줄 폭**(strip-pill-model:59), 글머리 기호 줄 = 앞 숫자 단계 + 1 + 기호 차례(• 0 · o 1 · ▪ 2, `getBulletLevel` FE `lib/number-kind-model.ts:64-67`). 그래서 기호 없는 줄이 위 기호 줄의 들여쓰기를 물려받는다. Old 용지엔 들여쓰기 손잡이가 없다(결과물 C의 New 줄에만, `output-c.tsx:188-200`, `canIndent` FE `lib/section-number.ts:106-118`).
- 번호 칸 창 `NumberCell`(FE `components/paper/number-cell.tsx`): 종류 단추 줄(연속 · • o ▪ · 직접 · 없음, testid `assign-paper-num-kind-*`) + 연속 · 직접일 때 입력 상자(`assign-paper-num-input`, :213-237 근처). 점 기호 · 없음은 누르면 바로 저장. 저장 `onSave` → `set_number`(page.tsx:624-625).
- **연속 번호 기본값** `suggestUnitContinuous`(number-kind-model.ts:53-62) → `listNumberSiblings`(FE `lib/number-model.ts:133-148`) — **같은 언어 · 같은 `table_id`**의 위 번호만 본다. 벗긴 줄은 `table_id`를 지닌다(벗기기는 `group_unit_id`만 비움, editing.py:1182, `_build_draft` :508). 표 밖 제목 "5"를 못 봐 `suggestContinuous`가 "1"(number-kind-model.ts:45). 서버 "따라 고치기"도 같은 표 범위(editing.py:905-919). 제안은 서버 사본이 없다(number-kind-model.ts:2). 따라 고치기 미리 보기 `planFollow`는 서버 `numbering.plan_follow`의 사본(rule-cases 대조).
- 저장 · 되돌리기: `SetNumberOp`는 `unit_id` 하나(editing.py:237-250). 기호엔 따라 고치기 없음(numbering.py:286-288). `editUnits` 호출 하나 = 되돌리기 한 칸(BE `sop/decision_steps.py:413-440`, `step_key` 합치기는 결정 저장만 :387-393). 여러 Unit을 한 칸으로 바꾸는 op 선례: `set_language` · `clear_noise` · `set_heading`(editing.py:165-168, 251-268). `_change.numbers`는 이미 여러 Unit(:392)이고 `number_changes`로 기록 · 재생(:2066, 2102).

**바꿀 것**
1. **들여쓰기 값 저장 — 상대 값**(내 판단): `Unit`에 열 하나 `indent_shift: int`(기본 0) — 지금처럼 셈한 단계(앞 줄 폭 · 기호 단계)에 **더하는 차이**다. 그래서 위 번호 줄의 단계가 바뀌면 기호 · 없음 줄은 저장 값이 있어도 함께 따라간다(7-b가 저절로). 화면 단계 = 셈한 단계 + `indent_shift`, 0-9로 자른다. Alembic 리비전(`--rev-id` 다음 번호, 생성물 직접 검토). 문서 보기 `units[]`에 실어 용지가 폭을 그 값으로. 모든 Unit에 있는 열이지만 손잡이는 Old 용지(Assign)에만 — 결과물 C의 New 줄 깊이와는 잇지 않는다(내 판단). 화면은 5단계까지 차이 나게 그린다는 기존 결정 유지.
2. **편집 op 둘**(여러 Unit, 되돌리기 한 칸): `set_indents [{unit_id, indent_shift}]`, `set_numbers [{unit_id, number}]`(따라 고치기 포함 가능). FE `EditOp`(FE `lib/api-sop.ts:503`), `assign-focus-model.ts:252-293`, `IN_PLACE_EDIT_OPS`(FE `lib/decision-step-model.ts:43`), 되돌리기 이름 i18n `assign.step.<op>`.
3. **번호 칸 창에 ◀ ▶** — 입력 칸 양옆, **입력 칸 폭 고정**(`MAX_NUMBER_CHARS` 글자가 들어가는 고정 폭, 가운데 맞춤 — 번호 길이가 바뀌어도 단추 자리가 그대로). 기호 · 없음 줄도 같은 자리에 ◀ ▶(입력 칸 자리는 같은 폭의 빈 자리).
   - **번호 줄**: ▶ = 한 단계 깊게(위로 가장 가까운 번호의 하위로 이어 셈 — 위가 "5"면 "5.1", 위가 "5.1"이면 "5.1.1"…; 같은 부모 아래 이미 하위가 있으면 그 다음), ◀ = 한 단계 얕게(그 단계에서 위로 가장 가까운 번호의 다음 — "5.1" → "6"). **맨 위 단계면 ◀ 꺼짐. ▶ 끝 = 위로 가장 가까운 번호의 깊이 + 1**(두 단계 이상 못 뜀 — 사용자 덧붙임). 바꾼 뒤 아래 번호는 지금처럼 **따라 고치기 미리 보기**(7-c).
   - **기호 · 번호 없는 줄**: ◀ ▶이 `indent_shift`를 ∓1 한다(화면 단계 기준으로 끝을 잰다). ◀ 끝 = 0, **▶ 끝 = 바로 위 줄 단계 + 1**(내 판단 — 번호 줄 규칙과 같은 뜻).
4. **기본 번호(사용자 예)**: 연속 번호 제안 = **문서 차례로 위로 가장 가까운 번호**(같은 언어, 표 경계 무시)의 **같은 단계 다음 값**. 제목 "5" 아래 벗긴 표의 줄 → "6", ▶ → "5.1". `listNumberSiblings`의 `table_id` 조건을 이 제안에서 뺀다(서버 따라 고치기 범위까지 넓힐지는 받는 세션이 본다 — 넓히면 `_plan_set_number` · `listNumberSiblings` · `rule-cases.json` 함께).
5. **기호 고를 때 위로 맞춤**: 기호를 고르면(종류 단추) 위로 가장 가까운 **기호 줄**(같은 절 — 더 얕은 번호 줄을 만나면 멈춤)의 **기호와 단계**를 따른다. 없으면 지금 규칙. 창에서 다른 기호를 직접 누르면 그 기호.
6. **연속 줄 일괄(7-a · 7-b) + 되돌리기 두 칸**: 기호 · 없음 줄에서 ◀ ▶을 누르면 —
   - 함께 바뀌는 줄 = 누른 줄 **아래로** 이어지는, **같은 단계 · 같은 꼴**(같은 기호끼리, 또는 둘 다 번호 없음)의 줄들. 그 사이의 **더 깊은 줄(하위)은 함께 움직이고**(같은 차이만큼) 범위를 끊지 않는다. 더 얕은 줄 · 다른 꼴을 만나면 멈춘다. 번호 줄은 일괄 대상이 아니다(번호 줄은 따라 고치기가 맡는다) — 번호 줄의 하위인 기호 · 없음 줄은 단계가 번호에서 셈해지므로 저절로 따라간다.
   - 저장은 **두 번**: ① 누른 줄 하나(되돌리기 1칸), ② 함께 바뀐 줄 + 하위(되돌리기 1칸). <kbd>Ctrl</kbd>+<kbd>Z</kbd> 한 번 = ②만 되돌림(누른 줄은 남음), 두 번 = 누른 줄까지. 알림 "L 줄과 이어진 N줄을 함께 내어썼습니다".
7. 시트(7-d)는 B9가 이 값을 읽는다.

**시험**: 순수 모델(◀ ▶ 다음 번호 · 끝 제한, 기본 제안 = 위 가장 가까운 번호, 기호 위로 맞춤, 연속 범위 · 하위 포함 · 멈춤), 서버 op 시험(한 칸 되돌리기, 범위 검사), `rule-cases` 갱신. **확인**: 제목 "5" 아래 합성 표 벗김 → 줄 번호 칸 → 제안 6 → ▶ 5.1 → ▶ 꺼짐 → ◀ 6, ◀ 꺼짐. 기호 줄 아래 번호 없는 두 줄 → 첫 줄 ◀ → 둘 다 내어씀 → Ctrl+Z → 둘째만 돌아옴 → Ctrl+Z → 첫째도. **설명서**: 번호 칸 조각. **기능 맵**: 번호 칸 창 testid(◀ ▶, 예 `assign-paper-num-outdent` / `-indent`).

### B9 · `feat/paragraph-sheet-edits` — Space 미리보기 · 문단 Excel에 편집 반영 (항목 9)

**지금**
- 만드는 곳 BE `sop/paragraph_excel.py`(모듈 머리에 규칙), 경로 BE `routers/sop_documents.py:1003-1041`(`…/documents/{doc_id}/paragraphs.xlsx`, `…/paragraphs/preview`, 묶음 전체 Old `…/old-paragraphs.xlsx`). **Old · New 어느 쪽 문서든** 같은 빌더. 같은 `Sheet` 모형이 xlsx와 미리보기에 쓰인다. 다섯 열 Section No. · Text · Lang · Number note · Remark(`PARAGRAPH_HEADERS`), 숨은 값 없음(설계 D4).
- `load_unit_lines`(:179-231): 최신 추출의 살아 있는 Unit 전부, 본문만(:88). 차례 = 원문 → 벗긴 표 덩이 순서 → 짝 카드 순서. Remark = `UnitDecision.reason`(:212-216). **disposition을 읽지 않는다 → 삭제한 줄이 보통 줄로 나온다.** 고친 번호는 반영된다(`get_number` · `format_number_note`).
- Old 합치기 = Unit 하나 = 한 행(글 안 `"\n"`은 B5가 없앤다). 빈 템플릿 용지 Join(UAP:2318-2333, `buildComposedMerge` → `saveGroup`)과 이미 쓴 New 문장에 둘을 잇기는 **Old Unit 둘이 New 대상 하나**(`TargetSource`, BE models.py:571)로 가는 것이라 시트는 두 행.
- Section No. `numbering.build_section_numbers`(numbering.py:203-218): 줄 번호가 기호가 아니면 그 번호, 아니면 앞 번호를 물려받음(같은 언어 먼저, neutral · REF는 아무 언어). **벗긴 표 의심**: 숫자만 든 칸("1", "A")이 다음 칸 줄의 번호 범위가 되어(segment.py:422-433) Section No.를 다시 세고 **표 뒤 문단까지 번진다**. 칸에 친 "5.1.2"는 글이다(B5가 바꿈). 칸 줄은 흔히 neutral이라 아무 언어의 앞 번호를 받는다.
- 기호 줄: Section No. = 물려받은 번호, Text = "• 글"(`_format_text` :77-79).
- 미리보기 FE `components/assign/space-preview.tsx`(시트 `SheetView` :237, 행 표시 picked/group뿐 FE `lib/sheet-view-model.ts:182-192`), `reloadKey`(결정 저장 · 문서 revision)마다 다시 받는다. 숨김 선례: `SheetRow.toc`(BE `sop/sheet_model.py:132-135`, 미리보기 전용 — 프런트가 접음), Excel A의 "del" 톤(sheet_model.py:110).

**바꿀 것**
1. **삭제(9-a)**: `UnitLine`에 disposition. 확정 삭제 줄은 —
   - **Excel**: 행을 지우지 않는다. Remark = "삭제"(사유가 있으면 "삭제 — 사유"; en 시트면 "Deleted"/"Deleted — reason" — 시트 언어 규칙은 지금 Remark 규칙을 따름), **Text 글자 취소선 + 회색 글자**(openpyxl `Font(strike=True, color=…)` — 색 값은 기존 excel_export 상수 옆에). **Lang은 빈 칸**(사용자 결정 — 지운 줄의 언어는 뜻이 없다). 미리보기도 같은 행 모형이라 빈 칸. Section No. · Number note는 그대로 둔다(어디서 지웠는지 찾는 데 쓴다 — 내 판단).
   - **미리보기**: 미리보기 전용 `SheetRow.deleted` 필드(파일엔 안 씀). 프런트는 삭제 행을 **숨기고**, 지금 고른 박스가 그 삭제 줄이면 **그 행만 빨간 음영**(위험 토큰)으로 보인다.
   - `countDataRows` · `limit_window`(행 수 · 창 계산)가 숨긴 행을 어떻게 세는지 맞춘다.
2. **New 쪽에서 묶인 Old 줄 → 한 행(9-c)**: 시트 차례로 **이어진** Old Unit들이 확정 결정으로 **같은 New 대상 하나**에 가면 한 행. Text = 각 글을 띄어쓰기로 이음, Section No. = 첫 줄 것, Lang = 같으면 그 언어, Number note = 첫 줄 것, Remark = 사유들을 " / "로. **적용 범위(사용자 확인 2026-11-20)**: 빈 템플릿 Join이든 이미 쓴 New 문장에 둘을 잇든 같게. 이어지지 않은(사이에 다른 줄이 낀) Old 줄은 각자 행. 미리보기의 `unit_id`는 여러 id(첫 id를 대표로, 고름 표시는 그 무리 어느 Unit이든).
   - **New 문서 자체의 문단 Excel**(이미 쓴 New 문서도 같은 빌더): 그 문서 Unit의 합치기 · 나누기 · 번호는 지금처럼 그대로 반영된다. 삭제 판단은 Old Unit에만 있어 New 문서 시트엔 삭제 표시가 없다.
3. **벗긴 표 Section No.**: 사람이 고치지 않은 **번호 칸(`number_source == cell`) 번호는 그 벗긴 표 덩이 안에서만** Section No.로 쓰고, 덩이가 끝나면 덩이 앞의 번호로 돌아간다(내 판단). 사람이 정한 번호(`number_set`, B8의 ◀ ▶ · 제안 포함)와 B5가 저절로 잡은 타자 번호는 보통 번호처럼 이어진다. 사용자가 "섹션넘버가 제대로 안 들어간다"고 한 실제 꼴은 받는 세션이 합성 표로 재현해 시험부터 쓴다(§6-3).
4. **기호(9-b)**: Section No. = `"{번호} {그 줄의 기호}"`("5.1 •"), Text 앞의 기호는 뺀다. 번호가 없으면 기호만.
5. **들여쓰기(7-d)**: Text 칸 `Alignment(indent=단계)` — 단계 = 용지와 같은 셈(번호 깊이 · 기호 단계 · 앞 줄) + B8의 `indent_shift`. 용지의 셈(`getTabWidths` · `getBulletLevel`)을 서버 순수 함수로 옮기고 `rule-cases`로 프런트와 대조한다.
6. 시트 머리 · 열은 다섯 그대로(D4 유지).

**시험**: `test_sop_paragraph_excel.py`(삭제 행 Remark · 취소선, 미리보기 deleted 플래그, 묶인 Old 줄 한 행 · 끊긴 줄 두 행, 번호 칸 번호가 덩이 밖으로 안 번짐, "5.1 •", 들여쓰기 값), `sheet-view-model.test.ts`(숨김 · 고른 삭제 행만 보임). **확인**: Space 미리보기에서 삭제 박스 고름 → 그 행만 빨간 음영, 다른 박스 고름 → 사라짐. 내려받은 xlsx를 열어 확인. **설명서**: Space 미리보기 · 문단 Excel 조각.

### B10 · `feat/caption-anywhere` — 표 캡션 지정 넓히기 (항목 8)

**지금**
- 올릴 때 `_attach_captions`(docx_reader.py:1276-1303): 같은 그릇(container)의 **±1 문단 레코드만** 본다(표는 앞 → 뒤 차례, `by_slot`엔 `_ParaRecord`만 :1283). 캡션 = `TABLE_CAPTION_RE`(BE `sop/renumber.py:13-14`: `^(?:표|Table)\s*\.?\s*(\d+)(?=$|[\s.:)\-—])`) 또는 Caption 스타일(:1262-1269). 빈 문단도 레코드라(:969-986) 빈 줄 하나면 끊긴다. 캡션 표시는 **블록 전체**에 붙는 `caption_of`다(segment.py:391-397). 위 캡션이 없는 표는 아래 표의 "표 2"를 가져갈 수 있다. `<표 1>` · `[표 1]` · `표-1` 꼴은 못 읽는다.
- **칸 안 구조**: 표 칸 하나 = 블록 하나, 칸 안 문단은 레코드가 아니라 `"\n"`으로 이어진 글이다(docx_reader.py:1121-1166). 칸 안 안쪽 표는 칸 레코드 **뒤**(`after`)에 나오고 자리는 `place=(행, 열, 앞 문단 수)`로만 남는다(:1162-1164, 1027). `table_slots`는 그릇에 바로 놓인 표만(:924, 1036-1037) → **칸 안 표는 캡션을 잇지 않는다.** 칸 글은 Unit을 만들 때 `"\n"`에서 나뉘므로 "표 1." 줄은 그 칸 블록의 한 범위를 가진 칸 문장 Unit이 된다.
- 첫 행이 캡션으로 "지정"되진 않는다. 캡션 없는 표 머리 FE `components/paper/bundle-head.tsx:44-51`(미리 보기 paper-model.ts:439-445)가 **"캡션 필요 · 첫 행 <1행 글>"**을 보여 1행 1열이 캡션처럼 보였다. 결정 칸 슬롯(FE `lib/caption-slot-model.ts:276-310`): 가까운 후보 · **첫 행**(op `set_first_row_caption`, 계획 `_plan_first_row_caption` BE editing.py:1390-1430) · **쓰기**.
- 끌기 거절 `assign.ctx.why.notText` "문장과 제목만 고칠 수 있습니다."(i18n-messages.ts:2551) ← `resolveCaptionDrop`(caption-slot-model.ts:322) / `isCaptionableText`(:136-138): 종류가 sentence/heading이 아니거나 `group_unit_id`가 있거나 ref · 목차 줄이면 거절. 서버도 `CAPTIONABLE_KINDS = ("sentence","heading")`(editing.py:118, 검사 :1348, `invalid_unit_kind`). 우클릭 "위/아래 표의 캡션으로 쓰기"(`assign.ctx.captionOfTablePrev/Next`, "위/아래 그림의 캡션으로 쓰기")도 같은 규칙. 바깥 표를 벗기면 "표 1." 줄은 **칸 문장**이라 모두 거절, 후보 목록도 칸 문장을 빼서 "첫 행" · "쓰기"만 남는다. 끌어도 표 행 전체를 누르면 `resolvePickUnit`이 표 Unit으로 올려(paper-model.ts:410) 같은 거절.
- 연결 = `Unit.group_unit_id`(캡션 종류 `"caption"`, BE `sop/captions.py:6`). 거리 `CAPTION_REACH = 2` 블록(BE `sop/caption_slot.py:12` ↔ 프런트 사본 :10), `buildBlockPlaces`(caption-slot-model.ts:94-115 ↔ `caption_slot.build_block_places`)는 바깥 표 전체를 한 자리로 센다.
- 직접 쓰기는 New 쪽 캡션 대상이라 New 자리를 고른 뒤에만 열린다(`writeBlockedKey` `assign.captionSlot.why.pickPlace`, assign-side-panel.tsx:248-313, :642). 떼기 `detach_caption`(FE `components/assign/caption-slot.tsx:101`), "↩ 다시 첫 행으로"(:115).

**바꿀 것**
1. **올릴 때(추출기, `EXTRACTOR_VERSION` 올림)**: 칸 안에 든 안쪽 표도 캡션을 잇는다. **칸 블록을 쪼개지 않는다**(내 판단 — 쪼개면 바깥 표 칸 글 · 결과물 A의 "표 n · r행 c열" 위치 · 다시 표로 묶기 `_find_crossing_cells`가 흔들린다). 대신 **Unit 단위로** 잇는다: 안쪽 표의 `place=(행, 열, 앞 문단 수)`로 같은 칸 안 바로 앞 줄(빈 줄 건너뜀, 없으면 바로 뒤 줄)의 범위를 알 수 있으니, 추출 결과에 "캡션 범위(칸 블록, 시작, 끝) → 안쪽 표" 신호를 싣고, Unit을 만들 때(units.py) 그 범위를 덮는 칸 문장 Unit을 그 표의 캡션(종류 `caption`, `group_unit_id` = 안쪽 표 Unit)으로 만든다. 바깥 표가 아직 표인 동안 그 캡션 Unit이 바깥 표 묶음과 안쪽 표 묶음 중 어디에 속하는지(칸 문장 묶음 · 표 행 줄 그리기 · 문단 Excel)는 받는 세션이 정한다 — 안쪽 표 쪽을 권함. 그릇에 바로 놓인 표는 지금 규칙에 **빈 문단 건너뛰기**만 더한다. 정규식을 넓힌다: `<표 1>` · `[표 1]` · `표-1` · `Table-1` · `(표 1)` 꼴(그림 `그림|Figure|Fig.`도 같은 꼴) — `renumber.py` · 프런트 사본(caption-slot-model.ts:14-19) · `rule-cases.json` 함께.
2. **머리 표시**: 캡션이 없으면 "캡션 필요"만 — 1행 글을 캡션처럼 보이지 않는다. 첫 행은 결정 칸의 후보 하나로만.
3. **아무 글 줄이나 캡션으로**: 캡션 가능 종류에 **칸 문장 — 단 묶음이 풀린 것(벗긴 표 줄, `group_unit_id` 없음)**을 더한다(서버 `CAPTIONABLE_KINDS`/검사 · 프런트 `isCaptionableText` · assign-context-menu-model.ts:66, 97). 주의: `_build_freed_caption`(editing.py:1070-1076)은 `table_cell` 블록의 캡션을 떼면 **대상 표의 칸으로 되돌리고**, `origin:"first_row"`(caption-slot-model.ts:294) · `set_first_row_caption caption:false`(editing.py:1405)가 잘못 "첫 행 내림"을 할 수 있다 — 블록의 `table_id`가 캡션 대상 표의 것일 때만 첫 행으로 보고, 다른 표(벗긴 바깥 표)의 칸이면 보통 캡션처럼 떼면 원래 줄로 돌아가게.
4. **지정 길 넷(8-a)**:
   - 줄을 표(또는 그림) **머리에 끌어 놓기** — 지금 끌기 길을 넓힌 것. 표 행 전체 누름이 표 Unit으로 올라가는 것은 그대로(그 경우 거절 까닭을 "표 행 말고 줄 하나를 끌어 주세요"처럼 따로).
   - 줄 **우클릭 → "캡션으로" → 표 n / 그림 n 목록**(가까운 순 최대 5개 — 내 판단, 각 항목에 "바로 아래" · "아래 2" 같은 거리). 기존 "위/아래 표의 캡션으로 쓰기" 항목은 이 하위 메뉴로 합친다.
   - 결정 칸 캡션 슬롯의 **"줄을 눌러 고르기"**: 누르면 고르기 상태(용지 위 커서 · 안내 띠, Esc 취소) → 용지의 글 줄을 누르면 그 줄이 캡션.
   - **직접 쓰기**: 지금 그대로(New 자리를 고른 뒤).
5. **후보 거리(8-b)**: `CAPTION_REACH` 제한을 없애고 후보는 **가까운 순**(같은 칸 안 → 같은 덩이 → 앞뒤 블록 거리)으로, 목록은 처음 몇 개만 펼치고 "더 보기". 양쪽 사본 · `test_sop_caption_slot.py` · rule cases 함께.
6. 거절 까닭은 캡션용 문구로 따로(예 `assign.captionSlot.why.notCaptionable` — "목차 줄은 캡션이 될 수 없어요" 등 종류별). `assign.ctx.why.notText`를 캡션 거절에 쓰지 않는다.

**열린 것(받는 세션이 정함)**: 벗긴 칸 문장이 캡션이 되면 결과물 A의 위치 칸("표 n · r행 c열")을 지킬지 · 캡션 자리로 바꿀지 — 캡션 자리를 권함.
**시험**: 추출기 시험(§6-1 합성 docx — 칸 안 "표 1." + 빈 줄 + 안쪽 표 → 연결, 괄호 꼴), 편집 시험(벗긴 칸 문장 → 캡션, 떼면 원래 줄, 첫 행 오판 없음), `caption-slot-model.test.ts`(후보 순서 · 거리 제한 없음 · 거절 까닭). **확인**: 합성 문서 다시 올림 → 안쪽 표 머리에 캡션, 바깥 표 벗김 → 줄 끌어 놓기 · 우클릭 · 고르기 · 쓰기 넷 다. **설명서**: 캡션 조각. **기능 맵**.

### B11 · `feat/ai-unwrap-order` — 벗긴 표 "AI 순서 제안" (항목 11 뒷부분)

**지금**
- "↺ 다시 표로": 벗긴 표 머리 줄 `renderUnwrapHead`(paper.tsx:1349-1370), 줄 `assign-paper-unwrap-head-<tableId>`, 단추 `assign-paper-rewrap-<tableId>`(`btn toc-act`, `assign.unwrap.rewrap`), `.unwrap-head` 안 처리 중 알약 옆, `canRewrap`일 때만. prop `strips.unwrap`(paper.tsx:212-213) ← page.tsx:601, 처리 `rewrapTable`(UAP:1393-1401). 모양 도구에도 있다(FE `components/assign/shape-tools.tsx:185`, UAP:1244-1245). 새 prop은 `PaperChunk`의 비교 deps(paper.tsx:1446)에 더해야 먼 덩어리도 다시 그린다.
- 순서 바꾸기 = 편집 `reorder_unwrapped`(editing.py:280-286, 계획 :1585-1604) — `POST /bundles/{id}/documents/{doc_id}/edits`(BE `routers/sop_documents.py:867`), 프런트 손잡이 끌기(UAP:3059). 덩이의 줄 **전부**를 새 순서로 보내야 한다(아니면 422 `unwrap_lines_mismatch` + 지금 순서). 결정을 막지 않는다. `unwrap_seq`만 바뀌고 결과물 A는 순서를 무시한다(`unwrap_order.py` 머리말).
- **AI 순서 작업은 없다.** AI 층: `ai_jobs` 표 CHECK `AI_JOB_KINDS`(BE `sop/constants.py:49`, `models.py:635`, `kind String(12)`), 처리기 등록 `ai/handlers.py`(load / compute / apply — `ai_suggestions`(models.py:670)에만 쓴다), 요청 경로 예 `/split`(BE `routers/sop_ai.py:166-177`). 가까운 선례 **나누기 제안**(`ai/split.py`): 자리만 저장, 사람이 편집을 적용한 뒤 `/suggestions/{id}/adoption`(sop_ai.py:220-233)으로 채택 기록 — `adoption.record_split_adoption`(adoption.py:374-381)은 split 전용. 상단 바 AI 작업 표시 `lib/ai-jobs-store.ts` · `ai-jobs-indicator.tsx`. 불변식 `backend/tests/test_invariants.py`(`call_ai_recorded`, AI의 `confirmed_text` 금지 등).
- 2026-11-19 요청서에 "벗기기 때 AI로 순서 · 들여쓰기 제안"이 있었고 "손잡이 끌기 먼저, 써 보고 부족하면"으로 미뤘었다 — 이번에 사용자가 순서만 먼저 원했다(11-b).

**바꿀 것**
1. **서버**: 작업 종류 `unwrap_order`(12자 이내) + Alembic(CHECK 바꿈). 처리기 —
   - load: 덩이 줄(`editing._load_unwrap_lines` · `unwrap_order.order_unwrapped`)과 원래 표 모양(`ai/context.render_table_markdown`로 행 · 열 자리), 문서 revision.
   - compute: `llm.ensure_llm_enabled()` 먼저. 보내는 것은 줄 id · 글 · 원래 행 · 열 자리뿐(직원 이름 없음). 프롬프트 씨앗 `ai/seeds/prompt.unwrap_order.md`(읽는 차례 — 표가 세로 우선인지 가로 우선인지, 머리 칸 · 라벨 칸 먼저 등) + 지침 키.
   - apply: 줄 집합 · revision이 그대로인지(아니면 `stale`), 답이 덩이 줄의 **순열**인지(아니면 `invalid`) 확인 → `content = {table_id, unit_ids}`.
   - 경로(`require_ai_enabled`), `JobKind` 스키마, 채택 기록을 split 전용에서 일반화.
2. **화면**: 벗긴 표 머리 줄 "↺ 다시 표로" 옆 **"✦ AI 순서 제안"**(testid 예 `assign-paper-unwrap-ai-<tableId>`). AI가 꺼져 있으면 꺼진 단추 + 툴팁. 누르면 머리 줄에 작업 중 칩 → 제안이 오면 **그 자리 미리 보기(11-a)**: 덩이 줄마다 제안 순번, 옮겨 갈 줄 칠함("4 → 1" 칩), 머리 줄에 **[제안대로 놓기] [그대로 두기]**. 놓기 = `reorder_unwrapped` 한 번(되돌리기 한 칸) + 채택 기록. 그대로 두기 = 미리 보기 닫음(제안은 거절로 기록 — 선례를 따름). 미리 보기 중 덩이가 바뀌면 제안은 낡음으로 닫는다.
3. 제안은 순서만(11-b). 기호 · 들여쓰기 제안은 B8 뒤 다음 일.

**시험**: 처리기 시험(가짜 LLM — 순열 아님 → invalid, revision 바뀜 → stale, 페이로드에 이름 없음), 불변식 시험 통과, 프런트 미리 보기 모델(제안 순번 · 옮김 칩). **확인**: 가짜 AI(`node frontend/scripts/fake-ai-server.mjs`, 저장소 루트)로 배선만 — 정확도 근거가 아니다. **설명서**: 표 벗기기 조각. **배포 메모**: Alembic · AI 프롬프트 추가(CHANGELOG에).

### B12 · `feat/flowchart-figure` — 업무흐름도를 간이 그림으로 (항목 12)

**지금**
- 글상자(`w:txbxContent`)는 `_read_textboxes`(docx_reader.py:1013-1019)가 part `textbox` 문단으로 읽는다(칸 안은 :1160). 화면에 "텍스트 상자" 꼬리표 박스로 나온다.
- 그림 요소(`w:drawing` · `w:pict` · `w:object`, `_FIGURE_TAGS` :162)는 `a:blip`이 없어도 그림 블록이 된다(`pick_image_figure` :380-389, `_FigureRef` :358-366) → 그림 파일이 없어 화면은 자리 상자(FE `components/paper/figure-image.tsx` — `getFigureImage`가 이미지를 못 받으면 아이콘 상자).
- `mc:AlternateContent`는 한 갈래만 읽는다 — `_pick_alternative`(docx_reader.py:773-776)가 이미 Choice(wps)를 먼저, Choice가 없을 때만 Fallback(VML)을 읽는다. 할 일 없음.
- 서버엔 PIL과 한글 글꼴(BE `sop/assets/fonts/NanumGothic-Regular.ttf`, `flow_image.py`가 결과물 B 흐름 그림에 쓰는 것)이 있다. **외부 렌더러(LibreOffice 등)는 쓸 수 없다**(서버 빌드 때 PyPI · npm 밖 다운로드 금지, Docker Hub 차단).
- 업로드 파싱은 자식 프로세스, 메모리 상한이 있다(`SOP_PARSE_MEMORY_MB` 2048, backend 2G — 낮추지 않는다).

**바꿀 것(12-a (가), 12-b 아니오)**
1. **추출기**(`EXTRACTOR_VERSION` 올림): 그림 요소 안에 도형 캔버스(`wpc:wpc`) 또는 도형 묶음(`wpg:wgp`)이 있고 도형(`wps:wsp`)이 있으면 "도형 그림"으로 본다 —
   - 도형마다 위치 · 크기(`a:xfrm` `a:off` · `a:ext`, EMU; 묶음은 `a:chOff` · `a:chExt`로 좌표 바꿈), 모양(`a:prstGeom@prst` — `rect` · `roundRect` · `flowChartProcess` · `flowChartAlternateProcess` · `flowChartDecision` · `flowChartTerminator` · `ellipse` · `diamond` 등, 모르는 것은 네모), 선(`a:ln`, `headEnd` · `tailEnd` 화살표, 연결선 `straightConnector1` · `bentConnector*`와 `cxnSp`), 회전 · 뒤집기(`rot` · `flipH` · `flipV`), 글상자 글(가운데 맞춤, 줄바꿈)을 읽는다.
   - 그것으로 PNG를 그린다(PIL, 2배로 그려 줄임 — `flow_image.py`의 방식 · 글꼴 재사용, 흑백 선 · 흰 바탕, 최대 폭 상한). 실패하면 (나)처럼: 그림 없음 + 그림 안 글 목록.
   - 그 도형 묶음의 글상자 글은 **문단(Unit)으로 만들지 않고**, 그 그림 블록의 "그림 안 글"(순서 있는 짧은 글 목록)로 둔다 — **배정 대상 아님**(그림째 배정, 12-b). 보이는 곳은 그림 카드 · 용지 그림 줄의 접힌 목록과 Assign 찾기(있으면)뿐 — 문단 Excel · AI 분류 페이로드에는 넣지 않는다(내 판단). 도형 묶음 밖의 보통 글상자는 지금처럼.
2. **저장 · 보내기**: 그린 PNG를 그림 블록의 그림으로 내보낸다(`…/figures/{block_id}` — 지금은 docx 안 이미지 파트를 읽음). 그린 그림을 어디에 둘지(새 표 · 블록 메타 · 파일 저장소)는 받는 세션이 고른다 — DB 표를 더하면 Alembic, 백업 · db-viewer 규칙(`docs/deploy/db-viewer-readonly.md` — `document_files` 미리보기 금지 등)을 확인.
3. **화면**: 그림 카드 · 용지의 그림 줄에 그린 그림, 그 아래 접힌 "그림 안 글 N"(펼치면 목록). 결과물(A의 그림 칸 등)도 같은 그림을 쓴다.
4. 처음엔 실사례의 30개 흐름도로 맞춰 본다 — 사용자 PC에서만(실사례 파일은 저장소에 넣지 않는다). 저장소 시험은 §6-2 합성 캔버스.

**시험**: 추출기 시험(합성 캔버스 → 그림 블록 하나 · 글상자 Unit 없음 · 그림 안 글 5 · PNG 크기), 모르는 도형 → 네모, 그리기 실패 → (나). 메모리: 큰 캔버스(도형 수백)에서 파싱 자식이 상한 안인지. **확인**: 합성 문서 다시 올림 → 본문에 흐름도 조각 글이 없고 그림 탭에 그린 흐름도. **설명서**: 그림 탭 조각("도형으로 그린 그림은 간이 그림으로 보인다 — 원본과 다를 수 있음"). **배포 메모**: 추출기 버전, 다시 올려야 적용.

### B13 · `feat/wi-parent-optional` — SOP · WI 따로 올리기, 참조로 자식처럼 (항목 13)

**지금**
- 상위 = `TargetDoc.parent_id`(nullable, BE `sop/models.py:135`). `Document`엔 없음 — **New 문서(To-Be) 올리기만** 관계(Old엔 SOP/WI 구분이 없다).
- 필수인 곳: `tobe.check_match_doc`(BE `sop/tobe.py:842-867`, WI 상위가 없으면 422 `invalid_parent`) ← `ingest.py:97-98, 114-117`, To-Be 저장(tobe.py:367-372), Excel 가져오기(제품 명세 §344), 제품 명세 §164("WI라면 부모 SOP… 필수", `docs/superpowers/specs/2026-11-05-sop-restructuring-e2e-design.md`), 올리기 창 FE `components/documents/upload-modal.tsx:105-109`(제출 막음). 상위 고르기(:340-356)는 **이미 To-Be 목록에 있는 SOP만**(:94-99) — 같은 배치의 SOP는 못 고르고, SOP가 없으면 `upload.why.noSop`.
- 비어도 견디는 곳: `outputs._order_target_docs`(맨 뒤, :320-337), `tobe-draft.ts:70`(깊이 0), `candidates._list_wi_places(doc, None)`(:151), 결과물 C `parent_code` None(outputs.py:1626-1629).
- 상위에 기대는 곳: **SOP 7.2 자동 목록**(`outputs._list_auto_items` :1598-1607)과 **"채움" 필수 칸 검사**(:489-494, 검토 준비), AI 분류 페이로드 · 후보 라벨(`classify.py:330`), Excel C 머리(`sheet_model.py:455`), To-Be AI 목록(`tobe_list_job.py:121-128`), Documents의 끌어 놓기 상위 바꾸기(FE `lib/parent-drop-model.ts`).
- 참조 읽기는 이미 있다: `refs.py` 절 이름(:31-35 — "references" · "work instructions" · "associated/related documents" · "관련 문서" 등)과 문서 번호 꼴(:40-44). 추출기 ≥6이면 Unit을 만들 때 그 절 아래 줄을 REF로 확정하고 번호를 `unit_refs.number`에 저장한다(units.py:117-144, Old · New 모두). 참조 지도(`ref_map.py:119-130`)는 Old만 읽는다.

**바꿀 것**
1. **상위 선택으로**: `check_match_doc` · To-Be 저장 · Excel 가져오기에서 WI 상위 필수를 거둔다(상위가 있으면 지금처럼 SOP인지 검사). 올리기 창의 상위 고르기는 비워 둘 수 있고 빈 값 라벨 "없음 — 참조로 찾기". `rule.invalid_parent` 문구는 남는 검사(상위가 SOP가 아님 등)에 맞게. 제품 명세 §164 · §344를 고친다.
2. **참조로 찾은 상위(파생)**: New SOP 문서(파일이 있는 것)의 **확정 REF 번호**를 정규화(대소문자 · 공백 · 하이픈 변형)해 WI `TargetDoc.code`와 견준다. 같으면 그 WI는 그 SOP의 "참조로 연결된" 자식. 읽을 때 셈한다(저장 없음 — 내 판단; 성능이 문제면 캐시).
   - **직접 정한 상위가 이긴다.** 직접 상위가 없는 WI만 파생을 쓴다.
   - **13-a 전부에 쓴다**: Documents 목록(SOP 아래 점선 자식 + "참조로 연결 · 7.2" 같은 출처 칩), SOP 7.2 자동 목록, 검토 "채움" 검사, AI 분류 라벨 · To-Be AI 목록 · Excel C 머리 — 즉 상위를 읽는 곳 모두 "실효 상위"(직접 → 파생) 함수 하나를 거친다.
   - **13-b**: 여러 SOP가 같은 WI를 참조하면 **모든 SOP 아래에 보이고**, 7.2 목록에도 각 SOP에 들어간다. **상위 하나만 받는 곳**(Excel C 머리 `parent_code`, AI 라벨, To-Be 초안의 깊이)은 코드 순 첫 SOP를 쓴다(내 판단) — 받는 세션이 더 나은 규칙을 찾으면 바꾼다.
   - 파일 없이 Assign에서 만든 New 문서(`entrance == "assign"`)는 참조가 없다 → 직접 정한다.
3. Documents의 끌어 놓기로 직접 상위를 정하면 파생 표시는 사라진다(직접이 이김). 파생 자식은 끌어 놓기로 "직접"으로 바꿀 수 있다.

**시험**: To-Be 시험(상위 없는 WI 올리기 · 저장 · Excel 가져오기 통과), 파생 계산(정규화, 직접 우선, 여러 SOP), 7.2 자동 목록 · 채움 검사가 파생 자식을 셈, Documents 모델 시험. **확인**: 합성 New SOP(참조 항에 WI 코드) + 상위 없는 WI를 한 번에 올림 → SOP 아래 점선 자식, 결과물 7.2에 그 WI. **설명서**: 올리기 · Documents 조각. **문구**: "없음 — 참조로 찾기", "참조로 연결" 칩 en/ko.

---

## 6. 합성 시험 자료 (실사례를 흉내 내는 구조)

실사례 파일은 저장소에 넣을 수 없다. 아래 구조를 합성 docx(파일 이름 `SYNTHETIC_…`)로 만들어 시험에 쓴다(python-docx로 뼈대를 만들고 필요한 XML 조각을 넣는다).

1. **칸 안 캡션 + 안쪽 표(B10)**: 바깥 표 1×2(왼쪽 칸 "1", 오른쪽 칸 = 작업 칸). 오른쪽 칸 안 차례: 문단 "필요한 가스켓을 설치한다." → 문단 "표 1. 조제 탱크별 대상 장치" → **안쪽 표** 3×2(머리 "탱크 | 대상 장치") → 빈 문단 → 문단 "이 절차는 탱크 A–C에 적용한다." 변형: "표 1." 앞에 빈 문단 하나, `<표 2>` · `[Table 3]` 꼴, 영어 쪽 "Table 1. Target units per tank".
2. **도형 흐름도(B12)**: 표 칸 안 문단 하나에 `w:drawing` → `wp:inline` → `a:graphic` → `a:graphicData uri=".../wordprocessingCanvas"` → `wpc:wpc` 안에 `wps:wsp` 도형 5개(둥근 네모 "공정 시작", 네모 "7.1.1 장비 상태 확인", 마름모 `flowChartDecision` "이상 있음?", 네모 "담당 부서에 알림", 둥근 네모 "공정 결과" — 각 `wps:spPr/a:xfrm`의 `a:off x y` · `a:ext cx cy`(EMU), `a:prstGeom prst`, `wps:txbx/w:txbxContent/w:p` 글) + 연결선 4개(`wps:wsp`의 `wps:cNvCnPr`, `a:prstGeom prst="straightConnector1"`, `a:ln/a:tailEnd type="triangle"`). 실사례는 이것을 `mc:AlternateContent`(Choice = wps, Fallback = VML `v:group`)로 감쌌다 — 감싼 변형도 하나. 묶음 변형: `wpg:wgp` 안 `wps:wsp`(묶음 `a:chOff` · `a:chExt`).
3. **벗긴 표 Section No.(B9)**: 절 제목 문단 "5 조제 탱크 운전"(Heading 번호 5) 아래 표 3×2 — 왼쪽 칸 "1" · "2" · "3"(숫자만), 오른쪽 칸 작업 문장(칸 안 두 번째 문단은 "• 밸브를 확인한다." 기호 줄). 표 뒤 문단 "조제가 끝나면 기록을 남긴다." — 벗긴 뒤 표 뒤 문단의 Section No.가 "3"이 아니라 "5"(또는 사람이 정한 번호)인지.
4. **줄바꿈(B5)**: 칸 안 한 문단에 Shift+Enter(`w:br`)로 "세척 준비" ↵ "7.1 세척 노즐을 점검한다.", 숫자 칸 "7" + 내용 칸, "6.1."만 든 문단 + 다음 문단.
5. **참조(B13)**: New SOP 합성 문서의 "References" 절 아래 줄 "WI-SYN-0101 Tank cleaning", New WI 합성 문서 코드 `WI-SYN-0101`.

---

## 7. 내 판단 목록 (받는 세션이 근거를 갖고 바꿀 수 있는 것)

1. B1 — Enter 확정의 다음 줄도 같은 문서 · 되감기 없음 · 그림 거르기(삭제만 "바로 아래").
2. B4 — 펼친 삭제 박스의 옅은 위험 바탕(꼬리표는 박스 안 상태 칩 "Deleted"와 겹쳐 뺐다), 결정 칸 단추 문구도 "삭제 취소".
3. B6 — 끌어 놓은 합치기에서 배정된 박스는 틈 Join과 같은 확인(3-c "바로 하고 알림"은 언어 전환에만). 3-c 범위는 짝 · 합친 박스의 모양 전환뿐(보통 언어 바꾸기는 지금처럼 막음). 조각 언어는 맨 앞 · 맨 뒤 조각만. 짝을 맺고 푸는 모든 길을 되돌리기 줄에.
4. B7 — 짝 판의 앞뒤 줄 수 = 그림 판과 같은 3. 1단 보기에서 판이 열리면 두 열로 바꾸고 용지가 왼쪽으로(좁으면 덮음).
5. B8 — 들여쓰기는 상대 값 `indent_shift`(셈한 단계에 더함), 결과물 C와 잇지 않음. 기호 · 없음 줄 ▶ 끝 = 바로 위 줄 단계 + 1, 기호 위로 맞춤은 같은 절 안까지.
6. B9 — 번호 칸 번호는 벗긴 덩이 안에서만 Section No., 삭제 행의 Section No. · Number note는 남김.
7. B10 — 칸 블록을 쪼개지 않고 Unit 단위로 캡션을 이음, 캡션 Unit은 안쪽 표 묶음 쪽, 우클릭 캡션 하위 메뉴는 가까운 순 5개, 캡션이 된 칸 문장의 결과물 A 위치는 캡션 자리.
8. B12 — 그림 안 글은 그림 카드 · 용지 그림 줄 · 찾기에만(문단 Excel · AI 페이로드엔 없음).
9. B13 — 파생 상위는 저장 없이 읽을 때 셈, 상위 하나만 받는 곳은 코드 순 첫 SOP.

## 8. 사용자와 확인한 것 (2026-11-20, 시안 뒤)

- **6-b 기존 묶음에도 적용**(B5): 사용자가 "나갔다 들어오면 매번 다시 해야 하나?"고 물었고, 아니라고 답한 뒤(저장된 열로 늘 같은 값, "없음"은 기억) 적용으로 정했다.
- **9-c 범위**(B9-2): 이미 쓴 New 문장에 Old 줄들을 잇는 경우도 빈 템플릿 Join과 똑같이 한 행(이어진 줄만) — 사용자 "오케이".
- **4의 네모 표지 모양**(B7-5): 시안 그림 4-2(점선 네모 + 작은 미리 보기 + 캡션 / 문장 속 "▣ 그림 N")로 정해 두었다. 사용자가 따로 말하지 않았으니 받는 세션은 이대로 만들고, 화면을 본 사용자가 고칠 수 있다.

---

## 부록 A. 시안 페이지

- https://claude.ai/artifact/7efYbxuRmvtfDCbEXXjpCs (2판, 사용자 비공개 — 열리지 않으면 본문만으로 충분하다). 그림 번호: 1 삭제 뒤 고름 · 2 삭제 줄 접기(눌러 보기) · 3 끌어 놓기 장면 다섯 · 4 1단 짝 엿보기(한 번/두 번) · 4-2 그림 위치 판 네모 · 5 삭제 박스 메뉴 · 6 줄바꿈 · 6-2 "6.1." 합치기 전환 · 7 번호 ◀ ▶ · 일괄 · 되돌리기(눌러 보기) · 8 칸 안 캡션 · 9 시트 · 10 한/영 따로 행 · 11 AI 순서 제안 · 12 흐름도 · 13 올리기 창 · Documents.
- 원본 HTML은 사용자 PC에 있다. **계획 때 참고하는 목업이고 기준은 이 본문이다.**
