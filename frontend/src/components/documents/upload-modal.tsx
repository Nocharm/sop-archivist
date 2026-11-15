// 문서 올리기 - 창구는 이것 하나다. 파일마다 Old(지금 있는 문서)인지 New(이미 써 둔 새 문서)인지 고르고 하나씩 차례로 올린다.
// 앱이 먼저 고른다: 파일 이름의 번호가 New 목록에 있으면 New, 아니면 Old(lib/upload-model). 사람이 눌러 뒤집는다.
// New 파일은 번호가 같은 빈 목록 줄에 붙고, 없으면 줄이 새로 생긴다(종류와 상위 SOP를 여기서 고른다).
// 서버가 올릴 때 바로 추출하고 문서 번호·버전·언어 배치를 미리 채우므로, Old 파일은 결과와 채운 값(출처 표)을 그 자리에서 고칠 수 있다.
"use client";

import { ArrowRight, Loader2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { DocStatusPill, getDocReason } from "@/components/documents/doc-status";
import { AiSuggestChip } from "@/components/documents/ai-suggest-chip";
import { LayoutLabel } from "@/components/documents/layout-picto";
import { InlineText } from "@/components/inline-text";
import { Modal } from "@/components/modal";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { VersionInput } from "@/components/ui/version-input";
import { humanizeApiError } from "@/lib/api-errors";
import { getToBe, LANGUAGE_LAYOUTS, updateDocument, uploadDocument, type DocumentUpdateInput, type SopDocument, type TargetDocType } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { getStageHref } from "@/lib/stages";
import { guessUploadSide, planNewUpload, readFileCode, type NewUploadPlan, type UploadSide } from "@/lib/upload-model";
import { useLoaded } from "@/lib/use-loaded";

/** 고른 파일 한 줄 - side가 null이면 앱이 고른 쪽을 쓴다(사람이 누르면 그 값) */
interface PickedFile {
  file: File;
  side: UploadSide | null;
  docType: TargetDocType;
  parentCode: string;
}

interface UploadRow {
  name: string;
  side: UploadSide;
  state: "waiting" | "uploading" | "done" | "error";
  document?: SopDocument;
  error?: unknown;
  /** 서버가 채운 칸의 출처 - 사람이 고친 칸은 지운다 */
  sources?: Partial<Record<PrefillField, PrefillSource>>;
}

type PrefillField = "doc_code" | "doc_version" | "language_layout";
type PrefillSource = "file_name" | "content" | "ai";

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

function pickFiles(files: Iterable<File>): PickedFile[] {
  return Array.from(files, (file) => ({ file, side: null, docType: "sop", parentCode: "" }));
}

export function UploadModal({ bundleId, initialFiles = [], onClose, onUploaded, latest = [] }: UploadModalProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile[]>(() => pickFiles(initialFiles));
  const [rows, setRows] = useState<UploadRow[] | null>(null);
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

  function patchPicked(index: number, patch: Partial<PickedFile>) {
    setPicked((prev) => prev.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  }

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
    setRows(queue.map((item): UploadRow => ({ name: item.file.name, side: item.side, state: "waiting" })));
    // 동시에 올리면 서버 파싱 자리(최대 2)를 다투므로 차례로 올린다
    for (const [index, item] of queue.entries()) {
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
  const footer =
    rows === null ? (
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

  function renderPlan(index: number) {
    const item = picked[index];
    const { plan, code } = plans[index];
    if (plan === null) return <span className="text-xs text-ink-3">{t("upload.oldNote")}</span>;
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
        <span className="text-xs text-ink-3">{code === "" ? t("upload.createNoCode") : t("upload.createNote", { code })}</span>
        <Select
          testId={`upload-kind-${index}`}
          ariaLabel={t("documents.docType")}
          size="sm"
          value={item.docType}
          options={[
            { value: "sop", label: "SOP" },
            { value: "wi", label: "WI" },
          ]}
          onChange={(docType) => patchPicked(index, { docType, parentCode: docType === "wi" ? item.parentCode : "" })}
        />
        {item.docType === "wi" &&
          (sopCodes.length > 0 ? (
            <Select
              testId={`upload-parent-${index}`}
              ariaLabel={t("documents.parentCode")}
              size="sm"
              mono
              value={item.parentCode}
              options={[{ value: "", label: t("upload.pickParent") }, ...sopCodes.map((sop) => ({ value: sop, label: sop }))]}
              onChange={(parentCode) => patchPicked(index, { parentCode })}
            />
          ) : (
            <span className="text-xs text-danger">{t("upload.why.noSop")}</span>
          ))}
      </span>
    );
  }

  return (
    <Modal title={t("documents.upload")} onClose={onClose} isBusy={running} testId="upload" footer={footer} size="xl">
      {rows === null ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".docx,.pdf"
              data-testid="upload-files"
              className="sr-only"
              onChange={(event) => {
                setPicked(pickFiles(event.target.files ?? []));
                // 같은 파일을 다시 고를 수 있게 비운다
                event.target.value = "";
              }}
            />
            <button type="button" className="btn" data-testid="upload-pick" onClick={() => fileRef.current?.click()}>
              <Upload size={16} strokeWidth={1.5} aria-hidden />
              {t("documents.pickFiles")}
            </button>
            <p className="text-xs text-ink-3">{t("documents.pickHint")}</p>
          </div>
          {picked.length > 0 && (
            <ul className="upload-picked" data-testid="upload-picked">
              {picked.map((item, index) => (
                <li key={`${item.file.name}:${index}`} className="upload-picked-row" data-testid={`upload-picked-${index}`}>
                  <span className="min-w-0 truncate font-mono text-xs text-ink">{item.file.name}</span>
                  {/* Old | New - 눌린 쪽이 올라갈 곳이다. 앱이 먼저 고르고 사람이 뒤집는다 */}
                  <span className="view-toggle upload-side" role="group" aria-label={t("upload.side")}>
                    {(["old", "new"] as const).map((side) => (
                      <button key={side} type="button" aria-pressed={plans[index].side === side} data-testid={`upload-side-${index}-${side}`} onClick={() => patchPicked(index, { side })}>
                        {t(`upload.side.${side}`)}
                      </button>
                    ))}
                  </span>
                  <span className="min-w-0">{renderPlan(index)}</span>
                  <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("upload.remove")} data-testid={`upload-remove-${index}`} onClick={() => setPicked((prev) => prev.filter((_, at) => at !== index))}>
                    <X size={14} strokeWidth={1.5} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="upload-results" data-testid="upload-results">
          <div className="upload-row head">
            <span>{t("documents.file")}</span>
            <span>{t("documents.colCode")}</span>
            <span>{t("documents.colVersion")}</span>
            <span>{t("documents.colLayout")}</span>
          </div>
          {rows.map((row, index) => {
            const document = row.state === "done" ? row.document : undefined;
            const aiMeta = document ? latest.find((item) => item.id === document.id)?.ai_meta : undefined;
            // New 문서의 번호는 목록 줄의 번호다 - 여기서 고치지 않는다(목록에서 고친다)
            const editable = document?.status === "ready" && row.side === "old";
            return (
              <div key={`${row.name}:${index}`} className="upload-row" data-testid={`upload-row-${index}`}>
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="tag flex-none">{t(`upload.side.${row.side}`)}</span>
                    <span className="block min-w-0 truncate font-mono text-xs">{row.name}</span>
                  </span>
                  {row.state === "uploading" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                      <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden />
                      {t("documents.reading")}
                    </span>
                  ) : document ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <DocStatusPill status={document.status} />
                      {document.status !== "ready" && <span className="text-xs text-danger">{getDocReason(document, t)}</span>}
                    </span>
                  ) : row.state === "error" ? (
                    <span className="text-xs text-danger">{humanizeApiError(row.error, t)}</span>
                  ) : (
                    <span className="text-xs text-ink-4">{t("documents.waiting")}</span>
                  )}
                </span>
                {document && editable ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <span className={document?.doc_code ? "font-mono text-xs" : "text-ink-4"} data-testid={`upload-row-${index}-listed`}>
                      {document?.doc_code || "–"}
                    </span>
                    <span className="text-ink-4">–</span>
                    <span className="text-ink-4">–</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
