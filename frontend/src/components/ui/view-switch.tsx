// 기본 | 템플릿 보기 전환 - Assign New 칸 머리와 Order 문서 머리가 같이 쓴다. 같은 줄을 다르게 그리기만 하고, 고른 보기는 쓰는 쪽이 이 브라우저에 남긴다.
// 머리가 좁으면 글을 접고 아이콘만(이름은 툴팁) - 모양 규칙은 styles/template.css(.view-switch).
"use client";

import { AlignLeft, LayoutTemplate } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

interface ViewSwitchProps {
  template: boolean;
  onChange: (template: boolean) => void;
  /** 묶음 이름(스크린리더) */
  label: string;
  /** 단추의 테스트 id 앞부분 - `${testId}-basic` · `${testId}-template`, 묶음은 testId 그대로 */
  testId: string;
}

export function ViewSwitch({ template, onChange, label, testId }: ViewSwitchProps) {
  const { t } = useI18n();
  return (
    <div className="view-switch" role="group" aria-label={label} data-testid={testId}>
      <Tooltip label={t("assign.newView.basic")}>
        <button type="button" aria-pressed={!template} aria-label={t("assign.newView.basic")} data-testid={`${testId}-basic`} onClick={() => onChange(false)}>
          <AlignLeft size={13} strokeWidth={1.75} className="view-switch-icon" aria-hidden />
          <span className="view-switch-label">{t("assign.newView.basic")}</span>
        </button>
      </Tooltip>
      <Tooltip label={t("assign.newView.template")}>
        <button type="button" aria-pressed={template} aria-label={t("assign.newView.template")} data-testid={`${testId}-template`} onClick={() => onChange(true)}>
          <LayoutTemplate size={13} strokeWidth={1.75} className="view-switch-icon" aria-hidden />
          <span className="view-switch-label">{t("assign.newView.template")}</span>
        </button>
      </Tooltip>
    </div>
  );
}
