"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AuditEventDto } from "../../../contracts/access";
import { getAccessApi } from "../../lib/api/access";
import { useAccess } from "./access-provider";
import { AlertMessage, PageContent, PermissionNotice, WorkspaceShell } from "./workspace-shell";

const PAGE_SIZE = 20;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function outcomeLabel(event: AuditEventDto): string {
  return event.outcome === "success" ? "Correcto" : "Fallido";
}

export function AuditPage() {
  const { state, refresh } = useAccess();
  const canView = state.phase === "authenticated" && state.session.permissions.includes("plataforma.auditoria.ver");
  const [events, setEvents] = useState<AuditEventDto[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionInput, setActionInput] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [activeAction, setActiveAction] = useState("");
  const [activeActor, setActiveActor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async (requestedPage = page, action = activeAction, actor = activeActor) => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const api = getAccessApi();
    if (!api) {
      setLoading(false);
      setError("El acceso a auditoría no está disponible en esta versión.");
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await api.audit.list({
        page: requestedPage,
        pageSize: PAGE_SIZE,
        ...(action ? { action } : {}),
        ...(actor ? { actorId: actor } : {}),
      });
      if (currentRequest !== requestId.current) return;
      if (!result.ok) {
        if (result.error.code === "UNAUTHENTICATED") await refresh();
        setEvents([]);
        setError(result.error.code === "FORBIDDEN" ? "No tienes permiso para consultar la auditoría." : result.error.message);
        return;
      }
      setEvents(result.data.items);
      setPage(result.data.page);
      setTotal(result.data.total);
    } catch {
      if (currentRequest === requestId.current) setError("No se pudo cargar la auditoría local. Intenta nuevamente.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [activeAction, activeActor, canView, page, refresh]);

  useEffect(() => { void load(page, activeAction, activeActor); }, [load, page, activeAction, activeActor]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setActiveAction(actionInput.trim().slice(0, 100));
    setActiveActor(actorInput.trim().slice(0, 64));
  }

  if (!canView) {
    return <WorkspaceShell><PageContent><div className="page-intro"><p className="eyebrow">Control interno</p><h1>Auditoría</h1></div><PermissionNotice>No tienes permiso para consultar la auditoría.</PermissionNotice></PageContent></WorkspaceShell>;
  }

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <WorkspaceShell>
      <PageContent>
        <div className="page-intro"><p className="eyebrow">Control interno</p><h1>Auditoría</h1><p>Consulta eventos de acceso y cambios administrativos. Los registros se muestran sin datos de entrada ni secretos.</p></div>
        <form className="filter-card" onSubmit={applyFilters}>
          <label>Acción<input value={actionInput} onChange={(event) => setActionInput(event.target.value)} maxLength={100} placeholder="Filtrar por acción" /></label>
          <label>Identificador de actor<input value={actorInput} onChange={(event) => setActorInput(event.target.value)} maxLength={64} placeholder="UUID del actor" /></label>
          <button className="button button-primary" type="submit">Aplicar filtros</button>
        </form>
        <AlertMessage message={error} />
        <div className="table-card">
          {loading ? <p className="table-state" role="status">Cargando auditoría…</p> : events.length === 0 ? <p className="table-state">No hay eventos para mostrar.</p> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Fecha</th><th>Acción</th><th>Actor</th><th>Objetivo</th><th>Resultado</th><th>Solicitud</th></tr></thead>
                <tbody>{events.map((event) => <tr key={event.id}><td>{formatDate(event.occurredAt)}</td><td>{event.action}</td><td>{event.actorId ?? "Sistema"}</td><td>{event.targetId ?? "—"}</td><td><span className={event.outcome === "success" ? "state-label state-active" : "state-label state-inactive"}>{outcomeLabel(event)}</span></td><td className="request-id">{event.requestId}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="pagination" aria-label="Paginación de auditoría">
            <span>{total} evento{total === 1 ? "" : "s"}</span>
            <div><button className="button button-light" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>Anterior</button><span>Página {page} de {lastPage}</span><button className="button button-light" type="button" onClick={() => setPage((value) => Math.min(lastPage, value + 1))} disabled={page >= lastPage || loading}>Siguiente</button></div>
          </div>
        </div>
      </PageContent>
    </WorkspaceShell>
  );
}
