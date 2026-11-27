# Sync Checklist

Run when sync is explicitly requested — via `/sync` (change-based) or `/sync-all` (full sweep), not automatically on every code change (frequent syncing adds overhead without payoff). When asked, check these files; some may need no change.

| File | When to update |
|------|----------------|
| `backend/requirements*.txt` · `frontend/package.json` + lock | Adding/removing/updating packages (backend: confirm a Python 3.11 linux x86_64 wheel; `numpy` stays pinned to what `onnxruntime` pulls) |
| `backend/Dockerfile` · `frontend/Dockerfile` | System packages, build steps, ENV, ports — read `rules/backend/docker.md` first (base image tags same as bpm, no `# syntax=`, no `--workers`) |
| `backend/.dockerignore` · `frontend/.dockerignore` | New folders/files that shouldn't be in build context |
| `docker-compose.yml` | Ports, volumes, services; every new backend env mapped under `environment:` as `VAR: ${VAR:-}` (backend has no `env_file`) |
| `backend/app/settings.py` · `.env.example` | New config value — both, plus compose above. Never `.env` or secret values |
| `README.md` | Commands, structure, setup, current version |
| `docs/qa/verification-commands.md` | A script's prerequisites (DB, ports, env) or audit options changed |
| `docs/qa/feature-map.md` | A screen's address, operation, known trap or smoke `ONLY` head changed |
| `frontend/public/manual/user-manual.md` | Screen, behavior or label changed (text in the same commit; images at release prep) |

**Sync order:** code → dependencies → Dockerfile → .dockerignore → docker-compose → settings/.env.example → README → docs (verification-commands, feature-map, manual)
