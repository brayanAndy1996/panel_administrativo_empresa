import { DataTypes, QueryTypes, type QueryInterface, type Sequelize, type Transaction } from "sequelize";
import { migrateAccess } from "./access-migration";

const MIGRATION_TABLE = "panel_schema_migrations";

export interface Migration {
  version: number;
  name: string;
  up(queryInterface: QueryInterface, transaction: Transaction): Promise<void>;
}

export class UnknownSchemaVersionError extends Error {
  constructor() {
    super("La base contiene una versión de esquema desconocida.");
    this.name = "UnknownSchemaVersionError";
  }
}

export class UnmanagedDatabaseError extends Error {
  constructor() {
    super("La base contiene tablas que no pertenecen al esquema del panel.");
    this.name = "UnmanagedDatabaseError";
  }
}

export const SYSTEM_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial_system_metadata",
    async up(queryInterface, transaction) {
      await queryInterface.createTable(
        "panel_system_metadata",
        {
          key: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
          value: { type: DataTypes.STRING(256), allowNull: false },
        },
        { transaction },
      );
      await queryInterface.bulkInsert(
        "panel_system_metadata",
        [{ key: "application", value: "panel-administrativo" }],
        { transaction },
      );
    },
  },
  { version: 2, name: "native_access_authorization_audit", up: migrateAccess },
];

export const CURRENT_SCHEMA_VERSION = SYSTEM_MIGRATIONS.at(-1)?.version ?? 0;

interface AppliedMigration {
  version: number;
  name: string;
}

function normalizeTableNames(tables: Array<string | { tableName: string }>): string[] {
  return tables.map((table) => (typeof table === "string" ? table : table.tableName));
}

function assertMigrationDefinitions(migrations: readonly Migration[]): void {
  let previousVersion = 0;
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= previousVersion || !migration.name) {
      throw new Error("Las migraciones deben tener versiones enteras, únicas y ordenadas.");
    }
    previousVersion = migration.version;
  }
}

async function readAppliedMigrations(sequelize: Sequelize): Promise<AppliedMigration[]> {
  return sequelize.query<AppliedMigration>(
    `SELECT version, name FROM ${MIGRATION_TABLE} ORDER BY version`,
    { type: QueryTypes.SELECT },
  );
}

export async function migrateDatabase(
  sequelize: Sequelize,
  migrations: readonly Migration[] = SYSTEM_MIGRATIONS,
): Promise<number> {
  assertMigrationDefinitions(migrations);
  await sequelize.authenticate();

  const queryInterface = sequelize.getQueryInterface();
  const tables = normalizeTableNames(await queryInterface.showAllTables());
  let hasMigrationTable = tables.includes(MIGRATION_TABLE);
  if (!hasMigrationTable && tables.length > 0) throw new UnmanagedDatabaseError();
  const applied = hasMigrationTable ? await readAppliedMigrations(sequelize) : [];
  if (hasMigrationTable && applied.length === 0) throw new UnknownSchemaVersionError();
  const known = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const record of applied) {
    const migration = known.get(record.version);
    if (!migration || migration.name !== record.name) throw new UnknownSchemaVersionError();
  }

  if (applied.length > migrations.length) throw new UnknownSchemaVersionError();
  for (let index = 0; index < applied.length; index += 1) {
    if (applied[index]?.version !== migrations[index]?.version) throw new UnknownSchemaVersionError();
  }

  const appliedVersions = new Set(applied.map((record) => record.version));
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    await sequelize.transaction(async (transaction) => {
      if (!hasMigrationTable) {
        await queryInterface.createTable(
          MIGRATION_TABLE,
          {
            version: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
            name: { type: DataTypes.STRING(128), allowNull: false },
            appliedAt: { type: DataTypes.DATE, allowNull: false },
          },
          { transaction },
        );
        hasMigrationTable = true;
      }

      await migration.up(queryInterface, transaction);
      await queryInterface.bulkInsert(
        MIGRATION_TABLE,
        [{ version: migration.version, name: migration.name, appliedAt: new Date() }],
        { transaction },
      );
    });
  }

  return migrations.at(-1)?.version ?? 0;
}
