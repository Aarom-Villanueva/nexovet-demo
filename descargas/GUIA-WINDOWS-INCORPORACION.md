# Actualizar NexoVet en Windows: sitio público e incorporación

Para la copia local de demostración de Aarom, que ya tiene la versión revisada
multitenant `d82a5d7`. No ejecutar contra una clínica en producción. Las pruebas
se realizan en Linux con PostgreSQL 17; esta guía usa sintaxis de PowerShell.

Abre Docker Desktop, detén `npm run dev` con Ctrl+C y ejecuta una línea por vez.
Si una línea falla, detente y conserva el error. No borres `.env`, los volúmenes
ni el cambio de `compose.yaml` que conserva tu puerto **15432**.

## 1. Respaldo antes de actualizar

```powershell
cd C:\Users\aarom\nexovet-prueba
docker compose up -d --wait db
New-Item -ItemType Directory -Force .\.local\backups | Out-Null
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$dump = "/tmp/nexovet-pre-incorporacion-$stamp.dump"
docker compose exec -T db pg_dump -U nexovet -d nexovet_dev --format=custom --no-owner -f $dump
docker compose cp "db:$dump" ".\.local\backups\nexovet-pre-incorporacion-$stamp.dump"
git status
```

Comprueba que el archivo se copió. Guarda el respaldo privadamente. Si tienes
cambios propios, revísalos antes de cambiar de rama: no uses `reset --hard` ni
`git clean`. El bundle no incluye tus credenciales ni tu base de datos.

## 2. Descarga e importa la revisión

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-incorporacion-revisada/descargas/nexovet-public-onboarding-revisado.bundle" -OutFile "$env:USERPROFILE\Downloads\nexovet-public-onboarding-revisado.bundle"
git bundle verify "$env:USERPROFILE\Downloads\nexovet-public-onboarding-revisado.bundle"
git fetch "$env:USERPROFILE\Downloads\nexovet-public-onboarding-revisado.bundle" fix/public-onboarding-validation:fix/public-onboarding-validation
git switch fix/public-onboarding-validation
npm ci
node ops/prepare-local.mjs
npm run db:migrate
npm run dev
```

El bundle requiere el commit `d82a5d7` de la revisión multitenant anterior.
`db:migrate` debe informar **13 migraciones**. No se modifican las 12 anteriores.
El preparador conserva el puerto y la configuración privada existente.
No hace falta recrear el operador, volver a sembrar ni cambiar contraseñas.
Si Git avisa que un archivo local se sobrescribiría, detente; no fuerces el cambio.
No vuelvas a una rama anterior usando la misma base ya migrada.

## 3. Qué probar primero

- http://localhost:5173/inicio: presentación pública y solicitud de demostración.
- http://localhost:5173/ingresar: acceso con tus cuentas existentes.
- http://localhost:5173/plataforma: tu operador puede ver solicitudes, publicar
  precios y controlar mantenimiento. El administrador de una clínica no puede.
- http://localhost:5173/configuracion-inicial: configuración para el administrador
  de la clínica. En las clínicas anteriores no aparece una bienvenida de alta
  nueva; crea otra clínica vacía desde plataforma para probarla.
- Ayuda: reiniciar el tutorial del rol actual. No completa tareas ni inventa datos.

El registro autónomo permanece **apagado**. El formulario de demostración guarda
la solicitud en plataforma; no envía aviso por correo ni WhatsApp.

## 4. Registro autónomo, solo para probar localmente

Detén la aplicación. Añade o actualiza estas claves en tu `.env` privado,
conservando todas las demás líneas y sin duplicar claves:

```dotenv
SELF_SIGNUP=enabled
MAIL_DELIVERY=local
LEGAL_TERMS_URL=https://legal.example.invalid/condiciones
LEGAL_PRIVACY_URL=https://legal.example.invalid/privacidad
LEGAL_TERMS_VERSION=prueba-local
SIGNUP_TRIAL_DAYS=14
```

Reinicia `npm run dev`, abre http://localhost:5173/registro y usa un correo ficticio
nuevo. Busca el archivo más reciente de `.local/mail`: contiene el enlace de
verificación. Ese archivo es privado y no se comparte. No sale ningún correo real.
Abre su enlace, elige contraseña y acepta las condiciones de prueba. Después
podrás ingresar a la clínica nueva y completar sus datos reales de demostración.
La prueba no convierte tu cuenta en operador de plataforma.

Estos enlaces `example.invalid` son ejemplos y no contienen documentos legales.
Para publicar el registro hay que sustituirlos por condiciones y privacidad
aprobadas, configurar SMTP real y verificar entrega, dominio y HTTPS. Para volver
al alta asistida establece `SELF_SIGNUP=disabled` y reinicia.

## 5. Si activas mantenimiento

El operador puede desactivarlo desde `/plataforma`. Si no carga el panel, detén
la aplicación y ejecuta desde esta carpeta, con la conexión propietaria de `.env`:

```powershell
npm run ops:maintenance -- status
npm run ops:maintenance -- off
npm run dev
```

Para una sola clínica: `npm run ops:maintenance -- off identificador-de-clinica`.
El interruptor estático de Caddy es otro mecanismo, reservado al servidor Docker;
no aparece por ejecutar `npm run dev`. No indica impago ni cambia suscripciones.
