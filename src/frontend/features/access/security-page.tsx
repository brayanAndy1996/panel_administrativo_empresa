"use client";

import { useState, type FormEvent } from "react";
import { getAccessApi } from "../../lib/api/access";
import { useAccess } from "./access-provider";
import { AlertMessage, FieldError, PageContent, PermissionNotice, WorkspaceShell } from "./workspace-shell";
import { RecoveryKeyDelivery } from "./recovery-key-delivery";

type FieldErrors = Record<string, string[]>;

function input(form: HTMLFormElement, name: string): HTMLInputElement | null {
  const element = form.elements.namedItem(name);
  return element instanceof HTMLInputElement ? element : null;
}

function passwordError(password: string): string | null {
  const length = Array.from(password).length;
  if (length < 15) return "Usa al menos 15 caracteres.";
  if (length > 128) return "La contraseña no puede superar 128 caracteres.";
  return null;
}

function clearPasswords(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((item) => { item.value = ""; });
}

export function SecurityPage() {
  const { state, refresh } = useAccess();
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<string | null>(null);

  if (state.phase !== "authenticated") return null;
  const canRotateRecoveryKey = state.session.user.active && state.session.user.roleCodes.includes("owner");

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage("");
    setFieldErrors({});
    const currentPassword = input(form, "currentPassword")?.value ?? "";
    const newPassword = input(form, "newPassword")?.value ?? "";
    const confirmation = input(form, "confirmation")?.value ?? "";
    const errors: FieldErrors = {};
    const passwordValidation = passwordError(newPassword);
    if (!currentPassword) errors.currentPassword = ["Escribe tu contraseña actual."];
    if (passwordValidation) errors.newPassword = [passwordValidation];
    if (newPassword !== confirmation) errors.confirmation = ["Las contraseñas no coinciden."];
    if (Object.keys(errors).length) {
      clearPasswords(form);
      setFieldErrors(errors);
      return;
    }

    const api = getAccessApi();
    if (!api) {
      clearPasswords(form);
      setMessage("No se pudo contactar el backend local.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.auth.changePassword({ currentPassword, newPassword });
      clearPasswords(form);
      if (!result.ok) {
        if (result.error.code === "UNAUTHENTICATED") await refresh();
        setMessage(result.error.code === "RATE_LIMITED"
          ? `Demasiados intentos. Espera ${Math.max(1, Math.ceil((result.error.retryAfterMs ?? 1000) / 1000))} segundos.`
          : result.error.message);
        setFieldErrors(result.error.fields ?? {});
        return;
      }
      form.reset();
      await refresh();
    } catch {
      clearPasswords(form);
      setMessage("No se pudo cambiar la contraseña local. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  async function rotateRecoveryKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage("");
    setFieldErrors({});
    const currentPassword = input(form, "rotationPassword")?.value ?? "";
    if (!currentPassword) {
      setFieldErrors({ currentPassword: ["Escribe tu contraseña actual."] });
      clearPasswords(form);
      return;
    }
    const api = getAccessApi();
    if (!api) {
      clearPasswords(form);
      setMessage("No se pudo contactar el backend local.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.auth.rotateRecoveryKey({ currentPassword });
      clearPasswords(form);
      if (!result.ok) {
        if (result.error.code === "UNAUTHENTICATED") await refresh();
        const seconds = Math.max(1, Math.ceil((result.error.retryAfterMs ?? 1000) / 1000));
        setMessage(result.error.code === "RATE_LIMITED"
          ? `Demasiados intentos. Espera ${seconds} ${seconds === 1 ? "segundo" : "segundos"}.`
          : result.error.message);
        setFieldErrors(result.error.fields ?? {});
        return;
      }
      form.reset();
      setDelivery(result.data.recoveryKey);
    } catch {
      clearPasswords(form);
      setMessage("No se pudo renovar la clave de recuperación. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  function continueAfterKey(): void {
    setDelivery(null);
    setMessage("");
    setFieldErrors({});
  }

  return (
    <WorkspaceShell>
      <PageContent>
        <div className="page-intro">
          <p className="eyebrow">Cuenta local</p>
          <h1>Seguridad de la cuenta</h1>
          <p>Cambia tu contraseña. Si eres propietario, también puedes renovar tu clave de recuperación.</p>
        </div>

        {delivery ? (
          <RecoveryKeyDelivery recoveryKey={delivery} onContinue={continueAfterKey} />
        ) : (
          <>
            <section className="form-card section-card" aria-labelledby="change-password-heading">
              <h2 id="change-password-heading">Cambiar contraseña</h2>
              <p>El cambio cierra esta sesión y tendrás que iniciar sesión nuevamente.</p>
              <form className="form-stack" noValidate onSubmit={(event) => void changePassword(event)}>
                <label>
                  Contraseña actual
                  <input name="currentPassword" type="password" autoComplete="current-password" aria-label="Contraseña actual" aria-invalid={Boolean(fieldErrors.currentPassword)} />
                  <FieldError messages={fieldErrors.currentPassword} />
                </label>
                <label>
                  Nueva contraseña
                  <input name="newPassword" type="password" autoComplete="new-password" aria-label="Nueva contraseña" aria-invalid={Boolean(fieldErrors.newPassword)} />
                  <span className="field-hint">De 15 a 128 caracteres. Se permiten frases y espacios.</span>
                  <FieldError messages={fieldErrors.newPassword} />
                </label>
                <label>
                  Confirmar contraseña nueva
                  <input name="confirmation" type="password" autoComplete="new-password" aria-label="Confirmar contraseña nueva" aria-invalid={Boolean(fieldErrors.confirmation)} />
                  <FieldError messages={fieldErrors.confirmation} />
                </label>
                <AlertMessage message={message} />
                <button className="button button-primary" type="submit" disabled={busy}>
                  {busy ? "Actualizando…" : "Cambiar contraseña"}
                </button>
              </form>
            </section>

            {canRotateRecoveryKey && (
              <section className="form-card section-card" aria-labelledby="rotate-key-heading">
                <h2 id="rotate-key-heading">Clave de recuperación</h2>
                <p>La clave nueva reemplaza la anterior y se muestra una sola vez.</p>
                <form className="form-stack" noValidate onSubmit={(event) => void rotateRecoveryKey(event)}>
                  <label>
                    Contraseña actual
                    <input name="rotationPassword" type="password" autoComplete="current-password" aria-label="Contraseña actual" aria-invalid={Boolean(fieldErrors.currentPassword)} />
                    <FieldError messages={fieldErrors.currentPassword} />
                  </label>
                  <AlertMessage message={message} />
                  <button className="button button-secondary" type="submit" disabled={busy}>
                    {busy ? "Renovando…" : "Generar nueva clave de recuperación"}
                  </button>
                </form>
              </section>
            )}

            {!canRotateRecoveryKey && <PermissionNotice>La renovación de la clave está disponible para el propietario activo.</PermissionNotice>}
          </>
        )}
      </PageContent>
    </WorkspaceShell>
  );
}
