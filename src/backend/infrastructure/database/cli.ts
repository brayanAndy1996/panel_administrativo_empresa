import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { createPanelDatabase } from "./database";
import { migrateDatabase } from "./migrations";
import { isPathInside } from "./path-safety";

function parseDatabasePath(args: string[]): string {
  if (args.length !== 2 || args[0] !== "--database" || !args[1]) {
    throw new Error('Uso: npm run db:migrate -- --database "<ruta absoluta fuera del proyecto>"');
  }

  if (!isAbsolute(args[1])) throw new Error("La ruta de la base de datos debe ser absoluta.");
  const target = resolve(args[1]);
  const projectRoot = resolve(__dirname, "../../");
  if (isPathInside(projectRoot, target)) {
    throw new Error("La base de datos debe ubicarse fuera del proyecto.");
  }
  return target;
}

export async function runMigrationCli(args: string[]): Promise<void> {
  const storage = parseDatabasePath(args);
  await mkdir(dirname(storage), { recursive: true });
  const sequelize = createPanelDatabase({ storage });
  try {
    await migrateDatabase(sequelize);
    process.stdout.write("Migración local completada.\n");
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  runMigrationCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Error de migración.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
