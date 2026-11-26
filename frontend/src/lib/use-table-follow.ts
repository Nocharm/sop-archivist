// 한글 표처럼 하기(11-23 명세 D2-R8 · R9) 상태 - 벗긴 영어 Old 표마다 서버의 규칙 제안 읽기 · 적용 · 하나씩 보기 · 그대로 두기, 규칙이 못 푸는 표는 AI 제안 요청 · 받기.
// 용지 머리(paper.tsx strips.unwrap.follow.plan)가 받는 값 한 덩이를 만든다. 규칙 제안은 저장되지 않아(D2-R7) 문서가 바뀔 때마다 다시 읽고,
// AI 제안은 ai_suggestions에 있어 같은 칩 · 적용을 쓰되 적용은 채택(as_is) · 그대로 두기는 버림(rejected)을 남긴다.
"use client";

import { useMemo, useState } from "react";

import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { listAppliedSuggestions, requestTableFollow, setSuggestionAdoption } from "@/lib/api-manage";
import { getTableFollow, type AiJobCounts, type AiStatus, type AiSuggestion, type EditOp, type TableFollow } from "@/lib/api-sop";
import { buildFollowOp, readFollowSuggestion } from "@/lib/table-follow-model";
import { addUnwrapAiAsk, listUnwrapAiBusy, type UnwrapAiAsk } from "@/lib/unwrap-ai-model";
import { useLoaded } from "@/lib/use-loaded";

export interface TableFollowStrip {
  /** 표마다 보일 제안 - 규칙 제안(칩이 있는 것)과 살아 있는 AI 제안. 그대로 두기로 감춘 표는 빠진다 */
  plans: ReadonlyMap<number, TableFollow>;
  /** 하나씩 보기를 연 표 - 줄마다 칩 옆에 적용 단추 */
  each: ReadonlySet<number>;
  onApply: (tableId: number, only?: readonly number[]) => void;
  onEach: (tableId: number) => void;
  onKeep: (tableId: number) => void;
  /** 다시 읽기 - 삭제만 한 적용은 revision이 그대로라 열쇠가 바뀌지 않는다 */
  reload: () => void;
  /** AI로 따라 하기 - asks는 규칙이 못 푸는데 아직 받은 제안이 없는 표(머리에 "✦ AI로 따라 하기"), busy는 작업 중인 표. enabled가 거짓이면 꺼진 단추 + 까닭 */
  ai: { enabled: boolean; asks: ReadonlySet<number>; busy: ReadonlySet<number>; onAsk: (tableId: number) => void };
}

interface UseTableFollowArgs {
  bundleId: number;
  /** 보는 Old 문서 - 없으면 읽지 않는다 */
  docId: number | null;
  /** 짝을 물을 벗긴 영어 표(table-follow-model listFollowTableIds) - 고칠 수 없으면 빈 목록 */
  tableIds: readonly number[];
  /** 문서 · 판단이 바뀔 때마다 바뀌는 값 - 한글 표를 손대면 제안도 다시 읽는다 */
  dataKey: string;
  /** 편집 한 번(되돌리기 한 칸) - 큐를 지난다. afterOk는 서버가 받아들인 뒤에만 불린다 */
  apply: (tableId: number, op: Extract<EditOp, { type: "follow_table" }>, afterOk?: () => Promise<void>) => void;
  isAiOn: boolean;
  status: AiStatus | null;
  watch: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const NO_PLANS: ReadonlyMap<number, TableFollow> = new Map();

function countFinished(counts: AiJobCounts | undefined): number {
  return counts ? counts.done + counts.failed + counts.stale + counts.cancelled : 0;
}

export function useTableFollow({ bundleId, docId, tableIds, dataKey, apply, isAiOn, status, watch, t }: UseTableFollowArgs): TableFollowStrip {
  const loaded = useLoaded(
    async () => {
      if (docId === null || tableIds.length === 0) return NO_PLANS;
      const answers = await Promise.all(tableIds.map(async (tableId) => [tableId, await getTableFollow(bundleId, docId, tableId)] as const));
      return new Map(answers);
    },
    `${docId}:${tableIds.join(",")}:${dataKey}`,
  );
  const [asked, setAsked] = useState<UnwrapAiAsk[]>([]);
  const finished = countFinished(status?.by_kind?.table_follow);
  const busy = useMemo(() => listUnwrapAiBusy(asked, finished), [asked, finished]);
  // 끝난 작업 수가 바뀌면 제안도 다시 읽는다 - 작업이 끝나 화면이 다시 받지 않아도 새 제안이 보인다
  const suggestions = useLoaded(
    () => (isAiOn && docId !== null && tableIds.length > 0 ? listAppliedSuggestions(bundleId, "table_follow", docId) : Promise.resolve([])),
    `${isAiOn}:${docId}:${tableIds.join(",")}:${dataKey}:${finished}`,
  );
  // 그대로 두기 - 규칙 제안은 이 화면에서만 감춘다(저장하지 않는다, D2-R7). AI 제안은 채택(버림)을 남겨 다시 읽으면 빠진다
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set());
  const [each, setEach] = useState<ReadonlySet<number>>(new Set());
  const { plans, suggestionIds, asks } = useMemo(() => {
    const newest = new Map<number, AiSuggestion>();
    for (const item of [...(suggestions.data ?? [])].sort((a, b) => a.id - b.id)) {
      const tableId = item.content.table_id;
      if (item.adoption === null && typeof tableId === "number") newest.set(tableId, item);
    }
    const map = new Map<number, TableFollow>();
    const ids = new Map<number, number>();
    const ask = new Set<number>();
    for (const [tableId, answer] of loaded.data ?? NO_PLANS) {
      if (answer.mode === "rule" && answer.count > 0 && !kept.has(tableId)) {
        map.set(tableId, answer);
      } else if (answer.mode === "ai") {
        const item = newest.get(tableId);
        const plan = item === undefined ? null : readFollowSuggestion(item, answer.lines);
        if (item !== undefined && plan !== null) {
          map.set(tableId, plan);
          ids.set(tableId, item.id);
        } else {
          ask.add(tableId);
        }
      }
    }
    return { plans: map, suggestionIds: ids, asks: ask };
  }, [loaded.data, suggestions.data, kept]);

  function toggle(set: ReadonlySet<number>, tableId: number): ReadonlySet<number> {
    const next = new Set(set);
    if (!next.delete(tableId)) next.add(tableId);
    return next;
  }

  async function record(tableId: number, adoption: "as_is" | "rejected") {
    const id = suggestionIds.get(tableId);
    if (id === undefined) return;
    try {
      await setSuggestionAdoption(bundleId, id, adoption);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      suggestions.reload();
    }
  }

  async function ask(tableId: number) {
    if (docId === null) return;
    try {
      const result = await requestTableFollow(bundleId, { document_id: docId, table_id: tableId });
      if (result.queued > 0) setAsked((prev) => addUnwrapAiAsk(prev, tableId, finished));
      showToast(result.queued > 0 ? t("assign.follow.ai.queued") : t("assign.follow.ai.already"));
      watch();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }

  return {
    plans,
    each,
    onApply: (tableId, only) => {
      const plan = plans.get(tableId);
      if (plan === undefined) return;
      // 다 적용하면 AI 제안은 채택(as_is)을 남긴다 - 한 줄씩 적용하는 동안은 열어 둔다
      const afterOk = plan.mode === "ai" && only === undefined ? () => record(tableId, "as_is") : undefined;
      apply(tableId, buildFollowOp(tableId, plan.items, only, plan.lines), afterOk);
    },
    onEach: (tableId) => setEach((prev) => toggle(prev, tableId)),
    onKeep: (tableId) => {
      const plan = plans.get(tableId);
      if (plan?.mode === "ai") void record(tableId, plan.count === 0 ? "as_is" : "rejected");
      else setKept((prev) => new Set(prev).add(tableId));
    },
    reload: loaded.reload,
    ai: { enabled: isAiOn, asks, busy, onAsk: (tableId) => void ask(tableId) },
  };
}
