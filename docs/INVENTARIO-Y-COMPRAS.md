# Inventario, proveedores y compras — bloque 7

Aplicación interna para una sede y un almacén, en PEN y hora de Lima. El catálogo,
los proveedores, borradores, recepciones y movimientos se guardan en PostgreSQL.
La demo estática de la raíz conserva su propio comportamiento simulado.

## Permisos y operación

| Operación                                  | Administración | Recepción | Veterinario |
| ------------------------------------------ | -------------- | --------- | ----------- |
| Consultar catálogo, saldo y movimientos    | Sí             | Sí        | No          |
| Crear/editar/archivar productos            | Sí             | No        | No          |
| Registrar ajustes de existencias           | Sí             | No        | No          |
| Consultar y mantener proveedores           | Sí             | Sí        | No          |
| Crear/editar/cancelar borradores de compra | Sí             | Sí        | No          |
| Recibir una compra completa                | Sí             | Sí        | No          |

Los permisos se aplican en la API, incluidas consultas por identificador y URL
directa. Las escrituras requieren sesión vigente, origen permitido y token CSRF.

**Inventario** contiene las pestañas Productos y Proveedores. Los productos tienen
SKU único sin distinguir mayúsculas, nombre, categoría opcional, precio de venta,
stock mínimo y estado activo/archivado. Las cuatro categorías iniciales son de
consulta; su mantenimiento se incorpora en Administración del [bloque 9](REPORTES-Y-ADMINISTRACION.md). Los productos nuevos
parten de saldo cero. No hay un campo para sobrescribir directamente el stock.

Se busca por nombre o SKU, se filtra por actividad, categoría y existencias, y se
pagina con orden estable. Stock bajo significa saldo estrictamente menor al mínimo;
sin existencias significa saldo cero. Los indicadores consideran solo productos
activos y no los filtros de la lista. La ficha conserva el historial paginado de
movimientos, motivo, fecha, integrante y número de compra cuando corresponde.

Los proveedores tienen nombre, RUC opcional de once dígitos, correo, teléfono y
dirección opcionales. El RUC no se consulta ni certifica ante SUNAT. Se busca por
nombre, RUC o contacto. El archivo de productos y proveedores es reversible y
conserva las relaciones y movimientos anteriores. Un producto archivado conserva
su saldo; debe reactivarse para nuevas recepciones o ajustes.

Las fichas usan versiones para evitar sobrescribir ediciones simultáneas. Un
conflicto devuelve `409 VERSION_CONFLICT`: la interfaz conserva el borrador y
ofrece cargar explícitamente la versión actual.

## Del borrador a la recepción

1. Seleccionar un proveedor activo y entre uno y cuarenta productos activos distintos.
2. Ingresar cantidades positivas (hasta tres decimales) y costo por unidad (hasta
   dos decimales, con punto). Una nota opcional conserva detalles operativos.
3. Guardar el borrador. Se asigna un número `OC-00000001` mediante secuencia; pueden
   existir saltos. El número no es una factura ni implica pago al proveedor.
4. Revisar cantidades, costos y total guardados. Se puede editar el borrador o
   cancelarlo. Ninguna de estas acciones mueve existencias.
5. Cuando llegue la mercadería, abrir Recibir compra y confirmar la recepción
   completa de las líneas mostradas. Se comprueba nuevamente que proveedor y
   productos estén activos.

La recepción bloquea el documento y los productos en orden consistente, registra
una entrada por línea, fecha/integrante de recepción, estado Recibida y auditoría
en una sola transacción. Si falla cualquier parte, no queda una recepción parcial.
El saldo se deriva de `stock_movements`; no hay un segundo contador editable.
Una recepción concurrente o repetida de la misma versión devuelve el documento
recibido sin volver a ingresar unidades (`Idempotent-Replay: true`). Una versión
obsoleta que no corresponde a esa recepción genera conflicto.

Recibidas y Canceladas son estados finales. No se editan, borran, vuelven a borrador
ni cancelan documentos recibidos. PostgreSQL protege cabeceras finalizadas y sus
líneas contra cambios; el libro de stock continúa protegido contra UPDATE/DELETE.
La compra recibida conserva el nombre del proveedor y los nombres/SKU de los
productos al recibir, aunque después cambien en sus fichas. Los costos y cantidades
ya guardados se conservan. Las identidades del personal están referenciadas por UUID.

Cada línea calcula `round(cantidad * costo, 2)` en PostgreSQL y el total suma esas
líneas. La API utiliza cadenas decimales, valida la precisión y rechaza importes por
línea fuera de `numeric(16,2)`. La interfaz formatea dinero conservando los centavos
sin convertir los totales a flotantes. Los costos de compra no modifican el precio
de venta. El total no calcula impuestos, gastos de envío, pagos ni deuda contable.

## Ajustes y reintentos

Administración puede registrar una variación positiva o negativa con motivo de
al menos cinco caracteres. El saldo mostrado al abrir es informativo: se aplica
la variación al saldo disponible al guardar. PostgreSQL serializa movimientos por
producto y rechaza saldos negativos, incluso con salidas simultáneas. La auditoría
y el movimiento se confirman o revierten juntos. Una equivocación se corrige con
un movimiento compensatorio, conservando los registros originales. Un ajuste no
es una devolución al proveedor ni modifica los costos o el estado de una compra.

Altas de compras y ajustes tienen UUID de solicitud, huella y bloqueo transaccional.
La misma solicitud/actor devuelve el registro previo; otro contenido con el mismo
identificador se rechaza. En compras, el reintento puede devolver el documento con
su estado actual si ya fue editado o recibido. La recepción se identifica mediante
el documento y la versión de su borrador; no genera una segunda entrada.

Si una respuesta de alta/ajuste se pierde, el formulario bloquea sus campos y permite
reintentar la solicitud original. Los borradores solo viven en el formulario abierto;
si se cierra o recarga después de una respuesta incierta, revisar lista e historial
antes de registrar otra operación. Las ediciones no crean otro documento y exigen
versión. Las fichas de producto/proveedor no implementan UUID de alta: si se pierde
su respuesta, comprobar la lista antes de repetir el registro.

## Contratos

- `GET /api/inventory/categories`, `GET /api/inventory/stats`.
- `GET /api/products`: `q`, `status` (`active`, `archived`, `all`), `stock`
  (`all`, `low`, `empty`), `categoryId`, `page`, `pageSize`.
- `GET /api/products/:id`, `POST /api/products`, `PUT /api/products/:id`.
- `GET /api/products/:id/movements`: `page`, `pageSize`.
- `POST /api/products/:id/adjustments`: `requestId`, `quantity` firmada, `reason`.
- `GET /api/suppliers`: `q`, `status`, `page`, `pageSize`.
- `GET /api/suppliers/:id`, `POST /api/suppliers`, `PUT /api/suppliers/:id`.
- `GET /api/purchases`: `q` (número/proveedor), `status`
  (`all`, `draft`, `received`, `cancelled`), `page`, `pageSize`.
- `GET /api/purchases/:id`, `POST /api/purchases`, `PUT /api/purchases/:id`.
- `POST /api/purchases/:id/receive`, `POST /api/purchases/:id/cancel`: `{ version }`.

Los listados tienen 20 filas por defecto y máximo 50, búsqueda parametrizada que
trata `%` y `_` literalmente, y conteo/lista en una misma instantánea de lectura.
Los esquemas compartidos definen fichas y documentos; las altas de compras añaden
`requestId`, las ediciones añaden `version`. La API rechaza campos desconocidos,
saldos impuestos, actores enviados por el cliente e identificadores inválidos.

La antigua ruta de muestra `GET /api/products` ahora devuelve una página de fichas
operativas, no un array de doce productos del resumen. El resumen mantiene la forma de su
contrato anterior y muestra solo productos activos. La migración `006_inventory_purchases.sql` amplía las tablas
sin cambiar migraciones aplicadas ni saldos de la semilla.

## Verificación y límites

`npm run check` verifica tipos, compilación y pruebas API/PostgreSQL: roles/CSRF,
precios/cantidades exactos y límites, archivo, versiones, filtros/paginación,
idempotencia, recepciones y salidas simultáneas, nombres conservados, restricciones
de documentos finales y reversión por fallo de auditoría. `npm run test:e2e` recorre
catálogo/ajuste, proveedores, borrador/edición/recepción, cancelación sin stock,
respuesta perdida al crear y recibir, conflicto de versión, importes grandes,
lectura fallida y móvil, además de los módulos anteriores.

Las pruebas usan productos, proveedores y documentos sintéticos propios. Conservan
compras y libro inmutable, compensan sus saldos y archivan sus fichas al terminar;
no borran movimientos ni alteran existencias de productos de demostración. La
verificación de la semilla identifica sus 320 UUID estables, sin exigir que no
existan fixtures históricos archivados. No ejecutar pruebas en una base real.

Fuera de alcance: recepciones parciales, devoluciones documentadas, lotes y caducidad,
varios almacenes, importación masiva, valorización/contabilidad, pagos al proveedor,
impuestos y facturación SUNAT. No hay integración ni comunicación con proveedores.
Las ventas y sus salidas/cobros se implementan en el [bloque 8](VENTAS-Y-COBROS.md); reportes y configuración
al 9, y despliegue, respaldos y operación con datos reales al 10. La API implementa
las transiciones operativas; SQL directo no constituye un flujo autorizado de compra.
