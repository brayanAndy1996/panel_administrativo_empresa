# Academia de natación

Actualizado: 2026-10-21. Estado: planificación y documentación; sin aplicación, API, migraciones ni comandos ejecutables.

Producto independiente, construido desde cero, sin CORE. Web Next.js y aplicación Android React Native desarrolladas independientemente, con backend Node.js/Sequelize y PostgreSQL en nube; SQLite y cola persistente en un único celular designado para realizar toda la operación offline. Los demás celulares operan online; no registran cambios sin conexión. No requiere PC principal ni Electron.

## Documentación propia

- [Acuerdos y primera entrega](docs/01-acuerdos-entregas.md).
- [Operación offline y sincronización](docs/02-operacion-sincronizacion.md).
- [Decisión de stack](docs/decisiones/001-stack.md).
- [Documento funcional detallado](docs/03-documentacion-funcional.md). Conserva historias y módulos posteriores; la primera entrega se delimita en el documento de acuerdos.

## Contexto local

Leer [contexto general](../CONTEXTO_GENERAL.md), [metodología](../METODOLOGIA.md), [stack](../STACK.md), [arquitectura transversal](../ARQUITECTURA_COMPARTIDA.md) y [datos de prueba](../DATOS_PRUEBA.md). Las decisiones de este producto precisan las excepciones de nube/Android, mensualidad calendario, proporcional y pagos completos. No trasladarlas al panel.

Los archivos de `docs/contexto/` son generados; no editarlos. La sincronización se ejecuta desde la raíz de documentación con `herramientas/Sincronizar-Contexto.ps1` y después `-Check`.

## Próximo trabajo

Cerrar las decisiones técnicas pendientes del ADR, preparar el mapa de datos/contratos y crear specs pequeñas antes de cada implementación. Priorizar backend y reglas críticas con frontend mínimo. Incorporar migraciones y demo opcional reproducible con los primeros recorridos. Documentar comandos reales al existir código; todavía no hay instalación, pruebas de aplicación ni despliegue verificados.
