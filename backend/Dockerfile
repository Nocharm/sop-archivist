# 파서 지시어(syntax 선언) 금지 — 서버(사내 71번)는 Docker Hub 차단이라 프룬 뒤 docker/dockerfile 이미지 조회로 빌드가 죽는다.
# 베이스 이미지는 amd64 tar로 반입(docker load)한다 — 태그를 바꾸면 서버에 새 tar가 필요하다.
FROM python:3.11-slim

WORKDIR /app

# 프로덕션 의존성만 설치 (requirements-dev.txt 제외).
# 사내망에서 GHCR(uv 이미지)이 차단되므로 python 내장 pip 사용 — 외부 Docker 레지스트리 의존 제거.
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

COPY app/ app/
# 기동 시 lifespan이 alembic.ini 기준으로 마이그레이션을 head까지 적용한다(app/db.py run_migrations).
COPY alembic/ alembic/
COPY alembic.ini .
# 로컬 데모 시드/리셋 스크립트 — reset_db는 drop_all 포함, 운영 데이터엔 주의.
COPY scripts/ scripts/

# 비루트 사용자로 실행
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
# 단일 워커 전제 — 마이그레이션을 lifespan에서 적용하므로 워커가 둘이면 경합한다. --workers 추가 금지.
# 설정값은 Dockerfile ENV가 아니라 docker-compose의 environment가 소스 오브 트루스(Settings 기본값이 폴백).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
