// ③ 전체 - 이미 쓴 문서(문서 → 절 → 문장)와 아직 안 쓴 문서(문서 → 칸·단계)를 한 단계씩 펼친다. N/A 칸은 보이되 고를 수 없다.
// 문장을 받지 않는 상위 항목(묶음)은 이름 줄로만 보인다 - 단추가 아니고 끌어 놓을 자리(data-place)도 아니다.
// 작성자는 여기서 보낼 곳을 바로 더하고 지운다(manage) - 번호·종류·부모만 받고 나머지는 Documents 화면의 To-Be 목록에서 채운다.
"use client";

import { Check, ChevronRight, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Truncate } from "@/components/ui/motion";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import type { TargetDoc, TargetDocType, ToBe, WrittenSentence } from "@/lib/api-sop";
import { getDestinationId, isPlaceOption, type Destination, type TreeRow } from "@/lib/classify-model";
import { checkNewDoc, getDocRemoveBlock, getStepRemoveBlock, listParentCodes, type NewDocDraft } from "@/lib/destination-manage-model";
import { useI18n } from "@/lib/i18n";

/** 지우기 단추를 한 번 누른 뒤 다시 누르기를 기다리는 시간(ms) - 지나면 처음으로 돌아간다 */
const REMOVE_ARM_MS = 3000;
/** 방금 만든 줄을 강조하는 시간(ms) - [data-flash] 애니메이션(1.2초)이 끝난 뒤 표시를 뗀다 */
const FLASH_MS = 1300;
// 입력 줄 - To-Be 표의 칸 입력과 같은 높이·테두리
const TREE_INPUT = "h-7 min-w-0 flex-1 rounded-md border border-line-2 bg-surface px-1.5 text-xs text-ink focus:border-accent focus:outline-none";

export interface DestinationManage {
  tobe: ToBe;
  /** 저장 중 - 그동안 더하기·지우기를 잠근다 */
  busy: boolean;
  /** 성공하면 true. 실패 알림은 호출부가 띄운다 */
  onAddDoc: (draft: NewDocDraft) => Promise<boolean>;
  /** 성공하면 새 단계 번호 */
  onAddStep: (doc: TargetDoc, title: string) => Promise<number | null>;
  onRemoveDoc: (doc: TargetDoc) => Promise<boolean>;
  onRemoveStep: (doc: TargetDoc, stepNo: number) => Promise<boolean>;
}

interface DestinationTreeProps {
  written: WrittenSentence[];
  /** 보낼 곳과 그 사이의 묶음 이름 줄(listTreeRows) */
  rows: TreeRow[];
  /** 보낼 곳이 하나도 없을 때 안내가 가리키는 To-Be 화면 */
  tobeHref: string;
  onPickLink: (targetId: number, additive: boolean) => void;
  onPickPlace: (destination: Destination) => void;
  /** 작성자가 작업 중일 때만 - 없으면 읽기만 한다 */
  manage?: DestinationManage;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups.entries()];
}

/** 입력 줄의 Enter(더하기)·Esc(닫기) - 화면 단축키(Enter 확정 등)로 새지 않게 여기서 끝낸다 */
function handleFormKey(event: KeyboardEvent, onSubmit: () => void, onCancel: () => void) {
  // Enter는 글자 칸에서만 - 단추·부모 고르기의 Enter는 그 요소가 쓴다. Esc는 펼친 고르기 목록이 먼저 받는다
  const isSubmit = event.key === "Enter" && event.target instanceof HTMLInputElement;
  const isCancel = event.key === "Escape" && document.querySelector('[role="listbox"]') === null;
  if (!isSubmit && !isCancel) return;
  event.preventDefault();
  event.stopPropagation();
  if (isSubmit) onSubmit();
  else onCancel();
}

export function DestinationTree({ written, rows: treeRows, tobeHref, onPickLink, onPickPlace, manage }: DestinationTreeProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen((prev) => (prev.has(key) ? new Set([...prev].filter((item) => item !== key)) : new Set([...prev, key])));
  // 새 문서 입력 줄 - null이면 닫힘
  const [docDraft, setDocDraft] = useState<NewDocDraft | null>(null);
  // 단계 제목 입력 줄이 열린 WI 번호
  const [stepDraft, setStepDraft] = useState<{ code: string; title: string } | null>(null);
  // 지우기를 한 번 누른 줄(testid) - 다시 누르면 지운다
  const [armed, setArmed] = useState<string | null>(null);
  // 방금 만든 줄(testid) - 그려지면 화면 안으로 들이고 한 번 강조한다
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (armed === null) return;
    const timer = window.setTimeout(() => setArmed(null), REMOVE_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  // 줄 목록의 모양 - 목록 배열은 그릴 때마다 새로 만들어져, 아래 이펙트가 줄이 실제로 바뀔 때만 다시 돌게 글자로 견준다
  const rowsKey = treeRows.map((row) => (row.kind === "place" ? row.option.id : row.id)).join("|");
  useEffect(() => {
    if (flash === null) return;
    // 새 목록이 그려진 뒤에야 줄이 생긴다 - 줄 목록이 바뀔 때마다 다시 찾는다
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-testid="${flash}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.dataset.flash = "";
    const timer = window.setTimeout(() => {
      delete el.dataset.flash;
      setFlash(null);
    }, FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash, rowsKey]);

  const tobe = manage?.tobe ?? null;
  const docByCode = new Map((tobe?.docs ?? []).map((doc) => [doc.code, doc]));
  const parentCodes = tobe ? listParentCodes(tobe) : [];
  const docProblem = tobe && docDraft ? checkNewDoc(tobe, docDraft) : null;

  function openDocForm() {
    setStepDraft(null);
    setDocDraft({ code: "", docType: "sop", parentCode: null });
  }

  function setDocType(docType: TargetDocType) {
    // WI로 바꾸면 부모를 미리 고른다 - SOP가 하나뿐이면 더 고를 것이 없다
    setDocDraft((prev) => prev && { ...prev, docType, parentCode: docType === "wi" ? (prev.parentCode ?? parentCodes[0] ?? null) : null });
  }

  async function submitDoc() {
    if (!manage || !docDraft || docProblem !== null || manage.busy) return;
    const draft = { ...docDraft, code: docDraft.code.trim() };
    if (!(await manage.onAddDoc(draft))) return;
    setDocDraft(null);
    setOpen((prev) => new Set([...prev, `p${draft.code}`]));
    setFlash(`assign-tree-p${draft.code}`);
  }

  async function submitStep(doc: TargetDoc) {
    if (!manage || !stepDraft || manage.busy) return;
    const stepNo = await manage.onAddStep(doc, stepDraft.title.trim());
    if (stepNo === null) return;
    setStepDraft(null);
    const destination: Destination = { kind: "step", docId: doc.id, step: stepNo, part: "instruction" };
    // 만든 단계가 바로 고른 곳이 된다
    onPickPlace(destination);
    setFlash(`assign-tree-place-${getDestinationId(destination)}`);
  }

  /** 줄 끝 지우기 단추 - 지울 수 없으면 잠그고 이유를 툴팁으로, 지울 수 있으면 두 번 눌러 지운다 */
  function renderRemove(testId: string, name: string, block: string | null, run: () => Promise<boolean>) {
    if (!manage) return null;
    const isArmed = armed === testId;
    const label = block !== null ? t(`assign.tree.why.${block}`) : isArmed ? t("assign.tree.removeAgain") : t("assign.tree.remove", { name });
    return (
      <Tooltip label={label} align="end">
        <button
          type="button"
          className="tree-act"
          aria-label={label}
          aria-disabled={block !== null || manage.busy ? "true" : undefined}
          data-armed={isArmed ? "" : undefined}
          data-testid={testId}
          onClick={() => {
            if (block !== null || manage.busy) return;
            if (!isArmed) return setArmed(testId);
            setArmed(null);
            void run();
          }}
        >
          <Trash2 size={13} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
    );
  }

  function renderNode(key: string, label: string, sub: string) {
    return (
      <button type="button" className="tree-node" aria-expanded={open.has(key)} data-testid={`assign-tree-${key}`} onClick={() => toggle(key)}>
        <ChevronRight size={13} strokeWidth={1.6} className="tree-chev" aria-hidden />
        <Truncate className="min-w-0 flex-1 font-mono text-[length:var(--fs-cap)] font-semibold" text={label} revealOnFocus />
        <span className="tree-sub">{sub}</span>
      </button>
    );
  }

  function renderDocForm() {
    if (!manage || !docDraft) return null;
    const problem = docProblem === "codeRequired" ? null : docProblem;
    return (
      <div className="tree-form" data-testid="assign-tree-doc-form" onKeyDown={(event) => handleFormKey(event, () => void submitDoc(), () => setDocDraft(null))}>
        <div className="flex items-center gap-1">
          {(["sop", "wi"] as const).map((docType) => (
            <button key={docType} type="button" className="mini-chip" aria-pressed={docDraft.docType === docType} disabled={docType === "wi" && parentCodes.length === 0} data-testid={`assign-tree-doc-type-${docType}`} onClick={() => setDocType(docType)}>
              {docType === "sop" ? "SOP" : "WI"}
            </button>
          ))}
          <input
            className={`${TREE_INPUT} font-mono`}
            value={docDraft.code}
            maxLength={100}
            autoFocus
            placeholder={t("assign.tree.codePlaceholder")}
            aria-label={t("assign.tree.codePlaceholder")}
            aria-invalid={problem === "codeTaken" ? "true" : undefined}
            data-testid="assign-tree-doc-code"
            onChange={(event) => setDocDraft({ ...docDraft, code: event.target.value })}
          />
        </div>
        {docDraft.docType === "wi" && (
          <label className="flex items-center gap-1.5 text-xs text-ink-3">
            {t("assign.tree.parent")}
            <Select
              value={docDraft.parentCode ?? ""}
              options={parentCodes.map((code) => ({ value: code, label: code }))}
              onChange={(parentCode) => setDocDraft({ ...docDraft, parentCode })}
              testId="assign-tree-doc-parent"
              ariaLabel={t("assign.tree.parent")}
              size="sm"
              mono
              className="min-w-0 flex-1"
            />
          </label>
        )}
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 text-xs text-st-hold" role="status" data-testid="assign-tree-doc-problem">
            {problem !== null && t(`assign.tree.problem.${problem}`)}
          </span>
          <button type="button" className="btn pri h-7" disabled={docProblem !== null || manage.busy} data-testid="assign-tree-doc-add" onClick={() => void submitDoc()}>
            <Check size={13} strokeWidth={1.6} aria-hidden />
            {t("assign.tree.add")}
          </button>
          <button type="button" className="btn ghost icon h-7 w-7" aria-label={t("common.cancel")} data-testid="assign-tree-doc-cancel" onClick={() => setDocDraft(null)}>
            <X size={13} strokeWidth={1.6} aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  function renderStepAdd(doc: TargetDoc) {
    if (!manage) return null;
    if (stepDraft?.code !== doc.code) {
      return (
        <button
          type="button"
          className="tree-add"
          disabled={manage.busy}
          data-testid={`assign-tree-add-step-${doc.id}`}
          onClick={() => {
            setDocDraft(null);
            setStepDraft({ code: doc.code, title: "" });
          }}
        >
          <Plus size={13} strokeWidth={1.6} aria-hidden />
          {t("assign.tree.addStep")}
        </button>
      );
    }
    return (
      <div className="tree-form" data-testid="assign-tree-step-form" onKeyDown={(event) => handleFormKey(event, () => void submitStep(doc), () => setStepDraft(null))}>
        <div className="flex items-center gap-1">
          <input
            className={TREE_INPUT}
            value={stepDraft.title}
            maxLength={500}
            autoFocus
            placeholder={t("assign.tree.stepPlaceholder")}
            aria-label={t("assign.tree.stepPlaceholder")}
            data-testid="assign-tree-step-title"
            onChange={(event) => setStepDraft({ code: doc.code, title: event.target.value })}
          />
          <button type="button" className="btn pri h-7" disabled={manage.busy} data-testid="assign-tree-step-add" onClick={() => void submitStep(doc)}>
            <Check size={13} strokeWidth={1.6} aria-hidden />
            {t("assign.tree.add")}
          </button>
          <button type="button" className="btn ghost icon h-7 w-7" aria-label={t("common.cancel")} data-testid="assign-tree-step-cancel" onClick={() => setStepDraft(null)}>
            <X size={13} strokeWidth={1.6} aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  function renderDocAdd() {
    if (!manage) return null;
    if (docDraft) return renderDocForm();
    return (
      <button type="button" className="tree-add" disabled={manage.busy} data-testid="assign-tree-add-doc" onClick={openDocForm}>
        <Plus size={13} strokeWidth={1.6} aria-hidden />
        {t("assign.tree.addDoc")}
      </button>
    );
  }

  const writtenDocs = groupBy(
    written.filter((row) => row.kind === "sentence"),
    (row) => String(row.target_doc_id),
  );
  const placeDocs = groupBy(treeRows, (row) => (row.kind === "place" ? row.option.docCode : row.docCode));
  if (writtenDocs.length === 0 && placeDocs.length === 0) {
    return (
      <div ref={rootRef} className="grid gap-1.5 px-3 py-4 text-[13px] leading-5 text-ink-2" data-testid="assign-tree-empty">
        <p>{t("assign.tree.empty")}</p>
        <Link href={tobeHref} className="text-link" data-testid="assign-tree-open-tobe">
          {t("assign.openTobe")}
        </Link>
        {renderDocAdd()}
      </div>
    );
  }
  return (
    <div ref={rootRef} className="dest-tree">
      {writtenDocs.length > 0 && <p className="tree-group">{t("assign.tree.written")}</p>}
      {writtenDocs.map(([docId, rows]) => (
        <div key={docId}>
          {renderNode(`w${docId}`, rows[0].doc_code, t("assign.tree.count", { n: rows.length }))}
          {open.has(`w${docId}`) && (
            <div className="tree-kids">
              {groupBy(rows, (row) => row.section_path).map(([section, items]) => (
                <div key={section || "-"}>
                  {section && <p className="tree-section">{section}</p>}
                  {items.map((row) => (
                    <button key={row.target_id} type="button" className="tree-leaf" data-testid={`assign-tree-sentence-${row.target_id}`} onClick={(event) => onPickLink(row.target_id, event.ctrlKey || event.metaKey)}>
                      {row.text}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {(placeDocs.length > 0 || manage) && <p className="tree-group">{t("assign.tree.unwritten")}</p>}
      {placeDocs.map(([code, items]) => {
        const doc = docByCode.get(code);
        return (
          <div key={code}>
            <div className="tree-row">
              {renderNode(`p${code}`, code, t("assign.tree.count", { n: items.filter((row) => row.kind === "place" && isPlaceOption(row.option)).length }))}
              {tobe && doc && renderRemove(`assign-tree-remove-doc-${doc.id}`, code, getDocRemoveBlock(tobe, doc), () => manage?.onRemoveDoc(doc) ?? Promise.resolve(false))}
            </div>
            {open.has(`p${code}`) && (
              <div className="tree-kids">
                {items.map((row) => {
                  if (row.kind === "heading") {
                    // 묶음 이름 줄 - 보낼 곳이 아니라 단추도 data-place도 없다(끌어 놓기가 이 줄을 찾지 못한다)
                    return (
                      <p key={row.id} className="tree-heading" style={{ paddingLeft: 8 + row.depth * 14 }} data-testid={`assign-tree-heading-${row.id}`}>
                        {row.label}
                        {row.isNa && <span className="tree-sub"> · N/A</span>}
                      </p>
                    );
                  }
                  const { option } = row;
                  const { destination } = option;
                  // 단계 지우기는 그 단계의 첫 줄(Instruction) 끝에 한 번만 둔다
                  const stepNo = destination.kind === "step" && destination.part === "instruction" ? destination.step : null;
                  // data-place는 Old 조각을 끌어 놓을 때 이 줄의 보낼 곳을 찾는 열쇠(무엇을 받는지는 놓기 모델이 정한다)
                  return (
                    <div key={option.id} className="tree-row" data-place={option.id} data-na={option.disabled ? "" : undefined}>
                      <button
                        type="button"
                        className="tree-leaf"
                        disabled={option.disabled}
                        style={{ paddingLeft: 8 + option.depth * 14 }}
                        data-testid={`assign-tree-place-${option.id}`}
                        onClick={() => onPickPlace(destination)}
                      >
                        {destination.kind === "slot_heading" && <span className="tree-sub">{t("assign.slotHeading")} · </span>}
                        {option.label}
                        {option.disabled && <span className="tree-sub"> · N/A</span>}
                      </button>
                      {tobe && doc && stepNo !== null &&
                        renderRemove(`assign-tree-remove-step-${doc.id}-${stepNo}`, t("assign.tree.stepName", { n: stepNo }), getStepRemoveBlock(tobe, doc, stepNo), () => manage?.onRemoveStep(doc, stepNo) ?? Promise.resolve(false))}
                    </div>
                  );
                })}
                {doc?.doc_type === "wi" && renderStepAdd(doc)}
              </div>
            )}
          </div>
        );
      })}
      {renderDocAdd()}
    </div>
  );
}
