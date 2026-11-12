# Agenda y atención veterinaria — bloque 5

La nueva aplicación permite completar el recorrido interno del primer hito:
cliente → mascota → cita → llegada → consulta → cierre → historia. La demo
estática de la raíz continúa independiente. No hay reserva pública para dueños,
mensajes enviados ni pagos en este bloque.

## Uso de la demo

1. Ingresar con recepción o administrador y abrir **Agenda**. Hay vista por día
   y semana (lunes a domingo), fecha, búsqueda de paciente/responsable, filtro
   de veterinario, estado y paginación. La fecha y los filtros quedan en la URL.
2. **Nueva cita**: buscar y seleccionar un paciente activo con responsable activo,
   escoger veterinario habilitado y servicio activo, fecha, hora y duración.
   La duración inicial proviene del servicio; se puede ajustar entre 5 y 480 minutos.
3. **Comprobar horario** informa si hay cruces. La consulta es orientativa: el cupo
   se confirma al guardar, no queda reservado por comprobarlo.
4. Abrir la cita: **Confirmar cita**, **Reprogramar cita**, **Registrar llegada**,
   **Cancelar cita** o **Marcar inasistencia**, según el estado y la hora.
5. Ingresar con la cuenta del veterinario asignado. Abrir la cita en espera e
   **Iniciar atención** (desde 30 minutos antes de la reserva). Registrar peso,
   temperatura, hallazgos, evaluación/diagnóstico y plan/indicaciones profesionales.
6. **Guardar atención** conserva un borrador. **Cerrar atención** exige guardar
   los cambios y completar hallazgos, evaluación y plan; pasa la cita a **Atendida**.
   Los signos medidos son opcionales; no se inventan ni interpretan resultados.
7. Reabrir la consulta para lectura desde la cita o **Historia clínica** en la ficha
   de la mascota. La historia, paginada, muestra las consultas de la más reciente
   a la más antigua y distingue borradores de atenciones cerradas.

La historia también puede abrirse desde una cita antes de iniciar la consulta.
Elegir para el demo la cuenta del mismo profesional que se asignó al programar.
Un administrador puede revisar, pero no sustituye al profesional que firma la atención.

## Permisos

| Operación                                                         | Administrador | Recepción | Veterinario      |
| ----------------------------------------------------------------- | ------------- | --------- | ---------------- |
| Consultar agenda y detalles operativos                            | Sí            | Sí        | Sí               |
| Programar, reprogramar, confirmar, llegada, cancelar/inasistencia | Sí            | Sí        | No               |
| Leer historia y notas formales de atención                        | Sí            | No        | Sí               |
| Iniciar y escribir/cerrar atención                                | No            | No        | Solo el asignado |

Los permisos se aplican en cada ruta de la API, junto con sesión, origen y CSRF
para escrituras. El ID del autor clínico proviene de la sesión, nunca del cuerpo.
La lectura clínica es de toda la misma sede para continuidad del cuidado; no se
limita a visitas propias. Recepción ve estado e identificador de la consulta,
sin hallazgos, diagnóstico, plan ni signos medidos de esa atención. Los catálogos
de agenda no incluyen correos, contraseñas ni precios de servicios.

## Horarios y estados

Horas de la interfaz en **America/Lima (UTC−5)**, guardadas como `timestamptz`.
Las citas que cruzan medianoche aparecen en ambos días del intervalo consultado.
La consulta por rango admite hasta 31 días. La aplicación valida fechas reales,
hora 00:00–23:59 y duración entera de 5–480 minutos. No reserva horarios pasados;
admite hasta cinco minutos de margen para registrar una llegada inmediata.

No se define un horario de apertura de la clínica, días feriados, salas ni turnos
de trabajo en este bloque. «Sin cruces» comprueba citas del profesional y paciente;
no certifica que la clínica esté abierta. Esas reglas deberán configurarse antes
de ofrecer reserva pública o un calendario con disponibilidad comercial.

| Estado actual                   | Cambios operativos permitidos                              |
| ------------------------------- | ---------------------------------------------------------- |
| Programada                      | Confirmada, En espera, Cancelada, No asistió               |
| Confirmada                      | En espera, Cancelada, No asistió                           |
| En espera                       | Cancelada o inicio de atención por el veterinario asignado |
| En consulta                     | Guardar borradores o cerrar como Atendida por el asignado  |
| Atendida, Cancelada, No asistió | Estados terminales; no se reabren                          |

No se marca inasistencia antes del inicio reservado. Reprogramar solo está permitido
en Programada/Confirmada, conserva el paciente y regresa a Programada para confirmar
el nuevo horario. Cambiar de paciente exige cancelar la cita errónea y reservar otra.
Una cita con atención no admite cambiar paciente, profesional, servicio ni horario.

Las restricciones de exclusión de PostgreSQL impiden que el mismo profesional
o paciente tenga dos intervalos superpuestos en Programada, Confirmada, En espera
o En consulta. Intervalos `[inicio,fin)` permiten citas consecutivas. Cancelar,
inasistencia o cierre libera el intervalo. Dos guardados concurrentes de un cupo
no pueden reservarlo dos veces; uno recibe 409 `SLOT_CONFLICT`.

## Atención y consistencia

Cada cita tiene como máximo una atención. El inicio bloquea la cita, comprueba
llegada y profesional, cambia a En consulta y crea el registro con el médico de
la sesión, en una sola transacción. Los borradores pueden guardar campos de texto
vacíos; el cierre requiere hallazgos, evaluación y plan con contenido.

Peso opcional: 0.001–9999.999 kg, hasta tres decimales. Temperatura opcional:
10–50 °C, hasta un decimal. Son límites de captura, no una interpretación clínica.
Cada texto admite hasta 4000 caracteres. Todos los datos y decisiones los introduce
el profesional; no hay diagnósticos, tratamientos ni dosis generados por la aplicación.

Una atención cerrada conserva sus notas: la API rechaza su edición y PostgreSQL
rechaza UPDATE sobre ese registro. No se publica DELETE, reapertura ni corrección
de documentos firmados. Una ampliación futura necesitará un flujo de adendas con
autor, motivo y trazabilidad, sin sobrescribir la consulta original. No se debe usar
SQL administrativo como mecanismo habitual de corrección clínica.

Citas y atenciones tienen versión. Guardar, reprogramar, cambiar estado, iniciar
o cerrar exige la versión leída. Una edición antigua recibe 409 `VERSION_CONFLICT`
y la interfaz conserva el borrador hasta cargar expresamente la versión actual.
El guardado/cierre y sus eventos de auditoría se confirman juntos; un fallo revierte
tanto la nota como el estado de la cita. Auditoría registra actor, entidad, operación,
versión y estados/campos, sin copiar el texto clínico. No es una firma digital legal.

## API

| Ruta                                 | Operación                                                   |
| ------------------------------------ | ----------------------------------------------------------- |
| `GET /api/agenda/options`            | Veterinarios habilitados, servicios y fecha/zona            |
| `GET /api/agenda/patients?q=…`       | Hasta 20 pacientes elegibles; búsqueda desde dos caracteres |
| `GET /api/appointments?from=…&to=…`  | Página de citas que intersectan el periodo                  |
| `GET /api/appointments/availability` | Cruces del intervalo elegido, sin reservar                  |
| `GET /api/appointments/:id`          | Detalle operativo                                           |
| `POST /api/appointments`             | Programar (201)                                             |
| `PUT /api/appointments/:id`          | Reprogramar con versión; sin `petId`                        |
| `POST /api/appointments/:id/status`  | Cambio operativo con versión y estado                       |
| `POST /api/appointments/:id/start`   | Inicio clínico con versión de cita (201)                    |
| `GET /api/encounters/:id`            | Registro clínico autorizado                                 |
| `PUT /api/encounters/:id`            | Borrador con versión de atención                            |
| `POST /api/encounters/:id/close`     | Cierre con versión de atención                              |
| `GET /api/pets/:id/history`          | Página de atenciones del paciente                           |

Contratos en `packages/shared/src/index.ts`. Citas: `AppointmentInput` con `petId`,
`professionalId`, `serviceId`, `date` (`YYYY-MM-DD`), `startTime` (`HH:mm`),
`durationMinutes` y `reason` (texto o `null`). `PUT` omite `petId` y añade `version`.
Cambios de estado reciben `{ version, status }`; inicio/cierre, `{ version }`.
Atención recibe `EncounterInput` completo más versión; signos opcionales como `null`.
Campos desconocidos e identidades impuestas desde el cliente se rechazan.

Lista de citas: `from`, `to`, `professionalId` opcional, `status` (o `all`), `q`
(paciente/responsable), `page` y `pageSize` (20 por defecto, hasta 50). Historia:
`page` y `pageSize` (5 por defecto, hasta 20). Disponibilidad: `petId`, `professionalId`,
`date`, `startTime`, `durationMinutes`, `excludeId` opcional al reprogramar. La búsqueda
es parametrizada y trata `%` y `_` como texto. Ningún listado incluye contactos
del responsable. Los logs HTTP omiten parámetros de búsqueda.

## Verificación y límites

`npm run check` ejecuta tipos, compilación y pruebas API/PostgreSQL: zona horaria,
medianoche, filtros, identidad, exclusiones, reservas simultáneas, reprogramación,
transiciones, permisos clínicos, inicio único, borradores concurrentes, cierre,
historia y reversión por fallo de auditoría. `npm run test:e2e` recorre programación,
reprogramación/cancelación, conflicto horario, llegada, consulta completa, historia,
conflicto de borrador, vista semanal, lectura fallida y formulario móvil.
Las pruebas limpian únicamente sus citas, consultas y pacientes sintéticos, conservando
auditoría; no eliminan historia real ni modifican las citas de la semilla.

Fuera de alcance: reserva pública, avisos automáticos, cobro/facturación, consumos
de inventario, recetas emitidas como documentos, carnet de vacunas, adjuntos,
adendas/reapertura clínica e integraciones externas. Las tablas de recetas y vacunas
reservadas en el modelo todavía no tienen un flujo operativo en la interfaz.
El [bloque 6](SEGUIMIENTOS-Y-CONTACTOS.md) incorpora seguimientos y registro manual de contactos desde fichas y atenciones cerradas. El despliegue
con datos reales requiere completar los bloques restantes y verificar el bloque 10.
