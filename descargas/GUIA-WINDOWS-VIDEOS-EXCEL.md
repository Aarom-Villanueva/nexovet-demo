# Actualizar NexoVet: videos, preloader y Excel

Entrega revisada para la demostración local de Aarom. Requiere la revisión
anterior `353b777`. Esta entrega conserva las **13 migraciones**; no incorpora
migraciones nuevas. No aplicar directamente a una clínica en producción.

Los archivos de video finales están en tu computadora. El bundle contiene el
código, las portadas y los subtítulos; **no contiene los siete MP4 editados**.
La revisión se ejecutó en Linux/Docker con PostgreSQL 17, no en Windows.

## 1. Preparación y respaldo

Abre Docker Desktop y espera a que el motor esté funcionando. Detén la
aplicación con Ctrl+C. En Windows PowerShell, ejecuta una línea por vez y
**detente si aparece un error**:

```powershell
cd C:\Users\aarom\nexovet-prueba
docker compose up -d --wait db
New-Item -ItemType Directory -Force .\.local\backups | Out-Null
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$dump = "/tmp/nexovet-pre-videos-$stamp.dump"
docker compose exec -T db pg_dump -U nexovet -d nexovet_dev --format=custom --no-owner -f $dump
docker compose cp "db:$dump" ".\.local\backups\nexovet-pre-videos-$stamp.dump"
git status
```

Confirma que se copió el respaldo. Consérvalo privadamente. No borres `.env`,
los volúmenes ni el cambio de `compose.yaml` que mantiene el puerto **15432**.
Si hay cambios propios, revísalos antes de cambiar de rama; no uses
`reset --hard`, `git clean` ni fuerces el cambio de rama.

## 2. Descargar e importar

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-videos-excel-revisado/descargas/nexovet-videos-excel-revisado.bundle" -OutFile "$env:USERPROFILE\Downloads\nexovet-videos-excel-revisado.bundle"
git bundle verify "$env:USERPROFILE\Downloads\nexovet-videos-excel-revisado.bundle"
git fetch "$env:USERPROFILE\Downloads\nexovet-videos-excel-revisado.bundle" fix/videos-excel-validation:fix/videos-excel-validation
git switch fix/videos-excel-validation
npm ci
node ops/prepare-local.mjs
npm run db:migrate
```

`npm ci` instala exactamente el lockfile revisado, incluidas fuentes, ExcelJS y
la resolución de `uuid` sin el aviso conocido. No hace falta `npm install`.
`db:migrate` compila primero el paquete compartido, por lo que funciona también
sin carpetas `dist` de una ejecución anterior. Debe informar **13 migraciones**.
El preparador conserva tus conexiones, el puerto y las opciones de Gemini.

No vuelvas a sembrar ni regeneres usuarios: tus registros de Mariana y Luna,
compras, ventas, contraseñas y operador deben conservarse.

Si la verificación avisa que falta `353b777`, importa primero los objetos de la
entrega anterior y repite la verificación; no descartes archivos:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-incorporacion-revisada/descargas/nexovet-public-onboarding-revisado.bundle" -OutFile "$env:USERPROFILE\Downloads\nexovet-public-onboarding-revisado.bundle"
git fetch "$env:USERPROFILE\Downloads\nexovet-public-onboarding-revisado.bundle" fix/public-onboarding-validation
```

## 3. Ver tus videos primero en local

Comprueba que los siete archivos editados existan:

```powershell
Get-ChildItem C:\proyectos\nexovet\editados\nexovet-*.mp4
```

Nombres esperados: `nexovet-presentacion.mp4`, `nexovet-agenda.mp4`,
`nexovet-atencion.mp4`, `nexovet-inventario.mp4`, `nexovet-ventas.mp4`,
`nexovet-reportes.mp4` y `nexovet-asistente.mp4`.

Copia las versiones finales, conservando los originales en su carpeta:

```powershell
Copy-Item C:\proyectos\nexovet\editados\nexovet-*.mp4 .\apps\web\public\media\
npm run dev
```

Abre http://localhost:5173/inicio. Debe aparecer el botón de reproducción en
las piezas que tengan archivo. Si añadiste archivos con la aplicación abierta,
reinicia `npm run dev`: el manifiesto detecta archivos al iniciar/compilar.
Los MP4 están ignorados por Git; no se publican al importar el bundle.

El perro/gato usa SVG/CSS y no necesita un archivo de Flow. Solo aparece cuando
hay una carga real; no añade una espera artificial. El movimiento se reduce si
el sistema operativo tiene habilitada esa preferencia.

## 4. Comprobar Excel

Como administrador, abre http://localhost:5173/reportes, elige el período del
video y pulsa **Descargar Excel (.xlsx)**. Comprueba en Excel:

- Cinco hojas, nombre de la clínica y período correctos.
- Ventas, cobros y compras iguales a los del reporte; no son ganancia.
- Encabezados, filtros, columnas y formato de soles legibles.
- Si hay importes demasiado grandes para Excel, aparecen como texto con aviso.

El CSV se conserva. `reporte-ejemplo.xlsx`, incluido en la descarga, solo muestra
el formato con datos ficticios de la revisión; no es un reporte de tu base.
La apertura y la impresión en Excel de Windows deben comprobarse en tu PC.
Si quieres que el clip de reportes muestre XLSX, graba esa parte con el botón
nuevo: la grabación anterior muestra CSV.

## 5. Conectar Cloudinary después de revisar los cortes

Sube los siete MP4 editados como videos públicos y copia sus URL `secure_url`.
No necesitas poner claves de Cloudinary en la página. En esta carpeta:

```powershell
notepad .\apps\web\.env.local
```

Añade o actualiza una sola línea, sustituyendo cada URL de ejemplo por la del
video correcto. No la dupliques si ya existe:

```dotenv
VITE_MEDIA_REMOTE={"presentacion":"https://res.cloudinary.com/TU-CUENTA/video/upload/ID-PRESENTACION.mp4","agenda":"https://res.cloudinary.com/TU-CUENTA/video/upload/ID-AGENDA.mp4","atencion":"https://res.cloudinary.com/TU-CUENTA/video/upload/ID-ATENCION.mp4","inventario":"https://res.cloudinary.com/TU-CUENTA/video/upload/ID-INVENTARIO.mp4","ventas":"https://res.cloudinary.com/TU-CUENTA/video/upload/ID-VENTAS.mp4","reportes":"https://res.cloudinary.com/TU-CUENTA/video/upload/ID-REPORTES.mp4","asistente":"https://res.cloudinary.com/TU-CUENTA/video/upload/ID-ASISTENTE.mp4"}
```

Conserva la URL completa que entrega Cloudinary, incluida su versión si aparece.
No pongas tu clave Gemini ni otra clave en variables `VITE_*`: llegan al navegador.
Este archivo está en `apps/web`, distinto del `.env` privado de la API en la raíz.
Reinicia la aplicación. Las URL externas tienen prioridad sobre los MP4 locales.

Comprueba que cada clip reproduzca el contenido correcto, que no cargue antes
de pulsar y que los subtítulos coincidan con el corte final. Las URL definitivas,
el comportamiento de cookies y los límites de tu cuenta Cloudinary no pudieron
verificarse sin esos recursos.

Para un servidor Docker, esa variable debe pasarse al **construir** la imagen;
cambiar solo el entorno de un contenedor ya construido no actualiza el sitio.
Consulta `PRESENTACION-MEDIOS-Y-LEGALES.md`. Esta guía no despliega el producto.

## 6. Legales y estado del registro

Privacidad, términos y cookies siguen siendo borradores con datos pendientes.
El registro autónomo queda apagado por defecto. No cambies el estado a aprobado
solo para ocultar el aviso: completa y revisa los documentos primero.
La revisión no cambia tu proveedor de IA ni utiliza tu clave real de Gemini.
