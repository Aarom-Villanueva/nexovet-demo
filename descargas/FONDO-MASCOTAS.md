# Fondo de mascotas — 15/11/2026

Video original proporcionado por Aarom: https://res.cloudinary.com/epea8suu/video/upload/v1794776346/Pets_playing_in_garden_3e75ce5e.mp4

Se incluye una versión H.264 optimizada sin audio, de unos ocho segundos y 1280×720, en `apps/web/public/media/hero-fondo.mp4`, junto a `hero-fondo.webp`, extraída del video. Se sirven desde el propio sitio; el fondo no añade una conexión automática a Cloudinary. Los clips de producto mantienen su reproducción voluntaria desde Cloudinary.

La portada conserva DM Sans, Manrope y la paleta. El velo verde oscuro y el texto claro mantienen la legibilidad. El encuadre favorece la parte derecha donde están las mascotas; en móvil el recorte es más estrecho. El control para pausar tiene espacio propio debajo del contenido.

El fondo se pide después de cargar la página, en tiempo ocioso. Se reproduce silenciado, en bucle y dentro de la página. No se solicita con movimiento reducido o ahorro de datos/2G. Si el video falla o el navegador impide reproducirlo, permanece la imagen. Se pausa cuando queda fuera de pantalla o se oculta la pestaña. Una pausa manual se respeta al volver.

No cambia el preloader, la base de datos, los planes, Gemini, el acceso ni los pagos. No hay migraciones nuevas ni despliegue. Al añadir o sustituir archivos de media debes reiniciar el servidor de desarrollo o recompilar.

## Instalar desde PowerShell

Abre Docker Desktop si vas a iniciar el sistema completo y detén `npm run dev` con Ctrl+C. Primero respalda tus cambios de código pendientes; no uses reset ni descartes `compose.yaml`.

```powershell
cd C:\Users\aarom\nexovet-prueba
$bundle = "$HOME\Downloads\nexovet-fondo-mascotas.bundle"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-fondo-mascotas/descargas/nexovet-fondo-mascotas.bundle" -OutFile $bundle
git bundle verify $bundle
```

Si dice que está correcto, ejecuta cada comando por separado y detente si falla:

```powershell
git fetch $bundle feat/pets-hero-video:feat/pets-hero-video
git switch feat/pets-hero-video
npm ci
docker compose up -d --wait db
npm run db:migrate
npm run dev
```

Abre http://localhost:5173/inicio. Conserva `.env`, Gemini y el puerto 15432. El bundle acumula las tarjetas y cobertura previas desde la revisión `353b777`. Si ya instalaste las 15 migraciones, `db:migrate` solo las verificará. Si aún no instalaste las tarjetas, respalda primero tu base y `.env` siguiendo `docs/GUIA-WINDOWS-PLANES.md` antes de importar. No ejecutes seed ni recrees usuarios.

Para la vitrina estática: `npm run showcase:build`; publica solo el contenido de `apps/web/dist-showcase/`. También se entrega `NexoVet-vitrina-mascotas.zip` con el contenido en la raíz, sin API ni secretos. No se publicó automáticamente.

## Verificación de esta entrega

Compilación de vitrina y comprobación de catálogo correctas; TypeScript de la web y formato correctos. Pasaron las 13 pruebas de navegador de la vitrina (4 del fondo y 9 existentes). Además se revisó visualmente a 1440 y 390 píxeles, sin desbordes, con pausa al salir de pantalla y sin conexiones a Cloudinary por el fondo. Se conservan DM Sans y Manrope. No se repitieron las pruebas de base de datos, Docker/Caddy ni la suite del sistema integrado; no se probó Windows ni Safari/iOS. No se desplegó.
