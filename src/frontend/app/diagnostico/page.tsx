import { SystemStatusPanel } from "../../features/system/system-status-panel";
import { PageContent, WorkspaceShell } from "../../features/access/workspace-shell";

export default function DiagnosticsPage() {
  return (
    <WorkspaceShell>
      <PageContent>
        <div className="page-intro">
          <p className="eyebrow">Operación local</p>
          <h1>Estado técnico</h1>
          <p>Información de la aplicación y de la base de datos de esta instalación.</p>
        </div>
        <SystemStatusPanel detailed />
        <section className="notice-card" aria-labelledby="access-heading">
          <div>
            <p className="eyebrow">Acceso local</p>
            <h2 id="access-heading">Sesión protegida</h2>
            <p>La identidad y los permisos de esta instalación pertenecen al panel.</p>
          </div>
        </section>
      </PageContent>
    </WorkspaceShell>
  );
}
