// 권한을 화면에서 묶어 보이는 갈래(역할 표의 열 묶음 · 역할 폼) - 순서는 카탈로그 순서 그대로. 새 권한은 여기 갈래를 정해야 타입이 통과한다.
import { PERMISSIONS, type PermissionKey } from "./access";

export type PermissionGroup = "people" | "ops" | "work" | "standard";

const GROUP_BY_KEY: Record<PermissionKey, PermissionGroup> = {
  "permission.manage": "people",
  "directory.sync": "people",
  "ai.admin": "ops",
  "system.view": "ops",
  "bundle.create": "work",
  "bundle.admin": "work",
  "guideline.manage": "standard",
  "outline.manage": "standard",
};

export interface PermissionGroupEntry {
  group: PermissionGroup;
  keys: PermissionKey[];
}

/** 카탈로그 순서를 지킨 갈래 목록 */
export const PERMISSION_GROUPS: PermissionGroupEntry[] = PERMISSIONS.reduce<PermissionGroupEntry[]>((groups, key) => {
  const group = GROUP_BY_KEY[key];
  const last = groups[groups.length - 1];
  if (last?.group === group) last.keys.push(key);
  else groups.push({ group, keys: [key] });
  return groups;
}, []);
