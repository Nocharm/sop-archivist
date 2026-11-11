// 겹침 감사(Playwright + 시스템 Chrome) - 호버로 펼치거나 떠서 보이는 UI가 옆 글자·입력을 덮는지 잰다.
// 모핑 단추(.mbtn — 라벨 폭은 px로 손으로 맞춘 값이라 번역이 길어지면 조용히 겹친다)·C 줄 끝 단추·Assign 그 자리 메뉴·상단 바 AI 작업 목록과 알림.
// 전제: reset_db → seed_sop_demo 직후 backend 8777(DEV_ENFORCE_PERMISSIONS=true) + frontend 3777. DB를 바꾸지 않는다
// (AI 목록과 알림은 /api/ai/jobs/recent 응답을 브라우저 안에서 바꿔 그린다).
// 실행(frontend/ 에서): node scripts/pw-overlap-audit.mjs — 겹침이 하나라도 있으면 종료 코드 1, 그 화면은 ../.shots/overlap-*.png
// 선택 env: WIDTHS(기본 1280,1920) · LANGS(en,ko) · THEMES(light) · ONLY(장면 이름, 쉼표) · LONG=1(긴 이름·제목을 넣어 본다) · BUNDLE(기본 2 = 분류 절반)
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3777";
const SHOTS = resolve(process.cwd(), "../.shots");
const T = 15000;
const BUNDLE = Number(process.env.BUNDLE ?? 2);
const widths = (process.env.WIDTHS ?? "1280,1920").split(",").map(Number);
const langs = (process.env.LANGS ?? "en,ko").split(",");
const themes = (process.env.THEMES ?? "light").split(",");
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const LONG = process.env.LONG === "1";
const HOVER_SETTLE_MS = 950; // 모핑 지연(--morph-delay 180ms)과 전환(폭·투명도)이 끝날 때까지

mkdirSync(SHOTS, { recursive: true });

// 요소 상자와 겹치는 보이는 글자·입력 - 요소 자신·조상·투명한 것·말줄임으로 잘린 부분은 뺀다
async function findCovered(locator) {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const isVisible = (node) => {
      for (let cur = node; cur && cur !== document.documentElement; cur = cur.parentElement) {
        const style = getComputedStyle(cur);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) < 0.05) return false;
      }
      return true;
    };
    const overlaps = (r) => r.width > 0 && r.height > 0 && Math.min(r.right, box.right) - Math.max(r.left, box.left) > 1 && Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top) > 1;
    // 넘침을 자르는 조상 밖은 보이지 않는다
    const clip = (rect, parent) => {
      let { left, top, right, bottom } = rect;
      for (let cur = parent; cur && cur !== document.body; cur = cur.parentElement) {
        const style = getComputedStyle(cur);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          const c = cur.getBoundingClientRect();
          left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
        }
      }
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const hits = [];
    // 창 안의 단추는 창 뒤(가려진 화면)의 글자와 견주지 않는다
    const root = el.closest('[role="dialog"]') ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent.trim() || el.contains(node) || !parent || !isVisible(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if ([...range.getClientRects()].map((rect) => clip(rect, parent)).some(overlaps)) hits.push(`text "${node.textContent.trim().slice(0, 30)}"`);
    }
    for (const other of root.querySelectorAll("input, textarea, select, [role=combobox], button")) {
      if (other === el || other.contains(el) || el.contains(other) || !isVisible(other)) continue;
      if (overlaps(other.getBoundingClientRect())) hits.push(`${other.tagName.toLowerCase()} ${other.getAttribute("data-testid") ?? ""}`);
    }
    return { hits: [...new Set(hits)], width: Math.round(box.width) };
  });
}

// 요소 안 글자가 제 상자를 넘치는지(잘려 보이는 라벨)와 화면 밖으로 나갔는지
async function findSpill(locator) {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hits = [];
    if (box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight) hits.push("outside the viewport");
    for (const node of [el, ...el.querySelectorAll("*")]) {
      if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== "visible") hits.push(`clipped "${node.textContent.trim().slice(0, 30)}"`);
    }
    return hits;
  });
}

// 펼치는 단추를 하나씩 올려 본다(앞 6개)
async function auditHover(page, selector, report) {
  const buttons = await page.locator(selector).all();
  if (buttons.length === 0) report("no element matched", selector);
  for (const button of buttons.slice(0, 6)) {
    await button.scrollIntoViewIfNeeded();
    await button.hover();
    await page.waitForTimeout(HOVER_SETTLE_MS);
    const { hits, width } = await findCovered(button);
    if (hits.length > 0) report(`${await button.getAttribute("data-testid")} (${width}px)`, hits.join(", "));
    await page.mouse.move(0, 0);
  }
}

const mbtnScenes = [
  { name: "documents", user: "qa.member", url: `/bundles/${BUNDLE}/documents`, ready: '[data-testid$="-delete"]', buttons: ".mbtn-set > .mbtn:not(:disabled)" },
  { name: "tobe", user: "qa.member", url: `/bundles/${BUNDLE}/tobe`, ready: '[data-testid="tobe-list"]', buttons: '[data-testid$="-remove"]:not(:disabled)', long: async (page) => {
    for (const input of await page.locator('input[data-testid$="-title"]').all()) await input.fill("SYNTHETIC very long document title that keeps going and going across the whole column width");
  } },
  { name: "tobe-steps", user: "qa.member", url: `/bundles/${BUNDLE}/tobe`, ready: '[data-testid="tobe-list"]', prepare: async (page) => {
    for (const toggle of await page.locator('[data-testid^="tobe-"][data-testid$="-toggle"]').all()) await toggle.click();
    await page.locator('[data-testid*="-remove-step-"]').first().waitFor({ timeout: T });
    await page.waitForTimeout(800);
  }, buttons: '[data-testid*="-remove-step-"]' },
  { name: "members-modal", user: "qa.member", url: `/bundles/${BUNDLE}`, ready: '[data-testid="overview-members-manage"]', prepare: async (page) => {
    await page.locator('[data-testid="overview-members-manage"]').click();
    await page.locator('[data-testid^="overview-members-modal-remove-"]').first().waitFor({ timeout: T });
  }, buttons: '[data-testid^="overview-members-modal-remove-"]', long: async (page) => {
    await page.locator('[data-testid^="overview-members-modal-row-"] .truncate').evaluateAll((els) => els.forEach((el) => { el.textContent = "Extremely Long Employee Display Name Example (QA Team Department)"; }));
  } },
  { name: "admin-bundles", user: "dev.admin", url: "/admin?tab=bundles", ready: '[data-testid^="admin-bundle-members-"]', buttons: '[data-testid^="admin-bundle-members-"]' },
  { name: "admin-bundle-members", user: "dev.admin", url: "/admin?tab=bundles", ready: '[data-testid^="admin-bundle-members-"]', prepare: async (page) => {
    await page.locator('[data-testid^="admin-bundle-members-"]').first().click();
    await page.locator('[role="dialog"] [data-testid*="-remove-"]').first().waitFor({ timeout: T });
  }, buttons: '[role="dialog"] [data-testid*="-remove-"]' },
  // 갓 만든 DB에는 지침마다 켜진 버전 하나뿐이라 Activate 단추가 없다 - 목록 응답에 꺼진 버전을 하나 더해 그린다(DB는 그대로)
  { name: "admin-guidelines", user: "dev.admin", url: "/admin?tab=guidelines", route: ["**/api/admin/guidelines", async (route) => {
    const response = await route.fetch();
    const guidelines = await response.json();
    for (const item of guidelines) {
      const top = item.versions[0];
      if (top) item.versions.unshift({ ...top, version: top.version + 1, note: "Synthetic draft for the overlap audit", is_active: false, activated_by: null, activated_at: null });
    }
    await route.fulfill({ response, json: guidelines });
  }], ready: '[data-testid^="guideline-activate-"]', buttons: '[data-testid^="guideline-activate-"]:not(:disabled)' },
  { name: "admin-roles", user: "dev.admin", url: "/admin?tab=access", ready: '[data-testid="access-sub-roles"]', prepare: async (page) => {
    await page.locator('[data-testid="access-sub-roles"]').click();
    await page.locator('[data-testid^="role-edit-"]').first().waitFor({ timeout: T });
  }, buttons: '[data-testid^="role-edit-"], [data-testid^="role-delete-"]' },
  { name: "admin-grants", user: "dev.admin", url: "/admin?tab=access", ready: '[data-testid="access-sub-grants"]', prepare: async (page) => {
    await page.locator('[data-testid="access-sub-grants"]').click();
    await page.locator('[data-testid^="grant-remove-"]').first().waitFor({ timeout: T });
  }, buttons: '[data-testid^="grant-remove-"]', long: async (page) => {
    await page.locator('[data-testid^="grant-remove-"]').first().evaluate((btn) => {
      const row = btn.closest("tr");
      for (const cell of row ? [...row.cells].slice(0, -1) : []) for (const node of cell.querySelectorAll("span, div")) if (!node.children.length && node.textContent.trim()) node.textContent = "Very long subject name or department path for the layout check";
    });
  } },
].map((scene) => ({
  ...scene,
  run: async (page, report) => {
    if (scene.route) await page.route(...scene.route);
    await page.goto(`${BASE}${scene.url}`);
    await page.locator(scene.ready).first().waitFor({ timeout: T });
    await page.waitForTimeout(400);
    if (scene.prepare) await scene.prepare(page);
    if (LONG && scene.long) await scene.long(page);
    await auditHover(page, scene.buttons, report);
  },
}));

// C 줄 끝 단추(번호 표시·들여쓰기·옮기기) - 글 뒤 같은 줄(넘치면 글 바로 아래)에 늘 흐리게 있고 줄에 올리면 또렷해진다. 줄의 가로 범위를 벗어나지 않아야 하고, 어떤 글자도 덮지 않아야 한다
const outputsScene = {
  name: "outputs-c-rows",
  user: "qa.member",
  run: async (page, report) => {
    await page.goto(`${BASE}/bundles/${BUNDLE}/outputs`);
    await page.locator('[data-testid="output-c"]').waitFor({ timeout: T });
    const rows = page.locator('[data-testid^="output-c-row-"]');
    await rows.first().waitFor({ timeout: T });
    if (LONG) {
      await page.locator('[data-testid^="output-c-item-"]').evaluateAll((els) => els.slice(0, 6).forEach((el) => { el.textContent = "SYNTHETIC long sentence with an unbroken word Pneumonoultramicroscopicsilicovolcanoconiosis that keeps going across the whole sheet width"; }));
    }
    let checked = 0;
    for (const row of (await rows.all()).slice(0, 8)) {
      const actions = row.locator(".row-actions-quiet");
      if ((await actions.count()) === 0) continue;
      await row.scrollIntoViewIfNeeded();
      // 가만히 있을 때(흐린 상태)와 올렸을 때(또렷한 상태) 둘 다 잰다
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      const rest = await findCovered(actions);
      if (rest.hits.length > 0) report(`${await row.getAttribute("data-testid")} buttons at rest (${rest.width}px)`, rest.hits.join(", "));
      await row.hover({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(HOVER_SETTLE_MS);
      const { hits, width } = await findCovered(actions);
      if (hits.length > 0) report(`${await row.getAttribute("data-testid")} buttons (${width}px)`, hits.join(", "));
      const isOutside = await row.evaluate((el) => {
        const box = el.querySelector(".row-actions-quiet").getBoundingClientRect();
        const line = el.getBoundingClientRect();
        return box.left < line.left - 1 || box.right > line.right + 1;
      });
      if (isOutside) report(`${await row.getAttribute("data-testid")} buttons`, "outside the row's horizontal extent");
      checked += 1;
    }
    if (checked === 0) report("no C row with buttons", "");
  },
};

// Assign 그 자리 메뉴 - 떠 있는 메뉴라 아래 글을 가리는 것은 맞다. 대신 화면 안에 있고 라벨이 잘리지 않아야 한다.
// 줄을 고르고 열어 둔 New 문서의 문장을 눌러 연다(고르기만 하고 저장하지 않으며 Esc로 닫는다)
const linkMenuScene = {
  name: "assign-link-menu",
  user: "qa.member",
  run: async (page, report) => {
    await page.goto(`${BASE}/bundles/${BUNDLE}/assign`);
    await page.locator('[data-testid="assign-bar"]').waitFor({ timeout: T });
    await page.locator('[data-testid="assign-filter-unassigned"]').click();
    await page.locator('[data-testid="assign-new"] .new-line').first().waitFor({ timeout: T });
    // 같은 언어 New 후보(점선)가 있는 줄까지 옮긴다 - 다른 언어 문장은 고를 수 없어 메뉴가 뜨지 않는다
    const candidate = page.locator('[data-testid="assign-new"] .new-line[data-state="candidate"] .new-hit');
    for (let step = 0; step < 40 && (await candidate.count()) === 0; step += 1) {
      await page.keyboard.press("j");
      await page.waitForTimeout(400);
    }
    await candidate.first().scrollIntoViewIfNeeded();
    await candidate.first().click();
    const menu = page.locator('[data-testid="assign-link-menu"]');
    await page.locator('[data-testid^="assign-link-menu-"][role="menuitem"]').first().waitFor({ state: "visible", timeout: T });
    await page.waitForTimeout(HOVER_SETTLE_MS);
    const spill = await findSpill(menu);
    if (spill.length > 0) report("assign-link-menu", spill.join(", "));
    await page.keyboard.press("Escape");
  },
};

// 상단 바 AI 작업 목록을 연 채 알림이 떠도 목록을 덮지 않고, 알림을 닫아도 목록은 열려 있어야 한다.
// /api/ai/jobs/recent 응답을 바꿔 "도는 요청 둘 → 하나는 실패·하나는 취소로 끝남"을 그린다(DB는 그대로)
const aiJobsScene = {
  name: "ai-jobs-toasts",
  user: "qa.member",
  run: async (page, report) => {
    let isFinished = false;
    const makeRequest = (id, kind, counts, finishedAt, now) => ({
      request_id: id, bundle_id: BUNDLE, bundle_code: `BND-${String(BUNDLE).padStart(4, "0")}`, bundle_title: "SYNTHETIC overlap audit bundle with a long title",
      kind, kinds: [kind], requested_by_me: true, total: 3,
      jobs: { queued: 0, running: 0, done: 0, failed: 0, stale: 0, cancelled: 0, ...counts },
      error_counts: counts.failed ? { timeout: counts.failed } : {}, created_at: now, started_at: now,
      running_started_at: counts.running ? now : null, finished_at: finishedAt, document_id: null, document_title: "", document_file_name: "",
    });
    await page.route("**/api/ai/jobs/recent", async (route) => {
      const now = new Date().toISOString();
      const requests = isFinished
        ? [makeRequest("audit-a", "classify", { done: 1, failed: 2 }, now, now), makeRequest("audit-b", "translate", { done: 1, cancelled: 2 }, now, now)]
        : [makeRequest("audit-a", "classify", { running: 3 }, null, now), makeRequest("audit-b", "translate", { queued: 3 }, null, now)];
      await route.fulfill({ json: { server_time: now, requests, requests_total: requests.length } });
    });
    await page.goto(`${BASE}/bundles/${BUNDLE}`);
    await page.locator('[data-testid="top-bar-ai"][data-state="active"]').waitFor({ timeout: T });
    await page.locator('[data-testid="top-bar-ai"]').click();
    const popover = page.locator('[data-testid="ai-jobs-popover"]');
    await popover.waitFor({ timeout: T });
    isFinished = true;
    const toastSel = '[data-testid="toast-error"], [data-testid="toast-info"]';
    await page.locator('[data-testid="toast-error"]').first().waitFor({ timeout: T });
    await page.locator('[data-testid="toast-info"]').first().waitFor({ timeout: T });
    await page.waitForTimeout(HOVER_SETTLE_MS);
    for (const toast of await page.locator(toastSel).all()) {
      const hit = await toast.evaluate((el) => {
        const a = el.getBoundingClientRect();
        const b = document.querySelector('[data-testid="ai-jobs-popover"]').getBoundingClientRect();
        return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      });
      if (hit) report(await toast.getAttribute("data-testid"), "covers the open AI job list");
      const spill = await findSpill(toast);
      if (spill.length > 0) report(await toast.getAttribute("data-testid"), spill.join(", "));
    }
    await page.locator('[data-testid^="toast-close-"]').first().click();
    await page.waitForTimeout(300);
    if (!(await popover.isVisible())) report("ai-jobs-popover", "closing a toast closed the job list");
    await page.keyboard.press("Escape");
    await page.unroute("**/api/ai/jobs/recent");
  },
};

const scenes = [...mbtnScenes, outputsScene, linkMenuScene, aiJobsScene].filter((scene) => !only || only.includes(scene.name));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let problems = 0;
let runs = 0;
for (const scene of scenes) {
  for (const width of widths) {
    for (const lang of langs) {
      for (const theme of themes) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        await ctx.addInitScript(({ user, lang, theme }) => {
          if (location.protocol === "about:") return;
          localStorage.setItem("sopa.devUser", user);
          localStorage.setItem("sopa.lang", lang);
          localStorage.setItem("sopa.theme", theme);
        }, { user: scene.user, lang, theme });
        const page = await ctx.newPage();
        const tag = `${scene.name} ${width} ${lang} ${theme}${LONG ? " long" : ""}`;
        const found = [];
        const report = (what, detail) => found.push(`${what}: ${detail}`);
        runs += 1;
        try {
          await scene.run(page, report);
        } catch (err) {
          found.push(`error: ${String(err).split("\n")[0]}`);
        }
        if (found.length > 0) {
          problems += found.length;
          for (const line of found) console.log(`FAIL  ${tag} ${line}`);
          await page.screenshot({ path: resolve(SHOTS, `overlap-${scene.name}-${width}-${lang}-${theme}${LONG ? "-long" : ""}.png`) }).catch(() => {});
        } else {
          console.log(`ok    ${tag}`);
        }
        await ctx.close();
      }
    }
  }
}
await browser.close();
console.log(problems === 0 ? `\nALL PASS (${runs} runs)` : `\n${problems} problem(s) in ${runs} runs`);
process.exit(problems === 0 ? 0 : 1);
