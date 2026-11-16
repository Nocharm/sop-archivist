// 상자 전체를 끄는 공통 포인터 끌기 엔진 - 손잡이 없이 4px 넘게 움직이면 끌기, 표 한 장이 따라오고 놓을 자리 표시는 DOM 속성으로만 한다.
// React를 모른다(React 상태를 프레임마다 바꾸지 않는다). 쓰는 쪽은 `attachBoxDrag`나 `useBoxDrag`로 붙인다.
// 설계: docs/superpowers/specs/2026-11-16-drag-and-drop-design.md §4

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
/** state "ok" = 놓을 수 있음, "refused" = 못 놓음(note가 이유), "none" = 놓을 자리 밖. target은 테두리를 그릴 상자(없어도 된다) */
export interface DragHover { state: "ok" | "refused" | "none"; note?: string; target?: HTMLElement | null }
export interface BoxDragConfig<S> {
  pick: (event: PointerEvent) => S | null; // 끌 것이 없거나 읽기 전용이면 null
  getCard: (source: S) => DragCard;
  getScrollers: () => readonly HTMLElement[]; // 출발 칸과 다른 스크롤 칸도 넣을 수 있다 - 포인터가 든 칸만 민다
  onStart?: (source: S, start: DragPoint) => void; // 문턱을 넘은 뒤 한 번
  onMove: (source: S, point: DragPoint, start: DragPoint) => DragHover; // pointermove마다, 자동 스크롤로 밀린 뒤에도
  onDrop: (source: S, point: DragPoint, start: DragPoint) => void; // 놓았을 때만(취소는 부르지 않는다)
  onEnd?: (source: S, cancelled: boolean) => void; // 놓기·취소 뒤 한 번 - 표시 치우기
}

export function canStartDrag(press: Pick<PointerEvent, "button" | "altKey" | "ctrlKey" | "pointerType">, isGuarded: boolean): boolean {
  // Alt는 글자 긁기, Ctrl+클릭은 macOS 우클릭, 터치는 스크롤과 겹쳐 끌지 않는다
  return press.button === 0 && !press.altKey && !press.ctrlKey && press.pointerType === "mouse" && !isGuarded;
}

export function hasPassedThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
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

export function findUnderPoint(point: DragPoint, selector: string): HTMLElement | null {
  const el = document.elementFromPoint(point.x, point.y);
  return el instanceof HTMLElement ? el.closest<HTMLElement>(selector) : null;
}

// --- Alt 글자 긁기 모드: 붙은 root가 하나라도 있는 동안만 리스너를 건다 ---

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

// --- 끌려가는 표 ---

interface CardView {
  el: HTMLElement;
  note: HTMLElement;
}

function buildCard(card: DragCard): CardView {
  const el = document.createElement("div");
  el.className = "drag-card";
  el.dataset.testid = "drag-card";
  // 글은 textContent로만 넣는다(원문이 HTML처럼 보여도 요소가 되지 않는다)
  const add = (className: string, text: string): HTMLElement => {
    const child = document.createElement("span");
    child.className = className;
    child.textContent = text;
    el.append(child);
    return child;
  };
  add("drag-card-id", card.id);
  add("drag-card-text", card.text);
  if (card.count !== null) add("drag-card-count", card.count);
  const note = add("drag-card-note", "");
  note.hidden = true;
  return { el, note };
}

function applyHover(view: CardView, hover: DragHover, previous: HTMLElement | null): HTMLElement | null {
  view.el.toggleAttribute("data-refused", hover.state === "refused");
  view.note.textContent = hover.note ?? "";
  view.note.hidden = !hover.note;
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
    if (!canStartDrag(event, target?.closest(DRAG_GUARD_SELECTOR) != null)) return;
    const source = config.pick(event);
    if (source === null) return;
    session = startSession(source, { x: event.clientX, y: event.clientY });
  }

  function startSession(source: S, start: DragPoint): Session {
    let last = start;
    let on = false;
    let view: CardView | null = null;
    let hoverTarget: HTMLElement | null = null;
    let raf = 0;

    // pointerdown에서 preventDefault를 부르지 않는다(포커스 이동과 바깥 누름으로 닫히는 메뉴가 깨진다) - 글자 긁힘은 selectstart·dragstart로 막는다
    const block = (event: Event) => event.preventDefault();

    function render(): void {
      if (!view) return;
      view.el.style.transform = `translate(${last.x + CARD_OFFSET_X_PX}px, ${last.y + CARD_OFFSET_Y_PX}px)`;
      hoverTarget = applyHover(view, config.onMove(source, last, start), hoverTarget);
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
        config.onStart?.(source, start);
        raf = window.requestAnimationFrame(tick);
      }
      render();
    }

    function handleKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      stop(true);
    }

    const handleUp = (event: PointerEvent) => {
      last = { x: event.clientX, y: event.clientY }; // 놓은 자리가 마지막 move와 다를 수 있다
      stop(false);
    };
    const handleCancel = () => stop(true);

    function stop(cancelled: boolean): void {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
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
      document.documentElement.removeAttribute("data-box-drag");
      // 놓은 자리에서 뒤따르는 click 한 번을 삼킨다 - 타이머로 거두어 아무것도 안 눌렀을 때 다음 클릭이 먹히지 않게
      const swallow = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      if (!cancelled) config.onDrop(source, last, start);
      config.onEnd?.(source, cancelled);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKey, true);
    window.addEventListener("selectstart", block, true);
    window.addEventListener("dragstart", block, true);
    return { abort: () => stop(true) };
  }

  root.addEventListener("pointerdown", handlePointerDown);
  if (attachedCount++ === 0) addAltModeListeners();

  return () => {
    root.removeEventListener("pointerdown", handlePointerDown);
    session?.abort();
    if (--attachedCount === 0) removeAltModeListeners();
  };
}
