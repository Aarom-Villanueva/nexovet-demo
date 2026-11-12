# Diez bloques de implementación

| Bloque | Entrega                                                              | Estado de esta rama                                     |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------- |
| 1      | Estructura React/TypeScript, API Node, configuración y navegación    | Implementado; vista previa de solo lectura              |
| 2      | PostgreSQL, migraciones, relaciones, restricciones y datos ficticios | Implementado; límites documentados en BASE-DE-DATOS.md  |
| 3      | Login, sesiones, recuperación y autorización por rol                 | Implementado; correo local/SMTP y roles documentados    |
| 4      | Registro/edición/búsqueda de clientes y mascotas                     | Pendiente; vista de muestra disponible                  |
| 5      | Gestión de agenda y atención veterinaria                             | Pendiente; agenda de muestra disponible                 |
| 6      | Seguimientos, recordatorios y registro de contactos                  | Pendiente; vista de muestra disponible                  |
| 7      | Inventario, proveedores y recepción de compras                       | Pendiente; catálogo y stock de muestra disponibles      |
| 8      | Ventas, registro de cobros y movimientos asociados                   | Pendiente                                               |
| 9      | Indicadores operativos, reportes, configuración y auditoría          | Pendiente; resumen sintético de demostración disponible |
| 10     | Pruebas de la operación completa, respaldo/restauración y despliegue | Pendiente; CI y pruebas iniciales disponibles           |

Primer hito operativo: bloques 1–5, con un usuario autenticado que registra un
cliente, su mascota, una cita y la atención. Cada bloque incluirá validaciones y
pruebas propias. Las pruebas finales del bloque 10 no sustituyen esas verificaciones.

Primera versión: una sede y uso interno por personal. La demostración estática
continúa en la raíz para mantener disponible el enlace del portafolio. Los cambios
se revisan por rama/pull request antes de integrarlos a `main`.
