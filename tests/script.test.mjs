// Pruebas del backend (apps-script/Code.gs) con una planilla simulada. Datos inventados.
// Ejecutar con: node --test tests/script.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, "../apps-script/Code.gs"), "utf8");
const fakes = readFileSync(join(here, "gas-fakes.js"), "utf8");

function newContext(opts) {
  const ctx = vm.createContext({});
  vm.runInContext(fakes, ctx);
  vm.runInContext(code, ctx);
  vm.runInContext(`__buildBook(${JSON.stringify(opts || {})})`, ctx);
  const call = (req) => JSON.parse(vm.runInContext(`__call(${JSON.stringify(req)})`, ctx));
  const run = (src) => vm.runInContext(src, ctx);
  return { call, run, ctx };
}

const PIN = "clave-de-prueba-1";
const mov = (extra = {}) => ({
  fecha: "2026-10-20", desc: "Kiosco de prueba", cat: "Alimentación", sub: "Kiosco/Cafetería",
  medio: "Débito", monto: 1500, moneda: "ARS", cuotas: 1, estado: "Pagado", ...extra,
});

test("parseNotification entiende los formatos del banco", () => {
  const { run } = newContext();
  const p = (t) => JSON.parse(run(`JSON.stringify(parseNotification(${JSON.stringify(t)}))`));
  assert.deepEqual(p("Pagaste $6.200 A KIOSCO EJEMPLO con tu Visa Crédito: 1111 a las 18:04"),
    { monto: 6200, comercio: "KIOSCO EJEMPLO", medio: "Tarjeta de Crédito", tarjeta: "1111", hora: "18:04" });
  assert.deepEqual(p("Pagaste: $3.285,84 A COMERCIO EJEMPLO con tu Visa Débito 2222 a las 09:49"),
    { monto: 3285.84, comercio: "COMERCIO EJEMPLO", medio: "Débito", tarjeta: "2222", hora: "09:49" });
  assert.equal(p("Pagaste: $500\nA TIENDA*PROPINA con tu Visa Debito\n2222 a las 8:54").monto, 500);
  assert.equal(p("Pagaste: $500\nA TIENDA*PROPINA con tu Visa Debito\n2222 a las 8:54").hora, "08:54");
  assert.equal(p("Pagaste: $7.270 A TIENDA*X con tu Visa Débito 2222").hora, ""); // la hora es opcional
  assert.equal(p("Recibiste una transferencia de $1.000"), null);
  assert.equal(p(""), null);
});

test("autenticación: clave incorrecta, correcta y bloqueo tras 10 fallos", () => {
  const { call } = newContext();
  assert.equal(call({ action: "ping", pin: "mal" }).error, "unauthorized");
  assert.equal(call({ action: "ping" }).error, "unauthorized");
  assert.deepEqual(call({ action: "ping", pin: PIN }), { ok: true, version: "2.0.0" });
  for (let i = 0; i < 10; i++) call({ action: "ping", pin: "mal" });
  assert.equal(call({ action: "ping", pin: PIN }).error, "locked");
});

test("la clave del celular no sirve para leer ni escribir", () => {
  const { call } = newContext();
  assert.equal(call({ action: "read", tab: "Config", pin: "clave-captura-1" }).error, "unauthorized");
  assert.equal(call({ action: "add_movs", pin: "clave-captura-1", rows: [mov()] }).error, "unauthorized");
});

test("lectura: hojas permitidas y hojas que se crean bajo demanda", () => {
  const { call } = newContext();
  assert.equal(call({ action: "read", tab: "Hoja_Secreta", pin: PIN }).error, "tab_not_allowed");
  assert.deepEqual(call({ action: "read", tab: "Impuestos", pin: PIN }).values, []);
  assert.equal(call({ action: "read", tab: "Config", pin: PIN }).ok, true);
});

test("add_movs escribe solo las columnas manuales y respeta las fórmulas", () => {
  const { call, run } = newContext({ preloaded: 3 });
  const r = call({ action: "add_movs", pin: PIN, rows: [mov({ desc: "=HYPERLINK(\"http://x\")" })] });
  assert.equal(r.ok, true);
  assert.equal(r.results[0].status, "added");
  assert.equal(r.results[0].row, 7); // filas 4-6 ocupadas, la primera libre es la 7
  assert.equal(run(`__cell("Movimientos", 7, 3)`), "'=HYPERLINK(\"http://x\")"); // no se interpreta como fórmula
  assert.equal(run(`__cell("Movimientos", 7, 2)`), "2026-10-20");
  assert.equal(run(`__cell("Movimientos", 7, 7)`), 1500);
  assert.equal(run(`__cell("Movimientos", 7, 15)`), "Pagado");
  for (const c of [1, 11, 12, 13, 14]) assert.notEqual(run(`__formula("Movimientos", 7, ${c})`), "", `columna ${c} conserva su fórmula`);
});

test("add_movs valida cada campo y rechaza lo inválido sin escribir nada", () => {
  const { call, run } = newContext();
  const bad = call({
    action: "add_movs", pin: PIN, rows: [
      mov({ cat: "Inventada" }), mov({ medio: "Bitcoin" }), mov({ moneda: "EUR" }), mov({ estado: "Raro" }),
      mov({ fecha: "2026-13-40" }), mov({ monto: 0 }), mov({ monto: "abc" }), mov({ desc: "  " }),
      mov({ cuotas: 3, medio: "Débito" }), mov({ cuotas: 0 }), mov({ cuotas: 2.5, medio: "Tarjeta de Crédito" }),
    ],
  });
  assert.equal(bad.added, 0);
  assert.ok(bad.results.every((x) => x.status === "invalid"));
  assert.equal(run(`__cell("Movimientos", 4, 2)`), "");
  assert.equal(call({ action: "add_movs", pin: PIN, rows: [] }).error, "rows_invalid");
  assert.equal(call({ action: "add_movs", pin: PIN, rows: new Array(201).fill(mov()) }).error, "rows_invalid");
});

test("add_movs acepta compras en cuotas con tarjeta y dólares", () => {
  const { call } = newContext();
  const r = call({
    action: "add_movs", pin: PIN, rows: [
      mov({ medio: "Tarjeta de Crédito", cuotas: 3, monto: 90000, cft: 0 }),
      mov({ medio: "Tarjeta de Crédito", moneda: "USD", monto: 20, desc: "Suscripción de prueba" }),
    ],
  });
  assert.deepEqual(r.results.map((x) => x.status), ["added", "added"]);
});

test("dryRun no escribe y avisa de posibles duplicados", () => {
  const { call, run } = newContext({ existing: [{ fecha: "2026-10-19", desc: "Ya cargado", cat: "Alimentación", medio: "Débito", monto: 1500, moneda: "ARS", cuotas: 1 }] });
  const r = call({ action: "add_movs", pin: PIN, dryRun: true, rows: [mov(), mov({ monto: 999 })] });
  assert.deepEqual(r.results.map((x) => x.status), ["would_add_possible_duplicate", "would_add"]);
  assert.equal(r.results[0].matchRow, 4);
  assert.equal(run(`__cell("Movimientos", 5, 2)`), "");
});

test("skipDuplicates saltea lo ya cargado, también por monto de cuota", () => {
  const { call } = newContext({ existing: [
    { fecha: "2026-10-19", desc: "Ya cargado", cat: "Alimentación", medio: "Débito", monto: 1500, moneda: "ARS", cuotas: 1 },
    { fecha: "2026-06-23", desc: "Compra en 6 cuotas", cat: "Tecnología", medio: "Tarjeta de Crédito", monto: 99000, moneda: "ARS", cuotas: 6 },
  ] });
  const r = call({ action: "add_movs", pin: PIN, skipDuplicates: true, rows: [
    mov(), // mismo monto, un día de diferencia
    mov({ fecha: "2026-10-18" }), // dentro de un día
    mov({ fecha: "2026-10-25" }), // lejos: se carga
    mov({ fecha: "2026-06-23", monto: 16500, medio: "Tarjeta de Crédito", desc: "Cuota 4/6" }), // monto por cuota
  ] });
  assert.deepEqual(r.results.map((x) => x.status), ["duplicate", "duplicate", "added", "duplicate"]);
});

test("cuando se acaban las filas, extiende las fórmulas y avisa", () => {
  const { call, run } = newContext({ fillAll: true });
  const r = call({ action: "add_movs", pin: PIN, rows: [mov()] });
  assert.equal(r.results[0].row, 504);
  assert.equal(r.extendedFormulas, true);
  assert.equal(r.warning, "beyond_formula_range");
  assert.notEqual(run(`__formula("Movimientos", 504, 1)`), "");
  assert.notEqual(run(`__formula("Movimientos", 504, 14)`), "");
  assert.equal(run(`__maxRows("Movimientos")`), 504);
});

test("impuestos: crea la hoja, valida y no duplica", () => {
  const { call, run } = newContext();
  const row = { fecha: "2026-10-08", origen: "Visa", tipo: "IIBB percepción CABA", monto: 788.53, resumen: "2026-10" };
  const r1 = call({ action: "add_impuestos", pin: PIN, rows: [row, { ...row, tipo: "IVA RG 4240", monto: 8279.63 }, { ...row, monto: "x" }] });
  assert.deepEqual(r1.results.map((x) => x.status), ["added", "added", "invalid"]);
  const r2 = call({ action: "add_impuestos", pin: PIN, rows: [row] });
  assert.equal(r2.results[0].status, "duplicate");
  const values = JSON.parse(run(`JSON.stringify(__sheetValues("Impuestos"))`));
  assert.equal(values.length, 3); // encabezado + 2
  assert.equal(values[0][0], "Fecha");
  assert.equal(values[1][2], "IIBB percepción CABA");
});

test("aportes: usa la primera fila libre, acepta retiros y avisa si está llena", () => {
  const a = newContext();
  const r = a.call({ action: "add_aporte", pin: PIN, fecha: "2026-09-21", monto: -103529.75, destino: "Balanz (retiro)", nota: "Retiro de inversión" });
  assert.deepEqual(r, { ok: true, row: 5 });
  assert.equal(a.run(`__cell("Inversiones", 5, 2)`), -103529.75);
  assert.equal(a.call({ action: "add_aporte", pin: PIN, fecha: "2026-09-21", monto: 0, destino: "x" }).error, "monto");
  const b = newContext({ invFull: true });
  assert.equal(b.call({ action: "add_aporte", pin: PIN, fecha: "2026-09-21", monto: 10, destino: "x" }).error, "inversiones_full");
});

test("ingreso: escribe en la fila del período y rechaza los que no existen", () => {
  const { call, run } = newContext();
  const r = call({ action: "set_ingreso", pin: PIN, period: "2026-09", fecha: "2026-09-08", monto: 2039298 });
  assert.deepEqual(r, { ok: true, row: 74 });
  assert.equal(run(`__cell("Config", 74, 3)`), 2039298);
  assert.equal(run(`__cell("Config", 74, 2)`), "2026-09-08");
  assert.equal(call({ action: "set_ingreso", pin: PIN, period: "2031-01", fecha: "2031-01-05", monto: 1 }).error, "period_not_listed");
  assert.equal(call({ action: "set_ingreso", pin: PIN, period: "2026-09", fecha: "2026-09-08", monto: -5 }).error, "monto");
});

test("categorías nuevas: van en la columna I, sin pisar nada, y quedan disponibles", () => {
  const { call, run } = newContext();
  assert.deepEqual(call({ action: "add_categoria", pin: PIN, nombre: "Mascotas" }), { ok: true, row: 59 });
  assert.deepEqual(call({ action: "add_categoria", pin: PIN, nombre: "Regalos" }), { ok: true, row: 60 });
  assert.equal(call({ action: "add_categoria", pin: PIN, nombre: "mascotas" }).error, "ya_existe");
  assert.equal(call({ action: "add_categoria", pin: PIN, nombre: "salud" }).error, "ya_existe");
  assert.equal(call({ action: "add_categoria", pin: PIN, nombre: "=1+1" }).error, "nombre");
  assert.equal(run(`__cell("Config", 58, 9)`), "CATEGORÍAS NUEVAS (panel)");
  assert.equal(run(`__cell("Config", 71, 1)`).startsWith("INGRESOS"), true);
  const r = call({ action: "add_movs", pin: PIN, rows: [mov({ cat: "Mascotas" })] });
  assert.equal(r.results[0].status, "added");
});

test("ajustes: solo claves permitidas, crea la hoja y actualiza sin duplicar", () => {
  const { call, run } = newContext();
  assert.equal(call({ action: "set_setting", pin: PIN, key: "cualquier_cosa", value: 1 }).error, "key_not_allowed");
  assert.equal(call({ action: "set_setting", pin: PIN, key: "fondo_meta_meses", value: -1 }).error, "value");
  assert.equal(call({ action: "set_setting", pin: PIN, key: "fondo_meta_meses", value: 6 }).ok, true);
  assert.equal(call({ action: "set_setting", pin: PIN, key: "fondo_meta_meses", value: 4 }).ok, true);
  const vals = JSON.parse(run(`JSON.stringify(__sheetValues("Panel_Config"))`));
  assert.equal(vals.length, 2);
  assert.equal(vals[1][0], "fondo_meta_meses");
  assert.equal(vals[1][1], 4);
});

test("captura: encola, evita duplicados y guarda lo que no entiende", () => {
  const { call, run } = newContext();
  const n = { action: "capture", key: "clave-captura-1", recibido: "2026-10-28T21:04:00.000Z",
    texto: "Pagaste $6.200 A KIOSCO EJEMPLO con tu Visa Crédito: 1111 a las 18:04" };
  const r1 = call(n);
  assert.equal(r1.status, "queued");
  assert.equal(call(n).status, "duplicate");
  assert.equal(call({ ...n, key: "mal" }).error, "unauthorized");
  assert.equal(call({ ...n, texto: "Texto raro que no es un pago" }).status, "queued_unparsed");
  const rows = JSON.parse(run(`JSON.stringify(__sheetValues("Bandeja"))`));
  assert.equal(rows.length, 3);
  assert.equal(rows[1][3], 6200);
  assert.equal(rows[1][5], "Tarjeta de Crédito");
  assert.equal(rows[1][8], "pendiente");
  assert.equal(rows[2][8], "sin_parsear");
});

test("captura: el bloqueo del celular no afecta al panel", () => {
  const { call } = newContext();
  for (let i = 0; i < 10; i++) call({ action: "capture", key: "mal", texto: "x" });
  assert.equal(call({ action: "capture", key: "clave-captura-1", texto: "Pagaste $1 A X con tu Visa Débito 2222" }).error, "locked");
  assert.equal(call({ action: "ping", pin: PIN }).ok, true);
});

test("bandeja: confirmar carga el movimiento una sola vez y descartar no carga nada", () => {
  const { call, run } = newContext();
  const cap = call({ action: "capture", key: "clave-captura-1", recibido: "2026-10-28T21:04:00.000Z",
    texto: "Pagaste $6.200 A KIOSCO EJEMPLO con tu Visa Crédito: 1111 a las 18:04" });
  const ok = call({ action: "bandeja_resolve", pin: PIN, id: cap.id, accion: "confirmar",
    row: mov({ fecha: "2026-10-28", desc: "Kiosco ejemplo", monto: 6200, medio: "Tarjeta de Crédito" }) });
  assert.equal(ok.status, "resuelto");
  assert.equal(run(`__cell("Movimientos", ${ok.row}, 7)`), 6200);
  assert.equal(call({ action: "bandeja_resolve", pin: PIN, id: cap.id, accion: "confirmar", row: mov() }).error, "ya_resuelto");

  const cap2 = call({ action: "capture", key: "clave-captura-1", recibido: "2026-10-28T22:00:00.000Z",
    texto: "Pagaste $900 A OTRO LUGAR con tu Visa Débito 2222 a las 19:00" });
  assert.equal(call({ action: "bandeja_resolve", pin: PIN, id: cap2.id, accion: "descartar" }).status, "descartado");
  assert.equal(run(`__cell("Movimientos", ${ok.row + 1}, 2)`), "");
  assert.equal(call({ action: "bandeja_resolve", pin: PIN, id: "no-existe", accion: "descartar" }).error, "id_no_encontrado");
});

test("bandeja: si la fila a confirmar es inválida, no se marca como resuelta", () => {
  const { call } = newContext();
  const cap = call({ action: "capture", key: "clave-captura-1", texto: "Pagaste $900 A OTRO LUGAR con tu Visa Débito 2222 a las 19:00" });
  const r = call({ action: "bandeja_resolve", pin: PIN, id: cap.id, accion: "confirmar", row: mov({ cat: "Nada" }) });
  assert.equal(r.error, "no_se_pudo_cargar");
  const again = call({ action: "bandeja_resolve", pin: PIN, id: cap.id, accion: "confirmar", row: mov() });
  assert.equal(again.status, "resuelto");
});
