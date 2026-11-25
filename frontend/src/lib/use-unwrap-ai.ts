// 벗긴 표 AI 순서 제안(B11) 상태 - 제안 불러오기 · 작업 중 칩 · 요청 · 놓기 · 그대로 두기. 용지 머리(paper.tsx strips.unwrap.ai)가 받는 값 한 덩이를 만든다.
// 작업 중 칩은 이 묶음 상태(/ai/status)의 unwrap_order 끝난 작업 수가 요청 기준에 닿으면 걷힌다(lib/unwrap-ai-model) - 성공 · 실패 모두.
"use client";

import { useMemo, useState } from "react";

import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { listAppliedSuggestions, requestUnwrapOrder, setSuggestionAdoption } from "@/lib/api-manage";
import type { AiJobCounts, AiStatus } from "@/lib/api-sop";
import { addUnwrapAiAsk, keepSamePreviews, listUnwrapAiBusy, type UnwrapAiAsk } from "@/lib/unwrap-ai-model";
import { useLoaded } from "@/lib/use-loaded";

export interface UnwrapAiStrip {
  enabled: boolean;
  busy: ReadonlySet<number>;
  previews: ReadonlyMap<number, readonly number[]>;
  onAsk: (tableId: number) => void;
  onApply: (tableId: number, order: readonly number[]) => void;
  onKeep: (tableId: number, isSame: boolean) => void;
}

interface UseUnwrapAiArgs {
  bundleId: number;
  /** 보는 Old 문서 - 없으면 제안을 불러오지 않는다 */
  docId: number | null;
  isOn: boolean;
  status: AiStatus | null;
  /** 문서 · 단위를 다시 받을 때마다 바뀌는 값 - 작업이 끝나 화면이 다시 받으면 제안도 다시 읽는다 */
  dataKey: string;
  watch: () => void;
  /** 순서 편집 한 번(되돌리기 한 칸) - afterOk는 서버가 받아들인 뒤에만 불린다 */
  reorder: (tableId: number, order: number[], afterOk: () => Promise<void>) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

function countFinished(counts: AiJobCounts | undefined): number {
  return counts ? counts.done + counts.failed + counts.stale + counts.cancelled : 0;
}

export function useUnwrapAi({ bundleId, docId, isOn, status, dataKey, watch, reorder, t }: UseUnwrapAiArgs): UnwrapAiStrip {
  const [asks, setAsks] = useState<UnwrapAiAsk[]>([]);
  const suggestions = useLoaded(() => (isOn && docId !== null ? listAppliedSuggestions(bundleId, "unwrap_order", docId) : Promise.resolve([])), `${isOn}:${docId}:${dataKey}`);
  const finished = countFinished(status?.by_kind?.unwrap_order);
  const busy = useMemo(() => listUnwrapAiBusy(asks, finished), [asks, finished]);
  // 표마다 아직 정하지 않은(adoption 없음) 가장 새 제안
  const live = useMemo(() => {
    const map = new Map<number, { id: number; order: number[] }>();
    for (const item of [...(suggestions.data ?? [])].sort((a, b) => a.id - b.id)) {
      const tableId = item.content.table_id;
      const order = item.content.unit_ids;
      if (item.adoption === null && typeof tableId === "number" && Array.isArray(order)) map.set(tableId, { id: item.id, order });
    }
    return map;
  }, [suggestions.data]);
  // 다시 받은 제안이 앞과 같으면 같은 값 - 렌더 중 상태 맞추기(이펙트 없음, useNumberArrival과 같은 꼴)
  const loaded = useMemo<UnwrapAiStrip["previews"]>(() => new Map([...live].map(([tableId, item]) => [tableId, item.order])), [live]);
  const [kept, setKept] = useState(loaded);
  const previews = keepSamePreviews(kept, loaded);
  if (previews !== kept) setKept(previews);

  async function record(tableId: number, adoption: "as_is" | "rejected") {
    const item = live.get(tableId);
    if (!item) return;
    try {
      await setSuggestionAdoption(bundleId, item.id, adoption);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      suggestions.reload();
    }
  }

  async function ask(tableId: number) {
    if (docId === null) return;
    try {
      const result = await requestUnwrapOrder(bundleId, { document_id: docId, table_id: tableId });
      if (result.queued > 0) setAsks((prev) => addUnwrapAiAsk(prev, tableId, finished));
      showToast(result.queued > 0 ? t("assign.unwrapAi.queued") : t("assign.unwrapAi.already"));
      watch();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }

  return {
    enabled: isOn,
    busy,
    previews,
    onAsk: (tableId) => void ask(tableId),
    onApply: (tableId, order) => reorder(tableId, [...order], () => record(tableId, "as_is")),
    onKeep: (tableId, isSame) => void record(tableId, isSame ? "as_is" : "rejected"),
  };
}
