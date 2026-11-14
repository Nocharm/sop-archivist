# EQUIS 문서 번호 조회 1단계 (표시와 제목) — 설계

브레인스토밍 2026-11-13, 결정 2026-11-14. 브랜치 `feat/equis-lookup`(dev v1.0.0에서). 이 문서에서 "사용자 결정"은 사용자가 정한 것이고 "내 판단"은 맡겨진 것이다. 예시 값은 모두 합성이고 실제 주소는 `<equis-host>` · `<n8n-host>`로 적는다.

- 화면 미리보기(사용자 확인본): https://claude.ai/artifact/3LWhWcwAaMnX9hQAfFenG2 (비공개 Artifact)
- 전체 순서: https://claude.ai/artifact/5Hfq4742D97TuzEBQB5abj (비공개 Artifact)
- 함께 가는 명세: `2026-11-14-four-step-workflow-design.md`. 이 명세는 EQUIS 연동의 1단계다. 2단계(REF 문단)와 3단계(결과물·Excel)는 워크플로우 개편 뒤에 따로 쓴다(§13).
- 판단 기준: 제품 명세 `2026-11-05-sop-restructuring-e2e-design.md` §3(비목표)·§6.2(문서 필드).

## 1. 왜

업로드 때 읽은 번호·버전·제목이 맞는지 확인할 기준이 앱에 없다. 그래서 세 가지를 모른다. 올린 파일이 EQUIS에서 시행 중인 판인지, 재구성하는 사이에 원본이 개정되고 있지 않은지, 폐기된 문서를 올리지 않았는지.

EQUIS 문서 정보는 사내 EDW에 있고 n8n으로 닿는다. 번호로 조회해 화면에 표시하고, EQUIS에 있는 문서의 제목은 EQUIS를 따르게 한다.

## 2. 목표 · 비목표 · 실패로 보는 것

**목표**
- 옛 문서와 새 문서(올린 새 문서, To-Be 줄)의 번호를 조회해 줄마다 EQUIS 표시를 붙인다.
- 받은 정보를 담아 두고 펼쳐 보인다. EQUIS 원본으로 가는 링크를 둔다.
- EQUIS에 있는 문서는 제목이 EQUIS 이름을 따르고 앱에서 고칠 수 없다.
- 옛 번호(Legacy)로 적힌 문서를 지금 문서까지 따라간다.

**비목표**
- EQUIS에 쓰기. 읽기만 한다.
- EQUIS 목록 미러, 번호·제목 검색. 번호 하나씩 그때그때 묻는다(사용자 결정 2026-11-13). 제품 명세 §3의 "사내 SOP DB 전체 검색"은 여전히 범위 밖이다.
- REF 문단, 본문 속 문서 번호, 결과물·Excel 연동(§13).
- AI 요청에 EQUIS 정보 싣기.
- 실명 보관. 소유 부서까지만 담는다.

**실패로 보는 것**: 조회 결과나 조회 실패 때문에 업로드·저장·검토 요청이 막히는 것. 설정이 빈 서버에서 화면이 v1.0.0과 달라지는 것. 사람 이름이 DB나 로그에 남는 것. 번호 일부만 겹치는 다른 문서를 같은 문서로 잇는 것.

## 3. 조사로 확인한 것 (dev `bc0b614`, db-viewer 저장소)

- 번호가 들어오는 곳은 `Document.doc_code`(100자)와 `TargetDoc.code`다. 올린 새 문서의 번호를 고치면 To-Be 줄 번호도 함께 바뀐다(`tobe.rename_match_doc`). 번호가 없는 올린 새 문서에는 앱이 임시 번호 `NEW-<문서 id>`를 붙인다(`tobe.temp_match_code`).
- `Document.title`은 업로드 때 파일 이름에서 읽은 값이다(`ingest.py`의 `parsed.title`). 문서 화면에서 `InlineText`로 고치고, 같은 글자가 Split 화면으로 가는 링크다(`href=/bundles/{id}/split?doc={id}`).
- 결과물과 스냅숏은 `document.title` · `TargetDoc.title`을 그대로 읽는다(`outputs.py`, `snapshot.py`).
- 문서 화면은 한 건씩 `PATCH /api/bundles/{id}/documents/{doc_id}`로 저장한다. To-Be는 초안을 고친 뒤 목록 전체를 `PUT /api/bundles/{id}/tobe`로 저장한다.
- 백그라운드 큐는 `ai_jobs` 하나고 워커는 AI나 임베딩이 켜졌을 때만 뜬다(`main.py` lifespan). EQUIS 조회를 여기에 태우면 AI가 꺼진 서버에서 돌지 않는다.
- HTTP 클라이언트는 `httpx2`다(`app/hr/client.py`가 본보기: `_post`, 시간 제한 상수, 테스트는 `_post` 바꿔치기).
- 마지막 Alembic 리비전은 `0015_decision_steps`다.
- **조회 창구는 이미 있다**(사용자 결정 2026-11-14: db-viewer가 쓰는 n8n 길을 쓴다). db-viewer의 W2 워크플로 `dbv-query`가 `table_preview`에서 조건 조회를 받는다.
  - 요청 `POST <n8n-host>/webhook/dbv-query`, 본문 `{kind: "table_preview", schema, table, limit, filters: [{column, op, value}]}`. `op`는 `eq` · `neq` · `contains` · `not_contains` · `is_null` · `not_null`, 조건은 AND로만 묶인다.
  - 응답 `{query, rows}`. 구버전 W2는 행 배열만 돌려준다. 0건은 빈 객체 하나로 올 수 있다.
  - `SELECT *`라 표의 모든 칸이 온다. 인증 헤더는 없다. 값은 n8n이 작은따옴표를 이스케이프해 SQL에 넣는다.
- EDW 표 `EQUIS_DOCUMENT`는 문서의 판마다 한 줄이다. 받을 칸과 함정은 인계서 7절에 있고 §6에 옮겼다.
- 디자인 규칙: 상태 라벨은 두 언어 모두 영어, 상태는 색만으로 나타내지 않는다, `accent`는 사람이 확정한 것 전용, 끝난 일은 조용해진다(디자인 기초 §10·§11).

## 4. 사용자에게 보이는 것

### 4.1 EQUIS 표시

문서 화면의 Old·New 줄과 To-Be 줄에 붙는다. 라벨은 판정보다 사실을 먼저 말한다.

| 표시 | 때 | 모양 |
|---|---|---|
| `Current · Effective 6.0` | 올린 판이 지금 판 | 체크 아이콘, `ink-3`(조용히) |
| `Current · Effective 14.0 · 14.2 In Review` | 지금 판이고 검토 중인 다음 판이 있다 | 위와 같고 뒤에 정보만 붙는다 |
| `Check · Not current, 14.0 Effective` | 올린 판이 지금 판이 아니다 | 경고 아이콘, `warn-ink` |
| `Check · 15.0 Authorized` | 다음 판이 승인돼 곧 시행된다 | 〃 |
| `Check · Obsolete 2018-11-21` | 폐기·철회된 문서 | 〃 |
| `In EQUIS · Effective 14.0` | 새 문서의 번호가 EQUIS에 있다 | 체크 아이콘, `ink-3` |
| `Not in EQUIS` | 사람이 넣은 번호가 EQUIS에 없다 | 점선 원, `ink-4` |
| `–` | 번호가 비었거나 앱의 임시 번호 | 자리만 지킨다 |
| `Looking up` | 조회 중 | 최종 표시와 같은 폭의 스켈레톤 |
| `Lookup failed` + **Retry** | 조회가 응답하지 않았다 | 중립 아이콘, 줄 끝 단추 |

- "Verified"·"확인됨"은 쓰지 않는다. 승인처럼 읽힌다(디자인 규칙: 승인을 암시하지 않는다).
- 표시가 무엇이든 업로드·저장·검토 요청은 그대로 된다(사용자 확인 2026-11-13: 막지 않는다).
- 옛 문서의 번호가 옛 번호(Legacy)면 `Check · Old number, now SOP-ABC-00001`과 **Use current number** 단추를 보인다. 누르면 번호 칸이 바뀐다(사람이 누른다, 내 판단).

### 4.2 펼친 정보

표시를 누르거나 포커스에서 `↵`를 누르면 그 자리에 팝오버가 열린다. Name, Subtype, Current(판·상태·시행일), In progress(판·상태 목록), Owning dept., Plant, Area, Legacy no., Equipment tag(있을 때), Looked up(KST)와 "EDW 기준이라 EQUIS 화면보다 늦을 수 있다" 한 줄, 작성자에게는 **Look up again**.

### 4.3 제목 (사용자 결정 2026-11-14)

- EQUIS에서 찾은 문서는 제목이 **가장 높은 승인 판의 이름**이다. Draft는 뺀다(사용자 결정). In Review · In Approval도 승인 전이라 뺀다(내 판단). Authorized · Effective · Approved · Final · Superseded · Obsolete · Withdrawn 가운데 판 번호가 가장 큰 줄의 이름을 쓴다. 옛 문서와 새 문서에 같은 규칙을 쓴다.
- 잠긴 제목에는 연필 대신 자물쇠가 같은 자리에 붙는다. 툴팁은 "제목은 EQUIS에서 바꾸세요. 반영까지 하루 걸릴 수 있습니다"(en·ko)다. 새 문서와 To-Be 줄도 번호가 EQUIS에 있으면 잠긴다(사용자 결정).
- 번호와 버전은 계속 고칠 수 있다. 번호는 무엇을 찾을지 정하고, 버전은 올린 파일이 어느 판인지 적는 칸이다.
- 잠기지 않는 때: `Not in EQUIS`, 임시 번호, 한 번도 조회에 성공하지 못한 문서, 기능이 꺼진 서버. 조회 중에는 잠깐 잠근다(조회가 끝나며 제목이 바뀔 수 있어서, 내 판단).
- 번호를 EQUIS에 없는 것으로 고치면 잠금이 풀린다. 제목 글자는 마지막 EQUIS 이름으로 남고 사람이 고칠 수 있다.
- 조회가 실패해도 전에 찾았던 문서는 마지막 이름과 잠금을 유지한다.

### 4.4 링크

- 제목을 누르면 지금처럼 그 문서의 쪼개기 화면으로 간다(내 판단 — 2026-11-13의 "제목에 EQUIS 링크"는 제목이 이미 링크라는 사실과 부딪친다. 사용자가 계획에서 받아들였다).
- EQUIS 링크는 제목 바로 옆 아이콘이다. `<a href target="_blank" rel="noopener noreferrer">`, 주소는 `<EQUIS_DOC_URL_BASE>/ui/#doc_info/<문서 ID>`(문서 링크, EQUIS가 최신 판으로 연다). EQUIS에서 찾은 줄에만 있다.
- To-Be 줄은 번호 칸 옆에 표시와 같은 아이콘을 둔다.

### 4.5 To-Be

- 저장한 번호만 조회한다. 고치는 중인 줄은 저장 전 번호의 표시를 흐리게 둔다.
- 새 문서는 폐기만 `Check`로 본다(§6.4). EQUIS에 없는 것은 경고가 아니다.
- 잠긴 줄의 제목 입력 칸은 읽기 전용이 되고 자물쇠와 같은 툴팁을 단다.

## 5. 조회 창구

- 설정 셋(`app/settings.py` · `.env.example` · `docker-compose.yml` backend `environment:` · `docs/deploy/setup-once.md` env 표).
  - `N8N_QUERY_URL` — `dbv-query` 웹훅의 전체 주소. 예 `http://<n8n-host>:5678/webhook/dbv-query`.
  - `EQUIS_EDW_TABLE` — 스키마를 포함한 표 이름. 예 `<schema>.EQUIS_DOCUMENT`.
  - `EQUIS_DOC_URL_BASE` — 링크 앞부분. 예 `https://<equis-host>`.
  - 셋 중 하나라도 비면 기능이 꺼진다(`settings.equis_enabled`). 꺼진 서버는 EQUIS 칸과 아이콘, 자물쇠가 아예 없다.
- 번호 하나에 요청 둘이다(조건이 AND뿐이라 OR을 못 쓴다).
  1. `filters: [{column: "DOC_DOCUMENT_NUMBER", op: "eq", value: <번호>}]`
  2. `filters: [{column: "DOC_LEGACY_DOCUMENT_ID", op: "contains", value: <번호>}]`
  - `limit`은 500. 500줄이 꽉 차 오면 잘렸다고 보고 경고를 기록한다.
- **보내기 전 검사.** 번호는 앞뒤 공백을 떼고 대문자로 바꾼 뒤 `^[A-Z0-9][A-Z0-9 ./_-]{1,99}$`에 맞을 때만 보낸다. 맞지 않으면 묻지 않고 `Not in EQUIS`로 둔다. 표 이름은 설정값만 쓴다. 사용자 입력이 표·칸 이름에 들어가지 않는다.
- **받는 자리에서 버린다.** 응답 줄에서 §6.1의 칸만 뽑고 나머지는 그 자리에서 버린다. 소유자·작성자·만든 사람·고친 사람 칸은 DB에도 로그에도 예외 메시지에도 남기지 않는다(내 판단 — 인계서는 웹훅에서 빼자고 했지만 있는 길은 모든 칸을 준다. 사용자 확인이 남았다, §14).
- 시간 제한 10초, 다시 시도 한 번, 그 뒤 마지막 오류를 올린다. 로그에는 번호·상태 코드·줄 수만 남기고 주소는 남기지 않는다.
- 응답 모양 셋을 모두 받는다: `{query, rows}`, `[{query, rows}]`, 행 배열. 빈 객체 줄은 버린다. `message`만 있는 객체는 실패로 본다(db-viewer `n8n_query.py`가 본보기).
- 이 워크플로는 db-viewer 소유다. 그쪽이 바뀌어 조회가 실패하면 `Lookup failed`로만 보이고 다른 동작은 그대로다.

## 6. 판정 규칙 (순수 함수, `app/equis/rules.py`)

### 6.1 받는 칸

`DOC_DOCUMENT_NUMBER` · `DOC_DOCUMENT_ID` · `DOC_VERSION` · `DOC_DOCUMENT_STATUS` · `DOC_LIFECYCLE` · `DOC_DOCUMENT_NAME` · `DOC_SUBTYPE` · `DOC_OWNING_DEPARTMENT` · `DOC_PLANT` · `DOC_AREA` · `DOC_LEGACY_DOCUMENT_ID` · `DOC_EQUIPMENT_TAG_NO` · `DOC_EFFECTIVE_DATE_KST` · `DOC_APPROVED_DATE_KST` · `DOC_SUPERSEDED_DATE_KST` · `DOC_OBSOLETE_DATE_KST` · `DOC_WITHDRAWN_DATE_KST`.

- 값은 글, 불리언, 숫자, null이 섞여 온다. 글로 맞춘 뒤 다룬다. 번호·문서 ID·판·상태·생애주기가 없는 줄은 버리고 경고를 기록한다.
- `LATEST_VERSION__V`는 받지 않는다. 한 문서에 True가 여러 줄이라 믿을 수 없다.
- `_KST` 날짜는 앞 10글자만 KST 날짜로 읽는다. UTC로 바꾸지 않는다.

### 6.2 판 읽기

- EDW `DOC_VERSION` `"14.1"` → (14, 1).
- 앱 `doc_version`은 `3` · `v3` · `Ver 1.1` · `Rev. 2` 꼴이다. 첫 숫자 묶음을 뽑아 `3` → (3, 0), `1.1` → (1, 1). 읽지 못하면 판 비교를 하지 않는다.

### 6.3 문서 하나의 사실

- **끝 상태**: 생애주기로 정한다. `Draft to Effective Lifecycle` → Effective, `Draft to Approved Lifecycle` → Approved, `Initial to Final Lifecycle` → Final. 모르는 생애주기는 Effective·Approved·Final 가운데 실제로 있는 상태를 쓴다.
- **지금 판**: 상태가 끝 상태인 줄 중 판이 가장 큰 줄. 없을 수 있다.
- **폐기**: 판이 가장 큰 줄의 상태가 Obsolete 또는 Withdrawn.
- **진행 중인 판**: 지금 판보다 판이 큰 줄. 시행일이 적혀 있어도 상태로만 판단한다. 지금 판보다 작은 Draft·In Review는 밀려 남은 초안이라 버린다.
- **이름**: §4.3의 가장 높은 승인 판의 이름. 승인 판이 하나도 없으면(Draft만 있는 새 문서) 이름이 없고 제목을 잠그지 않는다.
- **문서 정보**(하위 종류·소유 부서·Plant·Area·Legacy·장비 태그): 이름을 고른 줄의 값.

### 6.4 줄의 판정

입력은 문서의 사실, 줄의 쪽(old | new), 앱 `doc_version`.

| 쪽 | 조건 | 결과 |
|---|---|---|
| old | 폐기 | `attention` · `retired` |
| old | 앱 판이 읽히고 지금 판과 다르다 | `attention` · `version_mismatch` |
| old | 지금 판보다 큰 Authorized 판이 있다 | `attention` · `newer_authorized` |
| old | 지금 판이 없고 폐기도 아니다 | `attention` · `no_current` |
| old | 위에 걸리지 않는다 | `ok`. 지금 판보다 큰 In Review · In Approval은 정보로만 붙인다 |
| new | 폐기 | `attention` · `retired` |
| new | 그 밖 | `in_equis`. 가장 높은 승인 판을 사실로 보인다 |

- 이유는 여러 개가 함께 붙을 수 있고 표시에는 위 순서로 첫 이유를 쓴다.
- 진행 중인 판을 Authorized만 경고하는 것은 내 판단이다. 인계서는 In Review · In Approval도 경고하자고 했지만, 개정이 잦은 SOP가 늘 경고로 보인다. Draft는 펼친 정보에만 보인다.

## 7. 옛 번호 따라가기 (사용자 결정 2026-11-14: 여러 번 바뀐 경우까지)

- 물은 번호 N에 대한 두 응답의 줄을 `DOC_DOCUMENT_ID`로 묶는다.
- 번호가 N인 문서가 있으면 그것이 **맞은 문서**다.
- Legacy 칸을 ` / `로 나눈 조각 가운데 N과 정확히 같은 것이 있는 문서가 **이어받은 문서**다. `contains`는 일부만 겹쳐도 돌려주므로 조각이 정확히 같을 때만 인정한다.
- 따라가기: 맞은 문서가 있고 폐기되지 않았으면 거기서 멈춘다(살아 있는 문서의 번호가 다른 문서의 Legacy 칸에 적혀 있어도 넘어가지 않는다). 맞은 문서가 없거나 폐기됐을 때, 이어받은 문서가 하나면 그 문서의 번호로 다시 묻고 되풀이한다. 이어받은 문서가 없으면 멈춘다. 지금 서 있는 문서가 **지금 문서**다.
- 다섯 번까지만 따라간다. 이미 지난 문서 ID가 다시 나오면 멈춘다. 이어받은 문서가 둘 이상이면 고르지 않고 멈춘 뒤 후보를 담는다(`ambiguous`).
- 맞은 문서도 이어받은 문서도 없으면 `not_found`다.
- 결과에 지난 길(번호 목록)과 지금 문서를 함께 담는다. 물은 번호와 지금 문서의 번호가 다르면 "옛 번호"다.
- 이 함수는 2단계(REF 문단)가 그대로 쓴다.

## 8. 서버 설계

### 8.1 표 (Alembic `0016_equis_lookups`)

`equis_lookups` — 번호별 사실. 판정은 담지 않는다(같은 번호라도 줄의 쪽과 올린 판에 따라 판정이 다르다).

| 칸 | 내용 |
|---|---|
| `doc_number` (PK, 100자) | 다듬은 번호 |
| `state` | 마지막으로 끝난 조회의 결과. `pending`(한 번도 끝나지 않음) · `found` · `not_found` · `unavailable`. 다시 묻는 중인지는 `requested_at`이 `fetched_at`보다 새로운지로 안다(응답의 `refreshing`). 그래서 다시 조회하는 동안에도 있던 값이 그대로 보인다 |
| `facts` (JSON) | 지금 문서의 문서 ID, 번호, 이름, 문서 정보, 판 목록(판·상태·날짜), 지난 길, `ambiguous` 후보 |
| `requested_at` · `fetched_at` | 조회 요청·완료 시각 |

- 다른 표는 바꾸지 않는다. 문서와 To-Be 줄은 자기 번호로 이 표를 읽는다. 번호를 고치면 표시가 저절로 따라가고, 같은 번호를 여러 묶음이 써도 한 번만 묻는다.
- 조회가 실패하면 `state`만 `unavailable`로 바꾸고 `facts`는 지우지 않는다.

### 8.2 조회 흐름

- 조회 요청이 생기는 때: 업로드로 번호가 채워졌을 때, 문서 PATCH로 `doc_code`가 바뀌었을 때, To-Be PUT으로 번호가 새로 생기거나 바뀌었을 때, **Retry**·**Look up again**, 그리고 목록을 읽을 때 `fetched_at`이 24시간을 넘었을 때(내 판단 — 재구성 중의 개정을 잡고, EQUIS에서 바꾼 제목을 따라가려면 필요하다. 사용자가 계획에서 받아들였다).
- 저장 뒤 그 번호의 줄을 만들거나 `requested_at`을 올리고(조회 중이면 건너뛴다), 커밋 뒤 FastAPI `BackgroundTasks`로 조회한다. `ai_jobs`를 쓰지 않는다. 이미 받아 둔 번호면 묻지 않고 그 이름으로 제목을 바로 맞춘다.
- 실패한 조회(`unavailable`)는 10분이 지나면 목록을 읽을 때 다시 시도한다.
- 빈 번호와 `NEW-<숫자>`는 묻지 않는다.
- `requested_at`이 60초를 넘은 `pending`은 읽을 때 `unavailable`로 본다(서버가 재시작돼 남은 것). 정리 작업을 두지 않는다.
- 버전만 고친 PATCH는 묻지 않는다. 판정만 다시 계산된다.

### 8.3 제목 따라가기

- 조회가 `found`로 끝나고 이름이 있으면, 그 번호를 쓰는 `Document.title`과 `TargetDoc.title`을 이름으로 바꾼다. 값이 달라진 줄에 `document.update` · `tobe.update` 이벤트를 행위자 `system:equis`로 남긴다(내 판단 — 결과물이 같은 칸을 읽으므로 화면만 바꾸면 어긋난다. "사람이 저장하기 전에는 칸을 바꾸지 않는다"에 제목만 예외다. 사용자가 계획에서 받아들였다).
- **revision은 올리지 않는다**(구현하며 정함). 조회는 사람의 저장 바로 뒤에 끝나므로, 올리면 그 사람이 이어서 버전이나 다른 줄을 저장할 때 `revision_conflict`가 난다. 제목은 EQUIS가 주인이라 사람의 다른 칸과 다투지 않게 한다.
- 묶음이 작업 중(`in_progress`)일 때만 바꾼다. 검토 중이거나 끝난 묶음의 제목은 건드리지 않는다.
- 잠긴 제목을 고치려는 문서 `PATCH`는 409 `title_locked`로 거절한다. `rule.title_locked` 문구를 en·ko로 넣는다.
- To-Be `PUT`은 **거절하지 않는다**(구현하며 정함). 화면 초안에 옛 제목이 남아 있을 수 있어서, 잠긴 줄에 다른 제목이 와도 저장한 뒤 EQUIS 이름으로 되돌린다.
- 잠금 조건: 첫 조회가 도는 중이거나, `not_found`가 아니고 `facts`에 이름이 있을 때. 기능이 꺼져 있으면 잠그지 않는다.

### 8.4 API

- 문서 목록·단건 응답과 To-Be 응답의 줄마다 `equis`를 더한다(`app/equis/view.py` `EquisOut`): `state`, `refreshing`, 판정(`verdict`, `reasons`, `notes`), 표시용 사실(`current`, `in_progress`, `retired`, 문서 정보), `number`(지금 번호)와 `trail`, `ambiguous`, `doc_url`, `title_locked`, `fetched_at`. 물은 번호가 옛 번호면 `reasons` 맨 앞에 `old_number`가 붙는다. 기능이 꺼졌거나 묻지 않는 번호(빈 칸·임시 번호)면 `equis`는 `null`이다.
- 펼친 정보는 같은 응답에 싣는다(줄마다 몇백 바이트다, 내 판단).
- `POST /api/bundles/{id}/equis/refresh` 본문 `{document_number}`. 그 번호가 이 묶음의 문서나 To-Be 줄에 있을 때만 받는다(없으면 404). 작성자·작업 중만(`require_bundle_role("author")` · `ensure_editable`). `fetched_at`이 30초 안이면 다시 묻지 않고 지금 값을 돌려준다.
- 읽기는 묶음 멤버 모두.
- `frontend/src/lib/api-sop.ts`의 타입을 손으로 맞춘다.

### 8.5 파일 배치

`backend/app/equis/` — `client.py`(웹훅 호출과 응답 다듬기), `rules.py`(§6·§7 순수 함수), `service.py`(조회 요청, 결과 저장, 제목 따라가기, 여러 번호 한 번에 읽기), 모델은 `app/sop/models.py` 옆 규칙을 따른다. 라우터 `routers/sop_equis.py`.

## 9. 화면 조각과 사용성 기준 (사용자 요구 2026-11-14)

조각으로 만든다. 문서 화면과 To-Be 화면의 배치는 워크플로우 개편이 정하고, 이 명세는 그 안에 꽂히는 것만 만든다.

- `EquisStatus`(표시와 펼친 정보), `EquisLink`(제목 옆 아이콘), `TitleLock`(자물쇠), 잠긴 제목은 `InlineText`의 `editable`을 끈다(`components/equis/`).
- **자리(사용자 결정 2026-11-14: 추천안)**: 문서 화면은 제목 아래 파일 이름 줄의 오른쪽 끝이다. 표의 열 폭이 재어 맞춘 값이라 열을 늘리지 않고, 줄 높이도 그대로다. 좁으면 파일 이름이 먼저 줄고(최소 96px) 그다음 표시가 말줄임된다. To-Be는 번호 칸 옆에 아이콘만 두고 글은 툴팁과 펼친 정보로 옮긴다(목록 줄의 정상 상태는 아이콘만 둔다는 디자인 기초 §11). 두 화면의 배치는 워크플로우 개편에서 다시 짠다.
- **튀지 않는다.** EQUIS 칸은 고정 폭이다. 조회 중 스켈레톤이 최종 표시와 같은 크기고 150ms 안의 응답에는 스켈레톤이 없다. 자물쇠는 연필과 같은 자리·같은 크기다. 제목이 EQUIS 이름으로 바뀔 때 줄 높이가 변하지 않는다(긴 이름은 지금처럼 한 줄에서 자르고 툴팁으로 전체를 본다).
- **손을 덜 옮긴다.** EQUIS 아이콘은 제목 바로 옆, 팝오버는 표시에 붙여 띄우고 화면 안으로 맞춘다. **Retry**는 그 줄 끝, **Use current number**는 표시 바로 옆이다.
- **조용하다.** `ok`와 `in_equis`는 `ink-3`이다. 색은 `Check`에만 쓴다. `accent`를 쓰지 않는다.
- **색만으로 구분하지 않는다.** 아이콘, 선 모양, 라벨을 함께 쓴다.
- **키보드.** 표시는 포커스를 받고 `↵`·`Space`로 펼친다. `Esc`로 닫고 포커스는 표시로 돌아간다. 새 전역 단축키는 만들지 않는다.
- **움직임.** 팝오버는 기존 토큰(`--dur-base` · `--ease-enter` · `--rise`)으로, 포인터로 열 때만 움직인다. 제목이 EQUIS 이름으로 바뀌는 순간 그 줄의 제목이 한 번 번쩍여 바뀐 것을 알린다. 움직임 줄이기 설정이면 없다.
- **다시 읽기.** 목록에 `pending`이 있는 동안만 2초 간격으로 다시 읽고, 다시 읽는 동안 표를 비우지 않는다. 30초가 지나면 멈춘다.
- 툴팁은 150ms 지연, 네이티브 `title`을 쓰지 않는다. `data-testid`는 `documents-<id>-equis` · `documents-<id>-equis-link` · `documents-<id>-equis-retry` · `tobe-<key>-equis` 꼴.

## 10. 검증

- **규칙(먼저 시험)** `tests/test_equis_rules.py` — 합성 줄로: True가 여러 줄인 최신판 표시를 무시한다, 시행일이 적힌 Draft를 시행 판으로 보지 않는다, 밀려 남은 초안을 버린다, Obsolete와 Withdrawn, 생애주기 셋, 판 번호 꼴(`3` · `v3` · `Ver 1.1` · `Rev. 2` · 읽지 못함), `_KST` 날짜, 승인 판과 초안의 이름이 다를 때 승인 판 이름, Draft만 있는 문서는 이름 없음, old·new 판정 표 전부.
- **따라가기** — 한 번 바뀐 번호, 세 번 바뀐 번호, 한 칸에 옛 번호가 여러 개, 서로 물고 도는 경우, 이어받은 문서 둘, 번호 일부만 겹치는 다른 문서(`SOP-ABC-1016`과 `SOP-ABC-10160`), 다섯 번 상한.
- **클라이언트** `tests/test_equis_client.py` — `_post` 바꿔치기로 응답 모양 셋, 빈 객체 줄, `message` 봉투, 시간 초과, 5xx, 500줄 상한, 번호 검사에서 걸러지는 입력(작은따옴표·세미콜론·한글), **이름 칸이 반환값에 없다**.
- **API** — 설정이 비면 응답이 v1.0.0과 같다. 웹훅이 실패해도 업로드·PATCH·PUT이 성공한다. 버전만 고치면 웹훅을 부르지 않는다. 같은 번호를 두 묶음이 써도 한 번 묻는다. 다른 묶음의 번호는 refresh 404. 검토자의 refresh 403. 잠긴 제목 PATCH 409 `title_locked`. 번호를 EQUIS에 없는 것으로 바꾸면 제목 PATCH가 다시 된다. 검토 중인 묶음의 제목은 조회가 끝나도 바뀌지 않는다. DB와 로그 캡처에 이름 칸 값이 없다.
- **마이그레이션** — `alembic upgrade head`와 `downgrade -1`.
- **화면** — `frontend/scripts/fake-equis-webhook.mjs`(합성 응답, `fake-ai-server.mjs`가 본보기)를 띄우고 브라우저에서 §4.1의 모든 표시, 조회 중, 잠긴 제목, 팝오버, Retry를 본다. vitest로 조각의 표시 규칙. `pw-layout-audit`(DS=worst) · `pw-overlap-audit` · `pw-contrast-audit`, 1366 폭.
- 기존 게이트: `pytest -n auto`, `ruff`, `npm run lint`, `tsc --noEmit`, `vitest run`, `npm run build` 경고 0.
- 합성 자료만 쓴다. 실제 번호·이름·ID·주소를 시험·시드·문서에 넣지 않는다.

## 11. 함께 고치는 문서

- 제품 명세 §6.2에 EQUIS 조회와 제목 규칙을 더한다. §3 비목표는 그대로다.
- 사용 설명서 `frontend/public/manual/user-manual.md`의 Documents·To-Be 조각과 그림.
- 배포 런북 `docs/deploy/setup-once.md`의 env 표.
- `CHANGELOG.md` `Unreleased (dev)`, `PROGRESS.md`, `frontend/package.json` `version` PATCH.

## 12. 구현에 맡기는 것

- `facts` JSON의 정확한 열쇠 이름과 판 목록에 담을 날짜 칸.
- 번호 하나의 두 요청을 차례로 할지 함께 할지.
- 팝오버를 기존 공통 부품 가운데 무엇으로 만들지.
- 제목 번쩍임의 구현(기존 번쩍임 클래스를 다시 쓴다).
- `BackgroundTasks`에서 세션을 여는 방식(`SessionLocal`).

## 13. 다음 단계 (이 명세에 없음)

- **2단계 REF 문단** — 워크플로우 개편의 쪼개기&배정 화면이 끝난 뒤. 앱이 문서 번호 영역을 제안하고, 그 문단을 결정하기 전에 사람이 번호 영역만 확인한다. 새 문서로 보낼 때 지금 번호와 정식 이름으로 맞춘 글을 제안하고, 새 문서에서 타입·번호·제목이 어긋나면 작은 주의를 붙인다(사용자 결정 2026-11-14). 참조 줄은 보통 한 줄이고 문서명은 영어다(사용자 확인). 번호 수십 개를 한꺼번에 묻게 되면 그때 묶음 조회를 검토한다.
- **3단계 결과물·Excel** — Document Relationships와 문서 정보 칸.

## 14. 결정 기록

**사용자 결정**
- 그때그때 조회, 옛·새 문서 번호 대상, 받을 수 있는 정보 담기, EQUIS 링크(2026-11-13).
- EQUIS에 있는 문서는 제목을 고칠 수 없다. 새 문서도 같고 "EQUIS에서 바꾸라, 갱신에 하루 걸릴 수 있다"를 안내한다(2026-11-14).
- 제목은 가장 높은 승인 판, Draft 제외(2026-11-14).
- 가져올 수 있는 정보는 잇는다(2026-11-14).
- n8n은 db-viewer가 쓰는 길을 쓴다(2026-11-14).
- 옛 번호가 여러 번 바뀐 경우를 따라간다(2026-11-14).
- 사용성과 사용자 경험을 좋게 유지한다(2026-11-14).

**내 판단 — 사용자가 계획에서 받아들인 것**
- 조회 결과는 막지 않는다. 판정은 줄마다 계산한다. `ai_jobs`를 쓰지 않는다.
- 제목은 지금처럼 쪼개기 화면으로 가고 EQUIS는 옆 아이콘.
- 하루 지난 값은 다시 조회한다. 진행 중인 판은 Authorized만 경고한다. 상태 라벨은 영어다.
- 조회가 찾으면 저장된 제목을 바꾼다(작업 중인 묶음만).

**확인이 남은 것**
- 이름 칸이 앱까지 왔다가 받는 자리에서 버려지는 방식이 괜찮은지. 두 번 물었고 아직 답이 없다. 안 된다면 db-viewer의 W2에 칸을 고르는 전용 조회를 더해야 한다.
- EQUIS 문서 표의 정확한 이름과 EQUIS 주소 앞부분. 서버 `.env`에만 넣는다.
- EDW 적재 주기. "하루 걸릴 수 있습니다"와 24시간 갱신이 여기에 달려 있다.
- Legacy 칸 `contains` 조회가 실제 표에서 얼마나 걸리는지. 느리면 n8n 쪽에 전용 조회를 더하는 일을 db-viewer와 상의한다.
