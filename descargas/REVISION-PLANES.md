# Revisión de planes y cobertura — 15/11/2026

Rama de código: `feat/plan-cards-coverage`, sobre `9c5b508`. No se modificó main, no se desplegó y no se tocó la instalación de Windows.

## Validación

- 34 pruebas unitarias.
- 171 escenarios de base de datos verificados con PostgreSQL 17. La primera corrida tuvo una expectativa antigua en el contrato público; se actualizó para incluir el código del plan y se repitió el archivo afectado: 12/12 correctas.
- 71 pruebas de aplicación en navegador: corrida existente 69/69 y dos escenarios nuevos correctos. Se repitió además el escenario de pago futuro después del ajuste final de su texto.
- 9 pruebas de vitrina correctas, incluida navegación con teclado del diálogo y ausencia de solicitudes a la API.
- Total: 285 escenarios únicos. Las repeticiones no se suman a ese total.
- Formato, tipos, compilación de aplicación, compilación de vitrina y catálogo verificados.
- Vistas privadas comprobadas a 1440 y 390 píxeles, sin desbordamiento. Fuentes calculadas: DM Sans y Manrope, como antes.
- Migración desde 14 a 15: valores originales de las 40 tablas de negocio conservados; solo cambia el registro de migraciones. También se restauró un respaldo previo con dos pagos históricos: importes conservados, inicios desconocidos permanecen desconocidos.

## Video

Montaje de 37 segundos, 1080×1920, H.264, 30 fps, pista AAC silenciosa. Usa los clips existentes de demostración y capturas reales de las nuevas tarjetas. Se comprobó decodificación completa y una hoja de contacto de once momentos. No incluye música ni locución. Mantiene avisos de datos ficticios, desarrollo y contratación próximamente. No muestra cobros reales ni promete funciones futuras.

## Límites

Los cobros solo se probaron con el proveedor simulado. No se validó Culqi real, 3-D Secure, credenciales reales ni reembolsos. Cobros reales y registro autónomo siguen apagados, legales en borrador. No se repitió Docker/Caddy (sin cambios en esta entrega); sí se utilizó PostgreSQL 17 en un contenedor de prueba. No se probó Windows ni Safari/iOS ni se publicó la vitrina. La migración es incremental, pero debe respaldarse la base antes de instalar.
