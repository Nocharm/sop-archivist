// SOP 화면 스모크(Playwright + 시스템 Chrome) - 묶음 목록, 개요, 단계 이동(레일·상단 탭), 배치 메뉴, 첫 페인트 전 설정.
// 전제: backend/에서 reset_db → seed_sop_demo(합성 묶음 4개) 직후, backend 8777 + frontend 3777. 고친 값은 시나리오 안에서 되돌린다.
// AI 나눔 확정 시나리오는 backend가 AI를 켜고 가짜 AI(FAKE_AI_SPLIT=1 node scripts/fake-ai-server.mjs)를 볼 때만 돈다 - 꺼져 있으면 건너뛴다.
// PREPARE=1이면 "배정 화면 첫 진입 미리 분류" 시나리오 하나만 돈다(나머지는 건너뛴다). 전제: reset_db → seed_sop_demo 직후(시드는 AI_AUTO_PREPARE=false),
// 가짜 AI(node scripts/fake-ai-server.mjs)를 보는 backend를 AI_ENABLED=true AI_AUTO_PREPARE=true로 띄운다. 이 backend에서는 작성자가 배정 화면에 들어갈 때마다
// 남은 줄이 저절로 분류돼 다른 단계의 전제가 깨지므로 같이 돌리지 않는다. 끝에 DB가 바뀐다(분류 절반 묶음의 남은 줄에 AI 제안이 붙는다) - 다시 돌리려면 reset_db부터.
// 실행(frontend/ 에서): node scripts/pw-smoke-sop.mjs   환경 변수: BASE_URL, CHROME_PATH, BACKEND_PYTHON(backend/.venv가 없는 워크트리)
// ONLY="이름 조각,…"이면 이름에 그 조각이 든 단계만 돈다. 묶음 id를 잡는 첫 단계("bundle list")는 늘 함께 돈다. 화면 하나만 보려면 이름 머리로 고른다: ONLY="assign:" · "documents:" · "new documents:" · "outputs"
// QUIET=1이면 통과한 줄을 찍지 않는다 - 실패한 줄과 마지막 한 줄(통과 수·실패 수)만 나온다.
// 평소(변경마다)는 고친 화면만: QUIET=1 ONLY="<화면>" node scripts/pw-smoke-sop.mjs  — 전부 돌리는 것은 dev→main 정식 업데이트 전, 또는 여러 화면이 같이 쓰는 것(공용 부품·API 층·이 스크립트의 틀)을 고쳤을 때만이다(사용자 결정 2026-11-16).
// playwright-core는 저장소 의존성이 아니다: `npm i --no-save playwright-core` (package.json 불변)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3777";
const SHOT_DIR = resolve(SCRIPT_DIR, "../../.shots");
const T = 15000;
const ONLY = (process.env.ONLY ?? "").split(",").map((part) => part.trim()).filter(Boolean);
const PREPARE = process.env.PREPARE === "1";
const PREPARE_STEP = "assign: first entry classifies the remaining rows in the background";
// 시안의 모든 수치는 1248 × 720 프레임 기준이다(디자인 문서 15절)
const VIEWPORT = { width: 1248, height: 720 };

mkdirSync(SHOT_DIR, { recursive: true });

const QUIET = process.env.QUIET === "1";
// 묶음 id를 잡아 두는 단계 - 뒤 단계가 모두 여기에 기댄다
const SETUP_STEP = "bundle list";
let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  if (ok) passes += 1;
  else failures += 1;
  if (ok && QUIET) return;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${String(detail).replace(/\s+/g, " ").trim()}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function runStep(name, { devUser = "qa.member", storage = {}, allowConsoleErrors = false } = {}, run) {
  if (ONLY.length > 0 && name !== SETUP_STEP && !ONLY.some((part) => name.includes(part))) return;
  // 미리 분류 시나리오는 PREPARE=1일 때만, 그때는 그것만(머리말)
  if (PREPARE !== (name === PREPARE_STEP)) return;
  if (!QUIET) console.log(`\n# ${name}`);
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await ctx.addInitScript(
    ({ loginId, extra }) => {
      if (location.protocol === "about:") return;
      if (!window.localStorage.getItem("sopa.devUser")) window.localStorage.setItem("sopa.devUser", loginId);
      for (const [key, value] of Object.entries(extra)) {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      }
    },
    { loginId: devUser, extra: storage },
  );
  const page = await ctx.newPage();
  const consoleErrors = [];
  // 개발 서버 전용 잡음 - 옛 주소를 넘기는 서버 컴포넌트(redirect)의 실행 시간을 React 개발 도구가 재다가 가끔 음수 시각으로 실패한다.
  // 빌드한 앱에는 없는 측정이라 화면 오류로 세지 않는다
  const isDevTimingNoise = (text) => text.includes("Failed to execute 'measure' on 'Performance'");
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isDevTimingNoise(msg.text())) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    if (!isDevTimingNoise(String(err))) consoleErrors.push(String(err));
  });
  try {
    await run({ page, takeShot: (file) => page.screenshot({ path: resolve(SHOT_DIR, file) }) });
    if (!allowConsoleErrors) check(`${name}: no console errors`, consoleErrors.length === 0, consoleErrors.join(" | "));
  } catch (err) {
    check(`${name}: completed`, false, err instanceof Error ? err.message : String(err));
  } finally {
    await ctx.close();
  }
}

const wait = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().waitFor({ timeout: T });
const getText = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().innerText();
const getBox = (page, testId) => page.locator(`[data-testid="${testId}"]`).first().boundingBox();
// 결과물 C의 순서·깊이·표시 저장 - 화면은 먼저 바뀌고 저장은 뒤에서 하므로 응답을 기다린 뒤에 저장된 값을 본다
const isOrderSave = (request) => request.method() === "PUT" && /\/targets\/order/.test(request.url());
const waitOrderSave = (page) => page.waitForResponse((response) => isOrderSave(response.request()), { timeout: T });
// 순서·문단번호 화면은 New 문서를 하나씩 연다 - 문서를 차례로 열어 probe가 값을 돌려주는 문서를 모은다([문서 id, 값]). limit만큼 찾으면 멈춘다
async function findOrderDocs(page, probe, limit = 1) {
  await page.locator('[data-testid^="order-doc-"]').first().waitFor({ timeout: T });
  const docIds = await page.locator('[data-testid^="order-doc-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid").replace("order-doc-", "")));
  const found = [];
  for (const docId of docIds) {
    await page.locator(`[data-testid="order-doc-${docId}"]`).click();
    const value = await page.evaluate(probe);
    if (value !== null) found.push([docId, value]);
    if (found.length >= limit) break;
  }
  return found;
}

// --- Order 끌기 장면이 같이 쓰는 도우미 ---

// React 커밋 수 - 끄는 동안 다시 그리지 않는지 본다(G11). renderers·onScheduleFiberRoot는 개발 서버의 React Refresh가 읽는다
async function installCommitCounter(page) {
  await page.addInitScript(() => {
    const renderers = new Map();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers,
      supportsFiber: true,
      inject(internals) {
        renderers.set(renderers.size + 1, internals);
        return renderers.size;
      },
      onScheduleFiberRoot() {},
      onCommitFiberUnmount() {},
      onCommitFiberRoot() { window.__commits = (window.__commits ?? 0) + 1; },
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  });
}
// 줄 안의 한 점 - 글이 있으면 첫 글줄 위, 없으면(표) 줄 왼쪽 위. 앞선 놓기의 미끄러짐·따라가는 스크롤이 멈춘 뒤에 잰다(움직이는 중에 재면 다른 줄을 누른다)
async function pointInRow(page, id) {
  const text = page.locator(`[data-testid="output-c-item-${id}"]`);
  const target = (await text.count()) > 0 ? text : page.locator(`[data-testid="output-c-row-${id}"]`);
  let box = await target.boundingBox();
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(100);
    const next = await target.boundingBox();
    if (Math.abs(next.y - box.y) < 0.5 && Math.abs(next.x - box.x) < 0.5) break;
    box = next;
  }
  return { x: box.x + Math.min(40, box.width / 2), y: box.y + 8 };
}
// 열린 C에서 그 칸의 줄 순서(그려진 줄)
const readSectionIds = (page, key) => page.evaluate((k) => [...(document.querySelector(`[data-testid="output-c"] section[data-location-key="${CSS.escape(k)}"]`)?.querySelectorAll("[data-drag-box]") ?? [])].map((row) => row.dataset.flipKey), key);
// 그 줄이 든 칸의 키
const readRowKey = (page, id) => page.evaluate((rowId) => document.querySelector(`[data-testid="output-c-row-${rowId}"]`)?.closest("section")?.dataset.locationKey ?? null, id);
const readRowNumber = (page, id) => page.evaluate((rowId) => document.querySelector(`[data-testid="output-c-number-${rowId}"]`)?.textContent.trim() ?? null, id);
// 끌리는 표 - 거절 표시, 이유·번호(note), 글 전체, 끌리는 덩어리 줄(src)
const readDragCard = (page) => page.evaluate(() => {
  const card = document.querySelector('[data-testid="drag-card"]');
  const note = card?.querySelector(".drag-card-note");
  const src = [...document.querySelectorAll("[data-drag-src]")].map((row) => row.dataset.flipKey);
  return { shown: Boolean(card), refused: card?.hasAttribute("data-refused") ?? false, note: note && !note.hidden ? note.textContent.trim() : "", text: card?.textContent ?? "", src };
});
// 끌기가 남긴 표시 - 끝나면 모두 0이어야 한다
const readDragMarks = (page) => page.evaluate(() => ({
  flag: document.documentElement.hasAttribute("data-box-drag"),
  cards: document.querySelectorAll('[data-testid="drag-card"]').length,
  marks: document.querySelectorAll("[data-drag-src], [data-drag-home], [data-drag-seen], [data-drag-closed], [data-drag-sheet], [data-drag-locked], [data-drop]").length,
  lineShown: document.querySelector('[data-testid="output-c-dropline"]')?.hidden === false,
}));
// 칸 하나의 상태 - 흐림(칸 머리에 닿는 opacity를 용지까지 곱한 값), N/A 사유 줄의 흐림, 올린 칸 테두리(data-drop).
// 흐림은 칸이 아니라 칸 안 요소에 걸린다(N/A 사유 줄은 빼고) - 그래서 머리에서 잰다
const readSectionState = (page, key) => page.evaluate((k) => {
  const section = document.querySelector(`[data-testid="output-c"] section[data-location-key="${CSS.escape(k)}"]`);
  const readOpacity = (el) => {
    let value = 1;
    for (let node = el; node && node.dataset?.testid !== "output-c"; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
    return Math.round(value * 100) / 100;
  };
  const reason = section?.querySelector("[data-na-reason]");
  return section ? { opacity: readOpacity(section.querySelector("h3")), reasonOpacity: reason ? readOpacity(reason) : null, drop: section.dataset.drop ?? null } : null;
}, key);
// 올린 칸의 테두리(outline)가 그 칸의 글자와 놓을 선에 닿지 않나 - 테두리 띠는 칸 상자를 outline-offset만큼 넓힌 안쪽 선부터 굵기만큼 더 넓힌 바깥 선까지.
// 글자(칸 머리·줄 번호·줄 글·표 칸·빈 칸 "–"·N/A 줄을 글자 범위로 잰다)와 선·선의 동그라미(::before)마다 띠까지의 여유(px)를 재 가장 작은 값을 돌려준다
// (안쪽 선 안이면 안쪽 선까지, 바깥 선 밖이면 바깥 선까지 - 음수면 띠에 걸친다). 테두리가 없으면 null, 잰 글자가 없으면 texts 0으로 실패한다
const readOutlineFit = (page, key) => page.evaluate((k) => {
  const section = document.querySelector(`[data-testid="output-c"] section[data-location-key="${CSS.escape(k)}"]`);
  if (!section?.dataset.drop) return null;
  const style = getComputedStyle(section);
  const offset = parseFloat(style.outlineOffset);
  const width = parseFloat(style.outlineWidth);
  const box = section.getBoundingClientRect();
  const grow = (r, d) => ({ left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d });
  const inner = grow(box, offset);
  const outer = grow(box, offset + width);
  const clearance = (r) => Math.max(
    Math.min(r.left - inner.left, inner.right - r.right, r.top - inner.top, inner.bottom - r.bottom),
    Math.max(outer.left - r.right, r.left - outer.right, outer.top - r.bottom, r.top - outer.bottom),
  );
  const texts = [];
  for (const el of section.querySelectorAll('h3, [data-testid^="output-c-number-"], [data-testid^="output-c-item-"], [data-testid^="output-c-empty-"], h3 + p, td')) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) texts.push(rect);
    }
  }
  const line = document.querySelector('[data-testid="output-c-dropline"]');
  const marks = [];
  if (line && !line.hidden) {
    const lineBox = line.getBoundingClientRect();
    const dot = getComputedStyle(line, "::before");
    const left = lineBox.left + parseFloat(dot.left);
    const top = lineBox.top + parseFloat(dot.top);
    marks.push(lineBox, { left, top, right: left + parseFloat(dot.width), bottom: top + parseFloat(dot.height) });
  }
  const round = (value) => Math.round(value * 10) / 10;
  return { drop: section.dataset.drop, offset, width, texts: texts.length, textClear: texts.length ? round(Math.min(...texts.map(clearance))) : null, marks: marks.length, markClear: marks.length ? round(Math.min(...marks.map(clearance))) : null };
}, key);
// 글자와는 1px 넘게, 선·동그라미와는 2px 넘게 떨어져야 한다(1px 틈은 화면 배율에 따라 붙어 보인다). 놓을 수 있는 칸(over)에는 선이 그어져 있어야 한다
const isOutlineClear = (fit) => fit !== null && fit.texts > 0 && fit.textClear >= 1 && (fit.drop !== "over" || (fit.marks === 2 && fit.markClear >= 2));
// 고른 줄의 왼쪽 막대(줄 box-shadow 가운데 --accent 색 층이 보이는 띠)와 그 줄 번호 첫 글자 사이(px) - 음수면 막대가 글자를 덮는다.
// 위 층(앞에 적힌 층)이 덮는 곳은 뺀다. 고른 줄이 아니거나 번호·막대가 없으면 clear null과 그 까닭.
// 줄의 box-shadow는 호버 고리에서 넘어오는 동안 바뀌므로(.c-row[data-drag-box] transition) 그 줄의 전환이 끝난 뒤에 잰다
const readBarClear = async (page, id) => {
  await page.waitForFunction((rowId) => (document.querySelector(`[data-testid="output-c-row-${rowId}"]`)?.getAnimations() ?? []).length === 0, id, { timeout: 2000 });
  return readBarNow(page, id);
};
const readBarNow = (page, id) => page.evaluate((rowId) => {
  const row = document.querySelector(`[data-testid="output-c-row-${rowId}"]`);
  const num = document.querySelector(`[data-testid="output-c-number-${rowId}"]`);
  if (!row || !num?.firstChild) return { clear: null, why: "no row or number" };
  if (document.activeElement !== row) return { clear: null, why: `focus on ${document.activeElement?.dataset.testid ?? document.activeElement?.tagName}` };
  const probe = document.createElement("i");
  probe.style.color = "var(--accent)";
  row.append(probe);
  const accent = getComputedStyle(probe).color;
  probe.remove();
  // 층은 "색 x y 흐림 퍼짐 [inset]" - 색 안의 쉼표는 괄호 밖에서만 나눈다
  const layers = getComputedStyle(row).boxShadow.split(/,(?![^(]*\))/).map((part) => {
    const m = part.trim().match(/^(.*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px(\s+inset)?$/);
    return m ? { color: m[1], x: Number(m[2]), inset: Boolean(m[6]) } : null;
  });
  const at = layers.findIndex((layer) => layer?.color === accent);
  if (at < 0) return { clear: null, why: "no accent layer", shadow: getComputedStyle(row).boxShadow };
  const left = row.getBoundingClientRect().left;
  const bar = layers[at];
  // 안쪽 막대는 줄 왼쪽 끝부터 x만큼, 바깥 막대는 x부터 줄 왼쪽 끝까지 - 그중 위 바깥 층이 덮는 오른쪽은 빠진다
  const covers = layers.slice(0, at).filter((layer) => layer && !layer.inset && layer.x < 0).map((layer) => layer.x);
  const right = bar.inset ? left + bar.x : left + Math.max(bar.x, Math.min(0, ...covers));
  const range = document.createRange();
  range.setStart(num.firstChild, 0);
  range.setEnd(num.firstChild, 1);
  const glyph = range.getBoundingClientRect();
  return { clear: Math.round((glyph.left - right) * 10) / 10, number: num.textContent.trim(), shadow: getComputedStyle(row).boxShadow };
}, id);
// 칸 안의 놓을 점 - 줄이 있으면 마지막 줄 아래 끝 바로 위(칸 끝), 없으면 빈 칸 표시("–")·N/A 사유 줄의 가운데
const pointInSectionEnd = (page, key) => page.evaluate((k) => {
  const section = document.querySelector(`[data-testid="output-c"] section[data-location-key="${CSS.escape(k)}"]`);
  const rows = section.querySelectorAll("[data-drag-box]");
  if (rows.length > 0) {
    const box = rows[rows.length - 1].getBoundingClientRect();
    return { x: box.left + 40, y: box.bottom - 3 };
  }
  const box = section.querySelector("h3 + p").getBoundingClientRect();
  return { x: box.left + 40, y: box.top + box.height / 2 };
}, key);
// 줄을 틀 위쪽(틀 위 + offset px)에 둔다 - 아래 칸들이 같은 화면에 들고, 가장자리 자동 스크롤 띠(44px) 밖이다
const scrollRowToTop = (page, id, offset = 90) => page.evaluate(({ rowId, gap }) => {
  const row = document.querySelector(`[data-testid="output-c-row-${rowId}"]`);
  const pane = row.closest(".overflow-auto, .overflow-y-auto");
  pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - gap;
}, { rowId: id, gap: offset });
// 누르고 문턱을 넘긴 뒤 점들을 차례로 지나간다(사람처럼 여러 걸음)
async function dragThrough(page, from, points) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 10, { steps: 5 });
  for (const point of points) await page.mouse.move(point.x, point.y, { steps: 12 });
}
// 다시 받아 같은 문서를 연다
async function reopenOrderDoc(page, docId, rowId) {
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await page.locator(`[data-testid="output-c-row-${rowId}"]`).waitFor({ timeout: T });
}
// 놓은 직후 그 줄이 번쩍이나(data-flash는 1.3초 뒤 빠진다)
const waitFlash = (page, id) => page.waitForFunction((rowId) => document.querySelector(`[data-testid="output-c-row-${rowId}"]`)?.hasAttribute("data-flash"), id, { timeout: 1200 }).then(() => true, () => false);

// --- 시나리오 ---

let halfBundleId = null;
// 방금 올린 합성 묶음("쪼개기 직후") - 옛 주소 단계가 찾아 두고 뒤 단계들이 쓴다
let freshBundleId = null;

await runStep("bundle list", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const rows = page.locator('[data-testid^="bundles-row-"]');
  check("seeded bundles are listed", (await rows.count()) >= 3, String(await rows.count()));
  const text = await getText(page, "bundles-list");
  check("status labels are English", text.includes("In progress") && text.includes("In review"), text);
  check("role is shown", text.includes("Author"), text);
  const half = page.locator('[data-testid^="bundles-row-"]', { hasText: "분류 절반" });
  halfBundleId = Number((await half.getAttribute("data-testid")).replace("bundles-row-", ""));
  const listApi = await page.request.get(`${BASE}/api/bundles`, { headers: { "X-Dev-User": "qa.member" } });
  const listed = (await listApi.json()).find((bundle) => bundle.id === halfBundleId);
  check("half-classified row shows confirmed / total rows", (await getText(page, `bundles-confirmed-${halfBundleId}`)).includes(`/ ${listed.progress.total}`), String(listed.progress.total));
  check("no stage nav outside a bundle", (await page.locator('[data-testid="stage-nav"]').count()) === 0);
  check("synthetic bundles are marked in the list", (await page.locator(`[data-testid="bundles-synthetic-${halfBundleId}"]`).count()) === 1);
  await takeShot("sop-bundle-list.png");
});

await runStep("overview in rail", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}`);
  await wait(page, "overview-gate-units");
  check("top bar shows the bundle title", (await getText(page, "top-bar-bundle-title")).includes("분류 절반"));
  check("synthetic mark in the top bar", (await page.locator('[data-testid="top-bar-synthetic"]').count()) === 1);
  check("next action is deciding units", (await page.locator('[data-testid="overview-next"]').getAttribute("data-action")) === "decide_units");
  check("overview rate shows a percent", (await getText(page, "overview-rate")).includes("%"), await getText(page, "overview-rate"));
  check("units gate is open", (await page.locator('[data-testid="overview-gate-units"]').getAttribute("data-ok")) === null);
  check("request review is disabled", await page.locator('[data-testid="overview-request-review"]').isDisabled());
  const overview = page.locator('[data-testid="stage-nav-overview"]');
  check("overview is the current step", (await overview.getAttribute("aria-current")) === "page");
  const navBox = await getBox(page, "stage-nav");
  check("rail is 72px wide", Math.round(navBox.width) === 72, JSON.stringify(navBox));
  const barBox = await getBox(page, "top-bar");
  check("top bar is 44px", Math.round(barBox.height) === 44, JSON.stringify(barBox));
  await takeShot("sop-overview-rail.png");
});

await runStep("layout menu switches to top tabs and keeps it", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}`);
  await wait(page, "overview-gate-units");
  // 레이아웃은 사용자 메뉴 안의 하위 메뉴다(2026-11-09 개편)
  await page.locator('[data-testid="top-bar-user"]').click();
  await wait(page, "user-menu");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="user-menu"]').waitFor({ state: "detached", timeout: T });
  check("Esc returns focus to the user button", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "top-bar-user"));
  await page.locator('[data-testid="top-bar-user"]').click();
  await page.locator('[data-testid="user-menu-layout"]').hover();
  await wait(page, "user-menu-layout-flyout");
  check("layout flyout opens on hover", true);
  await page.locator('[data-testid="layout-menu-shell-bar"]').click();
  const navBox = await getBox(page, "stage-nav");
  check("top tabs span the width", navBox.width > 1000 && Math.round(navBox.height) === 39, JSON.stringify(navBox));
  await page.mouse.click(600, 600);
  await page.locator('[data-testid="user-menu"]').waitFor({ state: "detached", timeout: T });
  await takeShot("sop-overview-bar.png");
  // 새로 열 때 첫 HTML 파싱 직후(React 전)에 이미 상단 탭이어야 한다
  await page.goto(`${BASE}/bundles/${halfBundleId}`, { waitUntil: "commit" });
  const early = await page.evaluate(
    () =>
      new Promise((done) => {
        if (document.readyState !== "loading") done(document.documentElement.getAttribute("data-shell"));
        else document.addEventListener("DOMContentLoaded", () => done(document.documentElement.getAttribute("data-shell")), { once: true });
      }),
  );
  check("stored layout applies before the app mounts", early === "bar", String(early));
});

await runStep("Korean before first paint", { storage: { "sopa.lang": "ko" } }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`, { waitUntil: "commit" });
  const lang = await page.evaluate(
    () =>
      new Promise((done) => {
        if (document.readyState !== "loading") done(document.documentElement.lang);
        else document.addEventListener("DOMContentLoaded", () => done(document.documentElement.lang), { once: true });
      }),
  );
  check("html lang is ko before mount", lang === "ko", String(lang));
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const text = await getText(page, "bundles-list");
  check("columns are Korean, statuses stay English", text.includes("제목") && text.includes("In progress"), text);
  await takeShot("sop-bundle-list-ko.png");
});

await runStep("reviewer sees the bundle in review", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await wait(page, "bundles-list");
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  await review.locator("a").click();
  await wait(page, "overview-next");
  check("waiting for review", (await page.locator('[data-testid="overview-next"]').getAttribute("data-action")) === "await_review");
  check("role tag reads Reviewer", (await getText(page, "overview-role")).includes("Reviewer"));
  // 검토는 결과 화면 위의 띠에서 한다 - 레일에 Review 칸이 없고 옛 주소는 결과 화면으로 넘어간다
  check("the rail has no Review item", (await page.locator('[data-testid="stage-nav-review"]').count()) === 0);
  const reviewUrl = page.url();
  await page.goto(`${reviewUrl}/review`);
  await page.waitForURL(/\/outputs$/, { timeout: T });
  await wait(page, "review-complete");
  check("the old Review address lands on Outputs with the review bar", (await getText(page, "review-status")).includes("In review"));
  check("the reviewer gets Return and Complete review", (await page.locator('[data-testid="review-return"]').count()) === 1);
  check("the reviewer cannot request or withdraw", (await page.locator('[data-testid="review-request"], [data-testid="review-withdraw"]').count()) === 0);
});

// 작성자는 결과 화면에서 검토를 요청한다 - 조건이 남아 있으면 단추가 꺼져 있고 남은 조건으로 가는 길이 옆에 있다
await runStep("outputs: the review bar tells the author what is left", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await wait(page, "review-open-conditions");
  check("Request review is off while conditions are open", await page.locator('[data-testid="review-request"]').isDisabled());
  check("the bar shows the bundle status", (await getText(page, "review-status")).includes("In progress"));
  await page.locator('[data-testid="review-open-conditions"]').click();
  await page.waitForURL(new RegExp(`/bundles/${halfBundleId}$`), { timeout: T });
  await wait(page, "overview-gate-units");
  check("See what is left opens the conditions on Overview", true);
});

await runStep("documents list, inline edit and delete prompt", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator('[data-testid$="-row"][data-testid^="documents-"]').first().waitFor({ timeout: T });
  check("documents is the current step", (await page.locator('[data-testid="stage-nav-documents"]').getAttribute("aria-current")) === "page");
  const list = await getText(page, "documents-list");
  // 정상 상태는 글자 없이 아이콘(aria-label "Ready"/"Checked", data-state="ok"), 예외만 글자 알약
  const okStatus = page.locator('[data-testid^="documents-"][data-testid$="-status"][data-state="ok"]').first();
  check("extraction status icon reads Ready", (await okStatus.getAttribute("aria-label")) === "Ready");
  const okAux = page.locator('[data-testid^="documents-"][data-testid$="-aux"][data-state="ok"]');
  check("aux check label", (await okAux.count()) > 0 ? (await okAux.first().getAttribute("aria-label")) === "Checked" : list.includes("Aux check unavailable"), list);
  const firstRow = page.locator('[data-testid$="-row"][data-testid^="documents-"]').first();
  const docId = (await firstRow.getAttribute("data-testid")).replace("documents-", "").replace("-row", "");
  // 버전 칸 - 숫자와 점만 받고, 위 단추는 소수점 아래가 0이면 앞자리를 올린다
  const version = page.locator(`[data-testid="documents-${docId}-version"]`);
  const before = await version.inputValue();
  const rowY = (await firstRow.boundingBox()).y;
  await version.fill("v2.9a");
  check("version keeps only digits and a dot", (await version.inputValue()) === "2.9", await version.inputValue());
  await version.press("Enter");
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.locator(`[data-testid="documents-${docId}-version-up"]`).click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="documents-${id}-version"]`)?.value === "2.10", docId, { timeout: T });
  check("version up moves the minor number", true);
  check("row did not move while editing", Math.abs((await firstRow.boundingBox()).y - rowY) < 1);
  await takeShot("sop-documents.png");
  // 되돌린다 - 원래 빈 값이면 x로 비운다
  await firstRow.hover();
  if (before === "") await page.locator(`[data-testid="documents-${docId}-version-clear"]`).click();
  else {
    await version.fill(before);
    await version.press("Enter");
  }
  await page.waitForFunction(([id, value]) => document.querySelector(`[data-testid="documents-${id}-version"]`)?.value === value, [docId, before], { timeout: T });
  await page.locator(`[data-testid="documents-${docId}-delete"]`).click();
  await wait(page, "delete-document");
  await takeShot("sop-documents-delete.png");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="delete-document"]').waitFor({ state: "detached", timeout: T });
  check("delete prompt closes with Esc", true);
});

await runStep("old Edit original addresses open the document in the one-document view", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  freshBundleId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshBundleId}/documents`, { headers: { "X-Dev-User": "qa.member" } })).json();
  const oldDocs = docs.filter((doc) => doc.side === "old" && doc.status === "ready");
  const newDoc = docs.find((doc) => doc.side === "new" && doc.status === "ready");
  // 옛 쪼개기 주소(/split) → 원문 고치기 주소(?edit=first) → 첫 Old 문서가 한 단으로, 주소에서는 값이 떨어진다
  await page.goto(`${BASE}/bundles/${freshBundleId}/split`);
  await wait(page, "assign-bar");
  await page.waitForURL(/\/assign$/, { timeout: T });
  await page.waitForFunction(() => document.querySelector(".assign-panes")?.hasAttribute("data-single"), null, { timeout: T });
  check("the old Split address lands on Assign with one document wide", (await getText(page, "assign-old-tag")) === "Old" && (await page.locator('[data-testid="assign-new"]').count()) === 0);
  check("no separate tool screen is left", (await page.locator('[data-testid="split-back-assign"], [data-testid="assign-open-split"]').count()) === 0);
  // 문서를 가리키면 그 문서가 열린다 - 둘째 Old 문서
  const second = oldDocs[1] ?? oldDocs[0];
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign?edit=${second.id}`);
  await page.waitForURL(/\/assign$/, { timeout: T });
  await page.waitForFunction((label) => document.querySelector('[data-testid="assign-old"] .pane-head')?.textContent?.includes(label), second.doc_code || second.file_name, { timeout: T });
  check("an address that names an Old document opens that document", true);
  // 이미 쓴 New 문서를 가리키면 그 원문이 한 단으로 열린다
  if (newDoc) {
    await page.goto(`${BASE}/bundles/${freshBundleId}/assign?edit=${newDoc.id}`);
    await wait(page, "assign-solo");
    await page.waitForURL(/\/assign$/, { timeout: T });
    check("an address that names a written New document opens its original", (await getText(page, "assign-old-tag")).includes("New"));
    await takeShot("sop-assign-from-edit-address.png");
  }
  // Documents의 미리 보기에서도 같은 곳으로 온다
  await page.goto(`${BASE}/bundles/${freshBundleId}/documents`);
  await page.locator(`[data-testid="documents-${oldDocs[0].id}-preview"]`).click();
  await wait(page, "documents-preview-split");
  check("the preview's button says where it goes", (await getText(page, "documents-preview-split")).trim() === "Open in Assign");
  await page.locator('[data-testid="documents-preview-split"]').click();
  await wait(page, "assign-bar");
  await page.waitForFunction(() => document.querySelector(".assign-panes")?.hasAttribute("data-single"), null, { timeout: T });
  check("Open in Assign opens the document wide", true);
  // 뒤 단계들은 양 단에서 시작한다
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");
});


// 일부러 거절당하는 저장이 있어 콘솔 오류를 허용한다
// New 문서 목록은 칸마다 바로 저장한다(v1.0.33) - Save 단추와 초안이 없다. 떠나거나 Enter를 누르면 그 칸이 저장된다
const settleToBe = async (page) => {
  await page.waitForFunction(() => document.querySelector('[data-testid="tobe-saving"]')?.textContent === "", null, { timeout: T });
  await page.waitForLoadState("networkidle");
};
const readToBe = async (page, bundleId) => (await page.request.get(`${BASE}/api/bundles/${bundleId}/tobe`, { headers: { "X-Dev-User": "qa.member" } })).json();

await runStep("new documents: nested rows, N/A detail, each cell saves as you leave it", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').first().waitFor({ timeout: T });
  const codes = await page.locator('[data-testid$="-code"][data-testid^="tobe-id-"]').evaluateAll((els) => els.map((el) => el.value));
  check("SOP first, its WIs under it", codes[0] === "SOP-CF" && codes.slice(1).every((code) => code.startsWith("WI-")), codes.join(","));
  check("there is no Save button and no draft bar", (await page.locator('[data-testid="tobe-save"], [data-testid="tobe-dirty"]').count()) === 0);
  const sopRow = page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').first();
  const sopKey = (await sopRow.getAttribute("data-testid")).replace("tobe-", "").replace("-row", "");
  await page.locator(`[data-testid="tobe-${sopKey}-toggle"]`).click();
  check("troubleshooting is N/A with its reason", await page.locator(`[data-testid="tobe-${sopKey}-na-procedures.troubleshooting"]`).isChecked());
  await takeShot("sop-tobe.png");
  const title = page.locator(`[data-testid="tobe-${sopKey}-title"]`);
  const before = await title.inputValue();
  const readTitle = async () => (await readToBe(page, halfBundleId)).docs.find((doc) => `id-${doc.id}` === sopKey).title;
  await title.fill(`${before} (edited)`);
  check("typing alone does not save", (await readTitle()) === before);
  await page.keyboard.press("Enter");
  await settleToBe(page);
  check("Enter saves the cell", (await readTitle()) === `${before} (edited)`);
  // Esc는 고치던 것을 버린다
  await title.fill("thrown away");
  await page.keyboard.press("Escape");
  check("Esc puts the saved text back", (await title.inputValue()) === `${before} (edited)`);
  await title.fill(before);
  await page.keyboard.press("Tab");
  await settleToBe(page);
  check("leaving the cell saves it too", (await readTitle()) === before);
  // N/A는 사유를 적어야 저장된다 - 체크만 하고 떠나면 거둔다
  // 문장이 들지 않은 칸으로 한다(문장이 든 칸은 서버가 N/A를 거절한다)
  const naBox = page.locator(`[data-testid="tobe-${sopKey}-na-document_relationships.appendices"]`);
  const wasNa = await naBox.isChecked();
  if (!wasNa) {
    await naBox.click();
    await wait(page, `tobe-${sopKey}-na-document_relationships.appendices-reason`);
    const countNa = async () => (await readToBe(page, halfBundleId)).na_slots.filter((slot) => slot.slot_key === "document_relationships.appendices").length;
    check("a checked N/A section is not saved before its reason", (await countNa()) === 0);
    await page.locator(`[data-testid="tobe-${sopKey}-na-document_relationships.appendices-reason"]`).fill("Smoke: covered elsewhere");
    await page.keyboard.press("Enter");
    await settleToBe(page);
    check("the reason saves the N/A section", (await countNa()) === 1);
    await naBox.click();
    await settleToBe(page);
    check("unchecking removes it at once", (await countNa()) === 0);
  }
  // 번호로 더하기 - Enter면 줄이 저장된다. 종류와 상위 SOP는 앱이 고르고 사람이 고친다
  const rowsBefore = (await readToBe(page, halfBundleId)).docs.length;
  await page.locator('[data-testid="tobe-add-code"]').fill("WI-99");
  await page.keyboard.press("Enter");
  await settleToBe(page);
  const added = (await readToBe(page, halfBundleId)).docs.find((doc) => doc.code === "WI-99");
  check("a number and Enter add a saved row, as a WI under the SOP", added !== undefined && added.doc_type === "wi" && added.parent_code === "SOP-CF");
  // 이미 있는 번호는 더하지 않고 알린다
  await page.locator('[data-testid="tobe-add-code"]').fill("WI-99");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="toast-error"]').first().waitFor({ timeout: T });
  check("a number already on the list is refused in words", (await getText(page, "toast-error")).includes("Already on the list"));
  // 번호를 고쳐도 같은 줄이다(줄 id가 그대로)
  await page.locator(`[data-testid="tobe-id-${added.id}-code"]`).fill("WI-98");
  await page.keyboard.press("Enter");
  await settleToBe(page);
  check("renaming keeps the same row", (await readToBe(page, halfBundleId)).docs.some((doc) => doc.id === added.id && doc.code === "WI-98"));
  // 다른 줄의 번호로는 못 고친다 - 서버가 거절하고 칸이 저장된 번호로 돌아간다
  await page.locator(`[data-testid="tobe-id-${added.id}-code"]`).fill("SOP-CF");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="toast-error"]').last().waitFor({ timeout: T });
  await settleToBe(page);
  check("a refused change puts the saved number back", (await page.locator(`[data-testid="tobe-id-${added.id}-code"]`).inputValue()) === "WI-98");
  // 장비 SOP로 표시한 줄을 WI로 바꾼다 - 표시가 함께 꺼져야 서버가 받는다(v1.0.36, 전에는 "Only an SOP can be an equipment SOP"로 거절됐다)
  await page.locator('[data-testid="tobe-add-code"]').fill("SOP-97");
  await page.keyboard.press("Enter");
  await settleToBe(page);
  const marked = (await readToBe(page, halfBundleId)).docs.find((doc) => doc.code === "SOP-97");
  await page.locator(`[data-testid="tobe-id-${marked.id}-equipment"]`).click();
  await settleToBe(page);
  await page.locator(`[data-testid="tobe-id-${marked.id}-type"]`).click();
  await page.locator(`[data-testid="tobe-id-${marked.id}-type-option-wi"]`).click();
  await settleToBe(page);
  const markedAfter = (await readToBe(page, halfBundleId)).docs.find((doc) => doc.id === marked.id);
  check("an equipment SOP turns into a WI and the mark goes off with it", markedAfter.doc_type === "wi" && markedAfter.is_equipment_sop === false, JSON.stringify({ type: markedAfter.doc_type, equipment: markedAfter.is_equipment_sop }));
  const removeMarked = page.locator(`[data-testid="tobe-id-${marked.id}-remove"]`);
  await removeMarked.scrollIntoViewIfNeeded();
  await removeMarked.hover();
  await removeMarked.click();
  await settleToBe(page);
  const remove = page.locator(`[data-testid="tobe-id-${added.id}-remove"]`);
  await remove.scrollIntoViewIfNeeded();
  await remove.hover();
  await remove.click();
  await settleToBe(page);
  check("removing the row saves at once", (await readToBe(page, halfBundleId)).docs.length === rowsBefore);
});

// 검토 v0.4.0: 앞 단계를 지워도 뒤 단계 번호가 그대로여야 한다(분류한 문장이 단계 번호를 가리킨다)
await runStep("new documents: removing a step keeps the other numbers", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').first().waitFor({ timeout: T });
  const wiRow = page.locator('[data-testid$="-row"][data-testid^="tobe-id-"]').nth(1);
  const wiKey = (await wiRow.getAttribute("data-testid")).replace("tobe-", "").replace("-row", "");
  await page.locator(`[data-testid="tobe-${wiKey}-toggle"]`).click();
  await wait(page, `tobe-${wiKey}-add-step`);
  const readNumbers = async () =>
    (await page.locator(`[data-testid^="tobe-${wiKey}-step-"]`).evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")))).map((id) => Number(id.split("-step-")[1]));
  const before = await readNumbers();
  const top = Math.max(0, ...before);
  for (const [offset, text] of [[1, "Smoke step A"], [2, "Smoke step B"]]) {
    await page.locator(`[data-testid="tobe-${wiKey}-add-step"]`).click();
    await wait(page, `tobe-${wiKey}-step-${top + offset}`);
    await settleToBe(page);
    await page.locator(`[data-testid="tobe-${wiKey}-step-${top + offset}"]`).fill(text);
    await page.keyboard.press("Enter");
    await settleToBe(page);
  }
  const removeFirst = page.locator(`[data-testid="tobe-${wiKey}-remove-step-${top + 1}"]`);
  await removeFirst.hover();
  await removeFirst.click();
  await settleToBe(page);
  const after = await readNumbers();
  check("the later step keeps its number after an earlier one is removed", after.includes(top + 2) && !after.includes(top + 1), after.join(","));
  check("its title stays with its number", (await page.locator(`[data-testid="tobe-${wiKey}-step-${top + 2}"]`).inputValue()) === "Smoke step B");
  check("the steps that were there are untouched", before.every((no) => after.includes(no)), `${before} -> ${after}`);
  // 저장이 끝난 목록이라 떠날 때 묻지 않는다
  await page.locator('[data-testid="stage-nav-assign"]').click();
  await page.waitForURL(/\/assign$/, { timeout: T });
  check("leaving does not ask - nothing is left unsaved", (await page.locator('[data-testid="tobe-leave"]').count()) === 0);
  // 되돌리기
  await page.goto(`${BASE}/bundles/${halfBundleId}/documents`);
  await page.locator(`[data-testid="tobe-${wiKey}-toggle"]`).click();
  const removeSecond = page.locator(`[data-testid="tobe-${wiKey}-remove-step-${top + 2}"]`);
  await removeSecond.waitFor({ timeout: T });
  await removeSecond.hover();
  await removeSecond.click();
  await settleToBe(page);
  check("restored the step list", (await readNumbers()).join(",") === before.join(","));
});

// Assign(v0.10.0) - Old 원문 조각이 곧 목록이다. 줄은 ↑↓·J/K로 옮기고, 지금 줄은 오른쪽 머리(assign-row-id·assign-row-status)로 읽는다
// 상태 칩은 대문자를 CSS(text-transform)로만 그린다 - innerText는 대문자가 되니 DOM 글자(textContent)로 읽는다
const rowStatus = async (page) => ((await page.locator('[data-testid="assign-row-status"]').first().textContent()) ?? "").trim();
const rowIds = async (page) => (await getText(page, "assign-row-id")).trim();
async function selectRowById(page, id) {
  await page.locator('[data-testid="assign-filter-all"]').click();
  // ↓로 끝까지, 못 찾으면 ↑로 처음까지 - 지금 줄이 어디든 한 번은 지난다
  for (const key of ["j", "k"]) {
    let last = "";
    for (let step = 0; step < 400; step += 1) {
      await page.keyboard.press(key);
      await page.locator('[data-testid="assign-row-id"]').waitFor({ timeout: T });
      const ids = await rowIds(page);
      if (ids.includes(id)) return;
      if (ids === last) break;
      last = ids;
    }
  }
  throw new Error(`row ${id} not reached`);
}
// 칸 줄을 고른다 - 나무는 칸마다 칸 제목 자리(assign-tree-place-heading:…)를 칸 줄 바로 앞에 두므로 그것은 건너뛴다(칸 제목은 고쳐 쓰기가 없다)
async function pickFirstPlace(page) {
  await page.locator('[data-testid="assign-acc-all"]').click();
  await page.locator('[data-testid^="assign-tree-p"]').first().click();
  await page.locator('[data-testid^="assign-tree-place-"]:not([data-testid^="assign-tree-place-heading:"]):not([disabled])').first().click();
  await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
}
const progressDone = async (page) => Number((await getText(page, "assign-progress")).split("/")[0]);

await runStep("assign: legend first, place, delete with reason, edit, clear, bulk", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-pick-prompt");
  check("help panel sits at the bottom of the inspector, folded by default", (await page.locator('[data-testid="assign-inspector"] [data-testid="assign-help"]').count()) === 1 && (await page.locator('[data-testid="assign-help-toggle"]').getAttribute("aria-expanded")) === "false");
  await page.locator('[data-testid="assign-help-toggle"]').click();
  check("help keys tab lists shortcuts", (await page.locator('[data-testid="assign-help-keys"] kbd').count()) >= 8);
  await page.locator('[data-testid="assign-help-tab-marks"]').click();
  check("help marks tab lists marks", (await page.locator('[data-testid="assign-help-marks"] .help-panel-row').count()) >= 10);
  await page.reload();
  await wait(page, "assign-pick-prompt");
  check("help open state and tab are remembered", (await page.locator('[data-testid="assign-help-toggle"]').getAttribute("aria-expanded")) === "true" && (await page.locator('[data-testid="assign-help-tab-marks"]').getAttribute("aria-selected")) === "true");
  // 첫 진입은 All - 용지 전부, 접힘 없음(2026-11-12)
  check("All filter first, nothing folded", (await page.locator('[data-testid="assign-filter-all"]').getAttribute("aria-selected")) === "true" && (await page.locator('[data-testid^="assign-paper-fold-run-"]').count()) === 0);
  await page.locator('[data-testid="assign-filter-unassigned"]').click();
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  check("J picks the first open unit", (await rowStatus(page)) === "Unassigned", await rowStatus(page));
  check("help panel stays while a unit is picked", (await page.locator('[data-testid="assign-help"]').count()) === 1);
  const firstIds = await rowIds(page);
  const before = await progressDone(page);
  await pickFirstPlace(page);
  await takeShot("sop-assign-chosen.png");
  await page.locator('[data-testid="assign-primary"]').click();
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) === done + 1, before, { timeout: T });
  check("Enter-path confirm moves on to the next unit", (await rowIds(page)) !== firstIds);
  // 삭제는 사유가 있어야 한다 - 사유 없이 저장하면 Remark 창이 열리고, 확인하면 저장을 잇는다
  await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-delete"]').click();
  await page.locator('[data-testid="assign-primary"]').click();
  await wait(page, "assign-remark-modal");
  check("delete without a reason opens the Remark window, confirm off", await page.locator('[data-testid="assign-remark-modal-confirm"]').isDisabled());
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("Structural heading");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) === done + 2, before, { timeout: T });
  check("delete with a reason confirms", true);
  // 고쳐 확정 - E로 새 문장을 고치면 변경 종류를 고른다. 고쳐 쓰기는 문장 줄에서만 되니 그림·표 줄이면 다음 줄로 넘어간다(합성 문서의 줄 순서에 기대지 않게)
  const isSentenceRow = () => page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"][data-sel]').evaluateAll((els) => els.length > 0 && els.every((el) => ["ko", "en"].includes(el.getAttribute("lang") ?? "")));
  for (let step = 0; step < 10 && !(await isSentenceRow()); step += 1) {
    await page.keyboard.press("j");
    await page.waitForTimeout(200);
  }
  await pickFirstPlace(page);
  await page.keyboard.press("e");
  const textarea = page.locator('textarea[data-testid^="assign-text-"]').first();
  await textarea.fill("Smoke: rewritten sentence");
  await page.locator('[data-testid^="assign-slot-change-"]').first().waitFor({ timeout: T });
  check("an edited sentence asks for a change type", true);
  await page.keyboard.press("Escape");
  // 비우기
  await selectRowById(page, firstIds.split(" · ")[0]);
  check("the first unit is confirmed", (await rowStatus(page)) === "Confirmed", await rowStatus(page));
  await page.keyboard.press("u");
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("Unassigned"), null, { timeout: T });
  check("U clears the unit", true);
  // 일괄 - Shift+클릭으로 여럿(All이라 용지 전부 - 필터를 걸면 맞지 않는 조각은 접힌다)
  await page.locator('[data-testid="assign-filter-all"]').click();
  const units = page.locator('[data-testid^="assign-paper-unit-"]');
  await units.nth(4).click({ modifiers: ["Shift"] });
  await units.nth(6).click({ modifiers: ["Shift"] });
  await wait(page, "assign-bulk");
  await page.locator('[data-testid="assign-bulk-delete"]').click();
  await page.locator('[data-testid="assign-bulk-reason"]').fill("Header text");
  await page.locator('[data-testid="assign-bulk-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("bulk delete with Shift+click", true);
  await takeShot("sop-assign.png");
});

await runStep("assign: H holds a unit without a destination, with a reason typed in", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  const unit = page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]').nth(2);
  await unit.waitFor({ timeout: T });
  await unit.click();
  await wait(page, "assign-row-id");
  // 짝 줄이면 번호가 둘이다 - 첫 번호로 다시 찾는다
  const heldId = (await getText(page, "assign-row-id")).trim().split(" · ")[0];
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("h");
  await wait(page, "assign-remark-modal");
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("Smoke: not sure where it goes");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("H holds the unit", true);
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, heldId);
  await page.waitForLoadState("networkidle");
  check("held unit shows on Assign with its reason", (await page.locator('[data-testid="assign-reason"]').textContent()) === "Smoke: not sure where it goes");
  check("it has no destination", (await page.locator('[data-testid="assign-chosen"].is-empty').count()) === 1);
  // 저장된 사유를 창에서 지우면 빈 채로 남는다
  await page.locator('[data-testid="assign-reason-edit"]').click();
  await wait(page, "assign-remark-modal");
  const listed = await page.locator('[data-testid="assign-remark-modal-recent-0"]').waitFor({ timeout: T }).then(() => true, () => false);
  check("the Remark window lists my recent remarks", listed);
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  check("a cleared reason stays empty", (await page.locator('[data-testid="assign-reason"]').textContent()) === "–");
});


await runStep("assign: hold an unassigned unit without a destination", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  check("hold is available with no destination", !(await page.locator('[data-testid="assign-hold"]').isDisabled()));
  // 사유 없이 보류하면 Remark 창이 열린다 - 최근 사유를 골라 확인하면 보류가 이어진다
  // 그 줄의 정보를 다 받은 뒤에 누른다 - 받는 동안의 Hold는 아무 일도 하지 않는다(느린 기계에서 이 단계가 떨어졌다)
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-hold"]').click();
  await wait(page, "assign-remark-modal");
  await page.locator('[data-testid="assign-remark-modal-recent-0"]').click();
  check("a recent remark fills the field", (await page.locator('[data-testid="assign-remark-modal-text"]').inputValue()).length > 0);
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("the unit is on hold", true);
});

await runStep("assign: a reference line asks for its number before it can be decided", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  // 위쪽 줄의 남은 수를 누르면 확인이 남은 참조 줄로 간다(합성 문서 7절의 한 줄)
  await page.locator('[data-testid="assign-ref-pending"]').click();
  await wait(page, "assign-ref");
  check("the pill goes to the proposed reference line", (await getText(page, "assign-ref-title")) === "Reference line?" && (await getText(page, "assign-ref-number")).includes("SOP-ABC-1016"), await getText(page, "assign-ref-number"));
  check("the paper marks the proposal", (await page.locator('.strip-lang[data-proposed]').count()) === 1);
  await pickFirstPlace(page);
  check("Confirm stays off until the number is checked", await page.locator('[data-testid="assign-primary"]').isDisabled());
  await page.locator('[data-testid="assign-ref-confirm"]').click();
  await page.locator('[data-testid="assign-ref"][data-state="confirmed"]').waitFor({ timeout: T });
  check("confirming the number makes it a reference line", (await getText(page, "assign-ref-title")) === "Reference line" && (await page.locator('[data-testid="assign-ref-pending"]').count()) === 0);
  check("the paper shows REF where KO or EN would be", (await page.locator('.strip[data-sel] .lang-token[data-lang="ref"]:not([data-proposed])').count()) === 1);
  await takeShot("sop-assign-ref.png");
  await page.locator('[data-testid="assign-undo"]').click();
  await page.locator('[data-testid="assign-ref"][data-state="proposed"]').waitFor({ timeout: T });
  check("undo brings the proposal back", true);
  // 참조 아님 - 카드와 남은 수가 사라지고 다시 제안하지 않는다
  await page.locator('[data-testid="assign-ref-reject"]').click();
  await page.locator('[data-testid="assign-ref"]').waitFor({ state: "detached", timeout: T });
  // 원문을 다시 받은 뒤에 남은 수가 사라진다
  const isCountGone = await page.locator('[data-testid="assign-ref-pending"]').waitFor({ state: "detached", timeout: T }).then(() => true, () => false);
  check("Not a reference removes the card and the count", isCountGone);
});

await runStep("assign: move picks its target doc from the dropdown", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  for (let step = 0; step < 3; step += 1) await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  if ((await page.locator('[data-testid="assign-pick-move"]').count()) === 0) await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-move"]').click();
  // 다른 Bundle의 To-Be 문서가 추천으로 뜬다(데모 Bundle 넷 모두 qa.member가 멤버)
  await page.locator('[data-testid="assign-move-code"]').click();
  await page.locator('[data-testid="assign-move-code"]').fill("SOP");
  const option = page.locator('[data-testid^="assign-move-code-option-"]:not([data-testid$="-typed"])').first();
  await option.waitFor({ timeout: T });
  const code = (await option.getAttribute("data-testid")).replace("assign-move-code-option-", "");
  await takeShot("sop-assign-move-dropdown.png");
  await option.click();
  check("a suggested target doc fills the field", (await page.locator('[data-testid="assign-move-code"]').inputValue()) === code, code);
  await page.locator('[data-testid="assign-primary"]').click();
  await wait(page, "assign-remark-modal");
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("Smoke: belongs to another bundle");
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  check("move saves with the picked target", (await saved).ok());
});

// Old 문장 우클릭 메뉴(배정 + 문장 고치기) - 미배정 문장은 여기서 나누고 언어를 바꾸며, 배정된 문장의 고치기는 까닭과 함께 꺼져 있다
await runStep("assign: right-click an Old sentence to split it or change its language", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${freshBundleId}${path}`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  const rows = (await getJson("/units?limit=1000")).items;
  const docId = rows[0].document_id;
  const viewUnits = async () => (await getJson(`/documents/${docId}/view`)).units;
  const target = (await viewUnits()).find((unit) => unit.kind === "sentence" && unit.text.length > 20 && rows.find((row) => row.unit_id === unit.id)?.status === "unassigned");
  const openMenu = async (unitId) => {
    const el = page.locator(`[data-testid="assign-paper-unit-${unitId}"]`).first();
    await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const box = await el.boundingBox();
    await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + Math.min(12, box.height / 2), { button: "right" });
    await wait(page, "assign-ctx-menu");
  };
  await openMenu(target.id);
  await takeShot("sop-assign-context-menu.png");
  check("the menu has assign and edit groups", (await page.locator('[data-testid="assign-ctx-clear"]').count()) === 1 && (await page.locator('[data-testid="assign-ctx-split"]').count()) === 1);
  // 확정은 Enter·오른쪽 칸·그 자리 메뉴가 맡는다 - 우클릭 메뉴에는 없다
  check("the menu has no confirm item", (await page.locator('[data-testid="assign-ctx-confirm"]').count()) === 0);
  // 언어 바꾸기
  const other = target.lang === "en" ? "ko" : "en";
  await page.locator(`[data-testid="assign-ctx-lang-${other}"]`).click();
  await page.waitForFunction(async ([path, id, lang]) => (await (await fetch(path, { headers: { "X-Dev-User": "qa.member" } })).json()).units.find((unit) => unit.id === id)?.lang === lang, [`/api/bundles/${freshBundleId}/documents/${docId}/view`, target.id, other], { timeout: T });
  check("Language changes the unit's language from Assign", true);
  // 고친 뒤 화면이 원문을 다시 받아 그 줄을 다시 고른다 - 그 전에 메뉴를 열면 줄을 다시 고를 때 메뉴가 닫힌다
  await page.waitForLoadState("networkidle");
  await wait(page, "assign-row-id");
  // 고른 조각은 문단 테두리, 마우스만 올린 조각에는 테두리·언어 칩이 없다(올린 곳이 고른 것처럼 보이지 않게)
  const ringOf = (selector) => page.evaluate((sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el, "::after").borderTopWidth : null; }, selector);
  check("the selected piece gets a paragraph border", (await ringOf(`[data-testid="assign-paper-piece-${target.id}"]`)) === "2px");
  const neighbor = (await viewUnits()).find((unit) => unit.kind === "sentence" && unit.id !== target.id && unit.pair_id === null && unit.lang !== "ref");
  const neighborPiece = page.locator(`[data-testid="assign-paper-piece-${neighbor.id}"]`);
  await neighborPiece.hover();
  await page.waitForTimeout(300);
  check("a hovered piece shows no border and no language chip", (await ringOf(`[data-testid="assign-paper-piece-${neighbor.id}"]`)) !== "2px" && (await page.locator(`[data-testid="assign-paper-piece-${neighbor.id}"] > .strip-lang`).evaluate((el) => getComputedStyle(el).visibility)) === "hidden");
  // Shape 언어 세 칸 - 바꾸는 동안 고름이 풀리지 않고 포커스가 누른 칸에 남는다
  const back = target.lang;
  await page.evaluate(() => { window.__selDrops = 0; new MutationObserver((recs) => { for (const r of recs) if (r.oldValue !== null && !r.target.hasAttribute("data-sel")) window.__selDrops += 1; }).observe(document.querySelector('[data-pane="old"]'), { attributes: true, subtree: true, attributeFilter: ["data-sel"], attributeOldValue: true }); });
  // 한/영 줄은 평소 KO | EN만, 세 칸에 올리면 REF까지 펼친다
  const langWidths = () => page.locator(`[data-testid="assign-shape-lang-${target.id}"] button`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  const restWidths = await langWidths();
  await page.locator(`[data-testid="assign-shape-lang-${target.id}"]`).hover();
  await page.waitForTimeout(300);
  const openWidths = await langWidths();
  check("the language switch shows KO | EN at rest and REF too on hover", restWidths.length === 3 && restWidths[0] > 0 && restWidths[1] > 0 && restWidths[2] === 0 && openWidths.every((w) => w >= 28), JSON.stringify({ restWidths, openWidths }));
  await page.locator(`[data-testid="assign-shape-lang-${target.id}-${back}"]`).click();
  await page.waitForFunction(async ([path, id, lang]) => (await (await fetch(path, { headers: { "X-Dev-User": "qa.member" } })).json()).units.find((unit) => unit.id === id)?.lang === lang, [`/api/bundles/${freshBundleId}/documents/${docId}/view`, target.id, back], { timeout: T });
  await page.locator(`[data-testid="assign-shape-lang-${target.id}-${back}"][aria-pressed="true"]`).waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  check("the Shape language buttons change the language without dropping the selection", (await page.evaluate(() => window.__selDrops)) === 0);
  check("focus stays on the pressed language button", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === `assign-shape-lang-${target.id}-${back}`);
  // 여기서 나누기 - 선을 놓고 Split here
  const before = (await viewUnits()).length;
  await openMenu(target.id);
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  await page.waitForFunction(async ([path, count]) => (await (await fetch(path, { headers: { "X-Dev-User": "qa.member" } })).json()).units.length === count + 1, [`/api/bundles/${freshBundleId}/documents/${docId}/view`, before], { timeout: T });
  check("Split here splits the sentence from Assign", true);
  await wait(page, "assign-row-id");
  check("the first piece's row is selected after the split", (await page.locator('[data-testid="assign-row-id"]').count()) === 1);
});

await runStep("assign: an edit survives looking at another unit", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  await pickFirstPlace(page);
  await page.keyboard.press("e");
  const textarea = page.locator('textarea[data-testid^="assign-text-"]').first();
  await textarea.fill("Smoke: edit kept across units");
  await page.locator('[data-testid="assign-help-toggle"]').focus();
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await textarea.waitFor({ timeout: T });
  check("the edit is still there", (await textarea.inputValue()) === "Smoke: edit kept across units");
});

// 표는 묶음째 배정한다 - 칸 글자를 눌러도 표 전체가 골라지고(전에는 아무 일도 없었다), Alt를 누른 채 끌면 글자가 골라진다
await runStep("assign: a click anywhere on a table picks the whole table, Alt still selects text", {}, async ({ page }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  let doc = null;
  let table = null;
  let cell = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${candidate.id}/view`, { headers })).json();
    const found = view.units.find((unit) => unit.kind === "table" && unit.status === "unassigned" && view.units.some((other) => other.kind === "cell_sentence" && other.group_unit_id === unit.id && other.text.length > 3));
    if (!found) continue;
    doc = candidate;
    table = found;
    cell = view.units.find((unit) => unit.kind === "cell_sentence" && unit.group_unit_id === found.id && unit.text.length > 3);
    break;
  }
  check("the fresh bundle has an unassigned whole table", table !== null);
  if (table === null) return;
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  const cellText = page.locator(`[data-testid="assign-paper-unit-${cell.id}"]`).first();
  await cellText.waitFor({ timeout: T });
  await cellText.scrollIntoViewIfNeeded();
  await cellText.click();
  const splitRows = page.locator(`[data-testid="assign-shape-table_rows-${table.id}"]`);
  await splitRows.waitFor({ state: "attached", timeout: T });
  check("clicking cell text picks the whole table (Shape offers Split into rows)", (await splitRows.getAttribute("aria-label")) === "Split into rows");
  check("the table piece is the selected one", (await page.locator(`[data-testid="assign-paper-piece-${table.id}"]`).getAttribute("data-sel")) === "");
  // Alt+끌기 - 칸 글자 첫머리에서 끝까지
  const box = await cellText.boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  check("Alt+drag still selects text", selected.trim().length > 0, JSON.stringify(selected));
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
});

// 배정 화면에서 표를 행으로 나누거나 다시 합치고 되돌리기 - 우클릭 메뉴(전에는 쪼개기 화면에서만 했다). Ctrl+Z로 처음 모양으로 돌아온다
await runStep("assign: table rows from the right-click menu, then undo", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${docId}/view`, { headers })).json();
  // 배정이 없는 표 - 통째면 행으로 나누고, 앞 시나리오가 이미 나눠 두었으면 다시 합친다
  let doc = null;
  let holder = null;
  let cell = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const found = view.units.find((unit) => (unit.kind === "table" || unit.kind === "table_row") && unit.status === "unassigned");
    if (!found) continue;
    doc = candidate;
    holder = found;
    cell = view.units.find((unit) => unit.kind === "cell_sentence" && unit.group_unit_id === found.id) ?? null;
    break;
  }
  check("the fresh bundle has an unassigned table", holder !== null);
  const action = holder.kind === "table" ? "table_rows" : "table_merge";
  const countKinds = async () => {
    const view = await readView(doc.id);
    return `${view.units.filter((unit) => unit.kind === "table").length} tables, ${view.units.filter((unit) => unit.kind === "table_row").length} rows`;
  };
  const before = await countKinds();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  // 표·행 단위는 제 조각이 없을 수 있다 - 그러면 그 표의 칸 문장을 누른다(그 문장의 줄이 골라지며 문서도 그리로 넘어간다)
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  if ((await pieceOf(holder.id).count()) === 0 && (cell === null || (await pieceOf(cell.id).count()) === 0)) {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  }
  // 통째인 표는 머리 줄을 우클릭한다(칸 위가 아니라 표 전체), 행으로 나눈 표는 머리 줄이 없어 칸 문장으로
  const headOf = (unitId) => page.locator(`[data-testid="assign-paper-head-${unitId}"]`).first();
  const target = (await headOf(holder.id).count()) > 0 ? headOf(holder.id) : (await pieceOf(holder.id).count()) > 0 || cell === null ? pieceOf(holder.id) : pieceOf(cell.id);
  await target.waitFor({ timeout: T });
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: "right" });
  await wait(page, `assign-ctx-${action}`);
  check("the menu offers one direction only", (await page.locator(`[data-testid="assign-ctx-${action === "table_rows" ? "table_merge" : "table_rows"}"]`).count()) === 0);
  await takeShot("sop-assign-table-menu.png");
  if ((await page.locator(`[data-testid="assign-ctx-${action}"]`).getAttribute("aria-disabled")) === "true") {
    // 다른 행에 배정이 있는 표는 다시 합치지 못한다 - 항목이 잠기고 까닭이 붙는다
    check("a table with an assigned row keeps Merge rows back locked, with the reason", ((await page.locator(`[data-testid="assign-ctx-${action}"]`).getAttribute("data-tip")) ?? "").includes("row"));
    return;
  }
  await page.locator(`[data-testid="assign-ctx-${action}"]`).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-undo"]')?.disabled === false, null, { timeout: T });
  const changed = await countKinds();
  check(action === "table_rows" ? "the table becomes rows" : "the rows become one table again", changed !== before, `${before} -> ${changed}`);
  // 화면이 새 줄을 고른 뒤에 되돌린다 - 그 전에 되돌리면 막 사라진 단위의 정보를 한 번 불러 404가 콘솔에 찍힌다(사람 손으로는 나오지 않는 속도)
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((toast) => /table rows/i.test(toast.textContent ?? "")), null, { timeout: T });
  check("Undo puts the table back as it was", (await countKinds()) === before, await countKinds());
});

await runStep("split rows of a table, then assign a row as a table", { allowConsoleErrors: true }, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshBundleId}/documents/${docId}/view`, { headers })).json();
  // 통째인 표가 있는 Old 문서 - 그 표의 칸 문장을 우클릭해 행으로 나눈다
  let doc = null;
  let table = null;
  let cell = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const found = view.units.find((unit) => unit.kind === "table");
    if (!found) continue;
    doc = candidate;
    table = found;
    cell = view.units.find((unit) => unit.kind === "cell_sentence" && unit.group_unit_id === found.id) ?? null;
    break;
  }
  check("the fresh bundle has a whole table", table !== null);
  if (table === null) return;
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${doc.id}"]`).click();
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  const target = (await pieceOf(table.id).count()) > 0 || cell === null ? pieceOf(table.id) : pieceOf(cell.id);
  await target.waitFor({ timeout: T });
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: "right" });
  await wait(page, "assign-ctx-table_rows");
  await page.locator('[data-testid="assign-ctx-table_rows"]').click();
  // 판단이 걸린 표면 서버가 먼저 묻는다
  const confirm = page.locator('[data-testid="assign-edit-confirm-confirm"]');
  if (await confirm.waitFor({ timeout: 2000 }).then(() => true, () => false)) await confirm.click();
  let row = null;
  for (let tries = 0; tries < 60 && row === null; tries += 1) {
    row = (await readView(doc.id)).units.find((unit) => unit.kind === "table_row" && unit.table_id === table.table_id) ?? null;
    if (row === null) await page.waitForTimeout(250);
  }
  check("rows are split", row !== null, row?.display_id);
  if (row === null) return;
  await page.waitForLoadState("networkidle");
  await selectRowById(page, row.display_id);
  await pickFirstPlace(page);
  // 원문 캡션은 첫 행에 딸린다 - 캡션이 없는 행은 새 표라 Confirm이 꺼져 있고, 캡션을 써 넣어야 확정된다(명세 §3.4)
  const primary = page.locator('[data-testid="assign-primary"]');
  if (await primary.isDisabled()) {
    await page.locator('[data-testid="assign-caption-write"]').click();
    await page.locator('[data-testid^="assign-caption-text-"]').first().fill("SYNTHETIC row table caption");
  }
  await primary.click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("a table row confirms as a one-row table", true);
});

// 캡션 없는 표 바로 앞 문장을 Shape에서 붙였다 떼고, 되돌리기 두 번으로 처음대로 둔다 - 다음 단계가 같은 표에 캡션을 써 넣는다
await runStep("assign: attach and detach a caption from Shape", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  const units = (await getJson("/units?limit=1000")).items;
  const captioned = new Set(units.filter((unit) => unit.kind === "caption").map((unit) => unit.group_unit_id));
  const table = units.find((unit) => unit.kind === "table" && unit.status === "unassigned" && !captioned.has(unit.unit_id) && !unit.has_caption_target);
  check("the half bundle has an unassigned table without a caption", Boolean(table), table?.display_id);
  if (!table) return;
  // 그 표가 든 Old 문서와 표 바로 앞 단위(칸 문장·캡션은 표 자리로 친다)
  let doc = null;
  let sentence = null;
  let figure = null;
  let after = null;
  for (const candidate of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${candidate.id}/view`);
    if (!view.units.some((unit) => unit.id === table.unit_id)) continue;
    const ordered = [...view.units].filter((unit) => unit.kind !== "table_row" || unit.spans.length > 0).sort((a, b) => a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0) || a.id - b.id);
    const first = ordered.findIndex((unit) => unit.id === table.unit_id || unit.group_unit_id === table.unit_id);
    doc = candidate;
    sentence = ordered[first - 1] ?? null;
    const last = ordered.findLastIndex((unit) => unit.id === table.unit_id || unit.group_unit_id === table.unit_id);
    after = ordered[last + 1] ?? null;
    figure = view.units.find((unit) => unit.kind === "figure") ?? null;
  }
  check("a free sentence sits right above the table", sentence !== null && sentence.kind === "sentence" && sentence.group_unit_id === null, sentence?.text);
  if (!doc || !sentence) return;
  const captionsOf = async () => (await getJson(`/documents/${doc.id}/view`)).units.filter((unit) => unit.kind === "caption" && unit.group_unit_id === table.unit_id);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, table.display_id);
  // 우클릭도 같은 항목 - 글에서는 "아래 표의 캡션으로 쓰기", 그림에서는 문장 메뉴가 아닌 묶음 메뉴(언어 줄 없음)
  const sentencePiece = page.locator(`[data-testid="assign-paper-unit-${sentence.id}"]`).first();
  await sentencePiece.scrollIntoViewIfNeeded();
  await sentencePiece.click({ button: "right" });
  await wait(page, "assign-ctx-caption_attach_next");
  check("right-click on the sentence offers Use as caption of the table below", (await page.locator('[data-testid="assign-ctx-caption_attach_next"]').innerText()).includes("Use as caption of the table below"));
  await page.keyboard.press("Escape");
  if (figure) {
    const figurePiece = page.locator(`[data-testid="assign-paper-piece-${figure.id}"]`).first();
    await figurePiece.scrollIntoViewIfNeeded();
    await figurePiece.click({ button: "right" });
    await wait(page, "assign-ctx-menu");
    check("right-click on a figure opens the bundle menu, not the sentence menu", (await page.locator('[data-testid="assign-ctx-lang"], [data-testid="assign-ctx-split"]').count()) === 0);
    await page.keyboard.press("Escape");
  }
  await selectRowById(page, table.display_id);
  const tableLine = page.locator(`[data-testid="assign-shape-line-${table.unit_id}"]`);
  await tableLine.waitFor({ timeout: T });
  // 표 뒤가 묶이지 않은 글이 아니면(데모에서는 그림) 아래 붙이기 단추가 없다
  const canAttachBelow = after !== null && (after.kind === "sentence" || after.kind === "heading") && after.group_unit_id === null && after.lang !== "ref";
  check("Shape offers attach below only when free text follows the table", (await page.locator(`[data-testid="assign-shape-caption_attach_next-${table.unit_id}"]`).count()) === (canAttachBelow ? 1 : 0), after?.kind);
  await tableLine.hover();
  const attach = page.locator(`[data-testid="assign-shape-caption_attach_prev-${table.unit_id}"]`);
  check("Shape offers Attach the sentence above as caption", (await attach.getAttribute("aria-label")) === "Attach the sentence above as caption", await attach.getAttribute("aria-label"));
  await attach.click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Caption attached" }).first().waitFor({ timeout: T });
  const [caption] = await captionsOf();
  check("the sentence becomes the table's caption", caption?.text === sentence.text, caption?.text);
  if (!caption) return;
  const head = page.locator(`[data-testid="assign-paper-caption-${table.unit_id}"]`);
  await head.waitFor({ timeout: T });
  check("the table head shows the sentence as its caption", (await head.innerText()).includes(sentence.text.slice(0, 10)), await head.innerText());
  check("Caption needed is gone", (await page.locator(`[data-testid="assign-paper-caption-missing-${table.unit_id}"]`).count()) === 0);
  // 캡션은 Shape에서 문장처럼 한 줄 - 언어 세 칸과 떼기 단추
  const captionLine = page.locator(`[data-testid="assign-shape-line-${caption.id}"]`);
  await captionLine.waitFor({ timeout: T });
  check("the caption has its own Shape line with KO | EN | REF", (await page.locator(`[data-testid="assign-shape-lang-${caption.id}"] button`).count()) === 3);
  await captionLine.hover();
  check("a caption cannot become a reference line (REF is off)", (await page.locator(`[data-testid="assign-shape-lang-${caption.id}-ref"]`).getAttribute("aria-disabled")) === "true");
  await takeShot("sop-assign-caption-shape.png");
  await page.locator(`[data-testid="assign-shape-caption_detach-${caption.id}"]`).click();
  await page.locator('[data-testid="toast-ok"]', { hasText: "Caption detached" }).first().waitFor({ timeout: T });
  await page.locator(`[data-testid="assign-paper-caption-missing-${table.unit_id}"]`).waitFor({ timeout: T });
  check("after Detach caption the head says Caption needed again", (await captionsOf()).length === 0);
  // 되돌리기 - 떼기를 되돌리면 캡션이 돌아오고, 붙이기까지 되돌리면 처음처럼 캡션이 없다
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]').click();
  await head.waitFor({ timeout: T });
  check("Undo brings the caption back", (await captionsOf()).length === 1);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]').click();
  await page.locator(`[data-testid="assign-paper-caption-missing-${table.unit_id}"]`).waitFor({ timeout: T });
  check("Undo again leaves the table without a caption, as it was", (await captionsOf()).length === 0);
});

await runStep("assign: a bundle without a caption cannot be confirmed until one is written", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  // 데모 시드가 일부러 남긴 캡션 없는 미배정 표(OLD-7) - 캡션 단위도 써 넣은 캡션도 없다
  const units = (await getJson("/units?limit=1000")).items;
  const captioned = new Set(units.filter((unit) => unit.kind === "caption").map((unit) => unit.group_unit_id));
  const table = units.find((unit) => unit.kind === "table" && unit.status === "unassigned" && !captioned.has(unit.unit_id) && !unit.has_caption_target);
  check("the half bundle has an unassigned table without a caption", Boolean(table), table?.display_id);
  if (!table) return;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  const pending = page.locator('[data-testid="assign-caption-pending"]');
  await pending.waitFor({ timeout: T });
  const countBefore = parseInt(await pending.innerText(), 10);
  // 좁은 상단 바에서는 수만 보이고 문구는 aria-label에 있다
  const pendingLabel = (await pending.getAttribute("aria-label")) ?? (await pending.innerText());
  check("the top bar counts the bundles that need a caption", countBefore > 0 && pendingLabel.includes(`${countBefore} captions needed`), pendingLabel);
  // 누를 때마다 캡션이 필요한 다음 묶음 - 그 표에 닿을 때까지
  for (let step = 0; step <= countBefore && (await page.locator('[data-testid="assign-row-id"]').count() === 0 || !(await rowIds(page)).includes(table.display_id)); step += 1) {
    await pending.click();
    await page.locator('[data-testid="assign-row-id"]').waitFor({ timeout: T });
  }
  check("the count walks to that table", (await rowIds(page)).includes(table.display_id), await rowIds(page));
  check("its head says Caption needed", (await page.locator(`[data-testid="assign-paper-caption-missing-${table.unit_id}"]`).count()) === 1);
  await pickFirstPlace(page);
  const primary = page.locator('[data-testid="assign-primary"]');
  check("Confirm is off for a table without a caption", await primary.isDisabled());
  await wait(page, "assign-caption-needed");
  await page.locator('[data-testid="assign-caption-write"]').click();
  const field = page.locator('[data-testid^="assign-caption-text-"]');
  await field.first().waitFor({ timeout: T });
  check("Write a caption opens one caption field", (await field.count()) === 1);
  const text = "표 9. 회전 속도 SYNTHETIC";
  await field.first().fill(text);
  check("writing a caption turns Confirm on", await primary.isEnabled());
  await takeShot("sop-assign-caption-write.png");
  await primary.click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  // 남은 수가 하나 줄고, 머리 줄의 Caption needed도 사라진다(같은 규칙)
  await page.waitForFunction((n) => Number.parseInt(document.querySelector('[data-testid="assign-caption-pending"]')?.textContent ?? "0", 10) === n - 1, countBefore, { timeout: T });
  check("the count drops by one", true);
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-caption-missing-${id}"]`) === null, table.unit_id, { timeout: T });
  check("the head no longer says Caption needed", true);
  check("the unit list now marks the table as captioned", (await getJson("/units?limit=1000")).items.find((unit) => unit.unit_id === table.unit_id)?.has_caption_target === true);
  let inC = false;
  for (const doc of (await getJson("/tobe")).docs.filter((item) => item.entrance === "assign")) {
    if (JSON.stringify(await getJson(`/outputs/c/docs/${doc.id}?lang=ko`)).includes("회전 속도 SYNTHETIC")) inC = true;
  }
  check("output C carries the written caption", inC);
});

await runStep("assign: an AI split keeps both sentences when confirmed", {}, async ({ page }) => {
  const status = await page.request.get(`${BASE}/api/bundles/${freshBundleId}/ai/status`, { headers: { "X-Dev-User": "qa.member" } });
  if (!status.ok() || !(await status.json()).ai_enabled) {
    console.log("  (AI is off in this backend - skipped)");
    return;
  }
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  // 앞 단계가 첫 줄들을 보류로 둔다(H 보류·Assign 보류, AI 나눔을 되돌린 문장은 짝이 풀려 제 줄) - 요청 단추가 있는 미배정 줄까지 내려간다
  const aiRequest = page.locator('[data-testid="assign-ai-request"]');
  for (let step = 0; step < 10 && (await aiRequest.count()) === 0; step += 1) {
    await page.keyboard.press("j");
    await page.waitForTimeout(200);
  }
  await aiRequest.click();
  // 상단 바 표시가 대기·실행 중을 보인다(워커가 2초마다 꺼내므로 요청 직후에는 대기 중이다)
  await page.locator('[data-testid="top-bar-ai"][data-state="active"]').waitFor({ timeout: T });
  check("the top bar shows the AI job in progress", (await getText(page, "top-bar-ai-active")).trim() === "1");
  // 폴링으로 제안이 저절로 들어온다(새로고침 없이)
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("AI suggested"), null, { timeout: 30000 });
  check("the AI suggestion appears without a reload", true);
  // 내가 한 요청이 끝나면 알림이 뜨고, 목록에는 끝난 요청이 n / N과 함께 남는다
  await page.locator('[data-testid="toast-ok"]', { hasText: /^AI Classify finished · BND-/ }).first().waitFor({ timeout: 30000 });
  check("a toast says the request finished", true);
  await page.locator('[data-testid="top-bar-ai"]:not([data-state="active"])').waitFor({ timeout: T });
  await page.locator('[data-testid="top-bar-ai"]').click();
  await wait(page, "ai-jobs-popover");
  const doneRow = page.locator('[data-testid^="ai-jobs-request-"][data-outcome="done"]').first();
  await doneRow.waitFor({ timeout: T });
  const progress = (await doneRow.locator('[data-testid$="-progress"]').innerText()).trim();
  check("the job list shows the finished request with its progress", /^(\d+) \/ \1$/.test(progress), progress);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="ai-jobs-popover"]').waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid^="assign-text-t"]').nth(1).waitFor({ timeout: T });
  const slots = await page.locator('[data-testid^="assign-text-t"]').count();
  check("both split sentences are shown", slots >= 2, String(slots));
  const ids = await rowIds(page);
  await page.locator('[data-testid="assign-primary"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await selectRowById(page, ids.split(" · ")[0]);
  await page.locator('[data-testid^="assign-text-t"]').first().waitFor({ timeout: T });
  check("both sentences are still there after confirming", (await page.locator('[data-testid^="assign-text-t"]').count()) === slots);
});

// 한 단 · 양 단 보기(v1.0.20) - 문서 하나만 넓게 보고 돌아온다. 고른 보기는 브라우저에 기억된다
await runStep("assign: one document wide, then two again", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-new");
  const readOldWidth = async () => (await page.locator('[data-pane="old"]').boundingBox()).width;
  const twoWidth = await readOldWidth();
  // 보기를 바꾸면 Old 용지가 새 자리로 미끄러진다(v1.0.35) - 움직이는 동안의 표시는 금방 지워져서 누르기 전부터 지켜본다
  await page.evaluate(() => {
    window.__paneMotions = [];
    const panes = document.querySelector(".assign-panes");
    new MutationObserver(() => panes.dataset.motion && window.__paneMotions.push(panes.dataset.motion)).observe(panes, { attributes: true, attributeFilter: ["data-motion"] });
    // 접을 때 New 칸의 복제본이 잠깐 붙었다 떨어진다(v1.0.36)
    window.__paneGhosts = 0;
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement && "ghost" in node.dataset) window.__paneGhosts += 1;
    }).observe(panes, { childList: true });
  });
  await page.locator('[data-testid="assign-view-one"]').click();
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  await page.locator(".assign-panes:not([data-motion])").waitFor({ timeout: T });
  check("switching the view slides the paper and then settles", (await page.evaluate(() => window.__paneMotions.join(","))) === "one" && (await page.evaluate(() => getComputedStyle(document.querySelector('[data-pane="old"] .sheet')).transform)) === "none");
  check("the folded New pane fades out as a picture and is removed", (await page.evaluate(() => window.__paneGhosts)) === 1 && (await page.locator("[data-ghost]").count()) === 0);
  check("one view hides the New pane and the divider", (await page.locator('[data-testid="assign-divider"]').count()) === 0);
  check("the Old pane takes the freed width", (await readOldWidth()) > twoWidth * 1.5);
  // 한 단에서도 줄을 고르면 보낼 곳이 보이고, 직접 잇기는 양 단이 필요하다는 안내가 뜬다
  await page.locator(".strip[data-strip-unit]").first().click();
  await wait(page, "assign-single-hint");
  check("the destination list still works in one view", (await page.locator('[data-testid="assign-pick"]').count()) === 1);
  await takeShot("sop-assign-single.png");
  await page.reload();
  await wait(page, "assign-view-one");
  check("the view is remembered after a reload", (await page.locator('[data-testid="assign-view-one"]').getAttribute("aria-pressed")) === "true" && (await page.locator('[data-testid="assign-new"]').count()) === 0);
  await page.locator(".strip[data-strip-unit]").first().click();
  await wait(page, "assign-single-hint-two");
  await page.locator('[data-testid="assign-single-hint-two"]').click();
  await wait(page, "assign-new");
  check("the hint's button brings both documents back", (await page.locator('[data-testid="assign-view-two"]').getAttribute("aria-pressed")) === "true");
  // 글쇠 V로 오간다 - 입력 칸 밖에서
  await page.locator('[data-testid="assign-view-two"]').blur();
  await page.keyboard.press("v");
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  // 출처 없는 New 문장은 New 칸에서 보므로 양 단으로 편다
  await page.locator('[data-testid="assign-filter-unsourced"]').click();
  await wait(page, "assign-new");
  check("New without source opens both documents", (await page.locator('[data-testid="assign-view-two"]').getAttribute("aria-pressed")) === "true");
  // 세로선을 오른쪽 끝까지 끌어 놓으면 한 단
  const panes = await page.locator(".assign-panes").boundingBox();
  const divider = await page.locator('[data-testid="assign-divider"]').boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
  await page.mouse.down();
  await page.mouse.move(panes.x + panes.width - 8, divider.y + divider.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.locator('[data-testid="assign-new"]').waitFor({ state: "detached", timeout: T });
  check("dragging the divider to the right edge folds the New pane", (await page.locator('[data-testid="assign-view-one"]').getAttribute("aria-pressed")) === "true");
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");
});

await runStep("assign: written New document - identical, link by clicking, split with Ctrl, zoom, width, mark new", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-identical");
  await page.locator('[data-testid="assign-identical"]').click();
  // 여러 줄을 한 번에 확정하므로 확인 창을 거친다
  await page.locator('[data-testid="assign-identical-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.locator('[data-testid="assign-identical"]').waitFor({ state: "detached", timeout: T });
  check("identical matches confirm together", true);
  // 쓴 문서의 문장에 잇기 - 원문에서 직접 누른다
  // 비슷한 New 문장 후보(점선)가 있는 Old 조각까지 옮긴다
  await page.locator('[data-testid="assign-filter-unassigned"]').click();
  const candidate = page.locator('[data-testid="assign-new"] .new-line[data-state="candidate"]');
  // 줄을 옮길 때마다 그 줄의 후보 요청이 끝나기를 기다린다 - networkidle은 첫 로드 뒤로는 곧바로 풀려서,
  // 기다리지 않으면 응답보다 먼저 다음 줄로 넘어가 닿는 줄이 실행 속도에 따라 달라진다
  let openCandidateRequests = 0;
  const countCandidateRequest = (delta) => (request) => {
    if (request.url().includes("/new-candidates")) openCandidateRequests += delta;
  };
  page.on("request", countCandidateRequest(1));
  page.on("requestfinished", countCandidateRequest(-1));
  page.on("requestfailed", countCandidateRequest(-1));
  // 고른 Old 줄의 언어들 - 줄에 없는 언어의 New 문장도 이을 수 있는지(언어 잠금 없음) 보려면 한 언어 줄이어야 한다
  const readRowLangs = () => page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"][data-sel]').evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute("lang") ?? "neutral"))]);
  const otherLangLines = async () => {
    const langs = await readRowLangs();
    if (langs.length !== 1 || langs[0] === "neutral") return null;
    return page.locator(`[data-testid="assign-new"] .new-line:not([data-state="picked"]):not([data-lang="${langs[0]}"]):not([data-lang="neutral"])`);
  };
  // 참조 줄 제안이 남은 줄은 번호를 확인하기 전에는 확정되지 않는다 - 이 단계는 그런 줄을 건너뛴다
  const isReady = async () => (await candidate.count()) > 0 && (await page.locator('[data-testid="assign-ref"]').count()) === 0 && (await (await otherLangLines())?.count() ?? 0) > 0;
  for (let step = 0; step < 40 && !(await isReady()); step += 1) {
    await page.keyboard.press("j");
    // 요청이 나갈 틈(문장이 없는 줄은 요청이 없다) → 걸린 요청이 없을 때까지 → 응답을 그릴 틈
    await page.waitForTimeout(150);
    while (openCandidateRequests > 0) await page.waitForTimeout(50);
    await page.waitForTimeout(100);
  }
  // 누르면 후보가 아니라 고른 문장이 된다 - 같은 줄을 계속 가리키게 testid로 붙잡는다
  const firstLine = page.locator(`[data-testid="${await candidate.first().getAttribute("data-testid")}"]`);
  // 줄 가운데를 누르면 오른쪽 출처 칩에 닿을 수 있다 - 고르는 단추를 누른다
  await firstLine.locator(".new-hit").click();
  check("clicking a New sentence picks it", (await firstLine.getAttribute("data-state")) === "picked");
  // 맥에서 Ctrl+클릭은 오른쪽 클릭이다 - 화면은 ⌘도 같은 뜻으로 받는다
  const multi = process.platform === "darwin" ? "Meta" : "Control";
  // 둘째 줄은 줄에 없는 언어의 문장을 고른다 - 언어로 막지 않고 이을 수 있다(번역)
  const rowLangs = await readRowLangs();
  const unpicked = await otherLangLines();
  const second = page.locator(`[data-testid="${await unpicked.first().getAttribute("data-testid")}"]`);
  const secondLang = await second.getAttribute("data-lang");
  await second.locator(".new-hit").click({ modifiers: [multi] });
  await page.locator('[data-testid^="assign-link-"]').nth(1).waitFor({ timeout: T });
  check("Ctrl+click adds a second sentence", (await page.locator('[data-testid^="assign-link-"]').count()) >= 2);
  check(
    "a sentence in another language is not locked",
    !rowLangs.includes(secondLang) && (await second.getAttribute("data-state")) === "picked",
    `row ${rowLangs.join("+")}, picked ${secondLang}`,
  );
  await takeShot("sop-assign-link.png");
  // 첫 줄만 다시 누르면 고름이 그 문장(과 New 짝)으로 돌아간다 - 둘째의 짝이 함께 붙었을 수 있어 Ctrl로 하나씩 빼지 않는다
  await firstLine.locator(".new-hit").click();
  const linkedId = (await firstLine.getAttribute("data-testid")).replace("assign-new-", "");
  const readSources = async () => {
    const response = await page.request.get(`${BASE}/api/bundles/${halfBundleId}/written-sentences`, { headers: { "X-Dev-User": "qa.member" } });
    return ((await response.json()).find((row) => String(row.target_id) === linkedId)?.source_unit_ids ?? []).length;
  };
  const sourcesBefore = await readSources();
  // 앞 단계의 토스트가 아직 떠 있을 수 있다 - 저장 응답을 기다린다
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  const savedResponse = await saved;
  check("the link saves", savedResponse.ok(), savedResponse.ok() ? "" : (await savedResponse.text()).slice(0, 300));
  await page.waitForLoadState("networkidle");
  check("linking to a written sentence adds the Old source", (await readSources()) > sourcesBefore, String(sourcesBefore));
  // 문서별 확대 - Old 위에서 Ctrl+휠, New는 그대로
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await wait(page, "assign-new-zoom-value");
  const oldZoom = await getText(page, "assign-old-zoom-value");
  const newZoom = await getText(page, "assign-new-zoom-value");
  await page.locator('[data-testid="assign-old"] .pane-body').hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await page.waitForFunction((value) => document.querySelector('[data-testid="assign-old-zoom-value"]')?.textContent !== value, oldZoom, { timeout: T });
  check("Ctrl+wheel zooms only the hovered document", (await getText(page, "assign-new-zoom-value")) === newZoom);
  const width = await page.locator('[data-testid="assign-divider"]').getAttribute("aria-valuenow");
  await page.locator('[data-testid="assign-divider"]').focus();
  await page.keyboard.press("ArrowRight");
  check("the divider moves with the arrow keys", (await page.locator('[data-testid="assign-divider"]').getAttribute("aria-valuenow")) !== width);
  // 출처 없는 New - 신규로 표시
  await page.locator('[data-testid="assign-filter-unsourced"]').click();
  await wait(page, "assign-mark-new");
  await page.locator('[data-testid="assign-mark-new"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  check("an unsourced New sentence is marked new", true);
});

// 끌어서 잇기(끌어다 놓기 설계 §6, 2걸음) - Old 조각을 이미 쓴 New 문장에 놓으면 클릭으로 이을 때와 같은 상태(그 줄 고름 · 그 문장 고름 · 그 자리 메뉴)가 되고 저장은 하지 않는다.
// 마우스는 걸음으로 움직인다(dragTo는 쓰지 않는다). 저장하지 않으므로 되돌릴 것이 없다
await runStep("assign: drag an Old piece onto a written New sentence, it links like a click", {}, async ({ page, takeShot }) => {
  await installCommitCounter(page);
  const headers = { "X-Dev-User": "qa.member" };
  const readUnits = async () => (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/units?limit=1000`, { headers })).json()).items;
  const written = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/written-sentences`, { headers })).json();
  const writtenDocIds = [...new Set(written.map((row) => row.target_doc_id))];
  const composedDocIds = (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/tobe`, { headers })).json()).docs.filter((doc) => doc.entrance === "assign").map((doc) => doc.id);
  // 짝 없는 미배정 문장 - 줄 하나가 Unit 하나다
  const loose = new Map((await readUnits()).filter((unit) => unit.status === "unassigned" && unit.kind === "sentence" && unit.pair_id === null).map((unit) => [unit.unit_id, unit]));
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  const shownIds = await page.locator('[data-pane="old"] .strip[data-strip-unit]').evaluateAll((els) => els.map((el) => Number(el.dataset.stripUnit)));
  const [aId, bId] = shownIds.filter((id) => loose.has(id));
  check("the Old paper shows two loose unassigned sentences", aId !== undefined && bId !== undefined, `${aId} ${bId}`);
  const pieceOf = (id) => page.locator(`[data-testid="assign-paper-piece-${id}"]`);
  const centre = (selector) => page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  // 조각 글의 첫 글줄 위 한 점 - 앞머리·배지·줄 끝 표시를 비켜 글 위를 누른다
  const pointInUnit = async (id) => {
    await centre(`[data-testid="assign-paper-piece-${id}"]`);
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  };
  const pointInLine = async (id) => {
    await centre(`[data-testid="assign-new-${id}"]`);
    await page.waitForTimeout(150);
    const box = await page.locator(`[data-testid="assign-new-${id}"] .new-hit`).boundingBox();
    return { x: box.x + Math.min(60, box.width / 2), y: box.y + box.height / 2 };
  };
  const newPane = page.locator('[data-testid="assign-new"]');
  const openNewDoc = async (docId) => {
    if ((await newPane.getAttribute("data-doc")) === String(docId)) return;
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${docId}"]`).click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-new"]')?.getAttribute("data-doc") === String(id), docId, { timeout: T });
  };
  const readMarks = () => page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid="drag-card"]').length,
    lines: document.querySelectorAll("svg[data-drag-line]").length,
    drops: document.querySelectorAll("[data-drop]").length,
    srcs: document.querySelectorAll("[data-drag-src]").length,
  }));
  const isPressed = async (id) => (await page.locator(`[data-testid="assign-new-pick-${id}"]`).getAttribute("aria-pressed")) === "true";
  const menu = page.locator('[data-testid="assign-link-menu"]');

  // 1. 다른 줄을 먼저 골라 둔다 - 끄는 줄은 지금 고른 줄이 아니다
  const aPoint = await pointInUnit(aId);
  await page.mouse.click(aPoint.x, aPoint.y);
  await page.waitForLoadState("networkidle");
  check("clicking a piece picks its row first", (await pieceOf(aId).getAttribute("data-sel")) === "");
  await newPane.waitFor({ timeout: T });
  const shownDoc = Number(await newPane.getAttribute("data-doc"));
  await openNewDoc(writtenDocIds.includes(shownDoc) ? shownDoc : writtenDocIds[0]);
  const tId = Number(await page.locator('[data-testid="assign-new"] .pg:not([data-read-only]) .new-line[data-target]:not([data-state="picked"])').first().getAttribute("data-target"));

  // 2. 끄는 동안 - 표 한 장, 놓을 문장 테두리와 표의 메모, 따라오는 점선, 흐린 출발 조각
  const from = await pointInUnit(bId);
  const onto = await pointInLine(tId);
  await dragThrough(page, from, [onto]);
  await page.waitForTimeout(100);
  const during = await page.evaluate(({ b, t }) => ({
    card: document.querySelector('[data-testid="drag-card"]')?.textContent ?? null,
    note: document.querySelector('[data-testid="drag-card"] .drag-card-note')?.textContent ?? "",
    drop: document.querySelector(`[data-testid="assign-new-${t}"]`)?.getAttribute("data-drop") ?? null,
    line: document.querySelector("svg[data-drag-line] path")?.getAttribute("d") ?? "",
    src: document.querySelector(`[data-testid="assign-paper-piece-${b}"]`)?.hasAttribute("data-drag-src") ?? false,
  }), { b: bId, t: tId });
  check("dragging an Old piece shows a card with its unit id", during.card !== null && during.card.includes(loose.get(bId).display_id), during.card);
  check("over a written sentence the line is marked and the card says link", during.drop === "over" && during.note === "Link to this sentence", JSON.stringify({ drop: during.drop, note: during.note }));
  check("a draft line follows from the piece", during.line.length > 0);
  check("the dragged piece stays dimmed in place", during.src);
  await takeShot("sop-assign-drag-link.png");
  // 3. 문장 위를 여러 걸음 지나도 React는 다시 그리지 않는다(G11)
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  for (let i = 0; i < 12; i += 1) await page.mouse.move(onto.x + (i % 4) * 6, onto.y + (i % 3) - 1);
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit while dragging over a sentence", commitsBefore > 0 && commitsBefore === commitsAfter, `${commitsBefore} -> ${commitsAfter}`);

  // 4. 놓으면 클릭과 같은 상태 - 끈 줄을 고르고 그 문장을 고르고 그 자리 메뉴(저장 전), 끌기 표시는 모두 치운다
  // 놓은 뒤 뒤따르는 click이 그 문장 단추에 닿아 고름을 다시 뒤집지 않는지 - 놓은 뒤 그 단추의 aria-pressed가 바뀐 값을 모두 적는다
  await page.evaluate((t) => {
    window.__pressFlips = [];
    new MutationObserver((records) => {
      for (const record of records) if (record.target.getAttribute("data-testid") === `assign-new-pick-${t}`) window.__pressFlips.push(record.target.getAttribute("aria-pressed"));
    }).observe(document.querySelector('[data-testid="assign-new"]'), { attributes: true, subtree: true, attributeFilter: ["aria-pressed"] });
  }, tId);
  await page.mouse.up();
  await menu.waitFor({ timeout: T });
  check("dropping picks the dragged row", (await pieceOf(bId).getAttribute("data-sel")) === "" && (await pieceOf(aId).getAttribute("data-sel")) === null);
  check("dropping picks the sentence", await isPressed(tId));
  check("the in-place menu opens, not saved yet", (await page.locator('[data-testid="assign-link-menu-unsaved"]').count()) === 1);
  const marks = await readMarks();
  check("the drag leaves no marks behind", marks.cards + marks.lines + marks.drops + marks.srcs === 0, JSON.stringify(marks));
  // 5. 저장하지 않았다
  check("dropping saves nothing", (await readUnits()).find((unit) => unit.unit_id === bId)?.status === "unassigned");
  // 메뉴 자리 - 늦게 뜨는 움직임이 끝나고 이음 선 끝에 맞춘 뒤의 자리(style의 top·left)
  const readMenuPlace = async () => {
    await page.waitForTimeout(900);
    return menu.evaluate((el) => ({ top: parseFloat(el.style.top), left: parseFloat(el.style.left) }));
  };
  const dropPlace = await readMenuPlace();
  const pressFlips = await page.evaluate(() => window.__pressFlips);
  check("the click after a drop does not flip the pick back", (await isPressed(tId)) && pressFlips.length === 1 && pressFlips[0] === "true", JSON.stringify(pressFlips));
  // 6. 메뉴의 Cancel이 고름을 거둔다(클릭으로 고른 때와 같다)
  await page.locator('[data-testid="assign-link-menu-cancel"]').click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-new-pick-${id}"]`)?.getAttribute("aria-pressed") === "false", tId, { timeout: T });
  check("Cancel in the menu drops the pick", !(await isPressed(tId)));
  // 놓은 뒤의 메뉴는 그 문장을 같은 자리에서 눌렀을 때와 같은 곳(이음 선 끝)에 뜬다 - 끈 줄은 고른 채다
  check("the dragged row stays picked after Cancel", (await pieceOf(bId).getAttribute("data-sel")) === "");
  // 놓은 뒤·Cancel 뒤에 New 칸이 굴렀을 수 있다 - 낡은 좌표를 누르면 같은 문장의 다른 점이라 메뉴 자리가 다르다. 그 문장을 다시 가운데 두고 같은 점을 누른다
  const ontoNow = await pointInLine(tId);
  await page.mouse.click(ontoNow.x, ontoNow.y);
  await menu.waitFor({ timeout: T });
  const clickPlace = await readMenuPlace();
  check("the menu after a drop opens where a click on that sentence opens it", Math.abs(dropPlace.top - clickPlace.top) <= 2 && Math.abs(dropPlace.left - clickPlace.left) <= 2, `drop ${JSON.stringify(dropPlace)} click ${JSON.stringify(clickPlace)}`);
  await page.locator('[data-testid="assign-link-menu-cancel"]').click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-new-pick-${id}"]`)?.getAttribute("aria-pressed") === "false", tId, { timeout: T });

  // 7. Esc - 끄다가 문장 위에서 취소하면 표가 사라지고 아무것도 고르지 않는다
  await dragThrough(page, await pointInUnit(bId), [await pointInLine(tId)]);
  await page.waitForTimeout(100);
  const overBeforeEsc = await page.locator(`[data-testid="assign-new-${tId}"]`).getAttribute("data-drop");
  await page.keyboard.press("Escape");
  const afterEsc = await readMarks();
  await page.mouse.up();
  await page.waitForTimeout(600);
  check("Esc cancels the drag over a sentence", overBeforeEsc === "over" && afterEsc.cards + afterEsc.lines + afterEsc.drops + afterEsc.srcs === 0, JSON.stringify(afterEsc));
  check("a cancelled drag picks nothing and opens no menu", !(await isPressed(tId)) && (await menu.count()) === 0);

  // 9. 클릭은 그대로 - 움직이지 않고 누르면 표 없이 그 줄을 고른다
  const press = await pointInUnit(aId);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  const cardsOnPress = await page.locator('[data-testid="drag-card"]').count();
  await page.mouse.up();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-sel"), aId, { timeout: T });
  check("a press without moving still picks the row, with no card", cardsOnPress === 0 && (await page.locator('[data-testid="drag-card"]').count()) === 0);
  // 끌기를 쓴 뒤에도 두 번 누르기는 그 조각에 나눌 자리를 세운다(4px 안의 누름은 지금의 클릭이다) - 글 가운데를 두 번 누르고 Esc로 거둔다
  const twice = await page.locator(`[data-testid="assign-paper-unit-${aId}"]`).first().evaluate((el) => {
    const rect = el.getClientRects()[0];
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.dblclick(twice.x, twice.y);
  // 나눌 자리 표시(.cut-anchor)는 폭이 0이라 "보임"이 아니다 - 붙었는지만 본다
  const cutShown = await page.locator(`[data-testid="assign-paper-piece-${aId}"] .cut-anchor`).waitFor({ state: "attached", timeout: 4000 }).then(() => true, () => false);
  check("after a drag, a double press still sets a cut in the Old piece", cutShown && (await page.locator('[data-testid="drag-card"]').count()) === 0);
  await page.keyboard.press("Escape");
  await page.locator('[data-pane="old"] .cut-anchor').first().waitFor({ state: "detached", timeout: T });

  // 8. 아직 쓰지 않은 문서 - 그 문장 위에는 놓을 자리가 없고 놓아도 아무 일도 없다(3걸음에서 보내기로 놓인다)
  let composedLine = null;
  for (const docId of composedDocIds) {
    await openNewDoc(docId);
    const line = page.locator('[data-testid="assign-new"] .pg[data-read-only] .new-line[data-target]').first();
    if (await line.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
      composedLine = Number(await line.getAttribute("data-target"));
      break;
    }
  }
  check("an unwritten New document with sentences opens", composedLine !== null, composedDocIds.join(","));
  await centre(`[data-testid="assign-new-${composedLine}"]`);
  const composedBox = await page.locator(`[data-testid="assign-new-${composedLine}"]`).boundingBox();
  await dragThrough(page, await pointInUnit(bId), [{ x: composedBox.x + Math.min(60, composedBox.width / 2), y: composedBox.y + composedBox.height / 2 }]);
  await page.waitForTimeout(100);
  const overComposed = await readMarks();
  await page.mouse.up();
  await page.waitForTimeout(600);
  check("a sentence of an unwritten document takes no drop yet", overComposed.cards === 1 && overComposed.drops === 0, JSON.stringify(overComposed));
  check("dropping there does nothing", (await menu.count()) === 0 && (await pieceOf(aId).getAttribute("data-sel")) === "" && (await pieceOf(bId).getAttribute("data-sel")) === null);

  // 놓자마자 j로 다음 줄로 옮기면 늦게 온 관계 묶음이 옮겨 간 줄에 잇기를 적용하지 않는다 - 끈 줄의 묶음 응답을 늦춰 경주를 정해 둔다
  await openNewDoc(written.find((row) => row.target_id === tId).target_doc_id);
  const lateGroup = `**/groups/by-unit/${bId}`;
  await page.route(lateGroup, async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await dragThrough(page, await pointInUnit(bId), [await pointInLine(tId)]);
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.keyboard.press("j");
  await page.waitForTimeout(2500);
  await page.unroute(lateGroup);
  // 옮겨 간 줄의 추천 문서가 다르면 New 칸이 그 문서로 넘어가 놓았던 문장이 없다 - 없으면 골라지지 않은 것이다
  const isShownPressed = async (id) => (await page.locator(`[data-testid="assign-new-pick-${id}"]`).count()) > 0 && (await isPressed(id));
  const afterSwitch = { menu: await menu.count(), pressed: await isShownPressed(tId), dragged: (await pieceOf(bId).getAttribute("data-sel")) !== null, picked: await page.locator('[data-testid="assign-new"] .new-line[data-state="picked"]').count() };
  check("a drop is let go when another row is picked before its group arrives", afterSwitch.menu === 0 && !afterSwitch.pressed && !afterSwitch.dragged && afterSwitch.picked === 0, JSON.stringify(afterSwitch));

  // 놓은 뒤 ↵가 저장한다(메뉴의 Confirm과 같다) - 앞 확인들이 쓰지 않는 셋째 미배정 문장을 다른 문장에 놓는다(New 칸이 넘어갔으면 놓았던 문서로 되돌린다)
  await openNewDoc(written.find((row) => row.target_id === tId).target_doc_id);
  // 참조 줄(REF)은 번호를 받기 전에는 확정되지 않는다 - 시드에 따라 셋째 미배정 문장이 참조 줄일 수 있어 건너뛰고, 없으면 저장하지 않은 첫 문장(aId - 뒤에서 쓰지 않는다)
  const refIds = new Set(await page.locator('[data-pane="old"] [data-lang="ref"][data-testid^="assign-paper-lang-"]').evaluateAll((els) => els.map((el) => Number(el.dataset.testid.replace("assign-paper-lang-", "")))));
  const cId = shownIds.filter((id) => loose.has(id)).slice(2).find((id) => !refIds.has(id)) ?? aId;
  const confirmTarget = Number(await page.locator(`[data-testid="assign-new"] .pg:not([data-read-only]) .new-line[data-target]:not([data-target="${tId}"]):not([data-state="picked"])`).first().getAttribute("data-target"));
  check("the Old paper shows a third loose unassigned sentence", cId !== undefined, String(cId));
  await dragThrough(page, await pointInUnit(cId), [await pointInLine(confirmTarget)]);
  await page.waitForTimeout(100);
  await page.mouse.up();
  await menu.waitFor({ timeout: T });
  await page.waitForTimeout(400);
  const savedByEnter = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.keyboard.press("Enter");
  const enterResponse = await savedByEnter;
  await page.waitForLoadState("networkidle");
  const confirmedUnit = (await readUnits()).find((unit) => unit.unit_id === cId);
  check("Enter after a drop saves the link", enterResponse.ok() && confirmedUnit?.status !== "unassigned" && (confirmedUnit?.target_ids ?? []).includes(confirmTarget), JSON.stringify({ status: confirmedUnit?.status, targets: confirmedUnit?.target_ids, confirmTarget }));

  // 10. 올려 둔 강조는 끄는 동안 되살아나지 않는다(G10) - 이어진 조각에 올려 맞은편 강조를 켠 채 끌고, 끄는 동안 New 칸을 굴려 이음 선이 다시 그려지게 한다.
  // 이어진 조각은 앞 단계가 같은 글로 확정한 Old 문서에 있다 - 그 문서를 연다(고른 줄이 풀리므로 맨 끝에)
  const writtenIds = new Set(written.map((row) => row.target_id));
  const linked = (await readUnits()).find((unit) => unit.target_ids.some((id) => writtenIds.has(id)));
  check("a piece is linked to a written sentence", linked !== undefined);
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${linked.document_id}"]`).click();
  await pieceOf(linked.unit_id).waitFor({ timeout: T });
  const partner = written.find((row) => linked.target_ids.includes(row.target_id));
  await openNewDoc(partner.target_doc_id);
  await centre(`[data-testid="assign-new-${partner.target_id}"]`);
  const linkedPoint = await pointInUnit(linked.unit_id);
  await page.mouse.move(linkedPoint.x, linkedPoint.y);
  await page.waitForTimeout(300);
  const hoverMarks = await page.locator(".assign-panes [data-link-hover]").count();
  const paneBox = await page.locator('[data-testid="assign-new"] .pane-body').boundingBox();
  await dragThrough(page, linkedPoint, [{ x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height / 2 }]);
  // 창 폭을 바꾸면 이음 선을 다시 재어 그린다(New 문서가 짧으면 굴릴 것이 없다)
  const commitsBeforeRedraw = await page.evaluate(() => window.__commits ?? -1);
  await page.setViewportSize({ width: 1180, height: 720 });
  await page.waitForTimeout(500);
  const redrew = (await page.evaluate(() => window.__commits ?? -1)) > commitsBeforeRedraw;
  const leaked = await page.evaluate(() => ({
    card: document.querySelectorAll('[data-testid="drag-card"]').length,
    marks: document.querySelectorAll(".assign-panes [data-link-hover], .assign-panes [data-link-hot]").length,
  }));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("hovering a linked piece marks the sentence it links to", hoverMarks > 0, String(hoverMarks));
  check("no link highlight while dragging, even after the lines redraw", redrew && leaked.card === 1 && leaked.marks === 0, JSON.stringify({ redrew, ...leaked }));
  await page.setViewportSize(VIEWPORT);

  // 11. 들림(G9) - 한/영 짝 카드는 한 장으로 끌리니 아래 줄에 올려도 카드 전체가 고리 하나로 들린다(윗줄은 네 변, 아래 줄은 위 변 없이).
  // 엿보기 조각(필터 밖, 점선 테두리)은 들지 않는다 - 점선 바로 바깥에 실선 고리가 겹친다. 값은 계산된 box-shadow로 본다(고리 = 퍼짐 1px)
  const readShadow = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).boxShadow);
  // 짝이 있는 Old 문서를 모두 보이게 연다
  let pairDoc = null;
  for (const doc of (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json()).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${doc.id}/view`, { headers })).json();
    if (view.pairs.length > 0) {
      pairDoc = { id: doc.id, unitId: view.pairs[0].unit_ids[0] };
      break;
    }
  }
  await page.locator('[data-testid="assign-filter-all"]').click();
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${pairDoc.id}"]`).click();
  await pieceOf(pairDoc.unitId).waitFor({ timeout: T });
  const cardRows = page.locator('[data-pane="old"] .strip-card > .strip-row > .strip[data-drag-box]');
  check("the Old document shows a KO/EN pair card", (await cardRows.count()) >= 2);
  const cardTop = await cardRows.first().evaluate((el) => el.dataset.testid);
  const cardBottom = await cardRows.first().evaluate((el) => [...el.closest(".strip-card").querySelectorAll(":scope > .strip-row > .strip")].at(-1).dataset.testid);
  await centre(`[data-testid="${cardTop}"]`);
  await page.waitForTimeout(150);
  const bottomBox = await page.locator(`[data-testid="${cardBottom}"]`).boundingBox();
  await page.mouse.move(bottomBox.x + 40, bottomBox.y + bottomBox.height / 2);
  await page.waitForTimeout(300);
  const lift = { top: await readShadow(`[data-testid="${cardTop}"]`), bottom: await readShadow(`[data-testid="${cardBottom}"]`) };
  check("hovering a pair card's lower row lifts the whole card with one ring", lift.top.includes("0px 0px 0px 1px") && !lift.bottom.includes("0px 0px 0px 1px") && lift.bottom.includes("0px 1px 0px 0px"), JSON.stringify(lift));
  // 다른 상태 거르기 - 접힌 줄이 생기는 필터를 고르고 접힌 줄 하나를 엿보기로 연다
  for (const filter of ["unassigned", "on_hold", "confirmed"]) {
    if ((await page.locator('[data-pane="old"] .fold-line').count()) > 0) break;
    await page.locator(`[data-testid="assign-filter-${filter}"]`).click();
    await page.waitForTimeout(300);
  }
  await page.locator('[data-pane="old"] .fold-line').first().click();
  const peek = page.locator('[data-pane="old"] .strip-row[data-peek] > .strip[data-drag-box]').first();
  await peek.waitFor({ timeout: T });
  await peek.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const peekBox = await peek.boundingBox();
  await page.mouse.move(peekBox.x + 40, peekBox.y + peekBox.height / 2);
  await page.waitForTimeout(300);
  const peekShadow = await peek.evaluate((el) => getComputedStyle(el).boxShadow);
  check("a peek piece does not lift over its dashed border", peekShadow === "none", peekShadow);
});

// 끌기 상자 위의 글자 고르기(끌어다 놓기 G3·G12) - 긁어 둔 글자가 남아도 Old 조각의 클릭·Shift+클릭은 그대로이고, Alt를 누르는 동안은 글자 커서다.
// 표 칸 조각을 끌면 표 줄 전체가 끌린다(칸 Unit은 표에 묶여 제 줄이 없다). 저장하지 않는다
await runStep("assign: a text selection does not deaden clicks on Old pieces, Alt shows a text cursor, a table drags from its cells", {}, async ({ page }) => {
  const headers = { "X-Dev-User": "qa.member" };
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-filter-all"]').click();
  await page.locator('[data-pane="old"] .strip[data-strip-unit]').first().waitFor({ timeout: T });
  // 짝 없는(줄 하나가 Unit 하나인) 글 조각 셋, 글이 넉넉한 것(조각의 Unit 번호)
  const single = (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/units?limit=1000`, { headers })).json()).items.filter((unit) => unit.pair_id === null).map((unit) => unit.unit_id);
  const pieces = await page.locator('[data-pane="old"] .strip[data-kind="piece"][data-drag-box]').evaluateAll((els, ids) => els.filter((el) => ids.includes(Number(el.dataset.stripUnit)) && (el.querySelector(".su")?.textContent ?? "").length > 30).slice(0, 3).map((el) => Number(el.dataset.stripUnit)), single);
  check("the Old paper shows three text pieces", pieces.length === 3, JSON.stringify(pieces));
  const [aId, bId, cId] = pieces;
  const pointIn = async (id, part = 0.5) => {
    await page.locator(`[data-testid="assign-paper-piece-${id}"]`).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    return page.locator(`[data-testid="assign-paper-unit-${id}"]`).first().evaluate((el, at) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + Math.max(4, rect.width * at), y: rect.top + rect.height / 2 };
    }, part);
  };
  const isSelected = (id) => page.evaluate((unit) => document.querySelector(`[data-testid="assign-paper-piece-${unit}"]`)?.hasAttribute("data-sel") ?? false, id);
  const isCollapsed = () => page.evaluate(() => window.getSelection()?.isCollapsed ?? true);

  // Alt를 누르는 동안 글자 커서, 떼면(고른 글자 없음) 손가락
  const aStart = await pointIn(aId, 0);
  await page.mouse.move(aStart.x + 20, aStart.y);
  await page.keyboard.down("Alt");
  await page.waitForTimeout(100);
  const altCursor = await page.locator(`[data-testid="assign-paper-unit-${aId}"]`).first().evaluate((el) => getComputedStyle(el).cursor);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(100);
  const restCursor = await page.locator(`[data-testid="assign-paper-unit-${aId}"]`).first().evaluate((el) => getComputedStyle(el).cursor);
  check("holding Alt shows a text cursor on an Old piece, and a pointer again after", altCursor === "text" && restCursor === "pointer", `${altCursor} -> ${restCursor}`);

  // Alt로 A의 글자를 긁는다 - 글자로 새 Unit 막대가 뜬다
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(aStart.x + 140, aStart.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await wait(page, "assign-carve");
  check("Alt+drag selects text in an Old piece", !(await isCollapsed()));
  // 그냥 B를 누르면 B의 줄을 고르고 긁은 글자와 막대는 사라진다
  const bPoint = await pointIn(bId);
  await page.mouse.click(bPoint.x, bPoint.y);
  await page.waitForTimeout(600);
  const afterClick = { picked: await isSelected(bId), carve: await page.locator('[data-testid="assign-carve"]').count(), collapsed: await isCollapsed() };
  check("a plain click on another Old piece after selecting text picks its row", afterClick.picked && afterClick.carve === 0 && afterClick.collapsed, JSON.stringify(afterClick));
  // 화면 다른 곳에 고른 글자가 있어도 Shift+클릭은 줄을 더한다
  await page.evaluate(() => window.getSelection()?.selectAllChildren(document.querySelector('[data-testid="assign-bar"]')));
  const selectedElsewhere = !(await isCollapsed());
  const cPoint = await pointIn(cId);
  await page.keyboard.down("Shift");
  await page.mouse.click(cPoint.x, cPoint.y);
  await page.keyboard.up("Shift");
  const bulk = await page.locator('[data-testid="assign-bulk"]').waitFor({ timeout: 4000 }).then(() => true, () => false);
  check("with text selected elsewhere, Shift+click on an Old piece still adds its row", selectedElsewhere && bulk, JSON.stringify({ selectedElsewhere, bulk }));
  await page.keyboard.press("Escape");

  // 표 칸 조각을 끌면 표 줄 전체 - 표 Unit 번호의 표, 표 조각이 흐려지고, 이미 쓴 문장 위에서 놓을 자리가 된다
  let table = null;
  for (const doc of (await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json()).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${doc.id}/view`, { headers })).json();
    const unit = view.units.find((item) => item.kind === "table");
    if (unit) {
      table = { docId: doc.id, unit };
      break;
    }
  }
  check("the bundle has an Old table", table !== null);
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${table.docId}"]`).click();
  const cell = page.locator(`[data-testid="assign-paper-piece-${table.unit.id}"] .cell-piece .su`).first();
  await cell.waitFor({ timeout: T });
  // New 칸을 열고 이미 쓴 문서를 띄운다
  const firstText = await pointIn(await page.locator('[data-pane="old"] .strip[data-kind="piece"][data-drag-box]').first().getAttribute("data-strip-unit"));
  await page.mouse.click(firstText.x, firstText.y);
  const written = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/written-sentences`, { headers })).json();
  const newPane = page.locator('[data-testid="assign-new"]');
  await newPane.waitFor({ timeout: T });
  const shownNewDoc = await newPane.getAttribute("data-doc");
  if (!written.some((row) => String(row.target_doc_id) === shownNewDoc)) {
    await page.locator('[data-testid="assign-new-doc"]').click();
    await page.locator(`[data-testid="assign-new-doc-option-${written[0].target_doc_id}"]`).click();
  }
  const line = page.locator('[data-testid="assign-new"] .pg:not([data-read-only]) .new-line[data-target] .new-hit').first();
  await line.waitFor({ timeout: T });
  await cell.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const cellBox = await cell.boundingBox();
  const lineBox = await line.boundingBox();
  await dragThrough(page, { x: cellBox.x + 4, y: cellBox.y + cellBox.height / 2 }, [{ x: lineBox.x + 40, y: lineBox.y + lineBox.height / 2 }]);
  await page.waitForTimeout(100);
  const tableDrag = await page.evaluate((id) => ({
    card: document.querySelector('[data-testid="drag-card"] .drag-card-id')?.textContent ?? null,
    src: document.querySelector(`[data-testid="assign-paper-piece-${id}"]`)?.hasAttribute("data-drag-src") ?? false,
    over: document.querySelectorAll('[data-pane="new"] [data-drop="over"]').length,
    line: document.querySelector("svg[data-drag-line] path")?.getAttribute("d") ? true : false,
  }), table.unit.id);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  check("dragging a table cell piece drags the whole table row", tableDrag.card === table.unit.display_id && tableDrag.src && tableDrag.over === 1 && tableDrag.line, JSON.stringify(tableDrag));
});

// 한 언어만 잇기(v0.11.1) - Old는 한/영 짝인데 쓴 New에는 한 언어만 있는 예외. 있는 언어만 이어 확정하면 서버가 같은 저장 안에서
// 짝을 풀고(release_unit_ids - 화면이 짝 풀기를 따로 부르지 않는다) 남은 문장이 제 줄이 되어 사람이 삭제(Remark)나 보류로 끝낸다
await runStep("assign: a one-language link on a KO/EN pair row unpairs it and leaves the other sentence open", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  // 둘 다 판단이 없는 한/영 짝 가운데 한 언어에만 New 후보가 있고, 그 New 문장에 다른 언어 짝이 없는 것
  const written = new Map((await getJson("/written-sentences")).map((row) => [row.target_id, row]));
  let found = null;
  for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${doc.id}/view`);
    const unitOf = new Map(view.units.map((unit) => [unit.id, unit]));
    for (const pair of view.pairs) {
      const members = pair.unit_ids.map((id) => unitOf.get(id));
      if (members.length !== 2 || members.some((unit) => !unit || unit.status !== "unassigned")) continue;
      const candidates = [];
      for (const unit of members) candidates.push((await getJson(`/units/${unit.id}/new-candidates`)).filter((item) => written.get(item.target_id)?.partner_target_id == null));
      const linkedAt = candidates.findIndex((list) => list.length > 0);
      if (linkedAt === -1 || candidates[1 - linkedAt].length > 0) continue;
      found = { docId: doc.id, pairId: pair.id, linked: members[linkedAt], leftover: members[1 - linkedAt], targetId: candidates[linkedAt][0].target_id };
      break;
    }
    if (found) break;
  }
  check("the synthetic bundle has a pair with a one-language New candidate", found !== null);
  if (!found) return;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-pick-prompt");
  await selectRowById(page, found.linked.display_id);
  check("the row holds both languages", (await rowIds(page)).includes(found.leftover.display_id), await rowIds(page));
  const line = page.locator(`[data-testid="assign-new-pick-${found.targetId}"]`);
  await line.waitFor({ timeout: T });
  await line.click();
  await wait(page, "assign-link-leftover");
  check("the chosen box names the sentence it leaves out", (await getText(page, "assign-link-leftover")).includes(found.leftover.display_id));
  await takeShot("sop-assign-link-leftover.png");
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  const pairDeletes = [];
  const countPairDelete = (request) => {
    if (request.method() === "DELETE" && request.url().includes("/pairs/")) pairDeletes.push(request.url());
  };
  page.on("request", countPairDelete);
  await page.locator('[data-testid="assign-primary"]').click();
  const savedResponse = await saved;
  check("the one-language link saves", savedResponse.ok(), savedResponse.ok() ? "" : (await savedResponse.text()).slice(0, 300));
  const savedBody = savedResponse.ok() ? await savedResponse.json() : {};
  check("the save sends the leftover and the server dissolves the pair", JSON.parse(savedResponse.request().postData() ?? "{}").release_unit_ids?.includes(found.leftover.id) && (savedBody.pairs_dissolved ?? []).includes(found.pairId), JSON.stringify(savedBody.pairs_dissolved));
  // 남은 문장이 제 줄로 골라진다 - 다음 줄로 넘어가지 않는다
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, found.leftover.display_id, { timeout: T });
  check("the leftover sentence is picked as its own open row", (await rowStatus(page)) === "Unassigned", await rowStatus(page));
  page.off("request", countPairDelete);
  check("the screen sends no separate unpair request", pairDeletes.length === 0, pairDeletes.join(", "));
  await takeShot("sop-assign-link-leftover-row.png");
  const readUnits = async () => new Map((await getJson("/units?limit=1000")).items.map((unit) => [unit.unit_id, unit]));
  let units = await readUnits();
  const stateOf = (unit) => `${units.get(unit.id)?.status}/${units.get(unit.id)?.pair_id}`;
  check("the linked sentence is confirmed and the other stays open, both unpaired", stateOf(found.linked) === "confirmed/null" && stateOf(found.leftover) === "unassigned/null", `${stateOf(found.linked)} ${stateOf(found.leftover)}`);
  const events = await getJson("/events?limit=5");
  check("history records the unpair", events.some((event) => event.action === "pair.delete" && event.target_ids.includes(found.pairId)));
  // 사람이 삭제(사유)로 끝낸다
  if ((await page.locator('[data-testid="assign-pick-delete"]').count()) === 0) await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-delete"]').click();
  await page.locator('[data-testid="assign-reason-edit"]').click();
  await page.locator('[data-testid="assign-remark-modal-text"]').fill("No counterpart in the new document");
  await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  const closed = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  const closedResponse = await closed;
  check("the leftover closes with Deleted and a reason", closedResponse.ok(), closedResponse.ok() ? "" : (await closedResponse.text()).slice(0, 300));
  await page.waitForLoadState("networkidle");
  units = await readUnits();
  check("the leftover sentence is confirmed", units.get(found.leftover.id)?.status === "confirmed", units.get(found.leftover.id)?.status);
});

// 그 자리 메뉴·고른 표시(v0.13) - 한/영 짝 줄에서 추천을 누르면(New도 한/영 짝이면 짝 문장까지 골라져) 카드에 고른 표시와 "저장 안 됨"이 보이고,
// 누른 곳 옆 메뉴의 Confirm(↵)으로 저장된다. 저장한 줄의 "→ 간 곳"과 New의 "← 출처"는 맞은편으로 가서 끊기 메뉴를 띄운다.
// 합성 묶음의 OLD-6 한/영 짝 줄 → WI-05 한/영 짝 문장이 이 길이다. 한/영 짝 New 후보가 없는 자료면 한 언어로 잇는다(짝 비교는 assign-model 단위 시험도 본다)
await runStep("assign: KO/EN pair - recommendation shows picked, in-place menu confirms, links navigate", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  // 둘 다 판단이 없는 한/영 짝 가운데 New 후보가 있는 것 - New 쪽도 한/영 짝인 후보를 먼저 찾는다
  const written = new Map((await getJson("/written-sentences")).map((row) => [row.target_id, row]));
  let found = null;
  let fallback = null;
  for (const doc of (await getJson("/documents")).filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await getJson(`/documents/${doc.id}/view`);
    const unitOf = new Map(view.units.map((unit) => [unit.id, unit]));
    for (const pair of view.pairs) {
      const members = pair.unit_ids.map((id) => unitOf.get(id));
      if (members.length !== 2 || members.some((unit) => !unit || unit.status !== "unassigned")) continue;
      const langs = new Set(members.map((unit) => unit.lang));
      const tops = [];
      for (const unit of members) tops.push((await getJson(`/units/${unit.id}/new-candidates`))[0]?.target_id ?? null);
      for (const [index, unit] of members.entries()) {
        const targetId = tops[index];
        if (targetId === null) continue;
        if (!fallback) fallback = { unit, other: members[1 - index], targetId, partnerId: null };
        // 두 언어의 첫 후보가 서로 New 짝이어야 한다 - 글자 2-gram은 언어 끝말만 같아도 먼 문장을 후보로 올린다(합성 OLD-6 → WI-05)
        const partnerId = written.get(targetId)?.partner_target_id ?? null;
        const partner = written.get(partnerId ?? -1);
        if (partner && langs.has(partner.lang) && partner.lang !== unit.lang && tops[1 - index] === partnerId) {
          found = { unit, other: members[1 - index], targetId, partnerId };
          break;
        }
      }
      if (found) break;
    }
    if (found) break;
  }
  found ??= fallback;
  check("the synthetic bundle has a KO/EN pair row with a New candidate", found !== null);
  check("the candidate is a KO/EN New pair (OLD-6 → WI-05)", found?.partnerId != null);
  if (!found) return;
  console.log(`  (New pair candidate: ${found.partnerId !== null ? "yes" : "no - one-language link"})`);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-pick-prompt");
  await selectRowById(page, found.unit.display_id);
  const targetText = written.get(found.targetId).text;
  const cards = page.locator('[data-testid^="assign-rec-"]:not([data-testid$="-pending"])');
  await cards.first().waitFor({ timeout: T });
  let card = null;
  for (let index = 0; index < (await cards.count()); index += 1) {
    if ((await cards.nth(index).innerText()).includes(targetText)) card = cards.nth(index);
  }
  check("the candidate is one of the recommendations", card !== null);
  if (!card) return;
  await card.click();
  // 짝 문장이 더해져도 고른 표시가 켜진다(예전에는 ID 비교라 영영 꺼져 있었다)
  check("the recommendation shows as picked on a KO/EN pair row", (await card.getAttribute("aria-pressed")) === "true");
  check("the card says it is not saved yet", (await card.locator('[data-testid$="-pending"]').count()) === 1);
  if (found.partnerId !== null) check("both New sentences of the pair are picked", (await page.locator(`[data-testid="assign-new-pick-${found.partnerId}"]`).getAttribute("aria-pressed")) === "true");
  await wait(page, "assign-link-menu-confirm");
  await page.locator('[data-testid="assign-link-menu-confirm"]').waitFor({ state: "visible", timeout: T });
  check("the in-place menu says the pick is not saved", (await page.locator('[data-testid="assign-link-menu-unsaved"]').count()) === 1);
  await takeShot("sop-assign-menu-confirm.png");
  // 메뉴는 380ms에 보이고 400ms에 첫 항목으로 포커스를 옮긴다 - 그 사이에 누르면 Enter가 아직 추천 카드에 간다
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "assign-link-menu-confirm", null, { timeout: T });
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.keyboard.press("Enter");
  const savedResponse = await saved;
  check("Enter in the menu saves the link", savedResponse.ok(), savedResponse.ok() ? "" : (await savedResponse.text()).slice(0, 300));
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.waitForLoadState("networkidle");
  const after = new Map((await getJson("/written-sentences")).map((row) => [row.target_id, row]));
  check("the New sentence gets its Old source", after.get(found.targetId)?.source_unit_ids.includes(found.unit.id), JSON.stringify(after.get(found.targetId)?.source_unit_ids));
  if (found.partnerId !== null) check("the partner New sentence gets the other Old source", after.get(found.partnerId)?.source_unit_ids.includes(found.other.id), JSON.stringify(after.get(found.partnerId)?.source_unit_ids));
  // Old 조각 아래 "→ 간 곳"을 누르면 New의 그 문장으로 가고 끊기 메뉴가 뜬다
  const note = page.locator(`[data-testid="assign-note-${found.unit.id}"]`);
  await note.waitFor({ timeout: T });
  // 번쩍임은 1.3초 뒤 꺼지고 메뉴는 1초쯤 뒤에 뜬다 - 메뉴를 기다린 뒤에 찾으면 놓칠 수 있어 누르기 전부터 지켜본다
  await page.evaluate(() => {
    window.__flashedTarget = null;
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target.hasAttribute("data-flash") && record.target.closest('[data-pane="new"]')) window.__flashedTarget = record.target.getAttribute("data-target");
      }
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-flash"] });
  });
  await note.click();
  await page.locator('[data-testid="assign-link-menu-unlink"]').waitFor({ state: "visible", timeout: T });
  check("the jump lands on the linked New sentence", (await page.evaluate(() => window.__flashedTarget)) !== null);
  check("lines are drawn between the two documents", (await page.locator('[data-testid="assign-link-lines"] g').count()) > 0);
  await takeShot("sop-assign-jump-new.png");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-link-menu"]').waitFor({ state: "detached", timeout: T });
  check("Esc closes the menu", true);
  // New 문장의 "← 출처"를 누르면 Old의 그 조각으로
  await page.locator(`[data-testid="assign-new-src-${found.targetId}-${found.unit.id}"]`).click();
  await page.locator('[data-testid="assign-link-menu-unlink"]').waitFor({ state: "visible", timeout: T });
  check("the source chip jumps to the Old unit", (await page.locator(`[data-pane="old"] [data-flash] [data-unit="${found.unit.id}"]`).count()) === 1);
  // 마우스를 올리면 맞은편이 강조된다
  await page.locator('[data-testid="assign-link-menu-close"]').click();
  await page.locator(`[data-testid="assign-new-${found.targetId}"]`).hover();
  await page.locator(`[data-pane="old"] [data-link-hover]`).first().waitFor({ timeout: T });
  check("hovering a New sentence highlights its Old source", (await page.locator(`[data-pane="old"] [data-link-hover] [data-unit="${found.unit.id}"]`).count()) === 1);
  // 다시 불러와도 저장된 곳이 보인다 - 줄은 확정, 짝 New 두 문장이 이 줄의 곳으로 골라져 있다
  await page.reload();
  await wait(page, "assign-pick-prompt");
  await selectRowById(page, found.unit.display_id);
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("Confirmed"), null, { timeout: T });
  const linkedLines = [found.targetId, found.partnerId].filter((id) => id !== null);
  for (const id of linkedLines) await page.locator(`[data-testid="assign-new-${id}"][data-state="picked"]`).waitFor({ timeout: T });
  check("after reload the row is confirmed and its New sentences are shown as its place", true);
  // 이은 New 문장을 마우스로 누르면(글 오른쪽 끝) 끊기 메뉴가 누른 자리가 아니라 그 선의 New 쪽 끝(문장 왼쪽 테두리) 옆에 뜬다
  const pickBtn = page.locator(`[data-testid="assign-new-pick-${found.targetId}"]`);
  const pickBox = await pickBtn.boundingBox();
  await pickBtn.click({ position: { x: pickBox.width - 6, y: Math.min(8, pickBox.height / 2) } });
  await page.locator('[data-testid="assign-link-menu-unlink"]').waitFor({ state: "visible", timeout: T });
  await page.waitForFunction(() => document.activeElement?.closest('[data-testid="assign-link-menu"]') !== null, null, { timeout: T });
  const placed = await page.evaluate((id) => {
    const line = document.querySelector(`.new-line[data-target="${id}"]`).getBoundingClientRect();
    const menu = document.querySelector('[data-testid="assign-link-menu"]').getBoundingClientRect();
    return { lineLeft: line.left, lineRight: line.right, menuLeft: menu.left, drawn: document.querySelector(`[data-testid="assign-link-lines"] [data-link$=":${id}"]`) !== null };
  }, found.targetId);
  check("the unlink menu sits at the New end of the drawn line", placed.drawn && Math.abs(placed.menuLeft - placed.lineLeft) <= 1, JSON.stringify(placed));
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-link-menu"]').waitFor({ state: "detached", timeout: T });
});

// 칸 제목(제품 명세 §7.13 칸 제목) -옛 제목 짝을 SOP 칸의 칸 제목 자리로 확정하면 결과물 C와 Assign의 엮은 문서 미리 보기에서 칸 머리 옆에 "← OLD-1 §1"로 보인다. 끝에 원래 처분(지우기)으로 되돌린다
await runStep("assign: an old heading confirmed as a slot heading shows on C and on the composed New pane", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  const sop = (await getJson("/tobe")).docs.find((doc) => doc.doc_type === "sop" && doc.entrance === "assign");
  const headingRow = (await getJson("/units?limit=1000")).items.find((unit) => unit.kind === "heading" && unit.pair_id !== null);
  check("the bundle has an SOP to write and an old heading pair", Boolean(sop && headingRow), `${sop?.code} ${headingRow?.display_id}`);
  const before = headingRow.decision;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, headingRow.display_id);
  await page.locator('[data-testid="assign-acc-all"]').click();
  await page.locator(`[data-testid="assign-tree-p${sop.code}"]`).click();
  const headingPlace = page.locator(`[data-testid^="assign-tree-place-heading:${sop.id}:"]:not([disabled])`).first();
  const slotKey = (await headingPlace.getAttribute("data-testid")).split(":").at(-1);
  await headingPlace.click();
  await page.locator('[data-testid="assign-primary"][data-state="confirm"]').waitFor({ timeout: T });
  const chosen = await getText(page, "assign-chosen");
  check("the chosen place reads as the slot heading of that SOP", chosen.includes("Slot heading") && chosen.includes(sop.code), chosen);
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  check("the slot heading saves", (await saved).ok());
  const c = await getJson("/outputs/c?lang=en");
  const section = c.docs.find((doc) => doc.target_doc_id === sop.id)?.sections.find((item) => item.location_key === slotKey);
  check("C carries the heading note for that slot", section?.heading_note.startsWith("←") && section.heading_note.includes("OLD-1"), section?.heading_note);
  // 엮은 문서 미리 보기 - 문서 고르기에서 그 "not written" 문서를 연다
  await page.locator('[data-testid="assign-new-doc"]').click();
  await page.locator(`[data-testid="assign-new-doc-option-${sop.id}"]`).click();
  const paneNote = page.locator(`[data-testid="assign-new-heading-note-${section.number}"]`);
  await paneNote.waitFor({ timeout: T });
  check("the composed New pane shows the same note after the slot name", ((await paneNote.textContent()) ?? "").trim() === section.heading_note, await paneNote.textContent());
  await takeShot("sop-assign-slot-heading.png");
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await page.locator('[data-testid="outputs-tab-c"]').click();
  const cNote = page.locator(`[data-testid="output-c-heading-note-${sop.id}-${slotKey}"]`);
  await cNote.waitFor({ timeout: T });
  check("C shows the note next to the slot head", ((await cNote.textContent()) ?? "").trim().startsWith("←"), await cNote.textContent());
  await takeShot("sop-outputs-c-heading.png");
  // 되돌린다 - 원래 지우기(사유가 남아 있지 않으면 Remark 창에 적는다)
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, headingRow.display_id);
  if ((await page.locator('[data-testid="assign-pick-delete"]').count()) === 0) await page.locator('[data-testid="assign-acc-move"]').click();
  await page.locator('[data-testid="assign-pick-delete"]').click();
  const restored = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  const modal = page.locator('[data-testid="assign-remark-modal"]');
  if (await modal.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await page.locator('[data-testid="assign-remark-modal-text"]').fill(before.reason || "Structural heading");
    await page.locator('[data-testid="assign-remark-modal-confirm"]').click();
  }
  check("the heading goes back to deleted", (await restored).ok());
  const after = (await getJson("/units?limit=1000")).items.find((unit) => unit.unit_id === headingRow.unit_id);
  check("its decision is deleted and confirmed again", after.decision.disposition === "delete" && after.decision.status === "confirmed", JSON.stringify(after.decision));
});

await runStep("assign: the New pane shows a real table and figure", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const getJson = async (path) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}${path}`, { headers })).json();
  // 표와 그림을 함께 받은 아직 쓰지 않은 문서를 서버 미리 보기에서 찾는다
  let found = null;
  for (const doc of (await getJson("/tobe")).docs.filter((item) => item.entrance === "assign")) {
    const items = (await getJson(`/outputs/c/docs/${doc.id}?lang=en`)).sections.flatMap((section) => section.items);
    const table = items.find((item) => item.kind === "table" && item.table);
    const figure = items.find((item) => item.kind === "figure" && item.figure);
    if (table && figure) {
      found = { doc, table, figure };
      break;
    }
  }
  check("the bundle has a composed document with a table and a figure", Boolean(found), found ? `${found.doc.code} t${found.table.target_id} f${found.figure.target_id}` : "none");
  if (!found) return;
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-new-doc"]').click();
  await page.locator(`[data-testid="assign-new-doc-option-${found.doc.id}"]`).click();
  const tableBox = page.locator(`[data-testid="assign-new-${found.table.target_id}"]`);
  await tableBox.scrollIntoViewIfNeeded({ timeout: T });
  // 격자 자리마다 칸 하나(칸 번역은 그 칸 안에 줄로), 칸 새 문장은 서버 순서(행·열·id) 그대로
  const { rows, cols, cells: expectedCells } = found.table.table;
  const tdCount = await tableBox.locator("table.ptbl td").count();
  const cells = await tableBox.locator("table.ptbl td [data-cell-target]").allInnerTexts();
  const expected = expectedCells.map((cell) => cell.text);
  check("the table row draws its cells as a table", tdCount === rows * cols && cells.length === expected.length && cells.every((text, index) => text.trim() === expected[index].trim()), `${tdCount} td, ${cells.length}/${expected.length}`);
  check("the table sits in a side-scrolling box", await tableBox.locator(".ptbl-scroll").evaluate((el) => getComputedStyle(el).overflowX === "auto"));
  // 캡션 줄은 표·그림 위 - 서버 caption 그대로(여러 언어는 줄바꿈), 없으면 쓰지 않은 문서라 "Caption needed"
  const readCaptionLine = async (box, item) => {
    const line = box.locator(":scope > .new-bundle-cap");
    const ok = (await line.count()) === 1 && (await line.evaluate((el) => el.nextElementSibling !== null)) && (item.caption ? (await line.innerText()).trim() === item.caption.trim() : (await line.getAttribute("data-missing")) !== null);
    return { ok, detail: item.caption ?? "missing" };
  };
  for (const [label, box, item] of [["table", tableBox, found.table], ["figure", page.locator(`[data-testid="assign-new-${found.figure.target_id}"]`), found.figure]]) {
    const { ok, detail } = await readCaptionLine(box, item);
    check(`the ${label} row shows its caption line above it`, ok, detail);
  }
  const figureBox = page.locator(`[data-testid="assign-new-${found.figure.target_id}"]`);
  await figureBox.scrollIntoViewIfNeeded({ timeout: T });
  const image = figureBox.locator("img");
  await image.waitFor({ timeout: T });
  check("the figure row shows the image", await image.evaluate((el) => el.complete && el.naturalWidth > 0));
  check("no text placeholder is left for them", (await page.locator('[data-pane="new"] .new-block').count()) === 0);
  await takeShot("sop-assign-new-table-figure.png");
});

await runStep("outputs: A, B, C and the Excel preview", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await wait(page, "output-c");
  check("C shows the new documents", (await getText(page, "output-c")).includes("SOP-CF"));
  // 표는 캡션 줄이 표 앞, 그림은 [Figure] 대신 캡션 글(캡션 있는 표·그림이 데모에 있다)
  const captionBeforeTable = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="output-c-caption-"]')].some((el) => {
    let next = el.nextElementSibling;
    while (next?.matches('[data-testid^="output-c-caption-"]')) next = next.nextElementSibling;
    return next?.classList.contains("ptbl-scroll") ?? false;
  }));
  check("C puts a table caption line before its table", captionBeforeTable);
  check("no edition toggle on the outputs screen", (await page.locator('[data-testid^="outputs-lang"]').count()) === 0);
  await takeShot("sop-outputs-c.png");
  await page.locator('[data-testid="outputs-tab-a"]').click();
  await wait(page, "output-a");
  check("A lists unit rows", (await page.locator('[data-testid="output-a"] tbody tr').count()) > 10);
  check("A's first Row cell is 1", (await getText(page, "output-a-row-no-0")).trim() === "1", await getText(page, "output-a-row-no-0"));
  await page.locator('[data-testid="outputs-tab-b"]').click();
  await wait(page, "output-b");
  check("B shows flows from old documents", (await getText(page, "output-b")).includes("OLD-1"));
  // Export Excel은 미리보기 창을 먼저 연다 - 파일과 같은 시트 다섯 장, 받기는 창에서
  await page.locator('[data-testid="outputs-export-open"]').click();
  await wait(page, "export-preview");
  await wait(page, "export-preview-sheet");
  const tabs = await page.locator('[data-testid^="export-preview-tab-"]').allInnerTexts();
  check("the preview has the five sheet tabs in file order", JSON.stringify(tabs.map((name) => name.trim())) === JSON.stringify(["A Comparison", "B Flow", "C New documents", "Info", "Documents"]), JSON.stringify(tabs));
  await takeShot("sop-outputs-preview.png");
  const download = page.waitForEvent("download", { timeout: T });
  await page.locator('[data-testid="export-preview-download"]').click();
  // 헤드리스 Chrome은 blob 내려받기 이름을 "download"로 알린다 - 이름 규칙은 단위 테스트가 본다
  await download;
  check("Excel download starts", true);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="export-preview"]').waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid="outputs-check-numbers"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="outputs-check-numbers"]')?.checked === true, null, { timeout: T });
  check("meaning check saves", true);
  await page.locator('[data-testid="outputs-check-numbers"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="outputs-check-numbers"]')?.checked === false, null, { timeout: T });
});

// 결과물 C는 읽기 전용이라 줄 끝 단추가 없다 - Order의 호버 바탕·다리(::after)가 새어 들지 않고 줄에 올려도 가로 스크롤이 늘지 않는다
await runStep("outputs: read-only C rows keep their rest look on hover", {}, async ({ page }) => {
  for (const width of [1120, 1440]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
    await page.locator('[data-testid="outputs-tab-c"]').click();
    const row = page.locator('[data-testid="output-c"] [data-testid^="output-c-row-"]').nth(1);
    await row.waitFor({ timeout: T });
    const readState = () => row.evaluate((el) => {
      const pane = el.closest(".overflow-auto, .overflow-y-auto");
      return { background: getComputedStyle(el).backgroundColor, after: getComputedStyle(el, "::after").content, page: document.scrollingElement.scrollWidth, pane: pane.scrollWidth };
    });
    await row.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    const rest = await readState();
    // 줄의 오른쪽 끝에 올린다 - 다리가 있다면 여기서 줄 밖으로 나간다
    const box = await row.boundingBox();
    await page.mouse.move(box.x + box.width - 2, box.y + 6);
    await page.waitForTimeout(200);
    const hovered = await readState();
    check(`at ${width} a hovered read-only C row keeps its background`, hovered.background === rest.background, `${rest.background} -> ${hovered.background}`);
    check(`at ${width} a hovered read-only C row has no ::after box`, hovered.after === "none", hovered.after);
    check(`at ${width} hovering a read-only C row does not widen the page or the pane`, hovered.page === rest.page && hovered.pane === rest.pane, JSON.stringify({ rest, hovered }));
  }
});

// 결과물 화면의 C는 읽기 전용 - 작성자라도 줄이 끌리지 않는다(G13)
await runStep("outputs: read-only C rows do not start a drag", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/outputs`);
  await page.locator('[data-testid="outputs-tab-c"]').click();
  const row = page.locator('[data-testid="output-c"] [data-testid^="output-c-row-"]').nth(1);
  await row.waitFor({ timeout: T });
  check("read-only C rows are not drag boxes and have no drop line", (await page.locator("[data-drag-box]").count()) === 0 && (await page.locator('[data-testid="output-c-dropline"]').count()) === 0);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 26, { steps: 5 });
  const state = await page.evaluate(() => ({ flag: document.documentElement.hasAttribute("data-box-drag"), cards: document.querySelectorAll('[data-testid="drag-card"]').length }));
  await page.mouse.up();
  check("pressing and moving on a read-only C row starts no drag", !state.flag && state.cards === 0, JSON.stringify(state));
});

// 줄 끝 단추 묶음은 호버·포커스 때만, 글 밖에 뜬다(끌어다 놓기 설계 §5, 사용자 결정 2026-11-16). 터치 화면에서는 늘 보인다
await runStep("order: row-end buttons show only on hover or focus, one group at a time", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 단추 묶음과 글 상자가 있는 줄이 넷 이상인 칸 - A는 위에 이웃 줄이 있는 둘째 줄, B는 넷째 줄
  const probeRows = () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')]
        .filter((row) => row.querySelector('[data-testid^="output-c-acts-"]') && row.querySelector('[data-testid^="output-c-item-"]'))
        .map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 4) return ids;
    }
    return null;
  };
  const [hit] = await findOrderDocs(page, probeRows);
  check("Order has a section with four lines that carry buttons", Boolean(hit));
  const [, ids] = hit;
  const [a, b] = [ids[1], ids[3]];
  const settle = () => page.waitForTimeout(200);
  // 보이는 줄 끝 단추(넓으면 묶음 .c-acts, 좁으면 ⋯ .c-more)가 있는 줄 id
  const shownGroups = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="output-c-row-"] > :is(.c-acts, .c-more)')]
    .filter((el) => getComputedStyle(el).display !== "none" && Number(getComputedStyle(el).opacity) > 0)
    .map((el) => el.parentElement.getAttribute("data-testid").replace("output-c-row-", "")));
  // 보이는 단추 상자(묶음 또는 ⋯), 줄 상자, 글 상자(그 줄과 위아래 이웃 줄), 용지, 스크롤 칸
  const measure = (id) => page.evaluate((target) => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const row = document.querySelector(`[data-testid="output-c-row-${target}"]`);
    const acts = [...row.querySelectorAll(":scope > .c-acts, :scope > .c-more")].find((el) => getComputedStyle(el).display !== "none");
    const pane = row.closest(".overflow-auto, .overflow-y-auto");
    const hit = (x, y) => Math.min(x.right, y.right) - Math.max(x.left, y.left) > 0.5 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 0.5;
    const box = rect(acts);
    // 그 줄은 글 상자 전체, 이웃 줄(칸 머리 포함)은 글줄마다(마지막 줄이 짧으면 그 옆 빈자리는 글이 아니다)
    const near = [row.previousElementSibling, row.nextElementSibling].filter(Boolean);
    const covers = hit(box, rect(row.querySelector(`[data-testid="output-c-item-${target}"]`))) || near.some((el) => (el.matches("h3") ? [el] : [...el.querySelectorAll('[data-testid^="output-c-item-"]')]).some((text) => {
      const range = document.createRange();
      range.selectNodeContents(text);
      return [...range.getClientRects()].some((r) => hit(box, r));
    }));
    // 스크롤 칸 오른쪽은 스크롤바 자리를 뺀 안쪽 끝
    const paneBox = rect(pane);
    return { box, mode: acts.classList.contains("c-more") ? "more" : "group", row: rect(row), covers, sheet: rect(row.closest("article.sheet")), pane: { ...paneBox, right: paneBox.left + pane.clientWidth }, scrolls: pane.scrollWidth > pane.clientWidth };
  }, id);
  // 용지 오른쪽 바깥, 줄 위 끝(의미 묶음 첫 줄은 위 테두리 2px 아래)에 뜨고 스크롤 칸 안에 든다
  const isBesideSheet = (m) => m.box.left >= m.sheet.right && m.box.right <= m.pane.right && Math.abs(m.box.top - m.row.top) <= 3;
  // 실제 마우스를 걸음으로 옮긴다(click()처럼 단추로 바로 뛰지 않는다) - 줄의 마지막 글줄 오른쪽 끝에서 목표 단추 가운데까지, 걸음마다 그 줄이 호버 상태인지 본다
  const walkTo = async (rowId, targetSelector) => {
    const from = await page.locator(`[data-testid="output-c-item-${rowId}"]`).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = [...range.getClientRects()];
      const last = lines.at(-1);
      return { x: last.right - 4, y: (last.top + last.bottom) / 2, lines: new Set(lines.map((r) => Math.round(r.top))).size };
    });
    await page.mouse.move(from.x, from.y);
    await settle();
    const target = await page.locator(targetSelector).boundingBox();
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const STEPS = 24;
    let lost = 0;
    for (let i = 1; i <= STEPS; i += 1) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / STEPS, from.y + ((to.y - from.y) * i) / STEPS);
      if (!(await page.locator(`[data-testid="output-c-row-${rowId}"]`).evaluate((el) => el.matches(":hover")))) lost += 1;
    }
    return { lines: from.lines, lost };
  };
  // 누른 것이 단추에 닿았는지 - 창 캡처 단계에서 받고 멈춘다(React까지 가지 않으니 DB는 그대로)
  const armLanding = (selector) => page.evaluate((sel) => {
    window.__landed = false;
    window.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(sel)) {
        window.__landed = true;
        event.stopPropagation();
      }
    }, { capture: true, once: true });
  }, selector);
  const hoverAt = async (width) => {
    await page.setViewportSize({ width, height: 720 });
    await page.mouse.move(0, 0);
    await rowA.scrollIntoViewIfNeeded();
    await rowA.hover({ position: { x: 8, y: 4 } });
    await settle();
    return measure(a);
  };
  const rowA = page.locator(`[data-testid="output-c-row-${a}"]`);
  const rowB = page.locator(`[data-testid="output-c-row-${b}"]`);
  await rowA.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await settle();
  check("no group shows at rest", (await shownGroups()).length === 0, (await shownGroups()).join(","));
  const restHeight = (await rowA.boundingBox()).height;
  await rowA.hover({ position: { x: 8, y: 4 } });
  await settle();
  const at1248 = await measure(a);
  check("hovering a row shows its group", JSON.stringify(await shownGroups()) === JSON.stringify([a]), (await shownGroups()).join(","));
  check("the group covers no text of its row or the neighbours", !at1248.covers, JSON.stringify(at1248.box));
  check("hover does not change the row height", Math.abs(at1248.row.height - restHeight) < 0.5, `${restHeight} -> ${at1248.row.height}`);
  // 1248 - 용지 옆 남는 폭(약 140px)에 묶음이 두 줄로 감겨 뜬다
  check("at 1248 the group floats beside the sheet, wrapped to fit", at1248.mode === "group" && isBesideSheet(at1248) && at1248.box.height > 40, JSON.stringify({ box: at1248.box, row: at1248.row, sheet: at1248.sheet, pane: at1248.pane }));
  check("no horizontal scroll at 1248", !at1248.scrolls);
  const rowBackground = (locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  check("the hovered row is highlighted", (await rowBackground(rowA)) !== "rgba(0, 0, 0, 0)", await rowBackground(rowA));
  await takeShot("sop-order-row-buttons-hover.png");
  // 문서 끝 줄 - 두 줄 묶음이 내용 아래로 늘어져 스크롤을 늘리지 않는다
  const scrollHeight = () => page.locator('[data-testid="output-c"]').evaluate((el) => el.closest(".overflow-auto, .overflow-y-auto").scrollHeight);
  const lastRow = page.locator('[data-testid^="output-c-row-"]:has([data-testid^="output-c-acts-"])').last();
  await lastRow.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await settle();
  const restScroll = await scrollHeight();
  await lastRow.hover({ position: { x: 8, y: 4 } });
  await settle();
  check("hovering the last row does not grow the scroll area", (await scrollHeight()) === restScroll, `${restScroll} -> ${await scrollHeight()}`);
  // 여러 줄로 감긴 줄의 마지막 글줄에서 묶음 둘째 줄의 단추까지 마우스로 가도 묶음이 사라지지 않고 누름이 닿는다
  // 시드 글이 짧으면 A의 글을 길게 바꿔(화면에서만) 세 줄로 감기게 한다
  await rowA.scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="output-c-item-${a}"]`).evaluate((el) => { el.textContent = "SYNTHETIC long line for the reach check. ".repeat(6); });
  const reachDown = `[data-testid="output-c-move-down-${a}"]`;
  const walk1248 = await walkTo(a, reachDown);
  await armLanding(reachDown);
  await page.mouse.down();
  await page.mouse.up();
  check("from the last line of a wrapped row the mouse reaches the group's second line", walk1248.lines >= 2 && walk1248.lost === 0 && (await page.evaluate(() => window.__landed)), JSON.stringify(walk1248));
  // 눌러 고른 줄(B)이 있어도 다른 줄에 올리면 그 줄 묶음만 보인다. 포인터가 떠나면 고른 줄의 묶음이 돌아온다
  await rowB.click({ position: { x: 4, y: 4 } });
  await settle();
  const pickedLook = await rowBackground(rowB);
  await rowA.hover({ position: { x: 8, y: 4 } });
  await settle();
  check("only one group shows", JSON.stringify(await shownGroups()) === JSON.stringify([a]), (await shownGroups()).join(","));
  check("the picked row keeps its own tint while another row is hovered", (await rowBackground(rowB)) === pickedLook && pickedLook !== "rgba(0, 0, 0, 0)", `${pickedLook} -> ${await rowBackground(rowB)}`);
  await page.mouse.move(0, 0);
  await settle();
  check("the picked row keeps its group when the pointer leaves", (await shownGroups()).includes(b), (await shownGroups()).join(","));
  // 글쇠로 단추에 가 있는 묶음은 다른 줄에 올려도 물러나지 않는다(보이지 않는 포커스 금지)
  // 글쇠로 옮겨 가야 :focus-visible이 된다(마우스 뒤의 focus()는 아니다) - 한 칸 뒤로 갔다가 돌아온다. 누르지 않으니 DB는 그대로
  await page.locator(`[data-testid="output-c-move-down-${b}"]`).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await rowA.hover({ position: { x: 8, y: 4 } });
  await settle();
  check("a keyboard-focused button keeps its group", (await shownGroups()).includes(b), (await shownGroups()).join(","));
  await page.locator(`[data-testid="output-c-move-down-${b}"]`).blur();
  // 넓은 창 - 용지 오른쪽 바깥에 한 줄로
  const wide = await hoverAt(1440);
  check("a wide window floats the group outside the sheet in one line", isBesideSheet(wide) && wide.box.height <= 32, JSON.stringify({ box: wide.box, sheet: wide.sheet, pane: wide.pane }));
  check("the wide group covers no text", !wide.covers);
  check("no horizontal scroll at 1440", !wide.scrolls);
  await takeShot("sop-order-row-buttons-wide.png");
  // 넓은 창에서도 감긴 줄의 마지막 글줄에서 한 줄 묶음의 끝 단추까지 닿는다
  const walk1440 = await walkTo(a, reachDown);
  await armLanding(reachDown);
  await page.mouse.down();
  await page.mouse.up();
  check("at 1440 the mouse reaches the one-line group from the last line", walk1440.lost === 0 && (await page.evaluate(() => window.__landed)), JSON.stringify(walk1440));
  // 가장 좁은 지원 폭 - 묶음이 두 줄로도 안 들어가 ⋯ 하나가 용지 옆에 뜬다
  const slim = await hoverAt(1120);
  check("at 1120 a single more button floats beside the sheet", slim.mode === "more" && isBesideSheet(slim) && slim.box.width <= 32, JSON.stringify({ mode: slim.mode, box: slim.box, sheet: slim.sheet, pane: slim.pane }));
  check("the 1120 more button covers no text", !slim.covers);
  check("no horizontal scroll at 1120", !slim.scrolls);
  // ⋯ 단추 output-c-menu-<id>, 메뉴 output-c-menu-list-<id>, 항목 output-c-menu-<동작>-<id>
  const moreButton = page.locator(`[data-testid="output-c-menu-${a}"]`);
  const walk1120 = await walkTo(a, `[data-testid="output-c-menu-${a}"]`);
  await page.mouse.down();
  await page.mouse.up();
  const menu = page.locator(`[data-testid="output-c-menu-list-${a}"]`);
  await menu.waitFor({ timeout: T });
  check("from the last line of a wrapped row the mouse reaches the more button and opens its menu", walk1120.lost === 0 && (await menu.isVisible()), JSON.stringify(walk1120));
  // 메뉴 항목은 묶음 단추와 같은 일곱 동작 - 지금 번호 표시에 표시가 있고, 꺼짐은 묶음 단추와 같다
  const menuState = await page.evaluate((id) => {
    const disabled = (sel) => document.querySelector(sel)?.disabled ?? null;
    const itemOf = (action) => `[data-testid="output-c-menu-${action}-${id}"]`;
    const item = document.querySelector(`[data-testid="output-c-item-${id}"]`);
    // 묶음에 있는 단추만큼 - 번호 표시를 못 바꾸는 줄(이미 쓴 문서)·깊이를 못 바꾸는 줄(AI 번역)은 그 항목도 없다
    const expected = [
      ...(document.querySelector(`[data-testid="output-c-mark-${id}"]`) ? ["numbered", "omitted", "note"] : []),
      ...(document.querySelector(`[data-testid="output-c-indent-${id}"]`) ? ["outdent", "indent"] : []),
      "up",
      "down",
    ];
    return {
      expected,
      checked: document.querySelector(itemOf(item.dataset.numberStyle))?.getAttribute("aria-checked"),
      items: [...document.querySelectorAll(`[data-testid="output-c-menu-list-${id}"] [role^="menuitem"]`)].map((el) => el.getAttribute("data-testid").replace("output-c-menu-", "").replace(`-${id}`, "")),
      same: ["outdent", "indent"].every((key) => disabled(itemOf(key)) === disabled(`[data-testid="output-c-${key}-${id}"]`))
        && ["up", "down"].every((key) => disabled(itemOf(key)) === disabled(`[data-testid="output-c-move-${key}-${id}"]`)),
    };
  }, a);
  check("the menu lists the group's actions with the current number style marked", menuState.expected.length === 7 && JSON.stringify(menuState.items) === JSON.stringify(menuState.expected) && menuState.checked === "true" && menuState.same, JSON.stringify(menuState));
  check("the row whose menu is open stays highlighted", (await rowBackground(rowA)) !== "rgba(0, 0, 0, 0)");
  await takeShot("sop-order-row-more-menu.png");
  await page.keyboard.press("Escape");
  await settle();
  check("Esc closes the menu and returns focus to the more button", (await menu.count()) === 0 && (await moreButton.evaluate((el) => el === document.activeElement)));
  // 메뉴로 번호 표시를 바꾸고 되돌린다 - 저장되고 닫힌 메뉴는 포커스를 ⋯ 단추로 돌린다
  await moreButton.click();
  const marked = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-menu-omitted-${a}"]`).click();
  check("a menu item runs its action and saves", (await marked).ok() && (await page.locator(`[data-testid="output-c-item-${a}"]`).getAttribute("data-number-style")) === "omitted");
  await moreButton.click();
  const unmarked = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-menu-numbered-${a}"]`).click();
  check("the menu puts the number style back", (await unmarked).ok() && (await page.locator(`[data-testid="output-c-item-${a}"]`).getAttribute("data-number-style")) === "numbered");
  // 스크롤바가 두꺼운 창(Windows 고전 스크롤바 17px 둘)처럼 틀 내용 폭이 756px로 좁아도 용지가 몇 px 양보해 ⋯는 용지 옆에 남는다.
  // 헤드리스는 스크롤바를 숨기므로 틀 폭을 줄여 흉내 낸다 - width는 테두리 상자라 내용 756 = 780 - 좌우 여백 12×2
  await page.addStyleTag({ content: '[data-testid="output-c"] { width: 780px; }' });
  const squeezed = await hoverAt(1120);
  check("a narrow frame shrinks the sheet a little and keeps the more button beside it", squeezed.mode === "more" && isBesideSheet(squeezed) && squeezed.sheet.width < 760 && !squeezed.covers, JSON.stringify({ box: squeezed.box, sheet: squeezed.sheet }));
  await page.setViewportSize(VIEWPORT);
  // 터치 화면 - 호버가 없으니 묶음이 늘 보이고 글 흐름 안에 있다
  const touch = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true });
  await touch.addInitScript(() => {
    if (location.protocol !== "about:" && !window.localStorage.getItem("sopa.devUser")) window.localStorage.setItem("sopa.devUser", "qa.member");
  });
  try {
    const touchPage = await touch.newPage();
    await touchPage.goto(`${BASE}/bundles/${halfBundleId}/order`);
    await touchPage.locator(`[data-testid="order-doc-${hit[0]}"]`).click();
    await touchPage.locator(`[data-testid="output-c-acts-${a}"]`).waitFor({ timeout: T });
    const touchState = await touchPage.evaluate((target) => {
      const acts = document.querySelector(`[data-testid="output-c-acts-${target}"]`);
      const box = acts.getBoundingClientRect();
      const item = document.querySelector(`[data-testid="output-c-item-${target}"]`).getBoundingClientRect();
      const covers = Math.min(box.right, item.right) - Math.max(box.left, item.left) > 0.5 && Math.min(box.bottom, item.bottom) - Math.max(box.top, item.top) > 0.5;
      return { opacity: Number(getComputedStyle(acts).opacity), covers, hoverNone: matchMedia("(hover: none)").matches };
    }, a);
    check("touch devices keep the buttons visible", touchState.hoverNone && touchState.opacity === 1 && !touchState.covers, JSON.stringify(touchState));
  } finally {
    await touch.close();
  }
});

await runStep("order: indent a line on C and its section number changes", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 들일 수 있는 첫 줄(앞줄이 있고 번호가 있는 줄)
  const button = page.locator('[data-testid^="output-c-indent-"]:not([disabled])').first();
  const targetId = (await button.getAttribute("data-testid")).replace("output-c-indent-", "");
  const number = page.locator(`[data-testid="output-c-number-${targetId}"]`);
  const before = (await number.innerText()).trim();
  await page.locator(`[data-testid="output-c-row-${targetId}"]`).hover();
  const indented = waitOrderSave(page);
  await button.click();
  check("the indent saves", (await indented).ok());
  const after = (await number.innerText()).trim();
  check("indenting adds a level to the number", after.split(".").length === before.split(".").length + 1, `${before} -> ${after}`);
  await takeShot("sop-outputs-c-indent.png");
  // 줄을 눌러 고른 뒤 Shift+Tab이 내어 쓴다
  await page.locator(`[data-testid="output-c-row-${targetId}"]`).click({ position: { x: 4, y: 4 } });
  const outdented = waitOrderSave(page);
  await page.keyboard.press("Shift+Tab");
  check("the outdent saves", (await outdented).ok());
  check("Shift+Tab on the picked row outdents it back", (await number.innerText()).trim() === before);
});

await runStep("order: Alt+ArrowDown moves the picked line and keeps it picked", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 4) return ids;
    }
    return null;
  });
  check("a section with four lines exists", Boolean(hit));
  const ids = hit[1];
  const id = ids[0];
  const rowSel = `[data-testid="output-c-row-${id}"]`;
  const readOrder = () => page.evaluate((first) => [...(document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section")?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", "")), id);
  const activeRow = () => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
  // 줄 자리를 스크롤 칸 기준으로 - 칸이 없으면 null(검사가 실패한다)
  const readPlace = (nextId) => page.evaluate(({ sel, nextSel }) => {
    const row = document.querySelector(sel);
    const pane = row?.closest(".overflow-auto, .overflow-y-auto");
    if (!pane) return null;
    const paneTop = pane.getBoundingClientRect().top;
    const box = row.getBoundingClientRect();
    const next = nextSel ? document.querySelector(nextSel)?.getBoundingClientRect() : null;
    return { top: box.top - paneTop, height: box.height, nextBottom: next ? next.bottom - paneTop : null };
  }, { sel: rowSel, nextSel: nextId ? `[data-testid="output-c-row-${nextId}"]` : null });
  const start = (await readOrder()).indexOf(id);
  const puts = [];
  const onRequest = (request) => {
    if (isOrderSave(request)) puts.push(request.url());
  };
  page.on("request", onRequest);
  // 1. 줄을 눌러 고른 뒤 Alt+↓ - 한 자리, 고른 채로. 줄을 칸 가운데에 두어 가장자리 따라가기(shouldRecenter)가 끼지 않게 한다
  await page.locator(rowSel).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.locator(rowSel).click({ position: { x: 4, y: 4 } });
  // 한 자리 내리면 줄의 위 끝은 이웃 줄의 아래 끝에서 자기 높이만큼 위에 선다 - 화면이 뛰지 않으면 칸 기준 그 자리다
  const placeBefore = await readPlace((await readOrder())[start + 1]);
  const moved = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  check("the move saves", (await moved).ok());
  check("the line moved one place", (await readOrder()).indexOf(id) === start + 1, JSON.stringify(await readOrder()));
  check("the line stays picked", (await activeRow()) === `output-c-row-${id}`, await activeRow());
  await page.waitForTimeout(600); // 미끄러짐(useFlip)이 끝난 자리를 잰다
  const placeAfter = await readPlace(null);
  const expectedTop = placeBefore ? placeBefore.nextBottom - placeBefore.height : null;
  check("the screen did not jump", placeBefore !== null && placeAfter !== null && Math.abs(placeAfter.top - expectedTop) <= 8, JSON.stringify({ placeBefore, placeAfter, expectedTop }));
  // 2. 단추에 포커스가 있을 때의 Alt+↑·↓는 아무 일도 없다
  await page.locator(rowSel).hover();
  await page.locator(`[data-testid="output-c-move-down-${id}"]`).focus();
  const putsBefore = puts.length;
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(500);
  check("Alt+ArrowDown on a row button does nothing", puts.length === putsBefore && (await readOrder()).indexOf(id) === start + 1);
  // 3. 되돌린다 - 위로, 그리고 칸 맨 위 줄의 Alt+↑는 막히지 않고 아무 일도 없다
  await page.locator(rowSel).click({ position: { x: 4, y: 4 } });
  const back = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowUp");
  check("Alt+ArrowUp moves it back", (await back).ok() && (await readOrder()).indexOf(id) === start);
  check("it is still picked after moving up", (await activeRow()) === `output-c-row-${id}`);
  const top = (await readOrder())[0];
  await page.locator(`[data-testid="output-c-row-${top}"]`).click({ position: { x: 4, y: 4 } });
  const topPuts = puts.length;
  const defaultPrevented = await page.evaluate((topId) => new Promise((done) => {
    const row = document.querySelector(`[data-testid="output-c-row-${topId}"]`);
    row.addEventListener("keydown", (event) => queueMicrotask(() => done(event.defaultPrevented)), { once: true });
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }));
  }), top);
  await page.waitForTimeout(400);
  check("Alt+ArrowUp on the first line of a section does nothing and is not swallowed", puts.length === topPuts && defaultPrevented === false);
  // 4. Esc가 고름을 놓는다
  await page.keyboard.press("Escape");
  check("Esc lets go of the line", (await activeRow()) !== `output-c-row-${top}`);
  page.off("request", onRequest);
});

await runStep("order: a depth-locked line (an already-written document) can be picked, moved and is not indented by Tab", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    if (document.querySelector('[data-testid="output-c"] article header span.font-mono')?.textContent !== "WI-04") return null;
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 3) return ids;
    }
    return null;
  });
  check("the already-written document WI-04 has a section with three lines", Boolean(hit));
  const ids = hit[1];
  const id = ids[0];
  const rowSel = `[data-testid="output-c-row-${id}"]`;
  const readOrder = () => page.evaluate((first) => [...(document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section")?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", "")), id);
  const activeRow = () => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
  check("the line has no indent button", (await page.locator(`[data-testid="output-c-indent-${id}"]`).count()) === 0);
  const start = (await readOrder()).indexOf(id);
  await page.locator(rowSel).click({ position: { x: 4, y: 4 } });
  check("a depth-locked line can be picked", (await activeRow()) === `output-c-row-${id}`, await activeRow());
  const padding = () => page.locator(`${rowSel} .c-line`).evaluate((el) => getComputedStyle(el).paddingLeft);
  const paddingBefore = await padding();
  let saved = false;
  const onRequest = (request) => {
    if (isOrderSave(request)) saved = true;
  };
  page.on("request", onRequest);
  // 브라우저가 Tab으로 갈 다음 요소 - 줄 뒤(줄 안의 단추 포함) 문서 순서로 첫 탭 가능한 요소에 표시를 단다
  const expectedNext = await page.evaluate((sel) => {
    const row = document.querySelector(sel);
    const next = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].find((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    next?.setAttribute("data-smoke-next", "");
    return next ? next.getAttribute("data-testid") ?? next.tagName : null;
  }, rowSel);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(400);
  const landed = await page.evaluate(() => ({ next: document.activeElement?.hasAttribute("data-smoke-next") ?? false, active: document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "" }));
  await page.evaluate(() => document.querySelector("[data-smoke-next]")?.removeAttribute("data-smoke-next"));
  check("Tab does not indent it and moves focus to the next focusable element", !saved && (await padding()) === paddingBefore && expectedNext !== null && landed.next, JSON.stringify({ expectedNext, ...landed }));
  page.off("request", onRequest);
  await page.locator(rowSel).click({ position: { x: 4, y: 4 } });
  const moved = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  check("Alt+ArrowDown moves a depth-locked line", (await moved).ok() && (await readOrder()).indexOf(id) === start + 1, JSON.stringify(await readOrder()));
  check("it stays picked", (await activeRow()) === `output-c-row-${id}`);
  const back = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowUp");
  check("and moves back", (await back).ok() && (await readOrder()).indexOf(id) === start);
});

// 줄을 끌어 칸 안에서 옮기고 좌우로 깊이를 바꾼다(끌어다 놓기 설계 §4·§5). 마우스는 걸음으로 움직인다(dragTo는 쓰지 않는다). 바꾼 순서·깊이는 단계 안에서 되돌린다
await runStep("order: drag a line to reorder and indent", {}, async ({ page, takeShot }) => {
  await installCommitCounter(page);
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 줄 넷 이상인 칸 - 첫 줄 F와, 칸의 첫 줄이 아닌 마지막 의미 묶음의 첫 줄 L(깊이 0, 번호·글이 있다). 둘이 한 화면에 든다
  const probe = () => {
    const isPlain = (row) => row.querySelector('[data-testid^="output-c-number-"]') && row.querySelector('[data-testid^="output-c-item-"]');
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const rows = [...section.querySelectorAll("[data-drag-box]")];
      if (rows.length < 4 || !isPlain(rows[0])) continue;
      const starts = rows.filter((row, index) => index > 0 && row.hasAttribute("data-meaning-start") && isPlain(row) && getComputedStyle(row.querySelector(".c-line")).paddingLeft === "0px");
      if (starts.length === 0 || rows.at(-1).getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top > 420) continue;
      return { ids: rows.map((row) => row.dataset.flipKey), l: starts.at(-1).dataset.flipKey };
    }
    return null;
  };
  const [hit] = await findOrderDocs(page, probe);
  check("Order has a short section with four lines and a later meaning group", Boolean(hit));
  const [docId, { ids: original, l }] = hit;
  const first = original[0];
  const rowOf = (id) => page.locator(`[data-testid="output-c-row-${id}"]`);
  const readOrder = (anchor) => page.evaluate((id) => [...(document.querySelector(`[data-testid="output-c-row-${id}"]`)?.closest("section")?.querySelectorAll("[data-drag-box]") ?? [])].map((row) => row.dataset.flipKey), anchor);
  const readNumber = async (id) => (await page.locator(`[data-testid="output-c-number-${id}"]`).innerText()).trim();
  const isDragging = () => page.evaluate(() => document.documentElement.hasAttribute("data-box-drag"));
  const readPane = () => page.locator('[data-testid="output-c"]').evaluate((el) => el.closest(".overflow-auto, .overflow-y-auto").scrollTop);
  const dropLine = page.locator('[data-testid="output-c-dropline"]');
  const card = page.locator('[data-testid="drag-card"]');
  // 놓을 자리의 미리 센 번호는 표의 note("→ 5.1", 깊이가 바뀌면 "· indent"가 붙는다)에 적힌다
  const cardNote = card.locator(".drag-card-note");
  const readNote = async () => ((await cardNote.isVisible()) ? (await cardNote.innerText()).trim() : "");
  // 선에 붙은 표시(있다면)가 덮는 글 상자 - 모든 칸의 줄 번호·글과 겹친 것
  const readLineCover = () => page.evaluate(() => {
    const marks = [...document.querySelectorAll('[data-testid="output-c-dropline"] *')].map((el) => el.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0);
    const texts = [...document.querySelectorAll('[data-testid="output-c"] [data-drag-box] :is([data-testid^="output-c-item-"], [data-testid^="output-c-number-"], td)')].map((el) => ({ id: el.getAttribute("data-testid") ?? "td", box: el.getBoundingClientRect() }));
    const isOver = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    return texts.filter(({ box }) => marks.some((mark) => isOver(mark, box))).map(({ id }) => id);
  });
  const centre = (id) => rowOf(id).evaluate((el) => el.scrollIntoView({ block: "center" }));
  // 줄 안의 한 점 - 글이 있으면 첫 글줄 위, 없으면(표) 줄 왼쪽 위
  const pointIn = async (id) => {
    const text = page.locator(`[data-testid="output-c-item-${id}"]`);
    const box = (await text.count()) > 0 ? await text.boundingBox() : await rowOf(id).boundingBox();
    return { x: box.x + Math.min(40, box.width / 2), y: box.y + 8 };
  };
  const puts = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) puts.push(request.url());
  });
  const settle = () => page.waitForTimeout(200);

  // 1. 바깥 누름으로 닫히는 메뉴는 줄을 눌러도 닫힌다 - pointerdown을 막지 않는다(G2)
  await centre(first);
  const firstNumber = await readNumber(first);
  await page.locator('[data-testid="top-bar-user"]').click();
  await wait(page, "user-menu-manual");
  await page.evaluate(() => {
    window.__clicks = 0;
    document.addEventListener("click", () => {
      window.__clicks += 1;
    });
  });
  const from = await pointIn(l);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 10, { steps: 5 });
  check("an open menu still closes on the press", (await page.locator('[data-testid="user-menu-manual"]').count()) === 0);
  // 2. 칸 첫 줄 위로 - 표시·표·선, 선 위 번호는 놓았을 때 L이 받을 번호(칸의 첫 번호)
  const target = { x: from.x, y: (await rowOf(first).boundingBox()).y + 2 };
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await settle();
  const lineText = await readNote();
  check("the drag shows the flag, the card and the drop line", (await isDragging()) && (await card.isVisible()) && (await rowOf(l).getAttribute("data-drag-src")) === "" && (await dropLine.isVisible()), lineText);
  check("the card shows the number the line will get", lineText === `→ ${firstNumber}`, `${lineText} vs → ${firstNumber}`);
  const covered = await readLineCover();
  check("the drop line covers no line's number or text", covered.length === 0, JSON.stringify(covered));
  // 3. 끄는 동안 다른 호버 효과는 꺼진다(G10)
  const hoverEffects = await page.evaluate(() => ({
    groups: [...document.querySelectorAll(".c-acts, .c-more")].filter((el) => getComputedStyle(el).display !== "none" && Number(getComputedStyle(el).opacity) > 0).length,
    tips: document.querySelectorAll(".tip").length,
  }));
  check("hover effects are off while dragging", hoverEffects.groups === 0 && hoverEffects.tips === 0, JSON.stringify(hoverEffects));
  // 4. 같은 칸 안에서 더 움직여도 React는 다시 그리지 않는다(G11)
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  for (let i = 0; i < 20; i += 1) await page.mouse.move(target.x + (i % 5), target.y + (i % 3));
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit while dragging", commitsBefore > 0 && commitsBefore === commitsAfter, `${commitsBefore} -> ${commitsAfter}`);
  // 5. 칸 첫 줄 위에서 놓으면 새 순서가 저장되고 번호를 다시 센다
  const paneBefore = await readPane();
  const saved = waitOrderSave(page);
  await page.mouse.up();
  const dropped = await readOrder(l);
  check("dropping above the first line saves the new order", (await saved).ok() && dropped[0] === l && (await readNumber(l)) === firstNumber && (await readNumber(first)) !== firstNumber, JSON.stringify(dropped));
  // 6. 놓은 줄은 고른 채로, 끌기는 끝났고 화면은 뛰지 않았다. 긁힌 글자도 없다
  const after = await page.evaluate(() => ({
    active: document.activeElement?.getAttribute("data-testid") ?? "",
    flag: document.documentElement.hasAttribute("data-box-drag"),
    cards: document.querySelectorAll('[data-testid="drag-card"]').length,
    marks: document.querySelectorAll("[data-drag-src], [data-drag-home]").length,
    selection: getSelection().toString(),
  }));
  check("the dropped line is picked and the drag is over", after.active === `output-c-row-${l}` && !after.flag && after.cards === 0 && after.marks === 0 && (await dropLine.isHidden()) && after.selection === "" && Math.abs((await readPane()) - paneBefore) < 2, JSON.stringify(after));
  // 7. 놓은 자리의 click 한 번은 삼키고 다음 click은 그대로 간다(G5)
  const swallowed = await page.evaluate(() => window.__clicks);
  await settle();
  const lBox = await rowOf(l).boundingBox();
  await page.mouse.click(lBox.x + 4, lBox.y + 4);
  check("the click after the drop is swallowed", swallowed === 0 && (await page.evaluate(() => window.__clicks)) === 1, `${swallowed} then ${await page.evaluate(() => window.__clicks)}`);
  // 8. 새로 고쳐도 옮긴 순서가 남아 있다
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await rowOf(l).waitFor({ timeout: T });
  const reloaded = await readOrder(l);
  check("after a reload the new order persisted", reloaded[0] === l && reloaded.length === original.length, JSON.stringify(reloaded));
  // 9. 움직임 줄이기 - 되돌리는 놓기는 미끄러지지 않고 바로 선다. 덩어리를 원래 다음 줄 앞(없으면 칸 끝)에 놓아 순서를 되돌린다
  await page.emulateMedia({ reducedMotion: "reduce" });
  await centre(first);
  const block = reloaded.slice(0, reloaded.indexOf(first));
  const next = original[original.indexOf(block.at(-1)) + 1] ?? null;
  const backFrom = await pointIn(l);
  const nextBox = await rowOf(next ?? reloaded.at(-1)).boundingBox();
  await page.mouse.move(backFrom.x, backFrom.y);
  await page.mouse.down();
  await page.mouse.move(backFrom.x, next ? nextBox.y + 2 : nextBox.y + nextBox.height + 6, { steps: 12 });
  const back = waitOrderSave(page);
  await page.mouse.up();
  const motion = await rowOf(l).evaluate((el) => ({ transform: el.style.transform, transition: el.style.transition, duration: getComputedStyle(el).transitionDuration }));
  check("reduced motion moves at once", motion.transform === "" && motion.transition === "" && motion.duration.split(",").every((part) => part.trim() === "0s"), JSON.stringify(motion));
  check("dragging the block back restores the order", (await back).ok() && JSON.stringify(await readOrder(l)) === JSON.stringify(original), JSON.stringify(await readOrder(l)));
  await page.emulateMedia({ reducedMotion: null });

  // 10. 제자리에서 좌우로 30px - 한 단 들여 쓰고 저장, 다시 왼쪽으로 끌어 되돌린다
  const dragSideways = async (id, dx) => {
    await rowOf(id).scrollIntoViewIfNeeded();
    const point = await pointIn(id);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + dx, point.y, { steps: 12 });
    const lineLeft = (await dropLine.isVisible()) ? (await dropLine.boundingBox()).x : null;
    return { text: await readNote(), dragging: await isDragging(), lineLeft };
  };
  // 그 깊이의 줄이 시작하는 x - 줄 상자(.c-line) 왼쪽 + 들여쓴 만큼(padding-left)
  const readTextStart = (id) => page.locator(`[data-testid="output-c-row-${id}"] .c-line`).evaluate((el) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
  const indentId = await page.evaluate(() => [...document.querySelectorAll('[data-testid="output-c"] [data-drag-box][data-meaning-start]')]
    .find((row) => row.querySelector('[data-testid^="output-c-indent-"]:not([disabled])') && row.querySelector('[data-testid^="output-c-number-"]') && row.querySelector('[data-testid^="output-c-item-"]'))
    ?.dataset.flipKey ?? null);
  check("a line whose depth may change exists", indentId !== null);
  const indentNumber = await readNumber(indentId);
  const right = await dragSideways(indentId, 30);
  const indented = waitOrderSave(page);
  await page.mouse.up();
  const indentedOk = (await indented).ok();
  const deeper = await readNumber(indentId);
  check("dragging sideways 30px indents one level", right.dragging && right.text.includes("indent") && !right.text.includes("outdent") && indentedOk && deeper.split(".").length === indentNumber.split(".").length + 1, `${right.text} | ${indentNumber} -> ${deeper}`);
  // 끄는 동안의 선은 들여 쓴 뒤 그 줄이 시작하는 자리에서 시작한다(글의 들여쓰기 1.5em과 같은 폭)
  await page.waitForTimeout(400);
  const indentedStart = await readTextStart(indentId);
  check("the drop line starts where a line of that depth starts", right.lineLeft !== null && Math.abs(right.lineLeft - indentedStart) <= 1, JSON.stringify({ lineLeft: right.lineLeft, indentedStart }));
  const left = await dragSideways(indentId, -30);
  const outdented = waitOrderSave(page);
  await page.mouse.up();
  check("dragging 30px back outdents it and saves", left.text.includes("outdent") && (await outdented).ok() && (await readNumber(indentId)) === indentNumber, `${left.text} | ${await readNumber(indentId)}`);

  // 11. 깊이가 잠긴 줄(이미 쓴 문서 WI-04) - 같은 몸짓은 아무것도 바꾸지 않는다
  const [locked] = await findOrderDocs(page, () => {
    if (document.querySelector('[data-testid="output-c"] article header span.font-mono')?.textContent !== "WI-04") return null;
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const rows = [...section.querySelectorAll("[data-drag-box]")];
      if (rows.length >= 3) return rows[1].dataset.flipKey;
    }
    return null;
  });
  check("the already-written document WI-04 has a section with three lines", Boolean(locked));
  const lockedId = locked[1];
  const padding = () => page.locator(`[data-testid="output-c-row-${lockedId}"] .c-line`).evaluate((el) => getComputedStyle(el).paddingLeft);
  const lockedPadding = await padding();
  const lockedPuts = puts.length;
  const lockedDrag = await dragSideways(lockedId, 30);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("on a depth-locked line the same gesture changes nothing", lockedDrag.dragging && !lockedDrag.text.includes("indent") && puts.length === lockedPuts && (await padding()) === lockedPadding, JSON.stringify({ lockedDrag, puts: puts.length - lockedPuts }));

  // 12. N/A 칸 위로(데모 시드 SOP-CF의 6.3 Troubleshooting) - 앞서 같은 칸에서 놓을 자리를 잡았어도 표에 이유를 적고, 놓으면 아무것도 저장하지 않는다(G7·G8).
  //     출발은 N/A 칸 위쪽에서 줄이 있는 가장 가까운 칸(같은 시드의 5.1 Safety)
  const [naHit] = await findOrderDocs(page, () => {
    const sheet = document.querySelector('[data-testid="output-c"] article[data-doc-id]');
    const na = sheet?.querySelector("section[data-na]");
    if (!na) return null;
    const sections = [...sheet.querySelectorAll("section[data-location-key]")];
    const above = sections.slice(0, sections.indexOf(na)).reverse().find((section) => section.querySelector("[data-drag-box]"));
    const rows = above ? [...above.querySelectorAll("[data-drag-box]")] : [];
    return rows.length > 0 ? { na: na.dataset.locationKey, first: rows[0].dataset.flipKey, source: rows.at(-1).dataset.flipKey } : null;
  });
  check("a document has an N/A section below a section with lines", Boolean(naHit));
  const naCase = naHit[1];
  await scrollRowToTop(page, naCase.first, 120);
  const naOrder = await readOrder(naCase.first);
  const np = await pointIn(naCase.source);
  await page.mouse.move(np.x, np.y);
  await page.mouse.down();
  await page.mouse.move(np.x, (await rowOf(naCase.first).boundingBox()).y + 2, { steps: 12 });
  const validFirst = await dropLine.isVisible();
  await page.mouse.move(np.x, (await pointInSectionEnd(page, naCase.na)).y, { steps: 12 });
  const refusal = { ...(await readDragCard(page)), section: await readSectionState(page, naCase.na) };
  const naFit = await readOutlineFit(page, naCase.na);
  check("the refused outline clears the N/A section's heading and reason", isOutlineClear(naFit), JSON.stringify(naFit));
  await takeShot("order-xsec-refused-na.png");
  check("an N/A section refuses with a reason", validFirst && refusal.refused && refusal.text.includes("That section is N/A in the To-Be list.") && (await dropLine.isHidden()) && refusal.section?.opacity < 1 && refusal.section?.drop === "refused", JSON.stringify({ validFirst, ...refusal }));
  check("the dimmed N/A section keeps its N/A reason line undimmed", refusal.section?.reasonOpacity === 1, JSON.stringify(refusal.section));
  const refusalPuts = puts.length;
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("releasing over an N/A section saves nothing", puts.length === refusalPuts && JSON.stringify(await readOrder(naCase.first)) === JSON.stringify(naOrder), JSON.stringify(await readOrder(naCase.first)));

  const [pairHit] = await findOrderDocs(page, () => {
    const sections = [...document.querySelectorAll('[data-testid="output-c"] section')];
    for (let i = 0; i + 1 < sections.length; i += 1) {
      const rows = [...sections[i].querySelectorAll("[data-drag-box]")];
      const other = sections[i + 1].querySelector("[data-drag-box]");
      if (rows.length < 2 || !other || !rows.at(-1).hasAttribute("data-meaning-start")) continue;
      if (other.getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top > 420) continue;
      return { first: rows[0].dataset.flipKey, source: rows.at(-1).dataset.flipKey, other: other.dataset.flipKey };
    }
    return null;
  });
  check("a section with two lines sits right above another section", Boolean(pairHit));
  const pair = pairHit[1];
  await centre(pair.first);
  const pairOrder = await readOrder(pair.first);

  // 13. 끄다가 Esc - 끌기만 취소된다. 저장 없음, 누른 줄은 고른 채, 단추 위에서 떼도 뒤따르는 click은 단추를 누르지 않는다(Review Focus 2)
  await page.evaluate(() => {
    window.__buttonClicks = 0;
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) window.__buttonClicks += 1;
    }, true);
  });
  const ep = await pointIn(pair.source);
  await page.mouse.move(ep.x, ep.y);
  await page.mouse.down();
  await page.mouse.move(ep.x, (await rowOf(pair.first).boundingBox()).y + 2, { steps: 12 });
  const escStarted = (await isDragging()) && (await dropLine.isVisible());
  const escPuts = puts.length;
  await page.keyboard.press("Escape");
  await settle();
  const downButton = await page.locator(`[data-testid="output-c-move-down-${pair.first}"]`).boundingBox();
  await page.mouse.move(downButton.x + downButton.width / 2, downButton.y + downButton.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const escState = await page.evaluate(() => ({
    flag: document.documentElement.hasAttribute("data-box-drag"),
    cards: document.querySelectorAll('[data-testid="drag-card"]').length,
    active: document.activeElement?.getAttribute("data-testid") ?? "",
    buttonClicks: window.__buttonClicks,
  }));
  check("Esc cancels", escStarted && !escState.flag && escState.cards === 0 && puts.length === escPuts && JSON.stringify(await readOrder(pair.first)) === JSON.stringify(pairOrder) && escState.active === `output-c-row-${pair.source}`, JSON.stringify(escState));
  check("the click after Esc presses no button", escState.buttonClicks === 0, String(escState.buttonClicks));

  // 14. 단추 묶음의 여백, 줄 상자 바로 바깥의 다리에서 누르고 움직여도 끌리지 않는다(Review Focus 1)
  await page.mouse.move(0, 0);
  await rowOf(pair.first).hover({ position: { x: 8, y: 4 } });
  await settle();
  const acts = await page.locator(`[data-testid="output-c-acts-${pair.first}"]`).boundingBox();
  await page.mouse.move(acts.x + 1, acts.y + 1);
  await page.mouse.down();
  await page.mouse.move(acts.x + 1, acts.y + 21, { steps: 5 });
  const padDrag = await isDragging();
  await page.mouse.up();
  check("a press on the action group padding does not drag", !padDrag);
  const rowBox = await rowOf(pair.first).boundingBox();
  const bridge = { x: rowBox.x + rowBox.width + 10, y: rowBox.y + 6 };
  await page.mouse.move(rowBox.x + rowBox.width - 4, bridge.y);
  await page.mouse.move(bridge.x, bridge.y, { steps: 3 });
  const bridgeRow = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-drag-box]")?.dataset.flipKey ?? null, bridge);
  await page.mouse.down();
  await page.mouse.move(bridge.x, bridge.y + 20, { steps: 5 });
  const bridgeDrag = await isDragging();
  await page.mouse.up();
  await page.mouse.move(rowBox.x + 40, rowBox.y + 30, { steps: 5 });
  const pendingDrag = await isDragging();
  check("a press in the bridge just outside the row neither drags nor leaves a pending press", bridgeRow === pair.first && !bridgeDrag && !pendingDrag, JSON.stringify({ bridgeRow, bridgeDrag, pendingDrag }));

  // 15. Alt를 누른 채 줄 글 위를 긁으면 글자가 골라지고 줄은 끌리지 않는다. Alt를 떼도 선택은 남고, 빈 곳을 누르면 풀린다(G3)
  const altId = await page.evaluate(() => [...document.querySelectorAll('[data-testid="output-c"] [data-drag-box] [data-testid^="output-c-item-"]')].find((el) => el.getBoundingClientRect().width > 120)?.closest("[data-drag-box]").dataset.flipKey ?? null);
  check("a line with enough text to select exists", altId !== null);
  await rowOf(altId).scrollIntoViewIfNeeded();
  const altOrder = await readOrder(altId);
  const altPuts = puts.length;
  await page.keyboard.down("Alt");
  const altMode = await page.evaluate(() => document.documentElement.hasAttribute("data-box-select"));
  const textBox = await page.locator(`[data-testid="output-c-item-${altId}"]`).boundingBox();
  await page.mouse.move(textBox.x + 4, textBox.y + 8);
  await page.mouse.down();
  let altDragged = false;
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(textBox.x + 4 + i * 10, textBox.y + 8);
    if (await isDragging()) altDragged = true;
  }
  await page.mouse.up();
  const altSelected = await page.evaluate(() => getSelection().toString().length);
  await page.waitForTimeout(300);
  check("Alt selects text instead of dragging", altMode && !altDragged && altSelected > 0 && puts.length === altPuts && JSON.stringify(await readOrder(altId)) === JSON.stringify(altOrder), JSON.stringify({ altMode, altDragged, altSelected }));
  await page.keyboard.up("Alt");
  const kept = await page.evaluate(() => ({ selection: getSelection().toString().length, mode: document.documentElement.hasAttribute("data-box-select") }));
  const sheetBox = await page.locator('[data-testid="output-c"] article.sheet').first().boundingBox();
  await page.mouse.click(sheetBox.x - 6, sheetBox.y + 40);
  const cleared = await page.evaluate(() => ({ selection: getSelection().toString().length, mode: document.documentElement.hasAttribute("data-box-select") }));
  check("the selection stays after Alt is let go and an empty press clears it", kept.selection > 0 && kept.mode && cleared.selection === 0 && !cleared.mode, JSON.stringify({ kept, cleared }));
});

// 같은 문서의 다른 칸으로 - 데모 시드 SOP-CF(아직 쓰지 않은 SOP): 1 Purpose의 의미 짝(덩어리)을 4 Responsibilities의 두 의미 묶음 사이로,
// 하위 칸 5.1 General Requirements › Safety의 끝으로, 빈 칸 6.1 Procedures › Procedure로 옮긴 뒤 같은 길을 되짚어(Responsibilities를 거쳐) 빈 Purpose로 되돌린다
await runStep("order: drag a block into another section, a sub-slot and an empty section", {}, async ({ page, takeShot }) => {
  await installCommitCounter(page);
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // A = 줄이 한 의미 묶음뿐인(첫 줄을 끌면 칸의 줄이 모두 가는) 첫 칸, R = 줄 넷 이상에 둘째 의미 묶음이 있는 칸, B = 줄이 있는 하위 칸(키에 "."), E = B 아래 150px 넘게 떨어진 N/A 아닌 빈 하위 칸.
  // A가 한 묶음이어야 하는 까닭 - 앞 단계(캡션 없는 표 확정)가 첫 칸 맨 앞에 표를 더하면 그 칸은 표와 한/영 짝 두 덩어리가 된다
  const [hit] = await findOrderDocs(page, () => {
    const sheet = document.querySelector('[data-testid="output-c"] article[data-doc-id]');
    if (!sheet || sheet.querySelector("header .tag")?.textContent !== "SOP") return null;
    const sections = [...sheet.querySelectorAll("section[data-location-key]")];
    const rowsOf = (section) => [...section.querySelectorAll("[data-drag-box]")];
    const numberOf = (section) => section.querySelector("h3 .font-mono")?.textContent.trim() ?? null;
    const a = sections.find((section) => rowsOf(section).length >= 2 && !rowsOf(section).some((row, i) => i > 0 && row.hasAttribute("data-meaning-start")));
    const r = sections.find((section) => section !== a && rowsOf(section).length >= 4 && rowsOf(section).some((row, i) => i > 0 && row.hasAttribute("data-meaning-start")));
    const b = sections.find((section) => section.dataset.locationKey.includes(".") && rowsOf(section).length >= 1);
    if (!a || !r || !b || sections.indexOf(a) > sections.indexOf(r) || sections.indexOf(r) > sections.indexOf(b)) return null;
    const e = sections.find((section) => section.dataset.locationKey.includes(".") && !section.hasAttribute("data-na") && rowsOf(section).length === 0 && section.querySelector('[data-testid^="output-c-empty-"]') && section.getBoundingClientRect().top - b.getBoundingClientRect().bottom > 100);
    // 좁은 틀에서 잴 빈 하위 칸(B 바로 뒤의 것)과 N/A 칸
    const nextEmpty = sections.slice(sections.indexOf(b) + 1).find((section) => section.dataset.locationKey.includes(".") && !section.hasAttribute("data-na") && rowsOf(section).length === 0);
    const na = sheet.querySelector("section[data-na]");
    if (!e || !nextEmpty || !na) return null;
    const between = rowsOf(r).find((row, i) => i > 0 && row.hasAttribute("data-meaning-start"));
    return {
      a: { key: a.dataset.locationKey, number: numberOf(a), ids: rowsOf(a).map((row) => row.dataset.flipKey) },
      r: { key: r.dataset.locationKey, ids: rowsOf(r).map((row) => row.dataset.flipKey), between: between.dataset.flipKey },
      b: { key: b.dataset.locationKey, number: numberOf(b), first: rowsOf(b)[0].dataset.flipKey },
      e: { key: e.dataset.locationKey, number: numberOf(e) },
      nextEmpty: nextEmpty.dataset.locationKey,
      na: na.dataset.locationKey,
    };
  });
  check("an SOP has a section, a later section with two meaning groups, a sub-slot with lines, empty sub-slots and an N/A section", Boolean(hit));
  const [docId, { a, r, b, e, nextEmpty, na }] = hit;
  // 덩어리 = A의 첫 줄을 누르면 함께 가는 줄(데모 시드에서는 A의 두 줄 - 같은 의미의 한/영 짝)
  const lead = a.ids[0];
  const puts = [];
  const bodies = [];
  page.on("request", (request) => {
    if (!isOrderSave(request)) return;
    puts.push(request.url());
    bodies.push(request.postDataJSON());
  });
  const readNoteNumber = (note) => note.replace(/^→ /, "");

  // 1. A의 덩어리를 R의 두 의미 묶음 사이로 - 표에 R에서 받을 번호(둘째 묶음 첫 줄의 지금 번호), 놓으면 하나 저장, 그 칸에서 그 번호, 놓은 줄이 번쩍인다
  const expectedBetween = await readRowNumber(page, r.between);
  await scrollRowToTop(page, lead);
  const rBetween = await page.locator(`[data-testid="output-c-row-${r.between}"]`).boundingBox();
  await dragThrough(page, await pointInRow(page, lead), [{ x: rBetween.x + 40, y: rBetween.y + 2 }]);
  const overR = { card: await readDragCard(page), section: await readSectionState(page, r.key), home: await readSectionState(page, a.key) };
  check("over another section the card shows the number the line will get there", !overR.card.refused && overR.card.note === `→ ${expectedBetween}` && overR.section?.drop === "over" && overR.section.opacity === 1 && overR.home?.opacity === 1, JSON.stringify(overR));
  const fitR = await readOutlineFit(page, r.key);
  check("the outline of a section with lines clears its heading, numbers, text and the drop line", isOutlineClear(fitR), JSON.stringify(fitR));
  const barDragged = await readBarClear(page, lead);
  check("while dragging, the pressed row's left bar clears its number", barDragged.clear !== null && barDragged.clear >= 1, JSON.stringify(barDragged));
  const firstSave = waitOrderSave(page);
  await page.mouse.up();
  const flashedFirst = await waitFlash(page, lead);
  check("dropping it saves once and the line lands between the groups with that number", (await firstSave).ok() && puts.length === 1 && (await readRowKey(page, lead)) === r.key && (await readRowNumber(page, lead)) === expectedBetween && flashedFirst, JSON.stringify({ puts: puts.length, key: await readRowKey(page, lead), number: await readRowNumber(page, lead), flashedFirst }));
  check("the saved request carries the new slot and the depth of every moved line", a.ids.every((id) => bodies[0]?.items.some((item) => String(item.target_id) === id && item.slot_key === r.key && "indent_level" in item)), JSON.stringify(bodies[0]?.items.filter((item) => a.ids.includes(String(item.target_id)))));
  check("the drag left no marks", Object.values(await readDragMarks(page)).every((value) => !value), JSON.stringify(await readDragMarks(page)));
  await reopenOrderDoc(page, docId, lead);
  const rAfter = await readSectionIds(page, r.key);
  const at = rAfter.indexOf(r.between);
  check("after a reload the block is still between the two groups", (await readRowKey(page, lead)) === r.key && JSON.stringify(rAfter.slice(at - a.ids.length, at)) === JSON.stringify(a.ids), JSON.stringify(rAfter));

  // 2. 하위 칸 B의 끝으로 - B 위를 20번 움직여도 React는 다시 그리지 않는다(G11). 표는 B에서 받을 번호
  await scrollRowToTop(page, lead, 120);
  const bEnd = await pointInSectionEnd(page, b.key);
  await dragThrough(page, await pointInRow(page, lead), [bEnd]);
  const overB = await readDragCard(page);
  const fitB = await readOutlineFit(page, b.key);
  check("the outline of a sub-slot clears its heading, numbers, text and the drop line", isOutlineClear(fitB), JSON.stringify(fitB));
  await takeShot("order-xsec-note.png");
  const commitsBefore = await page.evaluate(() => window.__commits ?? -1);
  for (let i = 0; i < 20; i += 1) await page.mouse.move(bEnd.x + (i % 5), bEnd.y - (i % 3));
  const commitsAfter = await page.evaluate(() => window.__commits ?? -1);
  check("no React commit while dragging over another section", commitsBefore > 0 && commitsBefore === commitsAfter, `${commitsBefore} -> ${commitsAfter}`);
  const subSave = waitOrderSave(page);
  await page.mouse.up();
  const flashedSub = await waitFlash(page, lead);
  // 미끄러짐(--dur-slow 240ms)이 끝나고 테두리가 아직 진할 때(처음 35%)
  await page.waitForTimeout(300);
  await takeShot("order-xsec-landed.png");
  check("dropping into a sub-slot moves it there with the number the card showed", overB.src.includes(lead) && overB.note.startsWith(`→ ${b.number}.`) && (await subSave).ok() && (await readRowKey(page, lead)) === b.key && (await readRowNumber(page, lead)) === readNoteNumber(overB.note) && flashedSub, JSON.stringify({ overB, key: await readRowKey(page, lead), number: await readRowNumber(page, lead), flashedSub }));

  // 3. 빈 칸 E로 - 표는 E의 첫 번호, 놓으면 그 칸의 첫 줄들이 되고 다시 받아도 남는다
  await scrollRowToTop(page, lead, 120);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, e.key)]);
  const overE = { card: await readDragCard(page), section: await readSectionState(page, e.key), lineShown: (await readDragMarks(page)).lineShown };
  const fitE = await readOutlineFit(page, e.key);
  check("the outline of an empty section clears its heading, the dash and the drop line", isOutlineClear(fitE), JSON.stringify(fitE));
  await takeShot("order-xsec-empty.png");
  check("over an empty section the card shows its first number and the line is drawn", overE.card.src.includes(lead) && overE.card.note === `→ ${e.number}.1` && overE.section?.drop === "over" && overE.lineShown, JSON.stringify(overE));
  const emptySave = waitOrderSave(page);
  await page.mouse.up();
  check("dropping into an empty section saves", (await emptySave).ok());
  await reopenOrderDoc(page, docId, lead);
  check("after a reload the block is the empty section's first lines", JSON.stringify(await readSectionIds(page, e.key)) === JSON.stringify(a.ids) && (await readRowNumber(page, lead)) === `${e.number}.1`, JSON.stringify({ ids: await readSectionIds(page, e.key), number: await readRowNumber(page, lead) }));

  // 4. 되돌린다 - E에서 R의 두 묶음 사이로, 거기서 빈 A로(한 화면에 든 칸끼리)
  await scrollRowToTop(page, r.between, 100);
  const backPoint = await page.locator(`[data-testid="output-c-row-${r.between}"]`).boundingBox();
  const viaR = waitOrderSave(page);
  await dragThrough(page, await pointInRow(page, lead), [{ x: backPoint.x + 40, y: backPoint.y + 2 }]);
  await page.mouse.up();
  check("on the way back the block lands between the groups again", (await viaR).ok() && (await readRowKey(page, lead)) === r.key, String(await readRowKey(page, lead)));
  // 빈 A는 R 바로 위 - 덩어리 줄을 틀 아래쪽에 두면(스크롤이 0에서 멈춰도) 둘이 한 화면에 든다
  await scrollRowToTop(page, lead, 450);
  const toA = waitOrderSave(page);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, a.key)]);
  const overA = await readDragCard(page);
  await page.mouse.up();
  check("the block goes back into the empty first section", overA.note === `→ ${a.number}.1` && (await toA).ok(), JSON.stringify(overA));
  await reopenOrderDoc(page, docId, lead);
  check("after a reload both sections are as they were", JSON.stringify(await readSectionIds(page, a.key)) === JSON.stringify(a.ids) && JSON.stringify(await readSectionIds(page, r.key)) === JSON.stringify(r.ids), JSON.stringify({ a: await readSectionIds(page, a.key), r: await readSectionIds(page, r.key) }));

  // 5. 다른 칸 위에서 Esc - 저장 없음, 표시는 모두 치워지고 줄은 그대로
  await scrollRowToTop(page, r.ids[0], 120);
  const escPuts = puts.length;
  await dragThrough(page, await pointInRow(page, r.ids[0]), [await pointInSectionEnd(page, b.key)]);
  const escOver = await readSectionState(page, b.key);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(400);
  const escMarks = await readDragMarks(page);
  check("Esc over another section cancels and cleans up", escOver?.drop === "over" && puts.length === escPuts && Object.values(escMarks).every((value) => !value) && JSON.stringify(await readSectionIds(page, r.key)) === JSON.stringify(r.ids), JSON.stringify({ escOver, escMarks, puts: puts.length - escPuts }));

  // 6. 단추와 글쇠는 칸 끝에서 멈춘다 - B 첫 줄의 Move up은 꺼져 있고, 고른 채 Alt+↑도 아무것도 저장하지 않는다
  const upDisabled = await page.locator(`[data-testid="output-c-move-up-${b.first}"]`).isDisabled();
  await page.locator(`[data-testid="output-c-row-${b.first}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="output-c-row-${b.first}"]`).click({ position: { x: 4, y: 4 } });
  const keyPuts = puts.length;
  const barAtRest = await readBarClear(page, b.first);
  check("a selected row's left bar clears its number", barAtRest.clear !== null && barAtRest.clear >= 1, JSON.stringify(barAtRest));
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForTimeout(400);
  check("Move up and Alt+ArrowUp stop at the top of the section", upDisabled && puts.length === keyPuts && (await readRowKey(page, b.first)) === b.key, JSON.stringify({ upDisabled, puts: puts.length - keyPuts }));

  // 7. 좁은 틀(900)·다크에서도 테두리가 글자와 선에 닿지 않는다 - 줄이 있는 칸(A), 줄이 있는 하위 칸(B), 빈 하위 칸, 거절(N/A 칸). 모두 Esc로 끝내 저장하지 않는다
  await page.evaluate(() => window.localStorage.setItem("sopa.theme", "dark"));
  await page.setViewportSize({ width: 900, height: 720 });
  await reopenOrderDoc(page, docId, lead);
  const narrowPuts = puts.length;
  const narrow = { dark: await page.evaluate(() => document.documentElement.getAttribute("data-theme") === "dark"), fits: {} };
  const measureOver = async (from, keys, shot) => {
    await dragThrough(page, await pointInRow(page, from), []);
    for (const key of keys) {
      await page.mouse.move((await pointInRow(page, from)).x, (await pointInSectionEnd(page, key)).y, { steps: 12 });
      narrow.fits[key] = await readOutlineFit(page, key);
    }
    if (shot) await takeShot(shot);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  await scrollRowToTop(page, r.ids[0], 300);
  await measureOver(r.ids[0], [a.key], null);
  await scrollRowToTop(page, r.ids[0], 60);
  await measureOver(r.ids[0], [b.key, nextEmpty], "order-xsec-narrow-dark.png");
  await scrollRowToTop(page, b.first, 60);
  await measureOver(b.first, [na], null);
  await page.waitForTimeout(300);
  check("at 900 in dark the outline clears the text and the drop line (lines, sub-slot, empty sub-slot, refused N/A)", narrow.dark && Object.keys(narrow.fits).length === 4 && Object.values(narrow.fits).every(isOutlineClear) && narrow.fits[na]?.drop === "refused" && puts.length === narrowPuts, JSON.stringify(narrow));
});

// WI는 같은 부분끼리만 - 데모 시드 WI-01: Step 2 · Instruction의 의미 짝을 Step 3 · Instruction(줄 하나)의 끝으로. 지나는 길의 Step 2 · Why 위에서는 거절된다.
// 되돌릴 때는 빈 Step 2 · Instruction으로
await runStep("order: drag a WI line to another step", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 줄이 있는 step:N:instruction, 그 바로 뒤의 step:N:why, 줄이 있는 다른 step:M:instruction
  const [hit] = await findOrderDocs(page, () => {
    const sections = [...document.querySelectorAll('[data-testid="output-c"] section[data-location-key]')];
    const rowsOf = (section) => [...section.querySelectorAll("[data-drag-box]")];
    for (let i = 0; i + 2 < sections.length; i += 1) {
      const from = /^step:(\d+):instruction$/.exec(sections[i].dataset.locationKey);
      const why = sections[i + 1].dataset.locationKey;
      if (!from || why !== `step:${from[1]}:why` || rowsOf(sections[i]).length === 0) continue;
      const to = sections.slice(i + 2).find((section) => /^step:\d+:instruction$/.test(section.dataset.locationKey) && rowsOf(section).length > 0);
      if (!to) continue;
      return { from: sections[i].dataset.locationKey, why, to: to.dataset.locationKey, ids: rowsOf(sections[i]).map((row) => row.dataset.flipKey), toStep: Number(to.dataset.locationKey.split(":")[1]) };
    }
    return null;
  });
  check("a WI has a step instruction with lines, its why, and a later step instruction with lines", Boolean(hit));
  const [docId, wi] = hit;
  const lead = wi.ids[0];
  const bodies = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) bodies.push(request.postDataJSON());
  });
  await scrollRowToTop(page, lead);
  const from = await pointInRow(page, lead);
  await dragThrough(page, from, [await pointInSectionEnd(page, wi.why)]);
  const overWhy = { card: await readDragCard(page), section: await readSectionState(page, wi.why) };
  const whyFit = await readOutlineFit(page, wi.why);
  check("over the other part (Why) the drag is refused with its reason", overWhy.card.refused && overWhy.card.text.includes("Instruction or Why: change it in Assign") && overWhy.section?.drop === "refused" && isOutlineClear(whyFit), JSON.stringify({ ...overWhy, whyFit }));
  await page.mouse.move(from.x, (await pointInSectionEnd(page, wi.to)).y, { steps: 12 });
  const overTo = await readDragCard(page);
  // 받을 수 없는 다른 부분(Why)은 그 위에 있지 않아도 끄는 내내 흐리고, 받는 칸은 흐리지 않다
  const dimmed = { why: await readSectionState(page, wi.why), to: await readSectionState(page, wi.to) };
  check("while dragging, the other part (Why) is dimmed and the target step is not", overWhy.section?.opacity < 1 && dimmed.why?.opacity < 1 && dimmed.why.drop === null && dimmed.to?.opacity === 1, JSON.stringify({ overWhy: overWhy.section, ...dimmed }));
  const saved = waitOrderSave(page);
  await page.mouse.up();
  const savedOk = (await saved).ok();
  const whyAfter = await readSectionState(page, wi.why);
  check("after the drop the other part is no longer dimmed and no marks are left", whyAfter?.opacity === 1 && (await readDragMarks(page)).marks === 0, JSON.stringify({ whyAfter, marks: await readDragMarks(page) }));
  const moved = bodies[0]?.items.filter((item) => wi.ids.includes(String(item.target_id))) ?? [];
  check("dropping into another step's instruction sends the new step and depth", !overTo.refused && overTo.note.startsWith(`→ ${wi.toStep}.`) && savedOk && moved.length === wi.ids.length && moved.every((item) => item.wi_step === wi.toStep && "indent_level" in item), JSON.stringify({ overTo, moved }));
  await reopenOrderDoc(page, docId, lead);
  check("after a reload the lines are in the other step", (await readRowKey(page, lead)) === wi.to && JSON.stringify((await readSectionIds(page, wi.to)).slice(-wi.ids.length)) === JSON.stringify(wi.ids), JSON.stringify(await readSectionIds(page, wi.to)));
  // 되돌린다 - 비어 있는 원래 칸으로
  await scrollRowToTop(page, lead, 300);
  const back = waitOrderSave(page);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, wi.from)]);
  await page.mouse.up();
  await back;
  await reopenOrderDoc(page, docId, lead);
  check("dragging back restores the step", JSON.stringify(await readSectionIds(page, wi.from)) === JSON.stringify(wi.ids), JSON.stringify(await readSectionIds(page, wi.from)));
});

// 이미 쓴 문서의 줄은 자기 칸을 떠나지 못한다 - 데모 시드 WI-04(이미 쓴 WI, 칸 셋 1. Preparation · 2. Operation · 3. After use). 데모 시드에 이미 쓴 SOP는 없다
await runStep("order: a written document's block cannot leave its section", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    if (document.querySelector('[data-testid="output-c"] article header span.font-mono')?.textContent !== "WI-04") return null;
    const sections = [...document.querySelectorAll('[data-testid="output-c"] section[data-location-key]')].filter((section) => section.querySelector("[data-drag-box]"));
    return sections.length >= 2 ? { from: sections[0].querySelector("[data-drag-box]").dataset.flipKey, fromKey: sections[0].dataset.locationKey, to: sections[1].dataset.locationKey } : null;
  });
  check("the already-written WI-04 has two sections with lines", Boolean(hit));
  const [, written] = hit;
  const order = await readSectionIds(page, written.fromKey);
  const puts = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) puts.push(request.url());
  });
  await scrollRowToTop(page, written.from);
  await dragThrough(page, await pointInRow(page, written.from), [await pointInSectionEnd(page, written.to)]);
  const over = { card: await readDragCard(page), section: await readSectionState(page, written.to), locked: await page.evaluate(() => document.querySelectorAll("[data-drag-locked]").length) };
  check("over another section the written block is refused with the step reason and the other sections are dimmed", over.card.refused && over.card.text.includes("Only sentences written here for a WI can change step.") && over.section?.drop === "refused" && over.section.opacity < 1 && over.locked === 1, JSON.stringify(over));
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("releasing it saves nothing", puts.length === 0 && JSON.stringify(await readSectionIds(page, written.fromKey)) === JSON.stringify(order), JSON.stringify({ puts: puts.length, order: await readSectionIds(page, written.fromKey) }));
});

// 저장이 날아가는 동안 다른 칸에 놓기 - 데모 시드 SOP-CF: 4 Responsibilities의 둘째 묶음 첫 줄을 Alt+↓로 옮긴 저장을 붙잡은 채 1 Purpose의 덩어리를 2 Scope 끝에 놓는다.
// 둘째 저장은 첫 응답 뒤에 나가고 둘 다 남는다. 끝에 둘 다 되돌린다
await runStep("order: a drop into another section while a save is in flight is re-applied after it", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    const sheet = document.querySelector('[data-testid="output-c"] article[data-doc-id]');
    if (!sheet || sheet.querySelector("header .tag")?.textContent !== "SOP") return null;
    const sections = [...sheet.querySelectorAll("section[data-location-key]")];
    const rowsOf = (section) => [...section.querySelectorAll("[data-drag-box]")];
    // A·S는 줄이 한 의미 묶음뿐인 칸 - 앞 단계가 첫 칸에 표를 더하면 그 칸은 두 덩어리다(위 단계와 같은 까닭)
    const [a, s] = sections.filter((section) => rowsOf(section).length >= 2 && !rowsOf(section).some((row, i) => i > 0 && row.hasAttribute("data-meaning-start")));
    const r = sections.find((section) => rowsOf(section).length >= 4 && rowsOf(section).some((row, i) => i > 0 && row.hasAttribute("data-meaning-start")));
    if (!a || !s || !r || r === a || r === s) return null;
    return {
      a: { key: a.dataset.locationKey, ids: rowsOf(a).map((row) => row.dataset.flipKey) },
      s: { key: s.dataset.locationKey, ids: rowsOf(s).map((row) => row.dataset.flipKey) },
      r: { key: r.dataset.locationKey, ids: rowsOf(r).map((row) => row.dataset.flipKey), mover: rowsOf(r).find((row, i) => i > 0 && row.hasAttribute("data-meaning-start")).dataset.flipKey },
    };
  });
  check("an SOP has two sections with lines and a section with two meaning groups", Boolean(hit));
  const [docId, { a, s, r }] = hit;
  const lead = a.ids[0];
  // 요청·응답이 오간 차례
  const events = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) events.push("request");
  });
  page.on("response", (response) => {
    if (isOrderSave(response.request())) events.push(`response ${response.status()}`);
  });
  let release = null;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let holdOnce = true;
  await page.route(/\/targets\/order/, async (route) => {
    if (route.request().method() !== "PUT" || !holdOnce) return route.continue();
    holdOnce = false;
    await held;
    await route.continue();
  });
  await page.locator(`[data-testid="output-c-row-${r.mover}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="output-c-row-${r.mover}"]`).click({ position: { x: 4, y: 4 } });
  const firstSave = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  // 옮긴 줄을 따라가는 스크롤이 멈춘 뒤 덩어리 줄을 틀 위쪽에 둔다
  await page.waitForTimeout(600);
  await scrollRowToTop(page, lead);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, s.key)]);
  const over = await readDragCard(page);
  await page.mouse.up();
  const shown = await readRowKey(page, lead);
  await page.waitForTimeout(300);
  const whileHeld = [...events];
  let saveResponses = 0;
  const secondSave = page.waitForResponse((response) => isOrderSave(response.request()) && (saveResponses += 1) === 2, { timeout: T });
  release();
  check("the first save lands", (await firstSave).ok());
  const second = await secondSave;
  await page.waitForTimeout(300);
  check("the drop shows at once and its save waits for the first response", !over.refused && shown === s.key && JSON.stringify(whileHeld) === JSON.stringify(["request"]) && JSON.stringify(events) === JSON.stringify(["request", "response 200", "request", "response 200"]) && second.ok(), JSON.stringify({ over, shown, whileHeld, events }));
  await page.unroute(/\/targets\/order/);
  await reopenOrderDoc(page, docId, lead);
  const rIds = await readSectionIds(page, r.key);
  check("after a reload both changes persisted", JSON.stringify((await readSectionIds(page, s.key)).slice(-a.ids.length)) === JSON.stringify(a.ids) && rIds.indexOf(r.mover) === r.ids.indexOf(r.mover) + 1, JSON.stringify({ s: await readSectionIds(page, s.key), r: rIds }));
  // 되돌린다 - 덩어리를 빈 첫 칸으로, 옮긴 줄은 Alt+↑로
  await scrollRowToTop(page, s.ids[0], 200);
  const back = waitOrderSave(page);
  await dragThrough(page, await pointInRow(page, lead), [await pointInSectionEnd(page, a.key)]);
  await page.mouse.up();
  await back;
  await page.locator(`[data-testid="output-c-row-${r.mover}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="output-c-row-${r.mover}"]`).click({ position: { x: 4, y: 4 } });
  const up = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowUp");
  await up;
  await reopenOrderDoc(page, docId, lead);
  check("both changes are undone", JSON.stringify(await readSectionIds(page, a.key)) === JSON.stringify(a.ids) && JSON.stringify(await readSectionIds(page, r.key)) === JSON.stringify(r.ids), JSON.stringify({ a: await readSectionIds(page, a.key), r: await readSectionIds(page, r.key) }));
});

// 끄는 동안 칸이 바뀐다 - 앞선 저장의 응답이 끄는 도중 닿으면 선은 새 데이터로 다시 세고 놓은 자리가 선과 같다.
// 앞선 저장이 실패해 되돌려지며 덩어리가 바뀌면 그 끌기는 거절되고 놓아도 저장하지 않는다. 응답은 page.route로 붙잡아 끄는 도중에 푼다
await runStep("order: a save landing mid-drag keeps the drop line and the saved order together, a rollback refuses the drag", { allowConsoleErrors: true }, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 첫 두 줄이 같은 의미 짝(F·R)이고, 셋째 줄 뒤에 깊이 0의 의미 묶음 첫 줄 L이 있는 짧은 칸
  const [hit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const rows = [...section.querySelectorAll("[data-drag-box]")];
      if (rows.length < 4 || rows[1].hasAttribute("data-meaning-start")) continue;
      const starts = rows.filter((row, index) => index > 1 && row.hasAttribute("data-meaning-start") && row.querySelector('[data-testid^="output-c-item-"]') && getComputedStyle(row.querySelector(".c-line")).paddingLeft === "0px");
      if (starts.length === 0 || rows.at(-1).getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top > 420) continue;
      return { ids: rows.map((row) => row.dataset.flipKey), l: starts.at(-1).dataset.flipKey };
    }
    return null;
  });
  check("Order has a short section that starts with a same-meaning pair and has a later meaning group", Boolean(hit));
  const [docId, { ids: original, l }] = hit;
  const [first, second] = original;
  const rowOf = (id) => page.locator(`[data-testid="output-c-row-${id}"]`);
  const readOrder = () => page.evaluate((id) => [...(document.querySelector(`[data-testid="output-c-row-${id}"]`)?.closest("section")?.querySelectorAll("[data-drag-box]") ?? [])].map((row) => row.dataset.flipKey), l);
  const centre = () => rowOf(first).evaluate((el) => el.scrollIntoView({ block: "center" }));
  const pointIn = async (id) => {
    const box = await page.locator(`[data-testid="output-c-item-${id}"]`).boundingBox();
    return { x: box.x + Math.min(40, box.width / 2), y: box.y + 8 };
  };
  // 끄는 중의 상태 - 선이 그어진 줄(선 바로 아래의 덩어리 밖 줄, 없으면 칸 끝)과 덩어리 줄
  const readDrag = () => page.evaluate(() => {
    const line = document.querySelector('[data-testid="output-c-dropline"]');
    const home = document.querySelector("[data-drag-home]");
    const card = document.querySelector('[data-testid="drag-card"]');
    const top = line.getBoundingClientRect().top;
    const below = home && !line.hidden ? [...home.querySelectorAll("[data-drag-box]:not([data-drag-src])")].find((row) => row.getBoundingClientRect().top >= top - 1) : null;
    return {
      flag: document.documentElement.hasAttribute("data-box-drag"),
      lineShown: !line.hidden,
      before: below?.dataset.flipKey ?? null,
      block: home ? [...home.querySelectorAll("[data-drag-src]")].map((row) => row.dataset.flipKey) : [],
      refused: card?.hasAttribute("data-refused") ?? false,
      note: card?.textContent ?? "",
    };
  });
  const puts = [];
  page.on("request", (request) => {
    if (isOrderSave(request)) puts.push(request.url());
  });
  // 다음 저장 하나를 붙잡는다 - 돌려준 함수를 부르면 서버로 보내거나("ok") 500으로 끝낸다("fail")
  let gate = null;
  const holdNextSave = (mode) => {
    let open = null;
    const promise = new Promise((resolve) => {
      open = resolve;
    });
    gate = { mode, promise };
    return open;
  };
  await page.route(/\/targets\/order/, async (route) => {
    const held = gate;
    if (route.request().method() !== "PUT" || held === null) return route.continue();
    gate = null;
    await held.promise;
    if (held.mode === "fail") await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "synthetic failure" }) });
    else await route.continue();
  });
  const jiggle = async (x, y) => {
    for (let i = 0; i < 5; i += 1) await page.mouse.move(x + i, y + (i % 2));
  };

  // 1. F를 Alt+↓로 옮긴 저장을 붙잡은 채 L을 칸 맨 위(R 위)로 끌고, 끄는 도중 그 응답을 푼다
  await centre();
  const openOk = holdNextSave("ok");
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const heldSave = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  check("the held move shows at once", (await readOrder())[1] === first, JSON.stringify(await readOrder()));
  // 두 줄이 미끄러지는(useFlip) 동안 잰 자리는 끝 자리가 아니다 - 멈춘 뒤 잰다
  await page.waitForTimeout(600);
  const from = await pointIn(l);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const target = { x: from.x, y: (await rowOf(second).boundingBox()).y + 2 };
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const beforeLanding = await readDrag();
  openOk();
  check("the held save lands while dragging", (await heldSave).ok());
  await page.waitForTimeout(200);
  await jiggle(target.x, target.y);
  const afterLanding = await readDrag();
  check("the drag survives a save landing mid-drag and still shows the line", beforeLanding.lineShown && afterLanding.flag && afterLanding.lineShown && !afterLanding.refused && afterLanding.before === second, JSON.stringify({ beforeLanding, afterLanding }));
  const dropSave = waitOrderSave(page);
  await page.mouse.up();
  check("the drop after the landed save saves", (await dropSave).ok());
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await rowOf(l).waitFor({ timeout: T });
  const saved = await readOrder();
  const at = saved.indexOf(afterLanding.block[0]);
  check("the saved order puts the block right above the line it was drawn at", afterLanding.block.length > 0 && JSON.stringify(saved.slice(at, at + afterLanding.block.length)) === JSON.stringify(afterLanding.block) && saved[at + afterLanding.block.length] === afterLanding.before, JSON.stringify({ saved, afterLanding }));
  // 되돌린다 - 덩어리를 원래 다음 줄 앞(없으면 칸 끝)에 놓고 F를 Alt+↑로 한 자리 올린다
  await centre();
  const next = original[original.indexOf(afterLanding.block.at(-1)) + 1] ?? null;
  const backFrom = await pointIn(l);
  const nextBox = await rowOf(next ?? saved.at(-1)).boundingBox();
  await page.mouse.move(backFrom.x, backFrom.y);
  await page.mouse.down();
  await page.mouse.move(backFrom.x, next ? nextBox.y + 2 : nextBox.y + nextBox.height + 6, { steps: 12 });
  const back = waitOrderSave(page);
  await page.mouse.up();
  await back;
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const up = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowUp");
  check("the order is restored", (await up).ok() && JSON.stringify(await readOrder()) === JSON.stringify(original), JSON.stringify(await readOrder()));

  // 2. F를 Alt+↓로 옮긴 저장을 붙잡은 채 F(짝 R과 한 덩어리)를 칸 끝으로 끌고, 그 저장을 실패시킨다 - 되돌려지며 덩어리 순서가 바뀌어 거절된다
  await centre();
  const openFail = holdNextSave("fail");
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const failedSave = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(600);
  const fFrom = await pointIn(first);
  const lastBox = await rowOf(original.at(-1)).boundingBox();
  await page.mouse.move(fFrom.x, fFrom.y);
  await page.mouse.down();
  const end = { x: fFrom.x, y: lastBox.y + lastBox.height + 6 };
  await page.mouse.move(end.x, end.y, { steps: 12 });
  const beforeFailure = await readDrag();
  openFail();
  check("the held save fails while dragging", (await failedSave).status() === 500);
  await page.waitForTimeout(300);
  await jiggle(end.x, end.y);
  const afterFailure = await readDrag();
  check("a rollback that changes the block refuses the drag with a reason", beforeFailure.lineShown && beforeFailure.block.length >= 2 && afterFailure.flag && afterFailure.refused && afterFailure.note.includes("The lines changed while dragging") && !afterFailure.lineShown, JSON.stringify({ beforeFailure, afterFailure }));
  const refusedPuts = puts.length;
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("releasing a refused drag saves nothing", puts.length === refusedPuts && JSON.stringify(await readOrder()) === JSON.stringify(original), JSON.stringify(await readOrder()));

  // 3. L을 칸 맨 위로 놓은 저장을 붙잡은 채 L을 원래 자리로 다시 끌어 멈춘다. 멈춘 채 앞 저장의 응답이 닿고, 움직이지 않고 놓는다 - 두 번째 놓기도 저장된다
  await centre();
  const openFirst = holdNextSave("ok");
  const firstDrop = waitOrderSave(page);
  const aFrom = await pointIn(l);
  await page.mouse.move(aFrom.x, aFrom.y);
  await page.mouse.down();
  await page.mouse.move(aFrom.x, (await rowOf(first).boundingBox()).y + 2, { steps: 12 });
  await page.mouse.up();
  const heldOrder = await readOrder();
  check("the first drop shows at once while its save is held", heldOrder[0] === l, JSON.stringify(heldOrder));
  await page.waitForTimeout(600);
  const heldBlock = heldOrder.slice(0, heldOrder.indexOf(first));
  const home = original[original.indexOf(heldBlock.at(-1)) + 1] ?? null;
  const bFrom = await pointIn(l);
  const homeBox = await rowOf(home ?? heldOrder.at(-1)).boundingBox();
  await page.mouse.move(bFrom.x, bFrom.y);
  await page.mouse.down();
  await page.mouse.move(bFrom.x, home ? homeBox.y + 2 : homeBox.y + homeBox.height + 6, { steps: 12 });
  const stillDrag = await readDrag();
  openFirst();
  check("the held first drop lands while the second drag holds still", (await firstDrop).ok());
  // 응답이 화면에 커밋될 때까지 기다린다 - 포인터는 움직이지 않는다
  await page.waitForTimeout(400);
  const secondDrop = page.waitForResponse((response) => isOrderSave(response.request()), { timeout: 3000 }).catch(() => null);
  await page.mouse.up();
  const secondSaved = await secondDrop;
  check("releasing without moving after the save landed saves the second drop", stillDrag.lineShown && stillDrag.before === home && secondSaved?.ok() === true, JSON.stringify({ stillDrag, home, saved: secondSaved?.status() ?? null }));
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await rowOf(l).waitFor({ timeout: T });
  check("after a reload the second drop persisted (the order is back)", JSON.stringify(await readOrder()) === JSON.stringify(original), JSON.stringify(await readOrder()));

  // 4. F를 Alt+↓로 옮긴 저장(덩어리 L과 무관)을 붙잡은 채 L을 칸 맨 위로 끌어 멈추고, 멈춘 채 그 저장을 실패시킨다 - 칸 모양이 바뀌어 놓은 자리에서 다시 센다.
  //    포인터는 여전히 칸 첫 줄의 위쪽 절반 위라 L 덩어리는 칸 맨 위(되돌아온 F 앞)에 저장된다
  await centre();
  const openRollback = holdNextSave("fail");
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const rolledBack = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(600);
  const cFrom = await pointIn(l);
  await page.mouse.move(cFrom.x, cFrom.y);
  await page.mouse.down();
  await page.mouse.move(cFrom.x, (await rowOf(second).boundingBox()).y + 2, { steps: 12 });
  const beforeRollback = await readDrag();
  openRollback();
  check("the held unrelated save fails while the drag holds still", (await rolledBack).status() === 500);
  await page.waitForTimeout(400);
  const replanned = page.waitForResponse((response) => isOrderSave(response.request()), { timeout: 3000 }).catch(() => null);
  await page.mouse.up();
  const replannedSave = await replanned;
  check("releasing without moving after the shape changed plans again and saves", beforeRollback.lineShown && beforeRollback.before === second && replannedSave?.ok() === true, JSON.stringify({ beforeRollback, saved: replannedSave?.status() ?? null }));
  await page.reload();
  await page.locator(`[data-testid="order-doc-${docId}"]`).click();
  await rowOf(l).waitFor({ timeout: T });
  const replannedOrder = await readOrder();
  const lBlock = replannedOrder.slice(0, replannedOrder.indexOf(first));
  check("the block was saved at the top of the section, above the rolled-back first line", lBlock[0] === l && JSON.stringify(replannedOrder.slice(lBlock.length)) === JSON.stringify(original.filter((id) => !lBlock.includes(id))), JSON.stringify(replannedOrder));
  // 되돌린다 - 덩어리를 원래 다음 줄 앞(없으면 칸 끝)에
  await centre();
  const lNext = original[original.indexOf(lBlock.at(-1)) + 1] ?? null;
  const dFrom = await pointIn(l);
  const lNextBox = await rowOf(lNext ?? replannedOrder.at(-1)).boundingBox();
  await page.mouse.move(dFrom.x, dFrom.y);
  await page.mouse.down();
  await page.mouse.move(dFrom.x, lNext ? lNextBox.y + 2 : lNextBox.y + lNextBox.height + 6, { steps: 12 });
  const restored = waitOrderSave(page);
  await page.mouse.up();
  check("the order is restored again", (await restored).ok() && JSON.stringify(await readOrder()) === JSON.stringify(original), JSON.stringify(await readOrder()));

  // 5. 다른 칸에서 끌어 온 덩어리 - F를 Alt+↓로 옮긴 저장을 붙잡은 채 위쪽 칸(데모 시드 SOP-CF의 1 Purpose)의 덩어리를 이 칸 첫 줄(옮겨 온 R)의 위쪽 절반에 대고 멈추고,
  //    멈춘 채 그 저장을 실패시킨다 - 도착 칸의 모양이 바뀌어 놓은 자리에서 다시 센다. 포인터 밑은 되돌아온 F라 덩어리는 칸 맨 위(F 앞)에 저장된다(낡은 자리면 짝 F·R 사이)
  const above = await page.evaluate((id) => {
    const home = document.querySelector(`[data-testid="output-c-row-${id}"]`).closest("section");
    const sections = [...home.closest("article").querySelectorAll("section[data-location-key]")];
    // 줄이 한 의미 묶음뿐인 칸 - 앞 단계(캡션 없는 표 확정)가 첫 칸 맨 앞에 표를 더하면 그 칸은 두 덩어리다
    const isOneBlock = (section) => ![...section.querySelectorAll("[data-drag-box]")].some((row, i) => i > 0 && row.hasAttribute("data-meaning-start"));
    const source = sections.slice(0, sections.indexOf(home)).find((section) => section.querySelector("[data-drag-box]") && isOneBlock(section));
    return source ? { key: source.dataset.locationKey, ids: [...source.querySelectorAll("[data-drag-box]")].map((row) => row.dataset.flipKey) } : null;
  }, first);
  check("a section with lines sits above it", above !== null);
  const openDestRollback = holdNextSave("fail");
  await rowOf(first).click({ position: { x: 4, y: 4 } });
  const destRolledBack = waitOrderSave(page);
  await page.keyboard.press("Alt+ArrowDown");
  // 옮긴 줄을 따라가는 스크롤이 멈춘 뒤 위쪽 칸의 덩어리 줄을 틀 위쪽에 둔다
  await page.waitForTimeout(600);
  await scrollRowToTop(page, above.ids[0], 120);
  await dragThrough(page, await pointIn(above.ids[0]), [{ x: (await pointIn(above.ids[0])).x, y: (await rowOf(second).boundingBox()).y + 2 }]);
  const beforeDestRollback = await readDragCard(page);
  openDestRollback();
  check("the held save in the destination fails while the drag holds still", (await destRolledBack).status() === 500);
  await page.waitForTimeout(400);
  const crossReplanned = page.waitForResponse((response) => isOrderSave(response.request()), { timeout: 3000 }).catch(() => null);
  await page.mouse.up();
  const crossReplannedSave = await crossReplanned;
  check("releasing without moving after the destination changed plans again and saves", !beforeDestRollback.refused && beforeDestRollback.note.startsWith("→ ") && crossReplannedSave?.ok() === true, JSON.stringify({ beforeDestRollback, saved: crossReplannedSave?.status() ?? null }));
  await reopenOrderDoc(page, docId, l);
  check("the block was saved at the top of the destination, above the rolled-back first line", JSON.stringify(await readOrder()) === JSON.stringify([...above.ids, ...original]), JSON.stringify(await readOrder()));
  // 되돌린다 - 덩어리를 비어 있는 원래 칸으로
  await scrollRowToTop(page, above.ids[0], 400);
  const crossBack = waitOrderSave(page);
  await dragThrough(page, await pointIn(above.ids[0]), [await pointInSectionEnd(page, above.key)]);
  await page.mouse.up();
  await crossBack;
  await reopenOrderDoc(page, docId, l);
  check("both sections are restored", JSON.stringify(await readOrder()) === JSON.stringify(original) && JSON.stringify(await readSectionIds(page, above.key)) === JSON.stringify(above.ids), JSON.stringify({ r: await readOrder(), above: await readSectionIds(page, above.key) }));
  await page.unroute(/\/targets\/order/);
});

await runStep("order: drag is off on a read-only bundle", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const row = page.locator('[data-testid^="output-c-row-"]').nth(1);
  await row.waitFor({ timeout: T });
  check("the reviewer has no edit buttons", (await page.locator('[data-testid^="output-c-move-"]').count()) === 0);
  check("rows are not drag boxes and there is no drag help", (await page.locator("[data-drag-box]").count()) === 0 && (await page.locator('[data-testid="order-drag-help"]').count()) === 0);
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 26, { steps: 5 });
  const state = await page.evaluate(() => ({ flag: document.documentElement.hasAttribute("data-box-drag"), cards: document.querySelectorAll('[data-testid="drag-card"]').length }));
  await page.mouse.up();
  check("no drag starts", !state.flag && state.cards === 0, JSON.stringify(state));
});

await runStep("order: a move chosen from the narrow-frame menu keeps focus on that line's ⋯ button", {}, async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  const [hit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 3) return ids;
    }
    return null;
  });
  check("a section with three lines exists", Boolean(hit));
  const id = hit[1][0];
  const rowSel = `[data-testid="output-c-row-${id}"]`;
  const readOrder = () => page.evaluate((first) => [...(document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section")?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", "")), id);
  const activeId = () => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
  const start = (await readOrder()).indexOf(id);
  await page.locator(rowSel).hover();
  await page.locator(`[data-testid="output-c-menu-${id}"]`).click();
  const moved = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-menu-down-${id}"]`).click();
  check("the menu move saves", (await moved).ok());
  await page.waitForTimeout(400);
  check("the line moved one place", (await readOrder()).indexOf(id) === start + 1);
  check("focus is on the moved line's ⋯ button", (await activeId()) === `output-c-menu-${id}`, await activeId());
  await page.locator(`[data-testid="output-c-menu-${id}"]`).click();
  const back = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-menu-up-${id}"]`).click();
  check("and moves back", (await back).ok() && (await readOrder()).indexOf(id) === start);
});

await runStep("order: mark a line as a note on C, the count continues and the note is italic", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 같은 칸에서 같은 깊이로 이어지는 번호 줄 둘(X, Y) - X를 주석으로 바꾸면 Y가 X의 번호를 이어 받는다
  const pair = await page.evaluate(() => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const rows = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => {
        const id = row.getAttribute("data-testid").replace("output-c-row-", "");
        // 글 줄만(output-c-item) - 표 줄은 기울임을 표에 싣는다
        return { id, number: row.querySelector(`[data-testid="output-c-number-${id}"]`)?.textContent?.trim() ?? null, markable: !!row.querySelector(`[data-testid="output-c-mark-note-${id}"]`), isText: !!row.querySelector(`[data-testid="output-c-item-${id}"]`) };
      });
      for (let i = 0; i + 1 < rows.length; i += 1) {
        const [x, y] = [rows[i], rows[i + 1]];
        if (x.markable && x.isText && x.number && y.number && x.number.split(".").length === y.number.split(".").length) return { x: x.id, y: y.id, xNumber: x.number, yNumber: y.number };
      }
    }
    return null;
  });
  check("C has two numbered lines in a row to mark", pair !== null);
  await page.locator(`[data-testid="output-c-row-${pair.x}"]`).hover();
  const marked = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-mark-note-${pair.x}"]`).click();
  check("the note mark saves", (await marked).ok());
  check("the note has no number", (await page.locator(`[data-testid="output-c-number-${pair.x}"]`).count()) === 0);
  const yAfter = (await page.locator(`[data-testid="output-c-number-${pair.y}"]`).innerText()).trim();
  check("the next numbered line continues the count", yAfter === pair.xNumber, `${pair.yNumber} -> ${yAfter} (expected ${pair.xNumber})`);
  const fontStyle = await page.locator(`[data-testid="output-c-item-${pair.x}"]`).evaluate((node) => getComputedStyle(node).fontStyle);
  check("the note is shown in italics", fontStyle === "italic", fontStyle);
  check("the note button shows as picked", (await page.locator(`[data-testid="output-c-mark-note-${pair.x}"]`).getAttribute("aria-pressed")) === "true");
  await takeShot("sop-outputs-c-note.png");
  // 되돌려 둔다 - 아래 단계와 다시 돌리기가 같은 번호를 본다
  await page.locator(`[data-testid="output-c-row-${pair.x}"]`).hover();
  const unmarked = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-mark-numbered-${pair.x}"]`).click();
  check("the Numbered mark saves", (await unmarked).ok());
  check("Numbered brings the number back", (await page.locator(`[data-testid="output-c-number-${pair.x}"]`).innerText()).trim() === pair.xNumber);
  check("the next line gets its number back", (await page.locator(`[data-testid="output-c-number-${pair.y}"]`).innerText()).trim() === pair.yNumber);
});

// 순서 바꾸기는 화면에서 먼저 자리를 바꾸고 저장은 뒤에서 한 번에 하나씩 보낸다(제품 명세 §7.13 C 순서 바꾸기). 실패하면 되돌리고 알림을 띄운다
await runStep("order: C reorder moves at once, saves one request at a time and rolls back a failed save", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 위·아래 단추가 있는 줄이 넷 이상인 칸 - 첫 줄을 세 번 내릴 수 있다
  const [reorderHit] = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')]
        .filter((row) => row.querySelector('[data-testid^="output-c-move-down-"]'))
        .map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
      if (ids.length >= 4) return ids;
    }
    return null;
  });
  check("a New document has a section with four movable lines", reorderHit !== undefined);
  const [reorderDoc, sectionRows] = reorderHit;
  const readOrder = () => page.evaluate((first) => {
    const section = document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section");
    return [...(section?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
  }, sectionRows[0]);
  const id = sectionRows[0];
  const start = await readOrder();
  const startIndex = start.indexOf(id);

  // 1. 바로 반영·한 번에 하나 - 응답을 600ms 늦추고 동시에 날아가는 PUT과 C·요약 다시 받기를 센다
  let inFlight = 0;
  let maxInFlight = 0;
  let puts = 0;
  let refetches = 0;
  page.on("request", (request) => {
    if (isOrderSave(request)) {
      puts += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
    }
    if (request.method() === "GET" && /\/outputs\/c(\?|$)|\/summary(\?|$)/.test(request.url())) refetches += 1;
  });
  const settle = (request) => {
    if (isOrderSave(request)) inFlight -= 1;
  };
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  // 응답 처리가 다음 요청을 보내기 전 잠깐 0이 될 수 있어, 늦춘 시간보다 길게 0이 이어질 때까지 본다
  const waitSavesIdle = async () => {
    const until = Date.now() + T;
    let quietSince = null;
    while (Date.now() < until) {
      if (inFlight === 0) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince > 900) return true;
      } else {
        quietSince = null;
      }
      await page.waitForTimeout(50);
    }
    return false;
  };
  await page.route("**/targets/order**", async (route) => {
    await new Promise((done) => setTimeout(done, 600));
    await route.continue();
  });
  const down = page.locator(`[data-testid="output-c-move-down-${id}"]`);
  // 기다림 없이 세 번 - 미끄러지는 동안에도 눌린다(좌표 대신 그 단추에 바로 보낸다)
  for (let n = 0; n < 3; n += 1) await down.dispatchEvent("click");
  const moved = await readOrder();
  check("three presses move the line three places before the first response", moved.indexOf(id) === startIndex + 3, `${startIndex} -> ${moved.indexOf(id)} (puts ${puts})`);
  await takeShot("sop-outputs-c-reorder.png");
  check("the saves finish", await waitSavesIdle());
  check("no more than one save is in flight at a time", maxInFlight <= 1, `max ${maxInFlight}`);
  check("the presses merge into at most two saves", puts >= 1 && puts <= 2, `${puts} PUT`);
  check("reordering refetches neither C nor the summary", refetches === 0, `${refetches} GET`);
  await page.reload();
  // 새로 고치면 첫 문서부터 열린다 - 옮긴 문서를 다시 연다
  await page.locator(`[data-testid="order-doc-${reorderDoc}"]`).click();
  await wait(page, `output-c-row-${id}`);
  check("after reload the order is the saved one", JSON.stringify(await readOrder()) === JSON.stringify(moved));

  // 2. 키보드 - 위 단추에 포커스를 두고 Enter 두 번. 포커스는 옮긴 줄의 그 단추에 남는다
  await page.locator(`[data-testid="output-c-move-up-${id}"]`).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const afterKeys = await readOrder();
  check("two Enters move the line up two places", afterKeys.indexOf(id) === startIndex + 1, `${afterKeys.indexOf(id)}`);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  check("focus stays on the pressed button", focused === `output-c-move-up-${id}`, focused);
  check("the keyboard saves finish", await waitSavesIdle());

  // 3. 실패 되돌림 - 한 번만 500(늦춰서 되돌리기 전의 옮긴 자리를 본다)
  await page.unroute("**/targets/order**");
  await page.route("**/targets/order**", async (route) => {
    await new Promise((done) => setTimeout(done, 400));
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  }, { times: 1 });
  const failed = waitOrderSave(page);
  // 5xx는 서버가 저장했을 수 있어 C를 다시 받아 서버 값을 보인다
  const refetchedAfterError = page.waitForResponse((response) => response.request().method() === "GET" && /\/outputs\/c\?/.test(response.url()), { timeout: T });
  await down.dispatchEvent("click");
  check("the line moves at once even when the save will fail", (await readOrder()).indexOf(id) === startIndex + 2);
  await failed;
  await wait(page, "toast-error");
  check("a server error reads C again", (await refetchedAfterError).ok());
  await page.waitForFunction(({ first, index }) => {
    const section = document.querySelector(`[data-testid="output-c-row-${first}"]`)?.closest("section");
    const ids = [...(section?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-testid").replace("output-c-row-", ""));
    return ids.indexOf(first) === index;
  }, { first: id, index: startIndex + 1 }, { timeout: T });
  check("a failed save puts the line back and shows an error", true);
  await takeShot("sop-outputs-c-rollback.png");
  await page.unroute("**/targets/order**");

  // 되돌려 둔다 - 다시 돌려도 같은 자리에서 시작한다
  const restored = waitOrderSave(page);
  await page.locator(`[data-testid="output-c-move-up-${id}"]`).dispatchEvent("click");
  check("the line goes back to where it started", (await restored).ok() && (await readOrder()).indexOf(id) === startIndex);
});

// 저장과 다시 받기가 엇갈려도 저장된 바뀜이 사라지지 않고, 한 번의 409는 알림 하나이며, 떠났다 돌아와도 저장이 겹치지 않는다
await runStep("order: C saves survive a slow refetch, one conflict toasts once, leaving does not race", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/order`);
  await wait(page, "output-c");
  // 문서마다 위·아래 단추가 있는 줄이 셋 이상인 첫 칸 - 그 칸의 첫 줄을 옮긴다
  const raceDocs = await findOrderDocs(page, () => {
    for (const section of document.querySelectorAll('[data-testid="output-c"] section')) {
      const ids = [...section.querySelectorAll('[data-testid^="output-c-row-"]')].filter((row) => row.querySelector('[data-testid^="output-c-move-down-"]')).map((row) => row.getAttribute("data-flip-key"));
      if (ids.length >= 3) return ids;
    }
    return null;
  }, 2);
  check("two New documents have a section of three movable lines", raceDocs.length >= 2, `${raceDocs.length}`);
  const [[firstDoc, first], [secondDoc, second]] = raceDocs;
  // 줄이 든 문서를 먼저 연다 - 화면에는 한 문서만 있다. 문서를 바꿔도 저장을 기다리는 바뀜은 남는다
  const openDocOf = (id) => page.locator(`[data-testid="order-doc-${first.includes(id) ? firstDoc : secondDoc}"]`).click();
  const orderOf = async (id) => {
    await openDocOf(id);
    return page.evaluate((key) => {
      const section = document.querySelector(`[data-testid="output-c-row-${key}"]`)?.closest("section");
      return [...(section?.querySelectorAll('[data-testid^="output-c-row-"]') ?? [])].map((row) => row.getAttribute("data-flip-key"));
    }, id);
  };
  const press = async (dir, id) => {
    await openDocOf(id);
    await page.locator(`[data-testid="output-c-move-${dir}-${id}"]`).dispatchEvent("click");
  };
  let inFlight = 0;
  let maxInFlight = 0;
  page.on("request", (request) => {
    if (isOrderSave(request)) maxInFlight = Math.max(maxInFlight, (inFlight += 1));
  });
  const settle = (request) => {
    if (isOrderSave(request)) inFlight -= 1;
  };
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  const waitIdle = async () => {
    for (let quiet = 0; quiet < 12; ) {
      await page.waitForTimeout(100);
      quiet = inFlight === 0 ? quiet + 1 : 0;
    }
  };
  // 오류 알림이 몇 번 떴는지 - 알림은 몇 초 뒤 사라지므로 나타날 때마다 센다(새로 고치면 다시 건다)
  const countErrorToasts = () => page.evaluate(() => {
    window.__errorToasts = 0;
    const isErrorToast = (node) => node instanceof Element && (node.matches('[data-testid="toast-error"]') || node.querySelector('[data-testid="toast-error"]') !== null);
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (isErrorToast(node)) window.__errorToasts += 1;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await countErrorToasts();
  const errorToasts = () => page.evaluate(() => window.__errorToasts);

  // 1. 다시 받는 C가 저장보다 늦게 오면 - 서버는 바로 읽고(저장 전) 화면에는 1.5초 늦게 준다. 언어를 바꿔 C를 다시 받기 시작한 뒤 누른다
  const firstIndex = (await orderOf(first[0])).indexOf(first[0]);
  let delayedC = 0;
  let deliveredC = 0;
  await page.route(/\/outputs\/c\?/, async (route) => {
    delayedC += 1;
    const response = await route.fetch();
    await new Promise((done) => setTimeout(done, 1500));
    await route.fulfill({ response });
    delayedC -= 1;
    deliveredC += 1;
  });
  await page.locator('[data-testid="top-bar-lang-ko"]').click();
  const savedFirst = waitOrderSave(page);
  await press("down", first[0]);
  check("the save during a refetch is answered", (await savedFirst).ok());
  // 저장 전에 읽은 C와 저장 뒤 다시 받는 C가 모두 도착할 때까지 - 시간만 기다리면 늦은 C가 오기 전에 보고 지나갈 수 있다
  const deliveredBy = Date.now() + T;
  while ((deliveredC === 0 || delayedC > 0) && Date.now() < deliveredBy) await page.waitForTimeout(50);
  check("the delayed C reads arrive", deliveredC > 0 && delayedC === 0, `${deliveredC} delivered, ${delayedC} waiting`);
  await page.waitForTimeout(300);
  check("a C read before the save does not undo the moved line", (await orderOf(first[0])).indexOf(first[0]) === firstIndex + 1, JSON.stringify(await orderOf(first[0])));
  await page.unroute(/\/outputs\/c\?/);
  await page.locator('[data-testid="top-bar-lang-en"]').click();
  await page.waitForTimeout(800);
  const backFirst = waitOrderSave(page);
  await press("up", first[0]);
  check("the line moves back", (await backFirst).ok() && (await orderOf(first[0])).indexOf(first[0]) === firstIndex);

  // 2. 한 번의 409 - 날아가는 첫 문서 저장이 409, 두 번째 문서는 기다리다 다시 읽은 C 위에서 저장된다. 알림은 하나
  await waitIdle();
  const toastsBefore = await errorToasts();
  let conflicted = false;
  await page.route("**/targets/order**", async (route) => {
    if (conflicted) return route.continue();
    conflicted = true;
    await new Promise((done) => setTimeout(done, 600));
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "revision_conflict", conflicts: [] } }) });
  });
  const secondIndex = (await orderOf(second[0])).indexOf(second[0]);
  await press("down", first[0]);
  await press("down", second[0]);
  await page.waitForTimeout(3000);
  await waitIdle();
  check("one conflict shows one error", (await errorToasts()) - toastsBefore === 1, `${(await errorToasts()) - toastsBefore} errors`);
  check("the conflicted line is put back", (await orderOf(first[0])).indexOf(first[0]) === firstIndex);
  check("the other document's waiting move is saved after the reload", (await orderOf(second[0])).indexOf(second[0]) === secondIndex + 1);
  await page.unroute("**/targets/order**");
  await page.reload();
  await openDocOf(second[0]);
  await wait(page, `output-c-row-${second[0]}`);
  check("after reload the other document keeps its move", (await orderOf(second[0])).indexOf(second[0]) === secondIndex + 1);
  const backSecond = waitOrderSave(page);
  await press("up", second[0]);
  check("the other line moves back", (await backSecond).ok());

  // 3. 떠났다 금방 돌아오기 - 저장이 3초 걸리는 동안 개요로 갔다가 돌아와 또 누른다. 떠난 뒤 알림이 없고, 두 저장이 겹치지 않으며, 둘 다 남는다
  await countErrorToasts();
  maxInFlight = 0;
  await page.route("**/targets/order**", async (route) => {
    await new Promise((done) => setTimeout(done, 3000));
    await route.continue();
  });
  await press("down", first[0]);
  await page.locator('[data-testid="stage-nav-overview"]').click();
  await wait(page, "overview-gate-units");
  await page.locator('[data-testid="stage-nav-order"]').click();
  await openDocOf(first[0]);
  await wait(page, `output-c-row-${first[0]}`);
  check("after returning the line shows the first move", (await orderOf(first[0])).indexOf(first[0]) === firstIndex + 1, JSON.stringify(await orderOf(first[0])));
  await press("down", first[0]);
  await page.waitForTimeout(3500);
  await waitIdle();
  check("leaving and returning never sends two saves at once", maxInFlight <= 1, `max ${maxInFlight}`);
  check("no error after leaving and returning", (await errorToasts()) === 0, `${await errorToasts()} errors`);
  await page.unroute("**/targets/order**");
  await page.reload();
  await openDocOf(first[0]);
  await wait(page, `output-c-row-${first[0]}`);
  check("both moves are kept", (await orderOf(first[0])).indexOf(first[0]) === firstIndex + 2, JSON.stringify(await orderOf(first[0])));
  await takeShot("sop-outputs-c-races.png");
  for (let n = 0; n < 2; n += 1) {
    const back = waitOrderSave(page);
    await press("up", first[0]);
    await back;
  }
  check("the line goes back to where it started", (await orderOf(first[0])).indexOf(first[0]) === firstIndex);

  // 4. 409 뒤 다시 받는 C가 실패하면 - 기다리는 저장은 낡은 C 위에서 나가지 않고 멈춘 채 알림과 다시 시도가 보이며, 떠나려 하면 묻는다
  await waitIdle();
  let conflictedAgain = false;
  let heldPuts = 0;
  const countHeldPut = (request) => {
    if (isOrderSave(request)) heldPuts += 1;
  };
  page.on("request", countHeldPut);
  await page.route("**/targets/order**", async (route) => {
    if (conflictedAgain) return route.continue();
    conflictedAgain = true;
    await new Promise((done) => setTimeout(done, 600));
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: { code: "revision_conflict", conflicts: [] } }) });
  });
  await page.route(/\/outputs\/c\?/, (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }), { times: 1 });
  await press("down", first[0]);
  await press("down", second[0]);
  await wait(page, "output-c-reload-error");
  await page.waitForTimeout(800);
  check("a failed C read after a conflict shows a notice with a retry", await page.locator('[data-testid="output-c-reload-retry"]').isVisible());
  check("the waiting move stays on screen", (await orderOf(second[0])).indexOf(second[0]) === secondIndex + 1);
  check("the held save is not sent on the old C", heldPuts === 1, `${heldPuts} PUT`);
  await takeShot("sop-outputs-c-reload-error.png");
  await page.locator('[data-testid="stage-nav-overview"]').click();
  await wait(page, "outputs-leave");
  check("leaving with a waiting save asks first", true);
  await page.locator('[data-testid="outputs-leave-cancel"]').click();
  const heldSaved = waitOrderSave(page);
  await page.locator('[data-testid="output-c-reload-retry"]').click();
  check("after retry the held move is saved on the fresh C", (await heldSaved).ok());
  await waitIdle();
  page.off("request", countHeldPut);
  await page.unroute("**/targets/order**");
  check("the conflicted line is back and the held move kept", (await orderOf(first[0])).indexOf(first[0]) === firstIndex && (await orderOf(second[0])).indexOf(second[0]) === secondIndex + 1);

  // 5. 저장을 기다리는 바뀜이 남은 채 브라우저 뒤로 - 이탈 확인 창이 막지 못하는 길이라 떠난 뒤 알린다. 날아가던 저장만 남는다
  await page.route("**/targets/order**", async (route) => {
    await new Promise((done) => setTimeout(done, 2000));
    await route.continue();
  });
  // 위(날아감) 다음 아래(기다림) - 그 줄은 칸의 첫 줄 바로 아래라 위로 두 번은 칸 끝에 걸린다
  const leftSave = waitOrderSave(page);
  await press("up", second[0]);
  await press("down", second[0]);
  await page.goBack();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-error"]')].some((toast) => toast.textContent?.includes("Some changes in C were not saved.")), null, { timeout: T });
  check("leaving with an unsent change says so", true);
  check("the save in flight when leaving still lands", (await leftSave).ok());
  await page.unroute("**/targets/order**");
  await page.locator('[data-testid="stage-nav-order"]').click();
  await openDocOf(second[0]);
  await wait(page, `output-c-row-${second[0]}`);
  check("only the save in flight when leaving is kept", (await orderOf(second[0])).indexOf(second[0]) === secondIndex, JSON.stringify(await orderOf(second[0])));
});

// 작성자가 요청을 거둔 뒤 다시 요청해 둔다 - 아래 검토자 단계가 같은 Bundle을 검토 대기로 받는다
await runStep("review: author withdraws the request and asks again", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${reviewId}/outputs`);
  await wait(page, "review-withdraw");
  check("the review page offers withdraw to the author", true);
  await page.goto(`${BASE}/bundles/${reviewId}`);
  await wait(page, "overview-withdraw-review");
  await takeShot("sop-overview-in-review.png");
  await page.locator('[data-testid="overview-withdraw-review"]').click();
  await wait(page, "overview-withdraw-review-modal");
  await page.locator('[data-testid="overview-withdraw-review-modal-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="overview-return-note"]')?.dataset.action === "review.withdraw", null, { timeout: T });
  check("withdrawing leaves a note on the overview", true);
  check("the withdraw note carries no reason", (await page.locator('[data-testid="overview-return-reason"]').count()) === 0);
  check("withdrawing clears the meaning checks", (await page.locator('[data-testid="overview-next"]').getAttribute("data-action")) === "semantic_checks");
  check("the withdraw button leaves with the status", (await page.locator('[data-testid="overview-withdraw-review"]').count()) === 0);
  await page.goto(`${BASE}/bundles/${reviewId}/history`);
  await page.waitForFunction(() => document.body.textContent?.includes("Withdrew the review request"), null, { timeout: T });
  check("history records the withdrawal", true);
  await page.goto(`${BASE}/bundles/${reviewId}/outputs`);
  for (const key of ["numbers", "conditions", "tables", "figures"]) {
    await page.locator(`[data-testid="outputs-check-${key}"]`).click();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.checked === true, `outputs-check-${key}`, { timeout: T });
  }
  await page.goto(`${BASE}/bundles/${reviewId}`);
  await page.locator('[data-testid="overview-request-review"]').click();
  await wait(page, "request-review");
  const requestBox = await page.locator('[data-testid="request-review"]').boundingBox();
  check("the request window is narrow", requestBox.width <= 384, String(requestBox.width));
  await takeShot("sop-request-review.png");
  await page.locator('[data-testid="request-review-confirm"]').click();
  await wait(page, "overview-withdraw-review");
  check("the bundle is in review again", (await page.locator('[data-testid="overview-next"]').getAttribute("data-action")) === "await_review");
});

await runStep("review: reviewer does not see withdraw", { devUser: "qa.lead" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${reviewId}/outputs`);
  await wait(page, "review-return");
  check("no withdraw on the review page", (await page.locator('[data-testid="review-withdraw"]').count()) === 0);
  await page.goto(`${BASE}/bundles/${reviewId}`);
  await wait(page, "overview-next");
  check("no withdraw on the overview", (await page.locator('[data-testid="overview-withdraw-review"]').count()) === 0);
});

await runStep("review: reviewer completes the bundle in review", { devUser: "qa.lead" }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const review = page.locator('[data-testid^="bundles-row-"]', { hasText: "검토 대기" });
  const reviewId = Number((await review.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${reviewId}/outputs`);
  await wait(page, "output-c");
  check("the review page has no edition toggle", (await page.locator('[data-testid^="review-lang"]').count()) === 0);
  await takeShot("sop-review.png");
  await page.locator('[data-testid="review-return"]').click();
  await wait(page, "review-reason");
  check("return needs a reason", await page.locator('[data-testid="review-reason-confirm"]').isDisabled());
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="review-complete"]').click();
  // 검토 완료는 확인 창을 거친다
  await page.locator('[data-testid="review-complete-modal-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="review-status"]')?.textContent?.includes("Review complete"), null, { timeout: T });
  check("status reads Review complete", true);
});

await runStep("assign: AI suggestions come first and confirm one by one", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const aiRow = page.locator('[data-testid^="bundles-row-"]', { hasText: "AI 제안" });
  if ((await aiRow.count()) === 0) {
    console.log("  (no AI demo bundle in this seed - skipped)");
    return;
  }
  const aiId = Number((await aiRow.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${aiId}/assign`);
  await wait(page, "assign-bar");
  check("opens on All", (await page.locator('[data-testid="assign-filter-all"]').getAttribute("aria-selected")) === "true");
  await page.locator('[data-testid="assign-filter-ai_suggested"]').click();
  // 필터 단추에 포커스가 남으면 아래 Enter가 필터를 다시 누른다
  await page.locator('[data-testid="assign-filter-ai_suggested"]').blur();
  await page.keyboard.press("j");
  await wait(page, "assign-rec-0");
  check("the AI suggestion is the first card", (await getText(page, "assign-rec-0")).includes("AI"));
  await takeShot("sop-assign-ai.png");
  const before = await progressDone(page);
  await page.keyboard.press("Enter");
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) === done + 1, before, { timeout: T });
  check("Enter confirms the AI suggestion", true);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign?edit=first`);
  await page.locator('[data-testid^="figure-"]').first().waitFor({ timeout: T });
  check("figure image loads on the paper", true);
});

// 필터 접기(2026-11-12) - 필터를 걸면 맞는 문장만 제 모양, 앞뒤 한 줄, 나머지는 묶음 한 줄. 목록은 걸 때의 스냅숏이라 확정해도 접히지 않는다
await runStep("assign: a status filter folds the Old paper", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const aiRow = page.locator('[data-testid^="bundles-row-"]', { hasText: "AI 제안" });
  const bundleId = (await aiRow.count()) > 0 ? Number((await aiRow.getAttribute("data-testid")).replace("bundles-row-", "")) : halfBundleId;
  await page.goto(`${BASE}/bundles/${bundleId}/assign`);
  await wait(page, "assign-bar");
  const old = '[data-testid="assign-old"]';
  const countOf = (selector) => page.locator(selector).count();
  const holdCount = Number(await page.locator('[data-testid="assign-filter-on_hold"] .schip-n').textContent());
  const filter = holdCount > 0 ? "on_hold" : "unassigned";
  const filterCount = Number(await page.locator(`[data-testid="assign-filter-${filter}"] .schip-n`).textContent());
  // 맞는 줄 = 엿보기가 아닌 조각(이웃한 짝 카드의 둘째 줄부터는 첫 줄과 한 줄)
  const fullCards = `${old} .strip-row:not([data-peek]) > .strip:not([data-bracket="middle"]):not([data-bracket="bottom"])`;
  await page.locator(`[data-testid="assign-filter-${filter}"]`).click();
  // 문서·부분마다 맞는 줄을 더하면 필터 수 - 맞는 것이 없는 곳은 빈 상태와 바로 가기
  const docTrigger = page.locator('[data-testid="assign-old-doc"]');
  const docValues = (await docTrigger.count()) > 0 ? await (async () => {
    await docTrigger.click();
    const values = await page.locator('[data-testid^="assign-old-doc-option-"]').evaluateAll((els) => els.map((el) => el.dataset.testid));
    await page.keyboard.press("Escape");
    return values;
  })() : [null];
  let drawn = 0;
  let sawEmpty = false;
  for (const value of docValues) {
    if (value) {
      await docTrigger.click();
      await page.locator(`[data-testid="${value}"]`).click();
    }
    const tabs = await page.locator('[data-testid^="assign-tab-"]:not([data-testid="assign-tabs"])').evaluateAll((els) => els.map((el) => el.dataset.testid));
    for (const tab of tabs.length > 0 ? tabs : [null]) {
      if (tab) await page.locator(`[data-testid="${tab}"]`).click();
      await page.locator(`${old} .strip-row, [data-testid="assign-fold-empty"]`).first().waitFor({ timeout: T });
      if ((await countOf('[data-testid="assign-fold-empty"]')) > 0) {
        if (!sawEmpty) await takeShot("sop-assign-fold-empty.png");
        // 필터 수가 0보다 크니 맞는 곳이 어딘가에 있다 - 빈 상태마다 바로 가기가 있어야 한다
        if (!sawEmpty) check("an empty part offers where the matches are", (await countOf('[data-testid^="assign-fold-go-"]')) > 0);
        sawEmpty = true;
        continue;
      }
      drawn += await countOf(fullCards);
    }
  }
  check("matched rows over all documents and parts equal the filter count", drawn === filterCount, `${drawn} / ${filterCount}`);
  // 맞는 것이 있는 곳으로 - 빈 상태면 바로 가기, 아니면 첫 문서
  const go = page.locator('[data-testid^="assign-fold-go-"]').first();
  if (sawEmpty && (await go.count()) > 0) {
    await go.click();
  } else if (docValues[0]) {
    await docTrigger.click();
    await page.locator(`[data-testid="${docValues[0]}"]`).click();
  }
  await page.locator(fullCards).first().waitFor({ timeout: T });
  check("the filter folds the rest into runs", (await countOf('[data-testid^="assign-paper-fold-run-"]')) >= 1 || (await countOf('[data-testid^="assign-paper-fold-line-"]')) >= 1);
  await takeShot("sop-assign-fold.png");
  // 묶음 한 줄 - 키보드로 펼치면 한 줄 판들과 접기 손잡이
  const run = page.locator('[data-testid^="assign-paper-fold-run-"]').first();
  if ((await run.count()) > 0) {
    const linesBefore = await countOf('[data-testid^="assign-paper-fold-line-"]');
    const runKey = ((await run.getAttribute("data-testid")) ?? "").replace("assign-paper-fold-run-", "");
    await run.focus();
    await page.keyboard.press("Enter");
    await wait(page, `assign-paper-fold-head-${runKey}`);
    check("Enter on a run opens its lines under a collapse handle", (await countOf('[data-testid^="assign-paper-fold-line-"]')) > linesBefore);
  }
  // 한 줄 판을 누르면 엿보기 - 고르지는 않는다
  await page.locator('[data-testid^="assign-paper-fold-line-"]').first().click();
  await page.locator(`${old} .strip-row[data-peek]`).first().waitFor({ timeout: T });
  check("a line opens as a peek without picking it", (await countOf('[data-testid="assign-row-id"]')) === 0);
  await page.locator(`${old} .strip-row[data-peek]`).first().scrollIntoViewIfNeeded();
  await takeShot("sop-assign-fold-peek.png");
  // 같은 필터를 다시 누르면 모두 접힌다
  await page.locator(`[data-testid="assign-filter-${filter}"]`).click();
  await page.locator(`${old} .strip-row[data-peek]`).first().waitFor({ state: "detached", timeout: T });
  check("clicking the same filter folds everything again", (await countOf('[data-testid^="assign-paper-fold-head-"]')) === 0);
  // 맞는 줄을 확정해도 그 자리에 제 모양으로 남는다(스냅숏)
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  const pickedId = await page.locator(`${old} .strip[data-sel]`).first().getAttribute("data-strip-unit");
  await pickFirstPlace(page);
  const saved = page.waitForResponse((response) => response.url().includes("/groups/save"), { timeout: T });
  await page.locator('[data-testid="assign-primary"]').click();
  check("the matched row confirms", (await saved).ok());
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  // 확정하면 다음 미확정 줄(다른 문서일 수 있다)로 간다 - K로 돌아오면 목록에 그대로 있고 제 모양이다
  await page.waitForFunction((id) => document.querySelector('[data-pane="old"] .strip[data-sel]')?.getAttribute("data-strip-unit") !== id, pickedId, { timeout: T });
  await page.keyboard.press("k");
  await page.locator(`${old} .strip[data-sel][data-strip-unit="${pickedId}"]`).waitFor({ timeout: T });
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-row-status"]')?.textContent?.includes("Confirmed"), null, { timeout: T });
  check("a confirmed matched row stays in the list in full, not folded", (await countOf(`${old} .strip-row:not([data-peek]) > .strip[data-sel][data-strip-unit="${pickedId}"]`)) === 1);
  // New 출처 칩으로 필터 밖(접힌) Unit에 가면 저절로 엿보기로 펼쳐 보인다 - 고른 줄을 따라 New 문서가 바뀌므로 다 받은 뒤에 칩을 찾는다
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const chips = await page.locator('[data-testid^="assign-new-src-"]').evaluateAll((els) => els.map((el) => el.dataset.testid));
  let target = null;
  for (const chip of chips) {
    const unitId = chip.split("-").pop();
    if ((await countOf(`${old} [data-unit="${unitId}"]`)) === 0) {
      target = { chip, unitId };
      break;
    }
  }
  check("a New source chip points at a folded Old unit", target !== null);
  if (target) {
    await page.locator(`[data-testid="${target.chip}"]`).click();
    await page.locator(`${old} [data-flash] [data-unit="${target.unitId}"]`).waitFor({ timeout: T });
    check("the folded source opens as a peek and flashes", (await countOf(`${old} .strip-row[data-peek] [data-unit="${target.unitId}"]`)) >= 1);
    // 잇기 메뉴는 누른 뒤 1초쯤 지나 뜬다 - 뜨기 전에 Esc를 누르면 닫을 것이 없고 뒤늦게 뜬 메뉴가 남는다
    await page.locator('[data-testid="assign-link-menu"]').waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="assign-link-menu"]').waitFor({ state: "detached", timeout: T });
    await page.keyboard.press("j");
    await page.waitForFunction((id) => document.querySelector('[data-pane="old"] .strip[data-sel]')?.getAttribute("data-strip-unit") !== id, target.unitId, { timeout: T });
    check("J from a peek goes to a matched row", (await countOf(`${old} .strip-row:not([data-peek]) > .strip[data-sel]`)) === 1);
  }
});

await runStep("assign: reset a document, then the whole bundle, after a dry-run count", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-reset");
  const before = await progressDone(page);
  await page.locator('[data-testid="assign-reset"]').click();
  await page.locator('[data-testid="assign-reset-document"]').click();
  // 확인 창이 먼저 dry_run으로 센 건수를 보이고, 그때까지 확정 단추를 막는다
  await wait(page, "assign-reset-counts");
  const counts = await getText(page, "assign-reset-count-unassigned");
  check("the document reset shows the dry-run count first", /\d/.test(counts), counts);
  await takeShot("sop-assign-reset.png");
  await page.locator('[data-testid="assign-reset-modal-confirm"]').click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  await page.waitForFunction((done) => Number(document.querySelector('[data-testid="assign-progress"]')?.textContent?.split("/")[0]) < done, before, { timeout: T });
  check("resetting the document lowers the progress", true);
  await page.locator('[data-testid="assign-reset"]').click();
  await page.locator('[data-testid="assign-reset-bundle"]').click();
  await wait(page, "assign-reset-counts");
  await page.locator('[data-testid="assign-reset-modal-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-progress"]')?.textContent?.trim().startsWith("0"), null, { timeout: T });
  check("resetting the whole bundle leaves nothing confirmed", true);
  // 다시 열면 지울 것이 없다고 말하고 확정 단추를 막는다
  await page.locator('[data-testid="assign-reset"]').click();
  await page.locator('[data-testid="assign-reset-bundle"]').click();
  await wait(page, "assign-reset-nothing");
  check("nothing left to reset disables the confirm button", await page.locator('[data-testid="assign-reset-modal-confirm"]').isDisabled());
  await page.locator('[data-testid="assign-reset-modal-cancel"]').click();
});

await runStep("dark theme from the layout menu, before first paint next time", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="top-bar-user"]').click();
  await page.locator('[data-testid="user-menu-layout"]').hover();
  await page.locator('[data-testid="layout-menu-theme-dark"]').click();
  check("dark applies at once", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await page.keyboard.press("Escape");
  await takeShot("sop-assign-dark.png");
  await page.goto(`${BASE}/bundles/${halfBundleId}`, { waitUntil: "commit" });
  const early = await page.evaluate(() => new Promise((done) => {
    if (document.readyState !== "loading") done(document.documentElement.dataset.theme);
    else document.addEventListener("DOMContentLoaded", () => done(document.documentElement.dataset.theme), { once: true });
  }));
  check("stored theme applies before the app mounts", early === "dark", String(early));
});

// 멤버 피커(2026-11-09 운영 버그): 이름을 고르면 "추가" 단추가 피커 칸 안에 보이고 눌러 목록에 들어간다.
// 긴 부서 경로는 HR 데이터에서만 나온다 - 로컬에서는 employees 표에 긴 경로 직원을 넣고 돌리면 같은 조건이 된다.
await runStep("members picker keeps Add inside the panel and adds the person", {}, async ({ page }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}`);
  await wait(page, "overview-members-manage");
  await page.locator('[data-testid="overview-members-manage"]').click();
  await page.locator('[data-testid="overview-members-modal-add"]').click();
  await wait(page, "overview-members-modal-picker-list");
  const first = page.locator('[data-testid^="overview-members-modal-picker-option-"]').first();
  check("empty search lists my department first", (await first.getAttribute("data-testid")).endsWith("qa.member"));
  await page.locator('[data-testid="overview-members-modal-picker-search"]').fill("prod");
  await page.locator('[data-testid="overview-members-modal-picker-option-prod.member"]').click();
  const add = await getBox(page, "overview-members-modal-add-confirm");
  const panel = await getBox(page, "overview-members-modal-picker");
  check("Add stays inside the picker panel", add.x + add.width <= panel.x + panel.width + 1, JSON.stringify({ add, panel }));
  await page.locator('[data-testid="overview-members-modal-add-confirm"]').click();
  check("picked person joins the list", (await page.locator('[data-testid="overview-members-modal-row-prod.member"]').count()) === 1);
  check("Save turns on", await page.locator('[data-testid="overview-members-modal-save"]').isEnabled());
  await page.keyboard.press("Escape");
});

// 바로 생성(2026-11-09): 이름 없이 BND 코드로 만들고, 문서가 없으면 Split~Review는 잠기고 To-Be는 열려 있다
// 배정 화면에서 AI 나누기 제안 받기·적용·되돌리기(전에는 요청만 되고 적용은 쪼개기 화면에서 했다). AI가 꺼져 있으면 건너뛴다
// 배정된 문장에 적용하면 서버가 먼저 묻는다(409 confirm_required) - 콘솔에 오류로 찍히는 그 응답은 이 단계가 일부러 받는 것이다
await runStep("assign: AI split suggestions - ask for the whole document, apply one, undo", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const status = await page.request.get(`${BASE}/api/bundles/1/ai/status`, { headers });
  if (!status.ok() || !(await status.json()).ai_enabled) {
    console.log("  (AI is off in this backend - skipped)");
    return;
  }
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-ai-menu"]').click();
  const wholeDoc = page.locator('[role="menuitem"]', { hasText: "AI split whole document" });
  check("the AI menu offers the whole-document split", (await wholeDoc.count()) === 1);
  await wholeDoc.click();
  // 앞 시나리오가 남긴 제안이 있으면 바로, 없으면 방금 보낸 작업이 끝난 뒤 뜬다
  const pill = page.locator('[data-testid="assign-split-pending"]');
  await pill.waitFor({ timeout: 90000 });
  await pill.click();
  await wait(page, "assign-split-suggestion");
  const pieces = await page.locator('[data-testid^="assign-split-piece-"]').count();
  check("the card previews the pieces", pieces >= 2, String(pieces));
  await takeShot("sop-assign-ai-split.png");
  const applyButton = page.locator('[data-testid="assign-split-apply"]');
  // 저장하지 않은 고름이 있는 문장은 적용이 잠긴다(다른 문장 고치기와 같은 규칙) - 적용할 수 있는 제안이 나올 때까지 다음으로 넘긴다
  let sawLocked = false;
  for (let step = 0; step < 40 && (await applyButton.getAttribute("aria-disabled")) === "true"; step += 1) {
    sawLocked = true;
    const next = page.locator('[data-testid="assign-split-next"]');
    if ((await next.count()) === 0) break;
    const row = (await getText(page, "assign-row-id")).trim();
    await next.click();
    await page.waitForFunction((before) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() !== before, row, { timeout: T });
    await wait(page, "assign-split-suggestion");
  }
  if (sawLocked) check("a sentence with an unsaved choice keeps Apply split locked", true);
  if ((await applyButton.getAttribute("aria-disabled")) === "true") {
    console.log("  (every suggested sentence is assigned - apply and undo not exercised)");
    return;
  }
  const rowBefore = (await getText(page, "assign-row-id")).trim();
  await applyButton.click();
  // 배정된 문장이면 한 번 묻는다(v1.0.21) - 확인하고 적용한다
  const confirmEdit = page.locator('[data-testid="assign-edit-confirm-confirm"]');
  if (await confirmEdit.waitFor({ timeout: 2500 }).then(() => true, () => false)) await confirmEdit.click();
  await page.waitForFunction((before) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() !== before && document.querySelector('[data-testid="assign-undo"]')?.disabled === false, rowBefore, { timeout: T });
  check("Apply split cuts the sentence and moves to the new piece", true);
  await page.locator('[data-testid="assign-undo"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((toast) => toast.textContent?.includes("Cut")), null, { timeout: T });
  check("Undo takes the cut back", true);
});

// 오른쪽 칸의 세 걸음(v1.0.23) - 1 다듬기 · 2 보낼 곳 · 3 결정. 다듬기 줄의 단추는 우클릭 메뉴와 같은 일을 한다
await runStep("assign: the inspector walks Shape, Where it goes, Decide", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.keyboard.press("j");
  await wait(page, "assign-shape");
  const steps = await page.locator('[data-testid="assign-inspector"] .assign-step').allInnerTexts();
  check("the inspector has three numbered steps", steps.length === 3 && steps[0].includes("SHAPE") && steps[2].includes("DECIDE"), steps.join(" | "));
  const lines = page.locator('[data-testid^="assign-shape-line-"]');
  check("every sentence of the row has its own tool line", (await lines.count()) >= 1);
  // 머리의 아랫줄 - 고른 문장이 원문에서 놓인 쪽(v1.0.26)
  check("the head says which page of the original the sentence is on", /^(≈ )?p\.\d+$/.test((await getText(page, "assign-row-page")).trim()), await getText(page, "assign-row-page"));
  // 다듬기 줄에서 자를 자리를 놓는다 - 우클릭 메뉴의 Split here와 같은 일
  const split = page.locator('[data-testid^="assign-shape-split-"]:not([aria-disabled="true"])').first();
  await split.click();
  await wait(page, "assign-cut-run");
  check("Split in the Shape line places the cut on the paper", (await split.getAttribute("data-on")) !== null);
  await takeShot("sop-assign-shape.png");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-cut-run"]').waitFor({ state: "detached", timeout: T });
  // 앞·다음 줄 단추
  const rowBefore = (await getText(page, "assign-row-id")).trim();
  await page.locator('[data-testid="assign-row-next"]').click();
  await page.waitForFunction((before) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() !== before, rowBefore, { timeout: T });
  await page.locator('[data-testid="assign-row-prev"]').click();
  await page.waitForFunction((before) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === before, rowBefore, { timeout: T });
  check("the head's arrows move to the next row and back", true);
});

// 이미 쓴 New 문서의 원문 다듬기(v1.0.27) - 전에는 원문 고치기 화면에서만 했다. New 칸 머리의 가위 단추가 그 문서를 한 단으로 열고, Old 문서와 같은 도구로 자르고 되돌린다
await runStep("assign: a written New document opens on its own with the same tools", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const newDoc = docs.find((doc) => doc.side === "new" && doc.status === "ready");
  check("the fresh bundle has a written New document", newDoc !== undefined);
  if (newDoc === undefined) return;
  const readUnits = async () => (await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${newDoc.id}/view`, { headers })).json()).units;
  const waitCount = async (expected) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if ((await readUnits()).length === expected) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const before = await readUnits();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-new-edit-original"]').click();
  await wait(page, "assign-solo");
  check("the scissors button opens the New document alone, in the one-document view", (await page.locator(".assign-panes").getAttribute("data-single")) !== null && (await getText(page, "assign-old-tag")).includes("New"));
  check("nothing is picked yet, and the panel says what to do", (await page.locator('[data-testid^="assign-shape-line-"]').count()) === 0 && (await getText(page, "assign-solo-note")).length > 0);
  const unit = before.find((item) => item.kind === "sentence" && item.pair_id === null && item.text.trim().split(" ").length >= 6);
  check("the New document has a sentence long enough to cut", unit !== undefined);
  if (unit === undefined) return;
  const piece = page.locator(`[data-testid="assign-paper-piece-${unit.id}"], [data-testid="assign-paper-unit-${unit.id}"]`).first();
  await piece.waitFor({ timeout: T });
  await piece.click();
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, unit.display_id, { timeout: T });
  check("clicking a sentence picks it and offers its Shape line only", (await page.locator(`[data-testid="assign-shape-line-${unit.id}"]`).count()) === 1 && (await page.locator('[data-testid="assign-decide"]').count()) === 0);
  await takeShot("sop-assign-solo.png");
  // 우클릭 메뉴에는 고치기 항목만 있다(보낼 곳이 없는 문서다)
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-split");
  check("the right-click menu has no assignment items", (await page.locator('[data-testid="assign-ctx-confirm"], [data-testid="assign-ctx-clear"]').count()) === 0);
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  // 옛 문서의 문장이 이어져 있으면 한 번 묻는다
  const confirmEdit = page.locator('[data-testid="assign-edit-confirm-confirm"]');
  if (await confirmEdit.waitFor({ timeout: 2000 }).then(() => true, () => false)) await confirmEdit.click();
  check("Split here cuts the New sentence in two", await waitCount(before.length + 1));
  await page.waitForFunction((id) => { const now = document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim(); return now !== undefined && now !== "" && now !== id; }, unit.display_id, { timeout: T });
  check("the screen follows to the new piece", true);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  check("Undo puts the sentence back", await waitCount(before.length));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="assign-paper-piece-"]').length > 0 && document.querySelector('[data-testid="assign-solo"]') !== null, null, { timeout: T });
  await page.waitForLoadState("networkidle");
  // 문서 고르기 한 칸에 옛 문서와 이미 쓴 New 문서가 함께 있다
  const oldDoc = docs.find((doc) => doc.side === "old" && doc.status === "ready");
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${oldDoc.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-old-tag"]')?.textContent === "Old", null, { timeout: T });
  check("picking an Old document in the same list goes back to assigning", (await page.locator('[data-testid="assign-solo"]').count()) === 0 && (await page.locator(".assign-panes").getAttribute("data-single")) !== null);
  await page.locator('[data-testid="assign-old-doc"]').click();
  await page.locator(`[data-testid="assign-old-doc-option-${newDoc.id}"]`).click();
  await wait(page, "assign-solo");
  check("the one-document list also offers the written New document", true);
  await page.locator('[data-testid="assign-view-two"]').click();
  await wait(page, "assign-new");
  check("two documents closes it - the left side is an Old document again", (await page.locator('[data-testid="assign-solo"]').count()) === 0 && (await getText(page, "assign-old-tag")) === "Old");
});

// 양 단에서 New 문장 바로 다듬기(v1.0.29) - Old 줄을 고르지 않은 채 New 문장을 누르면 그 문장이 골라지고, 그 자리에서 자르고 되돌린다. Old 줄을 고른 채면 전처럼 잇는다
await runStep("assign: shape a written New sentence in place, in the two-document view", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const readWritten = async () => (await page.request.get(`${BASE}/api/bundles/${freshId}/written-sentences`, { headers })).json();
  const waitCount = async (expected) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if ((await readWritten()).length === expected) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const before = await readWritten();
  const target = before.find((item) => item.kind === "sentence" && item.new_unit_id !== null && item.partner_target_id === null && item.text.trim().split(" ").length >= 6);
  check("the written New document has a sentence that knows its unit", target !== undefined);
  if (target === undefined) return;
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  await page.waitForLoadState("networkidle");
  const line = page.locator(`[data-testid="assign-new-${target.target_id}"]`);
  await line.waitFor({ timeout: T });
  await page.locator(`[data-testid="assign-new-pick-${target.target_id}"]`).click();
  await wait(page, "assign-solo");
  check("with no Old row picked, clicking a New sentence picks it for shaping", (await line.getAttribute("data-state")) === "shape" && (await page.locator(".assign-panes").getAttribute("data-single")) === null && (await getText(page, "assign-old-tag")) === "Old");
  const splitButton = page.locator('[data-testid^="assign-shape-split-"]:not([aria-disabled="true"])').first();
  await splitButton.waitFor({ timeout: T });
  check("the panel shows its Shape line and nothing to decide", (await page.locator('[data-testid^="assign-shape-line-"]').count()) === 1 && (await page.locator('[data-testid="assign-decide"]').count()) === 0);
  await splitButton.click();
  const cut = page.locator(`[data-testid="assign-new-cut-${target.target_id}"]`);
  await cut.waitFor({ timeout: T });
  const readCut = () => page.evaluate((id) => document.querySelector(`[data-testid="assign-new-cut-${id}"]`)?.previousSibling?.textContent?.length ?? -1, target.target_id);
  const placed = await readCut();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(({ id, was }) => (document.querySelector(`[data-testid="assign-new-cut-${id}"]`)?.previousSibling?.textContent?.length ?? -1) > was, { id: target.target_id, was: placed }, { timeout: T });
  check("the cut sits inside the sentence and the arrow keys move it", placed > 0 && (await readCut()) > placed);
  await takeShot("sop-assign-new-inplace.png");
  await page.locator('[data-testid="assign-cut-run"]').click();
  const confirmEdit = page.locator('[data-testid="assign-edit-confirm-confirm"]');
  if (await confirmEdit.waitFor({ timeout: 2000 }).then(() => true, () => false)) await confirmEdit.click();
  check("Split here cuts the New sentence where it stands", await waitCount(before.length + 1));
  await page.waitForFunction(() => document.querySelector('.new-line[data-state="shape"]') !== null, null, { timeout: T });
  check("the new piece is picked in the New pane", true);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  check("Undo puts the sentence back", await waitCount(before.length));
  await page.waitForLoadState("networkidle");
  // Old 줄을 고른 채여도 우클릭은 그 New 문장의 고치기 메뉴다(보낼 곳 항목은 없다)
  await page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]').first().click();
  await wait(page, "assign-decide");
  const again = (await readWritten()).find((item) => item.text === target.text);
  await page.locator(`[data-testid="assign-new-${again.target_id}"]`).click({ button: "right" });
  await wait(page, "assign-ctx-split");
  check("right-click on a New sentence opens its shaping menu, without assignment items", (await page.locator('[data-testid="assign-ctx-confirm"], [data-testid="assign-ctx-clear"]').count()) === 0);
  // 떨어진 문장과 짝 맺기도 이 칸에서 된다(v1.0.36 - 전에는 한 단으로 열어야 했다)
  check("the menu offers pairing with a distant sentence", (await page.locator('[data-testid="assign-ctx-pair_pick"]').count()) === 1);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-ctx-menu"]').waitFor({ state: "detached", timeout: T });
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="assign-solo"]').waitFor({ state: "detached", timeout: T });
  check("Esc lets the New sentence go", true);
  // Old 줄을 고른 채 그냥 누르면 전처럼 그 줄에 잇는다
  await page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]').first().click();
  await wait(page, "assign-decide");
  await page.locator(`[data-testid="assign-new-pick-${again.target_id}"]`).click();
  await page.locator(".link-menu").waitFor({ timeout: T });
  check("with an Old row picked, clicking a New sentence still links", (await page.locator('[data-testid="assign-solo"]').count()) === 0);
  await page.keyboard.press("Escape");
});

// 머리말·꼬리말 탭의 설명 줄(v1.0.28) - 전에는 원문 고치기 화면에만 있었다. 장마다 어느 구역의 머리말인지 적힌다
await runStep("assign: header and footer sheets say where they are used", {}, async ({ page }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  // 머리말이 있는 문서가 나올 때까지 Old 문서를 넘긴다
  const options = await (async () => {
    await page.locator('[data-testid="assign-old-doc"]').click();
    const ids = await page.locator('[data-testid^="assign-old-doc-option-"]').evaluateAll((els) => els.map((el) => el.dataset.testid));
    await page.keyboard.press("Escape");
    return ids;
  })();
  let hasHeader = false;
  for (const option of options) {
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="${option}"]`).click();
    await page.waitForTimeout(400);
    if ((await page.locator('[data-testid="assign-tab-header"]').count()) > 0) {
      hasHeader = true;
      break;
    }
  }
  check("an Old document of the fresh bundle has a header", hasHeader);
  if (!hasHeader) return;
  check("the body has no caption", (await page.locator('[data-testid^="assign-sheet-cap-"]').count()) === 0);
  await page.locator('[data-testid="assign-tab-header"]').click();
  await page.locator('[data-testid^="assign-sheet-cap-"]').first().waitFor({ timeout: T });
  const caption = (await page.locator('[data-testid^="assign-sheet-cap-"]').first().innerText()).trim();
  check("each header sheet says which section uses it", /^(Section \d+ · |Header \d+)/.test(caption), caption);
  // 설명 줄이 붙어도 그 장의 문장은 전처럼 골라진다
  await page.locator('[data-testid="assign-old"] [data-testid^="assign-paper-unit-"]').first().click();
  await wait(page, "assign-row-id");
  check("a sentence on the header sheet is still picked as a row", (await getText(page, "assign-row-id")).trim().length > 0);
});

// 한 문장 ↔ 한/영 짝 바꾸기(v1.0.24) - 전에는 원문 고치기 화면에만 있었다. 짝인 줄을 한 문장으로 합치고, 합친 문장을 다시 짝으로 돌린다(풀기 + 짝 맺기를 한 번에)
await runStep("assign: switch a KO/EN pair to one sentence and back", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  const toOne = page.locator('[data-testid="assign-shape-mode-one"]');
  const toPair = page.locator('[data-testid="assign-shape-mode-pair"]');
  let doc = null;
  let members = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const byPair = new Map();
    for (const item of view.units.filter((unit) => unit.pair_id !== null)) byPair.set(item.pair_id, [...(byPair.get(item.pair_id) ?? []), item]);
    const pairs = [...byPair.values()].filter((group) => group.length === 2 && group.every((unit) => unit.kind === "sentence" && unit.status === "unassigned"));
    if (pairs.length === 0) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.waitForTimeout(600);
    for (const group of pairs) {
      if ((await pieceOf(group[0].id).count()) === 0) continue;
      await pieceOf(group[0].id).click();
      if (!(await toOne.waitFor({ timeout: 2500 }).then(() => true, () => false))) continue;
      // 떨어진 짝은 한 문장으로 합치지 않는다 - 이웃한 짝이 나올 때까지 넘긴다
      if ((await toOne.getAttribute("aria-disabled")) === "true") continue;
      doc = candidate;
      members = group;
      break;
    }
    if (members !== null) break;
  }
  check("the fresh bundle has a neighbouring KO/EN pair on screen", members !== null);
  if (members === null) return;
  const readUnits = async () => (await readView(doc.id)).units;
  const waitUnits = async (test) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const units = await readUnits();
      if (test(units)) return units;
      await page.waitForTimeout(250);
    }
    return null;
  };
  const before = await readUnits();
  check("a pair row shows KO/EN pair as its shape", (await toPair.getAttribute("aria-pressed")) === "true" && (await toOne.getAttribute("aria-pressed")) === "false");
  await takeShot("sop-assign-shape-mode.png");
  await toOne.click();
  const merged = await waitUnits((units) => units.length === before.length - 1);
  check("One sentence merges the pair", merged !== null);
  if (merged === null) return;
  const one = merged.find((unit) => !before.some((item) => item.id === unit.id));
  check("the merged sentence holds both texts and can be taken apart", one !== undefined && one.can_unmerge === true && members.every((unit) => one.text.includes(unit.text.trim())));
  // 화면이 합친 문장의 줄을 고른 뒤 전환이 한 문장 쪽으로 눌려 있다
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-one"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  check("the merged row shows One sentence as its shape", (await toPair.getAttribute("aria-disabled")) === null);
  await page.waitForLoadState("networkidle");
  await toPair.click();
  const back = await waitUnits((units) => units.length === before.length && units.filter((unit) => members.some((item) => item.text === unit.text)).every((unit) => unit.pair_id !== null));
  check("KO/EN pair takes it apart and pairs the two again", back !== null);
  if (back === null) return;
  const again = back.filter((unit) => members.some((item) => item.text === unit.text));
  check("the two sentences keep their languages and share one pair", again.length === 2 && new Set(again.map((unit) => unit.pair_id)).size === 1 && again.map((unit) => unit.lang).sort().join() === "en,ko");
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-pair"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  check("the row is a pair again on screen", true);
  // 배정된 한 문장을 짝으로 돌리면 한 번 묻는다 - 풀기가 배정을 지우기 때문이다(예상한 409가 콘솔에 찍힌다)
  await page.waitForLoadState("networkidle");
  await toOne.click();
  const mergedAgain = await waitUnits((units) => units.length === before.length - 1);
  check("the pair merges a second time", mergedAgain !== null);
  if (mergedAgain === null) return;
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-one"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  await page.waitForLoadState("networkidle");
  await pickFirstPlace(page);
  await page.locator('[data-testid="assign-primary"]').click();
  const assigned = await waitUnits((units) => units.some((unit) => unit.can_unmerge && unit.status === "confirmed" && members.every((item) => unit.text.includes(item.text.trim()))));
  check("the merged sentence is assigned", assigned !== null);
  if (assigned === null) return;
  // 확정하면 다음 줄로 넘어간다 - 합친 문장으로 돌아와서 누른다
  await page.waitForLoadState("networkidle");
  await pieceOf(assigned.find((unit) => unit.can_unmerge && unit.status === "confirmed" && members.every((item) => unit.text.includes(item.text.trim()))).id).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-one"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  check("KO/EN pair stays offered on an assigned sentence", (await toPair.getAttribute("aria-disabled")) === null);
  await toPair.click();
  await wait(page, "assign-edit-confirm");
  await page.locator('[data-testid="assign-edit-confirm-confirm"]').click();
  const cleared = await waitUnits((units) => units.length === before.length && units.filter((unit) => members.some((item) => item.text === unit.text)).every((unit) => unit.pair_id !== null && unit.status === "unassigned"));
  check("after asking once it is a pair again, with the assignment cleared", cleared !== null);
  // 확인 창을 거친 뒤에도 화면이 새 줄을 따라가 고른다(묻는 사이에 다시 받은 값으로 고르면 놓친다)
  // 되돌리면 풀기 앞으로 - 합친 한 문장이 돌아온다(짝은 사라진 조각과 함께 없어진다). 다시 눌러 처음 모양으로 둔다
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-pair"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
  check("Undo brings the merged sentence back", (await waitUnits((units) => units.length === before.length - 1)) !== null);
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-shape-mode-one"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  await page.waitForLoadState("networkidle");
  await toPair.click();
  const restored = await waitUnits((units) => units.length === before.length && units.filter((unit) => members.some((item) => item.text === unit.text)).every((unit) => unit.pair_id !== null));
  check("the pair is back as the step found it", restored !== null);
});

// 조각 사이의 붙이기 단추와 합친 문장 풀기(v1.0.22) - 전에는 원문 고치기 화면에만 있었다. 자른 두 조각을 틈의 단추로 붙이고, 붙인 문장을 조각 아래 단추로 다시 푼다
await runStep("assign: join two pieces from the gap between them, then unmerge", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const pieceOf = (unitId) => page.locator(`[data-testid="assign-paper-piece-${unitId}"], [data-testid="assign-paper-unit-${unitId}"]`).first();
  let doc = null;
  let unit = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const found = view.units.filter((item) => item.kind === "sentence" && item.status === "unassigned" && item.lang === "en" && item.pair_id === null && item.text.trim().split(" ").length >= 6);
    if (found.length === 0) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.waitForTimeout(600);
    for (const item of found) {
      if ((await pieceOf(item.id).count()) === 0) continue;
      doc = candidate;
      unit = item;
      break;
    }
    if (unit !== null) break;
  }
  check("the fresh bundle has an unpaired English sentence on screen", unit !== null);
  if (unit === null) return;
  const readIds = async () => (await readView(doc.id)).units.map((item) => item.id);
  const waitCount = async (expected) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if ((await readIds()).length === expected) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const beforeIds = await readIds();
  const before = beforeIds.length;
  // 먼저 자른다 - 우클릭 메뉴
  await pieceOf(unit.id).scrollIntoViewIfNeeded();
  await pieceOf(unit.id).click({ button: "right" });
  await wait(page, "assign-ctx-split");
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  check("the sentence is cut in two", await waitCount(before + 1));
  const halves = (await readView(doc.id)).units.filter((item) => !beforeIds.includes(item.id)).sort((a, b) => a.pos_seq - b.pos_seq);
  // 틈의 붙이기 단추 - 포인터가 틈에 머물러 단추가 나타난 뒤에 누른다(사람처럼)
  const join = page.locator(`[data-testid="assign-paper-join-${halves[0].id}-${halves[1].id}"]`);
  await join.waitFor({ state: "attached", timeout: T });
  check("the gap between the two pieces offers Join", (await join.getAttribute("aria-disabled")) === null);
  await page.waitForFunction(() => { const acts = document.querySelector(".strip-acts[data-open]"); return acts === null || acts.getAnimations().length === 0; }, null, { timeout: T });
  await page.locator(".strip-gap", { has: join }).hover({ position: { x: 200, y: 2 } });
  await page.waitForFunction(() => [...document.querySelectorAll(".strip-gap:hover .strip-merge")].some((el) => getComputedStyle(el).pointerEvents === "auto"), null, { timeout: T });
  await takeShot("sop-assign-gap-join.png");
  await join.click();
  check("Join merges the two pieces back into one sentence", await waitCount(before));
  const merged = (await readView(doc.id)).units.find((item) => !beforeIds.includes(item.id) && item.kind === "sentence");
  check("the merged sentence can be taken apart again", merged !== undefined && merged.can_unmerge === true);
  // 붙인 문장을 고르면 글 아래에 풀기 단추가 생긴다
  await pieceOf(merged.id).click();
  const unmerge = page.locator(`[data-testid="assign-act-unmerge-${merged.id}"]`);
  await unmerge.waitFor({ timeout: T });
  await takeShot("sop-assign-unmerge.png");
  await unmerge.click();
  check("Unmerge gives the two pieces back", await waitCount(before + 1));
  // 되돌리기 세 번으로 처음 모양까지(풀기 → 붙이기 → 자르기)
  // 화면이 풀린 조각의 줄을 고른 뒤에 누른다 - 그 전에 되돌리면 화면이 막 사라진 조각의 정보를 한 번 불러 404가 콘솔에 찍힌다(사람 손으로는 나오지 않는 속도)
  await wait(page, "assign-row-id");
  await page.waitForLoadState("networkidle");
  for (const expected of [before, before + 1, before]) {
    await page.locator('[data-testid="assign-undo"]:not([disabled])').click();
    if (!(await waitCount(expected))) break;
    await page.waitForLoadState("networkidle");
  }
  check("three undos return to the original sentence", (await readIds()).length === before);
});

// 배정 화면에서 고른 글자로 새 Unit 만들기(전에는 쪼개기 화면에서만 했다) - 끌어 고르면 용지 위에 줄이 뜨고, 만들고, 되돌린다
await runStep("assign: make a unit from a dragged selection, then undo", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const oldDoc = docs.find((doc) => doc.side === "old" && doc.status === "ready");
  const readUnits = async () => (await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${oldDoc.id}/view`, { headers })).json()).units;
  const before = await readUnits();
  const unit = before.find((item) => item.kind === "sentence" && item.lang === "en" && item.status === "unassigned" && item.text.length > 40);
  check("the fresh bundle has a long unassigned sentence", unit !== undefined);
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const span = page.locator(`[data-testid="assign-paper-unit-${unit.id}"]`).first();
  await span.waitFor({ timeout: T });
  await span.scrollIntoViewIfNeeded();
  const box = await span.boundingBox();
  // Old 조각은 끌어서 잇는 상자라 글자는 Alt를 누른 동안만 긁힌다(끌어다 놓기 설계 G3)
  await page.mouse.move(box.x + 2, box.y + 10);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 10, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await wait(page, "assign-carve");
  const picked = (await getText(page, "assign-carve-text")).trim();
  check("the bar above the paper shows the picked text", picked.length > 0 && unit.text.startsWith(picked), picked);
  await takeShot("sop-assign-carve.png");
  await page.locator('[data-testid="assign-carve-run"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-undo"]')?.disabled === false, null, { timeout: T });
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-carve"]') === null, null, { timeout: T });
  const after = await readUnits();
  check("the picked text becomes its own unit", after.length === before.length + 1 && after.some((item) => item.text.trim() === picked), `${before.length} -> ${after.length}`);
  await page.locator('[data-testid="assign-undo"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast-ok"]')].some((toast) => toast.textContent?.includes("New unit from selection")), null, { timeout: T });
  check("Undo puts the sentence back", (await readUnits()).length === before.length);
});

// 배정 화면에서 한/영 짝 풀고 다시 맺기 - 우클릭 메뉴(전에는 쪼개기 화면에서만 했다). 끝에는 다시 짝이다
await runStep("assign: separate and pair KO/EN from the right-click menu", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const oldDoc = docs.find((doc) => doc.side === "old" && doc.status === "ready");
  const readPairs = async (ids) => {
    const view = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents/${oldDoc.id}/view`, { headers })).json();
    return ids === undefined ? view.units : view.units.filter((unit) => ids.includes(unit.id)).map((unit) => unit.pair_id);
  };
  // 한글 문장 바로 뒤에 영어 짝이 오는 미배정 짝
  const sentences = (await readPairs()).filter((unit) => unit.kind === "sentence");
  const ko = sentences.find((unit, index) => unit.lang === "ko" && unit.pair_id !== null && unit.status === "unassigned" && sentences[index + 1]?.pair_id === unit.pair_id && sentences[index + 1].lang === "en");
  check("the fresh bundle has an unassigned KO/EN pair", ko !== undefined);
  const en = sentences[sentences.indexOf(ko) + 1];
  await page.goto(`${BASE}/bundles/${freshId}/assign`);
  await wait(page, "assign-bar");
  const piece = page.locator(`[data-testid="assign-paper-piece-${ko.id}"], [data-testid="assign-paper-unit-${ko.id}"]`).first();
  await piece.waitFor({ timeout: T });
  await piece.scrollIntoViewIfNeeded();
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-unpair");
  check("a paired sentence cannot be paired again", (await page.locator('[data-testid="assign-ctx-pair_next"]').getAttribute("aria-disabled")) === "true" || (await page.locator('[data-testid="assign-ctx-pair_next"]').isDisabled()));
  const separated = page.waitForResponse((response) => response.request().method() === "DELETE" && /\/pairs\/\d+/.test(response.url()), { timeout: T });
  await page.locator('[data-testid="assign-ctx-unpair"]').click();
  check("Separate saves", (await separated).ok());
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, ko.display_id, { timeout: T });
  check("the two sentences are no longer a pair", (await readPairs([ko.id, en.id])).every((pairId) => pairId === null));
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-pair_next");
  check("Separate leaves the menu once the pair is gone", (await page.locator('[data-testid="assign-ctx-unpair"]').count()) === 0);
  await takeShot("sop-assign-pair-menu.png");
  const joined = page.waitForResponse((response) => response.request().method() === "POST" && /\/pairs$/.test(response.url()), { timeout: T });
  await page.locator('[data-testid="assign-ctx-pair_next"]').click();
  check("Pair with next saves", (await joined).ok());
  await page.waitForFunction((ids) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(ids[1]), [ko.display_id, en.display_id], { timeout: T });
  const again = await readPairs([ko.id, en.id]);
  check("the two sentences are a pair again and share a row", again[0] !== null && again[0] === again[1]);
  // 떨어진 문장과 짝 맺기 - 다시 풀고, 메뉴에서 시작해 영어 문장을 눌러 맺는다. 같은 문장·같은 언어는 맺지 않는다
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-unpair");
  const separatedAgain = page.waitForResponse((response) => response.request().method() === "DELETE" && /\/pairs\/\d+/.test(response.url()), { timeout: T });
  await page.locator('[data-testid="assign-ctx-unpair"]').click();
  await separatedAgain;
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, ko.display_id, { timeout: T });
  await piece.click({ button: "right" });
  await wait(page, "assign-ctx-pair_pick");
  await page.locator('[data-testid="assign-ctx-pair_pick"]').click();
  await wait(page, "assign-pair-pick");
  check("the bar above the paper says which sentence is waiting for a partner", (await getText(page, "assign-pair-pick")).includes(ko.display_id));
  await page.keyboard.press("Escape");
  check("Esc leaves the pick", (await page.locator('[data-testid="assign-pair-pick"]').count()) === 0);
  await piece.click({ button: "right" });
  await page.locator('[data-testid="assign-ctx-pair_pick"]').click();
  await wait(page, "assign-pair-pick");
  const picked = page.waitForResponse((response) => response.request().method() === "POST" && /\/pairs$/.test(response.url()), { timeout: T });
  await page.locator(`[data-testid="assign-paper-unit-${en.id}"]`).first().click();
  check("clicking the other sentence pairs them", (await picked).ok());
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-pair-pick"]') === null, null, { timeout: T });
  const pickedPair = await readPairs([ko.id, en.id]);
  check("the picked sentences are a pair", pickedPair[0] !== null && pickedPair[0] === pickedPair[1]);
  // 셋 이상을 한 짝으로(v1.0.25) - 다시 풀고, Shift+클릭으로 모은 뒤 줄의 단추로 한 번에 맺는다. 끝에는 처음의 두 문장 짝으로 돌려 둔다
  const third = sentences.find((unit) => unit.status === "unassigned" && unit.pair_id === null && (unit.lang === "ko" || unit.lang === "en") && unit.id !== ko.id && unit.id !== en.id);
  if (third === undefined || (await page.locator(`[data-testid="assign-paper-unit-${third.id}"]`).count()) === 0) {
    console.log("  (no third free sentence on screen - pairing three not exercised)");
    return;
  }
  const unpair = async () => {
    await piece.click({ button: "right" });
    await wait(page, "assign-ctx-unpair");
    const gone = page.waitForResponse((response) => response.request().method() === "DELETE" && /\/pairs\/\d+/.test(response.url()), { timeout: T });
    await page.locator('[data-testid="assign-ctx-unpair"]').click();
    await gone;
    await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.trim() === id, ko.display_id, { timeout: T });
    await page.waitForLoadState("networkidle");
  };
  await unpair();
  await piece.click({ button: "right" });
  await page.locator('[data-testid="assign-ctx-pair_pick"]').click();
  await wait(page, "assign-pair-pick");
  check("nothing is offered to run until a sentence is picked", (await page.locator('[data-testid="assign-pair-pick-run"]').count()) === 0);
  await page.locator(`[data-testid="assign-paper-unit-${en.id}"]`).first().click({ modifiers: ["Shift"] });
  await page.locator(`[data-testid="assign-paper-unit-${third.id}"]`).first().click({ modifiers: ["Shift"] });
  await wait(page, "assign-pair-pick-run");
  check("Shift+click collects sentences and marks them on the paper", (await getText(page, "assign-pair-pick-run")).includes("3") && (await page.locator(`[data-testid="assign-paper-unit-${third.id}"][data-pick]`).count()) > 0, await getText(page, "assign-pair-pick-text"));
  await takeShot("sop-assign-pair-many.png");
  const three = page.waitForResponse((response) => response.request().method() === "POST" && /\/pairs$/.test(response.url()), { timeout: T });
  await page.locator('[data-testid="assign-pair-pick-run"]').click();
  check("Pair 3 saves", (await three).ok());
  await page.waitForFunction(() => document.querySelector('[data-testid="assign-pair-pick"]') === null, null, { timeout: T });
  const trio = await readPairs([ko.id, en.id, third.id]);
  check("the three sentences share one pair", trio[0] !== null && trio.every((pairId) => pairId === trio[0]), trio.join(","));
  await page.waitForFunction((id) => document.querySelector('[data-testid="assign-row-id"]')?.textContent?.includes(id), ko.display_id, { timeout: T });
  await page.waitForLoadState("networkidle");
  await unpair();
  await piece.click({ button: "right" });
  await page.locator('[data-testid="assign-ctx-pair_pick"]').click();
  await wait(page, "assign-pair-pick");
  const restored = page.waitForResponse((response) => response.request().method() === "POST" && /\/pairs$/.test(response.url()), { timeout: T });
  await page.locator(`[data-testid="assign-paper-unit-${en.id}"]`).first().click();
  await restored;
  const after = await readPairs();
  const pairOf = (id) => after.find((unit) => unit.id === id)?.pair_id ?? null;
  check("the first two are a pair again and the third is free", pairOf(ko.id) !== null && pairOf(ko.id) === pairOf(en.id) && pairOf(third.id) === null);
});

// 배정 화면에서 보낼 곳 더하고 지우기 - All 목록에서 SOP·WI·단계를 만들고(한 줄씩 바로 저장), 두 번 눌러 지운다. 끝에는 목록이 처음과 같다
await runStep("assign: add and delete destinations from the All list", {}, async ({ page, takeShot }) => {
  const readTobe = async () => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/tobe`, { headers: { "X-Dev-User": "qa.member" } })).json();
  const before = (await readTobe()).docs.map((doc) => doc.code);
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  await page.locator('[data-testid="assign-filter-unassigned"]').click();
  await page.keyboard.press("j");
  await wait(page, "assign-row-id");
  await page.locator('[data-testid="assign-acc-all"]').click();
  await wait(page, "assign-tree-add-doc");
  await page.locator('[data-testid="assign-tree-add-doc"]').click();
  await wait(page, "assign-tree-doc-code");
  check("the number box takes the focus", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "assign-tree-doc-code");
  await page.keyboard.type(before[0]);
  check("a number already in the list cannot be added", await page.locator('[data-testid="assign-tree-doc-add"]').isDisabled());
  await page.locator('[data-testid="assign-tree-doc-code"]').fill("SOP-SMOKE");
  await page.keyboard.press("Enter");
  await wait(page, "assign-tree-pSOP-SMOKE");
  check("the new SOP opens in the list", (await page.locator('[data-testid="assign-tree-pSOP-SMOKE"]').getAttribute("aria-expanded")) === "true");
  await page.locator('[data-testid="assign-tree-add-doc"]').click();
  await page.locator('[data-testid="assign-tree-doc-type-wi"]').click();
  await page.locator('[data-testid="assign-tree-doc-parent"]').click();
  await page.locator('[role="option"]', { hasText: "SOP-SMOKE" }).click();
  await page.locator('[data-testid="assign-tree-doc-code"]').fill("WI-SMOKE");
  await page.locator('[data-testid="assign-tree-doc-add"]').click();
  await wait(page, "assign-tree-pWI-SMOKE");
  const added = await readTobe();
  const sop = added.docs.find((doc) => doc.code === "SOP-SMOKE");
  const wi = added.docs.find((doc) => doc.code === "WI-SMOKE");
  check("the WI is saved under its parent SOP", wi?.parent_code === "SOP-SMOKE" && wi.doc_type === "wi", JSON.stringify(wi));
  check("an SOP with a WI under it cannot be deleted", (await page.locator(`[data-testid="assign-tree-remove-doc-${sop.id}"]`).getAttribute("aria-disabled")) === "true");
  await page.locator(`[data-testid="assign-tree-add-step-${wi.id}"]`).click();
  await page.locator('[data-testid="assign-tree-step-title"]').fill("Smoke step");
  await page.keyboard.press("Enter");
  await wait(page, `assign-tree-remove-step-${wi.id}-1`);
  check("the new step becomes the chosen place", (await getText(page, "assign-chosen")).includes("Smoke step"), await getText(page, "assign-chosen"));
  check("Confirm is ready for it", (await page.locator('[data-testid="assign-primary"]').getAttribute("data-state")) === "confirm");
  await takeShot("sop-assign-add-place.png");
  const removeStep = page.locator(`[data-testid="assign-tree-remove-step-${wi.id}-1"]`);
  await removeStep.click();
  check("the first press only arms the delete", (await removeStep.getAttribute("data-armed")) === "" && (await readTobe()).wi_steps.some((step) => step.code === "WI-SMOKE"));
  await removeStep.click();
  await removeStep.waitFor({ state: "detached", timeout: T });
  check("deleting the chosen step drops the pick", await page.locator('[data-testid="assign-primary"]').isDisabled());
  for (const doc of [wi, sop]) {
    const remove = page.locator(`[data-testid="assign-tree-remove-doc-${doc.id}"]`);
    await remove.click();
    await remove.click();
    await remove.waitFor({ state: "detached", timeout: T });
  }
  const after = (await readTobe()).docs.map((doc) => doc.code);
  check("the list is back to where it started", JSON.stringify(after) === JSON.stringify(before), after.join(","));
  check("a document holding sentences keeps its delete locked", (await page.locator('[data-testid^="assign-tree-remove-doc-"][aria-disabled="true"]').count()) > 0);
});

// 네 단계 워크플로우 - 레일은 Documents·Assign·Order·Outputs, 원문 고치기(옛 쪼개기 화면)는 배정 화면 안에서 열린다. C는 Order에서만 고친다
await runStep("four steps: rail, Order edits C and Outputs reads it", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/bundles/${halfBundleId}`);
  await wait(page, "stage-nav");
  const rail = await page.locator('[data-testid="stage-nav"] .stg-n').evaluateAll((els) => els.map((el) => `${el.textContent}:${el.parentElement.dataset.stage}`));
  check("the rail numbers Documents, Assign, Order, Outputs", rail.join(" ") === "1:documents 2:assign 3:order 4:outputs", rail.join(" "));
  await page.locator('[data-testid="stage-nav-assign"]').click();
  await wait(page, "assign-bar");
  check("the rail has no Split step and Assign has no separate tool screen", (await page.locator('[data-testid="stage-nav-split"]').count()) === 0 && (await page.locator('[data-testid="assign-open-split"]').count()) === 0);
  await page.locator('[data-testid="stage-nav-order"]').click();
  await wait(page, "order-docs");
  await wait(page, "output-c");
  check("Order opens one New document", (await page.locator('[data-testid="output-c"] article').count()) === 1);
  check("Order leaves out the deleted and moved lists", (await page.locator('[data-testid^="output-c-deleted-"], [data-testid^="output-c-moved-"]').count()) === 0);
  // 앞 시나리오들이 배정을 바꿔 두므로 문장이 든 문서를 찾아 연다(첫 문서가 비어 있을 수 있다)
  const [movable] = await findOrderDocs(page, () => (document.querySelector('[data-testid^="output-c-move-"]') ? true : null));
  check("Order lets the author move lines", movable !== undefined);
  const picked = `order-doc-${movable?.[0]}`;
  check("picking a document opens it", (await page.locator(`[data-testid="${picked}"]`).getAttribute("aria-current")) === "true");
  await takeShot("sop-order.png");
  await page.locator('[data-testid="stage-nav-outputs"]').click();
  await page.locator('[data-testid="outputs-tab-c"]').click();
  await wait(page, "output-c");
  check("Outputs shows every New document on C", (await page.locator('[data-testid="output-c"] article').count()) > 1);
  check("C is read-only on Outputs", (await page.locator('[data-testid^="output-c-move-"], [data-testid^="output-c-indent-"]').count()) === 0);
  await page.locator('[data-testid="outputs-edit-order"]').click();
  await page.waitForURL(/\/order$/, { timeout: T });
  await wait(page, "order-docs");
  check("Edit order returns to the document last opened", (await page.locator('[data-testid^="order-doc-"][aria-current="true"]').getAttribute("data-testid")) === picked);
});

// 배정된 문장도 자른다(v1.0.21) - 한 번 묻고 배정을 풀며 자른다(원문 고치기와 같은 규칙). 전에는 "먼저 배정을 지우라"며 막았다
// 서버의 물음(409 confirm_required)이 콘솔에 오류로 찍힌다 - 이 단계가 일부러 받는 응답이다
await runStep("assign: cutting an assigned sentence asks once, then clears its assignment", { allowConsoleErrors: true }, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents`, { headers })).json();
  const readView = async (docId) => (await page.request.get(`${BASE}/api/bundles/${halfBundleId}/documents/${docId}/view`, { headers })).json();
  await page.goto(`${BASE}/bundles/${halfBundleId}/assign`);
  await wait(page, "assign-bar");
  // 화면의 본문에 조각이 있는 영어 문장을 골라 먼저 배정해 확정한다(앞 단계들이 이 Bundle의 배정을 모두 지웠을 수 있다. 머리말·꼬리말의 문장은 다른 탭에 있다)
  let doc = null;
  let unit = null;
  let piece = null;
  for (const candidate of docs.filter((item) => item.side === "old" && item.status === "ready")) {
    const view = await readView(candidate.id);
    const found = view.units.filter((item) => item.kind === "sentence" && item.status === "unassigned" && item.lang === "en" && item.text.trim().split(" ").length >= 4);
    if (found.length === 0) continue;
    await page.locator('[data-testid="assign-old-doc"]').click();
    await page.locator(`[data-testid="assign-old-doc-option-${candidate.id}"]`).click();
    await page.locator(`[data-testid="assign-old"]`).waitFor({ timeout: T });
    await page.waitForTimeout(600);
    for (const item of found) {
      const locator = page.locator(`[data-testid="assign-paper-piece-${item.id}"], [data-testid="assign-paper-unit-${item.id}"]`).first();
      if ((await locator.count()) === 0) continue;
      doc = candidate;
      unit = item;
      piece = locator;
      break;
    }
    if (unit !== null) break;
  }
  check("the bundle has an open English sentence on screen", unit !== null);
  if (unit === null) return;
  await piece.click();
  await wait(page, "assign-row-id");
  await pickFirstPlace(page);
  await page.locator('[data-testid="assign-primary"]').click();
  let assigned = false;
  for (let tries = 0; tries < 60 && !assigned; tries += 1) {
    assigned = (await readView(doc.id)).units.some((item) => item.id === unit.id && item.status === "confirmed");
    if (!assigned) await page.waitForTimeout(250);
  }
  check("the sentence is assigned first", assigned);
  const countUnits = async () => (await readView(doc.id)).units.length;
  // 저장이 끝날 때까지 서버 값을 직접 다시 읽는다
  const waitUnits = async (expected) => {
    for (let tries = 0; tries < 60; tries += 1) {
      if ((await countUnits()) === expected) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const beforeIds = new Set((await readView(doc.id)).units.map((item) => item.id));
  const before = beforeIds.size;
  const openSplit = async () => {
    await piece.scrollIntoViewIfNeeded();
    await piece.click({ button: "right" });
    await wait(page, "assign-ctx-split");
  };
  await openSplit();
  check("Split is offered on an assigned sentence", (await page.locator('[data-testid="assign-ctx-split"]').getAttribute("aria-disabled")) === null);
  check("changing its language stays locked", (await page.locator('[data-testid="assign-ctx-lang-ko"]').getAttribute("aria-disabled")) === "true");
  await page.locator('[data-testid="assign-ctx-split"]').click();
  await wait(page, "assign-cut-run");
  await page.locator('[data-testid="assign-cut-run"]').click();
  await wait(page, "assign-edit-confirm");
  await takeShot("sop-assign-edit-confirm.png");
  // 그만두면 아무것도 바뀌지 않는다
  await page.locator('[data-testid="assign-edit-confirm-cancel"]').click();
  await page.locator('[data-testid="assign-edit-confirm"]').waitFor({ state: "detached", timeout: T });
  check("cancelling leaves the sentence as it was", (await countUnits()) === before);
  if ((await page.locator('[data-testid="assign-cut-run"]').count()) === 0) {
    await openSplit();
    await page.locator('[data-testid="assign-ctx-split"]').click();
    await wait(page, "assign-cut-run");
  }
  await page.locator('[data-testid="assign-cut-run"]').click();
  await wait(page, "assign-edit-confirm");
  await page.locator('[data-testid="assign-edit-confirm-confirm"]').click();
  check("confirming cuts the sentence in two", await waitUnits(before + 1));
  const after = await readView(doc.id);
  check("the cut sentence is no longer among the units", !after.units.some((item) => item.id === unit.id));
  const pieces = after.units.filter((item) => !beforeIds.has(item.id));
  check("its two pieces are unassigned again", pieces.length === 2 && pieces.every((item) => item.status === "unassigned"), pieces.map((item) => item.status).join(", "));
  // 되돌리면 글은 한 문장으로 돌아온다
  await page.locator('[data-testid="assign-undo"]').click();
  check("Undo brings the sentence back as one", await waitUnits(before));
});

await runStep("new bundle in one click, locked stages, empty assign", { devUser: "dev.admin" }, async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid="bundles-new"]').click();
  await page.waitForURL(/\/bundles\/\d+$/, { timeout: T });
  const code = (await getText(page, "overview-code")).trim();
  check("new bundle shows its BND code", /^BND-\d{4,}$/.test(code), code);
  check("Assign and Order are locked without documents", (await page.locator('[data-testid="stage-nav-assign"][aria-disabled="true"], [data-testid="stage-nav-order"][aria-disabled="true"]').count()) === 2);
  check("Split is not on the rail", (await page.locator('[data-testid="stage-nav-split"]').count()) === 0);
  // To-Be 목록은 Documents 화면 안에 있다 - 문서가 없어도 Documents는 열려 있다
  check("Documents (with the To-Be list) stays open without documents", (await page.locator('a[data-testid="stage-nav-documents"]').count()) === 1);
  await page.locator('[data-testid="overview-menu"]').click();
  await page.locator('[data-testid="overview-menu-synthetic"]').click();
  await page.locator('[data-testid="top-bar-synthetic"]').waitFor({ timeout: T });
  check("test-data mark set from the menu", true);
  await page.goto(`${page.url()}/assign`);
  await wait(page, "assign-empty");
  check("empty state instead of an endless skeleton", true);
});

// 목록 둘(v1.0.32) - 위는 Old 문서, 아래는 New 문서. 이미 쓴 New 문서의 파일은 따로 줄을 차지하지 않고 New 목록의 그 줄에 붙어 보인다
await runStep("documents: an Old list and a New list, with written files on their rows", {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  const fresh = page.locator('[data-testid^="bundles-row-"]', { hasText: "쪼개기 직후" });
  const freshId = Number((await fresh.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const docs = await (await page.request.get(`${BASE}/api/bundles/${freshId}/documents`, { headers })).json();
  const tobe = await (await page.request.get(`${BASE}/api/bundles/${freshId}/tobe`, { headers })).json();
  await page.goto(`${BASE}/bundles/${freshId}/documents`);
  await wait(page, "tobe-list");
  await page.locator('[data-testid$="-row"][data-testid^="documents-"]').first().waitFor({ timeout: T });
  check("the two lists are named Old documents and New documents", (await getText(page, "documents-old-title")) === "Old documents" && (await page.locator('[data-testid="tobe-section"] h2').innerText()) === "New documents");
  const oldRows = await page.locator('[data-testid="documents-list"] [data-testid$="-row"]').count();
  check("the top list holds the Old documents only", oldRows === docs.filter((doc) => doc.side === "old").length, String(oldRows));
  check("the table and card switch and the jump button are gone", (await page.locator('[data-testid="documents-view"], [data-testid="documents-jump-tobe"]').count()) === 0);
  const written = tobe.docs.find((doc) => doc.document_id !== null);
  const file = docs.find((doc) => doc.id === written.document_id);
  const cell = page.locator('[data-testid="tobe-list"] [data-testid$="-written"]:not([data-testid$="-not-written"])').first();
  check("a written file shows on its New row", (await cell.innerText()).includes(file.file_name.slice(0, 12)));
  check("rows without a file say so", (await page.locator('[data-testid$="-not-written"]').count()) === tobe.docs.filter((doc) => doc.document_id === null).length);
  await takeShot("sop-documents-two-lists.png");
  await cell.locator('[data-testid$="-written-preview"]').click();
  await wait(page, "documents-preview-split");
  check("the file's preview opens from the row", true);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="documents-preview-split"]').waitFor({ state: "detached", timeout: T });
  // Excel 템플릿·가져오기는 메뉴에 있다
  await page.locator('[data-testid="tobe-more"]').click();
  await wait(page, "tobe-more-menu");
  check("the Excel template and import sit in the menu", (await page.locator('[data-testid="tobe-template"]').count()) === 1 && (await page.locator('[data-testid="tobe-import"]').count()) === 1);
  await page.keyboard.press("Escape");
  // 줄을 펼치면 그 파일의 버전과 언어 배치가 있다
  await cell.locator("xpath=ancestor::tr").locator('[data-testid$="-toggle"]').click();
  await page.locator('[data-testid$="-written-detail"]').first().waitFor({ timeout: T });
  check("opening the row shows the file's version and language layout", (await page.locator('[data-testid$="-written-version"]').count()) === 1 && (await page.locator('[data-testid$="-written-layout"]').count()) === 1);
});

// 합성 SOP 파일을 .shots/synthetic에 만든다 - 저장소에 사본을 두면 OS마다 PNG 압축 바이트가 달라 어긋난다.
// BACKEND_PYTHON - venv가 없는 워크트리에서 다른 체크아웃의 venv python을 절대 경로로 쓴다(링크를 만들지 않게)
function buildSyntheticFiles() {
  const backend = resolve(SCRIPT_DIR, "../../backend");
  const out = resolve(SHOT_DIR, "synthetic");
  const python = process.env.BACKEND_PYTHON || [".venv/bin/python", ".venv/Scripts/python.exe"].map((path) => resolve(backend, path)).find(existsSync);
  if (!python) throw new Error(`backend venv python not found under ${backend}/.venv (or set BACKEND_PYTHON)`);
  execFileSync(python, ["-c", "import sys; from pathlib import Path; from scripts.synthetic_sop import build_synthetic_bundle; build_synthetic_bundle(Path(sys.argv[1]))", out], { cwd: backend, stdio: "inherit" });
  return out;
}

// 올리는 창구 하나(v1.0.31) - Old와 New 파일을 한 창에서 올린다. 앱이 파일 이름의 번호로 쪽을 먼저 고르고, New 파일은 번호가 같은 빈 줄에 붙는다.
// 묶음을 만들 권한이 있는 사람으로 새 묶음에서 하고, 끝에 그 묶음을 지운다(올릴 파일은 backend venv로 합성 생성기를 돌려 만든다)
await runStep("documents: one upload window takes Old and New files", { devUser: "dev.admin" }, async ({ page, takeShot }) => {
  const samples = buildSyntheticFiles();
  const headers = { "X-Dev-User": "dev.admin", "Content-Type": "application/json" };
  const created = await (await page.request.post(`${BASE}/api/bundles`, { headers, data: { title: "SYNTHETIC upload window", is_synthetic: true } })).json();
  const docs = [{ code: "SOP-01", doc_type: "sop", title: "Synthetic SOP" }, { code: "WI-05", doc_type: "wi", parent_code: "SOP-01", title: "Synthetic listed WI" }];
  const listed = await page.request.put(`${BASE}/api/bundles/${created.id}/tobe`, { headers, data: { revision: created.revision, docs, na_slots: [], wi_steps: [{ code: "WI-05", step_no: 1, title: "Clean" }] } });
  check("a new bundle with two listed New documents is ready", listed.ok());
  const readTobe = async () => (await (await page.request.get(`${BASE}/api/bundles/${created.id}/tobe`, { headers })).json()).docs;
  await page.goto(`${BASE}/bundles/${created.id}/documents`);
  await wait(page, "documents-empty-upload");
  check("the New list no longer has its own upload button", (await page.locator('[data-testid="tobe-upload-written"]').count()) === 0);
  await page.locator('[data-testid="documents-empty-upload"]').click();
  await page.locator('[data-testid="upload-files"]').setInputFiles([`${samples}/SYNTHETIC_OLD-6_Hanil_Centrifuge_Cleaning.docx`, `${samples}/SYNTHETIC_WI-05_Hanil_Centrifuge_Cleaning.docx`, `${samples}/SYNTHETIC_WI-04_Labogene_Centrifuge_Operation.docx`]);
  await wait(page, "upload-picked");
  // New 목록을 읽은 뒤에 쪽이 정해진다
  await page.waitForFunction(() => document.querySelector('[data-testid="upload-side-1-new"]')?.getAttribute("aria-pressed") === "true", null, { timeout: T });
  const pressed = async (index) => ((await page.locator(`[data-testid="upload-side-${index}-new"]`).getAttribute("aria-pressed")) === "true" ? "new" : "old");
  check("the app picks New for a number on the New list and Old for the rest", (await pressed(0)) === "old" && (await pressed(1)) === "new" && (await pressed(2)) === "old");
  check("it says which row the New file attaches to", (await getText(page, "upload-note-1")).includes("WI-05"));
  // 사람이 뒤집는다 - 목록에 없는 번호라 줄이 새로 생기고, WI는 상위 SOP를 골라야 올릴 수 있다
  await page.locator('[data-testid="upload-side-2-new"]').click();
  await page.locator('[data-testid="upload-kind-2"]').click();
  await page.locator('[data-testid="upload-kind-2-option-wi"]').click();
  check("a WI that makes a new row needs its parent SOP first", await page.locator('[data-testid="upload-submit"]').isDisabled());
  await page.locator('[data-testid="upload-parent-2"]').click();
  await page.locator('[data-testid="upload-parent-2-option-SOP-01"]').click();
  await takeShot("sop-upload-one-window.png");
  await page.locator('[data-testid="upload-submit"]').click();
  await page.locator('[data-testid="upload-done"]:not([disabled])').waitFor({ timeout: 120000 });
  const rows = Object.fromEntries((await readTobe()).map((doc) => [doc.code, doc]));
  check("the New file attached to its listed row", rows["WI-05"]?.entrance === "match" && rows["WI-05"]?.document_id !== null && rows["WI-05"]?.parent_code === "SOP-01");
  check("the other New file made a row under the SOP picked in the window", rows["WI-04"]?.entrance === "match" && rows["WI-04"]?.doc_type === "wi" && rows["WI-04"]?.parent_code === "SOP-01");
  const documents = await (await page.request.get(`${BASE}/api/bundles/${created.id}/documents`, { headers })).json();
  check("the Old file became an Old document", documents.some((doc) => doc.side === "old" && doc.doc_code === "OLD-6" && doc.status === "ready"));
  await page.locator('[data-testid="upload-done"]').click();
  // 화면 아무 데나 파일을 끌어다 놓으면 같은 창이 그 파일을 담아 열린다
  const dragged = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "SYNTHETIC_OLD-9 dropped.docx"));
    return data;
  });
  await page.dispatchEvent('[data-testid="documents-drop"]', "dragover", { dataTransfer: dragged });
  await wait(page, "documents-drop-veil");
  check("dragging a file over the screen shows where it will go", true);
  await page.dispatchEvent('[data-testid="documents-drop"]', "drop", { dataTransfer: dragged });
  await wait(page, "upload-picked-0");
  check("dropping it opens the same window with the file in it", (await getText(page, "upload-picked-0")).includes("dropped.docx"));
  await page.locator('[data-testid="upload-cancel"]').click();
  // 파일을 지워도 목록 줄은 남는다(배정으로 엮는 줄로 돌아간다)
  const written = documents.find((doc) => doc.doc_code === "WI-05");
  const removed = await page.request.delete(`${BASE}/api/bundles/${created.id}/documents/${written.id}?revision=${written.revision}`, { headers });
  const after = Object.fromEntries((await readTobe()).map((doc) => [doc.code, doc]));
  check("deleting the written file keeps its row on the New list", removed.status() === 204 && after["WI-05"]?.entrance === "assign" && after["WI-05"]?.document_id === null);
  const bundle = await (await page.request.get(`${BASE}/api/bundles/${created.id}`, { headers })).json();
  await page.request.delete(`${BASE}/api/bundles/${created.id}?revision=${bundle.revision}`, { headers });
});

// AI로 목록 읽기(v1.0.34) - 템플릿에 맞지 않는 글을 붙여 넣으면 AI가 줄을 제안하고, 사람이 보고 고친 뒤 목록에 더한다.
// 글에 없는 번호는 서버가 버린다(가짜 AI가 일부러 하나를 지어낸다). AI가 꺼진 백엔드에서는 메뉴에 항목이 없는 것만 본다.
await runStep("documents: AI reads a free-form list into New rows", { devUser: "dev.admin" }, async ({ page }) => {
  const headers = { "X-Dev-User": "dev.admin", "Content-Type": "application/json" };
  const created = await (await page.request.post(`${BASE}/api/bundles`, { headers, data: { title: "SYNTHETIC list reading", is_synthetic: true } })).json();
  await page.request.put(`${BASE}/api/bundles/${created.id}/tobe`, { headers, data: { revision: created.revision, docs: [{ code: "SOP-01", doc_type: "sop", title: "Synthetic SOP" }], na_slots: [], wi_steps: [] } });
  const readTobe = async () => (await page.request.get(`${BASE}/api/bundles/${created.id}/tobe`, { headers })).json();
  const removeBundle = async () => {
    const bundle = await (await page.request.get(`${BASE}/api/bundles/${created.id}`, { headers })).json();
    await page.request.delete(`${BASE}/api/bundles/${created.id}?revision=${bundle.revision}`, { headers });
  };
  const status = await page.request.get(`${BASE}/api/bundles/${created.id}/ai/status`, { headers });
  const isAiOn = status.ok() && (await status.json()).ai_enabled;
  await page.goto(`${BASE}/bundles/${created.id}/documents`);
  await wait(page, "tobe-add-code");
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="tobe-more"]').click();
  await wait(page, "tobe-more-menu");
  if (!isAiOn) {
    check("without AI the menu has no list reading", (await page.locator('[data-testid="tobe-read-open"]').count()) === 0);
    console.log("  (AI is off in this backend - the rest is skipped)");
    await removeBundle();
    return;
  }
  await page.locator('[data-testid="tobe-read-open"]').click();
  await wait(page, "tobe-read-ask");
  check("nothing can be sent before a file or text is given", await page.locator('[data-testid="tobe-read-submit"]').isDisabled());
  await page.locator('[data-testid="tobe-read-text"]').fill("Synthetic restructuring plan\nSOP-QC-0300 | Synthetic cold storage\nWI-QC-0301 | Synthetic storage operation\nQC-0400 | Synthetic checklist");
  await page.locator('[data-testid="tobe-read-submit"]').click();
  await page.locator('[data-testid="tobe-read-preview"]').waitFor({ timeout: 60000 });
  const codes = await page.locator('[data-testid="tobe-read-list"] tbody tr').evaluateAll((rows) => rows.map((row) => row.dataset.testid));
  check("the preview lists the numbers found in the text", ["SOP-QC-0300", "WI-QC-0301", "QC-0400"].every((code) => codes.includes(`tobe-read-${code}-row`)), codes.join(","));
  check("a number that is not in the text is dropped", !codes.some((id) => id.includes("INVENTED")));
  check("a row without a kind blocks adding and says why", (await page.locator('[data-testid="tobe-read-add"]').isDisabled()) && (await getText(page, "tobe-read-problem")).includes("QC-0400"));
  check("nothing is written before the person adds", (await readTobe()).docs.length === 1);
  await page.locator('[data-testid="tobe-read-QC-0400-type"]').click();
  await page.locator('[data-testid="tobe-read-QC-0400-type-option-sop"]').click();
  await page.locator('[data-testid="tobe-read-problem"]').waitFor({ state: "detached", timeout: T });
  await page.locator('[data-testid="tobe-read-add"]').click();
  await page.locator('[data-testid="tobe-read"]').waitFor({ state: "detached", timeout: 30000 });
  await page.waitForLoadState("networkidle");
  const after = await readTobe();
  const byCode = Object.fromEntries(after.docs.map((doc) => [doc.code, doc]));
  check("the picked rows are on the New list with kind, parent and title", after.docs.length === 4 && byCode["WI-QC-0301"]?.parent_code === "SOP-QC-0300" && byCode["QC-0400"]?.doc_type === "sop" && byCode["SOP-QC-0300"]?.title === "Synthetic cold storage", JSON.stringify(after.docs.map((doc) => [doc.code, doc.doc_type, doc.parent_code])));
  check("the WI's steps came with it", after.wi_steps.filter((item) => item.code === "WI-QC-0301").length > 0);
  // 목록은 창이 닫힌 뒤 다시 받는다 - 넷째 줄이 그려질 때까지 기다린다
  await page.locator('[data-testid^="tobe-id-"][data-testid$="-code"]').nth(3).waitFor({ timeout: T });
  const shownCodes = await page.locator('[data-testid^="tobe-id-"][data-testid$="-code"]').evaluateAll((cells) => cells.map((cell) => cell.value ?? cell.textContent));
  check("the new rows show on the list without a reload", ["SOP-QC-0300", "WI-QC-0301", "QC-0400"].every((code) => shownCodes.includes(code)), shownCodes.join(","));
  const left = await (await page.request.get(`${BASE}/api/bundles/${created.id}/tobe/read`, { headers })).json();
  check("the proposal is closed once it is used", left === null && (await page.locator('[data-testid="tobe-proposal"]').count()) === 0);
  await removeBundle();
});

await runStep("assign: an AI-suggested figure shows its caption and confirms with it", {}, async ({ page, takeShot }) => {
  const headers = { "X-Dev-User": "qa.member" };
  const api = (path, body) => (body === undefined ? page.request.get(`${BASE}/api/bundles/${freshBundleId}${path}`, { headers }) : page.request.post(`${BASE}/api/bundles/${freshBundleId}${path}`, { headers, data: body }));
  const status = await api("/ai/status");
  if (!status.ok() || !(await status.json()).ai_enabled) {
    console.log("  (AI is off in this backend - skipped)");
    return;
  }
  // 캡션 단위가 딸린 미확정 그림 - AI 분류가 그림과 그 아래 캡션 새 문장을 함께 제안한다(첫 진입 미리 분류가 이미 했으면 그대로 쓴다)
  const units = (await (await api("/units?limit=1000")).json()).items;
  const caption = units.find((unit) => unit.kind === "caption" && units.some((other) => other.unit_id === unit.group_unit_id && other.kind === "figure" && ["unassigned", "ai_suggested"].includes(other.status)));
  check("the fresh bundle has an open figure with a caption", Boolean(caption));
  if (!caption) return;
  const figure = units.find((unit) => unit.unit_id === caption.group_unit_id);
  if (figure.status === "unassigned") await api("/ai/classify", { unit_ids: [figure.unit_id] });
  for (let tries = 0; tries < 60; tries += 1) {
    const jobs = (await (await api("/ai/status")).json()).jobs;
    if (jobs.queued + jobs.running === 0) break;
    await page.waitForTimeout(500);
  }
  const suggested = (await (await api(`/groups/by-unit/${figure.unit_id}`)).json()).targets.find((target) => target.parent_target_id !== null && target.source_unit_ids.includes(caption.unit_id));
  check("the AI suggestion carries the caption under the figure", suggested?.status === "ai_suggested", suggested?.status);
  if (!suggested) return;
  await page.goto(`${BASE}/bundles/${freshBundleId}/assign`);
  await wait(page, "assign-bar");
  await selectRowById(page, figure.display_id);
  const line = page.locator(`[data-testid="assign-caption-${caption.lang}"]`);
  await line.waitFor({ timeout: T });
  check("the decide box shows the suggested caption", (await line.innerText()).trim() === (suggested.confirmed_text || suggested.ai_text).trim(), await line.innerText());
  const primary = page.locator('[data-testid="assign-primary"]');
  check("Confirm is on for a captioned figure", await primary.isEnabled());
  await takeShot("sop-assign-ai-figure-caption.png");
  await primary.click();
  await page.locator('[data-testid="toast-ok"]').first().waitFor({ timeout: T });
  const saved = (await (await api(`/groups/by-unit/${figure.unit_id}`)).json()).targets.find((target) => target.id === suggested.id);
  check("the caption is confirmed in place under the figure", saved?.status === "confirmed" && saved.parent_target_id === suggested.parent_target_id, saved?.status);
});

// 배정 화면 첫 진입(설계 2026-11-15-ai-prepare-queue §5.2·§8) - PREPARE=1일 때만(머리말의 전제). 알림 → 상단 바 목록의 Background 줄 → 끝나면 AI suggested 수
await runStep(PREPARE_STEP, {}, async ({ page, takeShot }) => {
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const half = page.locator('[data-testid^="bundles-row-"]', { hasText: "분류 절반" });
  const bundleId = Number((await half.getAttribute("data-testid")).replace("bundles-row-", ""));
  const headers = { "X-Dev-User": "qa.member" };
  const status = await (await page.request.get(`${BASE}/api/bundles/${bundleId}/ai/status`, { headers })).json();
  check("backend has AI on (PREPARE=1 needs the fake AI and AI_AUTO_PREPARE=true)", status.ai_enabled === true);
  const before = await (await page.request.get(`${BASE}/api/bundles/${bundleId}`, { headers })).json();
  check("no AI suggestion before the first entry", before.progress.ai_suggested === 0, String(before.progress.ai_suggested));

  await page.goto(`${BASE}/bundles/${bundleId}/assign`);
  const toast = page.locator('[data-testid="toast-ok"]', { hasText: "in the background" });
  await toast.first().waitFor({ timeout: T });
  check("a toast says the remaining rows are classified in the background", /remaining \d+ rows/.test(await toast.first().innerText()), await toast.first().innerText());

  await page.locator('[data-testid="top-bar-ai"]').click();
  const mark = page.locator('[data-testid="ai-jobs-popover"] [data-testid^="ai-jobs-request-"][data-testid$="-background"]');
  await mark.first().waitFor({ timeout: T });
  check("the AI job list marks the request as Background", (await mark.first().innerText()).trim() === "Background");
  await mark.first().hover();
  const tip = page.locator('[role="tooltip"]', { hasText: "Started automatically" });
  await tip.first().waitFor({ timeout: T });
  check("the mark explains itself on hover", true);
  await takeShot("sop-assign-prepare-popover.png");
  const requestRow = (await mark.first().getAttribute("data-testid")).replace(/-background$/, "");
  // 묶기 계획이 먼저 짝을 찾은 줄의 분류는 낡음(stale)으로 끝난다(설계 §5.2) - 실패·취소만 아니면 된다
  const row = page.locator(`[data-testid="${requestRow}"]`);
  await page.locator(`[data-testid="${requestRow}"]:not([data-outcome="running"]):not([data-outcome="queued"])`).waitFor({ timeout: 60000 });
  const outcome = await row.getAttribute("data-outcome");
  check("the background request finishes", outcome === "done" || outcome === "stale", outcome);
  await page.keyboard.press("Escape");

  // 끝나면 화면이 단위를 다시 받는다 - AI suggested 탭 수가 0보다 커진다
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="assign-filter-ai_suggested"] .schip-n')?.textContent ?? 0) > 0, null, { timeout: 30000 });
  check("AI suggested tab count is above zero", true, await page.locator('[data-testid="assign-filter-ai_suggested"] .schip-n').textContent());
  await takeShot("sop-assign-prepare-done.png");
});

await browser.close();
console.log(failures === 0 ? `\nALL PASS (${passes})` : `\n${failures} check(s) FAILED, ${passes} passed`);
process.exit(failures === 0 ? 0 : 1);
