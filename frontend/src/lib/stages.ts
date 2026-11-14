// 묶음 안 화면 목록 - 레일·상단 2단·개요의 다음 행동이 같은 순서와 주소를 쓴다(디자인 문서 8절).

import type { NextAction } from "./api-sop";

export type StageKey = "overview" | "documents" | "assign" | "split" | "order" | "outputs" | "history";

/** Documents 화면 안 New 문서 목록(옛 To-Be 화면)의 자리 - 옛 주소 /tobe도 여기로 넘긴다 */
export const NEW_DOCUMENTS_ANCHOR = "new-documents";

export interface Stage {
  key: StageKey;
  /** 묶음 주소 뒤에 붙는 경로. 개요는 빈 문자열 */
  path: string;
  /** 단계 번호 칸에 쓰는 숫자. 없으면 아이콘 */
  step?: number;
  /** 레일에 따로 나오지 않고 이 단계 아래에 속하는 화면 - 레일은 그 단계를 현재로 표시한다 */
  under?: StageKey;
  /** 화면이 아직 없으면 레일에서 비활성으로 둔다 */
  ready: boolean;
}

export const STAGES: readonly Stage[] = [
  { key: "overview", path: "", ready: true },
  // 1단계 - Old 문서 목록과 그 아래 New 문서 목록(옛 To-Be 화면, 네 단계 워크플로우 B1). 옛 /tobe는 여기로 넘긴다
  { key: "documents", path: "/documents", step: 1, ready: true },
  // 2단계 - 쪼개기와 배정을 한 걸음으로 센다. 배정을 확정하면 그 조각의 경계도 확인된 것으로 본다(네 단계 워크플로우 B2).
  // 옛 /classify·/match는 여기로 넘긴다
  { key: "assign", path: "/assign", step: 2, ready: true },
  // 쪼개기 도구(KO/EN 짝·표 행·AI 쪼개기)가 아직 여기에만 있어 화면은 남기고, 레일에서는 2단계 아래에 둔다
  { key: "split", path: "/split", step: 2, under: "assign", ready: true },
  // 3단계 - New 문서별 문장 순서와 문단번호
  { key: "order", path: "/order", step: 3, ready: true },
  // 4단계 - 결과물과 검토. 검토 요청·완료·되돌림은 이 화면 위의 검토 띠에 있다(옛 /review는 여기로 넘긴다, B4)
  { key: "outputs", path: "/outputs", step: 4, ready: true },
  // 레일 맨 아래 - 작업 기록 전체(개요 Activity의 "모두 보기")
  { key: "history", path: "/history", ready: true },
];

// 문서가 하나도 없으면 들어가 봐야 할 일이 없는 단계. New 문서 목록은 Excel로 문서보다 먼저 채울 수 있고, Documents 화면에 있어 늘 열린다
const NEEDS_DOCUMENTS: ReadonlySet<StageKey> = new Set(["split", "assign", "order", "outputs"]);

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

/** 레일에서 현재로 표시할 단계 - 아래에 속한 화면이면 그 위 단계 */
export function getRailStage(key: StageKey | null): StageKey | null {
  if (key === null) return null;
  return STAGES.find((item) => item.key === key)?.under ?? key;
}

export function getStageHref(bundleId: number, key: StageKey): string {
  const stage = STAGES.find((item) => item.key === key);
  return `/bundles/${bundleId}${stage?.path ?? ""}`;
}

/** Documents 화면의 New 문서 목록으로 가는 주소 */
export function getNewDocumentsHref(bundleId: number): string {
  return `${getStageHref(bundleId, "documents")}#${NEW_DOCUMENTS_ANCHOR}`;
}

/** 다음 행동이 데려갈 화면. 없으면 개요 안에서 끝나는 일이다 */
export const NEXT_ACTION_STAGE: Record<NextAction, StageKey | null> = {
  upload_documents: "documents",
  resolve_documents: "documents",
  fill_doc_versions: "documents",
  fill_tobe: "documents",
  decide_units: "assign",
  // 누락 의심 경고는 배정 화면 위쪽 줄의 경고 표시에서 확인한다(전에는 쪼개기 화면)
  ack_warnings: "assign",
  fill_reasons: "assign",
  semantic_checks: "outputs",
  add_reviewer: null,
  request_review: null,
  await_review: "outputs",
  done: null,
};

/** 다음 행동의 주소 - New 문서 목록을 채우는 일은 Documents 화면의 그 자리로 간다. 개요 안에서 끝나는 일이면 null */
export function getNextActionHref(bundleId: number, action: NextAction): string | null {
  const stage = NEXT_ACTION_STAGE[action];
  if (stage === null) return null;
  return action === "fill_tobe" ? getNewDocumentsHref(bundleId) : getStageHref(bundleId, stage);
}
