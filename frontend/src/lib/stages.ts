// 묶음 안 화면 목록 - 레일·상단 2단·개요의 다음 행동이 같은 순서와 주소를 쓴다(디자인 문서 8절).

import type { NextAction } from "./api-sop";

export type StageKey = "overview" | "documents" | "split" | "tobe" | "assign" | "outputs" | "review" | "history";

export interface Stage {
  key: StageKey;
  /** 묶음 주소 뒤에 붙는 경로. 개요는 빈 문자열 */
  path: string;
  /** 단계 번호 칸에 쓰는 숫자. 없으면 아이콘 */
  step?: number;
  /** 화면이 아직 없으면 레일에서 비활성으로 둔다 */
  ready: boolean;
}

export const STAGES: readonly Stage[] = [
  { key: "overview", path: "", ready: true },
  { key: "documents", path: "/documents", ready: true },
  { key: "split", path: "/split", step: 1, ready: true },
  { key: "tobe", path: "/tobe", step: 2, ready: true },
  // 배정의 두 입구(분류·짝 맞추기)를 Old 조각 한 줄씩 처리하는 한 화면 - 옛 /classify·/match는 여기로 넘긴다
  { key: "assign", path: "/assign", step: 3, ready: true },
  { key: "outputs", path: "/outputs", step: 4, ready: true },
  { key: "review", path: "/review", ready: true },
  // 레일 맨 아래 - 작업 기록 전체(개요 Activity의 "모두 보기")
  { key: "history", path: "/history", ready: true },
];

// 문서가 하나도 없으면 들어가 봐야 할 일이 없는 단계. To-Be는 Excel로 문서보다 먼저 채울 수 있어 열어 둔다
const NEEDS_DOCUMENTS: ReadonlySet<StageKey> = new Set(["split", "assign", "outputs", "review"]);

export function isStageLocked(key: StageKey, documentCount: number): boolean {
  return documentCount === 0 && NEEDS_DOCUMENTS.has(key);
}

const BUNDLE_PATH = /^\/bundles\/(\d+)(\/[a-z-]+)?\/?$/;

/** 주소에서 묶음 ID와 현재 단계를 읽는다. 묶음 밖이면 null */
export function parseBundlePath(pathname: string): { bundleId: number; stage: StageKey | null } | null {
  const match = BUNDLE_PATH.exec(pathname);
  if (!match) return null;
  const sub = match[2] ?? "";
  const stage = STAGES.find((item) => item.path === sub)?.key ?? null;
  return { bundleId: Number(match[1]), stage };
}

export function getStageHref(bundleId: number, key: StageKey): string {
  const stage = STAGES.find((item) => item.key === key);
  return `/bundles/${bundleId}${stage?.path ?? ""}`;
}

/** 다음 행동이 데려갈 화면. 없으면 개요 안에서 끝나는 일이다 */
export const NEXT_ACTION_STAGE: Record<NextAction, StageKey | null> = {
  upload_documents: "documents",
  resolve_documents: "documents",
  fill_tobe: "tobe",
  decide_units: "assign",
  ack_warnings: "split",
  fill_reasons: "assign",
  semantic_checks: "review",
  add_reviewer: null,
  request_review: null,
  await_review: "review",
  done: null,
};
