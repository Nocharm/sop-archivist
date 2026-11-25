// 사내 AI로 부여 등록의 미리보기 - AI가 읽은 줄을 지금 부여와 맞춰 새로/이미 있음/회수/받은 적 없음으로 나누고, 고른 줄을 일괄 저장 본문으로 만든다(순수 함수).
import type { Grant, GrantAiLine, GrantBatchInput, GrantInput, SubjectType } from "./api";

export type GrantAiStatus = "new" | "exists" | "remove" | "notHeld";

export interface GrantAiItem {
  subjectType: SubjectType;
  subjectId: string;
  roleId: number | null;
  permission: string | null;
  status: GrantAiStatus;
  /** 회수할 부여 id - status가 remove일 때만 */
  grantId: number | null;
}

export interface GrantAiSubject {
  written: string;
  matches: GrantAiLine["subjects"][number]["matches"];
  /** 고른(또는 하나뿐인) 대상 - 없으면 null */
  chosen: { subject_type: SubjectType; subject_id: string } | null;
}

export interface GrantAiRow {
  key: string;
  line: number;
  action: GrantAiLine["action"];
  subjects: GrantAiSubject[];
  roles: GrantAiLine["roles"];
  permissions: GrantAiLine["permissions"];
  items: GrantAiItem[];
  /** 목록에 없는 대상·없는 역할·권한, 아직 안 고른 동명이인 - 하나라도 있으면 그 줄을 확인할 줄로 보인다 */
  unknownSubjects: string[];
  unknownWhat: string[];
  needsPick: string[];
}

/** 동명이인을 고른 값의 키 - 줄 순서와 대상 글 */
export function getPickKey(rowKey: string, written: string): string {
  return `${rowKey}|${written}`;
}

function findGrant(grants: readonly Grant[], type: SubjectType, id: string, roleId: number | null, permission: string | null): Grant | undefined {
  return grants.find(
    (grant) =>
      grant.subject_type === type &&
      grant.subject_id === id &&
      (roleId !== null ? grant.role_id === roleId : grant.role_id === null && grant.permission === permission),
  );
}

export function buildGrantAiRows(lines: readonly GrantAiLine[], grants: readonly Grant[], picks: ReadonlyMap<string, string>): GrantAiRow[] {
  return lines.map((line, index) => {
    const key = String(index);
    const subjects: GrantAiSubject[] = line.subjects.map((subject) => {
      if (subject.matches.length === 1) return { ...subject, chosen: subject.matches[0] };
      const picked = picks.get(getPickKey(key, subject.written));
      return { ...subject, chosen: subject.matches.find((match) => `${match.subject_type}:${match.subject_id}` === picked) ?? null };
    });
    const what = [
      ...line.roles.filter((role) => role.role_id !== null).map((role) => ({ roleId: role.role_id, permission: null })),
      ...line.permissions.filter((perm) => perm.permission !== null).map((perm) => ({ roleId: null, permission: perm.permission })),
    ];
    const items: GrantAiItem[] = [];
    for (const subject of subjects) {
      if (subject.chosen === null) continue;
      const { subject_type: type, subject_id: id } = subject.chosen;
      for (const { roleId, permission } of what) {
        const held = findGrant(grants, type, id, roleId, permission);
        const status: GrantAiStatus = line.action === "add" ? (held ? "exists" : "new") : held ? "remove" : "notHeld";
        items.push({ subjectType: type, subjectId: id, roleId, permission, status, grantId: status === "remove" ? (held?.id ?? null) : null });
      }
    }
    return {
      key,
      line: line.line,
      action: line.action,
      subjects,
      roles: line.roles,
      permissions: line.permissions,
      items,
      unknownSubjects: subjects.filter((subject) => subject.matches.length === 0).map((subject) => subject.written),
      unknownWhat: [
        ...line.roles.filter((role) => role.role_id === null).map((role) => role.written),
        ...line.permissions.filter((perm) => perm.permission === null).map((perm) => perm.written),
      ],
      needsPick: subjects.filter((subject) => subject.matches.length > 1 && subject.chosen === null).map((subject) => subject.written),
    };
  });
}

/** 바꿀 것이 있는 줄 - 처음에 체크된 채 열린다 */
export function hasChange(row: GrantAiRow): boolean {
  return row.items.some((item) => item.status === "new" || item.status === "remove");
}

export function isRowToCheck(row: GrantAiRow): boolean {
  const isMissingPart = row.subjects.length === 0 || row.roles.length + row.permissions.length === 0;
  return isMissingPart || row.unknownSubjects.length > 0 || row.unknownWhat.length > 0 || row.needsPick.length > 0;
}

/** 고른 줄의 새 부여·회수를 일괄 저장 본문으로 - 여러 줄이 같은 것을 말해도 한 번만 */
export function buildGrantAiBatch(rows: readonly GrantAiRow[], checked: ReadonlySet<string>): GrantBatchInput {
  const add = new Map<string, GrantInput>();
  const remove = new Set<number>();
  for (const row of rows) {
    if (!checked.has(row.key)) continue;
    for (const item of row.items) {
      if (item.status === "remove" && item.grantId !== null) remove.add(item.grantId);
      if (item.status !== "new") continue;
      const input: GrantInput =
        item.roleId !== null
          ? { subject_type: item.subjectType, subject_id: item.subjectId, role_id: item.roleId }
          : { subject_type: item.subjectType, subject_id: item.subjectId, permission: item.permission ?? "" };
      add.set(`${item.subjectType}:${item.subjectId}:${item.roleId ?? ""}:${item.permission ?? ""}`, input);
    }
  }
  return { add: [...add.values()], remove: [...remove] };
}

export function countGrantAiStatus(row: GrantAiRow): Record<GrantAiStatus, number> {
  const counts: Record<GrantAiStatus, number> = { new: 0, exists: 0, remove: 0, notHeld: 0 };
  for (const item of row.items) counts[item.status] += 1;
  return counts;
}
