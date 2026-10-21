import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { QueryTypes, type Sequelize } from "sequelize";
import type { UserDto } from "../../../contracts/access";
import { AccessService, type AccessExecution } from "../../modules/access/service";
import { createPanelDatabase } from "./database";
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from "./migrations";
import { isPathInside } from "./path-safety";

export const ACCESS_DEMO_PASSWORD = "Demo-panel-2026-seguro";
export const ACCESS_DEMO_USERS = [
  { id: "00000000-0000-4000-8000-000000000001", login: "owner.demo", displayName: "Propietario demo", roleCodes: ["owner"], active: true },
  { id: "00000000-0000-4000-8000-000000000002", login: "cobranza.demo", displayName: "Cobranza demo", roleCodes: ["collections"], active: true },
  { id: "00000000-0000-4000-8000-000000000003", login: "consulta.demo", displayName: "Consulta demo", roleCodes: ["viewer"], active: true },
  { id: "00000000-0000-4000-8000-000000000004", login: "inactivo.demo", displayName: "Usuario demo inactivo", roleCodes: ["viewer"], active: false },
] as const;
const SCENARIO = "access-v1";
export interface DemoOptions { projectRoot: string }
export interface DemoResult { created: boolean; storage: string }

function rejectDemo(): never {
  throw new Error("Destino demo rechazado: use exclusivamente la base dedicada de acceso, nueva o marcada por este comando.");
}

// Resolve an existing ancestor before creating directories, so a junction cannot route the target into the repo.
async function canonicalTarget(target: string): Promise<string> {
  let ancestor = target;
  const missing: string[] = [];
  for (;;) {
    try { return join(await realpath(ancestor), ...missing.reverse()); }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(basename(ancestor));
      ancestor = parent;
    }
  }
}

async function validateDestination(storage: string, projectRoot: string): Promise<string> {
  if (!isAbsolute(storage)) rejectDemo();
  const target = resolve(storage);
  if (basename(target) !== "panel-access-demo.sqlite3" || basename(dirname(target)) !== "panel-access-demo") rejectDemo();
  if (isPathInside(projectRoot, target)) rejectDemo();
  const canonicalRoot = await realpath(projectRoot);
  if (isPathInside(canonicalRoot, await canonicalTarget(target))) rejectDemo();
  return target;
}

async function readMarkers(db: Sequelize): Promise<Record<string, string>> {
  try {
    const rows = await db.query<{ key: string; value: string }>(
      "SELECT key, value FROM panel_system_metadata", { type: QueryTypes.SELECT },
    );
    return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  } catch { return rejectDemo(); }
}

async function writeMarker(db: Sequelize, key: string, value: string): Promise<void> {
  await db.query("INSERT INTO panel_system_metadata (key, value) VALUES ($key, $value)", { bind: { key, value } });
}

async function fingerprint(db: Sequelize): Promise<string> {
  const queries = [
    "SELECT id, login, displayName, passwordHash, active, version FROM panel_access_users ORDER BY id",
    "SELECT userId, roleCode FROM panel_access_user_roles ORDER BY userId, roleCode",
    "SELECT code, name FROM panel_access_roles ORDER BY code",
    "SELECT roleCode, permission FROM panel_access_role_permissions ORDER BY roleCode, permission",
    "SELECT userId, verifier FROM panel_access_recovery ORDER BY userId",
  ];
  const content: unknown[] = [];
  for (const query of queries) content.push(await db.query(query, { type: QueryTypes.SELECT }));
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function expectSuccess(execution: AccessExecution): unknown {
  if (!execution.result.ok) throw new Error(`No se pudo preparar la demo: ${execution.result.error.code}.`);
  return execution.result.data;
}

async function populate(db: Sequelize): Promise<void> {
  let nextUser = 0;
  const service = new AccessService(db, {
    createUserId: () => {
      const user = ACCESS_DEMO_USERS[nextUser++];
      if (!user) throw new Error("Escenario demo inconsistente.");
      return user.id;
    },
  });
  const owner = ACCESS_DEMO_USERS[0];
  expectSuccess(await service.execute("auth.bootstrap", {
    login: owner.login, displayName: owner.displayName, password: ACCESS_DEMO_PASSWORD,
  }));
  const login = await service.execute("auth.login", { login: owner.login, password: ACCESS_DEMO_PASSWORD });
  expectSuccess(login);
  if (!login.sessionId) throw new Error("No se pudo iniciar la sesión técnica demo.");
  try {
    for (const user of ACCESS_DEMO_USERS.slice(1)) {
      const dto = expectSuccess(await service.execute("users.create", {
        login: user.login, displayName: user.displayName, password: ACCESS_DEMO_PASSWORD, roleCodes: [...user.roleCodes],
      }, login.sessionId)) as UserDto;
      if (!user.active) expectSuccess(await service.execute("users.disable", { id: dto.id, expectedVersion: dto.version }, login.sessionId));
    }
  } finally {
    expectSuccess(await service.execute("auth.logout", undefined, login.sessionId));
  }
}

export async function seedAccessDemo(storage: string, { projectRoot }: DemoOptions): Promise<DemoResult> {
  const target = await validateDestination(storage, projectRoot);
  let exists = false;
  try {
    const entry = await lstat(target);
    if (!entry.isFile() || entry.isSymbolicLink()) rejectDemo();
    exists = true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (!exists) {
    await mkdir(dirname(target), { recursive: true });
    // Exclusive ownership of the new file; a concurrent command cannot both initialize the scenario.
    const file = await open(target, "wx");
    await file.close();
  }
  const db = createPanelDatabase({ storage: target });
  try {
    if (exists) {
      const markers = await readMarkers(db);
      if (markers.application !== "panel-administrativo" || markers.environment !== "demo" || markers.access_demo_scenario !== SCENARIO || !markers.access_demo_fingerprint) rejectDemo();
      const [schema] = await db.query<{ version: number }>("SELECT MAX(version) AS version FROM panel_schema_migrations", { type: QueryTypes.SELECT });
      if (schema?.version !== CURRENT_SCHEMA_VERSION) rejectDemo();
      if (markers.access_demo_fingerprint !== await fingerprint(db)) {
        throw new Error("Conflicto demo: el escenario contiene cambios manuales; no se modificó su contenido.");
      }
      return { created: false, storage: target };
    }

    await migrateDatabase(db);
    await writeMarker(db, "environment", "demo");
    await writeMarker(db, "access_demo_scenario", SCENARIO);
    await populate(db);
    await writeMarker(db, "access_demo_fingerprint", await fingerprint(db));
    return { created: true, storage: target };
  } finally { await db.close(); }
}
