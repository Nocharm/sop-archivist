// 시스템 설명서(docs/manual/system-walkthrough.html)의 화면 그림을 다시 찍는다. 화면이 바뀌면 이 스크립트로 그림과 번호 위치를 새로 뽑는다.
// 전제: backend에서 reset_db → seed_sop_demo 직후의 DB(합성 묶음 1–4)로 uvicorn(AUTH_MODE=dev, DEV_ENFORCE_PERMISSIONS=true, APP_SYSADMINS=dev.admin),
//       frontend에서 npm run dev. 실행은 frontend/에서: BASE_URL=http://localhost:3777 node scripts/pw-manual-shots.mjs
// 산출: docs/manual/img/<장면>.png, docs/manual/img/marks.js(장면마다 번호 표시 자리 — 화면 크기 대비 비율).
// 마지막 장면들은 묶음 3을 검토 완료로 바꾼다. 다시 찍으려면 DB를 다시 만든다(reset_db → seed_sop_demo).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(SCRIPT_DIR, "../../docs/manual/img");
const BASE = process.env.BASE_URL ?? "http://localhost:3777";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORT = { width: 1440, height: 900 };
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

// 장면 목록 - marks는 번호 순서대로 가리킬 요소(Playwright 선택자)다
const SCENES = [
  { name: "home", user: "qa.member", path: "/", marks: [id("bundles-row-2"), `${id("bundles-row-2")} .pill`, id("bundles-ko-2"), id("bundles-view")] },
  {
    // 바로 생성(2026-11-09): 이름 없이 BND 코드로 만들어 개요로 들어가고, 문서가 없으면 Split~Review가 잠긴다
    name: "new-bundle", user: "dev.admin", path: "/",
    prep: async (page) => {
      await click(page, id("bundles-new"));
      await page.locator(id("overview-code")).waitFor({ timeout: 15000 });
    },
    marks: [id("overview-code"), id("overview-menu"), id("overview-next"), id("stage-nav-split"), id("stage-nav-history")],
  },
  { name: "overview-start", user: "qa.member", path: "/bundles/1", marks: [id("overview-next"), id("overview-coverage"), id("overview-gate"), id("overview-members"), id("overview-activity")] },
  {
    name: "documents", user: "qa.member", path: "/bundles/1/documents",
    marks: [id("documents-upload"), id("documents-1-layout"), id("documents-1-status"), id("documents-1-aux"), id("documents-5-warnings"), id("documents-view")],
  },
  {
    name: "upload", user: "qa.member", path: "/bundles/1/documents",
    prep: (page) => click(page, id("documents-upload")),
    marks: [id("upload-side-old"), id("upload-side-new"), id("upload-pick")],
  },
  {
    name: "split-unit", user: "qa.member", path: "/bundles/1/split",
    prep: (page) => clickText(page, "로터를 장착하고 뚜껑을 닫은 후"),
    marks: [id("split-docs"), `${id("split-paper")} >> text=로터를 장착하고 뚜껑을 닫은 후`, id("split-inline-check"), id("split-unit-id"), id("split-primary"), id("split-split"), id("split-language"), id("split-pair"), id("split-legend")],
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
    name: "tobe-sop", user: "qa.member", path: "/bundles/1/tobe",
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
    name: "classify-pick", user: "qa.member", path: "/bundles/2/classify",
    prep: (page) => click(page, id("classify-destination")),
    // 열린 메뉴가 주 단추·보류를 덮으므로 그 둘은 메뉴를 닫은 다음 장면(classify-row)에서 가리킨다
    marks: [id("classify-filters"), `[data-testid^="classify-row-"]`, id("classify-paper"), id("classify-destination-menu")],
  },
  {
    name: "classify-row", user: "qa.member", path: "/bundles/2/classify",
    marks: [id("classify-destination"), id("classify-primary"), id("classify-edit"), id("classify-hold"), id("classify-new")],
  },
  {
    name: "classify-confirmed", user: "qa.member", path: "/bundles/2/classify",
    prep: async (page) => {
      await click(page, id("classify-filter-confirmed"));
      await page.waitForTimeout(400);
      await page.locator(id("classify-list")).getByText("이 절차는 Eppendorf").first().click();
    },
    marks: [`${id("classify-list")} >> text=이 절차는 Eppendorf`, id("classify-destination"), `[data-testid^="classify-text-"]`, `[data-testid^="classify-change-"]`, id("classify-confirmed-by"), id("classify-clear")],
  },
  { name: "classify-list", user: "qa.member", path: "/bundles/2/classify", layout: "list", marks: [id("classify-list"), text("Source"), text("New sentence"), id("classify-primary")] },
  {
    name: "classify-ai", user: "qa.member", path: "/bundles/4/classify",
    marks: [`[data-testid^="classify-row-"]`, id("classify-ai"), `[data-testid^="classify-ai-rule-"]`, `[data-testid^="classify-text-"]`, id("classify-primary"), id("classify-edit")],
  },
  {
    name: "classify-hold", user: "qa.member", path: "/bundles/4/classify",
    prep: async (page) => {
      await click(page, id("classify-filter-on_hold"));
      await page.waitForTimeout(400);
    },
    marks: [id("classify-filter-on_hold"), id("classify-system-hold")],
  },
  {
    name: "match", user: "qa.member", path: "/bundles/4/match",
    marks: [id("match-identical"), `[data-testid^="match-row-"]`, id("match-candidates"), id("match-link"), id("match-new-confirm"), id("match-change")],
  },
  {
    name: "match-done", user: "qa.member", path: "/bundles/3/match",
    prep: async (page) => {
      await click(page, id("match-filter-done"));
      await page.waitForTimeout(300);
      await clickText(page, "Select the program.");
    },
    marks: [`[data-testid^="match-row-"] >> text=Select the program.`, id("match-sources"), id("match-change")],
  },
  {
    name: "outputs-a", user: "qa.member", path: "/bundles/3/outputs",
    prep: (page) => click(page, id("outputs-tab-a")),
    marks: [id("outputs-tab-a"), id("output-a"), id("outputs-lang-en"), id("outputs-summary"), id("outputs-checks"), id("outputs-export")],
  },
  { name: "outputs-b", user: "qa.member", path: "/bundles/3/outputs", prep: (page) => click(page, id("outputs-tab-b")), marks: [id("output-b")] },
  { name: "outputs-c", user: "qa.member", path: "/bundles/3/outputs", prep: (page) => click(page, id("outputs-tab-c")), marks: [id("output-c")] },
  {
    name: "outputs-c-wi", user: "qa.member", path: "/bundles/3/outputs",
    prep: async (page) => {
      await click(page, id("outputs-tab-c"));
      await page.getByText("Operation of Eppendorf Centrifuge").first().scrollIntoViewIfNeeded();
    },
    marks: [text("Operation of Eppendorf Centrifuge")],
  },
  { name: "overview-ready", user: "qa.member", path: "/bundles/3", marks: [id("overview-status"), id("overview-gate")] },
  { name: "review-reviewer", user: "qa.lead", path: "/bundles/3/review", marks: [id("review-status"), id("review-complete"), id("review-return")] },
  {
    name: "review-return", user: "qa.lead", path: "/bundles/3/review",
    prep: (page) => click(page, id("review-return")),
    marks: [id("review-reason-text"), id("review-reason-confirm")],
  },
  { name: "account", user: "qa.member", path: "/account", marks: [id("account-identity"), id("account-permissions")] },
  { name: "admin-roles", user: "dev.admin", path: "/admin?tab=access", marks: [id("admin-tab-access"), id("access-sub-roles"), id("role-create"), id("access-roles")] },
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
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript(([user, layout]) => {
    if (location.protocol === "about:") return;
    localStorage.setItem("sopa.devUser", user);
    localStorage.setItem("sopa.classifyLayout", layout);
    localStorage.setItem("sopa.theme", "light");
  }, [scene.user, scene.layout ?? "paper"]);
  if (scene.sampleBatch) await context.route("**/api/admin/batch-runs", (route) => route.fulfill({ json: SAMPLE_BATCH_RUNS }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  try {
    await page.goto(BASE + scene.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    if (scene.prep) {
      await scene.prep(page);
      await page.waitForTimeout(600);
    }
    // 마우스가 남긴 호버 표시가 그림에 찍히지 않게 구석으로 치운다
    await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2);
    await page.waitForTimeout(200);
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

if (!only && !skipMutating) {
  const body = `// pw-manual-shots.mjs가 만든 파일 - 손으로 고치지 않는다. 장면마다 번호 표시 자리(화면 대비 %, 1440x900 기준).\nwindow.MANUAL_MARKS = ${JSON.stringify(result, null, 1)};\n`;
  writeFileSync(resolve(OUT_DIR, "marks.js"), body);
}
console.log(failures ? `${failures} scene(s) failed` : "all scenes captured");
process.exit(failures ? 1 : 0);
