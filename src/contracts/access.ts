import type { Result } from "./result";

export const ACCESS_PERMISSIONS = [
  "plataforma.usuarios.ver",
  "plataforma.usuarios.gestionar",
  "plataforma.roles.asignar",
  "plataforma.auditoria.ver",
] as const;
export type AccessPermission = (typeof ACCESS_PERMISSIONS)[number];
export type RoleCode = "owner" | "collections" | "viewer";

export interface UserDto {
  id: string;
  login: string;
  displayName: string;
  active: boolean;
  roleCodes: RoleCode[];
  version: number;
}
export interface RoleDto {
  code: RoleCode;
  name: string;
  permissions: AccessPermission[];
}
export interface SessionView {
  user: UserDto;
  permissions: AccessPermission[];
  expiresAt: string;
  idleExpiresAt: string;
}
export interface PageInput { page?: number; pageSize?: number }
export interface PageDto<T> { items: T[]; page: number; pageSize: number; total: number }
export interface AccessStatus { bootstrapRequired: boolean }
export interface BootstrapInput { login: string; displayName: string; password: string }
export interface RecoverySecret { recoveryKey: string }
export interface BootstrapResult extends RecoverySecret { user: UserDto }
export interface LoginInput { login: string; password: string }
export interface RecoverInput { login: string; recoveryKey: string; newPassword: string }
export interface ChangePasswordInput { currentPassword: string; newPassword: string }
export interface CreateUserInput extends BootstrapInput { roleCodes: RoleCode[] }
export interface UpdateUserInput {
  id: string;
  expectedVersion: number;
  login: string;
  displayName: string;
  active: boolean;
}
export interface UserVersionInput { id: string; expectedVersion: number }
export interface AssignRolesInput extends UserVersionInput { roleCodes: RoleCode[] }
export interface AuditEventDto {
  id: string;
  occurredAt: string;
  actorId: string | null;
  action: string;
  targetId: string | null;
  outcome: "success" | "failure";
  requestId: string;
}
export interface AuditListInput extends PageInput { action?: string; actorId?: string }
export interface AccessApi {
  auth: {
    status(): Promise<Result<AccessStatus>>;
    bootstrap(input: BootstrapInput): Promise<Result<BootstrapResult>>;
    login(input: LoginInput): Promise<Result<SessionView>>;
    logout(): Promise<Result<{ loggedOut: true }>>;
    me(): Promise<Result<SessionView>>;
    touch(): Promise<Result<SessionView>>;
    changePassword(input: ChangePasswordInput): Promise<Result<{ changed: true }>>;
    recover(input: RecoverInput): Promise<Result<RecoverySecret>>;
    rotateRecoveryKey(input: { currentPassword: string }): Promise<Result<RecoverySecret>>;
  };
  users: {
    list(input?: PageInput): Promise<Result<PageDto<UserDto>>>;
    create(input: CreateUserInput): Promise<Result<UserDto>>;
    update(input: UpdateUserInput): Promise<Result<UserDto>>;
    disable(input: UserVersionInput): Promise<Result<UserDto>>;
  };
  roles: {
    list(): Promise<Result<RoleDto[]>>;
    assign(input: AssignRolesInput): Promise<Result<UserDto>>;
  };
  audit: {
    list(input?: AuditListInput): Promise<Result<PageDto<AuditEventDto>>>;
  };
}

export const ACCESS_OPERATIONS = [
  "auth.status", "auth.bootstrap", "auth.login", "auth.logout", "auth.me", "auth.touch",
  "auth.changePassword", "auth.recover", "auth.rotateRecoveryKey", "users.list", "users.create",
  "users.update", "users.disable", "roles.list", "roles.assign", "audit.list",
] as const;
export type AccessOperation = (typeof ACCESS_OPERATIONS)[number];
