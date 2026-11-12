# NexoVet — Demo interactiva

## Aplicación en desarrollo — bloques 1 y 2

La nueva aplicación está en `apps/web` (React + TypeScript) y `apps/api`
(Node.js + Fastify), con PostgreSQL en `database/`. Incluye migraciones,
datos sintéticos y una vista previa de solo lectura conectada a PostgreSQL.
La demo estática de esta carpeta continúa siendo la referencia visual publicada.

- [Instalación y comandos](docs/DESARROLLO.md)
- [Modelo de base de datos](docs/BASE-DE-DATOS.md)
- [Plan de los diez bloques](docs/PLAN.md)

Esta primera entrega todavía no implementa login, permisos ni operaciones
comerciales reales. La vista previa de datos está deshabilitada en producción.

---

Prototipo de un sistema de gestión para veterinarias con pet shop.

Incluye agenda, clientes, mascotas, seguimiento, inventario, compras, ventas, reportes y administración. Los botones «Explorar como…» permiten recorrer los roles de demostración.

## Estado

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
