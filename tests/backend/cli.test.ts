import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPanelDatabase } from "../../src/backend/infrastructure/database/database";

describe("comando explícito de migración", () => {
  let directory: string;
  const cli = resolve("dist/backend/migrate.cjs");

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "panel-cli-test-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("crea y migra solo el destino absoluto solicitado", async () => {
    const storage = join(directory, "cli.sqlite3");
    const result = spawnSync(process.execPath, [cli, "--database", storage], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Migración local completada");
    expect(result.stderr).toBe("");

    const database = createPanelDatabase({ storage });
    try {
      const versions = await database.query<{ version: number; name: string }>(
        "SELECT version, name FROM panel_schema_migrations ORDER BY version",
        { type: QueryTypes.SELECT },
      );
      const tables = await database.getQueryInterface().showAllTables();
      expect(versions).toEqual([
        { version: 1, name: "initial_system_metadata" },
        { version: 2, name: "native_access_authorization_audit" },
      ]);
      expect(tables).toContain("panel_system_metadata");
      const metadata = await database.query<{ value: string }>(
        "SELECT value FROM panel_system_metadata WHERE key = 'application'",
        { type: QueryTypes.SELECT },
      );
      expect(metadata).toEqual([{ value: "panel-administrativo" }]);
    } finally {
      await database.close();
    }
  });

  it.each(["should-not-exist.sqlite3", "..panel.sqlite3"])(
    "rechaza el archivo interno %s antes de crearlo",
    async (filename) => {
      const storage = resolve("tests", filename);
      const result = spawnSync(process.execPath, [cli, "--database", storage], { encoding: "utf8" });

      try {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("fuera del proyecto");
        await expect(access(storage)).rejects.toThrow();
      } finally {
        await rm(storage, { force: true });
      }
    },
  );

  it("requiere un destino explícito y no crea una ruta predeterminada", () => {
    const result = spawnSync(process.execPath, [cli], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--database");
  });
});
