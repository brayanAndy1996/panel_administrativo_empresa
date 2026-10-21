import { resolve } from "node:path";
import { ACCESS_DEMO_PASSWORD, ACCESS_DEMO_USERS, seedAccessDemo } from "./demo";

export async function runDemoCli(args: string[]): Promise<void> {
  if (args.length !== 2 || args[0] !== "--database" || !args[1]) {
    throw new Error('Uso: npm run db:seed:demo -- --database "<ruta absoluta>/panel-access-demo/panel-access-demo.sqlite3"');
  }
  const result = await seedAccessDemo(args[1], { projectRoot: resolve(__dirname, "../../") });
  process.stdout.write(`${result.created ? "Demo de acceso creada" : "Demo de acceso verificada sin cambios"}: ${result.storage}\n`);
  process.stdout.write(`Contraseña pública exclusiva de la demo: ${ACCESS_DEMO_PASSWORD}\n`);
  for (const user of ACCESS_DEMO_USERS) {
    process.stdout.write(`${user.login}: ${user.roleCodes.join(", ")}${user.active ? "" : " (inactivo)"}\n`);
  }
}

if (require.main === module) {
  runDemoCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "No se pudo preparar la demo."}\n`);
    process.exitCode = 1;
  });
}
