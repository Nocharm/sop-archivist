// 역할 × 권한 표에서 아직 저장하지 않은 칸 - 역할 id → (권한 → 켤지). 원래 값으로 되돌린 칸은 빠진다. 순수 함수.
import type { PermissionKey } from "./access";
import type { Role } from "./api";

export type RoleChanges = ReadonlyMap<number, ReadonlyMap<PermissionKey, boolean>>;

/** 칸을 한 번 누른 결과 - 역할의 저장된 값과 같아지면 바뀐 칸이 아니다 */
export function toggleChange(changes: RoleChanges, role: Pick<Role, "id" | "permissions">, key: PermissionKey): RoleChanges {
  const saved = role.permissions.includes(key);
  const current = changes.get(role.id)?.get(key) ?? saved;
  const next = !current;
  const forRole = new Map(changes.get(role.id) ?? []);
  if (next === saved) forRole.delete(key);
  else forRole.set(key, next);
  const result = new Map(changes);
  if (forRole.size === 0) result.delete(role.id);
  else result.set(role.id, forRole);
  return result;
}

/** 저장된 권한에 바뀐 칸을 얹은 값 */
export function applyRoleChanges(permissions: readonly string[], changes: ReadonlyMap<PermissionKey, boolean> | undefined): string[] {
  if (!changes) return [...permissions];
  const added = [...changes].filter(([, isOn]) => isOn).map(([key]) => key as string);
  return [...permissions.filter((key) => changes.get(key as PermissionKey) !== false), ...added];
}

/** 바뀌는 역할들을 받은 대상 수의 합 */
export function countHolders(roles: readonly Pick<Role, "grant_count">[]): number {
  return roles.reduce((sum, role) => sum + role.grant_count, 0);
}

/** 화면에 보이던 역할과 지금 서버의 역할이 같은가 - 사라졌으면 다르다 */
export function isSameRole(shown: Pick<Role, "name" | "description" | "permissions">, fresh: Pick<Role, "name" | "description" | "permissions"> | undefined): boolean {
  if (!fresh) return false;
  const held = new Set(fresh.permissions);
  return shown.name === fresh.name && shown.description === fresh.description && held.size === new Set(shown.permissions).size && shown.permissions.every((key) => held.has(key));
}
