# NexoVet: crédito de desarrollo en el pie público

Cambio del 15/11/2026. El pie de la presentación y páginas legales muestra
«Desarrollado por Aarom Villanueva», con enlace HTTPS a aaromvillanueva.dev en
otra pestaña. El cambio se comprobó compilando el frontend y visitando cuatro
rutas en escritorio y móvil, sin desbordes. No hay nuevas dependencias ni
migraciones. No se volvieron a ejecutar las 90 pruebas de la entrega anterior
porque el cambio es de texto, enlace y distribución del pie.

No se completaron ni aprobaron textos legales. El responsable todavía no ha
definido su identificación comercial, domicilio, canales y proveedores para
el servicio real. No se inventó un RUC ni se habilitó el registro autónomo.

## Instalar

Detén npm run dev con Ctrl+C. Antes de actualizar realiza el respaldo de la
guía GUIA-WINDOWS-PRESENTACION.md. Conserva el .env, las cuentas y el cambio de
compose.yaml del puerto 15432. Ante un error, detente sin forzar el cambio.

Ejecuta una línea por vez en PowerShell:

```powershell
cd C:\Users\aarom\nexovet-prueba
git status
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Aarom-Villanueva/nexovet-demo/entrega-pie-autor/descargas/nexovet-pie-autor.bundle" -OutFile "$env:USERPROFILE\Downloads\nexovet-pie-autor.bundle"
git bundle verify "$env:USERPROFILE\Downloads\nexovet-pie-autor.bundle"
git fetch "$env:USERPROFILE\Downloads\nexovet-pie-autor.bundle" fix/public-footer-credit:fix/public-footer-credit
git switch fix/public-footer-credit
npm ci
docker compose up -d --wait db
npm run dev
```

Abre http://localhost:5173/inicio y comprueba el crédito al pie. El bundle es
acumulativo desde 353b777: incluye la revisión anterior de videos y su guía.
No necesitas importar primero el bundle anterior de presentación si ya tienes
ese antecedente. Los enlaces Cloudinary siguen en el manifiesto; conserva
eliminada cualquier variable antigua VITE_MEDIA_REMOTE que los sustituya.
No ejecutes seed ni regeneres usuarios.

## Consultar accesos locales sin modificarlos

```powershell
cd C:\Users\aarom\nexovet-prueba
Get-Content .\.local\demo-credentials-nexovet_dev.json
```

Ese archivo privado contiene solo las cuentas de demostración generadas por
el script original. Si cambiaste alguna clave, puede estar desactualizado. Las
cuentas creadas manualmente, incluido el operador, no se agregan a ese archivo.
Sus contraseñas no se pueden recuperar desde los hashes de la base.

Para listar nombres y correos actuales, con Docker y la base encendidos:

```powershell
docker compose exec -T db psql -U nexovet -d nexovet_dev -c "SELECT name, email FROM user_accounts ORDER BY email;"
```

Este SELECT no cambia claves ni usuarios. No compartas el archivo de contraseñas
ni lo subas al repositorio.
