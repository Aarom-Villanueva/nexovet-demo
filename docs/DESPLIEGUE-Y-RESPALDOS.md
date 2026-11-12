# Operación, despliegue y recuperación — bloque 10

La aplicación completa se instala en un servidor con Docker Engine y Compose v2,
Bash y herramientas habituales de Linux (`sha256sum`, `mktemp`). El host de
construcción necesita acceso a npm y a las imágenes oficiales de Node 22, Caddy
2.10 y PostgreSQL 17. No exige Node instalado en el servidor para operar los
contenedores. Reservar capacidad para las imágenes de construcción y los respaldos.

Este bloque prepara y prueba la instalación. No contrata hosting, configura DNS,
publica una clínica ni comprueba la entrega de un proveedor SMTP real. GitHub
Pages conserva exclusivamente el prototipo estático; no ejecuta esta API o base.

## Componentes y límites

- `deploy/Dockerfile`: construcción de React/TypeScript y API; el contenedor Node
  ejecuta JavaScript compilado como usuario `node`, sin servidor de desarrollo.
  `.dockerignore` excluye `.env`, `.local`, pruebas, respaldos y el prototipo.
- `deploy/compose.yaml`: PostgreSQL con volumen persistente, API con raíz de solo
  lectura y Caddy con volúmenes de certificados/configuración. Solo Caddy publica
  puertos. La base y la API no tienen puertos del host.
- `deploy/Caddyfile`: HTTPS automático para el dominio, archivos estáticos,
  recarga de rutas SPA y proxy `/api` (incluidos errores JSON, sin fallback HTML).
  El HTML se revalida para evitar retener versiones antiguas.
- Node confía en exactamente un salto de proxy (`TRUST_PROXY_HOPS=1`); fuera de
  este Compose se deja en cero salvo que exista ese proxy controlado. No exponer
  Node directamente cuando confía en cabeceras reenviadas. Caddy reemplaza las
  cabeceras de cliente recibidas, sin confiar en valores enviados por el visitante.
- El rol PostgreSQL de Node es `nexovet`, propietario de la base, sin superusuario,
  creación de roles ni creación de bases. Permite migraciones y DDL: no hay aún
  un rol de ejecución separado del migrador. La cuenta administrativa `postgres`
  se reserva a inicialización, respaldo y restauración dentro del contenedor.
- Una instalación pertenece a una veterinaria/sede. No existe aislamiento de
  múltiples clínicas dentro de la misma base. Para otra, usar otro proyecto,
  secretos, dominio y volúmenes.

## Primera instalación vacía

Usar el commit revisado de la aplicación y conservar su identificador. Desde la
raíz del checkout:

```sh
umask 077
cp deploy/.env.example .env.deploy
chmod 600 .env.deploy
# Script sin secretos: PostgreSQL debe poder leer el bind mount.
chmod 644 deploy/init-db.sh
```

Editar **localmente** `.env.deploy`: dominio en `SITE_ADDRESS` (sin protocolo) y
`APP_ORIGIN` (`https://dominio`, sin ruta o barra final), SMTP y remitente aprobados (usar comillas simples en valores literales con `$`).
Generar `DB_OWNER_PASSWORD` y `DB_PASSWORD` distintos con `openssl rand -hex 32`.
El password de aplicación se inserta en una URL: usar esos valores hexadecimales.
No pegar secretos en chat, capturas, comandos con valores literales ni Git.
`API_IMAGE` y `WEB_IMAGE` deben identificar el commit, por ejemplo
`nexovet-api:<commit>` y `nexovet-web:<commit>`; no reutilizar el mismo tag al actualizar.

El dominio debe apuntar al servidor. Permitir entrada TCP 80/443; Caddy necesita
salida para ACME y SMTP debe ser accesible desde la API. No colocar otro proxy o
CDN delante sin revisar TLS, origen y política de IP. El volumen de certificados
debe persistir para no solicitar certificados en cada reinicio.

```sh
bash ops/compose.sh build
bash ops/compose.sh up -d --wait db
bash ops/compose.sh run --rm --no-deps api node apps/api/dist/db/migrate.js

export BUSINESS_NAME='Nombre aprobado de la veterinaria'
export BUSINESS_ADDRESS='Dirección aprobada'
bash ops/compose.sh run --rm --no-deps -e BUSINESS_NAME -e BUSINESS_ADDRESS api node apps/api/dist/db/setup.js
unset BUSINESS_NAME BUSINESS_ADDRESS
```

`db/setup` crea solo configuración PEN/America/Lima, modo no demostrativo y un
registro de auditoría. No crea clientes, pacientes, servicios, categorías, productos
ni contraseñas. Rechaza una configuración ya existente o datos previos; no reemplaza
una clínica y no convierte la semilla en un negocio real. `db:initialize` es el
comando equivalente desde una instalación Node con su `DATABASE_URL` configurada.

Crear el primer administrador sin exponer la contraseña como argumento:

```sh
export NEW_USER_EMAIL='correo-aprobado@dominio.com'
export NEW_USER_NAME='Nombre del administrador'
export NEW_USER_ROLE=admin
read -r -s -p 'Contraseña de 12–128 caracteres: ' NEW_USER_PASSWORD
export NEW_USER_PASSWORD
bash ops/compose.sh run --rm --no-deps -e NEW_USER_EMAIL -e NEW_USER_NAME -e NEW_USER_ROLE -e NEW_USER_PASSWORD api node apps/api/dist/auth/create-user.js
unset NEW_USER_PASSWORD NEW_USER_EMAIL NEW_USER_NAME NEW_USER_ROLE
bash ops/compose.sh up -d --wait
```

Entrar por HTTPS y crear equipo, servicios/categorías e inventario desde las vistas.
No ejecutar semilla ni `auth:demo-users` en esta instalación. Producción rechaza
`ENABLE_DEMO=true`, base `is_demo=true`, correo local, origen sin HTTPS y esquema
incompatible. Los accesos del prototipo estático no sirven para esta aplicación.

Cambiar variables de contraseña en el archivo **no rota** roles en un volumen
existente. Una rotación requiere cambiar el rol en PostgreSQL mediante el operador,
actualizar el archivo privado y recrear la API; coordinar y probar ese cambio.
No reinicializar ni borrar el volumen para cambiar una clave.

## Comprobaciones de servicio

```sh
bash ops/compose.sh ps
curl --fail https://dominio-aprobado/api/health
curl --fail https://dominio-aprobado/api/ready
```

`health` indica proceso vivo. `ready` comprueba conexión, nombres/checksums exactos
de todas las migraciones y negocio configurado; rechaza una base de demo en
producción. Una imagen anterior rechaza también migraciones de una versión más
nueva. No aplica migraciones automáticamente. En producción comprueba antes de
escuchar; durante una caída de base sigue vivo, devuelve 503 sin detalle interno
y vuelve a estar listo al recuperar la conexión. El healthcheck del contenedor
usa `ready`. Docker marca fallos de salud, pero no reinicia solo por estar
`unhealthy`; un monitor externo debe avisar al operador.

Verificar login/logout, recarga de `/agenda`, permisos de los tres roles y una
recuperación de contraseña hacia un buzón controlado. Confirmar dominio/remitente,
STARTTLS o TLS SMTP y recepción del mensaje. Las pruebas automatizadas no envían
correo real. Vigilar espacio, respaldos fallidos, estado de servicios y certificados;
los logs de Compose tienen rotación y la API no registra cuerpos ni búsquedas.
Los volúmenes de base/certificados y `.env.deploy` necesitan conservación propia.

## Respaldo consistente

```sh
bash ops/backup.sh
```

Produce `.local/backups/nexovet-<UTC>-<sufijo>.dump` y su `.sha256`. `BACKUP_DIR`
permite otra carpeta privada. `pg_dump` 17 hace una instantánea consistente de
la base completa, incluyendo migraciones, historial clínico, libros, documentos,
usuarios, hashes y tokens almacenados. No exporta roles globales ni secretos SMTP,
DNS o certificados Caddy. Durante la copia pueden continuar las operaciones; el
punto recuperable corresponde a la instantánea, no a la hora final del archivo.

Se escribe primero un archivo parcial con permisos 0600 y se verifica que
`pg_restore` pueda leer su índice; solo entonces se publica el `.dump` con checksum.
Un checksum prueba integridad de bytes, no legitimidad ni recuperación completa.
Solo restaurar archivos propios y confiables: un respaldo PostgreSQL puede
contener funciones/SQL. No hay upload ni descarga pública de respaldos.

Programar en el servidor, por ejemplo a diario con cron y rutas absolutas. El
proceso debe tener acceso al archivo privado y Docker. Ejemplo de entrada, adaptando
ruta y horario del **servidor** (no se fuerza la zona de Lima en cron):

```cron
0 2 * * * BACKUP_DIR=/ruta-privada/backups /usr/bin/bash /ruta/nexovet/ops/backup.sh >> /ruta-privada/backup-status.log 2>&1
```

Enviar copias cifradas a otro almacenamiento/cuenta, con acceso restringido y
retención acordada, y probar recuperaciones periódicas. Este bloque no configura
proveedor externo, cifrado de archivos ni borrado automático por antigüedad. La
copia junto al servidor se pierde con él. Un respaldo diario implica hasta un día
de pérdida de cambios; acordar RPO y medir RTO mediante simulacros antes de prometerlos.
No subir respaldos, claves, `.local` ni archivos de configuración a GitHub.

## Restaurar sin sobrescribir

```sh
bash ops/restore.sh /ruta-privada/copia.dump nexovet_restore_simulacro_01
```

El destino debe ser **nuevo** y llamarse `nexovet_restore_*`. Se valida checksum e
índice antes de crearlo; un nombre existente se rechaza. No usa `DROP`, `--clean`
ni cambia la conexión de la aplicación. Para recuperar en otro host, preparar
PostgreSQL 17 y el rol propietario con el Compose antes de ejecutar la restauración.

`pg_restore` trabaja en una transacción, sin propietarios/ACL del servidor anterior,
con el rol `nexovet`. Después borra sesiones, enlaces de recuperación y límites
antiguos, y añade `operations.database_restored` a la auditoría. Usuarios, hashes,
operaciones y auditoría anterior se conservan. El reingreso requiere contraseña;
ninguna cookie o enlace del respaldo vuelve a habilitar acceso. Esas credenciales
podrían requerir rotación si el motivo fue un incidente de acceso.

Solo considerar completa la restauración si el script termina con éxito. Si falla,
el destino puede quedar creado vacío o con la copia antes de invalidar sesiones;
no conectarlo a la aplicación. Revisar el fallo y repetir hacia **otro nombre nuevo**.
La eliminación de destinos fallidos es una tarea manual del operador.

Antes de promover, comprobar negocio, migraciones, conteos, sumas de pagos/ventas,
existencias, movimientos e historia clínica con la misma versión de la aplicación,
en un entorno aislado sin correo saliente. Un respaldo no sustituye a las imágenes:
conservar el commit y tags compatibles. El script de prueba compara huellas de todas
las tablas (excepto accesos invalidados y el evento nuevo) y secuencias comerciales.

Para un cambio real: detener escrituras, obtener copia final y anotar su hora,
restaurar/revisar, detener API/web, cambiar `DB_NAME` en el archivo privado hacia
el destino validado y ejecutar `up -d --wait`. Comprobar reingreso/operaciones antes
de reabrir acceso. Mantener intacta la base anterior; nunca hacer que dos versiones
escriban en bases distintas y presentarlas como una sola. Cambios posteriores al
punto del respaldo no se recuperan con este mecanismo. No hay PITR/WAL en este bloque.

## Actualización y vuelta atrás

1. Revisar el PR y sus migraciones; construir tags nuevos por commit sin reemplazar
   imágenes anteriores. Mantener API/web de la misma versión.
2. En una ventana acordada, detener API/web y respaldar la base. Registrar imagen,
   commit, archivo, checksum y hora; probar esa copia en una base nueva.
3. Con las imágenes nuevas, ejecutar `db/migrate` una sola vez y luego `up -d --wait`.
   Verificar disponibilidad, login y operaciones. No migrar mientras sigue corriendo
   una API de esquema anterior.
4. Si la base no cambió y el esquema coincide, volver a ambos tags anteriores.
   Si una migración cambió el esquema, no ejecutar una imagen anterior contra él:
   restaurar la copia previa en un destino nuevo, validar y cambiar la conexión.
   Esto pierde cambios posteriores a la copia. No hay migraciones descendentes ni
   deshacer automático de operaciones financieras o clínicas.

No usar `docker compose down -v` en una instalación que deba conservar datos.
Las restricciones inmutables de SQL son controles de aplicación; el operador
administrativo de PostgreSQL/Docker conserva capacidad privilegiada sobre la base.

## Verificación reproducible

Desde el entorno de desarrollo con Node, Docker y Chromium de Playwright:

```sh
npm ci
npm run check
npm run test:e2e
# Conservar las imágenes de pruebas fuera de los tags de una instalación real.
docker build -f deploy/Dockerfile --target api -t nexovet-api:operations .
docker build -f deploy/Dockerfile --target web -t nexovet-web:operations .
npm run test:operations
```

En entornos con CA de proxy de construcción, pasar `--secret id=proxy_ca,src=...`;
solo se monta en la fase de npm y no se copia a las imágenes finales. No deshabilitar
verificación TLS. La prueba usa HTTPS localhost con certificado interno de Caddy;
solo sus clientes de prueba ignoran ese certificado local. La instalación pública
usa certificados válidos y no desactiva verificación TLS.

`test:operations` crea un proyecto/volúmenes aleatorios propios, sin utilizar
`.env.deploy` ni la base de desarrollo. Inicializa configuración vacía sin semilla,
crea tres roles y recorre cliente → mascota → agenda → atención → seguimiento,
compra recibida → venta mixta/cobros → stock → reporte/CSV. Comprueba cookies seguras,
SPA/proxy, denegaciones de rol, caída/recuperación de PostgreSQL, respaldo, rechazo
de corrupción/destino existente, huellas/secuencias y reingreso tras restauración.
Al terminar elimina **solo los volúmenes efímeros que ella creó**. Evidencias,
configuración y respaldos sintéticos quedan privados en `.local/operations-*`.
GitHub Actions ejecuta esta prueba además de las suites de API, PostgreSQL y navegador.
