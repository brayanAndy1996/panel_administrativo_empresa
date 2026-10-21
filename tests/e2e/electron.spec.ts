import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

// eslint-disable-next-line no-empty-pattern -- Electron is launched directly for this smoke test.
test("abre Electron offline en el bootstrap local y consulta el status técnico", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "panel-electron-e2e-"));
  const databasePath = join(directory, "panel.sqlite3");
  const application = await electron.launch({
    args: ["."],
    env: { ...process.env, PANEL_DB_PATH: databasePath, PANEL_TEST_HEADLESS: "1" },
  });

  try {
    const securityOutput: string[] = [];
    application.process().stderr?.on("data", (chunk: Buffer) => securityOutput.push(String(chunk)));
    await application.context().setOffline(true);
    const page = await application.firstWindow();
    const pageErrors: string[] = [];
    const consoleFailures: string[] = [];
    const remoteRequests: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") consoleFailures.push(`${message.type()}: ${message.text()}`);
    });
    page.on("request", (request) => {
      if (/^https?:/i.test(request.url())) remoteRequests.push(request.url());
    });

    await page.waitForURL("app://panel/**");
    await expect(page.getByRole("heading", { name: "Crear propietario" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Crear propietario" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("electron-access.png"), fullPage: true });

    const result = await page.evaluate(async () => {
      const panel = (window as Window & {
        panel?: { systemStatus: () => Promise<unknown>; auth: { status: () => Promise<unknown> } };
      }).panel;
      if (!panel) return null;
      return { system: await panel.systemStatus(), access: await panel.auth.status() };
    });
    expect(result).toMatchObject({
      system: {
        ok: true,
        data: { schemaVersion: 2, database: "ready", mode: "local" },
        requestId: expect.any(String),
      },
      access: { ok: true, data: { bootstrapRequired: true }, requestId: expect.any(String) },
    });
    const systemData = result?.system.ok ? result.system.data : {};
    expect(Object.keys(systemData).sort()).toEqual(["appVersion", "database", "mode", "schemaVersion"].sort());
    expect(pageErrors).toEqual([]);
    expect(consoleFailures).toEqual([]);
    expect(remoteRequests).toEqual([]);
    expect(securityOutput.join("")).not.toMatch(/Electron Security Warning/i);
  } finally {
    await application.close();
  }

  const noPreloadApplication = await electron.launch({ args: [resolve("tests/e2e/no-preload-app")] });
  try {
    const page = await noPreloadApplication.firstWindow();
    await expect(page.getByText("Abre esta pantalla desde la aplicación de escritorio.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Crear propietario" })).toHaveCount(0);
  } finally {
    await noPreloadApplication.close();
    await rm(directory, { recursive: true, force: true });
  }
});
