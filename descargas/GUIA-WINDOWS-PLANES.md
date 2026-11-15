# Instalar las tarjetas de planes y cobertura en Windows

Esta entrega no actualizó tu computadora ni publicó el sistema. Conserva tu `.env`, tu clave de Gemini y el puerto PostgreSQL 15432. No ejecutes seed ni recrees usuarios.

## 1. Descargar y respaldar

Descarga [el paquete completo](https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-planes-cobertura/descargas/NexoVet-planes-cobertura.zip) y extráelo en `Descargas\NexoVet-planes-cobertura`. El bundle es acumulativo desde la revisión de incorporación `353b777` que ya instalaste.

Abre Docker Desktop y espera a que esté funcionando. Detén `npm run dev` con Ctrl+C. En PowerShell:

```powershell
cd C:\Users\aarom\nexovet-prueba
git status
docker compose up -d --wait db
```

Si Docker falla, detente y resuelve ese error antes de continuar. Guarda tus cambios de código pendientes; no uses reset ni descartes `compose.yaml`. Respalda configuración y base:

```powershell
$stamp = Get-Date -Format yyyyMMdd-HHmmss
New-Item -ItemType Directory -Force .local\backups | Out-Null
Copy-Item .env ".local\backups\env-$stamp.backup"
Copy-Item compose.yaml ".local\backups\compose-$stamp.yaml"
$dump = "/tmp/nexovet-pre-planes-$stamp.dump"
docker compose exec -T db pg_dump -U nexovet -d nexovet_dev --format=custom --no-owner -f $dump
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el respaldo. No continúes.' }
docker compose cp "db:$dump" ".local\backups\nexovet-pre-planes-$stamp.dump"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el respaldo. No continúes.' }
```

Los respaldos contienen datos privados. No los subas a GitHub.

## 2. Importar

```powershell
$bundle = "$HOME\Downloads\NexoVet-planes-cobertura\nexovet-planes-cobertura.bundle"
git bundle verify $bundle
```

Debe decir que está correcto. Continúa solo si fue exitoso:

```powershell
git fetch $bundle feat/plan-cards-coverage:feat/plan-cards-coverage
git switch feat/plan-cards-coverage
npm ci
npm run db:migrate
```

Ejecuta cada comando por separado y detente si falla. La migración debe verificar **15 migraciones**. No cambies las conexiones ni vuelvas a preparar el entorno si ya funciona. Si Git avisa que tus cambios locales serían sobrescritos, detente y conserva esos cambios antes de cambiar de rama.

## 3. Verificar

```powershell
npm run dev
```

Abre `http://localhost:5173/inicio` y, con tu cuenta de administrador, Mi plan y pagos. Comprueba tres tarjetas, diálogos de Pro/Business, fechas de prueba y períodos pagados, cuota de IA e historial. Una prueba sin pago no debe llamarse servicio pagado. No hagas cargos reales.

## 4. Vitrina para publicar cuando decidas

La descarga separada [NexoVet-vitrina-planes.zip](https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-planes-cobertura/descargas/NexoVet-vitrina-planes.zip) contiene solo la web estática, con `index.html` en la raíz, sin API, acceso, registro ni secretos. No está desplegada. Para generarla tú:

```powershell
npm run showcase:build
node scripts/serve-static.mjs apps/web/dist-showcase 5175
```

Abre `http://localhost:5175/`. Solo se publica el contenido de `apps/web/dist-showcase`, nunca `.env` ni el repositorio completo. La rama de entrega de GitHub contiene descargas; no equivale a desplegar la rama de código. Si conectas un hosting al repositorio, primero tendrás que subir la rama de código local y configurar el build adecuado.

## Video

`nexovet-tiktok-demo.mp4` es un primer montaje vertical de 37 segundos con tus clips, sin música ni voz. Revísalo antes de publicarlo. El guion y los avisos se explican en `TIKTOK-GUION.md`.
