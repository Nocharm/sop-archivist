// 글자 대비 감사(Playwright + 시스템 Chrome) - 토큰 쌍이 아니라 화면의 실제 글자마다 실제 배경과 대비를 잰다(디자인 문서 15절).
// 기준 4.5:1, 큰 글자(24px 이상 또는 18.66px 이상 굵게) 3:1. 비활성·숨김 요소는 뺀다. 라이트와 다크를 모두 돈다.
// 전제: seed_sop_demo 직후 backend 8777 + frontend 3777. 실행(frontend/ 에서): node scripts/pw-contrast-audit.mjs
import { chromium } from "playwright-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3777";
const T = 15000;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function auditPage(page) {
  return page.evaluate(() => {
    // oklch·color-mix 같은 값을 sRGB로 - 1×1 캔버스에 칠해 읽는다
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const toRgba = (color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const getLuminance = ([r, g, b]) => {
      const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const blend = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3]));
    // 겹친 배경을 아래부터 쌓아 실제 배경을 만든다
    const findBackground = (el) => {
      const layers = [];
      for (let node = el; node; node = node.parentElement) {
        const bg = toRgba(getComputedStyle(node).backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      let color = [255, 255, 255];
      for (const layer of layers.reverse()) color = blend(layer, color);
      return color;
    };
    const failures = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      if (el.closest("[disabled],[aria-disabled='true'],:disabled,.sk,option,select")) continue;
      if (Number(getComputedStyle(el.closest("*")).opacity) < 1 || el.closest("button:disabled")) continue;
      const fg = blend(toRgba(style.color), findBackground(el));
      const bg = findBackground(el);
      const [hi, lo] = [getLuminance(fg), getLuminance(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 600);
      const need = large ? 3 : 4.5;
      if (ratio < need) failures.push(`${ratio.toFixed(2)} < ${need}  "${node.textContent.trim().slice(0, 40)}"  <${el.tagName.toLowerCase()} ${el.getAttribute("data-testid") ?? el.className.toString().slice(0, 40)}>`);
    }
    return failures;
  });
}

let total = 0;
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1248, height: 720 } });
  await ctx.addInitScript((value) => {
    if (location.protocol === "about:") return;
    window.localStorage.setItem("sopa.devUser", "qa.member");
    window.localStorage.setItem("sopa.theme", value);
  }, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.locator('[data-testid^="bundles-row-"]').first().waitFor({ timeout: T });
  const half = page.locator('[data-testid^="bundles-row-"]', { hasText: "분류 절반" });
  const id = Number((await half.getAttribute("data-testid")).replace("bundles-row-", ""));
  // AI 제안의 보라 점선·제안 표시는 4번째 시드 묶음에만 있다
  const aiRow = page.locator('[data-testid^="bundles-row-"]', { hasText: "AI 제안" });
  const aiId = Number((await aiRow.getAttribute("data-testid")).replace("bundles-row-", ""));
  // Assign에서 New 원문 후보(점선)가 있는 조각까지 옮겨 하나를 고른 상태 - 연결 상자·New 원문 표시를 함께 본다
  async function pickCandidate(page) {
    const candidate = page.locator('[data-testid="assign-new"] .new-line[data-state="candidate"]');
    for (let step = 0; step < 40 && (await candidate.count()) === 0; step += 1) {
      await page.keyboard.press("j");
      await page.waitForLoadState("networkidle");
    }
    await candidate.first().locator(".new-hit").click();
    // 그 자리 메뉴(확정·취소)까지 뜬 상태로 잰다 - 늦게 뜨므로 보일 때까지 기다린다
    await page.locator('[data-testid="assign-link-menu-confirm"]').waitFor({ state: "visible", timeout: T });
  }
  async function markManualPieces(page) {
    const firstId = (await page.locator('[data-testid^="manual-toc-"]').first().getAttribute("data-testid")).replace("manual-toc-", "");
    await page.evaluate((id) => window.localStorage.setItem("sopa.manual.read", JSON.stringify({ [id]: "stale" })), firstId);
    await page.reload();
    await page.locator('[data-testid^="manual-unit-"]').first().waitFor({ timeout: T });
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await page.locator('.manual-unit[data-state="read"]').waitFor({ timeout: T });
  }
  const screens = [
    ["bundles", "/", '[data-testid^="bundles-row-"]'],
    ["overview", `/bundles/${id}`, '[data-testid="overview-gate-units"]'],
    ["documents", `/bundles/${id}/documents`, '[data-testid$="-row"][data-testid^="documents-"]'],
    ["split", `/bundles/${id}/split`, '[data-testid^="split-paper-unit-"]'],
    ["tobe", `/bundles/${id}/tobe`, '[data-testid$="-row"][data-testid^="tobe-"]'],
    ["assign", `/bundles/${id}/assign`, '[data-testid="assign-legend"]'],
    ["assign-link", `/bundles/${id}/assign`, '[data-testid="assign-bar"]', pickCandidate],
    ["assign-unsourced", `/bundles/${id}/assign`, '[data-testid="assign-filter-unsourced"]', (page) => page.locator('[data-testid="assign-filter-unsourced"]').click()],
    ["outputs", `/bundles/${id}/outputs`, '[data-testid="output-c"]'],
    ["review", `/bundles/${id}/review`, '[data-testid="output-c"]'],
    ["assign-ai", `/bundles/${aiId}/assign`, '[data-testid="assign-bar"]', async (page) => { await page.keyboard.press("j"); await page.locator('[data-testid="assign-rec-0"]').waitFor({ timeout: T }); }],
    ["outputs-ai", `/bundles/${aiId}/outputs`, '[data-testid="output-c"]'],
    ["manual", "/manual", '[data-testid^="manual-unit-"]'],
    // 읽음 표시의 세 모양을 함께 본다 - 첫 조각은 글이 바뀐 것(Updated), 둘째는 방금 읽은 것(Read), 나머지는 Unread
    ["manual-marked", "/manual", '[data-testid^="manual-unit-"]', markManualPieces],
  ];
  // 감사가 실제로 잡는지 먼저 본다 - 일부러 흐린 글자 하나를 넣는다
  await page.evaluate(() => {
    const probe = document.createElement("p");
    probe.textContent = "contrast probe";
    probe.style.cssText = "position:fixed;top:0;left:0;color:#bbb;background:#fff;font-size:13px";
    document.body.append(probe);
  });
  const probe = await auditPage(page);
  if (!probe.some((line) => line.includes("contrast probe"))) {
    console.log("FAIL audit did not flag the low-contrast probe");
    total += 1;
  }
  for (const [name, path, ready, prep] of screens) {
    await page.goto(`${BASE}${path}`);
    await page.locator(ready).first().waitFor({ timeout: T });
    if (prep) {
      await prep(page);
      await page.waitForLoadState("networkidle");
    }
    await page.waitForTimeout(300);
    const failures = await auditPage(page);
    total += failures.length;
    console.log(`${failures.length === 0 ? "PASS" : "FAIL"} ${theme} ${name}${failures.length ? `\n    ${failures.slice(0, 8).join("\n    ")}` : ""}`);
  }
  await ctx.close();
}
await browser.close();
console.log(total === 0 ? "\nALL PASS" : `\n${total} low-contrast text element(s)`);
process.exit(total === 0 ? 0 : 1);
