# Revisión de NexoVet: videos, preloader y Excel

Fecha: 15/11/2026, hora de Lima. Se revisó el bundle
`nexovet-videos-excel.bundle`, rama `feat/public-media-legal`, commit `2f1b484`,
sobre la base anterior `353b777`. La entrega corregida está en
`fix/videos-excel-validation` dentro del nuevo bundle.

No se cambió la computadora de Aarom, no se subieron videos a Cloudinary y no
se desplegó el producto. Las modificaciones y pruebas se hicieron en una copia
separada. No se añadieron ni modificaron migraciones: siguen siendo **13**.

## Correcciones de esta revisión

1. **Arranque en una instalación limpia.** La nueva configuración importa las
   constantes legales del paquete compartido. Sin su `dist`, `db:migrate`
   fallaba antes de ejecutar una migración. El comando raíz compila ahora ese
   paquete primero. Se comprobó con una instalación sin compilación anterior.
2. **Advertencia de precisión al imprimir Excel.** La nota de importes mayores
   a 15 cifras se añadía fuera del área de impresión. Se amplió el área para que
   también aparezca al imprimir o exportar a PDF. Se verificó en el XML del libro
   mediante un lector independiente.
3. **Dependencia con aviso conocido.** Se conserva ExcelJS 4.4.0 y se fija
   `uuid` 11.1.1 mediante `overrides` y lockfile. Esa versión admite CommonJS y
   la función `v4` que usa ExcelJS. Se comprobaron importación, escritura,
   reapertura y formato condicional que ejercita la llamada. La auditoría npm
   y la construcción Docker no reportaron avisos conocidos. ExcelJS sigue
   teniendo dependencias antiguas: cero avisos no equivale a auditoría integral.
4. **URL de Cloudinary al construir Docker.** La variable pública
   `VITE_MEDIA_REMOTE` no llegaba al build; `.env.local` está excluido del
   contexto de Docker. Se añadieron el argumento y su transmisión desde
   Compose, y una prueba de reproducción desde la imagen construida con una
   URL de ejemplo. Cambiar el entorno de un contenedor ya construido no cambia
   los enlaces: hay que reconstruir la web.
5. **Origen de los videos.** Se rechazan puertos HTTPS no predeterminados en las
   URL externas, además de protocolos, credenciales y hosts no permitidos.
6. **Comprobaciones de operación.** La prueba de Caddy utiliza ahora un MP4 H.264
   sintético válido, comprueba reproducción en Chromium y la URL recibida al
   construir. El simulacro completo comprueba también descarga XLSX por HTTPS,
   cifras, permisos, aislamiento y exportación después de restaurar.

## Resultados

| Comprobación                            | Resultado                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Formato, tipos y compilación            | Aprobados                                                                                                             |
| Pruebas unitarias                       | 22 aprobadas                                                                                                          |
| Pruebas con PostgreSQL 17.11            | 149 aprobadas                                                                                                         |
| Navegador, escritorio y móvil           | 67 aprobadas                                                                                                          |
| Preparador de configuración local       | 5 aprobadas                                                                                                           |
| Total de esas suites                    | **243 aprobadas, sin omisiones**                                                                                      |
| Actualización desde la base anterior    | 39 tablas conservadas, con conteos y huellas iguales                                                                  |
| Esquema                                 | 13 migraciones, sin alteraciones                                                                                      |
| Imágenes Docker API/web                 | Construidas; auditoría de la construcción sin avisos conocidos                                                        |
| Argumento de Cloudinary por Compose     | Verificado sin imprimir configuración privada                                                                         |
| Caddy en dos dominios                   | Aprobado: páginas legales, MP4, Range 206/416, archivos ausentes 404, API privada bloqueada, errores y mantenimiento  |
| Reproducción sobre Caddy                | Aprobada en Chromium con clip sintético y URL Cloudinary interceptada, sin solicitud antes del clic                   |
| Simulacro completo Docker/PostgreSQL 17 | Aprobado: dos clínicas aisladas, CLI con API apagada, operaciones, XLSX por HTTPS, respaldo, restauración y reingreso |
| Lectura independiente XLSX              | Aprobada con openpyxl 3.1.5                                                                                           |

La lectura independiente verificó cinco hojas, títulos, estilos, importes como
números cuando corresponde, texto exacto para un importe de 29 cifras, ausencia
de fórmulas ejecutables, filtros, encabezados inmovilizados y aviso dentro del
área de impresión. No se ejecutó Microsoft Excel ni LibreOffice: comprobar la
apertura e impresión en Excel de Windows sigue pendiente en la computadora.

Las primeras ejecuciones del simulacro se detuvieron por falta de espacio del
entorno al crear un contenedor adicional. Se retiraron cachés de dependencias y
un navegador completo que no usan las pruebas headless; se conservaron código,
respaldos y la base original. La prueba de recuperación pasó a detener y retirar
solo el contenedor de su API antes de ejecutar el contenedor de herramientas:
comprueba ahora la recuperación con la API realmente apagada, manteniendo las
credenciales del propietario fuera del proceso de la API. Antes de cambiar a la
base restaurada también pausa sus procesos, conservando los volúmenes. La
ejecución completa posterior terminó sin fallos; el resultado figura arriba.

## Qué incluye y qué no incluye el bundle

Incluye el nuevo diseño, perro/gato SVG/CSS, reproductores, portadas reales
incluidas por Claude, subtítulos VTT, páginas legales en borrador y XLSX.

**No incluye los siete MP4 finales ni las nueve grabaciones originales.** Siguen
en `C:\proyectos\nexovet\editados` y en la carpeta de originales de Windows.
Los ensayos multimedia utilizaron el clip sintético de la suite. No se volvieron
a revisar cortes, audio ni coincidencia de subtítulos contra los MP4 reales.

No hay URL definitivas de Cloudinary en esta revisión. La URL de ejemplo de las
pruebas se intercepta: no se descarga un recurso ajeno ni se considera prueba de
la cuenta real, cuotas, transferencia o cookies del CDN. Esa comprobación debe
hacerse con los enlaces definitivos antes de publicar los textos legales.

No se hicieron consultas reales a Gemini ni se modificó la conexión que Aarom
ya configuró en Windows. Las pruebas de IA simulan el proveedor de forma
controlada. El registro autónomo y la aprobación legal no se activaron.

## Instalación y siguiente paso

Seguir `GUIA-WINDOWS-VIDEOS-EXCEL.md`, comenzando por el respaldo. Conserva el
puerto **15432**, las contraseñas, el operador, los registros del recorrido y la
configuración de Gemini. Usar **npm ci**; no regenerar usuarios ni sembrar de nuevo.
La revisión requiere el objeto `353b777`; la guía explica cómo importarlo si falta.

Primero copia los siete MP4 finales a `apps/web/public/media`, inicia la aplicación
y comprueba la presentación local. Luego sube solo los editados a Cloudinary y
configura sus URL públicas en `apps/web/.env.local` o en el manifiesto.

El archivo `reporte-ejemplo.xlsx` de la descarga contiene datos ficticios de esta
revisión para inspeccionar el formato. No contiene los resultados de tu PC.

Los borradores legales conservan sus avisos y datos pendientes. No marcarlos
como aprobados hasta completarlos y revisarlos. Las pruebas locales no validan
DNS, HTTPS públicos, configuración del servidor destino ni operación con clientes
reales.
