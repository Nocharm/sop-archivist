// 용지 막대의 Aa 버튼 - 원문 글꼴을 한글·영어 따로 고른다. 앱 글자는 바꾸지 않는다(디자인 문서 7절).
"use client";

import { Type } from "lucide-react";
import { useRef, useState } from "react";

import { Menu, MenuRadio } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { UI_PREFS } from "@/lib/ui-prefs";
import { setUiPref, useUiPref } from "@/lib/use-ui-pref";

// 글꼴 이름은 그 글꼴의 이름 그대로 보인다(번역하지 않는다)
const KO_LABELS: Record<(typeof UI_PREFS.sourceFontKo.values)[number], string> = {
  pretendard: "Pretendard",
  malgun: "Malgun Gothic",
  batang: "Batang",
};
const EN_LABELS: Record<(typeof UI_PREFS.sourceFontEn.values)[number], string> = {
  arial: "Arial",
  pretendard: "Pretendard",
  times: "Times New Roman",
  calibri: "Calibri",
};

export function SourceFontMenu() {
  const { t } = useI18n();
  const ko = useUiPref("sourceFontKo");
  const en = useUiPref("sourceFontEn");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Tooltip label={t("paper.sourceFont")} align="end">
        <button
          ref={triggerRef}
          type="button"
          className="btn ghost icon h-7 w-7"
          data-testid="paper-font"
          aria-label={t("paper.sourceFont")}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Type size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
      {open && (
        <Menu anchorRef={triggerRef} onClose={() => setOpen(false)} testId="paper-font-menu" align="end">
          <div className="grid grid-cols-2 gap-x-1">
            <div role="group" aria-label="KO">
              <div className="menu-label">KO</div>
              {UI_PREFS.sourceFontKo.values.map((value) => (
                <MenuRadio key={value} checked={ko === value} testId={`paper-font-ko-${value}`} onSelect={() => setUiPref("sourceFontKo", value)}>
                  {KO_LABELS[value]}
                </MenuRadio>
              ))}
            </div>
            <div role="group" aria-label="EN">
              <div className="menu-label">EN</div>
              {UI_PREFS.sourceFontEn.values.map((value) => (
                <MenuRadio key={value} checked={en === value} testId={`paper-font-en-${value}`} onSelect={() => setUiPref("sourceFontEn", value)}>
                  {EN_LABELS[value]}
                </MenuRadio>
              ))}
            </div>
          </div>
        </Menu>
      )}
    </>
  );
}
