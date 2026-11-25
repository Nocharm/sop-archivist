// Assign 오른쪽 칸의 틀 - 넓은 창에서는 격자에 붙은 칸, 창이 1440px보다 좁고 떼었으면 두 문서 위에 뜨는 판(설계 2026-11-25 §6 S3).
// 판은 모달이 아니다 - role도 포커스 가두기도 없어 단축키와 원문 누르기가 그대로 된다. 머리 전체를 끌어 옮기고, 자리는 그릴 때마다 창 안으로 가둔다.
// 붙어 있을 때와 같은 aside라 떼고 붙여도 안의 내용(펼친 묶음 · 쓰던 글)이 다시 만들어지지 않는다.
"use client";

import { ChevronDown, ChevronUp, PanelRight, PictureInPicture2 } from "lucide-react";
import { useRef, type PointerEvent, type ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import type { AssignView } from "@/lib/assign-view-prefs";
import { useI18n } from "@/lib/i18n";
import { clampFloat, getFloatHeight, getFloatStart, isSideFloating, SIDE_FLOAT_MAX_VIEW, SIDE_FLOAT_WIDTH, type FloatPoint } from "@/lib/side-float-model";
import { useWindowSize } from "@/lib/use-window-size";

type SidePrefs = Pick<AssignView, "sideFloat" | "sideX" | "sideY" | "sideFolded">;

interface SideFloatProps {
  prefs: SidePrefs;
  onChange: (patch: Partial<SidePrefs>) => void;
  /** 칸의 내용 - headEnd(떼기 단추, 좁은 창에서 붙어 있을 때만)는 내용의 머리 끝에 앉는다 */
  children: (headEnd: ReactNode) => ReactNode;
}

export function SideFloat({ prefs, onChange, children }: SideFloatProps) {
  const { t } = useI18n();
  const view = useWindowSize();
  // 잡은 점과 판 왼쪽 위의 차이, 지금까지 옮긴 자리(아직 움직이지 않았으면 null)
  const dragRef = useRef<{ dx: number; dy: number; at: FloatPoint | null } | null>(null);
  const isFloating = isSideFloating(view.w, prefs.sideFloat);
  const isFolded = isFloating && prefs.sideFolded;
  const size = { w: SIDE_FLOAT_WIDTH, h: getFloatHeight(view.h, isFolded) };
  // 처음 자리는 펼친 크기로 정한다 - 접어도 머리(접기 단추)가 그 자리에 있다
  const start = getFloatStart(view, { w: SIDE_FLOAT_WIDTH, h: getFloatHeight(view.h, false) });
  const at = clampFloat({ x: prefs.sideX ?? start.x, y: prefs.sideY ?? start.y }, size, view);

  // 끄는 동안은 판의 자리만 바꾸고 놓을 때 알린다(큰 화면을 매 움직임마다 다시 그리지 않게)
  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const panel = event.currentTarget.parentElement;
    if (!panel || event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, at: null };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.drag = "";
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const panel = event.currentTarget.parentElement;
    if (!drag || !panel || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    drag.at = clampFloat({ x: Math.round(event.clientX - drag.dx), y: Math.round(event.clientY - drag.dy) }, size, view);
    panel.style.left = `${drag.at.x}px`;
    panel.style.top = `${drag.at.y}px`;
  }

  // 놓음 · 끊김(pointercancel) 모두 캡처를 잃으며 온다
  function handleDragEnd(event: PointerEvent<HTMLDivElement>) {
    delete event.currentTarget.dataset.drag;
    const moved = dragRef.current?.at ?? null;
    dragRef.current = null;
    if (moved) onChange({ sideX: moved.x, sideY: moved.y });
  }

  const detach =
    !isFloating && view.w < SIDE_FLOAT_MAX_VIEW ? (
      <Tooltip label={t("assign.side.detach")} align="end">
        <button
          type="button"
          className="btn ghost icon h-6 w-6"
          aria-label={t("assign.side.detach")}
          data-testid="assign-side-detach"
          // 접은 채 붙였어도 뗄 때는 펼쳐 보인다 - 누르자마자 내용이 사라지지 않게
          onClick={() => onChange({ sideFloat: true, sideFolded: false })}
        >
          <PictureInPicture2 size={13} strokeWidth={1.6} aria-hidden />
        </button>
      </Tooltip>
    ) : null;

  return (
    <aside
      className="assign-side"
      aria-label={t("assign.side.label")}
      data-float={isFloating ? "" : undefined}
      data-folded={isFolded ? "" : undefined}
      style={isFloating ? { left: at.x, top: at.y, width: size.w, height: size.h } : undefined}
      data-testid="assign-inspector"
    >
      {isFloating && (
        <div className="side-float-head" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onLostPointerCapture={handleDragEnd} data-testid="assign-side-head">
          <span className="side-float-title">{t("assign.side.label")}</span>
          <Tooltip label={t(isFolded ? "assign.side.unfold" : "assign.side.fold")} align="end">
            <button
              type="button"
              className="btn ghost icon h-6 w-6"
              aria-expanded={!isFolded}
              aria-label={t(isFolded ? "assign.side.unfold" : "assign.side.fold")}
              data-testid="assign-side-fold"
              onClick={() => onChange({ sideFolded: !isFolded })}
            >
              {isFolded ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden /> : <ChevronUp size={14} strokeWidth={1.5} aria-hidden />}
            </button>
          </Tooltip>
          <Tooltip label={t("assign.side.attach")} align="end">
            <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.side.attach")} data-testid="assign-side-attach" onClick={() => onChange({ sideFloat: false })}>
              <PanelRight size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        </div>
      )}
      {children(detach)}
    </aside>
  );
}
