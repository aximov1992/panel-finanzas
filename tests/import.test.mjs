// Datos inventados con el mismo formato que los resúmenes del banco. Ejecutar con: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { parseVisa, parseCaja, parseLines, detectKind, itemsToLines, toNum } from "../js/pdfparse.js";
import { buildPlan, planToRequests, tipoImpuesto } from "../js/importplan.js";

const VISA = `
Resumen N° VI00000000000000001
Tarjeta Crédito VISA
10-Sep-26 18-Sep-26 08-Oct-26 16-Oct-26 05-Nov-26 13-Nov-26
CONSOLIDADO PESOS DÓLARES
SALDO ANTERIOR 1.000,00 10,00
17-09-26 SU PAGO EN PESOS -1.000,00
17-09-26 SU PAGO EN USD -10,00
18-09-26 DEV.IMP. RG 5617 30%( 1000,00) -300,00
DETALLE DEL CONSUMO
FECHA REFERENCIA CUOTA COMPROBANTE PESOS DÓLARES
19-05-26 * MERPAGO*TIENDAUNO 05/09 158663 29.977,66
11-09-26 K MERPAGO*GIMNASIOX 109438 54.000,00
11-09-26 K GOOGLE *Servicio b P1ogCePc USD 20,00 855413 20,00
14-09-26 * MERPAGO*CAFEUNO 01/03 258236 34.337,38
17-09-26 K DLO*Delivery Propina 684163 400,00
TARJETA 1234 Total Consumos de PERSONA DE PRUEBA 118.715,04 20,00
08-10-26 IIBB PERCEP-CABA 2,00%( 39426,83) 788,53
08-10-26 IVA RG 4240 21%( 39426,83) 8.279,63
TOTAL A PAGAR 127.783,20 20,00
`.trim().split("\n");

const CAJA = `
Resumen de Caja de Ahorro en Pesos
Movimientos
Fecha Descripción Origen Crédito Débito Saldo
31/08/26 COMPRA DEBITO 0171 -1.000,00 20.665,58
UNA TIENDA
4517690179506130
31/08/26 PERCEPCION RG 5617/24 -303,91 20.361,67
31/08/26 DEV.COMPRA GALICIA 0171 1.000,00 21.361,67
OTRA TIENDA
31/08/26 ANULACION PERCEPCION RG 303,91 21.665,58
5617/24
Resumen de Caja de Ahorro en Pesos Página 1/2
20260925046182835P
Fecha Descripción Origen Crédito Débito Saldo
08/09/26 ACREDITAMIENTO DE HABERES 1.000.000,00 1.021.665,58
EMPRESA SA
10/09/26 COMPRA DEBITO 0755 -16.778,35 1.004.887,23
FARMACIA UNO
10/09/26 REINTEGRO PROMOCION GALICIA 4.194,58 1.009.081,81
MODO
25% en Farmacia
11/09/26 TRANSFERENCIA DE CUENTA 2.000,00 1.011.081,81
PROPIA
21/09/26 TRANSFERENCIA DE TERCEROS 100.000,00 1.111.081,81
BROKER CAPITAL VALOR
BALANZ
Total $ 1.101.194,58 -$ 10.778,35 $ 1.111.081,81
`.trim().split("\n");

test("detecta el tipo de resumen", () => {
  assert.equal(detectKind(VISA), "visa");
  assert.equal(detectKind(CAJA), "caja");
  assert.equal(detectKind(["hola"]), null);
  assert.equal(parseLines(["hola"]), null);
  assert.equal(toNum("1.234.567,89"), 1234567.89);
});

test("Visa: consumos, cuotas, dólares, impuestos y verificación contra el total", () => {
  const v = parseVisa(VISA);
  assert.equal(v.cierre, "2026-10-08");
  assert.equal(v.vto, "2026-10-16");
  assert.equal(v.cierreAnterior, "2026-09-10");
  assert.equal(v.consumos.length, 5);
  assert.deepEqual(v.consumos[0].cuota, { n: 5, de: 9 });
  const usd = v.consumos.find((c) => c.moneda === "USD");
  assert.equal(usd.monto, 20);
  assert.equal(usd.ref, "GOOGLE *Servicio b P1ogCePc");
  assert.equal(v.cargos.length, 3);
  assert.equal(v.pagos.length, 2);
  assert.equal(v.cuadra, true);
});

test("Visa: si la suma no coincide con el total, avisa", () => {
  const roto = VISA.filter((l) => !l.includes("GIMNASIOX"));
  assert.equal(parseVisa(roto).cuadra, false);
});

test("Caja: lee movimientos con detalle en varias líneas y verifica los saldos", () => {
  const c = parseCaja(CAJA);
  assert.equal(c.movs.length, 9);
  assert.equal(c.movs[0].detalle[0], "UNA TIENDA");
  assert.equal(c.movs[3].desc, "ANULACION PERCEPCION RG");
  assert.equal(c.cuadra, true);
  assert.equal(parseCaja(CAJA.map((l) => l.replace("1.004.887,23", "9.999,99"))).cuadra, false);
});

test("itemsToLines arma líneas ordenadas por posición", () => {
  const it = (str, x, y) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5 });
  const lines = itemsToLines([it("20,00", 300, 700), it("GOOGLE", 50, 700), it("Otra", 50, 680), it("USD", 120, 700)]);
  assert.deepEqual(lines, ["GOOGLE USD 20,00", "Otra"]);
});

const model = (extra = {}) => ({
  cycles: [{ period: "2026-10", cierre: "2026-10-08", vto: "2026-10-16" }],
  categorias: ["Salud", "Alimentación", "Otros/Imprevistos"],
  medios: ["Efectivo", "Débito", "Tarjeta de Crédito", "Transferencia"],
  estados: ["Pagado", "Pendiente"],
  movs: [], impuestos: [], aportes: [], ingresos: new Map(),
  ...extra,
});
const mov = (o) => ({ id: 1, fecha: "2026-09-11", desc: "x", cat: "Salud", sub: "s", medio: "Tarjeta de Crédito", monto: 1, moneda: "ARS", cuotas: 1, esTarjeta: o.medio ? o.medio === "Tarjeta de Crédito" : true, montoCuota: o.monto / (o.cuotas || 1), ...o });
const suggest = (t) => (/FARMACIA/i.test(t) ? { cat: "Salud", sub: "Farmacia", medio: "Débito" } : null);

test("tipoImpuesto normaliza los nombres", () => {
  assert.equal(tipoImpuesto("IIBB PERCEP-CABA 2,00%( 39426,83)"), "IIBB percepción CABA");
  assert.equal(tipoImpuesto("IVA RG 4240 21%"), "IVA RG 4240");
  assert.equal(tipoImpuesto("DB.RG 5617 30% ( 42445,66 )"), "Percepción RG 5617");
  assert.equal(tipoImpuesto("DEV.IMP. RG 5617 30%"), "Percepción RG 5617");
});

test("plan de la Visa: lo cargado queda como existente, lo nuevo se propone y los impuestos van a su hoja", () => {
  const m = model({
    movs: [
      mov({ fecha: "2026-09-11", monto: 54000 }),
      mov({ fecha: "2026-09-11", monto: 20, moneda: "USD" }),
      mov({ fecha: "2026-05-19", monto: 29977.66 * 9, cuotas: 9 }),
      mov({ fecha: "2026-09-17", monto: 400 }),
    ],
  });
  const plan = buildPlan([parseVisa(VISA)], m, suggest);
  const est = (txt) => plan.rows.find((r) => r.texto.includes(txt)).estado;
  assert.equal(est("Gimnasiox"), "existe");
  assert.equal(est("Tiendauno"), "existe");
  assert.equal(est("Delivery Propina"), "existe");
  const cafe = plan.rows.find((r) => r.texto.includes("Cafeuno"));
  assert.equal(cafe.estado, "nuevo");
  assert.equal(cafe.mov.cuotas, 3);
  assert.equal(cafe.mov.monto, 103012.14);
  assert.equal(cafe.mov.medio, "Tarjeta de Crédito");
  assert.equal(cafe.mov.estado, "Pendiente");
  const imp = plan.rows.filter((r) => r.kind === "impuesto");
  assert.equal(imp.length, 3);
  assert.ok(imp.every((r) => r.imp.resumen === "2026-10" && r.imp.origen === "Visa"));
  assert.equal(plan.rows.filter((r) => r.estado === "ignorado").length, 2);
  const req = planToRequests(plan.rows);
  assert.equal(req.movs.length, 1);
  assert.equal(req.impuestos.length, 3);
});

test("plan de la Visa: avisa cuando la planilla tiene otra cantidad de cuotas", () => {
  const m = model({ movs: [mov({ fecha: "2026-05-19", desc: "Tiendauno", monto: 90000, cuotas: 3 })] });
  const r = buildPlan([parseVisa(VISA)], m, suggest).rows.find((x) => x.texto.includes("Tiendauno"));
  assert.equal(r.estado, "difiere");
  assert.equal(r.selected, false);
  assert.equal(r.mov, undefined);
});

test("plan de la Visa: un impuesto ya cargado no se repite", () => {
  const m = model({ impuestos: [{ fecha: "2026-10-08", origen: "Visa", tipo: "IVA RG 4240", monto: 8279.63, resumen: "2026-10" }] });
  const imp = buildPlan([parseVisa(VISA)], m, suggest).rows.filter((r) => r.kind === "impuesto");
  assert.equal(imp.find((r) => r.texto === "IVA RG 4240").estado, "existe");
  assert.equal(imp.filter((r) => r.estado === "nuevo").length, 2);
});

test("plan de la caja: sueldo, retiro de inversión, neto de reintegro y movimientos que se anulan", () => {
  const m = model({ movs: [mov({ fecha: "2026-09-10", medio: "Débito", monto: 16778.35 - 4194.58, esTarjeta: false })] });
  const plan = buildPlan([parseCaja(CAJA)], m, suggest);
  const ing = plan.rows.find((r) => r.kind === "ingreso");
  assert.deepEqual(ing.ingreso, { period: "2026-09", fecha: "2026-09-08", monto: 1000000 });
  const inv = plan.rows.find((r) => r.kind === "inversion");
  assert.equal(inv.aporte.monto, -100000);
  assert.equal(inv.aporte.destino, "Balanz");
  // la compra de farmacia ya está cargada neta del reintegro: no se repite ni queda un reintegro suelto
  assert.equal(plan.rows.filter((r) => r.texto.toLowerCase().includes("farmacia")).every((r) => r.estado === "existe"), true);
  assert.equal(plan.rows.filter((r) => /^reintegro/i.test(r.texto)).length, 0);
  // compra + devolución y percepción + anulación se cancelan
  assert.equal(plan.rows.filter((r) => r.estado === "ignorado" && /anula/.test(r.motivo)).length, 4);
  assert.ok(plan.rows.some((r) => r.estado === "ignorado" && /cuentas propias/.test(r.motivo)));
});

test("plan: nada de lo que se importa queda marcado si ya existe, y los reintegros de personas van en negativo", () => {
  const caja = parseCaja([
    "Resumen de Caja de Ahorro en Pesos",
    "10/09/26 TRANSFERENCIA DE TERCEROS 3.250,00 3.250,00",
    "PERSONA UNO",
    "VARIOS",
    "Total $ 3.250,00 -$ 0,00 $ 3.250,00",
  ]);
  const plan = buildPlan([caja], model(), suggest);
  const r = plan.rows[0];
  assert.equal(r.mov.monto, -3250);
  assert.equal(r.mov.medio, "Transferencia");
  assert.equal(r.selected, true);
  const otra = buildPlan([caja], model({ movs: [mov({ fecha: "2026-09-10", medio: "Transferencia", monto: -3250, esTarjeta: false })] }), suggest);
  assert.equal(otra.rows[0].estado, "existe");
  assert.equal(planToRequests(otra.rows).movs.length, 0);
});
