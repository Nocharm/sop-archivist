# 서버 배포 런북 (docker compose)

로컬에서 검증한 코드를 서버(사내 71번)로 옮겨 docker compose로 올리는 절차. 이 문서는 **매 배포마다 반복하는 절차**만 다룬다. 서버를 처음 세울 때 한 번만 하는 일(Keycloak 클라이언트, `.env` 작성, 첫 HR 동기화 등)은 [`setup-once.md`](setup-once.md), 백업·복구는 [`backup.md`](backup.md), db-viewer 연결은 [`db-viewer-readonly.md`](db-viewer-readonly.md).

> 서버 명령은 모두 bash(리눅스) 기준이다. 로컬 PC 명령은 `README.md`·`CLAUDE.md` Commands에 bash와 PowerShell을 병기했다.

## 파이프라인

1. 개발: GitHub `Nocharm/sop-archivist`의 `main`을 Windows PC에서 `git pull` → **Docker 없이 네이티브로 실행해 확인**(backend 8777 + frontend 3777, `README.md`).
2. 전송: 서버 71번에서 같은 저장소를 `git clone`/`git pull` 한다. 서버에서 GitHub에 닿지 않으면 Windows PC에서 scp로 옮긴다. 줄바꿈은 `.gitattributes`가 LF로 고정하므로 Windows를 거쳐도 안전하다.
3. 배포: 서버에서 `docker compose up -d --build`. 접속은 `http://<server-ip>:7777`.

로컬에서 통과해도 컨테이너 네트워크·포트·줄바꿈·**런타임 버전(Python 3.11)** 차이로 서버에서 깨질 수 있다. 그래서 배포 뒤 §3 확인을 반드시 한다.

## 0. 전제조건

- 서버에 Docker와 Compose v2가 있다(`docker compose version`) → [`setup-once.md`](setup-once.md) A1.
- 최초 셋업이 끝났다 → [`setup-once.md`](setup-once.md). 특히 서버 `.env`(AUTH_MODE 포함)와 Keycloak 클라이언트.
- 공유 브리지 **`dbv-shared`가 서버에 있다**(db-viewer 조회용, compose가 `external`로 참조) → [`setup-once.md`](setup-once.md) A2. 없으면 `up`이 `network dbv-shared declared as external, but could not be found`로 **기동 전에 실패**한다.
- **베이스 이미지 4개가 서버에 있다.** 서버는 Docker Hub가 막혀 있어 이미지를 tar로 반입한다. 이 프로젝트는 bpm과 **같은 태그만** 쓰므로 bpm이 올라가 있는 서버에는 이미 있다. 확인:

  ```bash
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(node:24\.22\.1-alpine|python:3\.11-slim|nginx:1\.27-alpine|postgres:16-alpine)$'   # 4줄이어야 한다
  ```

  - 빌드에만 쓰는 `node`·`python`은 실행 중인 컨테이너가 참조하지 않아 `docker image prune -a`·`system prune -a`에 지워진다(bpm 2026-10-02 배포 실패). 프룬을 했다면 배포 전에 위 명령으로 다시 확인한다.
  - 프런트 node는 패치 버전까지 고정한다(`frontend/Dockerfile`). 유동 태그(`node:24-alpine`)는 서버에 남은 옛 tar로 조용히 빌드돼 보안 패치가 빠진다. Dockerfile `FROM` 태그를 바꾸면 서버에 새 tar가 필요하다.
  - 반입 tar는 서버 아키텍처(**linux/amd64**)여야 한다. 다른 아키텍처면 태그가 그 아키텍처로 덮이고 빌드가 레지스트리로 나가 실패한다.
  - tar는 서버의 고정 디렉터리에 보관해 두면 프룬 뒤 `docker load -i`만 다시 하면 된다(멱등, 수 초).

  없는 이미지를 반입하는 법 (docker·scp 명령은 bash·PowerShell 동일):

  ```bash
  # Docker가 있고 인터넷에 연결된 PC — python:3.11-slim·nginx:1.27-alpine·postgres:16-alpine도 같은 방식
  docker pull --platform linux/amd64 node:24.22.1-alpine
  docker save --platform linux/amd64 node:24.22.1-alpine -o node24.22.1-alpine-amd64.tar   # Docker Desktop(containerd 저장소)은 --platform 필수
  scp node24.22.1-alpine-amd64.tar <계정>@<server-ip>:<tar 보관 디렉터리>/
  # 서버
  docker load -i node24.22.1-alpine-amd64.tar
  docker image inspect node:24.22.1-alpine --format '{{.Os}}/{{.Architecture}}'   # linux/amd64 여야 한다
  ```

- **npm·PyPI 레지스트리에 접속된다.** 빌드 캐시가 없으면(베이스 교체·`docker builder prune`) `npm ci`·`pip install`이 다시 돈다. Docker Hub와 별개 경로다.

## 1. `.env`

`.env`는 서버에만 있고 git에 커밋하지 않는다. 항목과 채우는 법은 [`setup-once.md`](setup-once.md) A4와 `.env.example`.

- **서버 `.env`에는 `AUTH_MODE=keycloak`을 명시한다.** compose는 비어 있어도 `keycloak`으로 닫지만(`${AUTH_MODE:-keycloak}`), 명시해 두면 읽는 사람이 헷갈리지 않는다.
- **`AUTH_MODE=dev`는 로컬 전용이다.** dev 모드는 `X-Dev-User` 헤더를 그대로 믿어 누구나 어떤 사용자로도 들어올 수 있고, 기동할 때 가짜 부서 7개·직원 5명을 DB에 넣는다. 서버 볼륨에 한 번이라도 dev로 띄우면 그 직원이 디렉터리 선택기에 남는다 → [`setup-once.md`](setup-once.md) C절.
- backend 환경변수는 전부 **런타임** 값이다. `.env`를 고친 뒤 `docker compose up -d backend && docker compose restart proxy`로 backend를 다시 만들면 반영되고(nginx가 옛 backend 주소를 잡고 있을 수 있어 proxy를 함께 재시작한다, §4 502 행), 프런트 재빌드는 필요 없다(인증 모드는 프런트가 부팅할 때 `GET /api/auth/mode`로 조회한다). 새 env를 코드에 추가할 때는 `settings.py`·`.env.example`·compose `environment:` 세 곳이 함께 움직여야 한다(backend에 `env_file`이 없다, `rules/backend/config.md`).
- `APP_PORT`를 바꾸면 Keycloak 클라이언트의 Valid redirect URIs·Web origins에 새 origin을 등록해야 로그인이 된다.

## 2. 배포

```bash
cd <배포 디렉터리>
git pull                            # 태그로 배포하면: git fetch --tags && git checkout vX.Y.Z
docker compose up -d --build
```

- **배포 단위는 서비스 버전**(`vX.Y.Z` 태그, 최신 항목은 루트 `CHANGELOG.md`). 버전마다 배포 메모(사이드카 재생성 등)가 CHANGELOG에 있으니 배포 전에 읽는다. 규칙: `rules/common/git.md` "On Main Merge — 서비스 버전".
- **DB 스키마는 backend가 기동할 때 Alembic으로 head까지 자동 적용한다.** 배포만으로 새 테이블·컬럼이 반영되고, 서버에서 손으로 마이그레이션하거나 리셋할 일은 없다. 모델을 바꾼 커밋에는 반드시 리비전 파일이 있어야 한다(없으면 `test_models_match_migrations`가 로컬에서 잡는다). backend는 **단일 워커**라서 마이그레이션이 경합하지 않는다 — Dockerfile에 `--workers`를 추가하지 않는다.
- 마이그레이션이 실패하면 backend가 재시작을 반복한다: `docker compose logs --tail 120 backend`.
- **`scripts/db-backup.sh`를 바꾼 배포는 사이드카를 다시 만든다.** 스크립트는 바인드 마운트라 `up -d --build`가 db-backup을 재생성하지 않아 옛 루프가 계속 돈다: `docker compose up -d --force-recreate db-backup`.
- **`nginx/default.conf`를 바꾼 배포는 `docker compose restart proxy`.** 마운트된 파일 내용이 바뀌어도 `up -d`는 컨테이너를 다시 만들지 않는다.
- **backend가 다시 만들어진 배포(새 이미지 빌드, `.env` 변경) 뒤 `/api`가 502이면 `docker compose restart proxy`.** proxy는 설정이 그대로라 `up -d`가 다시 만들지 않고, nginx는 시작할 때 푼 옛 backend 주소를 계속 쓴다(§4 502 행).
- 소스 코드가 바뀐 배포만 프런트 이미지가 다시 빌드된다(`--build`). 반영됐는지는 §3과 §6으로 확인한다.
- **서버에서 하지 말 것**: `docker compose down -v`(`pgdata` 볼륨 삭제), `python -m scripts.reset_db`(이미지에 실려 있지만 모든 테이블을 지운다). [`setup-once.md`](setup-once.md) C절.

## 3. 헬스체크

```bash
docker compose ps                                                 # 5개 서비스 Up(db-backup 포함), db healthy
curl -s http://localhost:7777/api/health                          # {"status":"ok"}
curl -s http://localhost:7777/api/auth/mode; echo                 # {"mode":"keycloak","keycloakIssuer":"…","keycloakClientId":"sop-archivist-frontend"}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7777/   # 200
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT version_num FROM alembic_version"'   # 마이그레이션 head 리비전
docker compose logs --tail 5 db-backup                            # "[db-backup] ... ok sop-archivist_....dump" (backup.md §2)
```

`/api/auth/mode`의 `mode`가 `keycloak`이 아니거나 `keycloakClientId`가 비어 있으면 로그인이 열려 있거나 막혀 있는 것이다. 바로 `.env`를 고친다(§4).

브라우저(`http://<server-ip>:7777`)에서:

1. 미인증이면 Keycloak 로그인으로 가고, 로그인하면 홈이 열린다.
2. 상단 바 서비스 이름 옆 버전(`vX.Y.Z`)이 배포한 버전과 같은지 본다. 다르면 프런트 이미지가 다시 빌드되지 않은 것이다(§6). 같으면 `CHANGELOG.md` 해당 항목에 **배포일을 적는다**.
3. 홈에 내 이름·부서·권한이 보인다. HR 첫 동기화 전이면 이름·부서는 비어 있다(정상).
4. 권한이 있는 계정이면 상단 바에 관리 메뉴가 보이고, AI 탭의 "Test connection"과 배치 작업 탭의 백업 기록이 열린다.

## 4. 트러블슈팅

**로그인이 안 되면 인증 설정보다 backend 생존을 먼저 본다.** 프런트의 인증 모드 조회(`GET /api/auth/mode`)는 fail-closed라, backend가 죽어 무응답이면 에러를 띄우지 않고 빈 issuer·client_id의 로그인 카드를 그린다. 화면은 멀쩡한데 버튼만 죽은 것처럼 보인다. 순서대로:

```bash
docker compose ps                                  # backend가 restarting/exited인가
docker compose logs --tail 120 backend             # 기동 실패 사유
curl -s http://localhost:7777/api/auth/mode; echo  # issuer·clientId가 채워져 있는가
```

| 증상 | 확인 |
|------|------|
| **로그인 버튼 무반응 + `/api/auth/mode` 무응답** | backend 기동 실패. 아래 행들을 먼저 볼 것 |
| build가 `docker/dockerfile:1: failed to resolve source metadata` | Dockerfile에 `# syntax=` 지시어가 남아 있다. 빌드마다 Docker Hub에서 프런트엔드 이미지를 찾는다. 지운다(내장 파서로 충분, `rules/backend/docker.md`) |
| build가 `node:24.22.1-alpine`/`python:3.11-slim` `failed to resolve source metadata` | 베이스 이미지가 서버에 없다(프룬, 또는 Dockerfile 태그를 올렸는데 tar 미반입) 또는 반입 tar가 amd64가 아니다 → §0 |
| `up`이 `network dbv-shared ... could not be found` | 공유 브리지가 없다 → [`setup-once.md`](setup-once.md) A2 후 다시 `up` |
| `up`이 `required variable POSTGRES_PASSWORD is missing a value` | 배포 디렉터리에 `.env`가 없거나 `POSTGRES_PASSWORD`가 비었다 |
| backend 로그에 `SyntaxError`(import 단계) | **로컬 파이썬이 배포 런타임보다 높다.** 배포 이미지는 `python:3.11-slim`이라 로컬 3.12+에서 짠 상위 문법(PEP 695 제네릭 `def f[T]()` 등)은 서버에서만 죽는다. `backend/ruff.toml`의 `target-version = "py311"`이 린트에서 잡는다(bpm 2026-08-31 실사고) |
| backend 로그에 DB URL 파싱 오류·`password authentication failed` | `POSTGRES_PASSWORD`가 DATABASE_URL에 그대로 들어가므로 URL에 안전한 문자(영문·숫자·`-`·`_`·`.`)만 쓴다(`@ : / # ? %`와 compose가 치환하는 `$`는 금지). 또 postgres 비밀번호는 **볼륨을 처음 만들 때만** 적용되므로 `.env` 값을 나중에 바꿔도 DB의 비밀번호는 그대로다 → [`setup-once.md`](setup-once.md) A4 |
| backend 로그에 `Can't locate revision` | DB의 `alembic_version`이 이 코드보다 새 리비전이다(더 새 버전을 배포했다가 코드만 되돌렸다). §7 |
| `/api/auth/mode`의 `keycloakClientId`·`keycloakIssuer`가 빈 문자열 | `.env`에 `KEYCLOAK_CLIENT_ID`·`KEYCLOAK_ISSUER` 누락. compose 기본값이 빈 문자열이라 **에러 없이 조용히** 빈 값이 들어간다. 로그인 시도는 Keycloak `Invalid parameter: client_id` |
| `.env`에 넣은 값이 컨테이너에 안 들어간다(코드는 기본값으로 동작) | **backend에는 `env_file`이 없다.** `.env`의 키는 `docker-compose.yml` backend `environment:`에 `VAR: ${VAR:-}`로 매핑돼 있어야 컨테이너에 닿는다. `docker compose exec backend env \| grep <VAR>`로 실제 값을 확인하고, 없으면 `settings.py`·`.env.example`·compose 세 곳을 함께 고친다(`rules/backend/config.md`). 값만 바꿨다면 `docker compose up -d backend && docker compose restart proxy` |
| backend를 다시 만든 뒤 `/api`가 502 | nginx가 시작할 때 푼 옛 backend 주소를 계속 쓴다(proxy 설정이 그대로라 `up -d`가 proxy를 다시 만들지 않는다) → `docker compose restart proxy` |
| `/api/auth/mode`의 `mode`가 `dev` | 서버가 dev로 떠 있다(`X-Dev-User` 헤더만으로 로그인이 열린다). 즉시 `.env`를 `AUTH_MODE=keycloak`으로 고치고 `docker compose up -d backend && docker compose restart proxy`. dev로 한 번이라도 떴다면 [`setup-once.md`](setup-once.md) C절의 dev 직원 정리 |
| 로그인 후 `Invalid parameter: redirect_uri` | Keycloak Valid redirect URIs에 `http://<server-ip>:7777/login`(또는 `/*`)이 없다. 콜백을 `/login`이 받는다 → [`setup-once.md`](setup-once.md) A5 |
| 복귀 시 `failed to fetch` / `No matching state found` | 토큰 엔드포인트 CORS. Keycloak 클라이언트 **Web origins**에 `http://<server-ip>:7777` 추가. state 오류는 후속 증상이니 깨끗한 `/login`에서 다시 시도 |
| 로그인 화면의 "End all sessions"(모든 세션 종료)가 Keycloak 확인 화면에서 멈춤 | Valid post logout redirect URIs에 `/login`이 없다 |
| 로그인했는데 `/api/*`가 401 | 토큰 만료, 또는 `KEYCLOAK_ISSUER`가 realm URL(`/realms/ai-portal`까지)과 다름, 또는 **토큰이 다른 클라이언트에 발급됨**(`azp` ≠ `KEYCLOAK_CLIENT_ID`). 사유는 응답이 아니라 서버 로그에만 있다: `docker compose logs backend \| grep "keycloak token rejected"` |
| 로그인은 되는데 이름·부서가 비어 있다 | HR 첫 동기화 전이면 정상. 동기화 뒤에도 비면 Keycloak `preferred_username`이 HR의 loginId와 같지 않은 것(대소문자 포함 정확히 일치해야 한다) |
| 관리 메뉴가 안 보인다 | `APP_SYSADMINS`에 loginId가 정확히(대소문자) 들었는지, 변경 뒤 backend를 다시 만들었는지(`docker compose up -d backend && docker compose restart proxy`). 또는 권한이 부여되지 않았다 → 관리 > Access |
| 관리 > Directory sync가 "HR sync is not set up on this server."(503) | `N8N_HR_URL`·`N8N_HR_TOKEN` 둘 중 하나가 비어 있다. "Could not reach the HR source."(502, 서버 로그·관리 API 상세는 `HR source error: <상태>`)면 n8n 웹훅 주소·토큰·네트워크 확인 |
| 관리 > AI "Test connection" 실패 | "AI is turned off."(503)면 `AI_ENABLED=false`. "Could not reach the AI service."(502, 상세는 `AI endpoint error: <상태>`)면 `AI_BASE_URL`·`AI_API_TOKEN`·`AI_MODEL` 확인(토큰이 비면 `Bearer ` 헤더가 깨져 호출이 실패한다) |
| 묶음의 AI 작업이 `failed`로 쌓인다(`GET /api/bundles/<id>/ai/status`의 `failed_errors`) | 코드로 가른다. `connection`·`timeout`: `AI_BASE_URL`·`EMBED_BASE_URL` 주소·망·`AI_TIMEOUT_SECONDS`. `client_error`(4xx는 자동 재시도 없이 바로 실패): 토큰·모델 이름. `server_error`: 모델 서버의 5xx나 깨진 응답. `config`: AI·임베딩 설정이 비었거나 요청 뒤 꺼졌다. `interrupted`: 재시작으로 3번 끊겼다. `no_candidates`: 분류할 To-Be 칸(입구 1 새 문서)이 없다. `internal`: 예상 밖 예외(원문 없이 클래스 이름만 로그에 남는다). 고친 뒤 작성자가 `POST /api/bundles/<id>/ai/retry`(다시 시도)를 누른다. 원문은 로그에 남지 않으니 작업 ID·상태 코드만 본다 |
| backend 접속 로그의 클라이언트 주소가 nginx 주소로 찍힌다 | `FORWARDED_ALLOW_IPS` 미설정 → [`setup-once.md`](setup-once.md) A6 |
| 로그인 버튼 무반응, 콘솔에 `crypto.subtle is available only in secure contexts` | 평문 HTTP는 secure context가 아니다. 앱은 `crypto.subtle`이 없을 때 PKCE를 자동으로 끄지만, Keycloak 클라이언트가 PKCE를 **필수**(Proof Key `S256` 지정)로 걸어 두면 거부한다 → 필수를 푼다(§5) |
| 로그인 뒤 조용히 로그인 화면으로 돌아오거나 silent 갱신이 안 된다 | 앞단(서버 엣지 nginx 등)이 앱 응답에 `X-Frame-Options: DENY`·`frame-ancestors 'none'`을 붙이고 있다. 갱신 iframe이 `/login`을 불러오므로 이 헤더를 붙이지 않는다(앱 nginx도 붙이지 않는다) |
| 노드·id 생성류 무반응 + `crypto.randomUUID is not a function` | secure context 전용 API를 직접 쓴 코드다. `lib/id.ts`의 `genId()`·`lib/clipboard.ts`의 `copyText()`를 쓴다. **localhost에서는 재현되지 않는다** → 서버나 원격 IP로 확인(§6) |

로그: `docker compose logs -f backend` / `frontend` / `proxy` / `db-backup`

## 5. 보안 메모

- `.env`의 `POSTGRES_PASSWORD`·`AI_API_TOKEN`·`N8N_HR_TOKEN`은 시크릿이다. 서버 `.env`에만 있고 git·채팅·문서에 쓰지 않는다. `.env`는 소유자만 읽도록 둔다(`chmod 600 .env`).
- `X-Dev-User` 헤더는 `AUTH_MODE=dev`에서만 신뢰한다. 서버는 `keycloak`이라 무시한다(우회 불가). 서버를 dev로 띄우지 않는다.
- 토큰은 서명·issuer뿐 아니라 `azp == KEYCLOAK_CLIENT_ID`까지 검사한다. 같은 realm의 다른 앱이 받은 토큰은 401이다. `KEYCLOAK_CLIENT_ID`가 비면 전부 거부한다(fail closed).
- 관리 API(`/api/admin/*`, `/api/access/*`)는 권한(`directory.sync`·`system.view`·`ai.admin`·`permission.manage`)으로 서버에서 막는다. 화면에서 메뉴를 숨기는 것에 의존하지 않는다.
- **PKCE는 선택이다.** Keycloak 클라이언트에서 PKCE를 필수로 걸지 않는다. 앱이 보안 컨텍스트(HTTPS·localhost)에서는 PKCE를 켜고 평문 HTTP(`<server-ip>:7777`)에서는 `crypto.subtle`이 없어 끈다. 평문 HTTP에서는 인가 코드 가로채기 방어가 약해지는 트레이드오프를 사내망 한정으로 받아들인 것이다. HTTPS 도메인으로 옮기면 자동으로 PKCE가 켜진다(앱·Keycloak 둘 다 HTTPS여야 discovery 혼합 콘텐츠를 피한다).
- 백업 덤프에는 직원 디렉터리를 포함한 모든 행이 들어 있다. 덤프 디렉터리는 소유자 전용(0700)이고 사본도 사적으로만 다룬다 → [`backup.md`](backup.md).

## 6. 프런트 — insecure context · 빌드 반영 확인

**왜 "로컬은 되는데 서버만" 깨지나.** 브라우저는 `crypto.subtle`·`crypto.randomUUID`·Clipboard API를 secure context(HTTPS 또는 `localhost`)에서만 노출한다. 서버는 원격 IP + 평문 HTTP라 이 API가 `undefined`다. 그래서 id는 `genId()`, 복사는 `copyText()` 폴백, 로그인 PKCE는 조건부 해제로 우회한다. **로컬 `npm run dev`를 `localhost`로 띄우면 모두 정상이라 검증이 안 된다** — 서버 또는 LAN IP(`http://<server-ip>:3777`)로 확인한다.

**"고쳤는데 서버에서 여전히 같은 에러" — 빌드 반영부터 확인한다.** 흔한 함정은 `git pull`은 했지만 이미지를 다시 빌드하지 않은 경우다.

1. 소스가 디스크에 반영됐는지: `git rev-parse HEAD`, 상단 바 버전.
2. 컨테이너 번들에 들어갔는지: `docker compose exec frontend grep -rl <바꾼 심볼> .next` — 비면 미반영 → `docker compose build --no-cache frontend && docker compose up -d --force-recreate frontend`.
3. 소스가 바뀌면 청크 파일명(콘텐츠 해시)이 반드시 바뀐다. 재빌드 뒤에도 청크명이 그대로면 빌드 미반영이다.
4. 브라우저 캐시 배제: 시크릿 창으로 다시 확인한다.

## 7. 롤백

```bash
git checkout <이전-태그> && docker compose up -d --build   # 예: v0.1.0 (CHANGELOG.md)
```

- 데이터는 `pgdata` 볼륨에 남는다. 완전 초기화(`docker compose down -v`)는 **운영에서 하지 않는다**.
- **스키마를 바꾼 릴리스는 코드만 되돌려서는 안 된다.** Alembic은 되돌릴 때 자동으로 `downgrade`하지 않아, 더 새 리비전을 가리키는 DB를 옛 코드가 만나면 `Can't locate revision`으로 기동하지 못한다. 롤백 전에 CHANGELOG에서 그 릴리스가 마이그레이션을 포함했는지 보고, 포함했다면 배포 직전 덤프로 복구한다 → [`backup.md`](backup.md) §3 (복구 뒤 기동하는 코드는 덤프 시점 스키마와 맞아야 한다).

> **샌드박스 한계:** CI·샌드박스 환경은 Docker Hub 무인증 풀 제한으로 `compose build`를 끝까지 검증하지 못한다. `docker compose config` 정적 검증까지만 되고, 실제 빌드·기동은 로컬 Docker 또는 서버에서 확인한다.
