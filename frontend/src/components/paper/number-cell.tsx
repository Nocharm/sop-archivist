// 용지 줄 앞머리의 번호 칸(문단 번호, F5) - 그 줄의 번호를 보이고, 고칠 수 있는 화면(Assign)에서는 누르면 그 자리에 창이 열린다.
// 번호는 늘 여기에 산다: 고치기·번호 없음·써 넣기(+)·타자 번호를 번호로(↤)가 모두 이 칸의 손잡이다. 원문 글자는 그대로이고 번호 범위만 바뀐다.
// 창 맨 위는 종류 단추 줄(시안 2 D1 - 연속 번호 · • ○ ▪ · 직접 · 없음). 종류는 저장하지 않고 값에서 읽는다(number-kind-model).
// 엮은 New 문서(빈 템플릿)의 번호 칸은 같은 단추 줄로 결과물 C 번호 표시를 고른다(ComposedNumberCell, 시안 2 D6).
// 종류 단추 아래 ◀ ▶(B8 항목 7): 연속 번호면 입력한 번호를 한 단계 얕게 · 깊게 바꾸고(저장은 Enter), 그 밖은 줄의 들여쓰기를 바로 저장한다. 가운데 칸은 폭이 고정이라 단추가 움직이지 않는다.
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

import type { NumberStyle, ViewNumber } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { useDismiss } from "@/lib/use-dismiss";
import { getNumberSaveBlock, MAX_NUMBER_CHARS, type NumberPreview } from "@/lib/number-model";
import { readNumberKind, type NumberKind } from "@/lib/number-kind-model";
import { BULLET_SYMBOLS } from "@/lib/section-number";
import type { PairBracket } from "@/lib/strip-pill-model";

import { STRIP_LEAD_EXTRA } from "./strip-lead";

export interface NumberEdit {
  unitId: number;
  /** 눌린 종류 - 연속 번호 · 직접일 때만 입력 상자가 있다 */
  kind: NumberKind;
  text: string;
  /** 뒤 번호도 따라 고치기 - 연속 번호에서만 켤 수 있다 */
  follow: boolean;
}

const NO_INDENT = { canOutdent: false, canIndent: false };

/** 입력 상자로 고치는 종류 - 점 기호 · 없음은 누르면 바로 저장한다 */
function isTextKind(kind: NumberKind): boolean {
  return kind === "continuous" || kind === "custom";
}

interface NumberCellProps {
  width: number;
  bracket?: PairBracket;
  /** 보류 설명 - 비면 툴팁·sr-only 글을 두지 않는다 */
  tip: string;
  testId: string;
  unitId: number;
  number: ViewNumber;
  /** 자동 번호를 못 읽은 줄 - 빈 번호 칸의 "+"를 늘 보인다(다른 번호 없는 줄은 줄에 올렸을 때만) */
  isUnread: boolean;
  /** 고칠 수 있는 화면인가 - 아니면 번호만 보인다 */
  canEdit: boolean;
  busy: boolean;
  /** 이 줄을 고치는 중이면 그 입력 */
  edit: NumberEdit | null;
  /** 고치는 중인 줄을 따라 바뀔 번호들(문서 순서) */
  followed: readonly NumberPreview[];
  /** 고치는 중인 줄의 연속 번호 값(suggestUnitContinuous) - 고치는 줄이 아니거나 셀 수 없으면 null */
  continuous: string | null;
  /** 다른 줄을 고치는 중이고 이 줄의 번호가 따라 바뀐다 */
  preview: NumberPreview | null;
  /** 편집 응답 뒤 번호가 새로 생겼다 - 번호가 글에서 왼쪽으로 빠지며 옅은 강조로 들어오는 전환(lib/use-number-arrival) */
  isArrived?: boolean;
  onEditChange: (edit: NumberEdit | null) => void;
  /** number가 null이면 번호 없음. indentShift를 주면 들여쓰기 차이도 함께(기호를 고를 때 위 기호 줄 단계를 따름) */
  onSave: (number: string | null, follow: boolean, indentShift?: number) => void;
  /** 고치는 중인 줄의 ◀ ▶ 끝(lib/indent-model getIndentBounds) - 연속 번호가 아닌 종류에서 쓴다 */
  indent?: { canOutdent: boolean; canIndent: boolean };
  /** 고치는 중인 줄의 번호를 한 단계 얕게(-1) · 깊게(+1) - 끝이면 null(lib/number-kind-model stepUnitContinuous) */
  stepNumber?: (text: string, delta: -1 | 1) => string | null;
  /** 기호를 고를 때 따를 들여쓰기 차이(lib/indent-model findBulletShift) - 없으면 null */
  bulletShift?: number | null;
  /** 들여쓰기 ◀(-1) ▶(+1) - 바로 저장한다 */
  onIndent?: (delta: -1 | 1) => void;
}

/** 엮은 문서 번호 칸이 고르는 결과물 C 번호 표시 - depth는 글머리 기호의 깊이(• 0 · ○ 1 · ▪ 2), 그 밖은 null(깊이 그대로) */
export interface ComposedStyleChoice {
  style: NumberStyle;
  depth: number | null;
}

interface ComposedNumberCellProps {
  width: number;
  bracket?: PairBracket;
  testId: string;
  targetId: number;
  /** 번호 칸 글 - 번호 · 글머리 기호, 없으면 null */
  mark: string | null;
  style: NumberStyle;
  /** 그 칸이 줄을 세지 않으면 연속 번호를 고를 수 없다 */
  canNumber: boolean;
  /** 고칠 수 있는 화면인가 - 아니면 번호만 보인다 */
  canEdit: boolean;
  busy: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (choice: ComposedStyleChoice) => void;
}

/**
 * 엮은 New 문서(빈 템플릿)의 번호 칸(시안 2 D6) - 번호는 결과물 C 번호 표시라 종류 단추가 C 표시를 고른다: 연속 번호 = numbered, • ○ ▪ = bullet + 깊이 0 · 1 · 2,
 * 없음 = omitted. C에는 직접 번호 꼴이 없어 A-1 직접은 꺼 두고 까닭을 툴팁으로. 누르면 바로 저장하고 닫는다(번호 노트는 없다 - 원문 번호가 없다)
 */
export function ComposedNumberCell({ width, bracket, testId, targetId, mark, style, canNumber, canEdit, busy, open, onOpenChange, onPick }: ComposedNumberCellProps) {
  const { t } = useI18n();
  const cellRef = useRef<HTMLSpanElement>(null);
  useDismiss(cellRef, open, () => onOpenChange(false));
  const numTestId = `${testId}-num-${targetId}`;
  const label = mark === null ? t("assign.composedOrder.styleAdd") : t("assign.composedOrder.style", { n: mark });

  function pick(choice: ComposedStyleChoice) {
    if (busy) return;
    onOpenChange(false);
    onPick(choice);
  }

  return (
    <span ref={cellRef} className="strip-lead" style={{ width: width + STRIP_LEAD_EXTRA }} data-bracket={bracket} data-dim={mark === null ? "" : undefined} data-num-open={open ? "" : undefined} data-testid={`${testId}-lead-${targetId}`}>
      {canEdit ? (
        <button
          type="button"
          className={`strip-lead-num num-cell${mark === null ? " num-add" : ""}`}
          data-quiet={mark === null ? "" : undefined}
          data-tip={label}
          aria-label={label}
          aria-expanded={open}
          data-testid={mark === null ? `${testId}-num-add-${targetId}` : numTestId}
          disabled={busy}
          onClick={() => onOpenChange(!open)}
        >
          {mark ?? "+"}
        </button>
      ) : (
        <span className="strip-lead-num" data-tip={mark === null ? undefined : `§ ${mark}`} data-testid={mark === null ? undefined : numTestId}>
          {mark}
        </span>
      )}
      {open && canEdit && (
        <span className="num-edit" data-testid={`${testId}-num-edit-${targetId}`}>
          <span className="num-kind-row" role="group" aria-label={t("assign.numberKind.group")}>
            <button
              type="button"
              className="num-kind"
              aria-pressed={style === "numbered"}
              aria-disabled={canNumber ? undefined : "true"}
              data-tip={canNumber ? undefined : t("assign.composedOrder.noCount")}
              data-testid={`${testId}-num-kind-continuous`}
              disabled={busy}
              onClick={() => {
                if (canNumber) pick({ style: "numbered", depth: null });
              }}
            >
              {t("assign.numberKind.continuous")}
            </button>
            {BULLET_SYMBOLS.map((symbol, index) => {
              const bulletLabel = t("assign.numberKind.bullet", { symbol });
              return (
                <button key={symbol} type="button" className="num-kind num-kind-bullet" aria-pressed={style === "bullet" && mark === symbol} aria-label={bulletLabel} data-tip={bulletLabel} data-testid={`${testId}-num-kind-bullet-${index}`} disabled={busy} onClick={() => pick({ style: "bullet", depth: index })}>
                  {symbol}
                </button>
              );
            })}
            {/* aria-disabled - 포커스와 포인터를 받아야 까닭(툴팁)을 보일 수 있다 */}
            <button type="button" className="num-kind" aria-pressed={false} aria-disabled="true" data-tip={t("assign.composedOrder.custom")} data-testid={`${testId}-num-kind-custom`}>
              {t("assign.numberKind.custom")}
            </button>
            <button type="button" className="num-kind" aria-pressed={style === "omitted"} data-testid={`${testId}-num-kind-none`} disabled={busy} onClick={() => pick({ style: "omitted", depth: null })}>
              {t("assign.numberKind.none")}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

export function NumberCell({
  width,
  bracket,
  tip,
  testId,
  unitId,
  number,
  isUnread,
  canEdit,
  busy,
  edit,
  followed,
  continuous,
  preview,
  isArrived = false,
  onEditChange,
  onSave,
  indent = NO_INDENT,
  stepNumber,
  bulletShift = null,
  onIndent,
}: NumberCellProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLSpanElement>(null);
  const isEditing = edit !== null;
  const editKind = edit?.kind ?? null;
  // 고치는 칸은 바깥을 누르거나 Esc(입력 밖에 포커스가 있어도)로 닫는다 - 저장하지 않고 닫는다
  useDismiss(cellRef, isEditing, () => onEditChange(null));
  // 창이 열리거나 종류가 바뀌면 입력 상자로(없는 종류면 눌린 종류 단추로) 포커스 - Esc · 글쇠가 창 안에서 시작한다
  useEffect(() => {
    if (editKind === null) return;
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      return;
    }
    cellRef.current?.querySelector<HTMLButtonElement>('.num-kind[aria-pressed="true"]')?.focus();
  }, [editKind]);

  const tipAttr = tip === "" ? undefined : tip;
  const shown = preview ? preview.to : number.value;
  const base = { width: width + STRIP_LEAD_EXTRA };
  const numTestId = `${testId}-num-${unitId}`;
  // 원문과 다르게 고친 번호 - 툴팁에 원문 번호를 함께 적는다(따라 바뀔 미리 보기 중에는 미리 보기 설명만). 글 앞 번호를 저절로 읽었으면 그것을 알린다
  const sourceTip = preview ? null : number.note !== null ? t("assign.numberKind.source", { n: number.note }) : number.from_text ? t("assign.number.fromText") : null;

  function open() {
    const kind = readNumberKind(number.value);
    onEditChange({ unitId, kind, text: isTextKind(kind) ? (number.value ?? "") : "", follow: kind === "continuous" });
  }

  function save() {
    if (!edit || busy) return;
    if (getNumberSaveBlock(edit) !== null) return;
    const text = edit.text.trim();
    onSave(text, edit.kind === "continuous" && edit.follow);
  }

  /** 종류 단추 - 연속 번호는 앱이 센 값을 채우고, 직접은 지금 글(없으면 빈 상자), 점 기호 · 없음은 바로 저장한다 */
  function pickKind(kind: NumberKind, symbol?: string) {
    if (!edit || busy) return;
    if (kind === "continuous" || kind === "custom") {
      const kept = isTextKind(edit.kind) ? edit.text : isTextKind(readNumberKind(number.value)) ? (number.value ?? "") : "";
      onEditChange({ ...edit, kind, text: kind === "continuous" ? (continuous ?? kept) : kept, follow: kind === "continuous" });
      // 이미 입력 상자가 있으면(종류가 그대로이거나 연속 ↔ 직접) 포커스를 돌려준다 - 새로 생기는 상자는 위 effect가 맡는다
      inputRef.current?.focus();
    } else if (kind === "bullet" && symbol !== undefined) {
      onSave(symbol, false, bulletShift ?? undefined);
    } else if (kind === "none") {
      onSave(null, false);
    }
  }

  function renderKinds(current: NumberEdit) {
    const isPressed = (kind: NumberKind, symbol?: string) => current.kind === kind && (symbol === undefined || number.value === symbol);
    return (
      <span className="num-kind-row" role="group" aria-label={t("assign.numberKind.group")}>
        <button type="button" className="num-kind" aria-pressed={isPressed("continuous")} data-testid={`${testId}-num-kind-continuous`} disabled={busy} onClick={() => pickKind("continuous")}>
          {t("assign.numberKind.continuous")}
        </button>
        {BULLET_SYMBOLS.map((symbol, index) => {
          const label = t("assign.numberKind.bullet", { symbol });
          return (
            <button key={symbol} type="button" className="num-kind num-kind-bullet" aria-pressed={isPressed("bullet", symbol)} aria-label={label} data-tip={label} data-testid={`${testId}-num-kind-bullet-${index}`} disabled={busy} onClick={() => pickKind("bullet", symbol)}>
              {symbol}
            </button>
          );
        })}
        <button type="button" className="num-kind" aria-pressed={isPressed("custom")} data-testid={`${testId}-num-kind-custom`} disabled={busy} onClick={() => pickKind("custom")}>
          {t("assign.numberKind.custom")}
        </button>
        {/* 번호가 없는 줄의 "없음"은 할 일이 없다 - 눌린 채 꺼 둔다 */}
        <button type="button" className="num-kind" aria-pressed={isPressed("none")} data-tip={t("assign.number.none")} data-testid={`${testId}-num-kind-none`} disabled={busy || number.value === null} onClick={() => pickKind("none")}>
          {t("assign.numberKind.none")}
        </button>
      </span>
    );
  }

  /** ◀ ▶ 한 줄 - 연속 번호는 입력한 번호의 단계를 바꾸고(입력 상자로 포커스를 돌려 Enter가 저장하게), 그 밖은 들여쓰기를 바로 저장한다 */
  function renderStepRow(current: NumberEdit) {
    const isNumberStep = current.kind === "continuous";
    const targets = isNumberStep ? ([-1, 1] as const).map((delta) => stepNumber?.(current.text, delta) ?? null) : [null, null];
    const steps = ([-1, 1] as const).map((delta, index) => {
      const target = targets[index];
      const enabled = isNumberStep ? target !== null : delta < 0 ? indent.canOutdent : indent.canIndent;
      const label = target !== null ? t(delta < 0 ? "assign.number.outdentTo" : "assign.number.indentTo", { n: target }) : t(delta < 0 ? "assign.number.outdent" : "assign.number.indent");
      const Icon = delta < 0 ? ChevronLeft : ChevronRight;
      return (
        <button
          key={delta}
          type="button"
          className="num-step"
          aria-label={label}
          data-tip={label}
          data-testid={`${testId}-num-${delta < 0 ? "outdent" : "indent"}`}
          disabled={busy || !enabled}
          onClick={() => {
            if (target !== null) {
              onEditChange({ ...current, text: target });
              inputRef.current?.focus();
            } else if (!isNumberStep) onIndent?.(delta);
          }}
        >
          <Icon size={14} strokeWidth={1.8} aria-hidden />
        </button>
      );
    });
    return (
      <span className="num-edit-row">
        {steps[0]}
        {isTextKind(current.kind) ? (
          <input
            ref={inputRef}
            className="num-edit-input"
            value={current.text}
            maxLength={MAX_NUMBER_CHARS}
            aria-label={t("assign.number.input")}
            data-testid={`${testId}-num-input`}
            onChange={(event) => onEditChange({ ...current, text: event.target.value })}
            onKeyDown={handleKey}
          />
        ) : (
          <span className="num-edit-slot" aria-hidden />
        )}
        {steps[1]}
        {isNumberStep && continuous !== null && (
          <span className="num-continuous" data-testid={`${testId}-num-continuous`}>
            {t("assign.numberKind.continuousValue", { n: continuous })}
          </span>
        )}
      </span>
    );
  }

  /** 취소 · 확인 - 확인은 Enter와 같은 save(). 빈 글이면 꺼 두고(aria-disabled라 툴팁은 뜬다) 까닭을 글로 보인다. 바깥 누르기는 지금대로 저장 없이 닫힘 */
  function renderActions(current: NumberEdit) {
    const block = getNumberSaveBlock(current);
    const reason = block === null ? undefined : t(block);
    return (
      <span className="num-actions">
        {reason && (
          <span className="num-note" data-testid={`${testId}-number-cell-reason`}>
            {reason}
          </span>
        )}
        <button type="button" className="btn ghost num-action" data-testid={`${testId}-number-cell-cancel`} onClick={() => onEditChange(null)}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn pri num-action" aria-disabled={block !== null ? "true" : undefined} data-tip={reason} data-testid={`${testId}-number-cell-ok`} disabled={busy} onClick={save}>
          {t("assign.number.ok")}
        </button>
      </span>
    );
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    // 용지·화면의 단축키(J/K, Ctrl+Z)가 입력 글자를 가로채지 않게 한다
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onEditChange(null);
    }
  }

  function renderBody() {
    if (!canEdit) {
      return (
        <span className="strip-lead-num" data-arrived={isArrived ? "" : undefined} data-tip={[shown ? `§ ${shown}` : null, sourceTip, tipAttr].filter(Boolean).join(" · ") || undefined} data-testid={shown !== null ? numTestId : undefined}>
          {shown}
        </span>
      );
    }
    if (shown !== null) {
      const label = [preview ? t("assign.number.willChange", { from: preview.from, to: preview.to }) : t("assign.number.edit", { n: shown }), sourceTip].filter(Boolean).join(" · ");
      return (
        <button type="button" className="strip-lead-num num-cell" data-preview={preview ? "" : undefined} data-fixed={number.is_set ? "" : undefined} data-arrived={isArrived ? "" : undefined} data-tip={label} aria-label={label} data-testid={numTestId} disabled={busy} onClick={open}>
          {shown}
        </button>
      );
    }
    return (
      <button type="button" className="strip-lead-num num-cell num-add" data-quiet={isUnread ? undefined : ""} data-tip={t("assign.number.add")} aria-label={t("assign.number.add")} data-testid={`${testId}-num-add-${unitId}`} disabled={busy} onClick={open}>
        +
      </button>
    );
  }

  return (
    <span ref={cellRef} className="strip-lead" style={base} data-bracket={bracket} data-dim={shown === null ? "" : undefined} data-num-open={isEditing ? "" : undefined} data-testid={`${testId}-lead-${unitId}`}>
      {tipAttr && <span className="sr-only">{tipAttr}</span>}
      {renderBody()}
      {edit && (
        <span className="num-edit" data-testid={`${testId}-num-edit-${unitId}`}>
          {renderKinds(edit)}
          {renderStepRow(edit)}
          {edit.kind === "continuous" && (
            <label className="num-follow">
              <input type="checkbox" checked={edit.follow} data-testid={`${testId}-num-follow`} onChange={(event) => onEditChange({ ...edit, follow: event.target.checked })} />
              <span>{t("assign.number.follow")}</span>
            </label>
          )}
          {edit.kind === "continuous" && edit.follow && followed.length > 0 && (
            <span className="num-follow-preview" data-testid={`${testId}-num-preview`}>
              {followed.slice(0, 3).map((item) => (
                <span key={item.unitId} className="num-follow-item">
                  {item.from} → {item.to}
                </span>
              ))}
              {followed.length > 3 && <span className="num-follow-more">{t("assign.number.more", { n: followed.length - 3 })}</span>}
            </span>
          )}
          {isTextKind(edit.kind) && renderActions(edit)}
          {number.note !== null && (
            <span className="num-note" data-testid={`${testId}-num-note`}>
              {t("assign.numberKind.note", { n: number.note })}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
