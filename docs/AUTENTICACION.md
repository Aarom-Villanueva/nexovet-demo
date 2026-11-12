# Acceso del equipo — bloque 3

Implementa autenticación real en la aplicación `apps/`, separada de los botones
de rol simulados del prototipo estático publicado en GitHub Pages. No incorpora
registro público ni reserva pública de citas. Las consultas siguen siendo de
solo lectura: la escritura de clientes y mascotas corresponde al bloque 4.

## Probar localmente

Después de `db:migrate` y `db:seed`, ejecutar:

```sh
npm run auth:demo-users
npm run dev
```

Abrir http://localhost:5173. Las cuatro cuentas de la semilla reciben contraseñas
aleatorias de 256 bits. Consultarlas **localmente**, en
`.local/demo-credentials-nexovet_dev.json`. El archivo tiene permisos `0600`, está
ignorado por Git y no se imprime su contenido. La base de pruebas usa un archivo
distinto terminado en `nexovet_test.json`. No subir estos archivos ni copiar
credenciales al portafolio, capturas o conversaciones.

El comando rechaza producción, bases con otros nombres, negocios sin `is_demo`
y accesos ya habilitados que no coincidan con su archivo. Repetirlo conserva las
contraseñas; no reabre ni resetea cuentas ajenas. Si la contraseña cambió, usar
recuperación, no volver a ejecutar el comando para sobrescribirla.

## Qué puede consultar cada rol

| Consulta                                   | Administrador | Recepción | Veterinario |
| ------------------------------------------ | ------------- | --------- | ----------- |
| Resumen, agenda, mascotas y seguimientos   | Sí            | Sí        | Sí          |
| Listado de clientes y sus correos          | Sí            | Sí        | No          |
| Inventario y precios                       | Sí            | Sí        | No          |
| Rutas de compras y ventas (en preparación) | Sí            | Sí        | No          |
| Ruta de reportes (en preparación)          | Sí            | No        | No          |
| Cuentas/roles del equipo                   | Sí            | No        | No          |

Los veterinarios ven nombres de responsables vinculados a pacientes, pero no
el listado de contactos ni los datos comerciales. El resumen de su API omite
las filas de clientes y productos, y oculta el agregado de productos (`null`).
En esta etapa, los tres roles autorizados pueden consultar los pacientes y citas
de la misma sede; no se restringen a un profesional asignado. No hay separación
entre clínicas. Las rutas todavía no implementadas no publican datos de reportes,
compras o ventas. Los futuros endpoints deberán verificar permisos por operación.

El servidor consulta rol, actividad y habilitación de acceso en cada petición.
Cambiar/desactivar una cuenta en la base afecta sus peticiones siguientes.
El menú se recalcula al restaurar la sesión; la API aplica siempre el rol vigente.

## Sesiones y contraseñas

- Scrypt `N=32768,r=8,p=1`, sal aleatoria de 16 bytes, clave de 64 bytes.
  Contraseñas nuevas de 12 a 128 caracteres; no se almacenan en claro.
- Cookie de sesión aleatoria de 32 bytes, `HttpOnly`, `SameSite=Lax`, `Path=/`;
  `Secure` en producción. SHA-256 del token en PostgreSQL. Sin JWT ni tokens
  en `localStorage` o `sessionStorage`. Cookie de navegador sin persistencia explícita.
- Caduca tras 30 minutos sin peticiones autenticadas y, como máximo, 8 horas desde
  el login. Cada ingreso crea un token nuevo y revoca la sesión que traía ese navegador.
- Logout revoca en la base y borra la cookie. Las mutaciones de autenticación
  verifican `Origin`; logout también exige `X-CSRF-Token`, derivado del secreto de
  sesión mediante HMAC y conservado únicamente en memoria del frontend.
- Login incorrecto devuelve el mismo mensaje para usuario desconocido, deshabilitado
  o contraseña incorrecta. Se realiza scrypt también para cuentas desconocidas.
- Límite compartido en PostgreSQL: 100 solicitudes de autenticación por IP/15 min,
  10 intentos de login por correo/15 min y 3 solicitudes de recuperación por correo/15 min.
  Las claves de límite están hasheadas. `trustProxy` está desactivado: si se instala
  un proxy, configurar explícitamente sus direcciones de confianza antes de escalar;
  sin ello el límite se aplica a la IP del proxy. No confiar en cualquier cabecera.
- Respuestas `no-store`, `nosniff` y política de referente `no-referrer`. Registros de
  auditoría de accesos, fallos y recuperación sin contraseñas ni tokens completos.

## Recuperación y correo

«¿Olvidaste tu contraseña?» siempre responde con el mismo texto, exista o no una
cuenta habilitada. Un correo existente recibe un secreto de 32 bytes, válido por
30 minutos y por un solo uso. Solicitar otro invalida los anteriores. Cambiar la
contraseña revoca todas las sesiones y enlaces pendientes del usuario. El cambio
y consumo del token son transaccionales; dos usos concurrentes no pueden ganar.

En desarrollo, `MAIL_DELIVERY=local` guarda el mensaje en `.local/mail/*.json`
(directorio `0700`, archivos `0600`), sin contactar a nadie. Abrir localmente su URL.
El secreto va en el fragmento `#token=`, que no se envía como ruta al servidor; el
formulario lo retira de la barra y lo conserva en memoria. Recargar ese formulario
requiere abrir de nuevo el enlace original. No publicar el buzón ni exponer `.local/`.

Producción exige `NODE_ENV=production`, `ENABLE_DEMO=false`, `APP_ORIGIN=https://…`,
`MAIL_DELIVERY=smtp`, `SMTP_HOST` y `MAIL_FROM`. Si el proveedor requiere autenticación,
añadir `SMTP_USER` y `SMTP_PASSWORD` en el gestor de secretos del hosting. Puerto 587
usa STARTTLS obligatorio (`SMTP_SECURE=false`); puerto 465 suele usar TLS desde el
inicio (`SMTP_SECURE=true`). No se desactiva la validación del certificado. La API
responde antes de enviar el correo y registra fallos de entrega sin sus credenciales.
Todavía no hay cola de correo durable ni reintentos automáticos: ante un fallo de
entrega se revisa SMTP y el usuario puede solicitar un enlace nuevo, sujeto al límite.
La entrega real requiere configurar y comprobar el proveedor durante el despliegue.

## Crear una cuenta fuera de la demo

Comando privado del responsable del servidor, sin endpoint público ni contraseña
por defecto. Primero debe existir la configuración de la veterinaria y las migraciones.
Ejemplo Bash, con contraseña introducida oculta y sin escribirla en el historial:

```sh
export NEW_USER_EMAIL='administrador@tu-dominio.pe'
export NEW_USER_NAME='Nombre del responsable'
export NEW_USER_ROLE='admin' # reception o veterinarian para otras cuentas
read -r -s -p 'Contraseña (12–128 caracteres): ' NEW_USER_PASSWORD
export NEW_USER_PASSWORD
npm run auth:create-user
unset NEW_USER_PASSWORD
```

En otro terminal/sistema operativo usar su mecanismo de variables secretas.
El comando crea una cuenta y audita el aprovisionamiento; rechaza correos existentes,
sin sobrescribir usuarios ni contraseñas. Edición de usuarios y configuración por
interfaz quedan para el bloque 9. No convertir las cuentas ficticias en cuentas reales.

## Mantenimiento y verificación

Programar la limpieza periódica de límites vencidos, sesiones caducadas/revocadas
y enlaces usados/caducados con SQL administrativo. Conservar auditoría; nunca borrar
usuarios referenciados para limpiar pruebas. Ejemplo:

```sql
DELETE FROM auth_rate_limits WHERE window_ends_at < now();
DELETE FROM user_sessions WHERE expires_at < now() OR revoked_at IS NOT NULL;
DELETE FROM password_reset_tokens WHERE expires_at < now() OR used_at IS NOT NULL;
```

`npm run check` verifica tipos, compilación y pruebas API/PostgreSQL, incluidas
concurrencia, revocación, CSRF, roles y caducidad. `npm run test:e2e` prepara accesos
locales y prueba el navegador de escritorio/móvil, recuperación por buzón local,
persistencia al recargar, logout y denegación de acceso directo. Las pruebas de
recuperación crean una cuenta sintética independiente y la desactivan al terminar.
El deploy de la aplicación con HTTPS, Node y PostgreSQL corresponde al bloque 10;
la demo de GitHub Pages continúa siendo estática.
