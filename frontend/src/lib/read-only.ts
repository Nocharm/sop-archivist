// 읽기 전용 사유 - 편집 단추가 사라진 화면이 "왜 못 고치는지"를 같은 말로 알리도록 한 곳에서 정한다.
import type { BundleStatus, MemberRole } from "./api-sop";

export type ReadOnlyReason = "in_review" | "done" | "reviewer";

/** 고칠 수 있으면 null. 상태가 먼저다 - 검토 대기·완료에서는 작성자도 못 고친다 */
export function getReadOnlyReason(bundle: { status: BundleStatus; my_role: MemberRole | null } | null): ReadOnlyReason | null {
  if (bundle === null) return null;
  if (bundle.status === "in_review") return "in_review";
  if (bundle.status === "done") return "done";
  return bundle.my_role === "author" ? null : "reviewer";
}
