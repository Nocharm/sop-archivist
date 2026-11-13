// Assign 결정 칸으로 시선 끌기 - 위 목록에서 누른 항목의 그림자가 아래 고른 곳 상자로 날아가고, 상자는 닿을 때 한 번 번쩍인다.
// transform·opacity만 움직이고 포인터를 받지 않는다. 그림자는 한 번에 하나(새로 누르면 앞의 것을 지운다). 움직임 줄이기 설정이면 번쩍임만.

/** 누른 항목 - 클릭 때 잰 자리와 보일 글 */
export interface FlightSource {
  rect: DOMRect;
  text: string;
  at: number;
}

/** 그림자가 나는 시간(ms) - 상자 번쩍임은 이만큼 뒤에 시작한다 */
export const FLIGHT_MS = 360;
/** 이보다 오래된 클릭은 날리지 않는다 - 고름이 늦게 반영된 경우 엉뚱한 자리에서 날지 않게 */
const SOURCE_FRESH_MS = 1000;
/** 그림자 높이 상한(px) - 긴 추천 카드도 한 줄 띠로 난다 */
const GHOST_MAX_HEIGHT = 34;

let current: HTMLElement | null = null;
let landTimer: number | null = null;

function isReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 상자를 번쩍인다 - 이미 번쩍이는 중이면 처음부터 */
function flashBox(box: HTMLElement) {
  delete box.dataset.landing;
  void box.offsetWidth;
  box.dataset.landing = "";
  box.addEventListener("animationend", () => delete box.dataset.landing, { once: true });
}

/** 고른 곳 상자로 시선을 끈다 - 막 누른 목록 항목이 있으면 그 자리에서 그림자를 날리고, 없으면(키보드·New 원문·메뉴) 번쩍임만 */
export function runPickFlight(box: HTMLElement, source: FlightSource | null) {
  current?.remove();
  current = null;
  if (landTimer !== null) window.clearTimeout(landTimer);
  landTimer = null;
  const isFresh = source !== null && performance.now() - source.at < SOURCE_FRESH_MS;
  if (!isFresh || isReducedMotion()) {
    flashBox(box);
    return;
  }
  const to = box.getBoundingClientRect();
  const from = source.rect;
  const ghost = document.createElement("div");
  ghost.className = "pick-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.textContent = source.text.replace(/\s+/g, " ").trim().slice(0, 120);
  const height = Math.min(from.height, GHOST_MAX_HEIGHT);
  Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top + (from.height - height) / 2}px`, width: `${Math.min(from.width, to.width)}px`, height: `${height}px`, lineHeight: `${height - 3}px` });
  document.body.append(ghost);
  current = ghost;
  const dx = to.left - from.left;
  const dy = to.top + 6 - (from.top + (from.height - height) / 2);
  // 나는 구간(80%)만 감속 곡선, 남은 20%는 그 자리에서 사라진다
  const animation = ghost.animate(
    [
      { transform: "translate(0, 0)", opacity: 0.95, easing: "cubic-bezier(0.3, 0.6, 0.3, 1)" },
      { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.9, offset: 0.8 },
      { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
    ],
    { duration: FLIGHT_MS, fill: "forwards" },
  );
  animation.onfinish = () => {
    ghost.remove();
    if (current === ghost) current = null;
  };
  landTimer = window.setTimeout(() => {
    landTimer = null;
    flashBox(box);
  }, FLIGHT_MS - 60);
}
