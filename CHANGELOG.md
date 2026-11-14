# Changelog

SOP Archivist 서비스 버전 기록. 단일 소스는 `frontend/package.json` `version`(SemVer)이다. `dev`에 올릴 때마다 PATCH를 올려 아래 `Unreleased (dev)`에 적고, `dev`→`main` 정식 업데이트 때 MINOR를 올려 그 줄들을 릴리스 항목 하나로 모으고 `vX.Y.Z` 태그를 단다(`rules/common/git.md` "서비스 버전"). 운영 서버 배포 여부와 날짜도 해당 항목에 적는다.

## Unreleased (dev)

- **v1.0.1 — 2026-11-14** — **EQUIS 문서 번호 조회(1단계)**: 문서 번호가 있으면 사내 EDW의 EQUIS 문서 표에서 조회해 **Documents** 의 파일 이름 줄 오른쪽 끝과 **To-Be** 의 번호 칸 옆에 표시를 붙인다 — **Current**(올린 판이 지금 판), **Check**(지금 판이 아님·다음 판 Authorized·폐기·옛 번호), **In EQUIS**, **Not in EQUIS**, **Looking up**, **Lookup failed**(+ **Retry**). 표시를 누르면 정식 이름·지금 판과 시행일·진행 중인 판·소유 부서·Plant·Area·옛 번호·조회 시각이 펼쳐지고 **Open in EQUIS** · **Look up again** · **Use current number** 가 있다. 표시는 안내일 뿐 어떤 저장도 막지 않는다. **EQUIS에 있는 문서의 제목은 가장 높은 승인 판의 이름으로 맞춰지고 고칠 수 없다**(연필 자리에 자물쇠, 409 `title_locked`) — 옛 문서·올린 새 문서·To-Be 줄 모두, 작업 중인 Bundle만. 옛 번호(Legacy)는 지금 문서까지 다섯 번 따라간다. 조회는 저장 응답 뒤에 돌고, 받은 값은 번호별로 담아 하루 뒤 다시 조회한다. 사람 이름 칸은 받는 자리에서 버린다. **배포 메모**: Alembic `0016`(`equis_lookups` 표, 자동 적용). 새 env 셋 `N8N_QUERY_URL` · `EQUIS_EDW_TABLE` · `EQUIS_DOC_URL_BASE`(`docs/deploy/setup-once.md`) — 하나라도 비면 꺼져 있고 화면이 v1.0.0과 같다. 조회 창구는 db-viewer가 쓰는 n8n `dbv-query` 웹훅이라 그 워크플로가 바뀌면 조회가 실패로 보인다. **검증**: backend pytest 2318·ruff, frontend tsc·lint·vitest 794·빌드 경고 0, 가짜 웹훅으로 브라우저 확인(1366·1120, 라이트·다크, 영어·한국어, 키보드로 펼치고 닫기). **실제 웹훅·실제 EDW 값은 미검증**(합성 응답만). 설계 `docs/superpowers/specs/2026-11-13-equis-lookup-design.md`.

## v1.0.0 — 2026-11-14

- **범위**: v0.16.0 뒤 dev 업데이트 v0.16.1~v0.16.15 — 화면 검토 반영 6~14/14, 용지 표시 정리, 언어 축 걷어 내기 (1)~(4)(결과물 한 벌), 작은 화면 개선, 언어 탭·Assign 오른쪽 패널, 연결선 꼬리·Split 확인 흐름, Assign 되돌리기, dev 정리 검토의 고침과 결정 반영. 사용자 결정으로 첫 정식 버전(MAJOR 1.0.0)으로 올렸다.
- **주요 변경**:
  - **화면 검토 반영**(v0.16.1~v0.16.4): Assign 그 자리 메뉴가 이은 줄을 덮지 않고 화면 안에, 오른쪽 패널 280~420px, 도구 줄은 좁으면 오른쪽 단추를 아이콘으로. 못 여는 Bundle은 여섯 단계 모두 **Bundle not available**. 서비스 마크 4줄, 관리 화면(HR 미설정 안내·구성원 창·권한 칩 +N), 끝난 AI 작업 한 줄과 "12 / 14".
  - **용지·상태 표시**(v0.16.5): 절 번호 칸·**ON HOLD** 칩·Unit 상태 칩 한 벌, Assign 첫 진입 **All**과 상태 필터 접기.
  - **언어 축 걷어 내기**(v0.16.6·v0.16.12): 진행 숫자·검토 조건·결과물이 줄(한/영 짝 하나 또는 짝 없는 Unit 하나) 기준 한 벌. Split **Join** 하나와 **One sentence | KO/EN pair**, 배정은 언어로 막지 않음·New 짝 함께 고르기·**Remark**, 승인 시스템 이름 EQUIS. 결과물 A·B·C·요약·Excel 한 벌(판 전환 없음) — A 의미 묶음 7열, **Export Excel** 미리보기(파일과 같은 시트 모델)·Graphite·서버가 짓는 파일 이름, 섹션 번호는 문장마다(한/영 짝이 함께 놓이면 영어 번호·한글 생략), 칸 제목(**Slot heading**), 검토 조건에 옛 문서 버전, 결과물 C 순서 바꾸기 바로 반영·미끄러짐·이어 그리기.
  - **Split·Assign 화면**(v0.16.7~v0.16.11): KO 파랑·EN 초록 탭은 올림·고름·포커스 때만, Old 우클릭 메뉴·Remark 창·안 쓴 문서 미리 보기, Assign 오른쪽 패널 순서(**Where it goes** 목록 → 아래 고정 **Decide**), 먼 이음은 옅어지는 꼬리, Split 경계 확인 흐름(칩 뒤집힘·단추 줄 꺼짐 뒤 다음 Unit)과 경계 확인의 Ctrl+Z.
  - **Assign 되돌리기·다시 하기**(v0.16.13): 도구 줄 **Undo**·**Redo**와 Ctrl/⌘+Z, 판단 저장마다 앞뒤 스냅숏, 그 사이 바뀐 줄은 거절(409 `undo_conflict`).
  - **검토 고침과 결정**(v0.16.14~v0.16.15): v0.16.1~v0.16.13 의도 대조로 찾은 회귀 — 그 자리 메뉴가 New 짝을 덮음, Split 느린 응답에 옛 단추 줄이 다시 켜짐, 되돌리기가 짝·번역 불변식을 놓침. 사용자 결정 — 결과물 C 순서가 바뀐 문서로의 되돌리기 거절과 줄 번호 알림, 엮은 문서 미리 보기의 문장 번호, Split 넘어간 조각 단추 바로, 숨긴 같은 머리말까지 남은 경계 수.
  - 사용 설명서 `version` 1.0 — 글·그림을 화면에 맞췄다. 끝난 구현 계획 5개(용지 표시·화면 검토·언어 축·결과물 한 벌·Assign 되돌리기)를 지웠다(git history에 남는다).
- **검증**: 릴리스 커밋에서 backend pytest 전체 2246·ruff, frontend tsc·lint·vitest 781·프로덕션 빌드 경고 0. 브라우저 스모크 SOP·배치 감사(극단 자료)·겹침 감사는 v0.16.15에서 통과했고 릴리스 때 다시 돌리지 않았다. 합성 SOP·가짜 AI·dev 로그인이고 실제 SOP·모델·운영 서버는 미검증.
- **배포 메모**: 스키마 변경 Alembic `0013`(새 문장 `remark`)·`0014`(`target_sentences.kind` 길이)·`0015`(`decision_steps` 표) — backend 기동 때 자동 적용. 새 env·새 의존성 없음. 이미 있는 Bundle은 섹션 번호가 문장마다 한 줄로 다시 세어진다(짝의 두 문장이 둘 다 "번호"면 5.1·5.2) — 자료를 옮기지 않으니 결과물 C에서 사람이 번호 표시를 고친다.
  - **운영 배포 2026-11-14.** 사내 GitLab 파이프라인(`deploy-production` ▶)으로 올렸다(그전 운영은 v0.10.1). v0.11.0~v0.16.0이 함께 나가 그 버전들의 배포 메모(Alembic `0010`~`0015` 포함)가 이 배포에 함께 적용됐다.

이전 릴리스(0.x — v0.1.0~v0.16.0)는 [`docs/history/CHANGELOG-archive.md`](docs/history/CHANGELOG-archive.md).
