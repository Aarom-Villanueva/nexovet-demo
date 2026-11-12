# Diez bloques de implementación

| Bloque | Entrega                                                              | Estado de esta rama                                                     |
| ------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1      | Estructura React/TypeScript, API Node, configuración y navegación    | Implementado; aplicación conectada a PostgreSQL                         |
| 2      | PostgreSQL, migraciones, relaciones, restricciones y datos ficticios | Implementado; límites documentados en BASE-DE-DATOS.md                  |
| 3      | Login, sesiones, recuperación y autorización por rol                 | Implementado; correo local/SMTP y roles documentados                    |
| 4      | Registro/edición/búsqueda de clientes y mascotas                     | Implementado; fichas, paginación y control de edición                   |
| 5      | Gestión de agenda y atención veterinaria                             | Implementado; agenda, atención e historia clínica                       |
| 6      | Seguimientos, vencimientos y registro manual de contactos            | Implementado; tareas por rol y contactos sin envíos automáticos         |
| 7      | Inventario, proveedores y recepción de compras                       | Implementado; catálogo, proveedores, compras y ajustes con trazabilidad |
| 8      | Ventas, registro de cobros y movimientos asociados                   | Implementado; borradores, cobros manuales y salidas transaccionales     |
| 9      | Indicadores operativos, reportes, configuración y auditoría          | Pendiente; resumen sintético de demostración disponible                 |
| 10     | Pruebas de la operación completa, respaldo/restauración y despliegue | Pendiente; CI y pruebas iniciales disponibles                           |

Primer hito operativo: bloques 1–5, con un usuario autenticado que registra un
cliente, su mascota, una cita y la atención. Cada bloque incluirá validaciones y
pruebas propias. Las pruebas finales del bloque 10 no sustituyen esas verificaciones.

Primera versión: una sede y uso interno por personal. La demostración estática
continúa en la raíz para mantener disponible el enlace del portafolio. Los cambios
se revisan por rama/pull request antes de integrarlos a `main`.

El primer hito (bloques 1–5) ya permite el recorrido interno completo: crear cliente
y paciente, reservar cita, registrar llegada, iniciar la consulta con el veterinario
asignado y cerrarla. El bloque 6 añade seguimiento operativo y registro manual de contactos. El bloque 7 permite abastecer el almacén y consultar sus movimientos. El bloque 8 registra ventas, cobros completos y salidas de stock. Faltan
reportes/configuración y la verificación del despliegue. No es una reserva pública.
