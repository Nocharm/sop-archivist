// 묶음 안 화면 목록 - 레일·상단 2단·개요의 다음 행동이 같은 순서와 주소를 쓴다(디자인 문서 8절).

import type { NextAction } from "./api-sop";

export type StageKey = "overview" | "documents" | "split" | "tobe" | "classify" | "match" | "outputs" | "review" | "history";

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
  { key: "classify", path: "/classify", step: 3, ready: true },
  { key: "match", path: "/match", step: 3, ready: true },
  { key: "outputs", path: "/outputs", step: 4, ready: true },
  { key: "review", path: "/review", ready: true },
  // 레일 맨 아래 - 작업 기록 전체(개요 Activity의 "모두 보기")
  { key: "history", path: "/history", ready: true },
];

export interface StageSlot {
  step?: number;
  stages: Stage[];
}

/** 레일 칸 - 번호가 같은 이웃 단계(배정의 두 입구: 분류·짝 맞추기)는 번호 하나 아래 한 칸에 묶는다 */
export function groupStages(stages: readonly Stage[]): StageSlot[] {
  const slots: StageSlot[] = [];
  for (const stage of stages) {
    const last = slots.at(-1);
    if (stage.step !== undefined && last?.step === stage.step) last.stages.push(stage);
    else slots.push({ step: stage.step, stages: [stage] });
  }
  return slots;
}

// 문서가 하나도 없으면 들어가 봐야 할 일이 없는 단계. To-Be는 Excel로 문서보다 먼저 채울 수 있어 열어 둔다
const NEEDS_DOCUMENTS: ReadonlySet<StageKey> = new Set(["split", "classify", "match", "outputs", "review"]);

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
  decide_units: "classify",
  ack_warnings: "split",
  fill_reasons: "classify",
  semantic_checks: "review",
  add_reviewer: null,
  request_review: null,
  await_review: "review",
  done: null,
};

/**
 * 다음 행동의 화면 - decide_units는 backend가 단위(units_*)와 새 문장(targets_*)을 함께 센다. 남은 것이 새 문장뿐이면
 * 입구 2 새 문장이라 분류가 아니라 짝 맞추기에서 정한다. 막는 이유를 아직 모르면(null) 기본 화면이다.
 */
export function pickNextStage(action: NextAction, blockerCodes: string[] | null): StageKey | null {
  const isTargetsOnly = blockerCodes !== null && blockerCodes.some((code) => code.startsWith("targets_")) && !blockerCodes.some((code) => code.startsWith("units_"));
  return action === "decide_units" && isTargetsOnly ? "match" : NEXT_ACTION_STAGE[action];
}
