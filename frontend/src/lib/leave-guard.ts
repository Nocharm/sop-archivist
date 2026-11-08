// 이탈 가드 - 저장하지 않은 편집이 있을 때 새로고침·닫기는 브라우저 확인으로, 앱 안 링크 이동은 화면의 확인 창으로 붙잡는다.
// App Router에는 경로 이동을 막는 훅이 없어 링크 클릭을 캡처 단계에서 가로챈다. 브라우저 뒤로 가기는 막지 못한다.
"use client";

import { useEffect, useEffectEvent } from "react";

import { registerLeaveGuard } from "./nav-buffer";

/** 막아야 할 앱 안 이동이면 그 주소(경로+쿼리), 아니면 null - 새 탭·바깥 링크·내려받기·같은 자리는 놓아준다 */
export function findLeaveHref(event: MouseEvent): string | null {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  const link = target instanceof Element ? target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement)) return null;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return null;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const next = `${url.pathname}${url.search}`;
  return next === `${window.location.pathname}${window.location.search}` ? null : next;
}

/** isDirty인 동안 가드를 건다. 링크를 막으면 onLeave(주소)를 부른다 - 화면이 확인 창을 띄우고 확인되면 직접 이동한다 */
export function useLeaveGuard(isDirty: boolean, onLeave: (href: string) => void): void {
  const handleLeave = useEffectEvent((href: string) => onLeave(href));
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    function handleClick(event: MouseEvent) {
      const href = findLeaveHref(event);
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      handleLeave(href);
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, true);
    // 버튼 등에서 부르는 navigate()도 같은 확인 창으로 넘긴다
    const unregister = registerLeaveGuard({ onLeave: (href) => handleLeave(href) });
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
      unregister();
    };
  }, [isDirty]);
}
