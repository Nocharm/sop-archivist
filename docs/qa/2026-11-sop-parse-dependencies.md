# SOP 파싱 의존성·메모리 실측 (MarkItDown 보조 추출)

계획 1 Task 7. 스펙 §7.3(보조 추출기)·§10("새 의존성", "메모리")의 확인 항목을 설치한 버전으로 직접 재서 적는다. 문서는 전부 합성(저장소 테스트 팩토리 `docx_factory`·`pdf_factory`)이고 실제 SOP는 쓰지 않았다.

## 결과 요약

| 항목 | 결과 |
|---|---|
| 추가 의존성 | `markitdown[docx,pdf]==0.1.9` 하나. 새 패키지 18개가 딸려 온다(아래). 리눅스 이미지 `site-packages`에서 이 묶음이 약 125MB(onnxruntime 60, numpy 42, lxml 13, magika 4, protobuf 3) |
| 네트워크 | 변환 중 소켓을 열지 않는다(테스트가 `socket.connect`·`getaddrinfo`를 막고 변환). 파일 형식 판별 모델은 `magika` 휠에 들어 있어 실행 중 내려받지 않는다 |
| 자식 프로세스 최대 RSS | 메인 추출만 36~245MiB, 메인 + MarkItDown은 101~657MiB(최악: 칸 10만 개짜리 표 DOCX 657MiB) |
| backend 프로세스 RSS | 115MiB(uvicorn 기동·마이그레이션 뒤) |
| compose backend 메모리 상한 | 115 + 657 = 772MiB > 768MiB 라서 `memory: 1G`를 **`2G`로 올렸다**(`docker-compose.yml`) |
| `docker build backend` | 성공(27초, Docker Desktop 29.5.2, linux/aarch64). amd64 서버 이미지와 서버의 Docker Hub 차단 상태는 확인 못 함. amd64 휠은 `pip download`로 전부 존재 확인 |
| 넘겨 받을 위험 | MarkItDown이 오래 걸린다. Task 8의 60초 제한 아래 아래 "시간" 절 참고 |

## 새 패키지 (`pip freeze` 차이)

| 패키지 | 버전 | 라이선스 | 들어온 이유 |
|---|---|---|---|
| markitdown | 0.1.9 | MIT | 직접 의존 |
| mammoth, cobble | 1.13.0, 0.1.4 | BSD-2, BSD | DOCX → HTML (`[docx]`) |
| markdownify, beautifulsoup4, soupsieve | 1.2.3, 4.15.0, 4.0.1 | MIT | HTML → 마크다운 |
| lxml | 6.1.3 | BSD-3 | mammoth |
| pdfplumber, pypdfium2 | 0.11.10, 5.14.0 | MIT, BSD-3/Apache-2 | PDF (`[pdf]`). pdfminer.six는 이미 20260107로 있었다 |
| magika | 1.0.3 | Apache-2 | 파일 형식 판별(모델 포함) |
| onnxruntime, numpy, flatbuffers, protobuf | 1.31.1, 2.4.6, 25.12.19, 7.36.2 | MIT, BSD-3, Apache-2, BSD-3 | magika |
| requests, urllib3, certifi, six | 2.34.2, 2.8.0, 2026.10.23, 1.17.0 | Apache-2, MIT, MPL-2.0, MIT | markitdown(URL 변환용. 우리는 쓰지 않는다) |

`pip check`는 깨진 의존성 없음. Python 3.11 휠이 linux x86_64(manylinux)에 전부 있어 서버 빌드에 컴파일이 필요 없다(아래 명령 성공, `backend/`에서).

```bash
.venv/bin/pip download -d wheels --platform manylinux2014_x86_64 --platform manylinux_2_28_x86_64 --python-version 3.11 --implementation cp --only-binary=:all: -r requirements.txt
```

```powershell
.venv\Scripts\pip download -d wheels --platform manylinux2014_x86_64 --platform manylinux_2_28_x86_64 --python-version 3.11 --implementation cp --only-binary=:all: -r requirements.txt
```

받은 `wheels/`는 확인 뒤 지운다.

## MarkItDown이 메인이 될 수 없는 이유 (0.1.9 직접 확인)

| 항목 | 입력 | MarkItDown 출력 | 메인 출력 |
|---|---|---|---|
| 위치 정보 없음 | DOCX 두 문단, 둘째 문단 앞에 `lastRenderedPageBreak` | 결과 객체는 `markdown`·`text_content`·`title`뿐. 글은 `'첫 쪽 글\n\n둘째 쪽 글'` | `(page=1, xml_path=document/body/p[1])`, `(page=2, …/p[2])` |
| 병합 셀 | 가로 병합 제목 칸 + 아래 두 칸 | `\| 합친 제목 칸 \| \|` 다음 `\| 왼쪽 값 \| 오른쪽 값 \|` (앞에 빈 머리 줄 `\|  \|  \|`이 붙는다) | 칸 3개, 첫 칸 `grid_span=2` + `merged_cell` 경고 |
| 세로 병합 | 왼쪽 칸 세로 병합 + 오른쪽 두 칸 | `\| 세로 합친 칸 \| 위 오른쪽 \|` 다음 줄은 `\| 아래 오른쪽 \|` (오른쪽 칸이 첫 열로 밀린다) | 칸마다 `(row, col, row_span)`, 아래 오른쪽은 col 1 |
| PDF 표 | 글자를 열 위치에 놓은 PDF(실제 표 객체 없음) | 정렬을 보고 `\| Step \| Check       \| Limit       \|` 표를 추정해 만든다 | 문단 블록 12개(열 단위 읽기 순서), 표 0개 |
| 공백·기호 | `A * B _ C  # D`, 탭, 줄 끝 공백 | `A \* B \_ C # D`, 탭은 공백, 줄 끝 공백 삭제, 연속 공백 1칸 | 원문 그대로 |
| 글자 추가 | 각주가 달린 DOCX | 본문 뒤 `[[1]](#footnote-1)`, 각주 끝 `[↑](#footnote-ref-1)`(미주는 `endnote`) | 표식 없음 |

스펙 §7.3은 "병합 셀을 펼쳐 같은 글을 여러 칸에 복제", "PDF는 표 구조 없이 글자만"이라고 적었다. 0.1.9에서는 둘 다 그대로 재현되지 않았다. 병합 셀은 복제가 아니라 칸이 한 열씩 밀리고, PDF는 글자 위치로 표를 추정해 만든다(PDF 파일에 표 정보는 없으므로 추정이다). 결론은 같다. 칸 위치·쪽·XML 경로가 없고 글자가 바뀌어 근거 위치와 커버리지 계산에는 쓸 수 없다. 포함 검사에는 문제없다.

### 오탐을 줄이려고 정규화가 걷는 것

`normalize_for_compare`는 NFKC 뒤 이미지·링크 주소 `](…)`(안쪽 괄호 한 겹, 길이 제한 없음)·`\` 이스케이프·줄 머리 `#`·`>`·`-`·`*`·`+`·`1.`(들여쓴 중첩 포함)를 걷고, 글 모양 표시 `*`·`_`·`` ` ``·삭제선 `~~`·밑줄 `<u>`·링크 글을 감싼 대괄호 `[` `]`와 빈 글자(공백류 + `INVISIBLE_CHARS`, `docx_reader`와 같은 판정)를 모두 지운다. 위 표의 각주 표식도 걷는다. 걷지 않으면 각주 달린 문서는 본문 문단과 각주마다 "누락 의심"이 뜬다(확인함: 표식 규칙을 끄면 두 조각이 걸린다). 삭제선(`~~글~~`), 밑줄(`<u>글</u>`), 대괄호가 든 링크 글(`[[SOP-001] 절차](#sec1)`), 괄호가 든 주소(`#a(b)c`), 3000자 주소, 700자 링크 글도 실제 변환 결과로 확인해 오탐이 없다(테스트 `MARKUP_SHAPES`). 링크는 글을 따로 찾지 않고 주소만 지운 뒤 대괄호를 다른 표시와 함께 지운다(글 길이 상한이 없어 700자 링크 글도 걷히고 안쪽 대괄호도 따로 다루지 않는다). 주소 정규식은 안에서 `(` `)`를 못 건너 시작 지점마다 다음 괄호까지만 훑으므로, 200만 자 악의 입력(`[` 반복, `](` 반복, `[`+`[a]` 반복 등)도 0.15초 안쪽이다. 메인 글에도 같은 정규화를 쓰므로 한쪽에만 생기는 차이는 없다.

## 측정 방법

- 구조: Task 8과 같다. 부모가 `multiprocessing.get_context("spawn").Process` + `Pipe`로 자식 하나를 띄우고, 자식이 메인 추출(`read_docx`/`read_pdf`) 뒤 MarkItDown 변환을 돌려 결과를 Pipe로 보낸다. 부모는 받은 뒤 `find_missing_text`를 부른다.
- 최대 RSS: 부모가 `resource.getrusage(RUSAGE_CHILDREN).ru_maxrss`를 읽는다(리눅스 KiB, macOS 바이트). 이 값은 자식 중 가장 큰 것이라 시나리오마다 새 부모 프로세스로 쟀다.
- 환경: backend 이미지(`python:3.11-slim`, Docker Desktop linux/aarch64 VM, 8 vCPU)에서 `--memory=1g`, `MALLOC_ARENA_MAX=2`(compose backend와 같은 값을 자식이 상속), 자식 `RLIMIT_AS` 2048MiB(Task 8 기본값). 같은 시나리오를 macOS 호스트(Python 3.11.15, arm64)에서도 쟀고 같은 순서에 최대 약 10% 낮았다(최악 643MiB).
- 문서: 합성 한글 글(실제 문장 아님). 팩토리로 만들었다. `small`은 2.3k자, `big_paragraph`는 문단 17,161개 1.92M자(표 몇 개 포함), `big_cells`는 5열 표 105,560칸 1.88M자, PDF는 3쪽과 500쪽(영문 합성 줄, 1.67M자).

### 자식 프로세스 (메인 + MarkItDown, `RLIMIT_AS` 2048MiB 아래)

| 문서 | 메인 시간 | MarkItDown 시간 | 최대 RSS 메인만 | 최대 RSS 메인 + MarkItDown | 최대 가상 크기(VmPeak) | 부모 증가 |
|---|---|---|---|---|---|---|
| small.docx | 0.0초 | 0.04초 | 36MiB | 101MiB | 627MiB | +0.4MiB |
| big_paragraph.docx | 0.18초 | 2.0초 | 82MiB | 202MiB | 702MiB | +35MiB |
| big_cells.docx | 1.1초 | 19.6초 | 245MiB | 657MiB | 1159MiB | +141MiB |
| small.pdf | 0.02초 | 0.11초 | 37MiB | 103MiB | 629MiB | +0.4MiB |
| big.pdf (500쪽) | 6.8초 | 26.5초 | 46MiB | 126MiB | 646MiB | +5.5MiB |

"부모 증가"는 결과(블록·마크다운)를 Pipe로 받은 뒤 부모 RSS가 늘어난 양이다(빈 파이썬 + `aux_compare` 18.5MiB 기준). `find_missing_text`는 부모에서 0.1~0.54초(200만 자, 블록 10만 개). 누락 조각마다 건초더미(200만 자)를 훑으므로 모든 줄이 빠진 최악 입력은 조각 수에 비례한다(상한 없이 2천 개 0.5초, 1만 개 2.1초, 3만 개 6.1초). 그래서 `max_items`(기본 200)개를 모으면 멈춘다. 같은 입력이 상한 200에서는 조각 수와 무관하게 0.15초다. 결과 길이가 `max_items`와 같으면 잘렸을 수 있다.

### import 시간·기본 비용

| 단계 | 시간 | RSS |
|---|---|---|
| 자식이 `app.sop.extract.*` import | 0.04~0.05초 | 약 36MiB |
| `import markitdown` | 0.11~0.21초 | 약 74MiB(+37MiB) |
| `MarkItDown()` 생성 + 작은 문서 변환 | 0.02~0.11초 | 100MiB 안팎 |

`aux_compare`는 `markitdown`을 `convert_with_markitdown` 안에서 불러 오므로, `find_missing_text`만 쓰는 부모는 onnxruntime·numpy를 올리지 않는다(`import app.sop.extract.aux_compare` 뒤 `sys.modules`에 없음을 확인).

## 메모리 결정

규칙: (backend 프로세스 RSS + 자식 최대 RSS) > 768MiB 이면 compose `memory: 1G`를 `2G`로 올린다.

- backend 프로세스 RSS: 이미지에서 uvicorn을 띄우고 `/api/health` 20회 뒤 `VmRSS` 117,632kB = **115MiB**(sqlite, `MALLOC_ARENA_MAX=2`).
- 자식 최대 RSS: 최악 합성 문서에서 **657MiB**(MarkItDown 포함. 칸이 많은 표가 가장 무겁다).
- 합 772MiB > 768MiB → **2G**. 1G 안에서도 한 번의 파싱은 들어가지만(컨테이너 cgroup `memory.peak` 637MiB로 확인) 여유가 작다. 그 외 이유: 실제 backend는 블록 10만 개를 DB에 넣느라 위 부모 증가(+141MiB)보다 더 늘고, 업로드가 겹치면 자식이 둘이며, 서버는 amd64라 위 수치와 다를 수 있다. `reservations` 256M은 그대로 둔다. 같은 파일 상단의 limits 합계 주석도 3.0G → 4.0G로 고쳤다.
- 이 수치는 합성 문서이며 amd64 서버·실제 SOP·동시 업로드로는 재지 않았다. 서버 배포 뒤 `docker stats`로 한 번 확인한다.

## Task 8에 넘기는 주의

1. **시간**: 메인과 MarkItDown이 한 자식에서 이어 돌면 큰 문서는 합쳐 최대 ~34초(500쪽 PDF 6.8 + 26.5초가 최대, 칸 10만 표 DOCX는 1.1 + 19.6초, 빠른 8코어 VM 기준)다. 서버가 2배 느리면 `sop_parse_timeout_seconds` 60초를 넘어 메인이 성공했는데도 문서가 `failed`/`timeout`이 될 수 있다. 보조는 실패해도 작업을 계속해야 하므로(스펙 §7.3), 메인 결과를 먼저 부모에 보낸 뒤 MarkItDown을 따로 시간 한도 안에서 돌리고, 넘으면 `aux_status=failed`로 두는 구조를 권한다.
2. **RLIMIT_AS**: 2048MiB는 `MALLOC_ARENA_MAX=2`와 함께일 때 충분하다(VmPeak 627~1159MiB). 이 값 없이는 8 vCPU에서 1040~1853MiB까지 올라(arena와 스레드 예약) 한도에 바짝 붙는다. `MALLOC_ARENA_MAX` 없이 1024MiB로 낮추면 실제 RSS 126MiB인 500쪽 PDF도 결과를 Pipe로 보내다 `MemoryError`가 났다. 값을 둔 상태에서도 1024MiB는 칸 10만 표에서 자식이 abort(종료 코드 -6)했고 768MiB는 종료 코드 1이었다(문단 많은 DOCX·500쪽 PDF는 1024·768MiB 모두 통과). 자식은 compose의 `MALLOC_ARENA_MAX`를 상속하므로 `spawn`에서도 유지된다. 기본값 2048MiB를 낮추지 말 것.
3. **예외**: 깨진 DOCX·PDF·ZIP, 빈 바이트는 모두 `markitdown.FileConversionException`이다(`aux_detail`에 클래스 이름). `convert_with_markitdown`은 DOCX·PDF 변환기만 등록하므로 일반 글·CSV·ZIP 변환기가 깨진 파일을 대신 받아 성공처럼 보이는 일이 없다.
