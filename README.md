# Panel de finanzas

Panel web (PWA) para ver tus finanzas personales desde la compu y el celular. Lee la planilla de Google Sheets `Finanzas_Personales_Ian` a través de un script de Apps Script protegido por PIN. Solo modo oscuro.

**Estado:** Etapa 1 (lectura). La carga de movimientos desde el panel llega en la Etapa 2.

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
