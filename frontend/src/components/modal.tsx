// 모달 한 벌 - 바깥 누름(mousedown)과 Esc로 닫는다. 관리 화면의 폼·확인 창이 공유한다(window.confirm은 브라우저 자동화를 막아 쓰지 않는다).
// 열리면 포커스를 안으로 옮겨 Tab이 밖으로 새지 않게 가두고, 닫히면 연 곳으로 돌려준다. Esc는 맨 위 층만 닫는다(디자인 기초 "Esc는 최상위만").
"use client";

import { X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { isTopEscLayer, popEscLayer, pushEscLayer } from "@/components/ui/floating";
import { useI18n } from "@/lib/i18n";
import { BUTTON_ICON } from "@/lib/ui-classes";
import { Truncate } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";

// Tab이 닿는 요소 - 꺼진 것과 숨긴 네이티브 입력(tabindex=-1)은 뺀다
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function findFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.tabIndex !== -1 && item.getClientRects().length > 0);
}

/** 창 폭 - 내용이 들어가는 가장 좁은 것을 고른다(시선이 좌우로 덜 움직인다) */
export type ModalSize = "sm" | "md" | "lg" | "xl" | "sheet";

// 폭은 여기 한 곳에서만 정한다 - 384·448·512·768px
const PANEL_WIDTH: Record<ModalSize, string> = {
  sm: "max-w-sm", // 확인 창 - 두세 줄 글과 단추 둘
  md: "max-w-md", // 입력 칸·짧은 목록
  lg: "max-w-lg", // 이어 읽는 글(문서 미리 보기)
  xl: "max-w-3xl", // 칸이 여럿 나란한 표(업로드 결과 행)
  sheet: "max-w-[min(1280px,calc(100vw-32px))]", // Excel 미리보기 - 1280px, 좁은 화면이면 화면 폭
};

interface ModalProps {
  title: string;
  onClose: () => void;
  testId: string;
  children: ReactNode;
  /** 하단 버튼 줄 - 비우면 본문만 그린다 */
  footer?: ReactNode;
  /** 요청이 도는 중 - Esc·바깥 누름·닫기 단추로 닫지 않는다(닫히면 요청이 실패해도 알릴 곳이 없다) */
  isBusy?: boolean;
  /** 창 폭 - 기본은 입력 칸 폭(md). 확인 창은 sm */
  size?: ModalSize;
}

export function Modal({ title, onClose, testId, children, footer, isBusy = false, size = "md" }: ModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 최신 onClose를 읽되 리스너를 다시 걸지 않는다
  const handleEscape = useEffectEvent(() => {
    if (!isBusy) onClose();
  });

  useEffect(() => {
    const layer = pushEscLayer();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    // 두 줄로 잘린 제목만 키보드로 닿게 한다(툴팁이 전체 글을 보인다) - 짧은 제목은 Tab 정류장을 늘리지 않는다
    const heading = titleRef.current;
    if (heading && heading.firstElementChild && heading.firstElementChild.scrollHeight > heading.firstElementChild.clientHeight) heading.tabIndex = 0;
    if (panel && !panel.contains(document.activeElement)) {
      // 본문의 첫 입력·단추가 먼저고(닫기 단추는 마지막 후보), 없으면 창 자체
      const body = panel.querySelector<HTMLElement>("[data-modal-body]");
      const first = (body ? findFocusable(body)[0] : undefined) ?? findFocusable(panel).find((item) => !item.hasAttribute("data-modal-close")) ?? panel;
      first.focus({ preventScroll: true });
    }
    function handleKey(event: KeyboardEvent) {
      // 모달 위에 뜬 메뉴·드롭다운이 먼저 닫힌다 - 맨 위 층일 때만 모달이 받는다
      if (event.key === "Escape" && isTopEscLayer(layer)) handleEscape();
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      popEscLayer(layer);
      window.removeEventListener("keydown", handleKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // Tab을 창 안에서 돌린다 - 끝에서 처음으로, 처음에서 끝으로
  function handleTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const items = findFocusable(event.currentTarget);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    // click이 아니라 mousedown 기준 - 모달 안에서 드래그를 시작해 바깥에서 손을 떼도 잘못 닫히지 않는다
    <div
      data-testid={`${testId}-backdrop`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim px-4 py-16"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        ref={panelRef}
        tabIndex={-1}
        className={`w-full ${PANEL_WIDTH[size]} rounded-lg border border-line bg-raised shadow-lg outline-none`}
        onKeyDown={handleTab}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} ref={titleRef} className="modal-title min-w-0 flex-1 text-base leading-[22px] font-semibold text-ink">
            <Truncate text={title} revealOnFocus />
          </h2>
          <Tooltip label={t("common.close")} align="end">
            <button type="button" data-testid={`${testId}-close`} data-modal-close className={BUTTON_ICON} aria-label={t("common.close")} disabled={isBusy} onClick={onClose}>
              <X size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </div>
        <div data-modal-body className="space-y-4 px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
