// 기반 화면 스모크(Playwright + 시스템 Chrome) - dev 로그인, 상단 바, 홈의 내 권한, 언어 전환, 로그아웃/재로그인.
// 전제: backend를 DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin 으로 8777에 띄우고(reset_db 직후), frontend `npm run dev`(3777).
// 실행(frontend/ 에서): node scripts/pw-smoke-baseline.mjs   환경 변수: BASE_URL, CHROME_PATH
// playwright-core는 저장소 의존성이 아니다: `npm i --no-save playwright-core` (package.json 불변)
// 시나리오는 아래 runStep(...)으로 등록한다 - 후속 태스크는 "시나리오" 구역 끝에 runStep을 덧붙이면 된다.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3777";
const SHOT_DIR = resolve(SCRIPT_DIR, "../../.shots"); // 저장소 루트 .shots/ (gitignore)
const APP_VERSION = JSON.parse(readFileSync(resolve(SCRIPT_DIR, "../package.json"), "utf-8")).version;
const T = 15000; // 화면 대기 상한(ms) - dev 서버 첫 컴파일이 느리다

mkdirSync(SHOT_DIR, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  const oneLine = detail.replace(/\s+/g, " ").trim(); // 여러 줄 innerText도 한 줄로
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${oneLine ? ` - ${oneLine}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

// 시나리오 하나 = 새 브라우저 컨텍스트(저장소 격리). devUser를 주면 첫 방문 전에 sopa.devUser를 심는다.
// allowConsoleErrors: 일부러 4xx/5xx를 일으키는 시나리오는 "콘솔 오류 없음" 검사를 건너뛴다.
async function runStep(name, { devUser = null, allowConsoleErrors = false } = {}, run) {
  console.log(`\n# ${name}`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (devUser) {
    await ctx.addInitScript((loginId) => {
      // about:blank 등에서는 localStorage 접근이 SecurityError - 건너뛴다. 이미 값이 있으면(로그아웃 뒤 등) 덮어쓰지 않는다.
      if (location.protocol === "about:") return;
      if (!window.localStorage.getItem("sopa.devUser")) window.localStorage.setItem("sopa.devUser", loginId);
    }, devUser);
  }
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  // "Failed to load resource" 콘솔 줄에는 주소가 없다 - 4xx/5xx 응답 주소를 같이 남겨 원인을 바로 본다
  page.on("response", (r) => {
    if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  const takeShot = (file) => page.screenshot({ path: resolve(SHOT_DIR, file), fullPage: true });
  try {
    await run({ page, check, takeShot });
    if (!allowConsoleErrors) {
      check(`${name}: no console errors`, consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 300));
    }
  } catch (e) {
    check(`${name}: completed`, false, e instanceof Error ? e.message.split("\n")[0] : String(e));
    await takeShot(`baseline-failed-${name.replace(/\W+/g, "-")}.png`).catch(() => {});
  } finally {
    await ctx.close();
  }
}

const getText = (page, id) => page.locator(`[data-testid="${id}"]`).innerText();
const wait = (page, id) => page.locator(`[data-testid="${id}"]`).waitFor({ state: "visible", timeout: T });

// ── 시나리오 ────────────────────────────────────────────────

// 1) 부서 부여로 권한을 받는 qa.lead(DIV-QA -> Permission Admin)가 홈에서 자기 신원·권한을 본다
await runStep("home as qa.lead", { devUser: "qa.lead" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "top-bar-version");
  check("service name", (await getText(page, "top-bar-service")).trim() === "SOP Archivist");
  check("version matches package.json", (await getText(page, "top-bar-version")).trim() === `v${APP_VERSION}`, await getText(page, "top-bar-version"));
  await wait(page, "home-permissions");
  check("top bar shows name", (await getText(page, "top-bar-user")).includes("QA Lead"), await getText(page, "top-bar-user"));
  check("top bar shows department", (await getText(page, "top-bar-user")).includes("Quality Division"));
  const perms = await getText(page, "home-permissions");
  check("home lists Manage permissions", perms.includes("Manage permissions"), perms);
  check("home hides ungranted permissions", !perms.includes("Manage AI") && !perms.includes("Run directory sync"), perms);
  check("home identity shows login id", (await getText(page, "home-identity")).includes("qa.lead"));
  check("AI status is shown", (await getText(page, "home-ai-status")).trim().length > 0, await getText(page, "home-ai-status"));
  check("admin link visible", await page.locator('[data-testid="top-bar-admin-link"]').isVisible());
  check("dev switcher shows current user", (await page.locator('[data-testid="dev-user-switcher"]').inputValue()) === "qa.lead");
  await takeShot("baseline-home.png");
});

// 2) 사용자 전환기 - 새로고침 없이 신원·권한이 따라 바뀐다(부서 상속·개인 직접 부여·sysadmin)
await runStep("switch dev users", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "home-permissions");
  const switcher = page.locator('[data-testid="dev-user-switcher"]');

  await switcher.selectOption("prod.member");
  await page.waitForFunction(() => document.querySelector('[data-testid="top-bar-user"]')?.textContent?.includes("Production Member"), null, { timeout: T });
  const direct = await getText(page, "home-permissions");
  check("direct grant shows only View system status", direct.includes("View system status") && !direct.includes("Manage permissions"), direct);

  await switcher.selectOption("qa.member");
  await page.waitForFunction(() => document.querySelector('[data-testid="top-bar-user"]')?.textContent?.includes("QA Member"), null, { timeout: T });
  check("child department inherits Manage permissions", (await getText(page, "home-permissions")).includes("Manage permissions"));

  await switcher.selectOption("dev.admin");
  await page.waitForFunction(() => document.querySelector('[data-testid="top-bar-user"]')?.textContent?.includes("Dev Admin"), null, { timeout: T });
  const all = await getText(page, "home-permissions");
  check("sysadmin sees all four permissions", ["Manage permissions", "Run directory sync", "Manage AI", "View system status"].every((l) => all.includes(l)), all);
  check("catalog order, not alphabetical", all.indexOf("Manage permissions") < all.indexOf("Run directory sync") && all.indexOf("Run directory sync") < all.indexOf("Manage AI") && all.indexOf("Manage AI") < all.indexOf("View system status"), all.replace(/\s+/g, " "));
});

// 3) 직원 행이 없는 첫 로그인 - 이름 대신 login_id, 권한 없음, 관리 링크 없음
await runStep("unknown employee", { devUser: "ghost.user" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "home-permissions-empty");
  check("falls back to login id", (await getText(page, "top-bar-user")).includes("ghost.user"), await getText(page, "top-bar-user"));
  check("no permission list", (await page.locator('[data-testid="home-permissions"]').count()) === 0);
  check("admin link hidden", (await page.locator('[data-testid="top-bar-admin-link"]').count()) === 0);
  check("dev switcher shows the unlisted account", (await page.locator('[data-testid="dev-user-switcher"]').inputValue()) === "ghost.user");
  await takeShot("baseline-home-empty.png");
});

// 4) 언어 전환 - 라벨·이름이 한국어로 바뀌고 새로고침해도 유지
await runStep("language switch", { devUser: "qa.lead" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "home-permissions");
  await page.locator('[data-testid="top-bar-lang"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="home-permissions"]')?.textContent?.includes("권한 관리"), null, { timeout: T });
  check("permission label is Korean", (await getText(page, "home-permissions")).includes("권한 관리"));
  check("top bar shows Korean name", (await getText(page, "top-bar-user")).includes("품질리드"), await getText(page, "top-bar-user"));
  await takeShot("baseline-home-ko.png");
  await page.reload();
  await wait(page, "home-permissions");
  check("language survives reload", (await getText(page, "home-permissions")).includes("권한 관리"));
});

// 5) 로그아웃 -> 로그인 화면 -> 계정 선택으로 재로그인
await runStep("sign out and sign in", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "login-dev-user-qa.lead");
  check("unauthenticated visit lands on /login", new URL(page.url()).pathname === "/login", page.url());
  await takeShot("baseline-login.png");
  await page.locator('[data-testid="login-dev-user-qa.lead"]').click();
  await wait(page, "home-permissions");
  check("signed in as qa.lead", (await getText(page, "top-bar-user")).includes("QA Lead"));
  await page.locator('[data-testid="top-bar-signout"]').click();
  await wait(page, "login-dev-user-qa.member");
  check("sign out returns to /login", new URL(page.url()).pathname === "/login", page.url());
  check("top bar is gone on /login", (await page.locator('[data-testid="top-bar-service"]').count()) === 0);
  await page.locator('[data-testid="login-dev-user-qa.member"]').click();
  await wait(page, "home-permissions");
  check("signed in as qa.member", (await getText(page, "top-bar-user")).includes("QA Member"));
});

// 6) /api/me 실패 - 빈 화면 대신 사람 말 문구(서버 원문 비노출)와 다시 시도, 복구되면 홈
await runStep("me failure and retry", { devUser: "qa.lead", allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "upstream secret detail" }) }),
  );
  await page.goto(`${BASE}/`);
  await wait(page, "app-shell-error");
  const message = await getText(page, "app-shell-error");
  check("shows a readable message", message.includes("turned off or not set up"), message);
  check("hides the server detail", !message.includes("upstream secret detail"), message);
  check("top bar still offers sign out", await page.locator('[data-testid="top-bar-signout"]').isVisible());
  await takeShot("baseline-me-error.png");
  await page.unroute("**/api/me");
  await page.locator('[data-testid="app-shell-retry"]').click();
  await wait(page, "home-permissions");
  check("retry recovers the home screen", (await getText(page, "top-bar-user")).includes("QA Lead"));
});

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
