// 쪼개기 화면의 AI 상태 한 벌 - 문서 위 막대(요청·대기 수)와 오른쪽 패널(고른 단위의 제안)이 같은 값을 쓴다.
// AI는 제안만 한다: 적용은 사람이 누르는 편집(split)이고, 채택 기록(as_is·rejected)은 나누기에서만 사람이 직접 남긴다(계획 2 API 계약).
"use client";

import { useState } from "react";

import { showToast } from "@/components/ui/toast";

import { humanizeApiError } from "./api-errors";
import { listAppliedSuggestions, requestAi, setSuggestionAdoption, type AiKind, type AiRequestOut } from "./api-manage";
import { editUnits, type AiSuggestion, type EditResult, type ViewUnit } from "./api-sop";
import { useI18n } from "./i18n";
import { useAiJobs } from "./use-ai-jobs";
import { useLoaded } from "./use-loaded";

export type SplitAiWork = "split" | "pair" | "apply" | "reject";

/** 방금 보낸 요청의 결과 - 보낸 수와 건너뛴 까닭별 수를 사람이 닫을 때까지 보인다 */
export interface SplitAiRequestResult {
  kind: "split" | "pair";
  docId: number;
  out: AiRequestOut;
}

export interface SplitAi {
  isOn: boolean;
  /** 대기·실행 중인 나누기·짝 작업 수 */
  running: number;
  isStale: boolean;
  working: SplitAiWork | null;
  lastRequest: SplitAiRequestResult | null;
  clearLastRequest: () => void;
  /** 이 단위에 걸린, 아직 정하지 않은 제안 */
  findSuggestion: (unit: ViewUnit | null) => AiSuggestion | null;
  ask: (kind: Extract<AiKind, "split" | "pair">) => Promise<void>;
  apply: (unit: ViewUnit, suggestion: AiSuggestion) => Promise<void>;
  reject: (suggestion: AiSuggestion) => Promise<void>;
}

/** 제안의 자를 위치 - 응답 JSON이라 숫자만 골라 쓴다 */
export function readSplitOffsets(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

/** onChanged: 나누기를 적용했거나(결과) 제안·작업 상태가 달라졌다(null) - 화면이 문서를 다시 읽는다 */
export function useSplitAi(bundleId: number, docId: number | null, revision: number | null, onChanged: (result: EditResult | null) => void): SplitAi {
  const { t } = useI18n();
  const [round, setRound] = useState(0);
  const [working, setWorking] = useState<SplitAiWork | null>(null);
  const [lastRequest, setLastRequest] = useState<SplitAiRequestResult | null>(null);
  const jobs = useAiJobs(bundleId, () => {
    setRound((value) => value + 1);
    onChanged(null);
  });
  const isOn = jobs.status?.ai_enabled === true;
  const suggestions = useLoaded(
    () => (docId === null || revision === null || !isOn ? Promise.resolve([]) : listAppliedSuggestions(bundleId, "split", docId)),
    `${docId}:${round}:${revision}:${isOn}`,
  );
  const byKind = jobs.status?.by_kind;
  const running = (byKind?.split?.queued ?? 0) + (byKind?.split?.running ?? 0) + (byKind?.pair?.queued ?? 0) + (byKind?.pair?.running ?? 0);

  async function ask(kind: Extract<AiKind, "split" | "pair">) {
    if (docId === null) return;
    setWorking(kind);
    try {
      const out = await requestAi(bundleId, kind, { document_id: docId });
      setLastRequest({ kind, docId, out });
      jobs.watch();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setWorking(null);
    }
  }

  async function apply(unit: ViewUnit, suggestion: AiSuggestion) {
    if (docId === null || revision === null) return;
    setWorking("apply");
    try {
      // 뒤쪽 위치부터 자르면 앞 조각의 위치가 바뀌지 않는다 - 매번 왼쪽 조각(새 ID)을 다음 대상으로 삼는다
      let unitId = unit.id;
      let docRevision = revision;
      let last: EditResult | null = null;
      for (const at of readSplitOffsets(suggestion.content.offsets).sort((a, b) => b - a)) {
        last = await editUnits(bundleId, docId, docRevision, { type: "split", unit_id: unitId, at });
        docRevision = last.document_revision;
        unitId = last.created_unit_ids[0] ?? unitId;
      }
      await setSuggestionAdoption(bundleId, suggestion.id, "as_is");
      setRound((value) => value + 1);
      onChanged(last);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      onChanged(null);
    } finally {
      setWorking(null);
    }
  }

  async function reject(suggestion: AiSuggestion) {
    setWorking("reject");
    try {
      await setSuggestionAdoption(bundleId, suggestion.id, "rejected");
      setRound((value) => value + 1);
      // 용지의 제안 표시는 문서 보기에서 온다
      onChanged(null);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setWorking(null);
    }
  }

  return {
    isOn,
    running,
    isStale: jobs.error !== null,
    working,
    lastRequest: lastRequest !== null && lastRequest.docId === docId ? lastRequest : null,
    clearLastRequest: () => setLastRequest(null),
    findSuggestion: (unit) => (unit ? (suggestions.data ?? []).filter((item) => item.content.unit_id === unit.id && item.adoption === null).at(-1) ?? null : null),
    ask,
    apply,
    reject,
  };
}
