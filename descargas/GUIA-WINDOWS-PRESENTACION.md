# Actualizar NexoVet: presentación y videos definitivos

Entrega revisada del 15/11/2026. Incluye el rediseño público, los siete enlaces
versionados de Cloudinary, el preloader, la exportación Excel y las correcciones
anteriores. No contiene los MP4 ni tus datos. Se mantienen las 13 migraciones.
Requiere tener importada la revisión 353b777 o una de sus descendientes.

## 1. Respalda antes de actualizar

Abre Docker Desktop y espera que termine de iniciar. Detén `npm run dev` con
Ctrl+C. En PowerShell, ejecuta una línea por vez y detente ante cualquier error:

```powershell
cd C:\Users\aarom\nexovet-prueba
docker compose up -d --wait db
New-Item -ItemType Directory -Force .\.local\backups | Out-Null
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$dump = "/tmp/nexovet-pre-presentacion-$stamp.dump"
docker compose exec -T db pg_dump -U nexovet -d nexovet_dev --format=custom --no-owner -f $dump
docker compose cp "db:$dump" ".\.local\backups\nexovet-pre-presentacion-$stamp.dump"
Copy-Item .env ".\.local\backups\env-$stamp.txt"
Copy-Item compose.yaml ".\.local\backups\compose-$stamp.yaml"
git status
```

Conserva estos respaldos en privado: contienen datos y secretos. Si tienes
cambios propios de código, guárdalos en un commit antes de cambiar de rama.
El cambio local de `compose.yaml` que conserva el puerto **15432** debe
mantenerse. Si Git rechaza el cambio de rama, detente y comparte el error;
no fuerces el cambio ni descartes archivos.

## 2. Descarga e importa la entrega

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-presentacion-revisada/descargas/nexovet-video-polish-revisado.bundle" -OutFile "$env:USERPROFILE\Downloads\nexovet-video-polish-revisado.bundle"
git bundle verify "$env:USERPROFILE\Downloads\nexovet-video-polish-revisado.bundle"
git fetch "$env:USERPROFILE\Downloads\nexovet-video-polish-revisado.bundle" fix/video-polish-validation:fix/video-polish-validation
git switch fix/video-polish-validation
npm ci
```

Si ya existe la rama y Git informa que no puede actualizarla, no uses `-f`:
comparte el mensaje. Si falta el antecedente 353b777, importa primero sus objetos:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-incorporacion-revisada/descargas/nexovet-public-onboarding-revisado.bundle" -OutFile "$env:USERPROFILE\Downloads\nexovet-public-onboarding-revisado.bundle"
git fetch "$env:USERPROFILE\Downloads\nexovet-public-onboarding-revisado.bundle" fix/public-onboarding-validation
```

Luego repite la verificación y la importación de esta entrega.

## 3. Usa los enlaces definitivos

No necesitas copiar ni volver a subir los videos. Las siete URL de Cloudinary
ya están en el código. Si creaste una configuración anterior, comprueba:

```powershell
if (Test-Path .\apps\web\.env.local) { Select-String -Path .\apps\web\.env.local -Pattern '^\s*VITE_MEDIA_REMOTE\s*=' }
```

Si aparece `VITE_MEDIA_REMOTE`, abre `apps\web\.env.local` y elimina **solo esa
variable**, conservando cualquier otra. Revisa también tus otros archivos de
configuración de Vite si los modificaste. Un valor antiguo sustituye las URL
del manifiesto. No borres el `.env` de la raíz ni cambies la clave de Gemini.

Esta entrega no agrega migraciones. Si vienes de una instalación anterior a
las 13 migraciones, usa el procedimiento de su guía antes de continuar.
No ejecutes seed ni regeneres usuarios: conserva tus clientes, ventas y claves.

## 4. Inicia y comprueba

```powershell
docker compose up -d --wait db
npm run dev
```

Abre http://localhost:5173/inicio y prueba:

1. El botón principal inicia el recorrido; si pausas, vuelve a iniciarlo.
2. Las seis pestañas reproducen sus clips, con controles y subtítulos.
3. En celular no se corta la interfaz ni aparecen barras horizontales.
4. Ingresar conserva tus cuentas y datos. La configuración de Gemini no cambia.
5. Reportes permite descargar Excel y CSV. El video antiguo muestra solo CSV;
   la aclaración está junto al clip. Regrabarlo es opcional.

Si falta un video local, no es un error: se utiliza Cloudinary. Si el servicio
externo falla y existe el MP4 en `apps\web\public\media`, se intenta ese respaldo;
si no existe, se ofrece reintentar sin bloquear la página.

## Antes de publicar

Esta actualización no publica nada en Internet ni habilita ventas automáticas.
Privacidad, términos y cookies siguen como borradores; completa y revisa los
datos comerciales y proveedores antes de habilitar el registro. Quedan las
pruebas en tu Windows, Safari/iOS y el dominio real con HTTPS, correo y Gemini.
La revisión adjunta distingue lo probado ahora de las pruebas previas.
