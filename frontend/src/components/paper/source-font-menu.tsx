// 원문 글꼴을 한글·영어 따로 고른다(Assign 더보기 메뉴). 앱 글자는 바꾸지 않는다(디자인 문서 7절).
"use client";

import { MenuRadio } from "@/components/ui/menu";
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

/** 원문 글꼴 고르기 - 한글 · 영어 두 열의 라디오. Assign 더보기 메뉴 안에 그린다 */
export function SourceFontLists() {
  const ko = useUiPref("sourceFontKo");
  const en = useUiPref("sourceFontEn");
  return (
    <div className="grid grid-cols-2 gap-x-1" data-testid="paper-font-menu">
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
  );
}
