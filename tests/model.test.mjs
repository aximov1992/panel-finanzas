// Pruebas con datos inventados (nunca datos reales: este repo es público).
// Ejecutar con: node --test tests/model.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildModel, semaforo, shiftPeriod, toYMD } from "../js/model.js";

const pad = (rows, width) => rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")]);

function rawFixture() {
  const cycles = [
    ["2026-01", "2026-01-08T03:00:00.000Z", "2026-01-16T03:00:00.000Z"],
    ["2026-02", "2026-02-08T03:00:00.000Z", "2026-02-16T03:00:00.000Z"],
    ["2026-03", "2026-03-08T03:00:00.000Z", "2026-03-16T03:00:00.000Z"],
    ["2026-04", "2026-04-08T03:00:00.000Z", "2026-04-16T03:00:00.000Z"],
  ];
  const config = [
    ["CONFIGURACIÓN"], ["x"], [],
    ["Cotización", "", 1000],
    ["Última actualización", "", "2026-01-01T03:00:00.000Z"],
    ["CICLOS"],
    ["Período (AAAA-MM)", "Cierre", "Vencimiento"],
    ...cycles,
    [], [],
    ["CATEGORÍAS", "", "MEDIOS DE PAGO", "", "MONEDA", "", "ESTADO"],
    ["Comida", "", "Tarjeta de Crédito", "", "ARS", "", "Pendiente"],
    ["Ocio", "", "Débito", "", "USD", "", "Pagado"],
    [], [],
    ["INGRESOS"],
    ["Período (AAAA-MM)", "Fecha de Cobro", "Monto (ARS)"],
    ["2026-02", "", 500000],
    ["2026-03", "", ""],
  ];
  // Fila de Movimientos: ID, fecha, desc, cat, sub, medio, monto, moneda, cuotas, CFT, ..., estado en col 15
  const mov = (id, f, cat, medio, monto, moneda, cuotas) =>
    [id, f, "x", cat, "", medio, monto, moneda, cuotas, "", "", "", "", "", "Pagado"];
  const movs = [
    ["REGISTRO"], ["una fila = una compra"], ["ID", "Fecha"],
    mov(1, "2026-02-03T03:00:00.000Z", "Comida", "Débito", 1000, "ARS", 1), // efectivo/débito, febrero
    mov(2, "2026-02-05T03:00:00.000Z", "Comida", "Tarjeta de Crédito", 3000, "ARS", 3), // un cierre (8/1) <= fecha → rank 2
    mov(3, "2026-02-10T03:00:00.000Z", "Ocio", "Tarjeta de Crédito", 10, "USD", 1), // pasó el cierre de feb → rank 3
  ];
  return {
    Config: { values: pad(config, 7) },
    Movimientos: { values: pad(movs, 15) },
    Inversiones: { values: [["APORTES"], ["x"], ["Fecha", "Monto"], ["2026-02-15T03:00:00.000Z", 50000, "CEDEARs", ""]] },
    Presupuesto: { values: [["P"], ["x"], ["Mes", "x"], [""], ["Categoría", "Presupuesto"], ["Comida", 5000], ["Ocio", 0], ["TOTAL", 5000]] },
  };
}

test("toYMD recupera el día correcto para distintas zonas del script", () => {
  assert.equal(toYMD("2026-04-20T03:00:00.000Z"), "2026-04-20"); // UTC-3
  assert.equal(toYMD("2026-04-20T00:00:00.000Z"), "2026-04-20"); // UTC
  assert.equal(toYMD("2026-04-19T22:00:00.000Z"), "2026-04-20"); // UTC+2
  assert.equal(toYMD("2026-04-20"), "2026-04-20");
  assert.equal(toYMD(""), "");
});

test("rank de tarjeta y flujo de cuotas", () => {
  const m = buildModel(rawFixture(), "2026-02-20");
  const rank = Object.fromEntries(m.movs.map((x) => [x.id, x.rank]));
  assert.equal(rank[2], 2); // compra 5/2: un cierre (8/1) <= fecha, más uno
  assert.equal(rank[3], 3); // compra 10/2: dos cierres <= fecha, más uno
  assert.equal(rank[1], 0); // débito: sin rank
  // compra 2: 3 cuotas de 1000 en resúmenes 2, 3 y 4. Compra 3: US$10 en el resumen 3.
  const f = Object.fromEntries(m.forecast.map((x) => [x.period, x]));
  assert.equal(f["2026-02"], undefined); // vencimiento 16/2 ya pasó el 20/2
  assert.equal(f["2026-03"].ars, 1000);
  assert.equal(f["2026-03"].usd, 10);
  assert.equal(f["2026-04"].ars, 1000);
});

test("resumen del mes: débito por fecha + tarjeta por resumen, con USD convertido", () => {
  const m = buildModel(rawFixture(), "2026-02-20");
  const feb = m.monthSummary("2026-02");
  assert.equal(feb.cashTotal, 1000);
  assert.equal(feb.cardTotal, 1000); // cuota 1 de la compra 2 (resumen 2)
  assert.equal(feb.gasto, 2000);
  assert.equal(feb.ingreso, 500000);
  assert.equal(feb.aporte, 50000);
  assert.equal(feb.tasaAhorro, 0.1);
  const mar = m.monthSummary("2026-03");
  assert.equal(mar.cardTotal, 1000 + 10 * 1000); // cuota ARS + USD a cotización 1000
  assert.equal(mar.ingreso, 0);
  assert.equal(mar.tasaAhorro, null);
  assert.equal(feb.byCat.find((c) => c.cat === "Comida").presupuesto, 5000);
});

test("próximo vencimiento y semáforo", () => {
  const m = buildModel(rawFixture(), "2026-02-20");
  assert.equal(m.nextDue.period, "2026-03");
  assert.equal(m.nextDue.vto, "2026-03-16");
  assert.equal(semaforo(100, 1000).nivel, "ok");
  assert.equal(semaforo(600, 1000).nivel, "warn");
  assert.equal(semaforo(900, 1000).nivel, "bad");
  assert.equal(semaforo(100, 0).nivel, "none");
});

test("shiftPeriod cruza años", () => {
  assert.equal(shiftPeriod("2026-12", 1), "2027-01");
  assert.equal(shiftPeriod("2026-01", -1), "2025-12");
});

/* ---------------- Etapa 2: impuestos, categorías nuevas, fondo y bandeja ---------------- */

function rawConPanel() {
  const raw = rawFixture();
  // Categoría nueva en la columna I, debajo del encabezado
  const h = raw.Config.values.findIndex((r) => r[0] === "CATEGORÍAS");
  raw.Config.values[h + 1][8] = "Mascotas";
  raw.Impuestos = { values: [
    ["Fecha", "Origen", "Tipo", "Monto (ARS)", "Resumen (AAAA-MM)", "Nota"],
    ["2026-02-08T03:00:00.000Z", "Visa", "IIBB", 500, "2026-02", ""],
    ["2026-02-08T03:00:00.000Z", "Visa", "IVA RG 4240", 1500, "2026-02", ""],
    ["2026-03-08T03:00:00.000Z", "Visa", "IIBB", 700, "2026-03", ""],
  ] };
  raw.Bandeja = { values: [
    ["ID", "Recibido", "Texto original", "Monto", "Comercio", "Medio", "Tarjeta", "Hora", "Estado", "Clave", "Nota"],
    ["a1", "2026-02-20T21:04:00.000Z", "Pagaste $6.200 A KIOSCO EJEMPLO", 6200, "KIOSCO EJEMPLO", "Tarjeta de Crédito", "1111", "18:04", "pendiente", "k1", ""],
    ["a2", "2026-02-20T22:00:00.000Z", "texto raro", "", "", "", "", "", "sin_parsear", "k2", ""],
    ["a3", "2026-02-19T12:00:00.000Z", "ya cargado", 100, "X", "Débito", "2222", "09:00", "resuelto", "k3", ""],
  ] };
  raw.Inversiones = { values: [
    ["APORTES"], ["x"], ["Fecha", "Monto"],
    ["2026-02-15T03:00:00.000Z", 50000, "CEDEARs", ""],
    ["2026-02-16T03:00:00.000Z", 80000, "Fondo de emergencia", ""],
    ["2026-03-02T03:00:00.000Z", -20000, "fondo de emergencia", "retiro"],
  ] };
  raw.Panel_Config = { values: [["Clave", "Valor", "Actualizado"], ["fondo_meta_meses", 3, ""]] };
  return raw;
}

test("categorías nuevas se suman a las de la planilla", () => {
  const m = buildModel(rawConPanel(), "2026-02-20");
  assert.deepEqual(m.categoriasNuevas, ["Mascotas"]);
  assert.ok(m.categorias.includes("Mascotas") && m.categorias.includes("Comida"));
});

test("los impuestos suman al gasto del mes de su resumen y se desglosan por tipo", () => {
  const m = buildModel(rawConPanel(), "2026-02-20");
  const feb = m.monthSummary("2026-02");
  assert.equal(feb.impuestos, 2000);
  assert.equal(feb.gasto, 1000 + 1000 + 2000);
  assert.deepEqual(feb.impuestosPorTipo, [{ tipo: "IVA RG 4240", monto: 1500 }, { tipo: "IIBB", monto: 500 }]);
  assert.equal(buildModel(rawFixture(), "2026-02-20").monthSummary("2026-02").impuestos, 0);
});

test("la bandeja trae solo lo pendiente o sin entender, ordenado por llegada", () => {
  const m = buildModel(rawConPanel(), "2026-02-20");
  assert.deepEqual(m.bandeja.map((b) => b.id), ["a1", "a2"]);
  assert.equal(m.bandeja[0].fecha, "2026-02-20"); // 21:04 UTC es 18:04 en Argentina
  assert.equal(m.bandeja[0].monto, 6200);
  assert.equal(m.bandeja[1].estado, "sin_parsear");
});

test("fondo de emergencia: saldo con retiros, meta en meses de gasto y avance", () => {
  const m = buildModel(rawConPanel(), "2026-04-20"); // el primer mes del historial no cuenta: está incompleto
  assert.equal(m.fondo.saldo, 60000); // 80.000 aportados menos 20.000 retirados
  assert.equal(m.fondo.metaMeses, 3);
  assert.ok(m.fondo.gastoPromedio > 0);
  assert.equal(m.fondo.objetivo, 3 * m.fondo.gastoPromedio);
  assert.equal(m.fondo.avance, m.fondo.saldo / m.fondo.objetivo);
});

test("fondo de emergencia sin meta definida no inventa números", () => {
  const raw = rawConPanel();
  raw.Panel_Config = { values: [["Clave", "Valor", "Actualizado"]] };
  const m = buildModel(raw, "2026-03-20");
  assert.equal(m.fondo.objetivo, 0);
  assert.equal(m.fondo.avance, null);
  const sinNada = buildModel(rawFixture(), "2026-03-20");
  assert.equal(sinNada.fondo.saldo, 0);
});
