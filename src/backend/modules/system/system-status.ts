import { randomUUID } from "node:crypto";
import { QueryTypes, type Sequelize } from "sequelize";
import { failure, type Result } from "../../../contracts/result";
import type { SystemStatus } from "../../../contracts/system-status";
import { CURRENT_SCHEMA_VERSION } from "../../infrastructure/database/migrations";

interface SchemaVersionRow {
  schemaVersion: number;
}

interface MetadataRow {
  value: string;
}

export async function readSystemStatus(sequelize: Sequelize, appVersion: string): Promise<Result<SystemStatus>> {
  const requestId = randomUUID();
  try {
    await sequelize.authenticate();
    const [schema] = await sequelize.query<SchemaVersionRow>(
      "SELECT MAX(version) AS schemaVersion FROM panel_schema_migrations",
      { type: QueryTypes.SELECT },
    );
    if (!schema || schema.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error("Schema is not current");

    const [metadata] = await sequelize.query<MetadataRow>(
      "SELECT value FROM panel_system_metadata WHERE key = $key",
      { bind: { key: "application" }, type: QueryTypes.SELECT },
    );
    if (!metadata || metadata.value !== "panel-administrativo") throw new Error("Metadata is invalid");

    return {
      ok: true,
      data: {
        appVersion,
        schemaVersion: schema.schemaVersion,
        database: "ready",
        mode: "local",
      },
      requestId,
    };
  } catch {
    return failure("INTERNAL_ERROR", "No se pudo consultar el estado de la base de datos local.", requestId);
  }
}
