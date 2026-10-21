import { DataTypes, type QueryInterface, type Transaction } from "sequelize";
import { ACCESS_PERMISSIONS } from "../../../contracts/access";

export async function migrateAccess(q: QueryInterface, transaction: Transaction): Promise<void> {
  const required = (type: typeof DataTypes.STRING | typeof DataTypes.INTEGER | typeof DataTypes.BOOLEAN | typeof DataTypes.TEXT | typeof DataTypes.BIGINT) => ({ type, allowNull: false });
  const userReference = { type: DataTypes.UUID, allowNull: false, references: { model: "panel_access_users", key: "id" } };
  const roleReference = { type: DataTypes.STRING, allowNull: false, references: { model: "panel_access_roles", key: "code" } };
  await q.createTable("panel_access_users", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    login: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    displayName: required(DataTypes.STRING), passwordHash: required(DataTypes.TEXT),
    active: required(DataTypes.BOOLEAN), version: required(DataTypes.INTEGER),
  }, { transaction });
  await q.createTable("panel_access_roles", { code: { ...required(DataTypes.STRING), primaryKey: true }, name: required(DataTypes.STRING) }, { transaction });
  await q.createTable("panel_access_permissions", { code: { ...required(DataTypes.STRING), primaryKey: true } }, { transaction });
  await q.createTable("panel_access_user_roles", { userId: { ...userReference, primaryKey: true }, roleCode: { ...roleReference, primaryKey: true } }, { transaction });
  await q.createTable("panel_access_role_permissions", {
    roleCode: { ...roleReference, primaryKey: true },
    permission: { ...required(DataTypes.STRING), primaryKey: true, references: { model: "panel_access_permissions", key: "code" } },
  }, { transaction });
  await q.createTable("panel_access_sessions", {
    verifier: { ...required(DataTypes.STRING), primaryKey: true }, userId: userReference,
    createdAt: required(DataTypes.BIGINT), lastActivityAt: required(DataTypes.BIGINT), expiresAt: required(DataTypes.BIGINT), revoked: required(DataTypes.BOOLEAN),
  }, { transaction });
  await q.addIndex("panel_access_sessions", ["userId"], { transaction });
  await q.createTable("panel_access_recovery", { userId: { ...userReference, primaryKey: true }, verifier: required(DataTypes.STRING) }, { transaction });
  await q.createTable("panel_access_attempts", {
    operation: { ...required(DataTypes.STRING), primaryKey: true }, failures: required(DataTypes.INTEGER), nextAllowedAt: required(DataTypes.BIGINT),
  }, { transaction });
  await q.createTable("panel_audit_events", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false }, occurredAt: required(DataTypes.STRING),
    actorId: { type: DataTypes.UUID, allowNull: true, references: { model: "panel_access_users", key: "id" } },
    action: required(DataTypes.STRING), targetId: { type: DataTypes.UUID, allowNull: true },
    outcome: required(DataTypes.STRING), requestId: required(DataTypes.STRING),
  }, { transaction });
  await q.addIndex("panel_audit_events", ["occurredAt", "id"], { transaction });
  await q.bulkInsert("panel_access_roles", [{ code: "owner", name: "Propietario" }, { code: "collections", name: "Cobranza" }, { code: "viewer", name: "Consulta" }], { transaction });
  await q.bulkInsert("panel_access_permissions", ACCESS_PERMISSIONS.map(code => ({ code })), { transaction });
  await q.bulkInsert("panel_access_role_permissions", ACCESS_PERMISSIONS.map(permission => ({ roleCode: "owner", permission })), { transaction });
  await q.sequelize.query("CREATE UNIQUE INDEX panel_users_login_nocase ON panel_access_users(login COLLATE NOCASE)", { transaction });
  for (const operation of ["UPDATE", "DELETE"]) {
    await q.sequelize.query(`CREATE TRIGGER panel_audit_no_${operation.toLowerCase()} BEFORE ${operation} ON panel_audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END`, { transaction });
  }
  // SQLite REPLACE skips delete triggers unless recursive_triggers is enabled.
  // Reject duplicate IDs before insertion, including INSERT OR REPLACE.
  await q.sequelize.query("CREATE TRIGGER panel_audit_no_replace BEFORE INSERT ON panel_audit_events WHEN EXISTS (SELECT 1 FROM panel_audit_events WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END", { transaction });
}
