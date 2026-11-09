# React / TypeScript 패턴 (이 코드베이스)

화면 하나가 큰 클라이언트 컴포넌트로 자라면 훅 순서·클로저·deps 함정이 잦다. 아래는 그때 실측으로 얻은 교훈이다. `rules/languages/typescript.md`가 §7·§8을 번호로 참조하니 번호를 바꾸지 않는다.

## 1. TDZ — useCallback deps에 "뒤에 정의된" 값 금지
- `useCallback(..., [x])`의 deps 배열은 **렌더 중(정의 시점) 평가**된다. `x`가 그 콜백보다 **아래에서 `const`로 정의**되면 ReferenceError(TDZ).
- 해결: ① 콜백을 의존 대상보다 **뒤로 이동**, 또는 ② 의존 대상을 **ref 미러**로 읽고 deps에서 제외. 예: `handleAddItem`이 한참 뒤에 정의되는 `draftState`를 써야 해서 `draftStateRef`(미러 effect)로 읽는다.

## 2. ref 미러로 stale 클로저 회피
- 이벤트 핸들러/타이머는 최신 state를 `itemsRef`/`draftRef` 같은 ref 미러로 읽는다(`useEffect(() => { ref.current = state }, [state])`). setState 클로저의 stale 값을 피한다.

## 3. effect 내 동기 setState 린트
- `react-hooks/set-state-in-effect` 경고: effect가 동기로 setState. **deps에 자기 state가 없어 cascade 루프가 없으면 안전** → `// eslint-disable-next-line react-hooks/set-state-in-effect` + 이유 주석.
- disable 대신 **콜백으로 미루는 쪽이 대개 더 낫다**(린트는 "동기" 호출만 잡는다) — 실측→setState는 `requestAnimationFrame` 콜백에서(칩 폭 실측 같은 경우), 마운트 복원처럼 분기가 있어도 `Promise.resolve(...)`/`.then`으로 통일해 콜백에서 setState, 크기 변화는 `ResizeObserver` 콜백에서. 이때 **deps에 매 렌더 새 참조가 되는 배열(예: `filter`로 파생한 목록)을 넣으면 rAF→setState→렌더→rAF 무한 루프** — 파생 목록은 `useMemo`로 고정하고, updater에서 같은 값이면 `prev`를 그대로 돌려준다.
- 마운트 복원 이펙트가 `saved === null`이면 동기로 `setState`하는 식의 **분기 중 한쪽만 동기**인 형태도 린트에 걸린다 — 두 분기 모두 Promise로 감싼다.

## 4. 큰 상태 모델 변경 — 메인 state 오염 금지
- 새 데이터(예: 목록에 끼워 보여 줄 파생 항목)를 **기존 핵심 state에 합치지 말 것.** 그 state에 깔린 가정(예: `items`=현재 화면의 원본 목록)이 광범위하게 깨진다. 별도 state + 합성/분배 레이어로 둔다. (핵심 state에 합쳤다가 광범위 회귀로 되돌린 사례에서 나온 교훈.)

## 5. 낙관적 업데이트
- 서버 저장은 비동기·디바운스일 수 있다. 즉시 반영이 필요하면 권위 캐시(서버 사본)를 낙관적으로 먼저 수정 → 파생 렌더가 따라온다. 저장 후 서버 값으로 재동기화한다.

## 6. React Compiler — 수동 메모 불일치 = 빌드 실패
- `react-hooks/preserve-manual-memoization`: `useCallback`/`useMemo`의 **추론 deps ≠ 선언 deps**면 `npm run lint`/`build` 실패. 특히 핸들러가 setState만 호출하면 컴파일러가 **setter를 dep로 추론** → 선언 deps와 어긋남.
- 해결: 사소한 핸들러는 **plain 함수**로(컴파일러 자동 메모), 또는 deps 정렬. 다이얼로그·폼 핸들러에서 반복 발생한다.

## 7. useEffectEvent — "이펙트 내부" 최신값 읽기는 ref 미러 대신 이것 (React 19.2+)
- **이펙트 안**(타이머·구독 콜백 포함)에서 최신 state/props를 읽되 재구독을 원치 않으면 `useEffectEvent`로 뺀다 — deps에서 그 값이 빠져 인터벌/리스너가 유지된다. 적용례: 상태 폴링 — 목록 배열 identity·번역 함수 `t`가 deps에 있으면 목록 갱신·언어 전환마다 인터벌을 다시 걸고 즉시 재호출하게 된다.
- **이펙트 밖에선 호출 금지**(lint 강제) — 이벤트 핸들러/props로 전달 불가. **비이펙트 콜백**(§1 TDZ, §2 stale 클로저)의 최신값 읽기는 여전히 ref 미러가 정답.
- 반응해야 하는 값까지 빼면 안 됨 — 예: 폴링 시작/정지를 가르는 상태 값은 **파생값으로 좁혀 deps에 남긴다**(`selectedStatus`). identity가 변하는 배열 대신 실제 판단 기준을 dep로.

## 8. `<Activity>` — 함부로 쓰지 말 것 (React 19.2+)
- `mode="hidden"`은 state·DOM을 보존하지만 **이펙트를 정지**(cleanup 실행, 재표시 때 재실행). 탭 전환 시 state 소실을 막는 정석 도구지만, 아래 설계와 충돌할 수 있다:
  - **숨김 중에도 이펙트가 돌아야 하는 패널** — 접혀 있어도 fetch가 배지 숫자의 유일한 소스인 패널은 수동 `display:none`(hidden) 유지가 맞다. Activity로 바꾸면 배지가 멈춘다.
  - **의도적 강제 리마운트** — `key={version}`으로 캐시를 무효화하는 컴포넌트는 Activity 보존과 상충한다.
  - **Playwright strict mode** — 숨긴 패널이 DOM에 남아 텍스트/`data-testid` 셀렉터가 다중 매치 → 기존 스모크가 깨질 수 있다. 도입 시 해당 표면 스모크 전수 재실행 필수.
- 요약: 신규 탭형 UI에서 "전환 시 로컬 state 소실"이 실제 문제일 때만, 위 3함정을 점검하고 도입.

## 9. Tailwind display 유틸리티 이중 지정 금지 (`inline-flex` + `hidden`)
- 한 엘리먼트에 display 유틸리티 두 개를 같이 두면 어느 쪽이 이기는지는 **생성된 CSS의 순서**가 정한다 — 실측에선 `hidden`이 `inline-flex`에 졌고, "숨긴" 칩이 `overflow:hidden` 컨테이너에 잘린 채 그대로 보였다(Playwright `:visible` 카운트로만 발견).
- 규칙: display는 **조건부로 하나만** — `${shown ? "inline-flex" : "hidden"}`. 실측용으로 "렌더는 하되 숨김"이 필요하면 `hidden` 대신 `visibility`/`absolute` 오프스크린을 쓰거나, 실측 프레임엔 전부 보이게 두고 다음 프레임에 숨긴다(§3 rAF 패턴).
- 같은 이유로 `flex`+`hidden`, `block`+`hidden`도 금지. 조건부 렌더(`{cond && ...}`)가 가능하면 그쪽이 가장 안전하다.

## 10. 직접 만든 CSS 클래스 이름이 Tailwind 유틸리티와 겹치지 않게
- Tailwind v4는 소스에 나온 낱말이 유틸리티 이름이면 그 규칙을 만든다. 접기 부품에 `.collapse`를 붙였더니 유틸리티 `collapse`(`visibility: collapse`)가 utilities 층에서 이겨 펼친 내용이 끝내 안 보였다(SOP 스모크의 "숨은 요소" 타임아웃으로만 발견, 2026-11-09).
- 규칙: `components.css`·`motion.css`에 새 클래스를 만들 때 Tailwind 유틸리티 이름(`collapse`·`hidden`·`block`·`contents`·`truncate`·`container`·`static` 등)과 겹치는지 먼저 본다. 이 저장소의 접기는 `.fold`다.

## 11. 표 칸의 `truncate`·nowrap은 표를 옆으로 민다 — 남은 폭 열은 `max-width: 0`
- 자동 배치 표(`table-layout: auto`)는 칸 내용의 최소 폭을 열 폭 하한으로 쓴다. `truncate`(nowrap)나 공백 없는 긴 글이 든 칸은 말줄임되지 않고 표 전체를 넓혀, 1120px에서 문서 표 오른쪽 열이 화면 밖으로 나갔다(긴 파일 이름 worst case로만 발견, 2026-11-09).
- 규칙: 긴 글이 들어오는 열은 `DataList` 열의 `grow`(`.dl-grow` = `width:100%; max-width:0; overflow-wrap:anywhere`)로 두고 최소 폭은 `minWidth`로 준다. `overflow-wrap: anywhere`를 모든 칸에 걸면 안 된다 — 최소 폭이 한 글자가 되어, grow 열이 폭을 가져갈 때 짧은 열(작업 이름 등)이 한 글자씩 세로로 접힌다(배치 표 worst case). 일반 칸은 `break-word`다. grid 카드 안에서도 같은 일이 생기므로 트랙은 `minmax(0, 1fr)`로 둔다.
- `@layer components` 규칙은 Tailwind 유틸리티(`truncate`·`block`)를 특이도와 상관없이 이기지 못한다. 유틸리티를 덮어야 하는 좁은 규칙(카드 제목 두 줄 자르기)은 층 밖에 둔다.
