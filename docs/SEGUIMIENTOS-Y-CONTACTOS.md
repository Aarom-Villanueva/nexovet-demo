# Seguimientos y contactos — bloque 6

Uso interno de una veterinaria con una sede. Las tareas y comunicaciones se guardan
en PostgreSQL; la demostración estática de la raíz sigue separada de esta aplicación.

## Qué puede hacer el equipo

| Operación                       | Administración / recepción | Veterinario                           |
| ------------------------------- | -------------------------- | ------------------------------------- |
| Ver tareas e indicadores        | Todo el equipo             | Solo tareas asignadas a su cuenta     |
| Crear seguimiento de cliente    | Sí                         | No                                    |
| Crear seguimiento de mascota    | Sí                         | Sí, asignado a sí mismo               |
| Asignar, editar o reprogramar   | Cualquier pendiente        | Solo sus pendientes, sin reasignarlos |
| Completar o cancelar            | Cualquier pendiente        | Solo sus pendientes                   |
| Consultar o registrar contactos | Sí                         | No                                    |

Las tareas pueden iniciarse en Seguimiento y en una ficha activa de cliente o mascota.
Una atención cerrada también ofrece programar un seguimiento: conserva el paciente
y no modifica la historia clínica. El vínculo de cliente y mascota de una tarea no
se cambia al editar. El responsable debe tener cuenta activa y acceso habilitado;
administración y recepción también pueden dejar una tarea sin asignar.

Cada tarea tiene título, indicaciones operativas, responsable y fecha/hora límite.
Las fechas se introducen en hora de Lima y se almacenan como `timestamptz`.
Los estados son pendiente, completado y cancelado. Solo se editan y finalizan
pendientes; para una gestión posterior se crea otra tarea. Completar guarda fecha
de cierre; cancelar no equivale a completar. Vencido se calcula al consultar,
no es un cuarto estado ni genera envíos.

La lista permite búsqueda literal por tarea, cliente o paciente, estado, responsable
y vencimiento: vencidos pendientes, día actual en Lima y próximas 168 horas. Ordena
por vencimiento e identificador, con paginación (20 por defecto, máximo 50). Los
indicadores corresponden a todas las tareas autorizadas del usuario, sin aplicar los
filtros de la lista. El resumen inicial también limita las tareas del veterinario
a las asignadas a su cuenta.

## Registro manual de contactos

Administración y recepción registran comunicaciones **ya realizadas**, con canal
(llamada, WhatsApp, correo o presencial), resultado, fecha/hora y nota opcional.
No se llama, no se envían mensajes ni se abren conversaciones desde este formulario.
No hay avisos automáticos, campañas, reserva pública ni integración con WhatsApp.

Se muestran el teléfono, correo y estado de autorización registrado del cliente.
La autorización no se concede al registrar una comunicación ni se exige para dejar
constancia de un hecho anterior. Antes de realizar nuevos contactos, el equipo debe
comprobar la autorización y el propósito correspondiente fuera de este formulario.
No se exponen estos datos ni las notas de contacto al veterinario.

Puede registrarse un contacto desde la ficha del cliente o vinculado a una tarea de
ese mismo cliente. También se admite registrar comunicaciones históricas de clientes
archivados. No se permiten fechas futuras salvo un margen de reloj de cinco minutos.
Los resultados son: contacto realizado, sin respuesta, coordinación reprogramada,
cliente declinó, dato incorrecto u otro. El formulario no preselecciona un resultado.

Solo con contacto realizado o coordinación reprogramada se ofrece la opción explícita
de completar la tarea pendiente. Registrar «sin respuesta» conserva la tarea.
«Coordinación reprogramada» es una descripción del resultado: no cambia por sí sola
la fecha límite de la tarea ni el horario de una cita.

El historial se consulta por cliente, tarea o desde la pestaña de contactos, con
fecha del hecho, integrante que lo registró, resultado y nota. Es un registro de
solo lectura: no hay rutas de edición o borrado; PostgreSQL bloquea `UPDATE` de
contactos. Un error se aclara con un nuevo registro. La cuenta técnica de base sigue
pudiendo borrar filas para mantenimiento y limpieza de fixtures, por lo que no se
presenta esta protección como almacenamiento inviolable.

## Concurrencia y reintentos

Las tareas tienen versión; las ediciones y cambios de estado bloquean la fila y
comprueban esa versión. Un conflicto devuelve `409 VERSION_CONFLICT`, conserva el
borrador en el navegador y permite cargar explícitamente la versión actual.

Cada alta de contacto incluye `requestId` UUID y una huella del contenido normalizado.
Un bloqueo transaccional y una restricción única evitan duplicados simultáneos.
Repetir la misma solicitud y actor devuelve el registro original (`201`, cabecera
`Idempotent-Replay: true`), incluso si esa primera solicitud ya completó la tarea.
Reutilizar el UUID con otro contenido o actor devuelve `409 REQUEST_CONFLICT`.
La clave y la huella no se devuelven en los listados.

Si se pierde la respuesta, el formulario conserva la solicitud y bloquea sus campos
para reintentar exactamente lo mismo. Esta protección del borrador dura mientras
el formulario permanezca abierto; no se guarda en localStorage. Si se cerró o recargó
tras una respuesta incierta, hay que revisar el historial antes de registrar otra vez.

Contacto, posible cierre y auditoría se confirman en una misma transacción. Si falla
la auditoría, se revierte todo. Las auditorías guardan actor, versión/estado y acción,
sin copiar notas ni datos de contacto del cliente. Las escrituras exigen sesión,
origen y CSRF; los permisos se verifican en la API, incluidas las URLs directas.

## Rutas y comprobaciones

- `GET /api/follow-ups/options`, `/targets`, `/stats`.
- `GET /api/follow-ups`: `q`, `status`, `period`, `assignee`, `clientId`, `petId`,
  `page`, `pageSize`. Identificadores UUID y filtros se validan.
- `GET /api/follow-ups/:id`, `POST /api/follow-ups`, `PUT /api/follow-ups/:id`.
- `POST /api/follow-ups/:id/status`: `{ version, status }`.
- `GET /api/contact-events`: `q` (cliente/título), `clientId`, `taskId`, `page`,
  `pageSize` (10 por defecto, máximo 50).
- `POST /api/contact-events`: `ContactInput` definido en el paquete compartido;
  vincular una tarea requiere su versión. El servidor determina el actor.

La migración `005_follow_ups.sql` amplía las tablas existentes sin cambiar la semilla
ni las migraciones previas. `npm run check` comprueba tipos, compilación y pruebas de
API/PostgreSQL: permisos por asignación, asociaciones activas, validación, fechas Lima,
filtros, concurrencia, estados finales, idempotencia, inmutabilidad de contactos,
CSRF y reversión conjunta por fallo de auditoría. `npm run test:e2e` verifica los
formularios, entrada desde fichas/consulta, historial, persistencia, móvil, conflicto
de borrador y reintento con una respuesta perdida después del guardado real.

Se limpian únicamente contactos, tareas y pacientes creados por las pruebas, y se
conserva su auditoría. No se modifica el contenido de las tareas de demostración.
Quedan pendientes inventario/compras, ventas, reportes y despliegue operativo con
sus comprobaciones del bloque 10.
