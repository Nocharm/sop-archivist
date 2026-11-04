# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**SOP Archivist — SOP Restructuring T/F가 쓰는 사내 AI 에이전트 웹 서비스** (FastAPI + Next.js, 사내 서버에 docker compose로 배포). 제품 기능(SOP 구조 검토·이전/이후 비교·초안 작성)은 기반 세팅 다음 단계에서 설계한다. **명세: [`docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md`](docs/superpowers/specs/2026-11-04-sop-archivist-baseline-design.md)**, 구현 계획: `docs/superpowers/plans/2026-11-04-sop-archivist-baseline.md`, 진행 현황: `PROGRESS.md`.

> 상태: **v0.1.0 기반 세팅 진행 중** — 사내 로그인(Keycloak)·직원 디렉터리(HR 웹훅)·사내 AI·표 기반 권한 체계를 얹은 빈 앱. 형제 프로젝트 bpm의 사내 인프라를 도메인 결합 없이 이식한다.
> **원칙**: AI 페이로드에 직원 실명을 싣지 않는다(역할·부서 등 비식별 정보만). 공개 저장소이므로 실서버 IP·사내 호스트명·시크릿은 추적 파일에 넣지 않는다(플레이스홀더 `<server-ip>` 등).

## Commands · Architecture

> Commands(bash + PowerShell)와 Architecture 섹션은 Task 12(운영 문서·CLAUDE.md 마무리)에서 채운다.

## Operations / Deployment

로컬 개발(네이티브)과 서버 배포(docker compose)가 다른 환경이라, 아래 제약을 어기면 로컬은 초록인데 서버에서 깨진다.

| 제약 | 이유 | 반영 |
|---|---|---|
| 서버 71번, bpm 옆 | 사용자 결정 | 별도 compose 스택·별도 postgres(내 판단). 앱 nginx 노출 포트 **7777**(사용자 결정, 9900·9910은 bpm 사용 중) |
| 서버는 Docker Hub 차단 | 베이스 이미지는 연결된 PC에서 amd64 tar로 반입 | bpm과 **같은 태그만** 쓴다: `python:3.11-slim`, `node:24.22.1-alpine`, `nginx:1.27-alpine`, `postgres:16-alpine`(이미 서버에 있음 → 새 tar 반입 불필요). Dockerfile에 `# syntax=` 금지 |
| 배포 런타임 Python 3.11 | 로컬 3.12 문법으로 서버 기동 불능 사고(bpm 2026-08-31) | `backend/ruff.toml` `target-version = "py311"` |
| backend 서비스에 `env_file` 없음 | `.env`에만 넣은 값이 컨테이너에 안 들어간 사고(bpm `CSV_MANUAL_URL`) | 모든 backend env를 compose `environment:`에 `VAR: ${VAR:-}`로 매핑. `.env.example`·Settings·compose 3곳 동시 갱신 |
| 서버는 평문 HTTP 원격 IP | secure context 아님 → `crypto.randomUUID`·`crypto.subtle`·Clipboard API 불가 | `genId`, `copyText` 폴백, Keycloak `disablePKCE`. 검증은 localhost가 아닌 LAN IP로 |
| 줄바꿈 | Windows PC 경유 CRLF 오염 | `.gitattributes` `* text=auto eol=lf`(ps1/bat/cmd만 CRLF) |
| 로컬 검증 PC는 Windows, Docker 없음 | 운영 파이프라인 | 로컬 명령은 bash·PowerShell 병기. 로컬 DB는 sqlite 파일 |
| 로컬 포트 3000/8000은 db-viewer가 점유 | 맥 개발 환경 | 로컬 dev 포트 frontend **3777**, backend **8777**(내 판단) |
| 공개 저장소 | `Nocharm/sop-archivist`는 public(사용자 결정) | 실서버 IP·사내 호스트명은 플레이스홀더(`<server-ip>` 등). 회사명·사설 대역은 유지(bpm 정책과 동일). 시크릿·`.env`는 절대 추적하지 않는다 |

---

## Working Style — 최우선 (모든 룰보다 먼저)

**모든 작업의 행동 기반.** 아래 도메인 룰과 충돌해도 이 가이드의 원칙이 우선한다.

@rules/guidelines.md

---

## Rules — 범용

@rules/common/comments.md
@rules/common/naming.md
@rules/common/git.md
@rules/common/security.md
@rules/common/error-handling.md
@rules/common/dependencies.md
@rules/common/documentation.md
@rules/common/testing.md

## Rules — 백엔드/Docker

@rules/backend/config.md
@rules/backend/docker.md
@rules/backend/sync-checklist.md

## Rules — 프론트엔드

@rules/frontend/identifiers.md

## Language-Specific Rules

@rules/languages/python.md
@rules/languages/typescript.md
