// 오른쪽 칸 1번 "다듬기" - 고른 줄의 문장마다 한 줄: 언어 세 칸(KO | EN | REF), 글의 앞부분, 그 문장에 할 수 있는 일(자르기·앞뒤와 묶기·짝 풀기).
// 표·행·그림이면 묶음 도구(행·표 벗기기·캡션 붙이기), 그 묶음의 캡션은 문장처럼 한 줄(언어 세 칸·자르기·캡션 떼기).
// 할 수 있는 일과 못 하는 까닭은 우클릭 메뉴와 같은 답(lib/assign-context-menu-model buildAssignMenu)이고 아이콘·이름도 같다. 그 줄에서 풀 길이 없는 일은 빼고(listShapeLineItems),
// 먼저 할 일이 있어 꺼진 단추는 까닭을 툴팁으로 보인다. 단추는 줄에 마우스를 올리거나 포커스가 갈 때만 드러난다.
// 줄이 한/영 짝이거나 합친 한 문장이면 맨 아래에 둘 사이를 바꾸는 전환(One sentence | KO/EN pair)이 붙는다 - 언어 판정이 틀려 잘못 묶였을 때 고치는 길이다. 짝 줄의 짝 풀기도 그 옆에 한 번.
// 보낼 곳(2번)을 고르기 전에 문장 모양부터 맞추는 자리다. 참조 줄 확인과 AI 나누기 제안은 이 줄 아래의 카드가 맡는다.
// 제목에서 바꾼 문장(F8b) 줄이면 맨 아래에 [제목으로 되돌리기] 단추 하나 - 짝이면 두 조항 줄을 함께 되돌린다(F12).
// 띠 표 제목 줄(F4)이면 맨 아래에 [표로 되돌리기] 단추 하나 - 그 띠 표를 표 한 줄로 되돌린다(한 편집이라 Ctrl+Z로 다시 제목 줄).
"use client";

import { ASSIGN_ACTION_ICONS, ASSIGN_ACTION_LABELS } from "@/components/assign/assign-context-menu";
import { LangToken } from "@/components/paper/lang-token";
import { Truncate } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
import type { ViewUnit } from "@/lib/api-sop";
import { listShapeLineItems, type AssignMenuAction, type AssignMenuItem, type ShapeMode } from "@/lib/assign-context-menu-model";
import { useI18n } from "@/lib/i18n";
import type { ReactNode } from "react";

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
  /** 줄의 지금 모양(합친 한 문장·한/영 짝)과 바꿀 수 없는 까닭 - 둘 다 아닌 줄이면 null */
  mode: ShapeMode | null;
  onMode: (next: ShapeMode["current"]) => void;
  /** 고른 줄이 제목에서 바꾼 문장이면 "제목으로 되돌리기"(onBack) - 아니면 null. reasonKey면 꺼 두고 까닭을 툴팁으로 */
  headingBack?: ShapeBack | null;
  /** 고른 줄이 띠 표 제목 줄이면 "표로 되돌리기"(onBack) - 아니면 null */
  bandBack?: ShapeBack | null;
}

/** 다듬기 맨 아래 되돌리기 단추 하나 - reasonKey면 꺼 두고 까닭을 툴팁으로 */
export interface ShapeBack {
  reasonKey: string | null;
  onBack: () => void;
}

const MODE_LABELS = { one: "split.join.one", pair: "split.join.pair" } as const;
const LANGS = ["ko", "en", "ref"] as const;

export function ShapeTools({ lines, cutUnitId, busy, onAction, mode, onMode, headingBack = null, bandBack = null }: ShapeToolsProps) {
  const { t } = useI18n();
  const isPairRow = mode?.current === "pair";
  // 짝 풀기는 짝 전체를 푼다 - 짝 줄이면 줄마다 두지 않고 모양 전환 옆에 한 번
  const unpairLine = isPairRow ? lines.find((line) => line.items.some((item) => item.action === "unpair")) : undefined;
  const unpairItem = unpairLine?.items.find((item) => item.action === "unpair");

  /** 아이콘 단추 하나 - 꺼진 단추는 aria-disabled로 포커스를 받아 까닭을 툴팁으로 보인다 */
  function renderAction(unit: ViewUnit, item: AssignMenuItem): ReactNode {
    // 언어는 세 칸이 맡아 단추가 없다(listShapeLineItems가 이미 뺀다 - 타입을 좁히려고)
    if (item.action === "lang") return null;
    const Icon = ASSIGN_ACTION_ICONS[item.action];
    const isCutting = item.action === "split" && cutUnitId === unit.id;
    const label = t(item.labelKey ?? ASSIGN_ACTION_LABELS[item.action]);
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
  }

  function renderBack(back: ShapeBack, labelKey: string, testId: string): ReactNode {
    return (
      <div className="shape-mode-row">
        <Tooltip label={back.reasonKey ? t(back.reasonKey) : ""} suppressed={back.reasonKey === null} align="start">
          <button
            type="button"
            className="btn h-7 text-xs"
            aria-disabled={back.reasonKey !== null || busy ? "true" : undefined}
            data-testid={testId}
            onClick={() => back.reasonKey === null && !busy && back.onBack()}
          >
            {t(labelKey)}
          </button>
        </Tooltip>
      </div>
    );
  }

  /**
   * 언어 세 칸 - 눌린 칸이 지금 언어. 한글·영어 문장에서 REF는 참조 줄 표시(번호 입력), 참조 줄에서 KO·EN은 참조를 풀고 그 언어로.
   * 켜고 끄는 까닭은 우클릭 메뉴와 같은 답이다 - 한글·영어 줄은 언어 항목, 참조 줄은 "참조 아님" 항목을 따른다. 언어가 없는 단위(표·그림)는 표시만
   */
  function renderLangs(unit: ViewUnit, items: AssignMenuItem[]) {
    const langItem = items.find((item) => item.action === "lang");
    if (!langItem || unit.lang === "neutral") return <LangToken lang={unit.lang} isRefProposed={unit.ref?.state === "proposed"} />;
    const item = unit.lang === "ref" ? items.find((entry) => entry.action === "ref_clear") : langItem;
    return (
      <span className="shape-langs" role="group" aria-label={t("split.menu.lang")} data-testid={`assign-shape-lang-${unit.id}`}>
        {LANGS.map((lang) => {
          const isCurrent = unit.lang === lang;
          const reasonKey = isCurrent ? undefined : (item?.reasonKey ?? item?.langReasons?.[lang]);
          const reason = reasonKey ? t(reasonKey) : null;
          const isOff = !isCurrent && (!item?.enabled || reason !== null || busy);
          const label = lang === "ref" ? t("assign.ctx.refMark") : t("assign.shape.langTo", { lang: lang.toUpperCase() });
          return (
            <Tooltip key={lang} label={reason ?? (isCurrent ? t("split.menu.why.alreadyLang") : label)} align="start">
              <button
                type="button"
                data-lang={lang}
                aria-pressed={isCurrent}
                // disabled 대신 aria-disabled - 포커스를 받아야 꺼진 까닭이 보인다
                aria-disabled={isOff ? "true" : undefined}
                aria-label={isCurrent ? lang.toUpperCase() : label}
                data-proposed={lang === "ref" && unit.ref?.state === "proposed" ? "" : undefined}
                data-testid={`assign-shape-lang-${unit.id}-${lang}`}
                onClick={() => {
                  if (isCurrent || isOff) return;
                  if (lang === "ref") onAction(unit, "ref_mark");
                  else onAction(unit, "lang", lang);
                }}
              >
                {lang.toUpperCase()}
              </button>
            </Tooltip>
          );
        })}
      </span>
    );
  }

  return (
    <div className="shape-tools" role="group" aria-label={t("assign.step.shape")} data-testid="assign-shape">
      {lines.map(({ unit, items }) => (
        <div key={unit.id} className="shape-line" data-testid={`assign-shape-line-${unit.id}`}>
          {renderLangs(unit, items)}
          <Truncate className="min-w-0 flex-1 text-xs text-ink-2" text={unit.text.slice(unit.number?.content_start ?? 0).trim() || unit.display_id} />
          <span className="shape-acts">
            {listShapeLineItems(unit, items, isPairRow).map((item) => renderAction(unit, item))}
          </span>
        </div>
      ))}
      {mode && (
        <div className="shape-mode-row">
          <div className="shape-mode" role="group" aria-label={t("assign.shape.mode")} data-testid="assign-shape-mode">
            {(["one", "pair"] as const).map((kind) => {
              const isCurrent = mode.current === kind;
              const reason = !isCurrent && mode.reasonKey ? t(mode.reasonKey) : null;
              const isOff = !isCurrent && (reason !== null || busy);
              return (
                <Tooltip key={kind} label={reason ?? ""} suppressed={reason === null} align="start">
                  <button
                    type="button"
                    aria-pressed={isCurrent}
                    // disabled 대신 aria-disabled - 누른 단추가 꺼지면 포커스가 문서로 떨어지고, 꺼진 까닭도 보여야 한다
                    aria-disabled={isOff ? "true" : undefined}
                    data-testid={`assign-shape-mode-${kind}`}
                    onClick={() => !isCurrent && !isOff && onMode(kind)}
                  >
                    {t(MODE_LABELS[kind])}
                  </button>
                </Tooltip>
              );
            })}
          </div>
          {unpairLine && unpairItem && renderAction(unpairLine.unit, unpairItem)}
        </div>
      )}
      {headingBack && renderBack(headingBack, "assign.headingShift.back", "assign-shape-heading-back")}
      {bandBack && renderBack(bandBack, "assign.band.back", "assign-shape-band-back")}
    </div>
  );
}
