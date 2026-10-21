import { randomUUID } from "node:crypto";
import { Transaction, type Sequelize } from "sequelize";
import type { AccessOperation, RoleCode, SessionView } from "../../../contracts/access";
import { failure, type Result } from "../../../contracts/result";
import { appendAudit, listAudit } from "../audit/audit";
import { preserveActiveOwner, requirePermissions, userDto, userPermissions, type UserRow } from "../authorization/authorization";
import { canonicalSecret, hashPassword, newSecret, principalBucket, secretVerifier, verifyPassword, verifySecret } from "./crypto";
import { AccessStore } from "./store";
import { AccessError, validateInput, type ValidatedInput } from "./validation";

export interface AccessExecution { result: Result<unknown>; sessionId?: string | null }
interface SessionRow { verifier: string; userId: string; createdAt: number; lastActivityAt: number; expiresAt: number; revoked: number }
interface SessionContext { user: UserRow; session: SessionRow }
const queues = new WeakMap<Sequelize, Promise<unknown>>();
const LOGIN_ERROR = "No se pudo iniciar sesión con las credenciales indicadas.";
const RECOVERY_ERROR = "No se pudo recuperar el acceso con los datos indicados.";
const IDLE = 15 * 60_000;
const ABSOLUTE = 8 * 60 * 60_000;

export class AccessService {
  constructor(readonly database: Sequelize, readonly options: { now?: () => number; createUserId?: () => string } = {}) {}
  private now(): number { return this.options.now?.() ?? Date.now(); }
  async execute(operation: AccessOperation, input?: unknown, sessionId?: string | null): Promise<AccessExecution> {
    const requestId = randomUUID();
    let validated: ValidatedInput;
    try { validated = validateInput(operation, input); }
    catch { return { result: failure("VALIDATION_ERROR", "La solicitud no es válida.", requestId) }; }
    // Queue avoids nested transactions on a connection; IMMEDIATE locks independent connections.
    const previous = queues.get(this.database) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async (): Promise<AccessExecution> => {
      try {
        return await this.database.transaction({ type: Transaction.TYPES.IMMEDIATE }, async transaction =>
          this.dispatch(new AccessStore(this.database, transaction), operation, validated, sessionId, requestId, this.now()));
      } catch (error) {
        if (error instanceof AccessError) return { result: failure(error.code, error.message, requestId) };
        if (error instanceof Error && error.name === "SequelizeUniqueConstraintError" && "fields" in error && error.fields) {
          const fields = Array.isArray(error.fields) ? error.fields : Object.keys(error.fields);
          if (fields.some(key => ["login", "id"].includes(key))) return { result: failure("CONFLICT", "Los datos ya existen o fueron modificados.", requestId) };
        }
        return { result: failure("INTERNAL_ERROR", "No se pudo completar la operación local.", requestId) };
      }
    });
    queues.set(this.database, task); return task;
  }
  private async audit(store: AccessStore, action: string, requestId: string, now: number, actorId: string | null, targetId: string | null = actorId, outcome: "success" | "failure" = "success") {
    await appendAudit(store, { action, requestId, occurredAt: new Date(now).toISOString(), actorId, targetId, outcome });
  }
  private success(value: unknown, requestId: string, sessionId?: string | null): AccessExecution {
    return { result: { ok: true, data: value, requestId }, ...(sessionId === undefined ? {} : { sessionId }) };
  }
  private async revoke(store: AccessStore, userId: string): Promise<void> { await store.run("UPDATE panel_access_sessions SET revoked=1 WHERE userId=$userId", { userId }); }
  private async roles(store: AccessStore, userId: string, codes: RoleCode[]): Promise<void> {
    await store.run("DELETE FROM panel_access_user_roles WHERE userId=$userId", { userId });
    for (const roleCode of codes) await store.run("INSERT INTO panel_access_user_roles(userId,roleCode) VALUES($userId,$roleCode)", { userId, roleCode });
  }
  private async replaceRecovery(store: AccessStore, userId: string): Promise<string> {
    const recoveryKey = newSecret();
    await store.run("INSERT INTO panel_access_recovery(userId,verifier) VALUES($userId,$verifier) ON CONFLICT(userId) DO UPDATE SET verifier=excluded.verifier", { userId, verifier: secretVerifier(recoveryKey) });
    return recoveryKey;
  }
  private async sessionContext(store: AccessStore, sessionId: string | null | undefined, now: number): Promise<SessionContext | null> {
    if (!canonicalSecret(sessionId)) return null;
    const [session] = await store.rows<SessionRow>("SELECT * FROM panel_access_sessions WHERE verifier=$verifier", { verifier: secretVerifier(sessionId) });
    if (!session || session.revoked) return null;
    const [user] = await store.rows<UserRow>("SELECT * FROM panel_access_users WHERE id=$id", { id: session.userId });
    if (!user?.active || now < session.createdAt || now < session.lastActivityAt || now >= session.expiresAt || now >= session.lastActivityAt + IDLE) {
      await store.run("UPDATE panel_access_sessions SET revoked=1 WHERE verifier=$verifier", { verifier: session.verifier }); return null;
    }
    return { user, session };
  }
  private async view(store: AccessStore, context: SessionContext): Promise<SessionView> {
    return { user: await userDto(store, context.user), permissions: await userPermissions(store, context.user.id), expiresAt: new Date(context.session.expiresAt).toISOString(), idleExpiresAt: new Date(Math.min(context.session.expiresAt, context.session.lastActivityAt + IDLE)).toISOString() };
  }
  private async limited(store: AccessStore, operation: string, principal: string, now: number, requestId: string): Promise<AccessExecution | null> {
    const [attempt] = await store.rows<{ nextAllowedAt: number }>("SELECT MAX(nextAllowedAt) AS nextAllowedAt FROM panel_access_attempts WHERE operation IN ($operation,$principal)", { operation, principal: principalBucket(operation, principal) });
    if (!attempt || now >= attempt.nextAllowedAt) return null;
    return { result: { ok: false, requestId, error: { code: "RATE_LIMITED", message: "Espera antes de volver a intentarlo.", retryAfterMs: attempt.nextAllowedAt - now } } };
  }
  private async credentialFailure(store: AccessStore, operation: string, principal: string, now: number, requestId: string, message: string, actorId: string | null = null): Promise<AccessExecution> {
    for (const bucket of [operation, principalBucket(operation, principal)]) {
      const [previous] = await store.rows<{ failures: number }>("SELECT failures FROM panel_access_attempts WHERE operation=$operation", { operation: bucket });
      const failures = Math.min((previous?.failures ?? 0) + 1, 100);
      const nextAllowedAt = now + (failures < 5 ? 0 : Math.min(60000, 1000 * 2 ** Math.min(failures - 5, 10)));
      await store.run("INSERT INTO panel_access_attempts(operation,failures,nextAllowedAt) VALUES($operation,$failures,$nextAllowedAt) ON CONFLICT(operation) DO UPDATE SET failures=excluded.failures,nextAllowedAt=excluded.nextAllowedAt", { operation: bucket, failures, nextAllowedAt });
    }
    await this.audit(store, operation, requestId, now, actorId, actorId, "failure");
    return { result: failure("UNAUTHENTICATED", message, requestId) };
  }
  private async clearAttempts(store: AccessStore, operation: string, principal: string) {
    await store.run("DELETE FROM panel_access_attempts WHERE operation IN ($operation,$principal)", { operation, principal: principalBucket(operation, principal) });
  }
  private async createUser(store: AccessStore, input: ValidatedInput, codes: RoleCode[]): Promise<UserRow> {
    const user: UserRow = { id: this.options.createUserId?.() ?? randomUUID(), login: input.login as string, displayName: input.displayName as string, passwordHash: await hashPassword(input.password as string), active: 1, version: 1 };
    await store.run("INSERT INTO panel_access_users(id,login,displayName,passwordHash,active,version) VALUES($id,$login,$displayName,$passwordHash,$active,$version)", { ...user });
    await this.roles(store, user.id, codes); return user;
  }
  private async dispatch(store: AccessStore, operation: AccessOperation, input: ValidatedInput, sessionId: string | null | undefined, requestId: string, now: number): Promise<AccessExecution> {
    if (operation === "auth.status") {
      const [row] = await store.rows<{ count: number }>("SELECT COUNT(*) AS count FROM panel_access_users"); return this.success({ bootstrapRequired: row.count === 0 }, requestId);
    }
    if (operation === "auth.bootstrap") {
      const [row] = await store.rows<{ count: number }>("SELECT COUNT(*) AS count FROM panel_access_users");
      if (row.count !== 0) throw new AccessError("CONFLICT", "La instalación ya tiene usuarios.");
      const user = await this.createUser(store, input, ["owner"]); const recoveryKey = await this.replaceRecovery(store, user.id);
      await this.audit(store, operation, requestId, now, user.id);
      return this.success({ user: await userDto(store, user), recoveryKey }, requestId);
    }
    if (operation === "auth.login") {
      const limited = await this.limited(store, operation, input.login as string, now, requestId); if (limited) return limited;
      const [user] = await store.rows<UserRow>("SELECT * FROM panel_access_users WHERE login=$login", { login: input.login });
      const valid = await verifyPassword(user?.active ? user.passwordHash : undefined, input.password as string);
      if (!valid || !user?.active) return this.credentialFailure(store, operation, input.login as string, now, requestId, LOGIN_ERROR);
      await this.clearAttempts(store, operation, input.login as string);
      if (canonicalSecret(sessionId)) await store.run("UPDATE panel_access_sessions SET revoked=1 WHERE verifier=$verifier", { verifier: secretVerifier(sessionId) });
      const newSession = newSecret(); const session: SessionRow = { verifier: secretVerifier(newSession), userId: user.id, createdAt: now, lastActivityAt: now, expiresAt: now + ABSOLUTE, revoked: 0 };
      await store.run("INSERT INTO panel_access_sessions(verifier,userId,createdAt,lastActivityAt,expiresAt,revoked) VALUES($verifier,$userId,$createdAt,$lastActivityAt,$expiresAt,$revoked)", { ...session });
      await this.audit(store, operation, requestId, now, user.id);
      return this.success(await this.view(store, { user, session }), requestId, newSession);
    }
    if (operation === "auth.recover") {
      const limited = await this.limited(store, operation, input.login as string, now, requestId); if (limited) return limited;
      const [user] = await store.rows<UserRow>("SELECT * FROM panel_access_users WHERE login=$login", { login: input.login });
      const dto = user ? await userDto(store, user) : undefined;
      const [recovery] = user ? await store.rows<{ verifier: string }>("SELECT verifier FROM panel_access_recovery WHERE userId=$id", { id: user.id }) : [];
      const valid = canonicalSecret(input.recoveryKey) && verifySecret(input.recoveryKey, recovery?.verifier);
      if (!valid || !user?.active || !dto?.roleCodes.includes("owner")) return this.credentialFailure(store, operation, input.login as string, now, requestId, RECOVERY_ERROR);
      await store.run("UPDATE panel_access_users SET passwordHash=$passwordHash,version=version+1 WHERE id=$id", { id: user.id, passwordHash: await hashPassword(input.newPassword as string) });
      const recoveryKey = await this.replaceRecovery(store, user.id); await this.revoke(store, user.id); await this.clearAttempts(store, operation, user.login);
      await this.audit(store, operation, requestId, now, user.id);
      return this.success({ recoveryKey }, requestId);
    }
    const context = await this.sessionContext(store, sessionId, now);
    if (operation === "auth.logout") {
      if (canonicalSecret(sessionId)) await store.run("UPDATE panel_access_sessions SET revoked=1 WHERE verifier=$verifier", { verifier: secretVerifier(sessionId) });
      if (context) await this.audit(store, operation, requestId, now, context.user.id);
      return this.success({ loggedOut: true }, requestId, null);
    }
    if (!context) return { result: failure("UNAUTHENTICATED", "Inicia sesión para continuar.", requestId), sessionId: null };
    const { user, session } = context;
    if (operation === "auth.me") return this.success(await this.view(store, context), requestId);
    if (operation === "auth.touch") {
      await store.run("UPDATE panel_access_sessions SET lastActivityAt=$now WHERE verifier=$verifier", { now, verifier: session.verifier }); session.lastActivityAt = now;
      return this.success(await this.view(store, context), requestId);
    }
    if (operation === "auth.changePassword" || operation === "auth.rotateRecoveryKey") {
      if (operation === "auth.rotateRecoveryKey" && !(await userDto(store, user)).roleCodes.includes("owner")) throw new AccessError("FORBIDDEN", "La solicitud no está autorizada.");
      const limited = await this.limited(store, operation, user.login, now, requestId); if (limited) return limited;
      if (!await verifyPassword(user.passwordHash, input.currentPassword as string)) return this.credentialFailure(store, operation, user.login, now, requestId, "No se pudo verificar la contraseña actual.", user.id);
      await this.clearAttempts(store, operation, user.login);
      if (operation === "auth.rotateRecoveryKey") {
        const recoveryKey = await this.replaceRecovery(store, user.id); await this.audit(store, operation, requestId, now, user.id); return this.success({ recoveryKey }, requestId);
      }
      await store.run("UPDATE panel_access_users SET passwordHash=$passwordHash,version=version+1 WHERE id=$id", { id: user.id, passwordHash: await hashPassword(input.newPassword as string) });
      await this.revoke(store, user.id); await this.audit(store, operation, requestId, now, user.id); return this.success({ changed: true }, requestId, null);
    }
    if (operation === "users.list" || operation === "roles.list") await requirePermissions(store, user.id, "plataforma.usuarios.ver");
    if (operation === "audit.list") { await requirePermissions(store, user.id, "plataforma.auditoria.ver"); return this.success(await listAudit(store, input), requestId); }
    if (operation === "roles.list") {
      const roles = await store.rows<{ code: RoleCode; name: string }>("SELECT code,name FROM panel_access_roles ORDER BY code");
      return this.success(await Promise.all(roles.map(async role => ({ ...role, permissions: (await store.rows<{ permission: string }>("SELECT permission FROM panel_access_role_permissions WHERE roleCode=$code ORDER BY permission", { code: role.code })).map(item => item.permission) }))), requestId);
    }
    if (operation === "users.list") {
      const [count] = await store.rows<{ total: number }>("SELECT COUNT(*) AS total FROM panel_access_users");
      const users = await store.rows<UserRow>("SELECT * FROM panel_access_users ORDER BY login,id LIMIT $limit OFFSET $offset", { limit: input.pageSize, offset: (input.page - 1) * input.pageSize });
      return this.success({ items: await Promise.all(users.map(item => userDto(store, item))), total: count.total, page: input.page, pageSize: input.pageSize }, requestId);
    }
    if (operation === "users.create") {
      await requirePermissions(store, user.id, "plataforma.usuarios.gestionar", "plataforma.roles.asignar");
      const created = await this.createUser(store, input, input.roleCodes as RoleCode[]); await this.audit(store, operation, requestId, now, user.id, created.id);
      return this.success(await userDto(store, created), requestId);
    }
    if (operation === "roles.assign") await requirePermissions(store, user.id, "plataforma.roles.asignar");
    else await requirePermissions(store, user.id, "plataforma.usuarios.gestionar");
    const [target] = await store.rows<UserRow>("SELECT * FROM panel_access_users WHERE id=$id", { id: input.id });
    if (!target) throw new AccessError("NOT_FOUND", "No se encontró el usuario.");
    if (target.version !== input.expectedVersion) throw new AccessError("CONFLICT", "El usuario fue modificado. Actualiza los datos.");
    if (operation === "roles.assign") {
      const wasOwner = (await userDto(store, target)).roleCodes.includes("owner");
      await this.roles(store, target.id, input.roleCodes as RoleCode[]);
      await store.run("UPDATE panel_access_users SET version=version+1 WHERE id=$id", { id: target.id });
      if (wasOwner && !(input.roleCodes as RoleCode[]).includes("owner")) await store.run("DELETE FROM panel_access_recovery WHERE userId=$id", { id: target.id });
    } else if (operation === "users.update") {
      await store.run("UPDATE panel_access_users SET login=$login,displayName=$displayName,active=$active,version=version+1 WHERE id=$id", { login: input.login, displayName: input.displayName, active: input.active ? 1 : 0, id: target.id });
    } else if (operation === "users.disable") await store.run("UPDATE panel_access_users SET active=0,version=version+1 WHERE id=$id", { id: target.id });
    else throw new AccessError("VALIDATION_ERROR");
    await preserveActiveOwner(store);
    if (operation !== "users.update" || target.login !== input.login || Boolean(target.active) !== input.active) await this.revoke(store, target.id);
    await this.audit(store, operation, requestId, now, user.id, target.id);
    const [updated] = await store.rows<UserRow>("SELECT * FROM panel_access_users WHERE id=$id", { id: target.id });
    return this.success(await userDto(store, updated), requestId);
  }
}
