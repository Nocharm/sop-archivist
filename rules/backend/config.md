# Config Management

Classify every new config value before placing it:

| Category | Question | Where to put it |
|---|---|---|
| **Environment** | "Will this change per deployment?" | `.env` + Settings + Dockerfile `ENV` + docker-compose `${VAR}` |
| **Tuning** | "Might we tweak this without code changes?" | `.env` + Settings |
| **Business constant** | "Does changing this alter core logic?" | Settings field default only (no `.env`) |

**Rules:**
- `.env` is never committed to git (`.gitignore`).
- Secrets (API keys, passwords) are NEVER hardcoded.
- New Settings fields must have a corresponding `.env` entry with comments (except business constants).
- **New Environment-category Settings fields MUST also be mapped in the backend `environment:` block of `docker-compose.yml`** (`VAR: ${VAR:-}`). The backend service has **no `env_file:`**, so a var in `.env` reaches the container *only* if explicitly listed there — miss it and the field silently stays at its default in the deployed image while working fine locally (precedent: the sibling project bpm lost a setting this way). `.env.example` + Settings + compose must move together.
- No duplicate definitions between module-level constants and Settings fields.
