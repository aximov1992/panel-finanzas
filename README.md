# Panel de finanzas

Panel web (PWA) para ver tus finanzas personales desde la compu y el celular. Lee la planilla de Google Sheets `Finanzas_Personales_Ian` a través de un script de Apps Script protegido por PIN. Solo modo oscuro.

**Estado:** Etapa 1 (lectura) lista. Etapa 2 (escritura) en curso: el backend ya está en `apps-script/Code.gs`.

## Qué muestra
- Gasto del mes (sin tarjeta + resumen de tarjeta), ingreso, balance y tasa de ahorro.
- Tarjeta: próximo vencimiento, semáforo contra el ingreso y compromiso por resumen.
- Gasto por categoría contra el presupuesto, evolución de los últimos meses y movimientos del mes.
- Fondo de emergencia (meta sin definir por ahora).

Los cálculos replican las fórmulas de la planilla (Cuotas_Flujo, Dashboard, Historico_Mensual). Un cambio en esas fórmulas hay que reflejarlo en `js/model.js`.

## Cómo funciona
- `index.html`, `css/`, `js/`: el panel. No tiene servidor propio.
- `js/api.js`: llama por POST al script de Apps Script con la PIN.
- `js/model.js`: cálculos puros, sin DOM. Se prueban con `npm test` (datos inventados).
- `sw.js` y `manifest.webmanifest`: lo hacen instalable. El service worker guarda solo el armazón de la app, nunca los datos.

## Publicación (GitHub Pages)
1. Settings → Pages → Build and deployment → Deploy from a branch.
2. Branch `main`, carpeta `/ (root)`, Save.
3. La URL queda como `https://<usuario>.github.io/panel-finanzas/`.
4. En el celu: abrir esa URL y usar "Agregar a pantalla de inicio" (iPhone, desde Safari) o "Instalar app" (Android, desde Chrome).

Después de subir cambios, la app instalada puede mostrar la versión anterior una vez. Recargar la actualiza.

## Seguridad
- Este repositorio es público: **no contiene datos ni la PIN**. Solo la URL del script, que sin PIN responde `unauthorized`.
- La PIN vive en las propiedades del script de Apps Script (propiedad `PIN`). Usá 8 caracteres o más con letras y números.
- El panel guarda la PIN solo si tildás "Recordar en este dispositivo", y solo en ese navegador. "Bloquear" la borra.
- Nunca subas datos reales al repositorio, ni siquiera en pruebas.

## Backend (Apps Script)
`apps-script/Code.gs` es el código que va dentro de la planilla (Extensiones > Apps Script). Dos claves, guardadas en las propiedades del script:
- `PIN`: la del panel. Lee y escribe.
- `CAPTURE_KEY`: la del atajo del celular. Solo puede anotar en la hoja `Bandeja`; no lee nada.

Qué hace:
- Solo **agrega** filas. Nunca borra ni pisa. Escribe únicamente las columnas manuales de Movimientos y deja las fórmulas.
- Valida cada campo contra las listas de `Config` y evita que un texto se interprete como fórmula.
- Detecta duplicados (mismo monto o monto de cuota, misma moneda, fecha a un día).
- Crea bajo demanda las hojas `Impuestos`, `Bandeja` y `Panel_Config`.
- Si se acaban las filas de Movimientos, copia las fórmulas hacia abajo. Dashboard y Cuotas_Flujo de la planilla solo cuentan hasta la fila 503; el panel no tiene ese límite.
- Tras 10 intentos fallidos en 10 minutos se bloquea 15 minutos (también para quien tenga la clave correcta).

Para actualizar el script: pegar el archivo, luego Implementar > Administrar implementaciones > editar la existente > Versión nueva. Así la URL no cambia.

Pruebas: `npm test` (planilla simulada, datos inventados).
