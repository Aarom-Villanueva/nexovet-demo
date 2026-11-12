# Directorio de clientes y mascotas — bloque 4

El directorio de `/clientes` sustituye las muestras limitadas de la versión anterior.
Incluye fichas, registro, edición, archivo/reactivación y listas paginadas. Guarda
en PostgreSQL; recargar el navegador conserva los cambios. La demo estática de la
raíz sigue siendo independiente y no cambia en esta entrega.

## Recorrido

1. Ingresar como administrador o recepción y abrir **Clientes y mascotas**.
2. **Nuevo cliente**: ingresar nombre y, opcionalmente, datos de contacto,
   documento y dirección. Registrar la autorización de contacto únicamente si
   se obtuvo, junto a su constancia. Esto no envía mensajes ni verifica la identidad.
3. Abrir su ficha y pulsar **Registrar mascota**: el responsable queda seleccionado.
   También se puede usar **Nueva mascota** y buscar al responsable en todo el
   directorio activo por nombre, documento, teléfono o correo. Debe seleccionarse
   un resultado, no basta con escribir un nombre.
4. Registrar especie, sexo y datos opcionales del paciente: raza, nacimiento,
   microchip y alergias/observaciones conocidas. No hay diagnóstico automático.
5. Editar desde la ficha o el lápiz del listado. Guardar incrementa la versión.
   Archivar/reactivar se hace con el estado de la ficha. **Activos**, **Archivados**
   y **Todos** permiten encontrarla después.

La ficha del responsable incluye sus mascotas, también archivadas, con paginación
propia. No se elimina físicamente ninguna ficha desde la aplicación. Archivar un
cliente no archiva automáticamente sus pacientes y conserva las relaciones;
impide registrar nuevas mascotas a su nombre hasta reactivarlo. No se transfieren
pacientes a otro responsable en este alcance.

## Permisos

| Operación                                               | Administrador | Recepción | Veterinario |
| ------------------------------------------------------- | ------------- | --------- | ----------- |
| Buscar/consultar clientes y contactos                   | Sí            | Sí        | No          |
| Buscar/consultar mascotas y datos clínicos de ficha     | Sí            | Sí        | Sí          |
| Registrar/editar/archivar/reactivar clientes y mascotas | Sí            | Sí        | No          |

La API del veterinario devuelve únicamente campos del paciente e identificador,
nombre y estado de su responsable. No devuelve teléfono, correo, dirección,
documento ni autorización de contacto. La búsqueda de mascotas tampoco consulta
esos campos privados; busca nombre del paciente, nombre del responsable y microchip.
Todos los pacientes pertenecen a la misma sede; no hay aislamiento entre clínicas.

## API

Todas las rutas requieren sesión. `POST` y `PUT` también exigen el origen permitido,
`X-CSRF-Token` y rol de administrador/recepción. No hay rutas `DELETE` ni `PATCH`.

| Método/ruta            | Resultado                                               |
| ---------------------- | ------------------------------------------------------- |
| `GET /api/clients`     | Página de clientes con cantidad de mascotas por cliente |
| `GET /api/clients/:id` | Ficha del cliente                                       |
| `POST /api/clients`    | Crea y devuelve ficha (201 y Location)                  |
| `PUT /api/clients/:id` | Reemplaza campos editables con control de versión       |
| `GET /api/pets`        | Página de pacientes con responsable, sin contactos      |
| `GET /api/pets/:id`    | Ficha del paciente, sin contactos                       |
| `POST /api/pets`       | Crea mascota vinculada a `clientId` activo (201)        |
| `PUT /api/pets/:id`    | Reemplaza campos editables; no acepta `clientId`        |

Listas: `{ items, total, page, pageSize }`. Parámetros `q` (hasta 100 caracteres),
`page` (1–10000), `pageSize` (1–50, predeterminado 20), `status` (`active`,
`archived`, `all`; predeterminado `active`). Mascotas admite también `clientId`.
El formulario de responsables solicita hasta ocho coincidencias activas.

Búsqueda parcial sin distinguir mayúsculas; las tildes se conservan. Clientes:
nombre, correo, teléfono guardado y documento. Mascotas: nombre, responsable y chip.
`%`, `_` y barras invertidas se buscan literalmente. Valores SQL parametrizados;
orden por nombre e ID para paginar empates de forma estable. Conteo y filas se
leen en una misma instantánea. La búsqueda por teléfono utiliza su forma guardada
(sin espacios/separadores). No hay búsqueda difusa ni detección por similitud.
Los registros HTTP omiten los parámetros de búsqueda en la URL registrada.

Los contratos `ClientInput`, `ClientRecord`, `PetInput`, `PetRecord` y `PageResult`
están en `packages/shared/src/index.ts`. `POST` recibe todos los campos de su Input;
los opcionales se envían como `null`, no se omiten. `PUT` recibe el mismo Input más
`version`; mascotas lleva `clientId` solo en el alta. Campos desconocidos se rechazan.
No enviar `id`, `createdAt`, `updatedAt`, `ownerName` o contadores como campos editables.

## Validaciones y consistencia

- Nombre de 2–150 caracteres. Campos de texto se recortan; vacíos opcionales pasan
  a `null`. Correo válido, hasta 254 caracteres y normalizado a minúsculas.
- Teléfono: elimina espacios, paréntesis, puntos y guiones; exige 7–15 dígitos y
  admite `+` inicial. No comprueba que exista ni que corresponda a WhatsApp.
- Tipo y número de documento deben estar ambos presentes o ambos vacíos. DNI de
  ocho dígitos, RUC de once; CE de 6–20 letras/dígitos; otro de 3–30 caracteres.
  Se normaliza el número a mayúsculas. Son validaciones de formato, sin consulta
  a RENIEC/SUNAT ni validación de dígito de control. No hacen verificación de identidad.
- El mismo tipo/número no puede repetirse. Correo, teléfono y nombre sí pueden
  compartirse; no son una clave inequívoca de una familia.
- Autorización de contacto exige una nota (hasta 500 caracteres). El servidor
  establece la fecha al concederla y la conserva mientras siga vigente; retirarla
  borra fecha/nota actuales. No se agregan teléfonos o autorizaciones por defecto.
- Especie y sexo tienen opciones cerradas. Nacimiento debe ser fecha real, no
  futura respecto de Lima. Raza hasta 100 caracteres, chip hasta 40, observaciones
  hasta 2000. Microchip normalizado a mayúsculas y único; sin comprobación de
  fabricante ni imposición de un estándar de chip. No se interpreta texto clínico.
- Alta de mascota bloquea su responsable durante la transacción y verifica que
  siga activo. `clientId` de la mascota es inmutable por esta API.
- Migración `003_clients_pets.sql` añade `version` (desde 1) y `updated_at`.
  Un `PUT` con versión antigua devuelve 409 `VERSION_CONFLICT`; no mezcla ediciones
  ni sobrescribe cambios posteriores. La interfaz conserva el borrador y permite
  cargar expresamente la versión actual antes de volver a editar.
- Alta/edición y auditoría se confirman juntas. Si falla cualquiera, se revierte
  todo. Auditoría registra actor, operación, ID, versión y nombres de campos enviados;
  no duplica documentos, contactos ni notas clínicas. No es un historial completo
  de valores anteriores/posteriores. El SQL administrativo externo debe respetar
  estas reglas; no sustituye a la API.

Errores de campo: 400 con `fields`; sin sesión: 401; rol/origen/CSRF inválido: 403;
ficha inexistente: 404; duplicados y conflictos: 409. No se exponen consultas SQL ni
restricciones internas. Un error de guardado conserva las entradas del formulario;
regresar a la pestaña tampoco desmonta un formulario abierto.

## Pruebas y límites

`npm run check` incluye pruebas con PostgreSQL de búsquedas, paginación, validación,
duplicados concurrentes, actualización concurrente, archivo/reactivación, autorización,
vínculos y reversión completa ante fallo de auditoría. Las pruebas de fichas solo
usan `nexovet_test` y limpian las fichas que ellas crearon; conservan auditoría.
`npm run test:e2e` comprueba el recorrido de alta y edición, responsable seleccionado,
duplicados, conflicto con otra sesión, conservación de borrador ante fallo de red,
recarga y formularios móviles. Sus fichas sintéticas también se limpian al terminar.

No incluye importación masiva, fotos/adjuntos, transferencias de propietario,
fusión automática de duplicados ni historial de cambios con valores.
[El bloque 5](AGENDA-Y-ATENCION.md) añade agenda y atención operativa, e historia
clínica desde la ficha del paciente para administrador y veterinario. Aún no desplegar con datos
reales: faltan los siguientes módulos y la verificación del despliegue del bloque 10.
