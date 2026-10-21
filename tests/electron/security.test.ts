import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSecureWebPreferences,
  isAuthorizedIpcEvent,
  isTrustedAppUrl,
  resolveAppAsset,
} from "../../src/electron/main/security";
import { createSystemStatusHandler } from "../../src/electron/main/system-status-ipc";
import { serveAppProtocolRequest } from "../../src/electron/main/protocol";

describe("fronteras de Electron", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "panel-protocol-test-"));
    await mkdir(join(directory, "_next", "static"), { recursive: true });
    await writeFile(join(directory, "index.html"), "home");
    await writeFile(join(directory, "index.txt"), "flight payload");
    await writeFile(join(directory, "_next", "static", "bundle.js"), "bundle");
    await writeFile(join(directory, "secret.txt"), "outside asset root");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("acepta únicamente el origen local app://panel", () => {
    expect(isTrustedAppUrl("app://panel/")).toBe(true);
    expect(isTrustedAppUrl("app://panel/diagnostico/")).toBe(true);
    expect(isTrustedAppUrl("app://panel/diagnostico/?_rsc=abc#seccion")).toBe(true);
    expect(isTrustedAppUrl("https://panel/")).toBe(false);
    expect(isTrustedAppUrl("app://panel.evil/diagnostico/")).toBe(false);
    expect(isTrustedAppUrl("app://user@panel/diagnostico/")).toBe(false);
    expect(isTrustedAppUrl("app://panel:8443/diagnostico/")).toBe(false);
  });

  it("resuelve assets estáticos bajo la raíz y rechaza traversal u hosts ajenos", async () => {
    expect(await resolveAppAsset("app://panel/", directory)).toBe(join(directory, "index.html"));
    expect(await resolveAppAsset("app://panel/_next/static/bundle.js", directory)).toBe(
      join(directory, "_next", "static", "bundle.js"),
    );
    expect(await resolveAppAsset("app://panel/_next/static/bundle.js?_rsc=abc", directory)).toBe(
      join(directory, "_next", "static", "bundle.js"),
    );
    await expect(resolveAppAsset("app://panel/%2e%2e/secret.txt", directory)).resolves.toBeNull();
    await expect(resolveAppAsset("app://panel/../secret.txt", directory)).resolves.toBeNull();
    await expect(resolveAppAsset("app://panel/%2f..%2fsecret.txt", directory)).resolves.toBeNull();
    await expect(resolveAppAsset("app://panel/%5c..%5csecret.txt", directory)).resolves.toBeNull();
    await expect(resolveAppAsset("app://panel/%252e%252e/secret.txt", directory)).resolves.toBeNull();
    await expect(resolveAppAsset("app://elsewhere/secret.txt", directory)).resolves.toBeNull();
    await expect(resolveAppAsset("app://panel/C:%5csecret.txt", directory)).resolves.toBeNull();
    await expect(resolveAppAsset("app://panel/secret.txt:stream", directory)).resolves.toBeNull();
  });

  it("sirve respuestas de ruta Next con MIME de texto y encabezados restrictivos", async () => {
    const response = await serveAppProtocolRequest(
      { method: "GET", url: "app://panel/index.txt?_rsc=route" },
      directory,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await response.text()).toBe("flight payload");
  });

  it("responde HEAD con los mismos encabezados de un asset y sin cuerpo", async () => {
    const response = await serveAppProtocolRequest(
      { method: "HEAD", url: "app://panel/" },
      directory,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await response.text()).toBe("");
  });

  it("restringe IPC al webContents y al frame principal autorizado", () => {
    const mainFrame = { url: "app://panel/" };
    const otherFrame = { url: "app://panel/diagnostico/" };
    const contents = { mainFrame };
    const validEvent = { sender: contents, senderFrame: mainFrame };

    expect(isAuthorizedIpcEvent(validEvent, contents)).toBe(true);
    expect(isAuthorizedIpcEvent({ sender: contents, senderFrame: otherFrame }, contents)).toBe(false);
    const otherContents = { mainFrame };
    expect(isAuthorizedIpcEvent({ sender: otherContents, senderFrame: mainFrame }, contents)).toBe(false);
    expect(isAuthorizedIpcEvent({ sender: contents, senderFrame: { url: "https://evil.test/" } }, contents)).toBe(
      false,
    );
  });

  it("configura el renderer sin privilegios de Node", () => {
    expect(createSecureWebPreferences("C:\\app\\preload.cjs")).toEqual(
      expect.objectContaining({
        preload: "C:\\app\\preload.cjs",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      }),
    );
  });

  it("deniega emisor ajeno y argumentos inesperados en el handler real", async () => {
    const mainFrame = { url: "app://panel/" };
    const contents = { mainFrame };
    const getStatus = vi.fn().mockResolvedValue({
      ok: true,
      data: { appVersion: "0.2.0", schemaVersion: 2, database: "ready", mode: "local" },
      requestId: "status-id",
    });
    const handler = createSystemStatusHandler({
      getExpectedContents: () => contents,
      getStatus,
      createRequestId: () => "rejection-id",
    });

    const unauthorized = await handler({ sender: { mainFrame }, senderFrame: mainFrame });
    const unexpectedArguments = await handler({ sender: contents, senderFrame: mainFrame }, { unexpected: true });

    expect(unauthorized).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(unexpectedArguments).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(getStatus).not.toHaveBeenCalled();
    expect(JSON.stringify(unauthorized)).not.toMatch(/C:\\|sqlite|SELECT|stack/i);
  });
});
