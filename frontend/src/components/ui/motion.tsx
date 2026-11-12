// 움직임 부품 - 접기·펼치기, 내용이 바뀐 자리의 쉬머, 라벨에 따라 폭이 바뀌는 단추의 모핑, 넘치는 글의 말줄임과 호버 툴팁.
// 값은 tokens(--dur-*, --ease-*)를 쓰고, 움직임 줄이기 설정에서는 토큰이 0이 되어 바로 바뀐다.
"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { placeBelow, type FloatingPos } from "@/components/ui/floating";

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
export function Truncate({ text, className = "", lang, testId }: { text: string; className?: string; lang?: string; testId?: string }) {
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
