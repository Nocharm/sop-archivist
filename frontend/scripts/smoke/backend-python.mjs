// backend 파이썬 찾기 - 부작용 없는 모듈이라 스모크(common.mjs가 다시 내보냄) 밖의 스크립트(pw-manual-shots)도 가져올 수 있다.
// common.mjs는 가져오기만 해도 ONLY 없는 실행을 멈추므로 여기에 따로 둔다.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(SCRIPT_DIR, "../../../backend");

/** backend 파이썬(xlsx 읽기 · 합성 SOP 만들기) - BACKEND_PYTHON → 이 체크아웃의 backend/.venv → 원본 체크아웃(git common dir의 부모)의 backend/.venv.
 *  워크트리에는 venv가 없어, BACKEND_PYTHON을 빠뜨리면 xlsx 단계가 "file argument … undefined"로 거짓 실패했다(2026-11-20) */
export function findBackendPython() {
  if (process.env.BACKEND_PYTHON) return process.env.BACKEND_PYTHON;
  const findVenv = (root) => [".venv/bin/python", ".venv/Scripts/python.exe"].map((path) => resolve(root, "backend", path)).find(existsSync);
  const own = findVenv(resolve(BACKEND_DIR, ".."));
  if (own) return own;
  const common = String(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: SCRIPT_DIR })).trim();
  const main = findVenv(dirname(common));
  if (main) return main;
  throw new Error(`backend venv python not found in ${resolve(BACKEND_DIR, ".venv")} or ${resolve(dirname(common), "backend/.venv")}. Fix: in backend/ run python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt, or set BACKEND_PYTHON=<absolute path>`);
}
