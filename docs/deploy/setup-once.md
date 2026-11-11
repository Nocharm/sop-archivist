# 초기 1회 셋업 (서버 71번)

서버에 SOP Archivist를 **처음 세울 때 한 번만 하는 작업**을 순서대로 모은 문서. 매 배포마다 반복하는 절차(GitLab에 push → 파이프라인 ▶ → 헬스체크)는 1회성이 아니다 → [`deploy.md`](deploy.md). **배포는 GitLab 파이프라인으로만 한다** — 서버에서 `git clone`·`docker compose up`을 손으로 치지 않는다. 러너·배포 폴더·되돌리기는 [`gitlab-runner.md`](gitlab-runner.md). 백업·복구는 [`backup.md`](backup.md), db-viewer 연결은 [`db-viewer-readonly.md`](db-viewer-readonly.md).

> 서버 명령은 모두 bash(리눅스) 기준이다. `docker compose` 명령은 **배포 폴더**(`/data/home_<계정>/deployments/sop-archivist`)에서 실행한다. 실 IP·사내 호스트명·사람 계정은 이 문서에 쓰지 않는다 — `<server-ip>`, `<keycloak-host>`, `<n8n-host>`, `<ai-host>`, `<embed-host>`, `<계정>`(서버 계정 — 배포 폴더가 그 계정의 `/data/home_<계정>` 아래다)을 실제 값으로 바꿔 읽는다. 실값과 시크릿은 서버의 `.env`에만 둔다.

| 순서 | 할 일 | 절 |
|---|---|---|
| ① | 서버 전제와 `dbv-shared` 확인 | A1·A2 |
| ② | GitLab 설정·러너·배포 폴더, `.env` 작성 (`AUTH_MODE=keycloak`, `APP_SYSADMINS` 포함) | A3·A4 |
| ③ | Keycloak 클라이언트 `sop-archivist-frontend` 만들기 | A5 |
| ④ | 첫 파이프라인 ▶, 내부 대역 확인 → `FORWARDED_ALLOW_IPS` 기입 후 파이프라인 재실행 | A6 |
| ⑤ | 시스템 관리자로 로그인 확인 | A7 |
| ⑥ | 관리 화면 Directory sync: 미리보기 → 실행 | A8 |
| ⑦ | 권한 관리 부서에 `permission.manage` 역할 부여 | A9 |
| ⑧ | db-viewer 연결, 백업 확인 | A10·A11 |

---

## A. 스택 구축 1회

### A1. 서버 전제 — Docker / Compose

```bash
docker --version && docker compose version   # Compose v2 (진단·비상 경로용 — 파이프라인은 docker:27-cli 이미지 안의 compose를 쓴다)
df -h .                                      # pgdata 볼륨 + 백업 덤프 여유 확인
ss -ltn | grep ':7777 ' || echo "7777 비어 있음"
```

앱 nginx는 **443/80을 쓰지 않는다** — 서버 엣지 nginx가 이미 점유 중이라 앱은 `APP_PORT`(기본 **7777**)로만 노출한다. 같은 서버의 bpm은 9900·9910을 쓰므로 겹치지 않는다. 베이스 이미지 4개가 서버에 있어야 한다 → [`deploy.md`](deploy.md) §0.

### A2. 공유 브리지 `dbv-shared` (서버 전체에 1회)

compose의 db 서비스가 `external` 네트워크로 참조하므로 **없으면 `up` 자체가 실패한다**. bpm이 이미 올라가 있는 서버에는 보통 있다:

```bash
docker network inspect dbv-shared -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # 10.203.0.0/24
docker network create --subnet 10.203.0.0/24 dbv-shared      # 없을 때만
```

`10.203.0.0/24`는 db-viewer 운영자가 정한 값이고, 이 네트워크는 **어느 compose도 소유하지 않는다**. 실제 조회를 열려면 계정 발급·소스 등록이 더 필요하다 → A10.

### A3. GitLab 설정·러너·배포 폴더

서버에 저장소를 clone하지 않는다. 코드는 배포 Job이 배포 폴더에 깐다. [`gitlab-runner.md`](gitlab-runner.md)를 순서대로 한다:

1. 1절 — GitLab 프로젝트 설정(`main` 보호, Private, Auto DevOps 끔, 되돌리기 설정 두 개, 러너 두 개 만들기).
2. 2절 — 서버에 러너 컨테이너 `gitlab-runner-sop-archivist`를 띄우고 `sop-archivist-test`·`sop-archivist-deploy`를 등록.
3. 3절 — 배포 폴더 `/data/home_<계정>/deployments/sop-archivist`를 만든다(`.env`는 A4).

compose 프로젝트 이름이 `sop-archivist`로 고정돼 있어 `-p` 없이도 bpm 스택과 이름(컨테이너·네트워크·볼륨)이 겹치지 않는다. 이후 손으로 치는 `docker compose` 진단 명령은 배포 폴더에서 실행한다.

### A4. `.env` 작성

PC에서 `.env.example`을 복사해 아래 값을 채운 뒤 서버 배포 폴더로 옮긴다. 배포 폴더는 첫 파이프라인 전에는 비어 있어 거기에 `.env.example`이 없다.

```bash
# PC (bash)
cp .env.example .env
```

```powershell
# PC (PowerShell)
Copy-Item .env.example .env
```

```bash
# PC → 서버 (scp는 bash·PowerShell 동일)
scp .env <계정>@<server-ip>:/data/home_<계정>/deployments/sop-archivist/.env
# 서버
chmod 600 /data/home_<계정>/deployments/sop-archivist/.env   # 시크릿이 들어가니 소유자만 읽게
```

`.env`는 **git·CI 변수에 넣지 않는다.** 배포 Job은 읽기만 하고, `AUTH_MODE`가 `keycloak`이 아니거나 `BACKUP_DIR`이 배포 폴더 안의 다른 상대 경로면 배포를 거절한다. PC의 사본은 아래 "사본 보관" 위치로 옮기고 작업 폴더에 두지 않는다(저장소 폴더 안의 `.env`는 `.gitignore` 대상이지만 실수 여지를 남기지 않는다). 서버 재구축에 필수인 자산이니 **git 밖 안전한 위치에 사본을 따로 보관**한다 — 백업 사이드카는 DB만 덤프한다([`backup.md`](backup.md)).

서버에서 채울 값 (`.env.example`이 전체 목록과 설명):

| 키 | 서버 값 |
|---|---|
| `APP_PORT` | `7777` |
| `POSTGRES_USER` / `POSTGRES_DB` | 기본 `sop_archivist` 그대로 둬도 된다 |
| `POSTGRES_PASSWORD` | **강한 임의값**. `openssl rand -hex 24`처럼 영문·숫자만. 아래 주의 |
| `BACKUP_DIR` / `BACKUP_RETENTION_DAYS` | `./backups` / `14` (배포 폴더 밖 절대 경로도 된다. 배포 폴더 안의 다른 상대 경로는 배포 동기화가 지워 거절된다) |
| `DBV_NETWORK` / `DBV_DB_ALIAS` | `dbv-shared` / `sop-archivist-db` |
| `AUTH_MODE` | **`keycloak`을 명시**한다 (compose 기본값도 keycloak이지만 적어 둔다) |
| `KEYCLOAK_ISSUER` | `http://<keycloak-host>:8080/realms/ai-portal` (realm URL까지) |
| `KEYCLOAK_AUDIENCE` | 비움 |
| `KEYCLOAK_CLIENT_ID` | `sop-archivist-frontend` — 토큰의 `azp`가 이 값일 때만 받는다. 비면 전부 거부 |
| `APP_SYSADMINS` | 시스템 관리자의 **실제 Keycloak 로그인 아이디**(`preferred_username`), 콤마 구분, 대소문자 정확히. 아래 주의 |
| `DEV_ENFORCE_PERMISSIONS` | `false`(keycloak에서는 무의미) |
| `AI_ENABLED` | `true` |
| `AI_BASE_URL` / `AI_MODEL` / `AI_API_TOKEN` | `https://<ai-host>/v1` / 사내 모델 이름 / 발급받은 토큰 |
| `AI_TIMEOUT_SECONDS` / `AI_MAX_TOKENS` | `120`~`180` / `8000` (사고 토큰 포함 상한, 작으면 빈 응답) |
| `EMBED_ENABLED` | 임베딩 서버가 준비되면 `true`, 아니면 `false`로 둔다(아래 주의) |
| `EMBED_BASE_URL` / `EMBED_MODEL` / `EMBED_API_TOKEN` | `http://<embed-host>:8000/v1` / 사내 임베딩 모델 이름(한/영 짝에는 다국어 모델) / 발급받은 토큰 |
| `N8N_HR_URL` / `N8N_HR_TOKEN` | `http://<n8n-host>:5678/webhook/hr-dept` / 웹훅 토큰(`X-API-Key`) |
| `HR_SYNC_INTERVAL_HOURS` | **처음엔 `0`**. 첫 수동 동기화(A8)를 확인한 뒤 `24` |
| `HR_SYNC_DELETE_CAP_PCT` | `20` |
| `SOP_MAX_FILE_MB` / `SOP_MAX_DOCX_UNZIPPED_MB` | `25` / `200` (파일 하나·DOCX 압축 해제 합계, MiB. 파일 상한은 nginx `client_max_body_size`(50m)보다 크게 올리지 않는다) |
| `SOP_MAX_PDF_PAGES` / `SOP_MAX_DOC_CHARS` | `500` / `2000000` (넘는 파일은 문서 목록에 "거절"과 사유로 남는다) |
| `SOP_PARSE_TIMEOUT_SECONDS` | `60` (파싱 한 번 시간 한도, 메인 추출과 보조 변환이 각자 이만큼 쓴다) |
| `SOP_PARSE_MEMORY_MB` | `2048` (파싱 자식 프로세스 메모리 상한). 낮추지 않는다(`docs/qa/2026-11-sop-parse-dependencies.md`) |
| `FORWARDED_ALLOW_IPS` | 지금은 비워 둔다. A6에서 채운다 |

- **`POSTGRES_PASSWORD`는 URL에 안전한 문자만.** 이 값이 backend의 `DATABASE_URL`에 그대로 들어간다(`postgresql+asyncpg://사용자:비밀번호@db:5432/…`). `@ : / # ? %` 같은 문자나 compose가 치환하는 `$`가 있으면 URL이 깨져 backend가 기동하지 못한다.
- **postgres 비밀번호는 볼륨을 처음 만들 때만 적용된다.** 첫 `up` 전에 값을 확정한다. 나중에 `.env`만 바꾸면 DB의 비밀번호는 그대로라 backend 접속이 `password authentication failed`로 실패한다(바꾸려면 db에서 `ALTER USER`와 `.env`를 함께).
- **`APP_SYSADMINS`는 `.env.example`에서 비어 있다(`dev.admin`은 로컬 예시로 주석에만 있다). 서버에서 반드시 채운다.** 비우면 서버에 관리자가 0명이다 — HR 첫 동기화 전에는 권한 표로 관리자를 만들 수도 없으니 **최소 1명**을 넣는다. 이 값은 권한 표와 무관하게 모든 권한을 갖는 비상 열쇠다.
- **`AI_API_TOKEN=fake`는 로컬 가짜 AI 서버용 예시다.** 서버에는 실제 토큰을 넣는다. 토큰이 비면 `Bearer ` 헤더가 깨져 호출이 실패한다.
- **임베딩(`EMBED_*`)은 채팅(`AI_*`)과 따로다.** 주소·모델·토큰이 다른 서버이고, `EMBED_API_TOKEN`도 시크릿이다(커밋 금지). 켠다면 토큰이 비면 `Bearer ` 헤더가 깨져 호출이 실패하는 것도 채팅과 같다. 둘 다 선택이고 `AI_ENABLED`·`EMBED_ENABLED` 중 하나라도 켜면 backend의 AI 작업 워커가 뜬다. `AI_ENABLED=false`면 큐에 남은 분류·번역·입구 2 짝·나누기 작업은 임베딩까지 아무것도 보내지 않고 `config`로 실패한다(임베딩만 쓰는 한/영 따로 짝은 그대로 돈다). 첫 배포는 `EMBED_ENABLED=false`로 시작해도 되고, 꺼 두면 후보 칸 추리기는 전체 칸이나 글자 유사도로, 입구 2 짝은 글자 유사도로 줄고 한/영 따로 짝 제안만 막힌다(사람이 손으로 잇는다). SOP 원문은 이 두 주소로만 나간다.
- **AI 제안의 품질과 유사도 임계값은 아직 합성 자료 기준이다.** 실제 모델로 시험한 적이 없으니, 첫 배포 뒤 실제 SOP로 제안을 보고 임계값(`backend/app/sop/ai/constants.py`)과 지침·프롬프트(`/api/admin/guidelines`의 버전, `guideline.manage` 권한)를 다시 정한다.
- 값에 `$`가 들어가면 compose가 변수로 읽으니 `$$`로 쓴다.
- **backend에는 `env_file:`이 없다.** `.env`의 키가 컨테이너에 닿으려면 `docker-compose.yml`의 backend `environment:`에 명시 매핑돼 있어야 한다. 새 env를 추가할 때는 `settings.py` + `.env.example` + compose 셋이 함께 움직인다(`rules/backend/config.md`).
- **운영 DB에는 dev 모드를 쓰지 않는다.** `AUTH_MODE=dev`는 로컬 sqlite와 따로 둔 개발 스택(:4444, DB 볼륨이 다르다 — [`gitlab-runner.md`](gitlab-runner.md) 9절)에서만 쓴다 → C절.

HR 웹훅 주소와 토큰이 맞는지 `up` 전에 직접 확인할 수 있다. 200과 `{"kind":"employees",...}`가 나오면 정답이다:

```bash
read -rs TOKEN          # 토큰을 붙여넣고 Enter (화면에 안 보이고 셸 기록에 남지 않는다)
curl -s -X POST http://<n8n-host>:5678/webhook/hr-dept \
  -H "X-API-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"employees","loginId":"<본인 loginId>"}' | head -c 300; echo
unset TOKEN
```

### A5. Keycloak public 클라이언트 (realm당 1회)

realm `ai-portal`(다른 사내 앱과 공유)에 frontend용 **public 클라이언트**를 만든다. Keycloak 관리자에게 요청하거나 직접 만든다:

| 항목 | 값 |
|------|-----|
| Client ID | `sop-archivist-frontend` (= `KEYCLOAK_CLIENT_ID`) |
| Client authentication | **Off** (public) |
| Standard flow | On (Authorization Code) |
| PKCE (Proof Key Code Challenge Method) | **비워 둔다 — 필수로 걸지 않는다** (선택) |
| Valid redirect URIs | `http://<server-ip>:7777/*` **(권장)** |
| Valid post logout redirect URIs | `http://<server-ip>:7777/*` |
| Web origins | `http://<server-ip>:7777` |
| Mappers | 토큰 `preferred_username`이 로그인 아이디(HR의 loginId와 같은 값)를 담는다. Keycloak LDAP federation 기본 매핑이면 된다 |

- **콜백은 `/login`이 받는다.** 앱은 `redirect_uri`를 `window.location.origin`으로 만들어 `http://<server-ip>:7777/login`을 쓴다(로그인 복귀, silent 갱신 모두). 최소로 등록하려면 정확히 이 주소를 넣으면 되고, 와일드카드 `http://<server-ip>:7777/*`는 그 주소를 포함한다. 이 앱이 그 origin을 단독으로 쓰므로 **와일드카드를 권장**한다(나중에 콜백 경로가 바뀌어도 로그인이 깨지지 않는다).
- **PKCE는 앱이 알아서 정한다.** 보안 컨텍스트(HTTPS·localhost)에서는 켜고, 평문 HTTP(`<server-ip>:7777`)에서는 `crypto.subtle`이 없어 끈다. 그래서 Keycloak 쪽에서 PKCE를 **필수로 걸면 평문 HTTP 로그인이 거부된다.** 필수로 걸지 않는다.
- **Web origins를 빼먹으면 로그인 왕복은 되는데 토큰 교환이 CORS로 죽는다**(`failed to fetch` / `No matching state found`). redirect URI와 별개 항목이다.
- **post logout redirect URI는 실제로 쓰인다.** 로그인 화면의 "End all sessions"가 Keycloak `end_session`을 `post_logout_redirect_uri=<origin>/login`으로 호출한다. 미등록이면 Keycloak 확인 화면에서 멈춘다.
- **URI 등록은 origin마다 따로다.** 포트나 도메인이 늘어나면(`APP_PORT` 변경, HTTPS 도메인 추가) 그 origin을 추가한다.
- 앞단(서버 엣지 nginx 등)이 이 앱 앞에 오더라도 `/login` 응답에 `X-Frame-Options: DENY`·`frame-ancestors 'none'`을 붙이지 않는다. silent 갱신이 `/login`을 숨은 iframe으로 불러온다(앱 nginx는 붙이지 않는다).

### A6. 첫 기동과 내부 대역 → `FORWARDED_ALLOW_IPS`

첫 기동은 첫 파이프라인이다. PC에서 `git push gitlab main`(+ 태그) → GitLab `main` 파이프라인의 test 3개 통과 → `deploy-production` ▶ ([`gitlab-runner.md`](gitlab-runner.md) 4절). Job 로그 끝에 `[deploy] health: /api/health ok, auth mode keycloak, / 200`이 찍히면 기동된 것이다(첫 기동은 마이그레이션 때문에 몇 분 걸릴 수 있다). 서버에서 직접 보고 대역을 확인한다:

```bash
cd /data/home_<계정>/deployments/sop-archivist
docker compose ps                                              # 5개 서비스 Up, db healthy
curl -s http://localhost:7777/api/auth/mode; echo              # keycloakClientId=sop-archivist-frontend (Job 로그에는 본문을 찍지 않는다)
docker network inspect sop-archivist_default -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # 예: 172.18.0.0/16
```

compose 내부 네트워크 대역은 Docker가 자동으로 할당한다. backend(uvicorn)가 `X-Forwarded-For`를 믿을 프록시 대역이 이 서브넷이어야 접속 로그의 클라이언트 주소가 nginx 주소로 찍히지 않는다. 위 명령으로 나온 서브넷을 `.env`에 적는다:

```bash
# 배포 폴더의 .env
FORWARDED_ALLOW_IPS=<위에서 확인한 서브넷>
```

그리고 GitLab에서 **Run pipeline**(브랜치 `main`) → `deploy-production` ▶ ([`gitlab-runner.md`](gitlab-runner.md) 5절). 손으로 `up`을 치지 않는다. compose가 env가 바뀐 backend를 다시 만들고, 배포 스크립트가 proxy를 늘 재시작한다 — nginx는 upstream 호스트 이름을 시작할 때 한 번만 풀어서, backend만 다시 만들고 proxy를 두면 새 IP를 못 찾고 `/api`가 502를 낸다.

- **대역 정책 결정 대기(2026-11-04).** 서버가 고정 대역 정책이면 `docker-compose.yml` 맨 아래 `networks.default`에 `ipam` 블록을 추가하고 `FORWARDED_ALLOW_IPS`도 같은 대역으로 맞춘다. 서버의 다른 스택이 쓰는 대역과 겹치지 않아야 한다(`docker network inspect $(docker network ls -q) -f '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'`). **서브넷은 오버라이드 파일로 못 바꾼다** — compose가 `ipam.config`를 교체하지 않고 누적 병합해 `Pool overlaps with other one`으로 실패한다(bpm 실측). `docker-compose.yml`을 직접 고친다.
- 자동 할당 대역은 `docker compose down` 뒤 다시 올리면 바뀔 수 있다. 바뀌면 이 단계를 다시 한다(배포 Job은 `down`을 하지 않는다).

### A7. 시스템 관리자로 로그인 확인

브라우저에서 `http://<server-ip>:7777`로 접속해 `APP_SYSADMINS`에 넣은 계정으로 로그인한다.

- 홈(묶음 목록)이 열리고 상단 바에 `SOP Archivist v<배포한 버전>`(`CHANGELOG.md` 최신 항목)이 보인다.
- 상단 바의 내 이름(또는 로그인 ID)을 눌러 `/account`를 연다. HR 첫 동기화 전이므로 이름·부서는 비어 있다(정상). 그래도 시스템 관리자라 권한 7개가 모두 보이고 상단 바에 관리 메뉴가 있다.
- 로그인이 안 되면 [`deploy.md`](deploy.md) §4 트러블슈팅 표를 본다. 대개 A5 Keycloak 항목(redirect URI, Web origins, PKCE 필수 해제)이다.

### A8. 직원 디렉터리 첫 동기화 (HR)

**관리 > Directory sync**에서 한다. 처음엔 `HR_SYNC_INTERVAL_HOURS=0`이라 자동 동기화는 꺼져 있다.

1. **Preview changes** (드라이런 — 아무것도 바꾸지 않는다). 확인할 것:
   - "Rows read"가 기대한 전사 인원 규모이고, "Skipped rows"가 이상하게 많지 않다.
   - 처음이므로 "Would remove"(삭제 예정)와 "Login IDs that differ only in letter case"는 비어 있어야 한다(둘 다 DB에 이미 있는 행과 비교하는 값이다). 이후 동기화를 실행하기 전에도 미리보기에서 이 두 항목이 비어 있는지 본다 — 대소문자만 다른 loginId가 보이면 **중단**한다. 실 동기화가 새 행을 만들고 옛 행을 지워 그 사람의 권한 부여가 고아가 된다.
2. **Run sync now.** 결과 카드에서 "Nothing was changed"(중단) 문구가 없고, "Removed"가 미리보기의 "Would remove"와 같은지 본다. 안전장치가 있다: 행 수가 피드 헤더와 맞지 않거나, 빈 피드이거나, 삭제가 `HR_SYNC_DELETE_CAP_PCT`(%)를 넘으면 DB를 전혀 건드리지 않고 중단한다. 같은 동기화는 5분 안에 다시 실행되지 않는다("Directory sync just ran...").
3. 아래 "Recent runs"에 기록이 남았는지 보고, `/account`(상단 바 이름 링크)를 새로고침해 **내 이름·부서가 채워졌는지** 본다. 비어 있으면 Keycloak `preferred_username`이 HR의 loginId와 대소문자까지 같지 않은 것이다(A5 Mappers).
4. 문제가 없으면 배포 폴더 `.env`의 `HR_SYNC_INTERVAL_HOURS=24`로 올리고 파이프라인을 다시 돌린다(Run pipeline → ▶, [`gitlab-runner.md`](gitlab-runner.md) 5절). 이후 스케줄러가 마지막 회차 기준으로 24시간마다 돈다. 로그인할 때마다 본인 한 명은 하루 1회 HR에서 다시 가져온다(전체 동기화 없이 점진 충전).

HR 연결이 안 되면 "HR sync is not set up on this server."(503, URL·토큰 중 비어 있음) 또는 "Could not reach the HR source."(502)가 뜬다 → [`deploy.md`](deploy.md) §4.

### A9. 권한 관리 부서 지정 (`permission.manage` 위임)

HR 동기화로 부서가 채워진 뒤, 권한을 관리할 부서에 `permission.manage`를 준다. 시스템 관리자(`APP_SYSADMINS`) 없이 그 부서(와 하위 부서·팀) 사람들이 권한을 조절하게 된다.

1. **관리 > Access > Roles > New role.** 이름 예: `Permission Admin`, 권한 "Manage permissions".
2. 선택: 운영 담당용 역할(예: `Operations` = "Run directory sync" + "View system status" + "Manage AI")을 같은 방식으로 만든다.
3. **Grants > Add grant.** Grant to = Department, Who = 부서 트리에서 권한 관리 부서, Grant = A role → `Permission Admin`. **부서 부여는 하위 부서·팀 구성원 전원에게 내려간다.**
4. **Lookup**에서 그 부서 사람의 loginId를 조회해 유효 권한과 출처(어느 부서의 어느 역할)를 확인하고, 그 사람으로 로그인해 관리 > Access가 열리는지 본다.

- 모든 역할 생성·수정·삭제와 부여·회수는 **Audit log**에 남는다(누가·언제·무엇을·누구에게, KST).
- 조직 개편으로 사라진 부서의 부여는 지워지지 않고 "Department not found"로 보인다. 사람이 정리한다.
- `permission.manage` 보유자는 이 권한 자체도 부여할 수 있다. 부여는 더하기만 있고 금지 규칙은 없다.
- `APP_SYSADMINS`는 비상 열쇠로 남겨 둔다. 표로 부여할 수 없는 권한이고, 평소엔 인원을 최소로 유지한다.

### A10. db-viewer 읽기전용 연결

db 컨테이너는 첫 `up`부터 `dbv-shared`에 별칭 `sop-archivist-db`로 합류해 있다(compose에 반영됨). 읽기 전용 계정 발급과 db-viewer 소스 등록은 서버 수작업이다 → [`db-viewer-readonly.md`](db-viewer-readonly.md). **db-viewer는 읽기 전용 `dbviewer_ro` 계정으로만 붙는다**(앱 계정으로 붙지 않는다).

### A11. 백업 첫 확인

`BACKUP_DIR`(기본 `./backups`)와 `BACKUP_RETENTION_DAYS`는 `.env`에서 정했고 사이드카가 디렉터리를 만든다. 첫 기동 직후 오늘자 덤프가 없으면 즉시 1회 덤프하는데, 이때는 backend 마이그레이션보다 먼저일 수 있어 첫 덤프가 비어 있어도 정상이다. 확인과 의미 있는 첫 덤프는 [`backup.md`](backup.md) §2.

```bash
docker compose logs --tail 5 db-backup    # "[db-backup] ... ok sop-archivist_....dump (크기)"
```

---

## B. 릴리스 이후 1회

아직 없음(v0.1.0이 첫 릴리스). 어떤 릴리스가 배포 뒤에 데이터·설정을 한 번 보정해야 한다면 여기에 항목으로 쌓고, 각 항목에 **재실행해도 안전한지**를 적는다. 해당 릴리스의 배포 메모는 `CHANGELOG.md`에 있다.

---

## C. 절대 하지 말 것

- **서버에서 `python -m scripts.reset_db`.** 스크립트는 backend 이미지에 실려 있고 Alembic으로 모든 테이블을 `base`까지 내렸다 다시 올린다. 서버 postgres에서 막아 주는 조건은 "HR이 채운 직원이 있을 때" 하나뿐이라, **HR 첫 동기화 전에는 가드가 없다.** 그 전에 실행하면 역할·부여·변경 기록·접속 기록이 전부 사라진다. 로컬 데모 시드 전용이다.
- **운영에서 `docker compose down -v`.** `pgdata` 볼륨이 삭제된다. 롤백은 이전 파이프라인의 배포 Job Retry로 한다([`deploy.md`](deploy.md) §7). 배포 Job도 `down`을 하지 않는다.
- **서버 볼륨에 dev 모드(`AUTH_MODE=dev`)를 쓰지 않는다.** dev는 `X-Dev-User` 헤더를 그대로 믿는 로컬 우회이고, 기동할 때 가짜 부서 7개·직원 5명(`dev.admin`·`qa.lead`·`qa.member`·`prod.member`·`ops.member`, `source='dev'`)을 DB에 넣는다. HR 동기화는 `source='hr'` 행만 다루므로 이 가짜 직원은 keycloak으로 바꿔도 **디렉터리 선택기에 남는다.** 코드가 자동으로 지우지 않는다(파괴적 동작이라 의도적으로 두지 않았다). 서버를 한 번이라도 dev로 띄웠다면 손으로 정리한다:

  ```bash
  cd /data/home_<계정>/deployments/sop-archivist
  docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  ```

  ```sql
  SELECT login_id FROM employees WHERE source = 'dev';   -- 위 5명인지 확인
  DELETE FROM employees WHERE source = 'dev';
  ```

  그 사람들에게 걸린 부여는 지워지지 않고 관리 > Access > Grants에 "Person not found"로 남으니 거기서 회수한다. 가짜 부서(`CORP`, `DIV-QA`, `TEAM-QA1`, `DIV-PROD`, `TEAM-PROD1`, `DIV-IT`, `TEAM-IT1`)가 HR 부서 코드와 겹치지 않는지 확인하고 필요하면 `departments`에서 같은 방식으로 지운다.
- **Keycloak 클라이언트에서 PKCE를 필수로 거는 것.** 평문 HTTP 로그인이 막힌다(A5).
- **`docker exec -t`로 덤프를 뜨는 것.** TTY가 붙으면 바이너리 덤프에 CR이 섞여 아카이브가 깨진다. `-T`(compose) 또는 `-i`만 쓴다.
- **`.env`나 시크릿을 커밋·문서·채팅에 쓰는 것.** 공개 저장소다. 실서버 IP·사내 호스트명도 추적 파일에 넣지 않는다.
