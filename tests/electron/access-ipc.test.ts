import { describe, expect, it, vi } from "vitest";
import { createAccessBridge } from "../../src/electron/main/access-ipc";
describe("Frontera IPC de acceso", () => {
  const mainFrame = { url: "app://panel/" }; const contents = { mainFrame };
  const event = { sender: contents, senderFrame: mainFrame };
  it("rechaza otra ventana/iframe/origen antes de backend", async () => {
    const execute = vi.fn(async () => ({ result: { ok: true as const, data: {}, requestId: "test" } }));
    const bridge = createAccessBridge({ getExpectedContents: () => contents, execute });
    for (const rejected of [{ sender: { mainFrame }, senderFrame: mainFrame }, { sender: contents, senderFrame: { url: "app://panel/" } }, { sender: contents, senderFrame: null }]) {
      expect(await bridge.handle("auth.login", rejected, { login: "x" })).toMatchObject({ error: { code: "FORBIDDEN" } });
    }
    mainFrame.url = "https://evil.example/";
    expect(await bridge.handle("auth.me", event)).toMatchObject({ error: { code: "FORBIDDEN" } }); mainFrame.url = "app://panel/";
    expect(execute).not.toHaveBeenCalled();
  });
  it("retiene token main, serializa login/logout y revoca al desechar", async () => {
    const execute = vi.fn(async (operation: string) => operation === "auth.login"
      ? { result: { ok: true as const, data: { user: {} }, requestId: "test" }, sessionId: "main-secret" }
      : { result: { ok: true as const, data: {}, requestId: "test" }, ...(operation === "auth.logout" ? { sessionId: null } : {}) });
    const bridge = createAccessBridge({ getExpectedContents: () => contents, execute });
    expect(JSON.stringify(await bridge.handle("auth.login", event, {}))).not.toContain("main-secret");
    await bridge.handle("auth.me", event);
    expect(execute).toHaveBeenLastCalledWith("auth.me", undefined, "main-secret");
    await bridge.dispose(); expect(execute).toHaveBeenLastCalledWith("auth.logout", undefined, "main-secret");
  });
  it("rechaza argumentos extras/no-args y no expone errores internos", async () => {
    const execute = vi.fn(async () => { throw new Error("SQL secret-path"); });
    const bridge = createAccessBridge({ getExpectedContents: () => contents, execute });
    expect(await bridge.handle("auth.login", event, {}, {})).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(await bridge.handle("auth.me", event, {})).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    const result = await bridge.handle("auth.me", event); expect(result).toMatchObject({ error: { code: "INTERNAL_ERROR" } }); expect(JSON.stringify(result)).not.toMatch(/SQL|secret-path/);
  });
});
