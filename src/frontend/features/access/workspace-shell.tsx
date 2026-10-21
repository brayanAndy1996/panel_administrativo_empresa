"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { AccessPermission, SessionView } from "../../../contracts/access";
import { getAccessApi } from "../../lib/api/access";
import { useAccess } from "./access-provider";

function can(session: SessionView, permission: AccessPermission): boolean {
  return session.permissions.includes(permission);
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { state, refresh } = useAccess();
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  if (state.phase !== "authenticated") return null;
  const { session } = state;

  async function logout() {
    const api = getAccessApi();
    if (!api) {
      setLogoutError("No se pudo cerrar la sesión local.");
      return;
    }
    setLoggingOut(true);
    setLogoutError("");
    try {
      const result = await api.auth.logout();
      if (result.ok || result.error.code === "UNAUTHENTICATED") {
        await refresh();
      } else {
        setLogoutError("No se pudo cerrar la sesión local. Intenta nuevamente.");
      }
    } catch {
      setLogoutError("No se pudo cerrar la sesión local. Intenta nuevamente.");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" prefetch={false} aria-label="Panel administrativo, inicio">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>Panel administrativo</span>
        </Link>
        <nav aria-label="Navegación principal">
          <Link className="nav-link" href="/" prefetch={false}>Inicio</Link>
          <Link className="nav-link" href="/diagnostico/" prefetch={false}>Diagnóstico</Link>
          {can(session, "plataforma.usuarios.ver") && (
            <Link className="nav-link" href="/usuarios/" prefetch={false}>Usuarios</Link>
          )}
          {can(session, "plataforma.auditoria.ver") && (
            <Link className="nav-link" href="/auditoria/" prefetch={false}>Auditoría</Link>
          )}
          <Link className="nav-link" href="/cuenta/" prefetch={false}>Seguridad</Link>
        </nav>
        <div className="session-controls">
          <span className="session-name">{session.user.displayName}</span>
          <button className="button button-secondary" type="button" onClick={() => void logout()} disabled={loggingOut}>
            {loggingOut ? "Cerrando…" : "Cerrar sesión"}
          </button>
        </div>
      </header>
      {logoutError && <p className="global-alert" role="alert">{logoutError}</p>}
      {children}
      <footer className="app-footer">Operación local · Sin conexión permanente</footer>
    </main>
  );
}

export function PageContent({ children }: { children: ReactNode }) {
  return <section className="page-content">{children}</section>;
}

export function PermissionNotice({ children }: { children: ReactNode }) {
  return <p className="access-denied" role="alert">{children}</p>;
}

export function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <span className="field-error">{messages.join(" ")}</span>;
}

export function AlertMessage({ message, className = "" }: { message: string; className?: string }) {
  if (!message) return null;
  return <p className={`form-alert ${className}`.trim()} role="alert">{message}</p>;
}
