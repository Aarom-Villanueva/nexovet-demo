# Portada a todo el ancho

Texto a la izquierda y recorrido a la derecha sobre un único video de mascotas. El video cubre el ancho completo de la primera sección, detrás del navbar, y termina en un degradado al fondo crema. En móvil las dos columnas se apilan. Se mantienen fuentes, colores, videos, botones y preferencias de movimiento/ahorro de datos. Los enlaces legales en borrador se ocultan en el footer público; sus documentos y rutas siguen guardados. No hay cambios de base de datos ni de pagos.

## Windows

Detén la aplicación con Ctrl+C. Conserva tus cambios locales; no uses reset. Si aún no instalaste las tarjetas y cobertura, respalda primero la base y `.env` con `docs/GUIA-WINDOWS-PLANES.md`.

```powershell
cd C:\Users\aarom\nexovet-prueba
$bundle = "$HOME\Downloads\nexovet-portada-ancha.bundle"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-portada-ancha/descargas/nexovet-portada-ancha.bundle" -OutFile $bundle
git bundle verify $bundle
```

Si la verificación es correcta, ejecuta uno por uno y detente ante errores:

```powershell
git fetch $bundle feat/wide-hero-layout:feat/wide-hero-layout
git switch feat/wide-hero-layout
npm ci
docker compose up -d --wait db
npm run db:migrate
npm run dev
```

Abre http://localhost:5173/inicio. El bundle acumula los cambios desde `353b777`; no agrega migraciones a las 15 existentes. Conserva Gemini, `.env` y el puerto 15432. No ejecutes seed ni recrees usuarios. No se desplegó nada. La vitrina estática se genera con `npm run showcase:build`; publica solo `apps/web/dist-showcase`.

Verificación: compilación de vitrina/TypeScript web y formato correctos; 14 pruebas de navegador correctas, incluida anchura completa y columnas/apilado móvil. Capturas revisadas a 1440 y 390 píxeles. Sin pruebas nuevas de base de datos (no hay cambios allí); Windows y Safari/iOS no probados.
