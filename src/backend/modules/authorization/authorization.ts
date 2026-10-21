import type { AccessPermission, RoleCode, UserDto } from "../../../contracts/access";
import type { AccessStore } from "../access/store";
import { AccessError } from "../access/validation";
export interface UserRow { id: string; login: string; displayName: string; passwordHash: string; active: number; version: number }
export async function userDto(store: AccessStore, user: UserRow): Promise<UserDto> {
  const roles = await store.rows<{ roleCode: RoleCode }>("SELECT roleCode FROM panel_access_user_roles WHERE userId=$id ORDER BY roleCode", { id: user.id });
  return { id: user.id, login: user.login, displayName: user.displayName, active: Boolean(user.active), version: user.version, roleCodes: roles.map(role => role.roleCode) };
}
export async function userPermissions(store: AccessStore, id: string): Promise<AccessPermission[]> {
  const rows = await store.rows<{ permission: AccessPermission }>("SELECT DISTINCT rp.permission FROM panel_access_role_permissions rp JOIN panel_access_user_roles ur ON ur.roleCode=rp.roleCode WHERE ur.userId=$id ORDER BY rp.permission", { id });
  return rows.map(row => row.permission);
}
export async function requirePermissions(store: AccessStore, userId: string, ...required: AccessPermission[]): Promise<void> {
  const permissions = await userPermissions(store, userId);
  if (required.some(permission => !permissions.includes(permission))) throw new AccessError("FORBIDDEN", "La solicitud no está autorizada.");
}
export async function preserveActiveOwner(store: AccessStore): Promise<void> {
  const [row] = await store.rows<{ count: number }>("SELECT COUNT(*) AS count FROM panel_access_users u JOIN panel_access_user_roles ur ON ur.userId=u.id WHERE u.active=1 AND ur.roleCode='owner'");
  if (!row || row.count < 1) throw new AccessError("LAST_ADMIN_REQUIRED", "Debe conservar al menos un propietario activo.");
}
