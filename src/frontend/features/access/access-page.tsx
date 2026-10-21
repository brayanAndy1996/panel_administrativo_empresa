"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Result } from "../../../contracts/result";
import { getAccessApi } from "../../lib/api/access";
import { useAccess } from "./access-provider";
import { AlertMessage, FieldError, PageContent } from "./workspace-shell";
import { RecoveryKeyDelivery } from "./recovery-key-delivery";

type AccessMode = "login" | "bootstrap" | "recover";
type FieldErrors = Record<string, string[]>;

function field(form: HTMLFormElement, name: string): HTMLInputElement | null {
  const element = form.elements.namedItem(name);
  return element instanceof HTMLInputElement ? element : null;
}

function getText(form: HTMLFormElement, name: string): string {
  return field(form, name)?.value ?? "";
}

function clearPasswordInputs(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
    input.value = "";
  });
}

function localPasswordError(password: string): string | null {
  const length = Array.from(password).length;
  if (length < 15) return "Usa al menos 15 caracteres.";
  if (length > 128) return "La contraseña no puede superar 128 caracteres.";
  return null;
}

function resultMessage(error: Extract<Result<never>, { ok: false }>["error"]): string {
  if (error.code === "RATE_LIMITED") {
    const seconds = Math.max(1, Math.ceil((error.retryAfterMs ?? 1_000) / 1_000));
    return `Demasiados intentos. Espera ${seconds} ${seconds === 1 ? "segundo" : "segundos"} antes de probar otra vez.`;
  }
  if (error.code === "CONFLICT") return "Los datos cambiaron. Actualiza la pantalla e intenta nuevamente.";
  return error.message;
}

export function AccessPage() {
  const { state, acceptSession, refresh } = useAccess();
  const bootstrapRequired = state.phase === "anonymous" && state.bootstrapRequired;
  const [showRecovery, setShowRecovery] = useState(false);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (bootstrapRequired) setShowRecovery(false);
  }, [bootstrapRequired]);

  const mode: AccessMode = bootstrapRequired ? "bootstrap" : showRecovery ? "recover" : "login";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const api = getAccessApi();
    setMessage("");
    setFieldErrors({});

    if (!api) {
      setMessage("Abre esta pantalla desde la aplicación de escritorio.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "bootstrap") {
        const displayName = getText(form, "displayName").trim();
        const login = getText(form, "login").trim().toLowerCase();
        const password = getText(form, "password");
        const confirmation = getText(form, "confirmation");
        const localErrors: FieldErrors = {};
        const passwordError = localPasswordError(password);
        if (passwordError) localErrors.password = [passwordError];
        if (password !== confirmation) localErrors.confirmation = ["Las contraseñas no coinciden."];
        if (!/^[a-z0-9._-]{3,64}$/.test(login)) {
          localErrors.login = ["Usa de 3 a 64 letras ASCII minúsculas, números, punto, guion o guion bajo."];
        }
        if (!displayName || Array.from(displayName).length > 120) {
          localErrors.displayName = ["Escribe un nombre de hasta 120 caracteres."];
        }
        if (Object.keys(localErrors).length) {
          setFieldErrors(localErrors);
          clearPasswordInputs(form);
          return;
        }

        const result = await api.auth.bootstrap({ login, displayName, password });
        clearPasswordInputs(form);
        if (!result.ok) {
          setMessage(resultMessage(result.error));
          setFieldErrors(result.error.fields ?? {});
          return;
        }
        form.reset();
        setDelivery(result.data.recoveryKey);
        return;
      }

      if (mode === "login") {
        const login = getText(form, "login").trim().toLowerCase();
        const password = getText(form, "password");
        if (!/^[a-z0-9._-]{3,64}$/.test(login)) {
          setFieldErrors({ login: ["Escribe un identificador válido."] });
          clearPasswordInputs(form);
          return;
        }
        const result = await api.auth.login({ login, password });
        clearPasswordInputs(form);
        if (!result.ok) {
          setMessage(resultMessage(result.error));
          setFieldErrors(result.error.fields ?? {});
          return;
        }
        form.reset();
        acceptSession(result.data);
        return;
      }

      const login = getText(form, "login").trim().toLowerCase();
      const recoveryKey = getText(form, "recoveryKey");
      const newPassword = getText(form, "newPassword");
      const confirmation = getText(form, "confirmation");
      const localErrors: FieldErrors = {};
      const passwordError = localPasswordError(newPassword);
      if (passwordError) localErrors.newPassword = [passwordError];
      if (newPassword !== confirmation) localErrors.confirmation = ["Las contraseñas no coinciden."];
      if (!/^[a-z0-9._-]{3,64}$/.test(login)) localErrors.login = ["Escribe un identificador válido."];
      if (!/^[A-Za-z0-9_-]{43}$/.test(recoveryKey)) {
        localErrors.recoveryKey = ["La clave debe tener el formato de recuperación indicado."];
      }
      if (Object.keys(localErrors).length) {
        setFieldErrors(localErrors);
        clearPasswordInputs(form);
        return;
      }

      const result = await api.auth.recover({ login, recoveryKey, newPassword });
      clearPasswordInputs(form);
      if (!result.ok) {
        setMessage(resultMessage(result.error));
        setFieldErrors(result.error.fields ?? {});
        return;
      }
      form.reset();
      setDelivery(result.data.recoveryKey);
    } catch {
      clearPasswordInputs(form);
      setMessage("No se pudo completar la solicitud local. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  function continueAfterSecret(): void {
    setDelivery(null);
    setMessage("");
    setFieldErrors({});
    setShowRecovery(false);
    void refresh();
  }

  if (delivery) return <PageContent><RecoveryKeyDelivery recoveryKey={delivery} onContinue={continueAfterSecret} /></PageContent>;

  return (
    <main className="access-screen">
      <section className="access-brand" aria-label="Panel administrativo">
        <span className="brand-mark" aria-hidden="true">P</span>
        <span>Panel administrativo</span>
      </section>
      <PageContent>
        <div className="page-intro">
          <p className="eyebrow">Acceso local</p>
          <h1>
            {mode === "bootstrap" ? "Crear propietario" : mode === "recover" ? "Recuperar acceso" : "Iniciar sesión"}
          </h1>
          <p>
            {mode === "bootstrap"
              ? "Crea la cuenta propietaria de esta instalación. No existe una contraseña predeterminada."
              : mode === "recover"
                ? "Usa la clave guardada cuando se creó o renovó tu acceso."
                : "Inicia sesión con la cuenta local del panel."}
          </p>
        </div>

        <form className="form-card form-stack" noValidate onSubmit={(event) => void submit(event)}>
          {mode === "bootstrap" && (
            <>
              <label>
                Nombre visible
                <input name="displayName" autoComplete="name" aria-invalid={Boolean(fieldErrors.displayName)} />
                <FieldError messages={fieldErrors.displayName} />
              </label>
              <label>
                Identificador de acceso
                <input name="login" autoComplete="username" maxLength={64} aria-invalid={Boolean(fieldErrors.login)} />
                <FieldError messages={fieldErrors.login} />
              </label>
              <label>
                Contraseña
                <input name="password" type="password" autoComplete="new-password" aria-label="Contraseña" aria-invalid={Boolean(fieldErrors.password)} />
                <span className="field-hint">De 15 a 128 caracteres. Se permiten frases y espacios.</span>
                <FieldError messages={fieldErrors.password} />
              </label>
              <label>
                Confirmar contraseña
                <input name="confirmation" type="password" autoComplete="new-password" aria-label="Confirmar contraseña" aria-invalid={Boolean(fieldErrors.confirmation)} />
                <FieldError messages={fieldErrors.confirmation} />
              </label>
              <AlertMessage message={message} />
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? "Creando…" : "Crear propietario"}
              </button>
            </>
          )}

          {mode === "login" && (
            <>
              <label>
                Identificador de acceso
                <input name="login" autoComplete="username" maxLength={64} aria-invalid={Boolean(fieldErrors.login)} />
                <FieldError messages={fieldErrors.login} />
              </label>
              <label>
                Contraseña
                <input name="password" type="password" autoComplete="current-password" aria-label="Contraseña" />
              </label>
              <AlertMessage message={message} />
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? "Verificando…" : "Iniciar sesión"}
              </button>
              <button className="text-button" type="button" onClick={() => { setShowRecovery(true); setMessage(""); }}>
                Recuperar acceso
              </button>
            </>
          )}

          {mode === "recover" && (
            <>
              <label>
                Identificador de acceso
                <input name="login" autoComplete="username" maxLength={64} aria-invalid={Boolean(fieldErrors.login)} />
                <FieldError messages={fieldErrors.login} />
              </label>
              <label>
                Clave de recuperación
                <input name="recoveryKey" type="password" autoComplete="off" aria-label="Clave de recuperación" aria-invalid={Boolean(fieldErrors.recoveryKey)} />
                <FieldError messages={fieldErrors.recoveryKey} />
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
                {busy ? "Recuperando…" : "Recuperar acceso"}
              </button>
              <button className="text-button" type="button" onClick={() => { setShowRecovery(false); setMessage(""); }}>
                Volver a iniciar sesión
              </button>
            </>
          )}
        </form>
      </PageContent>
    </main>
  );
}
