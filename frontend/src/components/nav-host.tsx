// 이동·스크롤 배선 - 앱 안 링크 클릭을 버퍼 이동(lib/nav-buffer)으로 돌리고, 스크롤하는 동안(과 끝 가까이에 마우스가 올 때 흐리게) 스크롤바를 보이게 하고,
// 상단 막대 아래 진행 막대와 위로 가기 단추를 그린다. AppShell이 로그인한 화면에 한 번 둔다.
"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { findLeaveHref } from "@/lib/leave-guard";
import { bindNavRouter, cancelNav, completeNav, hasLeaveGuard, navigate, useNavState } from "@/lib/nav-buffer";

// 스크롤이 멈춘 뒤 스크롤바를 거두기까지(ms)
const SCROLLBAR_LINGER_MS = 900;
// 스크롤 상자 오른쪽 끝에서 이 거리(px) 안에 마우스가 있으면 막대가 흐리게 보인다 - 넓히면 본문 글 위에서도 자주 뜬다
const SCROLLBAR_NEAR_PX = 40;

function installScrollbarReveal(): () => void {
  const timers = new WeakMap<Element, number>();
  function handleScroll(event: Event) {
    const target = event.target;
    const element = target instanceof Element ? target : target === document ? document.scrollingElement : null;
    if (!element) return;
    element.classList.add("is-scrolling");
    const previous = timers.get(element);
    if (previous !== undefined) window.clearTimeout(previous);
    timers.set(element, window.setTimeout(() => element.classList.remove("is-scrolling"), SCROLLBAR_LINGER_MS));
  }
  // 마우스가 스크롤 상자 오른쪽 끝 가까이 오면 막대를 흐리게 보인다 - 스크롤하기 전에 어디서 잡을지 보이게
  let hoveredTarget: Element | null = null;
  let scrollBoxes: Element[] = [];
  let near: Element | null = null;
  function setNear(box: Element | null) {
    if (box === near) return;
    near?.classList.remove("is-scroll-near");
    box?.classList.add("is-scroll-near");
    near = box;
  }
  function handlePointerMove(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    const target = event.target instanceof Element ? event.target : null;
    // 조상의 스크롤 상자는 가리킨 요소가 바뀔 때만 다시 찾는다(computed style 읽기를 줄이려고)
    if (target !== hoveredTarget) {
      hoveredTarget = target;
      scrollBoxes = listScrollBoxes(target);
    }
    setNear(scrollBoxes.find((box) => {
      const { right } = box.getBoundingClientRect();
      return event.clientX <= right && event.clientX >= right - SCROLLBAR_NEAR_PX && box.scrollHeight > box.clientHeight + 1;
    }) ?? null);
  }
  function handlePointerOut(event: PointerEvent) {
    // 창 밖으로 나가면 거둔다
    if (event.relatedTarget === null) setNear(null);
  }
  document.addEventListener("scroll", handleScroll, { capture: true, passive: true });
  document.addEventListener("pointermove", handlePointerMove, { passive: true });
  document.addEventListener("pointerout", handlePointerOut);
  return () => {
    document.removeEventListener("scroll", handleScroll, { capture: true });
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerout", handlePointerOut);
    setNear(null);
  };
}

/** 안에서 바깥 차례로, 세로로 스크롤하는 조상 상자 */
function listScrollBoxes(start: Element | null): Element[] {
  const boxes: Element[] = [];
  for (let element = start; element && element !== document.documentElement; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element);
    if (overflowY === "auto" || overflowY === "scroll") boxes.push(element);
  }
  return boxes;
}

/** 경로+쿼리가 바뀌면 이동이 끝난 것이다 - useSearchParams 때문에 Suspense 안에 둔다 */
function RouteWatcher() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    completeNav();
  }, [pathname, search]);
  return null;
}

export function NavHost() {
  const router = useRouter();
  const nav = useNavState();

  useEffect(() => bindNavRouter((href) => router.push(href), (href) => router.prefetch(href)), [router]);

  useEffect(() => installScrollbarReveal(), []);

  // 창 캡처 단계 - next/link보다 먼저 받아 버퍼 이동으로 돌린다. 저장 안 한 변경이 있으면 가드(useLeaveGuard)가 받게 둔다
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || hasLeaveGuard()) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-nav='native']")) return;
      const href = findLeaveHref(event);
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      navigate(href);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") cancelNav();
    }
    window.addEventListener("click", handleClick, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  // 버퍼 중인 목적지를 가리키는 링크에 표시 - 다시 누르면 취소된다는 것을 보인다
  useEffect(() => {
    if (nav.phase !== "buffer" || nav.href === null) return;
    const marked: Element[] = [];
    for (const link of document.querySelectorAll("a[href]")) {
      if (!(link instanceof HTMLAnchorElement)) continue;
      const url = new URL(link.href, window.location.href);
      if (`${url.pathname}${url.search}` === nav.href) {
        link.setAttribute("data-nav-pending", "");
        marked.push(link);
      }
    }
    return () => {
      for (const link of marked) link.removeAttribute("data-nav-pending");
    };
  }, [nav.phase, nav.href]);

  return (
    <Suspense fallback={null}>
      <RouteWatcher />
    </Suspense>
  );
}

/** 상단 막대 아래 2px 진행 막대 - 버퍼 동안 70%까지, 이동을 보내면 90%까지, 도착하면 채우고 사라진다 */
export function NavProgress() {
  const { t } = useI18n();
  const nav = useNavState();
  return (
    <span className="nav-progress" data-phase={nav.phase} data-testid="nav-progress" role="status" aria-live="polite">
      <span className="sr-only">{nav.phase === "buffer" ? t("nav.pendingHint") : ""}</span>
    </span>
  );
}

/** 위로 가기 - 묶음 안·관리·내 정보에서 묶음 목록으로. 버퍼 이동을 그대로 탄다 */
export function BackLink() {
  const { t } = useI18n();
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/login") return null;
  return (
    <Tooltip label={t("nav.backToBundles")}>
      <Link href="/" className="btn ghost icon" data-testid="top-bar-back" aria-label={t("nav.backToBundles")}>
        <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
      </Link>
    </Tooltip>
  );
}
