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
npm run dev
```

En PowerShell, `Copy-Item .env.example .env` equivale al comando `cp`.

- Aplicación: http://localhost:5173
- Salud de API: http://localhost:3001/api/health
- Disponibilidad de base/migraciones: http://localhost:3001/api/ready
- Vista previa: http://localhost:3001/api/demo/overview

Las credenciales de `.env.example` son exclusivamente locales. Compose publica
PostgreSQL solo en `127.0.0.1`. No exponer esos valores ni usar ese Compose como
configuración de producción. `.env` queda ignorado por Git.

`ENABLE_DEMO=true` habilita una ruta temporal de solo lectura para desarrollo o
pruebas. Además exige un negocio marcado `is_demo` en la base. Con
`NODE_ENV=production`, activar la vista previa impide iniciar el servidor; sin
activarla la ruta no existe. No debe cargarse información real en esta entrega.

## Qué puedes recorrer

Resumen, agenda del día, muestra de clientes y mascotas, inventario y seguimiento.
La consulta llega a PostgreSQL a través de la API: no hay una respuesta simulada
que esconda fallos de conexión. Si la API o la semilla no están disponibles, la
interfaz muestra el error y permite reintentar.

Compras, ventas, reportes y administración tienen rutas identificadas como «en
preparación». No hay botones de escritura, login ni permisos de usuario todavía.
Las tablas presentan muestras limitadas, no listados paginados completos. La
autenticación del bloque 3 sustituirá el acceso temporal antes de exponer datos
de una veterinaria. La demo antigua sigue abriendo desde GitHub Pages.

## Datos ficticios

`npm run db:seed` inserta 320 clientes, 400 mascotas, 320 productos, 320 saldos
iniciales, 36 citas, 24 tareas, catálogos y borradores de compra/venta. Los correos
usan `example.invalid` y no se generan teléfonos ni documentos de identidad.
Las cuatro personas del personal tienen login deshabilitado y ningún hash de
contraseña. No existen credenciales de acceso de prueba en este bloque.

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
compilación de frontend/backend. Las pruebas de navegador comprueban navegación,
lectura de datos, error/reintento y pantalla móvil. La prueba concurrente deja
asientos de prueba compensados en la base de test, sin modificar el saldo final.
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
solo aloja la demo estática. El despliegue operativo corresponde al bloque 10.

## Estructura

```text
apps/api/src/          API, configuración, conexión y comandos de base
apps/web/src/          React, navegación, consultas y componentes
packages/shared/src/  Contrato TypeScript de la vista previa
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
