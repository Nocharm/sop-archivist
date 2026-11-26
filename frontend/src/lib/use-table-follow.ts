// 한글 표처럼 하기(11-23 명세 D2-R8) 상태 - 벗긴 영어 Old 표마다 서버의 규칙 제안 읽기 · 적용 · 하나씩 보기 · 그대로 두기.
// 용지 머리(paper.tsx strips.unwrap.follow.plan)가 받는 값 한 덩이를 만든다. 제안은 저장되지 않아(D2-R7) 문서가 바뀔 때마다 다시 읽는다.
"use client";

import { useMemo, useState } from "react";

import { getTableFollow, type EditOp, type TableFollow } from "@/lib/api-sop";
import { buildFollowOp } from "@/lib/table-follow-model";
import { useLoaded } from "@/lib/use-loaded";

export interface TableFollowStrip {
  /** 표마다 보일 규칙 제안 - 그대로 두기로 감춘 표와 칩이 없는 제안은 빠진다 */
  plans: ReadonlyMap<number, TableFollow>;
  /** 하나씩 보기를 연 표 - 줄마다 칩 옆에 적용 단추 */
  each: ReadonlySet<number>;
  onApply: (tableId: number, only?: readonly number[]) => void;
  onEach: (tableId: number) => void;
  onKeep: (tableId: number) => void;
}

interface UseTableFollowArgs {
  bundleId: number;
  /** 보는 Old 문서 - 없으면 읽지 않는다 */
  docId: number | null;
  /** 짝을 물을 벗긴 영어 표(table-follow-model listFollowTableIds) - 고칠 수 없으면 빈 목록 */
  tableIds: readonly number[];
  /** 문서 · 판단이 바뀔 때마다 바뀌는 값 - 한글 표를 손대면 제안도 다시 읽는다 */
  dataKey: string;
  /** 편집 한 번(되돌리기 한 칸) - 큐를 지난다 */
  apply: (tableId: number, op: Extract<EditOp, { type: "follow_table" }>) => void;
}

const NO_PLANS: ReadonlyMap<number, TableFollow> = new Map();

export function useTableFollow({ bundleId, docId, tableIds, dataKey, apply }: UseTableFollowArgs): TableFollowStrip {
  const loaded = useLoaded(
    async () => {
      if (docId === null || tableIds.length === 0) return NO_PLANS;
      const answers = await Promise.all(tableIds.map(async (tableId) => [tableId, await getTableFollow(bundleId, docId, tableId)] as const));
      return new Map(answers);
    },
    `${docId}:${tableIds.join(",")}:${dataKey}`,
  );
  // 그대로 두기 - 이 화면에서만 감춘다(저장하지 않는다, D2-R7)
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set());
  const [each, setEach] = useState<ReadonlySet<number>>(new Set());
  const plans = useMemo(() => {
    const map = new Map<number, TableFollow>();
    for (const [tableId, plan] of loaded.data ?? NO_PLANS) if (plan.mode === "rule" && plan.count > 0 && !kept.has(tableId)) map.set(tableId, plan);
    return map;
  }, [loaded.data, kept]);

  function toggle(set: ReadonlySet<number>, tableId: number): ReadonlySet<number> {
    const next = new Set(set);
    if (!next.delete(tableId)) next.add(tableId);
    return next;
  }

  return {
    plans,
    each,
    onApply: (tableId, only) => {
      const plan = plans.get(tableId);
      if (plan !== undefined) apply(tableId, buildFollowOp(tableId, plan.items, only));
    },
    onEach: (tableId) => setEach((prev) => toggle(prev, tableId)),
    onKeep: (tableId) => setKept((prev) => new Set(prev).add(tableId)),
  };
}
