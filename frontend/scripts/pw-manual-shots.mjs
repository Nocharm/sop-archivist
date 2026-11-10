// 시스템 설명서(docs/manual/system-walkthrough.html)의 화면 그림을 다시 찍는다. 화면이 바뀌면 이 스크립트로 그림과 번호 위치를 새로 뽑는다.
// 전제: backend에서 reset_db → seed_sop_demo 직후의 DB(합성 묶음 1–4)로 uvicorn(AUTH_MODE=dev, DEV_ENFORCE_PERMISSIONS=true, APP_SYSADMINS=dev.admin),
//       frontend에서 npm run dev. 실행은 frontend/에서: BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs
// 산출: docs/manual/img/<장면>.png, docs/manual/img/marks.js(장면마다 번호 표시 자리 — 화면 크기 대비 비율).
// 마지막 장면들은 묶음 3을 검토 완료로 바꾼다. 다시 찍으려면 DB를 다시 만든다(reset_db → seed_sop_demo).
// MANUAL=app이면 앱 안 사용 설명서(frontend/public/manual/user-manual.md)의 그림을 찍는다: `app`이 붙은 장면만, 1120x720(장면이 폭을 따로 정하면 그 폭), 번호 표시 없이
//       frontend/public/manual/img/<app.name>.png로. 묶음을 바꾸는 장면이 없어 같은 DB에서 여러 번 돌려도 된다.
//       개발 서버에만 있는 것(dev 사용자 고르기, Next 개발 표시)은 가리고 찍는다 - 실제 사용자가 보는 화면과 같게.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_MANUAL = process.env.MANUAL === "app";
const OUT_DIR = APP_MANUAL ? resolve(SCRIPT_DIR, "../public/manual/img") : resolve(SCRIPT_DIR, "../../docs/manual/img");
const BASE = process.env.BASE_URL ?? "http://localhost:3777";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// 앱 안 설명서는 글 폭(700~860px)에 줄여 넣으니 앱이 받는 가장 좁은 폭(1120)으로 찍어 글자가 덜 줄게 한다
const VIEWPORT = APP_MANUAL ? { width: 1120, height: 720 } : { width: 1440, height: 900 };
const APP_HIDE_CSS = 'nextjs-portal, .tb span:has([data-testid="dev-user-switcher"]) { display: none !important; }';
const T = 15000;

// 로컬에는 배치 기록이 없어 관리 > 배치 작업은 예시 응답으로 찍는다(설명서 캡션에 예시라고 적는다)
const SAMPLE_BATCH_RUNS = [
  { job: "db_backup", outcome: "success", ran_at: "2026-11-09T04:00:12+09:00", detail: "sop_archivist_20261109_0400.dump · 14 kept" },
  { job: "hr_sync", outcome: "success", ran_at: "2026-11-09T04:00:03+09:00", detail: "scanned=1240 created=3 deactivated=1" },
  { job: "db_backup", outcome: "failure", ran_at: "2026-11-07T04:00:09+09:00", detail: "pg_dump exited with 1" },
];

const text = (value) => `text=${value}`;
const id = (value) => `[data-testid="${value}"]`;

async function clickText(page, value) {
  const target = page.getByText(value, { exact: false }).first();
  await target.scrollIntoViewIfNeeded();
  await target.click();
}

async function click(page, selector) {
  const target = page.locator(selector).first();
  await target.waitFor({ state: "visible", timeout: T });
  await target.click();
}

// 장면 목록 - marks는 번호 순서대로 가리킬 요소(Playwright 선택자)다.
// app: 앱 안 사용 설명서에도 쓰는 장면 - name(그림 이름, 비우면 장면 이름), clip(이 요소만), clipTo(요소들을 감싼 상자), height(화면 위쪽 이만큼만),
//      width(세 칸 화면처럼 1120에서는 답답한 장면의 화면 폭). appOnly는 앱 안 설명서에만 쓴다
const SCENES = [
  { name: "home", app: { height: 380 }, user: "qa.member", path: "/", marks: [id("bundles-row-2"), `${id("bundles-row-2")} .pill`, id("bundles-ko-2"), id("bundles-view")] },
  {
    // 바로 생성(2026-11-09): 이름 없이 BND 코드로 만들어 개요로 들어가고, 문서가 없으면 Split~Review가 잠긴다
    name: "new-bundle", user: "dev.admin", path: "/",
    prep: async (page) => {
      await click(page, id("bundles-new"));
      await page.locator(id("overview-code")).waitFor({ timeout: 15000 });
    },
    marks: [id("overview-code"), id("overview-menu"), id("overview-next"), id("stage-nav-split"), id("stage-nav-history")],
  },
  {
    // 하위 메뉴는 마우스가 떠나면 닫힌다 - 올려 둔 채로 찍는다(keepMouse)
    name: "user-menu", appOnly: true, keepMouse: true, app: { clipTo: [id("top-bar-user"), id("user-menu-signout"), id("user-menu-layout-flyout")] }, user: "qa.member", path: "/",
    prep: async (page) => {
      await click(page, id("top-bar-user"));
      await page.locator(id("user-menu-layout")).hover();
      await page.locator(id("user-menu-layout-flyout")).waitFor({ timeout: T });
    },
  },
  { name: "overview", appOnly: true, app: {}, user: "qa.member", path: "/bundles/2" },
  { name: "history", appOnly: true, app: { height: 560 }, user: "qa.member", path: "/bundles/2/history" },
  { name: "overview-start", user: "qa.member", path: "/bundles/1", marks: [id("overview-next"), id("overview-coverage"), id("overview-gate"), id("overview-members"), id("overview-activity")] },
  {
    name: "documents", app: { height: 470 }, user: "qa.member", path: "/bundles/1/documents",
    marks: [id("documents-upload"), id("documents-1-layout"), id("documents-1-status"), id("documents-1-aux"), id("documents-5-warnings"), id("documents-view")],
  },
  {
    name: "upload", app: { clip: id("upload") }, user: "qa.member", path: "/bundles/1/documents",
    prep: (page) => click(page, id("documents-upload")),
    marks: [id("upload-side-old"), id("upload-side-new"), id("upload-pick")],
  },
  {
    name: "split-unit", app: { name: "split", width: 1280 }, user: "qa.member", path: "/bundles/1/split",
    prep: (page) => clickText(page, "로터를 장착하고 뚜껑을 닫은 후"),
    marks: [id("split-docs"), `${id("split-paper")} >> text=로터를 장착하고 뚜껑을 닫은 후`, id("split-inline-check"), id("split-unit-id"), id("split-primary"), id("split-split"), id("split-language"), id("split-pair"), id("split-help")],
  },
  {
    name: "split-table", user: "qa.member", path: "/bundles/1/split",
    prep: async (page) => {
      // 표 위의 가는 손잡이가 표 전체 단위다(칸 글자를 누르면 칸 문장이 골라진다)
      const handle = page.locator(`${id("split-paper")} .ptbl-cap`).first();
      await handle.scrollIntoViewIfNeeded();
      await handle.click();
    },
    marks: [`${id("split-paper")} .ptbl-cap`, id("split-unit-id"), id("split-table")],
  },
  {
    name: "split-pdf", user: "qa.member", path: "/bundles/1/split",
    prep: (page) => click(page, id("split-doc-5")),
    marks: [id("split-doc-5"), id("split-paper")],
  },
  { name: "tobe", user: "qa.member", path: "/bundles/1/tobe", marks: [text("Excel template"), text("Import Excel"), id("tobe-add"), `[data-testid$="-toggle"]`, id("tobe-save")] },
  {
    name: "tobe-sop", app: { name: "tobe" }, user: "qa.member", path: "/bundles/1/tobe",
    prep: (page) => click(page, `[data-testid$="-toggle"]`),
    marks: [`[data-testid$="-slots"]`, `[data-testid*="-na-"]`],
  },
  {
    name: "tobe-wi", user: "qa.member", path: "/bundles/1/tobe",
    prep: async (page) => {
      await page.locator(`[data-testid$="-toggle"]`).nth(1).click();
    },
    marks: [`[data-testid$="-steps"]`, `[data-testid$="-add-step"]`],
  },
  {
    name: "assign-start", user: "qa.member", path: "/bundles/2/assign",
    marks: [id("assign-filters"), id("assign-old"), id("assign-pick-prompt"), id("assign-legend")],
  },
  {
    name: "assign-place", app: { name: "assign" }, user: "qa.member", path: "/bundles/2/assign",
    prep: async (page) => {
      await page.keyboard.press("j");
      await page.waitForLoadState("networkidle");
      await click(page, id("assign-acc-all"));
      await page.locator('[data-testid^="assign-tree-p"]').first().click();
      await page.locator('[data-testid^="assign-tree-place-"]:not([disabled])').first().click();
    },
    marks: [id("assign-chosen"), id("assign-primary"), id("assign-edit"), id("assign-hold"), `[data-testid^="assign-tree-place-"]`],
  },
  {
    name: "assign-confirmed", user: "qa.member", path: "/bundles/2/assign",
    prep: async (page) => {
      await click(page, id("assign-filter-confirmed"));
      await page.locator(id("assign-old")).getByText("이 절차는 Eppendorf").first().click();
      await page.waitForLoadState("networkidle");
    },
    marks: [`${id("assign-old")} >> text=이 절차는 Eppendorf`, id("assign-chosen"), `[data-testid^="assign-text-"]`, id("assign-confirmed-by"), id("assign-clear")],
  },
  {
    name: "assign-link", app: {}, user: "qa.member", path: "/bundles/2/assign",
    prep: async (page) => {
      await click(page, id("assign-filter-unassigned"));
      const candidate = page.locator(`${id("assign-new")} button.new-line[data-state="candidate"]`);
      for (let step = 0; step < 40 && (await candidate.count()) === 0; step += 1) {
        await page.keyboard.press("j");
        await page.waitForLoadState("networkidle");
      }
      await candidate.first().click();
    },
    marks: [id("assign-identical"), id("assign-new"), `${id("assign-new")} button.new-line[data-state="picked"]`, id("assign-chosen"), id("assign-divider"), id("assign-new-zoom")],
  },
  {
    name: "assign-unsourced", user: "qa.member", path: "/bundles/2/assign",
    prep: async (page) => {
      await click(page, id("assign-filter-unsourced"));
      await page.waitForLoadState("networkidle");
    },
    marks: [id("assign-filter-unsourced"), `${id("assign-new")} button.new-line[data-state="focus"]`, id("assign-mark-new")],
  },
  {
    name: "assign-ai", app: {}, user: "qa.member", path: "/bundles/4/assign",
    prep: async (page) => {
      await page.keyboard.press("j");
      await page.locator(id("assign-rec-0")).waitFor({ timeout: T });
    },
    marks: [id("assign-filter-ai_suggested"), id("assign-ai-reason"), id("assign-rec-0"), id("assign-chosen"), id("assign-primary")],
  },
  {
    name: "assign-hold", user: "qa.member", path: "/bundles/4/assign",
    prep: async (page) => {
      await click(page, id("assign-filter-on_hold"));
      await page.keyboard.press("j");
      await page.waitForLoadState("networkidle");
    },
    marks: [id("assign-filter-on_hold"), id("assign-system-hold")],
  },
  {
    name: "outputs-a", app: {}, user: "qa.member", path: "/bundles/3/outputs",
    prep: (page) => click(page, id("outputs-tab-a")),
    marks: [id("outputs-tab-a"), id("output-a"), id("outputs-lang-en"), id("outputs-summary"), id("outputs-checks"), id("outputs-export")],
  },
  { name: "outputs-b", app: {}, user: "qa.member", path: "/bundles/3/outputs", prep: (page) => click(page, id("outputs-tab-b")), marks: [id("output-b")] },
  { name: "outputs-c", app: {}, user: "qa.member", path: "/bundles/3/outputs", prep: (page) => click(page, id("outputs-tab-c")), marks: [id("output-c")] },
  {
    name: "outputs-c-wi", user: "qa.member", path: "/bundles/3/outputs",
    prep: async (page) => {
      await click(page, id("outputs-tab-c"));
      await page.getByText("Operation of Eppendorf Centrifuge").first().scrollIntoViewIfNeeded();
    },
    marks: [text("Operation of Eppendorf Centrifuge")],
  },
  { name: "overview-ready", user: "qa.member", path: "/bundles/3", marks: [id("overview-status"), id("overview-gate")] },
  { name: "review-reviewer", app: { name: "review" }, user: "qa.lead", path: "/bundles/3/review", marks: [id("review-status"), id("review-complete"), id("review-return")] },
  {
    name: "review-return", user: "qa.lead", path: "/bundles/3/review",
    prep: (page) => click(page, id("review-return")),
    marks: [id("review-reason-text"), id("review-reason-confirm")],
  },
  { name: "account", app: { height: 520 }, user: "qa.member", path: "/account", marks: [id("account-identity"), id("account-permissions")] },
  { name: "admin-roles", app: { name: "admin", height: 560 }, user: "dev.admin", path: "/admin?tab=access", marks: [id("admin-tab-access"), id("access-sub-roles"), id("role-create"), id("access-roles")] },
  {
    name: "admin-grants", user: "dev.admin", path: "/admin?tab=access",
    prep: (page) => click(page, id("access-sub-grants")),
    marks: [id("access-sub-grants"), id("grant-create"), id("grants-table")],
  },
  {
    name: "admin-audit", user: "dev.admin", path: "/admin?tab=access",
    prep: async (page) => {
      // 시드 DB에는 권한 변경 기록이 없다 - 역할 하나를 만들고 부여해 기록을 남긴다(다시 돌리면 이미 있어 409, 그대로 둔다)
      const headers = { "X-Dev-User": "dev.admin" };
      const role = await page.request.post(`${BASE}/api/access/roles`, { headers, data: { name: "Manual demo role", description: "Synthetic role for the manual", permissions: ["system.view"] } });
      if (role.ok()) {
        const { id: roleId } = await role.json();
        await page.request.post(`${BASE}/api/access/grants`, { headers, data: { subject_type: "user", subject_id: "ops.member", role_id: roleId } });
      }
      await page.reload({ waitUntil: "networkidle" });
      await click(page, id("access-sub-audit"));
    },
    marks: [id("access-sub-audit"), id("audit-table")],
  },
  {
    name: "admin-lookup", user: "dev.admin", path: "/admin?tab=access",
    prep: (page) => click(page, id("access-sub-lookup")),
    marks: [id("access-sub-lookup")],
  },
  { name: "admin-directory", user: "dev.admin", path: "/admin?tab=directory", marks: [id("admin-tab-directory"), id("hr-sync-run"), id("hr-sync-preview")] },
  { name: "admin-batch", user: "dev.admin", path: "/admin?tab=batch", sampleBatch: true, marks: [id("admin-tab-batch"), id("batch-table")] },
  { name: "admin-ai", user: "dev.admin", path: "/admin?tab=ai", marks: [id("admin-tab-ai"), id("ai-ping"), id("ai-usage-table")] },
  { name: "admin-bundles", user: "dev.admin", path: "/admin?tab=bundles", marks: [id("admin-tab-bundles"), id("admin-bundles-attention"), id("admin-bundles-list")] },
  { name: "admin-guidelines", user: "dev.admin", path: "/admin?tab=guidelines", marks: [id("guideline-key-rules"), id("guideline-versions"), id("guideline-detail")] },
  // 여기부터 묶음 3을 바꾼다 - 검토 완료 뒤 모습
  {
    name: "review-done", user: "qa.lead", path: "/bundles/3/review", mutates: true,
    prep: async (page) => {
      await click(page, id("review-complete"));
      await click(page, id("review-complete-modal-confirm"));
      await page.locator(id("review-status")).filter({ hasText: "complete" }).first().waitFor({ timeout: T });
    },
    marks: [id("review-status")],
  },
  { name: "review-reopen", user: "qa.member", path: "/bundles/3/review", mutates: true, marks: [id("review-status"), id("review-reopen")] },
  { name: "home-done", user: "qa.member", path: "/", mutates: true, marks: [`${id("bundles-row-3")} .pill`, `${id("bundles-row-2")} .pill`] },
];

async function measureMarks(page, selectors, name) {
  const marks = [];
  for (const [index, selector] of selectors.entries()) {
    const target = page.locator(selector).first();
    const box = (await target.count()) ? await target.boundingBox() : null;
    if (!box || box.width === 0) {
      console.warn(`  ! ${name}: mark ${index + 1} not found or hidden - ${selector}`);
      continue;
    }
    // 화면 밖으로 잘린 상자는 보이는 부분만 남긴다
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    const w = Math.min(VIEWPORT.width, box.x + box.width) - x;
    const h = Math.min(VIEWPORT.height, box.y + box.height) - y;
    if (w <= 0 || h <= 0) {
      console.warn(`  ! ${name}: mark ${index + 1} is off screen - ${selector}`);
      continue;
    }
    const pct = (value, total) => Math.round((value / total) * 10000) / 100;
    marks.push({ n: index + 1, x: pct(x, VIEWPORT.width), y: pct(y, VIEWPORT.height), w: pct(w, VIEWPORT.width), h: pct(h, VIEWPORT.height) });
  }
  return marks;
}

// 앱 안 설명서 그림 한 장 - 요소 하나(clip), 여러 요소를 감싼 상자(clipTo), 화면 위쪽(height), 아니면 화면 전체
async function shootForApp(page, scene) {
  const { name = scene.name, clip, clipTo, height } = scene.app;
  const path = resolve(OUT_DIR, `${name}.png`);
  const view = page.viewportSize();
  if (clip) {
    await page.locator(clip).first().screenshot({ path });
    return;
  }
  if (clipTo) {
    const boxes = [];
    for (const selector of clipTo) boxes.push(await page.locator(selector).first().boundingBox());
    if (boxes.some((box) => box === null)) throw new Error(`clip target not found: ${clipTo.join(", ")}`);
    const PAD = 12;
    const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - PAD);
    const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - PAD);
    const right = Math.min(view.width, Math.max(...boxes.map((box) => box.x + box.width)) + PAD);
    const bottom = Math.min(view.height, Math.max(...boxes.map((box) => box.y + box.height)) + PAD);
    await page.screenshot({ path, clip: { x: left, y: top, width: right - left, height: bottom - top } });
    return;
  }
  await page.screenshot({ path, clip: { x: 0, y: 0, width: view.width, height: height ?? view.height } });
}

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
// 고쳐 보는 동안에는 묶음 3을 바꾸는 장면을 건너뛴다(SKIP_MUTATING=1) - DB를 다시 만들지 않고 여러 번 찍는다
const skipMutating = process.env.SKIP_MUTATING === "1";
const result = {};
let failures = 0;
for (const scene of SCENES) {
  if (only && !only.has(scene.name)) continue;
  if (skipMutating && scene.mutates) continue;
  if (APP_MANUAL ? !scene.app : scene.appOnly) continue;
  const viewport = APP_MANUAL && scene.app.width ? { ...VIEWPORT, width: scene.app.width } : VIEWPORT;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((user) => {
    if (location.protocol === "about:") return;
    localStorage.setItem("sopa.devUser", user);
    localStorage.setItem("sopa.theme", "light");
  }, scene.user);
  if (scene.sampleBatch) await context.route("**/api/admin/batch-runs", (route) => route.fulfill({ json: SAMPLE_BATCH_RUNS }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  try {
    await page.goto(BASE + scene.path, { waitUntil: "networkidle" });
    if (APP_MANUAL) await page.addStyleTag({ content: APP_HIDE_CSS });
    await page.waitForTimeout(600);
    if (scene.prep) {
      await scene.prep(page);
      await page.waitForTimeout(600);
    }
    // 마우스가 남긴 호버 표시가 그림에 찍히지 않게 구석으로 치운다
    if (!scene.keepMouse) await page.mouse.move(viewport.width - 2, viewport.height - 2);
    await page.waitForTimeout(200);
    if (APP_MANUAL) {
      await shootForApp(page, scene);
      console.log(`ok ${scene.app.name ?? scene.name}${errors.length ? ` errors: ${errors.join(" | ")}` : ""}`);
      await context.close();
      continue;
    }
    const marks = await measureMarks(page, scene.marks ?? [], scene.name);
    await page.screenshot({ path: resolve(OUT_DIR, `${scene.name}.png`) });
    result[scene.name] = marks;
    console.log(`ok ${scene.name} (${marks.length} marks)${errors.length ? ` errors: ${errors.join(" | ")}` : ""}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${scene.name}: ${err.message.split("\n")[0]}`);
  }
  await context.close();
}
await browser.close();

if (!APP_MANUAL && !only && !skipMutating) {
  const body = `// pw-manual-shots.mjs가 만든 파일 - 손으로 고치지 않는다. 장면마다 번호 표시 자리(화면 대비 %, 1440x900 기준).\nwindow.MANUAL_MARKS = ${JSON.stringify(result, null, 1)};\n`;
  writeFileSync(resolve(OUT_DIR, "marks.js"), body);
}
console.log(failures ? `${failures} scene(s) failed` : "all scenes captured");
process.exit(failures ? 1 : 0);
