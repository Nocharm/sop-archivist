// 새 문서 목록 AI 읽기 - 템플릿에 맞지 않는 계획 파일(Excel·Word·글)이나 붙여 넣은 글을 보내면 AI가 새 문서 목록을 읽어 제안한다.
// AI는 제안만 한다: 미리 보기 표에서 사람이 줄을 고르고 고친 뒤 Add를 눌러야 목록에 들어간다. 이미 목록에 있는 번호는 기본으로 빠져 있다.
// 창을 닫아도 제안은 남는다 - 목록 머리의 표시로 다시 연다. AI가 꺼져 있으면 이 창으로 오는 길이 없다.
"use client";

import { FileUp, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Modal } from "@/components/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { closeToBeRead, getToBe, putToBe, requestToBeRead, type TargetDocType, type ToBe, type ToBeProposal } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { buildProposalInput, buildProposalRows, decideProposalAdoption, decideReadWait, findProposalProblem, listParentChoices, orderProposalWrites, type ProposalRow, type ReadWait } from "@/lib/tobe-proposal-model";
import { INPUT_FIELD } from "@/lib/ui-classes";

// 제안이 왔는지 다시 보는 간격(ms) - 읽기는 보통 몇 초다
const POLL_MS = 1500;
const ACCEPT = ".xlsx,.docx,.txt,.csv,.md";

interface ListReaderProps {
  bundleId: number;
  /** 지금 목록 - 상위 SOP로 고를 수 있는 번호를 안다 */
  tobe: ToBe;
  /** 아직 정하지 않은 제안 - 있으면 미리 보기로 연다 */
  proposal: ToBeProposal | null;
  /** 이 묶음에서 멈춘 읽기 작업 수(실패·반영 안 됨·취소) - 기다리는 동안 늘면 이번 읽기가 실패한 것이다 */
  stoppedJobs: number;
  onClose: () => void;
  /** 줄을 더했다 - 목록을 다시 받는다 */
  onListChanged: () => void;
  /** 제안을 다시 받는다(요청 뒤 기다릴 때, 닫은 뒤) */
  onProposalChanged: () => void;
  /** AI 작업을 쌓았다 - 상단 바의 작업 표시가 따라오게 한다 */
  onRequested: () => void;
}

export function ListReader({ bundleId, tobe, proposal, stoppedJobs, onClose, onListChanged, onProposalChanged, onRequested }: ListReaderProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // 요청을 보낸 뒤 - 그때 있던 제안(없으면 0)보다 새 제안이 오거나 읽기 작업이 멈출 때까지 기다린다
  const [wait, setWait] = useState<ReadWait | null>(null);
  const [isAskingAgain, setIsAskingAgain] = useState(false);
  // 미리 보기에서 고친 줄 - 제안에 묶인다(새 제안이 오면 저절로 버려진다)
  const [edit, setEdit] = useState<{ id: number; rows: ProposalRow[] } | null>(null);

  const waitState = decideReadWait(wait, proposal?.suggestion_id ?? null, stoppedJobs);
  const isWaiting = waitState === "waiting";
  const shown = !isWaiting && !isAskingAgain ? proposal : null;
  const rows = shown === null ? null : edit?.id === shown.suggestion_id ? edit.rows : buildProposalRows(shown);
  const listedSops = tobe.docs.filter((doc) => doc.doc_type === "sop").map((doc) => doc.code);
  const problem = rows === null ? null : findProposalProblem(rows, listedSops);
  const parentChoices = rows === null ? [] : listParentChoices(rows, listedSops);
  const pickedCount = rows?.filter((row) => row.isPicked).length ?? 0;

  const pollProposal = useEffectEvent(() => onProposalChanged());
  useEffect(() => {
    if (!isWaiting) return;
    const timer = window.setInterval(pollProposal, POLL_MS);
    return () => window.clearInterval(timer);
  }, [isWaiting]);

  function patchRow(code: string, patch: Partial<ProposalRow>) {
    if (shown === null || rows === null) return;
    setEdit({ id: shown.suggestion_id, rows: rows.map((row) => (row.code === code ? { ...row, ...patch } : row)) });
  }

  function changeType(row: ProposalRow, next: TargetDocType) {
    // 종류가 바뀌면 그 종류에 없는 값은 비운다(SOP에는 상위·단계가 없고 WI에는 장비 SOP 표시가 없다)
    patchRow(row.code, next === "sop" ? { doc_type: "sop", parent_code: null, steps: [] } : { doc_type: "wi", is_equipment_sop: false, parent_code: row.parent_code ?? parentChoices.find((code) => code !== row.code) ?? null });
  }

  async function handleRead() {
    const source = file !== null ? { file } : text.trim() !== "" ? { text } : null;
    if (source === null) return;
    setBusy(true);
    try {
      const sent = await requestToBeRead(bundleId, source);
      if (sent.truncated) showToast(t("tobe.read.truncatedSent"));
      setWait({ after: proposal?.suggestion_id ?? 0, stopped: stoppedJobs });
      setIsAskingAgain(false);
      onRequested();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (shown === null || rows === null || problem !== null) return;
    setBusy(true);
    try {
      // 지금 목록을 새로 받아 고른 줄을 더한 전체를 한 번에 보낸다 - 다 들어가거나 하나도 안 들어간다(줄마다 보내면 200줄에 1분이 걸렸다)
      await putToBe(bundleId, buildProposalInput(await getToBe(bundleId), rows));
      await closeToBeRead(bundleId, shown.suggestion_id, decideProposalAdoption(shown, rows));
      showToast(t("tobe.added", { n: orderProposalWrites(rows).length }));
      onListChanged();
      onProposalChanged();
      onClose();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      // 그 사이 목록이 바뀌어 거절됐을 수 있다 - 다시 받아 둔다
      onListChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard(askAgain: boolean) {
    if (shown === null) return;
    setBusy(true);
    try {
      await closeToBeRead(bundleId, shown.suggestion_id, "rejected");
      onProposalChanged();
      if (askAgain) setIsAskingAgain(true);
      else onClose();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setBusy(false);
    }
  }

  const canRead = file !== null || text.trim() !== "";
  const footer = isWaiting ? (
    <button type="button" className="btn" data-testid="tobe-read-close" onClick={onClose}>
      {t("common.close")}
    </button>
  ) : shown === null ? (
    <>
      <button type="button" className="btn" data-testid="tobe-read-cancel" disabled={busy} onClick={onClose}>
        <X size={16} strokeWidth={1.5} aria-hidden />
        {t("common.cancel")}
      </button>
      <button type="button" className="btn pri" data-testid="tobe-read-submit" disabled={!canRead || busy} onClick={() => void handleRead()}>
        <Sparkles size={16} strokeWidth={1.5} aria-hidden />
        {t("tobe.read.submit")}
      </button>
    </>
  ) : (
    <>
      <button type="button" className="btn" data-testid="tobe-read-discard" disabled={busy} onClick={() => void handleDiscard(false)}>
        <Trash2 size={16} strokeWidth={1.5} aria-hidden />
        {t("tobe.read.discard")}
      </button>
      {shown.invalid || shown.docs.length === 0 ? (
        <button type="button" className="btn pri" data-testid="tobe-read-again" disabled={busy} onClick={() => void handleDiscard(true)}>
          {t("tobe.read.again")}
        </button>
      ) : (
        <button type="button" className="btn pri" data-testid="tobe-read-add" disabled={busy || problem !== null} onClick={() => void handleAdd()}>
          {t("tobe.read.add", { n: pickedCount })}
        </button>
      )}
    </>
  );

  return (
    <Modal title={t("tobe.read.title")} onClose={onClose} isBusy={busy} testId="tobe-read" footer={footer} size="xl">
      {isWaiting ? (
        <div className="grid justify-items-center gap-2 py-8 text-center" data-testid="tobe-read-waiting">
          <Loader2 size={22} strokeWidth={1.5} className="animate-spin text-st-ai" aria-hidden />
          <p className="text-sm text-ink">{t("tobe.read.waiting")}</p>
          <p className="max-w-[46ch] text-xs text-ink-3">{t("tobe.read.waitingNote")}</p>
        </div>
      ) : shown === null || rows === null ? (
        <div className="space-y-3" data-testid="tobe-read-ask">
          {/* 읽기가 실패했다 - 넣은 파일·글은 그대로 두어 바로 다시 보낼 수 있다 */}
          {waitState === "stopped" && (
            <p className="text-[13px] leading-5 text-danger" role="alert" data-testid="tobe-read-stopped">
              {t("tobe.read.stopped")}
            </p>
          )}
          <p className="text-[13px] leading-5 text-ink-2">{t("tobe.read.lead")}</p>
          <div className="space-y-1">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              data-testid="tobe-read-file"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn" data-testid="tobe-read-pick" disabled={busy} onClick={() => fileRef.current?.click()}>
                <FileUp size={16} strokeWidth={1.5} aria-hidden />
                {t("tobe.read.pick")}
              </button>
              {file && (
                <span className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-ink-2" data-testid="tobe-read-picked">
                  <span className="truncate">{file.name}</span>
                  <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("upload.remove")} data-testid="tobe-read-unpick" onClick={() => setFile(null)}>
                    <X size={14} strokeWidth={1.5} aria-hidden />
                  </button>
                </span>
              )}
            </div>
            <p className="text-xs text-ink-3">{t("tobe.read.pickHint")}</p>
          </div>
          <label className="grid gap-1">
            <span className="text-xs text-ink-2">{t("tobe.read.paste")}</span>
            <textarea
              className={`${INPUT_FIELD} min-h-[132px] resize-y py-1.5 font-mono text-xs leading-5`}
              data-testid="tobe-read-text"
              value={text}
              placeholder={t("tobe.read.pastePlaceholder")}
              // 파일을 골랐으면 파일을 보낸다 - 둘 다 보내지 않는다
              disabled={busy || file !== null}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <p className="text-xs text-ink-3">{t("tobe.read.promise")}</p>
        </div>
      ) : shown.invalid || shown.docs.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-2" data-testid="tobe-read-empty">
          {t(shown.invalid ? "tobe.read.invalid" : "tobe.read.none")}
        </p>
      ) : (
        <div className="space-y-2" data-testid="tobe-read-preview">
          <p className="text-[13px] leading-5 text-ink-2">{t("tobe.read.previewLead")}</p>
          {shown.truncated && (
            <p className="text-xs text-st-hold" data-testid="tobe-read-truncated">
              {t("tobe.read.truncated")}
            </p>
          )}
          {/* 줄이 많아도 창이 화면 안에 남게 표만 스크롤한다 - 아래 단추(더하기·버리기)가 늘 보인다. 표 머리는 붙어 있다 */}
          <div className="max-h-[min(560px,calc(100vh-340px))] overflow-y-auto rounded-md border border-line" data-testid="tobe-read-scroll">
          <table className="dtable w-full" data-testid="tobe-read-list">
            <thead>
              <tr>
                <th className="w-8" aria-label={t("tobe.read.colPick")} />
                {/* 번호 칸은 13자 번호가 한 줄에 드는 폭을 지킨다 - 좁아지면 번호가 서너 줄로 접혀 줄이 길어진다 */}
                <th className="w-40 min-w-[136px]">{t("tobe.colCode")}</th>
                <th className="min-w-[180px]">{t("tobe.colTitle")}</th>
                <th className="w-24">{t("tobe.colType")}</th>
                <th className="w-40">{t("tobe.colParent")}</th>
                <th className="w-20 whitespace-normal">{t("tobe.colEquipment")}</th>
                <th className="w-14">{t("tobe.read.colSteps")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOff = row.isListed || !row.isPicked;
                const prefix = `tobe-read-${row.code}`;
                return (
                  <tr key={row.code} data-testid={`${prefix}-row`} className={isOff ? "text-ink-3" : undefined}>
                    <td>
                      <Checkbox testId={`${prefix}-pick`} ariaLabel={t("tobe.read.colPick")} checked={row.isPicked} disabled={row.isListed || busy} onChange={(next) => patchRow(row.code, { isPicked: next })} />
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[13px]">{row.code}</span>
                        {row.isListed && (
                          <span className="tag flex-none" data-testid={`${prefix}-listed`}>
                            {t("tobe.read.listed")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td>
                      <input className={INPUT_FIELD} data-testid={`${prefix}-title`} value={row.title} maxLength={500} aria-label={t("tobe.colTitle")} disabled={isOff || busy} onChange={(event) => patchRow(row.code, { title: event.target.value })} />
                    </td>
                    <td>
                      <Select
                        testId={`${prefix}-type`}
                        ariaLabel={t("tobe.colType")}
                        size="sm"
                        className="w-full"
                        value={row.doc_type ?? ""}
                        disabled={isOff || busy}
                        options={[...(row.doc_type === null ? [{ value: "" as const, label: t("tobe.read.pickType") }] : []), { value: "sop" as const, label: "SOP" }, { value: "wi" as const, label: "WI" }]}
                        onChange={(next) => next !== "" && changeType(row, next)}
                      />
                    </td>
                    <td>
                      {row.doc_type === "wi" ? (
                        <Select
                          testId={`${prefix}-parent`}
                          ariaLabel={t("tobe.colParent")}
                          size="sm"
                          mono
                          className="w-full"
                          value={row.parent_code ?? ""}
                          disabled={isOff || busy}
                          options={[...(row.parent_code === null ? [{ value: "", label: t("upload.pickParent") }] : []), ...parentChoices.filter((code) => code !== row.code).map((code) => ({ value: code, label: code }))]}
                          onChange={(next) => next !== "" && patchRow(row.code, { parent_code: next })}
                        />
                      ) : (
                        <span className="text-ink-4">–</span>
                      )}
                    </td>
                    <td>
                      {row.doc_type === "sop" ? (
                        <Checkbox testId={`${prefix}-equipment`} ariaLabel={t("tobe.colEquipment")} checked={row.is_equipment_sop} disabled={isOff || busy} onChange={(next) => patchRow(row.code, { is_equipment_sop: next })} />
                      ) : (
                        <span className="text-ink-4">–</span>
                      )}
                    </td>
                    <td className="tabular-nums">{row.doc_type === "wi" ? row.steps.length : <span className="text-ink-4">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {problem !== null && (
            <p className="text-xs text-danger" data-testid="tobe-read-problem">
              {problem.kind === "none" ? t("tobe.read.problemNone") : t(problem.kind === "type" ? "tobe.read.problemType" : "tobe.read.problemParent", { code: problem.code })}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
