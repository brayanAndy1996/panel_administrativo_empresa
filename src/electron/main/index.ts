import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import type { Sequelize } from "sequelize";
import { createPanelDatabase } from "../../backend/infrastructure/database/database";
import { migrateDatabase } from "../../backend/infrastructure/database/migrations";
import { isPathInside } from "../../backend/infrastructure/database/path-safety";
import { readSystemStatus } from "../../backend/modules/system/system-status";
import { SYSTEM_STATUS_CHANNEL } from "../../contracts/ipc";
import { ACCESS_OPERATIONS } from "../../contracts/access";
import { AccessService } from "../../backend/modules/access/service";
import { createAccessBridge } from "./access-ipc";
import { createSystemStatusHandler } from "./system-status-ipc";
import { createSecureWebPreferences, isTrustedAppUrl } from "./security";
import { serveAppProtocolRequest } from "./protocol";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

const EXPORT_DIRECTORY = resolve(__dirname, "../../src/frontend/out");
let database: Sequelize | null = null;
let mainWindow: BrowserWindow | null = null;
let closingDatabase = false;
let failedToLoadUi = false;
let accessBridge: ReturnType<typeof createAccessBridge> | null = null;
let accessCleanup: Promise<void> = Promise.resolve();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function resolveDatabasePath(): string {
  const override = process.env.PANEL_DB_PATH;
  if (!override) return join(app.getPath("userData"), "panel.sqlite3");
  if (!isAbsolute(override)) throw new Error("PANEL_DB_PATH debe ser una ruta absoluta.");

  const target = resolve(override);
  const appRoot = resolve(app.getAppPath());
  if (isPathInside(appRoot, target)) {
    throw new Error("La base de datos debe ubicarse fuera del proyecto.");
  }
  return target;
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
}

function configureWebContentsSecurity(window: BrowserWindow): void {
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    show: false,
    backgroundColor: "#f4f6f8",
    webPreferences: createSecureWebPreferences(join(__dirname, "preload.cjs")),
  });
  mainWindow = window;
  configureWebContentsSecurity(window);
  window.once("ready-to-show", () => {
    const headlessTest = process.env.PANEL_TEST_HEADLESS === "1" && !app.isPackaged;
    if (!headlessTest) window.show();
  });
  window.on("closed", () => {
    accessCleanup = accessBridge?.dispose() ?? Promise.resolve();
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadURL("app://panel/").catch((error: unknown) => {
    if (failedToLoadUi) return;
    failedToLoadUi = true;
    console.error("[panel] No se pudo cargar la interfaz estática.", error);
    dialog.showErrorBox("No se pudo cargar el panel", "Los archivos locales de la interfaz no están disponibles.");
    if (!window.isDestroyed()) window.close();
    app.quit();
  });
  return window;
}

async function startApplication(): Promise<void> {
  configureSessionSecurity();
  protocol.handle("app", (request) => serveAppProtocolRequest(request, EXPORT_DIRECTORY));

  const storage = resolveDatabasePath();
  await mkdir(dirname(storage), { recursive: true });
  database = createPanelDatabase({ storage });
  await migrateDatabase(database);
  const access = new AccessService(database);
  accessBridge = createAccessBridge({ getExpectedContents: () => mainWindow?.webContents ?? null, execute: (operation, input, sessionId) => access.execute(operation, input, sessionId) });
  for (const operation of ACCESS_OPERATIONS) {
    ipcMain.handle(`panel:${operation}`, (event: IpcMainInvokeEvent, ...args: unknown[]) => accessBridge!.handle(operation, event, ...args));
  }

  const handler = createSystemStatusHandler({
    getExpectedContents: () => mainWindow?.webContents ?? null,
    getStatus: () => {
      if (!database) throw new Error("Database connection is closed.");
      return readSystemStatus(database, app.getVersion());
    },
  });
  ipcMain.handle(SYSTEM_STATUS_CHANNEL, (event: IpcMainInvokeEvent, ...args: unknown[]) =>
    handler(event, ...args),
  );

  createMainWindow();
}

app.on("before-quit", (event) => {
  if (!database || closingDatabase) return;
  event.preventDefault();
  closingDatabase = true;
  void (async () => {
    await accessCleanup;
    await accessBridge?.dispose();
    await database!.close();
  })().catch((error: unknown) => {
    console.error("[panel] Error al cerrar la base de datos.", error);
  }).finally(() => {
    database = null;
    app.quit();
  });
});

app.on("window-all-closed", () => app.quit());

if (hasSingleInstanceLock) {
  app.whenReady().then(startApplication).catch((error: unknown) => {
    console.error("[panel] No se pudo iniciar la aplicación.", error);
    dialog.showErrorBox(
      "No se pudo iniciar el panel",
      "La base local no está disponible. La aplicación se cerrará sin reconstruir ni reemplazar datos existentes.",
    );
    app.quit();
  });
}
