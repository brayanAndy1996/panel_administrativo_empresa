const { resolve } = require("node:path");
const { app, BrowserWindow, protocol } = require("electron");
const { serveAppProtocolRequest } = require("../../../dist/electron/protocol.cjs");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(async () => {
  const exportDirectory = resolve(__dirname, "../../../src/frontend/out");
  protocol.handle("app", (request) => serveAppProtocolRequest(request, exportDirectory));

  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadURL("app://panel/");
});
