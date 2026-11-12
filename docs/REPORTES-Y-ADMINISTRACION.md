# Reportes, configuración y auditoría — bloque 9

Administración dispone de reportes operativos y cinco secciones de configuración:
Equipo, Negocio, Servicios, Categorías y Auditoría. Recepción y veterinarios no
acceden a estos endpoints, exportaciones ni pantallas por URL directa. Conservan
sus operaciones y permisos de los bloques anteriores.

## Fechas e indicadores

Reportes propone el primer día del mes hasta hoy, según America/Lima. Se permite
cualquier período válido desde 2000, con máximo 366 días inclusivos. El servidor
transforma las fechas en el intervalo `[00:00 del inicio, 00:00 del día posterior
al fin)`, en Lima. El día final completo se incluye; el siguiente no.

| Indicador                       | Qué se cuenta y qué fecha utiliza                                   |
| ------------------------------- | ------------------------------------------------------------------- |
| Ventas confirmadas              | Cantidad de documentos e importe de sus líneas, por `confirmed_at`  |
| Cobros registrados              | Cantidad e importe de pagos de ventas confirmadas, por `paid_at`    |
| Compras recibidas               | Documentos e importe de sus líneas, por `received_at`               |
| Citas                           | Citas cuya fecha de inicio está en el período, con su estado actual |
| Atenciones cerradas             | Consultas con `closed_at` en el período, sin exponer texto clínico  |
| Clientes y mascotas registrados | Altas por `created_at`, aunque después se archiven                  |
| Seguimientos                    | Tareas cuyo vencimiento cae en el período, con su estado actual     |
| Pendientes vencidos             | Entre esas tareas, pendientes cuyo plazo ya pasó al consultar       |
| Existencias actuales            | Productos activos y saldos actuales; no se filtran por el período   |

Una cita que cruza medianoche cuenta en el día en que comienza. Los seguimientos
no se presentan como completados en el período: se agrupan por vencimiento. Las
ventas y sus cobros pueden tener fechas diferentes. No se mezclan sus criterios.
Los importes no son utilidad, ganancia neta ni conciliación bancaria.

Cada reporte utiliza una instantánea de lectura de PostgreSQL. Ventas, líneas y
pagos se agregan por separado para evitar multiplicar importes al haber varias
líneas y medios de pago. Los totales se transportan como cadenas decimales exactas.
Las barras usan proporciones solo para dibujar; los importes mostrados y exportados
se conservan sin convertir a flotantes.

El gráfico de ventas diarias incluye días sin operaciones con cantidad/importe cero.
Elegir una barra muestra su fecha, importe y cantidad reales. También se muestran
cobros por medio, citas por estado y hasta diez conceptos con mayor importe vendido,
con cantidades y descripciones de las líneas guardadas en la venta.

El resumen inicial añade solo para administradores ventas confirmadas hoy, cobros
registrados hoy, compras recibidas hoy y stock bajo actual. Estas propiedades no se
incluyen en la respuesta para recepción o veterinarios. Los próximos seguimientos
del resumen consultan pendientes directamente, evitando que tareas ya finalizadas
ocupen el límite de resultados.

## Exportación CSV

Exportar CSV descarga un resumen del período mostrado: indicadores, serie diaria,
medios de pago, citas por estado, conceptos principales y fotografía actual del
inventario. Incluye negocio, fechas y momento de generación. No exporta notas
clínicas, datos de tarjeta, referencias de pagos ni credenciales.

El CSV se genera de nuevo al descargar: una operación registrada después de cargar
la pantalla puede aparecer en la exportación. El archivo identifica su propio
momento de generación. Usa UTF-8, comillas escapadas y protección de celdas que
podrían interpretarse como fórmulas de una hoja de cálculo. La descarga requiere
la misma sesión y rol administrador. No se envían archivos a otras personas.

## Equipo y accesos

Administración permite crear cuentas y cambiar nombre, rol, actividad, permiso de
ingreso y contraseña. Los roles siguen siendo administrador, recepción y veterinario;
no se incorporan permisos configurables por operación ni registro público.

Una cuenta nueva requiere nombre, correo único y contraseña de 12 a 128 caracteres.
La contraseña se procesa con scrypt; nunca se devuelve su valor ni hash en la API.
No se envía un correo al crear o editar. La entrega del acceso se gestiona fuera
de esta pantalla. Las cuentas existentes conservan su correo; no se reutilizan
identidades cambiando el email de otro integrante.

Editar permite mantener la contraseña o establecer otra explícitamente. Una cuenta
sin contraseña necesita una antes de habilitar su ingreso. Archivar exige también
deshabilitar el ingreso; reactivar no lo habilita silenciosamente. No se borran
cuentas referenciadas en operaciones o auditoría.

Los cambios de rol, actividad, ingreso o contraseña revocan las sesiones y los
enlaces de recuperación anteriores, junto con la modificación y auditoría en una
transacción. Si falla la auditoría, también se revierten las revocaciones. Cambiar
solo el nombre no cierra las sesiones. La recuperación de contraseña incrementa
la versión de la cuenta para avisar de ediciones administrativas concurrentes.

No se permite que un administrador se quite su propio rol, actividad o ingreso.
Debe mantenerse al menos una cuenta administradora con acceso. Las modificaciones
de cuentas se serializan y revalidan al administrador y su sesión después de adquirir
el bloqueo; dos administradores no pueden deshabilitarse mutuamente usando solicitudes
que habían pasado antes el control inicial. Cambiar la contraseña propia sí es
posible y vuelve al login tras guardar.

Cambiar/desactivar el rol de un veterinario puede requerir revisar sus citas o tareas
asignadas. Los datos históricos se conservan; no se reasignan automáticamente.
Antes de repetir un alta cuya respuesta no se pudo confirmar, buscar su correo en
el listado. El correo único evita duplicar cuentas, pero esta alta no usa UUID de
solicitud como las ventas o contactos.

## Negocio, servicios y categorías

Negocio permite cambiar nombre y dirección. El nombre actualizado se refleja en la
navegación al guardar. Moneda PEN, zona America/Lima y modo de demostración son de
solo lectura; esta pantalla no cambia el entorno ni convierte una demo en producción.
No hay varias sedes, almacenes o clínicas dentro de la misma base.

Servicios permite alta, edición, archivo y reactivación: nombre único sin distinguir
mayúsculas, duración de 5 a 480 minutos y precio en soles con hasta dos decimales.
La agenda propone la duración actual al reservar; no cambia horarios ya guardados.
Ventas toma el precio al crear/editar un borrador, conservándolo al confirmar.
Archivar impide nuevas asignaciones de agenda/ventas y el inicio de una atención
con ese servicio hasta reactivarlo. Las operaciones históricas permanecen.

Categorías permite alta y cambio de nombre sin perder los productos asociados.
No hay eliminación ni archivo de categorías en esta versión; el selector de
inventario consulta los mismos registros.

Negocio, cuentas, servicios y categorías tienen versión. Un borrador obsoleto
recibe `409 VERSION_CONFLICT`: el formulario conserva su contenido y ofrece
cargar explícitamente la ficha actual. La recarga de una cuenta limpia cualquier
contraseña que se estaba preparando. Los cambios y la auditoría se confirman o
revierten juntos. Se exige sesión vigente, rol administrador, origen y CSRF.

## Auditoría de solo lectura

Permite filtrar por fechas, persona/acción/identificador, acción exacta y tipo de
registro. Ver historial limita la consulta al mismo UUID/tipo. La lista es paginada
y ordena por fecha e identificador descendentes. Los identificadores bigint se
transportan como texto para no perder precisión.

Se muestran instante, integrante (o Sistema), acción, tipo, UUID y un resumen
controlado: versiones, estados, rol, indicadores de acceso, cantidades, totales y
nombres permitidos de campos. No se devuelve el objeto `metadata` original. Se
excluyen notas, correos, tokens, hashes, contraseñas y referencias bancarias. El
nombre visible del integrante es el actual; su identidad histórica se conserva
mediante UUID.

No hay rutas para modificar o borrar eventos, ni botones de deshacer operaciones.
La inmutabilidad de PostgreSQL existente sigue protegiendo el libro. La auditoría
no sustituye un respaldo, monitor externo, contabilidad ni registro de cada lectura.
Las opciones de acciones/tipos muestran hasta 200 valores distintos; la búsqueda
de texto y filtros exactos de API siguen disponibles.

## Contratos y pruebas

- `GET /api/reports/options`, `/api/reports/operations`, `/api/reports/operations.csv`.
  El reporte acepta `from` y `to`; omitirlos usa el mes actual de Lima.
- `GET/PUT /api/admin/business` (edición de nombre/dirección con `version`).
- `GET/POST /api/admin/users`, `/services`, `/categories`.
- `GET/PUT /api/admin/users/:id`, `/services/:id`, `/categories/:id`.
- Listados: `q`, `page`, `pageSize` (20 por defecto, máximo 50); usuarios/servicios
  admiten `status` (`active`, `archived`, `all`).
- `GET /api/admin/audit/options`, `/api/admin/audit`: `from`, `to`, `q`, `action`,
  `entityType`, `actorId`, `entityId`, `page`, `pageSize`.

Los tipos están en el paquete compartido. Se rechazan campos desconocidos,
identificadores y períodos inválidos. `008_reports_administration.sql` añade
versiones, fechas, índices y unicidad de nombres. No modifica migraciones anteriores
ni crea una segunda fuente de importes o existencias.

Las pruebas verifican fechas de Lima y límites inclusivos/exclusivos, totales con
varias líneas/pagos, actividad y fotografía actual, CSV con fórmulas neutralizadas,
roles/CSRF, versiones, unicidad, contraseñas y sesiones, protección del administrador,
auditoría sin datos privados y reversión por auditoría fallida. El navegador recorre
exportación real, gráfico, mantenimiento, cuentas con otra sesión abierta, móvil,
conflictos, historial y fallos de lectura/exportación, además de bloques anteriores.
Los fixtures financieros se conservan con sus saldos compensados y fichas archivadas;
las pruebas de negocio restauran nombre/dirección conservando versiones y auditoría.
Solo se usan bases y negocios sintéticos; no ejecutar pruebas sobre datos reales.

Quedan fuera presupuestos, predicción de ingresos, rentabilidad, contabilidad,
conciliación bancaria, cierres de caja, SUNAT, gestión de varios negocios, adjuntos
y permisos personalizados. El [bloque 10](DESPLIEGUE-Y-RESPALDOS.md) añade respaldo/restauración,
contenedores y comprobaciones de operación completa.
