# Docker Rules

- Use **BuildKit**, but **no `# syntax=` directive** — the server (사내 71번) cannot reach Docker Hub, and the directive makes every build resolve the `docker/dockerfile` frontend image from the registry (fails once a prune removes the cached copy; seen on the sibling project bpm, 2026-10-02). The built-in frontend (Docker 20.10+) already supports multi-stage and `RUN --mount`.
- Base images are brought in as **linux/amd64 tars** (`docker save` → scp → `docker load`, `docs/deploy/deploy.md` §0) — changing a `FROM` tag means shipping a new tar to the server.
- Use `--mount=type=cache` for apt and uv/pip caches (`rm -rf /var/lib/apt/lists/*` unnecessary).
- Run containers as a **non-root user**.
- Environment config in Dockerfile is a fallback — `.env` via docker-compose is the source of truth.
- Keep images minimal: install only production dependencies.
