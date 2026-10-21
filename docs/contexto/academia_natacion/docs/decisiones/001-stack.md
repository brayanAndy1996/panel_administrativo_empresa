# ADR 001 — Web, Android y nube

Fecha: 2026-10-21. Estado: dirección de stack acordada; validación técnica y versiones pendientes. No habilita implementación sensible sin spec ni declara compatibilidad probada.

## Requisitos y decisión

Personal exclusivamente con Android; online una persona registra asistencia y varias inscriben/cobran. Offline un único celular designado realiza toda la operación, hasta 24 horas: registro, aprobación, cobro, caja y asistencia, según permisos del usuario activo. Los otros celulares requieren conexión para registrar operaciones. Cámara QR y sincronización. Web y móvil independientes. No hay PC principal ni requisito de escritorio Electron. No hay CORE ni paquetes internos de otros productos.

| Capa | Elección | Encaje y límites |
|---|---|---|
| Lenguaje | TypeScript | Tipos y contratos documentados en los tres componentes. |
| Web | Next.js/React | Solicitudes, portal y administración online; no se empaqueta como móvil. |
| Móvil | React Native para Android | Interfaz independiente, cámara, lógica y almacenamiento local. |
| Backend | Node.js | API de negocio y sincronización para ambos clientes; framework HTTP pendiente. |
| ORM servidor | Sequelize | Persistencia PostgreSQL; no se instala dentro de React Native. |
| BD nube | PostgreSQL | Transacciones, aislamiento y consolidación multiempresa por producto; verificar su diseño. |
| BD móvil propuesta | SQLite | Base operativa y cola del único celular offline; biblioteca React Native y cifrado por evaluar. |

La dirección móvil es una excepción explícita al alcance Electron/PC de la documentación general; no modifica el panel. La nube/sincronización son parte de esta primera entrega de natación, aunque otros productos sigan locales.

## Alternativas y pendientes

React Native fue preferido explícitamente por el fundador frente a la propuesta Capacitor/PWA. No volver a seleccionar otra plataforma silenciosamente. Expo frente a React Native sin Expo sigue sin decidir. Tampoco se han elegido versiones, gestor de paquetes, drivers, librería de SQLite, autenticación, cifrado, almacenamiento de archivos, hosting ni canal de distribución Android.

Antes de implementar: verificar documentación oficial vigente y registrar versiones soportadas/compatibles de Node.js, Next.js, React Native/React, Sequelize, PostgreSQL, driver y biblioteca SQLite, SDK Android y herramientas de build. No heredar versiones del panel ni afirmar que un ORM asegura equivalencia entre PostgreSQL y SQLite.

## Pruebas técnicas pendientes

- Build Android instalable y ejecución sin internet, persistencia tras cierre/reinicio y cámara QR en hardware real.
- Cola durable única, límite de 24 horas y sincronización al reabrir. Validar designación exclusiva, bloqueo de escrituras offline en otros equipos y sustitución controlada.
- Contratos/cálculos equivalentes entre móvil y backend, migración local y servidor, deduplicación y conflictos atómicos.
- Respaldo/recuperación, protección local, credenciales y pérdida del único dispositivo offline. Su fallo detiene la operación offline y la nube no recupera pendientes nunca enviados.
- Medir respuesta de asistencia (objetivo funcional existente: menos de 2 segundos), volumen representativo, batería/almacenamiento y concurrencia. Versiones mínimas Android y equipos soportados pendientes de medición.

No hay benchmark, build, dependencias instaladas ni compatibilidad certificada. Completar este ADR con evidencia antes de fijar la base ejecutable.
