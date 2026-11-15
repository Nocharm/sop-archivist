// 오른쪽 칸 1번 "다듬기" - 고른 줄의 문장마다 한 줄: 언어, 글의 앞부분, 그 문장에 할 수 있는 일(자르기·앞뒤와 묶기·짝 풀기). 표·행이면 표 도구.
// 할 수 있는 일과 못 하는 까닭은 우클릭 메뉴와 같은 답(lib/assign-context-menu-model buildAssignMenu)이고 아이콘·이름도 같다 - 꺼진 단추는 까닭을 툴팁으로 보인다.
// 보낼 곳(2번)을 고르기 전에 문장 모양부터 맞추는 자리다. 참조 줄 확인과 AI 나누기 제안은 이 줄 아래의 카드가 맡는다.
"use client";

import { ASSIGN_ACTION_ICONS, ASSIGN_ACTION_LABELS } from "@/components/assign/assign-context-menu";
import { LangToken } from "@/components/paper/lang-token";
import { Truncate } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
import type { ViewUnit } from "@/lib/api-sop";
import type { AssignMenuAction, AssignMenuItem } from "@/lib/assign-context-menu-model";
import { useI18n } from "@/lib/i18n";

export interface ShapeLine {
  unit: ViewUnit;
  /** 그 문장의 고치기 항목(우클릭 메뉴의 edit 묶음) */
  items: AssignMenuItem[];
}

interface ShapeToolsProps {
  lines: ShapeLine[];
  /** 자를 선이 놓인 문장 - 그 문장의 자르기 단추가 "여기서 자르기"가 된다 */
  cutUnitId: number | null;
  busy: boolean;
  onAction: (unit: ViewUnit, action: AssignMenuAction, lang?: "ko" | "en") => void;
}

// 줄에 단추로 두는 일 - 참조 줄 표시는 아래 카드가, 확정·지우기는 3번이 맡는다
const LINE_ACTIONS: ReadonlySet<AssignMenuAction> = new Set(["split", "merge_prev", "pair_prev", "merge_next", "pair_next", "pair_pick", "unpair", "table_rows", "table_layout", "table_merge"]);

export function ShapeTools({ lines, cutUnitId, busy, onAction }: ShapeToolsProps) {
  const { t } = useI18n();

  function renderLang(unit: ViewUnit, item: AssignMenuItem | undefined) {
    // 한글·영어 문장만 서로 바꾼다 - 참조 줄과 언어가 없는 단위는 표시만
    if (!item || (unit.lang !== "ko" && unit.lang !== "en")) return <LangToken lang={unit.lang} isRefProposed={unit.ref?.state === "proposed"} />;
    const other = unit.lang === "ko" ? "en" : "ko";
    const reason = item.reasonKey ? t(item.reasonKey) : null;
    const isOff = !item.enabled || busy;
    return (
      <Tooltip label={reason ?? t("assign.shape.langTo", { lang: other.toUpperCase() })} align="start">
        <button
          type="button"
          className="lang-token shape-lang"
          data-lang={unit.lang}
          // disabled 대신 aria-disabled - 포커스를 받아야 꺼진 까닭이 보인다
          aria-disabled={isOff ? "true" : undefined}
          aria-label={t("assign.shape.langTo", { lang: other.toUpperCase() })}
          data-testid={`assign-shape-lang-${unit.id}`}
          onClick={() => !isOff && onAction(unit, "lang", other)}
        >
          {unit.lang.toUpperCase()}
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="shape-tools" role="group" aria-label={t("assign.step.shape")} data-testid="assign-shape">
      {lines.map(({ unit, items }) => (
        <div key={unit.id} className="shape-line" data-testid={`assign-shape-line-${unit.id}`}>
          {renderLang(unit, items.find((item) => item.action === "lang"))}
          <Truncate className="min-w-0 flex-1 text-xs text-ink-2" text={unit.text.trim() || unit.display_id} />
          <span className="flex flex-none gap-0.5">
            {items
              .filter((item) => LINE_ACTIONS.has(item.action))
              .map((item) => {
                if (item.action === "lang") return null;
                const Icon = ASSIGN_ACTION_ICONS[item.action];
                const isCutting = item.action === "split" && cutUnitId === unit.id;
                const label = t(ASSIGN_ACTION_LABELS[item.action]);
                const reason = item.reasonKey ? t(item.reasonKey) : null;
                const isOff = !item.enabled || busy;
                return (
                  <Tooltip key={item.action} label={reason ?? label} align="end">
                    <button
                      type="button"
                      className="btn ghost icon h-6 w-6"
                      data-on={isCutting ? "" : undefined}
                      aria-disabled={isOff ? "true" : undefined}
                      aria-label={label}
                      data-testid={`assign-shape-${item.action}-${unit.id}`}
                      onClick={() => !isOff && onAction(unit, item.action)}
                    >
                      <Icon size={13} strokeWidth={1.6} aria-hidden />
                    </button>
                  </Tooltip>
                );
              })}
          </span>
        </div>
      ))}
    </div>
  );
}
