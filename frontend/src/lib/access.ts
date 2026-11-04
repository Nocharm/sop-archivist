// 권한 카탈로그 미러와 판정 헬퍼 - 백엔드 app/access/catalog.py PERMISSIONS와 같은 값·같은 순서(표시 순서의 기준).
// 화면의 노출 여부는 편의일 뿐이고 실제 차단은 백엔드 require_permission이 한다.
import type { Me } from "./api";

export const PERMISSIONS = ["permission.manage", "directory.sync", "ai.admin", "system.view"] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

// sysadmin은 permissions 목록이 비어 있어도 전부 가진다(백엔드 resolve와 같은 규칙)
export function hasPermission(me: Me, key: string): boolean {
  return me.is_sysadmin || me.permissions.includes(key);
}

// 관리 화면은 권한 4개 중 하나라도 있으면 들어갈 수 있다(탭별 노출은 관리 화면이 다시 가린다)
export function canSeeAdmin(me: Me): boolean {
  return PERMISSIONS.some((key) => hasPermission(me, key));
}

// 백엔드는 권한을 이름순으로 돌려주므로 화면에 올리기 전에 카탈로그 순서로 다시 세운다. 카탈로그에 없는 키는 뒤에 이름순으로 남겨 숨기지 않는다.
export function orderPermissions(keys: readonly string[]): string[] {
  const known = PERMISSIONS.filter((key) => keys.includes(key));
  const unknown = keys.filter((key) => !(PERMISSIONS as readonly string[]).includes(key)).sort();
  return [...known, ...unknown];
}
