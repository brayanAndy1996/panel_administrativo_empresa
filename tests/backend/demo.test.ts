import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedAccessDemo } from "../../src/backend/infrastructure/database/demo";
import { createPanelDatabase } from "../../src/backend/infrastructure/database/database";
import { migrateDatabase } from "../../src/backend/infrastructure/database/migrations";
import { AccessService } from "../../src/backend/modules/access/service";
import { ACCESS_DEMO_PASSWORD, ACCESS_DEMO_USERS } from "../../src/backend/infrastructure/database/demo";

describe("demo de acceso dedicada y no destructiva", () => {
  let directory: string;
  let storage: string;
  const options = { projectRoot: resolve(".") };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "panel-demo-test-"));
    const destination = join(directory, "panel-access-demo");
    await mkdir(destination);
    storage = join(destination, "panel-access-demo.sqlite3");
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("crea cuatro usuarios del escenario y repetir no cambia la base", async () => {
    expect(await seedAccessDemo(storage, options)).toMatchObject({ created: true });
    const before = await readFile(storage);
    expect(await seedAccessDemo(storage, options)).toMatchObject({ created: false });
    expect(await readFile(storage)).toEqual(before);
    const db = createPanelDatabase({ storage });
    try {
      const users = await db.query<{ login: string; active: number }>(
        "SELECT login, active FROM panel_access_users ORDER BY login", { type: QueryTypes.SELECT },
      );
      expect(users).toEqual([
        { login: "cobranza.demo", active: 1 }, { login: "consulta.demo", active: 1 },
        { login: "inactivo.demo", active: 0 }, { login: "owner.demo", active: 1 },
      ]);
      const ids = await db.query<{ id: string }>("SELECT id FROM panel_access_users ORDER BY id", { type: QueryTypes.SELECT });
      expect(ids.map(({ id }) => id)).toEqual(ACCESS_DEMO_USERS.map(({ id }) => id));
      const service = new AccessService(db);
      for (const user of ACCESS_DEMO_USERS) {
        const execution = await service.execute("auth.login", { login: user.login, password: ACCESS_DEMO_PASSWORD });
        expect(execution.result.ok).toBe(user.active);
        if (user.active) {
          expect(execution.sessionId).toBeTruthy();
          await service.execute("auth.logout", undefined, execution.sessionId);
        } else expect(execution.result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
      }
    } finally { await db.close(); }
    const afterUse = await readFile(storage);
    expect(await seedAccessDemo(storage, options)).toMatchObject({ created: false });
    expect(await readFile(storage)).toEqual(afterUse);
  });

  it("rechaza una base normal migrada aunque no tenga usuarios y preserva sus bytes", async () => {
    const db = createPanelDatabase({ storage });
    try { await migrateDatabase(db); } finally { await db.close(); }
    const before = await readFile(storage);
    await expect(seedAccessDemo(storage, options)).rejects.toThrow(/demo/i);
    expect(await readFile(storage)).toEqual(before);
  });

  it("rechaza archivos existentes no marcados sin cambiarlos", async () => {
    await writeFile(storage, "datos ajenos que deben conservarse");
    const before = await readFile(storage);
    await expect(seedAccessDemo(storage, options)).rejects.toThrow(/demo/i);
    expect(await readFile(storage)).toEqual(before);
  });

  it("un marcador de ambiente aislado no convierte una base normal en demo", async () => {
    const db = createPanelDatabase({ storage });
    try {
      await migrateDatabase(db);
      await db.query("INSERT INTO panel_system_metadata (key, value) VALUES ('environment', 'demo')");
    } finally { await db.close(); }
    const before = await readFile(storage);
    await expect(seedAccessDemo(storage, options)).rejects.toThrow(/demo/i);
    expect(await readFile(storage)).toEqual(before);
  });

  it("rechaza un ancestro enlazado al proyecto antes de crear directorios", async ({ skip }) => {
    const protectedProject = join(directory, "protected-project");
    const linkedProject = join(directory, "project-link");
    await mkdir(protectedProject);
    try { await symlink(protectedProject, linkedProject, "junction"); }
    catch (error: unknown) {
      // The sandbox may forbid creating junctions; keep this case runnable on a host that supports them.
      if ((error as NodeJS.ErrnoException).code === "EPERM") { skip(); return; }
      throw error;
    }
    await expect(seedAccessDemo(join(linkedProject, "panel-access-demo", "panel-access-demo.sqlite3"), { projectRoot: protectedProject }))
      .rejects.toThrow(/demo/i);
    await expect(lstat(join(protectedProject, "panel-access-demo"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rechaza rutas relativas, nombres no dedicados y destinos dentro del proyecto", async () => {
    await expect(seedAccessDemo("panel-access-demo.sqlite3", options)).rejects.toThrow();
    await expect(seedAccessDemo(join(directory, "normal.sqlite3"), options)).rejects.toThrow();
    await expect(seedAccessDemo(resolve("panel-access-demo", "panel-access-demo.sqlite3"), options)).rejects.toThrow();
  });

  it("detecta cambios manuales y no los sobrescribe", async () => {
    await seedAccessDemo(storage, options);
    const db = createPanelDatabase({ storage });
    try {
      await db.query("UPDATE panel_access_users SET displayName = 'Editado' WHERE login = 'consulta.demo'");
    } finally { await db.close(); }
    const before = await readFile(storage);
    await expect(seedAccessDemo(storage, options)).rejects.toThrow(/conflicto/i);
    expect(await readFile(storage)).toEqual(before);
  });
});
