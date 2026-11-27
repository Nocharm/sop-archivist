// Assign 우클릭 메뉴 - 표 밖 문장은 위 배정(배정 취소·삭제 - 삭제는 구분선으로 떼어 경고색)과 아래 문장 고치기, 표 칸 · 벗긴 표의 줄은 "이 칸" 위 "이 표" 아래(lib/menu-section-model). 항목에 올리면 닿는 칸이 칠해진다(ReachPaint).
// 항목의 가능/불가는 순수 모델(assign-context-menu-model)이 정한다. 꺼진 항목은 숨기지 않고 흐리게, 까닭은 data-tip 툴팁이다.
// 자리는 그 자리 메뉴와 같은 규칙(placeLinkMenu) - 그 줄의 조각들(한/영 짝이면 둘 다) 아래(모자라면 위)에 놓아 다룰 문장을 가리지 않는다.
"use client";

import { ArrowDownFromLine, ArrowDownToLine, ArrowUpToLine, BookMarked, BookX, CaptionsOff, Eraser, Heading, Image as ImageIcon, LayoutList, Link2, MousePointerClick, PanelBottom, PanelTop, Pilcrow, RotateCcw, Scissors, Sparkles, SplitSquareVertical, Table2, Trash2, Unlink, type LucideIcon } from "lucide-react";
import { Fragment, useRef, useState } from "react";

import { Menu } from "@/components/ui/menu";
import { MenuLangRow } from "@/components/ui/menu-lang-row";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { ReachPaint } from "@/components/assign/reach-paint";
import type { AssignMenuAction, AssignMenuItem } from "@/lib/assign-context-menu-model";
import { formatAssignKey } from "@/lib/assign-keymap";
import { useI18n } from "@/lib/i18n";
import { placeLinkMenu } from "@/lib/link-menu-place";
import type { MenuReach } from "@/lib/menu-reach-model";
import type { MenuSection } from "@/lib/menu-section-model";

// 오른쪽 칸의 다듬기 줄(shape-tools)도 같은 아이콘·이름을 쓴다 - 같은 일은 어디서나 같은 모양으로
export const ASSIGN_ACTION_ICONS: Record<Exclude<AssignMenuAction, "lang" | "piece_lang" | "caption_of">, LucideIcon> = {
  // 여러 줄 삭제 창의 단추와 같은 아이콘
  delete: Trash2,
  clear: Eraser,
  split: Scissors,
  split_sentences: SplitSquareVertical,
  merge_prev: ArrowUpToLine,
  merge_next: ArrowDownToLine,
  // 한글·영어 이웃은 합치지 않고 짝으로 맺는다 - 같은 자리에 합치기 대신 나온다
  pair_prev: Link2,
  pair_next: Link2,
  pair_pick: MousePointerClick,
  unpair: Unlink,
  ref_mark: BookMarked,
  ref_clear: BookX,
  table_layout: LayoutList,
  table_rewrap: RotateCcw,
  table_ai_order: Sparkles,
  // 캡션 자리(위·아래)를 그린 아이콘 - 글을 묶음 위(아래) 캡션 줄로
  caption_attach_prev: PanelTop,
  caption_attach_next: PanelBottom,
  caption_detach: CaptionsOff,
  // 제목 ↔ 문장(F8b) - 문단 기호는 보통 문장, H는 제목
  to_sentence: Pilcrow,
  to_heading: Heading,
  start_body: ArrowDownFromLine,
};

export const ASSIGN_ACTION_LABELS: Record<Exclude<AssignMenuAction, "lang" | "piece_lang" | "caption_of">, string> = {
  delete: "assign.ctx.delete",
  clear: "classify.clear",
  split: "split.cutHere",
  split_sentences: "assign.ctx.splitSentences",
  merge_prev: "assign.ctx.mergePrev",
  merge_next: "assign.ctx.mergeNext",
  pair_prev: "assign.ctx.pairPrev",
  pair_next: "assign.ctx.pairNext",
  pair_pick: "assign.ctx.pairPick",
  unpair: "assign.ctx.unpair",
  ref_mark: "assign.ctx.refMark",
  ref_clear: "assign.ref.reject",
  // 표 항목은 쪼개기 화면의 단추와 같은 이름을 쓴다
  table_layout: "split.layoutTable",
  table_rewrap: "assign.ctx.table.rewrap",
  table_ai_order: "assign.ctx.table.aiOrder",
  // 묶음 대상의 이름 - 글 대상이면 항목의 labelKey("위 표의 캡션으로 쓰기")가 대신한다
  caption_attach_prev: "assign.ctx.captionAttachPrev",
  caption_attach_next: "assign.ctx.captionAttachNext",
  caption_detach: "assign.ctx.captionDetach",
  // 제목에서 바꾼 문장이면 항목의 labelKey("제목으로 되돌리기")가 대신한다
  to_sentence: "assign.ctx.toSentence",
  to_heading: "assign.ctx.toHeading",
  start_body: "assign.ctx.startBody",
};

const KEYS: Partial<Record<AssignMenuAction, string>> = {
  delete: formatAssignKey("delete"),
  clear: formatAssignKey("clear"),
  table_layout: formatAssignKey("table"),
  table_rewrap: formatAssignKey("table"),
  table_ai_order: formatAssignKey("ask_order"),
};

interface AssignContextMenuProps {
  /** 누른 문장의 조각 - 닫으면 포커스가 돌아갈 곳 */
  anchor: HTMLElement;
  /** 가리지 않을 조각들(누른 줄의 Unit 전부)을 자리 잡을 때 찾는다 - 비면 anchor. 접힌 삭제 줄을 눌렀으면 그 순간 펼쳐 붙은 박스를 찾아야 해서 렌더 때가 아니라 잴 때 읽는다 */
  readCover: () => HTMLElement[];
  /** 누른 자리(화면 좌표) - 키보드로 열었으면 null(줄 왼쪽 아래) */
  click: { x: number; y: number } | null;
  /** 구역 - 표 칸이면 이 칸 · 이 표, 아니면 배정 · 문장 고치기(lib/menu-section-model) */
  sections: MenuSection[];
  /** 어느 용지에 칠할지, 그리고 항목이 닿는 칸 - 올리거나 포커스한 항목에 칠한다(꺼진 항목도) */
  side: "old" | "new";
  readReach: (item: AssignMenuItem) => MenuReach;
  /** piece - 조각 언어 줄(piece_lang)의 조각 순번, holderId - 캡션으로 쓰기 줄(caption_of)의 표·그림 단위 */
  onPick: (action: AssignMenuAction, lang?: "ko" | "en", piece?: number, holderId?: number) => void;
  onClose: () => void;
}

/** 조각 언어 줄에 보이는 조각 글 앞부분 글자 수 - 메뉴 폭을 넘지 않게 */
const PIECE_HEAD_CHARS = 18;

export function AssignContextMenu({ anchor, readCover, click, sections, side, readReach, onPick, onClose }: AssignContextMenuProps) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLElement>(anchor);
  const tip = useDelegatedTip();
  // 칠은 메뉴가 들고 있다 - 메뉴가 닫히면 함께 사라지고 용지는 다시 그려지지 않는다
  const [reach, setReach] = useState<MenuReach | null>(null);
  const reachHandlers = (item: AssignMenuItem) => ({
    onPointerEnter: () => setReach(readReach(item)),
    onFocus: () => setReach(readReach(item)),
    onPointerLeave: () => setReach(null),
    onBlur: () => setReach(null),
  });

  function place(rect: DOMRect, size: { width: number; height: number }) {
    const boxes = readCover().filter((el) => el.isConnected).map((el) => el.getBoundingClientRect());
    const row = boxes.length === 0 ? rect : { top: Math.min(...boxes.map((box) => box.top)), bottom: Math.max(...boxes.map((box) => box.bottom)), left: Math.min(...boxes.map((box) => box.left)), right: Math.max(...boxes.map((box) => box.right)) };
    return placeLinkMenu(row, click?.x ?? null, size, { width: window.innerWidth, height: window.innerHeight }, click?.y ?? null);
  }

  const firstHolder = sections.flatMap((section) => section.items).find((item) => item.action === "caption_of");
  function isFirstHolder(item: AssignMenuItem): boolean {
    return item === firstHolder;
  }

  function renderItem(item: AssignMenuItem) {
    if (item.action === "lang") {
      return (
        <MenuLangRow
          key="lang"
          label={t("split.menu.lang")}
          current={item.lang}
          disabledReason={item.reasonKey ? t(item.reasonKey) : null}
          currentReason={t("split.menu.why.alreadyLang")}
          optionReasons={item.langReasons ? Object.fromEntries(Object.entries(item.langReasons).map(([lang, key]) => [lang, t(key)])) : undefined}
          onPick={(lang) => onPick("lang", lang)}
          keyHint={formatAssignKey("lang")}
          reachProps={reachHandlers(item)}
          testId="assign-ctx-lang"
        />
      );
    }
    if (item.action === "piece_lang") {
      if (!item.piece) return null;
      const { index, text } = item.piece;
      const row = (
        <MenuLangRow
          key={`piece-${index}`}
          label={text.length > PIECE_HEAD_CHARS ? `${text.slice(0, PIECE_HEAD_CHARS)}…` : text}
          current={item.lang}
          disabledReason={item.reasonKey ? t(item.reasonKey) : null}
          currentReason={t("split.menu.why.alreadyLang")}
          onPick={(lang) => onPick("piece_lang", lang, index)}
          reachProps={reachHandlers(item)}
          testId={`assign-ctx-piece-${index}`}
        />
      );
      // 첫 조각 줄 위에 "조각마다" 머리 - 합친 박스를 조각으로 떼어 짝으로 만드는 줄들이다
      return index === 0 ? [<p key="piece-head" className="menu-label">{t("assign.ctx.pieces")}</p>, row] : row;
    }
    if (item.action === "caption_of") {
      if (!item.holder) return null;
      const { holder } = item;
      const where = holder.distance === 0 ? t("assign.ctx.captionOf.inside")
        : t(`assign.ctx.captionOf.${holder.side}${holder.distance === 1 ? "1" : ""}`, { k: holder.distance });
      const label = t(holder.kind === "figure" ? "assign.ctx.captionOf.figure" : "assign.ctx.captionOf.table", { id: holder.displayId, where });
      const reason = item.reasonKey ? t(item.reasonKey) : null;
      const row = (
        <button
          key={`caption-of-${holder.unitId}`}
          type="button"
          role="menuitem"
          className="menu-item"
          aria-disabled={item.enabled ? undefined : "true"}
          aria-label={reason ? `${label} - ${reason}` : undefined}
          data-tip={reason ?? undefined}
          data-tip-side="right"
          data-testid={`assign-ctx-caption-of-${holder.unitId}`}
          {...reachHandlers(item)}
          onClick={() => {
            if (item.enabled) onPick("caption_of", undefined, undefined, holder.unitId);
          }}
        >
          {holder.kind === "figure" ? <ImageIcon size={14} strokeWidth={1.5} aria-hidden /> : <Table2 size={14} strokeWidth={1.5} aria-hidden />}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
      );
      // 첫 줄 위에 "캡션으로 쓰기" 머리 - 가까운 표·그림이 한 줄씩(B10 8-a)
      return [...(isFirstHolder(item) ? [<p key="caption-of-head" className="menu-label">{t("assign.ctx.captionOfHead")}</p>] : []), row];
    }
    const Icon = ASSIGN_ACTION_ICONS[item.action];
    const label = t(item.labelKey ?? ASSIGN_ACTION_LABELS[item.action]);
    const reason = item.reasonKey ? t(item.reasonKey) : null;
    return (
      <button
        key={item.action}
        type="button"
        role="menuitem"
        className={item.action === "delete" ? "menu-item danger" : "menu-item"}
        aria-disabled={item.enabled ? undefined : "true"}
        aria-label={reason ? `${label} - ${reason}` : undefined}
        data-tip={reason ?? undefined}
        data-tip-side="right"
        data-testid={`assign-ctx-${item.action}`}
        {...reachHandlers(item)}
        onClick={() => {
          if (item.enabled) onPick(item.action);
        }}
      >
        <Icon size={14} strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {KEYS[item.action] && <kbd>{KEYS[item.action]}</kbd>}
      </button>
    );
  }

  return (
    <Menu anchorRef={anchorRef} onClose={onClose} testId="assign-ctx-menu" label={t("assign.ctx.label")} place={place}>
      {/* display: contents - 툴팁 핸들러만 얹고 항목 배치는 Menu 그대로 */}
      <div style={{ display: "contents" }} {...tip.handlers}>
        {sections.map((section, sectionIndex) => (
          <Fragment key={section.id}>
            {sectionIndex > 0 && <div className="menu-sep" role="separator" />}
            <p className="menu-label" data-testid={`assign-ctx-section-${section.id}`}>{t(section.headKey, section.headVars)}</p>
            {/* 되돌리기 어려운 삭제는 구분선으로 떼어 둔다 - 뒤에 항목이 더 있으면 아래에도 */}
            {section.items.flatMap((item, index) =>
              item.action === "delete"
                ? [...(index > 0 ? [<div key="sep-delete" className="menu-sep" role="separator" />] : []), renderItem(item), ...(index < section.items.length - 1 ? [<div key="sep-after-delete" className="menu-sep" role="separator" />] : [])]
                : [renderItem(item)],
            )}
          </Fragment>
        ))}
      </div>
      {tip.node}
      <ReachPaint side={side} reach={reach} />
    </Menu>
  );
}
