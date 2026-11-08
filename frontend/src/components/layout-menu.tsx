// 상단 막대의 배치 버튼 - 전체 틀(왼쪽 레일·상단 탭)과 분류 배치(원문 3단·목록+상세)를 사람마다 고른다. 값은 브라우저에만 둔다(디자인 문서 7절).
"use client";

import { PanelLeft } from "lucide-react";
import { useRef, useState } from "react";

import { Menu, MenuRadio } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { setUiPref, useUiPref } from "@/lib/use-ui-pref";

export function LayoutMenu() {
  const { t } = useI18n();
  const shell = useUiPref("shell");
  const classifyLayout = useUiPref("classifyLayout");
  const theme = useUiPref("theme");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Tooltip label={t("layout.button")} align="end">
        <button
          ref={triggerRef}
          type="button"
          data-testid="top-bar-layout"
          className="btn ghost icon"
          aria-label={t("layout.button")}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <PanelLeft size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
      {open && (
        <Menu anchorRef={triggerRef} onClose={() => setOpen(false)} testId="layout-menu" align="end">
          <div className="grid grid-cols-3 gap-x-1">
            <div role="group" aria-label={t("layout.navigation")}>
              <div className="menu-label">{t("layout.navigation")}</div>
              <MenuRadio checked={shell === "rail"} testId="layout-menu-shell-rail" onSelect={() => setUiPref("shell", "rail")}>
                {t("layout.rail")}
              </MenuRadio>
              <MenuRadio checked={shell === "bar"} testId="layout-menu-shell-bar" onSelect={() => setUiPref("shell", "bar")}>
                {t("layout.bar")}
              </MenuRadio>
            </div>
            <div role="group" aria-label={t("layout.classify")}>
              <div className="menu-label">{t("layout.classify")}</div>
              <MenuRadio
                checked={classifyLayout === "paper"}
                testId="layout-menu-classify-paper"
                onSelect={() => setUiPref("classifyLayout", "paper")}
              >
                {t("layout.paper")}
              </MenuRadio>
              <MenuRadio
                checked={classifyLayout === "list"}
                testId="layout-menu-classify-list"
                onSelect={() => setUiPref("classifyLayout", "list")}
              >
                {t("layout.list")}
              </MenuRadio>
            </div>
            <div role="group" aria-label={t("layout.theme")}>
              <div className="menu-label">{t("layout.theme")}</div>
              <MenuRadio checked={theme === "light"} testId="layout-menu-theme-light" onSelect={() => setUiPref("theme", "light")}>
                {t("layout.light")}
              </MenuRadio>
              <MenuRadio checked={theme === "dark"} testId="layout-menu-theme-dark" onSelect={() => setUiPref("theme", "dark")}>
                {t("layout.dark")}
              </MenuRadio>
            </div>
          </div>
        </Menu>
      )}
    </>
  );
}
