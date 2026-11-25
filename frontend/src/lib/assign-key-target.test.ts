import { afterEach, describe, expect, it } from "vitest";

import { isMousePress, readKeyPlace, returnsToPaper, takesPrimaryEnter, type KeyPlace } from "@/lib/assign-key-target";

const SCREEN = `
  <div class="assign-bar"><button data-testid="assign-filter-all">All</button></div>
  <section data-pane="old">
    <div class="pane-head"><button data-testid="assign-old-zoom">+</button></div>
    <div class="pane-body" tabindex="-1">
      <button data-testid="assign-paper-fold-run-1">12 sentences</button>
      <span class="num-edit"><button data-testid="num-kind">1.</button></span>
      <aside class="spot-panel"><button data-testid="assign-pair-spot-close">x</button></aside>
    </div>
  </section>
  <aside data-testid="assign-inspector">
    <button data-testid="assign-near-4">§4.3</button>
    <textarea data-testid="assign-text-s1"></textarea>
  </aside>
  <div class="doc-dash"><button data-testid="assign-dash-download-doc">Download</button></div>
  <div class="toast-stack"><div class="toast"><button data-testid="toast-action-1">Undo</button></div></div>
  <div role="dialog"><button data-testid="assign-remark-modal-confirm">OK</button></div>
  <div role="menu"><button data-testid="menu-item">Item</button></div>
  <div role="menu" data-link-menu=""><button data-testid="assign-link-menu-confirm">Confirm</button></div>
`;

function find(testId: string): Element {
  document.body.innerHTML = SCREEN;
  const el = document.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`no ${testId}`);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("readKeyPlace", () => {
  it.each<[string, KeyPlace]>([
    ["assign-near-4", "side"],
    ["assign-text-s1", "typing"],
    ["assign-paper-fold-run-1", "paper"],
    ["num-kind", "pop"],
    ["assign-pair-spot-close", "pop"],
    ["assign-dash-download-doc", "pop"],
    ["toast-action-1", "pop"],
    ["assign-remark-modal-confirm", "layer"],
    ["menu-item", "layer"],
    ["assign-link-menu-confirm", "other"],
    ["assign-filter-all", "other"],
    ["assign-old-zoom", "other"],
  ])("reads %s as %s", (testId, place) => {
    expect(readKeyPlace(find(testId))).toBe(place);
  });

  it("reads the paper itself, the page and a missing target", () => {
    find("assign-near-4");
    expect(readKeyPlace(document.querySelector(".pane-body"))).toBe("paper");
    expect(readKeyPlace(document.body)).toBe("other");
    expect(readKeyPlace(null)).toBe("other");
  });
});

describe("takesPrimaryEnter", () => {
  it("gives Enter to the confirm button on the paper and in the right panel, whatever is focused there", () => {
    expect(takesPrimaryEnter("paper", find("assign-paper-fold-run-1"))).toBe(true);
    expect(takesPrimaryEnter("side", find("assign-near-4"))).toBe(true);
  });

  it("gives Enter to the confirm button elsewhere only when no control is focused", () => {
    expect(takesPrimaryEnter("other", document.body)).toBe(true);
    expect(takesPrimaryEnter("other", null)).toBe(true);
    for (const html of ['<button id="it"></button>', '<a id="it" href="#"></a>', '<div id="it" role="button"></div>', '<div id="it" role="option"></div>', '<button><svg id="it"></svg></button>']) {
      document.body.innerHTML = html;
      expect(takesPrimaryEnter("other", document.getElementById("it")), html).toBe(false);
    }
  });

  it("leaves Enter to a focused link on the paper and in the right panel", () => {
    document.body.innerHTML = '<aside data-testid="assign-inspector"><a href="/documents"><span id="it"></span></a></aside>';
    const target = document.getElementById("it");
    expect(takesPrimaryEnter(readKeyPlace(target), target)).toBe(false);
    expect(takesPrimaryEnter("paper", target)).toBe(false);
  });

  it("leaves Enter to typing, layers and pop-ups", () => {
    for (const place of ["typing", "layer", "pop"] as const) expect(takesPrimaryEnter(place, document.body)).toBe(false);
  });
});

describe("returnsToPaper", () => {
  it("gives the focus back after a press in the top bar, a document head and the right panel", () => {
    for (const testId of ["assign-filter-all", "assign-old-zoom", "assign-near-4"]) expect(returnsToPaper(find(testId)), testId).toBe(true);
  });

  it("leaves the paper's own buttons, pop-ups, layers and buttons that open a list", () => {
    for (const testId of ["assign-paper-fold-run-1", "num-kind", "assign-dash-download-doc", "toast-action-1", "menu-item", "assign-text-s1"]) expect(returnsToPaper(find(testId)), testId).toBe(false);
    const opener = find("assign-filter-all");
    opener.setAttribute("aria-haspopup", "menu");
    expect(returnsToPaper(opener)).toBe(false);
  });
});

describe("isMousePress", () => {
  it("tells a pointer click from a key press on the same button", () => {
    expect(isMousePress({ detail: 1 })).toBe(true);
    expect(isMousePress({ detail: 0 })).toBe(false);
  });
});
