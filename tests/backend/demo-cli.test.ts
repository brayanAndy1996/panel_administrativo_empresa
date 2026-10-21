import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPanelDatabase } from "../../src/backend/infrastructure/database/database";

describe("entrypoint real de la CLI demo", () => {
  let directory: string;
  const executable = resolve("dist/backend/demo.cjs");
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "panel-demo-cli-test-")); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("crea usuarios reales por subprocess y una segunda ejecución no duplica ni cambia la BD", async () => {
    const storage = join(directory, "panel-access-demo", "panel-access-demo.sqlite3");
    const first = spawnSync(process.execPath, [executable, "--database", storage], { encoding: "utf8" });
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("Demo de acceso creada");
    expect(first.stdout).toContain("owner.demo");
    const before = await readFile(storage);
    const second = spawnSync(process.execPath, [executable, "--database", storage], { encoding: "utf8" });
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("verificada sin cambios");
    expect(await readFile(storage)).toEqual(before);
    const db = createPanelDatabase({ storage });
    try {
      const [result] = await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM panel_access_users", { type: QueryTypes.SELECT });
      expect(result?.count).toBe(4);
    } finally { await db.close(); }
  });

  it("sin destino explícito falla sin usar una base predeterminada", () => {
    const result = spawnSync(process.execPath, [executable], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--database");
  });
});
