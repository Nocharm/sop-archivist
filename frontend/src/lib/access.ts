// 권한 카탈로그 미러와 판정 헬퍼 - 백엔드 app/access/catalog.py PERMISSIONS와 같은 값·같은 순서(표시 순서의 기준).
// 화면의 노출 여부는 편의일 뿐이고 실제 차단은 백엔드 require_permission이 한다.
import type { Me } from "./api";

export const PERMISSIONS = [
  "permission.manage",
  "directory.sync",
  "ai.admin",
  "system.view",
  "bundle.create",
  "bundle.admin",
  "guideline.manage",
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

// 관리 화면 탭이 있는 권한 - 묶음·지침 권한은 관리 탭이 아직 없어 관리 화면을 열지 않는다
export const ADMIN_TAB_PERMISSIONS: readonly PermissionKey[] = ["permission.manage", "directory.sync", "ai.admin", "system.view", "bundle.admin", "guideline.manage"];

// sysadmin은 permissions 목록이 비어 있어도 전부 가진다(백엔드 resolve와 같은 규칙)
export function hasPermission(me: Me, key: string): boolean {
  return me.is_sysadmin || me.permissions.includes(key);
}

// 관리 화면은 관리 탭 권한 4개 중 하나라도 있으면 들어갈 수 있다(탭별 노출은 관리 화면이 다시 가린다)
export function canSeeAdmin(me: Me): boolean {
  return ADMIN_TAB_PERMISSIONS.some((key) => hasPermission(me, key));
}

// 백엔드는 권한을 이름순으로 돌려주므로 화면에 올리기 전에 카탈로그 순서로 다시 세운다. 카탈로그에 없는 키는 뒤에 이름순으로 남겨 숨기지 않는다.
export function orderPermissions(keys: readonly string[]): string[] {
  const known = PERMISSIONS.filter((key) => keys.includes(key));
  const unknown = keys.filter((key) => !(PERMISSIONS as readonly string[]).includes(key)).sort();
  return [...known, ...unknown];
}
