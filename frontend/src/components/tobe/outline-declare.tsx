// SOP가 선언하는 항목의 목록(New 줄을 펼친 곳, 칸 상태 표 위) - 템플릿의 5장 범주 · 6장 절차 · 9장 부록을 문서마다 더하고, 이름을 고치고, 순서를 바꾸고, 뺀다.
// 묶음과 줄의 규칙(번호 글 · 뺄 수 있나 · 권장 이름 · 같은 제목)은 lib/outline-declare-model이 정하고 여기는 그리기만 한다. 칸마다 바로 저장한다(WI 단계와 같다).
// 읽기 전용이면 같은 목록을 글자로만 보인다. 이미 쓴 SOP는 묶음이 없어(구조가 파일의 것) 아무것도 그리지 않는다.
"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, type LucideIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { CommitInput } from "@/components/ui/commit-input";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import type { OutlineItemPatch } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { checkOutlineTitle, type DeclareGroup, type DeclareRow } from "@/lib/outline-declare-model";
import { BUTTON_ICON } from "@/lib/ui-classes";

// 펼친 곳의 다른 글 칸(tobe-panel)과 같은 모양
const CELL_INPUT = "h-7 w-full min-w-0 rounded-md border border-line-2 bg-surface px-1.5 text-[13px] text-ink text-ellipsis focus:border-accent focus:outline-none";

/** 제목 길이 상한 - 서버 NewOutlineItemIn.title_en(1–200)과 같다 */
const TITLE_MAX = 200;

interface OutlineDeclareProps {
  /** `tobe-id-<줄 id>` */
  prefix: string;
  groups: readonly DeclareGroup[];
  canEdit: boolean;
  saving: boolean;
  /** 부모 아래에 항목을 더한다 - 거절됐으면 false(적던 제목이 남는다) */
  onAdd: (parentKey: string, titleEn: string) => Promise<boolean>;
  /** 제목 · 자리를 고친다 - 거절됐으면 false(칸이 저장된 값으로 돌아간다) */
  onPatch: (key: string, patch: OutlineItemPatch) => Promise<boolean>;
  onRemove: (key: string) => void;
}

/** 잘린 제목 칸에 올리면 전체 글이 뜬다 - 다 보이는 칸과 적는 중인 칸(포커스)에는 띄우지 않는다. 키보드로는 칸 안에서 글쇠로 끝까지 읽는다 */
function ClipTip({ text, children }: { text: string; children: ReactNode }) {
  const [isClipped, setIsClipped] = useState(false);

  function measure(event: PointerEvent<HTMLSpanElement>) {
    const input = event.currentTarget.querySelector("input");
    setIsClipped(input !== null && input !== document.activeElement && input.scrollWidth > input.clientWidth);
  }

  return (
    <span className="grid min-w-0" onPointerEnter={measure} onFocus={() => setIsClipped(false)}>
      <Tooltip label={text} shrinks suppressed={!isClipped}>
        {children}
      </Tooltip>
    </span>
  );
}

interface RowActionProps {
  icon: LucideIcon;
  label: string;
  testId: string;
  /** 할 수 없는 일(첫 줄의 위로 등) */
  disabled?: boolean;
  /** 저장 중 - 단추를 끄면 키보드 포커스를 잃어 누름만 받지 않는다 */
  busy: boolean;
  danger?: boolean;
  onClick: () => void;
}

function RowAction({ icon: Icon, label, testId, disabled = false, busy, danger = false, onClick }: RowActionProps) {
  return (
    <Tooltip label={label} align="end">
      <button
        type="button"
        className={`${BUTTON_ICON} h-6 w-6 ${danger ? "text-danger" : ""}`}
        aria-label={label}
        aria-disabled={busy || undefined}
        data-testid={testId}
        disabled={disabled}
        onClick={() => {
          if (!busy) onClick();
        }}
      >
        <Icon size={16} strokeWidth={1.5} aria-hidden />
      </button>
    </Tooltip>
  );
}

interface DeclareGroupViewProps extends Omit<OutlineDeclareProps, "groups"> {
  group: DeclareGroup;
}

function DeclareGroupView({ prefix, group, canEdit, saving, onAdd, onPatch, onRemove }: DeclareGroupViewProps) {
  const { t } = useI18n();
  const [adding, setAdding] = useState("");
  // 더하는 중 - saving은 다시 그린 뒤에야 닿아, 같은 작업 안의 두 번째 Enter·누름은 이 값으로 막는다
  const addingRef = useRef(false);
  const { parentKey } = group;
  // 범주 표의 하위 항목은 "범주"라고 부른다 - 그 밖의 묶음은 부모의 이름 그대로(Procedures · Appendices). 번호는 골격이 준 부모의 번호
  const name = group.kind === "category_table" ? t("tobe.outline.categories") : group.title;
  const heading = group.number === "" ? name : `${name} (${group.number})`;
  const addProblem = checkOutlineTitle(group, adding);

  async function add(title: string, isTyped: boolean) {
    if (saving || addingRef.current || checkOutlineTitle(group, title) !== null) return;
    addingRef.current = true;
    try {
      const isAdded = await onAdd(parentKey, title.trim());
      if (isAdded && isTyped) setAdding("");
    } finally {
      addingRef.current = false;
    }
  }

  function handleAddKey(event: KeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중의 Enter는 글자를 끝내는 것이다
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void add(adding, true);
  }

  /** 영어 제목 - 같은 묶음에 이미 있는 제목은 서버에 묻지 않고 거둔다 */
  async function renameEn(row: DeclareRow, next: string): Promise<boolean> {
    if (checkOutlineTitle(group, next, row.key) === "duplicate") {
      showToast(t("tobe.outline.duplicate"), "error");
      return false;
    }
    return onPatch(row.key, { title_en: next });
  }

  function renderRow(row: DeclareRow): ReactNode {
    const id = `${prefix}-outline-${row.key}`;
    const count = row.lineCount === 1 ? t("tobe.outline.lineOne") : t("tobe.outline.lines", { n: row.lineCount });
    return (
      <div key={row.key} className="decl-row hover-row" data-testid={id}>
        <span className="decl-num">{row.number}</span>
        {canEdit && row.canRename ? (
          <>
            <ClipTip text={row.title_en}>
              <CommitInput
                className={CELL_INPUT}
                testId={`${id}-title-en`}
                value={row.title_en}
                maxLength={TITLE_MAX}
                placeholder={t("outline.titleEn")}
                ariaLabel={t("outline.titleEn")}
                // 영어 제목은 비울 수 없다 - 비우고 떠나면 저장된 제목으로 돌아간다
                onEmpty={() => showToast(t("outline.problem.title_required"), "error")}
                onCommit={(next) => renameEn(row, next)}
              />
            </ClipTip>
            <ClipTip text={row.title_ko}>
              <CommitInput className={CELL_INPUT} testId={`${id}-title-ko`} value={row.title_ko} maxLength={TITLE_MAX} placeholder={t("outline.titleKo")} ariaLabel={t("outline.titleKo")} onCommit={(next) => onPatch(row.key, { title_ko: next })} />
            </ClipTip>
          </>
        ) : (
          <>
            <span className="doc-field-text" data-testid={`${id}-title-en`}>
              {row.title_en}
            </span>
            <span className="doc-field-text" lang="ko" data-testid={`${id}-title-ko`}>
              {row.title_ko}
            </span>
          </>
        )}
        <span className="flex items-center justify-end gap-2">
          {row.lineCount > 0 &&
            (canEdit && row.removeBlock === "hasLines" ? (
              // 줄이 든 항목은 빼기 단추가 없다 - 까닭은 수의 툴팁(포커스로도 닿는다)
              <Tooltip label={t("tobe.outline.holdsLines")} align="end">
                <span tabIndex={0} className="doc-step-count slot-sub" data-testid={`${id}-count`}>
                  {count}
                </span>
              </Tooltip>
            ) : (
              <span className="doc-step-count" data-testid={`${id}-count`}>
                {count}
              </span>
            ))}
          {canEdit && (
            // 줄에 올리거나 포커스가 갈 때만 보인다(자리는 늘 잡는다)
            <span className="row-actions inline-flex items-center gap-0.5">
              <RowAction icon={ArrowUp} label={t("outline.moveUp")} testId={`${id}-up`} disabled={!row.canMoveUp} busy={saving} onClick={() => void onPatch(row.key, { position: row.position - 1 })} />
              <RowAction icon={ArrowDown} label={t("outline.moveDown")} testId={`${id}-down`} disabled={!row.canMoveDown} busy={saving} onClick={() => void onPatch(row.key, { position: row.position + 1 })} />
              {row.canRemove ? (
                <RowAction icon={Trash2} label={t("outline.remove")} testId={`${id}-remove`} busy={saving} danger onClick={() => onRemove(row.key)} />
              ) : (
                // 뺄 수 없는 줄 - 위 · 아래 단추가 다른 줄과 같은 자리에 서게 자리만 둔다
                <span className="h-6 w-6" aria-hidden />
              )}
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="decl-group" role="group" aria-label={heading} data-testid={`${prefix}-outline-group-${parentKey}`}>
      <span className="decl-wide slot-title">{heading}</span>
      {group.rows.map(renderRow)}
      {!canEdit && group.rows.length === 0 && <span className="decl-wide text-xs text-ink-3">{t("tobe.outline.none")}</span>}
      {canEdit && (
        <div className="decl-wide flex flex-wrap items-center gap-x-2 gap-y-1">
          <input
            // 칸이 줄 끝까지 늘어나지 않게 - 좁으면 줄 폭을 따른다
            className={`${CELL_INPUT} max-w-[240px] flex-none`}
            data-testid={`${prefix}-outline-add-${parentKey}-input`}
            value={adding}
            maxLength={TITLE_MAX}
            placeholder={t("tobe.outline.addPlaceholder")}
            aria-label={t("tobe.outline.addLabel", { name: heading })}
            onChange={(event) => setAdding(event.target.value)}
            onKeyDown={handleAddKey}
          />
          <button type="button" className="btn ghost h-7" data-testid={`${prefix}-outline-add-${parentKey}`} disabled={saving || addProblem !== null} onClick={() => void add(adding, true)}>
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            {t("tobe.addDoc")}
          </button>
          {addProblem === "duplicate" && (
            <span role="status" className="text-xs text-warn" data-testid={`${prefix}-outline-add-${parentKey}-problem`}>
              {t("tobe.outline.duplicate")}
            </span>
          )}
          {group.suggestions.length > 0 && (
            <span className="slot-used">
              <span className="text-xs text-ink-3">{t("tobe.outline.suggested")}</span>
              {group.suggestions.map((title, index) => (
                <Tooltip key={title} label={title}>
                  <button type="button" className="slot-chip" data-testid={`${prefix}-outline-chip-${parentKey}-${index}`} disabled={saving} onClick={() => void add(title, false)}>
                    {title}
                  </button>
                </Tooltip>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function OutlineDeclare({ prefix, groups, ...rest }: OutlineDeclareProps): ReactNode {
  if (groups.length === 0) return null;
  return (
    <div className="decl-groups" data-testid={`${prefix}-outline`}>
      {groups.map((group) => (
        <DeclareGroupView key={group.parentKey} prefix={prefix} group={group} {...rest} />
      ))}
    </div>
  );
}
