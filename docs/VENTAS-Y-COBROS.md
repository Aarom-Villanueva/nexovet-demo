# Ventas y cobros — bloque 8

Uso interno de una sede y un almacén. Administración y recepción pueden preparar,
consultar, editar y cancelar borradores, y confirmar ventas con cobros completos.
El veterinario no accede a ventas, pagos ni búsquedas comerciales, tampoco por API.
Las escrituras requieren sesión vigente, origen permitido y token CSRF.

## Preparación y precios

Ventas y cobros permite combinar de uno a cuarenta productos/servicios activos
sin repetir el mismo concepto. El cliente es opcional; si se asocia, debe estar
activo. Los productos aceptan cantidades positivas de hasta tres decimales; los
servicios, cantidades enteras de 1 a 1000 (se admiten representaciones como `1.000`).
La nota operativa es opcional y tiene máximo mil caracteres.

Un borrador no reserva ni descuenta existencias. Puede prepararse aunque no haya
saldo suficiente, pero no se confirmará hasta disponer de todo lo vendido.

El servidor toma precios y descripciones del catálogo al crear o editar. No acepta
precios libres, descuentos ni descripciones impuestas por el navegador. Al editar
se actualizan los precios de todas las líneas según el catálogo vigente; el
formulario avisa y muestra el total guardado antes de confirmar. La confirmación
conserva esos precios y conceptos, aunque el catálogo cambie después del guardado.
Se revalidan actividad y saldo, sin cambiar silenciosamente el precio acordado.
Los borradores de demostración anteriores también conservan el SKU al confirmarse.
Los SKU/descripciones se conservan en las líneas; al confirmar también se conserva
el nombre del cliente asociado. Las identidades siguen referenciadas por UUID.

PostgreSQL calcula `round(cantidad * precio, 2)` por línea y suma los importes. La
API transporta cadenas decimales y compara centavos exactos; la interfaz también
formatea los importes sin convertirlos a flotantes. El máximo por venta es
S/ 9,999,999,999.99. Las cantidades y el total se validan antes de escribir líneas.

El número `V-0000000001` se asigna mediante secuencia y puede tener saltos. Es un
registro interno; no representa una boleta/factura electrónica ni conexión con
SUNAT. No calcula impuestos, descuentos ni recargos adicionales. El mantenimiento
de servicios y sus precios se realiza en la configuración del [bloque 9](REPORTES-Y-ADMINISTRACION.md).

## Registro de cobros y confirmación

Desde el borrador, Registrar cobros y confirmar presenta el total, cliente y medios
de pago. El integrante elige explícitamente efectivo, tarjeta o transferencia.
Se admiten hasta cinco pagos y sus importes positivos deben sumar exactamente el
total. Para tarjeta/transferencia se exige una referencia de operación de al menos
tres caracteres; no se solicitan número de tarjeta, CVV ni credenciales bancarias.
La referencia tiene máximo cien caracteres.

Se registran **pagos ya recibidos**. La aplicación no realiza cargos bancarios,
transferencias, validación de vouchers ni verificación de fondos externos.
El efectivo se registra por su importe aplicado a la venta, sin vuelto. No hay
saldos a crédito ni cobros posteriores. Una venta con total cero se confirma con
lista de pagos vacía; si contiene productos, igualmente se descuenta su cantidad.

Al confirmar, la API bloquea la venta y los productos en orden consistente, verifica
versión, cliente/conceptos activos y la suma exacta de cobros. Genera una salida por
línea de producto, guarda los pagos con el integrante actual y la hora del servidor,
marca la venta Confirmada y añade auditoría en una misma transacción. Los servicios
no generan movimientos de stock ni modifican citas o atenciones clínicas.

Un saldo insuficiente, importe distinto o fallo de auditoría revierte todo: venta
en borrador, sin cobros ni salidas parciales. El bloqueo por producto y el trigger
de existencias evitan que dos ventas consuman la misma última unidad.

Borrador puede pasar a Confirmada o Cancelada; ambos son estados finales. Cancelar
un borrador no registra cobros ni modifica el stock. No se editan, reabren, eliminan
ni anulan ventas confirmadas. La base protege cabeceras finalizadas y sus líneas,
y rechaza UPDATE/DELETE de pagos. Una comprobación diferida al confirmar exige
líneas, total pagado exacto y una salida con la cantidad correcta por producto.

El detalle confirmado muestra cliente, conceptos, total, pagos, referencias,
responsable y fecha. El historial de inventario identifica también el número de
venta que originó la salida. Desde una ficha de cliente, Ver ventas abre la lista
filtrada por ese cliente, incluidas operaciones históricas de clientes archivados.
La lista permite buscar por número/nombre de cliente, filtrar estado y paginar.
No incluye aún cortes de caja ni reportes por fecha o medio de pago.

## Concurrencia y respuestas inciertas

Cada borrador tiene versión. Ediciones, cancelaciones y confirmaciones comprueban
la versión leída. Un conflicto devuelve `409 VERSION_CONFLICT`, conserva los datos
del formulario y permite cargar explícitamente el registro actual. Si otro usuario
ya finalizó la venta, la recarga muestra ese documento de solo lectura.

Las altas tienen UUID de solicitud y huella. Repetir la misma alta y actor devuelve
el mismo documento (`201`, `Idempotent-Replay: true`), posiblemente con su estado
actual si fue editado después. Un UUID reutilizado con otro contenido o actor se
rechaza. No se crea otra venta ante un reintento concurrente idéntico.

La confirmación usa otro UUID, versión y huella de la venta/cobros normalizados.
La misma confirmación y actor devuelven el documento confirmado (`200`, cabecera
`Idempotent-Replay: true`) sin repetir pagos, stock ni auditoría, incluso después
del cambio de versión. Otros importes, referencias, actor o venta con la misma
clave se rechazan. Un nuevo UUID tampoco vuelve a confirmar una venta finalizada.

Si se pierde una respuesta de alta/confirmación, el formulario conserva la solicitud,
bloquea sus campos y permite reintentar el mismo contenido. Ese borrador vive solo
en el formulario abierto, no en localStorage. Si se cerró o recargó después de una
respuesta incierta, revisar la lista y el documento antes de crear otra operación.
Las referencias de pago y datos del cliente no se copian a la auditoría; esta guarda
actor, acción, versión, total y cantidad de líneas/pagos.

## Contratos

- `GET /api/sales/items`: `kind` (`product` o `service`), `q` (mínimo 2 caracteres).
  Devuelve hasta 20 conceptos activos con precio, SKU y saldo para productos.
- `GET /api/sales/clients`: `q` (mínimo 2 caracteres); hasta 20 clientes activos,
  con ID, nombre y documento opcional para distinguir homónimos.
- `GET /api/sales`: `q`, `status` (`all`, `draft`, `confirmed`, `cancelled`),
  `clientId` opcional, `page`, `pageSize` (20 por defecto, máximo 50).
- `GET /api/sales/:id`: cabecera, líneas conservadas y pagos de solo lectura.
- `POST /api/sales`: `SaleInput` más `requestId` UUID.
- `PUT /api/sales/:id`: `SaleInput` más `version`.
- `POST /api/sales/:id/cancel`: `{ version }`.
- `POST /api/sales/:id/confirm`: `SaleConfirmInput` con `requestId`, `version`,
  `payments` (`method`, `amount`, `reference` como texto o `null`).

Los tipos están en el paquete compartido. Se rechazan campos desconocidos, actores,
fechas de cobro y precios impuestos desde el cliente. Las búsquedas son parametrizadas
y tratan `%` y `_` literalmente. Conteo y página comparten una instantánea de lectura.
La migración `007_sales_payments.sql` amplía las tablas existentes sin modificar
migraciones aplicadas ni documentos o saldos de demostración.

## Validación y límites

`npm run check` ejecuta tipos, compilación y pruebas de API/PostgreSQL: precios y
redondeo, ventas mixtas, servicios enteros, total cero, clientes activos, edición
concurrente, roles/CSRF, importes/referencias, idempotencia, última unidad, cancelación
contra confirmación, archivo, inmutabilidad, integridad diferida y reversión por
auditoría fallida. `npm run test:e2e` recorre ventas mixtas con cliente, pagos
combinados, persistencia, historial del cliente, stock insuficiente/corrección,
importes distintos, móvil, respuesta perdida al crear/confirmar, conflicto de
edición, cancelación, permisos, lectura fallida y total cero, además de bloques previos.

Los fixtures conservan ventas/pagos y el libro inmutable, compensan el saldo de sus
productos propios y archivan las fichas al terminar. Las pruebas clínicas conservan
su profesional aislado por ejecución. No se modifican saldos ni fichas de clientes
de la semilla; las ventas sintéticas pueden referenciar un cliente de demostración.
Los clientes temporales de pruebas solo se usan en borradores que se desvinculan
antes de limpiar sus fichas. No ejecutar estas pruebas en datos reales.

Fuera de alcance: cobros bancarios, crédito, vuelto, devoluciones/reembolsos,
anulación fiscal, notas de crédito, SUNAT, emisión de PDF/ticket imprimible,
descuentos, impuestos, cierre/arqueo de caja, conciliación bancaria y varias sedes.
Los reportes/configuración se implementan en el [bloque 9](REPORTES-Y-ADMINISTRACION.md); el despliegue operativo,
respaldos y comprobaciones para datos reales, al 10.
