// 묶음 안 화면 목록 - 레일·상단 2단·개요의 다음 행동이 같은 순서와 주소를 쓴다(디자인 문서 8절).

import type { NextAction } from "./api-sop";

export type StageKey = "overview" | "documents" | "split" | "tobe" | "classify" | "match" | "outputs" | "review";

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
  { key: "classify", path: "/classify", step: 3, ready: false },
  { key: "match", path: "/match", step: 3, ready: false },
  { key: "outputs", path: "/outputs", step: 4, ready: false },
  { key: "review", path: "/review", ready: false },
];

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
  decide_units: "classify",
  ack_warnings: "split",
  fill_reasons: "classify",
  semantic_checks: "review",
  add_reviewer: null,
  request_review: null,
  await_review: "review",
  done: null,
};
