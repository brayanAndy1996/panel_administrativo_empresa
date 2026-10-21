import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataTypes, QueryTypes, type QueryInterface, type Sequelize, type Transaction } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPanelDatabase } from "../../src/backend/infrastructure/database/database";
import {
  CURRENT_SCHEMA_VERSION,
  migrateDatabase,
  UnmanagedDatabaseError,
  UnknownSchemaVersionError,
  type Migration,
} from "../../src/backend/infrastructure/database/migrations";
import { readSystemStatus } from "../../src/backend/modules/system/system-status";

describe("SQLite técnica del panel", () => {
  let directory: string;
  let database: Sequelize;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "panel-db-test-"));
    database = createPanelDatabase({ storage: join(directory, "panel.sqlite3") });
  });

  afterEach(async () => {
    await database?.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("aplica la metadata una sola vez y reporta el esquema leído desde SQLite", async () => {
    await migrateDatabase(database);
    const firstStatus = await readSystemStatus(database, "0.1.0-test");
    const firstRows = await database.query<{ version: number }>(
      "SELECT version FROM panel_schema_migrations ORDER BY version",
      { type: QueryTypes.SELECT },
    );

    await migrateDatabase(database);
    const secondStatus = await readSystemStatus(database, "0.1.0-test");
    const secondRows = await database.query<{ version: number }>(
      "SELECT version FROM panel_schema_migrations ORDER BY version",
      { type: QueryTypes.SELECT },
    );

    expect(firstStatus).toMatchObject({
      ok: true,
      data: {
        appVersion: "0.1.0-test",
        schemaVersion: CURRENT_SCHEMA_VERSION,
        database: "ready",
        mode: "local",
      },
    });
    expect(secondStatus).toMatchObject({ ok: true, data: firstStatus.ok ? firstStatus.data : undefined });
    expect(firstStatus.requestId).not.toBe(secondStatus.requestId);
    expect(firstStatus.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondStatus.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstRows.map((row) => row.version)).toEqual([1, 2]);
    expect(secondRows).toEqual(firstRows);
  });

  it("rechaza una versión de esquema futura sin cambiar la base", async () => {
    await migrateDatabase(database);
    await database.query(
      "INSERT INTO panel_schema_migrations (version, name, appliedAt) VALUES (99, 'future', CURRENT_TIMESTAMP)",
    );

    await expect(migrateDatabase(database)).rejects.toBeInstanceOf(UnknownSchemaVersionError);
    const rows = await database.query<{ version: number }>(
      "SELECT version FROM panel_schema_migrations ORDER BY version",
      { type: QueryTypes.SELECT },
    );
    const status = await readSystemStatus(database, "0.1.0-test");

    expect(rows.map((row) => row.version)).toEqual([1, 2, 99]);
    expect(status).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(status)).not.toMatch(/future|panel-db-test|sqlite/i);
  });

  it("rechaza una SQLite no vacía ajena al panel sin modificar tablas ni datos", async () => {
    await database.query("CREATE TABLE foreign_table (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    await database.query("INSERT INTO foreign_table (value) VALUES ('preserve-me')");
    const beforeTables = await database.getQueryInterface().showAllTables();

    await expect(migrateDatabase(database)).rejects.toBeInstanceOf(UnmanagedDatabaseError);

    const rows = await database.query<{ value: string }>("SELECT value FROM foreign_table", {
      type: QueryTypes.SELECT,
    });
    const afterTables = await database.getQueryInterface().showAllTables();
    expect(afterTables).toEqual(beforeTables);
    expect(rows).toEqual([{ value: "preserve-me" }]);
  });

  it("no declara saludable una metadata sin el resto del esquema versionado", async () => {
    await database.query(
      "CREATE TABLE panel_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt DATETIME NOT NULL)",
    );
    await database.query(
      "INSERT INTO panel_schema_migrations (version, name, appliedAt) VALUES (1, 'initial_system_metadata', CURRENT_TIMESTAMP)",
    );

    const result = await readSystemStatus(database, "0.1.0-test");

    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(result)).not.toMatch(/panel-db-test|SQLite|schema|metadata|SELECT/i);
  });

  it("revierte el DDL y el registro cuando una migración falla", async () => {
    const failingMigration: Migration = {
      version: 1,
      name: "intentional_failure",
      up: async (queryInterface: QueryInterface, transaction: Transaction) => {
        await queryInterface.createTable(
          "partial_technical_table",
          { id: { type: DataTypes.INTEGER, primaryKey: true } },
          { transaction },
        );
        throw new Error("failure at C:\\private\\panel.sqlite3; SELECT secret");
      },
    };

    await expect(migrateDatabase(database, [failingMigration])).rejects.toThrow(/failure at/);

    const tables = await database.getQueryInterface().showAllTables();
    expect(tables).not.toContain("partial_technical_table");
    expect(tables).not.toContain("panel_schema_migrations");
  });

  it("devuelve un error genérico si falta el esquema técnico", async () => {
    const result = await readSystemStatus(database, "0.1.0-test");

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: expect.any(String),
      },
      requestId: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toMatch(/panel-db-test|sqlite|SELECT|stack/i);
  });
});
