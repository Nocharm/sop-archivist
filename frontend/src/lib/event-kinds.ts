// 작업 기록 사건의 아이콘과 묶음(History 필터) - 사건 이름(action)의 앞부분으로 가른다. 모르는 사건은 Bundle 묶음.
import {
  Bot,
  CheckCheck,
  CircleCheckBig,
  ClipboardCheck,
  FilePlus2,
  FileText,
  FileX2,
  History,
  Link2,
  ListTree,
  Pencil,
  Plus,
  Redo2,
  Scissors,
  Sheet,
  Sparkles,
  Undo2,
  Users,
  type LucideIcon,
} from "lucide-react";

export type EventGroup = "bundle" | "document" | "decision" | "ai" | "review";

export const EVENT_GROUPS: readonly EventGroup[] = ["bundle", "document", "decision", "ai", "review"];

const GROUP_BY_PREFIX: Record<string, EventGroup> = {
  bundle: "bundle",
  export: "bundle",
  tobe: "bundle",
  document: "document",
  unit: "document",
  pair: "document",
  warning: "document",
  decision: "decision",
  group: "decision",
  match: "decision",
  targets: "decision",
  semantic_checks: "review",
  review: "review",
  ai: "ai",
};

const ICON_BY_ACTION: Record<string, LucideIcon> = {
  "bundle.create": Plus,
  "bundle.update": Pencil,
  "bundle.members": Users,
  "document.upload": FilePlus2,
  "document.update": FileText,
  "document.delete": FileX2,
  "unit.edit": Scissors,
  "unit.undo": Undo2,
  "unit.redo": Undo2,
  "decision.undo": Undo2,
  "decision.redo": Redo2,
  "unit.check_all": CheckCheck,
  "pair.create": Link2,
  "pair.confirm": Link2,
  "pair.delete": Link2,
  "tobe.update": ListTree,
  "export": Sheet,
  "semantic_checks": ClipboardCheck,
};

export function getEventGroup(action: string): EventGroup {
  return GROUP_BY_PREFIX[action.split(".")[0]] ?? "bundle";
}

export function getEventIcon(action: string): LucideIcon {
  const exact = ICON_BY_ACTION[action];
  if (exact) return exact;
  const group = getEventGroup(action);
  if (group === "ai") return Sparkles;
  if (group === "review") return ClipboardCheck;
  if (group === "decision") return CircleCheckBig;
  if (action.startsWith("ai")) return Bot;
  return History;
}
