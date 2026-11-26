// 변경 기록 화면의 거르기·날짜 묶음 - 순수 함수.
import type { AuditEvent } from "./api";
import { formatKst } from "./datetime";

export type AuditKind = "all" | "add" | "remove" | "role";
export const AUDIT_KINDS: readonly AuditKind[] = ["all", "add", "remove", "role"];

/** 기록 한 줄이 어느 알약에 드는가 - 모르는 작업은 전체에만 든다 */
export function getAuditKind(action: string): Exclude<AuditKind, "all"> | null {
  if (action === "grant.add") return "add";
  if (action === "grant.remove") return "remove";
  if (action.startsWith("role.")) return "role";
  return null;
}

/** 알약과 찾는 말로 거른다 - 글은 화면에 보이는 요약·작업 이름·한 사람 */
export function filterAudit(events: readonly AuditEvent[], kind: AuditKind, text: string, toText: (event: AuditEvent) => string): AuditEvent[] {
  const needle = text.trim().toLowerCase();
  return events.filter((event) => (kind === "all" || getAuditKind(event.action) === kind) && (needle === "" || toText(event).toLowerCase().includes(needle)));
}

/** KST 날짜(YYYY-MM-DD) - 날짜 묶음의 키 */
export function getAuditDay(event: Pick<AuditEvent, "occurred_at">): string {
  return formatKst(event.occurred_at).slice(0, 10);
}
