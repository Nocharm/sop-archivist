// 배치 감사(Playwright + 시스템 Chrome) - 극단 자료·좁은/넓은 창에서 화면이 무너지는지 숫자로 잰다. 화면 검토 반영 작업의 회귀 가드.
// 전제: reset_db → seed_sop_demo(= DS=mid) → seed_sop_worst(= DS=worst)를 같은 DB에 돌린 뒤 그 DB로 backend, frontend를 띄운다(보통 8787/3787).
//   DB를 바꾸지 않는다(읽기만 한다). 극단 자료 만드는 법: docs/lessons/browser-verification.md "극단 자료와 배치 감사".
// 실행(frontend/ 에서): DS=worst|mid ONLY=X0,A1 WIDTHS=1120,1920 LANGS=ko,en THEMES=light,dark BASE_URL=http://localhost:3787 node scripts/pw-layout-audit.mjs
//   실패가 하나라도 있으면 종료 코드 1, 실패 화면은 ../.shots/layout-<id>[-<경로 이름>]-<width>[-<lang>-<theme>].png (기본 ko·light는 접미 없음)
// env: DS(기본 worst) · ONLY(항목 id, 쉼표) · WIDTHS(기본은 항목마다 views) · LANGS(기본 ko) · THEMES(기본 light) · BASE_URL(기본 3787) · CHROME_PATH
// 창 높이: 1120→800, 1440→900, 1920→1080, 2560→1440, 그 밖은 900. (pw-overlap-audit는 모든 너비에 900 — 여기는 너비별로 다르다)
//
// 항목 등록 형식(뒤 작업은 AUDIT_ENTRIES에 더하기만 한다):
//   { id: "A1", ds: "worst" | "mid", user: "qa.member", path: (ids) => string | Item[], views: [1120, 1920],
//     open?: async (page) => void, measure: async (page) => number | boolean, expect: (value) => boolean, note: string }
//   path가 배열이면 항목마다 한 번씩 잰다(Item = 주소 문자열 또는 { url, user }). 주소는 BASE_URL 뒤에 붙는다.
//   open은 주소로 들어가 화면이 선 뒤(networkidle + 안정화 0.8초)에 불린다. measure 값이 expect를 통과하지 못하면 FAIL.
//
// ids 지도 모양(seed가 만든 제목 접두로 Bundle 목록 API와 문서 목록 API를 훑어 만든다):
//   {
//     mid:   { 1..4: 데모 묶음 id }                 // "SYNTHETIC 1 …" ~ "SYNTHETIC 4 …"(쪼개기 직후·분류 절반·검토 대기·AI 제안)
//     w:     { 1..7: 극단 묶음 id }                 // W1 worst · W2 in-review · W3 returned · W4 done · W5 reopened · W6 ready · W7 empty
//     light: number[]                              // 위 11개 말고 qa.member에게 보이는 나머지 36개(극단 제목 11 + "SYNTHETIC light NN" 25)
//     docs:  { big, tables, longName, longNameEn, pdf, failed }   // W1의 문서 id — 372 Unit 문서 · 14열 표+120행 표 문서 · 이름 246자 ko · 255자 en · 6쪽 PDF · 거절된 docx
//   }
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, request as pwRequest } from "playwright-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3787";
const SHOTS = resolve(process.cwd(), "../.shots");
const DS = process.env.DS ?? "worst";
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const widthsOverride = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : null;
const langs = (process.env.LANGS ?? "ko").split(",");
const themes = (process.env.THEMES ?? "light").split(",");
const SETTLE_MS = 800;
const T = 20000;
const HEIGHTS = { 1120: 800, 1440: 900, 1920: 1080, 2560: 1440 };

mkdirSync(SHOTS, { recursive: true });

// ---------- 공통 측정 도우미 ----------

// 표 한 개(data-testid)의 가장 큰 행 높이(px)
export async function maxRowHeight(page, tableTestId) {
  return page.locator(`[data-testid="${tableTestId}"]`).first().evaluate((table) => {
    const rows = [...table.querySelectorAll("tr, [role=row]")];
    return Math.round(Math.max(0, ...rows.map((row) => row.getBoundingClientRect().height)));
  });
}

// 선택자가 가리키는 첫 요소가 가로로 넘치는가(scrollWidth > clientWidth + 1). "html"이면 문서 전체
export async function overflowsX(page, selector) {
  return page.locator(selector).first().evaluate((el) => el.scrollWidth > el.clientWidth + 1);
}

export async function widthOf(page, selector) {
  return page.locator(selector).first().evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

// 요소 상자가 창 안에 완전히 들어오는가
export async function isInViewport(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight;
  });
}

// ---------- 항목 ----------

const MEMBER = "qa.member";
const ADMIN_TABS = ["access", "directory", "batch", "ai", "bundles", "guidelines"];

// X0: 어느 화면에서도 문서가 가로로 넘치지 않는다(가로 스크롤이 생기지 않는다)
const sceneUrls = (bundle) => ["", "/documents", "/split", "/tobe", "/assign", "/outputs", "/review", "/history"].map((tail) => `/bundles/${bundle}${tail}`);
const PLAIN_SCENES = ["/", "/manual", "/account"];
const AUDIT_ENTRIES = [
  {
    id: "X0", ds: "mid", user: MEMBER, views: [1120, 1920],
    path: (ids) => [
      ...PLAIN_SCENES,
      ...[1, 2, 3, 4].flatMap((n) => sceneUrls(ids.mid[n])),
      { url: "/", user: "dev.admin" },
      ...ADMIN_TABS.map((tab) => ({ url: `/admin?tab=${tab}`, user: "dev.admin" })),
    ],
    measure: (page) => overflowsX(page, "html"),
    expect: (value) => value === false,
    note: "document does not overflow horizontally on any scene",
  },
  {
    id: "X0", ds: "worst", user: MEMBER, views: [1120, 1920],
    path: (ids) => [
      ...PLAIN_SCENES,
      ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => sceneUrls(ids.w[n])),
      ...ids.light.slice(0, 4).map((id) => `/bundles/${id}`),
      { url: "/", user: "dev.admin" },
      ...ADMIN_TABS.map((tab) => ({ url: `/admin?tab=${tab}`, user: "dev.admin" })),
    ],
    measure: (page) => overflowsX(page, "html"),
    expect: (value) => value === false,
    note: "document does not overflow horizontally on any scene",
  },
];

// ---------- ids 지도 ----------

async function loadIds() {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "X-Dev-User": MEMBER } });
  const getJson = async (url) => {
    const response = await api.get(url);
    if (!response.ok()) throw new Error(`GET ${url} -> ${response.status()}`);
    return response.json();
  };
  const bundles = await getJson("/api/bundles");
  const findByPrefix = (prefix) => bundles.find((b) => b.title.startsWith(prefix))?.id;
  const ids = { mid: {}, w: {}, light: [], docs: {} };
  for (let n = 1; n <= 4; n += 1) ids.mid[n] = findByPrefix(`SYNTHETIC ${n} `);
  const wPrefixes = ["W1 worst", "W2 in-review", "W3 returned", "W4 done", "W5 reopened", "W6 ready", "W7 empty"];
  wPrefixes.forEach((name, i) => { ids.w[i + 1] = findByPrefix(`SYNTHETIC ${name}`); });
  const known = new Set([...Object.values(ids.mid), ...Object.values(ids.w)]);
  ids.light = bundles.filter((b) => !known.has(b.id)).map((b) => b.id).sort((a, b) => a - b);
  if (ids.w[1]) {
    const documents = await getJson(`/api/bundles/${ids.w[1]}/documents`);
    const docPrefixes = { big: "SYNTHETIC_OLD-90_", tables: "SYNTHETIC_OLD-92_", longName: "SYNTHETIC_OLD-93_", longNameEn: "SYNTHETIC_OLD-94_", pdf: "SYNTHETIC_OLD-96_", failed: "SYNTHETIC_corrupt" };
    for (const [key, prefix] of Object.entries(docPrefixes)) ids.docs[key] = documents.find((d) => d.file_name.startsWith(prefix))?.id;
  }
  await api.dispose();
  return ids;
}

function checkIds(ids) {
  const missing = DS === "mid"
    ? [1, 2, 3, 4].filter((n) => !ids.mid[n]).map((n) => `mid ${n}`)
    : [...[1, 2, 3, 4, 5, 6, 7].filter((n) => !ids.w[n]).map((n) => `w ${n}`), ...Object.entries(ids.docs).filter(([, v]) => !v).map(([k]) => `docs.${k}`)];
  if (missing.length > 0) throw new Error(`seed data not found (${missing.join(", ")}) - run scripts.seed_sop_demo and scripts.seed_sop_worst on this DB first`);
}

// ---------- 실행 ----------

const slug = (url) => url.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";

async function main() {
  const ids = await loadIds();
  checkIds(ids);
  const entries = AUDIT_ENTRIES.filter((entry) => entry.ds === DS && (!only || only.includes(entry.id)));
  if (entries.length === 0) throw new Error(`no audit entry for DS=${DS}${only ? ` ONLY=${only}` : ""}`);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const contexts = new Map();
  const getContext = async (user, width, lang, theme) => {
    const key = `${user}|${width}|${lang}|${theme}`;
    if (!contexts.has(key)) {
      const ctx = await browser.newContext({ viewport: { width, height: HEIGHTS[width] ?? 900 }, deviceScaleFactor: 1 });
      await ctx.addInitScript((init) => {
        if (location.protocol === "about:") return;
        localStorage.setItem("sopa.devUser", init.user);
        localStorage.setItem("sopa.lang", init.lang);
        localStorage.setItem("sopa.theme", init.theme);
      }, { user, lang, theme });
      contexts.set(key, ctx);
    }
    return contexts.get(key);
  };
  let problems = 0;
  let runs = 0;
  for (const entry of entries) {
    const raw = entry.path(ids);
    const items = (Array.isArray(raw) ? raw : [raw]).map((item) => (typeof item === "string" ? { url: item, user: entry.user } : item));
    for (const width of widthsOverride ?? entry.views) {
      for (const lang of langs) {
        for (const theme of themes) {
          for (const item of items) {
            const ctx = await getContext(item.user, width, lang, theme);
            const page = await ctx.newPage();
            const tag = `${entry.id} ${width} ${lang} ${theme} ${item.url}`;
            runs += 1;
            let failure = null;
            try {
              await page.goto(`${BASE}${item.url}`, { timeout: T });
              await page.waitForLoadState("networkidle", { timeout: T }).catch(() => {});
              await page.waitForTimeout(SETTLE_MS);
              if (entry.open) await entry.open(page);
              const value = await entry.measure(page);
              if (!entry.expect(value)) failure = `measured ${JSON.stringify(value)} (${entry.note})`;
            } catch (err) {
              failure = `error: ${String(err).split("\n")[0]}`;
            }
            if (failure) {
              problems += 1;
              console.log(`FAIL  ${tag} ${failure}`);
              const suffix = `${items.length > 1 ? `-${slug(item.url)}${item.user === entry.user ? "" : `-${item.user}`}` : ""}-${width}${lang === "ko" && theme === "light" ? "" : `-${lang}-${theme}`}`;
              await page.screenshot({ path: resolve(SHOTS, `layout-${entry.id}${suffix}.png`) }).catch(() => {});
            } else {
              console.log(`ok    ${tag}`);
            }
            await page.close();
          }
        }
      }
    }
  }
  await browser.close();
  console.log(problems === 0 ? `\nALL PASS (${runs} runs)` : `\n${problems} problem(s) in ${runs} runs`);
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
