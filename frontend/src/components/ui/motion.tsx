// 움직임 부품 - 접기·펼치기, 내용이 바뀐 자리의 쉬머, 라벨에 따라 폭이 바뀌는 단추의 모핑, 넘치는 글의 말줄임과 호버 툴팁, 목록 자리 바꿈(FLIP).
// 값은 tokens(--dur-*, --ease-*)를 쓰고, 움직임 줄이기 설정에서는 토큰이 0이 되어 바로 바뀐다.
"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { placeBelow, type FloatingPos } from "@/components/ui/floating";
import { computeFlipOffsets } from "@/lib/flip";

// 줄마다 마지막으로 건 FLIP 순번 - 앞선 움직임의 끝 알림이 늦게 와서 새 움직임의 스타일을 지우지 않게
const flipRuns = new WeakMap<HTMLElement, number>();
let flipSequence = 0;

function findFlipElements(container: HTMLElement, keys: readonly string[]): Map<string, HTMLElement> {
  const elements = new Map<string, HTMLElement>();
  for (const key of keys) {
    const element = container.querySelector<HTMLElement>(`[data-flip-key=${JSON.stringify(key)}]`);
    if (element) elements.set(key, element);
  }
  return elements;
}

/** 감싼 요소 안에서의 위쪽 자리 - 스크롤해도 변하지 않는다(재는 사이에 화면이 따라 스크롤해도 거리가 어긋나지 않게) */
function measureTops(container: HTMLElement, elements: ReadonlyMap<string, HTMLElement>): Map<string, number> {
  const base = container.getBoundingClientRect().top;
  return new Map([...elements].map(([key, element]) => [key, element.getBoundingClientRect().top - base]));
}

/**
 * 목록 자리 바꿈 - 바뀌기 전에 capture(바뀔 줄의 키)로 [data-flip-key] 요소 자리를 재면, 다음 커밋에서 다시 재 거꾸로 옮긴 뒤(translateY)
 * 다음 프레임에 --dur-slow·--ease-move로 제자리에 미끄러져 온다. 첫 키가 옮긴 줄이라 미끄러지는 동안 .flip-lead로 이웃 위에 둔다.
 * 긴 목록에서 줄 전체를 재지 않게 넘긴 키만 잰다(그리지 않은 줄은 건너뛴다). 움직임 줄이기 설정이면 아무것도 하지 않아 바로 바뀐다.
 */
export function useFlip(containerRef: RefObject<HTMLElement | null>): { capture: (keys: readonly string[]) => void } {
  const pendingRef = useRef<{ keys: readonly string[]; first: Map<string, number> } | null>(null);

  // 커밋마다 돈다 - 잰 것이 없으면 바로 끝난다
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    const container = containerRef.current;
    pendingRef.current = null;
    if (!pending || !container) return;
    const elements = findFlipElements(container, pending.keys);
    // 앞선 움직임이 아직 돌면 멈추고 제자리에서 잰다 - 처음 자리는 그때 보이던 자리라 이어서 미끄러진다
    for (const element of elements.values()) {
      element.style.transition = "none";
      element.style.transform = "";
    }
    const offsets = computeFlipOffsets(pending.first, measureTops(container, elements));
    const run = ++flipSequence;
    const moving: HTMLElement[] = [];
    for (const [key, element] of elements) {
      const offset = offsets.get(key);
      flipRuns.set(element, run);
      if (offset === undefined) {
        // 움직이지 않은 줄 - 재려고 건 스타일을 지운다(앞선 움직임의 끝 알림도 이 순번 때문에 무시된다)
        element.style.transition = "";
        element.classList.remove("flip-lead");
        continue;
      }
      element.style.transform = `translateY(${offset}px)`;
      element.classList.toggle("flip-lead", key === pending.keys[0]);
      moving.push(element);
    }
    if (moving.length === 0) return;
    // 거꾸로 옮긴 자리를 스타일에 올려 둔다 - 안 하면 다음 프레임의 바꿈과 합쳐져 전환이 일어나지 않는다
    void container.offsetHeight;
    requestAnimationFrame(() => {
      for (const element of moving) {
        if (flipRuns.get(element) !== run) continue;
        const finish = (event: TransitionEvent) => {
          // 줄 안 단추의 투명도 전환도 거품으로 올라온다 - 이 줄의 transform만 본다
          if (event.target !== element || event.propertyName !== "transform") return;
          element.removeEventListener("transitionend", finish);
          element.removeEventListener("transitioncancel", finish);
          if (flipRuns.get(element) !== run) return;
          element.style.transition = "";
          element.classList.remove("flip-lead");
        };
        element.addEventListener("transitionend", finish);
        element.addEventListener("transitioncancel", finish);
        element.style.transition = "transform var(--dur-slow) var(--ease-move)";
        element.style.transform = "";
      }
    });
  });

  function capture(keys: readonly string[]) {
    const container = containerRef.current;
    if (!container || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    pendingRef.current = { keys, first: measureTops(container, findFlipElements(container, keys)) };
  }

  return { capture };
}

// 접힘 전환(--dur-slow 240ms)보다 조금 길게 기다린 뒤 내용을 뗀다
const COLLAPSE_EXIT_MS = 260;

/** 열릴 때 붙이고 다음 프레임에 펼치며, 닫힐 때 접은 뒤 뗀다 - 닫힌 내용은 DOM에 남지 않는다. appear면 열린 채 처음 붙어도 접힌 모양에서 펼친다 */
function usePresence(open: boolean, appear = false): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open && !appear);
  useEffect(() => {
    let frame = 0;
    let timer = 0;
    if (open) {
      frame = requestAnimationFrame(() => {
        setMounted(true);
        frame = requestAnimationFrame(() => setShown(true));
      });
    } else {
      frame = requestAnimationFrame(() => setShown(false));
      timer = window.setTimeout(() => setMounted(false), COLLAPSE_EXIT_MS);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open]);
  return { mounted: mounted || open, shown: shown && open };
}

/** 접기·펼치기 - 높이를 grid 0fr↔1fr로 전환한다(높이를 재지 않아 내용이 바뀌어도 튀지 않는다). children이 함수면 붙어 있는 동안만 그린다.
 * appear면 열린 채 새로 붙어도 펼치며 나타난다. 접히는 동안 안쪽은 inert라 눌리거나 포커스를 받지 않는다 */
export function Collapse({ open, children, testId, className, appear = false }: { open: boolean; children: ReactNode | (() => ReactNode); testId?: string; className?: string; appear?: boolean }) {
  const { mounted, shown } = usePresence(open, appear);
  if (!mounted) return null;
  return (
    <div className={className ? `fold ${className}` : "fold"} data-open={shown ? "" : undefined} data-testid={testId} inert={!open || undefined}>
      <div className="fold-inner">{typeof children === "function" ? children() : children}</div>
    </div>
  );
}

/** 표 안의 펼침 행 - 행째 붙였다 떼고 칸 안쪽을 접기·펼치기로 전환한다 */
export function CollapseRow({ open, colSpan, lead = true, className = "", children }: { open: boolean; colSpan: number; lead?: boolean; className?: string; children: ReactNode }) {
  const { mounted, shown } = usePresence(open);
  if (!mounted) return null;
  return (
    <tr className={className}>
      {lead && <td className="border-0 p-0" />}
      <td colSpan={colSpan} className="p-0">
        <div className="fold" data-open={shown ? "" : undefined}>
          <div className="fold-inner">
            <div className="px-2.5 py-[var(--row-y)]">{children}</div>
          </div>
        </div>
      </td>
    </tr>
  );
}

/** token이 바뀔 때마다 위를 한 번 쓸고 지나가는 쉬머 - 같은 자리의 내용이 바뀌었음을 알린다. 첫 그림에는 쓸지 않는다 */
export function Refresh({ token, children, className = "" }: { token: string | number; children: ReactNode; className?: string }) {
  const [first] = useState(token);
  const isFirst = first === token;
  return (
    <div className={`refresh ${className}`}>
      {children}
      {!isFirst && <span key={String(token)} className="refresh-sweep" aria-hidden />}
    </div>
  );
}

/** 안쪽 내용의 폭을 재서 바깥 폭을 전환한다 - 단추 라벨이 바뀌어도 폭이 툭 바뀌지 않는다. 첫 측정은 전환 없이 */
export function MorphWidth({ children }: { children: ReactNode }) {
  const innerRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const observer = new ResizeObserver(() => {
      setWidth(inner.offsetWidth);
      requestAnimationFrame(() => setAnimate(true));
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const style: CSSProperties = width === null ? {} : { width };
  return (
    <span className="morph" data-animate={animate ? "" : undefined} style={style}>
      <span ref={innerRef} className="morph-inner">
        {children}
      </span>
    </span>
  );
}

/** 비동기 단추의 라벨 - 일하는 동안 스피너와 진행 라벨로 바뀌고 폭은 모핑한다 */
export function BusyLabel({ busy, label, busyLabel, icon }: { busy: boolean; label: ReactNode; busyLabel?: ReactNode; icon?: ReactNode }) {
  return (
    <MorphWidth>
      {busy ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden /> : icon}
      {busy ? (busyLabel ?? label) : label}
    </MorphWidth>
  );
}

const TIP_DELAY_MS = 150;

/** 한 줄 말줄임. 실제로 잘렸을 때만 호버(150ms)로 전체 글을 띄운다 - 네이티브 title은 쓰지 않는다 */
export function Truncate({ text, className = "", lang, testId, revealOnFocus = false }: { text: string; className?: string; lang?: string; testId?: string; revealOnFocus?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<FloatingPos | null>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const host = hostRef.current;
      const tip = tipRef.current;
      if (host && tip) setPos(placeBelow(host.getBoundingClientRect(), tip.getBoundingClientRect(), "start"));
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  // 글이 단추 안에 있으면 포인터 대신 단추의 키보드 포커스가 전체 글을 띄운다(opt-in - 다른 곳의 호버 동작은 그대로)
  const revealFocus = useEffectEvent(() => {
    if (hostRef.current?.closest("button, a, [tabindex]")?.matches(":focus-visible")) show();
  });
  useEffect(() => {
    if (!revealOnFocus) return;
    const holder = hostRef.current?.closest<HTMLElement>("button, a, [tabindex]");
    if (!holder) return;
    const handleFocus = () => revealFocus();
    const handleBlur = () => hide();
    holder.addEventListener("focus", handleFocus);
    holder.addEventListener("blur", handleBlur);
    return () => {
      holder.removeEventListener("focus", handleFocus);
      holder.removeEventListener("blur", handleBlur);
    };
  }, [revealOnFocus]);

  function show() {
    const host = hostRef.current;
    // 한 줄 말줄임(가로)과 카드 제목의 두 줄 자르기(세로) 둘 다 잘렸을 때만 띄운다
    if (!host || (host.scrollWidth <= host.clientWidth && host.scrollHeight <= host.clientHeight)) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), TIP_DELAY_MS);
  }

  function hide() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
    setPos(null);
  }

  return (
    <span ref={hostRef} className={`block min-w-0 truncate ${className}`} lang={lang} data-testid={testId} onPointerEnter={show} onPointerLeave={hide}>
      {text}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="tip tip-wide"
            lang={lang}
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
