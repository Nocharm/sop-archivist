// Assign 긴 문서의 프레임 비용을 잰다 - 로딩 뒤 가만히·호버·스크롤·고르기. 설계: 2026-11-17-assign-long-doc(구현 끝나 지웠다, git 이력)
// 운영 빌드(next build → next start)에 대고 잰다 - 개발 빌드는 React 검사 때문에 몇 배 느려 숫자가 처방을 가린다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3806 BUNDLE=5 DOCS=41,111 node scripts/pw-perf-assign.mjs
//   CPU=4      CPU를 몇 배 느리게(기본 4 - 사내 PC 어림)
//   INJECT=css 재기 전에 넣을 CSS - 처방을 화면에 주입해 고치기 전에 잰다(docs/lessons/ui-review.md)
//   TRACE=scroll|hover|click  그 동작의 브라우저 단계별 시간(배치·칠하기·히트 테스트)과 JS 호출 자리
//   PROFILE=scroll|hover|click 그 동작의 JS 함수별 시간(개발 빌드에 대면 이름이 읽힌다)
//   DEV_USER=qa.member
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3777";
const BUNDLE = process.env.BUNDLE;
const DOCS = (process.env.DOCS ?? "").split(",").filter(Boolean);
const CPU = Number(process.env.CPU ?? "4");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!BUNDLE || DOCS.length === 0) throw new Error("BUNDLE and DOCS (old document ids) are required");

const OLD_PIECE = '[data-pane="old"] .su[data-unit]';
const OLD_BODY = '[data-pane="old"] .pane-body';

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return { n: sorted.length, p50: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +(sorted.at(-1) ?? 0).toFixed(1) };
}

function sumTop(map, count) {
  return [...map].sort((a, b) => b[1] - a[1]).slice(0, count).map(([key, ms]) => `  ${ms.toFixed(0)}ms ${key}`).join("\n");
}

/** 프레임마다 Old 칸을 굴린다 - 프레임 사이 시간을 돌려준다 */
async function runScroll(page, frames, step) {
  return page.evaluate(async ({ selector, frames, step }) => {
    const body = document.querySelector(selector);
    const out = [];
    let last = performance.now();
    for (let i = 0; i < frames; i++) {
      body.scrollTop += step;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      out.push(now - last);
      last = now;
    }
    return out;
  }, { selector: OLD_BODY, frames, step });
}

/** 보이는 조각 위를 위아래로 훑는다 - 움직임마다 조각 하나쯤 */
async function runHover(page, moves) {
  const box = await page.locator(OLD_BODY).boundingBox();
  for (let i = 0; i < moves; i++) await page.mouse.move(box.x + box.width / 2, box.y + 40 + ((i * 23) % (box.height - 80)));
}

async function runClick(page, pieces, index) {
  await pieces.nth(index).scrollIntoViewIfNeeded();
  await pieces.nth(index).click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function runAction(page, kind, pieces, count) {
  if (kind === "scroll") await runScroll(page, 40, -120);
  else if (kind === "hover") await runHover(page, 30);
  else await runClick(page, pieces, Math.floor(count / 2) + 8);
  await page.waitForTimeout(300);
}

async function traceAction(cdp, page, kind, pieces, count) {
  const events = [];
  cdp.on("Tracing.dataCollected", (data) => events.push(...data.value));
  const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline", transferMode: "ReportEvents" });
  await runAction(page, kind, pieces, count);
  await cdp.send("Tracing.end");
  await done;
  const tally = (name, keyOf) => {
    const map = new Map();
    for (const event of events) {
      if (event.ph !== "X" || (name && event.name !== name)) continue;
      const key = keyOf(event);
      map.set(key, (map.get(key) ?? 0) + (event.dur ?? 0) / 1000);
    }
    return map;
  };
  console.log(`--- ${kind} trace: stages`);
  console.log(sumTop(tally(null, (event) => event.name), 14));
  console.log("--- JS calls");
  console.log(sumTop(tally("FunctionCall", (event) => `${event.args?.data?.functionName} ${String(event.args?.data?.url).split("/").pop()}:${event.args?.data?.lineNumber}`), 8));
}

async function profileAction(cdp, page, kind, pieces, count) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await runAction(page, kind, pieces, count);
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  // 포함 시간 - 우리 코드(src)의 이름 있는 함수만
  const total = new Map();
  profile.samples.forEach((id, index) => {
    const seen = new Set();
    for (let current = id; current !== undefined; current = parent.get(current)) {
      const frame = byId.get(current).callFrame;
      if (!/src_|\/src\//.test(frame.url) || !frame.functionName) continue;
      const key = `${frame.functionName} ${frame.url.split("/").pop()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total.set(key, (total.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
    }
  });
  console.log(`--- ${kind} profile: inclusive time of src functions`);
  console.log(sumTop(total, 20));
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript((user) => {
  if (location.protocol === "about:") return;
  localStorage.setItem("sopa.devUser", user);
  localStorage.removeItem("sopa.assign.single");
  window.__longTasks = [];
  window.__events = [];
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(entry.duration); }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__events.push({ name: entry.name, duration: entry.duration }); }).observe({ type: "event", durationThreshold: 16, buffered: true });
}, process.env.DEV_USER ?? "qa.member");

for (const doc of DOCS) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const started = Date.now();
  await page.goto(`${BASE}/bundles/${BUNDLE}/assign?doc=${doc}`);
  await page.locator(OLD_PIECE).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  const loadMs = Date.now() - started;
  if (process.env.INJECT) await page.addStyleTag({ content: process.env.INJECT });
  await page.waitForTimeout(300);
  const dom = await page.evaluate((piece) => ({ nodes: document.getElementsByTagName("*").length, pieces: document.querySelectorAll(piece).length }), OLD_PIECE);
  const reset = () => page.evaluate(() => { window.__longTasks = []; window.__events = []; });
  const readEvents = (pattern) => page.evaluate((source) => window.__events.filter((entry) => new RegExp(source).test(entry.name)).map((entry) => entry.duration), pattern);

  await reset();
  const idle = await page.evaluate(async () => {
    const out = [];
    let last = performance.now();
    const end = last + 6000;
    while (performance.now() < end) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      out.push(now - last);
      last = now;
    }
    return out;
  });
  const idleLongTasks = await page.evaluate(() => window.__longTasks.length);

  await reset();
  const hoverStarted = Date.now();
  await runHover(page, 60);
  const hoverPerMoveMs = Math.round((Date.now() - hoverStarted) / 60);
  const hoverEvents = await readEvents("pointer|mouse");
  await page.mouse.move(0, 0);

  const scroll = await runScroll(page, 80, 120);

  await reset();
  const pieces = page.locator(`${OLD_PIECE}:visible`);
  const count = await pieces.count();
  const clickWallMs = [];
  for (const offset of [0, 2, 5]) {
    const clickStarted = Date.now();
    await runClick(page, pieces, Math.floor(count / 2) + offset);
    clickWallMs.push(Date.now() - clickStarted);
    await page.waitForTimeout(400);
  }
  const clickEvents = await readEvents("click|pointer");

  if (process.env.TRACE) await traceAction(cdp, page, process.env.TRACE, pieces, count);
  if (process.env.PROFILE) await profileAction(cdp, page, process.env.PROFILE, pieces, count);

  console.log(JSON.stringify({ doc, cpu: CPU, loadMs, ...dom, idleFrameMs: summarize(idle), idleLongTasks, hoverPerMoveMs, hoverEventMs: summarize(hoverEvents), scrollFrameMs: summarize(scroll), clickEventMs: summarize(clickEvents), clickWallMs }));
  await page.close();
}
await browser.close();
