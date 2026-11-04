// 기반 화면 스모크(Playwright + 시스템 Chrome) - dev 로그인, 상단 바, 홈의 내 권한, 언어 전환, 로그아웃/재로그인, 관리 화면(권한 관리·운영 패널).
// 전제: backend를 DEV_ENFORCE_PERMISSIONS=true APP_SYSADMINS=dev.admin 으로 8777에 띄우고(reset_db 직후), frontend `npm run dev`(3777).
// 관리 화면 시나리오는 "Smoke Role"을 만들었다가 지우므로 실행 사이에 reset_db가 꼭 필요하진 않지만, 중간에 실패하면 역할이 남아 다음 실행이 409로 깨진다 - 그땐 reset_db.
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
  const manageSource = await getText(page, "home-permission-source-permission.manage");
  check("Manage permissions source names the department and role", manageSource.includes("Quality Division") && manageSource.includes("Permission Admin"), manageSource);
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
  const directSource = await getText(page, "home-permission-source-system.view");
  check("direct grant source reads You and direct grant", directSource.includes("You") && directSource.includes("direct grant"), directSource);

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

// ── 관리 화면 ────────────────────────────────────────────────

const findById = (page, id) => page.locator(`[data-testid="${id}"]`);
const countById = (page, id) => findById(page, id).count();
const waitHidden = (page, id) => findById(page, id).waitFor({ state: "hidden", timeout: T });
// 같은 접두사를 가진 행 전부(예: role-row-*)
const findByPrefix = (page, prefix, options) => page.locator(`[data-testid^="${prefix}"]`, options);
const isSelected = async (page, id) => (await findById(page, id).getAttribute("aria-selected")) === "true";

// 7) 권한 관리 보유자(qa.lead) - 역할 만들기 -> 개인 부여 -> 변경 기록 -> 유효 권한 조회, 정리까지(Smoke Role은 지운다)
await runStep("admin access as qa.lead", { devUser: "qa.lead" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/admin`);
  await wait(page, "admin-tab-access");
  check(
    "only the access tab is shown",
    (await countById(page, "admin-tab-directory")) === 0 && (await countById(page, "admin-tab-batch")) === 0 && (await countById(page, "admin-tab-ai")) === 0,
  );
  check("access tab is selected", await isSelected(page, "admin-tab-access"));

  // 역할
  await wait(page, "roles-list");
  const rolesText = await getText(page, "roles-list");
  check("demo roles are listed", rolesText.includes("Permission Admin") && rolesText.includes("Operations"), rolesText);
  const adminRole = findByPrefix(page, "role-row-", { hasText: "Permission Admin" });
  check("role row shows permission labels and grant count", (await adminRole.innerText()).includes("Manage permissions") && (await adminRole.innerText()).includes("Grants: 1"), await adminRole.innerText());

  await findById(page, "role-create").click();
  await wait(page, "role-form");
  check("save is disabled without a name", await findById(page, "role-form-save").isDisabled());
  const formText = await getText(page, "role-form");
  check(
    "permission checkboxes follow the catalog order",
    formText.indexOf("Manage permissions") < formText.indexOf("Run directory sync") && formText.indexOf("Run directory sync") < formText.indexOf("Manage AI") && formText.indexOf("Manage AI") < formText.indexOf("View system status"),
    formText.replace(/\s+/g, " "),
  );
  await page.keyboard.press("Escape");
  await waitHidden(page, "role-form");
  check("Esc closes the modal", true);
  await findById(page, "role-create").click();
  await wait(page, "role-form");
  await page.mouse.move(5, 5); // 백드롭 모서리 - 모달 밖
  await page.mouse.down();
  await page.mouse.up();
  await waitHidden(page, "role-form");
  check("pressing the backdrop closes the modal", true);

  await findById(page, "role-create").click();
  await wait(page, "role-form");
  await findById(page, "role-form-name").fill("Smoke Role");
  await findById(page, "role-form-perm-system.view").check();
  await findById(page, "role-form-save").click();
  await waitHidden(page, "role-form");
  const smokeRole = findByPrefix(page, "role-row-", { hasText: "Smoke Role" });
  await smokeRole.waitFor({ state: "visible", timeout: T });
  check("Smoke Role appears with View system status", (await smokeRole.innerText()).includes("View system status"), await smokeRole.innerText());
  await takeShot("baseline-admin-roles.png");

  // 부여
  await findById(page, "access-sub-grants").click();
  await wait(page, "grants-table");
  const grantsText = await getText(page, "grants-table");
  check("demo grants are listed", grantsText.includes("Quality Division") && grantsText.includes("Ops Member") && grantsText.includes("Production Member"), grantsText.replace(/\s+/g, " "));
  check("no missing-subject badge for live subjects", (await findByPrefix(page, "grant-missing-").count()) === 0);

  await findById(page, "grant-create").click();
  await wait(page, "grant-form");
  check("grant save is disabled until a subject and role are chosen", await findById(page, "grant-save").isDisabled());
  await findById(page, "grant-subject-type-dept").click();
  await wait(page, "grant-subject-picker-option-DIV-QA");
  check("department tree shows divisions under the root, teams collapsed", (await countById(page, "grant-subject-picker-option-TEAM-QA1")) === 0);
  await findById(page, "grant-subject-picker-toggle-DIV-QA").click();
  await wait(page, "grant-subject-picker-option-TEAM-QA1");
  check("expanding a division reveals its team", await findById(page, "grant-subject-picker-option-TEAM-QA1").isVisible());
  await takeShot("baseline-admin-grant-form.png");
  await findById(page, "grant-subject-type-user").click();
  await findById(page, "grant-subject-picker-search").fill("prod");
  // 목록이 뜬 뒤(처음엔 전체)에도 검색은 입력이 멈춘 다음에야 나가므로, 다른 사람이 사라질 때까지 기다린다
  await wait(page, "grant-subject-picker-option-prod.member");
  await findById(page, "grant-subject-picker-option-qa.lead").waitFor({ state: "detached", timeout: T });
  check("person search narrows to matches", (await countById(page, "grant-subject-picker-option-prod.member")) === 1);
  await findById(page, "grant-subject-picker-option-prod.member").click();
  check("selection is echoed", (await getText(page, "grant-subject-picker-selected")).includes("Production Member"), await getText(page, "grant-subject-picker-selected"));
  await findById(page, "grant-role-select").selectOption({ label: "Smoke Role" });
  await findById(page, "grant-save").click();
  await waitHidden(page, "grant-form");
  const smokeGrant = findByPrefix(page, "grant-row-", { hasText: "Smoke Role" });
  await smokeGrant.waitFor({ state: "visible", timeout: T });
  check("new grant row names the person and the role", (await smokeGrant.innerText()).includes("Production Member") && (await smokeGrant.innerText()).includes("prod.member"), await smokeGrant.innerText());
  await takeShot("baseline-admin-grants.png");

  // 변경 기록 - 최신순이라 부여 추가가 위, 역할 생성이 그 아래
  await findById(page, "access-sub-audit").click();
  await wait(page, "audit-table");
  const actions = await findByPrefix(page, "audit-row-").evaluateAll((els) => els.map((el) => el.getAttribute("data-action")));
  check("newest changes are grant.add then role.create", actions[0] === "grant.add" && actions[1] === "role.create", actions.slice(0, 3).join(","));
  const topRow = await findByPrefix(page, "audit-row-").first().innerText();
  check("audit row reads in plain language", topRow.includes("qa.lead") && topRow.includes("Grant added") && topRow.includes("Granted role") && topRow.includes("Smoke Role") && topRow.includes("prod.member"), topRow.replace(/\s+/g, " "));
  await takeShot("baseline-admin-access.png");

  // 유효 권한 조회
  await findById(page, "access-sub-lookup").click();
  await findById(page, "effective-picker-search").fill("prod");
  await wait(page, "effective-picker-option-prod.member");
  await findById(page, "effective-picker-option-prod.member").click();
  await wait(page, "effective-result");
  const prodPerm = await getText(page, "effective-perm-system.view");
  check("lookup shows the permission with both sources", prodPerm.includes("View system status") && prodPerm.includes("direct grant") && prodPerm.includes("via role Smoke Role"), prodPerm.replace(/\s+/g, " "));
  await takeShot("baseline-admin-lookup.png");
  await findById(page, "effective-picker-search").fill("qa.mem");
  await findById(page, "effective-picker-option-qa.member").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="effective-perm-permission.manage"]'), null, { timeout: T });
  const inherited = await getText(page, "effective-perm-permission.manage");
  check("department grant reaches a sub-department member", inherited.includes("Department") && inherited.includes("Quality Division") && inherited.includes("via role Permission Admin"), inherited.replace(/\s+/g, " "));
  await findById(page, "effective-picker-search").fill("ghost.user");
  await findById(page, "effective-picker-raw-option").click();
  await wait(page, "effective-unknown");
  check("unregistered login id is explained, not an error", (await countById(page, "effective-none")) === 1);

  // 정리 - 설명 수정 -> 부여 회수 -> 역할 삭제
  await findById(page, "access-sub-roles").click();
  await smokeRole.waitFor({ state: "visible", timeout: T });
  await smokeRole.locator('[data-testid^="role-edit-"]').click();
  await wait(page, "role-form");
  check("edit form is prefilled", (await findById(page, "role-form-name").inputValue()) === "Smoke Role");
  await findById(page, "role-form-description").fill("Created by the smoke test");
  await findById(page, "role-form-save").click();
  await waitHidden(page, "role-form");
  await page.waitForFunction(() => document.querySelector('[data-testid="roles-list"]')?.textContent?.includes("Created by the smoke test"), null, { timeout: T });
  check("edited description shows in the list", true);

  await findById(page, "access-sub-grants").click();
  await smokeGrant.waitFor({ state: "visible", timeout: T });
  await smokeGrant.locator('[data-testid^="grant-remove-"]').click();
  await wait(page, "grant-remove-modal");
  const revokeText = await getText(page, "grant-remove-modal");
  check("revoke confirm names the role and the person", revokeText.includes("Smoke Role") && revokeText.includes("Production Member"), revokeText.replace(/\s+/g, " "));
  await findById(page, "grant-remove-confirm").click();
  await waitHidden(page, "grant-remove-modal");
  await smokeGrant.waitFor({ state: "detached", timeout: T });
  check("revoked grant disappears", true);

  await findById(page, "access-sub-roles").click();
  await smokeRole.waitFor({ state: "visible", timeout: T });
  await smokeRole.locator('[data-testid^="role-delete-"]').click();
  await wait(page, "role-delete");
  check("delete confirm names the role", (await getText(page, "role-delete")).includes("Smoke Role"));
  await findById(page, "role-delete-confirm").click();
  await waitHidden(page, "role-delete");
  await smokeRole.waitFor({ state: "detached", timeout: T });
  check("deleted role disappears", true);

  // 숨겨진 탭 딥링크는 허용된 첫 탭으로 떨어진다
  await page.goto(`${BASE}/admin?tab=ai`);
  await wait(page, "admin-tab-access");
  check("deep link to a hidden tab falls back to the first allowed tab", (await isSelected(page, "admin-tab-access")) && (await countById(page, "admin-tab-ai")) === 0);
});

// 8) 업무 오류는 사람 말로 - 같은 이름 역할(409)·부여가 남은 역할 삭제(409). 일부러 4xx를 일으키므로 콘솔 오류 검사는 건너뛴다.
await runStep("admin errors as qa.lead", { devUser: "qa.lead", allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/admin`);
  await wait(page, "roles-list");

  await findById(page, "role-create").click();
  await findById(page, "role-form-name").fill("Permission Admin");
  await findById(page, "role-form-save").click();
  await wait(page, "role-form-error");
  const duplicate = await getText(page, "role-form-error");
  check("duplicate name explains itself", duplicate.includes("A role with this name already exists."), duplicate);
  check("duplicate name hides the status code", !duplicate.includes("409"), duplicate);
  check("form stays open for a retry", await findById(page, "role-form").isVisible());
  await findById(page, "role-form-cancel").click();
  await waitHidden(page, "role-form");

  const adminRole = findByPrefix(page, "role-row-", { hasText: "Permission Admin" });
  await adminRole.locator('[data-testid^="role-delete-"]').click();
  await wait(page, "role-delete");
  await findById(page, "role-delete-confirm").click();
  await wait(page, "role-delete-error");
  const blocked = await getText(page, "role-delete-error");
  check("granted role cannot be deleted, in plain words", blocked.includes("This role is still granted. Remove its grants first."), blocked);
  check("delete error hides the status code", !blocked.includes("409"), blocked);
  await takeShot("baseline-admin-error.png");
  await findById(page, "role-delete-cancel").click();
  await waitHidden(page, "role-delete");
  check("the role is still listed", await adminRole.isVisible());
});

// 9) system.view만 직접 받은 prod.member - 배치 작업 탭만 보인다
await runStep("admin as prod.member", { devUser: "prod.member" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/admin`);
  await wait(page, "admin-tab-batch");
  check(
    "only the batch tab is shown",
    (await countById(page, "admin-tab-access")) === 0 && (await countById(page, "admin-tab-directory")) === 0 && (await countById(page, "admin-tab-ai")) === 0,
  );
  await page.locator('[data-testid="batch-empty"], [data-testid="batch-table"]').first().waitFor({ state: "visible", timeout: T });
  check("batch panel renders without an error", (await countById(page, "batch-error")) === 0);
  await takeShot("baseline-admin-prod.png");
  await page.goto(`${BASE}/admin?tab=access`);
  await wait(page, "admin-tab-batch");
  check("deep link to the access tab falls back to batch", (await isSelected(page, "admin-tab-batch")) && (await countById(page, "access-roles")) === 0);
});

// 10) 사용자 전환 - 열려 있는 관리 화면이 새 사용자의 권한에 맞게 탭을 다시 정한다
await runStep("admin follows the dev user switch", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/admin`);
  await wait(page, "roles-list");
  await page.locator('[data-testid="dev-user-switcher"]').selectOption("prod.member");
  await wait(page, "admin-tab-batch");
  check("access tab disappears after switching to prod.member", (await countById(page, "admin-tab-access")) === 0);
  check("batch tab takes over", await isSelected(page, "admin-tab-batch"));
});

// 11) 권한이 하나도 없으면 관리 화면은 홈으로 돌려보낸다
await runStep("admin without permissions", { devUser: "ghost.user" }, async ({ page }) => {
  await page.goto(`${BASE}/admin`);
  await wait(page, "home-permissions-empty");
  check("redirected to home", new URL(page.url()).pathname === "/", page.url());
  check("no admin tabs were rendered", (await countById(page, "admin-tab-access")) === 0);
});

// 12) 운영 권한(ops.member) - HR 미설정·AI 꺼짐이 사람 말로 보이고 원문 503은 새지 않는다. 일부러 503을 일으키므로 콘솔 오류 검사는 건너뛴다.
await runStep("admin ops panels as ops.member", { devUser: "ops.member", allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/admin`);
  await wait(page, "admin-tab-directory");
  check("access tab is hidden, the three ops tabs are shown", (await countById(page, "admin-tab-access")) === 0 && (await countById(page, "admin-tab-batch")) === 1 && (await countById(page, "admin-tab-ai")) === 1);
  check("first allowed tab is selected", await isSelected(page, "admin-tab-directory"));

  await wait(page, "hr-sync-runs-error");
  const runsError = await getText(page, "hr-sync-runs-error");
  check("run history explains HR is not set up", runsError.includes("HR sync is not set up on this server."), runsError);
  check("run history hides the status code", !runsError.includes("503"), runsError);

  await findById(page, "hr-sync-run").click();
  await wait(page, "hr-sync-error");
  const runError = await getText(page, "hr-sync-error");
  check("sync run explains HR is not set up", runError.includes("HR sync is not set up on this server."), runError);
  check("sync run hides the status code", !runError.includes("503"), runError);
  const previewResponse = page.waitForResponse((r) => r.url().includes("/api/admin/hr-sync/preview"), { timeout: T });
  await findById(page, "hr-sync-preview").click();
  await previewResponse;
  await wait(page, "hr-sync-error");
  const previewError = await getText(page, "hr-sync-error");
  check("preview shows the same plain message", previewError.includes("HR sync is not set up on this server.") && !previewError.includes("503"), previewError);
  await takeShot("baseline-admin-hr.png");

  await findById(page, "admin-tab-batch").click();
  await page.locator('[data-testid="batch-empty"], [data-testid="batch-table"]').first().waitFor({ state: "visible", timeout: T });
  check("batch tab opens", await isSelected(page, "admin-tab-batch"));

  await findById(page, "admin-tab-ai").click();
  check("tab selection is kept in the address", page.url().includes("tab=ai"), page.url());
  await findById(page, "ai-ping").click();
  await wait(page, "ai-ping-result");
  const ping = await getText(page, "ai-ping-result");
  check("ping says AI is turned off", ping.includes("AI is turned off"), ping);
  check("ping hides the status code", !ping.includes("503"), ping);
  await wait(page, "ai-usage-empty");
  check("usage table is empty without calls", true);
  await takeShot("baseline-admin-ops.png");

  await page.reload();
  await wait(page, "ai-ping");
  check("reload keeps the AI tab", await isSelected(page, "admin-tab-ai"));

  await findById(page, "ai-ping").click();
  await wait(page, "ai-ping-result");
  await page.locator('[data-testid="top-bar-lang"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="admin-tab-batch"]')?.textContent?.includes("배치 작업"), null, { timeout: T });
  check("tab labels switch to Korean", (await getText(page, "admin-tab-directory")).includes("직원 동기화"), await getText(page, "admin-tab-directory"));
  check("the plain-language error follows the language", (await getText(page, "ai-ping-result")).includes("AI가 꺼져 있습니다"), await getText(page, "ai-ping-result"));
  await takeShot("baseline-admin-ops-ko.png");
});

// 13) 운영 패널의 성공·중단·상류 오류 렌더 - 로컬 backend는 HR·AI가 꺼져 있어 이 경로를 못 타므로 응답을 가짜로 채운다(렌더 배선 확인용).
await runStep("admin ops panels with mocked responses", { devUser: "ops.member", allowConsoleErrors: true }, async ({ page, takeShot }) => {
  const fulfillJson = (route, body, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const buildRunRow = (id, outcome, detail, extra = {}) => ({
    id, ran_at: "2026-11-04T04:00:00+09:00", outcome, detail, scanned: 120, created: 2, deactivated: 1, reactivated: 0,
    deleted: 0, skipped: 2, duplicates: 0, managed: 118, mass_departure: false, ...extra,
  });
  const buildSummary = (extra = {}) => ({
    scanned: 120, upserted: 118, deactivated: 1, deleted: 0, skipped: 2, org_mismatches: 3, truncated_levels: 0,
    departments_upserted: 7, aborted_reason: null, created: 2, reactivated: 1, duplicates: 0, managed: 118,
    mass_departure: false, ...extra,
  });
  await page.route("**/api/admin/hr-sync/runs", (route) =>
    fulfillJson(route, [buildRunRow(2, "success", null), buildRunRow(1, "failure", "empty feed: no valid employee rows", { scanned: 0, created: 0 })]),
  );
  let syncCalls = 0;
  await page.route("**/api/admin/hr-sync", (route) => {
    syncCalls += 1;
    return fulfillJson(
      route,
      syncCalls === 1
        ? buildSummary()
        : buildSummary({ aborted_reason: "delete cap exceeded: would delete 9/10 managed rows", mass_departure: true }),
    );
  });
  await page.route("**/api/admin/hr-sync/preview", (route) =>
    fulfillJson(route, {
      scanned: 120, skipped: 2, would_upsert: 118, would_deactivate: 1, would_delete: 0, org_mismatches: 3,
      truncated_levels: 0, korean_overwrites: 4,
      new_login_ids: Array.from({ length: 25 }, (_, i) => `new.person${i + 1}`),
      delete_login_ids: [], case_mismatches: ["Kim.Lee"],
    }),
  );
  await page.route("**/api/admin/batch-runs", (route) =>
    fulfillJson(route, [
      { job: "db_backup", outcome: "failure", ran_at: "2026-11-03T04:00:00+09:00", detail: "pg_dump exited with 1" },
      { job: "hr_sync", outcome: "success", ran_at: "2026-11-04T04:00:00+09:00", detail: "scanned 120 · created 2" },
      { job: "report_mail", outcome: "success", ran_at: "2026-11-04T05:00:00+09:00", detail: null },
    ]),
  );
  let pingCalls = 0;
  await page.route("**/api/admin/ai/ping", (route) => {
    pingCalls += 1;
    return pingCalls === 1
      ? fulfillJson(route, { ok: true, model: "glm-test", latency_ms: 842, reply_ok: true })
      : fulfillJson(route, { detail: "AI endpoint error: ConnectTimeout" }, 502);
  });
  await page.route("**/api/admin/ai/usage**", (route) =>
    fulfillJson(route, [
      { date: "2026-11-03", calls: 12, failed: 1, prompt_tokens: 3400, completion_tokens: 900 },
      { date: "2026-11-04", calls: 5, failed: 0, prompt_tokens: 1200, completion_tokens: 410 },
    ]),
  );

  await page.goto(`${BASE}/admin`);
  await wait(page, "hr-sync-runs");
  const runsText = await getText(page, "hr-sync-runs");
  check("run history shows both outcomes", runsText.includes("Succeeded") && runsText.includes("Failed"), runsText.replace(/\s+/g, " "));
  check("a known abort reason reads as a sentence", runsText.includes("The feed had no valid employee rows."), runsText.replace(/\s+/g, " "));

  await findById(page, "hr-sync-run").click();
  await wait(page, "hr-sync-result");
  const resultText = await getText(page, "hr-sync-result-stats");
  check("sync result lists the counts", resultText.includes("120") && resultText.includes("Rows read") && resultText.includes("New people"), resultText.replace(/\s+/g, " "));
  check("a clean run has no warning", (await countById(page, "hr-sync-aborted")) === 0 && (await countById(page, "hr-sync-mass-departure")) === 0);
  await takeShot("baseline-admin-hr-result.png");
  await findById(page, "hr-sync-run").click();
  await wait(page, "hr-sync-aborted");
  check("an aborted run says nothing changed, in plain words", (await getText(page, "hr-sync-aborted")).includes("Nothing was changed. Too many people would have been removed at once."), await getText(page, "hr-sync-aborted"));
  check("a mass departure is flagged", await findById(page, "hr-sync-mass-departure").isVisible());

  await findById(page, "hr-sync-preview").click();
  await wait(page, "hr-sync-preview-result");
  const previewText = await getText(page, "hr-sync-preview-result");
  check("preview says nothing was changed and lists counts", previewText.includes("nothing was changed") && previewText.includes("Would update") && previewText.includes("118"), previewText.replace(/\s+/g, " "));
  check("long id lists are folded", previewText.includes("new.person20") && !previewText.includes("new.person21") && previewText.includes("+5 more"), previewText.replace(/\s+/g, " "));
  check("case-only mismatches are listed", previewText.includes("Kim.Lee"));

  await findById(page, "admin-tab-batch").click();
  await wait(page, "batch-table");
  check("batch rows are keyed by job and outcome", (await countById(page, "batch-row-hr_sync-success")) === 1 && (await countById(page, "batch-row-db_backup-failure")) === 1);
  const batchText = await getText(page, "batch-table");
  check("known jobs get names, unknown jobs keep theirs", batchText.includes("Directory sync") && batchText.includes("Database backup") && batchText.includes("report_mail"), batchText.replace(/\s+/g, " "));
  await takeShot("baseline-admin-batch.png");

  await findById(page, "admin-tab-ai").click();
  await findById(page, "ai-ping").click();
  await wait(page, "ai-ping-result");
  const okPing = await getText(page, "ai-ping-result");
  check("ping reports the model and latency", okPing.includes("glm-test") && okPing.includes("842 ms") && okPing.includes("answered as expected"), okPing.replace(/\s+/g, " "));
  await wait(page, "ai-usage-table");
  check("usage rows are keyed by date", (await countById(page, "ai-usage-row-2026-11-03")) === 1 && (await countById(page, "ai-usage-row-2026-11-04")) === 1);
  await takeShot("baseline-admin-ai-usage.png");
  await findById(page, "ai-ping").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="ai-ping-result"]')?.textContent?.includes("Could not reach"), null, { timeout: T });
  const badPing = await getText(page, "ai-ping-result");
  check("an upstream failure is explained with a short hint", badPing.includes("Could not reach the AI service.") && badPing.includes("ConnectTimeout"), badPing);
  check("an upstream failure hides the status code", !badPing.includes("502"), badPing);
});

// 14) 조직 개편·퇴직의 흔적 - 대상이 사라진 부여는 배지로 남고, 퇴직자·sysadmin 조회는 이유를 말해 준다. 사라진 대상 부여와 퇴직자는 UI로 못 만들어 부여 목록·퇴직자 조회만 가짜 응답이다.
await runStep("admin leftovers as qa.lead", { devUser: "qa.lead" }, async ({ page, takeShot }) => {
  const fulfillJson = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  const buildGrant = (id, subjectType, subjectId) => ({
    id, subject_type: subjectType, subject_id: subjectId, subject_name: "", subject_missing: true,
    role_id: 1, role_name: "Permission Admin", permission: null, created_by: "seed", created_at: "2026-11-04T10:00:00+09:00",
  });
  await page.route("**/api/access/grants", (route) => fulfillJson(route, [buildGrant(91, "dept", "GONE-DEPT"), buildGrant(92, "user", "retired.person")]));
  await page.route("**/api/access/effective/retired.person", (route) =>
    fulfillJson(route, { login_id: "retired.person", known: true, active: false, is_sysadmin: false, permissions: [], sources: {} }),
  );

  await page.goto(`${BASE}/admin`);
  await findById(page, "access-sub-grants").click();
  await wait(page, "grant-missing-91");
  check("a vanished department is badged", (await getText(page, "grant-missing-91")).includes("Department not found"), await getText(page, "grant-missing-91"));
  check("a vanished person is badged", (await getText(page, "grant-missing-92")).includes("Person not found"), await getText(page, "grant-missing-92"));
  const missingRow = await findById(page, "grant-row-91").innerText();
  check("the row still shows which subject it was", missingRow.includes("GONE-DEPT") && missingRow.includes("Permission Admin"), missingRow.replace(/\s+/g, " "));
  await takeShot("baseline-admin-grants-missing.png");

  await findById(page, "access-sub-lookup").click();
  await findById(page, "effective-picker-search").fill("retired.person");
  await findById(page, "effective-picker-raw-option").click();
  await wait(page, "effective-inactive");
  check("an inactive person is explained", (await getText(page, "effective-inactive")).includes("inactive") && (await countById(page, "effective-none")) === 1);

  await findById(page, "effective-picker-search").fill("dev.admin");
  await findById(page, "effective-picker-option-dev.admin").click();
  await wait(page, "effective-sysadmin");
  check("a system administrator is explained and holds all four permissions", (await findByPrefix(page, "effective-perm-").count()) === 4);
  check("a known, active sysadmin gets no directory note", (await countById(page, "effective-sysadmin-note")) === 0);

  // 디렉터리에 아직 없는 부트스트랩 sysadmin(APP_SYSADMINS) - 백엔드는 known=false여도 권한 전부를 돌려준다. dev.admin은 실제 응답을 쓰려고 로그인 ID를 따로 잡는다.
  await page.route("**/api/access/effective/bootstrap.admin", (route) =>
    fulfillJson(route, {
      login_id: "bootstrap.admin", known: false, active: false, is_sysadmin: true,
      permissions: ["directory.sync", "permission.manage", "system.view", "ai.admin"], sources: {},
    }),
  );
  await findById(page, "effective-picker-search").fill("bootstrap.admin");
  await findById(page, "effective-picker-raw-option").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="effective-sysadmin-note"]'), null, { timeout: T });
  const bootstrapText = await getText(page, "effective-result");
  check("a sysadmin without an employee row is still shown as a system administrator", (await findById(page, "effective-sysadmin").isVisible()) && bootstrapText.includes("System administrator"), bootstrapText.replace(/\s+/g, " "));
  check("the note is neutral and never says it holds no permissions", bootstrapText.includes("Not in the employee directory yet.") && !bootstrapText.includes("holds no permissions") && (await countById(page, "effective-unknown")) === 0, bootstrapText.replace(/\s+/g, " "));
  check("all four permission rows are still listed, in catalog order", (await findByPrefix(page, "effective-perm-").count()) === 4 && (await countById(page, "effective-none")) === 0 && bootstrapText.indexOf("Manage permissions") < bootstrapText.indexOf("Run directory sync"), bootstrapText.replace(/\s+/g, " "));
  await takeShot("baseline-admin-lookup-bootstrap.png");
});

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
