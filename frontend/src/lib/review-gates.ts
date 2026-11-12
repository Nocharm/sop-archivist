// 검토 요청 조건을 카드로 나누는 규칙 - 막힌 것(Fail)을 위, 끝난 것(Pass)을 아래에 두고 각각 앞 몇 개만 보인다.
import type { ReadinessIssue } from "@/lib/api-sop";
import type { StageKey } from "@/lib/stages";

export type GateKey = "documents" | "boundaries" | "units" | "targets" | "warnings" | "reasons" | "semantic" | "reviewer";

/** 막힌 조건을 푸는 화면 - Fail 카드를 누르면 여기로 간다. 검토자 조건은 화면이 아니라 멤버 창이라 null */
export const GATE_STAGE: Record<GateKey, StageKey | null> = {
  documents: "documents",
  boundaries: "split",
  units: "assign",
  targets: "assign",
  warnings: "split",
  reasons: "assign",
  semantic: "outputs",
  reviewer: null,
};

export interface GateSplit<T> {
  fail: T[];
  pass: T[];
  failHidden: number;
  passHidden: number;
}

export function splitGates<T extends { ok: boolean }>(gates: readonly T[], visible = 3): GateSplit<T> {
  const fail = gates.filter((gate) => !gate.ok);
  const pass = gates.filter((gate) => gate.ok);
  return {
    fail: fail.slice(0, visible),
    pass: pass.slice(0, visible),
    failHidden: Math.max(0, fail.length - visible),
    passHidden: Math.max(0, pass.length - visible),
  };
}

export interface NoticeGroup {
  code: "equipment_sop_empty_slots";
  docs: string[];
}

/** 같은 장비 SOP 칸 안내가 둘 이상이면 한 묶음으로 접는다(첫 안내 자리). 하나뿐이면 그대로 둔다. */
export function groupNotices(notices: readonly ReadinessIssue[]): Array<ReadinessIssue | NoticeGroup> {
  const slots = notices.filter((notice) => notice.code === "equipment_sop_empty_slots");
  if (slots.length < 2) return [...notices];
  const group: NoticeGroup = { code: "equipment_sop_empty_slots", docs: slots.map((notice) => String(notice.doc_code ?? "")) };
  const out: Array<ReadinessIssue | NoticeGroup> = [];
  let placed = false;
  for (const notice of notices) {
    if (notice.code !== "equipment_sop_empty_slots") out.push(notice);
    else if (!placed) {
      out.push(group);
      placed = true;
    }
  }
  return out;
}

// ReadinessIssue는 열린 모양이라 `"docs" in notice`로는 좁혀지지 않는다
export function isNoticeGroup(notice: ReadinessIssue | NoticeGroup): notice is NoticeGroup {
  return Array.isArray((notice as NoticeGroup).docs);
}
