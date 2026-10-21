"use client";

import { useEffect, useState } from "react";
import { requestSystemStatus } from "../../lib/api/system";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      appVersion: string;
      schemaVersion: number;
      database: string;
      mode: string;
    };

interface SystemStatusPanelProps {
  detailed?: boolean;
}

export function SystemStatusPanel({ detailed = false }: SystemStatusPanelProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    setState({ kind: "loading" });

    requestSystemStatus()
      .then((result) => {
        if (!mounted) return;
        if (!result.ok) {
          setState({ kind: "error", message: "No se pudo consultar el estado local. Intenta nuevamente." });
          return;
        }

        setState({
          kind: "ready",
          appVersion: result.data.appVersion,
          schemaVersion: result.data.schemaVersion,
          database: result.data.database,
          mode: result.data.mode,
        });
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        const message =
          error instanceof Error && error.message === "Abre esta pantalla desde la aplicación de escritorio."
            ? error.message
            : "No se pudo consultar el estado local. Intenta nuevamente.";
        setState({ kind: "error", message });
      });

    return () => {
      mounted = false;
    };
  }, [attempt]);

  if (state.kind === "loading") {
    return (
      <section className="status-card" aria-live="polite" aria-busy="true" data-testid="system-loading">
        <p className="eyebrow">Estado del sistema</p>
        <p>Consultando la instalación local…</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="status-card status-card-error" role="alert">
        <p className="eyebrow">No disponible</p>
        <p>{state.message}</p>
        <button className="button button-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>
          Reintentar
        </button>
      </section>
    );
  }

  return (
    <section className="status-card" aria-live="polite" data-testid="system-ready">
      <div className="status-heading">
        <div>
          <p className="eyebrow">Estado del sistema</p>
          <h2>La instalación está lista</h2>
        </div>
        <span className="status-pill">Operativo</span>
      </div>
      <p className="status-summary">Base de datos lista</p>
      {detailed ? (
        <dl className="status-details">
          <div>
            <dt>Versión de la aplicación</dt>
            <dd>{state.appVersion}</dd>
          </div>
          <div>
            <dt>Versión del esquema</dt>
            <dd>{state.schemaVersion}</dd>
          </div>
          <div>
            <dt>Base de datos</dt>
            <dd>{state.database === "ready" ? "SQLite lista" : "No disponible"}</dd>
          </div>
          <div>
            <dt>Modo</dt>
            <dd>{state.mode === "local" ? "Local" : "No disponible"}</dd>
          </div>
        </dl>
      ) : (
        <p className="status-hint">La base local está disponible para continuar con la configuración técnica.</p>
      )}
    </section>
  );
}
