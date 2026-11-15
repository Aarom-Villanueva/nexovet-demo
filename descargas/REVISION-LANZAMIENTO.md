# Revisión de lanzamiento comercial de NexoVet

Revisión del 15/11/2026, sobre el bundle de Claude: commit 0fe28d6, que requiere
el antecedente a056a26. Se conservan las revisiones anteriores. El trabajo se
hizo en una copia aislada de Linux; no se modificó la computadora de Aarom,
no se cambió main ni se desplegó ningún sitio.

## Resultado

La vitrina estática funciona sin API, sesión, formularios o enlaces de ingreso.
Muestra el precio previsto de S/129 mensuales, 100 análisis con IA, los siete
videos y el crédito a Aarom Villanueva. El sistema privado conserva su página
Mi plan y pagos, exclusiva para administradores. Los cobros están desactivados
por defecto. Los documentos legales siguen como borradores en el sistema,
excluidos de la vitrina; el registro autónomo sigue apagado.

No se añadieron dependencias ni otra migración sobre la 014 recibida.

## Correcciones verificadas

1. **Resultado incierto:** después de enviar un cobro sin recibir respuesta,
   el código permitía otro intento tras 30 minutos. Ahora no se libera por
   tiempo ni por caducidad, tampoco permite cancelar o rechazarlo a ciegas.
   Requiere conciliación. Una solicitud que nunca envió un cobro sí puede caducar.
2. **Solicitud caducada:** se podía iniciar el cargo directamente por API sin
   refrescar primero el estado. Ahora se rechaza antes de contactar al proveedor.
3. **Importe final:** una configuración podía anunciar S/129 y habilitar una
   renovación por otro monto. La renovación comercial se bloquea si difieren.
4. **Respuesta contradictoria:** un rechazo o una autorización sin captura
   no se considera pagado por contener también una señal de éxito.
5. **Conciliación:** una solicitud manual no se resuelve como cargo en línea;
   un segundo cargo distinto para una solicitud pagada se marca para revisión.
   Se homogeneizó el orden de bloqueo de solicitud y suscripción.
6. **Logs:** al activar registros de acceso del proxy, el token del webhook
   quedaba escrito. El Caddyfile ahora lo filtra en el logger global, incluidos
   errores. La API ya omite la query. Otros proxies y el alojamiento requieren
   su propia revisión y rotación si el token se expone.
7. **Pruebas:** se separaron las carpetas de evidencias de las suites de
   vitrina y sistema para evitar que una borre los traces de la otra.

Se añadieron regresiones para los casos 1–4: fallaron en la entrega recibida y
pasaron después. El test del token en registros también falló antes y pasó
con el filtro. Los cambios de control no activan cobros reales.

## Pruebas ejecutadas

| Comprobación                                            | Resultado                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Unitarias                                               | 33/33                                                                                                                      |
| Base de datos, PostgreSQL 17                            | 168/168                                                                                                                    |
| Navegador del sistema                                   | 69 escenarios aprobados                                                                                                    |
| Vitrina sin API, escritorio y móvil                     | 8/8                                                                                                                        |
| Fondo opcional con archivos sintéticos                  | 2/2                                                                                                                        |
| Formato, tipos, build normal, showcase:build y catálogo | Aprobados                                                                                                                  |
| Videos desde Cloudinary real dentro de la vitrina       | 7/7; recorrido también en vista móvil                                                                                      |
| Migración sobre base con datos                          | De 13 a 14, conservando las 39 tablas previas                                                                              |
| Respaldo y restauración                                 | 41 tablas con iguales filas y huellas; solicitud y pago vinculado conservados; aislamiento de dos veterinarias restauradas |
| Imagen Docker de API                                    | Construida y ejecutada con PostgreSQL 17 y datos ficticios en configuración development                                    |
| Imagen Docker web/Caddy                                 | Construida y comprobada con dos dominios, Range, 404, mantenimiento/recuperación y token filtrado                          |

Son **280 escenarios de prueba únicos** en las cinco primeras filas. La
primera ejecución del navegador informó 68 aprobados y un fallo al escribir
traces por compartir carpeta con la suite del fondo. Se aisló la salida y
se repitió solo el caso afectado, que aprobó. No se cuenta el reintento dos veces.

La comprobación de migración comparó las columnas originales de 39 tablas:
37 quedaron idénticas. Los cambios esperados fueron el plan inicial sin precio
(asignado a S/129) y el registro de la migración. Las cuentas, contraseñas y
operaciones de esa base de prueba se conservaron. La posterior restauración
comparó las 41 tablas completas y verificó aislamiento usando el rol de la API.
Los respaldos privados no se incluyen en la entrega.

En Docker, la API confirmó readiness, consulta del plan por administrador,
rechazo para recepción y bloqueo de renovación/webhook en modo disabled.
Se comprobó que el Caddyfile incluido en la imagen coincide byte a byte con
el revisado. El script del proxy fuerza API caída y activa logs solo en su
fixture para comprobar los errores y la ocultación del token.
Por el límite de disco del entorno, API y web se ejecutaron por separado;
no se completó una prueba conjunta de toda la pila ni de producción con HTTPS.
Los certificados de sesión se montaron como secreto al construir; el nombre
del proxy del entorno se resolvió temporalmente, sin desactivar TLS.

La vitrina se probó además con las URL originales de Cloudinary, sin sustituir
sus bytes: no hubo solicitudes a /api ni a terceros antes de pulsar reproducir.
Los siete videos tuvieron controles, playsInline y subtítulos españoles.
El único host externo observado fue res.cloudinary.com. No se observaron
Set-Cookie, cookies guardadas (incluidas HttpOnly) ni cookies bloqueadas en ese
Chromium. Esa observación no reemplaza la revisión del dominio final o Safari.
Las capturas adjuntas muestran la página con movimiento reducido.

## Límites importantes antes de cobrar

- **Culqi real no se probó:** los cobros, webhooks y concurrencia usan un
  simulador local. Las pruebas que fuerzan configuración production lo hacen
  únicamente en laboratorio. No validan la afiliación ni la integración real.
- Falta verificar con llaves reales de prueba el mapeo de respuesta, 3-D Secure,
  rechazos, captura, conciliación tras un timeout y recuperación administrativa
  de resultados inciertos. No desbloquear un cobro incierto por el paso del tiempo.
- No hay débito automático. El flujo implementado es renovación solicitada.
- La política actual de vencimiento limita el asistente con IA; el resto del
  CRM conserva acceso. Definir una política comercial distinta requiere otro
  cambio explícito, protegiendo consulta/exportación de datos y renovación.
- Faltan identidad/RUC, precio final e impuestos, condiciones comerciales,
  proveedores reales, privacidad, soporte, correo, alojamiento y respaldos
  programados antes de ofrecer operación de producción.
- No se probaron Windows, Safari/iOS ni el dominio definitivo. El fondo real
  de Flow no fue entregado: se mantiene el respaldo y no se inventa un video.

## Entrega

El bundle de código usa la rama fix/commercial-launch-validation y requiere
353b777, incluyendo todas las revisiones posteriores necesarias. La rama
GitHub entrega-lanzamiento-revisado contiene archivos descargables, no el
código preparado para desplegar desde esa rama.

NexoVet-vitrina-lista.zip contiene solo apps/web/dist-showcase, con index.html
en la raíz. Está pensado para la raíz de un dominio; requiere conexión a
Cloudinary al reproducir videos. No incluye backend ni secretos.
Para actualizar el sistema, usar GUIA-WINDOWS-LANZAMIENTO.md y comenzar por el
respaldo. No ejecutar seed ni regenerar usuarios.
