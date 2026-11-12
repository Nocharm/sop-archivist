// 배치 감사(Playwright + 시스템 Chrome) - 극단 자료·좁은/넓은 창에서 화면이 무너지는지 숫자로 잰다. 화면 검토 반영 작업의 회귀 가드.
// 전제: reset_db → seed_sop_demo(= DS=mid) → seed_sop_worst(= DS=worst)를 같은 DB에 돌린 뒤 그 DB로 backend, frontend를 띄운다(보통 8787/3787).
//   DB를 바꾸지 않는다(읽기만 한다). 극단 자료 만드는 법: docs/lessons/browser-verification.md "⚠️ 함정" 9번.
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
  // ---- Task 2: 관리 목록·History 표 줄 높이 ----
  {
    id: "A5", ds: "worst", user: "dev.admin", views: [1120],
    path: () => "/admin?tab=bundles",
    measure: async (page) => {
      const frameOverflows = await page.locator('[data-testid="admin-bundles-list"]').first().evaluate((table) => {
        const frame = table.parentElement;
        return frame.scrollWidth > frame.clientWidth + 1;
      });
      const button = page.locator('[data-testid^="admin-bundle-members-"]').first();
      await button.locator("xpath=ancestor::tr").hover();
      const inView = await button.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.left >= 0 && box.right <= window.innerWidth;
      });
      return { frameOverflows, inView };
    },
    expect: (value) => value.frameOverflows === false && value.inView === true,
    note: "bundle table stays inside its frame; members button inside viewport on row hover",
  },
  {
    id: "A6", ds: "worst", user: "dev.admin", views: [1120, 1920],
    path: () => "/admin?tab=access",
    open: async (page) => {
      await page.getByTestId("access-sub-grants").click();
      await page.waitForTimeout(SETTLE_MS);
    },
    measure: (page) => page.locator('[data-testid^="grant-row-"]').evaluateAll((rows) => {
      const heights = rows.map((row) => row.getBoundingClientRect().height).sort((a, b) => a - b);
      return Math.round(heights[Math.floor(heights.length / 2)] ?? 0);
    }),
    expect: (value) => value > 0 && value <= 56,
    note: "grants-table row height median <= 56px",
  },
  {
    id: "A7", ds: "worst", user: "dev.admin", views: [1120],
    path: () => "/admin?tab=guidelines",
    measure: (page) => maxRowHeight(page, "guideline-versions"),
    expect: (value) => value > 0 && value <= 80,
    note: "guideline-versions largest row <= 80px",
  },
  {
    id: "A8", ds: "worst", user: "dev.admin", views: [1120],
    path: () => "/admin?tab=access",
    open: async (page) => {
      await page.getByTestId("access-sub-audit").click();
      await page.waitForTimeout(SETTLE_MS);
    },
    measure: (page) => maxRowHeight(page, "audit-table"),
    expect: (value) => value > 0 && value <= 56,
    note: "audit-table largest row <= 56px",
  },
  {
    id: "A9", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}/history`,
    measure: (page) => maxRowHeight(page, "history-list"),
    expect: (value) => value > 0 && value <= 60,
    note: "history-list largest row <= 60px",
  },
  {
    id: "A11", ds: "worst", user: "dev.admin", views: [1120],
    path: () => "/admin?tab=access",
    measure: (page) => page.locator('[data-testid^="role-row-"]').evaluateAll((rows) => Math.round(Math.max(0, ...rows.map((row) => row.getBoundingClientRect().height)))),
    expect: (value) => value > 0 && value <= 140,
    note: "role-row-* largest <= 140px",
  },
  {
    id: "C6", ds: "mid", user: MEMBER, views: [1440],
    path: () => "/",
    measure: (page) => page.locator('[data-testid^="bundles-row-"]').first().evaluate((row) => {
      const pill = row.querySelector("td:nth-child(2) .pill").getBoundingClientRect();
      const box = row.getBoundingClientRect();
      return Math.round(Math.abs((pill.top + pill.bottom) / 2 - (box.top + box.bottom) / 2) * 10) / 10;
    }),
    expect: (value) => value <= 2,
    note: "status pill vertical centre within 2px of row centre",
  },
  {
    id: "A1", ds: "worst", user: MEMBER, views: [1120, 1920],
    path: (ids) => `/bundles/${ids.w[1]}/tobe`,
    measure: (page) => page.locator('[data-testid="tobe-list"]').evaluate((table) => {
      const code = table.querySelector("thead th:nth-child(2)").getBoundingClientRect().width;
      return { fits: table.getBoundingClientRect().right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1, code: Math.round(code) };
    }),
    expect: (value) => value.fits && value.code >= 160,
    note: "tobe-list stays inside the frame and the doc-code column is >= 160px",
  },
  {
    id: "C3", ds: "mid", user: MEMBER, views: [1920],
    path: (ids) => `/bundles/${ids.mid[2]}/tobe`,
    open: async (page) => {
      await page.locator('[data-testid^="tobe-"][data-testid$="-toggle"]').first().click();
      await page.waitForTimeout(500);
    },
    measure: (page) => page.locator('[data-testid^="tobe-"][data-testid$="-slots"]').first().evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    expect: (value) => value > 0 && value <= 280,
    note: "one expanded SOP's N/A slots block <= 280px at 1920",
  },
  {
    id: "Focus2", ds: "worst", user: "dev.admin", views: [1120],
    path: () => "/admin?tab=guidelines",
    open: async (page) => {
      const memo = page.locator('[data-testid^="guideline-note-"] [tabindex="0"]').filter({ hasText: /^[\s\S]{200,}$/ }).first();
      await memo.focus();
      await page.waitForTimeout(500);
    },
    measure: async (page) => {
      const tip = page.locator('[role="tooltip"]').first();
      return (await tip.count()) === 0 ? 0 : (await tip.innerText()).length;
    },
    expect: (value) => value >= 200,
    note: "focusing a guideline memo shows its full 200 characters in a tooltip",
  },
  // ---- Task 4: Split ----
  {
    id: "A2", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}/split?doc=${ids.docs.tables}`,
    measure: (page) => page.locator(".ptbl").first().evaluate((table) => {
      const widths = [...table.querySelectorAll("td")].map((td) => td.getBoundingClientRect().width);
      const wide = [...document.querySelectorAll(".ptbl")].sort((a, b) => b.rows[0].cells.length - a.rows[0].cells.length)[0];
      const wideWidths = [...wide.querySelectorAll("td")].map((td) => td.getBoundingClientRect().width);
      const overlaps = [...document.querySelectorAll(".cell-piece")].some((piece) => {
        const marks = piece.querySelector(".cell-marks");
        const text = piece.querySelector(":scope > p");
        if (!marks || !text || marks.children.length === 0) return false;
        const m = marks.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(text);
        return [...range.getClientRects()].some((r) => r.right > m.left + 0.5 && r.left < m.right && r.bottom > m.top && r.top < m.bottom);
      });
      return { minCell: Math.round(Math.min(...widths, ...wideWidths)), overlaps };
    }),
    expect: (value) => value.minCell >= 100 && value.overlaps === false,
    note: "narrowest table cell >= 100px and cell marks do not overlap cell text",
  },
  {
    id: "A3", ds: "worst", user: MEMBER, views: [1920],
    path: (ids) => `/bundles/${ids.w[1]}/split?doc=${ids.docs.big}`,
    measure: (page) => page.evaluate(() => {
      const inspector = document.querySelector('[data-testid="split-inspector"]').getBoundingClientRect().left;
      const rights = [...document.querySelectorAll(".pg")].map((pg) => pg.getBoundingClientRect().right);
      return { maxRight: Math.round(Math.max(...rights)), inspector: Math.round(inspector) };
    }),
    expect: (value) => value.maxRight <= value.inspector,
    note: "every .pg right edge <= split-inspector left edge",
  },
  {
    id: "C2", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}/split`,
    measure: (page) => page.evaluate(() => {
      const disabled = document.querySelectorAll('[data-testid="split-inspector"] :disabled').length;
      const scroller = document.querySelector('[data-testid="split-docs"] > div');
      const frame = scroller.getBoundingClientRect();
      let visible = 0;
      for (const button of scroller.querySelectorAll('[data-testid^="split-doc-"]')) {
        const box = button.getBoundingClientRect();
        visible += Math.max(0, Math.min(box.bottom, frame.bottom) - Math.max(box.top, frame.top)) / box.height;
      }
      return { disabled, docs: Math.round(visible * 10) / 10 };
    }),
    expect: (value) => value.disabled === 0 && value.docs >= 12,
    note: "idle inspector has 0 disabled buttons; >= 12 document buttons visible in split-docs",
  },
  {
    id: "C2", ds: "mid", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.mid[2]}/split`,
    measure: (page) => page.locator('[data-testid="split-inspector"] :disabled').count(),
    expect: (value) => value === 0,
    note: "idle inspector has 0 disabled buttons",
  },
  {
    id: "R8", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}/split?doc=${ids.docs.big}`,
    measure: (page) => page.evaluate(() => {
      const long = [...document.querySelectorAll(".strip > p")].find((p) => (p.textContent ?? "").length >= 1790);
      return long ? Math.round(long.getBoundingClientRect().width) : 0;
    }),
    expect: (value) => value >= 340,
    note: "1,800-character paragraph text box >= 340px wide at 1120",
  },
  // ---- Task 5: 결과물 A·B·C ----
  {
    id: "A4", ds: "worst", user: MEMBER, views: [1120, 1920],
    path: (ids) => `/bundles/${ids.w[1]}/outputs`,
    open: async (page) => {
      await page.getByTestId("outputs-tab-a").click();
      await page.locator('[data-testid="output-a"] tbody tr').first().waitFor({ timeout: T });
      await page.waitForTimeout(SETTLE_MS);
    },
    measure: async (page) => {
      const measureRows = () => page.locator('[data-testid^="output-a-row-"]').evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
      const frameOverflows = await page.locator('[data-testid="output-a"]').evaluate((table) => {
        const frame = table.parentElement;
        return frame.scrollWidth > frame.clientWidth + 1 || table.getBoundingClientRect().right > window.innerWidth + 1;
      });
      const before = await measureRows();
      const maxRow = Math.max(...before);
      const biggest = before.indexOf(maxRow);
      // 가장 큰 줄의 펼치기를 눌러 그 줄만 커지는지 본다(없으면 expandOk=false)
      const expand = page.locator('[data-testid^="output-a-row-"]').nth(biggest).locator('[data-testid$="-expand"]');
      let expandOk = false;
      if ((await expand.count()) > 0) {
        await expand.first().click();
        await page.waitForTimeout(400);
        const after = await measureRows();
        expandOk = after.every((height, i) => (i === biggest ? height > before[i] : height === before[i]));
      }
      return { frameOverflows, maxRow, expandOk };
    },
    expect: (value) => value.frameOverflows === false && value.maxRow <= 220 && value.expandOk === true,
    note: "output-a inside its frame, largest row <= 220px, expand grows only that row",
  },
  {
    id: "C8", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}/outputs`,
    open: async (page) => {
      await page.getByTestId("outputs-tab-c").click();
      await page.locator('[data-testid^="output-c-item-"]').first().waitFor({ timeout: T });
      await page.waitForTimeout(SETTLE_MS);
    },
    measure: async (page) => {
      // 2줄 이상으로 접히는 글 줄의 오른쪽 남는 폭 - 번호·들여쓰기는 줄의 일부라 row 폭 대신 줄 오른쪽 끝 차이로 잰다
      const { gap: worstGap, wrapped } = await page.locator('[data-testid^="output-c-row-"]').evaluateAll((rows) => {
        let worst = 0;
        let wrapped = 0;
        for (const row of rows) {
          const item = row.querySelector('[data-testid^="output-c-item-"]');
          if (!item) continue;
          const range = document.createRange();
          range.selectNodeContents(item);
          const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          if (lines.size < 2) continue;
          wrapped += 1;
          worst = Math.max(worst, row.getBoundingClientRect().right - item.getBoundingClientRect().right);
        }
        return { gap: Math.round(worst), wrapped };
      });
      const rows = page.locator('[data-testid^="output-c-row-"]');
      const total = Math.min(await rows.count(), 16);
      let overlap = 0;
      let restOpacity = null;
      let hoverOpacity = null;
      const overlapOf = (row) => row.evaluate((el) => {
        const actions = el.querySelector(".row-actions-quiet").getBoundingClientRect();
        let worst = 0;
        for (const box of document.querySelectorAll('[data-testid^="output-c-item-"]')) {
          const b = box.getBoundingClientRect();
          const h = Math.min(actions.bottom, b.bottom) - Math.max(actions.top, b.top);
          const w = Math.min(actions.right, b.right) - Math.max(actions.left, b.left);
          if (h > 0.5 && w > 0.5) worst = Math.max(worst, h);
        }
        return Math.round(worst);
      });
      const opacityOf = (row) => row.locator(".row-actions-quiet").evaluate((el) => Math.round(Number(getComputedStyle(el).opacity) * 100) / 100);
      for (let i = 0; i < total; i += 1) {
        const row = rows.nth(i);
        if ((await row.locator(".row-actions-quiet").count()) === 0) continue;
        await row.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        overlap = Math.max(overlap, await overlapOf(row));
        restOpacity ??= await opacityOf(row);
        await row.hover({ position: { x: 8, y: 4 } });
        await page.waitForTimeout(300);
        overlap = Math.max(overlap, await overlapOf(row));
        hoverOpacity ??= await opacityOf(row);
      }
      return { worstGap, wrapped, overlap, restOpacity, hoverOpacity };
    },
    expect: (value) => value.wrapped > 0 && value.worstGap <= 24 && value.overlap === 0 && value.restOpacity >= 0.4 && value.restOpacity <= 0.5 && value.hoverOpacity === 1,
    note: "wrapped lines fill the row (right gap <= 24px); action group overlaps no text box at rest or hovered; opacity ~0.45 at rest, 1 on hover",
  },
  {
    id: "C9", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}/outputs`,
    open: async (page) => {
      await page.getByTestId("outputs-tab-b").click();
      await page.locator('[data-testid="output-b"] section').first().waitFor({ timeout: T });
      await page.waitForTimeout(SETTLE_MS);
    },
    measure: (page) => page.locator('[data-testid="output-b"] section').evaluateAll((cards) => {
      let duplicates = 0;
      for (const card of cards) {
        const labels = [...card.querySelectorAll("li > span:nth-child(2)")].map((el) => el.textContent.trim());
        duplicates += labels.length - new Set(labels).size;
      }
      return { duplicates, maxCard: Math.round(Math.max(0, ...cards.map((card) => card.getBoundingClientRect().height))) };
    }),
    expect: (value) => value.duplicates === 0 && value.maxCard <= 320,
    note: "visible target labels distinct within a card; largest card <= 320px",
  },
  {
    id: "I1", ds: "mid", user: MEMBER, views: [1440],
    path: (ids) => `/bundles/${ids.mid[2]}/outputs`,
    open: async (page) => {
      await page.getByTestId("outputs-tab-a").click();
      await page.locator('[data-testid="output-a"] tbody tr').first().waitFor({ timeout: T });
      await page.waitForTimeout(SETTLE_MS);
    },
    // 손으로 짠 dtable(Output A)의 칸 첫 줄이 모두 위에 붙어야 한다(DataList의 가운데 정렬이 새면 줄 높이만큼 어긋난다)
    measure: (page) => page.locator('[data-testid="output-a"] tbody tr').evaluateAll((rows) => {
      let spread = 0;
      for (const row of rows) {
        const tops = [...row.cells].map((td) => {
          const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
          let node = walker.nextNode();
          while (node && node.textContent.trim() === "") node = walker.nextNode();
          if (!node) return null;
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getClientRects()[0].top - row.getBoundingClientRect().top;
        }).filter((top) => top !== null);
        if (tops.length > 1) spread = Math.max(spread, Math.max(...tops) - Math.min(...tops));
      }
      return Math.round(spread * 10) / 10;
    }),
    expect: (value) => value <= 2,
    note: "output-a cells' first lines start at the same height within 2px (top-aligned)",
  },
  {
    id: "I2", ds: "mid", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.mid[2]}/assign`,
    measure: (page) => page.locator(".ptbl").evaluateAll((tables) => {
      let worst = 0;
      for (const table of tables) {
        let strip = table.parentElement;
        while (strip && !/(auto|scroll)/.test(getComputedStyle(strip).overflowX)) strip = strip.parentElement;
        if (strip) worst = Math.max(worst, table.scrollWidth - strip.clientWidth);
      }
      return { tables: tables.length, worst: Math.round(worst) };
    }),
    expect: (value) => value.tables > 0 && value.worst <= 1,
    note: "no Assign .ptbl is wider than the strip that holds it (min-width 16ch stays in Split)",
  },
  // ---- Task 6: Assign ----
  {
    // A10: 오른쪽 패널의 목적지 트리 - 노드 한 줄(<=32px), 개수 칸이 패널 안
    id: "A10", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}/assign`,
    open: async (page) => {
      await page.getByTestId("assign-bar").waitFor({ timeout: T });
      if ((await page.getByTestId("assign-acc-all").count()) === 0) await page.locator('[data-testid="assign-old"] .su[data-unit]').first().click();
      await page.getByTestId("assign-acc-all").click();
      // 안쪽 노드는 바깥을 펼쳐야 생긴다 - 더 펼칠 것이 없을 때까지
      for (let round = 0; round < 4; round += 1) {
        const closed = page.locator('.tree-node[aria-expanded="false"]');
        const n = await closed.count();
        if (n === 0) break;
        for (let i = n - 1; i >= 0; i -= 1) await closed.nth(i).click();
      }
      await page.waitForTimeout(SETTLE_MS);
    },
    measure: (page) => page.evaluate(() => {
      const nodes = [...document.querySelectorAll(".tree-node")];
      const inspector = document.querySelector('[data-testid="assign-inspector"]').getBoundingClientRect();
      const outside = nodes.flatMap((node) => [...node.children]).filter((el) => el.getBoundingClientRect().right > inspector.right + 0.5).length;
      return { nodes: nodes.length, maxHeight: Math.round(Math.max(0, ...nodes.map((node) => node.getBoundingClientRect().height))), outside };
    }),
    expect: (value) => value.nodes > 0 && value.maxHeight <= 32 && value.outside === 0,
    note: "assign tree-node one line (<= 32px), count cells inside the inspector",
  },
  {
    // C1: 1120에서 문서 칸이 좁아지지 않고, 2560에서 작업면 폭이 1920
    id: "C1", ds: "mid", user: MEMBER, views: [1120, 2560],
    path: (ids) => `/bundles/${ids.mid[2]}/assign`,
    open: async (page) => {
      await page.getByTestId("assign-bar").waitFor({ timeout: T });
    },
    measure: (page) => page.evaluate(() => {
      const w = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width);
      return { vw: window.innerWidth, wrap: w(".page-wrap"), old: w('[data-testid="assign-old"]'), inspector: w('[data-testid="assign-inspector"]') };
    }),
    expect: (value) => (value.vw <= 1200 ? value.old >= 350 : value.wrap === 1920),
    note: "1120: Old pane >= 350px; 2560: page-wrap width = 1920",
  },
  {
    // C11/F1: 도구 줄이 한 줄(1440 <= 44px), 좁은 창은 <= 80px
    id: "C11", ds: "mid", user: MEMBER, views: [1440, 1120],
    path: (ids) => `/bundles/${ids.mid[2]}/assign`,
    open: async (page) => {
      await page.getByTestId("assign-bar").waitFor({ timeout: T });
    },
    measure: (page) => page.getByTestId("assign-bar").evaluate((bar) => ({ vw: window.innerWidth, h: Math.round(bar.getBoundingClientRect().height) })),
    expect: (value) => (value.vw >= 1440 ? value.h <= 44 : value.h <= 80),
    note: "assign-bar height <= 44px at 1440, <= 80px at 1120",
  },
  {
    // AI를 켠 backend에서 같은 도구 줄(AI 메뉴가 더해진다) - AI 꺼진 backend에서는 C11과 같은 값을 잰다
    id: "F1", ds: "mid", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.mid[2]}/assign`,
    open: async (page) => {
      await page.getByTestId("assign-bar").waitFor({ timeout: T });
    },
    measure: (page) => page.getByTestId("assign-bar").evaluate((bar) => Math.round(bar.getBoundingClientRect().height)),
    expect: (value) => value <= 80,
    note: "assign-bar height <= 80px at 1120 (run against an AI-on backend)",
  },
  {
    // R1: 표 칸 글의 마지막 낱말이 줄 끝 아이콘 상자와 겹치지 않는다
    id: "R1", ds: "mid", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.mid[3]}/assign`,
    open: async (page) => {
      await page.getByTestId("assign-bar").waitFor({ timeout: T });
    },
    measure: (page) => page.evaluate(() => {
      let checked = 0;
      let overlaps = 0;
      for (const piece of document.querySelectorAll('[data-pane] .cell-piece, [data-testid="assign-old"] .cell-piece')) {
        const marks = [...piece.querySelectorAll(".pmark-host")];
        const text = piece.querySelector(":scope > p");
        if (marks.length === 0 || !text) continue;
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
        let last = null;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent.trim()) last = node;
        if (!last) continue;
        const body = last.textContent.replace(/\s+$/, "");
        const start = Math.max(body.lastIndexOf(" ") + 1, 0);
        const range = document.createRange();
        range.setStart(last, start);
        range.setEnd(last, body.length);
        const word = range.getClientRects();
        checked += 1;
        if (marks.some((mark) => { const m = mark.getBoundingClientRect(); return [...word].some((r) => r.right > m.left + 0.5 && r.left < m.right && r.bottom > m.top + 0.5 && r.top < m.bottom - 0.5); })) overlaps += 1;
      }
      return { checked, overlaps };
    }),
    expect: (value) => value.checked > 0 && value.overlaps === 0,
    note: "last word of a table-cell piece does not overlap its row-end icons",
  },
  {
    // R2: 1,200자 사유가 든 Unit(OLD-91 보류)을 고르면 사유 칸이 3줄 이상 높이
    id: "R2", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}/assign`,
    open: async (page) => {
      await page.getByTestId("assign-bar").waitFor({ timeout: T });
      const found = await page.evaluate(async () => {
        const id = location.pathname.split("/")[2];
        const response = await fetch(`/api/bundles/${id}/units?limit=1000&offset=0`, { headers: { "X-Dev-User": localStorage.getItem("sopa.devUser") ?? "" } });
        const unit = (await response.json()).items.find((item) => (item.decision.hold_reason ?? "").length >= 1000 || (item.decision.reason ?? "").length >= 1000);
        return unit ? { unit: unit.unit_id, doc: unit.document_id } : null;
      });
      if (!found) throw new Error("no unit with a 1,200-char reason");
      await page.getByTestId("assign-old-doc").click();
      await page.getByTestId(`assign-old-doc-option-${found.doc}`).click();
      await page.locator(`[data-testid="assign-old"] .su[data-unit="${found.unit}"]`).first().click();
      await page.waitForTimeout(SETTLE_MS);
    },
    measure: (page) => page.getByTestId("assign-reason").evaluate((el) => ({ tag: el.tagName, h: Math.round(el.getBoundingClientRect().height), len: el.value.length })),
    expect: (value) => value.len >= 1000 && value.h >= 3 * 19,
    note: "reason field of a 1,200-char reason is >= 3 lines (57px) tall",
  },
  // ---- Task 7: 개요 ----
  {
    // A12: 극단 묶음 개요에서 검토 요청 단추가 첫 화면(y <= 800) 안
    id: "A12", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}`,
    open: async (page) => { await page.getByTestId("overview-request-review").waitFor({ timeout: T }); },
    measure: (page) => page.getByTestId("overview-request-review").evaluate((el) => Math.round(el.getBoundingClientRect().bottom)),
    expect: (value) => value > 0 && value <= 800,
    note: "request-review button bottom edge is inside the first 800px at 1120",
  },
  {
    // B5: 문서 0개 묶음 개요에 빨강 조건 묶음이 없고 본문이 낮다
    id: "B5", ds: "worst", user: MEMBER, views: [1120, 1920],
    path: (ids) => `/bundles/${ids.w[7]}`,
    open: async (page) => { await page.getByTestId("overview").waitFor({ timeout: T }); },
    measure: (page) => page.evaluate(() => ({
      fail: document.querySelectorAll(".gate-group.fail").length,
      idle: document.querySelectorAll('[data-testid="overview-gate-idle"]').length,
      h: Math.round(document.querySelector('[data-testid="overview"]').getBoundingClientRect().height),
      body: (() => { const col = document.querySelector('[data-testid="overview"] > div'); return Math.round(col.lastElementChild.getBoundingClientRect().bottom - col.getBoundingClientRect().top); })(),
    })),
    expect: (value) => value.fail === 0 && value.idle === 1 && value.body <= 520,
    note: "empty bundle overview: no .gate-group.fail, neutral idle line, content column <= 520px",
  },
  {
    // R4: 되돌림 사유가 접힌 채 "더 보기" 단추가 보이고, 누르면 사유가 scrollHeight만큼 자라며 안쪽 스크롤이 없다
    id: "R4", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[3]}`,
    open: async (page) => { await page.getByTestId("overview-return-reason").waitFor({ timeout: T }); },
    measure: async (page) => {
      const reason = page.getByTestId("overview-return-reason");
      const more = page.getByTestId("overview-return-more");
      const visible = await more.isVisible();
      if (!visible) return { visible };
      const before = await reason.evaluate((el) => ({ h: el.getBoundingClientRect().height, sh: el.scrollHeight }));
      await more.click();
      await page.waitForTimeout(600);
      const after = await reason.evaluate((el) => ({ h: el.getBoundingClientRect().height, sh: el.scrollHeight, ch: el.clientHeight }));
      return { visible, before, after };
    },
    expect: (value) => value.visible && value.after.h > value.before.h && Math.abs(value.after.h - value.after.sh) <= 2 && value.after.sh <= value.after.ch + 1,
    note: "collapsed reason shows a more button; expanding grows it to its scrollHeight with no inner scroll",
  },
  {
    id: "Focus4", ds: "worst", user: MEMBER, views: [1120],
    path: (ids) => `/bundles/${ids.w[1]}`,
    open: async (page) => { await page.getByTestId("overview-request-review").waitFor({ timeout: T }); },
    measure: (page) => page.getByTestId("overview-request-review").evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    expect: (value) => value > 0 && value <= 36,
    note: "request-review button is one line (<= 36px) at 1120 in English (run with LANGS=en)",
  },
  // ---- Task 8: 없는 주소·못 여는 Bundle ----
  {
    // B1: 없는 주소가 앱 틀 안의 빈 화면 - 다크에서 body 배경이 --bg, 목록으로 돌아가는 단추, 한국어에 영어 기본 문구 없음
    id: "B1", ds: "mid", user: MEMBER, views: [1120],
    path: () => "/no-such-page",
    open: async (page) => { await page.getByTestId("not-found").waitFor({ timeout: T }); },
    measure: (page) => page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.background = "var(--bg)";
      document.body.appendChild(probe);
      const token = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const back = document.querySelector('[data-testid="not-found-back"]');
      const box = back?.getBoundingClientRect();
      return {
        bodyBg: getComputedStyle(document.body).backgroundColor,
        token,
        back: Boolean(box && box.width > 0 && box.height > 0),
        english: document.body.innerText.includes("This page could not be found"),
      };
    }),
    expect: (value) => value.bodyBg === value.token && value.back && !value.english,
    note: "not-found renders in the shell: body background equals --bg, not-found-back visible, no default English copy",
  },
  {
    // B2·R6: 멤버가 아닌 Bundle(mid[1]은 prod.member가 아니다 - API 404) 다섯 주소에서 목록으로 돌아가는 길이 있고 다시 시도는 없으며, 단계 레일 링크와 상단 바 뒤로·구분선이 없다
    id: "B2", ds: "mid", user: "prod.member", views: [1120],
    path: (ids) => ["documents", "split", "assign", "outputs", "history"].map((s) => ({ url: `/bundles/${ids.mid[1]}/${s}`, user: "prod.member", stage: s })),
    open: async (page) => {
      await page.locator('[data-testid$="-missing"]').first().waitFor({ timeout: T });
    },
    measure: async (page) => {
      const stage = new URL(page.url()).pathname.split("/").pop();
      return page.evaluate((s) => ({
        missing: document.querySelectorAll(`[data-testid="${s}-missing"]`).length,
        back: document.querySelectorAll(`[data-testid="${s}-back"]`).length,
        retry: document.querySelectorAll(`[data-testid="${s}-retry"]`).length,
        railLinks: document.querySelectorAll('[data-testid="stage-nav"] a').length,
        rail: document.querySelectorAll('[data-testid="stage-nav"]').length,
        topBack: document.querySelectorAll('[data-testid="top-bar-back"]').length,
        sep: document.querySelectorAll(".tb-sep").length,
      }), stage);
    },
    expect: (value) => value.missing === 1 && value.back === 1 && value.retry === 0 && value.railLinks === 0 && value.rail === 0 && value.sep === 0 && value.topBack === 0,
    note: "five stage URLs of a bundle prod.member cannot open: <id>-missing + <id>-back, no -retry, no stage rail, no top-bar divider or back arrow",
  },
  {
    // B2b: 상단 바 뒤로 화살표는 묶음 밖 화면과 정상 Bundle에는 남는다(못 여는 Bundle에서만 숨긴다)
    id: "B2b", ds: "mid", user: MEMBER, views: [1120],
    path: (ids) => ["/account", "/manual", "/no-such-page", `/bundles/${ids.mid[2]}/documents`],
    open: async (page) => { await page.getByTestId("top-bar").waitFor({ timeout: T }); await page.waitForTimeout(600); },
    measure: (page) => page.locator('[data-testid="top-bar-back"]').count(),
    expect: (value) => value === 1,
    note: "top-bar-back is present on /account, /manual, /no-such-page and a normally loading bundle",
  },
  // ---- Task 9: 검토 화면 되돌림 쪽지 ----
  {
    // B3: 되돌린 Bundle(W3)의 검토 화면에 쪽지가 보이고 사유 첫 20자가 화면 안에 있다 - 작성자와 검토자 둘 다
    id: "B3", ds: "worst", user: MEMBER, views: [1120, 1920],
    path: (ids) => [MEMBER, "qa.lead"].map((user) => ({ url: `/bundles/${ids.w[3]}/review`, user })),
    open: async (page) => { await page.getByTestId("review-return-note").waitFor({ timeout: T }); await page.waitForTimeout(600); },
    measure: (page) => page.evaluate(() => {
      const note = document.querySelector('[data-testid="review-return-note"]');
      const reason = document.querySelector('[data-testid="review-return-reason"]');
      const noteBox = note.getBoundingClientRect();
      const textNode = reason?.firstChild;
      const range = document.createRange();
      if (textNode) { range.setStart(textNode, 0); range.setEnd(textNode, Math.min(20, textNode.textContent.length)); }
      const rects = textNode ? [...range.getClientRects()] : [];
      const inView = (box) => box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth;
      return {
        note: inView(noteBox),
        reason: rects.length > 0 && rects.every(inView),
        noteLeft: Math.round(noteBox.left),
        noteTop: Math.round(noteBox.top),
      };
    }),
    expect: (value) => value.note && value.reason,
    note: "returned bundle (W3) review screen shows review-return-note with the first 20 characters of the reason inside the viewport",
  },
  {
    // B3b: 검토 중인 Bundle(W2)의 검토 화면에는 쪽지가 없다
    id: "B3b", ds: "worst", user: MEMBER, views: [1120, 1920],
    path: (ids) => `/bundles/${ids.w[2]}/review`,
    open: async (page) => { await page.getByTestId("review").waitFor({ timeout: T }); await page.waitForTimeout(1200); },
    measure: (page) => page.locator('[data-testid="review-return-note"]').count(),
    expect: (value) => value === 0,
    note: "in-review bundle (W2) has no return note on the review screen",
  },
];
// B5는 새(문서 0개) Bundle이면 되므로 mid에서도 W7로 한 번 더 잰다(W7은 같은 DB에 있다)
AUDIT_ENTRIES.push({ ...AUDIT_ENTRIES.find((entry) => entry.id === "B5"), ds: "mid" });

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
