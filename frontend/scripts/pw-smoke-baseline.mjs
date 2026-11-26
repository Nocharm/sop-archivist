// 기반 화면 스모크(Playwright + 시스템 Chrome) - dev 로그인, 상단 바, 내 계정의 권한, 언어 전환, 로그아웃/재로그인, 관리 화면(권한 관리·운영 패널), 사용 설명서.
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
// 값 고르기(components/ui/select.tsx)는 기본 <select>가 아니다 - 트리거를 누르고 목록의 항목을 누른다. 첫 단계부터 쓰여 위에 둔다
const pickOption = async (page, id, value) => {
  await page.locator(`[data-testid="${id}"]`).click();
  await page.locator(`[data-testid="${id}-option-${value === "" ? "none" : value}"]`).click();
};
const pickOptionByLabel = async (page, id, label) => {
  await page.locator(`[data-testid="${id}"]`).click();
  await page.locator(`[data-testid="${id}-list"] [role="option"]`, { hasText: label }).click();
};

// ── 시나리오 ────────────────────────────────────────────────

// 1) 부서 부여로 권한을 받는 qa.lead(DIV-QA -> Permission Admin)가 /account에서 자기 신원·권한을 본다
await runStep("account as qa.lead", { devUser: "qa.lead" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/account`);
  await wait(page, "top-bar-version");
  check("service name", (await getText(page, "top-bar-service")).trim() === "SOP Archivist");
  check("version matches package.json", (await getText(page, "top-bar-version")).trim() === `v${APP_VERSION}`, await getText(page, "top-bar-version"));
  await wait(page, "account-permissions");
  check("top bar shows name", (await getText(page, "top-bar-user")).includes("QA Lead"), await getText(page, "top-bar-user"));
  check("top bar shows department", (await getText(page, "top-bar-user")).includes("Quality Division"));
  const perms = await getText(page, "account-permissions");
  check("account lists Manage permissions", perms.includes("Manage permissions"), perms);
  check("account hides ungranted permissions", !perms.includes("Manage AI") && !perms.includes("Run directory sync"), perms);
  const manageSource = (await page.locator('[data-testid="account-permission-source-permission.manage"]').getAttribute("aria-label")) ?? "";
  check("Manage permissions source names the department and role", manageSource.includes("Quality Division") && manageSource.includes("Permission Admin"), manageSource);
  check("account identity shows login id", (await getText(page, "account-identity")).includes("qa.lead"));
  check("AI status is shown", (await getText(page, "account-ai-status")).trim().length > 0, await getText(page, "account-ai-status"));
  await page.locator('[data-testid="top-bar-user"]').click();
  await page.locator('[data-testid="user-menu-admin"]').waitFor({ state: "visible", timeout: T }).catch(() => undefined);
  check("admin link in the user menu", await page.locator('[data-testid="user-menu-admin"]').isVisible());
  await page.keyboard.press("Escape");
  check("dev switcher shows current user", (await page.locator('[data-testid="dev-user-switcher"]').getAttribute("data-value")) === "qa.lead");
  await takeShot("baseline-account.png");
});

// 2) 사용자 전환기 - 새로고침 없이 신원·권한이 따라 바뀐다(부서 상속·개인 직접 부여·sysadmin)
await runStep("switch dev users", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/account`);
  await wait(page, "account-permissions");
  await pickOption(page, "dev-user-switcher", "prod.member");
  await page.waitForFunction(() => document.querySelector('[data-testid="top-bar-user"]')?.textContent?.includes("Production Member"), null, { timeout: T });
  const direct = await getText(page, "account-permissions");
  check("direct grant shows only View system status", direct.includes("View system status") && !direct.includes("Manage permissions"), direct);
  const directSource = (await page.locator('[data-testid="account-permission-source-system.view"]').getAttribute("aria-label")) ?? "";
  check("direct grant source reads You and direct grant", directSource.includes("You") && directSource.includes("direct grant"), directSource);

  await pickOption(page, "dev-user-switcher", "qa.member");
  await page.waitForFunction(() => document.querySelector('[data-testid="top-bar-user"]')?.textContent?.includes("QA Member"), null, { timeout: T });
  check("child department inherits Manage permissions", (await getText(page, "account-permissions")).includes("Manage permissions"));

  await pickOption(page, "dev-user-switcher", "dev.admin");
  await page.waitForFunction(() => document.querySelector('[data-testid="top-bar-user"]')?.textContent?.includes("Dev Admin"), null, { timeout: T });
  const all = await getText(page, "account-permissions");
  check("sysadmin sees all four permissions", ["Manage permissions", "Run directory sync", "Manage AI", "View system status"].every((l) => all.includes(l)), all);
  check("catalog order, not alphabetical", all.indexOf("Manage permissions") < all.indexOf("Run directory sync") && all.indexOf("Run directory sync") < all.indexOf("Manage AI") && all.indexOf("Manage AI") < all.indexOf("View system status"), all.replace(/\s+/g, " "));
});

// 3) 직원 행이 없는 첫 로그인 - 이름 대신 login_id, 권한 없음, 관리 링크 없음
await runStep("unknown employee", { devUser: "ghost.user" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/account`);
  await wait(page, "account-permissions-empty");
  check("falls back to login id", (await getText(page, "top-bar-user")).includes("ghost.user"), await getText(page, "top-bar-user"));
  check("no permission list", (await page.locator('[data-testid="account-permissions"]').count()) === 0);
  await page.locator('[data-testid="top-bar-user"]').click();
  check("admin link hidden", (await page.locator('[data-testid="user-menu-admin"]').count()) === 0);
  await page.keyboard.press("Escape");
  check("dev switcher shows the unlisted account", (await page.locator('[data-testid="dev-user-switcher"]').getAttribute("data-value")) === "ghost.user");
  await takeShot("baseline-account-empty.png");
});

// 4) 언어 전환 - 라벨·이름이 한국어로 바뀌고 새로고침해도 유지
await runStep("language switch", { devUser: "qa.lead" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/account`);
  await wait(page, "account-permissions");
  await page.locator('[data-testid="top-bar-lang-ko"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="account-permissions"]')?.textContent?.includes("권한 관리"), null, { timeout: T });
  check("permission label is Korean", (await getText(page, "account-permissions")).includes("권한 관리"));
  check("top bar shows Korean name", (await getText(page, "top-bar-user")).includes("품질리드"), await getText(page, "top-bar-user"));
  await takeShot("baseline-account-ko.png");
  await page.reload();
  await wait(page, "account-permissions");
  check("language survives reload", (await getText(page, "account-permissions")).includes("권한 관리"));
});

// 5) 로그아웃 -> 로그인 화면 -> 계정 선택으로 재로그인
await runStep("sign out and sign in", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "login-dev-user-qa.lead");
  check("unauthenticated visit lands on /login", new URL(page.url()).pathname === "/login", page.url());
  await takeShot("baseline-login.png");
  await page.locator('[data-testid="login-dev-user-qa.lead"]').click();
  await wait(page, "top-bar-user");
  check("signed in as qa.lead", (await getText(page, "top-bar-user")).includes("QA Lead"));
  await page.locator('[data-testid="top-bar-user"]').click();
  await page.locator('[data-testid="user-menu-signout"]').click();
  await wait(page, "login-dev-user-qa.member");
  check("sign out returns to /login", new URL(page.url()).pathname === "/login", page.url());
  check("top bar is gone on /login", (await page.locator('[data-testid="top-bar-service"]').count()) === 0);
  await page.locator('[data-testid="login-dev-user-qa.member"]').click();
  await wait(page, "top-bar-user");
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
  await wait(page, "top-bar-user");
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
  // 하위 탭은 주소에 남아 새로고침해도 그대로이고, 대상 이름은 화면 언어를 따른다
  check("the sub tab is in the address", new URL(page.url()).search === "?tab=access&sub=grants", page.url());
  await page.reload();
  await wait(page, "grants-table");
  check("reload stays on grants", await isSelected(page, "access-sub-grants"));
  await findById(page, "top-bar-lang-ko").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="grants-table"]')?.textContent?.includes("품질본부"), null, { timeout: T }).catch(() => undefined);
  check("grant subjects follow the screen language", (await getText(page, "grants-table")).includes("품질본부"), (await getText(page, "grants-table")).replace(/\s+/g, " "));
  await findById(page, "top-bar-lang-en").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="grants-table"]')?.textContent?.includes("Quality Division"), null, { timeout: T });

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
  await pickOptionByLabel(page, "grant-role-select", "Smoke Role");
  await findById(page, "grant-save").click();
  await waitHidden(page, "grant-form");
  const smokeGrant = findByPrefix(page, "grant-row-", { hasText: "Smoke Role" });
  await smokeGrant.waitFor({ state: "visible", timeout: T });
  // 저장한 대상이 골라져 상세 머리가 그 사람이고, 그 안의 부여 줄이 역할을 적는다
  await page.waitForFunction(() => document.querySelector('[data-testid="grant-detail-name"]')?.textContent === "Production Member", null, { timeout: T });
  const detailText = await getText(page, "grant-detail");
  check("new grant row names the person and the role", detailText.includes("Production Member") && detailText.includes("prod.member") && (await smokeGrant.innerText()).includes("Smoke Role"), detailText.replace(/\s+/g, " ").slice(0, 160));
  await takeShot("baseline-admin-grants.png");

  // 변경 기록 - 최신순이라 부여 추가가 위, 역할 생성이 그 아래
  await findById(page, "access-sub-audit").click();
  await wait(page, "audit-table");
  const actions = await findByPrefix(page, "audit-row-").evaluateAll((els) => els.map((el) => el.getAttribute("data-action")));
  check("newest changes are grant.add then role.create", actions[0] === "grant.add" && actions[1] === "role.create", actions.slice(0, 3).join(","));
  const topRow = await findByPrefix(page, "audit-row-").first().innerText();
  check("audit row reads in plain language", topRow.includes("qa.lead") && topRow.includes("Grant added") && topRow.includes("Granted role") && topRow.includes("Smoke Role") && topRow.includes("prod.member"), topRow.replace(/\s+/g, " "));
  // 거르기 - 종류 알약과 찾기. 날짜로 묶여 있고 시각만 남는다
  check("records are grouped by day", (await findByPrefix(page, "audit-table-group-").count()) >= 1);
  await findById(page, "audit-filter-role").click();
  const roleActions = await findByPrefix(page, "audit-row-").evaluateAll((els) => els.map((el) => el.getAttribute("data-action")));
  check("the role pill keeps only role changes", roleActions.length > 0 && roleActions.every((action) => action?.startsWith("role.")), roleActions.join(","));
  await findById(page, "audit-filter-all").click();
  await findById(page, "audit-search").fill("no such record");
  await wait(page, "audit-empty");
  await findById(page, "audit-search").fill("");
  await wait(page, "audit-table");
  await takeShot("baseline-admin-access.png");

  // 유효 권한 - 옛 조회 항목은 부여 화면에 들어왔다(옛 주소 sub=lookup도 부여로 연다)
  await page.goto(`${BASE}/admin?tab=access&sub=lookup`);
  await wait(page, "grants-table");
  check("the old lookup address opens grants", (await isSelected(page, "access-sub-grants")) && (await countById(page, "access-sub-lookup")) === 0);
  await findById(page, "grants-search").fill("prod");
  await wait(page, "grants-subject-user:prod.member");
  await findById(page, "grants-subject-user:prod.member").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="grant-detail-name"]')?.textContent === "Production Member", null, { timeout: T });
  await wait(page, "effective-perm-system.view");
  const prodPerm = await getText(page, "effective-perm-system.view");
  check("lookup shows the permission with both sources", prodPerm.includes("View system status") && prodPerm.includes("direct grant") && prodPerm.includes("via role Smoke Role"), prodPerm.replace(/\s+/g, " "));
  await takeShot("baseline-admin-lookup.png");
  // 부여가 없는 직원도 찾기에 나온다
  await findById(page, "grants-search").fill("qa.mem");
  await wait(page, "grants-group-none");
  check("people without grants are found", (await getText(page, "grants-group-none")).includes("No grants"), await getText(page, "grants-group-none"));
  await findById(page, "grants-subject-user:qa.member").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="effective-perm-permission.manage"]'), null, { timeout: T });
  const inherited = await getText(page, "effective-perm-permission.manage");
  check("department grant reaches a sub-department member", inherited.includes("Department") && inherited.includes("Quality Division") && inherited.includes("via role Permission Admin"), inherited.replace(/\s+/g, " "));
  const inheritedRow = await getText(page, "grant-inherited-DIV-QA");
  check("the detail lists what comes through the department", inheritedRow.includes("Permission Admin") && inheritedRow.includes("Quality Division"), inheritedRow.replace(/\s+/g, " "));
  await findById(page, "grants-search").fill("ghost.user");
  await findById(page, "grants-subject-user:ghost.user").click();
  await wait(page, "effective-unknown");
  check("unregistered login id is explained, not an error", (await countById(page, "effective-none")) === 1);

  await findById(page, "access-sub-roles").click();
  await wait(page, "roles-list");
  // 역할 × 권한 표 - 칸을 눌러 켜고 끈 뒤 띠에서 저장한다. 버리면 없던 일, 저장은 받은 대상 건수를 확인한 뒤
  const smokeCell = smokeRole.locator('[data-testid$="-ai.admin"]');
  await smokeCell.click();
  check("a changed cell waits in the bar", (await getText(page, "roles-bar-text")).includes("1 cells changed"), await getText(page, "roles-bar-text"));
  check("the cell shows as pending", (await smokeCell.getAttribute("data-pending")) !== null);
  await findById(page, "roles-bar-drop").click();
  await waitHidden(page, "roles-bar");
  check("discard puts the cell back", (await smokeCell.getAttribute("aria-pressed")) === "false");
  await smokeCell.click();
  await findById(page, "roles-bar-save").click();
  await wait(page, "roles-save");
  check("save confirm names the role and the permission", (await getText(page, "roles-save")).includes("Smoke Role") && (await getText(page, "roles-save")).includes("Manage AI"), await getText(page, "roles-save"));
  await findById(page, "roles-save-confirm").click();
  await waitHidden(page, "roles-bar");
  await page.reload();
  await wait(page, "roles-list");
  check("the saved cell survives a reload", (await smokeCell.getAttribute("aria-pressed")) === "true");
  await smokeCell.click();
  await findById(page, "roles-bar-save").click();
  await findById(page, "roles-save-confirm").click();
  await waitHidden(page, "roles-bar");

  // 받은 대상 - 올리면 명단, 부여에서 보기는 그 역할로 거른다
  await adminRole.locator('[data-testid^="role-holders-"]').first().hover();
  await findByPrefix(page, "role-holders-pop-").waitFor({ state: "visible", timeout: T });
  check("holder list names the subject", (await findByPrefix(page, "role-holders-pop-").innerText()).includes("Quality Division"));
  await findByPrefix(page, "role-holders-open-").click();
  await wait(page, "grants-table");
  check("show in grants filters by the role", (await page.locator('[data-testid^="grants-subject-"]').count()) === 1 && (await getText(page, "grants-table")).includes("Quality Division"), await getText(page, "grants-table"));
  await findById(page, "access-sub-roles").click();
  await wait(page, "roles-list");

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

  // 부여 회수 - 확인 창 대신 5초 되돌리기 알림. 되돌리면 다시 생기고, 다시 회수하면 사라진 채 남는다
  await findById(page, "access-sub-grants").click();
  await findById(page, "grants-search").fill("prod.member");
  await findById(page, "grants-subject-user:prod.member").click();
  await smokeGrant.waitFor({ state: "visible", timeout: T });
  await smokeGrant.locator('[data-testid^="grant-remove-"]').click();
  const revokeToast = page.locator(".toast-stack", { hasText: "Smoke Role" });
  await revokeToast.waitFor({ state: "visible", timeout: T });
  const revokeText = await revokeToast.innerText();
  check("revoke toast names the role and the person", revokeText.includes("Smoke Role") && revokeText.includes("Production Member"), revokeText.replace(/\s+/g, " "));
  await smokeGrant.waitFor({ state: "detached", timeout: T });
  check("revoked grant disappears", true);
  await revokeToast.getByRole("button", { name: "Undo" }).click();
  await smokeGrant.waitFor({ state: "visible", timeout: T });
  check("undo brings the grant back", true);
  await smokeGrant.locator('[data-testid^="grant-remove-"]').click();
  await smokeGrant.waitFor({ state: "detached", timeout: T });
  check("the grant stays revoked without undo", true);

  // 역할 더하기 - 줄에 붙어 뜨는 고르기를 키 A로 열고 여러 개를 한 번에, 이미 받은 역할은 목록에 없다
  await findById(page, "grants-table").press("a");
  await wait(page, "grant-add-pop");
  const modalHtml = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].map((el) => el.outerHTML.slice(0, 160)).join(" | "));
  check("the add picker opens without a dimmed screen", modalHtml === "", modalHtml);
  check("add is disabled until a role is picked", await findById(page, "grant-add-save").isDisabled());
  await page.keyboard.press("Escape");
  await findById(page, "grant-add-pop").waitFor({ state: "detached", timeout: T });
  await findById(page, "grants-table").press("a");
  await wait(page, "grant-add-pop");
  await page.locator('[data-testid^="grant-add-role-"]').last().check();
  await findById(page, "grant-add-save").click();
  await findById(page, "grant-add-pop").waitFor({ state: "detached", timeout: T });
  await smokeGrant.waitFor({ state: "visible", timeout: T });
  check("the added role shows in the detail", true);
  await smokeGrant.locator('[data-testid^="grant-remove-"]').click();
  await smokeGrant.waitFor({ state: "detached", timeout: T });

  // 키보드 ↑↓ - 고른 줄이 바로 바뀐다
  await findById(page, "grants-search").fill("");
  await findById(page, "grants-table").press("ArrowDown");
  const afterDown = await page.locator('[data-testid^="grants-subject-"][aria-selected="true"]').getAttribute("data-testid");
  await findById(page, "grants-table").press("ArrowUp");
  const afterUp = await page.locator('[data-testid^="grants-subject-"][aria-selected="true"]').getAttribute("data-testid");
  check("arrow keys move the selection", afterDown !== null && afterUp !== null && afterDown !== afterUp, `${afterDown} / ${afterUp}`);

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
  await pickOption(page, "dev-user-switcher", "prod.member");
  await wait(page, "admin-tab-batch");
  check("access tab disappears after switching to prod.member", (await countById(page, "admin-tab-access")) === 0);
  check("batch tab takes over", await isSelected(page, "admin-tab-batch"));
});

// 11) 권한이 하나도 없으면 관리 화면은 홈으로 돌려보낸다
// 디렉터리에 없는 계정은 묶음 목록이 403(활성 계정 아님)이라 콘솔 오류를 허용하고, 빈 화면 대신 사람 말 문구가 보이는지 본다
await runStep("admin without permissions", { devUser: "ghost.user", allowConsoleErrors: true }, async ({ page }) => {
  await page.goto(`${BASE}/admin`);
  await page.waitForURL((url) => url.pathname === "/", { timeout: T });
  await wait(page, "top-bar-user");
  check("redirected to home", new URL(page.url()).pathname === "/", page.url());
  await wait(page, "bundles-error");
  check("no admin tabs were rendered", (await countById(page, "admin-tab-access")) === 0);
});

// 12) 운영 권한(ops.member) - HR 미설정·AI 꺼짐이 사람 말로 보이고 원문 503은 새지 않는다. 일부러 503을 일으키므로 콘솔 오류 검사는 건너뛴다.
await runStep("admin ops panels as ops.member", { devUser: "ops.member", allowConsoleErrors: true }, async ({ page, takeShot }) => {
  // 사용량은 DB에 쌓인다(가짜 AI로 돈 SOP 스모크·설명서 그림 뽑기가 행을 남긴다) - 빈 표 문구를 보려고 이 단계에서만 빈 목록으로 돌려준다. 행이 있는 표는 아래 가짜 응답 단계가 본다
  await page.route("**/api/admin/ai/usage**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto(`${BASE}/admin`);
  await wait(page, "admin-tab-directory");
  check("access tab is hidden, the three ops tabs are shown", (await countById(page, "admin-tab-access")) === 0 && (await countById(page, "admin-tab-batch")) === 1 && (await countById(page, "admin-tab-ai")) === 1);
  check("first allowed tab is selected", await isSelected(page, "admin-tab-directory"));

  // B6: 목록 503이면 안내 한 줄이 단추 줄 위에 서고 두 단추는 꺼지며 표·카드 토글은 없다(원문 503은 새지 않는다)
  await wait(page, "hr-sync-not-configured");
  const notice = await getText(page, "hr-sync-not-configured");
  check("notice explains HR is not set up", notice.includes("HR sync is not set up on this server"), notice);
  check("notice hides the status code", !notice.includes("503"), notice);
  const noticeBox = await findById(page, "hr-sync-not-configured").boundingBox();
  const runBox = await findById(page, "hr-sync-run").boundingBox();
  check("notice sits above the buttons", noticeBox !== null && runBox !== null && noticeBox.y < runBox.y, JSON.stringify({ noticeBox, runBox }));
  check("sync and preview buttons are disabled", (await findById(page, "hr-sync-run").isDisabled()) && (await findById(page, "hr-sync-preview").isDisabled()));
  check("run history error notice is not duplicated", (await countById(page, "hr-sync-runs-error")) === 0);
  check("view toggle is absent", (await countById(page, "hr-sync-runs-view")) === 0);
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
  await page.locator('[data-testid="top-bar-lang-ko"]').click();
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
  // 한 작업이 한 줄 - 결과 둘이 같은 줄 안에 나란히
  const jobRows = await findByPrefix(page, "batch-job-").count();
  check("one row per job", jobRows === 3, String(jobRows));
  await takeShot("baseline-admin-batch.png");

  await findById(page, "admin-tab-ai").click();
  await findById(page, "ai-ping").click();
  await wait(page, "ai-ping-result");
  const okPing = await getText(page, "ai-ping-result");
  check("ping reports the model and latency", okPing.includes("glm-test") && okPing.includes("842 ms") && okPing.includes("answered as expected"), okPing.replace(/\s+/g, " "));
  await wait(page, "ai-usage-table");
  check("usage rows are keyed by date", (await countById(page, "ai-usage-row-2026-11-03")) === 1 && (await countById(page, "ai-usage-row-2026-11-04")) === 1);
  const totals = await getText(page, "ai-usage-total");
  check("usage totals add up with thousands separators", totals.includes("17 calls") && totals.includes("4,600 prompt tokens"), totals);
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
  await wait(page, "grant-missing-dept:GONE-DEPT");
  const goneText = await getText(page, "grant-missing-dept:GONE-DEPT");
  check("a vanished department is badged", goneText.includes("Department not found"), goneText);
  const retiredText = await getText(page, "grant-missing-user:retired.person");
  check("a vanished person is badged", retiredText.includes("Person not found"), retiredText);
  await findById(page, "grants-subject-dept:GONE-DEPT").click();
  await wait(page, "grant-row-91");
  const missingRow = `${await getText(page, "grants-subject-dept:GONE-DEPT")} ${await getText(page, "grant-row-91")}`;
  check("the row still shows which subject it was", missingRow.includes("GONE-DEPT") && missingRow.includes("Permission Admin"), missingRow.replace(/\s+/g, " "));
  await takeShot("baseline-admin-grants-missing.png");

  await findById(page, "grants-subject-user:retired.person").click();
  await wait(page, "effective-inactive");
  check("an inactive person is explained", (await getText(page, "effective-inactive")).includes("inactive") && (await countById(page, "effective-none")) === 1);

  await findById(page, "grants-search").fill("dev.admin");
  await findById(page, "grants-subject-user:dev.admin").click();
  await wait(page, "effective-sysadmin");
  check("a system administrator is explained and holds all eight permissions", (await findByPrefix(page, "effective-perm-").count()) === 8);
  check("a known, active sysadmin gets no directory note", (await countById(page, "effective-sysadmin-note")) === 0);

  // 디렉터리에 아직 없는 부트스트랩 sysadmin(APP_SYSADMINS) - 백엔드는 known=false여도 권한 전부를 돌려준다. dev.admin은 실제 응답을 쓰려고 로그인 ID를 따로 잡는다.
  await page.route("**/api/access/effective/bootstrap.admin", (route) =>
    fulfillJson(route, {
      login_id: "bootstrap.admin", known: false, active: false, is_sysadmin: true,
      permissions: ["directory.sync", "permission.manage", "system.view", "ai.admin"], sources: {},
    }),
  );
  await findById(page, "grants-search").fill("bootstrap.admin");
  await findById(page, "grants-subject-user:bootstrap.admin").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="effective-sysadmin-note"]'), null, { timeout: T });
  const bootstrapText = await getText(page, "effective-result");
  check("a sysadmin without an employee row is still shown as a system administrator", (await findById(page, "effective-sysadmin").isVisible()) && bootstrapText.includes("System administrator"), bootstrapText.replace(/\s+/g, " "));
  check("the note is neutral and never says it holds no permissions", bootstrapText.includes("Not in the employee directory yet.") && !bootstrapText.includes("holds no permissions") && (await countById(page, "effective-unknown")) === 0, bootstrapText.replace(/\s+/g, " "));
  check("all four permission rows are still listed, in catalog order", (await findByPrefix(page, "effective-perm-").count()) === 4 && (await countById(page, "effective-none")) === 0 && bootstrapText.indexOf("Manage permissions") < bootstrapText.indexOf("Run directory sync"), bootstrapText.replace(/\s+/g, " "));
  await takeShot("baseline-admin-lookup-bootstrap.png");
});

// 표준 골격(Outline) - sysadmin에게만 탭이 보이고, 제목 하나를 고쳐 저장하면 다시 읽어도 남는다. 끝에 원래 제목으로 되돌린다
await runStep("admin outline as dev.admin", { devUser: "dev.admin" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/admin?tab=outline`);
  await wait(page, "admin-outline-table");
  const numbers = await page.locator('[data-testid^="admin-outline-row-"][data-testid$="-number"]').allTextContents();
  check("the outline lists numbered items from 1", numbers.length > 0 && numbers[0] === "1", numbers.join(" "));
  const save = page.locator('[data-testid="admin-outline-save"]');
  check("Save is off until something changes", await save.isDisabled());
  // 한 줄 56px 안 - 키는 영문 제목 아래 한 줄, 하위 항목 칸은 눌러 펼친다
  const rowHeights = await page.locator('[data-testid="admin-outline-table"] tbody > tr').evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  check("every outline row fits one line", Math.max(...rowHeights) <= 58, rowHeights.join(" "));
  const namesButton = page.locator('[data-testid^="admin-outline-row-"][data-testid$="-children"]').first();
  await namesButton.click();
  const subRow = page.locator('[data-testid$="-children-row"]').first();
  await subRow.waitFor({ state: "visible", timeout: T });
  check("sub-item fields unfold under the row", (await subRow.locator("input").count()) >= 1 && (await namesButton.getAttribute("aria-expanded")) === "true");
  await namesButton.click();
  await subRow.waitFor({ state: "detached", timeout: T });
  check("the menu is grouped", (await countById(page, "admin-nav-people")) === 1 && (await countById(page, "admin-nav-ops")) === 1 && (await countById(page, "admin-nav-standard")) === 1);
  const firstRow = page.locator('[data-testid^="admin-outline-row-"][data-testid$="-title-en"]').first();
  const original = await firstRow.inputValue();
  const isOutlinePut = (response) => response.url().includes("/api/admin/outline") && response.request().method() === "PUT";
  const putTitle = async (title) => {
    await firstRow.fill(title);
    const saved = page.waitForResponse(isOutlinePut, { timeout: T });
    await save.click();
    return (await saved).status();
  };
  check("an edited title saves", (await putTitle(`${original} smoke`)) === 200);
  await takeShot("admin-outline.png");
  await page.reload();
  await wait(page, "admin-outline-table");
  check("the saved title is still there after a reload", (await firstRow.inputValue()) === `${original} smoke`, await firstRow.inputValue());
  check("the title goes back", (await putTitle(original)) === 200);
});

// Bundle 상태 거르기 · 진행 막대 · 구성원 요약, AI 지침 읽을 이름 · 버전 타임라인(본문은 상자 스크롤 없이)
// 변경 기록 이어 불러오기 - 30건씩, 끝에 닿으면 마지막 기록 id 앞부터 받는다
await runStep("audit log keeps loading older records", { devUser: "qa.lead" }, async ({ page }) => {
  const asked = [];
  const makeEvents = (from, count) =>
    Array.from({ length: count }, (_, index) => ({ id: from - index, occurred_at: "2026-11-20T10:00:00+09:00", actor: "seed", action: "role.create", detail: { name: `Role ${from - index}`, permissions: [] } }));
  await page.route("**/api/access/audit**", (route) => {
    const before = new URL(route.request().url()).searchParams.get("before");
    asked.push(before);
    const body = before === null ? makeEvents(100, 30) : before === "71" ? makeEvents(70, 30) : makeEvents(40, 5);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${BASE}/admin?tab=access&sub=audit`);
  await page.locator('[data-testid="audit-row-100"]').waitFor({ state: "visible", timeout: T });
  // 끝까지 굴려 다음 묶음들을 부른다 - 화면 안에 닿으면 바로 이어진다
  await page.waitForFunction(() => {
    const more = document.querySelector('[data-testid="audit-more"]');
    more?.scrollIntoView();
    return document.querySelectorAll('[data-testid^="audit-row-"]').length >= 65 && !more;
  }, null, { timeout: T });
  // 첫 묶음은 개발 모드(StrictMode)에서 두 번 물을 수 있다 - 이어 부른 커서만 본다
  check("older records are asked for by the last id", [...new Set(asked)].join(",") === ",71,41", asked.join(","));
});

await runStep("admin bundles and guidelines as dev.admin", { devUser: "dev.admin" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/admin?tab=bundles`);
  // 목록 틀은 쉬머일 때도 있다 - 첫 줄이 올 때까지 기다린다
  await page.locator('[data-testid^="admin-bundle-link-"]').first().waitFor({ state: "visible", timeout: T });
  const total = await page.locator('[data-testid^="admin-bundle-link-"]').count();
  await findById(page, "admin-bundles-status-in_review").click();
  const inReview = await page.locator('[data-testid^="admin-bundle-link-"]').count();
  check("the status pill filters bundles", inReview > 0 && inReview < total, `${inReview} of ${total}`);
  await findById(page, "admin-bundles-status-all").click();
  check("progress is shown as a bar", (await page.locator(".adm-bar-track").count()) > 0);
  const people = page.locator('[data-testid^="admin-bundle-people-"]').first();
  check("the member summary reads the names", ((await people.getAttribute("aria-label")) ?? "").includes("("), (await people.getAttribute("aria-label")) ?? "");
  await page.setViewportSize({ width: 1120, height: 800 });
  check("the member summary stays on a narrow window", await people.isVisible());
  await page.setViewportSize({ width: 1280, height: 800 });
  await takeShot("admin-bundles.png");

  await page.goto(`${BASE}/admin?tab=guidelines`);
  await wait(page, "guideline-content");
  const firstKey = await getText(page, "guideline-key-rules");
  check("a guideline has a readable name and keeps its key", firstKey.includes("Restructuring rules") && firstKey.includes("rules"), firstKey);
  check("the version list has the active version", (await getText(page, "guideline-versions")).includes("Active"));
  const boxed = await findById(page, "guideline-content").evaluate((el) => {
    let node = el.parentElement;
    while (node && node.tagName !== "MAIN") {
      if (node.scrollHeight > node.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.clientHeight <= 600) return true;
      node = node.parentElement;
    }
    return false;
  });
  check("the guideline text is not boxed into an inner scroll", !boxed);
  await takeShot("admin-guidelines.png");
});

await runStep("admin outline is hidden without the permission", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/admin`);
  await wait(page, "admin-tab-access");
  check("no Outline tab for a user without outline.manage", (await page.locator('[data-testid="admin-tab-outline"]').count()) === 0);
});

// 15) 사용 설명서 - 로그인 전에 받은 조각 링크가 로그인 뒤 같은 조각으로 돌아오고, 읽음 표시가 읽은 양에 잡히며, 상단 바 도움말이 지금 화면을 설명하는 조각을 가리킨다
// 사내 AI로 부여 등록 - 스모크 서버는 AI가 꺼져 있어 먼저 안내를 보고, 읽기 응답만 흉내 내 미리보기 · 고르기 · 반영을 밟는다(반영은 실제 일괄 저장, 끝에 되돌린다)
await runStep("grants with AI as qa.lead", { devUser: "qa.lead", allowConsoleErrors: true }, async ({ page, takeShot }) => {
  const api = (path, init = {}) => page.request.fetch(`${BASE}/api${path}`, { ...init, headers: { "X-Dev-User": "qa.lead", "Content-Type": "application/json" } });
  const roles = await (await api("/access/roles")).json();
  const roleId = (name) => roles.find((role) => role.name === name)?.id ?? null;
  await page.goto(`${BASE}/admin?tab=access&sub=grants`);
  await wait(page, "grant-ai-open");
  await findById(page, "grant-ai-open").click();
  await wait(page, "grant-ai");
  check("the AI window opens with an empty preview", await page.locator('[data-testid="grant-ai-empty"]').isVisible());
  check("apply waits for a reading", await page.locator('[data-testid="grant-ai-apply"]').isDisabled());
  check("read waits for text", await page.locator('[data-testid="grant-ai-read"]').isDisabled());
  await page.locator('[data-testid="grant-ai-text"]').fill("prod.member Operations");
  await findById(page, "grant-ai-read").click();
  await wait(page, "grant-ai-error");
  check("AI off says to add one by one", (await getText(page, "grant-ai-error")).includes("Add grant"), await getText(page, "grant-ai-error"));

  const user = (id) => ({ subject_type: "user", subject_id: id });
  await page.route("**/api/access/grants/ai-read", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model: "fake",
        lines: [
          { line: 1, action: "add", subjects: [{ written: "prod.member", matches: [user("prod.member")] }], roles: [{ written: "Operations", role_id: roleId("Operations") }], permissions: [] },
          { line: 2, action: "add", subjects: [{ written: "ops.member", matches: [user("ops.member")] }], roles: [{ written: "Operations", role_id: roleId("Operations") }], permissions: [] },
          { line: 3, action: "add", subjects: [{ written: "김민서", matches: [user("qa.member"), user("dev.admin")] }], roles: [{ written: "Permission Admin", role_id: roleId("Permission Admin") }], permissions: [] },
          { line: 4, action: "add", subjects: [{ written: "홍길동", matches: [] }], roles: [{ written: "Ghost", role_id: null }], permissions: [] },
        ],
      }),
    }),
  );
  await findById(page, "grant-ai-read").click();
  await wait(page, "grant-ai-rows");
  check("a new grant line counts as new", (await getText(page, "grant-ai-status-0")).includes("New 1"), await getText(page, "grant-ai-status-0"));
  check("an already held line cannot be checked", (await getText(page, "grant-ai-status-1")).includes("Already held 1") && (await page.locator('[data-testid="grant-ai-check-1"]').isDisabled()), await getText(page, "grant-ai-status-1"));
  check("two people with one name wait for a pick", (await getText(page, "grant-ai-status-2")).includes("Choose a person"), await getText(page, "grant-ai-status-2"));
  check("an unknown person and role are lines to check", (await page.locator('[data-testid="grant-ai-row-3"]').getAttribute("data-check")) !== null && (await getText(page, "grant-ai-status-3")).includes("Not in the directory"), await getText(page, "grant-ai-status-3"));
  check("apply counts only the clear change", (await getText(page, "grant-ai-apply")) === "Apply 1", await getText(page, "grant-ai-apply"));
  await pickOption(page, "grant-ai-pick-2", "user:dev.admin");
  check("picking the person adds that line", (await getText(page, "grant-ai-apply")) === "Apply 2", await getText(page, "grant-ai-apply"));
  await page.locator('[data-testid="grant-ai-check-0"]').locator("..").click();
  check("unchecking a line leaves it out", (await getText(page, "grant-ai-apply")) === "Apply 1", await getText(page, "grant-ai-apply"));
  await page.locator('[data-testid="grant-ai-check-0"]').locator("..").click();
  await takeShot("baseline-grants-ai.png");
  await findById(page, "grant-ai-apply").click();
  const doneToast = page.locator(".toast-stack", { hasText: "Added 2" });
  await doneToast.waitFor({ timeout: T });
  check("applying reports what changed", (await doneToast.innerText()).includes("revoked 0"), (await doneToast.innerText()).replace(/\s+/g, " "));
  check("the window closes after applying", await page.locator('[data-testid="grant-ai"]').count() === 0);
  const grants = await (await api("/access/grants")).json();
  const made = grants.filter((grant) => (grant.subject_id === "prod.member" && grant.role_name === "Operations") || (grant.subject_id === "dev.admin" && grant.role_name === "Permission Admin"));
  check("both grants exist on the server", made.length === 2, made.map((grant) => `${grant.subject_id}:${grant.role_name}`).join(","));
  // 뒤 단계가 보는 부여 · 기록을 처음처럼 둔다
  await api("/access/grants/batch", { method: "POST", data: { remove: made.map((grant) => grant.id) } });
});

await runStep("manual", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/manual#account`);
  await wait(page, "login-dev-user-qa.member");
  check("a logged-out manual link lands on /login", new URL(page.url()).pathname === "/login", page.url());
  await page.locator('[data-testid="login-dev-user-qa.member"]').click();
  await wait(page, "manual-unit-account");
  await page.locator('[data-testid="manual-toc-account"][aria-current="true"]').waitFor({ timeout: T });
  const landed = new URL(page.url());
  check("sign-in returns to the same piece", landed.pathname === "/manual" && landed.hash === "#account", page.url());
  check("the linked piece is the current one", (await page.locator('[data-testid="manual-unit-account"]').getAttribute("data-current")) !== null);
  check("the help link is hidden on the manual itself", (await page.locator('[data-testid="top-bar-manual"]').count()) === 0);
  check("an English screen says the manual is Korean only", await page.locator('[data-testid="manual-korean-only"]').isVisible());

  const before = await getText(page, "manual-progress");
  const total = /^0 of (\d+) read$/.exec(before)?.[1];
  check("nothing is read at first", total !== undefined, before);
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="manual-unit-account"][data-state="read"]').waitFor({ timeout: T });
  check("Enter marks the current piece as read", (await getText(page, "manual-progress")) === `1 of ${total} read`, await getText(page, "manual-progress"));
  check("the piece shows Read", (await getText(page, "manual-unit-account-state")).includes("Read"), await getText(page, "manual-unit-account-state"));
  await takeShot("baseline-manual.png");
  await page.reload();
  await wait(page, "manual-unit-account");
  check("the mark survives a reload", (await getText(page, "manual-progress")) === `1 of ${total} read`, await getText(page, "manual-progress"));
  await page.locator('[data-testid="manual-unit-account-unmark"]').click();
  await page.locator('[data-testid="manual-unit-account"][data-state="unread"]').waitFor({ timeout: T });
  check("Unmark clears it", (await getText(page, "manual-progress")) === before, await getText(page, "manual-progress"));

  await page.locator('[data-testid="manual-search"]').fill("zzzz-no-such-word");
  await wait(page, "manual-empty");
  await page.locator('[data-testid="manual-empty-clear"]').click();
  await wait(page, "manual-unit-account");
  check("clearing an empty search brings the pieces back", (await page.locator("section.manual-unit").count()) === Number(total));

  // 도움말은 새 탭으로 열린다 - 가리키는 자리만 본다
  await page.goto(`${BASE}/account`);
  await wait(page, "top-bar-manual");
  const accountLink = page.locator('[data-testid="top-bar-manual"]');
  check("the help link on /account points at the account piece", (await accountLink.getAttribute("href")) === "/manual#account" && (await accountLink.getAttribute("target")) === "_blank", (await accountLink.getAttribute("href")) ?? "");
  await page.goto(`${BASE}/`);
  await wait(page, "top-bar-manual");
  check("the help link on the Bundle list points at getting started", (await page.locator('[data-testid="top-bar-manual"]').getAttribute("href")) === "/manual#start");
});

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
