# Planes y cobertura de NexoVet

Las tarjetas Inicial, Pro y Business se comparten entre la página pública, la vitrina estática y Mi plan y pagos. Se conservan DM Sans, Manrope y los colores existentes. Inicial usa el catálogo de lanzamiento (S/129, 100 análisis mensuales); el sistema privado respeta el plan y precio asignados y la página integrada respeta el Inicial publicado por el operador. Pro y Business son informativos: precio por definir, funciones por definir, sin contratación ni cambio de plan. Sus diálogos no envían solicitudes de pago. La API también impide asignarlos o renovarlos.

## Fechas

La migración 015 es incremental. Registra el final conocido de una prueba y el inicio de cobertura de nuevos pagos mensuales. Los pagos históricos sin inicio registrado conservan ese dato como desconocido. No se inventa una fecha restando un mes.

Una renovación anticipada empieza después del último día ya cubierto y agrega un mes calendario, sin perder días. Si ya venció, empieza hoy en hora de Lima. El período futuro abonado se muestra separado del período vigente o de la prueba. Un ajuste manual con fechas arbitrarias no presume un inicio no proporcionado.

## Seguridad de cobros

Se conservan los avisos desde cinco días antes, vencimiento y gracia. El vencimiento no borra datos ni bloquea el ingreso o la renovación. No cambia la suspensión manual de una veterinaria ni se convierte este trabajo en un bloqueo general del sistema.

Se puede cancelar una solicitud únicamente antes de enviar el cobro al proveedor. Un cargo incierto requiere conciliación; no se libera para cobrar otra vez ni se cancela como si no hubiera ocurrido. Un pago confirmado no se borra ni se revierte desde el botón de cancelar. No se agrega débito automático ni una política de reembolsos ficticia.

Los cobros reales siguen apagados. Culqi debe probarse con sus credenciales y su servicio real antes de habilitar producción. Los documentos legales siguen en borrador y el registro autónomo sigue apagado.
