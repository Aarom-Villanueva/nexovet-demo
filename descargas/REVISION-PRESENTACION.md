# Revisión: presentación definitiva de NexoVet

Revisión del 15 de noviembre de 2026, para la copia local de Aarom. El bundle
recibido apunta a `4f814d8` (`feat/public-video-polish`) y conserva `c8fdccd` en
su historia. Se trabajó en una copia separada: no se modificó su computadora,
no se desplegó la web y no se cambió `main`.

## Resultado y corrección

Se mantienen el diseño de Claude, los siete enlaces versionados de Cloudinary,
las portadas locales, los subtítulos y el perro/gato en SVG/CSS. No hace falta
subir videos nuevamente. La exportación Excel de la revisión anterior sigue
incluida. El clip de reportes conserva el botón CSV anterior, con una aclaración
junto al video: actualizar esa grabación es opcional.

Se reprodujo un fallo concreto: después de pausar el recorrido, pulsar otra
vez «Ver NexoVet en funcionamiento» no lo reanudaba. El control ahora reproduce
y enfoca el video existente; tras un error permite reintentar. Al cambiar a
un archivo local de respaldo se vuelve a enfocar el reproductor. Se añadió
la regresión al test de navegador existente: falló antes de la corrección y
pasó después. La comprobación de tipos y compilación valida la fuente opcional.

No se añadieron dependencias, cambios de API ni migraciones en esta revisión.
El sistema conserva sus 13 migraciones. No se resembró la base de Aarom ni se
regeneraron sus contraseñas.

## Pruebas de esta revisión

| Comprobación                                | Resultado                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unitarias de la aplicación                  | 22/22                                                                                                            |
| Navegador con API y PostgreSQL 17           | 68/68; incluye agenda, atenciones, compras, ventas, reportes, aislamiento por rol/veterinaria y páginas públicas |
| Tipos y compilación de producción           | Aprobados                                                                                                        |
| Descarga HTTPS de las siete URL originales  | 7/7, HTTP 200 y tipo video/mp4                                                                                   |
| Solicitudes parciales a Cloudinary          | 7/7, HTTP 206; primeros bytes coinciden con la descarga completa                                                 |
| Reproducción embebida desde Cloudinary real | 7/7 en Chromium escritorio; sin interceptar ni sustituir el origen remoto                                        |
| Vista móvil de Chromium, 390 px             | Recorrido principal reproducido; sin desborde horizontal                                                         |
| Subtítulos                                  | Los siete reproductores cargan pista española visible                                                            |

También se construyó la imagen web con el Dockerfile original, sin anular las
siete URL definitivas. Caddy pasó la prueba de dos dominios, rutas legales,
reproducción nativa, Range 206, 404, bloqueo de API privada, error 502 y modo
mantenimiento/recuperación 503.

Para construir en este entorno se montó su certificado CA como secreto y se
resolvió el nombre de su proxy con una entrada temporal de construcción. El
primer intento falló por DNS durante npm ci. No se desactivó TLS ni se cambió
el Dockerfile entregado. La prueba repetible de Caddy intercepta el video
externo con un clip sintético. Además se reprodujeron las siete URL reales,
sin interceptarlas, tanto desde Vite como desde la imagen final servida por
Caddy; el recorrido también funcionó en la vista móvil de ambos servidores.

Los videos entregados por Cloudinary son H.264, 1920 × 960, 30 fps y sin audio.
Duraciones comprobadas: presentación 83,3 s; agenda 33,5 s; atención 21,6 s;
inventario 31 s; ventas 32 s; reportes 26 s; asistente 30 s. Se inspeccionó un
fotograma representativo de cada clip. No se repitió la revisión exhaustiva
de 54 tramos de subtítulos que Claude afirma haber realizado, ni se compararon
los hashes con la carpeta Windows, a la que este entorno no accede.

Antes de pulsar reproducir no se creó ningún elemento video ni hubo solicitudes
a Cloudinary. Durante la prueba real el único host externo observado fue
`res.cloudinary.com`. Se revisaron las cabeceras de respuesta, las cookies de
contexto del navegador (incluidas HttpOnly) y los eventos de cookies bloqueadas:
no se observaron `Set-Cookie`, cookies guardadas ni cookies bloqueadas. Es una
observación de Chromium/localhost en esta fecha; no demuestra el comportamiento
futuro del proveedor ni sustituye la revisión del dominio publicado o Safari.

La suite automatizada usa videos sintéticos para probar errores de red y el
reproductor de forma repetible. Es distinta de la prueba adicional anterior,
que usa las siete URL reales sin interceptarlas.

## Alcance y pendientes

La suite de 149 pruebas de base de datos y el simulacro completo de restauración
y recuperación operacional ya fueron ejecutados sobre `c8fdccd`. No se repitieron
en esta ronda porque el cambio es de presentación y no modifica el backend ni
el esquema. No sumar esas pruebas previas a las 90 ejecutadas ahora.

Queda comprobar en la computadora de Aarom: actualización Windows, persistencia
de sus datos, autenticación con sus cuentas y Gemini real. La revisión utiliza
una base desechable y no consume su clave de Gemini. También quedan Safari/iOS,
HTTPS y dominio definitivo, correo real, respaldos programados y operación del
alojamiento antes de ofrecer el servicio en producción.

Los documentos legales siguen como **borradores**, con sus datos pendientes.
El registro autónomo continúa deshabilitado por defecto. No se aprobó ningún
texto legal, se cambiaron precios ni se habilitó cobro automático. La prueba
de registro de la suite usa configuración de laboratorio, correo local y
condiciones de ejemplo, no la configuración entregada al usuario.

## Instalación y contenido de la entrega

Usar `GUIA-WINDOWS-PRESENTACION.md`. La rama de código dentro del bundle es
`fix/video-polish-validation`. El bundle requiere el antecedente `353b777` e
incluye las correcciones previas a partir de él, por lo que no es necesario
instalar primero otro bundle de videos. La rama GitHub de entrega contiene
los archivos descargables; no es una rama de despliegue.

El ZIP contiene el bundle, esta revisión, la guía, capturas y evidencias públicas
de metadatos/reproducción. No incluye claves, archivos `.env`, volcados de base
de datos, contraseñas, MP4 ni grabaciones originales.
