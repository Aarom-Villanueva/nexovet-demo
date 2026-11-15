# NexoVet: actualizar sistema y probar la vitrina

Entrega revisada sobre 0fe28d6. Incluye la página independiente, el Plan inicial,
Mi plan y pagos y las correcciones previas. Requiere el antecedente 353b777,
que el bundle incluye como requisito; no necesita instalar por separado cada
bundle posterior. Esta versión tiene **14 migraciones**. No es una activación
de cobros reales ni publica nada automáticamente.

## 1. Respaldo

Abre Docker Desktop y espera a que funcione. Detén npm run dev con Ctrl+C.
Ejecuta en Windows PowerShell una línea por vez y detente ante cualquier error:

```powershell
cd C:\Users\aarom\nexovet-prueba
docker compose up -d --wait db
New-Item -ItemType Directory -Force .\.local\backups | Out-Null
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$dump = "/tmp/nexovet-pre-lanzamiento-$stamp.dump"
docker compose exec -T db pg_dump -U nexovet -d nexovet_dev --format=custom --no-owner -f $dump
docker compose cp "db:$dump" ".\.local\backups\nexovet-pre-lanzamiento-$stamp.dump"
Copy-Item .env ".\.local\backups\env-$stamp.txt"
Copy-Item compose.yaml ".\.local\backups\compose-$stamp.yaml"
git status
```

Conserva estos archivos en privado. Mantén .env, las cuentas, Gemini y el puerto
15432 de compose.yaml. Guarda cambios propios de código antes de cambiar de
rama; si Git rechaza el cambio, detente sin forzarlo ni descartar archivos.
No uses docker compose down -v, git reset --hard ni git clean.

## 2. Descargar e importar

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-lanzamiento-revisado/descargas/nexovet-lanzamiento-comercial-revisado.bundle" -OutFile "$env:USERPROFILE\Downloads\nexovet-lanzamiento-comercial-revisado.bundle"
git bundle verify "$env:USERPROFILE\Downloads\nexovet-lanzamiento-comercial-revisado.bundle"
git fetch "$env:USERPROFILE\Downloads\nexovet-lanzamiento-comercial-revisado.bundle" fix/commercial-launch-validation:fix/commercial-launch-validation
git switch fix/commercial-launch-validation
npm ci
```

Se necesita Node 22.12 o posterior compatible con el proyecto. Si falta el
antecedente 353b777, importa sus objetos y repite la verificación:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-incorporacion-revisada/descargas/nexovet-public-onboarding-revisado.bundle" -OutFile "$env:USERPROFILE\Downloads\nexovet-public-onboarding-revisado.bundle"
git fetch "$env:USERPROFILE\Downloads\nexovet-public-onboarding-revisado.bundle" fix/public-onboarding-validation
```

## 3. Actualizar la base sin resembrar

En el .env principal conserva tu configuración y comprueba que BILLING_MODE
sea disabled; si no existe, añade `BILLING_MODE=disabled`. No agregues llaves
vivas de Culqi. Conserva eliminada cualquier configuración antigua
VITE_MEDIA_REMOTE en apps\web\.env.local que sustituya los enlaces definitivos.

```powershell
npm run db:migrate
node --env-file=.env scripts/check-catalog.mjs --database
```

Debe informar **14 migraciones**. La 014 agrega las tablas de renovación y
asigna S/129 al plan inicial solo si no tenía precio. Si el catálogo no coincide
con un precio o cupo que ya editaste, el comando lo informa: no borres la base
ni sobreescribas esos valores automáticamente. Los cobros continúan apagados.
No ejecutes db:seed ni auth:demo-users: conserva tus datos y contraseñas.

## 4. Probar el sistema privado

```powershell
npm run dev
```

Abre http://localhost:5173/ingresar. Como administrador encontrarás
**Mi plan y pagos**. Recepción y veterinarios no deben ver ese menú. Con el
modo disabled podrás consultar la información, pero no iniciar cobros.
El aviso aparece desde cinco días antes del vencimiento, según la fecha del
servidor en Lima. /inicio en este servidor sigue siendo la página integrada
del sistema; la vitrina sin acceso se prueba por separado.

## 5. Probar la vitrina independiente

Abre otra ventana de PowerShell:

```powershell
cd C:\Users\aarom\nexovet-prueba
npm run showcase:build
node scripts/serve-static.mjs apps/web/dist-showcase 5175
```

Abre **http://localhost:5175/**, sin /inicio. No necesita API ni base de datos
para funcionar. Debe mostrar S/129 como precio previsto, 100 análisis, los
videos, el crédito de autor y «Contratación próximamente», sin ingreso,
registro ni formularios. Para detener la vista previa usa Ctrl+C.

## 6. Archivos para publicar

La única carpeta pública es **apps/web/dist-showcase/**. Publícala en la raíz
del dominio. El ZIP NexoVet-vitrina-lista.zip contiene su contenido estático,
con index.html en la raíz. No contiene el backend, .env ni claves.
No necesita PostgreSQL en el alojamiento de la vitrina.

Si eliges Vercel con GitHub, primero debe existir en GitHub la rama real de
código actualizada. La rama entrega-lanzamiento-revisado contiene descargas;
no la uses como código de despliegue. Desde tu copia local puedes publicar
la rama de código revisada con `git push -u origin fix/commercial-launch-validation`
cuando decidas hacerlo. En Vercel selecciona esa rama, raíz del repositorio,
comando `npm ci && npm run showcase:build` y salida `apps/web/dist-showcase`.
No agregues a la vitrina variables DATABASE_URL, claves de Gemini o Culqi.

Esta entrega no ejecuta ese push ni despliegue. Para GitHub Pages en un
subdirectorio se necesita adaptar la base de las rutas: el build entregado
está configurado para la raíz de un dominio.

## Antes de cobrar

Los documentos legales continúan en borrador y el registro autónomo apagado.
Hay que definir identidad/RUC, soporte, precios finales e impuestos, proveedores
y condiciones de servicio; después validar Culqi con llaves reales de prueba,
3DS, conciliación y recuperación de resultados inciertos.
Hoy no hay débito automático. Por la política actual, al vencer se limita
el asistente con IA; el CRM conserva su acceso. Revisa esa política comercial
antes de ofrecer una suscripción en producción.
