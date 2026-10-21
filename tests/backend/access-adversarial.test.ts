import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryTypes, type Sequelize } from "sequelize";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPanelDatabase } from "../../src/backend/infrastructure/database/database";
import { migrateDatabase } from "../../src/backend/infrastructure/database/migrations";
import { AccessService, type AccessExecution } from "../../src/backend/modules/access/service";
import * as crypto from "../../src/backend/modules/access/crypto";
import type { BootstrapResult, RecoverySecret, UserDto } from "../../src/contracts/access";
import { createAccessBridge } from "../../src/electron/main/access-ipc";

const password = " Frase muy larga segura 🔑 ";
function data<T>(execution: AccessExecution): T {
  expect(execution.result.ok, JSON.stringify(execution.result)).toBe(true);
  if (!execution.result.ok) throw new Error(execution.result.error.code);
  return execution.result.data as T;
}

describe("revisión adversarial independiente de acceso", () => {
  let directory: string;
  let storage: string;
  let db: Sequelize;
  let service: AccessService;
  let owner: BootstrapResult;
  let ownerSession: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "panel-access-adversarial-"));
    storage = join(directory, "access.sqlite3");
    db = createPanelDatabase({ storage });
    await migrateDatabase(db);
    service = new AccessService(db);
    owner = data<BootstrapResult>(await service.execute("auth.bootstrap", { login: "owner", displayName: "Dueño", password }));
    const login = await service.execute("auth.login", { login: "owner", password });
    data(login);
    ownerSession = login.sessionId!;
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.close(); await rm(directory, { recursive: true, force: true }); });

  it.each(["disable", "demote"] as const)("dos conexiones intentan %s a sus propietarios: siempre queda uno activo", async mode => {
    const other = data<UserDto>(await service.execute("users.create", { login: "second", displayName: "Otro dueño", password, roleCodes: ["owner"] }, ownerSession));
    const secondLogin = await service.execute("auth.login", { login: "second", password });
    data(secondLogin);
    const secondDb = createPanelDatabase({ storage });
    try {
      const secondService = new AccessService(secondDb);
      const operation = mode === "disable" ? "users.disable" : "roles.assign";
      const firstInput = { id: owner.user.id, expectedVersion: 1, ...(mode === "demote" ? { roleCodes: ["viewer"] } : {}) };
      const secondInput = { id: other.id, expectedVersion: 1, ...(mode === "demote" ? { roleCodes: ["viewer"] } : {}) };
      const replies = await Promise.all([
        service.execute(operation, firstInput, ownerSession),
        secondService.execute(operation, secondInput, secondLogin.sessionId),
      ]);
      expect(replies.filter(reply => reply.result.ok)).toHaveLength(1);
      const [count] = await db.query<{ count: number }>(
        "SELECT COUNT(*) AS count FROM panel_access_users u JOIN panel_access_user_roles r ON r.userId=u.id WHERE u.active=1 AND r.roleCode='owner'",
        { type: QueryTypes.SELECT },
      );
      expect(count?.count).toBe(1);
      expect(replies.find(reply => !reply.result.ok)?.result).toMatchObject({ error: { code: "LAST_ADMIN_REQUIRED" } });
    } finally { await secondDb.close(); }
  });

  it("desconocido, inactivo y password errónea devuelven mismo error y usan verificación real/dummy", async () => {
    const disabled = data<UserDto>(await service.execute("users.create", { login: "disabled", displayName: "Inactivo", password, roleCodes: ["viewer"] }, ownerSession));
    data(await service.execute("users.disable", { id: disabled.id, expectedVersion: 1 }, ownerSession));
    const verify = vi.spyOn(crypto, "verifyPassword");
    const failures = [];
    for (const [login, supplied] of [["unknown", password], ["disabled", password], ["owner", "Una contraseña incorrecta"]]) {
      failures.push((await service.execute("auth.login", { login, password: supplied })).result);
    }
    for (const result of failures) expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED", message: "No se pudo iniciar sesión con las credenciales indicadas." } });
    expect(verify.mock.calls.map(call => typeof call[0])).toEqual(["undefined", "undefined", "string"]);
  });

  it("la promoción no revela clave y democión/re-promoción no revive una clave anterior", async () => {
    const second = data<UserDto>(await service.execute("users.create", { login: "second", displayName: "Otro", password, roleCodes: ["owner"] }, ownerSession));
    expect(JSON.stringify(second)).not.toMatch(/recoveryKey|verifier|passwordHash/);
    const login = await service.execute("auth.login", { login: "second", password }); data(login);
    const key = data<RecoverySecret>(await service.execute("auth.rotateRecoveryKey", { currentPassword: password }, login.sessionId));
    data(await service.execute("roles.assign", { id: second.id, expectedVersion: 1, roleCodes: ["viewer"] }, ownerSession));
    expect((await service.execute("auth.me", undefined, login.sessionId)).result).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    data(await service.execute("roles.assign", { id: second.id, expectedVersion: 2, roleCodes: ["owner"] }, ownerSession));
    expect((await service.execute("auth.recover", { login: "second", recoveryKey: key.recoveryKey, newPassword: password })).result)
      .toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    const active = await service.execute("auth.login", { login: "second", password }); data(active);
    const replacement = data<RecoverySecret>(await service.execute("auth.rotateRecoveryKey", { currentPassword: password }, active.sessionId));
    expect(replacement.recoveryKey).not.toBe(key.recoveryKey);
  });

  it("cambiar contraseña genera nueva salt, revoca todas las sesiones y la auditoría no captura secretos", async () => {
    const secondLogin = await service.execute("auth.login", { login: "owner", password }); data(secondLogin);
    const [before] = await db.query<{ passwordHash: string }>("SELECT passwordHash FROM panel_access_users WHERE login='owner'", { type: QueryTypes.SELECT });
    data(await service.execute("auth.changePassword", { currentPassword: password, newPassword: password }, ownerSession));
    const [after] = await db.query<{ passwordHash: string }>("SELECT passwordHash FROM panel_access_users WHERE login='owner'", { type: QueryTypes.SELECT });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash).toMatch(/^\$argon2id\$/);
    for (const session of [ownerSession, secondLogin.sessionId]) expect((await service.execute("auth.me", undefined, session)).result).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    const audit = JSON.stringify(await db.query("SELECT * FROM panel_audit_events", { type: QueryTypes.SELECT }));
    for (const secret of [password, owner.recoveryKey, ownerSession, secondLogin.sessionId!, before.passwordHash, after.passwordHash]) expect(audit).not.toContain(secret);
    expect(audit).not.toMatch(/"(passwordHash|recoveryKey|sessionId|verifier)"/);
  });

  it("login canónico es único y contraseñas Unicode aceptan exactamente 15/128 puntos de código", async () => {
    expect((await service.execute("users.create", { login: " OwNeR ", displayName: "Duplicado", password, roleCodes: ["viewer"] }, ownerSession)).result).toMatchObject({ error: { code: "CONFLICT" } });
    for (const length of [14, 129]) expect((await service.execute("users.create", { login: `bad${length}`, displayName: "Límite", password: "🔑".repeat(length), roleCodes: ["viewer"] }, ownerSession)).result).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    for (const length of [15, 128]) {
      const login = `valid${length}`;
      data(await service.execute("users.create", { login, displayName: "Límite", password: "🔑".repeat(length), roleCodes: ["viewer"] }, ownerSession));
      data(await service.execute("auth.login", { login: login.toUpperCase(), password: "🔑".repeat(length) }));
    }
  });

  it("bridge real oculta sesión, rechaza otro frame, no acepta actor falso y dispone la sesión al cerrar", async () => {
    const frame = { url: "app://panel/" };
    const contents = { mainFrame: frame };
    let internalSession: string | null | undefined;
    const execute = vi.fn(async (...args: Parameters<AccessService["execute"]>) => {
      const reply = await service.execute(...args);
      if (reply.sessionId) internalSession = reply.sessionId;
      return reply;
    });
    const bridge = createAccessBridge({ getExpectedContents: () => contents, execute });
    const event = { sender: contents, senderFrame: frame };
    const login = await bridge.handle("auth.login", event, { login: "owner", password });
    expect(login.ok).toBe(true);
    expect(JSON.stringify(login)).not.toContain(internalSession!);
    expect(JSON.stringify(login)).not.toMatch(/sessionId|verifier|passwordHash/);
    expect(await bridge.handle("users.list", { sender: contents, senderFrame: { url: "app://panel/" } }, {})).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await bridge.handle("users.list", event, { actorId: owner.user.id, permissions: ["plataforma.usuarios.ver"] })).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    await bridge.dispose();
    expect((await service.execute("auth.me", undefined, internalSession)).result).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(await bridge.handle("auth.me", event)).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("la auditoría tampoco admite reemplazar un evento existente con INSERT OR REPLACE", async () => {
    const [event] = await db.query<{ id: string }>("SELECT id FROM panel_audit_events ORDER BY id LIMIT 1", { type: QueryTypes.SELECT });
    await expect(db.query(
      "INSERT OR REPLACE INTO panel_audit_events(id,occurredAt,actorId,action,targetId,outcome,requestId) SELECT id,occurredAt,actorId,'tampered',targetId,outcome,requestId FROM panel_audit_events WHERE id=$id",
      { bind: { id: event.id } },
    )).rejects.toThrow();
    const [preserved] = await db.query<{ action: string }>("SELECT action FROM panel_audit_events WHERE id=$id", { bind: { id: event.id }, type: QueryTypes.SELECT });
    expect(preserved.action).not.toBe("tampered");
  });

  it("un login válido de consulta no reinicia los intentos fallidos contra el propietario", async () => {
    data(await service.execute("users.create", { login: "viewer", displayName: "Consulta", password, roleCodes: ["viewer"] }, ownerSession));
    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await service.execute("auth.login", { login: "owner", password: "Otra frase equivocada" })).result)
        .toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    }
    const viewer = await service.execute("auth.login", { login: "viewer", password }); data(viewer);
    expect((await service.execute("auth.login", { login: "owner", password: "Otra frase equivocada" })).result)
      .toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect((await service.execute("auth.login", { login: "owner", password })).result)
      .toMatchObject({ error: { code: "RATE_LIMITED", retryAfterMs: expect.any(Number) } });
  });
});
