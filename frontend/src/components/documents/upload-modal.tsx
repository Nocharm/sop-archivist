// 문서 올리기 - 창구는 이것 하나다. 고른 파일은 Old(지금 있는 문서) 묶음과 New(이미 써 둔 새 문서) 묶음으로 나뉘어 보이고 하나씩 차례로 올라간다.
// 쪽을 정하는 길 넷: 앱이 먼저 고른다(파일 이름의 번호가 New 목록에 있으면 New, 아니면 Old - lib/upload-model), Old | New 단추,
// 줄을 끌어 다른 묶음에 놓기, 파일을 묶음 위에 놓기. 고르기도 놓기도 목록에 더한다(이름과 크기가 같은 파일은 한 번만).
// New 파일은 번호가 같은 빈 목록 줄에 붙고, 없으면 줄이 새로 생긴다(종류와 상위 SOP를 여기서 고른다).
// 올리는 동안 묶음과 줄은 제자리에 남고 줄의 아랫줄이 상태가 된다. 서버가 올릴 때 바로 추출하고 문서 번호·버전·언어 배치를 미리 채우므로,
// Old 파일은 결과와 채운 값(출처 표)을 그 자리에서 고칠 수 있다.
// 설계: docs/superpowers/specs/2026-11-17-documents-screen-design.md §9
"use client";

import { ArrowRight, FileText, Loader2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { AiSuggestChip } from "@/components/documents/ai-suggest-chip";
import { DocStatusPill, getDocReason } from "@/components/documents/doc-status";
import { FileName } from "@/components/documents/file-name";
import { LayoutLabel } from "@/components/documents/layout-picto";
import { InlineText } from "@/components/inline-text";
import { Modal } from "@/components/modal";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { VersionInput } from "@/components/ui/version-input";
import { humanizeApiError } from "@/lib/api-errors";
import { getToBe, LANGUAGE_LAYOUTS, updateDocument, uploadDocument, type DocumentUpdateInput, type SopDocument } from "@/lib/api-sop";
import { findUnderPoint, type BoxDragConfig, type DragPoint } from "@/lib/box-drag";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import { getStageHref } from "@/lib/stages";
import {
  addPickedFiles,
  formatFileSize,
  guessUploadSide,
  listUploadOrder,
  planNewUpload,
  readFileCode,
  resolveSideDrop,
  type NewUploadPlan,
  type PickedFile,
  type UploadSide,
} from "@/lib/upload-model";
import { useBoxDrag } from "@/lib/use-box-drag";
import { useLoaded } from "@/lib/use-loaded";

interface UploadRow {
  side: UploadSide;
  state: "waiting" | "uploading" | "done" | "error";
  document?: SopDocument;
  error?: unknown;
  /** 서버가 채운 칸의 출처 - 사람이 고친 칸은 지운다 */
  sources?: Partial<Record<PrefillField, PrefillSource>>;
}

type PrefillField = "doc_code" | "doc_version" | "language_layout";
type PrefillSource = "file_name" | "content" | "ai";

const SIDES = ["old", "new"] as const;
const ZONE_SELECTOR = "[data-upload-zone]";

/** 묶음 상자가 말하는 쪽 - 묶음 밖이면 null */
function readZoneSide(zone: HTMLElement | null): UploadSide | null {
  const side = zone?.dataset.uploadZone;
  return side === "old" || side === "new" ? side : null;
}

function SourceBadge({ source }: { source: PrefillSource | undefined }) {
  const { t } = useI18n();
  if (!source) return null;
  return <span className={`src-badge ${source}`}>{t(`documents.source.${source}`)}</span>;
}

interface UploadModalProps {
  bundleId: number;
  /** 화면에 끌어다 놓아 연 것이면 그 파일들 */
  initialFiles?: File[];
  onClose: () => void;
  /** 파일 하나가 끝날 때마다 - 목록을 바로 다시 그린다 */
  onUploaded: () => void;
  /** 부모가 다시 읽은 최신 문서 - Old 번호를 알고, 업로드 뒤 늦게 끝나는 AI 제안(ai_meta)을 결과 행에 보인다 */
  latest?: SopDocument[];
}

export function UploadModal({ bundleId, initialFiles = [], onClose, onUploaded, latest = [] }: UploadModalProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<PickedFile[]>(() => addPickedFiles([], initialFiles, null, genId));
  // 올리기를 누르면 생긴다 - picked와 같은 자리의 결과. null이면 아직 고르는 국면
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  const isPicking = rows === null;
  const running = rows?.some((row) => row.state === "waiting" || row.state === "uploading") ?? false;
  // New 목록 - 어느 줄에 붙을지 미리 알려 준다. 못 읽어도 올리기는 된다(서버가 검사한다)
  const tobe = useLoaded(() => getToBe(bundleId), String(bundleId));
  const listed = tobe.data?.docs ?? [];
  const newCodes = new Set(listed.map((doc) => doc.code));
  const oldCodes = new Set(latest.filter((doc) => doc.side === "old" && doc.doc_code).map((doc) => doc.doc_code));
  const usedDocIds = new Set((tobe.data?.sentence_counts ?? []).map((place) => place.target_doc_id));
  const sopCodes = listed.filter((doc) => doc.doc_type === "sop").map((doc) => doc.code);

  const plans = picked.map((item) => {
    const code = readFileCode(item.file.name);
    const side = item.side ?? guessUploadSide(code, newCodes, oldCodes);
    const plan: NewUploadPlan | null = side === "new" ? planNewUpload(code, listed, usedDocIds) : null;
    // 새 줄이 생기는 WI는 상위 SOP를 골라야 한다
    const isMissingParent = plan?.kind === "create" && item.docType === "wi" && item.parentCode === "";
    return { code, side, plan, isReady: plan?.kind !== "blocked" && !isMissingParent };
  });
  const canSubmit = picked.length > 0 && plans.every((plan) => plan.isReady);
  // 줄이 든 묶음 - 올린 뒤에는 보낸 쪽 그대로다(올라간 Old 문서의 번호가 앱이 고르는 쪽을 뒤집지 않게)
  const sides = rows?.map((row) => row.side) ?? plans.map((plan) => plan.side);

  // 줄은 자리가 아니라 id로 고친다 - 그사이 다른 줄이 빠져도 엉뚱한 파일을 건드리지 않는다
  function patchPicked(id: string, patch: Partial<PickedFile>) {
    setPicked((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  // 단추로 쪽을 바꾸면 줄이 다른 묶음으로 옮겨 가며 다시 그려져 눌린 단추가 사라진다 - 포커스가 창 밖으로 떨어지지 않게
  // 옮겨 간 줄의 같은 단추로 돌려놓고 보이는 곳으로 올린다(끌기와 같은 일을 자판으로도 잇달아 할 수 있게, G12)
  const refocusRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const testId = refocusRef.current;
    refocusRef.current = null;
    const button = testId ? groupsRef.current?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) : null;
    if (!button) return;
    button.focus({ preventScroll: true });
    button.closest(".upload-item")?.scrollIntoView({ block: "nearest" });
  }, [picked]);

  /** 끄는 줄을 그 자리에 놓으면 바뀔 쪽과 그 묶음 상자 - 제 묶음 위나 묶음 밖이면 null */
  function findSideDrop(id: string, point: DragPoint): { side: UploadSide; zone: HTMLElement } | null {
    const index = picked.findIndex((item) => item.id === id);
    const zone = findUnderPoint(point, ZONE_SELECTOR);
    const side = index < 0 ? null : resolveSideDrop(plans[index].side, readZoneSide(zone));
    return zone && side ? { side, zone } : null;
  }

  // 줄을 끌어 다른 묶음에 놓는다(설계 §9) - 창 안의 고르기일 뿐 저장이 아니고 거절도 없다. 끄는 동안의 표시는 DOM 속성뿐이다(G11)
  const sideDrag: BoxDragConfig<{ id: string }> = {
    pick: (event) => {
      const el = event.target instanceof Element ? event.target.closest<HTMLElement>(".upload-item[data-drag-box]") : null;
      const item = el ? picked[Number(el.dataset.index)] : undefined;
      return item ? { id: item.id } : null;
    },
    getCard: ({ id }) => {
      // 표의 ID 자리에 지금 쪽을 적는다 - 놓으면 바뀔 쪽은 메모가 말한다
      const index = picked.findIndex((item) => item.id === id);
      return index < 0 ? { id: "", text: "", count: null } : { id: t(`upload.side.${plans[index].side}`), text: picked[index].file.name, count: null };
    },
    getScrollers: () => (groupsRef.current ? [groupsRef.current] : []),
    onStart: ({ id }) => {
      const index = picked.findIndex((item) => item.id === id);
      groupsRef.current?.querySelector(`.upload-item[data-index="${index}"]`)?.setAttribute("data-drag-src", "");
    },
    onMove: ({ id }, point) => {
      const drop = findSideDrop(id, point);
      return drop ? { state: "ok", note: t(`upload.drag.${drop.side}`), target: drop.zone } : { state: "none" };
    },
    onDrop: ({ id }, point) => {
      const drop = findSideDrop(id, point);
      if (drop) patchPicked(id, { side: drop.side });
    },
    // 취소 때도 - 창이 닫히며 끊긴 끌기도 치우게 문서 전체에서 찾는다
    onEnd: () => {
      for (const el of document.querySelectorAll(".upload-item[data-drag-src]")) el.removeAttribute("data-drag-src");
    },
  };
  useBoxDrag(groupsRef, isPicking ? sideDrag : null);

  // 창이 열려 있는 동안 창이 파일 놓기를 받는다 - 묶음 위에 놓으면 그 쪽으로, 창의 다른 곳(어두운 바탕 포함)이면 앱이 쪽을 고른다.
  // 받지 않으면 브라우저가 놓은 파일을 열어 화면을 떠난다. 올리는 국면에서는 받지 않되 그것만은 막는다.
  // 끄는 동안의 표시는 DOM 속성뿐이다: 포인터 아래 묶음의 data-drop, 창 틀의 data-file-drag
  useEffect(() => {
    let marked: HTMLElement | null = null;
    function mark(zone: HTMLElement | null, isDragging: boolean) {
      if (marked !== zone) {
        marked?.removeAttribute("data-drop");
        zone?.setAttribute("data-drop", "over");
        marked = zone;
      }
      frameRef.current?.toggleAttribute("data-file-drag", isDragging);
    }
    // 끌려온 파일 아래의 묶음 - 놓기 이벤트의 target이 포인터 아래 요소다(글자 위에서는 글자 마디가 올 수 있어 그 부모로 본다)
    function findZone(event: DragEvent) {
      const target = event.target;
      const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      return el?.closest<HTMLElement>(ZONE_SELECTOR) ?? null;
    }
    // 파일을 끄는 것만 받는다 - 글자나 링크를 끄는 것은 그대로 둔다
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

    function handleDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (isPicking) mark(findZone(event), true);
      else if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    }
    function handleDragLeave(event: DragEvent) {
      // 창 밖으로 나갔을 때만 - 요소 사이를 넘을 때마다 오는 dragleave에 지우면 깜박인다
      if (event.relatedTarget === null) mark(null, false);
    }
    function handleDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      mark(null, false);
      if (!isPicking) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      const side = readZoneSide(findZone(event));
      // 화면에 놓아 이 창을 연 그 놓기가 여기까지 올라와도 같은 파일이라 줄이 늘지 않는다
      if (files.length > 0) setPicked((prev) => addPickedFiles(prev, files, side, genId));
    }
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
      mark(null, false);
    };
  }, [isPicking]);

  // 결과 행에서 바로 고친다 - 고친 칸은 출처 표가 사라진다
  async function saveRow(index: number, field: PrefillField, change: Omit<DocumentUpdateInput, "revision">) {
    const document = rows?.[index]?.document;
    if (!document) return;
    try {
      const updated = await updateDocument(bundleId, document.id, { revision: document.revision, ...change });
      setRows((prev) =>
        prev?.map((row, i) => {
          if (i !== index) return row;
          const sources = { ...row.sources };
          delete sources[field];
          return { ...row, document: updated, sources };
        }) ?? null,
      );
      onUploaded();
    } catch (error) {
      showToast(humanizeApiError(error, t), "error");
    }
  }

  async function handleUpload() {
    const queue = picked.map((item, index) => ({ ...item, side: plans[index].side, plan: plans[index].plan }));
    setRows(queue.map((item): UploadRow => ({ side: item.side, state: "waiting" })));
    // 동시에 올리면 서버 파싱 자리(최대 2)를 다투므로 차례로 올린다 - Old 묶음의 위에서 아래, 그다음 New 묶음
    for (const index of listUploadOrder(queue.map((item) => item.side))) {
      const item = queue[index];
      setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, state: "uploading" } : row)) ?? null);
      try {
        // 목록 줄에 붙는 파일은 종류·상위 SOP가 그 줄의 것이라 보내지 않는다
        const isCreating = item.side === "new" && item.plan?.kind === "create";
        const document = await uploadDocument(bundleId, {
          file: item.file,
          side: item.side,
          docType: isCreating ? item.docType : undefined,
          parentCode: isCreating && item.docType === "wi" ? item.parentCode : undefined,
        });
        setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, state: "done", document, sources: document.prefill_sources ?? {} } : row)) ?? null);
        onUploaded();
      } catch (error) {
        setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, state: "error", error } : row)) ?? null);
      }
    }
  }

  const hasReady = rows?.some((row) => row.document?.status === "ready") ?? false;
  const footer = isPicking ? (
    <>
      <button type="button" className="btn" data-testid="upload-cancel" onClick={onClose}>
        <X size={16} strokeWidth={1.5} aria-hidden />
        {t("common.cancel")}
      </button>
      <button type="button" className="btn pri" data-testid="upload-submit" disabled={!canSubmit} onClick={() => void handleUpload()}>
        {t("documents.uploadCount", { n: picked.length })}
      </button>
    </>
  ) : (
    <>
      <button type="button" className={hasReady ? "btn" : "btn pri"} data-testid="upload-done" disabled={running} onClick={onClose}>
        {t("common.close")}
      </button>
      {/* 읽힌 문서가 있으면 다음 단계로 바로 간다 - 닫고 레일에서 다시 찾지 않게 */}
      {hasReady && !running && (
        <Link href={getStageHref(bundleId, "assign")} className="btn pri" data-testid="upload-go-assign" onClick={onClose}>
          <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
          {t("upload.goAssign")}
        </Link>
      )}
    </>
  );

  /** 고르는 국면의 아랫줄 - 올리면 생기는 일 */
  function renderPlan(index: number) {
    const item = picked[index];
    const { plan, code } = plans[index];
    if (plan === null) {
      // Old - 번호가 없는 파일은 읽힌 뒤 결과 줄에서 번호를 정한다
      return code !== "" ? (
        <span className="text-xs text-ink-2" data-testid={`upload-note-${index}`}>
          {t("upload.oldAdds", { code })}
        </span>
      ) : (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid={`upload-note-${index}`}>
          <span className="pill warn">{t("upload.noNumber")}</span>
          <span className="text-xs text-ink-3">{t("upload.setLater")}</span>
        </span>
      );
    }
    if (plan.kind === "attach") {
      return (
        <span className="text-xs text-ink-2" data-testid={`upload-note-${index}`}>
          {t("upload.attachNote", { code: plan.code })}
        </span>
      );
    }
    if (plan.kind === "blocked") {
      return (
        <span className="text-xs text-danger" data-testid={`upload-note-${index}`}>
          {t(plan.reasonKey, { code })}
        </span>
      );
    }
    // 줄이 새로 생긴다 - 종류와(WI면) 상위 SOP를 목록에서 고른다. 번호가 없는 파일은 임시 번호로 생긴다
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid={`upload-note-${index}`}>
        <span className="text-xs text-ink-3">{code === "" ? t("upload.createNoCode") : t("upload.creates")}</span>
        <Select
          testId={`upload-kind-${index}`}
          ariaLabel={t("documents.docType")}
          size="sm"
          value={item.docType}
          options={[
            { value: "sop", label: "SOP" },
            { value: "wi", label: "WI" },
          ]}
          onChange={(docType) => patchPicked(item.id, { docType, parentCode: docType === "wi" ? item.parentCode : "" })}
        />
        {code !== "" && <span className="font-mono text-xs text-ink">{code}</span>}
        {item.docType === "wi" &&
          (sopCodes.length > 0 ? (
            <>
              <span className="text-xs text-ink-3">· {t("upload.under")}</span>
              <Select
                testId={`upload-parent-${index}`}
                ariaLabel={t("documents.parentCode")}
                size="sm"
                mono
                value={item.parentCode}
                options={[{ value: "", label: t("upload.pickParent") }, ...sopCodes.map((sop) => ({ value: sop, label: sop }))]}
                onChange={(parentCode) => patchPicked(item.id, { parentCode })}
              />
            </>
          ) : (
            <span className="text-xs text-danger">{t("upload.why.noSop")}</span>
          ))}
      </span>
    );
  }

  /** 올리는 국면의 아랫줄 - 기다림 · 읽는 중 · 결과. 읽힌 Old 파일은 그 자리에서 번호 · 버전 · 언어 배치를 고친다 */
  function renderResult(index: number) {
    const row = rows?.[index];
    if (!row) return null;
    const document = row.state === "done" ? row.document : undefined;
    const aiMeta = document ? latest.find((item) => item.id === document.id)?.ai_meta : undefined;
    return (
      <div className="upload-state" data-testid={`upload-row-${index}-state`} data-state={row.state}>
        {row.state === "uploading" ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-3">
            <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden />
            {t("documents.reading")}
          </span>
        ) : row.state === "error" ? (
          <span className="text-xs text-danger" data-testid={`upload-row-${index}-reason`}>
            {humanizeApiError(row.error, t)}
          </span>
        ) : !document ? (
          <span className="text-xs text-ink-4">{t("documents.waiting")}</span>
        ) : document.status !== "ready" ? (
          <>
            <DocStatusPill status={document.status} testId={`upload-row-${index}-status`} />
            <span className="text-xs text-danger" data-testid={`upload-row-${index}-reason`}>
              {getDocReason(document, t)}
            </span>
          </>
        ) : row.side === "new" ? (
          <>
            <DocStatusPill status={document.status} testId={`upload-row-${index}-status`} />
            {/* New 문서의 번호는 목록 줄의 번호다 - 여기서 고치지 않는다(목록에서 고친다) */}
            <span className={document.doc_code ? "font-mono text-xs" : "text-ink-4"} data-testid={`upload-row-${index}-listed`}>
              {document.doc_code || "–"}
            </span>
          </>
        ) : (
          <>
            <DocStatusPill status={document.status} testId={`upload-row-${index}-status`} />
            <div className="upload-fields">
              <span className="src-cell">
                <InlineText
                  value={document.doc_code}
                  placeholder={t("documents.colCode")}
                  editable
                  mono
                  width="fill"
                  maxLength={100}
                  testId={`upload-row-${index}-code`}
                  onSave={(doc_code) => saveRow(index, "doc_code", { doc_code })}
                />
                <SourceBadge source={row.sources?.doc_code} />
                {!document.doc_code && aiMeta?.doc_code && (
                  <AiSuggestChip value={aiMeta.doc_code} testId={`upload-row-${index}-code-ai`} onAccept={() => void saveRow(index, "doc_code", { doc_code: aiMeta.doc_code ?? "" })} />
                )}
              </span>
              <span className="src-cell">
                <VersionInput value={document.doc_version} testId={`upload-row-${index}-version`} onCommit={(doc_version) => void saveRow(index, "doc_version", { doc_version })} />
                <SourceBadge source={row.sources?.doc_version} />
                {!document.doc_version && aiMeta?.doc_version && (
                  <AiSuggestChip value={aiMeta.doc_version} testId={`upload-row-${index}-version-ai`} onAccept={() => void saveRow(index, "doc_version", { doc_version: aiMeta.doc_version ?? "" })} />
                )}
              </span>
              <span className="src-cell">
                <Select
                  testId={`upload-row-${index}-layout`}
                  ariaLabel={t("documents.colLayout")}
                  size="sm"
                  value={document.language_layout}
                  options={LANGUAGE_LAYOUTS.map((layout) => ({ value: layout, label: <LayoutLabel layout={layout} label={t(`layoutKind.${layout}`)} /> }))}
                  onChange={(language_layout) => void saveRow(index, "language_layout", { language_layout })}
                />
                <SourceBadge source={row.sources?.language_layout} />
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  /** 줄 하나 - 자리 번호는 고른 순서라 쪽을 바꿔도 변하지 않는다. 올리는 국면에서는 같은 줄이 아랫줄만 상태로 바꿔 그린다 */
  function renderItem(index: number) {
    const item = picked[index];
    return (
      <div
        key={item.id}
        className={isPicking ? "upload-item" : "upload-item is-result"}
        data-index={index}
        data-drag-box={isPicking ? "" : undefined}
        data-testid={isPicking ? `upload-picked-${index}` : `upload-row-${index}`}
      >
        <div className="upload-item-top">
          <FileText size={14} strokeWidth={1.5} className="flex-none text-ink-3" aria-hidden />
          <FileName name={item.file.name} className="text-xs text-ink" />
          <span className="upload-size" data-testid={`upload-size-${index}`}>
            {formatFileSize(item.file.size)}
          </span>
        </div>
        <div className="upload-item-sub">{isPicking ? renderPlan(index) : renderResult(index)}</div>
        {isPicking && (
          <>
            {/* Old | New - 눌린 쪽이 올라갈 곳이다. 줄을 끌어 놓는 것과 같은 결과다(G12) */}
            <span className="view-toggle upload-side" role="group" aria-label={t("upload.side")}>
              {SIDES.map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={plans[index].side === side}
                  data-testid={`upload-side-${index}-${side}`}
                  onClick={() => {
                    refocusRef.current = `upload-side-${index}-${side}`;
                    patchPicked(item.id, { side });
                  }}
                >
                  {t(`upload.side.${side}`)}
                </button>
              ))}
            </span>
            <span className="upload-item-remove">
              <Tooltip label={t("upload.remove")} align="end">
                <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("upload.remove")} data-testid={`upload-remove-${index}`} onClick={() => setPicked((prev) => prev.filter((other) => other.id !== item.id))}>
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </Tooltip>
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <Modal title={t("documents.upload")} onClose={onClose} isBusy={running} testId="upload" footer={footer} size="xl">
      <div ref={frameRef} className="upload-body">
        {isPicking && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".docx,.pdf"
              data-testid="upload-files"
              className="sr-only"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                setPicked((prev) => addPickedFiles(prev, files, null, genId));
                // 같은 파일을 다시 고를 수 있게 비운다
                event.target.value = "";
              }}
            />
            <button type="button" className="btn" data-testid="upload-pick" onClick={() => fileRef.current?.click()}>
              <Upload size={16} strokeWidth={1.5} aria-hidden />
              {t("documents.pickFiles")}
            </button>
            <p className="text-xs text-ink-3">{t("upload.dropHint")}</p>
          </div>
        )}
        {/* 묶음 영역 - 높이 상한 안에서 스크롤하고(아래 단추가 늘 보인다) 줄 끌기의 스스로 스크롤도 이 영역이다 */}
        <div ref={groupsRef} className="upload-groups" data-testid={isPicking ? "upload-picked" : "upload-results"}>
          {SIDES.map((side) => {
            const indexes = sides.flatMap((at, index) => (at === side ? [index] : []));
            return (
              <section key={side} className="upload-group" data-upload-zone={side} data-testid={`upload-group-${side}`}>
                <header className="upload-group-head">
                  <h3>{t(side === "old" ? "documents.oldTitle" : "documents.tobeTitle")}</h3>
                  <span className="upload-count" data-testid={`upload-group-${side}-count`}>
                    {indexes.length}
                  </span>
                  <span className="upload-group-lead">{t(`upload.group.${side}Lead`)}</span>
                </header>
                {indexes.map(renderItem)}
                {isPicking && indexes.length === 0 && (
                  <p className="upload-empty" data-testid={`upload-group-${side}-empty`}>
                    {t(`upload.group.${side}Empty`)}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
