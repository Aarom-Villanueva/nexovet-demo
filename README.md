# NexoVet — Demo interactiva

## Aplicación en desarrollo — bloques 1 a 8

La nueva aplicación está en `apps/web` (React + TypeScript) y `apps/api`
(Node.js + Fastify), con PostgreSQL en `database/`. Incluye migraciones,
datos sintéticos, autenticación real por rol y registro, edición y búsqueda
de clientes y mascotas conectados a PostgreSQL.
La demo estática de esta carpeta continúa siendo la referencia visual publicada.

- [Instalación y comandos](docs/DESARROLLO.md)
- [Modelo de base de datos](docs/BASE-DE-DATOS.md)
- [Clientes y mascotas](docs/CLIENTES-Y-MASCOTAS.md)
- [Agenda y atención](docs/AGENDA-Y-ATENCION.md)
- [Seguimientos y contactos](docs/SEGUIMIENTOS-Y-CONTACTOS.md)
- [Inventario y compras](docs/INVENTARIO-Y-COMPRAS.md)
- [Ventas y cobros](docs/VENTAS-Y-COBROS.md)
- [Plan de los diez bloques](docs/PLAN.md)

El bloque 3 añade login, sesiones, recuperación de contraseña y permisos en la API.
Clientes y mascotas tienen fichas, filtros, archivo reversible y paginación.
La agenda permite programar y reprogramar visitas, registrar llegada y realizar
atenciones con historia clínica. Seguimiento incorpora tareas por responsable,
vencimientos y registro manual de contactos. El inventario incorpora productos,
proveedores, ajustes y recepción de compras que ingresa stock. Ventas permite
registrar productos/servicios y confirmar cobros completos con salidas transaccionales.
Consulta [Autenticación](docs/AUTENTICACION.md) para crear accesos locales y configurar correo.

---

Prototipo de un sistema de gestión para veterinarias con pet shop.

Incluye agenda, clientes, mascotas, seguimiento, inventario, compras, ventas, reportes y administración. Los botones «Explorar como…» permiten recorrer los roles de demostración.

## Estado del prototipo estático de la raíz

Demo de interfaz con datos ficticios. Las operaciones se simulan en la memoria del navegador y se reinician al recargar o pulsar «Reiniciar demo». No hay autenticación real, backend, conexión a PostgreSQL ni integración bancaria. No introducir información real de clientes o pacientes.

El diseño original exportado se conserva; Main.dc.html se renombró a index.html para publicarlo como sitio estático.

## Abrir localmente

Con Python instalado, ejecutar dentro de esta carpeta:

    python3 -m http.server 4173

Abrir http://localhost:4173. No requiere dependencias ni compilación. La fuente Inter se solicita a Google Fonts y tiene fuentes del sistema como alternativa.

## Publicar

GitHub Pages: Settings → Pages → Deploy from a branch → main → / (root).

Vercel: Framework Preset «Other», sin comando de compilación y directorio de publicación raíz.

Conservar juntos index.html, support.js y vendor/. El runtime de diseño incluido renderiza el prototipo; esta exportación no constituye un sistema listo para producción.
