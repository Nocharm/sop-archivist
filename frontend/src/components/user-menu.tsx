// 사용자 메뉴 - 상단 막대의 이름 단추 하나에 내 계정·관리·레이아웃(하위 메뉴)·로그아웃·마지막 로그인을 모은다.
// 레이아웃 하위 메뉴는 호버나 →로 열리고, 화면 오른쪽에 자리가 없으면 왼쪽으로 뒤집혀 열린다(pickFlyoutSide).
"use client";

import { ChevronDown, ChevronRight, Clock3, LogOut, Moon, PanelLeft, PanelTop, Shield, Sun, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Menu, MenuRadio } from "@/components/ui/menu";
import { canSeeAdmin } from "@/lib/access";
import { formatKstShort } from "@/lib/datetime";
import { getDisplayName } from "@/lib/display-name";
import { pickFlyoutSide } from "@/lib/flyout";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { setUiPref, useUiPref } from "@/lib/use-ui-pref";

// 하위 메뉴 폭(px) - .flyout의 width와 같은 값
const FLYOUT_WIDTH = 220;
// 마우스가 하위 메뉴로 건너가는 동안 닫히지 않게 기다리는 시간
const FLYOUT_CLOSE_MS = 160;

function IconRadio({ icon: Icon, checked, testId, onSelect, children }: { icon: LucideIcon; checked: boolean; testId: string; onSelect: () => void; children: ReactNode }) {
  return (
    <MenuRadio checked={checked} testId={testId} onSelect={onSelect}>
      <Icon size={15} strokeWidth={1.5} className="text-ink-3" aria-hidden />
      {children}
    </MenuRadio>
  );
}

function LayoutFlyout({ side }: { side: "right" | "left" }) {
  const { t } = useI18n();
  const shell = useUiPref("shell");
  const theme = useUiPref("theme");
  return (
    <div className="menu flyout" data-side={side} role="menu" aria-label={t("layout.button")} data-testid="user-menu-layout-flyout">
      <div role="group" aria-label={t("layout.navigation")}>
        <div className="menu-label">{t("layout.navigation")}</div>
        <IconRadio icon={PanelLeft} checked={shell === "rail"} testId="layout-menu-shell-rail" onSelect={() => setUiPref("shell", "rail")}>
          {t("layout.rail")}
        </IconRadio>
        <IconRadio icon={PanelTop} checked={shell === "bar"} testId="layout-menu-shell-bar" onSelect={() => setUiPref("shell", "bar")}>
          {t("layout.bar")}
        </IconRadio>
      </div>
      <div role="group" aria-label={t("layout.theme")}>
        <div className="menu-label">{t("layout.theme")}</div>
        <IconRadio icon={Sun} checked={theme === "light"} testId="layout-menu-theme-light" onSelect={() => setUiPref("theme", "light")}>
          {t("layout.light")}
        </IconRadio>
        <IconRadio icon={Moon} checked={theme === "dark"} testId="layout-menu-theme-dark" onSelect={() => setUiPref("theme", "dark")}>
          {t("layout.dark")}
        </IconRadio>
      </div>
    </div>
  );
}

export function UserMenu() {
  const { t, lang } = useI18n();
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [flyout, setFlyout] = useState<"right" | "left" | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const layoutRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);

  if (!me) return null;

  function cancelClose() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function openFlyout(focusFirst = false) {
    cancelClose();
    const anchor = layoutRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setFlyout(pickFlyoutSide(anchor, FLYOUT_WIDTH, window.innerWidth));
    if (focusFirst) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="user-menu-layout-flyout"] [role="menuitemradio"]')?.focus());
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setFlyout(null), FLYOUT_CLOSE_MS);
  }

  function closeAll() {
    cancelClose();
    setFlyout(null);
    setOpen(false);
  }

  function handleLayoutKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openFlyout(true);
    }
  }

  // 하위 메뉴 안에서 ←는 하위 메뉴만 닫고 레이아웃 항목으로 돌아간다
  function handleFlyoutKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setFlyout(null);
      layoutRef.current?.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="user-btn"
        data-testid="top-bar-user"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closeAll() : setOpen(true))}
      >
        <UserRound size={16} strokeWidth={1.5} aria-hidden />
        <span className="truncate">{getDisplayName(me, lang)}</span>
        {me.department && <span className="tb-dim truncate">{me.department}</span>}
        <ChevronDown size={14} strokeWidth={1.5} className="select-chevron" aria-hidden />
      </button>
      {open && (
        <Menu anchorRef={triggerRef} onClose={closeAll} testId="user-menu" align="end">
          <div className="user-menu-who">
            <b className="block truncate">{getDisplayName(me, lang)}</b>
            <span className="block truncate font-mono text-[11px] text-ink-3">{me.department ? `${me.login_id} · ${me.department}` : me.login_id}</span>
          </div>
          <Link href="/account" role="menuitem" className="menu-item" data-testid="user-menu-account" onClick={closeAll}>
            <UserRound size={15} strokeWidth={1.5} className="text-ink-3" aria-hidden />
            {t("nav.account")}
          </Link>
          {canSeeAdmin(me) && (
            <Link href="/admin" role="menuitem" className="menu-item" data-testid="user-menu-admin" onClick={closeAll}>
              <Shield size={15} strokeWidth={1.5} className="text-ink-3" aria-hidden />
              {t("nav.admin")}
            </Link>
          )}
          <div className="relative" onMouseEnter={() => openFlyout()} onMouseLeave={scheduleClose} onKeyDown={handleFlyoutKeyDown}>
            <button
              ref={layoutRef}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={flyout !== null}
              className="menu-item"
              data-testid="user-menu-layout"
              data-flyout-open={flyout !== null ? "" : undefined}
              onClick={() => (flyout ? setFlyout(null) : openFlyout())}
              onKeyDown={handleLayoutKeyDown}
            >
              <PanelLeft size={15} strokeWidth={1.5} className="text-ink-3" aria-hidden />
              {t("layout.button")}
              <ChevronRight size={14} strokeWidth={1.5} className="ml-auto text-ink-4" aria-hidden />
            </button>
            {flyout && <LayoutFlyout side={flyout} />}
          </div>
          <div className="menu-sep" role="separator" />
          <button type="button" role="menuitem" className="menu-item danger" data-testid="user-menu-signout" onClick={() => { closeAll(); signOut(); }}>
            <LogOut size={15} strokeWidth={1.5} aria-hidden />
            {t("nav.signOut")}
          </button>
          {me.last_login_at && (
            <p className="user-menu-last" data-testid="user-menu-last-login">
              <Clock3 size={12} strokeWidth={1.5} aria-hidden />
              {t("nav.lastLogin", { time: formatKstShort(me.last_login_at) })}
            </p>
          )}
        </Menu>
      )}
    </>
  );
}
