# Desarrollo local — NexoVet

Requisitos: Node.js 22.12 o superior (CI: Node 22), npm y Docker con Compose.
PostgreSQL 17 también puede instalarse directamente si se actualizan las URLs.

## Preparar la aplicación

Desde la raíz del repositorio:

```sh
npm ci
cp .env.example .env
docker compose up -d --wait db
npm run db:migrate
npm run db:seed
npm run auth:demo-users
npm run dev
```

En PowerShell, `Copy-Item .env.example .env` equivale al comando `cp`.

- Aplicación: http://localhost:5173
- Salud de API: http://localhost:3001/api/health
- Disponibilidad de base/migraciones/negocio: http://localhost:3001/api/ready
- Login: http://localhost:5173/ingresar
- Resumen protegido: `/api/overview` (requiere cookie de sesión)
- Accesos de desarrollo: archivo privado `.local/demo-credentials-nexovet_dev.json`

Las credenciales de `.env.example` son exclusivamente locales. Compose publica
PostgreSQL solo en `127.0.0.1`. No exponer esos valores ni usar ese Compose como
configuración de producción. `.env` queda ignorado por Git.

Todas las rutas de datos requieren autenticación. La antigua ruta pública
`/api/demo/overview` se retiró. `ENABLE_DEMO` conserva la protección que impide
arrancar producción con ese indicador; no permite saltarse el login.
[Autenticación](AUTENTICACION.md) detalla sesiones, permisos, recuperación y SMTP.
No cargar información real antes de completar y desplegar la aplicación.

## Qué puedes recorrer

Resumen, agenda por día/semana, directorio de clientes y mascotas, inventario y seguimiento.
[El bloque 6](SEGUIMIENTOS-Y-CONTACTOS.md) añade tareas por responsable, vencimientos
y contactos manuales con reintentos que evitan duplicados; no envía comunicaciones.
[El bloque 7](INVENTARIO-Y-COMPRAS.md) permite mantener el catálogo y proveedores,
registrar ajustes justificados y recibir compras con entradas transaccionales.
[El bloque 8](VENTAS-Y-COBROS.md) incorpora ventas mixtas y cobros manuales completos,
confirmados junto con sus salidas de stock y auditoría.
[El bloque 9](REPORTES-Y-ADMINISTRACION.md) incorpora reportes/CSV, configuración y
auditoría de solo lectura; el equipo y servicios se mantienen desde Administración.
[El bloque 4](CLIENTES-Y-MASCOTAS.md) permite registrar, editar, buscar y archivar
fichas. Administrador y recepción escriben; veterinario solo consulta pacientes.
[El bloque 5](AGENDA-Y-ATENCION.md) conecta las citas con el registro de atención
y la historia del paciente; recepción maneja horarios y llegada, y el veterinario
asignado registra/cierra la consulta.
La consulta llega a PostgreSQL a través de la API: no hay una respuesta simulada
que esconda fallos de conexión. Si la API o la semilla no están disponibles, la
interfaz muestra el error y permite reintentar.

Compras, ventas, reportes y administración ya cuentan con flujos conectados a la
base. El veterinario consulta pacientes, agenda, historia clínica y seguimientos
propios; no accede a clientes/contactos, inventario, precios ni reportes comerciales.
Los listados operativos tienen búsqueda y paginación según sus contratos.
La demo estática antigua sigue abriendo desde GitHub Pages y sus accesos por rol
son simulados: no son las cuentas de esta nueva aplicación.

## Datos ficticios

`npm run db:seed` inserta 320 clientes, 400 mascotas, 320 productos, 320 saldos
iniciales, 36 citas, 24 tareas, catálogos y borradores de compra/venta. Los correos
usan `example.invalid` y no se generan teléfonos ni documentos de identidad.
La semilla deja las cuatro cuentas sin acceso habilitado. `auth:demo-users` las
habilita con contraseñas aleatorias privadas, solo en bases locales de demo.
Repetir la semilla conserva hashes, roles y accesos existentes.

La semilla usa identificadores estables e inserta solo filas ausentes. Repetirla
no duplica filas ni reinicia datos existentes. Las citas nuevas se ubican desde
la fecha de ejecución en Lima; repetir la semilla no cambia las fechas ya
insertadas. Si vuelves días después, la agenda de hoy puede estar vacía: no se
inventa una agenda alternativa. No hay un comando automático que borre datos.

La semilla requiere una base llamada `nexovet_dev` o `nexovet_test`, rechaza
`NODE_ENV=production` y rechaza una configuración de negocio no demostrativa.

## Verificación

Crear una sola vez una base separada de pruebas:

```sh
docker compose exec -T db psql -U nexovet -d postgres -c "CREATE DATABASE nexovet_test OWNER nexovet"
npm run check
npx playwright install chromium
npm run test:e2e
```

Si la base de pruebas ya existe, omite el comando de creación. La variable
`TEST_DATABASE_URL` está en el ejemplo. Las pruebas de base rechazan cualquier
nombre distinto de `nexovet_test`; migran y cargan datos ficticios por sí mismas.
No necesitan permisos sobre una base real.

`npm run check` ejecuta tipos, pruebas de API, pruebas con PostgreSQL real y la
compilación de frontend/backend. Las pruebas de agenda incluyen reservas y ediciones
concurrentes, transiciones, permisos clínicos, cierre e historia. Las pruebas de
navegador comprueban navegación,
login, sesiones, roles, recuperación, altas/edición de fichas, conflictos entre
ediciones, conservación de borradores, archivo, agenda, atención, historia, error/reintento
y pantalla móvil.
`test:e2e` prepara migraciones, semilla y accesos locales antes de ejecutar.
Las pruebas de autenticación crean usuarios sintéticos; se desactivan al terminar
y se conservan sus registros de auditoría. Las pruebas de fichas limpian únicamente
los clientes y mascotas que ellas crean, sin borrar su auditoría; no modifican
fichas de la semilla. La prueba concurrente deja
asientos de prueba compensados en la base de test, sin modificar el saldo final.
Las pruebas de inventario conservan su libro inmutable: compensan los saldos de
sus productos propios y archivan las fichas; no borran documentos finalizados.
Las pruebas de atención crean además un veterinario sintético por ejecución para
no competir con citas de la semilla según la hora del día; se desactiva al terminar.
El flujo de GitHub Actions ejecuta estas verificaciones en cada pull request.

```sh
npm run typecheck
npm test
npm run test:db
npm run build
```

El backend compilado se ejecuta con `npm start -w @nexovet/api`. La salida web
queda en `apps/web/dist`. Una publicación de la nueva aplicación necesitará
hosting para Node y PostgreSQL, configuración SPA y proxy `/api`; GitHub Pages
solo aloja la demo estática. El [bloque 10](DESPLIEGUE-Y-RESPALDOS.md) proporciona imágenes, Compose HTTPS,
inicialización vacía, respaldo y recuperación probada en una instalación aislada.

## Estructura

```text
apps/api/src/          API, configuración, conexión y comandos de base
apps/web/src/          React, navegación, consultas y componentes
packages/shared/src/  Contratos TypeScript de acceso, fichas y resumen
database/migrations/  SQL versionado, ejecutado en orden y con checksum
database/seeds/       Datos sintéticos idempotentes
docs/                 Modelo, decisiones y plan
tests/e2e/            Navegador de escritorio y móvil
index.html            Prototipo original publicado (conservado)
```

Las migraciones aplicadas no se editan: un cambio de modelo se agrega en un
nuevo archivo numerado. El ejecutor bloquea migraciones simultáneas, aplica cada
archivo en una transacción y rechaza cambios de checksum en versiones aplicadas.
No añadir claves, tokens, datos de clientes ni volcados de una base real al repo.
