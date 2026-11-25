// Assign 긴 문서의 프레임 비용을 잰다 - 로딩 뒤 가만히·호버·스크롤·고르기. 설계: 2026-11-17-assign-long-doc(구현 끝나 지웠다, git 이력)
// 운영 빌드(next build → next start)에 대고 잰다 - 개발 빌드는 React 검사 때문에 몇 배 느려 숫자가 처방을 가린다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3806 BUNDLE=5 DOCS=41,111 node scripts/pw-perf-assign.mjs
//   CPU=4      CPU를 몇 배 느리게(기본 4 - 사내 PC 어림)
//   INJECT=css 재기 전에 넣을 CSS - 처방을 화면에 주입해 고치기 전에 잰다(docs/lessons/ui-review.md)
//   TRACE=scroll|hover|click  그 동작의 브라우저 단계별 시간(배치·칠하기·히트 테스트)과 JS 호출 자리
//   PROFILE=scroll|hover|click 그 동작의 JS 함수별 시간(개발 빌드에 대면 이름이 읽힌다)
//   DEV_USER=qa.member
//   SCENARIO=frames|keys|burst|filter|number|idle|commits  무엇을 잴지(기본 frames = 위의 프레임 비용). frames 밖은 조각 nth(4)를 누르고 1.5초 뒤에 시작한다
//     keys 글쇠 → 다음 박스(j 6번 · Delete 6번) · burst Delete 연타(5번 150ms · 3번 60ms 섞어) · filter 필터 Unassigned 뒤 keys
//     number 번호 칸 5글자 입력 지연 · idle 60초 무조작(가짜 AI를 켠 묶음) · commits 글쇠 한 번의 커밋 수와 PaperChunk 그리기 수(개발 서버)
//     keys · burst · filter · commits는 판단을 쓴다 - is_synthetic 묶음이 아니면 멈추고, 다시 재려면 시드부터 새로
//   REPEAT=6   글쇠 시나리오를 몇 번 되풀이할지
//   LAT=0      요청마다 더할 왕복 지연(ms) - 사내망 어림
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3777";
const BUNDLE = process.env.BUNDLE;
const DOCS = (process.env.DOCS ?? "").split(",").filter(Boolean);
const CPU = Number(process.env.CPU ?? "4");
const SCENARIO = process.env.SCENARIO ?? "frames";
const REPEAT = Number(process.env.REPEAT ?? "6");
const LAT = Number(process.env.LAT ?? "0");
const DEV_USER = process.env.DEV_USER ?? "qa.member";
const WRITING = ["keys", "burst", "filter", "commits"];
if (!["frames", "keys", "burst", "filter", "number", "idle", "commits"].includes(SCENARIO)) throw new Error(`unknown SCENARIO ${SCENARIO}`);
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

const SELECTED_OLD = '[data-pane="old"] [data-sel] [data-unit], [data-pane="old"] [data-unit][data-sel]';

const middle = (values) => summarize(values).p50;

/** 글쇠 하나를 누른 때부터 고른 박스가 바뀔 때까지(ms). 20초 안에 안 바뀌면 -1 */
async function measureKey(page, key) {
  await page.evaluate((selector) => {
    const read = () => document.querySelector(selector)?.getAttribute("data-unit") ?? null;
    window.__keyResult = new Promise((resolve) => {
      const first = read();
      window.addEventListener("keydown", () => {
        const t0 = performance.now();
        const tick = () => {
          if (read() !== first) return resolve(performance.now() - t0);
          if (performance.now() - t0 > 20000) return resolve(-1);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, { once: true, capture: true });
    });
  }, SELECTED_OLD);
  await page.waitForTimeout(80);
  await page.keyboard.press(key);
  const ms = await page.evaluate(() => window.__keyResult);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  return ms;
}

/** 이 동안의 /api 요청을 모은다 - stop()이 TTFB · 저장 TTFB · 개수 · 폭포 길이 · 서로 다른 요청 목록을 돌려준다 */
function watchRequests(page) {
  const rows = [];
  const onFinished = (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    const timing = request.timing();
    rows.push({
      method: request.method(),
      key: `${request.method()} ${url.pathname.replace(/\d+/g, "N")}`,
      start: timing.startTime,
      end: timing.startTime + timing.responseEnd,
      ttfb: timing.responseStart,
    });
  };
  page.on("requestfinished", onFinished);
  return {
    stop() {
      page.off("requestfinished", onFinished);
      const firstWrite = rows.find((row) => row.method !== "GET");
      return {
        count: rows.length,
        ttfbMs: summarize(rows.map((row) => row.ttfb)),
        saveTtfbMs: firstWrite ? +firstWrite.ttfb.toFixed(1) : null,
        spanMs: rows.length === 0 ? 0 : Math.round(Math.max(...rows.map((row) => row.end)) - Math.min(...rows.map((row) => row.start))),
        distinct: [...new Set(rows.map((row) => row.key))],
      };
    },
  };
}

async function readLongTasks(page) {
  return page.evaluate(() => window.__longTasks.map((ms) => +ms.toFixed(0)));
}

/** 묶음의 Old 단위 중 disposition이 delete인 수 - listAllUnits와 같은 쪽매김 */
async function countDeleted(page) {
  let deleted = 0;
  for (let offset = 0; ; offset += 1000) {
    const response = await page.request.get(`${BASE}/api/bundles/${BUNDLE}/units?limit=1000&offset=${offset}`, { headers: { "X-Dev-User": DEV_USER } });
    const body = await response.json();
    deleted += (JSON.stringify(body.items).match(/"disposition":"delete"/g) ?? []).length;
    if (offset + 1000 >= body.total || body.items.length === 0) return deleted;
  }
}

async function runKeys(page) {
  const out = {};
  for (const key of ["j", "Delete"]) {
    const requests = watchRequests(page);
    await page.evaluate(() => { window.__longTasks = []; });
    const values = [];
    for (let i = 0; i < REPEAT; i++) values.push(await measureKey(page, key));
    out[key] = { keyToNextMs: { median: middle(values), all: values.map((v) => +v.toFixed(1)) }, longTasksMs: await readLongTasks(page), requests: requests.stop() };
  }
  return out;
}

async function runBurst(page) {
  const out = {};
  const plans = [
    { name: "delete5@150", keys: Array(5).fill("Delete"), gap: 150 },
    { name: "delete-j-delete@60", keys: ["Delete", "j", "Delete"], gap: 60 },
  ];
  for (const plan of plans) {
    const before = await countDeleted(page);
    for (const key of plan.keys) {
      await page.keyboard.press(key);
      await page.waitForTimeout(plan.gap);
    }
    await page.waitForTimeout(3500);
    const deletes = plan.keys.filter((key) => key === "Delete").length;
    out[plan.name] = { pressedDelete: deletes, deleted: (await countDeleted(page)) - before };
  }
  return out;
}

async function runNumber(page) {
  await page.evaluate(() => {
    window.__inputMs = [];
    document.addEventListener("input", () => {
      const t0 = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => window.__inputMs.push(performance.now() - t0)));
    }, { capture: true });
  });
  const cell = page.locator("button.num-cell").first();
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const input = page.locator(".num-edit-input").first();
  await input.waitFor({ timeout: 5000 });
  await input.fill("");
  await page.evaluate(() => { window.__inputMs = []; });
  for (const char of "12.34") {
    await page.keyboard.type(char);
    await page.waitForTimeout(250);
  }
  await page.keyboard.press("Escape");
  const values = await page.evaluate(() => window.__inputMs);
  return { numberInputMs: { median: middle(values), all: values.map((v) => +v.toFixed(1)) } };
}

async function runIdle(page) {
  const requests = watchRequests(page);
  await page.evaluate(() => { window.__longTasks = []; });
  await page.waitForTimeout(60000);
  const tasks = await readLongTasks(page);
  const seen = requests.stop();
  return { idle60s: { longTasks: tasks.length, longTaskMaxMs: Math.max(0, ...tasks), gets: seen.count, distinct: seen.distinct } };
}

/** 개발 서버에서만 이름이 읽힌다 - 커밋마다 파이버 나무에서 PerformedWork(flags & 1)인 PaperChunk를 센다 */
async function runCommits(page) {
  const out = {};
  for (const key of ["j", "Delete"]) {
    await page.evaluate(() => { window.__commitLog = []; });
    await measureKey(page, key);
    out[key] = await page.evaluate(() => {
      const log = window.__commitLog;
      return { commits: log.length, paperChunkRenders: log };
    });
  }
  return out;
}

async function runScenario(page, cdp) {
  if (LAT > 0) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: LAT, downloadThroughput: -1, uploadThroughput: -1 });
  }
  await page.locator(`${OLD_PIECE}:visible`).nth(4).click();
  await page.waitForTimeout(1500);
  if (SCENARIO === "keys") return runKeys(page);
  if (SCENARIO === "burst") return runBurst(page);
  if (SCENARIO === "filter") {
    await page.locator('[data-testid="assign-filter-unassigned"]').click();
    await page.waitForTimeout(2500);
    return runKeys(page);
  }
  if (SCENARIO === "number") return runNumber(page);
  if (SCENARIO === "idle") return runIdle(page);
  return runCommits(page);
}

async function assertSynthetic(ctx) {
  const response = await ctx.request.get(`${BASE}/api/bundles/${BUNDLE}`, { headers: { "X-Dev-User": DEV_USER } });
  const bundle = await response.json();
  if (!bundle.is_synthetic) throw new Error(`SCENARIO=${SCENARIO} writes decisions but bundle ${BUNDLE} is not is_synthetic - stop`);
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
}, DEV_USER);
if (SCENARIO === "commits") {
  // React 개발 빌드가 DevTools 훅에 알리는 커밋마다 PaperChunk 그리기를 센다(운영 빌드는 이름이 줄어 못 센다)
  await ctx.addInitScript(() => {
    const renderers = new Map();
    const countChunks = (root) => {
      let renders = 0;
      const stack = [root.current];
      while (stack.length > 0) {
        const fiber = stack.pop();
        if (fiber === null || fiber === undefined) continue;
        const name = fiber.type?.name ?? fiber.type?.type?.name;
        if (name === "PaperChunk" && (fiber.flags & 1) !== 0) renders += 1;
        stack.push(fiber.sibling, fiber.child);
      }
      return renders;
    };
    window.__commitLog = [];
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers,
      supportsFiber: true,
      inject(internals) { renderers.set(renderers.size + 1, internals); return renderers.size; },
      onScheduleFiberRoot() {},
      onCommitFiberUnmount() {},
      onCommitFiberRoot(id, root) { window.__commitLog.push(countChunks(root)); },
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  });
}
if (WRITING.includes(SCENARIO)) await assertSynthetic(ctx);

for (const doc of DOCS) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const started = Date.now();
  await page.goto(`${BASE}/bundles/${BUNDLE}/assign?doc=${doc}`);
  await page.locator(OLD_PIECE).first().waitFor({ timeout: 120000 });
  if (SCENARIO !== "frames") {
    console.log(JSON.stringify({ doc, scenario: SCENARIO, cpu: CPU, lat: LAT, repeat: REPEAT, ...(await runScenario(page, cdp)) }));
    await page.close();
    continue;
  }
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
