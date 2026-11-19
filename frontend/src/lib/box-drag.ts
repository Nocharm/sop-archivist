// 상자 전체를 끄는 공통 포인터 끌기 엔진 - 손잡이 없이 4px 넘게 움직이면 끌기, 한 줄 표가 따라오고 놓을 자리 표시는 DOM 속성과 점 달린 선 하나로만 한다.
// 놓을 자리의 글(이유 · 갈 곳)은 화면 밖 상태 글(drag-status)에 둔다 - 읽기 프로그램과 스모크가 같은 글을 읽는다. 표 끝에는 갈 곳만 짧게(dest, 놓을 수 있을 때).
// React를 모른다(React 상태를 프레임마다 바꾸지 않는다). 쓰는 쪽은 `attachBoxDrag`나 `useBoxDrag`로 붙인다.
// 설계: docs/superpowers/specs/2026-11-16-drag-and-drop-design.md §4, 모양은 docs/superpowers/specs/2026-11-20-assign-mockup1-design.md D7
import { createDropLine, type DropLine, type DropLineAt } from "@/lib/drop-line";

export const DRAG_THRESHOLD_PX = 4;
export const DRAG_GUARD_SELECTOR = "button, a, input, select, textarea, [role='slider'], [data-no-drag]";
export const EDGE_SCROLL_ZONE_PX = 44; // 가장자리에서 이 안이면 스크롤
export const EDGE_SCROLL_STEP_PX = 9; // 프레임마다
/** 스크롤 칸 위아래 바깥으로 이만큼까지는 아직 그 칸을 민다 - 칸 밖으로 살짝 나가도 스크롤이 끊기지 않게 */
export const EDGE_SCROLL_OUTSIDE_PX = 24;
const CARD_OFFSET_X_PX = 14;
const CARD_OFFSET_Y_PX = 12;
const DRAG_BOX_SELECTOR = "[data-drag-box]";

export interface DragPoint { x: number; y: number } // clientX·clientY
export interface DragCard { id: string; text: string; count: string | null } // count는 이미 번역한 글("3 lines")
/**
 * state "ok" = 놓을 수 있음, "refused" = 못 놓음(note가 이유), "none" = 놓을 자리 밖. note는 상태 글로만 간다.
 * dest는 표 끝에 짧게 보일 갈 곳("→ 5.2 · indent", "→ link") - ok일 때만 그린다. 거절 이유는 표에 적지 않는다(놓으면 알림).
 * target은 테두리를 그릴 상자(없어도 된다), line은 두 줄 사이 놓을 자리 선(없으면 선을 감춘다)
 */
export interface DragHover { state: "ok" | "refused" | "none"; note?: string; dest?: string; target?: HTMLElement | null; line?: DropLineAt | null }
export interface BoxDragConfig<S> {
  pick: (event: PointerEvent) => S | null; // 끌 것이 없거나 읽기 전용이면 null
  getCard: (source: S) => DragCard;
  getScrollers: () => readonly HTMLElement[]; // 출발 칸과 다른 스크롤 칸도 넣을 수 있다 - 포인터가 든 칸만 민다
  onStart?: (source: S, start: DragPoint) => void; // 문턱을 넘은 뒤 한 번
  onMove: (source: S, point: DragPoint, start: DragPoint) => DragHover; // pointermove마다, 자동 스크롤로 밀린 뒤에도
  onDrop: (source: S, point: DragPoint, start: DragPoint) => void; // 놓았을 때만(취소는 부르지 않는다)
  onEnd?: (source: S, cancelled: boolean) => void; // 놓기·취소 뒤 한 번 - 표시 치우기
  onRefusedDrop?: (note: string) => void; // 못 놓는 자리(이유가 있는 refused)에 놓았을 때 한 번 - useBoxDrag가 알림을 붙인다
}

export function canStartDrag(press: Pick<PointerEvent, "button" | "altKey" | "ctrlKey" | "pointerType">, isGuarded: boolean): boolean {
  // Alt는 글자 긁기, Ctrl+클릭은 macOS 우클릭, 터치는 스크롤과 겹쳐 끌지 않는다
  return press.button === 0 && !press.altKey && !press.ctrlKey && press.pointerType === "mouse" && !isGuarded;
}

/** 가로로 넘치는 상자(넓은 표 등)의 가로 스크롤 막대를 눌렀나 - 막대 누름은 그 상자가 target이고 자리는 글 상자(client) 아래다. 막대만 빼고 상자 안은 그대로 끈다 */
export function isOnHorizontalScrollbar(el: Element | null, clientY: number): boolean {
  if (!el || el.scrollWidth <= el.clientWidth) return false;
  return clientY > el.getBoundingClientRect().top + el.clientTop + el.clientHeight;
}

export function hasPassedThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/** 표의 왼쪽 x - 포인터 오른쪽에 두되 창 오른쪽을 넘으면 포인터 왼쪽으로 넘긴다(창 오른쪽 끝 가까이에서 표가 창 밖으로 나가지 않게) */
export function getCardLeft(pointerX: number, cardWidth: number, viewportWidth: number): number {
  const right = pointerX + CARD_OFFSET_X_PX;
  if (right + cardWidth <= viewportWidth) return right;
  return Math.max(0, pointerX - CARD_OFFSET_X_PX - cardWidth);
}

export function getEdgeScrollDir(point: DragPoint, frame: { left: number; right: number; top: number; bottom: number }): -1 | 0 | 1 {
  if (point.x < frame.left || point.x > frame.right) return 0;
  if (point.y < frame.top - EDGE_SCROLL_OUTSIDE_PX || point.y > frame.bottom + EDGE_SCROLL_OUTSIDE_PX) return 0;
  if (point.y - frame.top < EDGE_SCROLL_ZONE_PX) return -1;
  if (frame.bottom - point.y < EDGE_SCROLL_ZONE_PX) return 1;
  return 0;
}

export function isBoxDragActive(): boolean {
  return document.documentElement.hasAttribute("data-box-drag");
}

/**
 * 포인터 밑에서 끌기가 읽을 요소 - 위에서부터 보되 data-drag-pass(끌기가 지나치는 것, 예: 클릭 배치의 틈 띠)는 건너뛴다.
 * 놓을 때는 html의 data-box-drag가 이미 걷혀 CSS pointer-events로 비켜 세울 수 없어서 여기서 거른다
 */
export function pickUnderPoint(stack: readonly Element[], selector: string): HTMLElement | null {
  const el = stack.find((candidate) => !candidate.closest("[data-drag-pass]"));
  return el instanceof HTMLElement ? el.closest<HTMLElement>(selector) : null;
}

export function findUnderPoint(point: DragPoint, selector: string): HTMLElement | null {
  return pickUnderPoint(document.elementsFromPoint(point.x, point.y), selector);
}

// --- Alt 글자 긁기 모드와 상태 글: 붙은 root가 하나라도 있는 동안만 리스너·상태 글을 둔다 ---

let attachedCount = 0;
let altDown = false;
let altPressedOnBox = false; // Alt를 누른 채 상자를 눌렀다 - 그 keyup이 메뉴 막대로 포커스를 훔치지 않게 막는다

function hasTextSelected(): boolean {
  const selection = window.getSelection();
  return selection !== null && selection.rangeCount > 0 && !selection.isCollapsed;
}

function syncSelectMode(): void {
  document.documentElement.toggleAttribute("data-box-select", altDown || hasTextSelected());
}

function handleAltKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Alt") return;
  altDown = true;
  syncSelectMode();
}

function handleAltKeyUp(event: KeyboardEvent): void {
  if (event.key !== "Alt") return;
  altDown = false;
  if (altPressedOnBox) event.preventDefault();
  altPressedOnBox = false;
  syncSelectMode();
}

function handleWindowBlur(): void {
  altDown = false;
  altPressedOnBox = false;
  syncSelectMode();
}

// 화면 밖 상태 글 - 붙은 root가 있는 동안 하나만 둔다(끌기마다 새로 만들면 읽기 프로그램이 첫 글을 놓친다)
let statusEl: HTMLElement | null = null;

function addStatus(): void {
  statusEl = document.createElement("div");
  statusEl.className = "drag-status";
  statusEl.dataset.testid = "drag-status";
  statusEl.setAttribute("role", "status");
  document.body.append(statusEl);
}

function setStatus(text: string): void {
  if (statusEl && statusEl.textContent !== text) statusEl.textContent = text;
}

function addAltModeListeners(): void {
  window.addEventListener("keydown", handleAltKeyDown);
  window.addEventListener("keyup", handleAltKeyUp);
  window.addEventListener("blur", handleWindowBlur);
  document.addEventListener("selectionchange", syncSelectMode);
}

function removeAltModeListeners(): void {
  window.removeEventListener("keydown", handleAltKeyDown);
  window.removeEventListener("keyup", handleAltKeyUp);
  window.removeEventListener("blur", handleWindowBlur);
  document.removeEventListener("selectionchange", syncSelectMode);
  altDown = false;
  altPressedOnBox = false;
  document.documentElement.removeAttribute("data-box-select");
}

// --- 끌려가는 표(한 줄: id · 글 말줄임 · 개수) ---

export interface CardView {
  el: HTMLElement;
  dest: HTMLElement; // 끝의 갈 곳 - 없으면 hidden
  width: number; // 갈 곳이 바뀔 때만 다시 잰다
}

/** 한 줄 표(id · 글 말줄임 · 개수 · 갈 곳) - 붙이지 않은 채 돌려준다. 폭은 붙인 뒤 applyCardDest가 잰다 */
export function buildCard(card: DragCard): CardView {
  const el = document.createElement("div");
  el.className = "drag-card";
  el.dataset.testid = "drag-card";
  // 글은 textContent로만 넣는다(원문이 HTML처럼 보여도 요소가 되지 않는다)
  const add = (className: string, text: string) => {
    const child = document.createElement("span");
    child.className = className;
    child.textContent = text;
    el.append(child);
  };
  add("drag-card-id", card.id);
  add("drag-card-text", card.text);
  if (card.count !== null) add("drag-card-count", card.count);
  const dest = document.createElement("span");
  dest.className = "drag-card-dest";
  dest.hidden = true;
  el.append(dest);
  return { el, dest, width: 0 };
}

/** 표 끝의 갈 곳을 바꾼다 - 놓을 수 있는 자리의 짧은 글만, 거절 · 자리 밖이면 감춘다. 글이 바뀌면 폭을 다시 잰다 */
export function applyCardDest(view: CardView, hover: DragHover): void {
  const text = hover.state === "ok" ? (hover.dest ?? "") : "";
  if (view.dest.textContent === text) return;
  view.dest.textContent = text;
  view.dest.hidden = text === "";
  view.width = view.el.offsetWidth;
}

function applyHover(view: CardView, hover: DragHover, previous: HTMLElement | null): HTMLElement | null {
  const isRefused = hover.state === "refused";
  view.el.toggleAttribute("data-refused", isRefused);
  // 커서도 거절을 말한다(motion.css) - 값이 바뀔 때만 쓴다
  const flag = isRefused ? "refused" : "";
  if (document.documentElement.getAttribute("data-box-drag") !== flag) document.documentElement.setAttribute("data-box-drag", flag);
  setStatus(hover.note ?? "");
  applyCardDest(view, hover);
  const target = hover.state === "none" ? null : (hover.target ?? null);
  if (previous && previous !== target) delete previous.dataset.drop;
  if (target) target.dataset.drop = hover.state === "ok" ? "over" : "refused";
  return target;
}

// --- 끌기 본체 ---

let dragLive = false; // 한 번에 하나만 끈다

interface Session {
  abort: () => void;
}

export function attachBoxDrag<S>(root: HTMLElement, config: BoxDragConfig<S>): () => void {
  let session: Session | null = null;

  function handlePointerDown(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (event.altKey && target?.closest(DRAG_BOX_SELECTOR)) altPressedOnBox = true;
    if (dragLive || session) return;
    if (!canStartDrag(event, target?.closest(DRAG_GUARD_SELECTOR) != null || isOnHorizontalScrollbar(target, event.clientY))) return;
    const source = config.pick(event);
    if (source === null) return;
    // 누르는 동안 selectstart를 막으니 브라우저가 누름으로 하던 "고른 글자 풀기"를 여기서 한다 - 남겨 두면 고른 글자가 있는 동안 클릭을 받지 않는 화면(Paper)이 죽는다.
    // Alt 누름은 여기까지 오지 않는다(canStartDrag) - 글자 긁기는 선택을 지킨다
    window.getSelection()?.removeAllRanges();
    session = startSession(source, { x: event.clientX, y: event.clientY });
  }

  function startSession(source: S, start: DragPoint): Session {
    let last = start;
    let on = false;
    let view: CardView | null = null;
    let hoverTarget: HTMLElement | null = null;
    let lastHover: DragHover | null = null;
    let line: DropLine | null = null; // 처음 선을 그을 때 root에 붙인다
    let raf = 0;

    // pointerdown에서 preventDefault를 부르지 않는다(포커스 이동과 바깥 누름으로 닫히는 메뉴가 깨진다) - 글자 긁힘은 selectstart·dragstart로 막는다
    const block = (event: Event) => event.preventDefault();

    function render(): void {
      if (!view) return;
      lastHover = config.onMove(source, last, start);
      hoverTarget = applyHover(view, lastHover, hoverTarget);
      if (lastHover.line) (line ??= createDropLine(root)).show(lastHover.line);
      else line?.hide();
      view.el.style.transform = `translate(${getCardLeft(last.x, view.width, window.innerWidth)}px, ${last.y + CARD_OFFSET_Y_PX}px)`;
    }

    function tick(): void {
      let scrolled = false;
      for (const scroller of config.getScrollers()) {
        const dir = getEdgeScrollDir(last, scroller.getBoundingClientRect());
        if (dir === 0) continue;
        const before = scroller.scrollTop;
        scroller.scrollTop += dir * EDGE_SCROLL_STEP_PX;
        if (scroller.scrollTop !== before) scrolled = true;
      }
      if (scrolled) render(); // 스크롤로 밀려 포인터 밑의 줄이 바뀌었다
      raf = window.requestAnimationFrame(tick);
    }

    function handleMove(event: PointerEvent): void {
      last = { x: event.clientX, y: event.clientY };
      if (!on) {
        if (!hasPassedThreshold(last.x - start.x, last.y - start.y)) return;
        on = true;
        dragLive = true;
        window.getSelection()?.removeAllRanges();
        document.documentElement.setAttribute("data-box-drag", "");
        view = buildCard(config.getCard(source));
        document.body.append(view.el);
        view.width = view.el.offsetWidth;
        config.onStart?.(source, start);
        raf = window.requestAnimationFrame(tick);
      }
      render();
    }

    function handleKey(event: KeyboardEvent): void {
      // 아직 끌기가 아닌 누름에서는 Esc를 건드리지 않는다 - 줄의 Esc(고름 놓기)·메뉴 닫기가 그대로 받고, 누름은 끌기나 클릭이 될 수 있다
      if (event.key !== "Escape" || !on) return;
      event.preventDefault();
      event.stopPropagation();
      stop(true);
    }

    const handleUp = (event: PointerEvent) => {
      last = { x: event.clientX, y: event.clientY }; // 놓은 자리가 마지막 move와 다를 수 있다
      stop(false);
    };
    const handleCancel = () => stop(true);
    // Alt-Tab이나 포커스 가로채기 뒤에는 pointerup이 오지 않는다 - 취소하지 않으면 user-select: none과 grabbing이 남는다
    const handleHide = () => {
      if (document.visibilityState === "hidden") stop(true);
    };

    function stop(cancelled: boolean): void {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
      document.removeEventListener("visibilitychange", handleHide);
      window.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("selectstart", block, true);
      window.removeEventListener("dragstart", block, true);
      window.cancelAnimationFrame(raf);
      session = null;
      if (!on) return;
      on = false;
      dragLive = false;
      if (hoverTarget) delete hoverTarget.dataset.drop;
      hoverTarget = null;
      view?.el.remove();
      view = null;
      line?.remove();
      line = null;
      setStatus("");
      document.documentElement.removeAttribute("data-box-drag");
      // 놓은 자리에서 뒤따르는 click 한 번을 삼킨다 - 타이머로 거두어 아무것도 안 눌렀을 때 다음 클릭이 먹히지 않게
      const swallow = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      // 못 놓는 자리에 놓으면 그 이유를 한 번 알린다(설계 D7 확인할 것 3) - 끄는 동안은 상태 글에만 있었다
      const refusal = !cancelled && lastHover?.state === "refused" ? lastHover.note : undefined;
      // onDrop이 던져도 표시는 치운다 - 오류는 그대로 올라간다
      try {
        if (!cancelled) config.onDrop(source, last, start);
        if (refusal) config.onRefusedDrop?.(refusal);
      } finally {
        config.onEnd?.(source, cancelled);
      }
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleCancel);
    document.addEventListener("visibilitychange", handleHide);
    window.addEventListener("keydown", handleKey, true);
    window.addEventListener("selectstart", block, true);
    window.addEventListener("dragstart", block, true);
    return { abort: () => stop(true) };
  }

  root.addEventListener("pointerdown", handlePointerDown);
  if (attachedCount++ === 0) {
    addAltModeListeners();
    addStatus();
  }

  return () => {
    root.removeEventListener("pointerdown", handlePointerDown);
    session?.abort();
    if (--attachedCount === 0) {
      removeAltModeListeners();
      statusEl?.remove();
      statusEl = null;
    }
  };
}
