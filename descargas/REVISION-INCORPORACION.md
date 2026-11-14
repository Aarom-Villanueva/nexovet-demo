# Revisión de NexoVet: sitio público e incorporación

Fecha: 14/11/2026 UTC. Revisión del bundle `nexovet-public-onboarding.bundle`,
cuya rama termina en `09efddc`, sobre la base multitenant revisada `d82a5d7`.
La entrega corregida está en la rama **fix/public-onboarding-validation** dentro
del nuevo bundle. No se modificó la computadora de Aarom ni se publicó el producto.

## Resultado y correcciones

El sitio público, el registro opcional, la configuración inicial, los tutoriales
y el mantenimiento están implementados. Se corrigieron estos puntos:

1. **Construcción Docker:** `.dockerignore` excluía `deploy/maintenance.html`,
   aunque el Dockerfile necesitaba copiarlo. Ahora se incluye explícitamente.
2. **Dominio público:** Caddy interpretaba `/inicio` como un matcher en la regla
   de redirección. La raíz respondía 200 con cuerpo vacío. Se hizo explícito el
   matcher `*`; la raíz ahora redirige a `/inicio` con 302. La validación sintáctica
   sola no detectaba este fallo; se añadió una prueba HTTP de la imagen final.
3. **Mantenimiento estático:** se aplicaba al dominio del sistema pero no al
   dominio público. Ahora ambos devuelven HTML o JSON de mantenimiento con 503.
4. **Registro concurrente:** si otra operación creaba la identidad entre su
   primera búsqueda y la asignación de membresía, podía faltar la exigencia de
   iniciar sesión. La respuesta final de la asignación también se comprueba:
   una identidad existente siempre requiere su propia sesión. La transacción
   se revierte y el enlace sigue disponible. Se probó con dos conexiones reales
   y un bloqueo de PostgreSQL en el punto de concurrencia.
5. **Exportación por veterinaria:** se añadieron configuración inicial, progreso
   de tutorial y mantenimiento de la clínica. Se comprobó que esas filas son de
   la clínica exportada y no contienen las de otra.
6. **Restauración completa:** además de sesiones y recuperación de contraseñas,
   invalida los enlaces de registro pendientes, conservando sus solicitudes.
   La operación admite respaldos anteriores sin la tabla de registro mediante
   una comprobación de existencia.
7. **Pruebas de navegador:** el registro deja de omitirse silenciosamente cuando
   se reutiliza un servidor con esa función apagada. La prueba del asistente
   espera a que se muestre Inventario antes de volver atrás: la primera pasada
   falló porque comprobaba solo el cambio de URL y volvía durante la transición.

## Verificación realizada

| Comprobación                            | Resultado                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipos y compilación de producción       | Aprobados                                                                                                                                                                     |
| Pruebas de API sin base                 | 12 aprobadas                                                                                                                                                                  |
| Pruebas con base PostgreSQL 17          | 148 aprobadas                                                                                                                                                                 |
| Navegador, escritorio y móvil           | 63 aprobadas en la segunda pasada completa                                                                                                                                    |
| Preparador de configuración local       | 5 aprobadas                                                                                                                                                                   |
| Total de esas suites                    | **228 aprobadas, ninguna omitida en la pasada final**                                                                                                                         |
| Migración desde la revisión anterior    | 12 → 13; contenido previo de 32 tablas conservado mediante conteos y huellas                                                                                                  |
| Migraciones anteriores 001–012          | Sin modificaciones                                                                                                                                                            |
| Imágenes Docker de API y web            | Construidas                                                                                                                                                                   |
| Caddy de la imagen final                | Dos dominios, redirección, API privada bloqueada, error 502, mantenimiento 503 y recuperación aprobados                                                                       |
| Simulacro completo Docker/PostgreSQL 17 | Aprobado: instalación sin semilla, dos clínicas aisladas, mantenimiento global y por clínica con recuperación por CLI, respaldo, restauración nueva e invalidación de accesos |

El registro de navegador usa un buzón local privado y las pruebas de IA usan
respuestas simuladas controladas por la suite; no verifican una IA ni SMTP reales.
La primera pasada de navegador fue 62/63; se corrigió la sincronización descrita
arriba y la segunda terminó 63/63. No se ocultó el fallo mediante reintentos.

La revisión utiliza una base aislada restaurada desde la entrega anterior y otro
proyecto Docker efímero para la recuperación. La base original del entorno y los
datos de la computadora de Aarom quedan separados. Las capturas revisadas de la
página pública usan exclusivamente datos ficticios.

Para repetir las pruebas del proxy después de construir las imágenes:

```bash
SMOKE_WEB_IMAGE=nexovet-web:operations node tests/operations/public-proxy.mjs
```

La prueba también queda incorporada al flujo de operaciones de GitHub Actions;
no se afirma que ese flujo haya corrido en GitHub durante esta revisión.

## Instalación local

Seguir `GUIA-WINDOWS-INCORPORACION.md`, empezando por el respaldo. Se conserva el
puerto **15432**, la configuración privada y las cuentas existentes. No hace
falta recrear el operador ni volver a generar contraseñas de demostración.
El bundle requiere que exista `d82a5d7`, que Aarom ya importó anteriormente.

El registro autónomo sigue **apagado por defecto**. Las clínicas existentes no
reciben una bienvenida de alta nueva; crear una clínica vacía permite probarla.
Las solicitudes de demostración se consultan en plataforma; no generan avisos.
Los precios solo aparecen al guardarlos y publicarlos desde plataforma.

## Pendientes para un servicio público con clientes reales

- Contratar/configurar servidor, DNS, dominios y HTTPS públicos; las pruebas de
  dos dominios son locales y las de HTTPS usan el certificado local de Caddy.
- Configurar y probar SMTP real, entrega de verificación y recuperación.
- Publicar condiciones y privacidad aprobadas. Los enlaces `example.invalid`
  de las pruebas no son documentos legales ni deben usarse en producción.
- Definir y probar operación comercial, soporte, monitoreo y respaldos externos.
  El vencimiento comercial se informa en plataforma; la suspensión de toda la
  clínica sigue siendo una acción del operador. No hay cobro automático.
- Configurar y probar el proveedor de IA si se desea habilitarlo. Persisten los
  límites de la revisión multitenant: presupuesto de tokens sin reserva previa,
  preguntas libres que pueden incluir datos que escriba la persona, y citas
  verificadas estructuralmente, no por su veracidad semántica.
- El registro público no incluye CAPTCHA; emplea límites por IP/correo, tope
  diario y verificación de correo. Evaluar su comportamiento antes de abrirlo.
- La exportación por clínica no es un restaurador automático independiente. El
  montaje de `/exports` y sus permisos deben comprobarse en el servidor destino.
- Windows no se ejecutó dentro de este entorno. La guía usa PowerShell y
  conserva la configuración local conocida, pero su aplicación debe revisarse
  paso a paso en la computadora del usuario.

Esta entrega permite probar localmente las funciones revisadas. Las pruebas no
constituyen una auditoría integral de seguridad ni una publicación de producción.
