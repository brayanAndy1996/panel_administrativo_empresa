import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

// eslint-disable-next-line no-empty-pattern -- Electron is launched directly for this integrated flow.
test("bootstrap, sesión, usuarios, permisos, cambio y recuperación funcionan offline", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "panel-access-e2e-"));
  const databasePath = join(directory, "panel.sqlite3");
  await mkdir(testInfo.outputPath(), { recursive: true });

  const application = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      PANEL_DB_PATH: databasePath,
      PANEL_TEST_HEADLESS: "1",
    },
  });

  try {
    await application.context().setOffline(true);
    const page = await application.firstWindow();
    const pageErrors: string[] = [];
    const consoleFailures: string[] = [];
    const remoteRequests: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleFailures.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("request", (request) => {
      if (/^https?:/i.test(request.url())) remoteRequests.push(request.url());
    });

    await expect(page.getByRole("heading", { name: "Crear propietario" })).toBeVisible();
    await page.getByLabel("Nombre visible").fill("Propietaria Demo");
    await page.getByLabel("Identificador de acceso").fill("duena.demo");
    await page.getByLabel("Contraseña", { exact: true }).fill("Local-Owner-Phrase-2026");
    await page.getByLabel("Confirmar contraseña").fill("Local-Owner-Phrase-2026");
    await page.getByRole("button", { name: "Crear propietario" }).click();

    await expect(page.getByRole("heading", { name: "Guarda tu clave de recuperación" })).toBeVisible();
    const bootstrapKey = await page.getByTestId("one-time-recovery-key").innerText();
    expect(bootstrapKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await page.getByLabel("Confirmo que guardé la clave en un lugar seguro").check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page.getByTestId("one-time-recovery-key")).toHaveCount(0);

    await page.getByLabel("Identificador de acceso").fill("duena.demo");
    await page.getByLabel("Contraseña", { exact: true }).fill("incorrecta-no-se-muestra");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.locator(".form-alert")).toContainText(
      "No se pudo iniciar sesión con las credenciales indicadas.",
    );
    await expect(page.locator(".form-alert")).not.toContainText("incorrecta-no-se-muestra");
    await page.getByLabel("Contraseña", { exact: true }).fill("Local-Owner-Phrase-2026");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Panel administrativo" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Panel administrativo" })).toBeVisible();

    await page.getByRole("link", { name: "Usuarios" }).click();
    await expect(page.getByRole("heading", { name: "Usuarios del panel" })).toBeVisible();
    await page.getByRole("button", { name: "Nuevo usuario" }).click();
    const createUser = page.getByRole("dialog", { name: "Crear usuario" });
    await createUser.getByLabel("Nombre visible").fill("Consulta Demo");
    await createUser.getByLabel("Identificador de acceso").fill("consulta.demo");
    await createUser.getByLabel("Contraseña inicial").fill("Local-Viewer-Phrase-2026");
    await createUser.getByLabel("Confirmar contraseña").fill("Local-Viewer-Phrase-2026");
    await createUser.getByLabel("Consulta").check();
    await createUser.getByRole("button", { name: "Crear usuario" }).click();

    let userRow = page.getByRole("row", { name: /consulta\.demo/ });
    await expect(userRow).toContainText("Consulta Demo");
    await userRow.getByRole("button", { name: "Editar" }).click();
    const editUser = page.getByRole("dialog", { name: "Editar usuario" });
    await editUser.getByLabel("Nombre visible").fill("Consulta Demo Actualizada");
    await editUser.getByRole("button", { name: "Guardar cambios" }).click();
    userRow = page.getByRole("row", { name: /consulta\.demo/ });
    await expect(userRow).toContainText("Consulta Demo Actualizada");

    await userRow.getByRole("button", { name: "Asignar roles" }).click();
    const assignRoles = page.getByRole("dialog", { name: "Asignar roles" });
    await assignRoles.getByLabel("Cobranza").check();
    await assignRoles.getByLabel("Consulta").uncheck();
    await assignRoles.getByRole("button", { name: "Guardar roles" }).click();
    userRow = page.getByRole("row", { name: /consulta\.demo/ });
    await expect(userRow).toContainText("Cobranza");

    await userRow.getByRole("button", { name: "Desactivar" }).click();
    const disableDialog = page.getByRole("dialog", { name: "Desactivar usuario" });
    await disableDialog.getByRole("button", { name: "Confirmar desactivación" }).click();
    userRow = page.getByRole("row", { name: /consulta\.demo/ });
    await expect(userRow).toContainText("Inactivo");
    await userRow.getByRole("button", { name: "Editar" }).click();
    const reactivateUser = page.getByRole("dialog", { name: "Editar usuario" });
    await reactivateUser.getByLabel("Cuenta activa").check();
    await reactivateUser.getByRole("button", { name: "Guardar cambios" }).click();
    userRow = page.getByRole("row", { name: /consulta\.demo/ });
    await expect(userRow).toContainText("Activo");

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await page.getByLabel("Identificador de acceso").fill("consulta.demo");
    await page.getByLabel("Contraseña", { exact: true }).fill("Local-Viewer-Phrase-2026");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Panel administrativo" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Usuarios" })).toHaveCount(0);
    await page.goto("app://panel/usuarios/");
    await expect(page.getByText("No tienes permiso para administrar usuarios.")).toBeVisible();
    const denied = await page.evaluate(async () => {
      const api = (window as Window & {
        panel?: { users?: { list: () => Promise<unknown> } };
      }).panel;
      return api?.users?.list();
    });
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await page.getByLabel("Identificador de acceso").fill("duena.demo");
    await page.getByLabel("Contraseña", { exact: true }).fill("Local-Owner-Phrase-2026");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Panel administrativo" })).toBeVisible();

    await page.getByRole("link", { name: "Auditoría" }).click();
    await expect(page.getByRole("heading", { name: "Auditoría" })).toBeVisible();
    await expect(page.getByRole("table").getByRole("row").nth(1)).toBeVisible();

    await page.getByRole("link", { name: "Seguridad" }).click();
    await expect(page.getByRole("heading", { name: "Seguridad de la cuenta" })).toBeVisible();
    const changePassword = page.getByRole("region", { name: "Cambiar contraseña" });
    await changePassword.getByLabel("Contraseña actual").fill("Local-Owner-Phrase-2026");
    await changePassword.getByLabel("Nueva contraseña").fill("Local-Owner-Phrase-Changed-2026");
    await changePassword.getByLabel("Confirmar contraseña nueva").fill("Local-Owner-Phrase-Changed-2026");
    await changePassword.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await page.getByLabel("Identificador de acceso").fill("duena.demo");
    await page.getByLabel("Contraseña", { exact: true }).fill("Local-Owner-Phrase-Changed-2026");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Panel administrativo" })).toBeVisible();

    await page.getByRole("link", { name: "Seguridad" }).click();
    const rotateRecoveryKey = page.getByRole("region", { name: "Clave de recuperación" });
    await rotateRecoveryKey.getByLabel("Contraseña actual").fill("Local-Owner-Phrase-Changed-2026");
    await rotateRecoveryKey.getByRole("button", { name: "Generar nueva clave de recuperación" }).click();
    await expect(page.getByRole("heading", { name: "Guarda tu clave de recuperación" })).toBeVisible();
    const rotatedKey = await page.getByTestId("one-time-recovery-key").innerText();
    expect(rotatedKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await page.getByLabel("Confirmo que guardé la clave en un lugar seguro").check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByTestId("one-time-recovery-key")).toHaveCount(0);

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await page.getByRole("button", { name: "Recuperar acceso" }).click();
    await expect(page.getByRole("heading", { name: "Recuperar acceso" })).toBeVisible();
    await page.getByLabel("Identificador de acceso").fill("duena.demo");
    const invalidRecoveryKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    await page.getByLabel("Clave de recuperación").fill(invalidRecoveryKey);
    await page.getByLabel("Nueva contraseña").fill("Local-Owner-Phrase-Recovered-2026");
    await page.getByLabel("Confirmar contraseña nueva").fill("Local-Owner-Phrase-Recovered-2026");
    await page.getByRole("button", { name: "Recuperar acceso" }).click();
    await expect(page.locator(".form-alert")).toContainText(
      "No se pudo recuperar el acceso con los datos indicados.",
    );
    await expect(page.locator(".form-alert")).not.toContainText(invalidRecoveryKey);
    await page.getByLabel("Clave de recuperación").fill(rotatedKey);
    await page.getByLabel("Nueva contraseña").fill("Local-Owner-Phrase-Recovered-2026");
    await page.getByLabel("Confirmar contraseña nueva").fill("Local-Owner-Phrase-Recovered-2026");
    await page.getByRole("button", { name: "Recuperar acceso" }).click();
    await expect(page.getByRole("heading", { name: "Guarda tu clave de recuperación" })).toBeVisible();
    const recoveryKey = await page.getByTestId("one-time-recovery-key").innerText();
    expect(recoveryKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await page.getByLabel("Confirmo que guardé la clave en un lugar seguro").check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page.getByTestId("one-time-recovery-key")).toHaveCount(0);

    await page.getByLabel("Identificador de acceso").fill("duena.demo");
    await page.getByLabel("Contraseña", { exact: true }).fill("Local-Owner-Phrase-Recovered-2026");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Panel administrativo" })).toBeVisible();

    const storedSecrets = await page.evaluate(() =>
      `${localStorage.getItem("recoveryKey") ?? ""}${sessionStorage.getItem("recoveryKey") ?? ""}`,
    );
    expect(storedSecrets).toBe("");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain(bootstrapKey);
    expect(visibleText).not.toContain(rotatedKey);
    expect(visibleText).not.toContain(recoveryKey);
    await page.screenshot({ path: testInfo.outputPath("access-home.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
    expect(consoleFailures).toEqual([]);
    expect(remoteRequests).toEqual([]);
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
