import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryTypes, type Sequelize } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPanelDatabase } from "../../src/backend/infrastructure/database/database";
import { migrateDatabase, SYSTEM_MIGRATIONS } from "../../src/backend/infrastructure/database/migrations";
import { AccessService, type AccessExecution } from "../../src/backend/modules/access/service";
import type { AccessOperation, BootstrapResult, UserDto } from "../../src/contracts/access";

const password = "Frase larga de pruebas segura";
function data<T>(reply: AccessExecution): T {
  expect(reply.result.ok, JSON.stringify(reply.result)).toBe(true);
  if (!reply.result.ok) throw new Error(reply.result.error.code);
  return reply.result.data as T;
}
describe("Acceso nativo SQLite real", () => {
  let directory: string; let db: Sequelize; let service: AccessService; let now: number;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "panel-access-"));
    db = createPanelDatabase({ storage: join(directory, "access.sqlite3") });
    await migrateDatabase(db);
    now = Date.UTC(2026, 9, 20); service = new AccessService(db, { now: () => now });
  });
  afterEach(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });
  const bootstrapInput = { login: "owner", displayName: "Propietario prueba", password };
  async function owner() {
    const bootstrap = data<BootstrapResult>(await service.execute("auth.bootstrap", bootstrapInput));
    const login = await service.execute("auth.login", { login: "owner", password });
    data(login); expect(login.sessionId).toEqual(expect.any(String));
    return { bootstrap, session: login.sessionId! };
  }
  it("bootstrap es único incluso en carrera y no entrega sesión ni hashes", async () => {
    const replies = await Promise.all([service.execute("auth.bootstrap", bootstrapInput), service.execute("auth.bootstrap", bootstrapInput)]);
    expect(replies.filter(reply => reply.result.ok)).toHaveLength(1);
    const first = replies.find(reply => reply.result.ok)!;
    expect(first.sessionId).toBeUndefined();
    const created = data<BootstrapResult>(first);
    expect(created.recoveryKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(created.user)).not.toMatch(/password|hash|recovery|session/i);
    expect(replies.find(reply => !reply.result.ok)?.result).toMatchObject({ error: { code: "CONFLICT" } });
  });
  it("deniega a consulta y protege el último propietario con versiones", async () => {
    const { bootstrap, session } = await owner();
    const viewer = data<UserDto>(await service.execute("users.create", { login: "viewer", displayName: "Consulta", password, roleCodes: ["viewer"] }, session));
    const viewerLogin = await service.execute("auth.login", { login: "viewer", password });
    expect((await service.execute("users.list", {}, viewerLogin.sessionId)).result).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect((await service.execute("roles.assign", { id: viewer.id, expectedVersion: 1, roleCodes: ["owner"] }, viewerLogin.sessionId)).result).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect((await service.execute("users.disable", { id: bootstrap.user.id, expectedVersion: 1 }, session)).result).toMatchObject({ error: { code: "LAST_ADMIN_REQUIRED" } });
    expect((await service.execute("users.update", { id: viewer.id, expectedVersion: 999, login: "viewer", displayName: "Edit", active: true }, session)).result).toMatchObject({ error: { code: "CONFLICT" } });
  });
  it("expira por inactividad sin renovar con polling, touch respeta 8h y retroceso invalida", async () => {
    const { session } = await owner();
    now += 14 * 60_000; data(await service.execute("auth.me", undefined, session));
    now += 60_000;
    expect((await service.execute("auth.me", undefined, session)).result).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    const login = await service.execute("auth.login", { login: "owner", password });
    for (let index = 0; index < 34; index++) { now += 14 * 60_000; data(await service.execute("auth.touch", undefined, login.sessionId)); }
    now += 4 * 60_000;
    expect((await service.execute("auth.touch", undefined, login.sessionId)).result).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    const again = await service.execute("auth.login", { login: "owner", password }); now--;
    expect((await service.execute("auth.me", undefined, again.sessionId)).result).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });
  it("recupera una vez en carrera, rota secreto y revoca sesiones", async () => {
    const { bootstrap, session } = await owner();
    const request = { login: "owner", recoveryKey: bootstrap.recoveryKey, newPassword: "Otra frase nueva segura" };
    const replies = await Promise.all([service.execute("auth.recover", request), service.execute("auth.recover", request)]);
    expect(replies.filter(reply => reply.result.ok)).toHaveLength(1);
    expect((await service.execute("auth.me", undefined, session)).result).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect((await service.execute("auth.login", { login: "owner", password })).result).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    data(await service.execute("auth.login", { login: "owner", password: request.newPassword }));
  });
  it("persiste rate global entre instancias y peticiones limitadas no prolongan espera", async () => {
    await owner();
    for (let index = 0; index < 5; index++) expect((await service.execute("auth.login", { login: `unknown${index}`, password })).result).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    service = new AccessService(db, { now: () => now });
    expect((await service.execute("auth.login", { login: "owner", password })).result).toMatchObject({ error: { code: "RATE_LIMITED", retryAfterMs: 1000 } });
    now += 500;
    expect((await service.execute("auth.login", { login: "owner", password })).result).toMatchObject({ error: { retryAfterMs: 500 } });
    now += 500; data(await service.execute("auth.login", { login: "owner", password }));
  });
  it("rechaza campos actor/session/roles falsos y límites inválidos", async () => {
    const { session } = await owner();
    const cases: [AccessOperation, unknown][] = [["auth.login", { login: "owner", password, actorId: "x" }], ["auth.me", { sessionId: session }], ["users.list", { pageSize: 101 }], ["users.create", { login: "bad", displayName: "Bad", password: "x".repeat(129), roleCodes: ["viewer"] }]];
    for (const [operation, input] of cases) expect((await service.execute(operation, input, session)).result).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
  it("rechaza login duplicado normalizado como conflicto sin filtrar SQL", async () => {
    const { session } = await owner();
    const reply = await service.execute("users.create", { login: " OWNER ", displayName: "Duplicado", password, roleCodes: ["viewer"] }, session);
    expect(reply.result).toMatchObject({ error: { code: "CONFLICT" } });
    expect(JSON.stringify(reply.result)).not.toMatch(/SQLITE|UNIQUE|INSERT|passwordHash/);
  });
  it("auditoría append-only y fallo de inserción revierte usuario", async () => {
    const { session } = await owner();
    await expect(db.query("DELETE FROM panel_audit_events")).rejects.toThrow();
    await expect(db.query("UPDATE panel_audit_events SET action='tampered'")).rejects.toThrow();
    await db.query("CREATE TRIGGER reject_audit BEFORE INSERT ON panel_audit_events BEGIN SELECT RAISE(ABORT, 'test'); END");
    expect((await service.execute("users.create", { login: "rollback", displayName: "Rollback", password, roleCodes: ["viewer"] }, session)).result).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    const rows = await db.query("SELECT id FROM panel_access_users WHERE login='rollback'", { type: QueryTypes.SELECT }); expect(rows).toHaveLength(0);
  });
  it("migra v1 a v2 sin perder metadata y repetición conserva acceso", async () => {
    const previousDb = createPanelDatabase({ storage: join(directory, "v1.sqlite3") });
    try {
      await migrateDatabase(previousDb, SYSTEM_MIGRATIONS.slice(0, 1));
      await previousDb.query("INSERT INTO panel_system_metadata(key,value) VALUES('preserve','yes')");
      await migrateDatabase(previousDb); await migrateDatabase(previousDb);
      expect(await previousDb.query("SELECT value FROM panel_system_metadata WHERE key='preserve'", { type: QueryTypes.SELECT })).toEqual([{ value: "yes" }]);
      const migrated = new AccessService(previousDb); data(await migrated.execute("auth.bootstrap", bootstrapInput));
    } finally { await previousDb.close(); }
  });
});
