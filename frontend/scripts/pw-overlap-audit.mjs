// 겹침 감사(Playwright + 시스템 Chrome) - 호버로 펼치거나 떠서 보이는 UI가 옆 글자·입력을 덮는지 잰다.
// 모핑 단추(.mbtn — 라벨 폭은 px로 손으로 맞춘 값이라 번역이 길어지면 조용히 겹친다)·C 줄 끝 단추·Assign 그 자리 메뉴·상단 바 AI 작업 목록과 알림(요청 줄의 Background 표시 포함)·Assign 표·그림 머리 줄의 TABLE/FIGURE 표시·Assign의 떼는 오른쪽 칸(1440px 미만 폭에서).
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
  { name: "tobe-steps", user: "qa.member", url: `/bundles/${BUNDLE}/documents`, ready: '[data-testid="tobe-list"]', prepare: async (page) => {
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
  // C12: 카드에서는 구성원 단추가 메타 줄 오른쪽 끝에 앉고, 펼친 라벨이 그 줄 글을 덮지 않아야 한다
  { name: "admin-bundle-cards", user: "dev.admin", url: "/admin?tab=bundles", ready: '[data-testid="admin-bundles-view-cards"]', prepare: async (page) => {
    await page.locator('[data-testid="admin-bundles-view-cards"]').click();
    await page.locator('[data-testid="admin-bundles-list"] article [data-testid^="admin-bundle-members-"]').first().waitFor({ timeout: T });
    await page.waitForTimeout(400);
  }, buttons: '[data-testid="admin-bundles-list"] article [data-testid^="admin-bundle-members-"]', long: async (page) => {
    await page.locator('[data-testid="admin-bundles-list"] .dcard-meta').evaluateAll((els) => els.slice(0, 6).forEach((el) => { el.insertAdjacentHTML("beforeend", "<div><dt>x</dt><dd>Extremely long meta value that keeps going across the card width</dd></div>"); }));
  } },
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

// C 줄 끝 단추(번호 표시·들여쓰기·옮기기) - 쉴 때는 보이지 않고(불투명도 0), 줄에 올리면 용지 오른쪽 바깥, 줄 위 끝에 뜬다(넓으면 묶음, 좁으면 ⋯ 하나).
// 올린 단추는 어떤 글자도 덮지 않고 용지 밖·스크롤 칸 안에 있어야 한다
async function findActsPlacement(row) {
  return row.evaluate((el) => {
    const box = [...el.querySelectorAll(":scope > .c-acts, :scope > .c-more")].find((node) => getComputedStyle(node).display !== "none").getBoundingClientRect();
    const sheet = el.closest("article.sheet").getBoundingClientRect();
    const pane = el.closest(".overflow-auto, .overflow-y-auto");
    const paneRight = pane.getBoundingClientRect().left + pane.clientWidth;
    return { pastPane: box.right > paneRight + 1, inSheet: box.left < sheet.right };
  });
}
// 보이는 쪽(넓으면 묶음, 좁으면 ⋯) - 다른 쪽은 display: none이다
const findShownActs = (row) => row.locator(":scope > .c-acts:visible, :scope > .c-more:visible");
const readOpacity = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity));
const outputsScene = {
  name: "outputs-c-rows",
  drafting: true,
  user: "qa.member",
  run: async (page, report) => {
    // 줄 끝 단추는 3단계(Order) 화면에만 있다 - 결과 화면의 C는 읽기 전용
    await page.goto(`${BASE}/bundles/${BUNDLE}/order`);
    await page.locator('[data-testid="output-c"]').waitFor({ timeout: T });
    const rows = page.locator('[data-testid^="output-c-row-"]');
    await rows.first().waitFor({ timeout: T });
    if (LONG) {
      await page.locator('[data-testid^="output-c-item-"]').evaluateAll((els) => els.slice(0, 6).forEach((el) => { el.textContent = "SYNTHETIC long sentence with an unbroken word Pneumonoultramicroscopicsilicovolcanoconiosis that keeps going across the whole sheet width"; }));
    }
    let checked = 0;
    for (const row of (await rows.all()).slice(0, 8)) {
      if ((await row.locator('[data-testid^="output-c-acts-"]').count()) === 0) continue;
      const actions = findShownActs(row);
      await row.scrollIntoViewIfNeeded();
      // 가만히 있을 때(보이지 않음)와 올렸을 때(뜬 상태) 둘 다 잰다
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      const restOpacity = await readOpacity(actions);
      if (restOpacity > 0) report(`${await row.getAttribute("data-testid")} buttons at rest`, `opacity ${restOpacity}`);
      await row.hover({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(HOVER_SETTLE_MS);
      const { hits, width } = await findCovered(actions);
      if (hits.length > 0) report(`${await row.getAttribute("data-testid")} buttons (${width}px)`, hits.join(", "));
      const placement = await findActsPlacement(row);
      if (placement.pastPane) report(`${await row.getAttribute("data-testid")} buttons`, "past the right edge of the scroll pane");
      if (placement.inSheet) report(`${await row.getAttribute("data-testid")} buttons`, "inside the sheet");
      checked += 1;
    }
    if (checked === 0) report("no C row with buttons", "");
  },
};

// 문서 끝 줄들 - 문서마다 끝까지 그린 뒤 마지막 세 줄에 올려, 단추가 글을 덮지 않고 스크롤 높이를 늘리지 않는지 본다(DB는 그대로)
const outputsEndRowsScene = {
  name: "outputs-c-end-rows",
  drafting: true,
  user: "qa.member",
  run: async (page, report) => {
    await page.goto(`${BASE}/bundles/${BUNDLE}/order`);
    await page.locator('[data-testid^="order-doc-"]').first().waitFor({ timeout: T });
    const docs = await page.locator('[data-testid^="order-doc-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    const scrollHeight = () => page.locator('[data-testid="output-c"]').evaluate((el) => el.closest(".overflow-auto, .overflow-y-auto").scrollHeight);
    let checked = 0;
    for (const doc of docs.slice(0, 6)) {
      await page.locator(`[data-testid="${doc}"]`).click();
      await page.locator('[data-testid="output-c"]').waitFor({ timeout: T });
      for (let step = 0; step < 20 && (await page.locator('[data-testid="output-c-more"]').count()) > 0; step += 1) {
        await page.locator('[data-testid="output-c-more"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
      }
      const rows = await page.locator('[data-testid^="output-c-row-"]:has([data-testid^="output-c-acts-"])').all();
      for (const row of rows.slice(-3)) {
        const name = `${doc} ${await row.getAttribute("data-testid")}`;
        await row.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        const rest = await scrollHeight();
        await row.hover({ position: { x: 8, y: 4 } });
        await page.waitForTimeout(HOVER_SETTLE_MS);
        const hovered = await scrollHeight();
        if (hovered !== rest) report(`${name} buttons`, `scroll height ${rest} -> ${hovered}`);
        const { hits, width } = await findCovered(findShownActs(row));
        if (hits.length > 0) report(`${name} buttons (${width}px)`, hits.join(", "));
        if ((await findActsPlacement(row)).pastPane) report(`${name} buttons`, "past the right edge of the scroll pane");
        checked += 1;
      }
    }
    if (checked === 0) report("no C end row with buttons", "");
  },
};

// 반환 { hits, linked } - linked가 0이면 잴 줄이 없었다는 뜻이라 통과로 치지 않는다
// 메뉴 상자가 잇고 있는 두 줄(누른 New 줄과 짝 Old 줄)의 글 상자를 덮는가 - 떠 있는 메뉴가 아래 다른 글을 가리는 것은 괜찮지만 이 두 줄은 안 된다
async function findCoveringLinkedLines(page, menu) {
  const box = await menu.boundingBox();
  return page.evaluate((m) => {
    const hit = (r) => r.width > 0 && r.height > 0 && Math.min(r.right, m.x + m.width) - Math.max(r.left, m.x) > 1 && Math.min(r.bottom, m.y + m.height) - Math.max(r.top, m.y) > 1;
    const hits = [];
    const menuEl = document.querySelector('[data-testid="assign-link-menu"]');
    // 누른 New 문단 상자 안에 단추 줄로 든 메뉴(inline, 사용자 결정 2026-11-19)는 그 상자를 늘려 글 아래에 앉는다 - 그 줄은 상자 대신 메뉴 밖 글자 자리와 견준다
    const readTextRects = (line) => {
      const rects = [];
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (menuEl?.contains(node) || node.textContent.trim() === "") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...range.getClientRects());
      }
      return rects;
    };
    // New 줄은 줄 상자 전체(마지막 글줄이 짧아도 그 줄의 자리), Old 줄은 글줄마다
    for (const line of document.querySelectorAll('[data-testid="assign-new"] .new-line[data-state="focus"], [data-testid="assign-new"] .new-line[data-state="picked"]')) {
      const isHost = menuEl !== null && line.contains(menuEl);
      if (isHost ? readTextRects(line).some(hit) : hit(line.getBoundingClientRect())) hits.push(`New line "${line.textContent.trim().slice(0, 30)}"`);
    }
    for (const line of document.querySelectorAll('[data-testid="assign-old"] .su[data-sel]')) {
      if ([...line.getClientRects()].some(hit)) hits.push(`Old line "${line.textContent.trim().slice(0, 30)}"`);
    }
    const linked = document.querySelectorAll('[data-testid="assign-new"] .new-line[data-state="focus"], [data-testid="assign-new"] .new-line[data-state="picked"], [data-testid="assign-old"] .su[data-sel]').length;
    return { hits, linked };
  }, box);
}

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
    const covering = await findCoveringLinkedLines(page, menu);
    if (covering.linked === 0) report("assign-link-menu covers linked lines", "no linked lines were measured");
    if (covering.hits.length > 0) report("assign-link-menu covers linked lines", covering.hits.join(", "));
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
    // 미리 돌리기 요청(Background 표시)은 문서 이름 옆에 붙는다 - LONG이면 긴 문서 이름과 다른 멤버의 끝난 한 줄 요청(가장 좁은 줄)도 그린다
    const documentTitle = LONG ? "SYNTHETIC very long Old document title that keeps going past the row width" : "";
    const makeRequest = (id, kind, counts, finishedAt, now, extra = {}) => ({
      request_id: id, bundle_id: BUNDLE, bundle_code: `BND-${String(BUNDLE).padStart(4, "0")}`, bundle_title: "SYNTHETIC overlap audit bundle with a long title",
      kind, kinds: [kind], requested_by_me: true, background: false, total: 3,
      jobs: { queued: 0, running: 0, done: 0, failed: 0, stale: 0, cancelled: 0, ...counts },
      error_counts: counts.failed ? { timeout: counts.failed } : {}, created_at: now, started_at: now,
      running_started_at: counts.running ? now : null, finished_at: finishedAt, document_id: null, document_title: "", document_file_name: "",
      ...extra,
    });
    const background = { background: true, document_id: documentTitle ? 1 : null, document_title: documentTitle };
    await page.route("**/api/ai/jobs/recent", async (route) => {
      const now = new Date().toISOString();
      const requests = isFinished
        ? [makeRequest("audit-a", "classify", { done: 1, failed: 2 }, now, now, background), makeRequest("audit-b", "translate", { done: 1, cancelled: 2 }, now, now)]
        : [makeRequest("audit-a", "classify", { running: 3 }, null, now, background), makeRequest("audit-b", "translate", { queued: 3 }, null, now)];
      if (LONG) requests.push(makeRequest("audit-c", "classify", { done: 3 }, now, now, { ...background, requested_by_me: false }));
      await route.fulfill({ json: { server_time: now, requests, requests_total: requests.length } });
    });
    // Background 표시가 옆 글(종류·문서 이름·진행 수 등)을 덮거나 제 글이 잘리지 않는다
    const auditBackgroundMarks = async (when) => {
      const marks = await page.locator('[data-testid="ai-jobs-popover"] [data-testid$="-background"]').all();
      if (marks.length === 0) report(`ai-jobs background mark (${when})`, "no mark was measured");
      for (const mark of marks) {
        const name = `${await mark.getAttribute("data-testid")} (${when})`;
        const { hits } = await findCovered(mark);
        if (hits.length > 0) report(name, hits.join(", "));
        const spill = await findSpill(mark);
        if (spill.length > 0) report(name, spill.join(", "));
      }
    };
    await page.goto(`${BASE}/bundles/${BUNDLE}`);
    await page.locator('[data-testid="top-bar-ai"][data-state="active"]').waitFor({ timeout: T });
    await page.locator('[data-testid="top-bar-ai"]').click();
    const popover = page.locator('[data-testid="ai-jobs-popover"]');
    await popover.waitFor({ timeout: T });
    await page.waitForTimeout(HOVER_SETTLE_MS);
    await auditBackgroundMarks("running");
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
    await auditBackgroundMarks("finished");
    await page.locator('[data-testid^="toast-close-"]').first().click();
    await page.waitForTimeout(300);
    if (!(await popover.isVisible())) report("ai-jobs-popover", "closing a toast closed the job list");
    await page.keyboard.press("Escape");
    await page.unroute("**/api/ai/jobs/recent");
  },
};

// C 순서 바꾸기 - 화면에 먼저 옮긴 줄의 끝 단추도 글을 덮지 않아야 한다. 저장(PUT)은 붙잡아 두었다가 실패로 돌려 DB를 바꾸지 않는다
const outputsReorderScene = {
  name: "outputs-c-reorder",
  drafting: true,
  user: "qa.member",
  run: async (page, report) => {
    let release = null;
    await page.route("**/targets/order**", async (route) => {
      await new Promise((done) => { release = done; });
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    // 줄 끝 단추는 3단계(Order) 화면에만 있다 - 결과 화면의 C는 읽기 전용
    await page.goto(`${BASE}/bundles/${BUNDLE}/order`);
    await page.locator('[data-testid="output-c"]').waitFor({ timeout: T });
    const down = page.locator('[data-testid^="output-c-move-down-"]:not([disabled])').first();
    // 좁은 틀(⋯)에서는 묶음이 display: none이라 붙어 있기만 기다린다 - 누르기는 dispatchEvent라 보이지 않아도 된다
    await down.waitFor({ state: "attached", timeout: T });
    const id = (await down.getAttribute("data-testid")).replace("output-c-move-down-", "");
    await down.dispatchEvent("click");
    await page.waitForTimeout(HOVER_SETTLE_MS);
    const row = page.locator(`[data-testid="output-c-row-${id}"]`);
    const actions = findShownActs(row);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    const restOpacity = await readOpacity(actions);
    if (restOpacity > 0) report(`moved row ${id} buttons at rest`, `opacity ${restOpacity}`);
    await row.hover({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(HOVER_SETTLE_MS);
    const hovered = await findCovered(actions);
    if (hovered.hits.length > 0) report(`moved row ${id} buttons (${hovered.width}px)`, hovered.hits.join(", "));
    if ((await findActsPlacement(row)).pastPane) report(`moved row ${id} buttons`, "past the right edge of the scroll pane");
    release?.();
    await page.locator('[data-testid="toast-error"]').first().waitFor({ timeout: T });
    await page.unroute("**/targets/order**");
  },
};

// Excel 미리보기 창 - 시트 탭 넷의 이름이 서로 덮지 않고 잘리지 않으며, 창이 화면 안에 있다
const exportPreviewScene = {
  name: "export-preview",
  user: "qa.member",
  run: async (page, report) => {
    await page.goto(`${BASE}/bundles/${BUNDLE}/outputs`);
    await page.locator('[data-testid="outputs-export-open"]').click();
    await page.locator('[data-testid="export-preview-sheet"] tbody tr').first().waitFor({ timeout: T });
    const tabs = await page.locator('[data-testid^="export-preview-tab-"]').all();
    // 시트 네 장 - A·B·Info·Documents(C는 숨겨 두었다)
    if (tabs.length !== 4) report("export-preview tabs", `${tabs.length} tabs`);
    for (const tab of tabs) {
      const { hits, width } = await findCovered(tab);
      if (hits.length > 0) report(`${await tab.getAttribute("data-testid")} (${width}px)`, hits.join(", "));
    }
    const spill = await findSpill(page.locator('[data-testid="export-preview-tab-0"]').locator(".."));
    if (spill.length > 0) report("export-preview tab group", spill.join(", "));
    const outside = await page.locator('[data-testid="export-preview"]').evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight;
    });
    if (outside) report("export-preview", "outside the viewport");
  },
};

// Documents 두 목록의 줄 끝 단추(Documents 화면 설계 §4) - 쉴 때는 보이지 않고 줄에 올리면 줄 안 오른쪽 끝에 뜬다(넓으면 묶음, 좁으면 ⋯).
// 올린 줄의 단추 자리는 그 줄의 제목 · 딸린 정보 글을 덮지 않고, 오른쪽 끝이 줄마다 같다(±1px). LONG=1이면 제목 글을 길게 바꿔 본다.
// 목록마다 제목 글의 testid가 다르다 - New 줄은 `-title-text`, Old 줄은 제목 링크 `-title`
const makeRowActsScene = (name, listTestId, titleSuffix) => ({
  name,
  user: "qa.member",
  run: async (page, report) => {
    await page.goto(`${BASE}/bundles/${BUNDLE}/documents`);
    const rows = page.locator(`[data-testid="${listTestId}"] .doc-row[data-testid]`);
    await rows.first().waitFor({ timeout: T });
    await page.waitForTimeout(400);
    if (LONG) {
      await page.locator(`[data-testid="${listTestId}"] .doc-row [data-testid$="${titleSuffix}"]`).evaluateAll((els) => els.slice(0, 6).forEach((el) => { el.textContent = "SYNTHETIC very long document title that keeps going and going across the whole column width and wraps onto a second line"; }));
    }
    const rights = new Set();
    for (const row of (await rows.all()).slice(0, 6)) {
      await row.scrollIntoViewIfNeeded();
      // 제목 위에 올린다 - 앞 줄의 툴팁이 사라지는 중이면 그 자리를 가려 기다리게 되므로 행위 검사는 건너뛴다(:hover는 마우스 자리로 정해진다)
      await row.locator(".doc-title").hover({ force: true });
      await page.waitForTimeout(250);
      const placed = await row.evaluate((el) => {
        const acts = [...el.querySelectorAll(".doc-acts, .doc-more")].find((node) => getComputedStyle(node).display !== "none");
        if (!acts) return null;
        const box = acts.getBoundingClientRect();
        const covered = [];
        for (const selector of [".doc-title", ".doc-meta"]) {
          const range = document.createRange();
          range.selectNodeContents(el.querySelector(selector));
          for (const rect of range.getClientRects()) {
            if (Math.min(rect.right, box.right) - Math.max(rect.left, box.left) > 0 && Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) > 0) covered.push(selector);
          }
        }
        return { right: Math.round(box.right), opacity: Number(getComputedStyle(acts).opacity), covered: [...new Set(covered)] };
      });
      const id = await row.getAttribute("data-testid");
      if (placed === null) {
        report(id, "no row-end buttons");
        continue;
      }
      if (placed.opacity < 1) report(id, `row-end buttons not shown on hover (opacity ${placed.opacity})`);
      if (placed.covered.length > 0) report(id, `row-end buttons cover ${placed.covered.join(", ")}`);
      rights.add(placed.right);
      await page.mouse.move(0, 0);
    }
    if (Math.max(...rights) - Math.min(...rights) > 1) report(name, `right edges differ: ${[...rights].join(", ")}`);
  },
});
const tobeRowActsScene = makeRowActsScene("tobe-row-acts", "tobe-list", "-title-text");
const oldRowActsScene = makeRowActsScene("documents-row-acts", "documents-list", "-title");

// 엮은 문서 미리 보기(아직 안 쓴 SOP)의 칸 제목 출처 - 칸 이름 뒤에서 말줄임하고 칸 이름을 덮지 않는다. 출처 글은 응답에 넣어 길게 그린다(DB는 그대로)
const composedHeadingScene = {
  name: "assign-new-heading-note",
  drafting: true,
  user: "qa.member",
  run: async (page, report) => {
    const note = `← ${Array.from({ length: 14 }, (_, i) => `OLD-${i + 1} §${i + 5}`).join(", ")}`;
    await page.route("**/outputs/c/docs/**", async (route) => {
      const response = await route.fetch();
      const doc = await response.json();
      for (const section of doc.sections ?? []) section.heading_note = note;
      await route.fulfill({ response, json: doc });
    });
    const tobe = await (await page.request.get(`${BASE}/api/bundles/${BUNDLE}/tobe`, { headers: { "X-Dev-User": "qa.member" } })).json();
    const sop = tobe.docs.find((doc) => doc.doc_type === "sop" && doc.entrance === "assign");
    await page.goto(`${BASE}/bundles/${BUNDLE}/assign`);
    await page.locator('[data-testid="assign-bar"]').waitFor({ timeout: T });
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${sop.id}"]`).click();
    const notes = page.locator('[data-testid^="assign-new-heading-note-"]');
    await notes.first().waitFor({ timeout: T });
    for (const item of (await notes.all()).slice(0, 6)) {
      await item.scrollIntoViewIfNeeded();
      // 칸 첫 문장에 올려 언어 탭(위 테두리 위로 나온다)을 띄운 채 잰다 - 빈 칸이면 문장이 없다
      // 엮은 문서의 칸 머리는 제목 박스 줄(.new-head-row, 시안 2 D6)
      const firstLine = item.locator("xpath=ancestor::div[contains(@class,'new-head-row')]/following-sibling::div[contains(@class,'new-item')][1]//div[contains(@class,'new-line')]");
      if ((await firstLine.count()) > 0) {
        await firstLine.first().hover();
        await page.waitForTimeout(250);
      }
      const { hits, width } = await findCovered(item);
      if (hits.length > 0) report(`${await item.getAttribute("data-testid")} (${width}px)`, hits.join(", "));
    }
    // 칸 머리(문서 고르기·표지·선·확대)는 칸 안에 - 고르기 값의 말줄임은 의도한 것이라 잘림으로 치지 않는다
    const beyond = await page.locator('[data-testid="assign-new"]').evaluate((pane) => {
      const right = pane.getBoundingClientRect().right;
      return [...pane.querySelector(".pane-head").children].filter((el) => el.getBoundingClientRect().right > right + 1).map((el) => el.getAttribute("data-testid") ?? el.className.toString().slice(0, 20));
    });
    if (beyond.length > 0) report("assign-new pane head", `beyond the pane: ${beyond.join(", ")}`);
    await page.unroute("**/outputs/c/docs/**");
  },
};

// 표·그림 머리 줄 - 위 테두리의 TABLE/FIGURE 표시가 표시 ID·미리보기 글을 덮지 않는다(넓은 한 단·좁은 양 단), 머리 줄을 누르면 그 조각에 data-sel.
// 머리 줄이 있는 Old 문서를 ?edit=로 연다(고르기만 하고 저장하지 않는다)
const bundleHeadScene = {
  name: "assign-bundle-head",
  user: "qa.member",
  run: async (page, report) => {
    const documents = await (await page.request.get(`${BASE}/api/bundles/${BUNDLE}/documents`, { headers: { "X-Dev-User": "qa.member" } })).json();
    let opened = false;
    for (const doc of documents) {
      await page.goto(`${BASE}/bundles/${BUNDLE}/assign?edit=${doc.id}`);
      await page.locator('[data-testid="assign-bar"]').waitFor({ timeout: T });
      await page.waitForTimeout(800);
      if ((await page.locator(".bundle-head").count()) > 0) {
        opened = true;
        break;
      }
    }
    if (!opened) {
      report("assign-bundle-head", "no document with a table or figure head row");
      return;
    }
    const measureTags = async (view) => {
      const tags = await page.locator('.bundle-head .strip-lang[data-lang="bundle"]').all();
      for (const tag of tags.slice(0, 6)) {
        await tag.scrollIntoViewIfNeeded();
        const { hits, width } = await findCovered(tag);
        if (hits.length > 0) report(`${view} ${await tag.textContent()} tag (${width}px)`, hits.join(", "));
      }
      return tags.length;
    };
    const wide = await measureTags("one pane");
    await page.getByTestId("assign-view-two").click();
    await page.waitForTimeout(800);
    const narrow = await measureTags("two panes");
    if (wide === 0 || narrow === 0) report("assign-bundle-head", `tags measured: one pane ${wide}, two panes ${narrow}`);
    const head = page.locator(".bundle-head").first();
    await head.scrollIntoViewIfNeeded();
    await head.click();
    await page.waitForTimeout(400);
    const picked = await head.evaluate((el) => el.closest(".strip")?.hasAttribute("data-sel") ?? false);
    if (!picked) report("assign-bundle-head", "clicking the head row did not set data-sel on its strip");
  },
};

// 떼는 오른쪽 칸(좁은 창) - 떠 있는 판이라 아래 글을 가리는 것은 맞다. 대신 붙어 있을 때 떼기 단추가 머리 글을 덮지 않고, 뜬 판은 펼치든 접든 화면 안에 있고,
// 머리의 제목과 단추가 겹치지 않고, 내용이 320px에서 옆으로 넘치지 않고, 끝까지 굴린 문서의 마지막 줄이 판 위로 올라와야 한다. 1440px 이상이면 단추가 없어야 한다
const sideFloatScene = {
  name: "assign-side-float",
  user: "qa.member",
  run: async (page, report) => {
    await page.goto(`${BASE}/bundles/${BUNDLE}/assign`);
    await page.locator('[data-testid="assign-bar"]').waitFor({ timeout: T });
    await page.locator('[data-testid="assign-new"] .new-line').first().waitFor({ timeout: T });
    await page.keyboard.press("j");
    await page.locator('[data-testid="assign-row-id"]').waitFor({ timeout: T });
    const detach = page.locator('[data-testid="assign-side-detach"]');
    if (page.viewportSize().width >= 1440) {
      if ((await detach.count()) > 0) report("assign-side-detach", "shown at 1440px or wider");
      return;
    }
    if (LONG) await page.locator('[data-testid="assign-row-id"]').evaluate((el) => { el.textContent = "SYNTHETIC-LONG-DOCUMENT-CODE-0001-1-001 · SYNTHETIC-LONG-DOCUMENT-CODE-0001-1-002"; });
    const { hits, width } = await findCovered(detach);
    if (hits.length > 0) report(`assign-side-detach (${width}px)`, hits.join(", "));
    await detach.click();
    await page.locator('[data-testid="assign-side-head"]').waitFor({ timeout: T });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(HOVER_SETTLE_MS);
    const readFloat = () => page.evaluate(() => {
      const side = document.querySelector('[data-testid="assign-inspector"]');
      const box = side.getBoundingClientRect();
      const problems = [];
      if (box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight) problems.push("outside the viewport");
      const parts = [...side.querySelectorAll(".side-float-head > *")].map((el) => el.getBoundingClientRect());
      for (let i = 1; i < parts.length; i += 1) if (parts[i].left < parts[i - 1].right - 1) problems.push("head parts overlap");
      for (const el of [side, ...side.querySelectorAll(".side-float-head, .side-float-title, .assign-side-body, .assign-side-head, .assign-pick, .assign-decide, .assign-decide-body, .help-panel")]) {
        if (el.scrollWidth > el.clientWidth + 1) problems.push(`${el.className} is ${el.scrollWidth - el.clientWidth}px too wide`);
      }
      return { problems, top: box.top };
    });
    const open = await readFloat();
    if (open.problems.length > 0) report("assign-inspector floating", open.problems.join(", "));
    // 점진 그리기라 높이가 멎을 때까지 끝으로 굴린다
    const body = page.locator('[data-testid="assign-new"] .pane-body');
    for (let step = 0, last = -1; step < 30; step += 1) {
      const height = await body.evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollHeight; });
      await page.waitForTimeout(250);
      if (height === last) break;
      last = height;
    }
    const bottom = await page.locator('[data-testid="assign-new"] .new-line').last().evaluate((el) => el.getBoundingClientRect().bottom);
    if (bottom > open.top + 1) report("last New line", `stays ${Math.round(bottom - open.top)}px under the panel at the end of the document`);
    await page.locator('[data-testid="assign-side-fold"]').click();
    const folded = await readFloat();
    if (folded.problems.length > 0) report("assign-inspector folded", folded.problems.join(", "));
  },
};

const scenes = [...mbtnScenes, tobeRowActsScene, oldRowActsScene, outputsScene, outputsEndRowsScene, outputsReorderScene, exportPreviewScene, composedHeadingScene, linkMenuScene, sideFloatScene, aiJobsScene, bundleHeadScene].filter((scene) => !only || only.includes(scene.name));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let problems = 0;
let runs = 0;
for (const scene of scenes) {
  for (const width of widths) {
    for (const lang of langs) {
      for (const theme of themes) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        await ctx.addInitScript(({ user, lang, theme, drafting }) => {
          if (location.protocol === "about:") return;
          localStorage.setItem("sopa.devUser", user);
          localStorage.setItem("sopa.lang", lang);
          localStorage.setItem("sopa.theme", theme);
          // 숨긴 기능(새 문서를 만드는 쪽)의 장면만 켠다 - 나머지는 실사용 화면 그대로
          if (drafting) localStorage.setItem("sopa.drafting", "1");
        }, { user: scene.user, lang, theme, drafting: scene.drafting === true });
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
