import { SystemStatusPanel } from "../features/system/system-status-panel";
import { PageContent, WorkspaceShell } from "../features/access/workspace-shell";

export default function HomePage() {
  return (
    <WorkspaceShell>
      <PageContent>
        <div className="page-intro">
          <p className="eyebrow">Panel interno</p>
          <h1>Panel administrativo</h1>
          <p>Base local para administrar la operación de la empresa de software.</p>
        </div>

        <SystemStatusPanel />

        <section className="notice-card" aria-labelledby="next-stage-heading">
          <div>
            <p className="eyebrow">Siguiente etapa</p>
            <h2 id="next-stage-heading">Módulos comerciales</h2>
            <p>La gestión de empresas, contratos y pagos se incorporará después de esta base de acceso.</p>
          </div>
        </section>
      </PageContent>
    </WorkspaceShell>
  );
}
