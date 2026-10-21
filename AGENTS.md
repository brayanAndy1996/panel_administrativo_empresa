# Trabajo en el panel administrativo

Leer `README.md`, `docs/contexto/CONTEXTO_GENERAL.md`, `docs/contexto/METODOLOGIA.md` y las specs/documentos propios afectados. El snapshot permite leer el contexto incluso al clonar únicamente este repositorio.

El panel construye desde cero sus módulos de usuarios, roles, permisos, auditoría y operación comercial. CORE fue descartado el 2026-10-20: no crear dependencia, copiar implementación de otro producto ni esperar paquetes publicados. La documentación bajo `docs/contexto/core/` es solo archivo histórico, no instrucciones vigentes. No incluir aquí la lógica de ventas, matrículas ni temas/logos de los negocios.

Priorizar backend/arquitectura y UI funcional mínima; seguir la política de roles/modelos común. Los documentos en `docs/contexto/` son generados: modificar fuentes globales y sincronizar desde el espacio de documentación. Mantener las specs del panel en `docs/specs/` cuando existan.
