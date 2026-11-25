// New 목록의 줄 하나(Documents 화면 설계 §6) - 식별(종류 · 번호 · EQUIS), 제목 줄, 딸린 정보 줄을 글자로 읽는다. 고치는 칸은 펼친 곳(ToBePanel)에 있다.
"use client";

import { GitFork, Link2, Pencil, Trash2, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";

import { DocRow, type RowAction } from "@/components/documents/doc-row";
import { FileName } from "@/components/documents/file-name";
import { EquisStatus } from "@/components/equis/equis-status";
import { TitleLock } from "@/components/equis/title-lock";
import { SlotBar } from "@/components/tobe/slot-bar";
import { ClampText } from "@/components/ui/clamp-text";
import { Tooltip } from "@/components/ui/tooltip";
import type { EquisInfo, SopDocument, TargetDoc, ToBe } from "@/lib/api-sop";
import { isBoxDragActive } from "@/lib/box-drag";
import { getDocRemoveBlock } from "@/lib/destination-manage-model";
import { useI18n } from "@/lib/i18n";
import { countDeviations, formatSlotName, type SlotRow, type SlotSummary } from "@/lib/slot-status-model";
import type { DraftDoc } from "@/lib/tobe-draft";

const REMOVE_BLOCK_KEYS = {
  written: "tobe.matchLocked",
  hasSentences: "assign.tree.why.hasSentences",
  hasChildren: "assign.tree.why.hasChildren",
} as const;

interface ToBeRowProps {
  doc: DraftDoc;
  /** SOP 아래 들인 WI */
  isChild: boolean;
  tobe: ToBe;
  /** 저장된 줄 - 빼기를 막는 까닭을 이것으로 읽는다 */
  saved: TargetDoc | undefined;
  /** 이 줄에 붙은 쓴 파일 */
  written: SopDocument | null;
  equis: EquisInfo | null;
  stepCount: number;
  /** SOP 줄의 칸(그 문서 골격의 항목)과 그 요약(목록이 줄마다 한 번 센다) - WI는 null */
  slots: { rows: readonly SlotRow[]; summary: SlotSummary } | null;
  /** EQUIS가 아는 값의 제안 수 - 고칠 수 있을 때만 센다 */
  hintCount: number;
  /** 쓴 파일이 없는 줄의 "아직 안 씀" 꼬리표를 두는가 */
  showNotWritten: boolean;
  /** 직접 부모도 참조로 찾은 상위도 없는 WI - 받는 자료지만 7.2 · 결과물 C 머리에 상위가 없다 */
  noParent: boolean;
  /** 참조로 찾은 상위 SOP 번호(번호 순) - 이 줄이 그 아래 놓였으면 점선 나무 선과 "참조로 연결" 칩. 아니면 빈 목록 */
  refParents: readonly string[];
  canEdit: boolean;
  /** 끌어 상위 SOP를 바꿀 수 있는 WI 줄 - 줄 상자 전체가 끌 상자가 된다(canDragParent) */
  draggable: boolean;
  open: boolean;
  onToggle: () => void;
  /** 접어도 남은, 저장하지 않은 편집기 글이 이 줄에 있다 - na는 N/A 사유, outline은 골격 쓰기(이름 · 빼기 · 더하기). 없으면 null */
  unsavedEdit: "na" | "outline" | null;
  onRemove: () => void;
  onEquisRefresh: () => void;
  panel: () => ReactNode;
}

export function ToBeRow({ doc, isChild, tobe, saved, written, equis, stepCount, slots, hintCount, showNotWritten, noParent, refParents, canEdit, draggable, open, onToggle, unsavedEdit, onRemove, onEquisRefresh, panel }: ToBeRowProps) {
  const { t } = useI18n();
  const prefix = `tobe-${doc.key}`;
  const block = saved ? getDocRemoveBlock(tobe, saved) : null;
  // 첫 N/A 칸 이름이 말줄임으로 줄었는지 - 툴팁은 150ms 뒤에 뜨므로 올리거나 포커스할 때 재면 된다(ClampText와 같다)
  const [isNaNameCut, setIsNaNameCut] = useState(false);
  function checkNaNameCut(element: HTMLElement) {
    setIsNaNameCut(element.scrollWidth > element.clientWidth);
  }

  /** Edit는 펼친다(접지 않는다) - 펼친 곳의 첫 고칠 칸으로 포커스를 옮긴다. 막 펼친 곳은 처음 몇 프레임 보이지 않아(visibility) 포커스를 받을 때까지 다시 시도한다 */
  function openToEdit() {
    if (!open) onToggle();
    let tries = 0;
    const focusField = () => {
      const field = document.querySelector<HTMLElement>(`[data-testid="${prefix}-panel"] :is(input, button, [tabindex="0"]):not(:disabled)`);
      field?.focus();
      if ((field === null || document.activeElement !== field) && tries < 30) {
        tries += 1;
        requestAnimationFrame(focusField);
      }
    };
    requestAnimationFrame(focusField);
  }
  const isWritten = doc.entrance === "match";
  // 줄에 이름을 적는 N/A 칸 - 덮인 칸도 N/A로 센다(요약의 na와 같은 집합)
  const firstNa = slots?.rows.find((row) => row.state.kind === "na" || row.state.kind === "covered");
  // 표준과 다른 항목 수 - 뺀 필수 항목도 센다(펼친 곳의 칸 표가 줄마다 표시와 사유를 보인다)
  const deviations = slots === null ? 0 : countDeviations(slots.rows);
  const actions: RowAction[] = canEdit
    ? [
        { key: "edit", icon: Pencil, label: t("common.edit"), testId: `${prefix}-edit`, run: openToEdit },
        { key: "remove", icon: Trash2, danger: true, label: t("tobe.removeDoc"), testId: `${prefix}-remove`, blocked: block === null ? undefined : t(REMOVE_BLOCK_KEYS[block]), run: onRemove },
      ]
    : [];
  const code = doc.code.trim();
  return (
    <DocRow
      prefix={prefix}
      kind={doc.doc_type}
      isChild={isChild}
      open={open}
      onToggle={onToggle}
      toggleLabel={t("tobe.details")}
      identity={
        <>
          <span className="doc-kind" data-testid={`${prefix}-kind`}>
            {doc.doc_type === "sop" ? "SOP" : "WI"}
          </span>
          <ClampText text={code || t("tobe.noCode")} className="doc-code" testId={`${prefix}-code-text`}>
            {code || t("tobe.noCode")}
          </ClampText>
          {equis && <EquisStatus equis={equis} testId={`${prefix}-equis`} compact canEdit={canEdit} onRefresh={onEquisRefresh} />}
        </>
      }
      title={
        <>
          {doc.title.trim() === "" ? (
            <span className="doc-title-empty" data-testid={`${prefix}-title-text`}>
              {t("tobe.row.noTitle")}
            </span>
          ) : (
            <ClampText text={doc.title} testId={`${prefix}-title-text`} />
          )}
          {equis?.title_locked === true && <TitleLock testId={`${prefix}-title-lock`} />}
        </>
      }
      meta={
        <>
          {/* 이미 쓴 SOP는 칸이 파일의 절을 따라 문장 수를 세지 않는다 - 막대와 "n of m" 없이 N/A만. 전체(m)는 문장을 받는 칸의 수다 */}
          {slots !== null && !isWritten && (
            <>
              <SlotBar rows={slots.rows} testId={`${prefix}-bar`} />
              <span data-testid={`${prefix}-filled`}>{t("tobe.row.filled", { filled: slots.summary.filled, total: slots.summary.total })}</span>
            </>
          )}
          {slots !== null && firstNa !== undefined && (
            <span className="meta-na" data-testid={`${prefix}-na-summary`}>
              <span className="pill quiet">{t("tobe.row.na", { n: slots.summary.na })}</span>
              {/* 자리가 모자라면 칸 이름이 말줄임으로 줄고 "+k"는 남는다 */}
              <span className="meta-na-name">
                {/* 말줄임으로 줄었을 때만 전체 이름을 툴팁으로(포커스로도 닿는다) */}
                <Tooltip label={formatSlotName(firstNa)} suppressed={!isNaNameCut} align="start" shrinks>
                  <span
                    className="meta-na-label"
                    tabIndex={0}
                    data-testid={`${prefix}-na-name`}
                    // 끄는 동안 지나가는 줄에서는 재지 않는다(끌어다 놓기 G11 - 포인터가 움직일 때마다 다시 그리지 않는다)
                    onPointerEnter={(event) => {
                      if (!isBoxDragActive()) checkNaNameCut(event.currentTarget);
                    }}
                    onFocus={(event) => checkNaNameCut(event.currentTarget)}
                  >
                    {formatSlotName(firstNa)}
                  </span>
                </Tooltip>
                {slots.summary.na > 1 && <span className="flex-none">{` +${slots.summary.na - 1}`}</span>}
              </span>
            </span>
          )}
          {deviations > 0 && (
            <span className="pill quiet" data-testid={`${prefix}-deviations`}>
              <GitFork size={12} strokeWidth={1.5} className="text-warn" aria-hidden />
              {t("tobe.row.deviations", { n: deviations })}
            </span>
          )}
          {written ? (
            <span className="doc-meta-file">
              <FileName name={written.file_name} testId={`${prefix}-written`} />
              {written.doc_version !== "" && <span className="doc-meta-ver">v{written.doc_version}</span>}
            </span>
          ) : (
            showNotWritten && <span data-testid={`${prefix}-not-written`}>{t("tobe.notWritten")}</span>
          )}
          {doc.doc_type === "sop" && doc.is_equipment_sop && (
            // 좁아지면 글자가 숨고 아이콘만 남는다 - 그때도 무엇인지 알 수 있게 툴팁과 이름을 늘 단다
            <span className="doc-meta-tag" role="img" aria-label={t("tobe.colEquipment")} data-tip={t("tobe.colEquipment")} data-testid={`${prefix}-equipment-tag`}>
              <Wrench size={12} strokeWidth={1.5} aria-hidden />
              <span className="meta-eq-text">{t("tobe.colEquipment")}</span>
            </span>
          )}
          {doc.doc_type === "wi" && <span data-testid={`${prefix}-steps-count`}>{t("tobe.row.steps", { n: stepCount })}</span>}
          {/* 제안 자체는 펼친 곳의 그 칸 옆에 있다 - 칩은 펼치기만 한다 */}
          {hintCount > 0 && (
            <button
              type="button"
              className="equis-hint"
              data-testid={`${prefix}-hints`}
              onClick={() => {
                if (!open) onToggle();
              }}
            >
              <span className="src-badge">EQUIS</span>
              {t("tobe.row.equisHints", { n: hintCount })}
            </button>
          )}
          {refParents.length > 0 && <RefLinkedChip refParents={refParents} testId={`${prefix}-ref-linked`} />}
          {noParent && (
            <span className="pill quiet" data-testid={`${prefix}-no-parent`}>
              {t("tobe.row.noParent")}
            </span>
          )}
          {unsavedEdit !== null && (
            <span className="pill warn" data-testid={`${prefix}-unsaved`}>
              {unsavedEdit === "na" ? t("tobe.slots.unsaved") : t("tobe.outline.unsaved")}
            </span>
          )}
        </>
      }
      actions={actions}
      panel={panel}
      // data-doc은 끌기가 놓을 자리(줄 상자)를 찾는 키, flipKey는 상위 SOP가 바뀐 뒤 줄과 펼친 곳이 함께 미끄러지는 키
      rowData={{ "data-doc": doc.key, "data-drag-box": draggable ? "" : undefined, "data-ref": refParents.length > 0 ? "" : undefined }}
      flipKey={doc.key}
    />
  );
}

/** "참조로 연결" 칩 - 어느 SOP의 참조 항목이 가리키는지는 툴팁으로 */
function RefLinkedChip({ refParents, testId }: { refParents: readonly string[]; testId: string }) {
  const { t } = useI18n();
  return (
    <span className="pill quiet" data-tip={t("tobe.row.refLinkedTip", { sops: refParents.join(", ") })} data-testid={testId}>
      <Link2 size={12} strokeWidth={1.5} aria-hidden />
      {t("tobe.row.refLinked")}
    </span>
  );
}

/** 여러 SOP가 참조한 WI가 번호 순 첫 SOP가 아닌 SOP 아래 다시 보이는 읽기 줄 - 펼치기 · 끌기 · 단추가 없다(온전한 줄은 첫 SOP 아래) */
export function ToBeRefEchoRow({ doc, underKey, refParents }: { doc: DraftDoc; underKey: string; refParents: readonly string[] }) {
  const { t } = useI18n();
  const prefix = `tobe-${doc.key}-under-${underKey}`;
  const code = doc.code.trim() || t("tobe.noCode");
  return (
    <DocRow
      prefix={prefix}
      kind="wi"
      isChild
      open={false}
      onToggle={() => {}}
      toggleLabel={t("tobe.details")}
      expandable={false}
      identity={
        <>
          <span className="doc-kind">WI</span>
          <ClampText text={code} className="doc-code" testId={`${prefix}-code-text`}>
            {code}
          </ClampText>
        </>
      }
      title={doc.title.trim() === "" ? <span className="doc-title-empty">{t("tobe.row.noTitle")}</span> : <ClampText text={doc.title} />}
      meta={<RefLinkedChip refParents={refParents} testId={`${prefix}-ref-linked`} />}
      actions={[]}
      reserveActions
      panel={() => null}
      rowData={{ "data-ref": "" }}
    />
  );
}
