import type { AccessOperation, RoleCode } from "../../../contracts/access";
export class AccessError extends Error {
  constructor(readonly code: string, message = "La solicitud no es válida.") { super(message); }
}
export function invalid(): never { throw new AccessError("VALIDATION_ERROR"); }
const allowed: Record<AccessOperation, string[]> = {
  "auth.status": [], "auth.bootstrap": ["login", "displayName", "password"], "auth.login": ["login", "password"],
  "auth.logout": [], "auth.me": [], "auth.touch": [], "auth.changePassword": ["currentPassword", "newPassword"],
  "auth.recover": ["login", "recoveryKey", "newPassword"], "auth.rotateRecoveryKey": ["currentPassword"],
  "users.list": ["page", "pageSize"], "users.create": ["login", "displayName", "password", "roleCodes"],
  "users.update": ["id", "expectedVersion", "login", "displayName", "active"], "users.disable": ["id", "expectedVersion"],
  "roles.list": [], "roles.assign": ["id", "expectedVersion", "roleCodes"], "audit.list": ["page", "pageSize", "actorId", "action"],
};
export type ValidatedInput = Record<string, unknown> & { page: number; pageSize: number };
export function validateInput(operation: AccessOperation, input: unknown): ValidatedInput {
  const keys = allowed[operation]; if (!keys) invalid();
  const optional = ["auth.status", "auth.logout", "auth.me", "auth.touch", "roles.list", "users.list", "audit.list"].includes(operation);
  if (input === undefined && optional) input = {};
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) invalid();
  const value = { ...input } as Record<string, unknown>;
  if (Object.keys(value).some(key => !keys.includes(key))) invalid();
  for (const key of keys.filter(key => !["page", "pageSize", "actorId", "action"].includes(key))) if (!(key in value)) invalid();
  if (keys.includes("login")) {
    if (typeof value.login !== "string" || value.login.length > 128) invalid();
    value.login = value.login.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(value.login as string)) invalid();
  }
  if (keys.includes("displayName")) {
    if (typeof value.displayName !== "string") invalid(); value.displayName = value.displayName.trim();
    if (Array.from(value.displayName as string).length < 1 || Array.from(value.displayName as string).length > 120) invalid();
  }
  for (const key of ["password", "currentPassword", "newPassword"]) if (keys.includes(key)) {
    if (typeof value[key] !== "string" || (value[key] as string).length > 256 || !(value[key] as string).isWellFormed()) invalid();
    const length = Array.from(value[key] as string).length;
    if (length < 15 || length > 128) invalid();
  }
  for (const key of ["id", "actorId"]) if (value[key] !== undefined && (typeof value[key] !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value[key] as string))) invalid();
  if (keys.includes("expectedVersion") && (!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 1)) invalid();
  if (keys.includes("active") && typeof value.active !== "boolean") invalid();
  if (keys.includes("roleCodes")) {
    if (!Array.isArray(value.roleCodes) || value.roleCodes.length < 1 || value.roleCodes.length > 3 || new Set(value.roleCodes).size !== value.roleCodes.length || value.roleCodes.some(code => !["owner", "collections", "viewer"].includes(code as RoleCode))) invalid();
  }
  if (keys.includes("recoveryKey") && (typeof value.recoveryKey !== "string" || value.recoveryKey.length > 128)) invalid();
  if (value.action !== undefined && (typeof value.action !== "string" || !/^[a-zA-Z.]{1,80}$/.test(value.action))) invalid();
  for (const [key, fallback, max] of [["page", 1, 1_000_000], ["pageSize", 20, 100]] as const) {
    if (!keys.includes(key)) continue;
    value[key] ??= fallback;
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1 || Number(value[key]) > max) invalid();
  }
  return value as ValidatedInput;
}
