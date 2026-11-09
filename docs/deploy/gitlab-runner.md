# GitLab Runner 배포 파이프라인

SOP Archivist는 **사내 GitLab 파이프라인으로만 배포한다.** 서버에 SSH로 들어가 `git pull`·`docker compose up -d --build`를 손으로 치지 않는다(사내 정책, 사용자 결정). 이 문서는 러너·파이프라인을 다루는 단일 문서다. 매 배포 확인 항목과 트러블슈팅 표는 [`deploy.md`](deploy.md), 서버 최초 셋업은 [`setup-once.md`](setup-once.md), 백업·복구는 [`backup.md`](backup.md).

> 서버 명령은 bash(리눅스) 기준이다. 실 IP·사내 호스트명·사람 계정은 쓰지 않는다 — `<gitlab-url>`, `<server-ip>`, `<계정>`을 실제 값으로 바꿔 읽는다.

**한눈에 보기**

```
GitHub Nocharm/sop-archivist (개발 원본)
   │  Windows PC: git pull → git push gitlab main (+ 태그)
   ▼
사내 GitLab 프로젝트 (CE, Private)
   │  main 파이프라인: test 3개 자동 → deploy-production ▶ (수동)
   ▼
서버 러너 컨테이너 gitlab-runner-sop-archivist
   ├─ sop-archivist-test    : 테스트 Job (도커 소켓 없음)
   └─ sop-archivist-deploy  : 배포 Job (Protected, 도커 소켓 + 배포 폴더)
                                 │ ci/deploy.sh
                                 ▼
              배포 폴더 /data/deployments/sop-archivist  (.env, backups/는 사람·사이드카 것)
                                 │ docker compose up -d --build (서버 Docker 데몬)
                                 ▼
                      sop-archivist 스택 :7777
```

- **파이프라인으로 옮긴 것은 배포뿐이다.** 운영·진단·비상 절차(`docker compose logs`·`ps`·`exec db psql`, 백업 복구, dev 행 정리, 서브넷 확인)는 지금처럼 **서버의 배포 폴더에서 사람이 손으로** 한다. 이런 일을 하는 수동 Job은 만들지 않았다.
- **환경은 운영 하나**(7777). 개발·품질 환경은 없다.
- **이미지 레지스트리·DinD를 쓰지 않는다.** 서버는 Docker Hub가 막혀 DinD가 베이스 이미지를 못 받는다. 배포 Job이 서버 Docker 소켓으로 서버 데몬에서 `docker compose up -d --build`를 돌린다(베이스 이미지는 서버에 tar로 반입해 둔 것). `docker-compose.yml`·Dockerfile은 그대로다.
- **배포 Job 안의 compose는 호스트 compose가 아니다.** 파이프라인은 `docker:27-cli` 이미지 안의 compose·buildx 플러그인을 쓰고(호스트 Compose v2.27보다 새것), 공유하는 것은 서버 데몬(Docker 26.1.3)뿐이다. 비상 수동 경로(8절)는 호스트 compose로 돌아 버전이 다르다.
- **배포할 수 있는 사람 = `main`에 merge할 수 있는 사람이다.** 배포 러너는 도커 소켓을 쓰므로 서버 root와 같고, CE에는 protected environments가 없다. 그래서 `main`의 push·merge를 Maintainer로 막는 것이 곧 배포 권한 관리다(1절).

파일:

| 파일 | 역할 |
|---|---|
| `.gitlab-ci.yml` | `workflow`(MR·`main` push·웹 실행만), test 3개(`backend-test`·`frontend-test`·`deploy-script-test`), `deploy-production`(`main`에서만 ▶, 테스트 통과가 전제, `resource_group`로 한 번에 하나) |
| `ci/deploy.sh` | 배포 Job 본체(POSIX sh, busybox). 가드 → 사전 점검 → 동기화 → `compose up -d --build` → proxy 재시작·db-backup 재생성 → 헬스체크 |
| `ci/test-deploy.sh` | 가짜 `docker`로 `ci/deploy.sh`를 검증(`deploy-script-test` Job, 로컬에서도 `sh ci/test-deploy.sh`) |

---

## 1. GitLab 프로젝트 설정

프로젝트는 개인 네임스페이스라 그룹에서 이어받는 멤버가 없다. 멤버를 늘릴 때 역할을 신중히 준다.

1. **Settings → Repository → Protected branches**: `main` — Allowed to merge **Maintainers**, Allowed to push and merge **Maintainers**. 강제 푸시는 끈다.
2. **Settings → General → Visibility**: 프로젝트 **Private**. **Settings → CI/CD → General pipelines**: **Public pipelines 끔**.
3. **Auto DevOps가 켜져 있으면 끈다**(Settings → CI/CD → Auto DevOps). `.gitlab-ci.yml` 없이 이미 푸시돼 있어 켜져 있었을 수 있다.
4. **Settings → CI/CD → General pipelines**에서 둘 다 켠다:
   - **Prevent outdated deployment jobs** — 더 새 배포가 끝난 뒤 옛 배포 Job이 늦게 돌아 덮어쓰지 않게.
   - **Allow job retries for rollback deployments** — 옛 파이프라인의 `deploy-production` Retry로 되돌리기(7절). 이것이 꺼져 있으면 위 설정이 옛 Job 재실행을 막는다.
5. **CI/CD 변수(선택)**: 배포 폴더가 기본값(`/data/deployments/sop-archivist`)이 아니면 `SOP_DEPLOY_DIR`만 둔다. 비밀값은 CI 변수에 넣지 않는다(`.env`는 배포 폴더에만). **다른 CI 변수는 compose에 닿지 않는다** — 배포 스크립트가 모든 `docker` 호출을 빈 환경(`env -i`)에서 하므로, 프로젝트·그룹·인스턴스 변수에 `AUTH_MODE`·`POSTGRES_*`·`COMPOSE_*`·`DOCKER_HOST`가 있어도 `.env` 값을 덮지 못한다.
6. **Settings → CI/CD → Runners → New project runner**를 두 번 만든다. 화면에서 정하고 `glrt-`로 시작하는 토큰을 받는다(토큰은 한 번만 보인다 — 바로 2절 등록에 쓴다).

   | 항목 | 테스트 러너 | 배포 러너 |
   |---|---|---|
   | Tags | `sop-archivist-test` | `sop-archivist-deploy` |
   | Run untagged jobs | 끔 | 끔 |
   | Protected | 끔 | **켬**(보호된 `main`에서만 돈다) |
   | Description | `sop-archivist test` | `sop-archivist deploy` |

## 2. 서버 1회 — 러너 컨테이너와 등록

SOP 전용 러너 컨테이너를 새로 띄운다. **다른 팀의 러너 컨테이너는 건드리지 않는다**(설정을 읽기만 한다).

### 2-1. 기존 러너에서 네트워크·TLS 설정 읽기

GitLab이 같은 서버에서 돈다. `external_url`이 브리지 네트워크 컨테이너에서 풀리지 않거나 사설 CA를 쓰면, 모든 Job이 clone·등록 단계에서 죽는다. 이미 동작하는 기존 러너가 어떻게 풀었는지 **키 이름으로만** 읽는다(토큰 줄이 나오지 않게 — `config.toml`을 통째로 출력하지 않는다).

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i runner      # 기존 러너 이름 확인
docker exec <기존 러너> grep -E '^\s*(clone_url|network_mode|extra_hosts|dns|tls-ca-file|helper_image|pull_policy)\s*=' /etc/gitlab-runner/config.toml
docker inspect <기존 러너> --format 'net={{.HostConfig.NetworkMode}} hosts={{.HostConfig.ExtraHosts}} dns={{.HostConfig.Dns}}'
docker inspect <기존 러너> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'   # CA 인증서 폴더를 마운트했는지
```

나온 값을 아래에 그대로 옮긴다. `network_mode`·`extra_hosts`·`dns`·`clone_url`·`tls-ca-file`은 Job 컨테이너 설정(등록 플래그), `docker inspect`의 net·hosts·dns·CA 마운트는 러너 컨테이너 자신의 설정(`docker run` 옵션)이다.

### 2-2. 러너 이미지

기존 러너는 태그 없는 이미지 `888891694a3f`(gitlab-runner)로 돈다. 버전을 확인하고 이름을 붙인다. **helper 이미지 버전(`x86_64-v19.0.0`)과 러너 버전이 같아야 한다.**

```bash
docker run --rm --entrypoint gitlab-runner 888891694a3f --version   # Version: 19.0.0 인지 본다
docker tag 888891694a3f gitlab/gitlab-runner:alpine-v19.0.0
docker image inspect gitlab/gitlab-runner-helper:x86_64-v19.0.0 docker:27-cli python:3.11-slim node:24.22.1-alpine --format '{{.RepoTags}}'
```

버전이 19.0.0이 아니면 그 버전에 맞는 helper 이미지를 tar로 반입하고 아래의 helper 태그도 바꾼다([`deploy.md`](deploy.md) §0 반입 방법).

### 2-3. 러너 컨테이너

```bash
sudo mkdir -p /data/gitlab-runners/sop-archivist     # sudo가 없으면 홈 아래 폴더(예: ~/gitlab-runners/sop-archivist)
docker run -d --name gitlab-runner-sop-archivist --restart unless-stopped \
  -v /data/gitlab-runners/sop-archivist:/etc/gitlab-runner \
  -v /var/run/docker.sock:/var/run/docker.sock \
  gitlab/gitlab-runner:alpine-v19.0.0
# 2-1에서 기존 러너 컨테이너가 --network host·--add-host·--dns·CA 마운트를 썼다면 같은 옵션을 위에 더한다.
```

### 2-4. 러너 두 개 등록

토큰은 `read -rs`로 받아 화면·셸 기록에 남기지 않고, 환경 변수로 넘겨 프로세스 목록에도 남기지 않는다(`docker exec -e 이름`은 값 없이 호스트 환경에서 가져온다). 배포 폴더(3절)는 등록 전에 만들어도 되고 뒤에 만들어도 된다 — 단 경로는 여기 적은 것과 같아야 한다.

공통 값을 먼저 정한다(2-1 결과를 반영):

```bash
GITLAB_URL='<gitlab-url>'
DEPLOY_DIR=/data/deployments/sop-archivist          # 바꾸면 GitLab CI 변수 SOP_DEPLOY_DIR도 같은 값으로
COMMON="--non-interactive --url $GITLAB_URL --executor docker \
  --docker-pull-policy never \
  --docker-helper-image gitlab/gitlab-runner-helper:x86_64-v19.0.0 \
  --limit 1"
# 2-1에서 값이 나온 키만 더한다. 예:
# COMMON="$COMMON --clone-url <값> --docker-network-mode <값> --docker-extra-hosts <host:ip> --docker-dns <값> --tls-ca-file <값>"
```

테스트 러너(`sop-archivist-test` 토큰):

```bash
read -rs CI_SERVER_TOKEN && export CI_SERVER_TOKEN
docker exec -e CI_SERVER_TOKEN gitlab-runner-sop-archivist gitlab-runner register $COMMON \
  --name sop-archivist-test --docker-image python:3.11-slim
unset CI_SERVER_TOKEN
```

배포 러너(`sop-archivist-deploy` 토큰) — 도커 소켓과 배포 폴더를 **양쪽 같은 경로로** 마운트한다:

```bash
read -rs CI_SERVER_TOKEN && export CI_SERVER_TOKEN
docker exec -e CI_SERVER_TOKEN gitlab-runner-sop-archivist gitlab-runner register $COMMON \
  --name sop-archivist-deploy --docker-image docker:27-cli \
  --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
  --docker-volumes "$DEPLOY_DIR:$DEPLOY_DIR:rw"
unset CI_SERVER_TOKEN
```

- `$COMMON`은 일부러 따옴표 없이 쓴다(여러 플래그로 나뉘어야 한다). 값에 공백이 있으면 직접 풀어 쓴다.
- `CI_SERVER_TOKEN` 환경 변수를 이 버전이 읽지 못하면 등록이 토큰을 물으며 실패한다. 그때만 `--token "$CI_SERVER_TOKEN"`을 플래그로 더한다(값이 잠깐 프로세스 목록에 보인다).
- **`pull_policy = never`인 이유**: 서버에 있는 이미지만 쓴다. `if-not-present`는 없는 이미지를 막힌 Docker Hub에서 받으려다 느린 타임아웃으로 죽어 원인이 흐려진다. 없는 이미지는 바로 "not present locally"로 실패한다(6절).
- **배포 폴더 마운트가 `같은경로:같은경로`여야 하는 이유**: compose의 상대 bind 경로(`./nginx/default.conf`, `./scripts/db-backup.sh`, `./backups`)는 배포 폴더 기준 절대 경로로 바뀌어 **호스트 데몬이** 찾는다. 경로가 다르면 데몬이 없는 호스트 경로를 빈 root 폴더로 만들어 nginx·db-backup이 "not a directory"로 죽는다. 배포 스크립트가 새 컨테이너로 호스트 쪽 경로를 확인해 막는다.

### 2-5. 동시 실행 수와 확인

`concurrent`(러너 컨테이너 전체 동시 Job 수)를 2로 둔다. 설정 파일이 root 소유라 컨테이너 안에서 바꾼다:

```bash
docker exec gitlab-runner-sop-archivist sed -i 's/^concurrent = .*/concurrent = 2/' /etc/gitlab-runner/config.toml
docker exec gitlab-runner-sop-archivist grep -E '^concurrent' /etc/gitlab-runner/config.toml   # concurrent = 2
docker exec gitlab-runner-sop-archivist gitlab-runner verify
```

GitLab 화면(Settings → CI/CD → Runners)에서 두 러너가 **Online**인지 본다. 토큰이 든 `config.toml`은 통째로 출력하지 않는다.

## 3. 배포 폴더

배포 Job이 checkout을 복사해 넣고 compose를 돌리는 곳이다. **사람이 두는 것은 `.env` 하나**이고, `backups/`는 백업 사이드카가 만든다. **그 밖의 파일은 배포 때마다 지워진다** — tar 보관 같은 다른 용도로 쓰지 않는다.

```bash
sudo mkdir -p /data/deployments/sop-archivist
sudo chown "$USER": /data/deployments/sop-archivist
chmod 750 /data/deployments/sop-archivist
```

`.env`는 PC에서 `.env.example`을 복사해 채운 뒤(항목·값: [`setup-once.md`](setup-once.md) A4) scp로 넣는다(scp는 bash·PowerShell 동일):

```bash
scp .env <계정>@<server-ip>:/data/deployments/sop-archivist/.env
# 서버
chmod 600 /data/deployments/sop-archivist/.env
```

- `.env`는 git·CI 변수에 넣지 않는다. 배포 Job은 읽기만 하고 값을 출력하지 않는다(가드는 키 이름과 판정만 쓴다).
- 배포 Job은 컨테이너 root로 돌아 **복사된 파일은 root 소유가 된다**(정상). `.env`는 건드리지 않아 내 소유 그대로다.
- `backups/`는 사이드카가 root `0700`으로 만든다([`backup.md`](backup.md)).
- 배포 폴더에 `.git`은 없다. 무엇이 배포됐는지는 `cat /data/deployments/sop-archivist/.deployed`(커밋·파이프라인·Job·버전·시각, 비밀 없음).

배포 스크립트가 거절하는 `.env` 값: `AUTH_MODE`가 `keycloak`이 아님(없음 포함), `BACKUP_DIR`이 `./backups`가 아닌 배포 폴더 안 경로(동기화가 지운다). `BACKUP_DIR`은 비우거나 `./backups`, 또는 배포 폴더 밖 절대 경로(NAS 등)만 된다.

## 4. 평소 흐름

1. Windows PC에서 GitHub를 받고 사내 GitLab으로 올린다:

   ```bash
   git pull
   git push gitlab main
   git push gitlab vX.Y.Z      # 이번 버전 태그(CHANGELOG.md). 태그 push는 파이프라인을 만들지 않는다
   ```

2. GitLab **Build → Pipelines**에서 `main` 파이프라인의 test 3개가 통과하는지 본다. 끝나면 파이프라인이 **blocked**(▶ 대기)로 보인다 — 정상.
3. `deploy-production`의 **▶**를 누른다. 배포 전에 `CHANGELOG.md`의 그 버전 배포 메모를 읽는다.
4. Job 로그 끝에서 `[deploy] health: /api/health ok, auth mode keycloak, / 200`과 `docker compose ps`, `[deploy] done`을 본다. proxy 재시작·db-backup 재생성·헬스체크는 스크립트가 한다.
5. 브라우저 확인 — [`deploy.md`](deploy.md) §3의 브라우저 항목(로그인, **상단 바 버전이 배포한 버전과 같은지**).
6. `CHANGELOG.md` 그 버전 항목에 배포일을 적는다(GitHub에서 커밋, 다음 push 때 GitLab에도 간다).

## 5. `.env`만 바꿀 때

예: `FORWARDED_ALLOW_IPS`, `HR_SYNC_INTERVAL_HOURS`, `APP_SYSADMINS`, AI 설정.

1. 서버 배포 폴더의 `.env`를 고친다(`/data/deployments/sop-archivist/.env`).
2. GitLab **Build → Pipelines → Run pipeline**, 브랜치 `main` → test가 끝나면 `deploy-production` ▶.

손으로 `docker compose up`을 치지 않는다. 코드가 같아 이미지는 캐시로 빌드되고, compose가 바뀐 env의 backend만 다시 만들며, 스크립트가 proxy를 재시작한다(옛 backend 주소로 502가 나지 않게).

## 6. 트러블슈팅

| 증상 | 확인 |
|---|---|
| Job이 `pending`에서 멈춤 | 러너가 **Online**인지(Paused 아님), Job 태그와 러너 태그 철자(`sop-archivist-test`·`sop-archivist-deploy`), Run untagged 끔은 정상. `deploy-production`은 **Protected 러너**라 보호된 `main`에서만 잡힌다 — `main`이 Protected branches에 있는지 본다. 러너 로그: `docker logs --tail 50 gitlab-runner-sop-archivist` |
| clone 단계 실패(`Could not resolve host`, `SSL certificate problem`) | Job 컨테이너에서 GitLab 주소가 안 풀리거나 CA를 모른다. 2-1의 `clone_url`·`network_mode`·`extra_hosts`·`dns`·`tls-ca-file`을 기존 러너와 맞춘다. 고친 뒤 `docker exec gitlab-runner-sop-archivist gitlab-runner verify` |
| `image ... not present locally` / `pull_policy ([never])` | `pull_policy = never`라 서버에 없는 이미지는 받지 않는다. 그 이미지를 amd64 tar로 반입한다([`deploy.md`](deploy.md) §0). helper 이미지도 같다(러너 버전과 helper 태그가 같아야 한다, 2-2) |
| `backend-test`의 pip, `frontend-test`의 npm이 접속 실패 | 테스트 Job 컨테이너가 PyPI·npm 레지스트리에 닿지 않는다. 같은 서버에서 이미지 빌드(`pip install`·`npm ci`)가 되는지와 2-1의 네트워크 설정(`network_mode`·`dns`)을 본다 |
| `[deploy] FAILED: deploy folder does not exist inside the job` | 배포 러너의 `--docker-volumes "$DEPLOY_DIR:$DEPLOY_DIR:rw"`가 빠졌거나 경로가 `SOP_DEPLOY_DIR`과 다르다(2-4) |
| `... must be an absolute path` / `is '/'` / `two levels deep` / `must not contain` | `SOP_DEPLOY_DIR` CI 변수 값이 잘못됐다. `/data/deployments/sop-archivist` 같은 전용 절대 경로로 |
| `... is the job checkout or inside it` / `job checkout is inside the deploy folder` | `SOP_DEPLOY_DIR`이 `/builds` 쪽을 가리킨다. 마운트한 배포 폴더로 바꾼다 |
| `no .env in the deploy folder` | 3절대로 `.env`를 넣는다 |
| `.env AUTH_MODE is not 'keycloak'` | `.env`에 `AUTH_MODE=keycloak`을 적는다. 서버에서 dev로 띄웠던 적이 있으면 [`setup-once.md`](setup-once.md) C절 |
| `.env BACKUP_DIR points inside ...` / `is a relative path other than ./backups` | `BACKUP_DIR`을 비우거나 `./backups`, 또는 배포 폴더 밖 절대 경로로 |
| `the host does not see the deploy folder at the same path` | 배포 러너 마운트가 `다른경로:배포폴더`다. 양쪽 같은 경로로 다시 등록한다(2-4). `config.toml`의 `volumes` 줄을 고쳐도 된다 |
| `cannot reach the Docker daemon` | 배포 러너에 `/var/run/docker.sock` 마운트가 없다(2-4) |
| `shared network '...' (DBV_NETWORK) does not exist` | [`setup-once.md`](setup-once.md) A2대로 공유 네트워크를 만든다(db-viewer 운영자가 정한 대역). 배포 Job은 네트워크를 만들지 않는다 |
| `base image(s) missing on the server: ...` | 이름이 찍힌 이미지를 tar로 반입한다([`deploy.md`](deploy.md) §0). 프룬 뒤에 흔하다 |
| `docker compose config rejected the deploy folder` | `.env` 문법이나 필수 값(`POSTGRES_PASSWORD`) 문제. 출력은 비밀값이 펼쳐져 숨겼다 — 서버 배포 폴더에서 `docker compose config --quiet`를 직접 돌려 오류 줄만 본다(`--quiet` 없이 돌리지 않는다) |
| `docker compose up failed` | 바로 위 로그가 빌드·기동 오류다. 베이스 이미지·`# syntax=`·네트워크는 [`deploy.md`](deploy.md) §4 표 |
| `the app did not become healthy in time` / `/api/auth/mode reports a mode other than keycloak` | Job 로그 끝의 `docker compose ps`와 backend·proxy 로그 80줄을 본다. 더 보려면 서버 배포 폴더에서 `docker compose logs --tail 200 backend`. 첫 기동의 마이그레이션이 5분을 넘기면 다시 ▶(이미 뜬 것은 그대로 이어진다). 대부분은 [`deploy.md`](deploy.md) §4 표의 backend 기동 실패 행이다 |
| 로컬에서 `sh ci/test-deploy.sh`가 실패 | 배포 스크립트를 고쳤다면 테스트의 기대 문구도 같이 본다. busybox(`docker:27-cli`)와 GNU 둘 다에서 돌아야 한다 |

## 7. 되돌리기(롤백)

평소에는 `main`에 revert 커밋을 올려 **앞으로 고친다**(GitHub → GitLab push → ▶).

급하면 **이전 `main` 파이프라인의 `deploy-production`을 Retry한다.** 그 Job은 그때의 커밋을 checkout해 같은 절차로 배포한다. 1절 4의 두 설정이 켜져 있어야 한다.

- **v0.7.1보다 앞선 버전으로는 되돌릴 수 없다.** 그 버전들에는 `.gitlab-ci.yml`·`ci/`가 없어 파이프라인이 없다(첫 배포가 v0.7.1이라 문제없다). 태그 파이프라인은 만들지 않는다.
- **DB 마이그레이션이 든 버전을 되돌릴 때는 코드만 되돌리면 안 된다.** Alembic은 자동으로 downgrade하지 않아 옛 코드가 더 새 DB를 만나면 `Can't locate revision`으로 뜨지 않는다. `CHANGELOG.md`에서 그 버전의 DB 리비전 여부를 보고, 있으면 배포 직전 덤프로 복구한 뒤 옛 파이프라인을 Retry한다 → [`backup.md`](backup.md) §3. DB 복구는 자동화하지 않았다.
- 배포 폴더에는 `.git`이 없어 `git checkout <tag>`가 통하지 않는다.

## 8. 비상 수동 경로

**러너가 죽어 고칠 수 없을 때만** 쓴다. 평소에는 쓰지 않는다 — 파이프라인 밖 배포는 기록이 남지 않고 가드도 돌지 않는다.

배포 폴더에 원하는 코드가 이미 있다면(마지막 파이프라인이 넣은 것, `.deployed`로 확인) 같은 compose 명령을 친다. **호스트 compose(v2.27)로 돌아 파이프라인(이미지 안 compose)과 버전이 다르다.**

```bash
cd /data/deployments/sop-archivist
docker compose up -d --build
docker compose restart proxy
docker compose up -d --force-recreate db-backup     # scripts/db-backup.sh가 바뀐 경우만
curl -s http://localhost:7777/api/health            # {"status":"ok"} — 나머지 확인은 deploy.md §3
```

새 코드를 넣어야 한다면 PC에서 `git archive --format=tar.gz -o sop-archivist.tar.gz vX.Y.Z`로 묶어 scp한 뒤, 배포 폴더에서 `.env`·`backups/`를 남기고 풀어 위 명령을 친다. 러너를 고친 뒤에는 다음 배포를 파이프라인으로 해서 배포 폴더를 파이프라인 상태(`.deployed`)로 되돌린다.

## 확인 범위

- 로컬에서 확인한 것: `ci/test-deploy.sh`(busybox `docker:27-cli`·GNU·macOS/dash), `.gitlab-ci.yml` 문법 파싱, CI가 돌릴 테스트 명령.
- **GitLab·서버에서만 확인되는 것(미검증)**: 러너 등록과 `CI_SERVER_TOKEN` 전달, 실제 파이프라인 실행, helper 이미지에 `pull_policy = never`가 적용되는지, Prevent outdated/rollback Retry 동작, 실제 서버 데몬에서의 동기화·빌드·헬스체크. 첫 배포에서 이 문서의 절차를 고치면 함께 갱신한다.
